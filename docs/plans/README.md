# Execution plan — proposals 50–88

Phased breakdown of the gap analysis in `docs/proposals/90-gap-analysis-50-88.html`.
Every task cites a `file:line` or a table verified live against Supabase
`toacecaewujfxjfrjwco` on 2026-08-25. Anchors drift — re-grep before trusting a
line number (this repo's own rule).

## Who executes this plan, and what is pre-approved

**Role: Lead Principal Systems Architect.** Ten years building SaaS in this
domain; three years on Python automation and integration work; Python lead for
the skills layer and its CRUD operations. That is the seat the decisions in this
plan are made from — schema, write-paths, the skills that read them, and the
seams between the three.

### Standing authorisation — migrations

**Migrations are APPROVED BY DEFAULT.** Do not stop and ask before applying a
numbered migration; write it, state its effects, apply it, verify it.

What that does and does not change:

- **It removes the WAIT, not the REPORT.** CLAUDE.md still requires the
  write-path side effects and a short risk assessment stated BEFORE a migration
  runs. That rule exists because this database is shared with production, and
  pre-approval is not a reason to stop saying what a statement will do. Write
  the risk note, then apply — do not write it afterwards to justify what already
  happened.
- **Verify from `pg_constraint` and the live catalogue, never from the migration
  file.** An inline `CHECK` on `ADD COLUMN IF NOT EXISTS` is skipped whole when
  the column already exists, so the file is not evidence the constraint is
  there. Re-read the catalogue after every apply.
- **Deployment ORDER is still a live hazard.** A migration that a router already
  SELECTs from must land before that router deploys, or every read 500s. Say
  which order is required.
- **It covers migrations, not every write.** A numbered schema migration is
  pre-approved. A DATA change to live rows — a backfill, a re-point, anything
  that edits a customer's records — is a separate decision and is still raised
  first, with the reversal statement written down before it runs.
- **Irreversible remains irreversible.** A `DROP`, or anything that discards
  data no backup holds, is named as such and confirmed regardless.

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

1. **The PT ladders are now SHARED — done 2026-08-26.** All nine
   `pay_professional_tax` rows belonged to Aekam Inc, so neither in-scope org
   could see any. On the owner's instruction their `org_id` was set to NULL,
   making them a shared national ladder that `_pt_slabs` reads for everybody.
   Verified after: both orgs now resolve all 9 rows, **3 Maharashtra bands for
   E2E and 4 Gujarat for Unicode** — exactly the two ladders they need.
   Reversible with `UPDATE staging.pay_professional_tax SET org_id =
   '045b76ad-654b-42dd-b4b1-731700efc6c3' WHERE org_id IS NULL;`.
   ⚠ **This alone does not make PT non-zero.** A slab is matched on the
   EMPLOYEE's state, and that is still 0 of 71 and 0 of 26 — see item 2. The
   ladders are now visible; item 2 is what makes them apply.
2. **Employee work state — Unicode DONE, E2E still owed and it is urgent.**
   - **Unicode Group: backfilled 2026-08-26.** 25 employees set to `'24'` from
     `address->>'state'`. The residential-vs-workplace caveat turned out not to
     apply: every one of them read exactly `Gujarat`, one distinct value, and
     Gujarat is also the org's OWN state — so there is no cross-border case to
     get wrong. Verified: all 25 gross ₹18,000–₹150,000, above Gujarat's
     ₹12,000 top band, so the ladder charges ₹200 — **identical to what they
     were already paying**, but now derived rather than hardcoded. Two
     employees have no address state and remain unset.
   - **E2E Test & Associates: 0 of 71, and nothing to derive from.** No employee
     carries an address state. On the latest payslip run 60 employees were
     charged **₹12,000 of professional tax in total**; with no state that
     becomes **₹0** on the next run. Every one of them grosses ₹25,197–₹196,373,
     all above Maharashtra's ₹10,001 top band, so the correct figure is ₹200
     each — the same ₹12,000. Fixing it is one statement, and it is NOT run
     because nobody has asked for it:

         UPDATE staging.manav_employees SET state = '27'
          WHERE org_id = '64e7bea6-6abe-490c-a2a4-27a60c6be916' AND state IS NULL;

     Defensible for a TEST org whose own state_code is '27'; it is still a
     production write and an assumption about where 71 people work.

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
| **0** | [PHASE-0-owner-unblocks.md](PHASE-0-owner-unblocks.md) | Owner facts, decisions, credentials | owner time | **✅ all 31 answered 26 Aug** — 19 decided, 12 parked |
| **1** | [PHASE-1-write-paths.md](PHASE-1-write-paths.md) | Open the six NULL write-paths — **highest fan-out in the whole arc** | 1 week | — |
| **2** | [PHASE-2-correctness-fixes.md](PHASE-2-correctness-fixes.md) | Fix the six things the product gets **wrong today** | 3 days | — |
| **3** | [PHASE-3-billing-executable.md](PHASE-3-billing-executable.md) | Make billing run, then arm the cron | 2 days | — (0.17 decided **and shipped**) |
| **4** | [PHASE-4-invisible-screens.md](PHASE-4-invisible-screens.md) | Give the eight table-and-API-but-no-screen features a UI | 1 week | — |
| **5** | [PHASE-5-statute-wiring.md](PHASE-5-statute-wiring.md) | Wire the dated-law store into payroll & invoicing | 1 week | — |
| **6** | [PHASE-6-retire-duplicates.md](PHASE-6-retire-duplicates.md) | Retire the four duplicated models; freeze new modules; add the SQL-test rule | 3 days | owner OK to drop |
| **7** | [PHASE-7-territory-and-address.md](PHASE-7-territory-and-address.md) | Make territories ROUTE (they route nothing today), then draw them; Indian address capture | 1 week | — |

**Session split from 2026-08-27:** Phase 7 runs as its own planning/research
track (its plan is written but every step still needs building); Phases 3–6 run
as the delivery track. They share no files.

**Status, 2026-08-26:** Phase 0 answered (19 decided, 12 parked) · Phase 1 ✅
acceptance passed, all six counters live non-zero · Phase 2 ✅ 10/10 against the
deploy · Phase 5.1 shipped (dated ESI ceiling) · Phase 7 planned, not started ·
Phases 3, 4, 6 not started, none blocked.

**Parallelism:** Phases 1 and 2 touch different files and run in parallel.
Phase 0 runs alongside everything. Phase 3 no longer waits on anything: decision 0.17 is settled and shipped
(`backend/routers/client_billing.py:1294`). Phases 4, 5, 6 are independent of each other.

**Why this order:** Phase 1 is first because it is the highest-fan-out item in
the entire arc — one week of write-paths turns ~18 already-built, already-tested,
inert features back on. Phase 2 is beside it because those are the only items
where a customer is *harmed* by using the product as built (one writes payslips
for people who have left). Everything else is value that is merely *absent*, not
*wrong*.
