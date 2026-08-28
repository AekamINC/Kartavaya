"""mappls.py — the one Mappls credential, and the WRONG one, kept named.

There is no minting here any more. The Web Map SDK takes a **Static Key** as a
query parameter and that key is served straight through. What is left in this
file besides three lines of code is the evidence for why the OTHER credential —
the one that is on Railway, works perfectly, and is not the answer — is not the
answer. Delete that and the next person re-derives it over a day, as we did.

── THE CREDENTIAL REVERSAL, AUGUST 2025 ─────────────────────────────────────

We hold `MAPPLS_CLIENT_ID` / `MAPPLS_CLIENT_SECRET`, they mint an OAuth token
against `TOKEN_URL` with HTTP 200 and `expires_in` 86399, and **that token is
refused by every Mappls product we are entitled to.** Mappls replaced the auth
mechanism in August 2025: their `mappls-web-maps-js` README documents the new
one on `main` and pushed the OAuth 2.0 flow to an `auth-legacy` branch.

Proved live on 2026-08-27 rather than inferred: the post-2025 SDK host answers
our real minted token and a randomly generated fake string **byte-identically**
(`Token was not recognised`), while the legacy host distinguishes them. A
credential the new host cannot tell apart from garbage is not a credential for
the new host. The owner's console shows Vector Map JS SDK, Vector Tiles, Geocode
and Autosuggest all allocated, so this was never an entitlement problem — it was
the wrong credential, held with total confidence, for months.

So: the minting code is gone (nothing called it), the Railway variables stay
(not ours to remove), and `TOKEN_URL` and `LEGACY_SDK_URL_TEMPLATE` stay HERE,
documented, so that finding the pair does not start the same investigation.

── NOT CONFIGURED IS NOT AN OUTAGE ──────────────────────────────────────────

`static_key()` returns None or a key; the router turns None into
`reason: not_configured`. Same discipline as `services/pin_boundaries.py`'s
`unmatched` vs `unavailable`, for the same reason: collapsing "this environment
was never given the key" into "the map is broken" tells a customer to file a
fault against working software.

── THE STATIC KEY DOES NOT EXPIRE, AND THE BROWSER GETS IT ──────────────────

This is a real downgrade from the 24-hour token and it is stated plainly rather
than buried. A client-side map SDK cannot load without a credential the browser
can read, so the key is in every network tab of every signed-in user, for ever,
until somebody rotates it in the console.

**The console's domain whitelist is the compensating control.** It is the only
thing standing between a lifted key and somebody else's map bill, since the key
itself carries no expiry, no per-user identity and no revocation short of
rotation. Do not enable a Mappls credential for browser use with an empty
whitelist. `routers/maps.py` adds the two controls we own: `require_user`, so an
anonymous visitor gets nothing, and a rate limit, so one account cannot scrape
the endpoint at speed.
"""
from __future__ import annotations

import os

#: Mappls' OAuth 2.0 client-credentials endpoint. Verified live 2026-08-27:
#: HTTP 200, `expires_in` 86399, `scope` READ, project `prj1787726591i922664629`.
#:
#: ── ⚠ CORRECTED 2026-08-28: THE TOKEN IS THE REST CREDENTIAL ────────────────
#:
#: This note used to read "the token it returns is not accepted by ANYTHING",
#: and that was an over-generalisation from one true fact. What was actually
#: measured on 27 Aug is that the post-2025 **Web Map SDK** host refuses it —
#: it cannot distinguish our real token from a random string. That is a fact
#: about the SDK, and it says nothing about the REST APIs.
#:
#: `atlas.mappls.com` — Autosuggest, and every other REST product — takes
#: exactly this token, as `Authorization: Bearer …`, and REFUSES the Static Key
#: with a 401. Proved live on 28 Aug, in both directions, while the Static Key
#: was simultaneously drawing a map in a browser.
#:
#: So the two credentials are not better and worse; they are for different
#: products:
#:
#:     Web Map SDK (browser)   MAPPLS_STATIC_KEY, `?access_token=` query param
#:     REST APIs   (server)    the pair below -> OAuth bearer token in a header
#:
#: NOTHING IN THIS MODULE CALLS THIS URL — the minting lives in
#: `services/mappls_autosuggest.py`, because `tests/test_mappls_token.py`
#: asserts this file never imports httpx. The constant stays here because this
#: is the module about credentials. If you are here because the MAP is blank,
#: the variable you want is `MAPPLS_STATIC_KEY`; if an ADDRESS LOOKUP is
#: failing, it is the pair.
TOKEN_URL = "https://outpost.mappls.com/api/security/oauth/token"

#: The Web Map SDK, post-August-2025. Quoted from Mappls' own README:
#:
#:     <script src="https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=<Static Key>">
#:     "Copy and paste the key from your `credentials` section from your API
#:      keys into the `access_token` query parameter."
#:
#: So `access_token` is a QUERY parameter and its value is the console's
#: **Static Key** — a different credential from the Client ID / Client Secret
#: pair, issued in the same Credentials tab. There is no `layer=vector`
#: parameter in the new form; v3 is vector.
SDK_URL_TEMPLATE = "https://sdk.mappls.com/map/sdk/web?v=3.0&access_token={key}"

#: The legacy form: token in the PATH, on `apis.mappls.com`. NOTHING CALLS THIS
#: EITHER. It is retained for the same reason as `TOKEN_URL` — it is the shape
#: somebody who finds the OAuth pair will reinvent, and the whole point is that
#: it belongs to the credential we are no longer using. `sdk_url()` returning
#: anything of this shape is a regression, and a test says so by name.
LEGACY_SDK_URL_TEMPLATE = (
    "https://apis.mappls.com/advancedmaps/api/{token}/map_sdk?layer=vector&v=3.0"
)

#: Mappls' terms: `"Powered by Mappls"` must be "clearly presented" and "in no
#: instance" removed or hidden, and it is a LOGO, not a text credit — PHASE-7
#: §7.5 originally specified `Basemap © Mappls` as a string, which does not
#: satisfy it. The frontend draws the mark; this is the accessible name and the
#: link that must accompany it, served from the same place as the key so a
#: screen cannot end up with a basemap and no attribution.
BASEMAP_ATTRIBUTION = "Powered by Mappls"
BASEMAP_ATTRIBUTION_HREF = "https://www.mappls.com/"

#: The environment was never given a key. NOT an error: a local checkout and any
#: preview deploy are in this state, and nothing should log at error level for
#: it.
NOT_CONFIGURED = "not_configured"

#: We have a key and the map still did not come up.
#:
#: **This module can no longer produce it** — with the minting gone there is no
#: round trip left to fail, so the endpoint answers `not_configured` or a key
#: and nothing else. It is kept because the reason vocabulary is shared with the
#: browser, which still needs it: `frontend/src/lib/mapplsSdk.js` exports
#: `MAP_DOWN = 'unavailable'` and both map components fall back to it when the
#: FETCH of this endpoint fails or the SDK script will not load. Removing the
#: name here would not remove the state; it would only remove the definition of
#: it from the place the backend documents its own contract.
UNAVAILABLE = "unavailable"


def static_key() -> str | None:
    """The console-issued Static Key, or None. THE credential for the Web SDK.

    Blank is treated as absent, and that is deliberate rather than tidy: a
    Railway variable set to nothing reads back as `''`, a bare truthiness check
    would call that configured, and the empty key would be put in the SDK URL
    and refused by Mappls. The browser would then report a provider failure for
    what is our missing configuration — the exact misattribution that
    `NOT_CONFIGURED` exists to prevent.

    It lives on Railway rather than in the frontend build as `VITE_MAPPLS_KEY`.
    A build-time key is baked into a public bundle and cannot be rotated without
    a frontend redeploy; served from here, rotation is one Railway variable and
    a restart. That much of the 2026-08-27 decision survives — what does NOT
    survive is its premise, which was that no key was owed at all.

    ⚠ This key does not expire and it is handed to the browser. See the module
    docstring: the console's domain whitelist is the compensating control.
    """
    return (os.getenv("MAPPLS_STATIC_KEY") or "").strip() or None


def is_configured() -> bool:
    """Whether this environment can serve a basemap at all."""
    return static_key() is not None


def sdk_url(key: str) -> str:
    """The Web Map SDK URL for a Static Key. See `SDK_URL_TEMPLATE`.

    Composed here and served to the browser, not built in the frontend, so that
    when Mappls next changes the form there is ONE place that is wrong instead
    of one per screen. It changed once already and cost months.
    """
    return SDK_URL_TEMPLATE.format(key=key)
