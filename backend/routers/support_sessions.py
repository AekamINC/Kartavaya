"""support_sessions.py — the request / approve / deny / revoke endpoints.

THE POLICY LIVES IN `services/support_session.py` AND THE GUARD LIVES IN
`middleware/org_resolver.py`. This file is the wiring: who may call what, and
which identity each call acts as. It is deliberately thin, because every rule
written here instead of there is a rule the tests would have to reach through
HTTP to check.

── THE ROUTE SHAPE IS THE CLIENT'S, NOT MINE ────────────────────────────────

`/api/v1/support-sessions`, flat, with `scope` naming the AUDIENCE. That is the
contract `frontend/src/pages/admin/supportSessions.js`,
`SupportSessionsPage.jsx` and `org/TabSupportAccess.jsx` were written against,
and it is a naming choice with no security content — so it is the client's to
make. A backend the front end cannot call is not a safer backend.

Two consequences of that contract are worth stating, because they look like
laxity and are not:

  · `scope` is a request for an AUDIENCE, never an authority. Every scope is
    re-authorised here from the caller's own rows. Asking for `all` without god
    mode answers 403; asking for `customer` without an org answers an empty list.
  · `DELETE /{id}` carries a `party` in its body and THE BODY IS IGNORED. The
    party is derived from who the caller actually is. A client that could name
    its own `revoked_by_party` could write `customer` on an Aekam revocation,
    and the column exists precisely to tell those apart.

── WHY THESE ROUTES DO NOT USE `get_org_id` ─────────────────────────────────

The requester is an Aekam account and is NOT a member of the customer's
organisation. `get_org_id` would refuse them — correctly — so the org on every
route below comes from the request BODY (on create, validated against
`staging.organisations`) or from the SESSION ROW itself (everywhere else), and
authority is then checked against that org explicitly.

That also means `/api/v1/support-sessions` is deliberately absent from BOTH
allow-lists in `org_resolver.py`. It is not a console prefix and it is not a
module prefix. A SESSION CANNOT BE USED TO REACH THE ENDPOINTS THAT MANAGE
SESSIONS — `tests/test_support_sessions.py` pins that.

── THE THREE IDENTITIES ─────────────────────────────────────────────────────

  customer  org_owner or org_admin OF THAT ORG. Approves, denies, revokes.
  self      the requester. May withdraw (deny) and may revoke their own.
            MAY NOT APPROVE — see `open_session`.
  aekam     a god-mode platform admin, who may revoke a colleague's session and
            nothing else. Not an approver: Aekam approving Aekam is the feature
            inverted, which is why there is no god-mode short-circuit anywhere
            in this file even though `require_org_role` grants one.
"""
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import (
    SUPPORT_READ_ONLY_MODULES, SUPPORT_REQUESTABLE_MODULES,
)
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES, GOD_MODE_ROLES, ORG_MANAGEMENT_ROLES, SUPPORT_ROLES,
)
from services import support_session as svc

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/support-sessions", tags=["support-sessions"])


class SessionRequest(BaseModel):
    org_id: str
    reason: str
    modules: list[str] = Field(default_factory=list)
    access_level: str = "viewer"
    #: 0 = until revoked. The SHORTEST window is the default, so an unfinished
    #: request asks for the least — the same choice 111 makes in the DDL.
    requested_ttl_hours: int = 2


class Decision(BaseModel):
    #: What the customer actually allows, which may be SHORTER than what was
    #: asked for and may never be longer. Both numbers stay on the row, because
    #: an approval that quietly narrowed a request is the customer using the
    #: control this feature exists to give them.
    granted_ttl_hours: int | None = None


class Denial(BaseModel):
    reason: str


class Revocation(BaseModel):
    #: ACCEPTED AND IGNORED. See the module header: the party is derived from
    #: who the caller is, never from what they say they are.
    party: str | None = None


def _fail(exc: svc.SupportSessionError) -> HTTPException:
    return HTTPException(exc.status, exc.detail)


async def _platform_role(pool, user_id: str) -> str | None:
    return await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[]) LIMIT 1",
        user_id, list(ALL_PLATFORM_ROLES),
    )


#: The refusal a platform role that is not `platform_support` gets when it tries
#: to RAISE a request. Written once because two endpoints give it.
_NOT_A_SUPPORT_ROLE = (
    "Only the platform_support role can request a support session. Every other "
    "platform role already reaches customer modules by role, and a session for "
    "one of them would be a grant that adds authority without removing any."
)


async def _may_request(pool, user_id: str) -> bool:
    """May this account RAISE a support request? `platform_support` alone.

    ── WHY THIS IS NARROWER THAN `_platform_role` ──────────────────────────────
    It was `ALL_PLATFORM_ROLES`, and that is what turned a scoping bug into a
    real widening. `subscription.support_refusal` can only cap a role whose
    `platform_refusal` it is consulted for, and 4 of the 8 platform roles —
    platform_owner, platform_admin, platform_manager, platform_staff — already
    reach graha, vikray, prachar, sahayak, dristi and sanvaad BY ROLE. Measured:
    a `platform_staff` holding a `graha / viewer` session was admitted to POST on
    all six, with the audit row recording `level: 'admin'`.

    `subscription` now caps unconditionally, so that particular escape is closed
    on its own. This is the other half, and the two are deliberately independent:
    the ONLY holder of a session is the role that gets nothing without one, so a
    session can only ever narrow — there is no role here for it to widen.

    `platform_support` is the role RBAC-SPEC:19 describes: "Zero by default.
    Needs org-admin approval granting: time limit, module scope, access level."
    `role_tiers.modules_for('platform_support')` returns `frozenset()` and
    `CROSS_ORG_HEADER_ROLES` excludes it, so it holds nothing anywhere until a
    customer says yes — which is what makes the session meaningful.
    """
    return await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[]) LIMIT 1",
        user_id, list(SUPPORT_ROLES),
    ) is not None


async def _managed_orgs(pool, user_id: str) -> list[str]:
    """The organisations this person OWNS OR ADMINISTERS.

    NOT owner-only, and that is a measured decision rather than a relaxation.
    `role_tiers.refuse_grant`'s docstring records, from the live database on
    2026-08-06: Unicode Group (fae87907) holds FOUR `org_admin` rows, one
    `org_member` and ZERO `org_owner` — and nothing in this backend can write an
    `org_owner` row into an existing org. Owner-only would mean the platform's
    one paying customer could never approve a support session, and a refusal
    whose remedy does not exist is an outage rather than a guard.
    """
    rows = await pool.fetch(
        "SELECT DISTINCT org_id FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL AND role_code = ANY($2::text[])",
        user_id, list(ORG_MANAGEMENT_ROLES),
    )
    return [str(r["org_id"]) for r in rows]


async def _manages_org(pool, user_id: str, org_id: str) -> bool:
    """Is this person an org_owner or org_admin OF THIS ORGANISATION?"""
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
        user_id, org_id, list(ORG_MANAGEMENT_ROLES),
    ))


# ═════════════════════════════════════════════════════════════════════════════
# The catalogue the request form is built from
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/organisations")
async def requestable_organisations(user=Depends(require_user)):
    """The organisations an operator may ASK, plus what may be asked for.

    `modules` is served from the GUARD'S OWN constants, so the form and the
    resolver cannot disagree about which modules exist — a picker offering
    `vetana` would produce requests that can be approved and then reach nothing.

    403 rather than an empty list for a non-platform caller: an empty list would
    read as "there are no organisations", which is a different and false fact.
    """
    pool = await get_pool()
    if not await _may_request(pool, user["user_id"]):
        raise HTTPException(403, _NOT_A_SUPPORT_ROLE)
    return {
        "data": await svc.requestable_organisations(pool),
        "modules": sorted(SUPPORT_REQUESTABLE_MODULES),
        "read_only_modules": sorted(SUPPORT_READ_ONLY_MODULES),
        "access_levels": list(svc.ACCESS_LEVELS),
        "ttl_choices": list(svc.TTL_CHOICES),
        "min_reason_length": svc.MIN_REASON_LENGTH,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 1 · The list, by audience
# ═════════════════════════════════════════════════════════════════════════════

@router.get("")
async def list_sessions(
    scope: str = "mine", org_id: str | None = None, user=Depends(require_user),
):
    """Sessions this caller may see.

      mine      what I asked for, in customers' organisations
      customer  what was asked of MY organisation(s), whoever asked
      all       every session on the platform — GOD MODE ONLY

    THE SCOPE NAMES AN INTENT AND NEVER AN AUTHORITY. Each branch re-derives
    what the caller actually holds; a platform operator asking for `customer`
    gets the orgs they personally manage, which for nine of the ten live
    platform accounts is Aekam Inc alone.

    `[]` when migration 111 is unapplied, which is production's state today.
    """
    pool = await get_pool()
    uid = user["user_id"]

    if scope == "all":
        if await _platform_role(pool, uid) not in GOD_MODE_ROLES:
            raise HTTPException(403, "Only a platform owner can see every session")
        return {"data": await svc.list_all(pool, viewer_id=uid)}

    if scope == "customer":
        if org_id:
            if not await _manages_org(pool, uid, org_id):
                raise HTTPException(
                    403, "Only an organisation owner or admin can see this"
                )
            managed = [org_id]
        else:
            managed = await _managed_orgs(pool, uid)
        out = []
        for oid in managed:
            out.extend(await svc.list_for_org(pool, oid, viewer_id=uid))
        out.sort(key=lambda s: s["requested_at"] or "", reverse=True)
        return {"data": out}

    if scope != "mine":
        raise HTTPException(400, "scope must be mine, customer or all")
    return {"data": await svc.list_for_agent(pool, uid)}


# ═════════════════════════════════════════════════════════════════════════════
# 2 · The agent asks
# ═════════════════════════════════════════════════════════════════════════════

@router.post("")
async def request_access(body: SessionRequest, user=Depends(require_user)):
    """Ask a customer for access. GRANTS NOTHING — RBAC-SPEC:105.

    `requested_by` is taken from the token and is NEVER read from the body. An
    endpoint that let you name the requester is an endpoint that lets you get a
    colleague approved and then use their session.
    """
    pool = await get_pool()
    if not await _may_request(pool, user["user_id"]):
        raise HTTPException(403, _NOT_A_SUPPORT_ROLE)

    try:
        return await svc.request_session(
            pool,
            requested_by=user["user_id"],
            org_id=body.org_id,
            reason=body.reason,
            modules=body.modules,
            access_level=body.access_level,
            ttl_hours=body.requested_ttl_hours,
            requestable=SUPPORT_REQUESTABLE_MODULES,
        )
    except svc.SupportSessionError as exc:
        raise _fail(exc)


# ═════════════════════════════════════════════════════════════════════════════
# 3 · The customer decides
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/{session_id}/approve")
async def approve(
    session_id: str, body: Decision = Body(default=Decision()),
    user=Depends(require_user),
):
    """The customer says yes, and access begins at that instant.

    THE APPROVER MUST NOT BE THE REQUESTER. That is refused twice on purpose:
    here, where the caller must hold an org role in the customer's organisation;
    and inside `open_session`, under the row lock, where the identities are
    compared directly. The inner one is the guard — this one is the early,
    readable 403.
    """
    pool = await get_pool()
    row = await svc.get_session(pool, session_id)
    if not row:
        raise HTTPException(404, "No such support request")

    org_id = str(row["org_id"])
    if not await _manages_org(pool, user["user_id"], org_id):
        raise HTTPException(
            403,
            "Only an owner or admin of this organisation can approve support access.",
        )

    try:
        return await svc.open_session(
            pool,
            session_id=session_id,
            org_id=org_id,
            approver_id=user["user_id"],
            granted_ttl_hours=body.granted_ttl_hours,
        )
    except svc.SupportSessionError as exc:
        raise _fail(exc)


@router.post("/{session_id}/deny")
async def deny(session_id: str, body: Denial, user=Depends(require_user)):
    """The customer declines, or the agent withdraws their own request.

    Self-denial is permitted and self-approval is not: denying yourself removes
    access, approving yourself creates it. Only one of those is an escalation.
    """
    pool = await get_pool()
    row = await svc.get_session(pool, session_id)
    if not row:
        raise HTTPException(404, "No such support request")

    org_id = str(row["org_id"])
    is_requester = row["requested_by"] == user["user_id"]
    if not is_requester and not await _manages_org(pool, user["user_id"], org_id):
        raise HTTPException(403, "You cannot decide this request")

    try:
        return await svc.deny_session(
            pool,
            session_id=session_id,
            org_id=org_id,
            decided_by=user["user_id"],
            reason=body.reason,
            is_requester=is_requester,
        )
    except svc.SupportSessionError as exc:
        raise _fail(exc)


@router.delete("/{session_id}")
async def revoke(
    session_id: str, body: Revocation = Body(default=Revocation()),
    user=Depends(require_user),
):
    """End a live session. Takes effect on the agent's VERY NEXT REQUEST.

    THE `party` IN THE BODY IS IGNORED. `revoked_by_party` exists to tell three
    otherwise-identical revocations apart, and a client that could name its own
    would be able to write `customer` on an Aekam revocation — which is exactly
    the distinction the column was added to preserve. It is derived:

      self      the requester, closing their own
      customer  an owner or admin of that org
      aekam     a god-mode platform admin ending a colleague's session

    Checked in that order so a requester who also holds god mode is recorded as
    `self` — the narrower, truer answer.
    """
    pool = await get_pool()
    row = await svc.get_session(pool, session_id)
    if not row:
        raise HTTPException(404, "No such support session")

    org_id = str(row["org_id"])
    if row["requested_by"] == user["user_id"]:
        party = "self"
    elif await _manages_org(pool, user["user_id"], org_id):
        party = "customer"
    elif await _platform_role(pool, user["user_id"]) in GOD_MODE_ROLES:
        party = "aekam"
    else:
        raise HTTPException(403, "You cannot revoke this session")

    try:
        return await svc.revoke_session(
            pool,
            session_id=session_id,
            org_id=org_id,
            revoked_by=user["user_id"],
            party=party,
        )
    except svc.SupportSessionError as exc:
        raise _fail(exc)
