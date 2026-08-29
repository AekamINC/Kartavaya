"""The knowledge base has never returned a single result, and two of the reasons
were code in these three files.

Measured on staging 2026-08-19: 90 citations in the product's entire lifetime —
77 web, 13 data, ZERO from the knowledge base. Four independent locks caused it,
and opening one opens nothing. Two of them are here:

  THE SCORE WAS AN OFF SWITCH.  `rag.search_hybrid`'s text branch labelled every
  hit `0.0 as similarity` and `vec_score` 0.0, and both readers kept only what
  scored above 0.3 — `sahayak_answer.KB_MIN_SCORE` and a bare literal in
  `hub_chat.send_chat_message`. Two copies of a number, applied to a constant
  zero, discarding 100% of everything the search found.

  THE QUERY WAS ONE LITERAL.    `WHERE c.content ILIKE '%' || $query || '%'` asks
  for the whole question, question mark and all, as a substring of a chunk. A
  person asking in their own words could not match a document written in someone
  else's, ever.

WHAT THESE TESTS DO NOT CLAIM. Nothing ingests documents into
`staging.hub_kb_chunks` — it holds zero rows and there is no upload path — so a
green run here does NOT mean the knowledge base answers questions. It means the
search can return something once there is something to return. Locks 2 and 3 are
ingestion and a corpus, and they are somebody else's work.

The scores below are not invented. They were measured against the shipped query
on staging on 2026-08-19, with a four-document corpus supplied as a literal
VALUES list so no row was written to a database production also reads.
"""
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from services import credits, rag
from services import sahayak_answer as sahayak

ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "22222222-2222-2222-2222-222222222222"
SESSION = "33333333-3333-3333-3333-333333333333"
MSG = "44444444-4444-4444-4444-444444444444"
USER = "user_test001"

# ── Measured on staging, 2026-08-19, against the query this module now emits ──
# The four-document corpus and the fifteen questions are in the KB_MIN_SCORE
# comment in services/rag.py. These are the two populations it has to separate.
CORRECT_ANSWER_SCORES = {
    "tell me about the tracking link -> Shipping and dispatch": 0.1395,
    "when is gstr-3b due -> GST filing": 0.1650,
    "HSN -> GST filing": 0.1956,
    "How many days of paid leave do I get? -> Employee Handbook": 0.2064,
    "How do I get a refund for an enterprise contract? -> Refund Policy": 0.2304,
    "handbook -> Employee Handbook": 0.3781,
    "What is our refund policy? -> Refund Policy": 0.3974,
}
INCIDENTAL_MATCH_SCORES = {
    "Can a customer get their money back after three weeks? -> Refund Policy": 0.0389,
    "How many days of paid leave do I get? -> Shipping and dispatch": 0.0573,
    "who approves a purchase order over one lakh -> Refund Policy": 0.0886,
}


# ══════════════════════════════════════════════════════════════════════════════
# 1 · The query — a question, not a literal
# ══════════════════════════════════════════════════════════════════════════════

class _RecordingPool:
    """Records the SQL and its arguments, and answers `fetch` with fixed rows.

    Asserting on the SQL is worth doing here and is not enough on its own: a
    mock pool accepts SQL Postgres would reject, and this project has shipped a
    query that only a live database could have caught. The shape assertions
    below are paired with a live read-only probe recorded in the commit report.
    """

    def __init__(self, rows=None):
        self.rows = rows or []
        self.calls = []

    async def fetch(self, sql, *args):
        self.calls.append((sql, list(args)))
        return list(self.rows)

    async def fetchval(self, sql, *args):
        self.calls.append((sql, list(args)))
        return None

    @property
    def sql(self):
        assert self.calls, "search_hybrid never queried anything"
        return self.calls[-1][0]

    @property
    def args(self):
        assert self.calls, "search_hybrid never queried anything"
        return self.calls[-1][1]


def _chunk_row(text_score, *, title="Refund Policy", all_terms=True):
    return {
        "chunk_id": UUID("55555555-5555-5555-5555-555555555555"),
        "content": "Customers may request a refund within 30 days of purchase.",
        "chunk_index": 0,
        "doc_title": title,
        "document_id": UUID("66666666-6666-6666-6666-666666666666"),
        "source_type": "text",
        "text_score": text_score,
        "all_terms": all_terms,
    }


async def _search(monkeypatch, question, rows=None, **kw):
    pool = _RecordingPool(rows=rows or [])
    monkeypatch.setattr(rag, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(rag, "generate_embedding", AsyncMock(return_value=None))
    hits = await rag.search_hybrid(CLIENT, question, **kw)
    return hits, pool


@pytest.mark.asyncio
async def test_the_whole_question_is_no_longer_matched_as_one_literal(monkeypatch):
    """THE test for lock 4.

    `content ILIKE '%What is our refund policy?%'` matches a document only if
    that exact sentence is inside it. Probed against the measured corpus on
    staging: 0 rows for the question, 1 row for the bare word "refund". The
    question a person actually types could never match.
    """
    _, pool = await _search(monkeypatch, "What is our refund policy?")

    assert "ILIKE" not in pool.sql.upper(), (
        "the text branch is matching the question as a substring again — "
        "see the module docstring for what that costs"
    )
    assert "websearch_to_tsquery" in pool.sql
    assert "ts_rank(" in pool.sql
    assert "@@" in pool.sql


@pytest.mark.asyncio
async def test_the_question_is_bound_whole_and_not_wrapped_in_wildcards(monkeypatch):
    """The bound parameter is the question itself.

    It used to be `query[:100]` because a longer ILIKE literal could only match
    less. Full-text search is the opposite shape: a cut mid-question drops every
    term after the cut, and the terms at the end of a question are usually the
    specific ones.
    """
    question = (
        "What is our refund policy for enterprise customers who cancelled "
        "their subscription before the renewal date, and does the same rule "
        "apply to orders that were already dispatched from the warehouse?"
    )
    assert len(question) > 100, "the regression this guards needs a long question"

    _, pool = await _search(monkeypatch, question)

    assert question in pool.args, (
        f"the question reached SQL altered: {pool.args!r}"
    )
    assert "%" not in " ".join(a for a in pool.args if isinstance(a, str))


@pytest.mark.asyncio
async def test_a_question_with_no_searchable_term_is_not_an_error(monkeypatch):
    """"?!" compiles to the empty tsquery, which `@@` answers false for every
    row. Zero results is the honest reply to a question carrying no term, and
    the caller must not see an exception for it."""
    hits, _ = await _search(monkeypatch, "?!")
    assert hits == []


@pytest.mark.asyncio
async def test_an_any_term_query_is_built_but_a_negation_keeps_its_ANDs(monkeypatch):
    """The two-stage search, and the guard that stops it inverting a question.

    `websearch_to_tsquery` ANDs its terms, so "How do I get a refund for an
    enterprise contract?" demands every one of them and a chunk answering it in
    other words matches nothing. The OR rewrite is what makes a natural question
    reachable — measured 0.2304 against the right document on staging.

    But websearch's `-word` compiles to `!'word'` (measured: `refund -enterprise`
    → `'refund' & !'enterpris'`), and rewriting that AND into an OR matches every
    document that fails to mention enterprise — the opposite of the request. So
    the rewrite is skipped whenever a negation is present.
    """
    _, pool = await _search(monkeypatch, "refund -enterprise")

    assert "replace(q_all::text, ' & ', ' | ')" in pool.sql, (
        "no any-term query is built, so a natural question can only match a "
        "document containing every word of it"
    )
    assert "LIKE '%!%'" in pool.sql, (
        "the negation guard is gone: 'refund -enterprise' will now match every "
        "document that does not mention enterprise"
    )


@pytest.mark.asyncio
async def test_all_terms_hits_are_ordered_above_any_term_hits(monkeypatch):
    """A chunk carrying every word of the question outranks one carrying some.
    That is the second stage, expressed as an ORDER BY rather than a second
    round trip — the answer path already averages 7.3 seconds."""
    _, pool = await _search(monkeypatch, "What is our refund policy?")
    assert "ORDER BY all_terms DESC, text_score DESC" in pool.sql


@pytest.mark.asyncio
async def test_the_title_outweighs_the_body(monkeypatch):
    """"Refund Policy" as a title says more about what a chunk is for than the
    word "refund" once inside a paragraph about something else. Measured: a
    title-only single-term hit scores 0.3781, a body-only one 0.1956."""
    _, pool = await _search(monkeypatch, "refund")
    assert "setweight(" in pool.sql
    assert "'A')" in pool.sql and "'B')" in pool.sql


# ══════════════════════════════════════════════════════════════════════════════
# 2 · The score — a real rank, not a constant
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_lexical_hit_carries_its_real_rank(monkeypatch):
    """THE test for lock 1.

    Every hit used to come back `0.0`, so no hit could ever clear any threshold
    at all. The rank Postgres computed is now what the caller receives.
    """
    hits, _ = await _search(monkeypatch, "refund policy", rows=[_chunk_row(0.3974)])

    assert len(hits) == 1
    assert hits[0]["similarity"] == pytest.approx(0.3974)
    assert hits[0]["text_score"] == pytest.approx(0.3974)
    assert hits[0]["similarity"] != 0.0


@pytest.mark.asyncio
async def test_vec_score_stays_zero_and_says_so_honestly(monkeypatch):
    """No chunk has ever carried an embedding. Reporting the lexical rank in
    `vec_score` would make an empty vector column look like a working one, and
    the next person to read a dashboard would believe vectors were live."""
    hits, _ = await _search(monkeypatch, "refund policy", rows=[_chunk_row(0.3974)])
    assert hits[0]["vec_score"] == 0.0


@pytest.mark.asyncio
async def test_ranking_works_with_no_embeddings_at_all(monkeypatch):
    """`generate_embedding` returns None by owner decision — no Google spend —
    and that is not a degraded mode this ranking is allowed to depend on
    escaping. Nothing here may re-enable it to score."""
    assert await rag.generate_embedding("anything") is None

    hits, pool = await _search(monkeypatch, "refund policy", rows=[_chunk_row(0.2304)])
    assert hits[0]["similarity"] == pytest.approx(0.2304)
    assert "::vector" not in pool.sql
    assert "embedding" not in pool.sql


# ══════════════════════════════════════════════════════════════════════════════
# 3 · The threshold — one of them, and low enough to be a filter
# ══════════════════════════════════════════════════════════════════════════════

def test_every_measured_correct_answer_survives_the_threshold():
    """0.3 kept 3 of these 10 measured correct answers. The point of the number
    is to drop noise, not answers."""
    dropped = {
        name: score for name, score in CORRECT_ANSWER_SCORES.items()
        if not rag.kb_hit_is_citable({"similarity": score})
    }
    assert not dropped, f"correct answers below KB_MIN_SCORE: {dropped}"


def test_the_measured_incidental_matches_are_still_dropped():
    """A chunk that shares one ordinary word with the question — "order",
    "days" — is not a source, and citing it would be worse than citing nothing:
    the reader is told the answer came from a document that does not contain
    it."""
    kept = {
        name: score for name, score in INCIDENTAL_MATCH_SCORES.items()
        if rag.kb_hit_is_citable({"similarity": score})
    }
    assert not kept, f"incidental matches above KB_MIN_SCORE: {kept}"


def test_the_threshold_sits_in_the_gap_between_the_two_populations():
    """Not on the edge of one. The measured gap is 0.0886 → 0.1395; a threshold
    at either end is one corpus away from becoming an off switch again."""
    assert max(INCIDENTAL_MATCH_SCORES.values()) < rag.KB_MIN_SCORE
    assert rag.KB_MIN_SCORE < min(CORRECT_ANSWER_SCORES.values())


def test_the_old_threshold_would_have_discarded_most_correct_answers():
    """Pinned so that raising it back is a visible act rather than a tidy-up.
    This is the measurement that says 0.3 was an off switch and not taste."""
    survivors = [s for s in CORRECT_ANSWER_SCORES.values() if s > 0.3]
    assert len(survivors) == 2, (
        "the measured corpus changed; re-measure before touching KB_MIN_SCORE"
    )


def test_both_readers_share_one_definition_and_not_two_copies():
    """`sahayak_answer` and `hub_chat` had the same rule written twice, once as
    `<= 0.3 and <= 0.3` and once as `> 0.3 or > 0.3`. They now import the
    predicate itself, so the two chat routes cannot drift into citing different
    documents for the same question."""
    from routers import hub_chat

    assert sahayak.KB_MIN_SCORE == rag.KB_MIN_SCORE
    assert hub_chat.kb_hit_is_citable is rag.kb_hit_is_citable


def test_a_hit_with_no_score_at_all_is_not_citable():
    """A malformed hit is not evidence. `None` and a missing key both mean the
    same thing and neither may pass."""
    assert not rag.kb_hit_is_citable({})
    assert not rag.kb_hit_is_citable({"similarity": None})
    assert not rag.kb_hit_is_citable({"similarity": 0.0})


# ══════════════════════════════════════════════════════════════════════════════
# 4 · The readers — a citable chunk reaches the answer
# ══════════════════════════════════════════════════════════════════════════════

def _hit(score, title="Employee Handbook"):
    return {
        "chunk_id": "55555555-5555-5555-5555-555555555555",
        "content": "Every full-time employee is entitled to 18 days of paid leave.",
        "doc_title": title,
        "document_id": "66666666-6666-6666-6666-666666666666",
        "source_type": "text",
        "chunk_index": 0,
        "similarity": score,
        "vec_score": 0.0,
        "text_score": score,
    }


def test_sahayak_cites_a_chunk_the_old_threshold_would_have_dropped():
    """0.2064 is the measured score of the right document for "How many days of
    paid leave do I get?". Under 0.3 it was discarded and Sahayak answered the
    question with nothing from the knowledge base."""
    cards, blocks, next_ref = sahayak.kb_sources([_hit(0.2064)], start_ref=3)

    assert len(cards) == 1 and len(blocks) == 1
    assert cards[0]["ref"] == 3
    assert cards[0]["title"] == "Employee Handbook"
    assert cards[0]["similarity"] == pytest.approx(0.206, abs=0.001)
    assert "[3]" in blocks[0]
    assert next_ref == 4


def test_sahayak_still_refuses_an_incidental_match():
    cards, blocks, next_ref = sahayak.kb_sources([_hit(0.0886)], start_ref=3)
    assert cards == [] and blocks == []
    assert next_ref == 3


# ── The chat router, driven end to end ───────────────────────────────────────

class _Conn:
    def transaction(self):
        class _T:
            async def __aenter__(self_):
                return None

            async def __aexit__(self_, *a):
                return False

        return _T()

    async def fetchval(self, sql, *args):
        return MSG if "INSERT INTO public.hub_chat_messages" in sql else None

    async def execute(self, sql, *args):
        return "OK"


class _ChatPool:
    def __init__(self):
        self.rows = {
            "FROM public.hub_chat_sessions": {"client_id": CLIENT},
            "COUNT(*) FROM public.hub_chat_messages": 1,
            "hub_brand_profiles": None,
        }
        self.calls = []

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


async def _send(monkeypatch, message, kb_hits):
    """Drive `POST /chat/sessions/{id}/send` and return (system prompt, response).

    Credits are stubbed: `tests/test_credit_model.py` and
    `tests/test_unmetered_channels_now_charge.py` own the money between them, and
    a retrieval test must not fail for a billing reason.
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
        return {"text": "18 days [1].", "model": "m", "provider": "p",
                "cost_usd": 0.0, "grounding_sources": []}

    monkeypatch.setattr(hub_chat, "generate", _gen)

    out = await hub_chat.send_chat_message(
        session_id=UUID(SESSION),
        body=ChatMessage(message=message),
        user={"user_id": USER},
        org_id=ORG,
        _gate=None,
    )
    assert captured, "send_chat_message never reached the AI router"
    return captured["system"], out


@pytest.mark.asyncio
async def test_chat_puts_a_citable_chunk_in_the_prompt_and_the_sources(monkeypatch):
    """The whole point, end to end. Before this, the chunk was retrieved, scored
    0.0, filtered out by the literal 0.3 in this router, and the model was told
    "No relevant context was found in the knowledge base"."""
    system, out = await _send(
        monkeypatch, "How many days of paid leave do I get?", [_hit(0.2064)],
    )

    assert "Relevant knowledge base context" in system
    assert "18 days of paid leave" in system
    assert "[1]" in system

    titles = [s.get("title") for s in out["sources"]]
    assert "Employee Handbook" in titles


@pytest.mark.asyncio
async def test_chat_keeps_a_citation_marker_it_gave_the_model(monkeypatch):
    """`_strip_invalid_refs` deletes any `[n]` the prompt did not number. While
    every hit was filtered out, it deleted every citation in every answer."""
    _, out = await _send(
        monkeypatch, "How many days of paid leave do I get?", [_hit(0.2064)],
    )
    assert "[1]" in out["message"]


@pytest.mark.asyncio
async def test_chat_still_drops_an_incidental_match(monkeypatch):
    system, out = await _send(
        monkeypatch, "who approves a purchase order over one lakh", [_hit(0.0886)],
    )
    assert "No relevant context was found" in system
    assert out["sources"] == []
