"""Sahayak's two standing promises, and where the org scope comes from.

`tests/test_sahayak_answer.py` pins what the two endpoints RETURN. This file
pins three things that are properties of the system rather than of a response,
each of which passes today and each of which is one careless edit from not:

  1. THE ORG SCOPE IS RESOLVED, NEVER SUPPLIED. `POST /api/v1/hub/chat` and
     `POST /api/v1/hub/skills/feedback` both take `org_id` from
     `middleware/org_resolver.get_org_id`, which proves membership (or a console
     path, or a support session the customer granted) before it returns a uuid.
     Neither request model has an org field. The tests below drive both routes
     with an org id in the BODY and assert it reaches no query — and then assert
     structurally that no such field exists, which is what stops the next person
     adding one as a convenience.

  2. THE CITATION NUMBERS AGREE. The model is handed a context block numbered
     `[1]…[n]` by `render_readings`; the screen is handed source cards numbered
     `ref: 1…n` by `data_sources` and `kb_sources`; and the system prompt is told
     the range is `[1]` to `cite_max`. Three independent numberings of the same
     list, produced by three functions. `AnswerBody` turns `[1]` into a control
     that opens a record, so a one-off between them is not a cosmetic bug — it
     is a claim pointing at the wrong record, which is the exact thing the whole
     surface exists to promise it does not do. Nothing asserted this.

  3. NO SAHAYAK SURFACE CAN GENERATE AN IMAGE. There are two, not one:
     `hub.sahayak_chat` and `sanvaad_sahayak.ask_sahayak`. The existing gate in
     `test_sahayak_answer.py` parses the first and says nothing about the
     second, which today is safe only because nobody has added the import.

── Why these are verifications and not fixes ──────────────────────────────────

Every assertion here passed the first time it was run against unmodified code.
That is the finding, not a weakness in the tests: the endpoints exist, they are
scoped correctly, and the numbering agrees. Two of the three gates are therefore
written so they cannot pass vacuously — the image gate is run against a decoy
function that DOES call the generator and asserted to catch it, and the org gate
records every query argument rather than asserting the absence of a string.
"""
from __future__ import annotations

import ast
import inspect
import re
import textwrap
import uuid

import pytest

from routers import hub
from routers import sanvaad_sahayak
from services import sahayak_answer as sahayak

from tests.test_sahayak_answer import (  # noqa: F401 — fixtures, used by name
    ask, bypass_module_gate, grants, reads, rows_for_receivables, wired,
)
from tests.conftest import TEST_ORG_ID

#: An org the caller has nothing to do with. Every test that sends it asserts it
#: comes back out of nothing.
OTHER_ORG = "dead0000-0000-0000-0000-00000000beef"


# ══════════════════════════════════════════════════════════════════════════
# 1 · the org scope is the resolved one
# ══════════════════════════════════════════════════════════════════════════

def _org_args(mock_pool) -> set[str]:
    """Every argument that was passed to any query and looks like a uuid.

    Deliberately not "assert OTHER_ORG not in the SQL string". The dangerous
    shape is an org id that arrives as a BOUND PARAMETER — `$2::uuid` is the
    same SQL whichever org it carries, so a test that reads the query text
    would pass against a route that was doing exactly the wrong thing.
    """
    seen: set[str] = set()
    for mock in (mock_pool.fetchval, mock_pool.fetchrow, mock_pool.fetch,
                 mock_pool.execute, mock_pool.acquire.return_value.fetchval):
        for call in mock.call_args_list:
            for arg in call.args[1:]:
                if isinstance(arg, (str, uuid.UUID)):
                    seen.add(str(arg))
    return seen


@pytest.mark.asyncio
async def test_the_chat_route_takes_its_org_from_the_resolver_not_the_body(
    api_client, as_member, with_org_id, mock_pool, wired, grants, reads,
):
    """`get_org_id` proved a membership. The body proved nothing."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "l",
                            "data": rows_for_receivables(2), "dropped": 0}

    resp = await api_client.post(
        "/api/v1/hub/chat",
        # `org_id` and `organisation_id` are both plausible names for somebody
        # to add later, and `client_id` is the one field in this body that DOES
        # name a tenant-scoped row — it is verified, never trusted.
        json={"message": "Who owes us money?", "org_id": OTHER_ORG,
              "organisation_id": OTHER_ORG},
    )
    assert resp.status_code == 200

    args = _org_args(mock_pool)
    assert OTHER_ORG not in args, (
        "an org id from the request body reached a query — the scope must come "
        "from get_org_id, which proved the caller belongs there"
    )
    assert TEST_ORG_ID in args, (
        "no query was scoped to the resolved org at all, so the assertion above "
        "would pass against a route that read nothing"
    )


@pytest.mark.asyncio
async def test_feedback_takes_its_org_from_the_resolver_not_the_body(
    api_client, as_member, with_org_id, mock_pool,
):
    """A feedback row is org-scoped storage. An org id taken off the wire is how
    one tenant writes into another's correction loop."""
    async def _fetchval(query, *args):
        q = " ".join(query.split())
        if "FROM staging.hub_chat_messages m" in q:
            return 1                                  # the message is ours
        return None

    async def _fetchrow(query, *args):
        return {"id": uuid.uuid4()}

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow

    resp = await api_client.post(
        "/api/v1/hub/skills/feedback",
        json={"accepted": False, "message_id": str(uuid.uuid4()),
              "org_id": OTHER_ORG, "note": "wrong figure"},
    )
    assert resp.status_code == 201

    args = _org_args(mock_pool)
    assert OTHER_ORG not in args, "the body's org id was stored or queried with"
    assert TEST_ORG_ID in args, "the row was not scoped to the resolved org"


def test_neither_request_model_can_carry_an_org():
    """The structural half, and the one that survives a refactor.

    The two tests above prove today's behaviour. This one prevents tomorrow's:
    Pydantic ignores an unknown key, so the ONLY way the body could ever scope a
    request is if somebody declares the field. Then it stops being ignored and
    starts being convenient.
    """
    for model in (hub.ChatAsk, hub.SkillFeedback):
        offending = [
            name for name in model.model_fields
            if "org" in name.lower() or "tenant" in name.lower()
        ]
        assert offending == [], (
            f"{model.__name__} declares {offending}. An org must be resolved "
            f"from the request, never accepted from its body."
        )


# ══════════════════════════════════════════════════════════════════════════
# 2 · the three numberings of one list agree
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_numbers_the_model_is_given_are_the_numbers_the_cards_carry(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """`render_readings`, `data_sources` and `system_prompt` number the same
    list three times, independently.

    `AnswerBody` turns `[2]` into a focusable control that opens the record card
    numbered 2. If the context block and the cards ever disagree — the obvious
    way being a failed reading counted in one and skipped in the other — every
    citation after the gap opens the wrong record, and it does so while looking
    perfectly correct.
    """
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "Overdue invoices",
                            "data": rows_for_receivables(3), "dropped": 0}
    reads["followups"] = {"ok": True, "kind": "simple", "label": "Overdue follow-ups",
                          "data": rows_for_receivables(1), "dropped": 0}

    body = (await ask(api_client)).json()
    call = wired["generated"][0]

    # What the SCREEN was given.
    card_refs = [s["ref"] for s in body["sources"] if s.get("ref") is not None]
    assert card_refs, "no numbered source cards, so this test proves nothing"

    # What the MODEL was given. The context block is everything before the
    # separator the route inserts; the question itself is not a numbering.
    grounding = call["prompt"].split("\n\n---\n\n")[0]
    prompt_refs = [int(n) for n in re.findall(r"^\[(\d+)\]", grounding, re.M)]

    assert prompt_refs == card_refs, (
        f"the model was handed {prompt_refs} and the reader was handed "
        f"{card_refs} — a citation opens the wrong record"
    )
    assert card_refs == list(range(1, len(card_refs) + 1)), (
        "source refs must be contiguous from 1; a gap is a citation the screen "
        "cannot resolve and strip_invalid_refs will delete mid-sentence"
    )

    # And what the model was TOLD the range is.
    stated = re.search(r"numbered \[1\] to \[(\d+)\]", call["system"])
    assert stated, "the citation instruction is missing from the system prompt"
    assert int(stated.group(1)) == card_refs[-1], (
        "the model is told a range that does not match the sources it was given"
    )


@pytest.mark.asyncio
async def test_a_source_that_failed_shifts_nobody_elses_number(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """The concrete desync, driven rather than argued.

    `read_plan` returns readings in plan order. `data_sources` skips the failed
    one; `render_readings` also skips it. Both must, and they must skip the SAME
    one — if either counted it, everything after would be off by one.
    """
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": False, "error": "timeout", "kind": "simple",
                            "label": "Overdue invoices", "data": [], "dropped": 0}
    reads["followups"] = {"ok": True, "kind": "simple", "label": "Overdue follow-ups",
                          "data": rows_for_receivables(2), "dropped": 0}

    body = (await ask(api_client)).json()
    grounding = wired["generated"][0]["prompt"].split("\n\n---\n\n")[0]

    assert [s["ref"] for s in body["sources"] if s.get("ref")] == [1]
    assert [int(n) for n in re.findall(r"^\[(\d+)\]", grounding, re.M)] == [1]

    # The survivor is the one that READ, not the one that was asked for first.
    # Both labels are read off the intent table rather than typed here: a card's
    # title comes from `Intent.label`, not from whatever the handler returned,
    # and a literal in this test would only be asserting my memory of it.
    by_key = {i.key: i.label for i in sahayak.INTENTS}
    assert body["sources"][0]["title"] == by_key["followups"]
    assert by_key["receivables"] not in [s["title"] for s in body["sources"]], (
        "a source that could not be read is listed as one — it is a hole, and "
        "it belongs to the refusal block"
    )
    # And the failure is stated to the model rather than dropped silently.
    assert "Could not be read" in grounding
    assert body["refusal"], "a partial read must say what it could not reach"


@pytest.mark.asyncio
async def test_every_source_card_says_where_it_came_from(
    api_client, as_member, with_org_id, wired, grants, reads,
):
    """"It must show its sources" is a claim about PROVENANCE, not about a list
    being non-empty. A card with no route is a title the reader cannot check."""
    grants["held"] = {"ganit", "graha"}
    reads["receivables"] = {"ok": True, "kind": "simple", "label": "Overdue invoices",
                            "data": rows_for_receivables(2), "dropped": 0}

    body = (await ask(api_client)).json()

    data_cards = [s for s in body["sources"] if s.get("kind") == "data"]
    assert data_cards, "a question answered from the ledger cited no ledger"
    for card in data_cards:
        assert card.get("route"), f"{card.get('title')} carries no route"
        assert card["route"].startswith(("GET ", "POST ")), (
            f"{card['route']} is not a route a reader could call"
        )
        assert card.get("module"), "a card that names no module cannot be checked"
    for fig in body["figs"]:
        assert fig.get("src"), "AnswerBody drops a figure with no src on the floor"
    if body["evidence"]:
        assert body["evidence"].get("src"), "the evidence table has no provenance"


@pytest.mark.asyncio
@pytest.mark.parametrize("held,ok", [(set(), True), ({"ganit", "graha"}, False)])
async def test_the_sources_key_is_present_even_when_there_are_none(
    api_client, as_member, with_org_id, wired, grants, reads, held, ok,
):
    """A refusal carries `sources: []`, not no `sources`.

    `_sahayak_payload` says so in its docstring — "an absent key and an empty one
    are different bugs on the screen and the frontend cannot tell them apart".
    Driven across a refusal for lack of a grant and a refusal for a source that
    would not read, because those are the two paths that build a payload without
    going through the answer branch.
    """
    grants["held"] = held
    reads["receivables"] = {"ok": ok, "error": "timeout", "kind": "simple",
                            "label": "l", "data": [], "dropped": 0}

    body = (await ask(api_client)).json()

    assert body["answered"] is False
    for key in ("sources", "work", "figs", "read"):
        assert key in body, f"{key} is absent, not empty"
        assert isinstance(body[key], list)
    assert "evidence" in body
    assert body["refusal"], "a refusal that does not say so is an empty answer"


# ══════════════════════════════════════════════════════════════════════════
# 3 · neither Sahayak surface can generate an image
# ══════════════════════════════════════════════════════════════════════════

#: Every entry point that can put a picture in front of a user.
IMAGE_ENTRY_POINTS = {"generate_image", "generate_rich_content"}


def _calls_in(fn) -> set[str]:
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    return {
        node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
        for node in ast.walk(tree) if isinstance(node, ast.Call)
    }


@pytest.mark.parametrize("fn", [hub.sahayak_chat, sanvaad_sahayak.ask_sahayak],
                         ids=["hub.sahayak_chat", "sanvaad_sahayak.ask_sahayak"])
def test_no_sahayak_surface_can_reach_an_image_generator(fn):
    """THE SECOND SURFACE IS THE POINT OF THIS TEST.

    `test_sahayak_answer.py` already parses `hub.sahayak_chat`. It says nothing
    about the in-channel assistant, which is also called Sahayak, is also
    reached by asking it something, and is also one import away from being able
    to answer "make me a picture of this" with a picture. Owner's decision:
    Sahayak does not generate images on request, on any surface.
    """
    reached = IMAGE_ENTRY_POINTS & _calls_in(fn)
    assert not reached, (
        f"{fn.__qualname__} calls {sorted(reached)}. Sahayak does not generate "
        f"images on request."
    )


def test_the_in_channel_surface_cannot_reach_one_by_import_either():
    """Structural, the way `hub_chat.py` gets it for free.

    The AST gate above covers the handler. This covers the module: an image
    entry point that is imported but not yet called is a call somebody adds in a
    one-line edit that no gate is watching. `routers/hub.py` genuinely needs
    `generate_image` for its content routes and so cannot have this; this module
    has no such excuse.
    """
    source = inspect.getsource(sanvaad_sahayak)
    for name in IMAGE_ENTRY_POINTS:
        assert not re.search(rf"^\s*(from|import)\b.*\b{name}\b", source, re.M), (
            f"routers/sanvaad_sahayak.py imports {name}"
        )


def test_the_image_gate_is_not_vacuous():
    """Proof that the two tests above would notice.

    A gate built out of an AST walk fails open in one obvious way — a shape of
    call it does not recognise — and an assertion that finds nothing looks
    identical whether it is enforcing something or broken. So it is run here
    against a decoy that calls the generator in both the shapes that appear in
    this codebase, and is required to catch both.
    """
    async def decoy_bare():
        return await generate_image(prompt="x")            # noqa: F821

    async def decoy_attribute():
        return await ai_router.generate_rich_content(prompt="x")  # noqa: F821

    assert IMAGE_ENTRY_POINTS & _calls_in(decoy_bare) == {"generate_image"}
    assert IMAGE_ENTRY_POINTS & _calls_in(decoy_attribute) == {"generate_rich_content"}


def test_sahayak_never_offers_an_image_in_its_answer_shape():
    """The other end of the same rule.

    Even if a generator were reached, `_sahayak_payload` is the only thing this
    route returns and it enumerates its keys explicitly. `images` is not one of
    them — unlike `/org/generate`, which returns `result.get("images", [])`. A
    key that cannot be returned is a picture that cannot be delivered.
    """
    shape = hub._sahayak_payload()
    assert "images" not in shape
    assert "image_url" not in shape
    # And the enumeration itself is what makes that true — a payload built by
    # spreading kwargs would let a key in from anywhere.
    assert set(shape) == {
        "session_id", "message_id", "answered", "message", "work", "figs",
        "sources", "evidence", "refusal", "refusal_detail", "model", "credits",
        "credits_charged", "cost_usd", "language", "read",
    }
