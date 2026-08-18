"""The four ganit (finance) events are wired to the writes that own them.

invoice.created   — EVERY invoice INSERT: `create_invoice`,
                    `convert_to_invoice`, `generate_recurring_invoice`,
                    `create_invoice_from_deal`, `create_invoice_from_time_entries`
payment.recorded  — `record_payment`, with the invoice AS RE-READ after the
                    payment applied
invoice.paid      — `record_payment` when the payment settles the invoice in
                    full (via='payment'), and both reconciliation doors —
                    `match_bank_line` and `import_bank_statement`'s auto-match —
                    when the reconciled payment's invoice is settled
                    (via='reconciliation')
invoice.cancelled — `cancel_invoice` (the doc-status ladder never cancels;
                    payment_status is the column the cancel writes)

The contract under test is emit.py's one rule: the emitter is awaited on the
BUSINESS WRITE'S OWN CONNECTION, inside its transaction — and never on a
refusal path. The fakes make that assertable FOR REAL: `_Pool.acquire()` lends
a DISTINCT `_Conn` per acquire (the pool remembers each in `self.lent`),
`_Conn.transaction()` flips `in_tx` on enter/exit, and every recorder captures
the connection AND its `in_tx` flag at the moment of the call. "Rode the
write's own connection" therefore means: a lent conn — never the pool — whose
transaction was open when the emitter ran. The previous idiom (the pool
lending ITSELF out, transaction() a stateless no-op) made the assertion
vacuous: an emitter called on the bare pool with no transaction at all still
satisfied `conn is pool`.

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

class _Conn:
    """One lent connection. A DISTINCT object per acquire(), so `conn is pool`
    can never be satisfied by accident; proxies every query back into the
    pool's ledger/answer machinery so scripted responses keep working, and
    keeps its own per-conn ledger so a test can prove the emit rode the very
    connection that performed the write."""

    def __init__(self, pool):
        self._pool = pool
        self.calls = []
        self.in_tx = False

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return await self._pool.fetch(q, *a)

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return await self._pool.fetchrow(q, *a)

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return await self._pool.fetchval(q, *a)

    async def execute(self, q, *a):
        self.calls.append((q, a))
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
    """The answer machinery (a tiny substring dispatcher so each test can
    script what a query returns) plus the lending ledger the connection
    assertions read. The pool itself has NO transaction() — a handler that
    tries to open a transaction on the pool instead of a lent conn dies
    loudly here, exactly as asyncpg's real pool would refuse it."""

    def __init__(self):
        self.calls = []
        #: list of (SQL fragment, value) — first fragment found in the query
        #: wins; an unmatched query returns the method's empty default.
        self.fetchrow_responses = []
        self.fetchval_responses = []
        self.fetch_responses = []
        #: every _Conn acquire() ever lent out, in order.
        self.lent = []

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
    # `async with conn.transaction()`; acquire() lends a fresh _Conn that
    # proxies every call back into the same ledger the assertions read.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                conn = _Conn(pool)
                pool.lent.append(conn)
                return conn

            async def __aexit__(_s, *exc):
                return False
        return _A()


class _Recorder:
    """Stands in for one subjects.py emitter and remembers how it was called:
    the connection, whether that connection's transaction was open AT CALL
    TIME (in_tx is read now, not later — the CM resets it on exit), and the
    keyword payload."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, getattr(conn, "in_tx", False), kw))
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


def _assert_rode_the_write(p, conn, in_tx):
    """The strengthened connection contract, in one place: the emitter was
    handed a connection acquire() actually lent — never the pool — and that
    connection's transaction was open at the moment of emission."""
    assert conn is not p, "the emitter was handed the pool, not a lent connection"
    assert conn in p.lent, "the emitter's connection was never lent by acquire()"
    assert in_tx, "the emitter ran outside the write's transaction"


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
    conn, in_tx, kw = em["invoice_created"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
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
    conn, in_tx, kw = em["invoice_created"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
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
    conn, in_tx, kw = em["invoice_created"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
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
    conn, in_tx, kw = em["invoice_created"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
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
    conn, in_tx, kw = em["invoice_created"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
    assert kw["invoice_id"] == "i1"
    # …and the billed flag rides the same connection (same transaction).
    assert any("UPDATE time_entries" in q for q, _ in conn.calls)


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
    conn, in_tx, kw = em["payment_recorded"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
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

    _, _, kw = em["payment_recorded"].calls[0]
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
    conn, in_tx, kw = em["invoice_paid"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
    # Both events ride the SAME connection — one write, one transaction.
    assert em["payment_recorded"].calls[0][0] is conn
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

def _match_rig(p, *, ledger="receipts", invoice_row=None, update_matched=True):
    p.fetchrow_responses = [
        ("SELECT id FROM staging.ganit_bank_statement_lines", {"id": "l1"}),
    ]
    if update_matched:
        # The guarded UPDATE (`... AND is_reconciled=FALSE RETURNING id`)
        # finds its row. Leave this out and the fake answers None — the
        # already-reconciled case.
        p.fetchrow_responses.append(
            ("UPDATE staging.ganit_bank_statement_lines", {"id": "l1"}))
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
    conn, in_tx, kw = em["invoice_paid"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
    assert any("UPDATE staging.ganit_bank_statement_lines" in q for q, _ in conn.calls), \
        "the event must ride the very connection that wrote the match"
    assert kw == {"org_id": "org1", "actor_id": "u1", "invoice_id": "i1",
                  "row": settled, "via": "reconciliation",
                  # Per INVOICE, not per receipt: the review found a
                  # 2-payment invoice announcing twice in one statement
                  # import — the (org_id, dedupe_key) unique index collapses
                  # every reconciliation repeat, across both doors.
                  "dedupe_key": "invoice.paid:reconciliation:i1"}


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


@pytest.mark.asyncio
async def test_re_matching_an_already_reconciled_line_is_a_409_and_emits_nothing(rig):
    """The transition guard: `... AND is_reconciled=FALSE` makes a repeat of
    the same match (double-click, retry, or a correction that skipped the
    unmatch step) match ZERO rows. A zero-row write is a refusal — 409, and
    no event, because nothing transitioned."""
    p, em = rig
    # The line exists, the payment is a receipt, no double-match clash — every
    # gate before the write passes. The guarded UPDATE itself answers None:
    # the line was already reconciled.
    _match_rig(p, ledger="receipts", update_matched=False)

    with pytest.raises(HTTPException) as exc:
        await ganit.match_bank_line("l1", "pay1", user={"user_id": "u1"}, org_id="org1")

    assert exc.value.status_code == 409
    assert "already reconciled" in exc.value.detail
    _assert_silent(em, *_EMITTERS)


# ── invoice.paid via reconciliation — the importer's auto-match door ──

def _import_rig(p, *, amount=59000, ledger="receipts", invoice_row=None):
    """One pasted statement line and one same-date/same-amount candidate in
    the scripted ledger, so `choose_bank_match` picks it unambiguously; the
    guarded auto-match UPDATE finds its row."""
    day = date(2026, 8, 1)
    cand = [{"id": "pay1" if ledger == "receipts" else "vp1",
             "amount": abs(amount), "payment_date": day}]
    p.fetch_responses = [
        # Order matters: both ledger queries name the statement-lines table in
        # their NOT IN subquery, so they must be dispatched before it.
        ("FROM staging.ganit_payments", cand if ledger == "receipts" else []),
        ("FROM staging.ganit_vendor_payments", cand if ledger == "vendor" else []),
        ("FROM staging.ganit_bank_statement_lines",
         [{"id": "l1", "amount": amount, "statement_date": day, "reference": "UTR1"}]),
    ]
    p.fetchrow_responses = [
        ("UPDATE staging.ganit_bank_statement_lines", {"id": "l1"}),
    ]
    if invoice_row is not None:
        p.fetchrow_responses.append(("FROM staging.ganit_invoices i", invoice_row))
    return ganit.BankStatementImport(lines=[
        ganit.BankStatementLine(statement_date="2026-08-01",
                                description="Receipt", amount=amount),
    ])


@pytest.mark.asyncio
async def test_auto_match_that_settles_an_invoice_emits_invoice_paid(rig):
    """The importer's door announces exactly like the manual one — same
    dedupe key, same conn-in-transaction ride — but the ATTRIBUTION differs:
    no person pressed Match, so the event carries no actor and
    source='import', even though a logged-in user drove the import."""
    p, em = rig
    settled = {**_INV_ROW, "total": 1000.0, "amount_paid": 1000.0,
               "balance_due": 0.0, "payment_status": "paid"}
    body = _import_rig(p, invoice_row=settled)

    out = await ganit.import_bank_statement(body, user={"user_id": "u1"}, org_id="org1")

    assert out["auto_matched"] == 1
    assert len(em["invoice_paid"].calls) == 1
    conn, in_tx, kw = em["invoice_paid"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
    assert any("UPDATE staging.ganit_bank_statement_lines" in q for q, _ in conn.calls), \
        "the event must ride the very connection that wrote the auto-match"
    assert kw == {"org_id": "org1", "actor_id": None, "invoice_id": "i1",
                  "row": settled, "via": "reconciliation", "source": "import",
                  # The SAME key as the manual door: an invoice settled by N
                  # payments, or matched once here and once by a person,
                  # announces ONCE.
                  "dedupe_key": "invoice.paid:reconciliation:i1"}


@pytest.mark.asyncio
async def test_auto_match_on_a_part_paid_invoice_emits_nothing(rig):
    """The auto-match itself succeeds — the line is reconciled — but the
    invoice re-read shows money still owed, so there is no 'paid'."""
    p, em = rig
    part_paid = {**_INV_ROW, "total": 1000.0, "amount_paid": 400.0,
                 "balance_due": 600.0, "payment_status": "partial"}
    body = _import_rig(p, invoice_row=part_paid)

    out = await ganit.import_bank_statement(body, user={"user_id": "u1"}, org_id="org1")

    assert out["auto_matched"] == 1, "the match must still land — only the event is withheld"
    _assert_silent(em, *_EMITTERS)


@pytest.mark.asyncio
async def test_auto_match_choosing_a_vendor_payment_emits_nothing(rig):
    """A debit line auto-matches a vendor payment — a bill being reconciled,
    not an invoice. No invoice lookup, no event."""
    p, em = rig
    body = _import_rig(p, amount=-25000, ledger="vendor")

    out = await ganit.import_bank_statement(body, user={"user_id": "u1"}, org_id="org1")

    assert out["auto_matched"] == 1
    _assert_silent(em, *_EMITTERS)
    assert not any("FROM staging.ganit_invoices i" in q for q, _ in p.calls), \
        "a vendor payment has no invoice to look up"


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
    conn, in_tx, kw = em["invoice_cancelled"].calls[0]
    _assert_rode_the_write(p, conn, in_tx)
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
