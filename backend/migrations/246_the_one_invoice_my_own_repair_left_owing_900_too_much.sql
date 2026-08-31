-- 246 · INV-2026-0009 says the customer owes ₹900 more than the invoice totals.
--
-- ── What happened ───────────────────────────────────────────────────────────
--
-- Commit 827bafe8 ("GST was charged on the pre-discount value") corrected the
-- output tax on four orders and one invoice IN THE DATA as well as in the code:
--
--     INV-2026-0009   tax 5,400.00 -> 4,500.00,  total 30,400.00 -> 29,500.00
--
-- That hand-written correction updated `subtotal`, `cgst`, `sgst` and `total`.
-- It did NOT update `balance_due`, which is a stored column rather than a
-- derived one, so the row now reads:
--
--     total 29,500.00 · amount_paid 0.00 · balance_due 30,400.00
--
-- ⚠ THE REPAIR, NOT THE PRODUCT, IS WHAT LEFT THIS. Every write path in the
-- application binds the two together — `vikray.generate_invoice_from_order`
-- deliberately passes `$11` twice for exactly this reason and says so at
-- vikray.py:1279, `ganit.update_invoice` sets `total=$14, balance_due=$14`, and
-- `record_payment` recomputes both from `total - amount_paid`. Nine of the ten
-- order-generated invoices carry `balance_due = total` and always have. The
-- proof it was not the application is in the row itself: `updated_at` moved
-- while `updated_by` stayed NULL, and every one of those six routes stamps
-- `updated_by` in the same statement.
--
-- ── Scope, measured rather than assumed ─────────────────────────────────────
--
--     SELECT ... FROM public.ganit_invoices
--     WHERE ABS(balance_due - (total - amount_paid)) > 0.005;
--     -> 1 row, INV-2026-0009, drift +900.00
--
-- One row in the whole database, and `balance_due` exists on no other table
-- (information_schema: `ganit_invoices` is the only one). So this is a single
-- correction, not a class.
--
-- ── Why it matters ──────────────────────────────────────────────────────────
--
-- `balance_due` is what the customer is told they owe. It is what
-- `invoice_pdf.py:345` prints as "Balance due", what `invoice_email.py:81`
-- sends, what `reminder_service.py:127` chases (`balance_due > 0`), and what
-- the ageing and outstanding figures sum (ganit.py:1509). A ₹900 overstatement
-- is a demand for money the document does not support.
--
-- Found by Suite 10.08, which read the conversion back against the order rather
-- than trusting it: "the invoice totals 29500 and its balance_due is 30400".
--
-- ── The correction ──────────────────────────────────────────────────────────
--
-- `total - amount_paid`, which is the identity `record_payment` itself uses and
-- the one `reminder_service` documents. Not a literal 29,500: a literal would
-- be right today and wrong the moment anything else moves, and it would hide a
-- second drifted row if one appeared between writing this and running it.
--
-- Guarded by the same predicate that found it, so re-running touches nothing.

-- ── The reversal, written here rather than into a table ─────────────────────
--
--     UPDATE public.ganit_invoices SET balance_due = 30400.00
--     WHERE id = '2c34eca5-a86a-44f3-bb97-224ca3c9462b';   -- INV-2026-0009
--
-- ⚠ DELIBERATELY NOT A BACKUP TABLE. A new table in `public` carries no RLS
-- policy at creation, `public` is exposed to PostgREST, and the anon key is
-- compiled into the shipped browser bundle — so a one-row convenience table
-- would be a cross-tenant read with no error and no log line. One row's prior
-- value belongs in the file that changes it.

BEGIN;

UPDATE public.ganit_invoices
SET balance_due = ROUND(COALESCE(total, 0) - COALESCE(amount_paid, 0), 2)
WHERE ABS(COALESCE(balance_due, 0) - (COALESCE(total, 0) - COALESCE(amount_paid, 0))) > 0.005;

COMMIT;
