-- 091_srijan_content_images.sql
--
-- "I don't see any images on the portal which has been created."
-- Measured before the fix: 208 content items, 40 of them with a generated image,
-- and only 6 of those visible. Three separate defects, all of them here:
--
--  1. `quick_generate` — the route the Generate tab actually uses — charged 3
--     credits for an image, uploaded it, and then wrote the URL ONLY into
--     `metadata.images`. The content library reads the `image_url` COLUMN, so
--     34 paid-for images existed in storage and appeared nowhere. Fixed in
--     routers/hub.py; this migration recovers the 34 already written.
--
--  2. `image_url` stored a PRESIGNED R2 link with a nine-hour expiry, and only
--     the org-level list re-signed it on read. `/clients/{id}/content` and the
--     single-item read handed back the stored string, so every image was broken
--     by the next morning. Fixed by `hub.sign_content_images`, used by all three.
--
--  3. There was no key to re-sign FROM — only the expired URL, parsed by
--     `storage.refresh_signed_url`, which the storage module itself marks
--     deprecated for this reason. `image_key` is now stored at generation.

ALTER TABLE staging.hub_content_items
    ADD COLUMN IF NOT EXISTS image_key text;

COMMENT ON COLUMN staging.hub_content_items.image_key IS
    'R2 object key for image_url. image_url is a presigned link that expires in '
    '9 hours; this is what lets any read re-sign it. See hub.sign_content_images.';

-- (1) Recover the images that were generated, paid for, and never displayed.
-- Only where the column is empty and metadata carries a real http(s) URL, so a
-- correctly-written row is never overwritten and the statement is safe to rerun.
UPDATE staging.hub_content_items
   SET image_url = metadata->'images'->0->>'url'
 WHERE (image_url IS NULL OR image_url = '')
   AND jsonb_typeof(metadata->'images') = 'array'
   AND jsonb_array_length(metadata->'images') > 0
   AND metadata->'images'->0->>'url' LIKE 'http%';

-- (2) Backfill image_key by parsing the key out of the presigned URL, exactly as
-- storage.refresh_signed_url does: strip the scheme/host, drop the leading
-- bucket segment, drop the query string. Done once here so the deprecated
-- URL-parsing path is never needed again for these rows.
UPDATE staging.hub_content_items c
   SET image_key = regexp_replace(
         split_part(regexp_replace(c.image_url, '^https?://[^/]+/', ''), '?', 1),
         '^' || o.r2_bucket_name || '/', ''
       )
  FROM staging.organisations o
 WHERE o.id = c.org_id
   AND (c.image_key IS NULL OR c.image_key = '')
   AND c.image_url LIKE 'http%'
   AND o.r2_bucket_name IS NOT NULL;
