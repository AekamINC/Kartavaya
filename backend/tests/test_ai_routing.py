"""
Three bugs that made the chatbot a different product from the one that shipped.

All three were invisible in exactly the same way: every one of them lived in an
argument that was passed, accepted, and then never read by the thing it was
meant to steer. Nothing raised, nothing logged, nothing looked broken. The
chatbot answered.

  1 · `ai_router._select_providers` branches on `task`. `agent_type` only picks
      a quality tier WITHIN a task. `routers/hub_chat.py` passed
      `agent_type="chatbot"` and no task at all, so the chat call fell past
      every branch onto the English bulk chain — GLM-4.5-Air, the free model the
      product uses for throwaway social captions. Every chatbot answer this
      product has ever given came from there.

  2 · Web grounding was dead twice. `use_grounding = task == "chatbot"` was
      False for the same reason as (1); and even once it fired, `generate`'s
      return dict listed six keys and `grounding_sources` was not one of them,
      so the pages the answer was grounded on were dropped on the floor between
      `_call_gemini` and a chat layer that has read `ai_result["grounding_
      sources"]` the whole time and always got `[]`.

  3 · `language="en"` was a literal in the chat call. Ten Indic languages,
      models chosen for them, a branch in `_select_providers` written for them —
      never reached by a customer.

WHAT THESE TESTS ASSERT ON, and why it is not what the obvious version asserts:

A test that stubs `generate()` and checks the stub was called proves the chatbot
called an AI. All three bugs pass that test. So the load-bearing cases here take
the kwargs the chat router really passes and feed them to the REAL
`_select_providers` and the REAL `generate`, and assert on the provider chain
that comes out and on the arguments that reach the provider call. Bug 1 is not
"the string 'chatbot' appears somewhere" — it is "these arguments select GLM",
and that is the sentence under test.

Mutation-tested on 2026-08-05: each fix was reverted one at a time and the
mapping from bug to failing test recorded in the commit report. A test that
survives its own bug being reinstated is decoration.
"""
import ast
import inspect
import json
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

import services.ai_router as R
from services import credits

ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "22222222-2222-2222-2222-222222222222"
SESSION = "33333333-3333-3333-3333-333333333333"
MSG = "44444444-4444-4444-4444-444444444444"
USER = "user_test001"

# Real sentences in real scripts. Transliterated Hindi ("mera invoice kahan
# hai") is deliberately absent from the Indic cases and present in the English
# ones: it is Latin script, script detection calls it English, and that is the
# correct and honest answer from a detector that reads characters.
GUJARATI = "અમારી GST ફાઇલિંગની છેલ્લી તારીખ કઈ છે?"
HINDI = "हमारी जीएसटी फाइलिंग की आखिरी तारीख क्या है?"
TAMIL = "எங்கள் விலைப்பட்டியல் எங்கே?"
ENGLISH = "What is the last date for our GST filing?"


# ══════════════════════════════════════════════════════════════════════════════
# Harness — a chat request that runs the real router code
# ══════════════════════════════════════════════════════════════════════════════

class _Conn:
    def __init__(self):
        self.in_txn = False

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self_):
                conn.in_txn = True
                return conn

            async def __aexit__(self_, *a):
                conn.in_txn = False
                return False

        return _T()

    async def fetchval(self, sql, *args):
        if "INSERT INTO staging.hub_chat_messages" in sql:
            return MSG
        return None

    async def execute(self, sql, *args):
        return "OK"


class _Pool:
    """Answers by SQL substring and records every statement WITH ITS ARGUMENTS.

    The arguments are the point. `test_a_grounded_answer_is_stored_with_its_web_
    sources` has to read the jsonb payload the assistant row was written with —
    a pool that recorded only SQL text would let a router that formats the
    sources into nothing at all pass.
    """

    def __init__(self, rows=None):
        self.conn = _Conn()
        self.rows = rows or {}
        self.calls = []          # (sql, args)

    def acquire(self):
        conn = self.conn

        class _A:
            async def __aenter__(self_):
                return conn

            async def __aexit__(self_, *a):
                return False

        return _A()

    def _lookup(self, sql):
        for needle, value in self.rows.items():
            if needle in sql:
                return value
        return None

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return self._lookup(sql)

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        return self._lookup(sql)

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return self._lookup(sql) or []

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        return "OK"

    def args_of(self, needle):
        """The arguments of the first statement containing `needle`."""
        for sql, args in self.calls:
            if needle in sql:
                return args
        raise AssertionError(f"no statement matching {needle!r} was executed")


def _chat_pool():
    return _Pool(rows={
        "FROM staging.hub_chat_sessions": {"client_id": CLIENT},
        "COUNT(*) FROM staging.hub_chat_messages": 1,
        "hub_brand_profiles": None,
    })


def _stub_credits(monkeypatch):
    """The money is not what is under test here; `tests/test_credit_model.py`
    and `tests/test_unmetered_channels_now_charge.py` own it between them.
    Stubbed so a routing test cannot fail for a billing reason."""
    async def _spend(conn=None, **kw):
        return credits.Receipt(
            tx_id="tx-1", org_id=kw.get("org_id"), user_id=kw.get("user_id"),
            kind=kw.get("kind", ""), ref_id=kw.get("ref_id"), quantity=1,
            credits=2, from_allowance=2, from_purchased=0, balance_after=0,
            metered_only=False, replayed=False,
        )

    async def _refund_standalone(**kw):
        return None

    monkeypatch.setattr(credits, "spend", _spend)
    monkeypatch.setattr(credits, "refund_standalone", _refund_standalone)


async def _send(monkeypatch, message=ENGLISH, generate_result=None, pool=None,
                kb_hits=None):
    """Drive `POST /chat/sessions/{id}/send` and hand back what it passed to
    `ai_router.generate`.

    Returns (captured_kwargs, response, pool). `captured` is the real call —
    every routing assertion in this file reads it rather than trusting a mock's
    return value.
    """
    from routers import hub_chat
    from routers.hub_chat import ChatMessage

    pool = pool or _chat_pool()
    _stub_credits(monkeypatch)
    monkeypatch.setattr(hub_chat, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(hub_chat, "search_hybrid", AsyncMock(return_value=[]))
    monkeypatch.setattr(hub_chat, "rerank", AsyncMock(return_value=kb_hits or []))

    captured = {}

    async def _gen(**kw):
        captured.update(kw)
        return generate_result or {
            "text": "answer", "model": "m", "provider": "p", "cost_usd": 0.004,
            "prompt_tokens": 1, "completion_tokens": 1, "grounding_sources": [],
        }

    monkeypatch.setattr(hub_chat, "generate", _gen)

    out = await hub_chat.send_chat_message(
        session_id=UUID(SESSION),
        body=ChatMessage(message=message),
        user={"user_id": USER},
        org_id=ORG,
        _gate=None,
    )
    assert captured, "send_chat_message never reached the AI router"
    return captured, out, pool


# ══════════════════════════════════════════════════════════════════════════════
# BUG 1 · The chatbot ran on the free social-captions chain
# ══════════════════════════════════════════════════════════════════════════════

async def test_what_chat_passes_actually_selects_the_chatbot_chain(monkeypatch):
    """
    THE test for bug 1, and the reason it is written this way.

    It does not assert that the string "chatbot" was passed — a router that
    passed `agent_type="chatbot"` and no task did exactly that, for two years,
    while serving every answer off GLM-4.5-Air. It takes the kwargs chat really
    hands over and runs them through the REAL `_select_providers`, then asserts
    on the chain that falls out. That is the sentence that was false.
    """
    captured, _, _ = await _send(monkeypatch)

    chain = R._select_providers(
        language=captured["language"],
        agent_type=captured["agent_type"],
        task=captured["task"],
    )

    # UPDATED 2026-08-16. This used to assert `chain[0] == "gemini"`, because
    # Gemini direct was the only provider grounding could attach to. Chat's web
    # search is Serper now — it runs before `generate` and renders into the
    # prompt — so that reason is gone, English chat leads with the free model,
    # and the direct `gemini` provider is retired entirely.
    #
    # The bug this test exists for is unchanged: chat must select the CHATBOT
    # chain and not the English-bulk default. Both now open with `glm`, so the
    # head no longer distinguishes them — `qwen_plus` does. It is the chatbot
    # chain's strong reasoner and appears in no bulk chain.
    assert chain != R._select_providers(), (
        "chat's arguments select the DEFAULT chain, which is English bulk "
        "social captions. This is bug 1 exactly."
    )
    assert "qwen_plus" in chain, (
        f"chat's own arguments select {chain!r}, which carries no strong "
        f"reasoner — that is the bulk-caption chain, not the chatbot one."
    )
    assert "gemini" not in chain, "chat is spending the Google prepay again"


def test_agent_type_alone_reaches_no_branch_at_all(monkeypatch):
    """
    Why bug 1 was silent for so long: `agent_type="chatbot"` is not wrong-looking.
    It is simply not read. It is in neither QUALITY_AGENTS nor PREMIUM_AGENTS and
    `_select_providers` has no branch for it, so it falls to the last line.
    """
    with_agent_only = R._select_providers(language="en", agent_type="chatbot", task="content")

    assert with_agent_only == R._select_providers(), "agent_type='chatbot' changed nothing"
    assert with_agent_only[0] == "glm", (
        "the pre-fix chatbot ran on GLM-4.5-Air, the free bulk-caption model"
    )


def test_the_chatbot_chain_leads_with_the_right_model_for_the_language():
    """REPLACES `..._leads_with_gemini_direct_in_every_language`.

    That test encoded a reason that expired: Gemini direct led every language
    because it was the only provider `tools: [{google_search: {}}]` could be
    attached to. Chat's search is Serper now, and Serper runs before the model
    and renders into the prompt, so grounding no longer constrains the ordering.

    What DOES still constrain it is the language. English leads with the free
    model, because a saving with paid models behind it costs nothing. Indic
    leads with a Gemini-family model, because that branch exists precisely to
    stop an English-reasoning model answering a Gujarati question in
    transliterated mush — and cheapness is not worth an unusable answer.
    """
    assert R._select_providers(language="en", task="chatbot")[0] == "glm"
    for lang in sorted(R.INDIC_LANGS):
        head = R._select_providers(language=lang, task="chatbot")[0]
        assert head.startswith("gemini"), f"{lang} leads with {head!r}"
        assert head != "gemini", (
            f"{lang} leads with the DIRECT gemini provider, which spends the "
            f"Google prepay; the OpenRouter-hosted models are the same models")


# ══════════════════════════════════════════════════════════════════════════════
# BUG 2a · Grounding never switched on
# ══════════════════════════════════════════════════════════════════════════════

def _only_gemini(monkeypatch):
    """Leave `gemini` as the only usable provider, so `generate` reaches
    `_call_gemini` regardless of what the chain says, and a grounding assertion
    is testing the grounding decision rather than the ordering decision.

    "Regardless of what the chain says" was the stated intent from the start and
    was only ever half-implemented: restricting the PROVIDER dict was enough
    while every chain still named `gemini`. Since the direct provider was
    retired on 2026-08-16 no chain names it, so the loop matched nothing and all
    four grounding tests died with "All AI providers failed" — a routing change
    breaking tests about grounding. The chain is now forced too, which is what
    the docstring always claimed.

    NOTE these tests guard code that no chain currently reaches. `_call_gemini`
    is kept because it is the only thing that can attach
    `tools: [{google_search: {}}]`, and adding `gemini` back to one chain is all
    it would take to re-enable it — better to keep it tested than to rewrite it
    from memory later."""
    monkeypatch.setattr(R, "_select_providers", lambda *a, **k: ["gemini"])
    monkeypatch.setattr(R, "_get_providers", AsyncMock(return_value={
        "gemini": {
            "code": "gemini",
            "api_base_url": "https://generativelanguage.googleapis.com/v1beta",
            "default_model": "gemini-2.0-flash-lite",
            "priority": 5, "config": {},
        },
    }))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(R, "get_pool", AsyncMock(return_value=_Pool()))

    calls = []

    async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048, grounded=False):
        calls.append({"model": model, "prompt": prompt, "system": system, "grounded": grounded})
        return {
            "text": "grounded answer", "prompt_tokens": 10, "completion_tokens": 5,
            "cost_usd": 0.001, "generation_id": "",
            "grounding_sources": [{"title": "CBIC", "url": "https://cbic.gov.in/gstr1"}],
        }

    monkeypatch.setattr(R, "_call_gemini", _call)
    return calls


async def test_the_chatbot_task_reaches_the_provider_call_with_grounding_on(monkeypatch):
    """
    Asserted on the argument handed to `_call_gemini`, not on a return value.

    `grounded=True` is what makes the payload carry `tools: [{google_search:
    {}}]`. Everything upstream of that argument is plumbing; this is the wire.
    """
    calls = _only_gemini(monkeypatch)

    await R.generate(prompt="when is GSTR-1 due?", task="chatbot")

    assert len(calls) == 1
    assert calls[0]["grounded"] is True


async def test_grounding_stays_off_for_everything_that_is_not_chat(monkeypatch):
    """A social caption must not buy live web search. `services/ai/reranker.py`
    used to pass `task="chatbot"` for exactly this reason and was made to stop —
    see `test_unmetered_channels_now_charge.py`."""
    calls = _only_gemini(monkeypatch)

    await R.generate(prompt="write a diwali post", task="content", agent_type="social_media")
    await R.generate(prompt="write a blog", task="content", agent_type="blog")

    assert [c["grounded"] for c in calls] == [False, False]


async def test_chats_own_arguments_are_what_turn_grounding_on(monkeypatch):
    """
    Closes the loop between the two files.

    The previous case proves `task="chatbot"` grounds. This one proves the chat
    router is what sends it — replaying its captured kwargs through the real
    `generate` and asserting the provider call came out grounded. A regression in
    either file alone fails it.
    """
    captured, _, _ = await _send(monkeypatch, message="what changed in GST this week?")
    calls = _only_gemini(monkeypatch)

    await R.generate(
        prompt=captured["prompt"], system=captured["system"],
        language=captured["language"], agent_type=captured["agent_type"],
        task=captured["task"],
    )

    assert calls[0]["grounded"] is True


async def test_the_stream_asks_gemini_exactly_what_the_blocking_call_asks(monkeypatch):
    """The same question, the same wire, whichever endpoint it came in on.

    `generate_stream` wrote the Gemini branch out a second time and hardcoded
    `grounded=False` and the text model, so a chat that streamed lost the search
    a chat that did not stream got — and with it every web citation, because
    `strip_invalid_refs` deletes markers whose sources were never handed over.
    Both now go through `_gemini_answer`.

    Unreachable today: no chain names `gemini` (see `_only_gemini`). This is
    what stops re-arming it from being the moment the two endpoints diverge.
    """
    calls = _only_gemini(monkeypatch)

    await R.generate(prompt="when is GSTR-1 due?", task="chatbot")
    streamed = [ev async for ev in R.generate_stream(
        prompt="when is GSTR-1 due?", task="chatbot")]

    assert [c["grounded"] for c in calls] == [True, True], \
        "the streaming endpoint asked for the same answer without the web"
    assert calls[0]["model"] == calls[1]["model"], \
        "one endpoint is on the grounding model and the other is not"
    assert streamed[-1][0] == "final"
    assert streamed[-1][1]["grounding_sources"] == \
        [{"title": "CBIC", "url": "https://cbic.gov.in/gstr1"}], \
        "the streamed answer cites nothing the blocking one cites"


# ══════════════════════════════════════════════════════════════════════════════
# BUG 2b · The sources were collected and then thrown away
# ══════════════════════════════════════════════════════════════════════════════

async def test_generate_returns_the_grounding_sources_the_provider_found(monkeypatch):
    """`_call_gemini` parses `groundingMetadata.groundingChunks` into
    `grounding_sources`. `generate`'s return dict listed six keys and dropped it,
    so the work was done, billed, and discarded one stack frame later."""
    _only_gemini(monkeypatch)

    out = await R.generate(prompt="when is GSTR-1 due?", task="chatbot")

    assert out["grounding_sources"] == [{"title": "CBIC", "url": "https://cbic.gov.in/gstr1"}]


async def test_every_provider_returns_the_same_shape(monkeypatch):
    """Present and empty on the paths that cannot ground, so no caller has to
    test which provider answered. `_call_openai_compat` does not produce the key
    at all — the default in `generate` is what makes the contract uniform."""
    monkeypatch.setattr(R, "_get_providers", AsyncMock(return_value={
        "glm": {"code": "glm", "api_base_url": "https://openrouter.ai/api/v1",
                "default_model": "thudm/glm-4.5-air:free", "priority": 2, "config": {}},
    }))
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(R, "get_pool", AsyncMock(return_value=_Pool()))
    monkeypatch.setattr(R, "_call_openai_compat", AsyncMock(return_value={
        "text": "t", "prompt_tokens": 1, "completion_tokens": 1,
        "cost_usd": 0.0, "generation_id": "g",
    }))

    out = await R.generate(prompt="hi", task="content", agent_type="social_media")

    assert out["grounding_sources"] == []


async def test_a_grounded_answer_is_stored_with_its_web_sources(monkeypatch):
    """
    Read off the INSERT's ARGUMENTS, not off the response body.

    `hub_chat_messages.sources` is a jsonb column that has existed since
    migration 017 and is what the transcript renders when the conversation is
    reopened. An endpoint that returned the citations but persisted `[]` would
    look correct for one request and lose them forever, and asserting on the
    response alone cannot tell the difference.
    """
    _, out, pool = await _send(
        monkeypatch,
        generate_result={
            "text": "GSTR-1 is due on the 11th.", "model": "gemini-2.0-flash-lite",
            "cost_usd": 0.002,
            "grounding_sources": [{"title": "CBIC circular", "url": "https://cbic.gov.in/x"}],
        },
    )

    args = pool.args_of("INSERT INTO staging.hub_chat_messages")
    stored = json.loads(args[2])

    web = [s for s in stored if s.get("type") == "web"]
    assert web == [{"title": "CBIC circular", "url": "https://cbic.gov.in/x", "type": "web"}]
    assert web == [s for s in out["sources"] if s.get("type") == "web"], (
        "what was returned and what was stored disagree"
    )


async def test_knowledge_base_citations_survive_alongside_web_sources(monkeypatch):
    """Grounding is additive. A KB chunk keeps its `ref` number — the number the
    model was told to cite it by — and the web source has none, because nothing
    numbered it into the prompt."""
    kb = [{"chunk_id": "c1", "doc_title": "Refund policy", "content": "14 days.",
           "similarity": 0.9, "source_type": "text"}]
    _, out, _ = await _send(
        monkeypatch, kb_hits=kb,
        generate_result={
            "text": "Fourteen days [1].", "model": "m", "cost_usd": 0.0,
            "grounding_sources": [{"title": "Web page", "url": "https://example.org"}],
        },
    )

    assert [s.get("ref") for s in out["sources"]] == [1, None]
    assert out["sources"][1]["type"] == "web"
    assert "[1]" in out["message"], "a valid KB citation was stripped"


# ══════════════════════════════════════════════════════════════════════════════
# BUG 3 · Language was a literal
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("text,expected", [
    (GUJARATI, "gu"),
    (HINDI, "hi"),
    (TAMIL, "ta"),
    ("আমাদের চালান কোথায়?", "bn"),
    ("మా ఇన్వాయిస్ ఎక్కడ ఉంది?", "te"),
    ("ನಮ್ಮ ಸರಕುಪಟ್ಟಿ ಎಲ್ಲಿದೆ?", "kn"),
    ("ഞങ്ങളുടെ ഇൻവോയ്സ് എവിടെ?", "ml"),
    ("ਸਾਡਾ ਬਿੱਲ ਕਿੱਥੇ ਹੈ?", "pa"),
    ("ଆମର ଚାଲାନ କେଉଁଠି?", "or"),
    (ENGLISH, "en"),
])
def test_detect_language_reads_the_script(text, expected):
    """One case per script, not one aggregate assertion: a range typo in
    `_SCRIPT_RANGES` moves exactly one language and an aggregate case would name
    the wrong one when it broke."""
    assert R.detect_language(text) == expected
    assert expected == "en" or expected in R.INDIC_LANGS, (
        f"{expected} is not a code `_select_providers` can route on"
    )


def test_every_indic_language_the_router_routes_on_is_detectable():
    """`INDIC_LANGS` and `_SCRIPT_RANGES` have to stay in step. A language the
    router has a chain for but the detector can never emit is a dead branch —
    which is precisely the state the whole file was in before this change.

    Marathi is the deliberate exception and the comment above `_SCRIPT_RANGES`
    is why: it shares Devanagari with Hindi exactly, both route identically, and
    the two are not separable from characters alone.
    """
    emittable = {code for _, _, code in R._SCRIPT_RANGES}
    assert R.INDIC_LANGS - emittable == {"mr"}
    assert emittable <= R.INDIC_LANGS


@pytest.mark.parametrize("text,expected", [
    # Code-mixed, which is how Indian users actually write. A majority rule
    # would call all three of these English.
    ("please મને GST invoice મોકલો", "gu"),
    ("Hi, GSTR-3B ક્યારે file કરવાનું?", "gu"),
    ("क्या आप invoice भेज सकते हैं", "hi"),
    # Latin script is English, and transliteration is Latin script. An honest
    # answer from a detector that reads characters.
    ("mera invoice kahan hai", "en"),
    # Digits and punctuation are evidence of nothing.
    ("2026-08-05 ??? 100%", "en"),
    ("", "en"),
    ("   ", "en"),
    ("🙏🙏🙏", "en"),
])
def test_detect_language_on_the_messages_people_really_send(text, expected):
    assert R.detect_language(text) == expected


def test_one_stray_indic_word_does_not_move_a_long_english_conversation():
    """The floor exists for this. A pasted name or a single word in a long
    English question must not reroute the whole answer onto an Indic model."""
    long_english = (
        "Could you please confirm whether the tax invoice we raised last month "
        "for the client project has been reconciled against the payment that "
        "was received, and if not, tell me which of the line items is still "
        "outstanding so that I can follow it up with the accounts team today "
    )
    assert R.detect_language(long_english + "કેવલ") == "en"
    # …and enough of it, and it is a Gujarati question again.
    assert R.detect_language(long_english[:60] + " " + GUJARATI * 2) == "gu"


async def test_chat_passes_the_language_it_detected_not_a_literal(monkeypatch):
    captured, _, _ = await _send(monkeypatch, message=GUJARATI)
    assert captured["language"] == "gu"

    captured, _, _ = await _send(monkeypatch, message=ENGLISH)
    assert captured["language"] == "en"


async def test_the_detected_language_changes_the_chain_chat_will_get(monkeypatch):
    """
    THE test for bug 3, and it is not "was 'gu' passed".

    Passing a language that changes no routing is the same defect as bug 1 in a
    different argument. The chatbot branch sits ABOVE the Indic branch in
    `_select_providers` and so used to swallow it: fixing hub_chat alone would
    have handed the router a language it read and then ignored. This runs both
    real messages through the real function and asserts the chains differ.
    """
    gu_kwargs, _, _ = await _send(monkeypatch, message=GUJARATI)
    en_kwargs, _, _ = await _send(monkeypatch, message=ENGLISH)

    gu_chain = R._select_providers(language=gu_kwargs["language"], task=gu_kwargs["task"],
                                   agent_type=gu_kwargs["agent_type"])
    en_chain = R._select_providers(language=en_kwargs["language"], task=en_kwargs["task"],
                                   agent_type=en_kwargs["agent_type"])

    assert gu_chain != en_chain, (
        "an Indic question and an English one select the same providers — the "
        "language argument is being read and discarded"
    )
    # What must differ is the FALLBACK. Qwen Plus is our strongest English
    # reasoner and answers a Gujarati question in English; the Indic chain falls
    # to the Gemini family first and reaches Qwen only after them.
    assert gu_chain[1].startswith("gemini")
    # `en_chain[1]`, not `[0]`: English now leads with the free model, so its
    # strongest reasoner sits one place further down than it used to.
    assert en_chain[0] == "glm"
    assert en_chain[1] == "qwen_plus"


async def test_the_system_prompt_asks_for_the_language_it_was_asked_in(monkeypatch):
    """
    Detection alone does not make a model answer in Gujarati — it only picks a
    model that CAN. Nothing in this prompt had ever named the reply's language,
    and the whole chain defaults to English for a code-mixed question.
    """
    captured, _, _ = await _send(monkeypatch, message=GUJARATI)
    block = captured["system"].split("LANGUAGE:")[1]

    assert "Reply in Gujarati" in block
    assert "Reply in English" not in block, (
        "the language block instructs the model to answer a Gujarati question "
        "in English"
    )

    captured, _, _ = await _send(monkeypatch, message=TAMIL)
    assert "Reply in Tamil" in captured["system"].split("LANGUAGE:")[1]


async def test_the_language_instruction_is_last_so_a_long_context_cannot_bury_it(
    monkeypatch,
):
    """It has to survive a knowledge-base block above it that can run to
    thousands of tokens. Recency is the cheapest lever there is over that, and
    a block appended before the KB context would be the first thing lost."""
    kb = [{"chunk_id": "c1", "doc_title": "Policy", "content": "x " * 2000,
           "similarity": 0.9, "source_type": "text"}]
    captured, _, _ = await _send(monkeypatch, message=HINDI, kb_hits=kb)

    system = captured["system"]
    assert "Relevant knowledge base context" in system, "this case is not exercising a KB prompt"
    assert system.index("LANGUAGE:") > system.index("Relevant knowledge base context")


async def test_an_english_question_is_still_told_to_answer_in_english(monkeypatch):
    """The instruction is unconditional. "Reply in the language you were asked
    in" only helps when the language is named, and an English speaker getting a
    Hindi reply out of a Hindi knowledge base is the same bug mirrored."""
    captured, _, _ = await _send(monkeypatch, message=ENGLISH)
    assert "LANGUAGE: The user wrote in English" in captured["system"]


# ══════════════════════════════════════════════════════════════════════════════
# The owner's non-negotiable: no image generation from chat
# ══════════════════════════════════════════════════════════════════════════════

_IMAGE_ENTRY_POINTS = {
    "generate_image",
    "generate_rich_content",
    "_generate_hf_image",
    "_generate_openrouter_image",
    "_generate_gemini_imagen",
}


def _names_bound_and_called(path: Path):
    """Imported names and called names, by AST.

    AST and not a text scan, and this is not a style preference. `hub_chat.py`
    carries a comment naming these functions to explain why they are absent, and
    three checks in this repo have already been caught asserting against their
    own commentary — one grepped a migration file and its own explanatory
    comment satisfied it. A parser sees code and only code.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    bound, called = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for a in node.names:
                bound.add(a.asname or a.name)
        elif isinstance(node, ast.Import):
            for a in node.names:
                bound.add((a.asname or a.name).split(".")[0])
        elif isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name):
                called.add(fn.id)
            elif isinstance(fn, ast.Attribute):
                called.add(fn.attr)
    return bound, called


def test_chat_cannot_reach_an_image_generator():
    """
    IMAGE GENERATION FROM CHAT IS OFF, enforced here rather than by a button
    that is not drawn.

    There is no runtime refusal in `hub_chat.py` and that is deliberate: today
    the router imports one AI entry point, `generate`, which cannot produce an
    image on any branch, so there is no reachable call to refuse. A guard on a
    dead path is decoration that reads like a control — somebody greps for it,
    finds it, and believes a hole is closed by code that never runs.

    This is the control. It fails the build on the import line, the attribute
    call, or the request field that would open it — which is the change that
    would actually matter, and the only moment at which anybody can still be
    stopped.
    """
    backend = Path(__file__).resolve().parents[1]
    bound, called = _names_bound_and_called(backend / "routers" / "hub_chat.py")

    assert not (_IMAGE_ENTRY_POINTS & bound), (
        f"routers/hub_chat.py imports {sorted(_IMAGE_ENTRY_POINTS & bound)}. "
        f"Image generation from chat is off by the owner's decision."
    )
    assert not (_IMAGE_ENTRY_POINTS & called), (
        f"routers/hub_chat.py calls {sorted(_IMAGE_ENTRY_POINTS & called)}."
    )
    # The module-qualified way in. `ai_router.generate_image(...)` binds no
    # banned NAME, and the attribute check above catches the call — but binding
    # the module at all is the step before that call and is worth naming.
    assert "ai_router" not in bound, (
        "hub_chat binds services.ai_router as a module, which puts every image "
        "entry point one attribute away. Import `generate` by name."
    )


def test_a_chat_request_cannot_ask_for_a_picture():
    """The other half of server-side: the request schema. A client that can send
    `{"message": ..., "with_image": true}` has the capability whatever the
    handler imports, and Pydantic ignoring an unknown field today is not a
    guarantee — one `with_image: bool = False` makes it real."""
    from routers.hub_chat import ChatMessage

    assert set(ChatMessage.model_fields) == {"message", "session_id"}


def test_the_chat_answer_is_text_and_the_response_carries_no_image():
    """`send_chat_message` returns message/sources/model/cost/credits. An
    `images` key is how this would ship — the frontend renders what it is
    given."""
    from routers import hub_chat

    src = inspect.getsource(hub_chat.send_chat_message)
    tree = ast.parse(inspect.cleandoc(src))
    returned_keys = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
            for k in node.value.keys:
                if isinstance(k, ast.Constant):
                    returned_keys.add(k.value)

    assert returned_keys == {"message", "sources", "model", "cost_usd", "credits_charged"}
