"""web_search.py — the web half of a Sahayak answer.

Gemini's own grounding is the obvious way to do this and it is not the one we
use. Two reasons, both measured rather than assumed:

  COST. Grounding is billed separately from generation at roughly $14–35 per
  thousand queries, and one question can fire several. Serper is $0.10 per
  thousand with 2,500 a month free — around a hundred and fortyfold cheaper on
  the margin, and free at the volume this product will see for a long while.

  IT DOES NOT WORK ON OUR KEY. Probed 2026-08-08 across every model the account
  can call — 3.1, 3.5, 3.6 and the aliases — a plain `generateContent` returns
  200 and the same request with `tools:[{google_search:{}}]` returns 429. It is
  an entitlement on the key, not a property of any model, so no amount of model
  switching reaches it.

── WHAT THIS RETURNS ──────────────────────────────────────────────────────────

`[{"title": ..., "url": ...}]` — deliberately the exact shape
`sahayak_answer.web_sources()` already consumes, which is the shape Gemini's
`groundingChunks` were mapped into. So this drops into the existing socket: the
source cards render unchanged, and if the Gemini entitlement is ever granted the
two are interchangeable.

── WHAT IT DOES NOT DO ────────────────────────────────────────────────────────

It does not fetch the pages. Serper returns titles, links and the snippet
Google shows; the snippet is what goes to the model. Fetching each result would
mean following arbitrary URLs from a search engine on our own network, which is
an SSRF surface, and it is why the more expensive vendors cost more. If richer
extraction is ever wanted it belongs behind the same interface, not bolted onto
this function.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger(__name__)

SERPER_URL = "https://google.serper.dev/search"

# Serper's own cap is higher. This is ours: the model is given a handful of
# snippets to reason over, and a longer list costs prompt tokens on every
# question while adding little a reader would notice.
MAX_RESULTS = 5

# One question, one search. Serper bills per query, and the thing that turns a
# free tier into an invoice is a retry loop nobody remembers writing.
TIMEOUT_SECONDS = 8.0


def is_configured() -> bool:
    """Whether a search key exists. Callers must treat False as ordinary.

    Search is an enhancement, not a dependency: with no key the chatbot answers
    from the organisation's own records exactly as it did before, and says it
    could not search rather than pretending it did.
    """
    return bool(os.getenv("SERPER_API_KEY", "").strip())


async def search(query: str, *, country: str = "in", limit: int = MAX_RESULTS) -> list[dict]:
    """Search the web. Returns `[{title, url, snippet}]`, newest-relevance first.

    `country="in"` because almost every question this fires on is an Indian
    business question — GST rates, filing deadlines, a supplier's registered
    address — and the unlocalised results for those are frequently a US answer
    to an Indian question, which is worse than no answer because it looks right.

    Never raises. A search that fails returns `[]` and the answer proceeds
    ungrounded: a chatbot that 500s because a third-party search engine was slow
    is a worse product than one that answers without the web.
    """
    key = os.getenv("SERPER_API_KEY", "").strip()
    if not key:
        return []

    query = (query or "").strip()
    if not query:
        return []

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            resp = await client.post(
                SERPER_URL,
                # `X-API-KEY` header, not a query parameter. httpx logs the
                # request URL at INFO, so a key in the query string is written
                # into the deploy log on every single search. Same reason
                # `_call_gemini` uses `x-goog-api-key` — see the note there.
                headers={"X-API-KEY": key, "Content-Type": "application/json"},
                json={"q": query, "gl": country, "num": min(limit, 10)},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:                                # noqa: BLE001 — see docstring
        log.warning("Web search failed (%s): %s", type(exc).__name__, str(exc)[:160])
        return []

    out: list[dict] = []
    for item in (data.get("organic") or [])[:limit]:
        url = (item.get("link") or "").strip()
        if not url:
            continue
        out.append({
            "title": (item.get("title") or url)[:200],
            "url": url,
            "snippet": (item.get("snippet") or "")[:400],
        })
    return out


def render_for_prompt(results: list[dict], start_ref: int = 1) -> str:
    """The block handed to the model, numbered to match the source cards.

    The numbering continues from the organisation's own readings rather than
    restarting, so `[4]` means one thing in an answer and the reader can find it
    whether it came from the database or the web.
    """
    if not results:
        return ""
    lines = ["", "WEB SEARCH RESULTS — public pages, not this organisation's records:"]
    for i, r in enumerate(results, start=start_ref):
        lines.append(f"[{i}] {r.get('title', '')} — {r.get('url', '')}")
        if r.get("snippet"):
            lines.append(f"    {r['snippet']}")
    lines.append(
        "Cite these with their [n] exactly as you would the organisation's own "
        "records. Say when a figure comes from a public page rather than from "
        "this organisation's data — the two carry very different authority."
    )
    return "\n".join(lines)
