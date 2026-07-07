-- ============================================================
-- Migration 012: Srijan P2 — Skill Packs & Approval Workflow
-- Templates are platform-wide; client_skills are per-client isolated.
-- ============================================================

-- 1. Skill Pack Templates — global blueprints (Aekam creates)
CREATE TABLE staging.hub_skill_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
        'general', 'festival', 'launch', 'engagement', 'branding', 'seasonal', 'industry'
    )),
    steps JSONB NOT NULL DEFAULT '[]',
    default_schedule TEXT,
    estimated_credits INTEGER NOT NULL DEFAULT 0,
    icon TEXT DEFAULT 'star',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Client Skills — per-client assignment of a template
CREATE TABLE staging.hub_client_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES staging.hub_skill_templates(id) ON DELETE CASCADE,
    custom_config JSONB DEFAULT '{}',
    schedule TEXT,
    next_run_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    assigned_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, template_id)
);

CREATE INDEX idx_hub_client_skills_client ON staging.hub_client_skills(client_id);
CREATE INDEX idx_hub_client_skills_schedule ON staging.hub_client_skills(next_run_at) WHERE is_active = TRUE;

-- 3. Skill Runs — execution history, per-client isolated
CREATE TABLE staging.hub_skill_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_skill_id UUID NOT NULL REFERENCES staging.hub_client_skills(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES staging.hub_clients(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    steps_completed INTEGER DEFAULT 0,
    steps_total INTEGER DEFAULT 0,
    outputs JSONB DEFAULT '[]',
    content_item_ids UUID[] DEFAULT '{}',
    credits_used INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    triggered_by UUID
);

CREATE INDEX idx_hub_skill_runs_client ON staging.hub_skill_runs(client_id);
CREATE INDEX idx_hub_skill_runs_skill ON staging.hub_skill_runs(client_skill_id);

-- 4. Content Approval History — audit trail for reviews
CREATE TABLE staging.hub_content_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID NOT NULL REFERENCES staging.hub_content_items(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected', 'revision_requested')),
    reviewer_id UUID,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hub_approvals_content ON staging.hub_content_approvals(content_item_id);

-- 5. Seed Skill Pack Templates
INSERT INTO staging.hub_skill_templates (name, description, category, steps, estimated_credits, icon) VALUES
(
    'Festival Calendar',
    'Auto-generate social media posts for upcoming Indian festivals and holidays',
    'festival',
    '[
        {"order": 1, "agent_type": "social_media", "prompt_template": "Create a festive social media post for {festival_name}. Include warm wishes, brand connection, and relevant hashtags. Festival date: {date}.", "platform": "instagram"},
        {"order": 2, "agent_type": "social_media", "prompt_template": "Create a festive social media post for {festival_name} for LinkedIn. Professional tone, brand values, and festival relevance.", "platform": "linkedin"},
        {"order": 3, "agent_type": "ad_copy", "prompt_template": "Write a festive offer/discount ad for {festival_name}. Tie the promotion to the festival spirit.", "platform": "general"}
    ]',
    7, 'calendar'
),
(
    'Product Launch Pack',
    'Complete content suite for a new product or service launch',
    'launch',
    '[
        {"order": 1, "agent_type": "blog", "prompt_template": "Write a launch announcement blog post for the new product: {product_name}. Description: {product_description}. Highlight key features and benefits."},
        {"order": 2, "agent_type": "social_media", "prompt_template": "Create a teaser social media post announcing the upcoming launch of {product_name}. Build excitement and curiosity.", "platform": "instagram"},
        {"order": 3, "agent_type": "social_media", "prompt_template": "Create a launch day announcement post for {product_name} on LinkedIn. Professional, achievement-focused.", "platform": "linkedin"},
        {"order": 4, "agent_type": "email", "prompt_template": "Write a launch announcement email for {product_name}. Include early-bird offer and CTA to learn more."},
        {"order": 5, "agent_type": "ad_copy", "prompt_template": "Write launch ad copy for {product_name}. Focus on the key differentiator and include a strong CTA.", "platform": "general"}
    ]',
    14, 'rocket'
),
(
    'Weekly Reel Scripts',
    'Generate 5 short-form video scripts for Instagram Reels or YouTube Shorts',
    'engagement',
    '[
        {"order": 1, "agent_type": "social_media", "prompt_template": "Write a 30-second reel script. Topic: {topic_1}. Format: hook (3s) → value (20s) → CTA (7s). Include on-screen text suggestions.", "platform": "instagram"},
        {"order": 2, "agent_type": "social_media", "prompt_template": "Write a 30-second reel script. Topic: {topic_2}. Format: hook → value → CTA. Make it trendy and engaging.", "platform": "instagram"},
        {"order": 3, "agent_type": "social_media", "prompt_template": "Write a 30-second reel script. Topic: {topic_3}. Educational style — teach one thing clearly.", "platform": "instagram"},
        {"order": 4, "agent_type": "social_media", "prompt_template": "Write a 30-second reel script. Topic: {topic_4}. Behind-the-scenes or day-in-the-life style.", "platform": "instagram"},
        {"order": 5, "agent_type": "social_media", "prompt_template": "Write a 30-second reel script. Topic: {topic_5}. Trend-jacking style — adapt a current trend to the brand.", "platform": "instagram"}
    ]',
    10, 'video'
),
(
    'SEO Blog Series',
    'Generate a series of 3 SEO-optimized blog articles around a topic cluster',
    'branding',
    '[
        {"order": 1, "agent_type": "seo", "prompt_template": "Write a pillar article for the topic cluster: {cluster_topic}. This is the comprehensive guide covering all aspects."},
        {"order": 2, "agent_type": "seo", "prompt_template": "Write a supporting article for the subtopic: {subtopic_1}. Link back to the pillar article on {cluster_topic}."},
        {"order": 3, "agent_type": "seo", "prompt_template": "Write a supporting article for the subtopic: {subtopic_2}. Link back to the pillar article on {cluster_topic}."}
    ]',
    24, 'search'
),
(
    'Campaign Launch',
    'Full marketing campaign — strategy, content, ads, and email sequence',
    'launch',
    '[
        {"order": 1, "agent_type": "campaign", "prompt_template": "Create a complete marketing campaign for: {campaign_brief}. Target audience: {target_audience}. Duration: {duration}."},
        {"order": 2, "agent_type": "social_media", "prompt_template": "Create the campaign announcement post for social media. Campaign: {campaign_brief}.", "platform": "instagram"},
        {"order": 3, "agent_type": "ad_copy", "prompt_template": "Write the primary ad copy for the campaign: {campaign_brief}. Focus on the main offer.", "platform": "general"},
        {"order": 4, "agent_type": "email", "prompt_template": "Write the campaign launch email. Campaign: {campaign_brief}. Include the main CTA and offer details."},
        {"order": 5, "agent_type": "email", "prompt_template": "Write a follow-up reminder email for the campaign: {campaign_brief}. Create urgency."}
    ]',
    19, 'megaphone'
);
