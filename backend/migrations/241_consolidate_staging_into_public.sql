-- 241_consolidate_staging_into_public.sql
--
-- Move every object out of `staging` and into `public`, so the product runs on
-- ONE schema. Written 2026-08-29. NOT YET APPLIED.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- READ THIS BEFORE RUNNING. Four facts decide whether this is safe.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. IT IS CATALOG-ONLY. `ALTER ... SET SCHEMA` rewrites a namespace pointer.
--    No row is copied, deleted or rewritten at any point. Indexes, constraints,
--    triggers, RLS policies, comments and owned sequences travel with the table.
--    Every intra-database reference (FKs, view bodies, defaults, trigger
--    bindings) is stored by OID, not by name, so ORDER DOES NOT MATTER and the
--    circular cross-schema FK does not block anything. Measured:
--        staging -> public FKs : 15  (all to public.users)
--        public -> staging FKs :  1  (org_settings.org_id -> organisations)
--
-- 2. THE CODE MUST DEPLOY IN THE SAME WINDOW. Branch `schema-consolidation`
--    rewrites 3,004 identifiers `staging.X` -> `public.X`. Deployed before this
--    runs, every module route returns 42P01; run before the deploy and the old
--    code returns 3F000. A view-based shim CANNOT bridge the gap: the backend
--    carries 220 `ON CONFLICT` clauses and Postgres rejects those against a
--    view. Stop both Railway services first — this takes ACCESS EXCLUSIVE on
--    258 tables and must not race live traffic.
--
-- 3. RLS IS ALREADY HANDLED — do not skip this check anyway.
--    `public` is exposed to PostgREST and `staging` is not; Supabase's own
--    advisor raises `rls_disabled_in_public` for `public` and never for
--    `staging`. Moving RLS-disabled tables into `public` would publish payroll,
--    employee PII, invoices and signed documents to anyone holding the anon key
--    — silently, with no error and no log. On 2026-08-29 RLS was ENABLED on all
--    258 staging tables (deny-all, matching what public's 40 already do) and a
--    live read was re-verified afterwards. Section 0 below re-asserts it rather
--    than trusting this comment.
--
-- 4. THE DROP IS NOT HERE. `DROP SCHEMA staging` is a separate, named,
--    owner-approved step, run only after a full traffic cycle on an emptied
--    shell. This file leaves `staging` in place and empty.
--
-- REVERSAL: catalog-only, seconds. `CREATE SCHEMA staging;` then
-- `ALTER ... SET SCHEMA staging` for every row of the manifest written in
-- section 1, then restore the 14 original function bodies from the same
-- manifest. Data is never at risk from the move itself.
--
-- Data backup taken before this was written and VERIFIED row-by-row:
--   premerge_backup_20260829 — 258 tables, 29,608 rows, 0 mismatches.

BEGIN;

-- ── 0. REFUSE TO RUN IF THE PRECONDITIONS ARE NOT TRUE ───────────────────────
DO $$
DECLARE n_collide int; n_norls int; n_tables int;
BEGIN
  IF to_regclass('staging.organisations') IS NULL THEN
    RAISE EXCEPTION 'staging.organisations is absent — this migration has already run, or the schema is not what it should be.';
  END IF;

  -- A name collision would make SET SCHEMA fail mid-way. Check every object
  -- class, not just tables: relations and functions share a namespace.
  SELECT count(*) INTO n_collide FROM (
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='staging' AND c.relkind IN ('r','v','m','S','p','f')
    INTERSECT
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'  AND c.relkind IN ('r','v','m','S','p','f')
  ) x;
  IF n_collide > 0 THEN
    RAISE EXCEPTION 'REFUSING: % relation name(s) exist in BOTH schemas. SET SCHEMA would fail part-way through.', n_collide;
  END IF;

  -- The silent one. A table landing in `public` without RLS becomes readable
  -- over the Data API by anyone holding the anon key, which is compiled into
  -- the shipped browser bundle.
  SELECT count(*) INTO n_norls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='staging' AND c.relkind='r' AND NOT c.relrowsecurity;
  IF n_norls > 0 THEN
    RAISE EXCEPTION 'REFUSING: % staging table(s) have RLS disabled. Moving them into the PostgREST-exposed schema publishes them. Enable RLS first.', n_norls;
  END IF;

  SELECT count(*) INTO n_tables FROM pg_tables WHERE schemaname='staging';
  RAISE NOTICE 'preconditions OK: % tables to move, 0 collisions, 0 without RLS', n_tables;
END $$;

-- ── 1. MANIFEST — capture BEFORE the move ────────────────────────────────────
-- After the move `public` holds 300 tables and NOTHING in the catalogue records
-- which 258 arrived from `staging`. Without this, reversal is guesswork.
CREATE SCHEMA IF NOT EXISTS premerge_backup_20260829;
DROP TABLE IF EXISTS premerge_backup_20260829.consolidation_manifest;
CREATE TABLE premerge_backup_20260829.consolidation_manifest AS
SELECT 'relation'::text AS kind, c.relkind::text AS subkind, c.relname AS name,
       NULL::text AS args, NULL::text AS definition
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'staging' AND c.relkind IN ('r','v','m','S','p','f')
UNION ALL
SELECT 'function', 'f', p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_functiondef(p.oid)          -- the ORIGINAL body, for reversal
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'staging';

-- ── 2. MOVE — generated from the catalogue, never hand-typed ─────────────────
-- Hand-listing 277 statements guarantees drift. This reads what is actually
-- there, so the migration cannot disagree with the database.
DO $$
DECLARE r record; n_t int := 0; n_v int := 0; n_f int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='staging' AND c.relkind='r' ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE staging.%I SET SCHEMA public', r.relname);
    n_t := n_t + 1;
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='staging' AND c.relkind='v' ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER VIEW staging.%I SET SCHEMA public', r.relname);
    n_v := n_v + 1;
  END LOOP;

  FOR r IN
    SELECT p.proname AS nm, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='staging' ORDER BY p.proname
  LOOP
    EXECUTE format('ALTER FUNCTION staging.%I(%s) SET SCHEMA public', r.nm, r.args);
    n_f := n_f + 1;
  END LOOP;

  RAISE NOTICE 'moved % tables, % views, % functions', n_t, n_v, n_f;
END $$;

-- ── 3. FUNCTION BODIES — the one thing SET SCHEMA does NOT fix ───────────────
-- `prosrc` is TEXT resolved at run time. It does not follow the object. 11 of
-- the 14 functions hardcode `staging.` inside their body and would break the
-- moment the schema goes. Rewrite each body via pg_get_functiondef.
DO $$
DECLARE r record; src text; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosrc ILIKE '%staging.%'
  LOOP
    src := replace(pg_get_functiondef(r.oid), 'staging.', 'public.');
    EXECUTE src;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'rewrote % function bodies', n;
END $$;

-- `manav_commission_terms_stated` pins search_path to `pg_catalog, staging`
-- via proconfig, which also does not follow the move.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND array_to_string(p.proconfig, ',') ILIKE '%staging%'
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = pg_catalog, public',
                   r.proname, r.args);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'repinned search_path on % function(s)', n;
END $$;

-- ── 4. PROVE IT ──────────────────────────────────────────────────────────────
DO $$
DECLARE left_over int; bodies int; norls int; tot int;
BEGIN
  SELECT count(*) INTO left_over FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='staging' AND c.relkind IN ('r','v','m','S','p','f');
  IF left_over > 0 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: % relation(s) still in staging', left_over;
  END IF;

  SELECT count(*) INTO bodies FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosrc ILIKE '%staging.%';
  IF bodies > 0 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: % function body/bodies still name staging.', bodies;
  END IF;

  -- Anti-vacuity: if the manifest is empty the checks above pass trivially.
  SELECT count(*) INTO tot FROM premerge_backup_20260829.consolidation_manifest;
  IF tot < 250 THEN
    RAISE EXCEPTION 'POST-CHECK FAILED: manifest holds only % rows — it did not capture the schema, so reversal is impossible and the checks above proved nothing.', tot;
  END IF;

  SELECT count(*) INTO norls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
  RAISE NOTICE 'OK. staging is empty; % public table(s) still lack RLS — expected 2 (both 0 rows), investigate anything more.', norls;
END $$;

COMMIT;

-- ── AFTER THIS MIGRATION, IN ORDER ───────────────────────────────────────────
--  1. Set DB_SCHEMA=public on BOTH Railway services (or delete the variable and
--     the db.py branch — `SET search_path TO staging, public` naming a dropped
--     schema succeeds silently, so its removal has no observable symptom).
--  2. Deploy branch `schema-consolidation`.
--  3. Start both services. Verify /api/health on each AND confirm meta.branch.
--  4. Re-run the Supabase advisor. Diff the exposure snapshot. Any NEW
--     `rls_disabled_in_public` ERROR is the failure with no other symptom.
--  5. Exercise one read and one write per module against the real product.
--  6. Only then, as a separate approved step: DROP SCHEMA staging RESTRICT.
--     RESTRICT, never CASCADE.
