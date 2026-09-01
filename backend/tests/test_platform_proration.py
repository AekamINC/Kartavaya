"""Pro-rata for upstream billing — and the paisa that must not go missing.

── WHAT IS BEING PROTECTED ──────────────────────────────────────────────────

The owner asked for mid-term changes and pro-rata on what Aekam charges its
orgs. The arithmetic is easy. The two things that are not:

 1. **A split period must sum to a whole period, exactly.** Rounding both halves
    independently loses or gains a paisa about half the time. Each individual
    invoice looks right; the ledger drifts by an amount too small for anybody to
    spot and too persistent to ever reconcile. This is asserted over every day
    of a year rather than on a lucky example.

 2. **The owner is never charged.** That is enforced in the database by
    migration 252's trigger, and asserted here against the real schema — a rule
    nothing exercises is a rule nobody can rely on.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from services.platform_proration import (
    CADENCE_MONTHS, Split, add_months, days_in, money, period_bounds,
    prorate, split_period,
)


# ── day counting ─────────────────────────────────────────────────────────────

def test_a_period_is_inclusive_at_both_ends():
    # 1–31 July is 31 days. Somebody present on the 31st is charged for it.
    assert days_in(date(2026, 7, 1), date(2026, 7, 31)) == 31


def test_february_is_february():
    assert days_in(date(2026, 2, 1), date(2026, 2, 28)) == 28
    assert days_in(date(2028, 2, 1), date(2028, 2, 29)) == 29


def test_an_empty_range_is_zero_days_not_negative():
    assert days_in(date(2026, 7, 10), date(2026, 7, 1)) == 0


# ── anchors ──────────────────────────────────────────────────────────────────

def test_a_month_end_anchor_does_not_walk_forward():
    """31 Jan + 1 month is 28 Feb, not 3 March.

    Naive day arithmetic pushes a 31st anchor a few days later every short
    month until a yearly billing date has drifted into the following month.
    """
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)
    assert add_months(date(2026, 1, 31), 2) == date(2026, 3, 31)


def test_periods_tile_without_gaps_or_overlaps():
    """The end of one period and the start of the next must be adjacent.

    A day in neither is a day nobody is billed for; a day in both is a day
    billed twice.
    """
    start = date(2026, 1, 1)
    for _ in range(24):
        s, e = period_bounds(start, "monthly")
        nxt = e + timedelta(days=1)
        assert nxt == add_months(s, 1)
        start = nxt


@pytest.mark.parametrize("cadence,months", sorted(CADENCE_MONTHS.items()))
def test_every_cadence_has_bounds(cadence, months):
    s, e = period_bounds(date(2026, 1, 1), cadence)
    assert e + timedelta(days=1) == add_months(s, months)


def test_a_one_off_has_no_period_to_apportion():
    # Guessing here would silently pro-rate a charge that has no period at all.
    with pytest.raises(ValueError):
        period_bounds(date(2026, 1, 1), "one_off")


# ── prorate ──────────────────────────────────────────────────────────────────

def test_a_whole_period_is_the_stated_amount():
    # Not amount * days/days — a full month must never be off by a rounding step.
    assert prorate(31000, date(2026, 7, 1), date(2026, 7, 31)) == Decimal("31000.00")


def test_joining_mid_month_pays_for_the_days_served():
    # 15–31 July is 17 of 31 days.
    assert prorate(31000, date(2026, 7, 1), date(2026, 7, 31),
                   active_from=date(2026, 7, 15)) == Decimal("17000.00")


def test_the_same_join_date_costs_more_in_february():
    """14/28 of February, 17/31 of July — actual days, not a notional 30.

    A customer joining on the 15th of each month is present for half of one and
    over half of the other, and the invoice should say so.
    """
    feb = prorate(Decimal("28000"), date(2026, 2, 1), date(2026, 2, 28),
                  active_from=date(2026, 2, 15))
    assert feb == Decimal("14000.00")


def test_leaving_mid_month_pays_only_to_the_leaving_day():
    assert prorate(31000, date(2026, 7, 1), date(2026, 7, 31),
                   active_to=date(2026, 7, 10)) == Decimal("10000.00")


def test_a_window_outside_the_period_does_not_extend_it():
    # Active from before the period began is "present throughout", not "owed
    # for days before we started charging".
    assert prorate(31000, date(2026, 7, 1), date(2026, 7, 31),
                   active_from=date(2026, 5, 1)) == Decimal("31000.00")


def test_an_org_that_left_before_the_period_owes_nothing():
    out = prorate(31000, date(2026, 7, 1), date(2026, 7, 31),
                  active_to=date(2026, 6, 15))
    assert out == Decimal("0.00")


def test_a_single_day_is_charged():
    assert prorate(31000, date(2026, 7, 1), date(2026, 7, 31),
                   active_from=date(2026, 7, 31)) == Decimal("1000.00")


def test_money_never_comes_back_as_a_float():
    """Float division produces 5806.451612903226 and rounds inconsistently."""
    out = prorate(10000, date(2026, 7, 1), date(2026, 7, 31),
                  active_from=date(2026, 7, 14))
    assert isinstance(out, Decimal)
    assert out.as_tuple().exponent == -2


def test_rounding_is_half_up_not_bankers():
    # An invoice a customer checks by hand should round the way they were
    # taught at school.
    assert money("0.125") == Decimal("0.13")
    assert money("0.135") == Decimal("0.14")


# ── split_period: the property that matters ─────────────────────────────────

def test_a_split_sums_to_what_the_period_would_have_cost():
    s = split_period(10000, 20000, date(2026, 7, 1), date(2026, 7, 31),
                     date(2026, 7, 15))
    assert s.before_days == 14 and s.after_days == 17
    assert s.before_amount == Decimal("4516.13")     # 14/31 of 10,000
    assert s.total == s.before_amount + s.after_amount


@pytest.mark.parametrize("month", range(1, 13))
def test_every_change_date_in_a_year_reconciles(month):
    """THE ONE THAT CATCHES THE DRIFT — and it did not, at first.

    ⚠ THIS TEST WAS WRONG BEFORE IT WAS RIGHT, and the way it was wrong is the
    fault this codebase keeps finding. It first compared the split's total
    against `prorate(old, ...) + prorate(new, ...)` — but `prorate` rounds, so
    the "expected" value was computed by exactly the same independent-rounding
    that `split_period` exists to avoid. Mutating the implementation to round
    both halves separately left this test GREEN. It was satisfied by its own
    construction, over precisely the defect it was written to catch.

    The invariant is against FULL PRECISION: the two parts must sum to the
    unrounded apportionment, quantised once. That is a statement about the
    ledger, and it cannot be satisfied by copying the implementation.
    """
    start, end = period_bounds(date(2026, month, 1), "monthly")
    total_days = days_in(start, end)
    old_price, new_price = Decimal("9999"), Decimal("17777")

    day = start
    while day <= end:
        s = split_period(old_price, new_price, start, end, day)
        before_days = days_in(start, day - timedelta(days=1))
        after_days = days_in(day, end)

        # Unrounded, in one expression, then quantised ONCE.
        exact = (old_price * Decimal(before_days) / Decimal(total_days)
                 + new_price * Decimal(after_days) / Decimal(total_days))
        assert s.total == money(exact), f"{day} drifted from the exact figure"
        assert s.before_days + s.after_days == total_days
        day += timedelta(days=1)


@pytest.mark.parametrize("month", range(1, 13))
def test_an_unchanged_price_totals_the_period_exactly_every_day(month):
    """The cleanest form of the same invariant, with no arithmetic to argue with.

    If the price does not change, the two parts of a split must add up to the
    stated amount — not to within a paisa of it — on every day of the period.
    Any independent rounding shows up here immediately and unambiguously.
    """
    start, end = period_bounds(date(2026, month, 1), "monthly")
    day = start
    while day <= end:
        s = split_period(Decimal("9999"), Decimal("9999"), start, end, day)
        assert s.total == Decimal("9999.00"), f"{day} lost or gained a paisa"
        day += timedelta(days=1)


def test_a_change_on_the_first_is_not_a_split():
    """It is simply the new price, not a zero-day part plus the rest."""
    s = split_period(10000, 20000, date(2026, 7, 1), date(2026, 7, 31),
                     date(2026, 7, 1))
    assert s.before_amount == Decimal("0.00")
    assert s.after_amount == Decimal("20000.00")
    assert s.before_days == 0


def test_a_change_after_the_period_leaves_the_old_price_alone():
    s = split_period(10000, 20000, date(2026, 7, 1), date(2026, 7, 31),
                     date(2026, 8, 5))
    assert s.before_amount == Decimal("10000.00")
    assert s.after_amount == Decimal("0.00")


def test_a_price_that_does_not_change_still_totals_the_period():
    s = split_period(12345, 12345, date(2026, 2, 1), date(2026, 2, 28),
                     date(2026, 2, 13))
    assert s.total == Decimal("12345.00")


def test_a_split_is_immutable():
    # A billing figure that a later caller can edit in place is a figure the
    # invoice and the ledger can come to disagree about.
    s = split_period(1, 2, date(2026, 7, 1), date(2026, 7, 31), date(2026, 7, 5))
    assert isinstance(s, Split)
    with pytest.raises(Exception):
        s.before_amount = Decimal("0")


# ── the owner's exemption, against the real schema ──────────────────────────

#: The live-schema tests connect directly, because the suite replaces the pool
#: with a MagicMock — and a MagicMock answers happily to an INSERT the database
#: would refuse, which is the exact failure this test exists to rule out.
_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = (
    "No live DATABASE_URL. Run: "
    "    cd backend && railway run --service Kartavaya -- python -m pytest "
    "tests/test_platform_proration.py -q"
)


def live_dsn():
    import os
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def run_live(coro_factory):
    """Run `coro_factory(conn)` against the real database, or skip.

    ⚠ SKIPS ONLY ON "THERE IS NO DATABASE HERE", never on a failure of the thing
    under test. A developer machine carries a dummy `DATABASE_URL` that is not
    the documented placeholder, so checking the string alone is not enough —
    the connection has to be attempted. Anything the database then SAYS is a
    result, and reaches the assertions.
    """
    import asyncio
    import asyncpg

    if live_dsn() is None:
        pytest.skip(DB_SKIP)

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except (asyncpg.exceptions.InvalidPasswordError,
                asyncpg.exceptions.InvalidCatalogNameError,
                OSError) as exc:
            return ("__unreachable__", str(exc))
        try:
            return ("__ok__", await coro_factory(conn))
        finally:
            await conn.close()

    kind, value = asyncio.run(run())
    if kind == "__unreachable__":
        pytest.skip(f"{DB_SKIP} (connection refused: {value[:80]})")
    return value


def test_live_the_platform_org_cannot_be_given_a_billing_line():
    """Migration 252's trigger, exercised rather than assumed.

    "Aekam their is not charge as they are owner of kartavaya." Before 252 that
    was true only because nobody had added a line. A rule nothing exercises is a
    rule nobody can rely on.

    ⚠ THE WHOLE THING RUNS INSIDE A TRANSACTION THAT IS ALWAYS ROLLED BACK, so a
    FAILING trigger cannot leave a real charge against the owner behind. The
    test that checks a refusal must not become the thing that performs the write
    it was meant to prevent.
    """
    import asyncpg

    async def probe(conn):
        tx = conn.transaction()
        await tx.start()
        try:
            org = await conn.fetchval(
                "SELECT id FROM public.organisations WHERE is_platform_org LIMIT 1")
            if org is None:
                return "no-platform-org"
            try:
                await conn.execute(
                    "INSERT INTO public.org_billing_lines "
                    "(org_id, kind, description, amount, cadence, period_start, "
                    " billing_direction, created_by) "
                    "VALUES ($1::uuid, 'platform', 'test probe', 1, 'monthly', "
                    "        date_trunc('month', now())::date, 'advance', 'test')",
                    str(org),
                )
            except asyncpg.exceptions.PostgresError as exc:
                return f"refused: {exc}"
            return "ACCEPTED"
        finally:
            await tx.rollback()

    outcome = run_live(probe)
    if outcome == "no-platform-org":
        pytest.skip("no platform org in this database")
    assert outcome.startswith("refused:"), (
        "the database accepted a billing line for the owner's own organisation"
    )
    assert "not billed for the platform it owns" in outcome


def test_live_no_billing_line_exists_for_the_owner_right_now():
    """The state, not just the rule. 0 is the number that means "not charged"."""
    async def count(conn):
        return await conn.fetchval(
            "SELECT count(*) FROM public.org_billing_lines l "
            "JOIN public.organisations o ON o.id = l.org_id "
            "WHERE o.is_platform_org")

    assert run_live(count) == 0
