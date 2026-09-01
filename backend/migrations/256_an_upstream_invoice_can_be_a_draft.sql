-- 256 — an upstream invoice can be a DRAFT, and the owner cannot receive one
--
-- ── READ THIS FIRST: THE TABLE THIS MIGRATION DOES *NOT* CREATE ─────────────
--
-- This file was commissioned to add "the platform-side equivalent of
-- `client_invoice_lines` — nothing records that this billing line was invoiced
-- for this period, so the sweep double-bills on its second run."
--
-- IT ALREADY EXISTS AND IT IS CORRECT. Migration 096 created
-- `invoice_billing_lines` under the heading "WHICH LINES AN INVOICE ACTUALLY
-- BILLED", with `uq_ibl_line_period` on `(line_id, period_start)` — a comment in
-- 096 calls that index "THE NO-DOUBLE-CHARGE RULE, AS AN INDEX RATHER THAN AS A
-- CODE PATH". Verified live 2026-09-01, not read off a migration file:
--
--     table                   columns                                    rows
--     invoice_billing_lines   invoice_id, line_id, period_start,            0
--                             amount, created_at
--     uq_ibl_line_period      UNIQUE (line_id, period_start)
--
-- `services/billing_lines.py::record_billed` is its single writer and already
-- refuses — rather than skips — a line already billed for a period, a line not
-- due in that period, and a credit recorded with the wrong sign.
-- `sweep_platform_invoices` therefore CALLS that function instead of writing the
-- join table itself. A second writer of a no-double-charge invariant is how the
-- invariant stops holding, which is billing_lines.py's own stated reason for
-- owning the table, and creating a parallel guard table here would have left two
-- rows disagreeing about whether September was billed.
--
-- So this migration adds neither a table nor an index. It closes the gap that IS
-- open, which is a different one.
--
-- ── THE GAP THAT IS ACTUALLY OPEN ──────────────────────────────────────────
--
-- The sweep must raise a DRAFT: "nobody watches a cron". `ganit_invoices` can
-- express that — it has `doc_status`, and `sweep_client_auto_invoices` writes
-- 'draft' explicitly into it because that column DEFAULTS to 'final' and a cron
-- minting finished tax invoices unattended is a defect that has actually fired
-- in this product (PROGRESS.md, 2026-08-27: INV-2026-0093 and INV-2026-0094
-- against Unicode Group, serials drawn from that firm's live series).
--
-- `subscription_invoices` — the UPSTREAM table, what Aekam charges an org —
-- has no such column. Its full live column list was read from
-- information_schema on 2026-09-01 and there is nothing in it that separates a
-- proposal from an issued document:
--
--     id, org_id, invoice_number, period_start, period_end, line_items,
--     subtotal, gst, total, payment_status, paid_at, pdf_url, created_at,
--     payment_method, payment_reference, collected_by, approved_by, due_date,
--     reminder_sent_at, generated_from, upi_vpa, upi_payee_name, created_by,
--     updated_at, updated_by
--
-- `payment_status` is not that column and must not be pressed into being it. It
-- answers "has this been paid" (pending/paid/failed/refunded) and
-- `services/billing_lines.py` reasons about its 'refunded' value in two places;
-- folding "has this been issued" into the same column would make those two
-- questions unanswerable apart. They are orthogonal facts and get two columns.
--
-- ── WHY DEFAULT 'final' AND NOT 'draft' ────────────────────────────────────
--
-- Because the other writer of this table is a PERSON. `POST /v1/admin/invoices`
-- (`routers/subscription.py::create_invoice`) is an operator in the billing
-- console deliberately raising a document, and it names its columns explicitly
-- — it will not name this one. Defaulting to 'final' therefore leaves that path
-- byte-for-byte what it is today, which is the correct answer for it anyway,
-- and makes the sweep the only thing in the product that has to say 'draft' out
-- loud. Same shape and same reasoning as `ganit_invoices.doc_status`.
--
-- The table holds ZERO ROWS (counted live 2026-09-01), so no existing document
-- is re-labelled by the default either way. That is a fact about today, not an
-- argument — the default is chosen for the writer, not for the backfill.
--
-- ⚠ ── WHAT THIS COLUMN DOES *NOT* YET DO — READ BEFORE ARMING A LINE ───────
--
-- Adding the column does not make the two readers of this table honour it, and
-- both live in `routers/subscription.py`, which the author of this migration
-- does not own and has not edited:
--
--   GET /v1/admin/invoices/overdue
--       WHERE payment_status='pending' AND due_date < CURRENT_DATE
--       → A draft cannot reach this list, because the sweep writes
--         `due_date = NULL` on every draft it raises. `NULL < CURRENT_DATE` is
--         NULL, so the row is not selected. That is not a trick: a draft has no
--         due date because it has not been issued, and the payment clock starts
--         when a person finalises it. This surface is CLOSED.
--
--   GET /v1/invoices                      ← THE CLIENT'S OWN BILLING TAB
--       SELECT * FROM subscription_invoices WHERE org_id=$1
--       → HAS NO STATUS FILTER, so a draft WOULD be listed to the customer
--         alongside issued invoices, and the frontend does not render
--         `doc_status` yet either. This surface is OPEN.
--
-- Nothing can fire today: `auto_invoice` is FALSE on all four live billing
-- lines (counted 2026-09-01) and only a deliberate UPDATE turns one on. But
-- `GET /v1/invoices` MUST LEARN `doc_status='final'` BEFORE THE FIRST LINE IS
-- ARMED, or the first thing the sweep does is show a customer a document nobody
-- reviewed. That edit is owed and is not in this file.
--
-- ── THE OWNER'S EXEMPTION, ONE LEVEL UP ────────────────────────────────────
--
-- 252 put a trigger on `org_billing_lines` refusing a line for an org with
-- `is_platform_org`. That protects the TERM. It does not protect the DOCUMENT:
-- nothing stopped a `subscription_invoices` row being written against Aekam Inc
-- by any other route, and "Aekam is not charged" is a rule about being charged,
-- not about the row that says why.
--
-- The sweep never tries — it filters on `NOT o.is_platform_org` — but a rule
-- enforced only by the WHERE clause of the code that must obey it is a
-- convention again. Both halves are now in the database.
--
-- ── WRITE-PATH SIDE EFFECTS ────────────────────────────────────────────────
--
--   ADD COLUMN subscription_invoices.doc_status  (text, NOT NULL, DEFAULT
--                                                 'final', CHECK draft|final)
--   CREATE FUNCTION refuse_subscription_invoice_for_platform_org()
--   CREATE TRIGGER  trg_no_subscription_invoice_for_platform_org
--   CREATE INDEX    idx_sub_inv_draft  (partial)
--
-- No row is written, updated or deleted by this file. `subscription_invoices`
-- holds 0 rows, so the constant default is stored as a `pg_attribute` missing
-- value and nothing is rewritten; the CHECK cannot fail because there are no
-- rows to validate.
--
-- BEHAVIOURAL CHANGE TO A PATH THIS AUTHOR DOES NOT OWN, stated plainly because
-- it is the one thing in this file that is not purely additive: after this,
-- `POST /v1/admin/invoices` RAISES if it is aimed at the platform org. It
-- cannot be aimed at it today by any screen — the billing console lists client
-- orgs — and an invoice from Aekam to Aekam is not a document that means
-- anything. If that refusal is unwanted, drop the trigger; the column is
-- independent of it.
--
-- ── LOCKS ──────────────────────────────────────────────────────────────────
--
-- ACCESS EXCLUSIVE on public.subscription_invoices for the ADD COLUMN, the
-- trigger and the index. 0 rows, so the work behind the lock is a catalog
-- update — the cost is acquiring it, not holding it. Nothing long-running reads
-- this table.
--
-- ── REVERSAL ───────────────────────────────────────────────────────────────
--
--   DROP TRIGGER IF EXISTS trg_no_subscription_invoice_for_platform_org
--     ON public.subscription_invoices;
--   DROP FUNCTION IF EXISTS public.refuse_subscription_invoice_for_platform_org();
--   DROP INDEX IF EXISTS public.idx_sub_inv_draft;
--   ALTER TABLE public.subscription_invoices DROP COLUMN IF EXISTS doc_status;
--
-- Exact, because nothing is backfilled. ⚠ Dropping `doc_status` while any draft
-- exists SILENTLY PROMOTES EVERY DRAFT TO AN ISSUED INVOICE — the distinction
-- lives nowhere else. Count drafts before reversing.

BEGIN;

-- ── 1. A proposal and an issued document stop being the same row ───────────

ALTER TABLE public.subscription_invoices
  ADD COLUMN IF NOT EXISTS doc_status text NOT NULL DEFAULT 'final';

-- Separate from the ADD so that re-running this file on a database that already
-- has the column still installs the constraint. `IF NOT EXISTS` skips the whole
-- clause it is attached to, CHECK included — 096 makes the same point about its
-- own `generated_from` — so a CHECK written inline would be silently absent on
-- exactly the replay that was supposed to be a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.subscription_invoices'::regclass
       AND conname = 'subscription_invoices_doc_status_ck'
  ) THEN
    ALTER TABLE public.subscription_invoices
      ADD CONSTRAINT subscription_invoices_doc_status_ck
      CHECK (doc_status IN ('draft', 'final'));
  END IF;
END $$;

COMMENT ON COLUMN public.subscription_invoices.doc_status IS
  'Whether this upstream invoice has been ISSUED. ''draft'' is a proposal that '
  'a person has not yet approved — what services/platform_billing.py'
  '::sweep_platform_invoices writes, because nobody watches a cron. ''final'' '
  'is a document that has been issued to the org and may be chased and paid. '
  'DEFAULTS to ''final'' so that POST /v1/admin/invoices — an operator raising '
  'a document deliberately, which does not name this column — behaves exactly '
  'as it did before this column existed. Same column, same default and the '
  'same reason as ganit_invoices.doc_status. ⚠ A draft also carries due_date '
  'NULL, which is what keeps it off the overdue list; GET /v1/invoices does '
  'NOT filter on this column yet and will list drafts to the customer until it '
  'does.';

-- A draft is a work item — "what is waiting for a person to approve it" — and
-- that is the only question this column is asked at speed. Partial, so it
-- indexes the handful of pending proposals rather than every invoice ever
-- issued, and stays empty until the sweep is armed.
CREATE INDEX IF NOT EXISTS idx_sub_inv_draft
  ON public.subscription_invoices (org_id, period_start)
  WHERE doc_status = 'draft';

-- ── 2. The owner cannot be issued an invoice, not merely priced ────────────

CREATE OR REPLACE FUNCTION public.refuse_subscription_invoice_for_platform_org()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER (the default, stated rather than assumed because getting it
-- wrong is how two views became a cross-tenant hole on 2026-08-29). This reads
-- one row of `organisations` by primary key and needs no privilege its caller
-- does not already hold.
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organisations o
     WHERE o.id = NEW.org_id AND o.is_platform_org
  ) THEN
    RAISE EXCEPTION
      'Kartavaya''s own organisation is not invoiced for the platform it owns.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_subscription_invoice_for_platform_org
  ON public.subscription_invoices;

CREATE TRIGGER trg_no_subscription_invoice_for_platform_org
  BEFORE INSERT OR UPDATE OF org_id ON public.subscription_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_subscription_invoice_for_platform_org();

-- ⚠ `UPDATE OF org_id`, not a bare UPDATE, and the reasoning is 252's exactly.
-- `record_payment` UPDATEs this table to set payment_status and paid_at, and
-- `trg_touch_subscription_invoices` UPDATEs `updated_at` on every write; both
-- are legitimate and neither charges anybody. Moving an invoice ONTO the
-- platform org is the write that would bill the owner, and that is the one the
-- trigger watches. A bare UPDATE would also make every existing row's ordinary
-- maintenance re-run this check for no benefit.

COMMIT;
