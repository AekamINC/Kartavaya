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

WHAT 095 CHANGED UNDER THIS FILE
────────────────────────────────
`refund_org_credits` no longer moves money itself. It resolves an agent type back
to the transaction that charged for it — `credits.latest_spend_id`, which issues
a `fetch` — and hands that id to `credits.refund`.

The double this file used to carry had no `fetch`. So `latest_spend_id` raised
`AttributeError`, the shim's own `except` swallowed it, every refund under test
took the `return 0` branch, and five tests asserted against a wallet that nothing
had touched. They were green over a refund that never happened. A double that
cannot answer the query its subject makes is not a smaller database, it is a
different one — so `_DB` below stands in for the four tables this path actually
reads and writes, and rolls back on an exception the way the transaction it is
standing in for would.

The tests seed their debits by calling `credits.spend` — the function the product
charges through — rather than by writing a balance and asserting it comes back. A
refund is only correct relative to a charge, and the two must agree about the
bucket, the price and the member's counter or the wallet drifts.

WHAT THE ASSERTIONS NAME NOW
────────────────────────────
· PRICE. `credits.price_of` reading `staging.credit_prices`, never
  `ai_router.CREDIT_COSTS`. That dict is deprecated, prices nothing, and an
  assertion against it would pass whatever the resolver did — which is the whole
  failure mode 095 exists to end. One test below deliberately sets a price the
  dict disagrees with.
· THE MEMBER ROW. `org_member_credits.spent_credits`, not `hub_user_credits`.
  The owner's model changed underneath: a member allocation is a CEILING on the
  shared org balance, never a second wallet, so a refund FREES the member's
  period spend rather than crediting a member's pot. See the note on
  `test_a_refund_frees_the_members_period_spend`.
· THE BUCKET. A refund returning the right TOTAL to the wrong bucket is still
  money in the wrong pocket — allowance is destroyed at the next roll, purchased
  is not — so the two buckets are asserted separately.
"""
import re
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

import services.credits as C
from services.ai_router import CREDIT_COSTS, refund_org_credits

ORG = "11111111-1111-1111-1111-111111111111"

# The shape `auth_router` actually mints: `user_` + 12 hex, TEXT, never a uuid.
# Every user_id column on this path is TEXT and nothing on it casts, which is why
# the double keys its member rows on the string exactly as it is handed over.
USER = "user_a1b2c3d4e5f6"
OTHER_USER = "user_f6e5d4c3b2a1"


# ── the double ──────────────────────────────────────────────────────────────

class _UniqueViolation(Exception):
    """What asyncpg raises. `credits._is_unique_violation` matches on the
    sqlstate rather than the class precisely so a double like this one behaves
    the same as the driver."""
    sqlstate = "23505"


def _norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


class _DB:
    """staging.{organisations, hub_org_credits, org_member_credits,
    hub_org_credit_transactions, credit_prices}, in dicts.

    Only the columns this path names. A test that needs a fifth table has drifted
    out of what `refund_org_credits` touches and belongs in test_credit_model.py.
    """

    def __init__(self):
        self.orgs = {}
        self.wallets = {}
        self.members = {}
        self.txns = []
        # The prices migration 095 seeds, for the kinds this file charges. Read
        # through `credits.price_of` like everything else — the values are here
        # so the fake table has rows, not so a test can assert against them.
        self.prices = {"image": (3, 1, True), "blog": (5, 1, True),
                       "email": (2, 1, True), "whatsapp": (1, 1, True)}
        self._seq = 0
        # Ledger rows are ordered by `created_at` and `latest_spend_id` bounds on
        # it, so the clock has to be real time and has to advance. An hour back
        # leaves room for a test to backdate a row past the shim's one-day bound.
        self._clock = datetime.now(timezone.utc) - timedelta(hours=1)

    # ── seeding ──
    def org(self, org_id=ORG, *, monthly_credits=100, is_platform_org=False,
            allowance=0, purchased=0, wallet=True):
        self.orgs[org_id] = {"monthly_credits": monthly_credits,
                             "is_platform_org": is_platform_org}
        if wallet:
            self.wallets[org_id] = {"allowance": allowance, "purchased": purchased,
                                    "balance": allowance + purchased,
                                    "period_start": C.current_period()}
        return org_id

    def cap(self, org_id, user_id, cap, spent=0):
        self.members[(org_id, user_id, C.current_period())] = {
            "cap_credits": cap, "spent_credits": spent, "set_by": "seed",
        }

    def debit(self, *, org_id=ORG, user_id=USER, credits=3, kind="content",
              ref_id="image", from_allowance=None, from_purchased=0,
              metered_only=False):
        """A debit row written straight into the ledger, bypassing `spend`.

        For the two cases a real `spend` cannot produce: a charge whose member
        counter was never bumped (the pre-095 path wrote `hub_user_credits`
        instead), and a charge against an org whose wallet row has since gone.
        Everything else seeds through `spend`, because a hand-written debit can
        agree with a refund about a number the product would have disagreed on.
        """
        alw = credits - from_purchased if from_allowance is None else from_allowance
        return self._append(
            org_id=org_id, user_id=user_id, amount=-credits, balance_after=0,
            tx_type=C.TX_DEBIT, description=f"{ref_id} generation", created_by=user_id,
            kind=kind, ref_id=ref_id, quantity=1,
            allowance_delta=-alw, purchased_delta=-from_purchased,
            idempotency_key=f"seed:{ref_id}:{self._seq}", reverses_tx_id=None,
            metered_only=metered_only, period_start=C.current_period(),
        )

    def backdate(self, tx, *, days):
        tx["created_at"] = tx["created_at"] - timedelta(days=days)
        return tx

    # ── what the assertions read ──
    def wallet(self, org_id=ORG):
        return self.wallets.get(org_id)

    def member(self, org_id, user_id):
        return self.members.get((org_id, user_id, C.current_period()))

    def of_type(self, tx_type):
        return [t for t in self.txns if t["tx_type"] == tx_type]

    # ── rollback ──
    # `refund_standalone` runs inside a transaction and `_write_ledger` inside a
    # savepoint. Without this the fake would leave a half-written refund behind
    # after a failed statement and the "never raises" tests would be asserting
    # over state the database would never have kept.
    def snapshot(self):
        return (list(self.txns),
                {k: dict(v) for k, v in self.wallets.items()},
                {k: dict(v) for k, v in self.members.items()})

    def restore(self, snap):
        txns, wallets, members = snap
        self.txns[:] = txns
        self.wallets.clear()
        self.wallets.update(wallets)
        self.members.clear()
        self.members.update(members)

    def _append(self, **row):
        self._seq += 1
        self._clock += timedelta(seconds=1)
        row["id"] = f"tx-{self._seq:04d}"
        row["created_at"] = self._clock
        self.txns.append(row)
        return row


class _Conn:
    """Dispatches on SQL substrings. Deliberately strict: an unrecognised
    statement raises rather than returning None, so a change to credits.py that
    this fake does not model fails loudly here instead of passing quietly with a
    wallet that never moved — which is exactly how this file came to be red."""

    def __init__(self, db: _DB):
        self.db = db
        #: Substring of a normalised statement that must raise. Set AFTER seeding,
        #: so a test can fail one statement of the refund without failing the
        #: spend that set it up.
        self.fail_on = None

    def _guard(self, q):
        if self.fail_on and self.fail_on in q:
            raise RuntimeError("statement failed")

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self_):
                self_.snap = conn.db.snapshot()
                return conn

            async def __aexit__(self_, exc_type, *a):
                if exc_type is not None:
                    conn.db.restore(self_.snap)
                return False

        return _T()

    # ── reads ──
    async def fetch(self, sql, *args):
        q = _norm(sql)
        self._guard(q)

        if "FROM public.credit_prices" in q:
            return [{"kind": k, "credits": c, "unit_size": u, "is_active": a}
                    for k, (c, u, a) in self.db.prices.items()]

        if "FROM public.hub_org_credit_transactions" in q and "t.tx_type='debit'" in q:
            return self._latest_spend(*args)

        raise AssertionError(f"_Conn.fetch does not model: {q[:140]}")

    async def fetchrow(self, sql, *args):
        q = _norm(sql)
        self._guard(q)

        if "INSERT INTO public.hub_org_credit_transactions" in q:
            return self._insert_tx(args)

        if "FROM public.organisations" in q:
            org = self.db.orgs.get(args[0])
            if org is None:
                return None
            return {"id": args[0], "monthly_credits": org["monthly_credits"],
                    "is_platform_org": org["is_platform_org"]}

        if "FROM public.hub_org_credits" in q:
            w = self.db.wallets.get(args[0])
            if w is None:
                return None
            return {"allowance_balance": w["allowance"],
                    "purchased_balance": w["purchased"],
                    "balance": w["balance"], "period_start": w["period_start"]}

        if "FROM public.hub_org_credit_transactions" in q:
            if "idempotency_key=$1" in q:
                return self._find(lambda t: args[0] is not None
                                  and t["idempotency_key"] == args[0])
            if "WHERE id=$1::uuid" in q:
                return self._find(lambda t: t["id"] == args[0])
            if "reverses_tx_id=$1::uuid" in q:
                return self._find(lambda t: t["reverses_tx_id"] == args[0])

        if "FROM public.org_member_credits" in q:
            row = self.db.members.get((args[0], args[1], args[2]))
            return None if row is None else dict(row)

        raise AssertionError(f"_Conn.fetchrow does not model: {q[:140]}")

    # ── writes ──
    async def execute(self, sql, *args):
        q = _norm(sql)
        self._guard(q)

        if "INSERT INTO public.hub_org_credits" in q:
            self.db.wallets.setdefault(args[0], {
                "allowance": 0, "purchased": 0, "balance": 0, "period_start": args[1],
            })
            return "INSERT 0 1"

        if "UPDATE public.hub_org_credits" in q:
            rolling = "period_start=$3::date" in q
            w = self.db.wallets[args[3] if rolling else args[2]]
            w["allowance"], w["purchased"] = args[0], args[1]
            w["balance"] = args[0] + args[1]
            if rolling:
                w["period_start"] = args[2]
            return "UPDATE 1"

        if "INSERT INTO public.org_member_credits" in q and "NULL, $4, NULL" in q:
            key = (args[0], args[1], args[2])
            row = self.db.members.get(key)
            if row is None:
                self.db.members[key] = {"cap_credits": None,
                                        "spent_credits": args[3], "set_by": None}
            else:
                row["spent_credits"] += args[3]
            return "INSERT 0 1"

        if "UPDATE public.org_member_credits" in q and "GREATEST" in q:
            row = self.db.members.get((args[1], args[2], args[3]))
            if row is not None:
                row["spent_credits"] = max(row["spent_credits"] - args[0], 0)
            return "UPDATE 1"

        raise AssertionError(f"_Conn.execute does not model: {q[:140]}")

    # ── internals ──
    def _find(self, pred):
        for t in self.db.txns:
            if pred(t):
                return dict(t)
        return None

    def _latest_spend(self, org_id, user_id, kind, ref_id, since):
        """Every filter `latest_spend_id` emits, honoured.

        The `NOT EXISTS` clause is what makes the shim refund-once even though it
        never sees a transaction id, and the `since` bound is what stops a
        failure today reaching into last month's ledger. A fake that returned the
        newest row of any type would pass this file and mean nothing.
        """
        reversed_ids = {t["reverses_tx_id"] for t in self.db.txns if t["reverses_tx_id"]}
        rows = [
            t for t in self.db.txns
            if t["org_id"] == org_id
            and t["tx_type"] == C.TX_DEBIT
            and (user_id is None or t["user_id"] == user_id)
            and (kind is None or t["kind"] == kind)
            and (ref_id is None or t["ref_id"] == ref_id)
            and (since is None or t["created_at"] >= since)
            and t["id"] not in reversed_ids
        ]
        rows.sort(key=lambda t: t["created_at"], reverse=True)
        return [dict(t) for t in rows[:1]]

    def _insert_tx(self, args):
        (org_id, user_id, amount, balance_after, tx_type, description, created_by,
         kind, ref_id, quantity, allowance_delta, purchased_delta,
         idempotency_key, reverses_tx_id, metered_only, period_start) = args

        # uq_org_credit_tx_reverses is the mechanism behind refund-once, and
        # uq_org_credit_tx_idempotency behind charge-once. A fake that let a
        # duplicate through would pass a test the database would fail.
        for t in self.db.txns:
            if idempotency_key is not None and t["idempotency_key"] == idempotency_key:
                raise _UniqueViolation("uq_org_credit_tx_idempotency")
            if reverses_tx_id is not None and t["reverses_tx_id"] == reverses_tx_id:
                raise _UniqueViolation("uq_org_credit_tx_reverses")

        row = self.db._append(
            org_id=org_id, user_id=user_id, amount=amount,
            balance_after=balance_after, tx_type=tx_type, description=description,
            created_by=created_by, kind=kind, ref_id=ref_id, quantity=quantity,
            allowance_delta=allowance_delta, purchased_delta=purchased_delta,
            idempotency_key=idempotency_key, reverses_tx_id=reverses_tx_id,
            metered_only=metered_only, period_start=period_start,
        )
        return {"id": row["id"]}


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
def db():
    return _DB()


@pytest.fixture
def conn(db):
    return _Conn(db)


@pytest.fixture(autouse=True)
def patch_pool(monkeypatch, conn):
    """Both pools, because the path crosses two modules.

    `refund_org_credits` reads the ledger on `ai_router`'s pool and then hands
    off to `credits.refund_standalone`, which acquires its own on
    `credits`. Patching one leaves the other reaching for a real database.
    """
    import services.ai_router as R

    pool = _Pool(conn)
    monkeypatch.setattr(R, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(C, "get_pool", AsyncMock(return_value=pool))
    return conn


async def _charge(conn, *, org_id=ORG, user_id=USER, kind="content", ref_id="image",
                  key=None):
    """Charge the way the product charges. Returns the Receipt.

    The key is drawn off the ledger sequence so two charges in one test cannot
    collide: a collision does not double-charge, it makes the second spend a
    replay and hands back the first one's receipt, which would look exactly like
    a refund test that had set itself up correctly.
    """
    return await C.spend(
        conn, org_id=org_id, user_id=user_id, kind=kind, ref_id=ref_id,
        idempotency_key=key or f"test:{ref_id}:{conn.db._seq}",
        description=f"{ref_id} generation",
    )


# ── the refund happens at all ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refund_restores_the_balance_and_records_it(db, conn):
    """The whole point: what was charged comes back, and the ledger says so."""
    db.org(allowance=100)
    receipt = await _charge(conn)
    assert db.wallet()["allowance"] == 100 - receipt.credits

    new_balance = await refund_org_credits(ORG, USER, "image", "Refund — image failed")

    assert new_balance == 100
    assert db.wallet()["allowance"] == 100

    # A POSITIVE amount, not a negative debit. A refund and a top-up are
    # different events and the ledger is what anyone reads to work out where a
    # month went.
    refunds = db.of_type(C.TX_REFUND)
    assert len(refunds) == 1
    assert refunds[0]["amount"] == receipt.credits
    assert refunds[0]["balance_after"] == 100
    assert refunds[0]["description"] == "Refund — image failed"

    # And it NAMES the debit it reverses. This column is the refund-once index,
    # so a reversal that did not carry it could be written twice.
    assert refunds[0]["reverses_tx_id"] == receipt.tx_id


@pytest.mark.asyncio
async def test_deduct_then_refund_is_a_no_op_on_both_buckets(db, conn):
    """A charged-then-failed run must leave the wallet where it started.

    Asserted bucket by bucket, and seeded so the spend STRADDLES the seam. The
    total alone cannot catch the error that matters: allowance is destroyed at
    the next roll and purchased is not, so returning the right number of credits
    to the wrong bucket either mints carry-over out of a grant that was going to
    expire, or quietly destroys credits the client was invoiced for.
    """
    db.org(allowance=2, purchased=10)

    receipt = await _charge(conn)                      # image, 3 credits
    assert (receipt.from_allowance, receipt.from_purchased) == (2, 1)
    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (0, 9)

    await refund_org_credits(ORG, USER, "image")

    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (2, 10)


# ── the member's counter ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_refund_frees_the_members_period_spend(db, conn):
    """The debit raises the member's period spend; the refund has to lower it.

    THE MODEL CHANGED HERE and the assertion changed with it. This test used to
    read `hub_user_credits.used`, a per-member pot that the old debit drew down
    as though it were a second wallet. The owner settled 2026-08-04 that a member
    allocation is a CEILING on the shared org balance and nothing is ever taken
    from a member — so what a refund gives back is HEADROOM under the ceiling,
    counted in `org_member_credits.spent_credits`, and the ceiling itself never
    moves. Asserting the old shape would now be asserting a wallet that no longer
    exists.
    """
    db.org(allowance=100)
    db.cap(ORG, USER, cap=50)

    receipt = await _charge(conn)
    assert db.member(ORG, USER)["spent_credits"] == receipt.credits

    await refund_org_credits(ORG, USER, "image")

    assert db.member(ORG, USER)["spent_credits"] == 0
    assert db.member(ORG, USER)["cap_credits"] == 50, "the ceiling is not a balance"


@pytest.mark.asyncio
async def test_a_members_spend_counter_never_goes_negative(db, conn):
    """
    `GREATEST(spent_credits - $1, 0)`.

    Reachable because the two halves have different histories. A debit taken
    before 095 bumped `hub_user_credits` and never touched this counter, so
    refunding one against a counter that only knows about later spends would
    drive it below zero — and a negative spend is free headroom under every
    ceiling that member has.
    """
    db.org(allowance=100)
    db.cap(ORG, USER, cap=50, spent=1)
    db.debit(credits=3)                       # never bumped the counter

    await refund_org_credits(ORG, USER, "image")

    assert db.member(ORG, USER)["spent_credits"] == 0


# ── the price ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("agent_type", ["image", "blog", "whatsapp"])
async def test_the_amount_is_whatever_the_price_resolver_says(db, conn, agent_type):
    """
    One price list, and it is `credits.price_of` reading `credit_prices`.

    What the spend took is what the refund returns, so both have to be reading
    the same row. Asserted against the resolver rather than a literal, because a
    literal here is a second price list and the drift would be money.
    """
    price = await C.price_of(conn, "content", agent_type)
    db.org(allowance=price)

    receipt = await _charge(conn, ref_id=agent_type)
    assert receipt.credits == price
    assert db.wallet()["allowance"] == 0

    assert await refund_org_credits(ORG, USER, agent_type) == price
    assert db.wallet()["allowance"] == price


@pytest.mark.asyncio
async def test_the_price_table_wins_over_the_legacy_credit_costs_dict(db, conn):
    """
    `ai_router.CREDIT_COSTS` prices nothing now and must not be able to.

    It is still bound — two test files import it — which is precisely the danger:
    a refund that read it would agree with the spend today and disagree the
    morning the owner reprices a channel, because the table is editable without a
    deploy and the dict is not. So this test moves the table underneath a kind
    the dict also knows about, and requires the refund to follow the table.
    """
    db.prices["image"] = (7, 1, True)
    assert 7 != CREDIT_COSTS["image"], "pick a price the legacy dict disagrees with"
    db.org(allowance=7)

    await _charge(conn)
    assert db.wallet()["allowance"] == 0

    assert await refund_org_credits(ORG, USER, "image") == 7
    assert db.of_type(C.TX_REFUND)[0]["amount"] == 7


# ── what it will not do ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_nothing_to_refund_is_silent(db, conn):
    """No debit matches. Not an error — there is no charge to reverse.

    The shim is called from an `except` and cannot tell "this run was never
    charged" from "this run's charge is somebody else's row". Returning 0 and
    logging is the honest answer; raising would turn a run that produced nothing
    into a run that produced a 500.
    """
    db.org(allowance=100)

    assert await refund_org_credits(ORG, USER, "image") == 0
    assert db.txns == []
    assert db.wallet()["allowance"] == 100


@pytest.mark.asyncio
async def test_another_members_debit_is_not_reachable(db, conn):
    """The shim matches on the user as well as the agent type.

    Two people generating the same kind of image in the same minute is ordinary,
    and one of them failing must not reverse the other's charge — the balance
    would land in the right place and the ledger would bill the wrong person.
    """
    db.org(allowance=100)
    await _charge(conn, user_id=OTHER_USER)

    assert await refund_org_credits(ORG, USER, "image") == 0
    assert db.of_type(C.TX_REFUND) == []


@pytest.mark.asyncio
async def test_a_debit_older_than_a_day_is_out_of_reach(db, conn):
    """
    The `since` bound in the shim.

    A refund follows its charge by seconds inside one request, so a day is
    already absurdly generous. The bound is what stops a failure today reversing
    a charge from a month that has been invoiced and closed.
    """
    db.org(allowance=100)
    db.backdate(db.debit(credits=3), days=2)

    assert await refund_org_credits(ORG, USER, "image") == 0
    assert db.of_type(C.TX_REFUND) == []
    assert db.wallet()["allowance"] == 100


@pytest.mark.asyncio
async def test_a_second_refund_of_the_same_failure_writes_nothing(db, conn):
    """Refund-once, through a shim that never sees a transaction id.

    `latest_spend_id` excludes anything already reversed, so the second call
    finds no candidate and answers 0 — the same "nothing to do" as never having
    been charged. The unique index behind `reverses_tx_id` is the real guard;
    this is the one that stops the shim asking it twice.
    """
    db.org(allowance=100)
    await _charge(conn)

    assert await refund_org_credits(ORG, USER, "image") == 100
    assert await refund_org_credits(ORG, USER, "image") == 0

    assert len(db.of_type(C.TX_REFUND)) == 1
    assert db.wallet()["allowance"] == 100


# ── it never raises ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("statement,where", [
    ("t.tx_type='debit'", "reading the ledger for the matching debit"),
    ("UPDATE public.hub_org_credits", "writing the wallet back"),
])
async def test_a_failing_refund_never_raises(db, conn, statement, where):
    """
    It runs inside an `except` that is already handling a failure.

    A refund that throws would replace a lost 3 credits with a 500, turning a
    billing slip into an outage — the caller has already produced text the user
    is waiting for. Both layers are covered: a failure resolving the transaction
    is caught by the shim, a failure inside the refund by `refund_standalone`,
    and either one leaves the wallet exactly as it was with the loss in the log.
    """
    db.org(allowance=100)
    await _charge(conn)
    before = dict(db.wallet())

    conn.fail_on = statement                  # after the charge, never during it

    assert await refund_org_credits(ORG, USER, "image") == 0, where
    assert db.wallet() == before
    assert db.of_type(C.TX_REFUND) == [], "a refund that did not happen must not be recorded"


# ── the wallet row itself ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_missing_wallet_row_is_healed_not_a_lost_refund(db, conn):
    """
    THE BEHAVIOUR CHANGED HERE, deliberately, and this test changed with it.

    It used to assert that a refund into an org with no `hub_org_credits` row was
    silently dropped. `balance_of` now heals the row instead, because the
    alternative is the dead org: created with 0 credits, no wallet row from
    either seed path, a permanent 402, and the only self-heal sitting behind a
    module gate. A zero balance is a balance.

    So the credits land rather than vanishing, and they land in the bucket the
    original spend recorded taking them from.
    """
    db.org(allowance=0, wallet=False)
    db.debit(credits=3)

    assert await refund_org_credits(ORG, USER, "image") == 3

    assert db.wallet() is not None, "the wallet row was not healed"
    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (3, 0)
