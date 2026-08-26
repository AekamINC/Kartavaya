# Phase 2 — Fix the six things the product gets wrong today

**Effort:** ~3 days · **Blocks on:** nothing · **Runs parallel with:** Phase 1

These are the **only** items in the whole arc where a customer is *harmed* by
using the product as built. Everything else is value that is absent; these are
values that are *wrong*. One of them writes payslips for people who have left.

Each was re-verified against the live database on 2026-08-25.

## Tasks

### 2.1 · Payroll pays leavers  🔴 blocker

- **Fault:** the monthly salary-structure query joins `manav_employees` on
  `is_active = TRUE` with **no last-working-day guard**. Live: **10 employees**
  with a past offboarding date are still `is_active`.
- **File:** `backend/routers/vetana.py` (the `structures` fetch, ~`:283`/`:940`).
- **Do:** exclude anyone whose `manav_offboarding.last_working_day < month_start`,
  or thread `is_active` through with the offboarding join. The HR path already
  does the right thing — mirror it.
- **Accept:** the 10 offboarded staff drop out of the next run; a test seeds one
  leaver and asserts they are not paid.

### 2.2 · Flat ₹200 professional tax, every state  🔴 blocker

- **Fault:** `pt = 200 if pt_on and gross > 15000 else 0`. A populated 9-row
  slab table (`staging.pay_professional_tax`: Gujarat/Maharashtra/Karnataka) is
  read by nothing; **1,105 of 1,112 payslips** carry the constant.
- **File:** `backend/routers/vetana.py:542`.
- **Do:** read the slab for the employee's state (needs Phase 1.5 `state`) and
  the gross band. Falls back to 0 when no slab, never blocks.
- **Accept:** a Karnataka employee and a Gujarat employee at the same gross get
  different PT; a state with no slab gets 0.
- **Note:** depends on Phase 1.5 landing first, and on Phase 0.24 (owner supplies
  the ~20-state slab data). Ship the *mechanism* now; the data fills in behind it.

### 2.3 · Two billing endpoints 500 on first call  🔴 blocker

- **Fault:** both `INSERT INTO staging.ganit_invoices` name a column `gst_rate`
  that **does not exist** on the table, and omit `invoice_number` (NOT NULL, no
  default, no trigger). Confirmed against the live schema. Zero tests touch the
  router.
- **File:** `backend/routers/client_billing.py:399-419` and `:629-648`.
- **Do:** remove `gst_rate` from the column list and bind values; allocate an
  `invoice_number` via the existing `next_doc_number` allocator. Add a test that
  runs the INSERT against the real schema.
- **Accept:** the auto-invoice path creates a `ganit_invoices` row; `client_invoice_lines`
  moves off 0.
- **Cross-ref:** Phase 3 owns the rest of the billing engine — this is only the
  crash.

### 2.4 · Draft invoices dunned & counted as revenue  🔴 blocker

- **Fault:** the statement of account prints **79 draft invoices worth ₹1.16 cr**
  to the client; the Dristi revenue tile counts **102 drafts**. The one-line
  `COALESCE(doc_status,'') <> 'draft'` fix that landed in `gst_period.py` was
  never applied to these two.
- **Files:** `backend/routers/documents.py:281-310` (statement),
  `backend/routers/dristi.py:332-341` (revenue tile — the expense query four
  lines below already filters).
- **Do:** add the same nullable-safe draft filter both places.
- **Accept:** the statement stops showing drafts; Dristi revenue matches the
  client report (`analytics.py:1003`), which already got it right — the two
  surfaces stop disagreeing.

### 2.5 · Cross-tenant leak in the newest router  🔴 blocker

- **Fault:** `create_profile` never checks `client_id` belongs to `org_id`;
  `list_profiles` then joins `graha_clients` on id alone and can return another
  org's client name. The three sibling creators in the same file *do* validate.
- **File:** `backend/routers/client_billing.py:188-213`, `:153-157`.
- **Do:** add the ownership check (copy the sibling pattern) on both create and
  list.
- **Accept:** a profile create for a client of another org 404s; a test proves it.

### 2.6 · Pahchan tells users a metric is impossible against a 699-row table

- **Fault:** two absence declarations still say `PROPOSED_064_pahchan.sql` is not
  applied; every column they name (`lat`, `lng`, `distance_m`, `geofence_id`,
  `flags`) exists live. Flagged by two proposals, acted on by neither.
- **File:** `backend/analytics/metrics/pahchan.py:272-300`.
- **Do:** delete the absence guards; let the metrics compute.
- **Accept:** the geofence/distance metrics return numbers instead of an
  "impossible" sentinel.

## Definition of done

- All six re-verified with a **read-only** live query showing the wrong output
  is gone.
- New tests: leaver-not-paid (2.1), PT-by-state (2.2), the two INSERTs execute
  (2.3), draft-excluded (2.4), cross-tenant-404 (2.5).
- `cd backend && python -m pytest -q` green.

## Ordering note

2.1, 2.4, 2.5, 2.6 are independent and can ship the day they are written. 2.2
waits for Phase 1.5. 2.3 is the prerequisite for anything in Phase 3.

---

## Progress

**All six coded 2026-08-26.** Detail and evidence in `PROGRESS.md`.

- **2.1 ✅ code** — `vetana.py:1221`, mirrors `analytics/metrics/manav.py:79`.
  Live dry-read 60 → 51 paid; the leaver whose last day is 2026-08-03 is
  correctly still paid, pro-rated.
- **2.2 ✅ mechanism** — `vetana.py:746`. ⚠ Owner chose "fall back to ₹0".
  All 9 slabs belong to one org; the two payroll-running orgs have none, so PT
  goes 200 → 0 on deploy until Phase 0.24 seeds them. Not a bug — a sequencing
  requirement.
- **2.3 ✅ code** — `gst_rate` dropped, `invoice_number` allocated, and a
  SECOND bug the plan missed: `balance_due` unbound would have made every such
  invoice read as fully paid (₹0 on the pay link).
- **2.4 ✅ code, premise corrected** — the statement was not printing drafts; it
  was 500ing on a date bind and had never rendered. Fixed both, plus the export
  twin (or the tile would disagree with its own CSV) and the project report.
- **2.5 ✅ done** — 7 id-alone joins, not the 2 named. AST ratchet added.
- **2.6 ✅ done** — columns proved live AND populated (699 punches). The guard's
  own test was pinning the stale claim; inverted.

Newly found, NOT fixed: the project report is dead on `staging.time_entries`
(exists only in `public`); `dristi.py` `/overview` and the pivot dashboard still
count drafts, and the pivot carries the same date-bind bug;
`analytics/metrics/vetana.py:240` counts the same ten leavers.
