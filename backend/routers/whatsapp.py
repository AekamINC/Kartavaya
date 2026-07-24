"""
whatsapp.py — Varta · वार्ता (WhatsApp Business) Router
WABA accounts, conversations, templates, auto-replies, Meta Cloud API webhook.
"""
import hashlib
import hmac
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.encryption import encrypt, decrypt

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/whatsapp", tags=["varta-whatsapp"])

_gate = require_module("varta")


# ── Pydantic Models ──────────────────────────────────────────

class WAAccountCreate(BaseModel):
    phone_number: str
    display_name: str
    waba_id: str
    phone_number_id: str
    access_token: str
    webhook_verify_token: str = ""

class WATemplateCreate(BaseModel):
    name: str
    language: str = "en"
    category: str = "MARKETING"
    header_type: Optional[str] = None
    header_content: Optional[str] = None
    body: str
    footer: Optional[str] = None
    buttons: list = []

class WAAutoReplyCreate(BaseModel):
    trigger_type: str = "keyword"
    trigger_value: str = ""
    response_type: str = "text"
    response_content: str = ""
    template_id: Optional[str] = None
    is_active: bool = True

class WASendMessage(BaseModel):
    content: str
    type: str = "text"

class WASendTemplate(BaseModel):
    phone_number: str
    template_name: str
    language: str = "en"
    params: list = []


# ── WABA Accounts ────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT id, org_id, provider, phone_number, display_name, waba_id,
               phone_number_id, status, created_at, updated_at
        FROM staging.varta_business_accounts WHERE org_id=$1::uuid
        ORDER BY created_at DESC
    """, org_id)
    return [dict(r) for r in rows]


@router.post("/accounts", status_code=201)
async def create_account(
    body: WAAccountCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow("""
        INSERT INTO staging.varta_business_accounts
            (org_id, phone_number, display_name, waba_id, phone_number_id,
             access_token_enc, webhook_verify_token, status)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'active')
        RETURNING id, org_id, phone_number, display_name, waba_id, phone_number_id, status
    """, org_id, body.phone_number, body.display_name, body.waba_id,
        body.phone_number_id, encrypt(body.access_token), body.webhook_verify_token)
    return dict(row)


# ── Conversations ────────────────────────────────────────────

@router.get("/conversations")
async def list_conversations(
    status: Optional[str] = None,
    limit: int = Query(50, le=100),
    offset: int = 0,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    where = "c.org_id = $1::uuid"
    params = [org_id]
    if status:
        params.append(status)
        where += f" AND c.status = ${len(params)}"

    rows = await pool.fetch(f"""
        SELECT c.*, vc.phone_number, vc.name AS contact_name,
               vc.graha_contact_id,
               (SELECT content FROM staging.varta_messages vm
                WHERE vm.conversation_id = c.id ORDER BY vm.created_at DESC LIMIT 1) AS last_message
        FROM staging.varta_conversations c
        JOIN staging.varta_contacts vc ON vc.id = c.varta_contact_id
        WHERE {where}
        ORDER BY c.started_at DESC
        LIMIT ${len(params)+1} OFFSET ${len(params)+2}
    """, *params, limit, offset)
    return [dict(r) for r in rows]


@router.get("/conversations/{conv_id}/messages")
async def conversation_messages(
    conv_id: str,
    limit: int = Query(50, le=100),
    before: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    conv = await pool.fetchrow(
        "SELECT 1 FROM staging.varta_conversations WHERE id=$1::uuid AND org_id=$2::uuid",
        conv_id, org_id,
    )
    if not conv:
        raise HTTPException(404, "Conversation not found")

    if before:
        rows = await pool.fetch("""
            SELECT * FROM staging.varta_messages
            WHERE conversation_id=$1::uuid
              AND created_at < (SELECT created_at FROM staging.varta_messages WHERE id=$3::uuid)
            ORDER BY created_at DESC LIMIT $2
        """, conv_id, limit, before)
    else:
        rows = await pool.fetch("""
            SELECT * FROM staging.varta_messages
            WHERE conversation_id=$1::uuid
            ORDER BY created_at DESC LIMIT $2
        """, conv_id, limit)
    return [dict(r) for r in rows]


@router.post("/conversations/{conv_id}/messages", status_code=201)
async def send_wa_message(
    conv_id: str,
    body: WASendMessage,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    conv = await pool.fetchrow("""
        SELECT c.*, vc.phone_number, ba.phone_number_id, ba.access_token_enc
        FROM staging.varta_conversations c
        JOIN staging.varta_contacts vc ON vc.id = c.varta_contact_id
        JOIN staging.varta_business_accounts ba ON ba.org_id = c.org_id AND ba.status = 'active'
        WHERE c.id = $1::uuid AND c.org_id = $2::uuid
        LIMIT 1
    """, conv_id, org_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    # TODO: Call Meta Cloud API to send message
    # For now, store as pending — Meta API integration requires WABA approval
    row = await pool.fetchrow("""
        INSERT INTO staging.varta_messages
            (org_id, conversation_id, direction, content, type, status)
        VALUES ($1::uuid, $2::uuid, 'outbound', $3, $4, 'pending')
        RETURNING *
    """, org_id, conv_id, body.content.strip(), body.type)

    return dict(row)


# ── Templates ────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT * FROM staging.varta_templates WHERE org_id=$1::uuid
        ORDER BY created_at DESC
    """, org_id)
    return [dict(r) for r in rows]


@router.post("/templates", status_code=201)
async def create_template(
    body: WATemplateCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow("""
        INSERT INTO staging.varta_templates
            (org_id, name, language, category, header_type, header_content, body, footer, buttons)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
    """, org_id, body.name, body.language, body.category,
        body.header_type, body.header_content, body.body,
        body.footer, json.dumps(body.buttons))
    return dict(row)


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.varta_templates WHERE id=$1::uuid AND org_id=$2::uuid",
        template_id, org_id,
    )
    return {"ok": True}


# ── Auto-replies ─────────────────────────────────────────────

@router.get("/auto-replies")
async def list_auto_replies(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT * FROM staging.varta_auto_replies WHERE org_id=$1::uuid
        ORDER BY created_at DESC
    """, org_id)
    return [dict(r) for r in rows]


@router.post("/auto-replies", status_code=201)
async def create_auto_reply(
    body: WAAutoReplyCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow("""
        INSERT INTO staging.varta_auto_replies
            (org_id, trigger_type, trigger_value, response_type, response_content, template_id, is_active)
        VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7)
        RETURNING *
    """, org_id, body.trigger_type, body.trigger_value,
        body.response_type, body.response_content, body.template_id, body.is_active)
    return dict(row)


@router.delete("/auto-replies/{rule_id}")
async def delete_auto_reply(
    rule_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM staging.varta_auto_replies WHERE id=$1::uuid AND org_id=$2::uuid",
        rule_id, org_id,
    )
    return {"ok": True}


# ── Webhook (public — Meta Cloud API sends events here) ──────

@router.get("/webhook")
async def webhook_verify(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode != "subscribe" or not token or not challenge:
        raise HTTPException(400, "Invalid verification request")

    pool = await get_pool()
    acc = await pool.fetchrow(
        "SELECT 1 FROM staging.varta_business_accounts WHERE webhook_verify_token=$1 AND status='active'",
        token,
    )
    if not acc:
        raise HTTPException(403, "Invalid verify token")

    from starlette.responses import PlainTextResponse
    return PlainTextResponse(challenge)


@router.post("/webhook")
async def webhook_receive(request: Request):
    import os
    raw_body = await request.body()
    app_secret = os.getenv("META_APP_SECRET", "")
    if app_secret:
        sig_header = request.headers.get("x-hub-signature-256", "")
        if not sig_header.startswith("sha256="):
            raise HTTPException(403, "Missing signature")
        expected = hmac.HMAC(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig_header[7:], expected):
            raise HTTPException(403, "Invalid signature")

    payload = json.loads(raw_body)
    log.info("WhatsApp webhook: %s", json.dumps(payload)[:500])

    entry = payload.get("entry", [])
    pool = await get_pool()

    for e in entry:
        for change in e.get("changes", []):
            value = change.get("value", {})
            phone_number_id = value.get("metadata", {}).get("phone_number_id", "")

            acc = await pool.fetchrow(
                "SELECT id, org_id FROM staging.varta_business_accounts WHERE phone_number_id=$1 AND status='active'",
                phone_number_id,
            )
            if not acc:
                continue

            org_id = str(acc["org_id"])

            # Process inbound messages
            for msg in value.get("messages", []):
                sender_phone = msg.get("from", "")
                wa_msg_id = msg.get("id", "")
                msg_type = msg.get("type", "text")
                content = ""
                if msg_type == "text":
                    content = msg.get("text", {}).get("body", "")

                # Find or create contact
                contact = await pool.fetchrow(
                    "SELECT id FROM staging.varta_contacts WHERE org_id=$1::uuid AND phone_number=$2",
                    org_id, sender_phone,
                )
                if not contact:
                    contact = await pool.fetchrow("""
                        INSERT INTO staging.varta_contacts (org_id, phone_number, name)
                        VALUES ($1::uuid, $2, $3) RETURNING id
                    """, org_id, sender_phone, msg.get("profile", {}).get("name", sender_phone))

                # Find or create conversation
                conv = await pool.fetchrow("""
                    SELECT id FROM staging.varta_conversations
                    WHERE org_id=$1::uuid AND varta_contact_id=$2 AND status != 'resolved'
                    ORDER BY started_at DESC LIMIT 1
                """, org_id, contact["id"])
                if not conv:
                    conv = await pool.fetchrow("""
                        INSERT INTO staging.varta_conversations (org_id, varta_contact_id, status)
                        VALUES ($1::uuid, $2, 'open') RETURNING id
                    """, org_id, contact["id"])

                await pool.execute("""
                    INSERT INTO staging.varta_messages
                        (org_id, conversation_id, direction, wa_message_id, content, type, status)
                    VALUES ($1::uuid, $2, 'inbound', $3, $4, $5, 'delivered')
                """, org_id, conv["id"], wa_msg_id, content, msg_type)

                await pool.execute(
                    "UPDATE staging.varta_contacts SET last_message_at=NOW() WHERE id=$1",
                    contact["id"],
                )

            # Process status updates
            for status_update in value.get("statuses", []):
                wa_msg_id = status_update.get("id", "")
                new_status = status_update.get("status", "")
                if new_status in ("sent", "delivered", "read", "failed"):
                    await pool.execute("""
                        UPDATE staging.varta_messages SET status=$1
                        WHERE wa_message_id=$2
                    """, new_status, wa_msg_id)

    return {"ok": True}
