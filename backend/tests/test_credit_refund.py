"""
Credit refunds — the counterpart `deduct_org_credits` never had.

Every caller that spends before it generates was charging for failure. All three
image sites do exactly that: deduct, call `generate_image`, and on an exception
write a log line and carry on. The credits are gone and there is no image.

That is not a theoretical path. HuggingFace sits first in the image chain and has
answered `410 Gone` on every call since its serverless route for FLUX.1-dev was
retired — verified in the staging logs on 2026-07-30 — and the chain survives
only because OpenRouter is behind it. The day OpenRouter also fails, every
attempt bills.

Charging first is still correct: it is what stops concurrent runs from spending a
wallet twice. So the fix is the missing half, not a reordering, and these tests
pin the half.
"""
from unittest.mock import AsyncMock

import pytest

from services.ai_router import refund_org_credits, CREDIT_COSTS

ORG = "11111111-1111-1111-1111-111111111111"
USER = "user_test001"


class _Conn:
    """A connection over one org wallet and one user allocation."""

    def __init__(self, balance, user_used=None, fail_on=None):
        self.balance = balance
        self.user_used = user_used          # None => no allocation row
        self.fail_on = fail_on              # substring that makes a statement raise
        self.txns = []

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self_):
                return conn

            async def __aexit__(self_, *a):
                return False

        return _T()

    async def fetchrow(self, sql, *args):
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("wallet read failed")
        if "hub_org_credits" in sql:
            return None if self.balance is None else {"balance": self.balance}
        return None

    async def execute(self, sql, *args):
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("write failed")
        if "hub_user_credits" in sql:
            # GREATEST(used - $1, 0)
            if self.user_used is not None:
                self.user_used = max(self.user_used - args[0], 0)
        elif "UPDATE staging.hub_org_credits" in sql:
            self.balance = args[0]
        elif "hub_org_credit_transactions" in sql:
            self.txns.append({
                "amount": args[2], "balance_after": args[3], "description": args[4],
            })
        return "OK"


class _Pool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        conn = self._conn

        class _A:
            async def __aenter__(self_):
                return conn

            async def __aexit__(self_, *a):
                return False

        return _A()


@pytest.fixture
def patch_pool(monkeypatch):
    def _install(conn):
        import services.ai_router as R
        monkeypatch.setattr(R, "get_pool", AsyncMock(return_value=_Pool(conn)))
        return conn
    return _install


@pytest.mark.asyncio
async def test_refund_restores_the_balance_and_records_it(patch_pool):
    """The whole point: what was charged comes back, and the ledger says so."""
    conn = patch_pool(_Conn(balance=100))

    new_balance = await refund_org_credits(ORG, USER, "image", "Refund — image failed")

    cost = CREDIT_COSTS["image"]
    assert new_balance == 100 + cost
    assert conn.balance == 100 + cost

    # A POSITIVE amount, not a negative debit. A refund and a top-up are
    # different events and the ledger is what anyone reads to work out where a
    # month went.
    assert len(conn.txns) == 1
    assert conn.txns[0]["amount"] == cost
    assert conn.txns[0]["balance_after"] == 100 + cost
    assert conn.txns[0]["description"] == "Refund — image failed"


@pytest.mark.asyncio
async def test_deduct_then_refund_is_a_no_op_on_the_balance(patch_pool):
    """A charged-then-failed run must leave the wallet where it started."""
    cost = CREDIT_COSTS["image"]
    conn = patch_pool(_Conn(balance=100 - cost))   # as if the debit already ran

    await refund_org_credits(ORG, USER, "image")

    assert conn.balance == 100


@pytest.mark.asyncio
async def test_user_allocation_is_credited_back_too(patch_pool):
    """The debit raises `used` on the user row; the refund has to lower it."""
    cost = CREDIT_COSTS["image"]
    conn = patch_pool(_Conn(balance=50, user_used=10))

    await refund_org_credits(ORG, USER, "image")

    assert conn.user_used == 10 - cost


@pytest.mark.asyncio
async def test_user_used_never_goes_negative(patch_pool):
    """
    `GREATEST(used - $1, 0)`.

    The debit skips the user row entirely when none existed at the time, so a
    row created between the charge and the failure would otherwise be driven
    below zero by a refund it never received.
    """
    conn = patch_pool(_Conn(balance=50, user_used=1))

    await refund_org_credits(ORG, USER, "image")

    assert conn.user_used == 0


@pytest.mark.asyncio
async def test_missing_wallet_is_silent(patch_pool):
    """Nothing to refund into. Not an error — there is no charge to reverse."""
    conn = patch_pool(_Conn(balance=None))

    assert await refund_org_credits(ORG, USER, "image") == 0
    assert conn.txns == []


@pytest.mark.asyncio
async def test_a_failing_refund_never_raises(patch_pool):
    """
    It runs inside an `except` that is already handling a failure.

    A refund that throws would replace a lost 3 credits with a 500, turning a
    billing slip into an outage — the caller has already produced text the user
    is waiting for.
    """
    patch_pool(_Conn(balance=100, fail_on="hub_org_credits"))

    assert await refund_org_credits(ORG, USER, "image") == 0


@pytest.mark.asyncio
async def test_amount_follows_the_shared_cost_table(patch_pool):
    """
    One price list. `CREDIT_COSTS` is what `deduct_org_credits` charges, so it
    has to be what the refund returns — a second constant here would drift and
    the drift would be money.
    """
    for agent, expected in (("image", CREDIT_COSTS["image"]),
                            ("blog", CREDIT_COSTS["blog"]),
                            ("whatsapp", CREDIT_COSTS["whatsapp"])):
        conn = patch_pool(_Conn(balance=0))
        assert await refund_org_credits(ORG, USER, agent) == expected
