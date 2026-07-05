# Kartavya Messaging Module -- Implementation Guide

> **Module**: Messaging (WhatsApp + Internal Chat)
> **Sub-products**: **Samvada** (internal team messaging) | **Varta** (WhatsApp Business integration)
> **Extends**: `docs/MESSAGING_WHATSAPP_PLAN.md`
> **Repo**: `kevalvshah/Kartavya`
> **Stack**: React 19 (CRA+CRACO+Tailwind) on Vercel, FastAPI Python 3.13 on Railway, Supabase PostgreSQL (`efzzjcnpjigeffkiissb`), Cloudflare R2 (`aekaminc`)
> **Auth**: Supabase Auth with `org_id` RLS on every table

---

## Delivery Timeline

| Phase | Weeks | Scope |
|-------|-------|-------|
| 1 | 1--2 | Samvada -- channels, DMs, threads, reactions |
| 2 | 3 | Varta -- BSP integration via Interakt/Wati |
| 3 | 4 | Template messaging, broadcasts, auto-replies |
| 4 | 5--6 | CRM integration (WhatsApp leads, conversation sync) |
| 5 | 7 | Migration path to Meta Cloud API direct |

---

## 1. Database Migration

**File**: `supabase/migrations/013_whatsapp_module.sql`

### 1.1 Samvada Tables (Internal Messaging)

```sql
-- ============================================================
-- 013_whatsapp_module.sql
-- Messaging module: Samvada (internal) + Varta (WhatsApp)
-- ============================================================

-- -----------------------------------------------------------
-- SAMVADA: Internal Team Messaging
-- -----------------------------------------------------------

CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    description TEXT,
    type VARCHAR(10) NOT NULL CHECK (type IN ('public', 'private', 'dm')),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_channels_org ON channels(org_id);
CREATE INDEX idx_channels_org_type ON channels(org_id, type) WHERE NOT is_archived;

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY channels_org_isolation ON channels
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE channel_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at TIMESTAMPTZ,
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (channel_id, user_id)
);

CREATE INDEX idx_channel_members_user ON channel_members(user_id);
CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);

ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_members_isolation ON channel_members
    USING (
        channel_id IN (
            SELECT id FROM channels WHERE org_id = auth.jwt() ->> 'org_id'
        )
    );

-- -----------------------------------------------------------

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id),
    content TEXT NOT NULL,
    type VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file', 'system')),
    parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_thread ON messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX idx_messages_org ON messages(org_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_org_isolation ON messages
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,          -- R2 presigned URL path
    file_type VARCHAR(100) NOT NULL, -- MIME type
    file_size INT NOT NULL,          -- bytes
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_message ON message_attachments(message_id);

-- -----------------------------------------------------------

CREATE TABLE message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);

-- -----------------------------------------------------------

CREATE TABLE message_read_receipts (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
```

### 1.2 Varta Tables (WhatsApp Business)

```sql
-- -----------------------------------------------------------
-- VARTA: WhatsApp Business Integration
-- -----------------------------------------------------------

CREATE TABLE wa_business_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('interakt', 'wati', 'meta_cloud')),
    provider_account_id TEXT,
    phone_number VARCHAR(20) NOT NULL,   -- E.164 format
    display_name VARCHAR(100) NOT NULL,
    api_key_encrypted TEXT NOT NULL,      -- encrypted at rest via pgcrypto or app-level
    webhook_secret TEXT,
    status VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, phone_number)
);

CREATE INDEX idx_wa_accounts_org ON wa_business_accounts(org_id);

ALTER TABLE wa_business_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_accounts_org_isolation ON wa_business_accounts
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE wa_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,   -- E.164
    name VARCHAR(150),
    crm_contact_id UUID,                 -- FK to crm_contacts (nullable, linked in Phase 4)
    opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    opted_in_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, phone_number)
);

CREATE INDEX idx_wa_contacts_org ON wa_contacts(org_id);
CREATE INDEX idx_wa_contacts_phone ON wa_contacts(org_id, phone_number);
CREATE INDEX idx_wa_contacts_crm ON wa_contacts(crm_contact_id) WHERE crm_contact_id IS NOT NULL;

ALTER TABLE wa_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_contacts_org_isolation ON wa_contacts
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE wa_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    wa_contact_id UUID NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES auth.users(id),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved')),
    channel VARCHAR(10) NOT NULL DEFAULT 'whatsapp',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_wa_conversations_org_status ON wa_conversations(org_id, status);
CREATE INDEX idx_wa_conversations_contact ON wa_conversations(wa_contact_id);
CREATE INDEX idx_wa_conversations_assigned ON wa_conversations(assigned_to) WHERE assigned_to IS NOT NULL;

ALTER TABLE wa_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_conversations_org_isolation ON wa_conversations
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE wa_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    wa_message_id TEXT,                  -- provider-assigned message ID
    content TEXT,
    type VARCHAR(15) NOT NULL DEFAULT 'text'
        CHECK (type IN ('text', 'image', 'document', 'template', 'interactive', 'location')),
    media_url TEXT,
    template_name TEXT,
    template_params JSONB,
    status VARCHAR(10) NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_messages_conversation ON wa_messages(conversation_id, created_at DESC);
CREATE INDEX idx_wa_messages_org ON wa_messages(org_id);
CREATE INDEX idx_wa_messages_wa_id ON wa_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

ALTER TABLE wa_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_messages_org_isolation ON wa_messages
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE wa_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    language VARCHAR(5) NOT NULL DEFAULT 'en',
    category VARCHAR(20) NOT NULL CHECK (category IN ('marketing', 'utility', 'authentication')),
    header_type VARCHAR(10) NOT NULL DEFAULT 'none'
        CHECK (header_type IN ('none', 'text', 'image', 'document')),
    header_content TEXT,
    body TEXT NOT NULL,
    footer TEXT,
    buttons JSONB DEFAULT '[]',
    status VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    meta_template_id TEXT,               -- ID from Meta/BSP after submission
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_templates_org ON wa_templates(org_id);
CREATE INDEX idx_wa_templates_org_status ON wa_templates(org_id, status);

ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_templates_org_isolation ON wa_templates
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE wa_broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    template_id UUID NOT NULL REFERENCES wa_templates(id),
    audience_filter JSONB DEFAULT '{}',  -- e.g. {"tags": ["vip"], "opted_in": true}
    scheduled_at TIMESTAMPTZ,
    status VARCHAR(10) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')),
    total_recipients INT DEFAULT 0,
    delivered INT DEFAULT 0,
    read_count INT DEFAULT 0,
    failed INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_broadcasts_org ON wa_broadcasts(org_id);

ALTER TABLE wa_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_broadcasts_org_isolation ON wa_broadcasts
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------

CREATE TABLE wa_auto_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    trigger_type VARCHAR(20) NOT NULL
        CHECK (trigger_type IN ('keyword', 'first_message', 'out_of_hours')),
    trigger_value TEXT,                  -- keyword pattern or NULL for non-keyword triggers
    response_type VARCHAR(10) NOT NULL CHECK (response_type IN ('text', 'template')),
    response_content TEXT,               -- plain text reply (when response_type = 'text')
    template_id UUID REFERENCES wa_templates(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_auto_replies_org ON wa_auto_replies(org_id);
CREATE INDEX idx_wa_auto_replies_active ON wa_auto_replies(org_id, trigger_type) WHERE is_active;

ALTER TABLE wa_auto_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_auto_replies_org_isolation ON wa_auto_replies
    USING (org_id = auth.jwt() ->> 'org_id')
    WITH CHECK (org_id = auth.jwt() ->> 'org_id');

-- -----------------------------------------------------------
-- Enable Supabase Realtime on live-update tables
-- -----------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE wa_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE wa_conversations;
```

### 1.3 RLS Notes

- Every table carries `org_id` and an RLS policy filtering on `auth.jwt() ->> 'org_id'`.
- `channel_members` uses a sub-select against `channels` since it lacks its own `org_id`.
- The service role (used by the webhook handler) bypasses RLS. Webhook endpoints authenticate via `webhook_secret`, not Supabase Auth.

---

## 2. Backend Routers

### 2.1 Internal Messaging -- `backend/routers/messaging.py`

```python
"""
Samvada -- Internal Team Messaging Router
backend/routers/messaging.py
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from uuid import UUID
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from backend.dependencies import get_current_user, get_supabase_client, get_r2_client


router = APIRouter(prefix="/api/v1/messaging", tags=["messaging"])


# ---- Pydantic Models ----

class ChannelCreate(BaseModel):
    name: str = Field(max_length=80)
    description: Optional[str] = None
    type: str = Field(pattern="^(public|private|dm)$")

class ChannelMemberAdd(BaseModel):
    user_id: UUID
    role: str = Field(default="member", pattern="^(admin|member)$")

class MessageCreate(BaseModel):
    content: str
    type: str = Field(default="text", pattern="^(text|image|file|system)$")
    parent_message_id: Optional[UUID] = None
    metadata: dict = Field(default_factory=dict)

class MessageEdit(BaseModel):
    content: str

class ReactionCreate(BaseModel):
    emoji: str = Field(max_length=10)


# ---- Channel Endpoints ----

@router.get("/channels")
async def list_channels(
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """List all channels the user is a member of (plus public channels)."""
    result = db.rpc("list_user_channels", {"p_user_id": str(user.id), "p_org_id": str(user.org_id)}).execute()
    return result.data


@router.post("/channels", status_code=201)
async def create_channel(
    payload: ChannelCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Create a channel and add the creator as admin."""
    channel = (
        db.table("channels")
        .insert({
            "org_id": str(user.org_id),
            "name": payload.name,
            "description": payload.description,
            "type": payload.type,
            "created_by": str(user.id),
        })
        .execute()
    )
    ch = channel.data[0]

    # Auto-add creator as admin
    db.table("channel_members").insert({
        "channel_id": ch["id"],
        "user_id": str(user.id),
        "role": "admin",
    }).execute()

    return ch


@router.post("/channels/{channel_id}/members", status_code=201)
async def add_channel_member(
    channel_id: UUID,
    payload: ChannelMemberAdd,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Add a member to a channel. Caller must be channel admin."""
    # Verify caller is admin
    membership = (
        db.table("channel_members")
        .select("role")
        .eq("channel_id", str(channel_id))
        .eq("user_id", str(user.id))
        .single()
        .execute()
    )
    if not membership.data or membership.data["role"] != "admin":
        raise HTTPException(403, "Only channel admins can add members")

    result = (
        db.table("channel_members")
        .insert({
            "channel_id": str(channel_id),
            "user_id": str(payload.user_id),
            "role": payload.role,
        })
        .execute()
    )
    return result.data[0]


# ---- Message Endpoints ----

@router.get("/channels/{channel_id}/messages")
async def list_messages(
    channel_id: UUID,
    before: Optional[datetime] = None,
    limit: int = Query(default=50, le=100),
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """
    Paginated messages for a channel, newest-first.
    Cursor-based pagination via `before` (created_at of last message in previous page).
    """
    query = (
        db.table("messages")
        .select("*, message_attachments(*), message_reactions(*), sender:auth.users!sender_id(id, email, raw_user_meta_data)")
        .eq("channel_id", str(channel_id))
        .eq("is_deleted", False)
        .is_("parent_message_id", "null")  # top-level only; threads fetched separately
        .order("created_at", desc=True)
        .limit(limit)
    )
    if before:
        query = query.lt("created_at", before.isoformat())

    result = query.execute()

    # Update last_read_at for caller
    db.table("channel_members").update({"last_read_at": datetime.utcnow().isoformat()}).eq(
        "channel_id", str(channel_id)
    ).eq("user_id", str(user.id)).execute()

    return result.data


@router.post("/channels/{channel_id}/messages", status_code=201)
async def send_message(
    channel_id: UUID,
    payload: MessageCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Send a message. Triggers Supabase Realtime automatically via INSERT."""
    # Verify membership
    membership = (
        db.table("channel_members")
        .select("id")
        .eq("channel_id", str(channel_id))
        .eq("user_id", str(user.id))
        .maybe_single()
        .execute()
    )
    if not membership.data:
        raise HTTPException(403, "Not a member of this channel")

    msg = (
        db.table("messages")
        .insert({
            "org_id": str(user.org_id),
            "channel_id": str(channel_id),
            "sender_id": str(user.id),
            "content": payload.content,
            "type": payload.type,
            "parent_message_id": str(payload.parent_message_id) if payload.parent_message_id else None,
            "metadata": payload.metadata,
        })
        .execute()
    )
    return msg.data[0]


@router.post("/channels/{channel_id}/messages/upload", status_code=201)
async def send_message_with_file(
    channel_id: UUID,
    file: UploadFile = File(...),
    content: str = "",
    parent_message_id: Optional[UUID] = None,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
    r2=Depends(get_r2_client),
):
    """Upload file to R2, create message + attachment record."""
    # Upload to R2
    key = f"messaging/{user.org_id}/{channel_id}/{file.filename}"
    r2.upload_fileobj(file.file, "aekaminc", key)
    file_url = f"https://r2.kartavya.app/{key}"

    msg_type = "image" if file.content_type.startswith("image/") else "file"

    msg = (
        db.table("messages")
        .insert({
            "org_id": str(user.org_id),
            "channel_id": str(channel_id),
            "sender_id": str(user.id),
            "content": content or file.filename,
            "type": msg_type,
            "parent_message_id": str(parent_message_id) if parent_message_id else None,
        })
        .execute()
    )

    db.table("message_attachments").insert({
        "message_id": msg.data[0]["id"],
        "file_name": file.filename,
        "file_url": file_url,
        "file_type": file.content_type,
        "file_size": file.size,
    }).execute()

    return msg.data[0]


@router.patch("/messages/{message_id}")
async def edit_message(
    message_id: UUID,
    payload: MessageEdit,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Edit a message. Only the sender can edit."""
    result = (
        db.table("messages")
        .update({
            "content": payload.content,
            "is_edited": True,
            "updated_at": datetime.utcnow().isoformat(),
        })
        .eq("id", str(message_id))
        .eq("sender_id", str(user.id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Message not found or not authorized")
    return result.data[0]


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: UUID,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Soft-delete a message."""
    result = (
        db.table("messages")
        .update({"is_deleted": True, "content": "[deleted]", "updated_at": datetime.utcnow().isoformat()})
        .eq("id", str(message_id))
        .eq("sender_id", str(user.id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Message not found or not authorized")
    return {"status": "deleted"}


@router.post("/messages/{message_id}/reactions", status_code=201)
async def toggle_reaction(
    message_id: UUID,
    payload: ReactionCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Toggle a reaction: add if absent, remove if present."""
    existing = (
        db.table("message_reactions")
        .select("id")
        .eq("message_id", str(message_id))
        .eq("user_id", str(user.id))
        .eq("emoji", payload.emoji)
        .maybe_single()
        .execute()
    )
    if existing.data:
        db.table("message_reactions").delete().eq("id", existing.data["id"]).execute()
        return {"action": "removed"}
    else:
        db.table("message_reactions").insert({
            "message_id": str(message_id),
            "user_id": str(user.id),
            "emoji": payload.emoji,
        }).execute()
        return {"action": "added"}
```

### 2.2 WhatsApp Business -- `backend/routers/whatsapp.py`

```python
"""
Varta -- WhatsApp Business Router
backend/routers/whatsapp.py
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from uuid import UUID
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from backend.dependencies import get_current_user, get_supabase_service_client, get_supabase_client
from backend.services.whatsapp_provider import get_provider_adapter


router = APIRouter(prefix="/api/v1/whatsapp", tags=["whatsapp"])


# ---- Pydantic Models ----

class AccountConnect(BaseModel):
    provider: str = Field(pattern="^(interakt|wati|meta_cloud)$")
    phone_number: str
    display_name: str
    api_key: str           # encrypted before storage
    webhook_secret: Optional[str] = None

class ReplyCreate(BaseModel):
    content: str
    type: str = Field(default="text", pattern="^(text|image|document|template|interactive)$")
    media_url: Optional[str] = None
    template_name: Optional[str] = None
    template_params: Optional[dict] = None

class TemplateCreate(BaseModel):
    name: str = Field(max_length=100)
    language: str = Field(default="en", max_length=5)
    category: str = Field(pattern="^(marketing|utility|authentication)$")
    header_type: str = Field(default="none", pattern="^(none|text|image|document)$")
    header_content: Optional[str] = None
    body: str
    footer: Optional[str] = None
    buttons: list = Field(default_factory=list)

class BroadcastCreate(BaseModel):
    name: str
    template_id: UUID
    audience_filter: dict = Field(default_factory=dict)
    scheduled_at: Optional[datetime] = None

class AutoReplyCreate(BaseModel):
    trigger_type: str = Field(pattern="^(keyword|first_message|out_of_hours)$")
    trigger_value: Optional[str] = None
    response_type: str = Field(pattern="^(text|template)$")
    response_content: Optional[str] = None
    template_id: Optional[UUID] = None
    is_active: bool = True


# ---- Account Management ----

@router.post("/accounts", status_code=201)
async def connect_account(
    payload: AccountConnect,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Connect a WhatsApp BSP account."""
    from backend.utils.crypto import encrypt_api_key
    encrypted_key = encrypt_api_key(payload.api_key)

    result = (
        db.table("wa_business_accounts")
        .insert({
            "org_id": str(user.org_id),
            "provider": payload.provider,
            "phone_number": payload.phone_number,
            "display_name": payload.display_name,
            "api_key_encrypted": encrypted_key,
            "webhook_secret": payload.webhook_secret,
        })
        .execute()
    )
    return result.data[0]


# ---- Webhook Handler (no auth -- uses webhook_secret) ----

@router.post("/webhook")
async def webhook_handler(
    request: Request,
    db=Depends(get_supabase_service_client),  # service role -- bypasses RLS
):
    """
    Inbound webhook from BSP (Interakt / Wati).
    Flow:
      1. Verify webhook signature via webhook_secret
      2. Parse BSP-specific payload into normalized format
      3. Upsert wa_contact
      4. Find or create wa_conversation
      5. Insert wa_message
      6. Check auto-reply triggers
      7. Supabase Realtime fires automatically on INSERT
    """
    raw_body = await request.body()
    payload = await request.json()

    # Step 1: Determine provider from header or payload structure
    provider = _detect_provider(request.headers, payload)

    # Step 2: Parse into normalized message
    adapter = get_provider_adapter(provider)
    normalized = adapter.parse_inbound_webhook(payload)

    if normalized is None:
        # Status update (delivered/read), not a new message
        if adapter.is_status_update(payload):
            status_data = adapter.parse_status_update(payload)
            db.table("wa_messages").update({
                "status": status_data["status"],
            }).eq("wa_message_id", status_data["wa_message_id"]).execute()
            return {"status": "ok"}
        return {"status": "ignored"}

    # Step 3: Upsert contact
    org_id = normalized["org_id"]
    contact = (
        db.table("wa_contacts")
        .upsert({
            "org_id": org_id,
            "phone_number": normalized["from_number"],
            "name": normalized.get("sender_name"),
            "last_message_at": datetime.utcnow().isoformat(),
        }, on_conflict="org_id,phone_number")
        .execute()
    )
    contact_id = contact.data[0]["id"]

    # Step 4: Find or create conversation
    open_conv = (
        db.table("wa_conversations")
        .select("id")
        .eq("wa_contact_id", contact_id)
        .in_("status", ["open", "pending"])
        .order("started_at", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )
    if open_conv.data:
        conv_id = open_conv.data["id"]
    else:
        new_conv = (
            db.table("wa_conversations")
            .insert({
                "org_id": org_id,
                "wa_contact_id": contact_id,
                "status": "open",
            })
            .execute()
        )
        conv_id = new_conv.data[0]["id"]

    # Step 5: Insert message (triggers Supabase Realtime)
    db.table("wa_messages").insert({
        "org_id": org_id,
        "conversation_id": conv_id,
        "direction": "inbound",
        "wa_message_id": normalized["message_id"],
        "content": normalized.get("text"),
        "type": normalized["type"],
        "media_url": normalized.get("media_url"),
        "status": "delivered",
    }).execute()

    # Step 6: Check auto-reply triggers
    await _check_auto_replies(db, org_id, conv_id, normalized)

    return {"status": "ok"}


async def _check_auto_replies(db, org_id: str, conv_id: str, normalized: dict):
    """Fire auto-reply if a trigger matches."""
    rules = (
        db.table("wa_auto_replies")
        .select("*")
        .eq("org_id", org_id)
        .eq("is_active", True)
        .execute()
    )
    for rule in rules.data:
        matched = False
        if rule["trigger_type"] == "keyword" and rule["trigger_value"]:
            if rule["trigger_value"].lower() in (normalized.get("text") or "").lower():
                matched = True
        elif rule["trigger_type"] == "first_message":
            # Check if this is the first message in the conversation
            msg_count = (
                db.table("wa_messages")
                .select("id", count="exact")
                .eq("conversation_id", conv_id)
                .execute()
            )
            if msg_count.count <= 1:
                matched = True
        # out_of_hours: check current time against org business hours (not shown for brevity)

        if matched:
            response_text = rule["response_content"] or ""
            if rule["response_type"] == "template" and rule["template_id"]:
                # Send template via BSP adapter
                pass  # Handled by provider adapter
            else:
                db.table("wa_messages").insert({
                    "org_id": org_id,
                    "conversation_id": conv_id,
                    "direction": "outbound",
                    "content": response_text,
                    "type": "text",
                    "status": "sent",
                }).execute()
            break  # Only fire first matching rule


def _detect_provider(headers, payload) -> str:
    """Detect BSP provider from webhook headers or payload shape."""
    if "x-interakt-signature" in headers:
        return "interakt"
    if "x-wati-signature" in headers:
        return "wati"
    return "meta_cloud"


# ---- Conversation Inbox ----

@router.get("/conversations")
async def list_conversations(
    status: Optional[str] = Query(default=None, pattern="^(open|pending|resolved)$"),
    assigned_to: Optional[UUID] = None,
    limit: int = Query(default=25, le=100),
    offset: int = 0,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """List WhatsApp conversations (inbox) with filters."""
    query = (
        db.table("wa_conversations")
        .select("*, wa_contact:wa_contacts(*), last_message:wa_messages(content, type, created_at, direction)")
        .eq("org_id", str(user.org_id))
        .order("started_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if status:
        query = query.eq("status", status)
    if assigned_to:
        query = query.eq("assigned_to", str(assigned_to))

    result = query.execute()
    return result.data


@router.post("/conversations/{conversation_id}/reply", status_code=201)
async def reply_to_conversation(
    conversation_id: UUID,
    payload: ReplyCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Send a reply in a WhatsApp conversation via the BSP."""
    # Get conversation + account info
    conv = (
        db.table("wa_conversations")
        .select("*, wa_contact:wa_contacts(*)")
        .eq("id", str(conversation_id))
        .single()
        .execute()
    )
    if not conv.data:
        raise HTTPException(404, "Conversation not found")

    account = (
        db.table("wa_business_accounts")
        .select("*")
        .eq("org_id", str(user.org_id))
        .eq("status", "active")
        .limit(1)
        .single()
        .execute()
    )
    if not account.data:
        raise HTTPException(400, "No active WhatsApp account")

    # Send via BSP adapter
    from backend.utils.crypto import decrypt_api_key
    adapter = get_provider_adapter(account.data["provider"])
    api_key = decrypt_api_key(account.data["api_key_encrypted"])

    bsp_response = await adapter.send_message(
        api_key=api_key,
        to_number=conv.data["wa_contact"]["phone_number"],
        content=payload.content,
        msg_type=payload.type,
        media_url=payload.media_url,
        template_name=payload.template_name,
        template_params=payload.template_params,
    )

    # Record in DB (triggers Realtime)
    msg = (
        db.table("wa_messages")
        .insert({
            "org_id": str(user.org_id),
            "conversation_id": str(conversation_id),
            "direction": "outbound",
            "wa_message_id": bsp_response.get("message_id"),
            "content": payload.content,
            "type": payload.type,
            "media_url": payload.media_url,
            "template_name": payload.template_name,
            "template_params": payload.template_params,
            "status": "sent",
        })
        .execute()
    )
    return msg.data[0]


# ---- Templates ----

@router.get("/templates")
async def list_templates(
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    result = db.table("wa_templates").select("*").eq("org_id", str(user.org_id)).execute()
    return result.data


@router.post("/templates", status_code=201)
async def create_template(
    payload: TemplateCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """Create a template locally (status=pending). Submit to BSP for approval separately."""
    result = (
        db.table("wa_templates")
        .insert({
            "org_id": str(user.org_id),
            "name": payload.name,
            "language": payload.language,
            "category": payload.category,
            "header_type": payload.header_type,
            "header_content": payload.header_content,
            "body": payload.body,
            "footer": payload.footer,
            "buttons": payload.buttons,
        })
        .execute()
    )
    return result.data[0]


# ---- Broadcasts ----

@router.post("/broadcasts", status_code=201)
async def create_broadcast(
    payload: BroadcastCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    result = (
        db.table("wa_broadcasts")
        .insert({
            "org_id": str(user.org_id),
            "name": payload.name,
            "template_id": str(payload.template_id),
            "audience_filter": payload.audience_filter,
            "scheduled_at": payload.scheduled_at.isoformat() if payload.scheduled_at else None,
            "status": "scheduled" if payload.scheduled_at else "draft",
        })
        .execute()
    )
    return result.data[0]


@router.post("/broadcasts/{broadcast_id}/send")
async def send_broadcast(
    broadcast_id: UUID,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    """
    Kick off a broadcast send.
    In production this enqueues a background job (e.g. Railway cron / Celery).
    Simplified inline version shown here.
    """
    broadcast = (
        db.table("wa_broadcasts")
        .select("*, template:wa_templates(*)")
        .eq("id", str(broadcast_id))
        .eq("org_id", str(user.org_id))
        .single()
        .execute()
    )
    if not broadcast.data:
        raise HTTPException(404, "Broadcast not found")
    if broadcast.data["status"] not in ("draft", "scheduled"):
        raise HTTPException(400, "Broadcast already sent or sending")

    # Mark as sending
    db.table("wa_broadcasts").update({"status": "sending"}).eq("id", str(broadcast_id)).execute()

    # Resolve audience
    audience_query = db.table("wa_contacts").select("*").eq("org_id", str(user.org_id)).eq("opted_in", True)
    # Apply audience_filter (tags, etc.) -- simplified
    contacts = audience_query.execute()

    db.table("wa_broadcasts").update({"total_recipients": len(contacts.data)}).eq("id", str(broadcast_id)).execute()

    # Send via BSP adapter (should be a background job)
    # ... omitted: loop contacts, call adapter.send_template(), track delivery ...

    db.table("wa_broadcasts").update({"status": "sent"}).eq("id", str(broadcast_id)).execute()
    return {"status": "sending", "total_recipients": len(contacts.data)}


# ---- Auto-Replies ----

@router.get("/auto-replies")
async def list_auto_replies(
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    result = db.table("wa_auto_replies").select("*").eq("org_id", str(user.org_id)).execute()
    return result.data


@router.post("/auto-replies", status_code=201)
async def create_auto_reply(
    payload: AutoReplyCreate,
    user=Depends(get_current_user),
    db=Depends(get_supabase_client),
):
    result = (
        db.table("wa_auto_replies")
        .insert({
            "org_id": str(user.org_id),
            "trigger_type": payload.trigger_type,
            "trigger_value": payload.trigger_value,
            "response_type": payload.response_type,
            "response_content": payload.response_content,
            "template_id": str(payload.template_id) if payload.template_id else None,
            "is_active": payload.is_active,
        })
        .execute()
    )
    return result.data[0]
```

### 2.3 Provider Adapter Interface -- `backend/services/whatsapp_provider.py`

```python
"""
WhatsApp BSP Provider Adapter
backend/services/whatsapp_provider.py

Abstracts BSP differences behind a common interface.
Phase 2-4: Interakt / Wati adapters.
Phase 5: Meta Cloud API adapter swapped in.
"""

from abc import ABC, abstractmethod
from typing import Optional


class WhatsAppProviderAdapter(ABC):
    """Common interface for all WhatsApp BSP providers."""

    @abstractmethod
    def parse_inbound_webhook(self, payload: dict) -> Optional[dict]:
        """
        Parse BSP webhook into normalized format:
        {
            "org_id": str,
            "from_number": str (E.164),
            "sender_name": str | None,
            "message_id": str,
            "type": "text" | "image" | "document" | "location" | "interactive",
            "text": str | None,
            "media_url": str | None,
        }
        Returns None if not an inbound message (e.g., status callback).
        """
        ...

    @abstractmethod
    def is_status_update(self, payload: dict) -> bool:
        ...

    @abstractmethod
    def parse_status_update(self, payload: dict) -> dict:
        """Returns {"wa_message_id": str, "status": "delivered"|"read"|"failed"}"""
        ...

    @abstractmethod
    async def send_message(
        self,
        api_key: str,
        to_number: str,
        content: str,
        msg_type: str = "text",
        media_url: Optional[str] = None,
        template_name: Optional[str] = None,
        template_params: Optional[dict] = None,
    ) -> dict:
        """Send a message via the BSP. Returns {"message_id": str}."""
        ...

    @abstractmethod
    async def submit_template(self, api_key: str, template: dict) -> dict:
        """Submit a template for approval. Returns {"meta_template_id": str, "status": str}."""
        ...


class InteraktAdapter(WhatsAppProviderAdapter):
    """Interakt BSP adapter. Docs: https://docs.interakt.ai"""

    BASE_URL = "https://api.interakt.ai/v1"

    def parse_inbound_webhook(self, payload: dict) -> Optional[dict]:
        # Interakt sends: {"data": {"customer": {"phone_number": ...}, "message": {...}}}
        data = payload.get("data", {})
        message = data.get("message", {})
        if not message:
            return None

        customer = data.get("customer", {})
        return {
            "org_id": data.get("business_account_id"),  # mapped to org_id via wa_business_accounts
            "from_number": f"+{customer.get('phone_number', '')}",
            "sender_name": customer.get("name"),
            "message_id": message.get("id"),
            "type": message.get("type", "text"),
            "text": message.get("text", {}).get("body") if message.get("type") == "text" else None,
            "media_url": message.get("media", {}).get("url"),
        }

    def is_status_update(self, payload: dict) -> bool:
        return payload.get("type") == "message_status"

    def parse_status_update(self, payload: dict) -> dict:
        data = payload.get("data", {})
        status_map = {"sent": "sent", "delivered": "delivered", "read": "read", "failed": "failed"}
        return {
            "wa_message_id": data.get("message_id"),
            "status": status_map.get(data.get("status"), "sent"),
        }

    async def send_message(self, api_key, to_number, content, msg_type="text", **kwargs) -> dict:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.BASE_URL}/public/message/",
                headers={"Authorization": f"Basic {api_key}"},
                json={
                    "countryCode": to_number[:3].replace("+", ""),
                    "phoneNumber": to_number[3:],
                    "callbackData": "",
                    "type": "Text",
                    "data": {"message": content},
                },
            )
            resp.raise_for_status()
            return {"message_id": resp.json().get("id")}

    async def submit_template(self, api_key, template) -> dict:
        # Interakt template submission -- provider-specific
        raise NotImplementedError("Template submission via Interakt dashboard")


class WatiAdapter(WhatsAppProviderAdapter):
    """Wati BSP adapter. Docs: https://docs.wati.io"""

    def __init__(self, base_url: str = "https://live-server-X.wati.io"):
        self.base_url = base_url

    def parse_inbound_webhook(self, payload: dict) -> Optional[dict]:
        # Wati sends: {"waId": "91...", "text": "...", "type": "text", ...}
        if payload.get("eventType") != "message":
            return None
        return {
            "org_id": payload.get("accountId"),
            "from_number": f"+{payload.get('waId', '')}",
            "sender_name": payload.get("senderName"),
            "message_id": payload.get("id"),
            "type": payload.get("type", "text"),
            "text": payload.get("text"),
            "media_url": payload.get("data", {}).get("media", {}).get("url"),
        }

    def is_status_update(self, payload: dict) -> bool:
        return payload.get("eventType") == "message_status"

    def parse_status_update(self, payload: dict) -> dict:
        return {
            "wa_message_id": payload.get("id"),
            "status": payload.get("status", "sent"),
        }

    async def send_message(self, api_key, to_number, content, msg_type="text", **kwargs) -> dict:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/sendSessionMessage/{to_number.replace('+', '')}",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"messageText": content},
            )
            resp.raise_for_status()
            return {"message_id": resp.json().get("result", {}).get("id")}

    async def submit_template(self, api_key, template) -> dict:
        raise NotImplementedError("Template submission via Wati dashboard")


class MetaCloudAdapter(WhatsAppProviderAdapter):
    """
    Meta Cloud API v21.0 adapter (Phase 5).
    Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
    """

    GRAPH_URL = "https://graph.facebook.com/v21.0"

    def parse_inbound_webhook(self, payload: dict) -> Optional[dict]:
        # Meta webhook: {"entry": [{"changes": [{"value": {"messages": [...]}}]}]}
        try:
            entry = payload["entry"][0]
            change = entry["changes"][0]["value"]
            msg = change["messages"][0]
            contact = change["contacts"][0]
        except (KeyError, IndexError):
            return None

        type_map = {"text": "text", "image": "image", "document": "document",
                     "location": "location", "interactive": "interactive"}

        return {
            "org_id": change.get("metadata", {}).get("phone_number_id"),
            "from_number": f"+{msg['from']}",
            "sender_name": contact.get("profile", {}).get("name"),
            "message_id": msg["id"],
            "type": type_map.get(msg["type"], "text"),
            "text": msg.get("text", {}).get("body") if msg["type"] == "text" else None,
            "media_url": None,  # Media requires separate download call
        }

    def is_status_update(self, payload: dict) -> bool:
        try:
            change = payload["entry"][0]["changes"][0]["value"]
            return "statuses" in change
        except (KeyError, IndexError):
            return False

    def parse_status_update(self, payload: dict) -> dict:
        status_entry = payload["entry"][0]["changes"][0]["value"]["statuses"][0]
        return {
            "wa_message_id": status_entry["id"],
            "status": status_entry["status"],
        }

    async def send_message(self, api_key, to_number, content, msg_type="text",
                           media_url=None, template_name=None, template_params=None) -> dict:
        import httpx

        if template_name:
            body = {
                "messaging_product": "whatsapp",
                "to": to_number.replace("+", ""),
                "type": "template",
                "template": {
                    "name": template_name,
                    "language": {"code": "en"},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": v} for v in (template_params or {}).values()]}
                    ] if template_params else [],
                },
            }
        else:
            body = {
                "messaging_product": "whatsapp",
                "to": to_number.replace("+", ""),
                "type": "text",
                "text": {"body": content},
            }

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.GRAPH_URL}/PHONE_NUMBER_ID/messages",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
            )
            resp.raise_for_status()
            return {"message_id": resp.json()["messages"][0]["id"]}

    async def submit_template(self, api_key, template) -> dict:
        import httpx
        body = {
            "name": template["name"],
            "language": template["language"],
            "category": template["category"].upper(),
            "components": [],
        }
        if template.get("header_type") != "none":
            body["components"].append({
                "type": "HEADER",
                "format": template["header_type"].upper(),
                "text": template.get("header_content"),
            })
        body["components"].append({"type": "BODY", "text": template["body"]})
        if template.get("footer"):
            body["components"].append({"type": "FOOTER", "text": template["footer"]})

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.GRAPH_URL}/WABA_ID/message_templates",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
            return {"meta_template_id": data["id"], "status": data["status"]}


# ---- Factory ----

_ADAPTERS = {
    "interakt": InteraktAdapter,
    "wati": WatiAdapter,
    "meta_cloud": MetaCloudAdapter,
}

def get_provider_adapter(provider: str) -> WhatsAppProviderAdapter:
    cls = _ADAPTERS.get(provider)
    if not cls:
        raise ValueError(f"Unknown WhatsApp provider: {provider}")
    return cls()
```

---

## 3. Frontend Components

### 3.1 Component Tree

```
src/
  pages/
    MessagingPage.jsx          # Samvada main layout
    WhatsAppPage.jsx           # Varta main layout
  components/
    messaging/
      ChannelList.jsx          # Sidebar: channel list + search
      ChannelView.jsx          # Main chat area for selected channel
      MessageBubble.jsx        # Single message with reactions, edit, delete
      MessageInput.jsx         # Composer with file upload (R2)
      ThreadView.jsx           # Slide-out thread panel
    whatsapp/
      WAInbox.jsx              # Conversation list with filters
      WAChat.jsx               # Chat view for a single WA conversation
      WATemplateManager.jsx    # CRUD for message templates
      WABroadcastBuilder.jsx   # Create + send broadcasts
      WAAutoReplyConfig.jsx    # Manage auto-reply rules
      WAAccountSetup.jsx       # Connect BSP account wizard
  hooks/
    useMessaging.js            # Internal messaging data + Realtime
    useWhatsApp.js             # WhatsApp data + Realtime
```

### 3.2 MessagingPage.jsx (Samvada)

```jsx
// src/pages/MessagingPage.jsx

import { useState } from "react";
import ChannelList from "../components/messaging/ChannelList";
import ChannelView from "../components/messaging/ChannelView";
import ThreadView from "../components/messaging/ThreadView";
import { useMessaging } from "../hooks/useMessaging";

export default function MessagingPage() {
  const [selectedChannelId, setSelectedChannelId] = useState(null);
  const [activeThread, setActiveThread] = useState(null); // parent message ID

  const { channels, loading } = useMessaging();

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <div className="w-64 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto">
        <ChannelList
          channels={channels}
          loading={loading}
          selectedId={selectedChannelId}
          onSelect={(id) => {
            setSelectedChannelId(id);
            setActiveThread(null);
          }}
        />
      </div>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedChannelId ? (
          <ChannelView
            channelId={selectedChannelId}
            onThreadOpen={(msgId) => setActiveThread(msgId)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a channel to start messaging
          </div>
        )}
      </div>

      {/* Thread Panel */}
      {activeThread && (
        <div className="w-96 border-l border-gray-200 flex-shrink-0">
          <ThreadView
            parentMessageId={activeThread}
            onClose={() => setActiveThread(null)}
          />
        </div>
      )}
    </div>
  );
}
```

### 3.3 WhatsAppPage.jsx (Varta)

```jsx
// src/pages/WhatsAppPage.jsx

import { useState } from "react";
import WAInbox from "../components/whatsapp/WAInbox";
import WAChat from "../components/whatsapp/WAChat";
import WATemplateManager from "../components/whatsapp/WATemplateManager";
import WABroadcastBuilder from "../components/whatsapp/WABroadcastBuilder";
import WAAutoReplyConfig from "../components/whatsapp/WAAutoReplyConfig";
import WAAccountSetup from "../components/whatsapp/WAAccountSetup";
import { useWhatsApp } from "../hooks/useWhatsApp";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "templates", label: "Templates" },
  { key: "broadcasts", label: "Broadcasts" },
  { key: "auto-replies", label: "Auto-Replies" },
  { key: "settings", label: "Settings" },
];

export default function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState("inbox");
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const { account, conversations, loading } = useWhatsApp();

  if (!account) {
    return <WAAccountSetup />;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Tab Bar */}
      <div className="border-b border-gray-200 bg-white px-6">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSelectedConversationId(null);
              }}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "inbox" && (
          <div className="flex h-full">
            <div className="w-80 border-r border-gray-200 overflow-y-auto">
              <WAInbox
                conversations={conversations}
                selectedId={selectedConversationId}
                onSelect={setSelectedConversationId}
              />
            </div>
            <div className="flex-1">
              {selectedConversationId ? (
                <WAChat conversationId={selectedConversationId} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400 h-full">
                  Select a conversation
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === "templates" && <WATemplateManager />}
        {activeTab === "broadcasts" && <WABroadcastBuilder />}
        {activeTab === "auto-replies" && <WAAutoReplyConfig />}
        {activeTab === "settings" && <WAAccountSetup existingAccount={account} />}
      </div>
    </div>
  );
}
```

### 3.4 useMessaging.js (Hook with Supabase Realtime)

```js
// src/hooks/useMessaging.js

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import api from "../lib/api";

export function useMessaging() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/v1/messaging/channels");
      setChannels(data);
    } finally {
      setLoading(false);
    }
  };

  return { channels, loading, refresh: loadChannels };
}

export function useChannelMessages(channelId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const subscriptionRef = useRef(null);

  // Load initial messages
  useEffect(() => {
    if (!channelId) return;
    loadMessages();
    subscribeToRealtime();

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [channelId]);

  const loadMessages = async (before = null) => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (before) params.before = before;
      const { data } = await api.get(
        `/api/v1/messaging/channels/${channelId}/messages`,
        { params }
      );
      if (before) {
        setMessages((prev) => [...prev, ...data]);
      } else {
        setMessages(data);
      }
      setHasMore(data.length === 50);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToRealtime = () => {
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          setMessages((prev) => [payload.new, ...prev]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m))
          );
        }
      )
      .subscribe();

    subscriptionRef.current = channel;
  };

  const sendMessage = useCallback(
    async (content, type = "text", parentMessageId = null) => {
      await api.post(`/api/v1/messaging/channels/${channelId}/messages`, {
        content,
        type,
        parent_message_id: parentMessageId,
      });
      // No need to manually update -- Realtime INSERT fires
    },
    [channelId]
  );

  const loadMore = useCallback(() => {
    if (!hasMore || loading || messages.length === 0) return;
    const oldest = messages[messages.length - 1];
    loadMessages(oldest.created_at);
  }, [hasMore, loading, messages]);

  return { messages, loading, hasMore, sendMessage, loadMore };
}
```

### 3.5 useWhatsApp.js (Hook with Supabase Realtime)

```js
// src/hooks/useWhatsApp.js

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import api from "../lib/api";

export function useWhatsApp() {
  const [account, setAccount] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAccount();
    loadConversations();
    subscribeToConversations();
  }, []);

  const loadAccount = async () => {
    try {
      const { data } = await api.get("/api/v1/whatsapp/accounts");
      setAccount(data?.[0] || null);
    } catch {
      setAccount(null);
    }
  };

  const loadConversations = async (status = null) => {
    setLoading(true);
    try {
      const params = {};
      if (status) params.status = status;
      const { data } = await api.get("/api/v1/whatsapp/conversations", { params });
      setConversations(data);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToConversations = () => {
    supabase
      .channel("wa_conversations_updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_conversations" },
        () => {
          // Reload conversations on any change
          loadConversations();
        }
      )
      .subscribe();
  };

  return { account, conversations, loading, refresh: loadConversations };
}

export function useWAConversationMessages(conversationId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const subscriptionRef = useRef(null);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages();
    subscribeToMessages();

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [conversationId]);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(
        `/api/v1/whatsapp/conversations/${conversationId}/messages`
      );
      setMessages(data);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToMessages = () => {
    const channel = supabase
      .channel(`wa_messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wa_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wa_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m))
          );
        }
      )
      .subscribe();

    subscriptionRef.current = channel;
  };

  const sendReply = useCallback(
    async (content, type = "text", options = {}) => {
      await api.post(`/api/v1/whatsapp/conversations/${conversationId}/reply`, {
        content,
        type,
        ...options,
      });
    },
    [conversationId]
  );

  return { messages, loading, sendReply };
}
```

---

## 4. Realtime Setup

### 4.1 Supabase Configuration

Enable Realtime on the required tables (already in the migration):

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE wa_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE wa_conversations;
```

### 4.2 Realtime RLS

Supabase Realtime respects RLS policies. Users only receive changes for rows matching their `org_id`. No additional filtering is needed on the client beyond subscribing to the correct channel/conversation.

### 4.3 Channel Naming Convention

| Supabase Channel | Filter | Purpose |
|---|---|---|
| `messages:{channel_id}` | `channel_id=eq.{id}` | Internal chat live updates |
| `wa_messages:{conversation_id}` | `conversation_id=eq.{id}` | WA chat live updates |
| `wa_conversations_updates` | (all, org-scoped by RLS) | Inbox list refresh |

### 4.4 Connection Management

- Subscribe on component mount, unsubscribe on unmount.
- Single Supabase client instance shared via `src/lib/supabaseClient.js`.
- Reconnect handling is built into `@supabase/supabase-js` v2.

---

## 5. BSP Integration Details

### 5.1 Interakt

| Item | Detail |
|---|---|
| Docs | https://docs.interakt.ai |
| Auth | HTTP Basic with API key |
| Webhook | Configure callback URL in Interakt dashboard |
| Webhook verification | HMAC-SHA256 via `x-interakt-signature` header |
| Send message | `POST /v1/public/message/` |
| Template submission | Via Interakt dashboard (no API) |
| Pricing | Per-conversation (Meta pricing + markup) |

### 5.2 Wati

| Item | Detail |
|---|---|
| Docs | https://docs.wati.io |
| Auth | Bearer token |
| Webhook | Configure callback URL in Wati dashboard |
| Webhook verification | `x-wati-signature` header |
| Send session message | `POST /api/v1/sendSessionMessage/{waId}` |
| Send template | `POST /api/v1/sendTemplateMessage/{waId}` |
| Template submission | Via Wati dashboard or API |
| Pricing | Monthly plan + per-conversation |

### 5.3 Webhook Endpoint Configuration

Railway deployment URL pattern:
```
https://kartavya-api.up.railway.app/api/v1/whatsapp/webhook
```

Webhook security:
1. Verify the HMAC signature using the `webhook_secret` stored in `wa_business_accounts`.
2. Respond with HTTP 200 within 5 seconds (process async if heavy).
3. Idempotency: use `wa_message_id` to deduplicate on retry.

### 5.4 Webhook Signature Verification

```python
# backend/utils/webhook_verify.py

import hmac
import hashlib

def verify_interakt_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def verify_wati_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

---

## 6. Migration Path: BSP to Meta Cloud API (Phase 5)

### 6.1 Strategy

The `wa_business_accounts.provider` field governs which adapter handles each org. Migration is per-org, not platform-wide.

Steps:
1. Org applies for Meta Business Verification and WhatsApp Business API access.
2. Meta issues a Phone Number ID and permanent access token.
3. Admin changes provider from `interakt`/`wati` to `meta_cloud` in account settings.
4. New `api_key_encrypted` stores the Meta permanent token.
5. Webhook URL reconfigured in Meta App Dashboard to point at the same `/api/v1/whatsapp/webhook` endpoint.
6. The `_detect_provider` function routes to `MetaCloudAdapter`.

### 6.2 Data Continuity

- `wa_contacts`, `wa_conversations`, `wa_messages` remain untouched. They are provider-agnostic.
- `wa_message_id` format changes (BSP IDs vs Meta IDs). No conflict since new messages get new IDs.
- Templates must be re-submitted via Meta Graph API. Old `meta_template_id` values are replaced.

### 6.3 Meta Cloud API Requirements

| Requirement | Detail |
|---|---|
| Meta Business Verification | Required for official Business Account |
| App Review | WhatsApp Business Management permission |
| Webhook | Must respond to Meta verification challenge (`GET` with `hub.verify_token`) |
| Rate Limits | Tier-based: 250 / 1K / 10K / 100K messages per day |
| 24-hour window | Free-form replies only within 24h of last customer message; otherwise template required |
| Media hosting | Media must be uploaded via Graph API; URLs returned |

### 6.4 Webhook Verification Challenge (Meta)

```python
# Add to whatsapp.py router

@router.get("/webhook")
async def webhook_verify(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
):
    """Meta Cloud API webhook verification challenge."""
    VERIFY_TOKEN = os.getenv("META_WEBHOOK_VERIFY_TOKEN")
    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        return int(hub_challenge)
    raise HTTPException(403, "Verification failed")
```

---

## 7. Implementation Steps (Sprint-by-Sprint)

### Phase 1: Samvada -- Internal Messaging (Week 1-2)

**Week 1:**
- [ ] Run `013_whatsapp_module.sql` migration (Samvada tables only)
- [ ] Implement `backend/routers/messaging.py` with channel CRUD, member management, message send/list
- [ ] Build `ChannelList.jsx`, `ChannelView.jsx`, `MessageBubble.jsx`, `MessageInput.jsx`
- [ ] Wire up `useMessaging.js` hook with basic fetch
- [ ] Enable Supabase Realtime on `messages` table

**Week 2:**
- [ ] Add thread support (`parent_message_id` filtering, `ThreadView.jsx`)
- [ ] Implement reactions (`message_reactions` table, toggle endpoint)
- [ ] File upload to R2 via `MessageInput.jsx` + `/messages/upload` endpoint
- [ ] Read receipts (`message_read_receipts` + `last_read_at` on `channel_members`)
- [ ] Unread count badges on `ChannelList.jsx`
- [ ] DM channel creation (auto-create private channel for 2 users)

### Phase 2: WhatsApp BSP Integration (Week 3)

- [ ] Run remaining migration (Varta tables)
- [ ] Implement `backend/services/whatsapp_provider.py` (Interakt adapter first)
- [ ] Build `backend/routers/whatsapp.py`: account connect, webhook handler, conversation list, reply
- [ ] `WAAccountSetup.jsx`: wizard to enter API key, phone number, provider selection
- [ ] `WAInbox.jsx` + `WAChat.jsx`: conversation list and chat view
- [ ] Deploy webhook endpoint, configure in Interakt/Wati dashboard
- [ ] Test end-to-end: send message from phone, see in Varta inbox, reply from Varta

### Phase 3: Templates, Broadcasts, Auto-Replies (Week 4)

- [ ] `WATemplateManager.jsx`: create templates with header/body/footer/buttons preview
- [ ] Template submission flow (manual for Interakt, API for Wati if available)
- [ ] Template status sync (poll BSP or webhook for approval status)
- [ ] `WABroadcastBuilder.jsx`: select template, define audience filter, schedule
- [ ] Broadcast send endpoint (background job on Railway)
- [ ] Delivery tracking: update `delivered`, `read_count`, `failed` counters from status webhooks
- [ ] `WAAutoReplyConfig.jsx`: keyword, first-message, out-of-hours rules
- [ ] Auto-reply trigger matching in webhook handler

### Phase 4: CRM Integration (Week 5-6)

- [ ] Link `wa_contacts.crm_contact_id` to existing `crm_contacts` table
- [ ] Auto-create CRM contact on first WhatsApp message (configurable)
- [ ] Show CRM contact card in `WAChat.jsx` sidebar (deals, notes, tags)
- [ ] Log WhatsApp conversations as CRM activities
- [ ] WhatsApp-sourced lead creation: new inbound conversation creates a CRM lead
- [ ] Contact merge: link existing CRM contact to WhatsApp number

### Phase 5: Meta Cloud API Migration (Week 7)

- [ ] Implement `MetaCloudAdapter` in `whatsapp_provider.py`
- [ ] Add Meta webhook verification challenge (`GET /webhook`)
- [ ] Template submission via Graph API
- [ ] Media upload/download via Graph API
- [ ] Account settings UI to switch provider from BSP to `meta_cloud`
- [ ] Test with Meta test phone number
- [ ] Document migration runbook for orgs switching providers

---

## 8. Test Cases

### 8.1 Internal Messaging (Samvada)

| # | Test | Method | Expected |
|---|---|---|---|
| S1 | Create public channel | `POST /channels` with type=public | 201, channel returned with org_id |
| S2 | Create private channel, add member | `POST /channels` then `POST /channels/{id}/members` | Member added, non-members cannot see messages |
| S3 | Send text message | `POST /channels/{id}/messages` | 201, message appears via Realtime |
| S4 | Send message with file | `POST /channels/{id}/messages/upload` with file | File uploaded to R2, attachment record created |
| S5 | Edit message | `PATCH /messages/{id}` | Content updated, `is_edited=true` |
| S6 | Delete message | `DELETE /messages/{id}` | `is_deleted=true`, content replaced with `[deleted]` |
| S7 | Toggle reaction | `POST /messages/{id}/reactions` twice with same emoji | First: added, Second: removed |
| S8 | Thread reply | `POST /channels/{id}/messages` with `parent_message_id` | Message linked to thread, excluded from main feed |
| S9 | Message ordering | Send 3 messages, fetch | Returned newest-first, correct `created_at` ordering |
| S10 | Pagination | Fetch with `before` cursor | Older messages returned, `hasMore` correct |
| S11 | Realtime delivery | Send message from user A | User B subscribed to channel receives INSERT event |
| S12 | RLS isolation | User from org B queries channels | Empty result, no cross-org leakage |

### 8.2 WhatsApp Business (Varta)

| # | Test | Method | Expected |
|---|---|---|---|
| W1 | Connect BSP account | `POST /accounts` | Account created with encrypted API key |
| W2 | Webhook -- Interakt inbound text | `POST /webhook` with Interakt payload | Contact upserted, conversation opened, message inserted |
| W3 | Webhook -- Wati inbound image | `POST /webhook` with Wati image payload | Message type=image, media_url stored |
| W4 | Webhook -- status update (delivered) | `POST /webhook` with status payload | Existing wa_message status updated to `delivered` |
| W5 | Webhook -- deduplication | Same `wa_message_id` sent twice | Only one message record (unique constraint or check) |
| W6 | Reply to conversation | `POST /conversations/{id}/reply` | Outbound message sent via BSP, recorded in DB |
| W7 | Conversation inbox filters | `GET /conversations?status=open` | Only open conversations returned |
| W8 | Create template | `POST /templates` | Template with status=pending |
| W9 | Template approval sync | Mock BSP callback with approved status | `wa_templates.status` updated to `approved` |
| W10 | Create broadcast | `POST /broadcasts` with template + audience | Broadcast created with status=draft |
| W11 | Send broadcast | `POST /broadcasts/{id}/send` | Status transitions: draft -> sending -> sent; counters updated |
| W12 | Broadcast delivery tracking | Status webhooks for broadcast messages | `delivered`, `read_count`, `failed` counters increment |
| W13 | Auto-reply -- keyword | Inbound message containing keyword | Auto-reply outbound message inserted |
| W14 | Auto-reply -- first message | New contact sends first message | Welcome auto-reply fired |
| W15 | Auto-reply -- only first match | Multiple rules match | Only first matching rule fires |
| W16 | Realtime -- inbox update | Inbound message creates new conversation | WAInbox refreshes via Realtime subscription |
| W17 | Provider switch | Change account provider to meta_cloud | Subsequent sends use MetaCloudAdapter |
| W18 | Meta webhook verify | `GET /webhook?hub.mode=subscribe&...` | Returns hub.challenge as integer |

### 8.3 Running Tests

```bash
# Backend (pytest)
cd backend
pytest tests/test_messaging.py -v
pytest tests/test_whatsapp.py -v
pytest tests/test_whatsapp_webhook.py -v    # webhook parsing for each BSP format
pytest tests/test_whatsapp_provider.py -v   # adapter unit tests

# Frontend (React Testing Library)
cd frontend
npm test -- --testPathPattern=messaging
npm test -- --testPathPattern=whatsapp
```

---

## Appendix A: Environment Variables

```env
# .env (Railway backend)

# Supabase
SUPABASE_URL=https://efzzjcnpjigeffkiissb.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
SUPABASE_ANON_KEY=<anon_key>

# Cloudflare R2
R2_ACCESS_KEY_ID=<r2_access_key>
R2_SECRET_ACCESS_KEY=<r2_secret>
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET=aekaminc

# WhatsApp (Phase 5 only)
META_WEBHOOK_VERIFY_TOKEN=<random_token>

# Encryption key for API keys at rest
ENCRYPTION_KEY=<32_byte_hex>
```

## Appendix B: API Key Encryption

```python
# backend/utils/crypto.py

from cryptography.fernet import Fernet
import os

_fernet = Fernet(os.environ["ENCRYPTION_KEY"].encode())

def encrypt_api_key(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()

def decrypt_api_key(encrypted: str) -> str:
    return _fernet.decrypt(encrypted.encode()).decode()
```

## Appendix C: File Upload to R2

R2 path convention for messaging attachments:

```
messaging/{org_id}/{channel_id}/{timestamp}_{filename}
whatsapp/{org_id}/{conversation_id}/{timestamp}_{filename}
```

Use presigned URLs for direct browser upload when files exceed 5MB. For smaller files, proxy through the FastAPI endpoint.
