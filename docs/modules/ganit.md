# Ganit गणित — Finance and invoicing

**Module code** `ganit` · registered in `backend/middleware/role_tiers.py`

GST-correct invoicing, payments and the ledger. Holds the tax logic: GSTIN state codes decide CGST/SGST against IGST, and place of supply follows s.12(2)(a) of the IGST Act.

## Flow

An invoice is raised against a Graha client, its place of supply derived from the two GSTINs, then issued. Payments post against it and the balance falls. TDS challans are recorded separately, against a deduction period rather than against an invoice.

⚠ **"e-way bills and TDS hang off the same record" was wrong on BOTH counts until 2026-09-12, and it had been copied into customer-facing collateral in six places** — including `AuthShell.jsx`, the sign-in panel, so it was shown on every login, and the onboarding module picker, so it described what a firm was choosing to turn on. Recorded rather than deleted because this is the fourth time a module doc's Flow sentence has reached a sales surface before anyone measured it (see `pahchan.md`, `vetana.md`, `sanvaad.md`).

- **E-WAY BILLS DO NOT EXIST.** `eway` / `e_way` / `ewb` match nothing in `backend/routers`, `backend/services` or any of the 233 numbered migrations. Kartavaya is also **not a GSP** — `routers/documents.py:1005` states it outright — so there is no e-invoicing/IRN either. What *does* exist is `services/compliance_settings.py`, which **records whether the e-way bill rule applies to a firm**: a dated, attributed position, explicitly "recorded only", not a generated document. That distinction is the whole correction — the product holds a compliance *position*, never a *bill*.
- **TDS DOES NOT HANG OFF THE INVOICE.** `ganit_tds_challans` carries `org_id` as its **only** foreign key and is keyed on `period` (YYYY-MM); Rule 30(2) fixes the due date from that period. A challan settles a **deduction period**, not a document, so no invoice record has one attached.

⚠ **This file was corrected BY HAND, which `CLAUDE.md` forbids — deliberately.** The Flow prose is generated from `scripts/gen-module-docs.mjs` (now fixed at source), but `gen-module-docs.mjs` calls `writeFileSync` on the whole file with no merge, so regenerating would **delete every ⚠ correction block in `graha.md`, `manav.md`, `vetana.md`, `pahchan.md` and this file**. Regenerate only once that data loss is addressed.

## Backend

- `backend/routers/ganit.py`

**Services**
- `backend/services/ganit_ops.py`

**51 routes** — 22 GET, 21 POST, 5 PATCH, 2 DELETE, 1 PUT

<details><summary>All routes</summary>

- `GET /invoices`
- `POST /invoices`
- `PATCH /invoices/{invoice_id}`
- `GET /invoices/{invoice_id}`
- `GET /invoices/{invoice_id}/pdf`
- `POST /invoices/{invoice_id}/email`
- `POST /invoices/{invoice_id}/cancel`
- `POST /invoices/{invoice_id}/payments`
- `GET /stats`
- `GET /cash-position`
- `PATCH /invoices/{invoice_id}/status`
- `POST /invoices/{invoice_id}/accept-estimate`
- `POST /invoices/{invoice_id}/convert-to-invoice`
- `GET /expenses`
- `POST /expenses`
- `PATCH /expenses/{expense_id}`
- `DELETE /expenses/{expense_id}`
- `GET /expense-categories`
- `POST /expense-categories`
- `GET /contracts`
- `POST /contracts`
- `PATCH /contracts/{contract_id}`
- `GET /contracts/{contract_id}`
- `POST /contracts/{contract_id}/send-for-signature`
- `GET /contracts/{contract_id}/signature-status`
- `POST /contracts/{contract_id}/cancel-signature`
- `GET /contracts/{contract_id}/audit-trail`
- `GET /recurring`
- `POST /recurring`
- `POST /recurring/{recurring_id}/generate`
- `DELETE /recurring/{recurring_id}`
- `GET /expense-stats`
- `POST /invoices/from-deal/{deal_id}`
- `GET /vendors`
- `POST /vendors`
- `PATCH /vendors/{vendor_id}`
- `GET /vendor-bills`
- `GET /payables-summary`
- `GET /vendor-bills/{bill_id}`
- `POST /vendor-bills`
- `POST /vendor-bills/{bill_id}/payments`
- `GET /bank-formats`
- `PUT /bank-formats`
- `POST /bank-statements/import`
- `GET /bank-statements`
- `GET /bank-statements/{line_id}/candidates`
- `POST /bank-statements/{line_id}/match`
- `POST /bank-statements/{line_id}/unmatch`
- `GET /bank-statements/stats`
- `POST /invoices/from-time-entries`
- `GET /collections`

</details>

## Database

22 tables:

- `ganit_bank_formats`
- `ganit_bank_statement_lines`
- `ganit_contract_signers`
- `ganit_contracts`
- `ganit_expense_categories`
- `ganit_expenses`
- `ganit_invoices`
- `ganit_pay_scans`
- `ganit_payments`
- `ganit_recurring`
- `ganit_vendor_bills`
- `ganit_vendor_payments`
- `ganit_vendors`
- `graha_clients`
- `graha_contacts`
- `graha_custom_fields`
- `graha_deals`
- `manav_employees`
- `organisations`
- `outbound_log`
- `time_entries`
- `users`

## Frontend

- `frontend\src\pages\ganit\AgeingTab.jsx`
- `frontend\src\pages\ganit\BankTab.jsx`
- `frontend\src\pages\ganit\BillingProfilesTab.jsx`
- `frontend\src\pages\ganit\CollectionsTab.jsx`
- `frontend\src\pages\ganit\ContractDetail.jsx`
- `frontend\src\pages\ganit\ContractsTab.jsx`
- `frontend\src\pages\ganit\ESignTab.jsx`
- `frontend\src\pages\ganit\ExpensesTab.jsx`
- `frontend\src\pages\ganit\InvoiceDetail.jsx`
- `frontend\src\pages\ganit\InvoiceForm.jsx`
- `frontend\src\pages\ganit\InvoicesTab.jsx`
- `frontend\src\pages\ganit\MeteredUsageTab.jsx`
- `frontend\src\pages\ganit\PayablesTab.jsx`
- `frontend\src\pages\ganit\RateCardsTab.jsx`
- `frontend\src\pages\ganit\RecurringTab.jsx`
- `frontend\src\pages\ganit\ServiceLinesTab.jsx`
- `frontend\src\pages\ganit\SignatureDetail.jsx`
- `frontend\src\pages\ganit\SLACreditsTab.jsx`
- `frontend\src\pages\ganit\StatsTab.jsx`
- `frontend\src\pages\ganit\TimesheetTab.jsx`
- `frontend\src\pages\ganit\VendorBillDetail.jsx`
- `frontend\src\pages\ganit\_shared.jsx`
- `frontend\src\pages\ganit\__tests__\clientBillingDeadEnds.test.jsx`
- `frontend\src\pages\ganit\__tests__\clientContactTabs.test.jsx`
- `frontend\src\pages\ganit\__tests__\expenseClientTag.test.jsx`
- `frontend\src\pages\ganit\__tests__\invoiceCustomerLink.test.jsx`
- `frontend\src\pages\GanitPage.jsx`


## Integrations

- WhatsApp Cloud API
- AWS SES
- Cloudflare R2
- Supabase

---
_Routes, tables and paths are generated by `scripts/module-facts.mjs` and
`scripts/gen-module-docs.mjs`. Re-run both after changing the module; do not
edit those sections by hand. Purpose and Flow are hand-written._
