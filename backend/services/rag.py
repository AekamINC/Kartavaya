"""
rag.py — Retrieval Augmented Generation for Srijan chatbot.
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
    """Generate embedding vector using Gemini embedding API."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            log.warning("No API key for embeddings")
            return None
        return await _embed_openrouter(text, api_key)

    return await _embed_gemini(text, api_key)


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


async def _embed_openrouter(text: str, api_key: str) -> list[float] | None:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": "google/text-embedding-004", "input": text[:8000]},
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
    except Exception as exc:
        log.error("OpenRouter embedding failed: %s", exc)
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
        "SELECT org_id FROM staging.hub_clients WHERE id=$1::uuid", client_id
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
                "INSERT INTO staging.hub_kb_documents "
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
                "INSERT INTO staging.hub_kb_chunks "
                "(document_id, client_id, chunk_index, content, token_count, embedding) "
                "VALUES ($1, $2::uuid, $3, $4, $5, $6::vector)",
                doc_id, client_id, i, chunk, token_count, embedding_str,
            )
        else:
            await pool.execute(
                "INSERT INTO staging.hub_kb_chunks "
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
    """Vector similarity search across a client's knowledge base."""
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

        sql = (
            f"SELECT c.id as chunk_id, c.content, c.chunk_index, "
            f"d.title as doc_title, d.id as document_id, d.source_type, "
            f"1 - (c.embedding <=> ${emb_idx}::vector) as vec_score, "
            f"COALESCE(ts_rank_cd(to_tsvector('english', c.content), plainto_tsquery('english', ${query_idx})), 0) as text_score "
            f"FROM staging.hub_kb_chunks c "
            f"JOIN staging.hub_kb_documents d ON d.id = c.document_id "
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
        # Fallback: text-only search
        query_idx = idx
        params.append(query[:100])
        idx += 1
        topk_idx = idx
        params.append(top_k)

        rows = await pool.fetch(
            f"SELECT c.id as chunk_id, c.content, c.chunk_index, "
            f"d.title as doc_title, d.id as document_id, d.source_type, "
            f"0.0 as similarity "
            f"FROM staging.hub_kb_chunks c "
            f"JOIN staging.hub_kb_documents d ON d.id = c.document_id "
            f"WHERE {where} AND c.content ILIKE '%' || ${query_idx} || '%' "
            f"LIMIT ${topk_idx}",
            *params,
        )

        return [
            {
                "chunk_id": str(r["chunk_id"]),
                "content": r["content"],
                "doc_title": r["doc_title"],
                "document_id": str(r["document_id"]),
                "source_type": r["source_type"],
                "chunk_index": r["chunk_index"],
                "similarity": 0.0,
                "vec_score": 0.0,
                "text_score": 0.0,
            }
            for r in rows
        ]


async def delete_document(document_id: str) -> bool:
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.hub_kb_documents SET is_active=FALSE WHERE id=$1::uuid",
        document_id,
    )
    return True
