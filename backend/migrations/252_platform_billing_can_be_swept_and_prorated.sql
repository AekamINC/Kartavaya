-- 252 — upstream billing: sweepable lines, a pro-rata floor, and the owner's exemption
--
-- ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
--
-- The owner's requirement, verbatim: "Aekam their is not charge as they are
-- owner of kartavaya. Rest org > can be defined by aekam what will billing
-- period and charge and also it needs flexibility to change in midterm or
-- around monthly. also pro-rata way as well."
--
-- Three of those four already work. `org_billing_lines` carries the amount, the
-- cadence, the period and the direction, and `services/billing_lines.py` is its
-- single writer with an append-only discipline. What is missing is the pair of
-- columns that let a line be SWEPT into an actual invoice, which
-- `client_service_lines` has had since migration 223 and this table never got.
--
-- Measured live 2026-09-01, so the change is against a known state:
--
--     org                  lines  amount    cadence  period_start  period_end
--     Demo - Kartavaya       1    10000.00  monthly  2026-09-01    NULL (open)
--     E2E Test & Associates  1    12000.00  monthly  2026-09-01    NULL (open)
--     UK AekamINC            1    20000.00  monthly  2026-09-01    NULL (open)
--     Unicode Group          1    12000.00  monthly  2026-09-01    NULL (open)
--     Aekam Inc              0       —         —         —            —
--
-- A NULL `period_end` is an OPEN line here, not a missing value — the column is
-- the last period billed, and ending a line is what sets it. Worth stating
-- because a first pass at this read `period_start IS NULL OR period_end IS NULL`
-- and concluded every line in the product was broken. They are all fine.
--
-- ── THE OWNER'S EXEMPTION BECOMES A RULE ────────────────────────────────────
--
-- Aekam Inc has zero billing lines, which is correct and is currently true only
-- because nobody has added one. "The owner is not charged" is a rule of the
-- business, and it is enforced here so that it survives a well-meaning admin, a
-- seeding script, and a future sweep that adds lines automatically.
--
-- A trigger and not a CHECK: the fact lives in `organisations.is_platform_org`,
-- and a CHECK cannot read another table. Keyed on that column rather than on
-- Aekam's uuid so that it stays correct if the platform org is ever re-created.

BEGIN;

-- ── The two columns `client_service_lines` has had since 223 ────────────────

ALTER TABLE public.org_billing_lines
  ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_billing_lines.auto_invoice IS
  'Whether the platform sweep may raise an invoice for this line. Defaults '
  'FALSE so this migration changes the behaviour of nothing that already '
  'exists: the four live lines keep being what they were, a record of what an '
  'org is charged, until somebody turns each one on deliberately.';

ALTER TABLE public.org_billing_lines
  ADD COLUMN IF NOT EXISTS invoice_from date;

COMMENT ON COLUMN public.org_billing_lines.invoice_from IS
  'The earliest period the sweep may raise, a FLOOR and not a start date. '
  '`period_start` keeps saying when the arrangement began — it is the '
  'contract term and the screen shows it — while this says how far back '
  'automation may reach. A line that ran for four months before anybody armed '
  'a cron needs both facts, and rewriting period_start to start the clock '
  'would leave the true one nowhere. Same semantics as '
  'client_service_lines.invoice_from (migration 223).';

-- ── The owner is not billed, and it is no longer a convention ───────────────

CREATE OR REPLACE FUNCTION public.refuse_billing_line_for_platform_org()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (the default, stated because getting this wrong is how two
-- views became a cross-tenant hole on 2026-08-29). This reads one row of
-- `organisations` by primary key and needs no privilege the caller lacks.
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organisations o
     WHERE o.id = NEW.org_id AND o.is_platform_org
  ) THEN
    RAISE EXCEPTION
      'Kartavaya''s own organisation is not billed for the platform it owns.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_billing_line_for_platform_org
  ON public.org_billing_lines;

CREATE TRIGGER trg_no_billing_line_for_platform_org
  BEFORE INSERT OR UPDATE OF org_id, amount ON public.org_billing_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_billing_line_for_platform_org();

-- ⚠ `UPDATE OF org_id, amount` and not a bare UPDATE. The append-only
-- discipline in services/billing_lines.py ENDS a line by setting `period_end`,
-- and that is a legitimate write this rule must not block — including on a row
-- that predates the rule. Moving a line to the platform org, or repricing one,
-- are the two writes that would actually charge the owner, and those are what
-- the trigger watches.

COMMIT;
