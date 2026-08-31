"""
services/credits.py — the ONE place credits are priced, held, spent and returned.

Before this module the answer to "what did that cost?" depended on which of
five debit implementations you happened to hit: two primitives in ai_router, a
hand-rolled one in scrapers.run_scraper, a hand-rolled true-up in
scrapers._deduct_extra_credits, and five channels that charged nothing at all.
They disagreed on the wallet (hub_credit_wallets vs hub_org_credits), on the
name of a reversal ('refund' vs 'credit'), on whether the member ceiling applied
(scrapers skipped it), and on whether a retry charged twice (all of them did).

THE MODEL, settled by the owner 2026-08-04:

  · The balance is TWO BUCKETS, ONE NUMBER.
      allowance  — the monthly grant, reset each period, NO carry-over
      purchased  — a paid top-up, carries over indefinitely
    A spend draws ALLOWANCE FIRST, so the credits the client paid for survive
    the month roll. The old reset did `SET balance = $1` and annihilated them.

  · A member allocation is a CEILING ON THE SHARED ORG BALANCE, never a second
    wallet. Nothing is debited from a member. A member that runs out asks the
    org to raise the ceiling; the org that runs out asks Aekam.

  · Aekam's own platform org skips THE ORG BALANCE CHECK AND NOTHING ELSE.
    Member ceilings still apply, and every spend is still written to the ledger.
    Metering is for visibility, not for charging.

  · organisations.monthly_credits is the SOLE source of the monthly grant. The
    plan fallback is gone. A deliberately negotiated 0 now means 0, where
    `if not org_credits` used to make it indistinguishable from "not yet
    agreed" and hand the org the plan default every month.

HOUSE RULES THIS MODULE ENFORCES, from the owner:
  · every debit must be refundable          → refund() takes a tx_id, not a price
  · every refusal must say what is needed
    AND what is held                        → the message templates below carry
                                              the member figures AND the org
                                              figures, because the remedies are
                                              different people
  · no path may charge twice on a retry     → idempotency_key, unique in the DB

TABLE OWNERSHIP. After this programme no file outside this one may contain the
strings `hub_org_credits`, `org_member_credits`, `hub_org_credit_transactions`
or `credit_prices`. tests/test_credits_isolation.py enforces it. If a caller
needs a number that is not exposed here, the fix is a function here — not a
query there.

DEPENDS ON MIGRATION 095. Every column this module names either predates 095 or
is added by it. Until 095 is applied on the target database, every call raises.
"""
import logging
import math
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Literal, Optional

from fastapi import HTTPException

from db import get_pool

log = logging.getLogger(__name__)


# ── Commercial constants ────────────────────────────────────────────────────
# Moved here from ai_router.CREDIT_PRICE_INR and scrapers.SCRAPER_MARGIN. They
# are prices, and §3 of the spec is absolute: nothing outside this module names
# a price. Both names stay bound in their original modules for the duration
# because two test files import them, but nothing reads them there any more.

# What one credit is sold for. Used only by price_of_scraper_usage, to turn a
# rupee figure back into credits.
CREDIT_PRICE_INR = 4

# The markup applied to a scraper's real Apify cost when the org itself carries
# no `markup_pct`. Never a silent 0, which would sell at cost.
SCRAPER_MARGIN = 0.45

# organisations.markup_pct outside this band is a data error, not an intention:
# negative sells below cost, runaway bills a customer absurdly.
_MARKUP_MIN = 0.0
_MARKUP_MAX = 10.0

# credit_prices is 16 rows and changes when the owner prices a channel. Cached
# so a price change is live within a minute without a deploy, and short enough
# that nobody waits for a restart to see it.
_PRICE_CACHE_TTL = 60.0

# Ledger tx_type values. Written here so the strings exist in exactly one place;
# the old code had 'refund' in ai_router and 'credit' in scrapers for the same
# event, and no report ever counted both.
TX_DEBIT = "debit"
TX_REFUND = "refund"
TX_TOPUP = "topup"
TX_GRANT = "grant"
TX_EXPIRE = "expire"

# Reversals written before this module existed. usage_summary counts both, or
# every refunded image keeps inflating what the customer is shown they spent.
_REVERSAL_TX_TYPES = (TX_REFUND, "credit")


# ── Exceptions ──────────────────────────────────────────────────────────────

class CreditError(HTTPException):
    """Base. Subclasses fastapi.HTTPException DELIBERATELY.

    The alternative — a plain exception plus a translator in every router —
    means seven agents each writing the same try/except, and the first one that
    forgets returns a 500 for an empty wallet. The win is that an uncaught
    CreditError still reaches the client as the right status with the right
    sentence.

    `detail` is a DICT, following the house pattern already established by
    `routers/documents.py:914` and read by `frontend/src/lib/docErrors.js`:
    `{"error": <code>, "message": <sentence>, ...numbers}`. A frontend renders
    `detail.message`; it never parses the sentence for figures.
    """

    code: str = "credit_error"
    http_status: int = 500

    def __init__(self, message: str, **fields: Any):
        self.message = message
        self.fields = fields
        super().__init__(
            status_code=self.http_status,
            detail={"error": self.code, "message": message, **fields},
        )


class InsufficientOrgCredits(CreditError):
    """The org cannot afford this spend from allowance + purchased. → 402"""
    code = "org_credits_exhausted"
    http_status = 402


class MemberCapExceeded(CreditError):
    """The member's ceiling for this period cannot absorb this spend, even
    though the org can. → 402

    A DIFFERENT exception from InsufficientOrgCredits on purpose: the remedy is
    different and the message must say so. The org admin raises the ceiling from
    the org's own remaining balance; Aekam is not involved.
    """
    code = "member_cap_exceeded"
    http_status = 402


class UnknownOrg(CreditError):
    """No such org in staging.organisations. → 404

    Never raised for an org that merely lacks a wallet row — balance_of() and
    spend() heal that in place.
    """
    code = "unknown_org"
    http_status = 404


class UnknownPrice(CreditError):
    """`kind`/`ref_id` resolves to no price. → 500

    Deliberately LOUD and deliberately NOT a fallback. `CREDIT_COSTS.get(x, 2)`
    is how "chatbot" came to have a price nobody chose. A channel whose price
    was never decided must fail the request, not quietly bill 2 credits and look
    intentional. If this fires in production, a row is missing from
    staging.credit_prices — a one-row INSERT, not a deploy.
    """
    code = "unknown_price"
    http_status = 500


class PriceMisconfigured(CreditError):
    """A price row exists but is unusable — unit_size < 1, is_active FALSE on a
    kind being charged, or a caller passing a negative credits_override. → 500
    """
    code = "price_misconfigured"
    http_status = 500


class RefundTargetMissing(CreditError):
    """refund() named a tx_id that is not a debit. → 404

    Internal; a caller that hits this has a bug, not a user who does.
    """
    code = "refund_target_missing"
    http_status = 404


class InvalidCapValue(CreditError):
    """set_member_cap was handed a negative ceiling. → 400

    NOT IN THE SPEC — added because the DB CHECK is the only other guard, and a
    constraint violation raised inside the caller's transaction poisons it: an
    admin typo would take out the whole request instead of returning a message.
    """
    code = "invalid_cap"
    http_status = 400


# ── Data shapes ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Balance:
    org_id: str
    allowance: int          # resets at the period roll, no carry-over
    purchased: int          # carries over indefinitely
    total: int              # allowance + purchased; the number to show a human
    period_start: date
    is_platform_org: bool   # True = the balance check is skipped, NOT infinite
    monthly_credits: int    # the grant the next roll will set allowance to


@dataclass(frozen=True)
class MemberCap:
    org_id: str
    user_id: str
    period_start: date
    cap: Optional[int]          # None = uncapped within the org balance
    spent: int
    remaining: Optional[int]    # None when cap is None


@dataclass(frozen=True)
class Receipt:
    """What a spend or a refund actually did."""
    tx_id: str
    org_id: str
    user_id: Optional[str]
    kind: str
    ref_id: Optional[str]
    quantity: int
    credits: int            # POSITIVE magnitude, always
    from_allowance: int     # how much of `credits` came out of allowance
    from_purchased: int     # …and out of purchased. Sums to `credits`.
    balance_after: int
    metered_only: bool      # True on a platform org: recorded, wallet untouched
    replayed: bool          # True = this key had already been charged. NOTHING
                            # was written on this call. Treat it as success.


# ── Period arithmetic ───────────────────────────────────────────────────────

def current_period() -> date:
    """The first day of the month, UTC. The grain of every allowance figure."""
    now = datetime.now(timezone.utc)
    return date(now.year, now.month, 1)


def next_period(period: date) -> date:
    """The first day of the month after `period`."""
    return date(period.year + (period.month // 12), (period.month % 12) + 1, 1)


def previous_period(period: date) -> date:
    """The first day of the month BEFORE `period`.

    Exists for one caller — the wallet bootstrap in `balance_of`, which has to
    stamp a new row as NOT YET ROLLED so the first `roll_period` grants the
    plan's allowance. See the comment there for what stamping the current
    period instead cost.
    """
    return (date(period.year - 1, 12, 1) if period.month == 1
            else date(period.year, period.month - 1, 1))


def _human_date(d: date) -> str:
    """`1 September 2026`. Absolute, never "next month" — a relative date in a
    refusal is a date the reader has to compute while annoyed."""
    return f"{d.day} {d.strftime('%B %Y')}"


def _is_unique_violation(exc: Exception) -> bool:
    """asyncpg raises UniqueViolationError; anything speaking Postgres carries
    sqlstate. Matched on the code rather than the class so a wrapped driver or a
    test double behaves the same."""
    return getattr(exc, "sqlstate", None) == "23505"


# ── The price resolver ──────────────────────────────────────────────────────
#
# §3 of the spec, in one function. Three sources, a CLOSED mapping. A kind that
# is not in the table below raises UnknownPrice — there is no default, because a
# default is how a channel gets a price nobody chose.
#
#   kind             ref_id is                    source
#   ───────────────  ───────────────────────────  ─────────────────────────────
#   content          the agent_type (blog, …)     credit_prices, keyed on ref_id
#   skill_step       the step's agent_type        credit_prices, keyed on ref_id
#   channel          chatbot_message, kb_ingest…  credit_prices, keyed on ref_id
#   scraper          hub_scraper_catalog.id       catalog.credit_cost
#   scraper_trueup   hub_scraper_catalog.id       NOT resolvable here — it needs
#                                                 cost_usd. Use
#                                                 price_of_scraper_usage() and
#                                                 spend(credits_override=…).

_PRICE_TABLE_KINDS = ("content", "skill_step", "channel")

_price_cache: dict[str, tuple[int, int, bool]] = {}
_price_cache_at: float = 0.0


def _cache_disabled() -> bool:
    """Tests insert their own price rows and must see them immediately.

    KARTAVYA_ENV is the documented switch; PYTEST_CURRENT_TEST is checked too
    because pytest sets it per-test automatically and nothing in this repo's
    conftest sets KARTAVYA_ENV — without the second check the documented
    behaviour would be documented and absent.
    """
    return os.environ.get("KARTAVYA_ENV") == "test" or "PYTEST_CURRENT_TEST" in os.environ


def invalidate_price_cache() -> None:
    """Drop the cached price list. For a router that has just edited a price."""
    global _price_cache_at
    _price_cache_at = 0.0


async def _load_prices(conn) -> dict[str, tuple[int, int, bool]]:
    global _price_cache, _price_cache_at
    if not _cache_disabled() and _price_cache_at and (time.time() - _price_cache_at) < _PRICE_CACHE_TTL:
        return _price_cache
    rows = await conn.fetch(
        "SELECT kind, credits, unit_size, is_active FROM public.credit_prices"
    )
    table = {
        r["kind"]: (int(r["credits"]), int(r["unit_size"]), bool(r["is_active"]))
        for r in (rows or [])
    }
    if not _cache_disabled():
        _price_cache = table
        _price_cache_at = time.time()
    return table


async def price_of(
    conn,
    kind: str,
    ref_id: Optional[str] = None,
    *,
    quantity: int = 1,
) -> int:
    """Resolve what `quantity` units of (kind, ref_id) cost, in credits.

    THE ONLY FUNCTION IN THE CODEBASE ALLOWED TO NAME A PRICE.

    Returns `ceil(quantity / unit_size) * credits`. Raises UnknownPrice rather
    than guessing.
    """
    if quantity < 1:
        raise PriceMisconfigured(
            f"quantity must be at least 1, got {quantity}.",
            kind=kind, ref_id=ref_id, quantity=quantity,
        )

    if kind in _PRICE_TABLE_KINDS:
        if not ref_id:
            raise UnknownPrice(
                f"kind '{kind}' requires a ref_id naming what was produced.",
                kind=kind, ref_id=ref_id,
            )
        table = await _load_prices(conn)
        row = table.get(ref_id)
        if row is None:
            raise UnknownPrice(
                f"No price for '{ref_id}'. Add a row to public.credit_prices — "
                f"this work must not be billed a guessed amount.",
                kind=kind, ref_id=ref_id,
            )
        credits, unit_size, is_active = row
        if not is_active:
            raise PriceMisconfigured(
                f"Price for '{ref_id}' is inactive but is being charged.",
                kind=kind, ref_id=ref_id,
            )
        if unit_size < 1:
            raise PriceMisconfigured(
                f"Price for '{ref_id}' has unit_size {unit_size}.",
                kind=kind, ref_id=ref_id, unit_size=unit_size,
            )
        return math.ceil(quantity / unit_size) * credits

    if kind == "scraper":
        if not ref_id:
            raise UnknownPrice("kind 'scraper' requires the catalog id as ref_id.",
                               kind=kind, ref_id=ref_id)
        # `or 2` used to sit here (scrapers.py:276). A catalog row with no price
        # is a catalogue bug, not a 2-credit run.
        cost = await conn.fetchval(
            "SELECT credit_cost FROM public.hub_scraper_catalog WHERE id=$1",
            ref_id,
        )
        if cost is None:
            raise UnknownPrice(
                f"Scraper '{ref_id}' has no credit_cost in the catalog.",
                kind=kind, ref_id=ref_id,
            )
        return quantity * int(cost)

    if kind == "scraper_trueup":
        raise UnknownPrice(
            "A scraper true-up is priced from the run's real cost. Call "
            "price_of_scraper_usage() and pass spend(credits_override=…).",
            kind=kind, ref_id=ref_id,
        )

    raise UnknownPrice(
        f"'{kind}' is not a priced kind. The closed list is: "
        f"{', '.join(_PRICE_TABLE_KINDS)}, scraper.",
        kind=kind, ref_id=ref_id,
    )


async def _org_markup(conn, org_id: str) -> float:
    """The markup THIS org was given, set by a platform admin.

    `organisations.markup_pct` already existed and the platform console already
    wrote it; only the scraper true-up ignored it and applied a constant
    instead, so a per-org commercial term had no effect on the one place a run's
    price is decided. Owner's decision, 2026-07-31: a large run marks up at the
    rate assigned to the org.
    """
    try:
        v = await conn.fetchval(
            "SELECT markup_pct FROM public.organisations WHERE id=$1::uuid", org_id
        )
        if v is None:
            return SCRAPER_MARGIN
        v = float(v)
        if v < _MARKUP_MIN or v > _MARKUP_MAX:
            log.warning("org %s has markup_pct=%s — out of range, using default", org_id, v)
            return SCRAPER_MARGIN
        return v
    except Exception as exc:
        log.warning("could not read markup_pct for org %s: %s", org_id, exc)
        return SCRAPER_MARGIN


async def price_of_scraper_usage(
    conn, scraper_id: str, org_id: str, cost_usd: float,
) -> int:
    """The scraper true-up price: what the run ACTUALLY cost, in credits.

        max(catalog.credit_cost,
            ceil(cost_usd * usd_inr * (1 + organisations.markup_pct) / CREDIT_PRICE_INR))

    Lifted out of scrapers._calc_actual_credits with its behaviour preserved to
    the rupee, including `cost_usd <= 0` returning the catalog minimum. It moves
    here because it names four prices — the catalog floor, the forex rate, the
    org markup and CREDIT_PRICE_INR — and nothing outside this module may name
    one.

    The arithmetic it preserves, and why both halves matter: `charged_inr` is
    RUPEES and used to be returned as CREDITS with no division by what a credit
    costs, so the markup actually applied was the margin multiplied by the
    credit price — about 5.8x rather than 1.45x. It went unnoticed because
    `usage_usd` was reading only Apify's platform usage and missing the actor's
    per-event charges, so the figure arriving here was ~$0.0002 and `ceil` of it
    was always below the minimum. Fixing either alone gives a wrong answer.

        100 places  cost $0.40 = Rs 38.60  ->  14 credits = Rs 56.00 = 1.45x

    tests/test_scraper_cost.py and test_scraper_cost_basis.py pin this
    arithmetic. Import this function; do not restate the formula.
    """
    min_credits = await price_of(conn, "scraper", scraper_id)
    if cost_usd <= 0:
        return min_credits
    from services.forex import get_usd_inr
    rate = await get_usd_inr()
    markup = await _org_markup(conn, org_id)
    charged_inr = cost_usd * rate * (1 + markup)
    return max(min_credits, math.ceil(charged_inr / CREDIT_PRICE_INR))


# ── Wallet reads ────────────────────────────────────────────────────────────

_WALLET_COLS = ("allowance_balance, purchased_balance, balance, period_start")


async def _org_row(conn, org_id: str) -> dict:
    row = await conn.fetchrow(
        "SELECT id, monthly_credits, is_platform_org "
        "FROM public.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row:
        raise UnknownOrg(f"No organisation {org_id}.", org_id=org_id)
    return {
        # monthly_credits is NOT NULL DEFAULT 0. `or 0` here would be the same
        # bug this programme exists to remove — a negotiated 0 must survive.
        "monthly_credits": int(row["monthly_credits"] if row["monthly_credits"] is not None else 0),
        "is_platform_org": bool(row["is_platform_org"]),
    }


async def _wallet_row(conn, org_id: str, for_update: bool) -> Optional[dict]:
    sql = (
        f"SELECT {_WALLET_COLS} FROM public.hub_org_credits WHERE org_id=$1::uuid"
        + (" FOR UPDATE" if for_update else "")
    )
    row = await conn.fetchrow(sql, org_id)
    if row is None:
        return None
    period = row["period_start"] or current_period()
    return {
        "allowance": int(row["allowance_balance"] or 0),
        "purchased": int(row["purchased_balance"] or 0),
        "balance": int(row["balance"] or 0),
        "period_start": period,
    }


async def balance_of(conn, org_id: str, *, for_update: bool = False) -> Balance:
    """Read an org's two buckets.

    Heals a missing wallet row in place, because the alternative is the dead
    org: created with monthly_credits = 0, no row from create_org's
    `if monthly_credits > 0`, no row from the startup seed's identical filter,
    the monthly reset returning forever at `if not wallet`, a permanent 402, and
    the only self-heal sitting behind require_module("sahayak"). A zero balance
    is a balance.

    `for_update=True` takes the row lock. It is the FIRST lock any caller takes:
    hub_org_credits, THEN org_member_credits, always. The old code locked them
    in opposite orders in deduct and refund, which is a deadlock waiting for a
    concurrent pair.

    Raises UnknownOrg if the org itself does not exist.
    """
    org = await _org_row(conn, org_id)
    w = await _wallet_row(conn, org_id, for_update)
    if w is None:
        # ── ⚠ A NEW WALLET IS BORN UNROLLED, NOT ALREADY-ROLLED ────────────
        #
        # `period_start` was `current_period()`, and `roll_period` returns
        # early at `if bal.period_start >= now_period`. So a wallet created
        # today was stamped "already granted for this month" while holding
        # zero, and the plan's `monthly_credits` was not granted until the 1st
        # of the NEXT month.
        #
        # A customer who signs up on the 2nd gets nothing for twenty-nine days
        # of a plan they are paying for, and every Sahayak surface answers 402.
        # Nothing raises, nothing logs — the wallet reads as a legitimately
        # empty one.
        #
        # Measured live 2026-08-31, two orgs created 2026-08-28:
        #
        #     UK AekamINC     monthly_credits 2000   balance 0   ledger rows 0
        #     Unicode Group   monthly_credits 1000   balance 0   ledger rows 0
        #
        # Both had gone three days with a paid allowance and no way to reach
        # it: the only top-up doors (`POST /v1/hub/org/credits/topup` and the
        # per-client one) are `require_platform_role(SAHAYAK_COMMERCIAL_ROLES)`,
        # i.e. the Aekam console. It also blocked twelve of suite 14's twenty
        # tests, all cascading from one empty wallet.
        #
        # `previous_period(current_period())` rather than granting inline: the
        # allowance is then given by `roll_period` itself, on the very next
        # read (`GET /v1/hub/org/credits` calls it), through the audited path
        # that writes the `grant` ledger row and carries the member ceilings
        # forward. A second inline grant here would be a second implementation
        # of the one thing this module exists to get right, and it would write
        # no ledger row — the wallet would hold credits no `SUM(amount)` could
        # explain, which `roll_period`'s own docstring records as the bug that
        # made every wallet in this product unreconcilable.
        #
        # The `expire` half of the roll is a no-op here: a new wallet has no
        # unused allowance to forfeit, so only the `grant` row is written.
        await conn.execute(
            "INSERT INTO public.hub_org_credits "
            "(org_id, balance, allowance_balance, purchased_balance, period_start, credits_reset_at) "
            "VALUES ($1::uuid, 0, 0, 0, $2::date, NOW()) "
            "ON CONFLICT (org_id) DO NOTHING",
            org_id, previous_period(current_period()),
        )
        w = await _wallet_row(conn, org_id, for_update)
    if w is None:
        # Only reachable if the INSERT was rolled back under us or the unique
        # index migration 095 creates is absent. Say which, rather than
        # returning a zero balance that looks like a real answer.
        raise UnknownOrg(
            f"Could not read or create a credit wallet for org {org_id}. "
            f"Check that migration 095 has been applied.",
            org_id=org_id,
        )
    return Balance(
        org_id=org_id,
        allowance=w["allowance"],
        purchased=w["purchased"],
        total=w["allowance"] + w["purchased"],
        period_start=w["period_start"],
        is_platform_org=org["is_platform_org"],
        monthly_credits=org["monthly_credits"],
    )


async def _write_buckets(conn, org_id: str, allowance: int, purchased: int) -> None:
    """The only statement in the product that moves an org balance.

    All three columns in one write. `balance` is not a generated column —
    Postgres cannot convert one in place, a generated column cannot be UPDATEd,
    and a legacy writer that has not been converted yet would hard-error against
    one — so it is maintained here as the sum. staging.v_org_credit_drift shows
    any row where that has stopped being true.
    """
    # THE CASTS ARE NOT DECORATION. `balance=$1+$2` sent both parameters
    # UNTYPED, so Postgres saw `unknown + unknown`, could not choose an operator
    # and raised `AmbiguousFunctionError: operator is not unique`. The two plain
    # assignments beside it worked only because a column on the left gives the
    # parameter its type; an arithmetic expression gives it nothing.
    #
    # This is the single statement that moves an org balance, so while it threw,
    # EVERY credit spend threw with it — Sahayak answered 500 in 0.7s, before a
    # model was ever called, and so did anything else that debits credits.
    # Found 2026-08-07 from the staging traceback.
    await conn.execute(
        "UPDATE public.hub_org_credits "
        "SET allowance_balance=$1::int, purchased_balance=$2::int, "
        "    balance=$1::int + $2::int, updated_at=NOW() "
        "WHERE org_id=$3::uuid",
        allowance, purchased, org_id,
    )


# ── The monthly roll ────────────────────────────────────────────────────────

async def roll_period(conn, org_id: str) -> Balance:
    """Advance an org to the current month if it has not been advanced.

    Takes the hub_org_credits row lock itself (re-locking a row this transaction
    already holds is free), so a caller cannot forget. The old
    `_maybe_reset_monthly_credits` took NO lock and ran BEFORE the FOR UPDATE,
    so two concurrent first-of-month spends could each reset.

    What it does:
      · allowance_balance := organisations.monthly_credits   (SET, not +=)
      · purchased_balance := UNTOUCHED — this is the whole point. The old
        `SET balance = $1` destroyed a top-up the client had been invoiced for
        and the ledger called it a reset.
      · period_start      := this month
      · carries org_member_credits.cap_credits forward with spent_credits at 0

    Ledger, TWO rows, both with amount as a DELTA:
      · 'expire', amount = -(unused allowance), skipped when 0
      · 'grant',  amount = +monthly_credits,   skipped when 0
    The old reset wrote ONE row using the NEW BALANCE for both `amount` and
    `balance_after`, which is why no SUM(amount) in this product has ever
    reconciled to a wallet.

    Idempotent on period_start.
    """
    bal = await balance_of(conn, org_id, for_update=True)
    now_period = current_period()
    if bal.period_start >= now_period:
        return bal

    old_period = bal.period_start
    unused = bal.allowance
    granted = bal.monthly_credits
    new_allowance = granted
    purchased = bal.purchased

    await conn.execute(
        "UPDATE public.hub_org_credits "
        # Same untyped-parameter bug as `_write_buckets` — see the note there.
        "SET allowance_balance=$1::int, purchased_balance=$2::int, "
        "    balance=$1::int + $2::int, "
        "    period_start=$3::date, credits_reset_at=NOW(), updated_at=NOW() "
        "WHERE org_id=$4::uuid",
        new_allowance, purchased, now_period, org_id,
    )

    if unused > 0:
        # balance_after is the wallet the instant the allowance was forfeited,
        # i.e. purchased alone. A reader summing amounts must land on it.
        await _write_ledger(
            conn, org_id=org_id, user_id=None, amount=-unused,
            balance_after=purchased, tx_type=TX_EXPIRE,
            description=f"Allowance expired at the {_human_date(now_period)} roll",
            kind="period", ref_id="expire", quantity=1,
            allowance_delta=-unused, purchased_delta=0,
            idempotency_key=f"roll:{org_id}:{now_period.isoformat()}:expire",
            metered_only=False, period_start=old_period, created_by="system",
        )
    if granted > 0:
        await _write_ledger(
            conn, org_id=org_id, user_id=None, amount=granted,
            balance_after=purchased + granted, tx_type=TX_GRANT,
            description=f"Monthly allowance for {_human_date(now_period)}",
            kind="period", ref_id="grant", quantity=1,
            allowance_delta=granted, purchased_delta=0,
            idempotency_key=f"roll:{org_id}:{now_period.isoformat()}:grant",
            metered_only=False, period_start=now_period, created_by="system",
        )

    # Carry the ceilings forward from the most recent period that has any, not
    # merely from last month: an org that spent nothing in July must not have
    # its members silently uncapped in August. A cap an admin has already set
    # FOR this period wins, via DO NOTHING — that is what makes it possible to
    # set next month's ceiling without disturbing this month's.
    await conn.execute(
        "INSERT INTO public.org_member_credits "
        "(org_id, user_id, period_start, cap_credits, spent_credits, set_by) "
        "SELECT m.org_id, m.user_id, $2::date, m.cap_credits, 0, m.set_by "
        "  FROM public.org_member_credits m "
        " WHERE m.org_id=$1::uuid AND m.period_start = ("
        "        SELECT MAX(p.period_start) FROM public.org_member_credits p "
        "         WHERE p.org_id=$1::uuid AND p.period_start < $2::date) "
        "ON CONFLICT (org_id, user_id, period_start) DO NOTHING",
        org_id, now_period,
    )

    log.info(
        "credits: org %s rolled %s -> %s (expired %s allowance, granted %s, kept %s purchased)",
        org_id, old_period, now_period, unused, granted, purchased,
    )
    return Balance(
        org_id=org_id,
        allowance=new_allowance,
        purchased=purchased,
        total=new_allowance + purchased,
        period_start=now_period,
        is_platform_org=bal.is_platform_org,
        monthly_credits=bal.monthly_credits,
    )


# ── The ledger ──────────────────────────────────────────────────────────────

_LEDGER_COLS = (
    "id, org_id, user_id, amount, balance_after, tx_type, description, created_by, "
    "created_at, kind, ref_id, quantity, allowance_delta, purchased_delta, "
    "idempotency_key, reverses_tx_id, metered_only, period_start"
)


async def _write_ledger(
    conn, *, org_id, user_id, amount, balance_after, tx_type, description,
    kind, ref_id, quantity, allowance_delta, purchased_delta,
    idempotency_key, metered_only, period_start,
    reverses_tx_id=None, created_by=None,
) -> Optional[str]:
    """Insert one ledger row inside a SAVEPOINT.

    The savepoint is the whole idempotency mechanism. A unique violation on
    `idempotency_key` or on `reverses_tx_id` must not poison the caller's
    transaction — the caller is often in the middle of a request that is
    otherwise fine, and the correct answer to "this was already charged" is to
    carry on, not to 500.

    Returns the new row's id, or None when a unique index refused it — the
    caller then re-reads and answers `replayed`.
    """
    sql = (
        "INSERT INTO public.hub_org_credit_transactions "
        "(org_id, user_id, amount, balance_after, tx_type, description, created_by, "
        " kind, ref_id, quantity, allowance_delta, purchased_delta, "
        " idempotency_key, reverses_tx_id, metered_only, period_start) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, "
        "        $14::uuid, $15, $16::date) "
        "RETURNING id"
    )
    args = (
        org_id, user_id, amount, balance_after, tx_type, description,
        created_by if created_by is not None else user_id,
        kind, ref_id, quantity, allowance_delta, purchased_delta,
        idempotency_key, reverses_tx_id, metered_only, period_start,
    )
    try:
        async with conn.transaction():
            row = await conn.fetchrow(sql, *args)
        return str(row["id"]) if row else None
    except Exception as exc:
        if _is_unique_violation(exc):
            return None
        raise


def _row_to_receipt(row, *, replayed: bool) -> Receipt:
    amount = int(row["amount"])
    return Receipt(
        tx_id=str(row["id"]),
        org_id=str(row["org_id"]),
        user_id=row["user_id"],
        kind=row["kind"] or "",
        ref_id=row["ref_id"],
        quantity=int(row["quantity"] or 1),
        credits=abs(amount),
        from_allowance=abs(int(row["allowance_delta"] or 0)),
        from_purchased=abs(int(row["purchased_delta"] or 0)),
        balance_after=int(row["balance_after"]),
        metered_only=bool(row["metered_only"]),
        replayed=replayed,
    )


async def _tx_by_key(conn, idempotency_key: str):
    return await conn.fetchrow(
        f"SELECT {_LEDGER_COLS} FROM public.hub_org_credit_transactions "
        f"WHERE idempotency_key=$1",
        idempotency_key,
    )


async def _tx_by_id(conn, tx_id: str):
    return await conn.fetchrow(
        f"SELECT {_LEDGER_COLS} FROM public.hub_org_credit_transactions "
        f"WHERE id=$1::uuid",
        tx_id,
    )


async def _reversal_of(conn, tx_id: str):
    return await conn.fetchrow(
        f"SELECT {_LEDGER_COLS} FROM public.hub_org_credit_transactions "
        f"WHERE reverses_tx_id=$1::uuid",
        tx_id,
    )


def _default_description(kind: str, ref_id: Optional[str]) -> str:
    """A sentence a human can read, in the shape the pre-095 reports parse.

    admin_orgs.py builds usage_by_type with `.replace(" generation", "")` and
    subscription.py classifies on `description.startswith("scraper:")`. Those
    readers are being replaced by usage_summary(), but not on the same deploy —
    so until they are, a new row must not change what they report. The `kind`
    column is the real answer; this is the transition.
    """
    if kind in ("content", "skill_step"):
        return f"{ref_id} generation"
    if kind == "scraper":
        return f"scraper:{ref_id}"
    if kind == "scraper_trueup":
        return f"scraper true-up:{ref_id}"
    if kind == "channel":
        return f"{ref_id}"
    return f"{kind}:{ref_id}" if ref_id else kind


# ── Member ceilings ─────────────────────────────────────────────────────────

def _cap_row_to_dataclass(org_id, user_id, period, row) -> MemberCap:
    if row is None:
        return MemberCap(org_id=org_id, user_id=user_id, period_start=period,
                         cap=None, spent=0, remaining=None)
    cap = row["cap_credits"]
    spent = int(row["spent_credits"] or 0)
    cap = None if cap is None else int(cap)
    return MemberCap(
        org_id=org_id, user_id=user_id, period_start=period,
        cap=cap, spent=spent,
        remaining=None if cap is None else max(cap - spent, 0),
    )


async def _member_row(conn, org_id: str, user_id: str, period: date, for_update: bool):
    sql = (
        "SELECT cap_credits, spent_credits FROM public.org_member_credits "
        "WHERE org_id=$1::uuid AND user_id=$2 AND period_start=$3::date"
        + (" FOR UPDATE" if for_update else "")
    )
    return await conn.fetchrow(sql, org_id, user_id, period)


async def member_cap_of(conn, org_id: str, user_id: str) -> MemberCap:
    """This period's ceiling and spend for one member."""
    period = current_period()
    row = await _member_row(conn, org_id, user_id, period, for_update=False)
    return _cap_row_to_dataclass(org_id, user_id, period, row)


async def set_member_cap(
    conn,
    *,
    org_id: str,
    user_id: str,
    cap: Optional[int],
    set_by: str,
    period_start: Optional[date] = None,
) -> MemberCap:
    """Set a member's ceiling for a period. ABSOLUTE, not additive.

    `allocate_user_credits` did `allocated = allocated + EXCLUDED.allocated`, so
    a ceiling could only ever go up: no lowering, no clearing, no reset with the
    month. An admin who typed 200 twice gave the member 400 and had no way back.

    cap=None clears the ceiling (uncapped within the org balance).
    cap=0 refuses everything for this member — a real, supported state, which is
    why the parameter is Optional[int] and not a falsy-tested int.
    period_start defaults to the current period; passing a future one sets next
    month's ceiling without touching this month's.

    DOES NOT CHECK the sum of ceilings against the org balance, deliberately. A
    ceiling is a ceiling, not an allocation: the org may legitimately give five
    members 200 each out of a 500 balance and rely on first-come. What the org
    must be SHOWN is the over-commitment — see commitment_of(). Refusing to save
    it would be the product deciding the customer's policy for them.

    Writes no ledger row: `amount` and `balance_after` are NOT NULL and a
    ceiling change moves no credits, so a zero-amount row would appear in every
    report's counts while meaning nothing. `set_by` and `updated_at` on the row
    are the audit trail.
    """
    if cap is not None and cap < 0:
        raise InvalidCapValue(
            f"A ceiling cannot be negative (got {cap}). Use 0 to refuse "
            f"everything, or clear it to leave the member uncapped.",
            org_id=org_id, user_id=user_id, cap=cap,
        )
    period = period_start or current_period()
    # The org row is locked first even here, so that a cap change and a
    # concurrent spend serialise in the same order everywhere. Without it this
    # is the one entry point that takes the member lock alone, and lock order is
    # only a rule if it has no exceptions.
    await balance_of(conn, org_id, for_update=True)
    await conn.execute(
        "INSERT INTO public.org_member_credits "
        "(org_id, user_id, period_start, cap_credits, spent_credits, set_by) "
        "VALUES ($1::uuid, $2, $3::date, $4, 0, $5) "
        "ON CONFLICT (org_id, user_id, period_start) DO UPDATE "
        "SET cap_credits=EXCLUDED.cap_credits, set_by=EXCLUDED.set_by, updated_at=NOW()",
        org_id, user_id, period, cap, set_by,
    )
    row = await _member_row(conn, org_id, user_id, period, for_update=False)
    return _cap_row_to_dataclass(org_id, user_id, period, row)


async def org_member_caps(
    conn, org_id: str, *, period_start: Optional[date] = None,
) -> list[MemberCap]:
    """Every member ceiling and spend for a period.

    NOT IN THE SPEC as a named function — added because C4 must render the
    allocation screen and the over-commitment figure, and no router may query
    org_member_credits itself.
    """
    period = period_start or current_period()
    rows = await conn.fetch(
        "SELECT user_id, cap_credits, spent_credits FROM public.org_member_credits "
        "WHERE org_id=$1::uuid AND period_start=$2::date ORDER BY user_id",
        org_id, period,
    )
    return [
        _cap_row_to_dataclass(org_id, r["user_id"], period, r)
        for r in (rows or [])
    ]


async def commitment_of(conn, org_id: str) -> dict:
    """What the org has promised its members against what it actually holds.

    The org is allowed to over-commit — five members at 200 out of a 500 balance
    is a legitimate first-come policy. It is not allowed to be surprised by it.
    """
    bal = await balance_of(conn, org_id)
    caps = await org_member_caps(conn, org_id)
    capped = [c for c in caps if c.cap is not None]
    sum_of_caps = sum(c.cap for c in capped)
    return {
        "org_total": bal.total,
        "allowance": bal.allowance,
        "purchased": bal.purchased,
        "period_start": bal.period_start.isoformat(),
        "capped_members": len(capped),
        "uncapped_members": len(caps) - len(capped),
        "sum_of_caps": sum_of_caps,
        "over_committed_by": max(sum_of_caps - bal.total, 0),
        "spent_this_period": sum(c.spent for c in caps),
    }


# ── Spend ───────────────────────────────────────────────────────────────────

async def spend(
    conn,
    *,
    org_id: str,
    user_id: Optional[str],
    kind: str,
    ref_id: Optional[str] = None,
    quantity: int = 1,
    idempotency_key: str,
    description: str = "",
    credits_override: Optional[int] = None,
) -> Receipt:
    """Charge an org for one unit of work. THE only debit in the product.

    ── TRANSACTION CONTRACT — read this before calling ──────────────────────
    `conn` is REQUIRED and this function opens NO transaction of its own. It
    runs inside YOURS. If your transaction rolls back, so does the charge.

    That is the whole point. `deduct_org_credits` opened its OWN pool connection
    and committed on its own, so a `generate()` that raised afterwards left a
    committed debit with nothing to reverse it. Six of eleven call sites were
    non-refundable for that one reason. A function whose transactional scope
    depends on an optional argument makes that failure invisible at the call
    site, which is why `conn` is positional and required and why the pool
    version has a different name.

    If you have no transaction, call spend_standalone().

    ── LOCK ORDER ──────────────────────────────────────────────────────────
    hub_org_credits FOR UPDATE, THEN org_member_credits FOR UPDATE. Always.
    Never the reverse. refund() and roll_period() take the same order. The old
    code took them in opposite orders in deduct and refund.

    ── ORDER OF OPERATIONS ─────────────────────────────────────────────────
      1. idempotency replay check      → Receipt(replayed=True), nothing written
      2. roll_period()                 → under the org lock
      3. price_of()                    → UnknownPrice if the kind is not priced
      4. member cap check              → MemberCapExceeded
      5. org balance check             → InsufficientOrgCredits
                                         SKIPPED ENTIRELY for a platform org
      6. one ledger row (the idempotency guard, written first so a duplicate
         cannot leave a wallet already moved)
      7. debit allowance first, then purchased
      8. bump org_member_credits.spent_credits

    `credits_override` exists for exactly one caller: the scraper true-up, where
    the price is `price_of_scraper_usage(...) - already_charged` and is
    therefore not a function of (kind, ref_id) alone. It still goes through
    every check above. It is not a hole; passing it does not skip anything.

    Raises: InsufficientOrgCredits (402), MemberCapExceeded (402),
            UnknownPrice (500), PriceMisconfigured (500), UnknownOrg (404).
    On any raise NOTHING has been written — the checks precede every write and
    share your transaction.
    """
    if not idempotency_key:
        raise PriceMisconfigured(
            "spend() requires an idempotency_key naming the unit of work. A key "
            "built from a timestamp or a fresh uuid is not an idempotency key.",
            kind=kind, ref_id=ref_id,
        )

    # 1. Replay. Cheap read before any lock, so a retry storm does not queue on
    #    the org row. The unique index is the real guard; this is the fast path.
    existing = await _tx_by_key(conn, idempotency_key)
    if existing is not None:
        return _row_to_receipt(existing, replayed=True)

    # 2. Lock the org row, then roll the period under that lock.
    bal = await roll_period(conn, org_id)
    period = bal.period_start

    # 3. Price. A platform org is metered at the same price as anyone else — an
    #    unpriced kind still 500s here.
    if credits_override is not None:
        if credits_override < 0:
            raise PriceMisconfigured(
                f"credits_override must not be negative (got {credits_override}). "
                f"Returning credits is grant() or refund(), not a negative spend.",
                kind=kind, ref_id=ref_id,
            )
        cost = int(credits_override)
    else:
        cost = await price_of(conn, kind, ref_id, quantity=quantity)

    # 4. The member ceiling. Second lock, never first.
    member_row = None
    if user_id:
        member_row = await _member_row(conn, org_id, user_id, period, for_update=True)
        cap = None if member_row is None else member_row["cap_credits"]
        if cap is not None:
            cap = int(cap)
            spent = int(member_row["spent_credits"] or 0)
            remaining = max(cap - spent, 0)
            if spent + cost > cap:
                # The org figures are in the member's message on purpose: the
                # remedy is entirely inside the org, Aekam is not involved, and
                # a member who cannot see that the org has 4,000 credits sitting
                # there will escalate to the wrong place.
                raise MemberCapExceeded(
                    f"This needs {cost} credits. You have {remaining} of your "
                    f"{cap} monthly credits left. Your organisation has "
                    f"{bal.total} credits available ({bal.allowance} allowance + "
                    f"{bal.purchased} purchased) — ask an org admin to raise "
                    f"your limit.",
                    needed=cost, member_remaining=remaining, member_cap=cap,
                    org_allowance=bal.allowance, org_purchased=bal.purchased,
                    org_total=bal.total,
                    next_period_start=next_period(period).isoformat(),
                )

    # 5. The org balance. Allowance first, so the credits the client PAID for
    #    survive. A single spend may straddle both buckets and is never split
    #    into two ledger rows.
    if bal.is_platform_org:
        from_allowance = 0
        from_purchased = 0
        new_allowance = bal.allowance
        new_purchased = bal.purchased
        metered_only = True
    else:
        from_allowance = min(cost, bal.allowance)
        from_purchased = cost - from_allowance
        if from_purchased > bal.purchased:
            raise InsufficientOrgCredits(
                f"This needs {cost} credits. Your organisation has {bal.total} "
                f"({bal.allowance} allowance + {bal.purchased} purchased). "
                f"Allowance resets on {_human_date(next_period(period))}. "
                f"Contact Aekam to top up.",
                needed=cost, member_remaining=None, member_cap=None,
                org_allowance=bal.allowance, org_purchased=bal.purchased,
                org_total=bal.total,
                next_period_start=next_period(period).isoformat(),
            )
        new_allowance = bal.allowance - from_allowance
        new_purchased = bal.purchased - from_purchased
        metered_only = False

    balance_after = new_allowance + new_purchased

    # 6. The ledger row FIRST. It carries the unique idempotency_key, so if this
    #    is a duplicate we find out before the wallet has moved — the ordering
    #    that makes "no path may charge twice on a retry" true rather than
    #    merely intended.
    tx_id = await _write_ledger(
        conn,
        org_id=org_id, user_id=user_id, amount=-cost, balance_after=balance_after,
        tx_type=TX_DEBIT, description=description or _default_description(kind, ref_id),
        kind=kind, ref_id=ref_id, quantity=quantity,
        allowance_delta=-from_allowance, purchased_delta=-from_purchased,
        idempotency_key=idempotency_key, metered_only=metered_only,
        period_start=period,
    )
    if tx_id is None:
        # Another transaction wrote this key between our read and our insert.
        # It paid for the work; we did not.
        raced = await _tx_by_key(conn, idempotency_key)
        if raced is None:
            raise PriceMisconfigured(
                "The ledger refused this spend on a unique index but no matching "
                "row can be read back. Check uq_org_credit_tx_idempotency.",
                kind=kind, ref_id=ref_id,
            )
        return _row_to_receipt(raced, replayed=True)

    # 7. The buckets. Untouched on a platform org — recorded, never charged.
    if not metered_only:
        await _write_buckets(conn, org_id, new_allowance, new_purchased)

    # 8. The member counter, on a platform org too: a ceiling that is not
    #    counted against is not a ceiling. Upserts, because "no row" means
    #    uncapped and we still want that member's spend to be visible.
    if user_id:
        await conn.execute(
            "INSERT INTO public.org_member_credits "
            "(org_id, user_id, period_start, cap_credits, spent_credits, set_by) "
            "VALUES ($1::uuid, $2, $3::date, NULL, $4, NULL) "
            "ON CONFLICT (org_id, user_id, period_start) DO UPDATE "
            "SET spent_credits = org_member_credits.spent_credits + EXCLUDED.spent_credits, "
            "    updated_at = NOW()",
            org_id, user_id, period, cost,
        )

    return Receipt(
        tx_id=tx_id, org_id=org_id, user_id=user_id, kind=kind, ref_id=ref_id,
        quantity=quantity, credits=cost, from_allowance=from_allowance,
        from_purchased=from_purchased, balance_after=balance_after,
        metered_only=metered_only, replayed=False,
    )


async def spend_standalone(**kwargs) -> Receipt:
    """spend() for a caller that has no transaction — the cron paths, the
    fire-and-forget publishers, the poll callbacks.

    A separate name rather than an optional `conn=None` so that a caller who has
    a transaction and passes it by accident cannot silently get the
    committed-outside-your-scope behaviour this module exists to end.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await spend(conn, **kwargs)


# ── Refund ──────────────────────────────────────────────────────────────────

async def refund(
    conn,
    *,
    tx_id: str,
    reason: str,
    user_id: Optional[str] = None,
) -> Receipt:
    """Reverse a spend, in full, exactly once.

    Takes the TRANSACTION ID, not an agent_type. `refund_org_credits` took an
    agent_type and could therefore only return that type's LIST PRICE — never
    what was actually charged, and never the scraper true-up, which has no
    agent_type at all. That is why a trued-up scraper run refunded only its
    minimum and the extra was simply kept.

    RETURNS TO THE BUCKET IT TOOK FROM, read from the original row's
    allowance_delta / purchased_delta — with one exception:

      If the allowance period has since rolled, the allowance portion comes back
      as PURCHASED. The allowance that paid for that work has already been
      reset; returning credits to a bucket that was zeroed and re-granted would
      either inflate this month's grant or be destroyed at the next roll.
      Purchased is the only form of the refund the customer actually keeps. The
      ledger says so: description ends "— cross-period, returned as purchased".

    A row written before 095 carries no bucket split at all. Its full amount is
    returned as PURCHASED, on the same reasoning: it is the direction of error
    that cannot cost the customer anything.

    Idempotent through uq_org_credit_tx_reverses: a second call for the same
    tx_id returns the existing refund Receipt and writes nothing. There is no
    AlreadyRefunded exception — a retried refund is not an error.

    Decrements org_member_credits.spent_credits for the ORIGINAL spend's period,
    floored at 0.

    Partial refunds are not supported. A refund is full or it does not happen.
    The scraper case that needed partials — refund the minimum but keep the
    true-up — is handled by refunding BOTH transactions, which is possible now
    that both have ids.

    Raises RefundTargetMissing only when the caller names a tx that is not a
    debit. It does not raise for a credit-state problem: a missing wallet is
    healed, an already-refunded spend returns its receipt. It DOES propagate a
    genuine database failure, because it runs inside the caller's transaction
    and swallowing one would leave the caller believing money moved. Callers
    handling an already-failing operation want refund_standalone(), which
    absorbs that.
    """
    original = await _tx_by_id(conn, tx_id)
    if original is None or int(original["amount"]) >= 0:
        raise RefundTargetMissing(
            f"Transaction {tx_id} is not a debit that can be refunded.",
            tx_id=tx_id,
        )

    already = await _reversal_of(conn, tx_id)
    if already is not None:
        return _row_to_receipt(already, replayed=True)

    org_id = str(original["org_id"])
    amount = abs(int(original["amount"]))
    metered_only = bool(original["metered_only"])
    orig_period = original["period_start"] or current_period()

    bal = await balance_of(conn, org_id, for_update=True)
    # ⚠ THE PERIOD THE ALLOWANCE IS IN NOW, NOT THE LAST ONE THE WALLET WAS
    # STAMPED WITH. This was `bal.period_start`, which is a LAGGING value —
    # it only becomes the current period when something calls `roll_period`.
    #
    # The rule below asks one question: "has the allowance that paid for this
    # spend been reset since?" That is `orig_period != current_period()`.
    # Reading it off the wallet was wrong in both directions:
    #
    #  · Too eager. A wallet is bootstrapped stamped as NOT YET ROLLED, so a
    #    new org's `period_start` is last month until its first roll. A refund
    #    of a spend made THIS month then read as cross-period and came back as
    #    purchased — the customer keeps the credits, so nothing is lost, but
    #    the bucket is wrong and the ledger line says something untrue.
    #
    #  · TOO SLACK, AND THIS ONE COSTS THE CUSTOMER. On the 1st, before
    #    anything has rolled, `bal.period_start` is LAST month and so is
    #    `orig_period` — they compare EQUAL, the rule does not fire, and the
    #    allowance portion is returned into a bucket the next roll zeroes. The
    #    refund is destroyed. That predates the bootstrap change and is the
    #    reason this is a fix rather than an adjustment.
    #
    # Deliberately NOT `roll_period` here: rolling inside a refund would write
    # a `grant` ledger row as a side effect of returning money, and the two
    # events have nothing to do with each other. The comparison needs today's
    # date, not a state change.
    period = current_period()

    alw_back = abs(int(original["allowance_delta"] or 0))
    pur_back = abs(int(original["purchased_delta"] or 0))
    note = ""
    if not metered_only:
        if alw_back + pur_back != amount:
            # Pre-095 row: no split was recorded. Purchased carries over, so it
            # is the return that survives.
            alw_back, pur_back = 0, amount
            note = " — pre-095 spend, returned as purchased"
        elif orig_period != period and alw_back:
            pur_back += alw_back
            alw_back = 0
            note = " — cross-period, returned as purchased"

    if metered_only:
        new_allowance, new_purchased = bal.allowance, bal.purchased
        alw_back = pur_back = 0
    else:
        new_allowance = bal.allowance + alw_back
        new_purchased = bal.purchased + pur_back
    balance_after = new_allowance + new_purchased

    actor = user_id or original["user_id"]
    tx = await _write_ledger(
        conn,
        org_id=org_id, user_id=original["user_id"], amount=amount,
        balance_after=balance_after, tx_type=TX_REFUND,
        description=f"{reason}{note}",
        kind=original["kind"], ref_id=original["ref_id"],
        quantity=int(original["quantity"] or 1),
        allowance_delta=alw_back, purchased_delta=pur_back,
        # A refund has no idempotency_key of its own: reverses_tx_id is its
        # unique index, and a key here would collide with nothing useful.
        idempotency_key=None, reverses_tx_id=tx_id,
        metered_only=metered_only, period_start=period, created_by=actor,
    )
    if tx is None:
        raced = await _reversal_of(conn, tx_id)
        if raced is None:
            raise RefundTargetMissing(
                f"The ledger refused a reversal of {tx_id} but no reversal can "
                f"be read back. Check uq_org_credit_tx_reverses.",
                tx_id=tx_id,
            )
        return _row_to_receipt(raced, replayed=True)

    if not metered_only:
        await _write_buckets(conn, org_id, new_allowance, new_purchased)

    if original["user_id"]:
        # GREATEST(…, 0): a refund must not drive the counter negative if the
        # matching debit predates the member row.
        await conn.execute(
            "UPDATE public.org_member_credits "
            "SET spent_credits = GREATEST(spent_credits - $1, 0), updated_at=NOW() "
            "WHERE org_id=$2::uuid AND user_id=$3 AND period_start=$4::date",
            amount, org_id, original["user_id"], orig_period,
        )

    return Receipt(
        tx_id=tx, org_id=org_id, user_id=original["user_id"],
        kind=original["kind"] or "", ref_id=original["ref_id"],
        quantity=int(original["quantity"] or 1), credits=amount,
        from_allowance=alw_back, from_purchased=pur_back,
        balance_after=balance_after, metered_only=metered_only, replayed=False,
    )


async def refund_standalone(
    *, tx_id: str, reason: str, user_id: Optional[str] = None,
) -> Optional[Receipt]:
    """refund() for a caller that has no transaction, and that is usually
    already handling a failure.

    NOT IN THE SPEC — added because three callers need exactly this and would
    otherwise each hand-roll acquire + transaction + try/except: the ai_router
    shim, scrapers._refund_credits (a background poller), and hub.py's
    generation-failure handlers.

    Returns None instead of raising when the refund could not be completed, and
    logs loudly naming what the customer is owed. A refund that throws would
    replace a lost 3 credits with a 500 on top of the failure that caused it —
    which is the contract tests/test_credit_refund.py already pins.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                return await refund(conn, tx_id=tx_id, reason=reason, user_id=user_id)
    except Exception as exc:
        log.error(
            "credits: refund FAILED for tx %s: %s — the customer is owed these credits",
            tx_id, exc,
        )
        return None


async def latest_spend_id(
    conn,
    org_id: str,
    *,
    user_id: Optional[str] = None,
    kind: Optional[str] = None,
    ref_id: Optional[str] = None,
    since: Optional[datetime] = None,
) -> Optional[str]:
    """The most recent debit matching these filters that has NOT been refunded.

    NOT IN THE SPEC — added because refund() takes a tx_id and the deprecated
    `refund_org_credits(org_id, user_id, agent_type)` shim does not have one.
    Without this, C3 would have to query hub_org_credit_transactions in
    ai_router, which tests/test_credits_isolation.py forbids.

    Best-effort by design: a caller that knows its tx_id must pass it. This is
    for the legacy signature only, and it is why that signature is deprecated —
    "the last thing that looked like this" is not the same claim as "this".
    """
    rows = await conn.fetch(
        f"SELECT {_LEDGER_COLS} FROM public.hub_org_credit_transactions t "
        f"WHERE t.org_id=$1::uuid AND t.tx_type='debit' "
        f"  AND ($2::text IS NULL OR t.user_id = $2) "
        f"  AND ($3::text IS NULL OR t.kind = $3) "
        f"  AND ($4::text IS NULL OR t.ref_id = $4) "
        f"  AND ($5::timestamptz IS NULL OR t.created_at >= $5) "
        f"  AND NOT EXISTS (SELECT 1 FROM public.hub_org_credit_transactions r "
        f"                   WHERE r.reverses_tx_id = t.id) "
        f"ORDER BY t.created_at DESC LIMIT 1",
        org_id, user_id, kind, ref_id, since,
    )
    return str(rows[0]["id"]) if rows else None


# ── Grants and top-ups ──────────────────────────────────────────────────────

async def grant(
    conn,
    *,
    org_id: str,
    credits: int,
    bucket: Literal["purchased", "allowance"],
    granted_by: str,
    description: str,
    idempotency_key: Optional[str] = None,
) -> Balance:
    """A top-up. `bucket` is required and has no default.

    Aekam selling credits writes PURCHASED — they carry over, and they are what
    the old `SET balance = $1` reset was destroying while the ledger called it
    'reset'. `allowance` exists for roll_period() and for a goodwill grant the
    owner intends to expire with the month; a human top-up form must never send
    it silently, which is why there is no default to fall into.

    Ledger: tx_type 'topup', amount POSITIVE, bucket recorded in
    allowance_delta / purchased_delta.

    Replaces BOTH of today's duplicate top-ups (hub.py and admin_orgs.py), which
    wrote the same effect with different ledger shapes.
    """
    if bucket not in ("purchased", "allowance"):
        raise PriceMisconfigured(
            f"grant() bucket must be 'purchased' or 'allowance', got {bucket!r}.",
            org_id=org_id, bucket=str(bucket),
        )
    if credits <= 0:
        raise PriceMisconfigured(
            f"A grant must be positive (got {credits}). Removing credits is not "
            f"a negative grant — it has no refusal message and no receipt.",
            org_id=org_id, credits=credits,
        )

    if idempotency_key:
        existing = await _tx_by_key(conn, idempotency_key)
        if existing is not None:
            return await balance_of(conn, org_id)

    bal = await roll_period(conn, org_id)
    if bucket == "purchased":
        new_allowance, new_purchased = bal.allowance, bal.purchased + credits
        alw_delta, pur_delta = 0, credits
    else:
        new_allowance, new_purchased = bal.allowance + credits, bal.purchased
        alw_delta, pur_delta = credits, 0
    balance_after = new_allowance + new_purchased

    tx = await _write_ledger(
        conn, org_id=org_id, user_id=granted_by, amount=credits,
        balance_after=balance_after, tx_type=TX_TOPUP,
        description=description or f"Top-up ({bucket})",
        kind="topup", ref_id=bucket, quantity=1,
        allowance_delta=alw_delta, purchased_delta=pur_delta,
        idempotency_key=idempotency_key, metered_only=False,
        period_start=bal.period_start, created_by=granted_by,
    )
    if tx is None:
        # Duplicate key — someone already granted this. Report the wallet as it
        # stands rather than granting twice.
        return await balance_of(conn, org_id)

    await _write_buckets(conn, org_id, new_allowance, new_purchased)
    return Balance(
        org_id=org_id, allowance=new_allowance, purchased=new_purchased,
        total=balance_after, period_start=bal.period_start,
        is_platform_org=bal.is_platform_org, monthly_credits=bal.monthly_credits,
    )


async def grant_standalone(**kwargs) -> Balance:
    """grant() for a caller that has no transaction. Same reasoning as
    spend_standalone; added for the two top-up routers, which otherwise write
    the acquire/transaction pair twice and can disagree about it."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await grant(conn, **kwargs)


# ── Reporting ───────────────────────────────────────────────────────────────

async def ledger(
    conn,
    org_id: str,
    *,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    user_id: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    """The transaction window every report reads. Uses
    idx_org_credit_tx_org_created."""
    rows = await conn.fetch(
        f"SELECT {_LEDGER_COLS} FROM public.hub_org_credit_transactions t "
        f"WHERE t.org_id=$1::uuid "
        f"  AND ($2::timestamptz IS NULL OR t.created_at >= $2) "
        f"  AND ($3::timestamptz IS NULL OR t.created_at < $3) "
        f"  AND ($4::text IS NULL OR t.user_id = $4) "
        f"ORDER BY t.created_at DESC LIMIT $5",
        org_id, since, until, user_id, limit,
    )
    out = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d["id"])
        d["org_id"] = str(d["org_id"])
        if d.get("reverses_tx_id"):
            d["reverses_tx_id"] = str(d["reverses_tx_id"])
        out.append(d)
    return out


# How a row is labelled in a by-kind report. New rows answer from `kind`/
# `ref_id`; rows written before 095 have neither and are parsed out of the
# description exactly the way the reports being replaced parsed it, so old and
# new land in the SAME bucket during the transition. Nothing parses a
# description that has a kind.
_USAGE_KIND_SQL = """
    CASE
      WHEN t.kind IS NULL THEN
        CASE
          WHEN t.tx_type IN ('refund', 'credit')      THEN 'refund_legacy'
          WHEN t.description LIKE 'scraper true-up%'  THEN 'scraper_trueup'
          WHEN t.description LIKE 'scraper:%'         THEN 'scraper'
          WHEN t.description LIKE '% generation'      THEN replace(t.description, ' generation', '')
          ELSE 'other'
        END
      WHEN t.kind IN ('content', 'skill_step', 'channel') THEN COALESCE(t.ref_id, t.kind)
      ELSE t.kind
    END
"""


async def usage_summary(
    conn,
    org_id: str,
    *,
    since: datetime,
    until: Optional[datetime] = None,
) -> dict:
    """The ONE aggregate. Every report calls this instead of writing its own.

    Returns gross AND net, separately, because today nothing is net.
    `total_debits` in admin_orgs and `ai_credits_used` / `scraper_credits_used`
    in subscription are all gross, so every refunded image and every failed
    scraper run has been inflating what the customer is shown they spent.

    `refunds` counts BOTH legacy tx_types — 'refund' and 'credit' — which are
    two names for the same event that no report has ever counted.

    Two identities hold, and reports should pick the one they mean:
        net_debits    = gross_debits - refunds          (what the wallet paid)
        total_usage   = net_debits + metered_only_net   (what was consumed)
        sum(by_kind.values()) == total_usage

    `metered_only` rows are a platform-org spend: recorded for visibility, the
    wallet untouched. Any report reconciling a BALANCE must use net_debits; any
    report describing USAGE must use total_usage.

    `legacy_reset_rows` is a COUNT, never a sum: pre-095 'reset' rows wrote the
    NEW BALANCE into `amount`, so adding them to anything produces a number that
    means nothing. It is surfaced so a reader can see they exist in the window.
    """
    rows = await conn.fetch(
        f"SELECT {_USAGE_KIND_SQL} AS report_kind, "
        f"       t.tx_type AS tx_type, "
        f"       t.metered_only AS metered_only, "
        f"       COALESCE(SUM(t.amount), 0)::bigint AS amount_sum, "
        f"       COUNT(*)::bigint AS row_count "
        f"  FROM public.hub_org_credit_transactions t "
        f" WHERE t.org_id=$1::uuid "
        f"   AND ($2::timestamptz IS NULL OR t.created_at >= $2) "
        f"   AND ($3::timestamptz IS NULL OR t.created_at < $3) "
        f" GROUP BY 1, 2, 3",
        org_id, since, until,
    )

    out = {
        "gross_debits": 0, "refunds": 0, "net_debits": 0,
        "metered_only_debits": 0, "metered_only_refunds": 0, "total_usage": 0,
        "topups": 0, "granted": 0, "expired": 0,
        "legacy_reset_rows": 0, "by_kind": {},
    }
    by_kind: dict[str, int] = {}

    for r in (rows or []):
        tx_type = r["tx_type"]
        amount = int(r["amount_sum"] or 0)
        metered = bool(r["metered_only"])
        key = r["report_kind"] or "other"

        if tx_type == TX_DEBIT:
            if metered:
                out["metered_only_debits"] += -amount
            else:
                out["gross_debits"] += -amount
            by_kind[key] = by_kind.get(key, 0) + (-amount)
        elif tx_type in _REVERSAL_TX_TYPES:
            if metered:
                out["metered_only_refunds"] += amount
            else:
                out["refunds"] += amount
            by_kind[key] = by_kind.get(key, 0) + (-amount)
        elif tx_type == TX_TOPUP:
            out["topups"] += amount
        elif tx_type == TX_GRANT:
            out["granted"] += amount
        elif tx_type == TX_EXPIRE:
            out["expired"] += -amount
        elif tx_type == "reset":
            out["legacy_reset_rows"] += int(r["row_count"] or 0)

    out["net_debits"] = out["gross_debits"] - out["refunds"]
    out["total_usage"] = (
        out["net_debits"] + out["metered_only_debits"] - out["metered_only_refunds"]
    )
    out["by_kind"] = {k: v for k, v in sorted(by_kind.items()) if v}
    return out


# ── Usage by SOURCE and by PERSON ───────────────────────────────────────────
#
# `usage_summary` answers "what kinds of thing did this org spend on", in ONE
# dimension: `COALESCE(ref_id, kind)`. That is not enough to bill from, for two
# reasons the owner's brief names directly.
#
#   · It COLLAPSES `content/blog` and `skill_step/blog` into one row called
#     `blog`, because both carry ref_id 'blog'. A one-off generation and a step
#     of a running skill are different products with different economics, and
#     the bill cannot tell them apart. `kind` separates them and is present on
#     every row written after 095.
#   · It has no notion of WHO. "Money is money and needs to be metered, capped
#     and visibility" — an org admin has to be able to see which of their people
#     is burning the allowance, and that question has never been askable.
#
# `_USAGE_KIND_SQL` and `usage_summary` are DELIBERATELY NOT CHANGED. Three
# shipped endpoints and two screens render `by_kind` today; renaming a bucket
# under them is a silent break. This is a second view over the same rows, not a
# replacement for the first.

#: The spend sources, in the order the tabs are meant to appear. A source is
#: `(kind, ref_id)` — NEVER `description`. Frozen here so the CASE below, the
#: 404 that lists the valid sources, and the labels the router renders cannot
#: drift apart.
SOURCE_KEYS: tuple[str, ...] = (
    "sahayak",       # kind='content'      — one-off content generation
    "skills",       # kind='skill_step'   — a step of a running skill
    "chat",         # kind='channel', the three chat/KB ref_ids
    "whatsapp",     # kind='channel', ref_id='whatsapp_send'
    "social",       # kind='channel', ref_id='social_send' or 'social_send:<platform>'
    "scrapers",     # kind IN ('scraper','scraper_trueup')
    "wallet",       # kind IN ('topup','period') — NOT usage; see below
    "unitemised",   # kind IS NULL — the rows written before migration 095
    "other",        # a priced kind this taxonomy has not been taught yet
)

#: Ledger rows that represent CONSUMPTION. A refund is here because it is netted
#: against the spend it reverses; 'credit' is the pre-095 spelling of 'refund'
#: and no report has ever counted both.
#:
#: 'reset' is deliberately absent. Pre-095 reset rows wrote the NEW BALANCE into
#: `amount`, so summing them produces a number that means nothing — the same
#: trap `usage_summary` documents by counting those rows rather than adding them.
_USAGE_TX_TYPES: tuple[str, ...] = (TX_DEBIT, TX_REFUND, "credit")

#: Ledger rows that MOVE the wallet without consuming anything: a purchase, the
#: monthly grant, the allowance that expired at the roll. Never summed into a
#: usage total — a top-up is not a spend, and adding it to one would show an org
#: that bought 500 credits as having used them.
_WALLET_TX_TYPES: tuple[str, ...] = (TX_TOPUP, TX_GRANT, TX_EXPIRE)

#: `left(ref, 11) = 'social_send'` rather than `LIKE 'social_send%'` on purpose:
#: `_` is a LIKE wildcard, so the pattern would also match `socialXsend`. In a
#: bucket that decides what a customer is shown they spent, an operator that
#: matches by accident is a bug waiting for a ref_id nobody has invented yet.
_SOURCE_SQL = """
    CASE
      WHEN x.a_kind IS NULL                          THEN 'unitemised'
      WHEN x.a_kind = 'content'                      THEN 'sahayak'
      WHEN x.a_kind = 'skill_step'                   THEN 'skills'
      WHEN x.a_kind IN ('scraper', 'scraper_trueup') THEN 'scrapers'
      WHEN x.a_kind IN ('topup', 'period')           THEN 'wallet'
      WHEN x.a_kind = 'channel' AND x.a_ref_id = 'whatsapp_send'      THEN 'whatsapp'
      WHEN x.a_kind = 'channel' AND left(x.a_ref_id, 11) = 'social_send' THEN 'social'
      WHEN x.a_kind = 'channel'
       AND x.a_ref_id IN ('chatbot_message', 'chatbot_rerank', 'kb_ingest') THEN 'chat'
      ELSE 'other'
    END
"""

#: Within a source, the sub-row. `ref_id` names the agent type, the catalog id or
#: the social platform, which is the grain a bill is argued at.
#:
#: The `kind IS NULL` arm is the honest half. Those 171 rows predate 095 and have
#: no ref_id at all; the ONLY thing they carry is a free-text description. It is
#: surfaced VERBATIM and never parsed — no `LIKE 'scraper%'`, no
#: `replace(' generation','')` — because a guess here silently moves money
#: between buckets an operator is about to reconcile.
_ITEM_SQL = """
    CASE
      WHEN x.a_kind IS NULL
        THEN COALESCE(NULLIF(btrim(x.a_description), ''), '(no description)')
      ELSE COALESCE(x.a_ref_id, x.a_kind)
    END
"""

#: The window, with every row ATTRIBUTED to the spend it belongs to.
#:
#: A refund carries its own kind/ref_id/user_id today because `refund()` copies
#: them from the original — but it is the ORIGINAL that decides where the money
#: went, so the join asks it directly rather than trusting the copy. Without
#: this, any reversal written by a future path that forgets to copy would appear
#: as its own source and the netting would silently stop working.
#:
#: `o.org_id = t.org_id` is not redundant. It is the org predicate on the JOIN,
#: placed where a later edit to the WHERE clause cannot lose it: without it, a
#: `reverses_tx_id` pointing at another tenant's row would pull that tenant's
#: kind and user into this org's bill.
_ATTRIBUTED_SQL = """
    SELECT t.id, t.tx_type, t.amount, t.metered_only,
           COALESCE(o.kind,        t.kind)        AS a_kind,
           COALESCE(o.ref_id,      t.ref_id)      AS a_ref_id,
           COALESCE(o.user_id,     t.user_id)     AS a_user_id,
           COALESCE(o.description, t.description) AS a_description
      FROM public.hub_org_credit_transactions t
      LEFT JOIN public.hub_org_credit_transactions o
             ON o.id = t.reverses_tx_id AND o.org_id = t.org_id
     WHERE t.org_id = $1::uuid
       AND ($2::timestamptz IS NULL OR t.created_at >= $2)
       AND ($3::timestamptz IS NULL OR t.created_at <  $3)
       AND t.tx_type = ANY($4::text[])
"""


def _tx_types_for(source: Optional[str]) -> list[str]:
    """Which ledger rows a question about `source` is asking about.

    Only 'wallet' asks about wallet movements. Everything else — including "no
    source given" — is a usage question, and a usage question that counted a
    top-up would report an org that BOUGHT 500 credits as having SPENT them.
    """
    return list(_WALLET_TX_TYPES if source == "wallet" else _USAGE_TX_TYPES)


def _net(amount) -> int:
    """Ledger amounts are DELTAS: a debit is negative, its reversal positive.
    Usage is the magnitude, so it is the delta negated — which makes a refund
    subtract from the source it was refunded on, with no special case."""
    return -int(amount or 0)


async def usage_by_source(
    conn, org_id: str, *, since: datetime, until: Optional[datetime] = None,
) -> dict:
    """What this org spent, split by the product surface that spent it.

    Returns::

        {"total_credits": int,
         "unitemised_credits": int, "unitemised_tx": int,
         "sources": [{"source", "credits", "tx_count", "metered_only_credits",
                      "refunded_credits", "items": [{"ref_id", "credits",
                      "tx_count", "metered_only_credits"}]}]}

    `credits` is NET of refunds and INCLUDES metered-only rows, with the
    metered-only part broken out beside it. A platform org's spend moves no
    wallet but is real cost, and Aekam has to be able to see what it would have
    paid — that is the whole reason `metered_only` exists on the ledger.

    `unitemised_*` is on the TOP LEVEL as well as in `sources` on purpose. Those
    rows are also a source tab, so they are already in `total_credits`; carrying
    them separately is what stops a reader taking the itemised tabs for the whole
    bill when they are short by 171 transactions' worth.

    A source's credits can come out NEGATIVE: a refund lands in the period it was
    issued, not the period of the spend it reverses, so a July run refunded in
    August subtracts from August. That is what the period actually cost and it is
    not corrected here — moving it would make the ledger and the report disagree.

    'wallet' IS returned, and it is the one source that is NOT usage. It carries
    `is_usage: False` and is excluded from `total_credits`, because a top-up is
    not a spend — an org that BOUGHT 500 credits must never be shown as having
    used them. Its `credits` is also the only SIGNED figure in the response: the
    net movement INTO the wallet (+top-up, +grant, −expiry), which is the only
    number that means anything for a movement. Every other source reports a
    positive magnitude consumed. A caller rendering the two side by side is
    reading two different quantities and the flag says so.
    """
    rows = await conn.fetch(
        f"SELECT {_SOURCE_SQL} AS source, {_ITEM_SQL} AS item, "
        f"       (-COALESCE(SUM(x.amount), 0))::bigint AS credits, "
        f"       COUNT(*)::bigint AS tx_count, "
        f"       (-COALESCE(SUM(x.amount) FILTER (WHERE x.metered_only), 0))::bigint "
        f"           AS metered_only_credits, "
        f"       COALESCE(SUM(x.amount) FILTER (WHERE x.tx_type <> '{TX_DEBIT}'), 0)::bigint "
        f"           AS refunded_credits "
        f"  FROM ({_ATTRIBUTED_SQL}) x "
        f" GROUP BY 1, 2",
        org_id, since, until, list(_USAGE_TX_TYPES),
    )

    buckets: dict[str, dict] = {}
    for r in (rows or []):
        src = r["source"]
        b = buckets.setdefault(src, {
            "source": src, "credits": 0, "tx_count": 0,
            "metered_only_credits": 0, "refunded_credits": 0, "items": [],
        })
        b["credits"] += int(r["credits"] or 0)
        b["tx_count"] += int(r["tx_count"] or 0)
        b["metered_only_credits"] += int(r["metered_only_credits"] or 0)
        b["refunded_credits"] += int(r["refunded_credits"] or 0)
        b["items"].append({
            "ref_id": r["item"],
            "credits": int(r["credits"] or 0),
            "tx_count": int(r["tx_count"] or 0),
            "metered_only_credits": int(r["metered_only_credits"] or 0),
        })

    for b in buckets.values():
        b["is_usage"] = True

    # The wallet, asked separately because it is a different question with a
    # different sign convention. Grouped on kind/ref_id so a purchased top-up,
    # a goodwill allowance top-up, the monthly grant and the expiry stay four
    # distinct movements rather than one net number nobody can explain.
    wallet_rows = await conn.fetch(
        f"SELECT COALESCE(x.a_ref_id, x.a_kind) AS item, "
        f"       COALESCE(SUM(x.amount), 0)::bigint AS credits, "
        f"       COUNT(*)::bigint AS tx_count "
        f"  FROM ({_ATTRIBUTED_SQL}) x "
        f" WHERE x.a_kind IN ('topup', 'period') "
        f" GROUP BY 1",
        org_id, since, until, list(_WALLET_TX_TYPES),
    )
    if wallet_rows:
        buckets["wallet"] = {
            "source": "wallet",
            "is_usage": False,
            "credits": sum(int(r["credits"] or 0) for r in wallet_rows),
            "tx_count": sum(int(r["tx_count"] or 0) for r in wallet_rows),
            "metered_only_credits": 0,
            "refunded_credits": 0,
            "items": [
                {"ref_id": r["item"], "credits": int(r["credits"] or 0),
                 "tx_count": int(r["tx_count"] or 0), "metered_only_credits": 0}
                for r in wallet_rows
            ],
        }

    for b in buckets.values():
        b["items"].sort(key=lambda i: (-i["credits"], i["ref_id"] or ""))

    # Taxonomy order, not size order: tabs that reorder themselves month to month
    # are tabs an operator has to re-find every time they open the screen.
    ordered = [buckets[k] for k in SOURCE_KEYS if k in buckets]
    unitemised = buckets.get("unitemised", {})
    return {
        # `is_usage` is the filter, not a hard-coded "except wallet". A source
        # added later that is also not consumption is then excluded by carrying
        # the flag, rather than by somebody remembering to name it here.
        "total_credits": sum(b["credits"] for b in ordered if b["is_usage"]),
        "unitemised_credits": int(unitemised.get("credits", 0)),
        "unitemised_tx": int(unitemised.get("tx_count", 0)),
        "sources": ordered,
    }


#: The display name for a spender, and the ONE form of it in this module.
#:
#: `NULLIF(TRIM(...))` and not a bare COALESCE. A bare COALESCE treats an empty
#: string as a value present, so a user row carrying `full_name = ''` — which is
#: what a form that submitted a blank field leaves behind — falls through to
#: nothing and the column comes back blank. The three-step form is
#: `server.py:list_users`'s, copied verbatim rather than re-derived, because two
#: spellings of one display rule is how they come to disagree.
#:
#: IT DOES NOT FALL THROUGH TO `email`, AND THAT IS THE POINT. The previous
#: `COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unnamed member')` was the platform-privacy leak wearing
#: a different column name: every spender with an incomplete profile was listed
#: to Aekam's finance console BY ADDRESS, in a field called `name`, where no
#: reader would think to look for one.
_SPENDER_NAME_SQL = (
    "COALESCE(NULLIF(TRIM(u.full_name), ''), NULLIF(TRIM(u.name), ''), "
    "'Name not on file')"
)


async def usage_by_person(
    conn, org_id: str, *, since: datetime, until: Optional[datetime] = None,
    source: Optional[str] = None, include_contact: bool = False,
) -> dict:
    """Who in this org spent it. Optionally within one source.

    Returns ``{"total_credits", "unitemised_credits", "unitemised_tx",
    "people": [{"user_id", "name", "credits", "tx_count",
    "metered_only_credits"}]}``, ordered by credits descending. `email` is on
    each person ONLY when `include_contact` is true — see below.

    A row with no `user_id` is a SYSTEM spend — a scheduled skill, a poll
    callback, the monthly roll — and gets its own synthetic person rather than
    being folded into anybody. Attributing an automated run to a human is how a
    "who is burning the allowance" screen ends up accusing someone.

    `user_id` is TEXT on the ledger and `public.users` is in the other schema, so
    the display name is a LEFT JOIN: a member who has since been deleted still
    has to appear, with their id, rather than vanishing from the bill.

    ── `include_contact` IS FALSE BY DEFAULT, AND THAT IS THE WHOLE GUARD ──────

    The owner's rule, 2026-08-07: "Aekam must not be able to see client personal
    data, and orgs must not see each other's." This function has exactly two
    callers by way of `billing._people_body`, and they sit on opposite sides of
    that rule:

      · `/api/v1/billing/me/usage/people` — an org owner or admin reading their
        OWN org. They already hold every address in it; this is the same
        organisation reading itself, which the rule explicitly permits. It
        passes `include_contact=True`.
      · `/api/v1/billing/orgs/{org_id}/usage/people` — Aekam's finance console
        over ANY customer. It passes nothing, and gets no addresses.

    A SERVICE CANNOT SEE WHO IS ASKING, so it cannot decide this for itself —
    which is precisely why the default is the closed one. A third caller written
    next quarter that forgets the argument gets the safe answer; one that wants
    addresses has to say so in a diff somebody reviews. Defaulting to True and
    filtering in the router is the version that regresses silently, because the
    filter is a line that can be deleted while every test still passes.

    THE SPEND FIGURES ARE IDENTICAL EITHER WAY. Nothing about `include_contact`
    touches `credits`, `tx_count` or `metered_only_credits` — Aekam bills
    organisations, and every rupee it bills on is still here.
    """
    # A COLUMN LIST CHOSEN BY THE SERVER, never interpolated from a caller's
    # string — the house rule for a dynamic identifier. `include_contact` is a
    # bool; there are two possible queries and both are written out here.
    contact_col = "u.email AS email, " if include_contact else ""
    # GROUP BY POSITION, and the count MOVES WITH THE PROJECTION. `1, 2, 3` left
    # hard-coded would group by `credits` the moment the email column went away,
    # which is not a syntax error — it is a wrong bill.
    group_by = "1, 2, 3" if include_contact else "1, 2"
    rows = await conn.fetch(
        f"SELECT x.a_user_id AS user_id, "
        f"       {_SPENDER_NAME_SQL} AS name, "
        f"       {contact_col}"
        f"       (-COALESCE(SUM(x.amount), 0))::bigint AS credits, "
        f"       COUNT(*)::bigint AS tx_count, "
        f"       (-COALESCE(SUM(x.amount) FILTER (WHERE x.metered_only), 0))::bigint "
        f"           AS metered_only_credits, "
        f"       (-COALESCE(SUM(x.amount) FILTER (WHERE x.a_kind IS NULL), 0))::bigint "
        f"           AS unitemised_credits, "
        f"       (COUNT(*) FILTER (WHERE x.a_kind IS NULL))::bigint AS unitemised_tx "
        f"  FROM ({_ATTRIBUTED_SQL}) x "
        f"  LEFT JOIN public.users u ON u.user_id = x.a_user_id "
        f" WHERE ($5::text IS NULL OR {_SOURCE_SQL} = $5) "
        f" GROUP BY {group_by}",
        org_id, since, until, _tx_types_for(source), source,
    )

    people = []
    total = unitemised_credits = unitemised_tx = 0
    for r in (rows or []):
        uid = r["user_id"]
        credits_ = int(r["credits"] or 0)
        total += credits_
        unitemised_credits += int(r["unitemised_credits"] or 0)
        unitemised_tx += int(r["unitemised_tx"] or 0)
        person = {
            "user_id": uid,
            # `_SPENDER_NAME_SQL` never returns NULL for a row that joined, so
            # this fallback now only fires for a spender with no `users` row at
            # all — a deleted member, or the system row. The user id is the last
            # resort and not a display choice; see `check-rendered-ids`.
            "name": r["name"] or ("System / unattributed" if uid is None else uid),
            "credits": credits_,
            "tx_count": int(r["tx_count"] or 0),
            "metered_only_credits": int(r["metered_only_credits"] or 0),
        }
        # The key is ABSENT rather than None on the Aekam side. A `None` would
        # be a field the console could render an empty cell for and somebody
        # could later "fix" by populating; an absent key is a shape that says
        # this report does not carry addresses.
        if include_contact:
            person["email"] = r["email"]
        people.append(person)

    # Biggest spender first; the system row last whatever it spent, because it is
    # not a person anyone can go and talk to.
    people.sort(key=lambda p: (p["user_id"] is None, -p["credits"], p["name"] or ""))
    return {
        "total_credits": total,
        "unitemised_credits": unitemised_credits,
        "unitemised_tx": unitemised_tx,
        "people": people,
    }


async def usage_detail(
    conn, org_id: str, *, since: datetime, until: Optional[datetime] = None,
    source: Optional[str] = None, user_id: Optional[str] = None,
    limit: int = 200,
) -> list[dict]:
    """The drill-down: the ledger rows behind one cell of the two reports above.

    Filtered on the ATTRIBUTED source and person, so a refund appears under the
    spend it reverses and the detail adds up to the summary it was opened from.

    With no `source` the tx_type filter is dropped entirely and the raw window is
    returned — including pre-095 'reset' rows, whose `amount` holds the balance
    the reset produced rather than a delta. They are shown because hiding a row
    that exists is worse than showing one that has to be read carefully; nothing
    sums this list.
    """
    cols = ", ".join(f"t.{c}" for c in _LEDGER_COLS.split(", "))
    limit = max(1, min(int(limit), 500))
    rows = await conn.fetch(
        f"SELECT {cols} "
        f"  FROM public.hub_org_credit_transactions t "
        f"  LEFT JOIN public.hub_org_credit_transactions o "
        f"         ON o.id = t.reverses_tx_id AND o.org_id = t.org_id "
        f"  CROSS JOIN LATERAL (SELECT COALESCE(o.kind, t.kind)     AS a_kind, "
        f"                             COALESCE(o.ref_id, t.ref_id) AS a_ref_id) x "
        f" WHERE t.org_id = $1::uuid "
        f"   AND ($2::timestamptz IS NULL OR t.created_at >= $2) "
        f"   AND ($3::timestamptz IS NULL OR t.created_at <  $3) "
        f"   AND ($4::text[] IS NULL OR t.tx_type = ANY($4::text[])) "
        f"   AND ($5::text IS NULL OR {_SOURCE_SQL} = $5) "
        f"   AND ($6::text IS NULL OR COALESCE(o.user_id, t.user_id) = $6) "
        f" ORDER BY t.created_at DESC LIMIT $7",
        org_id, since, until,
        _tx_types_for(source) if source else None,
        source, user_id, limit,
    )
    out = []
    for r in (rows or []):
        d = dict(r)
        d["id"] = str(d["id"])
        d["org_id"] = str(d["org_id"])
        if d.get("reverses_tx_id"):
            d["reverses_tx_id"] = str(d["reverses_tx_id"])
        out.append(d)
    return out


async def price_list(conn) -> dict[str, int]:
    """Every ACTIVE price, keyed by the ref_id a caller passes to `price_of`.

    For a screen that has to tell someone what a thing costs BEFORE they run it.
    Inactive rows are withheld rather than shown at their old price: `price_of`
    refuses to charge one, so quoting it would be quoting a number the product
    will not honour.
    """
    table = await _load_prices(conn)
    return {k: c for k, (c, _unit, active) in table.items() if active}
