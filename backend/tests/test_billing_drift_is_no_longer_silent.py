"""Two drift views were built to prove an invariant, and nothing ever ran them.

── WHAT WAS FOUND ────────────────────────────────────────────────────────────

`services/billing_lines.py` states the contract in its own words:

    "the scalar is a mirror of this line, `v_org_platform_line_drift` must
     always return zero rows, and either the fee moves in both places or it
     moves in neither."

Migration 096 calls that view "the single query to run after each change".

⚠ A grep for `v_org_platform_line_drift` and `v_org_credit_drift` across every
.py, .mjs and .js in this repository returns NOTHING outside migrations 095 and
096 — the files that created them. No route, no cron, no test, no health field
has ever read either one.

Measured live on 2026-08-31:

    org                                monthly_price   platform_line
    UK AekamINC                            20,000.00   (none)
    E2E Test & Associates [TEST ORG]       12,000.00   (none)
    Unicode Group                          12,000.00   (none)
    Demo - Kartavaya                       10,000.00   (none)

Four organisations, ₹54,000 a month, being charged a fee that no invoice can
reach — because an invoice is a query over `org_billing_lines` and there is not
one row in that table for any org in the product. The view built to catch this
has been red the entire time and nothing said so.

── WHY THIS FILE IS IN THIS PROGRAMME AND NOT IN THE BILLING BACKLOG ─────────

Because it is the same finding as everything else here, wearing different
clothes. This programme's dominant fault is ASSERTIONS SATISFIED BY THEIR OWN
SHAPE — a check that cannot fail because of how it is written. A check that
nothing executes cannot fail because it never runs. Both are green for ever,
and both are worse than having no check at all, because somebody has been left
believing the invariant is watched.

The repair is not to fix the four rows. It is to make the number VISIBLE, so
the next drift is noticed by the product rather than by somebody reading a
migration file two years later.

── WHAT THIS FILE PINS ───────────────────────────────────────────────────────

That `/api/health` reads both views and reports them, that it reports a COUNT
and never the rows, and — the one that matters most — that a view it cannot
read comes back as `null` and NOT as `0`. A read failure that reports zero is
the silence this entry exists to end, restored one layer up.
"""
import pytest


@pytest.mark.anyio
async def test_health_reports_both_drift_counts(api_client, mock_pool):
    mock_pool.fetchval.return_value = 0
    r = await api_client.get("/api/health")
    assert r.status_code == 200
    drift = r.json().get("billing_drift")
    assert drift is not None, (
        "/api/health no longer reports billing drift, so the two views are "
        "back to being read by nothing at all"
    )
    assert set(drift) == {"platform_line", "credits"}


@pytest.mark.anyio
async def test_it_reads_the_two_views_by_name(api_client, mock_pool):
    """⚠ BY NAME, because a health field that reports a number from somewhere
    else is worse than no field: it would read healthy while the invariant it
    claims to watch was broken."""
    mock_pool.fetchval.return_value = 0
    await api_client.get("/api/health")
    sql = " ".join(str(c.args[0]) for c in mock_pool.fetchval.await_args_list)
    assert "v_org_platform_line_drift" in sql, (
        "the platform-line drift view is not being queried"
    )
    assert "v_org_credit_drift" in sql, (
        "the credit drift view is not being queried"
    )


@pytest.mark.anyio
async def test_a_non_zero_count_reaches_the_caller(api_client, mock_pool):
    """The whole point. Live, this is 4."""
    mock_pool.fetchval.return_value = 4
    r = await api_client.get("/api/health")
    assert r.json()["billing_drift"]["platform_line"] == 4


@pytest.mark.anyio
async def test_it_reports_a_count_and_never_the_rows(api_client, mock_pool):
    """`/api/health` is UNAUTHENTICATED.

    The drift rows carry organisation names and what each one is charged. A
    number says "something has drifted, go and look" without saying whose, and
    that is the most this endpoint may say.
    """
    mock_pool.fetchval.return_value = 4
    r = await api_client.get("/api/health")
    body = r.text
    for leak in ("monthly_price", "org_id", "Unicode", "AekamINC", "20000"):
        assert leak not in body, (
            f"/api/health leaks {leak!r} — it is unauthenticated and the drift "
            f"rows name organisations and their fees"
        )


@pytest.mark.anyio
async def test_a_view_that_cannot_be_read_is_null_and_not_zero(api_client, mock_pool):
    """⚠ THE ASSERTION THIS FILE MOST EXISTS FOR.

    Zero means "checked, and clean". Null means "could not check". Collapsing
    the two would restore the exact silence this endpoint was added to end —
    the field would read healthy on an org whose view had been dropped, renamed
    or made unreadable, which is precisely how the four live rows went unseen.
    """
    async def boom(*_a, **_k):
        raise RuntimeError("relation does not exist")
    mock_pool.fetchval.side_effect = boom

    r = await api_client.get("/api/health")
    drift = r.json()["billing_drift"]
    assert drift["platform_line"] is None, (
        "an unreadable drift view reported 0, which reads as clean"
    )
    assert drift["credits"] is None


@pytest.mark.anyio
async def test_the_endpoint_still_answers_when_the_views_fail(api_client, mock_pool):
    """A health endpoint that 500s because a reporting view is missing has
    turned a monitoring nicety into an outage. It must degrade, not fall over."""
    async def boom(*_a, **_k):
        raise RuntimeError("relation does not exist")
    mock_pool.fetchval.side_effect = boom

    r = await api_client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["app"] == "Kartavaya"
