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
and demoted the body to a query parameter. This router is one GET with no body
at all, so it cannot reproduce that. The future import is omitted anyway —
there is nothing here that needs it, and its absence is one less thing to
reason about the next time somebody adds a POST to this file.
"""
import logging

from fastapi import APIRouter, Depends, Request

from auth_router import require_user
from limiter import limiter
from services import mappls

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
    tok = await mappls.access_token()

    if not tok.ok:
        return {
            "available": False,
            "reason": tok.reason,
            "attribution": mappls.BASEMAP_ATTRIBUTION,
            "attribution_href": mappls.BASEMAP_ATTRIBUTION_HREF,
        }

    return {
        "available": True,
        "reason": None,
        "token": tok.token,
        "sdk_url": mappls.sdk_url(tok.token),
        "expires_at": tok.expires_at,
        "attribution": mappls.BASEMAP_ATTRIBUTION,
        "attribution_href": mappls.BASEMAP_ATTRIBUTION_HREF,
    }
