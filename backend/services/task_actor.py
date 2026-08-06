"""
task_actor.py — WHO may write a task, written down once.

`task_transitions.py` answers WHAT a task may become. This answers WHO is
allowed to say so. They are two questions and they are deliberately two modules;
the reason is in the next section, and it is the whole design.

WHY THIS IS NOT INSIDE `assert_transition`
──────────────────────────────────────────
`assert_transition` is a STATUS state machine, and its first line is

    if new_status is None:
        return

Measured before this module existed, as a Tier-3 `client` on a project:

    PUT /api/tasks/{id} {"title":"Edited by the client","status":"in_progress"}  -> 200
    PUT /api/tasks/{id} {"title":"Edited by the client"}                         -> 200

The second request names no status, so it never reaches a single check in that
file. Neither do attachments, subtasks, reminders, archive, or column CRUD —
none of them carry a status at all. A client rule bolted into `assert_transition`
would have guarded the MINORITY of writes that happen to mention a status, while
reading, at every call site, as enforced.

That is the exact shape that shipped two hours before this file was written: an
approval gate guarded on six writers and bypassable on the seventh. So: a
sibling module, the same discipline — ONE predicate, called by every writer,
with a file-level sweep in `tests/test_client_tier_enforcement.py` that fails
when a thirteenth writer appears without it.

WHAT A `client` IS
──────────────────
Tier 3 of the role model: an EXTERNAL party invited to a project so they can see
their own work, approve it, and talk about it. Not a cheaper member. The product
already says so in three places — `routers/time_entries.py` refuses them,
`server.client_request_task` exists precisely because they cannot create a task
directly, and the client portal is a read surface — but the twelve task writers
in `server.py` asked only "is this person in the project", which a client is by
design.

TWO WAYS TO BE ONE, AND BOTH HAD TO BE COVERED
──────────────────────────────────────────────
  1. A `client` row in `project_assignments` or `team_members` — the client of
     a project.
  2. A `task_clients` row and NO project row — someone the client-approval
     forward reached. `server.client_can_access_task` is the FALLBACK on
     `PUT /api/tasks/{id}`, so that row was a WRITE grant, and its own docstring
     said so ("permitted to read/write this task").

Resolving the role from the project tables alone would answer `None` for case 2
and wave them straight through — a hole inside the fix. Both are checked here.

WHAT IT COSTS, READ OFF THE LIVE DATABASE BEFORE THE GUARD WAS WRITTEN
──────────────────────────────────────────────────────────────────────
2026-08-06, SELECT only against the shared `staging` schema:

    project_assignments   owner 56 · member 9 · client 2 · admin 1
    team_members (active) member 135 · owner 38 · client 2 · admin 2
    users.role            member 12 · admin 6 · client 2
    task_clients          0 rows

The two `client` rows in each table are the SAME two accounts, both on
team_95beaa7529a9, and `auth_router` copies `team_members.role` straight into
`project_assignments` — so a staff member could have been carrying
`role='client'` by data accident and been refused something that worked. None
is. `task_clients` is empty, so case 2 has never happened and the forward has
never been used. The refusal is two accounts on one project.

NO MIGRATION, AND THAT IS ON PURPOSE
────────────────────────────────────
Every column this reads — `project_assignments.role`, `team_members.role`,
`task_clients.user_id` — has existed since migration 001. There is one `staging`
schema and production writes to it, so a fix that needed a column would be
inert on production until somebody applied DDL by hand. This one is live the
moment it deploys, and the 121-125 migration range stays unused.

REFUSALS ARE STRINGS
────────────────────
Every task and approval surface renders `e?.response?.data?.detail || '…'`
straight into a toast. `HTTPException` with a plain sentence, never a Pydantic
validation error, whose `detail` is a list of dicts that renders as nothing.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

# ── The role model, Tier 3 ───────────────────────────────────────────────────

#: The one project role that may read a project and not write it.
CLIENT = "client"

#: Roles that may write. Stated as a closed set rather than as "not client" so
#: a future fourth role is refused until somebody decides about it, rather than
#: silently inheriting write access from a `!=` that nobody revisited.
WRITER_ROLES = ("owner", "admin", "member")


# ── Refusal copy ─────────────────────────────────────────────────────────────
# One sentence, and it says what to do instead. These reach the user verbatim.

CLIENT_READ_ONLY = (
    "Your access to this project is client access, which is view-and-approve "
    "only. Ask the team to make this change, or leave a comment on the task."
)

NOT_A_PROJECT_CLIENT = (
    "That person is not a client of this project. Add them to the project as a "
    "client first — only someone on the project's client list can be sent a "
    "task for approval."
)


# ── Resolving the role, at request time, from the database ───────────────────


def _role_of(row) -> Optional[str]:
    """Read `role` off a row without assuming the row has one.

    `row["role"]` raises `KeyError` on a row shaped differently from the query
    that was written — and a guard that raises inside the check turns a refusal
    into a 500. It also fails in the most confusing possible place: the stack
    points at the guard, so the guard looks like the bug.

    `asyncpg.Record` supports `.get`, and so does `dict`. Anything else is not
    a row and has no role.
    """
    if row is None:
        return None
    try:
        return row.get("role")
    except (AttributeError, TypeError):
        return None


async def project_role(pool, team_id: Optional[str], user_id: str) -> Optional[str]:
    """This user's role ON THIS PROJECT, or None if they hold no row.

    Both tables, because a user may hold either: `team_members` is written at
    invite time and `project_assignments` at acceptance, and
    `server.is_project_member` already falls back the same way. Asking only one
    would make the answer depend on which half of the invite flow ran.

    NEVER the JWT. `users.role` is a per-user GLOBAL column that rode in the
    token, so it answers what the flag said when the token was minted, and it
    cannot be scoped to an org or a project at all. It is also the wrong
    question: the tier model is per-org and per-module, so a global `admin`
    would be an admin of every project in every organisation.
    """
    if not team_id:
        return None
    role = _role_of(await pool.fetchrow(
        "SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",
        team_id, user_id,
    ))
    if role:
        return role
    return _role_of(await pool.fetchrow(
        "SELECT role FROM team_members "
        "WHERE team_id=$1 AND user_id=$2 AND status='active'",
        team_id, user_id,
    ))


async def _holds_task_client_row(pool, task_id: Optional[str], user_id: str) -> bool:
    """Case 2 — reached by the forward rather than by joining the project."""
    if not task_id:
        return False
    return bool(await pool.fetchrow(
        "SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2",
        task_id, user_id,
    ))


# ── The one predicate ────────────────────────────────────────────────────────


async def assert_may_write_task(
    pool,
    *,
    team_id: Optional[str],
    user: Optional[dict],
    task_id: Optional[str] = None,
    cache: Optional[dict] = None,
) -> None:
    """Refuse a read-only client. Returns None or raises 403.

    DELIBERATELY NARROW. This answers ONE question — "is this caller a Tier-3
    client here" — and nothing else. It does not decide reachability: every
    caller has already done that with its own `get_visible_team_ids` /
    `is_project_member` / `client_can_access_task` predicate, and a second,
    subtly different opinion about who can see what is how two guards start
    disagreeing. A guard that answers a question it was not asked is the next
    person's bug.

    So the DEFAULT IS ALLOW, and that direction is chosen, not lazy:

      · `team_id=None` is a personal task. There is no project, so there is no
        project role, and its owner is its owner. A guard that refused on an
        unresolvable role would have taken out every personal to-do in the
        product — 193 `todo` rows live.
      · A caller with no project row on a project task reached this line through
        org membership, creation or assignment, all of which the caller already
        checked. Unless they hold a `task_clients` row, in which case they are
        case 2 and are refused.

    `user=None` is an automation. No person is behind the write, so there is no
    client to refuse; the rule the automation came from is gated where it is
    AUTHORED (`routers/automations.py`), which is the only place a person is
    standing there to be asked.

    `cache` is an optional per-request memo for the ROLE lookup, and only the
    role — same device `assert_transition` uses, for the same reason. One
    `PATCH /api/v1/tasks/bulk` may carry 200 ids; without it, moving a column's
    worth of work would ask "what is this person's role on this project" up to
    200 times for an answer that cannot change inside one transaction. Keyed on
    `(team_id, user_id)` because a batch may legitimately span projects.

    The `task_clients` probe is NOT memoised: it is a per-TASK fact, it only
    runs for a caller who holds no project row at all, and caching a per-task
    answer under a per-team key is how a memo starts giving the wrong one.
    """
    if not user or not user.get("user_id"):
        return

    user_id = user["user_id"]

    if cache is None:
        role = await project_role(pool, team_id, user_id)
    else:
        key = ("role", team_id, user_id)
        if key not in cache:
            cache[key] = await project_role(pool, team_id, user_id)
        role = cache[key]

    if role == CLIENT:
        raise HTTPException(403, CLIENT_READ_ONLY)
    if role in WRITER_ROLES:
        return

    # No project row. The forward's grant is a read grant, not a write one.
    if await _holds_task_client_row(pool, task_id, user_id):
        raise HTTPException(403, CLIENT_READ_ONLY)


async def assert_client_of_project(
    pool,
    *,
    team_id: Optional[str],
    user_id: str,
) -> None:
    """Refuse a client-approval forward whose TARGET is not a client here.

    THE SERVER IS THE BOUNDARY, NOT THE DROPDOWN. `GET /api/teams/{id}/clients`
    already returns exactly the right list — `team_members.role='client'` scoped
    to the team — and both UIs already render it (`ApprovalsPage.jsx`,
    `TaskDrawer.jsx`). Neither forward path checked that the posted email came
    from it: both did a bare `SELECT ... FROM users WHERE email=$1` over the
    whole users table, with no org, no project and no role predicate, and then
    wrote a `task_clients` row, emailed the task's title and issued a 7-day
    HS256 approval JWT. The target could be any account in any organisation.

    A dropdown is a suggestion. The endpoint is the boundary, so the check is
    here, on the id the server resolved — not on the list the client rendered.

    Refuses a personal task outright: `team_id IS NULL` means there is no
    project client list to be on, so there is no way to answer yes.
    """
    role = await project_role(pool, team_id, user_id)
    if role != CLIENT:
        raise HTTPException(403, NOT_A_PROJECT_CLIENT)
