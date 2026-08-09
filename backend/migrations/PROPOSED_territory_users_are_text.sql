-- PROPOSED — NOT APPLIED. Staging and production share one database.
--
-- ── THE TERRITORY FEATURE CANNOT STORE A USER, AND NEVER COULD ──────────────
--
-- `staging.graha_territories.assigned_users` is `UUID[]` (migration 023). But
-- `users.user_id` is TEXT and its values look like `user_admin001` — every
-- other table in the product that points at a person uses TEXT for exactly that
-- reason (`staging.user_roles.user_id`, `teams.owner_user_id`, migration 016).
--
-- So assigning anybody to a territory raises an invalid-input-syntax error from
-- asyncpg the moment a real user id reaches the array. The owner reported
-- Territories as "half baked". This is the half that is missing: not the UI,
-- the column type. The screen's "User ID" text box was the only input that
-- could ever have appeared to work, and only by typing something that happened
-- to parse as a UUID.
--
-- ── THE CONVERSION ──────────────────────────────────────────────────────────
--
-- Safe by inspection: a UUID casts to text losslessly, and any row that does
-- hold values holds ones that were never valid user ids anyway. COUNT THE ROWS
-- FIRST all the same — `SELECT COUNT(*) FROM staging.graha_territories WHERE
-- array_length(assigned_users, 1) > 0` — and read the number before running
-- this.

ALTER TABLE staging.graha_territories
  ALTER COLUMN assigned_users TYPE text[] USING assigned_users::text[];

ALTER TABLE staging.graha_territories
  ALTER COLUMN assigned_users SET DEFAULT '{}';

COMMENT ON COLUMN staging.graha_territories.assigned_users IS
  'users.user_id values, which are TEXT — NOT uuids. Was uuid[] until '
  '2026-08-09, which made the column unable to hold a real user id.';
