-- 147_suppressed_is_a_status.sql
--
-- Let a send that was stopped say so, in the column that records what happened.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- `OUTBOUND_MODE=dry` stops a message at the door. Three tables record what
-- happened to a message, and none of them had a word for it:
--
--   staging.prachar_campaigns         draft scheduled sending sent paused cancelled
--   staging.prachar_campaign_contacts pending sent delivered opened clicked
--                                     bounced unsubscribed failed
--   staging.varta_messages            pending sent delivered read failed
--
-- So the first pass wrote 'failed' with the reason in `error_code` /
-- `error_message`, and 'paused' for a campaign that never left. Both are
-- approximations of a thing that is neither a failure nor a pause: nothing went
-- wrong, and nobody paused it — an operator switched sending off.
--
-- The approximations cost something real. 'failed' puts a suppressed message in
-- the same bucket as a genuine delivery failure, which is the bucket a person
-- acts on. 'paused' had no route out of it until one was added. And a reason
-- that lives in `error_code` is only as good as whoever remembers to read it —
-- `prachar_campaign_contacts.error_message` has no reader anywhere in the
-- product.
--
-- ── WRITE-PATH SIDE EFFECTS: NONE ───────────────────────────────────────────
--
-- Measured against the live database immediately before writing this file.
--
--   Rows read     : 0
--   Rows written  : 0        no UPDATE, no INSERT, no DELETE
--   Rows affected : 0
--
-- Each new constraint is a strict SUPERSET of the one it replaces: every value
-- that was legal stays legal, one more becomes legal. Every existing row
-- therefore satisfies it, which was checked rather than assumed —
--
--   prachar_campaigns         104 rows: draft 89, sent 15
--   prachar_campaign_contacts 122 rows: sent 62, delivered 25, opened 21,
--                                       clicked 8, unsubscribed 3, bounced 2,
--                                       failed 1
--   varta_messages            500 rows: read 375, delivered 125
--
-- ── PRODUCTION ──────────────────────────────────────────────────────────────
--
-- Staging and production share ONE database, so every migration here touches
-- production's data. This one is safe for a stronger reason than "it is small":
-- PRODUCTION CANNOT REACH ANY OF THESE THREE TABLES. Its server.py at 1aa49855
-- mounts fifteen routers — auth, invite, approvals, health, api, fields, views,
-- automations, activity, dashboards, templates, time, uploads, reports,
-- task_reminders — and neither `prachar` nor `whatsapp` is among them. Checked
-- by reading that commit, not assumed.
--
-- And even for a reader that could: adding a value to a CHECK is invisible to
-- code that never writes it. The only way this is felt is a UI that maps status
-- strings to labels and meets one it does not know — and every such map in this
-- repo (`WA_STATUS_LABEL`, `CAMPAIGN_COLORS`, the Prachar dashboard buckets)
-- ships in the same commit as the code that writes the new value.
--
-- ── LOCKING ─────────────────────────────────────────────────────────────────
--
-- ALTER TABLE takes ACCESS EXCLUSIVE, and ADD CONSTRAINT ... CHECK validates by
-- scanning. 104, 122 and 500 rows: microseconds. All six statements run in one
-- transaction, so there is no observable moment when a column is unconstrained.
--
-- ── REVERSING IT ────────────────────────────────────────────────────────────
--
-- Reversible while no row uses the new value. Re-add the originals verbatim:
--
--   ALTER TABLE staging.prachar_campaigns
--     DROP CONSTRAINT prachar_campaigns_status_check,
--     ADD  CONSTRAINT prachar_campaigns_status_check CHECK (status IN
--          ('draft','scheduled','sending','sent','paused','cancelled'));
--   ALTER TABLE staging.prachar_campaign_contacts
--     DROP CONSTRAINT prachar_campaign_contacts_status_check,
--     ADD  CONSTRAINT prachar_campaign_contacts_status_check CHECK (status IN
--          ('pending','sent','delivered','opened','clicked','bounced',
--           'unsubscribed','failed'));
--   ALTER TABLE staging.varta_messages
--     DROP CONSTRAINT varta_messages_status_check,
--     ADD  CONSTRAINT varta_messages_status_check CHECK (status IN
--          ('pending','sent','delivered','read','failed'));

BEGIN;

ALTER TABLE staging.prachar_campaigns
  DROP CONSTRAINT IF EXISTS prachar_campaigns_status_check;
ALTER TABLE staging.prachar_campaigns
  ADD CONSTRAINT prachar_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused',
                    'cancelled', 'suppressed'));

ALTER TABLE staging.prachar_campaign_contacts
  DROP CONSTRAINT IF EXISTS prachar_campaign_contacts_status_check;
ALTER TABLE staging.prachar_campaign_contacts
  ADD CONSTRAINT prachar_campaign_contacts_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked',
                    'bounced', 'unsubscribed', 'failed', 'suppressed'));

ALTER TABLE staging.varta_messages
  DROP CONSTRAINT IF EXISTS varta_messages_status_check;
ALTER TABLE staging.varta_messages
  ADD CONSTRAINT varta_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed',
                    'suppressed'));

COMMIT;
