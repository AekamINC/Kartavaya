"""Apify actor runner — proxy scraper runs, track costs, apply margin."""
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


async def start_actor(actor_id: str, run_input: dict, max_items: int = 100) -> dict:
    """Start an Apify actor run. Returns {run_id, status}."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{APIFY_BASE}/acts/{actor_id}/runs",
            params={"token": _token()},
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
            params={"token": _token()},
        )
        resp.raise_for_status()
        data = resp.json()["data"]
    return {
        "status": data["status"],
        "dataset_id": data.get("defaultDatasetId"),
        "usage_usd": data.get("usageTotalUsd", 0),
    }


async def get_dataset_items(dataset_id: str, limit: int = 200) -> list[dict]:
    """Fetch results from a dataset."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{APIFY_BASE}/datasets/{dataset_id}/items",
            params={"token": _token(), "limit": limit, "format": "json"},
        )
        resp.raise_for_status()
        return resp.json()
