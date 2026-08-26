-- 221_professional_tax_month.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   ADD COLUMN staging.pay_professional_tax.month  × 1   (smallint, NULLABLE)
--   CONSTRAINT staging.pay_professional_tax_month_ck
--   COMMENT    on the new column
--
-- ONE NULLABLE COLUMN WITH NO DEFAULT AND NO BACKFILL. All nine live rows get
-- NULL, the resolution order below reads NULL as "every month", and every
-- payroll run computes the identical number it computed yesterday. Re-running
-- is a no-op. Reversal is at the foot of this file.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Professional tax is not a flat monthly figure everywhere. Maharashtra charges
-- a different amount in February from the other eleven months, and this table
-- has no way to say so: one row per (state, band), no month dimension. E2E Test
-- & Associates is entirely Maharashtra, so every February the run deducts the
-- eleven-month figure for all 51 payable employees.
--
-- THE DEEPER GAP, WHICH IS WHY THIS IS A COLUMN AND NOT A SPECIAL CASE IN CODE.
-- Nothing in this product can write to `pay_professional_tax` at all — every
-- reference in `backend/` is a read (`routers/vetana.py::_pt_slabs`,
-- `services/skills/data/payroll_statutory.py`). The nine rows exist because a
-- migration put them there. So a state we have not seeded, a rate change, or a
-- February variant can only be fixed by shipping another migration.
--
-- A hardcoded "Maharashtra in February" branch would need a sibling for every
-- other state variant, and this repo's own history says where that ends: the
-- flat 200 that Phase 2.2 removed, and the AI chain that is still a function
-- rather than the priority column it is supposed to read. So the shape of the
-- answer is DATA the owner can set, not a rule we compile in.
--
-- ── IT MUST NEVER BLOCK, WHICH IS THE WHOLE DESIGN ───────────────────────────
--
-- Owner's rule, 2026-08-26: like GSTIN, PAN and TAN, this is optional and must
-- block nothing. So the column is nullable, means "every month" when unset, and
-- resolves by falling back — never by refusing:
--
--     org + this month  →  org + every month
--                       →  shared + this month  →  shared + every month  →  0
--
-- Most specific wins; each step degrades to the next; the last step is the
-- owner's existing 0 decision. Nothing a person fails to configure can stop a
-- payroll run, and an organisation that sets nothing keeps exactly the ladder
-- it has today.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE until somebody inserts a month-specific row. `_pt_slabs` gains a month
-- predicate and an ORDER BY that prefers a month match, and with only NULL-month
-- rows present that ordering is a no-op over the same nine rows. No existing
-- payslip changes, no recomputation is triggered, and nothing is emailed.
--
-- The number itself is NOT seeded here. What Maharashtra actually charges in
-- February is an owner fact — `staging.statute_calendar` holds zero
-- professional-tax rows to check it against — and writing a figure into 51
-- people's deductions on an assumption is the failure mode this file exists to
-- end. Phase 0.24 owns the data; this ships the mechanism it needs.

ALTER TABLE staging.pay_professional_tax
    ADD COLUMN IF NOT EXISTS month smallint;

-- SEPARATELY, AND DELIBERATELY NOT INLINE ON THE ADD COLUMN. An inline CHECK on
-- `ADD COLUMN IF NOT EXISTS` is skipped WHOLE when the column already exists, so
-- a re-run would silently leave the table unconstrained. Guarded on
-- pg_constraint, which is also the only place worth verifying it afterwards.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'pay_professional_tax_month_ck'
           AND conrelid = 'staging.pay_professional_tax'::regclass
    ) THEN
        ALTER TABLE staging.pay_professional_tax
            ADD CONSTRAINT pay_professional_tax_month_ck
            CHECK (month IS NULL OR (month >= 1 AND month <= 12));
    END IF;
END
$$;

COMMENT ON COLUMN staging.pay_professional_tax.month IS
    'Calendar month 1-12 this band applies to. NULL means every month, which is '
    'what all nine seeded rows are. A month-specific row overrides the '
    'every-month row for the same state and band; nothing is required, and an '
    'unset month never blocks a payroll run.';

-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.pay_professional_tax
--       DROP CONSTRAINT IF EXISTS pay_professional_tax_month_ck;
--   ALTER TABLE staging.pay_professional_tax DROP COLUMN IF EXISTS month;
--
-- Restores exactly, because nothing is backfilled: the column is NULL on every
-- row this migration touches.
