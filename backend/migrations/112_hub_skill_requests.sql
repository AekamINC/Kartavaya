-- 112_hub_skill_requests.sql
--
-- THE SKILL CARD IS TERMINAL. A customer who wants a skill they do not have can
-- read about it and then close the tab. This is the table that lets them ask.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/112_hub_skill_requests.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 6 August 2026. Measured against the live catalogue
-- (`to_regclass('staging.hub_skill_requests')` → NULL, project
-- toacecaewujfxjfrjwco), deliberately not run.
--
-- ── WHY A NEW TABLE, HAVING CHECKED EVERY EXISTING ONE ──────────────────────
--
-- Three candidates were considered and all three are wrong:
--
--   `staging.hub_org_skills` — this is the GRANT. A row in it means the org HAS
--       the skill; `GET /v1/hub/org/skills` selects `WHERE is_active=TRUE` and
--       joins the template. Writing a request into it either grants the skill
--       (which is the thing being requested) or requires an `is_active=FALSE`
--       row that every existing query already filters out and that means
--       "revoked" everywhere else it appears. A request is not a revoked grant.
--
--   `staging.crm_leads` / `staging.graha_*` — the CUSTOMER'S OWN CRM. Aekam's
--       sales pipeline does not go inside a tenant's contact list. Every read
--       path there is org-scoped to the tenant, so the lead would be visible to
--       the customer as one of their own leads, and Aekam could not see it
--       without a cross-org read.
--
--   `staging.account_requests` — does not exist. PROPOSED_067 is unapplied, and
--       its shape is per-USER GDPR export/delete, which is a different thing
--       with a different lifecycle.
--
-- So: a new table. Small, and honest about being Aekam's record rather than the
-- tenant's.
--
-- ── THE HONEST GAP THIS TABLE CANNOT CLOSE ──────────────────────────────────
--
-- `staging.organisations` has 44 columns and NOT ONE of them names an account
-- contact, an account manager, or an Aekam-side owner. (`owner_user_id` is the
-- CUSTOMER's own owner.) There is no account-contact relationship in this
-- schema at all. So "who gets told" is resolved at send time from the
-- platform-tier commercial roles — `user_roles WHERE org_id IS NULL AND
-- role_code IN ('account_manager','platform_admin')` — which is what "the
-- account contact" means today and is not what it should mean forever.
--
-- `notified_to` exists so that the day a real per-org account contact lands,
-- history does not have to be rewritten or guessed at: every row already
-- records the addresses the mail actually went to. That column is the entire
-- reason this gap is survivable.
--
-- ── EVERY DEFAULT, CHOSEN AS IF NOBODY EVER OPENS THE SCREEN ────────────────
--
-- Migration 106's lesson, applied column by column:
--
--   status          'open'   the only state a new row can be in.
--   note            ''       not NULL. One absent value, not two.
--   notified_to     '{}'     "nobody was told" is the truthful record of a row
--                            written before the mail went out, and it must not
--                            be confused with "we did not record it".
--   setup_fee_paise 0        ON hub_skill_templates. NINETEEN EXISTING ROWS get
--                            this default the instant this runs, and 0 is the
--                            only safe number: any other value invents a charge
--                            for nineteen skills nobody agreed to price. The
--                            drawer's "One-off setup" row currently reads a
--                            FIXTURE (`MktData.fee`) — there is no column
--                            behind it at all.
--   permissions     NULL     ON hub_skill_templates. NULL means "not stated";
--                            '{}' would mean "stated: this skill needs
--                            nothing", which is a claim about nineteen skills
--                            nobody has checked. The drawer must render NULL as
--                            "not stated" and not as an empty list.
--
-- ── LOCKS ───────────────────────────────────────────────────────────────────
--
-- One CREATE TABLE, three CREATE INDEX, two ALTER TABLE ... ADD COLUMN.
--
-- The two ALTERs take ACCESS EXCLUSIVE on `staging.hub_skill_templates` until
-- COMMIT. Both are catalogue updates WITHOUT a table rewrite: PG 11+ stores a
-- constant default in the catalogue rather than writing 19 rows, and a nullable
-- column with no default has never rewritten. The work is microseconds; the
-- risk is acquisition — the lock queues behind any open transaction on that
-- table and blocks every reader that arrives after it. Blast radius is the
-- skills marketplace and the skill dispatcher, not the whole product.
-- `lock_timeout` makes the bad case a clean rollback.
--
-- The FKs take ShareRowExclusiveLock on `organisations` (3 rows) and
-- `hub_skill_templates` (19 rows) — writes blocked, reads not, for a catalogue
-- write.
--
-- No data is rewritten, so no wrong-database guard. Schema only.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── GUARD 0 · both parents ──────────────────────────────────────────────────
DO $$
BEGIN
    IF to_regclass('staging.organisations') IS NULL THEN
        RAISE EXCEPTION 'staging.organisations does not exist.';
    END IF;
    IF to_regclass('staging.hub_skill_templates') IS NULL THEN
        RAISE EXCEPTION
            'staging.hub_skill_templates does not exist. A request references a '
            'template; without the catalogue there is nothing to request.';
    END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · The request
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS staging.hub_skill_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    org_id       UUID NOT NULL
                 REFERENCES staging.organisations(id) ON DELETE CASCADE,

    -- RESTRICT, not CASCADE. Templates in this product are retired by setting
    -- `is_active = FALSE`, never DELETEd — so RESTRICT costs nothing today and
    -- states the rule: a template with requests against it cannot be made to
    -- vanish, taking the record of who asked for it with it.
    template_id  UUID NOT NULL
                 REFERENCES staging.hub_skill_templates(id) ON DELETE RESTRICT,

    -- TEXT, not UUID: `user_549c9cac35aa`. Migrations 030 and 092 are the scars.
    requested_by TEXT NOT NULL,

    -- The note is the point of the feature — it is what the account contact
    -- would otherwise have to ask for by email. NOT NULL DEFAULT '' so there is
    -- exactly one representation of "no note", and a length CHECK so the API's
    -- `Field(max_length=2000)` is also a database fact rather than only a
    -- Pydantic one.
    note         TEXT NOT NULL DEFAULT ''
                 CHECK (length(note) <= 2000),

    status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'granted', 'declined', 'withdrawn')),

    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at   TIMESTAMPTZ,
    decided_by   TEXT,

    -- The addresses the mail actually went to. See the header: this is what
    -- makes the missing account-contact relationship survivable.
    notified_to  TEXT[] NOT NULL DEFAULT '{}',

    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Invariants ──────────────────────────────────────────────────────────

    -- Open means undecided, and every other status means decided. One
    -- biconditional rather than two implications, so neither direction can
    -- drift: a 'granted' row with no decided_at is a grant nobody can date, and
    -- an 'open' row with a decided_at is a decision that did not take.
    CONSTRAINT hsr_open_is_exactly_undecided
        CHECK ((status = 'open') = (decided_at IS NULL)),

    -- Every decision has an author. `withdrawn` is a decision too — by the
    -- requester — and it records them.
    CONSTRAINT hsr_decider_pairs
        CHECK ((decided_at IS NULL) = (decided_by IS NULL)),

    CONSTRAINT hsr_decision_after_request
        CHECK (decided_at IS NULL OR decided_at >= requested_at)
);

COMMENT ON TABLE staging.hub_skill_requests IS
    'A customer asking for a skill they do not have. This is AEKAM''S LEAD, not '
    'the tenant''s CRM record — deliberately not written into crm_leads/graha_*, '
    'which are the customer''s own contact data and are org-scoped to them. '
    'Read back to the catalogue through the existing GET /v1/hub/org/skills as '
    'a SIBLING key (`skill_requests`), never by widening its `data` array: that '
    'array is the ACTIVE grant set and a requested-not-granted template has no '
    'hub_org_skills row to appear in.';

COMMENT ON COLUMN staging.hub_skill_requests.notified_to IS
    'The addresses the request mail actually went to, resolved at send time '
    'from the platform-tier commercial roles because staging.organisations has '
    'no account-contact column (all 44 checked, 6 August 2026). Default {} '
    'truthfully records "nobody told yet" for the window between the INSERT and '
    'the fan-out. When a real per-org account contact exists, this column means '
    'history does not have to be reconstructed.';

COMMENT ON COLUMN staging.hub_skill_requests.status IS
    'open|granted|declined|withdrawn. `granted` is set when the corresponding '
    'hub_org_skills row is written — it is a RECORD of the grant, not the grant '
    'itself, and nothing may read this column to decide whether the org has the '
    'skill. hub_org_skills.is_active is the only answer to that question.';


-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · Indexes
-- ═════════════════════════════════════════════════════════════════════════════

-- IDEMPOTENCY AS AN INDEX, NOT AS APPLICATION LOGIC. Same shape as
-- PROPOSED_067's idx_account_requests_one_open. A second press of "Request this
-- skill" hits `ON CONFLICT DO NOTHING`, the endpoint re-SELECTs the open row
-- and returns it with 200 instead of minting a second lead. Enforcing this in
-- Python instead means a race between two clicks produces two rows, and the
-- account contact gets two emails about one skill.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_skill_requests_one_open
    ON staging.hub_skill_requests (org_id, template_id)
    WHERE status = 'open';

-- The sibling-key read on GET /v1/hub/org/skills: this org's open requests.
CREATE INDEX IF NOT EXISTS idx_hub_skill_requests_org_status
    ON staging.hub_skill_requests (org_id, status);

-- Aekam's queue, newest first.
CREATE INDEX IF NOT EXISTS idx_hub_skill_requests_queue
    ON staging.hub_skill_requests (status, requested_at DESC);


-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Two columns the drawer needs and the catalogue does not have
-- ═════════════════════════════════════════════════════════════════════════════

-- The drawer renders a "One-off setup" row. There is no column behind it —
-- the number on screen today comes from `MktData.fee`, a frontend fixture.
-- PAISE, not rupees, and INTEGER, not numeric: every other money value in this
-- product that is stored as a float eventually shows ₹1,999.9999996.
ALTER TABLE staging.hub_skill_templates
    ADD COLUMN IF NOT EXISTS setup_fee_paise INTEGER NOT NULL DEFAULT 0;

-- Separate and guarded, because `ADD COLUMN IF NOT EXISTS` skips the WHOLE
-- clause on a replay — including a CHECK written inline, which would then never
-- be created on a database where somebody added the column by hand first.
-- (This is the trap 109 documents at its line 106.)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'hub_skill_templates_setup_fee_non_negative'
           AND conrelid = 'staging.hub_skill_templates'::regclass
    ) THEN
        ALTER TABLE staging.hub_skill_templates
            ADD CONSTRAINT hub_skill_templates_setup_fee_non_negative
            CHECK (setup_fee_paise >= 0);
    END IF;
END $$;

-- What the skill needs in order to read or change anything. NULL, not '{}' —
-- see the header. `GET /v1/hub/skills/capabilities` answers AVAILABILITY
-- (available / unavailable_reason / writes / needs) and carries no module set
-- and no prose, so it cannot answer "what will this touch in my data".
ALTER TABLE staging.hub_skill_templates
    ADD COLUMN IF NOT EXISTS permissions JSONB;

COMMENT ON COLUMN staging.hub_skill_templates.setup_fee_paise IS
    'One-off setup charge in PAISE. 0 on every existing row and 0 by default: '
    'any other default would invent a charge for nineteen skills nobody has '
    'priced. Until this is populated the drawer must render 0 as "No setup fee" '
    'and not hide the row — a blank where a price belongs reads as free anyway, '
    'and this way it says so.';

COMMENT ON COLUMN staging.hub_skill_templates.permissions IS
    'What this skill reads and changes, for the drawer''s "What this needs" '
    'block. NULL means NOT STATED and must render as such; {} would mean '
    '"stated: needs nothing", which is a claim about nineteen skills nobody has '
    'audited. Shape: {"reads": ["graha.contacts"], "writes": ["prachar.sends"], '
    '"modules": ["graha"]}. Not CHECKed — a jsonb shape enforced in DDL becomes '
    'a migration every time the drawer gains a line.';

COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- RUN AFTER COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. The table and both columns exist.
--      SELECT to_regclass('staging.hub_skill_requests') AS tbl;
--      SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema='staging' AND table_name='hub_skill_templates'
--         AND column_name IN ('setup_fee_paise','permissions')
--       ORDER BY column_name;
--    Expect: permissions jsonb YES NULL; setup_fee_paise integer NO 0.

-- 2. NO SKILL GAINED A PRICE AND NO SKILL LOST ONE. All nineteen at zero, and
--    all nineteen "not stated". This is the check that says the apply was
--    inert for the catalogue, which is the claim in the header.
--      SELECT count(*) AS templates,
--             count(*) FILTER (WHERE setup_fee_paise = 0) AS free,
--             count(*) FILTER (WHERE permissions IS NULL) AS unstated
--        FROM staging.hub_skill_templates;
--    Expect 19 / 19 / 19 on this database.

-- 3. NOBODY REQUESTED ANYTHING. Zero.
--      SELECT count(*) FROM staging.hub_skill_requests;

-- 4. THE IDEMPOTENCY INDEX ACTUALLY REFUSES, and the second INSERT is a no-op
--    rather than an error when written the way the endpoint writes it.
--      BEGIN;
--        WITH t AS (SELECT id FROM staging.hub_skill_templates WHERE is_active LIMIT 1),
--             o AS (SELECT id FROM staging.organisations LIMIT 1)
--        INSERT INTO staging.hub_skill_requests (org_id, template_id, requested_by, note)
--          SELECT o.id, t.id, 'user_probe', 'first press' FROM o, t;
--        WITH t AS (SELECT id FROM staging.hub_skill_templates WHERE is_active LIMIT 1),
--             o AS (SELECT id FROM staging.organisations LIMIT 1)
--        INSERT INTO staging.hub_skill_requests (org_id, template_id, requested_by, note)
--          SELECT o.id, t.id, 'user_probe', 'second press' FROM o, t
--          ON CONFLICT DO NOTHING;
--        SELECT count(*), min(note) FROM staging.hub_skill_requests
--         WHERE requested_by='user_probe';
--        -- expect 1, 'first press' — the second press did not mint a lead and
--        -- did not overwrite the first note
--      ROLLBACK;

-- 5. A DECIDED REQUEST STOPS BLOCKING A NEW ONE. The partial index is `WHERE
--    status='open'` precisely so a declined request can be asked again later.
--      BEGIN;
--        WITH t AS (SELECT id FROM staging.hub_skill_templates WHERE is_active LIMIT 1),
--             o AS (SELECT id FROM staging.organisations LIMIT 1)
--        INSERT INTO staging.hub_skill_requests (org_id, template_id, requested_by)
--          SELECT o.id, t.id, 'user_probe' FROM o, t;
--        UPDATE staging.hub_skill_requests
--           SET status='declined', decided_at=NOW(), decided_by='user_aekam'
--         WHERE requested_by='user_probe';
--        WITH t AS (SELECT id FROM staging.hub_skill_templates WHERE is_active LIMIT 1),
--             o AS (SELECT id FROM staging.organisations LIMIT 1)
--        INSERT INTO staging.hub_skill_requests (org_id, template_id, requested_by)
--          SELECT o.id, t.id, 'user_probe' FROM o, t;   -- expect: succeeds
--        SELECT status, count(*) FROM staging.hub_skill_requests
--         WHERE requested_by='user_probe' GROUP BY 1;   -- expect open 1, declined 1
--      ROLLBACK;

-- 6. THE STATUS INVARIANTS REFUSE. Each errors.
--      BEGIN;
--        -- a 'granted' row nobody can date
--        WITH t AS (SELECT id FROM staging.hub_skill_templates LIMIT 1),
--             o AS (SELECT id FROM staging.organisations LIMIT 1)
--        INSERT INTO staging.hub_skill_requests (org_id, template_id, requested_by, status)
--          SELECT o.id, t.id, 'user_probe', 'granted' FROM o, t;
--        -- expect: violates hsr_open_is_exactly_undecided
--      ROLLBACK;

-- 7. The setup-fee CHECK refuses a negative.
--      BEGIN;
--        UPDATE staging.hub_skill_templates SET setup_fee_paise = -1
--         WHERE id = (SELECT id FROM staging.hub_skill_templates LIMIT 1);
--        -- expect: violates hub_skill_templates_setup_fee_non_negative
--      ROLLBACK;


-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   DROP TABLE IF EXISTS staging.hub_skill_requests;
--   ALTER TABLE staging.hub_skill_templates
--       DROP CONSTRAINT IF EXISTS hub_skill_templates_setup_fee_non_negative,
--       DROP COLUMN IF EXISTS setup_fee_paise,
--       DROP COLUMN IF EXISTS permissions;
--
-- Both ALTERs are safe while nothing reads the columns. Once the drawer reads
-- `permissions`, dropping it is a 42703 on a live screen.


-- ── WHAT THIS FILE DELIBERATELY DOES NOT DO ─────────────────────────────────
--
-- NO STATUS ENDPOINT AND NO SECOND FETCH. State is read back through the ONE
-- call that already drives the catalogue, as a sibling key. `useList` in
-- `pages/hub/_shared.jsx:224-227` unwraps only `.data` into `.items`, so adding
-- `skill_requests` beside `data` is byte-identical for both existing consumers.
--
-- NO NOTIFICATION VOCABULARY CHANGE HERE, but one is required in the SAME
-- COMMIT as the sender: `tests/test_email_senders.py:281` walks the AST of every
-- backend source file and FAILS on a literal `purpose="…"` that `_BUCKET` does
-- not map. `purpose="skill_request"` must be added to `_BUCKET` as
-- `"notifications"` or the suite goes red. With migration 110 unapplied every
-- path still returns FROM_EMAIL, so that mapping changes no address today.
--
-- NO `module` CLEANUP. Eleven of nineteen templates carry a `module`, and one
-- of the values is `kartavya` — which is NOT in `role_tiers.ALL_MODULES` and
-- NOT a key in `frontend/src/lib/moduleColors.js`, so `orgModuleColor` falls
-- through to `var(--on-surface-3)`. That is a real defect and it is a DATA
-- decision (what module is that skill actually in?), not a schema one. Fixing
-- it by UPDATE here would be guessing on the customer's behalf.
--
-- NO `icon` MIGRATION. All nineteen rows carry one of six legacy `GLYPHS` names
-- and none of the twelve `MK_SCENES` keys the new marketplace expects. The
-- renderer must fall back, not the database — a skill whose icon key is unknown
-- should render a neutral tile, and that is one line of JS rather than a
-- migration that hard-codes an art direction into a data column.
