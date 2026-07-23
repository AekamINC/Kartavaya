"""forex.py — Live USD/INR rate with daily cache.
Uses Google Finance public endpoint (free, no API key).
Falls back to 85.0 if fetch fails.
"""
import logging
import time
import httpx

_log = logging.getLogger(__name__)

_cached_rate = None
_cached_at = 0
_CACHE_TTL = 3600  # 1 hour

FALLBACK_RATE = 85.0


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
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                "https://www.google.com/finance/quote/USD-INR",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            resp.raise_for_status()
            text = resp.text
            # Google Finance page contains data-last-price="XX.XX"
            marker = 'data-last-price="'
            idx = text.find(marker)
            if idx == -1:
                _log.warning("forex: could not find rate marker in Google Finance page")
                return None
            start = idx + len(marker)
            end = text.find('"', start)
            rate = float(text[start:end])
            _log.info("forex: USD/INR = %.4f (live)", rate)
            return rate
    except Exception as e:
        _log.warning("forex: rate fetch failed: %s", e)
        return None


def get_usd_inr_sync() -> float:
    """Synchronous version for PDF generation etc. Uses cached value or fallback."""
    return _cached_rate or FALLBACK_RATE
