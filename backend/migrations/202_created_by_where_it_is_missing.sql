-- 202 · `created_by` where it is genuinely missing — and the `uuid` that has
--        been swallowing every author on `graha_web_forms` since it shipped.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply it by hand, in a quiet window; see
-- the LOCKS section, which is the only part of this file with real teeth.
--
-- Runs AFTER 201. 201 gives `staging.graha_web_forms` its `updated_at` and
-- `updated_by`; section 1 here rewrites the `created_by` it already had.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 201 answered "who last changed this". This file answers the other half of
-- workstream E — "who made it" — for the tables the product actually puts on
-- screen and which have no answer at all.
--
-- Measured on 2026-08-23 against the live catalogue, and then against the
-- FRONTEND: of the ~26 tables the product renders as a list of records, all but
-- these carry an author already, under `created_by` or under a name of their
-- own. Naming those aliases matters more than adding columns, because a second
-- author column beside an existing one is how a table ends up with two answers
-- to one question:
--
--     staging.graha_documents.uploaded_by            the author, already there
--     staging.manav_offboarding.initiated_by         the author, already there
--     staging.graha_approval_requests.requested_by   ditto, plus approved_by
--                                                    and decided_at for the
--                                                    only state change it has
--     staging.platform_support_requests.raised_by    ditto
--     staging.platform_support_sessions              requested_by, approved_by,
--                                                    denied_by, revoked_by — a
--                                                    fuller trail than this
--                                                    file could add
--     public.invites.invited_by                      and an invite is not edited
--     staging.organisations.owner_user_id            the founder of the org
--
-- NONE of those gets a `created_by`. The UI resolves the column that is there.
--
-- What is left is three tables with no author at all, and one that has an
-- author column which cannot physically hold an author.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — the `uuid` that has never held anything
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `staging.graha_web_forms.created_by` is `uuid`. `public.users.user_id` is
-- TEXT — values look like `user_549c9cac35aa`. The only writer is
-- `routers/graha.py:2888`, which binds `user["user_id"]` into `$8`:
--
--     INSERT INTO staging.graha_web_forms
--       (org_id, name, slug, fields, settings, auto_assign_to, auto_source,
--        created_by)
--     VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, NULLIF($6,'')::uuid,
--             $7, $8)
--
-- asyncpg infers `$8` as `uuid` from the catalogue and is handed a TEXT user
-- id. Live evidence rather than inference: the table holds 8 rows and
-- `count(created_by)` is 0 — the column has never recorded a single author in
-- its life.
--
-- This is the FOURTH time this repo has paid for the same mistake.
-- `030_created_by_uuid_to_text.sql` ("500 errors on every INSERT") and
-- `092_sales_target_salesperson_is_a_user_id.sql` (a sales target nobody in any
-- org could ever save, reaching the browser as a CORS error) are the first two;
-- `097` wrote the rule into the migrations README; and it happened again here.
--
-- The conversion is safe precisely because the column is empty: `USING
-- created_by::text` runs over 8 NULLs. Nothing is reinterpreted, because there
-- is nothing there to reinterpret.
--
-- The other seven `uuid` `created_by` columns in the database are NOT converted
-- and are NOT a bug worth a rewrite: `crm_accounts`, `crm_activities`,
-- `crm_contacts`, `crm_invoices`, `crm_leads`, `crm_quotations` and
-- `graha_automations` hold zero rows apiece and have no writer anywhere in the
-- backend — the live CRM is `graha_*`. Converting a dead column is work with no
-- reader. 201 lists them under DEAD LEGACY for the same reason.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — the three tables with no author at all
-- ═══════════════════════════════════════════════════════════════════════════
--
--   staging.ganit_products         106 rows. The one product catalogue (the
--                                  `catalogue/ProductsTab` list). Somebody
--                                  typed each of these and somebody re-prices
--                                  them; the table records neither.
--   staging.subscription_invoices    0 rows. What Aekam bills a customer.
--                                  `collected_by` and `approved_by` exist and
--                                  answer neither "who raised it" nor "who
--                                  amended it". Money code; an invoice with no
--                                  author is one nobody can defend.
--   staging.graha_approval_rules     1 row. The rule that decides what needs
--                                  approving above what amount. Who set that
--                                  threshold is exactly the question an audit
--                                  asks first.
--
-- Two of them also lack `updated_at`, so they get it here on the same terms
-- 201 sets out: NULLABLE, NO DEFAULT — a default would stamp today onto every
-- historical row and assert it was modified today — plus the shared
-- `staging.touch_updated_at()` trigger, so the timestamp is true whoever wrote
-- the row.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — `updated_by` on the four that 201 could not reach
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 201 covered every table that already had a TEXT `created_by`. These four
-- record an author under another name, or in another schema, so they fell
-- outside its rule and not outside its argument:
--
--   staging.organisations      3 rows.  Who changed the firm's GSTIN, its
--                                       markup, its seat cap.
--   staging.manav_offboarding 11 rows.  `initiated_by` opens a case; the case
--                                       then runs for weeks through clearance
--                                       and settlement, touched by several
--                                       people, recording none of them.
--   public.teams              52 rows.  Has `created_by`, `deleted_by`,
--                                       `archived_by` and `updated_at` — every
--                                       actor except the one for the timestamp
--                                       it already keeps.
--   public.users              35 rows.  `users.role` is a per-org fact stored in
--                                       one global column, and WHO MADE THIS
--                                       PERSON AN ADMIN is the single most
--                                       load-bearing audit question in the
--                                       product. It has never been recorded.
--
-- `public.users` and `staging.organisations` are in `public`/`staging` and both
-- are read on nearly every request. That is a LOCK problem, not a correctness
-- one — see below.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO BACKFILL, and TEXT everywhere
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every new column here is TEXT and nullable, with no FK, no index and no
-- CHECK, for the reasons 201 argues at length — including that an inline CHECK
-- on `ADD COLUMN IF NOT EXISTS` is skipped ENTIRELY when the column already
-- exists, so `pg_constraint` and never a migration file is what tells you
-- whether a constraint is really there.
--
-- Nothing is backfilled. `ganit_products.created_by` COULD be guessed from the
-- org's owner, and that is exactly why it is not: 106 products would each name
-- one specific colleague as their author, and 105 of those names might be
-- wrong. A NULL is visibly unknown. A wrong name is not, and it is the one
-- thing an audit column must never produce.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- RISK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WRITE-PATH SIDE EFFECTS: no row in any table is read or written. Section 1 is
-- the only statement that touches data at all, and it rewrites 8 rows whose
-- `created_by` is NULL into 8 rows whose `created_by` is NULL.
--
-- Section 1 IS a table rewrite (`ALTER … TYPE` always is) and takes ACCESS
-- EXCLUSIVE on `graha_web_forms` for the duration — 8 rows, microseconds. It
-- also invalidates any cached plan naming the column; asyncpg re-prepares, and
-- the router's behaviour can only improve, since today the INSERT cannot bind.
-- Everything else is `ADD COLUMN IF NOT EXISTS` with no default: a catalog
-- update with NO rewrite (PG 11+).
--
-- LOCKS — THE ONE THING TO GET RIGHT HERE. `public.users` and
-- `staging.organisations` are read on nearly every request in the product.
-- `ALTER TABLE … ADD COLUMN` needs ACCESS EXCLUSIVE on each, and while it
-- QUEUES behind any open transaction on that table, every request arriving
-- afterwards queues behind IT. 096 hit this and said so. `lock_timeout` turns
-- the bad case into a clean rollback of the whole file after five seconds
-- rather than a product-wide stall; a failed run here costs nothing and is
-- simply re-run. Run it when traffic is low.
--
-- Replayable: `IF NOT EXISTS` throughout, and section 1 is guarded on the
-- column's CURRENT type, so a second run is a no-op end to end.
--
-- APPLYING THIS FILE RECORDS NOTHING BY ITSELF. Every column stays NULL until
-- the write paths set it.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 1. graha_web_forms.created_by : uuid → TEXT ─────────────────────────────
--
-- Guarded on the CURRENT type read from `information_schema`, not on whether
-- some migration file claims to have done it. Idempotent, and a no-op the
-- second time.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'staging'
           AND table_name   = 'graha_web_forms'
           AND column_name  = 'created_by'
           AND data_type    = 'uuid'
    ) THEN
        ALTER TABLE staging.graha_web_forms
            ALTER COLUMN created_by TYPE TEXT USING created_by::text;
    END IF;
END $$;

COMMENT ON COLUMN staging.graha_web_forms.created_by IS
    'public.users.user_id (TEXT) of whoever created this form. Was uuid until '
    '202 and therefore unwritable — all 8 rows that predate it hold NULL, which '
    'is the truth about them and is not backfilled.';

-- ── 2. created_by where there is no author column at all ────────────────────

ALTER TABLE staging.ganit_products
    ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE staging.subscription_invoices
    ADD COLUMN IF NOT EXISTS created_by TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE staging.graha_approval_rules
    ADD COLUMN IF NOT EXISTS created_by TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

DROP TRIGGER IF EXISTS trg_touch_subscription_invoices ON staging.subscription_invoices;
CREATE TRIGGER trg_touch_subscription_invoices
    BEFORE UPDATE ON staging.subscription_invoices
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_graha_approval_rules ON staging.graha_approval_rules;
CREATE TRIGGER trg_touch_graha_approval_rules
    BEFORE UPDATE ON staging.graha_approval_rules
    FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();

-- ── 3. updated_by on the four 201's rule could not reach ────────────────────

ALTER TABLE staging.ganit_products
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE staging.subscription_invoices
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE staging.graha_approval_rules
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE staging.manav_offboarding
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- The two hot tables. Last, so that if `lock_timeout` fires it fires here and
-- the cheap work above has at least been attempted — the whole file rolls back
-- either way, but the failure then names the table that is actually busy.

ALTER TABLE staging.organisations
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE public.teams
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- ── 4. Say what each column means, on the column ────────────────────────────

COMMENT ON COLUMN staging.ganit_products.created_by IS
    'public.users.user_id (TEXT) of whoever added this product. NULL on the 106 '
    'rows that predate 202 — never guessed from the org owner.';

COMMENT ON COLUMN staging.subscription_invoices.created_by IS
    'public.users.user_id (TEXT) of the Aekam staffer who raised this invoice. '
    'Distinct from collected_by (who took the money) and approved_by.';

COMMENT ON COLUMN staging.graha_approval_rules.created_by IS
    'public.users.user_id (TEXT) of whoever set this approval threshold.';

COMMENT ON COLUMN staging.organisations.updated_by IS
    'public.users.user_id (TEXT) of the last person to change the org profile. '
    'The org FOUNDER is owner_user_id, which is not the same fact.';

COMMENT ON COLUMN public.users.updated_by IS
    'public.users.user_id (TEXT) of the last person to change this account — '
    'including its role. Self-service edits record the account itself; an admin '
    'promoting somebody records the admin. NULL = unchanged since 202.';

COMMENT ON COLUMN public.teams.updated_by IS
    'public.users.user_id (TEXT) of the last person to change this team. Sits '
    'beside the created_by, archived_by and deleted_by it already had.';

COMMENT ON COLUMN staging.manav_offboarding.updated_by IS
    'public.users.user_id (TEXT) of the last person to move this case along. '
    'initiated_by opened it; a case runs for weeks and is touched by several.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — read the catalogue, never this file
-- ═══════════════════════════════════════════════════════════════════════════
--
--   -- section 1. Expect exactly one row, `text`.
--   SELECT data_type FROM information_schema.columns
--    WHERE table_schema='staging' AND table_name='graha_web_forms'
--      AND column_name='created_by';
--
--   -- and nothing was lost converting it: 8 rows, 0 authors, same as before.
--   SELECT count(*), count(created_by) FROM staging.graha_web_forms;
--
--   -- 77 = the 74 that had created_by, plus ganit_products,
--   -- subscription_invoices and graha_approval_rules.
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema='staging' AND column_name='created_by';
--
--   -- 65 = 58 after 201, plus the four here in `staging`
--   -- (ganit_products, subscription_invoices, graha_approval_rules,
--   --  manav_offboarding) and organisations; public.users and public.teams
--   -- are counted separately below.
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema='staging' AND column_name='updated_by';
--   SELECT table_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='updated_by' ORDER BY 1;
--
--   -- every one TEXT, in both schemas. Expect ZERO rows.
--   SELECT table_schema, table_name, data_type FROM information_schema.columns
--    WHERE table_schema IN ('staging','public')
--      AND column_name IN ('created_by','updated_by')
--      AND data_type <> 'text';
--
--   -- NOTHING was backfilled.
--   SELECT count(created_by) FROM staging.ganit_products;   -- 0 of 106
--   SELECT count(updated_by) FROM public.users;             -- 0 of  35
--   SELECT count(updated_by) FROM public.teams;             -- 0 of  52
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_touch_subscription_invoices ON staging.subscription_invoices;
--   DROP TRIGGER IF EXISTS trg_touch_graha_approval_rules  ON staging.graha_approval_rules;
--   ALTER TABLE staging.ganit_products        DROP COLUMN IF EXISTS created_by,
--                                             DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE staging.subscription_invoices DROP COLUMN IF EXISTS created_by,
--                                             DROP COLUMN IF EXISTS updated_at,
--                                             DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE staging.graha_approval_rules  DROP COLUMN IF EXISTS created_by,
--                                             DROP COLUMN IF EXISTS updated_at,
--                                             DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE staging.manav_offboarding     DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE staging.organisations         DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE public.teams                  DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE public.users                  DROP COLUMN IF EXISTS updated_by;
--   COMMIT;
--
-- DO NOT roll back section 1 by converting `created_by` back to `uuid`. That
-- reinstates a column no writer can bind and throws away any author recorded
-- since; if the type must go back, `routers/graha.py:2888` has to stop sending
-- a TEXT user id in the same commit — and there is nothing else it could send.
