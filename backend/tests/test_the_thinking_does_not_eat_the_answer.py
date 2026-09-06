"""`max_tokens` was one budget doing two jobs, and the thinking spent it first.

── WHAT WAS MEASURED ──────────────────────────────────────────────────────────

`hub_ai_logs`, successful calls since 2026-08-01, by completion token count:

    provider          calls  at the 2,048 ceiling   max seen
    qwen_flash           42                     7      3,476
    gemini_flash_or      51                     0        630
    gemini_pro_or         9                     0      2,206
    gemini                8                     0        487

7 of 42 — **17%** — stopped at exactly 2,050 tokens against the 2,048 this path
sends. No other model comes near it. The content those calls produced is in
`hub_content_items`, and five of six end mid-sentence:

    "...through the seasonal transition"           437 chars   2,050 tokens
    "...As these figures are absent"               519 chars   2,050 tokens
    "...we cannot currently specify"               227 chars   2,050 tokens
    "...Provide the missing inputs so the"         918 chars   2,050 tokens
    "...*Audio:* “"                                953 chars   2,050 tokens

227 to 953 characters of visible text — 60 to 250 tokens — out of 2,050 billed.
Qwen3.6 is a reasoning model; OpenRouter returns the thinking under its own key
and not in `content`, so it was charged for and discarded, and the answer got
whatever was left. When nothing was left, `content` came back null and the skill
runner crashed (Sentry PYTHON-FASTAPI-6,
`tests/test_an_empty_answer_is_not_an_answer.py`).

── WHY A BUDGET RATHER THAN A BIGGER CEILING ──────────────────────────────────

Raising `max_tokens` alone buys the answer room by making the call slower, and
this chain is already close to its limit: those 7 calls averaged 14,912 ms
against the 20,000 ms bulk budget in `LATENCY_BUDGET_MS`, at roughly 138
tokens/sec. Another 1,024 tokens of thinking is another seven seconds. The 4
calls that finished at 422 tokens averaged 2,916 ms. Capping the thinking is the
only lever that removes tokens instead of adding them.

── WHAT THESE PIN ─────────────────────────────────────────────────────────────

That the answer always keeps the full budget its caller asked for; that the
thinking gets a bounded allowance on top; that **Groq never sees the parameter**;
and that a truncated answer is no longer silent.

⚠ ONE THING THESE CANNOT PIN. Whether Alibaba honours `reasoning.max_tokens` as
a hard cap is not testable from here — there is no OpenRouter key on this
machine. These tests pin the REQUEST, which is the half this repo controls. The
response half is settled after a deploy by watching whether `completion_tokens`
for `provider='qwen_flash'` still clusters at a ceiling; see the docstring on
`_apply_token_budget`.
"""
from unittest.mock import MagicMock

import pytest

import services.ai_router as R


OPENROUTER = "https://openrouter.ai/api/v1"
GROQ = "https://api.groq.com/openai/v1"


@pytest.fixture
def sent(monkeypatch):
    """Captures the JSON body actually put on the wire."""
    box = {}

    async def _post(self, url, **kw):
        box["url"] = url
        box["payload"] = kw.get("json")
        resp = MagicMock()
        resp.json = lambda: {
            "id": "gen-test",
            "choices": [{"message": {"content": "a caption"},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
        resp.raise_for_status = lambda: None
        return resp
    monkeypatch.setattr("httpx.AsyncClient.post", _post)
    return box


# ── the allowance itself ────────────────────────────────────────────────────

class TestTheAllowance:
    @pytest.mark.parametrize("answer,expected", [
        (2048, 1024),   # content generation — the size that truncated
        (4096, 1024),   # blog/seo/campaign, capped rather than doubled
        (900,   450),   # sanvaad_sahayak chat
        (512,   256),   # services/ai/reranker.py — the smallest live caller
        (100,   256),   # floored: a tiny answer still needs room to think
    ])
    def test_it_is_half_the_answer_floored_at_256_and_capped_at_1024(
            self, answer, expected):
        assert R._reasoning_allowance(answer) == expected

    def test_a_small_caller_is_not_handed_a_huge_think(self):
        """⚠ THE RERANKER. `max_tokens=512` asking for a JSON array of scores.
        An unbounded think against that budget returns no JSON at all, and the
        caller falls back to unranked chunks without anything saying why."""
        assert R._reasoning_allowance(512) < 512

    def test_the_allowance_never_exceeds_the_cap(self):
        for answer in (1, 512, 2048, 4096, 65536, 1_000_000):
            assert 256 <= R._reasoning_allowance(answer) <= 1024


# ── the request that goes to OpenRouter ─────────────────────────────────────

class TestOpenRouterGetsABoundedThink:
    @pytest.mark.anyio
    async def test_the_answer_keeps_the_whole_budget_it_asked_for(self, sent):
        """⚠ THE REGRESSION. The caller means "the answer may be this long".
        Sharing that number with the thinking is the entire defect."""
        await R._call_openai_compat("k", OPENROUTER, "qwen/qwen3.6-flash", "p",
                                    max_tokens=2048)
        payload = sent["payload"]
        allowance = payload["reasoning"]["max_tokens"]
        assert payload["max_tokens"] - allowance >= 2048, (
            f"the answer was left {payload['max_tokens'] - allowance} tokens of "
            f"the 2048 its caller asked for; the thinking is eating it again"
        )

    @pytest.mark.anyio
    async def test_the_think_is_capped_and_declared(self, sent):
        await R._call_openai_compat("k", OPENROUTER, "qwen/qwen3.6-flash", "p",
                                    max_tokens=2048)
        assert sent["payload"]["reasoning"] == {"max_tokens": 1024}
        assert sent["payload"]["max_tokens"] == 3072

    @pytest.mark.anyio
    async def test_the_ceiling_is_higher_than_it_was_either_way(self, sent):
        """The half that does not depend on Alibaba honouring the cap.

        If `reasoning.max_tokens` is ignored, the answer still has 1,024 tokens
        more room than it had — so the worst case of the unverified half is a
        slower call, not a truncated one.
        """
        await R._call_openai_compat("k", OPENROUTER, "qwen/qwen3.6-flash", "p",
                                    max_tokens=2048)
        assert sent["payload"]["max_tokens"] > 2048


# ── the gate ────────────────────────────────────────────────────────────────

class TestGroqNeverSeesIt:
    @pytest.mark.anyio
    async def test_no_reasoning_object_reaches_groq(self, sent):
        """⚠ THE ONE THAT MATTERS MOST.

        `_call_openai_compat` serves Groq as well as OpenRouter, and Groq's API
        has no `reasoning` object. Groq is the EMERGENCY provider — the last
        entry in every chain — so a 400 here is a 400 at the moment everything
        else has already failed.
        """
        await R._call_openai_compat("k", GROQ, "llama-3.3-70b-versatile", "p",
                                    max_tokens=2048)
        assert "reasoning" not in sent["payload"], (
            "the reasoning object was sent to Groq, which does not accept it")

    @pytest.mark.anyio
    async def test_groq_gets_exactly_the_budget_it_always_got(self, sent):
        """Not raised either. The ceiling lift is the other half of a bargain
        Groq is not part of — it is not a reasoning model and does not need the
        room."""
        await R._call_openai_compat("k", GROQ, "llama-3.3-70b-versatile", "p",
                                    max_tokens=2048)
        assert sent["payload"]["max_tokens"] == 2048

    @pytest.mark.anyio
    async def test_the_gate_is_the_url_and_not_the_model_name(self, sent):
        """A Qwen model served from Groq's endpoint must still not get it.
        Keying on the model name would send `reasoning` to whichever host
        happened to be serving a name that looks like a reasoning model."""
        await R._call_openai_compat("k", GROQ, "qwen/qwen3.6-flash", "p",
                                    max_tokens=2048)
        assert "reasoning" not in sent["payload"]


# ── what must not change ────────────────────────────────────────────────────

class TestWhatMustNotChange:
    @pytest.mark.anyio
    async def test_every_other_field_is_untouched(self, sent):
        await R._call_openai_compat("k", OPENROUTER, "qwen/qwen3.6-flash",
                                    "the prompt", system="the system",
                                    max_tokens=2048)
        p = sent["payload"]
        assert p["model"] == "qwen/qwen3.6-flash"
        assert p["temperature"] == 0.7
        assert p["messages"] == [{"role": "system", "content": "the system"},
                                 {"role": "user", "content": "the prompt"}]

    @pytest.mark.anyio
    async def test_the_system_message_is_still_omitted_when_absent(self, sent):
        await R._call_openai_compat("k", OPENROUTER, "m", "the prompt")
        assert sent["payload"]["messages"] == [
            {"role": "user", "content": "the prompt"}]

    @pytest.mark.anyio
    async def test_the_answer_still_comes_back(self, sent):
        out = await R._call_openai_compat("k", OPENROUTER, "m", "p")
        assert out["text"] == "a caption"
        assert out["finish_reason"] == "stop"


# ── truncation stopped being silent ─────────────────────────────────────────

class TestATruncatedAnswerIsSaidOutLoud:
    @pytest.mark.anyio
    async def test_it_warns_with_the_numbers(self, monkeypatch, caplog):
        """Five of six truncated answers were written to `hub_content_items`
        mid-sentence with nothing anywhere saying so. The rate is only known
        because one of them came back empty and crashed."""
        pool = _FakePool()

        async def _pool():
            return pool
        monkeypatch.setattr(R, "get_pool", _pool)
        monkeypatch.setattr(R, "_select_providers", lambda *a, **k: ["qwen_flash"])

        async def _providers():
            return {"qwen_flash": {"code": "qwen_flash",
                                   "default_model": "qwen/qwen3.6-flash",
                                   "api_base_url": OPENROUTER}}
        monkeypatch.setattr(R, "_get_providers", _providers)
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")

        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": "a caption cut off mid-", "finish_reason": "length",
                    "prompt_tokens": 153, "completion_tokens": 2050,
                    "cost_usd": 0.0023, "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with caplog.at_level("WARNING"):
            out = await R.generate(prompt="p", org_id="o")

        assert out["text"] == "a caption cut off mid-", (
            "the truncated answer was thrown away; half a blog post is worth "
            "more than none, and it was already paid for")
        warned = [r.getMessage() for r in caplog.records if "TRUNCATED" in r.getMessage()]
        assert warned, "a truncated answer was returned with nothing said about it"
        assert "2050" in warned[0]

    @pytest.mark.anyio
    async def test_a_complete_answer_says_nothing(self, monkeypatch, caplog):
        """⚠ MUST NOT CHANGE. A warning on every call is a warning on none."""
        pool = _FakePool()

        async def _pool():
            return pool
        monkeypatch.setattr(R, "get_pool", _pool)
        monkeypatch.setattr(R, "_select_providers", lambda *a, **k: ["qwen_flash"])

        async def _providers():
            return {"qwen_flash": {"code": "qwen_flash",
                                   "default_model": "qwen/qwen3.6-flash",
                                   "api_base_url": OPENROUTER}}
        monkeypatch.setattr(R, "_get_providers", _providers)
        monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")

        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": "a complete caption.", "finish_reason": "stop",
                    "prompt_tokens": 10, "completion_tokens": 5,
                    "cost_usd": 0.0, "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with caplog.at_level("WARNING"):
            await R.generate(prompt="p", org_id="o")
        assert not [r for r in caplog.records if "TRUNCATED" in r.getMessage()]


class TestTheStreamingPathGetsTheSameDeal:
    """One writer, two callers. `_call_openai_compat` and
    `_stream_openai_compat` build different payloads for the same call, and
    both shared one budget between thinking and answering. Fixing only the
    blocking half is how the streaming half of the traffic keeps a defect the
    other half is fixed for — which is the drift `_record_generation` already
    exists to prevent, and says so."""

    def test_both_callers_go_through_the_one_writer(self):
        import inspect
        for fn in (R._call_openai_compat, R._stream_openai_compat):
            src = inspect.getsource(fn)
            assert "_apply_token_budget(payload" in src, (
                f"{fn.__name__} builds its payload without the shared budget")
            assert '"reasoning"' not in src, (
                f"{fn.__name__} sets reasoning itself; the gate will drift")

    @pytest.mark.anyio
    async def test_a_streamed_openrouter_call_carries_the_budget(self, monkeypatch):
        box = {}

        class _Resp:
            status_code = 200
            headers = {}

            def raise_for_status(self):
                return None

            async def aiter_lines(self):
                yield 'data: {"choices":[{"delta":{"content":"hi"}}]}'
                yield "data: [DONE]"

        class _Ctx:
            async def __aenter__(self_inner):
                return _Resp()

            async def __aexit__(self_inner, *a):
                return False

        def _stream(self, method, url, **kw):
            box["payload"] = kw.get("json")
            return _Ctx()
        monkeypatch.setattr("httpx.AsyncClient.stream", _stream)

        async for _ in R._stream_openai_compat("k", OPENROUTER, "qwen/qwen3.6-flash",
                                               "p", max_tokens=2048):
            pass
        assert box["payload"]["reasoning"] == {"max_tokens": 1024}
        assert box["payload"]["max_tokens"] == 3072
        assert box["payload"]["stream"] is True, "the stream flags were disturbed"


class _FakePool:
    async def execute(self, *a, **kw):
        return None

    async def fetchval(self, *a, **kw):
        return None

    async def fetch(self, *a, **kw):
        return []
