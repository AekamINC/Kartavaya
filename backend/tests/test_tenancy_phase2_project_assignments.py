"""PHASE 2 OF THE `team_members` RETIREMENT: READS MOVE, WRITES STAY.

`PROPOSED_080_team_members_retire.sql` records a six-phase sequence. Phase 1 —
migration `195_reconcile_team_members_into_project_assignments.sql` — made
`public.project_assignments` a strict superset of active `public.team_members`
at identical roles. Measured on the live database after 195 landed:

    team_members (all/active)      198 / 198
    project_assignments            219
    active team_members with no
      project_assignments row        0        (was 127)
    rows whose role disagrees          0
    project_assignments rows with
      no active team_members row      21      (every one of them 'owner')

That superset is the ENTIRE safety argument for phase 2. Switching a read from
`team_members` to `project_assignments` cannot revoke anybody's access, because
there is nobody in the first table who is not in the second at the same role.
It stops being true the moment a writer feeds one table and not the other — so
phase 2 removes READS and keeps every WRITE, and this file is the ratchet on
both halves of that sentence.

── WHY THE WRITES STAY ────────────────────────────────────────────────────────

Step 4 of the sequence RENAMES `team_members` rather than dropping it, and the
whole value of a rename is that it is reversible. Reverting a rename restores a
table; it does not restore rows that stopped being written while the rename was
in force. A writer that quietly went single-table would turn a reversible step
into an unrecoverable one without anything failing at the time.

── WHY THIS IS A SOURCE TEST ──────────────────────────────────────────────────

Two of the three claims are properties of the SQL, not of a response: "no read
names `team_members`" and "every writer names both tables". Reproducing the
second against a database needs a divergence that migration 195 has just spent
a migration removing, and a fixture built to reproduce it is one somebody edits
to make a failure go away. The behavioural half — a non-member is still refused
— is exercised for real, below.
"""
import ast
import inspect
import re
import textwrap
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import approvals_router
import auth_router
import invite_router
import middleware.roles as roles
import routers.admin_orgs as admin_orgs
import routers.dashboards as dashboards
import routers.org_members as org_members
import routers.templates as templates
import routers.time_entries as time_entries
import routers.uploads as uploads
import routers.views as views


# ── Reading the SQL out of a module, and only the SQL ─────────────────────────
#
# A plain substring search over the source cannot do this job: half these files
# EXPLAIN the retirement in prose, and `routers/activity.py` quotes the exact
# query it no longer runs inside a docstring. A ratchet that cannot tell a
# statement from the comment describing it either fails on honest documentation
# or forces the documentation to be deleted, and this codebase's comments are
# the reason anyone can follow the sequence at all.
#
# So: parse the module, collect every string LITERAL that is not a docstring,
# and look only at those. `#` comments never become AST nodes, which handles
# them for free.

_DOCSTRING_OWNERS = (ast.Module, ast.ClassDef,
                     ast.FunctionDef, ast.AsyncFunctionDef)


def _sql_literals(fn) -> list[str]:
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, _DOCSTRING_OWNERS) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
               and isinstance(first.value.value, str):
                docstrings.add(id(first.value))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and id(n) not in docstrings]


#: `FROM team_members` / `JOIN team_members`, qualified or not. Deliberately not
#: a bare "team_members": an INSERT or a DELETE naming the table is the thing
#: this phase KEEPS, and must not trip a ratchet aimed at reads.
_READS_TEAM_MEMBERS = re.compile(
    r"\b(?:FROM|JOIN)\s+(?:public\.)?team_members\b", re.I)


# ── 1. No project-membership READ names `team_members` any more ───────────────

#: Every project-membership READ phase 2 moved, named one by one rather than by
#: module. A module-wide sweep would be the wrong instrument twice over: it
#: would trip on `admin_orgs.add_member`'s duplicate guard, which reads
#: `team_members` in order to WRITE it correctly, and it would silently widen
#: to statements nobody in this phase looked at.
_MIGRATED_READS = (
    (approvals_router, "assert_may_act_on_task"),
    (approvals_router, "is_project_owner"),
    (approvals_router, "request_approval"),
    (approvals_router, "get_pending_approvals"),
    (roles, "may_reach_project"),
    (admin_orgs, "create_org"),
    (templates, "_is_team_member"),
    (templates, "list_task_templates"),
    (templates, "set_default_template"),
    (views, "_assert_team_access"),
    (uploads, "upload"),
    (time_entries, "time_report"),
    (dashboards, "get_dashboard_data"),
)


@pytest.mark.parametrize(
    "module,fn_name", _MIGRATED_READS,
    ids=[f"{m.__name__}.{n}" for m, n in _MIGRATED_READS])
def test_no_migrated_read_still_asks_team_members(module, fn_name):
    """The 127-row gap is closed, so a `team_members` read can only be a
    SECOND answer to a question `project_assignments` already answers — and two
    answers to one question is how the approvals badge and the approvals page
    came to disagree about who could see a task."""
    fn = getattr(module, fn_name)
    offenders = [s for s in _sql_literals(fn) if _READS_TEAM_MEMBERS.search(s)]
    assert not offenders, (
        f"{module.__name__}.{fn_name} still reads team_members: {offenders}. "
        f"Project membership is `public.project_assignments` since migration "
        f"195; a second reader is a second rule, and it will drift."
    )


@pytest.mark.parametrize(
    "module,fn_name", _MIGRATED_READS,
    ids=[f"{m.__name__}.{n}" for m, n in _MIGRATED_READS])
def test_every_migrated_read_is_schema_qualified(module, fn_name):
    """`public` versus `staging` is not cosmetic here. Migration 142 fixed a
    set of shadow twins created by exactly this: an unqualified name resolves
    through `search_path`, PgBouncer does not guarantee which one a pooled
    connection has, and this database is shared with production."""
    fn = getattr(module, fn_name)
    unqualified = [
        s for s in _sql_literals(fn)
        if re.search(r"\b(?:FROM|JOIN)\s+project_assignments\b", s, re.I)
    ]
    assert not unqualified, (
        f"{module.__name__}.{fn_name} names project_assignments without a "
        f"schema: {unqualified}"
    )


# ── 2. Every writer still writes BOTH tables ──────────────────────────────────

def _src(fn) -> str:
    return inspect.getsource(fn)


def test_org_members_add_member_seats_the_person_in_both_tables():
    """`POST /v1/org/members` fed `team_members` alone. After phase 2 that seat
    is invisible to `may_reach_project`, templates, uploads, views, time
    entries and dashboards — a member the console lists and the product
    refuses."""
    src = _src(org_members.add_member)
    assert "INSERT INTO public.team_members" in src
    assert "INSERT INTO public.project_assignments" in src
    assert "ON CONFLICT (team_id, user_id) DO NOTHING" in src, (
        "the project_assignments insert must name the UNIQUE (team_id, "
        "user_id) constraint — a bare ON CONFLICT DO NOTHING there would still "
        "work, but naming it is what proves the constraint is the one meant"
    )


def test_org_members_remove_member_clears_both_tables():
    """The direction that must not be missed: a delete from `team_members`
    alone leaves the row that now CARRIES the access."""
    src = _src(org_members.remove_member)
    assert "DELETE FROM public.team_members" in src
    assert "DELETE FROM public.project_assignments" in src


def test_admin_orgs_add_member_seats_the_person_in_both_tables():
    """God mode adding an org admin. Same defect, same fix, different door."""
    src = _src(admin_orgs.add_member)
    assert "INSERT INTO public.team_members" in src
    assert "INSERT INTO public.project_assignments" in src


def test_admin_orgs_add_member_keeps_the_duplicate_guard_on_team_members():
    """`public.team_members` has NO unique constraint on (team_id, user_id) —
    its only unique index is the surrogate `id`, verified against the live
    catalog. So `ON CONFLICT DO NOTHING` on that insert matches nothing and the
    SELECT above it is what actually prevents a duplicate seat. Deleting the
    pre-check because "the ON CONFLICT handles it" would be true of
    `project_assignments` and false here."""
    src = _src(admin_orgs.add_member)
    assert "is_team_member" in src
    assert src.index("SELECT 1 FROM public.team_members") \
        < src.index("INSERT INTO public.team_members")


def test_admin_orgs_create_org_seats_the_founding_owner_in_both_tables():
    src = _src(admin_orgs.create_org)
    assert re.search(r"INSERT INTO\s+(?:public\.)?team_members", src)
    assert re.search(r"INSERT INTO\s+(?:public\.)?project_assignments", src)


def test_accept_invite_activates_the_team_row_and_syncs_it_across():
    """The one place a `team_members` READ is still correct.

    A colleague invited by email before they had an account holds a
    `team_members` row with `status='invited'` and no `user_id`.
    `project_assignments` has neither column and cannot hold that grant, so the
    pending invitation lives in the old table until the account exists. The
    UPDATE claims it; the INSERT..SELECT is what carries it across. Remove
    either and an invited member registers into a product with no projects.
    """
    src = _src(auth_router.accept_invite)
    assert re.search(r"UPDATE\s+(?:public\.)?team_members\s+SET\s+user_id=\$1,\s*"
                     r"status='active'", src)
    assert re.search(r"INSERT INTO\s+(?:public\.)?project_assignments", src)
    assert re.search(r"FROM\s+(?:public\.)?team_members", src)


def test_the_invite_sync_still_casts_its_placeholder():
    """A duplicate of `test_auth.py`'s pin, kept here because this file is what
    a future phase reads before deleting the statement above.

    `project_assignments.user_id` is `character varying` and
    `team_members.user_id` is `text`. One statement spans both, so asyncpg has
    to deduce ONE type for `$1` from two columns that disagree — and it
    refuses. Untyped, PgBouncer turned the parse failure into an instant 500
    AFTER the `users` INSERT and the `team_members` UPDATE had already
    committed: the account existed, held a team row, and could not sign in.
    """
    src = _src(auth_router.accept_invite)
    sync = src[src.index("INSERT INTO project_assignments"):]
    assert "$1::text" in sync, "the invite sync no longer casts its placeholder"


def test_the_founding_owner_claim_writes_both_tables():
    """`_apply_org_invite` seats an owner who accepted into an org created for
    them before they had an account — the generic sync above finds nothing for
    that person because nobody ever wrote them a `team_members` row."""
    src = _src(auth_router._apply_org_invite)
    assert re.search(r"INSERT INTO\s+(?:public\.)?team_members", src)
    assert re.search(r"INSERT INTO\s+(?:public\.)?project_assignments", src)


def test_offboarding_removes_both_memberships():
    """`DELETE /admin/users/{id}` cannot transfer a membership, so it drops
    them — and it has to drop both or the person keeps the projects."""
    src = _src(invite_router.remove_user)
    assert re.search(r"DELETE FROM\s+(?:public\.)?team_members", src)
    assert re.search(r"DELETE FROM\s+(?:public\.)?project_assignments", src)


# ── 3. The behavioural half: a non-member is still refused ────────────────────
#
# The source assertions above prove the SQL names the right tables. They cannot
# prove the gate still says no, and "reads project_assignments" is satisfied by
# a query that returns True for everybody. These run the real functions.

def _pool(*, assignment=None, team_org=None):
    """A pool that answers the two questions `may_reach_project` asks."""
    async def fetchrow(query, *args):
        if "project_assignments" in query:
            return assignment
        return None

    async def fetchval(query, *args):
        if "FROM teams WHERE team_id" in query:
            return team_org
        return None

    return SimpleNamespace(fetchrow=AsyncMock(side_effect=fetchrow),
                           fetchval=AsyncMock(side_effect=fetchval))


async def test_may_reach_project_admits_an_assignee():
    assert await roles.may_reach_project(
        _pool(assignment={"?column?": 1}), "team_001", "user_member") is True


async def test_may_reach_project_refuses_a_stranger_on_an_orgless_team():
    """No assignment and no org means no leg left to stand on. This is the
    case the `team_members` leg used to answer, so it is the one worth
    proving still answers False."""
    assert await roles.may_reach_project(
        _pool(assignment=None, team_org=None), "team_001", "user_stranger") is False


async def test_may_reach_project_refuses_a_non_admin_of_the_projects_org(monkeypatch):
    """The org leg exists, and it is `staging.user_roles` — the sole tenant
    path. A stranger who is merely IN the org is not an administrator of it and
    still does not reach the project."""
    monkeypatch.setattr(roles, "is_org_admin", AsyncMock(return_value=False))
    assert await roles.may_reach_project(
        _pool(assignment=None, team_org="org_a"), "team_001", "user_stranger") is False


async def test_may_reach_project_admits_the_projects_own_org_admin(monkeypatch):
    seen = {}

    async def is_org_admin(user_id, org_id=None):
        seen["org_id"] = org_id
        return True

    monkeypatch.setattr(roles, "is_org_admin", is_org_admin)
    assert await roles.may_reach_project(
        _pool(assignment=None, team_org="org_a"), "team_001", "user_admin") is True
    assert seen["org_id"] == "org_a", (
        "the admin leg must be scoped to the PROJECT's org, never to the "
        "caller's active one"
    )


async def test_is_project_owner_refuses_a_plain_member():
    """`project_assignments` is now the only table asked, and the role
    predicate is inside the SQL — so a member row simply does not come back.
    A gate that stopped filtering on role would admit every assignee to
    approve and reject, which is the whole authority this function guards."""
    pool = _pool(assignment=None)
    assert await approvals_router.is_project_owner(
        pool, "team_001", "user_member") is False
    sql = pool.fetchrow.await_args[0][0]
    assert "role IN ('owner','admin')" in sql


async def test_is_project_owner_admits_an_owner():
    assert await approvals_router.is_project_owner(
        _pool(assignment={"role": "owner"}), "team_001", "user_owner") is True
