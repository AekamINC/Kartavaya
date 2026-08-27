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

The **Static Key** (`MAPPLS_STATIC_KEY`), passed as the `access_token` QUERY
parameter — Mappls' documented static-key method for the REST APIs, the same
credential and the same parameter name as the Web Map SDK.

It is emphatically NOT the `MAPPLS_CLIENT_ID`/`MAPPLS_CLIENT_SECRET` pair that
PHASE-7 §7.6 asked for. That plan was written before 2026-08-27, when the pair
was proved live to mint tokens that every Mappls product refuses — the
post-2025 host cannot distinguish our real token from a random string. Building
7.6 on the OAuth pair as specified would have produced a feature that mints
successfully, calls confidently, and returns nothing, which is precisely the
failure that cost Phase 7.5 months. See `services/mappls.py`.

⚠ Unlike the SDK case, this key does NOT reach the browser. The proxy exists so
that it does not: a client-side autosuggest would publish a non-expiring key on
every keystroke, and the console's domain whitelist — the only compensating
control on a key that cannot expire — does not restrain a lifted key used from
curl.

── THREE OUTCOMES, NEVER MERGED ─────────────────────────────────────────────

Same discipline as `pin_boundaries`' `unmatched`/`unavailable` and the token
endpoint's `not_configured`, because they need opposite responses:

    not_configured  this environment holds no Static Key. A local checkout or a
                    preview deploy. NOT a fault; do not log at error.
    unavailable     we hold a key and Mappls did not answer usefully. A fault,
                    and it must not be dressed up as "autosuggest is off here".
    []              Mappls answered and knows no such place. Not a fault at
                    all, and distinct from both of the above — an Indian PIN
                    averages ~82 km² and plenty of real premises are simply
                    not in anyone's gazetteer.
"""
import logging

import httpx

from services.mappls import NOT_CONFIGURED, UNAVAILABLE, static_key

log = logging.getLogger(__name__)

#: Mappls' Autosuggest API. The `atlas` host, not the `apis`/`sdk` ones.
#:
#: The static-key method documented for the REST APIs puts the console key in
#: the `access_token` QUERY parameter — the same parameter name the Web Map SDK
#: uses, which is the one piece of consistency in this provider's auth story.
SUGGEST_URL = "https://atlas.mappls.com/api/places/search/json"

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

    key = static_key()
    if key is None:
        return {"available": False, "reason": NOT_CONFIGURED, "suggestions": []}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            resp = await client.get(
                SUGGEST_URL,
                params={"query": fragment, "access_token": key},
            )
    except httpx.HTTPError as exc:
        # `exc` is logged by TYPE, not repr. httpx puts the request URL in the
        # repr of several of its exceptions, and that URL carries both the
        # customer's fragment and our non-expiring key.
        log.warning("mappls autosuggest transport failure: %s", type(exc).__name__)
        return {"available": False, "reason": UNAVAILABLE, "suggestions": []}

    if resp.status_code in (401, 403):
        # Named separately from every other failure because it is the one this
        # feature is most likely to hit and the hardest to diagnose from the
        # outside: the Static Key is documented as the REST credential, but the
        # last time this codebase assumed a Mappls credential worked across
        # products it was wrong for months. If this line appears in Railway
        # logs, the key is real and the AUTOSUGGEST product is not accepting it
        # — check the console's allocation before touching this file.
        log.error(
            "mappls autosuggest refused the static key (HTTP %s) — check the "
            "Autosuggest allocation and the domain whitelist in the console",
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
