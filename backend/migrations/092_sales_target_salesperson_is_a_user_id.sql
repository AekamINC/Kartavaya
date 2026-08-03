-- 092_sales_target_salesperson_is_a_user_id.sql
--
-- A sales target could never be saved by anyone, in any org.
--
-- `staging.vikray_targets.salesperson_id` is a **uuid** column. The Targets tab
-- fills its picker from `GET /v1/org/members` and stores `p.user_id` — and a
-- user id in this product is TEXT of the form `user_549c9cac35aa`, because
-- `public.users.user_id` is text. Casting that to uuid throws, so the insert
-- 500'd on every attempt. The screen said "Could not save the target" and
-- nothing else: the browser sees a 500 with no CORS headers, so there is no
-- response body to report. Same failure signature as the bank-statement import
-- (migration 090's sibling, fixed in 2b864aa8).
--
-- The read paths already knew the answer. Both `vikray.list_targets` and
-- `dristi` join with `LEFT JOIN users u ON u.user_id = t.salesperson_id::text`
-- — casting a uuid to text to match a text user id, which can never match. So
-- the salesperson column on the targets table has always rendered blank:
-- measured on live data, **20 targets, 0 attached to a real person.**
--
-- The column becomes text, which is what it always needed to be.
--
-- Existing values are uuids that correspond to no user (the seed invented
-- them), so `::text` preserves them exactly and loses nothing that meant
-- anything. The UNIQUE (org_id, salesperson_id, period_start) constraint
-- survives a type change and is rebuilt automatically.

ALTER TABLE staging.vikray_targets
    ALTER COLUMN salesperson_id TYPE text USING salesperson_id::text;

COMMENT ON COLUMN staging.vikray_targets.salesperson_id IS
    'public.users.user_id — TEXT, of the form user_xxxxxxxx. Not a uuid: the '
    'org-members picker that fills it hands back user_id, and users.user_id is text.';

-- NOTE, deliberately NOT changed here: `staging.graha_deals.owner_id` is also a
-- uuid and has the same mismatch. It is left alone because nothing in the
-- codebase writes it — deal ownership is not an implemented feature, so there
-- is no broken user flow to repair and no data to migrate (measured: 0 deals
-- carry an owner). Changing it now would be a schema change made on a guess
-- about a feature that does not exist yet. When deal ownership is built, this
-- column needs the same treatment and `vikray.list_targets` /
-- `dristi.sales_analytics` compare it against salesperson_id, so both will
-- need `owner_id::text`.
