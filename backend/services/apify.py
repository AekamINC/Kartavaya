"""Apify actor runner — proxy scraper runs, track costs, apply margin.

THE TOKEN TRAVELS IN A HEADER, NEVER IN THE URL.

Every call here passed `params={"token": _token()}`, and httpx logs the request
line — full URL, query string included — at INFO. So each of the three calls
wrote the live Apify API key into the deploy log, and the poll loop runs one
every six seconds for the length of a scrape. Read straight out of Railway on
2026-07-31:

    INFO - HTTP Request: GET https://api.apify.com/v2/actor-runs/qEvt3…
           ?token=apify_api_…  "HTTP/1.1 200 OK"

Anyone with log access holds the key, and log retention means revoking it later
does not un-publish it. A URL is the wrong place for a credential in general —
it reaches proxies, browser history and error trackers as well as logs — and
Apify accepts `Authorization: Bearer`, which none of those record.

`limit` and `format` stay as query parameters: they are not secrets.
"""
import logging
import os
from typing import Optional

import httpx

log = logging.getLogger(__name__)

APIFY_BASE = "https://api.apify.com/v2"


def _token():
    t = os.getenv("APIFY_API_KEY", "")
    if not t:
        raise RuntimeError("APIFY_API_KEY not set")
    return t


def _auth() -> dict:
    """Bearer header. The one place the token is allowed to appear."""
    return {"Authorization": f"Bearer {_token()}"}


#: Actors this product must never run, and why.
#
# A catalog row carries a `cost_per_run` that was true on the day it was
# written. The actors are third-party and their authors can reprice them
# whenever they like, and when they do, NOTHING in this system notices: the
# margin inverts silently and every run sells below cost until somebody reads
# an email. That is not hypothetical — see the entry below.
#
# `is_active=FALSE` on the catalog row already hides a scraper from the list and
# from `POST /run` (routers/scrapers.py:237, :269). This second gate exists
# because that flag is one UPDATE away from being flipped back, and a reseed of
# migration 046 would set it TRUE again. This is the choke point every run
# passes through, so a block here holds regardless.
BLOCKED_ACTORS: dict[str, str] = {
    # 2026-08-04: the author raised the price from $6.99 to $149.99 per 1,000
    # results — 21.5x. `max_results` is 10, so a full run went from about $0.07
    # to about $1.50 against a recorded `cost_per_run` of $0.10 and a sale price
    # of Rs 50. Every full run now sells at a loss, and the catalog's own
    # arithmetic (cost -> margin_pct -> price_inr) cannot see it.
    "mikolabs/gstin-scraper":
        "repriced 21.5x on 2026-08-04 ($6.99 -> $149.99 per 1,000 results); "
        "a full run costs ~$1.50 against a Rs 50 sale price",
}


class BlockedActorError(RuntimeError):
    """Raised instead of spending money on an actor we have withdrawn."""


async def start_actor(actor_id: str, run_input: dict, max_items: int = 100) -> dict:
    """Start an Apify actor run. Returns {run_id, status}."""
    reason = BLOCKED_ACTORS.get(actor_id)
    if reason:
        # Refuse BEFORE the HTTP call, so no run is created and nothing is
        # billed. The caller refunds the credits it took upfront.
        log.error("apify: refusing blocked actor %s — %s", actor_id, reason)
        raise BlockedActorError(
            f"This scraper has been withdrawn and cannot be run: {reason}."
        )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{APIFY_BASE}/acts/{actor_id.replace('/', '~')}/runs",
            headers=_auth(),
            json=run_input,
        )
        resp.raise_for_status()
        data = resp.json()["data"]
    return {"run_id": data["id"], "status": data["status"]}


def _event_charges_usd(data: dict) -> float:
    """What a PAY_PER_EVENT actor charged, which `usageTotalUsd` does not cover.

    `usageTotalUsd` is the PLATFORM's figure — compute units, proxy, storage.
    An actor priced per event bills separately, and those charges appear only as
    `chargedEventCounts` against the prices in
    `pricingInfo.pricingPerEvent.actorChargeEvents`.

    The gap is not marginal. Measured 2026-07-31: a `compass/crawler-google-places`
    run returning 28 places reported `usageTotalUsd` of $0.0002, while the actor
    charges $0.004 per scraped place — a true cost of about $0.112, understated
    roughly 560-fold. Every scraper in the catalog is a third-party actor, so
    this is the normal case rather than an edge one.
    """
    counts = data.get("chargedEventCounts") or {}
    if not counts:
        return 0.0

    prices = (
        ((data.get("pricingInfo") or {}).get("pricingPerEvent") or {})
        .get("actorChargeEvents") or {}
    )
    total = 0.0
    for event, n in counts.items():
        spec = prices.get(event) or {}
        # Apify names it `eventPriceUsd`; the others are defensive, since a
        # silently-zero price is exactly the failure being fixed here.
        price = spec.get("eventPriceUsd", spec.get("priceUsd", spec.get("price")))
        if price is None:
            log.warning(
                "apify: charged event %r x%s has no price in pricingInfo — "
                "run cost will be understated", event, n,
            )
            continue
        total += float(price) * float(n)
    return total


async def get_run_status(run_id: str) -> dict:
    """Poll run status. Returns {status, dataset_id, usage_usd}."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{APIFY_BASE}/actor-runs/{run_id}",
            headers=_auth(),
        )
        resp.raise_for_status()
        data = resp.json()["data"]

    platform_usd = float(data.get("usageTotalUsd") or 0)
    events_usd = _event_charges_usd(data)
    return {
        "status": data["status"],
        "dataset_id": data.get("defaultDatasetId"),
        # Platform usage PLUS the actor's own event charges. This is the number
        # written to `hub_scraper_runs.cost_usd` and the one the credit true-up
        # is computed from, so it has to be the whole bill.
        "usage_usd": platform_usd + events_usd,
        # Kept apart so the admin spend view can show where a run's cost came
        # from, and so a zero here beside a non-zero total is legible rather
        # than mysterious.
        "platform_usd": platform_usd,
        "events_usd": events_usd,
        "pricing_model": (data.get("pricingInfo") or {}).get("pricingModel"),
    }


async def get_dataset_items(dataset_id: str, limit: int = 200) -> list[dict]:
    """Fetch results from a dataset."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{APIFY_BASE}/datasets/{dataset_id}/items",
            headers=_auth(),
            params={"limit": limit, "format": "json"},
        )
        resp.raise_for_status()
        return resp.json()
