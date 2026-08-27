"""Phase 7.5 — the Mappls token, and the two ways of having none.

`TerritoryMap.jsx` said "the territory map needs a MapMyIndia key" from
2026-08-09 to 2026-08-27 and the sentence was false the whole time: the OAuth
pair has been on Railway minting tokens, and the component was reading a
frontend build-time variable nobody ever bought (memory
`mappls_credentials_exist`). Two credentials were confused, and a URL that died
in Aug 2025 was read as a credential fault for months.

That is the history this file is written against, so the assertions are aimed
at the mistakes that actually happened rather than at the code's shape:

  1. NOT_CONFIGURED IS NOT AN OUTAGE. Same discipline as
     `services/pin_boundaries.py`'s `unmatched` vs `unavailable`: collapsing the
     two tells a customer the map is broken when the feature was simply never
     switched on, and they go and file a fault against working software. Every
     failure test below asserts on the reason it got AND on the one it did not.

  2. A BLANK IS ABSENT. `os.getenv` returning `''` is what a Railway variable
     set to nothing looks like. An empty client_id would be POSTed to Mappls,
     answered 401, and reported as UNAVAILABLE — i.e. as their outage. It is
     ours.

  3. A FAILURE IS NEVER CACHED. `pin_boundaries` carries the same rule for the
     same reason: a cached outage outlives the outage, and the next request is
     the one that would have worked.

  4. THE SDK URL EMBEDS THE TOKEN IN THE PATH. The dead form —
     `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk` — is the single most
     expensive fact in this feature's history. It is asserted here as a URL
     rather than trusted as a constant.

── WHY THE HTTP IS SCRIPTED AND COUNTED, NOT MOCKED ─────────────────────────

`httpx.MockTransport` in front of the REAL `httpx.AsyncClient`, so the request
the service builds is a real request that a real client serialises — a
MagicMock would answer happily to a form body Mappls would reject, which is the
same failure mode as a mock pool answering happily to a column that is not
there (memory `mock_pool_hides_bad_sql`). Every answer is scripted and every
request is recorded, because half of what matters here is a round trip that did
NOT happen: the cache is a correctness property and "one request, not two" is
the only way to state it.

── WHAT THIS FILE DELIBERATELY DOES NOT DO ──────────────────────────────────

It never mints against the live Mappls endpoint. Mappls' console counts calls
and its usage statistics are contractually binding (memory
`mappls_licence_and_map_market`), so a suite that mints on every run is a bill
that grows with CI, not a test.
"""
from __future__ import annotations

import inspect
import logging
import time

import httpx
import pytest

from services import mappls

CLIENT_ID = "test-client-id"
CLIENT_SECRET = "test-client-secret-never-logged"

CALLER = {
    "user_id": "user_admin001",
    "email": "admin@test.com",
    "name": "Test Admin",
    "full_name": "Test Admin",
    "role": "admin",
}


# ── the scripted outpost ─────────────────────────────────────────────────────
#
# Answers are FACTORIES, not `httpx.Response` objects: a Response's body may be
# read once, and half the tests here send the same answer twice on purpose.

def ok(token: str = "tok-live-1", expires_in=86399):
    """A mint that succeeded, shaped like the live one.

    `expires_in` 86399 and `scope` READ are what the real endpoint returned on
    2026-08-27. Pass `expires_in=...` to say something else; pass the sentinel
    `_ABSENT` to leave the field out altogether.
    """
    payload = {"access_token": token, "scope": "READ", "token_type": "bearer"}
    if expires_in is not _ABSENT:
        payload["expires_in"] = expires_in
    return lambda: httpx.Response(200, json=payload)


def status(code: int, text: str = "invalid_client"):
    return lambda: httpx.Response(code, text=text)


def body(text: str):
    """HTTP 200 with something that is not JSON — a proxy's error page."""
    return lambda: httpx.Response(200, text=text)


def payload(**fields):
    """HTTP 200, valid JSON, and whatever fields the test wants it to hold."""
    return lambda: httpx.Response(200, json=fields)


_ABSENT = object()


class _Outpost:
    """A stand-in for Mappls' OAuth endpoint. Scripted answers, counted calls.

    The script's LAST entry repeats for ever, so a test that wants "and then it
    keeps working" writes one answer and a test that wants "it failed, then it
    worked" writes two.
    """

    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.script = [ok()]

    def answer(self, *responses):
        assert responses, "an outpost with no answers cannot be scripted"
        self.script = list(responses)

    @property
    def calls(self) -> int:
        return len(self.requests)

    def forms(self) -> list[dict]:
        """Each request's form body, parsed back out of the wire bytes."""
        from urllib.parse import parse_qs
        return [{k: v[0] for k, v in
                 parse_qs(r.content.decode()).items()} for r in self.requests]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        return answer()


@pytest.fixture
def outpost(monkeypatch):
    """Installs the scripted endpoint and clears the module-level cache.

    Cleared on BOTH sides: `_cached` outlives any one test, and a token another
    test minted would answer a question this one never asked — the same hazard
    `pin_boundaries`' shard cache carries, and the reason `reset_cache()` is
    part of the service's public surface.

    `transport` is a `setdefault` rather than an override because patching
    `mappls.httpx` patches the ONE httpx module object every import shares:
    without it, the ASGI client the router tests build would be handed two
    transports and die on a duplicate keyword instead of a defect.
    """
    mappls.reset_cache()
    scripted = _Outpost()
    real_client = httpx.AsyncClient

    def _client(*args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(scripted))
        return real_client(*args, **kwargs)

    monkeypatch.setattr(mappls.httpx, "AsyncClient", _client)
    yield scripted
    mappls.reset_cache()


@pytest.fixture
def configured(monkeypatch):
    """The credential pair present, as it is on Railway."""
    monkeypatch.setenv("MAPPLS_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)


@pytest.fixture
def unconfigured(monkeypatch):
    """No pair at all — a local checkout, or a preview deploy."""
    monkeypatch.delenv("MAPPLS_CLIENT_ID", raising=False)
    monkeypatch.delenv("MAPPLS_CLIENT_SECRET", raising=False)


# ══════════════════════════════════════════════════════════════════════════════
#  1 · not_configured — an environment that was never given the pair
# ══════════════════════════════════════════════════════════════════════════════

def test_no_credentials_at_all_is_not_configured(unconfigured):
    assert mappls.is_configured() is False


@pytest.mark.parametrize("present, missing", [
    ("MAPPLS_CLIENT_ID", "MAPPLS_CLIENT_SECRET"),
    ("MAPPLS_CLIENT_SECRET", "MAPPLS_CLIENT_ID"),
])
def test_half_a_pair_is_not_a_pair(present, missing, monkeypatch, unconfigured):
    """Either half alone mints nothing, so either half alone is NOT_CONFIGURED.

    Both directions, because a half-set environment is what a Railway variable
    added under the wrong name looks like, and the two names differ by five
    characters.
    """
    monkeypatch.setenv(present, "something")
    assert mappls.is_configured() is False


@pytest.mark.parametrize("blank", ["", "   ", "\t", "\n"])
def test_a_blank_credential_is_absent_not_a_credential(blank, monkeypatch):
    """THE CASE THAT WOULD HAVE BEEN BLAMED ON MAPPLS.

    A Railway variable set to nothing reads back as `''`, and a bare truthiness
    check on `os.getenv` would call that configured. The pair would then be
    POSTed — an empty client_id — Mappls would answer 401, and the service would
    report UNAVAILABLE: their outage. It is ours, and `unavailable` is the one
    reason that says "go and look at the provider".
    """
    monkeypatch.setenv("MAPPLS_CLIENT_ID", blank)
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)
    assert mappls.is_configured() is False

    monkeypatch.setenv("MAPPLS_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", blank)
    assert mappls.is_configured() is False


def test_a_real_pair_is_configured(configured):
    assert mappls.is_configured() is True


async def test_not_configured_never_reaches_the_network(outpost, unconfigured):
    """No pair, no request. Asserted on the CALL COUNT, not just the reason:
    an environment with no credentials that still opens a socket to Mappls on
    every page load is a timeout budget spent on a foregone conclusion.
    """
    tok = await mappls.access_token()

    assert tok.ok is False
    assert tok.reason == mappls.NOT_CONFIGURED
    assert tok.reason != mappls.UNAVAILABLE, "an unset environment is not an outage"
    assert tok.token is None and tok.expires_at is None
    assert outpost.calls == 0


@pytest.mark.parametrize("blank", ["", "  "])
async def test_a_blank_pair_is_not_configured_end_to_end(blank, outpost, monkeypatch):
    """The same rule as `is_configured`, through the path that would spend the
    money: nothing is POSTed, so nothing can be 401'd and misreported."""
    monkeypatch.setenv("MAPPLS_CLIENT_ID", blank)
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", blank)

    tok = await mappls.access_token()
    assert (tok.reason, outpost.calls) == (mappls.NOT_CONFIGURED, 0)


# ══════════════════════════════════════════════════════════════════════════════
#  2 · a mint that works, and the cache that is a correctness rule
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_successful_mint_returns_a_token_and_an_absolute_expiry(
        outpost, configured):
    outpost.answer(ok("tok-abc", expires_in=86399))
    tok = await mappls.access_token()

    assert tok.ok is True
    assert tok.token == "tok-abc"
    assert tok.reason is None, "an ok Token carries no reason — never both"
    # `expires_at` is EPOCH SECONDS, not a duration: the browser is handed it
    # and has to compare it against its own clock.
    assert tok.expires_at == pytest.approx(time.time() + 86399, abs=5)


async def test_the_mint_posts_the_client_credentials_grant(outpost, configured):
    """The form Mappls actually answers, checked on the wire rather than in the
    source. A grant type it does not recognise is a 400 that reads exactly like
    a revoked credential."""
    await mappls.access_token()

    assert outpost.calls == 1
    request = outpost.requests[0]
    assert str(request.url) == mappls.TOKEN_URL
    assert request.method == "POST"
    assert outpost.forms()[0] == {
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }


async def test_two_calls_mint_one_token(outpost, configured):
    """THE CACHE, STATED AS A REQUEST COUNT.

    Asserting only that both calls returned the same string would pass against a
    service that re-minted every time and happened to be handed the same fixture
    token twice. The property is the round trip that did not happen: `expires_in`
    is ~24h, and a mint per page load is a person waiting on a network hop for a
    credential we already hold.
    """
    outpost.answer(ok("tok-first"), ok("tok-second"))

    first = await mappls.access_token()
    second = await mappls.access_token()

    assert outpost.calls == 1, "the second call re-minted a token it already had"
    assert first.token == second.token == "tok-first"
    assert second.expires_at == first.expires_at


async def test_a_failure_is_never_cached(outpost, configured):
    """Same rule as `pin_boundaries`: an outage clears on the next request, not
    on the next deploy.

    A cached `None` would keep the map dark for as long as the worker lives —
    and the worker outlives the outage. The second call MUST issue a second
    request, which is why the count is asserted and not only the outcome.
    """
    outpost.answer(status(503, "upstream unavailable"), ok("tok-after-outage"))

    failed = await mappls.access_token()
    assert failed.reason == mappls.UNAVAILABLE
    assert mappls._cached is None, "the failure was written into the cache"

    recovered = await mappls.access_token()
    assert recovered.ok is True
    assert recovered.token == "tok-after-outage"
    assert outpost.calls == 2, "the outage was cached and the retry never happened"


async def test_a_recovered_token_is_then_cached_like_any_other(outpost, configured):
    """The recovery is not a special case that bypasses the cache on the way
    back in — otherwise every request after an outage keeps minting."""
    outpost.answer(status(500), ok("tok-recovered"))

    await mappls.access_token()
    await mappls.access_token()
    await mappls.access_token()

    assert outpost.calls == 2


# ══════════════════════════════════════════════════════════════════════════════
#  3 · unavailable — we hold credentials and Mappls did not give us a token
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("answer, why", [
    (status(401, "invalid_client"), "a revoked or wrong credential"),
    (status(403, "forbidden"), "a scope withdrawn"),
    (status(429, "rate limited"), "their throttle, which is transient"),
    (status(500, "internal error"), "their outage"),
    (status(502, "<html>bad gateway</html>"), "a proxy in front of them"),
])
async def test_a_non_200_is_unavailable_and_never_a_token(answer, why, outpost,
                                                          configured):
    """Every failure is one reason on purpose: the caller's only decision is
    "is there a token", and a taxonomy of statuses here is a taxonomy nothing
    reads. What must never happen is a Token that is neither ok nor honest.
    """
    outpost.answer(answer)
    tok = await mappls.access_token()

    assert tok.ok is False, f"{why} produced a token"
    assert tok.reason == mappls.UNAVAILABLE
    assert tok.reason != mappls.NOT_CONFIGURED, (
        "a provider failure was reported as 'this environment has no map' — the "
        "sentence that sends a customer to change settings that are correct")
    assert tok.token is None and tok.expires_at is None


@pytest.mark.parametrize("text", [
    "<html><body>504 Gateway Time-out</body></html>",   # a proxy, not Mappls
    "",                                                 # 200 and nothing at all
    "access_token=abc",                                 # form-encoded, not JSON
])
async def test_a_200_that_is_not_json_is_unavailable_not_a_crash(text, outpost,
                                                                 configured):
    """A captive portal, a WAF and a misconfigured gateway all answer 200 with
    HTML. `resp.json()` raises on each, and an exception here is a 500 on a page
    whose map is one panel."""
    outpost.answer(body(text))
    tok = await mappls.access_token()
    assert (tok.ok, tok.reason) == (False, mappls.UNAVAILABLE)


@pytest.mark.parametrize("fields", [
    {},                                          # 200, JSON, empty object
    {"scope": "READ", "expires_in": 86399},      # everything but the token
    {"access_token": None},
    {"access_token": ""},                        # present and empty
    {"access_token": 12345},                     # present and not a string
    {"access_token": {"value": "x"}},
    {"error": "invalid_client"},                 # their 200-with-an-error shape
])
async def test_a_200_with_no_usable_access_token_is_unavailable(fields, outpost,
                                                               configured):
    """`""` and `12345` are the two that a bare `if "access_token" in payload`
    would let through, and both reach the browser as an SDK URL with rubbish in
    the path — which renders as a blank panel and no error anywhere we can see.
    """
    outpost.answer(payload(**fields))
    tok = await mappls.access_token()

    assert tok.ok is False
    assert tok.token is None, "a bogus token was handed out as if it were real"
    assert tok.reason == mappls.UNAVAILABLE


async def test_a_network_failure_is_unavailable_rather_than_an_exception(
        outpost, configured, monkeypatch):
    """DNS, a reset, or the 8-second timeout expiring. The map is one panel on a
    page; it may not take the page down with it."""
    def _raises(request):
        raise httpx.ConnectError("[Errno -2] Name or service not known")

    monkeypatch.setattr(
        mappls.httpx, "AsyncClient",
        lambda *a, **kw: httpx.AsyncClient(
            *a, **{**kw, "transport": httpx.MockTransport(_raises)}))

    tok = await mappls.access_token()
    assert (tok.ok, tok.reason) == (False, mappls.UNAVAILABLE)


# ══════════════════════════════════════════════════════════════════════════════
#  4 · expires_in — honoured when sane, an hour when not, never forever
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_sane_expires_in_is_honoured(outpost, configured):
    outpost.answer(ok(expires_in=7200))
    tok = await mappls.access_token()
    assert tok.expires_at == pytest.approx(time.time() + 7200, abs=5)


async def test_a_numeric_string_is_still_a_number(outpost, configured):
    """JSON says numbers; a provider that quotes them is common enough that
    refusing the value would throw away a perfectly good 24-hour token."""
    outpost.answer(ok(expires_in="7200"))
    tok = await mappls.access_token()
    assert tok.expires_at == pytest.approx(time.time() + 7200, abs=5)


@pytest.mark.parametrize("value, what", [
    (_ABSENT, "the field is not there at all"),
    (None, "present and null"),
    (0, "zero — a token that is already dead"),
    (-1, "negative"),
    ("soon", "a word, which float() refuses"),
    ("", "an empty string"),
    ([86399], "a list, which float() refuses with TypeError not ValueError"),
    (86400 * 8, "over a week — longer than the credential we minted it with"),
])
async def test_an_unusable_expires_in_falls_back_to_an_hour_not_to_forever(
        value, what, outpost, configured):
    """THE FALLBACK IS DOWNWARD, AND THAT IS THE WHOLE POINT.

    The cost of re-minting an hour early is one request. The cost of trusting a
    bad number upward is a browser holding a dead token with no way to tell us —
    the SDK fails inside somebody else's page and we never see it.
    """
    outpost.answer(ok(expires_in=value))
    tok = await mappls.access_token()

    assert tok.ok is True, f"{what} was treated as a failed mint"
    assert tok.expires_at == pytest.approx(time.time() + 3600, abs=5), (
        f"{what} did not fall back to an hour")


async def test_infinity_is_an_hour_and_not_forever(outpost, configured):
    """`Infinity` is not legal JSON, and it is exactly what a lenient encoder
    emits for a value nothing bounded — so it arrives as a raw body rather than
    through the fixture's `json=`, whose encoder refuses to write it.

    Python's `json.loads` accepts it, `float()` accepts it, and `0 < inf <=
    86400*7` is False. It is the literal form of "this token never expires",
    which is the one thing a cached credential must never be told.
    """
    outpost.answer(body('{"access_token": "tok-forever", "expires_in": Infinity}'))
    tok = await mappls.access_token()

    assert tok.ok is True
    assert tok.expires_at == pytest.approx(time.time() + 3600, abs=5)


async def test_a_token_inside_the_skew_window_is_re_minted_not_handed_out(
        outpost, configured):
    """A token that expires while the SDK is still loading fails in the browser,
    where we cannot see it. So the cache hands back only tokens with real life
    left in them — `_SKEW_SECONDS` of it.

    The cached entry is planted directly rather than aged, because the
    alternative is a test that sleeps for five minutes.
    """
    mappls._cached = ("tok-nearly-dead", time.time() + mappls._SKEW_SECONDS - 1)
    outpost.answer(ok("tok-fresh"))

    tok = await mappls.access_token()
    assert tok.token == "tok-fresh", "a token inside the skew window was served"
    assert outpost.calls == 1


async def test_a_token_just_outside_the_skew_window_is_still_served(
        outpost, configured):
    """The other side of the same boundary. Without this, a skew of "always
    re-mint" would pass the test above and mint on every single request."""
    alive_until = time.time() + mappls._SKEW_SECONDS + 60
    mappls._cached = ("tok-still-good", alive_until)

    tok = await mappls.access_token()
    assert tok.token == "tok-still-good"
    assert tok.expires_at == alive_until
    assert outpost.calls == 0


async def test_an_expired_cache_with_no_credentials_is_not_configured(
        outpost, unconfigured):
    """The order of the two checks, pinned: a stale cache must not turn an
    unconfigured environment into an outage on its way past."""
    mappls._cached = ("tok-long-dead", time.time() - 10_000)
    tok = await mappls.access_token()
    assert (tok.reason, outpost.calls) == (mappls.NOT_CONFIGURED, 0)


# ══════════════════════════════════════════════════════════════════════════════
#  5 · the SDK URL — the fact that cost months
# ══════════════════════════════════════════════════════════════════════════════

def test_the_token_goes_in_the_path_and_not_in_a_query_parameter():
    """`apis.mappls.com/advancedmaps/api/{KEY}/map_sdk` HAS BEEN DEAD SINCE
    AUG 2025 and the component that used it kept saying it needed a key, so a
    URL fault was read as a credential fault for months (memory
    `territory_maps_stack`).

    Asserted as a parsed URL rather than as a substring of the template: the
    difference between the working form and the dead one is where the token
    sits, and `?access_token=` would match a naive "the token is in there
    somewhere" check perfectly.
    """
    from urllib.parse import urlparse, parse_qs

    url = mappls.sdk_url("tok-xyz")
    parts = urlparse(url)

    assert parts.scheme == "https"
    assert parts.netloc == "apis.mappls.com"
    assert parts.path == "/advancedmaps/api/tok-xyz/map_sdk", (
        "the token left the path — this is the shape of the dead URL")
    for values in parse_qs(parts.query).values():
        assert "tok-xyz" not in values, "the token is being passed as a query arg"


def test_the_sdk_url_asks_for_the_vector_layer():
    """`layer=vector&v=3.0` is the Web Map SDK v3 the frontend loads. A raster
    default renders, so this cannot be caught by looking at a screenshot."""
    from urllib.parse import urlparse, parse_qs

    query = parse_qs(urlparse(mappls.sdk_url("t")).query)
    assert query["layer"] == ["vector"]
    assert query["v"] == ["3.0"]


def test_the_sdk_url_is_defined_once():
    """Served to the browser rather than composed there, so that when Mappls
    next changes it there is ONE place that is wrong instead of one per screen.
    """
    assert "{token}" in mappls.SDK_URL_TEMPLATE
    assert mappls.sdk_url("abc") == mappls.SDK_URL_TEMPLATE.format(token="abc")


# ══════════════════════════════════════════════════════════════════════════════
#  6 · the secret must never reach a log
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_failed_mint_logs_the_status_and_not_the_secret(
        outpost, configured, caplog):
    """A leaked token dies in a day; a leaked client secret does not.

    `sentry_scrub.py` redacts the credential NAMES, which does nothing for a
    value pasted into a log line by hand. So the value is asserted absent from
    everything the module emitted — and the status IS asserted present, because
    a log that says nothing is not the safe option either: `unavailable` is the
    reason that means "go and look", and there has to be something to look at.
    """
    caplog.set_level(logging.DEBUG)
    outpost.answer(status(401, "invalid_client"))

    tok = await mappls.access_token()
    assert tok.reason == mappls.UNAVAILABLE

    assert CLIENT_SECRET not in caplog.text, "the client secret reached the log"
    assert "401" in caplog.text, "a mint failure left no trace at all"


async def test_nothing_about_a_successful_mint_names_the_secret_or_the_token(
        outpost, configured, caplog):
    """A response body logged whole would carry the minted token past the
    scrubber. The success path is silent; this is what keeps it that way."""
    caplog.set_level(logging.DEBUG)
    outpost.answer(ok("tok-secret-value"))

    tok = await mappls.access_token()
    assert tok.ok is True
    assert CLIENT_SECRET not in caplog.text
    assert "tok-secret-value" not in caplog.text, "the minted token was logged"


async def test_a_not_configured_answer_logs_no_error(outpost, unconfigured, caplog):
    """An environment without the pair is NOT an error and nothing should be
    logged at error level for it — otherwise every local checkout and every
    preview deploy generates alerts for a feature that was never switched on.
    """
    caplog.set_level(logging.DEBUG)
    await mappls.access_token()

    assert [r for r in caplog.records if r.levelno >= logging.ERROR] == []


# ══════════════════════════════════════════════════════════════════════════════
#  7 · the router — always 200, and the reason says which
# ══════════════════════════════════════════════════════════════════════════════
#
# A LOCAL app rather than `server.app`, so this file owns the whole dependency
# graph of the one route it is about. It is wired the way the app wires it — the
# same limiter singleton, so the 30/minute on this route is the real one and the
# autouse `reset_rate_limits` fixture in conftest still empties it between
# tests. `app.state.limiter` is not optional: slowapi reads the limiter off the
# app state inside the decorator's wrapper and raises without it.

@pytest.fixture
def maps_app():
    from fastapi import FastAPI
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    from auth_router import require_user
    from routers import maps as maps_mod

    app = FastAPI()
    app.state.limiter = limiter_singleton()
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(maps_mod.router)
    app.dependency_overrides[require_user] = lambda: CALLER
    return app


def limiter_singleton():
    from limiter import limiter
    return limiter


@pytest.fixture
async def mc(maps_app):
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(
        transport=ASGITransport(app=maps_app), base_url="http://test"
    ) as client:
        yield client


async def test_the_route_is_registered_on_the_real_app():
    """`routers/support_sessions.py` is the standing example of what happens
    when nobody adds the include: 401 complete lines, unreachable for weeks.
    Checked against the source rather than the route table so that a router
    mounted under a different prefix still counts as unregistered."""
    import server
    assert "app.include_router(maps_router)" in inspect.getsource(server)


async def test_configured_answers_a_token_a_url_and_an_expiry(mc, outpost,
                                                              configured):
    outpost.answer(ok("tok-router"))
    resp = await mc.get("/api/v1/maps/token")

    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is True
    assert data["reason"] is None
    assert data["token"] == "tok-router"
    assert data["sdk_url"] == mappls.sdk_url("tok-router")
    assert data["expires_at"] == pytest.approx(time.time() + 86399, abs=5)


async def test_not_configured_is_200_with_a_reason_not_a_4xx(mc, outpost,
                                                             unconfigured):
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
    assert data["reason"] == "not_configured"
    assert "token" not in data and "sdk_url" not in data, (
        "a null token field invites a frontend to build an SDK URL out of it")


async def test_unavailable_is_200_and_is_a_different_reason(mc, outpost,
                                                            configured):
    """The distinction the whole endpoint exists for, asserted through HTTP.

    `not_configured` sends a person to Railway; `unavailable` sends them to
    Mappls' status page. One response shape with one boolean would send them to
    the wrong one half the time.
    """
    outpost.answer(status(503, "upstream unavailable"))
    resp = await mc.get("/api/v1/maps/token")

    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is False
    assert data["reason"] == "unavailable"
    assert data["reason"] != "not_configured"


@pytest.mark.parametrize("case", ["configured", "not_configured", "unavailable"])
async def test_attribution_travels_with_every_answer_including_the_failures(
        case, mc, outpost, monkeypatch):
    """"Powered by Mappls" must be "clearly presented" and may "in no instance"
    be removed — and it is a LOGO, not a text credit, which is why the frontend
    draws the mark and this response carries its accessible name and its link.

    It ships on the failures too, on purpose: a screen that keeps a stale token
    or a cached basemap must never be able to reach a state where it has a map
    and no attribution because the refresh failed.
    """
    if case == "not_configured":
        monkeypatch.delenv("MAPPLS_CLIENT_ID", raising=False)
        monkeypatch.delenv("MAPPLS_CLIENT_SECRET", raising=False)
    else:
        monkeypatch.setenv("MAPPLS_CLIENT_ID", CLIENT_ID)
        monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)
        if case == "unavailable":
            outpost.answer(status(500))

    data = (await mc.get("/api/v1/maps/token")).json()

    assert data["attribution"] == mappls.BASEMAP_ATTRIBUTION == "Powered by Mappls"
    assert data["attribution_href"] == mappls.BASEMAP_ATTRIBUTION_HREF
    assert data["attribution_href"].startswith("https://")


async def test_the_response_never_carries_the_client_secret(mc, outpost,
                                                            configured):
    """The token is billable and visible in the network tab — that is accepted
    and is exactly what a bundled `VITE_MAPPLS_KEY` would have been. The PAIR is
    what must never leave Railway: a leaked token dies in a day, a leaked secret
    does not."""
    outpost.answer(ok("tok-router"))
    text = (await mc.get("/api/v1/maps/token")).text

    assert CLIENT_SECRET not in text
    assert CLIENT_ID not in text


async def test_the_endpoint_serves_a_cached_token_without_re_minting(
        mc, outpost, configured):
    """Two page loads, one mint. The endpoint is the only consumer of the cache
    that a customer can reach, so the property is worth restating through HTTP:
    Mappls' console counts calls and its usage statistics are contractually
    binding, which makes a mint per page load a bill rather than mere waste.
    """
    outpost.answer(ok("tok-router"))

    first = (await mc.get("/api/v1/maps/token")).json()
    second = (await mc.get("/api/v1/maps/token")).json()

    assert first["token"] == second["token"]
    assert outpost.calls == 1
