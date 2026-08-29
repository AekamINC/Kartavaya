"""
Security tests for prachar.py — org_id tenant isolation.

Every marketing endpoint must scope queries to the caller's org_id.
These tests verify that:
  - Campaign list/create/get endpoints pass org_id into SQL
  - Campaign send (dispatch) is org-scoped
  - Templates are org-scoped
  - Cross-org access returns 404
"""

import pytest

ORG_A = "00000000-0000-0000-0000-00000000000a"
ORG_B = "00000000-0000-0000-0000-00000000000b"

CAMPAIGN_ROW = {
    "id": "camp0000-0000-0000-0000-000000000001",
    "name": "Launch Email",
    "template_id": None,
    "subject": "Hello",
    "body_html": "<p>Hi</p>",
    "channel": "email",
    "audience_filter": {},
    "status": "draft",
    "is_active": True,
    "scheduled_at": None,
    "created_by": "user_admin001",
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}

TEMPLATE_ROW = {
    "id": "tmpl0000-0000-0000-0000-000000000001",
    "name": "Welcome",
    "subject": "Welcome!",
    "body_html": "<p>Welcome</p>",
    "body_text": "Welcome",
    "category": "general",
    "variables": "[]",
    "is_active": True,
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.prachar import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def org_b(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_B
    yield ORG_B
    app.dependency_overrides.pop(get_org_id, None)


# ── List campaigns: org_id filtering ───────────────────────────

async def test_list_campaigns_passes_org_id(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetch.return_value = [CAMPAIGN_ROW]
    resp = await api_client.get("/api/v1/prachar/campaigns")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1

    sql, *args = mock_pool.fetch.call_args[0]
    assert "org_id=$1" in sql
    assert args[0] == ORG_A


async def test_list_campaigns_different_org_empty(api_client, mock_pool, as_admin, org_b):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/prachar/campaigns")
    assert resp.status_code == 200
    assert resp.json()["data"] == []

    sql, *args = mock_pool.fetch.call_args[0]
    assert args[0] == ORG_B


# ── Create campaign: org_id stored ─────────────────────────────

async def test_create_campaign_stores_org_id(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetchrow.return_value = CAMPAIGN_ROW
    resp = await api_client.post("/api/v1/prachar/campaigns", json={
        "name": "Launch Email",
        "subject": "Hello",
        "body_html": "<p>Hi</p>",
    })
    assert resp.status_code == 200

    sql, *args = mock_pool.fetchrow.call_args[0]
    assert "INSERT INTO public.prachar_campaigns" in sql
    assert args[0] == ORG_A


# ── Get single campaign: org_id scoped ─────────────────────────

async def test_get_campaign_scopes_to_org(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetchrow.return_value = CAMPAIGN_ROW
    camp_id = "camp0000-0000-0000-0000-000000000001"
    resp = await api_client.get(f"/api/v1/prachar/campaigns/{camp_id}")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetchrow.call_args[0]
    assert "org_id=$2" in sql
    assert args[1] == ORG_A


async def test_get_campaign_wrong_org_returns_404(api_client, mock_pool, as_admin, org_b):
    mock_pool.fetchrow.return_value = None
    camp_id = "camp0000-0000-0000-0000-000000000001"
    resp = await api_client.get(f"/api/v1/prachar/campaigns/{camp_id}")
    assert resp.status_code == 404


# ── Campaign dispatch: org-scoped ──────────────────────────────

async def test_send_campaign_scopes_audience_to_org(api_client, mock_pool, as_admin, org_a):
    """POST /campaigns/{id}/send must look up the campaign AND audience by org_id."""
    camp_id = "camp0000-0000-0000-0000-000000000001"

    # First fetchrow: campaign lookup (org-scoped)
    mock_pool.fetchrow.return_value = {
        **CAMPAIGN_ROW,
        "audience_filter": {},
        "template_id": None,
    }
    # _resolve_audience calls pool.fetch for contacts
    mock_pool.fetch.side_effect = [
        # Contacts matching the audience.
        #
        # `client_id` is set because the ICAI gate (`services/prachar_compliance`)
        # refuses a send whose audience contains anybody the firm does not act
        # for, and a mock pool returns this list regardless of the WHERE clause
        # the resolver built — so the fixture has to satisfy the predicate the
        # real database would have applied. Without it this test asserts a 403,
        # which is the gate working, not the org scoping failing.
        [{"id": "ct1", "email": "a@example.com", "name": "A",
          "client_id": "cli00000-0000-0000-0000-000000000001"}],
        # unsubscribes
        [],
    ]

    # pool.acquire context manager for transaction
    conn = mock_pool.acquire.return_value
    conn.__aenter__.return_value = conn
    conn.__aexit__.return_value = False
    conn.transaction.return_value = conn
    conn.execute = pytest.importorskip("unittest.mock").AsyncMock()

    resp = await api_client.post(f"/api/v1/prachar/campaigns/{camp_id}/send")
    assert resp.status_code == 200

    # Verify the campaign lookup SQL included org_id
    first_fetchrow_sql = mock_pool.fetchrow.call_args_list[0][0][0]
    assert "org_id=$2" in first_fetchrow_sql

    # Verify audience fetch included org_id
    audience_sql = mock_pool.fetch.call_args_list[0][0][0]
    assert "org_id" in audience_sql


async def test_send_campaign_wrong_org_404(api_client, mock_pool, as_admin, org_b):
    """Sending a campaign that belongs to a different org returns 404."""
    mock_pool.fetchrow.return_value = None
    camp_id = "camp0000-0000-0000-0000-000000000001"
    resp = await api_client.post(f"/api/v1/prachar/campaigns/{camp_id}/send")
    assert resp.status_code == 404


# ── Templates: org_id scoped ──────────────────────────────────

async def test_list_templates_passes_org_id(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetch.return_value = [TEMPLATE_ROW]
    resp = await api_client.get("/api/v1/prachar/templates")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "org_id=$1" in sql
    assert args[0] == ORG_A


async def test_create_template_stores_org_id(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetchrow.return_value = TEMPLATE_ROW
    resp = await api_client.post("/api/v1/prachar/templates", json={
        "name": "Welcome",
        "subject": "Welcome!",
        "body_html": "<p>Welcome</p>",
    })
    assert resp.status_code == 200

    sql, *args = mock_pool.fetchrow.call_args[0]
    assert "INSERT INTO public.prachar_templates" in sql
    assert args[0] == ORG_A
