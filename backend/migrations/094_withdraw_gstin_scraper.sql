-- 094_withdraw_gstin_scraper.sql
--
-- `mikolabs/gstin-scraper` was repriced by its author on 2026-08-04, from
-- $6.99 to $149.99 per 1,000 results — 21.5x.
--
-- The catalog row (migration 046) records `cost_per_run = 0.10` and sells at
-- `price_inr = 50` with `margin_pct = 70`, and `max_results = 10`. Under the
-- old price a full run cost about $0.07, so the recorded figure was right.
-- Under the new one a full run costs about $1.50 — roughly fifteen times what
-- the catalog believes, and well above what we charge for it. Every full run
-- now sells at a loss.
--
-- WHAT THIS DOES NOT AFFECT: Ganit. Nothing in the accounting module has ever
-- called a scraper. `services/gstin.py` validates a GSTIN's FORMAT locally and
-- `routers/ganit.py` reads the `gstin` column off `organisations` and
-- `graha_contacts` — there is no verification call anywhere in the invoice
-- path, and the owner's standing rule is that a missing or unverified GSTIN
-- never blocks an invoice. What is withdrawn is a lead-generation enrichment:
-- looking up a GSTIN's legal name, trade name and filing status from the GST
-- portal, which was offered in Srijan's scraper catalog and nowhere else.
--
-- WHY BOTH THIS AND A CODE BLOCK. `is_active = FALSE` hides the row from the
-- catalog listing and from `POST /scrapers/run` (routers/scrapers.py:237,
-- :269), which is the whole fix for anyone using the product normally. But it
-- is one UPDATE from being undone, and re-running 046 on a fresh database would
-- set it TRUE again. `services/apify.BLOCKED_ACTORS` refuses the actor id at
-- `start_actor`, the single choke point every run passes through, so the block
-- survives both. Removing one without the other re-opens the hole.
--
-- The row is deactivated rather than deleted: `hub_scraper_runs.scraper_id`
-- references it, and past runs must keep resolving to a name on the runs
-- screen. A DELETE would leave historical rows pointing at nothing.
--
-- Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/094_withdraw_gstin_scraper.sql
-- Staging and production share one Supabase database — read that twice.

BEGIN;

UPDATE staging.hub_scraper_catalog
   SET is_active = FALSE
 WHERE apify_actor_id = 'mikolabs/gstin-scraper';

COMMIT;
