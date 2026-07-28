"""
A scraper run that produced nothing returns the upfront charge (F29).

Measured on staging: a run that failed at Apify kept 2 credits and recorded
billed_inr 50 against 0 rows, and the balance never moved back — while the run
response had promised "minimum upfront — final charge after run completes".

The charge is taken before Apify is called, so on failure it was never final.
Billing a customer for the platform's failure is the wrong default, and it is
the same class of defect as F24: a money figure the customer can see that does
not match what happened.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.scrapers import _refund_credits


def _pool(balance=1998):
    """A pool whose acquire()/transaction() context managers are no-ops."""
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value={"balance": balance})
    conn.execute = AsyncMock()

    acquired = MagicMock()
    acquired.__aenter__ = AsyncMock(return_value=conn)
    acquired.__aexit__ = AsyncMock(return_value=False)
    tx = MagicMock()
    tx.__aenter__ = AsyncMock(return_value=None)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquired)
    return pool, conn


async def test_refund_returns_the_balance_and_zeroes_billed_inr():
    pool, conn = _pool(balance=1998)
    await _refund_credits(pool, "org-1", "user-1", 2, "run-abcdef12", "run failed")

    sql = " ".join(str(c.args[0]) for c in conn.execute.await_args_list)
    assert "UPDATE staging.hub_org_credits SET balance=" in sql
    # 1998 + 2 — the charge comes back, it is not merely stopped
    assert any(c.args[1] == 2000 for c in conn.execute.await_args_list
               if "hub_org_credits SET balance" in str(c.args[0]))
    # billed_inr must not survive the refund, or the cost report attributes
    # spend to a run that cost nothing and the two disagree again
    assert "SET billed_inr=0" in sql


async def test_refund_is_recorded_as_a_credit_not_a_negative_debit():
    """A customer reconciling the ledger must see a reversal, not just a charge."""
    pool, conn = _pool()
    await _refund_credits(pool, "org-1", "user-1", 2, "run-abcdef12", "run failed")

    ins = [c for c in conn.execute.await_args_list
           if "hub_org_credit_transactions" in str(c.args[0])]
    assert ins, "a refund must write a ledger row"
    assert "'credit'" in str(ins[0].args[0])
    assert ins[0].args[3] == 2, "amount is positive on a credit"
    assert "refund" in ins[0].args[5]


async def test_zero_amount_is_a_no_op():
    """Nothing was charged, so nothing comes back — and no ledger noise."""
    pool, conn = _pool()
    await _refund_credits(pool, "org-1", "user-1", 0, "run-abcdef12", "run failed")
    conn.execute.assert_not_awaited()


async def test_missing_wallet_does_not_raise():
    pool, conn = _pool()
    conn.fetchrow = AsyncMock(return_value=None)
    await _refund_credits(pool, "org-1", "user-1", 2, "run-abcdef12", "run failed")
    conn.execute.assert_not_awaited()


async def test_a_failed_refund_never_raises():
    """This runs inside a background poller.

    A refund that blows up must not also lose the failure that caused it — the
    run status update has already happened by then. It logs loudly instead.
    """
    pool, conn = _pool()
    conn.fetchrow = AsyncMock(side_effect=RuntimeError("connection reset"))
    await _refund_credits(pool, "org-1", "user-1", 2, "run-abcdef12", "run failed")
