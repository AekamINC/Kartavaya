-- 253 — a compliance setting can be overridden for one client or one employee
--
-- ── THE REQUIREMENT ─────────────────────────────────────────────────────────
--
-- The owner's words: "by default settings default will apply on all but if org,
-- client asked to or remove gst, or employee negotiation on leave and commission
-- then it override default setting."
--
-- `module_compliance_settings` was org-scoped: one row per (org, module, rule).
-- There was no way to say "this rule is different for this one client" short of
-- changing it for the whole firm.
--
-- ── EVERY EXISTING ROW IS A FIRM DEFAULT ────────────────────────────────────
--
-- `scope_type` defaults to 'org', so the two rows that existed when this ran
-- (both `ganit`, two orgs) keep meaning exactly what they meant. Nothing
-- resolves to a different state because of this migration.
--
-- ⚠ TWO PARTIAL INDEXES, NOT ONE FOUR-COLUMN ONE.
--
-- The obvious replacement for `UNIQUE (org_id, module, rule_key)` is
-- `UNIQUE (org_id, module, rule_key, scope_type, scope_id)`. It is wrong:
-- Postgres treats NULLs as DISTINCT in a unique index, and `scope_id` is NULL
-- for every firm default — so that index would happily accept two, three, any
-- number of conflicting org-level rows for the same rule, and the resolver
-- would return whichever the planner reached first. Silently, and only once a
-- firm had set the same rule twice.
--
-- So: one partial index for the defaults, one for the overrides.
--
-- ⚠ AND AN `ON CONFLICT` MUST NAME THE PREDICATE. An inference clause has to
-- match a partial index INCLUDING its WHERE. The pre-253 spelling matches
-- nothing at all and every save fails with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification". `services/compliance_
-- settings.py::set_rule` carries both spellings, and
-- `tests/test_compliance_settings_scopes.py` EXECUTES both against the real
-- schema — `prepare()` is not enough, because Postgres resolves the arbiter at
-- planning time and a PREPARE of the broken statement succeeds.

BEGIN;

ALTER TABLE public.module_compliance_settings
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'org',
  ADD COLUMN IF NOT EXISTS scope_id uuid;

ALTER TABLE public.module_compliance_settings
  DROP CONSTRAINT IF EXISTS module_compliance_settings_scope_type_check;
ALTER TABLE public.module_compliance_settings
  ADD CONSTRAINT module_compliance_settings_scope_type_check
  CHECK (scope_type IN ('org', 'client', 'employee'));

-- An override with nobody to be about, and a firm default that names one, are
-- both nonsense. Refused in the schema rather than trusted to the service.
ALTER TABLE public.module_compliance_settings
  DROP CONSTRAINT IF EXISTS module_compliance_settings_scope_shape_check;
ALTER TABLE public.module_compliance_settings
  ADD CONSTRAINT module_compliance_settings_scope_shape_check
  CHECK (
    (scope_type = 'org'  AND scope_id IS NULL)
    OR
    (scope_type <> 'org' AND scope_id IS NOT NULL)
  );

ALTER TABLE public.module_compliance_settings
  DROP CONSTRAINT IF EXISTS module_compliance_settings_org_id_module_rule_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS module_compliance_settings_org_default_uq
  ON public.module_compliance_settings (org_id, module, rule_key)
  WHERE scope_type = 'org';

CREATE UNIQUE INDEX IF NOT EXISTS module_compliance_settings_override_uq
  ON public.module_compliance_settings (org_id, module, rule_key, scope_type, scope_id)
  WHERE scope_type <> 'org';

COMMENT ON COLUMN public.module_compliance_settings.scope_type IS
  'org = the firm-wide default. client / employee = an override for one of them.';

COMMENT ON COLUMN public.module_compliance_settings.scope_id IS
  'The client or employee the override is for. NULL only when scope_type = org. The service checks it belongs to the same org, because it references two different tables and a FK cannot.';

COMMIT;
