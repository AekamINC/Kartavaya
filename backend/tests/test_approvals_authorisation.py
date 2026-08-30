"""Two approval endpoints wrote to any task in the database.

`request-approval` and `request-client-approval` both called a helper named
`get_task_with_permission` — which never checked a permission. It was one
unfiltered `SELECT * FROM tasks WHERE task_id=$1`, and its docstring said the
check was "done by callers". Four of six callers did one. These two did not.

WHAT THAT ALLOWED, for ANY authenticated account — no platform role, no org
admin, every ordinary user of every customer:

  · write `approval_status`, `approval_requested_at` and attacker-supplied
    `approval_notes` onto another organisation's task
  · INSERT a `task_clients` row, which is a self-issued grant of read access
  · send that task's TITLE by email to any address the caller names

The helper is now `fetch_task_or_404` — a name that describes what it does —
and authorisation is `assert_may_act_on_task`, called visibly at each site.

These tests exercise the GUARD as a unit rather than through HTTP. The module's
pool is mocked in this suite, and `routers/messaging.py:30-41` records what a
mocked cursor is worth: every read endpoint there once answered 500 against a
real database with the whole suite green, because a mock resolves any table name
you hand it. So the thing worth proving — who is let through and who is not — is
proven directly against the function that decides it.
"""
import pytest
from fastapi import HTTPException

import approvals_router as A


class _Pool:
    """Answers the membership probe with whatever the test sets."""

    def __init__(self, member=False):
        self.member = member
        self.queries = []

    async def fetchrow(self, q, *args):
        self.queries.append(q)
        return {"1": 1} if self.member else None


def _task(**kw):
    base = {
        "task_id": "task_abc123def456",
        "user_id": "user_owner000",
        "created_by_user_id": "user_owner000",
        "assignee_user_ids": [],
        "team_id": "team_aaa111bbb222",
        "title": "Q3 settlement — final",
    }
    base.update(kw)
    return base


def _user(uid):
    return {"user_id": uid}


@pytest.fixture
def not_org_admin(monkeypatch):
    async def _no(_uid):
        return False
    monkeypatch.setattr(A, "is_org_admin", _no)


@pytest.fixture
def org_admin(monkeypatch):
    async def _yes(_uid):
        return True
    monkeypatch.setattr(A, "is_org_admin", _yes)


# ── The regression ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_stranger_cannot_act_on_someone_elses_task(not_org_admin):
    """THE bug. Any signed-in account holding a task id could write to it."""
    with pytest.raises(HTTPException) as e:
        await A.assert_may_act_on_task(_Pool(member=False), _task(), _user("user_stranger9"))
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_the_refusal_does_not_confirm_the_task_exists(not_org_admin):
    """
    404, not 403. A 403 tells the caller the id was real, which turns the
    endpoint into an oracle for ids they were never meant to hold. An unknown id
    already answers 404 from `fetch_task_or_404`, so the two are identical.
    """
    with pytest.raises(HTTPException) as e:
        await A.assert_may_act_on_task(_Pool(member=False), _task(), _user("user_stranger9"))
    assert e.value.status_code == 404
    assert e.value.detail == A._TASK_NOT_FOUND


# ── Who must still get through ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_task_owner_may(not_org_admin):
    await A.assert_may_act_on_task(_Pool(member=False), _task(), _user("user_owner000"))


@pytest.mark.asyncio
async def test_the_creator_may_even_when_someone_else_owns_it(not_org_admin):
    task = _task(user_id="user_other111", created_by_user_id="user_creator22")
    await A.assert_may_act_on_task(_Pool(member=False), task, _user("user_creator22"))


@pytest.mark.asyncio
async def test_an_assignee_may(not_org_admin):
    task = _task(user_id="user_other111", created_by_user_id="user_other111",
                 assignee_user_ids=["user_assigned3"])
    await A.assert_may_act_on_task(_Pool(member=False), task, _user("user_assigned3"))


@pytest.mark.asyncio
async def test_a_team_member_may_without_being_an_owner(not_org_admin):
    """Requesting approval is a member action. This must NOT require ownership."""
    await A.assert_may_act_on_task(_Pool(member=True), _task(), _user("user_member444"))


@pytest.mark.asyncio
async def test_an_org_admin_may(org_admin):
    await A.assert_may_act_on_task(_Pool(member=False), _task(), _user("user_admin555"))


# ── Edges that would otherwise crash or leak ─────────────────────────────────

@pytest.mark.asyncio
async def test_a_personal_task_with_no_team_does_not_crash(not_org_admin):
    """`team_id` is NULL for personal tasks; the membership probe must be skipped."""
    with pytest.raises(HTTPException):
        await A.assert_may_act_on_task(
            _Pool(member=False), _task(team_id=None), _user("user_stranger9"))


@pytest.mark.asyncio
async def test_a_null_assignee_list_does_not_crash(not_org_admin):
    """`assignee_user_ids` is NULL on older rows, not []."""
    with pytest.raises(HTTPException):
        await A.assert_may_act_on_task(
            _Pool(member=False), _task(assignee_user_ids=None), _user("user_stranger9"))


@pytest.mark.asyncio
async def test_every_branch_of_the_membership_probe_is_scoped_to_the_task_s_team(not_org_admin):
    """
    A branch with no team predicate lets any member of ANY project through.

    Checked per UNION BRANCH, not over the whole string. The first version of
    this test asserted `"team_id=$1" in q` and stayed GREEN when the predicate
    was stripped from the first branch — the second branch still contained the
    substring. It proved the query mentioned a team somewhere, which is not the
    same as scoping to one, and that is the exact shape of a decorative test.

    THERE IS ONE BRANCH NOW, and that is the assertion rather than an
    exemption from it. This probe UNIONed `project_assignments` with
    `team_members` because the two tables disagreed about who was in a project.
    Migration 195 (`195_reconcile_team_members_into_project_assignments.sql`,
    applied 2026-08-22) reconciled them — every active `team_members` row now
    has a `project_assignments` row at the identical role — so phase 2 of
    `PROPOSED_080_team_members_retire.sql` dropped the second branch. Asserting
    `>= 2` after that would demand a second reader of a settled fact, which is
    what the retirement exists to remove. The per-branch scoping check below is
    unchanged and is the part that was ever load-bearing.
    """
    pool = _Pool(member=True)
    await A.assert_may_act_on_task(pool, _task(), _user("user_member444"))
    assert pool.queries, "no membership query was issued at all"

    probe = pool.queries[0].upper()
    assert "TEAM_MEMBERS" not in probe, (
        "the membership probe reads team_members again. Project membership is "
        "public.project_assignments since migration 195; a second reader is a "
        "second rule and it will drift, which is how this probe and the "
        "approvals queue came to disagree in the first place."
    )
    branches = [b for b in probe.split("UNION") if b.strip()]
    assert branches, "the membership query has no branches at all"
    for i, branch in enumerate(branches):
        assert "TEAM_ID=$1" in branch, (
            f"UNION branch {i} has no team predicate — it matches the user in "
            f"every project: {branch.strip()}"
        )
        assert "USER_ID=$2" in branch, f"UNION branch {i} has no user predicate"


# ── The call sites ───────────────────────────────────────────────────────────

def test_both_repaired_endpoints_call_the_guard():
    """
    A guard nothing calls is the shape of the original bug. Pinned by source,
    because the HTTP path here runs on a mocked pool that would answer anything.
    """
    import inspect
    for fn in (A.request_approval, A.request_client_approval):
        src = inspect.getsource(fn)
        assert "assert_may_act_on_task" in src, f"{fn.__name__} does not authorise"


def test_the_helper_no_longer_claims_to_check_a_permission():
    """The NAME is what a reader at a call site sees, and it lied for six calls."""
    assert not hasattr(A, "get_task_with_permission")
    assert hasattr(A, "fetch_task_or_404")


# ── The cross-org approve hatch — FOUND BY MUTATION TESTING, 2026-08-30 ──────
#
# `scripts/mutate.py` disabled the guard on `approvals_router.py:461` — the one
# whose own comment reads "AND THE ADMIN HATCH IS NOW SCOPED TO THIS ORG, AND TO
# THIS TASK. It was `is_org_admin(user["user_id"])`, which is True for an admin
# row in ANY organisation" — and ALL FIVE approvals test files stayed GREEN.
#
# So the fix for a cross-tenant hole had nothing pinning it. Whoever next
# simplified that line back to `is_org_admin(...)` would have reopened the hole
# against a fully green suite, which is precisely how it got in the first time.
#
# Two tests, one per direction. The refusal is the one that kills the mutant;
# the admission is what stops the refusal being satisfied by a function that
# always raises.

@pytest.mark.asyncio
async def test_an_admin_of_ANOTHER_org_cannot_approve(monkeypatch):
    """The mutant `if False:` on line 461 makes this test, and only this test, fail."""
    monkeypatch.setattr(A, "fetch_task_or_404", lambda *a, **k: _async(_task()))
    monkeypatch.setattr(A, "is_project_owner", lambda *a, **k: _async(False))
    # An org admin — but of a different company, so the scoped probe says no.
    monkeypatch.setattr(A, "org_admin_may_reach_task", lambda *a, **k: _async(False))

    with pytest.raises(HTTPException) as e:
        await A.approve_task(
            "task_abc123def456", _ApprovalPayload(),
            pool=_Pool(), user=_user("user_admin_of_other_co"), org="org_other",
        )
    assert e.value.status_code == 403
    assert "owner or admin" in str(e.value.detail)


@pytest.mark.asyncio
async def test_an_admin_of_THIS_org_is_not_stopped_by_that_guard(monkeypatch):
    """
    The other direction. Without it, a guard that raised unconditionally would
    satisfy the test above and lock every legitimate admin out — a refusal test
    on its own cannot tell "correctly scoped" from "broken shut".
    """
    monkeypatch.setattr(A, "fetch_task_or_404", lambda *a, **k: _async(_task()))
    monkeypatch.setattr(A, "is_project_owner", lambda *a, **k: _async(False))
    monkeypatch.setattr(A, "org_admin_may_reach_task", lambda *a, **k: _async(True))

    # It proceeds past the guard and then fails on the mocked pool's column
    # query, which is fine: what is asserted is that the 403 did NOT fire.
    with pytest.raises(Exception) as e:
        await A.approve_task(
            "task_abc123def456", _ApprovalPayload(),
            pool=_Pool(), user=_user("user_admin_of_this_co"), org="org_this",
        )
    assert not (isinstance(e.value, HTTPException) and e.value.status_code == 403), (
        "an admin of the task's OWN org was refused — the guard is scoped too tightly"
    )


async def _async(value):
    """`monkeypatch.setattr` needs a coroutine function; this makes one inline."""
    return value


class _ApprovalPayload:
    """The two fields `approve_task` reads off its payload."""
    notes = None
    column_id = None
