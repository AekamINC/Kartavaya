"""Phase 5.2b — the income-tax ladder as data, and the three things it must never do.

`tests/test_payroll_reads_the_dated_law.py` recorded why TDS stayed literal when
the ESI ceiling came out: of the thirteen `tds.*` keys in `statute_calendar`,
every one is a statement, a certificate or a deposit DATE. **The slab ladder was
not in the database at all.** Migration 228 puts it there, one row per band, on
the owner's instruction of 2026-08-26; `services/income_tax.py` reads it and
`routers/income_tax_slabs.py` lets somebody set it.

WHAT THIS FILE PINS, AND WHY EACH ONE IS A SEPARATE SECTION
-----------------------------------------------------------
1 · THE ARITHMETIC IS THE STATUTE'S. Every expected figure below is the
    Income Tax Department's OWN cumulative constant — its AY 2026-27 table reads
    "₹20,000 + 10% above ₹8,00,000", "₹60,000 + 15% above ₹12,00,000",
    "₹1,20,000 + 20% above ₹16,00,000", "₹2,00,000 + 25% above ₹20,00,000",
    "₹3,00,000 + 30% above ₹24,00,000", and the old-regime table reads "₹12,500
    + 20% above ₹5,00,000" and "₹1,12,500 + 30% above ₹10,00,000". A marginal
    computation over the seeded bands must reproduce those constants exactly at
    the band boundaries. They are checked against the DEPARTMENT'S numbers
    rather than against numbers re-derived here, because a test that
    re-implements the thing it is testing passes whatever the product does.

2 · IT NEVER REFUSES. No ladder, an unreadable rate, a regime nobody seeded, an
    unreachable database — every one of them is ₹0 and the run continues. Same
    rule as an absent professional-tax slab, same owner decision behind it.

3 · AND IT NEVER FALLS BACK TO A LITERAL. This is the one 5.2b exists for.
    `_esi_ceiling` returns None and the caller keeps the statutory 21,000 —
    correct there, because "no ceiling" would WIDEN a deduction. That asymmetry
    does NOT carry over: a missing income-tax ladder that quietly reverted to a
    compiled-in one would apply the WRONG YEAR'S LAW and look perfectly correct
    on the payslip. Section 3 greps the module to prove no ladder is written
    into it, which is the only check that survives somebody "helpfully" adding
    a default.

4 · THE GENERATION IS THE UNIT. PT resolves a band; this resolves a whole
    ladder. Mixing FY 2024-25's ₹7,00,000 step with FY 2025-26's ₹8,00,000 one
    would produce a ladder no Finance Act enacted and every band of it would
    look individually defensible.

5 · LIVE, against the real catalogue: Parse and Describe every statement the
    router issues, read the seeded rows back from the table rather than from the
    migration file, and resolve the ladder for both in-scope organisations.

NOTHING HERE WRITES ANYTHING. Staging and production share one Supabase
database (CLAUDE.md, "The one dangerous fact"), so the org-scoped rows in the
override tests are built IN PYTHON on top of the real shared rows — which
proves the ordering over real data without a single INSERT.

    railway run -e staging -s Kartavya -- \
        python -m pytest tests/test_income_tax_ladder.py -q
"""
from collections.abc import Mapping
import asyncio
import os
import pathlib
import re
from datetime import date

import pytest

from services import income_tax
import routers.income_tax_slabs as it_router

# ── The two in-scope organisations (docs/plans/README.md). ───────────────────
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"      # Maharashtra '27'
UNICODE_ORG = "fae87907-2f99-4b35-a241-c94d9e1e4a17"  # Gujarat '24'
OTHER_ORG = "22222222-2222-2222-2222-222222222222"

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. The live half PARSES the router's SQL against the real "
    "catalogue and reads the seeded ladder back from it — a MagicMock pool "
    "answers happily to a column that does not exist, which is exactly how "
    "`gst_rate` survived in client_billing.py. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_income_tax_ladder.py -q"
)

#: The seeded ladders, as migration 228 writes them. `(slab_from, slab_to,
#: rate)`. Restated here so that the live half compares the CATALOGUE against a
#: statement of intent, rather than comparing the catalogue with itself.
SEEDED = {
    ("new", date(2023, 4, 1)): [
        (0, 300000, 0), (300000, 600000, 5), (600000, 900000, 10),
        (900000, 1200000, 15), (1200000, 1500000, 20), (1500000, None, 30),
    ],
    ("new", date(2024, 4, 1)): [
        (0, 300000, 0), (300000, 700000, 5), (700000, 1000000, 10),
        (1000000, 1200000, 15), (1200000, 1500000, 20), (1500000, None, 30),
    ],
    ("new", date(2025, 4, 1)): [
        (0, 400000, 0), (400000, 800000, 5), (800000, 1200000, 10),
        (1200000, 1600000, 15), (1600000, 2000000, 20), (2000000, 2400000, 25),
        (2400000, None, 30),
    ],
    ("old", date(2017, 4, 1)): [
        (0, 250000, 0), (250000, 500000, 5), (500000, 1000000, 20),
        (1000000, None, 30),
    ],
}


def bands(key, *, is_own=False, eff=None):
    """One generation, shaped exactly as `ladders()` returns it."""
    regime, seeded_eff = key
    return [
        {"regime": regime, "slab_from": lo, "slab_to": hi, "rate_percent": rate,
         "effective_from": eff or seeded_eff, "assessment_year": None,
         "source_ref": None, "is_own": is_own}
        for lo, hi, rate in SEEDED[key]
    ]


NEW_2026 = ("new", date(2025, 4, 1))
NEW_2025 = ("new", date(2024, 4, 1))
NEW_2024 = ("new", date(2023, 4, 1))
OLD = ("old", date(2017, 4, 1))


# ══════════════════════════════════════════════════════════════════════════
#  1 · THE ARITHMETIC IS THE STATUTE'S — the Department's own constants
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("income,expected", [
    (0,        0),
    (400000,   0),          # the whole nil band
    (800000,   20000),      # "5% above ₹4,00,000"        → ₹20,000 at the step
    (1200000,  60000),      # "₹20,000 + 10% above ₹8,00,000"
    (1600000,  120000),     # "₹60,000 + 15% above ₹12,00,000"
    (2000000,  200000),     # "₹1,20,000 + 20% above ₹16,00,000"
    (2400000,  300000),     # "₹2,00,000 + 25% above ₹20,00,000"
    (3000000,  480000),     # "₹3,00,000 + 30% above ₹24,00,000"
])
def test_the_new_regime_reproduces_the_departments_own_cumulative_figures(
        income, expected):
    """Every expected value here is printed on the Income Tax Department's
    AY 2026-27 slab table as a cumulative constant. If a marginal walk over the
    seeded bands does not land on them exactly, the bands are wrong — and a
    band that is wrong takes money off somebody's pay."""
    tax, _ = income_tax.annual_tax(bands(NEW_2026), income)
    assert tax == expected


@pytest.mark.parametrize("income,expected", [
    (250000,   0),
    (500000,   12500),      # "₹12,500 + 20% above ₹5,00,000"
    (1000000,  112500),     # "₹1,12,500 + 30% above ₹10,00,000"
    (1500000,  262500),
])
def test_the_old_regime_reproduces_the_departments_own_cumulative_figures(
        income, expected):
    tax, _ = income_tax.annual_tax(bands(OLD), income)
    assert tax == expected


def test_a_figure_inside_a_band_is_taxed_marginally_not_wholesale():
    """₹9,00,000 under AY 2026-27 is ₹20,000 on the 5% band plus ₹10,000 on the
    ₹1,00,000 that crossed into the 10% one. A ladder that charged 10% on the
    whole ₹9,00,000 would be a flat tax with steps, which is what a
    band-containment reading of this table would produce."""
    tax, _ = income_tax.annual_tax(bands(NEW_2026), 900000)
    assert tax == 30000.0


def test_the_workings_name_every_band_that_contributed():
    """A deduction an employee disputes must be answerable from the payslip, not
    from a re-run. `pt_slab` is already on the payslip for the same reason."""
    tax, workings = income_tax.annual_tax(bands(NEW_2026), 900000)
    assert [w["rate_percent"] for w in workings] == [0, 5, 10]
    assert [w["taxable_in_band"] for w in workings] == [400000.0, 400000.0, 100000.0]
    assert [w["tax_in_band"] for w in workings] == [0.0, 20000.0, 10000.0]
    assert round(sum(w["tax_in_band"] for w in workings), 2) == tax


def test_bands_above_the_income_are_not_listed_in_the_workings():
    """Empty rows on a payslip are noise that makes the real ones harder to
    read."""
    _, workings = income_tax.annual_tax(bands(NEW_2026), 500000)
    assert [w["rate_percent"] for w in workings] == [0, 5]


def test_the_monthly_figure_is_the_annual_one_over_twelve():
    tax, _ = income_tax.annual_tax(bands(NEW_2026), 3000000)
    assert income_tax.monthly_tds(bands(NEW_2026), 3000000) == round(tax / 12, 2)


# ══════════════════════════════════════════════════════════════════════════
#  2 · IT NEVER REFUSES — every unanswerable question is ₹0
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("ladder", [None, [], ()])
def test_an_absent_ladder_deducts_zero_and_does_not_raise(ladder):
    """THE GUARDRAIL, in the plainest possible form. An absent ladder must
    behave like an absent PT slab: deduct ₹0, never refuse the run."""
    assert income_tax.annual_tax(ladder, 5000000) == (0.0, [])
    assert income_tax.monthly_tds(ladder, 5000000) == 0.0


@pytest.mark.parametrize("income", [None, "", "not a number", -1, 0])
def test_an_unreadable_income_is_zero_rather_than_an_exception(income):
    assert income_tax.annual_tax(bands(NEW_2026), income)[0] == 0.0


def test_an_unreadable_band_is_skipped_and_the_rest_still_apply():
    """`_pt_from_slabs` skips a row it cannot read rather than dying; so does
    this. A ladder with one corrupt row must still tax the other bands."""
    corrupt = bands(NEW_2026) + [
        {"regime": "new", "slab_from": "eight hundred thousand",
         "slab_to": None, "rate_percent": 40, "effective_from": date(2025, 4, 1),
         "assessment_year": None, "source_ref": None, "is_own": False},
    ]
    assert income_tax.annual_tax(corrupt, 800000)[0] == 20000.0


def test_a_missing_column_on_a_band_is_skipped_rather_than_fatal():
    assert income_tax.annual_tax([{"slab_from": 0}], 800000) == (0.0, [])


def test_a_misspelled_regime_gets_no_ladder_rather_than_the_other_one():
    """Falling through to 'new' would tax somebody under a regime they did not
    choose, AND IT WOULD LOOK CORRECT — which is worse than deducting nothing
    and being asked why."""
    by_regime = {"new": bands(NEW_2026), "old": bands(OLD)}
    assert income_tax.ladder_for(by_regime, "nwe") == []
    assert income_tax.ladder_for(by_regime, "OLD") == bands(OLD)


@pytest.mark.parametrize("unset", [None, "", "   "])
def test_an_unanswered_regime_takes_the_statutory_default(unset):
    """An unanswered column is not a misconfiguration. `routers/vetana.py`
    already reads `str(structure.get("tds_regime") or "new")`, and the Finance
    Act 2023 made the new regime the default from AY 2024-25 — so the two
    places agree rather than each choosing."""
    by_regime = {"new": bands(NEW_2026), "old": bands(OLD)}
    assert income_tax.ladder_for(by_regime, unset) == bands(NEW_2026)


def test_no_ladders_at_all_is_an_empty_list_not_a_KeyError():
    assert income_tax.ladder_for({}, "new") == []
    assert income_tax.ladder_for(None, "new") == []


@pytest.mark.asyncio
async def test_an_unreadable_table_returns_no_ladders_rather_than_raising():
    """A payroll run must not stop because a reference table is unreachable —
    and this is also the deploy-order safety net: if the backend ships before
    migration 228 is applied, every statement raises UndefinedTableError and
    this is what stands between that and a 500 on every payslip."""
    class Exploding:
        async def fetch(self, *a, **k):
            raise RuntimeError("relation staging.pay_income_tax_slabs does not exist")

    assert await income_tax.ladders(Exploding(), E2E_ORG, date(2026, 8, 31)) == {}


def test_an_overlap_charges_the_slice_once_rather_than_twice():
    """A gap silently untaxes a slice; an OVERLAP would charge it twice, which
    is the worse of the two and the one the clamp removes. Two bands both
    claiming ₹4–8 lakh must cost what one of them costs."""
    doubled = bands(NEW_2026) + [
        {"regime": "new", "slab_from": 400000, "slab_to": 800000,
         "rate_percent": 5, "effective_from": date(2025, 4, 1),
         "assessment_year": None, "source_ref": None, "is_own": False},
    ]
    assert income_tax.annual_tax(doubled, 800000)[0] == 20000.0


def test_a_gap_is_untaxed_rather_than_fatal_and_is_reported():
    holed = [b for b in bands(NEW_2026) if b["slab_from"] != 400000]
    tax, _ = income_tax.annual_tax(holed, 800000)
    assert tax == 0.0
    kinds = {a["kind"] for a in income_tax.gaps_and_overlaps(holed)}
    assert "gap" in kinds


def test_a_correct_ladder_reports_nothing_to_fix():
    assert income_tax.gaps_and_overlaps(bands(NEW_2026)) == []
    assert income_tax.gaps_and_overlaps(bands(OLD)) == []


def test_a_ladder_with_no_open_top_band_says_so():
    """Salary above the highest band would otherwise be silently untaxed."""
    capped = [dict(b) for b in bands(NEW_2026)]
    capped[-1]["slab_to"] = 5000000
    assert any(a["kind"] == "capped"
               for a in income_tax.gaps_and_overlaps(capped))


# ══════════════════════════════════════════════════════════════════════════
#  3 · AND IT NEVER FALLS BACK TO A LITERAL
# ══════════════════════════════════════════════════════════════════════════

_MODULE = pathlib.Path(income_tax.__file__)

#: Every rupee figure that has ever appeared in one of India's individual slab
#: ladders, new regime or old. If one of these turns up as a numeric literal in
#: `services/income_tax.py`, somebody has compiled a ladder back in.
_LADDER_FIGURES = (
    "250000", "300000", "400000", "500000", "600000", "700000", "750000",
    "800000", "900000", "1000000", "1200000", "1250000", "1500000", "1600000",
    "2000000", "2400000",
    "2_50_000", "2,50,000",
)


def test_no_slab_figure_is_written_into_the_resolution_module():
    """THE POINT OF PHASE 5.2b, AS A CHECK RATHER THAN AS A SENTENCE.

    A missing row that silently reverted to a compiled-in ladder would apply the
    wrong year's law and look perfectly correct on the payslip — which is the
    exact failure the table removes. So the module must contain no ladder at
    all, and the only way to keep that true through future edits is to fail the
    build when a figure appears.

    Comments are stripped first: the header explains the rule and may name a
    figure while doing so.
    """
    source = _MODULE.read_text(encoding="utf-8")
    code = "\n".join(
        line.split("#", 1)[0] for line in source.splitlines())
    # The module docstring is one big string literal; drop everything up to the
    # end of it so prose cannot fail this.
    code = code.split('"""', 2)[-1]
    found = [f for f in _LADDER_FIGURES if f in code]
    assert not found, (
        f"{_MODULE.name} contains slab figures {found}. A ladder compiled into "
        f"this module would silently apply the wrong year's law whenever a row "
        f"was missing, and it would look correct doing it. The ladder lives in "
        f"staging.pay_income_tax_slabs and nowhere else.")


def test_the_module_names_no_hardcoded_rate_fraction_either():
    """0.05 / 0.10 / 0.30 are how the literal ladder in `routers/vetana.py` is
    written today. None of them may appear here."""
    source = _MODULE.read_text(encoding="utf-8")
    code = "\n".join(line.split("#", 1)[0] for line in source.splitlines())
    code = code.split('"""', 2)[-1]
    fractions = re.findall(r"0\.(?:05|10|15|20|25|30)\b", code)
    assert not fractions, (
        f"{_MODULE.name} carries rate fractions {sorted(set(fractions))} — the "
        f"shape of a compiled-in ladder.")


# ══════════════════════════════════════════════════════════════════════════
#  4 · THE GENERATION IS THE UNIT — org over shared, latest over older
# ══════════════════════════════════════════════════════════════════════════

def _resolve(rows):
    """`_generation` over a heap of rows, as `ladders()` groups them."""
    return income_tax._generation(rows)


def test_the_latest_generation_on_or_before_the_date_wins_whole():
    """Two generations both dated in the past. The later one applies ENTIRELY —
    not band by band, which would splice ₹7,00,000 from one Finance Act into
    ₹8,00,000 from another."""
    got = _resolve(bands(NEW_2025) + bands(NEW_2026))
    assert [(b["slab_from"], b["slab_to"]) for b in got] == [
        (0, 400000), (400000, 800000), (800000, 1200000), (1200000, 1600000),
        (1600000, 2000000), (2000000, 2400000), (2400000, None)]
    assert {b["effective_from"] for b in got} == {date(2025, 4, 1)}


def test_no_band_of_an_older_generation_survives_into_the_newer_one():
    """The specific splice this design exists to prevent. FY 2024-25's
    ₹7,00,000 step must not appear anywhere in an FY 2025-26 resolution."""
    got = _resolve(bands(NEW_2024) + bands(NEW_2025) + bands(NEW_2026))
    assert 700000 not in {b["slab_from"] for b in got}
    assert 600000 not in {b["slab_from"] for b in got}


def test_an_orgs_own_ladder_outranks_a_later_dated_shared_one():
    """An organisation that has entered its own ladder has said something more
    specific than the national default, so a later-dated shared row must not
    overrule it — the rule `_pt_from_slabs` states for `is_own`."""
    own = bands(NEW_2025, is_own=True, eff=date(2020, 4, 1))
    got = _resolve(own + bands(NEW_2026))
    assert all(b["is_own"] for b in got)
    assert {b["effective_from"] for b in got} == {date(2020, 4, 1)}


def test_removing_an_orgs_own_ladder_falls_back_to_the_shared_one():
    """The fallback, in the direction that matters: nothing an organisation
    fails to configure may leave it with no ladder while a shared one exists."""
    got = _resolve(bands(NEW_2026))
    assert got and not any(b["is_own"] for b in got)


def test_nothing_at_all_resolves_to_nothing_rather_than_to_an_exception():
    assert _resolve([]) == []


def test_an_undated_band_is_admitted_rather_than_discarded():
    """`effective_from` is nullable on this table as it is on PT's. A band
    nobody dated is still a band somebody entered, and discarding it would make
    a hand-entered ladder silently deduct nothing."""
    undated = [dict(b, effective_from=None) for b in bands(OLD)]
    assert len(_resolve(undated)) == 4


@pytest.mark.asyncio
async def test_the_query_excludes_a_generation_dated_in_the_future():
    """A band the owner has set for next April must not change this month's
    run. Asserted on the SQL the function actually issues, because the date
    predicate lives there."""
    captured = {}

    class Pool:
        async def fetch(self, sql, *args):
            captured["sql"] = sql
            captured["args"] = args
            return []

    await income_tax.ladders(Pool(), E2E_ORG, date(2026, 8, 31))
    assert "effective_from <= $2::date" in captured["sql"]
    assert "org_id = $1::uuid OR org_id IS NULL" in captured["sql"]
    assert captured["args"] == (E2E_ORG, date(2026, 8, 31))


# ══════════════════════════════════════════════════════════════════════════
#  5 · LIVE — the only thing a mock pool cannot prove. READ ONLY.
# ══════════════════════════════════════════════════════════════════════════

def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def live(work):
    """Open a connection, run `work(conn)`, close it — all in ONE event loop.

    A connection failure SKIPS; anything `work` raises propagates, so a real
    assertion can never be mistaken for a missing database.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    import asyncpg

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except Exception as exc:                              # noqa: BLE001
            return False, exc
        try:
            await conn.execute(_SEARCH_PATH)
            return True, await work(conn)
        finally:
            await conn.close()

    reached, value = asyncio.run(run())
    if not reached:
        pytest.skip(f"could not reach the database: {value}\n\n{SKIP_REASON}")
    return value


class ReadOnlyPool:
    """A pool shim that can only `fetch`. Handed to `ladders()` in the live half
    so the function under test runs its OWN SQL rather than a copy retyped into
    a test. It has no `execute`, so nothing reached through it can write."""

    def __init__(self, conn):
        self._conn = conn

    async def fetch(self, sql, *args):
        return await self._conn.fetch(sql, *args)


class CapturePool:
    """Records every statement and its arguments; answers from a script.

    Holds no connection, so nothing reached through it can touch the shared
    database. The reference implementation is
    `tests/test_client_billing_invoices.py`.
    """

    def __init__(self, script=None):
        self.script = script or []
        self.calls: list[tuple[str, tuple]] = []

    def _answer(self, sql, default):
        for needle, value in self.script:
            if needle in sql:
                return value
        return default

    async def fetch(self, sql, *args, **kw):
        self.calls.append((sql, args))
        answer = self._answer(sql, [])
        # A `fetch` returns ROWS. One needle serves both `fetch` and `fetchrow`
        # here, so a script entry holding a single row must not reach `fetch`
        # bare: iterating a dict yields its KEYS, and `row["regime"]` on a
        # string is `TypeError: string indices must be integers` — an error
        # about the fixture wearing the costume of an error about the product.
        if isinstance(answer, Mapping):
            return [answer]
        return answer

    async def fetchrow(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self._answer(sql, None)

    async def fetchval(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self._answer(sql, None)

    async def execute(self, sql, *args, **kw):
        self.calls.append((sql, args))
        return self._answer(sql, "DELETE 1")


#: What `update_it_slab` must read back before it will build its UPDATE.
#: EVERY COLUMN `_SELECT` NAMES, not just the interesting ones. `ladders()`
#: groups rows into generations by `effective_from` and reads `is_own` to rank
#: them, so a fixture row missing either raises KeyError inside the service — an
#: error about the fixture that reads as an error about the product.
_CURRENT = {"regime": "new", "slab_from": 400000, "slab_to": 800000,
            "rate_percent": 5, "effective_from": date(2025, 4, 1),
            "assessment_year": "AY 2026-27", "source_ref": None,
            "notes": None, "is_own": False}
#: What every RETURNING clause hands back. Shape only — no value is asserted.
_RETURNED = {"id": 1, "org_id": E2E_ORG, "regime": "new", "slab_from": 0,
             "slab_to": 400000, "rate_percent": 0, "effective_from": None,
             "assessment_year": None, "source_ref": None, "notes": None,
             "is_own": True}

USER = {"user_id": "user_test0001"}
LEVELS = frozenset({"admin"})


def _captured_calls():
    """(path, sql, args) for every statement all four handlers issue."""
    async def run():
        import db
        out = []
        paths = (
            ("list", lambda: it_router.list_it_slabs(
                user=USER, org_id=E2E_ORG, levels=LEVELS)),
            ("create", lambda: it_router.create_it_slab(
                body=it_router.ItSlabCreate(
                    regime="new", slab_from=400000, slab_to=800000,
                    rate_percent=5, effective_from="2025-04-01",
                    assessment_year="AY 2026-27", source_ref="Finance Act 2025",
                    notes=""),
                user=USER, org_id=E2E_ORG, levels=LEVELS)),
            ("patch", lambda: it_router.update_it_slab(
                slab_id=1,
                body=it_router.ItSlabUpdate(
                    regime="old", slab_from=1, slab_to=2, rate_percent=3,
                    effective_from="2025-04-01", assessment_year="AY 2026-27",
                    source_ref="x", notes="y"),
                user=USER, org_id=E2E_ORG, levels=LEVELS)),
            ("delete", lambda: it_router.delete_it_slab(
                slab_id=1, user=USER, org_id=E2E_ORG, levels=LEVELS)),
        )
        for name, drive in paths:
            pool = CapturePool([
                ("SELECT regime, slab_from", _CURRENT),
                ("RETURNING", _RETURNED),
            ])
            original, db._pool = db._pool, pool
            try:
                await drive()
            finally:
                db._pool = original
            out.extend((name, sql, args) for sql, args in pool.calls)
        return out

    return asyncio.run(run())


def _describe(calls):
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` sends Parse and Describe and STOPS: the server plans the
    statement, resolves every relation, column and parameter type, and returns
    the shapes. No `fetch`, `execute` or `fetchval` is ever called on the
    handle, so no row is read and none is written.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for path, sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((path, sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((path, sql, len(stmt.get_parameters()), len(args)))
            catalogue = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "  FROM information_schema.columns "
                " WHERE table_schema='staging' "
                "   AND table_name='pay_income_tax_slabs'")
            return failures, params, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def described():
    """Captured statements, described once for the whole file. Connects ONCE."""
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    calls = _captured_calls()
    try:
        return _describe(calls)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_live_every_statement_the_router_issues_plans_on_the_real_schema(described):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means `$1 + $2` with no cast, which PgBouncer turns
    into an instant 500."""
    failures, _, _ = described
    assert not failures, "\n\n".join(
        f"[{path}] {err}\n{sql}" for path, sql, err in failures)


def test_live_every_statement_binds_as_many_arguments_as_it_declares(described):
    """The UPDATE builds its placeholders by hand, which is exactly where an
    off-by-one lands. Postgres counts them; the code counts the arguments."""
    _, params, _ = described
    wrong = [(p, sql, d, b) for p, sql, d, b in params if d != b]
    assert not wrong, "\n\n".join(
        f"[{p}] declares ${d} but binds {b} arguments\n{sql}"
        for p, sql, d, b in wrong)


def test_live_every_column_named_exists_and_every_required_one_is_supplied(described):
    """The half `prepare()` cannot do. A statement that omits a NOT NULL column
    plans perfectly — the violation is a runtime constraint, not a parse error —
    so Parse and Describe would NOT have caught client_billing's missing
    `invoice_number`. Read from the catalogue, never from the migration ledger.
    """
    _, params, catalogue = described
    assert catalogue, (
        "staging.pay_income_tax_slabs does not exist — migration 228 has not "
        "been applied, and the backend must NOT be deployed before it is")
    known = {c["column_name"] for c in catalogue}
    required = {c["column_name"] for c in catalogue
                if c["is_nullable"] == "NO" and c["column_default"] is None}

    seen = 0
    for path, sql, _, _ in params:
        if "INSERT INTO staging.pay_income_tax_slabs" not in sql:
            continue
        seen += 1
        cols = set(re.findall(r"\w+", sql.split("(", 1)[1].split(")", 1)[0]))
        assert not (cols - known), (
            f"[{path}] names columns the table does not have: "
            f"{sorted(cols - known)}")
        assert not (required - cols), (
            f"[{path}] omits NOT NULL columns with no default: "
            f"{sorted(required - cols)}")
    assert seen == 1, f"expected the one INSERT, described {seen}"


def test_live_the_router_file_is_the_one_under_test(described):
    """A guard on the guard: the live half must be describing THIS router's
    statements and not an empty list."""
    _, params, _ = described
    assert len(params) >= 5, (
        f"only {len(params)} statements described — the capture stopped "
        f"reaching the handlers")
    assert pathlib.Path(it_router.__file__).name == "income_tax_slabs.py"


def test_live_the_constraints_are_in_the_catalogue_not_just_in_the_file():
    """An inline CHECK on `ADD COLUMN IF NOT EXISTS` is skipped WHOLE when the
    column exists, so a migration file is not evidence a constraint is there.
    Read `pg_constraint`, which is this repo's own rule."""
    def work(conn):
        return conn.fetch(
            "SELECT c.conname, pg_get_constraintdef(c.oid) AS def "
            "  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid "
            "  JOIN pg_namespace n ON n.oid=t.relnamespace "
            " WHERE n.nspname='staging' AND t.relname='pay_income_tax_slabs'")

    rows = {r["conname"]: r["def"] for r in live(work)}
    for name in ("pay_income_tax_slabs_regime_ck",
                 "pay_income_tax_slabs_from_ck",
                 "pay_income_tax_slabs_band_ck",
                 "pay_income_tax_slabs_rate_ck"):
        assert name in rows, f"{name} is not in the catalogue: {sorted(rows)}"
    assert "slab_to > slab_from" in rows["pay_income_tax_slabs_band_ck"]


def test_live_a_duplicate_band_is_impossible_because_of_the_unique_index():
    """THE MONEY GUARD. `pay_professional_tax` has no unique index and a
    duplicate there is harmless — the ranking picks one. HERE A DUPLICATE BAND
    WOULD BE SUMMED TWICE and charge that slice of somebody's salary two times
    over. NULLS NOT DISTINCT is what makes it bite on the shared rows, whose
    `org_id` is NULL; under the default it would be decorative."""
    def work(conn):
        return conn.fetch(
            "SELECT indexname, indexdef FROM pg_indexes "
            " WHERE schemaname='staging' AND tablename='pay_income_tax_slabs'")

    rows = {r["indexname"]: r["indexdef"] for r in live(work)}
    assert "pay_income_tax_slabs_band_uniq" in rows, sorted(rows)
    definition = rows["pay_income_tax_slabs_band_uniq"]
    assert "UNIQUE" in definition
    assert "NULLS NOT DISTINCT" in definition, (
        "without NULLS NOT DISTINCT every shared band is unique to itself and "
        "the guard does nothing on exactly the rows it exists to protect")


def test_live_the_seeded_rows_are_exactly_what_the_migration_header_claims():
    """Reads the ladders back FROM THE CATALOGUE, not from the migration file.
    A file is not evidence that what it describes is in the database — 224's
    header says so and this repo's swarm-era rule says it twice."""
    def work(conn):
        return conn.fetch(
            "SELECT regime, effective_from, slab_from, slab_to, rate_percent, "
            "       org_id, assessment_year, source_ref "
            "  FROM staging.pay_income_tax_slabs "
            " ORDER BY regime, effective_from, slab_from")

    rows = [dict(r) for r in live(work)]
    assert rows, "migration 228 has not been applied: the table holds no rows"

    for (regime, eff), expected in sorted(SEEDED.items(), key=lambda kv: str(kv[0])):
        got = [r for r in rows
               if r["regime"] == regime and r["effective_from"] == eff]
        assert len(got) == len(expected), (
            f"{regime} @ {eff} has {len(got)} live bands, not {len(expected)}")
        for r, (lo, hi, rate) in zip(got, expected):
            assert r["org_id"] is None, (
                f"{regime} @ {eff} band from {lo} is scoped to one org. These "
                f"are national reference data and must stay shared.")
            assert float(r["slab_from"]) == lo
            assert (r["slab_to"] is None if hi is None
                    else float(r["slab_to"]) == hi)
            assert float(r["rate_percent"]) == rate, (
                f"{regime} @ {eff} band from {lo} is now {r['rate_percent']}%, "
                f"not {rate}%. If the law genuinely changed, add a NEW "
                f"generation and update SEEDED here — do not edit a band in "
                f"place and do not loosen this assertion.")
            assert r["source_ref"], (
                f"{regime} @ {eff} band from {lo} cites no instrument. Every "
                f"rate is a claim about somebody's pay.")


def test_live_the_ladder_query_runs_and_both_in_scope_orgs_resolve_it():
    """`ladders()` is EXECUTED, not retyped. A MagicMock pool answers happily to
    a column that has never existed — this is the only thing that proves the
    statement plans against the real schema, and the only thing that says what
    the two organisations in scope actually get."""
    def work(conn):
        async def go():
            out = {}
            for label, org in (("E2E Test & Associates", E2E_ORG),
                               ("Unicode Group", UNICODE_ORG)):
                out[label] = await income_tax.ladders(
                    ReadOnlyPool(conn), org, date(2026, 8, 31))
            return out
        return go()

    per_org = live(work)
    for label, by_regime in per_org.items():
        assert set(by_regime) == {"new", "old"}, (
            f"{label} resolves {sorted(by_regime)} — both regimes are in use "
            f"in this org and both must resolve to a ladder")
        assert len(by_regime["new"]) == 7, (
            f"{label} resolves {len(by_regime['new'])} new-regime bands, not "
            f"the seven of the Finance Act 2025 ladder")
        assert len(by_regime["old"]) == 4
        assert all(not b["is_own"] for b in by_regime["new"]), (
            f"{label} now has its own new-regime bands — migration 228 seeds "
            f"only shared rows, so a row that appeared here belongs to "
            f"somebody and this test must be told about it")
        # And the whole point: the ladder in force is the CURRENT one.
        assert income_tax.annual_tax(by_regime["new"], 2400000)[0] == 300000.0
        assert income_tax.annual_tax(by_regime["old"], 1000000)[0] == 112500.0


def test_live_re_running_an_older_month_gets_that_months_ladder():
    """THE ACCEPTANCE CRITERION OF 5.2b, against real rows. A March 2025 run
    must resolve the Finance (No. 2) Act 2024 ladder and NOT today's."""
    def work(conn):
        async def go():
            return {
                "2025-03-31": await income_tax.ladders(
                    ReadOnlyPool(conn), E2E_ORG, date(2025, 3, 31)),
                "2026-08-31": await income_tax.ladders(
                    ReadOnlyPool(conn), E2E_ORG, date(2026, 8, 31)),
            }
        return go()

    got = live(work)
    then = got["2025-03-31"]["new"]
    now = got["2026-08-31"]["new"]
    assert {b["slab_from"] for b in then} != {b["slab_from"] for b in now}, (
        "the same ladder resolved for March 2025 and August 2026 — a dated "
        "store that returns one answer for every date is a literal with extra "
        "steps")
    assert 700000 in {float(b["slab_from"]) for b in then}, (
        "March 2025 did not resolve the Finance (No. 2) Act 2024 ladder")
    assert 800000 in {float(b["slab_from"]) for b in now}
    # The Department's own AY 2025-26 constant: 5% on 3–7L is ₹20,000.
    assert income_tax.annual_tax(then, 700000)[0] == 20000.0
