"""
Private task attachments must not cross to a caller who is not on `visible_to`,
and their R2 URLs must not be signed for that caller even transiently.

Why this file exists
--------------------
`GET /api/tasks/{id}` has filtered private attachments since the drawer was
written. `GET /api/tasks` — the BOARD's list, and the one every project page
actually calls — never did. It ran `_refresh_task_attachments` over every task
and returned the result, so a file the firm marked private and shared with two
named people went to every member of the team, and via the `task_clients` clause
in that endpoint's WHERE to the external CLIENT on the task, each with a live
presigned R2 URL plus `is_private`, `visible_to` and `key`.

The two tests that would have caught it are `test_list_tasks_*_private_*`.

Ordering is asserted separately. `sign_key` does not read a file, it MINTS A
CAPABILITY: the URL it returns works for anyone holding it until it expires,
with no further authorisation. Filtering after minting is not filtering, so the
tests assert `sign_key` was never CALLED for a hidden key — not merely that the
URL is absent from the body.
"""

import json

import pytest

from helpers import make_task_row

TEAM = "team_001"

PUBLIC_FILE = {
    "name": "brief.pdf",
    "url": "https://r2.example/stale-public",
    "key": "org/pub.pdf",
    "is_private": False,
    "visible_to": [],
}
PRIVATE_FILE = {
    "name": "salary-review.pdf",
    "url": "https://r2.example/stale-private",
    "key": "org/private.pdf",
    "is_private": True,
    # Deliberately NOT the caller in the tests below.
    "visible_to": ["user_owner001"],
}

TASK_WITH_PRIVATE = make_task_row(
    task_id="task_priv001",
    team_id=TEAM,
    created_by_user_id="user_owner001",
    attachments=json.dumps([PUBLIC_FILE, PRIVATE_FILE]),
)


@pytest.fixture
def signed(monkeypatch):
    """Record every key handed to sign_key, and return a recognisable URL."""
    calls: list[str] = []

    async def _sign_key(org_id, key):
        calls.append(key)
        return f"https://r2.example/FRESH?k={key}"

    import services.storage as storage
    monkeypatch.setattr(storage, "sign_key", _sign_key)
    return calls


@pytest.fixture
def board_pool(mock_pool):
    """A pool that answers the board-list queries with one task carrying both files."""
    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": TEAM}]
        if "FROM tasks t" in query:
            return [TASK_WITH_PRIVATE]
        return []

    async def fetchrow_side(query, *args):
        # _resolve_org_id — the task's team must map to an org or signing is skipped
        if "org_id FROM teams" in query:
            return {"org_id": "11111111-1111-1111-1111-111111111111"}
        return None

    mock_pool.fetch.side_effect = fetch_side
    mock_pool.fetchrow.side_effect = fetchrow_side
    return mock_pool


def _attachments(payload):
    assert isinstance(payload, list) and payload, "expected at least one task"
    return payload[0]["attachments"]


# ── GET /api/tasks — the board list ──────────────────────────────────────────

async def test_list_tasks_hides_private_attachment_from_non_viewer(
    api_client, board_pool, signed, as_member
):
    """A member who is neither creator nor on visible_to must not see the file."""
    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200

    names = [a["name"] for a in _attachments(resp.json())]
    assert PUBLIC_FILE["name"] in names
    assert PRIVATE_FILE["name"] not in names, (
        "private attachment leaked through the board list"
    )


async def test_list_tasks_never_signs_a_hidden_attachment(
    api_client, board_pool, signed, as_member
):
    """The capability must never be minted, not merely withheld after minting."""
    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200
    assert PRIVATE_FILE["key"] not in signed, (
        "sign_key was called for an attachment the caller may not see — "
        "the presigned URL exists regardless of whether it was returned"
    )
    assert PUBLIC_FILE["key"] in signed, "the visible attachment should still be re-signed"


async def test_list_tasks_leaks_no_private_metadata(
    api_client, board_pool, signed, as_member
):
    """`visible_to` names other people; `key` is R2 internals. Neither should ride along."""
    body = (await api_client.get("/api/tasks")).json()
    blob = json.dumps(body)
    assert PRIVATE_FILE["name"] not in blob
    assert PRIVATE_FILE["key"] not in blob


async def test_list_tasks_creator_still_sees_own_private_attachment(
    api_client, mock_pool, signed, as_member, member_user
):
    """Filtering must not hide a caller's own file from them."""
    own = make_task_row(
        task_id="task_own001",
        team_id=TEAM,
        created_by_user_id=member_user["user_id"],
        attachments=json.dumps([PRIVATE_FILE]),
    )

    async def fetch_side(query, *args):
        if "team_id FROM teams" in query:
            return [{"team_id": TEAM}]
        if "FROM tasks t" in query:
            return [own]
        return []

    async def fetchrow_side(query, *args):
        if "org_id FROM teams" in query:
            return {"org_id": "11111111-1111-1111-1111-111111111111"}
        return None

    mock_pool.fetch.side_effect = fetch_side
    mock_pool.fetchrow.side_effect = fetchrow_side

    resp = await api_client.get("/api/tasks")
    assert resp.status_code == 200
    names = [a["name"] for a in _attachments(resp.json())]
    assert PRIVATE_FILE["name"] in names


async def test_list_tasks_signs_the_visible_url_fresh(
    api_client, board_pool, signed, as_member
):
    """The surviving attachment gets a fresh URL, not the stale stored one."""
    resp = await api_client.get("/api/tasks")
    att = _attachments(resp.json())
    pub = next(a for a in att if a["name"] == PUBLIC_FILE["name"])
    assert pub["url"].startswith("https://r2.example/FRESH")
