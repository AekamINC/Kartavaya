-- One company record, referenced by two modules.
--
-- Owner's decision, 2026-08-09: "keep them separate modules, but make the
-- shared thing one record… entering a customer in Sales creates the company,
-- and it's immediately the CRM client if they later buy CRM."
--
-- ── WHAT SALES HAD INSTEAD ──────────────────────────────────────────────────
--
-- Nothing. `GET /vikray/customers` GROUPs `vikray_orders` and joins
-- `graha_contacts`, so a Sales "customer" was a CRM **contact who happened to
-- have placed an order** — a person, not a company — and no user could create
-- one. `vikray_orders` had `contact_id` and `deal_id` and no company reference
-- at all, which is why "sales by customer" could not be written and why the
-- module could not stand alone.
--
-- ── WHY graha_clients IS THE SHARED RECORD AND NOT A NEW TABLE ──────────────
--
-- Because it already IS the company: `graha_contacts.client_id` and
-- `graha_deals.client_id` both point at it, the invoice PDF prints its name,
-- and migration 132 made `contacts.company` a mirror of it. A new
-- `companies` table would mean two rows for one firm on day one and a sync job
-- for ever — which is exactly what the owner ruled out.
--
-- The table is therefore NOT a CRM table any more; it is shared infrastructure
-- that the CRM module reads. An org with Sales and no CRM writes rows here and
-- never sees the CRM screens. If they later buy CRM, their customers are
-- already their clients, with no import and no migration.
--
-- ── `is_sales_customer` IS THE OWNER'S "TICK" ───────────────────────────────
--
-- A flag on the ONE record, not a copy of it in a second module. It is set the
-- moment an order names the company and is never unset automatically: a firm
-- that ordered once is a customer for ever, and un-ticking it because a year
-- passed would quietly drop them out of a sales report.

BEGIN;

ALTER TABLE staging.graha_clients
    ADD COLUMN IF NOT EXISTS is_sales_customer BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN staging.graha_clients.is_sales_customer IS
    'This company has placed a sales order. Set when an order names them; never '
    'cleared automatically. The owner''s "sync tick", as a flag on one record '
    'rather than a second copy of it.';

ALTER TABLE staging.vikray_orders
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES staging.graha_clients(id);

CREATE INDEX IF NOT EXISTS idx_vikray_orders_client
    ON staging.vikray_orders (org_id, client_id);

-- Backfill: an existing order names a contact, and that contact usually belongs
-- to a client. Where it does, the order belongs to that company. Where it does
-- not, `client_id` stays NULL and the customers list falls back to the contact
-- exactly as it does today — no order is orphaned and none is invented.
UPDATE staging.vikray_orders o
   SET client_id = c.client_id
  FROM staging.graha_contacts c
 WHERE c.id = o.contact_id
   AND c.client_id IS NOT NULL
   AND o.client_id IS NULL;

-- Every company an order now points at has, by definition, placed one.
UPDATE staging.graha_clients cl
   SET is_sales_customer = TRUE
 WHERE cl.is_sales_customer = FALSE
   AND EXISTS (SELECT 1 FROM staging.vikray_orders o
                WHERE o.client_id = cl.id AND o.is_active = TRUE);

COMMIT;
