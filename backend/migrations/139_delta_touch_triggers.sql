-- 139 — updated_at maintained by the DATABASE on the four remaining delta tables.
--
-- Migration 138 gave activities and follow-ups a `touch_updated_at` trigger
-- because they had no `updated_at` at all. Invoices, contacts, clients and
-- orders already had the column, and every UPDATE in the code today does write
-- it — measured on staging before this was written: 583 of 760 invoices, 246 of
-- 287 contacts, 87 of 115 clients and 339 of 377 orders carry an `updated_at`
-- later than their `created_at`, so the column is genuinely live, not decorative.
--
-- That is exactly why this is needed anyway.
--
-- Once `?since=` reads these tables, an UPDATE that forgets `updated_at=NOW()`
-- stops being a cosmetic omission and becomes a change that NEVER reaches the
-- device — the row is edited on the web, the phone asks what changed, and the
-- server truthfully answers "nothing". There is no error, no log line and no
-- way to notice except a user insisting the app is showing an old figure.
--
-- Grepping the current write paths would only prove today is fine; it says
-- nothing about the UPDATE somebody adds next month. A BEFORE UPDATE trigger
-- makes the guarantee structural: whatever writes the row — a router, a
-- service, the `graha_client_rename_cascades` cascade, a hand-run statement
-- during an incident — the stamp moves.
--
-- `staging.touch_updated_at()` already exists (138). This adds nothing but the
-- four triggers, and each is idempotent.

DROP TRIGGER IF EXISTS trg_touch_invoices ON staging.ganit_invoices;
CREATE TRIGGER trg_touch_invoices
    BEFORE UPDATE ON staging.ganit_invoices
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_contacts ON staging.graha_contacts;
CREATE TRIGGER trg_touch_contacts
    BEFORE UPDATE ON staging.graha_contacts
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_clients ON staging.graha_clients;
CREATE TRIGGER trg_touch_clients
    BEFORE UPDATE ON staging.graha_clients
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_orders ON staging.vikray_orders;
CREATE TRIGGER trg_touch_orders
    BEFORE UPDATE ON staging.vikray_orders
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

-- The delta indexes these four need already exist — `ganit_invoices_delta`,
-- `graha_contacts_delta`, `graha_clients_delta` and `vikray_orders_delta` were
-- created by 138 ahead of the endpoints that would use them. Verified present
-- on staging before this migration was written; nothing to add here.
