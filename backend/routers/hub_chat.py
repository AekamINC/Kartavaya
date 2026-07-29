"""
hub_chat.py — Srijan P3: Chatbot + RAG Router
Knowledge base management, chat sessions with retrieval-augmented generation.
"""
import json
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.ai_router import generate
from services.rag import ingest_document, search_knowledge, search_hybrid, delete_document
from services.ai.reranker import rerank

router = APIRouter(prefix="/api/v1/hub", tags=["hub-chat"])

_hub_gate = require_module("srijan")


# ── Pydantic Models ──────────────────────────────────────────

class KBDocCreate(BaseModel):
    title: str
    content: str
    source_type: str = "text"
    source_url: str = ""

class FAQCreate(BaseModel):
    question: str
    answer: str

class ChatMessage(BaseModel):
    message: str
    session_id: Optional[str] = None

class ChatSessionCreate(BaseModel):
    title: str = "New Chat"
    session_type: str = "internal"


# ── Knowledge Base ──────────────────────────────────────────

@router.get("/clients/{client_id}/kb")
async def list_kb_documents(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cid = str(client_id)

    await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    ) or (_ for _ in ()).throw(HTTPException(404, "Client not found"))

    docs = await pool.fetch(
        "SELECT d.id, d.title, d.source_type, d.source_url, d.is_active, d.created_at, "
        "(SELECT COUNT(*) FROM staging.hub_kb_chunks WHERE document_id=d.id) as chunk_count "
        "FROM staging.hub_kb_documents d "
        "WHERE d.client_id=$1::uuid AND d.is_active=TRUE "
        "ORDER BY d.created_at DESC",
        cid,
    )
    return {"data": [dict(r) for r in docs]}


@router.post("/clients/{client_id}/kb")
async def add_kb_document(
    client_id: UUID,
    body: KBDocCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    cid = str(client_id)
    pool = await get_pool()

    cl = await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")

    if not body.content.strip():
        raise HTTPException(400, "Content cannot be empty")

    result = await ingest_document(
        client_id=cid,
        title=body.title,
        content=body.content,
        source_type=body.source_type,
        source_url=body.source_url or None,
        created_by=user["user_id"],
    )
    return result


@router.post("/clients/{client_id}/kb/faq")
async def add_faq(
    client_id: UUID,
    body: FAQCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Add a Q&A pair to the knowledge base."""
    cid = str(client_id)
    pool = await get_pool()
    cl = await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        cid, org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")

    content = f"Question: {body.question}\nAnswer: {body.answer}"
    result = await ingest_document(
        client_id=cid,
        title=f"FAQ: {body.question[:80]}",
        content=content,
        source_type="faq",
        created_by=user["user_id"],
    )
    return result


@router.delete("/clients/{client_id}/kb/{doc_id}")
async def remove_kb_document(
    client_id: UUID,
    doc_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cl = await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        str(client_id), org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")
    await delete_document(str(doc_id))
    return {"status": "deleted"}


@router.get("/clients/{client_id}/kb/search")
async def search_kb(
    client_id: UUID,
    q: str,
    top_k: int = 5,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    cl = await pool.fetchrow(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        str(client_id), org_id,
    )
    if not cl:
        raise HTTPException(404, "Client not found")
    results = await search_knowledge(str(client_id), q, top_k)
    return {"results": results}


# ── Chat Sessions ───────────────────────────────────────────

@router.get("/clients/{client_id}/chat/sessions")
async def list_chat_sessions(
    client_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    sessions = await pool.fetch(
        "SELECT s.id, s.title, s.session_type, s.created_at, "
        "(SELECT COUNT(*) FROM staging.hub_chat_messages WHERE session_id=s.id) as message_count "
        "FROM staging.hub_chat_sessions s "
        "WHERE s.client_id=$1::uuid AND s.org_id=$2::uuid AND s.is_active=TRUE "
        "ORDER BY s.updated_at DESC",
        str(client_id), org_id,
    )
    return {"data": [dict(s) for s in sessions]}


@router.post("/clients/{client_id}/chat/sessions")
async def create_chat_session(
    client_id: UUID,
    body: ChatSessionCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    # The client id was taken on trust and stamped with the caller's org. Every
    # read is org-scoped, so this looked contained — but `send_chat_message`
    # reads `client_id` back off the session and hands it to `search_hybrid`,
    # which retrieves knowledge-base chunks for that client. Pointing a session
    # at another org's client made the assistant read and summarise their
    # knowledge base. The org filter has to be here, at the point the link is
    # created, because after that the id looks legitimate.
    owns = await pool.fetchval(
        "SELECT 1 FROM staging.hub_clients WHERE id=$1::uuid AND org_id=$2::uuid",
        str(client_id), org_id,
    )
    if not owns:
        raise HTTPException(404, "Client not found")
    row = await pool.fetchrow(
        "INSERT INTO staging.hub_chat_sessions "
        "(client_id, org_id, title, session_type, created_by) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id, title",
        str(client_id), org_id, body.title, body.session_type, user["user_id"],
    )
    return dict(row)


@router.get("/chat/sessions/{session_id}/messages")
async def get_chat_messages(
    session_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    session = await pool.fetchrow(
        "SELECT client_id FROM staging.hub_chat_sessions "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(session_id), org_id,
    )
    if not session:
        raise HTTPException(404, "Session not found")

    msgs = await pool.fetch(
        "SELECT id, role, content, sources, model_used, created_at "
        "FROM staging.hub_chat_messages "
        "WHERE session_id=$1::uuid ORDER BY created_at",
        str(session_id),
    )
    return {"data": [dict(m) for m in msgs]}


@router.post("/chat/sessions/{session_id}/send")
async def send_chat_message(
    session_id: UUID,
    body: ChatMessage,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    """Send a message and get an AI response with RAG context."""
    pool = await get_pool()
    sid = str(session_id)

    session = await pool.fetchrow(
        "SELECT client_id FROM staging.hub_chat_sessions "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        sid, org_id,
    )
    if not session:
        raise HTTPException(404, "Session not found")

    client_id = str(session["client_id"])

    # Store user message
    await pool.execute(
        "INSERT INTO staging.hub_chat_messages (session_id, role, content) "
        "VALUES ($1::uuid, 'user', $2)",
        sid, body.message,
    )

    # RAG: hybrid search + re-rank for relevant context
    kb_results = await search_hybrid(client_id, body.message, top_k=20)
    kb_results = await rerank(body.message, kb_results, top_k=5, client_id=client_id)
    sources = []
    context_parts = []
    valid_chunk_ids = set()
    for idx, r in enumerate(kb_results):
        if r.get("similarity", 0) > 0.3 or r.get("vec_score", 0) > 0.3:
            ref_num = idx + 1
            valid_chunk_ids.add(str(ref_num))
            context_parts.append(f"[{ref_num}] (Source: {r.get('doc_title', 'Unknown')})\n{r['content']}")
            sources.append({
                "ref": ref_num,
                "chunk_id": r.get("chunk_id", ""),
                "title": r.get("doc_title", ""),
                "source_type": r.get("source_type", ""),
                "similarity": round(r.get("similarity", 0), 3),
            })

    # Load brand profile for system prompt
    brand = await pool.fetchrow(
        "SELECT brand_voice, tone, target_audience, tagline "
        "FROM staging.hub_brand_profiles WHERE client_id=$1::uuid",
        client_id,
    )

    # Build system prompt
    sys_parts = ["You are a helpful AI assistant for this business."]
    if brand:
        if brand["brand_voice"]:
            sys_parts.append(f"Brand voice: {brand['brand_voice']}")
        if brand["tone"]:
            sys_parts.append(f"Tone: {brand['tone']}")

    if context_parts:
        sys_parts.append("\nRelevant knowledge base context:")
        sys_parts.extend(context_parts)
        sys_parts.append(
            "\nIMPORTANT INSTRUCTIONS:"
            "\n- Use the provided context to answer the user's question accurately."
            "\n- Cite your sources using bracket notation like [1], [2], etc. matching the reference numbers above."
            "\n- You may combine multiple citations like [1][3] when information comes from multiple sources."
            "\n- If the context does not contain enough information to answer the question, "
            "clearly state: 'I don't have enough information in the knowledge base to answer this question.'"
            "\n- Do NOT make up information that is not supported by the provided context."
        )
    else:
        sys_parts.append(
            "\nNo relevant context was found in the knowledge base. "
            "If the user is asking about business-specific information, "
            "respond with: 'I don't have enough information in the knowledge base to answer this question. "
            "Please add relevant documents to the knowledge base.'"
        )

    # Get recent conversation history (last 10 messages)
    history = await pool.fetch(
        "SELECT role, content FROM staging.hub_chat_messages "
        "WHERE session_id=$1::uuid ORDER BY created_at DESC LIMIT 10",
        sid,
    )
    history_text = ""
    if len(history) > 1:
        for msg in reversed(list(history)[1:]):
            history_text += f"\n{msg['role'].upper()}: {msg['content']}"

    prompt = body.message
    if history_text:
        prompt = f"Conversation so far:{history_text}\n\nUSER: {body.message}"

    # Generate response
    try:
        ai_result = await generate(
            prompt=prompt,
            system="\n".join(sys_parts),
            language="en",
            agent_type="chatbot",
            client_id=client_id,
            org_id=org_id,
        )

        assistant_text = ai_result.get("text", "I couldn't generate a response.")
        model_used = ai_result.get("model", "")
        cost = 0

        import re as _re
        def _strip_invalid_refs(text, valid_ids):
            def _replacer(m):
                return "" if m.group(1) not in valid_ids else m.group(0)
            return _re.sub(r'\[(\d+)\]', _replacer, text)
        assistant_text = _strip_invalid_refs(assistant_text, valid_chunk_ids)

        grounding_sources = ai_result.get("grounding_sources", [])
        if grounding_sources:
            for gs in grounding_sources:
                sources.append({"title": gs.get("title", "Web"), "url": gs.get("url", ""), "type": "web"})

        # Store assistant message
        await pool.execute(
            "INSERT INTO staging.hub_chat_messages "
            "(session_id, role, content, sources, model_used, cost_usd) "
            "VALUES ($1::uuid, 'assistant', $2, $3::jsonb, $4, $5)",
            sid, assistant_text, json.dumps(sources), model_used, cost,
        )

        # Update session timestamp + auto-title from first message
        title_update = ""
        msg_count = await pool.fetchval(
            "SELECT COUNT(*) FROM staging.hub_chat_messages WHERE session_id=$1::uuid",
            sid,
        )
        if msg_count <= 2:
            auto_title = body.message[:60] + ("…" if len(body.message) > 60 else "")
            await pool.execute(
                "UPDATE staging.hub_chat_sessions SET title=$1, updated_at=NOW() WHERE id=$2::uuid",
                auto_title, sid,
            )
        else:
            await pool.execute(
                "UPDATE staging.hub_chat_sessions SET updated_at=NOW() WHERE id=$1::uuid",
                sid,
            )

        return {
            "message": assistant_text,
            "sources": sources,
            "model": model_used,
            "cost_usd": cost,
        }

    except Exception as exc:
        return {
            "message": f"Sorry, I encountered an error: {str(exc)[:200]}",
            "sources": [],
            "model": "",
            "cost_usd": 0,
        }


@router.delete("/chat/sessions/{session_id}")
async def delete_chat_session(
    session_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _gate=Depends(_hub_gate),
):
    pool = await get_pool()
    await pool.execute(
        "UPDATE staging.hub_chat_sessions SET is_active=FALSE WHERE id=$1::uuid AND org_id=$2::uuid",
        str(session_id), org_id,
    )
    return {"status": "deleted"}
