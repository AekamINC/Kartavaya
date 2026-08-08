"""Client-portal endpoint tests — the boundary an external party sits behind.

`design-handover/19-client-portal.md`:

    The failure mode is a well-meaning `GET /api/client/tasks` that returns the
    full task object and lets the component pick fields. Then one
    `{JSON.stringify(task)}` in a debug branch, or one new field rendered by a
    shared component, leaks it. **The endpoint returns a client shape, or this
    will leak eventually.**

Every assertion below is on the SHAPE — the presence of the fields the portal
needs and the ABSENCE of the ones 19's never-see list names. Asserting absence
is the point: a field reaches a client because someone wrote it into
`ClientTaskOut`, and a test that only checked the happy fields would go green
the day `TaskOut` was wired back in.

There was no coverage of these four endpoints at all before this file.
"""

import json
from datetime import datetime, timezone

import pytest

from helpers import make_task_row

pytestmark = pytest.mark.asyncio

NOW = datetime.now(timezone.utc)
CLIENT_ID = "user_client001"

# Fields that must never appear on a client payload. Each is on 19's never-see
# list, or derives from something on it.
FORBIDDEN_TASK_KEYS = {
    "assignee_user_ids", "assignee_emails", "assignee_names",
    "estimated_minutes", "custom_fields", "subtasks",
    "approved_by", "column_id", "sort_order", "user_id", "category_id",
    "priority", "tags", "status", "created_by_user_id",
    "assigned_by_user_id", "completed_by_user_id",
    "reminder_at", "reminder_sent_at", "requires_approval", "archived_at",
}

# The alias of every field on a client payload that carries a clock reading:
# ClientTaskOut's expectedAt/updatedAt/createdAt, ClientAttachmentOut.sharedAt,
# ClientDecisionOut.at.
TIMESTAMP_KEYS = {"expectedAt", "updatedAt", "createdAt", "sharedAt", "at"}


def without_timestamps(value):
    """The payload minus its datetimes, for assertions that search for a NUMBER.

    A serialised timestamp is a long run of digits, so a substring search for a
    forbidden numeric value hits one by coincidence. `estimated_minutes` is 240
    here, and any microsecond fraction like `.802240` contains "240" — about one
    run in 250, which is exactly often enough to fail a full-suite run and
    accuse the endpoint of leaking a field it never returned. Verified by
    pinning the fixture clock to 12:00:00.802240 and watching line 93 fail while
    `estimated_minutes` was demonstrably absent from the response.

    A number is only ever a leak when it sits in a data field, so drop the
    fields that can only hold a clock reading and the assertion tests the thing
    it was written to test. Do NOT relax this to a whole-blob search again.
    """
    if isinstance(value, dict):
        return {k: without_timestamps(v) for k, v in value.items()
                if k not in TIMESTAMP_KEYS}
    if isinstance(value, list):
        return [without_timestamps(v) for v in value]
    return value


def _shared_task(**overrides):
    """A task the firm has sent to this client for sign-off."""
    base = dict(
        task_id="task_aaaaaabbbbbb",
        team_id="team_001",
        title="File GSTR-3B for June",
        description="Ready for sign-off",
        status="in_review",
        approval_status="pending_client",
        approval_requested_at=NOW,
        created_by_user_id="user_staff01",
        created_by_name="Aanya Mehta",
        assignee_user_ids=["user_staff01"],
        assignee_emails=["aanya@firm.in"],
        assignee_names=["Aanya Mehta"],
        estimated_minutes=240,
        updated_at=NOW,
        created_at=NOW,
    )
    base.update(overrides)
    return make_task_row(**base)


class TestClientTasksShape:
    async def test_returns_client_shape_not_task_out(self, api_client, as_client_user, mock_pool):
        mock_pool.fetch.return_value = [_shared_task()]

        r = await api_client.get("/api/client/tasks")
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        row = body[0]

        # The shape the portal consumes — camelCase, via ClientTaskOut's aliases.
        assert row["taskId"] == "task_aaaaaabbbbbb"
        assert row["ref"] == "#bbbbbb"
        assert row["title"] == "File GSTR-3B for June"
        assert row["note"] == "Ready for sign-off"
        assert row["awaitingMe"] is True
        assert row["requestedBy"] == "Aanya Mehta"

        # Three states, not six. `in_review` must not survive the crossing.
        assert row["state"] == "with_you"
        assert "in_review" not in json.dumps(row)

        # And nothing from the firm's side of the boundary.
        assert FORBIDDEN_TASK_KEYS.isdisjoint(row.keys())
        blob = json.dumps(row)
        assert "aanya@firm.in" not in blob
        # `estimated_minutes` — time, and 19's never-see list names it.
        assert "240" not in json.dumps(without_timestamps(row))

    async def test_ref_is_never_a_sequential_integer(self, api_client, as_client_user, mock_pool):
        """19: a sequential id "tells them how many customers the firm has"."""
        mock_pool.fetch.return_value = [_shared_task()]
        row = (await api_client.get("/api/client/tasks")).json()[0]
        assert row["ref"].startswith("#")
        assert not row["ref"].lstrip("#").isdigit()

    async def test_private_attachment_never_crosses(self, api_client, as_client_user, mock_pool):
        """The private file must not even be handed a signed URL on the way out."""
        mock_pool.fetch.return_value = [_shared_task(attachments=json.dumps([
            {"name": "gstr3b.pdf", "url": "https://r2/gstr3b.pdf", "is_private": False,
             "visible_to": [], "size": 4096, "uploaded_by_name": "Aanya Mehta"},
            {"name": "internal-margin.xlsx", "url": "https://r2/margin.xlsx",
             "is_private": True, "visible_to": ["user_staff01"]},
        ]))]

        row = (await api_client.get("/api/client/tasks")).json()[0]
        names = [f["name"] for f in row["files"]]
        assert names == ["gstr3b.pdf"]
        assert "margin.xlsx" not in json.dumps(row)

        # The four fields a file row may carry, and no storage internals.
        f = row["files"][0]
        assert f["size"] == 4096
        assert f["sharedBy"] == "Aanya Mehta"
        assert "key" not in f
        assert "visible_to" not in f
        assert "is_private" not in f

    async def test_private_attachment_visible_when_named(self, api_client, as_client_user, mock_pool):
        """`visible_to` naming this client is the firm deliberately sharing it."""
        mock_pool.fetch.return_value = [_shared_task(attachments=json.dumps([
            {"name": "engagement-letter.pdf", "url": "https://r2/el.pdf",
             "is_private": True, "visible_to": [CLIENT_ID]},
        ]))]
        row = (await api_client.get("/api/client/tasks")).json()[0]
        assert [f["name"] for f in row["files"]] == ["engagement-letter.pdf"]

    async def test_decision_returned_only_for_this_client(self, api_client, as_client_user, mock_pool):
        """The written record 19 asks for — but only when THIS client decided."""
        mine = _shared_task(task_id="task_mine00000000", approval_status="approved",
                            approved_by=CLIENT_ID, approval_notes="Looks right",
                            approval_decided_at=NOW)
        theirs = _shared_task(task_id="task_theirs000000", approval_status="approved",
                              approved_by="user_staff01", approval_notes="Internal sign-off")
        mock_pool.fetch.return_value = [mine, theirs]

        body = (await api_client.get("/api/client/tasks")).json()
        by_id = {r["taskId"]: r for r in body}
        assert by_id["task_mine00000000"]["decision"]["outcome"] == "approved"
        assert by_id["task_mine00000000"]["decision"]["note"] == "Looks right"
        # Another party's approval note is the firm's record, not the client's.
        assert by_id["task_theirs000000"]["decision"] is None
        assert "Internal sign-off" not in json.dumps(body)


class TestClientApprovalsShape:
    async def test_no_staff_email_and_no_internal_vocabulary(self, api_client, as_client_user, mock_pool):
        mock_pool.fetch.return_value = [{
            "approval_id": "task_approval--task_aaaaaabbbbbb",
            "task_id": "task_aaaaaabbbbbb",
            "task_title": "File GSTR-3B for June",
            "request_data": {"title": "File GSTR-3B for June",
                             "description": "Please confirm the input credit figure."},
            "created_at": NOW,
            "requested_by_name": "Aanya Mehta",
        }]

        r = await api_client.get("/api/client/approvals")
        assert r.status_code == 200
        body = r.json()
        assert body, "both result sets are mocked to the same row; expected at least one"
        row = body[0]

        assert row["approvalId"] == "task_approval--task_aaaaaabbbbbb"
        assert row["taskId"] == "task_aaaaaabbbbbb"
        assert row["ref"] == "#bbbbbb"
        assert row["ask"] == "Please confirm the input credit figure."
        assert row["requestedBy"] == "Aanya Mehta"

        # 19's never-see list names "team member emails" explicitly; the old
        # `SELECT a.*` also shipped reviewed_by / review_notes / request_type.
        for gone in ("requested_by_email", "reviewed_by", "review_notes",
                     "request_type", "status", "approval_status", "team_id"):
            assert gone not in row


class TestClientProjectsShape:
    async def test_only_id_and_name_cross(self, api_client, as_client_user, mock_pool):
        """This endpoint used to be `SELECT t.*` serialised with `dict(r)`."""
        mock_pool.fetch.return_value = [{
            "team_id": "team_001",
            "name": "Acme Pvt Ltd",
            "created_at": NOW,
        }]

        r = await api_client.get("/api/client/projects")
        assert r.status_code == 200
        row = r.json()[0]
        assert row == {"projectId": "team_001", "name": "Acme Pvt Ltd"}


class TestClientRequestShape:
    async def test_request_returns_client_shape(self, api_client, as_client_user, mock_pool):
        """`POST /client/tasks/request` was `response_model=TaskOut`."""
        created = make_task_row(
            task_id="task_reqqqqqqqqq",
            user_id=CLIENT_ID,
            created_by_user_id=CLIENT_ID,
            created_by_name="Test Client",
            title="Need the June invoice",
            description="Please raise it against PO 4471.",
            status="requested",
            column_id="col_001",
            sort_order=3,
        )

        async def _fetchrow(query, *args):
            if "project_assignments" in query:
                return {"role": "client"}
            if "project_columns" in query:
                return {"column_id": "col_001"}
            if "MAX(sort_order)" in query:
                return {"mo": 2}
            if query.strip().startswith("SELECT name FROM teams"):
                return {"name": "Acme Pvt Ltd"}
            return created

        mock_pool.fetchrow.side_effect = _fetchrow
        # No reviewers → the notification/email fan-out loop never runs, so no
        # outbound is attempted from a test.
        mock_pool.fetch.return_value = []

        r = await api_client.post("/api/client/tasks/request", json={
            "title": "Need the June invoice",
            "description": "Please raise it against PO 4471.",
            "team_id": "team_001",
            "priority": "medium",
        })
        assert r.status_code == 200
        row = r.json()

        assert row["taskId"] == "task_reqqqqqqqqq"
        assert row["ref"] == "#qqqqqq"
        assert row["title"] == "Need the June invoice"
        assert row["state"] == "with_us"
        assert row["awaitingMe"] is False

        # The firm's board structure and triage must not come back with it.
        # (Checked on the KEYS, not on a substring of the serialised body:
        # `requestedBy` contains "requested" and is a field the portal needs.)
        assert FORBIDDEN_TASK_KEYS.isdisjoint(row.keys())
        assert "col_001" not in json.dumps(row), "the firm's column id leaked"
        assert row["state"] in ("with_us", "with_you", "done")

    async def test_non_client_cannot_use_the_client_request_endpoint(
        self, api_client, as_member, mock_pool
    ):
        r = await api_client.post("/api/client/tasks/request", json={
            "title": "x", "team_id": "team_001",
        })
        assert r.status_code == 403


class TestClientComments:
    async def test_client_sees_no_comments_before_the_migration(
        self, api_client, as_client_user, mock_pool
    ):
        """`task_comments.is_client_visible` does not exist until PROPOSED_072.

        The column is probed at runtime, so the pre-migration answer is False
        for every row and a client gets an empty list rather than the firm's
        internal discussion of their own file. Fail-closed is the whole point:
        staging and production share one database, so this code has to be
        correct on both schemas at once.
        """
        import server
        server._comment_visibility_column = None  # clear the process-wide cache

        # `client_can_access_task` must pass, then the column probe must fail.
        async def _fetchval(query, *args):
            if "information_schema.columns" in query:
                return None          # the column does not exist
            if "user_roles" in query:
                # A genuine portal client holds no staff-side role. This leg
                # exists because `is_portal_client` no longer trusts
                # `users.role` alone: two live org_admin accounts carry
                # role='client', and believing the column hid their own
                # organisation's comments from them. Answering 1 here would
                # declassify this client and hand them the internal thread
                # below — which is exactly what the assertion catches.
                return None
            return 1                 # the access check passes

        mock_pool.fetchval.side_effect = _fetchval
        # The row `client_can_access_task` reads; this client raised the task,
        # so the access check passes and we reach the column probe.
        mock_pool.fetchrow.return_value = {
            "team_id": "team_001",
            "created_by_user_id": CLIENT_ID,
            "assignee_user_ids": [],
        }
        # If the handler ever fell through to the query, it would return this.
        mock_pool.fetch.return_value = [{
            "comment_id": "c1", "task_id": "task_aaaaaabbbbbb",
            "user_id": "user_staff01", "user_name": "Aanya Mehta",
            "body": "Client is always late with documents — chase again.",
            "created_at": NOW, "is_client_visible": False,
        }]

        try:
            r = await api_client.get("/api/tasks/task_aaaaaabbbbbb/comments")
            assert r.status_code == 200
            assert r.json() == []
        finally:
            server._comment_visibility_column = None
