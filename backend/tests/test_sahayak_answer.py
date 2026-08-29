"""POST /v1/hub/chat and POST /v1/hub/skills/feedback — the endpoints the
Sahayak screen was drawn against and did not have.

Measured on `staging` before this file existed: neither route was registered.
`assistant/AnswerBody.jsx` renders `message.work`, `message.figs` and
`message.refusal`, and its own header says those are "fields nothing sets today,
which means they render NOTHING today". The only chat route in the product
returns `{message, sources, model, cost_usd, credits_charged}` — no work steps,
no figures, no evidence and no refusal.

── What is actually pinned here, and why each one could have gone wrong ──────

  · A REFUSAL IS A REFUSAL, NEVER A FABRICATED ANSWER. Three of these tests
    drive the three ways Sahayak can fail to answer — the caller lacks a module
    grant, every source it needed errored, the model chain died — and each
    asserts the response says so in the refusal fields rather than returning
    prose. The third one matters most: the older chat route catches the same
    exception and returns a friendly 200 reading "Sorry, I encountered an
    error", which is indistinguishable from an answer to everything downstream
    of it, including the stored history.

  · A RECORD THE CALLER MAY NOT SEE IS NOT IN `sources`. Not filtered out of the
    list — never read. The test asserts the retrieval layer was not called at
    all, because a filter applied after a read is a filter somebody removes.

  · REFUSING IS FREE. Both free refusals assert `credits.spend` was never
    reached. Charging for a run the customer cannot have is the second wrong
    thing on top of the first, and it is the order
    `skills/context.py:assert_step_access` already establishes for skills.

  · THE MODEL IS THE CHEAP ONE. `task="chatbot"` is the routing branch, and
    `agent_type` alone reaches no branch in `_select_providers` — the bug that
    sent every chatbot answer this product ever gave to the free English bulk
    model. Asserted on the call, not on a comment.

  · THE 119 COLUMNS ARE NOT APPLIED. Production's actual state is without them,
    so both write paths are driven with `asyncpg.UndefinedColumnError` raised at
    them and must still answer.

── THE POOL IS A MagicMock AND ANSWERS ANY QUERY ────────────────────────────

So every read this route makes is routed explicitly on its SQL. Left to the
mock's defaults a query could be silently wrong — matching no row, returning 0 —
while the test passed on the path that never needed it.
"""
import json
import uuid

import asyncpg
import pytest

from routers import hub
from services import sahayak_answer as sahayak

ORG = "00000000-0000-0000-0000-00000000000a"
CLIENT = "11111111-1111-1111-1111-111111111111"
SESSION = "22222222-2222-2222-2222-222222222222"
MSG = "33333333-3333-3333-3333-333333333333"


# ── harness ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Module entitlement is tested elsewhere; this is about what happens after."""
    from routers.hub import _hub_gate
    app.dependency_overrides[_hub_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_hub_gate, None)


class Receipt:
    """Just enough of `credits.Receipt` for the two fields this route reads."""
    def __init__(self, credits_taken=2):
        self.tx_id = "tx-1"
        self.credits = credits_taken
        self.replayed = False


@pytest.fixture
def wired(mock_pool, monkeypatch):
    """Route every query this endpoint makes, and record every side effect."""
    state = {
        "client": uuid.UUID(CLIENT),
        "session": {"id": uuid.UUID(SESSION), "client_id": uuid.UUID(CLIENT)},
        "brand": None,
        "history": [],
        "inserted": [],
        "spends": [],
        "refunds": [],
        "generated": [],
        "kb_calls": [],
        "answer_column": True,
    }

    async def _fetchval(query, *args):
        q = " ".join(query.split())
        if "FROM public.hub_clients" in q and "is_internal=TRUE" in q:
            return state["client"]
        if "INSERT INTO public.hub_chat_messages" in q and "'assistant'" in q:
            if "answer" in q and not state["answer_column"]:
                raise asyncpg.UndefinedColumnError("column \"answer\" does not exist")
            state["inserted"].append(("assistant", args))
            return uuid.UUID(MSG)
        if "INSERT INTO public.hub_chat_messages" in q and "'user'" in q:
            state["inserted"].append(("user", args))
            return uuid.UUID(MSG)
        return None

    async def _fetchrow(query, *args):
        q = " ".join(query.split())
        if "FROM public.hub_chat_sessions" in q and q.startswith("SELECT"):
            return state["session"]
        if "INSERT INTO public.hub_chat_sessions" in q:
            return {"id": uuid.UUID(SESSION)}
        if "hub_brand_profiles" in q:
            return state["brand"]
        return None

    async def _fetch(query, *args):
        q = " ".join(query.split())
        if "SELECT role, content FROM public.hub_chat_messages" in q:
            return state["history"]
        return []

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetch.side_effect = _fetch
    mock_pool.acquire.return_value.fetchval.side_effect = _fetchval

    async def _spend(conn, **kw):
        state["spends"].append(kw)
        return Receipt()

    async def _refund(**kw):
        state["refunds"].append(kw)
        return None

    async def _search(client_id, query, top_k=5):
        state["kb_calls"].append((client_id, query))
        return []

    async def _generate(**kw):
        state["generated"].append(kw)
        return {"text": "Six customers are past 45 days [1].", "provider": "gemini",
                "model": "gemini-2.5-flash", "cost_usd": 0.0004,
                "grounding_sources": []}

    monkeypatch.setattr("services.credits.spend", _spend)
    monkeypatch.setattr("services.credits.refund_standalone", _refund)
    monkeypatch.setattr(hub, "search_hybrid", _search)
    monkeypatch.setattr(hub, "generate", _generate)
    return state


@pytest.fixture
def grants(monkeypatch):
    """Which modules the caller holds. `held_module_levels` is the same
    resolution `require_module` performs, and `skills/modules.withheld_modules`
    is the only thing that calls it — so this is the real gate, not a stub of
    the answer it produces."""
    held = {"held": set()}

    async def _levels(user_id, org_id, module_code):
        return {"viewer"} if module_code in held["held"] else set()

    monkeypatch.setattr("services.skills.modules.held_module_levels", _levels)
    return held


def rows_for_receivables(n=2):
    return [
        {"entity": {"id": str(i), "label": f"INV-{2100 + i}", "module": "invoices"},
         "owner": "user_mem001", "days_past": 96 - i}
        for i in range(n)
    ]


@pytest.fixture
def reads(monkeypatch):
    """What `build_context` returns, per source key. The endpoint reaches it
    through `sahayak.read_plan`, so patching here exercises the real planner,
    the real module declarations and the real reading/figure/evidence code."""
    plan = {}

    async def _build(pool, org_id, sources, **kw):
        return {key: plan[key] for key in sources if key in plan}

    monkeypatch.setattr("services.sahayak_answer.build_context", _build)
    return plan


async def ask(api_client, question="Who owes us money and what have we chased?", **extra):
    return await api_client.post("/api/v1/hub/chat", json={"message": question, **extra})


# ── 1 · the endpoints exist at all ──────────────────────────────────────────

def test_both_endpoints_are_registered():
    paths = {r.path for r in hub.router.routes}
    assert "/api/v1/hub/chat" in paths, "the Sahayak screen has no answer route"
    assert "/api/v1/hub/skills/feedback" in paths


# ── 2 · a record the caller may not see never reaches sources ───────────────

@pytest.mark.asyncio
async def test_a_caller_without_the_grant_gets_a_refusal_not_an_answer(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """The whole reason the refusal block is not optional.

    The question needs Finance. The caller holds nothing. The response must say
    so — not hedge, not estimate, not answer around the hole.
    """
    grants["held"] = set()
    reads["receivables"] = {"ok": True, "kind": "simple",
                            "label": "Overdue customer invoices",
                            "data": rows_for_receivables(), "dropped": 0}

    resp = await ask(api_client)
    assert resp.status_code == 200
    body = resp.json()

    assert body["answered"] is False
    assert body["refusal"], "a refusal with no sentence is a blank block on screen"
    assert "Finance" in body["refusal"], body["refusal"]
    assert body["refusal_detail"]["kind"] == "access"
    assert body["refusal_detail"]["withheld_modules"] == ["ganit", "graha"]
    assert body["message"] == body["refusal"], \
        "the message must BE the refusal, not prose with a refusal beside it"


@pytest.mark.asyncio
async def test_the_withheld_record_is_not_in_sources_and_was_never_read(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """Not filtered out of the list — never fetched.

    A filter applied after the read is a filter somebody removes, and the row is
    in the process memory of a request made by someone who may not see it either
    way.
    """
    grants["held"] = set()
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "x",
                            "data": rows_for_receivables(), "dropped": 0}

    body = (await ask(api_client)).json()

    assert body["sources"] == []
    assert body["figs"] == []
    assert body["evidence"] is None
    assert wired["kb_calls"] == [], "the knowledge base was searched anyway"
    assert wired["generated"] == [], "a model was asked to answer a refused question"


@pytest.mark.asyncio
async def test_refusing_for_lack_of_a_grant_charges_nothing(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    grants["held"] = set()
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "x", "data": [], "dropped": 0}
    await ask(api_client)
    assert wired["spends"] == [], "the customer paid for an answer they were refused"


@pytest.mark.asyncio
async def test_holding_the_grant_puts_the_record_in_sources_with_its_route(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """The same request by someone who may see it — the other half of the pair.

    Without both, a test that asserts absence passes just as well against an
    endpoint that returns nothing to anyone.
    """
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple",
                            "label": "Overdue customer invoices",
                            "data": rows_for_receivables(3), "dropped": 0}
    reads["followups"] = {"ok": True, "kind": "simple", "label": "Overdue CRM follow-ups",
                          "data": [], "dropped": 0}

    body = (await ask(api_client)).json()

    assert body["answered"] is True
    assert body["refusal"] == "", "nothing was withheld, so nothing should be claimed"
    titles = [s["title"] for s in body["sources"]]
    assert "Overdue customer invoices" in titles
    first = body["sources"][0]
    assert first["ref"] == 1, "an unnumbered source cannot be cited inline"
    assert first["route"] == "GET /api/v1/ganit/invoices"
    assert first["kind"] == "data"
    assert first["module"] == "Finance"


# ── 3 · the panels the screen was drawn for ─────────────────────────────────

@pytest.mark.asyncio
async def test_the_work_steps_name_what_was_read_and_what_it_cost(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """29 §2 rule 4: a spinner over a data question tells the reader nothing
    about what is being read on their behalf."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(), "dropped": 0}
    reads["followups"] = {"ok": True, "kind": "simple", "label": "l", "data": [], "dropped": 0}

    work = (await ask(api_client)).json()["work"]

    assert [w["fn"] for w in work] == [
        "find_overdue_invoices", "find_overdue_followups", "agent_type: chatbot",
    ]
    assert [w["note"] for w in work[:2]] == ["free", "free"], \
        "a data read costs no AI credits and the row must say so"
    assert work[-1]["note"] == "2 credits"
    assert all(w["state"] in ("done", "now", "wait") for w in work), \
        "AnswerBody only styles these three"


@pytest.mark.asyncio
async def test_every_figure_carries_the_route_it_came_from(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """29 §3, and `AnswerBody.Figs` drops a figure with no `src` on the floor —
    a number with no provenance is the one thing worse than not answering."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(4), "dropped": 8}

    figs = (await ask(api_client)).json()["figs"]

    assert figs, "the figure strip is empty on a question that read 12 rows"
    assert all(f.get("src") for f in figs)
    assert all(f.get("value") is not None for f in figs)
    assert figs[0]["value"] == "12", "4 shown + 8 dropped is 12, not 4"
    assert "oldest" in figs[0]["sub"]


@pytest.mark.asyncio
async def test_the_evidence_table_is_the_rows_themselves(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(2), "dropped": 0}

    ev = (await ask(api_client)).json()["evidence"]

    assert ev is not None
    assert "Item" in ev["cols"] and "Days past due" in ev["cols"]
    assert len(ev["rows"]) == 2
    assert ev["rows"][0][0] == "INV-2100"
    assert ev["src"] == "GET /api/v1/ganit/invoices"
    assert all(isinstance(cell, str) for row in ev["rows"] for cell in row), \
        "a cell that is not a string is a React render error, not a table"


# ── 4 · the other two refusals ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_source_that_could_not_be_read_refuses_rather_than_guessing(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """`build_context` tags a source that RAISED. If every source the question
    needed is in that state there is nothing to ground an answer in, and a model
    handed an empty context answers over the hole with the same confidence."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": False, "kind": "simple",
                            "label": "Overdue customer invoices", "error": "TimeoutError"}
    reads["followups"] = {"ok": False, "kind": "simple",
                          "label": "Overdue CRM follow-ups", "error": "TimeoutError"}

    body = (await ask(api_client)).json()

    assert body["answered"] is False
    assert body["refusal_detail"]["kind"] == "unavailable"
    assert "TimeoutError" in body["refusal"]
    assert wired["generated"] == []
    assert wired["spends"] == [], "nothing was read, so nothing may be charged"
    assert [w["state"] for w in body["work"]] == ["wait", "wait"]


@pytest.mark.asyncio
async def test_a_partial_failure_answers_and_names_what_it_could_not_reach(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """The prototype's `none` block in its ordinary form — "what it would not
    tell you". `refusal` being set does not mean the answer was refused."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(), "dropped": 0}
    reads["followups"] = {"ok": False, "kind": "simple",
                          "label": "Overdue CRM follow-ups", "error": "TimeoutError"}

    body = (await ask(api_client)).json()

    assert body["answered"] is True
    assert body["refusal_detail"]["kind"] == "partial"
    assert "Overdue CRM follow-ups" in body["refusal"]
    assert [s["title"] for s in body["sources"]] == ["Overdue customer invoices"], \
        "a source that failed is not a source"


@pytest.mark.asyncio
async def test_a_generation_failure_refunds_and_refuses(
    api_client, as_member, with_org_id, wired, grants, reads, monkeypatch,
):
    """The older chat route turns this exception into a friendly 200 reading
    "Sorry, I encountered an error", which every consumer downstream reads as an
    answer. Here it is a refusal, and the credit goes back."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(), "dropped": 0}

    async def _boom(**kw):
        raise RuntimeError("All AI providers failed")

    monkeypatch.setattr(hub, "generate", _boom)

    body = (await ask(api_client)).json()

    assert body["answered"] is False
    assert body["refusal_detail"]["kind"] == "generation_failed"
    assert body["message"] == body["refusal"]
    assert "Sorry" not in body["message"]
    assert len(wired["refunds"]) == 1
    assert wired["refunds"][0]["tx_id"] == "tx-1"
    assert body["credits"] == 0, "a refunded answer must not report a charge"


# ── 5 · money and models ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_answer_is_charged_once_through_the_existing_ledger(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l", "data": [], "dropped": 0}

    body = (await ask(api_client)).json()

    assert len(wired["spends"]) == 1, "one answer, one charge"
    spend = wired["spends"][0]
    assert (spend["kind"], spend["ref_id"]) == ("channel", "chatbot_message"), \
        "a new price kind would be a second spend path"
    assert spend["idempotency_key"].startswith("sahayak-chat:")
    assert body["credits"] == 2 and body["credits_charged"] == 2


@pytest.mark.asyncio
async def test_the_model_call_takes_the_cheap_chatbot_branch(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """`_select_providers` branches on TASK. `agent_type="chatbot"` reaches no
    branch at all and falls through to the free English bulk chain — the bug
    that answered every chatbot question this product ever asked."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l", "data": [], "dropped": 0}

    await ask(api_client)

    call = wired["generated"][0]
    assert call["task"] == "chatbot"
    assert call["agent_type"] == "chatbot"
    assert call["org_id"] == with_org_id


def test_the_assistant_cannot_reach_an_image_generator():
    """`hub_chat.py` enforces this structurally — it imports no image entry
    point. This module cannot: the content routes need `generate_image`. So the
    control is here, on the function, and it fails the build on the call."""
    import ast
    import inspect
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(hub.sahayak_chat)))
    called = {
        node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
        for node in ast.walk(tree) if isinstance(node, ast.Call)
    }
    banned = {"generate_image", "generate_rich_content"}
    assert not (banned & called), (
        f"sahayak_chat calls {sorted(banned & called)}. Image generation from "
        f"chat is off by the owner's decision."
    )


# ── 6 · scoping that is not about modules ───────────────────────────────────

@pytest.mark.asyncio
async def test_a_session_belonging_to_another_org_is_not_found(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """A session id read on trust is how `hub_chat.create_chat_session` came to
    let one org's assistant summarise another's knowledge base: `client_id` is
    taken off the session and handed to the retrieval layer."""
    wired["session"] = None
    resp = await ask(api_client, session_id=SESSION)
    assert resp.status_code == 404
    assert wired["generated"] == []


@pytest.mark.asyncio
async def test_the_knowledge_base_is_searched_for_the_verified_workspace_only(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l", "data": [], "dropped": 0}
    await ask(api_client)
    assert wired["kb_calls"] == [(CLIENT, "Who owes us money and what have we chased?")]


@pytest.mark.asyncio
async def test_a_citation_pointing_at_nothing_is_stripped(
    api_client, as_member, with_org_id, wired, grants, reads, monkeypatch,
):
    """`AnswerBody` renders an uncitable `[n]` as literal text, which reads as a
    rendering fault in the middle of a sentence."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(), "dropped": 0}

    async def _wild(**kw):
        return {"text": "One [1] and [9] and [42].", "provider": "gemini",
                "model": "m", "cost_usd": 0, "grounding_sources": []}

    monkeypatch.setattr(hub, "generate", _wild)

    body = (await ask(api_client)).json()
    assert "[1]" in body["message"]
    assert "[9]" not in body["message"] and "[42]" not in body["message"]


@pytest.mark.asyncio
async def test_the_answer_stores_without_the_119_column(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """Production's actual state. The structured half is lost on reload; the
    answer the caller gets is identical."""
    wired["answer_column"] = False
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(), "dropped": 0}

    body = (await ask(api_client)).json()

    assert body["answered"] is True
    assert body["work"] and body["figs"]
    assert body["message_id"] == MSG


# ── 7 · the feedback endpoint ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_feedback_must_name_what_it_is_about(api_client, as_member, with_org_id):
    resp = await api_client.post("/api/v1/hub/skills/feedback", json={"accepted": False})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_feedback_on_another_orgs_answer_is_not_found(
    api_client, as_member, with_org_id, mock_pool,
):
    """The org check goes through the SESSION. `hub_chat_messages` has no org
    column, so a check against the message alone would confirm the existence of
    — and accept feedback on — another tenant's answer."""
    async def _fetchval(query, *args):
        return None

    mock_pool.fetchval.side_effect = _fetchval
    resp = await api_client.post(
        "/api/v1/hub/skills/feedback", json={"accepted": False, "message_id": MSG},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_feedback_is_hashed_the_way_the_dispatcher_looks_it_up(
    api_client, as_member, with_org_id, mock_pool,
):
    """`_get_feedback_corrections` finds a correction by (template, org,
    input_hash). A row written with any other hash is a row the self-learning
    loop can never find, and "recorded" would quietly mean nothing."""
    from services.skill_dispatcher import _hash_input

    template = "44444444-4444-4444-4444-444444444444"
    written = {}

    async def _fetchval(query, *args):
        return 1

    async def _fetchrow(query, *args):
        written["sql"] = " ".join(query.split())
        written["args"] = args
        return {"id": uuid.UUID(MSG)}

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow

    resp = await api_client.post("/api/v1/hub/skills/feedback", json={
        "accepted": False, "template_id": template,
        "variables": {"period": "2026-07", "b": 1},
        "corrected": {"total": 3},
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["input_hash"] == _hash_input({"period": "2026-07", "b": 1})
    assert body["will_correct_future_runs"] is True
    assert "hub_skill_feedback" in written["sql"]


@pytest.mark.asyncio
async def test_feedback_records_without_the_119_columns(
    api_client, as_member, with_org_id, mock_pool,
):
    template = "44444444-4444-4444-4444-444444444444"
    seen = []

    async def _fetchval(query, *args):
        return 1

    async def _fetchrow(query, *args):
        q = " ".join(query.split())
        seen.append(q)
        if "created_by" in q:
            raise asyncpg.UndefinedColumnError("column \"created_by\" does not exist")
        return {"id": uuid.UUID(MSG)}

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow

    resp = await api_client.post("/api/v1/hub/skills/feedback", json={
        "accepted": True, "template_id": template, "note": "useful",
    })
    assert resp.status_code == 201
    assert len(seen) == 2, "the fallback insert never ran"
    assert "created_by" not in seen[1]
    assert resp.json()["will_correct_future_runs"] is False


# ── 8 · the answer service, unit ────────────────────────────────────────────

def test_the_planner_needs_no_model_and_is_deterministic():
    plan = [i.key for i in sahayak.plan_for("Who owes us money past 45 days, and what have we already chased?")]
    assert plan == ["receivables", "followups"]
    assert plan == [i.key for i in sahayak.plan_for(
        "Who owes us money past 45 days, and what have we already chased?")]


def test_a_devanagari_question_reaches_the_same_source():
    """Two of the six approved openers are Devanagari. A planner that only
    matches English refuses them by accident."""
    assert [i.key for i in sahayak.plan_for("किस क्लाइंट का भुगतान बाकी है?")] == ["receivables"]


def test_a_question_about_nothing_in_the_books_plans_nothing():
    """"Explain a rule in plain language" is an approved opener and needs no
    ledger. Planning a read for it would demand a module grant it does not need,
    which turns a general question into a refusal."""
    assert sahayak.plan_for("Explain a rule in plain language") == []
    assert sahayak.modules_for_plan([]) == frozenset()


def test_the_plan_is_capped_so_one_question_cannot_read_everything():
    everything = ("who owes us, we owe, follow up, overdue task, unsigned, "
                  "pipeline, stock, attendance, revenue")
    assert len(sahayak.plan_for(everything)) == sahayak.MAX_SOURCES


def test_every_intent_names_a_real_context_source_with_a_declared_module():
    """An intent naming a source that `SOURCE_MODULES` does not declare gets
    every sensitive module — fail-closed, but it would refuse everyone. An
    intent naming a source that does not exist reads nothing at all."""
    from services.skills.context import SOURCES
    from services.skills.modules import SOURCE_MODULES
    for intent in sahayak.INTENTS:
        assert intent.key in SOURCES, f"{intent.key} is not a context source"
        assert intent.key in SOURCE_MODULES, f"{intent.key} declares no module"
        assert intent.route.startswith("GET /api/"), intent.route


def test_money_is_grouped_the_indian_way():
    """Every document this product prints groups in lakhs. A figure grouped in
    thousands reads as a different number to the person checking it."""
    assert sahayak.format_inr(1840000) == "₹18,40,000"
    assert sahayak.format_inr(620000) == "₹6,20,000"
    assert sahayak.format_inr(950) == "₹950"


def test_a_kpi_that_is_not_known_produces_no_tile():
    """`aggregate_kpis` returns None for an arm it could not read, and names it
    in `unavailable`. A tile reading 0 would be a fabricated figure with a
    route attached, which is worse than no tile."""
    reading = sahayak.Reading(
        sahayak.INTENTS_BY_KEY["kpis"], ok=True,
        data={"period": "30d", "revenue": None, "deals_won": 4,
              "unavailable": ["revenue"]},
    )
    figs = sahayak.figures_for([reading])
    assert [f["label"] for f in figs] == ["Deals won"]


def test_a_failed_source_produces_no_figure_and_no_source_card():
    reading = sahayak.Reading(
        sahayak.INTENTS_BY_KEY["receivables"], ok=False, error="TimeoutError")
    assert sahayak.figures_for([reading]) == []
    assert sahayak.data_sources([reading])[0] == []
    assert sahayak.evidence_for([reading]) is None


def test_the_context_block_names_what_it_could_not_read():
    """`render_context`'s rule, kept: the model has to be able to say "I could
    not see your invoices", and it can only say that if it is told."""
    block = sahayak.render_readings([
        sahayak.Reading(sahayak.INTENTS_BY_KEY["receivables"], ok=True, data=[]),
        sahayak.Reading(sahayak.INTENTS_BY_KEY["followups"], ok=False, error="TimeoutError"),
    ], [])
    assert "[1] Overdue customer invoices" in block
    assert "Could not be read" in block and "TimeoutError" in block
    assert "unknown, not as empty" in block


def test_the_system_prompt_forbids_figures_when_nothing_was_read():
    prompt = sahayak.system_prompt(None, "English", 0)
    assert "Do not state figures" in prompt
    assert "[1]" not in prompt, "there is no [1] to cite"


# ── 9 · the silent degradation, and the recognition that caused it ──────────
#
# Measured on staging 2026-08-07. `plan_for` substring-matched nine fixed phrase
# lists: "overdue tasks" matched, "open tasks" did not. On a miss it read
# nothing and the model answered ungrounded, producing "I don't currently have
# access to your task records" — false, since the caller HAS the grant and
# Sahayak reads those very records for a question one word different.
#
# Every test below fails against the code as it stood before 2026-08-07 evening.

@pytest.mark.parametrize("question,key", [
    # The exact reported miss, and its neighbours.
    ("What are our open tasks?", "tasks"),
    ("Show me all tasks assigned to Priya", "tasks"),
    ("What is pending this week?", "tasks"),
    ("Which invoices are still unpaid?", "receivables"),
    ("Who are our biggest debtors?", "receivables"),
    ("What do we owe our suppliers?", "payables"),
    ("Which leads have gone quiet?", "followups"),
    ("Which deals are stuck in stage?", "deal_health"),
    ("Are any SKUs running low?", "stock"),
    ("Who is on leave next week?", "attendance"),
    ("Any contracts waiting on signature?", "agreements"),
    ("How did we do last month?", "kpis"),
])
def test_the_planner_recognises_the_ordinary_phrasings(question, key):
    """One-word variants of a recognised question used to fall off the table
    entirely, and falling off it was invisible. Singular patterns matched
    against stemmed tokens is what makes plural and singular the same word."""
    assert key in [i.key for i in sahayak.plan_for(question)], question


def test_a_bare_noun_does_not_match_inside_a_longer_word():
    """The price of putting bare nouns in the table is that matching has to be
    on token boundaries. "deal" in "dealing" would plan a CRM read — and demand
    a CRM grant — for a question about customer service."""
    assert sahayak.plan_for("Any advice on dealing with a rude caller?") == []


def test_plurals_and_singulars_reach_the_same_source():
    assert ([i.key for i in sahayak.plan_for("overdue task")]
            == [i.key for i in sahayak.plan_for("overdue tasks")]
            == ["tasks"])


def test_a_miss_on_a_question_about_their_records_is_visible():
    """The heart of it. An unrecognised question about their own books plans
    nothing — correctly, since guessing a read demands a grant it may not
    need — but the reader is TOLD, instead of being handed fluent prose that
    reads exactly like a grounded answer."""
    q = "Which of our branches is furthest behind on paperwork?"
    assert sahayak.plan_for(q) == []
    assert sahayak.looks_like_org_question(q) is True

    text, detail = sahayak.refusal_unrecognised(q)
    assert detail["kind"] == "unrecognised"
    assert "Nothing from your own records was read" in text
    assert {c["key"] for c in detail["can_read"]} == {i.key for i in sahayak.INTENTS}


def test_a_general_question_is_not_dressed_up_as_a_miss():
    """"Explain a rule in plain language" is an approved opener. Telling its
    asker that Sahayak could not work out which of their records to read would
    be noise on a question that needed none — and the first person alone is not
    enough to make a question about the books."""
    assert sahayak.looks_like_org_question("Explain a rule in plain language") is False
    assert sahayak.looks_like_org_question("How do we file GSTR-1?") is False


def test_the_no_source_prompt_forbids_the_sentence_that_was_actually_produced():
    """Not hypothetical: this is the reply staging returned, verbatim. The
    caller has access; nothing was fetched for that one question. Those are
    different statements and only one of them is true."""
    prompt = sahayak.system_prompt(None, "English", 0)
    assert "You DO have access" in prompt
    assert "Never say or imply that you lack access" in prompt


@pytest.mark.asyncio
async def test_an_unrecognised_question_answers_and_says_nothing_was_read(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """End to end. The answer still stands — this is the prototype's `none`
    block, not a refusal of service — and it carries no figures, no evidence
    and no sources, because none were read."""
    grants["held"] = {"ganit", "graha", "vikray", "manav", "esign"}

    body = (await ask(
        api_client, "Which of our branches is furthest behind on paperwork?",
    )).json()

    assert body["answered"] is True
    assert body["read"] == []
    assert body["refusal_detail"]["kind"] == "unrecognised"
    assert body["figs"] == [] and body["evidence"] is None
    assert body["sources"] == []


@pytest.mark.asyncio
async def test_a_recognised_question_carries_no_unrecognised_block(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(), "dropped": 0}
    reads["followups"] = {"ok": True, "kind": "simple", "label": "l",
                          "data": [], "dropped": 0}

    body = (await ask(api_client)).json()

    assert body["refusal_detail"] is None
    assert body["refusal"] == ""


# ── 10 · the org boundary, on both stores ───────────────────────────────────

def test_nothing_on_the_answer_path_can_reach_object_storage():
    """The owner's requirement is same-org only across Postgres AND R2.

    Postgres is scoped by `org_id`, which every read handler takes and which
    `get_org_id` resolves — and by `client_id` for the knowledge base, which
    `sahayak_chat` verifies against the org before searching (pinned by
    `test_the_knowledge_base_is_searched_for_the_verified_workspace_only`).

    R2 is scoped by NOT BEING REACHED. The knowledge base stores its chunk text
    in `staging.hub_kb_chunks`; ingestion is what touches storage, and it is a
    different path with a different caller. That is a fact about the code and
    not a promise, so it is asserted rather than written in a comment: an import
    added here later is a bucket read with no org predicate on it, and it fails
    the build instead of shipping.
    """
    import inspect
    import re as _re

    src = inspect.getsource(sahayak) + inspect.getsource(hub.sahayak_chat)
    banned = _re.compile(r"\b(boto3|r2_client|get_r2|presign|signed_url|s3)\b", _re.I)
    assert not banned.search(src), "the answer path must not read object storage"
