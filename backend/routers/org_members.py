"""
org_members.py — Org-level member management (self-service).
Org admins/owners manage their own members. No platform admin needed.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr

from auth_router import require_user
from db import get_pool
from middleware.roles import require_org_role
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    ALL_MODULES, SENSITIVE_MODULES, DEFAULT_GRANT_LEVEL, default_level_for,
    grant_audit_severity, grant_needs_owner_authority, refuse_grant,
    refuse_grant_shape, valid_levels_for,
)
from services.audit import emit as audit
# The one seat counter. This module used to carry its own copy — same COALESCE,
# no pending-invite term, a 403 instead of a 409 and a third wording of the
# refusal — so an org with a live invitation outstanding could be filled past
# its allowance from here. See `org_invites.count_seats`.
from routers.org_invites import SEAT_ROLES, assert_seat_available

router = APIRouter(prefix="/api/v1/org/members", tags=["org-members"])

# ALL_MODULES and SENSITIVE_MODULES now come from role_tiers rather than being
# retyped here. The local list held EIGHT codes where role_tiers holds twelve, so
# a grant naming esign, samvada, varta or pahchan was rejected with 400 by the
# only endpoint that can create one — four modules unreachable through the UI
# that exists to reach them.


def _normalise_grant(g) -> tuple[str, str]:
    """
    Accept a bare "ganit" or a {"code": "ganit", "role": "editor"} and return
    (module_code, level).

    Both shapes are accepted because the bare-string form is what every existing
    caller sends. Rejecting it would break the member editor the moment this
    deploys, and a level-aware API that no client can call is not an improvement.
    """
    if isinstance(g, str):
        # `default_level_for`, not the flat default: Sanvaad starts at editor,
        # because a viewer in a messaging module cannot post and an invitation
        # to a chat you cannot speak in is a broken one. Every other module is
        # unchanged at viewer. See role_tiers.NEW_GRANT_LEVEL_BY_MODULE.
        return g, default_level_for(g)
    if isinstance(g, dict):
        code = g.get("code") or g.get("module_code")
        level = g.get("role") or g.get("level") or (default_level_for(code) if code else DEFAULT_GRANT_LEVEL)
        if code:
            return code, level
    raise HTTPException(400, f"Malformed module grant: {g!r}")


async def _org_has_owner(pool, org_id: str) -> bool:
    """Does this organisation have an `org_owner` row at all?

    Read only when a grant actually needs owner authority, because the answer
    only matters then and every save would otherwise pay for the round trip.
    See `role_tiers.refuse_grant` for why the question exists — one live org has
    four admins and no owner, and no endpoint in this backend can give it one.
    """
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE org_id=$1::uuid AND role_code='org_owner' LIMIT 1",
        org_id,
    ))


async def _resolve_owner_presence(pool, org_id: str, caller_org_role, grants) -> bool:
    """`org_has_owner` for this request — looked up only if some grant needs it.

    Returns True when nothing in the request turns on the answer, which is the
    strict value: `refuse_grant` refuses on True, so a request that never asks
    the question can never be let through by it.
    """
    if not any(
        grant_needs_owner_authority(code, level, caller_org_role=caller_org_role)
        for code, level in grants
    ):
        return True
    return await _org_has_owner(pool, org_id)


def _validate_grant_shape(code: str, level: str) -> None:
    """The half of the policy that needs no caller — a real module at a level it
    has a use for.

    Applied to grants a REPLACE-semantics save is carrying UNCHANGED. See
    `set_member_modules`.
    """
    refusal = refuse_grant_shape(code, level)
    if refusal is not None:
        raise HTTPException(refusal.status, refusal.detail)


def _validate_grant(
    code: str, level: str, caller_org_role: str | None = None,
    org_has_owner: bool = True,
) -> None:
    """The ONE grant policy, applied here rather than restated here.

    This used to be the whole rule for both of this file's writers, and it was
    two checks: a real module, and a level that module has a use for. It never
    consulted the separated-duty rule that `org_invites._validate_grants`
    enforced on the invite path — so the guard existed on the writer a customer
    reaches through a form and NOT on the two that actually write grant rows,
    and an org_admin could `PUT .../{their own user_id}/modules` naming
    `vetana: approver` to hold admin and approver on payroll at once.

    `caller_org_role` defaults to None — "a caller with no org row", which skips
    the authority half — ONLY so that a call site which has not resolved the
    role yet is a visible omission rather than a syntax error. Both call sites
    in this file pass it. `refuse_grant`'s docstring carries the reasoning.

    `org_has_owner` defaults True — the strict value — for the same reason: an
    omission refuses rather than admits.
    """
    refusal = refuse_grant(
        code, level, caller_org_role=caller_org_role, org_has_owner=org_has_owner,
    )
    if refusal is not None:
        raise HTTPException(refusal.status, refusal.detail)


async def _audit_grants(
    request: Request, *, org_id: str, actor: str, target_user_id: str,
    before: dict[str, str], after: dict[str, str], via: str,
    caller_org_role: str | None = None, org_has_owner: bool = True,
) -> None:
    """Leave a row for every grant this request created, raised, lowered or
    revoked. Nothing in this file wrote one on any path before.

    A NEW action name, deliberately not `subscription.SENSITIVE_ACCESS_ACTION`:
    312 rows in `staging.audit_log` already carry that name and every one of them
    means "a god-mode account was granted a sensitive module". Reusing it for an
    org admin editing a colleague's checkboxes would retroactively change what
    those 312 rows say.

    `self_grant` is carried rather than refused — see `refuse_grant`'s note 2.

    `no_owner_fallback` is the OTHER thing a reviewer must be able to see: a
    separated-duty approver grant that only went through because the
    organisation has no owner to make the decision. It is already `warn`
    severity; this says WHY it was allowed, so the row is distinguishable from
    an owner having decided it.
    """
    for code in sorted(set(before) | set(after)):
        was, now = before.get(code), after.get(code)
        if was == now:
            continue
        fallback = (
            now is not None
            and not org_has_owner
            and grant_needs_owner_authority(
                code, now, caller_org_role=caller_org_role,
            )
        )
        audit(
            "org.module_grant_changed",
            request,
            org_id=org_id,
            user_id=actor,
            resource_type="module",
            resource_id=code,
            detail={
                "target": target_user_id,
                "module": code,
                "from_level": was,
                "to_level": now,
                "by": actor,
                "self_grant": target_user_id == actor,
                "no_owner_fallback": fallback,
                "via": via,
            },
            severity=grant_audit_severity(code, now or was or ""),
        )


class AddMemberBody(BaseModel):
    email: EmailStr
    role: str = "org_member"
    # list[str] | list[{code, role}] — see _normalise_grant.
    module_grants: list = []
    mobile_number: str = ""


class UpdateModulesBody(BaseModel):
    # Same two shapes as module_grants.
    modules: list


@router.get("")
async def list_members(
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """List all members of the caller's org."""
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT ur.user_id, ur.role_code, ur.granted_at,
               u.email, COALESCE(u.full_name, u.name) AS full_name,
               u.avatar AS avatar_url, u.mobile_number
        FROM staging.user_roles ur
        JOIN users u ON u.user_id = ur.user_id
        WHERE ur.org_id = $1::uuid
          AND ur.role_code = ANY($2::text[])
        ORDER BY ur.granted_at
    """, org_id, list(SEAT_ROLES))

    members = []
    for r in rows:
        mods = await pool.fetch(
            "SELECT module_code, role FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid",
            r["user_id"], org_id,
        )
        members.append({
            **dict(r),
            # `modules` keeps the bare-code shape every existing caller reads.
            # `module_grants` carries the level alongside it. Returning only the
            # new shape would blank the module column in any client that has not
            # been redeployed yet; returning only the old one is what hid the
            # level from the UI in the first place.
            "modules": [m["module_code"] for m in mods],
            "module_grants": [
                {"code": m["module_code"], "role": m["role"]} for m in mods
            ],
        })
    return members


@router.post("")
async def add_member(
    body: AddMemberBody,
    request: Request,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Add an existing user to this org. The user must already have an account."""
    pool = await get_pool()

    valid_roles = {"org_admin", "org_member"}
    if body.role not in valid_roles:
        raise HTTPException(400, f"Invalid role: {body.role}. Valid: {', '.join(valid_roles)}")

    target = await pool.fetchrow(
        "SELECT user_id, email, COALESCE(is_system, FALSE) AS is_system "
        "FROM users WHERE LOWER(email)=LOWER($1)",
        body.email,
    )
    if target and target.get("is_system"):
        # The org's Niyam automation account (migration 148). Refused OUTRIGHT
        # rather than filtered into the invite fallback below: filtering would
        # mail an invitation to an unroutable .invalid address and report
        # "invited", and granting it a user_roles row would put it in every
        # member list and cost a seat -- the two things the account is built
        # never to do.
        raise HTTPException(
            400, "That address belongs to a system account and cannot be "
                 "added to an organisation.")
    if not target:
        # NOT a 404. This used to answer "the user must sign up first, then you
        # can add them" — advice nobody could take, because the product is
        # invite-only and has no public sign-up. The one button for bringing a
        # colleague into an org could not work for anybody who was not already
        # in the product, and the person clicking it had no way to know that the
        # Invite tab was the answer.
        #
        # Adding somebody who has no account IS an invitation. So it sends one,
        # through exactly the same path the Invite button uses — same expiry,
        # same email, same module grants — and says so in the reply, because
        # "added" and "invited" are different things and the screen should not
        # claim the first when it did the second.
        #
        # ── THE GRANTS USED TO BE DROPPED HERE ───────────────────────────────
        #
        # This passed a literal `[]` where the grants go, so the sentence above
        # was true of everything except the one thing an admin had just chosen.
        # Modules picked in the Add member form applied when the person already
        # had an account and vanished when they did not — and the invited branch
        # is precisely the case where they matter most, because a colleague who
        # accepts with no grants lands on a nav rail with every module hidden and
        # somebody has to go back and fix it afterwards.
        #
        # `preflight_org_invite`, not a bare pass-through: it is the same
        # validation `POST /v1/org/invites` runs — every code must name a module
        # the org actually has, at a level that module allows, and an org_admin
        # may not mint an approver on a separated-duty module. Reaching
        # `issue_invite` with unvalidated grants would make this door the weak
        # one, which is the whole reason the refusals were extracted into a
        # preflight in the first place.
        from routers.org_invites import GrantIn, issue_invite, preflight_org_invite

        # ── TYPED BEFORE IT CROSSES THE DOOR ────────────────────────────────
        #
        # `AddMemberBody.module_grants` is a bare `list` on purpose: this
        # endpoint accepts BOTH a plain `"ganit"` and a
        # `{"code": "ganit", "role": "editor"}`, which is what `_normalise_grant`
        # exists for and what every existing caller sends. `preflight_org_invite`
        # is typed the other way — `List[GrantIn]` — and its `_validate_grants`
        # reads `g.code`. So an untyped dict arriving here raised AttributeError
        # INSIDE the handler, which escapes CORSMiddleware: the browser reported
        # a CORS failure and the screen said only "Failed to add member".
        #
        # The member form pre-populates nine default grants, so **every
        # invitation an admin sent through Add-or-invite 500'd**, while
        # `POST /v1/org/invites` answered a clean 400 on the identical payload.
        #
        # Normalised here rather than by retyping the field, because retyping it
        # would refuse the bare-string shape this endpoint's own callers use.
        _grants = [GrantIn(code=c, role=r)
                   for c, r in (_normalise_grant(g) for g in body.module_grants)]

        pre = await preflight_org_invite(
            pool, user, org_id,
            email=body.email.lower(), org_role=body.role,
            module_grants=_grants,
        )
        invite = await issue_invite(
            pool, user, org_id, body.email.lower(), body.role,
            getattr(body, "full_name", None), pre.grants, pre.caller_role,
        )
        return {
            "status": "invited",
            "email": invite.email,
            "role": body.role,
            "invite_id": invite.invite_id,
            "invite_link": invite.invite_link,
            "expires_at": invite.expires_at,
            "module_grants": pre.grants,
            "message": f"{body.email} has no account yet, so an invitation was sent. "
                       "They join this organisation when they accept it.",
        }

    if body.mobile_number:
        await pool.execute(
            # ── ONE ACCOUNT'S ROW, WRITTEN BY SOMEBODY ELSE ─────────────────
            #
            # This is an org admin editing ANOTHER PERSON'S account record while
            # adding them to the organisation, so `updated_by` is the admin and
            # not the target. Those are two different facts and the wrong one
            # here would read as the member having changed their own number.
            #
            # Schema-qualified while it is being touched: `users` is in `public`
            # and migration 142 exists because a statement that trusted
            # `search_path` found a shadow table in the other schema.
            # `updated_at` moves with the actor — a name against a stale
            # timestamp dates the edit to somebody else's.
            "UPDATE public.users SET mobile_number=$1, updated_at=NOW(), "
            "updated_by=$3 WHERE user_id=$2",
            body.mobile_number.strip(), target["user_id"], user["user_id"],
        )

    existing = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
        target["user_id"], org_id, list(SEAT_ROLES),
    )
    if existing:
        raise HTTPException(409, f"{body.email} is already a member of this organisation")

    # Seat limit. max_users was previously READ in two places and enforced in
    # none — /v1/subscription/usage returned it and BillingPage displayed it,
    # but nothing stopped an org adding members past it. A limit that is
    # displayed and not applied is worse than no limit: it tells the customer
    # they are capped at 5 while letting them add 50, and the discrepancy
    # surfaces at billing.
    #
    # The count now includes pending invites, which this path was missing: an
    # org at 4 joined + 1 invited would admit a fifth member here and end up
    # with six the moment the invitation was accepted.
    await assert_seat_available(
        pool, org_id, email=body.email, user_id=target["user_id"],
    )

    await pool.execute(
        "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
        "VALUES ($1, $2::uuid, $3, $4) "
        "ON CONFLICT (user_id, org_id, role_code) DO NOTHING",
        target["user_id"], org_id, body.role, user["user_id"],
    )

    org = await pool.fetchrow(
        "SELECT team_id FROM staging.organisations WHERE id=$1::uuid", org_id,
    )
    if org and org["team_id"]:
        # ── BOTH membership tables, deliberately ────────────────────────────
        #
        # Phase 2 of the `team_members` retirement (PROPOSED_080) removes READS
        # of `team_members` and keeps every WRITE: the rename in step 4 is
        # reversible only while the old table is still maintained. This writer
        # fed `team_members` alone, so the org seat it granted was invisible to
        # `may_reach_project`, the templates gate, uploads, views, time entries
        # and dashboards — every reader phase 2 moved onto
        # `project_assignments`. A new org member could be listed by the member
        # console and still be refused their own org's project.
        #
        # Two statements rather than one, so each placeholder is deduced against
        # exactly one column: `team_members.user_id` is `text` and
        # `project_assignments.user_id` is `character varying`, and a single
        # statement spanning both needs the explicit `::text` cast that
        # `auth_router.accept_invite` documents.
        await pool.execute(
            "INSERT INTO public.team_members (member_id, team_id, email, user_id, role, status, org_id) "
            "VALUES ($1, $2, $3, $4, 'member', 'active', $5::uuid) "
            "ON CONFLICT DO NOTHING",
            f"mem_{uuid.uuid4().hex[:12]}", org["team_id"],
            target["email"], target["user_id"], org_id,
        )
        await pool.execute(
            "INSERT INTO public.project_assignments "
            "  (assignment_id, team_id, user_id, role, assigned_by, org_id) "
            "VALUES ($1, $2, $3, 'member', $4, $5::uuid) "
            "ON CONFLICT (team_id, user_id) DO NOTHING",
            f"assign_{uuid.uuid4().hex[:12]}", org["team_id"],
            target["user_id"], user["user_id"], org_id,
        )

    # Defaults for the two branches that grant nothing sensitive: no caller role
    # is resolved there because nothing on those paths turns on it, and the
    # audit row's `no_owner_fallback` is False for both by construction.
    caller_role: Optional[str] = None
    org_has_owner = True

    if body.module_grants:
        # An explicit list is validated and REJECTED on error rather than
        # filtered. The old `if m in ALL_MODULES` silently dropped anything it
        # did not recognise, so adding a member with a typo'd or newer module
        # reported success while granting less than was asked for.
        #
        # The caller's OWN org role decides whether they may hand out approver
        # on a separated-duty module. Resolved once, from the same helper the
        # invite path uses, so a member cannot be CREATED holding
        # `vetana: approver` by an admin who could not have granted it a moment
        # later through the edit screen.
        from routers.org_invites import _caller_org_role
        caller_role = await _caller_org_role(pool, user["user_id"], org_id)
        grants = [_normalise_grant(g) for g in body.module_grants]
        # Every grant here is NEW — this path creates the member — so there is
        # no unchanged half to exempt, unlike `set_member_modules`. The owner
        # lookup is the same one, and is skipped unless a grant turns on it.
        org_has_owner = await _resolve_owner_presence(
            pool, org_id, caller_role, grants,
        )
        for code, level in grants:
            _validate_grant(code, level, caller_role, org_has_owner)
    elif body.role == "org_admin":
        grants = []
    else:
        enabled = await pool.fetch(
            "SELECT module_code FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND is_active=TRUE",
            org_id,
        )
        # Defaults are deliberately the weakest level, and skip the sensitive
        # modules entirely. Payroll, personnel files and the books are granted
        # on purpose or not at all — never by omission.
        grants = [
            (r["module_code"], default_level_for(r["module_code"]))
            for r in enabled
            if r["module_code"] not in SENSITIVE_MODULES
            and r["module_code"] in ALL_MODULES
            and default_level_for(r["module_code"]) in valid_levels_for(r["module_code"])
        ]

    for code, level in grants:
        await pool.execute(
            "INSERT INTO staging.org_member_modules "
            "(user_id, org_id, module_code, role, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4, $5) "
            "ON CONFLICT (user_id, org_id, module_code) DO NOTHING",
            target["user_id"], org_id, code, level, user["user_id"],
        )

    await _audit_grants(
        request, org_id=org_id, actor=user["user_id"],
        target_user_id=target["user_id"],
        before={}, after=dict(grants), via="org_members.add",
        caller_org_role=caller_role, org_has_owner=org_has_owner,
    )

    return {
        "status": "added",
        "email": body.email,
        "role": body.role,
        "modules": [c for c, _ in grants],
        "module_grants": [{"code": c, "role": r} for c, r in grants],
    }


@router.delete("/{target_user_id}")
async def remove_member(
    target_user_id: str,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Remove a member from this org. Cannot remove yourself or an owner."""
    if target_user_id == user["user_id"]:
        raise HTTPException(400, "You cannot remove yourself")

    pool = await get_pool()

    is_owner = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code='org_owner'",
        target_user_id, org_id,
    )
    if is_owner:
        raise HTTPException(403, "Cannot remove an org owner")

    await pool.execute(
        "DELETE FROM staging.user_roles WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )
    await pool.execute(
        "DELETE FROM staging.org_member_modules WHERE user_id=$1 AND org_id=$2::uuid",
        target_user_id, org_id,
    )

    org = await pool.fetchrow(
        "SELECT team_id FROM staging.organisations WHERE id=$1::uuid", org_id,
    )
    if org and org["team_id"]:
        # BOTH tables, and this direction is the one that must not be missed.
        # Deleting from `team_members` alone would leave the
        # `project_assignments` row standing — and since phase 2 that row IS
        # the access, so a removed member would keep the org's project. The
        # dual-delete also keeps the two tables reconciled, which is the
        # precondition migration 195 established and PROPOSED_080 step 4
        # depends on for its reversibility.
        await pool.execute(
            "DELETE FROM public.team_members WHERE team_id=$1 AND user_id=$2",
            org["team_id"], target_user_id,
        )
        await pool.execute(
            "DELETE FROM public.project_assignments WHERE team_id=$1 AND user_id=$2",
            org["team_id"], target_user_id,
        )

    return {"status": "removed"}


@router.put("/{target_user_id}/role")
async def update_member_role(
    target_user_id: str,
    role: str = Query(...),
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Change a member's org role (org_admin / org_member)."""
    valid = {"org_admin", "org_member"}
    if role not in valid:
        raise HTTPException(400, f"Invalid role. Valid: {', '.join(valid)}")
    if target_user_id == user["user_id"]:
        raise HTTPException(400, "You cannot change your own role")

    pool = await get_pool()
    # WHO PROMOTED THEM. This is the ONLY statement in the product that
    # changes a `role_code` in place — every other path INSERTs a new grant
    # (which `granted_by` records) or DELETEs one — and until migration 203 it
    # recorded nothing at all. `granted_by` answers who admitted this person
    # to the org months ago; it must not be read as the answer to who made
    # them an admin today, which is the question an audit asks of this table
    # first and the one that matters after an incident.
    #
    # `updated_at` is deliberately NOT set here: `trg_touch_user_roles` (203)
    # owns the timestamp, so it stays true even for a writer that never heard
    # of the column. `updated_by` is the half no trigger can supply, because a
    # trigger cannot know who is holding the connection.
    await pool.execute(
        "UPDATE staging.user_roles SET role_code=$1, updated_by=$4 "
        "WHERE user_id=$2 AND org_id=$3::uuid "
        "AND role_code IN ('org_admin','org_member')",
        role, target_user_id, org_id, user["user_id"],
    )
    return {"status": "updated", "role": role}


@router.put("/{target_user_id}/modules")
async def set_member_modules(
    target_user_id: str,
    body: UpdateModulesBody,
    request: Request,
    user=Depends(require_org_role("org_admin", "org_owner")),
    org_id: str = Depends(get_org_id),
):
    """Replace a member's module grants.

    THE PRIVILEGE HOLE THIS ENDPOINT SHIPPED WITH: it took `org_admin`, had no
    self-target check (contrast `update_member_role` directly above, which
    blocks self), and applied no separated-duty rule. So

        PUT /api/v1/org/members/{the caller's own user_id}/modules
        {"modules": [{"code": "vetana", "role": "approver"}]}

    was a 200. `held_module_levels` then returned {admin (by org role), approver
    (by the new row)}, `vetana.py`'s `_RELEASE_LEVEL = APPROVER` was satisfied,
    and one person both defined salary structures and released payments. It wrote
    no audit row, so there was nothing to notice afterwards either.
    """
    pool = await get_pool()

    # Validate the WHOLE list before deleting anything. This used to validate in
    # one loop and write in another, with the DELETE between them — so a request
    # whose last entry was a bad module code passed the first loop for every
    # earlier entry, wiped the member's grants, and only then raised. The member
    # ended up with nothing.
    #
    # The caller's own org role is now part of that validation, resolved BEFORE
    # the DELETE for the same reason.
    from routers.org_invites import _caller_org_role
    caller_role = await _caller_org_role(pool, user["user_id"], org_id)

    grants = [_normalise_grant(g) for g in body.modules]

    # Read the prior state FIRST — before the validation loop and not merely
    # before the DELETE, which is where it used to sit.
    #
    # THE REGRESSION THAT MOVED IT: this endpoint is REPLACE-semantics and
    # `TabMembers.jsx` sends `editing.draft` — the member's WHOLE current grant
    # list — on every save. Running the authority half of the policy over every
    # entry therefore ran it over the entries the request did not touch, so an
    # org_admin editing a member who already held `vetana: approver` was refused
    # a change to some unrelated module, and the only way through the form was
    # to uncheck Vetana and DELETE the org's payroll approver. Five such rows
    # exist across three live orgs.
    #
    # A grant this request leaves exactly as it found it creates no authority,
    # so it gets the SHAPE half only. Anything the request actually changes —
    # a new grant, or a level raised to approver — still gets the whole rule.
    before = {
        r["module_code"]: r["role"]
        for r in await pool.fetch(
            "SELECT module_code, role FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid",
            target_user_id, org_id,
        )
    }

    changed = [(c, lvl) for c, lvl in grants if before.get(c) != lvl]
    org_has_owner = await _resolve_owner_presence(
        pool, org_id, caller_role, changed,
    )
    for code, level in grants:
        if before.get(code) == level:
            _validate_grant_shape(code, level)
        else:
            _validate_grant(code, level, caller_role, org_has_owner)

    # THE DEFECT THIS ENDPOINT EXISTED WITH: the INSERT never named `role`, so
    # every re-INSERT landed on the column default. Saving a member's modules to
    # change one checkbox silently demoted every other grant they held to viewer,
    # and nothing in the response said so.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM staging.org_member_modules "
                "WHERE user_id=$1 AND org_id=$2::uuid",
                target_user_id, org_id,
            )
            for code, level in grants:
                await conn.execute(
                    "INSERT INTO staging.org_member_modules "
                    "(user_id, org_id, module_code, role, granted_by) "
                    "VALUES ($1, $2::uuid, $3, $4, $5)",
                    target_user_id, org_id, code, level, user["user_id"],
                )

    await _audit_grants(
        request, org_id=org_id, actor=user["user_id"],
        target_user_id=target_user_id,
        before=before, after=dict(grants), via="org_members.set_modules",
        caller_org_role=caller_role, org_has_owner=org_has_owner,
    )

    return {
        "status": "updated",
        "modules": [c for c, _ in grants],
        "module_grants": [{"code": c, "role": r} for c, r in grants],
    }


@router.get("/search")
async def search_user(
    email: str = Query(...),
    user=Depends(require_org_role("org_admin", "org_owner")),
):
    """Search for a user by email (for add-member flow)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT user_id, email, COALESCE(full_name, name) AS full_name, avatar AS avatar_url "
        # A system account answers exactly like a nonexistent one -- the 404
        # below -- so the add-member flow can never even see it.
        "FROM users WHERE LOWER(email)=LOWER($1) AND NOT COALESCE(is_system, FALSE)",
        email,
    )
    if not row:
        raise HTTPException(404, "No account found with that email")
    return dict(row)
