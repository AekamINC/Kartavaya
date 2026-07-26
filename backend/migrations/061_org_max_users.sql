-- migration 061: per-org user allowance
--
-- The seat model had nowhere to live. `max_users` exists only on
-- staging.plans, and it is NULL on every plan except `free` (5) — so a plan
-- sold per user could not record how many users a given org had actually
-- bought. The only place a per-org figure could go was
-- organisations.monthly_price, which is a rupee amount, not a seat count.
--
-- Decided: basic allows 5 users, rising in steps of 5, and platform admins set
-- the figure per org at creation.
--
-- Two columns, because those are two different facts:
--   plans.max_users          the tier's DEFAULT allowance
--   organisations.max_users  what this org actually bought (NULL = use the plan)
--
-- Resolution is COALESCE(o.max_users, p.max_users). A NULL on the org means
-- "no override", which is not the same as "unlimited" — and a NULL on BOTH
-- still means unlimited, which is the current behaviour for every plan other
-- than free and must not silently become 0.

ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS max_users INT;

COMMENT ON COLUMN staging.organisations.max_users IS
    'Seats bought by this org. NULL = fall back to plans.max_users. '
    'Set by platform admins at org creation; steps of 5 by convention, '
    'not enforced at the column so a negotiated 12 remains expressible.';

-- The basic tier's default allowance. Written against `basic` and `free`
-- because the free→basic rename is a separate pending migration; whichever
-- code exists gets the value, and the other updates zero rows.
UPDATE staging.plans SET max_users = 5
 WHERE code IN ('basic', 'free')
   AND max_users IS DISTINCT FROM 5;

-- Guard against a seat count that can never be satisfied. Deliberately allows
-- NULL (unlimited / inherit) and rejects 0 and negatives, which would lock an
-- org out of adding even its own owner.
ALTER TABLE staging.organisations
    DROP CONSTRAINT IF EXISTS organisations_max_users_positive;
ALTER TABLE staging.organisations
    ADD CONSTRAINT organisations_max_users_positive
    CHECK (max_users IS NULL OR max_users > 0);
