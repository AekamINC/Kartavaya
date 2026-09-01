-- 259 — delete the documents that belong to no company
--
-- ── WHY, AND ON WHOSE AUTHORITY ─────────────────────────────────────────────
--
-- Owner, 2026-09-01: "clean those three too all data apart form aekam is not
-- real data so can be deleted."
--
-- Three sets of rows, all produced by the same defect: a document could be
-- written with no `client_id`, and a document that belongs to no company appears
-- on no customer ledger, in no receivables-by-client figure and on no statement.
-- `GET /vikray/customers` ends its WHERE with `AND (client_id IS NOT NULL OR
-- contact_id IS NOT NULL)`, so such a row can vanish from the customers list
-- entirely rather than merely sit in the wrong place.
--
-- The FAUCET was closed first (f29c0663, and migrations 254/255). This removes
-- what it produced before it was closed. Doing it the other way round would have
-- been tidying up underneath a tap that was still running.
--
-- ── WHAT IS DELETED, MEASURED 2026-09-01 ────────────────────────────────────
--
--   1 ganit_payments row            Rs         1.00   (against INV-2026-0095)
--  21 ganit_invoices                Rs 2,54,172.00    (all client_id IS NULL)
--   1 vikray_orders  SO-2026-0038   Rs 49,08,800.00   (client_id AND contact_id NULL)
--   9 graha_deals                                     (client_id IS NULL, one 'Won')
--
-- Every one is in Unicode Group. ZERO belong to Aekam Inc, and the guard below
-- aborts rather than trusting that sentence.
--
-- Cascades take 2 graha_follow_ups. `vikray_stock_moves.order_id` is SET NULL.
-- Verified to be zero: orders pointing at these invoices, invoices converted
-- from them, client_engagements referencing them, and activities/documents/
-- invoices hanging off the deals.
--
-- ⚠ THE ORDER OF THE DELETES IS FORCED BY TWO `NO ACTION` FOREIGN KEYS and is
-- not a matter of taste:
--
--   ganit_payments.invoice_id -> ganit_invoices   NO ACTION
--       so the payment goes before the invoice, or the delete fails.
--   vikray_orders.deal_id     -> graha_deals      NO ACTION
--       and the single order referencing an orphan deal IS SO-2026-0038,
--       so the order goes before the deals, or the delete fails.
--
-- ⚠ THIS IS IRREVERSIBLE. There is no soft-delete here and no rollback section,
-- because a DELETE has no inverse. It runs on the owner's statement that
-- everything outside Aekam is seed data.

BEGIN;

SET LOCAL lock_timeout      = '5s';
SET LOCAL statement_timeout = '60s';

-- ── GUARD: nothing in this migration may touch the platform organisation ────
--
-- Stated as a refusal rather than as a predicate on each DELETE, because a
-- predicate that is wrong deletes quietly and a guard that is wrong aborts.
DO $guard$
DECLARE hits int;
BEGIN
    SELECT
        (SELECT count(*) FROM public.ganit_invoices i
           JOIN public.organisations o ON o.id = i.org_id
          WHERE i.is_active AND i.client_id IS NULL AND o.is_platform_org)
      + (SELECT count(*) FROM public.vikray_orders v
           JOIN public.organisations o ON o.id = v.org_id
          WHERE v.order_number = 'SO-2026-0038' AND o.is_platform_org)
      + (SELECT count(*) FROM public.graha_deals d
           JOIN public.organisations o ON o.id = d.org_id
          WHERE d.is_active AND d.client_id IS NULL AND o.is_platform_org)
      INTO hits;

    IF hits > 0 THEN
        RAISE EXCEPTION
            'GUARD: % of the rows this migration would delete belong to the '
            'platform organisation. Aekam Inc is never touched. Refusing.', hits;
    END IF;
END
$guard$;

-- ── GUARD: the counts must be the ones that were measured ───────────────────
--
-- If the numbers have moved since 2026-09-01, something wrote another orphan
-- after the faucet was closed — and that is a bug to find, not a row to sweep up.
DO $counts$
DECLARE inv int; ord int; dls int; pay int;
BEGIN
    SELECT count(*) INTO inv FROM public.ganit_invoices
     WHERE is_active AND client_id IS NULL;
    SELECT count(*) INTO ord FROM public.vikray_orders
     WHERE order_number = 'SO-2026-0038' AND is_active;
    SELECT count(*) INTO dls FROM public.graha_deals
     WHERE is_active AND client_id IS NULL;
    SELECT count(*) INTO pay FROM public.ganit_payments p
     WHERE p.invoice_id IN (SELECT id FROM public.ganit_invoices
                             WHERE is_active AND client_id IS NULL);

    IF inv <> 21 OR ord <> 1 OR dls <> 9 OR pay <> 1 THEN
        RAISE EXCEPTION
            'GUARD: expected 21 invoices / 1 order / 9 deals / 1 payment, '
            'found % / % / % / %. The faucet may be open again — find the '
            'writer before deleting anything.', inv, ord, dls, pay;
    END IF;
END
$counts$;

-- ── 1. The payment, before the invoice it points at ─────────────────────────
DELETE FROM public.ganit_payments
 WHERE invoice_id IN (SELECT id FROM public.ganit_invoices
                       WHERE is_active AND client_id IS NULL);

-- ── 2. The invoices that belong to no company ───────────────────────────────
DELETE FROM public.ganit_invoices
 WHERE is_active AND client_id IS NULL;

-- ── 3. The order that belongs to nobody at all ──────────────────────────────
--
-- Named explicitly rather than matched on `client_id IS NULL`: SO-2026-0001 is
-- also client-less and is a CANCELLED, already-inactive Aekam order. A predicate
-- would have taken it; a name cannot.
DELETE FROM public.vikray_orders
 WHERE order_number = 'SO-2026-0038' AND is_active;

-- ── 4. The deals, now that nothing references them ──────────────────────────
DELETE FROM public.graha_deals
 WHERE is_active AND client_id IS NULL;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE inv int; ord int; dls int;
BEGIN
    SELECT count(*) INTO inv FROM public.ganit_invoices
     WHERE is_active AND client_id IS NULL;
    SELECT count(*) INTO ord FROM public.vikray_orders
     WHERE order_number = 'SO-2026-0038';
    SELECT count(*) INTO dls FROM public.graha_deals
     WHERE is_active AND client_id IS NULL;

    IF inv <> 0 OR ord <> 0 OR dls <> 0 THEN
        RAISE EXCEPTION
            'VERIFY: % invoices / % orders / % deals still belong to nobody.',
            inv, ord, dls;
    END IF;

    -- And the thing that must still be true afterwards: Aekam is untouched.
    IF NOT EXISTS (SELECT 1 FROM public.organisations WHERE is_platform_org) THEN
        RAISE EXCEPTION 'VERIFY: the platform organisation is gone. Roll back.';
    END IF;
END
$verify$;

COMMIT;
