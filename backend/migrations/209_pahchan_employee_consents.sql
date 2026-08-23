-- 209_pahchan_employee_consents.sql
-- Workstream H (proposal 80) — the one finding with live legal exposure.
--
-- Measured live 2026-08-23: staging.pahchan_notice_acknowledgements holds 3
-- rows, all employee_id NULL, all three by org_owner/org_admin accounts
-- (kevalvshah03+e2e-owner@gmail.com, aekaminc1+org@gmail.com,
-- kevalvshah03@gmail.com) — not one is an employee. That is not a query bug:
-- `_employee_for` joins on manav_employees.user_id, and at Unicode Group,
-- the one live org with enrolled faces, 25 of 27 employees have no login at
-- all (employee_user_link_is_the_missing_join — a separate, larger,
-- already-known gap). There is structurally no way for most employees to
-- "self-acknowledge" through an account they do not have.
--
-- So `pahchan_notice_acknowledgements` (account saw the notice UI) and this
-- new table (a specific employee's consent to biometric processing, by
-- whatever method it was actually obtained) answer different questions and
-- both stay. This one is keyed on the EMPLOYEE, not the account, because
-- the DPDP data principal is the employee whose face is stored — proposal
-- 80's own framing.
--
-- Risk: LOW. One new table, no existing table touched, 0 rows affected,
-- reversible with DROP TABLE (which would silently remove every recorded
-- opt-out — see the note in the router before ever considering that).

CREATE TABLE IF NOT EXISTS staging.pahchan_employee_consents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id    UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    notice_version TEXT NOT NULL,
    -- self_acknowledged: the employee's OWN login tapped the notice AND
    -- resolved to this employee_id (rare today, possible once more accounts
    -- are linked). paper / verbal_witnessed: an admin is recording that
    -- consent was obtained outside this system — legitimate under DPDP, and
    -- the honest answer for the 25 of 27 employees with no login.
    method         TEXT NOT NULL CHECK (method IN ('self_acknowledged', 'paper', 'verbal_witnessed')),
    -- FALSE is an opt-out, not a missing record. DPDP requires the choice be
    -- offered and be reversible-by-record — an employee who later consents
    -- gets a NEW row at the same notice_version is impossible under the
    -- unique constraint below by design: consent is amended, not doubled.
    consented      BOOLEAN NOT NULL,
    -- The admin who recorded this, or the employee's own user_id when
    -- method='self_acknowledged'. Never fabricated — a row with no plausible
    -- recorder is not written.
    recorded_by    TEXT NOT NULL,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note           TEXT,
    -- One live answer per employee per notice version. A re-consent (e.g.
    -- after opting out, then agreeing) is an UPDATE via ON CONFLICT, so the
    -- history is one row that changed, not two that disagree.
    UNIQUE (org_id, employee_id, notice_version)
);

CREATE INDEX IF NOT EXISTS idx_pahchan_employee_consents_employee
    ON staging.pahchan_employee_consents (employee_id);

COMMENT ON TABLE staging.pahchan_employee_consents IS
    'Per-EMPLOYEE consent for biometric attendance processing, distinct from '
    'pahchan_notice_acknowledgements (per-ACCOUNT notice display). consented=false '
    'is an opt-out and is enforced at enrollment — routers/pahchan.py refuses a '
    'reference-photo enrollment for an employee with the most recent notice '
    'version marked consented=false. See migrations/209 header for why this table '
    'exists rather than fixing employee_id on the older one.';

-- Verify: SELECT to_regclass('staging.pahchan_employee_consents'); -- expect non-NULL
-- Rollback: DROP TABLE IF EXISTS staging.pahchan_employee_consents;
--   -- WARNING: this discards every recorded opt-out. Do not run this to "fix"
--   -- an enrollment blocked by an opt-out; that block is the feature working.
