"""A new org gets the allowance it is paying for, in its first month.

── THE DEFECT, FOUND THROUGH SUITE 14 ON 2026-08-31 ───────────────────────

`balance_of` heals a missing wallet in place. It stamped the new row

    period_start = current_period()

and `roll_period` returns early at `if bal.period_start >= now_period`. So a
wallet created today was born saying "already granted for this month" while
holding zero, and the plan's `monthly_credits` was not granted until the 1st of
the NEXT month.

A customer who signs up on the 2nd gets nothing for twenty-nine days of a plan
they are paying for. Every Sahayak surface answers 402. Nothing raises and
nothing logs — an empty wallet is exactly what a legitimately empty wallet
looks like, which is why this survived.

MEASURED LIVE, read-only, two orgs created three days earlier:

    UK AekamINC     monthly_credits 2000   balance 0   ledger rows 0
    Unicode Group   monthly_credits 1000   balance 0   ledger rows 0

Neither could self-serve out of it: `POST /v1/hub/org/credits/topup` and the
per-client twin are both `require_platform_role(SAHAYAK_COMMERCIAL_ROLES)` —
the Aekam console. Suite 14 hit it as a precondition and **twelve of its
twenty tests failed from that one empty wallet.**

── WHY THE FIX IS A DATE AND NOT A GRANT ──────────────────────────────────

The bootstrap now stamps `previous_period(current_period())`, so the wallet is
born UNROLLED and the very next `roll_period` grants the allowance — and
`GET /v1/hub/org/credits` calls `roll_period`, so the next read is enough.

Granting inline here would have been a second implementation of the one thing
this module exists to get right, and it would write no ledger row.
`roll_period`'s own docstring records what that costs: the old reset wrote one
row using the new balance for both `amount` and `balance_after`, "which is why
no SUM(amount) in this product has ever reconciled to a wallet."

MUTATION-PROVED 2026-08-31: restoring `current_period()` in the bootstrap turns
the first three tests red; making `previous_period` return the current period
turns them red too.
"""
from datetime import date

import pytest

from services import credits as C


# ── previous_period, including the boundary that breaks naive arithmetic ────

@pytest.mark.parametrize("period,expected", [
    (date(2026, 8, 1),  date(2026, 7, 1)),
    (date(2026, 12, 1), date(2026, 11, 1)),
    (date(2026, 1, 1),  date(2025, 12, 1)),   # ⚠ the year rolls back
    (date(2026, 3, 1),  date(2026, 2, 1)),
])
def test_previous_period(period, expected):
    assert C.previous_period(period) == expected


def test_previous_period_is_the_inverse_of_next_period():
    """Stated as a property rather than four more cases: `next_period` already
    exists and is trusted, so the cheapest correctness argument for the new
    function is that it undoes it."""
    for m in range(1, 13):
        p = date(2026, m, 1)
        assert C.previous_period(C.next_period(p)) == p
        assert C.next_period(C.previous_period(p)) == p


def test_previous_period_is_always_strictly_before(monkeypatch):
    """The ONE property `roll_period` depends on. Its guard is
    `if bal.period_start >= now_period: return bal`, so a bootstrap date that
    is merely *different* is not enough — it has to be LESS."""
    for m in range(1, 13):
        p = date(2026, m, 1)
        assert C.previous_period(p) < p


# ── the bootstrap itself ────────────────────────────────────────────────────

class RecordingConn:
    """Captures the wallet INSERT's bound arguments.

    `_wallet_row` answers None once (no wallet), then a real row — the exact
    sequence `balance_of`'s heal path walks.
    """

    def __init__(self):
        self.executed = []

    async def execute(self, sql, *args):
        self.executed.append((" ".join(str(sql).split()), args))
        return "INSERT 0 1"


@pytest.fixture
def bootstrap(monkeypatch):
    conn = RecordingConn()
    seen = {"n": 0}

    async def _org_row(c, org_id):
        return {"monthly_credits": 1000, "is_platform_org": False}

    async def _wallet_row(c, org_id, for_update):
        seen["n"] += 1
        if seen["n"] == 1:
            return None                      # no wallet — the heal path
        return {"allowance": 0, "purchased": 0,
                "period_start": C.previous_period(C.current_period())}

    monkeypatch.setattr(C, "_org_row", _org_row)
    monkeypatch.setattr(C, "_wallet_row", _wallet_row)
    return conn


def _insert(conn):
    for sql, args in conn.executed:
        if "INSERT INTO public.hub_org_credits" in sql:
            return sql, args
    raise AssertionError("no wallet INSERT was issued")


async def test_a_new_wallet_is_stamped_as_NOT_YET_ROLLED(bootstrap):
    """THE DEFECT. RED with `current_period()`: the wallet is born saying it
    has already been granted this month, and never is."""
    await C.balance_of(bootstrap, "00000000-0000-0000-0000-0000000000aa")
    _, args = _insert(bootstrap)
    stamped = args[1]
    assert stamped < C.current_period(), (
        f"a new wallet is stamped {stamped}, which is not before "
        f"{C.current_period()} — roll_period will skip its first grant and the "
        "org holds zero for the rest of the month")


async def test_it_is_exactly_the_previous_period(bootstrap):
    """Not an arbitrary old date. `roll_period` writes an `expire` row for
    unused allowance and a `grant` for the new one; backdating further would
    still grant once, but the wallet's history would claim it had been sitting
    unrolled since a month nothing happened in."""
    await C.balance_of(bootstrap, "00000000-0000-0000-0000-0000000000aa")
    _, args = _insert(bootstrap)
    assert args[1] == C.previous_period(C.current_period())


async def test_the_wallet_is_still_born_EMPTY(bootstrap):
    """⚠ The other direction. Granting the balance in the INSERT would fix the
    symptom and write no ledger row — a wallet holding credits that no
    SUM(amount) explains, which roll_period's docstring names as the bug that
    made every wallet in this product unreconcilable. The allowance must arrive
    through the roll, not through the bootstrap."""
    await C.balance_of(bootstrap, "00000000-0000-0000-0000-0000000000aa")
    sql, _ = _insert(bootstrap)
    assert "VALUES ($1::uuid, 0, 0, 0, $2::date, NOW())" in sql, sql
