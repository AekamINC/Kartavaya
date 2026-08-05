"""
admin_orgs.py — Platform admin: org creation, member assignment, role management,
cost aggregation analytics.
Only platform_admin / account_manager can access these endpoints.
"""
import contextlib
import json
import logging
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.roles import require_platform_role
# The one seat counter, and the one refusal. This module had its OWN copy that
# counted only joined members: an org at 4 joined + 1 invited would admit a
# fifth from the console here, and the invitee's own click then made six in a
# five-seat org. See `org_invites.count_seats`.
from routers.org_invites import SEAT_ROLES, assert_seat_available
# The one place credits are priced, held, spent and returned. Nothing in this
# file names a credit table: this console had two of the five debit-era
# implementations in it, and its burn-rate figure was measuring a different
# thing from the client-facing report it was meant to reconcile against.
#
# CREDIT_PRICE_INR and current_period() come from the same module for the same
# reason: a top-up that lands on an invoice has to be priced, and the period a
# billing line sits in has to be the period the allowance sits in. Retyping
# either here is how the two drift.
from services.credits import (
    CREDIT_PRICE_INR, balance_of, current_period, grant, ledger, usage_summary,
)
from services.encryption import encrypt
from services.provider_costs import get_all_provider_costs
from services.forex import get_usd_inr, get_usd_inr_sync
from services.storage import create_org_bucket, verify_r2_credentials, clear_org_r2_cache
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES, GOD_MODE_ROLES, MANAGER_ROLES, STAFF_ROLES,
    BILLING_CONSOLE_ROLES, FINANCE_CONSOLE_ROLES, SRIJAN_COMMERCIAL_ROLES,
    SUPERUSER_ONLY_ROLES,
    ALL_MODULES as ROLE_TIER_MODULES,
    SENSITIVE_MODULES,
)

# Who may open the platform console. Reaching the console is not the same as
# reading what is in it — role_tiers.can_reach_module still decides that per
# module, so a platform_staff who opens an org sees the operating set and not
# its payroll.
CONSOLE_ROLES = GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + ("account_manager",)
CONSOLE_ROLES_WITH_FINANCE = CONSOLE_ROLES + ("account_finance",)

log = logging.getLogger(__name__)


router = APIRouter(prefix="/api/v1/admin/orgs", tags=["admin-orgs"])

DEFAULT_MARKUP_PCT = 0.30

def _with_inr(cost_usd: float, rate: float, markup: float = 0.30) -> dict:
    """Return USD, INR, and client-charged INR (with markup, ceiled to whole number)."""
    inr = cost_usd * rate
    charged_inr = math.ceil(inr * (1 + markup))
    return {"usd": round(cost_usd, 4), "inr": round(inr, 2), "charged_inr": charged_inr}

PLAN_STORAGE_LIMITS = {
    "free": 0,
    "starter": 5 * 1024**3,
    "growth": 10 * 1024**3,
    "scale": 25 * 1024**3,
}


class R2Credentials(BaseModel):
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket_name: str = "kartavya-storage"

class OrgCreate(BaseModel):
    name: str
    owner_email: EmailStr
    plan_code: str = "free"
    # Bounds on these four are NOT declared here, and deliberately: they are the
    # same four PATCH /settings amends, and a Pydantic bound would answer a 422
    # with a validation blob where the amend path answers a 400 with a sentence.
    # One rule stated once, in `_assert_commercial_bounds`, called by both — see
    # its docstring for what it cost to have the rule on only one of the two.
    markup_pct: float = 0.30
    monthly_credits: Optional[int] = None
    monthly_price: Optional[float] = None
    # Seats bought by this org. None = inherit the plan's default (5 on basic).
    # Not constrained to multiples of 5: that is a pricing convention, and a
    # negotiated 12 must stay expressible.
    max_users: Optional[int] = None
    # Aekam's own org, which skips the ORG BALANCE CHECK and nothing else — per
    # user ceilings still apply and every spend is still written to the ledger.
    # A FLAG rather than a plan of 999999999, because a plan number is something
    # someone later believes, reconciles against and invoices.
    is_platform_org: bool = False
    r2: Optional[R2Credentials] = None


#: Fields on the create body that are COMMERCIAL TERMS rather than provisioning.
#: `create_org` is CONSOLE_ROLES, which includes `platform_staff`; PATCH
#: /settings is BILLING_CONSOLE_ROLES, which does not. So the least-privileged
#: console role could set a customer's MARKUP once, at creation, and never
#: amend it — and was shown a Save button that 403s. role_tiers.py:193-203 states
#: the principle: a role that must not SEE the margin must not be able to set it.
#: The narrow fix is to keep org creation where it is and move these five fields
#: behind the billing roles.
COMMERCIAL_ORG_FIELDS: tuple[str, ...] = (
    "markup_pct", "monthly_credits", "monthly_price", "max_users",
)

#: The one field that is god mode even among the billing roles: it is what
#: skips the balance check, so whoever can set it can give an org free
#: everything.
SUPERUSER_ORG_FIELDS: tuple[str, ...] = ("is_platform_org",)


def _billing_lines():
    """`services/billing_lines.py`, imported at call time rather than at module
    import.

    It is the ONLY writer of `staging.org_billing_lines` — the rule
    `services/credits.py` already holds for the four credit tables, applied to
    the table that says what an org is charged. This console asks it for two
    things and never writes a line itself:

      sync_platform_line(conn, *, org_id, amount, actor_id) -> dict | None
          Makes the one OPEN `kind='platform'` line equal `amount`: creates it
          when there is none, amends it in place when there is, and ENDS it
          (sets `period_end`, never DELETE) when the fee goes to zero. Amending
          in place is not a shortcut — ending a line and opening a second one
          for the same month would put two platform rows in the same invoice
          period, and `uq_obl_open_platform` cannot refuse the second because
          the first is no longer open.

      create_line(conn, *, org_id, kind, description, amount, cadence,
                  period_start, source_ref=None, created_by=None) -> dict
          Inserts one line. A repeat of the same `source_ref` yields the row
          that already exists rather than a second one; `uq_obl_source_ref` is
          what makes the top-up safe to retry.

    Imported inside the call so that a deployment without the billing service
    still serves everything in this file that has nothing to do with billing
    lines — org creation, members, modules, R2, the cost console.

    THAT PROMISE WAS NOT KEPT AT ANY OF THE THREE CALL SITES. A call-time import
    has exactly two ways to be absent — the module is missing (ImportError) or
    migration 096 has not been applied, so every statement it runs raises 42P01 —
    and neither was caught here, while `billing.py:_billing_schema` and
    `subscription.py:create_invoice` both catch the second. `sync_platform_line`
    reaches `_open_line_of_kind` BEFORE its `if fee == 0: return None`, so
    pre-096 even a free org at ₹0 raised 42P01. Every org creation 500'd.

    The two answers, and why they differ, are in `_billing_schema_required` and
    `_platform_line_for_new_org`.
    """
    from services import billing_lines
    return billing_lines


# ── Two failures that are a missing deploy step, not a broken server ─────────


def _billing_schema_missing(exc: BaseException) -> bool:
    """Is this "the billing half is not deployed yet", rather than a real fault?

    Two shapes, one meaning. `ImportError` is `services/billing_lines.py` absent
    from the tree; `42P01` is `staging.org_billing_lines` absent from the
    database because `096_billing_lines.sql` is applied BY HAND and has not been.
    Either way the answer to the operator is the same sentence and it names a
    deploy step, not a bug.

    Matched on `sqlstate` rather than on the asyncpg class — the convention
    `credits._is_unique_violation` sets — so a wrapped driver or a test double
    behaves the same.
    """
    return isinstance(exc, ImportError) or getattr(exc, "sqlstate", None) == "42P01"


@contextlib.contextmanager
def _billing_schema_required(what: str):
    """Refuse, in a sentence that names the migration. For the writes that MUST
    NOT half-happen.

    Used where a billing line is not a decoration on the request but half of it:
    amending `monthly_price` (the scalar is a MIRROR of the line, so writing one
    without the other is a `v_org_platform_line_drift` row, the one thing 096
    promises can never exist) and a top-up ticked "add to invoice" (granting the
    credits and not billing them is exactly the state that tick exists to make
    unreachable). Both are inside a transaction, so the refusal rolls the other
    half back and "Nothing was changed" is a fact rather than a hope.

    `HTTPException` passes through FIRST and untouched: every refusal
    `services/billing_lines.py` raises is one — `BillingLineError` subclasses it —
    and swallowing those would turn a named 409 into "apply a migration".

    Deliberately NOT shared with `billing.py:_billing_schema`, which says the
    same thing for the billing router. Reaching into another router's private to
    save nine lines couples two files that otherwise share nothing, and this one
    has a sibling that must DEGRADE rather than refuse — see
    `_platform_line_for_new_org`. The pair belongs together, here.
    """
    try:
        yield
    except HTTPException:
        raise
    except Exception as exc:                     # noqa: BLE001 — re-raised below
        if not _billing_schema_missing(exc):
            raise
        raise HTTPException(503, {
            "error": "billing_schema_missing",
            "message": (
                f"{what} needs the billing-lines tables and they do not exist in "
                "this database yet, so what this organisation is charged can be "
                "neither read nor changed. Nothing was changed. Apply "
                "backend/migrations/096_billing_lines.sql. Credits and usage are "
                "unaffected — they come from a different module."
            ),
        }) from exc


async def _platform_line_for_new_org(
    conn, *, org_id: str, amount: float, actor_id: str,
) -> tuple[Optional[dict], bool]:
    """`sync_platform_line`, DEGRADED to "no line yet" when 096 is outstanding.

    Returns `(line, pending_migration)`. The flag is what tells a ₹0 free org —
    which correctly has no line — apart from a ₹25,000 org whose line could not
    be written, because the two are the same `None` and only one of them is a
    client who is about to be under-invoiced.

    ── WHY THIS ONE DEGRADES WHEN THE OTHER TWO REFUSE ──────────────────────

    Refusing here would make org creation — the first thing anybody does, and the
    only path to a working tenant — depend on a migration applied by hand in a
    low-traffic window. That is what `_parity_ready` in `routers/messaging.py`
    exists to avoid, and this is the same window seen from the other side.

    It is safe here and nowhere else because THE GAP REPAIRS ITSELF, twice over:
    096's own section 4 backfills one open `platform` line for every org with
    `monthly_price > 0` that has never had one — an org created through this gap
    is named in that WHERE clause by name — and until then, saving the fee again
    through PATCH /settings creates what is absent, because `sync_platform_line`
    creates rather than assumes. Neither is true of a top-up nobody billed.

    ── AND WHY IT IS A SAVEPOINT AND NOT A BARE `try` ───────────────────────

    In Postgres a failed statement poisons the whole transaction: after the
    42P01 every later statement raises 25P02 and the COMMIT rolls back. Catching
    the error without a savepoint would therefore "degrade" into losing the org,
    the subscription, the wallet, the allowance and the owner role — the exact
    orphan `create_org` was rewritten to make impossible, reintroduced by the
    code meant to prevent it. asyncpg's nested `transaction()` is that savepoint:
    the rollback is to just before this call, and the outer transaction lives on.
    """
    try:
        async with conn.transaction():
            line = await _billing_lines().sync_platform_line(
                conn, org_id=org_id, amount=amount, actor_id=actor_id,
            )
    except Exception as exc:                     # noqa: BLE001 — re-raised below
        if not _billing_schema_missing(exc):
            raise
        log.warning(
            "Organisation %s created with no platform billing line: the "
            "billing-lines half is not deployed (%s). Its monthly fee of %s is "
            "in organisations.monthly_price and NOWHERE ELSE, so it will not "
            "appear on an invoice until 096_billing_lines.sql is applied — "
            "which backfills it.",
            org_id, exc.__class__.__name__, amount,
        )
        return None, True
    return line, False


def _assert_commercial_bounds(
    *,
    markup_pct: Optional[float] = None,
    monthly_credits: Optional[int] = None,
    monthly_price: Optional[float] = None,
    max_users: Optional[int] = None,
) -> None:
    """The bounds on the four commercial terms — ONE copy, BOTH paths.

    These rules lived only in PATCH /settings. `create_org` accepts the same four
    fields and validated NONE of them, so the two doors onto one set of columns
    disagreed about what a legal value was:

        POST /orgs  {"monthly_price": -1}  → committed the org, created the R2
                                             bucket, committed the subscription,
                                             and only then reached `_money`,
                                             which refuses a negative amount →
                                             400, and an org nobody owns.
        POST /orgs  {"markup_pct": 40}     → meant 40%, stored as 4000%, and
                                             every cost figure that client is
                                             ever shown is off by two orders of
                                             magnitude. PATCH refuses it.

    A `None` is skipped rather than refused: on the create path it means "take
    the plan's default", and on the amend path it means "leave it alone" for the
    three NOT NULL columns and "clear it" for the nullable one — decided by the
    caller before it gets here, because those two readings cannot both live in a
    bounds check.

    `isfinite` because JSON carries `Infinity` and `NaN` and Python's decoder
    accepts both: `inf < 0` is False and `nan < 0` is False, so a plain `>= 0`
    waves them through to a NUMERIC(10,2) column that answers with a driver
    error and a 500. Money code says what is wrong rather than what broke.
    """
    if markup_pct is not None and not (math.isfinite(markup_pct) and 0 <= markup_pct <= 1):
        raise HTTPException(400, "markup_pct must be between 0 and 1")

    if monthly_credits is not None and monthly_credits < 0:
        raise HTTPException(400, "monthly_credits must be >= 0")

    if monthly_price is not None and not (math.isfinite(monthly_price) and monthly_price >= 0):
        raise HTTPException(400, "monthly_price must be >= 0")

    if max_users is not None and max_users < 1:
        raise HTTPException(
            400, "max_users must be at least 1, or null to use the plan default",
        )


def _clean_vpa(raw) -> Optional[str]:
    """Validate a UPI virtual payment address, or refuse.

    There is no payment gateway and there will not be one: an invoice collects
    by carrying a UPI address, and that address is the entire mechanism. A
    mistyped one does not bounce — it silently collects nothing, or collects for
    somebody else, and nobody finds out until the month is over. `name@bank`,
    both halves non-empty, is the whole format; anything more is a bank's
    business.
    """
    if raw is None:
        return None
    vpa = str(raw).strip()
    if not vpa:
        return None
    handle, _, bank = vpa.partition("@")
    if not handle or not bank or "@" in bank or " " in vpa:
        raise HTTPException(
            400,
            f"'{vpa}' is not a UPI address. It reads name@bank — for example "
            "aekam@okhdfcbank. Clear the field with null if there is no UPI "
            "address for this organisation.",
        )
    return vpa


async def _holds_platform_role(pool, user_id: str, roles: tuple[str, ...]) -> bool:
    """Does this caller hold one of `roles` at platform scope?

    `require_platform_role` returns the USER, not the role it matched, so a
    route guarded at one tier that needs to make a second, narrower decision has
    no way to ask. Rather than change that dependency — it is on ~40 routes —
    this asks the same question the same way.
    """
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
        user_id, list(roles),
    ))


async def _assert_may_set_commercial_terms(pool, user_id: str, supplied: set[str]) -> None:
    """Refuse — loudly — rather than silently dropping a field the caller may not set.

    Dropping would be worse than refusing: the operator sees the org created,
    assumes the 40% markup they typed was applied, and it is 30%. A 403 that
    names the field and the role is a thing they can act on.
    """
    commercial = sorted(set(COMMERCIAL_ORG_FIELDS) & supplied)
    if commercial and not await _holds_platform_role(pool, user_id, BILLING_CONSOLE_ROLES):
        raise HTTPException(
            403,
            f"Setting {', '.join(commercial)} requires one of: "
            f"{', '.join(BILLING_CONSOLE_ROLES)}. Create the organisation "
            "without these fields and ask billing to set them.",
        )

    superuser = sorted(set(SUPERUSER_ORG_FIELDS) & supplied)
    if superuser and not await _holds_platform_role(pool, user_id, SUPERUSER_ONLY_ROLES):
        raise HTTPException(
            403,
            f"Setting {', '.join(superuser)} requires one of: "
            f"{', '.join(SUPERUSER_ONLY_ROLES)}. It is the flag that skips the "
            "credit balance check.",
        )

class OrgMemberAdd(BaseModel):
    email: EmailStr
    roles: list[str] = ["org_member"]
    module_grants: list[str] = []
    mobile_number: str = ""

class RoleAssign(BaseModel):
    user_id: str
    role_code: str
    org_id: Optional[str] = None


# ── Org CRUD ────────────────────────────────────────────────

@router.post("")
async def create_org(
    body: OrgCreate,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Create a new org, link to a team, set owner, assign plan.

    CONSOLE_ROLES may create an organisation. The COMMERCIAL fields on the body
    — markup, monthly credits, monthly price, seats, and the platform-org flag —
    are gated separately; see `_assert_may_set_commercial_terms`.

    ── ONE TRANSACTION, AND THE ONE STEP THAT CANNOT JOIN IT ─────────────────

    This handler used to be six sequential AUTOCOMMITTED writes with an external
    R2 bucket creation in the middle of them: organisations, bucket,
    subscriptions, wallet + allowance + platform line, user_roles. A failure at
    ANY point after the first left an ORPHAN — an org row, a subscription row and
    a live bucket with NO OWNER ROLE, no wallet, no allowance and no billing
    line. The 500 that reported it looks transient, so the operator retried, and
    the retry hit the 409 above: the org was then permanently uncreatable through
    the console and had to be cleaned up in psql. A half-created org that blocks
    its own retry is worse than a clean refusal.

    So every database write below is ONE transaction. A failure anywhere in it
    leaves the team exactly as it was, the 409 does not fire, and the retry
    works. That is also what makes the degrade in `_platform_line_for_new_org`
    honest: the ONLY thing an org created before 096 is missing is its platform
    line, not four rows out of five.

    THE R2 BUCKET IS CREATED LAST, AFTER THE COMMIT, and that is not a
    preference. `storage.create_org_bucket` reads the org's own credentials back
    out of `staging.organisations` THROUGH A SECOND POOL CONNECTION — inside the
    transaction it would find no row, log "R2 not configured for org", skip the
    bucket and return None, silently. After the commit it is also the only step
    that cannot be rolled back, and it is placed where nothing that can fail is
    left to fail: it is idempotent (`BucketAlreadyOwnedByYou` is swallowed), and
    `PUT /{org_id}/r2` re-runs it. THAT is the compensation, and it is a repair
    an operator can perform on a WORKING org rather than one this handler has to
    attempt against a Cloudflare account that may not be answering.
    """
    pool = await get_pool()

    # `model_fields_set`, not truthiness: `markup_pct` has a default of 0.30, so
    # asking "did they send one" by looking at the value cannot tell a caller
    # who typed 0.30 from a caller who typed nothing.
    await _assert_may_set_commercial_terms(pool, user["user_id"], set(body.model_fields_set))

    # BEFORE the first read, and long before the first write. The same four
    # bounds PATCH /settings applies; see `_assert_commercial_bounds` for what
    # it cost to have them on only one of the two doors. Ordered after the role
    # gate on purpose — a caller who may not set a commercial term is told that,
    # not told which values of it are legal.
    _assert_commercial_bounds(
        markup_pct=body.markup_pct,
        monthly_credits=body.monthly_credits,
        monthly_price=body.monthly_price,
        max_users=body.max_users,
    )

    owner = await pool.fetchrow(
        "SELECT user_id, email FROM users WHERE LOWER(email)=LOWER($1)",
        body.owner_email,
    )
    if not owner:
        raise HTTPException(
            404,
            f"No user found with email '{body.owner_email}'. "
            "They must register first before an org can be created for them.",
        )

    tm = await pool.fetchrow(
        "SELECT team_id FROM team_members WHERE user_id=$1 AND status='active' LIMIT 1",
        owner["user_id"],
    )
    if not tm:
        raise HTTPException(
            400,
            "User has no active team. They must create a team first.",
        )

    existing = await pool.fetchrow(
        "SELECT id FROM staging.organisations WHERE team_id=$1",
        tm["team_id"],
    )
    if existing:
        raise HTTPException(409, "An organisation already exists for this team")

    plan = await pool.fetchrow(
        "SELECT id, code, default_credits FROM staging.plans WHERE code=$1 AND is_active=TRUE",
        body.plan_code,
    )
    if not plan:
        raise HTTPException(400, f"Invalid plan code: {body.plan_code}")

    org_id = uuid.uuid4()
    storage_limit = PLAN_STORAGE_LIMITS.get(body.plan_code, 0)

    r2_account_id = body.r2.account_id if body.r2 else None
    r2_access_key = body.r2.access_key_id if body.r2 else None
    # Encrypted at rest, like the update path below. `encrypt` returns None
    # untouched, so an org created without R2 credentials is unaffected.
    r2_secret_key = encrypt(body.r2.secret_access_key) if body.r2 else None
    r2_bucket = body.r2.bucket_name if body.r2 else None

    monthly_credits = body.monthly_credits if body.monthly_credits is not None else (plan["default_credits"] or 0)
    monthly_price = body.monthly_price if body.monthly_price is not None else 0

    # ── Every row this org needs, or none of them ────────────────────────────
    #
    # See the docstring. The order inside is unchanged apart from the owner role,
    # which has moved in from after the block: it was the LAST write and the one
    # most often lost, and an org whose owner cannot open it is the orphan in its
    # purest form.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO staging.organisations "
                "(id, team_id, name, owner_user_id, r2_account_id, r2_access_key_id, "
                " r2_secret_access_key, r2_bucket_name, storage_limit_bytes, markup_pct, "
                " monthly_credits, monthly_price, max_users, is_platform_org, is_active) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE)",
                org_id, tm["team_id"], body.name, owner["user_id"],
                r2_account_id, r2_access_key, r2_secret_key, r2_bucket,
                storage_limit, body.markup_pct, monthly_credits, monthly_price,
                body.max_users, body.is_platform_org,
            )

            await conn.execute(
                "INSERT INTO staging.subscriptions (org_id, plan_id, status) "
                "VALUES ($1, $2, 'active')",
                org_id, plan["id"],
            )

            # ── Every org gets a wallet row. A zero balance IS a balance ─────
            #
            # This insert used to be conditioned on `monthly_credits > 0`, and
            # the startup seed in server.py carried the identical filter, so an
            # org Aekam deliberately negotiated down to zero got NO ROW AT ALL.
            # From there: `_maybe_reset_monthly_credits` returned forever at
            # `if not wallet`, every debit answered 402 permanently, and the only
            # self-heal in the product sat behind `require_module("srijan")` — so
            # an org without Srijan could never acquire a wallet through any path.
            #
            # `credits.balance_of` heals a missing row in place, which is why this
            # is a call rather than an INSERT: there is one writer of the credit
            # tables and it is not this file.
            await balance_of(conn, str(org_id))

            if monthly_credits > 0:
                # ALLOWANCE, not purchased. The first month's grant is a grant:
                # it resets with the month and does not carry over. Booking it
                # as purchased would make credits nobody paid for survive
                # forever, which is the mirror of the bug where the month roll
                # destroyed credits somebody did pay for.
                await grant(
                    conn,
                    org_id=str(org_id),
                    credits=monthly_credits,
                    bucket="allowance",
                    granted_by=user["user_id"],
                    description="Initial monthly allowance",
                    idempotency_key=f"orgcreate:{org_id}:allowance",
                )

            # ── The platform fee, as a row rather than as a number ───────────
            #
            # `monthly_price` is a scalar with no description, no start date and
            # no way to say "and ₹8,000/mo for support since March". Migration
            # 096 demotes it to a mirror of the one open `platform` line and
            # adds `v_org_platform_line_drift`, which must always return zero
            # rows. This is where a NEW org gets its line — 096 backfills the
            # ones that already exist. A price of zero writes nothing: an org on
            # a free plan is not billed a ₹0 platform fee every month.
            #
            # The ONE call in this file that degrades instead of refusing, and
            # `_platform_line_for_new_org` argues out why it may.
            platform_line, billing_pending = await _platform_line_for_new_org(
                conn,
                org_id=str(org_id),
                amount=float(monthly_price),
                actor_id=user["user_id"],
            )

            await conn.execute(
                "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
                "VALUES ($1, $2, 'org_admin', $3)",
                owner["user_id"], org_id, user["user_id"],
            )

            # Inside, with the rows it describes. An `org_created` event for an
            # org that rolled back is a line in the audit trail that names an
            # organisation nobody can find.
            await _log_event(conn, str(org_id), "org_created", {
                "name": body.name,
                "owner": owner["email"],
                "plan": body.plan_code,
                "created_by": user["user_id"],
                # Written down where it is searchable, not only in the logs: an
                # org whose fee reached no billing line is one an invoice will
                # under-charge until 096 lands and backfills it.
                "platform_line": bool(platform_line),
                "billing_schema_pending": billing_pending,
            })

    # ── The one step that cannot join the transaction ────────────────────────
    #
    # Last, after the commit, for the two reasons in the docstring: it reads the
    # org row back through its own connection, and it is the only write here that
    # no rollback can reach.
    #
    # A failure is SWALLOWED rather than raised. `create_org_bucket` already
    # absorbs everything Cloudflare can answer, but the credential read in front
    # of it does not — and a 500 from this line would tell the operator that a
    # fully-created org was not created, which is precisely the misreading that
    # sent them into the 409 in the first place. The org is real, the owner can
    # open it, and `PUT /{org_id}/r2` creates the bucket on demand.
    bucket_name = None
    if body.r2:
        try:
            bucket_name = await create_org_bucket(str(org_id))
        except Exception:                        # noqa: BLE001 — reported, not raised
            log.exception(
                "Organisation %s was created but its R2 bucket was not. The org "
                "is complete and usable; re-run PUT /api/v1/admin/orgs/%s/r2 to "
                "create the bucket.", org_id, org_id,
            )

    return {
        "org_id": str(org_id),
        "name": body.name,
        "owner": owner["email"],
        "plan": body.plan_code,
        "r2_bucket": bucket_name,
        "r2_configured": body.r2 is not None,
        # Stated rather than assumed, exactly as the top-up's `invoiced` flag is:
        # `platform_line` is None BOTH for a free org that correctly has no line
        # and for a paying org whose line could not be written, and only the
        # second is a client about to be under-invoiced. The flag is what tells
        # them apart on the screen instead of in a log nobody is reading.
        "platform_line": platform_line,
        "billing_schema_pending": billing_pending,
    }


@router.get("")
async def list_orgs(
    count_only: int = 0,
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """List all orgs with plan and owner info.

    `count_only=1` returns just `{"count": n}`. The admin sidebar badge
    (01-navigation.md §4) needs the number on every admin page, and pulling
    every org row plus its plan and owner joins to render one integer is the
    kind of waste that only shows up once a customer has a few hundred orgs.
    """
    pool = await get_pool()
    if count_only:
        n = await pool.fetchval("SELECT COUNT(*) FROM staging.organisations")
        return {"count": n or 0}
    rows = await pool.fetch(
        # max_users and is_platform_org are returned because they are amendable
        # commercial terms like the three beside them. max_users in particular
        # was returned by NO endpoint while the seat refusal told the operator
        # to raise it — advice about a field the console could not read or write.
        "SELECT o.id, o.name, o.team_id, o.owner_user_id, o.is_active, "
        "o.storage_used_bytes, o.storage_limit_bytes, o.created_at, "
        "o.markup_pct, o.monthly_credits, o.monthly_price, "
        "o.max_users, o.is_platform_org, "
        # The invoice builder derives place of supply from the client's GSTIN —
        # the first two digits are the state code, and there is no API that will
        # tell it. It reads the org list and nothing else, so without this it was
        # asking the operator to retype a number the database already holds.
        "o.gstin, "
        "p.code as plan_code, p.name as plan_name, "
        "u.email as owner_email, u.full_name as owner_name "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN users u ON u.user_id = o.owner_user_id "
        "ORDER BY o.created_at DESC"
    )
    return {"data": [dict(r) for r in rows]}


# ── Cost Aggregation (platform-wide) ──────────────────────
# NOTE: These must be declared before /{org_id} to avoid
# FastAPI matching "platform-analytics" as an org_id.

def _period_start(period: str) -> date:
    """Convert period string to a start date."""
    today = date.today()
    if period == "7d":
        return today - timedelta(days=7)
    if period == "90d":
        return today - timedelta(days=90)
    if period == "ytd":
        return date(today.year, 1, 1)
    return today - timedelta(days=30)  # default 30d


@router.get("/platform-analytics")
async def platform_analytics(
    period: str = "30d",
    user=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    """Platform-wide KPIs for Aekam super-admin dashboard."""
    pool = await get_pool()
    start = _period_start(period)

    total_orgs = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.organisations WHERE is_active=TRUE"
    )
    total_users = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id IS NOT NULL"
    )

    # Revenue = margin earned from AI + scraper usage per org (charged_inr - cost_inr)
    margin_rows = await pool.fetch(
        "SELECT o.markup_pct, "
        "COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0) as total_cost_usd "
        "FROM staging.organisations o "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(l.cost_usd) as cost "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = o.id AND l.created_at >= $1"
        ") ai ON TRUE "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(r.cost_usd) as cost "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = o.id AND r.created_at >= $1"
        ") sc ON TRUE "
        "WHERE o.is_active=TRUE AND "
        "(COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0)) > 0",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )
    rate_for_rev = await get_usd_inr()
    total_revenue_inr = sum(
        math.ceil(float(r["total_cost_usd"]) * rate_for_rev * (1 + float(r["markup_pct"])))
        for r in margin_rows
    )
    total_cost_inr = sum(
        round(float(r["total_cost_usd"]) * rate_for_rev, 2)
        for r in margin_rows
    )

    ai_stats = await pool.fetchrow(
        "SELECT COALESCE(SUM(l.cost_usd), 0) as total_cost, COUNT(*) as total_calls "
        "FROM staging.hub_ai_logs l "
        "WHERE l.created_at >= $1",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )

    total_scraper_cost = await pool.fetchval(
        "SELECT COALESCE(SUM(cost_usd), 0) FROM staging.hub_scraper_runs "
        "WHERE created_at >= $1",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    ) or 0

    by_provider = await pool.fetch(
        "SELECT l.provider, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, "
        "COUNT(*) as call_count "
        "FROM staging.hub_ai_logs l "
        "WHERE l.created_at >= $1 "
        "GROUP BY l.provider ORDER BY cost_usd DESC",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )

    top_orgs = await pool.fetch(
        "SELECT o.id as org_id, o.name as org_name, o.markup_pct, "
        "COALESCE(ai.cost, 0) as ai_cost_usd, "
        "COALESCE(sc.cost, 0) as scraper_cost_usd, "
        "COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0) as total_cost_usd "
        "FROM staging.organisations o "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(l.cost_usd) as cost "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = o.id AND l.created_at >= $1"
        ") ai ON TRUE "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(r.cost_usd) as cost "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = o.id AND r.created_at >= $1"
        ") sc ON TRUE "
        "WHERE o.is_active=TRUE "
        "ORDER BY total_cost_usd DESC NULLS LAST "
        "LIMIT 10",
        datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
    )

    ai_cost = float(ai_stats["total_cost"])
    scraper_cost = float(total_scraper_cost)
    total_cost = ai_cost + scraper_cost
    rate = await get_usd_inr()

    return {
        "period": period,
        "total_orgs": total_orgs,
        "total_users": total_users,
        "total_revenue_inr": round(total_revenue_inr, 2),
        "total_cost_inr": round(total_cost_inr, 2),
        "margin_inr": round(total_revenue_inr - total_cost_inr, 2),
        "total_ai_cost_usd": ai_cost,
        "total_scraper_cost_usd": scraper_cost,
        "total_cost": _with_inr(total_cost, rate),
        "ai_cost": _with_inr(ai_cost, rate),
        "scraper_cost": _with_inr(scraper_cost, rate),
        "total_ai_calls": ai_stats["total_calls"],
        "default_markup_pct": DEFAULT_MARKUP_PCT,
        "usd_to_inr": rate,
        "ai_cost_by_provider": [
            {"provider": r["provider"], "cost_usd": float(r["cost_usd"]),
             "cost": _with_inr(float(r["cost_usd"]), rate),
             "call_count": r["call_count"]}
            for r in by_provider
        ],
        "top_orgs_by_spend": [
            {"org_id": str(r["org_id"]), "org_name": r["org_name"],
             "ai_cost_usd": float(r["ai_cost_usd"]),
             "scraper_cost_usd": float(r["scraper_cost_usd"]),
             "total_cost_usd": float(r["total_cost_usd"]),
             "markup_pct": float(r["markup_pct"]),
             "total": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"])),
             "charged_inr": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"]))["charged_inr"],
             "margin_inr": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"]))["charged_inr"]
                           - round(float(r["total_cost_usd"]) * rate, 2)}
            for r in top_orgs
        ],
    }


@router.get("/cost-summary")
async def all_orgs_cost_summary(
    period: str = "30d",
    user=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    """All orgs cost summary table for admin cost dashboard."""
    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    rows = await pool.fetch(
        "SELECT o.id as org_id, o.name as org_name, o.markup_pct, "
        "p.name as plan_name, "
        "COALESCE(ai.cost, 0) as ai_cost_usd, "
        "COALESCE(ai.calls, 0) as ai_calls, "
        "COALESCE(sc.cost, 0) as scraper_cost_usd, "
        "COALESCE(ai.cost, 0) + COALESCE(sc.cost, 0) as total_cost_usd, "
        "GREATEST(ai.last_at, sc.last_at) as last_active "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(l.cost_usd) as cost, COUNT(*) as calls, "
        "  MAX(l.created_at) as last_at "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = o.id AND l.created_at >= $1"
        ") ai ON TRUE "
        "LEFT JOIN LATERAL ("
        "  SELECT SUM(r.cost_usd) as cost, MAX(r.created_at) as last_at "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = o.id AND r.created_at >= $1"
        ") sc ON TRUE "
        "WHERE o.is_active=TRUE "
        "ORDER BY total_cost_usd DESC NULLS LAST",
        cutoff,
    )

    rate = await get_usd_inr()

    return {
        "period": period,
        "default_markup_pct": DEFAULT_MARKUP_PCT,
        "usd_to_inr": rate,
        "data": [
            {
                "org_id": str(r["org_id"]),
                "org_name": r["org_name"],
                "plan_name": r["plan_name"],
                "markup_pct": float(r["markup_pct"]),
                "ai_cost_usd": float(r["ai_cost_usd"]),
                "scraper_cost_usd": float(r["scraper_cost_usd"]),
                "total_cost_usd": float(r["total_cost_usd"]),
                "total": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"])),
                "charged_inr": _with_inr(float(r["total_cost_usd"]), rate, float(r["markup_pct"]))["charged_inr"],
                "ai_calls": r["ai_calls"],
                "last_active": r["last_active"].isoformat() if r["last_active"] else None,
            }
            for r in rows
        ],
    }


@router.get("/provider-costs")
async def provider_costs(
    user=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    """Real-time costs from provider accounts for reconciliation against tracked spend."""
    pool = await get_pool()

    # Tracked totals from internal logs (all-time)
    ai_by_provider = await pool.fetch(
        "SELECT provider, COALESCE(SUM(cost_usd), 0) as total "
        "FROM staging.hub_ai_logs GROUP BY provider"
    )
    tracked_ai = {r["provider"]: float(r["total"]) for r in ai_by_provider}

    tracked_scraper = await pool.fetchval(
        "SELECT COALESCE(SUM(cost_usd), 0) FROM staging.hub_scraper_runs"
    ) or 0

    # Map internal provider names to reconciliation buckets
    tracked_openrouter = sum(
        v for k, v in tracked_ai.items()
        if k in ("openrouter", "gemini_lite_or", "glm", "qwen_flash",
                  "qwen_plus", "gemini_flash_or", "gemini_pro_or")
    )
    tracked_hf = tracked_ai.get("huggingface", 0)

    tracked_totals = {
        "openrouter": round(tracked_openrouter, 6),
        "apify": round(float(tracked_scraper), 6),
        "huggingface": round(tracked_hf, 6),
    }

    # Fetch real provider costs
    providers = await get_all_provider_costs()

    # Compute discrepancies where provider data is available
    discrepancy = {}
    for key in ("openrouter", "apify", "huggingface"):
        provider_data = providers.get(key, {})
        if "error" in provider_data:
            discrepancy[key] = None
        else:
            provider_total = provider_data.get("total_spend_usd", 0)
            discrepancy[key] = round(provider_total - tracked_totals[key], 6)

    return {
        "providers": providers,
        "tracked_totals": tracked_totals,
        "discrepancy": discrepancy,
    }


@router.get("/{org_id}")
async def get_org(
    org_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Get org details including members and roles."""
    pool = await get_pool()
    org = await pool.fetchrow(
        "SELECT o.id, o.team_id, o.name, o.owner_user_id, o.is_active, "
        "o.r2_account_id, o.r2_bucket_name, o.storage_limit_bytes, "
        "o.markup_pct, o.monthly_credits, o.monthly_price, "
        # See list_orgs: both admin SELECTs return these now, and PATCH
        # /settings writes them. A commercial term that can be set once and
        # never read back is not a term, it is a guess.
        "o.max_users, o.is_platform_org, "
        "o.created_at, o.updated_at, "
        "p.code as plan_code, p.name as plan_name, "
        "u.email as owner_email "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "LEFT JOIN users u ON u.user_id = o.owner_user_id "
        "WHERE o.id=$1::uuid",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    members = await pool.fetch(
        "SELECT ur.user_id, ur.role_code, ur.granted_at, "
        "u.email, u.full_name "
        "FROM staging.user_roles ur "
        "JOIN users u ON u.user_id = ur.user_id "
        "WHERE ur.org_id=$1::uuid "
        "ORDER BY ur.granted_at",
        org_id,
    )

    modules = await pool.fetch(
        "SELECT module_code, is_active, activated_at "
        "FROM staging.module_subscriptions WHERE org_id=$1::uuid",
        org_id,
    )

    member_modules = await pool.fetch(
        "SELECT user_id, module_code FROM staging.org_member_modules "
        "WHERE org_id=$1::uuid",
        org_id,
    )

    return {
        "org": dict(org),
        "members": [dict(m) for m in members],
        "modules": [dict(m) for m in modules],
        "member_modules": [dict(mm) for mm in member_modules],
    }


@router.patch("/{org_id}/deactivate")
async def deactivate_org(
    org_id: str,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.organisations SET is_active=FALSE WHERE id=$1::uuid",
        org_id,
    )
    await pool.execute(
        "UPDATE staging.subscriptions SET status='cancelled' WHERE org_id=$1::uuid",
        org_id,
    )
    return {"status": "deactivated"}


@router.patch("/{org_id}/settings")
async def update_org_settings(
    org_id: str,
    body: dict,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    """Amend an org's commercial terms: markup, monthly credits, monthly price,
    seats, and the platform-org flag.

    BILLING_CONSOLE_ROLES, not CONSOLE_ROLES. Every field this writes is a
    commercial term, and CONSOLE_ROLES includes `platform_staff`, whose remit
    role_tiers.py:36-38 defines as the operating set: CRM, sales, marketing,
    Srijan, analytics, messaging, core PM. Not what a customer is charged.

    `11-platform-admin.md` §3 is explicit on the same point from the design
    side: `lib/platformRoles.js  5 roles; only admin + finance see cost`. A role
    that must not SEE the margin must not be able to set it. `create_org` now
    gates the same five fields on the same set, so a term that can be set at
    creation can be amended afterwards by the roles that could set it.

    **On a null.** Every one of these used to be read as
    `if "x" in body: float(body["x"])`, so a cleared field — which arrives as
    PRESENT AND NULL, not absent — went through `float(None)` and answered 500.
    A negotiated fee could not be un-set. The two shapes now mean different
    things, and they have to, because the columns differ:

      · `max_users` is NULLABLE, and NULL is meaningful there — "fall back to
        the plan's seat count". So null CLEARS it.
      · `markup_pct`, `monthly_credits`, `monthly_price` are NOT NULL. There is
        no value null could be written as, so null means NO CHANGE. Sending
        `{"monthly_price": null}` is how a form that renders every field posts
        the ones it did not touch, and that must not 500 or zero the fee.

    **On the monthly fee.** After migration 096 the fee lives in two places, and
    the authority is `staging.org_billing_lines`: an invoice is a query over the
    lines due in a period, and nothing charges from `monthly_price` any more.
    The column stays because four endpoints select it and three screens render
    it, so it is kept as a MIRROR of the one open `platform` line — and the two
    are written in ONE transaction, because `v_org_platform_line_drift` must
    always return zero rows, exactly as `v_org_credit_drift` must. If they ever
    disagree the line wins and `monthly_price` is the bug.

    A request that does not carry a fee takes the plain single-statement path:
    there is no second table to keep in step, and wrapping one UPDATE in a
    transaction to look symmetrical would be decoration.

    Saving the fee again is also the REPAIR for an org whose line went missing —
    `sync_platform_line` creates what is absent rather than assuming it is there.
    """
    pool = await get_pool()
    updates = []
    params = []
    idx = 1

    def _number(field: str, cast):
        """Cast a supplied value, or answer 400 rather than 500.

        `int("abc")` and `float([])` both raise ValueError/TypeError out of a
        request handler, which is a 500 for what is plainly a bad request.
        """
        try:
            return cast(body[field])
        except (TypeError, ValueError):
            raise HTTPException(400, f"{field} must be a number")

    # NOT NULL columns: a null is "leave it alone".
    #
    # The bounds themselves moved to `_assert_commercial_bounds`, which POST
    # /orgs now calls with the same four values. They were stated only here, and
    # the create path — same fields, same columns — accepted anything.
    if body.get("markup_pct") is not None:
        pct = _number("markup_pct", float)
        _assert_commercial_bounds(markup_pct=pct)
        updates.append(f"markup_pct=${idx}")
        params.append(pct)
        idx += 1

    if body.get("monthly_credits") is not None:
        mc = _number("monthly_credits", int)
        _assert_commercial_bounds(monthly_credits=mc)
        updates.append(f"monthly_credits=${idx}")
        params.append(mc)
        idx += 1

    # Held in a name rather than pushed straight into `updates`, because this is
    # the one field on the body that lands in two tables. See the write below.
    fee: Optional[float] = None
    if body.get("monthly_price") is not None:
        fee = _number("monthly_price", float)
        _assert_commercial_bounds(monthly_price=fee)
        updates.append(f"monthly_price=${idx}")
        params.append(fee)
        idx += 1

    # Nullable column: `in body` rather than `is not None`, because null here is
    # a value the operator meant. Seats had NO update path at all — the seat
    # refusal told the operator to raise max_users and nothing in the product
    # could.
    if "max_users" in body:
        seats = None if body["max_users"] is None else _number("max_users", int)
        _assert_commercial_bounds(max_users=seats)
        updates.append(f"max_users=${idx}")
        params.append(seats)
        idx += 1

    # ── Where an invoice tells the client to send the money ──────────────────
    #
    # Migration 096 puts `upi_vpa` / `upi_payee_name` on both `organisations` and
    # `subscription_invoices`, and an issued invoice SNAPSHOTS them, so changing
    # the payee later cannot rewrite an invoice already sent. That makes this the
    # writer of the live value — and without it the only collection mechanism the
    # product has would be settable by psql alone.
    #
    # Nullable, like `max_users`: `in body` rather than `is not None`, because
    # clearing a payee is a thing an operator means.
    if "upi_vpa" in body:
        updates.append(f"upi_vpa=${idx}")
        params.append(_clean_vpa(body["upi_vpa"]))
        idx += 1

    if "upi_payee_name" in body:
        name = None if body["upi_payee_name"] is None else str(body["upi_payee_name"]).strip()
        updates.append(f"upi_payee_name=${idx}")
        params.append(name or None)
        idx += 1

    # God mode alone, even among the billing roles: this is the flag that skips
    # the org balance check entirely, so the role that can set it can give an
    # org free everything. Metering still happens for a platform org — the
    # ledger row is still written — but nothing is refused for want of credits.
    if body.get("is_platform_org") is not None:
        if not await _holds_platform_role(pool, user["user_id"], SUPERUSER_ONLY_ROLES):
            raise HTTPException(
                403,
                f"Setting is_platform_org requires one of: "
                f"{', '.join(SUPERUSER_ONLY_ROLES)}.",
            )
        updates.append(f"is_platform_org=${idx}")
        params.append(bool(body["is_platform_org"]))
        idx += 1

    if not updates:
        raise HTTPException(400, "No fields to update")

    params.append(org_id)
    sql = (
        f"UPDATE staging.organisations SET {', '.join(updates)}, updated_at=NOW() "
        f"WHERE id=${idx}::uuid"
    )

    if fee is None:
        await pool.execute(sql, *params)
    else:
        # One fact, two tables, one transaction. Either the fee moves in both
        # places or it moves in neither — a half-written fee is a drift row, and
        # the drift row is the thing this design promises can never exist.
        #
        # Which is exactly why this call REFUSES where org creation degrades: if
        # the line cannot be written, writing the scalar alone would create the
        # drift the transaction is here to prevent. The wrapper is outside the
        # `async with`, so the UPDATE is already rolled back by the time the
        # sentence claiming "Nothing was changed" is composed.
        with _billing_schema_required("Changing this organisation's monthly fee"):
            async with pool.acquire() as conn:
                async with conn.transaction():
                    # RETURNING, so a fee aimed at an org that does not exist is
                    # the 404 the read-back below would have given rather than a
                    # foreign key violation from the line insert that follows it.
                    if await conn.fetchval(sql + " RETURNING id", *params) is None:
                        raise HTTPException(404, "Organisation not found")
                    await _billing_lines().sync_platform_line(
                        conn, org_id=org_id, amount=fee, actor_id=user["user_id"],
                    )

    row = await pool.fetchrow(
        "SELECT markup_pct, monthly_credits, monthly_price, max_users, is_platform_org "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row:
        raise HTTPException(404, "Organisation not found")
    return {
        "markup_pct": float(row["markup_pct"]),
        "monthly_credits": row["monthly_credits"],
        "monthly_price": float(row["monthly_price"]),
        # None is unlimited-by-plan, not zero. Rendered as-is so the console can
        # tell "inherits the plan" from "capped at nothing".
        "max_users": row["max_users"],
        "is_platform_org": bool(row["is_platform_org"]),
    }


# ── Member Management ───────────────────────────────────────

#: Kept as a name because this module has always exported it; the VALUE now
#: comes from `role_tiers.ORG_ROLES` through `org_invites.SEAT_ROLES`, so the
#: four copies of this three-element list are one list.
ORG_MEMBER_ROLES = SEAT_ROLES


@router.post("/{org_id}/members")
async def add_member(
    org_id: str,
    body: OrgMemberAdd,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Add a user to an org with specified roles."""
    pool = await get_pool()

    org = await pool.fetchrow(
        "SELECT id, team_id FROM staging.organisations WHERE id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    target = await pool.fetchrow(
        "SELECT user_id FROM users WHERE LOWER(email)=LOWER($1)",
        body.email,
    )
    if not target:
        raise HTTPException(404, f"No user found with email '{body.email}'")

    if body.mobile_number:
        await pool.execute(
            "UPDATE users SET mobile_number=$1 WHERE user_id=$2",
            body.mobile_number.strip(), target["user_id"],
        )

    valid_org_roles = {"org_admin", "org_member"}
    for role in body.roles:
        if role not in valid_org_roles:
            raise HTTPException(400, f"Invalid org role: {role}. Valid: {', '.join(valid_org_roles)}")

    await assert_seat_available(
        pool, org_id, email=body.email, user_id=target["user_id"],
    )

    is_team_member = await pool.fetchval(
        "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        org["team_id"], target["user_id"],
    )
    if not is_team_member:
        await pool.execute(
            "INSERT INTO team_members (member_id, team_id, email, user_id, role, status) "
            "VALUES ($1, $2, $3, $4, 'member', 'active') "
            "ON CONFLICT DO NOTHING",
            f"mem_{uuid.uuid4().hex[:12]}", org["team_id"],
            body.email, target["user_id"],
        )

    for role in body.roles:
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT (user_id, org_id, role_code) DO NOTHING",
            target["user_id"], org_id, role, user["user_id"],
        )

    # Module grants: if explicit list provided, use it;
    # otherwise auto-grant non-sensitive modules that are enabled for this org
    # Was a retyped `{"vetana", "ganit", "manav"}`. Identical to
    # role_tiers.SENSITIVE_MODULES today, which is exactly why it was worth
    # importing: two copies that agree are one edit away from disagreeing, and
    # the direction this one fails in is auto-granting payroll.
    SENSITIVE = SENSITIVE_MODULES
    target_uid = target["user_id"]

    if body.module_grants:
        grant_codes = body.module_grants
    else:
        # Auto-grant non-sensitive enabled modules for org_member
        # org_admin/org_owner get all modules implicitly (checked at runtime)
        if any(r in ("org_admin", "org_owner") for r in body.roles):
            grant_codes = []  # admins don't need explicit grants
        else:
            enabled = await pool.fetch(
                "SELECT module_code FROM staging.module_subscriptions "
                "WHERE org_id=$1::uuid AND is_active=TRUE",
                org_id,
            )
            grant_codes = [r["module_code"] for r in enabled if r["module_code"] not in SENSITIVE_MODULES]

    for mc in grant_codes:
        if mc not in ALL_MODULES:
            continue
        await pool.execute(
            "INSERT INTO staging.org_member_modules (user_id, org_id, module_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT (user_id, org_id, module_code) DO NOTHING",
            target_uid, org_id, mc, user["user_id"],
        )

    await _log_event(pool, org_id, "member_added", {
        "email": body.email,
        "roles": body.roles,
        "modules": grant_codes,
        "added_by": user["user_id"],
    })

    return {"status": "added", "email": body.email, "roles": body.roles, "modules": grant_codes}


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(
    org_id: str,
    user_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.user_roles WHERE user_id=$1 AND org_id=$2::uuid",
        user_id, org_id,
    )
    return {"status": "removed"}


# ── Role Management ─────────────────────────────────────────

@router.get("/users/search")
async def search_user_by_email(
    email: str = Query(...),
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT user_id, email, name AS full_name FROM users WHERE LOWER(email)=LOWER($1)",
        email,
    )
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)


@router.get("/roles/platform")
async def list_platform_roles(
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT r.id, r.user_id, r.role_code, r.granted_at, "
        "u.email, u.name AS full_name "
        "FROM staging.user_roles r "
        "JOIN users u ON u.user_id = r.user_id "
        "WHERE r.org_id IS NULL "
        "ORDER BY r.granted_at DESC"
    )
    return [dict(r) for r in rows]


@router.post("/roles/assign")
async def assign_role(
    body: RoleAssign,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Assign any role (platform or org-scoped) to a user."""
    pool = await get_pool()

    # The email comes back with the existence check because the seat count needs
    # it: this person may hold the very pending invite that is reserving the
    # seat they are about to be given, and counting it would refuse them their
    # own reservation.
    target = await pool.fetchrow("SELECT email FROM users WHERE user_id=$1", body.user_id)
    if not target:
        raise HTTPException(404, "User not found")

    # `developer` used to be admitted here alongside ALL_PLATFORM_ROLES. It is a
    # role code that appears nowhere in role_tiers, so `modules_for()` returns
    # nothing for it, `require_platform_role` never names it and
    # `is_platform_staff` does not count it — it was assignable and then meant
    # nothing, which is the worst state for a role to be in: it looks granted on
    # the roles screen and grants zero. Removing it is not a narrowing; there is
    # nothing it could reach.
    platform_roles = set(ALL_PLATFORM_ROLES)
    org_roles = {"org_admin", "org_member"}

    if body.role_code in platform_roles:
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, NULL, $2, $3) "
            "ON CONFLICT DO NOTHING",
            body.user_id, body.role_code, user["user_id"],
        )
    elif body.role_code in org_roles:
        if not body.org_id:
            raise HTTPException(400, "org_id required for org-scoped roles")
        # The third way into an org, and it was the one with no seat check.
        # `add_member` above and `org_members.add_member` both count seats; this
        # writes the same `user_roles` row directly, so an org at its allowance
        # could be pushed past it here without the cap ever being consulted.
        await assert_seat_available(
            pool, body.org_id, email=target["email"], user_id=body.user_id,
        )
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT DO NOTHING",
            body.user_id, body.org_id, body.role_code, user["user_id"],
        )
    else:
        raise HTTPException(400, f"Invalid role: {body.role_code}")

    return {"status": "assigned", "role": body.role_code}


@router.delete("/roles/{role_id}")
async def revoke_role(
    role_id: str,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    pool = await get_pool()

    # Refuse to revoke the LAST god-mode row.
    #
    # God mode is held by three people (RBAC-SPEC.md:18). Nothing here stopped
    # the third revocation, and there is no other endpoint that can grant a
    # platform role — `assign_role` above is itself SUPERUSER_ONLY_ROLES. So the
    # last revocation is unrecoverable through the application: it would take a
    # direct write to `staging.user_roles` on the shared Supabase project to undo.
    #
    # This is not a permission check. It is a refusal to let a correct
    # permission be used to destroy the permission.
    row = await pool.fetchrow(
        "SELECT user_id, role_code FROM staging.user_roles WHERE id=$1::uuid",
        role_id,
    )
    if not row:
        raise HTTPException(404, "Role assignment not found")

    if row["role_code"] in GOD_MODE_ROLES:
        remaining = await pool.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
            "WHERE org_id IS NULL AND role_code = ANY($1::text[]) AND id != $2::uuid",
            list(GOD_MODE_ROLES), role_id,
        ) or 0
        if remaining == 0:
            raise HTTPException(
                409,
                "This is the last platform owner. Revoking it would leave nobody "
                "able to grant platform roles, and no endpoint could undo it. "
                "Grant god mode to someone else first.",
            )

    await pool.execute("DELETE FROM staging.user_roles WHERE id=$1::uuid", role_id)
    return {"status": "revoked"}


# ── Module Management ──────────────────────────────────────

# The list used to be retyped here, and held EIGHT codes where role_tiers holds
# twelve. `org_members.py` had the identical bug and was fixed the same way in
# 40124fb. The consequence here was concrete: `POST /{org_id}/modules/{code}`
# and its DELETE both validate against this name, so switching Sanvaad, Varta,
# eSign or Pahchan on for a customer returned `400 Unknown module` from the
# platform console — four modules unreachable through the only UI that reaches
# them.
#
# This line used to read `frozenset(ROLE_TIER_MODULES) | {"sanvaad"}`, adding the
# entitlement spelling on top because role_tiers said `samvada` while these
# endpoints write `staging.module_subscriptions`, which has only ever held
# `sanvaad`. role_tiers now says `sanvaad` too, so the union was adding a code
# that was already in the set. Straight import, one spelling.
ALL_MODULES = frozenset(ROLE_TIER_MODULES)


@router.post("/{org_id}/modules/{module_code}")
async def enable_module(
    org_id: str,
    module_code: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    if module_code not in ALL_MODULES:
        # sorted() because ALL_MODULES is a frozenset now — an unsorted join
        # gives the same request a differently-ordered error message on every
        # process, which is miserable to search for in a log.
        raise HTTPException(400, f"Unknown module: {module_code}. Valid: {', '.join(sorted(ALL_MODULES))}")
    pool = await get_pool()
    org = await pool.fetchval("SELECT id FROM staging.organisations WHERE id=$1::uuid", org_id)
    if not org:
        raise HTTPException(404, "Organisation not found")
    await pool.execute(
        "INSERT INTO staging.module_subscriptions (org_id, module_code, is_active) "
        "VALUES ($1::uuid, $2, TRUE) "
        "ON CONFLICT (org_id, module_code) DO UPDATE SET is_active=TRUE, activated_at=NOW()",
        org_id, module_code,
    )
    await _log_event(pool, org_id, "module_enabled", {
        "module": module_code, "by": user["user_id"],
    })
    return {"status": "enabled", "module": module_code}


@router.delete("/{org_id}/modules/{module_code}")
async def disable_module(
    org_id: str,
    module_code: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    if module_code not in ALL_MODULES:
        raise HTTPException(400, f"Unknown module: {module_code}")
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.module_subscriptions SET is_active=FALSE "
        "WHERE org_id=$1::uuid AND module_code=$2",
        org_id, module_code,
    )
    await _log_event(pool, org_id, "module_disabled", {
        "module": module_code, "by": user["user_id"],
    })
    return {"status": "disabled", "module": module_code}


# ── Per-user Module Grants ─────────────────────────────────


class ModuleGrantBody(BaseModel):
    user_id: str
    modules: list[str]


@router.put("/{org_id}/members/{target_user_id}/modules")
async def set_member_modules(
    org_id: str,
    target_user_id: str,
    body: ModuleGrantBody,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Replace a member's module grants with the given list."""
    pool = await get_pool()
    for mc in body.modules:
        if mc not in ALL_MODULES:
            raise HTTPException(400, f"Unknown module: {mc}")

    await pool.execute(
        "DELETE FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    for mc in body.modules:
        await pool.execute(
            "INSERT INTO staging.org_member_modules (user_id, org_id, module_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4)",
            target_user_id, org_id, mc, user["user_id"],
        )

    await _log_event(pool, org_id, "member_modules_updated", {
        "target": target_user_id,
        "modules": body.modules,
        "by": user["user_id"],
    })

    return {"status": "updated", "user_id": target_user_id, "modules": body.modules}


@router.get("/{org_id}/members/{target_user_id}/modules")
async def get_member_modules(
    org_id: str,
    target_user_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Get a member's module grants."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT module_code, granted_at FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    return {"user_id": target_user_id, "modules": [dict(r) for r in rows]}


# ── R2 Credentials ──────────────────────────────────────────

@router.post("/r2/verify")
async def verify_r2(
    body: R2Credentials,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Test R2 credentials before assigning to an org."""
    result = await verify_r2_credentials(
        body.account_id, body.access_key_id, body.secret_access_key,
    )
    return result


@router.put("/{org_id}/r2")
async def set_org_r2(
    org_id: str,
    body: R2Credentials,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Set or update R2 credentials for an org."""
    pool = await get_pool()

    result = await verify_r2_credentials(
        body.account_id, body.access_key_id, body.secret_access_key,
    )
    if not result["valid"]:
        raise HTTPException(400, f"R2 credentials invalid: {result['error']}")

    await pool.execute(
        "UPDATE staging.organisations SET "
        "r2_account_id=$1, r2_access_key_id=$2, r2_secret_access_key=$3, "
        "r2_bucket_name=$4 WHERE id=$5::uuid",
        # Encrypted at rest. This is a Cloudflare R2 secret — in the clear it
        # turns a database dump or a leaked read-only connection string into
        # write access on every org's file storage. `services/storage.py`
        # decrypts on read; `encrypt` is idempotent so a re-save is safe.
        body.account_id, body.access_key_id, encrypt(body.secret_access_key),
        body.bucket_name, org_id,
    )

    clear_org_r2_cache(org_id)

    bucket = await create_org_bucket(org_id)

    await _log_event(pool, org_id, "r2_configured", {
        "bucket": bucket,
        "set_by": user["user_id"],
    })

    return {"status": "configured", "bucket": bucket, "valid": True}


# ── Storage Analytics ───────────────────────────────────────

@router.get("/{org_id}/storage")
async def get_storage_usage(
    org_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """Get org storage usage and R2 cost estimate."""
    pool = await get_pool()
    org = await pool.fetchrow(
        "SELECT storage_used_bytes, storage_limit_bytes, r2_prefix "
        "FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    used_gb = org["storage_used_bytes"] / (1024**3)
    r2_cost_per_gb = 0.015
    margin = 1.20
    monthly_cost = max(0, used_gb * r2_cost_per_gb * margin)

    return {
        "storage_used_bytes": org["storage_used_bytes"],
        "storage_limit_bytes": org["storage_limit_bytes"],
        "used_gb": round(used_gb, 3),
        "limit_gb": round(org["storage_limit_bytes"] / (1024**3), 1),
        "r2_cost_usd": round(used_gb * r2_cost_per_gb, 4),
        "billed_usd": round(monthly_cost, 4),
        "margin_pct": 20,
    }


# ── Cost Aggregation (per-org) ─────────────────────────────

@router.get("/{org_id}/cost-breakdown")
async def org_cost_breakdown(
    org_id: str,
    period: str = "30d",
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """Per-org cost breakdown: AI by provider+model, scraper by type, daily trend."""
    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org_row = await pool.fetchrow(
        "SELECT id, markup_pct, monthly_credits, monthly_price FROM staging.organisations WHERE id=$1::uuid", org_id
    )
    if not org_row:
        raise HTTPException(404, "Organisation not found")
    org_markup = float(org_row["markup_pct"])

    ai_costs = await pool.fetch(
        "SELECT l.provider, l.model, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, "
        "COUNT(*) as call_count, "
        "COALESCE(SUM(l.prompt_tokens), 0) as prompt_tokens, "
        "COALESCE(SUM(l.completion_tokens), 0) as completion_tokens "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "GROUP BY l.provider, l.model "
        "ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    scraper_costs = await pool.fetch(
        "SELECT r.scraper_id, "
        "COALESCE(SUM(r.cost_usd), 0) as cost_usd, "
        "COALESCE(SUM(r.billed_inr), 0) as billed_inr, "
        "COUNT(*) as run_count "
        "FROM staging.hub_scraper_runs r "
        "WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "GROUP BY r.scraper_id "
        "ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    total_ai = sum(float(r["cost_usd"]) for r in ai_costs)
    total_scraper = sum(float(r["cost_usd"]) for r in scraper_costs)

    # Per-client breakdown within this org
    per_client_costs = await pool.fetch(
        "SELECT c.id as client_id, c.name as client_name, "
        "COALESCE(SUM(l.cost_usd), 0) as ai_cost_usd, "
        "COUNT(l.id) as ai_calls "
        "FROM staging.hub_clients c "
        "LEFT JOIN staging.hub_ai_logs l ON l.client_id = c.id AND l.created_at >= $2 "
        "WHERE c.org_id = $1::uuid "
        "GROUP BY c.id, c.name ORDER BY ai_cost_usd DESC",
        org_id, cutoff,
    )

    # ── Credit usage: Aekam's own number, and why it was wrong ──────────────
    #
    # Two figures here were measuring something other than what they were named.
    #
    # `credit_balance` was the SINGLE HIGHEST CLIENT WALLET in the org, read
    # from the deprecated per-client wallet table. No debit path in the product
    # reads that table, so it was a number nobody could spend, shown beside the
    # org's real spend.
    #
    # `credits_used` summed `hub_content_items.credits_used`, which is Srijan
    # CONTENT only. Every scraper credit, every true-up and every one of the
    # five channels that now charge were invisible in Aekam's own burn rate,
    # while the client-facing report at subscription.py:509 read the ledger and
    # produced a different answer for the same org and window. Two reports, one
    # question, two numbers.
    #
    # Both now come from the ledger through `credits.usage_summary`, which is
    # also NET of refunds under both historic reversal names ('refund' and
    # scrapers' 'credit'), so a refunded image no longer inflates what the
    # customer is told they spent.
    async with pool.acquire() as conn:
        balance = await balance_of(conn, org_id)
        usage = await usage_summary(conn, org_id, since=cutoff)

    daily_trend = await pool.fetch(
        "WITH days AS ("
        "  SELECT d::date as day FROM generate_series($2::date, CURRENT_DATE, '1 day') d"
        "), ai_daily AS ("
        "  SELECT l.created_at::date as day, SUM(l.cost_usd) as cost "
        "  FROM staging.hub_ai_logs l "
        "  JOIN staging.hub_clients c ON c.id = l.client_id "
        "  WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "  GROUP BY 1"
        "), sc_daily AS ("
        "  SELECT r.created_at::date as day, SUM(r.cost_usd) as cost "
        "  FROM staging.hub_scraper_runs r "
        "  WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "  GROUP BY 1"
        ") "
        "SELECT d.day, COALESCE(a.cost, 0) as ai_cost, COALESCE(s.cost, 0) as scraper_cost "
        "FROM days d "
        "LEFT JOIN ai_daily a ON a.day = d.day "
        "LEFT JOIN sc_daily s ON s.day = d.day "
        "ORDER BY d.day",
        org_id, start,
    )

    total_cost = total_ai + total_scraper
    rate = await get_usd_inr()

    return {
        "period": period,
        "org_id": org_id,
        "markup_pct": org_markup,
        "monthly_credits": org_row["monthly_credits"] or 0,
        "monthly_price": float(org_row["monthly_price"]) if org_row["monthly_price"] else 0,
        "usd_to_inr": rate,
        "ai_costs": [
            {"provider": r["provider"], "model": r["model"],
             "cost_usd": float(r["cost_usd"]),
             "cost": _with_inr(float(r["cost_usd"]), rate, org_markup),
             "call_count": r["call_count"],
             "prompt_tokens": r["prompt_tokens"],
             "completion_tokens": r["completion_tokens"]}
            for r in ai_costs
        ],
        "scraper_costs": [
            {"scraper_id": r["scraper_id"], "cost_usd": float(r["cost_usd"]),
             "cost": _with_inr(float(r["cost_usd"]), rate, org_markup),
             "billed_inr": float(r["billed_inr"]), "run_count": r["run_count"]}
            for r in scraper_costs
        ],
        "per_client": [
            {"client_id": str(r["client_id"]), "client_name": r["client_name"],
             "ai_cost_usd": float(r["ai_cost_usd"]),
             "ai_cost": _with_inr(float(r["ai_cost_usd"]), rate, org_markup),
             "ai_calls": r["ai_calls"]}
            for r in per_client_costs
        ],
        "total_ai_cost_usd": total_ai,
        "total_scraper_cost_usd": total_scraper,
        "total_cost_usd": total_cost,
        "total": _with_inr(total_cost, rate, org_markup),
        "ai": _with_inr(total_ai, rate, org_markup),
        "scraper": _with_inr(total_scraper, rate, org_markup),
        # Both keys are kept and both now hold the SAME org balance. They were
        # two different tables before — the second was the org wallet, the first
        # a per-client wallet nothing can spend — and any console reading either
        # one was reading a real number for one of them and a fiction for the
        # other.
        "credit_balance": balance.total,
        "org_credits_balance": balance.total,
        "credit_allowance": balance.allowance,
        "credit_purchased": balance.purchased,
        "credit_period_start": balance.period_start.isoformat(),
        "is_platform_org": balance.is_platform_org,
        # NET of refunds, and complete — scrapers, true-ups and the metered
        # channels included. This is the number the client's own cost report
        # must agree with.
        "credits_used_period": usage["net_debits"],
        "credits_usage": usage,
        "daily_trend": [
            {"date": r["day"].isoformat(),
             "ai_cost": float(r["ai_cost"]),
             "scraper_cost": float(r["scraper_cost"])}
            for r in daily_trend
        ],
    }


@router.get("/{org_id}/cost-report-pdf")
async def admin_org_cost_report_pdf(
    org_id: str,
    period: str = "30d",
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """Admin generates client cost report PDF for any org."""
    from fastapi.responses import Response
    from services.cost_report_pdf import generate_cost_report_pdf

    pool = await get_pool()
    start = _period_start(period)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.markup_pct, o.authorized_signatory_name, o.authorized_signatory_designation, "
        "p.name as plan_name "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    ai_rows = await pool.fetch(
        "SELECT l.provider, l.model, "
        "COALESCE(SUM(l.cost_usd), 0) as cost_usd, COUNT(*) as calls "
        "FROM staging.hub_ai_logs l "
        "JOIN staging.hub_clients c ON c.id = l.client_id "
        "WHERE c.org_id = $1::uuid AND l.created_at >= $2 "
        "GROUP BY l.provider, l.model ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    scraper_rows = await pool.fetch(
        "SELECT r.scraper_id, COALESCE(SUM(r.cost_usd), 0) as cost_usd, "
        "COUNT(*) as runs "
        "FROM staging.hub_scraper_runs r "
        "WHERE r.org_id = $1::uuid AND r.created_at >= $2 "
        "GROUP BY r.scraper_id ORDER BY cost_usd DESC",
        org_id, cutoff,
    )

    # The same Srijan-only sum as `org_cost_breakdown` had, duplicated verbatim,
    # and wrong the same way — a PDF the customer keeps, understating their own
    # scraper spend. One source, and it is net of refunds.
    async with pool.acquire() as conn:
        credits_used = (await usage_summary(conn, org_id, since=cutoff))["net_debits"]

    rate = await get_usd_inr()

    pdf_markup = float(org["markup_pct"])

    def _charge(usd):
        return math.ceil(float(usd) * rate * (1 + pdf_markup))

    report_data = {
        "org_name": org["name"],
        "plan_name": org["plan_name"] or "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "ai_services": [
            {"service": f"{r['provider']} / {r['model']}", "calls": r["calls"],
             "charge_inr": _charge(r["cost_usd"])}
            for r in ai_rows
        ],
        "scraper_services": [
            {"service": r["scraper_id"], "runs": r["runs"],
             "charge_inr": _charge(r["cost_usd"])}
            for r in scraper_rows
        ],
        "credits_used": credits_used,
        "total_ai_inr": _charge(sum(float(r["cost_usd"]) for r in ai_rows)),
        "total_scraper_inr": _charge(sum(float(r["cost_usd"]) for r in scraper_rows)),
        "total_charge_inr": _charge(
            sum(float(r["cost_usd"]) for r in ai_rows)
            + sum(float(r["cost_usd"]) for r in scraper_rows)
        ),
        "signatory_name": org["authorized_signatory_name"] or "",
        "signatory_designation": org["authorized_signatory_designation"] or "",
    }

    pdf_bytes = generate_cost_report_pdf(report_data)
    filename = f"CostReport-{org['name']}-{start.strftime('%b%Y')}-{date.today().strftime('%d%b%Y')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Credit Management ──────────────────────────────────────

@router.post("/{org_id}/credits/topup")
async def admin_topup_credits(
    org_id: str,
    body: dict,
    user=Depends(require_platform_role(*SRIJAN_COMMERCIAL_ROLES)),
):
    """Aekam tops up org credits. Preset or custom amount.

    SRIJAN_COMMERCIAL_ROLES, not CONSOLE_ROLES. role_tiers.py:162-164 defines
    that set for exactly this endpoint and says why in as many words: "Authoring
    a skill and topping up a client's credit balance are both 'Srijan', but only
    one of them spends. The operating set exists to let staff do the work, not to
    let them bill for it."

    The set was written and then not used at the one call site it was written
    for, so `platform_staff` could credit any org any amount.

    Writes the PURCHASED bucket. That is the whole point of the two buckets:
    credits Aekam sold and invoiced carry over indefinitely, and the month roll
    resets only the allowance. The old `SET balance = $1` reset annihilated a
    top-up the client had already been billed for and wrote a ledger row calling
    it a 'reset'.

    This and `POST /v1/hub/org/credits/topup` are now literally the same code
    path. They used to write the same effect with different ledger shapes — this
    one omitted `user_id`, hub's wrote it — so who topped up an org depended on
    which screen they used.

    **`add_to_invoice`.** Off unless the operator ticks it. Ticked, the credits
    and the billing line for them are written in ONE transaction, so "credits
    added but never billed" is not a state this endpoint can leave behind, and
    neither is "billed for credits nobody received".

    That is why `credits.grant_standalone` is NOT used here even though it
    exists for exactly these two top-up routers: it opens and closes its own
    transaction, and the whole point of the tick is that the grant and the line
    commit together. The handler has to own the transaction. Nothing else in
    this file wants a standalone grant either — `create_org` is already inside
    one for the wallet row.
    """
    pool = await get_pool()
    amount = body.get("amount")
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a positive integer")
    if amount <= 0:
        raise HTTPException(400, "amount must be a positive integer")
    notes = body.get("notes", "")

    # Optional, and supplied by the console when it has a reference for the sale.
    # Without one a double-submit is two top-ups — which is the pre-existing
    # behaviour, not a regression, and the only alternative would be to invent a
    # key from a timestamp, which is decoration rather than idempotency.
    idem = body.get("idempotency_key") or None
    add_to_invoice = bool(body.get("add_to_invoice"))

    # A billing line, unlike a ledger row, has no idempotency key of its own —
    # it is made retry-safe by `uq_obl_source_ref`, and the only identifier this
    # handler holds that survives a retry is the one the dialog generated when
    # it opened. Without it, a double-click grants once (the ledger refuses the
    # second) and bills twice, which is the exact failure this endpoint is
    # supposed to make impossible. So it is REQUIRED when the tick is on, and
    # refused rather than invented.
    #
    # It is also the uuid that goes into `source_ref` below. `grant()` returns a
    # Balance, not a Receipt, so this router never sees the ledger row's id —
    # and on a REPLAYED grant there is no new row to have an id at all, while
    # the key is the same one both times. Identifying the top-up by the key is
    # therefore the only choice that is stable across a retry, which is the
    # whole property `uq_obl_source_ref` is being asked to enforce.
    if add_to_invoice and not idem:
        raise HTTPException(
            400,
            "Adding a top-up to the invoice needs an idempotency_key — one "
            "value generated when the dialog opened and re-sent on every retry. "
            "Without it a retried request would create a second billing line "
            "for credits that were only granted once.",
        )

    # The line is in RUPEES; the top-up is in CREDITS. CREDIT_PRICE_INR is what
    # one credit is sold for and it lives in services/credits.py — the console
    # does not get to hold its own opinion of the price.
    line_amount = amount * CREDIT_PRICE_INR
    invoice_description = str(
        body.get("invoice_description") or f"Credit top-up — {amount} credits"
    ).strip()
    if add_to_invoice and not invoice_description:
        raise HTTPException(
            400,
            "An invoice line needs a description. It is what the client reads on "
            "the invoice beside the amount.",
        )

    # REFUSES rather than degrades, and only when the tick is on — see
    # `_billing_schema_required`. Granting credits the operator asked to have
    # billed, and then not billing them, is the one state this endpoint's whole
    # transaction exists to make unreachable; the wrapper sits outside the
    # `async with` so the grant is rolled back before the refusal is composed.
    # An UNTICKED top-up touches no billing table and is unaffected by 096.
    with _billing_schema_required("Adding this top-up to the invoice"):
        async with pool.acquire() as conn:
            async with conn.transaction():
                balance = await grant(
                    conn,
                    org_id=org_id,
                    credits=amount,
                    bucket="purchased",
                    granted_by=user["user_id"],
                    description=notes or f"Admin top-up: {amount} credits",
                    idempotency_key=idem,
                )
                invoice_line = None
                if add_to_invoice:
                    invoice_line = await _billing_lines().create_line(
                        conn,
                        org_id=org_id,
                        kind="topup",
                        description=invoice_description,
                        amount=line_amount,
                        # A top-up is a fact about a payment, not a subscription:
                        # due in the month it happened and never again.
                        cadence="one_off",
                        period_start=current_period(),
                        # `credit_tx:` is the namespace migration 096 documents
                        # and the console reads to render "from top-up on
                        # {date}". The uuid after it is the top-up's IDEMPOTENCY
                        # KEY, not the ledger row id — see above for why that is
                        # the only stable one. The transaction is still reachable
                        # from it: the key is unique on the ledger, which is what
                        # made it idempotent.
                        source_ref=f"credit_tx:{idem}",
                        created_by=user["user_id"],
                    )
    return {
        "balance": balance.total,
        "added": amount,
        "allowance": balance.allowance,
        "purchased": balance.purchased,
        # Stated rather than assumed: the dialog tells the operator whether a
        # line was created, and a silent "no" beside a ticked box is how an
        # unbilled top-up goes unnoticed for a month.
        "invoiced": add_to_invoice,
        "invoice_line": invoice_line,
        "invoice_amount_inr": line_amount if add_to_invoice else None,
    }


@router.get("/{org_id}/credits/usage")
async def admin_credit_usage(
    org_id: str,
    start_date: str = None,
    end_date: str = None,
    user=Depends(require_platform_role(*CONSOLE_ROLES_WITH_FINANCE)),
):
    """Credit usage report for an org. Date range filter."""
    pool = await get_pool()
    if not start_date:
        s = date.today().replace(day=1)
    else:
        s = date.fromisoformat(start_date)
    if not end_date:
        e = date.today()
    else:
        e = date.fromisoformat(end_date)

    cutoff_start = datetime.combine(s, datetime.min.time(), tzinfo=timezone.utc)
    cutoff_end = datetime.combine(e + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.monthly_credits, o.monthly_price, p.name as plan_name, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions sub ON sub.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = sub.plan_id "
        "WHERE o.id=$1::uuid", org_id,
    )
    # `usage_by_type` used to be built by string-surgery on the description —
    # `.replace(" generation", "")` — so a free-text column was deciding what a
    # customer was told they spent, and any channel whose description was
    # phrased differently landed in its own bucket. `usage_summary` reads the
    # machine-readable `kind` column and falls back to parsing description only
    # for rows written before migration 095, which have no kind.
    #
    # `total_debits` is NET of refunds, and that is a deliberate change of
    # meaning. It was gross: it summed `tx_type == 'debit'` and counted neither
    # historic reversal name, so every refunded image and every failed scraper
    # run inflated the figure. The gross number is still returned beside it, so
    # nothing that needs it has to go back to the ledger for it.
    async with pool.acquire() as conn:
        balance = await balance_of(conn, org_id)
        usage = await usage_summary(conn, org_id, since=cutoff_start, until=cutoff_end)
        transactions = await ledger(conn, org_id, since=cutoff_start, until=cutoff_end)

    return {
        "org_id": org_id,
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "monthly_credits": (org["monthly_credits"] or org["default_credits"] or 0) if org else 0,
        "monthly_price": float(org["monthly_price"]) if org and org["monthly_price"] else 0,
        "current_balance": balance.total,
        "allowance_balance": balance.allowance,
        "purchased_balance": balance.purchased,
        # `last_reset` was the wallet's `credits_reset_at`, which migration 095
        # deprecates in favour of `period_start` — the month the current
        # allowance belongs to. Same question, a column that is maintained.
        "last_reset": balance.period_start.isoformat(),
        "period_start": s.isoformat(),
        "period_end": e.isoformat(),
        "total_debits": usage["net_debits"],
        "gross_debits": usage["gross_debits"],
        "refunds": usage["refunds"],
        "total_topups": usage["topups"],
        "total_resets": usage["granted"],
        "total_expired": usage["expired"],
        # Recorded, not charged: a platform org's spend moves no balance and
        # must be excluded from any reconciliation against the wallet.
        "metered_only_debits": usage["metered_only_debits"],
        "usage_by_type": usage["by_kind"],
        "transactions": transactions,
    }


# ── Helpers ─────────────────────────────────────────────────

async def _log_event(db, org_id: str, event_type: str, metadata: dict):
    """One `subscription_events` row.

    `db` is a pool OR an acquired connection — both answer `execute`. `create_org`
    passes the CONNECTION so the event commits with the rows it describes; every
    other caller passes the pool, because their write has already committed and
    an audit row that fails must not undo it.
    """
    await db.execute(
        "INSERT INTO staging.subscription_events (org_id, event_type, metadata) "
        "VALUES ($1::uuid, $2, $3::jsonb)",
        org_id, event_type, json.dumps(metadata),
    )
