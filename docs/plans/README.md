# Execution plan — proposals 50–88

Phased breakdown of the gap analysis in `docs/proposals/90-gap-analysis-50-88.html`.
Every task cites a `file:line` or a table verified live against Supabase
`toacecaewujfxjfrjwco` on 2026-08-25. Anchors drift — re-grep before trusting a
line number (this repo's own rule).

## Scope — TWO organisations, and only two

**Owner's call, 2026-08-26. Every phase in this plan is delivered against these
two organisations. Do not spend a minute on the other three.**

| Org | org_id | State | Why it is in scope |
|---|---|---|---|
| **E2E Test & Associates** | `64e7bea6-6abe-490c-a2a4-27a60c6be916` | `27` Maharashtra | The seeded test org — ~5,600 rows, runs payroll (960 payslips), the org every e2e spec drives |
| **Unicode Group** | `fae87907-2f99-4b35-a241-c94d9e1e4a17` | `24` Gujarat | The real customer — runs payroll (152 payslips), real invoices, real employees |

**Out of scope: Aekam Inc, Demo - Kartavaya, UK AekamINC.** They will show gaps
— missing `state_code`, refused auto-invoices, empty reports. That is expected
and is not a defect to chase. If a probe or a report looks broken, check which
org it ran against BEFORE investigating.

"A phase is delivered" therefore means: **it works end to end for these two
orgs.** Not for all five, and not in the abstract — a row appearing where there
were zero, in one of these two.

### What these two still need (read-only, 2026-08-26)

Both carry a `state_code`, so the billing tax-split refusal never fires for
either. What is outstanding is the same two items for both, and one of them is
a single UPDATE:

1. **Professional tax is ₹0 for both** until slabs reach them. Neither owns a
   `pay_professional_tax` row; all nine live rows belong to Aekam Inc and are
   exactly the two ladders these orgs need (3 Maharashtra bands, 4 Gujarat).
   `_pt_slabs` now reads a NULL-`org_id` row as a SHARED ladder, so
   `UPDATE staging.pay_professional_tax SET org_id = NULL;` (9 rows) fixes both
   at once. Not run — a production write, owner's call.
2. **Employee work state is 0 of 71 and 0 of 26**, and the two need different
   answers: Unicode has `address->>'state'` on 24 of 26 (backfillable, with the
   residential-vs-workplace caveat), while **E2E has nothing to derive from at
   all** — all 71 must be entered through the form.

Full per-org detail and figures: `PROGRESS.md`, 2026-08-26.

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
- **Verify against the two in-scope orgs above.** A probe run against
  Aekam Inc, Demo or UK AekamINC will show gaps that are out of scope by
  decision, not bugs — and chasing one is how a day disappears.

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
