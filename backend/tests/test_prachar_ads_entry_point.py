"""
Prachar Ads could never acquire its first ad account.

WHAT WAS WRONG, AND WHERE IT WAS NOT. The only Sync control in the product was
rendered inside the ad-accounts table, and that table is replaced by an empty
state when the list is empty — so with zero ad accounts there was no sync
control anywhere in web or mobile, and ad accounts only come into existence
after a sync. A closed loop. `POST /accounts/sync` itself is fine: it takes a
`social_account_id`, and `services/ad_insights.sync_meta_account` scopes the
token read to the caller's org through `hub_clients`. The dead end was one
frontend file plus one missing fact.

THE MISSING FACT is what this file is about. The screen had no way to obtain a
`social_account_id`. The only listing of social accounts in the product is
`GET /api/v1/hub/clients/{client_id}/social-accounts`, which needs a client
chosen first and sits behind Hub's own module gate — unreachable from a Prachar
tab. `GET /api/v1/prachar/ads/syncable-accounts` closes that, and because it is
a new read of a table with no `org_id` column, its tenancy is the thing worth
testing.

`hub_social_accounts` HAS NO `org_id`. Its only tenant path is
`client_id -> hub_clients.org_id`. A query that forgets the join returns every
connected account in the database, including the OAuth-connected pages of other
firms — which is the same shape as the cross-org leak this product has already
been caught by twice.

MEASURED 6 August 2026: `staging.prachar_ad_accounts` 0 rows,
`staging.hub_social_accounts` 0 rows. Nobody had hit the wall yet, which is the
only reason this was never reported as an outage.
"""

import pytest

import routers.prachar_ads as ads


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.prachar_ads import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


def test_only_the_platforms_the_sync_can_actually_talk_to():
    """`sync_meta_account` calls graph.facebook.com and nothing else.

    Offering a LinkedIn or a TikTok connection in the picker would produce a
    Meta API rejection the operator cannot act on — "No ad accounts found" for a
    platform that was never going to answer. That is a worse dead end than the
    one being fixed, because it looks like an answer.

    Written out literally rather than derived from `hub_publish.ALL_PLATFORMS`
    minus something: a subtractive rule silently admits every platform added
    later, and each one would be a new way to fail confusingly.
    """
    assert ads._SYNCABLE_PLATFORMS == ("facebook", "instagram")


@pytest.mark.anyio
async def test_the_listing_is_scoped_through_hub_clients(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The org filter must be in the SQL, on the join, not applied afterwards.

    `hub_social_accounts` has no `org_id` of its own, so "WHERE org_id=$1" is not
    available and a reviewer skimming for one would not miss its absence. The
    join is the whole tenancy boundary.
    """
    seen = {}

    async def fetch(query, *args):
        seen["query"] = " ".join(query.split())
        seen["args"] = args
        return []

    mock_pool.fetch.side_effect = fetch
    r = await api_client.get("/api/v1/prachar/ads/syncable-accounts")
    assert r.status_code == 200

    q = seen["query"]
    assert "staging.hub_social_accounts" in q
    assert "JOIN staging.hub_clients" in q
    assert "c.org_id=$1::uuid" in q
    assert seen["args"][0] == with_org_id


@pytest.mark.anyio
async def test_the_listing_refuses_platforms_the_sync_cannot_use(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The platform filter is in the query, with the allowed list as a bind.

    Filtering in Python after the fetch would work, and would also mean the row
    — including whatever columns a future edit adds to the SELECT — had already
    left the database for an account this module has no business reading.
    """
    seen = {}

    async def fetch(query, *args):
        seen["query"] = " ".join(query.split())
        seen["args"] = args
        return []

    mock_pool.fetch.side_effect = fetch
    await api_client.get("/api/v1/prachar/ads/syncable-accounts")

    assert "sa.platform = ANY($2::text[])" in seen["query"]
    assert seen["args"][1] == ["facebook", "instagram"]
    assert "sa.is_active=TRUE" in seen["query"]


@pytest.mark.anyio
async def test_no_token_or_secret_leaves_the_building(
    api_client, mock_pool, as_admin, with_org_id,
):
    """An id, a platform and two names. Not `access_token`, not `platform_data`.

    `hub_social_accounts` holds live OAuth access and refresh tokens. This route
    exists so a picker can name an account; a `SELECT sa.*` would have handed a
    customer's Facebook token to the browser to save four characters.
    """
    seen = {}

    async def fetch(query, *args):
        seen["query"] = " ".join(query.split())
        return []

    mock_pool.fetch.side_effect = fetch
    await api_client.get("/api/v1/prachar/ads/syncable-accounts")

    for secret in ("access_token", "refresh_token", "platform_data", "scopes", "sa.*"):
        assert secret not in seen["query"], f"{secret} is being selected"


@pytest.mark.anyio
async def test_the_id_it_returns_is_the_one_the_sync_route_takes(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The two halves have to agree, or the picker posts an id nothing resolves.

    `SyncRequest.social_account_id` is matched against `hub_social_accounts.id`
    by `sync_meta_account`, so the listing must return that same column as `id`
    — not `prachar_ad_accounts.social_account_id`, which is what the old Sync
    button read and which does not exist until after the first sync.
    """
    row = {
        "id": "sa-1", "platform": "facebook",
        "account_name": "Unicode Group Page", "connected_at": None,
        "client_name": "Unicode Group",
    }
    mock_pool.fetch.side_effect = lambda *a, **k: [row]

    r = await api_client.get("/api/v1/prachar/ads/syncable-accounts")
    payload = r.json()
    assert payload["data"][0]["id"] == "sa-1"
    assert payload["syncable_platforms"] == ["facebook", "instagram"]

    assert set(ads.SyncRequest.model_fields) == {"social_account_id"}
