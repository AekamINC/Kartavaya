"""
`services/ai_router.py` no longer moves money — it delegates. These pin that.

Before migration 095 this one file held three of the product's five disagreeing
debit implementations. `deduct_credits` spent `staging.hub_credit_wallets`, a
per-CLIENT wallet with 53 rows that no report totals and no invoice bills, while
`deduct_org_credits` spent the org wallet that everything else reads — so the
same generation cost a customer a different pot depending on which route reached
it, and the only top-up form in the frontend wrote the pot nobody could spend.
`_maybe_reset_monthly_credits` did `SET balance = $1`, destroying purchased
credits the client had already been invoiced for and calling it a 'reset' in the
ledger. `refund_org_credits` named an agent type rather than a transaction, so it
could only ever return that type's LIST price — never what was actually charged.

All four survive as names because callers and `tests/test_skill_module_access.py`
pin them. None of them may survive as logic. What these tests defend is exactly
that boundary: that the wrappers forward, that they forward the right thing, and
that this file never again contains a sentence Postgres would execute against a
credit table.

The `services.credits` module is STUBBED here, deliberately. C2 owns the money
arithmetic and tests it exhaustively; duplicating any of it would mean two files
that must agree about bucket order and the second one going stale. What is under
test is the wrapper — that and nothing else.
"""
import sys

import pytest
from unittest.mock import AsyncMock

import services
import services.ai_router as R


ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "22222222-2222-2222-2222-222222222222"
USER = "user_test001"
TX = "33333333-3333-3333-3333-333333333333"


# ── the stub half of the boundary ───────────────────────────────────────────

class _Receipt:
    """Only the field the wrappers read. A fuller shape would be a second,
    drifting copy of C2's dataclass."""

    def __init__(self, balance_after):
        self.balance_after = balance_after


class _FakeCredits:
    def __init__(self):
        self.calls = []            # every entry point, in order
        self.spends = []
        self.refunds = []
        self.balance_after = 0
        self.spend_raises = None
        self.lookup_raises = None
        self.lookup_result = None
        self.refund_result_is_none = False

    async def spend_standalone(self, **kwargs):
        self.calls.append(("spend_standalone",))
        if self.spend_raises:
            raise self.spend_raises
        self.spends.append(kwargs)
        return _Receipt(self.balance_after)

    async def balance_of(self, conn, org_id, *, for_update=False):
        self.calls.append(("balance_of", conn, org_id, for_update))
        return None

    async def roll_period(self, conn, org_id):
        self.calls.append(("roll_period", conn, org_id))
        return None

    async def latest_spend_id(self, conn, org_id, *, user_id=None, kind=None,
                              ref_id=None, since=None):
        self.calls.append(("latest_spend_id", org_id, user_id, kind, ref_id, since))
        if self.lookup_raises:
            raise self.lookup_raises
        return self.lookup_result

    async def refund_standalone(self, *, tx_id, reason, user_id=None):
        self.calls.append(("refund_standalone", tx_id))
        if self.refund_result_is_none:
            return None
        self.refunds.append({"tx_id": tx_id, "reason": reason, "user_id": user_id})
        return _Receipt(self.balance_after)


class _Conn:
    def __init__(self):
        self.executed = []

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self_):
                return conn

            async def __aexit__(self_, *a):
                return False

        return _T()

    async def execute(self, sql, *args):
        self.executed.append(sql)
        return "OK"

    async def fetchrow(self, sql, *args):
        self.executed.append(sql)
        return None


class _Pool:
    def __init__(self, conn, fetchval_result=None):
        self._conn = conn
        self._fetchval_result = fetchval_result
        self.fetchvals = []

    async def fetchval(self, sql, *args):
        self.fetchvals.append(sql)
        return self._fetchval_result

    def acquire(self):
        conn = self._conn

        class _A:
            async def __aenter__(self_):
                return conn

            async def __aexit__(self_, *a):
                return False

        return _A()


@pytest.fixture
def credits_stub(monkeypatch):
    """Stand a fake in for `services.credits`.

    Both the sys.modules entry and the package attribute, because
    `from services import credits` will take whichever it finds first and a test
    that patched only one would pass against the real module by accident.
    """
    fake = _FakeCredits()
    monkeypatch.setitem(sys.modules, "services.credits", fake)
    monkeypatch.setattr(services, "credits", fake, raising=False)
    return fake


@pytest.fixture
def pool(monkeypatch):
    def _install(fetchval_result=None):
        conn = _Conn()
        p = _Pool(conn, fetchval_result)
        monkeypatch.setattr(R, "get_pool", AsyncMock(return_value=p))
        return p, conn
    return _install


# ── deduct_org_credits ──────────────────────────────────────────────────────

async def test_org_deduction_is_forwarded_and_priced_by_kind(credits_stub):
    """
    The wrapper hands over `(kind='content', ref_id=agent_type)` and nothing else.

    It must NOT look a price up itself. `CREDIT_COSTS.get(agent_type, 2)` is how
    'chatbot' and 'content' came to cost 2 credits nobody had decided — a
    fallthrough that read as a decision. The resolver refuses an unpriced kind;
    a wrapper that kept its own dict would quietly reinstate the guess.
    """
    credits_stub.balance_after = 97

    assert await R.deduct_org_credits(ORG, USER, "blog") == 97

    assert len(credits_stub.spends) == 1
    spend = credits_stub.spends[0]
    assert spend["org_id"] == ORG
    assert spend["user_id"] == USER
    assert spend["kind"] == "content"
    assert spend["ref_id"] == "blog"
    assert "credits" not in spend and "cost" not in spend


async def test_org_deduction_keeps_the_callers_description(credits_stub):
    """`run_org_skill` passes a description naming the skill; the ledger shows it."""
    await R.deduct_org_credits(ORG, USER, "image", "Skill: Weekly digest — image")

    assert credits_stub.spends[0]["description"] == "Skill: Weekly digest — image"


async def test_org_deduction_defaults_the_description_as_it_always_did(credits_stub):
    await R.deduct_org_credits(ORG, USER, "image")

    assert credits_stub.spends[0]["description"] == "image generation"


async def test_a_failed_spend_is_not_swallowed(credits_stub):
    """
    A debit that cannot be made must reach the caller.

    `run_org_skill` catches it to mark the run failed; `POST /org/generate` turns
    it into the 402 the customer sees. A wrapper that returned 0 on refusal would
    let the generation proceed unpaid.
    """
    from fastapi import HTTPException
    credits_stub.spend_raises = HTTPException(402, "Credits exhausted")

    with pytest.raises(HTTPException) as e:
        await R.deduct_org_credits(ORG, USER, "blog")
    assert e.value.status_code == 402


# ── deduct_credits — the client wallet is gone ──────────────────────────────

async def test_client_deduction_charges_the_org_not_the_client_wallet(credits_stub, pool):
    """
    THE defect this wrapper exists to close.

    `staging.hub_credit_wallets` holds 53 per-client rows that no debit path in
    the product can turn into anything, and the frontend's top-up form is the
    only thing that writes it. Charging it meant the customer's real balance
    never moved and their top-up bought nothing.
    """
    p, conn = pool(fetchval_result=ORG)
    credits_stub.balance_after = 88

    assert await R.deduct_credits(CLIENT, "social_media", USER) == 88

    assert credits_stub.spends[0]["org_id"] == ORG
    assert credits_stub.spends[0]["ref_id"] == "social_media"
    # Not one statement against the per-client wallet, in either direction.
    assert all("hub_credit_wallets" not in s for s in conn.executed)
    assert all("hub_credit_transactions" not in s for s in conn.executed)
    assert conn.executed == []


async def test_client_deduction_resolves_the_org_from_the_client(credits_stub, pool):
    p, _ = pool(fetchval_result=ORG)

    await R.deduct_credits(CLIENT, "email", USER)

    assert len(p.fetchvals) == 1
    assert "hub_clients" in p.fetchvals[0]
    assert "org_id" in p.fetchvals[0]


async def test_a_client_with_no_org_is_a_404_not_a_charge(credits_stub, pool):
    """
    It used to 404 with 'Credit wallet not found', which named the wrong thing:
    the wallet was missing because the client was.
    """
    from fastapi import HTTPException
    pool(fetchval_result=None)

    with pytest.raises(HTTPException) as e:
        await R.deduct_credits(CLIENT, "email", USER)

    assert e.value.status_code == 404
    assert credits_stub.spends == []


async def test_client_deduction_without_a_user_still_charges(credits_stub, pool):
    """`prachar_ads` calls this with no user_id. That must bill the org, not skip.

    `if body.client_id:` there meant omitting one field made a 5-credit ad
    analysis free; the wrapper must not add a second way to spend nothing.
    """
    pool(fetchval_result=ORG)

    await R.deduct_credits(CLIENT, "ad_analysis")

    assert credits_stub.spends[0]["user_id"] is None
    assert credits_stub.spends[0]["ref_id"] == "ad_analysis"


# ── _maybe_reset_monthly_credits ────────────────────────────────────────────

async def test_the_roll_is_delegated_whole(credits_stub):
    """
    One call, no arithmetic of its own.

    Everything the old body did was wrong in a way that cost money: `SET balance
    = $1` destroyed purchased credits the client had been invoiced for, and
    `if not org_credits` treated a negotiated 0 as absent and handed the org the
    plan default every month. Neither may reappear here in any form.
    """
    conn = _Conn()

    await R._maybe_reset_monthly_credits(conn, ORG)

    assert [c[0] for c in credits_stub.calls] == ["roll_period"]
    assert conn.executed == [], "the wrapper runs no SQL of its own"


async def test_the_roll_runs_in_the_callers_transaction(credits_stub):
    """It never acquires. `routers/hub.py` and `routers/scrapers.py` both call it
    inside a transaction they opened, and a roll committed in a different one is
    a roll their rollback cannot undo.

    The lock is `roll_period`'s to take — it does so itself "so a caller cannot
    forget". A second one here would be a redundant round trip on a path
    `GET /hub/org/credits` hits on every read.
    """
    conn = _Conn()

    # No pool is patched in this test: a wrapper that acquired its own
    # connection would reach the real `get_pool` and fail.
    await R._maybe_reset_monthly_credits(conn, ORG)

    assert credits_stub.calls[0][1] is conn


# ── refund_org_credits ──────────────────────────────────────────────────────

async def test_refund_names_a_transaction_not_a_price(credits_stub, pool):
    """
    The old signature took an agent type, so it could only return that type's
    LIST price — never what was actually charged, and never a trued-up scraper
    run, which has no agent type at all. Handing `credits.refund` a transaction
    id is what makes the amount, the bucket and the refund-once guarantee real.
    """
    pool()
    credits_stub.lookup_result = TX
    credits_stub.balance_after = 103

    assert await R.refund_org_credits(ORG, USER, "image", "Refund — image failed") == 103

    assert credits_stub.refunds == [
        {"tx_id": TX, "reason": "Refund — image failed", "user_id": USER}
    ]


async def test_refund_looks_the_debit_up_by_agent_type_and_user(credits_stub, pool):
    """
    Matched on `ref_id`, never on `kind`.

    A skill step is charged as `skill_step` and a one-off generation as
    `content`, and both reach this wrapper through the same three-argument call.
    Filtering on `kind` would silently refuse to refund half of them.
    """
    pool()
    credits_stub.lookup_result = TX

    await R.refund_org_credits(ORG, USER, "image")

    call = [c for c in credits_stub.calls if c[0] == "latest_spend_id"][0]
    _, org_id, user_id, kind, ref_id, since = call
    assert org_id == ORG
    assert user_id == USER
    assert kind is None
    assert ref_id == "image"
    assert since is not None, "the search window must be bounded"


async def test_refund_defaults_the_reason_as_it_always_did(credits_stub, pool):
    pool()
    credits_stub.lookup_result = TX

    await R.refund_org_credits(ORG, USER, "blog")

    assert credits_stub.refunds[0]["reason"] == "Refund — blog did not complete"


async def test_nothing_to_refund_is_silent(credits_stub, pool):
    """Not an error. There is no charge to reverse — and nothing is guessed at."""
    pool()
    credits_stub.lookup_result = None

    assert await R.refund_org_credits(ORG, USER, "image") == 0
    assert credits_stub.refunds == []
    assert not any(c[0] == "refund_standalone" for c in credits_stub.calls)


async def test_a_refund_that_could_not_be_placed_returns_zero(credits_stub, pool):
    """
    `refund_standalone` returns None rather than raising, and logs what the
    customer is owed. The wrapper's contract is the older, blunter one: 0.
    """
    pool()
    credits_stub.lookup_result = TX
    credits_stub.refund_result_is_none = True

    assert await R.refund_org_credits(ORG, USER, "image") == 0


async def test_a_failing_lookup_never_raises(credits_stub, pool):
    """
    It runs inside an `except` that is already handling a failure. A refund that
    throws replaces a lost 3 credits with a 500, turning a billing slip into an
    outage for a user who is waiting on text that already generated.
    """
    pool()
    credits_stub.lookup_raises = RuntimeError("db down")

    assert await R.refund_org_credits(ORG, USER, "image") == 0


# ── the wrappers are honest about what they cannot do ───────────────────────

async def test_two_wrapper_calls_never_share_an_idempotency_key(credits_stub, pool):
    """
    These wrappers have NO idempotency and must not pretend otherwise.

    All they receive is `(org_id, user_id, agent_type)`. A key built from those
    would collapse two legitimate generations of the same kind, minutes apart,
    into a replay — and silently bill for one. Charging twice on a retry is what
    this code has always done; under-billing without anyone noticing would be
    new. A caller that can name its unit of work calls `credits.spend` and gets
    the real guarantee.
    """
    pool(fetchval_result=ORG)

    await R.deduct_org_credits(ORG, USER, "blog")
    await R.deduct_org_credits(ORG, USER, "blog")
    await R.deduct_credits(CLIENT, "blog", USER)

    keys = [s["idempotency_key"] for s in credits_stub.spends]
    assert all(k for k in keys), "spend() requires a key; none may be blank"
    assert len(set(keys)) == 3


# ── the file itself ─────────────────────────────────────────────────────────

def _source() -> str:
    from pathlib import Path
    return Path(R.__file__).read_text(encoding="utf-8")


def test_this_file_names_no_credit_table():
    """
    A local, early mirror of `tests/test_credits_isolation.py`.

    That test walks the whole tree and fails in C2's suite; this one fails here,
    where the sentence would have been written. Three of the product's five debit
    implementations lived in this file, and the way a fourth gets added is
    somebody reaching for a query because it is quicker than a function call.

    Text, not AST: a table named in a comment is as much of a second reference as
    one named in a query, because it is what the next author copies.
    """
    src = _source()
    for table in ("hub_org_credits", "hub_org_credit_transactions",
                  "org_member_credits", "credit_prices"):
        assert table not in src, (
            f"{table} is named in services/ai_router.py. Credit tables belong to "
            f"services/credits.py alone."
        )


def test_credit_costs_survives_as_a_constant_and_is_read_by_nothing():
    """
    `CREDIT_COSTS` stays BOUND — `tests/test_credit_refund.py` and
    `tests/test_skill_template_validation.py:229` import it by name — and stays
    UNREAD, because it is no longer the price list. Values are pinned so that a
    price change and a plumbing change can never ship together; if they do,
    nobody can tell which one moved the bill.
    """
    assert R.CREDIT_COSTS == {
        "social_media": 2, "blog": 5, "ad_copy": 3, "email": 2, "whatsapp": 1,
        "lead_magnet": 8, "campaign": 10, "seo": 8, "ad_analysis": 5, "image": 3,
    }
    assert R.CREDIT_PRICE_INR == 4

    src = _source()
    assert "CREDIT_COSTS.get(" not in src, "the .get(x, 2) fallback is what 095 removed"
    assert "CREDIT_COSTS[" not in src


def test_credits_is_imported_lazily_not_at_module_scope():
    """
    Every router in the product imports this module. A module-level
    `from services import credits` would take the whole API down if that file
    were a minute behind in a deploy, and it is one edit away from an import
    cycle the moment credits.py wants anything from here.
    """
    src = _source()
    head = src.split("def ", 1)[0]
    assert "import credits" not in head
    assert "from services import credits" in src
