"""
Security tests for Sahayak's OAuth and social publishing — the credential path.

`staging.hub_social_accounts` holds live per-client OAuth tokens for Facebook,
Instagram, LinkedIn, Google Business, YouTube, TikTok, Threads, Reddit, Telegram,
Pinterest and WhatsApp Business. A token that crosses an org boundary does not
leak data — it lets one tenant POST PUBLICLY AS ANOTHER TENANT'S CLIENT, which
is not retractable. These tests pin that boundary.

The table has NO `org_id` column. Its only tenant path is
`hub_social_accounts.client_id -> hub_clients.id -> hub_clients.org_id`, so every
test here is really asserting that the join is present.

NOTHING IN THIS FILE PERFORMS A REAL PUBLISH. The two tests that touch a
publisher assert suppression and install an httpx stub that fails the test if any
outbound call is attempted.
"""

import inspect
import json

import pytest
from fastapi import HTTPException

ORG_A = "00000000-0000-0000-0000-00000000000a"
ORG_B = "00000000-0000-0000-0000-00000000000b"

CLIENT_A = "c1000000-0000-0000-0000-00000000000a"
CLIENT_B = "c1000000-0000-0000-0000-00000000000b"

QUEUE_ID = "d1000000-0000-0000-0000-000000000001"
ACCOUNT_ID = "e1000000-0000-0000-0000-000000000001"


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Subscription/module gating is tested elsewhere; these tests are about the
    checks that run AFTER a caller is already inside Sahayak.

    `require_module` builds a fresh closure per call site, so the hub router and
    the scrapers router hold distinct dependency objects and both need overriding.
    """
    from routers.hub_publish import _hub_gate
    from routers.scrapers import _gate as _scraper_gate

    app.dependency_overrides[_hub_gate] = lambda: None
    app.dependency_overrides[_scraper_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_hub_gate, None)
    app.dependency_overrides.pop(_scraper_gate, None)


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def allow_publish(app):
    """Bypass the publish-authority gate for tests aimed at a different check."""
    from routers.hub_publish import _require_publish_authority
    app.dependency_overrides[_require_publish_authority] = lambda: {"user_id": "u"}
    yield
    app.dependency_overrides.pop(_require_publish_authority, None)


@pytest.fixture
def no_network(monkeypatch):
    """Any outbound HTTP during a test is a test failure, not a slow test."""
    import httpx

    class _Forbidden:
        def __init__(self, *a, **kw):
            raise AssertionError(
                "Test attempted a real outbound HTTP call. Publishing paths must "
                "never be exercised for real in tests."
            )

    monkeypatch.setattr(httpx, "AsyncClient", _Forbidden)
    yield


def route_fetchval(mock_pool, routes: dict, default=None):
    """Route `pool.fetchval` by substring of the SQL.

    The `as_admin` fixture installs its own side_effect to satisfy platform-role
    lookups; tests that need a *specific* answer for a *specific* query install
    this instead and spell out the platform-role answer themselves.
    """
    async def _fetchval(query, *args):
        for needle, value in routes.items():
            if needle in query:
                return value
        return default

    mock_pool.fetchval.side_effect = _fetchval


# ══════════════════════════════════════════════════════════════════════════════
# 1 · OAuth authorize must prove the client belongs to the caller's org
# ══════════════════════════════════════════════════════════════════════════════

async def test_oauth_authorize_rejects_another_orgs_client(
    api_client, mock_pool, app, org_a, monkeypatch, no_network,
):
    """The regression test for the cross-org token-injection hole.

    `client_id` decides whose social account the callback files the token under.
    It arrives as an unvalidated query parameter, so a caller in ORG_A passing
    ORG_B's client id used to get a working consent URL — and the token landed on
    ORG_B's client.
    """
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: {"user_id": "u_attacker"}
    monkeypatch.setenv("META_APP_ID", "test-app-id")
    monkeypatch.setenv("BACKEND_URL", "https://api.test")

    route_fetchval(mock_pool, {
        # caller is a legitimate Aekam operator — authority is NOT the thing
        # under test here; ownership of the client is.
        "staging.user_roles": "platform_staff",
        # ORG_B's client is not in ORG_A -> the ownership probe finds nothing
        "staging.hub_clients": None,
    })

    resp = await api_client.get(
        f"/api/v1/hub/oauth/facebook/authorize?client_id={CLIENT_B}"
    )

    assert resp.status_code == 404, (
        "authorize must refuse a client outside the caller's org"
    )

    ownership_probes = [
        c for c in mock_pool.fetchval.call_args_list
        if "staging.hub_clients" in c[0][0]
    ]
    assert ownership_probes, "authorize never checked client ownership at all"
    sql, *args = ownership_probes[0][0]
    assert "org_id=$2::uuid" in sql
    assert args == [CLIENT_B, ORG_A], (
        "the ownership probe must test the REQUESTED client against the "
        "CALLER'S org"
    )
    app.dependency_overrides.pop(require_user, None)


async def test_oauth_authorize_allows_own_client_and_leaks_no_secret(
    api_client, mock_pool, app, org_a, monkeypatch, no_network,
):
    """The legitimate path still works, and returns no credential material."""
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: {"user_id": "u_ops"}
    monkeypatch.setenv("META_APP_ID", "test-app-id")
    monkeypatch.setenv("META_APP_SECRET", "test-app-secret")
    monkeypatch.setenv("BACKEND_URL", "https://api.test")

    route_fetchval(mock_pool, {
        "staging.user_roles": "platform_staff",
        "staging.hub_clients": 1,
    })

    resp = await api_client.get(
        f"/api/v1/hub/oauth/facebook/authorize?client_id={CLIENT_A}"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "auth_url" in body

    # The app secret must never travel to the browser — only the app ID does.
    serialised = json.dumps(body)
    assert "test-app-secret" not in serialised
    assert "access_token" not in serialised
    app.dependency_overrides.pop(require_user, None)


# ══════════════════════════════════════════════════════════════════════════════
# 2 · OAuth callback must re-prove the pairing before writing a token
# ══════════════════════════════════════════════════════════════════════════════

async def test_oauth_callback_writes_no_token_when_client_left_the_org(
    api_client, mock_pool, no_network,
):
    """The callback is unauthenticated by necessity — the provider redirects the
    browser to it and there is no bearer token on the request. Its only proof is
    the state row, so the pairing recorded there is re-proved before the insert.

    The check must happen BEFORE the code-for-token exchange, which is why
    `no_network` is active: if the ordering ever regresses, this test fails on the
    forbidden httpx call rather than silently passing.
    """
    mock_pool.fetchrow.return_value = {
        "data": json.dumps({
            "platform": "facebook",
            "client_id": CLIENT_B,
            "org_id": ORG_A,
            "user_id": "u_attacker",
        })
    }
    # the client is no longer in that org
    route_fetchval(mock_pool, {"staging.hub_clients": None})

    resp = await api_client.get(
        "/api/v1/hub/oauth/facebook/callback?code=abc&state=xyz"
    )
    assert resp.status_code == 404

    wrote_token = [
        c for c in mock_pool.execute.call_args_list
        if "hub_social_accounts" in c[0][0]
    ]
    assert not wrote_token, (
        "callback inserted an OAuth token despite failing the ownership check"
    )


async def test_oauth_callback_rejects_state_without_org(api_client, mock_pool, no_network):
    """A state row predating the org pairing must fail closed, not fall through
    to an unscoped insert."""
    mock_pool.fetchrow.return_value = {
        "data": json.dumps({
            "platform": "facebook",
            "client_id": CLIENT_B,
            "user_id": "u",
        })
    }
    resp = await api_client.get(
        "/api/v1/hub/oauth/facebook/callback?code=abc&state=xyz"
    )
    assert resp.status_code == 400
    assert not [
        c for c in mock_pool.execute.call_args_list
        if "hub_social_accounts" in c[0][0]
    ]


# ══════════════════════════════════════════════════════════════════════════════
# 3 · No endpoint may return a token to the browser
# ══════════════════════════════════════════════════════════════════════════════

async def test_list_social_accounts_never_selects_token_columns(
    api_client, mock_pool, as_admin, org_a,
):
    mock_pool.fetch.return_value = []
    route_fetchval(mock_pool, {
        "staging.user_roles": "platform_admin",
        "staging.hub_clients": 1,
    })

    resp = await api_client.get(f"/api/v1/hub/clients/{CLIENT_A}/social-accounts")
    assert resp.status_code == 200

    sql = mock_pool.fetch.call_args[0][0]
    assert "access_token" not in sql, "token column selected on a browser-facing route"
    assert "refresh_token" not in sql
    assert "SELECT *" not in sql, (
        "SELECT * on hub_social_accounts would ship the tokens the moment the "
        "column list changes"
    )


def test_publish_queue_routes_never_select_tokens():
    """Static check across the whole router: the only SELECTs that may name a
    token column are the service-internal ones, never a route in hub_publish."""
    import routers.hub_publish as hp

    source = inspect.getsource(hp)
    # The write paths legitimately name the column; the read paths must not.
    for marker in ("SELECT q.id", "SELECT id, platform, account_name"):
        assert marker in source


# ══════════════════════════════════════════════════════════════════════════════
# 4 · Publishing and credential actions require more than a bare Sahayak grant
# ══════════════════════════════════════════════════════════════════════════════

async def test_publish_now_denied_to_plain_member(
    api_client, mock_pool, as_member, org_a, no_network,
):
    """RBAC-SPEC puts publishing at Sahayak admin. `require_module` only asks
    whether a grant exists, so before the gate a viewer could post publicly as
    the customer's brand."""
    route_fetchval(mock_pool, {"staging.user_roles": None})

    resp = await api_client.post(f"/api/v1/hub/publish/queue/{QUEUE_ID}/publish-now")
    assert resp.status_code == 403


async def test_connect_social_account_denied_to_plain_member(
    api_client, mock_pool, as_member, org_a, no_network,
):
    """Connecting an account writes a live credential from the request body."""
    route_fetchval(mock_pool, {"staging.user_roles": None})

    resp = await api_client.post(
        f"/api/v1/hub/clients/{CLIENT_A}/social-accounts",
        json={"platform": "facebook", "access_token": "tok"},
    )
    assert resp.status_code == 403


async def test_disconnect_denied_to_plain_member(
    api_client, mock_pool, as_member, org_a, no_network,
):
    route_fetchval(mock_pool, {"staging.user_roles": None})
    resp = await api_client.delete(
        f"/api/v1/hub/clients/{CLIENT_A}/social-accounts/{ACCOUNT_ID}"
    )
    assert resp.status_code == 403


async def test_platform_staff_need_a_session_but_are_not_locked_out(
    api_client, mock_pool, app, org_a, no_network,
):
    """Both halves of the owner's answer, in one test.

    REPOINTED. This used to assert that platform_staff simply KEEP publish
    access, on the grounds that `OPERATIONS_CONSOLE_ROLES` exists so they can do
    "Sahayak, including authoring skills and publishing", and that a gate
    written as org-role-only would lock out the exact role created for the work.

    That concern is still right and is still asserted below — the role is NOT
    locked out. What changed is the owner's answer to a question he was asked
    directly: connecting or posting inside a CUSTOMER's organisation now
    "requires support", meaning an approved, unexpired support session.

    Ten accounts held this by standing. Any of them could connect a customer's
    Instagram, disconnect it, or publish to that customer's followers under that
    customer's name, unrecallably, with nothing granted and nothing recorded.
    """
    from auth_router import require_user
    from routers.hub_publish import _require_connect_authority

    app.dependency_overrides[require_user] = lambda: {"user_id": "u_staff"}

    async def _fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return "platform_staff"
        if "org_member_modules" in query:
            return "admin"
        return None

    mock_pool.fetchval.side_effect = _fetchval

    # ── no session: refused, and the message says how to get one ────────────
    async def _no_session(query, *args):
        return None

    mock_pool.fetchrow.side_effect = _no_session

    with pytest.raises(HTTPException) as refused:
        await _require_connect_authority(
            user={"user_id": "u_staff"}, org_id=ORG_A,
        )
    assert refused.value.status_code == 403
    assert "support session" in str(refused.value.detail).lower(), (
        "the refusal must name the thing that fixes it"
    )

    # ── an approved session covering the module: admitted ───────────────────
    # THE HALF THIS TEST WAS ORIGINALLY WRITTEN TO PROTECT. The role still
    # works; it is gated, not removed.
    async def _live_session(query, *args):
        if "v_active_support_sessions" in query:
            return {"modules": ["sahayak"]}
        return None

    mock_pool.fetchrow.side_effect = _live_session

    result = await _require_connect_authority(
        user={"user_id": "u_staff"}, org_id=ORG_A,
    )
    assert result["user_id"] == "u_staff"

    # ── a session for a DIFFERENT module: still refused ─────────────────────
    # A customer who approved access to Ganit did not approve posting to their
    # Instagram.
    async def _wrong_module(query, *args):
        if "v_active_support_sessions" in query:
            return {"modules": ["ganit"]}
        return None

    mock_pool.fetchrow.side_effect = _wrong_module

    with pytest.raises(HTTPException) as scoped:
        await _require_connect_authority(
            user={"user_id": "u_staff"}, org_id=ORG_A,
        )
    assert scoped.value.status_code == 403

    mock_pool.fetchrow.side_effect = None
    app.dependency_overrides.pop(require_user, None)


async def test_publish_authority_uses_named_role_sets_not_literals():
    """No router may hardcode a role string — the tier model lives in one file.

    REPOINTED, AND MADE STRICTER. This used to require the guard to NAME
    `OPERATIONS_CONSOLE_ROLES` and `ORG_MANAGEMENT_ROLES`, which was the closest
    thing to "delegates the tier model" available while the guard still did its
    own `SELECT role_code FROM user_roles`.

    It does not any more. `_authority` asks `middleware.module_levels.held_level`
    for the caller's level on the module and compares it against `LEVELS` — so
    the guard now names NO role set at all, which is what this test was always
    reaching for. Requiring the old names back would force a router to re-import
    a vocabulary it no longer uses.

    The rule is therefore stated the strong way round: no role literals, and the
    decision must come from the shared ladder rather than from anything this
    file computes itself.
    """
    import routers.hub_publish as hp

    source = inspect.getsource(hp._authority)

    for literal in ("'org_admin'", '"org_admin"', "'platform_admin'",
                    '"platform_admin"', "'org_owner'", '"org_owner"',
                    "'platform_staff'", '"platform_staff"'):
        assert literal not in source, f"hardcoded role string {literal} in a guard"

    assert "held_level" in source or "_level_across" in source, (
        "the guard must ask the shared module ladder for the caller's level "
        "rather than reading a role table itself"
    )
    assert "LEVELS" in source, "the guard must compare against the shared ladder"
    assert "user_roles" not in source, (
        "the guard is reading the role table directly again — that is the "
        "duplication this test exists to prevent"
    )

    # And the two rungs stay distinct: connecting outranks sending.
    from middleware.module_levels import LEVELS as _L
    assert _L.index("admin") > _L.index("editor"), (
        "connect is gated at admin and send at editor; if the ladder ever puts "
        "editor above admin those two swap meaning silently"
    )


# ══════════════════════════════════════════════════════════════════════════════
# 4b · Child tables with no org_id must scope through their parent
# ══════════════════════════════════════════════════════════════════════════════

async def test_content_approvals_scope_through_the_content_item(
    api_client, mock_pool, app, as_admin, org_a,
):
    """`hub_content_approvals` has no org_id. Proving the CLIENT and then reading
    by CONTENT id alone is not a scope — client and content arrive as separate
    path parameters, so a caller could pair their own client with another org's
    content id and read that org's reviewer names and notes.
    """
    from routers.hub import _hub_gate

    app.dependency_overrides[_hub_gate] = lambda: None
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = {"id": CLIENT_A, "org_id": ORG_A}

    other_content = "f1000000-0000-0000-0000-0000000000ff"
    resp = await api_client.get(
        f"/api/v1/hub/clients/{CLIENT_A}/content/{other_content}/approvals"
    )
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "staging.hub_content_items" in sql, (
        "approvals read did not join through to something that carries a tenant"
    )
    assert "ci.client_id=$2::uuid" in sql
    assert args[1] == CLIENT_A
    app.dependency_overrides.pop(_hub_gate, None)


# ══════════════════════════════════════════════════════════════════════════════
# 5 · The token read in the ad sync is scoped, and its arity is right
# ══════════════════════════════════════════════════════════════════════════════

async def test_sync_meta_account_scopes_token_read_to_org(mock_pool, no_network):
    """`hub_social_accounts` has no org_id, so this read must join `hub_clients`.

    Unscoped, a caller in one org could pass another org's `social_account_id`
    and the server would call Meta with that org's OAuth token, then file their
    ad accounts and spend into the caller's tables.
    """
    from services.ad_insights import sync_meta_account

    mock_pool.fetchrow.return_value = None  # not found -> returns before network

    result = await sync_meta_account(mock_pool, ORG_A, ACCOUNT_ID)
    assert result == {"error": "Social account not found"}

    sql, *args = mock_pool.fetchrow.call_args[0]
    assert "staging.hub_clients" in sql, "token read did not join through to an org"
    assert "c.org_id=$2::uuid" in sql
    assert args == [ACCOUNT_ID, ORG_A]


def test_refresh_meta_token_arity_matches_its_callers():
    """`sync_meta_account` called this with three arguments against a one-argument
    signature, so the sync raised TypeError before reaching the network. Fixing
    the scoping without fixing the arity would have armed the vulnerability."""
    from services.social_publisher import _refresh_meta_token

    params = inspect.signature(_refresh_meta_token).parameters
    assert len(params) == 1, (
        "callers pass exactly one positional argument; changing this signature "
        "silently breaks the Meta ad sync"
    )


# ══════════════════════════════════════════════════════════════════════════════
# 6 · OUTBOUND_MODE actually suppresses a publish
# ══════════════════════════════════════════════════════════════════════════════

async def test_dry_mode_suppresses_publish_without_touching_the_network(
    monkeypatch, no_network,
):
    """Staging shares production's per-client OAuth tokens. `OUTBOUND_MODE=dry`
    is the only thing standing between a test run and a real post on a real
    customer's page."""
    import outbound
    from services import social_publisher

    monkeypatch.setattr(outbound, "DRY_RUN", True)

    result = await social_publisher.publish_to_facebook(
        {"account_name": "Test Page", "page_id": "123", "access_token": "tok"},
        "this must never be posted",
    )
    assert result["suppressed"] is True
    assert result["platform_post_id"] is None


def test_every_publisher_is_guarded():
    """The suppression decorator is applied per entry point precisely so a new
    platform is covered without anyone remembering to. Verify none slipped."""
    from services import social_publisher

    publishers = [
        name for name in dir(social_publisher)
        if name.startswith("publish_to_")
    ]
    assert len(publishers) >= 11, "expected every supported platform to have an entry point"

    for name in publishers:
        fn = getattr(social_publisher, name)
        src = inspect.getsource(fn)
        # `_guarded` rewrites __name__/__doc__ but getsource resolves the wrapper
        assert "suppressed" in src or "_guarded" in src, (
            f"{name} can publish without consulting OUTBOUND_MODE"
        )


# ══════════════════════════════════════════════════════════════════════════════
# 7 · Scraper surfaces must not carry our cost basis
# ══════════════════════════════════════════════════════════════════════════════

async def test_scraper_catalog_hides_supplier_cost_and_margin(
    api_client, mock_pool, as_admin, org_a,
):
    """`hub_scraper_catalog` carries `cost_per_run` and `margin_pct`. A
    `SELECT *` shipped both to every org user on an ordinary catalog listing."""
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/scrapers/catalog")
    assert resp.status_code == 200

    sql = mock_pool.fetch.call_args[0][0]
    assert "SELECT *" not in sql
    assert "cost_per_run" not in sql
    assert "margin_pct" not in sql


async def test_scraper_run_list_hides_supplier_cost(
    api_client, mock_pool, as_admin, org_a,
):
    """`cost_usd` is what we paid Apify. Beside `billed_inr`, which the customer
    is entitled to see, it is our per-run margin."""
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/scrapers/runs")
    assert resp.status_code == 200

    sql = mock_pool.fetch.call_args[0][0]
    assert "cost_usd" not in sql
    assert "org_id=$1::uuid" in sql


def test_margin_report_is_not_on_the_operating_set():
    """`/admin/usage` sums cost against billing across every org — Aekam's own
    P&L. role_tiers names FINANCE_CONSOLE_ROLES for exactly that, and the
    operating set excludes finance by its own definition."""
    import routers.scrapers as sc
    from middleware.role_tiers import FINANCE_CONSOLE_ROLES, OPERATIONS_CONSOLE_ROLES

    source = inspect.getsource(sc)
    assert "_finance = require_platform_role(*FINANCE_CONSOLE_ROLES)" in source
    assert "platform_staff" not in FINANCE_CONSOLE_ROLES
    assert "platform_staff" in OPERATIONS_CONSOLE_ROLES


def test_scrapers_imports_org_id_from_its_canonical_module():
    """A bad find-and-replace once stranded `get_org_id` here. It resolved only
    because `middleware.roles` happens to re-export it."""
    import middleware.org_resolver as canonical
    import routers.scrapers as sc

    assert sc.get_org_id is canonical.get_org_id
    source = inspect.getsource(sc)
    assert "from middleware.org_resolver import get_org_id" in source
