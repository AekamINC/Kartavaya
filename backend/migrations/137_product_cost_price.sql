-- A product knows what it cost, not only what it sells for.
--
-- Owner, 2026-08-09: "products need cost price, sale price and margin — money
-- and percentage per product — so actual profit per deal/order and total
-- turnover are known."
--
-- `ganit_products.price` is the SALE price and is the only money on the row.
-- With no cost, nothing in the product can answer "did we make anything on
-- that", which is the question behind every one of those figures.
--
-- ── MARGIN IS DERIVED, NOT STORED ───────────────────────────────────────────
--
-- Deliberately. A stored margin is a third number that can disagree with the
-- two it comes from, and it would disagree the first time somebody edits a
-- price without recomputing it. `margin` and `margin_pct` are generated
-- columns: the database computes them and they cannot drift.
--
-- `margin_pct` divides by NULLIF(price, 0) so a free item is NULL rather than a
-- division error — and NULL is the honest answer to "what percentage of nothing
-- is the margin".
--
-- ── COST DEFAULTS TO NULL, NOT TO ZERO ──────────────────────────────────────
--
-- Zero cost means "this costs us nothing", which for 100% of existing rows is a
-- claim nobody made — and it would render every product as pure profit on the
-- first screen that shows margin. NULL means "not recorded yet", the margin is
-- NULL with it, and the UI shows a dash. A figure that is unknown must look
-- unknown.

BEGIN;

ALTER TABLE staging.ganit_products
    ADD COLUMN IF NOT EXISTS cost_price DECIMAL(12,2);

COMMENT ON COLUMN staging.ganit_products.cost_price IS
    'What this costs US, per unit, excluding GST. NULL means not recorded — '
    'never 0, which would claim the item is free and make every margin 100%.';

COMMENT ON COLUMN staging.ganit_products.price IS
    'The SALE price, per unit, excluding GST. See cost_price for the other half.';

ALTER TABLE staging.ganit_products
    ADD COLUMN IF NOT EXISTS margin DECIMAL(12,2)
    GENERATED ALWAYS AS (price - cost_price) STORED;

ALTER TABLE staging.ganit_products
    ADD COLUMN IF NOT EXISTS margin_pct DECIMAL(6,2)
    GENERATED ALWAYS AS (
        ROUND(((price - cost_price) / NULLIF(price, 0)) * 100, 2)
    ) STORED;

COMMENT ON COLUMN staging.ganit_products.margin IS
    'Generated: price - cost_price. NULL until a cost is recorded.';
COMMENT ON COLUMN staging.ganit_products.margin_pct IS
    'Generated: margin as a percentage of the SALE price. NULL for a free item.';

COMMIT;
