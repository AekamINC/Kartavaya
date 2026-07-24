"""
scorers.py — Evaluation scoring functions for RAG pipeline.
Includes retrieval metrics (F1, Recall@K, MRR) and answer quality (LLM-as-judge).
"""
import json
import logging
from typing import Optional

log = logging.getLogger(__name__)


def f1_score(retrieved: set, relevant: set) -> float:
    """Compute F1 score between retrieved and relevant chunk sets.

    Args:
        retrieved: Set of retrieved chunk IDs.
        relevant: Set of ground-truth relevant chunk IDs.

    Returns:
        F1 score between 0.0 and 1.0.
    """
    if not retrieved and not relevant:
        return 1.0
    if not retrieved or not relevant:
        return 0.0

    tp = len(retrieved & relevant)
    precision = tp / len(retrieved)
    recall = tp / len(relevant)

    if precision + recall == 0:
        return 0.0
    return 2 * (precision * recall) / (precision + recall)


def recall_at_k(retrieved_ranked: list, relevant: set, k: int) -> float:
    """Compute Recall@K — fraction of relevant items found in top-K results.

    Args:
        retrieved_ranked: Ordered list of retrieved chunk IDs (best first).
        relevant: Set of ground-truth relevant chunk IDs.
        k: Number of top results to consider.

    Returns:
        Recall@K between 0.0 and 1.0.
    """
    if not relevant:
        return 1.0
    top_k = set(retrieved_ranked[:k])
    return len(top_k & relevant) / len(relevant)


def mrr(retrieved_ranked: list, relevant: set) -> float:
    """Compute Mean Reciprocal Rank.

    Args:
        retrieved_ranked: Ordered list of retrieved chunk IDs (best first).
        relevant: Set of ground-truth relevant chunk IDs.

    Returns:
        Reciprocal rank of first relevant result, or 0.0 if none found.
    """
    for i, chunk_id in enumerate(retrieved_ranked):
        if chunk_id in relevant:
            return 1.0 / (i + 1)
    return 0.0


def citation_accuracy(response_text: str, valid_refs: set[str]) -> dict:
    """Check that all citations in the response reference valid sources.

    Args:
        response_text: The generated response text.
        valid_refs: Set of valid reference numbers as strings (e.g., {"1", "2", "3"}).

    Returns:
        Dict with total_citations, valid_citations, invalid_citations, accuracy.
    """
    import re
    cited = re.findall(r'\[(\d+)\]', response_text)
    total = len(cited)
    valid = sum(1 for c in cited if c in valid_refs)
    invalid = total - valid

    return {
        "total_citations": total,
        "valid_citations": valid,
        "invalid_citations": invalid,
        "accuracy": valid / total if total > 0 else 1.0,
    }


def faithfulness_score(answer: str, context_chunks: list[str]) -> float:
    """Simple heuristic faithfulness score.

    Checks what fraction of substantive sentences in the answer
    have lexical overlap with the provided context.

    Args:
        answer: Generated answer text.
        context_chunks: List of context chunk texts.

    Returns:
        Score between 0.0 and 1.0.
    """
    if not answer or not context_chunks:
        return 0.0

    combined_context = " ".join(context_chunks).lower()
    context_words = set(combined_context.split())

    sentences = [s.strip() for s in answer.replace(".", ".\n").split("\n") if len(s.strip().split()) > 3]
    if not sentences:
        return 1.0

    grounded = 0
    for sent in sentences:
        sent_words = set(sent.lower().split())
        # Remove common stop words for overlap check
        stop = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "and", "or", "it", "this", "that", "with"}
        meaningful = sent_words - stop
        if not meaningful:
            grounded += 1
            continue
        overlap = len(meaningful & context_words) / len(meaningful)
        if overlap > 0.3:
            grounded += 1

    return grounded / len(sentences)


async def llm_judge_faithfulness(
    question: str,
    answer: str,
    context: str,
    generate_fn,
) -> dict:
    """Use an LLM to judge answer faithfulness to context.

    Args:
        question: Original question.
        answer: Generated answer.
        context: Concatenated context chunks.
        generate_fn: async function matching ai_router.generate signature.

    Returns:
        Dict with score (1-5), reasoning.
    """
    prompt = (
        f"Judge whether the following answer is faithful to the provided context. "
        f"Score 1-5 where:\n"
        f"1 = completely fabricated, no basis in context\n"
        f"2 = mostly fabricated with minor context overlap\n"
        f"3 = partially faithful, some claims unsupported\n"
        f"4 = mostly faithful, minor unsupported details\n"
        f"5 = fully faithful, all claims supported by context\n\n"
        f"Question: {question}\n\n"
        f"Context:\n{context}\n\n"
        f"Answer: {answer}\n\n"
        f"Return JSON: {{\"score\": <1-5>, \"reasoning\": \"<brief explanation>\"}}"
    )

    try:
        result = await generate_fn(
            prompt=prompt,
            system="You are a faithfulness judge. Output only valid JSON.",
            max_tokens=256,
            language="en",
            agent_type="chatbot",
            task="chatbot",
        )
        text = result.get("text", "").strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception as exc:
        log.error("LLM judge failed: %s", exc)

    return {"score": 0, "reasoning": "Judge failed"}
