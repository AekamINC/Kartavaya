# Kartavya — live status ledger

**This file is the single source of truth for what is built, half-built, and
broken. Keep it current.** It exists so the team never again has to spend a
session reconstructing state from thirty scattered status proposals — which is
exactly how proposals 00, 07, 21, 27, 82 and 90 each came to be written.

- **Update this file the moment a phase item lands or a status changes.** It is
  part of "done", not an afterthought (see `CLAUDE.md` → *Keeping status current*).
- The deep history lives in `docs/proposals/`; the plan in `docs/plans/`; the
  arc in `docs/FINAL-VERDICT-00-90.md`. **This is the dashboard, not the archive.**

Last updated: **2026-08-25**

Legend: ✅ done · 🟡 half (code but no data/screen, or partial) · 🔴 wrong now
(broken in the running product) · ⬜ not started · 🔵 research/decision · ➖ n/a

---

## Live blockers — wrong in the running product (fix first: `PHASE-2`)

| | Blocker | Where | Status |
|---|---|---|---|
| 🔴 | Payroll pays 10 leavers (`is_active` join, no last-working-day guard) | `vetana.py:~283/940` | OPEN |
| 🔴 | Flat ₹200 professional tax, every state (9-row slab table read by nothing) | `vetana.py:542` | OPEN |
| 🔴 | Two billing endpoints 500 (`gst_rate` col absent, `invoice_number` omitted) | `client_billing.py:399,629` | OPEN |
| 🔴 | Draft invoices dunned on statements + counted as revenue | `documents.py:281`, `dristi.py:332` | OPEN |
| 🔴 | Cross-tenant leak — profile create/list not org-scoped | `client_billing.py:188` | OPEN |
| 🔴 | `/security` page claims no MFA (TOTP shipped 23 Aug); 3 undisclosed sub-processors | `SecurityPage.jsx:161`, `legalFacts.js` | OPEN |

## Phase progress (`docs/plans/`)

| Phase | What | State |
|---|---|---|
| 0 | Owner unblocks (31 items) | ⬜ awaiting owner |
| 1 | Six write-paths (turns ~18 features on) | 🟡 1.1 salesperson_id code done; 1.2–1.6 to do |
| 2 | Six correctness fixes (the blockers above) | ⬜ |
| 3 | Billing executable + arm cron | ⬜ (blocks on 0.17) |
| 4 | Eight invisible-feature screens | ⬜ |
| 5 | Statute calendar → payroll/invoicing | ⬜ |
| 6 | Retire 4 duplicate models + SQL-test rule | ⬜ |

## Module / proposal state (condensed — full detail in proposal 90)

| Area | Proposals | State |
|---|---|---|
| Core PM (tasks, boards, board-arrange, pulse) | 67, 68 | ✅ |
| Niyam automation | 55–59, 66 | 🟡 armed; 20/35 event types |
| Analytics suite | 60–65 | ✅ through S6 (mobile S7 deferred) |
| Skills / dock / Sahayak | 69–72 | 🟡 dock built, Due tab dead; ack 32/78, 0 rows, no UI |
| Reports | 70, 73, 75 | 🟡 15 registers; ~23 of 34 defs missing |
| Commission & P&L | 76 | 🟡 built; rate uneditable, `salesperson_id` NULL |
| Procurement / Kray | 77, 85 | 🟡 built; can't send a PO; vendor MSME unenterable |
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
- `statute_calendar` read by skills only, not payroll
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
