# Phase 1 — Open the six write-paths

**Effort:** ~1 week · **Blocks on:** nothing · **Runs parallel with:** Phase 2

## Why this is first

This is the **highest-fan-out item in the entire 50–88 arc.** Sixteen columns
that gate headline features are 100% NULL on the live database and have **no way
to enter them** — the schema, the API, the reports and the tests were all built,
and every one of them is inert because a form field is missing. Opening six of
those write-paths turns roughly **eighteen features back on** across proposals
73, 75, 76, 77 and 85:

per-person turnover · commission computation · the sales leaderboard · gross
profit · item & product margin · consultant P&L · the MSME 45-day clock · the
43B(h) skill · the Kray Overdue KPI · payables ageing · client cost · client
profitability · PT-by-state · the regional send guard.

None of these needs new schema. They need an `<input>` and a line in a
`VendorCreate`/`InvoiceCreate` model.

## Tasks

Each task: add the field to the write path, backfill nothing (existing NULLs
stay NULL until edited), verify with a **read-only** live query that the column
now accepts a value on create.

### 1.1 · `salesperson_id` on invoice + order

- **Now:** 0 of 789 invoices, 0 of 378 orders carry it → the leaderboard,
  commission and per-person turnover all read zero.
- **Do:** add `salesperson_id` (a login `user_id`) to the invoice create/update
  form and the Vikray order form; write it through `InvoiceCreate` /
  `OrderCreate`. Render the **name**, never the id (`check-rendered-ids.mjs`).
- **Files:** `frontend/src/pages/ganit/InvoiceForm.jsx`, `backend/routers/ganit.py`
  (invoice create), `frontend/src/pages/VikrayPage.jsx` + its order route.
- **Accept:** a new invoice saved with a salesperson makes that person appear on
  the Sales leaderboard and in `crm_report`/commission with a non-zero figure.

### 1.2 · Vendor MSME + TDS fields

- **Now:** `is_msme`, `enterprise_class`, `udyam_number`, `tds_section`,
  `payment_terms_days` are NULL on **80 of 80 vendors** and cannot be entered.
  Kray's two headline differentiators (MSME 43B(h) clock, TDS 194Q) depend on them.
- **Do:** extend `VendorCreate`/`VendorUpdate` (currently name/gstin/email/phone/
  address only) and the vendor form. `enterprise_class` ∈ micro|small|medium
  drives the 15/45-day deadline; validate `udyam_number` format loosely, never block.
- **Files:** `backend/routers/ganit.py:141,149,2449` (vendor CRUD), the vendor
  form under `frontend/src/pages/kray/VendorsTab.jsx` / `ganit`.
- **Accept:** a vendor saved as `small` + a past-due bill lights the 43B(h)
  warning; the Kray Overdue tile stops asserting 43B(h) on every payable.

### 1.3 · `cost_price` onto the order/invoice line at write time

- **Now:** 0 of 1,338 lines carry it → gross profit, item margin and product
  margin are all uncomputable.
- **Do:** copy the product's cost price onto the line **at the moment of write**
  (not by join — the product cost can change later and the line must remember
  what it was). One field, one assignment in the line-create path.
- **Files:** the order/invoice line create in `backend/routers/vikray.py` /
  `ganit.py`; the line form.
- **Accept:** a new order line stores a cost; the margin report returns a real
  percentage instead of blank.

### 1.4 · `contact_id` on the expense form

- **Now:** 0 of 378 expenses carry it — **88 of them are billable** and cannot
  be attributed to a client, so client cost and client profitability read zero.
- **Do:** add a client picker to the expense form; write `contact_id`.
- **Files:** `frontend/src/pages/manav/ExpensesTab.jsx` or `ganit/ExpensesTab.jsx`,
  the expense create route.
- **Accept:** a billable expense tagged to a client shows up under that client's
  cost in the (Phase 4) client report.

### 1.5 · `state` on the employee

- **Now:** feeds PT-by-state (Phase 5) and prorated pay. Employee `department`
  also still has **no foreign key** — one key + one data fix ("Labour") unblocks
  PO budgets, approval routing and commission scope at once.
- **Do:** add `state` to the employee create/edit form; add the
  `manav_employees.department → manav_departments` FK (a migration — write the
  risk report first, it touches production data).
- **Files:** `frontend/src/pages/manav/EmployeesTab.jsx`, `backend/routers/manav.py`,
  a new numbered migration.
- **Accept:** an employee saved with a state is picked up by the Phase-5 PT read.

### 1.6 · `state_code` on holidays

- **Now:** 0 of 38 `manav_holidays` rows carry it (owner also owes the data — see
  Phase 0.25).
- **Do:** add `state_code` to the holiday form; the values are Phase-0 owner data.
- **Files:** `frontend/src/pages/manav/HolidaysTab.jsx`, `backend/routers/manav.py`.
- **Accept:** a state holiday only counts against employees in that state.

## Definition of done

- All six write-paths accept a value on create, verified by a **read-only** live
  query per column (`SELECT count(*) FILTER (WHERE col IS NOT NULL)` moved off 0).
- No UUID rendered in any of the new fields (`check-rendered-ids.mjs` green).
- Each new/changed router has **one test that executes its SQL** against the real
  schema (the Phase-6 rule, applied here first).
- `cd backend && python -m pytest -q` green; `npm run build` + `npm run check` green.

## What this unblocks downstream

Phase 5 (PT-by-state needs 1.5/1.6), the client report (needs 1.4), the whole
commission/leaderboard surface (needs 1.1), and the Kray tiles in Phase 2/4
(need 1.2).

---

## Progress

- **1.1 `salesperson_id` — ✅ code landed 2026-08-25.** Wired on both write
  paths, create + update, plus the display name:
  - Invoice: `InvoiceCreate.salesperson_id`, the create INSERT ($26), the
    `update_invoice` dynamic SET, and `get_invoice` now returns
    `salesperson_name` (joined, name never id). `ganit.py`.
  - Order: `OrderCreate`/`OrderUpdate.salesperson_id`, the create INSERT ($19),
    the `update_order` SET loop. `vikray.py`.
  - Forms: a local `Picker` fed by `/v1/org/members` (403-tolerant for
    non-admins) on `InvoiceForm.jsx` and `OrderForm.jsx`; name only, id never
    rendered.
  - Verified: `salesperson_id` is `text` on both tables (live); backend 1023
    tests green (1 pre-existing vendor-bill failure, unrelated); `npm run build`
    + `npm run check` green. **Acceptance still owed:** a real create through the
    UI on the test org, to see the row move off 0 and a name appear on the
    leaderboard — cannot write-probe the shared DB from here.
- **1.2 `is_msme` / `enterprise_class` / `vendor_kind` / `udyam_number` /
  `tds_section` / `payment_terms_days` — ✅ code landed 2026-08-26.** SIX
  columns, not the five listed above: `vendor_kind` is live and the 43B(h)
  skill tests it ("not traders"), so omitting it would leave that exclusion
  permanently unreachable. Blank → NULL (never `''`, which fails the live
  CHECK); update reads `model_fields_set` so a value can be cleared.
  `ganit.py`, `VendorsTab.jsx`, `test_vendor_msme_fields.py` (19).
- **1.3 `cost_price` on the line — ✅ code landed 2026-08-26.** No migration:
  lines are JSONB array elements, not rows. `apply_line_costs` (`vikray.py:278`)
  is the single writer; cost is carried forward on update so an edit cannot
  re-price an old document at today's cost. `InvoiceForm.jsx` never set
  `product_id`, so the invoice half was inert — fixed. (19)
- **1.4 `contact_id` on the expense — ✅ code landed 2026-08-26.** The backend
  was ALREADY complete; the gap was one missing key in the form. Note the column
  points at `graha_contacts` (a person), not `graha_clients` (the company), so
  it is labelled "Client contact". Attributing cost to the COMPANY needs a new
  `ganit_expenses.client_id` column — owner decision, migration 221, not taken. (7)
- **1.5 `state` on the employee — ✅ code landed, migration 220 APPLIED
  2026-08-26.** Numeric GST code, because `pay_professional_tax.state_code` is
  numeric and an alphabetic value would silently compute zero PT for everyone.
  **The department FK is NOT included**: 13 of 98 rows would violate it (12 hold
  `''`, which an FK does not skip, plus one orphan `'Labour'`), and the unique
  index it needs conflicts with `delete_department` being a soft delete. Both
  need an owner decision on live personnel data.
- **1.6 `state_code` on holidays — ✅ code landed 2026-08-26.** No migration —
  the column shipped in 175. The real work was `attendance_auto_mark.py`, which
  marked every active employee org-wide; that is what the acceptance criterion
  turns on, and the plan did not say so. (41)

**Every acceptance above is still owed.** Each is "a row moves off 0", which
needs a real create through the UI against the shared database. Nothing was
write-probed, so all six stay 🟡.
