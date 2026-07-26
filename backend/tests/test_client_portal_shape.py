"""
The client portal returns a CLIENT SHAPE, never an internal model.

`19-client-portal.md`: "The failure mode is a well-meaning
`GET /api/client/tasks` that returns the full task object and lets the component
pick fields. [...] The endpoint returns a client shape, or this will leak
eventually."

These are regression tests, and they are written negatively on purpose. Asserting
that the four fields named in the original finding are absent would pass again the
moment a fifth is added upstream, so the tasks test asserts the WHOLE key set
instead: the response may contain these keys and no others. A new field on
`TaskOut` then fails this test rather than reaching an external party silently.

The fixes are in `server.py` (`ClientTaskOut` / `ClientApprovalOut`, the
allow-list models). These tests hold them in place.
"""

import pytest

from helpers import make_task_row


@pytest.fixture(autouse=True)
def _no_org_lookup(mock_pool):
    """`_refresh_task_attachments` resolves an org from the team to re-sign R2
    URLs. Returning no org short-circuits it, so nothing reaches storage."""
    import server
    mock_pool.fetchrow.return_value = None
    server._team_org_cache.clear()
    yield
    server._team_org_cache.clear()


CLIENT_UID = "user_client001"

#: Every key `ClientTaskOut` is allowed to serialise, by wire name.
_ALLOWED_TASK_KEYS = {
    "taskId", "ref", "title", "note", "state", "expectedAt", "updatedAt",
    "createdAt", "requestedBy", "projectId", "files", "decision", "awaitingMe",
}

#: Every key `ClientApprovalOut` is allowed to serialise.
_ALLOWED_APPROVAL_KEYS = {
    "approvalId", "taskId", "ref", "title", "ask", "requestedBy", "requestedAt",
}

#: Named in the finding, and each is separately a reason the shape exists.
_FORBIDDEN_TASK_KEYS = [
    "assignee_emails", "assigneeEmails",     # other people's email addresses
    "estimated_minutes", "estimatedMinutes",  # the firm's time, and its margin
    "custom_fields", "customFields",          # the firm's internal decomposition
    "subtasks",
    "assignee_user_ids", "assignee_names",
    "created_by_user_id", "approved_by", "priority", "tags", "status",
]


# ── /api/client/tasks ─────────────────────────────────────────────────────────

async def test_client_tasks_returns_only_the_client_shape(
    api_client, mock_pool, as_client_user,
):
    """The whole key set, not a list of four exclusions."""
    mock_pool.fetch.return_value = [make_task_row(
        task_id="task_c1",
        created_by_user_id="user_staff_internal",
        assignee_emails=["partner@firm.example", "junior@firm.example"],
        estimated_minutes=480,
        custom_fields='{"internal_rate_band": "B2"}',
        subtasks='[{"subtask_id": "sub_1", "title": "Reconcile ledger", "is_done": false, "order": 0}]',
    )]

    resp = await api_client.get("/api/client/tasks")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1

    assert set(body[0]) == _ALLOWED_TASK_KEYS, (
        "A field reaches the client because it is written out in ClientTaskOut, "
        "never because it was added to TaskOut."
    )


@pytest.mark.parametrize("forbidden", _FORBIDDEN_TASK_KEYS)
async def test_client_tasks_never_carries_an_internal_field(
    api_client, mock_pool, as_client_user, forbidden,
):
    """Stated field by field as well, so a failure names the field that leaked
    rather than only reporting that a set comparison differed."""
    mock_pool.fetch.return_value = [make_task_row(
        task_id="task_c1",
        created_by_user_id="user_staff_internal",
        assignee_emails=["partner@firm.example"],
        estimated_minutes=480,
        custom_fields='{"internal_rate_band": "B2"}',
    )]

    resp = await api_client.get("/api/client/tasks")
    assert resp.status_code == 200
    assert forbidden not in resp.json()[0]


async def test_client_tasks_strips_a_private_attachment(
    api_client, mock_pool, as_client_user,
):
    """`_filter_private_attachments` was never applied here — uniquely among the
    task reads — so files a firm had marked private went to the client WITH LIVE
    SIGNED R2 URLS.

    The caller is not the creator and is not in `visible_to`, so the private
    file must not appear at all. The public one must still come through, or this
    test would pass on an endpoint that returned nothing."""
    mock_pool.fetch.return_value = [make_task_row(
        task_id="task_c1",
        created_by_user_id="user_staff_internal",
        attachments=(
            '[{"name": "engagement-letter.pdf", "url": "https://r2.example/public",'
            '  "is_private": false},'
            ' {"name": "internal-risk-memo.pdf", "url": "https://r2.example/private",'
            '  "is_private": true, "visible_to": ["user_staff_internal"]}]'
        ),
    )]

    resp = await api_client.get("/api/client/tasks")
    assert resp.status_code == 200
    files = resp.json()[0]["files"]

    names = [f["name"] for f in files]
    assert names == ["engagement-letter.pdf"]
    urls = " ".join(f["url"] for f in files)
    assert "private" not in urls


async def test_client_tasks_private_attachment_reaches_its_own_creator(
    api_client, mock_pool, as_client_user,
):
    """The contrast. Filtering is by caller, not a blanket drop — otherwise the
    test above would pass on an endpoint that returned no files ever."""
    mock_pool.fetch.return_value = [make_task_row(
        task_id="task_c1",
        created_by_user_id=CLIENT_UID,
        attachments=(
            '[{"name": "my-own-upload.pdf", "url": "https://r2.example/mine",'
            '  "is_private": true, "visible_to": []}]'
        ),
    )]

    resp = await api_client.get("/api/client/tasks")
    assert [f["name"] for f in resp.json()[0]["files"]] == ["my-own-upload.pdf"]


async def test_client_attachment_carries_no_storage_or_identity_internals(
    api_client, mock_pool, as_client_user,
):
    """`key` is R2 storage internals, `visible_to` is a list of OTHER people's
    user ids, `is_private` is the firm's classification of its own documents,
    and `uploaded_by` is an internal user id — the NAME crosses, the identifier
    does not."""
    mock_pool.fetch.return_value = [make_task_row(
        task_id="task_c1",
        created_by_user_id=CLIENT_UID,
        attachments=(
            '[{"name": "statement.pdf", "url": "https://r2.example/f",'
            '  "key": "org/abc/statement.pdf", "is_private": false,'
            '  "visible_to": ["user_staff_a", "user_staff_b"],'
            '  "uploaded_by": "user_staff_a", "uploaded_by_name": "A Partner"}]'
        ),
    )]

    resp = await api_client.get("/api/client/tasks")
    file_row = resp.json()[0]["files"][0]

    assert set(file_row) == {"name", "url", "size", "sharedBy", "sharedAt"}
    # The name is the point: "who shared it" without an identifier or an email.
    assert file_row["sharedBy"] == "A Partner"
    for internal in ("key", "visible_to", "is_private", "uploaded_by"):
        assert internal not in file_row


# ── /api/client/approvals ─────────────────────────────────────────────────────

def _approval_row(**overrides):
    from datetime import datetime, timezone
    base = {
        "approval_id": "appr_001",
        "task_id": "task_c1",
        "task_title": "Sign off Q2 filing",
        "request_data": '{"title": "Sign off Q2 filing", "description": "Please confirm."}',
        "created_at": datetime.now(timezone.utc),
        "requested_by_name": "A Partner",
    }
    base.update(overrides)
    return base


async def test_client_approvals_returns_only_the_client_shape(
    api_client, mock_pool, as_client_user,
):
    """Every row used to carry `requested_by_email`, a staff email address.
    `19`'s never-see list names exactly that: "team member emails and phone
    numbers beyond the single named contact"."""
    mock_pool.fetch.return_value = [_approval_row()]

    resp = await api_client.get("/api/client/approvals")
    assert resp.status_code == 200
    body = resp.json()
    assert body, "expected at least one approval"

    for row in body:
        assert set(row) == _ALLOWED_APPROVAL_KEYS


@pytest.mark.parametrize("forbidden", [
    "requested_by_email", "requestedByEmail",
    "reviewed_by", "reviewedBy", "review_notes", "reviewNotes",
    "request_type", "requestType", "status",
])
async def test_client_approvals_never_carries_the_internal_review_trail(
    api_client, mock_pool, as_client_user, forbidden,
):
    """The old `SELECT a.*` shipped `reviewed_by`, `review_notes`,
    `request_type` and the raw `status` alongside the staff email."""
    mock_pool.fetch.return_value = [_approval_row(
        requested_by_email="partner@firm.example",
        reviewed_by="user_staff_reviewer",
        review_notes="Client is slow to respond, chase Friday.",
        request_type="internal_signoff",
        status="pending",
    )]

    resp = await api_client.get("/api/client/approvals")
    assert resp.status_code == 200
    for row in resp.json():
        assert forbidden not in row


async def test_client_approvals_never_serialises_a_staff_email_anywhere(
    api_client, mock_pool, as_client_user,
):
    """Key-by-key absence is not quite enough — an email could ride inside a
    value. The whole payload is checked as text."""
    mock_pool.fetch.return_value = [_approval_row(
        requested_by_email="partner@firm.example",
        review_notes="escalate to senior@firm.example",
    )]

    resp = await api_client.get("/api/client/approvals")
    assert "@firm.example" not in resp.text
