"""
A task attachment belongs in its ORG's bucket, and must stay readable forever.

`POST /api/tasks/{id}/attachments` resolved the active org as a dependency, used
it for the access check, and then called `upload_file` without it. `_resolve_r2`
never looks at an org's own credentials when it is handed none, so a customer
holding its own Cloudflare account had every task file written into the VENDOR's
bucket under `shared/` — counted against nobody's quota, and refused outright
whenever the four platform variables happened to be unset even though the org's
own bucket was answering. Reads still worked, which is what kept it invisible:
`sign_key` routes by the key's prefix, so a `shared/` key opens either way.

The other half is the read. `_refresh_task_attachments` returned early whenever
the task had no org, and a personal task has no team at all while two of the
twenty-nine teams carry no `teams.org_id`. Those attachments live in the
platform bucket under `shared/`, which needs no org to address — but nothing
ever tried, so the board kept serving the presigned URL captured at upload. It
is dead nine hours later and it stays dead. That is the same mechanism that made
five executed e-sign PDFs permanently unservable.

WHAT THESE TESTS PIN, and why the response body is not evidence: the body looks
identical whether the file went to the right bucket or the wrong one. The
argument handed to `upload_file` is the only honest witness, and for the read it
is the argument handed to `sign_key`.

Nothing here touches a database; the pool is conftest's MagicMock.
"""

import json

import pytest

from helpers import make_task_row

TEAM_ID = "team_001"
ORG_ID = "00000000-0000-0000-0000-0000000000aa"

PDF = {"file": ("engagement-letter.pdf", b"%PDF-1.4 body", "application/pdf")}


def _wire(mock_pool, task_row, *, org_id=ORG_ID):
    """Answer every query `add_task_attachment` makes, with a chosen team org."""

    async def fetchrow_side(query, *args):
        if "org_id FROM teams" in query:            # _resolve_org_id
            return {"org_id": org_id}
        if "FROM project_assignments" in query or "FROM team_members" in query:
            return {"role": "admin"}
        if "FROM task_clients" in query:
            return None
        return task_row

    async def fetch_side(query, *args):
        if "project_assignments" in query:
            return [{"team_id": TEAM_ID}]
        return []

    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side


@pytest.fixture
def r2(monkeypatch):
    """Record every argument the storage layer is handed, and answer healthily.

    A healthy answer throughout: nothing in this work may change what a working
    upload does, so a test that only ever exercises a failing R2 would not
    notice if it had.
    """
    import services.storage as storage

    seen = {"upload": [], "checked": [], "counted": []}

    async def fake_upload(**kw):
        seen["upload"].append(kw)
        return {
            "url": "https://r2.invalid/projects/team_001/new.pdf?X-Amz-Signature=z",
            "key": "projects/team_001/new.pdf",
            "name": "engagement-letter.pdf",
            "size": len(kw["file_bytes"]),
            "bucket": "the-orgs-own-bucket",
        }

    async def fake_check(org_id, size):
        seen["checked"].append((org_id, size))
        return True

    async def fake_update(org_id, delta):
        seen["counted"].append((org_id, delta))

    monkeypatch.setattr(storage, "upload_file", fake_upload)
    monkeypatch.setattr(storage, "check_storage_limit", fake_check)
    monkeypatch.setattr(storage, "update_org_storage", fake_update)
    return seen


# ── The upload ───────────────────────────────────────────────────────────────

async def test_the_file_goes_to_the_orgs_own_bucket(api_client, mock_pool, as_admin, r2):
    """The org id was resolved for the access check and then dropped on the
    floor one line before the upload."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks/task_test001/attachments", files=PDF)
    assert resp.status_code == 200, resp.text

    assert r2["upload"], "upload_file was never called"
    assert r2["upload"][-1].get("org_id") == ORG_ID, (
        "the customer's file was uploaded with no org, which puts it in the "
        "vendor's bucket under `shared/` and outside the org's quota"
    )


async def test_the_org_is_the_tasks_own_and_not_the_callers_active_one(
    api_client, mock_pool, as_admin, r2
):
    """It has to be the same answer `_refresh_task_attachments` reaches on every
    later read, because that is what decides which bucket the key is signed
    against. Resolve it from the caller instead and the file uploads to one
    account and is re-signed against another."""
    import server

    other_org = "00000000-0000-0000-0000-0000000000bb"
    _wire(mock_pool, make_task_row(), org_id=other_org)
    resp = await api_client.post("/api/tasks/task_test001/attachments", files=PDF)
    assert resp.status_code == 200, resp.text
    assert r2["upload"][-1]["org_id"] == other_org
    assert await server._resolve_org_id(mock_pool, TEAM_ID) == other_org, \
        "the upload and the re-sign must resolve the same org for the same team"


async def test_the_bytes_are_counted_against_the_orgs_quota(
    api_client, mock_pool, as_admin, r2
):
    """Neither `check_storage_limit` nor `update_org_storage` was called on this
    path at all, which made it an uncounted door past the limit
    `routers/uploads.py` enforces on the same file."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks/task_test001/attachments", files=PDF)
    assert resp.status_code == 200, resp.text

    size = len(PDF["file"][1])
    assert r2["checked"] == [(ORG_ID, size)], "the quota was never consulted"
    assert r2["counted"] == [(ORG_ID, size)], "the stored bytes were never counted"


async def test_a_full_org_is_refused_before_anything_is_stored(
    api_client, mock_pool, as_admin, r2, monkeypatch
):
    import services.storage as storage

    async def full(org_id, size):
        r2["checked"].append((org_id, size))
        return False

    monkeypatch.setattr(storage, "check_storage_limit", full)
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks/task_test001/attachments", files=PDF)
    assert resp.status_code == 413, resp.text
    assert not r2["upload"], "the file was uploaded despite the org being full"
    assert not r2["counted"]


async def test_a_personal_task_has_no_org_and_that_is_not_an_error(
    api_client, mock_pool, as_admin, r2
):
    """A task with no team resolves no org, and the platform bucket is the right
    place for it. The quota belongs to an org, so there is nothing to count."""
    _wire(mock_pool, make_task_row(team_id=None), org_id=None)
    resp = await api_client.post("/api/tasks/task_test001/attachments", files=PDF)
    assert resp.status_code == 200, resp.text
    assert r2["upload"][-1]["org_id"] is None
    assert r2["checked"] == [] and r2["counted"] == []


async def test_a_healthy_upload_still_writes_the_url_and_the_key(
    api_client, mock_pool, as_admin, r2
):
    """Contract: nothing here changes what a working upload does."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks/task_test001/attachments", files=PDF)
    assert resp.status_code == 200, resp.text

    written = None
    for call in mock_pool.fetchrow.call_args_list:
        for arg in call.args:
            if isinstance(arg, str) and arg.startswith("["):
                try:
                    parsed = json.loads(arg)
                except ValueError:
                    continue
                if parsed and isinstance(parsed[0], dict) and "key" in parsed[0]:
                    written = parsed
    assert written, "the attachments column was never written"
    assert written[-1]["url"].startswith("https://")
    assert written[-1]["key"] == "projects/team_001/new.pdf"
    assert written[-1]["size"] == len(PDF["file"][1])


# ── The read, nine hours later ───────────────────────────────────────────────

@pytest.fixture
def signed(monkeypatch):
    """Every (org_id, key) pair `sign_key` was asked for."""
    import services.storage as storage

    seen = []

    async def fake_sign_key(org_id, key):
        seen.append((org_id, key))
        return f"https://r2.test/signed/{key}?sig=LIVE"

    monkeypatch.setattr(storage, "sign_key", fake_sign_key)
    return seen


def _task_with(key, *, team_id=TEAM_ID):
    import server

    return server.row_to_task(make_task_row(team_id=team_id, attachments=json.dumps([{
        "name": "clip.mov",
        "url": "https://r2.invalid/stale/clip.mov?X-Amz-Expires=32400",
        "key": key,
    }])))


async def test_a_platform_key_is_re_signed_even_when_the_task_has_no_org(
    mock_pool, signed
):
    """A personal task has no team, so it resolves no org — and its file is in
    the platform bucket under `shared/`, which the key names outright. The early
    return meant the board served the URL captured at upload, dead the next
    morning and dead permanently."""
    import server

    task = await server._refresh_task_attachments(
        mock_pool, _task_with("shared/personal/user_admin001/9f3.mov", team_id=None)
    )
    assert signed == [(None, "shared/personal/user_admin001/9f3.mov")], \
        "nothing was re-signed, so the stored nine-hour URL is all the board has"
    assert task.attachments[0].url.startswith("https://r2.test/signed/")


async def test_a_team_with_no_org_row_is_the_same_case(mock_pool, signed):
    """Two of the twenty-nine teams carry no `teams.org_id`. Their project files
    are `shared/projects/{team}/…` in the same bucket."""
    import server

    async def fetchrow_side(query, *args):
        if "org_id FROM teams" in query:
            return {"org_id": None}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    await server._refresh_task_attachments(mock_pool, _task_with("shared/projects/team_001/9f3.mov"))
    assert signed == [(None, "shared/projects/team_001/9f3.mov")]


async def test_an_org_bucket_key_with_no_org_is_left_alone(mock_pool, signed):
    """The key decides. A key with no platform prefix names the org's own
    bucket, and without an org there is nothing to address it with — so the
    stored URL is served rather than a signing call that cannot succeed."""
    import server

    task = await server._refresh_task_attachments(
        mock_pool, _task_with("projects/team_001/9f3.mov", team_id=None)
    )
    assert signed == []
    assert task.attachments[0].url.startswith("https://r2.invalid/stale/")


async def test_an_org_task_is_re_signed_exactly_as_before(mock_pool, signed):
    """The path that already worked must not have moved."""
    import server

    async def fetchrow_side(query, *args):
        if "org_id FROM teams" in query:
            return {"org_id": ORG_ID}
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side
    task = await server._refresh_task_attachments(mock_pool, _task_with("projects/team_001/9f3.mov"))
    assert signed == [(ORG_ID, "projects/team_001/9f3.mov")]
    assert task.attachments[0].url.startswith("https://r2.test/signed/")
