"""
invite_router.py — Kartavaya by Aekam Inc
Admin-only invite system. No public registration.
"""
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from db import get_pool
from middleware.roles import require_platform_role
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES, GOD_MODE_ROLES, MANAGER_ROLES, STAFF_ROLES,
    SUPERUSER_ONLY_ROLES, strongest,
)

# Who may open the platform console. Reaching the console is not the same as
# reading what is in it — role_tiers.can_reach_module still decides that per
# module, so a platform_staff who opens an org sees the operating set and not
# its payroll.
CONSOLE_ROLES = GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + ("account_manager",)
CONSOLE_ROLES_WITH_FINANCE = CONSOLE_ROLES + ("account_finance",)


_require_admin = require_platform_role(*CONSOLE_ROLES)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# The APP, not the marketing site. See email_service.FRONTEND_URL.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://app.kartavaya.com").rstrip("/")


# ── The account-type ladder ───────────────────────────────────────────────────
#
# `users.role` is the LEGACY account type, not a tier in the four-tier model. It
# is not dead: `approvals_router.py:402,610` and `server.py:345,1134` still read
# it, so a user created at `admin` can approve work and act as a team admin.
#
# Which means minting one is a role grant, and role_tiers.py:138-141 is explicit
# about those: "Role assignment in particular must never be delegated — a role
# that can grant roles can grant itself anything." So the top rung is
# SUPERUSER_ONLY_ROLES. The lower two are open to the whole console.
#
# Before this, `create_invite`, `update_user` and `change_user_role` each
# validated `role in ("admin","member","client")` and stopped there — no
# comparison against the caller at all. A platform_staff, whose entire remit is
# the operating set (CRM, marketing, Srijan), could invite an `admin` and then
# sign in as them.
ACCOUNT_TYPES: tuple[str, ...] = ("client", "member", "admin")

#: Account types any console role may hand out.
DELEGABLE_ACCOUNT_TYPES: frozenset[str] = frozenset({"client", "member"})


async def _caller_platform_role(pool, user_id: str) -> str | None:
    """The caller's strongest platform role, or None."""
    rows = await pool.fetch(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
        user_id, list(ALL_PLATFORM_ROLES),
    )
    return strongest([r["role_code"] for r in rows])


async def _assert_may_grant(pool, caller: dict, account_type: str) -> None:
    """Refuse an account type the caller is not senior enough to hand out."""
    if account_type not in ACCOUNT_TYPES:
        raise HTTPException(400, "Role must be 'admin', 'member', or 'client'")
    if account_type in DELEGABLE_ACCOUNT_TYPES:
        return
    role = await _caller_platform_role(pool, caller["user_id"])
    if role not in SUPERUSER_ONLY_ROLES:
        raise HTTPException(
            403,
            "Only a platform owner may create an admin account. "
            "Invite them as a member and have an owner raise the account type.",
        )


async def _assert_target_not_platform(pool, caller: dict, target_user_id: str,
                                      what: str) -> None:
    """Refuse to touch a user who holds a platform role, unless the caller is god mode.

    Without this, every write below is a lateral escalation: `remove_user` is
    guarded by CONSOLE_ROLES, so a platform_staff could delete a platform_owner's
    account outright, and `update_user` could re-point their email.
    """
    target_role = await _caller_platform_role(pool, target_user_id)
    if not target_role:
        return
    caller_role = await _caller_platform_role(pool, caller["user_id"])
    if caller_role not in SUPERUSER_ONLY_ROLES:
        raise HTTPException(
            403,
            f"{what} a user who holds the {target_role} platform role requires "
            "a platform owner.",
        )


# ── TENANCY ───────────────────────────────────────────────────────────────────
#
# Everything above this line is a SENIORITY ceiling: it asks whether the caller
# outranks the target. None of it asks the prior question — whether the target is
# any of the caller's business at all. So `GET /api/admin/users` was
#
#     SELECT … FROM users ORDER BY created_at DESC
#
# with no predicate whatsoever, and PATCH / PUT / DELETE reached the same
# unbounded set by id. Measured on the live database 2026-08-05: 20 user rows,
# and all ten platform accounts could read, edit and delete every one. Nine of
# those accounts belong to Aekam Inc alone; the rows they had no business seeing
# are Unicode Group's five members and the test org's six.
#
# The owner's specification is narrow and was stated directly, so it is quoted
# rather than paraphrased: "no one should be able to see any other org data even
# god mode users — such as org members list or what their cap is. God mode can
# only switch between orgs if they are part of it." The entire permitted
# cross-org surface for a platform account is the NUMBER of users under an org,
# inviting an org admin, and changing the org's point-of-contact address. A
# member LIST is not on it, and god mode does not widen it.
#
# ── WHY THIS IS A JOIN AND NOT A WHERE CLAUSE ────────────────────────────────
#
# `public.users` HAS NO org_id COLUMN — verified against the live catalog, not
# assumed. Tenancy lives one table over in `staging.user_roles`, which is the
# sole tenant path since the legacy `team_members` fallback was removed
# 2026-07-23. So "which org is this user in" is `EXISTS (SELECT 1 FROM
# staging.user_roles …)`, and a user can legitimately be in several: one live
# account is a member of all three orgs and must keep seeing all three.
#
# Note the two schemas. `users`, `invites` and `teams` are in `public`;
# `user_roles` and `organisations` are in `staging`. The unqualified names below
# are `public` via search_path and are left as they were found.


async def _org_ids_for(pool, user_id: str) -> frozenset[str]:
    """Every org this user belongs to. Empty frozenset for an org-less account."""
    rows = await pool.fetch(
        "SELECT DISTINCT org_id::text AS org_id FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL",
        user_id,
    )
    return frozenset(r["org_id"] for r in rows)


def may_reach_user(caller_orgs: frozenset[str], target_orgs: frozenset[str]) -> bool:
    """The whole tenancy decision for this file, as a pure function.

    Deliberately pure, and deliberately not inlined into the handlers. The suite
    mocks the pool and a mocked cursor answers any table name it is handed, so an
    HTTP test can only prove that a handler ASKED for something — it cannot prove
    the answer was right. The rule itself is therefore expressed here, where a
    test can drive it directly with no database in the way.

    A caller may reach a target when they share at least one organisation.

    ── AND WHEN THE TARGET BELONGS TO NOBODY ────────────────────────────────────

    An org-less user is reachable, and that is a decision rather than an
    accident. `create_invite` on THIS router mints exactly such accounts: it
    writes an invite with a NULL org_id, and `auth_router.accept_invite` then
    creates the user and — for a platform invite — writes no org row at all. An
    org-less user is therefore a first-class object of this console, not stray
    data. Two exist right now, and one of them
    (`kevalvshah03+qaviewer@gmail.com`) holds no platform role either: it is
    nobody's tenant and nobody's colleague.

    Dropping them would make this screen a machine that creates accounts it
    cannot then see — invite somebody, watch them accept, and watch them vanish
    from the only page that could fix or remove them. That is a worse bug than
    the one being closed here, and a silent one.

    It leaks nothing, which is the test that matters: a user with no org row
    discloses no organisation's roster, no cap and no membership. Seniority is
    still enforced on top — `_assert_target_not_platform` runs on every write, so
    the org-less platform_admin in the data (sid@aekaminc.com) is reachable only
    by a platform owner, exactly as before.

    The consequence to be honest about: a platform account belonging to NO org
    now sees only org-less users. That is the specification working as written —
    "god mode can only switch between orgs if they are part of it" — and the
    remedy is a membership row for that person, which is a data change and not a
    code change.
    """
    if not target_orgs:
        return True
    return bool(caller_orgs & target_orgs)


async def _assert_shares_org(pool, caller: dict, target_user_id: str,
                             what: str) -> None:
    """Refuse to touch a user in an organisation the caller does not belong to.

    The 404-shaped message is deliberate. Answering "you do not share an
    organisation with this user" to a probe against a guessed id confirms that
    the id exists and that somebody owns it, which turns every write route on
    this file into a membership oracle for orgs the caller cannot see.
    """
    if may_reach_user(await _org_ids_for(pool, caller["user_id"]),
                      await _org_ids_for(pool, target_user_id)):
        return
    raise HTTPException(404, f"{what} failed: no such user.")


# ── Schemas ───────────────────────────────────────────────────────────────────

class InviteCreate(BaseModel):
    email: EmailStr
    role: str = "member"                       # account type: admin | member | client
    full_name: Optional[str] = None
    member_role: Optional[str] = None          # job title / position
    receives_approval_emails: bool = True      # client approval emails


class InviteOut(BaseModel):
    """Returned by `create_invite` ONLY — it is the one response that carries the
    redemption link, and only to the person who just created it."""
    invite_id: str
    email: str
    role: str
    invite_link: str
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    full_name: Optional[str] = None
    member_role: Optional[str] = None
    receives_approval_emails: Optional[bool] = True
    invited_by_name: Optional[str] = None


class InviteListOut(BaseModel):
    """The listing shape. Deliberately has no `invite_link` and no `token`
    field — a response model without them cannot leak them by accident later."""
    invite_id: str
    email: str
    role: str
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    full_name: Optional[str] = None
    member_role: Optional[str] = None
    receives_approval_emails: Optional[bool] = True
    invited_by_name: Optional[str] = None


class UserOut(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    full_name: Optional[str] = None
    role: str
    position: Optional[str] = None
    company_name: Optional[str] = None
    member_role: Optional[str] = None
    receives_approval_emails: Optional[bool] = True
    avatar: Optional[str] = None
    org_name: Optional[str] = None
    org_id: Optional[str] = None
    created_at: datetime


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    member_role: Optional[str] = None          # job title / position
    company_name: Optional[str] = None
    receives_approval_emails: Optional[bool] = None


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=List[UserOut])
async def list_users(pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Users the caller shares an organisation with, plus org-less accounts.

    This endpoint used to be `SELECT … FROM users ORDER BY created_at DESC` — no
    predicate at all — behind a Tier-1 role check. It returned every account on
    the platform with name, email, job title and company to any of the ten
    platform accounts, which is the member list the specification puts furthest
    out of bounds.

    The two subqueries below are the two halves of `may_reach_user`, and the
    reasoning for the second one — why an account belonging to nobody is shown
    rather than silently dropped — is written out in full on that function.

    An empty `$1` is correct rather than degenerate: `= ANY('{}'::uuid[])` is
    false for every row, so a caller who belongs to no organisation sees exactly
    the org-less accounts and nothing else.
    """
    caller_orgs = await _org_ids_for(pool, admin["user_id"])
    rows = await pool.fetch(
        """SELECT u.user_id, u.email, u.name, u.full_name, u.role, u.position,
                  u.company_name, u.member_role, u.receives_approval_emails,
                  u.avatar, u.created_at,
                  o.name AS org_name, o.id::text AS org_id
           FROM users u
           LEFT JOIN LATERAL (
               SELECT r.org_id
               FROM staging.user_roles r
               WHERE r.user_id = u.user_id AND r.org_id IS NOT NULL
               LIMIT 1
           ) lr ON TRUE
           LEFT JOIN staging.organisations o ON o.id = lr.org_id
           WHERE EXISTS (SELECT 1 FROM staging.user_roles r
                          WHERE r.user_id = u.user_id
                            AND r.org_id = ANY($1::uuid[]))
              OR NOT EXISTS (SELECT 1 FROM staging.user_roles r2
                              WHERE r2.user_id = u.user_id
                                AND r2.org_id IS NOT NULL)
           ORDER BY u.created_at DESC""",
        list(caller_orgs),
    )
    return [UserOut(**dict(r)) for r in rows]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: str, body: UserUpdate, pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Edit a user's profile fields. Email is immutable."""
    await _assert_shares_org(pool, admin, user_id, "Editing")
    await _assert_target_not_platform(pool, admin, user_id, "Editing")

    # Build dynamic SET clause for only provided fields
    fields, vals = [], []
    if body.full_name is not None:
        fields.append(f"full_name=${len(vals)+1}"); vals.append(body.full_name)
    if body.role is not None:
        await _assert_may_grant(pool, admin, body.role)
        fields.append(f"role=${len(vals)+1}"); vals.append(body.role)
    if body.member_role is not None:
        fields.append(f"member_role=${len(vals)+1}"); vals.append(body.member_role)
    if body.company_name is not None:
        fields.append(f"company_name=${len(vals)+1}"); vals.append(body.company_name)
    if body.receives_approval_emails is not None:
        fields.append(f"receives_approval_emails=${len(vals)+1}"); vals.append(body.receives_approval_emails)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    # ── WHO MADE THIS PERSON AN ADMIN ───────────────────────────────────────
    #
    # `body.role` above writes `users.role`, which is a PER-ORG fact stored in
    # one global column, and until 202 nothing anywhere recorded who granted it.
    # `_assert_may_grant` decides whether the caller MAY escalate somebody; this
    # column is the only record afterwards that they DID. It is the most
    # load-bearing audit column in this batch for exactly that reason.
    #
    # The actor is the ADMIN, never the target: this endpoint is one account
    # editing another's row, and stamping the target would turn every admin
    # escalation into a self-service profile edit in the trail. (The self-service
    # paths — `auth_router`'s password writes — are the mirror case and record
    # the account itself, which is a different true answer, not this one.)
    #
    # Appended after the field loop and BEFORE the id, so it takes the number
    # the loop would have used next and the WHERE clause still reads
    # `len(vals)`. Both numbers come from the same counter that built every
    # clause above — hardcoding either is how a user id ends up bound into a
    # profile column.
    fields.append(f"updated_by=${len(vals)+1}")
    vals.append(admin["user_id"])

    vals.append(user_id)
    await pool.execute(
        f"UPDATE public.users SET {', '.join(fields)}, updated_at=NOW() "
        f"WHERE user_id=${len(vals)}",
        *vals
    )
    row = await pool.fetchrow(
        """SELECT user_id, email, name, full_name, role, position, company_name,
                  member_role, receives_approval_emails, avatar, created_at
           FROM users WHERE user_id=$1""", user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(**dict(row))


@router.put("/users/{user_id}/role")
async def change_user_role(user_id: str, body: dict, pool=Depends(get_pool), admin=Depends(_require_admin)):
    role = body.get("role")
    await _assert_may_grant(pool, admin, role)
    await _assert_shares_org(pool, admin, user_id, "Changing the role of")
    await _assert_target_not_platform(pool, admin, user_id, "Changing the role of")
    # The second door onto `users.role`, and it gets the same stamp as
    # `update_user` for the same reason: this endpoint exists only to change a
    # person's role, so an unstamped write here would leave the single most
    # consequential edit in the file as the one nobody can be asked about.
    # $3 is the admin who granted it, never the account that received it.
    await pool.execute(
        "UPDATE public.users SET role=$1, updated_at=NOW(), updated_by=$3 "
        "WHERE user_id=$2",
        role, user_id, admin["user_id"],
    )
    return {"ok": True}


@router.delete("/users/{user_id}")
async def remove_user(user_id: str, reassign_to: Optional[str] = None, pool=Depends(get_pool), admin=Depends(_require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    await _assert_shares_org(pool, admin, user_id, "Deleting")
    await _assert_target_not_platform(pool, admin, user_id, "Deleting")
    if reassign_to == user_id:
        raise HTTPException(status_code=400, detail="Cannot reassign to the same user")
    if reassign_to:
        # The reassign target is scoped too, and for a reason that is not the
        # same as the one above. This route does not merely delete: it rewrites
        # authorship across tasks, approvals, time entries, comments and
        # automations to point at `reassign_to`. An unscoped id here would let a
        # caller move one org's work under a person in another org — writing
        # cross-tenant rows through a parameter that reads like a tidy-up.
        await _assert_shares_org(pool, admin, reassign_to, "Reassigning to")
        target = await pool.fetchrow(
            "SELECT user_id, role FROM users WHERE user_id=$1", reassign_to
        )
        if not target:
            raise HTTPException(status_code=404, detail="Reassign target user not found")
        # Prevent reassigning to a client account — clients should not appear
        # as task creators or team leads.
        if target["role"] == "client":
            raise HTTPException(status_code=400, detail="Cannot reassign work to a client account")

    r = reassign_to  # shorthand

    # Run each cleanup statement on its own connection (auto-commit).
    # Never share a transaction across optional cleanup — a failed statement
    # inside a Postgres transaction aborts the entire block, and there is no
    # way to recover with plain try/except.
    async def run(sql, *args):
        """Execute one statement, silently ignore any error."""
        try:
            async with pool.acquire() as c:
                await c.execute(sql, *args)
        except Exception:
            pass

    # ── Memberships (remove — cannot transfer) ────────────────────────────────
    await run("DELETE FROM team_members        WHERE user_id=$1", user_id)
    await run("DELETE FROM project_assignments WHERE user_id=$1", user_id)
    await run("DELETE FROM task_clients        WHERE user_id=$1", user_id)

    # ── Activity events ───────────────────────────────────────────────────────
    if r: await run("UPDATE activity_events SET actor_id=$1   WHERE actor_id=$2",  r, user_id)
    else: await run("DELETE FROM activity_events               WHERE actor_id=$1",  user_id)

    # ── Time entries ──────────────────────────────────────────────────────────
    if r: await run("UPDATE time_entries SET user_id=$1        WHERE user_id=$2",   r, user_id)
    else: await run("DELETE FROM time_entries                  WHERE user_id=$1",   user_id)

    # ── Comments (try both table/column name variants) ────────────────────────
    # Allowlist guards against future drift — never add entries with user-controlled values.
    _ALLOWED_COMMENT_TABLES = frozenset({("task_comments", "user_id"), ("comments", "author_id")})
    for tbl, col in [("task_comments", "user_id"), ("comments", "author_id")]:
        if (tbl, col) not in _ALLOWED_COMMENT_TABLES:
            continue
        if r: await run(f"UPDATE {tbl} SET {col}=$1 WHERE {col}=$2", r, user_id)
        else: await run(f"DELETE FROM {tbl}          WHERE {col}=$1",    user_id)

    # ── Tasks: created_by_user_id ─────────────────────────────────────────────
    if r:
        await run("UPDATE tasks SET created_by_user_id=$1 WHERE created_by_user_id=$2", r, user_id)
    else:
        # Per-team fallback to owner/admin
        try:
            async with pool.acquire() as c:
                task_teams = await c.fetch(
                    "SELECT DISTINCT team_id FROM tasks WHERE created_by_user_id=$1", user_id
                )
                for tt in task_teams:
                    tid = tt["team_id"]
                    fallback = await c.fetchval("""
                        SELECT user_id FROM project_assignments
                        WHERE team_id=$1 AND role IN ('owner','admin') AND user_id != $2
                        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1
                    """, tid, user_id)
                    await c.execute(
                        "UPDATE tasks SET created_by_user_id=$1 WHERE created_by_user_id=$2 AND team_id=$3",
                        fallback, user_id, tid
                    )
        except Exception:
            pass

    # ── Tasks: user_id column (may have FK) ───────────────────────────────────
    if r: await run("UPDATE tasks SET user_id=$1             WHERE user_id=$2",              r, user_id)
    else: await run("UPDATE tasks SET user_id=NULL           WHERE user_id=$1",              user_id)

    # ── Tasks: assigned_by_user_id ────────────────────────────────────────────
    if r: await run("UPDATE tasks SET assigned_by_user_id=$1 WHERE assigned_by_user_id=$2", r, user_id)
    else: await run("UPDATE tasks SET assigned_by_user_id=NULL WHERE assigned_by_user_id=$1", user_id)

    # ── Tasks: assignee_user_ids[] ────────────────────────────────────────────
    if r:
        await run("""
            UPDATE tasks
            SET assignee_user_ids = array_append(array_remove(assignee_user_ids,$1), $2)
            WHERE $1=ANY(assignee_user_ids) AND NOT ($2=ANY(assignee_user_ids))
        """, user_id, r)
    await run(
        "UPDATE tasks SET assignee_user_ids=array_remove(assignee_user_ids,$1) WHERE $1=ANY(assignee_user_ids)",
        user_id
    )

    # ── Task assignees junction table ─────────────────────────────────────────
    if r: await run("UPDATE task_assignees SET user_id=$1 WHERE user_id=$2", r, user_id)
    else: await run("DELETE FROM task_assignees            WHERE user_id=$1",   user_id)

    # ── Approvals ─────────────────────────────────────────────────────────────
    if r:
        await run("UPDATE approvals SET requested_by=$1 WHERE requested_by=$2", r, user_id)
        await run("UPDATE approvals SET approved_by=$1   WHERE approved_by=$2",  r, user_id)
    else:
        await run("UPDATE approvals SET requested_by=NULL WHERE requested_by=$1", user_id)
        await run("UPDATE approvals SET approved_by=NULL   WHERE approved_by=$1",  user_id)

    # ── Report schedules — REMOVED, the table is retired ──────────────────────
    #
    # These two ran `UPDATE report_schedules` / `DELETE FROM report_schedules`
    # UNQUALIFIED, resolving through `search_path` ("$user", public, extensions
    # — read live 2026-08-27) to `public.report_schedules`. That table is retired
    # (owner, 2026-08-27) and is being dropped, so both statements would raise
    # 42P01 undefined_table on every user deletion from the moment the DROP
    # lands.
    #
    # They would not have BROKEN deletion — `run()` above swallows every
    # exception on purpose, so the failure would have been invisible rather than
    # loud, which is worse: a permanent, silent 42P01 on the user-deletion path
    # that nobody would find until they went looking for something else.
    #
    # Nothing replaces them. The surviving scheduled-report table,
    # `staging.dristi_scheduled_reports`, is org-scoped and its `created_by` is
    # deliberately NOT reassigned on user deletion: the sweep re-checks the
    # OWNER'S module entitlements on every tick
    # (`services/report_schedule_window.py:blocked_reason`), so moving ownership
    # to whoever inherits the leaver's work would silently re-authorise a
    # schedule the leaver could no longer run. A dangling `created_by` makes the
    # sweep skip the row and say why, which is the correct outcome.

    # ── Automations ───────────────────────────────────────────────────────────
    if r: await run("UPDATE automations SET created_by=$1 WHERE created_by=$2", r, user_id)
    else: await run("DELETE FROM automations              WHERE created_by=$1",    user_id)

    # ── Invites ───────────────────────────────────────────────────────────────
    if r: await run("UPDATE public.invites SET invited_by=$1 WHERE invited_by=$2", r, user_id)
    else: await run("UPDATE public.invites SET invited_by=NULL WHERE invited_by=$1", user_id)
    await run("DELETE FROM public.invites WHERE email=(SELECT email FROM users WHERE user_id=$1)", user_id)

    # ── Sessions / tokens ─────────────────────────────────────────────────────
    for tbl in ("refresh_tokens", "sessions"):
        await run(f"DELETE FROM {tbl} WHERE user_id=$1", user_id)

    # ── Delete the user (final, must succeed) ─────────────────────────────────
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM users WHERE user_id=$1", user_id)

    return {"ok": True}


# ── Invites ───────────────────────────────────────────────────────────────────

@router.post("/invites", response_model=InviteOut)
async def create_invite(body: InviteCreate, pool=Depends(get_pool), admin=Depends(_require_admin)):
    await _assert_may_grant(pool, admin, body.role)

    existing = await pool.fetchrow("SELECT 1 FROM users WHERE email=$1", body.email.lower())
    if existing:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    # Expire old pending invites for same email
    await pool.execute(
        "UPDATE public.invites SET expires_at=NOW() WHERE email=$1 AND accepted_at IS NULL",
        body.email.lower(),
    )

    token      = secrets.token_urlsafe(32)
    invite_id  = f"inv_{uuid.uuid4().hex[:12]}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    await pool.execute(
        """INSERT INTO public.invites
               (invite_id, email, role, token, invited_by, expires_at,
                full_name, member_role, receives_approval_emails)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
        invite_id, body.email.lower(), body.role, token, admin["user_id"], expires_at,
        body.full_name or None, body.member_role or None, body.receives_approval_emails,
    )

    invite_link = f"{FRONTEND_URL}/accept-invite?token={token}"

    try:
        from email_service import send_invite_email
        inviter_name   = admin.get("full_name") or admin.get("name") or admin.get("email", "An admin")
        inviter_role   = (admin.get("role") or "admin").capitalize()
        workspace_name = admin.get("company_name")
        if not workspace_name:
            # This fallback used to be:
            #
            #     SELECT company_name FROM users WHERE company_name IS NOT NULL LIMIT 1
            #
            # An unordered, unfiltered pick of ONE arbitrary row from the whole
            # users table, whose value is then printed in an email to somebody
            # outside the company. It leaks a customer's name to a stranger, and
            # the direction it leaks in is chosen by whatever Postgres returns
            # first — today "Aekam INC", tomorrow whichever row a vacuum moves.
            # It is also just wrong: it names an organisation the invitee is not
            # being invited to.
            #
            # Resolved from the INVITER's own membership instead, ordered the
            # same way `org_resolver.get_org_id` orders its fallback so the two
            # cannot disagree about which org a person primarily belongs to.
            workspace_name = await pool.fetchval(
                "SELECT o.name FROM staging.user_roles r "
                "JOIN staging.organisations o ON o.id = r.org_id "
                "WHERE r.user_id=$1 AND r.org_id IS NOT NULL "
                "ORDER BY r.granted_at LIMIT 1",
                admin["user_id"],
            ) or "Kartavaya"
        expires_label  = expires_at.strftime("%b %-d, %Y")
        send_invite_email(body.email.lower(), inviter_name, body.role, token,
                          workspace_name=workspace_name,
                          expires_label=expires_label,
                          recipient_name=body.full_name or "",
                          inviter_role=inviter_role)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("invite email failed: %s", exc)

    inviter_name = admin.get("full_name") or admin.get("name") or admin.get("email")

    return InviteOut(
        invite_id=invite_id,
        email=body.email.lower(),
        role=body.role,
        invite_link=invite_link,
        created_at=datetime.now(timezone.utc),
        expires_at=expires_at,
        accepted_at=None,
        full_name=body.full_name or None,
        member_role=body.member_role or None,
        receives_approval_emails=body.receives_approval_emails,
        invited_by_name=inviter_name,
    )


@router.get("/invites", response_model=List[InviteListOut])
async def list_invites(pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Pending and accepted invites. **Never carries the token.**

    This endpoint used to select `i.token` and hand back a ready-made
    `/accept-invite?token=…` link for every invite in the system, 100 at a time,
    to anyone holding CONSOLE_ROLES — which includes platform_staff and
    account_manager.

    `POST /api/auth/accept-invite` asks for nothing but that token: it looks the
    invite up by it, creates the account, and sets whatever password the caller
    supplies. So the list was a set of live credentials for every account that
    had not been claimed yet, readable by roles whose remit is CRM and
    marketing. The token is 256 bits from `secrets.token_urlsafe(32)` and cannot
    be guessed — it did not need to be.

    The link is still returned once, by `create_invite`, to the person who
    created it. That is the only party who should ever hold it.

    ── AND IT IS NOW SCOPED ─────────────────────────────────────────────────────

    Withholding the token fixed the credential leak but left the roster leak: the
    listing still named every invited address on the platform. Measured on the
    live database, 35 invite rows — 20 of them belonging to Unicode Group and the
    test org, including 7 still-live pending invitations, none of them Aekam's.
    Who an organisation is hiring is exactly the "privacy and reputation concern"
    the specification is about, and an email address is disclosed whether or not
    a token rides along with it.

    `invites.org_id` arrived with the org-scoped invite work and is confirmed
    present on the live database, so it can be named directly — as
    `org_invites.py` already does. A NULL org_id is a PLATFORM invite, which is
    the only kind this router creates; those stay visible for the same reason
    org-less users do, and 15 of the 35 are exactly that.
    """
    caller_orgs = await _org_ids_for(pool, admin["user_id"])
    rows = await pool.fetch(
        """SELECT i.invite_id, i.email, i.role, i.created_at, i.expires_at,
                  i.accepted_at, i.full_name, i.member_role, i.receives_approval_emails,
                  COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unnamed member') AS invited_by_name
           FROM public.invites i
           LEFT JOIN users u ON u.user_id = i.invited_by
           WHERE i.org_id IS NULL OR i.org_id = ANY($1::uuid[])
           ORDER BY i.created_at DESC LIMIT 100""",
        list(caller_orgs),
    )
    return [InviteListOut(**dict(r)) for r in rows]


@router.post("/users/{user_id}/send-reset-link")
async def admin_send_reset_link(user_id: str, pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Admin action: generate a password-reset link and email it to the user.

    Scoped, and it is a write rather than a read despite the name. The statement
    below OVERWRITES `password_reset_token` and re-dates its expiry, so an
    unscoped call against another org's member both mails that person an
    unsolicited reset they did not ask for — from a stranger's console — and
    invalidates any legitimate reset they had in flight, which is a denial of
    service that looks to the victim like the product is broken.
    """
    await _assert_shares_org(pool, admin, user_id, "Sending a reset link to")
    await _assert_target_not_platform(pool, admin, user_id, "Sending a reset link to")
    user = await pool.fetchrow("SELECT user_id, name, email FROM users WHERE user_id=$1", user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    reset_token = secrets.token_urlsafe(32)
    await pool.execute(
        # STAMPED, and the docstring above is the argument: this is a WRITE
        # despite the name. It mints a live credential against somebody else's
        # account and invalidates any reset they had in flight, and it is the
        # one path in this file by which an administrator could take an account
        # over. `updated_by` is the only record on the row that the token was
        # minted by an admin rather than requested by the account itself —
        # `auth_router`'s self-service reset writes the same column and leaves
        # `updated_by` alone, so the two are told apart by exactly this.
        #
        # `updated_at` deliberately NOT touched: nothing about the person's
        # record changed, and moving it would report a profile edit that did not
        # happen on every reset link an admin sends.
        """UPDATE public.users SET password_reset_token=$1,
           password_reset_expires=NOW() + INTERVAL '1 hour',
           updated_by=$3
           WHERE user_id=$2""",
        reset_token, user_id, admin["user_id"],
    )
    try:
        from email_service import send_password_reset_email
        send_password_reset_email(user["email"], user["name"] or user["email"], reset_token)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("reset email failed: %s", exc)
    return {"ok": True}


@router.delete("/invites/{invite_id}")
async def revoke_invite(invite_id: str, pool=Depends(get_pool), admin=Depends(_require_admin)):
    """Revoke an invite this console can see.

    The org predicate is the access control, not a filter — the same point
    `org_invites.revoke_org_invite` makes about its own DELETE. Without it, an id
    is enough to cancel another organisation's pending invitation: their new hire
    clicks a dead link, and nothing anywhere says why. Seven such invitations are
    live on the database today and none of them are Aekam's.

    The row count decides the answer, so a miss cannot be distinguished from an
    id that never existed.
    """
    caller_orgs = await _org_ids_for(pool, admin["user_id"])
    result = await pool.execute(
        "DELETE FROM public.invites WHERE invite_id=$1 "
        "AND (org_id IS NULL OR org_id = ANY($2::uuid[]))",
        invite_id, list(caller_orgs),
    )
    # asyncpg returns the command tag ("DELETE 0"). Treat only a literal zero as
    # a miss: a mocked pool in the suite returns a Mock, and a guard that read
    # anything truthy as success would be satisfied by the mock rather than by
    # the database.
    if isinstance(result, str) and result.strip().endswith(" 0"):
        raise HTTPException(404, "No such invite.")
    return {"ok": True}


# ── R2 folder map ───────────────────────────────────────────────────────────

class TeamFolderOut(BaseModel):
    team_id: str
    name: str
    r2_folder: str   # path prefix this project's files are stored under in R2


@router.get("/teams", response_model=List[TeamFolderOut])
async def list_team_folders(pool=Depends(get_pool), admin=Depends(_require_admin)):
    """team_id → project name lookup, so an admin can identify R2 folders
    (which are keyed by team_id, e.g. projects/{team_id}/...) without
    needing direct database access.

    A project NAME is org data — the specification's list of things a platform
    account may not see across orgs ends "or any module data", and these names
    are client engagements. Unscoped, this returned all 27 live projects to every
    console account; 3 of them belong to the other two organisations.

    ── THE UNATTRIBUTED ROWS ARE TREATED DIFFERENTLY HERE, ON PURPOSE ───────────

    Two live teams have a NULL org_id, and unlike an org-less USER that is not a
    first-class object — nothing in the product creates a team belonging to no
    organisation. They are un-backfilled rows, and their names are real client
    engagements, so they could belong to anyone and showing them to everyone is a
    guess made in the leaking direction.

    They are not dropped either, because then two R2 folders become permanently
    unidentifiable through the only screen built to identify them. They go to god
    mode: the operator who can actually fix the backfill still sees them, and
    nobody else infers a customer name from a row the database cannot attribute.
    """
    caller_orgs = await _org_ids_for(pool, admin["user_id"])
    include_unattributed = (
        await _caller_platform_role(pool, admin["user_id"]) in GOD_MODE_ROLES
    )
    rows = await pool.fetch(
        "SELECT team_id, name FROM teams "
        "WHERE deleted_at IS NULL "
        "  AND (org_id = ANY($1::uuid[]) OR ($2::boolean AND org_id IS NULL)) "
        "ORDER BY name",
        list(caller_orgs), include_unattributed,
    )
    return [
        TeamFolderOut(team_id=r["team_id"], name=r["name"], r2_folder=f"projects/{r['team_id']}/")
        for r in rows
    ]
