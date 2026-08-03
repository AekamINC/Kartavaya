-- 090_esign_signed_document.sql
--
-- The columns named `signed_file_*` on staging.sign_documents did not hold a
-- signed file. `esign._generate_signed_certificate` serialised the audit trail
-- to JSON, uploaded it as `certificate-<id>.json` with content type
-- application/json, and wrote THAT object's key and URL into them. The e-sign
-- module therefore never produced an executed document at all: the download the
-- UI offered as "Signing certificate" was a machine-readable blob, and the
-- counter-signed PDF — the product's entire deliverable — did not exist.
--
-- This migration gives the certificate columns of its own, moves the misfiled
-- rows into them, and leaves signed_file_* empty so it means what it says. The
-- signed PDF is then generated on completion (and on demand for documents
-- completed before this change) by services/esign_signed_doc.py.
--
-- Nothing is deleted. The certificate objects stay exactly where they are in
-- R2; only the column they are referenced from changes.

ALTER TABLE staging.sign_documents
    ADD COLUMN IF NOT EXISTS certificate_file_key  text,
    ADD COLUMN IF NOT EXISTS certificate_file_url  text,
    ADD COLUMN IF NOT EXISTS certificate_hash      text;

COMMENT ON COLUMN staging.sign_documents.signed_file_key IS
    'R2 key of the executed PDF: the original pages plus the signature page. '
    'signed_file_hash is the SHA-256 of THAT pdf, not of the certificate.';
COMMENT ON COLUMN staging.sign_documents.certificate_file_key IS
    'R2 key of the JSON audit certificate. Separate artefact, separate download.';

-- Move the misfiled certificates. Matched on the .json suffix and on the
-- certificates folder, so a correctly-generated signed PDF written by a newer
-- deploy is never touched, and the statement is safe to run twice.
UPDATE staging.sign_documents
   SET certificate_file_key = signed_file_key,
       certificate_file_url = signed_file_url,
       certificate_hash     = signed_file_hash,
       signed_file_key      = NULL,
       signed_file_url      = NULL,
       signed_file_hash     = NULL
 WHERE signed_file_key IS NOT NULL
   AND signed_file_key <> ''
   AND (signed_file_key LIKE '%.json' OR signed_file_key LIKE 'esign/certificates/%')
   AND certificate_file_key IS NULL;

-- After this runs, every completed document has signed_file_key IS NULL and the
-- executed PDF is generated on demand — see POST /esign/documents/{id}/rebuild.
