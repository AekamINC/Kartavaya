"""
org_invites.py — an organisation invites its own people.

Before this, it could not. The only invite endpoint was `POST /api/admin/invites`
behind Aekam's platform console, and `org_members.add_member` refuses anyone
without an existing account. With no public registration, every new user at every
customer required Aekam personally. This closes that.

Three things this deliberately does differently from the platform console:

  1. **The token is returned exactly once, to its creator.** `GET /api/admin/invites`
     used to select `i.token` and hand back a ready-made accept link for every
     pending invite on the platform, to anyone in CONSOLE_ROLES — and
     `POST /auth/accept-invite` asks for nothing but that token, then sets whatever
     password the caller supplies. That listing was a page of live credentials.
     The list endpoint here has no field to leak one from.

  2. **A seat is reserved by the invite, not by the acceptance.** Counting only
     accepted members lets an org at its cap send unlimited invites and discover
     the ceiling only when people start bouncing off it. Pending invites count.

This file is also where the ONE seat counter lives — `count_seats`,
`seat_limit_detail` and `assert_seat_available` below. It is the only place in
the product that decides whether an org has room for one more person, and every
writer that can put someone into an org calls it: this module, both console
paths in `admin_orgs`, `org_members.add_member`, and `POST /auth/accept-invite`.
It lives here rather than in `admin_orgs` because `auth_router` needs it too and
`admin_orgs` imports `auth_router`.

  3. **Nobody can invite above themselves.** An org_admin cannot mint an
     org_owner, and cannot grant `approver` on a separated-duty module — that
     would let the person who defines what people are paid create the person who
     releases the money, which is the exact pair the separation exists to keep
     apart.
"""
import os
import uuid
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth_router import require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    ALL_MODULES,
    DEFAULT_GRANT_LEVEL,
    default_level_for,
    grant_needs_owner_authority,
    ORG_SETTINGS_ROLES,
    SEAT_CONSUMING_ORG_ROLES,
    refuse_grant,
)

router = APIRouter(prefix="/api/v1/org/invites", tags=["org-invites"])

# The APP, not the marketing site. See email_service.FRONTEND_URL.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://app.kartavaya.com").rstrip("/")

#: Roles an org may hand out. `org_owner` is here but gated below — only an
#: existing owner may grant it.
INVITABLE_ROLES: tuple[str, ...] = ("org_owner", "org_admin", "org_member")

#: Anything that occupies a seat. Imported rather than retyped: this list
#: existed in FOUR places — here, `admin_orgs.ORG_MEMBER_ROLES` and two inline
#: literals in `org_members` — and they held the same three codes the whole
#: time. Four copies that agree are one edit away from disagreeing, and the
#: direction this one fails in is a seat that is counted by the door the
#: customer knocks at and not by the one behind it.
#:
#: `SEAT_CONSUMING_ORG_ROLES` and NOT `ORG_ROLES` from Wave 3 on. The Tier-2
#: model now has five codes and they do not all cost the same:
#:
#:   hr_admin                 IS a seat. They sign in and use the product, and a
#:                            role reaching two modules for free is a way to buy
#:                            Manav without paying for it.
#:   org_client, aekam_team   are NOT. Owner's decision — a client seeing their
#:                            own project, and an Aekam colleague working on it,
#:                            cost the customer nothing. They are free BECAUSE
#:                            they reach no module at all
#:                            (`role_tiers.PROJECT_ONLY_MODULES`), which is the
#:                            half of the bargain that must not be traded away.
#:
#: The two sets are identical today — no row in the live database holds any of
#: the three new codes — so this changes no count until the first grant.
SEAT_ROLES: tuple[str, ...] = SEAT_CONSUMING_ORG_ROLES

INVITE_TTL_DAYS = 7


class GrantIn(BaseModel):
    code: str
    #: Empty, NOT `DEFAULT_GRANT_LEVEL`. A concrete default here is truthy, so
    #: the `g.role or …` below could never fire and the per-module default was
    #: unreachable — an omitted level would silently become `viewer` even for a
    #: module whose new grants start higher. Resolved at the call site instead,
    #: where the module code is in hand.
    role: str = ""


class InviteCreate(BaseModel):
    email: EmailStr
    org_role: str = Field(default="org_member")
    full_name: Optional[str] = None
    module_grants: List[GrantIn] = Field(default_factory=list)


class OrgInviteOut(BaseModel):
    """No `token` field, and that is the point — see the module docstring."""
    invite_id: str
    email: str
    org_role: str
    full_name: Optional[str] = None
    module_grants: List[GrantIn] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    invited_by: Optional[str] = None


class InviteCreated(OrgInviteOut):
    """Returned only from POST, only to the person who just created it."""
    invite_link: str


async def _caller_org_role(pool, user_id: str, org_id: str) -> Optional[str]:
    return await pool.fetchval(
        "SELECT role_code FROM public.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[]) "
        "ORDER BY array_position($3::text[], role_code) LIMIT 1",
        user_id, org_id, list(SEAT_ROLES),
    )


async def _assert_may_grant_role(pool, user_id: str, org_id: str, target_role: str) -> None:
    """No one hands out authority they do not hold.

    God mode reaches here with no org row at all — `require_org_role` already let
    them through, and they may grant anything.
    """
    if target_role not in INVITABLE_ROLES:
        raise HTTPException(400, f"Invalid role: {target_role}. Valid: {', '.join(INVITABLE_ROLES)}")

    caller_role = await _caller_org_role(pool, user_id, org_id)
    if caller_role is None:
        return  # platform/god-mode: require_org_role vouched for them

    if target_role == "org_owner" and caller_role != "org_owner":
        raise HTTPException(
            403,
            "Only an organisation owner can invite another owner.",
        )


async def _validate_grants(pool, org_id: str, grants: List[GrantIn],
                           caller_role: Optional[str]) -> list[dict]:
    """Every grant must name a real module the org actually has, at a level that
    module allows — and an admin may not mint an approver on a separated-duty
    module.
    """
    if not grants:
        return []

    active = {
        r["module_code"]
        for r in await pool.fetch(
            "SELECT module_code FROM public.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active = TRUE",
            org_id,
        )
    }

    # Whether this org has an owner at all, read once and only if some grant
    # turns on it. Unicode Group has four org_admins and no org_owner, so
    # without this the invite path refuses a payroll approver in an org that has
    # no other way to appoint one — see `role_tiers.refuse_grant`.
    org_has_owner = True
    if any(
        grant_needs_owner_authority(
            g.code, g.role or default_level_for(g.code), caller_org_role=caller_role,
        )
        for g in grants
    ):
        org_has_owner = bool(await pool.fetchval(
            "SELECT 1 FROM public.user_roles "
            "WHERE org_id=$1::uuid AND role_code='org_owner' LIMIT 1",
            org_id,
        ))

    out: list[dict] = []
    for g in grants:
        # Module-aware: Sanvaad starts at editor because a viewer there cannot
        # post, and inviting someone to a chat they cannot speak in is a broken
        # invitation. See role_tiers.NEW_GRANT_LEVEL_BY_MODULE.
        code, level = g.code, (g.role or default_level_for(g.code))

        if code not in ALL_MODULES:
            raise HTTPException(400, f"Unknown module: {code}")
        if code not in active:
            raise HTTPException(
                400,
                f"Your organisation does not have {code} active, so it cannot be granted.",
            )

        # The level check and the separated-duty rule both moved to
        # `role_tiers.refuse_grant`. They were written HERE, and this was the
        # only writer of the four that had them — `org_members`' two endpoints
        # write grant rows with no separated-duty rule at all, which is how an
        # org_admin could grant themselves `vetana: approver`. A rule enforced by
        # one writer of four is not enforced.
        #
        # Nothing about the verdict changes: same conditions, same statuses, same
        # sentences. What changes is that editing it here now edits it for all of
        # them.
        refusal = refuse_grant(
            code, level, caller_org_role=caller_role, org_has_owner=org_has_owner,
        )
        if refusal is not None:
            raise HTTPException(refusal.status, refusal.detail)

        out.append({"code": code, "role": level})

    return out


# ── The one seat counter ─────────────────────────────────────────────────────
#
# There were FIVE places that decided whether an org had a seat left, and they
# disagreed in three separate ways:
#
#   · `org_invites` counted pending invites. `admin_orgs.add_member`,
#     `admin_orgs.assign_role` and `org_members.add_member` did not, so an org at
#     4 joined + 1 pending could be pushed to 5 joined + 1 pending by the console
#     and then to SIX MEMBERS IN A FIVE-SEAT ORG the moment the invitee clicked
#     their link — because `POST /auth/accept-invite` checked nothing at all.
#     A reservation that is never re-read at acceptance is not a hold.
#   · Two answered 403 and one answered 409 for the identical condition.
#   · `subscription.py` renders the ceiling to the customer through a THIRD query
#     shape, so the number displayed was not the number enforced.
#
# One counter, one query shape, one status code, one sentence. Every writer that
# can put a person into an org calls `assert_seat_available` and nothing else.

#: 409, not 403. The caller is permitted to do this; the organisation is simply
#: full, and that is a conflict with current state rather than a denial of
#: authority. Chosen once here so the five writers cannot drift apart again.
SEAT_LIMIT_STATUS = 409


@dataclass(frozen=True)
class SeatCount:
    """What an org's seat allowance is and what is standing in it right now."""

    #: `COALESCE(org.max_users, plan.max_users)`. None means UNLIMITED — the
    #: tiers that are not sold per user have NULL on both, and collapsing that
    #: to zero would lock every such org out of hiring anyone.
    limit: Optional[int]
    joined: int
    pending: int

    @property
    def used(self) -> int:
        """A PENDING INVITE HOLDS A SEAT — settled by the owner.

        Counting only accepted members lets an org at its ceiling send any
        number of invites and discover the ceiling only when recipients start
        bouncing off it, by which time the mail has gone and the promise has
        been made.
        """
        return self.joined + self.pending

    @property
    def is_full(self) -> bool:
        return self.limit is not None and self.used >= self.limit


async def count_seats(pool, org_id: str, *, exclude_email: Optional[str] = None) -> SeatCount:
    """Seats bought, seats standing. The single query shape.

    `exclude_email` drops that address's own pending invite from the count. Two
    callers need it and for the same reason: re-inviting an address supersedes
    its live invite, and ACCEPTING one consumes it — in both cases the pending
    row is the very seat about to be taken, and counting it would refuse the
    person the seat they were already promised.
    """
    # The subscription is resolved with an explicit precedence and a LIMIT 1
    # rather than a bare `LEFT JOIN staging.subscriptions`. `staging.subscriptions`
    # has org_id as its PRIMARY KEY in migration 010, so today there is at most
    # one row — but the org credit wallet also turned out to have a live shape
    # its own migration never declared, so a join that returns whichever row the
    # planner reached first is a seat count that depends on the planner.
    #
    # Active WINS, but a non-active row is still consulted rather than filtered
    # out. A bare `WHERE s.status='active'` would resolve the plan to NULL for a
    # `past_due` or `paused` org and — with `organisations.max_users` also NULL —
    # hand an org that has not paid an UNLIMITED seat count. A seat limit must
    # never fail open.
    limit = await pool.fetchval(
        "SELECT COALESCE(o.max_users, p.max_users) "
        "FROM public.organisations o "
        "LEFT JOIN LATERAL ("
        "  SELECT s.plan_id FROM public.subscriptions s "
        "  WHERE s.org_id = o.id "
        "  ORDER BY (s.status = 'active') DESC, s.created_at DESC LIMIT 1"
        ") s ON TRUE "
        "LEFT JOIN public.plans p ON p.id = s.plan_id "
        "WHERE o.id=$1::uuid",
        org_id,
    )

    joined = await pool.fetchval(
        "SELECT COUNT(DISTINCT user_id) FROM public.user_roles "
        "WHERE org_id=$1::uuid AND role_code = ANY($2::text[])",
        org_id, list(SEAT_ROLES),
    ) or 0

    # `$2::text IS NULL OR …` rather than only appending the predicate when an
    # address is given: `LOWER(email) <> LOWER(NULL)` is NULL, not TRUE, so a
    # bare comparison against a missing address would exclude EVERY pending
    # invite and quietly return the count this whole helper exists to correct.
    pending = await pool.fetchval(
        "SELECT COUNT(*) FROM public.invites "
        "WHERE org_id=$1::uuid AND accepted_at IS NULL AND expires_at > NOW() "
        "AND ($2::text IS NULL OR LOWER(email) <> LOWER($2))",
        org_id, exclude_email,
    ) or 0

    return SeatCount(limit=limit, joined=joined, pending=pending)


def seat_limit_detail(seats: SeatCount) -> str:
    """The ONE refusal sentence, used by all five writers.

    It names the ceiling, both halves of what is standing in it, and the two
    remedies. Previously each site wrote its own: one said "Raise max_users on
    the org", one said "ask your account manager to add seats", one said "ask
    Aekam to raise the allowance" — three different instructions for one
    condition, and `accept-invite` said nothing because it never checked.
    """
    return (
        f"This organisation is using all {seats.limit} of its seats — "
        f"{seats.joined} joined and {seats.pending} invited but not yet accepted. "
        "Free a seat by removing a member or withdrawing an invitation, or ask "
        "Aekam to raise max_users on the organisation."
    )


async def assert_seat_available(
    pool,
    org_id: str,
    *,
    email: Optional[str] = None,
    user_id: Optional[str] = None,
) -> None:
    """Refuse to seat one more person once the org is at its allowance.

    `user_id` is the person about to be seated. Somebody who is ALREADY a member
    — being re-added under a second role, say — consumes no further seat and is
    admitted without the count being taken at all.

    `email` is that same person's address, and drops their own pending invite
    from the count. See `count_seats`.
    """
    if user_id:
        already_in = await pool.fetchval(
            "SELECT 1 FROM public.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
            user_id, org_id, list(SEAT_ROLES),
        )
        if already_in:
            return

    seats = await count_seats(pool, org_id, exclude_email=email)
    if seats.is_full:
        raise HTTPException(SEAT_LIMIT_STATUS, seat_limit_detail(seats))


#: The sentence every path says when `public.invites.employee_id` is not there.
#: Named once so the checkbox, the API and the tests cannot describe the same
#: missing migration three different ways.
MIGRATION_187_NOT_APPLIED = (
    "Creating a login alongside an employee record needs "
    "backend/migrations/187_invite_carries_the_employee.sql, which has not been "
    "applied to this database yet. The employee can still be added without a "
    "login, and an invitation can be sent separately from Settings → Members."
)


async def invites_can_carry_an_employee(pool) -> bool:
    """Has migration 187 been applied?

    Asked ONLY when somebody actually wants an invitation to carry an employee
    id. An ordinary invitation never reaches this query, so the invite path
    costs exactly what it cost before — one catalogue read is cheap, but a
    catalogue read on every invitation to answer a question that path does not
    ask is a cost with no buyer.

    Deliberately NOT cached in a module global. The answer changes the moment a
    human applies the migration by hand, and a process that cached `False` at
    boot would keep refusing the checkbox until somebody restarted Railway —
    with the migration visibly applied and no way to tell why.
    """
    return bool(await pool.fetchval(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='invites' "
        "AND column_name='employee_id'"
    ))


@dataclass(frozen=True)
class InvitePreflight:
    """What `preflight_org_invite` worked out, handed to `issue_invite`.

    It carries no authority of its own — it is the ANSWERS to the questions
    already asked, so the writer does not ask them twice and cannot ask them
    differently.
    """
    caller_role: Optional[str]
    grants: list


async def preflight_org_invite(
    pool, user, org_id: str, *, email: str, org_role: str,
    module_grants: Optional[List[GrantIn]] = None,
    employee_link: bool = False,
) -> InvitePreflight:
    """Every way an invitation can be refused, with NOTHING written.

    Extracted from `create_org_invite`, in the same order and with the same
    statuses and sentences, so that a second caller can find out whether an
    invitation is possible BEFORE it commits something it cannot take back.

    `routers/manav.create_employee` is that caller. It writes a personnel file —
    an Aadhaar, a PAN and a bank account — and then mints the invitation. If the
    refusals only surfaced at minting time the admin would be told the hire
    failed when the personnel file had already been written, or would be left
    holding an employee row the organisation has no seat for. So the whole
    verdict is reached first, while refusing is still free.

    `employee_link` is a QUESTION ABOUT THE SCHEMA, not an id, and that is why
    it is a boolean: the employee row does not exist yet when this runs — the
    caller creates it afterwards, from the verdict this returns — so there is no
    id to validate and nothing to validate it against. The only thing that can
    be settled here is whether an invitation is CAPABLE of carrying one, which
    is to say whether migration 187 has been applied.
    """
    await _assert_may_grant_role(pool, user["user_id"], org_id, org_role)
    caller_role = await _caller_org_role(pool, user["user_id"], org_id)
    grants = await _validate_grants(pool, org_id, module_grants or [], caller_role)

    existing_user = await pool.fetchrow(
        "SELECT user_id FROM users WHERE LOWER(email)=LOWER($1)", email,
    )
    if existing_user:
        raise HTTPException(
            409,
            "Someone with this email already has an account. Add them from the "
            "Members tab instead of inviting them.",
        )

    if employee_link and not await invites_can_carry_an_employee(pool):
        raise HTTPException(503, MIGRATION_187_NOT_APPLIED)

    # LAST, matching `issue_invite`'s own ordering — an invitation that is
    # refused on authority or on a bad grant is refused whatever the seat count
    # says, and asking the ceiling first would spend three queries to reach the
    # same 403. `issue_invite` takes the count again when it writes; this one is
    # the answer the caller needs BEFORE it writes anything of its own.
    await assert_seat_available(pool, org_id, email=email)

    return InvitePreflight(caller_role=caller_role, grants=grants)


async def issue_invite(pool, user, org_id: str, email: str, org_role: str,
                       full_name: str | None, grants: list, caller_role: str | None,
                       employee_id: str | None = None):
    """Create the invite row, send the mail, return the InviteCreated payload.

    Extracted so `org_members.add_member` can reach it. Those two endpoints were
    exact mirrors and neither knew about the other: adding a member 404'd with
    "the user must sign up first", inviting one 409'd with "add them from the
    Members tab instead". Since the product is invite-only and has NO public
    sign-up, "sign up first" was advice nobody could take — the Add member
    button could not work for anybody who did not already have an account.

    Duplicating twenty lines into org_members would have made the invite that
    Add-member sends drift from the invite the Invite button sends — different
    expiry, different mail, eventually different grants. One function, two
    callers.
    """
    await assert_seat_available(pool, org_id, email=email)

    # Supersede any pending invite for the same address in THIS org. Scoped by
    # org so one organisation cannot expire another's pending invite by
    # inviting the same person.
    await pool.execute(
        "UPDATE public.invites SET expires_at = NOW() "
        "WHERE LOWER(email)=LOWER($1) AND org_id=$2::uuid AND accepted_at IS NULL",
        email, org_id,
    )

    token = secrets.token_urlsafe(32)
    invite_id = f"inv_{uuid.uuid4().hex[:12]}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)
    import json

    # ── TWO STATEMENTS, NOT ONE WITH A CONDITIONAL COLUMN LIST ───────────────
    #
    # Migration 187 is WRITTEN AND NOT APPLIED, so `invites.employee_id` does
    # not exist on the live database today. Naming it unconditionally would make
    # asyncpg raise UndefinedColumnError on EVERY invitation this product sends,
    # including the ones that have nothing to do with HR — a feature nobody has
    # switched on breaking the feature everybody uses.
    #
    # So the ordinary path below is the statement that was here before, byte for
    # byte, and it is what runs unless a caller asked for an employee link. The
    # second statement is reached only from the employee-create checkbox, and
    # only after `preflight_org_invite` confirmed the column is there.
    #
    # `NULLIF($11::text,'')::uuid` rather than `$11::uuid`: an empty string
    # reaching a uuid cast is an instant 500 through PgBouncer, and "" is what a
    # form sends for an untouched field. The explicit `::text` on the inner
    # parameter is not decoration either — NULLIF over an untyped parameter and
    # a literal is exactly the ambiguous-parameter shape that turns a parse
    # error into a sub-second 500.
    if employee_id:
        await pool.execute(
            """INSERT INTO public.invites
                   (invite_id, email, role, token, invited_by, expires_at,
                    full_name, member_role, org_id, module_grants, employee_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10::jsonb,
                       NULLIF($11::text,'')::uuid)""",
            invite_id, email, "member", token, user["user_id"], expires_at,
            full_name or None, org_role, org_id, json.dumps(grants),
            str(employee_id),
        )
    else:
        await pool.execute(
            """INSERT INTO public.invites
                   (invite_id, email, role, token, invited_by, expires_at,
                    full_name, member_role, org_id, module_grants)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$10::jsonb)""",
            invite_id, email, "member", token, user["user_id"], expires_at,
            full_name or None, org_role, org_id, json.dumps(grants),
        )

    org_name = await pool.fetchval("SELECT name FROM public.organisations WHERE id=$1::uuid", org_id)
    invite_link = f"{FRONTEND_URL}/accept-invite?token={token}"

    try:
        from email_service import send_invite_email
        inviter_name = user.get("full_name") or user.get("name") or user.get("email") or "A colleague"
        send_invite_email(
            email, inviter_name, org_role, token,
            workspace_name=org_name or "Kartavaya",
            expires_label=expires_at.strftime("%d %b %Y"),
            recipient_name=full_name or "",
            inviter_role=(caller_role or "org_admin").replace("org_", "").capitalize(),
        )
    except Exception as exc:
        # The invite row is already committed and the link is returned below, so
        # a mail failure costs the convenience of delivery, not the invite. The
        # creator can copy the link. Failing the request here would leave a
        # pending invite the caller believes was never made.
        import logging
        logging.getLogger(__name__).warning("org invite email failed: %s", exc)

    return InviteCreated(
        invite_id=invite_id, email=email, org_role=org_role,
        full_name=full_name, module_grants=[GrantIn(**g) for g in grants],
        created_at=datetime.now(timezone.utc), expires_at=expires_at,
        invited_by=user["user_id"], invite_link=invite_link,
    )


@router.post("", response_model=InviteCreated)
async def create_org_invite(
    body: InviteCreate,
    pool=Depends(get_pool),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    email = body.email.lower()

    # The four refusals used to be written out here. They now live in
    # `preflight_org_invite`, in the same order, with the same statuses and the
    # same sentences — this endpoint's behaviour is unchanged. They moved so
    # that `routers/manav.create_employee` can reach the identical verdict
    # BEFORE it writes a personnel file, rather than growing a second, drifting
    # copy of the rules.
    pre = await preflight_org_invite(
        pool, user, org_id,
        email=email, org_role=body.org_role, module_grants=body.module_grants,
    )

    return await issue_invite(
        pool, user, org_id, email, body.org_role, body.full_name,
        pre.grants, pre.caller_role,
    )


@router.get("", response_model=List[OrgInviteOut])
async def list_org_invites(
    pool=Depends(get_pool),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Pending invites for THIS org. The column list is explicit and excludes
    `token` — see the module docstring for why that is not an oversight."""
    rows = await pool.fetch(
        "SELECT invite_id, email, member_role, full_name, module_grants, "
        "       created_at, expires_at, invited_by "
        "FROM public.invites "
        "WHERE org_id=$1::uuid AND accepted_at IS NULL AND expires_at > NOW() "
        "ORDER BY created_at DESC",
        org_id,
    )
    import json
    out = []
    for r in rows:
        raw = r["module_grants"]
        grants = json.loads(raw) if isinstance(raw, str) else (raw or [])
        out.append(OrgInviteOut(
            invite_id=r["invite_id"], email=r["email"],
            org_role=r["member_role"] or "org_member",
            full_name=r["full_name"],
            module_grants=[GrantIn(**g) for g in grants],
            created_at=r["created_at"], expires_at=r["expires_at"],
            invited_by=r["invited_by"],
        ))
    return out


@router.delete("/{invite_id}")
async def revoke_org_invite(
    invite_id: str,
    pool=Depends(get_pool),
    org_id: str = Depends(get_org_id),
    _=Depends(require_org_role(*ORG_SETTINGS_ROLES)),
):
    """Revoke by expiring, scoped to the caller's org.

    The org_id predicate is the access control, not a filter: without it any org
    admin could revoke any other organisation's invite by guessing an id.
    """
    row = await pool.fetchrow(
        "UPDATE public.invites SET expires_at = NOW() "
        "WHERE invite_id=$1 AND org_id=$2::uuid AND accepted_at IS NULL "
        "RETURNING invite_id",
        invite_id, org_id,
    )
    if not row:
        raise HTTPException(404, "No pending invite with that id in this organisation")
    return {"ok": True}
