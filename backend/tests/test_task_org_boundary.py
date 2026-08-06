"""A task belongs to ONE organisation, and an admin of another may not read it.

`get_visible_team_ids` was given an `org_id` and now answers for the active org
only. Three routes never ask it, because they short-circuit on `is_org_admin`
first — and `is_org_admin` with no org argument is True for an `org_owner` or
`org_admin` row in ANY organisation, plus every platform role
(`middleware/roles.py:341-347`).

Narrowing WHO passes that gate is not the same as narrowing WHAT they get. The
previous pass scoped the question at `server.py:3315`
(`is_org_admin(uid, org)`), so only an admin OF THE ACTIVE ORG reaches the
short-circuit — and then the short-circuit still returned the row with no
predicate on the task's own org. Admin of a one-person org, any task in the
database, by id.

Measured against the tree before this file's fix, driving the handlers directly
with a recording pool:

    GET  /api/tasks/{id}   caller is org_admin of B ONLY, X-Org-Id: B,
                           task lives on a team in A
                           -> 200, the task body, viewer_is_admin=True,
                              ONE query issued, get_visible_team_ids never
                              reached
    DELETE /api/tasks/{id} same caller, same task
                           -> 200 {"ok": true}; `DELETE FROM tasks WHERE
                              task_id=$1` executed against another tenant's row

The settled rule both violate: the ACTIVE org wins, god mode included
(`middleware/subscription.py:333`).
"""
import pytest

import server

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # Aekam Inc — the victim
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # E2E Test  — the caller's org

#: team_id -> org_id. `team_orphan` is one of the 2 live teams with no org at
#: all; it belongs to no tenant so it cannot leak one, and it must keep working.
TEAM_ORG = {
    "team_aekam_1": ORG_A,
    "team_e2e_1":   ORG_B,
    "team_orphan":  None,
}

CALLER = "user_b_admin"       # org_admin of B and of nothing else
VICTIM_TASK = "task_aekam_secret"


def _task_row(task_id=VICTIM_TASK, team_id="team_aekam_1", owner="user_a_staff"):
    return {
        "task_id": task_id,
        "team_id": team_id,
        "user_id": owner,
        "created_by_user_id": owner,
        "assignee_user_ids": [],
        "title": "Aekam Inc payroll reconciliation",
        "created_by_name": "Someone Else",
    }


class Pool:
    """Answers like the real SQL, and records everything."""

    def __init__(self, row=None):
        self.row = row if row is not None else _task_row()
        self.queries = []
        self.executed = []

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "FROM task_clients" in flat:
            return None
        if "FROM project_assignments" in flat:
            # No membership row anywhere. The bypass is the ONLY thing that can
            # let any of these callers through, which is the point.
            return None
        if "FROM tasks" in flat:
            return dict(self.row)
        return None

    async def fetchval(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        # "is this team inside the active org" — the predicate under test.
        if "FROM teams" in flat and "team_id=$1" in flat:
            team, org = args[0], args[1]
            if team not in TEAM_ORG:
                return None
            team_org = TEAM_ORG[team]
            if team_org is None:
                return 1 if "org_id IS NULL" in flat else None
            return 1 if str(team_org) == str(org) else None
        # "is this personal task's owner a member of the active org"
        if "user_roles" in flat and "org_id=$" in flat:
            return None
        return None

    async def fetch(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        return []

    async def execute(self, sql, *args):
        flat = " ".join(sql.split())
        self.executed.append((flat, args))
        return "DELETE 1"

    def reached_visible_teams(self):
        return any("FROM teams t" in q or "FROM teams WHERE org_id" in q
                   for q, _ in self.queries)


@pytest.fixture
def admin_of_b(monkeypatch):
    """`is_org_admin` as the real one answers for an admin of B alone."""
    seen = {}

    async def _is_org_admin(uid, org_id=None):
        seen.setdefault("calls", []).append(org_id)
        if org_id is None:
            return uid == CALLER          # admin SOMEWHERE — the global answer
        return uid == CALLER and str(org_id) == ORG_B

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)
    return seen


@pytest.fixture
def enriched(monkeypatch):
    """Capture what `get_task` would have serialised, without a real TaskOut."""
    captured = {}

    async def _fetch(pool, task_id, viewer_id=None, viewer_is_admin=None):
        captured.update(task_id=task_id, viewer_id=viewer_id,
                        viewer_is_admin=viewer_is_admin)
        return {"task_id": task_id, "title": "Aekam Inc payroll reconciliation"}

    monkeypatch.setattr(server, "_fetch_enriched_task", _fetch)
    return captured


@pytest.fixture(autouse=True)
def _clear_cache():
    server._team_ids_request_cache.clear()
    yield
    server._team_ids_request_cache.clear()


# ── GET /api/tasks/{task_id} ─────────────────────────────────────────────────

async def test_org_admin_cannot_read_another_orgs_task_by_id(admin_of_b, enriched):
    """The whole blocker, as one assertion.

    Not the creator, not an assignee, no membership row on that team, no
    `task_clients` link. The ONLY thing the caller has is an `org_admin` row in
    a different organisation, and the switcher is on that different
    organisation.
    """
    pool = Pool()
    with pytest.raises(server.HTTPException) as exc:
        await server.get_task(VICTIM_TASK, pool=pool,
                              user={"user_id": CALLER}, org=ORG_B)
    assert exc.value.status_code == 403, (
        f"admin of E2E Test read Aekam Inc's task and got "
        f"{enriched or 'a body'} — scoping WHO may use the short-circuit is "
        "not the same as scoping WHAT it returns"
    )
    assert not enriched, (
        "the task was serialised anyway; `_fetch_enriched_task` must not be "
        f"reached at all, and it was called with {enriched}"
    )


async def test_the_admin_short_circuit_still_works_inside_its_own_org(admin_of_b, enriched):
    """Refusing the other tenant must not refuse the caller's own org.

    An org_admin of B reading B's task has no membership row on that team
    either — the short-circuit is the whole reason they can see it.
    """
    pool = Pool(_task_row(task_id="task_b1", team_id="team_e2e_1"))
    out = await server.get_task("task_b1", pool=pool,
                                user={"user_id": CALLER}, org=ORG_B)
    assert out["task_id"] == "task_b1"
    assert enriched["viewer_is_admin"] is True, (
        "an admin inside their own org must keep private-attachment visibility"
    )


async def test_a_team_belonging_to_no_org_is_still_reachable(admin_of_b, enriched):
    """`org_id IS NULL` is not another tenant.

    2 of the 29 live teams carry no org. `get_visible_team_ids` keeps them
    reachable by direct membership for exactly this reason, and a task on one
    must not become a 403 for want of a tenant to compare against.
    """
    pool = Pool(_task_row(task_id="task_orphan", team_id="team_orphan"))
    out = await server.get_task("task_orphan", pool=pool,
                                user={"user_id": CALLER}, org=ORG_B)
    assert out["task_id"] == "task_orphan"


async def test_the_creator_still_reads_their_own_task_in_any_org(admin_of_b, enriched):
    """The org predicate gates the ADMIN hatch, not the ordinary paths.

    A task's creator sees it because they made it. Attaching the org test to
    that path too would be a real access regression with no tenancy argument
    behind it — the row already names them.
    """
    pool = Pool(_task_row(owner="user_creator"))
    out = await server.get_task(VICTIM_TASK, pool=pool,
                                user={"user_id": "user_creator"}, org=ORG_B)
    assert out["task_id"] == VICTIM_TASK


async def test_no_active_org_falls_back_to_the_old_global_question(admin_of_b, enriched):
    """`org is None` means a portal client or an org-less account.

    There is no org to scope to, so this must behave exactly as it did before —
    narrowing it would 403 the two populations `active_org_id`'s docstring
    names, and trading a leak for an outage is not a fix.
    """
    pool = Pool()
    out = await server.get_task(VICTIM_TASK, pool=pool,
                                user={"user_id": CALLER}, org=None)
    assert out["task_id"] == VICTIM_TASK


# ── DELETE /api/tasks/{task_id} ──────────────────────────────────────────────

async def test_org_admin_cannot_delete_another_orgs_task(admin_of_b):
    """A destructive cross-tenant WRITE, fourteen lines from a route that was scoped.

    `server.py:3719` called the UNSCOPED `is_org_admin(user["user_id"])`, so an
    admin of any one org skipped the entire membership check and ran
    `DELETE FROM tasks WHERE task_id=$1` against every other tenant's rows.
    """
    pool = Pool()
    with pytest.raises(server.HTTPException) as exc:
        await server.delete_task(VICTIM_TASK, pool=pool,
                                 user={"user_id": CALLER}, org=ORG_B)
    assert exc.value.status_code == 403
    assert not pool.executed, (
        f"another tenant's task was deleted: {pool.executed}"
    )


async def test_org_admin_still_deletes_inside_their_own_org(admin_of_b):
    pool = Pool(_task_row(task_id="task_b1", team_id="team_e2e_1"))
    out = await server.delete_task("task_b1", pool=pool,
                                   user={"user_id": CALLER}, org=ORG_B)
    assert out == {"ok": True}
    assert any("DELETE FROM tasks" in q for q, _ in pool.executed)


async def test_the_personal_task_owner_still_deletes_their_own(admin_of_b):
    """The non-admin path is untouched: a personal task's owner may delete it."""
    pool = Pool(_task_row(task_id="task_mine", team_id=None, owner="user_nobody"))
    out = await server.delete_task("task_mine", pool=pool,
                                   user={"user_id": "user_nobody"}, org=ORG_B)
    assert out == {"ok": True}


# ── _fetch_enriched_task: the attachment-content gate ────────────────────────

async def test_enriched_task_asks_the_org_scoped_admin_question(monkeypatch):
    """`server.py:3210` resolved private-attachment visibility with NO org.

    `get_task` computes its own scoped answer and passes it down, so the hot
    path was covered — but every other caller fell through to
    `is_org_admin(viewer_id)`, the GLOBAL question, which is True for an
    org_admin row in any organisation. That is the one place that gates
    attachment CONTENT rather than which rows come back, so the unscoped form
    handed another tenant's private files to an admin of somewhere else.
    """
    asked = []

    async def _is_org_admin(uid, org_id=None):
        asked.append(org_id)
        return True

    class AttachPool:
        async def fetchrow(self, sql, *a):
            return {"task_id": "t1", "created_by_user_id": "someone_else"}
        async def fetch(self, sql, *a):
            return []

    class _Att:
        is_private = True
        visible_to = []

    class _Out:
        attachments = [_Att()]
        reminders = []

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)
    monkeypatch.setattr(server, "row_to_task", lambda r: _Out())
    monkeypatch.setattr(server, "_filter_private_attachments",
                        lambda o, uid, ok: o)
    async def _refresh(pool, out): return out
    async def _rem(pool, tid): return []
    monkeypatch.setattr(server, "_refresh_task_attachments", _refresh)
    monkeypatch.setattr(server, "_fetch_task_reminders", _rem)

    await server._fetch_enriched_task(AttachPool(), "t1", viewer_id="user_x",
                                      org_id=ORG_B)

    assert asked == [ORG_B], (
        f"the admin question was asked with {asked} — an unscoped "
        "`is_org_admin(viewer_id)` answers True for an admin row in ANY org"
    )
