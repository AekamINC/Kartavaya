-- 191 · The database stops answering two questions the firm has to answer.
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--
--   ALTERS   staging.manav_commission_schemes — `basis` and `period` each
--            DROP DEFAULT and DROP NOT NULL.
--   ADDS     one CHECK, as its own guarded ALTER TABLE ... ADD CONSTRAINT,
--            never inline — see THE INLINE TRAP in migration 188.
--   COMMENTS on the two columns.
--   DROPS    no table, no column, no index, no constraint, no trigger.
--   CREATES  nothing.
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--   Reads no customer row. There are none — see MEASURED.
--
-- IF IT RUNS TWICE: nothing happens. DROP DEFAULT on a column with no default
-- is a no-op, and COMMENT ON is idempotent by nature.
--
-- ── MEASURED, 2026-08-22, read-only against the live database ───────────────
--
--     SELECT count(*) FROM staging.manav_commission_schemes;   -- 0
--     SELECT count(*) FROM staging.manav_commission_bands;     -- 0
--     SELECT count(*) FROM staging.manav_bonus_awards;         -- 0
--
--     column_default, information_schema.columns:
--       basis   'turnover'::text     NOT NULL
--       period  'monthly'::text      NOT NULL
--
-- Staging and production share this database, so those zeroes are the whole
-- product. No firm has recorded a commission arrangement yet, which is why
-- there is no backfill: there is no row that was written under the old
-- defaults and would need its terms re-stated. VERIFY 1 proves the count is
-- still nought at COMMIT and rolls the whole transaction back if it is not.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- The owner's rule, in his words: "no default commission percentage please org
-- decide its own commission". `rate_percent` obeyed it. `revenue_scope` obeyed
-- it — migration 185 left it NULL-able with no default and 189 added
-- `..._eligible_needs_scope_ck` so an eligible scheme must state one. These two
-- columns sat beside them still answering, and they decide money just as
-- directly:
--
--   basis    'turnover' vs 'gross_profit' are DIFFERENT NUMBERS for the same
--            sales. A firm paying 3% of gross profit that never said so would
--            be paid 3% of turnover, larger by the whole cost of what was sold.
--
--   period   'monthly' vs 'annual' is the same agreed rate paid TWELVE TIMES
--            instead of once. This is the more expensive of the two and the
--            easier to miss, because both readings look correct on screen.
--
-- The defaults were not neutral. They were this product deciding a commercial
-- term on a firm's behalf and leaving no trace that it had.
--
-- ── WHY NULL-ABLE, AND WHY A CHECK RATHER THAN NOT NULL ─────────────────────
--
-- The obvious move is to keep NOT NULL and simply remove the default, so an
-- omitting INSERT fails. That was written first and it is WRONG, because of
-- what an INELIGIBLE scheme is.
--
-- A scheme with `eligible = false` is a recorded "this person is not on
-- commission". It has no basis and no settlement period, because nothing is
-- being measured and nothing is settling. NOT NULL would force a firm to
-- answer "measured on turnover or gross profit?" about somebody who is paid
-- no commission at all — meaningless, and exactly the kind of blocking the
-- owner has rejected repeatedly: "we dont know how company operates so we
-- ont block".
--
-- So the rule is CONDITIONAL, and this schema already states two conditional
-- rules of precisely this shape:
--
--     manav_commission_schemes_eligible_needs_scope_ck   (migration 189)
--         CHECK (eligible IS NOT TRUE OR revenue_scope IS NOT NULL)
--     manav_commission_schemes_eligible_needs_rate_ck    (migration 189)
--         CHECK (eligible IS NOT TRUE OR (rate_percent IS NOT NULL AND ...))
--
-- This file adds the third member of that family. NULL is legal and means
-- "not stated, because it does not apply". The moment somebody IS on
-- commission, both must be present.
--
-- The existing value checks stay exactly as they are and need no change:
-- `..._basis_ck` and `..._period_ck` are `col = ANY (ARRAY[...])`, which
-- evaluates to NULL — not false — for a NULL column, and a CHECK passes on
-- NULL. So an absent value is permitted and a WRONG one still is not.
--
-- Nothing downstream can meet a NULL it does not expect: `compute()` returns
-- NOT_ON_COMMISSION at its first line for an ineligible scheme, before it
-- reads `basis`, and `commission_line_label` is only reached by a scheme that
-- pays.
--
-- ── WRITE-PATH EFFECT, stated plainly ───────────────────────────────────────
--
-- From the moment this commits, an INSERT into
-- `staging.manav_commission_schemes` with `eligible = true` that does not
-- name `basis` or does not name `period` raises a check violation
-- (`..._eligible_needs_terms_ck`) instead of silently recording 'turnover' /
-- 'monthly'. An INSERT with `eligible = false` may leave both NULL, and that
-- is the intended reading: not stated, because it does not apply.
--
-- Exactly one INSERT exists in the repository — `routers/manav.py`, the
-- `POST /v1/manav/commission-schemes` handler — and it names both columns on
-- every call, passing NULL only where the firm left them blank on an
-- INELIGIBLE scheme. It validates first through `services.commission.Scheme`,
-- which rejects a value outside BASES/PERIODS and refuses an eligible scheme
-- missing either — both with a message written for a person, so the CHECK
-- below is the backstop and never the thing a user meets. Checked:
--     grep -rn "manav_commission_schemes" backend/ --include=*.py
-- reaches routers/manav.py (this INSERT and reads), routers/vetana.py (reads),
-- services/commission.py and services/report_defs/commission_reports.py
-- (reads), and the tests. Nothing else writes the table.
--
-- So this tightening cannot break a live path. It closes the one a future
-- caller could have walked into.
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.manav_commission_schemes
--       DROP CONSTRAINT IF EXISTS
--           manav_commission_schemes_eligible_needs_terms_ck,
--       ALTER COLUMN basis  SET DEFAULT 'turnover',
--       ALTER COLUMN period SET DEFAULT 'monthly';
--
-- Restoring NOT NULL is NOT part of the reversal and must not be attempted
-- blindly: by then the table may hold ineligible schemes with NULL terms, and
-- `SET NOT NULL` would fail against exactly the rows this file made legal.
--
-- Otherwise safe on any day and loses nothing: a default only ever applies
-- to an INSERT that omits the column, and no recorded row's stored value
-- changes in either direction. Restore it only alongside restoring the UI
-- defaults, or the screen will keep refusing what the database would have
-- accepted.
--
-- ── HOW TO APPLY ────────────────────────────────────────────────────────────
--
--   railway run -e staging -s Kartavya -- psql "$DATABASE_URL" -f \
--       backend/migrations/191_commission_states_its_own_terms.sql
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. This apply touches production,
-- and its entire production effect is the one INSERT behaviour described above.
-- Read section 3's NOTICEs; if the transaction rolls back the RAISE says which
-- claim failed, and nothing is left half-applied because everything is in one
-- transaction.

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · The schema, the table and the two columns are here.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'staging') THEN
        RAISE EXCEPTION
            'GUARD 1: schema "staging" does not exist. This is not the '
            'Kartavaya database.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'staging'
           AND table_name   = 'manav_commission_schemes'
    ) THEN
        RAISE EXCEPTION
            'GUARD 1: staging.manav_commission_schemes does not exist. '
            'Migration 185 has not been applied.';
    END IF;

    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'staging'
           AND table_name   = 'manav_commission_schemes'
           AND column_name IN ('basis', 'period')) <> 2 THEN
        RAISE EXCEPTION
            'GUARD 1: basis and/or period is missing from '
            'staging.manav_commission_schemes.';
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 2 · The table is empty.
--
--   Not a formality. This file removes the value an omitting INSERT would have
--   received. With rows present, the reader must first establish that every
--   recorded scheme states terms a HUMAN chose rather than terms that arrived
--   from the default — and that cannot be established from the data, because a
--   stored 'monthly' looks identical either way. If this guard fires, do NOT
--   force it: the question to answer first is which firms recorded a scheme
--   and whether they meant what the column says.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard2$
DECLARE
    n_schemes bigint;
BEGIN
    SELECT count(*) INTO n_schemes FROM staging.manav_commission_schemes;

    IF n_schemes <> 0 THEN
        RAISE EXCEPTION
            'GUARD 2: staging.manav_commission_schemes holds % row(s). This '
            'file was written against an empty table (measured 0 on '
            '2026-08-22) and its header explains what to check before '
            'applying it to recorded arrangements.', n_schemes;
    END IF;

    RAISE NOTICE 'GUARD 2 ok: manav_commission_schemes holds 0 rows.';
END
$guard2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 · Drop the two guesses, and let an ineligible scheme say nothing.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.manav_commission_schemes
    ALTER COLUMN basis  DROP DEFAULT,
    ALTER COLUMN period DROP DEFAULT,
    ALTER COLUMN basis  DROP NOT NULL,
    ALTER COLUMN period DROP NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 · ...and require them the moment somebody IS on commission.
--
--   Guarded and separate, never inline on a column clause. Third member of
--   the family 189 started: eligible => a scope, eligible => a rate, and now
--   eligible => terms.
-- ═══════════════════════════════════════════════════════════════════════════
DO $terms$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'manav_commission_schemes_eligible_needs_terms_ck'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        ALTER TABLE staging.manav_commission_schemes
            ADD CONSTRAINT manav_commission_schemes_eligible_needs_terms_ck
            CHECK (eligible IS NOT TRUE
                   OR (basis IS NOT NULL AND period IS NOT NULL));
        RAISE NOTICE 'SECTION 2: eligible_needs_terms_ck added.';
    ELSE
        RAISE NOTICE 'SECTION 2: eligible_needs_terms_ck already present.';
    END IF;
END
$terms$;

COMMENT ON COLUMN staging.manav_commission_schemes.basis IS
    'What the commission is measured on: turnover, or gross profit. NO DEFAULT '
    '(migration 191) — the two are different numbers for the same sales, so the '
    'firm states it and this product does not guess. NULL is legal and means '
    'not stated because it does not apply; an ELIGIBLE scheme must carry one, '
    'enforced by manav_commission_schemes_eligible_needs_terms_ck.';

COMMENT ON COLUMN staging.manav_commission_schemes.period IS
    'How often the arrangement settles: monthly, quarterly or annual. NO '
    'DEFAULT (migration 191) — monthly and annual are the same agreed rate paid '
    'twelve times or once, so the firm states it. NULL is legal on an INELIGIBLE '
    'scheme only, enforced by manav_commission_schemes_eligible_needs_terms_ck. '
    'Together with revenue_scope '
    'this is the scheme identity: a person may hold one monthly and one annual '
    'arrangement at the same time and be paid by both.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 · VERIFY. Every claim in the header, read back out of the
--             catalogue. Any failure raises and the whole file rolls back.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_schemes   bigint;
    d_basis     text;
    d_period    text;
    null_basis  text;
    null_period text;
BEGIN
    -- VERIFY 1 · still empty at COMMIT time. A row inserted DURING this
    -- transaction by another session would have taken the old default, and the
    -- header's central claim would be false.
    SELECT count(*) INTO n_schemes FROM staging.manav_commission_schemes;
    IF n_schemes <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 1: % row(s) appeared during the apply. Rolling back — they '
            'may carry defaulted terms.', n_schemes;
    END IF;

    -- VERIFY 2 · both defaults are gone.
    SELECT column_default INTO d_basis
      FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='manav_commission_schemes'
       AND column_name='basis';
    SELECT column_default INTO d_period
      FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='manav_commission_schemes'
       AND column_name='period';

    IF d_basis IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: basis still defaults to %.', d_basis;
    END IF;
    IF d_period IS NOT NULL THEN
        RAISE EXCEPTION 'VERIFY 2: period still defaults to %.', d_period;
    END IF;

    -- VERIFY 3 · both are NULL-able now, so an ineligible scheme may leave
    -- them unanswered rather than having terms invented for it.
    SELECT is_nullable INTO null_basis
      FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='manav_commission_schemes'
       AND column_name='basis';
    SELECT is_nullable INTO null_period
      FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='manav_commission_schemes'
       AND column_name='period';

    IF null_basis <> 'YES' OR null_period <> 'YES' THEN
        RAISE EXCEPTION
            'VERIFY 3: NOT NULL is still set — basis is_nullable=%, '
            'period is_nullable=%. An ineligible scheme could not be '
            'recorded without inventing terms for it.',
            null_basis, null_period;
    END IF;

    -- VERIFY 4 · the conditional rule is really there, read out of
    -- pg_constraint BY NAME rather than assumed from the ALTER above.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'manav_commission_schemes_eligible_needs_terms_ck'
           AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        RAISE EXCEPTION
            'VERIFY 4: eligible_needs_terms_ck is absent. Without it an '
            'eligible scheme could be stored with no terms at all.';
    END IF;

    -- VERIFY 5 · and it REFUSES. Proved by attempting the write inside a
    -- subtransaction, because a constraint that exists and does not bite is
    -- the exact failure this family of checks was added to prevent. The
    -- BEGIN/EXCEPTION block rolls the attempt back on its own; nothing is
    -- left behind either way, and VERIFY 1 already proved the table empty.
    BEGIN
        INSERT INTO staging.manav_commission_schemes
            (org_id, employee_id, eligible, basis, period, revenue_scope,
             effective_from)
        VALUES ('00000000-0000-0000-0000-000000000000'::uuid,
                '00000000-0000-0000-0000-000000000000'::uuid,
                TRUE, NULL, NULL, 'own', CURRENT_DATE);
        RAISE EXCEPTION
            'VERIFY 5: an eligible scheme with NO basis and NO period was '
            'ACCEPTED. The constraint is not doing its job.';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE
                'VERIFY 5 ok: an eligible scheme with no terms is refused.';
        WHEN foreign_key_violation THEN
            -- The employee FK can fire first. That is still a refusal, but
            -- it is not the refusal under test, so say so rather than
            -- counting it as a pass.
            RAISE NOTICE
                'VERIFY 5 inconclusive: the employee FK refused first. The '
                'CHECK is present (VERIFY 4) but was not exercised here.';
    END;

    RAISE NOTICE 'VERIFY ok: basis and period are NULL-able with no default, '
                 'gated on eligible; the table is still empty.';
END
$verify$;

COMMIT;
