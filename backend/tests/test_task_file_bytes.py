"""
A task column may hold a POINTER to a file. It may never hold the file.

`services/storage.upload_file` answered with a base64 `data:` URI whenever no
bucket resolved. Every caller wrote that string into its column and every screen
reported a successful upload, so 32 MB of screen recordings and signed PDFs
accumulated in `tasks.attachments` on an 82 MB database. Removing that fallback
closes the UPLOAD path and nothing else: the task write paths here are JSON
endpoints that take an attachment list straight off a client request, so bytes
could be posted into the column by hand while R2 was perfectly healthy.

Four write paths share one model, which is why one validator closes all of them:

  POST  /api/tasks
  PUT   /api/tasks/{id}
  PATCH /api/tasks/{id}                 — an alias of the PUT handler
  POST  /api/client/tasks/request       — and this one stores the payload TWICE,
                                          in `tasks` and in `approvals.request_data`

WHAT THESE TESTS PIN, and why the obvious assertion is not enough: "a data URI
is refused" would pass against a guard that only checks the literal prefix
`data:image`. The refusals below include the evasions a browser resolves
identically — a leading space, an upper-case scheme — and the acceptances
include a text custom field that merely BEGINS with the word "data:", which is
not a data URI and must not be refused.

Nothing here touches a database; the pool is conftest's MagicMock.
"""

import json

import pytest

from helpers import make_task_row

TEAM_ID = "team_001"

GOOD = {
    "name": "engagement-letter.pdf",
    "url": "https://r2.invalid/projects/team_001/9f3.pdf?X-Amz-Signature=abc",
    "key": "projects/team_001/9f3.pdf",
}

#: The four shapes that resolve to the same fetch in a browser and must
#: therefore reach the same verdict here.
BYTES_IN_A_URL = [
    "data:application/pdf;base64,JVBERi0xLjQK",
    "DATA:image/png;base64,iVBORw0KGgo=",
    "   data:video/quicktime;base64,AAAAIGZ0eXA=",
    "data:,plain-text-payload",
]


def _wire(mock_pool, task_row, *, column=None):
    """Answer the handful of queries a task write path makes."""
    async def fetchrow_side(query, *args):
        q = query
        if "information_schema" in q:
            return None
        if "FROM project_columns" in q:
            return column
        if "FROM project_assignments" in q or "FROM team_members" in q:
            return {"role": "admin"}
        if "FROM task_clients" in q:
            return None
        if "requires_approval FROM teams" in q:
            return {"requires_approval": False}
        if "FROM teams WHERE team_id" in q:
            return {"name": "Test Project", "org_id": None}
        if "MAX(sort_order)" in q:
            return {"mo": 0}
        if "UPDATE tasks" in q or "INSERT INTO tasks" in q:
            return task_row
        if "FROM tasks" in q:
            return task_row
        return None

    mock_pool.fetchrow.side_effect = fetchrow_side

    async def fetch_side(query, *args):
        if "team_id FROM teams" in query or "project_assignments" in query:
            return [{"team_id": TEAM_ID}]
        return []

    mock_pool.fetch.side_effect = fetch_side


def _written_json(mock_pool):
    """Every JSON string this request handed to the database.

    The response body is not evidence: it is rebuilt from the row the stub
    returns, so it looks identical whether the column was written correctly or
    not. The arguments to the write are the only honest witness.
    """
    out = []
    for call in list(mock_pool.fetchrow.call_args_list) + list(mock_pool.execute.call_args_list):
        for arg in call.args:
            if isinstance(arg, str) and arg[:1] in "[{":
                try:
                    out.append(json.loads(arg))
                except ValueError:
                    pass
    return out


def _statements(mock_pool):
    calls = list(mock_pool.fetchrow.call_args_list) + list(mock_pool.execute.call_args_list)
    return [c.args[0] for c in calls if c.args and isinstance(c.args[0], str)]


# ── The four JSON write paths ────────────────────────────────────────────────

@pytest.mark.parametrize("url", BYTES_IN_A_URL)
async def test_create_refuses_a_file_carried_in_an_attachment_url(
    api_client, mock_pool, as_admin, url
):
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": "recording.mov", "url": url}],
    })
    assert resp.status_code == 422, resp.text
    assert "url" in resp.text, "the 422 must name the field that was refused"
    assert not any("INSERT INTO tasks" in s for s in _statements(mock_pool)), \
        "the row was written anyway — the refusal has to happen before the INSERT"


async def test_update_refuses_a_file_carried_in_an_attachment_url(
    api_client, mock_pool, as_admin
):
    _wire(mock_pool, make_task_row())
    resp = await api_client.put("/api/tasks/task_test001", json={
        "attachments": [GOOD, {"name": "clip.mov", "url": BYTES_IN_A_URL[0]}],
    })
    assert resp.status_code == 422, resp.text
    assert not any("UPDATE tasks" in s for s in _statements(mock_pool))


async def test_patch_refuses_it_too_because_it_is_the_same_handler(
    api_client, mock_pool, as_admin
):
    _wire(mock_pool, make_task_row())
    resp = await api_client.patch("/api/tasks/task_test001", json={
        "attachments": [{"name": "clip.mov", "url": BYTES_IN_A_URL[0]}],
    })
    assert resp.status_code == 422, resp.text


async def test_a_client_request_stores_the_payload_twice_and_neither_copy_takes_bytes(
    api_client, mock_pool, as_client_user
):
    """`approvals.request_data` is the whole `TaskCreate`, so one 8 MB recording
    used to cost 16 MB of database. Both copies come from the validated model."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/client/tasks/request", json={
        "title": "Please review", "team_id": TEAM_ID,
        "attachments": [{"name": "scan.pdf", "url": BYTES_IN_A_URL[0]}],
    })
    assert resp.status_code == 422, resp.text
    assert not any("INSERT INTO approvals" in s for s in _statements(mock_pool)), \
        "the approval row was written, which is the second copy of the same bytes"


# ── The other doors into the same jsonb write ────────────────────────────────

async def test_a_custom_field_cannot_carry_a_file_either(api_client, mock_pool, as_admin):
    """`FilesField` posts `{name, url}` into `custom_fields`, which is written to
    the same row by the same statement as `attachments`."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "custom_fields": {"Signed copy": [{"name": "deed.pdf", "url": BYTES_IN_A_URL[0]}]},
    })
    assert resp.status_code == 422, resp.text
    assert "custom_fields" in resp.text
    assert not any("INSERT INTO tasks" in s for s in _statements(mock_pool))


async def test_a_custom_field_is_checked_however_deep_the_file_is_buried(
    api_client, mock_pool, as_admin
):
    """A custom field's key is whatever the firm named it, so the guard cannot
    depend on finding one called `url`."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.put("/api/tasks/task_test001", json={
        "custom_fields": {"Evidence": {"batch": [{"attachment": BYTES_IN_A_URL[1]}]}},
    })
    assert resp.status_code == 422, resp.text


async def test_an_attachment_key_cannot_carry_a_file(api_client, mock_pool, as_admin):
    """The key is the other string on the model that lands in the same blob."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": "a.pdf", "url": GOOD["url"], "key": BYTES_IN_A_URL[0]}],
    })
    assert resp.status_code == 422, resp.text
    assert "key" in resp.text


async def test_a_url_may_not_name_a_scheme_the_product_cannot_serve(
    api_client, mock_pool, as_admin
):
    """The same field is rendered as an `<a href>` in the drawer, so the scheme
    allow-list is also what keeps `javascript:` out of it."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": "a.pdf", "url": "javascript:alert(1)"}],
    })
    assert resp.status_code == 422, resp.text


async def test_a_url_longer_than_any_pointer_is_refused(api_client, mock_pool, as_admin):
    """A presigned R2 URL is about 500 characters. 100 KB is a payload."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": "a.pdf", "url": "https://r2.invalid/x?p=" + "A" * 100_000}],
    })
    assert resp.status_code == 422, resp.text


# ── The two endpoints must agree about the same column ───────────────────────

async def test_the_json_paths_cap_attachments_where_the_upload_endpoint_does(
    api_client, mock_pool, as_admin
):
    """`POST /api/tasks/{id}/attachments` refuses the sixth file. The JSON paths
    took an unbounded list, so whichever endpoint you used decided the limit."""
    _wire(mock_pool, make_task_row())
    six = [{"name": f"{i}.pdf", "url": f"https://r2.invalid/{i}.pdf", "key": f"k/{i}"} for i in range(6)]
    resp = await api_client.post("/api/tasks", json={"title": "T", "team_id": TEAM_ID, "attachments": six})
    assert resp.status_code == 422, resp.text

    resp = await api_client.put("/api/tasks/task_test001", json={"attachments": six})
    assert resp.status_code == 422, resp.text


async def test_the_upload_endpoint_still_refuses_the_sixth_file(
    api_client, mock_pool, as_admin, monkeypatch
):
    import services.storage as storage

    async def fake_upload(**kw):
        return {"url": "https://r2.invalid/new.pdf", "key": "projects/team_001/new.pdf",
                "name": "new.pdf", "size": 4, "bucket": "b"}

    monkeypatch.setattr(storage, "upload_file", fake_upload)
    five = [{"name": f"{i}.pdf", "url": f"https://r2.invalid/{i}.pdf", "key": f"k/{i}"} for i in range(5)]
    _wire(mock_pool, make_task_row(attachments=json.dumps(five)))
    resp = await api_client.post(
        "/api/tasks/task_test001/attachments",
        files={"file": ("new.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 400, resp.text


# ── The multipart path assembles its row by hand, so it needs its own guard ──

async def test_an_upload_with_nowhere_to_go_fails_instead_of_landing_in_the_row(
    api_client, mock_pool, as_admin, monkeypatch
):
    """The fallback returned `key=""` and the bytes in the url. A file held in
    the column cannot be re-signed, which is how five executed e-sign PDFs
    became permanently unservable once their nine hours were up."""
    import services.storage as storage

    async def fallback_upload(**kw):
        return {"url": "data:application/pdf;base64,JVBERi0xLjQK", "key": "",
                "name": "new.pdf", "size": 8, "bucket": None}

    monkeypatch.setattr(storage, "upload_file", fallback_upload)
    _wire(mock_pool, make_task_row())
    resp = await api_client.post(
        "/api/tasks/task_test001/attachments",
        files={"file": ("new.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 503, resp.text
    assert not any("UPDATE tasks" in s for s in _statements(mock_pool)), \
        "the row was written with the file inside it"


async def test_a_healthy_upload_writes_the_url_and_the_key(
    api_client, mock_pool, as_admin, monkeypatch
):
    """Contract: nothing in this work changes what a working upload does. The
    key must be written or the URL cannot be re-signed after nine hours."""
    import services.storage as storage

    async def fake_upload(**kw):
        return {"url": "https://r2.invalid/projects/team_001/new.pdf?X-Amz-Signature=z",
                "key": "projects/team_001/new.pdf", "name": "new.pdf", "size": 8, "bucket": "b"}

    monkeypatch.setattr(storage, "upload_file", fake_upload)
    _wire(mock_pool, make_task_row())
    resp = await api_client.post(
        "/api/tasks/task_test001/attachments",
        files={"file": ("new.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 200, resp.text

    stored = [w for w in _written_json(mock_pool) if isinstance(w, list) and w and "url" in w[0]]
    assert stored, "the attachments column was never written"
    entry = stored[-1][-1]
    assert entry["url"].startswith("https://")
    assert entry["key"] == "projects/team_001/new.pdf"


# ── Acceptances: the guard must not refuse what the product actually stores ──

async def test_a_real_attachment_still_goes_through_unchanged(
    api_client, mock_pool, as_admin
):
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID, "attachments": [GOOD],
    })
    assert resp.status_code == 200, resp.text

    stored = [w for w in _written_json(mock_pool) if isinstance(w, list) and w and "url" in w[0]]
    assert stored, "the attachments column was never written"
    assert stored[-1][0]["url"] == GOOD["url"], "a healthy URL was altered on the way in"
    assert stored[-1][0]["key"] == GOOD["key"]


async def test_a_relative_url_still_goes_through(api_client, mock_pool, as_admin):
    """`LOCAL_STORAGE_URL` is a relative path in some dev setups, and a relative
    path carries nothing."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": "a.pdf", "url": "/local-files/personal/u1/a.pdf"}],
    })
    assert resp.status_code == 200, resp.text


async def test_a_note_that_merely_begins_with_the_word_data_is_not_a_file(
    api_client, mock_pool, as_admin
):
    """Matched by shape, not by prefix. A guard that refuses this makes the
    field unusable for the thing it is for."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "custom_fields": {"Notes": "data: 19 Aug, revised after the call"},
    })
    assert resp.status_code == 200, resp.text


async def test_a_task_written_before_the_cap_is_still_readable():
    """The five-file cap is on what a caller SENDS. Rows written while the JSON
    paths were unbounded hold more than that, and refusing to serve them would
    turn a historical write into an outage on the board."""
    import server

    seven = [{"name": f"{i}.pdf", "url": f"https://r2.invalid/{i}.pdf", "key": f"k/{i}"}
             for i in range(7)]
    out = server.row_to_task(make_task_row(attachments=json.dumps(seven)))
    assert len(out.attachments) == 7


# ── The repair route ─────────────────────────────────────────────────────────

async def test_the_data_uri_repair_route_is_gone(app):
    """It ran once, on 11 files, and the column is clean. It called `upload_file`
    with no org id, so on an org holding its own R2 credentials it re-uploaded
    the customer's file into the vendor's bucket — and it rewrote every matching
    task in the database with no org predicate anywhere on the path."""
    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/api/admin/migrate-data-uris" not in paths


# ── The filename is a field too ──────────────────────────────────────────────

@pytest.mark.parametrize("payload", BYTES_IN_A_URL)
async def test_the_name_field_cannot_carry_the_file_either(
    api_client, mock_pool, as_admin, payload
):
    """`url` and `key` were bounded and `name` was left bare, on the very model
    that exists to bound `tasks.attachments`."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": payload, "url": GOOD["url"], "key": GOOD["key"]}],
    })
    assert resp.status_code == 422, resp.text
    assert "name" in resp.text, "the 422 must name the field that was refused"
    assert not any("INSERT INTO tasks" in s for s in _statements(mock_pool))


async def test_a_client_request_stores_the_filename_twice_as_well(
    api_client, mock_pool, as_client_user
):
    """The path that doubles the cost: `approvals.request_data` is the whole
    payload and `tasks.attachments` is the same list again, so 8 MB posted as a
    filename cost 16 MB."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/client/tasks/request", json={
        "title": "Please review", "team_id": TEAM_ID,
        "attachments": [{"name": BYTES_IN_A_URL[0], "url": GOOD["url"]}],
    })
    assert resp.status_code == 422, resp.text
    assert not any("INSERT INTO approvals" in s for s in _statements(mock_pool)), \
        "the approval row was written, which is the second copy of the same bytes"


async def test_a_name_longer_than_any_filename_is_refused(api_client, mock_pool, as_admin):
    """A filename an operating system will accept is 255 characters. 100 KB in
    the field is not a name, whatever scheme it does or does not start with."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{"name": "A" * 100_000 + ".mp4", "url": GOOD["url"]}],
    })
    assert resp.status_code == 422, resp.text
    assert not any("INSERT INTO tasks" in s for s in _statements(mock_pool))


@pytest.mark.parametrize("field,value", [
    ("uploaded_by", BYTES_IN_A_URL[0]),
    ("uploaded_by_name", BYTES_IN_A_URL[0]),
    ("visible_to", [BYTES_IN_A_URL[0]]),
])
async def test_every_other_label_on_the_model_is_bounded_by_default(
    api_client, mock_pool, as_admin, field, value
):
    """`name` was not the only bare one. These four paths take the whole
    attachment dict off the request, so the uploader fields and the visibility
    list are client-supplied too, and all of them land in the same jsonb blob."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{**GOOD, field: value}],
    })
    assert resp.status_code == 422, resp.text
    assert not any("INSERT INTO tasks" in s for s in _statements(mock_pool))


async def test_a_filename_that_merely_mentions_data_still_goes_through(
    api_client, mock_pool, as_admin
):
    """The same shape rule as the url. A name is the field a firm types into,
    and refusing an ordinary one makes it unusable for what it is for."""
    _wire(mock_pool, make_task_row())
    resp = await api_client.post("/api/tasks", json={
        "title": "T", "team_id": TEAM_ID,
        "attachments": [{**GOOD, "name": "data: 19 Aug, revised return.pdf"}],
    })
    assert resp.status_code == 200, resp.text
    stored = [w for w in _written_json(mock_pool) if isinstance(w, list) and w and "url" in w[0]]
    assert stored[-1][0]["name"] == "data: 19 Aug, revised return.pdf", \
        "a healthy filename was altered on the way in"


# ── The cap is a ratchet, not a wall ─────────────────────────────────────────

async def test_a_task_already_over_the_cap_can_still_be_edited_and_shrunk(
    api_client, mock_pool, as_admin
):
    """Rows written while the JSON paths were unbounded hold more than five
    files, and TaskDrawer re-sends the WHOLE list on every save. A flat cap on
    the update path therefore 422s the title edit, the priority edit AND the
    attempt to remove a file — the row is stuck above the limit with no way
    down and nothing said about why.
    """
    eight = [{"name": f"{i}.pdf", "url": f"https://r2.invalid/{i}.pdf", "key": f"k/{i}"}
             for i in range(8)]
    _wire(mock_pool, make_task_row(attachments=json.dumps(eight)))

    resp = await api_client.put("/api/tasks/task_test001", json={"attachments": eight[:7]})
    assert resp.status_code == 200, resp.text
    stored = [w for w in _written_json(mock_pool) if isinstance(w, list) and w and "url" in w[0]]
    assert stored and len(stored[-1]) == 7, "the shrink was not written"


async def test_growing_a_task_past_the_cap_is_still_refused(api_client, mock_pool, as_admin):
    """What the ratchet must NOT do is let the column keep growing."""
    eight = [{"name": f"{i}.pdf", "url": f"https://r2.invalid/{i}.pdf", "key": f"k/{i}"}
             for i in range(8)]
    nine = eight + [{"name": "9.pdf", "url": "https://r2.invalid/9.pdf", "key": "k/9"}]
    _wire(mock_pool, make_task_row(attachments=json.dumps(eight)))

    resp = await api_client.put("/api/tasks/task_test001", json={"attachments": nine})
    assert resp.status_code == 422, resp.text
    assert "attachments" in resp.text
    assert not any("UPDATE tasks" in s for s in _statements(mock_pool))


async def test_the_sixth_file_is_refused_before_it_reaches_r2(
    api_client, mock_pool, as_admin, monkeypatch
):
    """The count was checked AFTER the upload, so the refused file was read into
    the worker, stored in the bucket, and then dropped — leaving an object no
    row ever pointed at."""
    import services.storage as storage

    calls = []

    async def fake_upload(**kw):
        calls.append(kw)
        return {"url": "https://r2.invalid/new.pdf", "key": "projects/team_001/new.pdf",
                "name": "new.pdf", "size": 4, "bucket": "b"}

    monkeypatch.setattr(storage, "upload_file", fake_upload)
    five = [{"name": f"{i}.pdf", "url": f"https://r2.invalid/{i}.pdf", "key": f"k/{i}"}
            for i in range(5)]
    _wire(mock_pool, make_task_row(attachments=json.dumps(five)))
    resp = await api_client.post(
        "/api/tasks/task_test001/attachments",
        files={"file": ("new.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 400, resp.text
    assert not calls, "the refused file was uploaded to R2 anyway and orphaned there"
