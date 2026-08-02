-- 088 · Phase 2 — three skills, each verified against live rows
--
-- APPLY 085 FIRST (adds `module`).
--
-- Every query behind these was executed read-only against this database before
-- the handler was written, and the row counts below are real:
--
--   weekly_project_brief  13 projects with movement in the last 7 days
--   get_my_desk           3 tasks for the busiest assignee; approvals leg
--                         resolves and returns 0 (nothing is pending yet)
--   triage_new_leads      2 leads, separated by 7,50,000 of open pipeline vs 0
--
-- ── Why only three ───────────────────────────────────────────────────────
--
-- Eight Phase 2 candidates were verified. Four are not seeded:
--
--   Account brief          BUILT but not seeded. It needs a `contact_id` per
--                          run, and run variables can no longer reach handler
--                          params — that path was closed because it let a user
--                          redirect a data step into another module's tables.
--                          A seeded template would have to hardcode one
--                          contact, which is useless. The handler is registered
--                          and usable; it needs the per-run parameter question
--                          answered first. See the note at the bottom.
--   Stalled signatures     ZERO rows at any sensible threshold. Aekam owns no
--                          e-sign documents at all; all 15 belong to QA Test
--                          Corp, and the only one with outstanding signers is
--                          4 days old against a 7-day default.
--   Delivered not invoiced ZERO orders have EVER reached dispatched, delivered
--                          or closed, in any org. `vikray_orders.invoice_id`
--                          has never been populated once. The query shape is
--                          proven — widened, it returns 3 rows — so this is a
--                          data fact, not a broken skill. Build it when orders
--                          start being delivered.
--   Campaign post-mortem   One campaign exists, database-wide, and it is a
--                          draft. `prachar_campaign_contacts` is empty.
--
-- Seeding a skill over an empty table produces a template that always answers
-- "nothing found" and teaches users the feature does not work.
--
-- ── Grants ───────────────────────────────────────────────────────────────
--
-- Two of the three are FREE: core PM is not a gated module, so anyone who can
-- reach Srijan can run them. That is deliberate — the first two skills most
-- people will try should not be the ones that refuse.
--
-- `New lead triage` needs `graha`.
--
-- `My desk today` is tasks and approvals ONLY. Adding the CRM follow-ups leg
-- would make the template require `graha` and refuse a core-PM user their own
-- desk — refusing somebody their own work to protect data they did not ask for
-- is the access gate working against the user.
--
-- ── RISKS AND SIDE EFFECTS ───────────────────────────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE. Production change.
-- * The templates list has no org filter, so all three appear in every
--   organisation's Catalog. None RUNS until assigned to an org.
-- * None writes. No step names anything in WRITE_SKILL_FUNCTIONS.
-- * `get_my_desk` reports the desk of WHOEVER RUNS IT — the dispatcher injects
--   the caller's own user_id and a template cannot override it. So this is not
--   a way to read a colleague's workload.
-- * Idempotent per name. Rollback deactivates rather than deletes.

INSERT INTO staging.hub_skill_templates
  (name, description, category, steps, estimated_credits, icon,
   skill_type, scope, module, is_active)
SELECT v.name, v.description, v.category, v.steps::jsonb, 0, v.icon,
       'content', 'org', v.module, TRUE
FROM (VALUES
  (
    'My desk today',
    'Your own open tasks due or overdue, and anything waiting on your approval, written up as a short plan for the day.',
    'general', 'calendar', 'kartavya',
    '[
      {"order": 1, "skill_function": "get_my_desk", "label": "Your tasks and approvals",
       "params": {"horizon_days": 7}},
      {"order": 2, "agent_type": "email",
       "prompt_template": "Write my plan for today, in {language}, addressed to me.\n\nUse ONLY the tasks and approvals above.\n1. What is already overdue - name each task, its project and how late it is. This comes first however small it is.\n2. What is due in the next few days, in order.\n3. Anything waiting on my approval, with who asked and when.\n4. Then one line: what to do first, and why that one.\n\nBe brief and concrete - this is read standing up. Name real tasks. If there is nothing in a section, say so in four words and move on. If the data was unavailable or withheld, say that plainly rather than writing an empty plan."}
    ]'
  ),
  (
    'Weekly project status brief',
    'Per-project movement over the last week - opened, closed, still open, overdue - written up for a status meeting.',
    'general', 'search', 'kartavya',
    '[
      {"order": 1, "skill_function": "weekly_project_brief", "label": "Project movement (7 days)",
       "params": {"days": 7}},
      {"order": 2, "agent_type": "email",
       "prompt_template": "Write this week''s project status note for the partners, in {language}.\n\nUse ONLY the per-project figures above.\n1. Where the work went - the projects that moved most, named, with their numbers.\n2. Where it did not - projects carrying open work with nothing closed this week.\n3. Overdue - which projects hold it and how much.\n4. The two projects that need attention next week, each with the figure that says why.\n\nName real projects. Do not total the columns unless the totals are given to you. If a caveat about missing completion dates is present, repeat it in one line - the closed figure is a floor, not an exact count."}
    ]'
  ),
  (
    'New lead triage',
    'Ranks recent leads by the pipeline actually attached to them and drafts the first approach for each.',
    'engagement', 'star', 'graha',
    '[
      {"order": 1, "skill_function": "triage_new_leads", "label": "Recent leads, best first",
       "params": {"days": 30}},
      {"order": 2, "agent_type": "email",
       "prompt_template": "Triage these leads and draft the first approach for each, in {language}.\n\nUse ONLY the leads above, in the order given - they are already ranked by open pipeline value.\nFor each lead:\n- One line on why they rank where they do, citing their pipeline value, deal count and age in days.\n- A short opening message, referencing their company and how they came to us (the source field).\n- The single next action, with a timeframe.\n\nKeep each under 120 words. Do not invent a company, a value or a conversation that has not happened. If a caveat says no lead has an owner or that scores are unavailable, repeat it in one line at the top - unowned leads are the finding, not a detail."}
    ]'
  )
) AS v(name, description, category, icon, module, steps)
WHERE NOT EXISTS (
  SELECT 1 FROM staging.hub_skill_templates x WHERE x.name = v.name
);


-- ── The open question this migration does not answer ─────────────────────
--
-- `get_account_brief` and several other genuinely useful handlers take a
-- per-run parameter — which contact, which employee, which campaign. Handler
-- params come from the registry and the template only; run variables were cut
-- off from them deliberately, because a variable of {"module": "invoices"}
-- could redirect a tasks step into the ledger.
--
-- So a per-run parameter needs a mechanism that is not "let variables through
-- again". The obvious shape is an explicit per-step allowlist —
-- {"runtime_params": ["contact_id"]} — so a template AUTHOR decides which
-- single field the runner may fill, and `module` can never be one of them.
-- That is a design decision, not a patch, and it is left open here rather than
-- guessed at.


-- ── Verify ───────────────────────────────────────────────────────────────
-- SELECT name, module,
--        jsonb_array_length(steps) AS steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s WHERE s ? 'skill_function') AS data_steps
--   FROM staging.hub_skill_templates
--  WHERE name IN ('My desk today','Weekly project status brief','New lead triage')
--  ORDER BY name;


-- ── Rollback ─────────────────────────────────────────────────────────────
-- UPDATE staging.hub_skill_templates SET is_active = FALSE, updated_at = NOW()
--  WHERE name IN ('My desk today','Weekly project status brief','New lead triage');
