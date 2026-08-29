"""
The credit model itself — the eight promises nothing in this repo pinned.

Every other credits test in this tree checks a CALLER: does the scraper charge,
does the chatbot charge, is the burn rate net. This file checks the MODEL those
callers depend on, because each of the rules below was broken in production and
each broke silently — a wallet that is wrong by 500 credits looks exactly like a
wallet that is right.

What is pinned here, and what it cost when it was not:

1. A PURCHASED TOP-UP SURVIVES THE MONTHLY ROLL.
   The old reset was `SET balance = $1` (ai_router.py ~:700). It wrote the
   month's grant over the whole number, so a top-up the client had already been
   INVOICED FOR was destroyed on the first of the month — and the ledger row
   called it a 'reset', so nothing in any report showed credits going missing.
   This is the single most expensive line in the old model and it is the first
   test in this file.

2. A NEGOTIATED 0 STAYS 0.
   `if not org_credits` treated a deliberately agreed zero as "not configured"
   and handed the org the plan default every single month. Nothing distinguishes
   "we agreed you get nothing" from "nobody has said yet" to a falsy test.

3. SPEND DRAWS ALLOWANCE FIRST, INCLUDING ACROSS THE SEAM.
   The order is the whole reason two buckets exist. Draw purchased first and
   rule 1 becomes unobservable — the credits the client paid for leave the
   wallet before the ones that were going to expire anyway.

4. A MEMBER CEILING REFUSES, AND SAYS WHOSE PROBLEM IT IS.
   The chain of authority has two different remedies at two different levels: a
   member out of ceiling asks the ORG, an org out of balance asks Aekam. A
   refusal that names only one figure sends half the people to the wrong desk,
   so the message must carry the member's remainder AND the org's.

5. THE PLATFORM ORG SKIPS THE BALANCE CHECK AND NOTHING ELSE.
   Owner, 2026-08-04: metering is for visibility, not for charging. An
   unlimited org that writes no ledger row is an org whose burn rate is
   invisible, which defeats the reason for the flag.

6. A RETRY DOES NOT CHARGE TWICE.
   Measured on staging 2026-07-31: one click on a scraper that 404s took FOUR
   credits across three client retries.

7. A REFUND RETURNS TO THE BUCKET IT TOOK FROM.
   Returning an allowance-funded spend into `purchased` mints carry-over credits
   out of a grant that was going to expire; returning a purchased-funded spend
   into `allowance` destroys paid credits at the next roll. Both directions are
   money, in opposite pockets.

8. EVERY COLUMN THIS FEATURE NAMES EXISTS.
   In the style of tests/test_prachar_audience.py, and for the same reason: the
   recurring shape of failure in this repo is Python naming a column Postgres
   does not have, surfacing as an opaque 500 long after the deploy. On a money
   path the equivalent is worse — `balance_of` raising means every spend in the
   product answers 402 and it reads like an empty wallet.

STYLE. Hand-written fakes over SQL substrings, per the house convention set by
test_credit_refund.py and followed by test_scraper_credits.py. `_DB` below is a
small in-memory stand-in for the five tables services/credits.py touches, and it
enforces the two unique indexes 095 creates — because promises 6 and 7 ARE those
indexes, and a fake that lets a duplicate through would pass a test the database
would fail.
"""
import inspect
import re
from datetime import date
from pathlib import Path

import pytest

import services.credits as C

ORG = "11111111-1111-1111-1111-111111111111"
PLATFORM_ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER = "user_priya"
OTHER = "user_arjun"


# ── the fake ────────────────────────────────────────────────────────────────

class _UniqueViolation(Exception):
    """What asyncpg raises. `_is_unique_violation` matches on the sqlstate
    rather than the class precisely so a double like this one behaves the same
    as the driver — see the comment on that function."""
    sqlstate = "23505"


def _norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def _prev_period(p: date) -> date:
    return date(p.year - 1, 12, 1) if p.month == 1 else date(p.year, p.month - 1, 1)


class _DB:
    """staging.{organisations, hub_org_credits, org_member_credits,
    hub_org_credit_transactions, credit_prices, hub_scraper_catalog}, in dicts.

    Only the columns services/credits.py actually names. A test that needs a
    sixth table is a test that has drifted out of this module's scope.
    """

    def __init__(self):
        self.orgs = {}
        self.wallets = {}
        self.members = {}
        self.txns = []
        self.prices = {"blog": (5, 1, True), "image": (3, 1, True),
                       "chatbot_message": (2, 1, True)}
        self.catalog = {"google_maps": 5}
        self._seq = 0

    # ── seeding ──
    def org(self, org_id=ORG, *, monthly_credits=100, is_platform_org=False,
            markup_pct=None, allowance=0, purchased=0, period=None, wallet=True):
        self.orgs[org_id] = {"monthly_credits": monthly_credits,
                             "is_platform_org": is_platform_org,
                             "markup_pct": markup_pct}
        if wallet:
            self.wallets[org_id] = {
                "allowance": allowance, "purchased": purchased,
                "balance": allowance + purchased,
                "period_start": period or C.current_period(),
            }
        return org_id

    def cap(self, org_id, user_id, cap, spent=0, period=None):
        key = (org_id, user_id, period or C.current_period())
        self.members[key] = {"cap_credits": cap, "spent_credits": spent,
                             "set_by": "seed"}

    # ── helpers the assertions read ──
    def wallet(self, org_id=ORG):
        return self.wallets[org_id]

    def member(self, org_id, user_id, period=None):
        return self.members.get((org_id, user_id, period or C.current_period()))

    def of_type(self, tx_type):
        return [t for t in self.txns if t["tx_type"] == tx_type]

    def debits(self):
        return self.of_type(C.TX_DEBIT)


class _Conn:
    """Dispatches on SQL substrings. Deliberately strict: an unrecognised
    statement raises rather than returning None, so a change to credits.py that
    this fake does not model fails loudly here instead of quietly passing with a
    wallet that never moved."""

    def __init__(self, db: _DB):
        self.db = db

    # `_write_ledger` wraps its INSERT in a savepoint. Nothing here can roll
    # back, but the context manager has to exist or the insert never runs.
    def transaction(self):
        class _T:
            async def __aenter__(self_):
                return None

            async def __aexit__(self_, *a):
                return False

        return _T()

    # ── reads ──
    async def fetchrow(self, sql, *args):
        q = _norm(sql)

        if "INSERT INTO public.hub_org_credit_transactions" in q:
            return self._insert_tx(args)

        if "FROM public.organisations" in q and "monthly_credits" in q:
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
                return self._find(lambda t: t["idempotency_key"] == args[0]
                                  and args[0] is not None)
            if "WHERE id=$1::uuid" in q:
                return self._find(lambda t: t["id"] == args[0])
            if "reverses_tx_id=$1::uuid" in q:
                return self._find(lambda t: t["reverses_tx_id"] == args[0])

        if "FROM public.org_member_credits" in q:
            row = self.db.member(args[0], args[1], args[2])
            return None if row is None else dict(row)

        raise AssertionError(f"_Conn.fetchrow does not model: {q[:140]}")

    async def fetchval(self, sql, *args):
        q = _norm(sql)
        if "markup_pct" in q:
            org = self.db.orgs.get(args[0])
            return None if org is None else org["markup_pct"]
        if "credit_cost FROM public.hub_scraper_catalog" in q:
            return self.db.catalog.get(args[0])
        raise AssertionError(f"_Conn.fetchval does not model: {q[:140]}")

    async def fetch(self, sql, *args):
        q = _norm(sql)
        if "FROM public.credit_prices" in q:
            return [{"kind": k, "credits": c, "unit_size": u, "is_active": a}
                    for k, (c, u, a) in self.db.prices.items()]
        if "FROM public.org_member_credits" in q:
            org_id, period = args[0], args[1]
            return [{"user_id": uid, "cap_credits": r["cap_credits"],
                     "spent_credits": r["spent_credits"]}
                    for (o, uid, p), r in sorted(self.db.members.items())
                    if o == org_id and p == period]
        if "FROM public.hub_org_credit_transactions" in q:
            return [dict(t) for t in reversed(self.db.txns)]
        raise AssertionError(f"_Conn.fetch does not model: {q[:140]}")

    # ── writes ──
    async def execute(self, sql, *args):
        q = _norm(sql)

        if "INSERT INTO public.hub_org_credits" in q:
            self.db.wallets.setdefault(args[0], {
                "allowance": 0, "purchased": 0, "balance": 0,
                "period_start": args[1],
            })
            return "INSERT 0 1"

        if "UPDATE public.hub_org_credits" in q:
            w = self.db.wallets[args[3] if "period_start=$3::date" in q else args[2]]
            w["allowance"], w["purchased"] = args[0], args[1]
            w["balance"] = args[0] + args[1]
            if "period_start=$3::date" in q:
                w["period_start"] = args[2]
            return "UPDATE 1"

        if "INSERT INTO public.org_member_credits" in q:
            if "SELECT m.org_id" in q:               # roll_period carry-forward
                return self._carry(args[0], args[1])
            if "$3::date, NULL, $4, NULL" in q:      # spend bumps spent_credits
                key = (args[0], args[1], args[2])
                row = self.db.members.get(key)
                if row is None:
                    self.db.members[key] = {"cap_credits": None,
                                            "spent_credits": args[3],
                                            "set_by": None}
                else:
                    row["spent_credits"] += args[3]
                return "INSERT 0 1"
            if "$3::date, $4, 0, $5" in q:           # set_member_cap
                key = (args[0], args[1], args[2])
                row = self.db.members.get(key)
                if row is None:
                    self.db.members[key] = {"cap_credits": args[3],
                                            "spent_credits": 0, "set_by": args[4]}
                else:
                    row["cap_credits"], row["set_by"] = args[3], args[4]
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

    def _carry(self, org_id, new_period):
        prior = [p for (o, _u, p) in self.db.members if o == org_id and p < new_period]
        if not prior:
            return "INSERT 0 0"
        src = max(prior)
        for (o, uid, p), r in list(self.db.members.items()):
            if o != org_id or p != src:
                continue
            key = (org_id, uid, new_period)
            if key not in self.db.members:      # ON CONFLICT DO NOTHING
                self.db.members[key] = {"cap_credits": r["cap_credits"],
                                        "spent_credits": 0, "set_by": r["set_by"]}
        return "INSERT 0 1"

    def _insert_tx(self, args):
        (org_id, user_id, amount, balance_after, tx_type, description, created_by,
         kind, ref_id, quantity, allowance_delta, purchased_delta,
         idempotency_key, reverses_tx_id, metered_only, period_start) = args

        # The two unique indexes 095 creates. They are the mechanism behind
        # promises 6 and 7, so the fake has to enforce them or those tests
        # prove nothing.
        for t in self.db.txns:
            if idempotency_key is not None and t["idempotency_key"] == idempotency_key:
                raise _UniqueViolation("uq_org_credit_tx_idempotency")
            if reverses_tx_id is not None and t["reverses_tx_id"] == reverses_tx_id:
                raise _UniqueViolation("uq_org_credit_tx_reverses")

        self.db._seq += 1
        row = {"id": f"tx-{self.db._seq:04d}", "org_id": org_id, "user_id": user_id,
               "amount": amount, "balance_after": balance_after, "tx_type": tx_type,
               "description": description, "created_by": created_by,
               "created_at": None, "kind": kind, "ref_id": ref_id,
               "quantity": quantity, "allowance_delta": allowance_delta,
               "purchased_delta": purchased_delta,
               "idempotency_key": idempotency_key,
               "reverses_tx_id": reverses_tx_id, "metered_only": metered_only,
               "period_start": period_start}
        self.db.txns.append(row)
        return {"id": row["id"]}


@pytest.fixture
def db():
    return _DB()


@pytest.fixture
def conn(db):
    return _Conn(db)


# ── 1. a purchased top-up survives the monthly roll ──────────────────────────

@pytest.mark.asyncio
async def test_a_purchased_topup_survives_the_monthly_roll(db, conn):
    """THE defect this whole programme exists for.

    `SET balance = $1` wrote the grant over the sum, so 500 credits the client
    had been invoiced for vanished on the first of the month and the ledger row
    was labelled 'reset'.
    """
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=40, purchased=500, period=last)

    bal = await C.roll_period(conn, ORG)

    assert bal.purchased == 500, "the paid top-up was destroyed by the roll"
    assert bal.allowance == 100, "the new month's grant was not applied"
    assert bal.total == 600
    assert db.wallet()["balance"] == 600, "balance drifted from allowance+purchased"


@pytest.mark.asyncio
async def test_the_roll_books_the_expiry_and_the_grant_as_deltas(db, conn):
    """Two rows, both DELTAS. The old reset wrote ONE row using the new balance
    as both `amount` and `balance_after`, which is why no SUM(amount) in this
    product has ever reconciled to a wallet."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=40, purchased=500, period=last)

    await C.roll_period(conn, ORG)

    expire = db.of_type(C.TX_EXPIRE)
    grant = db.of_type(C.TX_GRANT)
    assert len(expire) == 1 and expire[0]["amount"] == -40
    assert expire[0]["balance_after"] == 500, "purchased alone survives the expiry"
    assert len(grant) == 1 and grant[0]["amount"] == 100
    assert grant[0]["balance_after"] == 600

    # And the roll is idempotent on period_start — a second call must not
    # re-grant. Two cron ticks in the same minute is not a hypothetical.
    await C.roll_period(conn, ORG)
    assert len(db.of_type(C.TX_GRANT)) == 1
    assert db.wallet()["allowance"] == 100


@pytest.mark.asyncio
async def test_an_unused_allowance_does_not_carry_over(db, conn):
    """The other half of rule 1: allowance is a grant, not a balance. If it
    carried, the monthly fee would compound into an entitlement nobody sold."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=90, purchased=0, period=last)

    bal = await C.roll_period(conn, ORG)

    assert bal.allowance == 100, "unused allowance was added to the new grant"


# ── 2. a negotiated 0 stays 0 ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_negotiated_zero_stays_zero_across_the_roll(db, conn):
    """`if not org_credits` could not tell an agreed 0 from an unset one and
    handed out the plan default every month."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=0, allowance=0, purchased=0, period=last)

    bal = await C.roll_period(conn, ORG)

    assert bal.monthly_credits == 0
    assert bal.allowance == 0, "a negotiated 0 was replaced by a plan default"
    assert db.of_type(C.TX_GRANT) == [], "a zero grant wrote a ledger row"


@pytest.mark.asyncio
async def test_an_org_with_zero_credits_still_gets_a_wallet(db, conn):
    """The dead org. Created with 0 credits, so no writer's `if monthly_credits
    > 0` ever made a row; the reset returned forever at `if not wallet` and
    every spend answered 402 permanently. A zero balance is a balance."""
    db.org(monthly_credits=0, wallet=False)

    bal = await C.balance_of(conn, ORG)

    assert bal.total == 0
    assert ORG in db.wallets, "the missing wallet row was not healed in place"


def test_the_grant_is_read_without_a_falsy_test():
    """A tripwire on the shape, not the value. The behavioural test above passes
    for `monthly_credits or PLAN_DEFAULT` only until someone sets a plan
    default; this fails the moment the falsy test comes back."""
    src = inspect.getsource(C._org_row)
    assert not re.search(r'monthly_credits"?\]?\s+or\s', src), (
        "monthly_credits is read through a falsy test again — a negotiated 0 "
        "will fall through to whatever is on the right of the `or`"
    )


# ── 3. spend draws allowance first ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_spend_draws_allowance_before_purchased(db, conn):
    db.org(allowance=50, purchased=500)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    assert r.credits == 5
    assert (r.from_allowance, r.from_purchased) == (5, 0)
    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (45, 500)


@pytest.mark.asyncio
async def test_a_spend_straddles_both_buckets_in_one_row(db, conn):
    """Allowance is exhausted first and the remainder comes out of purchased —
    as ONE debit, not two. A split into two ledger rows would make the refund
    path (promise 7) need a partial refund, which does not exist."""
    db.org(allowance=2, purchased=500)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    assert r.credits == 5
    assert (r.from_allowance, r.from_purchased) == (2, 3)
    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (0, 497)
    assert len(db.debits()) == 1, "one unit of work wrote two debits"
    assert db.debits()[0]["amount"] == -5


@pytest.mark.asyncio
async def test_an_org_that_cannot_afford_it_is_refused_and_nothing_moves(db, conn):
    db.org(allowance=1, purchased=1)

    with pytest.raises(C.InsufficientOrgCredits) as exc:
        await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    d = exc.value.detail
    assert d["needed"] == 5
    assert d["org_allowance"] == 1 and d["org_purchased"] == 1
    assert "top up" in d["message"].lower(), "the refusal does not say what to do"
    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (1, 1)
    assert db.txns == [], "a refused spend still wrote to the ledger"


@pytest.mark.asyncio
async def test_a_spend_rolls_the_period_first(db, conn):
    """A month-old wallet with 0 allowance must not 402 on the first spend of
    the month. The roll happens under the same lock, before the check."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=0, purchased=0, period=last)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    assert r.from_allowance == 5
    assert db.wallet()["allowance"] == 95


# ── 4. the member ceiling ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_member_ceiling_refuses_and_names_both_remainders(db, conn):
    """The remedy is inside the org — Aekam is not involved — so a member who
    cannot see that the org is holding 4,000 credits escalates to the wrong
    desk. The message carries both figures for that reason."""
    db.org(allowance=4000, purchased=1000)
    db.cap(ORG, USER, cap=10, spent=8)

    with pytest.raises(C.MemberCapExceeded) as exc:
        await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    d = exc.value.detail
    assert exc.value.status_code == 402
    assert d["needed"] == 5
    assert d["member_remaining"] == 2 and d["member_cap"] == 10
    assert d["org_total"] == 5000
    assert d["org_allowance"] == 4000 and d["org_purchased"] == 1000

    msg = d["message"]
    assert "2" in msg and "10" in msg, "the member's own figures are missing"
    assert "5000" in msg, "the org's remaining balance is missing from the message"
    assert "admin" in msg.lower(), "the message does not name who can fix it"

    # A DIFFERENT exception from the org refusal, because the remedy differs.
    assert not isinstance(exc.value, C.InsufficientOrgCredits)
    assert db.wallet()["allowance"] == 4000, "a capped refusal still moved money"
    assert db.txns == []


@pytest.mark.asyncio
async def test_a_cap_of_zero_refuses_everything(db, conn):
    """0 and "no ceiling" are different states. Collapsing them into a falsy
    test would uncap every member with a 0 the day it shipped."""
    db.org(allowance=100)
    db.cap(ORG, USER, cap=0)

    with pytest.raises(C.MemberCapExceeded):
        await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")


@pytest.mark.asyncio
async def test_no_member_row_means_uncapped_not_refused(db, conn):
    """Preserves today's semantics exactly: no row = uncapped within the org
    balance. The member's spend is still counted, or a ceiling set tomorrow
    would start from zero."""
    db.org(allowance=100)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    assert r.credits == 5
    row = db.member(ORG, USER)
    assert row["cap_credits"] is None and row["spent_credits"] == 5


@pytest.mark.asyncio
async def test_one_members_ceiling_does_not_bind_another(db, conn):
    db.org(allowance=100)
    db.cap(ORG, USER, cap=0)

    r = await C.spend(conn, org_id=ORG, user_id=OTHER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    assert r.credits == 5


@pytest.mark.asyncio
async def test_a_ceiling_is_absolute_and_can_be_lowered(db, conn):
    """`allocated = allocated + EXCLUDED.allocated` meant a ceiling could only
    ever go up: an admin who typed 200 twice gave the member 400 and had no way
    back."""
    db.org(allowance=100)

    await C.set_member_cap(conn, org_id=ORG, user_id=USER, cap=200, set_by="admin")
    await C.set_member_cap(conn, org_id=ORG, user_id=USER, cap=200, set_by="admin")
    assert db.member(ORG, USER)["cap_credits"] == 200, "the second set was additive"

    await C.set_member_cap(conn, org_id=ORG, user_id=USER, cap=50, set_by="admin")
    assert db.member(ORG, USER)["cap_credits"] == 50

    await C.set_member_cap(conn, org_id=ORG, user_id=USER, cap=None, set_by="admin")
    assert (await C.member_cap_of(conn, ORG, USER)).cap is None


@pytest.mark.asyncio
async def test_member_ceilings_reset_with_the_month(db, conn):
    """Owner: "Member ceilings reset with the month." The ceiling carries
    forward; the SPEND against it does not."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=0, period=last)
    db.cap(ORG, USER, cap=200, spent=180, period=last)

    await C.roll_period(conn, ORG)

    now = db.member(ORG, USER)
    assert now["cap_credits"] == 200, "the ceiling was silently dropped"
    assert now["spent_credits"] == 0, "last month's spend still counts against it"


# ── 5. the platform org ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_platform_org_skips_the_balance_check_but_still_books_it(db, conn):
    """Owner, 2026-08-04: a FLAG on the org, not a fake "unlimited" plan number,
    because a plan number is something someone later believes. It skips the
    balance check and NOTHING else."""
    db.org(PLATFORM_ORG, monthly_credits=0, is_platform_org=True,
           allowance=0, purchased=0)

    r = await C.spend(conn, org_id=PLATFORM_ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")

    assert r.credits == 5, "the platform org was not metered at the real price"
    assert r.metered_only is True
    assert (r.from_allowance, r.from_purchased) == (0, 0)

    w = db.wallets[PLATFORM_ORG]
    assert (w["allowance"], w["purchased"]) == (0, 0), "the wallet was charged"

    rows = db.debits()
    assert len(rows) == 1, "an unlimited spend wrote no ledger row — it is invisible"
    assert rows[0]["amount"] == -5 and rows[0]["metered_only"] is True
    assert rows[0]["allowance_delta"] == 0 and rows[0]["purchased_delta"] == 0


@pytest.mark.asyncio
async def test_member_ceilings_still_apply_on_the_platform_org(db, conn):
    """"Aekam's own platform org is UNLIMITED — the balance check is skipped —
    but per-user ceilings still apply." """
    db.org(PLATFORM_ORG, is_platform_org=True)
    db.cap(PLATFORM_ORG, USER, cap=3)

    with pytest.raises(C.MemberCapExceeded):
        await C.spend(conn, org_id=PLATFORM_ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")


@pytest.mark.asyncio
async def test_the_platform_org_still_counts_member_spend(db, conn):
    """A ceiling that is not counted against is not a ceiling."""
    db.org(PLATFORM_ORG, is_platform_org=True)
    db.cap(PLATFORM_ORG, USER, cap=100)

    await C.spend(conn, org_id=PLATFORM_ORG, user_id=USER, kind="content",
                  ref_id="blog", idempotency_key="k1")

    assert db.member(PLATFORM_ORG, USER)["spent_credits"] == 5


@pytest.mark.asyncio
async def test_an_unpriced_kind_is_loud_on_the_platform_org_too(db, conn):
    """`CREDIT_COSTS.get(x, 2)` is how "chatbot" came to have a price nobody
    chose. Metering the platform org off an invented number would put a fiction
    into the one report the flag exists to feed."""
    db.org(PLATFORM_ORG, is_platform_org=True)

    with pytest.raises(C.UnknownPrice):
        await C.spend(conn, org_id=PLATFORM_ORG, user_id=USER, kind="content",
                      ref_id="chatbot", idempotency_key="k1")


# ── 6. a retry does not charge twice ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_retried_request_does_not_charge_twice(db, conn):
    """Measured: one click on a 404ing scraper took four credits across three
    client retries."""
    db.org(allowance=100)

    first = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                          ref_id="blog", idempotency_key="run-42")
    again = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                          ref_id="blog", idempotency_key="run-42")

    assert first.replayed is False and again.replayed is True
    assert again.tx_id == first.tx_id, "the replay is a different transaction"
    assert again.credits == first.credits
    assert db.wallet()["allowance"] == 95, "the retry charged again"
    assert len(db.debits()) == 1
    assert db.member(ORG, USER)["spent_credits"] == 5, "the retry bumped the ceiling"


@pytest.mark.asyncio
async def test_a_racing_duplicate_is_caught_by_the_index_not_the_read(db, conn):
    """The replay read is only the fast path. Two concurrent retries both pass
    it, so the unique index has to be what actually refuses — and the ledger row
    is written BEFORE the wallet moves so that refusal lands first.

    Simulated by writing the row from underneath, between the read and the
    insert, which is exactly the window the index covers.
    """
    db.org(allowance=100)
    real_find = conn._find
    fired = []

    def _racing_find(pred):
        row = real_find(pred)
        if row is None and not fired:
            fired.append(True)
            # The competitor commits its debit here.
            db.txns.append({
                "id": "tx-race", "org_id": ORG, "user_id": USER, "amount": -5,
                "balance_after": 95, "tx_type": C.TX_DEBIT, "description": "blog",
                "created_by": USER, "created_at": None, "kind": "content",
                "ref_id": "blog", "quantity": 1, "allowance_delta": -5,
                "purchased_delta": 0, "idempotency_key": "run-42",
                "reverses_tx_id": None, "metered_only": False,
                "period_start": C.current_period(),
            })
        return row

    conn._find = _racing_find

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="run-42")

    assert r.replayed is True and r.tx_id == "tx-race"
    assert len(db.debits()) == 1, "the loser of the race wrote a second debit"
    assert db.wallet()["allowance"] == 100, "the loser also moved the wallet"


@pytest.mark.asyncio
async def test_spend_refuses_to_run_without_an_idempotency_key(db, conn):
    """A key built from a fresh uuid is not an idempotency key, and neither is
    no key at all — both make every retry a new charge."""
    db.org(allowance=100)

    with pytest.raises(C.PriceMisconfigured):
        await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="")


# ── 7. a refund returns to the bucket it took from ───────────────────────────

@pytest.mark.asyncio
async def test_a_refund_returns_to_the_bucket_it_took_from(db, conn):
    """Straddling spend, straddling refund. Returning all 5 as purchased would
    mint 2 carry-over credits out of a grant due to expire; returning all 5 as
    allowance would destroy 3 paid ones at the next roll."""
    db.org(allowance=2, purchased=500)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    assert (r.from_allowance, r.from_purchased) == (2, 3)

    back = await C.refund(conn, tx_id=r.tx_id, reason="generation failed")

    assert (back.from_allowance, back.from_purchased) == (2, 3)
    assert (db.wallet()["allowance"], db.wallet()["purchased"]) == (2, 500)
    assert db.wallet()["balance"] == 502


@pytest.mark.asyncio
async def test_a_refund_is_a_positive_row_that_names_its_debit(db, conn):
    db.org(allowance=100)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    await C.refund(conn, tx_id=r.tx_id, reason="image failed")

    rows = db.of_type(C.TX_REFUND)
    assert len(rows) == 1
    assert rows[0]["amount"] == 5, "a refund was written as a negative debit"
    assert rows[0]["reverses_tx_id"] == r.tx_id, "the refund names no debit"
    assert rows[0]["balance_after"] == 100


@pytest.mark.asyncio
async def test_a_refund_returns_what_was_charged_not_the_list_price(db, conn):
    """`refund_org_credits(org, user, agent_type)` could only ever return the
    TYPE's list price, so a trued-up scraper run refunded its minimum and the
    extra was simply kept. refund() reads the original row."""
    db.org(allowance=100)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="scraper_trueup",
                      ref_id="google_maps", idempotency_key="k1",
                      credits_override=14)
    assert r.credits == 14

    back = await C.refund(conn, tx_id=r.tx_id, reason="run failed")

    assert back.credits == 14, "the refund fell back to a list price"
    assert db.wallet()["allowance"] == 100


@pytest.mark.asyncio
async def test_a_retried_refund_returns_the_same_receipt_and_writes_nothing(db, conn):
    """A retried refund is not an error, but paying it twice is money."""
    db.org(allowance=100)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    first = await C.refund(conn, tx_id=r.tx_id, reason="failed")
    again = await C.refund(conn, tx_id=r.tx_id, reason="failed")

    assert again.replayed is True and again.tx_id == first.tx_id
    assert len(db.of_type(C.TX_REFUND)) == 1
    assert db.wallet()["allowance"] == 100, "the second refund paid out again"


@pytest.mark.asyncio
async def test_a_refund_frees_the_members_ceiling(db, conn):
    """Otherwise a member is held against a spend that was reversed, and the
    only remedy is an admin raising a ceiling that was never really consumed."""
    db.org(allowance=100)
    db.cap(ORG, USER, cap=10)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    assert db.member(ORG, USER)["spent_credits"] == 5

    await C.refund(conn, tx_id=r.tx_id, reason="failed")
    assert db.member(ORG, USER)["spent_credits"] == 0


@pytest.mark.asyncio
async def test_a_cross_period_refund_comes_back_as_purchased(db, conn):
    """The allowance that paid for the work has already been reset. Returning
    into a bucket that was zeroed and re-granted would either inflate this
    month's grant or be destroyed at the next roll; purchased is the only form
    of the refund the customer actually keeps."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=100, purchased=0, period=last)

    # Charged last month, out of last month's allowance.
    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    db.wallets[ORG]["period_start"] = last
    db.txns[-1]["period_start"] = last
    for t in db.txns:
        if t["tx_type"] in (C.TX_GRANT, C.TX_EXPIRE):
            t["period_start"] = last

    # …refunded after the roll.
    await C.roll_period(conn, ORG)
    back = await C.refund(conn, tx_id=r.tx_id, reason="failed")

    assert (back.from_allowance, back.from_purchased) == (0, 5)
    assert db.wallet()["purchased"] == 5
    assert "purchased" in db.of_type(C.TX_REFUND)[0]["description"]


@pytest.mark.asyncio
async def test_a_platform_org_refund_books_it_and_moves_nothing(db, conn):
    db.org(PLATFORM_ORG, is_platform_org=True, allowance=0, purchased=0)

    r = await C.spend(conn, org_id=PLATFORM_ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    back = await C.refund(conn, tx_id=r.tx_id, reason="failed")

    assert back.metered_only is True
    w = db.wallets[PLATFORM_ORG]
    assert (w["allowance"], w["purchased"]) == (0, 0)
    assert len(db.of_type(C.TX_REFUND)) == 1


@pytest.mark.asyncio
async def test_a_refund_cannot_target_something_that_is_not_a_debit(db, conn):
    """Refunding a refund mints credits. It is a caller bug, so it raises."""
    db.org(allowance=100)

    r = await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                      ref_id="blog", idempotency_key="k1")
    back = await C.refund(conn, tx_id=r.tx_id, reason="failed")

    with pytest.raises(C.RefundTargetMissing):
        await C.refund(conn, tx_id=back.tx_id, reason="refund the refund")
    assert db.wallet()["allowance"] == 100


# ── a top-up lands where it is sold ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_purchased_topup_lands_in_purchased(db, conn):
    """`bucket` has no default on purpose: a human top-up form that silently
    sent 'allowance' would sell credits that expire at the next roll."""
    db.org(allowance=10, purchased=0)

    bal = await C.grant(conn, org_id=ORG, credits=500, bucket="purchased",
                        granted_by="aekam", description="Invoice INV-7")

    assert (bal.allowance, bal.purchased) == (10, 500)
    rows = db.of_type(C.TX_TOPUP)
    assert len(rows) == 1
    assert rows[0]["amount"] == 500 and rows[0]["purchased_delta"] == 500
    assert rows[0]["allowance_delta"] == 0


@pytest.mark.asyncio
async def test_a_topup_then_a_roll_is_the_whole_promise_end_to_end(db, conn):
    """Invoice, spend, roll. The client keeps what they paid for."""
    last = _prev_period(C.current_period())
    db.org(monthly_credits=100, allowance=100, purchased=0, period=last)

    await C.grant(conn, org_id=ORG, credits=500, bucket="purchased",
                  granted_by="aekam", description="Invoice INV-7")
    await C.spend(conn, org_id=ORG, user_id=USER, kind="content",
                  ref_id="blog", idempotency_key="k1")
    db.wallets[ORG]["period_start"] = last

    bal = await C.roll_period(conn, ORG)

    assert bal.purchased == 500
    assert bal.allowance == 100
    assert bal.total == 600


# ── 8. every column this feature names exists in 095 ─────────────────────────
#
# In the style of tests/test_prachar_audience.py. The failure this guards is the
# recurring one in this repo — Python naming a column Postgres does not have —
# and on this path it is worse than a 500 on one screen: `balance_of` raising
# means every spend in the product answers 402 and it looks like an empty
# wallet.

_MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "095_credit_model.sql"

# Verified against information_schema on the live database, 2026-08-04. These
# predate 095, so naming one is legal even though the migration never mentions
# it. Anything NOT here and NOT added by 095 does not exist.
PRE_095 = {
    "hub_org_credits": {"id", "org_id", "balance", "monthly_allocation",
                        "last_refill_at", "created_at", "updated_at",
                        "credits_reset_at"},
    "hub_org_credit_transactions": {"id", "org_id", "user_id", "amount",
                                    "balance_after", "tx_type", "description",
                                    "created_by", "created_at"},
    "organisations": {"id", "markup_pct", "monthly_credits", "monthly_price",
                      "max_users"},
    "hub_scraper_catalog": {"id", "credit_cost"},
    "org_member_credits": set(),
    "credit_prices": set(),
}

# Every column services/credits.py names, by table. Kept by hand and on purpose:
# a list derived from the same source it is checking cannot disagree with it.
NAMED = {
    "organisations": {"id", "monthly_credits", "is_platform_org", "markup_pct"},
    "hub_org_credits": {"org_id", "balance", "allowance_balance",
                        "purchased_balance", "period_start", "credits_reset_at",
                        "updated_at"},
    "hub_org_credit_transactions": {
        "id", "org_id", "user_id", "amount", "balance_after", "tx_type",
        "description", "created_by", "created_at", "kind", "ref_id", "quantity",
        "allowance_delta", "purchased_delta", "idempotency_key",
        "reverses_tx_id", "metered_only", "period_start"},
    "org_member_credits": {"org_id", "user_id", "period_start", "cap_credits",
                           "spent_credits", "set_by", "updated_at"},
    "credit_prices": {"kind", "credits", "unit_size", "is_active"},
    "hub_scraper_catalog": {"id", "credit_cost"},
}

_NOT_A_COLUMN = {"primary", "unique", "check", "foreign", "constraint", "--"}


def _columns_added_by_095() -> dict[str, set[str]]:
    """Every column 095 creates, per table: the ADD COLUMNs and the bodies of
    its CREATE TABLEs."""
    sql = _MIGRATION.read_text(encoding="utf-8")
    # Strip line comments — the file is mostly prose, and it names columns it is
    # explaining as well as columns it is creating.
    sql = "\n".join(re.sub(r"--.*$", "", line) for line in sql.splitlines())

    out: dict[str, set[str]] = {}
    for table, col in re.findall(
        r"ALTER\s+TABLE\s+staging\.(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)",
        sql, re.I | re.S,
    ):
        out.setdefault(table.lower(), set()).add(col.lower())

    for table, body in re.findall(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?staging\.(\w+)\s*\((.*?)\n\)\s*;",
        sql, re.I | re.S,
    ):
        cols = out.setdefault(table.lower(), set())
        depth = 0
        current = ""
        for ch in body:                     # split on top-level commas only
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if ch == "," and depth == 0:
                cols.add(current.strip().split()[0].lower() if current.strip() else "")
                current = ""
            else:
                current += ch
        if current.strip():
            cols.add(current.strip().split()[0].lower())
        cols -= _NOT_A_COLUMN | {""}
    return out


def test_the_migration_file_is_readable_and_creates_the_new_tables():
    """If the parser below silently matched nothing, every assertion after it
    would pass by describing an empty set."""
    added = _columns_added_by_095()
    assert "org_member_credits" in added, "095 no longer creates org_member_credits"
    assert "credit_prices" in added, "095 no longer creates credit_prices"
    assert {"cap_credits", "spent_credits", "period_start"} <= added["org_member_credits"]


@pytest.mark.parametrize("table", sorted(NAMED))
def test_every_column_the_credit_model_names_exists(table):
    added = _columns_added_by_095().get(table, set())
    available = added | PRE_095[table]
    missing = {c.lower() for c in NAMED[table]} - available
    assert not missing, (
        f"services/credits.py names {sorted(missing)} on staging.{table}, which "
        f"neither predates migration 095 nor is added by it — every credit "
        f"path raises UndefinedColumnError and the product answers 402"
    )


def test_the_two_buckets_and_the_platform_flag_are_in_the_migration():
    """The three columns the whole model rests on. Named individually because a
    generic check would pass if all three went missing together with NAMED."""
    added = _columns_added_by_095()
    assert {"allowance_balance", "purchased_balance", "period_start"} <= \
        added.get("hub_org_credits", set())
    assert "is_platform_org" in added.get("organisations", set())


def test_the_select_lists_in_credits_py_name_only_declared_columns():
    """`_LEDGER_COLS` and `_WALLET_COLS` are where the column lists actually
    live, so they are the realistic place for a typo to enter. Read from the
    module rather than restated, or this test would only check itself."""
    for const, table in ((C._LEDGER_COLS, "hub_org_credit_transactions"),
                         (C._WALLET_COLS, "hub_org_credits")):
        selected = {c.strip().lower() for c in const.split(",") if c.strip()}
        undeclared = selected - {c.lower() for c in NAMED[table]}
        assert not undeclared, (
            f"credits.py selects {sorted(undeclared)} from public.{table} but "
            f"NAMED does not declare it — either the column is invented or this "
            f"test's list is stale, and both are worth stopping for"
        )


def test_no_ledger_write_forgets_the_bucket_split():
    """`allowance_delta` / `purchased_delta` are what refund() reads to know
    which bucket to return to. A write that omits them produces a row that
    refunds as pre-095 — the full amount into purchased — which silently mints
    carry-over credits out of an expiring grant."""
    src = inspect.getsource(C)
    for call in re.findall(r"await _write_ledger\((.*?)\n\s*\)", src, re.S):
        assert "allowance_delta" in call and "purchased_delta" in call, (
            "a _write_ledger call omits the bucket split; its refund will "
            f"return everything as purchased:\n{call[:200]}"
        )
