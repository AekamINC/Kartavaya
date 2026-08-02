-- 089 · Account brief — the skill runtime parameters unblocked
--
-- APPLY 085 FIRST (adds `module`).
--
-- ── Why this one needed a mechanism, not just a template ─────────────────
--
-- `get_account_brief` was built and verified in Phase 2 and could not be
-- seeded. It needs to know WHICH contact, and only the person running it knows
-- that. Run variables had been cut off from handler arguments entirely, because
-- a variable of {"module": "invoices"} could redirect a tasks step into the
-- receivables ledger. So a seeded template would have had to hardcode one
-- customer, which is useless.
--
-- The mechanism is `runtime_params`: an allowlist the AUTHOR opens, per step.
--
--     {"skill_function": "get_account_brief",
--      "runtime_params": ["contact_id"],
--      "params": {"activity_limit": 50}}
--
-- The rule that makes it safe: a runtime value may select WHICH ROW, never
-- WHICH SOURCE. Selecting a row is safe because the handler still filters on
-- org_id inside its own query, so asking for another tenant's contact_id
-- returns nothing. `module`, `org_id`, `user_id` and `allow_writes` are in
-- RUNTIME_FORBIDDEN_PARAMS and are stripped even when a template asks for them.
--
-- ── Who can run it ───────────────────────────────────────────────────────
--
-- graha (contact, deals, activity) + ganit (invoices) + vikray (orders). All
-- three, so in practice org_owner / org_admin. That is the right trade: the
-- whole value is one page carrying the relationship AND the money, and a
-- version that quietly dropped the invoices would let a partner walk into a
-- meeting not knowing the client is in arrears.
--
-- `module` is left NULL — it is cross-module, and claiming one would be a lie
-- in the catalog.
--
-- ── Verified live ────────────────────────────────────────────────────────
--
-- All five sections populate for contact 2330b053-4d13-4d78-b4ef-afb3279689fd
-- (Priya Patel, TechCorp India): header 1, open_deals 0, activity 1, invoices 1
-- (INV-2026-0003, 88,500.00, paid), orders 1 (SO-2026-0001, 295,000.00,
-- confirmed). The open-deals branch is proven non-empty against Vikram Singh
-- (750,000.00) and the open-invoice branch against Meghdoot Textiles (74,340.00
-- unpaid), so no branch is untested merely because one contact does not
-- exercise it.
--
-- ── RISKS AND SIDE EFFECTS ───────────────────────────────────────────────
--
-- * STAGING AND PRODUCTION SHARE THIS DATABASE. Production change.
-- * Appears in every org's Catalog; runs for nobody until assigned.
-- * Read-only. No step names anything in WRITE_SKILL_FUNCTIONS.
-- * A caller without all three grants is refused the whole run before any
--   credit is deducted, and told which module to ask for.
-- * A contact_id belonging to another org returns {"contact": null} rather than
--   raising — the caller asked about somebody who is not theirs, which is an
--   empty answer, not an error.
-- * Idempotent per name.

INSERT INTO staging.hub_skill_templates
  (name, description, category, steps, estimated_credits, icon,
   skill_type, scope, module, is_active)
SELECT
  'Account brief',
  'Everything known about one customer - open deals, recent activity, invoices and orders - written up for a call. Needs access to CRM, Finance and Sales.',
  'general',
  '[
    {"order": 1, "skill_function": "get_account_brief",
     "label": "Everything on this customer",
     "runtime_params": ["contact_id"],
     "params": {"activity_limit": 50}},
    {"order": 2, "agent_type": "email",
     "prompt_template": "Write the pre-call brief on this customer, in {language}.\n\nUse ONLY the record above.\n1. Who they are - name, company, role, how they came to us.\n2. Where the money stands - every invoice, what is outstanding and what was paid on time. If they have paid promptly, say so; that is worth knowing walking in.\n3. What is open - deals with their value and stage, and any order not yet invoiced.\n4. Last contact - what happened and when, and what was promised.\n5. The two things to raise on this call.\n\nName real figures and real dates. Do not invent a conversation. If a section is empty say so in a few words - no open deals is useful information. If the record was unavailable or withheld, say that and stop."}
  ]'::jsonb,
  0, 'star', 'content', 'org', NULL, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM staging.hub_skill_templates WHERE name = 'Account brief'
);


-- ── Verify ───────────────────────────────────────────────────────────────
-- SELECT name, jsonb_array_length(steps) AS steps,
--        steps->0->'runtime_params' AS asks_for
--   FROM staging.hub_skill_templates WHERE name = 'Account brief';


-- ── Rollback ─────────────────────────────────────────────────────────────
-- UPDATE staging.hub_skill_templates SET is_active = FALSE, updated_at = NOW()
--  WHERE name = 'Account brief';
