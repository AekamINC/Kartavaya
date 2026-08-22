"""
The Tier-3 client is read-only, `is_project_member` reads the database, and the
client-approval forward cannot leave the project.

THREE FINDINGS, ONE FILE, BECAUSE THEY CHAIN
────────────────────────────────────────────
An external client attached to a project could (1) create and edit that firm's
tasks, and (3) hand any of them — read AND write — to an arbitrary account in
any other organisation. Finding 1 is what lets a client reach the forward, and
finding 3 is what the forward then grants. They are one path, so they are one
file.

Finding 2 is the same shape one layer down: `is_project_member` returned a
synthetic `{"role": "admin"}` off the JWT's `users.role` claim with NO DATABASE
QUERY AT ALL, so a token minted while its holder was an admin was project-admin
of every project in the database, in every org, forever.

HOW TO READ THIS FILE
─────────────────────
Same discipline as `test_task_transitions.py`, and for the same reason: adding a
guard can only be safe if you know what it refuses.

  · `TestStillWorks*` was written FIRST and run against the UNGUARDED code,
    where it passed. The same assertions pass after. That pair of runs, not the
    final green, is the argument that nothing working was broken.
  · `TestRefus*` FAILED against the unguarded code. That is the point of it.

MEASURED RED, 2026-08-06, with `services/task_actor.py` present but wired into
NOTHING — so every assertion below ran against the product exactly as it shipped:

    33 failed, 26 passed          (59 tests, `pytest tests/test_client_tier_enforcement.py -q`)

Every `TestStillWorks*` / `TestTheForwardStillWorks` assertion was in the 26.
Every refusal was in the 33.

MEASURED GREEN after the fix:

    86 passed

The count grew from 59 to 86 because three groups were written AFTER the red run
and are NOT part of the 33/26 figure:

  · `TestEveryIsProjectMemberRouteStillWorks` (20) — all ten routes that helper
    gates, each as the weakest role that may use it, and again as an org admin
    holding no membership row. Narrowing `is_project_member` is the change most
    likely to refuse something that works.
  · `TestReadOnlyIsNotADeadEnd` (5) — the three writes the client portal
    actually makes, enumerated from `src/pages/client/`, plus comment and read.
  · `TestScope::test_the_delegate_really_asks` and the bulk batch-memo test.

FULL BACKEND SUITE: 4221 passed / 0 failed before this run, 4461 passed / 0
failed after. FRONTEND: 1485 passed / 0 failed.

(The brief predicted 17 known-red in `test_migrations_111_115.py`. The
concurrent run that owned them landed its migration before this one started, so
the baseline measured clean and stayed clean.)

WHAT THE REFUSAL COSTS, READ OFF THE LIVE DATABASE FIRST
────────────────────────────────────────────────────────
SELECT role, count(*) against the shared staging schema on 2026-08-06, before a
line of the guard was written — because a guard sized after the fact is a guess:

    project_assignments   owner 56 · member 9 · client 2 · admin 1
    team_members (active) member 135 · owner 38 · client 2 · admin 2
    users.role            member 12 · admin 6 · client 2

The two `client` rows in each table are THE SAME TWO ACCOUNTS
(aekaminc1+org@gmail.com, kevalvshah03+1@gmail.com), both on team_95beaa7529a9,
and both carry `client` consistently in all three places. `auth_router` copies
`team_members.role` straight into `project_assignments`, so a staff member
could have been carrying `role='client'` by data accident — none is. The
refusal is exactly two accounts on exactly one project.

For finding 2, the six `users.role='admin'` accounts are all vendor-controlled,
and five of them hold a real org row. The sixth (sid@aekaminc.com) holds
`platform_admin` and NO org row, and already sees zero teams from
`get_visible_team_ids`, which was narrowed the same way on 965d0e82. So this
change makes `is_project_member` agree with the list endpoint rather than
removing an access anybody has.
"""

import re
from pathlib import Path

import pytest

from helpers import make_task_row
from services import task_actor
from services import task_transitions as tt


BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _clean_caches():
    """No test may inherit another's cached schema probe or team-id list."""
    import server
    tt.reset_schema_cache()
    server._team_ids_request_cache.clear()
    yield
    tt.reset_schema_cache()
    server._team_ids_request_cache.clear()


TASK = make_task_row(status="todo", team_id="team_001")


def _wire(mock_pool, *, project_role="admin", task_row=TASK, column=None,
          task_client=False, org_admin=False, forward_target=None):
    """Answer the queries a task write path asks, with ONE knob that matters.

    `project_role` is what `public.project_assignments` says about the CALLER on
    this project — the thing the guard is supposed to read. Every refusal test
    in this file changes only that knob.

    It used to mean "what `project_assignments` OR `team_members` says", and one
    knob covered both because the guard fell back from the first to the second.
    Phase 2 of the tenancy cutover dropped that fallback (migration 195 had
    already made `project_assignments` a strict superset at identical roles), so
    the knob now describes one table and the tests are unchanged — which is the
    point: if dropping the fallback had cost anybody a role, a refusal test here
    would have gone green for the wrong reason and a permission test would have
    gone red.
    """
    async def fetchrow_side(query, *args):
        q = " ".join(query.split())
        if "information_schema" in q:
            return None
        if "INSERT INTO task_comments" in q:
            return {"comment_id": "cmt_1", "task_id": "task_test001",
                    "user_id": "user_client001", "body": "Looks right",
                    "created_at": TASK["created_at"], "is_client_visible": True}
        if "INSERT INTO project_columns" in q or "UPDATE project_columns" in q:
            return {"column_id": "col_new", "team_id": "team_001", "name": "New",
                    "color": "#0082c6", "sort_order": 0, "is_done": False,
                    "created_at": TASK["created_at"]}
        if "FROM project_columns" in q:
            return column
        if "requires_approval FROM teams" in q:
            return {"requires_approval": False}
        # The forward's target lookup — a DIFFERENT user from the caller.
        if "FROM users WHERE email" in q or "FROM users WHERE LOWER(email)" in q:
            return forward_target
        if "FROM users WHERE user_id" in q:
            return {"user_id": "user_x", "name": "X", "email": "x@test.com",
                    "display": "X", "full_name": "X"}
        if "FROM task_clients" in q:
            return {"1": 1} if task_client else None
        # `public.project_assignments` is `task_actor.project_role`'s ONLY read
        # since phase 2 of the tenancy cutover (2026-08-22). The bare names are
        # still matched because `server.py`'s own membership predicates have not
        # been migrated yet and this fixture answers for them too — drop them
        # from this line only when the last unqualified reader is gone, and NOT
        # by loosening it to a bare "project_assignments", which would also
        # match `SELECT team_id FROM project_assignments` in `fetch_side` and
        # start answering a list query with a single role row.
        if ("FROM public.project_assignments" in q
                or "FROM project_assignments" in q
                or "FROM team_members" in q):
            if project_role is None:
                return None
            # Owner/admin-filtered probes must not be satisfied by a client row.
            if "IN ('owner','admin')" in q and project_role not in ("owner", "admin"):
                return None
            return {"role": project_role}
        if "FROM teams WHERE team_id" in q:
            return {"name": "Test Project", "org_id": None}
        if "MAX(sort_order)" in q:
            return {"mo": 0}
        if "FROM tasks" in q or "UPDATE tasks" in q or "INSERT INTO tasks" in q:
            return task_row
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side

    async def fetch_side(query, *args):
        q = " ".join(query.split())
        # `get_visible_team_ids` schema-qualifies since phase 2 of the tenancy
        # cutover. Matched on the fragment WITHOUT the schema so both spellings
        # hit — an unmatched visibility query returns [] and shows up as a 403
        # on a read route, which reads exactly like a guard bug and is not one.
        if "team_id FROM teams" in q or "SELECT team_id FROM public.project_assignments" in q \
                or "SELECT team_id FROM project_assignments" in q:
            return [{"team_id": "team_001"}]
        return []

    mock_pool.fetch.side_effect = fetch_side

    async def fetchval_side(query, *args):
        q = " ".join(query.split())
        if "staging.user_roles" in q:
            return "org_admin" if org_admin else None
        if "is_done FROM project_columns" in q:
            return bool(column and column.get("is_done"))
        if "COALESCE(full_name" in q:
            return "Someone"
        return 0

    mock_pool.fetchval.side_effect = fetchval_side

    # `tasks_bulk` works on the CONNECTION it took out of the pool, not the pool
    # — deliberately, so its reads live in the same transaction as its writes.
    # Wiring only `mock_pool` leaves the connection answering None, which shows
    # up as "Task not found" and would have let the bulk assertion pass on a
    # 404 that has nothing to do with the guard.
    conn = mock_pool.acquire.return_value
    conn.fetchrow.side_effect = fetchrow_side
    conn.fetchval.side_effect = fetchval_side
    conn.fetch.side_effect = fetch_side
    return mock_pool


# ══ 1 · THE TIER-3 CLIENT INSIDE A PROJECT ═══════════════════════════════════
#
# A `client` row in `project_assignments` / `team_members` is an EXTERNAL party
# invited to see their own work. Every writer below read that row as plain
# membership, so the answer to "may this person write" was "are they in the
# project at all" — which a client is, by design.


class TestStillWorksForStaff:
    """Run against the UNGUARDED code first, where they passed. See docblock."""

    @pytest.mark.parametrize("role", ["owner", "admin", "member"])
    async def test_a_member_can_still_create_a_task(self, api_client, mock_pool, as_member, role):
        _wire(mock_pool, project_role=role)
        r = await api_client.post("/api/tasks", json={"title": "T", "team_id": "team_001"})
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("role", ["owner", "admin", "member"])
    async def test_a_member_can_still_edit_a_task(self, api_client, mock_pool, as_member, role):
        _wire(mock_pool, project_role=role)
        r = await api_client.put("/api/tasks/task_test001", json={"title": "Renamed"})
        assert r.status_code == 200, r.text

    async def test_a_member_can_still_toggle(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member")
        r = await api_client.patch("/api/tasks/task_test001/toggle")
        assert r.status_code == 200, r.text

    async def test_a_member_can_still_move(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member",
              column={"column_id": "col_002", "name": "In Progress", "is_done": False, "sort_order": 1})
        r = await api_client.patch("/api/tasks/task_test001/move",
                                   json={"column_id": "col_002", "order": 0})
        assert r.status_code == 200, r.text

    async def test_a_member_can_still_add_a_subtask(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member")
        r = await api_client.post("/api/tasks/task_test001/subtasks", json={"title": "S"})
        assert r.status_code == 200, r.text

    async def test_a_member_can_still_archive(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member",
              task_row=make_task_row(archived_at=None))
        r = await api_client.patch("/api/tasks/task_test001/archive")
        assert r.status_code == 200, r.text

    async def test_a_member_can_still_set_reminders(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member")
        r = await api_client.put("/api/tasks/task_test001/reminders", json=[])
        assert r.status_code == 200, r.text

    async def test_a_personal_task_needs_no_project_role(self, api_client, mock_pool, as_member):
        """No team_id means no project, so there is no project role to read.

        This is the case a guard that resolves a role and refuses on `None`
        would have broken — every personal to-do in the product.
        """
        _wire(mock_pool, project_role=None, task_row=make_task_row(team_id=None))
        r = await api_client.post("/api/tasks", json={"title": "My own thing"})
        assert r.status_code == 200, r.text


class TestRefusesTheClient:
    """These FAILED against the unguarded code. That is the point of them."""

    async def test_a_client_cannot_create_a_task(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/tasks",
                                  json={"title": "Made by a client", "team_id": "team_001"})
        assert r.status_code == 403, r.text
        assert isinstance(r.json()["detail"], str)

    async def test_a_client_cannot_edit_the_firms_task(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.put("/api/tasks/task_test001",
                                 json={"title": "Edited by the client", "status": "in_progress"})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_rename_without_naming_a_status(self, api_client, mock_pool, as_client_user):
        """The status state machine returns early on `new_status is None`.

        A guard placed inside `assert_transition` would wave this exact request
        through while reading, at every call site, as enforced.
        """
        _wire(mock_pool, project_role="client")
        r = await api_client.put("/api/tasks/task_test001", json={"title": "Only a title"})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_patch(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.patch("/api/tasks/task_test001", json={"priority": "urgent"})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_toggle_the_firms_task_done(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.patch("/api/tasks/task_test001/toggle")
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_move_a_card(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client",
              column={"column_id": "col_002", "name": "In Progress", "is_done": False, "sort_order": 1})
        r = await api_client.patch("/api/tasks/task_test001/move",
                                   json={"column_id": "col_002", "order": 0})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_add_a_subtask(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/tasks/task_test001/subtasks", json={"title": "S"})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_toggle_a_subtask(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.patch("/api/tasks/task_test001/subtasks/sub_1")
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_delete_a_subtask(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.delete("/api/tasks/task_test001/subtasks/sub_1")
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_rename_a_subtask(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.put("/api/tasks/task_test001/subtasks/sub_1", json={"title": "S2"})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_archive_the_firms_work_off_the_board(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.patch("/api/tasks/task_test001/archive")
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_unarchive(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client",
              task_row=make_task_row(archived_at="2026-01-01T00:00:00Z"))
        r = await api_client.patch("/api/tasks/task_test001/unarchive")
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_set_reminders(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.put("/api/tasks/task_test001/reminders", json=[])
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_delete_an_attachment(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.delete("/api/tasks/task_test001/attachments/some-key")
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_bulk_patch(self, api_client, mock_pool, as_client_user, with_org_id):
        """The bulk route is the one that mattered most last time.

        `BulkBar.jsx` — the product's own multi-select bar — patches through it,
        so a refusal the twelve single-task routes make is one menu click away
        from being irrelevant. Its sibling `DELETE /bulk` already checked
        `member in ('owner','admin')`; the patch never did.
        """
        _wire(mock_pool, project_role="client")
        r = await api_client.patch("/api/v1/tasks/bulk",
                                   json={"task_ids": ["task_test001"], "patch": {"priority": "urgent"}})
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert results[0]["ok"] is False, results
        assert results[0]["status"] == 403, results

    async def test_the_bulk_refusal_asks_the_role_once_for_the_whole_batch(
            self, api_client, mock_pool, as_client_user, with_org_id):
        """A guard that is 200 round trips is a guard someone will remove.

        The role cannot change inside one transaction, so it is read once per
        (project, caller) and shared with the approval gate's own memo.
        """
        _wire(mock_pool, project_role="client")
        conn = mock_pool.acquire.return_value
        ids = [f"task_{i:012d}" for i in range(25)]
        r = await api_client.patch("/api/v1/tasks/bulk",
                                   json={"task_ids": ids, "patch": {"priority": "urgent"}})
        assert r.status_code == 200, r.text
        assert all(x["status"] == 403 for x in r.json()["results"]), r.json()

        # Counts `public.project_assignments` reads. It counted BOTH tables'
        # reads before 2026-08-22 and the number was still 1, because the memo
        # is on the answer and not on the query — so this assertion means the
        # same thing it always did, against one table instead of two.
        role_reads = [c for c in conn.fetchrow.call_args_list
                      if "project_assignments" in " ".join(str(c.args[0]).split())]
        assert len(role_reads) == 1, (
            f"{len(role_reads)} role reads for {len(ids)} ids — the batch memo is not being used"
        )

    async def test_there_is_no_automation_authoring_surface_to_abuse(self, api_client, mock_pool, as_client_user):
        """A rule is a task write with a delay on it, so a client must never be
        able to author one — `change_status` ran detached with `user=None`, and
        the author was the only place the question could be asked.

        The Niyam demolition deleted that route along with the engine behind
        it, so today the answer is 404 rather than 403: there is nothing to
        author. **When Niyam's rule-create route lands it must refuse a client
        with 403, and this test flips back to asserting that** — which is why
        it stays here rather than being deleted with the route.
        """
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/automations/", json={
            "team_id": "team_001", "name": "R",
            "trigger": {"type": "task_created"},
            "actions": [{"type": "change_status", "config": {"status": "done"}}],
        })
        assert r.status_code == 404, (
            "an automation authoring route exists again — it must refuse a client with 403, "
            "and this test must be restored to asserting that"
        )

    async def test_a_client_cannot_apply_a_project_template(self, api_client, mock_pool, as_client_user):
        """`apply_project_template` INSERTs tasks and columns wholesale."""
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/templates/projects/tmpl_1/apply?team_id=team_001")
        assert r.status_code == 403, r.text


class TestReadOnlyIsNotADeadEnd:
    """Everything the client portal itself does must still work.

    ENUMERATED FROM THE CLIENT SURFACES, not guessed. `src/pages/client/` and
    `ClientBoardPage.jsx` make exactly three writes between them:

        POST /api/tasks/{id}/client-approve     ClientApprovals.jsx:90
        POST /api/tasks/{id}/client-reject      ClientApprovals.jsx:102
        POST /api/client/tasks/request          RequestWork.jsx:55

    None of the three is a route this change guards, and that is the design:
    a client may approve their work, decline it, ask for new work and talk
    about it. What they may not do is edit the firm's board. If a guard ever
    reaches one of these, this class goes red before a customer finds out.
    """

    async def test_a_client_can_still_approve_their_task(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client", task_client=True)
        r = await api_client.post("/api/tasks/task_test001/client-approve", json={"notes": "Fine by me"})
        assert r.status_code == 200, r.text

    async def test_a_client_can_still_reject_their_task(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client", task_client=True)
        r = await api_client.post("/api/tasks/task_test001/client-reject", json={"notes": "Wrong figure"})
        assert r.status_code == 200, r.text

    async def test_a_client_can_still_request_work(self, api_client, mock_pool, as_client_user):
        """`client_request_task` is the sanctioned way for a client to put a
        task into existence — it lands as `status='requested'` for an approver,
        which is precisely why `create_task` is not their route."""
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/client/tasks/request",
                                  json={"title": "Please prepare the GST return", "team_id": "team_001"})
        assert r.status_code == 200, r.text

    async def test_a_client_can_still_comment(self, api_client, mock_pool, as_client_user):
        """RBAC-SPEC.md:95 — read-only is not a dead end. Deliberately ungated."""
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/tasks/task_test001/comments", json={"body": "Looks right"})
        assert r.status_code == 200, r.text

    async def test_a_client_can_still_read_the_task(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.get("/api/tasks/task_test001")
        assert r.status_code == 200, r.text


class TestTheForwardedExternalClient:
    """A client reached by the forward holds `task_clients`, not a project row.

    `client_can_access_task` is the FALLBACK on `PUT /api/tasks/{id}`, so that
    row was a write grant. Resolving the role from project tables alone would
    return `None` for this person and wave them through — the hole inside the
    fix.
    """

    async def test_a_task_clients_row_is_not_a_write_grant(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role=None, task_client=True)
        r = await api_client.put("/api/tasks/task_test001", json={"title": "Edited"})
        assert r.status_code == 403, r.text

    async def test_nor_on_the_patch_alias(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role=None, task_client=True)
        r = await api_client.patch("/api/tasks/task_test001", json={"priority": "low"})
        assert r.status_code == 403, r.text

    async def test_the_docstring_no_longer_claims_write(self):
        """`utils.py` says in its own words that this predicate permits writes.

        Two copies of it exist — `server.py` (live) and `utils.py` (imported by
        nothing). The dead copy is the one that wrote the intent down, and a
        stale docstring is how the next reader re-learns the wrong rule.
        """
        for path in (BACKEND / "utils.py", BACKEND / "server.py"):
            src = path.read_text(encoding="utf-8")
            i = src.index("async def client_can_access_task(")
            # The SUMMARY line only. The body may — and does — quote the old
            # wording to explain what it was; a sweep that cannot tell a
            # correction from the thing it corrected is a sweep that forbids
            # writing down why.
            summary = src[src.index('"""', i) + 3:]
            summary = summary.split("\n", 1)[0]
            assert "write" not in summary.lower(), \
                f"{path.name} still advertises write access: {summary!r}"


# ══ 2 · is_project_member READS THE DATABASE ═════════════════════════════════


class ExplodingPool:
    """Any query at all is a failure. That is the assertion."""

    async def fetchrow(self, query, *args):
        raise AssertionError(f"is_project_member queried the database: {query[:80]}")

    async def fetchval(self, query, *args):
        raise AssertionError(f"is_project_member queried the database: {query[:80]}")


class RolePool:
    """Answers the two membership reads, and the team's org, and nothing else."""

    def __init__(self, *, pa_role=None, tm_role=None, org_id=None):
        self.pa_role, self.tm_role, self.org_id = pa_role, tm_role, org_id

    async def fetchrow(self, query, *args):
        q = " ".join(query.split())
        # `server.is_project_member` names the schema since phase 2 of the
        # tenancy cutover; the bare spelling is kept so this pool still answers
        # for any caller that has not been migrated yet.
        if "FROM public.project_assignments" in q or "FROM project_assignments" in q:
            return {"role": self.pa_role} if self.pa_role else None
        if "FROM public.team_members" in q or "FROM team_members" in q:
            return {"role": self.tm_role} if self.tm_role else None
        if "FROM teams" in q:
            return {"org_id": self.org_id}
        return None

    async def fetchval(self, query, *args):
        q = " ".join(query.split())
        if "FROM teams" in q and "org_id" in q:
            return self.org_id
        return None


class TestIsProjectMember:

    async def test_the_jwt_role_claim_is_not_a_project_membership(self):
        """MEASURED before the fix, with a pool that raises on every query:

            is_project_member(pool, 'team_in_another_org', {'user_id':'u','role':'admin'})
                -> {'role': 'admin'}

        No database was touched. The claim on the token — `users.role` as it
        stood WHEN THE TOKEN WAS MINTED — was treated as project-admin of every
        project in the database, with no org and no team predicate.
        """
        from server import is_project_member
        for claim in ("admin", "owner"):
            with pytest.raises(AssertionError):
                await is_project_member(
                    ExplodingPool(), "team_belonging_to_another_org",
                    {"user_id": "user_x", "role": claim},
                )

    async def test_a_stale_admin_claim_grants_nothing_on_a_stranger_project(self, monkeypatch):
        async def _no(user_id, org_id=None):
            return False
        monkeypatch.setattr("middleware.roles.is_org_admin", _no)
        from server import is_project_member
        mem = await is_project_member(
            RolePool(org_id="00000000-0000-0000-0000-0000000000ff"),
            "team_999", {"user_id": "user_x", "role": "admin"},
        )
        assert mem is None

    async def test_an_org_admin_is_still_a_project_admin_inside_their_org(self, monkeypatch):
        """The narrowing must not cost a legitimate org admin their own org.

        This is the access `get_visible_team_ids` already grants through
        `staging.user_roles`; before this change the two disagreed.
        """
        seen = {}

        async def _yes(user_id, org_id=None):
            seen["org_id"] = org_id
            return True
        monkeypatch.setattr("middleware.roles.is_org_admin", _yes)
        from server import is_project_member
        mem = await is_project_member(
            RolePool(org_id="045b76ad-654b-42dd-b4b1-731700efc6c3"),
            "team_001", {"user_id": "user_admin001", "role": "member"},
        )
        assert mem and mem["role"] == "admin"
        assert seen["org_id"] == "045b76ad-654b-42dd-b4b1-731700efc6c3", \
            "the admin question must be asked ABOUT THIS TEAM'S ORG, not globally"

    async def test_a_membership_row_still_wins_with_no_admin_row_at_all(self, monkeypatch):
        """A `project_assignments` row is a membership on its own — and is now the ONLY one.

        This test used to assert BOTH halves: that a `project_assignments` row
        won, and that a `team_members` row won through the explicit fallback
        underneath it. The second half is gone with phase 2 of the
        `PROPOSED_080` retirement, and the assertion is inverted rather than
        deleted, because "a team_members row is no longer a membership" is the
        load-bearing new fact and it deserves to fail loudly if it reverses.

        What makes the inversion safe is migration 195, not optimism. Measured
        live on 2026-08-22 after it was applied: 198 active `team_members` rows,
        219 `project_assignments` rows, ZERO active `team_members` rows without a
        `project_assignments` twin, and ZERO rows where the two disagree about
        role. `RolePool(tm_role=...)` therefore describes a combination that no
        longer exists in the database — which is exactly why refusing it costs
        nobody their project.
        """
        async def _no(user_id, org_id=None):
            return False
        monkeypatch.setattr("middleware.roles.is_org_admin", _no)
        from server import is_project_member
        assert (await is_project_member(RolePool(pa_role="owner"), "team_001",
                                        {"user_id": "u", "role": "member"}))["role"] == "owner"
        assert await is_project_member(RolePool(tm_role="member"), "team_001",
                                       {"user_id": "u", "role": "member"}) is None, (
            "a `team_members` row with no `project_assignments` twin was still "
            "accepted as a project membership. Phase 2 reads one table; if this "
            "fallback comes back it re-creates the divergence migration 195 "
            "closed, and the two readers of this rule start disagreeing again"
        )

    async def test_it_returns_the_real_role_not_a_synthetic_label(self, monkeypatch):
        """Five of its ten call sites inspect `mem['role']`.

        Collapsing every answer to `admin` is what made the helper unable to
        tell a client from an owner — the reason `create_task` could not have
        made this decision itself.
        """
        async def _no(user_id, org_id=None):
            return False
        monkeypatch.setattr("middleware.roles.is_org_admin", _no)
        from server import is_project_member
        mem = await is_project_member(RolePool(pa_role="client"), "team_001",
                                      {"user_id": "u", "role": "member"})
        assert mem["role"] == "client"

    async def test_a_null_org_team_falls_through_to_the_unscoped_question(self, monkeypatch):
        """Two of the 29 live teams have `org_id IS NULL`.

        There is no org to scope the question to, so the unscoped call is asked
        — which is exactly what `get_visible_team_ids` already relies on. A
        guard that refused here would break both.
        """
        asked = []

        async def _yes(user_id, org_id=None):
            asked.append(org_id)
            return True
        monkeypatch.setattr("middleware.roles.is_org_admin", _yes)
        from server import is_project_member
        mem = await is_project_member(RolePool(org_id=None), "team_no_org",
                                      {"user_id": "u", "role": "member"})
        assert mem and mem["role"] == "admin"
        assert asked == [None]


#: Every route `is_project_member` gates, enumerated rather than sampled.
#: Narrowing that helper narrows all ten, so all ten are exercised for a
#: legitimate caller below — the regression this change was most likely to
#: cause is a refusal of something that used to work.
IS_PROJECT_MEMBER_ROUTES = [
    # (method, path, json, the lowest project role that must still succeed)
    ("get",    "/api/projects/team_001/columns",          None,               "member"),
    ("post",   "/api/projects/team_001/columns",          {"name": "New"},    "admin"),
    ("put",    "/api/projects/team_001/columns/col_001",  {"name": "Renamed"}, "admin"),
    ("delete", "/api/projects/team_001/columns/col_001",  None,               "admin"),
    ("post",   "/api/projects/team_001/columns/reorder",  {"ordered_ids": ["col_001"]}, "admin"),
    ("patch",  "/api/teams/team_001/brand",               {"colors": ["#000"]}, "admin"),
    ("get",    "/api/teams/team_001/clients",             None,               "member"),
    ("get",    "/api/teams/team_001/members",             None,               "member"),
    ("patch",  "/api/teams/team_001/color",               {"color": "#0082c6"}, "admin"),
    ("post",   "/api/tasks",                              {"title": "T", "team_id": "team_001"}, "member"),
]


class TestEveryIsProjectMemberRouteStillWorks:
    """The enumeration, run. Ten routes, each as the weakest role that may use it.

    `delete_column` needs more than one column to exist, so it is given one;
    everything else answers from the shared wiring.
    """

    @pytest.mark.parametrize("method,path,body,role", IS_PROJECT_MEMBER_ROUTES,
                             ids=[f"{m}:{p}" for m, p, _, _ in IS_PROJECT_MEMBER_ROUTES])
    async def test_a_legitimate_caller_is_not_refused(
            self, api_client, mock_pool, as_member, method, path, body, role):
        _wire(mock_pool, project_role=role)
        mock_pool.fetchval.side_effect = None
        mock_pool.fetchval.return_value = 3   # >1 column, so delete_column proceeds
        r = await getattr(api_client, method)(path, **({"json": body} if body is not None else {}))
        assert r.status_code == 200, f"{method.upper()} {path} as {role}: {r.text}"

    @pytest.mark.parametrize("method,path,body,role", IS_PROJECT_MEMBER_ROUTES,
                             ids=[f"{m}:{p}" for m, p, _, _ in IS_PROJECT_MEMBER_ROUTES])
    async def test_an_org_admin_with_no_membership_row_is_not_refused(
            self, api_client, mock_pool, as_member, method, path, body, role):
        """The half of the narrowing most likely to break someone.

        bhoomi@aekaminc.com holds `org_admin` and ZERO membership rows of either
        kind — 0 in `project_assignments`, 0 in `team_members`. Before the
        change she passed on the JWT claim; now she must pass on the org row,
        or an org admin loses her own organisation's projects.
        """
        _wire(mock_pool, project_role=None, org_admin=True)
        mock_pool.fetchval.side_effect = _org_admin_fetchval
        r = await getattr(api_client, method)(path, **({"json": body} if body is not None else {}))
        assert r.status_code == 200, f"{method.upper()} {path} as org admin: {r.text}"


async def _org_admin_fetchval(query, *args):
    q = " ".join(query.split())
    if "staging.user_roles" in q:
        return "org_admin"
    if "COUNT(*) FROM project_columns" in q:
        return 3
    if "COALESCE(full_name" in q:
        return "Someone"
    return 0


class TestTheColumnRoutesStillWork:
    """`is_project_member` gates ten routes. Narrowing it narrows all ten."""

    @pytest.mark.parametrize("role", ["owner", "admin"])
    async def test_an_owner_can_still_create_a_column(self, api_client, mock_pool, as_member, role):
        _wire(mock_pool, project_role=role)
        r = await api_client.post("/api/projects/team_001/columns", json={"name": "New"})
        assert r.status_code == 200, r.text

    async def test_a_member_still_reads_the_board(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member")
        r = await api_client.get("/api/projects/team_001/columns")
        assert r.status_code == 200, r.text

    async def test_a_client_still_reads_the_board(self, api_client, mock_pool, as_client_user):
        """Read-only is not a dead end. A client sees their project."""
        _wire(mock_pool, project_role="client")
        r = await api_client.get("/api/projects/team_001/columns")
        assert r.status_code == 200, r.text

    async def test_a_client_cannot_rewrite_the_columns(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.post("/api/projects/team_001/columns", json={"name": "Mine"})
        assert r.status_code == 403, r.text

    async def test_a_client_cannot_delete_a_column(self, api_client, mock_pool, as_client_user):
        _wire(mock_pool, project_role="client")
        r = await api_client.delete("/api/projects/team_001/columns/col_001")
        assert r.status_code == 403, r.text

    async def test_a_member_still_reads_the_mention_list(self, api_client, mock_pool, as_member):
        _wire(mock_pool, project_role="member")
        r = await api_client.get("/api/teams/team_001/members")
        assert r.status_code == 200, r.text


# ══ 3 · THE CLIENT-APPROVAL FORWARD CANNOT LEAVE THE PROJECT ═════════════════
#
# Both forward paths resolved the target with a bare
# `SELECT ... FROM users WHERE email=$1` — no org, no project, no client-role
# filter — and then wrote a `task_clients` row, which confers read AND write,
# emailed the task's title, and issued a 7-day approval JWT.
#
# The correct list already exists and both UIs already use it:
# `GET /api/teams/{team_id}/clients`, which is `team_members.role='client'`
# scoped to the team. The server simply never checked that the posted email
# came from it. The fix is not a narrower dropdown — a dropdown is a
# suggestion, and the endpoint is the boundary.

OUTSIDER = {"user_id": "user_orgB_outsider", "name": "Outsider",
            "full_name": "Outsider", "email": "outsider@other-firm.com"}
REAL_CLIENT = {"user_id": "user_client001", "name": "Test Client",
               "full_name": "Test Client", "email": "client@test.com"}


def _wire_forward(mock_pool, *, target, target_is_project_client, caller_role="owner"):
    """The forward's two questions, answered separately.

    `target_is_project_client` is what `team_members`/`project_assignments` say
    about the TARGET on this task's project — the question neither path asked.
    """
    inserted = []

    async def fetchrow_side(query, *args):
        q = " ".join(query.split())
        if "FROM users WHERE email" in q or "FROM users WHERE LOWER(email)" in q:
            return target
        if "FROM tasks" in q:
            return TASK
        if ("FROM public.project_assignments" in q
                or "FROM project_assignments" in q
                or "FROM team_members" in q):
            # args are (team_id, user_id) on every one of these.
            subject = args[1] if len(args) > 1 else None
            if target and subject == target["user_id"]:
                return {"role": "client"} if target_is_project_client else None
            if "IN ('owner','admin')" in q and caller_role not in ("owner", "admin"):
                return None
            return {"role": caller_role}
        if "FROM users WHERE user_id" in q:
            return {"display": "X", "name": "X", "email": "x@test.com"}
        return None

    async def execute_side(query, *args):
        if "INSERT INTO task_clients" in " ".join(query.split()):
            inserted.append(args)
        return "INSERT 1"

    async def fetchval_side(query, *args):
        # `as_admin` wires the platform row through `fetchval`; replacing the
        # side effect wholesale would silently un-admin the fixture and turn
        # `add_client_to_task`'s 403 into a false green.
        if "staging.user_roles" in " ".join(query.split()):
            return "platform_admin"
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.execute.side_effect = execute_side
    mock_pool.fetchval.side_effect = fetchval_side
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []
    return inserted


class TestTheForwardStillWorks:
    """Written first, run against the unguarded code, passed. See docblock."""

    async def test_a_real_project_client_can_still_be_sent_the_task(self, api_client, mock_pool, as_member):
        inserted = _wire_forward(mock_pool, target=REAL_CLIENT, target_is_project_client=True)
        r = await api_client.post("/api/tasks/task_test001/request-client-approval",
                                  json={"client_email": "client@test.com"})
        assert r.status_code == 200, r.text
        assert inserted, "the grant must still be written for a legitimate client"

    async def test_the_review_route_can_still_forward_to_a_real_client(self, api_client, mock_pool, as_member):
        inserted = _wire_forward(mock_pool, target=REAL_CLIENT, target_is_project_client=True)
        r = await api_client.post("/api/approvals/task_approval--task_test001/review",
                                  json={"status": "approved", "send_to_client": True,
                                        "client_email": "client@test.com"})
        assert r.status_code == 200, r.text
        assert inserted


class TestTheForwardRefusesAnOutsider:
    """CROSS-ORG. These FAILED against the unguarded code."""

    async def test_request_client_approval_refuses_a_target_outside_the_project(
            self, api_client, mock_pool, as_member):
        """MEASURED before the fix, as an ordinary org-A member:

            POST /api/tasks/task_orgA0000001/request-client-approval
                 {"client_email": "outsider@other-firm.com"}   -> 200

            INSERT INTO task_clients ('tc_…', 'task_orgA0000001',
                                      'user_orgB_outsider', 'user_mem001')

        The granted account may belong to ANY organisation, and what it received
        was read AND write, plus the task title by email and a 7-day HS256
        `client_approval` JWT.
        """
        inserted = _wire_forward(mock_pool, target=OUTSIDER, target_is_project_client=False)
        r = await api_client.post("/api/tasks/task_test001/request-client-approval",
                                  json={"client_email": "outsider@other-firm.com"})
        assert r.status_code == 403, r.text
        assert isinstance(r.json()["detail"], str)
        assert not inserted, "a task_clients row was written for a stranger"

    async def test_the_review_route_refuses_the_same_target(self, api_client, mock_pool, as_member):
        """The SECOND forward path, and it is a separate function.

        `server._approve_task_send_client` is the same defect written twice —
        `SELECT ... WHERE LOWER(email)=$1`. Guarding one and not the other is
        the shape this run exists to stop.
        """
        inserted = _wire_forward(mock_pool, target=OUTSIDER, target_is_project_client=False)
        r = await api_client.post("/api/approvals/task_approval--task_test001/review",
                                  json={"status": "approved", "send_to_client": True,
                                        "client_email": "outsider@other-firm.com"})
        assert r.status_code == 403, r.text
        assert not inserted

    async def test_an_unknown_email_is_still_a_404(self, api_client, mock_pool, as_member):
        """Refusing a stranger must not turn "no such user" into "forbidden"."""
        _wire_forward(mock_pool, target=None, target_is_project_client=False)
        r = await api_client.post("/api/tasks/task_test001/request-client-approval",
                                  json={"client_email": "nobody@nowhere.com"})
        assert r.status_code == 404, r.text

    async def test_a_client_cannot_initiate_the_forward(self, api_client, mock_pool, as_client_user):
        """Findings 1 and 3 chain here.

        `assert_may_act_on_task` admits ANY `project_assignments` row on the
        task's team with the role unchecked — which includes a Tier-3 client.
        So an external client of org A could hand any task in that project to
        any account in the database.
        """
        inserted = _wire_forward(mock_pool, target=OUTSIDER,
                                 target_is_project_client=False, caller_role="client")
        r = await api_client.post("/api/tasks/task_test001/request-client-approval",
                                  json={"client_email": "outsider@other-firm.com"})
        assert r.status_code == 403, r.text
        assert not inserted


class TestAddClientToTask:
    """`POST /api/tasks/{id}/clients/{target_user_id}` — the third writer.

    Guarded only by `_require_admin`, with no check that the target is a client
    of that project, or in the same org, or that the task belongs to the
    caller's org at all.
    """

    async def test_it_refuses_a_target_who_is_not_a_client_of_this_project(
            self, api_client, mock_pool, as_admin):
        inserted = _wire_forward(mock_pool, target=OUTSIDER, target_is_project_client=False)
        r = await api_client.post("/api/tasks/task_test001/clients/user_orgB_outsider")
        assert r.status_code == 403, r.text
        assert not inserted

    async def test_it_still_grants_a_real_project_client(self, api_client, mock_pool, as_admin):
        inserted = _wire_forward(mock_pool, target=REAL_CLIENT, target_is_project_client=True)
        r = await api_client.post("/api/tasks/task_test001/clients/user_client001")
        assert r.status_code == 200, r.text
        assert inserted


# ══ THE SWEEPS ═══════════════════════════════════════════════════════════════
# A guard is only as good as the next writer's memory of it. These fail when
# someone adds a thirteenth task writer, or a third forward, without asking.


SERVER_SRC = (BACKEND / "server.py").read_text(encoding="utf-8")

# Comments AND docstrings, from the sweep that already had to solve this: the
# repaired handlers QUOTE the code they replaced, and a check that reads prose
# as code forbids writing down what was wrong.
from tests.test_stale_admin_token import _strip_prose as _uncommented  # noqa: E402

#: `archive_task` / `unarchive_task` matched and wrote in a single statement,
#: so they have no row in hand to read `team_id` off. They delegate through this
#: helper, which is itself asserted below to call the predicate — a delegation
#: with a name, not a second copy of the rule.
_DELEGATE = "_assert_task_write"


class TestScope:

    def test_every_task_writer_asks_the_one_predicate(self):
        """Twelve handlers in server.py write `tasks` on behalf of a person.

        Pinned by NAME rather than by line number: line numbers rot on the first
        edit above them, and a sweep that rots is a sweep that gets deleted.
        """
        code = _uncommented(SERVER_SRC)
        writers = [
            "create_task", "update_task", "toggle_task", "move_task",
            "add_subtask", "toggle_subtask", "delete_subtask", "update_subtask",
            "add_task_attachment", "delete_task_attachment",
            "set_task_reminders", "archive_task", "unarchive_task",
        ]
        missing = []
        for fn in writers:
            i = code.index(f"async def {fn}(")
            nxt = code.find("\n@api_router", i)
            body = code[i:nxt if nxt > 0 else i + 4000]
            if "assert_may_write_task" not in body and _DELEGATE not in body:
                missing.append(fn)
        assert not missing, (
            f"{missing} write tasks without asking whether the caller is a "
            "read-only client. A guard with a hole reads as enforced."
        )

    def test_the_delegate_really_asks(self):
        """Otherwise `_assert_task_write` is a name the sweep accepts and a
        no-op the product ships."""
        code = _uncommented(SERVER_SRC)
        i = code.index(f"async def {_DELEGATE}(")
        assert "assert_may_write_task" in code[i:i + 1200]

    def test_no_other_file_writes_tasks_without_a_named_reason(self):
        """Every file that writes `tasks` either asks, or is on this list.

        The exemptions are named and justified, so adding one is a decision
        somebody has to write down rather than an omission nobody notices.
        """
        exempt = {
            # The approval decision surface itself. Gated by `is_project_owner`
            # for staff decisions and by an explicit `task_clients` row for the
            # client's own approve/reject — which is the ONE write a client is
            # meant to make.
            "approvals_router.py",
            # Account merge / deletion. Re-points ownership columns across the
            # whole table; no caller, no project, no status.
            "invite_router.py",
            # Detached background agents. No request and no user behind them,
            # so there is no actor to ask about.
            "review_agent.py", "status_agent.py",
            # (services/automation_engine.py stood here until the Niyam
            # demolition deleted it. Niyam's task.set_status action goes
            # through assert_transition like a human write, so it will not
            # need an exemption when it lands.)
            # Prose only — the module docblock quotes a DELETE.
            "task_transitions.py",
            # Erasing a whole project, cascade included. The question "may this
            # caller write this task" is the wrong one: by the time this runs
            # the project itself is going, and the permission was decided once
            # by `require_project_admin` at the route (or by the retention job,
            # which has no user at all). Asking per task would also be asking
            # about rows that are about to stop existing.
            "project_purge.py",
        }
        offenders = []
        for path in BACKEND.rglob("*.py"):
            if ".venv" in path.parts or "tests" in path.parts:
                continue
            src = path.read_text(encoding="utf-8", errors="ignore")
            code = _uncommented(src)
            if not re.search(r"(UPDATE tasks|INSERT INTO tasks|DELETE FROM tasks)", code):
                continue
            if path.name in exempt or "assert_may_write_task" in code:
                continue
            offenders.append(path.name)
        assert not offenders, (
            f"{offenders} write the tasks table but neither ask "
            "`assert_may_write_task` nor appear on the named exemption list"
        )

    def test_neither_forward_resolves_a_target_without_checking_the_project(self):
        """Both `WHERE email=` lookups must be followed by the project check."""
        from approvals_router import request_client_approval  # noqa: F401
        for src, fn in (
            ((BACKEND / "approvals_router.py").read_text(encoding="utf-8"),
             "async def request_client_approval("),
            (SERVER_SRC, "async def _approve_task_send_client("),
        ):
            i = src.index(fn)
            body = src[i:i + 3000]
            assert "assert_client_of_project" in body, f"{fn} still forwards unchecked"

    def test_the_predicate_lives_in_exactly_one_place(self):
        """One module, one rule. Five hand-written copies is how guards drift."""
        defs = []
        for path in BACKEND.rglob("*.py"):
            if ".venv" in path.parts or "tests" in path.parts:
                continue
            src = path.read_text(encoding="utf-8", errors="ignore")
            defs += [(path.name, m) for m in
                     re.findall(r"async def (assert_may_write_task|assert_client_of_project)\(", src)]
        assert sorted(n for _, n in defs) == ["assert_client_of_project", "assert_may_write_task"]
        assert {p for p, _ in defs} == {"task_actor.py"}


class TestTheSweepThatMissedIt:
    """`test_stale_admin_token.py` was supposed to catch finding 2 and did not.

    Its regex is `user\\.get\\("role"\\)\\s*!=\\s*"admin"`. `is_project_member`
    is written `in ("admin","owner")`, so the one write path that both escalated
    privilege and was missed sailed past a test whose own docstring calls itself
    "THE regression, swept rather than pinned to three line numbers".
    """

    def test_the_widened_sweep_would_have_caught_the_membership_spelling(self):
        from tests import test_stale_admin_token as sweep
        pattern = sweep.ROLE_CLAIM_RE
        assert pattern.search('if user.get("role") in ("admin", "owner"):'), \
            "the sweep still cannot see the spelling that shipped"
        assert pattern.search('if user.get("role") != "admin":')
        assert pattern.search('if user.get("role") not in ("admin","owner"):')

    def test_is_project_member_no_longer_matches_it(self):
        from tests import test_stale_admin_token as sweep
        code = _uncommented(SERVER_SRC)
        i = code.index("async def is_project_member(")
        body = code[i:i + 1600]
        assert not sweep.ROLE_CLAIM_RE.search(body)
        assert "is_org_admin(" in body
