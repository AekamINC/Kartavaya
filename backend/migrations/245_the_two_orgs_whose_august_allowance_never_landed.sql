-- 245 — two orgs are entitled to a monthly allowance and hold zero.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  1. WHAT THIS DOES, AND WHY IT IS NEEDED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Read live 2026-08-31:
--
--   org                        monthly_credits   allowance_balance   period_start
--   Unicode Group                       1000                   0     2026-08-01
--   UK AekamINC                         2000                   0     2026-08-01
--   Demo - Kartavaya                    1000                1000     2026-08-01
--   E2E Test & Associates                  0                   0     2026-08-01
--   Aekam Inc                           2000                   0     2026-08-01
--
-- Two orgs are entitled to an allowance every month and have never received
-- one. Every Sahayak surface answers 402 for them — the assistant, the skills
-- drawer, content generation. `hub_org_credits.balance` is 0, so there is
-- nothing to spend and no way for a customer to get any.
--
-- ⚠ THE ROW IS NOT MISSING. IT IS STAMPED WITH THE WRONG PERIOD, WHICH IS
-- WORSE, because every later mechanism reads it as already settled.
-- `roll_period` grants only when the stored `period_start` is BEHIND
-- `current_period()`:
--
--     allowance_balance := organisations.monthly_credits   (SET, not +=)
--     period_start      := current_period()
--
-- These rows were created stamped at the CURRENT period with a zero allowance,
-- so the roll has nothing to do and never fires. August's grant is not late —
-- on the present code path it can never arrive, and September's roll will set
-- the allowance for September only. The August entitlement is simply lost.
--
-- This is the same defect `4bcd77db` fixed for NEW orgs, by binding
-- `previous_period(current_period())` in the bootstrap INSERT so the first
-- `balance_of` rolls. That fix cannot reach a row that already exists. These
-- two rows predate it and stay poisoned until something repairs them.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  2. WRITE-PATH SIDE EFFECTS — STATED BEFORE RUNNING
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ THIS IS A DATA CHANGE TO LIVE ROWS. Two of them. It is not DDL.
--
-- It does NOT write a balance. It sets `period_start` back one period on
-- exactly two rows, so that the PRODUCT'S OWN `roll_period` grants the
-- allowance on the next read, through the code path that already exists,
-- writing the ledger row it always writes.
--
-- That is deliberate and it is the whole design of this migration. Writing
-- `allowance_balance = 1000` here by hand would produce the same number with no
-- ledger entry, no `credits_reset_at`, and no agreement with the code that owns
-- the rule — which is how a wallet and its ledger come to disagree. The
-- product grants; this migration only makes it notice that it is due.
--
-- What a customer sees afterwards: Unicode Group 1000 credits, UK AekamINC
-- 2000, both on first access to any credit-reading surface.
--
-- ⚠ AEKAM INC IS EXCLUDED BY NAME even though it presents identically
-- (monthly_credits 2000, allowance 0). It is the platform org and it is
-- NO-TOUCH by standing instruction. It also already holds 1992 PURCHASED
-- credits, so it is not blocked on anything. If its allowance is wanted, that
-- is a separate decision taken by name.
--
-- ⚠ E2E Test & Associates IS EXCLUDED because its `monthly_credits` is 0, and
-- `credits.py` is explicit that this is meaningful: "the plan fallback is gone.
-- A deliberately negotiated 0 now means 0." Rolling it would grant 0 and
-- change nothing, but it would move a period stamp for no reason.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  3. BLAST RADIUS — MEASURED, NOT ESTIMATED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The WHERE clause admits a row only when ALL of these hold:
--
--     allowance_balance = 0          it has not been granted
--     purchased_balance = 0          nothing bought is at risk
--     monthly_credits   > 0          it is entitled to something
--     period_start      = current    the roll cannot fire on its own
--     is_platform_org   = false      never Aekam Inc
--
-- Asserted below to match EXACTLY 2 rows. If it matches any other number the
-- migration raises and rolls back, because a repair that silently touches a
-- third wallet is not a repair.
--
-- No DDL. No other table read or written. `hub_org_credit_transactions` is
-- untouched here — the ledger row is written later, by `roll_period`, which is
-- the point.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  4. REVERSAL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The pre-state is captured to `migration_245_before` FIRST, in the same
-- transaction, so the reversal is a copy-back and not a reconstruction:
--
--   UPDATE public.hub_org_credits c
--      SET period_start = b.period_start
--     FROM public.migration_245_before b
--    WHERE c.org_id = b.org_id;
--
-- ⚠ REVERSING AFTER THE ROLL HAS FIRED DOES NOT UNDO THE GRANT. Once a customer
-- reads their balance, `roll_period` has set the allowance and written a ledger
-- row. Putting `period_start` back would then make the org eligible to roll
-- AGAIN and be granted a second time. If this needs reversing, do it BEFORE any
-- credit-reading surface is touched, or reverse the ledger entry instead.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  5. VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Post-condition asserted in-transaction: exactly 2 rows now carry a
-- `period_start` behind `date_trunc('month', CURRENT_DATE)`, and both are the
-- ones named above. The GRANT itself is verified afterwards, live, by reading
-- the balance through the product and seeing 1000 and 2000 where there were 0.

BEGIN;

CREATE TABLE IF NOT EXISTS public.migration_245_before AS
SELECT c.org_id, o.name, c.period_start, c.allowance_balance, c.purchased_balance
FROM public.hub_org_credits c
JOIN public.organisations o ON o.id = c.org_id
WHERE FALSE;

INSERT INTO public.migration_245_before
SELECT c.org_id, o.name, c.period_start, c.allowance_balance, c.purchased_balance
FROM public.hub_org_credits c
JOIN public.organisations o ON o.id = c.org_id
WHERE c.allowance_balance = 0
  AND c.purchased_balance = 0
  AND o.monthly_credits > 0
  AND o.is_platform_org = FALSE
  AND c.period_start = date_trunc('month', CURRENT_DATE)::date;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM public.migration_245_before;
    IF n <> 2 THEN
        RAISE EXCEPTION
          'migration 245: expected exactly 2 poisoned wallets, found %. '
          'The estate has changed since this was measured — re-read the table '
          'in section 3 before running.', n;
    END IF;
END $$;

UPDATE public.hub_org_credits c
   SET period_start = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date
  FROM public.migration_245_before b
 WHERE c.org_id = b.org_id;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
    FROM public.hub_org_credits c
    JOIN public.migration_245_before b ON b.org_id = c.org_id
    WHERE c.period_start < date_trunc('month', CURRENT_DATE)::date;
    IF n <> 2 THEN
        RAISE EXCEPTION
          'migration 245: % of 2 wallets are now behind the current period; '
          'the roll would not fire for the rest', n;
    END IF;
END $$;

COMMIT;
