-- 099_remove_mca_director_lookup.sql
--
-- The owner does not want the MCA Director Lookup (CIN) offered at all —
-- "remove this completely i dont need this at alllllllll anywhere", 2026-08-05.
-- This is a product decision, not a cost one: unlike `mikolabs/gstin-scraper`
-- (migration 094) there is nothing wrong with the actor's pricing. It is simply
-- not something we want to sell.
--
-- WHY THIS ONE IS DELETED AND THE GSTIN ROW WAS ONLY DEACTIVATED.
-- `hub_scraper_runs.scraper_id` points at this table, and a deleted row would
-- leave historical runs resolving to nothing on the runs screen. That is why 094
-- set `is_active = FALSE` instead of deleting. Measured before writing this:
--
--     SELECT scraper_id, count(*) FROM staging.hub_scraper_runs
--      WHERE scraper_id IN ('mca_cin_director_lookup','gst_verification','mca_company_lookup')
--      GROUP BY scraper_id;
--     -> gst_verification 1, mca_company_lookup 1, mca_cin_director_lookup ABSENT
--
-- `mca_cin_director_lookup` has never been run by anybody. No history points at
-- it, so there is no history to break, and "hidden but still in the table" is
-- not what was asked for. The DELETE is guarded on that count anyway — if a run
-- has appeared between writing this and applying it, the row is deactivated
-- instead and the history stays readable. Deleting a referenced row is the one
-- way this migration could destroy something.
--
-- WHY THERE IS ALSO A CODE BLOCK. Migration 046 seeds this row. Re-running 046
-- on a fresh database — which is exactly what a rebuild does — puts it back,
-- and no amount of DELETE here prevents that. `services/apify.BLOCKED_ACTORS`
-- refuses `thirdwatch/mca-india-scraper` at `start_actor`, the single choke
-- point every run passes through, so the actor cannot execute even if the row
-- returns. Removing one without the other re-opens it.
--
-- SIDE EFFECT WORTH KNOWING: this was the last ACTIVE row in the `govindia`
-- category (gst_verification and mca_company_lookup are already inactive), so
-- the "GovIndia (MCA / GST)" heading disappears from the catalog entirely. The
-- catalog groups whatever the API returns, so an empty category renders no
-- header — nothing in the frontend needs changing for that.
--
-- Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/099_remove_mca_director_lookup.sql
-- Staging and production share one Supabase database — read that twice.

-- Both statements match on the ACTOR id as well as our catalog id. The catalog
-- id is ours and could be renamed; `apify_actor_id` is what BLOCKED_ACTORS, the
-- run history and Apify itself all agree on. Matching on both means a re-seed
-- under a different catalog id is still caught.

BEGIN;

-- Deactivate first, unconditionally. If the DELETE below declines to fire
-- because history has appeared, the row is still gone from every listing.
UPDATE staging.hub_scraper_catalog
   SET is_active = FALSE
 WHERE id = 'mca_cin_director_lookup'
    OR apify_actor_id = 'thirdwatch/mca-india-scraper';

DELETE FROM staging.hub_scraper_catalog c
 WHERE (c.id = 'mca_cin_director_lookup'
        OR c.apify_actor_id = 'thirdwatch/mca-india-scraper')
   AND NOT EXISTS (
     SELECT 1 FROM staging.hub_scraper_runs r
      WHERE r.scraper_id = c.id
   );

COMMIT;
