"""Phase 7.5 — the Mappls Static Key, and the credential it is NOT.

This file used to hold 61 tests about minting an OAuth token, caching it, and
skewing its expiry. Every one of them tested a mechanism Mappls retired in
August 2025, and they all passed, for months, while the map stayed blank. That
is the fact this rewrite is written against: **a green suite over the wrong
credential is not evidence of anything.**

What actually happened, proved live on 2026-08-27 rather than inferred: the
post-2025 SDK host answers our real minted token and a randomly generated fake
string byte-identically (`Token was not recognised`). The credential for the Web
Map SDK is the console's **Static Key**, passed as the `access_token` QUERY
parameter to `sdk.mappls.com/map/sdk/web`. The OAuth pair still sits on Railway
minting perfectly useless tokens.

So the assertions here aim at the mistakes that actually happened:

  1. THE KEY IS IN THE QUERY, NOT THE PATH. Asserted with `urlparse`/`parse_qs`,
     never as a substring — `"key" in url` passes identically on the working
     form and on the dead `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk` one,
     which is precisely the check that would have caught nothing.

  2. NOT_CONFIGURED IS NOT AN OUTAGE. Same discipline as `pin_boundaries`'
     `unmatched` vs `unavailable`: collapsing them tells a customer the map is
     broken when the feature was simply never switched on, and they file a fault
     against working software.

  3. A BLANK IS ABSENT. A Railway variable set to nothing reads back as `''`. An
     empty key would go into the SDK URL, be refused by Mappls, and be reported
     in the browser as the provider's failure. It is ours.

  4. THE KEY IS A CREDENTIAL WITH NO EXPIRY, SERVED TO A BROWSER. So the route
     must keep requiring a signed-in user, and must never carry the OAuth
     secret. Both are asserted through HTTP.

── NOTHING HERE TOUCHES THE NETWORK, AND NOW IT CANNOT ──────────────────────

The old file ran a scripted `httpx.MockTransport` in front of the real client so
that a request the service built was a request a real client serialised. There
is no request left to build: `services/mappls.py` no longer imports `httpx`. The
absence of any transport fixture in this file is therefore a statement about the
module, not an omission — and it is why the suite can never mint against a live
endpoint whose call counts are contractually billable (memory
`mappls_licence_and_map_market`).
"""
from __future__ import annotations

import inspect
from urllib.parse import parse_qs, urlparse

import pytest

from services import mappls

KEY = "static-key-abcdef123456"
CLIENT_SECRET = "test-client-secret-never-served"

CALLER = {
    "user_id": "user_admin001",
    "email": "admin@test.com",
    "name": "Test Admin",
    "full_name": "Test Admin",
    "role": "admin",
}


@pytest.fixture
def configured(monkeypatch):
    """A Static Key present, as it is on Railway once the owner sets it."""
    monkeypatch.setenv("MAPPLS_STATIC_KEY", KEY)
    # The OAuth pair is STILL SET alongside it, exactly as on Railway. Every
    # "configured" test therefore also proves the pair is inert: if anything
    # were still reading it, these tests would be the ones to say so.
    monkeypatch.setenv("MAPPLS_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)


@pytest.fixture
def unconfigured(monkeypatch):
    """No Static Key — a local checkout, or a preview deploy.

    The OAuth pair is left SET on purpose. This is the state Railway was in all
    along, and it is the state that produced the whole misdiagnosis: credentials
    present, map dead. `not_configured` must be the answer, because with respect
    to the credential that matters this environment is not configured.
    """
    monkeypatch.delenv("MAPPLS_STATIC_KEY", raising=False)
    monkeypatch.setenv("MAPPLS_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)


# ══════════════════════════════════════════════════════════════════════════════
#  1 · static_key — present, absent, and the blank that is absent
# ══════════════════════════════════════════════════════════════════════════════

def test_a_real_key_is_returned_and_the_environment_is_configured(configured):
    assert mappls.static_key() == KEY
    assert mappls.is_configured() is True


def test_no_key_at_all_is_none_and_not_configured(unconfigured):
    """The OAuth pair is set in this fixture and it changes nothing. A holder of
    `MAPPLS_CLIENT_ID`/`SECRET` and no Static Key has no basemap."""
    assert mappls.static_key() is None
    assert mappls.is_configured() is False


@pytest.mark.parametrize("blank", ["", " ", "   ", "\t", "\n", " \t\n "])
def test_a_blank_key_is_absent_not_a_credential(blank, monkeypatch):
    """THE CASE THAT WOULD HAVE BEEN BLAMED ON MAPPLS.

    A Railway variable set to nothing reads back as `''`, and a whitespace one
    is what a paste out of a console leaves behind. A bare truthiness check
    calls both configured; the key then goes into the SDK URL, Mappls refuses
    it, and the browser reports a provider fault for our missing configuration.
    `not_configured` is the reason that sends a person to Railway — where the
    fix actually is — and it only fires if a blank counts as absent.
    """
    monkeypatch.setenv("MAPPLS_STATIC_KEY", blank)
    assert mappls.static_key() is None
    assert mappls.is_configured() is False


def test_surrounding_whitespace_is_stripped_from_a_real_key(monkeypatch):
    """A trailing newline out of a copy-paste is invisible in the console and
    fatal in a URL: it would be percent-encoded into the query and the key would
    not match. Stripping is not cosmetic here."""
    monkeypatch.setenv("MAPPLS_STATIC_KEY", f"  {KEY}\n")
    assert mappls.static_key() == KEY


# ══════════════════════════════════════════════════════════════════════════════
#  2 · the SDK URL — the fact that cost months, asserted as a parsed URL
# ══════════════════════════════════════════════════════════════════════════════

def test_the_key_goes_in_the_access_token_query_parameter():
    """The post-August-2025 form, from Mappls' own `mappls-web-maps-js` README:

        <script src="https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=KEY">

    Parsed, not substring-matched. Every component of it is asserted because
    each one changed: the host (`apis.` -> `sdk.`), the path
    (`/advancedmaps/api/{KEY}/map_sdk` -> `/map/sdk/web`), and the place the
    credential sits (path segment -> query parameter).
    """
    parts = urlparse(mappls.sdk_url(KEY))
    query = parse_qs(parts.query)

    assert parts.scheme == "https"
    assert parts.netloc == "sdk.mappls.com"
    assert parts.path == "/map/sdk/web"
    assert query["access_token"] == [KEY]
    assert query["v"] == ["3.0"], "v3 is the vector SDK the frontend expects"


def test_the_key_never_appears_in_the_url_path():
    """The complement of the test above, and the one that bites.

    A substring check for the key passes on BOTH forms — that is exactly why the
    dead URL survived review. The difference between working and dead is
    structural: in the new form the path is constant and the credential is a
    query argument, so a key found anywhere in the path means the old shape has
    come back.
    """
    parts = urlparse(mappls.sdk_url(KEY))

    assert KEY not in parts.path, "the key is in the path — this is the dead form"
    assert KEY not in parts.netloc
    assert "advancedmaps" not in parts.path
    assert "map_sdk" not in parts.path


def test_the_sdk_url_is_not_the_legacy_form():
    """REGRESSION GUARD, NAMED FOR THE REASON.

    `LEGACY_SDK_URL_TEMPLATE` is kept in the module as documentation so nobody
    reinvents it after finding the OAuth pair. Documentation that something can
    accidentally be wired back to is a trap, so this states the relationship
    between the two constants: they must never converge.

    The legacy pair (path URL + minted OAuth token) is not "an older way that
    still works". Its host cannot distinguish our real token from a random
    string, proved live 2026-08-27.
    """
    live = mappls.sdk_url(KEY)
    legacy = mappls.LEGACY_SDK_URL_TEMPLATE.format(token=KEY)

    assert live != legacy
    assert urlparse(live).netloc != urlparse(legacy).netloc
    assert urlparse(legacy).path.endswith("/map_sdk"), (
        "the legacy constant no longer documents the legacy form")
    assert "layer=vector" not in live, (
        "the new SDK form takes no layer parameter; v3 is vector")


def test_the_sdk_url_is_defined_once():
    """Served to the browser rather than composed there, so that when Mappls
    next changes it — and it has changed once already — there is ONE place that
    is wrong instead of one per screen."""
    assert "{key}" in mappls.SDK_URL_TEMPLATE
    assert mappls.sdk_url("abc") == mappls.SDK_URL_TEMPLATE.format(key="abc")


def test_the_oauth_endpoint_is_documented_and_unreachable_from_here():
    """`TOKEN_URL` stays as evidence; the code that used it does not.

    The minting path (`access_token`, `_mint`, the token cache, the skew) was
    removed once the Static Key landed, because this codebase has a documented
    history of dead code surviving on "it might be useful" — twenty dead tables,
    dropped in migration 234. If one of these names is being re-added, note that
    the credential behind it was proved non-functional against every allocated
    Mappls product on 2026-08-27, and read the module docstring first.
    """
    assert mappls.TOKEN_URL.startswith("https://outpost.mappls.com/")

    src = inspect.getsource(mappls)
    assert "import httpx" not in src, "the module reached the network again"
    for gone in ("async def access_token", "def _mint(", "def reset_cache",
                 "_SKEW_SECONDS", "_mint_lock"):
        assert gone not in src, f"the retired OAuth minting is back: {gone}"


# ══════════════════════════════════════════════════════════════════════════════
#  3 · the router — always 200, and the reason says which
# ══════════════════════════════════════════════════════════════════════════════
#
# A LOCAL app rather than `server.app`, so this file owns the whole dependency
# graph of the one route it is about. It is wired the way the app wires it — the
# same limiter singleton, so the 30/minute on this route is the real one and the
# autouse `reset_rate_limits` fixture in conftest still empties it between
# tests. `app.state.limiter` is not optional: slowapi reads the limiter off the
# app state inside the decorator's wrapper and raises without it. Same shape as
# `tests/test_custody_router.py`.

def _build_app(*, authenticated: bool):
    from fastapi import FastAPI
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    from auth_router import require_user
    from limiter import limiter
    from routers import maps as maps_mod

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(maps_mod.router)
    if authenticated:
        app.dependency_overrides[require_user] = lambda: CALLER
    return app


@pytest.fixture
async def mc():
    """A signed-in caller."""
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(transport=ASGITransport(app=_build_app(authenticated=True)),
                           base_url="http://test") as client:
        yield client


@pytest.fixture
async def anon():
    """No override, so the REAL `require_user` runs and finds no bearer token.

    It raises 401 before it asks for a pool, so this fixture reaches no database
    — which matters, because staging and production share one (memory
    `feedback_shared_db_risk`).
    """
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(transport=ASGITransport(app=_build_app(authenticated=False)),
                           base_url="http://test") as client:
        yield client


async def test_the_route_is_registered_on_the_real_app():
    """`routers/support_sessions.py` is the standing example of what happens
    when nobody adds the include: 401 complete lines, unreachable for weeks.
    Checked against the source rather than the route table so that a router
    mounted under a different prefix still counts as unregistered."""
    import server
    assert "app.include_router(maps_router)" in inspect.getsource(server)


async def test_configured_answers_a_key_and_the_sdk_url(mc, configured):
    resp = await mc.get("/api/v1/maps/token")

    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is True
    assert data["reason"] is None
    assert data["token"] == KEY
    assert data["sdk_url"] == mappls.sdk_url(KEY)
    # Restated through HTTP, because this is the byte the browser puts in a
    # <script src>: the key must arrive as a query argument, not a path segment.
    assert parse_qs(urlparse(data["sdk_url"]).query)["access_token"] == [KEY]


async def test_not_configured_is_200_with_a_reason_not_a_4xx(mc, unconfigured):
    """ALWAYS 200 — the same choice as `GET /territories/{id}/geometry` in
    Phase 7.3.

    A 4xx here collapses "this environment has no map" into "something went
    wrong", and the browser's only evidence is a red console line. The screen
    has to be able to say "the map is not switched on here" plainly and go on to
    show the data it does have, and it can only do that from a body it received.
    """
    resp = await mc.get("/api/v1/maps/token")

    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is False
    assert data["reason"] == mappls.NOT_CONFIGURED == "not_configured"
    assert "token" not in data and "sdk_url" not in data, (
        "a null token field invites a frontend to build an SDK URL out of it")


@pytest.mark.parametrize("blank", ["", "   "])
async def test_a_blank_key_reaches_the_endpoint_as_not_configured(blank, mc,
                                                                  monkeypatch):
    """The blank rule through the surface a customer touches. Without it the
    endpoint hands the browser `access_token=` and the resulting failure is
    reported from inside Mappls' SDK, where we cannot see it."""
    monkeypatch.setenv("MAPPLS_STATIC_KEY", blank)

    data = (await mc.get("/api/v1/maps/token")).json()
    assert (data["available"], data["reason"]) == (False, mappls.NOT_CONFIGURED)


@pytest.mark.parametrize("state", ["configured", "not_configured"])
async def test_attribution_travels_with_every_answer_including_the_failure(
        state, mc, monkeypatch):
    """"Powered by Mappls" must be "clearly presented" and may "in no instance"
    be removed — and it is a LOGO, not a text credit, which is why the frontend
    draws the mark and this response carries its accessible name and its link.

    It ships on the not-configured answer too, on purpose: a screen holding a
    cached basemap must never be able to reach a state where it has a map and no
    attribution because the refresh came back empty. The GODL boundary credit is
    a DIFFERENT credit for a different dataset; neither covers the other.
    """
    if state == "configured":
        monkeypatch.setenv("MAPPLS_STATIC_KEY", KEY)
    else:
        monkeypatch.delenv("MAPPLS_STATIC_KEY", raising=False)

    data = (await mc.get("/api/v1/maps/token")).json()

    assert data["attribution"] == mappls.BASEMAP_ATTRIBUTION == "Powered by Mappls"
    assert data["attribution_href"] == mappls.BASEMAP_ATTRIBUTION_HREF
    assert data["attribution_href"].startswith("https://")


async def test_the_response_carries_no_expires_at(mc, configured):
    """A STATIC KEY DOES NOT EXPIRE, AND THE RESPONSE MAY NOT IMPLY OTHERWISE.

    The field is omitted rather than set to null: a frontend reading `null` can
    equally decide "never expires" or "we forgot to say", and one of those two
    readings caches a credential for ever. Absent is unambiguous.

    A leftover `expires_at` would also be a lie of the most expensive kind here
    — it would describe the OAuth token, which is the credential this whole
    feature just proved does not work.
    """
    data = (await mc.get("/api/v1/maps/token")).json()

    assert "expires_at" not in data
    assert "expires_in" not in data
    assert not any("expir" in k for k in data), sorted(data)


@pytest.mark.parametrize("state", ["configured", "not_configured"])
async def test_the_endpoint_never_reports_unavailable(state, mc, monkeypatch):
    """With the minting gone there is no round trip left to fail, so this
    endpoint answers a key or `not_configured` and nothing else.

    `UNAVAILABLE` survives in the module because the browser still needs the
    word — `frontend/src/lib/mapplsSdk.js` exports `MAP_DOWN = 'unavailable'`
    and falls back to it when the FETCH of this endpoint fails or the SDK script
    will not load. What must not happen is the backend emitting it: that would
    send a person to Mappls' status page for a variable that is missing on
    Railway, which is the wrong half of the country.
    """
    if state == "configured":
        monkeypatch.setenv("MAPPLS_STATIC_KEY", KEY)
    else:
        monkeypatch.delenv("MAPPLS_STATIC_KEY", raising=False)

    data = (await mc.get("/api/v1/maps/token")).json()
    assert data["reason"] in (None, mappls.NOT_CONFIGURED)
    assert data["reason"] != mappls.UNAVAILABLE


async def test_the_response_never_carries_the_oauth_secret(mc, configured):
    """The Static Key is billable and visible in the network tab — accepted, and
    unavoidable for a client-side SDK. The OAuth PAIR is a different matter: it
    is useless to Mappls today, but it is still a live secret on Railway, and
    "the credential that does not work" is not a reason to let it leak."""
    text = (await mc.get("/api/v1/maps/token")).text

    assert CLIENT_SECRET not in text
    assert "test-client-id" not in text


# ══════════════════════════════════════════════════════════════════════════════
#  4 · the two controls we own over a credential that cannot expire
# ══════════════════════════════════════════════════════════════════════════════

async def test_an_anonymous_caller_gets_no_key(anon, configured):
    """THE KEY NEVER EXPIRES AND THE BROWSER CAN READ IT.

    Rotation is the only revocation, so the controls that remain are the
    console's domain whitelist (theirs) and these two (ours): a signed-in user,
    and a rate limit. An unauthenticated endpoint here is a permanent credential
    published on the open internet — worse than the `VITE_MAPPLS_KEY` this
    design replaced, not better, since a bundled key at least ships only to
    people who load our app.
    """
    resp = await anon.get("/api/v1/maps/token")

    assert resp.status_code == 401
    assert KEY not in resp.text


async def test_the_route_is_rate_limited(mc):
    """One account may not scrape the endpoint at speed. Asserted on the
    decorator rather than by spending 30 requests: the budget is shared through
    the limiter singleton, and a test that exhausts it deliberately makes an
    unrelated test in another file fail (see conftest's `reset_rate_limits`).

    `request: Request` is asserted too — slowapi reads the client address off
    it, and a handler that drops the parameter silently loses its limit.
    """
    from routers import maps as maps_mod

    src = inspect.getsource(maps_mod)
    assert "@limiter.limit(" in src
    assert "request" in inspect.signature(maps_mod.mappls_token).parameters
