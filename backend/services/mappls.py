"""mappls.py — one Mappls access token, minted server-side and cached.

── WHY THE BROWSER DOES NOT HOLD A KEY ──────────────────────────────────────

`TerritoryMap.jsx` read `VITE_MAPPLS_KEY` from 2026-08-09 to 2026-08-27 and
rendered "the territory map needs a MapMyIndia key" because it was never set.
That sentence was **false the whole time**. Two different credentials were being
confused: a frontend build-time key that nobody ever bought, and the OAuth pair
`MAPPLS_CLIENT_ID` / `MAPPLS_CLIENT_SECRET` that has been sitting on Railway
minting tokens successfully. See the memory `mappls_credentials_exist`.

So there is no `VITE_MAPPLS_KEY` and there will not be one. The browser asks
this backend for a token, and that is better than a build-time key for reasons
beyond the accident:

  * a build-time key is baked into a public JS bundle and cannot be rotated
    without a redeploy of the frontend;
  * `expires_in` is ~24h, so a leaked token dies on its own;
  * the credential pair never leaves Railway, where `sentry_scrub.py` already
    redacts it.

── NOT CONFIGURED IS NOT AN OUTAGE ──────────────────────────────────────────

This module answers with a `Token` whose `reason` distinguishes the two, the
same discipline `services/pin_boundaries.py` applies to `unmatched` vs
`unavailable`, and for the same reason: collapsing them tells a customer the
map is broken when in truth the feature was never switched on for their
environment, and they will go and file a fault against working software.

    ok            a token, valid until `expires_at`
    NOT_CONFIGURED  no credential pair in this environment. Local dev, and any
                    deploy that has not been given the pair. NOT an error, and
                    nothing should be logged at error level for it.
    UNAVAILABLE     the pair exists and Mappls did not give us a token. Their
                    outage, our network, or a revoked credential.

── THE CACHE IS A CORRECTNESS RULE, NOT A SPEED ONE ─────────────────────────

Mappls' terms forbid caching *to avoid paying fees* (memory
`mappls_licence_and_map_market`), which is about map and geocode RESULTS. A
token is not a result — re-minting one per page load would be a bug, since the
same token is valid for a day and every mint is a round trip a person waits on.

`_SKEW_SECONDS` exists because a token that expires while the SDK is still
loading fails in the browser, where we cannot see it. We hand back only tokens
with real life left in them.

**A failure is never cached.** Same rule as `pin_boundaries`: an outage must
clear on the next request rather than on the next deploy.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import NamedTuple

import httpx

log = logging.getLogger(__name__)

#: Mappls' OAuth 2.0 client-credentials endpoint. Verified live 2026-08-27:
#: HTTP 200, `expires_in` 86399, `scope` READ, project `prj1787726591i922664629`.
TOKEN_URL = "https://outpost.mappls.com/api/security/oauth/token"

#: The Web Map SDK. **The `{token}` goes in the PATH, not a query parameter** —
#: this is Mappls' own form and it is easy to get wrong: the previous component
#: used `apis.mappls.com/advancedmaps/api/{KEY}/map_sdk`, a URL that has been
#: dead since Aug 2025, and it was mistaken for a missing-credential problem for
#: months. Served to the browser from here rather than hardcoded there, so that
#: when it next changes there is ONE place that is wrong.
SDK_URL_TEMPLATE = "https://apis.mappls.com/advancedmaps/api/{token}/map_sdk?layer=vector&v=3.0"

#: Mappls' terms: `"Powered by Mappls"` must be "clearly presented" and "in no
#: instance" removed or hidden, and it is a LOGO, not a text credit — PHASE-7
#: §7.5 originally specified `Basemap © Mappls` as a string, which does not
#: satisfy it. The frontend draws the mark; this is the accessible name and the
#: link that must accompany it, served from the same place as the token so a
#: screen cannot end up with a basemap and no attribution.
BASEMAP_ATTRIBUTION = "Powered by Mappls"
BASEMAP_ATTRIBUTION_HREF = "https://www.mappls.com/"

#: Refuse to hand out a token with less than this left. Five minutes is far
#: longer than an SDK load, and `expires_in` is ~24h, so this costs one extra
#: mint per day and removes a class of failure we could never observe.
_SKEW_SECONDS = 300.0

#: Mappls answering slowly must not hold a request open. The map is one panel on
#: a page; a caller that waits ten seconds for it has already failed the reader.
_TIMEOUT_SECONDS = 8.0

NOT_CONFIGURED = "not_configured"
UNAVAILABLE = "unavailable"


class Token(NamedTuple):
    """A minted token, or the reason there is none. Never both."""

    token: str | None
    expires_at: float | None       # epoch seconds, absolute
    reason: str | None             # NOT_CONFIGURED | UNAVAILABLE | None when ok

    @property
    def ok(self) -> bool:
        return self.token is not None


#: `(token, expires_at)` or None. SUCCESS ONLY — see the module docstring.
_cached: tuple[str, float] | None = None

#: Two page loads land together on a cold worker. Without this they mint two
#: tokens; Mappls' console counts calls and its usage statistics are
#: contractually binding, so a duplicate mint is a small bill, not just waste.
_mint_lock = asyncio.Lock()


def reset_cache() -> None:
    """Drop the cached token. For tests, and for a REPL."""
    global _cached
    _cached = None


def _credentials() -> tuple[str | None, str | None]:
    """The OAuth pair from the environment, blank treated as absent.

    `os.getenv(...)` returning `''` is what a Railway variable set to nothing
    looks like, and an empty client_id would be sent to Mappls and answered with
    a 401 — reported as UNAVAILABLE, i.e. as their fault. It is ours.
    """
    client_id = (os.getenv("MAPPLS_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("MAPPLS_CLIENT_SECRET") or "").strip()
    return (client_id or None, client_secret or None)


def is_configured() -> bool:
    """Whether this environment holds a credential pair at all."""
    client_id, client_secret = _credentials()
    return bool(client_id and client_secret)


async def access_token() -> Token:
    """A Mappls access token, from cache when one is still comfortably alive."""
    global _cached

    now = time.time()
    if _cached and _cached[1] - now > _SKEW_SECONDS:
        return Token(_cached[0], _cached[1], None)

    client_id, client_secret = _credentials()
    if not client_id or not client_secret:
        return Token(None, None, NOT_CONFIGURED)

    async with _mint_lock:
        # Re-read inside the lock: the request that was waiting on the mint
        # should use its token, not start a second one.
        now = time.time()
        if _cached and _cached[1] - now > _SKEW_SECONDS:
            return Token(_cached[0], _cached[1], None)

        minted = await _mint(client_id, client_secret)
        if minted is None:
            return Token(None, None, UNAVAILABLE)

        _cached = minted
        return Token(minted[0], minted[1], None)


async def _mint(client_id: str, client_secret: str) -> tuple[str, float] | None:
    """`(token, expires_at)` from Mappls, or None on any failure.

    Every failure is one return value on purpose. The caller's only decision is
    "is there a token", and a taxonomy of HTTP statuses here would be a taxonomy
    nothing reads. The detail goes to the log, where a person looks.

    **Nothing in here logs the token or the secret.** `sentry_scrub.py` redacts
    the credential names, but a response body logged whole would carry the
    minted token past it.
    """
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as exc:  # network, DNS, timeout
        log.warning("mappls: token mint failed to reach %s: %s", TOKEN_URL, exc)
        return None

    if resp.status_code != 200:
        # The body may name the reason (`invalid_client`) and cannot contain a
        # token, since there isn't one. Truncated: it is a third party's text.
        #
        # And the secret is REDACTED OUT OF IT rather than trusted not to be
        # there. Some OAuth gateways echo the posted form back on a 400, and
        # `sentry_scrub.py` redacts by variable NAME — it cannot see a secret
        # that arrives inside somebody else's error string. We can prove our own
        # code never formats the credential in; we cannot prove theirs doesn't.
        detail = resp.text[:200].replace(client_secret, "***").replace(client_id, "***")
        log.warning("mappls: token mint answered HTTP %s — %s",
                    resp.status_code, detail)
        return None

    try:
        payload = resp.json()
    except ValueError:
        log.warning("mappls: token mint answered 200 with a non-JSON body")
        return None

    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        log.warning("mappls: token mint answered 200 with no access_token")
        return None

    # `expires_in` is seconds and has been 86399 every time it has been read.
    # A missing or absurd value falls back to an hour rather than to forever:
    # the cost of re-minting is one request, the cost of trusting a bad number
    # is a browser holding a dead token.
    try:
        expires_in = float(payload.get("expires_in") or 0)
    except (TypeError, ValueError):
        expires_in = 0.0
    # `not (0 < x <= ...)` also rejects NaN, since every comparison against NaN
    # is False — stated here because that is luck rather than intent, and the
    # next person to rewrite this as `if x <= 0 or x > MAX` would lose it.
    if not (0 < expires_in <= 86400 * 7):
        expires_in = 3600.0

    return token, time.time() + expires_in


def sdk_url(token: str) -> str:
    """The Web Map SDK URL for a token. See `SDK_URL_TEMPLATE`."""
    return SDK_URL_TEMPLATE.format(token=token)
