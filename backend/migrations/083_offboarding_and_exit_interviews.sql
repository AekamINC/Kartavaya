-- 083 · Employee offboarding and exit interviews
--
-- Owner's request, 2026-07-29: "introduce employee offboarding and exit
-- interview in recruitment as well."
--
-- ── What existed before ───────────────────────────────────────────────────
--
-- Nothing. `DELETE /v1/manav/employees/{id}` set `is_active=FALSE,
-- status='terminated'` and that was the whole of offboarding. Searched for
-- settlement / fnf / final_settlement across the codebase: no hits.
--
-- The consequence was not only a missing record. `process_payroll` selects
-- salary structures joined on `e.is_active=TRUE`, so the moment someone is
-- offboarded they drop out of payroll entirely — and an outstanding salary
-- advance was therefore **never recovered**. The money simply stayed lent.
--
-- ── Conventions ──────────────────────────────────────────────────────────
--
-- Matched to `manav_leave_requests`: uuid PK defaulting to gen_random_uuid(),
-- uuid org_id and employee_id, text status with a default, timestamptz
-- created_at/updated_at defaulting to now(). Actor columns are text because
-- `users.user_id` is text throughout this schema.
--
-- No foreign keys to `manav_employees`, matching the rest of the module — the
-- org_id + employee_id pair is how every other table here scopes, and adding
-- FKs on only these two would be inconsistent without being safer.

CREATE TABLE IF NOT EXISTS staging.manav_offboarding (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL,
    employee_id         uuid NOT NULL,

    -- Why they are leaving. Drives whether notice applies and whether the exit
    -- is voluntary, which is the split every attrition report needs.
    exit_type           text NOT NULL DEFAULT 'resignation',
    reason              text,

    -- Dates. `resignation_date` is when they told you; `last_working_day` is
    -- when they stop. Notice is the gap, and is recorded rather than computed
    -- because waivers and buyouts are common and the actual figure is what
    -- payroll and the relieving letter need.
    resignation_date    date,
    last_working_day    date,
    notice_period_days  integer NOT NULL DEFAULT 0,
    notice_waived       boolean NOT NULL DEFAULT FALSE,

    -- Clearance. A jsonb list of {item, owner, done, done_at, note} so a firm
    -- can name its own steps — laptop, ID card, client handover, library books
    -- — without a migration per checklist item.
    clearance           jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Settlement. `settlement_payslip_id` points at the final payslip once the
    -- run is processed, so the figures are never restated here.
    settlement_amount   numeric(14,2),
    settlement_payslip_id uuid,
    settled_at          timestamptz,

    -- Would you take them back. The single most-asked question when an old
    -- employee reapplies, and the one nobody writes down.
    rehire_eligible     boolean,

    status              text NOT NULL DEFAULT 'initiated',
    notes               text,
    initiated_by        text,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),

    CONSTRAINT manav_offboarding_exit_type_ck CHECK (exit_type IN (
        'resignation', 'termination', 'retirement', 'end_of_contract',
        'abandonment', 'redundancy', 'death'
    )),
    CONSTRAINT manav_offboarding_status_ck CHECK (status IN (
        'initiated', 'in_clearance', 'interview_done', 'settled', 'completed',
        'cancelled'
    )),
    -- Dates must run forwards. A last working day before the resignation is a
    -- typo every time, and it silently corrupts notice-period reporting.
    CONSTRAINT manav_offboarding_dates_ck CHECK (
        resignation_date IS NULL OR last_working_day IS NULL
        OR last_working_day >= resignation_date
    )
);

-- One live offboarding per employee. A second one is either a duplicate or a
-- rehire that has not been modelled, and both should fail loudly rather than
-- leave two exits fighting over one final settlement. Cancelled rows are
-- excluded so a mistaken exit can be cancelled and redone.
CREATE UNIQUE INDEX IF NOT EXISTS manav_offboarding_one_live_per_employee
    ON staging.manav_offboarding (org_id, employee_id)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_manav_offboarding_org     ON staging.manav_offboarding (org_id);
CREATE INDEX IF NOT EXISTS idx_manav_offboarding_status  ON staging.manav_offboarding (org_id, status);
CREATE INDEX IF NOT EXISTS idx_manav_offboarding_lwd     ON staging.manav_offboarding (org_id, last_working_day);


CREATE TABLE IF NOT EXISTS staging.manav_exit_interviews (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL,
    employee_id         uuid NOT NULL,
    offboarding_id      uuid,

    conducted_by        text,
    conducted_at        timestamptz,

    -- The structured part, kept small deliberately: these four are what an
    -- attrition report is actually built from, and a free-text-only interview
    -- cannot be counted.
    primary_reason      text,
    overall_rating      integer,
    would_recommend     boolean,
    would_return        boolean,

    -- Everything else. `responses` is [{question, answer}] so a firm can change
    -- its question set whenever it likes without a migration, and the answers
    -- stay attached to the question actually asked rather than to a column
    -- whose meaning drifted.
    responses           jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes               text,

    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),

    CONSTRAINT manav_exit_interviews_rating_ck CHECK (
        overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5
    ),
    CONSTRAINT manav_exit_interviews_reason_ck CHECK (primary_reason IS NULL OR primary_reason IN (
        'compensation', 'career_growth', 'management', 'work_life_balance',
        'relocation', 'role_mismatch', 'culture', 'health', 'higher_studies',
        'better_offer', 'personal', 'other'
    ))
);

-- One interview per exit. A second is a correction, and corrections belong in
-- the row rather than beside it.
CREATE UNIQUE INDEX IF NOT EXISTS manav_exit_interviews_one_per_employee
    ON staging.manav_exit_interviews (org_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_manav_exit_interviews_org    ON staging.manav_exit_interviews (org_id);
CREATE INDEX IF NOT EXISTS idx_manav_exit_interviews_reason ON staging.manav_exit_interviews (org_id, primary_reason);

COMMENT ON TABLE staging.manav_offboarding IS
    'One row per employee exit: dates, notice, clearance checklist and final settlement.';
COMMENT ON TABLE staging.manav_exit_interviews IS
    'The exit interview for an offboarding. Structured fields drive attrition reporting; responses[] holds the firm''s own question set.';
