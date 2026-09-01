-- 260 — clear every seeded transactional row outside Aekam
--
-- Owner, 2026-09-01:
--   "seed one of each to prove the flows work remove current invoice, payroll,
--    hr,s and seeded nd test with what we did today"
--   "also all client , contact, sales order"
--   "so delete crm,sales, procurrement"
--   "and redo the whole flow make sure no customer is their anymore everything
--    is client"
--
-- ── WHY A WIPE AND NOT A TIDY-UP ────────────────────────────────────────────
--
-- A large stale dataset cannot prove that today's work functions. Every row in
-- it predates the change, so a green screen over it says nothing about whether
-- the new path ran. Clearing it means every row that appears afterwards was
-- produced BY the new flows — which is the only evidence that counts here.
-- CLAUDE.md: "✅ means a customer can complete the flow end to end, proven by a
-- row appearing where there were zero".
--
-- ── SCOPE: EVERY MODULE TABLE, EVERY ORG EXCEPT THE PLATFORM ────────────────
--
-- 92 tables — the six module prefixes (graha_, vikray_, ganit_, manav_,
-- vetana_, pahchan_) plus ten tables outside them that hold those hostage:
-- client billing and the compliance registers reference `graha_clients` with
-- RESTRICT / NO ACTION, and `vendor_rate_cards` / `vendor_sla_credits` do the
-- same to `ganit_vendors`. They are per-client seed data in their own right.
--
-- Measured 2026-09-01: 1,441 rows outside Aekam, 32 inside it.
--
-- ⚠ AEKAM INC LOSES NOTHING. It holds 32 rows across 13 of these tables —
-- 2 clients, 4 contacts, 10 expense categories, 3 products, 3 vendor bills,
-- 2 vendors, 1 contract, 1 activity, 1 pipeline, 1 territory, 1 order,
-- 2 expenses, 1 notice acknowledgement. Every DELETE below is
-- `WHERE org_id <> <platform>`, and the verification block re-counts all 92
-- tables afterwards and RAISES if a single Aekam row moved.
--
-- ── ⚠ THE ORDER IS COMPUTED, NOT ASSERTED ───────────────────────────────────
--
-- 92 tables with a dense foreign-key graph: self-references
-- (`ganit_invoices.converted_invoice_id`), NO ACTION edges
-- (`ganit_payments.invoice_id`, `vikray_orders.invoice_id`, eight on
-- `manav_employees`) and RESTRICT edges (`manav_bonus_awards`,
-- `client_engagements`, `client_obligations`, `notice_register`).
--
-- A hand-written delete order is a guess that fails on the first edge I
-- mis-remember. So this does not assert an order: it tries every table each
-- round inside an exception block — which in plpgsql is a real subtransaction —
-- and a table that is still referenced simply rolls back and is retried next
-- round, once its children are gone. It repeats until a whole round deletes
-- nothing new, which converges on the true topological order.
--
-- If it CANNOT converge, it raises with the tables that are still held and the
-- count that is holding them, rather than committing a half-cleared database.
--
-- ⚠ IRREVERSIBLE. A DELETE has no inverse. There is no rollback section
-- pretending otherwise. This runs on the owner's repeated statement that
-- everything outside Aekam is seed data.

BEGIN;

SET LOCAL lock_timeout      = '10s';
SET LOCAL statement_timeout = '300s';

DO $wipe$
DECLARE
    plat        uuid;
    tbl         text;
    col         text;
    rounds      int := 0;
    progressed  boolean;
    pending     text[];
    still       text[];
    n           bigint;
    total       bigint := 0;
    before_plat bigint;
    after_plat  bigint;
    held        bigint;
BEGIN
    SELECT id INTO plat FROM public.organisations WHERE is_platform_org;
    IF plat IS NULL THEN
        RAISE EXCEPTION 'GUARD: no platform organisation. Refusing to delete anything.';
    END IF;

    -- The table set, and the platform's row count across all of it, taken
    -- BEFORE anything is deleted so the guarantee at the end is measurable.
    SELECT array_agg(t ORDER BY t) INTO pending
      FROM (
        SELECT c.relname AS t
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM information_schema.columns col2
                        WHERE col2.table_schema = 'public'
                          AND col2.table_name = c.relname
                          AND col2.column_name = 'org_id')
           AND (c.relname LIKE 'graha\_%'  OR c.relname LIKE 'vikray\_%'
             OR c.relname LIKE 'ganit\_%'  OR c.relname LIKE 'manav\_%'
             OR c.relname LIKE 'vetana\_%' OR c.relname LIKE 'pahchan\_%'
             OR c.relname IN ('vendor_rate_cards', 'vendor_sla_credits',
                              'client_billing_profiles', 'client_engagements',
                              'client_obligations', 'client_service_lines',
                              'dsc_register', 'notice_register',
                              'udin_register', 'analytics_accounts',
                              -- Second wave, found the same way: the first run
                              -- refused with "cannot clear 2 table(s)" and these
                              -- are what held them.
                              'client_metered_usage',
                              'prachar_event_registrations'))
      ) s;

    RAISE NOTICE 'clearing % tables', array_length(pending, 1);

    before_plat := 0;
    FOREACH tbl IN ARRAY pending LOOP
        EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', tbl)
           INTO n USING plat;
        before_plat := before_plat + n;
    END LOOP;
    RAISE NOTICE 'platform organisation holds % rows across them', before_plat;

    -- ── Self-references first ───────────────────────────────────────────────
    -- A row pointing at a sibling in its OWN table blocks the delete however
    -- the tables are ordered between themselves.
    FOR tbl, col IN
        SELECT tc.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'
           AND tc.table_name = ccu.table_name
           AND tc.table_name = ANY (pending)
    LOOP
        EXECUTE format(
            'UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL AND org_id <> $1',
            tbl, col, col) USING plat;
    END LOOP;

    -- ── Converge ────────────────────────────────────────────────────────────
    WHILE array_length(pending, 1) > 0 LOOP
        rounds     := rounds + 1;
        progressed := false;
        still      := ARRAY[]::text[];

        IF rounds > 40 THEN
            RAISE EXCEPTION
                'GUARD: % rounds without finishing. Something is wrong with the '
                'convergence, not with the data. Refusing.', rounds;
        END IF;

        FOREACH tbl IN ARRAY pending LOOP
            BEGIN
                EXECUTE format('DELETE FROM public.%I WHERE org_id <> $1', tbl)
                  USING plat;
                GET DIAGNOSTICS n = ROW_COUNT;
                total      := total + n;
                progressed := true;
            EXCEPTION
                WHEN foreign_key_violation OR restrict_violation THEN
                    -- Still referenced. Its children go first; try again next
                    -- round. The failed statement's subtransaction is discarded
                    -- here, so nothing partial survives.
                    still := still || tbl;
            END;
        END LOOP;

        pending := still;

        IF NOT progressed AND array_length(pending, 1) > 0 THEN
            FOREACH tbl IN ARRAY pending LOOP
                EXECUTE format(
                    'SELECT count(*) FROM public.%I WHERE org_id <> $1', tbl)
                   INTO held USING plat;
                RAISE NOTICE 'still held: % (% rows)', tbl, held;
            END LOOP;
            RAISE EXCEPTION
                'GUARD: cannot clear % table(s) — something outside the set '
                'still references them. Nothing has been committed.',
                array_length(pending, 1);
        END IF;
    END LOOP;

    RAISE NOTICE 'converged in % rounds, % rows deleted', rounds, total;

    -- ── THE GUARANTEE ───────────────────────────────────────────────────────
    SELECT array_agg(t ORDER BY t) INTO pending
      FROM (
        SELECT c.relname AS t
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM information_schema.columns col2
                        WHERE col2.table_schema = 'public'
                          AND col2.table_name = c.relname
                          AND col2.column_name = 'org_id')
           AND (c.relname LIKE 'graha\_%'  OR c.relname LIKE 'vikray\_%'
             OR c.relname LIKE 'ganit\_%'  OR c.relname LIKE 'manav\_%'
             OR c.relname LIKE 'vetana\_%' OR c.relname LIKE 'pahchan\_%'
             OR c.relname IN ('vendor_rate_cards', 'vendor_sla_credits',
                              'client_billing_profiles', 'client_engagements',
                              'client_obligations', 'client_service_lines',
                              'dsc_register', 'notice_register',
                              'udin_register', 'analytics_accounts',
                              -- Second wave, found the same way: the first run
                              -- refused with "cannot clear 2 table(s)" and these
                              -- are what held them.
                              'client_metered_usage',
                              'prachar_event_registrations'))
      ) s;

    after_plat := 0;
    FOREACH tbl IN ARRAY pending LOOP
        EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id = $1', tbl)
           INTO n USING plat;
        after_plat := after_plat + n;

        EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id <> $1', tbl)
           INTO n USING plat;
        IF n <> 0 THEN
            RAISE EXCEPTION 'VERIFY: % still holds % non-platform rows.', tbl, n;
        END IF;
    END LOOP;

    IF after_plat <> before_plat THEN
        RAISE EXCEPTION
            'VERIFY: the platform organisation went from % rows to %. '
            'Aekam Inc is never touched. Rolling back.', before_plat, after_plat;
    END IF;

    RAISE NOTICE 'Aekam intact: % rows, unchanged.', after_plat;

    -- The organisations themselves, their people and their subscriptions are
    -- NOT part of this. An empty org that still exists is the point; an org
    -- that has vanished is a different and much worse outcome.
    IF (SELECT count(*) FROM public.organisations) < 5 THEN
        RAISE EXCEPTION 'VERIFY: organisations were deleted. Rolling back.';
    END IF;
END
$wipe$;

COMMIT;
