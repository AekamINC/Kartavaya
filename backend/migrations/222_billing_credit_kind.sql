-- 222_billing_credit_kind.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   CONSTRAINT staging.org_billing_lines_kind_check   DROP + re-ADD (adds 'credit')
--   CONSTRAINT staging.org_billing_lines_credit_ck    ADD (credit ⇒ one_off)
--
-- NO COLUMN IS ADDED, NO ROW IS WRITTEN, NO ROW IS READ BACK DIFFERENTLY. The
-- kind vocabulary gains a sixth word and nothing in the table says it yet: all
-- 8 live rows are platform/support/setup/ongoing/topup and validate unchanged
-- against a superset. Re-running is a no-op. Reversal is at the foot.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- A mid-cycle plan change is supposed to raise ONE debit and ONE credit that
-- net to the difference. It raises TWO DEBITS. `services/proration.py` computes
-- the credit for the unused days at the old rate correctly and then writes it
-- as `kind='setup'` with a POSITIVE amount, because `services/billing_lines.py`
-- refuses a negative one — `amount NUMERIC(12,2) CHECK (amount >= 0)`, and the
-- module argues, rightly, that "a charge to be reversed is a credit note, not a
-- negative line". So a downgrade from ₹8,000 to ₹3,000 mid-August bills the
-- client for BOTH halves instead of crediting the first.
--
-- The amount column is not the thing to change. A signed amount would make
-- every existing SUM in this product ambiguous — `SUM(amount)` over a table
-- that may hold negatives answers a different question from the one every
-- caller is asking, and 096 §2 chose the non-negative column deliberately.
-- What is missing is the WORD for the second kind of row, so this adds it:
-- the magnitude stays positive in the column, and `kind='credit'` is what makes
-- the readers subtract it. One place decides the sign — `_signed_amount` in
-- `services/billing_lines.py` — and the totals, the invoice preview and the
-- invoice builder all take it from there.
--
-- ── WHY CREDIT IS ONE-OFF, AS A CONSTRAINT ───────────────────────────────────
--
-- Same shape as `org_billing_lines_platform_ck` above it: a rule the money code
-- must obey, written where it cannot be forgotten. A `monthly` credit with
-- `period_end IS NULL` is a discount that runs for ever and reduces every
-- invoice from now to the end of the relationship — nobody types that on
-- purpose, and the proration path has no reason to. A discount that genuinely
-- recurs is a lower price on the plan, not a credit repeated for ever.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE on its own. Nothing writes `kind='credit'` until the backend that does
-- deploys; nothing already in the table changes meaning. After both land, ONE
-- new row appears per mid-cycle plan change that has an old rate to credit —
-- the row that was already being written, under its right name and sign.
--
-- ── DEPLOY ORDER — THIS FILE FIRST ───────────────────────────────────────────
--
-- The backend must not run ahead of this constraint. `create_line(kind='credit')`
-- against the old CHECK raises CheckViolationError, which reaches the operator
-- as a 500 on the plan-change route. Migration, then deploy. The reverse order
-- of the usual hazard (a router SELECTing a column that is not there yet) and
-- the same rule: the database goes first.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- ACCESS EXCLUSIVE on staging.org_billing_lines twice, each for the length of a
-- catalog update plus a validating scan of 8 rows — milliseconds. It blocks
-- reads and writes on that one table for that instant; the only writers are the
-- billing console and the top-up handler.

ALTER TABLE staging.org_billing_lines
    DROP CONSTRAINT IF EXISTS org_billing_lines_kind_check;

ALTER TABLE staging.org_billing_lines
    ADD CONSTRAINT org_billing_lines_kind_check
    CHECK (kind IN ('platform', 'support', 'setup', 'ongoing', 'topup', 'credit'));

-- GUARDED ON pg_constraint, not on a re-runnable ADD. There is no
-- `ADD CONSTRAINT IF NOT EXISTS`, and a second run of a bare ADD is a
-- DuplicateObject error that aborts the file.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'org_billing_lines_credit_ck'
           AND conrelid = 'staging.org_billing_lines'::regclass
    ) THEN
        ALTER TABLE staging.org_billing_lines
            ADD CONSTRAINT org_billing_lines_credit_ck
            CHECK (kind <> 'credit' OR cadence = 'one_off');
    END IF;
END
$$;

-- ── REVERSAL ─────────────────────────────────────────────────────────────────
--
--   DELETE FROM staging.org_billing_lines WHERE kind = 'credit';   -- if any
--   ALTER TABLE staging.org_billing_lines
--       DROP CONSTRAINT IF EXISTS org_billing_lines_credit_ck;
--   ALTER TABLE staging.org_billing_lines
--       DROP CONSTRAINT IF EXISTS org_billing_lines_kind_check;
--   ALTER TABLE staging.org_billing_lines
--       ADD CONSTRAINT org_billing_lines_kind_check
--       CHECK (kind IN ('platform', 'support', 'setup', 'ongoing', 'topup'));
--
-- The DELETE is listed first and is NOT optional: the old CHECK cannot be
-- restored while a credit row stands. Any such row is one this feature wrote,
-- and deleting it puts the money back the way the two-debit bug had it — say so
-- before running it, and prefer ending the line to deleting it if an invoice
-- has already quoted it (096 §4.3: lines are ended, never deleted).
