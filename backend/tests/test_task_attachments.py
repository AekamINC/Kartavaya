"""
Private task attachments must never be handed a live signed R2 URL.

`_refresh_task_attachments` re-signs every attachment it is given against the
org's live R2 credentials — `services.storage.sign_key` mints a presigned URL
with `ExpiresIn=32400`, i.e. a working nine-hour download link. So an
attachment that reaches it unfiltered leaves the endpoint with a URL that
works, and stripping the field afterwards does not un-mint it.

Two separate properties are asserted throughout, because a fix can satisfy one
and miss the other:

  1. CONTENT — a private attachment the caller may not see is absent from the
     response body.
  2. ORDERING — `sign_key` was never CALLED for that attachment's key.

`GET /api/tasks` failed (1) and therefore (2): it was the one task read that
applied no filter at all, so a file its uploader had marked private went to
every member of every visible team with a fresh signed URL.

`GET /api/tasks/{id}` passed (1) and failed (2): it filtered, but only after
`_fetch_enriched_task` had already re-signed everything, so the URL existed —
it was simply dropped from the serialised body a moment later.

`PUT /api/tasks/{id}` and `PATCH /api/tasks/{id}/move` failed both: they
returned `_fetch_enriched_task`'s result with no filter anywhere.

Nothing here touches a database. The pool is the shared MagicMock from
conftest and `sign_key` is replaced with a spy.
"""

import json

import pytest

from helpers import make_task_row

# ── The fixture data ─────────────────────────────────────────────────────────

ORG_ID = "00000000-0000-0000-0000-0000000000aa"
TEAM_ID = "team_001"
OWNER = "user_admin001"   # uploaded the private file and created the task
VIEWER = "user_mem001"    # conftest's member_user — not creator, not an admin
NAMED = "user_named001"   # on the private file's visible_to list

PRIVATE_KEY = "projects/team_001/salary-review.pdf"
PUBLIC_KEY = "projects/team_001/engagement-letter.pdf"

PRIVATE_ATT = {
    "name": "salary-review.pdf",
    "url": "https://r2.invalid/stale/salary-review.pdf",
    "key": PRIVATE_KEY,
    "is_private": True,
    "visible_to": [NAMED],
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


def task_row(created_by=OWNER, **overrides):
    return make_task_row(
        team_id=TEAM_ID,
        created_by_user_id=created_by,
        attachments=json.dumps([PUBLIC_ATT, PRIVATE_ATT]),
        **overrides,
    )


# ── Harness ──────────────────────────────────────────────────────────────────

@pytest.fixture
def signed(monkeypatch, mock_pool):
    """Spy on every R2 signing call, and wire the pool for the task reads.

    Returns the list of keys `sign_key` was asked to sign. A key in this list
    had a working nine-hour URL minted for it, whether or not that URL survived
    into the response body.
    """
    import server
    import services.storage

    keys = []

    async def fake_sign_key(org_id, key):
        keys.append(key)
        return f"https://r2.test/signed/{key}?sig=LIVE"

    monkeypatch.setattr(services.storage, "sign_key", fake_sign_key)

    # `_resolve_org_id` memoises team → org for the process lifetime, so a stale
    # entry from another test would skip the lookup and return None, which makes
    # `_refresh_task_attachments` a no-op and the ordering assertions vacuous.
    server._team_org_cache.clear()
    server._team_ids_request_cache.clear()

    yield keys

    server._team_org_cache.clear()
    server._team_ids_request_cache.clear()


def wire(mock_pool, rows, task_row_for_get=None):
    """Answer every query these endpoints issue, keyed on a distinctive fragment."""

    async def fetch_side(query, *args):
        if "project_assignments" in query:      # get_visible_team_ids, non-admin
            return [{"team_id": TEAM_ID}]
        if "task_reminders" in query:           # _fetch_task_reminders
            return []
        return rows                             # the tasks list itself

    async def fetchrow_side(query, *args):
        if "org_id FROM teams" in query:        # _resolve_org_id
            return {"org_id": ORG_ID}
        return task_row_for_get

    mock_pool.fetch.side_effect = fetch_side
    mock_pool.fetchrow.side_effect = fetchrow_side


def names(attachments):
    return sorted(a["name"] for a in attachments)


# ── GET /api/tasks — the org-wide read ───────────────────────────────────────

async def test_list_tasks_strips_a_private_attachment_from_a_non_creator(
    api_client, mock_pool, as_member, signed
):
    """Property 1. Pre-fix this returned BOTH files."""
    wire(mock_pool, [task_row()])

    resp = await api_client.get("/api/tasks")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert names(body[0]["attachments"]) == ["engagement-letter.pdf"]


async def test_list_tasks_never_signs_a_private_key_for_a_non_creator(
    api_client, mock_pool, as_member, signed
):
    """Property 2 — the ordering. Filtering after re-signing would still fail."""
    wire(mock_pool, [task_row()])

    await api_client.get("/api/tasks")

    assert PUBLIC_KEY in signed, "the public file should still be re-signed"
    assert PRIVATE_KEY not in signed, (
        "a private attachment the caller may not see was handed a live signed "
        "R2 URL — the filter must run BEFORE _refresh_task_attachments"
    )


async def test_list_tasks_keeps_a_private_attachment_for_its_creator(
    api_client, mock_pool, as_member, signed
):
    """The filter must not be over-broad: the uploader still sees their own file."""
    wire(mock_pool, [task_row(created_by=VIEWER)])

    resp = await api_client.get("/api/tasks")

    assert names(resp.json()[0]["attachments"]) == [
        "engagement-letter.pdf", "salary-review.pdf",
    ]
    assert PRIVATE_KEY in signed


async def test_list_tasks_keeps_a_private_attachment_for_a_named_viewer(
    api_client, mock_pool, as_member, signed, app
):
    """`visible_to` is an explicit allow-list and still grants access."""
    from auth_router import require_user

    app.dependency_overrides[require_user] = lambda: {
        "user_id": NAMED, "email": "named@test.com", "name": "Named",
        "full_name": "Named", "role": "member",
    }
    try:
        wire(mock_pool, [task_row()])
        resp = await api_client.get("/api/tasks")
        assert names(resp.json()[0]["attachments"]) == [
            "engagement-letter.pdf", "salary-review.pdf",
        ]
    finally:
        app.dependency_overrides.pop(require_user, None)


def _role_lookups(mock_pool):
    """`staging.user_roles` reads — the cost of resolving `is_org_admin`.

    NOT every `staging.user_roles` read: `get_visible_team_ids` also asks that
    table WHICH ORG this request is scoped to (`server._home_org_id`), and that
    is a different question with a different cost profile — one per request, by
    construction, whatever the rows contain. Counting it here would make these
    two tests fail whenever the tenancy resolution changes, which is not what
    either of them is about. They are about the PRIVATE-ATTACHMENT branch not
    resolving the admin role once per row.
    """
    return [
        c for c in mock_pool.fetchval.await_args_list
        if "public.user_roles" in str(c.args[0])
        and "role_code IN ('org_owner','org_admin','org_member')" not in str(c.args[0])
    ]


async def test_list_tasks_resolves_the_admin_role_at_most_once_per_request(
    api_client, mock_pool, as_member, signed
):
    """The filter must not cost a `staging.user_roles` round trip per row.

    `list_tasks` already spends exactly one on `get_visible_team_ids`, which
    calls `is_org_admin` before it does anything else. The private-attachment
    branch is allowed to add at most ONE more, however many rows carry a private
    file — `_admin` is resolved lazily and then reused. Four rows here, so a
    per-row implementation would show five.
    """
    wire(mock_pool, [task_row(), task_row(), task_row(), task_row()])

    await api_client.get("/api/tasks")

    assert len(_role_lookups(mock_pool)) == 2


async def test_list_tasks_with_no_private_attachment_adds_no_admin_lookup(
    api_client, mock_pool, as_member, signed
):
    """The common case pays nothing at all: the guard is `any(a.is_private ...)`.

    One lookup, and it belongs to `get_visible_team_ids` — the filter branch is
    never entered.
    """
    wire(mock_pool, [make_task_row(team_id=TEAM_ID, attachments=json.dumps([PUBLIC_ATT]))])

    await api_client.get("/api/tasks")

    assert len(_role_lookups(mock_pool)) == 1


# ── GET /api/tasks/{id} — filtered before, but in the wrong order ────────────

async def test_get_task_never_signs_a_private_key(
    api_client, mock_pool, as_member, signed
):
    """The ordering fix, isolated.

    Pre-fix `get_task` DID strip the attachment from the body — and did it after
    `_fetch_enriched_task` had already minted the URL. Only this assertion moves.
    """
    row = task_row()
    wire(mock_pool, [row], task_row_for_get=row)

    resp = await api_client.get("/api/tasks/task_test001")

    assert resp.status_code == 200
    assert names(resp.json()["attachments"]) == ["engagement-letter.pdf"]
    assert PRIVATE_KEY not in signed, (
        "_fetch_enriched_task re-signed a private attachment before the filter ran"
    )


# ── The shared helper, direct ────────────────────────────────────────────────

async def test_fetch_enriched_task_filters_for_the_viewer_it_is_given(
    mock_pool, inject_pool, signed
):
    """This is what PUT /tasks/{id} and PATCH /tasks/{id}/move now rely on.

    Both returned `_fetch_enriched_task` with no filter at any layer before the
    fix, so both were full leaks. Exercised here rather than through the two
    endpoints because their write paths pull in automations, notifications and
    column lookups that say nothing about attachment visibility.
    """
    import server

    row = task_row()
    wire(mock_pool, [row], task_row_for_get=row)

    out = await server._fetch_enriched_task(
        mock_pool, "task_test001", viewer_id=VIEWER, viewer_is_admin=False
    )

    assert [a.name for a in out.attachments] == ["engagement-letter.pdf"]
    assert PRIVATE_KEY not in signed


async def test_fetch_enriched_task_without_a_viewer_is_deliberately_unfiltered(
    mock_pool, inject_pool, signed
):
    """`viewer_id=None` is the internal form and must stay unfiltered.

    Pinned so nobody "fixes" it into a silent filter: an internal caller that
    needs the whole row would then get a truncated one with no error.
    """
    import server

    row = task_row()
    wire(mock_pool, [row], task_row_for_get=row)

    out = await server._fetch_enriched_task(mock_pool, "task_test001")

    assert sorted(a.name for a in out.attachments) == [
        "engagement-letter.pdf", "salary-review.pdf",
    ]


# ── The regression guard ─────────────────────────────────────────────────────

def test_every_fetch_enriched_task_caller_passes_a_viewer():
    """`viewer_id` is opt-in, and that is the whole shape of the original bug.

    Three of the four call sites returned the result straight to an HTTP client
    without one. A new endpoint copying the two-argument form would reopen the
    leak silently, so the call sites are asserted rather than trusted.
    """
    import inspect
    import re

    import server

    source = inspect.getsource(server)
    calls = re.findall(r"_fetch_enriched_task\((?!pool, task_id: str)[^)]*\)", source)
    calls = [c for c in calls if not c.startswith("_fetch_enriched_task(pool, task_id,\n")]

    missing = [c for c in calls if "viewer_id" not in c]
    assert not missing, (
        "these _fetch_enriched_task call sites do not pass viewer_id, so private "
        f"attachments are re-signed and returned unfiltered: {missing}"
    )
