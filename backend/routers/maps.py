"""maps.py — the one place the browser gets a Mappls token.

Phase 7.5. Deliberately NOT part of the CRM router: the territory map is the
first consumer, but Phase 8 puts a map on Pahchan sites (8.1), a PIN preview
popover (8.2) and a client map (8.3), and a token endpoint living under
`/v1/graha` would make attendance ask the CRM for permission to draw a circle.

── WHAT THIS HANDS OUT, AND WHY THAT IS ACCEPTABLE ──────────────────────────

A Mappls access token with `scope READ`, valid ~24h, to any signed-in user. It
is a billable credential and it will be visible in the browser's network tab —
that is unavoidable for a client-side map SDK and is exactly what a build-time
`VITE_MAPPLS_KEY` would have done, except that a bundled key cannot be rotated
without a frontend redeploy and never expires. This is the safer of the two.

What makes it defensible rather than merely equivalent:

  * `require_user` — an anonymous visitor gets nothing;
  * a rate limit, so one account cannot mint a bill;
  * the credential PAIR never leaves Railway. A leaked token dies in a day; a
    leaked client secret does not.

── NO BODY, SO THE 3.13 TRAP DOES NOT APPLY ─────────────────────────────────

`routers/custody.py` documents at length why `from __future__ import
annotations` plus `@limiter.limit` answered 422 to every caller on Python 3.13:
FastAPI could not resolve a Pydantic body model through the wrapper's globals
and demoted the body to a query parameter. Both routes here are GETs with no
body at all, so neither can reproduce that. The future import is omitted anyway
— there is nothing here that needs it, and its absence is one less thing to
reason about the next time somebody adds a POST to this file.

⚠ If you add one: `/address/suggest` takes its fragment as an explicit
`Query(...)` parameter, which is what a query string is SUPPOSED to be. The
custody bug was a BODY silently demoted INTO the query string, which is a
different thing entirely and would look identical in a 422. Read
`routers/custody.py` before introducing a Pydantic model to this file.
"""
import logging

from fastapi import APIRouter, Depends, Query, Request

from auth_router import require_user
from limiter import limiter
from services import mappls, mappls_autosuggest

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/maps", tags=["maps"])


@router.get("/token")
@limiter.limit("30/minute")
async def mappls_token(request: Request, user=Depends(require_user)):
    """A Mappls token for the Web Map SDK — or the reason there is none.

    ── ALWAYS 200 ───────────────────────────────────────────────────────────

    Same choice as `GET /territories/{id}/geometry` in Phase 7.3, and for the
    same reason: the caller must be able to tell "this environment has no map"
    from "the map provider is down", and a 4xx/5xx collapses both into one
    console line and a broken panel. The response says which, in a field the
    frontend switches on.

        available   false  + reason `not_configured` -> the environment was
                    never given the credential pair. A local checkout, or a
                    preview deploy. The screen says so plainly and shows the
                    data it does have. This is NOT a fault.
        available   false  + reason `unavailable` -> we hold credentials and
                    Mappls did not answer. THAT is a fault, and it must not be
                    dressed up as "the map is off".
        available   true   -> `token`, `sdk_url`, `expires_at`.

    ── `sdk_url` IS SERVED, NOT COMPOSED IN THE BROWSER ─────────────────────

    The dead SDK URL is the single most expensive fact in this feature's
    history: `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk` stopped working in
    Aug 2025 and the component that used it kept saying it needed a key, so a
    URL fault was read as a credential fault for months. One definition of that
    URL, beside the token it embeds, is how that stops recurring.

    ── ATTRIBUTION TRAVELS WITH THE TOKEN ───────────────────────────────────

    `"Powered by Mappls"` must be "clearly presented" and may "in no instance"
    be removed or hidden, and it is a LOGO — a text credit does not satisfy the
    terms. It ships in this response rather than as a frontend constant so that
    the credential and the obligation it creates arrive together: a screen
    cannot acquire a basemap from here without also being handed what it owes
    for it. The GODL boundary credit is a DIFFERENT credit, for a different
    dataset, and comes from the geometry endpoint. Neither covers the other.
    """
    key = mappls.static_key()

    if key is None:
        return {
            "available": False,
            "reason": mappls.NOT_CONFIGURED,
            "attribution": mappls.BASEMAP_ATTRIBUTION,
            "attribution_href": mappls.BASEMAP_ATTRIBUTION_HREF,
        }

    # No `expires_at`: a Static Key does not expire. That is a downgrade in
    # security from the 24h token and the domain whitelist is what compensates
    # for it — see `services/mappls.py::static_key`. The field is omitted rather
    # than set to null so that a caller cannot read a null as "never expires"
    # when it might equally mean "we forgot to say".
    return {
        "available": True,
        "reason": None,
        "token": key,
        "sdk_url": mappls.sdk_url(key),
        "attribution": mappls.BASEMAP_ATTRIBUTION,
        "attribution_href": mappls.BASEMAP_ATTRIBUTION_HREF,
    }


@router.get("/address/suggest")
@limiter.limit("30/minute")
async def address_suggest(
    request: Request,
    q: str = Query(default="", description="The address fragment being typed."),
    user=Depends(require_user),
):
    """Address autosuggest for ONE typed fragment. Phase 7.6.

    ── WHY THIS IS A PROXY AND NOT A BROWSER CALL ───────────────────────────

    The Static Key does not expire and rotation is its only revocation. A
    client-side autosuggest would publish it on every keystroke of every
    signed-in user, and the console's domain whitelist — the sole compensating
    control — does not restrain a key lifted out of a network tab and spent
    from curl. The basemap SDK has no choice about this; autosuggest does, so
    it takes the choice. `services/mappls_autosuggest.py` holds the key.

    ⚠ ONE OWNER QUESTION IS STILL OPEN AND IT IS ABOUT THIS SHAPE. Under the
    Geospatial Data Guidelines 2021, a FOREIGN entity may license
    finer-than-threshold Indian map data only through APIs that do not let the
    data pass through its own servers — and a server-side proxy is precisely
    that. If Aekam Inc is an Indian entity the point is moot; the reason it is
    not simply asserted here is that this repo also carries an org named
    `UK AekamINC`, so "obviously Indian" is not a safe reading of the name.
    Nobody has answered it in writing. It is written down here rather than only
    in the plan because the alternative is client-side, and that is not a late
    change — it is a different feature with a published key.
    PHASE-7 §7.6 / proposal 92 §6.4.

    ── WHY IT LIVES UNDER /maps AND NOT UNDER /v1/graha ─────────────────────

    PHASE-7 §7.6 specifies `GET /v1/graha/address/suggest` behind `require_user`
    + Graha's `_gate`. It is here instead, for the same reason the token
    endpoint is: an address field is not a CRM feature. Manav employees, Kray
    vendors, Vikray shipping addresses and a Pahchan site all take one, and
    routing them through `/v1/graha` would make payroll ask the CRM for
    permission to complete an address. The entitlement gate is genuinely lost
    by that choice and it is the right trade — the resource being gated is a
    third-party allocation, and `require_user` plus the rate limit is what
    protects it, not a module entitlement.

    ── 30/MINUTE, AND WHAT IT IS ACTUALLY FOR ───────────────────────────────

    Not abuse prevention in the usual sense. The console currently shows an
    allocation of **200 hits**, and the ceiling this limit sets is what stops a
    single logged-in account exhausting the whole product's address lookups in
    seven seconds — deliberately or by leaving a key repeating in a text box.
    Paired with the client's 350 ms debounce and 3-character minimum, ordinary
    typing costs 3-6 calls to fill one address and never approaches it. It is
    the same number the token endpoint uses, on purpose: two limits with two
    numbers is two things to reason about, and nothing here justifies the
    second.

    ⚠ THE LIMIT IS PER IP, NOT PER USER — `limiter.client_ip`. Everyone in one
    office shares it. That is accepted: the allocation being protected is also
    shared, and 30 a minute is generous for a room of people typing addresses.

    ── ALWAYS 200 ───────────────────────────────────────────────────────────

    `available` / `reason` / `suggestions`, never a 4xx for a state the screen
    has to explain. `reason` is one of `null`, `too_short`, `not_configured` or
    `unavailable`; `services/mappls_autosuggest.py` documents why the last
    three are never merged. An empty `suggestions` with `reason: null` means
    Mappls answered and knows no such place, which is a real and common answer
    in a country where a PIN averages ~82 km².

    ── ATTRIBUTION TRAVELS WITH THE ANSWER ──────────────────────────────────

    Same rule as the token endpoint: the credit ships in the response, not as a
    frontend constant, so a screen cannot acquire Mappls content without also
    being handed what it owes for it. It is served on the failure answers too,
    so a dropdown that still holds results from the previous keystroke can
    never be in a state where it shows them uncredited.

    ── AND WHAT MUST NOT BE ADDED HERE ──────────────────────────────────────

    A `client_id`, an address object, or any "fill in this saved record"
    parameter. Content submitted to Mappls carries a perpetual, worldwide,
    sub-licensable licence back to them, and a stored client address is exactly
    the content this product exists to hold on its customers' behalf. The
    fragment is all that goes. Neither may this endpoint be reached from the
    public inbound lead form — `require_user` is what enforces that, and it is
    a licence control here as much as a security one.
    """
    result = await mappls_autosuggest.suggest(q)
    return {
        **result,
        "attribution": mappls.BASEMAP_ATTRIBUTION,
        "attribution_href": mappls.BASEMAP_ATTRIBUTION_HREF,
    }
