"""
hub_chat.py — Sahayak P3: Chatbot + RAG Router
Knowledge base management, chat sessions with retrieval-augmented generation.

METERING (added 2026-08-04). Every answer this router produces is two or three
paid external calls — a query embedding, an optional LLM re-rank, and the answer
itself — and until now it charged nothing for any of them. The reason was a
single missing dictionary key: `deduct_org_credits` priced work through
`CREDIT_COSTS.get(agent_type, 2)` and nothing in this file ever called it, so
"chatbot" was never priced, never charged, and never appeared in a report. An
org with an empty wallet could hold an unlimited conversation.

The answer is now charged once, as `channel/chatbot_message`, in the same
transaction that stores the user's message. Retrieval is deliberately NOT
charged separately — see services/rag.py.

THE RE-RANK IS GONE FROM THIS PATH, 2026-08-19, and it never once ran.
`services/ai/reranker.py` short-circuits on `len(chunks) <= top_k` before it
charges anything, and the old text search — the whole question as one ILIKE
literal — returned nothing for it to rank. The full-text rewrite in
services/rag.py is what would have armed it: a corpus that answers an ordinary
question with more than five chunks makes every chat turn pay a second, blocking
model round trip before the answer starts. That call asks `ai_router.generate`
without a `task`, so `_latency_class` judges it against the 20,000 ms BULK
budget while the person it is delaying is on the 4,000 ms interactive one — a
mismatch that cannot be fixed from the caller, because `rerank` takes no task.

So this route now does what the route the product actually ships on does. `POST
/v1/hub/chat` → `hub._sahayak_answer` has never re-ranked; it takes
`sahayak_answer.KB_TOP_K` straight from the hybrid search, and so does this. The
number is imported rather than written out again, for the same reason
`KB_MIN_SCORE` is: two copies of one retrieval constant is how these two chat
routes came to be able to disagree about the same knowledge base.
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
from services import credits
from services.ai_router import LANGUAGE_NAMES, detect_language, generate
# The house words, read by BOTH answer routes. See the injection below for why
# this file calls the same function `hub._sahayak_answer` does rather than
# leaving vocabulary to whichever surface the reader happened to open.
from services import glossary
from services.rag import (
    delete_document, ingest_document, kb_hit_is_citable, search_hybrid,
    search_knowledge,
)
from services.sahayak_answer import KB_TOP_K

# IMAGE GENERATION FROM CHAT IS OFF, and this import list is where that is true.
#
# The rule is the owner's and it holds server-side by construction rather than
# by a runtime refusal. This router reaches exactly one AI entry point, and that
# entry point cannot produce an image on any branch: its Gemini path reads text
# parts only and never asks for image response modalities, and every other
# provider in the chain is a text completion API. The two functions in
# `services/ai_router` that DO make pictures are one import line away, and
# `ChatMessage` is one field away from being able to ask for one.
#
# So there is deliberately no `raise` here: there is no reachable call to
# refuse, and a guard on a path nothing takes is decoration that reads like a
# control — the next person greps for it, finds it, and believes the hole is
# closed by something that never executes. What actually enforces the rule is
# `tests/test_ai_routing.py::test_chat_cannot_reach_an_image_generator`, which
# parses this file and fails the build on the import, the attribute call or the
# request field that would open it. It is an AST check, not a text scan, so
# naming those functions in prose here does not satisfy it — and so that this
# comment cannot be the thing that makes the check pass.

router = APIRouter(prefix="/api/v1/hub", tags=["hub-chat"])

_hub_gate = require_module("sahayak")


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

    # The user's message and the charge for answering it go in together.
    #
    # Charging before the model runs is the same order every other spend in the
    # product uses — it is what stops two concurrent questions from spending one
    # balance twice — and putting the INSERT inside the same transaction means a
    # refused message leaves nothing behind. Otherwise a customer at zero would
    # accumulate a session full of questions that were stored, never answered
    # and never billed.
    #
    # A CreditError is an HTTPException, so a 402 leaves this endpoint carrying
    # the sentence that names what the answer costs and what the org still has.
    # It is raised HERE, outside the `try` below, precisely so it cannot be
    # swallowed into the friendly 200 that ends "I encountered an error" — a
    # customer told that has no way to learn their wallet is empty.
    async with pool.acquire() as conn:
        async with conn.transaction():
            msg_id = await conn.fetchval(
                "INSERT INTO staging.hub_chat_messages (session_id, role, content) "
                "VALUES ($1::uuid, 'user', $2) RETURNING id",
                sid, body.message,
            )
            answer_receipt = await credits.spend(
                conn,
                org_id=org_id,
                user_id=user["user_id"],
                kind="channel",
                ref_id="chatbot_message",
                idempotency_key=f"chat:{msg_id}",
                description="Chatbot answer",
            )

    # RAG: full-text search for relevant context.
    # The query embedding is free — it is covered by the answer credit above,
    # and services/rag.py explains why it must not be metered separately.
    #
    # `KB_TOP_K` chunks, taken straight. It used to be twenty fetched and
    # re-ranked down to five by a second model call; the module header has why
    # that call is gone and why the number is imported instead of written here.
    kb_results = await search_hybrid(client_id, body.message, top_k=KB_TOP_K)
    sources = []
    context_parts = []
    valid_chunk_ids = set()
    for idx, r in enumerate(kb_results):
        # `kb_hit_is_citable`, not a literal 0.3 written out here and again in
        # services/sahayak_answer.py. Both copies were applied to a text search
        # that reported every hit as 0.0, so between them they discarded every
        # knowledge-base result the product has ever retrieved — 90 citations in
        # its lifetime, none from the knowledge base. The number now lives beside
        # the code that produces the score; see services/rag.py.
        if kb_hit_is_citable(r):
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

    # What language was this actually asked in?
    #
    # `language="en"` was hard-coded into the `generate` call below, so
    # `_select_providers`' Indic branch — ten languages, models picked for them,
    # written and shipped — had never been reached from chat by any customer.
    # Detection runs on the USER'S MESSAGE and not on `prompt`, which by this
    # point can carry ten turns of history: a conversation that opened in
    # English does not get to outvote the Gujarati question being asked now.
    lang = detect_language(body.message)
    lang_name = LANGUAGE_NAMES.get(lang, "English")

    # Build system prompt
    sys_parts = ["You are a helpful AI assistant for this business."]
    if brand:
        if brand["brand_voice"]:
            sys_parts.append(f"Brand voice: {brand['brand_voice']}")
        if brand["tone"]:
            sys_parts.append(f"Tone: {brand['tone']}")

    # THE HOUSE WORDS, ABOVE THE RECORDS THEY DESCRIBE.
    #
    # `hub._sahayak_answer` injects these and this route did not, so the product
    # had two live chat surfaces answering the same vocabulary question two
    # different ways. `frontend/src/pages/hub/ChatTab.jsx` posts here: asked "can
    # I edit an invoice that is marked final?" through the Sahayak tab the model
    # was told what `final` means in this product, and asked the same thing in
    # Hub chat it answered from general training data — which is exactly the
    # sentence `glossary_terms/doc-status.md` exists to stop.
    #
    # The same function, not a second copy of the vocabulary. `for_question`
    # matches on the term and its aliases and injects at most four, so an
    # ordinary question carries nothing; `services/glossary.py` has why the cap
    # is where it is.
    #
    # Matched on `body.message` and not on `prompt`, for the reason
    # `detect_language` is: `prompt` can carry ten turns of history by the time
    # it is built, and definitions dragged in by a question three messages ago
    # displace the one being asked now.
    #
    # ABOVE `context_parts` deliberately. The chunks below talk about clients,
    # invoice status and payments in this product's sense, and a model that
    # meets them before it is told what those words mean has already decided.
    #
    # NOT NUMBERED and not added to `valid_chunk_ids`: `_strip_invalid_refs`
    # deletes every `[n]` outside the numbered context, so a definition carrying
    # one would either be cited at a number pointing at somebody's invoice or
    # lose its marker and read as a rendering fault.
    vocabulary = glossary.for_question(body.message)
    if vocabulary:
        sys_parts.append("\n" + vocabulary)

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

    # Routing a Gujarati question to a model that handles Gujarati does not make
    # it ANSWER in Gujarati. Nothing in this prompt had ever named the reply's
    # language, and every provider in the chain defaults to English for a
    # question that is code-mixed or transliterated — which most real ones are.
    #
    # Appended last on purpose: it is the instruction that has to survive a
    # knowledge-base context block above it that can run to thousands of tokens,
    # and recency is the cheapest lever we have over that.
    sys_parts.append(
        f"\nLANGUAGE: The user wrote in {lang_name}. Reply in {lang_name}, using "
        f"that language's own script — do not transliterate it into the Latin "
        f"alphabet, and do not switch to English unless the user did. "
        f"Proper nouns, figures, and quoted knowledge-base excerpts stay exactly "
        f"as they appear in the source; do not translate an invoice number, a "
        f"GSTIN, or a person's name."
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
            language=lang,
            # TASK, and this is the whole bug. `_select_providers` branches on
            # `task`; `agent_type` only picks a quality tier WITHIN a task. This
            # call passed `agent_type="chatbot"` and no task at all, so it fell
            # through every branch to the English bulk chain — GLM-4.5-Air, the
            # free model the product uses for throwaway social captions. Every
            # chatbot answer this product has ever given came from there, and
            # `use_grounding = task == "chatbot"` in the router was `False` for
            # all of them, so web grounding never ran either.
            #
            # `agent_type` stays "chatbot" as well: it reaches neither
            # QUALITY_AGENTS nor PREMIUM_AGENTS, so it changes no routing, but it
            # is what `hub_ai_logs` and the spend reports read to say what the
            # call was for.
            task="chatbot",
            agent_type="chatbot",
            client_id=client_id,
            org_id=org_id,
        )

        assistant_text = ai_result.get("text", "I couldn't generate a response.")
        model_used = ai_result.get("model", "")
        # `cost_usd` comes back from every provider branch in ai_router.generate
        # and was being thrown away here in favour of a literal 0, while
        # hub_chat_messages.cost_usd — a DECIMAL(10,6) column that exists for
        # exactly this — recorded zero for every answer ever given. The credit
        # charge is what the customer pays; this is what the call cost us, and
        # the two are not the same number.
        cost = ai_result.get("cost_usd", 0) or 0

        import re as _re
        def _strip_invalid_refs(text, valid_ids):
            def _replacer(m):
                return "" if m.group(1) not in valid_ids else m.group(0)
            return _re.sub(r'\[(\d+)\]', _replacer, text)
        assistant_text = _strip_invalid_refs(assistant_text, valid_chunk_ids)

        # This loop has been here the whole time and has never run once. Two
        # things had to be true for it to: the task had to reach the router
        # (fixed above), and `ai_router.generate` had to actually RETURN the
        # sources `_call_gemini` collects — its return dict listed six keys and
        # this was not one of them. Both are now true, so a grounded answer
        # arrives with the pages it was grounded on.
        #
        # They join the knowledge-base citations in the same list and land in
        # `hub_chat_messages.sources`, a jsonb column that has existed since
        # migration 017 and needs no schema change. They carry no `ref` number,
        # unlike KB chunks: nothing numbered them into the prompt, so the model
        # was never given a `[n]` to cite them by, and inventing one here would
        # produce a citation marker pointing at text the model never saw.
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
            "credits_charged": answer_receipt.credits,
        }

    except Exception as exc:
        # The customer asked a question, was charged for the answer, and did not
        # get one. `generate` raises RuntimeError once every provider in the
        # chain has failed, and this handler has always turned that into a
        # friendly 200 — which is fine for the reader and was theft for the
        # wallet, once the wallet started being touched at all.
        #
        # `refund_standalone` because there is no transaction here and because
        # it already carries the never-raise contract this handler needs: we are
        # inside an `except` for a failure the user is waiting on, and a refund
        # that threw would replace two lost credits with a 500 on top.
        await credits.refund_standalone(
            tx_id=answer_receipt.tx_id,
            reason="Chatbot answer did not complete",
            user_id=user["user_id"],
        )

        return {
            "message": f"Sorry, I encountered an error: {str(exc)[:200]}",
            "sources": [],
            "model": "",
            "cost_usd": 0,
            "credits_charged": 0,
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
