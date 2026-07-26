"""
Security tests for the Sanvaad (Samvada) messaging router.
Validates auth requirements, org-scoping, and role-based access control.
"""
import pytest
from unittest.mock import AsyncMock

from conftest import TEST_ORG_ID

OTHER_ORG_ID = "00000000-0000-0000-0000-000000000099"
CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
MESSAGE_ID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Skip the require_module('samvada') subscription check for all tests."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── Auth required ──────────────────────────────────────────────


@pytest.mark.anyio
async def test_list_channels_requires_auth(api_client):
    """GET /channels without a token must be rejected."""
    r = await api_client.get("/api/v1/messaging/channels")
    assert r.status_code in (401, 403)


@pytest.mark.anyio
async def test_send_message_requires_auth(api_client):
    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "hello"},
    )
    assert r.status_code in (401, 403)


# ── Org-scoped channel access ─────────────────────────────────


@pytest.mark.anyio
async def test_list_channels_scoped_to_org(api_client, as_admin, with_org_id, mock_pool):
    """Channels query must filter by org_id."""
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/messaging/channels")
    assert r.status_code == 200

    # The SQL must have received the org_id
    call_args = mock_pool.fetch.call_args
    assert TEST_ORG_ID in call_args.args


@pytest.mark.anyio
async def test_channel_messages_404_for_other_org(api_client, as_member, with_org_id, mock_pool):
    """Accessing messages of a channel that doesn't belong to the org returns 404."""
    # fetchrow returns None — both membership and channel lookup fail
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/messages")
    assert r.status_code in (403, 404)


# ── Thread replies org-scoped ──────────────────────────────────


@pytest.mark.anyio
async def test_thread_replies_404_for_other_org(api_client, as_member, with_org_id, mock_pool):
    """Thread endpoint checks org_id; a message not in the org yields 404."""
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.get(f"/api/v1/messaging/messages/{MESSAGE_ID}/thread")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_thread_replies_returned_for_own_org(api_client, as_member, with_org_id, mock_pool):
    """Thread replies succeed when the parent message is in the user's org.

    Two fetchrows now: the parent message, then the channel — reading a thread
    requires access to the channel it hangs off, not just org membership.
    """
    mock_pool.fetchrow = AsyncMock(side_effect=[
        {"channel_id": CHANNEL_ID},   # parent message, in this org
        {"type": "public"},           # channel is public -> readable
    ])
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get(f"/api/v1/messaging/messages/{MESSAGE_ID}/thread")
    assert r.status_code == 200


# ── Remove member: admin vs non-admin ──────────────────────────


@pytest.mark.anyio
async def test_non_admin_cannot_remove_other_member(api_client, as_member, with_org_id, mock_pool):
    """A non-admin member trying to remove another member gets 403."""
    target_user_id = "user_target999"

    # First fetchrow: channel lookup -> found
    # Second fetchrow: member role lookup -> role='member' (not admin)
    mock_pool.fetchrow = AsyncMock(
        side_effect=[
            {"id": CHANNEL_ID},     # channel exists
            {"role": "member"},     # caller is 'member', not 'admin'
        ]
    )
    r = await api_client.delete(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/members/{target_user_id}"
    )
    assert r.status_code == 403
    assert "admin" in r.json().get("detail", "").lower()


@pytest.mark.anyio
async def test_admin_can_remove_member(api_client, as_admin, with_org_id, mock_pool):
    """A channel admin can remove another member."""
    target_user_id = "user_target999"
    mock_pool.fetchrow = AsyncMock(
        side_effect=[
            {"id": CHANNEL_ID},     # channel exists
            {"role": "admin"},      # caller is admin
        ]
    )
    mock_pool.execute = AsyncMock()
    r = await api_client.delete(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/members/{target_user_id}"
    )
    assert r.status_code == 200


# ── Users can leave channels themselves ────────────────────────


@pytest.mark.anyio
async def test_user_can_leave_channel(api_client, as_member, with_org_id, mock_pool, member_user):
    """A user removing themselves (leaving) doesn't require admin role."""
    own_user_id = member_user["user_id"]
    mock_pool.fetchrow = AsyncMock(return_value={"id": CHANNEL_ID})  # channel exists
    mock_pool.execute = AsyncMock()
    r = await api_client.delete(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/members/{own_user_id}"
    )
    assert r.status_code == 200


# ── Reactions are org-scoped ───────────────────────────────────


@pytest.mark.anyio
async def test_add_reaction_404_for_other_org_message(api_client, as_member, with_org_id, mock_pool):
    """Adding a reaction to a message not in the user's org yields 404."""
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.post(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions",
        params={"emoji": "thumbsup"},
    )
    assert r.status_code == 404


@pytest.mark.anyio
async def test_remove_reaction_404_for_other_org_message(api_client, as_member, with_org_id, mock_pool):
    mock_pool.fetchrow = AsyncMock(return_value=None)
    r = await api_client.delete(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions/thumbsup"
    )
    assert r.status_code == 404


@pytest.mark.anyio
async def test_add_reaction_succeeds_own_org(api_client, as_member, with_org_id, mock_pool):
    mock_pool.fetchrow = AsyncMock(side_effect=[
        {"channel_id": CHANNEL_ID},   # message, in this org
        {"type": "public"},           # channel is public -> reactable
    ])
    mock_pool.execute = AsyncMock()
    r = await api_client.post(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions",
        params={"emoji": "thumbsup"},
    )
    assert r.status_code == 200
