"""
rag.py — Retrieval Augmented Generation for Sahayak chatbot.
Handles document chunking, embedding generation, and vector search.
Uses Gemini embedding model via OpenRouter or direct API.

METERING — THE UNIT IS THE DOCUMENT, NOT THE CHUNK (settled 2026-08-04)
──────────────────────────────────────────────────────────────────────
Every embedding here is a paid call to Google, and none of them were charged.
There are two of them and they are metered differently on purpose.

`ingest_document` charges ONCE, as `channel/kb_ingest`, per document.
NOT per chunk. A 50-page handbook chunks into roughly 40 pieces at
CHUNK_SIZE=500 words, so per-chunk metering would write 40 ledger rows and bill
40 credits — ₹160 at CREDIT_PRICE_INR — for about ₹0.02 of embedding calls. That
is not metering, it is a wrong charge, and a ledger with 40 rows for one upload
is a ledger nobody can read: the customer's monthly statement would be
indistinguishable from a runaway loop.

The honest limitation of a flat per-document price, stated so it is a known debt
rather than a discovered one: it under-charges a very large document and
over-charges a one-line FAQ. Both are bounded by 1 credit and the under-charge
is in the customer's favour. If ingest volume ever justifies it, the price row
carries a `unit_size` column for exactly this — bill per N chunks by passing
`quantity=len(chunks)` — and that is a price change, not a code change.

`search_hybrid` charges NOTHING for the query embedding, deliberately. It is one
embedding call per question, and the question is already charged 2 credits as
`channel/chatbot_message` by routers/hub_chat.py. Billing it again would charge
twice for one user action. It is also called by services/skills/context.py to
build a skill's context, where the skill step it belongs to is what carries the
price — see services/skill_dispatcher.py.
"""
import json
import logging
import os
import re
from typing import Optional

import httpx

from db import get_pool
from services import credits

log = logging.getLogger(__name__)

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
EMBEDDING_MODEL = "google/text-embedding-004"
EMBEDDING_DIM = 768

#: Longest question handed to `websearch_to_tsquery`. The old text branch cut at
#: 100 characters because it matched the whole question as one ILIKE literal, and
#: a longer literal could only ever match less. Full-text search is the opposite
#: shape: a cut mid-question silently drops every term after it. A thousand
#: characters covers every real question and still bounds the parsed query.
MAX_QUERY_CHARS = 1000

#: The lowest score a knowledge-base chunk may carry and still be cited.
#:
#: ── IT WAS AN OFF SWITCH, NOT A FILTER (measured 2026-08-19) ──────────────────
#:
#: It used to be 0.3, written out twice — `sahayak_answer.KB_MIN_SCORE` and a
#: bare literal inside `hub_chat.send_chat_message` — while the text-only branch
#: below returned a hard-coded `0.0 as similarity` and `vec_score` 0.0. So every
#: lexical hit scored zero and both readers dropped 100% of them. That is one of
#: the four independent reasons the knowledge base has never returned a single
#: result to anybody: 90 citations in the product's lifetime, 77 web, 13 data,
#: zero kb.
#:
#: The replacement is measured rather than picked. Fifteen questions against a
#: four-document corpus on staging, scored by the query below — `ts_rank` over
#: `setweight(title,'A') || setweight(content,'B')`, normalisation 32:
#:
#:     lowest CORRECT answer               0.1395   "tell me about the tracking
#:                                                   link" → Shipping and dispatch
#:     weakest single-term body hit        0.1956   "HSN" → GST filing
#:     partial, every term real            0.2304   "How do I get a refund for an
#:                                                   enterprise contract?"
#:     title-only single-term hit          0.3781   "handbook" → Employee Handbook
#:     ── the gap ──────────────────────────────────────────────────────────────
#:     highest INCIDENTAL match            0.0886   "who approves a purchase order
#:                                                   over one lakh" → Refund
#:                                                   Policy, sharing only "order"
#:     one shared word, nothing else       0.0389
#:     answerable by nothing in the corpus    —     fails `@@`, never scored
#:
#: 0.3 kept 3 of those 10 correct answers. 0.10 keeps all 10 and admits none of
#: the incidental matches, and it sits in a gap of 0.05 rather than on the edge
#: of one. `@@` remains the real relevance gate — a chunk sharing no lexeme with
#: the question is never scored at all — and this number only trims the tail of
#: chunks that happen to share one ordinary word.
#:
#: Defined ONCE and imported by both readers. Two copies of a number is how the
#: two chat routes came to be able to disagree about which documents ground the
#: same question.
KB_MIN_SCORE = 0.10


def kb_hit_is_citable(hit: dict) -> bool:
    """Whether a `search_hybrid` result may be put in front of the model and
    shown as a source.

    Exported so `sahayak_answer.kb_sources` and `hub_chat.send_chat_message`
    share the predicate and not merely the number. They had the same rule
    written twice — once as `<= 0.3 and <= 0.3`, once as `> 0.3 or > 0.3` — and
    De Morgan is not a guarantee that the next edit keeps them equal.

    IT READS `similarity` AND NOTHING ELSE. Both readers used to fall back to
    `vec_score` as well, and that disjunct was never a second opinion — it was a
    workaround for the text branch reporting a constant `0.0 as similarity`,
    written by people who could see the field was useless. `similarity` now
    carries the real number on every branch: the lexical rank on the text branch,
    and the vector/lexical blend on the other. One field, one threshold.

    THE FLOOR BELONGS TO ts_rank, NOT TO COSINE. Whoever restores embeddings
    measures their own — inheriting one number across two score spaces without
    checking it is precisely how 0.3 became an off switch.
    """
    return float(hit.get("similarity") or 0) >= KB_MIN_SCORE


#: The searchable text of a chunk. The document's title carries more weight than
#: its body, because "Refund Policy" as a title is a stronger claim about what a
#: chunk is for than the word "refund" appearing once inside a paragraph about
#: something else.
#:
#: COMPUTED IN THE QUERY, NOT STORED. A `tsvector` column with a GIN index is the
#: right shape and it is DDL, and this database is shared with production, so it
#: is not taken casually. It costs nothing today: `staging.hub_kb_chunks` holds
#: ZERO rows, so this scans nothing. The index becomes necessary the moment
#: ingestion exists and a real corpus lands — proposal 69 phase 3, owner-gated.
_KB_TSV = (
    "setweight(to_tsvector('english'::regconfig, coalesce(d.title, '')), 'A') || "
    "setweight(to_tsvector('english'::regconfig, c.content), 'B')"
)


def _tsquery_cte(query_idx: int) -> str:
    """Two tsqueries out of one question, and the second is why a natural
    question can match at all.

    `websearch_to_tsquery` ANDs what it parses, so "How do I get a refund for an
    enterprise contract?" compiles to `'refund' & 'enterpris' & 'contract'` and a
    chunk that answers it in the company's own words — "Refunds are processed to
    the original payment method within 7 working days" — satisfies none of it.
    `q_any` ORs the same lexemes so that chunk is reachable, and the ORDER BY
    puts every all-terms hit above every any-term hit. That is a two-stage search
    written as one statement, which matters because the alternative is two round
    trips per question on a path already averaging 7.3 seconds.

    THE NEGATION GUARD IS NOT COSMETIC. websearch's `-word` compiles to `!'word'`
    — measured on staging: `refund -enterprise` → `'refund' & !'enterpris'` — and
    rewriting that to `'refund' | !'enterpris'` matches every document that fails
    to mention enterprise, which is the opposite of what was asked. A question
    carrying a negation keeps its ANDs.

    An unusable question (`"?!"`, or nothing but stop words) compiles to the
    empty tsquery, which `@@` answers false for every row. Zero results is the
    honest reply to a question with no searchable term in it, and it is not an
    error.
    """
    return (
        f"WITH q AS ("
        f"SELECT websearch_to_tsquery('english'::regconfig, ${query_idx}::text) AS q_all"
        f"), qq AS ("
        f"SELECT q_all, "
        f"CASE WHEN q_all::text LIKE '%!%' THEN q_all "
        f"ELSE replace(q_all::text, ' & ', ' | ')::tsquery END AS q_any "
        f"FROM q"
        f") "
    )


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks by sentences."""
    text = re.sub(r'\n{3,}', '\n\n', text.strip())
    sentences = re.split(r'(?<=[.!?।])\s+', text)

    chunks = []
    current = []
    current_len = 0

    for sent in sentences:
        words = len(sent.split())
        if current_len + words > chunk_size and current:
            chunks.append(' '.join(current))
            keep = max(1, len(current) // 3)
            current = current[-keep:]
            current_len = sum(len(s.split()) for s in current)
        current.append(sent)
        current_len += words

    if current:
        chunks.append(' '.join(current))

    return chunks


async def generate_embedding(text: str) -> list[float] | None:
    """Always None. Knowledge-base search is TEXT-ONLY, deliberately.

    ── OWNER DECISION, 2026-08-17: NO GOOGLE SPEND, AT ALL ─────────────────

    This function used to prefer `GEMINI_API_KEY` for every chunk ingested and
    every question asked. It was the last live reader of that key — chat left it
    on 2026-08-16 (`ai_router._select_providers`) and images only reach it behind
    `GEMINI_IMAGE_ENABLED`, which is unset. The key is now removed from the
    environment entirely, so reading it here would buy nothing but a warning.

    NOTHING IS LOST TODAY, and that is measured rather than assumed:
    `staging.hub_kb_chunks` holds ZERO rows, so not one vector has ever been
    stored. The vector half of `search_hybrid` has therefore always scored
    against an empty set; its `WHERE ... AND c.embedding IS NOT NULL` could only
    ever return nothing. Callers already handle this: search falls to the
    text-only branch, and `ingest_document` stores every chunk without an
    embedding by design.

    THE OPENROUTER "FALLBACK" WAS NOT ONE. It posted `google/text-embedding-004`
    to `openrouter.ai/api/v1/embeddings`, which answers:

        400 {"error":{"message":"Model google/text-embedding-004 does not exist"}}

    Probed with the live key on 2026-08-17. It has never returned a vector, so
    the earlier warning that switching to it would give a "different vector
    space" was wrong twice over — there is no second space and no corpus. It is
    deleted rather than left standing, because a fallback that cannot work reads
    as cover and is how this product came to believe several things sent.

    ── PUTTING VECTOR SEARCH BACK ─────────────────────────────────────────

    `_embed_gemini` below is kept intact and unreachable, on the same grounds
    `ai_router._call_gemini` is: it works, and rewriting it later is worse than
    reading it. Turning it back on is a wallet decision, not a code one — set
    the key, call it from here, and BACKFILL, because a corpus half-embedded by
    one model and half by another ranks worse than one embedded by neither.
    Any other provider must also match `EMBEDDING_DIM` (768) or the column
    rejects it.
    """
    return None


async def _embed_gemini(text: str, api_key: str) -> list[float] | None:
    url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent"
    # `x-goog-api-key`, not `?key=` — httpx logs the request URL at INFO, so a
    # key in the query string is written to the deploy log on every call.
    # See services/apify.py for the same fix and the log line that proved it.
    headers = {"x-goog-api-key": api_key}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json={
                "model": "models/text-embedding-004",
                "content": {"parts": [{"text": text[:8000]}]},
            })
            resp.raise_for_status()
            return resp.json()["embedding"]["values"]
    except Exception as exc:
        log.error("Gemini embedding failed: %s", exc)
        return None


async def ingest_document(client_id: str, title: str, content: str, source_type: str = "text",
                          source_url: str = None, created_by: str = None) -> dict:
    """Chunk a document, generate embeddings, store in DB.

    Charged once as `channel/kb_ingest` — see the module docstring for why the
    unit is the document and not the chunk.

    The org is resolved here, from `client_id`, rather than threaded down from
    the router. Both of today's callers (routers/hub_chat.add_kb_document and
    .add_faq) hold `org_id` and could pass it, but an org taken on a caller's
    word is an org a caller can get wrong, and this one decides who pays.
    `hub_kb_documents.client_id` is NOT NULL and `hub_clients.org_id` is NOT
    NULL, so exactly one org can own this document and the database is the only
    thing that knows which. `ai_router.generate` resolves it the same way.
    """
    pool = await get_pool()

    org_id = await pool.fetchval(
        "SELECT org_id FROM public.hub_clients WHERE id=$1::uuid", client_id
    )
    if not org_id:
        # The FK on hub_kb_documents would have caught this a statement later
        # with a message about a constraint. Say the true thing instead.
        raise ValueError(f"Cannot ingest: no client {client_id}, so no org to charge")

    # Chunking is pure CPU with no I/O, so it is safe to do before the
    # transaction and lets the ledger description carry the real chunk count.
    chunks = chunk_text(content)

    # The document row and the credit for it are one transaction. A refused
    # ingest must not leave a hub_kb_documents row behind: it would list in the
    # customer's knowledge base, retrieve nothing (no chunks were ever written),
    # and answer questions with silence. Rolling both back means a 402 leaves
    # the knowledge base exactly as it was.
    async with pool.acquire() as conn:
        async with conn.transaction():
            doc_id = await conn.fetchval(
                "INSERT INTO public.hub_kb_documents "
                "(client_id, title, source_type, source_url, raw_content, created_by) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id",
                client_id, title, source_type, source_url, content, created_by,
            )
            receipt = await credits.spend(
                conn,
                org_id=str(org_id),
                user_id=created_by,
                kind="channel",
                ref_id="kb_ingest",
                idempotency_key=f"kb:{doc_id}",
                description=f"Knowledge base ingest — {title[:60]} ({len(chunks)} chunks)",
            )

    # Embedding happens after the commit, on purpose: it is up to 40 network
    # round trips and holding a transaction open across them would keep a row
    # lock on the wallet for the whole upload. A chunk whose embedding fails is
    # already stored without one by the branch below and is retrievable by the
    # text half of the hybrid search, so a partial failure here degrades the
    # document rather than losing it — which is why it does not undo the charge.
    stored = 0

    for i, chunk in enumerate(chunks):
        embedding = await generate_embedding(chunk)
        token_count = len(chunk.split())

        if embedding and len(embedding) == EMBEDDING_DIM:
            embedding_str = f"[{','.join(str(v) for v in embedding)}]"
            await pool.execute(
                "INSERT INTO public.hub_kb_chunks "
                "(document_id, client_id, chunk_index, content, token_count, embedding) "
                "VALUES ($1, $2::uuid, $3, $4, $5, $6::vector)",
                doc_id, client_id, i, chunk, token_count, embedding_str,
            )
        else:
            await pool.execute(
                "INSERT INTO public.hub_kb_chunks "
                "(document_id, client_id, chunk_index, content, token_count) "
                "VALUES ($1, $2::uuid, $3, $4, $5)",
                doc_id, client_id, i, chunk, token_count,
            )
        stored += 1

    return {
        "document_id": str(doc_id),
        "chunks": stored,
        "title": title,
        "credits_charged": receipt.credits,
    }


async def search_knowledge(client_id: str, query: str, top_k: int = 5) -> list[dict]:
    """Search across a client's knowledge base. Full-text today, not vector —
    `search_hybrid`'s docstring has the reason and it is not a temporary one."""
    return await search_hybrid(client_id, query, top_k=top_k)


async def search_hybrid(
    client_id: str,
    query: str,
    *,
    top_k: int = 5,
    vector_weight: float = 0.7,
    text_weight: float = 0.3,
    team_id: str | None = None,
    content_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict]:
    """Hybrid search: blend pgvector cosine similarity with tsvector full-text search.

    In practice this is full-text search alone. `generate_embedding` returns None
    by owner decision and `staging.hub_kb_chunks` holds no vectors, so the vector
    branch has never had a row to score and every real call takes the text branch.
    Both branches still report one bounded score in one field, so `KB_MIN_SCORE`
    has a single thing to read — though the floor measured for `ts_rank` is not a
    floor for cosine, and `kb_hit_is_citable` says so.

    RETURNING RESULTS IS NOT THE SAME AS ANSWERING. Nothing ingests documents into
    `hub_kb_chunks` today, so this returns an empty list no matter how good the
    query is. The search being fixed is a precondition for the knowledge base, not
    the knowledge base.

    Metadata filters (team_id, content_type, date range) are applied BEFORE scoring.
    Returns source metadata (chunk_id, source_type, source_id) for citations.

    NOT METERED, and that is a decision rather than an oversight — see the
    module docstring. One embedding call per question, and the question is
    already charged by whoever asked it.
    """
    # The one paid call on this path. It stays free: routers/hub_chat charges
    # `channel/chatbot_message` for the answer this feeds, and
    # services/skills/context.py's caller is charged for the skill step.
    embedding = await generate_embedding(query)
    pool = await get_pool()

    # Build WHERE clause with metadata filters
    conditions = ["c.client_id=$1::uuid", "d.is_active=TRUE"]
    params: list = [client_id]
    idx = 2

    if team_id:
        conditions.append(f"d.team_id=${idx}::uuid")
        params.append(team_id)
        idx += 1
    if content_type:
        conditions.append(f"d.source_type=${idx}")
        params.append(content_type)
        idx += 1
    if date_from:
        conditions.append(f"d.created_at >= ${idx}::timestamptz")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"d.created_at <= ${idx}::timestamptz")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    if embedding and len(embedding) == EMBEDDING_DIM:
        embedding_str = f"[{','.join(str(v) for v in embedding)}]"
        emb_idx = idx
        params.append(embedding_str)
        idx += 1
        query_idx = idx
        params.append(query)
        idx += 1
        topk_idx = idx
        params.append(top_k * 4)  # fetch more for blending

        # The lexical half scores exactly as the text-only branch below does —
        # same tsvector, same tsquery, same normalisation — because both feed one
        # `KB_MIN_SCORE`. Two ranking scales behind one threshold is how a number
        # that filters correctly on one branch becomes an off switch on the other.
        sql = (
            f"{_tsquery_cte(query_idx)}"
            f"SELECT c.id as chunk_id, c.content, c.chunk_index, "
            f"d.title as doc_title, d.id as document_id, d.source_type, "
            f"1 - (c.embedding <=> ${emb_idx}::vector) as vec_score, "
            f"ts_rank(v.tsv, qq.q_any, 32) as text_score "
            f"FROM public.hub_kb_chunks c "
            f"JOIN public.hub_kb_documents d ON d.id = c.document_id "
            f"CROSS JOIN qq "
            f"CROSS JOIN LATERAL (SELECT {_KB_TSV} AS tsv) v "
            f"WHERE {where} AND c.embedding IS NOT NULL "
            f"ORDER BY (1 - (c.embedding <=> ${emb_idx}::vector)) DESC "
            f"LIMIT ${topk_idx}"
        )
        rows = await pool.fetch(sql, *params)

        # Blend scores and re-sort
        results = []
        for r in rows:
            vec = float(r["vec_score"])
            txt = float(r["text_score"])
            combined = vector_weight * vec + text_weight * min(txt, 1.0)
            results.append({
                "chunk_id": str(r["chunk_id"]),
                "content": r["content"],
                "doc_title": r["doc_title"],
                "document_id": str(r["document_id"]),
                "source_type": r["source_type"],
                "chunk_index": r["chunk_index"],
                "similarity": round(combined, 4),
                "vec_score": round(vec, 4),
                "text_score": round(txt, 4),
            })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]
    else:
        # ── The only branch that runs, and until now it could not match ───────
        #
        # `generate_embedding` returns None by owner decision, so every search
        # the product has ever done came here. It read:
        #
        #     WHERE ... AND c.content ILIKE '%' || $query || '%'
        #
        # which asks for the WHOLE QUESTION as one literal substring of a chunk.
        # "What is our refund policy?" matches only a document that contains that
        # sentence, question mark and all. A person asking a question in their own
        # words could not match a document written in someone else's, ever — and
        # it then labelled whatever survived `0.0 as similarity`, which the
        # readers' threshold discarded anyway. Two locks on one door.
        #
        # Postgres full-text search is the house tool for this: the `staging`
        # schema already runs 720 GIN/tsvector indexes. Stemming makes "refunds"
        # answer "refund", the stop words in a natural question are dropped rather
        # than demanded, and `ts_rank` gives the hit a real ordering instead of a
        # constant.
        #
        # PG_TRGM IS INSTALLED (1.6) AND IS DELIBERATELY NOT USED HERE. Measured
        # on staging against the same chunks: `similarity('What is our refund
        # policy?', <refund chunk>)` = 0.088, and 0.162 for a question that is
        # unambiguously about that chunk — trigram similarity divides by the union
        # of both trigram sets, so a short question against a 500-word chunk is
        # near zero however well it matches, and a threshold over it would be a
        # second off switch. `word_similarity` has the right shape (0.475 on the
        # same pair) but is only affordable behind a GIN/GiST trigram index, which
        # is DDL this database does not get. Typos are the case it would buy, and
        # they are unmeasurable against a corpus of zero rows. When ingestion
        # exists and real questions miss, that is the moment to price it.
        query_idx = idx
        params.append(query[:MAX_QUERY_CHARS])
        idx += 1
        topk_idx = idx
        params.append(top_k)

        rows = await pool.fetch(
            f"{_tsquery_cte(query_idx)}"
            f"SELECT c.id as chunk_id, c.content, c.chunk_index, "
            f"d.title as doc_title, d.id as document_id, d.source_type, "
            f"ts_rank(v.tsv, qq.q_any, 32) as text_score, "
            f"(v.tsv @@ qq.q_all) as all_terms "
            f"FROM public.hub_kb_chunks c "
            f"JOIN public.hub_kb_documents d ON d.id = c.document_id "
            f"CROSS JOIN qq "
            f"CROSS JOIN LATERAL (SELECT {_KB_TSV} AS tsv) v "
            f"WHERE {where} AND v.tsv @@ qq.q_any "
            f"ORDER BY all_terms DESC, text_score DESC "
            f"LIMIT ${topk_idx}",
            *params,
        )

        # Normalisation 32 is `rank/(rank+1)`, which bounds the rank into [0,1)
        # so it sits on the same scale as the cosine similarity the other branch
        # produces. One threshold reads both, so they have to mean the same thing.
        # `vec_score` stays 0.0 and says so honestly: no chunk has ever carried an
        # embedding, and reporting the lexical rank in that field would make an
        # empty vector column look like a working one.
        return [
            {
                "chunk_id": str(r["chunk_id"]),
                "content": r["content"],
                "doc_title": r["doc_title"],
                "document_id": str(r["document_id"]),
                "source_type": r["source_type"],
                "chunk_index": r["chunk_index"],
                "similarity": round(float(r["text_score"]), 4),
                "vec_score": 0.0,
                "text_score": round(float(r["text_score"]), 4),
            }
            for r in rows
        ]


async def delete_document(document_id: str) -> bool:
    pool = await get_pool()
    await pool.execute(
        "UPDATE public.hub_kb_documents SET is_active=FALSE WHERE id=$1::uuid",
        document_id,
    )
    return True
