-- 102_esign_document_source.sql
--
-- ── Why this column exists ───────────────────────────────────────────────────
--
-- A Ganit contract sent for signature emailed the signer a link to
-- `{FRONTEND_URL}/sign/{token}`. That URL is a frontend route (App.jsx:144)
-- served by SigningPage, and SigningPage asks `GET /api/v1/esign/verify/{token}`
-- — which reads `staging.sign_signers` JOIN `staging.sign_documents`.
--
-- The Ganit send path wrote its token to `staging.ganit_contract_signers`
-- instead: a second, private token namespace that no signer-reachable page has
-- ever read. Every signing link the Ganit path has ever produced resolved to
-- "Invalid signing link". Measured on this database, 2026-08-05:
--
--     staging.ganit_contract_signers        0 rows, ever
--     staging.ganit_contract_audit_trail    0 rows, ever
--     staging.sign_signers                101 rows, 44 signed
--     staging.sign_documents               75 rows, 28 completed,
--                                          6 executed PDFs, 12 certificates
--
-- The repair is to stop minting the second namespace: a contract sent for
-- signature now becomes a real e-sign document, so the link in the email
-- resolves to the page and the API that already own that URL — and the contract
-- inherits the executed PDF and the JSON audit certificate, which the parallel
-- subsystem never produced and had no code to produce.
--
-- That leaves one thing the schema could not express: which contract a document
-- came from. The firm-side views (`GET /contracts/{id}/signature-status`,
-- `/cancel-signature`, `/audit-trail`) need to find the document belonging to a
-- contract, and `sign_documents` had no way to say where it came from.
--
-- ── Why it is a PAIR of columns and not `ganit_contract_id` ──────────────────
--
-- Ganit is the first caller, not the only one: a Vikray quotation and a Manav
-- offer letter are the same shape of request — "sign this row's document" — and
-- each would otherwise add its own nullable FK to this table. `source_module` +
-- `source_id` is one index for all of them. It is deliberately NOT a foreign
-- key: the referent lives in a different module's table, and a document must
-- outlive the row that spawned it (a contract can be soft-deleted; the executed
-- PDF and its audit trail are evidence and must not cascade away).
--
-- ── Effect on existing rows ─────────────────────────────────────────────────
--
-- None. Both columns are nullable and every one of the 75 existing documents
-- was created directly in the e-Sign module, which is exactly what NULL means
-- here. Nothing is backfilled, because there is nothing to backfill: no Ganit
-- contract has ever produced a signature request that reached the database in a
-- form a signer could open.

ALTER TABLE staging.sign_documents
    ADD COLUMN IF NOT EXISTS source_module text,
    ADD COLUMN IF NOT EXISTS source_id     uuid;

COMMENT ON COLUMN staging.sign_documents.source_module IS
    'The module that asked for this signature, e.g. ''ganit_contract''. NULL '
    'means the document was created directly in the e-Sign module.';
COMMENT ON COLUMN staging.sign_documents.source_id IS
    'Primary key of the row in that module which this document signs. Not a '
    'foreign key: the executed PDF and its audit trail are evidence and must '
    'outlive the row that spawned them.';

-- The firm-side lookup is always "the document for THIS row", so the index is
-- on the pair. Partial, because every document created in the e-Sign module
-- itself carries NULL here and would otherwise sit in an index nothing queries.
CREATE INDEX IF NOT EXISTS sign_documents_source_idx
    ON staging.sign_documents (source_module, source_id)
    WHERE source_module IS NOT NULL;
