-- ============================================================
-- Migration 017: Srijan P3 (Chatbot + RAG) & P4 (Publishing)
--
-- P3: Knowledge base with pgvector embeddings, chat sessions
-- P4: Social account OAuth tokens, publishing queue
-- ============================================================

-- Enable pgvector for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ── P3: Knowledge Base ─────────────────────────────────────

-- Documents uploaded to the knowledge base (per client)
CREATE TABLE staging.hub_kb_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text'
        CHECK (source_type IN ('text', 'file', 'url', 'faq')),
    source_url TEXT,
    raw_content TEXT,
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kb_docs_client ON staging.hub_kb_documents(client_id);

-- Chunked + embedded pieces of documents for vector search
CREATE TABLE staging.hub_kb_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES staging.hub_kb_documents(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER DEFAULT 0,
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kb_chunks_doc ON staging.hub_kb_chunks(document_id);
CREATE INDEX idx_kb_chunks_client ON staging.hub_kb_chunks(client_id);
CREATE INDEX idx_kb_chunks_embedding ON staging.hub_kb_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Chat sessions (per client, can be internal or client-facing)
CREATE TABLE staging.hub_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Chat',
    session_type TEXT NOT NULL DEFAULT 'internal'
        CHECK (session_type IN ('internal', 'client_facing', 'support')),
    created_by TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_client ON staging.hub_chat_sessions(client_id);

-- Chat messages
CREATE TABLE staging.hub_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES staging.hub_chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    sources JSONB DEFAULT '[]',
    token_count INTEGER DEFAULT 0,
    cost_usd DECIMAL(10,6) DEFAULT 0,
    model_used TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_msgs_session ON staging.hub_chat_messages(session_id, created_at);

-- ── P4: Social Publishing ──────────────────────────────────

-- OAuth tokens for social platforms (per client)
CREATE TABLE staging.hub_social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN (
        'facebook', 'instagram', 'linkedin', 'google_business', 'twitter'
    )),
    account_name TEXT,
    account_id TEXT,
    page_id TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    scopes TEXT[],
    metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    connected_by TEXT,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, platform, account_id)
);

CREATE INDEX idx_social_accts_client ON staging.hub_social_accounts(client_id);

-- Publishing queue — content items scheduled for posting
CREATE TABLE staging.hub_publish_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES staging.hub_content_items(id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES staging.hub_social_accounts(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    scheduled_for TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
    platform_post_id TEXT,
    platform_url TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    published_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pub_queue_scheduled ON staging.hub_publish_queue(scheduled_for, status)
    WHERE status = 'scheduled';
CREATE INDEX idx_pub_queue_client ON staging.hub_publish_queue(client_id);
CREATE INDEX idx_pub_queue_content ON staging.hub_publish_queue(content_id);

-- Add published_url to content_items for tracking
ALTER TABLE staging.hub_content_items
    ADD COLUMN IF NOT EXISTS published_url TEXT,
    ADD COLUMN IF NOT EXISTS published_platform_id TEXT;
