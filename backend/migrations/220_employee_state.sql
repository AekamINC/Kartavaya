-- 220_employee_state.sql
--
-- ⚠ NOT APPLIED. Written 2026-08-25 and handed over with a risk report first,
--   per CLAUDE.md: "Always state write-path side effects before running a
--   migration; provide a short report of risks first." Staging and production
--   share this database. Nothing below has been run against it.
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   ADD COLUMN staging.manav_employees.state  × 1   (Phase 1.5)
--   CONSTRAINT staging.manav_employees_state_ck     (mirrors manav_holidays)
--   COMMENT    on the new column
--
-- ONE NULLABLE COLUMN WITH NO DEFAULT. Nothing is backfilled, no existing row
-- changes value, and no existing query can return a different answer than it
-- did yesterday. Re-running is a no-op.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Professional tax is a STATE levy, and this product cannot say which state
-- anybody works in. `services/skills/data/payroll_statutory.py:786` prints that
-- as a permanent limitation on every PT brief:
--
--     "Nothing records which state each employee works in, so the amounts below
--      are what the payroll run deducted and are not re-derived from any slab."
--
-- `staging.manav_holidays.state_code` has existed since migration 175 and
-- `staging.pay_professional_tax` is keyed on a state, so the employee is the
-- only end of the join that is missing. Phase 1.5.
--
-- ── WHICH CONVENTION, AND WHY IT IS NOT THE ONE 175 CHOSE ────────────────────
--
-- NUMERIC GST STATE CODE — '27', two digits, zero-padded.
--
-- Migration 180's header records that this database holds two incompatible
-- conventions and that choosing between them was deferred: `organisations` and
-- `pay_professional_tax` are numeric, `statute_calendar` is alphabetic, and
-- `manav_holidays_state_ck` was WIDENED to accept both rather than pick. This
-- column picks, and the tie is broken by the join it exists to serve — measured
-- read-only against the live database 2026-08-25:
--
--     SELECT state_code, state_name, count(*) FROM staging.pay_professional_tax
--     GROUP BY 1,2;   →   '24' Gujarat 4 · '27' Maharashtra 3 · '29' Karnataka 2
--
-- An alphabetic employee state joins to none of those and computes ZERO
-- professional tax for everybody, silently. `organisations.state_code` is
-- numeric too, and a state derived from a GSTIN is numeric because it IS the
-- first two characters. So the CHECK below mirrors the widened holiday one —
-- both spellings remain storable, because a row may arrive from an importer —
-- while every write path in `routers/manav.py` normalises to the numeric form
-- through `_clean_state`.
--
-- ── THE DEPARTMENT FOREIGN KEY IS DELIBERATELY NOT HERE ──────────────────────
--
-- Phase 1.5 also asks for `manav_employees.department → manav_departments`.
-- IT IS NOT IN THIS FILE, and the reason is data rather than taste. Measured
-- read-only 2026-08-25, on the database production writes to:
--
--     98 employees · 86 with a department · 30 department rows
--     12 rows hold department = ''      (the column default; NOT NULL)
--      1 row  holds 'Labour', for which no manav_departments row exists
--      0 duplicate (org_id, name) groups
--
-- A foreign key skips NULL, not ''. So 13 of 98 rows violate it on creation and
-- `ADD CONSTRAINT` fails outright. Making it pass means UPDATEing 12 live
-- personnel rows to NULL and INSERTing a department into a customer's live org
-- — production data, on a shared database, to satisfy a constraint. That is a
-- decision for the owner and a separate migration, not a side effect of adding
-- a state column.
--
-- The unique index the FK would need is left out with it, for a second and
-- independent reason: `delete_department` in `routers/manav.py` is a SOFT
-- delete (`is_active = FALSE`) and `create_department` inserts unconditionally,
-- so a plain UNIQUE (org_id, name) turns "remove a department, then add one
-- back with the same name" into a 500. Three inactive department rows already
-- exist live. A PARTIAL unique index (WHERE is_active) would survive that but
-- cannot back a foreign key, so the two requirements genuinely conflict and the
-- soft-delete behaviour has to be settled first.
--
-- ── WHAT HAPPENS ON THE DAY THIS RUNS ────────────────────────────────────────
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE and both write to the `staging`
-- schema. `ADD COLUMN ... text` with no default and no NOT NULL is a catalogue-
-- only change in PostgreSQL 17 — no table rewrite, no row touched, ACCESS
-- EXCLUSIVE held for the length of a catalogue update on a 98-row table. The
-- CHECK is added in a separate statement and is validated against 98 rows that
-- are all NULL, so it cannot fail.
--
-- Nothing changes for any user until somebody edits an employee: the column is
-- NULL on every row, and every reader treats NULL as "nobody has said".
--
-- ⚠ ORDERING: `routers/manav.py` names `state` in `_EMP_SAFE_COLS`, so the
--   employee list and detail endpoints SELECT it. THIS MIGRATION MUST BE
--   APPLIED BEFORE THAT CODE DEPLOYS, or every employee read answers 500 —
--   the same failure the `create_employee` comment in that file already
--   records once. `services/skills/action/attendance_auto_mark.py` guards
--   itself and is safe in either order.
--
-- ── REVERSIBILITY ────────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.manav_employees DROP CONSTRAINT IF EXISTS manav_employees_state_ck;
--   ALTER TABLE staging.manav_employees DROP COLUMN IF EXISTS state;
--
-- Dropping the column destroys any state anybody has typed since it ran, and
-- nothing else. No other object depends on it.

BEGIN;

ALTER TABLE staging.manav_employees
    ADD COLUMN IF NOT EXISTS state text;

-- A SEPARATE STATEMENT, not an inline CHECK on the ADD COLUMN above, and that
-- is load-bearing: `ADD COLUMN IF NOT EXISTS` skips the WHOLE clause when the
-- column already exists, constraint included, so a re-run against a database
-- that has the column would silently leave it unconstrained. Read pg_constraint,
-- never the migration ledger.
DO $ck$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manav_employees_state_ck') THEN
        ALTER TABLE staging.manav_employees ADD CONSTRAINT manav_employees_state_ck
            CHECK (
                state IS NULL
                OR state ~ '^[0-9]{1,2}$'   -- '27', as this product writes it
                OR state ~ '^[A-Z]{2,3}$'   -- 'MH', as statute_calendar writes it
            );
    END IF;
END
$ck$;

COMMENT ON COLUMN staging.manav_employees.state IS
    'Where this person works, as the NUMERIC GST state code (''27''). NULL means '
    'NOBODY HAS SAID — the state of all 98 rows the day this column was added — '
    'and every reader must treat it as unknown rather than as "not in this '
    'state": a state holiday still marks an employee whose state is NULL, and a '
    'send guard never suppresses for want of one. Joins staging.pay_professional_tax '
    '(state_code ''24''/''27''/''29'') and staging.organisations.state_code, both '
    'numeric. The alphabetic form is storable so an import cannot be refused, but '
    'routers/manav.py normalises every write to the numeric form via _clean_state.';

COMMIT;
