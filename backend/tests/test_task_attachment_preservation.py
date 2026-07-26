"""
Updating a task must not destroy a private attachment the caller cannot see.

`PUT /api/tasks/{id}` writes the attachments column wholesale: whatever list
arrives replaces what was there. But the list the caller was SHOWN went through
`_filter_private_attachments`, which removes private files they may not see. So
a client round-trips a list with those files already missing, and saving any
unrelated edit — a title, a priority — wrote that shorter list back and the file
was gone.

Nothing surfaced it. The person who triggered it never saw the attachment, and
the owner only discovers it when they go looking.

The two properties here are opposites and a fix must satisfy both:

  1. PRESERVE — a private file the caller could not see survives their update,
     even though their payload omits it.
  2. STILL DELETE — a file the caller COULD see and deliberately omitted is a
     real deletion and must not be resurrected. A fix that re-attaches
     everything makes removing an attachment impossible.

Nothing here touches a database; the pool is conftest's MagicMock.
"""

import json

import pytest

from helpers import make_task_row

TEAM_ID = "team_001"
OWNER = "user_admin001"
VIEWER = "user_mem001"    # conftest's member_user — not the creator, not an admin

PRIVATE_KEY = "projects/team_001/salary-review.pdf"
PUBLIC_KEY = "projects/team_001/engagement-letter.pdf"

PRIVATE_ATT = {
    "name": "salary-review.pdf",
    "url": "https://r2.invalid/stale/salary-review.pdf",
    "key": PRIVATE_KEY,
    "is_private": True,
    "visible_to": [],
    "uploaded_by": OWNER,
}
PUBLIC_ATT = {
    "name": "engagement-letter.pdf",
    "url": "https://r2.invalid/stale/engagement-letter.pdf",
    "key": PUBLIC_KEY,
    "is_private": False,
    "visible_to": [],
    "uploaded_by": OWNER,
}


@pytest.fixture
def written(monkeypatch, mock_pool):
    """Capture the attachments JSON the UPDATE actually persists.

    Asserting on the response body would not prove this: the response is
    filtered for the caller, so a destroyed private file and a preserved one
    look identical from outside. The column write is the only honest witness.
    """
    import server
    import services.storage

    async def fake_sign_key(org_id, key):
        return f"https://r2.test/signed/{key}?sig=LIVE"

    monkeypatch.setattr(services.storage, "sign_key", fake_sign_key)
    server._team_org_cache.clear()
    server._team_ids_request_cache.clear()

    captured = {}
    existing = make_task_row(
        team_id=TEAM_ID,
        created_by_user_id=OWNER,
        attachments=json.dumps([PUBLIC_ATT, PRIVATE_ATT]),
    )

    async def fetchrow_side(query, *args):
        if "org_id FROM teams" in query:
            return {"org_id": "00000000-0000-0000-0000-0000000000aa"}
        if query.strip().upper().startswith("UPDATE TASKS"):
            for a in args:
                if isinstance(a, str) and a.startswith("["):
                    try:
                        parsed = json.loads(a)
                    except ValueError:
                        continue
                    if isinstance(parsed, list) and any(
                        isinstance(i, dict) and "key" in i for i in parsed
                    ):
                        captured["attachments"] = parsed
            return existing
        return existing

    async def fetch_side(query, *args):
        if "project_assignments" in query:
            return [{"team_id": TEAM_ID}]
        return []

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side

    yield captured

    server._team_org_cache.clear()
    server._team_ids_request_cache.clear()


def keys_of(atts):
    return sorted(a.get("key") for a in atts)


async def test_update_preserves_a_private_attachment_the_caller_cannot_see(
    api_client, written, as_member
):
    """Property 1. The caller sends only what they were shown; the rest must survive."""
    resp = await api_client.put(
        "/api/tasks/task_001",
        json={"title": "Renamed", "attachments": [PUBLIC_ATT]},
    )
    assert resp.status_code == 200

    assert "attachments" in written, "the UPDATE never wrote an attachments column"
    assert PRIVATE_KEY in keys_of(written["attachments"]), (
        "a private attachment was destroyed by a caller who could not see it — "
        "renaming a task deleted a colleague's file, with nothing to indicate it"
    )
    assert PUBLIC_KEY in keys_of(written["attachments"])


async def test_update_still_deletes_an_attachment_the_caller_could_see(
    api_client, written, as_member
):
    """Property 2. Preservation must not make deletion impossible."""
    resp = await api_client.put(
        "/api/tasks/task_001",
        json={"title": "Renamed", "attachments": []},
    )
    assert resp.status_code == 200

    written_keys = keys_of(written.get("attachments", []))
    assert PUBLIC_KEY not in written_keys, (
        "the caller could see this file and deliberately omitted it — that is a "
        "real deletion and must be honoured, or attachments can never be removed"
    )
    assert PRIVATE_KEY in written_keys, "the invisible one is still not theirs to delete"
