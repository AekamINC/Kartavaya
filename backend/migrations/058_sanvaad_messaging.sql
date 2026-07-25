-- 058: Sanvaad (संवाद) — Internal messaging (Samvada) + WhatsApp (Varta)
-- Phase 1: Samvada internal messaging tables
-- Phase 2: Varta WhatsApp Business tables

BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- Phase 1: Samvada — Internal messaging
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.samvada_channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public','private','dm')),
    created_by  TEXT NOT NULL DEFAULT '',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.samvada_channel_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES staging.samvada_channels(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    muted       BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS staging.samvada_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    channel_id        UUID NOT NULL REFERENCES staging.samvada_channels(id) ON DELETE CASCADE,
    sender_id         TEXT NOT NULL,
    content           TEXT NOT NULL DEFAULT '',
    type              TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','file','system')),
    parent_message_id UUID REFERENCES staging.samvada_messages(id) ON DELETE SET NULL,
    metadata          JSONB NOT NULL DEFAULT '{}',
    is_edited         BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.samvada_message_attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES staging.samvada_messages(id) ON DELETE CASCADE,
    file_name   TEXT NOT NULL DEFAULT '',
    file_url    TEXT NOT NULL DEFAULT '',
    file_type   TEXT NOT NULL DEFAULT '',
    file_size   BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.samvada_message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES staging.samvada_messages(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS staging.samvada_read_receipts (
    message_id  UUID NOT NULL REFERENCES staging.samvada_messages(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_samvada_channels_org ON staging.samvada_channels(org_id);
CREATE INDEX IF NOT EXISTS idx_samvada_messages_channel_time ON staging.samvada_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_samvada_messages_thread ON staging.samvada_messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_samvada_channel_members_user ON staging.samvada_channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_samvada_messages_org ON staging.samvada_messages(org_id);

-- Enable Supabase Realtime on messages table
ALTER PUBLICATION supabase_realtime ADD TABLE staging.samvada_messages;

-- ═══════════════════════════════════════════════════════════════
-- Phase 2: Varta — WhatsApp Business
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.varta_business_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL DEFAULT 'meta_cloud',
    phone_number        TEXT NOT NULL DEFAULT '',
    display_name        TEXT NOT NULL DEFAULT '',
    waba_id             TEXT NOT NULL DEFAULT '',
    phone_number_id     TEXT NOT NULL DEFAULT '',
    access_token_enc    TEXT NOT NULL DEFAULT '',
    webhook_verify_token TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.varta_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    phone_number    TEXT NOT NULL DEFAULT '',
    name            TEXT NOT NULL DEFAULT '',
    graha_contact_id UUID REFERENCES staging.graha_contacts(id) ON DELETE SET NULL,
    opted_in        BOOLEAN NOT NULL DEFAULT FALSE,
    opted_in_at     TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.varta_conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    varta_contact_id UUID NOT NULL REFERENCES staging.varta_contacts(id) ON DELETE CASCADE,
    assigned_to     TEXT,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved')),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS staging.varta_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES staging.varta_conversations(id) ON DELETE CASCADE,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    wa_message_id   TEXT,
    content         TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','video','audio','document','template','interactive')),
    media_url       TEXT,
    template_name   TEXT,
    template_params JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('pending','sent','delivered','read','failed')),
    error_code      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.varta_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    language        TEXT NOT NULL DEFAULT 'en',
    category        TEXT NOT NULL DEFAULT 'MARKETING',
    header_type     TEXT,
    header_content  TEXT,
    body            TEXT NOT NULL DEFAULT '',
    footer          TEXT,
    buttons         JSONB NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected')),
    meta_template_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staging.varta_auto_replies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    trigger_type    TEXT NOT NULL DEFAULT 'keyword' CHECK (trigger_type IN ('keyword','first_message','off_hours','fallback')),
    trigger_value   TEXT NOT NULL DEFAULT '',
    response_type   TEXT NOT NULL DEFAULT 'text' CHECK (response_type IN ('text','template')),
    response_content TEXT NOT NULL DEFAULT '',
    template_id     UUID REFERENCES staging.varta_templates(id) ON DELETE SET NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Varta indexes
CREATE INDEX IF NOT EXISTS idx_varta_accounts_org ON staging.varta_business_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_varta_contacts_org ON staging.varta_contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_varta_contacts_phone ON staging.varta_contacts(org_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_varta_conversations_org ON staging.varta_conversations(org_id);
CREATE INDEX IF NOT EXISTS idx_varta_conversations_contact ON staging.varta_conversations(varta_contact_id);
CREATE INDEX IF NOT EXISTS idx_varta_messages_conv ON staging.varta_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_varta_templates_org ON staging.varta_templates(org_id);

COMMIT;
