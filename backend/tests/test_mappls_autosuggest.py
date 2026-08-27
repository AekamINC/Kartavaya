"""Phase 7.6 — address autosuggest, and the licence terms it has to obey.

The assertions here are aimed at the ways this specific feature can go wrong,
which are not the ordinary ones. An autosuggest that returns bad results is a
visible bug somebody reports. The failures worth a test are the invisible ones:

  1. **A STORED RECORD REACHING MAPPLS.** Their published terms take a
     perpetual, worldwide, sub-licensable licence over content submitted to
     their servers, so an autosuggest call carrying a client's saved premises
     gives that address away permanently. It fails NOTHING at runtime — the
     dropdown works beautifully — so only a test can hold the line. Asserted
     twice: on the wire (the outgoing request carries the fragment and nothing
     else) and on the signature (`suggest` has exactly one parameter, so there
     is nowhere to pass a record).

  2. **A RESULTS CACHE.** The same terms forbid caching "to avoid paying
     fees". A cache is the obvious cost lever for a 200-hit allocation and
     somebody will reach for it — `services/forex.py` caches an hour, three
     files away — so the absence is asserted by making the same call twice and
     counting the requests, not by reading the source for a dict.

  3. **THE QUERY IN A LOG LINE.** The fragment is a customer's client's
     premises. Logged, it lands in Railway and in Sentry breadcrumbs, which is
     a second copy of the exact data point the design minimises.

  4. **THE KEY LEAVING THE BUILDING.** The proxy exists so the non-expiring
     Static Key does not reach a browser. A response, a log line or an
     exception repr carrying it defeats the whole shape.

── NOTHING HERE TOUCHES THE NETWORK ─────────────────────────────────────────

`httpx.MockTransport` in front of the real `AsyncClient`, so a request the
service builds is a request a real client serialised — the pattern the old
`test_mappls_token.py` used before its subject stopped reaching the network.
That is not fastidiousness: Mappls' allocation is 200 hits, every hit is
billable, and every hit is a submission under the licence in (1). A suite that
called the live endpoint would be spending the customer's contract to prove
that it can.
"""
from __future__ import annotations

import inspect
import logging

import httpx
import pytest

from services import mappls, mappls_autosuggest as autosuggest

KEY = "static-key-abcdef123456"
CLIENT_SECRET = "test-client-secret-never-served"

#: A real-shaped Mappls answer. Field names from their REST API Kit: the two
#: that matter are `placeName` (what a human reads) and `placeAddress` (the
#: line that goes into `line1`).
BODY = {
    "suggestedLocations": [
        {
            "type": "POI",
            "eLoc": "ABC123",
            "placeName": "Unicode Group",
            "placeAddress": "Bopal Circle, Ambli Road",
            "city": "Ahmedabad",
            "state": "Gujarat",
            "district": "Ahmedabad",
            "pincode": "380058",
            "latitude": 23.0333,
            "longitude": 72.4667,
        },
    ],
}

CALLER = {
    "user_id": "user_admin001",
    "email": "admin@test.com",
    "name": "Test Admin",
    "full_name": "Test Admin",
    "role": "admin",
}


@pytest.fixture
def configured(monkeypatch):
    """A Static Key present, with the useless OAuth pair beside it as on Railway."""
    monkeypatch.setenv("MAPPLS_STATIC_KEY", KEY)
    monkeypatch.setenv("MAPPLS_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)


@pytest.fixture
def unconfigured(monkeypatch):
    """No Static Key. The OAuth pair is left SET on purpose — that is the state
    Railway was in throughout the 7.5 misdiagnosis, and with respect to the
    credential that works it is *not configured*."""
    monkeypatch.delenv("MAPPLS_STATIC_KEY", raising=False)
    monkeypatch.setenv("MAPPLS_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("MAPPLS_CLIENT_SECRET", CLIENT_SECRET)


class Upstream:
    """A scripted Mappls, recording every request the service actually made.

    Requests are recorded rather than asserted inline so that a test can say
    "and NOTHING else was sent", which is the shape most of the licence
    assertions need.
    """

    def __init__(self, *, status=200, json=None, text=None, raises=None):
        self.status, self.json, self.text, self.raises = status, json, text, raises
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.raises is not None:
            raise self.raises
        if self.text is not None:
            return httpx.Response(self.status, text=self.text)
        return httpx.Response(self.status, json=self.json if self.json is not None else {})

    @property
    def calls(self) -> int:
        return len(self.requests)


@pytest.fixture
def upstream(monkeypatch):
    """Install a scripted Mappls and hand the script back to the test.

    Patches `httpx.AsyncClient` in the SERVICE's namespace only, so an unrelated
    client elsewhere in the process is untouched.
    """
    def install(**kwargs):
        script = Upstream(**kwargs)
        real = httpx.AsyncClient

        def factory(*a, **kw):
            kw["transport"] = httpx.MockTransport(script)
            return real(*a, **kw)

        monkeypatch.setattr(autosuggest.httpx, "AsyncClient", factory)
        return script

    return install


# ══════════════════════════════════════════════════════════════════════════════
#  1 · THE LICENCE. What we send, we give away — so send only the fragment.
# ══════════════════════════════════════════════════════════════════════════════

async def test_only_the_fragment_and_the_key_are_submitted(configured, upstream):
    """THE ASSERTION THIS FILE EXISTS FOR.

    Mappls take a perpetual, worldwide, sub-licensable licence over content
    submitted to their servers. So the wire is checked positively AND
    negatively: `query` is the fragment, `access_token` is the key, and there
    is no third parameter — because the way this rule breaks is not somebody
    sending the address instead of the fragment, it is somebody sending the
    address *as well*, in a `context=` or a `near=` added to improve results.
    """
    script = upstream(json=BODY)

    await autosuggest.suggest("Bopal Circle")

    assert script.calls == 1
    sent = script.requests[0].url
    assert sent.params["query"] == "Bopal Circle"
    assert sent.params["access_token"] == KEY
    assert set(sent.params.keys()) == {"query", "access_token"}, (
        "a parameter beyond the fragment was submitted to Mappls — everything "
        "sent here is licensed to them in perpetuity")
    assert str(sent).startswith(autosuggest.SUGGEST_URL)


async def test_the_signature_gives_a_record_nowhere_to_go(configured):
    """The structural half of the same rule, and the durable one.

    A test on the wire proves today's call is clean. A test on the signature
    proves there is no PLACE to put a stored address: one parameter, a string.
    Adding `client_id=` or `address=` to widen it fails here, at the moment it
    is written, rather than in a review that might not happen.
    """
    params = inspect.signature(autosuggest.suggest).parameters
    assert list(params) == ["q"]
    assert params["q"].annotation is str


async def test_no_request_is_made_below_the_minimum_length(configured, upstream):
    """Two characters is not a query, it is a prefix of half the gazetteer — and
    sending it spends a hit against a 200-hit allocation AND licenses it.

    `too_short` is `available: True`: nothing failed and nothing is switched
    off, so the dropdown must not tell anybody otherwise.
    """
    script = upstream(json=BODY)

    for short in ("", " ", "a", "ab", "  ab  "):
        result = await autosuggest.suggest(short)
        assert result == {"available": True, "reason": "too_short", "suggestions": []}

    assert script.calls == 0, "a hit was spent on a fragment too short to mean anything"


async def test_a_long_paste_is_truncated_not_forwarded_whole(configured, upstream):
    """A 500-character `q` is not somebody typing — it is a paste, and quite
    possibly a whole stored record arriving through the one door that is open.
    Truncating keeps a long legitimate address usable while capping what can
    leave; rejecting would fail an honest user to punish a hypothetical one."""
    script = upstream(json=BODY)

    await autosuggest.suggest("x" * 500)

    sent = script.requests[0].url.params["query"]
    assert len(sent) == autosuggest.MAX_QUERY_CHARS
    assert autosuggest.MAX_QUERY_CHARS < 500


# ══════════════════════════════════════════════════════════════════════════════
#  2 · NO CACHE. Their terms forbid one; ours is the obvious optimisation.
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_same_query_twice_calls_mappls_twice(configured, upstream):
    """Mappls' terms forbid caching "to avoid paying fees", so a results cache
    is not available to us as a cost lever even though it is the first thing
    anyone would reach for against a 200-hit allocation — `services/forex.py`
    caches an hour, three files away, and reads as precedent.

    Counted on the wire rather than grepped for a dict: a memo added anywhere
    in the path fails this, however it is spelled. If volume bites, the lever
    is FEWER CALLS — the debounce and the minimum length.
    """
    script = upstream(json=BODY)

    first = await autosuggest.suggest("Bopal Circle")
    second = await autosuggest.suggest("Bopal Circle")

    assert script.calls == 2, "a results cache appeared; Mappls' terms forbid one"
    assert first == second


# ══════════════════════════════════════════════════════════════════════════════
#  3 · THE THREE OUTCOMES, NEVER MERGED
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_good_answer_is_shaped_onto_the_columns_we_store(configured, upstream):
    """The keys are `AddressBlock.jsx`'s and `invoice_pdf.py:_fmt_addr`'s, so a
    suggestion drops into the form that already exists.

    `eLoc` is asserted ABSENT. It is Mappls' place identifier and storing it
    would put a third party's primary key inside our customers' rows — a soft
    dependency that becomes a hard one the first time something joins on it. We
    keep the address text, which is ours once it is typed.
    """
    upstream(json=BODY)

    result = await autosuggest.suggest("Unicode")

    assert result["available"] is True
    assert result["reason"] is None
    assert result["suggestions"] == [{
        "label": "Unicode Group",
        "line1": "Bopal Circle, Ambli Road",
        "city": "Ahmedabad",
        "state": "Gujarat",
        "district": "Ahmedabad",
        "pincode": "380058",
    }]


async def test_not_configured_is_not_an_outage(unconfigured, upstream):
    """A local checkout and every preview deploy are in this state. Reporting
    it as `unavailable` sends a person to Mappls' status page for a variable
    that is missing on Railway — the wrong half of the country. Same discipline
    as `pin_boundaries`' `unmatched` vs `unavailable`."""
    script = upstream(json=BODY)

    result = await autosuggest.suggest("Bopal Circle")

    assert result == {"available": False, "reason": mappls.NOT_CONFIGURED,
                      "suggestions": []}
    assert script.calls == 0, "an unconfigured environment still called Mappls"


async def test_no_matches_is_an_empty_list_and_not_a_fault(configured, upstream):
    """An Indian PIN averages ~82 km² and plenty of real premises are in no
    gazetteer. "We looked and found nothing" is a legitimate, common answer and
    must be distinguishable from "we could not look"."""
    upstream(json={"suggestedLocations": []})

    result = await autosuggest.suggest("Nowhere In Particular")

    assert result == {"available": True, "reason": None, "suggestions": []}


@pytest.mark.parametrize("status", [400, 429, 500, 502, 503])
async def test_an_upstream_error_is_unavailable_not_an_empty_result(
        status, configured, upstream):
    """THE CONFIDENTLY-WRONG FAILURE THIS REPO KEEPS WRITING TESTS AGAINST.

    Returning `[]` for a 500 tells the user their client's address does not
    exist. It does; we could not ask. 429 is in the list on purpose — it is
    what a spent allocation looks like, and it must read as a fault so somebody
    goes and looks at the console.
    """
    upstream(status=status, json={"error": "nope"})

    result = await autosuggest.suggest("Bopal Circle")

    assert result == {"available": False, "reason": mappls.UNAVAILABLE,
                      "suggestions": []}


async def test_a_refused_key_is_logged_loudly_enough_to_diagnose(
        configured, upstream, caplog):
    """401/403 is the failure this feature is most likely to hit and the hardest
    to diagnose from outside, because the last time this codebase assumed a
    Mappls credential worked across products it was wrong for months. It logs at
    ERROR and names where to look — the allocation and the domain whitelist —
    while every other upstream failure stays at WARNING."""
    upstream(status=401, json={"error": "unauthorised"})

    with caplog.at_level(logging.ERROR):
        result = await autosuggest.suggest("Bopal Circle")

    assert result["reason"] == mappls.UNAVAILABLE
    assert any(r.levelno == logging.ERROR and "static key" in r.message.lower()
               for r in caplog.records)


async def test_a_200_that_is_not_json_is_a_fault(configured, upstream):
    """An HTML error page under a 200. Mappls' edge has done this, and
    `resp.json()` raises rather than returning something falsy — unhandled, the
    dropdown gets a 500 instead of a sentence."""
    upstream(status=200, text="<html>Service Unavailable</html>")

    result = await autosuggest.suggest("Bopal Circle")

    assert result["reason"] == mappls.UNAVAILABLE


async def test_a_200_without_the_expected_list_is_a_fault_not_an_empty_result(
        configured, upstream):
    """A body we cannot read is not "no matches". If Mappls rename the envelope
    — and this provider has renamed things — the honest answer is that we do not
    know, not that the place does not exist."""
    upstream(json={"unexpectedEnvelope": []})

    result = await autosuggest.suggest("Bopal Circle")

    assert result["reason"] == mappls.UNAVAILABLE


async def test_a_transport_failure_is_unavailable(configured, upstream):
    """A DNS failure or a timeout. `suggest` never raises: every caller is a
    dropdown under somebody's fingers, and a dropdown has to say what happened
    rather than vanish."""
    upstream(raises=httpx.ConnectError("no route"))

    result = await autosuggest.suggest("Bopal Circle")

    assert result == {"available": False, "reason": mappls.UNAVAILABLE,
                      "suggestions": []}


async def test_junk_rows_in_a_good_answer_are_dropped_not_rendered(
        configured, upstream):
    """Mappls returns `null`, `""` and occasionally a number for the same key
    across two results. A row with no `placeName` cannot go in a list — dropping
    it is not the same as failing the request, and one bad row must not cost the
    user the three good ones."""
    upstream(json={"suggestedLocations": [
        {"placeName": None, "placeAddress": "orphan"},
        "not even an object",
        {"placeName": "  ", "placeAddress": "blank name"},
        {"placeName": "Real Place", "placeAddress": None, "pincode": 380058},
    ]})

    result = await autosuggest.suggest("Real")

    assert result["available"] is True
    assert [s["label"] for s in result["suggestions"]] == ["Real Place"]
    # A numeric PIN is stringified rather than dropped — Mappls send both.
    assert result["suggestions"][0]["pincode"] == "380058"
    assert result["suggestions"][0]["line1"] == ""


async def test_the_result_list_is_capped(configured, upstream):
    """A longer dropdown is more scrolling, not more help — and the cap is
    applied to what we PARSE, so a provider that starts returning fifty rows
    does not become fifty rows of work per keystroke."""
    upstream(json={"suggestedLocations": [
        {"placeName": f"Place {i}"} for i in range(50)]})

    result = await autosuggest.suggest("Place")

    assert len(result["suggestions"]) == autosuggest.MAX_RESULTS


# ══════════════════════════════════════════════════════════════════════════════
#  4 · THE QUERY AND THE KEY STAY OUT OF THE LOGS
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("scenario", ["ok", "http_error", "transport_error", "junk"])
async def test_neither_the_fragment_nor_the_key_is_ever_logged(
        scenario, configured, upstream, caplog):
    """The fragment is a customer's client's premises; the key is a credential
    that cannot expire. Neither belongs in Railway logs, and therefore neither
    belongs in a Sentry breadcrumb — `sentry_scrub.py` redacts credentials by
    exact value, but it has never redacted an address.

    The transport case is the one that bites. `httpx` puts the full request URL
    in the repr of several of its exceptions, so the natural
    `log.warning("...: %s", exc)` would publish the fragment AND the key
    together, in the one code path nobody exercises by hand.
    """
    fragment = "Bopal Circle Ambli Road"
    if scenario == "ok":
        upstream(json=BODY)
    elif scenario == "http_error":
        upstream(status=500, json={})
    elif scenario == "junk":
        upstream(json={"nope": 1})
    else:
        upstream(raises=httpx.ConnectError(
            f"failed to connect to {autosuggest.SUGGEST_URL}"
            f"?query={fragment}&access_token={KEY}"))

    with caplog.at_level(logging.DEBUG):
        await autosuggest.suggest(fragment)

    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "Bopal" not in logged, f"the customer's fragment was logged: {logged}"
    assert KEY not in logged, f"the Static Key was logged: {logged}"


# ══════════════════════════════════════════════════════════════════════════════
#  5 · The route: signed in, rate limited, and no credential in the body
# ══════════════════════════════════════════════════════════════════════════════
#
# A LOCAL app rather than `server.app`, wired the way the app wires it — the same
# limiter singleton, so the 30/minute here is the real one and conftest's autouse
# `reset_rate_limits` still empties it between tests. Same shape as
# `test_mappls_token.py`.

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
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(transport=ASGITransport(app=_build_app(authenticated=True)),
                           base_url="http://test") as client:
        yield client


@pytest.fixture
async def anon():
    """No override, so the REAL `require_user` runs and finds no bearer token.
    It raises 401 before it asks for a pool, so this reaches no database — which
    matters, because staging and production share one."""
    from httpx import ASGITransport, AsyncClient
    async with AsyncClient(transport=ASGITransport(app=_build_app(authenticated=False)),
                           base_url="http://test") as client:
        yield client


async def test_the_endpoint_answers_200_with_suggestions(mc, configured, upstream):
    """A GET with a query STRING, and it must not 422.

    `routers/custody.py` documents `from __future__ import annotations` plus
    `@limiter.limit` demoting a request BODY into the query string and
    answering 422 to every caller on the container's Python 3.13 while passing
    locally on 3.14. The bug is about body models, and this route has none — but
    "it cannot happen here" is exactly what was believed there, so the 200 is
    asserted through HTTP rather than argued.
    """
    upstream(json=BODY)

    resp = await mc.get("/api/v1/maps/address/suggest", params={"q": "Unicode"})

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["available"] is True
    assert data["suggestions"][0]["label"] == "Unicode Group"


async def test_a_missing_q_is_not_a_422(mc, configured, upstream):
    """`q` defaults to empty. A component that mounts and fetches before the
    user has typed must get `too_short`, not a validation error it has to
    special-case — and a 422 here is the exact signature of the custody bug,
    which would send the next person hunting the wrong fault."""
    script = upstream(json=BODY)

    resp = await mc.get("/api/v1/maps/address/suggest")

    assert resp.status_code == 200, resp.text
    assert resp.json()["reason"] == "too_short"
    assert script.calls == 0


async def test_an_anonymous_caller_gets_nothing(anon, configured, upstream):
    """`require_user` is a LICENCE control here as much as a security one: it is
    what keeps autosuggest off the public inbound lead form, where an anonymous
    person's own address would be submitted to Mappls — and licensed to them in
    perpetuity — by us, on their behalf, without their knowledge.

    It is also what stops a stranger spending a 200-hit allocation.
    """
    script = upstream(json=BODY)

    resp = await anon.get("/api/v1/maps/address/suggest", params={"q": "Unicode"})

    assert resp.status_code == 401
    assert script.calls == 0, "an anonymous request reached Mappls"


async def test_the_response_never_carries_a_credential(mc, configured, upstream):
    """The whole point of the proxy is that the Static Key does not reach the
    browser. If it did, this would be strictly worse than a client-side call —
    same exposure, plus a hop we pay for."""
    upstream(json=BODY)

    text = (await mc.get("/api/v1/maps/address/suggest",
                         params={"q": "Unicode"})).text

    assert KEY not in text
    assert CLIENT_SECRET not in text
    assert "test-client-id" not in text


async def test_attribution_travels_with_every_answer_including_the_failures(
        mc, upstream, monkeypatch):
    """"Powered by Mappls" must be "clearly presented" and may "in no instance"
    be removed. It ships on the failure answers too, so a dropdown still holding
    the previous keystroke's results can never reach a state where it shows
    Mappls content with no credit because the refresh came back empty."""
    upstream(status=500, json={})
    monkeypatch.delenv("MAPPLS_STATIC_KEY", raising=False)

    data = (await mc.get("/api/v1/maps/address/suggest",
                         params={"q": "Unicode"})).json()

    assert data["available"] is False
    assert data["attribution"] == mappls.BASEMAP_ATTRIBUTION == "Powered by Mappls"
    assert data["attribution_href"] == mappls.BASEMAP_ATTRIBUTION_HREF


async def test_the_route_is_rate_limited(mc):
    """One account may not spend the product's whole allocation. Asserted on the
    decorator rather than by spending 30 requests: the budget is shared through
    the limiter singleton, and a test that exhausts it deliberately makes an
    unrelated test in another file fail.

    `request: Request` is asserted too — slowapi reads the client address off
    it, and a handler that drops the parameter silently loses its limit.
    """
    from routers import maps as maps_mod

    assert "request" in inspect.signature(maps_mod.address_suggest).parameters
    # The decorator is read off the source of the route's own definition, not
    # of the module: the token route two functions above also declares
    # `30/minute`, so a module-wide substring search would pass with this
    # route's limit deleted.
    decorated = inspect.getsource(maps_mod).split("@router.get(\"/address/suggest\")")[1]
    assert '@limiter.limit("30/minute")' in decorated.split("async def")[0]


async def test_the_credential_module_still_reaches_no_network():
    """`services/mappls.py` was emptied of network code when the dead OAuth
    minting was removed, and `test_mappls_token.py` guards that. This feature is
    the first thing since that needed an outbound call, and the obvious place to
    put it was that file. Restated from this side so the reason the split exists
    is recorded where the new code is, not only where the old guard is."""
    assert "import httpx" not in inspect.getsource(mappls)
    assert "import httpx" in inspect.getsource(autosuggest)
