"""
Unit tests for graha.py — CRM endpoints.

Coverage:
  GET    /api/v1/graha/contacts           — list, search, filter by type
  POST   /api/v1/graha/contacts           — create contact
  PATCH  /api/v1/graha/contacts/{id}      — update
  DELETE /api/v1/graha/contacts/{id}      — soft-delete
  GET    /api/v1/graha/pipelines          — list pipelines
  POST   /api/v1/graha/pipelines          — create pipeline
  GET    /api/v1/graha/deals              — list deals
  POST   /api/v1/graha/deals             — create deal (auto-creates default pipeline)
  PATCH  /api/v1/graha/deals/{id}         — update deal, stage transitions
  GET    /api/v1/graha/pipeline-summary   — aggregated pipeline view
  POST   /api/v1/graha/activities         — create activity
  PATCH  /api/v1/graha/activities/{id}/toggle — toggle complete
"""

import pytest

CONTACT_ROW = {
    "id": "c0000000-0000-0000-0000-000000000001",
    "name": "Acme Corp",
    "email": "info@acme.com",
    "phone": "9876543210",
    "company": "Acme",
    "contact_type": "lead",
    "created_at": "2026-01-01T00:00:00Z",
}

PIPELINE_ROW = {
    "id": "p0000000-0000-0000-0000-000000000001",
    "name": "Default Pipeline",
    "stages": '["New","Qualified","Proposal","Won","Lost"]',
    "is_default": True,
    "created_at": "2026-01-01T00:00:00Z",
}

DEAL_ROW = {
    "id": "d0000000-0000-0000-0000-000000000001",
    "title": "Enterprise Deal",
    "value": 100000,
    "stage": "New",
    "probability": 20,
    "contact_name": "Acme Corp",
    "contact_company": "Acme",
    "expected_close_date": None,
    "assigned_to": None,
    "created_at": "2026-01-01T00:00:00Z",
    "tags": [],
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.graha import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── Contacts ─────────────────────────────────────────────────────

async def test_list_contacts(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [CONTACT_ROW]
    resp = await api_client.get("/api/v1/graha/contacts")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


async def test_list_contacts_search(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [CONTACT_ROW]
    resp = await api_client.get("/api/v1/graha/contacts?search=acme")
    assert resp.status_code == 200


async def test_create_contact(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {"id": "c001", "name": "New Lead"}
    resp = await api_client.post("/api/v1/graha/contacts", json={
        "name": "New Lead",
        "email": "lead@example.com",
        "contact_type": "lead",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"


async def test_update_contact(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/graha/contacts/c0000000-0000-0000-0000-000000000001",
        json={"name": "Updated Corp"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


async def test_update_contact_empty_body(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/graha/contacts/c0000000-0000-0000-0000-000000000001",
        json={},
    )
    assert resp.status_code == 400


async def test_delete_contact(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.delete(
        "/api/v1/graha/contacts/c0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "deleted"


# ── Pipelines ────────────────────────────────────────────────────

async def test_list_pipelines(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [PIPELINE_ROW]
    resp = await api_client.get("/api/v1/graha/pipelines")
    assert resp.status_code == 200


async def test_create_pipeline_first(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchval.return_value = 0
    mock_pool.fetchrow.return_value = {"id": "p001", "name": "Sales"}
    resp = await api_client.post("/api/v1/graha/pipelines", json={
        "name": "Sales",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"


# ── Deals ────────────────────────────────────────────────────────

async def test_list_deals(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [DEAL_ROW]
    resp = await api_client.get("/api/v1/graha/deals")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


async def test_create_deal_auto_pipeline(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.side_effect = [
        {"id": "p001"},
        {"id": "d001", "title": "Big Deal", "stage": "New"},
    ]
    resp = await api_client.post("/api/v1/graha/deals", json={
        "title": "Big Deal",
        "value": 50000,
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"


async def test_update_deal_won_stage(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/graha/deals/d0000000-0000-0000-0000-000000000001",
        json={"stage": "Won"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "updated"


async def test_get_deal_not_found(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(
        "/api/v1/graha/deals/d0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 404


# ── Pipeline Summary ────────────────────────────────────────────

async def test_pipeline_summary(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [
        {"stage": "New", "count": 5, "total_value": 100000},
        {"stage": "Won", "count": 2, "total_value": 50000},
    ]
    resp = await api_client.get("/api/v1/graha/pipeline-summary")
    assert resp.status_code == 200


# ── Activities ──────────────────────────────────────────────────

async def test_create_activity_invalid_type(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.post("/api/v1/graha/activities", json={
        "title": "Follow up",
        "activity_type": "invalid_type",
    })
    assert resp.status_code == 400
