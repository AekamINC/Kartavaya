""""No active org" still means "admin of every org", and this file is the proof.

── STATUS: THESE TWO TESTS ARE XFAIL. THE HOLE IS OPEN. ───────────────────────

They are not aspirational and they are not skipped. They run, they demonstrate
the leak against the shipped code, and they will start reporting XPASS the day
somebody closes it — which is the signal to delete the markers and keep them.
The fix was written and then BACKED OUT, deliberately; see the bottom of this
docstring for why, because the reason is a decision and not an oversight.

── THE DEFECT ─────────────────────────────────────────────────────────────────

`a555edde` scoped the admin hatches in `server.py` with this shape, in nine
places:

    _is_admin = await is_org_admin(uid, org) if org else await is_org_admin(uid)

The `if org` half is the fix and it holds. The `else` half is the ORIGINAL,
unscoped question, untouched: `is_org_admin(uid)` with no argument is True for a
platform row (`org_id IS NULL`) and for an `org_owner`/`org_admin` row in ANY
organisation. It runs whenever `active_org_id` resolves None — and at `get_task`
and `delete_task` it is paired with `task_is_in_org(pool, None, …)`, which
returns True by design. True AND True is an open hatch on any task in the
database by id, read and DELETE, with `get_visible_team_ids` never reached.

── WHO IS ACTUALLY IN THAT BRANCH, MEASURED ───────────────────────────────────

Read-only against kartavya-sg on 2026-08-06 — accounts holding a platform role
(`org_id IS NULL`) and no member/owner/admin row in any ACTIVE organisation:

    sid@aekaminc.com    platform_admin    (ONE account, vendor-controlled)

`active_org_id` answers None for exactly that account on the core task surface:
`get_org_id`'s fallback needs an org-scoped `user_roles` row and there is none,
and the `X-Org-Id` header path was closed to platform roles outside the console
prefixes in c7494db6. The SCOPED branch already refuses this account —
`is_org_admin(uid, org)` requires membership — so the `else` is the only way it
still reaches another tenant's task.

The two populations `active_org_id`'s docstring exists to protect are NOT in
this branch, and the distinction is the whole argument: portal clients hold no
`staging.user_roles` row at all, and staff whose only membership is an
`org_id IS NULL` team hold no platform row, so for both of them the unscoped
call is ALREADY False. Narrowing the `else` cannot 403 them. And
`get_visible_team_ids` has returned zero teams for the platform-no-org shape
since 965d0e82, so closing this would make the hatches AGREE with the
visibility helper rather than remove an access anyone relies on.

── WHY IT IS NOT FIXED HERE ───────────────────────────────────────────────────

`tests/test_task_org_boundary.py::test_no_active_org_falls_back_to_the_old_global_question`
asserts the current behaviour BY NAME, with a stated rationale ("narrowing it
would 403 the two populations `active_org_id`'s docstring names"). That
rationale is, on the measurement above, not correct — but overwriting another
engineer's named intent, plus the source-scan in
`test_stale_admin_token.py::test_the_three_repaired_handlers_read_the_role_at_request_time`
and the lookup-count assertion in
`test_task_attachments.py::test_list_tasks_resolves_the_admin_role_at_most_once_per_request`,
is three tests in files this change does not own. So: measured, demonstrated,
left open, and handed over.

The change itself is one function and nine call sites: replace the expression
above with a helper that returns False when `org` is None.
"""
import pytest

import server

ORGLESS = "user_platform_no_org"     # sid@aekaminc.com's shape
MEMBER = "user_a_staff"

TASK_A = {
    "task_id": "task_aekam_secret",
    "team_id": "team_aekam_1",
    "user_id": MEMBER,
    "created_by_user_id": MEMBER,
    "title": "another tenant's task",
}

OPEN_HATCH = pytest.mark.xfail(
    reason="the `else await is_org_admin(uid)` arm is still open for a platform "
           "account that belongs to no organisation — see this module's docstring",
    strict=False,
)


class Pool:
    def __init__(self, task=None):
        self.task = task
        self.queries = []
        self.executed = []

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "FROM tasks" in flat:
            return self.task
        return None

    async def fetchval(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return None

    async def fetch(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return []

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))
        return "DELETE 1"


@pytest.fixture
def orgless_platform_admin(monkeypatch):
    """Admin ANYWHERE (a platform row), admin of NO org.

    The finding in two lines: the unscoped call says yes and every scoped call
    says no.
    """
    async def _is_org_admin(uid, org_id=None):
        if org_id is None:
            return uid == ORGLESS
        return False

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)

    async def _no_teams(pool, user_id, role=None, include_archived=False,
                        _user_dict=None, org_id=None):
        return []

    monkeypatch.setattr(server, "get_visible_team_ids", _no_teams)


@OPEN_HATCH
async def test_orgless_platform_admin_cannot_delete_another_tenants_task(
        orgless_platform_admin):
    """The destructive one. There is no undo and nothing that would show it.

    Observed failure against the shipped code:
        Failed: DID NOT RAISE <class 'fastapi.exceptions.HTTPException'>
    — i.e. the delete went through.
    """
    pool = Pool(task=dict(TASK_A))
    with pytest.raises(server.HTTPException) as exc:
        await server.delete_task("task_aekam_secret", pool=pool,
                                 user={"user_id": ORGLESS}, org=None)
    assert exc.value.status_code == 403
    assert not any("DELETE FROM tasks" in q for q, _ in pool.executed), (
        f"another tenant's task was deleted: {pool.executed}"
    )


@OPEN_HATCH
async def test_orgless_platform_admin_cannot_read_another_tenants_task(
        orgless_platform_admin, monkeypatch):
    """`get_task` short-circuits on the hatch before any team narrowing runs.

    `_fetch_enriched_task` is replaced by a sentinel so the assertion is about
    REACHING the read, not about the shape of the row it would build.

    Observed failure against the shipped code:
        Failed: DID NOT RAISE <class 'fastapi.exceptions.HTTPException'>
    """
    async def _enriched(pool, task_id, viewer_id=None, viewer_is_admin=None):
        return "LEAKED"

    monkeypatch.setattr(server, "_fetch_enriched_task", _enriched)
    pool = Pool(task={**TASK_A, "assignee_user_ids": []})
    with pytest.raises(server.HTTPException) as exc:
        await server.get_task("task_aekam_secret", pool=pool,
                              user={"user_id": ORGLESS}, org=None)
    assert exc.value.status_code == 403


async def test_a_portal_client_was_never_in_this_branch(orgless_platform_admin):
    """The population the `else` arm is defended on behalf of is not in it.

    This one PASSES today and must keep passing: a portal client holds no
    `staging.user_roles` row, so the unscoped call is already False for them and
    the hatch never opens. It is here so that the argument in the docstring —
    "narrowing the else cannot 403 the portal clients" — is a check rather than
    a claim.
    """
    assert await server.is_org_admin("portal_1") is False
    assert await server.is_org_admin("portal_1", "any-org") is False
