# Finance & Operations Backend Audit — ganit, vikray, prachar, dristi

Agent branch: `worktree-agent-a91ffbcdbce0c3ac0`
Base: `staging`
Scope: `backend/routers/ganit.py`, `vikray.py`, `prachar.py`, `prachar_ads.py`, `dristi.py`
Out of scope (other agents): `manav.py`, `vetana.py`, `graha.py`, `me.py`, `org_*.py`, approvals, messaging.

Suite: **409 passed**, 0 failed. Gates: `check-tokens` 0 missing, `check-classes` 0 missing (run from `frontend/`, not repo root).

---

## 0. Worktree correction — applies to the whole run

This worktree was created from **`origin/main`**, not `staging`: 271 commits behind,
with `backend/middleware/`, `design-handover/` and `design-reference/` all absent.
Corrected with `git reset --hard origin/staging` before any analysis.

**Any agent reporting that `role_tiers.py`, the print specification, or the
ganit/vikray/prachar/dristi routers "do not exist" was reading production.**

---

## 1. Ground truth — the role model is correct

`backend/middleware/role_tiers.py` is the single source of truth and is right.
`level_satisfies()` implements separated duty exactly: for `{vetana, ganit}`,
`required == APPROVER` is satisfied only by `held == APPROVER` (line 254-259).
No router in my four hardcodes a role string.

### STALE CLAIM — "module entitlement uses the wrong module code"

**Stale for all four of my modules.** Every gate uses the exact code in `ALL_MODULES`:

| Router | Gate | Match |
|---|---|---|
| `ganit.py:27` | `require_module("ganit")` | yes |
| `vikray.py:21` | `require_module("vikray")` | yes |
| `prachar.py:24`, `prachar_ads.py:19` | `require_module("prachar")` | yes |
| `dristi.py:24` | `require_module("dristi")` | yes |

The `sanvaad`/`samvada` split is real but confined to Sanvaad; `role_tiers.py:62`
documents it. None of my four are affected.

### STALE CLAIM — "the dristi pivot builder is SQL-injectable"

**Stale.** `run_pivot_query` interpolates `group_by`, `measure`, `date_col`,
filter keys and table name — but every one is checked against a per-source
allow-list before use. Not injectable. (It had a *different* real bug — §5.)

### STALE CLAIM — "contract audit trail leaks across orgs"

**Stale — already fixed on staging**, with the fix and its reasoning in a comment
at `ganit.py:1211`. Same for `dristi` report logs (`dristi.py:659`). I added
regression tests for both so they cannot silently regress.

---

## 2. THE HEADLINE FINDING — separated duty was not *representable*

`level_satisfies()` — the function encoding "admin does not satisfy approver" —
had **zero call sites in the entire backend**. The grant level was written on
every grant (`org_member_modules.role`), returned to the UI, and read by nothing.
`require_module()` checks only that a grant *row exists*: a `viewer` and an
`admin` reached identical endpoints.

It could not have been enforced as the schema stood. Two standing rules collide:

- `PROPOSED_065`: *"Vetana, Ganit and Manav must have NO per-member grant row at
  all. Access is a function of the org role."*
- `role_tiers`: in ganit/vetana, only an explicit **approver** grant approves.

`org_member_modules` is forbidden for ganit; `user_roles` carries only
org_owner / org_admin / org_member. **There is no row anyone can write that means
"may approve in Ganit."** Separated duty was not merely unenforced — it had
nowhere to live.

### What I did

- `backend/middleware/module_levels.py` — the missing consumer. `require_level()`
  and `held_level()`.
- `backend/migrations/PROPOSED_074_module_approvers.sql` — `staging.org_module_approvers`,
  the missing noun. Depth only, never reach; own audit columns; partial-unique so
  revoked rows are retained. **Not applied.**
- Applied `require_level("ganit", APPROVER)` to the two actions that are not
  bookkeeping: **cancel invoice** (voids a tax document) and **vendor bill
  payment** (money leaves the company).
- The resolver **probes for the table and self-activates**. Absent → org_owner /
  org_admin keep today's access, nothing breaks on deploy. Present → only an
  explicit approver row approves, and *platform_admin is refused too* — Aekam
  support must never release a customer's money.

### What I deliberately did NOT do

Ordinary ganit writes are **not** raised to `editor`. `DEFAULT_GRANT_LEVEL` is
`viewer` and existing rows predate the level column, so enforcing editor today
would revoke ordinary bookkeeping from real users with no migration to restore
it. That tightening needs a grant-level backfill first. **Open work.**

> **PROPOSED_074 must not be applied without its seed.** Between `CREATE TABLE`
> and the first `INSERT`, no one in any org can cancel an invoice or pay a vendor
> bill. Seeding options and verification queries are in the migration header.

---

## 3. Reachability — before / after

Roles: **PO** platform_owner/admin · **PM** platform_manager · **PS** platform_staff ·
**OO/OA** org_owner/org_admin · **OM+g** org_member with the module grant ·
**OM−g** org_member without it.

`ganit` is sensitive: PM and PS are refused by `require_module` and PO's pass is audited.

### ganit — 52 endpoints

| Endpoints | Before | After | Note |
|---|---|---|---|
| 48 reads/writes (products, invoices, expenses, contracts, recurring, vendors, bank, stats) | PO, OO/OA, OM+g | **unchanged** | no legitimate user loses access |
| `POST /invoices/{id}/cancel` | PO, OO/OA, OM+g | PO/OO/OA today → **explicit approver only** once 074 applies | separated duty |
| `POST /vendor-bills/{id}/payments` | PO, OO/OA, OM+g | same as above | separated duty |
| `GET /invoices/{id}/pdf` | all of the above | same roles, **409 if org has no GSTIN** and doc is a tax document | §4 |
| `POST /invoices/from-time-entries` | *nobody — 500 on every call* | PO, OO/OA, OM+g | was dead; now works and is org-scoped |
| 4 × `/sign/{token}` | **public, by design** | unchanged | token-bearer e-sign flow, correct |

### vikray — 16 endpoints

| Endpoints | Before | After | Note |
|---|---|---|---|
| 15 orders/targets/stock/dashboard | PO, PM, PS, OO/OA, OM+g(vikray) | unchanged | |
| `POST /orders/{id}/invoice` | vikray grant alone | **vikray AND ganit** | **narrows deliberately** — it writes a tax invoice |

Loss of access is intentional and named: a vikray-only member, and `platform_staff`
(a role defined to exclude finance), could previously issue tax invoices into a
customer's ledger. Remedy is a ganit grant, not a hole in the gate.

### prachar — 44 endpoints (38 + 6 ads)

| Endpoints | Before | After |
|---|---|---|
| all 44 | PO, PM, PS, OO/OA, OM+g | unchanged |
| `POST /sequences/{id}/enroll` | same, **accepted any org's contact ids** | same roles, foreign ids rejected and counted in `rejected` |

### dristi — 18 endpoints

The largest reachability change, and the most serious pre-existing leak.

| Endpoint | Before | After |
|---|---|---|
| `GET /overview` | dristi grant → **payroll + HR + revenue** | per-source; unreachable blocks omitted and named in `withheld`; **200 for everyone** |
| `GET /hr` | dristi grant → payroll trend, headcount, leave, attendance | **requires `manav`**; payroll sub-block additionally requires `vetana` |
| `GET /revenue` | dristi grant → invoice + expense ledger | **requires `ganit`** |
| `POST /query` | dristi grant → 8 tables incl. invoices, employees | **requires the source's own module** |
| `GET /exports/{type}` | dristi grant → same data as above | **requires every module the report reads** |
| `POST /scheduled-reports/{id}/run-now` | dristi grant | same check as reading the export |
| `GET /pipeline`, `/sales` | dristi grant | unchanged (graha/vikray are not sensitive) |
| 9 dashboard/scheduled-report CRUD | unchanged | unchanged |

**Why this mattered:** `dristi` is in `STAFF_MODULES`; `ganit`, `manav`, `vetana`
are deliberately not. So `platform_staff` — *"the operating set, excluding finance
and all HR"* — could read any customer's payroll totals, headcount and revenue
through `/api/v1/dristi/overview`, **with no audit row**, bypassing the exact gate
built to stop it. `/overview` withholds rather than 403s so the dashboard keeps
working for legitimate users.

---

## 4. GSTIN — one claim stale, one real

### STALE — "a tax invoice with no supplier GSTIN renders as if complete"

**Already fixed on staging.** `invoice_pdf._org_gstin_line` (line 118) renders
`GSTIN NOT SET` in red for tax documents, with the reasoning in the docstring.

### REAL — marking is not refusing

The design specification is unambiguous. `design-reference/Kartavaya Redesign/docs/Tax Invoice.html`:

> *"This document cannot be issued. {org} has no GSTIN on its company profile. A
> tax invoice without a supplier GSTIN fails e-invoice validation and blocks the
> recipient's input tax credit."*

The backend still **produced the PDF**. A red mark stops it looking complete; it
does not stop the file downloading, attaching to an email and reaching a customer.
`GET /invoices/{id}/pdf` now returns **409** for `tax_invoice` / `credit_note` /
`debit_note` when the org has no GSTIN. Quotations and proformas are unaffected —
they are offers, not tax documents.

### REAL — GSTIN validation did not exist

`gstin: str = ""` with no check anywhere: `"abc"` was a GSTIN, and so was a real
number with two characters transposed. Added `backend/services/gstin.py` —
state code (01–38, 97, 99), layout, and the **base-36 check digit**. Verified
against the real GSTIN in the design reference (`27AAACT2727Q1ZW`). Wired into
vendor create and update. Blank remains legal — unregistered suppliers exist.

> Note: the *sample* GSTINs in the design mock (`27AAACA1234M1Z8`) are fictional
> and fail the check digit, as expected. That is the mock's placeholder PAN, not
> a bug in the validator.

---

## 5. Every unscoped or broken query found

| # | Location | Finding | Status |
|---|---|---|---|
| 1 | `ganit.py` from-time-entries SELECT | `time_entries` has no org_id; scoped **only** by `manav_employees.user_id`. A contractor employed by two orgs had every entry they logged anywhere swept into whichever org billed first. The entry's real parent — task → team → org — was not joined at all. | **FIXED** — both parents required, employee join correlated to the same org |
| 2 | `ganit.py:1936` | `UPDATE staging.time_entries` — **the table does not exist**. Raised inside the transaction, rolled the invoice back; the endpoint 500'd on every call and had never billed anything. The `is_billed` flag it failed to set is the only thing preventing double-billing. | **FIXED** |
| 3 | `prachar.py` enroll | contact ids went from request body straight into `prachar_sequence_enrollments` (no org_id). Another tenant's contacts could be enrolled and then emailed by the sequence engine. | **FIXED** — filtered against caller's own contacts |
| 4 | `vikray.py:356` | `UPDATE vikray_orders SET invoice_id WHERE id=$1` — no org filter. Not exploitable (parent proven above) but defence-in-depth. | **FIXED** |
| 5 | `dristi.py` `_fetch_report_data` | `JOIN teams tm ON tm.id` — `teams` has **no `id` column** (PK is `team_id`). `report_type="overview"` raised UndefinedColumn, so `GET /exports/overview` had never returned. | **FIXED** |
| 6 | `dristi.py` pivot | `if "is_active" in [c for t in [spec] for c in ["is_active"]]` — a comprehension over a literal, **always true**. All 8 sources happen to have the column so it never misfired; the next source added would have broken. | **FIXED** — declared per source |
| 7 | `dristi.py` run-now | imported `services.email_service`, which **does not exist**, and called it as an awaitable with wrong kwargs. ImportError swallowed, logged as generic failure → no scheduled report had ever been sent. | **FIXED** — routed through `email_service.send_email`, the choke point that honours `OUTBOUND_MODE`; payload HTML-escaped |
| 8 | `services/esign_service.py:66,114` | **same broken import**, so ganit's `send-for-signature` email also never sent. | **NOT FIXED — outside my files.** Owner of esign should apply the identical one-line fix |

### Parent-guarded queries verified correct (no change needed)

`ganit_payments` by invoice_id, `ganit_contract_signers`, `ganit_vendor_payments`,
`ganit_contract_audit_trail`, `dristi_report_logs`, `prachar_sequence_steps` /
`_logs` / `_enrollments` — each preceded by an org-scoped parent fetch that 404s
first. I added regression tests pinning this, since the guarantee lives in the
handler rather than the query and is easy to delete by accident.

---

## 6. Document data — what the design needs vs what ganit returns

### `Tax Invoice.html`

**Supplier block: fully supplied.** `download_invoice_pdf` selects name, gstin,
pan, billing_address, logo_url/key, email, phone, website, bank_details,
invoice_note — exactly the shape the design's `ORGS` fixture mirrors.

**Missing from the backend entirely:**

| Field the design renders | Backend status |
|---|---|
| **Reverse charge** (Yes/No) | not in model or table |
| **Rounding** line (₹0.20) | not computed or stored; `_compute_invoice` does not round to the rupee |
| **e-Invoice: IRN, Ack no., Ack date** | absent — no column, no endpoint |
| **Shipped to** (address + contact name/phone) | absent from `ganit_invoices` (vikray orders have `shipping_address`; ganit does not) |
| **Authorised signatory** name + designation | not stored |
| **State code** ("· State code 27") | derivable from GSTIN — now available via `gstin.state_code()`, not yet surfaced |
| Line-item **sub-description** (e.g. "42 hours @ ₹2,380/hr") | `LineItem` has no such field |
| Aggregate **CGST/SGST rate label** ("@ 9%") | per-line `gst_rate` stored; aggregate half-rate not derived |
| "12 days overdue" | derivable from `due_date`; not returned |

### `GSTR-3B Summary.html` and `TDS Challan.html`

**No backend at all.** Zero endpoints, zero tables, zero fields — `grep -i
"gstr|tds|challan"` across `backend/` returns nothing. Both documents need a
data layer built from scratch: GSTR-3B needs outward/inward supply aggregation by
nature of supply, ITC eligibility split and a cash/ITC payment table; TDS Challan
needs per-section (194C/194J/194I/194H/192B) deduction aggregation, TAN, BSR code
and CIN. **Not started — sizeable, and out of reach in this pass.**

### `Statement of Account.html`

**No receivables endpoint.** Ganit has `/payables-summary` (vendor side, with
ageing) but nothing that produces a per-contact running-balance ledger:
opening balance, interleaved invoices and receipts, closing balance, ageing
buckets, and the MSME §43B(h) 45-day threshold date. **Not started.**

---

## 7. Fonts on generated PDFs — open, needs human approval

Confirmed: `backend/Dockerfile` installs only `fonts-dejavu-core` and `fonts-noto`.
The document spec (`docs/brand.css:6-11`) names **Newsreader** (display),
**Inter** (UI), **Tiro Devanagari Hindi**, **JetBrains Mono**. None are present,
so every generated document falls back.

Proposal, in order of confidence:

1. **Inter** and **JetBrains Mono** are packaged in Debian (`fonts-inter`,
   `fonts-jetbrains-mono`). **Verify the exact names against the base image's
   suite before merging** — a wrong apt name breaks the production image build,
   which is precisely why the previous agent stopped.
2. **Newsreader** and **Tiro Devanagari Hindi** are **not** Debian-packaged. They
   require vendoring the TTFs into the repo and a `COPY` into
   `/usr/share/fonts/truetype/`. I did not download them: adding binaries to the
   repo and editing the production Dockerfile both warrant explicit sign-off.
3. Devanagari currently renders via `fonts-noto` (Noto Sans Devanagari), so the
   bilingual text is legible today — it is the wrong *face*, not missing glyphs.

**This is a fidelity failure on statutory documents and it is still open.**

---

## 8. Not finished / handed on

- **Editor-level enforcement** on ordinary ganit writes — needs a grant-level
  backfill migration first (§2).
- **PROPOSED_074 seeding** — decision and apply are the owner's.
- **GSTR-3B, TDS Challan, Statement of Account** data layers — not started (§6).
- **Newsreader / Tiro TTF vendoring** + Dockerfile edit — needs approval (§7).
- **`esign_service.py` broken email import** — one-line fix, another agent's file (§5.8).
- **Invoice document fields** (reverse charge, rounding, IRN/Ack, ship-to,
  signatory) — need a schema addition; I did not propose one because the
  document-pass agent owns the rendering side and should shape the columns.
- **`_compute_invoice` rounding**: `ganit` splits CGST/SGST as
  `round(gst/2, 2)` twice, `generate_recurring_invoice` uses
  `half, total - half`. On odd amounts these disagree by a paisa. Not fixed —
  changing tax arithmetic mid-run without the owner's sign-off is not a call I
  should make unilaterally.

---

## 9. Files changed

| File | Change |
|---|---|
| `backend/middleware/module_levels.py` | **new** — the missing `level_satisfies` consumer |
| `backend/services/gstin.py` | **new** — real GSTIN validation |
| `backend/migrations/PROPOSED_074_module_approvers.sql` | **new proposal**, not applied |
| `backend/routers/ganit.py` | approver guard ×2, GSTIN 409, vendor GSTIN validation, time-entry scoping + dead table |
| `backend/routers/vikray.py` | ganit gate on invoice generation, org filter on order update |
| `backend/routers/prachar.py` | contact-ownership filter on enrollment |
| `backend/routers/dristi.py` | per-source module gating, 3 query/import bugs |
| `backend/tests/test_ganit_separated_duty.py` | **new** — 17 tests, both migration states |
| `backend/tests/test_finance_cross_org.py` | **new** — 11 cross-tenant denial tests |
| `backend/tests/conftest.py` | `conn_mock.fetchval/fetchrow` — harness gap that read as a product bug |

No pricing figures anywhere. No DB writes, no migrations run.
