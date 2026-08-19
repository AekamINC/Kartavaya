"""POST /v1/hub/chat/stream — the four invariants, and the history it reopens.

The owner asked for Sahayak to feel like a real chat. Nothing streamed: the
route returned one finished dict after the whole answer had been written, so a
nine-second answer was nine seconds of nothing followed by a paragraph. That is
mechanics, not model quality, and it costs nothing to fix — which is why this
file is about frames and ledgers rather than about prose.

── What is pinned, and what each one would break if it were not ──────────────

  1. `final` REPLACES what streamed. `strip_invalid_refs` can only run on the
     complete text — `[9]` is only invalid once you know the answer cited
     nothing else — so the deltas are the model's raw prose and `final` is the
     validated version. A client that keeps its own accumulation renders
     citation markers the server rejected, pointing at records the model was
     never given. The test drives a model that cites `[9]` and asserts the two
     differ in exactly that way.

  2. FALLBACK STOPS AT THE FIRST DELTA. Before a token has reached the reader a
     provider failure is invisible and the chain moves on. After it, switching
     providers rewrites text already on screen — the paragraph changes under the
     reader mid-sentence with nothing to say it did. Driven from BOTH sides: a
     failure before the first delta must reach the second provider, and a
     failure after it must not.

  3. ONE DEBIT, ONE LOG ROW. Both endpoints run the same pipeline, so the credit
     spend and the `hub_ai_logs` insert must be indistinguishable between them.
     Asserted by count on the streaming path and by structure on the writer:
     there is one function that writes the row and both callers use it.

  4. NO HALF-ANSWER IS STORED. A partial answer written to `hub_chat_messages`
     reads as finished forever after. On a mid-stream failure the row that
     lands is the refusal, and the prose the reader saw is nowhere in it.

  · AND THE STATUS CODES SURVIVE. An SSE response has sent `200 OK` before its
    first frame, so a pipeline that yields early can no longer answer 402. The
    charge is the boundary, and a customer at zero gets the same 402 from the
    streaming endpoint as from the blocking one.

── Why the disconnect tests drive the generator and not the endpoint ─────────

`httpx.ASGITransport` collects the whole response body before handing it back,
so there is no point at which a test client "stops reading". Cancellation is
therefore driven where it actually happens — `aclose()` on the async generator,
which is exactly what Starlette does to a response whose socket has gone.
"""
from __future__ import annotations

import ast
import asyncio
import inspect
import json
import textwrap
import uuid

import asyncpg
import httpx
import pytest

from routers import hub
from services import ai_router

from tests.test_sahayak_answer import (  # noqa: F401 — fixtures, used by name
    SESSION, bypass_module_gate, grants, reads, rows_for_receivables, wired,
)

QUESTION = "Who owes us money and what have we chased?"

#: The model's raw prose, in pieces. `[1]` is the one source this question
#: reads and is citable; `[9]` is not, and is what invariant 1 is measured on.
CHUNKS = ["Six customers ", "are past 45 days [1]", ", and one more is [9]."]
RAW = "".join(CHUNKS)


def parse(text: str) -> list[tuple[str, dict]]:
    """SSE wire format back into `(event, data)` pairs.

    Deliberately strict about the frame shape — `event:` line, `data:` line,
    blank line — because that shape IS the contract two clients are being
    written against, and a server that emitted bare JSON lines would still make
    a lenient parser pass.
    """
    out: list[tuple[str, dict]] = []
    for block in text.split("\n\n"):
        lines = [ln for ln in block.split("\n") if ln]
        if not lines:
            continue
        assert lines[0].startswith("event: "), block
        assert lines[1].startswith("data: "), block
        out.append((lines[0][7:], json.loads(lines[1][6:])))
    return out


@pytest.fixture
def streams(wired, monkeypatch):
    """A provider that streams. Extends `wired`, which stubs everything else.

    `fail_at` makes the provider die before yielding piece N — 0 is a failure
    before the first delta, 2 is a failure after the reader has seen text.
    """
    state = {"calls": [], "fail_at": None}

    async def _generate_stream(**kw):
        state["calls"].append(kw)
        for i, piece in enumerate(CHUNKS):
            if state["fail_at"] == i:
                raise RuntimeError("the provider hung up")
            yield "delta", piece
        yield "final", {
            "text": RAW, "provider": "glm", "model": "thudm/glm-4.5-air:free",
            "prompt_tokens": 1200, "completion_tokens": 90,
            "cost_usd": 0.0, "grounding_sources": [],
        }

    monkeypatch.setattr(hub, "generate_stream", _generate_stream)
    return state


@pytest.fixture
def answerable(grants, reads):
    """A question the caller may ask and both of whose sources answer."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple",
                            "label": "Overdue customer invoices",
                            "data": rows_for_receivables(3), "dropped": 0}
    reads["followups"] = {"ok": True, "kind": "simple",
                          "label": "Overdue CRM follow-ups",
                          "data": [], "dropped": 0}
    return reads


async def stream(api_client, **extra):
    return await api_client.post(
        "/api/v1/hub/chat/stream", json={"message": QUESTION, **extra},
    )


# ══════════════════════════════════════════════════════════════════════════
# 0 · both routes exist, and the blocking one is untouched
# ══════════════════════════════════════════════════════════════════════════

def test_streaming_is_additive():
    """A client that cannot stream must lose nothing — mobile is one."""
    paths = {(r.path, tuple(sorted(r.methods))) for r in hub.router.routes
             if hasattr(r, "methods")}
    assert ("/api/v1/hub/chat", ("POST",)) in paths, \
        "the non-streaming route is gone; every other caller is broken"
    assert ("/api/v1/hub/chat/stream", ("POST",)) in paths


@pytest.mark.asyncio
async def test_the_blocking_route_still_returns_the_whole_payload(
    api_client, as_member, with_org_id, wired, answerable,
):
    """`POST /chat` runs the same pipeline and must not have changed shape."""
    resp = await api_client.post("/api/v1/hub/chat", json={"message": QUESTION})
    assert resp.status_code == 200
    body = resp.json()
    assert body["answered"] is True
    assert set(body) == set(hub._sahayak_payload())
    assert body["message"], "the blocking route answered with nothing"


# ══════════════════════════════════════════════════════════════════════════
# 1 · the event sequence, and `final` as the authority
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_one_real_question_streams_steps_then_deltas_then_one_final(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    resp = await stream(api_client)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = parse(resp.text)
    names = [e for e, _ in events]

    assert names.count("final") == 1, "an answer is final exactly once"
    assert names[-1] == "final", "work arrived after the answer was finished"
    assert "error" not in names

    first_delta = names.index("delta")
    assert set(names[:first_delta]) == {"step"}, \
        "a delta arrived before the work that produced it was named"
    assert names[first_delta:-1] == ["delta"] * len(CHUNKS)

    labels = [d["label"] for e, d in events if e == "step"]
    assert "Reading overdue customer invoices" in labels
    assert "Writing the answer" == labels[-1], \
        "the last thing announced before text appears must be the writing"


@pytest.mark.asyncio
async def test_a_step_and_the_work_row_under_it_name_the_same_read(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """One intent, one name, whichever surface prints it.

    The step labels were built with `.lower()` over the whole `Intent.label`,
    which flattened the two labels carrying an acronym: the stream said "Reading
    overdue crm follow-ups" and the work panel, which prints the label untouched,
    said "Overdue CRM follow-ups" — the same read, named two ways, a second
    apart. Only the first character may be lowered.
    """
    events = parse((await stream(api_client)).text)
    steps = [d["label"] for e, d in events if e == "step"]
    work = [r["label"] for r in events[-1][1]["work"]
            if r["label"] != "Wrote the answer"]

    assert "Reading overdue CRM follow-ups" in steps, steps
    assert work, "the fixture stopped reading anything"
    for label in work:
        assert f"Reading {label[:1].lower()}{label[1:]}" in steps, (label, steps)


@pytest.mark.asyncio
async def test_the_final_frame_is_exactly_the_blocking_payload(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """Not a subset and not a superset — the same dict, so a client written for
    one endpoint needs no translation for the other."""
    events = parse((await stream(api_client)).text)
    final = dict(events[-1][1])
    assert set(final) == set(hub._sahayak_payload())
    assert final["answered"] is True
    assert final["work"] and final["sources"]


@pytest.mark.asyncio
async def test_final_carries_the_validated_text_and_the_deltas_do_not(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """INVARIANT 1, measured rather than asserted about.

    The model cites `[1]`, which this question read, and `[9]`, which it did
    not. `strip_invalid_refs` cannot know `[9]` is bogus until the answer is
    complete, so the deltas carry it and `final` does not. A client that keeps
    its accumulation shows a citation control that opens nothing.
    """
    events = parse((await stream(api_client)).text)
    streamed = "".join(d["text"] for e, d in events if e == "delta")
    final = events[-1][1]["message"]

    assert streamed == RAW
    assert "[9]" in streamed, "the fixture no longer exercises the invariant"
    assert "[9]" not in final, "the server returned a citation it rejected"
    assert "[1]" in final, "a valid citation was stripped with the invalid one"
    assert final != streamed


@pytest.mark.asyncio
async def test_what_is_stored_is_the_validated_text_too(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """Otherwise reopening the thread resurrects the citation `final` dropped."""
    await stream(api_client)
    stored = [args for role, args in wired["inserted"] if role == "assistant"]
    assert stored, "the streamed answer was never written to the history"
    assert "[9]" not in stored[-1][1]


# ══════════════════════════════════════════════════════════════════════════
# 2 · fallback stops at the first delta
# ══════════════════════════════════════════════════════════════════════════

@pytest.fixture
def chain(monkeypatch, mock_pool):
    """Two live OpenRouter providers and a record of which ones were streamed."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setattr(ai_router, "_providers_cache", {
        code: {"code": code, "api_base_url": "https://x/api/v1",
               "default_model": f"model-{code}", "priority": 1, "config": {}}
        for code in ai_router._select_providers("en", "chatbot", "chatbot")
    })
    return {"tried": []}


def _provider(chain, script):
    """`script[model] -> list of pieces, or an exception to raise at that point."""
    async def _stream(api_key, base_url, model, prompt, system="", max_tokens=2048):
        chain["tried"].append(model)
        for piece in script[model]:
            if isinstance(piece, Exception):
                raise piece
            yield "delta", piece
        yield "usage", {"prompt_tokens": 10, "completion_tokens": 5}
    return _stream


@pytest.mark.asyncio
async def test_a_provider_that_fails_before_the_first_token_falls_through(
    monkeypatch, mock_pool, chain,
):
    order = ai_router._select_providers("en", "chatbot", "chatbot")
    monkeypatch.setattr(ai_router, "_stream_openai_compat", _provider(chain, {
        f"model-{order[0]}": [RuntimeError("429 rate limited")],
        f"model-{order[1]}": ["Hello ", "world."],
    }))

    out = [ev async for ev in ai_router.generate_stream(task="chatbot", prompt="q")]

    assert chain["tried"] == [f"model-{order[0]}", f"model-{order[1]}"], \
        "the chain did not fall through a failure nobody had seen"
    assert [v for k, v in out if k == "delta"] == ["Hello ", "world."]
    assert out[-1][0] == "final"
    assert out[-1][1]["provider"] == order[1]


@pytest.mark.asyncio
async def test_a_provider_that_fails_after_the_first_token_ends_the_stream(
    monkeypatch, mock_pool, chain,
):
    """INVARIANT 2. Silently switching here would rewrite text already read."""
    order = ai_router._select_providers("en", "chatbot", "chatbot")
    monkeypatch.setattr(ai_router, "_stream_openai_compat", _provider(chain, {
        f"model-{order[0]}": ["Six customers ", RuntimeError("connection reset")],
        f"model-{order[1]}": ["A completely different answer."],
    }))

    seen = []
    with pytest.raises(RuntimeError):
        async for ev in ai_router.generate_stream(task="chatbot", prompt="q"):
            seen.append(ev)

    assert seen == [("delta", "Six customers ")]
    assert chain["tried"] == [f"model-{order[0]}"], \
        "a second provider answered over text the reader had already seen"


@pytest.mark.asyncio
async def test_the_route_reports_a_mid_answer_failure_as_an_error_event(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """The client half of invariant 2: no `final`, one `error`, product voice."""
    streams["fail_at"] = 2

    events = parse((await stream(api_client)).text)
    names = [e for e, _ in events]

    assert names[-1] == "error"
    assert "final" not in names
    assert names.count("delta") == 2, "the deltas before the failure were lost"

    detail = events[-1][1]["detail"]
    assert detail and detail[0].isupper() and detail.endswith(".")
    assert "Traceback" not in detail and "RuntimeError(" not in detail


# ══════════════════════════════════════════════════════════════════════════
# 3 · one debit, one log row
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_streamed_answer_is_charged_exactly_once(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    await stream(api_client)
    assert len(wired["spends"]) == 1, wired["spends"]
    assert wired["refunds"] == []
    assert wired["spends"][0]["ref_id"] == "chatbot_message"


@pytest.mark.asyncio
async def test_the_charge_happens_before_the_first_frame(
    api_client, as_member, with_org_id, wired, streams, answerable, monkeypatch,
):
    """A 402 is only possible while the status line is unspent.

    `credits.spend` raising is how a customer at zero is told the price and the
    balance. If any frame had been written first the response would be a 200
    with an `error` in it, which no client reads as "top up".
    """
    from services.credits import InsufficientOrgCredits

    async def _broke(conn, **kw):
        raise InsufficientOrgCredits(
            "This answer costs 2 credits and the organisation has 0 left.",
            needed=2, available=0,
        )

    monkeypatch.setattr("services.credits.spend", _broke)

    resp = await stream(api_client)
    assert resp.status_code == 402, resp.text
    assert not resp.headers["content-type"].startswith("text/event-stream")
    assert resp.json()["detail"]["available"] == 0, \
        "the balance a customer needs to see did not survive the stream"


@pytest.mark.asyncio
async def test_a_session_from_another_org_is_still_a_404_on_the_stream(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    wired["session"] = None
    resp = await stream(api_client, session_id=SESSION)
    assert resp.status_code == 404


def test_one_function_writes_the_ai_log_row_and_both_paths_use_it():
    """INVARIANT 3, structurally.

    Counting inserts in a test proves the two paths agree today. This proves
    they cannot disagree tomorrow: there is one writer, and neither `generate`
    nor `generate_stream` carries an INSERT of its own.
    """
    for fn in (ai_router.generate, ai_router.generate_stream):
        src = textwrap.dedent(inspect.getsource(fn))
        assert "hub_ai_logs" not in src, (
            f"{fn.__name__} writes its own log row; the two paths will drift")
        assert "_record_generation" in src, (
            f"{fn.__name__} does not record the call it made")
    assert "hub_ai_logs" in inspect.getsource(ai_router._record_generation)


# ══════════════════════════════════════════════════════════════════════════
# 4 · no half-answer is ever stored
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_failure_after_the_first_token_stores_a_refusal_not_the_prose(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """INVARIANT 4. What a reader saw and what the record says are different
    things, and only one of them is allowed to look finished."""
    streams["fail_at"] = 2

    await stream(api_client)

    stored = [args for role, args in wired["inserted"] if role == "assistant"]
    assert len(stored) == 1, "the partial answer was stored as well as the refusal"
    text = stored[0][1]
    assert "Six customers" not in text, "half an answer is in the history"
    assert "did not answer" in text


@pytest.mark.asyncio
async def test_a_failure_after_the_first_token_keeps_the_charge(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """Text delivered is text charged.

    The provider generated — and billed us for — everything the reader saw. A
    refund here would make failing late cheaper than failing early, and would be
    a second ledger movement against an answer that has had exactly one.
    """
    streams["fail_at"] = 2
    await stream(api_client)
    assert len(wired["spends"]) == 1
    assert wired["refunds"] == [], "the credit was returned for text we paid for"


@pytest.mark.asyncio
async def test_a_failure_before_the_first_token_still_refunds(
    api_client, as_member, with_org_id, wired, streams, answerable,
):
    """The other side of the same rule, and the behaviour `POST /chat` has
    always had: nothing was shown, so nothing is owed."""
    streams["fail_at"] = 0

    events = parse((await stream(api_client)).text)

    assert [e for e, _ in events][-1] == "final", \
        "a failure nobody saw should still produce a refusal payload"
    assert events[-1][1]["answered"] is False
    assert len(wired["refunds"]) == 1


# ══════════════════════════════════════════════════════════════════════════
# 5 · the reader disconnects
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_an_abandoned_stream_still_records_what_we_were_billed(
    monkeypatch, mock_pool, chain,
):
    """The provider charged us for the tokens it sent before the socket closed.

    A row that never lands is spend that never reaches the org's report, which
    is wrong in the one direction that matters. It cannot be awaited — the task
    is being cancelled — so it is detached, and this test waits one tick for it.
    """
    order = ai_router._select_providers("en", "chatbot", "chatbot")
    monkeypatch.setattr(ai_router, "_stream_openai_compat", _provider(chain, {
        f"model-{order[0]}": ["Six ", "customers ", "are ", "overdue."],
    }))

    agen = ai_router.generate_stream(task="chatbot", prompt="q", org_id=str(uuid.uuid4()))
    assert await agen.__anext__() == ("delta", "Six ")
    await agen.aclose()
    await asyncio.sleep(0)

    inserts = [c.args[0] for c in mock_pool.execute.call_args_list]
    logged = [q for q in inserts if "hub_ai_logs" in q]
    assert len(logged) == 1, "the abandoned generation was never accounted for"
    assert "'success'" in logged[0], "an answer we were billed for logged as an error"


@pytest.mark.asyncio
async def test_abandoning_the_route_mid_answer_stores_nothing_and_refunds_nothing(
    mock_pool, member_user, with_org_id, wired, streams, answerable,
):
    """Driven on the generator, which is what Starlette closes when the socket
    goes. Three consequences, all of them the same decision: the reader gets no
    record, no refund, and no half-answer in their history."""
    events = hub._sahayak_answer(
        hub.ChatAsk(message=QUESTION), None, member_user, with_org_id, stream=True,
    )
    seen = []
    async for kind, data in events:
        seen.append(kind)
        if kind == "delta":
            break
    await events.aclose()

    assert "delta" in seen
    assert len(wired["spends"]) == 1, "the question was charged more than once"
    assert wired["refunds"] == []
    assert [role for role, _ in wired["inserted"]] == ["user"], \
        "a half-answer reached the history"


@pytest.mark.asyncio
async def test_stopping_at_the_first_step_row_returns_the_credit(
    mock_pool, member_user, with_org_id, wired, streams, answerable,
):
    """THE OTHER SIDE OF THAT RULE, and the window Stop makes easy to hit.

    "We were billed either way" is true of a call that was made. The charge is
    taken before the provider is touched, so a reader who leaves between the two
    has bought an answer no model was ever asked to write — and neither
    `GeneratorExit` nor `CancelledError` is an `Exception`, so the refund arm on
    the generation failure never saw one. The credit comes back here, and only
    here: nothing was generated, so there is nothing to log and nothing to store.
    """
    events = hub._sahayak_answer(
        hub.ChatAsk(message=QUESTION), None, member_user, with_org_id, stream=True,
    )
    first = await events.__anext__()
    assert first[0] == "step", first
    await events.aclose()
    # The refund is handed to the loop rather than awaited — on a stack that is
    # being cancelled every `await` raises immediately — so it lands a tick later.
    await asyncio.sleep(0)

    assert len(wired["spends"]) == 1
    assert streams["calls"] == [], "a provider was asked for this answer after all"
    assert len(wired["refunds"]) == 1, \
        "the org paid for an answer no model was ever asked to write"
    assert [role for role, _ in wired["inserted"]] == ["user"], \
        "an answer nobody wrote reached the history"


@pytest.mark.asyncio
async def test_a_cancelled_request_returns_the_credit_too(
    mock_pool, member_user, with_org_id, wired, streams, answerable, monkeypatch,
):
    """The same window, entered the way production enters it.

    `aclose()` above is the polite version. What Starlette actually does to a
    response whose socket has gone is cancel the task, and the slowest thing in
    this window is the one with a third party in it: a question that is not
    about their own books waits several hundred milliseconds on Serper. Held
    open here, cancelled mid-await, and the credit still has to come back.
    """
    reached = asyncio.Event()

    async def _slow_search(question):
        reached.set()
        await asyncio.sleep(30)              # the third party, still thinking
        return []

    monkeypatch.setattr(hub.web_search, "is_configured", lambda: True)
    monkeypatch.setattr(hub.web_search, "search", _slow_search)
    monkeypatch.setattr(hub.sahayak, "looks_like_org_question", lambda q: False)

    events = hub._sahayak_answer(
        hub.ChatAsk(message=QUESTION), None, member_user, with_org_id, stream=True,
    )

    async def _read() -> None:
        async for _ in events:
            pass

    task = asyncio.create_task(_read())
    await reached.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0)

    assert len(wired["spends"]) == 1
    assert streams["calls"] == [], "a provider was asked for this answer after all"
    assert len(wired["refunds"]) == 1, \
        "a cancelled request kept the credit for an answer that was never written"


# ══════════════════════════════════════════════════════════════════════════
# 6 · the conversation reopens with everything it had
# ══════════════════════════════════════════════════════════════════════════

STORED_ANSWER = {
    "session_id": SESSION, "message_id": "m1", "answered": True,
    "message": "the message key, which must not overwrite content",
    "work": [{"label": "Overdue customer invoices", "fn": "find_overdue_invoices",
              "state": "done", "ok": True, "note": "free", "rows": 3, "src": "x"}],
    "figs": [{"label": "Overdue", "value": "₹4,20,000", "src": "GET /x"}],
    "sources": [], "evidence": {"cols": ["a"], "rows": [["1"]]},
    "refusal": "", "refusal_detail": None, "model": "m", "credits": 2,
    "credits_charged": 2, "cost_usd": 0.0004, "language": "en",
    "read": ["receivables"],
}


@pytest.fixture
def history(mock_pool):
    """One assistant row with a stored answer, one user row without."""
    state = {"answer": json.dumps(STORED_ANSWER), "column": True}

    async def _fetchrow(query, *args):
        if "hub_chat_sessions" in " ".join(query.split()):
            return {"client_id": uuid.uuid4()}
        return None

    async def _fetch(query, *args):
        q = " ".join(query.split())
        if "answer" in q and not state["column"]:
            raise asyncpg.UndefinedColumnError('column "answer" does not exist')
        rows = [
            {"id": "u1", "role": "user", "content": "Who owes us money?",
             "sources": None, "model_used": None, "created_at": None},
            {"id": "a1", "role": "assistant", "content": "Six customers [1].",
             "sources": "[]", "model_used": "glm", "created_at": None},
        ]
        if "answer" in q:
            rows[0]["answer"] = None
            rows[1]["answer"] = state["answer"]
        return rows

    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetch.side_effect = _fetch
    return state


def _first_route(router, path, method):
    """The route the app would actually pick, in registration order.

    FastAPI wraps each `include_router` call in an `_IncludedRouter` that keeps
    the real router on `.original_router`, so a flat scan of `app.routes` sees
    none of this — and order is the whole question here, so this walks rather
    than collecting into a set.
    """
    for r in getattr(router, "routes", []):
        inner = getattr(r, "original_router", None)
        if inner is not None:
            hit = _first_route(inner, path, method)
            if hit is not None:
                return hit
            continue
        if getattr(r, "path", None) == path and method in (getattr(r, "methods", None) or ()):
            return r
    return None


def test_the_history_route_this_product_serves_is_the_one_that_reads_the_answer():
    """`hub_chat.py` declares the same path and selects six columns, none of
    them `answer`. `server.py` includes `hub_router` first and the first match
    wins, so this one answers — a fact worth failing a build over, because the
    losing route sits in a file that gives no sign of having lost."""
    import server
    from routers import hub_chat

    match = _first_route(
        server.app.router, "/api/v1/hub/chat/sessions/{session_id}/messages", "GET",
    )
    assert match is not None, "the history route is not mounted at all"
    assert match.endpoint is hub.sahayak_chat_history, (
        "the shadowed route won; reopened conversations lose their work steps")
    assert hub_chat.get_chat_messages, "the shadowed route was deleted, not shadowed"


@pytest.mark.asyncio
async def test_reopening_a_conversation_returns_the_work_figures_and_evidence(
    api_client, as_member, with_org_id, history,
):
    """The defect this route exists for: `_sahayak_store_answer` has written the
    whole payload into `hub_chat_messages.answer` on every reply and nothing has
    ever read it back, so an answer lost its provenance on reload."""
    resp = await api_client.get(f"/api/v1/hub/chat/sessions/{SESSION}/messages")
    assert resp.status_code == 200
    rows = resp.json()["data"]

    assistant = rows[1]
    assert assistant["work"][0]["fn"] == "find_overdue_invoices"
    assert assistant["figs"][0]["value"] == "₹4,20,000"
    assert assistant["evidence"]["cols"] == ["a"]
    assert assistant["read"] == ["receivables"]
    assert assistant["answered"] is True
    assert assistant["credits"] == 2


@pytest.mark.asyncio
async def test_the_stored_blob_never_overwrites_the_columns_beside_it(
    api_client, as_member, with_org_id, history,
):
    """The payload repeats `message`, `model` and `session_id` under other
    names. The row is what the database can be queried on, so the row wins and
    only keys that exist nowhere else are lifted out of the blob."""
    rows = (await api_client.get(
        f"/api/v1/hub/chat/sessions/{SESSION}/messages")).json()["data"]

    assert rows[1]["content"] == "Six customers [1]."
    assert rows[1]["model_used"] == "glm"
    assert "answer" not in rows[1], "the whole payload was echoed back twice"
    assert "message" not in rows[1]


@pytest.mark.asyncio
async def test_a_history_row_with_no_stored_answer_is_returned_unchanged(
    api_client, as_member, with_org_id, history,
):
    """Every message this product sent before migration 119 has none, and a
    thread of them must read exactly as it did before this route existed."""
    rows = (await api_client.get(
        f"/api/v1/hub/chat/sessions/{SESSION}/messages")).json()["data"]
    assert rows[0]["role"] == "user"
    assert "work" not in rows[0] and "figs" not in rows[0]


@pytest.mark.asyncio
async def test_the_column_arriving_as_a_string_is_still_read(
    api_client, as_member, with_org_id, history,
):
    """`db.py:82` warns rather than raises when PgBouncer drops the jsonb codec
    handshake, and asyncpg then hands jsonb back as text. `sources.js` already
    carries this defence for the sibling column."""
    history["answer"] = json.dumps(STORED_ANSWER)      # a str, as above
    rows = (await api_client.get(
        f"/api/v1/hub/chat/sessions/{SESSION}/messages")).json()["data"]
    assert rows[1]["work"], "a jsonb string was dropped instead of parsed"


@pytest.mark.asyncio
async def test_the_history_answers_without_the_119_column(
    api_client, as_member, with_org_id, history,
):
    history["column"] = False
    resp = await api_client.get(f"/api/v1/hub/chat/sessions/{SESSION}/messages")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 2


@pytest.mark.asyncio
async def test_a_conversation_in_another_org_is_not_found(
    api_client, as_member, with_org_id, mock_pool,
):
    """The session row is the only thing carrying `org_id`; `hub_chat_messages`
    has no org column, so a check against the message alone would serve another
    tenant's whole conversation."""
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(f"/api/v1/hub/chat/sessions/{SESSION}/messages")
    assert resp.status_code == 404


# ══════════════════════════════════════════════════════════════════════════
# 7 · the gates that used to sit on `sahayak_chat` now cover the pipeline
# ══════════════════════════════════════════════════════════════════════════
#
# `test_sahayak_answer.py` and `test_sahayak_grounding_contract.py` parse
# `hub.sahayak_chat` for image generators and object storage. That function is
# now four lines that drive `_sahayak_answer`, so both of those gates still pass
# and now say nothing — a gate that has quietly stopped enforcing anything is
# worse than no gate. These re-point them at the code that moved.

_ANSWER_PATH = (hub._sahayak_answer, hub.sahayak_chat_stream, hub.sahayak_chat)


def _calls_in(fn) -> set[str]:
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    return {
        node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
        for node in ast.walk(tree) if isinstance(node, ast.Call)
    }


@pytest.mark.parametrize("fn", _ANSWER_PATH, ids=lambda f: f.__name__)
def test_no_part_of_the_answer_path_can_reach_an_image_generator(fn):
    banned = {"generate_image", "generate_rich_content"}
    assert not (banned & _calls_in(fn)), (
        f"{fn.__name__} calls an image generator. Sahayak does not generate "
        f"images on request, on any surface.")


def test_that_gate_would_notice():
    """The AST walk fails open on a call shape it does not recognise, and an
    assertion that finds nothing looks the same whether it is enforcing or
    broken. Run against a decoy that calls the generator in both shapes."""
    async def decoy_bare():
        return await generate_image(prompt="x")                    # noqa: F821

    async def decoy_attribute():
        return await ai_router.generate_rich_content(prompt="x")   # noqa: F821

    assert "generate_image" in _calls_in(decoy_bare)
    assert "generate_rich_content" in _calls_in(decoy_attribute)


def test_nothing_on_the_answer_path_can_reach_object_storage():
    """Postgres is scoped by `org_id`. R2 is scoped by not being reached — a
    fact about the code, so it is asserted rather than promised."""
    import re

    src = "".join(inspect.getsource(fn) for fn in _ANSWER_PATH)
    assert not re.search(r"\b(boto3|r2_client|get_r2|presign|signed_url|s3)\b",
                         src, re.I)


# ══════════════════════════════════════════════════════════════════════════
# 8 · the wire — what comes back off the provider's socket
# ══════════════════════════════════════════════════════════════════════════
#
# Everything above stubs `_stream_openai_compat`, so nothing above would notice
# if the SSE parsing were wrong. This section drives the real function against a
# scripted response body, because the shapes it has to survive — keep-alive
# comments, a `[DONE]` sentinel, a truncated frame, and a usage frame that never
# arrives — are the ones a live provider produces and a happy-path fixture never
# does.


def sse(*frames: str) -> str:
    return "".join(f"data: {f}\n\n" for f in frames)


def chunk(text: str) -> str:
    return json.dumps({"id": "gen-1", "choices": [{"delta": {"content": text}}]})


@pytest.fixture
def wire(monkeypatch):
    """Answer `/chat/completions` with a scripted event stream."""
    state = {"body": "", "status": 200, "sent": []}
    real = httpx.AsyncClient

    async def _handler(request):
        state["sent"].append(json.loads(request.content))
        return httpx.Response(state["status"], text=state["body"])

    def _client(*a, **kw):
        return real(*a, transport=httpx.MockTransport(_handler), **kw)

    monkeypatch.setattr(ai_router.httpx, "AsyncClient", _client)
    return state


async def read(**kw):
    return [ev async for ev in ai_router._stream_openai_compat(
        "key", "https://x/api/v1", kw.pop("model", "qwen/qwen3.6-flash"),
        kw.pop("prompt", "q"), **kw)]


@pytest.mark.asyncio
async def test_the_stream_is_asked_for_and_so_is_the_usage_frame(wire):
    """Token counts arrive in the last frame or not at all, and only if asked.
    Without `include_usage` every streamed call would be priced by the character
    approximation — which is the thing that exists for when providers refuse."""
    wire["body"] = sse(chunk("hi"), "[DONE]")
    await read()
    assert wire["sent"][0]["stream"] is True
    assert wire["sent"][0]["stream_options"] == {"include_usage": True}


@pytest.mark.asyncio
async def test_frames_become_deltas_and_the_sentinel_ends_the_stream(wire):
    wire["body"] = (
        ": keep-alive\n\n"                       # an SSE comment, per the spec
        + sse(chunk("Six "), chunk("customers"), "{not json",
              json.dumps({"usage": {"prompt_tokens": 12, "completion_tokens": 3}}),
              "[DONE]")
        + sse(chunk(" — after DONE, and must never appear"))
    )
    out = await read()

    assert [v for k, v in out if k == "delta"] == ["Six ", "customers"], \
        "a malformed frame took the answer with it, or [DONE] was ignored"
    assert out[-1] == ("usage", {"prompt_tokens": 12, "completion_tokens": 3, "id": "gen-1"})


@pytest.mark.asyncio
async def test_openrouters_reported_cost_beats_the_estimate(wire):
    """`usage.cost` is what we are actually invoiced. The table is an estimate
    for the providers that do not send one."""
    wire["body"] = sse(
        chunk("hello"),
        json.dumps({"usage": {"prompt_tokens": 1000, "completion_tokens": 1000,
                              "cost": 0.0424}}),
        "[DONE]",
    )
    usage = (await read())[-1][1]
    result = ai_router._usage_to_result("qwen/qwen3.6-flash", "hello", "", "q", usage)
    assert result["cost_usd"] == pytest.approx(0.0424)


@pytest.mark.asyncio
async def test_a_provider_that_sends_no_usage_is_estimated_not_zeroed(wire):
    """WHAT HAPPENS WHEN THEY DO NOT REPORT USAGE.

    The alternative is logging a call we were certainly billed for at exactly
    $0.00, which is the fault the pricing ratchet exists for wearing a different
    hat. Approximate token counts from the characters, and say in the log that
    they are approximate.
    """
    wire["body"] = sse(chunk("x" * 400), "[DONE]")
    out = await read()
    assert out[-1] == ("usage", {"id": "gen-1"})

    result = ai_router._usage_to_result(
        "qwen/qwen3.6-flash", "x" * 400, "sys", "prompt", out[-1][1],
    )
    assert result["completion_tokens"] == 100, "4 characters to the token"
    assert result["prompt_tokens"] == (len("sys") + len("prompt")) // 4
    assert result["cost_usd"] > 0, "a billed call was logged as free"


@pytest.mark.asyncio
async def test_a_refusal_carries_the_providers_own_words(wire):
    """The fallback loop decides whether a failure is retryable by looking for
    429/403 in the error string, and a streamed response does not read its body
    unless asked — so `raise_for_status` alone would hand it a status line with
    nothing in it."""
    wire["status"] = 429
    wire["body"] = '{"error":{"message":"rate limited on the free tier"}}'

    with pytest.raises(httpx.HTTPStatusError) as caught:
        await read()

    assert "429" in str(caught.value)
    assert "rate limited on the free tier" in str(caught.value)
