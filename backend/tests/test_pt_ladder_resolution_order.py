"""The professional-tax ladder resolves in one order, and never refuses.

Phase 0.24 — migration `224_professional_tax_states.sql` seeded four more
states as SHARED rows (`org_id IS NULL`): Assam '18', West Bengal '19',
Telangana '36', Andhra Pradesh '37'. The ladder went from 9 rows / 3 states to
23 rows / 7 states.

WHY THIS FILE EXISTS, AND WHY IT IS ABOUT THE ORDER RATHER THAN THE RATES
------------------------------------------------------------------------
Seeding a state is a data change with no code change, which is exactly the kind
that no test catches. The rates themselves are checked live (below) against the
catalogue; what CANNOT be checked by looking at rows is that adding fourteen of
them left the resolution ORDER intact — and that order is the whole safety
property of this feature. Migration 221's header states it as a contract:

    org + this month  ->  org + every month
                      ->  shared + this month  ->  shared + every month  ->  0

Most specific wins; EVERY step degrades into the next; the last step is the
owner's ₹0 decision. Nothing an organisation fails to configure may stop a
payroll run. That is the rule this file pins, step by step, in both directions:
that the more specific row wins when it is there, and that removing it falls
through to the next rather than refusing.

WHERE THE `month` DIMENSION IS ACTUALLY APPLIED
----------------------------------------------
Two functions share the work and the split matters when reading these tests.
`_pt_slabs` (SQL) admits `month IS NULL OR month = EXTRACT(MONTH FROM $2)`, so
it has ALREADY discarded every month that is not the one being run. By the time
`_pt_from_slabs` sees a row, `month is not None` means "a row FOR this month",
which is why the rank tuple can treat it as a plain specificity bit. The offline
tests here therefore build rows the way `_pt_slabs` would have returned them.

NOTHING HERE WRITES ANYTHING
----------------------------
Staging and production share one Supabase database (CLAUDE.md, "The one
dangerous fact"), so no test may seed a slab to prove a point. The org-scoped
and month-scoped rows in the fallback tests are built IN PYTHON on top of the
real shared rows in the live half — which proves the ordering over real data
without a single INSERT.

    railway run -e staging -s Kartavya -- \
        python -m pytest tests/test_pt_ladder_resolution_order.py -q
"""
import asyncio
import inspect
import os
import re
from datetime import date

import pytest

from routers import vetana

# ── The two in-scope organisations (docs/plans/README.md). ───────────────────
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"      # Maharashtra '27'
UNICODE_ORG = "fae87907-2f99-4b35-a241-c94d9e1e4a17"  # Gujarat '24'

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. The live half reads the seeded ladder from the real "
    "catalogue — a MagicMock pool answers happily to rates that are not "
    "there. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_pt_ladder_resolution_order.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def live(work):
    """Open a connection, run `work(conn)`, close it — all in ONE event loop.

    asyncpg binds a connection to the loop that created it. A connection
    failure SKIPS; anything `work` raises propagates, so a real assertion can
    never be mistaken for a missing database.
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
    """A pool shim that can only `fetch`. Handed to `_pt_slabs` in the live
    half so the function under test runs its OWN SQL rather than a copy of it
    retyped into a test — the failure mode `test_skill_sql_is_valid.py` exists
    for. It has no `execute`, so nothing reached through it can write."""

    def __init__(self, conn):
        self._conn = conn

    async def fetch(self, sql, *args):
        return await self._conn.fetch(sql, *args)


def band(*, tax, is_own=False, month=None, eff=date(2024, 4, 1),
         lo=0, hi=None, state="27", name="Maharashtra"):
    """One row shaped exactly as `_pt_slabs` returns it."""
    return {"state_code": state, "state_name": name, "slab_from": lo,
            "slab_to": hi, "monthly_tax": tax, "effective_from": eff,
            "month": month, "is_own": is_own}


# ══════════════════════════════════════════════════════════════════════════
#  1 · THE ORDER — five steps, each falling into the next
# ══════════════════════════════════════════════════════════════════════════

#: The four rows, most specific first. Every one matches the same state and the
#: same gross; they differ ONLY in specificity, so whichever wins is decided by
#: the rank tuple and nothing else.
ORG_MONTH = band(tax=411, is_own=True, month=8)
ORG_ALL = band(tax=422, is_own=True, month=None)
SHARED_MONTH = band(tax=433, is_own=False, month=8)
SHARED_ALL = band(tax=444, is_own=False, month=None)

LADDER = [ORG_MONTH, ORG_ALL, SHARED_MONTH, SHARED_ALL]


class TestTheResolutionOrderStillHolds:
    """`org+month -> org+all -> shared+month -> shared+all -> 0`.

    Each case removes the winner of the case above it and asserts the next
    one takes over. Read top to bottom it is the contract; read as a set it is
    five independent assertions.
    """

    @pytest.mark.parametrize("rows, expected, step", [
        (LADDER,      411.0, "org + this month"),
        (LADDER[1:],  422.0, "org + every month"),
        (LADDER[2:],  433.0, "shared + this month"),
        (LADDER[3:],  444.0, "shared + every month"),
        ([],            0.0, "nothing at all"),
    ])
    def test_each_step_falls_into_the_next(self, rows, expected, step):
        got, _slab = vetana._pt_from_slabs(rows, "27", 50000)
        assert got == expected, (
            f"with only [{step}] and below available the ladder paid {got}, "
            f"not {expected}. The resolution order in migration 221's header "
            f"is the contract; do not reorder the rank tuple in "
            f"`_pt_from_slabs` without changing it there too.")

    def test_the_order_is_stable_however_the_rows_arrive(self):
        """Rank, not row order. `_pt_slabs` orders by `state_code, slab_from`
        and says nothing about ownership or month, so a resolution that
        depended on arrival order would be correct only by accident."""
        for rows in (LADDER, LADDER[::-1],
                     [SHARED_ALL, ORG_MONTH, SHARED_MONTH, ORG_ALL]):
            assert vetana._pt_from_slabs(rows, "27", 50000)[0] == 411.0

    def test_a_shared_row_dated_later_still_loses_to_an_organisations_own(self):
        """THE ONE THAT WOULD SILENTLY REWRITE A CUSTOMER'S RATE. `is_own` is
        the FIRST element of the rank tuple and `effective_from` only the
        third, so re-seeding the national ladder with a fresher date must not
        overrule a firm that entered its own band. If ownership ever slips
        below the date, this is the test that says so."""
        fresh_shared = band(tax=999, is_own=False, month=None,
                            eff=date(2099, 1, 1))
        got, _ = vetana._pt_from_slabs([ORG_ALL, fresh_shared], "27", 50000)
        assert got == 422.0, (
            "a shared row dated 2099 overruled the organisation's own band. An "
            "org that has entered its own ladder has said something more "
            "specific than the national default.")

    def test_within_one_tier_the_more_recently_effective_wins(self):
        """Two generations of the same shared ladder, both dated in the past."""
        old = band(tax=100, eff=date(2014, 4, 1))
        new = band(tax=175, eff=date(2025, 4, 1))
        assert vetana._pt_from_slabs([old, new], "27", 50000)[0] == 175.0
        assert vetana._pt_from_slabs([new, old], "27", 50000)[0] == 175.0


# ══════════════════════════════════════════════════════════════════════════
#  2 · IT NEVER REFUSES — the owner's rule, stated as behaviour
# ══════════════════════════════════════════════════════════════════════════

class TestNothingUnconfiguredCanStopAPayrollRun:
    """Owner, 2026-08-26: like GSTIN, PAN and TAN this is OPTIONAL and must
    block nothing. Every branch below is a question this cannot answer, and
    every one of them answers ₹0 instead of raising."""

    @pytest.mark.parametrize("state, why", [
        (None,     "nobody recorded where this person works"),
        ("",       "an empty string, which is what a blank form field sends"),
        ("   ",    "whitespace"),
        ("Atlantis", "a state the GST codelist has never heard of"),
        ("99",     "a code that resolves to no seeded ladder"),
        ("28",     "undivided Andhra Pradesh — retired, deliberately unseeded"),
    ])
    def test_an_unanswerable_state_pays_zero_and_does_not_raise(self, state, why):
        got, slab = vetana._pt_from_slabs(LADDER, state, 50000)
        assert (got, slab) == (0.0, None), f"{why}: got {got!r}"

    @pytest.mark.parametrize("slabs, why", [
        ([], "this org has seeded no slabs"),
        (None, "the caller passed nothing at all"),
    ])
    def test_an_empty_ladder_pays_zero(self, slabs, why):
        assert vetana._pt_from_slabs(slabs, "27", 50000) == (0.0, None), why

    def test_a_gross_that_falls_in_no_band_pays_zero(self):
        only_high = [band(tax=200, lo=100000, hi=None)]
        assert vetana._pt_from_slabs(only_high, "27", 5000) == (0.0, None)

    @pytest.mark.parametrize("bad, why", [
        ({"state_code": "27"}, "a row missing every other column"),
        ({}, "an empty row"),
        ("not a row at all", "a string where a row was expected"),
        (band(tax=200, lo="abc"), "a slab_from that will not read as one"),
    ])
    def test_a_malformed_row_is_skipped_not_fatal(self, bad, why):
        """A payroll run must not stop because one reference row is wrong —
        and the GOOD rows beside it must still be used.

        Every case here is caught by the `except (KeyError, TypeError,
        ValueError)` INSIDE the matching loop, which is why the good row
        survives. `monthly_tax` is the one field that is not — see the test
        below, which is the honest record of that."""
        got, _ = vetana._pt_from_slabs([bad, SHARED_ALL], "27", 50000)
        assert got == 444.0, f"{why} took the good row down with it"

    def test_an_unreadable_rate_no_longer_shadows_a_good_row(self):
        """THE GAP THIS FILE PINNED, NOW CLOSED — 2026-08-27.

        `_pt_from_slabs` reads `state_code`, `slab_from`, `slab_to`,
        `effective_from`, `is_own` and `month` inside its guarded loop, and its
        own comment said that was deliberate "because it means the row this
        function returns is known to carry all of them". `monthly_tax` was NOT
        among them: it was read AFTER the winner had been chosen. So a row whose
        rate would not parse still WON the ranking, the conversion then failed,
        and the answer was ₹0 — with a perfectly good row for the same state and
        band sitting underneath it, never consulted.

        The never-block rule was never violated (no exception escaped, the run
        continued, the answer was the owner's ₹0), which is why this was a gap
        rather than a blocker. The fix is the one line the earlier version of
        this test asked for: the rate is parsed inside the loop with the other
        six fields, so an unreadable one is skipped like any other malformed
        column instead of winning and then failing.

        444.0 is `SHARED_ALL`'s rate. Asserting it — rather than the ₹0 this
        used to assert — is the whole point: the fallback is now the right
        ladder instead of nothing at all.
        """
        rows = [band(tax="not a number"), SHARED_ALL]
        got, slab = vetana._pt_from_slabs(rows, "27", 50000)
        assert got == 444.0, (
            "an unreadable rate is shadowing the good row again — the rate must "
            "be parsed INSIDE the guarded loop, not after the winner is picked")
        assert slab is SHARED_ALL

    def test_an_unreadable_rate_alone_still_pays_zero(self):
        """The other half: skipping the bad row must not become raising. With
        nothing left to fall back to, the answer is still the owner's ₹0."""
        got, slab = vetana._pt_from_slabs([band(tax="not a number")], "27", 50000)
        assert (got, slab) == (0.0, None)

    def test_a_malformed_row_alone_pays_zero(self):
        assert vetana._pt_from_slabs([{}], "27", 50000) == (0.0, None)

    def test_nothing_in_the_resolution_path_can_raise(self):
        """The blunt version of everything above: every combination of a bad
        state and a bad ladder returns a number."""
        for state in (None, "", "27", "Atlantis", 27, 0):
            for slabs in ([], None, LADDER, [{}], ["junk"]):
                for gross in (0, -1, 5000, 1e9):
                    got, _ = vetana._pt_from_slabs(slabs, state, gross)
                    assert isinstance(got, float)


# ══════════════════════════════════════════════════════════════════════════
#  3 · THE FOUR SEEDED LADDERS — the law, written once
# ══════════════════════════════════════════════════════════════════════════
#
# Sources for every figure are in the header of
# `backend/migrations/224_professional_tax_states.sql`, per state, with the
# Act and the amendment. This table is the same claim in a form a test can
# execute; if the two ever disagree, the migration header is the record of
# what was verified and this is the typo.
#
# `slab_from` starts ONE PAISA above the previous band's statutory ceiling.
# That is not a rounding accident — `_pt_from_slabs` matches inclusively at
# both ends and gross is `numeric(_,2)`, so whole-rupee boundaries leave a
# 99-paisa hole in which PT computes ₹0. See the migration header.

SEEDED = {
    "18": ("Assam", [
        (0.00, 15000.00, 0.0),
        (15000.01, 25000.00, 180.0),
        (25000.01, None, 208.0),
    ]),
    "19": ("West Bengal", [
        (0.00, 10000.00, 0.0),
        (10000.01, 15000.00, 110.0),
        (15000.01, 25000.00, 130.0),
        (25000.01, 40000.00, 150.0),
        (40000.01, None, 200.0),
    ]),
    "36": ("Telangana", [
        (0.00, 15000.00, 0.0),
        (15000.01, 20000.00, 150.0),
        (20000.01, None, 200.0),
    ]),
    "37": ("Andhra Pradesh", [
        (0.00, 15000.00, 0.0),
        (15000.01, 20000.00, 150.0),
        (20000.01, None, 200.0),
    ]),
}

#: The three that were already there, so a change to them is visible here too.
PRE_EXISTING = {"24": "Gujarat", "27": "Maharashtra", "29": "Karnataka"}


def rows_for(code):
    name, bands = SEEDED[code]
    return [band(state=code, name=name, lo=lo, hi=hi, tax=tax)
            for lo, hi, tax in bands]


class TestTheSeededLaddersPayWhatTheStatuteSays:

    @pytest.mark.parametrize("code", sorted(SEEDED))
    def test_every_band_pays_its_rate_at_both_of_its_edges(self, code):
        name, bands = SEEDED[code]
        rows = rows_for(code)
        for lo, hi, tax in bands:
            for probe in (lo, hi if hi is not None else lo + 1_000_000):
                got, _ = vetana._pt_from_slabs(rows, name, probe)
                assert got == tax, (
                    f"{name} at a gross of {probe} pays {got}, not {tax}")

    @pytest.mark.parametrize("code", sorted(SEEDED))
    def test_the_bands_are_contiguous_so_no_gross_falls_through(self, code):
        """THE DEAD-ZONE TEST. A gross landing between two bands matches
        nothing and `_pt_from_slabs` returns 0.0 silently — no error, no log
        line, indistinguishable from a state that levies nothing.

        Walks every boundary in paise. The `.50` probes are the ones that fail
        if somebody ever "tidies" these bands to whole rupees."""
        name, bands = SEEDED[code]
        rows = rows_for(code)
        for (lo, hi, tax), (nxt_lo, _nh, nxt_tax) in zip(bands, bands[1:]):
            assert hi is not None and abs(nxt_lo - hi - 0.01) < 1e-9, (
                f"{name}: band ending {hi} is followed by one starting "
                f"{nxt_lo} — that is a gap, and every gross inside it pays 0")
            for probe, expected in ((hi, tax),
                                    (round(hi + 0.01, 2), nxt_tax),
                                    (round(hi + 0.50, 2), nxt_tax),
                                    (round(hi + 0.99, 2), nxt_tax)):
                got, _ = vetana._pt_from_slabs(rows, name, probe)
                assert got == expected, (
                    f"{name} at {probe} pays {got}, not {expected} — a gross "
                    f"with paise fell into the gap above {hi}")

    @pytest.mark.parametrize("code", sorted(SEEDED))
    def test_no_seeded_ladder_can_breach_the_constitutional_ceiling(self, code):
        """Article 276(2) caps this levy at ₹2,500 a person a year. A top band
        above ₹208.33 a month cannot be lawful for twelve months, so a typo
        that adds a zero is caught here rather than on a payslip."""
        name, bands = SEEDED[code]
        top = max(tax for _lo, _hi, tax in bands)
        assert top * 12 <= 2500, (
            f"{name}'s top band of {top} a month is {top * 12} a year, over "
            f"the ₹2,500 ceiling in Article 276(2)")

    @pytest.mark.parametrize("code", sorted(SEEDED))
    def test_a_state_matches_by_code_and_by_name_alike(self, code):
        """`manav_employees.state` may hold '36', 'TG' or 'Telangana' —
        migration 220's CHECK admits the numeric and the alphabetic form, and
        `_state_keys` collapses them. A ladder that matched only one spelling
        would charge nothing to half the people in the state."""
        name, bands = SEEDED[code]
        rows = rows_for(code)
        top_rate = bands[-1][2]
        for spelling in (code, int(code), name, name.lower(), name.upper()):
            got, _ = vetana._pt_from_slabs(rows, spelling, 1_000_000)
            assert got == top_rate, (
                f"spelled {spelling!r}, {name} resolved {got} rather than "
                f"{top_rate}")

    def test_this_seed_never_reaches_a_state_that_already_had_a_ladder(self):
        """A guard on the table above, not on the database — the live version
        of this question is
        `test_live_seeding_four_states_moved_nobody_in_either_in_scope_org`.

        E2E is Maharashtra '27' and Unicode is Gujarat '24'. If somebody ever
        adds one of the three pre-existing states to SEEDED, they are changing
        a ladder a customer's payroll reads TODAY rather than adding a new one,
        and that is a different decision needing the owner — so it fails here
        first, at the point the constant is edited."""
        clash = set(SEEDED) & set(PRE_EXISTING)
        assert clash == set(), (
            f"{sorted(clash)} already had a live ladder before migration 224. "
            f"Re-seeding an existing state changes what somebody is being paid "
            f"and is an owner decision, not a seed.")


# ══════════════════════════════════════════════════════════════════════════
#  4 · THE SQL — what `_pt_slabs` still asks for
# ══════════════════════════════════════════════════════════════════════════

def _norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql)


class TestTheQueryStillAdmitsBothFallbackDimensions:
    """Offline guards on the two predicates that make the shared ladder and
    the every-month row reachable at all. Delete either and the fallback ends
    at ₹0 for everybody, with no error."""

    def test_a_shared_row_is_still_admitted(self):
        sql = _norm(inspect.getsource(vetana._pt_slabs))
        assert "org_id IS NULL" in sql, (
            "`_pt_slabs` no longer admits `org_id IS NULL`. All 23 live rows "
            "are shared, so this scopes professional tax to nothing and every "
            "payslip in the product deducts ₹0.")
        assert "org_id = $1::uuid" in sql, (
            "the org predicate is gone — one firm would read another's rates")

    def test_an_every_month_row_is_still_admitted(self):
        sql = _norm(inspect.getsource(vetana._pt_slabs))
        assert "month IS NULL" in sql, (
            "`_pt_slabs` no longer admits `month IS NULL`. All 23 live rows "
            "have a NULL month, so this returns nothing at all.")
        assert "EXTRACT(MONTH FROM $2::date)" in sql, (
            "the month predicate is gone; a February-only row would apply in "
            "every month")

    def test_a_future_dated_band_is_still_excluded(self):
        sql = _norm(inspect.getsource(vetana._pt_slabs))
        assert "effective_from IS NULL OR effective_from <= $2::date" in sql, (
            "re-running an old month would use today's rates")


# ══════════════════════════════════════════════════════════════════════════
#  5 · LIVE — against the real catalogue and the real rows. READ ONLY.
# ══════════════════════════════════════════════════════════════════════════

def test_live_the_seeded_rows_are_exactly_what_the_statute_table_says():
    """Reads the four ladders back FROM THE CATALOGUE, not from the migration
    file. Migration 221's own header records why: a file is not evidence that
    what it describes is in the database."""
    async def work(conn):
        return [dict(r) for r in await conn.fetch(
            "SELECT state_code, state_name, slab_from, slab_to, monthly_tax, "
            "       effective_from, month, org_id "
            "  FROM staging.pay_professional_tax "
            " WHERE state_code = ANY($1::text[]) "
            " ORDER BY state_code, slab_from", sorted(SEEDED))]

    rows = live(work)
    assert rows, (
        "migration 224 has not been applied: no row exists for any of "
        f"{sorted(SEEDED)}")

    for code, (name, bands) in sorted(SEEDED.items()):
        got = [r for r in rows if r["state_code"] == code]
        assert len(got) == len(bands), (
            f"{name} has {len(got)} live bands, not {len(bands)}: {got}")
        for r, (lo, hi, tax) in zip(got, bands):
            assert r["org_id"] is None, (
                f"{name} band from {lo} is scoped to one org. These are "
                f"national reference data and must stay shared.")
            assert r["month"] is None, (
                f"{name} band from {lo} carries month={r['month']}. Migration "
                f"224 seeds no month variant; Maharashtra's February figure "
                f"is a separate owner decision.")
            assert r["state_name"] == name
            assert float(r["slab_from"]) == lo
            assert (r["slab_to"] is None if hi is None
                    else float(r["slab_to"]) == hi)
            assert float(r["monthly_tax"]) == tax, (
                f"{name} band from {lo} now pays {r['monthly_tax']}, not "
                f"{tax}. If the rate genuinely changed, update SEEDED here "
                f"AND the sources in the migration header — do not loosen "
                f"this assertion.")


def test_live_the_query_runs_and_the_whole_ladder_comes_back():
    """`_pt_slabs` is executed, not retyped. A MagicMock pool answers happily
    to a column that has never existed — this is the only thing that proves
    the statement plans against the real schema."""
    async def work(conn):
        slabs = await vetana._pt_slabs(ReadOnlyPool(conn), E2E_ORG,
                                       date(2026, 8, 31))
        return [dict(r) for r in slabs]

    slabs = live(work)
    states = {r["state_code"] for r in slabs}
    for code in SEEDED:
        assert code in states, (
            f"state {code} was seeded but `_pt_slabs` does not return it for "
            f"an org that owns no rows — the shared-row predicate is broken")
    for code in PRE_EXISTING:
        assert code in states, f"the pre-existing ladder {code} has gone"
    assert all(r["is_own"] is False for r in slabs), (
        "an org-scoped professional-tax row now exists. Migration 224 seeds "
        "only shared rows; a row that appeared here belongs to somebody.")


def test_live_the_fallback_ladder_holds_over_the_real_shared_rows():
    """The five-step order, proved against the rows a payroll run would read
    — WITHOUT WRITING ONE. The org-scoped and month-scoped rows are built in
    Python on top of the real shared row, which is what makes this safe on a
    database production also writes to."""
    async def work(conn):
        slabs = await vetana._pt_slabs(ReadOnlyPool(conn), UNICODE_ORG,
                                       date(2026, 8, 31))
        return [dict(r) for r in slabs]

    shared = live(work)
    real = next((r for r in shared
                 if r["state_code"] == "36" and float(r["monthly_tax"]) == 200),
                None)
    assert real is not None, "Telangana's top band is not live"

    own_all = dict(real, is_own=True, monthly_tax=111)
    own_month = dict(real, is_own=True, month=8, monthly_tax=222)
    shared_month = dict(real, is_own=False, month=8, monthly_tax=333)

    for extra, expected, step in (
        ([own_month, own_all, shared_month], 222.0, "org + this month"),
        ([own_all, shared_month], 111.0, "org + every month"),
        ([shared_month], 333.0, "shared + this month"),
        ([], 200.0, "shared + every month — the real seeded row"),
    ):
        got, _ = vetana._pt_from_slabs(shared + extra, "36", 99999)
        assert got == expected, f"[{step}] resolved {got}, not {expected}"

    # And the last step: a state nobody seeded still returns a number.
    got, slab = vetana._pt_from_slabs(shared, "Nagaland", 99999)
    assert (got, slab) == (0.0, None), (
        "an unseeded state must pay ₹0, which is the owner's decision and the "
        "reason seeding four states could never block the other fifteen")


def test_live_seeding_four_states_moved_nobody_in_either_in_scope_org():
    """THE REGRESSION GUARD FOR THIS MIGRATION. Fourteen shared rows are read
    by EVERY organisation, so the question that matters is not "are the new
    rates right" but "did they change anybody who was already being paid".

    Resolves the ladder for every employee on their latest payslip in both
    in-scope orgs and compares it against the professional tax that payslip
    actually carries. Read-only, and it re-derives rather than trusting: if a
    seeded row ever shadows Maharashtra or Gujarat, this is where it shows.
    """
    async def work(conn):
        out = {}
        for label, org in (("E2E Test & Associates", E2E_ORG),
                           ("Unicode Group", UNICODE_ORG)):
            slabs = [dict(r) for r in await vetana._pt_slabs(
                ReadOnlyPool(conn), org, date(2026, 8, 31))]
            rows = await conn.fetch(
                "WITH latest AS ("
                "  SELECT p.employee_id, p.gross, p.professional_tax,"
                "         row_number() OVER (PARTITION BY p.employee_id "
                "                            ORDER BY p.created_at DESC) rn"
                "    FROM staging.vetana_payslips p"
                "   WHERE p.org_id=$1::uuid AND p.is_active IS NOT FALSE)"
                " SELECT l.gross, l.professional_tax, e.state"
                "   FROM latest l JOIN staging.manav_employees e"
                "     ON e.id = l.employee_id"
                "  WHERE l.rn = 1", org)
            out[label] = [
                (float(r["gross"]), float(r["professional_tax"] or 0),
                 r["state"],
                 vetana._pt_from_slabs(slabs, r["state"], float(r["gross"]))[0])
                for r in rows]
        return out

    per_org = live(work)
    for label, rows in per_org.items():
        if not rows:
            pytest.skip(f"{label} has no payslips joined to an employee")
        differ = [(g, stored, st, now) for g, stored, st, now in rows
                  if abs(stored - now) >= 0.005]
        assert not differ, (
            f"{label}: the seeded ladder now resolves a DIFFERENT professional "
            f"tax from the one on {len(differ)} of {len(rows)} live payslips. "
            f"Migration 224 seeded only states nobody is in; if this fires, a "
            f"new row is shadowing an existing ladder. First few: {differ[:5]}")
