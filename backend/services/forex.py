"""forex.py — Live USD/INR rate with 1-hour cache.
Uses free exchangerate-api (primary) and fawazahmed0 CDN (fallback).
No API key required.
"""
import logging
import time
import httpx

_log = logging.getLogger(__name__)

_cached_rate: float | None = None
_cached_at: float = 0
_CACHE_TTL = 3600  # 1 hour

FALLBACK_RATE = 96.50


async def get_usd_inr() -> float:
    global _cached_rate, _cached_at
    if _cached_rate and (time.time() - _cached_at) < _CACHE_TTL:
        return _cached_rate

    rate = await _fetch_rate()
    if rate:
        _cached_rate = rate
        _cached_at = time.time()
        return rate
    return _cached_rate or FALLBACK_RATE


async def _fetch_rate() -> float | None:
    for fetcher in [_fetch_exchangerate_api, _fetch_fawazahmed0, _fetch_google_finance]:
        try:
            rate = await fetcher()
            if rate and 50 < rate < 200:
                _log.info("forex: USD/INR = %.4f (via %s)", rate, fetcher.__name__)
                return rate
        except Exception as e:
            _log.warning("forex: %s failed: %s", fetcher.__name__, e)
    return None


async def _fetch_exchangerate_api() -> float | None:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get("https://open.er-api.com/v6/latest/USD")
        resp.raise_for_status()
        return resp.json()["rates"]["INR"]


async def _fetch_fawazahmed0() -> float | None:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(
            "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json"
        )
        resp.raise_for_status()
        return resp.json()["usd"]["inr"]


async def _fetch_google_finance() -> float | None:
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(
            "https://www.google.com/finance/quote/USD-INR",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        resp.raise_for_status()
        marker = 'data-last-price="'
        idx = resp.text.find(marker)
        if idx == -1:
            return None
        start = idx + len(marker)
        end = resp.text.find('"', start)
        return float(resp.text[start:end])


def get_usd_inr_sync() -> float:
    """Synchronous version for PDF generation. Uses cached value or fallback."""
    return _cached_rate or FALLBACK_RATE
