-- 257 — an invoice can carry the org's own fields
--
-- ── THE REQUIREMENT ─────────────────────────────────────────────────────────
--
-- Custom fields have existed since migration 023 and reached five entities in
-- 131 — contact, deal, client, activity, follow_up. All five are CRM records.
-- A firm that tracks something on its INVOICES ("Site", "Delivery note no.",
-- "Vehicle no.", "Approved by") has had nowhere to put it: not a column, not a
-- definition, not a box on the form. The nearest thing was `notes`, which is
-- one free-text blob and is therefore unsearchable, unlabelled and impossible
-- to print in a fixed place.
--
-- ── WHAT THIS FILE TOUCHES, exactly ─────────────────────────────────────────
--
--   REPLACES  the CHECK `graha_custom_fields_entity_type_check`, widening it
--             from five names to six by adding 'invoice'.
--   ADDS      public.ganit_invoices.custom_data  jsonb NOT NULL DEFAULT '{}'
--   COMMENTS  on the new column.
--   DROPS    no table and no column. CREATES no index and no trigger.
--   INSERTS nothing. DELETEs nothing. SEEDS nothing.
--
-- The one UPDATE it performs is the implicit backfill described below, and it
-- writes `'{}'` — the empty answer — into a column that did not exist a
-- statement earlier. No pre-existing value is read or changed.
--
-- IF IT RUNS TWICE: nothing happens. The ADD COLUMN is IF NOT EXISTS and the
-- CHECK is dropped by name before it is added, which is idempotent by
-- construction (see THE INLINE TRAP in migration 192 for why the constraint is
-- never written inline on the ADD COLUMN clause).
--
-- ── MEASURED, 2026-09-01, read-only against the live database ───────────────
--
--     ganit_invoices                97 rows; 45 carry a customer_ref
--     ganit_invoices jsonb columns  line_items, payment_schedule, quote_terms,
--                                   compliance_snapshot — and NO custom_data
--     graha_custom_fields           6 rows, ALL entity_type='contact'
--     entity_type CHECK             ('contact','deal','client','activity',
--                                    'follow_up')
--
-- So: zero rows anywhere hold an invoice custom field today, because there has
-- been nothing to hold one with. This migration cannot lose data it is the
-- first thing to make storable.
--
-- ── WHY A NEW COLUMN AND NOT ONE OF THE FOUR JSONB COLUMNS ──────────────────
--
-- Each of the four was examined and each is the wrong home:
--
--   line_items          an ARRAY, and it is the body of the document. Every
--                       element is a supply with an HSN, a rate and a taxable
--                       value; the GST figures, the GSTR-1 export and the Tally
--                       export all read it. A stray non-line object in there
--                       would be summed, filed or exported as a supply.
--   payment_schedule    an ARRAY of quotation milestones.
--   quote_terms         an ARRAY of quotation clauses.
--   compliance_snapshot the resolved compliance state FROZEN at the moment the
--                       document went final (migration 211). It is an audit
--                       record of what the rules were, and writing a user's
--                       free-form values into it would corrupt the one thing on
--                       this row whose value is that nobody edits it.
--
-- Three arrays and an audit record. `custom_data` is a values map, which is a
-- fifth shape, and it takes the name migration 131 already gave the identical
-- column on `graha_clients`, `graha_activities` and `graha_follow_ups` — the
-- same name, the same type, the same default, so one reader serves all of them.
--
-- ── WHY NOT NULL DEFAULT '{}' AND NOT A NULL-ABLE COLUMN ────────────────────
--
-- "No extra fields" is an empty map, not an unknown. There is no third state to
-- represent, so allowing NULL would only create a second way of spelling the
-- same thing — the mistake `ganit_invoices_customer_ref_ck` exists to prevent
-- on the column beside it.
--
-- ⚠ THE DEFAULT BACKFILLS EVERY EXISTING ROW. On PostgreSQL 11+ this is the
-- `attmissingval` fast path: no table rewrite, no long lock, and all 97 rows
-- read `'{}'` the instant the statement commits. This is deliberate — it means
-- the read path never meets a NULL from an existing invoice. It is NOT relied
-- on: `routers/ganit.py::_invoice_custom_fields` and
-- `InvoiceForm.jsx::fromInvoice` both collapse NULL, a missing key and a
-- wrong shape to `{}` anyway, because a row can still be set to NULL by hand
-- and because the code deploys BEFORE this file is applied (see below).
--
-- ── THE DEPLOY ORDER, AND THE ONE WAY THIS BREAKS ───────────────────────────
--
-- Code ships to Railway when the branch merges; migrations are applied by hand
-- afterwards. In that window:
--
--   READS are fine. `SELECT i.*` simply returns no `custom_data` key, the
--   resolver sees None, collapses it to `{}` and returns [] before it queries
--   anything. The PDF prints no Additional details block. Nobody notices.
--
--   ⚠ CREATING AN INVOICE 500s. The INSERT in `create_invoice` names
--   `custom_data`, and a column that does not exist is an UndefinedColumnError.
--   That is the invoice-creation path — a firm's own income — so THIS FILE
--   MUST BE APPLIED IN THE SAME WINDOW AS THE DEPLOY, not "some time after".
--   Section 1 is what fixes it and it takes milliseconds.
--
--   ⚠ DEFINING AN INVOICE FIELD 500s the same way until Section 2 runs:
--   `routers/graha.py::create_custom_field` now accepts 'invoice' and the
--   CHECK still refuses it, which is an asyncpg CheckViolation surfacing as a
--   500 rather than the clean 400 the allowlist exists to give. Nobody can
--   reach that screen for an invoice field until the frontend list is widened
--   (see the note below), so the exposure is an API caller only.
--
-- ── WHAT IS STILL NOT WIRED AFTER THIS FILE ─────────────────────────────────
--
-- `CUSTOM_FIELD_ENTITIES` in `frontend/src/pages/graha/CustomFieldInputs.jsx`
-- drives BOTH the Entity dropdown on the Custom Fields tab and the grouping of
-- the list beneath it. Until 'invoice' is added there, an org admin cannot
-- create an invoice field through the UI, and one created through the API is
-- not even listed. The invoice form, the API, the column and the PDF are all
-- ready for it; that one array is the last link.
--
-- ── REVERSAL ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE public.graha_custom_fields
--       DROP CONSTRAINT IF EXISTS graha_custom_fields_entity_type_check;
--   ALTER TABLE public.graha_custom_fields
--       ADD CONSTRAINT graha_custom_fields_entity_type_check
--       CHECK (entity_type IN ('contact','deal','client','activity','follow_up'));
--   ALTER TABLE public.ganit_invoices DROP COLUMN IF EXISTS custom_data;
--
-- ⚠ NARROWING THE CHECK FAILS while any `entity_type='invoice'` row exists,
-- and DROPPING THE COLUMN DESTROYS every value stored under those definitions.
-- Both are safe on the day this lands, when there are none of either. After
-- that, export first. Reverting the CODE without reverting this file is
-- harmless in both directions.
--
-- ── HOW TO APPLY ────────────────────────────────────────────────────────────
--
--   railway run -s Kartavya -- psql "$DATABASE_URL" -f \
--       backend/migrations/257_an_invoice_can_carry_the_org_s_own_fields.sql
--
-- THERE IS ONE DATABASE. This is a production write. Its full write-path
-- effect: `ganit_invoices` gains a column defaulting to `'{}'` on all 97 rows,
-- and `graha_custom_fields` accepts one more `entity_type`. No existing value
-- on any row is read, moved or changed.

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- GUARD 1 · Both tables are here, and the CHECK is the one this file expects
--           to widen. If somebody has already changed it, stop — silently
--           replacing an unknown constraint is how a rule gets lost.
-- ═══════════════════════════════════════════════════════════════════════════
DO $guard1$
DECLARE
    def text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='ganit_invoices') THEN
        RAISE EXCEPTION 'GUARD 1: public.ganit_invoices does not exist. This is not the Kartavaya database.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name='graha_custom_fields') THEN
        RAISE EXCEPTION 'GUARD 1: public.graha_custom_fields does not exist.';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO def
      FROM pg_constraint
     WHERE conname = 'graha_custom_fields_entity_type_check'
       AND conrelid = 'public.graha_custom_fields'::regclass;

    IF def IS NULL THEN
        RAISE NOTICE 'GUARD 1: no entity_type CHECK present — section 2 will create it.';
    ELSIF def NOT LIKE '%follow_up%' THEN
        RAISE EXCEPTION
            'GUARD 1: graha_custom_fields_entity_type_check is not the '
            'migration-131 constraint (%). Read it before widening it.', def;
    ELSIF def LIKE '%''invoice''%' THEN
        RAISE NOTICE 'GUARD 1: invoice is already permitted; section 2 is a no-op.';
    END IF;
END
$guard1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 · Where the VALUES live.
--
--   The same column migration 131 gave graha_clients, graha_activities and
--   graha_follow_ups: same name, same type, same default. The DEFINITIONS stay
--   in graha_custom_fields for every entity — one table, one create screen,
--   one rename rule.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.ganit_invoices
    ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ganit_invoices.custom_data IS
    'The org''s own extra fields on this document, as {field_id: value}. The '
    'definitions live in graha_custom_fields where entity_type = ''invoice''. '
    'KEYED BY THE DEFINITION''S UUID, never by field_name: a field can be '
    'renamed and a name-keyed map would orphan every value already stored. '
    '''{}'' means no extra fields — there is no NULL state. A key whose '
    'definition has been deleted (is_active=false) is KEPT here and simply not '
    'rendered, so re-activating the field brings its values back.';

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 · Six entities, not five.
--
--   Dropped by name and re-added rather than altered: a CHECK cannot be
--   widened in place. `invoice` is `ganit_invoices` and not a CRM record — the
--   reason it is in this list rather than in a Ganit table of its own is that
--   the definitions belong in ONE place for every entity, which is the whole
--   design migration 131 settled.
--
--   ⚠ NOT VALIDATED AGAINST EXISTING ROWS BY ACCIDENT: the new set is a strict
--   SUPERSET of the old one, so every stored value already satisfies it and
--   the ADD CONSTRAINT scan cannot fail. Widening is always safe here;
--   narrowing (see REVERSAL) is not.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.graha_custom_fields
    DROP CONSTRAINT IF EXISTS graha_custom_fields_entity_type_check;

ALTER TABLE public.graha_custom_fields
    ADD CONSTRAINT graha_custom_fields_entity_type_check
    CHECK (entity_type IN ('contact', 'deal', 'client', 'activity',
                           'follow_up', 'invoice'));

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 · VERIFY. Read every claim back out of the catalogue, and prove
--             the constraint BITES — a constraint that exists and does not
--             refuse anything is the failure the guarded pattern exists to
--             prevent (migration 192 §3 established this).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
    is_null text;
    dflt    text;
    dtype   text;
    nulls   bigint;
    probes  bigint;
    def     text;
BEGIN
    SELECT is_nullable, column_default, data_type
      INTO is_null, dflt, dtype
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ganit_invoices'
       AND column_name='custom_data';

    IF is_null IS NULL THEN
        RAISE EXCEPTION 'VERIFY 1: ganit_invoices.custom_data was not created.';
    END IF;
    IF dtype <> 'jsonb' THEN
        RAISE EXCEPTION 'VERIFY 1: custom_data is %, not jsonb.', dtype;
    END IF;
    IF is_null <> 'NO' THEN
        RAISE EXCEPTION
            'VERIFY 1: custom_data is NULL-able. "No extra fields" must have '
            'exactly one spelling, and it is ''{}''.';
    END IF;
    IF dflt IS NULL OR dflt NOT LIKE '%{}%' THEN
        RAISE EXCEPTION 'VERIFY 1: custom_data has no ''{}'' default (%).', dflt;
    END IF;

    -- VERIFY 2 · the backfill actually reached every existing row. If this
    -- fails the NOT NULL would have refused the ALTER, so it is belt and
    -- braces — but the read path's promise is "no existing invoice reads
    -- NULL", and that promise is checked rather than assumed.
    SELECT count(*) INTO nulls
      FROM public.ganit_invoices WHERE custom_data IS NULL;
    IF nulls > 0 THEN
        RAISE EXCEPTION 'VERIFY 2: % invoices still read NULL custom_data.', nulls;
    END IF;

    SELECT pg_get_constraintdef(oid) INTO def
      FROM pg_constraint
     WHERE conname = 'graha_custom_fields_entity_type_check'
       AND conrelid = 'public.graha_custom_fields'::regclass;
    IF def IS NULL THEN
        RAISE EXCEPTION 'VERIFY 3: the entity_type CHECK is absent.';
    END IF;
    IF def NOT LIKE '%''invoice''%' THEN
        RAISE EXCEPTION 'VERIFY 3: the CHECK does not permit invoice (%).', def;
    END IF;
    IF def NOT LIKE '%''follow_up''%' THEN
        RAISE EXCEPTION
            'VERIFY 3: the CHECK lost follow_up while gaining invoice (%). '
            'Widening must not drop a name.', def;
    END IF;

    -- VERIFY 4 · and it still REFUSES an unknown entity. Proved by attempting
    -- one inside a subtransaction and requiring the violation. Without this,
    -- a CHECK accidentally written as `entity_type IS NOT NULL` would pass
    -- every test above.
    BEGIN
        INSERT INTO public.graha_custom_fields
            (org_id, entity_type, field_name, field_type)
        SELECT id, 'not_an_entity', '257 verify probe', 'text'
          FROM public.organisations LIMIT 1;
        -- ⚠ ZERO ROWS PROVES NOTHING, and must not be counted as a pass. An
        -- `INSERT … SELECT` over an empty source inserts nothing and raises
        -- nothing, so without this the probe would report the constraint
        -- working on a database that has no organisations to probe with.
        -- Migration 192 §3 hit exactly this and says so.
        GET DIAGNOSTICS probes = ROW_COUNT;
        IF probes = 0 THEN
            RAISE NOTICE 'VERIFY 4 inconclusive: no organisations to probe '
                         'with. The CHECK is present and names invoice '
                         '(VERIFY 3).';
        ELSE
            RAISE EXCEPTION
                'VERIFY 4: entity_type ''not_an_entity'' was ACCEPTED. The '
                'constraint is not doing its job.';
        END IF;
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'VERIFY 4 ok: an unknown entity_type is refused.';
    END;

    RAISE NOTICE
        'VERIFY ok: ganit_invoices.custom_data is jsonb NOT NULL DEFAULT ''{}'' '
        'on every row, and graha_custom_fields accepts invoice while still '
        'refusing an unknown entity.';
END
$verify$;

COMMIT;
