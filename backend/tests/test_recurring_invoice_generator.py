"""The recurring-invoice generator, which had never run successfully.

Its opening SELECT named EIGHT columns that do not exist on
staging.ganit_recurring — line_items (it is template_items), cgst/sgst/igst/cess
(there is one gst_rate), and discount/total/place_of_supply (not on the template
at all). asyncpg raises on the fetch, BEFORE the loop, so the per-row `except`
never saw it. The UPDATE that advances the schedule then set `updated_at`, which
that table also lacks.

It was reachable only through /cron/invoices, which imported a module that did
not exist and answered HTTP 200 — so nothing called it, and the moment the wire
was repaired the first thing it would do is raise.

WHAT THESE TESTS PIN, and why the column tests matter most: a mocked pool
resolves any column name you hand it, so an HTTP test would have passed against
the broken version too. The queries are therefore asserted against the REAL
column list, transcribed from information_schema and written out literally so
that widening one does not silently widen the check.
"""
from decimal import Decimal

import pytest

from services.skills.action import recurring_invoice_generator as G


# Transcribed from information_schema on 2026-08-05. Written out rather than
# derived, so a change to either side is a deliberate two-place edit.
RECURRING_COLUMNS = {
    "id", "org_id", "contact_id", "template_items", "subtotal", "gst_rate",
    "is_igst", "frequency", "next_date", "end_date", "auto_send", "notes",
    "terms", "is_active", "created_by", "created_at",
}


#: A complete org and contact, so the Rule 46 gate passes unless a test asks it
#: not to. Both GSTINs are structurally valid 15-character codes for state 27.
_ORG_OK = {
    "name": "Aekam Inc", "gstin": "27AABCU9603R1ZM", "pan": "AABCU9603R",
    "billing_address": {"state": "Maharashtra", "line1": "1 Test Road"},
}
_CONTACT_OK = {"name": "Kaveri Textiles", "company": "Kaveri Textiles Pvt Ltd",
               "gstin": "27AAACK5090R1Z8"}


class _Pool:
    """Dispatches on the QUERY, never on call order.

    It used to answer every `fetchrow` with `{"n": max_n}` — fine while the only
    fetchrow was the old digit-stripping allocator, and a trap the moment a
    second one appeared: adding the Rule 46 lookups would have fed the org query
    an invoice count. The e-sign fixture cost eight unrelated red tests learning
    exactly this, so this one asks what is being requested.

    `acquire()` and `transaction()` exist because `utils.next_doc_number` — the
    ONE allocator, which this generator now shares with the UI — takes an
    advisory lock inside a transaction.
    """

    def __init__(self, rows=None, last_number=None, org=None, contact=None):
        self.rows = rows or []
        self.last_number = last_number
        self.org = _ORG_OK if org is None else org
        self.contact = _CONTACT_OK if contact is None else contact
        self.fetched = []
        self.executed = []

    # ── asyncpg surface used by next_doc_number ──────────────────────────────
    def acquire(self):
        pool = self

        class _Conn:
            async def __aenter__(self_inner):
                return pool

            async def __aexit__(self_inner, *exc):
                return False

        return _Conn()

    def transaction(self):
        class _Txn:
            async def __aenter__(self_inner):
                return None

            async def __aexit__(self_inner, *exc):
                return False

        return _Txn()

    async def fetchval(self, sql, *a):
        q = " ".join(sql.split())
        self.fetched.append(q)
        if "pg_advisory_xact_lock" in q:
            return None
        if "invoice_number FROM staging.ganit_invoices" in q:
            return self.last_number
        return None

    async def fetch(self, sql, *a):
        self.fetched.append(" ".join(sql.split()))
        return self.rows

    async def fetchrow(self, sql, *a):
        q = " ".join(sql.split())
        self.fetched.append(q)
        if "staging.organisations" in q:
            return self.org
        if "staging.graha_contacts" in q:
            return self.contact
        return None

    async def execute(self, sql, *a):
        self.executed.append((" ".join(sql.split()), a))


def _rec(**kw):
    from datetime import date
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "contact_id": "22222222-2222-2222-2222-222222222222",
        "template_items": "[]", "subtotal": Decimal("1000.00"),
        "gst_rate": Decimal("18"), "is_igst": False, "frequency": "monthly",
        "next_date": date(2026, 8, 1), "end_date": None, "auto_send": False,
        "notes": None, "terms": None, "created_by": "user_a",
    }
    base.update(kw)
    return base


# ── The columns. This is the regression. ─────────────────────────────────────

def _columns_named(sql: str, table: str) -> set:
    """Bare identifiers in the SELECT list of a query over `table`."""
    import re
    body = sql[sql.upper().index("SELECT") + 6: sql.upper().index("FROM")]
    return {c.strip() for c in body.split(",") if re.fullmatch(r"[a-z_]+", c.strip())}


@pytest.mark.asyncio
async def test_the_select_names_only_columns_that_exist():
    """THE regression. Eight of these did not exist and the fetch raised."""
    pool = _Pool()
    await G.generate_due_invoices(pool, "org-1")
    select = next(q for q in pool.fetched if "ganit_recurring" in q and "SELECT" in q.upper())
    named = _columns_named(select, "ganit_recurring")
    missing = named - RECURRING_COLUMNS
    assert not missing, f"SELECT names columns ganit_recurring does not have: {sorted(missing)}"


@pytest.mark.asyncio
async def test_the_schedule_update_does_not_set_a_column_that_does_not_exist():
    """`updated_at` is not on ganit_recurring; setting it raised on the way out."""
    pool = _Pool([_rec()])
    await G.generate_due_invoices(pool, "org-1")
    upd = next(s for s, _ in pool.executed if "UPDATE staging.ganit_recurring" in s)
    assert "updated_at" not in upd


@pytest.mark.asyncio
async def test_an_expired_schedule_is_not_billed():
    """`end_date` was never looked at, so a finished agreement billed forever."""
    pool = _Pool()
    await G.generate_due_invoices(pool, "org-1")
    select = next(q for q in pool.fetched if "ganit_recurring" in q)
    assert "end_date" in select and "next_date <= end_date" in select


# ── The tax split, against doc_validation's own invariant ────────────────────

def _violates_doc_validation(a: dict, is_igst: bool) -> bool:
    """doc_validation.py:256-266 — IGST or CGST+SGST, never both."""
    if is_igst and (a["cgst"] > 0 or a["sgst"] > 0):
        return True
    if not is_igst and a["igst"] > 0:
        return True
    return False


@pytest.mark.parametrize("subtotal,rate", [
    ("1000.00", 18), ("1000.05", 18), ("333.33", 5), ("0.01", 28),
    ("99999.99", 12), ("1.00", 0),
])
def test_the_heads_always_sum_to_the_total(subtotal, rate):
    """
    `cgst + sgst` must equal the tax exactly, at every input. Two independently
    rounded halves do not: 18% of 1000.05 is 180.009, and halving twice gives
    180.00 or 180.02 against a total of 180.01. One paisa here fails a GSTR-1
    reconciliation months later.
    """
    a = G._split_tax(Decimal(subtotal), rate, False)
    tax = a["cgst"] + a["sgst"] + a["igst"] + a["cess"]
    assert a["subtotal"] + tax == a["total"]
    assert a["cgst"] + a["sgst"] == tax


@pytest.mark.parametrize("is_igst", [True, False])
def test_the_split_never_contradicts_itself(is_igst):
    a = G._split_tax(Decimal("1000.00"), 18, is_igst)
    assert not _violates_doc_validation(a, is_igst), (
        "the generated split is one doc_validation would refuse to print"
    )


def test_inter_state_puts_everything_in_igst():
    a = G._split_tax(Decimal("1000.00"), 18, True)
    assert a["igst"] == Decimal("180.00") and a["cgst"] == 0 and a["sgst"] == 0


def test_intra_state_halves_it():
    a = G._split_tax(Decimal("1000.00"), 18, False)
    assert a["cgst"] == Decimal("90.00") and a["sgst"] == Decimal("90.00") and a["igst"] == 0


# ── Numbering and behaviour ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_generated_number_continues_the_series_the_ui_is_writing():
    """
    THE TEST THAT WAS MISSING. The old one asserted 'INV-00043' against a fake
    seeded with max_n=42 — it verified this file's own private format against
    itself, so it stayed green while the format diverged from every other
    invoice in the product.

    This asserts against the SERIES INSTEAD. Given a live series at
    INV-2026-0149 — the real state of org 64e7bea6 on 2026-08-06 — the next
    number a firm's ledger can accept is INV-2026-0150. The old allocator
    stripped the hyphens, read 20260149, and minted INV-20260150, which is not
    a continuation of anything.
    """
    pool = _Pool([_rec()], last_number="INV-2026-0149")
    await G.generate_due_invoices(pool, "org-1")
    ins = next((s, a) for s, a in pool.executed if "INSERT INTO staging.ganit_invoices" in s)
    assert "INV-2026-0150" in ins[1]


@pytest.mark.asyncio
async def test_this_file_does_not_allocate_numbers_itself():
    """
    Two allocators over one column is the defect, not the format. A private
    SELECT here — MAX, COUNT, regexp_replace, any of them — reintroduces it
    whatever it spells the answer.
    """
    pool = _Pool([_rec()], last_number="INV-2026-0007")
    await G.generate_due_invoices(pool, "org-1")
    joined = " ".join(pool.fetched).upper()
    assert "REGEXP_REPLACE" not in joined
    assert "COUNT(*)" not in joined
    assert "MAX(" not in joined
    # And it went through the shared allocator, which is lock-protected.
    assert any("PG_ADVISORY_XACT_LOCK" in q.upper() for q, _ in pool.executed)


@pytest.mark.asyncio
async def test_one_bad_template_does_not_cost_the_org_its_whole_run():
    """Per-row except. The old SELECT was outside it, which is why it was fatal."""
    bad = _rec(id="bad", subtotal="not-a-number")
    pool = _Pool([bad, _rec()])
    out = await G.generate_due_invoices(pool, "org-1")
    assert out["generated"] == 1 and out["skipped"] == 1


@pytest.mark.asyncio
async def test_auto_send_is_counted_and_not_acted_on():
    """
    Generating is reversible; emailing a customer is not, and OUTBOUND_MODE is
    unset on production which outbound.py:148 reads as live. This job is about
    to go on a cron for the first time — its first tick must not mail anyone.
    """
    pool = _Pool([_rec(auto_send=True)])
    out = await G.generate_due_invoices(pool, "org-1")
    assert out["awaiting_send"] == 1
    import inspect
    src = inspect.getsource(G)
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert "send_email" not in code, "the generator now mails customers on a cron tick"


# ── Calendar months, the Rule 46 gate ────────────────────────────────────────

@pytest.mark.asyncio
async def test_monthly_is_a_calendar_month_and_not_thirty_days():
    """
    `timedelta(days=30)` gives a firm THIRTEEN invoices in a year and moves the
    billing date every month. The Generate-now button on the same schedule
    advances by a real month, so the two disagreed about what the customer
    signed.
    """
    from datetime import date
    pool = _Pool([_rec(next_date=date(2026, 1, 15), frequency="monthly")],
                 last_number="INV-2026-0001")
    await G.generate_due_invoices(pool, "org-1")
    upd = next(a for s, a in pool.executed if "UPDATE staging.ganit_recurring" in s)
    assert upd[1] == date(2026, 2, 15)


@pytest.mark.asyncio
async def test_twelve_monthly_ticks_land_on_the_same_day_one_year_on():
    """The count is the point: 30-day steps give 13 invoices and a drifting date."""
    from datetime import date
    d = date(2026, 3, 10)
    for _ in range(12):
        d = G._advance(d, "monthly")
    assert d == date(2027, 3, 10)


@pytest.mark.asyncio
async def test_the_thirty_first_clamps_to_the_end_of_a_shorter_month():
    """The question the old comment used to justify doing nothing. It has an answer."""
    from datetime import date
    assert G._advance(date(2026, 1, 31), "monthly") == date(2026, 2, 28)
    assert G._advance(date(2028, 1, 31), "monthly") == date(2028, 2, 29)   # leap
    assert G._advance(date(2026, 3, 31), "monthly") == date(2026, 4, 30)
    assert G._advance(date(2026, 12, 15), "quarterly") == date(2027, 3, 15)
    assert G._advance(date(2026, 2, 29) if False else date(2026, 6, 30), "yearly") \
        == date(2027, 6, 30)
    assert G._advance(date(2026, 6, 30), "weekly") == date(2026, 7, 7)


@pytest.mark.asyncio
async def test_an_incomplete_invoice_is_written_as_a_draft_not_a_final():
    """
    `ganit_invoices.doc_status` DEFAULTS TO 'final'. This job set no status at
    all, so a cron minted final tax invoices that `create_invoice` would have
    422'd and the PDF endpoint then refuses at download. A 3am job cannot show
    a gap list to anybody, so the invoice is kept — as a draft.
    """
    pool = _Pool([_rec()], last_number="INV-2026-0001", contact=None)
    out = await G.generate_due_invoices(pool, "org-1")
    ins = next(a for s, a in pool.executed if "INSERT INTO staging.ganit_invoices" in s)
    assert "draft" in ins
    assert "final" not in ins
    assert out["held_as_draft"] == 1
    # Kept, not dropped: a refused invoice would silently stop a firm's billing.
    assert out["generated"] == 1 and out["skipped"] == 0


#: One line, with an SAC code on it. `_rec()`'s default `template_items` is the
#: empty list, which Rule 46(g) correctly refuses — so a test that wants the
#: PASSING case has to supply a line, or it is asserting the failing one twice.
_LINE_OK = '[{"description": "Monthly retainer", "sac_code": "998311", '           '"quantity": 1, "rate": 1000.00, "amount": 1000.00}]'


@pytest.mark.asyncio
async def test_a_complete_invoice_is_still_born_final():
    """The gate has to let the ordinary case through, or it is just an outage."""
    pool = _Pool([_rec(template_items=_LINE_OK)], last_number="INV-2026-0001")
    out = await G.generate_due_invoices(pool, "org-1")
    ins = next(a for s, a in pool.executed if "INSERT INTO staging.ganit_invoices" in s)
    assert "final" in ins
    assert out["held_as_draft"] == 0


@pytest.mark.asyncio
async def test_the_insert_names_doc_status_at_all():
    """
    Without the column in the INSERT the default decides, and the default is
    'final'. This is the assertion that fails if somebody drops the parameter
    while leaving the branch logic above intact.
    """
    pool = _Pool([_rec(template_items=_LINE_OK)], last_number="INV-2026-0001")
    await G.generate_due_invoices(pool, "org-1")
    sql = next(s for s, _ in pool.executed if "INSERT INTO staging.ganit_invoices" in s)
    assert "doc_status" in sql
