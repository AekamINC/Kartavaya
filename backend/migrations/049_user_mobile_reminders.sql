-- 049: Add mobile_number to users, reminder infrastructure
-- (A) Mobile number on users for WhatsApp/SMS reminders
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_number TEXT DEFAULT '';

-- (B) Reminder schedules table — stores what reminders are configured
CREATE TABLE IF NOT EXISTS staging.reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id),
    reminder_type TEXT NOT NULL,  -- invoice_overdue, follow_up_due, approval_pending, task_due, meeting_upcoming, quote_expiry
    entity_type TEXT NOT NULL,    -- ganit_invoices, graha_follow_ups, approvals, tasks, graha_activities, vikray_orders
    entity_id UUID NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email',  -- email, push, whatsapp
    recipient_user_id TEXT,
    recipient_email TEXT,
    recipient_phone TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, sent, cancelled, failed
    sent_at TIMESTAMPTZ,
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_reminders_pending
    ON staging.reminders (remind_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reminders_org
    ON staging.reminders (org_id, entity_type, entity_id);
