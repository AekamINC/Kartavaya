-- 223_service_line_invoice_from.sql
--
-- ── WHAT THIS TOUCHES ────────────────────────────────────────────────────────
--
--   ADD COLUMN staging.client_service_lines.invoice_from  × 1  (date, NULLABLE)
--   COMMENT    on the new column
--
-- ONE NULLABLE COLUMN, NO DEFAULT, NO BACKFILL. All four live rows get NULL,
-- the sweep reads NULL as "no floor — start from the line's own period_start",
-- and every run computes exactly what it computes today. Re-running is a no-op.
-- Reversal is at the foot of this file.
--
-- ── WHY ──────────────────────────────────────────────────────────────────────
--
-- Phase 3.3 made the auto-invoice sweep advance from the last invoiced period,
-- so a monthly retainer recurs instead of invoicing once for ever. That fix has
-- a consequence the moment `/cron/billing` is armed: a line that has NEVER been
-- invoiced starts at its own `period_start` and catches up a period per run.
--
-- Measured live 2026-08-26, and it is not hypothetical. All four
-- `client_service_lines` in the product belong to **Unicode Group** — the real
-- customer — and two auto-invoice:
--
--     Monthly accounting retainer                ₹75,000/mo   since 2026-04-01
--     Payroll processing (up to 50 employees)    ₹15,000/mo   since 2026-04-01
--
-- `client_invoice_lines` is empty, so the first tick raises APRIL, the next day
-- May, and so on — ten tax invoices, ₹4,50,000 + ₹81,000 GST, with serials
-- drawn from Unicode's live sequence, unattended.
--
-- **Owner's decision, 2026-08-26: start the clock in August.** Only the current
-- period is raised; the four months before it are not this system's to bill.
--
-- ── WHY A COLUMN AND NOT AN UPDATE TO period_start ───────────────────────────
--
-- The obvious way to start the clock is to move `period_start` to 2026-08-01.
-- It works and it lies: `period_start` is WHEN THE SERVICE BEGAN, it is what
-- the client billing screen shows, and rewriting it says a retainer that has
-- run since April started last week. A firm looking at its own contract terms
-- would read a fiction, and the true start date would exist nowhere.
--
-- So the two facts get two columns. `period_start` keeps saying April.
-- `invoice_from` says "do not raise a period that starts before this date",
-- which is a different and honest statement — the same shape as onboarding any
-- customer mid-relationship, where the service predates the software.
--
-- ── HOW THE SWEEP READS IT ───────────────────────────────────────────────────
--
--     already invoiced   → one cadence step after the last invoiced period
--     never invoiced     → max(first anchor on/after period_start, invoice_from)
--
-- History wins where there is history: a line with invoiced periods is not sent
-- backwards or forwards by this column. NULL is no floor at all.
--
-- ── WRITE-PATH SIDE EFFECTS ──────────────────────────────────────────────────
--
-- NONE from this file. The column arrives NULL on all four rows and NULL is
-- exactly today's behaviour. The effect comes from the UPDATE below it, which
-- is a SEPARATE, owner-approved data change to live rows and is written out
-- with its reversal — it is not run by this migration.
--
-- ── DEPLOY ORDER — THIS FILE FIRST ───────────────────────────────────────────
--
-- `sweep_client_auto_invoices` selects `sl.*` and then reads
-- `sl["invoice_from"]`. A backend deployed ahead of this column raises KeyError
-- on every sweep. Migration, then deploy.
--
-- ── LOCKS ────────────────────────────────────────────────────────────────────
--
-- ACCESS EXCLUSIVE on staging.client_service_lines for a catalog update.
-- A nullable column with no default rewrites nothing; 4 rows either way.

ALTER TABLE staging.client_service_lines
    ADD COLUMN IF NOT EXISTS invoice_from date;

COMMENT ON COLUMN staging.client_service_lines.invoice_from IS
    'The earliest period the auto-invoice sweep may raise for this line. NULL '
    'means no floor — the sweep starts at the line''s own period_start, which '
    'is what all four seeded rows do. Set it when a service predates this '
    'system and the months before it were billed elsewhere (or are not to be '
    'billed at all): period_start keeps saying when the service began, and '
    'this says where invoicing starts. Never sends a line with invoiced '
    'history backwards — history wins.';

-- ── THE DATA CHANGE THIS EXISTS FOR — NOT RUN HERE ───────────────────────────
--
-- Owner-approved 2026-08-26, applied separately so a schema migration never
-- carries a customer's row edit inside it:
--
--   UPDATE staging.client_service_lines SET invoice_from = '2026-08-01'
--    WHERE id IN ('e80256b7-15d1-4398-8e61-42bf883b3366',    -- retainer  ₹75,000
--                 'a674a0fe-b502-41ce-9bd7-bb668e1c584e');   -- payroll   ₹15,000
--
-- Reversal:
--
--   UPDATE staging.client_service_lines SET invoice_from = NULL
--    WHERE id IN ('e80256b7-15d1-4398-8e61-42bf883b3366',
--                 'a674a0fe-b502-41ce-9bd7-bb668e1c584e');
--
-- Reversing it restores the April backlog, so reverse it only if the owner
-- wants those four months raised after all.
--
-- ── REVERSAL (schema) ────────────────────────────────────────────────────────
--
--   ALTER TABLE staging.client_service_lines DROP COLUMN IF EXISTS invoice_from;
--
-- Restores exactly, because nothing is backfilled by this file. Run the data
-- reversal above first if it has been applied — dropping the column discards
-- the floor silently and the next sweep back-bills to April.
