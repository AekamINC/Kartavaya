"""
reranker.py — LLM-based re-ranking for RAG results.
Takes top-N results from hybrid search and uses a cheap LLM call
to score relevance, returning the best chunks.

TWO THINGS WERE WRONG HERE UNTIL 2026-08-04, and only one of them was billing.

1. It charged nothing. Its own docstring said "~$0.01 per call" and every chat
   message fired one. It is now priced as `channel/chatbot_rerank` and charged
   before the call, keyed on the chat message it is ranking for, so a retry of
   the same message cannot pay twice.

2. It was the single most expensive call in the product, by accident. It passed
   `task="chatbot"` — the ONLY call site in the tree that did — and
   `ai_router._select_providers` reads that flag to return the Gemini-direct
   chain, where `_call_gemini` then attaches `tools: [{google_search: {}}]`.
   So a *relevance-scoring* call, whose entire job is to compare a query against
   text we already hold, was firing a billed Google Search grounding request,
   while the user-facing answer sitting beside it in `hub_chat.send_chat_message`
   ran the free chain (it passes `agent_type="chatbot"` but leaves `task` at its
   "content" default). Removing `task` is a cost fix worth more than the credit
   this module now charges.

`org_id` is threaded in for the same reason: every `hub_ai_logs` row this module
produced landed with `org_id` NULL, so its spend was unattributable to anyone.
"""
import json
import logging
from typing import Optional

from services import credits
from services.ai_router import generate

log = logging.getLogger(__name__)


async def rerank(
    query: str,
    chunks: list[dict],
    *,
    top_k: int = 5,
    client_id: Optional[str] = None,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
    message_id: Optional[str] = None,
) -> list[dict]:
    """Re-rank chunks by LLM-judged relevance to the query.

    Takes up to 20 chunks from hybrid search, asks a cheap model to score
    each 1-10 for relevance, and returns the top_k highest-scored chunks.
    Cost: ~$0.01 per call using Scout-tier model.

    Charged as `channel/chatbot_rerank`, once, before the model is called.
    Every path that cannot charge returns `chunks[:top_k]` — the original
    hybrid-search order — WITHOUT making the call. Degraded ranking is a worse
    answer; an uncharged call is a worse business. Never the second.

    `org_id` and `message_id` are what make the charge possible. Both are one
    local away in the only caller (`hub_chat.send_chat_message`). If either is
    missing this degrades rather than guessing an org: a spend attributed to the
    wrong org is worse than a slightly worse answer, and there is no default
    that would be right.
    """
    if not chunks:
        return []

    if len(chunks) <= top_k:
        return chunks

    if not org_id or not message_id:
        # Not an error the user should see — the ranking simply does not happen.
        # It is a wiring bug in a new caller, and it is logged as one.
        log.warning(
            "Reranker skipped: no %s to bill (client %s). Falling back to "
            "hybrid-search order.",
            "org_id" if not org_id else "message_id", client_id,
        )
        return chunks[:top_k]

    # Charge first, and skip the call entirely if the org cannot afford it. The
    # answer itself has already been paid for by the time we get here, so a
    # shortfall of this one credit must not fail the whole message — it costs
    # relevance, not the reply.
    try:
        receipt = await credits.spend_standalone(
            org_id=org_id,
            user_id=user_id,
            kind="channel",
            ref_id="chatbot_rerank",
            idempotency_key=f"chat:{message_id}:rerank",
            description="Chatbot re-rank",
        )
    except credits.CreditError as exc:
        log.info(
            "Reranker not run for org %s — %s. Returning hybrid-search order.",
            org_id, getattr(exc, "code", "credit refused"),
        )
        return chunks[:top_k]

    # Build scoring prompt — enumerate chunks for the LLM
    chunk_descriptions = []
    for i, c in enumerate(chunks[:20]):
        snippet = c["content"][:300].replace("\n", " ")
        chunk_descriptions.append(f"[{i}] (source: {c.get('doc_title', 'unknown')}): {snippet}")

    scoring_prompt = (
        f"You are a relevance judge. Given a user query and a list of text chunks, "
        f"score each chunk's relevance to the query on a scale of 1-10.\n\n"
        f"Query: {query}\n\n"
        f"Chunks:\n" + "\n".join(chunk_descriptions) + "\n\n"
        f"Return ONLY a JSON array of objects with 'index' (int) and 'score' (int 1-10). "
        f'Example: [{{"index": 0, "score": 8}}, {{"index": 1, "score": 3}}]\n'
        f"No explanation, just the JSON array."
    )

    try:
        result = await generate(
            prompt=scoring_prompt,
            system="You are a relevance scoring assistant. Output only valid JSON.",
            client_id=client_id,
            org_id=org_id,
            max_tokens=512,
            language="en",
            agent_type="chatbot",
            # `task` deliberately left at its default. See the module docstring:
            # passing "chatbot" here bought a Google Search grounding request on
            # every chat message, to rank text we already had in hand.
        )

        text = result.get("text", "").strip()
        # Extract JSON array from response
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            scores = json.loads(text[start:end])
        else:
            log.warning("Reranker returned no valid JSON, falling back to original order")
            # The call happened and the provider was paid, so the credit stands.
            # A model that answered badly is not a refundable event; a call that
            # never completed is, and that is the `except` below.
            return chunks[:top_k]

        # Map scores back to chunks
        score_map = {}
        for item in scores:
            idx = item.get("index")
            score = item.get("score", 0)
            if isinstance(idx, int) and 0 <= idx < len(chunks):
                score_map[idx] = score

        # Sort chunks by LLM score descending, break ties by original similarity
        scored = []
        for i, chunk in enumerate(chunks[:20]):
            llm_score = score_map.get(i, 0)
            scored.append((llm_score, chunk.get("similarity", 0), chunk))

        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return [item[2] for item in scored[:top_k]]

    except Exception as exc:
        log.error("Reranker failed, returning original order: %s", exc)
        # No provider in the chain completed, so nothing was delivered and the
        # credit goes back. `refund_standalone` carries the never-raise contract
        # this needs — it already runs inside a handler for a failure the caller
        # is about to absorb silently.
        await credits.refund_standalone(
            tx_id=receipt.tx_id,
            reason="Chatbot re-rank did not complete",
            user_id=user_id,
        )
        return chunks[:top_k]
