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


class _Pool:
    def __init__(self, rows=None, max_n=0):
        self.rows = rows or []
        self.max_n = max_n
        self.fetched = []
        self.executed = []

    async def fetch(self, sql, *a):
        self.fetched.append(" ".join(sql.split()))
        return self.rows

    async def fetchrow(self, sql, *a):
        self.fetched.append(" ".join(sql.split()))
        return {"n": self.max_n}

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
async def test_the_invoice_number_comes_from_the_maximum_not_a_count():
    """
    There is a UNIQUE index on (org_id, invoice_number). COUNT(*) hands back a
    number already taken the moment any invoice is deactivated.
    """
    pool = _Pool([_rec()], max_n=42)
    await G.generate_due_invoices(pool, "org-1")
    ins = next((s, a) for s, a in pool.executed if "INSERT INTO staging.ganit_invoices" in s)
    assert "INV-00043" in ins[1]
    assert not any("COUNT(*)" in q.upper() for q in pool.fetched)


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
