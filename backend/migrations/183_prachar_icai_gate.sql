-- 183_prachar_icai_gate.sql
--
-- THE EVIDENCE A CA FIRM NEEDS AND THIS PRODUCT HAS NEVER HELD.
--
-- Clause (6), Part I, First Schedule to the Chartered Accountants Act 1949 makes
-- it professional misconduct for a member in practice to solicit clients or
-- professional work "by circular, advertisement, personal communication or
-- interview or by any other means", and the Code of Ethics in force from
-- 1 April 2026 names EMAIL among those means. The exposure is the MEMBER'S.
-- Aekam Inc is not an ICAI member; the partner who presses Send is.
--
-- The enforcement lives in `backend/services/prachar_compliance.py` and
-- `backend/routers/prachar.py` and needs NONE of this file to work -- the gate
-- reads `staging.graha_contacts.client_id`, which migration 031 added and
-- indexed. What this file adds is the RECORD: the dated rules, the log of every
-- override somebody authorised, and one row per recipient proving what the firm
-- knew about that person at the moment the message went out.
--
-- THERE IS ONLY ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO. Applying
-- this file is a production change. Apply by hand:
--     psql "$DATABASE_URL" -f backend/migrations/183_prachar_icai_gate.sql
-- Nothing here is applied automatically and no application code applies it.
--
-- NOT APPLIED AS OF 21 August 2026. Measured against the live catalogue:
-- to_regclass('staging.prachar_compliance_rules') -> NULL,
-- to_regclass('staging.prachar_icai_overrides')   -> NULL,
-- to_regclass('staging.prachar_send_evidence')    -> NULL, and neither
-- staging.prachar_templates nor staging.prachar_campaigns has a
-- `compliance_class` column.
--
-- == WHAT IT TOUCHES ========================================================
--
--   CREATES  staging.prachar_compliance_rules      (new table, then 6 seed rows)
--   CREATES  staging.prachar_icai_overrides        (new table, 0 rows)
--   CREATES  staging.prachar_send_evidence         (new table, 0 rows)
--   CREATES  uq_prachar_send_evidence_recipient    (unique index)
--   CREATES  idx_prachar_send_evidence_campaign    (index)
--   CREATES  idx_prachar_send_evidence_client      (partial index, client rows)
--   CREATES  idx_prachar_send_evidence_non_client  (partial index, THE audit query)
--   CREATES  idx_prachar_icai_overrides_org        (index)
--   ADDS     staging.prachar_templates.compliance_class   (TEXT NULL)
--   ADDS     staging.prachar_campaigns.compliance_class   (TEXT NULL)
--   BACKFILLS both new columns from `category` where the mapping is unambiguous
--   READS    staging.organisations, staging.prachar_campaigns  (FK targets)
--
--   DROPS nothing. DELETES nothing. No existing column changes type, default or
--   nullability. The only existing rows written are the two new columns on
--   templates and campaigns, and only where they are currently NULL.
--
-- == WRITE-PATH SIDE EFFECTS, STATED BEFORE YOU RUN IT =======================
--
--   1. THE BACKFILL WRITES TO 60 TEMPLATE ROWS AND UP TO 104 CAMPAIGN ROWS ON
--      PRODUCTION. It sets a new column that nothing has ever read, from
--      `category`, which nothing has ever written a decision from. It cannot
--      change what any existing campaign sends TO -- the audience gate reads
--      `client_id`, not this column. What it CAN change is whether a send to a
--      non-client audience is refusable-with-override (classified) or refusable
--      outright (unclassified). Backfilling therefore makes the product SOFTER,
--      not harder, on those rows, which is why it is safe to run before anyone
--      has looked at the mapping.
--
--   2. Templates whose category is 'general' (3 live rows) are DELIBERATELY NOT
--      backfilled. 'general' says nothing about what the mail is, and inventing
--      a permitted class for it would invent a basis. They stay unclassified.
--
--   3. Campaigns with no template (80 of 104 live rows) are NOT backfilled --
--      there is nothing to derive a class from. They stay unclassified, which
--      means: still sendable to an all-client audience, refused with no override
--      to any audience containing a non-client. That refusal is the intended
--      behaviour and not a regression.
--
--   4. NOTHING HERE SENDS ANYTHING. No trigger, no queue, no NOTIFY.
--
-- == IF IT RUNS TWICE =======================================================
--
-- Nothing happens the second time. Every CREATE is IF NOT EXISTS; every ALTER is
-- ADD COLUMN IF NOT EXISTS; the seed carries ON CONFLICT (rule_key) DO NOTHING;
-- and both backfills are `WHERE compliance_class IS NULL`, so a hand correction
-- made after the first run is never overwritten by a replay.
--
-- DO NOTHING and not DO UPDATE on the rule seed, deliberately, and for the same
-- reason migration 162 gives: if the Ethical Standards Board moves a position
-- and somebody has already corrected a row by hand, a replay of this file must
-- not silently restore tonight's understanding of the Code over the correction.
-- A changed position is a NEW rule_key with its own effective_from, never an
-- edit of an old one -- evidence rows already point at the old one.
--
-- == HOW TO UNDO IT =========================================================
--
--     DROP TABLE IF EXISTS staging.prachar_send_evidence;    -- FK child first
--     DROP TABLE IF EXISTS staging.prachar_icai_overrides;
--     DROP TABLE IF EXISTS staging.prachar_compliance_rules;
--     ALTER TABLE staging.prachar_templates DROP COLUMN IF EXISTS compliance_class;
--     ALTER TABLE staging.prachar_campaigns DROP COLUMN IF EXISTS compliance_class;
--
-- In that order; reversed, the first drop fails on the dependency. Dropping the
-- two columns discards the backfill, which is re-derivable from `category` by
-- re-running this file. Dropping the evidence table is NOT reversible and
-- destroys the only proof of client linkage the firm has for past sends.
--
-- ===========================================================================

BEGIN;

-- ── 1. The dated rules ──────────────────────────────────────────────────────
--
-- WHY A TABLE AND NOT A PYTHON DICT. Two reasons. A rule with a date on it
-- belongs where the date can be queried -- "which rule was in force when this
-- was sent" is a join, not a code read. And `basis` has to be readable by
-- somebody who is not reading Python: the difference between a rule the Code
-- states and a rule we reasoned is the single most important fact in this
-- programme, and it must survive the code being rewritten.
--
-- `services/statute.py` is NOT used for any of this. That module is tax statute
-- -- GST, TDS, advance tax -- and the Institute's Code of Ethics is not tax
-- statute. Mixing them would put a professional-conduct rule behind an `as_of`
-- meant for filing due dates.

CREATE TABLE IF NOT EXISTS staging.prachar_compliance_rules (
    rule_key        TEXT PRIMARY KEY,
    regime          TEXT NOT NULL,
    citation        TEXT NOT NULL,
    statement       TEXT NOT NULL,
    -- 'sourced'  = the Code, the Schedule or the Act says this.
    -- 'inferred' = we reasoned it from something sourced; no clause names it.
    basis           TEXT NOT NULL
                    CHECK (basis IN ('sourced', 'inferred')),
    effective_from  DATE NOT NULL,
    effective_to    DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staging.prachar_compliance_rules IS
    'Dated advertising-conduct rules the Prachar send path relies on. basis '
    'distinguishes what the Code states from what Kartavaya reasoned.';

INSERT INTO staging.prachar_compliance_rules
    (rule_key, regime, citation, statement, basis, effective_from, notes)
VALUES
    ('icai.clause6.solicitation', 'ICAI',
     'Clause (6), Part I, First Schedule, Chartered Accountants Act 1949 — Code of Ethics in force 1 April 2026',
     'A member in practice may not solicit clients or professional work directly or indirectly by circular, advertisement, personal communication or interview or by any other means. The Code in force from 1 April 2026 names email among those means.',
     'sourced', DATE '2026-04-01',
     'The 2026 relaxation of the advertising rules is PULL-SIDE — websites, social pages, listings a prospect chooses to visit. The push-side prohibition, which is what email is, was not relaxed.'),

    ('icai.clause6.existing_client', 'ICAI',
     'Clause (6), Part I, First Schedule, Chartered Accountants Act 1949 — Code of Ethics in force 1 April 2026',
     'Correspondence with a person for whom the member already acts is not solicitation of a client or of professional work, and is permitted by email.',
     'sourced', DATE '2026-04-01',
     'This is the rule the whole audience gate implements: the prohibited act is aimed at someone who is not yet a client.'),

    ('icai.clause6.greetings_and_invitations', 'ICAI',
     'Council guidance under Clause (6), Part I, First Schedule, Chartered Accountants Act 1949',
     'Greeting cards and invitations may be sent to clients, relatives, friends and other members. They may not be sent to persons outside that group.',
     'sourced', DATE '2026-04-01',
     'The permission is expressly bounded by the group. This product can only prove one member of that group — the client — so the gate is clients only.'),

    ('icai.inferred.statutory_reminder', 'ICAI',
     'Reasoned from icai.clause6.existing_client — NOT stated in the Code',
     'A statutory deadline reminder sent to an existing client is correspondence about an engagement that already exists, and is treated here as permitted.',
     'inferred', DATE '2026-04-01',
     'INFERENCE. No clause names deadline reminders either way. If the Ethical Standards Board is ever asked about this product, this is one of the two rows it will be asked about.'),

    ('icai.inferred.knowledge_update', 'ICAI',
     'Reasoned from icai.clause6.existing_client — NOT stated in the Code',
     'A technical or knowledge update sent to an existing client is treated here as client service rather than as advertisement.',
     'inferred', DATE '2026-04-01',
     'INFERENCE, and the weakest one in this programme. The same words to a prospect are a circular. The save-time linter exists mainly for this class.'),

    ('dpdp.2023.consent_record', 'DPDP',
     'Digital Personal Data Protection Act 2023, s.5 and s.6, with the Rules made thereunder',
     'A Data Fiduciary must be able to show the notice given and the consent obtained for the personal data it processes.',
     'sourced', DATE '2027-05-13',
     'NOT YET IMPLEMENTED. staging.prachar_send_evidence.consent_basis records what this product can honestly say today — client engagement, ICAI override, or not recorded. It does NOT claim a consent, because nothing in this product has ever captured one. The notice version and consent timestamp this obligation will need have no column yet, on purpose: a column nothing writes is worse than no column.')
ON CONFLICT (rule_key) DO NOTHING;


-- ── 2. The override log ─────────────────────────────────────────────────────
--
-- A WARNING IS A CLICK. A LOGGED OVERRIDE IS A DECISION SOMEBODY OWNS. This
-- table is the difference between the two, and it is why the send path blocks
-- with a 403 rather than showing a banner.
--
-- The counts are stored, not derivable. "12 of 47 recipients are not clients"
-- is the fact the partner was looking at when they decided; re-deriving it in
-- 2028 from a CRM that has since re-linked contacts would produce a different
-- number and quietly misrepresent what was authorised.

CREATE TABLE IF NOT EXISTS staging.prachar_icai_overrides (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES staging.organisations(id),
    campaign_id       UUID NOT NULL REFERENCES staging.prachar_campaigns(id),
    -- TEXT, matching prachar_campaigns.created_by. Every actor column in this
    -- module is TEXT; a UUID here would be the odd one out and would need a
    -- cast at every join.
    decided_by        TEXT NOT NULL,
    decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- The floor is duplicated from
    -- services/prachar_compliance.MIN_OVERRIDE_BASIS_CHARS on purpose: a thin
    -- basis is refused by the API and again by the database, so a future caller
    -- that forgets the check cannot write "ok" into an audit trail.
    basis             TEXT NOT NULL
                      CHECK (length(btrim(basis)) >= 24),
    non_client_count  INTEGER NOT NULL CHECK (non_client_count >= 0),
    total_count       INTEGER NOT NULL CHECK (total_count >= 0),
    template_class    TEXT,
    class_basis       TEXT NOT NULL DEFAULT 'unclassified',
    rule_key          TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staging.prachar_icai_overrides IS
    'Every time a member authorised marketing email to a non-client: who, when, '
    'and the written basis. One row per send, not per recipient.';

CREATE INDEX IF NOT EXISTS idx_prachar_icai_overrides_org
    ON staging.prachar_icai_overrides (org_id, decided_at DESC);


-- ── 3. The evidence trail ───────────────────────────────────────────────────
--
-- ONE ROW PER RECIPIENT, WRITTEN BEFORE DISPATCH. The question this table
-- exists to answer is asked years later: "show me that the person you emailed
-- on 4 March 2026 was a client of the firm." `graha_contacts` cannot answer it
-- — the contact may have been merged, re-linked, or deleted since. Only a
-- snapshot can.
--
-- WHY contact_id AND client_id CARRY NO FOREIGN KEY. They are snapshots, and a
-- snapshot with an FK is not a snapshot: `ON DELETE SET NULL` would erase the
-- evidence exactly when the underlying record went away, which is precisely the
-- case the evidence is for. `org_id` and `campaign_id` DO carry FKs because
-- those must be real for the row to mean anything at all.
--
-- `was_client` is stored as well as `client_id` and is not redundant. If a
-- client record is ever hard-deleted the id becomes a dangling uuid, but the
-- boolean still says what the firm knew at the time.

CREATE TABLE IF NOT EXISTS staging.prachar_send_evidence (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES staging.organisations(id),
    campaign_id      UUID NOT NULL REFERENCES staging.prachar_campaigns(id),
    contact_id       UUID,
    recipient_email  TEXT NOT NULL,
    client_id        UUID,
    was_client       BOOLEAN NOT NULL,
    template_id      UUID,
    template_class   TEXT,
    -- 'sourced' | 'inferred' | 'unclassified'. Stored on the ROW and not looked
    -- up through rule_key, because the classification of a rule can change and
    -- this row must keep saying what was relied on at the time.
    class_basis      TEXT NOT NULL DEFAULT 'unclassified',
    rule_key         TEXT NOT NULL,
    -- THE DPDP HALF, IN THE SAME TABLE. Three honest values and no fourth:
    --   'client_engagement' the recipient is linked to a client of the practice
    --   'icai_override'     not a client; mailed under the override in
    --                       prachar_icai_overrides, which IS the record
    --   'not_recorded'      neither, and it says so
    -- There is no 'consented' and no boolean. Nothing in this product has ever
    -- captured a DPDP consent, and a column reading true because a seed wrote it
    -- is worse than no column at all.
    consent_basis    TEXT NOT NULL
                     CHECK (consent_basis IN
                            ('client_engagement', 'icai_override', 'not_recorded')),
    override_id      UUID REFERENCES staging.prachar_icai_overrides(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staging.prachar_send_evidence IS
    'Per-recipient proof of client linkage and template class at the moment a '
    'marketing email was addressed. Also the DPDP consent-basis record.';

-- The idempotency key the send path relies on: `ON CONFLICT (campaign_id,
-- recipient_email) DO NOTHING` mirrors what prachar_campaign_contacts already
-- does, so a retried send does not double the evidence.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prachar_send_evidence_recipient
    ON staging.prachar_send_evidence (campaign_id, recipient_email);

CREATE INDEX IF NOT EXISTS idx_prachar_send_evidence_campaign
    ON staging.prachar_send_evidence (campaign_id);

CREATE INDEX IF NOT EXISTS idx_prachar_send_evidence_client
    ON staging.prachar_send_evidence (org_id, client_id)
    WHERE client_id IS NOT NULL;

-- THE AUDIT QUERY. "Show me every marketing email this firm has sent to
-- somebody who was not a client." Partial, because the answer should normally
-- be the empty set and an index over an empty set costs nothing.
CREATE INDEX IF NOT EXISTS idx_prachar_send_evidence_non_client
    ON staging.prachar_send_evidence (org_id, created_at DESC)
    WHERE was_client = FALSE;


-- ── 4. The class column, on both tables that can carry one ──────────────────
--
-- NO INLINE CHECK CONSTRAINT, AND THIS IS NOT AN OVERSIGHT. `ADD COLUMN IF NOT
-- EXISTS ... CHECK (...)` skips the WHOLE clause when the column already
-- exists, so a replay against a database where the column was added by hand
-- would silently leave the constraint off while appearing to succeed. The
-- constraint is therefore added separately below, guarded on pg_constraint.

ALTER TABLE staging.prachar_templates
    ADD COLUMN IF NOT EXISTS compliance_class TEXT;

ALTER TABLE staging.prachar_campaigns
    ADD COLUMN IF NOT EXISTS compliance_class TEXT;

-- `conrelid` as well as `conname` in both guards. A constraint name is unique
-- per TABLE in Postgres, not per database, so a name-only lookup can be
-- satisfied by an identically named constraint on some other table and skip the
-- ALTER that matters. Naming the relation makes the guard mean what it reads as.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_prachar_templates_compliance_class'
          AND conrelid = 'staging.prachar_templates'::regclass
    ) THEN
        ALTER TABLE staging.prachar_templates
            ADD CONSTRAINT ck_prachar_templates_compliance_class
            CHECK (compliance_class IS NULL OR compliance_class IN (
                'client_service', 'greeting', 'invitation',
                'statutory_reminder', 'knowledge_update', 'prospect_outreach'
            ));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_prachar_campaigns_compliance_class'
          AND conrelid = 'staging.prachar_campaigns'::regclass
    ) THEN
        ALTER TABLE staging.prachar_campaigns
            ADD CONSTRAINT ck_prachar_campaigns_compliance_class
            CHECK (compliance_class IS NULL OR compliance_class IN (
                'client_service', 'greeting', 'invitation',
                'statutory_reminder', 'knowledge_update', 'prospect_outreach'
            ));
    END IF;
END $$;


-- ── 5. The backfill ─────────────────────────────────────────────────────────
--
-- Categories measured on the live database, 21 August 2026: alert 10,
-- collections 1, event 1, general 3, greeting 10, invite 10, newsletter 12,
-- onboarding 1, operations 1, reminder 11. Every one of them is mapped below
-- except 'general', which is left NULL on purpose.
--
-- 'promotional' and 'transactional' appear in the frontend's category list and
-- in NO ROW of the live table. They are mapped anyway, because a dropdown that
-- offers a value will eventually produce one.
--
-- `WHERE compliance_class IS NULL` so a replay never overwrites a hand
-- correction. This is the only statement in the file that writes to a row that
-- already existed.

UPDATE staging.prachar_templates SET compliance_class = CASE lower(btrim(category))
        WHEN 'alert'         THEN 'client_service'
        WHEN 'collections'   THEN 'client_service'
        WHEN 'onboarding'    THEN 'client_service'
        WHEN 'operations'    THEN 'client_service'
        WHEN 'transactional' THEN 'client_service'
        WHEN 'event'         THEN 'invitation'
        WHEN 'invite'        THEN 'invitation'
        WHEN 'greeting'      THEN 'greeting'
        WHEN 'reminder'      THEN 'statutory_reminder'
        WHEN 'newsletter'    THEN 'knowledge_update'
        WHEN 'promotional'   THEN 'prospect_outreach'
    END
WHERE compliance_class IS NULL
  AND lower(btrim(coalesce(category, ''))) IN (
        'alert', 'collections', 'onboarding', 'operations', 'transactional',
        'event', 'invite', 'greeting', 'reminder', 'newsletter', 'promotional');

-- Campaigns inherit from the template they use, and only from one that has a
-- class. A campaign with no template stays NULL — there is nothing to derive
-- from, and guessing would be inventing a basis for 80 rows.
UPDATE staging.prachar_campaigns c
SET compliance_class = t.compliance_class
FROM staging.prachar_templates t
WHERE t.id = c.template_id
  AND c.compliance_class IS NULL
  AND t.compliance_class IS NOT NULL;

COMMIT;

-- == VERIFY AFTER APPLYING ==================================================
--
--   SELECT rule_key, basis, effective_from FROM staging.prachar_compliance_rules
--    ORDER BY effective_from, rule_key;                       -- expect 6 rows
--
--   SELECT compliance_class, count(*) FROM staging.prachar_templates
--    WHERE is_active GROUP BY 1 ORDER BY 2 DESC;   -- expect 3 rows still NULL
--
--   SELECT count(*) FROM staging.prachar_campaigns
--    WHERE is_active AND compliance_class IS NULL;  -- expect ~80 (no template)
--
--   SELECT count(*) FROM staging.prachar_send_evidence;       -- expect 0
--   SELECT count(*) FROM staging.prachar_icai_overrides;      -- expect 0
--
-- The two zeros are the point: this migration records nothing about the past.
-- 122 recipient rows already exist in staging.prachar_campaign_contacts, 34 of
-- them against contacts with no client_id, and no evidence row will ever be
-- written for them. That history is not reconstructible and must not be
-- back-filled with a guess.
