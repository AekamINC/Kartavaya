-- 227 · Varta rate card — what Meta charges an ORGANISATION per WhatsApp
--       message, seeded with ESTIMATE figures (Phase 0.27).
--
-- ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
--
-- `analytics/metrics/varta.py` declares `varta.cost_per_conversation` ABSENT
-- with this reason, verified 2026-08-18: "No cost or pricing column exists on
-- varta_messages, varta_conversations or varta_business_accounts". That is
-- still true — a live catalogue read on 2026-08-27 found no table anywhere in
-- `staging` matching '%rate_card%' except `vendor_rate_cards` (5 rows, Ganit's
-- supplier rates, an unrelated thing that happens to share a noun).
--
-- Owner decision 0.27, 2026-08-26: *"do an e2e seed with estimate data."*
-- Meta's own INR rate card sits behind a Business Manager login this seat does
-- not sign into, so the numbers below are read from public secondary sources
-- and are GUESSES. The whole design of this table is built around that one
-- fact: **a guess about what a customer is charged must say it is a guess,
-- everywhere, without anybody remembering to add the caveat.**
--
-- ── WHOSE MONEY THIS IS ──────────────────────────────────────────────────────
--
-- Not Aekam's. Decision 0.18 ("any third-party connection cost — Meta, SES, a
-- scraper — is borne by the organisation itself, not resold") and the P7
-- approval ("the WABA is the org's, so Meta bills the org, not Aekam; sell the
-- automation, never the messages") both say the same thing. So:
--
--   · `billed_by`  is 'meta'          — Meta issues the bill.
--   · `billed_to`  is 'organisation'  — the customer's own WABA is billed.
--
-- Both are CHECKed to a single legal value on purpose. The day somebody wants
-- to resell messages they must write a migration that widens the CHECK, and
-- that migration is a decision with a name on it — which is exactly the point.
-- There is deliberately **no margin column and no Aekam-price column**: a
-- margin field on this table would be a schema that quietly contradicts 0.18.
--
-- ── HOW "ESTIMATE" IS CARRIED, AND WHY IT CANNOT BE LOST ─────────────────────
--
-- Not a comment. Not a convention. Four columns and three CHECKs:
--
--   1. `rate_basis`  NOT NULL DEFAULT 'estimate'. The default points at the
--      SAFE value — a row inserted by somebody who did not think about it is
--      stamped a guess, not a fact. The unsafe value has to be typed.
--   2. `estimate_note` must be non-empty whenever `rate_basis = 'estimate'`
--      (`varta_rate_card_estimate_note_ck`). An estimate row physically cannot
--      exist without a human sentence saying so.
--   3. `source_url` and `source_read_on` are NOT NULL with **no default**. A
--      figure with no citation and no read-date cannot be inserted at all.
--   4. `varta_rate_card_meta_source_ck`: you may only claim
--      `rate_basis='meta_rate_card'` while citing a Meta-owned host. A blog
--      post cannot be promoted to "Meta's card" by editing one column.
--
-- The API contract that rides on top: `routers/whatsapp.py::rate_card` returns
-- `is_estimate` on EVERY row and refuses to serve a row it cannot stamp; the
-- Pricing surface renders an "Estimate" chip per row plus a banner. Tests in
-- `backend/tests/test_varta_rate_card.py` execute this file's SQL and assert
-- all four mechanisms above against the real schema.
--
-- ── WHAT THE FIGURES ARE, AND HOW GOOD THEY ARE ──────────────────────────────
--
-- Meta moved WhatsApp from PER-CONVERSATION to PER-MESSAGE billing on
-- 1 July 2025, so "per-conversation pricing" no longer exists as a thing to
-- seed; `pricing_model` records which model a row describes and every seeded
-- row says 'per_message'. Service messages have been free since 1 Nov 2024.
-- India moved to INR billing on 1 Jan 2026 and the marketing rate rose ~10%
-- (₹0.7846 → ₹0.8631) on the same date.
--   Source: developers.facebook.com/documentation/business-messaging/whatsapp/pricing
--   Read 2026-08-27.
--
-- Three independent secondary sources agree on marketing ₹0.8631 and
-- utility/authentication ₹0.115 (whautomate.com, richautomate.in, blueticks.co
-- — all read 2026-08-27). **One source disagrees**: aisensy.com quotes ₹1.09
-- marketing and ₹0.145 utility/auth for the same date, which is most likely a
-- BSP list price with a reseller markup folded in rather than Meta's base rate.
-- That disagreement is recorded in `notes` on the affected rows and is by
-- itself sufficient reason to distrust every number here until 0.26 lands.
--
-- The weakest figure is `authentication_international` — richautomate.in says
-- ₹2.30, whautomate.com says ~$0.035 (≈₹3.0). Its note says so.
--
-- ── RISK ─────────────────────────────────────────────────────────────────────
--
-- LOW, and additive only.
--   · One CREATE TABLE of a relation that does not exist (catalogue read
--     2026-08-27). No ALTER of any existing table, so no ACCESS EXCLUSIVE lock
--     on anything a request touches, no rewrite, nothing scanned.
--   · Five INSERTs into that brand-new table. **This is the only write-path
--     side effect and it lands in the shared staging schema, which production
--     also reads** — so the rows must be, and are, stamped `estimate` before
--     any surface can reach them. Deploy order below exists for that reason.
--   · One FK to `staging.organisations` on a NULLABLE column. It takes
--     ShareRowExclusiveLock on `organisations` (read on nearly every request)
--     for a catalogue update at ~5 rows — microseconds of work, but it queues
--     behind any open long transaction. `lock_timeout` makes that a clean
--     rollback rather than a product-wide stall (096 hit this).
--   · Reversal is `DROP TABLE staging.varta_rate_card;` — the table is new, so
--     nothing else's data is at stake.
--
-- ── DEPLOY ORDER ─────────────────────────────────────────────────────────────
--
--   1. THIS MIGRATION FIRST. `routers/whatsapp.py` SELECTs from the table; if
--      the router deploys first, `GET /v1/whatsapp/rate-card` 500s on every
--      call (42P01) — the exact failure PHASE-6 documents twice.
--   2. Backend deploy.
--   3. Frontend deploy. The Pricing sub-tab is additive; before it lands the
--      endpoint is simply unused.
--
-- ── NUMBERING ───────────────────────────────────────────────────────────────
--
-- Authored as 224. Renumbered to 227 on the day it was written, because a
-- peer session was holding an UNTRACKED `224_professional_tax_states.sql`
-- that `git ls-files` could not see and `ls` had not yet shown, and `226`
-- had since appeared as well. Taken above the maximum on disk rather than
-- filling the 225 hole, so a peer who is mid-write on 225 cannot collide.
--
-- ⚠ The Supabase migration ledger recorded the DDL half under the name
-- `224_varta_rate_card` (it was applied before the collision was found).
-- The ledger name and this filename therefore differ. The DATABASE is
-- correct either way — verify from the catalogue, never from a ledger.
--
-- Shared DB: staging + production both write to the `staging` schema.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS staging.varta_rate_card (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- NULL = a SHARED, platform-wide row every org resolves — the same shape
    -- the professional-tax ladder was moved to on 2026-08-26, and for the same
    -- reason: Meta's published India price is one national fact, not 5 copies.
    -- A non-NULL org_id is the escape hatch for an org that has negotiated its
    -- own contracted rate with Meta; nothing seeds one here.
    org_id              UUID REFERENCES staging.organisations(id),

    country_code        TEXT NOT NULL,          -- ISO 3166-1 alpha-2, e.g. 'IN'
    currency            TEXT NOT NULL,          -- ISO 4217, e.g. 'INR'

    -- Meta's four billable categories plus the international-authentication
    -- split, which is priced separately and is the one people forget.
    category            TEXT NOT NULL
        CHECK (category IN ('marketing', 'utility', 'authentication',
                            'authentication_international', 'service')),

    -- What one DELIVERED message of this category costs, in `currency`.
    -- NUMERIC(12,4): Meta publishes India rates to four decimals (0.8631).
    rate_per_message    NUMERIC(12,4) NOT NULL CHECK (rate_per_message >= 0),

    -- Which billing model this row describes. Meta left 'per_conversation'
    -- behind on 1 Jul 2025; the value stays legal so an archived pre-July-2025
    -- row can be recorded truthfully rather than restated as something it was
    -- not.
    pricing_model       TEXT NOT NULL DEFAULT 'per_message'
        CHECK (pricing_model IN ('per_message', 'per_conversation')),

    -- The two windows in which Meta waives the charge. Per-category because
    -- they genuinely differ: a utility template inside the 24-hour customer
    -- service window is free, a marketing one is not. The window LENGTHS are
    -- not duplicated onto every row — they live in
    -- `services/skills/data/wip_and_quotes.py` (CTWA_FREE_WINDOW_HOURS = 72,
    -- with CTWA_POLICY_AS_OF beside it), which is already the one place that
    -- prints them with the date they were believed true.
    free_in_service_window      BOOLEAN NOT NULL DEFAULT FALSE,
    free_in_entry_point_window  BOOLEAN NOT NULL DEFAULT FALSE,

    -- ★ THE STAMP. Default is the SAFE value: an unconsidered row is a guess.
    rate_basis          TEXT NOT NULL DEFAULT 'estimate'
        CHECK (rate_basis IN ('estimate', 'meta_rate_card')),

    -- Why this row is a guess, in a sentence a customer could read. Required
    -- (non-empty) whenever rate_basis = 'estimate'.
    estimate_note       TEXT NOT NULL DEFAULT '',

    -- Where the figure came from and when it was read. NOT NULL, NO DEFAULT —
    -- an uncited number cannot be inserted.
    source_url          TEXT NOT NULL,
    source_read_on      DATE NOT NULL,

    -- Whose money. See the header: Meta bills the org, Aekam resells nothing.
    billed_by           TEXT NOT NULL DEFAULT 'meta'
        CHECK (billed_by IN ('meta')),
    billed_to           TEXT NOT NULL DEFAULT 'organisation'
        CHECK (billed_to IN ('organisation')),

    effective_from      DATE NOT NULL,
    effective_to        DATE,

    notes               TEXT NOT NULL DEFAULT '',

    -- TEXT, not uuid — `public.users.user_id` is `user_xxxxxxxx`. 030, 092,
    -- 097, 201, 202 and 203 are six scars from getting this wrong.
    created_by          TEXT,
    updated_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── The honesty constraints ─────────────────────────────────────────────────
-- Added by name via DO blocks rather than inline on the CREATE, because an
-- inline CHECK on a `CREATE TABLE IF NOT EXISTS` whose table already exists is
-- skipped WHOLE and leaves no trace — the same trap `ADD COLUMN IF NOT EXISTS`
-- sets, documented in migration 201. `pg_constraint` is the only evidence.

DO $$
BEGIN
    -- 1. An estimate must say, in words, that it is one.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'varta_rate_card_estimate_note_ck') THEN
        ALTER TABLE staging.varta_rate_card
            ADD CONSTRAINT varta_rate_card_estimate_note_ck
            CHECK (rate_basis <> 'estimate' OR btrim(estimate_note) <> '');
    END IF;

    -- 2. Only a Meta-owned host may back a 'meta_rate_card' claim. This is the
    --    constraint that stops 0.27's estimate being laundered into 0.26's
    --    real card by an UPDATE to one column.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'varta_rate_card_meta_source_ck') THEN
        ALTER TABLE staging.varta_rate_card
            ADD CONSTRAINT varta_rate_card_meta_source_ck
            CHECK (
                rate_basis <> 'meta_rate_card'
                OR source_url LIKE 'https://developers.facebook.com/%'
                OR source_url LIKE 'https://business.facebook.com/%'
                OR source_url LIKE 'https://business.whatsapp.com/%'
                OR source_url LIKE 'https://www.facebook.com/business/%'
            );
    END IF;

    -- 3. A citation is not a citation without a URL.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'varta_rate_card_source_url_ck') THEN
        ALTER TABLE staging.varta_rate_card
            ADD CONSTRAINT varta_rate_card_source_url_ck
            CHECK (btrim(source_url) <> '');
    END IF;

    -- 4. A period that ends before it starts is a typo, not a rate.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'varta_rate_card_effective_ck') THEN
        ALTER TABLE staging.varta_rate_card
            ADD CONSTRAINT varta_rate_card_effective_ck
            CHECK (effective_to IS NULL OR effective_to > effective_from);
    END IF;
END $$;

-- One rate per category per start-date, per scope. Two partial indexes rather
-- than one UNIQUE, because NULL org_id is a MEANINGFUL value here ("shared")
-- and a plain UNIQUE would let five duplicate shared rows coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_varta_rate_card_shared
    ON staging.varta_rate_card (country_code, currency, category, effective_from)
    WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_varta_rate_card_org
    ON staging.varta_rate_card (org_id, country_code, currency, category, effective_from)
    WHERE org_id IS NOT NULL;

-- The resolution query is "the row in force for this org, country and category
-- on this date"; org_id leads because the org override is checked first.
CREATE INDEX IF NOT EXISTS idx_varta_rate_card_lookup
    ON staging.varta_rate_card (country_code, currency, effective_from DESC);

COMMENT ON TABLE staging.varta_rate_card IS
    'What Meta charges an ORGANISATION per delivered WhatsApp message. Never '
    'Aekam revenue: Meta bills the customer''s own WABA directly (decision '
    '0.18, P7). Rows with rate_basis=''estimate'' are GUESSES read from public '
    'secondary sources and must be labelled as estimates on every surface that '
    'renders them. org_id NULL = shared national row.';
COMMENT ON COLUMN staging.varta_rate_card.rate_basis IS
    'estimate = a guess from a public source; meta_rate_card = taken from '
    'Meta''s own published card (constrained to a Meta-owned source_url). '
    'Defaults to ''estimate'' deliberately — the safe value is the default.';
COMMENT ON COLUMN staging.varta_rate_card.estimate_note IS
    'Required non-empty when rate_basis=''estimate''. The sentence a surface '
    'shows beside the number.';
COMMENT ON COLUMN staging.varta_rate_card.billed_to IS
    'Always ''organisation''. Meta bills the org''s own WABA; Kartavaya does '
    'not resell WhatsApp messages and holds no margin on them.';

-- ── Seed: India, INR, effective 1 Jan 2026 (the INR-billing changeover) ──────
--
-- ON CONFLICT DO NOTHING against `uq_varta_rate_card_shared` so a replay is a
-- no-op and so this file never overwrites a real card somebody has since
-- entered for the same (IN, INR, category, 2026-01-01) key.

INSERT INTO staging.varta_rate_card (
    org_id, country_code, currency, category, rate_per_message, pricing_model,
    free_in_service_window, free_in_entry_point_window,
    rate_basis, estimate_note, source_url, source_read_on,
    effective_from, notes, created_by
) VALUES

-- MARKETING — the one that costs real money, and the one that moved.
(NULL, 'IN', 'INR', 'marketing', 0.8631, 'per_message',
 FALSE, TRUE,
 'estimate',
 'ESTIMATE — not Meta''s own rate card. Meta''s INR card is behind a Business '
 'Manager login. ₹0.8631 is what three independent public sources report for '
 'India from 1 Jan 2026; a fourth reports ₹1.09. Do not quote this to a '
 'customer as fact.',
 'https://whautomate.com/whatsapp-business-api-pricing-india', DATE '2026-08-27',
 DATE '2026-01-01',
 'Corroborated by richautomate.in and blueticks.co (both read 2026-08-27), '
 'each reporting a ~10% rise from ₹0.7846 on 1 Jan 2026. DISAGREEMENT: '
 'aisensy.com reports ₹1.09 for the same date — probably a BSP list price '
 'including reseller markup, not Meta''s base rate. Marketing has no volume '
 'tiers. 18% GST applies on top and is NOT included here.',
 'migration:227'),

-- UTILITY — free inside the 24-hour customer service window, charged outside.
(NULL, 'IN', 'INR', 'utility', 0.1150, 'per_message',
 TRUE, TRUE,
 'estimate',
 'ESTIMATE — not Meta''s own rate card. ₹0.115 is what three independent '
 'public sources report for India. A fourth reports ₹0.145. Free when '
 'delivered inside an open 24-hour customer service window.',
 'https://richautomate.in/blog/meta-whatsapp-per-template-pricing-2026-india-explained',
 DATE '2026-08-27', DATE '2026-01-01',
 'Corroborated by whautomate.com and blueticks.co (both read 2026-08-27). '
 'DISAGREEMENT: aisensy.com reports ₹0.145. Meta introduced volume tiers for '
 'utility and authentication on 1 Jul 2025; no tier is modelled here, so this '
 'is the un-tiered rate and a high-volume org would pay less. 18% GST on top.',
 'migration:227'),

-- AUTHENTICATION — domestic OTPs.
(NULL, 'IN', 'INR', 'authentication', 0.1150, 'per_message',
 FALSE, TRUE,
 'estimate',
 'ESTIMATE — not Meta''s own rate card. ₹0.115 is what three independent '
 'public sources report for domestic India authentication. A fourth reports '
 '₹0.145.',
 'https://richautomate.in/blog/meta-whatsapp-per-template-pricing-2026-india-explained',
 DATE '2026-08-27', DATE '2026-01-01',
 'free_in_service_window is FALSE on purpose and is itself uncertain: Meta''s '
 'own pricing page can be read as making authentication free inside the '
 'customer service window, while the secondary sources extend that waiver only '
 'to utility. FALSE is the conservative reading — it assumes you pay. Volume '
 'tiers exist and are not modelled. 18% GST on top.',
 'migration:227'),

-- AUTHENTICATION-INTERNATIONAL — the separately-priced tier people forget.
-- The weakest figure in this table and its note says so.
(NULL, 'IN', 'INR', 'authentication_international', 2.3000, 'per_message',
 FALSE, TRUE,
 'estimate',
 'ESTIMATE, AND THE LEAST RELIABLE ROW HERE — two public sources disagree by '
 'about 30%: ₹2.30 (richautomate.in) against ~$0.035 ≈ ₹3.00 '
 '(whautomate.com). Treat as an order of magnitude, not a price.',
 'https://richautomate.in/blog/meta-whatsapp-per-template-pricing-2026-india-explained',
 DATE '2026-08-27', DATE '2026-01-01',
 'Applies to authentication templates delivered to non-India numbers from an '
 'India-billed WABA. Neither source states the destination-country breakdown, '
 'which Meta prices per corridor — so a single number for "international" is '
 'itself a simplification. 18% GST on top.',
 'migration:227'),

-- SERVICE — free since 1 Nov 2024, and this one IS from Meta's own page.
-- It is still stamped an estimate, because the row it sits beside is: a table
-- where four rows are guesses and one is not needs the reader to check which,
-- and "free" is the only figure here where being wrong costs nothing.
(NULL, 'IN', 'INR', 'service', 0.0000, 'per_message',
 TRUE, TRUE,
 'estimate',
 'ESTIMATE — seeded alongside four guessed rows and not verified against '
 'Meta''s INR card. Meta''s public pricing page does state that service '
 'messages have been free for all businesses since 1 November 2024.',
 'https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing',
 DATE '2026-08-27', DATE '2026-01-01',
 'Free-form (non-template) replies sent inside an open 24-hour customer '
 'service window. Free with no monthly cap. This is the row the free-entry-'
 'point flow lands in: a Click-to-WhatsApp arrival opens a 72-hour window in '
 'which every category is free — see CTWA_FREE_WINDOW_HOURS in '
 'services/skills/data/wip_and_quotes.py.',
 'migration:227')

ON CONFLICT DO NOTHING;

COMMIT;

-- ── VERIFY FROM THE LIVE CATALOGUE, NOT FROM THIS FILE ───────────────────────
--
--   -- the four honesty constraints must all be present:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'staging.varta_rate_card'::regclass ORDER BY conname;
--
--   -- every row must be stamped, cited and dated:
--   SELECT category, rate_per_message, rate_basis,
--          btrim(estimate_note) <> '' AS has_note,
--          source_url, source_read_on, billed_by, billed_to
--     FROM staging.varta_rate_card ORDER BY category;
--
--   -- and this must return ZERO rows, forever:
--   SELECT id FROM staging.varta_rate_card
--    WHERE rate_basis = 'estimate' AND btrim(estimate_note) = '';
