"""`approvals_router.py` answers a tenancy question with a tenant, at last.

Sibling to `test_approvals_org_scope.py`, which covers the `/approvals/*`
surface in `server.py`. This one covers `approvals_router.py`, which was left
behind when that sweep happened — the shape, not the symptom.

── THE DEFECT ──────────────────────────────────────────────────────────────────

Every `is_org_admin` call in that module was the ONE-ARGUMENT form. Its own
docstring in `middleware/roles.py` says what that means: unscoped, it is True
for an `org_owner`/`org_admin` row **in ANY organisation**. Pair it with
`fetch_task_or_404` — candid that it "CHECKS NOTHING ELSE … one unfiltered
`SELECT ... WHERE task_id=$1`" — and the two together are: fetch any task in the
database by id, then ask a question that is True for an administrator of a
different company.

Four WRITES sat behind it — `approve`, `reject`, `client-approve`,
`client-reject` — and the two client routes additionally SKIPPED the
`task_clients` row that is the entirety of a client's authority.

`server.delete_task` had already found and fixed this exact thing, and says so:
"Measured: an org_admin of one small org permanently deleted another tenant's
task by id, switcher irrelevant." It was fixed there and not here.

── LIVE EXPOSURE WHEN THIS WAS WRITTEN, 2026-08-29, read-only ──────────────────

    accounts holding org_admin/org_owner (could walk through)   15
    tasks ever decided (approved_by set, org known)              4
    of those, decided by somebody with NO role in that org       0

**LATENT** — the hole was open and had not been walked through. Same grade as
the `create_deal` finding, which was also 0 cross-org rows and was fixed anyway.

── WHY THESE TESTS DRIVE THE HANDLER AND ASSERT ON THE PREDICATE ───────────────

The defect is an ABSENT argument, not a wrong answer from a present one. A fix
that reshapes Python and still asks the unscoped question has not fixed
anything, and a test that only checks the 403 message would not notice. So each
test below asserts that the org actually reaches `is_org_admin`, and that the
task-in-org half is asked as well — `delete_task`'s rule, which this follows:
"A destructive write may not be one predicate short."
"""
import pytest

import approvals_router as ar

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # the task's org
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # the caller's org — different

OUTSIDER = "user_admin_elsewhere"

TASK = {
    "task_id": "task_abcdef123456",
    "team_id": "team_in_org_a",
    "user_id": "user_owner",
    "created_by_user_id": "user_owner",
    "assignee_user_ids": [],
    "title": "Another tenant's task",
    "approval_status": "pending",
    "column_id": None,
}


class Pool:
    """Answers no membership row anywhere, so the admin hatch is the only door."""

    def __init__(self):
        self.queries = []

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "FROM tasks WHERE task_id" in flat:
            return dict(TASK)
        # No project_assignments row, no task_clients row.
        return None

    async def fetch(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return []

    async def execute(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return "UPDATE 1"


@pytest.fixture
def spy(monkeypatch):
    """Record what org (if any) each authorisation question was asked about."""
    seen = {"is_org_admin": [], "task_is_in_org": []}

    async def fake_is_org_admin(user_id, org_id=None):
        seen["is_org_admin"].append((user_id, org_id))
        # The account IS an org admin — somewhere. That is the whole point:
        # unscoped, this True was enough to walk into another tenant's task.
        return True

    async def fake_task_is_in_org(pool, org, *, team_id=None, owner_ids=()):
        seen["task_is_in_org"].append((org, team_id))
        return org == ORG_A          # the task lives in ORG_A and nowhere else

    monkeypatch.setattr(ar, "is_org_admin", fake_is_org_admin)
    import server
    monkeypatch.setattr(server, "task_is_in_org", fake_task_is_in_org)

    async def fake_is_project_owner(pool, team_id, user_id):
        return False                 # not a project owner — hatch is the only door

    monkeypatch.setattr(ar, "is_project_owner", fake_is_project_owner)
    return seen


# ── The org actually reaches the predicate ─────────────────────────────────────

@pytest.mark.asyncio
async def test_the_admin_hatch_is_asked_about_the_ACTIVE_org(spy):
    """`is_org_admin` must be called WITH an org, not with one argument.

    This is the assertion the whole finding reduces to. Before the fix the call
    was `is_org_admin(user["user_id"])` and this list held `(user, None)`.
    """
    await ar.org_admin_may_reach_task(Pool(), OUTSIDER, ORG_B, dict(TASK))
    assert spy["is_org_admin"] == [(OUTSIDER, ORG_B)], (
        "the admin hatch was asked WITHOUT an org — that is the unscoped "
        "one-argument form, which is True for an admin row in ANY organisation"
    )


@pytest.mark.asyncio
async def test_an_admin_of_another_org_is_refused_the_task(spy):
    """True from `is_org_admin` is no longer sufficient. Both halves are needed."""
    reached = await ar.org_admin_may_reach_task(Pool(), OUTSIDER, ORG_B, dict(TASK))
    assert reached is False, (
        "an administrator of ORG_B reached a task in ORG_A — this is the "
        "cross-tenant write `server.delete_task` already fixed once"
    )
    assert spy["task_is_in_org"] == [(ORG_B, "team_in_org_a")], (
        "the task-in-org half was never asked; `delete_task`'s rule is that a "
        "destructive write may not be one predicate short"
    )


@pytest.mark.asyncio
async def test_an_admin_of_the_tasks_own_org_still_gets_through(spy):
    """The hatch must still OPEN for the org that owns the task.

    A fix that refuses everybody is not a fix — it is an outage, and it would
    take the org's own administrators off their own approvals.
    """
    reached = await ar.org_admin_may_reach_task(Pool(), "user_admin_here", ORG_A, dict(TASK))
    assert reached is True


@pytest.mark.asyncio
async def test_no_org_on_the_session_falls_back_to_the_unscoped_question(spy):
    """`active_org_id` NEVER RAISES and returns None for a caller with no org.

    With no org there is nothing to scope to, so the one-argument form is the
    honest question — and `task_is_in_org(pool, None, …)` still has to agree.
    Asserting this pins the branch, so a later "tidy-up" that drops it shows up
    as a failure rather than as a silent 403 for every org-less caller.
    """
    await ar.org_admin_may_reach_task(Pool(), OUTSIDER, None, dict(TASK))
    assert spy["is_org_admin"] == [(OUTSIDER,)] or spy["is_org_admin"] == [(OUTSIDER, None)]


# ── Every route that had the hole now carries the org ──────────────────────────

@pytest.mark.parametrize("name", [
    "approve_task", "reject_task",
    "client_approve_task", "client_reject_task",
    "request_approval", "request_client_approval",
])
def test_every_formerly_unscoped_route_takes_an_org_dependency(name):
    """The org has to be able to REACH the predicate before it can be used.

    `approvals_router` had no `active_org_id` dependency anywhere, so it could
    not have scoped these checks even if it had wanted to. Six routes, named
    individually so a regression says WHICH one lost it.
    """
    import inspect
    params = inspect.signature(getattr(ar, name)).parameters
    assert "org" in params, f"{name} lost its Depends(active_org_id)"


def test_no_unscoped_is_org_admin_call_survives_outside_the_named_exemption():
    """One call site is deliberately unscoped, and exactly one.

    `get_pending_approvals` chooses WHICH of two queries runs, and BOTH require
    a `project_assignments` row for the caller — so the unscoped answer can only
    widen the list to projects the caller already belongs to, which is not a
    tenancy crossing. It is exempt by reasoning, and this test pins the count so
    a NEW unscoped call cannot arrive unnoticed.

    Comments are stripped before searching: this repo has already shipped a test
    that matched the explanatory comment written above its own fix.
    """
    import re
    from pathlib import Path
    src = Path(ar.__file__).read_text(encoding="utf-8")
    src = re.sub(r"^\s*#.*$", "", src, flags=re.MULTILINE)     # line comments
    src = re.sub(r'"""(?:.|\n)*?"""', "", src)                  # docstrings
    unscoped = re.findall(r'is_org_admin\(\s*user\["user_id"\]\s*\)', src)
    assert len(unscoped) == 1, (
        f"expected exactly ONE deliberately-unscoped is_org_admin call "
        f"(get_pending_approvals), found {len(unscoped)}"
    )
