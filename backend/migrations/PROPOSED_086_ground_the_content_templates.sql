-- 086 · Give the six content templates something to read
--
-- Phase 1, and the cheapest real improvement available: no code, one jsonb edit.
--
-- ── What is wrong today ──────────────────────────────────────────────────
--
-- All six seeded templates are pure generation. Their steps carry an
-- `agent_type` and a `prompt_template` and nothing else, so a run reaches the
-- model with the BRAND PROFILE alone — voice, tone, audience, tagline — and no
-- knowledge of the organisation whatsoever. That is the complaint this whole
-- line of work started from: a plausible essay written by something that has
-- never seen the business.
--
-- The retrieval to fix it has existed since the Chat tab shipped
-- (`services/rag.py:search_hybrid`, pgvector + full-text over
-- `hub_kb_documents`). Skills simply never asked for it.
--
-- ── Why `knowledge` and nothing else ─────────────────────────────────────
--
-- `services/skills/modules.py` declares `knowledge` as FREE — it reads the
-- org's own knowledge base, which sits inside Srijan, and the caller already
-- holds Srijan or they could not have reached a skill at all.
--
-- Every OTHER source belongs to a gated module, and adding one here would
-- narrow who may run these templates: `kpis` would demand Ganit, Graha AND
-- Manav, so a marketing user who runs Weekly Social Media Pack today would be
-- refused tomorrow. Improving a skill must not take it away from the people
-- using it. Sources that cost a grant belong on new templates, where nobody
-- loses anything.
--
-- ── What changes for a reader ────────────────────────────────────────────
--
-- Each AI step is handed the passages of the org's own documents most relevant
-- to that step's prompt, under a heading telling the model to ground its claims
-- and not to invent figures. An empty knowledge base renders "Nothing found."
-- and the step behaves exactly as it does today — so this is safe on an org
-- that has uploaded nothing.
--
-- ── RISKS AND SIDE EFFECTS ───────────────────────────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE, and the template catalog has no
--   org filter, so this changes the six templates for EVERY organisation at
--   once. That is the intent — they are platform templates — but it is not
--   reversible per customer.
--
-- * NO grant becomes newly required. `knowledge` is FREE in modules.py, so
--   `assert_step_access` still passes for anyone who can run these today.
--   Pinned by `test_the_existing_content_templates_are_unaffected`.
--
-- * Cost rises slightly. Each grounded step now carries up to a few hundred
--   extra tokens of retrieved context, and generates one embedding for the
--   retrieval query. Bounded by MAX_CONTEXT_CHARS (8000) and top_k=5. No extra
--   CREDIT is charged — credits are per step, not per token.
--
-- * Latency rises by one embedding call plus one hybrid query per step.
--
-- * If the embedding provider is down the step still runs: `build_context`
--   reports that source unavailable and the model is told so explicitly rather
--   than being handed silence.
--
-- * Idempotent. The WHERE clause skips any template that already has a
--   `context` key on any step, so re-running changes nothing and a
--   hand-customised template is never overwritten.
--
-- * Rollback strips the key back out; the templates return to today's
--   behaviour exactly.

UPDATE staging.hub_skill_templates t
SET steps = sub.rebuilt,
    updated_at = NOW()
FROM (
  SELECT tt.id,
         jsonb_agg(
           CASE
             WHEN e.step ? 'agent_type' AND NOT (e.step ? 'context')
               THEN e.step || '{"context": ["knowledge"]}'::jsonb
             ELSE e.step
           END
           ORDER BY e.ord            -- array order, not the `order` field
         ) AS rebuilt
  FROM staging.hub_skill_templates tt,
       LATERAL jsonb_array_elements(tt.steps) WITH ORDINALITY AS e(step, ord)
  WHERE tt.is_active
    AND tt.name IN (
      'Weekly Social Media Pack', 'Weekly Reel Scripts', 'Festival Calendar',
      'Product Launch Pack', 'Campaign Launch', 'SEO Blog Series'
    )
    -- Skip anything already grounded or hand-customised.
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(tt.steps) s WHERE s ? 'context'
    )
  GROUP BY tt.id
) AS sub
WHERE t.id = sub.id;


-- ── Verify ───────────────────────────────────────────────────────────────
-- Expect six rows, every step grounded, and no step having gained anything
-- other than the context key.
--
-- SELECT name,
--        jsonb_array_length(steps) AS steps,
--        (SELECT count(*) FROM jsonb_array_elements(steps) s
--          WHERE s->'context' ? 'knowledge') AS grounded_steps
--   FROM staging.hub_skill_templates
--  WHERE is_active AND name IN (
--    'Weekly Social Media Pack','Weekly Reel Scripts','Festival Calendar',
--    'Product Launch Pack','Campaign Launch','SEO Blog Series')
--  ORDER BY name;


-- ── Rollback ─────────────────────────────────────────────────────────────
-- UPDATE staging.hub_skill_templates t
-- SET steps = sub.rebuilt, updated_at = NOW()
-- FROM (
--   SELECT tt.id, jsonb_agg((e.step - 'context') ORDER BY e.ord) AS rebuilt
--   FROM staging.hub_skill_templates tt,
--        LATERAL jsonb_array_elements(tt.steps) WITH ORDINALITY AS e(step, ord)
--   WHERE tt.name IN (
--     'Weekly Social Media Pack','Weekly Reel Scripts','Festival Calendar',
--     'Product Launch Pack','Campaign Launch','SEO Blog Series')
--   GROUP BY tt.id
-- ) AS sub
-- WHERE t.id = sub.id;
