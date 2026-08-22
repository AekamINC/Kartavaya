"""An invoice created in Ganit names the CRM company it is for.

── What was broken ──────────────────────────────────────────────────────────
`ganit_invoices.client_id` has existed since the table did, and NOTHING in the
product has ever written it. Every INSERT omitted the column, so every invoice
this product has created carries NULL. The 547 populated rows are seed data —
which is why every 2025 row has a company and only 54% of 2026 rows do.

That NULL is not cosmetic. It puts every invoice into the literal
"Unlinked client" bucket in receivables ageing, renders `billed_to` as an
empty string on the public pay page, reports zero against the company in
Client 360, and stops every Niyam rule keyed on `client_id` from ever firing.

── What these tests hold ────────────────────────────────────────────────────
1. A company named by the form is written.
2. A company NOT named by the form is INHERITED from the contact's employer —
   an invoice raised against a person is an invoice to the firm they work for.
3. A `client_id` belonging to another organisation is REFUSED, and refused
   before `_next_invoice_number` spends a Rule 46(b) serial. The foreign key
   is not composite with `org_id`, so this application check is the only
   thing standing between a request body and a cross-org write.
4. Naming nobody still creates an invoice. GSTIN, PAN and a customer are all
   non-mandatory; a company must block nothing either.

The fakes follow `test_niyam_wiring_ganit.py`: acquire() lends a DISTINCT
connection per call so "the write rode the write's own connection" cannot be
satisfied by accident, and a tiny substring dispatcher lets each test script
what a query answers.
"""
import pytest
from fastapi import HTTPException

import routers.ganit as ganit


# ── fakes ────────────────────────────────────────────────────

class _Conn:
    """One lent connection; proxies back into the pool's ledger."""

    def __init__(self, pool):
        self._pool = pool
        self.in_tx = False

    async def fetch(self, q, *a):
        return await self._pool.fetch(q, *a)

    async def fetchrow(self, q, *a):
        return await self._pool.fetchrow(q, *a)

    async def fetchval(self, q, *a):
        return await self._pool.fetchval(q, *a)

    async def execute(self, q, *a):
        return await self._pool.execute(q, *a)

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(_s):
                conn.in_tx = True
                return _s

            async def __aexit__(_s, *exc):
                conn.in_tx = False
                return False
        return _T()


class _Pool:
    def __init__(self):
        #: every (SQL, args) that reached the database, pool or lent conn.
        self.calls = []
        self.fetchrow_responses = []
        self.fetchval_responses = []

    def _dispatch(self, table, q, default):
        for frag, val in table:
            if frag in q:
                return val
        return default

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchrow_responses, q, None)

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchval_responses, q, None)

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return _Conn(pool)

            async def __aexit__(_s, *exc):
                return False
        return _A()


async def _noop_emitter(conn, **kw):
    return 1


_INV_ROW = {
    "id": "i1", "invoice_number": "INV-2026-0001", "invoice_type": "tax_invoice",
    "total": 1180.0, "doc_status": "final",
}

_LINE = {"description": "Service", "hsn_code": "998231", "quantity": 1,
         "rate": 1000, "gst_rate": 18}

#: The lookups `resolve_order_company` performs, by the fragment that
#: identifies each. Scripting by fragment rather than call order means a test
#: cannot pass because the handler happened to ask in the expected sequence.
_ORG_CHECK = "FROM staging.graha_clients "
_CONTACT_EMPLOYER = "SELECT client_id::text FROM staging.graha_contacts"

#: Where `client_id` sits in the INSERT's argument tuple. Appended LAST, after
#: doc_status — $18 is deliberately bound twice (total and balance_due), so
#: renumbering the placeholders to slot the column in beside `contact_id` is a
#: chance to break the one binding that is not 1:1.
_CLIENT_ARG = 22


@pytest.fixture
def rig(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(ganit, "get_pool", _get_pool)

    async def _next_doc_number(pool, org_id, table, column, prefix):
        # Recorded on the ledger so a test can prove a REFUSED create never
        # reached it. Rule 46(b) numbers are consecutive; a serial spent on a
        # request that 400s is a gap in the book.
        p.calls.append(("__SERIAL__", (org_id, table, column, prefix)))
        return "INV-2026-0001"

    monkeypatch.setattr(ganit, "next_doc_number", _next_doc_number)

    # The Rule 46 completeness gate has its own tests; here it is a
    # pass-through so these exercise the company link, not the validator.
    async def _gate_ok(pool, org_id, invoice, contact_id):
        return None

    monkeypatch.setattr(ganit, "_refuse_final_if_incomplete", _gate_ok)
    monkeypatch.setattr(ganit, "invoice_created", _noop_emitter)

    p.fetchrow_responses = [("INSERT INTO staging.ganit_invoices", _INV_ROW)]
    return p


def _insert(p):
    """The one INSERT into ganit_invoices, or None if nothing was written."""
    for q, a in p.calls:
        if "INSERT INTO staging.ganit_invoices" in q:
            return q, a
    return None


# ── the company named on the form ────────────────────────────

@pytest.mark.asyncio
async def test_named_company_is_written(rig):
    p = rig
    p.fetchval_responses = [(_ORG_CHECK, 1)]        # it is this org's company

    await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", client_id="cl-1",
                            line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    q, args = _insert(p)
    # THE PROPERTY, NOT THE POSITION. This asserted `"client_id)"` — which is
    # only true while client_id is the LAST column in the INSERT. Adding
    # `customer_ref` after it broke a test that has nothing to do with customer
    # references. What matters is that the column is named at all.
    columns = q[q.index("(") + 1:q.index(")")]
    assert "client_id" in [c.strip() for c in columns.split(",")], (
        "the column is not in the INSERT at all")
    assert "NULLIF($23,'')::uuid" in q, "client_id is not bound as a nullable uuid"
    assert args[_CLIENT_ARG] == "cl-1"


@pytest.mark.asyncio
async def test_named_company_is_checked_against_this_org(rig):
    p = rig
    p.fetchval_responses = [(_ORG_CHECK, 1)]

    await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", client_id="cl-1",
                            line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    checks = [a for q, a in p.calls if _ORG_CHECK in q]
    assert checks, "a client_id from the request body was stored unverified"
    assert checks[0] == ("cl-1", "org1"), "the ownership check did not name this org"


@pytest.mark.asyncio
async def test_another_orgs_company_is_refused_before_a_serial_is_spent(rig):
    p = rig
    p.fetchval_responses = [(_ORG_CHECK, None)]     # not in this organisation

    with pytest.raises(HTTPException) as exc:
        await ganit.create_invoice(
            ganit.InvoiceCreate(invoice_type="tax_invoice", client_id="cl-other",
                                line_items=[ganit.LineItem(**_LINE)]),
            user={"user_id": "u1"}, org_id="org1")

    assert exc.value.status_code == 400
    assert _insert(p) is None, "refused, yet an invoice was written"
    assert not any(q == "__SERIAL__" for q, _ in p.calls), \
        "a Rule 46(b) serial was spent on a refused create"


# ── the company inherited from the contact ───────────────────

@pytest.mark.asyncio
async def test_company_is_inherited_from_the_contacts_employer(rig):
    p = rig
    p.fetchval_responses = [(_CONTACT_EMPLOYER, "cl-9")]

    await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", contact_id="ct-1",
                            line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    q, args = _insert(p)
    assert args[_CLIENT_ARG] == "cl-9", \
        "an invoice raised against a person did not reach the firm they work for"
    lookups = [a for qq, a in p.calls if _CONTACT_EMPLOYER in qq]
    assert lookups[0] == ("ct-1", "org1"), \
        "the contact was read without an org predicate"


@pytest.mark.asyncio
async def test_a_named_company_beats_the_contacts_employer(rig):
    """The form's answer wins. Invoicing one subsidiary through a contact whose
    record still points at the parent is a real thing a firm does, and the
    control that says so must not be overruled by an inference."""
    p = rig
    p.fetchval_responses = [(_ORG_CHECK, 1), (_CONTACT_EMPLOYER, "cl-parent")]

    await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", client_id="cl-sub",
                            contact_id="ct-1", line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    _q, args = _insert(p)
    assert args[_CLIENT_ARG] == "cl-sub"


@pytest.mark.asyncio
async def test_a_contact_with_no_employer_leaves_the_company_empty(rig):
    p = rig
    p.fetchval_responses = [(_CONTACT_EMPLOYER, None)]

    await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", contact_id="ct-1",
                            line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    _q, args = _insert(p)
    # The empty string, never None: `NULLIF($23,'')::uuid` turns it into SQL
    # NULL, and an untyped NULL through PgBouncer is the parse error that
    # reads as an instant 500.
    assert args[_CLIENT_ARG] == ""


# ── naming nobody must still bill ────────────────────────────

@pytest.mark.asyncio
async def test_no_customer_at_all_still_creates_the_invoice(rig):
    """A company blocks nothing, exactly as GSTIN, PAN and TAN block nothing.
    Refusing the save does not produce the company record, it produces an
    unbilled supply."""
    p = rig

    out = await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="proforma",
                            line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    assert out["status"] == "created"
    _q, args = _insert(p)
    assert args[_CLIENT_ARG] == ""
    assert not any(_ORG_CHECK in q for q, _ in p.calls), \
        "an ownership check ran with no company to check"


@pytest.mark.asyncio
async def test_the_response_shape_is_unchanged(rig):
    """`RETURNING *` widened for the event's sake and the column count grew;
    the response must still be the same four keys plus status."""
    p = rig
    p.fetchval_responses = [(_CONTACT_EMPLOYER, "cl-9")]

    out = await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", contact_id="ct-1",
                            line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    assert set(out) == {"status", "id", "invoice_number", "total", "doc_status"}
