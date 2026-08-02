-- 084 · Monday Morning Brief — the first skill that reads before it writes
--
-- Owner's request, 2026-08-02: skills should "first learn itself for what is
-- present not go to model to ask, as data will be within db or r2 storage".
--
-- ── What this is ─────────────────────────────────────────────────────────
--
-- One row in `staging.hub_skill_templates`. It is the first template whose
-- steps carry `skill_function` rather than `prompt_template`, so it is also the
-- first exercise of the dispatcher's data path end to end:
--
--   1. aggregate_kpis          revenue, deals, tasks, invoices, headcount (30d)
--   2. find_overdue_invoices   receivables past due by 7 days or more
--   3. find_overdue_tasks      anything not done and past its date
--   4. an `email` step         writes the brief FROM steps 1-3, not in general
--
-- Steps 1-3 call no model and cost no credits. Step 4 costs whatever `email`
-- costs — 2 credits at the time of writing, and the server owns that table, so
-- `estimated_credits` is left at the sum the API computes rather than restated
-- here. Two copies of a price list is one copy that goes stale.
--
-- ── Why these three sources ──────────────────────────────────────────────
--
-- All read-only, all org-scoped, none in WRITE_SKILL_FUNCTIONS, so nothing this
-- template can do changes a row. That is deliberate for the first one: it makes
-- the whole path observable without any possibility of it writing while it is
-- still unproven.
--
-- ── RISKS AND SIDE EFFECTS — read before applying ────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE. This INSERT is a production
--   change. There is no separate staging data to try it on first.
--
-- * `GET /v1/hub/skills/templates` has NO org filter — it returns every active
--   template to every org. So the moment this row exists with is_active=TRUE it
--   appears in the Catalog tab for Aekam Inc, QA Test Corp, and any customer
--   org that exists by then. It does NOT run for anyone: a template must be
--   assigned to an org (`hub_org_skills`) before it can be run, and this
--   migration assigns it to nobody.
--
-- * The three handlers query `staging.ganit_invoices`, `staging.tasks` and the
--   tables `aggregate_kpis` reads (`ganit_payments`, `graha_deals`,
--   `manav_employees` among them). Their column expectations have been read
--   from the handler source but NOT executed against this database. The first
--   real run is what proves them. If a column has drifted, the step fails,
--   is recorded as failed on the run, and the model is told that source was
--   unavailable — the run does not crash and no credits are spent on the
--   failed step. That is the designed failure mode, not a hoped-for one.
--
-- * Rollback is one statement, at the bottom of this file. It deactivates
--   rather than deletes, matching `DELETE /skills/templates/{id}` — a hard
--   delete would orphan `hub_org_skills` and `hub_skill_runs` rows that
--   reference the template id.
--
-- * Re-running is safe: the WHERE NOT EXISTS makes it idempotent on name.
--
-- ── Conventions ──────────────────────────────────────────────────────────
--
-- Matched to the six templates already in the table: `steps` is a jsonb array
-- with a 1-based `order` on every element, `category` is one of the seven the
-- API validates, `icon` is one of the six names `GLYPHS` renders.

INSERT INTO staging.hub_skill_templates
  (name, description, category, steps, estimated_credits, icon, skill_type, scope, is_active)
SELECT
  'Monday Morning Brief',
  'Reads your KPIs, overdue invoices and overdue tasks, then writes the week''s opening summary from what it found.',
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
      "prompt_template": "Write this week''s Monday morning brief for the leadership team, in {language}.\n\nUse ONLY the figures in the context above. Structure it as:\n1. Where we stand — the KPIs, with the two or three that matter most called out.\n2. Money to chase — the overdue invoices, oldest and largest first, with the total.\n3. What is slipping — the overdue tasks, grouped by who owns them.\n4. The three things to do this week, each tied to a specific figure above.\n\nBe direct and short. Do not invent a number. If a section''s data was unavailable, say so in one line and move on rather than guessing."
    }
  ]'::jsonb,
  0,          -- computed by the API on create; left at 0 so the server's cost
              -- table stays the only price list. The UI reads it from there.
  'calendar',
  'content',
  'org',
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM staging.hub_skill_templates WHERE name = 'Monday Morning Brief'
);


-- ── Verify ───────────────────────────────────────────────────────────────
-- Expect one row, 4 steps, 3 of them data steps.
--
-- SELECT name,
--        jsonb_array_length(steps)                                    AS steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s
--          WHERE s ? 'skill_function')                                AS data_steps,
--        is_active
-- FROM staging.hub_skill_templates
-- WHERE name = 'Monday Morning Brief';


-- ── Rollback ─────────────────────────────────────────────────────────────
-- Deactivate, do not delete: hub_org_skills and hub_skill_runs reference the id.
--
-- UPDATE staging.hub_skill_templates
--    SET is_active = FALSE, updated_at = NOW()
--  WHERE name = 'Monday Morning Brief';
