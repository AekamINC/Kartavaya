-- 254 — "customer" stops being a kind of person
--
-- ── THE OWNER'S DECISION ────────────────────────────────────────────────────
--
--   "customer and clients are same why you are separating? all current
--    customers in db needs to be converted to clients ... they are nothing
--    called customer if you have clients. essentially your duplicating and
--    invoice doesnt match up then."
--   "Customer should get bye bye and client only remains."
--
-- CLAUDE.md already said this — "A CRM client is the company (the customer).
-- Contacts are people who come and go; the customer stays." The product drifted
-- from its own written rule and grew a second answer to one question.
--
-- ── WHY `contact_type='customer'` CARRIES NO INFORMATION ────────────────────
--
-- Measured live 2026-09-01, and this is the number that settles it:
--
--   35 clients, of which 26 are already flagged `is_sales_customer`
--   28 contacts typed 'customer', spread over only 14 distinct clients
--   26 of 35 clients have MIXED contact types on their people
--   7 clients have a 'customer' contact AND a 'vendor' contact at the same time
--
-- So the per-contact type does not describe the company relationship: it
-- disagrees with it more often than it agrees. `graha_clients.is_sales_customer`
-- already holds that fact and always did.
--
-- ── AND WHAT THE DUPLICATION COST ───────────────────────────────────────────
--
-- `routers/dristi.py:278` reports the firm's "customers" KPI as
-- `COUNT(*) FILTER (WHERE contact_type='customer')` — it counts PEOPLE. With 28
-- such contacts over 14 companies, the dashboard's customer count was the size
-- of the address book, not the customer base.
--
-- `ganit/InvoiceForm.jsx:456` and `vikray/OrderForm.jsx:248` both CREATE a
-- contact typed 'customer' while already holding a `client_id` — writing the
-- relationship twice, in two places, with nothing keeping them equal.
--
-- ── WHAT REPLACES IT ────────────────────────────────────────────────────────
--
-- `'contact'`. A `lead` is somebody you have not won; a `contact` is a person at
-- a client. Whether that client is a customer, a vendor or a partner is a fact
-- about the CLIENT. `'vendor'` and `'partner'` survive untouched — they are not
-- about being a customer and removing them is not this change's business.
--
-- ── THE DATA ────────────────────────────────────────────────────────────────
--
-- The owner confirmed 2026-09-01: "you are free to refresh the data as all is
-- seed data nothing is actual data." Even so this migration CREATES rather than
-- deletes: four contacts get a company built from the text they already carry,
-- nothing is dropped, and every step is reversible. There was no reason to
-- spend the licence.

BEGIN;

-- ── 0. WIDEN THE CHECK FIRST. THE ORDER IS THE WHOLE POINT. ─────────────────
--
-- I got this wrong on the first attempt and the migration aborted: step 4 below
-- writes `'contact'`, and the CHECK in force at that moment only allowed
-- ('lead','customer','vendor','partner'). The statements in a migration run in
-- order, so widening the constraint at the END is too late for the UPDATE in
-- the middle. Postgres refused the row and rolled the whole thing back — which
-- is the transaction doing its job, and the reason nothing had to be repaired.
--
-- The widened set is deliberately WIDER than either end state and holds BOTH
-- values for exactly one deploy. See the note at step 5.
ALTER TABLE public.graha_contacts
  DROP CONSTRAINT IF EXISTS graha_contacts_contact_type_check;

ALTER TABLE public.graha_contacts
  ADD CONSTRAINT graha_contacts_contact_type_check
  CHECK (contact_type IN ('lead', 'contact', 'customer', 'vendor', 'partner'));

-- ── 1. A customer contact with no company gets one ──────────────────────────
--
-- Four rows: Priya Patel / TechCorp India, Meghdoot Textiles, S04 Prospect 11,
-- and one S16 test contact whose `company` is blank and which therefore falls
-- back to its own name. `DISTINCT ON` because two contacts at one unnamed
-- company must produce ONE client, not two.
INSERT INTO public.graha_clients (org_id, name, is_sales_customer, is_active)
SELECT DISTINCT ON (c.org_id, lower(coalesce(nullif(btrim(c.company), ''), c.name)))
       c.org_id,
       coalesce(nullif(btrim(c.company), ''), c.name),
       TRUE,
       TRUE
  FROM public.graha_contacts c
 WHERE c.contact_type = 'customer'
   AND c.client_id IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.graha_clients gc
          WHERE gc.org_id = c.org_id
            AND lower(gc.name) = lower(coalesce(nullif(btrim(c.company), ''), c.name)))
 ORDER BY c.org_id,
          lower(coalesce(nullif(btrim(c.company), ''), c.name)),
          c.created_at;

-- ── 2. Link every orphan to it ──────────────────────────────────────────────
UPDATE public.graha_contacts c
   SET client_id = gc.id,
       updated_at = NOW()
  FROM public.graha_clients gc
 WHERE c.contact_type = 'customer'
   AND c.client_id IS NULL
   AND gc.org_id = c.org_id
   AND lower(gc.name) = lower(coalesce(nullif(btrim(c.company), ''), c.name));

-- ── 3. The company a customer contact belongs to IS a customer ──────────────
--
-- This is the fact being MOVED, not invented: it was recorded on the person and
-- it belongs on the company. Runs before the retype below, because after it
-- there are no 'customer' contacts left to read it from.
UPDATE public.graha_clients gc
   SET is_sales_customer = TRUE,
       updated_at = NOW()
 WHERE NOT gc.is_sales_customer
   AND EXISTS (SELECT 1 FROM public.graha_contacts c
                WHERE c.client_id = gc.id AND c.contact_type = 'customer');

-- ── 4. Retype the people ────────────────────────────────────────────────────
UPDATE public.graha_contacts
   SET contact_type = 'contact',
       updated_at = NOW()
 WHERE contact_type = 'customer';

-- ── 5. Why the CHECK at step 0 accepts BOTH ────────────────────────────────
--
-- ⚠ THIS IS THE STEP THAT CANNOT BE DONE IN ONE GO, AND THE REASON IS ORDERING.
--
-- The code that writes `'contact'` is not deployed at the moment this runs, and
-- the code that IS deployed still writes `'customer'`. Tightening the CHECK to
-- the new set here would 500 every lead conversion and every
-- contact-created-from-an-invoice until the deploy lands; tightening it after
-- the deploy leaves the opposite window. Either order has a gap where a real
-- person pressing a real button gets an error.
--
-- So this migration accepts both values, and migration 255 removes `'customer'`
-- once the deploy is verified. The transitional set is deliberately WIDER than
-- either end state — that is what makes the window zero rather than small.
--
-- Migration 255 is not optional. Without it the concept is still writable and
-- every fix above is a one-off tidy-up that the next import undoes.

COMMENT ON COLUMN public.graha_contacts.contact_type IS
  'What this PERSON is: a lead not yet won, or a contact at a client. '
  '''customer'' was removed by migration 254 — a customer is a COMPANY, and '
  'graha_clients.is_sales_customer is where that lives. vendor/partner remain.';

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   ALTER TABLE public.graha_contacts DROP CONSTRAINT graha_contacts_contact_type_check;
--   ALTER TABLE public.graha_contacts ADD CONSTRAINT graha_contacts_contact_type_check
--     CHECK (contact_type IN ('lead','customer','vendor','partner'));
--   UPDATE public.graha_contacts SET contact_type='customer' WHERE contact_type='contact';
--
-- The clients created in step 1 and the `is_sales_customer` flags set in step 3
-- are NOT undone by that, deliberately: they are correct facts about real
-- companies regardless of which column the product reads them from.
