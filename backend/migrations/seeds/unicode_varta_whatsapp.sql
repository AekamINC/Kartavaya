-- =====================================================================
-- Unicode Group — demo seed, VARTA (WhatsApp Business)
--   one connected number -> templates -> five customer conversations
--
-- org_id  fae87907-2f99-4b35-a241-c94d9e1e4a17   ("Unicode Group")
-- Written 2026-08-06.  NOT APPLIED — this file is left in the tree for
-- whoever seeds the demo. There is one `staging` schema and production
-- writes to it too.
--
-- WHY THIS EXISTS
--   Varta is completely empty in the demo, and it was empty for a reason
--   that has now been fixed: `POST /whatsapp/accounts` existed from the
--   day the module shipped and nothing in the frontend ever called it, so
--   `varta_business_accounts` held zero rows in every org including
--   Aekam's own. With no account there are no conversations, and with no
--   conversations every screen in the module is an empty state.
--
-- TENANCY
--   Every row below carries the single org_id above, and the guard in §0
--   refuses to run against any other organisation. There is no DELETE and
--   no TRUNCATE anywhere in this file.
--
-- IDEMPOTENT
--   Every row has a literal primary key and every INSERT is
--   `ON CONFLICT (id) DO NOTHING`. Re-running changes no row count.
--   §7 is the one exception and it is an UPDATE, described there.
--
-- PHONE NUMBERS
--   Every number is inside the reserved +91 99999xxxxx range. None of them
--   routes to a person, and none of them is a number Meta would deliver
--   to. The connected business number is in the same range for the same
--   reason.
--
-- NOTHING SENDS
--   `POST /conversations/{id}/messages` is the only outbound path in the
--   module and it is called by a human pressing send; there is no scanner
--   and no cron over any varta table (`scheduler.py` has none). The
--   Meta Cloud API call is still a TODO in `routers/whatsapp.py`, so even
--   that path writes a row and stops. Rows written directly here are
--   never transmitted anywhere.
--
-- THE ACCESS TOKEN
--   `access_token_enc` below is a plainly-labelled placeholder, not a
--   token and not ciphertext. `services.encryption.decrypt` passes an
--   unmarked value through unchanged (legacy plaintext rows still read),
--   so the send path treats it as readable and the account shows as
--   connected rather than failed — which is what the demo needs. A real
--   token would have to be pasted through the Connect dialog, which
--   encrypts it; a seed file is never the right place for one.
-- =====================================================================

\set org '''fae87907-2f99-4b35-a241-c94d9e1e4a17'''

BEGIN;

-- =====================================================================
-- 0. GUARD — refuse to run against anything but Unicode Group.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staging.organisations
                 WHERE id='fae87907-2f99-4b35-a241-c94d9e1e4a17'
                   AND name='Unicode Group') THEN
    RAISE EXCEPTION 'org fae87907… is not Unicode Group — refusing to seed';
  END IF;
END $$;


-- =====================================================================
-- 1. THE CONNECTED NUMBER
--
-- status='active' because this demo org is meant to look connected. In
-- the live flow an account is INSERTed 'pending' and is promoted to
-- 'active' by `GET /api/v1/whatsapp/webhook` when Meta completes the
-- verification handshake against `webhook_verify_token` — the seed jumps
-- straight to the end state because Meta will never call a demo row.
-- =====================================================================
INSERT INTO staging.varta_business_accounts
  (id, org_id, provider, phone_number, display_name, waba_id,
   phone_number_id, access_token_enc, webhook_verify_token, status,
   created_at, updated_at)
VALUES (
  'da000000-0000-4000-8000-000000000001',
  'fae87907-2f99-4b35-a241-c94d9e1e4a17',
  'meta_cloud',
  '+919999900001',
  'Unicode Group',
  '104000000000001',
  '109000000000001',
  'DEMO-PLACEHOLDER-NOT-A-TOKEN',
  'unicode-demo-verify-do-not-reuse',
  'active',
  TIMESTAMPTZ '2026-07-14 09:20:00+05:30',
  TIMESTAMPTZ '2026-07-14 09:41:00+05:30'
)
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 2. TEMPLATES
--
-- Four states so every chip in the Templates tab has a row behind it, and
-- three approved ones so `TemplatePicker` — which filters to
-- status='approved' and is the ONLY way to reach a customer once the
-- 24-hour window has closed — has something to offer.
--
-- Bodies use Meta's {{n}} placeholders. `params` are supplied per-send.
-- =====================================================================
INSERT INTO staging.varta_templates
  (id, org_id, name, language, category, header_type, header_content,
   body, footer, buttons, status, meta_template_id, created_at, updated_at)
VALUES
  ('d7000000-0000-4000-8000-000000000001',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'order_dispatched_v2', 'en', 'UTILITY', 'text', 'Order update',
   'Hello {{1}}, your order {{2}} has left our Ahmedabad warehouse and should reach you by {{3}}.',
   'Unicode Group', '[]'::jsonb, 'approved', '1710000000000001',
   TIMESTAMPTZ '2026-07-15 11:00:00+05:30', TIMESTAMPTZ '2026-07-17 16:12:00+05:30'),

  ('d7000000-0000-4000-8000-000000000002',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'payment_reminder_v1', 'en', 'UTILITY', NULL, NULL,
   'Hi {{1}}, invoice {{2}} for ₹{{3}} is due on {{4}}. Reply here if you need the copy again.',
   'Unicode Group', '[]'::jsonb, 'approved', '1710000000000002',
   TIMESTAMPTZ '2026-07-15 11:04:00+05:30', TIMESTAMPTZ '2026-07-17 16:12:00+05:30'),

  ('d7000000-0000-4000-8000-000000000003',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'support_followup_hi', 'hi', 'UTILITY', NULL, NULL,
   'नमस्ते {{1}}, आपकी शिकायत {{2}} पर काम चल रहा है। कोई और जानकारी चाहिए तो यहीं उत्तर दें।',
   'Unicode Group', '[]'::jsonb, 'approved', '1710000000000003',
   TIMESTAMPTZ '2026-07-16 10:30:00+05:30', TIMESTAMPTZ '2026-07-18 09:05:00+05:30'),

  -- In review at Meta. Rendered with the --warn chip; not offered by the picker.
  ('d7000000-0000-4000-8000-000000000004',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'festive_offer_2026', 'en', 'MARKETING', 'text', 'Diwali at Unicode',
   'Hello {{1}}, our Diwali range is open for pre-order until {{2}}. Reply STOP to opt out.',
   'Unicode Group', '[]'::jsonb, 'pending', NULL,
   TIMESTAMPTZ '2026-08-03 12:00:00+05:30', TIMESTAMPTZ '2026-08-03 12:00:00+05:30'),

  -- Never submitted.
  ('d7000000-0000-4000-8000-000000000005',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'site_visit_slot', 'en', 'UTILITY', NULL, NULL,
   'Hi {{1}}, we can visit on {{2}} between {{3}}. Does that suit you?',
   NULL, '[]'::jsonb, 'draft', NULL,
   TIMESTAMPTZ '2026-08-05 17:45:00+05:30', TIMESTAMPTZ '2026-08-05 17:45:00+05:30'),

  -- Rejected — the state an operator most needs to see, because the fix is
  -- editing and resubmitting rather than waiting.
  ('d7000000-0000-4000-8000-000000000006',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'discount_blast_v1', 'en', 'MARKETING', NULL, NULL,
   'BIGGEST SALE EVER!!! Click now {{1}}',
   NULL, '[]'::jsonb, 'rejected', NULL,
   TIMESTAMPTZ '2026-07-22 14:10:00+05:30', TIMESTAMPTZ '2026-07-23 08:30:00+05:30')
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 3. AUTO-REPLIES
-- =====================================================================
INSERT INTO staging.varta_auto_replies
  (id, org_id, trigger_type, trigger_value, response_type, response_content,
   template_id, is_active, created_at)
VALUES
  ('d8000000-0000-4000-8000-000000000001',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'first_message', '', 'text',
   'Thanks for writing to Unicode Group. Someone from our team will reply within business hours (Mon–Sat, 10am–7pm IST).',
   NULL, TRUE, TIMESTAMPTZ '2026-07-15 12:00:00+05:30'),

  ('d8000000-0000-4000-8000-000000000002',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'keyword', 'invoice', 'text',
   'For a copy of any invoice, reply with the invoice number and we will send it across.',
   NULL, TRUE, TIMESTAMPTZ '2026-07-15 12:02:00+05:30'),

  ('d8000000-0000-4000-8000-000000000003',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'off_hours', '', 'text',
   'We are closed right now. Messages sent after 7pm IST are answered the next working morning.',
   NULL, FALSE, TIMESTAMPTZ '2026-07-15 12:05:00+05:30')
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 4. CONTACTS
--
-- `graha_contact_id` is left NULL on purpose. Linking a WhatsApp contact
-- to a CRM contact is a real feature of this table, but the graha rows
-- belong to a different seed chain and hard-coding an id from it would
-- make this file fail whenever that chain is reordered. The link is made
-- by the product, not by the seed.
-- =====================================================================
INSERT INTO staging.varta_contacts
  (id, org_id, phone_number, name, graha_contact_id, opted_in, opted_in_at,
   last_message_at, created_at)
VALUES
  ('dc000000-0000-4000-8000-000000000001',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', '+919999900011', 'Anita Deshmukh',
   NULL, TRUE, TIMESTAMPTZ '2026-07-18 10:02:00+05:30',
   TIMESTAMPTZ '2026-08-06 08:40:00+05:30', TIMESTAMPTZ '2026-07-18 10:02:00+05:30'),

  ('dc000000-0000-4000-8000-000000000002',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', '+919999900012', 'Rakesh Bhandari',
   NULL, TRUE, TIMESTAMPTZ '2026-07-20 15:31:00+05:30',
   TIMESTAMPTZ '2026-07-29 12:14:00+05:30', TIMESTAMPTZ '2026-07-20 15:31:00+05:30'),

  ('dc000000-0000-4000-8000-000000000003',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', '+919999900013', 'Farida Qureshi',
   NULL, TRUE, TIMESTAMPTZ '2026-07-25 09:12:00+05:30',
   TIMESTAMPTZ '2026-08-01 18:55:00+05:30', TIMESTAMPTZ '2026-07-25 09:12:00+05:30'),

  ('dc000000-0000-4000-8000-000000000004',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', '+919999900014', 'Sandeep Iyer',
   NULL, TRUE, TIMESTAMPTZ '2026-07-26 11:47:00+05:30',
   TIMESTAMPTZ '2026-07-27 17:20:00+05:30', TIMESTAMPTZ '2026-07-26 11:47:00+05:30'),

  -- Has never written to us. The banner above the composer says so, and the
  -- composer is a template picker from the first frame.
  ('dc000000-0000-4000-8000-000000000005',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', '+919999900015', 'Meera Patel',
   NULL, TRUE, TIMESTAMPTZ '2026-08-04 10:00:00+05:30',
   NULL, TIMESTAMPTZ '2026-08-04 10:00:00+05:30')
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 5. CONVERSATIONS
--
-- Five, chosen so that every state the module can render has a row:
--
--   1  open      · 24-hour window OPEN     · free-text composer
--   2  open      · window CLOSED           · template picker
--   3  pending   · window CLOSED           · template picker
--   4  resolved  · window CLOSED           · closed thread, full history
--   5  open      · customer NEVER wrote    · template picker, "not yet" banner
--
-- `assigned_to` is TEXT holding a user id. Two rows are left NULL so the
-- rail's "Unassigned" state is visible; the assigned ones carry the
-- Unicode Group operator ids, which resolve to nothing in the UI beyond
-- "Assigned to a teammate" — that is the endpoint's current shape, not a
-- gap in the seed.
-- =====================================================================
INSERT INTO staging.varta_conversations
  (id, org_id, varta_contact_id, assigned_to, status, started_at, resolved_at)
VALUES
  ('d5000000-0000-4000-8000-000000000001',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'dc000000-0000-4000-8000-000000000001',
   NULL, 'open', TIMESTAMPTZ '2026-08-05 16:30:00+05:30', NULL),

  ('d5000000-0000-4000-8000-000000000002',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'dc000000-0000-4000-8000-000000000002',
   NULL, 'open', TIMESTAMPTZ '2026-07-29 11:40:00+05:30', NULL),

  ('d5000000-0000-4000-8000-000000000003',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'dc000000-0000-4000-8000-000000000003',
   NULL, 'pending', TIMESTAMPTZ '2026-08-01 18:20:00+05:30', NULL),

  ('d5000000-0000-4000-8000-000000000004',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'dc000000-0000-4000-8000-000000000004',
   NULL, 'resolved', TIMESTAMPTZ '2026-07-26 12:00:00+05:30',
   TIMESTAMPTZ '2026-07-27 17:25:00+05:30'),

  ('d5000000-0000-4000-8000-000000000005',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17',
   'dc000000-0000-4000-8000-000000000005',
   NULL, 'open', TIMESTAMPTZ '2026-08-04 10:05:00+05:30', NULL)
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 6. MESSAGES
--
-- `direction` is what the 24-hour window is computed from — the newest
-- INBOUND row plus 24 hours, per `services/wa_window.py`. An outbound
-- reply does NOT extend it, which is why conversation 2 below is closed
-- despite our answer being the newest message in it.
--
-- Conversation 1's timestamps are written relative to NOW() and are
-- re-anchored by §7 on every run. Everything else is absolute.
-- =====================================================================

-- ── 1 · Anita Deshmukh — window OPEN ────────────────────────────────
INSERT INTO staging.varta_messages
  (id, org_id, conversation_id, direction, wa_message_id, content, type,
   media_url, template_name, template_params, status, error_code, created_at)
VALUES
  ('d6000000-0000-4000-8000-000000000101',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000001',
   'inbound', 'wamid.demo.c1.in.1',
   'Hi, I placed order UG-2291 last week. Any update on dispatch?',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL, NOW() - INTERVAL '5 hours'),

  ('d6000000-0000-4000-8000-000000000102',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000001',
   'outbound', 'wamid.demo.c1.out.1',
   'Hello Anita — checking with the warehouse now, one moment.',
   'text', NULL, NULL, '{}'::jsonb, 'read', NULL, NOW() - INTERVAL '4 hours 40 minutes'),

  ('d6000000-0000-4000-8000-000000000103',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000001',
   'outbound', 'wamid.demo.c1.out.2',
   'Hello Anita, your order UG-2291 has left our Ahmedabad warehouse and should reach you by Friday 7 August.',
   'template', NULL, 'order_dispatched_v2',
   '{"1":"Anita","2":"UG-2291","3":"Friday 7 August"}'::jsonb,
   'read', NULL, NOW() - INTERVAL '4 hours 30 minutes'),

  -- THE ROW THE WINDOW HANGS ON. §7 keeps it inside 24 hours.
  ('d6000000-0000-4000-8000-000000000104',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000001',
   'inbound', 'wamid.demo.c1.in.2',
   'Perfect, thank you! Could you also send the invoice copy?',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL, NOW() - INTERVAL '2 hours')
ON CONFLICT (id) DO NOTHING;

-- ── 2 · Rakesh Bhandari — window CLOSED, thread still open ──────────
-- The newest message here is OURS, and it changes nothing: the clock is
-- the last inbound one, eight days ago.
INSERT INTO staging.varta_messages
  (id, org_id, conversation_id, direction, wa_message_id, content, type,
   media_url, template_name, template_params, status, error_code, created_at)
VALUES
  ('d6000000-0000-4000-8000-000000000201',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000002',
   'inbound', 'wamid.demo.c2.in.1',
   'Do you supply the 40mm fittings in bulk? Need about 500 units.',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL,
   TIMESTAMPTZ '2026-07-29 11:40:00+05:30'),

  ('d6000000-0000-4000-8000-000000000202',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000002',
   'outbound', 'wamid.demo.c2.out.1',
   'Yes we do. Sending you a quotation today — what is the delivery pin code?',
   'text', NULL, NULL, '{}'::jsonb, 'read', NULL,
   TIMESTAMPTZ '2026-07-29 12:14:00+05:30'),

  ('d6000000-0000-4000-8000-000000000203',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000002',
   'outbound', 'wamid.demo.c2.out.2',
   'Following up on the 500 unit enquiry — the quotation is ready whenever you are.',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL,
   TIMESTAMPTZ '2026-07-30 10:05:00+05:30')
ON CONFLICT (id) DO NOTHING;

-- ── 3 · Farida Qureshi — pending, window CLOSED, one FAILED send ────
-- 131047 is Meta's re-engagement error: a free-form message attempted
-- outside the window. It is in the seed because it is the exact failure
-- the server-side window check now prevents, and an operator who has seen
-- it once understands why the composer turns into a template picker.
INSERT INTO staging.varta_messages
  (id, org_id, conversation_id, direction, wa_message_id, content, type,
   media_url, template_name, template_params, status, error_code, created_at)
VALUES
  ('d6000000-0000-4000-8000-000000000301',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000003',
   'inbound', 'wamid.demo.c3.in.1',
   'The pump we bought in June is making a noise. Complaint UG-C-118.',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL,
   TIMESTAMPTZ '2026-08-01 18:20:00+05:30'),

  ('d6000000-0000-4000-8000-000000000302',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000003',
   'outbound', 'wamid.demo.c3.out.1',
   'नमस्ते Farida, आपकी शिकायत UG-C-118 पर काम चल रहा है। कोई और जानकारी चाहिए तो यहीं उत्तर दें।',
   'template', NULL, 'support_followup_hi',
   '{"1":"Farida","2":"UG-C-118"}'::jsonb, 'read', NULL,
   TIMESTAMPTZ '2026-08-01 18:55:00+05:30'),

  ('d6000000-0000-4000-8000-000000000303',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000003',
   'outbound', NULL,
   'Any update from your side on the pump?',
   'text', NULL, NULL, '{}'::jsonb, 'failed', '131047',
   TIMESTAMPTZ '2026-08-04 09:15:00+05:30')
ON CONFLICT (id) DO NOTHING;

-- ── 4 · Sandeep Iyer — resolved ─────────────────────────────────────
INSERT INTO staging.varta_messages
  (id, org_id, conversation_id, direction, wa_message_id, content, type,
   media_url, template_name, template_params, status, error_code, created_at)
VALUES
  ('d6000000-0000-4000-8000-000000000401',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000004',
   'inbound', 'wamid.demo.c4.in.1',
   'Invoice UG-INV-0442 shows the old GST rate. Can you correct it?',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL,
   TIMESTAMPTZ '2026-07-26 12:00:00+05:30'),

  ('d6000000-0000-4000-8000-000000000402',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000004',
   'outbound', 'wamid.demo.c4.out.1',
   'You are right, apologies. Reissuing it now with the correct rate.',
   'text', NULL, NULL, '{}'::jsonb, 'read', NULL,
   TIMESTAMPTZ '2026-07-26 14:22:00+05:30'),

  ('d6000000-0000-4000-8000-000000000403',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000004',
   'inbound', 'wamid.demo.c4.in.2',
   'Received the corrected copy, all good. Thanks.',
   'text', NULL, NULL, '{}'::jsonb, 'delivered', NULL,
   TIMESTAMPTZ '2026-07-27 17:20:00+05:30')
ON CONFLICT (id) DO NOTHING;

-- ── 5 · Meera Patel — she has never written to us ───────────────────
-- No inbound row anywhere in this conversation, so `ever_inbound` is
-- false and the window has never been open. Only templates, from the
-- first message onwards — which is the rule, and it is now enforced by
-- the server rather than only by the composer.
INSERT INTO staging.varta_messages
  (id, org_id, conversation_id, direction, wa_message_id, content, type,
   media_url, template_name, template_params, status, error_code, created_at)
VALUES
  ('d6000000-0000-4000-8000-000000000501',
   'fae87907-2f99-4b35-a241-c94d9e1e4a17', 'd5000000-0000-4000-8000-000000000005',
   'outbound', 'wamid.demo.c5.out.1',
   'Hi Meera, invoice UG-INV-0501 for ₹48,400 is due on 12 August. Reply here if you need the copy again.',
   'template', NULL, 'payment_reminder_v1',
   '{"1":"Meera","2":"UG-INV-0501","3":"48,400","4":"12 August"}'::jsonb,
   'delivered', NULL, TIMESTAMPTZ '2026-08-04 10:05:00+05:30')
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- 7. RE-ANCHOR THE OPEN WINDOW
--
-- The one thing in this file that a re-run changes, and it changes no row
-- COUNT — it moves four timestamps.
--
-- The demo has to show a conversation whose 24-hour window is open,
-- because that is what puts a free-text composer and a live countdown on
-- screen; every other conversation here demonstrates the closed side.
-- With purely absolute dates that conversation is open only on the day
-- the file is written and shows a closed window on every day after,
-- which is the demo losing half of what the module does.
--
-- So conversation 1's four messages are pinned to NOW() minus a fixed
-- offset, and running this file again re-pins them. The offsets are the
-- same ones the INSERT above used, so a first run and a re-run produce
-- identical rows. Scoped to four literal ids inside one org: it cannot
-- touch a real conversation, a real customer's message, or another org.
-- =====================================================================
UPDATE staging.varta_messages AS m
   SET created_at = NOW() - v.ago
  FROM (VALUES
        ('d6000000-0000-4000-8000-000000000101'::uuid, INTERVAL '5 hours'),
        ('d6000000-0000-4000-8000-000000000102'::uuid, INTERVAL '4 hours 40 minutes'),
        ('d6000000-0000-4000-8000-000000000103'::uuid, INTERVAL '4 hours 30 minutes'),
        ('d6000000-0000-4000-8000-000000000104'::uuid, INTERVAL '2 hours')
       ) AS v(id, ago)
 WHERE m.id = v.id
   AND m.org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17';

UPDATE staging.varta_contacts
   SET last_message_at = NOW() - INTERVAL '2 hours'
 WHERE id = 'dc000000-0000-4000-8000-000000000001'
   AND org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17';


-- =====================================================================
-- 8. WHAT THIS SEED DOES NOT DO
--
--   · It does not enable the `varta` module for the org. That is an
--     `org_modules` row and it belongs to the subscription, not here —
--     `require_module('varta')` will 403 every route in this module until
--     it exists, and seeding it silently would be granting an entitlement
--     from a data file.
--   · It grants no user a module role. Without an `org_member_modules`
--     row at editor level, `require_module` refuses the WRITE half of the
--     module (POST/DELETE) while allowing reads — so the demo will list
--     these conversations and refuse to send in them.
--   · It links no contact to Graha. See §4.
-- =====================================================================

COMMIT;
