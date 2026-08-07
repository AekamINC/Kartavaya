"""lead_sources.py — where JustDial and IndiaMART enquiries come in.

The shapes, the dedupe and the writing are in `services/lead_ingest.py`. This is
the plumbing: how each marketplace reaches us, and how we know whose leads these
are.

── TWO DIFFERENT DOORS, BECAUSE THEY WORK DIFFERENTLY ─────────────────────────

IndiaMART is a PULL, authenticated by us, so it is an ordinary org-admin route
plus a cron. `POST /pull/indiamart` is idempotent by design — dedupe is on their
own query id, so running it twice costs two HTTP calls and writes nothing twice.

JustDial is a PUSH. They POST to a URL registered with your account manager, and
there is nothing to authenticate WITH: no signature, no shared secret in a
header, no fixed source IP we can rely on. So the URL is the credential. It
carries a 24-byte `webhook_key` from the credentials row, which is what says
which organisation a lead belongs to.

That is a weaker guarantee than a signature and it is worth being plain about
what it does and does not buy. It buys: nobody can write into an org whose key
they do not have, and a key can be rotated by clearing and re-saving the card.
It does not buy: proof the caller IS JustDial. Someone holding the URL can post
a fabricated lead. The mitigations are that the key never appears in a response
to anyone below org admin, the route writes ONLY a CRM lead row (no credit, no
money, no message sent), and every lead keeps its raw payload so a fabricated
one can be identified afterwards.

── org_id NEVER COMES FROM THE PAYLOAD ────────────────────────────────────────

On both routes it comes from the credentials row — the caller's session for the
pull, the webhook key for the push. A marketplace cannot name the organisation
its leads land in, which is the one thing an unauthenticated write route must
not allow.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from auth_router import require_user
from services import connector_credentials as cc
from services import lead_ingest
from services.audit import emit as audit_emit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/graha/leads", tags=["graha-leads"])

_admin = require_org_role("org_owner", "org_admin")


@router.post("/pull/indiamart")
async def pull_indiamart(
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _r=Depends(_admin),
):
    """Ask IndiaMART for the enquiries since the last successful pull.

    The watermark is `last_tested_at` on the credentials row — the same column
    the Connectors page's Test writes, deliberately reused rather than adding a
    second timestamp: both answer "when did we last successfully talk to this
    marketplace", and two columns for one fact drift.

    Their rate limit is a floor, not a suggestion. A caller inside the window
    gets a 429 from US rather than one from them, because their refusal comes
    back as an HTTP 200 with a different body — an integration that treated it
    as success would report "0 new leads" every fifteen minutes with an expired
    key and nobody would notice for a week.
    """
    import httpx

    pool = await get_pool()
    creds = await cc.resolve(pool, org_id, "indiamart")
    key = creds.values.get("crm_key", "")
    if not key:
        raise HTTPException(
            400, "No IndiaMART CRM key is saved. An org owner or admin sets it "
                 "on the Connectors page.",
        )

    row = await pool.fetchrow(
        "SELECT last_tested_at FROM staging.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND platform='indiamart' AND client_id IS NULL",
        org_id,
    )
    last = row["last_tested_at"] if row else None
    now = datetime.now(timezone.utc)
    if last and (now - last) < lead_ingest.INDIAMART_MIN_INTERVAL:
        wait = lead_ingest.INDIAMART_MIN_INTERVAL - (now - last)
        raise HTTPException(
            429,
            f"IndiaMART allows one pull every 15 minutes. Try again in "
            f"{int(wait.total_seconds() // 60) + 1} minute(s).",
        )

    start, end = lead_ingest.indiamart_window(last, now)
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(
                "https://mapi.indiamart.com/wservce/crm/crmListing/v2/",
                params={"glusr_crm_key": key, "start_time": start, "end_time": end},
            )
            body = resp.text
    except Exception as exc:                            # noqa: BLE001 — reported
        log.warning("IndiaMART pull failed for org %s: %s", org_id, exc)
        raise HTTPException(502, f"Could not reach IndiaMART ({type(exc).__name__}).")

    leads, error = lead_ingest.parse_indiamart_body(body)
    if error:
        # Recorded on the card as a FAILED test, so the Connectors page shows
        # the reason instead of the operator finding out from an empty CRM.
        await _stamp(pool, org_id, "indiamart", ok=False, detail=error,
                     advance_watermark=False)
        raise HTTPException(502, error)

    summary = await lead_ingest.ingest(pool, org_id, leads)

    # The watermark advances only on a CLEAN pull. Advancing it after a partial
    # failure is how a window gets skipped and the leads inside it are lost with
    # nothing to show they existed.
    await _stamp(
        pool, org_id, "indiamart", ok=True,
        detail=f"{summary['created']} new, {summary['updated']} matched an "
               f"existing contact, {summary['skipped']} unusable.",
        advance_watermark=True, when=now,
    )
    audit_emit(
        "graha.leads_pulled", request, org_id=org_id, user_id=user["user_id"],
        resource_type="lead_source", resource_id="indiamart",
        detail={"window": [start, end], **summary},
    )
    return {"source": "indiamart", "window": {"from": start, "to": end}, **summary}


@router.post("/justdial/{webhook_key}")
async def justdial_webhook(webhook_key: str, request: Request):
    """JustDial posts one lead here. Unauthenticated by necessity — see header.

    Answers 200 for anything it accepted OR deliberately ignored, and only
    5xx for a fault of ours. A push integration that receives a 4xx will
    typically retry, then disable the endpoint; a body we could not parse is not
    something a retry fixes, so it is recorded and acknowledged rather than
    refused into a disabled webhook.

    The one exception is an unknown key, which is a 404: that is not JustDial
    with a bad body, it is somebody else entirely, and it must not look like a
    working endpoint.
    """
    pool = await get_pool()

    # `public_fields->>'webhook_key'` — a public field, so this lookup needs no
    # decryption and cannot be turned into an oracle over the secret half.
    row = await pool.fetchrow(
        "SELECT org_id::text AS org_id FROM staging.hub_connector_credentials "
        " WHERE platform='justdial' AND is_active=TRUE "
        "   AND public_fields->>'webhook_key' = $1",
        webhook_key,
    )
    if not row:
        raise HTTPException(404, "Not found")
    org_id = row["org_id"]

    try:
        body = await request.json()
    except Exception:                                   # noqa: BLE001
        log.warning("JustDial posted a body that is not JSON for org %s", org_id)
        return {"ok": True, "stored": 0, "note": "body was not JSON"}

    # They send one lead as an object and a batch as a list, and at least one
    # account vintage wraps it in `{"leads": [...]}`.
    if isinstance(body, dict) and isinstance(body.get("leads"), list):
        records = body["leads"]
    elif isinstance(body, list):
        records = body
    elif isinstance(body, dict):
        records = [body]
    else:
        return {"ok": True, "stored": 0, "note": "unexpected shape"}

    leads = [lead_ingest.normalise_justdial(r) for r in records if isinstance(r, dict)]
    summary = await lead_ingest.ingest(pool, org_id, leads)

    await _stamp(
        pool, org_id, "justdial", ok=True,
        detail=f"Last lead received {datetime.now(timezone.utc):%d %b %Y %H:%M} UTC "
               f"— {summary['created']} new, {summary['updated']} matched.",
        advance_watermark=True,
    )
    # No user id: nobody signed in did this. The org still gets the row, because
    # a lead arriving from outside is exactly what an audit log should carry.
    audit_emit(
        "graha.lead_received", request, org_id=org_id,
        resource_type="lead_source", resource_id="justdial", detail=summary,
    )
    return {"ok": True, **summary}


@router.get("/justdial/url")
async def justdial_url(
    org_id: str = Depends(get_org_id),
    _r=Depends(_admin),
):
    """The URL to give JustDial's account manager.

    Generated on first read rather than at save time, so an operator who filled
    the card in before this existed does not have to re-save it to get one.
    """
    import os
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT public_fields FROM staging.hub_connector_credentials "
        " WHERE org_id=$1::uuid AND platform='justdial' AND client_id IS NULL",
        org_id,
    )
    if not row:
        raise HTTPException(
            404, "Save the JustDial card on the Connectors page first.",
        )
    import json as _json
    public = row["public_fields"]
    if isinstance(public, str):
        public = _json.loads(public or "{}")
    key = (public or {}).get("webhook_key")
    if not key:
        key = lead_ingest.new_webhook_key()
        await pool.execute(
            "UPDATE staging.hub_connector_credentials "
            "   SET public_fields = COALESCE(public_fields,'{}'::jsonb) || $2::jsonb, "
            "       updated_at = NOW() "
            " WHERE org_id=$1::uuid AND platform='justdial' AND client_id IS NULL",
            org_id, _json.dumps({"webhook_key": key}),
        )
    base = os.getenv("BACKEND_URL", "").rstrip("/")
    return {"url": f"{base}/api/v1/graha/leads/justdial/{key}" if base else ""}


async def _stamp(pool, org_id: str, platform: str, *, ok: bool, detail: str,
                 advance_watermark: bool, when: Optional[datetime] = None) -> None:
    """Record the outcome on the credentials row, so the card is honest.

    `last_tested_at` doubles as the pull watermark for IndiaMART — see
    `pull_indiamart`. It is advanced ONLY on a clean run.
    """
    if advance_watermark:
        await pool.execute(
            "UPDATE staging.hub_connector_credentials "
            "   SET last_tested_at=$4, last_test_ok=$3, last_test_detail=$5 "
            " WHERE org_id=$1::uuid AND platform=$2 AND client_id IS NULL",
            org_id, platform, ok, when or datetime.now(timezone.utc), detail[:500],
        )
    else:
        await pool.execute(
            "UPDATE staging.hub_connector_credentials "
            "   SET last_test_ok=$3, last_test_detail=$4 "
            " WHERE org_id=$1::uuid AND platform=$2 AND client_id IS NULL",
            org_id, platform, ok, detail[:500],
        )
