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

and, since an AWS alert nobody could answer, the third half — WHAT WE ACTUALLY
DID FOR IT:

    WHAT WAS SENT, BY PURPOSE   →  /outbound
    DID THIS PERSON GET IT      →  /outbound/messages?recipient=
    WHAT FAILED, AND WHY        →  /outbound/messages?outcome=failed

That belongs beside the usage tabs and not on a console of its own, because it
is the same shape of question those tabs answer — what did this cost, and what
was actually done for it. A bill with no record of the work is an argument.

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
names are `staging.organisations`, `staging.user_roles`, `public.users` and
`staging.outbound_log`, none of which hold money.

THAT FOURTH ONE IS A DELIBERATE EXCEPTION AND NOT A DRIFT. `services/
outbound_log.py` writes a narrower rule than the credit one and writes it in its
own header: no file outside it may INSERT, UPDATE or DELETE, and READS ARE OPEN,
"because a wrong read is a wrong number on one page, while a second writer is
what makes the ledger itself untrustworthy." It also offers no read surface to
call — `write`, `flush`, `pending`, `dropped`, and nothing else. The banner over
that section says the rest.
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


# ══════════════════════════════════════════════════════════════════════════
# WHAT WAS ACTUALLY SENT — staging.outbound_log
#
# WHY THIS EXISTS. An AWS alert said 2,586 of 3,000 SES message units were gone
# for the month and nobody could say what they had been spent on. The honest
# answer took an hour of inference from payslip rows and was still only a floor,
# because NOTHING IN THIS PRODUCT RECORDED A SEND. What that hour found — a
# payroll run mailing every employee a payslip on every run, sixteen runs
# against an org of 71 people, all ~960 to `@example.com`, which RFC 2606
# reserves and which can therefore only ever hard-bounce against the SES
# identity production shares — was invisible while it happened. Railway rotates
# logs per deployment, so the "Email sent via SES" lines are gone too.
#
# Migration 098 makes it a table. This section is its reader, and answers
# exactly three questions:
#
#     WHAT HAS THIS ORG BEEN SENT THIS PERIOD, BY PURPOSE  → /outbound
#     DID **THIS RECIPIENT** GET IT, AND WHEN              → /outbound/messages
#     WHAT FAILED, AND WHY                                 → /outbound/messages
#
# ── WHY THIS ROUTER SELECTS THE TABLE DIRECTLY ─────────────────────────────
#
# It is the one thing in this file that reads a table it does not own, and it is
# not an oversight. `services/outbound_log.py` states the rule in its own
# header: "No file outside this one may INSERT, UPDATE or DELETE
# `staging.outbound_log`. Reads are open — a screen or a report may SELECT it
# freely — because a wrong read is a wrong number on one page, while a second
# writer is what makes the ledger itself untrustworthy."
#
# That is a narrower rule than the credit one, and deliberately so. There is
# also no read surface on that module to call: it offers `write`, `flush`,
# `pending` and `dropped`, and nothing else. Inventing a set of read functions
# there would have meant this router depending on names nobody had written,
# which is the exact defect this round keeps paying for.
#
# WHAT IS COPIED RATHER THAN INVENTED. 098's verification block spells its own
# queries out — (a) what did we send this org, (b) did this person get it, (c)
# what failed and what never came back — and each carries a trap it also spells
# out. They are honoured here rather than reinvented:
#
#   · `lower(recipient) = lower($n)`, NEVER `recipient = $n`. The index is
#     FUNCTIONAL, on `lower(recipient)`. The plain form is a sequential scan AND
#     WRONG in the ordinary case — an address stored `Keval.Shah@Example.com`
#     and searched lowercase returns zero rows, and "we never emailed them" is
#     the worst answer this table can give.
#   · `channel` and `purpose` are BARE COLUMNS. The writer already maps
#     `push:expo` onto channel 'push' + provider 'expo' and already derives the
#     purpose from a `ref` before either reaches the table, so a `split_part`
#     here would be undoing work that has been done — and would silently return
#     the whole value on the first purpose that contains a colon.
#   · `detail->>'mode'` for the kill-switch mode and `detail->>'ref'` for the
#     full `payslip:PS-2026-08-42`. There is no `mode` column; `detail` is the
#     only place the row says whether the process was in `OUTBOUND_MODE=dry`,
#     and staging and production write to the SAME schema, so without it the two
#     are indistinguishable in this table.
#   · `ORDER BY ts DESC, id DESC`. `ts` is stamped per row in Python, so a batch
#     can carry two rows on the same microsecond; without the tiebreaker two
#     reloads of one window can order them differently.
#
# `detail` IS READ FOR TWO NAMED KEYS AND NEVER RETURNED WHOLE. It is the one
# free-form container on this table, and 098's "NO BODIES" section is entirely
# about what ends up in a free-form container when somebody is debugging in a
# hurry. Selecting `detail` here would put whatever that turns out to be onto a
# screen a client's own admin can open.
#
# ── FOUR THINGS THIS MUST NOT SAY ──────────────────────────────────────────
#
# 1. SUPPRESSED IS NOT SENT. `OUTBOUND_MODE=dry` is set on staging, so on
#    staging every row is suppressed and NOTHING LEFT THE BUILDING. That is the
#    correct outcome there and it is not a failure — but it is also not a send.
#    Folding it into a "sent" figure is the exact confusion that once made a
#    campaign report "3 sent" for a send that went nowhere. The buckets below
#    are never summed into a headline.
#
#    THE RULE COVERS THE MONEY FIGURE TOO, and that is where it was first
#    broken. The message-unit total summed every email row whatever its status
#    and whatever its mode, so a simulated E2E payroll — 1,136 rows the kill
#    switch stopped — put 2,272 "Email message units" on that org's screen
#    beside a "Suppressed: 1,136" tile, for messages that never left. A charge
#    is `status='sent' AND detail->>'mode'='live'`, which is 098's own
#    verification query (d); `_units_bucket` is that predicate and the three
#    named reasons a row fails it.
#
# 2. SENT IS NOT DELIVERED, AND A PROVIDER MESSAGE ID IS THE ONLY EVIDENCE.
#    `sent` means the provider ACCEPTED it; SES accepted all 960 payslips and
#    bounced them seconds later. `message_id` is the only string tying a row
#    here to a record on the provider's side, so `confirmed` — sent AND carrying
#    an id — is reported beside `sent` and never instead of it.
#
# 3. ROWS BEFORE THE LOG EXISTED DO NOT EXIST. Every body carries
#    `recording_since` and `covers_whole_period`. A month that began before
#    recording did is a FLOOR and is labelled one.
#
# 4. A SEND WITH NO ORG IS NOT THIS ORG'S SEND. `org_id` is nullable and NULL is
#    a real answer — an invitation, a password reset and a magic link all go out
#    before any org context exists. `org_id = $1` excludes them, which is the
#    only safe scoping (an address is not a tenant), and every body says so
#    through `excludes_orgless` rather than letting the omission pass as a zero.
#
# ── TENANCY: THE SAME GATE, NOT A SECOND ONE ───────────────────────────────
#
# `/me/*` is `get_org_id` + ORG_SETTINGS_ROLES; `/orgs/{org_id}/*` is an
# explicit path org + FINANCE_CONSOLE_ROLES. Identical to the usage reads above,
# without variation. These rows name a client's employees and customers by
# address, so the NARROWER of the two console sets is right — and
# `/usage/people` already hands that same audience the org's member names and
# addresses through the same door, so this is the existing boundary, not a new
# one.
#
# `user_id` IS DELIBERATELY NOT RETURNED. It holds whoever caused the send, and
# for anything Aekam triggered on a client's behalf that is an Aekam staff id —
# the same leak `billing_lines._row_to_line` redacts with `actors=False`. None
# of the three questions asks who pressed the button, so the column is not read
# rather than read and then filtered, which is the version that cannot regress.
# ══════════════════════════════════════════════════════════════════════════

#: The table this section reads and never writes. Named once, here, so a schema
#: change has one place to land. `services/outbound_log.py` is the only writer.
_OUTBOUND = "staging.outbound_log"

#: The status vocabulary. FOUR WORDS, and 098 makes them a CHECK named
#: `outbound_log_status_ck` — `('queued','sent','suppressed','failed')` — so
#: this tuple is not a guess about what the column might hold, it is the
#: constraint restated.
#:
#: `attempted` IS NOT AMONG THEM, and that is worth writing down because the
#: writer still exports the name: `services/outbound_log.py` defines
#: `STATUS_ATTEMPTED = STATUS_QUEUED = "queued"` for the senders that were
#: written before the word settled. Both names produce the same legal row, so
#: the only value that can ever reach this reader is `queued`. Offering
#: `attempted` as a filter would open an empty drill-down, which on this screen
#: reads as "there is nothing there".
_QUEUED = "queued"

#: Every status this reader knows how to bucket. Anything else still appears —
#: see `_bucket` — it simply appears under its own name.
_KNOWN_STATUSES = ("sent", "suppressed", "failed", _QUEUED)


def _bucket(status: Optional[str]) -> str:
    """Which counter a status row lands in.

    An UNKNOWN status returns `other` rather than being dropped. Today the CHECK
    makes one impossible — but 098 spells out how to widen that constraint
    (`DROP CONSTRAINT`, re-add `NOT VALID`, `VALIDATE` later) precisely so the
    vocabulary CAN grow without a table scan, and it does the same for `channel`
    with 'sms' and 'voice' named as the likely next ones. A reader that answered
    only the four words it was born knowing would under-report from the moment
    that happened, and silent under-reporting is the disease this whole table
    treats. `by_status` beside it carries the raw name, so a new word is visible
    on the screen the day it first appears and before anybody teaches this file
    about it.

    `queued` is bucketed as `unanswered`, which is what it means to a reader:
    the gate opened and the provider never answered. 098 is emphatic that a row
    still in that state is ITSELF THE FINDING — the process died between the
    provider call and the answer — so it is counted separately and never folded
    into either `sent` or `failed`.
    """
    if status == _QUEUED:
        return "unanswered"
    if status in ("sent", "suppressed", "failed"):
        return status
    return "other"


#: SES bills in message units: one per 256 KB, `GREATEST(1, ceil(bytes/262144))`
#: per message, minimum one. 098 states it and refuses to store it as a
#: generated column, because that would bake a third party's constant into the
#: biggest table in the product. So it is computed in the query, here, once.
#:
#: `GREATEST(1, NULL)` IS 1 IN POSTGRES — GREATEST ignores NULLs — so a row with
#: no measured size quietly contributes one unit. That is why `unmeasured` is
#: selected alongside it and why every surface reports the pair. A units total
#: on its own is a floor being read as a total, which is the original sin here.
#:
#: THIS SUMS EVERY ROW IN ITS GROUP AND IS THEREFORE NOT A BILL. The group is
#: (channel, purpose, status, mode), so the split by what a row actually cost
#: happens once, in `_units_bucket` below, against `status` and `mode` — the two
#: columns the group already carries. Doing it here instead would mean writing
#: the status vocabulary into the SQL as `FILTER (WHERE …)` clauses, which is the
#: second place it would live and the place nobody updates when a webhook adds a
#: word. The same argument the grouped read is built on.
_SES_UNITS = "sum(GREATEST(1, ceil(bytes / 262144.0)))::bigint"

#: The billable figure, and the name the rest of the file refers to it by. Every
#: other units counter is named for the reason it is NOT this one.
_BILLABLE = "ses_units_billable"

#: How much of the billable figure is a guess. Scoped to the billable rows and
#: nothing else — `unmeasured` beside it counts every channel, and push is NULL
#: by design, so the two are not interchangeable and must not be paired.
_BILLABLE_UNMEASURED = "ses_units_billable_unmeasured"


def _units_bucket(channel: Optional[str], status: Optional[str],
                  mode: Optional[str]) -> Optional[str]:
    """Which UNITS counter a row lands in, or None if it has no units at all.

    `_bucket` above answers "what happened to this message". This answers "did
    anyone charge us for it", and they are deliberately two functions rather
    than one, because the answers differ: a suppressed row and a sent row are
    both true records of an attempt, and only one of them is on an AWS invoice.

    THE CHANNEL TEST IS IN HERE AND NOT AT THE CALL SITE. `bytes` is NULL for
    push by design — Expo bills nothing by size — and `GREATEST(1, NULL)` is 1 in
    Postgres, so every push row silently weighs a message unit it can never cost.
    Held as a separate `if` beside the call, that guard is one edit away from
    being dropped while the arithmetic keeps working and quietly inflates again,
    which is this defect's own shape. Here, losing it means losing the bucket
    name, and a row with no bucket is added to nothing.

    FOLDING THEM TOGETHER IS WHAT THIS FIXES. Summing units over every email row
    regardless of `status` and `mode` put a client's simulated payroll run — 1,136
    rows the kill switch stopped, 2,272 message units — on a tile labelled "Email
    message units", beside a "Suppressed: 1,136" tile saying the opposite. On
    staging that is every row, because `OUTBOUND_MODE=dry` is set there and
    staging writes to the SAME schema production does.

    `billable` is 098's verification query (d) — the query the AWS alert was
    finally answered with — and nothing else: `channel = 'email'` (the caller's
    guard, since Expo bills nothing by size), `status = 'sent'`, and
    `detail->>'mode' = 'live'`. Copied rather than re-derived, for the same
    reason the `lower(recipient)` form is copied.

    THE OTHER THREE ARE NAMED RATHER THAN DISCARDED, because a suppressed send is
    real information: it is the difference between "we sent nothing" and "we were
    configured not to send", and a screen that can only show the first cannot
    tell an operator which one they are looking at. Together with `billable` they
    partition every email row in the window, so a reader can add them up and get
    the whole and never wonder where the rest went.

      · `suppressed` — the gate held. Cost nothing, and what it WOULD have cost.
      · `bypassed`   — mode says `dry` and the status says a provider answered.
                       098 calls this the kill-switch bypass and it has happened
                       twice. These almost certainly DID cost money, and they are
                       still not folded into `billable`: a row that contradicts
                       itself must not silently move a number somebody reconciles
                       against an invoice. `kill_switch_bypassed` counts the rows;
                       this counts what they weighed.
      · `unresolved` — everything left: refused by the provider (no charge), still
                       `queued` (the process died between the call and the answer,
                       so nobody knows), or a row stating no mode at all. NULL is
                       not `live`; claiming a charge on a mode we failed to read
                       is the same error as claiming a send we cannot prove.
    """
    if channel != "email":
        return None
    if status == "sent" and mode == "live":
        return _BILLABLE
    if status == "suppressed":
        return "ses_units_suppressed"
    # The same predicate `_outbound_body` counts rows under as
    # `kill_switch_bypassed`, restated here in units. Written once as a pair so
    # the two figures cannot come to describe different rows.
    if mode == "dry" and status in ("sent", "failed"):
        return "ses_units_bypassed"
    return "ses_units_unresolved"


def _bill_alias(counts: dict) -> dict:
    """Restate the billable figure under the name the screens already read.

    `ses_units` shipped meaning "units summed over every email row", which was
    not a bill and was rendered as one. It keeps the name and becomes the
    billable figure, rather than being removed, for one reason: `OutboundLog.jsx`
    reads `totals.ses_units` today, and of the two ways this change can reach a
    screen that has not been updated with it — a tile showing the right number,
    or a tile showing nothing — the first is plainly better. Nothing has to land
    in step for this fix to be correct.

    ASSIGNED, NEVER COMPUTED TWICE. Two copies of a money figure is how they come
    to differ, which is the argument the rest of this file makes about money
    rules; one assignment in one function is that argument obeyed. `ses_units`
    is initialised to 0 in `_blank_counts`, so a path that somehow skipped this
    under-reports rather than reporting the old inflated sum — the safe direction
    to fail in on a number a client reads as a charge.

    New code should read `ses_units_billable`. The unqualified name survives for
    the screens that predate the distinction and for no other purpose.
    """
    counts["ses_units"] = counts[_BILLABLE]
    return counts


@contextlib.contextmanager
def _outbound_schema():
    """Turn a missing table or a drifted column into a sentence, not a zero.

    The twin of `_billing_schema` above and matched the same way, on `sqlstate`
    rather than on an asyncpg class, so a wrapped driver or a test double
    behaves identically.

    IT CATCHES 42703 AS WELL AS 42P01, AND THAT SECOND CODE IS THE POINT.
    `services/outbound_log.py` treats `undefined_column` as a reason to go
    DORMANT: it discards its buffer, logs one warning and never writes again for
    the life of the process. 098's own header says what that costs — "a single
    renamed column here does not produce a stream of errors anybody would
    notice, it produces one line in a Railway log that rotates away, and then
    silence, which is precisely the condition this table exists to end."

    The READER must not fail the same way round. A column this file names and
    the table does not have would otherwise surface as an empty result, and an
    empty result on this screen reads as "nothing was sent" — the one sentence
    this entire feature exists to stop anyone saying without evidence. So it is
    a 503 that names the migration and says which two files to compare.
    """
    try:
        yield
    except HTTPException:
        raise
    except Exception as exc:                     # noqa: BLE001 — re-raised below
        state = getattr(exc, "sqlstate", None)
        if state not in ("42P01", "42703"):
            raise
        detail = (
            "The outbound log table does not exist in this database, so what "
            "this organisation has been sent cannot be read. Apply "
            "backend/migrations/098_outbound_log.sql."
            if state == "42P01" else
            "The outbound log table exists but does not have the columns this "
            "report reads, so no figure can be shown. Reporting nothing is "
            "deliberate: an empty result here would read as 'nothing was sent', "
            "and that is the claim this log exists to stop anyone making "
            "without evidence. Compare backend/migrations/098_outbound_log.sql "
            "with services/outbound_log.py — they are the two halves of this "
            "schema, and a mismatch silences the WRITER too, permanently and "
            "with one log line."
        )
        raise HTTPException(503, {
            "error": "outbound_log_unavailable",
            "message": detail + (
                " Credits, usage and billing lines are unaffected — they are "
                "different tables."
            ),
        }) from exc


def _purpose_label(purpose: Optional[str]) -> str:
    """The English a purpose is shown under.

    DERIVED, not tabulated, and that is a deliberate departure from
    `SOURCE_LABELS` at the top of this file. That map can be written down
    because `credits.SOURCE_KEYS` is a closed vocabulary on disk to check it
    against. `purpose` is the opposite BY DESIGN — 098 gives `channel` and
    `status` a CHECK and deliberately withholds one here, so that shipping a new
    notification does not also require a migration and, worse, so that shipping
    it without one does not lose the log row. A hand-written map here would be
    English invented for keys nobody has seen: half of it describing purposes
    that do not exist, and silently missing the ones that do.

    `password_reset` → "Password reset". Impossible to be wrong about, and it
    degrades to the raw key rather than to a guess.

    `unclassified` IS LEFT ALONE, deliberately. It is the writer's default for a
    sender that passes no purpose, and 098 asks for it to be watched — "if it is
    still most of the table in a month, question 1 cannot be broken down and
    this column is decoration". Dressing it up as "General" or "Other" is
    precisely how it would stop being watched.
    """
    if not purpose:
        # NOT "Other". 098 makes `purpose` NOT NULL, so an empty one means the
        # row was written by something other than the writer — a gap in the
        # record, and a gap must not be given a name that reads like a category.
        return "No purpose recorded"
    return purpose.replace("_", " ").strip().capitalize()


def _coverage(recording_since, since: datetime) -> bool:
    """Does the log cover the WHOLE window being reported?

    False when recording starts after the window does, and false when the log
    holds nothing for this org at all. The arithmetic lives here so both doors
    give the same answer and neither recomputes it from two ISO strings in a
    browser.

    A value this cannot read is treated as NOT covering. Claiming completeness
    on the strength of a timestamp we failed to parse is the one wrong answer
    available.
    """
    if recording_since is None:
        return False
    if isinstance(recording_since, str):
        try:
            recording_since = datetime.fromisoformat(
                recording_since.replace("Z", "+00:00"))
        except ValueError:
            return False
    if not isinstance(recording_since, datetime):
        return False
    if recording_since.tzinfo is None:
        recording_since = recording_since.replace(tzinfo=timezone.utc)
    return recording_since <= since


def _iso_ts(value) -> Optional[str]:
    return value.isoformat() if isinstance(value, datetime) else value


def _blank_counts() -> dict:
    """Every counter a totals block or a purpose row carries, all starting at 0.

    THE FOUR `ses_units_*` KEYS PARTITION THE EMAIL ROWS and are the whole point
    of `_units_bucket`: one figure that is a charge, three that are not, each
    named for why. They are returned even when zero so a screen can render the
    breakdown without deciding what an absent key meant.

    `unmeasured` counts EVERY channel and `ses_units_billable_unmeasured` counts
    only the rows inside the billable figure. Both are here and they are not the
    same number — push carries no `bytes` by design, so the first is inflated by
    rows that were never going to weigh anything and is not the companion to a
    message-unit total. The second is.
    """
    return {"sent": 0, "confirmed": 0, "suppressed": 0, "failed": 0,
            "unanswered": 0, "other": 0, "total": 0,
            # The old name, kept and reassigned by `_bill_alias`. See there.
            "ses_units": 0, "unmeasured": 0,
            _BILLABLE: 0, _BILLABLE_UNMEASURED: 0,
            "ses_units_suppressed": 0, "ses_units_bypassed": 0,
            "ses_units_unresolved": 0}


async def _outbound_body(org_id: str, period: Optional[str]) -> dict:
    """What this org has been sent in one period, one row per purpose.

    ONE GROUPED READ plus one `min(ts)`, and the pivot is done here rather than
    in SQL. That is on purpose: the shape the screen needs is a row per
    (purpose, channel family) carrying five named counters, and expressing that
    as `FILTER (WHERE status = …)` clauses would write the status vocabulary
    into the query — a second place it lives, and the place nobody would think
    to update when a webhook adds `bounced`. Grouping by the raw status and
    bucketing in Python means an unknown word lands in `other` and in
    `by_status` instead of vanishing.

    `mode` is in the grouping too, for one row of arithmetic worth the extra
    key: 098's verification query (e) is "did anything bypass the kill switch",
    which must return zero rows on staging forever and has already been non-zero
    twice — both times a sender that built its own MIME and called SES directly.
    Carrying the `dry`/`live` split also lets the screen say "every send this
    period was suppressed because the process was in dry mode", which is the
    difference between a reassuring screen and an alarming one.

    AND IT IS WHAT MAKES THE MESSAGE-UNIT FIGURE A CHARGE. `mode` was already in
    the grouping and was already read into `by_mode`, and the units total beside
    it still summed every email row — so a period in which nothing left the
    building reported the message units of everything that would have. The
    counters are split by `_units_bucket` for that reason and only `ses_units_
    billable` is a bill; see that function for what the other three are for.
    """
    label, start, end, since, until = _period_window(period)
    pool = await get_pool()

    with _outbound_schema():
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                # 098's verification query (a), grouped by `mode` as well so
                # that (e) — the kill-switch check — falls out of the same read.
                # `channel` and `purpose` are BARE COLUMNS: the writer maps
                # `push:expo` to channel 'push' + provider 'expo' and derives
                # the purpose from a `ref` before either reaches the table, so
                # `split_part` here would be undoing work already done and would
                # silently return the whole value the day a purpose contains a
                # colon.
                f"SELECT channel, "
                f"       purpose, "
                f"       status, "
                f"       detail->>'mode'                              AS mode, "
                f"       count(*)                                     AS n, "
                f"       count(*) FILTER "
                f"         (WHERE provider_message_id IS NOT NULL)    AS with_id, "
                f"       {_SES_UNITS}                                 AS units, "
                f"       count(*) FILTER (WHERE bytes IS NULL)        AS unmeasured, "
                f"       max(ts)                                      AS last_at "
                f"  FROM {_OUTBOUND} "
                # `org_id = $1` and not `IS NOT DISTINCT FROM`: a NULL org_id is
                # a send belonging to no tenant and must never be attributed to
                # one. See `excludes_orgless` below.
                f" WHERE org_id = $1::uuid "
                f"   AND ts >= $2::timestamptz AND ts < $3::timestamptz "
                f" GROUP BY 1, 2, 3, 4",
                org_id, since, until,
            )
            recording_since = await conn.fetchval(
                f"SELECT min(ts) FROM {_OUTBOUND} WHERE org_id = $1::uuid",
                org_id,
            )

    totals = _blank_counts()
    by_status: dict[str, int] = {}
    by_mode: dict[str, int] = {}
    # A send made in dry mode that nevertheless reports a provider outcome. 098
    # calls this the kill-switch bypass and it has happened twice; it is counted
    # here rather than left merely queryable, so nobody has to think to look.
    bypassed = 0
    groups: dict[tuple, dict] = {}

    for r in rows:
        key = (r["purpose"], r["channel"])
        group = groups.setdefault(key, {
            **_blank_counts(),
            "purpose": r["purpose"], "channel": r["channel"], "last_at": None,
        })
        n = int(r["n"] or 0)
        bucket = _bucket(r["status"])
        for target in (group, totals):
            target[bucket] += n
            target["total"] += n
            target["unmeasured"] += int(r["unmeasured"] or 0)
            if bucket == "sent":
                target["confirmed"] += int(r["with_id"] or 0)
            # UNITS ARE EMAIL ONLY AND ARE SPLIT BY WHAT THEY COST. Both rules
            # live in `_units_bucket`, which returns the counter this row belongs
            # in or None when it has no units to give — see there for why the
            # channel test is not an `if` sitting out here. Every email row lands
            # in exactly one of the four, so the four sum to the units of every
            # email row in the window and a reader can reconcile them.
            where = _units_bucket(r["channel"], r["status"], r["mode"])
            if where:
                target[where] += int(r["units"] or 0)
                # The floor companion, scoped to the billable rows ALONE. Paired
                # with `unmeasured` — which counts push, whose size is NULL by
                # design — the message-unit tile would caption a charge with an
                # uncertainty drawn from rows that carry no charge.
                if where == _BILLABLE:
                    target[_BILLABLE_UNMEASURED] += int(r["unmeasured"] or 0)
        if group["last_at"] is None or (
                r["last_at"] and r["last_at"] > group["last_at"]):
            group["last_at"] = r["last_at"]
        by_status[r["status"]] = by_status.get(r["status"], 0) + n
        by_mode[r["mode"]] = by_mode.get(r["mode"], 0) + n
        if r["mode"] == "dry" and r["status"] in ("sent", "failed"):
            bypassed += n

    # ONE PLACE, BOTH SHAPES. The totals block and every purpose row carry the
    # same counters, so they must carry the same `ses_units` — a headline that
    # meant one thing and a row that meant another is worse than either.
    _bill_alias(totals)
    purposes = sorted(
        (
            _bill_alias({**g, "label": _purpose_label(g["purpose"]),
                         "last_at": _iso_ts(g["last_at"])})
            for g in groups.values()
        ),
        key=lambda g: (-g["total"], g["label"]),
    )

    return {
        "org_id": org_id,
        "period": label,
        "period_start": start.isoformat(),
        # Exclusive, exactly as `_sources_body` reports it. Named as it behaves
        # so a caller does not render it as "the last day" and lose a day.
        "period_end": end.isoformat(),
        "recording_since": _iso_ts(recording_since),
        # The honesty field. A partial month reported as a total is how a floor
        # becomes a number somebody plans against — which is the whole reason
        # this table was built.
        "covers_whole_period": _coverage(recording_since, since),
        # Always true, and returned rather than assumed: an invitation, a
        # password reset and a magic link go out before an org exists and carry
        # no org, so they are in none of these figures.
        "excludes_orgless": True,
        "totals": totals,
        "by_status": by_status,
        "by_mode": by_mode,
        # ROWS, not units. `totals.ses_units_bypassed` is the same rows weighed;
        # the pair is deliberate, because "two messages bypassed the switch" and
        # "those two were 40 message units" are different sizes of the same
        # problem and only the second reconciles against an invoice.
        "kill_switch_bypassed": bypassed,
        "purposes": purposes,
        # WHICH FIGURE IS A CHARGE, said in the body and not only in this file.
        # `ses_units_billable` — on `totals` and on every purpose row — is the
        # only counter here that cost money; the three `ses_units_*` beside it
        # are each named for the reason they did not. Sent as data rather than
        # left implicit so a screen can caption a number with the predicate
        # behind it instead of writing the predicate down a second time, which
        # is the same rule this body already follows for `statuses`.
        "ses_units_basis": {
            "billable_key": _BILLABLE,
            "channel": "email",
            "status": "sent",
            "mode": "live",
            "not_billable_keys": ["ses_units_suppressed", "ses_units_bypassed",
                                  "ses_units_unresolved"],
            # `ses_units` is `ses_units_billable` under the name that shipped
            # first. It is the same number by construction — see `_bill_alias`.
            "legacy_key": "ses_units",
        },
        # The vocabulary the drill-down may be filtered by, sent so the screen
        # does not write it down itself — the rule `UsageBySource.jsx` already
        # keeps about the tab list. A status this file does not know about still
        # reaches the screen through `by_status`.
        "statuses": list(_KNOWN_STATUSES),
    }


async def _outbound_messages_body(
    org_id: str, period: Optional[str], purpose: Optional[str],
    status: Optional[str], recipient: Optional[str], limit: int,
) -> dict:
    """The rows behind one figure — or every send this org made to one address.

    TWO SCOPES, ONE ENDPOINT, AND THE PERIOD IS DROPPED FOR ONE OF THEM.

    "Did this person get their payslip?" is not a question about a month. The
    person asking has been told by an employee that nothing arrived and does not
    know which run it was in; making them guess the month first turns one lookup
    into six. So when `recipient` is given the window is EVERY SEND THIS ORG
    HOLDS for that address, newest first, and `scope` says `recipient` while
    `period` comes back NULL — the body never reports a month it did not query,
    which is the only way to stop a screen captioning it with one.

    `lower(target) = lower($n)` AND NOT `target = $n`. 098 calls this the
    sharpest edge in the file and it is: the index is functional on
    `lower(target)`, the plain form is a sequential scan, and it is WRONG in the
    ordinary case — an address stored `Keval.Shah@Example.com` searched
    lowercase returns zero rows, and "we never emailed them" is the worst answer
    this table can give.

    STILL SCOPED TO THE ORG, even for a recipient lookup. An email address is
    not a tenant: the same address can appear in two orgs, and a lookup that
    crossed would hand one client another client's sending. The cost is stated
    rather than hidden — `excludes_orgless` is true here too, so an invitation
    sent to that address before they joined is genuinely not shown, and the
    screen says so instead of letting the absence read as "never contacted".

    THE ADDRESS TRAVELS IN A QUERY STRING, which means it lands in access logs.
    That is a real cost, accepted rather than overlooked: this is a GET a
    support person needs to re-run, bookmark and paste into a ticket, and it is
    the org's own address shown to that org's own admin. Nothing here widens who
    may read it.
    """
    purpose = (purpose or "").strip() or None
    recipient = (recipient or "").strip() or None
    status = (status or "").strip() or None
    if status is not None and status not in _KNOWN_STATUSES:
        # Refused by NAME, the same refusal `_known_source` makes and for the
        # same reason: an empty result would read as "nothing of that kind
        # happened". `delivered` is the value a caller reaches for first and is
        # exactly the one this log cannot answer.
        raise HTTPException(404, {
            "error": "unknown_status",
            "message": (
                f"'{status}' is not a recorded status. The statuses are: "
                f"{', '.join(_KNOWN_STATUSES)}. Delivery to a mailbox is not "
                f"among them — nothing in this product hears back from one, so "
                f"the log records what left here and never claims what arrived. "
                f"The vocabulary is owned by services/outbound_log.py; a word "
                f"added there has to be added here too."
            ),
        })

    # `$1` is always the org. Every other placeholder number is DERIVED from the
    # length of the argument list as it is built, never counted by hand — an
    # off-by-one here silently filters on the wrong value.
    where = ["org_id = $1::uuid"]
    args: list[Any] = [org_id]
    label = start = end = None

    # EVERY PLACEHOLDER IS CAST EXPLICITLY. `lower($n)` on its own is not
    # unambiguous SQL — Postgres also carries `lower(anyrange)` and, since 14,
    # `lower(anymultirange)`, so an untyped parameter there is resolved by the
    # type-category rules rather than by anything this file states. It resolves
    # to text today; `::text` means it cannot stop doing so on an upgrade, and
    # the failure it would prevent is a prepare-time error on the one query
    # somebody runs to find out whether a payslip went missing.
    if recipient:
        args.append(recipient)
        where.append(f"lower(recipient) = lower(${len(args)}::text)")
    else:
        label, start, end, since, until = _period_window(period)
        args.append(since)
        where.append(f"ts >= ${len(args)}::timestamptz")
        args.append(until)
        where.append(f"ts < ${len(args)}::timestamptz")

    if purpose:
        args.append(purpose)
        where.append(f"purpose = ${len(args)}::text")
    if status:
        args.append(status)
        where.append(f"status = ${len(args)}::text")

    args.append(limit)
    limit_ph = f"${len(args)}::bigint"

    pool = await get_pool()
    with _outbound_schema():
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                # 098's verification queries (b) and (c), merged — they differ
                # only in their WHERE clause and this endpoint serves both.
                #
                # `user_id` is deliberately absent; see the banner. Everything
                # else 098 stores is here, because this is the drill-down and a
                # column withheld from it is a column somebody has to open psql
                # for. `detail` is read for its two named keys ONLY — `mode` and
                # `ref` — and never returned whole: it is the one free-form
                # container on this table, and the whole argument of 098's "NO
                # BODIES" section is that a free-form container is where a
                # provider's entire response object ends up at 2am.
                f"SELECT id, ts, channel, purpose, recipient, subject_or_title, "
                f"       status, provider, provider_message_id, bytes, error, "
                f"       detail->>'mode' AS mode, detail->>'ref' AS ref "
                f"  FROM {_OUTBOUND} "
                f" WHERE {' AND '.join(where)} "
                # `id DESC` as the tiebreaker, which 098 asks for by name: `ts`
                # is stamped per row in Python and a batch can hold two rows on
                # the same microsecond, so without it two reloads of the same
                # window can order them differently and a reader thinks a row
                # moved.
                f" ORDER BY ts DESC, id DESC "
                f" LIMIT {limit_ph}",
                *args,
            )

    data = [
        {
            "id": str(r["id"]),
            "created_at": _iso_ts(r["ts"]),
            "channel": r["channel"],
            # `target` and not `recipient`, which is 098's column name. The
            # screen already carries a `recipient` — the address that was
            # SEARCHED FOR — and two fields one word apart, one a query and one
            # a result, is how a filter comes to be rendered as a row.
            "target": r["recipient"],
            "subject": r["subject_or_title"],
            "status": r["status"],
            "provider": r["provider"],
            "provider_message_id": r["provider_message_id"],
            "bytes": r["bytes"],
            "purpose": r["purpose"],
            # The full `payslip:PS-2026-08-42`, which is what identifies the
            # actual document. It lives in `detail.ref` and is NULL for a sender
            # that passed only a bare purpose.
            "ref": r["ref"],
            "error": r["error"],
            "mode": r["mode"],
        }
        for r in rows
    ]

    return {
        "org_id": org_id,
        "scope": "recipient" if recipient else "period",
        "period": label,
        "period_start": start.isoformat() if start else None,
        "period_end": end.isoformat() if end else None,
        "purpose": purpose,
        "purpose_label": _purpose_label(purpose) if purpose else None,
        "status": status,
        "recipient": recipient,
        "excludes_orgless": True,
        "data": data,
        # `>=` and not `>`, exactly as `_transactions_body` does it. A page that
        # happens to hold exactly `limit` rows is reported as truncated, because
        # claiming completeness we cannot prove without a second count is the
        # wrong error to make on the screen somebody opened to find out whether
        # a send went missing.
        "truncated": len(data) >= limit,
    }


# ── The org's own sends — /me/outbound ──────────────────────────────────────

@router.get("/me/outbound")
async def my_outbound(
    period: Optional[str] = Query(None, description="YYYY-MM; defaults to this month"),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """What THIS organisation has been sent this period, by purpose.

    The org is `get_org_id` and nothing else — there is no path, query or body
    field on this route that could name another.
    """
    return await _outbound_body(org_id, period)


@router.get("/me/outbound/messages")
async def my_outbound_messages(
    period: Optional[str] = Query(None),
    purpose: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    recipient: Optional[str] = Query(
        None, description="One address. Ignores `period` — see the body's `scope`.",
    ),
    limit: int = Query(200, ge=1, le=500),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """The individual sends behind one figure, or every send to one address."""
    return await _outbound_messages_body(
        org_id, period, purpose, status, recipient, limit,
    )


# ── Aekam over any org — /orgs/{org_id}/outbound ────────────────────────────
#
# FINANCE_CONSOLE_ROLES, matching the usage reads above and NOT the billing set
# the lines use. Two reasons pointing the same way. It is a usage read — what
# was done for the money — so it belongs with `/usage/sources` rather than with
# the negotiated terms. And finance is the NARROWER of the two console sets:
# these rows name a client's employees and its customers by address, and
# widening that to `platform_manager` and `account_manager` would be a new
# boundary invented on a reporting screen.

@router.get("/orgs/{org_id}/outbound")
async def org_outbound(
    org_id: str,
    period: Optional[str] = Query(None),
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    org = await _org_or_404(pool, org_id)
    body = await _outbound_body(org_id, period)
    return {**body, "org_name": org["name"],
            "is_platform_org": bool(org["is_platform_org"])}


@router.get("/orgs/{org_id}/outbound/messages")
async def org_outbound_messages(
    org_id: str,
    period: Optional[str] = Query(None),
    purpose: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    recipient: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _=Depends(require_platform_role(*FINANCE_CONSOLE_ROLES)),
):
    pool = await get_pool()
    await _org_or_404(pool, org_id)
    return await _outbound_messages_body(
        org_id, period, purpose, status, recipient, limit,
    )
