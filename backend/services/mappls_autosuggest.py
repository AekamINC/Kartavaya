"""mappls_autosuggest.py — the address autosuggest call, and the licence on it.

Phase 7.6. Separate from `services/mappls.py` on purpose, and the reason is a
test rather than taste: `tests/test_mappls_token.py` asserts
`"import httpx" not in inspect.getsource(mappls)` — the credential module was
deliberately emptied of network code when the dead OAuth minting was removed,
and that emptiness is now guarded. This module is the one that reaches Mappls;
`mappls.py` stays the one that only knows the key.

── WHAT WE SEND, WE GIVE AWAY. THAT IS THE WHOLE DESIGN CONSTRAINT ──────────

Mappls' published terms take a **perpetual, worldwide, sub-licensable licence
over content submitted to their servers**, and an autosuggest call carrying a
client's premises IS a submission (proposal 92 §6.3, PHASE-7 §7.6). This is not
a privacy preference that can be traded against convenience; it is a contract
term, and the thing it costs us is our customers' data, not our own.

Three consequences, all enforced in code rather than in prose:

  1. **THE FRAGMENT ONLY, NEVER THE RECORD.** `suggest()` takes one string and
     has no access to a row. There is no `client_id` parameter, no address
     object, no "enrich this record" entry point — the signature is the
     control. Anything that wanted to send a stored address would have to be
     written here, deliberately, against this paragraph.
     The frontend half of the same rule lives in
     `components/ui/AddressSuggest.jsx`: it fires only from a real input event,
     so a form that merely LOADS a saved address never submits it.

  2. **NO RESULTS CACHE.** Their terms forbid caching "to avoid paying fees",
     so a cache is not available to us as a cost lever even though it is the
     obvious one. There is deliberately no dict, no TTL and no memo in this
     file. If volume bites, the answer is FEWER CALLS — a longer client-side
     debounce and a higher minimum query length, both of which are constants
     one screen away. Note the contrast with `services/forex.py`, which caches
     an hour: that is a public rate feed with no such term. Read the terms per
     provider; do not pattern-match across them.

  3. **NOT ON THE PUBLIC INBOUND FORM.** An anonymous lead typing their own
     address into our public form must not have it licensed to a third party
     by us. `routers/maps.py` puts this behind `require_user`, which is also
     what stops an anonymous caller spending a 200-hit allocation.

── THE QUERY IS NEVER LOGGED ────────────────────────────────────────────────

Every log line here carries lengths, status codes and counts — never `q`. The
query fragment is a customer's client's premises; putting it in Railway logs
(and therefore in Sentry breadcrumbs) would create a second copy of exactly the
data point paragraph (1) exists to minimise, in a place nobody would think to
look for it. `sentry_scrub.py` redacts credentials, not addresses.

── THE CREDENTIAL, AND WHY THIS ONE ─────────────────────────────────────────

The **`MAPPLS_CLIENT_ID` / `MAPPLS_CLIENT_SECRET` pair**, exchanged for an OAuth
bearer token that travels in the `Authorization` header — which is exactly what
PHASE-7 §7.6 specified, and the plan was right.

⚠ **THIS PARAGRAPH PREVIOUSLY SAID THE OPPOSITE, AND IT WAS WRONG.** The first
version of this file sent `?access_token=<Static Key>`, arguing that the Web Map
SDK takes the console key in a query parameter of that name and that the REST
APIs would be the same. It was refused live on 2026-08-28 with **HTTP 401**,
while that same Static Key was drawing the Gujarat outline in a browser.

The generalisation underneath the mistake is the thing worth keeping: **a
Mappls credential that works for one of their products tells you nothing about
another.** §7.5 lost months to the mirror image of this — a dead SDK URL read as
a missing key. Both times the code was right that a credential was involved and
wrong about which one, and both times the only evidence that settled it was a
live call. `services/mappls.py` carries a note calling the OAuth token "not
accepted by anything"; that was true of the SDK and false in general, and it is
corrected there.

⚠ Neither credential reaches the browser, and the proxy exists so that neither
does. A client-side autosuggest would publish a credential on every keystroke,
and the console's domain whitelist — the only compensating control on the
non-expiring Static Key — does not restrain a lifted key used from curl. The
OAuth token is better still: it expires in ~24h, so even a leak is bounded.

── THREE OUTCOMES, NEVER MERGED ─────────────────────────────────────────────

Same discipline as `pin_boundaries`' `unmatched`/`unavailable` and the token
endpoint's `not_configured`, because they need opposite responses:

    not_configured  this environment holds no OAuth pair. A local checkout or a
                    preview deploy. NOT a fault; do not log at error.
    unavailable     we hold the pair and Mappls did not answer usefully — the
                    mint failed, or the search did. A fault, and it must not be
                    dressed up as "autosuggest is off here". Keeping these two
                    apart is what turned the 401 above into a one-line
                    diagnosis instead of another month of guessing.
    []              Mappls answered and knows no such place. Not a fault at
                    all, and distinct from both of the above — an Indian PIN
                    averages ~82 km² and plenty of real premises are simply
                    not in anyone's gazetteer.
"""
import logging
import os
import time

import httpx

from services.mappls import NOT_CONFIGURED, UNAVAILABLE

log = logging.getLogger(__name__)

#: Mappls' Autosuggest API. The `atlas` host, not the `apis`/`sdk` ones.
SUGGEST_URL = "https://atlas.mappls.com/api/places/search/json"

#: ⚠ THE `atlas` HOST TAKES AN OAuth BEARER TOKEN, NOT THE STATIC KEY.
#:
#: This file first shipped sending `?access_token=<Static Key>`, reasoning that
#: the Web Map SDK takes the console key in a query parameter of that name and
#: that the REST APIs would be the same. **That was wrong, and it was refused
#: live**: 2026-08-28, one call against the deployed staging backend,
#:
#:     GET /api/v1/maps/address/suggest?q=Bopal Circle
#:     -> available:false  reason:unavailable
#:     -> mappls autosuggest refused the static key (HTTP 401)
#:
#: while the SAME Static Key was drawing the Gujarat territory outline in a
#: browser. Mappls' own documentation for this endpoint is explicit: the APIs
#: "follow OAuth 2.0 based security", the caller requests a token with
#: `client_id`/`client_secret`, and `{token_type} {access_token}` goes in the
#: **Authorization header**.
#:
#: This is the SECOND time this codebase has been right that a Mappls
#: credential was missing and wrong about which one — §7.5 spent months on a
#: dead SDK URL for the same reason. The lesson both times is the same: a
#: credential that works for one Mappls product tells you nothing about
#: another, and the only evidence that counts is a live call.
#:
#: PHASE-7 §7.6 specified the OAuth pair from the start. It was right.
TOKEN_URL = "https://outpost.mappls.com/api/security/oauth/token"

#: Seconds subtracted from the token's own lifetime before it is considered
#: stale. The token is good for ~24h; a request that begins 4 minutes before
#: expiry and is answered after it would 401 for a reason no log would explain.
_EXPIRY_SKEW_SECONDS = 300

#: ── THE TOKEN IS CACHED, AND THAT IS NOT THE CACHE MAPPLS FORBIDS ───────────
#:
#: The prohibition is on caching RESULTS to avoid fees — geocodes, suggestions,
#: content. An access token is a CREDENTIAL: Mappls issues it with a 24-hour
#: lifetime for the explicit purpose of being reused, and minting a fresh one on
#: every keystroke would be an extra round trip per character and a self-inflicted
#: rate limit. `test_mappls_autosuggest.py` asserts the same query twice makes
#: two SEARCH calls; nothing about that is weakened by reusing the credential
#: they are both sent with.
#:
#: Module-level, so it is per-process and dies with the container. A failure is
#: NEVER cached — the same rule `services/mappls.py` records for the SDK: a
#: cached failure turns a blip into an outage that lasts until a redeploy.
_token: str | None = None
_token_expires_at: float = 0.0

#: Below this, we do not call. Two independent reasons and both matter:
#:
#:   · every call is a billable hit against an allocation the console currently
#:     shows as **200**, and
#:   · every call is a submission under the licence above.
#:
#: Two characters of an Indian address ("ma") is not a query, it is a prefix of
#: half the gazetteer, and it would spend a hit to say so. Three is the point at
#: which a fragment starts to identify something. The frontend enforces the same
#: number so the wasted request is never made; this enforces it so that a caller
#: bypassing the frontend cannot spend the allocation two characters at a time.
MIN_QUERY_CHARS = 3

#: Anything longer than this is not an address fragment being typed — it is a
#: paste, and quite possibly a whole stored record, which is the one thing
#: paragraph (1) forbids sending. Truncating rather than rejecting keeps a long
#: legitimate address usable while capping what can leave.
MAX_QUERY_CHARS = 120

#: What we hand back to one keystroke's worth of dropdown. A longer list is more
#: scrolling, not more help, and the caller only ever needs the few that match.
MAX_RESULTS = 6

#: Short on purpose. An autosuggest that answers after the user has finished
#: typing is worse than no autosuggest — it repaints the list under a hand that
#: has already moved. It also bounds how long a hung upstream can hold a worker.
TIMEOUT_SECONDS = 4.0

#: The query was too short to send. NOT an error and NOT `unavailable`: nothing
#: failed, we simply declined to spend a hit and a licence on two characters.
TOO_SHORT = "too_short"

#: The address keys we lift out of a suggestion, mapped onto the names this
#: product already stores — `AddressBlock.jsx` and `invoice_pdf.py:_fmt_addr`
#: read exactly these. Mappls' own names are on the left.
#:
#: `eLoc` is deliberately NOT among them. It is Mappls' place identifier, and
#: storing it would put a third party's primary key inside our customers' rows
#: — a soft dependency that becomes a hard one the moment anything joins on it.
#: We want the address text, which is ours to keep once it is typed.
_FIELDS = {
    "city": "city",
    "state": "state",
    "pincode": "pincode",
    "district": "district",
}


def _text(value) -> str:
    """A field is usable only if it is text with something in it.

    Mappls returns `null`, `""` and occasionally a number for the same key
    across two results. Same rule as `AddressBlock.jsx:text`, for the same
    reason: a "null" rendered into an address line is worse than a gap.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if not isinstance(value, str):
        return ""
    return value.strip()


def _shape(item: dict) -> dict | None:
    """One Mappls suggestion, reduced to what an address form can use.

    Anything not named here is dropped rather than passed through. A proxy that
    forwards a provider's payload verbatim hands the browser fields nobody
    reviewed, and this repo has the precedent for what that costs — `/api/users`
    leaked member emails by returning the row it had rather than the row it
    owed (memory `decision_platform_privacy`).
    """
    if not isinstance(item, dict):
        return None

    label = _text(item.get("placeName"))
    if not label:
        # Every real suggestion has a name. One without is a row we cannot put
        # in a list, not a row worth guessing at.
        return None

    out = {
        "label": label,
        "line1": _text(item.get("placeAddress")),
    }
    for theirs, ours in _FIELDS.items():
        out[ours] = _text(item.get(theirs))
    return out


def oauth_pair_configured() -> bool:
    """Both halves present. Neither value is ever returned or logged."""
    return bool((os.getenv("MAPPLS_CLIENT_ID") or "").strip()
                and (os.getenv("MAPPLS_CLIENT_SECRET") or "").strip())


def _forget_token() -> None:
    """Drop the cached token so the next call mints a fresh one."""
    global _token, _token_expires_at
    _token = None
    _token_expires_at = 0.0


async def reset_token_cache() -> None:
    """Test seam. Named for what it does rather than exported by accident."""
    _forget_token()


async def _access_token(client: httpx.AsyncClient) -> str | None:
    """A live OAuth bearer token, minted or reused. `None` if it cannot be got.

    ── WHY THE PAIR AND NOT THE STATIC KEY ──────────────────────────────────

    Because `atlas.mappls.com` refused the Static Key with a 401 while that
    same key was drawing a map in a browser — see the `TOKEN_URL` note above.
    Mappls' documentation for this endpoint says the APIs follow OAuth 2.0 and
    the Authorization header carries `{token_type} {access_token}`.

    ── WHAT IS NEVER LOGGED ─────────────────────────────────────────────────

    The client id, the secret, the token, and any body Mappls returns on a
    failure. `sentry_scrub.py` redacts by variable NAME and cannot see a
    credential echoed inside a third party's error string, so a non-200 is
    reported by STATUS CODE only. The same discipline `services/mappls.py`
    documents for the SDK mint.
    """
    global _token, _token_expires_at

    now = time.monotonic()
    if _token is not None and now < _token_expires_at:
        return _token

    cid = (os.getenv("MAPPLS_CLIENT_ID") or "").strip()
    secret = (os.getenv("MAPPLS_CLIENT_SECRET") or "").strip()
    if not cid or not secret:
        return None

    try:
        resp = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": cid,
                "client_secret": secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    except httpx.HTTPError as exc:
        # By TYPE, not repr: httpx puts the request URL in several exception
        # reprs, and this one's body carries the client secret.
        log.warning("mappls token transport failure: %s", type(exc).__name__)
        return None

    if resp.status_code != 200:
        # Status code only. The body of a failed OAuth response routinely
        # echoes the client id back.
        log.error("mappls token mint refused (HTTP %s)", resp.status_code)
        return None

    try:
        payload = resp.json()
    except ValueError:
        log.warning("mappls token response was not JSON")
        return None

    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        log.warning("mappls token response carried no access_token")
        return None

    # `expires_in` is seconds and Mappls sends 86399. Defended anyway: a
    # missing or absurd value must not produce a token treated as valid for
    # ever, nor one considered stale the instant it arrives.
    try:
        lifetime = int(payload.get("expires_in") or 0)
    except (TypeError, ValueError):
        lifetime = 0
    lifetime = max(60, min(lifetime or 3600, 86400))

    _token = token
    _token_expires_at = now + lifetime - _EXPIRY_SKEW_SECONDS
    # No token, no id, no secret — only that one was obtained and for how long.
    log.info("mappls token minted, valid %ss", lifetime)
    return token


async def suggest(q: str) -> dict:
    """Autosuggest for ONE typed fragment. Never for a stored record.

    Returns `{"available": bool, "reason": str | None, "suggestions": [...]}`.
    It does not raise: every caller is a dropdown under someone's fingers, and
    a dropdown has to say what happened rather than disappear. `routers/maps.py`
    serves this shape straight through, always with HTTP 200 — the same choice
    the token endpoint and the 7.3 geometry endpoint make, and for the same
    reason: a 4xx collapses "not switched on here" and "the provider is down"
    into one red console line.

    ⚠ `q` is the ONLY input, by design. See paragraph (1) of the module
    docstring before adding a second one.
    """
    fragment = (q or "").strip()[:MAX_QUERY_CHARS]

    if len(fragment) < MIN_QUERY_CHARS:
        # No call, no hit, no submission. Note this is checked BEFORE the key,
        # so a local checkout gets the same answer as production for a short
        # query and a developer is not told the environment is unconfigured
        # when the real answer is "keep typing".
        return {"available": True, "reason": TOO_SHORT, "suggestions": []}

    if not oauth_pair_configured():
        return {"available": False, "reason": NOT_CONFIGURED, "suggestions": []}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            token = await _access_token(client)
            if token is None:
                # Minting failed. `UNAVAILABLE`, never `NOT_CONFIGURED`: we
                # HOLD the pair and the provider did not give us a token, which
                # is a fault somebody must look at rather than an environment
                # that was never given a credential. Keeping those two apart is
                # what turned the 401 above into a one-line diagnosis instead of
                # another month of guessing.
                return {"available": False, "reason": UNAVAILABLE, "suggestions": []}
            resp = await client.get(
                SUGGEST_URL,
                # The FRAGMENT is the only thing in the query string. The
                # credential goes in the header, which also keeps it out of any
                # intermediary's access log — the query-parameter form put a
                # non-expiring key there on every keystroke.
                params={"query": fragment},
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        # `exc` is logged by TYPE, not repr. httpx puts the request URL in the
        # repr of several of its exceptions, and that URL carries both the
        # customer's fragment and our non-expiring key.
        log.warning("mappls autosuggest transport failure: %s", type(exc).__name__)
        return {"available": False, "reason": UNAVAILABLE, "suggestions": []}

    if resp.status_code in (401, 403):
        # Named separately from every other failure because it is the one this
        # feature is most likely to hit and the hardest to diagnose from
        # outside. This line is what caught the Static Key being the wrong
        # credential for the `atlas` host, so it stays — but the token is
        # dropped first, because a 401 on a token we believe is live is exactly
        # the case a cached-past-its-life credential produces, and retrying
        # with the same one would fail identically for ever.
        _forget_token()
        log.error(
            "mappls autosuggest refused the OAuth token (HTTP %s) — the token "
            "minted but the Autosuggest product did not accept it; check the "
            "product entitlement on the console before changing this file",
            resp.status_code,
        )
        return {"available": False, "reason": UNAVAILABLE, "suggestions": []}

    if resp.status_code >= 400:
        log.warning("mappls autosuggest HTTP %s", resp.status_code)
        return {"available": False, "reason": UNAVAILABLE, "suggestions": []}

    try:
        payload = resp.json()
    except ValueError:
        # An HTML error page with a 200 on it. Mappls' edge has done this.
        log.warning("mappls autosuggest returned non-JSON with HTTP 200")
        return {"available": False, "reason": UNAVAILABLE, "suggestions": []}

    items = payload.get("suggestedLocations") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        # A 200 whose body we cannot read is a fault, not an empty result.
        # Reporting it as "no matches" would tell a user their client's address
        # does not exist, which is the confidently-wrong failure this repo keeps
        # writing tests against.
        log.warning("mappls autosuggest body has no suggestedLocations list")
        return {"available": False, "reason": UNAVAILABLE, "suggestions": []}

    shaped = [s for s in (_shape(i) for i in items[:MAX_RESULTS]) if s]
    # Count only. The fragment and the results are a customer's client's
    # premises and they do not belong in a log line.
    log.info("mappls autosuggest: %d suggestion(s)", len(shaped))
    return {"available": True, "reason": None, "suggestions": shaped}
