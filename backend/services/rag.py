"""
rag.py — Retrieval Augmented Generation for Srijan chatbot.
Handles document chunking, embedding generation, and vector search.
Uses Gemini embedding model via OpenRouter or direct API.
"""
import json
import logging
import os
import re
from typing import Optional

import httpx

from db import get_pool

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
    url = f"https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key={api_key}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json={
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
    """Chunk a document, generate embeddings, store in DB."""
    pool = await get_pool()

    doc = await pool.fetchrow(
        "INSERT INTO staging.hub_kb_documents "
        "(client_id, title, source_type, source_url, raw_content, created_by) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING id",
        client_id, title, source_type, source_url, content, created_by,
    )
    doc_id = doc["id"]

    chunks = chunk_text(content)
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

    return {"document_id": str(doc_id), "chunks": stored, "title": title}


async def search_knowledge(client_id: str, query: str, top_k: int = 5) -> list[dict]:
    """Vector similarity search across a client's knowledge base."""
    embedding = await generate_embedding(query)
    pool = await get_pool()

    if embedding and len(embedding) == EMBEDDING_DIM:
        embedding_str = f"[{','.join(str(v) for v in embedding)}]"
        rows = await pool.fetch(
            "SELECT c.content, c.chunk_index, d.title as doc_title, "
            "1 - (c.embedding <=> $1::vector) as similarity "
            "FROM staging.hub_kb_chunks c "
            "JOIN staging.hub_kb_documents d ON d.id = c.document_id "
            "WHERE c.client_id=$2::uuid AND c.embedding IS NOT NULL AND d.is_active=TRUE "
            "ORDER BY c.embedding <=> $1::vector LIMIT $3",
            embedding_str, client_id, top_k,
        )
    else:
        rows = await pool.fetch(
            "SELECT c.content, c.chunk_index, d.title as doc_title, 0.0 as similarity "
            "FROM staging.hub_kb_chunks c "
            "JOIN staging.hub_kb_documents d ON d.id = c.document_id "
            "WHERE c.client_id=$1::uuid AND d.is_active=TRUE "
            "AND c.content ILIKE '%' || $2 || '%' "
            "LIMIT $3",
            client_id, query[:100], top_k,
        )

    return [
        {"content": r["content"], "doc_title": r["doc_title"],
         "chunk_index": r["chunk_index"], "similarity": float(r["similarity"])}
        for r in rows
    ]


async def delete_document(document_id: str) -> bool:
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.hub_kb_documents SET is_active=FALSE WHERE id=$1::uuid",
        document_id,
    )
    return True
