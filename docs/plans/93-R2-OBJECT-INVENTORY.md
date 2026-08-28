# Proposal 93 · R2 · the R2 object inventory, captured before any delete

Measured 2026-08-28 against Supabase `toacecaewujfxjfrjwco`, read-only.

§5 sets the one ordering rule that cannot be undone: **the key inventory must be
captured before R4 deletes the rows.** After the delete the references are gone
and the objects become orphans — paid for, unreachable, unattributable. This file
is that capture.

It also corrects §5 in three places. Each correction came from a live query.

---

## ⚠ Correction 1 — Aekam Inc is NOT isolated from the whole wipe

§5 concludes that because each main org has its own bucket in its own Cloudflare
account, "Aekam Inc is positively isolated… a physical separation". **That is
true for Unicode and UK AekamINC and false for E2E.**

Live, from `staging.organisations`:

| Org | `r2_bucket_name` | credentials | Bucket actually used |
|---|---|---|---|
| Unicode Group | `kartavya-storage` | own key + secret | its own, own account |
| UK AekamINC | `kartavya-storage` | own key + secret | its own, own account |
| **E2E Test & Associates** | **NULL** | **none** | **the platform bucket** |
| Aekam Inc | NULL | none | **the platform bucket** |
| Demo - Kartavaya | NULL | none | the platform bucket |

The platform bucket is `R2_BUCKET_NAME=aekaminc` with `R2_PREFIX=staging/`,
read from the running staging service.

**So E2E — one of the three orgs being wiped — shares a bucket with Aekam Inc,
the org that must not be touched.** Confirmed by key shape rather than inferred:

    E2E      staging/e2e/sign-doc-35.pdf          <- platform bucket, staging/ prefix
    Unicode  pahchan/<org_id>/reference/<uuid>    <- own bucket, no prefix, root

Two genuinely different key shapes, which independently corroborates two
different buckets.

**Consequence:** the key-list method is not merely preferable for E2E, it is
mandatory. A prefix-level delete in the platform bucket is the catastrophic case
§5 believed it had designed away.

## ⚠ Correction 2 — "E2E has no R2" is wrong

§5's org table records E2E as `R2: no` and skips the file suites there "by
design". E2E has **51 real `sign_documents.file_key` objects**. It has no bucket
*configuration*, which is not the same as having no files: with no bucket of its
own it falls through to the platform bucket, and it has been writing there.

## ⚠ Correction 3 — §5's table list is incomplete, and empty strings are not keys

Two separate problems, and the second nearly produced a wrong inventory in this
very file.

**Columns §5 does not name but which carry object keys** (from
`information_schema`, both product schemas):

    staging.pahchan_punches.photo_key            staging.pahchan_regularisations.evidence_key
    staging.manav_candidates.resume_key          staging.hub_content_items.image_key
    staging.client_engagements.handover_manifest_key
    staging.client_engagement_predecessor_comms.proof_file_key
    staging.hub_scraper_runs.results_r2_key      staging.organisations.logo_key
    staging.ganit_contracts.file_key             public.message_attachments.r2_key
    staging.sign_documents.{file_key, signed_file_key, certificate_file_key}

⚠ **`manav_assets` — named in §5 — has no key or file column at all.** Not
asserted as missing beyond that: the statement is that no column in
`information_schema` for that table matches any file/key/url pattern, so §5's
claim that it holds R2 keys needs re-checking before the sweep is written.

⚠ **Several tables carry only a `*_url` and no `*_key`** —
`samvada_message_attachments.file_url`, `ganit_vendor_bills.attachment_url`,
`ganit_expenses.receipt_urls` (array), `manav_expense_claims.receipt_urls`
(jsonb), `crm_invoices.pdf_url`, `ganit_invoices.pdf_url`. Their object keys can
only be recovered by parsing the public URL prefix off the stored value. §5 does
not mention this and it is real work the sweep needs.

⚠ **EMPTY STRING IS NOT NULL, and it inflated the first count in this file by
~3×.** `file_key IS NOT NULL` counts rows holding `''`. The first pass reported
E2E at 211 objects and Unicode at 89; filtering on
`nullif(btrim(col),'') IS NOT NULL` gives the real figures below. A sweep written
from the naive predicate would have gone looking for ~150 objects that do not
exist, and — worse — would have reported them as "deleted".

---

## The inventory — real objects, per org

`nullif(btrim(col),'') is not null`, 2026-08-28:

| Source column | Unicode | E2E | UK AekamINC |
|---|---:|---:|---:|
| `sign_documents.file_key` | 7 | **51** | 0 |
| `hub_content_items.image_key` | 40 | 0 | 0 |
| `pahchan_enrollment_photos.object_key` | 24 | 0 | 0 |
| `graha_documents.file_key` | 2 | 0 | 0 |
| `manav_candidates.resume_key` | 0 | 0 | 0 |
| `organisations.logo_key` | 0 | 0 | 0 |
| **Total** | **73** | **51** | **0** |

Notes on the zeroes, since a zero is the easiest thing to misread:

- **`pahchan_punches.photo_key` is 0 for all three orgs.** Not a measurement
  failure — the 960 test punches were deleted on 2026-08-23 (OWNER-ACTIONS 6).
  §5's "~270 objects carry an uploaded image" is the *target after reseeding*,
  not current state.
- **`organisations.logo_key` is 0 everywhere**: every org stores `''`. No org
  logo objects exist at all today.
- **UK AekamINC has zero objects** despite holding a configured bucket and
  credentials. Consistent with an org created 2026-08-23. Its bucket is
  provisioned and empty, which is exactly what makes it the brand-new-org lane.

## What R4 must therefore honour

1. **Three buckets, not one.** Unicode's own; UK's own; the platform bucket for
   E2E. Different credentials for each — Unicode and UK carry their own
   `r2_access_key_id`/`r2_secret_access_key` on the org row.
2. **Subtract the protected set's keys.** The 20 protected tasks live in Unicode
   and **11 carry attachments** (`public.tasks.attachments`, jsonb). Those keys
   sit in Unicode's bucket and must be excluded by set arithmetic, not by care.
3. **Never a prefix delete in the platform bucket.** Aekam Inc's objects and
   E2E's objects share it, both under `staging/`.
4. **Re-run this inventory immediately before R4**, not from this file. These
   counts are a 2026-08-28 measurement and the whole point of §5's ordering rule
   is that the list must be current when the delete runs.
