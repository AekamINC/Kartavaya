-- ============================================================
-- Migration 011: Srijan Foundation
-- Client management, brand profiles, credit system, content items.
-- All tables in staging schema with hub_ prefix.
-- ============================================================

-- 0. Seed Srijan as an add-on module
INSERT INTO staging.add_on_modules (name, code, price_per_user_monthly, requires_module, description)
VALUES (
    'Srijan AI Marketing', 'srijan', 0, '{}',
    'AI-powered marketing portal — brand intelligence, content agents, chatbot, publishing'
) ON CONFLICT (code) DO NOTHING;

-- 1. Hub Clients — one per managed brand/business
CREATE TABLE staging.hub_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    industry TEXT,
    website TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hub_clients_org ON staging.hub_clients(org_id);
CREATE UNIQUE INDEX idx_hub_clients_slug ON staging.hub_clients(slug);

-- 2. Brand Profiles — voice, tone, visual identity per client
CREATE TABLE staging.hub_brand_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL UNIQUE REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    brand_voice TEXT DEFAULT '',
    tone TEXT DEFAULT 'professional',
    target_audience TEXT DEFAULT '',
    languages TEXT[] DEFAULT '{en}',
    color_primary TEXT DEFAULT '#0082c6',
    color_secondary TEXT DEFAULT '#05b7aa',
    color_accent TEXT DEFAULT '#f59e0b',
    font_heading TEXT DEFAULT '',
    font_body TEXT DEFAULT '',
    logo_dark_url TEXT,
    logo_light_url TEXT,
    tagline TEXT DEFAULT '',
    brand_guidelines_url TEXT,
    social_handles JSONB DEFAULT '{}',
    content_dos TEXT DEFAULT '',
    content_donts TEXT DEFAULT '',
    sample_posts JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Credit Wallets — one per client
CREATE TABLE staging.hub_credit_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL UNIQUE REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0,
    monthly_allocation INTEGER NOT NULL DEFAULT 0,
    last_refill_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Credit Transactions — debit/credit audit log
CREATE TABLE staging.hub_credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    tx_type TEXT NOT NULL CHECK (tx_type IN ('debit', 'credit', 'refill', 'topup', 'refund')),
    description TEXT NOT NULL DEFAULT '',
    reference_type TEXT,
    reference_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hub_credit_tx_client ON staging.hub_credit_transactions(client_id);
CREATE INDEX idx_hub_credit_tx_date ON staging.hub_credit_transactions(created_at);

-- 5. Content Items — all AI-generated content
CREATE TABLE staging.hub_content_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL CHECK (agent_type IN (
        'social_media', 'blog', 'ad_copy', 'email', 'whatsapp', 'lead_magnet'
    )),
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    media_urls TEXT[] DEFAULT '{}',
    platform TEXT,
    hashtags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'pending_review', 'approved', 'rejected', 'published', 'archived'
    )),
    credits_used INTEGER NOT NULL DEFAULT 0,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    scheduled_for TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hub_content_client ON staging.hub_content_items(client_id);
CREATE INDEX idx_hub_content_status ON staging.hub_content_items(client_id, status);
CREATE INDEX idx_hub_content_agent ON staging.hub_content_items(agent_type);

-- 6. Hub Tiers — pricing/credit allocation
CREATE TABLE staging.hub_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE CHECK (code IN ('starter', 'growth', 'pro')),
    price_monthly DECIMAL(10,2) NOT NULL,
    credits_monthly INTEGER NOT NULL,
    max_clients INTEGER,
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO staging.hub_tiers (name, code, price_monthly, credits_monthly, max_clients, features) VALUES
('Starter', 'starter', 10000, 1000, 5, '{"agents": ["social_media", "ad_copy"], "chatbot": false, "publishing": false}'),
('Growth', 'growth', 15000, 1500, 15, '{"agents": ["social_media", "blog", "ad_copy", "email"], "chatbot": true, "publishing": false}'),
('Pro', 'pro', 20000, 2000, NULL, '{"agents": ["social_media", "blog", "ad_copy", "email", "whatsapp", "lead_magnet"], "chatbot": true, "publishing": true}');

-- 7. Hub Subscriptions — links org to a hub tier
CREATE TABLE staging.hub_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL UNIQUE REFERENCES staging.organisations(id) ON DELETE CASCADE,
    tier_id UUID NOT NULL REFERENCES staging.hub_tiers(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'cancelled', 'paused')),
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. AI Provider Config (admin-managed)
CREATE TABLE staging.hub_ai_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    api_base_url TEXT NOT NULL,
    default_model TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO staging.hub_ai_providers (name, code, api_base_url, default_model, priority) VALUES
('Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini-2.0-flash-lite', 1),
('Groq', 'groq', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile', 2),
('OpenRouter', 'openrouter', 'https://openrouter.ai/api/v1', 'google/gemini-2.0-flash-lite-001', 3);

-- 9. AI Generation Log — every AI call for auditing
CREATE TABLE staging.hub_ai_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES staging.hub_clients(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'fallback')),
    error_message TEXT,
    content_item_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hub_ai_logs_client ON staging.hub_ai_logs(client_id);
CREATE INDEX idx_hub_ai_logs_date ON staging.hub_ai_logs(created_at);
