"""
Security tests for graha.py — org_id tenant isolation.

Every CRM endpoint must scope queries to the caller's org_id.
These tests verify that:
  - List/create/get endpoints pass org_id into SQL
  - Contacts from a different org are invisible (404)
  - The merge endpoint respects org_id boundaries
"""

import pytest

# Two orgs for cross-tenant tests
ORG_A = "00000000-0000-0000-0000-00000000000a"
ORG_B = "00000000-0000-0000-0000-00000000000b"

CONTACT_ROW = {
    "id": "c0000000-0000-0000-0000-000000000001",
    "name": "Org-A Contact",
    "email": "a@example.com",
    "phone": "",
    "company": "A Corp",
    "designation": "",
    "contact_type": "lead",
    "tags": [],
    "source": "",
    "lead_score": 0,
    "assigned_to": None,
    "last_contacted_at": None,
    "created_at": "2026-01-01T00:00:00Z",
    "client_id": None,
    "client_name": None,
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.graha import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def org_a(app):
    """Override get_org_id to return ORG_A."""
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def org_b(app):
    """Override get_org_id to return ORG_B."""
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_B
    yield ORG_B
    app.dependency_overrides.pop(get_org_id, None)


# ── List contacts: org_id passed to SQL ────────────────────────

async def test_list_contacts_passes_org_id(api_client, mock_pool, as_admin, org_a):
    """GET /contacts must include org_id=$1 in the query."""
    mock_pool.fetch.return_value = [CONTACT_ROW]
    resp = await api_client.get("/api/v1/graha/contacts")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "org_id=$1" in sql
    assert args[0] == ORG_A


async def test_list_contacts_different_org_gets_empty(api_client, mock_pool, as_admin, org_b):
    """Switching to ORG_B should pass ORG_B to SQL (DB returns nothing)."""
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/contacts")
    assert resp.status_code == 200
    assert resp.json()["data"] == []

    sql, *args = mock_pool.fetch.call_args[0]
    assert args[0] == ORG_B


# ── Create contact: org_id stored ──────────────────────────────

async def test_create_contact_stores_org_id(api_client, mock_pool, as_admin, org_a):
    """POST /contacts must insert with the caller's org_id."""
    mock_pool.fetchrow.return_value = {"id": "c_new", "name": "X", "contact_type": "lead"}
    resp = await api_client.post("/api/v1/graha/contacts", json={
        "name": "New Contact",
        "email": "new@example.com",
        "contact_type": "lead",
    })
    assert resp.status_code == 200

    sql, *args = mock_pool.fetchrow.call_args[0]
    assert "INSERT INTO staging.graha_contacts" in sql
    assert args[0] == ORG_A


# ── Get single contact: org_id scoped ──────────────────────────

async def test_get_contact_scopes_to_org(api_client, mock_pool, as_admin, org_a):
    """GET /contacts/{id} must include org_id in WHERE clause."""
    mock_pool.fetchrow.return_value = {
        **CONTACT_ROW, "billing_address": {}, "shipping_address": {},
        "gstin": "", "pan": "", "notes": "", "is_active": True,
    }
    contact_id = "c0000000-0000-0000-0000-000000000001"
    resp = await api_client.get(f"/api/v1/graha/contacts/{contact_id}")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetchrow.call_args[0]
    assert "org_id=$2" in sql
    assert args[1] == ORG_A


async def test_get_contact_wrong_org_returns_404(api_client, mock_pool, as_admin, org_b):
    """Contact from ORG_A is invisible when caller is ORG_B."""
    mock_pool.fetchrow.return_value = None  # DB returns nothing for wrong org
    contact_id = "c0000000-0000-0000-0000-000000000001"
    resp = await api_client.get(f"/api/v1/graha/contacts/{contact_id}")
    assert resp.status_code == 404


# ── Merge endpoint: org_id isolation ───────────────────────────

async def test_merge_passes_org_id(api_client, mock_pool, as_admin, org_a):
    """POST /contacts/{id}/merge must forward org_id to merge_contacts service."""
    # require_org_role checks user_roles; platform admin bypass via role='admin'
    mock_pool.fetchval.return_value = 1  # platform admin check

    # Patch merge_contacts to capture args
    import routers.graha as graha_mod
    original = graha_mod.merge_contacts
    captured = {}

    async def fake_merge(pool, org_id, survivor_id, merge_ids, user_id):
        captured["org_id"] = org_id
        captured["survivor_id"] = survivor_id
        captured["merge_ids"] = merge_ids
        return {"merged_count": len(merge_ids), "merge_id": "m001"}

    graha_mod.merge_contacts = fake_merge
    try:
        contact_id = "c0000000-0000-0000-0000-000000000001"
        resp = await api_client.post(f"/api/v1/graha/contacts/{contact_id}/merge", json={
            "merge_ids": ["c0000000-0000-0000-0000-000000000002"],
        })
        assert resp.status_code == 200
        assert captured["org_id"] == ORG_A
        assert captured["survivor_id"] == contact_id
    finally:
        graha_mod.merge_contacts = original


async def test_merge_empty_ids_rejected(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetchval.return_value = 1
    contact_id = "c0000000-0000-0000-0000-000000000001"
    resp = await api_client.post(f"/api/v1/graha/contacts/{contact_id}/merge", json={
        "merge_ids": [],
    })
    assert resp.status_code == 400


# ── Deals: org_id scoped ───────────────────────────────────────

async def test_list_deals_passes_org_id(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "org_id" in sql
    assert ORG_A in args


# ── Pipeline summary: org_id scoped ───────────────────────────

async def test_pipeline_summary_scoped(api_client, mock_pool, as_admin, org_a):
    mock_pool.fetch.return_value = [{"stage": "New", "count": 1, "total_value": 5000}]
    resp = await api_client.get("/api/v1/graha/pipeline-summary")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "org_id" in sql
    assert ORG_A in args
