"""The four ganit (finance) events are wired to the writes that own them.

invoice.created   — EVERY invoice INSERT: `create_invoice`,
                    `convert_to_invoice`, `generate_recurring_invoice`,
                    `create_invoice_from_deal`, `create_invoice_from_time_entries`
payment.recorded  — `record_payment`, with the invoice AS RE-READ after the
                    payment applied
invoice.paid      — `record_payment` when the payment settles the invoice in
                    full (via='payment'), and `match_bank_line` when the
                    reconciled payment's invoice is settled (via='reconciliation')
invoice.cancelled — `cancel_invoice` (the doc-status ladder never cancels;
                    payment_status is the column the cancel writes)

The contract under test is emit.py's one rule: the emitter is awaited on the
BUSINESS WRITE'S OWN CONNECTION, inside its transaction — and never on a
refusal path. The fakes are the committed idiom from
`tests/test_target_attainment.py`: `_Pool.acquire()` lends the pool itself out
as the connection, so "same connection" is assertable with `is`.

Emitters are monkeypatched in the ROUTER's namespace (`ganit.invoice_created`,
not `services.niyam.subjects.invoice_created`) — the router imports them by
name at module level precisely so these tests can prove the handler called
them.
"""
from datetime import date

import pytest
from fastapi import HTTPException

import routers.ganit as ganit


# ── fakes ────────────────────────────────────────────────────

class _Pool:
    """The fake-pool idiom from test_target_attainment.py, plus a tiny
    substring dispatcher so each test can script what a query returns."""

    def __init__(self):
        self.calls = []
        #: list of (SQL fragment, value) — first fragment found in the query
        #: wins; an unmatched query returns the method's empty default.
        self.fetchrow_responses = []
        self.fetchval_responses = []
        self.fetch_responses = []

    def _dispatch(self, table, q, default):
        for frag, val in table:
            if frag in q:
                return val
        return default

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetch_responses, q, [])

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchrow_responses, q, None)

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return self._dispatch(self.fetchval_responses, q, None)

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    # The wired writes run inside `async with pool.acquire()` /
    # `async with conn.transaction()`; the fake lends out a conn that proxies
    # every call back into the same ledger the assertions read.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return pool

            async def __aexit__(_s, *exc):
                return False
        return _A()

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *exc):
                return False
        return _T()


class _Recorder:
    """Stands in for one subjects.py emitter and remembers how it was called."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, kw))
        return 1


_EMITTERS = ("invoice_created", "payment_recorded", "invoice_paid",
             "invoice_cancelled")


@pytest.fixture
def rig(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(ganit, "get_pool", _get_pool)

    async def _next_doc_number(pool, org_id, table, column, prefix):
        return "INV-2026-0001"

    monkeypatch.setattr(ganit, "next_doc_number", _next_doc_number)

    # The Rule 46 completeness gate has its own tests (it reads the org and
    # contact off the pool and refuses a 422); here it is a pass-through so
    # these tests exercise the WRITE paths, not the validator.
    async def _gate_ok(pool, org_id, invoice, contact_id):
        return None

    monkeypatch.setattr(ganit, "_refuse_final_if_incomplete", _gate_ok)

    emitters = {}
    for name in _EMITTERS:
        rec = _Recorder()
        monkeypatch.setattr(ganit, name, rec)
        emitters[name] = rec
    return p, emitters


def _assert_silent(emitters, *names):
    for name in names:
        assert emitters[name].calls == [], f"{name} fired on a path that must emit nothing"


_INV_ROW = {
    "id": "i1", "invoice_number": "INV-2026-0001", "invoice_type": "tax_invoice",
    "total": 1180.0, "client_id": "c1", "doc_status": "final",
    "created_by": "u1", "amount_paid": 0.0, "balance_due": 1180.0,
}

_LINE = {"description": "Service", "hsn_code": "998231", "quantity": 1,
         "rate": 1000, "gst_rate": 18}


# ── invoice.created — POST /invoices ─────────────────────────

@pytest.mark.asyncio
async def test_create_invoice_emits_invoice_created(rig):
    p, em = rig
    p.fetchrow_responses = [("INSERT INTO staging.ganit_invoices", _INV_ROW)]

    out = await ganit.create_invoice(
        ganit.InvoiceCreate(invoice_type="tax_invoice", line_items=[ganit.LineItem(**_LINE)]),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["invoice_created"].calls) == 1
    conn, kw = em["invoice_created"].calls[0]
    assert conn is p, "the emitter must ride the business write's own connection"
    assert kw == {"org_id": "org1", "actor_id": "u1",
                  "invoice_id": "i1", "row": _INV_ROW}
    # The RETURNING widened to * for the event's sake; the response keeps its
    # original four-key shape and must not start leaking whole rows.
    assert set(out) == {"status", "id", "invoice_number", "total", "doc_status"}


@pytest.mark.asyncio
async def test_create_invoice_with_no_lines_emits_nothing(rig):
    p, em = rig
    with pytest.raises(HTTPException) as exc:
        await ganit.create_invoice(
            ganit.InvoiceCreate(invoice_type="tax_invoice", line_items=[]),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)
    assert not any("INSERT INTO staging.ganit_invoices" in q for q, _ in p.calls), \
        "refused, yet an invoice was written"


# ── invoice.created — POST /invoices/{id}/convert-to-invoice ─

_QUOTATION = {
    "id": "q1", "invoice_type": "quotation", "estimate_status": "accepted",
    "contact_id": "ct1", "deal_id": None, "due_date": None,
    "place_of_supply": "", "is_igst": False, "line_items": "[]",
    "subtotal": 1000, "cgst": 90, "sgst": 90, "igst": 0, "discount": 0,
    "total": 1180, "notes": "", "terms": "",
}


@pytest.mark.asyncio
async def test_converting_an_estimate_emits_invoice_created(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT * FROM staging.ganit_invoices", _QUOTATION),
        ("INSERT INTO staging.ganit_invoices", _INV_ROW),
    ]
    await ganit.convert_to_invoice("q1", user={"user_id": "u1"}, org_id="org1")

    assert len(em["invoice_created"].calls) == 1
    conn, kw = em["invoice_created"].calls[0]
    assert conn is p
    assert kw["invoice_id"] == "i1"
    assert kw["row"] == _INV_ROW


@pytest.mark.asyncio
async def test_converting_an_unaccepted_estimate_emits_nothing(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT * FROM staging.ganit_invoices",
         {**_QUOTATION, "estimate_status": "pending"}),
    ]
    with pytest.raises(HTTPException) as exc:
        await ganit.convert_to_invoice("q1", user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)


# ── invoice.created — POST /recurring/{id}/generate ──────────

_RECURRING = {
    "id": "r1", "contact_id": "ct1", "template_items": [dict(_LINE)],
    "subtotal": 1000.0, "gst_rate": 18.0, "is_igst": False,
    "notes": "", "terms": "", "frequency": "monthly",
    "next_date": date(2026, 9, 1), "end_date": None,
}


@pytest.mark.asyncio
async def test_generating_a_recurring_invoice_emits_invoice_created(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.ganit_recurring", _RECURRING),
        ("INSERT INTO staging.ganit_invoices", _INV_ROW),
    ]
    await ganit.generate_recurring_invoice("r1", user={"user_id": "u1"}, org_id="org1")

    assert len(em["invoice_created"].calls) == 1
    conn, kw = em["invoice_created"].calls[0]
    assert conn is p
    assert kw["invoice_id"] == "i1"
    assert kw["actor_id"] == "u1"


@pytest.mark.asyncio
async def test_a_missing_recurring_profile_emits_nothing(rig):
    p, em = rig  # profile lookup returns the default None → 404
    with pytest.raises(HTTPException) as exc:
        await ganit.generate_recurring_invoice("r-gone", user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 404
    _assert_silent(em, *_EMITTERS)


# ── invoice.created — POST /invoices/from-deal/{deal_id} ─────

@pytest.mark.asyncio
async def test_create_invoice_from_deal_emits_invoice_created(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.graha_deals",
         {"id": "d1", "title": "Big deal", "value": 1000, "contact_id": "ct1"}),
        # the "already invoiced?" probe falls through to the default None
        ("INSERT INTO staging.ganit_invoices", _INV_ROW),
    ]
    out = await ganit.create_invoice_from_deal("d1", user={"user_id": "u1"}, org_id="org1")

    assert out["status"] == "created"
    assert len(em["invoice_created"].calls) == 1
    conn, kw = em["invoice_created"].calls[0]
    assert conn is p
    assert kw["invoice_id"] == "i1"


@pytest.mark.asyncio
async def test_a_deal_already_invoiced_emits_nothing(rig):
    """The dedupe path returns the existing invoice — nothing was created, so
    announcing a creation would be a lie."""
    p, em = rig
    p.fetchrow_responses = [
        ("FROM staging.graha_deals",
         {"id": "d1", "title": "Big deal", "value": 1000, "contact_id": "ct1"}),
        ("WHERE deal_id", {"id": "i0"}),
    ]
    out = await ganit.create_invoice_from_deal("d1", user={"user_id": "u1"}, org_id="org1")
    assert out["status"] == "exists"
    _assert_silent(em, *_EMITTERS)


# ── invoice.created — POST /invoices/from-time-entries ───────

@pytest.mark.asyncio
async def test_billing_time_entries_emits_invoice_created(rig):
    p, em = rig
    p.fetch_responses = [
        ("FROM time_entries", [{
            "entry_id": "te1", "task_id": "tk1", "minutes": 60,
            "description": "work", "user_id": "u2",
            "employee_name": "A", "hourly_rate": 100,
        }]),
    ]
    p.fetchrow_responses = [("INSERT INTO staging.ganit_invoices", _INV_ROW)]

    await ganit.create_invoice_from_time_entries(
        ganit.TimesheetInvoiceCreate(), user={"user_id": "u1"}, org_id="org1")

    assert len(em["invoice_created"].calls) == 1
    conn, kw = em["invoice_created"].calls[0]
    assert conn is p
    assert kw["invoice_id"] == "i1"
    # …and the billed flag rides the same ledger (same transaction).
    assert any("UPDATE time_entries" in q for q, _ in p.calls)


@pytest.mark.asyncio
async def test_no_unbilled_entries_emits_nothing(rig):
    p, em = rig  # the entries query answers the default []
    with pytest.raises(HTTPException) as exc:
        await ganit.create_invoice_from_time_entries(
            ganit.TimesheetInvoiceCreate(), user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)


# ── payment.recorded / invoice.paid — POST /invoices/{id}/payments ──

_PAY_ROW = {"id": "pay1", "invoice_id": "i1", "amount": 500.0,
            "payment_method": "bank_transfer"}


def _payment_rig(p, *, total, already_paid, after_row):
    p.fetchrow_responses = [
        ("SELECT total, amount_paid, payment_status",
         {"total": total, "amount_paid": already_paid, "payment_status": "unpaid"}),
        ("INSERT INTO staging.ganit_payments", _PAY_ROW),
        ("UPDATE staging.ganit_invoices SET amount_paid", after_row),
    ]


@pytest.mark.asyncio
async def test_a_partial_payment_emits_payment_recorded_only(rig):
    p, em = rig
    after = {**_INV_ROW, "total": 1000.0, "amount_paid": 500.0,
             "balance_due": 500.0, "payment_status": "partial"}
    _payment_rig(p, total=1000, already_paid=0, after_row=after)

    await ganit.record_payment(
        "i1", ganit.PaymentRecord(amount=500),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["payment_recorded"].calls) == 1
    conn, kw = em["payment_recorded"].calls[0]
    assert conn is p
    assert kw == {"org_id": "org1", "actor_id": "u1", "payment_id": "pay1",
                  "payment_row": _PAY_ROW, "invoice_row": after}
    # A payment that leaves balance owed is NOT an invoice.paid.
    _assert_silent(em, "invoice_paid", "invoice_created", "invoice_cancelled")


@pytest.mark.asyncio
async def test_the_invoice_row_is_the_reread_row_not_the_before_row(rig):
    """The emitter's docstring demands the invoice AS RE-READ after the payment
    applied. The before-row (amount_paid=0) and the after-row differ exactly
    there, so passing the wrong one is detectable."""
    p, em = rig
    after = {**_INV_ROW, "total": 1000.0, "amount_paid": 500.0,
             "balance_due": 500.0, "payment_status": "partial"}
    _payment_rig(p, total=1000, already_paid=0, after_row=after)

    await ganit.record_payment(
        "i1", ganit.PaymentRecord(amount=500),
        user={"user_id": "u1"}, org_id="org1")

    _, kw = em["payment_recorded"].calls[0]
    assert kw["invoice_row"]["amount_paid"] == 500.0, \
        "invoice_row must reflect the payment that was just applied"
    assert kw["invoice_row"]["balance_due"] == 500.0


@pytest.mark.asyncio
async def test_the_settling_payment_additionally_emits_invoice_paid(rig):
    p, em = rig
    after = {**_INV_ROW, "total": 1000.0, "amount_paid": 1000.0,
             "balance_due": 0.0, "payment_status": "paid"}
    _payment_rig(p, total=1000, already_paid=500, after_row=after)

    await ganit.record_payment(
        "i1", ganit.PaymentRecord(amount=500),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["payment_recorded"].calls) == 1
    assert len(em["invoice_paid"].calls) == 1
    conn, kw = em["invoice_paid"].calls[0]
    assert conn is p
    assert kw == {"org_id": "org1", "actor_id": "u1", "invoice_id": "i1",
                  "row": after, "via": "payment"}
    assert "source" not in kw, "a recorded payment is an app event — the default"


@pytest.mark.asyncio
async def test_settlement_reads_total_minus_paid_not_the_balance_column(rig):
    """`balance_due` defaults wrong on order-generated rows (born 0 against a
    non-zero total), so a payment against such a row must NOT read as settling
    it just because the column says nothing is owed."""
    p, em = rig
    # total 1000, 300 paid so far, 200 arriving: 500 still owed — partial,
    # whatever a corrupt balance_due column might claim.
    after = {**_INV_ROW, "total": 1000.0, "amount_paid": 500.0,
             "balance_due": 0.0, "payment_status": "partial"}
    _payment_rig(p, total=1000, already_paid=300, after_row=after)

    await ganit.record_payment(
        "i1", ganit.PaymentRecord(amount=200),
        user={"user_id": "u1"}, org_id="org1")

    assert len(em["payment_recorded"].calls) == 1
    _assert_silent(em, "invoice_paid")


@pytest.mark.asyncio
async def test_a_missing_invoice_emits_nothing(rig):
    p, em = rig  # invoice lookup returns the default None → 404
    with pytest.raises(HTTPException) as exc:
        await ganit.record_payment(
            "i-gone", ganit.PaymentRecord(amount=500),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 404
    _assert_silent(em, *_EMITTERS)


@pytest.mark.asyncio
async def test_paying_a_cancelled_invoice_emits_nothing(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT total, amount_paid, payment_status",
         {"total": 1000, "amount_paid": 0, "payment_status": "cancelled"}),
    ]
    with pytest.raises(HTTPException) as exc:
        await ganit.record_payment(
            "i1", ganit.PaymentRecord(amount=500),
            user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 400
    _assert_silent(em, *_EMITTERS)
    assert not any("INSERT INTO staging.ganit_payments" in q for q, _ in p.calls), \
        "refused, yet a payment was written"


# ── invoice.paid via reconciliation — POST /bank-statements/{id}/match ──

def _match_rig(p, *, ledger="receipts", invoice_row=None):
    p.fetchrow_responses = [
        ("SELECT id FROM staging.ganit_bank_statement_lines", {"id": "l1"}),
        ("UPDATE staging.ganit_bank_statement_lines", {"id": "l1"}),
    ]
    if invoice_row is not None:
        p.fetchrow_responses.append(("FROM staging.ganit_invoices i", invoice_row))
    p.fetchval_responses = [
        ("FROM staging.ganit_payments", 1 if ledger == "receipts" else None),
        ("FROM staging.ganit_vendor_payments", 1 if ledger == "vendor" else None),
        # the double-match probe falls through to the default None
    ]


@pytest.mark.asyncio
async def test_reconciling_the_settling_payment_emits_invoice_paid(rig):
    p, em = rig
    settled = {**_INV_ROW, "total": 1000.0, "amount_paid": 1000.0,
               "balance_due": 0.0, "payment_status": "paid"}
    _match_rig(p, ledger="receipts", invoice_row=settled)

    out = await ganit.match_bank_line("l1", "pay1", user={"user_id": "u1"}, org_id="org1")

    assert out["matched_type"] == "invoice_payment"
    assert len(em["invoice_paid"].calls) == 1
    conn, kw = em["invoice_paid"].calls[0]
    assert conn is p, "the event rides the match's own transaction"
    assert kw == {"org_id": "org1", "actor_id": "u1", "invoice_id": "i1",
                  "row": settled, "via": "reconciliation"}


@pytest.mark.asyncio
async def test_reconciling_a_payment_on_a_part_paid_invoice_emits_nothing(rig):
    """The matched payment does not settle the invoice — money is still owed,
    so there is no 'paid' to announce."""
    p, em = rig
    part_paid = {**_INV_ROW, "total": 1000.0, "amount_paid": 400.0,
                 "balance_due": 600.0, "payment_status": "partial"}
    _match_rig(p, ledger="receipts", invoice_row=part_paid)

    out = await ganit.match_bank_line("l1", "pay1", user={"user_id": "u1"}, org_id="org1")
    assert out["ok"] is True
    _assert_silent(em, *_EMITTERS)


@pytest.mark.asyncio
async def test_reconciling_a_vendor_payment_emits_nothing(rig):
    """A vendor payment reconciles a bill. There is no invoice to be paid."""
    p, em = rig
    _match_rig(p, ledger="vendor")

    out = await ganit.match_bank_line("l1", "vp1", user={"user_id": "u1"}, org_id="org1")
    assert out["matched_type"] == "vendor_payment"
    _assert_silent(em, *_EMITTERS)
    assert not any("FROM staging.ganit_invoices i" in q for q, _ in p.calls), \
        "a vendor payment has no invoice to look up"


@pytest.mark.asyncio
async def test_a_payment_in_neither_ledger_emits_nothing(rig):
    p, em = rig
    p.fetchrow_responses = [
        ("SELECT id FROM staging.ganit_bank_statement_lines", {"id": "l1"}),
    ]
    with pytest.raises(HTTPException) as exc:
        await ganit.match_bank_line("l1", "p-gone", user={"user_id": "u1"}, org_id="org1")
    assert exc.value.status_code == 404
    _assert_silent(em, *_EMITTERS)
    assert not any("UPDATE staging.ganit_bank_statement_lines" in q for q, _ in p.calls), \
        "refused, yet the line was matched"


# ── invoice.cancelled — POST /invoices/{id}/cancel ───────────

@pytest.mark.asyncio
async def test_cancelling_emits_invoice_cancelled_with_the_written_row(rig):
    p, em = rig
    cancelled = {**_INV_ROW, "payment_status": "cancelled"}
    p.fetchrow_responses = [
        ("UPDATE staging.ganit_invoices SET payment_status='cancelled'", cancelled),
    ]
    await ganit.cancel_invoice("i1", user={"user_id": "u1"}, org_id="org1")

    assert len(em["invoice_cancelled"].calls) == 1
    conn, kw = em["invoice_cancelled"].calls[0]
    assert conn is p
    assert kw == {"org_id": "org1", "actor_id": "u1",
                  "invoice_id": "i1", "row": cancelled}


@pytest.mark.asyncio
async def test_a_guarded_cancel_that_wrote_nothing_emits_nothing(rig):
    """The UPDATE's own guard (`payment_status NOT IN ('paid','cancelled')`)
    refuses paid and re-cancelled invoices by matching no row. No row, no
    event — announcing a cancellation that did not happen is the lie the
    RETURNING exists to prevent."""
    p, em = rig  # the guarded UPDATE returns the default None
    out = await ganit.cancel_invoice("i1", user={"user_id": "u1"}, org_id="org1")
    assert out == {"status": "cancelled"}, "the route's response contract is unchanged"
    _assert_silent(em, *_EMITTERS)


# ── every invoice INSERT in the module emits ─────────────────

def test_no_invoice_insert_path_is_silent():
    """Source-level backstop: every `INSERT INTO staging.ganit_invoices` in
    this module must sit in a function that also calls `invoice_created`.
    The monkeypatch tests above prove the wired paths fire; this proves a
    sixth INSERT added next month cannot quietly skip the event."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(ganit))
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        strings = [c.value for c in ast.walk(node)
                   if isinstance(c, ast.Constant) and isinstance(c.value, str)]
        if not any("INSERT INTO staging.ganit_invoices" in s for s in strings):
            continue
        calls = {c.func.id for c in ast.walk(node)
                 if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}
        if "invoice_created" not in calls:
            offenders.append(node.name)
    assert not offenders, \
        f"these functions INSERT an invoice without emitting invoice.created: {offenders}"
