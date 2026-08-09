-- graha_contacts.company becomes a MIRROR of the contact's client name.
--
-- Why this and not a query change
-- ────────────────────────────────
-- The free-text Company box was dropped from the CRM contact forms on
-- 2026-08-09 (59e285d3) because the client dropdown is the company. But
-- `c.company` is READ in at least twelve places across five routers — Vikray
-- orders, the Vikray customers rollup, Ganit's invoice list, the invoice
-- detail, the invoice PDF, Documents, Dristi's rollup, and Graha's own list and
-- search. Patching each read with `COALESCE(cl.name, c.company)` and a join is
-- twelve chances to miss one, and the thirteenth reader written next month
-- would be wrong from birth.
--
-- So the column keeps its meaning — "the company this contact belongs to, as
-- text, ready to print" — and stops being something a human types. Every
-- existing read stays correct with no change at all.
--
-- Two triggers, because the value can go stale from either side:
--   · a contact is created or its client_id changes → copy the client's name
--   · a client is renamed → rewrite every contact pointing at it
--
-- Contacts with no client keep whatever text they already had. That is
-- deliberate: rows created before the change carry a real company name that
-- nothing else records, and blanking them would destroy data to enforce a rule
-- introduced afterwards.
--
-- APPLIED 2026-08-09. Counted first: ONE contact was out of step with its
-- client and was rewritten; 112 contacts have no client and KEPT their existing
-- company text, which is the point of the WHERE clause on the backfill.

BEGIN;

CREATE OR REPLACE FUNCTION staging.graha_contact_company_from_client()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.client_id IS NOT NULL THEN
        SELECT name INTO NEW.company
        FROM staging.graha_clients
        WHERE id = NEW.client_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_company_from_client ON staging.graha_contacts;
CREATE TRIGGER trg_contact_company_from_client
    BEFORE INSERT OR UPDATE OF client_id ON staging.graha_contacts
    FOR EACH ROW
    EXECUTE FUNCTION staging.graha_contact_company_from_client();


CREATE OR REPLACE FUNCTION staging.graha_client_rename_cascades()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
        UPDATE staging.graha_contacts
           SET company = NEW.name
         WHERE client_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_rename_cascades ON staging.graha_clients;
CREATE TRIGGER trg_client_rename_cascades
    AFTER UPDATE OF name ON staging.graha_clients
    FOR EACH ROW
    EXECUTE FUNCTION staging.graha_client_rename_cascades();


-- Backfill. Only rows that HAVE a client — see the note above about not
-- blanking the ones that do not.
UPDATE staging.graha_contacts c
   SET company = cl.name
  FROM staging.graha_clients cl
 WHERE cl.id = c.client_id
   AND c.company IS DISTINCT FROM cl.name;

COMMIT;
