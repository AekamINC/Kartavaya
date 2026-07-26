"""
Private attachments, on every path that returns a task.

`server.py` has three reads that return attachments and all three must filter:

    /api/tasks/{task_id}   get_task       _filter_private_attachments
    /api/client/tasks      client_tasks   _filter_private_attachments
    /api/tasks             list_tasks     _filter_private_attachments

`list_tasks` used to be the exception. It built its rows with `row_to_task` and
handed each straight to `_refresh_task_attachments`, which RE-SIGNS the R2 URLs,
so any teammate who could see the task received a fresh, live, signed URL to a
file the firm had marked private — on the route with by far the most traffic.
These tests were written against that bug, failed, and the fix landed with them.

`list_tasks` and `client_tasks` filter BEFORE re-signing, so a file the caller
may not see is never handed a fresh credential even transiently.
"""

import pytest

from helpers import make_task_row

MEMBER_UID = "user_mem001"
OTHER_UID = "user_someone_else"

#: One public file and one private file the member is not on.
_MIXED_ATTACHMENTS = (
    '[{"name": "agenda.pdf", "url": "https://r2.example/agenda",'
    '  "key": "org/a/agenda.pdf", "is_private": false},'
    ' {"name": "salary-review-2026.pdf", "url": "https://r2.example/salary",'
    '  "key": "org/a/salary.pdf", "is_private": true,'
    '  "visible_to": ["user_partner_only"]}]'
)


@pytest.fixture(autouse=True)
def _no_org_lookup(mock_pool):
    """No org resolves from the team, so `_refresh_task_attachments` returns
    before it reaches storage. Nothing signs a real R2 URL in these tests."""
    import server
    server._team_org_cache.clear()
    yield
    server._team_org_cache.clear()


def _visible_team(mock_pool, task_row):
    """The member is in team_001; the task lives there but is someone else's.

    Routed by query text rather than by call order, because `get_task` and
    `list_tasks` reach the same tables in a different sequence and a positional
    `side_effect` list would silently hand the wrong row to one of them.
    """
    async def _fetch(query, *args):
        if "team_id FROM teams" in query or "team_members" in query:
            return [{"team_id": "team_001"}]
        if "project_assignments" in query:
            return [{"team_id": "team_001"}]
        if "task_reminders" in query:
            return []
        return [task_row]

    async def _fetchrow(query, *args):
        # `_resolve_org_id`. No org means `_refresh_task_attachments` returns
        # before it reaches storage — nothing signs a real R2 URL here.
        if "org_id FROM teams" in query:
            return None
        return task_row

    mock_pool.fetch.side_effect = _fetch
    mock_pool.fetchrow.side_effect = _fetchrow


# ── GET /api/tasks/{task_id} — the path that already filters ─────────────────

async def test_single_task_read_strips_a_private_attachment(
    api_client, mock_pool, as_member,
):
    """The behaviour `list_tasks` is missing, asserted on the route that has it.

    This is the control: it proves the filter works and that the mock setup
    genuinely reaches the attachment path, so the xfail below is a real
    difference between two routes rather than a broken fixture."""
    task_row = make_task_row(
        task_id="task_shared",
        created_by_user_id=OTHER_UID,
        user_id=OTHER_UID,
        attachments=_MIXED_ATTACHMENTS,
    )
    _visible_team(mock_pool, task_row)

    resp = await api_client.get("/api/tasks/task_shared")
    assert resp.status_code == 200

    names = [a["name"] for a in resp.json()["attachments"]]
    assert names == ["agenda.pdf"]
    assert "salary-review-2026.pdf" not in resp.text


# ── GET /api/tasks — the path that does not ──────────────────────────────────

async def test_list_tasks_strips_a_private_attachment_from_a_non_creator(
    api_client, mock_pool, as_member,
):
    """A private file must not reach a teammate who is neither the creator nor
    named in `visible_to`."""
    task_row = make_task_row(
        task_id="task_shared",
        created_by_user_id=OTHER_UID,
        user_id=OTHER_UID,
        attachments=_MIXED_ATTACHMENTS,
    )
    _visible_team(mock_pool, task_row)

    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1

    names = [a["name"] for a in body[0]["attachments"]]
    assert "salary-review-2026.pdf" not in names, (
        "a private attachment reached a non-creator through GET /api/tasks"
    )
    assert names == ["agenda.pdf"]


async def test_list_tasks_hands_out_no_url_for_a_private_attachment(
    api_client, mock_pool, as_member,
):
    """Stated separately because the filename leaking and a working download
    link leaking are different severities, and only the second is an exposure of
    the file itself."""
    task_row = make_task_row(
        task_id="task_shared",
        created_by_user_id=OTHER_UID,
        user_id=OTHER_UID,
        attachments=_MIXED_ATTACHMENTS,
    )
    _visible_team(mock_pool, task_row)

    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200
    assert "r2.example/salary" not in resp.text


# ── The filter helper itself ─────────────────────────────────────────────────
#
# Unit tests, so that when the fix lands on `list_tasks` the thing it starts
# calling is already known-correct.

def _attachment(**overrides):
    from server import Attachment
    base = {"name": "f.pdf", "url": "https://r2.example/f", "is_private": True, "visible_to": []}
    base.update(overrides)
    return Attachment(**base)


def _task_with(attachments):
    from server import row_to_task
    task = row_to_task(make_task_row())
    task.attachments = attachments
    return task


def test_filter_keeps_public_attachments_for_everyone():
    from server import _filter_private_attachments
    task = _task_with([_attachment(is_private=False)])
    kept = _filter_private_attachments(task, "user_anyone", is_creator=False)
    assert len(kept.attachments) == 1


def test_filter_keeps_a_private_attachment_for_the_creator():
    from server import _filter_private_attachments
    task = _task_with([_attachment()])
    kept = _filter_private_attachments(task, "user_creator", is_creator=True)
    assert len(kept.attachments) == 1


def test_filter_keeps_a_private_attachment_for_someone_named_in_visible_to():
    from server import _filter_private_attachments
    task = _task_with([_attachment(visible_to=["user_named"])])
    kept = _filter_private_attachments(task, "user_named", is_creator=False)
    assert len(kept.attachments) == 1


def test_filter_drops_a_private_attachment_for_everyone_else():
    from server import _filter_private_attachments
    task = _task_with([_attachment(visible_to=["user_named"])])
    kept = _filter_private_attachments(task, "user_stranger", is_creator=False)
    assert kept.attachments == []


def test_filter_is_per_attachment_not_per_task():
    """A task with one private file must not lose its public ones."""
    from server import _filter_private_attachments
    task = _task_with([
        _attachment(name="public.pdf", is_private=False),
        _attachment(name="secret.pdf", is_private=True, visible_to=[]),
    ])
    kept = _filter_private_attachments(task, "user_stranger", is_creator=False)
    assert [a.name for a in kept.attachments] == ["public.pdf"]
