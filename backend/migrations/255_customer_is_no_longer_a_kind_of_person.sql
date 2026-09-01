-- 255 — remove 'customer' from contact_type, once the deploy has landed
--
-- The second half of migration 254. 254 retyped every row and widened the CHECK
-- to accept BOTH values, so that neither the old deploy nor the new one could
-- hit a constraint it did not expect. This closes it.
--
-- ⚠ DO NOT RUN THIS UNTIL THE DEPLOY WRITING 'contact' IS LIVE. The check below
-- refuses rather than trusting whoever runs it: if any row still says
-- 'customer', the deploy has not landed (or something is still writing the old
-- value) and tightening the CHECK would start 500ing that writer.

BEGIN;

DO $$
DECLARE stragglers int;
BEGIN
  SELECT count(*) INTO stragglers
    FROM public.graha_contacts WHERE contact_type = 'customer';
  IF stragglers > 0 THEN
    RAISE EXCEPTION
      '% contact(s) still typed customer — migration 254 has not finished, or '
      'something is still writing the old value. Find the writer before '
      'tightening the constraint.', stragglers;
  END IF;
END $$;

ALTER TABLE public.graha_contacts
  DROP CONSTRAINT IF EXISTS graha_contacts_contact_type_check;

ALTER TABLE public.graha_contacts
  ADD CONSTRAINT graha_contacts_contact_type_check
  CHECK (contact_type IN ('lead', 'contact', 'vendor', 'partner'));

COMMIT;

-- ROLLBACK: re-add 'customer' to the IN list. No data changes here to undo.
