"""English chat tries the free model first, Indic does not, and web search
survives either way.

WHY THIS IS A TEST AND NOT A COMMENT
------------------------------------
The chain is four hardcoded lists that look interchangeable. The reason each is
ordered as it is lives in prose above them, and prose does not fail a build.
Three separate decisions are pinned here, each of which was got wrong once.

1. **English chat leads with the free model.** It previously led with Gemini
   direct because that is the only provider grounding can attach to — a reason
   that stopped being true when chat's web search moved to Serper. Every
   English chat answer was billed for a capability it was not using.

2. **Indic chat does NOT.** The Indic branch exists because Qwen Plus "answers a
   Gujarati question in English or in transliterated mush". A Chinese-trained
   free model leading that chain invites the same defect. This test is the thing
   that stops a future cost pass applying rule 1 uniformly.

3. **Every chain ends in a paid, working provider.** A free tier that rate-limits
   must degrade to a paid answer, never to no answer.
"""
from __future__ import annotations

import pytest

from services.ai_router import INDIC_LANGS, _select_providers

FREE = "glm"


def test_english_chat_tries_the_free_model_first():
    chain = _select_providers(language="en", agent_type="chatbot", task="chatbot")
    assert chain[0] == FREE, (
        f"English chat leads with {chain[0]!r}, so every question is billed "
        f"before reaching the free model")


def test_english_chat_still_has_paid_models_behind_the_free_one():
    """The saving must not become an outage when the free tier is exhausted."""
    chain = _select_providers(language="en", agent_type="chatbot", task="chatbot")
    assert len(chain) >= 3, "nothing stands behind the free model"
    assert any(c != FREE for c in chain[1:])


def test_no_chain_spends_the_google_prepay():
    """Owner decision 2026-08-16: the direct `gemini` provider is retired.

    It is the ONLY provider keyed on GEMINI_API_KEY. The Gemini models remain
    through OpenRouter (`gemini_*_or`), so this is a change of wallet, not of
    answer quality.
    """
    from services.ai_router import PREMIUM_AGENTS, QUALITY_AGENTS
    langs = ["en", "hi", "gu"] + sorted(INDIC_LANGS)
    tasks = ["content", "chatbot"]
    agents = ["social_media", "chatbot", *sorted(QUALITY_AGENTS), *sorted(PREMIUM_AGENTS)]
    for lang in langs:
        for task in tasks:
            for agent in agents:
                chain = _select_providers(language=lang, agent_type=agent, task=task)
                assert "gemini" not in chain, (
                    f"({lang}, {agent}, {task}) still routes to the direct "
                    f"gemini provider, which spends the Google prepay")


@pytest.mark.parametrize("lang", sorted(INDIC_LANGS))
def test_indic_chat_does_not_lead_with_the_free_model(lang):
    """Cheapness is not worth an answer the reader cannot use."""
    chain = _select_providers(language=lang, agent_type="chatbot", task="chatbot")
    assert chain[0] != FREE, (
        f"{lang} chat leads with {FREE!r}; the Indic branch exists precisely "
        f"because a model that reasons in English answers an Indic question in "
        f"transliterated mush")
    # Still a Gemini-family model, now billed through OpenRouter rather than the
    # Google prepay. The branch's REASON is the model, not the wallet.
    assert chain[0].startswith("gemini"), chain


def test_web_search_does_not_depend_on_which_model_answers():
    """The premise the reorder rests on, asserted rather than assumed.

    Serper runs in `routers/hub.py` BEFORE `generate()` and renders its results
    into the prompt as text, so the answering model is irrelevant to whether the
    web was consulted. If someone moves the search behind a provider branch,
    this fails and the reorder has to be revisited.
    """
    import inspect
    from routers import hub

    src = inspect.getsource(hub)
    search_at = src.index("web_results = await web_search.search(")
    generate_at = src.index("result = await generate(", search_at)
    assert search_at < generate_at, (
        "the web search now runs after the model call, so which provider "
        "answers could decide whether the web was consulted")
    assert "render_for_prompt(web_results" in src, (
        "web results are no longer rendered into the prompt as text — they may "
        "have become provider-specific again")
