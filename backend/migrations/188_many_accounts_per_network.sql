-- 188 · One client, many accounts per network — and the key finally names the
--       thing it is supposed to be unique about.
--
--       WRITTEN, NOT APPLIED. Nothing in this repository has run this file and
--       no application code applies it. See "HOW TO APPLY" at the foot of the
--       header before anybody does.
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--
--   ALTERS   staging.hub_social_accounts — account_id becomes NOT NULL
--   ADDS     four CHECK constraints, each as its own guarded
--            `ALTER TABLE … ADD CONSTRAINT`, never inline — see THE INLINE
--            TRAP below.
--   COMMENTS on the table, on the existing UNIQUE constraint, and on five
--            columns.
--   DROPS    NOTHING. No table, no column, no index, no constraint. The unique
--            constraint this file is about is the one that has been on the
--            table since migration 017 and it is still there afterwards, by
--            the same name, over the same three columns.
--   CREATES  no table, no index, no function, no trigger, no view.
--   INSERTS nothing. UPDATEs nothing. DELETEs nothing. SEEDS nothing.
--   Reads no customer row. There are none to read — see MEASURED below.
--
-- IF IT RUNS TWICE: nothing happens. The NOT NULL is idempotent by definition,
-- every constraint is added inside a NOT EXISTS guard against pg_constraint,
-- and there is no seed and no backfill.
--
-- ── MEASURED, 2026-08-21 ────────────────────────────────────────────────────
--
-- Read-only against the live database
-- (`railway run -e staging -s Kartavya`, SELECT only, statement_cache_size=0,
-- PostgreSQL 17.6 through the Supabase pooler at aws-1-ap-southeast-1):
--
--     SELECT count(*) FROM staging.hub_social_accounts;   -- 0
--     SELECT count(*) FROM staging.hub_publish_queue;     -- 0
--     SELECT count(*) FROM staging.hub_clients;           -- 54
--
-- **`hub_social_accounts` HOLDS ZERO ROWS IN THE ENTIRE PRODUCT.** Staging and
-- production share this database, so that is the whole product and not one
-- environment's corner of it. Nobody has ever connected a social account here;
-- the publish queue is empty for the same reason.
--
-- THAT IS WHY THIS FILE HAS NO BACKFILL AND NO DATA MIGRATION. There is no row
-- whose `account_id` has to be re-pointed from a person to a destination, no
-- token to re-file, no duplicate to reconcile. Section 3 proves the count is
-- still nought at COMMIT time and rolls the whole transaction back if it is
-- not — because a row appearing during this apply would be a row written under
-- the OLD meaning of `account_id`, and the NOT NULL below would be enforcing a
-- shape it does not have.
--
-- The reader applying this months from now must NOT assume the count is still
-- zero. If it is not, VERIFY 1 stops the apply and the header of section 3 says
-- exactly what to do instead.
--
-- ── THE PROBLEM: THE KEY NAMED THE WRONG PERSON ─────────────────────────────
--
-- The constraint, as it stands today (measured, `pg_get_constraintdef`):
--
--     hub_social_accounts_client_id_platform_account_id_key
--         UNIQUE (client_id, platform, account_id)
--
-- Which reads correctly and was wrong, because of what `account_id` HELD.
-- `routers/hub_publish.oauth_callback` wrote, before this change:
--
--     facebook/instagram   account_id = the consenting FACEBOOK USER's id
--                          page_id    = the Page (or IG business account)
--     linkedin             account_id = `sub` from /v2/userinfo — the PERSON
--                          page_id    = never written
--     google_business      account_id = the ACCOUNT resource name
--                          page_id    = the location resource name
--
-- So the "unique thing" in the key was THE HUMAN WHO CLICKED CONNECT, and the
-- destination — the only part that decides where a post lands — sat in
-- `page_id`, outside the key entirely. One partner connecting three Company
-- Pages produced three inserts with the same `account_id`, so the second
-- conflicted with the first and the `DO UPDATE` overwrote it, token and all.
-- A firm administering three Pages could hold exactly one, and never learnt
-- which, because the callback also silently kept `page_list[0]`.
--
-- ── THE KEY, AFTER THIS FILE ────────────────────────────────────────────────
--
--     UNIQUE (client_id, platform, account_id)
--         where account_id is THE DESTINATION'S OWN ID
--
-- THE COLUMNS DO NOT MOVE. What moves is what the middle column means, and the
-- code that writes it moved first (`_list_destinations` in
-- `routers/hub_publish.py`): the Page id, the Instagram business account id,
-- the Google location resource name, and for LinkedIn the full author urn —
-- `urn:li:person:…` or `urn:li:organization:…`, which is the one value that is
-- unambiguous between the two kinds and is exactly what `ugcPosts` takes.
--
-- WHY NOT A NEW `destination_id` COLUMN, which was the obvious candidate:
--
--  * It would be the same value in two columns, and the day they disagree is
--    the day somebody has to work out which one the key is on.
--  * `account_id` is already read by four publishers as `page_id or
--    account_id`, so a third identifier would need every one of them changed
--    to stay correct.
--  * With zero rows there is no legacy meaning to preserve. A new column is
--    how you avoid rewriting history; there is no history here.
--
-- WHY NOT ADD `page_id` TO THE KEY, which was the other candidate: `page_id` is
-- NULLABLE, and NULL is never equal to NULL in a unique index. A key with a
-- nullable column in it silently stops being a key for exactly the rows that
-- leave it empty — the manual pasted-token path — and those rows would
-- duplicate without limit. The same objection is why section 2 makes
-- `account_id` NOT NULL.
--
-- WHY NOT `(client_id, platform, account_id) WHERE is_active`: a disconnected
-- account keeps its slot on purpose. Reconnecting the same Page must find the
-- existing row and set `is_active=TRUE` on it — which the `ON CONFLICT DO
-- UPDATE` does — rather than leaving a graveyard of dead rows beside a live
-- one, all with the same name, in a list a human has to read.
--
-- ── WHAT MAKES THE KEY TOTAL (the actual work in this file) ─────────────────
--
-- The key had two holes, both of which let duplicates through in silence:
--
--   NULL   `account_id` is nullable today. Two rows with a NULL account_id for
--          one client and one platform do not conflict — NULL <> NULL in a
--          unique index — so the constraint simply does not apply to them.
--   ''     the empty string DOES conflict, which is worse in a different
--          direction: every platform with no destination lookup used to store
--          `account_id = ''`, so all of them collapsed onto one row per client
--          per platform and a second connection overwrote the first.
--
-- Section 2 closes both: NOT NULL, and a CHECK that the trimmed value is not
-- empty. After that, every row has a destination and every destination is
-- distinct within (client, platform). THAT is what makes "several accounts per
-- network" true at the database rather than only in the router.
--
-- IT IS A TIGHTENING, AND IT WILL REFUSE WRITES THE OLD CODE MADE. Any caller
-- still inserting an empty `account_id` gets a constraint violation instead of
-- a silently-overwritten row. That is the intended effect and it is safe here
-- only because the table is empty and because `hub_publish.py` in this same
-- commit never writes one: every OAuth destination carries the network's own
-- id, and the manual form already marks the account id `required`.
--
-- ── WHY NO destination_kind COLUMN ──────────────────────────────────────────
--
-- `social_publisher.linkedin_author_urn` needs to know whether a row is a
-- person or an organisation, and the obvious home for that is a column. It is
-- deliberately NOT one. It lives in `metadata->>'destination_kind'`, which has
-- existed on this table since migration 017.
--
-- The reason is this repository's own deployment order: code ships to Railway
-- when the branch merges, and migrations are applied by hand afterwards — 186
-- and 187 are both written-and-not-applied as this file is written. A column
-- the router writes on every connect would make the entire connect path 500
-- for the whole gap between the deploy and somebody running psql, and the
-- connect path is the one this change exists to fix. A jsonb key works the
-- moment the code lands, with or without this file.
--
-- Section 2 constrains the value anyway, so the allowlist is enforced by the
-- database and not only by the router: a `destination_kind` that is present
-- must be one of the eight the picker can produce. An absent one is legal and
-- means "written before the picker existed", which `linkedin_author_urn`
-- handles by falling back to a person urn — the only thing the old code ever
-- stored.
--
-- ── THE INLINE TRAP, WHICH THIS FILE AVOIDS BY CONSTRUCTION ─────────────────
--
-- `ALTER TABLE … ADD COLUMN IF NOT EXISTS x text CHECK (…)` skips the WHOLE
-- clause when the column already exists: the constraint is silently NOT created
-- and pg_constraint is the only place the truth lives. This file adds no
-- column, so it cannot fall into that mouth of the trap — but every CHECK below
-- is still a separate guarded `ALTER TABLE … ADD CONSTRAINT`, the pattern
-- migrations 184 §2 and 186 §2 established, and section 3 reads all four back
-- out of pg_constraint by name.
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.hub_social_accounts
--       DROP CONSTRAINT IF EXISTS hub_social_accounts_account_id_present_ck,
--       DROP CONSTRAINT IF EXISTS hub_social_accounts_destination_kind_ck,
--       DROP CONSTRAINT IF EXISTS hub_social_accounts_page_id_shape_ck,
--       DROP CONSTRAINT IF EXISTS hub_social_accounts_metadata_object_ck,
--       ALTER COLUMN account_id DROP NOT NULL;
--
-- Safe on any day. Everything this file adds is a restriction; removing it
-- widens what the table accepts and loses no data, because it holds none of its
-- own. The pre-existing UNIQUE constraint is untouched by both directions.
--
-- REVERSING THE CODE IS THE HARDER HALF and must come first if the two are
-- unwound together: rows written by the picker carry a DESTINATION id in
-- `account_id`, and the old callback would treat that column as a person's id
-- again. It would then overwrite a real Page's token on the next connect. If
-- this file is being reverted with rows in the table, export them first.
--
-- ── HOW TO APPLY ────────────────────────────────────────────────────────────
--
--   railway run -e staging -s Kartavya -- psql "$DATABASE_URL" -f \
--       backend/migrations/188_many_accounts_per_network.sql
--
-- STAGING AND PRODUCTION SHARE THIS DATABASE. There is no separate production
-- schema; `staging` is where production writes too. So this apply touches
-- production, and its write-path effect is exactly one thing: from the moment
-- it commits, an INSERT into `staging.hub_social_accounts` with a NULL or empty
-- `account_id`, or with an unknown `metadata->>'destination_kind'`, FAILS
-- instead of succeeding. Nothing in this commit's `hub_publish.py` writes such
-- a row. Nothing else in the repository writes this table at all (checked:
-- `grep -rn hub_social_accounts backend/ --include=*.py` reaches
-- `routers/hub_publish.py`, `routers/hub_connectors.py` — reads only — and
-- `services/social_publisher.py`, whose only write is a token refresh by `id`).
--
-- Read section 3's NOTICEs. If the transaction rolls back, the RAISE says which
-- claim failed; nothing is left half-applied because everything is in one
-- transaction.

BEGIN;

-- SET LOCAL is scoped to a transaction; outside one PostgreSQL warns and
-- ignores it. `ALTER TABLE … SET NOT NULL` takes an ACCESS EXCLUSIVE lock and
-- scans the table, so the cap is not decorative here even at zero rows: it
-- bounds how long a stuck lock can hold the connect path shut.
SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · The `staging` schema exists.
--
-- Cheap, and it turns the confusing failure into the true one. If `staging` is
-- missing, this database is not the one this file was written against and every
-- statement below would fail with a message about a relation rather than a
-- schema.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'staging') THEN
        RAISE EXCEPTION
            'GUARD 1: schema "staging" does not exist. This is not the '
            'Kartavaya database.';
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 2 · The table is here, and it is the shape this file argues about.
--
-- Everything below is an ALTER. An ALTER against a table that is absent, or
-- whose columns are of another type, either fails obscurely or — worse —
-- succeeds against something that is not what the header describes. The three
-- columns checked are the three the key and the CHECKs touch.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard2$
DECLARE
    t_account text;
    t_page    text;
    t_meta    text;
BEGIN
    IF to_regclass('staging.hub_social_accounts') IS NULL THEN
        RAISE EXCEPTION
            'GUARD 2: staging.hub_social_accounts does not exist. Migration 017 '
            'creates it; this file only alters it.';
    END IF;

    SELECT data_type INTO t_account FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='hub_social_accounts'
       AND column_name='account_id';
    SELECT data_type INTO t_page FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='hub_social_accounts'
       AND column_name='page_id';
    SELECT data_type INTO t_meta FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='hub_social_accounts'
       AND column_name='metadata';

    IF t_account IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION
            'GUARD 2: hub_social_accounts.account_id is %, expected text. It '
            'holds an identifier issued by another company — a Page id, an urn, '
            'a Google resource name — and no two networks agree on a shape.',
            COALESCE(t_account, '(absent)');
    END IF;
    IF t_page IS DISTINCT FROM 'text' THEN
        RAISE EXCEPTION
            'GUARD 2: hub_social_accounts.page_id is %, expected text.',
            COALESCE(t_page, '(absent)');
    END IF;
    IF t_meta IS DISTINCT FROM 'jsonb' THEN
        RAISE EXCEPTION
            'GUARD 2: hub_social_accounts.metadata is %, expected jsonb. The '
            'destination kind lives in it — see WHY NO destination_kind COLUMN.',
            COALESCE(t_meta, '(absent)');
    END IF;
END
$guard2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 3 · The uniqueness key is the one the header argues about.
--
-- THIS FILE DOES NOT CREATE THE KEY. It makes an existing key total, and it
-- would be a nonsense — a NOT NULL and three CHECKs justified by a constraint
-- that is not there — if the constraint had been changed by somebody else since
-- 2026-08-21. So it is read from the catalog and compared, rather than assumed
-- from migration 017's DDL.
--
-- If this RAISEs, do NOT edit the guard. Read the constraint it reports and
-- decide whether the key it describes still makes "one row per destination"
-- true; the answer changes what the rest of this file should say.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard3$
DECLARE
    key_def text;
BEGIN
    SELECT pg_get_constraintdef(con.oid) INTO key_def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND c.relname = 'hub_social_accounts'
       AND con.conname = 'hub_social_accounts_client_id_platform_account_id_key';

    IF key_def IS DISTINCT FROM 'UNIQUE (client_id, platform, account_id)' THEN
        RAISE EXCEPTION
            'GUARD 3: expected UNIQUE (client_id, platform, account_id) on '
            'hub_social_accounts_client_id_platform_account_id_key, found [%]. '
            'The whole of this file is an argument about that key.',
            COALESCE(key_def, '(the constraint does not exist)');
    END IF;
END
$guard3$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 4 · The table is EMPTY, which is the only reason this is safe.
--
-- Two of the changes below are tightenings that an existing row could fail:
-- `account_id` becoming NOT NULL, and the non-empty CHECK. On a table with
-- rows, either would abort the transaction anyway — but it would abort it with
-- a message about a constraint violation on some row, which sends the reader
-- looking at the wrong thing. This says the true thing first.
--
-- MEASURED 2026-08-21: zero rows, in the whole product. If that has changed by
-- the time somebody applies this, the rows are real connected accounts written
-- by the picker (which stores the DESTINATION id — fine, they pass) or by
-- something older (which stored a PERSON id — they pass the constraints and are
-- WRONG, and re-pointing them is a data migration this file does not attempt).
-- Either way the reader must look before forcing.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard4$
DECLARE n_rows bigint;
BEGIN
    SELECT count(*) INTO n_rows FROM staging.hub_social_accounts;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'GUARD 4: hub_social_accounts holds % row(s). This file was written '
            'against an empty table and contains NO backfill. Rows written '
            'before the destination picker hold the CONSENTING PERSON''s id in '
            'account_id, not the destination''s, and no constraint here can '
            'tell the difference. Inspect them, decide whether they need '
            're-pointing, and write the backfill before applying.', n_rows;
    END IF;
END
$guard4$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · account_id becomes NOT NULL.
--
-- This is the half of the key that was optional. A NULL here does not conflict
-- with another NULL, so two rows for one client and one platform both survived
-- and the "unique" constraint did not apply to either — the exact opposite of
-- what a reader of the DDL would expect.
--
-- SAFE AT ZERO ROWS, and only there: PostgreSQL scans the table to prove the
-- claim, and a single NULL would abort. GUARD 4 has already said the count.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE staging.hub_social_accounts
    ALTER COLUMN account_id SET NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · The constraints — separate statements, guarded, NEVER inline.
--
-- Each is added only if a constraint of that name is absent, so a re-run after
-- a partial apply repairs it rather than leaving the table silently
-- unconstrained. Section 3 reads every one of these names back out of
-- pg_constraint.
-- ═══════════════════════════════════════════════════════════════════════════
DO $constraints$
DECLARE
    have int;
BEGIN
    -- ── the destination is really there ─────────────────────────────────────
    -- The other half of the hole. `''` conflicts with `''`, so every platform
    -- with no destination lookup collapsed onto one row per client per platform
    -- and a second connection overwrote the first — including its token. A
    -- whitespace-only id is the same failure wearing a space.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_social_accounts'
       AND con.conname='hub_social_accounts_account_id_present_ck';
    IF have = 0 THEN
        ALTER TABLE staging.hub_social_accounts
            ADD CONSTRAINT hub_social_accounts_account_id_present_ck
            CHECK (length(btrim(account_id)) > 0);
    END IF;

    -- ── what kind of destination this row IS ────────────────────────────────
    -- Eight kinds, which is every kind `_list_destinations` can produce. NULL is
    -- legal and means "written before the picker existed"; `linkedin_author_urn`
    -- reads an absent kind as a person, which is the only thing the old code
    -- ever stored.
    --
    -- This is a CHECK and not an enum type deliberately: adding a network is a
    -- one-line change to a Python dict and a constraint swap, and a pg enum
    -- would make it a type migration.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_social_accounts'
       AND con.conname='hub_social_accounts_destination_kind_ck';
    IF have = 0 THEN
        ALTER TABLE staging.hub_social_accounts
            ADD CONSTRAINT hub_social_accounts_destination_kind_ck
            CHECK (
                metadata IS NULL
                OR metadata->>'destination_kind' IS NULL
                OR metadata->>'destination_kind' IN (
                    'person',
                    'facebook_page',
                    'instagram_business',
                    'linkedin_organization',
                    'google_location',
                    'youtube_channel',
                    'pinterest_board',
                    'account'
                )
            );
    END IF;

    -- ── page_id is a destination or it is nothing ───────────────────────────
    -- Every publisher reads `page_id or account_id`, and Python treats `''` as
    -- falsy, so an empty string happens to fall through to account_id today. It
    -- is one refactor away from not doing so — `account.get("page_id", account_
    -- .get("account_id"))` would post to the empty string. NULL is the honest
    -- way to say "this row has no separate page", and this makes '' unable to
    -- masquerade as one.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_social_accounts'
       AND con.conname='hub_social_accounts_page_id_shape_ck';
    IF have = 0 THEN
        ALTER TABLE staging.hub_social_accounts
            ADD CONSTRAINT hub_social_accounts_page_id_shape_ck
            CHECK (page_id IS NULL OR length(btrim(page_id)) > 0);
    END IF;

    -- ── metadata is an object, so `->>` means something ─────────────────────
    -- jsonb accepts `[1,2]` and `"hello"` and `null` as perfectly good values.
    -- `metadata->>'destination_kind'` on any of them is NULL, so the kind CHECK
    -- above would pass on a row whose metadata cannot hold a kind at all, and
    -- `linkedin_author_urn` would silently read a person out of an array.
    SELECT count(*) INTO have FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='staging' AND c.relname='hub_social_accounts'
       AND con.conname='hub_social_accounts_metadata_object_ck';
    IF have = 0 THEN
        ALTER TABLE staging.hub_social_accounts
            ADD CONSTRAINT hub_social_accounts_metadata_object_ck
            CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object');
    END IF;
END
$constraints$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2b · Say what the columns MEAN, in the database, where the next reader is.
--
-- The defect this file closes was not a missing constraint. It was a column
-- whose name said `account_id` and whose contents were a different account from
-- the one anybody meant. A comment is the only artefact that travels with the
-- catalog.
-- ═══════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE staging.hub_social_accounts IS
    'One row per DESTINATION a client can publish to — not one row per network '
    'and not one row per person. A firm administering three Facebook Pages '
    'holds three rows here, each with its own name, its own Page token and its '
    'own line in the publish queue. Written only by '
    'routers/hub_publish.connect_social_account, and only after a human has '
    'chosen the destination in the picker.';

COMMENT ON COLUMN staging.hub_social_accounts.account_id IS
    'THE DESTINATION''S OWN ID, issued by the network — the Facebook Page id, '
    'the Instagram business account id, the Google location resource name, or '
    'for LinkedIn the full author urn (urn:li:person:… or '
    'urn:li:organization:…). NOT the id of the person who gave consent: that '
    'is what it used to hold, and it is why connecting a second Page '
    'overwrote the first. Part of the uniqueness key, and NOT NULL and '
    'non-empty so that the key is total.';

COMMENT ON COLUMN staging.hub_social_accounts.page_id IS
    'What the publisher addresses, read as `page_id or account_id`. Usually the '
    'same value as account_id; different only where the network''s post '
    'endpoint takes something other than the destination id (Reddit takes a '
    'subreddit). NULL, never '''', when there is no separate page.';

COMMENT ON COLUMN staging.hub_social_accounts.metadata IS
    'A jsonb OBJECT. `destination_kind` says what this row IS — one of person, '
    'facebook_page, instagram_business, linkedin_organization, '
    'google_location, youtube_channel, pinterest_board, account — and is what '
    'services/social_publisher.linkedin_author_urn reads to decide between a '
    'person urn and an organisation urn. Deliberately a jsonb key rather than '
    'a column: the router writes it the moment it deploys, and this migration '
    'may be applied days later.';

COMMENT ON COLUMN staging.hub_social_accounts.access_token IS
    'ENCRYPTED AT REST by services/encryption.encrypt. Never returned to a '
    'browser, in any shape, on any route. services/social_publisher decrypts at '
    'the point of use.';

COMMENT ON COLUMN staging.hub_social_accounts.org_id IS
    'The owning organisation, indexed by idx_hub_social_accounts_org. Written '
    'by the connect routes since 2026-08-21; every row made before that date '
    'left it NULL. There are no such rows — the table was empty when this was '
    'fixed.';

COMMENT ON CONSTRAINT hub_social_accounts_client_id_platform_account_id_key
    ON staging.hub_social_accounts IS
    'ONE ROW PER DESTINATION, per client, per network. Unchanged in its columns '
    'since migration 017; migration 188 is what made it mean something, by '
    'moving the destination''s id into account_id and closing the NULL and '
    'empty-string holes that let duplicates past it.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · PROVE IT, IN THE SAME TRANSACTION.
--
-- The claims are: the table still holds no rows, `account_id` is NOT NULL, the
-- four CHECKs exist by name, and the uniqueness key is still exactly the three
-- columns it was. The row count is first because it is the one worth rolling
-- back for: this file writes nothing, so a row appearing across it means
-- something else wrote one under the old meaning of `account_id` while the
-- transaction was open, and the constraints just committed would be describing
-- a table that does not match them.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    n_rows    bigint;
    n_checks  int;
    nullable  text;
    key_def   text;
BEGIN
    -- VERIFY 1 — STILL ZERO. Nothing was written, and nothing was lost.
    SELECT count(*) INTO n_rows FROM staging.hub_social_accounts;
    IF n_rows <> 0 THEN
        RAISE EXCEPTION
            'VERIFY 1: this migration writes NOTHING and deletes NOTHING, yet '
            'hub_social_accounts holds % row(s) where GUARD 4 counted nought. '
            'Something wrote a connected account during this apply, under the '
            'old meaning of account_id. Rolling back.', n_rows;
    END IF;

    -- VERIFY 2 — the NOT NULL landed. Without it the key is not a key for any
    -- row that leaves account_id empty, which is silently most of them.
    SELECT is_nullable INTO nullable FROM information_schema.columns
     WHERE table_schema='staging' AND table_name='hub_social_accounts'
       AND column_name='account_id';
    IF nullable IS DISTINCT FROM 'NO' THEN
        RAISE EXCEPTION
            'VERIFY 2: hub_social_accounts.account_id is still nullable (%). '
            'NULL <> NULL in a unique index, so the key would not apply to a '
            'row without a destination.', COALESCE(nullable, '(absent)');
    END IF;

    -- VERIFY 3 — every CHECK landed. Read from pg_constraint BY NAME, never
    -- assumed from the DDL: an inline constraint is silently skipped whenever
    -- its target already exists, and pg_constraint is the only truth.
    SELECT count(*) INTO n_checks
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND c.relname = 'hub_social_accounts'
       AND con.contype = 'c'
       AND con.conname IN ('hub_social_accounts_account_id_present_ck',
                           'hub_social_accounts_destination_kind_ck',
                           'hub_social_accounts_page_id_shape_ck',
                           'hub_social_accounts_metadata_object_ck');
    IF n_checks <> 4 THEN
        RAISE EXCEPTION
            'VERIFY 3: expected 4 CHECK constraints from section 2 on '
            'hub_social_accounts, found %. A name in section 2 does not match '
            'a name here, or an ADD CONSTRAINT was skipped.', n_checks;
    END IF;

    -- VERIFY 4 — THE KEY IS STILL THE KEY, and still over the same three
    -- columns in the same order. This file must not have moved it; if it reads
    -- as anything else, something in section 1 or 2 dropped and recreated it,
    -- which this file is not allowed to do.
    SELECT pg_get_constraintdef(con.oid) INTO key_def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'staging'
       AND c.relname = 'hub_social_accounts'
       AND con.conname = 'hub_social_accounts_client_id_platform_account_id_key';
    IF key_def IS DISTINCT FROM 'UNIQUE (client_id, platform, account_id)' THEN
        RAISE EXCEPTION
            'VERIFY 4: the uniqueness key now reads [%], expected UNIQUE '
            '(client_id, platform, account_id). This file drops nothing and '
            'creates nothing; the key it argues about must survive it '
            'unchanged.', COALESCE(key_def, '(the constraint is gone)');
    END IF;

    RAISE NOTICE '188 · hub_social_accounts: account_id NOT NULL, 4 CHECKs, '
                 '0 rows, key unchanged.';
    RAISE NOTICE '    THE KEY IS (client_id, platform, account_id) and '
                 'account_id now holds THE DESTINATION''S id — the Page, the '
                 'IG business account, the Google location, the LinkedIn urn. '
                 'It used to hold the consenting person''s, which is why a '
                 'second Page overwrote the first.';
    RAISE NOTICE '    NOTHING IS BACKFILLED because there was nothing to '
                 'backfill: this table has never held a row.';
    RAISE NOTICE '    A caller inserting an empty account_id now FAILS instead '
                 'of overwriting somebody else''s row. hub_publish.py in the '
                 'same commit never writes one.';
    RAISE NOTICE '    destination_kind lives in metadata, not in a column, so '
                 'the router works whether or not this file has been applied.';
END
$verify$;

COMMIT;
