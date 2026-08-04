"""
The four AI channels that had never charged anything.

Until 2026-08-04 the product made five kinds of paid external call that no debit
path ever saw. Four of them live in this agent's files and are pinned here:

  · routers/hub_chat.py       — the RAG chatbot. "chatbot" was never a key in
                                CREDIT_COSTS, and `CREDIT_COSTS.get(x, 2)` was
                                only ever consulted by callers this router does
                                not use, so an answer cost the org nothing. An
                                empty wallet could hold an unlimited conversation.
  · services/ai/reranker.py   — ~$0.01 per call by its own docstring, one per
                                chat message. It was also the ONLY call site in
                                the tree passing `task="chatbot"`, which is what
                                `ai_router._select_providers` reads to pick the
                                Gemini-direct chain, where `_call_gemini`
                                attaches `tools: [{google_search: {}}]`. A
                                relevance-scoring call over text we already held
                                was firing billed Google Search grounding while
                                the user-facing answer beside it ran the free
                                chain.
  · services/rag.py           — one embedding per chunk at ingest and one per
                                query at search. Neither charged.
  · services/social_publisher — WhatsApp Cloud API, which Meta bills for.

These tests pin the WIRING, not the arithmetic: that each channel charges, with
the price key it is supposed to, exactly once, at a moment where the charge can
still be undone — and that each one puts the credit back when the work it paid
for did not happen. The arithmetic belongs to services/credits.py and is pinned
by its own suite.

Two of them exist because getting this wrong is silent in both directions:
`test_ingest_charges_once_per_document_not_once_per_chunk` (a 40-chunk handbook
billed per chunk is ₹160 for ₹0.02 of embeddings) and
`test_rerank_makes_no_provider_call_when_it_cannot_charge` (the only thing worse
than an uncharged paid call is one made deliberately).
"""
import inspect
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from services import credits

ORG = "11111111-1111-1111-1111-111111111111"
CLIENT = "22222222-2222-2222-2222-222222222222"
SESSION = "33333333-3333-3333-3333-333333333333"
MSG = "44444444-4444-4444-4444-444444444444"
DOC = "55555555-5555-5555-5555-555555555555"
QUEUE = "66666666-6666-6666-6666-666666666666"
CONTENT = "77777777-7777-7777-7777-777777777777"
USER = "user_test001"


# ── The fake connection, Style 2 (tests/test_credit_refund.py) ───────────────

class _Conn:
    """Branches on SQL substrings and mutates in-memory state.

    `in_txn` is load-bearing: several of these tests exist only to prove that a
    charge shares the transaction that wrote the row it is charging for, which
    is the difference between a refused spend rolling a document back and
    leaving an orphan behind.
    """

    def __init__(self):
        self.in_txn = False
        self.executed = []
        self.docs = []

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
        self.executed.append(sql)
        if "INSERT INTO staging.hub_kb_documents" in sql:
            self.docs.append(args)
            return DOC
        if "INSERT INTO staging.hub_chat_messages" in sql:
            return MSG
        return None

    async def execute(self, sql, *args):
        self.executed.append(sql)
        return "OK"

    async def fetchrow(self, sql, *args):
        self.executed.append(sql)
        return None


class _Pool:
    """Pool whose acquire() hands out one shared _Conn, so a test can assert on
    what the caller did inside its transaction."""

    def __init__(self, conn=None, rows=None):
        self.conn = conn or _Conn()
        self.rows = rows or {}
        self.executed = []

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
        self.executed.append(sql)
        return self._lookup(sql)

    async def fetchval(self, sql, *args):
        self.executed.append(sql)
        return self._lookup(sql)

    async def fetch(self, sql, *args):
        self.executed.append(sql)
        return self._lookup(sql) or []

    async def execute(self, sql, *args):
        self.executed.append(sql)
        return "OK"


class _Spends:
    """Records every call to credits.spend / spend_standalone / refund_standalone.

    Installed over the real functions so these tests assert on the wiring — the
    price key, the idempotency key, the ordering, the refund — without
    re-testing services/credits.py, which has its own suite.
    """

    def __init__(self, raises=None):
        self.spends = []
        self.refunds = []
        self.raises = raises          # a CreditError to raise instead of charging
        self._next_id = 0

    def install(self, monkeypatch, credits_amount=2):
        async def _spend(conn=None, **kw):
            self.spends.append({
                "conn": conn,
                "in_txn": getattr(conn, "in_txn", None),
                **kw,
            })
            if self.raises:
                raise self.raises
            self._next_id += 1
            return credits.Receipt(
                tx_id=f"tx-{self._next_id}", org_id=kw.get("org_id"),
                user_id=kw.get("user_id"), kind=kw.get("kind", ""),
                ref_id=kw.get("ref_id"), quantity=kw.get("quantity", 1),
                credits=credits_amount, from_allowance=credits_amount,
                from_purchased=0, balance_after=0, metered_only=False,
                replayed=False,
            )

        async def _spend_standalone(**kw):
            return await _spend(None, **kw)

        async def _refund_standalone(**kw):
            self.refunds.append(kw)
            return None

        monkeypatch.setattr(credits, "spend", _spend)
        monkeypatch.setattr(credits, "spend_standalone", _spend_standalone)
        monkeypatch.setattr(credits, "refund_standalone", _refund_standalone)
        return self


@pytest.fixture
def spends(monkeypatch):
    return _Spends().install(monkeypatch)


# ══════════════════════════════════════════════════════════════════════════════
# 1 · Every price key these four files name must exist in the price list
# ══════════════════════════════════════════════════════════════════════════════

_CHANNEL_KEYS = [
    ("chatbot_message", "routers/hub_chat.py"),
    ("chatbot_rerank",  "services/ai/reranker.py"),
    ("kb_ingest",       "services/rag.py"),
    ("whatsapp_send",   "services/social_publisher.py"),
    ("social_send",     "services/social_publisher.py"),
]


@pytest.mark.parametrize("key,owner", _CHANNEL_KEYS, ids=[k for k, _ in _CHANNEL_KEYS])
def test_channel_price_key_is_seeded_and_used(key, owner):
    """One case per channel, not one aggregate assertion.

    `price_of` raises UnknownPrice rather than falling back to 2 — deliberately,
    because `.get(x, 2)` is how "chatbot" came to have a price nobody chose. The
    flip side is that a key renamed on one side of this boundary and not the
    other turns a paid call into a 500. This is the tripwire for that.
    """
    backend = Path(__file__).resolve().parents[1]
    seed = (backend / "migrations" / "095_credit_model.sql").read_text(encoding="utf-8")
    assert f"('{key}'" in seed, f"{key} is charged by {owner} but is not priced in 095"

    used = (backend / owner).read_text(encoding="utf-8")
    assert f'"{key}"' in used, f"{owner} no longer names {key}"


# ══════════════════════════════════════════════════════════════════════════════
# 2 · The chatbot
# ══════════════════════════════════════════════════════════════════════════════

def _chat_pool():
    return _Pool(rows={
        "FROM staging.hub_chat_sessions": {"client_id": CLIENT},
        "COUNT(*) FROM staging.hub_chat_messages": 1,
        "hub_brand_profiles": None,
    })


async def _send(monkeypatch, pool, generate_result=None, generate_raises=None):
    from routers import hub_chat
    from routers.hub_chat import ChatMessage
    from uuid import UUID

    monkeypatch.setattr(hub_chat, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(hub_chat, "search_hybrid", AsyncMock(return_value=[]))
    monkeypatch.setattr(hub_chat, "rerank", AsyncMock(return_value=[]))

    async def _gen(**kw):
        if generate_raises:
            raise generate_raises
        return generate_result or {"text": "hello", "model": "m", "cost_usd": 0.004}

    monkeypatch.setattr(hub_chat, "generate", _gen)

    return await hub_chat.send_chat_message(
        session_id=UUID(SESSION),
        body=ChatMessage(message="what is our refund policy?"),
        user={"user_id": USER},
        org_id=ORG,
        _gate=None,
    )


@pytest.mark.asyncio
async def test_chat_answer_is_charged_once_as_a_channel(monkeypatch, spends):
    """One answer, one debit, priced as the channel and not as content."""
    out = await _send(monkeypatch, _chat_pool())

    assert len(spends.spends) == 1
    s = spends.spends[0]
    assert (s["kind"], s["ref_id"]) == ("channel", "chatbot_message")
    assert s["org_id"] == ORG and s["user_id"] == USER
    # Proves this went down the success path — the endpoint answers 200 with an
    # apology for anything that raises, so a test asserting only on the spend
    # would pass just as happily on a broken run.
    assert out["message"] == "hello"
    assert out["credits_charged"] == 2


@pytest.mark.asyncio
async def test_chat_charge_shares_the_transaction_that_stores_the_question(
    monkeypatch, spends,
):
    """
    The message row and the credit for answering it are one transaction.

    Split them and a refused answer leaves a question stored, unanswered and
    unbilled — the customer sees half a conversation they cannot continue and
    were never told why. `spend()` requires a live connection precisely so this
    is decidable at the call site.
    """
    pool = _chat_pool()
    await _send(monkeypatch, pool)

    s = spends.spends[0]
    assert s["conn"] is pool.conn, "the charge ran on its own connection"
    assert s["in_txn"] is True, "the charge was not inside the caller's transaction"
    assert any("INSERT INTO staging.hub_chat_messages" in q for q in pool.conn.executed)


@pytest.mark.asyncio
async def test_chat_idempotency_key_is_the_message_not_the_attempt(monkeypatch, spends):
    """A key carrying a timestamp or a fresh uuid is decoration. The stored
    message id is the unit of work: one question, one charge, however many times
    the transport retries."""
    await _send(monkeypatch, _chat_pool())
    assert spends.spends[0]["idempotency_key"] == f"chat:{MSG}"


@pytest.mark.asyncio
async def test_an_empty_wallet_reaches_the_caller_as_402_not_as_a_friendly_200(
    monkeypatch,
):
    """
    `send_chat_message` answers 200 with "Sorry, I encountered an error" for
    anything that raises inside its try block. A customer told that about their
    own empty wallet has no way to learn what is wrong or what to do — so the
    charge is taken OUTSIDE that block, and its 402 propagates with the sentence
    naming what is needed and what is held.
    """
    refused = credits.InsufficientOrgCredits(
        "This needs 2 credits. Your organisation has 0.", needed=2,
    )
    _Spends(raises=refused).install(monkeypatch)

    with pytest.raises(credits.CreditError) as exc:
        await _send(monkeypatch, _chat_pool())

    assert exc.value.status_code == 402
    assert exc.value.detail["error"] == "org_credits_exhausted"


@pytest.mark.asyncio
async def test_a_failed_answer_is_refunded(monkeypatch, spends):
    """`generate` raises once every provider in the chain has failed. The
    customer was charged and got nothing; this handler used to answer politely
    and keep the money."""
    result = await _send(monkeypatch, _chat_pool(), generate_raises=RuntimeError("all providers failed"))

    assert len(spends.refunds) == 1
    assert spends.refunds[0]["tx_id"] == "tx-1"
    assert result["credits_charged"] == 0


@pytest.mark.asyncio
async def test_the_real_usd_cost_is_stored_not_a_literal_zero(monkeypatch, spends):
    """`hub_chat_messages.cost_usd` is a DECIMAL(10,6) that existed for this and
    recorded 0 for every answer ever given, because `cost = 0` was hardcoded
    beside an `ai_result["cost_usd"]` in the same scope."""
    out = await _send(monkeypatch, _chat_pool(),
                      generate_result={"text": "hi", "model": "m", "cost_usd": 0.0042})
    assert out["cost_usd"] == 0.0042


# ══════════════════════════════════════════════════════════════════════════════
# 3 · The re-ranker
# ══════════════════════════════════════════════════════════════════════════════

def _chunks(n=8):
    return [{"content": f"chunk {i}", "doc_title": "d", "similarity": 0.5} for i in range(n)]


@pytest.mark.asyncio
async def test_rerank_charges_before_it_calls_a_provider(monkeypatch, spends):
    from services.ai import reranker

    calls = []

    async def _gen(**kw):
        calls.append(kw)
        return {"text": "[]"}

    monkeypatch.setattr(reranker, "generate", _gen)
    await reranker.rerank("q", _chunks(), top_k=5, client_id=CLIENT,
                          org_id=ORG, user_id=USER, message_id=MSG)

    assert len(spends.spends) == 1
    s = spends.spends[0]
    assert (s["kind"], s["ref_id"]) == ("channel", "chatbot_rerank")
    assert s["idempotency_key"] == f"chat:{MSG}:rerank"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_rerank_makes_no_provider_call_when_it_cannot_charge(monkeypatch):
    """
    The answer this ranks for has already been paid for, so a one-credit
    shortfall must not fail the message — it costs relevance, not the reply.

    What it must NEVER do is make the call anyway. An uncharged paid call is the
    defect this whole programme exists to end, and "degrade gracefully" is the
    most comfortable place for one to hide.
    """
    from services.ai import reranker

    _Spends(raises=credits.InsufficientOrgCredits("no", needed=1)).install(monkeypatch)
    called = []
    monkeypatch.setattr(reranker, "generate", AsyncMock(side_effect=lambda **k: called.append(k)))

    out = await reranker.rerank("q", _chunks(8), top_k=5, client_id=CLIENT,
                                org_id=ORG, user_id=USER, message_id=MSG)

    assert called == []
    assert len(out) == 5, "it must still return usable context, in hybrid order"


@pytest.mark.asyncio
async def test_rerank_without_an_org_degrades_rather_than_guessing_one(monkeypatch, spends):
    """There is no default org that would be right. A spend attributed to the
    wrong org is worse than a worse-ordered answer."""
    from services.ai import reranker

    called = []
    monkeypatch.setattr(reranker, "generate", AsyncMock(side_effect=lambda **k: called.append(k)))

    out = await reranker.rerank("q", _chunks(8), top_k=5, client_id=CLIENT, message_id=MSG)

    assert spends.spends == [] and called == []
    assert len(out) == 5


@pytest.mark.asyncio
async def test_rerank_refunds_when_every_provider_fails(monkeypatch, spends):
    from services.ai import reranker

    async def _boom(**kw):
        raise RuntimeError("all providers failed")

    monkeypatch.setattr(reranker, "generate", _boom)
    out = await reranker.rerank("q", _chunks(8), top_k=5, client_id=CLIENT,
                                org_id=ORG, user_id=USER, message_id=MSG)

    assert len(spends.refunds) == 1 and spends.refunds[0]["tx_id"] == "tx-1"
    assert len(out) == 5


def test_rerank_no_longer_buys_google_search_to_score_text_we_already_have():
    """
    A COST test, not a billing one, and worth more than the credit beside it.

    `task="chatbot"` is what `_select_providers` reads to return the
    Gemini-direct chain, and `_call_gemini` attaches `tools: [{google_search:
    {}}]` whenever it is set. This module was the only caller in the tree that
    passed it, so the *relevance judge* was grounding against live web search
    while the answer it was ranking for ran the free chain.
    """
    from services.ai import reranker

    src = inspect.getsource(reranker.rerank)
    assert 'task="chatbot"' not in src and "task='chatbot'" not in src
    assert "org_id=org_id" in src, "reranker spend must be attributable to an org"


# ══════════════════════════════════════════════════════════════════════════════
# 4 · Knowledge-base ingest — the unit is the document
# ══════════════════════════════════════════════════════════════════════════════

def _rag_pool():
    return _Pool(rows={"SELECT org_id FROM staging.hub_clients": ORG})


@pytest.mark.asyncio
async def test_ingest_charges_once_per_document_not_once_per_chunk(monkeypatch, spends):
    """
    THE decision in this file.

    A 50-page handbook chunks into ~40 pieces at CHUNK_SIZE=500 words. Billed
    per chunk that is 40 credits — ₹160 at CREDIT_PRICE_INR — for roughly ₹0.02
    of embedding calls, and 40 ledger rows for one upload, which is a statement
    no customer can read. One document, one credit, one row.
    """
    from services import rag

    pool = _rag_pool()
    monkeypatch.setattr(rag, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(rag, "generate_embedding", AsyncMock(return_value=None))

    long_doc = " ".join(f"Sentence number {i} about the refund policy." for i in range(4000))
    out = await rag.ingest_document(CLIENT, "Handbook", long_doc, created_by=USER)

    assert out["chunks"] > 10, "this document must actually be multi-chunk"
    assert len(spends.spends) == 1, f"charged {len(spends.spends)} times for one document"
    s = spends.spends[0]
    assert (s["kind"], s["ref_id"]) == ("channel", "kb_ingest")
    assert s["idempotency_key"] == f"kb:{DOC}"
    assert out["credits_charged"] == 2


@pytest.mark.asyncio
async def test_ingest_charge_shares_the_transaction_that_creates_the_document(
    monkeypatch, spends,
):
    """A refused ingest must leave the knowledge base exactly as it was. A
    document row without chunks lists in the customer's KB and answers every
    question with silence."""
    from services import rag

    pool = _rag_pool()
    monkeypatch.setattr(rag, "get_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(rag, "generate_embedding", AsyncMock(return_value=None))

    await rag.ingest_document(CLIENT, "T", "One short sentence.", created_by=USER)

    s = spends.spends[0]
    assert s["conn"] is pool.conn and s["in_txn"] is True
    assert pool.conn.docs, "the document insert did not run on the same connection"


@pytest.mark.asyncio
async def test_ingest_refuses_when_no_org_owns_the_client(monkeypatch, spends):
    """The org is resolved from the database rather than taken from a caller,
    because it decides who pays. If it cannot be resolved, say so — do not
    ingest for free."""
    from services import rag

    monkeypatch.setattr(rag, "get_pool", AsyncMock(return_value=_Pool(rows={})))

    with pytest.raises(ValueError, match="no org to charge"):
        await rag.ingest_document(CLIENT, "T", "x.", created_by=USER)
    assert spends.spends == []


@pytest.mark.asyncio
async def test_a_search_query_embedding_is_not_charged_again(monkeypatch, spends):
    """One embedding per question, and the question is already charged 2 credits
    as chatbot_message. Billing it here would charge twice for one user action —
    and search_hybrid is also called by services/skills/context.py, where the
    skill step carries the price."""
    from services import rag

    monkeypatch.setattr(rag, "get_pool", AsyncMock(return_value=_Pool(rows={})))
    monkeypatch.setattr(rag, "generate_embedding", AsyncMock(return_value=None))

    await rag.search_hybrid(CLIENT, "what is the refund policy?")
    assert spends.spends == []


# ══════════════════════════════════════════════════════════════════════════════
# 5 · Publishing — and what Meta actually bills
# ══════════════════════════════════════════════════════════════════════════════

def _queue_row(platform):
    return {
        "id": QUEUE, "content_id": CONTENT, "client_id": CLIENT,
        "created_by": USER, "client_org_id": ORG,
        "platform": platform, "access_token": "tok", "refresh_token": None,
        "token_expires_at": None, "page_id": "p1", "account_id": "a1",
        "acct_meta": {}, "body": "hello", "title": "t",
        "media_urls": [], "hashtags": [],
    }


async def _publish(monkeypatch, platform, publisher_result=None, publisher_raises=None):
    from services import social_publisher as sp

    pool = _Pool(rows={"FROM staging.hub_publish_queue": _queue_row(platform)})
    monkeypatch.setattr(sp, "get_pool", AsyncMock(return_value=pool))

    async def _pub(account, text, media=None):
        if publisher_raises:
            raise publisher_raises
        return publisher_result or {"platform_post_id": "pid", "platform_url": "u"}

    for name in ("publish_to_whatsapp_business", "publish_to_facebook", "publish_to_linkedin"):
        monkeypatch.setattr(sp, name, _pub)

    return pool, await sp.publish_content(QUEUE)


@pytest.mark.asyncio
async def test_whatsapp_is_charged_because_meta_bills_for_it(monkeypatch, spends):
    _, out = await _publish(monkeypatch, "whatsapp_business")

    assert len(spends.spends) == 1
    s = spends.spends[0]
    assert (s["kind"], s["ref_id"]) == ("channel", "whatsapp_send")
    assert s["idempotency_key"] == f"publish:{QUEUE}"
    assert s["org_id"] == ORG and s["user_id"] == USER


@pytest.mark.asyncio
async def test_quota_billed_platforms_are_recorded_at_zero_not_skipped(monkeypatch, spends):
    """Facebook, LinkedIn and the rest bill by API quota, not per message, so
    they cost nothing per call. The ledger row is still written: an org has to
    be able to see what it published and when, and a report that shows nothing
    cannot."""
    _, out = await _publish(monkeypatch, "facebook")

    assert len(spends.spends) == 1
    assert spends.spends[0]["ref_id"] == "social_send"


@pytest.mark.asyncio
async def test_a_suppressed_publish_is_not_charged(monkeypatch, spends):
    """OUTBOUND_MODE=dry makes no external call, so nothing was billed to us and
    nothing is billed on. This is also what keeps the whole suite — which runs
    with OUTBOUND_MODE=dry — from writing ledger rows."""
    _, out = await _publish(
        monkeypatch, "whatsapp_business",
        publisher_result={"platform_post_id": None, "platform_url": None, "suppressed": True},
    )
    assert spends.spends == []
    assert out["credits_charged"] == 0


@pytest.mark.asyncio
async def test_a_failed_publish_is_not_charged(monkeypatch, spends):
    """Meta bills for a delivered conversation. An API call that raised
    delivered nothing, and charging for our own failure is not metering."""
    _, out = await _publish(monkeypatch, "whatsapp_business",
                            publisher_raises=RuntimeError("(#131030) Recipient not in allowed list"))

    assert spends.spends == []
    assert out["status"] == "failed"


@pytest.mark.asyncio
async def test_a_billing_refusal_never_marks_a_live_post_as_failed(monkeypatch):
    """
    By the time the charge runs the post is public and not reliably retractable.

    A queue row marked 'failed' over a billing problem gets retried, and the
    retry posts the same thing to the customer's audience a second time. An
    uncollected credit is recoverable; a duplicate public post is not.
    """
    _Spends(raises=credits.InsufficientOrgCredits("short by one", needed=1)).install(monkeypatch)

    pool, out = await _publish(monkeypatch, "whatsapp_business")

    assert out["status"] == "published"
    assert out["credit_error"] == "org_credits_exhausted"
    assert not any("status='failed'" in q for q in pool.executed)


def test_the_publish_query_reaches_an_org_to_bill():
    """`hub_content_items` has no org_id — the queue row's client_id is the only
    route to one, and hub_clients.org_id is NOT NULL. Without this join the
    whole path is unbillable."""
    from services import social_publisher as sp

    src = inspect.getsource(sp.publish_content)
    assert "JOIN staging.hub_clients cl ON cl.id = q.client_id" in src
    assert "cl.org_id AS client_org_id" in src
