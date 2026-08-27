-- 235 · DROP the three-table sales territory stack
--
--     staging.sales_territories
--     staging.sales_targets
--     staging.sales_routing_rules
--
-- Approved by the owner on 2026-08-27, answering migration 234's exclusion.
-- 234 left `sales_territories` standing for exactly one reason, quoted from its
-- own header: "`staging.sales_targets` and `staging.sales_routing_rules` both
-- carry a foreign key INTO it ... A DROP approved by name does not reach tables
-- that were not named. It needs putting to him as three tables, not one." It was
-- put to him as three tables. All three are named above and all three are named
-- in the statement below.
--
-- ══ RISK REPORT ══════════════════════════════════════════════════════════════
--
-- Measured live, read-only, 2026-08-27, against staging (which production
-- shares — every statement in this file touches production data).
--
-- ── 1 · ROW COUNTS · counted with count(*), never n_live_tup ─────────────────
--
--     staging.sales_territories       0 rows      (n_live_tup also 0)
--     staging.sales_targets           0 rows      (n_live_tup also 0)
--     staging.sales_routing_rules     0 rows      (n_live_tup also 0)
--
-- The estimator agreed here, and it is still not what was trusted: `n_live_tup`
-- reported 23 and 14 earlier this same week for two tables that both held 23.
-- The guard below re-counts with count(*) INSIDE the transaction, so a row that
-- arrives between this audit and the apply aborts the whole thing.
--
-- ── 2 · BOTH SCHEMAS CHECKED · a 42P01 is a fact about ONE schema ────────────
--
--     staging.sales_territories       EXISTS       public.sales_territories     absent
--     staging.sales_targets           EXISTS       public.sales_targets         absent
--     staging.sales_routing_rules     EXISTS       public.sales_routing_rules   absent
--
-- Checked with `to_regclass` per schema, not by running a query and reading the
-- error. There is no `public` twin of any of the three, so this migration names
-- only `staging.*` — and `shadow_tables_and_search_path` is why every name below
-- is schema-qualified anyway.
--
-- ── 3 · FOREIGN KEYS · every inbound key comes from inside the set ───────────
--
--   INBOUND (three, all internal):
--     staging.sales_routing_rules -> staging.sales_territories   [sales_routing_rules_territory_id_fkey]
--     staging.sales_targets       -> staging.sales_territories   [sales_targets_territory_id_fkey]
--     staging.sales_territories   -> staging.sales_territories   [sales_territories_parent_id_fkey]  (self)
--
--   OUTBOUND (six, all to tables that STAY — organisations and public.users):
--     sales_territories.manager_id     -> public.users(id)
--     sales_territories.org_id         -> staging.organisations(id)
--     sales_targets.user_id            -> public.users(id)
--     sales_targets.org_id             -> staging.organisations(id)
--     sales_routing_rules.assign_to    -> public.users(id)
--     sales_routing_rules.org_id       -> staging.organisations(id)
--
-- NOTHING outside the three points at any of the three. Dropping them cannot
-- orphan another table's rows; it removes six constraints from tables that are
-- themselves being removed.
--
-- No view and no materialised view depends on any of them (pg_depend via
-- pg_rewrite: zero rows).
--
-- ── 4 · THE DEPENDENCY NO `DROP` WOULD HAVE CAUGHT ───────────────────────────
--
-- **`staging.crm_deals` carries an ENABLED trigger that writes into
-- `staging.sales_targets`.**
--
--     CREATE TRIGGER trg_stg_deal_close_target AFTER UPDATE ON staging.crm_deals
--     FOR EACH ROW EXECUTE FUNCTION staging.sales_update_target_on_deal_close()
--
-- and that function's body is:
--
--     IF NEW.won_at IS NOT NULL AND OLD.won_at IS NULL THEN
--         UPDATE staging.sales_targets SET revenue_actual = ..., deals_actual = ...
--
-- This is the whole reason this file is longer than one statement. A PL/pgSQL
-- body is parsed when it RUNS, not when it is created, so PostgreSQL records no
-- dependency for it: `DROP TABLE staging.sales_targets` **succeeds**, reports
-- success, and leaves behind a trigger that raises 42P01 on the next UPDATE of
-- `staging.crm_deals`. The "no CASCADE, so it fails loudly" protection in
-- migration 234 does not reach this class of dependency at all — the statement
-- would not have failed, and the report would have read "it worked". It was
-- found by reading `pg_proc.prosrc`, not by trusting the constraint graph.
--
-- So the trigger and its function are dropped here, BY NAME, before the tables.
-- That is a change to a table nobody named (`staging.crm_deals`), which is
-- exactly what 234 refused to do — and the distinction is that this removes a
-- trigger whose ONLY effect is to write into a table the owner has now approved
-- for deletion. There is no version of this drop in which that trigger survives
-- meaning anything; the choice is between removing it and leaving a 42P01.
--
-- It is provably a no-op today, and the guard below proves it again at apply
-- time rather than citing this comment: its UPDATE is `WHERE user_id = ... AND
-- org_id = ...` against a table the guard has just re-counted at 0 rows, so it
-- can match nothing. `staging.crm_deals` itself holds 0 rows, and this is its
-- only non-internal trigger.
--
-- `staging.touch_updated_at()` — the function behind `trg_touch_sales_targets`
-- on `sales_targets` — is SHARED by 27 triggers across the schema and is NOT
-- dropped. Its trigger on `sales_targets` disappears with the table, as do the
-- three RLS policies (`stg_sales_terr_org`, `stg_sales_tgt_org`,
-- `stg_sales_rr_org`) and the four indexes. Those are owned by the tables and
-- need no separate statement.
--
-- ── 5 · CODE · one reference in the entire repository, and it is prose ───────
--
-- `backend/analytics/metrics/vikray.py:8` — a COMMENT, and one that says these
-- tables are NOT the ones the product uses:
--
--     the "stored targets" live in **staging.vikray_targets** (migration 020)
--     — there is no sales_targets table
--
-- The comment is wrong about the table's existence and right about the product:
-- `vikray_targets` is the live target model. Nothing executes SQL against any of
-- the three. `migrations/030` and `migrations/201` name `sales_targets`, both
-- historical and both already applied. No router, service, cron or skill does.
--
-- ── 6 · WHAT THIS FILE CANNOT UNDO — read before applying ────────────────────
--
-- **No migration in this directory ever created these three tables.** They were
-- created outside the migration set, so unlike migration 234 — which could say
-- "the SCHEMA is recoverable from the migrations that created it" — there is
-- NOTHING in git to recover this schema from. That is why the reversal below is
-- the full DDL, read out of `pg_catalog` before the drop rather than written
-- from memory afterwards.
--
-- There is no DATA to lose: all three are empty, which is the only reason they
-- can go at all.
--
-- ══ REVERSAL ═════════════════════════════════════════════════════════════════
--
-- Run in this order (parents first; `sales_territories` self-references, so its
-- own FK is added after the table exists):
--
--   CREATE TABLE staging.sales_territories (
--       id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--       org_id         uuid NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
--       name           text NOT NULL,
--       type           text NOT NULL
--                      CHECK (type = ANY (ARRAY['region','state','city','zone','custom'])),
--       parent_id      uuid REFERENCES staging.sales_territories(id),
--       state_codes    character varying(2)[] DEFAULT '{}'::character varying[],
--       city_names     text[]  DEFAULT '{}'::text[],
--       pincode_ranges jsonb   DEFAULT '[]'::jsonb,
--       assigned_to    uuid[]  DEFAULT '{}'::uuid[],
--       manager_id     uuid REFERENCES public.users(id),
--       is_active      boolean DEFAULT true,
--       created_at     timestamptz DEFAULT now());
--   CREATE INDEX idx_stg_sales_terr_org ON staging.sales_territories USING btree (org_id);
--   ALTER TABLE staging.sales_territories ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY stg_sales_terr_org ON staging.sales_territories
--       USING (org_id = (current_setting('app.current_org_id'))::uuid);
--
--   CREATE TABLE staging.sales_targets (
--       id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--       org_id          uuid NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
--       user_id         uuid REFERENCES public.users(id),
--       team_name       text,
--       territory_id    uuid REFERENCES staging.sales_territories(id),
--       period_type     text NOT NULL
--                       CHECK (period_type = ANY (ARRAY['monthly','quarterly','annual'])),
--       period_start    date NOT NULL,
--       period_end      date NOT NULL,
--       revenue_target  numeric(15,2) NOT NULL DEFAULT 0,
--       deals_target    integer DEFAULT 0,
--       leads_target    integer DEFAULT 0,
--       calls_target    integer DEFAULT 0,
--       meetings_target integer DEFAULT 0,
--       revenue_actual  numeric(15,2) DEFAULT 0,
--       deals_actual    integer DEFAULT 0,
--       leads_actual    integer DEFAULT 0,
--       calls_actual    integer DEFAULT 0,
--       meetings_actual integer DEFAULT 0,
--       achievement_pct numeric(5,2) DEFAULT (CASE WHEN revenue_target > 0
--                           THEN round((revenue_actual / revenue_target) * 100, 2)
--                           ELSE 0 END),
--       created_by      text,
--       created_at      timestamptz DEFAULT now(),
--       updated_at      timestamptz,
--       updated_by      text);
--   CREATE INDEX idx_stg_sales_tgt_org  ON staging.sales_targets USING btree (org_id);
--   CREATE INDEX idx_stg_sales_tgt_user ON staging.sales_targets USING btree (user_id, period_start);
--   ALTER TABLE staging.sales_targets ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY stg_sales_tgt_org ON staging.sales_targets
--       USING (org_id = (current_setting('app.current_org_id'))::uuid);
--   CREATE TRIGGER trg_touch_sales_targets BEFORE UPDATE ON staging.sales_targets
--       FOR EACH ROW EXECUTE FUNCTION staging.touch_updated_at();
--   COMMENT ON COLUMN staging.sales_targets.updated_by IS
--       'public.users.user_id (TEXT) of the LAST person to amend this row. NULL = never amended by a person since this column existed. Set by the write path in the same UPDATE that changes the row; no trigger can know an actor.';
--
--   CREATE TABLE staging.sales_routing_rules (
--       id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--       org_id            uuid NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
--       name              text NOT NULL,
--       priority          integer DEFAULT 10,
--       conditions        jsonb NOT NULL DEFAULT '[]'::jsonb,
--       assign_to         uuid REFERENCES public.users(id),
--       territory_id      uuid REFERENCES staging.sales_territories(id),
--       round_robin_users uuid[] DEFAULT '{}'::uuid[],
--       round_robin_index integer DEFAULT 0,
--       is_active         boolean DEFAULT true,
--       created_at        timestamptz DEFAULT now());
--   CREATE INDEX idx_stg_sales_rr_org ON staging.sales_routing_rules USING btree (org_id, priority);
--   ALTER TABLE staging.sales_routing_rules ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY stg_sales_rr_org ON staging.sales_routing_rules
--       USING (org_id = (current_setting('app.current_org_id'))::uuid);
--
--   CREATE OR REPLACE FUNCTION staging.sales_update_target_on_deal_close()
--   RETURNS trigger LANGUAGE plpgsql AS $function$
--   BEGIN
--       IF NEW.won_at IS NOT NULL AND OLD.won_at IS NULL THEN
--           UPDATE staging.sales_targets
--           SET revenue_actual = revenue_actual + COALESCE(NEW.value, 0),
--               deals_actual = deals_actual + 1
--           WHERE user_id = NEW.owner_id
--             AND org_id = NEW.org_id
--             AND period_start <= CURRENT_DATE
--             AND period_end >= CURRENT_DATE;
--       END IF;
--       RETURN NEW;
--   END;
--   $function$;
--   CREATE TRIGGER trg_stg_deal_close_target AFTER UPDATE ON staging.crm_deals
--       FOR EACH ROW EXECUTE FUNCTION staging.sales_update_target_on_deal_close();
--
-- ══ WHY ONE STATEMENT, AND WHY NO CASCADE ════════════════════════════════════
--
-- ONE `DROP TABLE` naming all three, because they reference each other and one
-- statement resolves the ordering that would otherwise have to be got right by
-- hand (`memory/architecture_table_systems`: deletion order is fatal reversed).
--
-- NO CASCADE, deliberately. If a dependency exists that section 3 missed, the
-- statement must FAIL and leave the database exactly as it was. CASCADE would
-- drop that dependency silently and the report would read "it worked". Section
-- 4 is the standing proof that this protection is necessary but not sufficient,
-- which is why the guard below looks at function bodies too.
--
-- ═════════════════════════════════════════════════════════════════════════════

-- ── GUARD · everything below runs in ONE transaction with the DROP ───────────
-- Nothing here writes. It re-measures, and raises if any measurement disagrees
-- with the risk report above, which aborts the transaction and leaves the
-- database untouched.
DO $guard$
DECLARE
    v_names    text[] := ARRAY['sales_territories', 'sales_targets',
                               'sales_routing_rules'];
    v_name     text;
    v_present  int := 0;
    v_count    bigint;
    v_offender text;
    v_deals    bigint;
BEGIN
    -- G0 · Presence, per schema. Applied twice must be a NOTICE, not a lie:
    --      all three gone = already done; SOME gone = a partial state nobody
    --      intended, and that must stop.
    FOREACH v_name IN ARRAY v_names LOOP
        IF to_regclass('staging.' || v_name) IS NOT NULL THEN
            v_present := v_present + 1;
        END IF;
        IF to_regclass('public.' || v_name) IS NOT NULL THEN
            RAISE EXCEPTION
                'ABORT: public.% exists. The audit found no public twin of any '
                'of the three; something created one since. This migration '
                'names only staging.* and must not run blind.', v_name;
        END IF;
    END LOOP;

    IF v_present = 0 THEN
        RAISE NOTICE '235: all three tables are already absent from staging. '
                     'Nothing to do.';
        RETURN;
    ELSIF v_present <> 3 THEN
        RAISE EXCEPTION
            'ABORT: % of 3 tables present in staging. A partial stack is not a '
            'state this migration created and not one it will act on. Inspect '
            'by hand.', v_present;
    END IF;

    -- G1 · Re-count with count(*), inside this transaction. n_live_tup lies;
    --      this is the check that catches a row arriving after the audit.
    FOREACH v_name IN ARRAY v_names LOOP
        EXECUTE format('SELECT count(*) FROM staging.%I', v_name) INTO v_count;
        RAISE NOTICE '235 pre-drop count: staging.% = % row(s)', v_name, v_count;
        IF v_count <> 0 THEN
            RAISE EXCEPTION
                'ABORT: staging.% holds % row(s). It held 0 when this drop was '
                'approved. Empty was the entire basis of the approval, so a '
                'non-empty table revokes it. NOTHING has been dropped.',
                v_name, v_count;
        END IF;
    END LOOP;

    -- G2 · No foreign key may point at the three from OUTSIDE the three. The
    --      DROP would fail on this anyway; failing here names the offender.
    SELECT src_ns.nspname || '.' || src.relname || ' -> ' ||
           tgt_ns.nspname || '.' || tgt.relname || ' [' || c.conname || ']'
      INTO v_offender
      FROM pg_constraint c
      JOIN pg_class src        ON src.oid = c.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class tgt        ON tgt.oid = c.confrelid
      JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
     WHERE c.contype = 'f'
       AND tgt_ns.nspname = 'staging'
       AND tgt.relname = ANY (v_names)
       AND NOT (src_ns.nspname = 'staging' AND src.relname = ANY (v_names))
     LIMIT 1;
    IF v_offender IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORT: a foreign key from outside the set points at it: %. The '
            'audit found every inbound key internal. NOTHING has been dropped.',
            v_offender;
    END IF;

    -- G3 · The landmine check. Any FUNCTION body naming one of the three is a
    --      dependency PostgreSQL does not record and DROP does not catch.
    --      Exactly one is known and it is dropped by this migration; a second
    --      one is something this file has not read, so it stops.
    SELECT n.nspname || '.' || p.proname
      INTO v_offender
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosrc ~* 'sales_(territories|targets|routing_rules)'
       AND NOT (n.nspname = 'staging'
                AND p.proname = 'sales_update_target_on_deal_close')
     LIMIT 1;
    IF v_offender IS NOT NULL THEN
        RAISE EXCEPTION
            'ABORT: function %() names one of the three in its body. A plpgsql '
            'body is not dependency-tracked, so the DROP would SUCCEED and '
            'leave a 42P01 behind. Read it and decide. NOTHING has been '
            'dropped.', v_offender;
    END IF;

    -- G4 · And the known one must still be attached where the report says, so
    --      that dropping it is the change described and not a wider one.
    SELECT count(*) INTO v_count
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
     WHERE NOT t.tgisinternal
       AND pn.nspname = 'staging'
       AND p.proname = 'sales_update_target_on_deal_close'
       AND t.tgrelid <> 'staging.crm_deals'::regclass;
    IF v_count <> 0 THEN
        RAISE EXCEPTION
            'ABORT: sales_update_target_on_deal_close() is attached to % table(s) '
            'besides staging.crm_deals. The risk report describes one. NOTHING '
            'has been dropped.', v_count;
    END IF;

    -- Reported, not enforced: the trigger cannot have an effect either way,
    -- because G1 has just proved its target table empty.
    SELECT count(*) INTO v_deals FROM staging.crm_deals;
    RAISE NOTICE '235: staging.crm_deals holds % row(s); its trigger '
                 'trg_stg_deal_close_target writes only into sales_targets, '
                 'proved empty above, so removing it changes no row.', v_deals;

    RAISE NOTICE '235: all guards passed. Dropping.';
END
$guard$;

-- ── 1 · The trigger and its function, BY NAME, before the table it writes to ─
-- Order matters: the trigger goes first so the function is unreferenced when it
-- goes, and both go before sales_targets so no window exists in which the
-- trigger could fire against a table that is no longer there.
-- staging.touch_updated_at() is SHARED (27 triggers) and is deliberately NOT
-- dropped.
DROP TRIGGER IF EXISTS trg_stg_deal_close_target ON staging.crm_deals;
DROP FUNCTION IF EXISTS staging.sales_update_target_on_deal_close();

-- ── 2 · The three tables · ONE statement · NO CASCADE ────────────────────────
DROP TABLE IF EXISTS
    staging.sales_targets,
    staging.sales_routing_rules,
    staging.sales_territories;
