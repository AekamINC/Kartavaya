-- ═════════════════════════════════════════════════════════════════════════════
-- 189 · The firm states its own commission terms. The product supplies none.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- OWNER, 2026-08-21: "no default commission percentage please org decide its
-- own commission".
--
-- 185 shipped `rate_percent numeric(6,3) NOT NULL DEFAULT 0`, and the reasoning
-- for the zero was that it is the safe number: a row written carelessly pays
-- nothing rather than paying something invented. That reasoning is wrong in a
-- way worth writing down, because it is the same shape as several other bugs
-- this product has had.
--
-- A default is not a safe value. It is an ANSWER GIVEN ON SOMEBODY ELSE'S
-- BEHALF. Combined with `eligible`, the zero produces a state that is both
-- reachable and silently wrong:
--
--     eligible = TRUE, rate_percent = 0
--
-- which reads on every screen as "this person is on commission", computes a
-- correct-looking ₹0 every period, and is indistinguishable from a person who
-- sold nothing. HR believes the arrangement is recorded. The consultant is
-- owed money. Nothing anywhere is red. That is worse than a missing value,
-- because a missing value asks a question and a wrong zero answers one.
--
-- The same argument, in the same words, is why the reports refuse to print ₹0
-- for an unattributed person: ₹0 is a claim about performance, and the truth
-- was that the product did not know.
--
-- So: no default, and the impossible state is made impossible.
--
--   · `rate_percent` becomes NULLABLE with NO default. NULL means "nobody has
--     said yet", which is the truth for all of them.
--   · A CHECK makes `eligible = TRUE` require a rate that is present and above
--     zero. An eligible scheme without terms cannot be stored at all.
--
-- A rate of exactly 0% with `eligible = TRUE` is therefore refused. If a firm
-- ever means "on the scheme, currently earning nothing", that is
-- `eligible = FALSE` with a note, and the two are different facts that should
-- not share a representation.
--
-- ── WHAT THIS DELIBERATELY LEAVES ALONE ─────────────────────────────────────
--
-- Three other columns carry defaults and are NOT changed here, because each is
-- a different kind of default and only one of them decides money:
--
--   `eligible` DEFAULT FALSE       — a default that REFUSES. A careless row
--                                    puts nobody on commission. Safe by
--                                    construction, and the opposite of the
--                                    problem above.
--   `threshold_amount` DEFAULT 0   — 0 means "from the first rupee", a real and
--                                    common arrangement rather than an absent
--                                    one. It only ever applies to a scheme
--                                    whose rate the firm has now had to state.
--   `basis` / `threshold_mode` /   — these pick a POLICY (turnover vs gross
--   `period`                         profit, excess vs whole, monthly vs
--                                    quarterly) and are arguably the same
--                                    objection. They are flagged to the owner
--                                    rather than changed unasked: the
--                                    instruction named the percentage, and
--                                    quietly widening it would be the same
--                                    fault as defaulting it.
--
-- ── SAFETY ──────────────────────────────────────────────────────────────────
--
-- `staging.manav_commission_schemes` holds ZERO rows — measured read-only on
-- 2026-08-21, and asserted again by the guard below before anything is
-- altered. So there is no data to migrate, no backfill, and no row that could
-- fail the new constraint. If that ever stops being true this file refuses to
-- run rather than deciding what an existing row meant.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   BEGIN;
--   ALTER TABLE staging.manav_commission_schemes
--       DROP CONSTRAINT IF EXISTS manav_commission_schemes_eligible_needs_rate_ck;
--   UPDATE staging.manav_commission_schemes SET rate_percent = 0
--    WHERE rate_percent IS NULL;
--   ALTER TABLE staging.manav_commission_schemes
--       ALTER COLUMN rate_percent SET DEFAULT 0,
--       ALTER COLUMN rate_percent SET NOT NULL;
--   COMMIT;
--
-- Note the rollback has to INVENT a rate for any row written in the meantime,
-- which is exactly the fault this migration removes. Roll back only while the
-- table is still empty.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Guards ──────────────────────────────────────────────────────────────────

DO $guard1$
BEGIN
    IF to_regclass('staging.manav_commission_schemes') IS NULL THEN
        RAISE EXCEPTION
            'GUARD 1: staging.manav_commission_schemes does not exist. '
            'Migration 185 has not been applied; apply it first.';
    END IF;
END
$guard1$;

DO $guard2$
DECLARE
    existing int;
BEGIN
    SELECT count(*) INTO existing FROM staging.manav_commission_schemes;
    IF existing <> 0 THEN
        RAISE EXCEPTION
            'GUARD 2: % scheme row(s) already exist. This file assumes an empty '
            'table: it makes rate_percent nullable and forbids an eligible '
            'scheme without a rate, and it will not guess what a stored row '
            'meant. Decide row by row, then re-run.', existing;
    END IF;
END
$guard2$;

DO $guard3$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'staging'
          AND table_name   = 'manav_commission_schemes'
          AND column_name  = 'rate_percent'
    ) THEN
        RAISE EXCEPTION
            'GUARD 3: rate_percent is not on the table. Something other than '
            'migration 185 built this; stop and look.';
    END IF;
END
$guard3$;

-- ── The change ──────────────────────────────────────────────────────────────

ALTER TABLE staging.manav_commission_schemes
    ALTER COLUMN rate_percent DROP DEFAULT;

ALTER TABLE staging.manav_commission_schemes
    ALTER COLUMN rate_percent DROP NOT NULL;

-- Separate ADD CONSTRAINT, guarded on pg_constraint by BOTH name and relation.
-- A constraint name is unique per TABLE in Postgres, not per database, so a
-- name-only lookup can be satisfied by an identically named constraint on some
-- other table and skip the ALTER that matters.
DO $constraint$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname  = 'manav_commission_schemes_eligible_needs_rate_ck'
          AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) THEN
        ALTER TABLE staging.manav_commission_schemes
            ADD CONSTRAINT manav_commission_schemes_eligible_needs_rate_ck
            CHECK (
                eligible IS NOT TRUE
                OR (rate_percent IS NOT NULL AND rate_percent > 0)
            );
    END IF;
END
$constraint$;

COMMENT ON COLUMN staging.manav_commission_schemes.rate_percent IS
    'Percent, three decimals: 2.5, 7.125. NOT a fraction. NULL means the firm '
    'has not stated its terms yet, and NULL is the only honest value for that. '
    'There is deliberately NO DEFAULT: a default rate is an answer given on the '
    'firm''s behalf, and the old DEFAULT 0 combined with eligible=TRUE to make '
    'a scheme that read as configured, computed a plausible zero every period, '
    'and owed somebody money nobody could see. An eligible scheme must carry a '
    'rate above zero — see manav_commission_schemes_eligible_needs_rate_ck.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
--
-- Everything asserted inside the transaction, so a failure rolls the whole file
-- back rather than leaving the column half-changed.

DO $verify$
DECLARE
    still_has_default text;
    still_not_null    boolean;
    has_check         boolean;
    rows_now          int;
BEGIN
    SELECT column_default, (is_nullable = 'NO')
      INTO still_has_default, still_not_null
      FROM information_schema.columns
     WHERE table_schema = 'staging'
       AND table_name   = 'manav_commission_schemes'
       AND column_name  = 'rate_percent';

    IF still_has_default IS NOT NULL THEN
        RAISE EXCEPTION
            'VERIFY: rate_percent still carries a default (%). The entire point '
            'of this file is that the product supplies no rate.', still_has_default;
    END IF;

    IF still_not_null THEN
        RAISE EXCEPTION
            'VERIFY: rate_percent is still NOT NULL, so "nobody has said yet" '
            'cannot be represented and the old zero comes back through the '
            'front door.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname  = 'manav_commission_schemes_eligible_needs_rate_ck'
          AND conrelid = 'staging.manav_commission_schemes'::regclass
    ) INTO has_check;

    IF NOT has_check THEN
        RAISE EXCEPTION
            'VERIFY: the eligible-needs-a-rate CHECK is absent. Without it an '
            'eligible scheme with no terms is storable, which is the bug.';
    END IF;

    SELECT count(*) INTO rows_now FROM staging.manav_commission_schemes;
    IF rows_now <> 0 THEN
        RAISE EXCEPTION
            'VERIFY: the table holds % row(s) and held none when this file '
            'started. This migration writes nothing.', rows_now;
    END IF;
END
$verify$;

COMMIT;
