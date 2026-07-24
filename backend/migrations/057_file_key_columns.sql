-- Migration 057: Add file_key columns to all tables that store R2 files
-- Keys are permanent; signed URLs expire. Store the key, generate URLs on read.

-- graha_documents
ALTER TABLE staging.graha_documents
  ADD COLUMN IF NOT EXISTS file_key TEXT DEFAULT '';

-- ganit_contracts
ALTER TABLE staging.ganit_contracts
  ADD COLUMN IF NOT EXISTS file_key TEXT DEFAULT '';

-- manav_candidates
ALTER TABLE staging.manav_candidates
  ADD COLUMN IF NOT EXISTS resume_key TEXT DEFAULT '';

-- organisations (logo)
ALTER TABLE staging.organisations
  ADD COLUMN IF NOT EXISTS logo_key TEXT DEFAULT '';

-- Backfill: extract R2 key from existing signed URLs
-- Signed URL path format: /{bucket}/{key}?X-Amz-...
-- We strip the bucket prefix and query params to get the key

UPDATE staging.graha_documents
SET file_key = regexp_replace(
  split_part(file_url, '?', 1),
  '^https?://[^/]+/[^/]+/',
  ''
)
WHERE file_url IS NOT NULL AND file_url != '' AND file_key = ''
  AND file_url NOT LIKE 'data:%';

UPDATE staging.ganit_contracts
SET file_key = regexp_replace(
  split_part(file_url, '?', 1),
  '^https?://[^/]+/[^/]+/',
  ''
)
WHERE file_url IS NOT NULL AND file_url != '' AND file_key = ''
  AND file_url NOT LIKE 'data:%';

UPDATE staging.manav_candidates
SET resume_key = regexp_replace(
  split_part(resume_url, '?', 1),
  '^https?://[^/]+/[^/]+/',
  ''
)
WHERE resume_url IS NOT NULL AND resume_url != '' AND resume_key = ''
  AND resume_url NOT LIKE 'data:%';

UPDATE staging.organisations
SET logo_key = regexp_replace(
  split_part(logo_url, '?', 1),
  '^https?://[^/]+/[^/]+/',
  ''
)
WHERE logo_url IS NOT NULL AND logo_url != '' AND logo_key = ''
  AND logo_url NOT LIKE 'data:%';
