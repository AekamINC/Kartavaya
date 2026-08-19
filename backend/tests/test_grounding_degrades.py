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

WHOSE SOURCE IS READ, AND WHY IT MOVED. The retry used to be written inside
`generate`, and `generate_stream` — added for the chat stream — wrote the Gemini
branch out a second time WITHOUT it. Both endpoints now call `_gemini_answer`,
so the retry is asserted there and the last test pins that neither caller has
grown a copy of its own: two Gemini branches is how one endpoint grounds and the
other does not.
"""
import inspect

from services import ai_router


def _generate_src() -> str:
    return " ".join(inspect.getsource(ai_router._gemini_answer).split())


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


def test_both_entry_points_ask_gemini_the_same_way():
    """One Gemini branch, two callers.

    `generate` and `generate_stream` answer the same questions, and this is the
    only provider branch where they could differ: grounding, the pinned model
    and the retry above all live in it. A second copy would show up first as a
    streamed answer whose web citations `strip_invalid_refs` deletes, because
    the sources backing them were never collected.
    """
    for fn in (ai_router.generate, ai_router.generate_stream):
        src = " ".join(inspect.getsource(fn).split())
        assert "_gemini_answer(" in src, (
            f"{fn.__name__} no longer routes the gemini branch through "
            f"_gemini_answer")
        assert "_call_gemini(" not in src, (
            f"{fn.__name__} calls _call_gemini itself; that is the second copy "
            f"of the grounding decision this file exists to prevent")
