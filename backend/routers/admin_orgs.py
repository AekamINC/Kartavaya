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

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.roles import require_platform_role
from services.audit import emit as _audit_emit
# The one seat counter, and the one refusal. This module had its OWN copy that
# counted only joined members: an org at 4 joined + 1 invited would admit a
# fifth from the console here, and the invitee's own click then made six in a
# five-seat org. See `org_invites.count_seats`.
from routers.org_invites import SEAT_ROLES, assert_seat_available, count_seats
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
    BILLING_CONSOLE_ROLES, FINANCE_CONSOLE_ROLES, SAHAYAK_COMMERCIAL_ROLES,
    SUPERUSER_ONLY_ROLES,
    ALL_ORG_ROLES, HR_ADMIN_MODULES, HR_ADMIN_ROLES, ORG_ROLE_PRECEDENCE,
    PLATFORM_ROLE_PRECEDENCE, PROJECT_ONLY_ROLES, PROJECT_ONLY_SURFACES,
    modules_for, role_consumes_seat,
    ALL_MODULES as ROLE_TIER_MODULES,
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

    ANY whitespace, not only a space. `strip()` takes the ends and leaves the
    middle, so an address pasted out of a wrapped email or a spreadsheet cell
    carries an embedded newline or tab straight through a `" " in vpa` test and
    lands on an invoice looking almost right and collecting nothing.

    The 255 is NPCI's own ceiling, and it is checked FIRST so the refusal does
    not quote a pasted paragraph back into the response body. The column is
    plain TEXT: nothing downstream would have refused it.
    """
    if raw is None:
        return None
    vpa = str(raw).strip()
    if not vpa:
        return None
    if len(vpa) > 255:
        raise HTTPException(
            400,
            f"That UPI address is {len(vpa)} characters long. NPCI's limit is "
            "255, so this is a paste rather than an address.",
        )
    handle, _, bank = vpa.partition("@")
    if not handle or not bank or "@" in bank or any(c.isspace() for c in vpa):
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

# ── The one org role a platform account may hand out ────────────────────────
#
# The owner's sentence permits "INVITE AN ORG ADMIN if needed" and nothing
# beside it. That single phrase decides three things at once, and the endpoint
# below was wrong on all three:
#
#   · WHO. It was `CONSOLE_ROLES`, which includes `platform_staff` — four live
#     holders whose remit `role_tiers.py:20-22` defines as the operating set:
#     CRM, sales, marketing, Sahayak, analytics, messaging, core PM. Handing
#     somebody administrative control of a customer's organisation is not in it.
#   · WHAT ROLE. `org_member` was accepted, and was the DEFAULT. Adding staff to
#     a customer's organisation is the customer's own business — `POST
#     /api/v1/org/members` is where their admin does it — and it is not on the
#     owner's list.
#   · WHAT ELSE. `module_grants` was written straight through to
#     `staging.org_member_modules`, so the same request could hand out `vetana`
#     and `manav` — payroll and personnel files. `SENSITIVE_MODULES` is withheld
#     from the AUTO-grant path a few lines further down for exactly that reason,
#     and the explicit list walked around the rule the auto path obeys.
#
# Nothing is lost by refusing the grants. An org_admin already reaches every
# ACTIVE module with no grant row at all — `role_tiers.ORG_OWNER_ONLY` documents
# the short-circuit in `subscription.py` that makes it so — which is precisely
# why the auto-grant branch below already computed an EMPTY list for an admin.
# The explicit list was the only way to write those rows, and it wrote them for
# a person this console has no business describing.
INVITABLE_ORG_ROLE: str = "org_admin"


def _assert_invite_is_only_an_org_admin(
    *, roles: list[str], module_grants: list[str], mobile_number: str,
) -> None:
    """Refuse, in a sentence, anything beyond "make this person an org admin".

    PURE, and tested as a pure function. The pool is a MagicMock in this suite,
    so an HTTP test that posts `module_grants: ["vetana"]` and asserts a 400
    proves the route is wired to something; it cannot prove WHICH rule refused,
    and a mocked cursor will happily answer the insert if the rule is removed.
    The rule lives here so a test can hold it directly.

    Refusing rather than dropping is the house rule and it is not decoration:
    `_assert_may_set_commercial_terms` argues it out for the create path — an
    operator who is told 200 believes the thing they typed happened.
    """
    unexpected = sorted({r for r in roles if r != INVITABLE_ORG_ROLE})
    if unexpected or not roles:
        raise HTTPException(
            400,
            f"This console may only make somebody an {INVITABLE_ORG_ROLE} of an "
            f"organisation it is not part of"
            + (f", not {', '.join(unexpected)}" if unexpected else "")
            + ". Everyone else is added by that organisation's own admin at "
            "POST /api/v1/org/members.",
        )

    if module_grants:
        raise HTTPException(
            400,
            "Module grants cannot be set from the platform console: "
            f"{', '.join(sorted(set(module_grants)))}. An {INVITABLE_ORG_ROLE} "
            "already reaches every module the organisation has active, and "
            "granting a named person anything narrower is a decision for that "
            "organisation's own admin.",
        )

    if mobile_number and mobile_number.strip():
        raise HTTPException(
            400,
            "A mobile number cannot be set from the platform console. It is a "
            "field on somebody else's staff record, and this endpoint may only "
            f"make them an {INVITABLE_ORG_ROLE}.",
        )


class OrgMemberAdd(BaseModel):
    """The body of "invite an org admin".

    The three fields below `email` are kept on the model rather than deleted,
    and they are REFUSED rather than ignored. Pydantic drops keys a model does
    not declare without complaining, so removing them would make an old client's
    `module_grants: ["vetana"]` a silent no-op — the operator sees 200, believes
    payroll was granted, and finds out otherwise from the customer. See
    `_assert_invite_is_only_an_org_admin`, and `org_profile.py`'s header for the
    same argument made about four profile fields.
    """
    email: EmailStr
    # The only legal value, and the default, so a body that says nothing means
    # the one thing this endpoint is for.
    roles: list[str] = [INVITABLE_ORG_ROLE]
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

            # -- The org's Niyam system account -------------------------------
            # One per organisation (migration 148 backfilled the existing ones;
            # this is the go-forward writer). It exists so the engine's
            # task.add_comment verb has a real author row -- the comment read
            # path INNER JOINs public.users, so a comment from a non-existent
            # author is invisible to everyone. It gets NO user_roles row and NO
            # team_members row, which is what keeps it out of every member
            # list, every mention picker, and `count_seats`; login refuses
            # is_system rows through the decoy branch.
            await conn.execute(
                "INSERT INTO public.users (user_id, email, name, full_name, "
                "                          password_hash, salt, role, is_system) "
                "VALUES ('niyam_' || replace($1::text, '-', ''), "
                "        'niyam+' || replace($1::text, '-', '') "
                "            || '@system.kartavaya.invalid', "
                "        'Niyam', 'Niyam', '!system-account-cannot-log-in', "
                "        '!none', 'member', TRUE) "
                "ON CONFLICT (user_id) DO NOTHING",
                org_id,
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
            # self-heal in the product sat behind `require_module("sahayak")` — so
            # an org without Sahayak could never acquire a wallet through any path.
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
        # WHERE AN INVOICE TELLS THE CLIENT TO SEND THE MONEY. PATCH /settings
        # below writes these two and NOTHING read them back, so the only
        # collection mechanism the product has was write-only: an operator could
        # not see whether a payee had ever been set, and "no UPI details on the
        # invoice" and "a UPI address nobody has checked" looked identical from
        # every screen. Both admin SELECTs return them for the same reason they
        # both return max_users — a term that can be set and not read is a guess.
        "o.upi_vpa, o.upi_payee_name, "
        "p.code as plan_code, p.name as plan_name, "
        # NO owner_email, 2026-08-07. This list is Aekam's view of every customer
        # organisation, and it returned the owner's address for all of them to
        # every platform role — the owner's rule is that Aekam must not see
        # client personal data. The NAME identifies the person for support;
        # reaching them goes through the approved support-session flow, which
        # leaves an audit row. `POST /orgs` still TAKES an owner_email, because
        # that is an address Aekam was given in order to create the account.
        "COALESCE(NULLIF(TRIM(u.full_name),''), NULLIF(TRIM(u.name),''), "
        "         'Name not on file') as owner_name "
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


# ── What may cross an org boundary ──────────────────────────────────────────
#
# The owner stated this rule directly; it is not inferred from a threat model:
#
#     "no one should be able to see any other org data even god mode users —
#      such as org members list or what their cap is. God mode can only see the
#      NUMBER OF USERS count under an org, can INVITE AN ORG ADMIN if needed,
#      and can CHANGE THE ORG EMAIL ADDRESS — so that if someone leaves that org
#      there is a new point of contact."
#
# So the ENTIRE cross-org surface of this console is three things: a COUNT, an
# org-admin invitation, and the point-of-contact address. Everything else is a
# violation, and the owner names the cost of getting it wrong: "it is a privacy
# and reputation concern and can bite us and lose the customer straight away,
# and new customers as well."
#
# This handler used to answer, on a platform ROLE TIER alone and for ANY org:
# every member's user_id, email, full name, org roles and grant date; every
# per-member module grant; the seat cap; the plan; the monthly credit allowance;
# the markup; the monthly price; and the UPI payee. Ten of the ten live platform
# accounts could read all of it for Unicode Group, a real customer, and eight of
# those ten are members of Aekam Inc only.
#
# ── Why an ALLOW-LIST and not a list of columns to strip ────────────────────
#
# The two fail in opposite directions, and only one of them fails safely. A
# deny-list is correct on the day it is written and leaks every column added to
# `staging.organisations` afterwards — this table has grown from 20 columns to
# 41, and `upi_vpa`/`upi_payee_name` arrived in migration 096 and reached this
# response by being added to a SELECT nobody re-read. An allow-list refuses a
# new column until somebody names it here on purpose.
#
# `email` is on the list because it IS the third permitted capability: PATCH
# /{org_id}/contact-email below writes it, and changing an address blind — with
# no way to see what is being replaced — is not a capability, it is a guess.
ORG_PUBLIC_FIELDS: tuple[str, ...] = (
    "id", "name", "email", "is_active", "created_at", "updated_at",
)


def _public_org_view(row) -> dict:
    """The org row, reduced to what may leave the organisation.

    PURE, and separated from the handler deliberately. The pool is a MagicMock
    in this suite and a mocked cursor answers any query with whatever the test
    hands it, so an HTTP test asserting "the response has no `members` key"
    proves only that the mock returned none. This function is where the rule
    lives, so a test can hand it a row carrying EVERY column the old SELECT
    returned and assert that none of them come out — and that test goes red the
    moment somebody widens `ORG_PUBLIC_FIELDS`.

    `.get`, not `[...]`, so a deploy whose database has not got a column yet
    answers `null` for it rather than raising KeyError out of a GET.
    """
    src = dict(row)
    return {key: src.get(key) for key in ORG_PUBLIC_FIELDS}


@router.get("/{org_id}")
async def get_org(
    org_id: str,
    user=Depends(require_platform_role(*CONSOLE_ROLES)),
):
    """One organisation: its identity, its point of contact, and HOW MANY people
    are in it.

    Not who they are. See `ORG_PUBLIC_FIELDS` above for the rule and for what
    this used to return.

    ── The count is a COUNT ───────────────────────────────────────────────────

    `member_count` is computed by the database and the rows never leave it. An
    endpoint that returned the array and let the screen render `members.length`
    would be the same leak with a different caller doing the arithmetic — the
    number has to be the ONLY thing that crosses the wire.

    It comes from `org_invites.count_seats`, which is the counter the seat
    refusal itself uses, so the number an operator is shown and the number that
    decides whether the next invitation is admitted are the same population:
    DISTINCT user ids holding one of `SEAT_ROLES` in this org. Measured on the
    live database 2026-08-05 — Aekam Inc 9, Unicode Group 5, the E2E org 6.

    `SeatCount` also carries `limit` and `pending`, and BOTH are dropped here on
    purpose. `limit` is the seat cap, which the owner names in as many words as
    a thing no one may see for another org. `pending` would let the count be
    read as "6 of 13", which reconstructs part of the cap from a number that is
    supposed to carry none.

    That costs two indexed reads this endpoint has no use for, and a bespoke
    `SELECT COUNT(DISTINCT user_id)` here would save them. It is not worth it:
    this module has already shipped its OWN copy of a seat counter once, it
    counted a different population from the one the refusal enforced, and the
    result was an org admitted past its own cap. One counter, and the price of
    it is two reads.
    """
    pool = await get_pool()
    org = await pool.fetchrow(
        # Narrow at the SELECT as well as at the serializer. `_public_org_view`
        # is the rule, but a column that is never read cannot be logged, cannot
        # appear in a traceback and cannot be returned by a future edit that
        # forgets the serializer — the two belong together.
        "SELECT o.id, o.name, o.email, o.is_active, o.created_at, o.updated_at "
        "FROM staging.organisations o WHERE o.id=$1::uuid",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    seats = await count_seats(pool, org_id)

    # ── The one judgement call in this narrowing, said out loud ─────────────
    #
    # Which modules an organisation has ACTIVE is the only thing kept here that
    # a strict reading of "or any module data" could be argued to forbid. It is
    # kept because it is not the customer's data at all — it is Aekam's own
    # provisioning record of what Aekam sold, `POST`/`DELETE
    # /{org_id}/modules/{code}` on this same router are the only place in the
    # product that can switch one on, and a toggle whose current state cannot be
    # read is not a control. Nothing about a PERSON is in it.
    #
    # `staging.org_member_modules` is a different matter and is gone: it maps a
    # named individual at the customer to the modules they hold, which is the
    # member list with extra detail attached.
    modules = await pool.fetch(
        "SELECT module_code, is_active, activated_at "
        "FROM staging.module_subscriptions WHERE org_id=$1::uuid",
        org_id,
    )

    return {
        "org": _public_org_view(org),
        "member_count": seats.joined,
        "modules": [dict(m) for m in modules],
    }


class OrgContactEmail(BaseModel):
    email: EmailStr


@router.patch("/{org_id}/contact-email")
async def set_org_contact_email(
    org_id: str,
    body: OrgContactEmail,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Change an organisation's point-of-contact address. GOD MODE ONLY.

    ── Why this exists ────────────────────────────────────────────────────────

    It is the third of the three things the owner said a platform account may do
    across an org boundary, and it was the only one with NO ENDPOINT ANYWHERE.
    Verified before writing it: `staging.organisations.email` is written by
    exactly one handler in the tree, `org_profile.update_profile`, and that one
    is `require_org_role(*ORG_SETTINGS_ROLES)` behind `get_org_id` — the
    organisation's OWN admin, editing their OWN row. Which is precisely the
    person the owner is describing as gone:

        "…CHANGE THE ORG EMAIL ADDRESS — so that if someone leaves that org
         there is a new point of contact."

    An org whose only admin has left could not be given a new contact address
    through the product at all; it took a hand-written UPDATE against the shared
    Supabase project. This is not a leak being closed — it is a capability the
    owner asked for and did not have.

    ── The audit trail, and why it is inside the transaction ──────────────────

    Who changed it, from what, to what, and when. `subscription_events` carries
    the first three in `metadata` and the fourth in its own `created_at`.

    The read of the old value, the write of the new one and the audit row are
    ONE transaction, and the read takes `FOR UPDATE`. Without the lock, two
    operators changing the address at the same moment both read address A and
    both write an audit row claiming they changed A — one of which never
    happened, and the trail then cannot explain how the row reached its current
    value. An audit trail that can be wrong about what it replaced is worse than
    none, because it is believed.

    ── No-op, refusal and clearing ────────────────────────────────────────────

    Re-sending the address that is already there writes NO event and answers
    `changed: false`. A trail padded with rows that changed nothing is a trail
    nobody reads.

    There is no way to CLEAR the address from here, and that is deliberate
    rather than an omission: this capability exists so that an organisation
    always HAS a point of contact. `EmailStr` refuses anything that is not an
    address, so "" and null are refused by the model with a 422 before this
    body runs.
    """
    pool = await get_pool()

    # Stripped, because an address pasted out of a mail client arrives with
    # whitespace and `EmailStr` has already accepted it. Compared case-blind,
    # because `Info@Acme.in` and `info@acme.in` are the same mailbox and a
    # "change" between them is an audit row about nothing.
    new_email = str(body.email).strip()

    async with pool.acquire() as conn:
        async with conn.transaction():
            before = await conn.fetchrow(
                # `is_active` is NOT in the WHERE clause. A suspended
                # organisation is exactly the one whose contact address is most
                # likely to need changing — that is who you write to about the
                # suspension.
                "SELECT name, email FROM staging.organisations "
                "WHERE id=$1::uuid FOR UPDATE",
                org_id,
            )
            if not before:
                raise HTTPException(404, "Organisation not found")

            previous = before["email"] or ""
            if previous.strip().lower() == new_email.lower():
                return {
                    "org_id": org_id,
                    "email": previous,
                    "previous_email": previous,
                    "changed": False,
                }

            await conn.execute(
                "UPDATE staging.organisations SET email=$1, updated_at=NOW() "
                "WHERE id=$2::uuid",
                new_email, org_id,
            )

            # Inside the transaction, with the row it describes — the same rule
            # `create_org` follows and for the same reason. An event naming a
            # change that rolled back is a line in the trail that is simply
            # false.
            await _log_event(conn, org_id, "org_contact_email_changed", {
                "from": previous,
                "to": new_email,
                "changed_by": user["user_id"],
                # The actor's own address as well as their id. An id is what the
                # database joins on; an address is what a person reading the
                # trail six months later can recognise without a second query.
                "changed_by_email": user.get("email"),
            })

    return {
        "org_id": org_id,
        "email": new_email,
        "previous_email": previous,
        "changed": True,
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
    seats, the platform-org flag, and the UPI payee an invoice collects through.

    BILLING_CONSOLE_ROLES, not CONSOLE_ROLES. Every field this writes is a
    commercial term, and CONSOLE_ROLES includes `platform_staff`, whose remit
    role_tiers.py:36-38 defines as the operating set: CRM, sales, marketing,
    Sahayak, analytics, messaging, core PM. Not what a customer is charged.

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
    #
    # Held in a dict as well as in `params` so the response can report what
    # LANDED rather than what was typed — see the return.
    payee: dict = {}

    if "upi_vpa" in body:
        payee["upi_vpa"] = _clean_vpa(body["upi_vpa"])
        updates.append(f"upi_vpa=${idx}")
        params.append(payee["upi_vpa"])
        idx += 1

    if "upi_payee_name" in body:
        name = None if body["upi_payee_name"] is None else str(body["upi_payee_name"]).strip()
        payee["upi_payee_name"] = name or None
        updates.append(f"upi_payee_name=${idx}")
        params.append(payee["upi_payee_name"])
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
        # ECHOED FROM WHAT WAS WRITTEN, not from the read-back above, and the
        # asymmetry is the point rather than an oversight. The five figures above
        # HAVE to be re-read: on the three NOT NULL columns a null means "leave
        # it alone", so what the caller sent is not what the row now holds and
        # only the row can say. The payee has no such ambiguity — `in body` means
        # it was written — and the value here is the CLEANED one, which is what
        # tells an operator whose paste carried a trailing space that it was
        # accepted and normalised rather than stored as typed.
        #
        # Absent keys therefore mean "this request did not touch the payee", not
        # "there isn't one". `GET /admin/orgs/{org_id}` returns the stored pair
        # either way and is where a screen reads it.
        **payee,
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
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Make somebody an ORG ADMIN of an organisation. GOD MODE ONLY.

    The second of the three things the owner said a platform account may do
    across an org boundary, and the capability is deliberately KEPT — the spec
    names it. What changed is who may use it and what it can hand out; see
    `INVITABLE_ORG_ROLE` above for the three-way narrowing and for what each
    part of it was doing before.

    `SUPERUSER_ONLY_ROLES` rather than `CONSOLE_ROLES`. That tuple's own comment
    already describes this action without naming it — "irreversible or
    trust-establishing platform actions… a role that can grant roles can grant
    itself anything" — and an org_admin of a customer's organisation reaches
    every module that organisation has active, which for most of them includes
    payroll and the books.

    The seat check stays. An organisation at its allowance must refuse the
    invitation with the 409 all five writers share, whoever is asking: the cap
    is the customer's contract, not a permission.

    The `team_members` row stays too. It is not a second membership model — it
    is the row the rest of the product joins through, and an org_admin without
    one is an invitation that lands somewhere unusable.
    """
    pool = await get_pool()

    # BEFORE the org lookup, before the user lookup, before anything is written.
    # A caller who asked for something this endpoint may not do is told that,
    # rather than told the organisation is missing.
    _assert_invite_is_only_an_org_admin(
        roles=body.roles,
        module_grants=body.module_grants,
        mobile_number=body.mobile_number,
    )

    org = await pool.fetchrow(
        "SELECT id, team_id FROM staging.organisations WHERE id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    if not org:
        raise HTTPException(404, "Organisation not found")

    target = await pool.fetchrow(
        "SELECT user_id, COALESCE(is_system, FALSE) AS is_system "
        "FROM users WHERE LOWER(email)=LOWER($1)",
        body.email,
    )
    if not target:
        raise HTTPException(404, f"No user found with email '{body.email}'")
    if target.get("is_system"):
        # The Niyam automation account (migration 148): a user_roles row would
        # surface it in every member list and charge the org a seat. Even god
        # mode does not get to make a robot an org admin.
        raise HTTPException(
            400, "That address belongs to a system account and cannot be "
                 "added to an organisation.")

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

    await pool.execute(
        "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
        "VALUES ($1, $2::uuid, $3, $4) "
        "ON CONFLICT (user_id, org_id, role_code) DO NOTHING",
        target["user_id"], org_id, INVITABLE_ORG_ROLE, user["user_id"],
    )

    # No `staging.org_member_modules` write, on either path.
    #
    # The auto-grant branch that used to be here computed an EMPTY list for an
    # org_admin already — it only ever granted modules to an `org_member`, and
    # this endpoint no longer creates one. `role_tiers.SENSITIVE_MODULES`, which
    # that branch consulted, is no longer imported by this file: the org's own
    # member console (`routers/org_members.py`) is where the auto-grant rule now
    # lives, alongside the role it applies to.

    await _log_event(pool, org_id, "org_admin_invited", {
        "email": body.email,
        "roles": [INVITABLE_ORG_ROLE],
        "added_by": user["user_id"],
        "added_by_email": user.get("email"),
    })

    return {
        "status": "added",
        "email": body.email,
        "roles": [INVITABLE_ORG_ROLE],
        # Kept as an empty list rather than dropped: a console reading
        # `res.modules.length` on an older deploy must not find `undefined`.
        "modules": [],
    }


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
    request: Request,
    email: str = Query(...),
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Resolve an address Aekam WAS GIVEN into the id a role grant needs.

    ── WHY THIS IS NOT THE DIRECTORY LEAK WEARING A THIRD NAME ────────────────

    `OrgCreate.owner_email` is the precedent and the argument is the same one:
    an address somebody handed Aekam in order to have an account set up is an
    INPUT, not a directory read. `AdminPage.jsx` types it into a box and posts
    the resulting id to `/roles/assign`; without this hop there is no way to
    grant a platform role at all, because ids are not things people know.

    ── WHAT IT STILL IS, AND WHAT WAS DONE ABOUT IT ───────────────────────────

    It is an ORACLE. Point it at any address and a 200 confirms that address has
    an account here and a 404 confirms it does not — which is a fact about a
    person that Aekam was not given. That cannot be removed without removing the
    grant flow, so it is narrowed and recorded instead:

      · THE PROJECTION IS THE ID ALONE. `name AS full_name` used to come back
        too, so confirming an address also disclosed whose it was; nothing reads
        it (`AdminPage.jsx` takes `user_id` and nothing else). `email` is echoed
        from the CALLER'S OWN INPUT rather than selected, so the response shape
        is unchanged and no column of `users` reaches it.
      · EVERY LOOKUP WRITES `platform.user_lookup`, hit or miss, at `warn`. The
        miss matters as much as the hit — a run of 404s is somebody enumerating,
        and it is the only shape of this abuse that leaves a pattern.

    `NOT is_system` stays: a system account answers like a nonexistent one, so
    no console flow can start from having "found" the Niyam robot.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        # NOT is_system: a system account answers like a nonexistent one, so
        # no console flow can start from having "found" it.
        #
        # `user_id` AND NOTHING ELSE. This route resolves an id; it does not
        # describe a person. A column added back here is a disclosure that has
        # to be argued for on its own.
        "SELECT user_id FROM users "
        "WHERE LOWER(email)=LOWER($1) AND NOT COALESCE(is_system, FALSE)",
        email,
    )
    _audit_emit(
        "platform.user_lookup",
        request,
        user_id=user["user_id"],
        resource_type="user",
        resource_id=row["user_id"] if row else None,
        # THE ADDRESS IS NOT IN THE DETAIL. An audit row is meant to record that
        # a lookup happened, not to build a second copy of the address book
        # inside `staging.audit_log` — which anybody who can read the audit log
        # could then mine. The domain is enough to spot enumeration.
        detail={"found": bool(row),
                "domain": email.split("@")[-1].lower() if "@" in email else None},
        severity="warn",
    )
    if not row:
        raise HTTPException(404, "User not found")
    # `email` is the caller's own input handed back, so the response keeps the
    # shape `AdminPage.jsx` reads. It is not a column of `users`.
    return {"user_id": row["user_id"], "email": email}


#: The org-scoped roles this console may hand out across an organisation it is
#: not part of.
#:
#: It was `{INVITABLE_ORG_ROLE}` — org_admin alone — and the sentence that
#: narrowed it to one is still the rule for MEMBERSHIP: an organisation's own
#: members are added by that organisation. The three codes added here are not
#: memberships in that sense, and each is here for a reason of its own:
#:
#:   hr_admin     the ORG's HR administrator. Assignable here because the whole
#:                point of the role is that it is NARROWER than org_admin — the
#:                console can already make somebody an org_admin, who reaches
#:                every active module including the books and payroll. Refusing
#:                the narrow role while permitting the wide one would leave "make
#:                them an org_admin" as the only way to set up HR.
#:   org_client   the customer's own client.
#:   aekam_team   Aekam's people on a customer's project.
#:                Both consume no seat and reach no module, so granting one
#:                across an org this console is not part of hands over a project
#:                view and nothing else. `aekam_team` in particular is Aekam
#:                staffing a customer engagement, which is a platform-console
#:                decision by definition.
#:
#: `org_owner` and `org_member` are still refused. Owner is the authority that
#: appoints payroll approvers (`role_tiers.ORG_OWNER_ONLY`); member is ordinary
#: membership and belongs to the organisation's own admin.
CONSOLE_ASSIGNABLE_ORG_ROLES: tuple[str, ...] = (
    (INVITABLE_ORG_ROLE,) + HR_ADMIN_ROLES + PROJECT_ONLY_ROLES
)


def _org_role_reach(code: str) -> list[str]:
    """The modules an ORG role reaches by role alone, for the catalogue."""
    if code in HR_ADMIN_ROLES:
        return sorted(HR_ADMIN_MODULES)
    if code in PROJECT_ONLY_ROLES:
        return []
    # org_owner / org_admin reach every ACTIVE module; org_member reaches what it
    # is granted. Neither is a fixed list, and inventing one for the screen would
    # be a fourth answer to a question `require_module` already owns.
    return sorted(ROLE_TIER_MODULES)


@router.get("/roles/catalogue")
async def role_catalogue(
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Every grantable role, with THE SEAT CONSEQUENCE, from the server.

    The console needs to show what a grant costs at the moment of granting, and
    it had no way to know: `pages/admin/platformRoles.js` is a TRANSCRIPTION of
    `role_tiers.py` maintained by hand, and a transcription of a billing fact is
    a bill that disagrees with a screen the first time somebody edits one of
    them. So the seat consequence is served rather than copied.

    It is a VOCABULARY and not an authorisation: `role_consumes_seat` and
    `refuse_module_for_org_roles` are what decide anything. Guarded on
    SUPERUSER_ONLY_ROLES anyway, to match the three siblings — a list of every
    role and everything it reaches is a map of the product's authority model.
    """
    def entry(code: str, tier: str) -> dict:
        return {
            "code": code,
            "tier": tier,
            "consumes_seat": role_consumes_seat(code),
            "assignable": (
                code in CONSOLE_ASSIGNABLE_ORG_ROLES if tier == "org"
                else code in ALL_PLATFORM_ROLES
            ),
            "org_scoped": tier == "org",
            "modules": (
                _org_role_reach(code) if tier == "org"
                else sorted(modules_for(code))
            ),
            "project_only": code in PROJECT_ONLY_ROLES,
            "surfaces": (
                sorted(PROJECT_ONLY_SURFACES) if code in PROJECT_ONLY_ROLES else []
            ),
        }

    return {
        # Precedence order, not alphabetical: the screen that lists roles should
        # list them strongest first, and that ordering already exists.
        "platform": [entry(c, "platform") for c in PLATFORM_ROLE_PRECEDENCE],
        "org": [entry(c, "org") for c in ORG_ROLE_PRECEDENCE],
        "assignable_org_roles": list(CONSOLE_ASSIGNABLE_ORG_ROLES),
    }


#: HOW A PERSON IS NAMED ON A PLATFORM CONSOLE, and the only form of it here.
#:
#: `NULLIF(TRIM(...))` and not a bare COALESCE: a bare one treats `''` as a value
#: present, so a profile whose name field was submitted blank comes back blank.
#: This is `server.py:list_users`'s expression, copied character for character
#: rather than re-derived — two spellings of one display rule is how they come to
#: disagree, and this one is load-bearing for the names-not-ids ratchet
#: (`frontend/scripts/check-rendered-ids.mjs`): every console row must have a
#: name to render, or the screen falls back to a user id and fails that check.
#:
#: IT DOES NOT FALL THROUGH TO `email`. That fallback is the platform-directory
#: leak wearing a different column name — every person with an incomplete profile
#: listed BY ADDRESS in a field called `full_name`, where no reviewer would look
#: for one. `server.py` fixed it there on 2026-08-07; these two listings kept it.
_CONSOLE_NAME_SQL = (
    "COALESCE(NULLIF(TRIM({t}.full_name), ''), NULLIF(TRIM({t}.name), ''), "
    "'Name not on file')"
)


def _console_name(table_alias: str) -> str:
    """The name expression for one aliased `users` join. Server-side only.

    `table_alias` is never a caller's string: the two call sites below pass the
    literals 'u' and 'g'. It is a function so the expression itself exists once.
    """
    if table_alias not in ("u", "g"):          # an allowlist, not a format call
        raise ValueError(f"unknown users alias {table_alias!r}")
    return _CONSOLE_NAME_SQL.format(t=table_alias)


@router.get("/roles/platform")
async def list_platform_roles(
    request: Request,
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """Who holds a PLATFORM role — Aekam's own staff, named and not addressed.

    ── WHY AN ADDRESS CAME OFF A LIST OF AEKAM'S OWN PEOPLE ───────────────────

    The owner's rule is about customers, and every row here is `org_id IS NULL`,
    which is Aekam. So this one needs its own argument rather than the customer
    one, and it is this: NOTHING ON THIS SCREEN NEEDS AN ADDRESS. It answers
    "who can reach across every tenant", the reader recognises colleagues by
    name, and the revoke button keys on `r.id`. An address that no control uses
    is an address sitting in a JSON response, an access log and a browser cache
    for no purpose — and `staging.user_roles` has no `is_platform_org` notion to
    keep this list honest if a customer's account is ever granted a platform
    role by mistake, which is exactly when the leak would stop being internal.

    Its sibling `/roles/org` is the customer half and is squarely the rule.
    Holding the two to the same shape means neither can be quietly widened by
    somebody copying the other.

    `full_name` KEEPS ITS KEY. `AdminPage.jsx` renders `u.full_name || u.email`;
    with the expression above, `full_name` is never null, so the fallback never
    fires and the screen reads the same. The `<i>{u.email}</i>` line beneath it
    goes blank, which is a frontend tidy-up owed and not a broken screen.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT r.id, r.user_id, r.role_code, r.granted_at, "
        f"       {_console_name('u')} AS full_name "
        f"FROM staging.user_roles r "
        f"JOIN users u ON u.user_id = r.user_id "
        f"WHERE r.org_id IS NULL "
        f"ORDER BY r.granted_at DESC"
    )
    _audit_emit(
        "platform.role_directory_read",
        request,
        user_id=user["user_id"],
        detail={"scope": "platform", "rows": len(rows)},
        severity="warn",
    )
    return [dict(r) for r in rows]


@router.get("/roles/org")
async def list_org_roles(
    request: Request,
    org_id: Optional[str] = Query(None),
    role_code: Optional[str] = Query(None),
    user=Depends(require_platform_role(*SUPERUSER_ONLY_ROLES)),
):
    """WHO HOLDS WHAT, AND IN WHICH ORG — the half the console could not answer.

    `/roles/platform` filters `org_id IS NULL`, so the console showed Tier-1
    grants and nothing else. "Who is the HR administrator of Unicode Group" and
    "which of our people hold a free project-only seat in a customer's org" had
    no screen and no endpoint; the only way to answer either was a query against
    the shared production database.

    Carries `consumes_seat` per row rather than leaving the reader to work it
    out from the code. That is the column an operator is actually scanning for
    when they open this — a free role and a billed one look identical otherwise,
    and the whole reason the two project-only codes exist is that they are free.

    `granted_by` is joined to a NAME — it used to be joined to an address. A
    revocation screen that cannot say who granted a role is a screen that makes
    every unexpected row look like a breach; saying it by name answers that
    completely, and `granted_by_email` answered it by handing over a second
    person's contact details on every row.

    ── THE WORST OF THE THREE ROLE READS, AND WHY ─────────────────────────────

    `org_id` is OPTIONAL, so with no query string this returns EVERY org-scoped
    role row on the platform in one response — live on 2026-08-20 that is 27
    distinct people, 20 of them in customer organisations. It carried `u.email`
    for the holder and `g.email` for whoever granted it, which is two addresses
    per row, across every tenant, to a role set that audited nothing.

    That is the same shape `GET /api/users` was fixed for on 2026-08-07, and the
    same two-part fix applies: the projection carries a NAME, and the read
    writes `platform.role_directory_read` at `warn`. Support can still answer
    "who is the HR administrator of Unicode Group" and "which of our people hold
    a free seat in a customer's org", which is what the endpoint was built for;
    what it can no longer do is compile an address book.

    NOTHING ABOUT THE GRANT FLOW CHANGES. `consumes_seat`, `role_code`,
    `org_name` and `user_id` are untouched, and `OrgRoleGrant.jsx` builds its
    person picker from `full_name` — which the expression above guarantees is
    never null, so the picker reads better than it did.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT r.id, r.user_id, r.role_code, r.granted_at, r.org_id::text AS org_id, "
        f"       {_console_name('u')} AS full_name, "
        f"       o.name AS org_name, "
        # A NAME, NOT AN ADDRESS. `LEFT JOIN`, so a grant made by a since-
        # deleted account still shows its ROW rather than dropping it — a
        # revocation screen that hides rows whose granter has left is a screen
        # that hides exactly the grants worth reviewing. Such a row reads
        # 'Name not on file', same as a live account with a blank profile; the
        # two are indistinguishable here and neither is worth a second literal
        # on a column nothing branches on.
        f"       {_console_name('g')} AS granted_by_name "
        f"FROM staging.user_roles r "
        f"JOIN users u ON u.user_id = r.user_id "
        f"LEFT JOIN staging.organisations o ON o.id = r.org_id "
        f"LEFT JOIN users g ON g.user_id = r.granted_by "
        f"WHERE r.org_id IS NOT NULL "
        f"AND ($1::uuid IS NULL OR r.org_id = $1::uuid) "
        f"AND ($2::text IS NULL OR r.role_code = $2::text) "
        # Was `u.email`. Ordering by a column the response no longer carries is
        # an ordering nobody can see, so it sorts by the name it does show.
        f"ORDER BY o.name NULLS LAST, array_position($3::text[], r.role_code), "
        f"         {_console_name('u')}",
        org_id, role_code, list(ORG_ROLE_PRECEDENCE),
    )
    _audit_emit(
        "platform.role_directory_read",
        request,
        user_id=user["user_id"],
        # `org_id` on the row when ONE org was asked for. Unfiltered — the whole
        # platform in one read — is the case worth being able to find later, and
        # a null org_id beside `scope: all_orgs` is what makes it findable.
        org_id=org_id,
        detail={"scope": "one_org" if org_id else "all_orgs",
                "role_code": role_code, "rows": len(rows)},
        severity="warn",
    )
    return [
        {**dict(r), "consumes_seat": role_consumes_seat(r["role_code"])}
        for r in rows
    ]


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

    # ── The second door onto "put somebody in a customer's organisation" ─────
    #
    # `org_member` used to be here beside `org_admin`, and while it was, the
    # narrowing on `POST /{org_id}/members` above was cosmetic for the caller it
    # matters to: this route is already god mode, so the same account refused
    # `org_member` there could write the identical `staging.user_roles` row here
    # by naming an org_id. The owner's sentence permits inviting an org ADMIN
    # and nothing else, and a rule enforced on one of two doors is not a rule —
    # the comment ten lines below records the same shape of miss on the seat
    # count, on this very endpoint.
    #
    # An organisation's own members are added by that organisation, at
    # `POST /api/v1/org/members`.
    #
    # This set is `CONSOLE_ASSIGNABLE_ORG_ROLES` and not a second hand-written
    # literal. It briefly WAS `{INVITABLE_ORG_ROLE}` while the refusal message
    # eight lines below already listed all four names, so the endpoint refused
    # `hr_admin` in a sentence that named `hr_admin` as permitted — the guard and
    # the explanation of the guard cannot be two separate lists, because the one
    # that is wrong is always the one nobody reads.
    org_roles = set(CONSOLE_ASSIGNABLE_ORG_ROLES)

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
        #
        # ── AND THE SEAT CHECK IS NOW CONDITIONAL, WHICH IS NOT A WEAKENING ───
        #
        # `org_client` and `aekam_team` consume NO seat by the owner's decision,
        # so counting one for them would refuse a client their own project the
        # moment the customer's allowance filled up — a customer would be asked
        # to buy a seat for the person they are doing the work FOR. The
        # condition is `role_consumes_seat`, which is the same predicate
        # `org_invites.SEAT_ROLES` is built from, so the door that admits and the
        # counter that bills cannot disagree about which roles are free.
        if role_consumes_seat(body.role_code):
            await assert_seat_available(
                pool, body.org_id, email=target["email"], user_id=body.user_id,
            )
        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT DO NOTHING",
            body.user_id, body.org_id, body.role_code, user["user_id"],
        )
    elif body.role_code in ALL_ORG_ROLES:
        # A role that EXISTS and that this console may not hand out, told apart
        # from a code nobody has ever heard of. "Invalid role: org_member" reads
        # like a typo and sends the operator looking for the right spelling;
        # this names the rule and the door that is open to them.
        raise HTTPException(
            400,
            f"'{body.role_code}' cannot be assigned from the platform console. "
            f"Across an organisation it is not part of, this console may only "
            f"grant: {', '.join(CONSOLE_ASSIGNABLE_ORG_ROLES)}. That "
            "organisation's own admin adds everyone else at "
            "POST /api/v1/org/members.",
        )
    else:
        raise HTTPException(400, f"Invalid role: {body.role_code}")

    return {
        "status": "assigned",
        "role": body.role_code,
        # Echoed so the console can tell the operator what the grant just cost,
        # from the server rather than from its own transcription of the model.
        "consumes_seat": role_consumes_seat(body.role_code),
    }


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
    """Replace a member's module grants with the given list.

    ── THE SEVENTH WRITER ──────────────────────────────────────────────────────

    `_assert_invite_is_only_an_org_admin` (270 lines above, in THIS file) refuses
    `module_grants` from the console in as many words, and
    `test_cross_org_console_surface.py` pins that refusal. This endpoint — same
    file, same `CONSOLE_ROLES` caller set — validated the module code and nothing
    else. `require_platform_role` is NOT org-scoped, so it reached ANY org, which
    means the four `platform_staff` holders whom `subscription.platform_refusal`
    forbids from touching payroll could nonetheless GRANT a customer's ordinary
    employee `vetana` in an org they have no row in.

    Two further consequences of the same handler, both fixed here:

      · It never named `role`, so every re-INSERT landed on the column
        `DEFAULT 'viewer'` — the exact demotion `org_members.py` documents as
        fixed on its own endpoint. Levels are now carried across.
      · It DELETEs every row first, so a save that simply omitted a module
        silently revoked it. Measured against the live database 2026-08-06,
        `staging.org_member_modules` holds five `vetana`/`approver` rows across
        three orgs and they are the only representation of "may release
        payroll"; one call here would have wiped them with a 200.

    Nothing is lost by refusing the sensitive codes: an org_admin already reaches
    every ACTIVE module with no grant row at all, which is why the sibling above
    could refuse them outright. No frontend calls this — it is API-only surface.
    """
    from middleware.role_tiers import default_level_for
    from middleware.subscription import SENSITIVE_MODULES

    pool = await get_pool()
    for mc in body.modules:
        if mc not in ALL_MODULES:
            raise HTTPException(400, f"Unknown module: {mc}")

    refused = sorted({mc for mc in body.modules if mc in SENSITIVE_MODULES})
    if refused:
        raise HTTPException(
            400,
            f"Module grants for {', '.join(refused)} cannot be set from the "
            "platform console. Payroll, the books, personnel files and biometric "
            "attendance are granted by that organisation's own owner at "
            "PUT /api/v1/org/members/{user_id}/modules, where the separated-duty "
            "rule applies. An org_admin already reaches every module the "
            "organisation has active.",
        )

    # Carry the existing level across. A console save that re-lists a module the
    # member already holds must not silently demote them to viewer.
    held = {
        r["module_code"]: r["role"]
        for r in await pool.fetch(
            "SELECT module_code, role FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid",
            target_user_id, org_id,
        )
    }

    # The DELETE is scoped to the codes this console may WRITE. Refusing
    # sensitive modules in the request body is only half the rule: this handler
    # replaces the member's whole grant set, so a console save listing nothing
    # but `graha` would still have dropped their `vetana: approver` row on the
    # way past. A console that may not grant payroll approval may not revoke it
    # either — that is the org owner's decision, made at
    # `PUT /api/v1/org/members/{id}/modules`.
    await pool.execute(
        "DELETE FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid "
        "AND NOT (module_code = ANY($3::text[]))",
        target_user_id, org_id, sorted(SENSITIVE_MODULES),
    )
    for mc in body.modules:
        await pool.execute(
            "INSERT INTO staging.org_member_modules "
            "(user_id, org_id, module_code, role, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4, $5)",
            target_user_id, org_id, mc,
            held.get(mc) or default_level_for(mc), user["user_id"],
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
    # `credits_used` summed `hub_content_items.credits_used`, which is Sahayak
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

    # The same Sahayak-only sum as `org_cost_breakdown` had, duplicated verbatim,
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
    user=Depends(require_platform_role(*SAHAYAK_COMMERCIAL_ROLES)),
):
    """Aekam tops up org credits. Preset or custom amount.

    SAHAYAK_COMMERCIAL_ROLES, not CONSOLE_ROLES. role_tiers.py:162-164 defines
    that set for exactly this endpoint and says why in as many words: "Authoring
    a skill and topping up a client's credit balance are both 'Sahayak', but only
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
