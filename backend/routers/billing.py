"""
billing.py — what an organisation's credits went on, and who spent them.

WHY THIS ROUTER EXISTS, in the owner's words: "money is money and needs to be
metered, capped and visibility." Two of those three shipped with migration 095.
Metering became exact — every spend writes `kind`, `ref_id`, `user_id` and
`period_start` to the ledger. Capping became real — a per-member ceiling on the
shared org balance is enforced on every spend. Visibility did not ship at all:
the only readers are `admin_orgs./{org_id}/credits/usage`, which returns ONE
dimension (`by_kind`) and no people, and `hub.py/org/credits/users`, which sits
behind `require_module("srijan")` even though a ceiling binds a scraper run and
a chatbot answer just as hard.

So this router answers the two questions a bill is actually argued over:

    WHICH SURFACE spent it   →  /usage/sources
    WHICH PERSON spent it    →  /usage/people, /usage/sources/{source}/people

and gives the drill-down that proves either number: /usage/transactions.

It also carries the OTHER half of a bill, which is not credits at all:

    WHAT THE CLIENT IS CHARGED  →  /lines, and the three writes that maintain it
    WHAT IS DUE THIS MONTH      →  /invoice-preview

Credits are metered consumption. `staging.org_billing_lines` is the agreed
commercial terms — a platform fee, a support plan, a one-off integration setup,
ongoing support, and the top-up a client asked to be put on the next invoice.
The two are different money and are never added together: the credit figures
above are labelled indicative at a per-credit price, and the line amounts are
rupees somebody agreed to. An invoice is a QUERY OVER THE LINES DUE IN A PERIOD
and never a total somebody typed, which is what `/invoice-preview` answers.
There is no payment gateway and there will not be one — an invoice collects by
carrying a UPI address.

TWO FAMILIES, ONE SET OF BODIES.
  · `/me/*`            — an org admin looking at their OWN org. The org comes
                         from `get_org_id` and from nowhere else, so there is no
                         parameter a caller could point at somebody else's bill.
  · `/orgs/{org_id}/*` — Aekam looking at anyone, INCLUDING ITSELF. Aekam's view
                         of its own org needs no third code path: it is
                         `/orgs/{aekam_id}/*` and the screens point the same
                         components at a different base path.

NO CREDIT TABLE IS NAMED HERE, not even in a comment. `services/credits.py` is
the only file permitted to contain the four credit table names, and the check
that enforces it is a grep — so a docstring that quotes one to explain the rule
is a docstring that breaks it. A report reaching past that module is how five
debit implementations came to disagree in the first place. Every credit number
below comes from a function in `services.credits`; the only tables this file
names are `staging.organisations`, `staging.user_roles` and `public.users`, none
of which hold money.
"""
import contextlib
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    BILLING_CONSOLE_ROLES, FINANCE_CONSOLE_ROLES, ORG_SETTINGS_ROLES,
)
from middleware.roles import require_org_role, require_platform_role
from services import credits

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


# ── Copy ────────────────────────────────────────────────────────────────────
#
# The label a source is shown under. Lives here rather than in the service
# because it is presentation, and beside `credits.SOURCE_KEYS` in spirit: the
# lookup falls back to the raw key, so a source added to the taxonomy without a
# label degrades to something readable instead of disappearing.

SOURCE_LABELS: dict[str, str] = {
    "srijan":     "Srijan content",
    "skills":     "Skills",
    "chat":       "Chat & knowledge base",
    "whatsapp":   "WhatsApp",
    "social":     "Social publishing",
    "scrapers":   "Scrapers",
    "wallet":     "Wallet movements",
    # Deliberately not "Other" or "Legacy". These 171 rows predate the itemised
    # ledger and their descriptions are free text that nothing parses; the tab
    # has to say that rather than imply the spend was categorised and unusual.
    "unitemised": "Before spend was itemised",
    "other":      "Unclassified",
}


#: The four wallet movements, spelled out. The raw keys are the ledger's
#: `ref_id`s and two of them read identically to a human — a `topup` into the
#: allowance bucket and the monthly `period` grant are both "allowance", and on a
#: screen about money the difference between "Aekam gave you these" and "your
#: plan renewed" is the whole point.
WALLET_ITEM_LABELS: dict[str, str] = {
    "purchased": "Purchased top-up",
    "allowance": "Goodwill allowance top-up",
    "grant":     "Monthly allowance granted",
    "expire":    "Allowance expired at the roll",
}


def _label(source: str) -> str:
    return SOURCE_LABELS.get(source, source)


def _decorate(source: dict) -> dict:
    """Attach the human copy a source and its sub-rows are shown under."""
    out = {**source, "label": _label(source["source"])}
    if source["source"] == "wallet":
        out["items"] = [
            {**i, "label": WALLET_ITEM_LABELS.get(i["ref_id"], i["ref_id"])}
            for i in source.get("items", [])
        ]
    return out


# ── The period ──────────────────────────────────────────────────────────────
#
# A billing period is a CALENDAR MONTH and never a rolling 30 days, because the
# wallet's own `period_start` is the 1st of a month and the allowance that resets
# on that date is what the bill is about. A rolling window would report spend
# from two allowances as though it came from one.

_PERIOD_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def _period_window(period: Optional[str]) -> tuple[str, date, date, datetime, datetime]:
    """`YYYY-MM` → (label, first of that month, first of the next, and the two
    as UTC instants for a `created_at` comparison).

    The upper bound is EXCLUSIVE. An inclusive last-day bound silently drops
    every transaction written after midnight on the 31st, which is most of them.
    """
    if not period:
        start = credits.current_period()
    else:
        m = _PERIOD_RE.match(period.strip())
        if not m:
            raise HTTPException(400, {
                "error": "bad_period",
                "message": "period must be a calendar month written YYYY-MM, "
                           "for example 2026-08.",
            })
        start = date(int(m.group(1)), int(m.group(2)), 1)
    end = credits.next_period(start)
    return (
        f"{start.year:04d}-{start.month:02d}",
        start,
        end,
        datetime(start.year, start.month, 1, tzinfo=timezone.utc),
        datetime(end.year, end.month, 1, tzinfo=timezone.utc),
    )


def _known_source(source: Optional[str]) -> Optional[str]:
    """Refuse an unknown source by NAME, listing the ones that exist.

    A silent empty result would read as "this org spent nothing on that", which
    is a different and much more expensive claim than "there is no such tab".
    """
    if source is None:
        return None
    if source not in credits.SOURCE_KEYS:
        raise HTTPException(404, {
            "error": "unknown_source",
            "message": f"'{source}' is not a spend source. The sources are: "
                       f"{', '.join(credits.SOURCE_KEYS)}.",
        })
    return source


# ── Tenancy ─────────────────────────────────────────────────────────────────

async def _org_or_404(pool, org_id: str) -> dict:
    """Resolve a console-supplied org id, or 404.

    The uuid parse is inside the 404 and not a 400: `$1::uuid` on a malformed id
    raises a DataError, which reaches the client as a 500 and tells an operator
    the server is broken when they have simply mistyped an id.

    `is_active` is NOT required. A deactivated org still has a bill, and the
    month it was deactivated in is precisely the one someone will need to read.
    """
    try:
        uuid.UUID(str(org_id))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(404, "Organisation not found")
    row = await pool.fetchrow(
        "SELECT id, name, is_platform_org FROM staging.organisations WHERE id=$1::uuid",
        org_id,
    )
    if not row:
        raise HTTPException(404, "Organisation not found")
    return row


async def _assert_member(pool, org_id: str, user_id: str) -> None:
    """A ceiling may only be set on somebody who is actually in the org.

    Without this, a typo'd id creates a ceiling row for a person who cannot
    spend, the admin believes they have capped someone, and the "who spent what"
    table grows a member nobody recognises. `hub.py`'s allocate route has this
    hole; this one does not.
    """
    ok = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles WHERE user_id=$1 AND org_id=$2::uuid LIMIT 1",
        user_id, org_id,
    )
    if not ok:
        raise HTTPException(404, {
            "error": "not_a_member",
            "message": "That person is not a member of this organisation, so a "
                       "ceiling on its balance would never bind. Add them to the "
                       "organisation first.",
        })


# ── Bodies, built once and served by both families ──────────────────────────

async def _sources_body(org_id: str, period: Optional[str]) -> dict:
    label, start, end, since, until = _period_window(period)
    pool = await get_pool()
    data = await credits.usage_by_source(pool, org_id, since=since, until=until)
    return {
        "org_id": org_id,
        "period": label,
        "period_start": start.isoformat(),
        # Exclusive: the first instant NOT in the period. Named as it behaves so
        # a caller does not render it as "the last day" and lose a day of spend.
        "period_end": end.isoformat(),
        "total_credits": data["total_credits"],
        "unitemised_credits": data["unitemised_credits"],
        "unitemised_tx": data["unitemised_tx"],
        # `total_credits` above already excludes the wallet source: it carries
        # `is_usage: false` and a signed net movement rather than a magnitude
        # consumed. It is returned so the balance screen has it, never so a
        # caller can add it to a spend.
        "sources": [_decorate(s) for s in data["sources"]],
    }


async def _people_body(org_id: str, period: Optional[str], source: Optional[str]) -> dict:
    label, start, end, since, until = _period_window(period)
    source = _known_source(source)
    pool = await get_pool()
    data = await credits.usage_by_person(
        pool, org_id, since=since, until=until, source=source,
    )
    total = data["total_credits"]
    return {
        "org_id": org_id,
        "period": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "source": source,
        "source_label": _label(source) if source else None,
        "total_credits": total,
        "unitemised_credits": data["unitemised_credits"],
        "unitemised_tx": data["unitemised_tx"],
        # `share` is computed here rather than on the client so the column and
        # the total can never disagree, and so a zero total is a 0 share rather
        # than a division by zero rendered as NaN.
        "people": [
            {**p, "share": round(p["credits"] / total, 4) if total else 0}
            for p in data["people"]
        ],
    }


async def _transactions_body(
    org_id: str, period: Optional[str], source: Optional[str],
    user_id: Optional[str], limit: int,
) -> dict:
    label, start, end, since, until = _period_window(period)
    source = _known_source(source)
    pool = await get_pool()
    rows = await credits.usage_detail(
        pool, org_id, since=since, until=until,
        source=source, user_id=user_id, limit=limit,
    )
    return {
        "org_id": org_id,
        "period": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "source": source,
        "user_id": user_id,
        "data": rows,
        # `>=` and not `>`: a window that happens to hold exactly `limit` rows is
        # reported as truncated. Claiming completeness we cannot prove without a
        # second count is the wrong error to make on a page of money.
        "truncated": len(rows) >= limit,
    }


async def _balance_body(org_id: str) -> dict:
    """Balance, ceilings and prices, as one read.

    `roll_period` runs first, and it WRITES. That is the design: there is no
    scheduler, the roll fires lazily on the first spend or balance read of the
    month, and it is what carries the ceilings forward. Without it this screen is
    empty on the 1st and an admin concludes their allocations were lost.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            bal = await credits.roll_period(conn, org_id)

    commitment = await credits.commitment_of(pool, org_id)
    caps = await credits.org_member_caps(pool, org_id)
    prices = await credits.price_list(pool)

    # Names for the ceiling table. A member who has a ceiling and has spent
    # nothing this period has no ledger row, so `/usage/people` cannot name
    # them — and a ceiling screen that shows a bare user id is a ceiling screen
    # nobody uses. `users` is not a credit table, so this read belongs here.
    names: dict[str, dict] = {}
    ids = [c.user_id for c in caps if c.user_id]
    if ids:
        rows = await pool.fetch(
            "SELECT user_id, COALESCE(full_name, name, email) AS name, email "
            "FROM public.users WHERE user_id = ANY($1::text[])",
            ids,
        )
        names = {r["user_id"]: {"name": r["name"], "email": r["email"]} for r in rows}

    return {
        "org_id": org_id,
        "balance": {
            "org_id": bal.org_id,
            "allowance": bal.allowance,
            "purchased": bal.purchased,
            "total": bal.total,
            "period_start": bal.period_start.isoformat(),
            # TRUE means the balance check is skipped — not that the wallet is
            # infinite. Ceilings still bind and every spend is still metered.
            "is_platform_org": bal.is_platform_org,
            "monthly_credits": bal.monthly_credits,
        },
        "commitment": commitment,
        "members": [
            {
                "user_id": c.user_id,
                "name": names.get(c.user_id, {}).get("name") or c.user_id,
                "email": names.get(c.user_id, {}).get("email"),
                "cap": c.cap,
                "spent": c.spent,
                "remaining": c.remaining,
                "period_start": c.period_start.isoformat(),
            }
            for c in caps
        ],
        "prices": prices,
    }


def _cap_json(cap) -> dict:
    return {
        "user_id": cap.user_id,
        "cap": cap.cap,
        "spent": cap.spent,
        "remaining": cap.remaining,
        "period_start": cap.period_start.isoformat(),
    }


async def _set_cap(org_id: str, target_user_id: str, cap: Optional[int], actor: str) -> dict:
    pool = await get_pool()
    await _assert_member(pool, org_id, target_user_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            # ABSOLUTE, not additive. `set_member_cap` refuses a negative with a
            # 400 that says what to do instead; it is not re-checked here,
            # because two copies of a money refusal is how they come to differ.
            mc = await credits.set_member_cap(
                conn, org_id=org_id, user_id=target_user_id, cap=cap, set_by=actor,
            )
    return _cap_json(mc)


class CapBody(BaseModel):
    """`cap` is REQUIRED and nullable, and the two mean different things.

    `null` clears the ceiling — uncapped within the org balance. `0` refuses that
    member everything, which is a real supported state. An OMITTED field is
    neither, so it is refused rather than defaulted: a PUT that silently cleared
    a ceiling because a form left the key out is a ceiling that quietly stopped
    binding.
    """
    cap: Optional[int] = Field(..., description="Credits, 0 to block, null to clear")


# ══════════════════════════════════════════════════════════════════════════
# THE ORG'S OWN BILL — /me/*
#
# The org is `get_org_id` and nothing else. `require_org_role` resolves the same
# org, so the checks land in the order the rest of this codebase documents: the
# org is resolved (404 if it does not exist or is inactive), then access to it is
# proven (membership, or a platform role that may cross), then the ROLE inside it
# is checked. A member who is not an owner or admin gets a 403 and never sees a
# colleague's spend.
# ══════════════════════════════════════════════════════════════════════════

@router.get("/me/usage/sources")
async def my_usage_sources(
    period: Optional[str] = Query(None, description="YYYY-MM; defaults to this month"),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """What this org spent, one row per product surface, sub-rowed by ref_id."""
    return await _sources_body(org_id, period)


@router.get("/me/usage/people")
async def my_usage_people(
    period: Optional[str] = Query(None),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Who in this org spent it."""
    return await _people_body(org_id, period, None)


@router.get("/me/usage/sources/{source}/people")
async def my_usage_source_people(
    source: str,
    period: Optional[str] = Query(None),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Who spent it, within one source."""
    return await _people_body(org_id, period, source)


@router.get("/me/usage/transactions")
async def my_usage_transactions(
    period: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """The ledger rows behind one cell of either report."""
    return await _transactions_body(org_id, period, source, user_id, limit)


@router.get("/me/balance")
async def my_balance(
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Balance, the ceilings set against it, the over-commitment, and prices."""
    return await _balance_body(org_id)


@router.put("/me/members/{target_user_id}/cap")
async def my_set_member_cap(
    target_user_id: str,
    body: CapBody,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Set one member's ceiling on the SHARED org balance.

    A ceiling is a limit, not an allocation: nothing is reserved and nothing is
    debited from a member. The sum of the ceilings may legitimately exceed the
    balance — see `commitment.over_committed_by` on `/me/balance`, which is what
    the screen must show rather than refusing to save it.

    These routes exist separately from `hub.py`'s allocate/deallocate pair
    because those sit behind `require_module("srijan")`, and a ceiling binds a
    scraper run, a WhatsApp send and a chatbot answer just as hard. The hub
    routes are NOT removed — `srijan/CreditsTab.jsx` calls them.
    """
    return await _set_cap(org_id, target_user_id, body.cap, user["user_id"])


@router.delete("/me/members/{target_user_id}/cap")
async def my_clear_member_cap(
    target_user_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Remove a ceiling entirely — the member spends from the org pool.

    Clearing is a different act from setting a very large number, which is why
    it has its own verb.
    """
    return await _set_cap(org_id, target_user_id, None, user["user_id"])


# ══════════════════════════════════════════════════════════════════════════
# AEKAM OVER ANY ORG — /orgs/{org_id}/*
#
# Identical bodies. The org is a PATH PARAMETER, so the guard can see which org
# is being read — the header-based resolution `org_resolver.py` documents as the
# thing to fix is exactly what these routes avoid.
#
# Reads are FINANCE_CONSOLE_ROLES (god mode ∪ account_finance): Aekam's own P&L
# and every client's cost basis are visible through them, and `role_tiers.py`
# reserves that set for exactly that. Writing a member ceiling is a customer
# commercial term, so it is BILLING_CONSOLE_ROLES, matching
# `PATCH /admin/orgs/{org_id}/settings`.
# ══════════════════════════════════════════════════════════════════════════

@router.get("/orgs/{org_id}/usage/sources")
async def org_usage_sources(
    org_id: str,
    period: Optional[str] = Query(None),
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _sources_body(org_id, period)
    return {**body, "org_name": org["name"],
            "is_platform_org": bool(org["is_platform_org"])}


@router.get("/orgs/{org_id}/usage/people")
async def org_usage_people(
    org_id: str,
    period: Optional[str] = Query(None),
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _people_body(org_id, period, None)
    return {**body, "org_name": org["name"],
            "is_platform_org": bool(org["is_platform_org"])}


@router.get("/orgs/{org_id}/usage/sources/{source}/people")
async def org_usage_source_people(
    org_id: str,
    source: str,
    period: Optional[str] = Query(None),
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _people_body(org_id, period, source)
    return {**body, "org_name": org["name"],
            "is_platform_org": bool(org["is_platform_org"])}


@router.get("/orgs/{org_id}/usage/transactions")
async def org_usage_transactions(
    org_id: str,
    period: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    await _org_or_404(pool, org_id)
    return await _transactions_body(org_id, period, source, user_id, limit)


@router.get("/orgs/{org_id}/balance")
async def org_balance(
    org_id: str,
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _balance_body(org_id)
    return {**body, "org_name": org["name"]}


@router.put("/orgs/{org_id}/members/{target_user_id}/cap")
async def org_set_member_cap(
    org_id: str,
    target_user_id: str,
    body: CapBody,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    """Aekam sets a member's ceiling. Same absolute semantics as `/me`.

    It applies on Aekam's own org too. `is_platform_org` skips the ORG BALANCE
    CHECK and nothing else — a ceiling still binds there, and the screen says so.
    """
    pool = await get_pool()
    await _org_or_404(pool, org_id)
    return await _set_cap(org_id, target_user_id, body.cap, user["user_id"])


@router.delete("/orgs/{org_id}/members/{target_user_id}/cap")
async def org_clear_member_cap(
    org_id: str,
    target_user_id: str,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    pool = await get_pool()
    await _org_or_404(pool, org_id)
    return await _set_cap(org_id, target_user_id, None, user["user_id"])


# ══════════════════════════════════════════════════════════════════════════
# WHAT THE ORGANISATION IS BILLED — staging.org_billing_lines
#
# ONE SECTION, BOTH FAMILIES, deliberately. The two families above are split by
# banner because they answer the same question for two audiences and share
# nothing but a body builder. These routes are not that: they are one feature
# with two doors, an org's read-only view of its own terms and Aekam's console
# over anyone's, and the reason the second may write while the first may not is
# the only thing worth reading twice here. Splitting them across the two banners
# above would file that reason under an audience instead of under the rule.
#
# THIS ROUTER NEITHER WRITES THE TABLE NOR READS IT DIRECTLY.
# `services/billing_lines.py` owns both ends, exactly as `services/credits.py`
# owns the credit tables. `migrations/README.md` permits a router to SELECT from
# `org_billing_lines`, and this one still does not, for a reason that outranks
# the permission: `list_lines`, `lines_due_in_period` and the invoice's own
# `record_billed` all turn on ONE definition of "due in a period", and the moment
# a second copy of that predicate lives in a router, the screen showing an
# operator what they are about to bill stops describing what they actually bill.
# So every route below is an adapter: it resolves the org, decides who may see
# it, calls the service, and shapes the answer for the screens that shipped
# first. Nothing here spells a column name or a WHERE clause.
#
# WHERE THE TENANCY GUARD LIVES. `/me/lines` takes its org from `get_org_id` and
# there is no path, query or body field on it that could name another. The
# console family passes an explicit `org_id`, and every service call takes that
# org as a REQUIRED argument — `update_line` and `end_line` resolve a line by
# `id AND org_id` in one WHERE clause, so another org's line is NOT FOUND rather
# than found-and-then-refused. There is no `if row["org_id"] != org_id` anywhere
# in this path for a later edit to drop. One client reading another's negotiated
# terms is the worst thing this feature can do, so the guard is put where losing
# it stops the query rather than opens it.
# ══════════════════════════════════════════════════════════════════════════

# ── Two failures that are a missing deploy step, not a broken server ─────────

@contextlib.contextmanager
def _billing_schema():
    """Turn "relation does not exist" into a sentence that names the migration.

    `096_billing_lines.sql` is applied BY HAND, and until it is, every call below
    fails with `relation "staging.org_billing_lines" does not exist` — a 500 that
    tells an operator the server is broken when the true answer is that a
    migration is outstanding. `services/billing_lines.py` deliberately lets that
    error out raw, because a service must not decide how a fault is presented;
    this is the router, which is exactly where it becomes a sentence. 096's own
    GUARD 0 does the same for its dependency on 095, from the other side.

    Matched on `sqlstate` rather than on the asyncpg class, which is the
    convention `services/credits.py:_is_unique_violation` sets, so a wrapped
    driver or a test double behaves the same. `HTTPException` passes through
    untouched — every refusal the service raises is one, and swallowing those
    would turn a named 409 into "apply a migration".
    """
    try:
        yield
    except HTTPException:
        raise
    except Exception as exc:                     # noqa: BLE001 — re-raised below
        if getattr(exc, "sqlstate", None) != "42P01":
            raise
        raise HTTPException(503, {
            "error": "billing_schema_missing",
            "message": (
                "The billing-lines tables do not exist in this database, so what "
                "this organisation is charged can be neither read nor changed. "
                "Nothing was changed. Apply "
                "backend/migrations/096_billing_lines.sql. Credits and usage are "
                "unaffected — they come from a different module."
            ),
        }) from exc


def _service():
    """`services/billing_lines.py`, imported at CALL TIME.

    The same lazy import `admin_orgs._billing_lines()` uses, and for a reason
    this router shares: a deployment without the billing service must still serve
    everything above this banner — the credit usage reports, the balance, the
    member ceilings — none of which has anything to do with billing lines.

    A missing module answers 503 and not 500, because the two say different
    things to whoever is on the other end. 500 is "this broke". 503 is "half of
    this deploy has not landed, and NOTHING WAS CHANGED".
    """
    try:
        from services import billing_lines
    except ImportError as exc:
        raise HTTPException(503, {
            "error": "billing_lines_unavailable",
            "message": (
                "The billing-lines service is not deployed. It owns everything "
                "this organisation is charged — reading it and writing it — so "
                "there is nothing to show and nothing was changed. Credits and "
                "usage are unaffected; they come from a different module."
            ),
        }) from exc
    return billing_lines


def _attr(name: str):
    """One named function or constant off that module, or a 503 that says which.

    THE SURFACE THIS ROUTER DEPENDS ON, in one place so an integrator has one
    place to look. All of it is public in `services.billing_lines.__all__`:

        list_lines(conn, org_id, *, period=None, limit=500) -> dict
        lines_due_in_period(conn, org_id, period) -> dict
        create_line(conn, *, org_id, kind, description, amount, cadence,
                    period_start, source_ref=None, created_by=None) -> dict
        update_line(conn, line_id, *, org_id, description=None, amount=None) -> dict
        end_line(conn, line_id, *, org_id, actor_id=None, period=None) -> dict
        OPERATOR_KINDS  — the kinds a form may create: support, setup, ongoing

    `getattr` with a named refusal rather than a bare attribute access, for the
    reason this whole batch exists: a lazy import means a missing name is not
    caught by any import check in this repo and fails for the first time in
    production, on a route about money.
    """
    fn = getattr(_service(), name, None)
    if fn is None:
        raise HTTPException(503, {
            "error": "billing_lines_incomplete",
            "message": (
                f"The billing-lines service is deployed but has no `{name}`, and "
                f"it is the only module permitted to touch what an organisation "
                f"is charged. Nothing was changed."
            ),
        })
    return fn


async def _lines_body(org_id: str, period: Optional[str], limit: int) -> dict:
    """Every line this org has, and what they total for one period.

    `billing_lines.list_lines` answers all of it. Two things are added here and
    neither is arithmetic:

      · `period` is rewritten to `YYYY-MM`. The service reports it as a full
        date; every other body in this router reports a period as the month, and
        one router speaking two dialects of "period" is how a caller ends up
        parsing one of them.
      · `truncated`, computed with `>=` and not `>`, exactly as
        `_transactions_body` above does it. A page that happens to hold exactly
        `limit` rows is reported as truncated, because claiming completeness we
        cannot prove without a second count is the wrong error to make on a page
        about money.

    THE TOTALS COUNT LINES ALREADY ON AN INVOICE. This is what the org is billed
    for the period — its commitment — not what is left to collect.
    `/invoice-preview` answers the second question and is the only endpoint that
    should be read as "what to raise now".
    """
    label, start, _end, _since, _until = _period_window(period)
    list_lines = _attr("list_lines")
    pool = await get_pool()
    with _billing_schema():
        async with pool.acquire() as conn:
            body = await list_lines(conn, org_id, period=start, limit=limit)

    return {
        **body,
        "period": label,
        "currency": "INR",
        "truncated": len(body.get("data") or []) >= limit,
    }


async def _preview_body(org_id: str, period: Optional[str]) -> dict:
    """WHAT IS DUE FOR THIS PERIOD — the query that makes an invoice a query.

    `billing_lines.lines_due_in_period` answers it, in two lists, and the second
    is the point: `already_billed` is every line this month's invoice must not
    carry again, with the invoice number that already has it. Without it,
    pressing "Load lines" for August twice raises the platform fee twice and
    nothing on the second invoice says it duplicates the first.

    ONE FIELD IS ADDED, and it is not cosmetic. `InvoiceBuilder.jsx:97` reads
    `l.line_id` off each due line and carries it into `POST /admin/invoices` as
    `line_ids` — which is what makes `invoice_billing_lines` get written at all.
    The service returns a line row, whose id key is `id`. Left unmapped, every
    `line_id` would be `undefined`, the builder would send no `line_ids`, and the
    no-double-charge table would stay empty while looking exactly as though it
    were working. `id` is kept alongside it: the same object is a line everywhere
    else in this router and dropping its own id to suit one caller is how the two
    shapes start needing to be told apart.

    `period_start` and `period_end` here are the service's and are INCLUSIVE —
    the 1st and the last day of the month — because they become
    `subscription_invoices.period_start` and `.period_end`, which are the dates
    printed on the document. That is deliberately unlike the exclusive
    `period_end` on the usage bodies above, which is a query window and not a
    date anybody reads. Do not "fix" one to match the other.
    """
    label, start, _end, _since, _until = _period_window(period)
    lines_due_in_period = _attr("lines_due_in_period")
    pool = await get_pool()
    with _billing_schema():
        async with pool.acquire() as conn:
            body = await lines_due_in_period(conn, org_id, start)

    return {
        **body,
        "period": label,
        "currency": "INR",
        "lines": [{**l, "line_id": l["id"]} for l in (body.get("lines") or [])],
    }


# ── The org's own lines — /me/lines ─────────────────────────────────────────

@router.get("/me/lines")
async def my_billing_lines(
    period: Optional[str] = Query(None, description="YYYY-MM; defaults to this month"),
    limit: int = Query(200, ge=1, le=500),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """What THIS organisation is billed. Read-only, and its own only.

    The org comes from `get_org_id` and from nowhere else: there is no path
    parameter, no query parameter and no body field on this route that could name
    a different one. That matters more here than anywhere else in this file,
    because these rows are negotiated commercial terms — an org reading another's
    is not a smaller version of reading its spend, it is a different kind of
    harm. There is deliberately no `/me/invoice-preview` and no `/me` write: an
    org does not raise its own invoice and does not set its own price.
    """
    return await _lines_body(org_id, period, limit)


# ── Aekam over any org — /orgs/{org_id}/lines ───────────────────────────────
#
# BILLING_CONSOLE_ROLES on both the reads and the writes, and NOT the
# FINANCE_CONSOLE_ROLES the usage reads above use. The two sets are not nested —
# finance is god mode ∪ account_finance, billing adds platform_manager and
# account_manager — so the choice has to be made rather than inherited, and
# `role_tiers.py` makes it in its own words: FINANCE_CONSOLE_ROLES is "Aekam's
# own commercial data … margin", BILLING_CONSOLE_ROLES is "customer
# subscriptions, plans, invoices and payments". A billing line is the second
# thing. It is also exactly the tier that already writes the scalar these lines
# replace, at `PATCH /v1/admin/orgs/{org_id}/settings`.
#
# Gating the READ at finance while the WRITE stayed at billing would show
# platform_manager a Save button over a block that could not load — a control
# that 403s is worse than an absent one, and the console already renders the
# refusal it gets here as "billing access to this organisation".

@router.get("/orgs/{org_id}/lines")
async def org_billing_lines(
    org_id: str,
    period: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _lines_body(org_id, period, limit)
    return {**body, "org_name": org["name"],
            "is_platform_org": bool(org["is_platform_org"])}


class NewLine(BaseModel):
    """One billing line, as the console posts it.

    `amount` and `period_start` are UNTYPED on purpose. A `float` here would make
    pydantic answer a 422 whose `detail` is a list, and `refusalMessage` in the
    console renders a list as its fallback string — so the operator would be told
    "Could not save this billing line" and nothing else. Passed through as they
    arrived, `billing_lines._money` and `._month_start` refuse them in sentences
    that name the column and the limit. The validation is not skipped; it is
    moved to the module that owns the constraint.
    """
    kind: str = ""
    cadence: str = "monthly"
    description: str = ""
    amount: Any = None
    #: Omitted means this month. The console always sends it; the default exists
    #: so the field is never invented from a LOCAL clock — `credits.current_period`
    #: is UTC, and at 00:30 IST on the 1st the server is still in the previous
    #: period. A billing period cannot depend on where an operator is sitting.
    period_start: Any = None


@router.post("/orgs/{org_id}/lines")
async def org_create_billing_line(
    org_id: str,
    body: NewLine,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    """Add a line: a support plan, an integration setup, ongoing support.

    ONE GATE HERE, EVERY OTHER RULE IN THE SERVICE. The gate is `OPERATOR_KINDS`
    — the three kinds a form may create — and it is here rather than there
    because it is a statement about this ROUTE, not about the table. The service
    legitimately accepts `topup` from the top-up handler, which has a
    `source_ref` proving credits were granted; this route accepts no `source_ref`
    from anybody, so a `topup` posted here would be a charge for credits nobody
    received. `platform` the service refuses on its own, because a platform line
    written outside `PATCH /v1/admin/orgs/{org_id}/settings` is a
    `v_org_platform_line_drift` row the moment it lands.

    Everything else — a blank description, a negative or absurd amount, a
    `period_start` that is not a month at all, an unknown cadence, and above all
    A SECOND OPEN MONTHLY LINE OF THE SAME KIND — is `create_line`'s to refuse,
    in its own sentences, under `FOR UPDATE`. Restating any of them here would be
    a second copy of a money rule, and two copies of a money rule is how they
    come to differ. Note that a MID-MONTH `period_start` is truncated rather than
    refused — `2026-08-17` is August — so this route does not pre-validate the
    field and then hand over a different answer from the one the service gives.
    """
    pool = await get_pool()
    await _org_or_404(pool, org_id)

    operator_kinds = _attr("OPERATOR_KINDS")
    create_line = _attr("create_line")

    kind = str(body.kind or "").strip()
    if kind not in operator_kinds:
        raise HTTPException(400, {
            "error": "kind_not_creatable",
            "message": (
                f"'{kind or '(nothing)'}' is not a line this route creates. The "
                f"kinds an operator may add are: {', '.join(operator_kinds)}. The "
                f"platform fee is sent as `monthly_price` to "
                f"PATCH /v1/admin/orgs/{{org_id}}/settings, which writes the line "
                f"and the organisation's stored price in one transaction; a credit "
                f"top-up line is created by the top-up dialog, in the same "
                f"transaction as the credits it bills for."
            ),
            "kind": kind,
        })

    with _billing_schema():
        async with pool.acquire() as conn:
            # The service takes a `conn` and never commits — every one of its
            # functions is half of something else, so the transaction belongs to
            # whoever knows what the other half is. Here there is no other half,
            # and this is that transaction.
            async with conn.transaction():
                return await create_line(
                    conn,
                    org_id=org_id,
                    kind=kind,
                    description=body.description,
                    amount=body.amount,
                    cadence=body.cadence,
                    period_start=(body.period_start
                                  if body.period_start not in (None, "")
                                  else credits.current_period()),
                    created_by=user["user_id"],
                )


class LinePatch(BaseModel):
    """`description`, `amount`, or both. An OMITTED field is left alone.

    Distinguished by `model_fields_set` rather than by a None default, because
    the console sends `{description}` alone when it renames the platform fee, and
    reading that as "amount → null" would be a money field cleared by a form that
    did not touch it.
    """
    description: Optional[str] = None
    amount: Any = None


@router.patch("/orgs/{org_id}/lines/{line_id}")
async def org_update_billing_line(
    org_id: str,
    line_id: str,
    body: LinePatch,
    _=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    """Amend a line IN PLACE — the description, the amount, or both.

    In place rather than end-and-reopen for the reason `sync_platform_line` is
    documented with: ending a line and opening a second one for the same month
    puts two rows of one kind in one invoice period, and no index refuses the
    second because the first is no longer open.

    `update_line` owns which amendments are legal — the amount of a `platform`
    line, of a `topup` line and of an ENDED line are each refused there, by name,
    with the reason. It deliberately does NOT refuse an amount change on a line
    an invoice has already billed: what the client was charged is frozen on the
    invoice, and refusing would mean a fee agreed mid-month could not be recorded
    until the next one, which is how it gets forgotten. This router does not
    second-guess any of that.

    TAKES NO ACTOR. 096 gives the table `created_by` and `ended_by` and no
    `updated_by`, so `update_line` accepts no `actor_id` — passing one would say
    the amendment was attributed when there is nowhere to put it. Hence `_=` on
    the guard rather than `user=`: this handler genuinely has no use for the
    caller's identity, and binding one would imply it recorded it.
    """
    pool = await get_pool()
    await _org_or_404(pool, org_id)

    update_line = _attr("update_line")

    # `model_fields_set` and not a None default, because the console sends
    # `{description}` ALONE when it renames the platform fee. Reading an absent
    # key as `amount: null` would be a money field cleared by a form that never
    # touched it — and `update_line` reads None as "not supplied" for exactly
    # this reason, so an unsent key must arrive there as an unpassed argument.
    sent = body.model_fields_set
    changes: dict[str, Any] = {}
    if "description" in sent:
        changes["description"] = body.description
    if "amount" in sent:
        changes["amount"] = body.amount

    with _billing_schema():
        async with pool.acquire() as conn:
            async with conn.transaction():
                return await update_line(conn, line_id, org_id=org_id, **changes)


@router.post("/orgs/{org_id}/lines/{line_id}/end")
async def org_end_billing_line(
    org_id: str,
    line_id: str,
    user=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    """Stop charging for this line after the current month.

    ENDING IS SETTING `period_end`, NEVER DELETING THE ROW. A deleted line
    silently rewrites what an already-issued invoice was for, and
    `invoice_billing_lines.line_id ON DELETE RESTRICT` is that rule with teeth.

    THE MONTH IS NOT A PARAMETER. `end_line` accepts one and this route does not
    pass it, so the service falls back to `credits.current_period()` — and that
    is the point: the console states the month before the operator confirms ("it
    is billed through August 2026 and not after"), that sentence is built from
    UTC, and `current_period()` is the same UTC clock. A month the caller could
    send is a month a caller could send differently from the sentence somebody
    agreed to, and this is money.

    Ending an already-ended line returns it unchanged rather than refusing: a
    double-click on a confirm dialog is a retry, and the state the operator asked
    for is the state that exists. Ending a one-off, or the platform line, is
    refused — the service says why in each case.
    """
    pool = await get_pool()
    await _org_or_404(pool, org_id)

    end_line = _attr("end_line")

    with _billing_schema():
        async with pool.acquire() as conn:
            async with conn.transaction():
                return await end_line(
                    conn, line_id, org_id=org_id, actor_id=user["user_id"],
                )


@router.get("/orgs/{org_id}/invoice-preview")
async def org_invoice_preview(
    org_id: str,
    period: Optional[str] = Query(None, description="YYYY-MM; defaults to this month"),
    _=Depends(require_platform_role(*BILLING_CONSOLE_ROLES)),
):
    """The lines due for one month, and the ones an invoice already carries.

    This is the endpoint that makes an invoice a query rather than a total
    somebody typed. It CHANGES NOTHING and reserves nothing: `already_billed`
    becomes true only when an invoice is actually issued and
    `staging.invoice_billing_lines` is written, so two operators previewing the
    same month both see the same lines and the second invoice is refused by
    `uq_ibl_line_period` rather than by this read.

    Nothing here gates provisioning and nothing here is required to raise an
    invoice. Kartavaya's clients agree terms verbally; an invoice stays creatable
    standalone, hand-typed rows sit beside loaded ones, and an invoice with no
    lines at all is a valid invoice.
    """
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _preview_body(org_id, period)
    return {**body, "org_name": org["name"],
            "is_platform_org": bool(org["is_platform_org"])}
