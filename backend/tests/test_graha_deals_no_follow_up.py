"""`GET /v1/graha/deals?no_follow_up=true` — the deals with no next step.

Measured on staging for Aekam Inc: 512 open deals and ONE follow-up in the whole
organisation, and the CRM banner said "14 deals have no next step". The browser
was deriving that set by subtracting the follow-up list from the deal list, and
both endpoints cap at LIMIT 200 — so the arithmetic could not produce a number
above ~200 whatever the database held, and presented the result as fact. The
`_listed` docstring in the router already names this bug ("199 deals have no
next step against a true 510"); this is the filter that answers it.

Moving the set into the WHERE clause is what makes the count true: the query
already carries `COUNT(*) OVER() AS _total`, so `total` is computed over exactly
the rows the filter selected, before the LIMIT.

── WHY THESE TESTS READ SQL ──────────────────────────────────────────────────

The suite runs on a mock pool, which will happily return whatever rows a test
hands it no matter what the statement says — a green run here proves nothing
about the SQL, and this project has been bitten by exactly that (an untyped
`balance=$1+$2` passed every test and 500'd every credit spend in production).
So the row-level rules — a completed follow-up does not count, a Won deal is not
in the set — are asserted against the predicate the route actually builds, which
is the only thing a mock can witness. Each one names the wrong query it rules
out.
"""
import re

import pytest

DEAL_ROW = {
    "id": "d0000000-0000-0000-0000-000000000001",
    "title": "Enterprise Deal",
    "value": 100000,
    "stage": "Qualified",
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


def _sql(mock_pool) -> str:
    """The statement the route sent, whitespace flattened.

    The query is assembled by concatenating string fragments, so a clause can
    land with any run of spaces or none at a seam; matching on the raw text
    would make these tests fail on reformatting rather than on meaning.
    """
    stmt = mock_pool.fetch.call_args[0][0]
    return re.sub(r"\s+", " ", stmt).strip()


# ── The filter itself ────────────────────────────────────────────────────────

async def test_the_filter_is_off_unless_asked_for(api_client, mock_pool, as_admin, with_org_id):
    """The default list is every deal, unchanged.

    This is the guard on an additive parameter: the deals grid, the mobile
    list and the kanban all call this route with no `no_follow_up`, and a
    filter that leaked into the default would empty three screens at once.
    """
    mock_pool.fetch.return_value = [DEAL_ROW]
    resp = await api_client.get("/api/v1/graha/deals")
    assert resp.status_code == 200
    assert "NOT EXISTS" not in _sql(mock_pool)
    assert "NOT IN ('Won','Lost')" not in _sql(mock_pool)


async def test_selects_open_deals_that_have_no_pending_follow_up(
    api_client, mock_pool, as_admin, with_org_id
):
    """Both halves of the set, in one WHERE clause: open AND unscheduled."""
    mock_pool.fetch.return_value = [{**DEAL_ROW, "_total": 1}]
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    assert "AND d.stage NOT IN ('Won','Lost')" in sql
    assert "AND NOT EXISTS (SELECT 1 FROM public.graha_follow_ups f" in sql
    assert resp.json()["data"][0]["id"] == DEAL_ROW["id"]


async def test_a_completed_follow_up_does_not_count_as_a_next_step(
    api_client, mock_pool, as_admin, with_org_id
):
    """A deal whose only follow-up is DONE has nothing scheduled.

    The tempting subquery is `NOT EXISTS (... WHERE f.deal_id = d.id)` — any
    follow-up ever — and it is wrong in the direction that hides work: a deal
    called once in March would be counted as covered for ever. The pending
    predicate is what makes the set mean "nothing outstanding".
    """
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    assert "f.is_completed = FALSE" in sql, "the subquery must look only at PENDING follow-ups"
    assert "f.is_completed = TRUE" not in sql


async def test_a_closed_deal_with_no_follow_up_is_not_in_the_set(
    api_client, mock_pool, as_admin, with_org_id
):
    """Won and Lost deals owe nobody a next step.

    Without the stage exclusion the count is dominated by finished work — every
    deal ever won joins the set the moment its last follow-up is completed, and
    the banner grows for ever while the actual backlog stays flat.

    'Won'/'Lost' is this router's existing closed-deal vocabulary: the same pair
    appears in the today view and in the pipeline summary. A new notion of
    "closed" here would drift from those the first time an org renamed a stage.
    """
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true")
    assert resp.status_code == 200
    assert "d.stage NOT IN ('Won','Lost')" in _sql(mock_pool)


async def test_the_subquery_is_correlated_to_the_deal_and_scoped_to_the_org(
    api_client, mock_pool, as_admin, with_org_id
):
    """`f.deal_id = d.id` and `f.org_id = d.org_id`, both mandatory.

    Drop the first and the subquery becomes "does ANY pending follow-up exist",
    so one open follow-up anywhere empties the set for the whole organisation —
    which is exactly the shape of the live data that produced this bug (512
    deals, one follow-up). Drop the second and another tenant's follow-up can
    mark this org's deal as covered.
    """
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    assert "f.deal_id = d.id" in sql
    assert "f.org_id = d.org_id" in sql


async def test_the_filter_takes_no_bind_parameter(api_client, mock_pool, as_admin, with_org_id):
    """The subquery is all literals, so the `$n` sequence is untouched.

    Combined with `?stage=`, the stage value must still be `$2`. If the new
    clause had consumed a placeholder without advancing `idx`, every later
    filter would bind to the wrong position — and asyncpg would not complain,
    it would just answer the wrong question.
    """
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true&stage=Qualified")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "AND d.stage=$2 " in re.sub(r"\s+", " ", sql)
    assert args == [with_org_id, "Qualified"]


# ── The count, which is the whole point ──────────────────────────────────────

async def test_total_is_the_uncapped_count_not_the_page(
    api_client, mock_pool, as_admin, with_org_id
):
    """512 open deals with no next step, 200 rows on the wire.

    The banner reads `total`; the grid reads `data`. Before this filter existed
    the client had only `data` to count, which is why it could never say more
    than 200 — the number the user saw was the page size wearing a fact's
    clothes.
    """
    mock_pool.fetch.return_value = [{**DEAL_ROW, "id": f"d{i}", "_total": 512} for i in range(200)]
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true")
    assert resp.status_code == 200

    body = resp.json()
    assert body["total"] == 512
    assert len(body["data"]) == 200
    assert body["truncated"] is True
    assert all("_total" not in row for row in body["data"])


async def test_count_is_computed_over_the_filtered_rows(
    api_client, mock_pool, as_admin, with_org_id
):
    """`COUNT(*) OVER()` sits in the same statement as the filter.

    A separate `SELECT COUNT(*)` would have to rebuild this WHERE clause, and
    the first time the two drift the denominator is wrong in a way that looks
    authoritative — which is the failure this whole endpoint change is undoing.
    """
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals?no_follow_up=true")
    assert resp.status_code == 200

    sql = _sql(mock_pool)
    assert "COUNT(*) OVER() AS _total" in sql
    assert "NOT EXISTS" in sql, "the count and the filter must be one statement"


# ── The combination that has no answer ───────────────────────────────────────

async def test_no_follow_up_with_since_is_a_400(api_client, mock_pool, as_admin, with_org_id):
    """A delta is "what changed"; this filter is "what is missing". No overlap.

    Refused rather than ignored. FollowUpsTab sent `?status=pending` to a route
    that has no such parameter for months, FastAPI discarded it silently, and a
    filter that did nothing was indistinguishable from one that worked. A
    parameter this route cannot honour has to say so.
    """
    resp = await api_client.get(
        "/api/v1/graha/deals?no_follow_up=true&since=2026-08-01T00:00:00Z"
    )
    assert resp.status_code == 400
    assert "delta" in resp.json()["detail"].lower()


async def test_the_400_is_raised_before_any_query_runs(
    api_client, mock_pool, as_admin, with_org_id
):
    """Nothing reaches the database on a request that cannot be served."""
    resp = await api_client.get(
        "/api/v1/graha/deals?no_follow_up=true&since=2026-08-01T00:00:00Z"
    )
    assert resp.status_code == 400
    mock_pool.fetch.assert_not_called()


async def test_since_without_the_filter_still_syncs(api_client, mock_pool, as_admin, with_org_id):
    """The refusal is the combination, not `?since=` — nine lists depend on it."""
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/graha/deals?since=2026-08-01T00:00:00Z")
    assert resp.status_code == 200
    assert "NOT EXISTS" not in _sql(mock_pool)
