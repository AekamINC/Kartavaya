"""
The two Vikray reads restored from the approved design — `/pipeline` and
`/customers` (`design-reference/Kartavaya Redesign/Data.jsx:125`).

Both are new surfaces on a module whose grant is comparatively cheap to hold,
and both sit next to the CRM. The question this file answers is not "do they
return rows" but "can holding vikray become a way to read something vikray was
never granted".

That is not hypothetical. `GET /v1/dristi/pipeline` was found reading
`staging.graha_deals` with no source-module check, so a grant on the reporting
module alone read the entire CRM pipeline and every salesperson's numbers. The
same shape was available here: a tab called "pipeline" on a sales module is one
careless join away from being Graha's deal board with a different heading.

So three properties, asserted rather than assumed:

  · GATED       — both routes carry `require_module("vikray")`.
  · NOT THE CRM — `/pipeline` never reads `graha_deals`. The only Graha table
                  either endpoint touches is `graha_contacts`, joined for a
                  party name on an order that already belongs to this org,
                  which `GET /orders` has returned behind this same gate since
                  the module shipped.
  · ORG-SCOPED  — asserted on the SQL, because that is where the guarantee is.
"""
import pytest


@pytest.fixture
def vikray_gate(app):
    from routers.vikray import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


def _find_route(router, path, seen=None):
    """The route object for `path`, anywhere in the mounted tree.

    FastAPI wraps each `include_router` in an `_IncludedRouter` that keeps the
    real router on `.original_router`, so a flat scan of `app.routes` sees only
    what was registered directly on the app — for this app, 45 entries and not
    one of them a module endpoint. `test_me_security.py:74` records the same
    constraint; this walks the same way but returns the route rather than the
    path, because the assertion below is about its dependencies.
    """
    seen = seen if seen is not None else set()
    for r in getattr(router, "routes", []):
        if getattr(r, "path", None) == path and hasattr(r, "dependant"):
            return r
        inner = getattr(r, "original_router", None)
        if inner is not None and id(inner) not in seen:
            seen.add(id(inner))
            found = _find_route(inner, path, seen)
            if found is not None:
                return found
        elif inner is None and hasattr(r, "routes") and id(r) not in seen:
            seen.add(id(r))
            found = _find_route(r, path, seen)
            if found is not None:
                return found
    return None


def _route(app, path):
    r = _find_route(app, path)
    if r is None:
        raise AssertionError(f"{path} is not mounted — the handler is dead code")
    return r


def _dependency_callables(dependant):
    """Every dependency callable on a route, including nested ones."""
    found = []
    for dep in dependant.dependencies:
        found.append(dep.call)
        found.extend(_dependency_callables(dep))
    return found


def _sql(mock_pool):
    """Every query string this handler sent, lowercased."""
    return " ".join(str(c.args[0]).lower() for c in mock_pool.fetch.call_args_list)


# ══════════════════════════════════════════════════════════════════════════════
# Gated
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("path", [
    "/api/v1/vikray/pipeline",
    "/api/v1/vikray/customers",
])
def test_route_carries_the_vikray_module_gate(app, path):
    """
    Without this, a route added to this router inherits nothing — the gate is
    per-endpoint, not per-router, so a new handler that forgets `_gate` is open
    to anyone with a session.
    """
    from routers.vikray import _gate
    assert _gate in _dependency_callables(_route(app, path).dependant)


# ══════════════════════════════════════════════════════════════════════════════
# Not the CRM
# ══════════════════════════════════════════════════════════════════════════════

async def test_pipeline_never_reads_the_crm_deal_board(
    api_client, mock_pool, as_member, with_org_id, vikray_gate,
):
    """The Dristi defect, asserted against directly."""
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vikray/pipeline")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    assert "graha_deals" not in sql
    assert "vikray_orders" in sql


async def test_customers_never_reads_the_crm_deal_board(
    api_client, mock_pool, as_member, with_org_id, vikray_gate,
):
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vikray/customers")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    assert "graha_deals" not in sql
    assert "vikray_orders" in sql


async def test_customers_does_not_select_crm_relationship_columns(
    api_client, mock_pool, as_member, with_org_id, vikray_gate,
):
    """
    A customers tab that quietly returns lead score, owner and last-contacted
    IS the CRM, whatever the heading says. The trading history is this module's;
    the relationship is not.
    """
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vikray/customers")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    for crm_only in ("lead_score", "assigned_to", "last_contacted_at", "converted_at", "tags"):
        assert crm_only not in sql


# ══════════════════════════════════════════════════════════════════════════════
# Org-scoped
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("path", [
    "/api/v1/vikray/pipeline",
    "/api/v1/vikray/customers",
])
async def test_every_query_is_org_scoped(
    api_client, mock_pool, as_member, with_org_id, vikray_gate, path,
):
    mock_pool.fetch.return_value = []

    resp = await api_client.get(path)
    assert resp.status_code == 200

    for call in mock_pool.fetch.call_args_list:
        assert "org_id=$1::uuid" in str(call.args[0])

    # And the contact join carries the org on BOTH sides, so a contact_id that
    # ever pointed outside the tenant cannot pull a foreign row into the answer.
    assert "c.org_id = o.org_id" in _sql(mock_pool).replace("C.ORG_ID", "c.org_id")


# ══════════════════════════════════════════════════════════════════════════════
# Shape — the frontend reads both through `rows()`
# ══════════════════════════════════════════════════════════════════════════════

async def test_pipeline_returns_data_and_a_full_stage_board(
    api_client, mock_pool, as_member, with_org_id, vikray_gate,
):
    """
    Every stage is present even when no order sits at it. A board that omits
    empty stages changes shape as orders move, and "Dispatched" vanishing
    because it hit zero reads as a bug in the funnel rather than an empty
    column.
    """
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vikray/pipeline")
    body = resp.json()

    assert body["data"] == []
    assert [s["stage"] for s in body["stages"]] == [
        "draft", "confirmed", "dispatched", "delivered", "closed",
    ]
    assert all(s["count"] == 0 for s in body["stages"])


async def test_customers_returns_a_data_envelope(
    api_client, mock_pool, as_member, with_org_id, vikray_gate,
):
    """The envelope now carries the count too (F4 step b).

    `data` is unchanged and still first — that is what makes the change additive
    for every existing caller. `total`, `limit` and `truncated` are new siblings
    so a client can tell a full list from a page: this endpoint caps at 200, and
    a customer beyond the cap was previously invisible with no signal at all.
    """
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vikray/customers")
    assert resp.json() == {"data": [], "total": 0, "limit": 200, "truncated": False}


async def test_customer_search_is_parameterised(
    api_client, mock_pool, as_member, with_org_id, vikray_gate,
):
    """The search term reaches the driver as a bound parameter, never inlined."""
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vikray/customers", params={"q": "O'Brien"})
    assert resp.status_code == 200

    call = mock_pool.fetch.call_args_list[-1]
    assert "O'Brien" not in str(call.args[0])
    assert "%O'Brien%" in call.args
