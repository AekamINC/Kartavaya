"""
Cross-tenant isolation and platform-role scope.

Two families of bug, both found by walking every route in backend/routers and
asking "does this query filter on org_id, and is the guard as strong as the
data?".

1. Routes keyed on a child id — client_id, seq_id, contract_id, report_id —
   where the child table has no org_id of its own and the parent was never
   checked. The caller supplies the id; nothing has to be forged.

2. `account_manager`, a commercial role, reaching operational data. It bypassed
   `require_module` for every module in every org, so whoever ran the
   commercial side could read any customer's payroll, HR file and attendance
   without leaving a trace.
"""

import pytest

ORG_A = "00000000-0000-0000-0000-00000000000a"
FOREIGN_CLIENT = "c0000000-0000-0000-0000-0000000000ff"
FOREIGN_SEQ = "50000000-0000-0000-0000-0000000000ff"


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def bypass_srijan_gate(app):
    from routers.hub_publish import _hub_gate as pub_gate
    from routers.hub_chat import _hub_gate as chat_gate
    app.dependency_overrides[pub_gate] = lambda: None
    app.dependency_overrides[chat_gate] = lambda: None
    yield
    app.dependency_overrides.pop(pub_gate, None)
    app.dependency_overrides.pop(chat_gate, None)


@pytest.fixture
def bypass_prachar_gate(app):
    from routers.prachar import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── Srijan publishing: routes keyed on client_id ──────────────────

@pytest.mark.parametrize("method,path,body", [
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/social-accounts", None),
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/publish/queue", None),
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/calendar", None),
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/platforms", None),
])
async def test_publishing_reads_reject_a_client_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_srijan_gate, method, path, body,
):
    mock_pool.fetchval.return_value = None  # client not in this org
    resp = await getattr(api_client, method)(path)
    assert resp.status_code == 404, path


async def test_bulk_schedule_rejects_a_client_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_srijan_gate,
):
    """The worst of the set: this route validated nothing at all, so a content
    id and an account id from another org would queue a post to their real
    social account."""
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/hub/clients/{FOREIGN_CLIENT}/publish/bulk-schedule",
        json={
            "content_id": "d0000000-0000-0000-0000-000000000001",
            "account_ids": ["a0000000-0000-0000-0000-000000000001"],
            "scheduled_for": "2026-08-01T10:00:00Z",
        },
    )
    assert resp.status_code == 404


async def test_bulk_schedule_skips_accounts_not_owned_by_the_client(
    api_client, mock_pool, as_member, org_a, bypass_srijan_gate,
):
    """Client belongs to the org and the content does, but one of the account
    ids does not — it must be refused rather than inserted."""
    calls = {"n": 0}

    async def _fetchval(sql, *args):
        calls["n"] += 1
        if "hub_clients" in sql:
            return 1
        if "hub_content_items" in sql:
            return "d0000000-0000-0000-0000-000000000001"
        if "hub_social_accounts" in sql:
            return None  # account belongs elsewhere
        return None

    mock_pool.fetchval.side_effect = _fetchval
    resp = await api_client.post(
        "/api/v1/hub/clients/c0000000-0000-0000-0000-000000000001/publish/bulk-schedule",
        json={
            "content_id": "d0000000-0000-0000-0000-000000000001",
            "account_ids": ["a0000000-0000-0000-0000-0000000000ff"],
            "scheduled_for": "2026-08-01T10:00:00Z",
        },
    )
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "failed"
    assert "not found" in result["error"].lower()
    mock_pool.fetchrow.assert_not_called()


# ── Srijan chat: the RAG path ─────────────────────────────────────

async def test_chat_session_rejects_a_client_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_srijan_gate,
):
    """A session pointed at another org's client made `send_chat_message` hand
    that client_id to the retriever, so the assistant read and summarised their
    knowledge base. The org check has to happen where the link is created."""
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/hub/clients/{FOREIGN_CLIENT}/chat/sessions",
        json={"title": "hello", "session_type": "general"},
    )
    assert resp.status_code == 404
    mock_pool.fetchrow.assert_not_called()


# ── Prachar sequences: outbound email content ─────────────────────

async def test_add_sequence_step_rejects_a_sequence_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    """Writing a step is writing the subject and body of mail another company
    sends over its own name."""
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/prachar/sequences/{FOREIGN_SEQ}/steps",
        json={"step_order": 1, "channel": "email", "subject": "hi", "body_html": "<p>hi</p>"},
    )
    assert resp.status_code == 404
    mock_pool.fetchrow.assert_not_called()


async def test_delete_sequence_step_rejects_a_sequence_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.delete(f"/api/v1/prachar/sequences/{FOREIGN_SEQ}/steps/1")
    assert resp.status_code == 404
    mock_pool.execute.assert_not_called()


async def test_sequence_stats_reject_a_sequence_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.get(f"/api/v1/prachar/sequences/{FOREIGN_SEQ}/stats")
    assert resp.status_code == 404


async def test_campaign_stats_reject_a_campaign_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.get(
        "/api/v1/prachar/campaigns/c0000000-0000-0000-0000-0000000000ff/stats"
    )
    assert resp.status_code == 404


# ── require_module: platform-role scope ───────────────────────────

def _pool_with_platform_role(mock_pool, role):
    """Answer the platform-role probe in require_module with `role`."""
    async def _fetchval(sql, *args):
        if "staging.user_roles" in sql and "org_id IS NULL" in sql:
            return role
        return None
    mock_pool.fetchval.side_effect = _fetchval


async def _run_gate(module_code, user_id="user_x"):
    """Invoke the require_module dependency directly."""
    from unittest.mock import MagicMock
    from middleware.subscription import require_module

    request = MagicMock()
    request.state._auth_user = {"user_id": user_id}
    request.url.path = f"/api/v1/{module_code}/anything"
    request.method = "GET"
    request.headers = {}
    request.client = None

    def _getattr(name, default=None):
        return {"user_id": user_id}

    check = require_module(module_code)
    return await check(request=request, org_id=ORG_A)


@pytest.mark.parametrize("module_code", ["vetana", "ganit", "manav", "pahchan"])
async def test_account_manager_cannot_reach_a_sensitive_module(
    mock_pool, module_code,
):
    """account_manager is a commercial role. PLAN_ROLES §2.1 gives it org
    creation, module toggles and storage — no customer data at all. It was
    reaching payroll, accounting, HR files and biometric attendance in every
    org."""
    from fastapi import HTTPException

    _pool_with_platform_role(mock_pool, "account_manager")
    with pytest.raises(HTTPException) as exc:
        await _run_gate(module_code)
    assert exc.value.status_code == 403
    assert module_code in exc.value.detail


@pytest.mark.parametrize("module_code", ["vetana", "ganit", "manav", "pahchan"])
async def test_platform_admin_reaches_a_sensitive_module_but_is_audited(
    mock_pool, monkeypatch, module_code,
):
    """Support access is never silent — the standing rule. The volume argument
    that keeps the non-sensitive bypass unaudited does not apply here: these
    are a small minority of requests made rarely by three people."""
    emitted = []
    monkeypatch.setattr(
        "middleware.subscription.audit",
        lambda action, request=None, **kw: emitted.append((action, kw)),
    )
    _pool_with_platform_role(mock_pool, "platform_admin")

    await _run_gate(module_code)

    assert len(emitted) == 1
    action, kw = emitted[0]
    assert action == "platform.sensitive_module_access"
    assert kw["severity"] == "warn"
    assert kw["resource_id"] == module_code
    assert kw["detail"]["role"] == "platform_admin"
    assert kw["detail"]["via"] == "platform_bypass"


async def test_non_sensitive_module_bypass_stays_silent(mock_pool, monkeypatch):
    """Deliberate: this gate gates ~400 endpoints and a row per request is a
    product decision, not a middleware one. Asserted so that changing it is a
    choice rather than an accident."""
    emitted = []
    monkeypatch.setattr(
        "middleware.subscription.audit",
        lambda action, request=None, **kw: emitted.append(action),
    )
    _pool_with_platform_role(mock_pool, "account_manager")

    await _run_gate("graha")

    assert emitted == []


async def test_pahchan_is_treated_as_sensitive():
    """Biometric-adjacent: face-match scores and selfies against a named
    employee."""
    from middleware.subscription import SENSITIVE_MODULES
    assert "pahchan" in SENSITIVE_MODULES


async def test_account_manager_is_not_an_operational_platform_role():
    from middleware.subscription import OPERATIONAL_PLATFORM_ROLES
    assert "account_manager" not in OPERATIONAL_PLATFORM_ROLES
    assert "platform_admin" in OPERATIONAL_PLATFORM_ROLES


# ── require_org_role: the unconditional platform pass ─────────────

async def test_require_org_role_no_longer_waves_account_manager_through(
    mock_pool,
):
    """It guards org member management, org profile, the Manav PII reveal and
    Pahchan review. None of those are commercial actions."""
    from fastapi import HTTPException
    from middleware.roles import require_org_role

    seen = {}

    async def _fetchval(sql, *args):
        if "role_code = 'platform_admin'" in sql:
            seen["probe"] = sql
            return None  # not a platform_admin
        return None  # and no org role either

    mock_pool.fetchval.side_effect = _fetchval

    check = require_org_role("org_owner", "org_admin")
    with pytest.raises(HTTPException) as exc:
        await check(user={"user_id": "user_am"}, org_id=ORG_A)
    assert exc.value.status_code == 403
    # The probe must ask only about platform_admin, never account_manager.
    assert "account_manager" not in seen["probe"]


async def test_require_org_role_still_passes_platform_admin(mock_pool):
    from middleware.roles import require_org_role

    async def _fetchval(sql, *args):
        return 1 if "role_code = 'platform_admin'" in sql else None

    mock_pool.fetchval.side_effect = _fetchval

    check = require_org_role("org_owner", "org_admin")
    user = await check(user={"user_id": "user_pa"}, org_id=ORG_A)
    assert user["user_id"] == "user_pa"
