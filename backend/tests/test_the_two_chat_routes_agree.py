"""Two live chat routes, one product, and a seam they had drifted apart across.

`POST /api/v1/hub/chat` — `routers/hub.py::_sahayak_answer` — serves the Sahayak
tab and the mobile app. `POST /api/v1/hub/chat/sessions/{id}/send` —
`routers/hub_chat.py::send_chat_message` — serves Hub chat, and
`frontend/src/pages/hub/ChatTab.jsx` posts to it. Both are live, both are gated,
and nothing in an answer tells the reader which one produced it.

Two things reached one route and not the other, and both are pinned here:

  THE HOUSE WORDS. The glossary was injected in `_sahayak_answer` only. "Can I
  still edit invoice INV-0007? Its status says final and it has not been paid."
  arrived at one route with `glossary_terms/doc-status.md` in front of it and at
  the other with nothing, leaving the second free to read `final` as issued —
  the exact sentence that term file was written to stop.

  THE RETRIEVAL SHAPE. `_sahayak_answer` takes `KB_TOP_K` chunks straight from
  the hybrid search. `send_chat_message` fetched twenty and re-ranked them to
  five with a second, blocking model call that asks `ai_router.generate` without
  a `task` — so `_latency_class` judged it against the 20,000 ms BULK budget
  while the person waiting on it was on the 4,000 ms interactive one. It had
  never actually run: the old ILIKE branch returned nothing, so `rerank`
  short-circuited on `len(chunks) <= top_k` before it could charge or delay
  anything. The full-text rewrite in `services/rag.py` is what would have armed
  it, which is why it is removed in the same phase rather than after the first
  corpus lands.

The structural checks come first on purpose. The end-to-end call below would
pass against a route that injected the definitions in the wrong place, or that
re-ranked and happened to keep the same chunks.
"""
import ast
import inspect
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from services import credits, glossary
from services import sahayak_answer as sahayak

ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "22222222-2222-2222-2222-222222222222"
SESSION = "33333333-3333-3333-3333-333333333333"
MSG = "44444444-4444-4444-4444-444444444444"
USER = "user_test001"

#: A question the owner has actually had answered wrongly. Every alias in it —
#: "final", "edit the invoice" — is one `glossary_terms/doc-status.md` declares.
DOC_STATUS_QUESTION = (
    "Can I still edit the invoice INV-0007? Its status says final and it has "
    "not been paid."
)

#: A question with no house word in it at all. The glossary must stay silent:
#: definitions in front of a question they do not touch are latency spent on
#: nothing, on the one axis this assistant is actually failing.
PLAIN_QUESTION = "Write a short congratulations message for the team."

HUB_CHAT = Path(__file__).resolve().parents[1] / "routers" / "hub_chat.py"


# ══════════════════════════════════════════════════════════════════════════════
# 1 · The second model call is gone from the interactive path
# ══════════════════════════════════════════════════════════════════════════════

def _names_bound_and_called(path: Path):
    """Imported names and called names, by AST.

    Parsed and not grepped, for the reason `test_ai_routing.py` gives about the
    image entry points: this file's own header names the re-ranker to explain
    why it is absent, and a text scan would be satisfied by that sentence.
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


def test_the_interactive_answer_pays_for_no_second_model_round_trip():
    """`rerank` is neither imported nor called by the chat router.

    Not a latency assertion — there is nothing to time, because the corpus is
    empty and the call would not fire today anyway. It is the shape: a blocking
    model call standing in front of an answer somebody is watching, routed on a
    budget meant for a batch of captions. `reranker.rerank` takes no `task`, so
    the caller cannot fix that from here; the call goes instead.
    """
    bound, called = _names_bound_and_called(HUB_CHAT)
    assert "rerank" not in bound, (
        "routers/hub_chat.py imports the re-ranker again. It is a second, "
        "blocking LLM call in front of an interactive answer, judged against "
        "the 20,000 ms bulk budget — see the module header."
    )
    assert "rerank" not in called


def test_the_chunk_count_is_one_number_and_both_routes_read_it():
    """`KB_MIN_SCORE` taught this lesson once already: two copies of a retrieval
    constant is how two chat routes come to disagree about the same knowledge
    base. The count is the same kind of number and gets the same treatment."""
    from routers import hub_chat

    assert hub_chat.KB_TOP_K == sahayak.KB_TOP_K

    send = inspect.getsource(hub_chat.send_chat_message)
    assert "top_k=KB_TOP_K" in send
    assert "top_k=20" not in send, (
        "twenty candidates exist only to feed a re-ranker; asking for them "
        "again is how that call comes back"
    )


# ══════════════════════════════════════════════════════════════════════════════
# 2 · The house words reach both routes, from one place
# ══════════════════════════════════════════════════════════════════════════════

def test_both_routes_call_the_same_glossary_and_not_a_copy_of_it():
    """The point is not that each route has definitions. It is that they have
    the SAME definitions, from the same files, so a term the owner edits changes
    both answers on the same deploy."""
    from routers import hub, hub_chat

    assert hub_chat.glossary is glossary
    assert hub.glossary is glossary


def test_the_router_matches_on_the_message_and_not_on_the_history():
    """`prompt` carries up to ten previous turns by the time it is built. A
    question three messages ago must not drag its vocabulary into this answer
    and displace the definitions this question actually needs — the same reason
    `detect_language` reads `body.message`."""
    from routers import hub_chat

    send = inspect.getsource(hub_chat.send_chat_message)
    assert "glossary.for_question(body.message)" in send


# ══════════════════════════════════════════════════════════════════════════════
# 3 · End to end, into the arguments the provider is actually given
# ══════════════════════════════════════════════════════════════════════════════

class _Conn:
    def transaction(self):
        class _T:
            async def __aenter__(self_):
                return None

            async def __aexit__(self_, *a):
                return False

        return _T()

    async def fetchval(self, sql, *args):
        return MSG if "INSERT INTO staging.hub_chat_messages" in sql else None

    async def execute(self, sql, *args):
        return "OK"


class _ChatPool:
    def __init__(self):
        self.rows = {
            "FROM staging.hub_chat_sessions": {"client_id": CLIENT},
            "COUNT(*) FROM staging.hub_chat_messages": 1,
            "hub_brand_profiles": None,
        }

    def acquire(self):
        class _A:
            async def __aenter__(self_):
                return _Conn()

            async def __aexit__(self_, *a):
                return False

        return _A()

    def _lookup(self, sql):
        for needle, value in self.rows.items():
            if needle in sql:
                return value
        return None

    async def fetchrow(self, sql, *args):
        return self._lookup(sql)

    async def fetchval(self, sql, *args):
        return self._lookup(sql)

    async def fetch(self, sql, *args):
        return self._lookup(sql) or []

    async def execute(self, sql, *args):
        return "OK"


def _hit(score=0.2064):
    return {
        "chunk_id": "55555555-5555-5555-5555-555555555555",
        "content": "Invoices are issued from the Ganit module.",
        "doc_title": "Billing Handbook",
        "document_id": "66666666-6666-6666-6666-666666666666",
        "source_type": "text",
        "chunk_index": 0,
        "similarity": score,
        "vec_score": 0.0,
        "text_score": score,
    }


async def _send(monkeypatch, message, kb_hits):
    """Drive the route and hand back the system prompt the provider was given.

    Credits are stubbed: `tests/test_unmetered_channels_now_charge.py` owns the
    money, and a vocabulary test must not fail for a billing reason.
    """
    from routers import hub_chat
    from routers.hub_chat import ChatMessage

    async def _spend(conn=None, **kw):
        return credits.Receipt(
            tx_id="tx-1", org_id=kw.get("org_id"), user_id=kw.get("user_id"),
            kind=kw.get("kind", ""), ref_id=kw.get("ref_id"), quantity=1,
            credits=2, from_allowance=2, from_purchased=0, balance_after=0,
            metered_only=False, replayed=False,
        )

    monkeypatch.setattr(credits, "spend", _spend)
    monkeypatch.setattr(credits, "refund_standalone", AsyncMock(return_value=None))
    monkeypatch.setattr(hub_chat, "get_pool", AsyncMock(return_value=_ChatPool()))
    monkeypatch.setattr(hub_chat, "search_hybrid", AsyncMock(return_value=kb_hits))

    captured = {}

    async def _gen(**kw):
        captured.update(kw)
        return {"text": "Yes.", "model": "m", "provider": "p",
                "cost_usd": 0.0, "grounding_sources": []}

    monkeypatch.setattr(hub_chat, "generate", _gen)

    await hub_chat.send_chat_message(
        session_id=UUID(SESSION),
        body=ChatMessage(message=message),
        user={"user_id": USER},
        org_id=ORG,
        _gate=None,
    )
    assert captured, "send_chat_message never reached the AI router"
    return captured["system"]


@pytest.mark.asyncio
async def test_hub_chat_is_told_what_final_means_before_it_answers(monkeypatch):
    """The regression in one call. Without the block, `final` is a word the
    model knows from everywhere except this product, and everywhere else it
    means issued."""
    system = await _send(monkeypatch, DOC_STATUS_QUESTION, [])

    assert "HOUSE VOCABULARY" in system
    assert "DOC STATUS" in system, "the term the question was about never arrived"
    assert "Do not answer like this:" in system


@pytest.mark.asyncio
async def test_the_definitions_arrive_above_the_chunks_they_describe(monkeypatch):
    """Order, not presence. The chunks talk about invoices in this product's
    sense; a model that reads them before the definitions has already decided
    what the words meant."""
    system = await _send(monkeypatch, DOC_STATUS_QUESTION, [_hit()])

    assert "Relevant knowledge base context" in system, \
        "this case is not exercising a KB prompt"
    assert system.index("HOUSE VOCABULARY") < system.index("Relevant knowledge base context")
    # And the language instruction still lands last, which is the one thing that
    # has to survive a context block running to thousands of tokens.
    assert system.index("LANGUAGE:") > system.index("HOUSE VOCABULARY")


@pytest.mark.asyncio
async def test_a_question_touching_no_house_word_carries_no_vocabulary(monkeypatch):
    """The cheap half of the mechanism. An ordinary request must pay nothing for
    definitions it does not need."""
    system = await _send(monkeypatch, PLAIN_QUESTION, [])

    assert "HOUSE VOCABULARY" not in system


@pytest.mark.asyncio
async def test_the_block_carries_no_citation_marker_to_be_stripped(monkeypatch):
    """`_strip_invalid_refs` deletes every `[n]` outside the numbered context. A
    definition carrying one would either be cited at a number pointing at
    somebody's invoice, or lose its marker and read as a rendering fault."""
    import re

    system = await _send(monkeypatch, DOC_STATUS_QUESTION, [])
    block = system[system.index("HOUSE VOCABULARY"):]
    # Everything from the block to the end of the prompt is vocabulary and the
    # language instruction — this case supplies no chunks, so no `[n]` is legal.
    assert re.search(r"\[\d+\]", block) is None
