"""
subscription.py — Subscription & Billing Router
Plan management, manual billing by admin, module activation/deactivation.
All queries use raw asyncpg matching the existing codebase pattern.
"""
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role, require_platform_role
from middleware.role_tiers import ALL_MODULES, BILLING_CONSOLE_ROLES, is_god_mode, strongest
from middleware.subscription import clear_module_cache
# Actor names for the PLATFORM-side invoice lists. Never for a tenant-facing
# one: see `_without_platform_actors`. Adds no `$n`, so no parameter number in
# this file moves.
from services.audit_actors import actor_joins, actor_select
# The ATTENDANCE seat counter. Org seats are counted by
# `routers/org_invites.count_seats`, imported at its one call site below to keep
# this module's import graph out of `auth_router`. The two counts are reported
# side by side and never summed — see `services/seat_model.py`.
from services.seat_model import count_pahchan_seats

router = APIRouter(prefix="/api/v1/subscription", tags=["subscription"])


# ── Pydantic Models ──────────────────────────────────────────

class ModuleAction(BaseModel):
    module_code: str

class PlanChange(BaseModel):
    plan_code: str
    billing_cycle: str = "monthly"
    notes: str = ""

class InvoiceCreate(BaseModel):
    period_start: date
    period_end: date
    due_date: date
    line_items: list[dict]
    notes: str = ""
    #: The `staging.org_billing_lines` this invoice BILLS, as opposed to what it
    #: SAYS — `line_items` is the frozen human-readable snapshot and is what the
    #: client reads; these ids are what stops the same line being charged again
    #: next time somebody presses "Load lines" for the same month.
    #:
    #: ABSENT AND EMPTY MEAN THE SAME THING HERE, and both are legal. Kartavaya's
    #: clients agree terms verbally, so an invoice must stay creatable standalone
    #: — `InvoiceBuilder.jsx` omits the key entirely on a hand-typed invoice, and
    #: an invoice that bills no line is an invoice, not an error.
    #:
    #: Typed as UUID rather than str so a mistyped id is a 422 naming the field
    #: instead of a DataError the browser reports as a CORS failure with no body.
    line_ids: list[UUID] = Field(default_factory=list)

class RecordPayment(BaseModel):
    payment_method: str
    payment_reference: str
    paid_at: Optional[datetime] = None


# ── Helpers ──────────────────────────────────────────────────

async def _log_event(pool, org_id: str, event_type: str, metadata: dict):
    """Write one subscription event. `pool` may also be a connection — asyncpg's
    Connection and Pool take the same `execute(sql, *args)`, and the invoice path
    passes its connection so the audit row lands or rolls back WITH the invoice
    rather than beside it."""
    await pool.execute(
        "INSERT INTO staging.subscription_events (org_id, event_type, metadata) "
        "VALUES ($1::uuid, $2, $3::jsonb)",
        org_id, event_type, json.dumps(metadata),
    )


#: The advisory-lock namespace invoice numbering serialises on — 0x4B535542 is
#: 'KSUB'. `pg_advisory_xact_lock(int, int)` keeps its keys in a DIFFERENT space
#: from the single-bigint form `server.py:503` and `utils.py:109` already use, so
#: this cannot collide with whatever those hash to.
_INVOICE_SEQ_LOCK_NS = 0x4B535542


def _actor_uuid(user_id) -> Optional[UUID]:
    """The operator's id — if the column is able to hold it.

    `staging.subscription_invoices.approved_by` and `.collected_by` are UUID
    (010:96-97), while a user id in this product is TEXT: `user_admin001`,
    `user_549c9cac35aa`, because `public.users.user_id` is text. asyncpg encodes
    a uuid parameter by PARSING the string, so binding a real user id raises
    ValueError before the statement is ever sent and the whole request 500s —
    the browser sees that as a CORS error with no body, which is the signature
    migration 092 documents. 030 and 092 each paid for this shape once;
    096 section 1 flags these two columns by name and says the repair is an
    ALTER COLUMN TYPE, which is not something a router may do.

    So the id goes in when it genuinely is a UUID and NULL when it is not, and
    `_log_event` carries the operator either way — `staging.subscription_events`
    is TEXT and has always held the real answer. A NULL column beside an audit
    row that names the person is worse than the column being right, and far
    better than an endpoint that cannot raise an invoice at all.
    """
    try:
        return UUID(str(user_id))
    except (ValueError, TypeError):
        return None


def _dedupe(ids: list[UUID]) -> list[UUID]:
    """The same line named twice in one payload is one line on one invoice.

    Not forgiveness: what a client is CHARGED comes from `line_items`, and this
    list only records which lines the invoice discharges.

    `record_billed` dedupes its own argument for the same reason, so this is not
    load-bearing there. It is load-bearing HERE: the emptiness of this list is
    what decides whether the invoice is 'lines' or 'manual' and what the audit
    row and the response report, and `[x, x]` must not read as two lines billed.
    """
    seen: set[UUID] = set()
    out: list[UUID] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _billing_lines():
    """`services/billing_lines.py`, imported at call time rather than at module
    import — the same lazy import `admin_orgs._billing_lines()` and
    `billing._writer()` use, for the same reason: everything else in this file
    (plans, modules, usage, the cost report) has nothing to do with billing
    lines and must keep serving if that module is absent.

    ONE function is asked for here:

      record_billed(conn, *, invoice_id, org_id, line_ids, period) -> list[dict]
          Writes `staging.invoice_billing_lines` — which lines this invoice
          billed and for which period — and REFUSES, naming the invoice, a line
          already billed for that period. Called inside the transaction that
          inserts the invoice, so a refusal takes the invoice with it.

    This router does not write that table itself. A second writer of a
    no-double-charge invariant is how the invariant stops holding, which is the
    rule `services/credits.py` already holds for the four credit tables.

    The import is INSIDE the function and its failure is handled below. That is
    not decoration: this exact shape, with the module missing, is what turned
    every `POST /v1/admin/orgs` into a 500 that left an orphan org behind.
    """
    from services import billing_lines
    return billing_lines


#: The four columns migration 096 section 3 adds: two on `organisations`, where
#: the payee is CONFIGURED, and two on `subscription_invoices`, where it is
#: SNAPSHOTTED onto each document.
#:
#: PROBED RATHER THAN ASSUMED, for exactly the reason `gen_col` below is built as
#: a fragment: 096 is applied BY HAND in a low-traffic window, and naming a column
#: that has not arrived yet turns every invoice — including the hand-typed ones
#: that have always worked — into a 500 the browser reports as a CORS failure
#: with no body. `org_profile._available_columns` probes the four columns
#: PROPOSED_068 adds for the same reason and in the same shape.
_UPI_COLUMNS: frozenset[tuple[str, str]] = frozenset({
    ("organisations", "upi_vpa"),
    ("organisations", "upi_payee_name"),
    ("subscription_invoices", "upi_vpa"),
    ("subscription_invoices", "upi_payee_name"),
})

#: Probe result. False until a probe has seen ALL FOUR columns; True forever
#: after. Cached one way only, deliberately: no migration in this folder drops a
#: column, so a "yes" is final — but a "no" must be re-asked, because 096 is
#: applied against a process that is already running and a cached "no" would
#: leave every invoice raised after the migration permanently unpayable with no
#: error anywhere to explain it.
_upi_ready: bool = False


async def _upi_columns_ready(pool) -> bool:
    """Whether 096 has landed, asked of the catalog rather than assumed."""
    global _upi_ready
    if _upi_ready:
        return True
    rows = await pool.fetch(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema='staging' AND table_name = ANY($1::text[]) "
        "AND column_name = ANY($2::text[])",
        ["organisations", "subscription_invoices"],
        ["upi_vpa", "upi_payee_name"],
    )
    _upi_ready = {(r["table_name"], r["column_name"]) for r in rows} >= _UPI_COLUMNS
    return _upi_ready


async def _platform_payee(pool) -> dict:
    """WHO THE INVOICE IS PAID TO, AND HOW — the whole collection mechanism.

    THERE IS NO PAYMENT GATEWAY AND THERE WILL NOT BE ONE. The owner settled
    that, 096 section 3 restates it, and it makes a UPI address on the document
    the only thing standing between an invoice and being paid. Until now this
    router wrote none, while `BillingUsageSection.jsx:456` told every client
    "Invoices carry UPI details — there is no payment gateway." The screen was
    describing a column nothing filled in.

    ── WHERE THE PAYEE LIVES ───────────────────────────────────────────────

    The PLATFORM org's row, not the client's: Aekam is the payee on every
    invoice Aekam raises, and 096 puts `upi_vpa`/`upi_payee_name` on
    `staging.organisations` for that reason ("the PLATFORM org's row is the
    payee for every invoice Aekam raises").

    `bank_details->>'upi_id'` is read as a fallback, and it is not a nicety. It
    is the ONLY place a UPI address exists in this product today: `047` created
    the column, `org_profile.py` writes it from Settings → Organisation →
    Company Profile ("Printed on every invoice so a client can pay without
    asking for them"), and `ganit/_shared.jsx` UpiPayBlock already builds a
    `upi://pay` link out of it for the invoices a CLIENT issues. NOTHING IN THE
    BACKEND WRITES `organisations.upi_vpa` — 096 creates the column and no
    router sets it — so without this fallback the snapshot would be NULL on
    every invoice forever and this fix would fix nothing. Read in SQL with
    `->>` rather than in Python, so the jsonb never has to survive the codec.

    The dedicated column WINS when it is set. It is the one 096 named, it is
    what a future settings screen will write, and a payee typed for billing
    should beat one typed for the company profile.

    ── WHAT COMES BACK ─────────────────────────────────────────────────────

    `upi_vpa` is None whenever the invoice cannot be paid by UPI, and
    `why_missing` then says WHICH of the three reasons it is — 096 has not
    landed, no org is flagged `is_platform_org`, or the platform org has no UPI
    address anywhere. Naming what is needed and what is held is the same
    contract every refusal in this batch keeps; this one is not a refusal, for
    the reason argued at the call site.
    """
    if not await _upi_columns_ready(pool):
        return {
            "upi_vpa": None, "upi_payee_name": None,
            "why_missing": (
                "Migration 096_billing_lines.sql has not been applied, so "
                "staging.subscription_invoices has no upi_vpa column to carry a "
                "payee."
            ),
        }

    try:
        row = await pool.fetchrow(
            "SELECT "
            # COALESCE order is the precedence argued above; NULLIF(btrim(…),'')
            # so a field somebody cleared by typing spaces reads as absent
            # rather than as a payee of one blank character.
            "  NULLIF(btrim(COALESCE(o.upi_vpa, o.bank_details->>'upi_id', '')), '') "
            "    AS upi_vpa, "
            "  NULLIF(btrim(COALESCE(o.upi_payee_name, "
            "                        o.bank_details->>'account_name', o.name, '')), '') "
            "    AS upi_payee_name "
            "FROM staging.organisations o "
            "WHERE o.is_platform_org "
            # 095 indexes this flag as "the one row that will ever be true" but
            # enforces no such thing, so the choice is made deterministically
            # rather than left to the planner: a row that actually has an
            # address first, then oldest, then by id. An invoice must not
            # acquire a different payee between two runs of the same request.
            "ORDER BY (NULLIF(btrim(COALESCE(o.upi_vpa, o.bank_details->>'upi_id', '')), '') "
            "          IS NULL), o.created_at NULLS LAST, o.id "
            "LIMIT 1"
        )
    except Exception as e:                       # noqa: BLE001 — re-raised below
        # Matched on sqlstate, the convention `credits._is_unique_violation`
        # sets. A missing column or table here is a deploy-ordering fact, not a
        # reason an operator cannot raise an invoice; anything else is a real
        # failure and goes up.
        if getattr(e, "sqlstate", None) not in ("42703", "42P01"):
            raise
        return {
            "upi_vpa": None, "upi_payee_name": None,
            "why_missing": (
                "The payee could not be read from staging.organisations — the "
                "columns it is kept in do not exist in this database."
            ),
        }

    if row is None:
        return {
            "upi_vpa": None, "upi_payee_name": None,
            "why_missing": (
                "No organisation is flagged is_platform_org, so there is no "
                "payee to raise this invoice as. 095 left that flag FALSE on "
                "every row on purpose; god mode sets it through "
                "PATCH /v1/admin/orgs/{org_id}/settings."
            ),
        }
    if not row["upi_vpa"]:
        return {
            "upi_vpa": None, "upi_payee_name": row["upi_payee_name"],
            "why_missing": (
                "The platform organisation has no UPI address — both "
                "staging.organisations.upi_vpa and bank_details.upi_id are "
                "empty. Set the UPI ID under Settings → Organisation → Company "
                "Profile."
            ),
        }
    return {
        "upi_vpa": row["upi_vpa"],
        "upi_payee_name": row["upi_payee_name"],
        "why_missing": None,
    }


def _with_payee(inv: dict) -> dict:
    """Every invoice answers "how is this paid?" — including with "it cannot be".

    THE SNAPSHOT IS READ BACK AS STORED AND NEVER REFRESHED, NOT EVEN WHEN IT IS
    NULL. 096 section 3 puts these two columns ON THE INVOICE rather than joining
    to the platform org precisely so "changing the payee later does not silently
    rewrite an invoice already sent" — and an invoice raised before 096, or
    raised while nobody had set a payee, WAS sent with no way to pay it. Filling
    that in on read would make this screen agree with
    `BillingUsageSection.jsx:456` while the document in the client's inbox still
    disagreed, which is the same lie one layer further down.

    Both keys are always present and `payable_by_upi` is always a boolean, so
    the response shape does not change on the day 096 is applied — before it,
    `SELECT *` simply would not return the columns at all, and a key that
    appears when a migration runs is a contract that breaks without a deploy.
    """
    # Trimmed on the way out as well as on the way in. `_platform_payee` cannot
    # store a blank, but this router is not the only thing that will ever touch
    # these columns, and a VPA of three spaces would otherwise read as payable
    # all the way to a screen that prints it as a payment address.
    vpa = (inv.get("upi_vpa") or "").strip() or None
    return {
        **inv,
        "upi_vpa": vpa,
        "upi_payee_name": (inv.get("upi_payee_name") or "").strip() or None,
        "payable_by_upi": bool(vpa),
    }


#: The two columns 202 added to `staging.subscription_invoices` that hold an
#: AEKAM operator's `public.users.user_id`.
_PLATFORM_ACTOR_COLUMNS = ("created_by", "updated_by")


def _without_platform_actors(inv: dict) -> dict:
    """Strip the platform's own actor ids off a document going to the CUSTOMER.

    `GET /invoices` is the org's own billing tab and it is served by `SELECT *`,
    so the moment 202 added `created_by` and `updated_by` to this table those
    columns started riding out to every client with an Aekam staff member's user
    id in them. That is two rules at once: a user id is never rendered anywhere,
    and Aekam's internal identities are not part of a customer's invoice.

    Stripped in Python rather than by naming columns in the SELECT, deliberately.
    `SELECT *` here is load-bearing — `_with_payee`'s docstring turns on the
    columns 096 adds appearing without a deploy — and a hand-written column list
    would have to be edited by every future migration or start silently dropping
    fields from the customer's own invoice. A denylist of the two columns that
    must not travel fails in the safe direction: a new column reaches the client,
    a leaked identity does not.

    NOT applied to the platform's own lists. `approved_by`/`collected_by` are
    left exactly as they are — they are UUID columns that hold NULL for every
    real operator (see `_actor_uuid`) and removing them would change a response
    shape three screens read for a leak that does not exist.
    """
    return {k: v for k, v in inv.items() if k not in _PLATFORM_ACTOR_COLUMNS}


async def _already_billed_detail(runner, line_ids: list[UUID], month: date) -> str:
    """The refusal that names the invoice already carrying the line, re-read
    AFTER a rollback.

    `billing_lines.record_billed` checks this before its INSERT and refuses in
    these words. It cannot do so afterwards — a 23505 leaves the caller's
    transaction unusable, so the query that names the invoice cannot be run
    inside it. That case is the caller's, and this is the caller: the
    transaction is already rolled back by the time this runs, so the read is
    legal again and the operator gets the same sentence whether the pre-check or
    the unique index caught it. The wording is deliberately theirs, not a second
    phrasing of the same refusal.

    A row in `staging.invoice_billing_lines` means CURRENTLY billed — voiding or
    refunding an invoice deletes its rows (096 section 2 argues this out) — so
    there is deliberately no filter on `payment_status`. An unpaid invoice still
    carries the charge, and re-billing a line because nobody has paid yet is
    exactly the duplicate the table exists to prevent.
    """
    clash = await runner.fetch(
        "SELECT b.line_id, l.description, i.invoice_number "
        "FROM staging.invoice_billing_lines b "
        "JOIN staging.org_billing_lines l ON l.id = b.line_id "
        "JOIN staging.subscription_invoices i ON i.id = b.invoice_id "
        "WHERE b.line_id = ANY($1::uuid[]) AND b.period_start = $2::date",
        line_ids, month,
    )
    if not clash:
        # The other transaction rolled back too, or the line was billed and
        # un-billed while this ran. Nothing was invoiced either way, and saying
        # so is better than inventing an invoice number.
        return (
            "Another invoice claimed one of these billing lines for "
            f"{month:%Y-%m} while this one was being raised, so nothing was "
            "invoiced. Load the lines again and check what is already billed."
        )
    named = ", ".join(
        f"'{r['description']}' is already on {r['invoice_number']}" for r in clash
    )
    return (
        f"{len(clash)} of these lines were already billed for "
        f"{month:%Y-%m}: {named}. Raising them again would charge the client "
        "twice. Remove them from this invoice, or credit the one they are on."
    )


# ── Public ───────────────────────────────────────────────────

@router.get("/plans")
async def list_plans(user=Depends(require_user)):
    """List available plans. Pricing is only visible to admins."""
    pool = await get_pool()
    plans = await pool.fetch(
        "SELECT * FROM staging.plans WHERE is_active=TRUE ORDER BY price_monthly"
    )
    modules = await pool.fetch(
        "SELECT * FROM staging.add_on_modules WHERE is_active=TRUE ORDER BY price_per_user_monthly"
    )

    from middleware.roles import is_platform_staff
    is_staff = await is_platform_staff(user["user_id"])
    plan_list = []
    for r in plans:
        p = dict(r)
        if not is_staff:
            p.pop("price_monthly", None)
            p.pop("price_annual", None)
        plan_list.append(p)

    mod_list = []
    for r in modules:
        m = dict(r)
        # is_staff, not is_admin — the latter was never defined, so this raised
        # NameError for any org with an active add-on module, which failed the
        # whole billing page (its four requests are awaited together).
        if not is_staff:
            m.pop("price_per_user_monthly", None)
        mod_list.append(m)

    return {"plans": plan_list, "modules": mod_list}


# ── Current Subscription ─────────────────────────────────────

@router.get("/current")
async def get_current(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    pool = await get_pool()
    # Explicit columns, not `s.*`. The wildcard returned whatever the table
    # happened to hold, to any authenticated member of the org — so the first
    # cost or margin column added to `staging.subscriptions` would have started
    # crossing to tenants with no code change and no review. It also already
    # carried `activated_by` and `notes`, which are ours, not theirs.
    #
    # Deliberately excluded:
    #   activated_by  — the platform staff user_id who set the plan.
    #   notes         — free text written by platform staff in `admin_set_plan`.
    #   cancel_reason — internal; never written by any code path today.
    #   plan_id       — internal FK; the plan is already named by plan_code/plan_name.
    sub = await pool.fetchrow(
        "SELECT s.org_id, s.billing_cycle, s.status, s.trial_ends_at, "
        "s.current_period_start, s.current_period_end, s.next_billing_date, "
        "s.cancelled_at, s.created_at, s.updated_at, "
        "p.name as plan_name, p.code as plan_code, "
        "p.max_users, p.features "
        "FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    modules = await pool.fetch(
        "SELECT module_code FROM staging.module_subscriptions "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    user_count = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
        "WHERE org_id=$1::uuid "
        "AND role_code IN ('org_owner','org_admin','org_member')",
        org_id,
    )
    anchor = await pool.fetchval(
        "SELECT billing_anchor_day FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    return {
        "subscription": dict(sub) if sub else None,
        "active_modules": [r["module_code"] for r in modules],
        "user_count": user_count or 0,
        "billing_anchor_day": anchor or 1,
    }


# ── Admin: Plan Management ───────────────────────────────────

@router.post("/admin/set-plan")
async def admin_set_plan(
    body: PlanChange,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    plan = await pool.fetchrow(
        "SELECT id, code FROM staging.plans WHERE code=$1 AND is_active=TRUE",
        body.plan_code,
    )
    if not plan:
        raise HTTPException(400, "Invalid plan code")

    current = await pool.fetchrow(
        "SELECT p.code FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    old_code = current["code"] if current else "none"

    tier = {"none": -1, "free": 0, "starter": 1, "growth": 2, "scale": 3,
            "professional": 1, "business": 2, "enterprise": 3}
    direction = "upgraded" if tier.get(body.plan_code, 0) > tier.get(old_code, 0) else "downgraded"

    from services.billing_cycle import next_anchor, period_end_for

    now = datetime.now(timezone.utc)
    anchor = await pool.fetchval(
        "SELECT billing_anchor_day FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    ) or 1
    period_start = next_anchor(anchor, date.today())
    period_end = period_end_for(period_start, body.billing_cycle)

    await pool.execute(
        "INSERT INTO staging.subscriptions "
        "(org_id, plan_id, billing_cycle, status, activated_by, notes, "
        " current_period_start, current_period_end, next_billing_date, updated_at) "
        "VALUES ($1::uuid, $2, $3, 'active', $4, $5, $6, $7, $7, $8) "
        "ON CONFLICT (org_id) DO UPDATE SET "
        "plan_id=EXCLUDED.plan_id, billing_cycle=EXCLUDED.billing_cycle, "
        "status='active', activated_by=EXCLUDED.activated_by, notes=EXCLUDED.notes, "
        "current_period_start=EXCLUDED.current_period_start, "
        "current_period_end=EXCLUDED.current_period_end, "
        "next_billing_date=EXCLUDED.next_billing_date, updated_at=EXCLUDED.updated_at",
        org_id, plan["id"], body.billing_cycle,
        user["user_id"], body.notes,
        period_start, period_end, now,
    )

    if body.plan_code == "free":
        await pool.execute(
            "UPDATE staging.module_subscriptions SET is_active=FALSE, "
            "deactivated_at=NOW() WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
        clear_module_cache(org_id)

    await _log_event(pool, org_id, direction, {
        "from": old_code, "to": body.plan_code,
        "set_by": user["user_id"], "notes": body.notes,
    })
    return {"status": direction, "plan": body.plan_code}


class BillingAnchor(BaseModel):
    anchor_day: int = Field(..., ge=1, le=28)


@router.patch("/admin/billing-anchor")
async def set_billing_anchor(
    body: BillingAnchor,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.organisations SET billing_anchor_day=$2 "
        "WHERE id=$1::uuid",
        org_id, body.anchor_day,
    )
    return {"billing_anchor_day": body.anchor_day}


class SubscriptionPause(BaseModel):
    action: str = Field(..., pattern="^(pause|resume)$")
    reason: str = ""


@router.post("/admin/pause")
async def admin_pause_subscription(
    body: SubscriptionPause,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    sub = await pool.fetchrow(
        "SELECT status FROM staging.subscriptions WHERE org_id=$1::uuid",
        org_id,
    )
    if not sub:
        raise HTTPException(404, "No subscription for this organisation")

    if body.action == "pause":
        if sub["status"] == "paused":
            raise HTTPException(409, "Already paused")
        if sub["status"] != "active":
            raise HTTPException(400, f"Cannot pause a {sub['status']} subscription")
        new_status = "paused"
    else:
        if sub["status"] != "paused":
            raise HTTPException(400, "Subscription is not paused")
        new_status = "active"

    await pool.execute(
        "UPDATE staging.subscriptions SET status=$2, updated_at=NOW() "
        "WHERE org_id=$1::uuid",
        org_id, new_status,
    )
    clear_module_cache(org_id)

    await _log_event(pool, org_id, body.action, {
        "set_by": user["user_id"], "reason": body.reason,
    })
    return {"status": new_status}


# ── Module Activation ────────────────────────────────────────

@router.post("/modules/activate")
async def activate_module(
    body: ModuleAction,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    from middleware.subscription import BUNDLED_MODULES
    if body.module_code in BUNDLED_MODULES:
        raise HTTPException(400, f"'{body.module_code}' is bundled with every plan — no activation needed")

    sub = await pool.fetchrow(
        "SELECT p.code FROM staging.subscriptions s "
        "JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE s.org_id=$1::uuid",
        org_id,
    )
    if not sub or sub["code"] == "free":
        raise HTTPException(403, "Add-on modules require a paid plan")

    # The module vocabulary is role_tiers', not the seed table's.
    #
    # This used to reject anything absent from `staging.add_on_modules`, which is
    # seeded with EIGHT codes (migrations/010:141 and 011:8): graha, ganit,
    # manav, pahchan, vetana, sanvaad, dristi, sahayak. `vikray`, `prachar` and
    # `varta` have no row and never did — so this endpoint answered "Invalid
    # module code" for three modules that have live `require_module()` gates and
    # working routers behind them, and the only way to switch them on was
    # `POST /v1/admin/orgs/{org_id}/modules/{code}`, which validates against
    # role_tiers and writes the same table.
    #
    # Two activation paths at the same trust level (both BILLING/CONSOLE
    # platform-role guards, both writing `module_subscriptions`) disagreeing on
    # which modules exist is how a customer ends up paying for Vikray and being
    # told it is not a module. Agreeing on role_tiers widens no guard.
    if body.module_code not in ALL_MODULES:
        raise HTTPException(
            400,
            f"Unknown module: {body.module_code}. "
            f"Valid: {', '.join(sorted(ALL_MODULES))}",
        )

    # The dependency graph still comes from the catalogue, because that is where
    # `requires_module` lives. A module with no catalogue row simply has no
    # declared dependency — it must not be an activation failure.
    mod = await pool.fetchrow(
        "SELECT code, requires_module FROM staging.add_on_modules WHERE code=$1 AND is_active=TRUE",
        body.module_code,
    )

    for dep in ((mod["requires_module"] if mod else None) or []):
        dep_active = await pool.fetchval(
            "SELECT 1 FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
            org_id, dep,
        )
        if not dep_active:
            raise HTTPException(400, f"Module '{body.module_code}' requires '{dep}' to be active first")

    await pool.execute(
        "INSERT INTO staging.module_subscriptions (org_id, module_code, is_active, activated_at) "
        "VALUES ($1::uuid, $2, TRUE, NOW()) "
        "ON CONFLICT (org_id, module_code) DO UPDATE SET "
        "is_active=TRUE, activated_at=NOW(), deactivated_at=NULL",
        org_id, body.module_code,
    )
    clear_module_cache(org_id)

    await _log_event(pool, org_id, "module_added", {
        "module": body.module_code, "by": user["user_id"],
    })
    return {"status": "activated", "module": body.module_code}


@router.post("/modules/deactivate")
async def deactivate_module(
    body: ModuleAction,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    pool = await get_pool()

    all_modules = await pool.fetch(
        "SELECT code, requires_module FROM staging.add_on_modules"
    )
    active_codes = {
        r["module_code"] for r in await pool.fetch(
            "SELECT module_code FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
    }

    for m in all_modules:
        if m["code"] in active_codes and body.module_code in (m["requires_module"] or []):
            raise HTTPException(
                400,
                f"Cannot deactivate '{body.module_code}': module '{m['code']}' depends on it. "
                f"Deactivate '{m['code']}' first.",
            )

    await pool.execute(
        "UPDATE staging.module_subscriptions SET is_active=FALSE, deactivated_at=NOW() "
        "WHERE org_id=$1::uuid AND module_code=$2",
        org_id, body.module_code,
    )
    clear_module_cache(org_id)

    await _log_event(pool, org_id, "module_removed", {
        "module": body.module_code, "by": user["user_id"],
    })
    return {"status": "deactivated", "module": body.module_code}


# ── Admin: Invoice Management ────────────────────────────────

@router.post("/admin/invoices")
async def create_invoice(
    body: InvoiceCreate,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
    org_id: str = Depends(get_org_id),
):
    """Raise one invoice, and record which billing lines it discharges.

    ── AN INVOICE IS A QUERY OVER THE LINES DUE IN A PERIOD ────────────────────

    …but only when the operator asks for one. This endpoint stays the ONE invoice
    writer in the product and it stays operator-driven: `line_ids` is optional,
    a hand-typed invoice is permanently legal, nothing is derived from an order,
    and NOTHING GATES PROVISIONING ON AN INVOICE EXISTING. There is no payment
    gateway behind this and there will not be one.

    ── WHICH IS WHY THE INVOICE HAS TO CARRY THE UPI DETAILS ───────────────────

    With no gateway, the UPI address ON THE DOCUMENT is the entire collection
    mechanism. This INSERT wrote none, while `BillingUsageSection.jsx:456` has
    been telling every client "Invoices carry UPI details — there is no payment
    gateway." Every invoice this endpoint has ever raised was a document nobody
    could pay, sent to somebody the screen had told to pay by UPI.

    The payee is SNAPSHOTTED from the platform org, not joined to it, because
    096 section 3 is explicit that changing the payee later must not rewrite an
    invoice already sent. See `_platform_payee` for where it is read from and
    why `bank_details.upi_id` is in that chain.

    A MISSING PAYEE DOES NOT REFUSE THE INVOICE, and that is a decision rather
    than an omission. `is_platform_org` is FALSE on every row today — 095 left
    it so deliberately — and `organisations.upi_vpa` arrives NULL with 096, so
    refusing would mean NO invoice could be raised at all on the day this
    deploys, breaking the hand-typed path that has worked since 010 to fix a
    document nobody could pay anyway. Instead the response says, in the same
    breath as the invoice number, that the client has no way to pay this one and
    exactly what is missing, and the audit row records the same. An invoice with
    an amount and a due date is still an invoice; one raised in silence about
    being unpayable is the defect repeated.

    ── WHAT `line_ids` BUYS: THE NO-DOUBLE-CHARGE RULE ─────────────────────────

    Before this, `InvoiceBuilder.jsx:150` sent `line_ids` and this handler
    ignored them, so `staging.invoice_billing_lines` was never written and
    `uq_ibl_line_period` — the unique index 096 itself calls "THE
    NO-DOUBLE-CHARGE RULE" — guarded an empty table. Pressing "Load lines" for
    August twice raised the platform fee twice, and the second invoice carried
    no evidence it duplicated the first.

    `billing_lines.record_billed` now writes the join rows IN THE SAME
    TRANSACTION as the invoice INSERT — this router does not write that table
    itself, because a second writer of a no-double-charge invariant is how the
    invariant stops holding. So:

      · a line already billed for the month is REFUSED, by name, naming the
        invoice that already carries it — and NO invoice is created. An invoice
        that quietly dropped the duplicate row would be worse: the operator
        would have sent a document short of what they meant to charge and been
        told it worked.
      · the service's pre-check produces the readable message; `uq_ibl_line_period`
        produces the guarantee. Two operators pressing Create in the same second
        is the one case the pre-check cannot see; that collision lands on the
        index, rolls the whole transaction back, and is reported OUT HERE in the
        same words — a 23505 leaves the transaction unusable, so the query that
        names the invoice can only be run after the rollback, which is the
        caller's side of the line.

    A line is billed for A MONTH — `period_start` truncated to the 1st, the same
    grain `hub_org_credits.period_start` and `org_billing_lines.period_start`
    use. Without the truncation the index would let the same line through twice
    for one month on two invoices whose periods merely started on different days,
    which is the whole failure spelled differently.
    """
    pool = await get_pool()

    line_ids = _dedupe(body.line_ids)
    # WHICH month these lines are billed for. Derived from the invoice's own
    # period rather than from today, so an invoice raised on 2 September for the
    # August period books its lines against August. An invoice spanning several
    # months books its lines against the FIRST — the preview is per month and a
    # `monthly` line is due per month, so a multi-month invoice built from lines
    # is not a shape this model expresses; it is not refused because a hand-typed
    # multi-month invoice is perfectly ordinary and must stay so.
    billed_month = body.period_start.replace(day=1)

    # An invoice that discharges lines must SAY what it discharged them for.
    # `line_items` is the frozen snapshot the client reads; `line_ids` is only
    # the machine-readable half. Accepting the second without the first would
    # mark the month's lines billed against a document with nothing on it — the
    # charge silently forgiven, and the preview skipping those lines from then
    # on. A blank invoice with no `line_ids` is left alone: it bills nothing and
    # discharges nothing, which is merely useless rather than wrong.
    if line_ids and not body.line_items:
        raise HTTPException(400, (
            "This invoice bills billing lines but carries no line items, so the "
            "client would be sent a blank document and the lines would be "
            "marked billed anyway. Nothing was invoiced."
        ))

    # ── WHAT THIS DOCUMENT ACTUALLY CHARGED EACH LINE ───────────────────────
    #
    # `invoice_billing_lines.amount` is denormalised AT ISSUE TIME — 096's words
    # — because "the line's amount may change afterwards; what the client was
    # charged may not". `record_billed` can only deliver that if somebody TELLS
    # it what was charged; left to itself it copies `org_billing_lines.amount`,
    # which is right for an untouched row and wrong for every other kind.
    #
    # It is wrong more often than "the operator retyped a figure" suggests.
    # `InvoiceBuilder.jsx` folds `qty` into `amount` before sending, so a support
    # plan loaded once and billed ×2 for a missed month charges ₹18,000 while the
    # join row says ₹9,000 — the row that exists to prove what was charged
    # disagreeing with the document, without anybody typing a rupee figure.
    #
    # THE INVOICE IS AUTHORITATIVE. `line_items` and `total_amount` are what the
    # client reads and pays; the line is a standing term the invoice quotes. So
    # the mapping is built from `line_items`, which is the same list `subtotal`
    # is summed from — one source for what was charged, so the join row and the
    # document cannot come to disagree.
    #
    # SUMMED, not last-one-wins: two entries naming one line are two charges
    # against it on this document, and the amount it was billed is their total.
    #
    # KEYED CANONICALLY AND RESTRICTED TO WHAT THIS INVOICE DISCHARGES, both of
    # which are load-bearing rather than tidiness:
    #
    #   · `line_items` is `list[dict]` — unvalidated JSON — so an entry's
    #     `line_id` is whatever a client put there. `record_billed` resolves each
    #     key through `_uuid()` BEFORE it asks whether that id is being billed,
    #     so a malformed one raises `UnknownLine` and takes down an invoice it
    #     was never going to affect. Its docstring says a key that is not being
    #     billed is ignored rather than refused; that is true here, of the
    #     mapping this endpoint hands it, and it is what makes the superset the
    #     harmless thing both files describe.
    #   · matching on the raw string would drop an id a client spelled in
    #     uppercase — and dropping it is SILENT: the line falls back to its own
    #     amount and the join row goes back to disagreeing with the document,
    #     which is the whole defect. `UUID()` here and `str(UUID)` on the ids
    #     make the two spellings one key rather than leaving the normalisation
    #     to happen by accident one module further down.
    billed_ids = {str(i) for i in line_ids}

    charged_by_line: dict[str, float] = {}
    for item in body.line_items:
        ref = item.get("line_id")
        if not ref:
            continue                    # a hand-typed row discharges nothing
        try:
            key = str(UUID(str(ref)))
        except (ValueError, AttributeError, TypeError):
            continue
        if key not in billed_ids:
            # The operator deleted that row's id from the list, or this client
            # sends more than it bills. Either way the line is not being
            # discharged and nothing on this document is booked against it.
            continue
        try:
            amount = float(item.get("amount", 0) or 0)
        except (TypeError, ValueError):
            # Not a number. Left out entirely rather than coerced to 0, so
            # `record_billed` falls back to the line's own amount instead of
            # recording a charge of nothing against a client who was billed.
            continue
        charged_by_line[key] = charged_by_line.get(key, 0.0) + amount

    subtotal = sum(item.get("amount", 0) for item in body.line_items)
    gst = round(subtotal * 0.18, 2)
    total = round(subtotal + gst, 2)

    month_str = datetime.now(timezone.utc).strftime("%Y%m")

    # `generated_from` is written ONLY on the lines path, and that is a deploy
    # ordering decision rather than a style one. The column arrives with 096, and
    # until 096 is applied naming it would 500 every invoice — including the
    # hand-typed ones that have always worked. Its DEFAULT is 'manual', which is
    # the right answer for those anyway, so the standalone path stays byte-for-
    # byte the statement it was before this change and keeps working either side
    # of the migration. The lines path needs `staging.invoice_billing_lines`, so
    # it already requires 096 and can name the column freely.
    gen_col = ", generated_from" if line_ids else ""
    gen_val = ", 'lines'" if line_ids else ""

    # READ BEFORE THE TRANSACTION OPENS, on the pool rather than on `conn`. Two
    # reasons, and both are about not taking the invoice down with the payee:
    # pre-096 the catalog probe and the read touch columns that do not exist,
    # and an aborted statement inside `conn.transaction()` would roll back an
    # invoice that had nothing wrong with it; and the payee is a platform-wide
    # setting rather than part of this invoice's consistency, so it has no claim
    # on the transaction that inserts it.
    payee = await _platform_payee(pool)
    # Same fragment trick as `gen_col`, for the same deploy-ordering reason: with
    # no payee to write there is nothing to name, and pre-096 the statement stays
    # byte-for-byte what it has always been. Unlike `gen_col` this applies to
    # BOTH paths — a hand-typed invoice is the ordinary case here and it is
    # exactly the one that must be payable.
    upi_col = ", upi_vpa, upi_payee_name" if payee["upi_vpa"] else ""

    recorded: list[dict] = []
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # The number is allocated under an advisory lock held to COMMIT,
                # which is what the `FOR UPDATE` this replaces was reaching for
                # and could not do: Postgres REFUSES a locking clause on an
                # aggregate query outright — "FOR UPDATE is not allowed with
                # aggregate functions" — so that statement raised on every call
                # and this endpoint has never successfully created an invoice.
                # A row lock was the wrong instrument regardless; the rows being
                # counted are not the row being written, and on the first invoice
                # of a month there are none to lock.
                await conn.execute(
                    "SELECT pg_advisory_xact_lock($1::int, $2::int)",
                    _INVOICE_SEQ_LOCK_NS, int(month_str),
                )
                seq = await conn.fetchval(
                    "SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM "
                    "'KSUB-\\d{6}-(\\d+)') AS INT)), 0) + 1 "
                    "FROM staging.subscription_invoices "
                    "WHERE invoice_number LIKE 'KSUB-' || $1 || '-%'",
                    month_str,
                )
                invoice_number = f"KSUB-{month_str}-{seq:04d}"

                # ── `created_by` — THE FIRST COLUMN ON THIS TABLE THAT CAN
                #    ACTUALLY HOLD THE OPERATOR ─────────────────────────────
                #
                # `approved_by` is $10 and is `_actor_uuid(...)`, which is NULL
                # for every real operator: the column is UUID and a user id in
                # this product is TEXT (see `_actor_uuid`). So until 202 this
                # document recorded WHO RAISED IT nowhere at all — `collected_by`
                # answers a different question (who took the money) and is
                # NULL-for-the-same-reason besides, and the only surviving trace
                # was the `subscription_events` row written below.
                #
                # 202's `created_by` is TEXT and holds `public.users.user_id`
                # verbatim, so the real id goes in. It is APPENDED to `params`
                # rather than spliced in, because `upi_val` numbers its
                # placeholders off `len(params)` — inserting above it would move
                # the payee onto the wrong parameter, which is precisely the
                # failure that comment is guarding against.
                params = [
                    org_id, invoice_number, body.period_start, body.period_end,
                    json.dumps(body.line_items), subtotal, gst, total,
                    body.due_date, _actor_uuid(user["user_id"]),
                    user["user_id"],
                ]
                # Placeholders numbered from the list rather than hardcoded, so
                # adding a column above cannot silently shift the payee onto the
                # wrong parameter. The fragments themselves hold no user input —
                # only column names decided by `upi_col` — and the values go
                # through asyncpg as $11/$12 like everything else.
                upi_val = f", ${len(params) + 1}, ${len(params) + 2}" if upi_col else ""
                if upi_col:
                    params += [payee["upi_vpa"], payee["upi_payee_name"]]

                row = await conn.fetchrow(
                    "INSERT INTO staging.subscription_invoices "
                    "(org_id, invoice_number, period_start, period_end, "
                    " line_items, subtotal, gst, total, due_date, payment_status, "
                    # $11 sits between `approved_by` ($10) and the two optional
                    # fragments. `gen_val` is a LITERAL and consumes no number,
                    # so `upi_val`'s $12/$13 are unmoved — the arithmetic that
                    # keeps them right is `len(params)` at the moment it runs,
                    # and `created_by` is already in `params` by then.
                    f" approved_by, created_by{gen_col}{upi_col}) "
                    f"VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'pending', $10, $11{gen_val}{upi_val}) "
                    "RETURNING *",
                    *params,
                )

                if line_ids:
                    # The other half of the no-double-charge rule, written by the
                    # module that owns the table. It REFUSES a line already
                    # billed for this period rather than skipping it — skipping
                    # would leave the line on `line_items` (the client is
                    # charged) and absent from the join table (the system thinks
                    # it is unbilled), which is the double charge with the
                    # evidence removed. The refusal happens inside this
                    # transaction, so the invoice above goes with it.
                    recorded = await _billing_lines().record_billed(
                        conn,
                        invoice_id=str(row["id"]),
                        org_id=str(org_id),
                        line_ids=[str(i) for i in line_ids],
                        period=billed_month,
                        # What THIS document charged, not what the line says
                        # today. See `charged_by_line` above; a line the mapping
                        # says nothing about falls back to the line's own amount,
                        # which is the right answer for an unedited row.
                        amounts=charged_by_line or None,
                    )

                # Inside the transaction, on the same connection: an invoice with
                # no audit row is a charge nobody can attribute, and this is the
                # only place the operator's real user_id survives — `approved_by`
                # cannot hold it. See `_actor_uuid`.
                await _log_event(conn, org_id, "invoice_created", {
                    "invoice_number": invoice_number, "total": float(total),
                    "created_by": user["user_id"],
                    "generated_from": "lines" if line_ids else "manual",
                    "line_ids": [r["line_id"] for r in recorded],
                    "billed_period": f"{billed_month:%Y-%m}" if line_ids else None,
                    # WHICH payee this document went out under, and — when it
                    # went out under none — why. An invoice nobody could pay is
                    # the thing somebody will be reconstructing months later
                    # from an unpaid balance, and the audit row is where that
                    # reconstruction has to start. The VPA is Aekam's own
                    # published payment address, printed on the invoice itself;
                    # there is nothing private about it.
                    "upi_vpa": payee["upi_vpa"],
                    "upi_unavailable": payee["why_missing"],
                })

    except HTTPException as e:
        # `services/billing_lines.py` refuses with the structured detail this
        # batch uses everywhere — `{"error", "message", …}`. THIS endpoint's only
        # caller renders `detail` straight into a toast title
        # (`AdminBillingPage.jsx:194`), and an object there is "Objects are not
        # valid as a React child": the console blanks at the exact moment the
        # operator is being told about a double charge. Flattened to the
        # sentence, status preserved, `raise … from` keeping the original.
        #
        # The right long-term fix is one line in that file — it already imports
        # `refusalMessage`, which reads `detail.message`, and uses it for "Load
        # lines". Until it does, a readable refusal outranks a machine-readable
        # one on an endpoint whose only client is a screen.
        if isinstance(e.detail, dict) and e.detail.get("message"):
            raise HTTPException(e.status_code, e.detail["message"]) from e
        raise
    except asyncpg.exceptions.UniqueViolationError as e:
        # The race `record_billed` documents and deliberately leaves here: two
        # operators pressing Create in the same second both pass its pre-check,
        # and `uq_ibl_line_period` refuses the second. Nothing was invoiced —
        # the transaction is rolled back — and the naming query it could not run
        # inside an aborted transaction runs fine out here.
        if "uq_ibl_line_period" not in f"{e.constraint_name or ''} {e}":
            raise
        raise HTTPException(
            409, await _already_billed_detail(pool, line_ids, billed_month),
        ) from e
    except ImportError as e:
        # `_billing_lines()` imports at call time, and this is the failure mode
        # that shape has: the module is absent and the invoice cannot record what
        # it billed. Refused rather than issued unrecorded — an invoice whose
        # lines were never marked billed is the same double charge next month.
        raise HTTPException(503, (
            "The billing-lines service is not deployed, so this invoice cannot "
            "record which lines it bills. Nothing was invoiced. Raise it with "
            "typed rows and no line ids, or deploy services/billing_lines.py."
        )) from e
    except Exception as e:                       # noqa: BLE001 — re-raised below
        # Say the real answer out loud, exactly as 096's GUARD 0 does, rather
        # than let an operator read "relation does not exist" and go hunting for
        # a typo. Matched on sqlstate rather than on the asyncpg class, which is
        # the convention `credits._is_unique_violation` sets. Only the lines path
        # names anything 096 adds that could still be MISSING, so anything the
        # standalone path is missing is a different problem and must not be
        # reported as this one — `upi_col` is also a 096 column and is named on
        # both paths, but it is only ever emitted after `_upi_columns_ready` has
        # seen it in the catalog, so it cannot be the cause of a 42P01 here.
        if getattr(e, "sqlstate", None) != "42P01" or not line_ids:
            raise
        raise HTTPException(503, (
            "This invoice bills billing lines, and the tables they live in do "
            "not exist yet — migration 096_billing_lines.sql has not been "
            "applied. Nothing was invoiced. Raise the invoice with typed rows, "
            "or apply 096 first."
        )) from e

    # Additive, and both keys are always present so the shape does not depend on
    # what the operator did: a hand-typed invoice reports that it discharged no
    # billing line, which is a fact worth stating rather than an absence. The
    # ids are what was actually WRITTEN, not what was asked for.
    return {
        **_with_payee(dict(row)),
        "billed_line_ids": [r["line_id"] for r in recorded],
        "billed_period": f"{billed_month:%Y-%m}" if line_ids else None,
        # Said at the moment the operator can still do something about it —
        # before the document leaves. None when the invoice is payable, so the
        # console can show it only when there is something to show.
        "payment_note": None if payee["upi_vpa"] else (
            f"{invoice_number} carries no UPI details, so the client has no way "
            f"to pay it — UPI on the invoice is the whole collection mechanism "
            f"and there is no payment gateway. {payee['why_missing']} Fix that "
            f"and the next invoice will carry it; send payment details for this "
            f"one separately rather than raising it again, which would bill the "
            f"same lines twice."
        ),
    }


@router.patch("/admin/invoices/{invoice_id}/record-payment")
async def record_payment(
    invoice_id: UUID,
    body: RecordPayment,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    pool = await get_pool()

    inv = await pool.fetchrow(
        "SELECT * FROM staging.subscription_invoices WHERE id=$1",
        invoice_id,
    )
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if inv["payment_status"] == "paid":
        raise HTTPException(409, "Invoice is already paid")

    paid_at = body.paid_at or datetime.now(timezone.utc)
    # `collected_by` is the same UUID-column-holding-a-text-user-id defect as
    # `approved_by` — see `_actor_uuid`. There is no payment gateway here: this
    # endpoint is the only way an invoice is ever marked collected, so leaving it
    # raising on every call leaves every invoice permanently unpaid. The person
    # who took the payment is named in the event below either way.
    await pool.execute(
        # `collected_by` ($4) is the UUID column that cannot hold a TEXT user id
        # and is therefore NULL for every real operator. `updated_by` ($6) is
        # 202's TEXT column and holds the id itself — so this is the statement
        # where "who marked this invoice paid" stops living only in the event
        # row. Both are written: they are different facts, and the day
        # `collected_by` is ALTERed to TEXT the older one starts working with no
        # change here.
        #
        # `updated_at` is NOT set: 202 also added
        # `trg_touch_subscription_invoices` (BEFORE UPDATE), which owns that
        # column for every writer of this table, including the ones that are not
        # this router.
        "UPDATE staging.subscription_invoices SET "
        "payment_status='paid', payment_method=$1, payment_reference=$2, "
        "paid_at=$3, collected_by=$4, updated_by=$6 WHERE id=$5",
        body.payment_method, body.payment_reference,
        paid_at, _actor_uuid(user["user_id"]), invoice_id,
        user["user_id"],
    )

    await _log_event(pool, str(inv["org_id"]), "payment_recorded", {
        "invoice": inv["invoice_number"],
        "amount": float(inv["total"]),
        "method": body.payment_method,
        "reference": body.payment_reference,
        "collected_by": user["user_id"],
    })
    return {"status": "paid", "invoice_number": inv["invoice_number"]}


@router.get("/admin/invoices/overdue")
async def list_overdue(user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES))):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT i.*, "
        # PLATFORM-SIDE ONLY. This list is `BILLING_CONSOLE_ROLES` and shows
        # Aekam its own operators to Aekam — which is the one direction in which
        # naming an actor is safe. The tenant's copy of the same rows
        # (`GET /invoices` below) gets NO actor at all, by name or by id.
        + actor_select("i", updated=True)
        + "o.name as org_name "
        "FROM staging.subscription_invoices i "
        "JOIN staging.organisations o ON o.id = i.org_id "
        + actor_joins("i", updated=True)
        + "WHERE i.payment_status='pending' AND i.due_date < CURRENT_DATE "
        "ORDER BY i.due_date"
    )
    # `payable_by_upi` on the OVERDUE list specifically, because it is often the
    # answer to the question the list is asking. An invoice raised before 096, or
    # while the platform org had no UPI address, went out with nothing on it to
    # pay to — it is not overdue because the client is slow, and chasing it is
    # the wrong action.
    return {"data": [_with_payee(dict(r)) for r in rows]}


# ── Org Billing History ──────────────────────────────────────

@router.get("/invoices")
async def list_invoices(
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """The org's own invoices. Owner and admin only.

    This was `Depends(require_user)`, so any `org_member` could read the whole
    invoice history with totals. `OrgSettingsPage.jsx:31` already gates the
    entire settings surface — Billing tab included — on
    `ORG_ROLES = ['org_owner','org_admin']`, so the control was hidden in the UI
    and open in the API. RBAC-SPEC Tier 2 puts `org_member` at "base membership,
    only explicitly granted modules", and billing is not a module grant.

    THIS IS THE SCREEN `BillingUsageSection.jsx:456` MAKES ITS PROMISE ON —
    "Invoices carry UPI details — there is no payment gateway" sits on the same
    tab as this list (`TabBilling.jsx:132`). Each row now carries the payee it
    was raised under, so the client can actually pay it, and `payable_by_upi`
    marks the ones raised before there was a payee to carry. Rendering the pair
    is `TabBilling.jsx`'s side of this and is not in this file.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM staging.subscription_invoices "
        "WHERE org_id=$1::uuid ORDER BY created_at DESC",
        org_id,
    )
    return {"data": [_without_platform_actors(_with_payee(dict(r))) for r in rows]}


# ── Usage ────────────────────────────────────────────────────

@router.get("/usage")
async def get_usage(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    pool = await get_pool()
    usage = await pool.fetch(
        "SELECT metric, value FROM staging.usage_tracking "
        "WHERE org_id=$1::uuid AND recorded_at=CURRENT_DATE",
        org_id,
    )
    # ── THE NUMBER SHOWN IS NOW THE NUMBER ENFORCED ──────────────────────────
    #
    # This endpoint used to compute the ceiling and the usage itself, through a
    # third query shape that `org_invites`'s own docstring names as the reason
    # the seat counters were unified: "`subscription.py` renders the ceiling to
    # the customer through a THIRD query shape, so the number displayed was not
    # the number enforced." That was still true here in two ways.
    #
    #   · IT COUNTED NO PENDING INVITES. A pending invite HOLDS a seat — settled
    #     by the owner, and `SeatCount.used` says so. Measured read-only on the
    #     live database 2026-08-06, the E2E org has 6 joined and 7 pending: this
    #     screen said 6, the refusal counted 13. The two agree only for an org
    #     with nothing outstanding, which is the case nobody files a bug about.
    #
    #   · IT INNER-JOINED `staging.subscriptions`. An org with no subscription
    #     row got `sub = None` and was shown `max_users: null` — unlimited — even
    #     with a number typed into `organisations.max_users`. All three live orgs
    #     happen to have an active subscription row today, so this one has never
    #     misfired in production; it is the shape that is wrong, not the data.
    #     `count_seats` resolves the plan with an explicit precedence and a
    #     LATERAL LIMIT 1, and reads the org column whether or not a plan exists.
    #
    # One counter. `user_count` is kept and still means JOINED MEMBERS, because
    # two screens render it under a "Seats used" label and silently changing what
    # a field means is worse than adding one. `seats_used` is the enforced
    # figure, and is what a seat tile should show.
    from routers.org_invites import count_seats

    seats = await count_seats(pool, org_id)

    # ── ATTENDANCE SEATS ARE A SEPARATE COUNT ────────────────────────────────
    #
    # The owner's decision of 2026-08-04: a firm with 8 office staff and 200 site
    # workers pays for 8 org seats and 200 attendance seats, not 208 of one kind.
    # They are reported side by side and never added together — see
    # `services/seat_model.py`, including the note on the resolver gap that still
    # forces a worker who clocks in to hold an org seat as well.
    pahchan = await count_pahchan_seats(pool, org_id)

    return {
        "metrics": {r["metric"]: float(r["value"]) for r in usage},
        "user_count": seats.joined,
        "max_users": seats.limit,
        #: What the refusal counts: joined + invited-but-not-yet-accepted.
        "seats_used": seats.used,
        "seats_pending": seats.pending,
        "pahchan": {
            "seats_used": pahchan.used,
            "max_seats": pahchan.limit,
            "roster": pahchan.roster,
            #: On the roster but already paid for as org users.
            "exempt": pahchan.exempt,
            "module_active": pahchan.module_active,
        },
    }


# ── Client Cost Report ─────────────────────────────────────

@router.get("/cost-report")
async def cost_report(
    period: str = "30d",
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Client-facing usage report. Shows credit consumption only — no money disclosed.

    Owner and admin, for the same reason as `list_invoices`: it was open to every
    `org_member` while the only screen that renders it sits behind an
    owner/admin gate.
    """
    pool = await get_pool()

    period_map = {"7d": 7, "30d": 30, "90d": 90, "ytd": None}
    days = period_map.get(period, 30)
    if days:
        start = date.today() - timedelta(days=days)
    else:
        start = date(date.today().year, 1, 1)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.monthly_credits, p.name as plan_name, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    plan_credits = (org["monthly_credits"] or org["default_credits"] or 0) if org else 0

    wallet = await pool.fetchrow(
        "SELECT balance, credits_reset_at FROM staging.hub_org_credits WHERE org_id=$1::uuid",
        org_id,
    )

    # Credit transactions in period
    transactions = await pool.fetch(
        "SELECT tx_type, amount, description "
        "FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid AND created_at >= $2 AND created_at < $3 "
        "ORDER BY created_at DESC",
        org_id, cutoff,
        datetime.combine(date.today() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc),
    )

    # Aggregate by category
    ai_credits = 0
    scraper_credits = 0
    for tx in transactions:
        if tx["tx_type"] != "debit":
            continue
        desc = tx["description"] or ""
        amt = abs(tx["amount"])
        if desc.startswith("scraper:") or desc.startswith("scraper true-up"):
            scraper_credits += amt
        else:
            ai_credits += amt

    total_used = ai_credits + scraper_credits
    overage = max(0, total_used - plan_credits)

    return {
        "period": period,
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "plan_credits": plan_credits,
        # The WALLET is the balance. It is fetched thirty lines above and was
        # used only for `last_reset`, while this field was derived as
        # `plan_credits - total_used` — a different number that nothing enforces.
        #
        # Measured live on staging 2026-07-28: this reported `current_balance`
        # 2000 while `POST /v1/scrapers/run` refused the same org with
        # "Insufficient credits. Need 2, have 0". Every debit path reads
        # `staging.hub_org_credits.balance` (scrapers.py:138, ai_router.py:713,
        # hub.py:1588); this report read none of them, so a customer was shown
        # 2000 spendable credits they did not have.
        #
        # The derived figure could not be right, for two independent reasons:
        # `total_used` counts only transactions inside the reporting window, so
        # the number drifts UP as older spend falls out of a 30d period; and a
        # top-up or admin adjustment moves the wallet without writing a debit
        # here at all.
        #
        # The fallback keeps the previous behaviour for an org with no wallet
        # row, which is the only case with nothing better to report.
        "current_balance": (
            wallet["balance"] if wallet is not None else max(0, plan_credits - total_used)
        ),
        "last_reset": wallet["credits_reset_at"].isoformat() if wallet and wallet["credits_reset_at"] else None,
        "ai_credits_used": ai_credits,
        "scraper_credits_used": scraper_credits,
        "total_credits_used": total_used,
        "overage_credits": overage,
        "is_over_plan": overage > 0,
    }


@router.get("/cost-report/pdf")
async def cost_report_pdf(
    period: str = "30d",
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Download client usage report as PDF. Shows credits only — no money.

    Owner and admin. This one also carries `authorized_signatory_name` and
    `authorized_signatory_designation` into the rendered document, which is org
    identity data rather than usage data, and it was reachable by every member.
    """
    from fastapi.responses import Response
    from services.cost_report_pdf import generate_credit_report_pdf

    pool = await get_pool()

    period_map = {"7d": 7, "30d": 30, "90d": 90, "ytd": None}
    days = period_map.get(period, 30)
    if days:
        start = date.today() - timedelta(days=days)
    else:
        start = date(date.today().year, 1, 1)
    cutoff = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
    cutoff_end = datetime.combine(date.today() + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)

    org = await pool.fetchrow(
        "SELECT o.name, o.monthly_credits, o.authorized_signatory_name, o.authorized_signatory_designation, "
        "p.name as plan_name, p.default_credits "
        "FROM staging.organisations o "
        "LEFT JOIN staging.subscriptions s ON s.org_id = o.id "
        "LEFT JOIN staging.plans p ON p.id = s.plan_id "
        "WHERE o.id = $1::uuid", org_id
    )
    plan_credits = (org["monthly_credits"] or org["default_credits"] or 0) if org else 0

    wallet = await pool.fetchrow(
        "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid", org_id
    )

    transactions = await pool.fetch(
        "SELECT tx_type, amount, description, created_at "
        "FROM staging.hub_org_credit_transactions "
        "WHERE org_id=$1::uuid AND created_at >= $2 AND created_at < $3 "
        "ORDER BY created_at DESC",
        org_id, cutoff, cutoff_end,
    )

    ai_credits = 0
    scraper_credits = 0
    for tx in transactions:
        if tx["tx_type"] != "debit":
            continue
        desc = tx["description"] or ""
        amt = abs(tx["amount"])
        if desc.startswith("scraper:") or desc.startswith("scraper true-up"):
            scraper_credits += amt
        else:
            ai_credits += amt

    total_used = ai_credits + scraper_credits
    overage = max(0, total_used - plan_credits)

    scraper_breakdown = await pool.fetch(
        "SELECT c.name, COUNT(r.id) as runs, COALESCE(SUM(r.credits_charged),0) as credits "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.org_id=$1::uuid AND r.created_at >= $2 AND r.created_at < $3 "
        "GROUP BY c.name ORDER BY credits DESC",
        org_id, cutoff, cutoff_end,
    )

    report_data = {
        "org_name": org["name"] if org else "",
        "plan_name": org["plan_name"] if org else "Free",
        "period_start": start.isoformat(),
        "period_end": date.today().isoformat(),
        "plan_credits": plan_credits,
        # Same fix as the JSON report above, and the same reason — this handler
        # also fetched `wallet` and then never used it. Left divergent, the PDF
        # a customer files would disagree with the screen it was generated from.
        "current_balance": (
            wallet["balance"] if wallet is not None else max(0, plan_credits - total_used)
        ),
        "ai_credits_used": ai_credits,
        "scraper_credits_used": scraper_credits,
        "total_credits_used": total_used,
        "overage_credits": overage,
        "signatory_name": org["authorized_signatory_name"] if org else "",
        "signatory_designation": org["authorized_signatory_designation"] if org else "",
        "scraper_breakdown": [{"name": r["name"], "runs": r["runs"], "credits": r["credits"]} for r in scraper_breakdown],
    }

    pdf_bytes = generate_credit_report_pdf(report_data)
    filename = f"Usage-Report-{start.strftime('%b%Y')}-{date.today().strftime('%d%b%Y')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── User Roles ──────────────────────────────────────────────

@router.get("/my-roles")
async def get_my_roles(user=Depends(require_user)):
    """Return all roles for the current user (platform + org-scoped)."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT ur.role_code, ur.org_id, o.name as org_name "
        "FROM staging.user_roles ur "
        "LEFT JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1",
        user["user_id"],
    )
    platform_roles = [r["role_code"] for r in rows if r["org_id"] is None]
    org_roles = [
        {"org_id": str(r["org_id"]), "org_name": r["org_name"], "role": r["role_code"]}
        for r in rows if r["org_id"] is not None
    ]
    return {
        "platform_roles": platform_roles,
        "org_roles": org_roles,
        # `is_god_mode(strongest(...))`, not `"platform_admin" in platform_roles`.
        #
        # The literal test returns False for a `platform_owner`, which is the
        # CURRENT spelling of god mode — `platform_admin` is the legacy alias
        # that role_tiers.py:19-22 keeps only until the rows are migrated. On the
        # day those rows are renamed this flag would have silently flipped to
        # False for all three god-mode accounts, which is the exact lockout
        # role_tiers.py:115-121 was written to warn about.
        "is_platform_admin": is_god_mode(strongest(platform_roles)),
    }
