-- 148 · The Niyam system account — one per organisation, unbilled, hidden.
--
-- Owner's ruling, 17 August 2026: "a standard Niyam account, created by
-- default for every org, and not billed as a seat." The engine's third verb
-- (task.add_comment) needs a real users row because the comment read path
-- INNER JOINs public.users — a comment from a non-existent author is
-- invisible to everyone. A user row is not inert in this product, so the row
-- is marked and every surface that lists people excludes it:
--
--   · SEATS: costs nothing by construction — count_seats counts DISTINCT
--     user_roles rows holding a seat role, and the system account holds NO
--     user_roles row at all. Nothing to exclude; there is nothing to count.
--   · MEMBER LISTS / MENTION PICKERS / COUNTS: excluded by is_system in the
--     application queries (same commit as this migration).
--   · LOGIN: the password hash below matches no bcrypt/scrypt/pbkdf2 output,
--     and auth refuses is_system rows explicitly before ever hashing.
--
-- The account's org is encoded in user_id ('niyam_<32-hex org id>' — the
-- canonical `user_<hex>` shape with a distinguishing prefix) because
-- public.users has no org_id column and adding one for this single row would
-- misstate the user model (users are global; membership lives in user_roles).
-- The engine finds its actor by exact user_id, one indexed lookup.
--
-- SHARED-DATABASE NOTE: this touches public.users, which production also
-- reads. The new column is nullable-free with DEFAULT FALSE (a metadata-only
-- ALTER on Postgres 11+, no table rewrite); production's code never selects
-- is_system and its behaviour is unchanged. The INSERT adds rows production's
-- member queries WILL see until it deploys code carrying the exclusions —
-- accepted: production mounts 15 routers, none of which renders org member
-- lists (verified against 1aa49855's server.py), so no production surface
-- can display the row.

BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per organisation that does not already have one. Idempotent: the
-- user_id is deterministic, so re-running cannot create a second account.
INSERT INTO public.users (user_id, email, name, full_name,
                          password_hash, salt, role, is_system)
SELECT 'niyam_' || replace(o.id::text, '-', ''),
       'niyam+' || replace(o.id::text, '-', '') || '@system.kartavaya.invalid',
       'Niyam',
       'Niyam',
       -- Not a hash in any scheme the login path knows. The '!' prefix is the
       -- OpenSSH convention for a locked account; the text after it says why
       -- to any human reading the row.
       '!system-account-cannot-log-in',
       '!none',
       'member',
       TRUE
FROM staging.organisations o
WHERE NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.user_id = 'niyam_' || replace(o.id::text, '-', '')
);

COMMIT;

-- DOWN (manual, if ever needed):
--   DELETE FROM public.users WHERE is_system = TRUE;
--   ALTER TABLE public.users DROP COLUMN is_system;
-- The DELETE must come first, and any task comments authored by the account
-- become invisible the moment it runs — which is the reason not to run it.
