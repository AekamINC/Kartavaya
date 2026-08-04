"""
A scraper run that produced nothing returns the upfront charge (F29).

Measured on staging: a run that failed at Apify kept 2 credits and recorded
billed_inr 50 against 0 rows, and the balance never moved back — while the run
response had promised "minimum upfront — final charge after run completes".

The charge is taken before Apify is called, so on failure it was never final.
Billing a customer for the platform's failure is the wrong default, and it is
the same class of defect as F24: a money figure the customer can see that does
not match what happened.

REWRITTEN 2026-08-04 for the one-ledger programme, and the rewrite is the point
of the change rather than an accident of it.

`_refund_credits` used to take an AMOUNT and hand-write `UPDATE
staging.hub_org_credits SET balance=…` itself. The assertion that pinned that
literal string is gone because the statement is gone: every wallet write now
lives in services/credits.py, and tests/test_credits_isolation.py fails the build
if a second one appears anywhere in the tree.

An amount was also the wrong argument. Nothing in a bare integer can know that a
second debit — the true-up — ever happened, which is exactly why a trued-up run
used to refund only its minimum and Aekam simply kept the difference. The
function now names the TRANSACTION it reverses, `credits.refund` reads that row
for the amount and the bucket split, and the database enforces refund-once
through uq_org_credit_tx_reverses.

So these tests assert on the call and on the run row, which is all this function
still owns.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.scrapers import _refund_credits

TX = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def _pool(fail_on=None):
    """A pool whose acquire()/transaction() context managers are no-ops."""
    conn = MagicMock()
    conn.fetchrow = AsyncMock(return_value=None)

    async def _execute(sql, *args):
        if fail_on and fail_on in sql:
            raise RuntimeError("write failed")
        return "OK"

    conn.execute = AsyncMock(side_effect=_execute)

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


@pytest.fixture
def spy_refund(monkeypatch):
    """Records what credits.refund was asked to reverse."""
    import services.credits as C

    calls = []

    async def _refund(conn, *, tx_id, reason, user_id=None):
        calls.append({"tx_id": tx_id, "reason": reason, "user_id": user_id})
        return None

    monkeypatch.setattr(C, "refund", _refund)
    return calls


async def test_refund_reverses_the_transaction_and_zeroes_billed_inr(spy_refund):
    pool, conn = _pool()
    await _refund_credits(pool, TX, "run-abcdef12", "run failed", user_id="user-1")

    assert spy_refund, "a refund must reverse the original transaction"
    assert spy_refund[0]["tx_id"] == TX
    assert "run failed" in spy_refund[0]["reason"]

    # billed_inr must not survive the refund, or the cost report attributes
    # spend to a run that cost nothing and the two disagree again
    sql = " ".join(str(c.args[0]) for c in conn.execute.await_args_list)
    assert "SET billed_inr=0" in sql


async def test_the_amount_is_never_named_by_the_caller(spy_refund):
    """The defect this signature change fixes.

    A caller that passes an amount can only ever return the amount it happens to
    know about. `credits.refund` reads the original row, so a trued-up run comes
    back in full when both of its transactions are reversed.
    """
    import inspect
    from routers import scrapers

    sig = inspect.signature(scrapers._refund_credits)
    assert "amount" not in sig.parameters
    assert "tx_id" in sig.parameters


async def test_no_transaction_is_a_no_op(spy_refund):
    """Nothing was charged, so nothing comes back — and no ledger noise."""
    pool, conn = _pool()
    await _refund_credits(pool, None, "run-abcdef12", "run failed")
    assert spy_refund == []
    conn.execute.assert_not_awaited()


async def test_a_failed_refund_never_raises(monkeypatch):
    """This runs inside a background poller.

    A refund that blows up must not also lose the failure that caused it — the
    run status update has already happened by then. It logs loudly instead.
    """
    import services.credits as C

    async def _boom(conn, **kw):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(C, "refund", _boom)
    pool, conn = _pool()
    await _refund_credits(pool, TX, "run-abcdef12", "run failed")


async def test_a_failed_billed_inr_write_never_raises_either(spy_refund):
    pool, conn = _pool(fail_on="billed_inr")
    await _refund_credits(pool, TX, "run-abcdef12", "run failed")
