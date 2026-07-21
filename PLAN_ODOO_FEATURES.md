# Odoo-Inspired Features — Implementation Plan

**Generated:** 2026-07-21 (scheduled task: `plan-odoo-features`)
**Tier 1 status (2026-07-21):** All 5 features implemented and migrated to the live DB — see migrations 033–037 and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Tier 2/3 remain unbuilt.
**Branch:** staging
**Principle:** Same as Vetana/Vikray — new features are thin layers over existing modules, reusing existing endpoints/tables wherever possible. No new top-level modules; everything slots into the existing seven (Graha, Ganit, Manav, Vikray, Vetana, Dristi, Prachar).

---

## Note on provenance

This scheduled run looked for the "15 Odoo features" research referenced in the task brief (expected around 2026-07-16/17) in [PLAN_VETANA.md](PLAN_VETANA.md), [PLAN_VIKRAY.md](PLAN_VIKRAY.md), git log, and a repo-wide search for "odoo" — none exists. Those two files are payroll/sales module plans, not Odoo research, and no commit or doc mentions Odoo. Rather than block, this plan derives 15 features fresh from Odoo's app catalog (github.com/odoo/odoo), cross-checked against the current routers in `backend/routers/` to exclude anything already shipped.

**Already built — excluded from this list:** recurring invoices, credit/debit notes, quotation→invoice conversion, business/billable expense tracking, contracts ([ganit.py](backend/routers/ganit.py)); lead scoring, automations, deal pipeline, contact dedupe ([graha.py](backend/routers/graha.py)); drip sequences, ad insights ([prachar.py](backend/routers/prachar.py), [prachar_ads.py](backend/routers/prachar_ads.py)); shifts, leave, attendance ([manav.py](backend/routers/manav.py)); e-sign ([esign.py](backend/routers/esign.py)); scheduled reports ([reports.py](backend/routers/reports.py)).

If the original 2026-07-16/17 research surfaces later (a chat transcript, a doc outside this repo), reconcile the two lists before starting work — some Tier assignments below may shift.

---

## Tier summary

| # | Feature | Module | Effort |
|---|---|---|---|
| 1 | Employee Expense Claims & Reimbursement | Manav → Vetana | M |
| 2 | Vendor Bills & Accounts Payable | Ganit | M |
| 3 | Product & Stock Ledger | Vikray | M |
| 4 | Recruitment / Applicant Tracking (ATS) | Manav | M |
| 5 | Employee Loans & Salary Advances | Vetana | S |
| 6 | Bank Reconciliation | Ganit | M |
| 7 | Multi-Currency Invoicing | Ganit | S |
| 8 | Approval Chains (deals & vendor bills) | Graha | S |
| 9 | Helpdesk / Support Tickets | Graha | M |
| 10 | Timesheet → Invoice Billing Bridge | Manav ↔ Ganit | S |
| 11 | Point-of-Sale Quick Invoice | Vikray | S |
| 12 | Custom Dashboard / Pivot Builder | Dristi | L |
| 13 | Company Asset Tracking | Manav | S |
| 14 | Event & Webinar Management | Prachar | M |
| 15 | Document Repository (contact/deal-linked) | Graha | M |

(S = 1 migration + <150 line router + 1-2 frontend tabs, ~half a session. M = ~1 session. L = 1.5+ sessions.)

---

# TIER 1 — High Priority

## 1. Employee Expense Claims & Reimbursement (Manav → Vetana)

**What it does:** Employees submit expense claims (travel, meals, supplies) with receipt photos from mobile or web. Manager approves/rejects. Approved claims queue up and are paid out in the next Vetana payroll run as a reimbursement line — separate from Ganit's client-billable expense tracking, which stays untouched.

**Why it matters for Indian SMBs:** Reimbursement is almost always informal (WhatsApp photo + cash) at small firms, causing disputes and no audit trail. A simple claim→approve→pay flow is one of Odoo Expenses' most-used features and maps directly onto existing approval-workflow patterns Kartavya already has for tasks.

**Module fit:** Primary: **Manav** (claim submission, approval, employee-facing). Secondary: **Vetana** (payslip line item, payout).

**Database schema (new migration, e.g. `033_expense_claims.sql`):**
```sql
CREATE TABLE staging.manav_expense_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    category TEXT NOT NULL,             -- travel, meals, supplies, other
    expense_date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    receipt_urls JSONB DEFAULT '[]',    -- R2 upload, same pattern as ganit_expenses
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    payslip_id UUID REFERENCES staging.vetana_payslips(id),  -- set once paid
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_expense_claims_org ON staging.manav_expense_claims(org_id);
CREATE INDEX idx_expense_claims_emp ON staging.manav_expense_claims(employee_id);
CREATE INDEX idx_expense_claims_status ON staging.manav_expense_claims(org_id, status);
```

**API endpoints (`manav.py`):**
```
POST   /v1/manav/expense-claims                — Employee submits claim (+ receipt upload via existing uploads.py flow)
GET    /v1/manav/expense-claims                — List (filter: employee_id, status, date range); scoped to self unless manager/admin
PATCH  /v1/manav/expense-claims/{id}/approve    — Manager approves
PATCH  /v1/manav/expense-claims/{id}/reject     — Manager rejects (+ reason)
GET    /v1/manav/expense-claims/pending-count   — Badge count for approvals nav
```

**Vetana integration:** In `POST /v1/vetana/payroll/process`, add a step: fetch `manav_expense_claims WHERE status='approved' AND payslip_id IS NULL` for the employee, sum into a new `reimbursements` column on `vetana_payslips`, add to `net_pay`, and stamp `payslip_id` + `status='paid'` on the claims once the run is approved.

**Frontend:** New "Expenses" tab in `ManavPage.jsx` — claim list (employee view: own claims + submit form with receipt upload reusing the lightbox/upload component from Srijan; manager view: pending approval queue with approve/reject buttons). `VetanaPage.jsx` payslip detail view adds a "Reimbursements" line sourced from the new column.

**Effort:** M — migration ~30 lines, router ~120 lines, 1 new tab + payslip line change.

---

## 2. Vendor Bills & Accounts Payable (Ganit)

**What it does:** Mirror of Ganit's invoice (receivables) flow but for money the org owes vendors — bill entry, due date, payment recording, outstanding-payables dashboard.

**Why it matters:** GST-registered Indian firms need vendor bill records for input tax credit (ITC) claims. Right now Ganit only tracks the sales side; there's no payables ledger, so ITC reconciliation happens outside the system (spreadsheets).

**Module fit:** **Ganit** — same table family as `ganit_invoices`, reusing the numbering pattern already extracted for Vikray/Vetana.

**Database schema (new migration):**
```sql
CREATE TABLE staging.ganit_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gstin TEXT,
    email TEXT,
    phone TEXT,
    address JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ganit_vendors_org ON staging.ganit_vendors(org_id);

CREATE TABLE staging.ganit_vendor_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    vendor_id UUID NOT NULL REFERENCES staging.ganit_vendors(id),
    bill_number TEXT NOT NULL,          -- vendor's own invoice number
    internal_ref TEXT,                  -- our sequential ref, e.g. VB-2026-0001
    bill_date DATE NOT NULL,
    due_date DATE,
    line_items JSONB NOT NULL DEFAULT '[]',
    subtotal DECIMAL(14,2) DEFAULT 0,
    cgst DECIMAL(14,2) DEFAULT 0,
    sgst DECIMAL(14,2) DEFAULT 0,
    igst DECIMAL(14,2) DEFAULT 0,
    total DECIMAL(14,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(14,2) DEFAULT 0,
    status TEXT DEFAULT 'unpaid'
        CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled')),
    attachment_url TEXT,
    notes TEXT,
    created_by UUID NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vendor_bills_org ON staging.ganit_vendor_bills(org_id);
CREATE INDEX idx_vendor_bills_status ON staging.ganit_vendor_bills(org_id, status);

CREATE TABLE staging.ganit_vendor_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    bill_id UUID NOT NULL REFERENCES staging.ganit_vendor_bills(id) ON DELETE CASCADE,
    amount DECIMAL(14,2) NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    method TEXT,                        -- bank_transfer, upi, cheque, cash
    reference TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vendor_payments_bill ON staging.ganit_vendor_payments(bill_id);
```

**API endpoints (`ganit.py`):**
```
POST/GET       /v1/ganit/vendors
GET/PATCH      /v1/ganit/vendors/{id}
POST/GET       /v1/ganit/vendor-bills
GET/PATCH      /v1/ganit/vendor-bills/{id}
POST           /v1/ganit/vendor-bills/{id}/payments
GET            /v1/ganit/payables-summary       — total outstanding, overdue, aging buckets (30/60/90)
```

**Frontend:** New "Payables" tab in `GanitPage.jsx`, mirroring the existing `InvoicesTab` layout (list + detail drill-down + payment recording modal). Vendor CRUD reuses the contact-picker pattern from Graha.

**Effort:** M — migration ~55 lines, router ~200 lines, 1 new tab.

---

## 3. Product & Stock Ledger (Vikray)

**What it does:** Lightweight inventory — quantity-on-hand per product, auto-decrement on order confirmation, low-stock threshold alerts. Not a full warehouse/multi-location system (Odoo Inventory is far larger) — just enough for SMBs selling physical goods to avoid overselling.

**Why it matters:** Vikray's order flow (`vikray_orders`, per [PLAN_VIKRAY.md](PLAN_VIKRAY.md)) currently has no stock awareness — a confirmed order can't be checked against availability. This was flagged as "future" in that plan's status-flow notes.

**Module fit:** **Vikray**, reading/writing `ganit_products` (already exists) plus a new stock table.

**Database schema:**
```sql
CREATE TABLE staging.vikray_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES staging.ganit_products(id) ON DELETE CASCADE,
    quantity_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0,
    low_stock_threshold DECIMAL(12,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, product_id)
);

CREATE TABLE staging.vikray_stock_moves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES staging.ganit_products(id),
    order_id UUID REFERENCES staging.vikray_orders(id),
    quantity_delta DECIMAL(12,2) NOT NULL,   -- negative = outbound, positive = restock
    reason TEXT,                              -- order_confirmed, manual_adjustment, restock
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_stock_moves_product ON staging.vikray_stock_moves(product_id);
```

**API endpoints (`vikray.py`):**
```
GET    /v1/vikray/stock                    — List stock levels (filter: low_stock=true)
PATCH  /v1/vikray/stock/{product_id}       — Set threshold / manual adjustment (+ stock move log)
GET    /v1/vikray/stock/{product_id}/moves — Movement history
```
Hook into existing `PATCH /v1/vikray/orders/{id}/status`: when status transitions to `confirmed`, decrement stock per line item and insert a `stock_moves` row; on `cancelled` from `confirmed`, reverse it.

**Frontend:** New "Stock" sub-tab under Orders in `VikrayPage.jsx` — table of products with on-hand qty, threshold, low-stock badge (reuse `StatTile` warning variant), manual adjustment modal.

**Effort:** M — migration ~30 lines, router ~100 lines + hook into existing status endpoint, 1 sub-tab.

---

## 4. Recruitment / Applicant Tracking (Manav)

**What it does:** Kanban pipeline for hiring — job postings, candidate cards (applied → screening → interview → offer → hired/rejected), resume attachment, interview notes.

**Why it matters:** Odoo Recruitment is one of its most-adopted HR modules for SMBs because hiring is currently tracked in spreadsheets or WhatsApp. Kartavya already has a proven kanban component (`KanbanView`, used by Graha deals and project boards) — this is a direct reuse, not a new UI paradigm.

**Module fit:** **Manav**.

**Database schema:**
```sql
CREATE TABLE staging.manav_job_openings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    department_id UUID REFERENCES staging.manav_departments(id),
    description TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'on_hold', 'closed')),
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE staging.manav_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    job_opening_id UUID NOT NULL REFERENCES staging.manav_job_openings(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    resume_url TEXT,
    stage TEXT DEFAULT 'applied'
        CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected')),
    notes TEXT,
    rejection_reason TEXT,
    converted_employee_id UUID REFERENCES staging.manav_employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_candidates_org ON staging.manav_candidates(org_id);
CREATE INDEX idx_candidates_stage ON staging.manav_candidates(org_id, stage);
```

**API endpoints (`manav.py`):**
```
POST/GET   /v1/manav/job-openings
PATCH      /v1/manav/job-openings/{id}
POST/GET   /v1/manav/candidates              — filter by job_opening_id, stage
PATCH      /v1/manav/candidates/{id}/stage    — kanban drag-drop target
POST       /v1/manav/candidates/{id}/hire     — creates manav_employees row, sets converted_employee_id
```

**Frontend:** New "Recruitment" tab in `ManavPage.jsx` reusing `KanbanView` with columns = stages, cards = candidates. Job opening selector at top (same pattern as Graha's pipeline selector).

**Effort:** M — migration ~35 lines, router ~140 lines, 1 tab (kanban reuse keeps frontend effort down).

---

## 5. Employee Loans & Salary Advances (Vetana)

**What it does:** Record a loan/advance given to an employee, set an EMI (equal monthly instalment) amount, auto-deduct from payslip each month until the balance clears.

**Why it matters:** Salary advances are extremely common in Indian SMBs (festival advances, emergency loans) and currently have zero system support — they're tracked as a manual "extra deduction" note at best. This is a small, self-contained addition to Vetana's existing payroll computation.

**Module fit:** **Vetana**.

**Database schema:**
```sql
CREATE TABLE staging.vetana_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES staging.manav_employees(id) ON DELETE CASCADE,
    principal_amount DECIMAL(12,2) NOT NULL,
    emi_amount DECIMAL(12,2) NOT NULL,
    balance_remaining DECIMAL(12,2) NOT NULL,
    disbursed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'written_off')),
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vetana_loans_emp ON staging.vetana_loans(employee_id);
CREATE INDEX idx_vetana_loans_org ON staging.vetana_loans(org_id, status);
```
Add `loan_deduction DECIMAL(14,2) DEFAULT 0` column to existing `vetana_payslips`.

**API endpoints (`vetana.py`):**
```
POST/GET   /v1/vetana/loans                — filter by employee_id, status
PATCH      /v1/vetana/loans/{id}            — adjust EMI, write off
```
In `POST /v1/vetana/payroll/process`: for each employee with an active loan, deduct `min(emi_amount, balance_remaining)` into `loan_deduction`, subtract from `net_pay`, and decrement `balance_remaining` (mark `closed` at zero) once the run is approved.

**Frontend:** New "Loans" tab in `VetanaPage.jsx` — list + create form (principal, EMI, employee picker). Payslip detail shows the loan deduction line.

**Effort:** S — migration ~20 lines, router ~80 lines, 1 tab.

---

# TIER 2 — Medium Priority

## 6. Bank Reconciliation (Ganit)
Import a bank statement (CSV export from any Indian bank), auto-match rows to `ganit_payments` / `ganit_vendor_payments` by amount + date proximity, surface unmatched rows for manual linking. New table `ganit_bank_statement_lines` (org_id, date, description, amount, matched_payment_id, matched_type). New endpoint `POST /v1/ganit/bank-statements/import` (CSV parse) + `GET /v1/ganit/bank-statements/unmatched`. New "Reconciliation" tab. Depends on Feature 2 (vendor payments) existing first for full value.

## 7. Multi-Currency Invoicing (Ganit)
Add `currency TEXT DEFAULT 'INR'` and `exchange_rate DECIMAL(10,4) DEFAULT 1` to `ganit_invoices`; store rate at creation time (no live FX feed needed initially — manual entry). Invoice PDF/detail view shows both currency and INR-equivalent. Small, additive — no new table.

## 8. Approval Chains for Deals & Vendor Bills (Graha)
Generalized multi-step approval — e.g. deals above a configurable value, or vendor bills above a threshold, require a second approver before moving forward. New table `graha_approval_rules` (org_id, entity_type, threshold_amount, approver_role) + `graha_approval_requests` (entity_type, entity_id, status, requested_by, approved_by). Reuses the existing task-approval notification pattern (magic-link emails already built for client approvals).

## 9. Helpdesk / Support Tickets (Graha)
Ticket queue linked to `graha_contacts` — subject, priority, status (open/pending/resolved/closed), SLA due date, assignee. New tables `graha_tickets`, `graha_ticket_messages` (threaded replies, reuse email-thread pattern from Inbox). New "Tickets" tab in `GrahaPage.jsx`. Useful once Kartavya has external customers of its own, not just Aekam's internal orgs.

## 10. Timesheet → Invoice Billing Bridge (Manav ↔ Ganit)
`time_entries.py` already tracks hours; there is no bridge to billing. Add `is_billed BOOLEAN DEFAULT FALSE` + `invoice_id` to the time entries table, and a new endpoint `POST /v1/ganit/invoices/from-time-entries` that takes a contact/project + date range, pulls unbilled entries, and pre-fills invoice line items at the employee's billing rate (new `hourly_rate` column on `manav_employees`). No new tables — additive columns only.

---

# TIER 3 — Lower Priority / Future

## 11. Point-of-Sale Quick Invoice (Vikray)
Single-screen counter-sale flow: pick products, take payment, print/share receipt — skips the full order status flow (draft→confirmed→dispatched) for SMBs that sell over-the-counter. New endpoint `POST /v1/vikray/pos-sale` that creates an order + invoice + payment in one call. New "Quick Sale" tab.

## 12. Custom Dashboard / Pivot Builder (Dristi)
Odoo Spreadsheet-style: let users pick a data source (invoices, deals, attendance), group-by + aggregate, save as a custom widget on the Dristi dashboard. Largest lift of the 15 — needs a generic query-builder backend (allowlisted columns/tables, similar to the SQL-injection-safe column allowlist pattern already used in Graha reports) and a drag-drop frontend. Recommend deferring until a customer explicitly asks for it.

## 13. Company Asset Tracking (Manav)
Track laptops/phones/vehicles issued to employees — assign, return, condition notes. New table `manav_assets` (org_id, asset_tag, category, assigned_to, issued_date, returned_date, condition). New "Assets" tab. Low complexity, low urgency — nice-to-have for larger orgs only.

## 14. Event & Webinar Management (Prachar)
Create marketing events (webinar, in-person meetup), registration form (public, no-auth like the e-sign public page), attendance tracking, follow-up trigger into Prachar sequences. New tables `prachar_events`, `prachar_event_registrations`. Fits Prachar's existing marketing-automation direction but is its own mini-flow — worth scoping only if a customer runs regular events.

## 15. Document Repository (Graha)
Centralized, taggable file store linked to any contact/deal/project — folders, tags, version history. Odoo's Documents app equivalent. Kartavya already has R2 uploads scattered per-feature (receipts, resumes, attachments); this would be a genuine cross-cutting repository rather than a Graha-only feature, so it needs more design work before scoping a schema. Flag for a dedicated planning session rather than committing to a schema here.

---

## Suggested build order

1. **Vetana Loans (#5)** and **Multi-Currency (#7)** first — smallest, self-contained, no cross-module risk.
2. **Expense Claims (#1)** and **Vendor Bills (#2)** next — highest day-to-day value for an Indian SMB's bookkeeping.
3. **Recruitment (#4)** and **Stock Ledger (#3)** — reuse existing kanban/order patterns, moderate effort.
4. Tier 2 items opportunistically, in whichever module already has a session scheduled.
5. Tier 3 — revisit only when a specific customer request justifies the larger lift (#12, #15 especially).

## Cross-cutting notes

- All new tables follow the existing convention: `org_id UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE`, `is_active` soft-delete where mutable, `created_at`/`updated_at` timestamps, org-scoped indexes.
- All new routers must use the column-allowlist pattern already established in Graha reports to avoid reintroducing the SQL-injection class of bug fixed in `2e77287`.
- Any new money-moving flow (vendor payments, loan disbursement, reimbursement payout) should go through the same audit patterns as `vetana_payroll_runs` (draft→approved status gate before anything is marked "paid").
- Reuse `backend/utils/numbering.py` (already planned for Ganit/Vikray/Vetana) for any new sequential document number (vendor bill refs, job opening codes, etc.) instead of inventing a new numbering scheme per feature.
