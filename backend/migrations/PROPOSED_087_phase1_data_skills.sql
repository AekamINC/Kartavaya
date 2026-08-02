-- 087 · Three data-first skills that work today
--
-- APPLY 085 FIRST (adds `module`).
--
-- Phase 1. Each is a read of the org's own records followed by one AI step that
-- writes from what was read — the shape that makes a skill worth more than its
-- steps. Every handler already exists and is registered; nothing here needs new
-- Python.
--
-- ── Why these three ──────────────────────────────────────────────────────
--
-- Chosen on (value × buildable-today × narrow grant), and the third factor is
-- what separates them from Monday Morning Brief. That one reads Ganit, Graha
-- AND Manav, so `assert_step_access` refuses it to anyone missing any of the
-- three — a partner-level brief. Each of these touches ONE module, so the
-- people who do that job can actually run it.
--
--   Pipeline risk review     graha   `score_deals` — 519 deals live, the
--                                    richest data in the product.
--   Receivables chase pack   ganit   `find_overdue_invoices` — the clearest
--                                    business case there is.
--   Overdue follow-up chase  graha   `find_overdue_followups`.
--
-- None writes. Nothing here is in WRITE_SKILL_FUNCTIONS, so none can change a
-- row, and `allow_writes` appears nowhere.
--
-- ── The prompts are written against the refusal design ───────────────────
--
-- Each AI step is told that an unavailable or withheld figure is UNKNOWN rather
-- than zero, and not to estimate it. That matters because a chasing letter is a
-- deliverable somebody sends: a confident total assembled over a source that
-- did not load is worse than no letter at all.
--
-- They are also told to name specific records. The whole point of the data step
-- is that the output can say "INV-0042, 63 days, ₹1,20,000" instead of
-- "you have some outstanding receivables".
--
-- ── RISKS AND SIDE EFFECTS ───────────────────────────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE. Production change.
--
-- * `GET /v1/hub/skills/templates` has no org filter, so all three appear in
--   every organisation's Catalog on insert. None RUNS for anyone: a template
--   must be assigned into `hub_org_skills` or `hub_client_skills` first, and
--   this migration assigns nothing.
--
-- * A caller lacking the module is refused the whole run, before any credit is
--   deducted — `services/skills/context.py:assert_step_access`. That is the
--   designed behaviour, not a failure, and the message names the module to ask
--   for.
--
-- * `find_overdue_invoices` and `find_overdue_followups` were repaired in
--   d059c392 and their SQL verified read-only against this database.
--   `score_deals` has NOT been executed against real data — it is registered
--   and org-scoped, but this will be its first run. If it drifts, the step is
--   recorded failed, the model is told that source was unavailable, and no
--   credit is spent on it.
--
-- * Idempotent per name; re-running inserts nothing.
--
-- * Rollback deactivates rather than deletes, so `hub_org_skills` and
--   `hub_skill_runs` rows referencing these ids are not orphaned.

INSERT INTO staging.hub_skill_templates
  (name, description, category, steps, estimated_credits, icon,
   skill_type, scope, module, is_active)
SELECT v.name, v.description, v.category, v.steps::jsonb, 0, v.icon,
       'content', 'org', v.module, TRUE
FROM (VALUES
  (
    'Pipeline risk review',
    'Scores every open deal for staleness and slipped close dates, then writes the manager''s rescue list naming the deals at risk.',
    'general', 'search', 'graha',
    '[
      {"order": 1, "skill_function": "score_deals", "label": "Deal health scores"},
      {"order": 2, "agent_type": "email",
       "prompt_template": "Write a short pipeline rescue brief for the sales manager, in {language}.\n\nUse ONLY the scored deals above. Cover:\n1. The deals most at risk, worst first, each named with its value, its owner and WHY it scored badly.\n2. Any pattern across them - a stage where deals stall, an owner carrying too many, deals with no recent activity.\n3. The specific next action for the top three, one line each.\n\nName real deals. Do not invent one, and do not soften a score. If the deal data was unavailable or withheld, say so plainly in one line and stop - do not write a brief without it."}
    ]'
  ),
  (
    'Receivables chase pack',
    'Lists invoices more than a week past due with their ageing, then drafts a chasing letter for each client naming the actual invoice numbers.',
    'general', 'megaphone', 'ganit',
    '[
      {"order": 1, "skill_function": "find_overdue_invoices",
       "label": "Invoices 7+ days past due",
       "params": {"module": "invoices", "days_overdue": 7}},
      {"order": 2, "agent_type": "email",
       "prompt_template": "Draft this week''s collection emails, in {language}.\n\nUse ONLY the overdue invoices above. For each client:\n- Open politely, then state the invoice number, the amount and how many days it is overdue.\n- Group several invoices for the same client into ONE email with a total.\n- Close with a specific ask and a date.\n\nOrder the emails oldest debt first. Keep each under 150 words - these get read on a phone.\n\nEvery number must come from the data above. Do not invent an invoice, an amount or a date. If the invoice list was unavailable or withheld, say so in one line and write nothing further - a chasing letter with an invented total is worse than no letter."}
    ]'
  ),
  (
    'Overdue follow-up chase',
    'Finds CRM follow-ups that are past their date and drafts the message each one needs, so nothing is dropped.',
    'engagement', 'calendar', 'graha',
    '[
      {"order": 1, "skill_function": "find_overdue_followups",
       "label": "Follow-ups past due",
       "params": {"module": "follow_ups", "days_overdue": 0}},
      {"order": 2, "agent_type": "email",
       "prompt_template": "Draft the catch-up messages for these missed follow-ups, in {language}.\n\nUse ONLY the follow-ups above. For each one:\n- Name the contact and what the follow-up was for.\n- Acknowledge the delay without over-apologising - one clause, not a paragraph.\n- Ask the specific question that was meant to be asked, and propose a next step.\n\nPut the longest-overdue first. Keep each under 120 words.\n\nIf the follow-up list was unavailable or withheld, say so in one line rather than writing generic outreach."}
    ]'
  )
) AS v(name, description, category, icon, module, steps)
WHERE NOT EXISTS (
  SELECT 1 FROM staging.hub_skill_templates x WHERE x.name = v.name
);


-- ── Verify ───────────────────────────────────────────────────────────────
-- Expect three rows, each 2 steps / 1 data step / 0 writes, each with a module.
--
-- SELECT name, module,
--        jsonb_array_length(steps) AS steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s WHERE s ? 'skill_function') AS data_steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s WHERE (s->>'allow_writes')::bool IS TRUE) AS writes
--   FROM staging.hub_skill_templates
--  WHERE name IN ('Pipeline risk review','Receivables chase pack','Overdue follow-up chase')
--  ORDER BY name;


-- ── Rollback ─────────────────────────────────────────────────────────────
-- UPDATE staging.hub_skill_templates
--    SET is_active = FALSE, updated_at = NOW()
--  WHERE name IN ('Pipeline risk review','Receivables chase pack','Overdue follow-up chase');
