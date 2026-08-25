# Execution plan — proposals 50–88

Phased breakdown of the gap analysis in `docs/proposals/90-gap-analysis-50-88.html`.
Every task cites a `file:line` or a table verified live against Supabase
`toacecaewujfxjfrjwco` on 2026-08-25. Anchors drift — re-grep before trusting a
line number (this repo's own rule).

## Ground rules (from CLAUDE.md — do not relearn these the hard way)

- **Staging and production share one Supabase DB.** Every migration and every
  write-path probe touches production data. State write-path side effects
  before any migration; back up anything irreversible to a restore schema.
- **Never test validation by writing to the live DB.** Confirm the deployed SHA
  (`meta.branch`) before trusting a probe.
- **Backend tests from `backend/`**, never repo root (`cd backend && python -m pytest -q`).
- **`npm run check` exits 0 on unparseable CSS** — run `npm run build` before
  pushing style changes.
- **A router does not ship without one test that executes its SQL** against the
  real schema. This is the single rule that would have caught the two billing
  500s and the payroll leaver bug. Phase 90's §6.7.
- Never render a user/member/org UUID in any UI (`check-rendered-ids.mjs`).

## The phases, in order

| Phase | File | What | Effort | Blocks on |
|---|---|---|---|---|
| **0** | [PHASE-0-owner-unblocks.md](PHASE-0-owner-unblocks.md) | Owner facts, decisions, credentials — **start today, none of it is engineering** | owner time | you |
| **1** | [PHASE-1-write-paths.md](PHASE-1-write-paths.md) | Open the six NULL write-paths — **highest fan-out in the whole arc** | 1 week | — |
| **2** | [PHASE-2-correctness-fixes.md](PHASE-2-correctness-fixes.md) | Fix the six things the product gets **wrong today** | 3 days | — |
| **3** | [PHASE-3-billing-executable.md](PHASE-3-billing-executable.md) | Make billing run, then arm the cron | 2 days | Phase 0 decisions |
| **4** | [PHASE-4-invisible-screens.md](PHASE-4-invisible-screens.md) | Give the eight table-and-API-but-no-screen features a UI | 1 week | — |
| **5** | [PHASE-5-statute-wiring.md](PHASE-5-statute-wiring.md) | Wire the dated-law store into payroll & invoicing | 1 week | — |
| **6** | [PHASE-6-retire-duplicates.md](PHASE-6-retire-duplicates.md) | Retire the four duplicated models; freeze new modules; add the SQL-test rule | 3 days | owner OK to drop |

**Parallelism:** Phases 1 and 2 touch different files and run in parallel.
Phase 0 runs alongside everything. Phase 3 waits only on the day-count decision
(0.17). Phases 4, 5, 6 are independent of each other.

**Why this order:** Phase 1 is first because it is the highest-fan-out item in
the entire arc — one week of write-paths turns ~18 already-built, already-tested,
inert features back on. Phase 2 is beside it because those are the only items
where a customer is *harmed* by using the product as built (one writes payslips
for people who have left). Everything else is value that is merely *absent*, not
*wrong*.
