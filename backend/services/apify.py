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


async def start_actor(actor_id: str, run_input: dict, max_items: int = 100) -> dict:
    """Start an Apify actor run. Returns {run_id, status}."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{APIFY_BASE}/acts/{actor_id.replace('/', '~')}/runs",
            headers=_auth(),
            json=run_input,
        )
        resp.raise_for_status()
        data = resp.json()["data"]
    return {"run_id": data["id"], "status": data["status"]}


async def get_run_status(run_id: str) -> dict:
    """Poll run status. Returns {status, stats}."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{APIFY_BASE}/actor-runs/{run_id}",
            headers=_auth(),
        )
        resp.raise_for_status()
        data = resp.json()["data"]
    return {
        "status": data["status"],
        "dataset_id": data.get("defaultDatasetId"),
        # `usageTotalUsd` is the platform's own figure for the run. On a RENTED
        # actor it covers compute and proxy, and the actor author's per-result
        # rental is billed separately — so this can read far below what the run
        # actually costs. Measured 2026-07-31: a Google Maps run returning 28
        # places reported $0.0002 here.
        "usage_usd": data.get("usageTotalUsd", 0),
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
