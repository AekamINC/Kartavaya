# E2E programme — status and handover

Last run **2026-08-03**: `82 passed, 0 failed, 1 skipped` against
`staging.kartavaya.com`. The plan is `E2E-PROGRAM-2026-08-03.md`; this file is
where it actually stands.

---

## Branch incident, 2026-08-03 — RESOLVED

Between 20:47 and 21:05 UTC the staging service tracked `main` instead of
`staging` and served a commit 1,069 behind, so nothing shipped that day was
live. Repointed to `staging` on the owner's instruction and verified: e-sign
`rebuild`, `/org/memberships` and bank-statement import all answer again.

**The lesson worth keeping:** a green suite proves nothing if you have not
checked WHAT IS DEPLOYED. Two pushes produced no deployment at all and the only
symptom was 404s that looked like missing features. Full account in the
`staging-branch-switch` memory.

## Running it

From `frontend/`:

```bash
npx playwright test --config e2e-real/real.config.ts --grep-invert "\[token\]"
```

Every test records **video, a trace and a screenshot**. This environment cannot
run `--headed` (it fails with `spawn UNKNOWN`), so the report is how you watch
a run:

```bash
npx playwright show-report "%TEMP%\kartavya-e2e-downloads\report"
```

One suite per phase, sharing `_helpers.ts`:

| File | Covers | State |
|---|---|---|
| `real-user.spec.ts` | the original broad sweep | green |
| `full-journey.spec.ts` | invite → accept → onboarding → RBAC | green |
| `phase0.spec.ts` | the four Phase-0 defect fixes | green |
| `ganit.spec.ts` | Phase 1 — 10 tabs, 21 journeys | 21/21 |
| `graha.spec.ts` | Phase 2 — 17 tabs, 20 journeys | 20/20 |
| `vikray.spec.ts` | Phase 3a — 6 tabs, order → invoice | 11/11 |
| `vetana.spec.ts` | Phase 3b — payroll, both halves of four eyes | 12/12 |
| `manav.spec.ts` | Phase 4 — 12 tabs, hire → asset → leave → exit | **2 open** |

### The `[token]` lane

Two e-sign tests need `E2E_SIGN_TOKEN` and `E2E_SIGN_OTP`. The signing link and
the OTP exist **only in the signer's email** and are exposed by no API, by
design — either one is the whole authority to apply a binding signature. They
are **not skipped** when absent: they fail and say what to supply. The default
command excludes them by tag, which is a documented lane rather than a hidden
pass.

Verified manually on staging 2026-08-03: a 3-page PDF uploaded through the form
and signed through the signing page produced a **4-page executed PDF**.

---

## What the programme has found

### Fixed and shipped

| # | Defect | Commit |
|---|---|---|
| 1 | **E-sign produced no signed document at all.** The audit JSON was written into the columns named `signed_file_*`; the original PDF and the signatures were never combined. 11 of 27 completed docs had even that. | `e6fc972a` |
| 2 | **34 Srijan images bought, stored and invisible.** `quick_generate` charged 3 credits and wrote the URL only into `metadata.images`, never the `image_url` column the library reads. Two of three read paths also never re-signed the 9-hour presigned link. Visible went **6 → 40**. | `e6fc972a` |
| 3 | **Order-generated invoices were born fully paid.** `balance_due` was never written and defaults to 0 — invisible in receivables, nothing for a payment to reduce, and uneditable. Second, independent cause of "I can't edit an invoice from an order". | `e6fc972a` |
| 4 | **File upload 500'd for every org without R2.** The base64 fallback returned `key: None` into a NOT NULL column. Two of three staging orgs, **Aekam Inc included**. | `2afc6f36` |
| 5 | **A sales target could never be saved by anyone.** `vikray_targets.salesperson_id` was a uuid column; the picker stores `user_id`, which is text. Every save 500'd, and the read join `u.user_id = t.salesperson_id::text` could never match — 20 targets, 0 attached to a real person. | `eae0b912` |
| 6 | **No org switcher existed.** The resolver fell back to the user's OLDEST membership, so a member of two firms could only ever see one. | `165b2fd0` |
| 7 | **Bank statement import had never once worked.** `batch_id` is a uuid column and the code wrote `BSI-<timestamp>`. It 500'd for every org since it was written, and surfaced in the browser as a *CORS error* because FastAPI does not attach CORS headers to an unhandled 500. | `2b864aa8` |

### Open — one unresolved, deliberately red

**`manav.spec.ts` recruitment** — a job opening is created (POST succeeds,
`GET /job-openings` returns it, status `open`, ordered created_at DESC with no
cap) but does not appear on the Recruitment tab within 15s, even after
re-entering the tab to force a refetch.

**Not called a product bug**, because two explanations look identical from here:
the tab genuinely fails to render it, or the locator is wrong. Separating them
is the next job. Asserting either one without evidence is what produced the
receivables false alarm.

The two Phase-4 failures previously listed here are FIXED: the inter-state
invoice now picks a customer with no GSTIN (so the form cannot derive the split
and must offer the manual toggle), and the leave type waits for its refetch.

### Open — cross-org access (audited 2026-08-03, nothing changed)

The owner's rule is that Aekam must not see another org's data except by an
approved support request. Measured against it:

- **Ten accounts can resolve into any org** via the `X-Org-Id` header — 7 of the
  8 platform roles qualify, all except `platform_support`.
- **`platform_support`, the only role that requires approval, has zero holders.**
  The mechanism exists in code and is unused.
- **It has never been abused.** All 215 `platform.sensitive_module_access`
  events since 27 July are two people reading Aekam Inc's *own* org, both
  members of it. Zero cross-tenant reads.
- **The gap is what is not logged.** Only `ganit`, `manav`, `vetana` audit a
  platform bypass. Another org's CRM, e-sign, marketing, sales, messaging or
  biometric attendance can be read with **no trace** — 9 of 12 modules. The
  header bypass itself is never audited.

Full detail in the `cross-org-access-audit` memory.

### Open — product

- **No onboarding pack exists.** The scope asked for "pdf download to onboarding
  pack"; `routers/manav.py` has no PDF route at all and none of the eight
  document generators is an employee document. `manav.spec.ts` probes five
  plausible endpoints and asserts all 404, so it fails the day one is built.
- **An expense cannot carry a receipt.** `staging.ganit_expenses.receipt_urls`
  exists; the form has no file input. Asserted as `count() === 0` in
  `ganit.spec.ts`, so the test fails the day the control is added.
- **Two of three orgs have no R2 credentials**, so every uploaded file is stored
  as base64 in Postgres. Worth a decision before the file-heavy phases.
- **`full-journey.spec.ts` still contains five `test.skip` calls.** That pattern
  is what let e-sign report green for weeks while 403ing. The new suites do not
  use it; this file has not been rewritten yet.

---

## Rules the suites enforce

Every one of these was learned from a **false result** — a test that accused the
product of a fault that was mine.

1. **A missing control is a FAILURE, never a skip.** `test.skip(!opened, …)` is
   how a module returning 403 for the whole org reported green.
2. **Read the write response, not the list.** Ganit orders invoices by invoice
   date and the seeded data runs to Aug 2026, so a created invoice is not on
   page one — the test said "not created" while the screen said "created".
3. **Then fetch the canonical row.** `POST /invoices` echoes only id, number,
   total and doc_status, so asserting on the response turns every other field
   into `NaN`.
4. **List endpoints cap at 200 rows** whatever limit you ask for. Never
   reconcile a total by summing a list — assert a **delta** instead. Summing
   gave ₹1.06 Cr against a true ₹3.58 Cr and looked like a product bug.
5. **Poll selects that a fetch populates** (`pickOption`), and **wait for the
   refetch** after a write, not just the write. Both produced phantom findings.
6. **Scope lookups to the open form or tabpanel.** `getByLabel` is
   substring-matched, and module headers duplicate tab buttons.
7. **Watch for two requests behind one button.** The e-sign form creates the
   document *then* uploads the file; reading the row after the create caught
   `file_key = 'pending'`.

### Product-specific traps

- Graha tab labels are `id.replace(/-/g, ' ')` → **"follow ups"**, "web forms".
- `/graha/deals/pipeline` does not exist; it falls through to `/deals/{id}` and
  422s parsing "pipeline" as a UUID. The summary is `/pipeline-summary`.
- Required date fields that are **not defaulted** (expense date, follow-up
  `due_at`, which is `datetime-local`) block submit silently — the button looks
  dead rather than the field looking wrong.
- `esign` and `srijan` are **BUNDLED_MODULES**, gated on `plans.features`, not
  on `module_subscriptions`. Only the Growth and Scale plans carry `esign`.
  The module gate caches for **5 minutes**.

---

## Cost — read before running anything

The Railway bill hit **$31 in 10 days against a $5 plan**. Measured: egress is
NOT the cause (~0.36 GB/week). It is always-on compute for two environments plus
build minutes. **Running these suites spikes staging CPU from 0.006 to 0.74
vCPU** and makes the app visibly slow — do not run them while the owner is
demoing. See the `railway-cost` memory for the levers.

## Next session

~~Phase 3 — Vikray + Vetana~~ **DONE, 23/23.** Next is **Phase 4 — Manav HRMS**,
~52 operations: onboarding → onboarding-pack PDF, offboarding, leaves, assets,
attendance, shifts/bids/swaps, recruitment, performance.

The old Phase 3 detail, for reference: Vikray: customers,
orders (form/detail/rows), pipeline, stock, targets, dashboard, and order →
invoice (now gated, with `balance_due` correct). Vetana: structures, the run
lifecycle draft → process → approve **including the four-eyes refusal**,
payslips and the payslip PDF, loans, statutory.

Then phases 4–8 (Manav, Pahchan, Core PM, Prachar/Sanvaad/Srijan/e-sign,
Org/RBAC) and finally Phase 9 — Android via **Maestro**, since Playwright
cannot drive a native app. iOS is dropped.

**Fixture note:** the 2026-07 payroll run must be `processed` before the
separated-duty test runs. Restore it through the product, never SQL:
`POST /api/v1/vetana/payroll/process {"month":"2026-07"}` as the owner.
