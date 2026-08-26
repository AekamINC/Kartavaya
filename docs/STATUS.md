# Kartavya — live status ledger

**This file is the single source of truth for what is built, half-built, and
broken. Keep it current.** It exists so the team never again has to spend a
session reconstructing state from thirty scattered status proposals — which is
exactly how proposals 00, 07, 21, 27, 82 and 90 each came to be written.

- **Update this file the moment a phase item lands or a status changes.** It is
  part of "done", not an afterthought (see `CLAUDE.md` → *Keeping status current*).
- The deep history lives in `docs/proposals/`; the plan in `docs/plans/`; the
  arc in `docs/FINAL-VERDICT-00-90.md`. **This is the dashboard, not the archive.**

Last updated: **2026-08-26**. **BOTH deploys verified — check both, always.**
Backend: Railway staging at `cc371297`, SUCCESS 12:25 UTC (thirteen deploys
after the 04:14 `120d106c` build this line used to name; `1963c128` went live
08:45:24 and the Phase-2 acceptance ran against it 84 seconds later). Frontend: Vercel
serves the current branch build, confirmed from OUTSIDE by hashing the assets
`staging.kartavaya.com` actually returns — every Vercel deployment here has
`target: null`, so "READY" alone never establishes what the domain serves.
Everything below marked "fixed 26 Aug" is therefore **running**.

Legend: ✅ done · 🟡 half (code but no data/screen, or partial) · 🔴 wrong now
(broken in the running product) · ⬜ not started · 🔵 research/decision · ➖ n/a

---

## Live blockers — wrong in the running product (fix first: `PHASE-2`)

| | Blocker | Where | Status |
|---|---|---|---|
| 🟢 | Dunning chased 54 documents nobody owes money on | `reminder_service.py:_INVOICE_SCAN` | **FIXED 26 Aug.** Phase 2 closed "draft invoices dunned" across four surfaces and **missed the one that sends the email**. Live before the guard: **359** `invoice_overdue` rows against drafts, credit notes and zero-balance invoices — 347 in E2E where the outbound fence suppressed them, **12 in Unicode Group where it did not**. One went out at 13:04 UTC reading *"Invoice INV-2026-0007 is overdue. Balance: ₹0.00"*. Three guards added; 228 dunnable → 174 |
| 🟢 | Payroll pays 10 leavers | `vetana.py:1221` | **DEPLOYED 26 Aug** — guard live at `120d106c`, mirrors `metrics/manav.py:79`. **PROVEN BY A RUN, not a dry-read.** The E2E 2026-08 run executed 08:46:48 UTC against the deploy: **51 payslips, not 60**, `present_days` spanning 2 to 26 — the mid-month leaver credited 2 days, not a month |
| 🟢 | Professional tax is now settable, not hardcoded | `vetana.py`, `PtLadderSection.jsx` | **Migration 221 APPLIED** — `month smallint NULL` (NULL = every month), verified from `pg_constraint`. Nothing could write `pay_professional_tax` before: every backend reference was a read. Now a per-org ladder with a settings screen, resolving `org+month → org+all → shared+month → shared+all → ₹0` — falls back, never refuses. A shared row is read by everyone and editable by nobody. The Maharashtra February figure is deliberately NOT seeded: `statute_calendar` has no PT rows to check it against |
| 🟢 | Flat ₹200 professional tax, every state | `vetana.py:746` | **DEPLOYED 26 Aug** — slab read live. All 9 `pay_professional_tax` rows re-pointed to `org_id IS NULL` (shared): MH `27`×3, GJ `24`×4, KA `29`×2 — verified live. Employee states backfilled for BOTH payroll orgs (Unicode 25/26 → `'24'`, E2E **71/71 → `'27'`**), so PT does NOT drop to ₹0. **The run happened.** Actual: **₹10,000** across 51 — not the ₹10,200 predicted, because pro-rating drops the leaver's gross into the ₹0 band. The two fixes composing correctly, which a prediction from either one alone could not have got right. Phase 0.24 seeding is no longer the blocker it was |
| 🟡 | Two billing endpoints 500 | `client_billing.py:459,705` | **DEPLOYED 26 Aug** — `gst_rate` dropped, `invoice_number` allocated, `balance_due` bound (2nd bug found). Row on the board still owed — needs one real create |
| 🟡 | Draft invoices dunned + counted as revenue | `documents.py:307`, `dristi.py:354` | **DEPLOYED 26 Aug** — 4 surfaces. ⚠ The statement had ALSO been 500ing on a date bind since it shipped; fixed. Still open: project report dead on `staging.time_entries` (exists only in `public`); `dristi.py` `/overview` + the pivot dashboard still count drafts and the pivot carries the same date-bind bug |
| 🟢 | Cross-tenant leak — profile create/list not org-scoped | `client_billing.py:220` | **DEPLOYED 26 Aug** — ownership check + **7** id-alone joins (plan named 2); AST ratchet added. 0 rows had leaked |
| 🟢 | Inline pre-paint bootstrap blocked by a stale CSP hash | `vercel.json`, `index.html` | FIXED + DEPLOYED 26 Aug (`2ef060a9`) — one inline script, one allowed sha256, no match, so `data-theme`/`data-conv-*`/`data-platform` never ran: wrong-theme flash every load, and on Windows a frame of blurred sidebar. Found in the DEPLOYED console, invisible to build and tests. `check-csp-hash.mjs` now first in `npm run check` |
| 🔴 | `/security` page claims no MFA (TOTP shipped 23 Aug); 3 undisclosed sub-processors | `SecurityPage.jsx:161`, `legalFacts.js` | OPEN |

## Seeded-data integrity — repaired 26 Aug

Owner confirmed **"no live users or legal payslip, all are seeded"**, which
released seven items the sweep's adversarial brake had held. All reversible from
schema `ledger_repair_20260826`.

| Repaired | Detail |
|---|---|
| ✅ 6 payments deleted | 4 receipts against DRAFT invoices (₹2,06,500 + ₹5,000 + ₹5,000 + ₹590), 1 against a CREDIT NOTE (₹2,950), 1 of ₹60,000 against a ₹0 invoice. Their invoices reset to unpaid. `record_payment` now refuses all three shapes, so none can recur |
| ✅ 1 born-paid invoice | INV-2026-0048 — ₹53,100 total, ₹0 balance, no payment row — now owes its full amount |
| ✅ 3 expense claims detached | Approved claims (₹800 + ₹1,200 + ₹5,000, Unicode) pointing at payslips that were voided and never disbursed |
| ✅ 1 phantom payroll run | Jan 2020, 0 payslips, 0 employees. `org.spec.ts:197-211` asserts a **refusal** (≥400) for that month, so nothing depended on the row existing |
| ➖ holiday "duplicates" | Not duplicates — distinct names sharing a date (Dussehra and Gandhi Jayanti both 2025-10-02). 0 exact `(org, date, name)` twins remain |

**Verified after, both orgs:** 0 payments against a draft / credit note / ₹0
invoice · 0 invoices where `balance_due <> total − Σpayments` · 0 born-paid · 0
claims on a voided payslip · 0 phantom runs.

**Nikhil Desai — CLOSED by removal, owner's instruction 26 Aug.** He was
missing July and August pay (≈₹73,077 on the product's six-day basis, not the
₹72,322 first published — every August payslip uses `working_days=26`). Rather
than build a re-run path for a `processed` month, the owner chose to delete the
seeded employee outright. Removed: the employee, 3 payslips, 1 salary structure,
1 offboarding row, 4 leave balances, 1 leave request, 1 exit interview — 12 rows,
all backed up to `ledger_repair_20260826.nikhil_*`. Unicode headcount 27 → 26.

**Six junk vendors removed** — four named `p`, two named `probe`, a 72-second
burst of write probes from 2026-07-28, 6 of Unicode's 15 and all six live in the
vendor picker. Verified orphaned across every vendor-referencing column *before*
deleting. Nine real suppliers remain.

## Open, found 26 Aug, NOT fixed

**Arming `/cron/billing` would back-bill a real customer's client to April.**
Phase 3.4 is the last step of Phase 3 and it is NOT done, deliberately. Read
live 2026-08-26: all **four** `client_service_lines` in the product belong to
**Unicode Group** — the real customer — and **two carry `auto_invoice = TRUE`**:

| Line | Amount | Cadence | Running since |
|---|---|---|---|
| Monthly accounting retainer | ₹75,000 | monthly | 2026-04-01 |
| Payroll processing (up to 50 employees) | ₹15,000 | monthly | 2026-04-01 |

`client_invoice_lines` is **empty**, so nothing records these as billed. With
3.3 in place the sweep advances one period per run: the first tick raises
**April**, the next day May, and so on — **10 tax invoices, ₹4,50,000 + ₹81,000
GST, with serials drawn from Unicode's live sequence**, unattended. E2E Test &
Associates has **zero** service lines, so arming proves nothing there either.

The owner decides which of these it is before anything is armed:

1. **Start the clock now** — only the current period is raised (₹90,000 + GST).
   Needs a live-row write: either move the two lines' `period_start` to August,
   or record Apr–Jul as billed. Reversal written down first, as always.
2. **Back-bill deliberately** — five months of work genuinely delivered and
   never invoiced, raised as ten documents his client will receive.
3. **Leave Unicode alone** — prove the sweep in E2E only (a profile and a
   service line created through the UI as a real user), arm later.

Nothing about 3.2 or 3.3 waits on this; both are shipped. `sweep_client_auto_invoices`
now takes an optional `org_id` so the acceptance can be run against the test org
without writing into a customer's books — the cron still passes nothing and
sweeps everybody.

**Unicode's payroll run headers have never matched their payslips.** Five of
their eight runs disagree with the rows beneath them; **E2E is clean on all 17**,
so this is not a code path everyone hits.

| Run | Header says | Payslips actually |
|---|---|---|
| 2026-04 `disbursed` | 23 / ₹12,80,846.14 | **28** / ₹15,58,196.14 |
| 2026-05 `disbursed` | 23 / ₹12,79,538.45 | **28** / ₹15,56,888.45 |
| 2026-06 `disbursed` | 24 / ₹13,27,000.00 | **30** / ₹16,19,350.00 |
| 2026-07 `approved` | 24 / ₹14,12,055.56 | **30** / ₹14,65,334.87 |
| 2026-09 `draft` | 0 / ₹0.00 | **6** / ₹2,92,350.00 |

**This predates today and was not caused by the Nikhil removal** — proven from
the pre-deletion snapshot in `ledger_repair_20260826.nikhil_runs_before`: the
April header already said 24 against 29 payslips. The removal decremented three
headers by exactly his contribution, which was correct arithmetic on a number
that was already wrong.

A run header is what every payroll list, cost tile and analytics band reads —
nobody re-sums the payslips. So five Unicode runs report a headcount and a gross
that the payslips beneath them contradict. **Not fixed, and deliberately not
fixed today:** the right repair is not obvious (is the header wrong, or are
there payslips that should never have been written?) and it needs the same
treatment the ledger repair got — a written risk report first.

## Phase progress (`docs/plans/`)

| Phase | What | State |
|---|---|---|
| 0 | Owner unblocks (31 items) | 🟢 **all 31 answered 26 Aug** — 19 decided, 12 parked by the owner. Nothing here awaits him. Build halves still open: 0.20 PayablesTab vendor form · 0.22 `tasks.client_id` · 0.23 dummy role logins · 0.24 more PT states · 0.27 estimate rate card · 0.29 fresh APK |
| 1 | Six write-paths (turns ~18 features on) | ✅ **ACCEPTANCE PASSED 26 Aug** — all six counters are live non-zero, every set row created through the UI today. Live, both orgs: invoices `salesperson_id` **5**/800 · orders **3**/380 · vendors MSME/TDS **12**/90 · expenses `contact_id` **9**/385 · employees `state` **110**/110 · holidays `state_code` **11**/48. The old "0/790, five of six still need a real create" table was written at 06:48 and never refreshed after `775b1bcc` landed at 08:36 |
| 2 | Six correctness fixes (the blockers above) | ✅ **ACCEPTANCE PASSED 26 Aug — 10/10, driven as a real user against the deploy.** Payroll run for 2026-08: **51 paid, not 60**; the mid-month leaver credited **2 present days of 26**, not a whole month; PT **₹10,000** from the Maharashtra ladder (not ₹10,200 — pro-rating drops that leaver's gross into the ₹0 band, which is the two fixes composing correctly); Dristi overview **₹11,14,93,756.12** invoiced against ₹12,29,86,008.58 before, outstanding **₹2,71,54,767** against ₹3,86,36,429.46, with ₹54,78,968.92 of drafts on the books and excluded; cross-tenant profile create refused; pahchan metrics computing. All six are coded and deployed, and **nine further defects found by verifying them are now fixed**: payroll paid a part-month as a whole one (₹41,262 on one payslip), `/cron/hr` marked attendance for leavers, Dristi `/overview` carried a **₹1,14,92,252.46 draft phantom**, a draft could be marked *paid* (Unicode, ₹2,06,500), the 2.5 ratchet covered one module of 42 id-alone joins, two user-facing claims were false, 2.3's writer violated 1.3, and analytics banded 60 where payroll pays 51. |
| 3 | Billing executable + arm cron | 🟡 **3.2 and 3.3 coded, tested and deployed 26 Aug; acceptance still owed and 3.4 is now owner-blocked.** 3.2 — a mid-cycle plan change raised **two debits**; the credit is a `kind='credit'` line (migration 222, verified from `pg_constraint`) that every total, the preview and `invoice_billing_lines` now subtract. Day-count unified on 0.17: `proration.py` counted 31 days for August 2026 where payroll counts 26, so every credit was priced against a month the payslip beside it did not recognise. 3.3 — the sweep recomputed the period from the service line's **origin** on every run, so a monthly retainer invoiced **once, for ever**, and reported it as `skipped`; it now advances from the last invoiced period, one period per run. Live-parsed against the real schema (`tests/test_billing_credit_sql_is_valid.py`, 7 green under `railway run`). **3.4 arming is NOT done and must not be armed yet** — see the open finding below: the first tick would raise 10 real invoices, ₹4,50,000 + GST, against Unicode Group's client, back to April |
| 4 | Eight invisible-feature screens | ⬜ |
| 5 | Statute calendar → payroll/invoicing | 🟡 **5.1 shipped 26 Aug** — ESI wage ceiling now read from `statute_calendar` at the run's period end (`vetana.py:842`), so a re-run of an old month uses that month's law. Deliberately changes no payslip: the dated ceiling equals the literal it replaced. 5.2/5.2b/5.3 open — the IT ladder is one row per band |
| 6 | Retire 4 duplicate models + SQL-test rule | ⬜ |
| 7 | Territories ROUTE + Indian address capture | ⬜ **plan rewritten from a live audit 26 Aug** — every claim re-measured. `rules.pincodes` still has ZERO backend consumers, and `assign-next` has zero callers anywhere. **But nothing can route even with a perfect resolver: no contact form captures a PIN, `territory_id` is unreachable from every API path, and no territory edit form exists.** Live: 17 territories, **0 with a PIN, 0 with a member**, 0 of 289 contacts routed. New 7.0 (capture) precedes 7.1; 7.1a closes three cross-tenant territory joins that 7.1 would otherwise activate |

## Module / proposal state (condensed — full detail in proposal 90)

| Area | Proposals | State |
|---|---|---|
| Core PM (tasks, boards, board-arrange, pulse) | 67, 68 | ✅ |
| Niyam automation | 55–59, 66 | 🟡 armed; 20/35 event types |
| Analytics suite | 60–65 | ✅ through S6 (mobile S7 deferred) |
| Skills / dock / Sahayak | 69–72 | 🟡 dock built, Due tab dead; ack 32/78, 0 rows, no UI |
| Reports | 70, 73, 75 | 🟡 15 registers; ~23 of 34 defs missing |
| Commission & P&L | 76 | 🟡 built; rate uneditable, `salesperson_id` NULL |
| Procurement / Kray | 77, 85 | 🟡 built; can't send a PO; vendor MSME now enterable (26 Aug, 0 rows yet) |
| Compliance settings | 80 | 🟡 table+API, no screen, 0 rows |
| Legal / MFA docs | 81 | 🟡 4 pages, not in prod, 9 owner facts |
| R2 storage | 83 | 🟡 grammar+verifier; no tab, 0 objects |
| Employee onboarding | 84 | ⬜ ~95% unbuilt |
| Platform billing | 86 | 🟡 P1/P2 code; P3/P4/P6 absent, cron unarmed |
| Org-client billing | 87 | 🔴 router 500s; recurring doesn't recur; leak |
| Liquid glass | 88, 89 | ✅ record; rescope done; enriched 2026-08-25; Apple-pass (buttons/tiles/modal) 2026-08-25 |
| WhatsApp channel | 38, 39 | ⬜ owner creds (Phase 0.26) |
| RAG / KB index | 08 | 🔴 empty always; answers grounded on nothing |
| Employee↔login join | 05 | 🔴 0 of 98 linked; gates payslips + payroll |

## Structural debt (`PHASE-6`)

- 48 zero-row tables · 16 NULL feature columns with no write path
- 4 models built twice (sales_commission* / hr_*+pay_* / 2 doc allocators / 2 report schedulers)
- `statute_calendar` read by skills and by payroll's ESI ceiling; PF, PT and both TDS ladders still literal (5.2)
- No router test executes its own SQL ← the rule that would catch every 🔴 above

---

## How to keep this file honest

1. Every landed change: flip the relevant row here, and append a line to
   `docs/plans/PROGRESS.md` with the evidence (file:line, table + row count, or
   commit).
2. Never mark a row ✅ on "the code shipped" alone — this whole document exists
   because "DONE" was claimed on code with no data. ✅ means **a customer can
   complete the flow end to end**, proven by a row appearing where there were
   zero. Otherwise it is 🟡.
3. Verify status claims against the live DB, not the migration folder.
