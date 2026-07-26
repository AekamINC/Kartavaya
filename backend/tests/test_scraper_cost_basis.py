"""
Aekam's cost basis must not cross to a tenant.

`staging.hub_scraper_runs` carries two money columns that mean different things:

    billed_inr   what the CUSTOMER was charged. Theirs. Must be visible.
    cost_usd     what the run cost AEKAM upstream at Apify — written by the
                 backend from `info["usage_usd"]` (routers/scrapers.py:228).
                 Aekam's own cost basis. Must never cross.

Returning both on the same row hands the customer the markup by subtraction, on
every run, for free. `SCRAPER_MARGIN` in routers/scrapers.py is the quantity that
falls out of it.

Two tenant routes used to select `r.cost_usd` and return `dict(r)` behind nothing
but module membership:

    GET /api/v1/scrapers/runs            list_runs
    GET /api/v1/scrapers/runs/{run_id}   get_run

The column is now dropped from both SELECTs. The platform console keeps it:
`/admin/usage` and `/admin/runs` sit behind
`require_platform_role(*OPERATIONS_CONSOLE_ROLES)` and are supposed to show it.

The org-boundary tests in the same file already passed. This file is where they
belong.
"""

import pytest

ORG_A = "00000000-0000-0000-0000-00000000000a"
RUN_IN_ORG_B = "70000000-0000-0000-0000-0000000000ff"

#: The full row shape those two routes select, as asyncpg would hand it back.
_RUN_ROW = {
    "id": "70000000-0000-0000-0000-000000000001",
    "org_id": ORG_A,
    "scraper_id": "80000000-0000-0000-0000-000000000001",
    "user_id": "user_mem001",
    "status": "succeeded",
    "result_count": 120,
    "billed_inr": 900,
    "cost_usd": 2.37,          # ← Aekam's cost basis
    "credits_charged": 9,
    "error": None,
    "created_at": None,
    "finished_at": None,
    "graha_imported_count": 0,
    "graha_imported_at": None,
    "results_r2_key": None,
    "results": [],
    "scraper_name": "Google Maps Scraper",
    "result_columns": [],
    "icon": "map",
}


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def bypass_module_gate(app):
    """The srijan module gate. Bypassed so these tests exercise the payload
    shape, not the subscription check — which has its own coverage."""
    from routers.scrapers import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── cost_usd must not cross ──────────────────────────────────────────────────

async def test_list_runs_does_not_return_aekams_cost_basis(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    mock_pool.fetch.return_value = [_RUN_ROW]

    resp = await api_client.get("/api/v1/scrapers/runs")
    assert resp.status_code == 200
    rows = resp.json()["data"]
    assert rows, "expected a run"

    assert "cost_usd" not in rows[0], (
        "cost_usd is what the run cost Aekam upstream, not what the customer "
        "was charged"
    )
    # What the customer pays is theirs and must still be there — otherwise this
    # test would pass on a route that returned an empty row.
    assert rows[0]["billed_inr"] == 900


async def test_get_run_does_not_return_aekams_cost_basis(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    mock_pool.fetchrow.return_value = _RUN_ROW

    resp = await api_client.get(f"/api/v1/scrapers/runs/{_RUN_ROW['id']}")
    assert resp.status_code == 200
    body = resp.json()

    assert "cost_usd" not in body
    assert body["billed_inr"] == 900


# ── Org boundary — these pass today ──────────────────────────────────────────

async def test_get_run_scopes_to_the_callers_org(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """A run id from another org must be a 404, not another org's row. The id is
    supplied by the caller and nothing has to be forged."""
    mock_pool.fetchrow.return_value = None

    resp = await api_client.get(f"/api/v1/scrapers/runs/{RUN_IN_ORG_B}")
    assert resp.status_code == 404


async def test_get_run_query_filters_on_org_id(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """The 404 above is only meaningful if the org actually reached the WHERE
    clause — a route that filtered on nothing would also 404 against an empty
    mock. This asserts the filter is there and carries the caller's org."""
    seen = {}

    async def _fetchrow(query, *args):
        seen["query"] = query
        seen["args"] = args
        return None

    mock_pool.fetchrow.side_effect = _fetchrow
    await api_client.get(f"/api/v1/scrapers/runs/{RUN_IN_ORG_B}")

    assert "org_id=$2::uuid" in seen["query"]
    assert ORG_A in seen["args"]


async def test_list_runs_query_filters_on_org_id(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    seen = {}

    async def _fetch(query, *args):
        seen["query"] = query
        seen["args"] = args
        return []

    mock_pool.fetch.side_effect = _fetch
    await api_client.get("/api/v1/scrapers/runs")

    assert "WHERE r.org_id=$1::uuid" in seen["query"]
    assert seen["args"] == (ORG_A,)


# ── The console keeps it ─────────────────────────────────────────────────────

async def test_the_admin_console_is_not_reachable_by_a_tenant(
    api_client, mock_pool, as_member, org_a,
):
    """`/admin/usage` is where cost_usd legitimately appears, so the thing that
    keeps it out of a customer's hands is this guard. An org member holds no
    platform row, so the probe finds nothing and the route refuses."""
    mock_pool.fetchval.return_value = None

    resp = await api_client.get("/api/v1/scrapers/admin/usage")
    assert resp.status_code == 403


async def test_the_admin_console_guard_admits_only_platform_roles(
    api_client, mock_pool, as_member, org_a,
):
    """And the guard asks for a named set from `role_tiers`, not a bare string
    at the call site.

    `/admin/usage` is on the FINANCE set, not the operations set. It sums our
    supplier cost against what we billed, per org, across every org — that is
    Aekam's own P&L, not run triage. On the operating set every `platform_staff`
    holder could read the margin on every customer.
    """
    from middleware.role_tiers import (
        FINANCE_CONSOLE_ROLES, OPERATIONS_CONSOLE_ROLES,
    )
    seen = {}

    async def _fetchval(query, *args):
        if "staging.user_roles" in query:
            seen["roles"] = args[-1]
        return None

    mock_pool.fetchval.side_effect = _fetchval
    await api_client.get("/api/v1/scrapers/admin/usage")

    assert set(seen["roles"]) == set(FINANCE_CONSOLE_ROLES)
    # Never locked out of the console — the standing role_tiers invariant.
    assert "platform_owner" in seen["roles"]
    # The narrowing is the point: staff run triage, they do not read the margin.
    assert "platform_staff" in OPERATIONS_CONSOLE_ROLES
    assert "platform_staff" not in seen["roles"]
