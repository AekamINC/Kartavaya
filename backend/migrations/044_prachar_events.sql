-- 044: Event & Webinar Management
CREATE TABLE IF NOT EXISTS staging.prachar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    event_type TEXT DEFAULT 'webinar' CHECK (event_type IN ('webinar', 'meetup', 'workshop', 'conference', 'other')),
    location TEXT DEFAULT '',
    location_url TEXT DEFAULT '',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    max_attendees INT,
    registration_open BOOLEAN DEFAULT TRUE,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ongoing', 'completed', 'cancelled')),
    tags JSONB DEFAULT '[]',
    created_by TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_org ON staging.prachar_events(org_id, status);

CREATE TABLE IF NOT EXISTS staging.prachar_event_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES staging.prachar_events(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT DEFAULT '',
    contact_id UUID REFERENCES staging.graha_contacts(id),
    status TEXT DEFAULT 'registered' CHECK (status IN ('registered', 'attended', 'no_show', 'cancelled')),
    registered_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_regs ON staging.prachar_event_registrations(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_reg_unique ON staging.prachar_event_registrations(event_id, email);
