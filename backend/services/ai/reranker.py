"""
reranker.py — LLM-based re-ranking for RAG results.
Takes top-N results from hybrid search and uses a cheap LLM call
to score relevance, returning the best chunks.
"""
import json
import logging
from typing import Optional

from services.ai_router import generate

log = logging.getLogger(__name__)


async def rerank(
    query: str,
    chunks: list[dict],
    *,
    top_k: int = 5,
    client_id: Optional[str] = None,
) -> list[dict]:
    """Re-rank chunks by LLM-judged relevance to the query.

    Takes up to 20 chunks from hybrid search, asks a cheap model to score
    each 1-10 for relevance, and returns the top_k highest-scored chunks.
    Cost: ~$0.01 per call using Scout-tier model.
    """
    if not chunks:
        return []

    if len(chunks) <= top_k:
        return chunks

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
            max_tokens=512,
            language="en",
            agent_type="chatbot",
            task="chatbot",
        )

        text = result.get("text", "").strip()
        # Extract JSON array from response
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            scores = json.loads(text[start:end])
        else:
            log.warning("Reranker returned no valid JSON, falling back to original order")
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
        return chunks[:top_k]
