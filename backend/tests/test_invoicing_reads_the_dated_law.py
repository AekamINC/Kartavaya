"""Phase 5.3 — the invoicing figures that were literals, and the dates they now
carry.

── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────

Two statutory figures on the invoicing and procurement side were Python
constants with no date attached to them:

  · `services/gstr1_json.py:B2CL_THRESHOLD` — ₹2,50,000, the invoice value above
    which an inter-state supply to an unregistered person is reported
    invoice-wise in GSTR-1 Table 5 rather than aggregated into Table 7. Measured
    live 2026-08-27 against the two in-scope orgs, it is load-bearing on real
    rows: E2E Test & Associates has 89 invoices above it and 174 below, Unicode
    Group 0 and 15. Its own comment said the rule "has moved before and can move
    again".
  · `services/purchase_orders.py:TDS_194Q_THRESHOLD` / `TDS_194Q_RATE` —
    ₹50,00,000 and 0.1%, the s.194Q per-seller threshold and the rate on the
    excess.

Neither existed in `staging.statute_calendar` at all. Measured live before any
change: 45 rows, of which 13 `tds.*` keys — and every one of those thirteen a
statement, certificate or deposit DATE. Not a threshold, not a rate. Exactly the
finding `test_payroll_reads_the_dated_law.py` recorded for the income-tax ladder
in 5.2b, on the other side of the product.

So the wiring could not come first. Migration 229 seeds the four rows
(`gst.b2cl.threshold`, `tds.194q.threshold`, `tds.194q.rate`,
`tds.194q.buyer_turnover_test`) with EXACTLY the values the constants already
held, and the readers below now prefer the row.

── THE TWO PROPERTIES THAT MATTER, AND THEY PULL AGAINST EACH OTHER ─────────

  1. A dated row must WIN. A threshold that changed on 1 April must apply to
     April and must not apply to March, and the anchor is the period the
     document covers — never the day somebody runs the export. Anchoring on
     `date.today()` is the whole defect `services/statute.py` exists to remove,
     and it is the one this file guards hardest, because it fails INVISIBLY:
     a July file re-exported in September would silently re-bucket.

  2. An absent row must DEGRADE, never refuse. This is the opposite of the
     payroll ladder's rule in 5.2b, deliberately, and the asymmetry is the point
     of `test_an_absent_row_never_refuses_and_never_zeroes`. A missing payroll
     ladder that fell back to a literal would deduct MONEY under last year's
     law. A missing B2CL row changes no tax at all — only which of two sections
     of the same return a supply is listed in, and the totals tie out either
     way. A missing 194Q row falling back to ZERO would be worse still: every
     vendor would read as past the threshold and the one that genuinely crossed
     would vanish into 75 false positives.

── THE LIVE HALF ────────────────────────────────────────────────────────────

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock answers
happily to a statement naming a column that does not exist. So the second half
of this file PARSES the statements against the real catalogue and READS BACK the
four seeded rows, which is the only way to prove the acceptance criterion —
"the GSTR builders and the 194Q watch agree with the dated store" — against the
store rather than against fixtures I wrote myself.

`prepare()` sends Parse and Describe and STOPS: the server plans the statement
and returns the shapes. It does not execute, does not read a row and does not
write one. Staging and production share one database (CLAUDE.md), so nothing
here writes.

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_invoicing_reads_the_dated_law.py -q
"""
import asyncio
import os
from datetime import date
from decimal import Decimal

import pytest

from services import gstr1_json as G
from services import purchase_orders as PO


ORG = "00000000-0000-4000-8000-00000000053a"

#: The two in-scope orgs, for the live half only.
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"
UNICODE_ORG = "fae87907-2f99-4b35-a241-c94d9e1e4a17"


# ══════════════════════════════════════════════════════════════════════════════
#  1 · A pool that answers statute lookups by key
# ══════════════════════════════════════════════════════════════════════════════

class _Pool:
    """Canned `statute_calendar` rows, filtered BY KEY the way the real SQL is.

    `services/statute.py` narrows on `obligation_key` in SQL and resolves the
    VERSION in Python. A mock that returned every seeded row for every lookup
    would make `_resolve` choose between facts about different obligations —
    `resolve_194q` asks for THREE keys in one call, and without this filter one
    fixture row would answer all three. `test_gst_year.py` records the same trap
    being sprung on the payroll suite.
    """

    def __init__(self, rows=(), invoices=(), org=None):
        self.rows = list(rows)
        self.invoices = list(invoices)
        self.org = org or {"gstin": "27AABCU9603R1ZM", "billing_address": {}}
        self.sql_seen: list[str] = []

    async def fetch(self, sql, *args):
        self.sql_seen.append(sql)
        if "statute_calendar" in sql:
            key = args[0] if args else None
            return [r for r in self.rows if r["obligation_key"] == key]
        return self.invoices

    async def fetchrow(self, sql, *args):
        self.sql_seen.append(sql)
        return dict(self.org)


class _ExplodingPool(_Pool):
    """The database is there and the read fails anyway.

    A transient failure on a REFERENCE table must not take a filing export or a
    threshold watch down with it. Nothing else in this file proves that the
    `except` is reachable rather than decorative.
    """

    async def fetch(self, sql, *args):
        if "statute_calendar" in sql:
            raise RuntimeError("connection reset by peer")
        return await super().fetch(sql, *args)


def _row(key, *, threshold=None, rate=None,
         effective_from=date(2017, 7, 1), effective_to=None, **kw):
    """One `statute_calendar` row in the shape `services/statute.py` returns."""
    out = {
        "obligation_key": key, "title": key, "authority": "gst",
        "statute": "CGST Rules 2017", "form_number": None,
        "section_ref": "rule 59(1)", "periodicity": "standing",
        "due_day": None, "due_month": None, "due_month_offset": None,
        "window_days": None, "rate_percent": rate, "threshold_amount": threshold,
        "state_code": None, "effective_from": effective_from,
        "effective_to": effective_to, "effective_from_exact": True,
        "source_ref": "a notification", "notes": "", "verified_on": date(2026, 8, 27),
    }
    out.update(kw)
    return out


def _invoice(**kw):
    """An inter-state supply to an UNREGISTERED person — the only shape whose
    section the B2CL threshold decides."""
    row = {
        "invoice_number": "INV-2026-0001",
        "invoice_type": "tax_invoice",
        "invoice_date": date(2026, 7, 15),
        "place_of_supply": "27",
        "contact_gstin": None,               # unregistered — so b2cl or b2cs
        "is_igst": True,                     # inter-state
        "is_export": False,
        "currency": "INR",
        "subtotal": Decimal("300000.00"),
        "cgst": Decimal("0.00"), "sgst": Decimal("0.00"),
        "igst": Decimal("54000.00"), "cess": Decimal("0.00"),
        "total": Decimal("354000.00"),
        "doc_status": "final", "payment_status": "unpaid",
        "cancelled_at": None, "is_active": True,
        "line_items": [{
            "description": "Consulting", "hsn_code": "998311", "quantity": 1,
            "unit": "NOS", "gst_rate": 18, "line_total": 300000,
            "gst_amount": 54000,
        }],
    }
    row.update(kw)
    return row


ORG_ROW = {"gstin": "24AABCU9603R1ZM", "billing_address": {"state": "Gujarat"}}


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The anchor. The single most dangerous thing in this change.
# ══════════════════════════════════════════════════════════════════════════════

def test_the_threshold_is_read_as_of_the_period_end_not_today():
    """`2026-07` resolves as of 31 July 2026 — the last day the return covers.

    `services/statute.py` states the rule in its own docstring: THE ANCHOR IS
    THE DATE OF THE PAYMENT OR THE PERIOD THE DOCUMENT COVERS, NEVER THE DATE
    YOU ARE FILING ON. A GSTR-1 for July is prepared in August or later, so a
    lookup anchored on the run date would read August's law onto July's
    invoices — and would change the answer every time the file was re-exported.
    """
    assert G.period_last_day("2026-07") == date(2026, 7, 31)
    assert G.period_last_day("2026-02") == date(2026, 2, 28)     # not clamped to 30
    assert G.period_last_day("2024-02") == date(2024, 2, 29)     # leap year
    assert G.period_last_day("2026-12") == date(2026, 12, 31)    # rolls the year


@pytest.mark.asyncio
async def test_a_threshold_that_changed_mid_year_does_not_reach_back():
    """The version in force in July applies to July; the successor does not.

    This is the property a literal cannot express at all, and it is why the
    figure moved. Two versions of one key, split on 1 August: July must answer
    ₹2,50,000 and August ₹1,00,000, off the same two rows.
    """
    rows = [
        _row("gst.b2cl.threshold", threshold=Decimal("250000"),
             effective_from=date(2017, 7, 1), effective_to=date(2026, 8, 1)),
        _row("gst.b2cl.threshold", threshold=Decimal("100000"),
             effective_from=date(2026, 8, 1)),
    ]
    pool = _Pool(rows=rows)

    july, _ = await G.resolve_b2cl_threshold(pool, G.period_last_day("2026-07"))
    august, _ = await G.resolve_b2cl_threshold(pool, G.period_last_day("2026-08"))

    assert july == Decimal("250000")
    assert august == Decimal("100000")


@pytest.mark.asyncio
async def test_the_dated_row_actually_moves_the_invoice_between_sections():
    """Not just the number — the FILE. A ₹3,54,000 supply is b2cs under the old
    threshold and b2cl under the new one, and nothing else about it changes.

    Resolving a different figure and then bucketing on the old one would be a
    green test over a dead wire, which is the failure mode this whole phase is
    a response to.
    """
    invoice = _invoice(total=Decimal("354000.00"))

    payload_old, manifest_old = G.build_gstr1(
        [invoice], ORG_ROW, "2026-07",
        b2cl_threshold=Decimal("400000"), b2cl_threshold_source="test")
    payload_new, manifest_new = G.build_gstr1(
        [invoice], ORG_ROW, "2026-07",
        b2cl_threshold=Decimal("100000"), b2cl_threshold_source="test")

    assert "b2cl" not in payload_old and "b2cs" in payload_old
    assert "b2cl" in payload_new and "b2cs" not in payload_new
    assert manifest_old["b2cl_count"] == 0
    assert manifest_new["b2cl_count"] == 1
    # The threshold moved the row between sections and changed no tax.
    assert (manifest_old["reconciliation"]["reported_tax"]
            == manifest_new["reconciliation"]["reported_tax"])


# ══════════════════════════════════════════════════════════════════════════════
#  3 · Degradation. An absent row must never stop an export.
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_an_absent_row_falls_back_to_the_literal_and_says_which():
    """No row → the built-in figure, and a `source` that names the key it
    looked for and the date it looked on.

    "It fell back" is not a detail to bury. A preparer comparing this month's
    manifest with last month's has no other way to tell that the BUCKETING rule
    changed, because the totals tie out either way.
    """
    value, source = await G.resolve_b2cl_threshold(_Pool(rows=[]), date(2026, 7, 31))

    assert value == G.B2CL_THRESHOLD == Decimal("250000.00")
    assert "built-in default" in source
    assert G.B2CL_THRESHOLD_KEY in source
    assert "2026-07-31" in source


@pytest.mark.asyncio
async def test_a_failed_statute_read_does_not_take_the_export_down():
    """The reference table is unreachable; the file is still built.

    An export that refuses because a REFERENCE row could not be read is worse
    than one that carries on with the behaviour it has always had — the firm is
    filing on the 10th and has no file at all.
    """
    value, source = await G.resolve_b2cl_threshold(
        _ExplodingPool(rows=[]), date(2026, 7, 31))

    assert value == G.B2CL_THRESHOLD
    assert "built-in default" in source


@pytest.mark.asyncio
async def test_a_row_with_a_null_threshold_is_not_read_as_zero():
    """A row that exists but records no figure is an ABSENT figure.

    Migration 170's discipline is that an unverified field is NULL rather than
    guessed, so rows with a NULL `threshold_amount` are normal and expected.
    Reading NULL as 0 would put every supply in b2cl.
    """
    pool = _Pool(rows=[_row("gst.b2cl.threshold", threshold=None)])
    value, source = await G.resolve_b2cl_threshold(pool, date(2026, 7, 31))

    assert value == G.B2CL_THRESHOLD
    assert "built-in default" in source


def test_the_builder_without_a_threshold_behaves_exactly_as_before():
    """Every existing caller and every existing test passes no threshold. They
    must all keep working, and on the same number."""
    _payload, manifest = G.build_gstr1([_invoice()], ORG_ROW, "2026-07")
    assert Decimal(str(manifest["b2cl_threshold"])) == G.B2CL_THRESHOLD


# ══════════════════════════════════════════════════════════════════════════════
#  4 · The 194Q watch
# ══════════════════════════════════════════════════════════════════════════════

def _194q_rows(threshold="5000000", rate="0.100", buyer="100000000"):
    out = []
    if threshold is not None:
        out.append(_row("tds.194q.threshold", threshold=Decimal(threshold),
                        effective_from=date(2021, 7, 1), authority="income_tax"))
    if rate is not None:
        out.append(_row("tds.194q.rate", rate=Decimal(rate),
                        effective_from=date(2021, 7, 1), authority="income_tax"))
    if buyer is not None:
        out.append(_row("tds.194q.buyer_turnover_test", threshold=Decimal(buyer),
                        effective_from=date(2021, 7, 1), authority="income_tax"))
    return out


@pytest.mark.asyncio
async def test_the_rate_is_a_percent_in_the_table_and_a_fraction_in_the_code():
    """0.100 in `rate_percent` is 0.1 PERCENT, which is the fraction 0.001.

    A factor of 100 applied in two places is a factor of 100 applied twice
    somewhere, so the conversion happens once, in `resolve_194q`. Getting it
    wrong by a factor of 100 in this direction would overstate an indicative
    TDS figure by a hundredfold on a screen a firm's accountant reads.
    """
    law = await PO.resolve_194q(_Pool(rows=_194q_rows()), date(2026, 4, 1))

    assert law["rate"] == pytest.approx(0.001)
    assert law["rate"] == pytest.approx(PO.TDS_194Q_RATE)
    assert law["threshold"] == 5_000_000.0
    assert law["buyer_turnover_test"] == 100_000_000.0
    assert "statute_calendar" in law["source"]
    assert law["as_of"] == "2026-04-01"


@pytest.mark.asyncio
async def test_an_absent_row_never_refuses_and_never_zeroes():
    """THE ASYMMETRY WITH 5.2b, AND WHY IT IS DELIBERATE.

    An absent payroll ladder must deduct ₹0 — falling back to a literal would
    take MONEY off a payslip under the wrong year's law. An absent 194Q
    threshold must NOT become 0: a zero threshold makes every vendor "crossed",
    so a firm opening this watch sees all 75 of its vendors flagged and the one
    that genuinely crossed is invisible. This is a warning surface, and a
    warning surface that cries wolf is off.
    """
    law = await PO.resolve_194q(_Pool(rows=[]), date(2026, 4, 1))

    assert law["threshold"] == float(PO.TDS_194Q_THRESHOLD) == 5_000_000.0
    assert law["rate"] == PO.TDS_194Q_RATE
    assert law["buyer_turnover_test"] is None
    assert "built-in defaults" in law["source"]
    assert PO.TDS_194Q_THRESHOLD_KEY in law["source"]


@pytest.mark.asyncio
async def test_half_a_ladder_is_reported_as_half_a_ladder():
    """The threshold is recorded and the rate is not. The answer says so
    rather than presenting a mixed pair as though both came from the table."""
    pool = _Pool(rows=_194q_rows(rate=None, buyer=None))
    law = await PO.resolve_194q(pool, date(2026, 4, 1))

    assert law["threshold"] == 5_000_000.0
    assert law["rate"] == PO.TDS_194Q_RATE
    assert PO.TDS_194Q_THRESHOLD_KEY in law["source"]
    assert "built-in default" in law["source"]
    assert PO.TDS_194Q_RATE_KEY in law["source"]


@pytest.mark.asyncio
async def test_a_failed_194q_lookup_leaves_the_watch_working():
    law = await PO.resolve_194q(_ExplodingPool(rows=_194q_rows()), date(2026, 4, 1))
    assert law["threshold"] == float(PO.TDS_194Q_THRESHOLD)
    assert "built-in defaults" in law["source"]


def test_a_zero_threshold_does_not_flag_every_vendor():
    """A calendar row seeded at 0 is a data defect. The honest response is the
    figure that has always worked, not 75 false positives and a ZeroDivisionError
    on `pct_of_threshold`."""
    row = PO.tds_194q_row("Acme", 100.0, 0.0, threshold=0.0, rate=0.001)

    assert row["crossed"] is False
    assert row["threshold"] == float(PO.TDS_194Q_THRESHOLD)
    assert row["pct_of_threshold"] == pytest.approx(0.0, abs=0.05)


def test_a_dated_threshold_moves_the_verdict_and_the_indicative_figure():
    """₹60 lakh purchased: crossed under ₹50 lakh, not crossed under ₹1 crore,
    and `indicative_tds` is computed on the EXCESS in both cases."""
    crossed = PO.tds_194q_row("Acme", 6_000_000, 0, threshold=5_000_000, rate=0.001)
    clear = PO.tds_194q_row("Acme", 6_000_000, 0, threshold=10_000_000, rate=0.001)

    assert crossed["crossed"] is True
    assert crossed["indicative_tds"] == pytest.approx((6_000_000 - 5_000_000) * 0.001)
    assert clear["crossed"] is False
    assert clear["indicative_tds"] == 0


def test_the_row_builder_without_a_threshold_behaves_exactly_as_before():
    row = PO.tds_194q_row("Acme", 6_000_000, 0)
    assert row["threshold"] == float(PO.TDS_194Q_THRESHOLD)
    assert row["indicative_tds"] == pytest.approx(
        (6_000_000 - PO.TDS_194Q_THRESHOLD) * PO.TDS_194Q_RATE)


def test_the_warn_fraction_is_not_in_the_calendar():
    """80% is a product decision about when to start warning, not a fact about
    the Income-tax Act. Putting it in a table of dated law would make it look
    like one, and somebody would eventually cite it."""
    assert PO.TDS_194Q_WARN_AT == 0.80
    assert not hasattr(PO, "TDS_194Q_WARN_AT_KEY")


# ══════════════════════════════════════════════════════════════════════════════
#  5 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the statute lookups and the two "
    "queries they sit beside against the real catalogue, and reads back the "
    "four rows migration 229 seeded — a MagicMock pool answers happily to a "
    "statement naming a column that does not exist, and would answer happily "
    "with rows the store does not hold. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_invoicing_reads_the_dated_law.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _statements() -> list[tuple[str, str]]:
    """(label, sql) for every statement this change causes to be issued.

    Taken from the modules themselves rather than retyped. A copy of the SQL in
    a test file proves the copy parses.
    """
    from services.statute import _SELECT_BY_KEY, _SELECT_LISTING
    import routers.documents as documents

    out = [
        # The lookup EVERY wiring in this change executes.
        ("statute.obligation", _SELECT_BY_KEY),
        ("statute.obligations", _SELECT_LISTING),
        # The GSTR-1 fetch that `_build_gstr1` issues around it.
        ("gstr1.invoices",
         f"SELECT {documents._GSTR1_COLS} "
         "FROM staging.ganit_invoices i "
         "LEFT JOIN staging.graha_contacts c ON c.id = i.contact_id "
         "WHERE i.org_id=$1::uuid AND i.is_active "
         "AND i.invoice_date >= $2::text::date AND i.invoice_date < $3::text::date "
         "ORDER BY i.invoice_date, i.invoice_number"),
        ("gstr1.org",
         f"SELECT {__import__('services.gst_period', fromlist=['_ORG_COLS'])._ORG_COLS} "
         "FROM staging.organisations WHERE id=$1::uuid"),
        # The 194Q vendor position the resolved threshold is applied to.
        ("194q.vendors", """
        SELECT v.id, v.name, v.tds_section,
               NULLIF(btrim(v.email), '') AS vendor_email,
               NULLIF(btrim(v.phone), '') AS vendor_phone,
               COALESCE((SELECT SUM(b.total) FROM staging.ganit_vendor_bills b
                          WHERE b.vendor_id = v.id AND b.org_id = v.org_id
                            AND b.is_active AND b.bill_date >= $2::date), 0)
                   AS purchased_ytd,
               COALESCE((SELECT SUM(po.total)
                           FROM staging.ganit_purchase_orders po
                          WHERE po.vendor_id = v.id AND po.org_id = v.org_id
                            AND po.is_active
                            AND po.status = ANY($3::text[])), 0)
                   AS on_order
        FROM staging.ganit_vendors v
        WHERE v.org_id = $1::uuid AND v.is_active
        ORDER BY v.name
        LIMIT $4::int
        """),
    ]
    return out


def _probe():
    """Parse and Describe every statement, then READ the four seeded rows.

    Nothing is executed but SELECTs. `prepare()` plans and describes and stops;
    the two `fetch` calls at the end are read-only reference reads. No row is
    written, in either schema.
    """
    import asyncpg
    from services.statute import obligation

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for label, sql in _statements():
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((label, f"{type(exc).__name__}: {exc}"))

            # The store, read through the same resolver the product uses.
            as_of = date(2026, 8, 27)
            resolved = {
                key: await obligation(conn, key, as_of=as_of)
                for key in (G.B2CL_THRESHOLD_KEY, PO.TDS_194Q_THRESHOLD_KEY,
                            PO.TDS_194Q_RATE_KEY, PO.TDS_194Q_BUYER_TEST_KEY)
            }
            b2cl_live, _ = await G.resolve_b2cl_threshold(conn, as_of)
            law_live = await PO.resolve_194q(conn, as_of)
            return failures, resolved, b2cl_live, law_live
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    try:
        return _probe()
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked."""
    failures, *_ = live
    assert not failures, "\n".join(f"{label}: {err}" for label, err in failures)


def test_the_four_seeded_rows_exist_and_resolve(live):
    """Migration 229, verified from the catalogue rather than from the file.

    An inline CHECK on `ADD COLUMN IF NOT EXISTS` is skipped whole when the
    column exists, so this repo's rule is that the migration file is never the
    evidence. The same applies to an INSERT with ON CONFLICT DO NOTHING: it
    reports success having inserted nothing at all.
    """
    _failures, resolved, *_ = live
    missing = [key for key, row in resolved.items() if row is None]
    assert not missing, (
        f"{missing} resolve to nothing as of 2026-08-27. Apply "
        f"backend/migrations/229_statute_invoicing_thresholds.sql.")


def test_the_gstr_builder_agrees_with_the_dated_store(live):
    """PHASE 5.3'S ACCEPTANCE, half one — against the store, not a fixture."""
    _failures, resolved, b2cl_live, _law = live
    assert b2cl_live == Decimal(str(resolved[G.B2CL_THRESHOLD_KEY]["threshold_amount"]))
    # And it is still the figure the file has always used, so seeding the row
    # moved the fact without moving the number.
    assert b2cl_live == G.B2CL_THRESHOLD


def test_the_194q_watch_agrees_with_the_dated_store(live):
    """PHASE 5.3'S ACCEPTANCE, half two."""
    _failures, resolved, _b2cl, law = live
    assert law["threshold"] == float(resolved[PO.TDS_194Q_THRESHOLD_KEY]["threshold_amount"])
    assert law["rate"] == pytest.approx(
        float(resolved[PO.TDS_194Q_RATE_KEY]["rate_percent"]) / 100.0)
    assert law["buyer_turnover_test"] == float(
        resolved[PO.TDS_194Q_BUYER_TEST_KEY]["threshold_amount"])
    assert "statute_calendar" in law["source"]
    # Unchanged from the literals, for the same reason as above.
    assert law["threshold"] == float(PO.TDS_194Q_THRESHOLD)
    assert law["rate"] == pytest.approx(PO.TDS_194Q_RATE)


def test_the_seeded_rows_carry_no_deadline(live):
    """All four are `standing` — a rule in force, not a due date.

    `/api/v1/statute/due` excludes `standing` BY CONSTRUCTION, so this is what
    stops a threshold appearing on a due-dates screen as though a firm had to
    file something by it. 18 of the original 45 rows are the same shape and the
    router's own comment names the ESI ceiling as the case it must not print.
    """
    _failures, resolved, *_ = live
    for key, row in resolved.items():
        assert row["periodicity"] == "standing", key
        assert row["due_day"] is None, key
        assert row["due_month"] is None, key
