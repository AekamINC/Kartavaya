# Finance & Operations Backend Audit — ganit, vikray, prachar, dristi

Agent branch: `rescue/a91ffbcdbce0c3ac0` (was `worktree-agent-a91ffbcdbce0c3ac0`; rescued after the
spend-limit stop, rebased on `staging`)
Scope: `backend/routers/ganit.py`, `vikray.py`, `prachar.py`, `prachar_ads.py`, `dristi.py`
Out of scope (other agents): `manav.py`, `vetana.py`, `graha.py`, `me.py`, `org_*.py`, approvals, messaging.

Suite: **419 passed**, 0 failed. Gates: `check-tokens` and `check-classes` both **exit 0**,
run from `frontend/` with unpiped exit codes.

> Gate note, per coordination §2: I initially ran the gates from the repo root through
> `| tail`, which reports **`tail`'s** status, not node's. That is the trap three agents
> fell into. From the root these scripts `process.exit(1)` — a **loud failure, not a
> silent pass**. The passing result above is from `frontend/` with the exit code read
> directly.

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

### The blocking contradiction — FLAGGED, NOT RESOLVED

This is coordination §5, and I reached it independently from the ganit side. It
needs the **owner**, not an agent:

- `RBAC-SPEC.md:65` / `PROPOSED_065` — *"Sensitive modules are role-derived, not
  granted. Vetana, Ganit and Manav have no per-member grant row at all."* A grant
  row naming a sensitive module is invalid input.
- The Tier-4 model — a grant row **carrying a level** is precisely how `approver`
  is held.

Both cannot be true. `org_member_modules` is forbidden for ganit; `user_roles`
carries only org_owner / org_admin / org_member. **There is no row anyone can
write today that means "may approve in Ganit."** Separated duty is not merely
unenforced — it is not representable.

**I have not resolved this, and deliberately so.** Enforcement built against the
wrong horn is worse than the current gap, because it would *look* enforced.

### What I shipped — dormant by construction

- `backend/middleware/module_levels.py` — the missing consumer for
  `level_satisfies()`: `require_level()` and `held_level()`.
- `require_level("ganit", APPROVER)` applied to the two actions that are not
  bookkeeping: **cancel invoice** (voids a tax document) and **vendor bill
  payment** (money leaves the company).
- **Live behaviour today is unchanged.** The resolver probes for an approver
  table; absent, it falls back to exactly the access org_owner / org_admin have
  now. Nothing is revoked by this deploy.

### PROPOSED_074 is ONE CANDIDATE, not the answer

`backend/migrations/PROPOSED_074_module_approvers.sql` sketches
`staging.org_module_approvers` — a separate table that would sidestep the
contradiction by holding approver as **depth only, never reach**, so
`RBAC-SPEC.md:65` keeps its "no per-member grant row" rule intact while approver
gets a home. Own audit columns; partial-unique so revoked rows are retained.

**It is a proposal for the owner to accept, reshape or reject.** I am not
asserting it is the right horn. If the owner instead decides Tier-4 wins and
sensitive modules *do* take levelled grant rows, then 074 should be discarded and
the enforcement re-pointed at `org_member_modules.role` — a small change to
`held_level()`, because the guard was written against the question, not the table.

> **If 074 is ever applied, it must not be applied without its seed.** Between
> `CREATE TABLE` and the first `INSERT`, no one in any org can cancel an invoice
> or pay a vendor bill — the resolver self-activates on the table's existence.
> Seeding options and verification queries are in the migration header.

### What I deliberately did NOT do

Ordinary ganit writes are **not** raised to `editor`. `DEFAULT_GRANT_LEVEL` is
`viewer` and existing rows predate the level column, so enforcing editor today
would revoke ordinary bookkeeping from real users with no migration to restore
it. That tightening needs a grant-level backfill first — and it needs the
contradiction settled. **Open work.**

---

## 3. Reachability — before / after

Roles: **PO** platform_owner/admin · **PM** platform_manager · **PS** platform_staff ·
**OO/OA** org_owner/org_admin · **OM+g** org_member with the module grant ·
**OM−g** org_member without it.

`ganit` is sensitive: PM and PS are refused by `require_module` and PO's pass is audited.

> **Enforcement as it IS, today, on this branch:** module *levels* are enforced
> nowhere that changes an outcome. `require_module` still checks only that a grant
> row exists. In ganit, `admin` satisfying `approver` is **not** hypothetical — it
> is the live behaviour, and my two guards fall back to permitting it because the
> approver table does not exist. The "After" column below marks what changes on
> deploy versus what waits on the owner's decision (§2).

### ganit — 52 endpoints

| Endpoints | Before | After (live now) | Once separated duty is settled |
|---|---|---|---|
| 48 reads/writes (products, invoices, expenses, contracts, recurring, vendors, bank, stats) | PO, OO/OA, OM+g | **unchanged** | editor tightening — open work |
| `POST /invoices/{id}/cancel` | PO, OO/OA, OM+g | **unchanged** — guard present but falls back | explicit approver only; PO refused too |
| `POST /vendor-bills/{id}/payments` | PO, OO/OA, OM+g | **unchanged** — same fallback | same |
| `GET /invoices/{id}/pdf` | all of the above | same roles, **409 if org has no GSTIN** and doc is a tax document | — |
| `POST /invoices/from-time-entries` | *nobody — 500 on every call* | PO, OO/OA, OM+g | — |
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

A sibling left all four documents to me. Field-by-field, against the rendered
design files in `design-reference/Kartavaya Redesign/docs/`.

### `Tax Invoice.html` — closest to complete

**Supplier block: fully supplied.** `download_invoice_pdf` selects name, gstin,
pan, billing_address, logo_url/key, email, phone, website, bank_details,
invoice_note — the shape the design's `ORGS` fixture mirrors.

**FIXED this pass — a field that existed and was never read:**

| Field | Was | Now |
|---|---|---|
| **Authorised signatory** + designation, and the **Rule 46** declaration | `organisations.authorized_signatory_name` / `_designation` have existed since the org-profile migration; `download_invoice_pdf` never selected them and the renderer had no block. **Every invoice the product has produced was missing its signature block.** | selected, rendered, and marked `Authorised signatory not set` when blank |

**Still missing — needs a schema addition (not proposed here; the document-pass
agent owns rendering and should shape the columns):**

| Field the design renders | Backend status |
|---|---|
| **Reverse charge** (Yes/No) | not in model or table |
| **Rounding** line (₹0.20) | not computed or stored; `_compute_invoice` never rounds to the rupee |
| **e-Invoice: IRN, Ack no., Ack date** | absent — no column, no endpoint, no IRP integration |
| **Shipped to** (address + contact name/phone) | absent from `ganit_invoices`; `vikray_orders` has `shipping_address`, ganit does not |
| Line-item **sub-description** ("42 hours @ ₹2,380/hr") | `LineItem` has no such field |
| **State code** ("· State code 27") | derivable — `gstin.state_code()` exists now, not yet surfaced |
| Aggregate **CGST/SGST rate label** ("@ 9%") | per-line `gst_rate` stored; aggregate half-rate not derived |
| "12 days overdue" badge | derivable from `due_date`; not returned |

### `Statement of Account.html` — no endpoint, but the data exists

Ganit has `/payables-summary` (vendor side, with ageing buckets) and **nothing on
the receivables side**. Everything needed is already in the tables — this is a
missing *endpoint*, not missing data:

| Design element | Source available today |
|---|---|
| Opening / closing balance, running ledger | `ganit_invoices` + `ganit_payments`, interleaved by date |
| Debit rows (INV-…) | `ganit_invoices` |
| Credit rows (RCPT-…) | `ganit_payments` — **but payments have no document number**; the design shows `RCPT-914`. `next_doc_number` has no `ganit_payments` entry |
| Ageing (current / 1–30 / 31–60 / 61–90 / 90+) | same CASE expression as `payables_summary`, pointed at receivables |
| MSME §43B(h) 45-day threshold date | derivable from `invoice_date`; **the MSME registration flag is not stored** |
| UPI QR | `organisations.bank_details.upi_id` exists; QR generation does not |

**Not built.** Closest to reachable of the three gaps.

### `GSTR-3B Summary.html` — no backend

Zero endpoints, zero tables (`grep -i "gstr"` across `backend/` returns nothing).
Needs: outward supplies split by nature (taxable / zero-rated / nil-exempt /
reverse-charge inward / non-GST), ITC split into available / reversed (rule 42-43)
/ ineligible (§17(5)), and a 6.1 payment table splitting tax paid via ITC vs cash.
`ganit_invoices` and `ganit_vendor_bills` could feed the supply side; **nothing
models ITC eligibility or reconciliation against GSTR-2B**, which the design shows
prominently ("59 matched in 2B", "Two purchase invoices excluded — HSN missing").

### `TDS Challan.html` — no backend, and a missing org field

Zero endpoints, zero tables. Needs per-section aggregation (194C contractors,
194J professional, 194I(b) rent, 194H commission, 192B salary).

- **192B salary TDS partially exists** — `vetana_payroll_runs.total_tds` and
  per-employee TDS in `vetana.py:350`. The design itself says it is "computed in
  Vetana", so the join is intended.
- **194C / 194J / 194I / 194H do not exist anywhere.** Vendor bills carry GST, not
  TDS — there is no deduction section, rate or amount on `ganit_vendor_bills`.
- **`organisations` has no `TAN` column.** A TDS challan cannot be issued without
  it (verified: only `gstin` and `pan` exist).
- BSR code, challan serial, tender date, CIN — all absent.

**Not started.** This is the largest of the four gaps and needs an owner decision
on scope before any schema is proposed.

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

Matches coordination §6: font stacks are fixed, **vendoring the real TTFs is still
open and needs a human on the Dockerfile**. A Tax Invoice in DejaVu is a fidelity
failure on a statutory document.

---

## 8. Upstream of my work, and unowned — bears directly on §5

My cross-tenant fixes all sit **downstream** of two holes that coordination §6
lists as unowned. Neither is in my files, and both partly undo what §5 achieves:

- **`org_resolver.py:31-40`** — four zero-reach platform roles can resolve **any**
  org via the `X-Org-Id` header. `get_org_id` is the dependency every one of my 128
  endpoints derives `org_id` from. If the wrong caller can choose the org, my
  per-query scoping is scoping to an org they should never have reached.
- **`roles.py:74`** — hardcodes `role_code = 'platform_admin'`, excluding
  `platform_owner`: the exact lockout `role_tiers.py:115-121` warns about.

I did not touch either — they belong to whoever owns `middleware/`. Flagging
because a reader of §5 could otherwise conclude the finance modules are
tenant-safe end to end. They are safe *given a correct `org_id`*.

---

## 9. Not finished / handed on

- **The RBAC contradiction (§2)** — owner decision. Everything else about
  separated duty waits on it.
- **Editor-level enforcement** on ordinary ganit writes — needs a grant-level
  backfill, and the contradiction settled first.
- **PROPOSED_074** — a candidate, not a decision. Must not be applied unseeded.
- **GSTR-3B and TDS Challan** data layers — not started; TDS additionally needs a
  `TAN` column on `organisations` and TDS sections on vendor bills (§6).
- **Statement of Account** endpoint — data exists, endpoint does not; also needs a
  receipt document number and an MSME registration flag (§6).
- **Remaining invoice fields** (reverse charge, rounding, IRN/Ack, ship-to,
  line sub-description) — need a schema addition; I did not propose one because
  the document-pass agent owns rendering and should shape the columns.
- **Newsreader / Tiro TTF vendoring** + Dockerfile edit — needs approval (§7).
- **`esign_service.py:66,114` broken email import** — one-line fix, another
  agent's file, and it silently breaks ganit's send-for-signature (§5.8).
- **`_compute_invoice` rounding**: ganit splits CGST/SGST as `round(gst/2, 2)`
  twice; `generate_recurring_invoice` uses `half, total - half`. On odd amounts
  they disagree by a paisa. **Not fixed** — changing tax arithmetic without the
  owner's sign-off is not a call I should make.

### Note on coordination §8

The known-failing `test_ganit.py::test_create_invoice_success` is **fixed on this
branch**, at the root cause the coordinator identified: `conftest.make_pool()`
left `conn_mock.fetchval` a bare MagicMock, so `next_doc_number` awaited a
non-awaitable. Two lines in `conftest.py`. It was a harness gap that read like a
product bug — worth fixing rather than routing around, since it silences any
future test that creates an invoice, order or payslip.

---

## 10. Files changed

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
