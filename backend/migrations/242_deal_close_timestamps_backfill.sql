-- 242 — make `won_at`/`lost_at` agree with `stage` on the rows that predate
--       the two write-path fixes.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  1. WHAT THIS DOES, AND WHY IT IS NEEDED AT ALL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every money reading of "open pipeline" in the product uses the TIMESTAMPS,
-- never the stage string, and the metric registry says why:
--
--     "Open = not won, not lost, not archived, not deleted — the close is the
--      won_at/lost_at timestamp, never a stage string, because stage values
--      are per-org text."     (graha.pipeline_by_stage)
--
-- Two write paths failed to maintain those columns, both fixed in the same
-- commit as this file:
--
--   · `create_deal` inserted `body.stage` verbatim and stamped nothing, so a
--     deal ENTERED as Won or Lost was closed on the board and open in the
--     money, permanently — nothing would ever move its stage again to trigger
--     a stamp.
--   · `update_deal` stamped on the way IN and cleared nothing on the way OUT,
--     so a deal moved to Won and then back to an open stage kept `won_at`
--     forever and was subtracted from open pipeline while sitting in an open
--     column.
--
-- The code fix stops NEW divergence. It does not repair rows already written,
-- and those rows are the ones the numbers are read from today. This is that
-- repair, and it is the whole of it — after this runs, the invariant holds for
-- every row and is asserted at the bottom.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  2. WRITE-PATH SIDE EFFECTS — STATED BEFORE RUNNING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- UPDATE on `public.graha_deals`, two columns, nine rows. No INSERT, no
-- DELETE, no DDL, no schema change, no trigger on this table.
--
-- ⚠ FIGURES THAT MOVE. These are corrections, and each is in the direction of
-- the truth, but they WILL move on screen:
--
--   · Open pipeline FALLS by ₹2,950,000 (the 7 born-closed deals leave it) and
--     RISES by ₹800,000 (the 2 re-opened deals come back). Net −₹2,150,000.
--   · `graha.win_rate`, `graha.avg_deal_size`, `graha.sales_cycle` and
--     `won_value_by_month` all read `won_at` and will now SEE 5 wins worth
--     ₹1,000,000 that were invisible to them. Win rate rises.
--   · `sales_cycle` for the 5 backfilled wins is stamped at `created_at`, so
--     they contribute a cycle of ZERO days. That is honest — the deal was
--     entered already won and the product genuinely holds no evidence of how
--     long it took — but it pulls the average down and the number should be
--     read with that in mind for this org.
--   · `dristi.overview`'s `won_deals` / `won_value` / `lost_deals` do NOT
--     move: they count on `stage`, deliberately, and this migration does not
--     touch `stage` on any row.
--
-- NOT TOUCHED: `stage`, `probability`, `value`, `updated_at`, `updated_by`.
-- `updated_at` is left alone on purpose — it records when a PERSON last
-- changed the deal, and a repair is not that.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  3. BLAST RADIUS — MEASURED, NOT ESTIMATED (read-only, 2026-08-31)
-- ═══════════════════════════════════════════════════════════════════════════
--
--   9 rows, ALL in Unicode Group (fae87907-…), across 1 org of the whole
--   table's 33 live deals. Aekam Inc holds ZERO matching rows and is not
--   touched by any statement here.
--
--     stamp won_at    5   ₹1,000,000   stage='Won',  won_at IS NULL
--     stamp lost_at   2   ₹1,350,000   stage='Lost', lost_at IS NULL
--     clear won_at    2     ₹800,000   stage='Negotiation', won_at set
--
--   Every one of the 7 stamp rows has `updated_at = created_at` — never
--   touched since creation, i.e. genuinely born at that stage — which is why
--   `created_at` is the honest close date for them and not a guess.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  4. REVERSAL
-- ═══════════════════════════════════════════════════════════════════════════
--
--   The pre-state is nine (id, won_at, lost_at) triples and is captured into
--   `public.migration_242_deal_close_before` by the first statement below,
--   BEFORE anything is written. To reverse:
--
--     UPDATE public.graha_deals d
--        SET won_at = b.won_at, lost_at = b.lost_at
--       FROM public.migration_242_deal_close_before b
--      WHERE d.id = b.id;
--
--   The table is kept, not dropped at the end. It is nine rows; the cost of
--   keeping it is nothing against the cost of a reversal path that exists only
--   in a commit message.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  5. VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
--   The final statement raises unless ZERO rows diverge. A migration that
--   repairs a class of rows and does not then assert the class is empty is the
--   shape that has shipped a blocker here before: it reports success on the
--   rows it happened to match.
--
--   The invariant is also held forward by tests, not only here:
--     backend/tests/test_deal_close_is_a_timestamp.py   (both write paths)
--     backend/tests/test_open_pipeline_reconciles.py    (the three readers)

BEGIN;

-- ── The reversal record, written first ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.migration_242_deal_close_before (
    id       uuid PRIMARY KEY,
    org_id   uuid        NOT NULL,
    stage    text,
    won_at   timestamptz,
    lost_at  timestamptz,
    saved_at timestamptz NOT NULL DEFAULT NOW()
);

-- RLS, with no policies, exactly as every other table in `public` carries it.
-- `public` is exposed to PostgREST and the anon key ships in the browser
-- bundle; a new table without RLS is a cross-tenant leak that produces no
-- error and no log line. Nine rows of deal ids is not interesting data, and
-- that is not the point — the rule has no exception for uninteresting tables.
ALTER TABLE public.migration_242_deal_close_before ENABLE ROW LEVEL SECURITY;

INSERT INTO public.migration_242_deal_close_before (id, org_id, stage, won_at, lost_at)
SELECT d.id, d.org_id, d.stage, d.won_at, d.lost_at
  FROM public.graha_deals d
 WHERE d.is_active = TRUE AND d.archived_at IS NULL
   AND ( (d.stage = 'Won'  AND d.won_at  IS NULL)
      OR (d.stage = 'Lost' AND d.lost_at IS NULL)
      OR (d.stage NOT IN ('Won','Lost')
          AND (d.won_at IS NOT NULL OR d.lost_at IS NOT NULL)) )
ON CONFLICT (id) DO NOTHING;

-- ── Born closed: stamp the close at creation ───────────────────────────────
--
-- `created_at`, not NOW(). NOW() would date a sale made in July to the day the
-- migration ran and put it in the wrong month of every flow metric. These rows
-- have `updated_at = created_at`, so creation is the only moment the product
-- has any evidence of.
UPDATE public.graha_deals
   SET won_at = created_at
 WHERE is_active = TRUE AND archived_at IS NULL
   AND stage = 'Won' AND won_at IS NULL;

UPDATE public.graha_deals
   SET lost_at = created_at
 WHERE is_active = TRUE AND archived_at IS NULL
   AND stage = 'Lost' AND lost_at IS NULL;

-- ── Re-opened: clear the stale close ───────────────────────────────────────
--
-- The stage is authoritative here for the same reason the write path makes it
-- authoritative: it is the half a person can see on the board. A deal sitting
-- in Negotiation is not won, whatever a timestamp left behind says.
UPDATE public.graha_deals
   SET won_at = NULL, lost_at = NULL
 WHERE is_active = TRUE AND archived_at IS NULL
   AND stage NOT IN ('Won','Lost')
   AND (won_at IS NOT NULL OR lost_at IS NOT NULL);

-- ── The assertion ──────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n
      FROM public.graha_deals
     WHERE is_active = TRUE AND archived_at IS NULL
       AND ( (stage = 'Won'  AND won_at  IS NULL)
          OR (stage = 'Lost' AND lost_at IS NULL)
          OR (stage NOT IN ('Won','Lost')
              AND (won_at IS NOT NULL OR lost_at IS NOT NULL)) );
    IF n > 0 THEN
        RAISE EXCEPTION
          'migration 242 left % deals whose stage and close timestamps '
          'still disagree — open pipeline would remain unreconcilable', n;
    END IF;
END $$;

COMMIT;
