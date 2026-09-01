-- 250 · The duplicate-detector was reported broken and was telling the truth.
--
-- Migration 249 rewrote every stored contact to the owner's
-- `kevalvshah03+<tag>@gmail.com` alias so mail could actually be delivered. It
-- could not rewrite the THREE duplicate fixtures typed AFTER it ran, which kept
-- their `@example.com` addresses.
--
-- A duplicate fixture is a PAIR. Once the original held the gmail alias and the
-- duplicate held @example.com, the pair no longer shared an address, so
-- `GET /contacts/duplicates` correctly returned zero groups — and the report
-- blamed the product. The detector was right the whole time.
--
-- Applied directly on 2026-09-01 and recorded here so the repair is reproducible.
-- Idempotent: the WHERE clause matches nothing once it has run.
UPDATE public.graha_contacts c
   SET email = 'kevalvshah03+s04contact' || v.nn || '@gmail.com'
  FROM (VALUES ('08f1b66e-a1ec-4c0a-80db-6b11c176584f'::uuid, '01'),
               ('2846a07e-6c1e-43ef-8e2c-bd64d6ddaaf1'::uuid, '02'),
               ('b12d161d-d460-40eb-9197-3838a31db4a9'::uuid, '03')) AS v(id, nn)
 WHERE c.id = v.id
   AND c.org_id = 'fae87907-2f99-4b35-a241-c94d9e1e4a17'::uuid
   AND c.email LIKE '%@example.com';

-- `email_norm` is a GENERATED column and maintains itself. Never UPDATE it:
-- Postgres refuses with "can only be updated to DEFAULT".
