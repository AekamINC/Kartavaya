"""A provider answered 200 with nothing, and the product called it an answer.

── WHAT HAPPENED ──────────────────────────────────────────────────────────────

2026-08-31 15:35:48.795Z, one row in `hub_ai_logs`:

    provider   qwen_flash          model  qwen/qwen3.6-flash
    status     success             cost   $0.0023349375
    prompt_tokens 153              completion_tokens 2050
    latency_ms 16812

2,050 completion tokens against the 2,048-token ceiling this path sends, so the
model hit `finish_reason: "length"` — and `content` was `null`. Qwen3.6 is a
reasoning model and OpenRouter counts reasoning against `max_tokens`, so a step
whose thinking runs long emits no answer at all. Nothing upstream could see it:
HTTP 200, `usage` reporting tokens generated and billed.

39 ms later, `POST /api/v1/hub/org/skills/{skill_id}/run` 500'd on

    TypeError: expected string or bytes-like object, got 'NoneType'
    routers/hub.py:3640  ->  re.findall(r'#\\w+', result["text"])

Sentry PYTHON-FASTAPI-6, 4 events, 2026-08-21 to 2026-08-31.

── THE HALF THAT IS NOT THE CRASH ─────────────────────────────────────────────

`findall` is a tripwire, not the defect. It runs for `social_media` alone; every
other agent_type carries the same None one line further to
`hub_content_items.body`, which is NOT NULL. And the crash landed OUTSIDE the
`try` that refunds, so for run 3db1905e — "Weekly Reel Scripts" — the ledger
holds three debits and no refund:

    skillrun:3db1905e-…:step:1   -2   15:35:02Z   wrote a content item
    skillrun:3db1905e-…:step:2   -2   15:35:16Z   wrote a content item
    skillrun:3db1905e-…:step:3   -2   15:35:31Z   produced nothing, kept

The run then sat at 'running' for ten hours until `_reap_abandoned_runs` closed
it, telling the customer the process had probably restarted. It had not. And the
two reel scripts that HAD been written were never shown to anyone, because
`_with_partial` only runs on a caught exception.

── WHAT THESE PIN ─────────────────────────────────────────────────────────────

That `text` is a `str` on every path out of `_call_openai_compat`; that an empty
answer is a provider FAILURE and moves the chain along; that the call is still
recorded with its cost, once, and not as a success; and that the exhausted chain
raises, which is what puts the caller back on its existing refund path.

⚠ Behind `qwen_flash` there is nothing in production: the English bulk chain is
["glm", "qwen_flash", "groq"], `glm` 400s on every call and GROQ_API_KEY is unset
on the Kartavaya service. So today this buys the refund, not a second answer.
`test_the_chain_is_what_makes_this_a_recovery` is the one that will start
passing for the right reason when that key is set.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

import services.ai_router as R


ORG = "11111111-1111-1111-1111-111111111111"


def _choice(content, finish_reason="stop"):
    """One OpenAI-compatible response, as OpenRouter actually shapes it."""
    return {
        "id": "gen-test",
        "choices": [{"message": {"role": "assistant", "content": content},
                     "finish_reason": finish_reason}],
        "usage": {"prompt_tokens": 153, "completion_tokens": 2050,
                  "cost": 0.0023349375},
    }


class _FakePool:
    """Captures every `hub_ai_logs` row instead of writing one.

    The two writers are kept apart because which one ran is the thing under
    test: `_record_generation` carries tokens and cost, `_record_failure`
    carries neither. They are told apart by the column list rather than by
    argument count, so a column added to either does not silently reclassify it.
    """

    def __init__(self):
        self.rows = []        # _record_generation
        self.failures = []    # _record_failure

    async def execute(self, sql, *args):
        if "hub_ai_logs" not in sql:
            return
        if "prompt_tokens" in sql:
            # (client_id, org_id, provider, model, prompt_tokens,
            #  completion_tokens, latency_ms, cost_usd, generation_id, status)
            self.rows.append({"provider": args[2], "model": args[3],
                              "prompt_tokens": args[4],
                              "completion_tokens": args[5],
                              "cost_usd": args[7], "status": args[9]})
        else:
            # (client_id, org_id, provider, model, latency_ms, error_message)
            self.failures.append({"provider": args[2], "error": args[5]})

    async def fetchval(self, *a, **kw):
        return None

    async def fetch(self, *a, **kw):
        return []


@pytest.fixture
def router(monkeypatch):
    """`generate()` with a fake pool, one declared chain, and keys present."""
    pool = _FakePool()

    async def _pool():
        return pool
    monkeypatch.setattr(R, "get_pool", _pool)

    async def _providers():
        return {
            "qwen_flash": {"code": "qwen_flash", "default_model": "qwen/qwen3.6-flash",
                           "api_base_url": "https://openrouter.ai/api/v1"},
            "groq": {"code": "groq", "default_model": "llama-3.3-70b-versatile",
                     "api_base_url": "https://api.groq.com/openai/v1"},
        }
    monkeypatch.setattr(R, "_get_providers", _providers)
    monkeypatch.setattr(R, "_select_providers",
                        lambda *a, **kw: ["qwen_flash", "groq"])
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    monkeypatch.setenv("GROQ_API_KEY", "gsk-test")
    return pool


# ── the source: `content` is nullable ───────────────────────────────────────

class TestTextIsAlwaysAString:
    """⚠ THE REGRESSION. `choice["message"]["content"]` was taken unguarded."""

    @pytest.mark.anyio
    @pytest.mark.parametrize("content", [None, "", "   ", "\n\n"])
    async def test_a_null_or_blank_content_never_leaves_as_none(
            self, monkeypatch, content):
        async def _post(self, url, **kw):
            resp = MagicMock()
            resp.json = lambda: _choice(content, "length")
            resp.raise_for_status = lambda: None
            return resp
        monkeypatch.setattr("httpx.AsyncClient.post", _post)

        out = await R._call_openai_compat(
            "sk-test", "https://openrouter.ai/api/v1", "qwen/qwen3.6-flash", "p")
        assert out["text"] is not None, (
            "content was returned as None; re.findall and a NOT NULL body "
            "column are both one line downstream"
        )
        assert isinstance(out["text"], str)

    @pytest.mark.anyio
    async def test_the_reason_it_was_empty_is_carried(self, monkeypatch):
        """Without this the next occurrence is another stack trace with no cause.

        `finish_reason` is read nowhere else in the codebase — that it was
        never captured is why 2,050 tokens against a 2,048 ceiling had to be
        reconstructed from `hub_ai_logs` after the fact.
        """
        async def _post(self, url, **kw):
            resp = MagicMock()
            resp.json = lambda: _choice(None, "length")
            resp.raise_for_status = lambda: None
            return resp
        monkeypatch.setattr("httpx.AsyncClient.post", _post)

        out = await R._call_openai_compat(
            "sk-test", "https://openrouter.ai/api/v1", "qwen/qwen3.6-flash", "p")
        assert out["finish_reason"] == "length"

    @pytest.mark.anyio
    async def test_a_real_answer_is_untouched(self, monkeypatch):
        """No stripping, no normalising — the model's bytes, as they arrived."""
        async def _post(self, url, **kw):
            resp = MagicMock()
            resp.json = lambda: _choice("  #GST filing is due  ")
            resp.raise_for_status = lambda: None
            return resp
        monkeypatch.setattr("httpx.AsyncClient.post", _post)

        out = await R._call_openai_compat(
            "sk-test", "https://openrouter.ai/api/v1", "qwen/qwen3.6-flash", "p")
        assert out["text"] == "  #GST filing is due  "


# ── the fix: an empty answer is a provider failure ──────────────────────────

class TestAnEmptyAnswerMovesTheChainAlong:
    @pytest.mark.anyio
    async def test_the_chain_is_what_makes_this_a_recovery(self, router, monkeypatch):
        """The first provider produces nothing; the second answers, and THAT is
        what the caller gets. Before the fix the empty string was returned and
        `groq` was never asked."""
        seen = []

        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            seen.append(model)
            if model == "qwen/qwen3.6-flash":
                return {"text": None, "finish_reason": "length",
                        "prompt_tokens": 153, "completion_tokens": 2050,
                        "cost_usd": 0.0023349375, "generation_id": "gen-1"}
            return {"text": "Three reel scripts about GST filing.",
                    "finish_reason": "stop", "prompt_tokens": 153,
                    "completion_tokens": 120, "cost_usd": 0.0001,
                    "generation_id": "gen-2"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        out = await R.generate(prompt="write three reel scripts", org_id=ORG)
        assert out["text"] == "Three reel scripts about GST filing."
        assert out["provider"] == "groq", (
            "the empty answer was returned instead of falling through"
        )
        assert seen == ["qwen/qwen3.6-flash", "llama-3.3-70b-versatile"], (
            "the second provider was never consulted"
        )

    @pytest.mark.anyio
    async def test_an_exhausted_chain_raises_so_the_caller_can_refund(
            self, router, monkeypatch):
        """⚠ THE CREDIT. `execute_org_skill` refunds in its `except` around
        `generate` and nowhere else — a return here keeps the customer's money
        and 500s one line later, outside the window."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": "", "finish_reason": "length", "prompt_tokens": 153,
                    "completion_tokens": 2050, "cost_usd": 0.0023,
                    "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with pytest.raises(RuntimeError) as ex:
            await R.generate(prompt="p", org_id=ORG)
        assert "All AI providers failed" in str(ex.value)

    @pytest.mark.anyio
    async def test_the_message_names_the_cause(self, router, monkeypatch):
        """The run row shows `error_message` to the customer and the log line to
        us. Both should say why, not just that."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": None, "finish_reason": "length", "prompt_tokens": 153,
                    "completion_tokens": 2050, "cost_usd": 0.0023,
                    "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with pytest.raises(RuntimeError) as ex:
            await R.generate(prompt="p", org_id=ORG)
        msg = str(ex.value)
        assert "length" in msg, "the finish_reason is not in the message"
        assert "2050" in msg, "the token count is not in the message"


class TestTheCallIsStillPaidForAndSaidSo:
    @pytest.mark.anyio
    async def test_the_empty_call_is_recorded_with_its_cost(
            self, router, monkeypatch):
        """We were billed $0.0023 for 2,050 tokens. `_record_failure` carries no
        cost column, so recording this as a plain failure would drop the charge
        out of every spend report — the one direction `_record_abandoned` says
        must never be wrong."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": None, "finish_reason": "length", "prompt_tokens": 153,
                    "completion_tokens": 2050, "cost_usd": 0.0023349375,
                    "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with pytest.raises(RuntimeError):
            await R.generate(prompt="p", org_id=ORG)

        empty = [r for r in router.rows if r["provider"] == "qwen_flash"]
        assert len(empty) == 1, (
            f"one call produced {len(empty)} hub_ai_logs rows — a second row "
            f"would double-count the call in every provider report"
        )
        assert empty[0]["cost_usd"] == 0.0023349375
        assert empty[0]["completion_tokens"] == 2050

    @pytest.mark.anyio
    async def test_it_is_not_written_as_a_success(self, router, monkeypatch):
        """'fallback' is in `hub_ai_logs_status_check` and has never been used.
        Calling this 'success' is what let 17% of qwen_flash calls read clean."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": None, "finish_reason": "length", "prompt_tokens": 153,
                    "completion_tokens": 2050, "cost_usd": 0.0023,
                    "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with pytest.raises(RuntimeError):
            await R.generate(prompt="p", org_id=ORG)

        assert [r["status"] for r in router.rows] == ["fallback", "fallback"]

    @pytest.mark.anyio
    async def test_the_status_stays_success_for_a_real_answer(
            self, router, monkeypatch):
        """⚠ MUST NOT CHANGE. Every existing caller of `_record_generation`
        omits `status`, and `GET /hub/analytics/spend` counts on 'success'."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": "a caption", "finish_reason": "stop",
                    "prompt_tokens": 10, "completion_tokens": 5,
                    "cost_usd": 0.0001, "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        out = await R.generate(prompt="p", org_id=ORG)
        assert out["text"] == "a caption"
        assert [r["status"] for r in router.rows] == ["success"]


class TestWhatMustNotChange:
    @pytest.mark.anyio
    async def test_a_very_short_answer_is_still_an_answer(
            self, router, monkeypatch):
        """The check is emptiness, not length. A one-word reply is legitimate
        output — `gemini_flash_or`'s median is 630 completion tokens but its
        floor is not, and a length heuristic here would discard real answers."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": "Yes.", "finish_reason": "stop", "prompt_tokens": 10,
                    "completion_tokens": 2, "cost_usd": 0.0, "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        out = await R.generate(prompt="p", org_id=ORG)
        assert out["text"] == "Yes."
        assert out["provider"] == "qwen_flash", "a short answer fell through"

    @pytest.mark.anyio
    async def test_a_transport_failure_still_records_a_failure_row(
            self, router, monkeypatch):
        """The new `except EmptyCompletion` sits in front of the general one.
        If it ever caught more than it should, this is what would notice."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            raise ConnectionError("connection reset")
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        with pytest.raises(RuntimeError):
            await R.generate(prompt="p", org_id=ORG)
        assert router.rows == [], (
            "a transport failure wrote a generation row; it has no tokens and "
            "no cost and belongs in _record_failure"
        )
        assert [f["provider"] for f in router.failures] == ["qwen_flash", "groq"], (
            "the failure rows stopped being written — EmptyCompletion is "
            "swallowing exceptions that are not empty answers"
        )

    @pytest.mark.anyio
    async def test_the_answer_is_returned_with_its_whitespace(
            self, router, monkeypatch):
        """`text` is stripped to TEST emptiness and nowhere else. Markdown and
        the reel scripts this path writes are whitespace-sensitive."""
        async def _call(api_key, base_url, model, prompt, system="", max_tokens=2048):
            return {"text": "\n# Heading\n\nBody\n", "finish_reason": "stop",
                    "prompt_tokens": 10, "completion_tokens": 5,
                    "cost_usd": 0.0, "generation_id": "g"}
        monkeypatch.setattr(R, "_call_openai_compat", _call)

        out = await R.generate(prompt="p", org_id=ORG)
        assert out["text"] == "\n# Heading\n\nBody\n"
