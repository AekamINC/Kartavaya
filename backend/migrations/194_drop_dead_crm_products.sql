-- 194 · Drop staging.crm_products — the product table nothing has ever used.
--
-- ── PROVED DEAD, NOT ASSUMED DEAD ───────────────────────────────────────────
-- Measured against the LIVE catalogue on 2026-08-22, not against a migration
-- file and not from memory:
--
--   · rows                                    0
--   · foreign keys pointing at it             0   (pg_constraint, contype='f')
--   · views referencing it                    0   (pg_views definition ILIKE)
--   · references anywhere in this repository  0   (backend, frontend, mobile,
--                                                  migrations, tests — the name
--                                                  appears in no file)
--   · the migration that created it           none — it exists only in the
--                                                  database, which is itself
--                                                  part of why nothing reads it
--
-- Every real product is in `staging.ganit_products`: 106 rows, across all three
-- organisations (81 / 22 / 3). `routers/products.py` is now the one catalogue
-- and it reads that table; Ganit invoices, Vikray orders and the stock ledger
-- all already did.
--
-- The standard this project holds itself to is that looking wrong is not being
-- dead — `users.role` rows that read as corrupt are real, and the ten teams with
-- `org_id IS NULL` are live projects. This table is not in that category: it is
-- not merely unpopulated, it is unreferenced by anything that could populate it.
--
-- ── BACKED UP FIRST ─────────────────────────────────────────────────────────
-- A DROP is irreversible, so the shell is preserved with INCLUDING ALL (columns,
-- defaults, constraints, indexes) in `dead_tables_20260822`. The table holds no
-- rows, so the structure IS the whole backup — but it is taken anyway, because
-- "it was empty when I looked" is exactly the sentence that precedes a restore
-- nobody can perform. Recreating it is:
--
--   CREATE TABLE staging.crm_products
--     (LIKE dead_tables_20260822.crm_products INCLUDING ALL);
--
-- ── WRITE-PATH SIDE EFFECTS ─────────────────────────────────────────────────
-- None. Staging and production share this database, so this IS a production
-- schema change — but no code path on either branch reads, writes or joins this
-- table, so no running request can observe the drop. Nothing is migrated, no
-- customer row is rewritten, and the org tables are untouched.

BEGIN;

CREATE SCHEMA IF NOT EXISTS dead_tables_20260822;

CREATE TABLE IF NOT EXISTS dead_tables_20260822.crm_products
  (LIKE staging.crm_products INCLUDING ALL);

INSERT INTO dead_tables_20260822.crm_products
  SELECT * FROM staging.crm_products;

-- Refuses rather than drops if the table stopped being empty between the probe
-- and this run. A row here would mean something started writing it, which would
-- make every line of the reasoning above false.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM staging.crm_products;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'staging.crm_products holds % row(s) — it is no longer dead. Stop and re-measure.', n;
  END IF;
END $$;

DROP TABLE staging.crm_products;

COMMIT;
