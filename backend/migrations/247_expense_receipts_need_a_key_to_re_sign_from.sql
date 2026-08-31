-- 247 · `ganit_expenses.receipt_keys` — the sibling that makes a receipt outlive
--        the nine hours its presigned URL is good for.
--
-- ── The gap, quoted from the code that documents it ─────────────────────────
--
-- `routers/ganit.py:229` has said this since migration 019:
--
--     There is no `receipt_keys` beside this and none is invented here.
--     `ganit_expenses.receipt_urls` (019) has no key sibling … so a receipt
--     filed through `POST /api/upload` keeps only the presigned URL that upload
--     answered with, the one that expires in nine hours, and `list_expenses`
--     has nothing to re-sign from.
--
-- `services/storage.py:705` already carries `sign_key(org_id, key)`, and every
-- other attachment surface in the product keeps the key beside the url for
-- exactly this reason — `FilesField` says so at length, having been fixed for
-- it. Expenses is one of the three that never got the column.
--
-- ── Why this is safe, measured rather than assumed ──────────────────────────
--
--     SELECT count(*) FROM public.ganit_expenses;                        30
--     SELECT count(*) FROM public.ganit_expenses
--      WHERE receipt_urls IS NOT NULL
--        AND array_length(receipt_urls,1) > 0;                            0
--
-- NOT ONE EXPENSE IN THE PRODUCT HOLDS A FILE. So there is no content to
-- migrate and no dead link to repair — this adds the column before the first
-- receipt is filed rather than after. That is the whole reason to do it now:
-- the same fix a week from now is a fix plus a set of unrecoverable urls.
--
-- ⚠ AND THE KEY IS NEVER SCRAPED OUT OF A URL. The existing note forbids it in
-- terms — "these boxes also take hand-typed links to somewhere that is not our
-- bucket" — so `receipt_keys[i]` is written only by the uploader that knows the
-- key, and an entry with no key stays exactly as readable as it is today.
--
-- ── Scope ───────────────────────────────────────────────────────────────────
--
-- ONE table, because one is what gets wired end to end in the same change.
-- `ganit_vendor_bills.attachment_url` (035) and `manav_expense_claims`
-- `.receipt_urls` (034) have the identical gap and are deliberately NOT touched
-- here: a column nothing reads is the "config file that serves nothing" this
-- repo already refuses to leave lying around. Both hold zero files today, so
-- neither is losing anything while it waits.
--
-- ── Reversal ────────────────────────────────────────────────────────────────
--
--     ALTER TABLE public.ganit_expenses DROP COLUMN receipt_keys;
--
-- Additive, defaulted, and read by nothing that predates this change, so a
-- rollback of the code alone leaves the column harmlessly unread.

BEGIN;

ALTER TABLE public.ganit_expenses
  ADD COLUMN IF NOT EXISTS receipt_keys TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ganit_expenses.receipt_keys IS
  'R2 object keys parallel to receipt_urls, so a presigned url can be re-signed '
  'once it expires. Written only by the uploader that knows the key; never '
  'derived from a url, because a url here may point outside our bucket.';

COMMIT;
