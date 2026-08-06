"""Editing and deleting someone else's comment is an ADMIN act, in ONE org.

`PUT /api/tasks/{task_id}/comments/{comment_id}` and its DELETE sibling both
end in the same two lines:

    if row["user_id"] != user["user_id"] and not await is_org_admin(user["user_id"]):
        raise HTTPException(403, "Can only edit your own comments")

`is_org_admin(uid)` with no org is True for an `org_owner`/`org_admin` row in
ANY organisation and for every platform role (`middleware/roles.py:341-347`).
Neither handler resolves an active org — no `Depends(active_org_id)`, no
`get_visible_team_ids`, no team predicate anywhere — so the caller reaching the
hatch is never asked which organisation the comment is in. An org_admin of one
small org could rewrite or delete any comment in the database by id, with the
switcher pointed somewhere else entirely.

This is the same defect a555edde closed on `get_task`, `delete_task` and the
approval review paths, in the two handlers it did not reach. It needs the same
two halves, and neither is sufficient alone: `is_org_admin(uid, org)` says the
caller administers THIS org, and `task_is_in_org` says the comment's task is IN
it.
"""
import pytest

import server

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # Aekam Inc — the other tenant
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # E2E Test  — the active org

CALLER = "user_admin_of_b"
AUTHOR = "user_a_staff"          # someone else entirely, in the other org

COMMENT = {
    "comment_id": "cmt_aekam_1",
    "task_id": "task_aekam_secret",
    "user_id": AUTHOR,
    "body": "the firm's internal note",
    "created_at": "2026-08-06T00:00:00+00:00",
    "is_client_visible": False,
}


class Pool:
    def __init__(self, comment=None, task=None):
        self.comment = comment
        self.task = task
        self.queries = []
        self.executed = []

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "task_comments" in flat and flat.startswith("UPDATE"):
            self.executed.append((flat, args))
            return {**(self.comment or {}), "body": args[0]}
        if "task_comments" in flat:
            return self.comment
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
def admin_of_b(monkeypatch):
    async def _is_org_admin(uid, org_id=None):
        if org_id is None:
            return uid == CALLER            # admin SOMEWHERE — the old answer
        return uid == CALLER and str(org_id) == ORG_B

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)


@pytest.fixture
def task_elsewhere(monkeypatch):
    async def _in_org(pool, org, *, team_id=None, owner_ids=()):
        return False                        # task_aekam_secret is not in ORG_B

    monkeypatch.setattr(server, "task_is_in_org", _in_org)


@pytest.fixture
def task_here(monkeypatch):
    async def _in_org(pool, org, *, team_id=None, owner_ids=()):
        return True

    monkeypatch.setattr(server, "task_is_in_org", _in_org)


TASK_A = {"task_id": "task_aekam_secret", "team_id": "team_aekam_1",
          "user_id": AUTHOR, "created_by_user_id": AUTHOR}


async def test_org_admin_cannot_edit_another_orgs_comment(admin_of_b, task_elsewhere):
    pool = Pool(comment=dict(COMMENT), task=dict(TASK_A))
    with pytest.raises(server.HTTPException) as exc:
        await server.edit_comment(
            "task_aekam_secret", "cmt_aekam_1",
            server.CommentCreate(body="rewritten by a stranger"),
            pool=pool, user={"user_id": CALLER}, org=ORG_B)
    assert exc.value.status_code == 403
    assert not pool.executed, (
        f"another tenant's comment was rewritten: {pool.executed}"
    )


async def test_org_admin_cannot_delete_another_orgs_comment(admin_of_b, task_elsewhere):
    pool = Pool(comment=dict(COMMENT), task=dict(TASK_A))
    with pytest.raises(server.HTTPException) as exc:
        await server.delete_comment(
            "task_aekam_secret", "cmt_aekam_1",
            pool=pool, user={"user_id": CALLER}, org=ORG_B)
    assert exc.value.status_code == 403
    assert not pool.executed, (
        f"another tenant's comment was deleted: {pool.executed}"
    )


async def test_org_admin_still_moderates_inside_their_own_org(admin_of_b, task_here):
    """The hatch has to keep working where it is legitimate.

    An org admin moderating their OWN org's comment holds no authorship row —
    that is the whole reason the hatch exists.
    """
    pool = Pool(comment=dict(COMMENT), task=dict(TASK_A))
    out = await server.edit_comment(
        "task_aekam_secret", "cmt_aekam_1",
        server.CommentCreate(body="tidied up"),
        pool=pool, user={"user_id": CALLER}, org=ORG_B)
    assert out.body == "tidied up"
    assert pool.executed


async def test_the_author_still_edits_their_own_comment(task_elsewhere, monkeypatch):
    """No admin row at all, and the org check must never be reached.

    The author path is not an admin path; narrowing the hatch must not narrow
    it. `is_org_admin` raises here so the test fails loudly if the author is
    routed through the admin question rather than short-circuiting before it.
    """
    async def _boom(uid, org_id=None):
        raise AssertionError("the author was sent through the admin gate")

    monkeypatch.setattr(server, "is_org_admin", _boom)
    pool = Pool(comment=dict(COMMENT), task=dict(TASK_A))
    out = await server.edit_comment(
        "task_aekam_secret", "cmt_aekam_1",
        server.CommentCreate(body="my own typo"),
        pool=pool, user={"user_id": AUTHOR}, org=ORG_B)
    assert out.body == "my own typo"
