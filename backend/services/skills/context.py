"""
context.py — what a skill knows before it asks the model anything.

Skills used to run blind. `run_skill` and `run_org_skill` built a system prompt
from the BRAND PROFILE alone — voice, tone, audience, tagline — and sent the step
prompt straight to the model. So a skill could tell you how the company sounds
and nothing about what is actually happening inside it: no invoices, no deals, no
stock, no attendance, none of the documents the org has uploaded. Every answer
was a plausible essay written by something that had never seen the books.

Meanwhile the Chat tab has been doing retrieval since it shipped
(`routers/hub_chat.py` → `rag.search_hybrid`), and 23 read handlers sit in
`services/skills/{data,detect}` that nothing called. This module is the join.

── Two kinds of data, deliberately not one ─────────────────────────────────────

SIMPLE — structured facts, from SQL through the READ and DETECT handlers.
    Counts, sums, rows, scores. Small, exact, cheap, and always current. This is
    what makes an answer specific: "₹4,20,000 across 7 invoices, oldest 63 days"
    rather than "you may have some outstanding receivables".

RICH — unstructured text, from the knowledge base via hybrid vector + full-text
    search over whatever has been ingested: uploaded documents, pasted notes,
    FAQs, files pulled in from R2 storage.

They fail differently and they are budgeted differently, so they stay separate
all the way to the prompt. A number that is wrong is worse than a number that is
missing, so a source that errors says so in the context rather than being
dropped — the model is told "receivables unavailable", never quietly handed a
world in which there are no overdue invoices.

── Bounded, and honest about it ───────────────────────────────────────────────

Context is tokens and tokens are the running cost of the product. Every source
is capped by row count, the whole block is capped by characters, and anything
dropped is NAMED in the output. A context block that silently truncates reads to
the model exactly like a complete one, and it will answer with the same
confidence over half the data.
"""
import asyncio
import json
import logging
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)

#: Hard ceiling on the rendered block. ~8k characters is roughly 2k tokens —
#: meaningful grounding without doubling the cost of every step. Production runs
#: on cheap models by policy, and those have the smallest windows.
MAX_CONTEXT_CHARS = 8000

#: Per-source row cap applied before rendering. Deliberately small: twelve
#: overdue invoices tell the model everything about the shape of the problem
#: that two hundred would, at a twentieth of the cost.
MAX_ROWS_PER_SOURCE = 12


class Source:
    """One retrievable fact-set: how to fetch it, and what to call it."""

    def __init__(self, key: str, label: str, kind: str, fetch: Callable, needs: tuple = ()):
        self.key = key
        self.label = label
        self.kind = kind          # "simple" | "rich"
        self.fetch = fetch
        self.needs = needs        # params with no default, supplied by the caller


async def _overdue(pool, org_id, module, days=0):
    from services.skills.data import find_overdue
    return await find_overdue(pool, org_id, module, days_overdue=days)


async def _kpis(pool, org_id, period="30d"):
    from services.skills.data import aggregate_kpis
    return await aggregate_kpis(pool, org_id, period=period)


async def _low_stock(pool, org_id):
    from services.skills.data import find_low_stock
    return await find_low_stock(pool, org_id)


async def _deal_health(pool, org_id):
    from services.skills.detect import score_deals
    return await score_deals(pool, org_id)


async def _attendance(pool, org_id, lookback_days=30):
    from services.skills.detect import detect_patterns
    return await detect_patterns(pool, org_id, lookback_days=lookback_days)


async def _knowledge(pool, org_id, query=None, client_id=None, top_k=5):
    """Rich context: hybrid search over the knowledge base.

    The KB is scoped to a `hub_clients` row, not to an org. For a client skill
    that is the client being worked on; for an org skill it is the org's own
    internal client (`is_internal=TRUE`), which is the same row the org run path
    already reads the brand profile from.

    Returns [] rather than raising when there is no query to search with — a
    skill step that names no topic has nothing to retrieve, and that is ordinary
    rather than an error.
    """
    if not query:
        return []

    if not client_id:
        client_id = await pool.fetchval(
            "SELECT id FROM staging.hub_clients "
            "WHERE org_id=$1::uuid AND is_internal=TRUE AND is_active=TRUE LIMIT 1",
            org_id,
        )
    if not client_id:
        return []

    from services.rag import search_hybrid
    hits = await search_hybrid(str(client_id), query, top_k=top_k)
    return [
        {
            "text": (h.get("chunk_text") or h.get("text") or "")[:1200],
            "source": h.get("title") or h.get("source_type") or "knowledge base",
            "score": round(h["score"], 3) if isinstance(h.get("score"), (int, float)) else None,
        }
        for h in (hits or [])
    ]


#: Everything a skill step may ask for by name, in `"context": [...]`.
SOURCES: dict[str, Source] = {
    "receivables":  Source("receivables", "Overdue customer invoices", "simple",
                           lambda pool, org_id, **kw: _overdue(pool, org_id, "invoices", kw.get("days_overdue", 0))),
    "payables":     Source("payables", "Overdue vendor bills", "simple",
                           lambda pool, org_id, **kw: _overdue(pool, org_id, "vendor_bills", kw.get("days_overdue", 0))),
    "tasks":        Source("tasks", "Overdue tasks", "simple",
                           lambda pool, org_id, **kw: _overdue(pool, org_id, "tasks", kw.get("days_overdue", 0))),
    "followups":    Source("followups", "Overdue CRM follow-ups", "simple",
                           lambda pool, org_id, **kw: _overdue(pool, org_id, "follow_ups", kw.get("days_overdue", 0))),
    "agreements":   Source("agreements", "Agreements still unsigned", "simple",
                           lambda pool, org_id, **kw: _overdue(pool, org_id, "esign", kw.get("days_overdue", 14))),
    "kpis":         Source("kpis", "Business KPIs", "simple",
                           lambda pool, org_id, **kw: _kpis(pool, org_id, kw.get("period", "30d"))),
    "stock":        Source("stock", "Items below reorder level", "simple",
                           lambda pool, org_id, **kw: _low_stock(pool, org_id)),
    "deal_health":  Source("deal_health", "Pipeline health scores", "simple",
                           lambda pool, org_id, **kw: _deal_health(pool, org_id)),
    "attendance":   Source("attendance", "Attendance patterns", "simple",
                           lambda pool, org_id, **kw: _attendance(pool, org_id, kw.get("lookback_days", 30))),
    "knowledge":    Source("knowledge", "From your documents", "rich",
                           lambda pool, org_id, **kw: _knowledge(
                               pool, org_id, query=kw.get("query"),
                               client_id=kw.get("client_id"), top_k=kw.get("top_k", 5))),
}


def _truncate_rows(data: Any) -> tuple[Any, int]:
    """Cap a source's payload. Returns (capped, n_dropped)."""
    if isinstance(data, list) and len(data) > MAX_ROWS_PER_SOURCE:
        return data[:MAX_ROWS_PER_SOURCE], len(data) - MAX_ROWS_PER_SOURCE
    return data, 0


async def build_context(
    pool,
    org_id: str,
    sources: list[str],
    *,
    query: Optional[str] = None,
    client_id: Optional[str] = None,
    params: Optional[dict] = None,
) -> dict:
    """Fetch every requested source concurrently.

    One source failing must never take the run with it — a KB whose embedding
    provider is down should cost you the documents, not the receivables. Each
    result is tagged `ok`, and a failure is carried into the rendered block as an
    explicit "unavailable" line rather than being dropped. The model is allowed
    to know less; it is not allowed to be told something false.

    Unknown source names are reported the same way, so a template naming a source
    that does not exist says so instead of quietly grounding on nothing.
    """
    params = params or {}
    wanted = [s for s in (sources or []) if s]
    if not wanted:
        return {}

    async def _one(key: str) -> tuple[str, dict]:
        src = SOURCES.get(key)
        if not src:
            return key, {"ok": False, "label": key, "kind": "simple",
                         "error": "no such context source"}
        try:
            kw = {**params, "query": query, "client_id": client_id}
            data = await src.fetch(pool, org_id, **kw)
            data, dropped = _truncate_rows(data)
            return key, {"ok": True, "label": src.label, "kind": src.kind,
                         "data": data, "dropped": dropped}
        except Exception as exc:                      # noqa: BLE001 — reported, not swallowed
            log.warning("Context source %s failed for org %s: %s", key, org_id, exc)
            return key, {"ok": False, "label": src.label, "kind": src.kind,
                         "error": f"{type(exc).__name__}"}

    results = await asyncio.gather(*(_one(k) for k in wanted))
    return dict(results)


def render_context(ctx: dict, *, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """Turn fetched context into the block that precedes the step's own prompt.

    Simple before rich: the exact numbers are what the answer should be built on,
    and the documents are supporting material. Within the character budget the
    simple sources are therefore filled first — if something has to go, it is a
    paragraph of prose rather than the receivables total.

    Sources that failed are listed by name at the end. That line is the whole
    reason this returns a string rather than raw JSON: the model has to be able
    to say "I could not see your invoices", and it can only say that if it is
    told.
    """
    if not ctx:
        return ""

    simple = [v for v in ctx.values() if v.get("ok") and v.get("kind") == "simple"]
    rich = [v for v in ctx.values() if v.get("ok") and v.get("kind") == "rich"]
    failed = [v for v in ctx.values() if not v.get("ok")]

    out: list[str] = [
        "CONTEXT — the organisation's own current data. Ground every claim in it.",
        "Do not invent figures. If something needed is absent, say so plainly.",
    ]
    budget = max_chars - sum(len(line) for line in out)
    skipped: list[str] = []

    for group in (simple, rich):
        for item in group:
            data = item.get("data")
            if data in (None, [], {}):
                block = f"\n## {item['label']}\nNothing found."
            else:
                body = json.dumps(data, default=str, ensure_ascii=False, indent=None)
                note = ""
                if item.get("dropped"):
                    note = f"\n({item['dropped']} more not shown — this is the first {MAX_ROWS_PER_SOURCE}.)"
                block = f"\n## {item['label']}\n{body}{note}"

            if len(block) > budget:
                skipped.append(item["label"])
                continue
            out.append(block)
            budget -= len(block)

    if failed:
        out.append("\n## Unavailable\n" + ", ".join(
            f"{f['label']} ({f.get('error', 'failed')})" for f in failed
        ) + "\nTreat these as unknown, not as empty.")

    if skipped:
        # Named, never silent. A truncated context reads exactly like a complete
        # one, and the model will answer over half the data just as confidently.
        out.append("\n## Omitted for length\n" + ", ".join(skipped))

    return "\n".join(out)


async def context_for_step(
    pool, step: dict, org_id: str, variables: dict, client_id: Optional[str] = None
) -> str:
    """Build and render the context a single step asked for.

    A step opts in by naming sources:

        {"agent_type": "email", "context": ["receivables", "knowledge"],
         "prompt_template": "Draft this month's collection emails."}

    A step that names none gets "", which is exactly the behaviour every skill
    had before this module existed — so adding it changes nothing for the six
    content templates already in the catalog until they ask for something.
    """
    sources = step.get("context") or []
    if not sources:
        return ""

    query = step.get("context_query") or step.get("prompt_template") or ""
    query = query[:500]

    ctx = await build_context(
        pool, org_id, sources,
        query=query,
        client_id=client_id,
        params={**(variables or {}), **(step.get("context_params") or {})},
    )
    return render_context(ctx)
