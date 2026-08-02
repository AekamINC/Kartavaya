-- 084 · Monday Morning Brief — the first skill that reads before it writes
--
-- Owner's request, 2026-08-02: skills should "first learn itself for what is
-- present not go to model to ask, as data will be within db or r2 storage".
--
-- APPLY 085 FIRST. This row sets `module`, which 085 adds.
--
-- ── What this is ─────────────────────────────────────────────────────────
--
-- One row in `staging.hub_skill_templates`, and the first whose steps carry
-- `skill_function` rather than `prompt_template` — so it is also the first
-- end-to-end exercise of the dispatcher's data path:
--
--   1. aggregate_kpis          revenue, deals, tasks closed, invoices sent,
--                              leads, expenses, headcount (30 days)
--   2. find_overdue_invoices   receivables 7+ days past due
--   3. find_overdue_tasks      anything not done and past its date
--   4. an `email` step         writes the brief FROM steps 1-3, not in general
--
-- Steps 1-3 call no model and cost no credits. Step 4 costs whatever `email`
-- costs. `estimated_credits` is left at 0 so the API's own cost table stays the
-- only price list.
--
-- ── This version is a re-cut. The first one could not have run ───────────
--
-- Written before the handlers were checked against the live schema. All three
-- data steps would have failed:
--
--   aggregate_kpis          joined `staging.tasks` to `staging.projects` on
--                           t.project_id. `staging.tasks` does not exist and
--                           `public.tasks` has no project_id — UndefinedTable.
--   find_overdue_invoices   computed `datetime.utcnow() - row["due"]` where
--                           due_date is a DATE — TypeError on the first row.
--   find_overdue_tasks      read `staging.tasks`, which does not exist.
--
-- All three are fixed and verified read-only against the live catalog: the KPI
-- arms return revenue 88500, 150 tasks closed, 2 active employees for Aekam
-- Inc, and the overdue queries execute and return rows.
--
-- ── Who can run it, and why that is not everyone ─────────────────────────
--
-- `aggregate_kpis` reads Ganit, Graha AND Manav. Under
-- `services/skills/modules.py` the run is REFUSED unless the caller holds every
-- module a step touches, so this is a partner-level brief: it needs `ganit`,
-- `graha` and `manav`. That is deliberate and it is the owner's rule — a
-- confident summary over payroll and revenue is exactly what must not reach
-- someone without those grants.
--
-- A narrower version for staff (receivables plus tasks, needing only `ganit`)
-- is worth seeding separately once this one is proven. It is not bundled here
-- because one template that refuses honestly is a better first test than two
-- that dilute what is being tested.
--
-- ── RISKS AND SIDE EFFECTS — read before applying ────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE. This INSERT is a production
--   change. There is no separate staging data to try it on first.
--
-- * `GET /v1/hub/skills/templates` has NO org filter — every active template is
--   returned to every org. So on insert this appears in the Catalog tab for
--   Aekam Inc, QA Test Corp and any customer org. It does NOT run for anyone:
--   a template must be assigned (`hub_org_skills`) first, and this migration
--   assigns it to nobody.
--
-- * Nothing it does can write. All three data steps are reads and none is in
--   WRITE_SKILL_FUNCTIONS, so the first exercise of this path cannot change a
--   row while it is still unproven.
--
-- * The failure mode if a handler still drifts: the step is recorded as failed
--   on the run, the model is told that source was unavailable rather than
--   empty, and no credits are spent on the failed step. The run does not crash.
--
-- * Re-running is safe — WHERE NOT EXISTS on name.
--
-- * Rollback deactivates rather than deletes, matching
--   `DELETE /skills/templates/{id}`: a hard delete would orphan
--   `hub_org_skills` and `hub_skill_runs` rows referencing the id.
--
-- ── Conventions ──────────────────────────────────────────────────────────
--
-- Matched to the six templates already in the table: `steps` is a jsonb array
-- with a 1-based `order` on every element, `category` one of the seven the API
-- validates, `icon` one of the six names `GLYPHS` renders. `module` is NULL
-- because this skill is cross-module; see 085 for why that is a real answer
-- rather than a missing one.

INSERT INTO staging.hub_skill_templates
  (name, description, category, steps, estimated_credits, icon,
   skill_type, scope, module, is_active)
SELECT
  'Monday Morning Brief',
  'Reads your KPIs, overdue invoices and overdue tasks, then writes the week''s opening summary from what it found. Needs access to Finance, CRM and HR.',
  'general',
  '[
    {
      "order": 1,
      "skill_function": "aggregate_kpis",
      "label": "Business KPIs (last 30 days)",
      "params": {"period": "30d"}
    },
    {
      "order": 2,
      "skill_function": "find_overdue_invoices",
      "label": "Overdue customer invoices",
      "params": {"module": "invoices", "days_overdue": 7}
    },
    {
      "order": 3,
      "skill_function": "find_overdue_tasks",
      "label": "Overdue tasks",
      "params": {"module": "tasks", "days_overdue": 0}
    },
    {
      "order": 4,
      "agent_type": "email",
      "prompt_template": "Write this week''s Monday morning brief for the leadership team, in {language}.\n\nUse ONLY the figures in the context above. Structure it as:\n1. Where we stand - the KPIs, with the two or three that matter most called out.\n2. Money to chase - the overdue invoices, oldest and largest first, with the total.\n3. What is slipping - the overdue tasks, grouped by who owns them.\n4. The three things to do this week, each tied to a specific figure above.\n\nBe direct and short. Do not invent a number. Any figure listed as unavailable or withheld is unknown, not zero - say so in one line and move on rather than estimating it."
    }
  ]'::jsonb,
  0,            -- the API computes this; one price list, and it is the server's
  'calendar',
  'content',
  'org',
  NULL,         -- cross-module. See 085.
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM staging.hub_skill_templates WHERE name = 'Monday Morning Brief'
);


-- ── Verify ───────────────────────────────────────────────────────────────
-- Expect one row, 4 steps, 3 of them data steps, none of them writes.
--
-- SELECT name,
--        jsonb_array_length(steps)                                   AS steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s
--          WHERE s ? 'skill_function')                               AS data_steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s
--          WHERE (s->>'allow_writes')::bool IS TRUE)                 AS write_steps,
--        module, is_active
--   FROM staging.hub_skill_templates
--  WHERE name = 'Monday Morning Brief';


-- ── Rollback ─────────────────────────────────────────────────────────────
-- UPDATE staging.hub_skill_templates
--    SET is_active = FALSE, updated_at = NOW()
--  WHERE name = 'Monday Morning Brief';
