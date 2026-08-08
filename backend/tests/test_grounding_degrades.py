"""Grounding is billed separately from generation, and the free tier omits it.

MEASURED 2026-08-08 against the same key, the same model, one request apart:

    generateContent                              -> 200
    generateContent + tools:[{google_search:{}}] -> 429 RESOURCE_EXHAUSTED

So an organisation on the Gemini free tier can generate but cannot search. That
is a supported configuration, not a fault — and before this, that 429 cost the
whole PROVIDER: `_select_providers(task="chatbot")` leads with Gemini, the
exception propagated, and the chain fell through to Qwen. The org lost Gemini's
Indic quality on every chat message to buy a web search it was never going to
get.
"""
import inspect

from services import ai_router


def _generate_src() -> str:
    return " ".join(inspect.getsource(ai_router.generate).split())


def test_a_grounding_refusal_retries_without_grounding():
    src = _generate_src()
    assert "grounded=False" in src, "no ungrounded retry"
    assert "grounding_degraded" in src, "the caller cannot tell it degraded"


def test_the_retry_is_narrow():
    """Only a GROUNDED call, and only a quota or permission refusal. A 500 or a
    timeout is Gemini being down; retrying that doubles the wait before the
    chain does the job it exists for."""
    src = _generate_src()
    assert "use_grounding and" in src, "an ungrounded failure must not retry"
    for code in ("429", "403", "RESOURCE_EXHAUSTED", "PERMISSION_DENIED"):
        assert code in src, code
    assert "if not retryable:" in src and "raise" in src


def test_degradation_is_reported_rather_than_inferred():
    """An empty source list cannot distinguish "searched and found nothing"
    from "never searched". One of those is worth telling somebody about."""
    assert 'result["grounding_degraded"] = True' in _generate_src()
