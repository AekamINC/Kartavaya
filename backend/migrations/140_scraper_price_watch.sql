-- 140_scraper_price_watch.sql — the columns a daily price check needs.
--
-- WHY THIS EXISTS. `hub_scraper_catalog.cost_per_run` was true on the day it
-- was typed. The actors are third party and their authors reprice whenever they
-- like — one went from $6.99 to $149.99 per thousand results, 21.5x, and
-- nothing in this system noticed until a human read an email. Every run in
-- between sold below cost.
--
-- WHAT THE APIFY API ACTUALLY RETURNS, checked 2026-08-10 and the reason these
-- columns are shaped as they are:
--
--   · Pricing is PAY_PER_EVENT, not per run. Google Maps is $0.004 per PLACE
--     scraped; the email finder is $0.10 per EMAIL RECORD. A run that returns
--     three rows costs three units, not a flat fee.
--   · The unit price is TIERED BY OUR ACCOUNT, and our tier reads FREE — the
--     most expensive rung. On the Maps actor, lead enrichment is $0.10 per lead
--     at FREE and $0.005 at BRONZE. Twentyfold, for the same call.
--   · So `cost_per_run` is a worst case: unit price × `max_results` + the start
--     fee. It is the right number to PRICE against (a customer must not be able
--     to run a full-size job at a loss) and the wrong number to call "the cost".
--
-- Hence: keep `cost_per_run` as the derived worst case, and store the vendor's
-- own primitives beside it so the daily job can recompute rather than guess.
--
-- `margin_pct` is left in place and is no longer authoritative. It disagreed
-- with the other two columns — Google Maps claims 75% and computes to 39% — and
-- a stale number that looks like a fact is worse than one marked derived.
-- `target_margin_pct` is the number a human sets; `margin_pct` becomes the
-- number the job last achieved.

ALTER TABLE staging.hub_scraper_catalog
  ADD COLUMN IF NOT EXISTS unit_price_usd    NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS unit_label        TEXT,
  ADD COLUMN IF NOT EXISTS start_fee_usd     NUMERIC(12, 6) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_model     TEXT,
  ADD COLUMN IF NOT EXISTS account_tier      TEXT,
  ADD COLUMN IF NOT EXISTS target_margin_pct INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS price_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_changed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_frozen      BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN staging.hub_scraper_catalog.unit_price_usd IS
  'Vendor price for ONE billable unit at our account tier. Read from the Apify API by the daily price watch, never typed.';
COMMENT ON COLUMN staging.hub_scraper_catalog.unit_label IS
  'What one unit is — "Scraped place", "Business email record". Shown to the customer so a per-result price is legible.';
COMMENT ON COLUMN staging.hub_scraper_catalog.target_margin_pct IS
  'The margin the owner wants held. Owner decision 2026-08-10: every scraper between 30 and 50 percent.';
COMMENT ON COLUMN staging.hub_scraper_catalog.price_frozen IS
  'Set TRUE to stop the daily job repricing this row. For a scraper priced by hand for a reason.';
COMMENT ON COLUMN staging.hub_scraper_catalog.margin_pct IS
  'DERIVED, not authoritative. The margin the last price watch actually achieved after rounding to whole credits. Set target_margin_pct to change the intent.';

-- The audit trail. One row per observed price, so "when did this get expensive"
-- is a query rather than an archaeology exercise. A price that never changes
-- writes nothing — only movements land here.
CREATE TABLE IF NOT EXISTS staging.hub_scraper_price_history (
  id                BIGSERIAL PRIMARY KEY,
  -- TEXT, not UUID. `hub_scraper_catalog.id` is text (the actor slug is the
  -- key, e.g. 'google-maps-leads'), and declaring this uuid made the foreign
  -- key un-creatable. Matching the parent's type is not a style choice here.
  scraper_id        TEXT NOT NULL REFERENCES staging.hub_scraper_catalog(id) ON DELETE CASCADE,
  apify_actor_id    TEXT NOT NULL,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  unit_price_usd    NUMERIC(12, 6),
  prev_unit_price_usd NUMERIC(12, 6),
  cost_per_run      NUMERIC(12, 4),
  credit_cost       INTEGER,
  prev_credit_cost  INTEGER,
  change_ratio      NUMERIC(10, 3),
  action            TEXT NOT NULL,
  note              TEXT
);

CREATE INDEX IF NOT EXISTS idx_scraper_price_history_scraper
  ON staging.hub_scraper_price_history (scraper_id, observed_at DESC);

COMMENT ON TABLE staging.hub_scraper_price_history IS
  'Every observed movement in a third-party actor price. Written by the daily price watch; a steady price writes nothing.';
COMMENT ON COLUMN staging.hub_scraper_price_history.action IS
  'repriced | deactivated | unchanged_after_alarm | first_seen — what the watch did about it.';
