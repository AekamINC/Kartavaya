-- 205 · Clear the TEST ORG's attendance punches. Owner decision, 2026-08-23.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT WAS ASKED, AND WHAT MEASURING CHANGED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The finding that prompted this: `create_punch` refused every photograph for
-- any org without its own Cloudflare account, because the guard compared a key
-- that already carried the tenant prefix. Measured: 1,659 punches, ZERO with a
-- `photo_key`. The feature had never worked.
--
-- Asked initially: remove the records with no photograph, "they are useless
-- now". Measuring the blast radius changed the answer, and the numbers are why:
--
--   punches, all orgs                          1,659   of which 0 photographed
--     E2E Test & Associates [TEST ORG]           960
--     Unicode Group                              699   ← a LIVE customer
--   punches carrying a human review verdict      735
--
-- "Records with no photograph" was every attendance record in the product,
-- 8 June to 4 August, including 735 occasions on which a manager looked at a
-- flagged punch and decided something. A punch without its selfie is not blank:
-- it still carries its time, its location, its accuracy and its flags.
--
-- **Decision: the TEST ORG's 960 only.** Unicode Group's 699 stay.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE ONE REFERENCE, AND WHY NOTHING IS DONE ABOUT IT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Exactly one foreign key points at `pahchan_punches`:
--
--   pahchan_regularisations.punch_id REFERENCES pahchan_punches(id)
--     ON DELETE SET NULL
--
-- A first draft of this file deleted the regularisations that referenced the
-- doomed punches, on the reasoning that a request to amend a particular punch
-- is meaningless once that punch is gone. Its own assertion refused it, and the
-- assertion was right: MEASURED, all 40 regularisations belong to the test org
-- and ALL 40 ALREADY HAVE `punch_id` NULL. Not one references a punch. They
-- were seeded detached and have always been detached.
--
-- So the FK is inert here, the child delete would have removed nothing, and
-- these 40 rows are NOT orphaned by this migration — they were never attached.
-- They are therefore left exactly alone, and the check below asserts that all
-- 40 are still present afterwards rather than asserting an absence of NULLs
-- that was never true in the first place.
--
-- `manav_attendance` is likewise left alone: it carries no `punch_id` and no
-- foreign key — it is derived, not linked — so nothing there is orphaned by
-- this either. Whether the test org's 426 attendance rows should go is a
-- separate question about attendance, and this file does not answer a question
-- it was not asked.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Staging and production share one Supabase database, so this is a production
-- delete. It is scoped by `org_id` to the seeded test organisation — the one
-- whose whole purpose is to be re-seeded — and the predicate names that org's
-- uuid literally rather than deriving it from a name, which could match a
-- customer who happens to be called something similar.
--
-- Backed up in full to `punch_cleanup_20260823` BEFORE anything is deleted, and
-- the delete set is frozen into a table first so it cannot drift between the
-- backup and the delete.

BEGIN;

CREATE SCHEMA IF NOT EXISTS punch_cleanup_20260823;

--  Frozen first. The delete below reads THIS, never a live predicate.
CREATE TABLE IF NOT EXISTS punch_cleanup_20260823.punch_ids AS
  SELECT id FROM staging.pahchan_punches
   WHERE org_id = '64e7bea6-6abe-490c-a2a4-27a60c6be916'::uuid;

CREATE TABLE IF NOT EXISTS punch_cleanup_20260823.punches_before AS
  SELECT p.* FROM staging.pahchan_punches p
   WHERE p.id IN (SELECT id FROM punch_cleanup_20260823.punch_ids);

DELETE FROM staging.pahchan_punches
 WHERE id IN (SELECT id FROM punch_cleanup_20260823.punch_ids);

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM punch_cleanup_20260823.punches_before;
  IF n <> 960 THEN
    RAISE EXCEPTION 'backed up % punch(es), expected 960 — refusing', n;
  END IF;

  SELECT count(*) INTO n FROM staging.pahchan_punches
   WHERE org_id = '64e7bea6-6abe-490c-a2a4-27a60c6be916'::uuid;
  IF n <> 0 THEN
    RAISE EXCEPTION '% test-org punch(es) survived', n;
  END IF;

  --  THE ASSERTION THAT MATTERS: the live customer is untouched.
  SELECT count(*) INTO n FROM staging.pahchan_punches;
  IF n <> 699 THEN
    RAISE EXCEPTION
      'pahchan_punches holds % rows, expected Unicode Group''s 699 and nothing '
      'else — this migration reached a live organisation and is rolled back', n;
  END IF;

  --  The detached 40 stay detached, and stay present.
  SELECT count(*) INTO n FROM staging.pahchan_regularisations;
  IF n <> 40 THEN
    RAISE EXCEPTION 'pahchan_regularisations is % rows, expected 40 untouched', n;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT o.name, count(*) FROM staging.pahchan_punches p
--     JOIN staging.organisations o ON o.id = p.org_id GROUP BY 1;
--        -- expect Unicode Group 699, and nothing else
--
--   SELECT count(*) FROM staging.pahchan_regularisations;            -- 40
--   SELECT count(*) FROM punch_cleanup_20260823.punches_before;      -- 960
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
--   INSERT INTO staging.pahchan_punches
--     SELECT * FROM punch_cleanup_20260823.punches_before;
--
-- Drop `punch_cleanup_20260823` only once the owner confirms nothing is missing.
