"""
GET /api/v1/org/profile names the organisation it resolved to.

This test exists because of a real incident. On 2026-08-28 an end-to-end suite
renamed **Aekam Inc** — the one organisation proposal 93 guarantees is untouched
— while believing it was editing Unicode Group. The credential held
`platform_admin`, so `org_resolver` answered Aekam via `platform_bypass` on every
request, the save genuinely succeeded, and the suite went green. Nothing on the
screen and nothing in the response could have told it where the write landed.

A row count cannot catch that; only asserting the target before writing can. So
the resolver's own answer is echoed back, and `frontend/e2e-real/_lanes.ts`
refuses to write until it matches the lane. The guard was written before this
field existed, which meant it could only ever fail — that is what this closes.
"""


async def test_the_profile_says_which_org_it_resolved_to(
        api_client, mock_pool, as_admin, with_org_id):
    """The id in the body is the resolver's value, not a column off the row.

    Deliberately: the row is fetched BY that id, so echoing the resolver proves
    which tenant the request is acting as — which is the question a caller about
    to write needs answered. `name` cannot answer it; the name is exactly what
    got corrupted in the incident.
    """
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "QA Org", "gstin": None}

    resp = await api_client.get("/api/v1/org/profile")

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == with_org_id, (
        "the profile must name the org the request resolved to — without it "
        "assertOrg() in the e2e lanes has nothing to compare against"
    )
    # The row is still SELECTed by that id, so the echo and the read agree.
    args = mock_pool.fetchrow.await_args.args
    assert with_org_id in args, "the row must be read by the resolved org id"


async def test_the_echo_survives_a_row_that_carries_no_optional_columns(
        api_client, mock_pool, as_admin, with_org_id):
    """A brand-new org has almost nothing set — and that is exactly the lane
    (UK AekamINC) where a mis-scoped write would be least visible, because there
    is no existing data to look wrong."""
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"name": "UK AekamINC"}

    resp = await api_client.get("/api/v1/org/profile")

    assert resp.status_code == 200
    assert resp.json()["id"] == with_org_id
