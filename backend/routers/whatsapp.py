"""
whatsapp.py — Varta · वार्ता (WhatsApp Business) Router
WABA accounts, conversations, templates, Meta Cloud API webhook.
"""
import hashlib
import hmac
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from auth_router import require_user
import outbound
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services.encryption import encrypt, decrypt, is_encrypted
from services.wa_window import window_state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/whatsapp", tags=["varta-whatsapp"])

_gate = require_module("varta")

# The columns a client may see. `access_token_enc` and `webhook_verify_token` are
# both credentials — the first sends on the org's behalf, the second is what
# proves to Meta that a webhook subscription is ours — and neither is ever
# returned, not even masked. A masked value that round-trips is still a value
# the client can send back, and the first "just show the last four" request is
# how a write path starts accepting one.
#
# Written out rather than `SELECT *` for the reason the test states: a star
# hands over both secrets the moment anyone adds a column.
_ACCOUNT_COLS = (
    "id, org_id, provider, phone_number, display_name, waba_id, "
    "phone_number_id, status, created_at, updated_at"
)

# The four states the Accounts tab shows. 'not connected' is the absence of a
# row, so it is not in here.
#
# `failed` needs `migrations/123_varta_account_failed_status.sql`, which relaxes
# the CHECK on `varta_business_accounts.status`. Until that is applied the write
# below falls back to `suspended`, which the existing CHECK does allow and which
# the UI renders identically — see `_mark_account_failed`.
_STATUS_PENDING = "pending"
_STATUS_ACTIVE = "active"
_STATUS_FAILED = "failed"


async def _mark_account_failed(pool, account_id) -> None:
    """Record that a connected number can no longer send.

    Tolerant of the CHECK constraint on purpose. This is a diagnostic write on
    an error path — if migration 123 has not been applied yet, the correct
    outcome is that the operator still learns the number is broken, not that the
    error path raises a second, unrelated error on top of the first.
    """
    for value in (_STATUS_FAILED, "suspended"):
        try:
            await pool.execute(
                "UPDATE staging.varta_business_accounts "
                "SET status=$1, updated_at=NOW() WHERE id=$2",
                value, account_id,
            )
            return
        except Exception:  # noqa: BLE001 — see docstring
            log.warning(
                "could not set varta_business_accounts.status=%r; falling back. "
                "If this is 'failed', migration 123 has not been applied.", value,
            )
    log.error("could not record a failed WhatsApp account at all: %s", account_id)


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
    # Empty-defaulted because a template send carries no free text — the body is
    # the template's, resolved server-side from `template_id`. A required
    # `content` forced the client to invent one and send it, which is how the
    # stored row stopped matching what Meta actually rendered.
    content: str = ""
    type: str = "text"
    template_id: Optional[str] = None
    template_params: dict = {}

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
    rows = await pool.fetch(f"""
        SELECT {_ACCOUNT_COLS}
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
    """Connect a WhatsApp Business number.

    THE ACCOUNT IS `pending`, NOT `active`.

    This used to write `'active'` at the INSERT. Nothing had verified the six
    pasted values at that moment — not the token, not the phone_number_id, not
    that they belong to the same business — so the Accounts tab showed a green
    "Active" chip for a number that had never exchanged a byte with Meta, and a
    typo in `phone_number_id` was indistinguishable from a working connection
    until the first customer message silently went nowhere. (The webhook looks
    accounts up BY `phone_number_id`; a wrong one matches nothing and the
    inbound message is dropped by the `if not acc: continue` below.)

    The account becomes `active` when Meta completes the webhook handshake
    against the verify token — see `webhook_verify`. That is an observed fact
    about the connection rather than an assumption about the paste.
    """
    pool = await get_pool()

    # Two rows for one phone_number_id makes the webhook's account lookup
    # non-deterministic: inbound messages land against whichever row the planner
    # returns first, and only one of the two holds a token that still works.
    # There is no UNIQUE constraint to lean on (058 declares none), so this is
    # checked here — and the check is org-scoped, because two different
    # customers legitimately cannot share a number but the table does not say so.
    clash = await pool.fetchrow(
        "SELECT id, status FROM staging.varta_business_accounts "
        "WHERE org_id=$1::uuid AND phone_number_id=$2",
        org_id, body.phone_number_id.strip(),
    )
    if clash:
        raise HTTPException(
            409,
            "That phone number ID is already connected to this organisation. "
            "Disconnect it first if you need to replace its access token.",
        )

    row = await pool.fetchrow(f"""
        INSERT INTO staging.varta_business_accounts
            (org_id, phone_number, display_name, waba_id, phone_number_id,
             access_token_enc, webhook_verify_token, status)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, '{_STATUS_PENDING}')
        RETURNING {_ACCOUNT_COLS}
    """, org_id, body.phone_number.strip(), body.display_name.strip(),
        body.waba_id.strip(), body.phone_number_id.strip(),
        encrypt(body.access_token), body.webhook_verify_token)
    return dict(row)


@router.delete("/accounts/{account_id}")
async def disconnect_account(
    account_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Disconnect a number — and destroy the credential with it.

    The row is DELETEd rather than flagged. There is no "disconnected but we
    kept your access token" state in the four the Accounts tab shows, and
    keeping one would mean an org that believes it has revoked our access still
    has a live System User token sitting in our database.

    Conversations, contacts and messages are untouched: none of them reference
    this table (058 keys them on `org_id`), so the history of what was said
    survives the number being disconnected, which is what a support ticket six
    months later needs.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id FROM staging.varta_business_accounts "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        account_id, org_id,
    )
    if not row:
        raise HTTPException(404, "That WhatsApp account is not connected to this organisation")

    await pool.execute(
        "DELETE FROM staging.varta_business_accounts "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        account_id, org_id,
    )
    return {"ok": True}


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


@router.get("/conversations/{conv_id}/window")
async def conversation_window(
    conv_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """`{open, expires_at, remaining_seconds, ever_inbound}` for one thread.

    `waWindow.js` asks for this endpoint by name and it did not exist, so the
    client derived the window from the newest page of 50 messages. A thread with
    50 outbound messages since the last inbound one reads as "never opened"
    under that derivation — the safe direction to be wrong in, but wrong. This
    reads MAX(created_at) over every inbound row in the conversation.
    """
    pool = await get_pool()
    conv = await pool.fetchrow(
        "SELECT id FROM staging.varta_conversations WHERE id=$1::uuid AND org_id=$2::uuid",
        conv_id, org_id,
    )
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return await window_state(pool, conv_id, org_id)


# The two refusals, written once. They are read by a person in a toast, so they
# say what the rule is and what to do next rather than naming a status code.
_WINDOW_CLOSED = (
    "The 24-hour window has closed for this conversation, so WhatsApp will not "
    "deliver a free-form message. Send an approved template instead."
)
_TEMPLATE_NEEDS_ID = (
    "A template message must name which template to send. Pick one from the "
    "approved list."
)


@router.post("/conversations/{conv_id}/messages", status_code=201)
async def send_wa_message(
    conv_id: str,
    body: WASendMessage,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Send on a conversation — subject to Meta's 24-hour window, HERE.

    THE WINDOW IS ENFORCED ON THE SERVER, and it was not before.

    `WAChat.jsx` swaps the composer for a template picker when the window
    closes, and that is a good affordance and no kind of rule. This route took
    `{content, type}` and wrote it into `varta_messages` with a 201 regardless,
    so free-form text reached a closed conversation from a tab whose window
    state was computed an hour ago, from a retry, or from curl. Meta rejects
    those at its edge — which means our record of what we sent stops matching
    what the customer received, and a WABA that keeps attempting it is
    throttled and eventually flagged.

    THE CONVERSATION AND THE ACCOUNT ARE LOOKED UP SEPARATELY.

    The old query JOINed `varta_business_accounts … AND ba.status='active'` into
    the conversation lookup, so an org with no connected number — every org, as
    it turned out, because nothing could connect one — got
    "Conversation not found" about a conversation that exists and is on screen.
    Two questions, two answers.
    """
    pool = await get_pool()
    conv = await pool.fetchrow("""
        SELECT c.id, c.org_id, c.status, vc.phone_number
        FROM staging.varta_conversations c
        JOIN staging.varta_contacts vc ON vc.id = c.varta_contact_id
        WHERE c.id = $1::uuid AND c.org_id = $2::uuid
        LIMIT 1
    """, conv_id, org_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    account = await pool.fetchrow("""
        SELECT id, status, phone_number_id, access_token_enc
        FROM staging.varta_business_accounts
        WHERE org_id=$1::uuid AND status='active'
        ORDER BY created_at DESC LIMIT 1
    """, org_id)
    if not account:
        raise HTTPException(
            409,
            "No WhatsApp Business number is connected for this organisation. "
            "Connect one under Accounts before replying.",
        )

    # `decrypt` returns its input unchanged when the token will not open, which
    # is deliberate (it lets legacy plaintext rows still read) and means the
    # ONLY way to tell a dead credential from a live one is to ask whether the
    # result is still marked. A token that did not open cannot send, so the
    # account is recorded as failed and the operator is told to reconnect —
    # rather than the send being stored `pending` forever against a number that
    # will never deliver it.
    if is_encrypted(decrypt(account["access_token_enc"] or "")):
        await _mark_account_failed(pool, account["id"])
        raise HTTPException(
            503,
            "The stored access token for this number could not be read. "
            "Disconnect the number under Accounts and connect it again with a "
            "fresh token.",
        )

    win = await window_state(pool, conv_id, org_id)

    template = None
    if body.type == "template":
        if not body.template_id:
            raise HTTPException(409, _TEMPLATE_NEEDS_ID)
        template = await pool.fetchrow("""
            SELECT id, name, language, body, status
            FROM staging.varta_templates
            WHERE id=$1::uuid AND org_id=$2::uuid
        """, body.template_id, org_id)
        if not template:
            raise HTTPException(404, "Template not found")
        # Checked INSIDE the window too. Meta requires approval for every
        # template regardless of the window — the window only decides whether a
        # NON-template is also allowed.
        if template["status"] != "approved":
            raise HTTPException(
                409,
                f"“{template['name']}” has not been approved by Meta yet "
                f"(it is {template['status']}), so it cannot be delivered.",
            )
    elif not win["open"]:
        raise HTTPException(409, _WINDOW_CLOSED)

    if template is not None:
        content = template["body"] or template["name"]
        template_name = template["name"]
    else:
        content = body.content.strip()
        if not content:
            raise HTTPException(422, "A message cannot be empty.")
        template_name = None

    # ── P7 · THE CALL TO META, which is what turned this button from a
    # ── record-keeping exercise into a message somebody receives.
    #
    # Everything above this line already worked: the 24-hour window, the
    # template approval check, the token decryption, the failed-account
    # bookkeeping. What did not exist was the send. The row went in as
    # `pending`, the UI reported success, and the customer got nothing — the
    # dead-button failure this codebase has shipped before, on the one surface
    # where the recipient is somebody else's client.
    #
    # ── The order is load-bearing: SEND FIRST, THEN RECORD ──────────────────
    #
    # `wa_message_id` is Meta's id for the message, and the `statuses` webhook
    # matches on it and on nothing else. Insert first and the row exists with a
    # NULL id, so every delivery receipt for it is dropped on the floor and it
    # sits at `pending` for ever, indistinguishable from a send that never
    # happened.
    #
    # The cost of this order is the case where Meta accepts the message and the
    # INSERT then fails: the customer has it, we have no record. That is the
    # better failure — a missing row is visible and fixable, an unmatched
    # message is a permanent lie about what the firm sent.

    # ── THE OUTBOUND GATE, which this call shipped without ─────────────────
    #
    # `outbound.py` named this exact path as deliberately unguarded, and said
    # why: "WhatsApp (`routers/whatsapp.py`). It does not send today —
    # `send_wa_message` stores the row as 'pending' behind a `TODO: Call Meta
    # Cloud API`. When that TODO is implemented, guard it here before it ships."
    #
    # The TODO was implemented and the guard was not. So `OUTBOUND_MODE=dry`
    # stopped every email and every social post and did not stop this — the one
    # channel where the recipient is somebody else's client, on a number the
    # customer pays Meta for. Nothing recorded it either: `outbound_log` is the
    # product's only answer to "what has this system ever sent", and WhatsApp
    # was invisible to it.
    #
    # It could not fire yet — `varta_business_accounts` is empty, so there are
    # no credentials — which is exactly why this lands now rather than after the
    # first number is connected.
    with outbound.sending(
        "whatsapp", conv["phone_number"],
        # `detail` is a subject or a title, NEVER a body: on this channel the
        # body is a message to somebody else's customer, and the template name
        # is the most that can be said about it without storing it.
        template_name or "free-text message",
        org_id=org_id, user_id=user["user_id"],
        ref=f"varta:{conv_id}", purpose="whatsapp",
    ) as att:
        if att.blocked:
            # RECORDED AS FAILED, NOT AS PENDING. `pending` is what a message
            # waiting on Meta looks like, and a suppressed one is never coming
            # back — it would sit there for ever, indistinguishable from the
            # dead button this route was built to remove. The status column's
            # CHECK allows no 'suppressed', so the reason rides in `error_code`
            # rather than in a migration this does not need.
            row = await pool.fetchrow("""
                INSERT INTO staging.varta_messages
                    (org_id, conversation_id, direction, content, type, status,
                     error_code, template_name, template_params)
                VALUES ($1::uuid, $2::uuid, 'outbound', $3, $4, 'failed',
                        'suppressed_outbound_mode', $5, $6::jsonb)
                RETURNING *
            """, org_id, conv_id, content, body.type, template_name,
                json.dumps(body.template_params or {}))
            return dict(row)

        wamid = await _send_via_meta(
            phone_number_id=account["phone_number_id"],
            token=decrypt(account["access_token_enc"] or ""),
            to=conv["phone_number"],
            text=None if template is not None else content,
            template=template,
            params=body.template_params or {},
            pool=pool,
            account_id=account["id"],
        )
        att.sent(wamid, provider="meta")

    # `pending` is still the right starting status: Meta ACCEPTED it, which is
    # not the same as delivered. The `statuses` webhook moves it through
    # sent -> delivered -> read, or to failed, and now has a wamid to match on.
    row = await pool.fetchrow("""
        INSERT INTO staging.varta_messages
            (org_id, conversation_id, direction, content, type, status,
             template_name, template_params, wa_message_id)
        VALUES ($1::uuid, $2::uuid, 'outbound', $3, $4, 'pending', $5, $6::jsonb, $7)
        RETURNING *
    """, org_id, conv_id, content, body.type, template_name,
        json.dumps(body.template_params or {}), wamid)

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

# ── Webhook (public — Meta Cloud API sends events here) ──────

@router.get("/webhook")
async def webhook_verify(request: Request):
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode != "subscribe" or not token or not challenge:
        raise HTTPException(400, "Invalid verification request")

    pool = await get_pool()
    # `AND status='active'` was in this WHERE, which made the connect flow a
    # closed loop: an account is created `pending` and becomes `active` BY
    # completing this handshake, so requiring `active` to complete it meant a
    # newly connected number could never leave `pending`. Meta's verification
    # call would 403 and the operator would see a number stuck half-connected
    # with nothing on screen explaining why.
    #
    # The verify token is itself the credential here — it is a value only the
    # org's admin and Meta hold — so matching on it alone is the check.
    acc = await pool.fetchrow(
        "SELECT id, status FROM staging.varta_business_accounts "
        "WHERE webhook_verify_token=$1 AND webhook_verify_token <> ''",
        token,
    )
    if not acc:
        raise HTTPException(403, "Invalid verify token")

    # THIS is the moment the connection is real: Meta has reached us, on this
    # number's subscription, with a secret only this org gave it.
    if acc["status"] != _STATUS_ACTIVE:
        await pool.execute(
            "UPDATE staging.varta_business_accounts "
            f"SET status='{_STATUS_ACTIVE}', updated_at=NOW() WHERE id=$1",
            acc["id"],
        )
        log.info("WhatsApp account %s verified by Meta and marked active", acc["id"])

    from starlette.responses import PlainTextResponse
    return PlainTextResponse(challenge)


@router.post("/webhook")
async def webhook_receive(request: Request):
    import os
    raw_body = await request.body()
    # `if app_secret:` skipped verification ENTIRELY when the variable was unset
    # or set-but-empty, which is the one state where nothing else is checking.
    # This route is unauthenticated by design and WRITES: it creates rows in
    # `varta_contacts` and `varta_conversations` for whichever org owns the
    # `phone_number_id` in the body. Without the signature, anyone who can guess
    # or read a phone_number_id can inject messages into any org's inbox and
    # invent contacts in it.
    #
    # It now fails CLOSED, matching `scheduler._verify_cron`, which has always
    # refused when its secret is missing rather than waving the request through.
    # The error is logged loudly and names the variable, because a misconfigured
    # deployment should be diagnosable in one line rather than silently accepting
    # forged traffic.
    app_secret = (os.getenv("META_APP_SECRET") or "").strip()
    if not app_secret:
        log.error(
            "META_APP_SECRET is not set — refusing the WhatsApp webhook. Inbound "
            "messages cannot be verified as coming from Meta, and this endpoint "
            "writes to varta_contacts and varta_conversations."
        )
        raise HTTPException(503, "Webhook is not configured")

    sig_header = request.headers.get("x-hub-signature-256", "")
    if not sig_header.startswith("sha256="):
        raise HTTPException(403, "Missing signature")
    expected = hmac.HMAC(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig_header[7:], expected):
        raise HTTPException(403, "Invalid signature")

    payload = json.loads(raw_body)
    # The payload carries the CUSTOMER'S PHONE NUMBER and the text of their
    # message. Logging 500 characters of it put both in the application log,
    # where they outlive the retention policy that governs the conversation
    # itself. Structure only.
    log.info(
        "WhatsApp webhook: %d entr%s",
        len(payload.get("entry", []) or []),
        "y" if len(payload.get("entry", []) or []) == 1 else "ies",
    )

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


# ═════════════════════════════════════════════════════════════════════════════
# P7 · THE OUTBOUND CALL TO META
# ═════════════════════════════════════════════════════════════════════════════
#
# Meta bills the ORG, not Aekam — the token belongs to their WABA and every
# conversation is charged to them. We sell the automation, never the messages.
# That is why there is no per-message credit debit here and must not be one.

#: Pinned. Meta deprecates a Graph version roughly every two years and the
#: failure mode of `latest` is a payload shape changing under a working
#: integration — see `gemini_models_pinned`, which cost real money learning the
#: same lesson with a different vendor.
_GRAPH_VERSION = "v21.0"

#: Long enough for Meta's median (~300ms) plus a bad day; short enough that a
#: stalled Graph API cannot hold a request thread open behind a user pressing
#: Send. A timeout here is reported as a failure to send, which is TRUE — we do
#: not know whether it went, and claiming it did is the worse of the two lies.
_SEND_TIMEOUT = 12.0


def _template_payload(template, params: dict) -> dict:
    """Meta's `template` object.

    Body parameters are POSITIONAL — `{{1}}`, `{{2}}` — and Meta matches them by
    ORDER, not by name. The stored params are a JSON object, so the order has to
    come from somewhere deterministic: the keys are sorted, which is arbitrary
    but STABLE, and stable is the property that matters. An unstable order would
    put the amount where the invoice number belongs on some sends and not
    others, which is the kind of bug that only appears in front of a customer.
    """
    ordered = [str(params[k]) for k in sorted(params or {})]
    payload = {
        "name": template["name"],
        "language": {"code": template["language"] or "en"},
    }
    if ordered:
        payload["components"] = [{
            "type": "body",
            "parameters": [{"type": "text", "text": v} for v in ordered],
        }]
    return payload


async def _send_via_meta(*, phone_number_id: str, token: str, to: str,
                         text: str | None, template, params: dict,
                         pool, account_id) -> str:
    """POST the message and return Meta's `wamid`.

    Raises HTTPException on every failure, so nothing is recorded as sent that
    was not accepted.

    ── Why the errors are read rather than passed through ───────────────────
    Meta's messages are written for a developer reading a stack trace, and this
    one surfaces in a toast to somebody replying to a customer. The three that
    actually happen get a sentence saying what to do; anything else is reported
    verbatim, because a wrong guess about an unknown error is worse than the
    raw text.
    """
    import httpx

    url = f"https://graph.facebook.com/{_GRAPH_VERSION}/{phone_number_id}/messages"
    payload: dict = {"messaging_product": "whatsapp", "to": to}
    if template is not None:
        payload["type"] = "template"
        payload["template"] = _template_payload(template, params)
    else:
        payload["type"] = "text"
        # `preview_url` off: a link in a business message rendering someone
        # else's preview card is a surface we do not control, on a channel the
        # org is accountable for.
        payload["text"] = {"body": text or "", "preview_url": False}

    try:
        async with httpx.AsyncClient(timeout=_SEND_TIMEOUT) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.TimeoutException:
        raise HTTPException(
            504,
            "WhatsApp did not answer in time. The message may or may not have "
            "been sent — check the conversation before sending it again.",
        )
    except httpx.HTTPError as exc:
        log.error("WhatsApp send: network failure: %s", exc)
        raise HTTPException(502, "Could not reach WhatsApp. Try again shortly.")

    if resp.status_code >= 400:
        try:
            err = (resp.json().get("error") or {})
        except ValueError:
            err = {}
        code = err.get("code")
        detail = err.get("message") or resp.text[:200]

        # 190 — the token is dead or revoked. The account is marked failed for
        # the same reason the decrypt check above does it: a number that cannot
        # send must stop looking connected, or every later send queues against
        # it silently.
        if code == 190:
            await _mark_account_failed(pool, account_id)
            raise HTTPException(
                409,
                "WhatsApp rejected the access token for this number. Reconnect "
                "it under Accounts with a fresh token.",
            )
        # 131047 — outside the 24-hour window. We check that ourselves before
        # getting here, so seeing it means our clock and Meta's disagree, most
        # often because the customer's last message arrived while this tab was
        # open. Say the remedy, not the code.
        if code == 131047:
            raise HTTPException(409, _WINDOW_CLOSED)
        # 131026 — undeliverable: not on WhatsApp, or blocked. Nothing to
        # retry, and a firm should stop using this channel for that contact.
        if code == 131026:
            raise HTTPException(
                409,
                "WhatsApp could not deliver to this number — it may not be on "
                "WhatsApp, or may have blocked your business. Try email or a "
                "phone call.",
            )
        log.error("WhatsApp send failed: HTTP %s code=%s", resp.status_code, code)
        raise HTTPException(502, f"WhatsApp refused the message: {detail}")

    data = resp.json()
    messages = data.get("messages") or []
    wamid = (messages[0] or {}).get("id") if messages else None
    if not wamid:
        # Accepted with no id is a shape we do not understand. Refusing is
        # right: a row with no wamid can never be matched by a delivery receipt
        # and would sit at `pending` for ever, looking like a send that failed.
        log.error("WhatsApp send: 2xx with no message id: %s", str(data)[:200])
        raise HTTPException(502, "WhatsApp accepted the message but returned no id.")
    return wamid
