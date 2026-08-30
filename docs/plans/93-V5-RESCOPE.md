# Proposal 93 · v5 rescope — the route file

**The document is `docs/proposals/105-93-v5-production-and-the-full-qa-set.html`.
Read it in full.** This file is a route, not a substitute — the single biggest
failure of the 28 Aug sessions was planning from a compressed summary of 93 and
silently losing most of its scope. **If you find yourself planning from a
summary, stop and re-read.**

Written 2026-08-30, after the QA gap audit, before the production window opens.

---

## What v5 is

**Same scope. Same rules. Same six stages, nine waves, twenty-two suites, R0–R9.
Three changes, and nothing else.**

| # | Change | Effect |
|---|---|---|
| 1 | **It runs on PRODUCTION** | Five new blocking gates (P1–P5). The gates get harder; the scope does not get smaller. |
| 2 | **The full QA discipline set** | 18 disciplines across 20 gates (D1–D20), each with an owner stage, a proving artefact and a blocking condition. |
| 3 | **Volumes drop again** | 30% on large sets, 50% on small, HELD sets untouched. **~1,566 → ~569 rows per org.** |

Carried verbatim: the seat (all seven hats), the four judgements, the operating
standards, Rules 1–3, the seven suite rules, the five organisations and their
dispositions, §12 (Aekam Inc untouched), §13 (excluded by decision, never
*blocked*).

⚠ **The calendar does not fall with the row count.** 10–13 days against v4's
12–14. Rows fall to a third; paths driven are unchanged and eighteen disciplines
are added. The saving is in typing and in production write volume, not thinking.

---

## The scale rule, in one line each

- **Large set** — v4 count ≥ 20 → **30%**, floor 1
- **Small set** — v4 count < 20 → **50%**, floor 1
- **HELD** — a set-cover, not a volume → **unchanged**. All 18 report types, 14
  Niyam rules, 6 custom fields, 4 PT/IT bands, both sides of the PO threshold,
  one template per compliance class, 9 senders, 3 UPI platforms, 6 doc series,
  3 bank files, 3 consecutive payroll months, 4 sites, 4 geofence refusals.
- **DERIVED** — a product of other quantities → **recomputed from its driver**,
  never scaled alone. Payslips = employees × months (8+8+5 = 21). Punches =
  employees × days × 2 × months (3 × 3 × 2 × 2 = 36). Scaling the product
  destroys the shape: three consecutive months becomes two, in/out becomes in.

**Two floors that are not arithmetic:** invoices never reach zero drafts (6 = 4
final + 2 draft), and deals keep all three outcomes including Lost *with a
reason*.

---

## The five production gates — every one blocking

| | Gate | Blocks |
|---|---|---|
| **P1** | Three-system inventory (Supabase · Railway · Cloudflare) → a written TOUCH and NEVER-TOUCH list, each row carrying its query | everything |
| **P2** | Blast radius — per-table `org_id` distinct-count across **300** base tables, not the 42 the old argument was measured over | any DELETE |
| **P3** | Outbound fence attested at runtime from `/api/health`, not from the dashboard variable | every wave that sends |
| **P4** | Recovery verified **before** the first delete — `check_backup_coverage.py` | R4′ |
| **P5** | Deploy identity — `meta.branch`, SHA and `current_schema()` on both services | every wave's verdict |

---

## Where the disciplines attach

| Stage | Disciplines gated |
|---|---|
| 1 · Inventory & freeze | P1 P2 P4 · D11 SCA · D17 schema · D18 recovery |
| 2 · Repair before re-find | D1 integration · D2 contract · D10 tenancy · D20 mutation |
| 3 · Wipe & rebuild | D9 performance · D13 a11y · D14 compatibility · D16 i18n · D19 visual |
| 4 · Replay on UK | D4 exploratory · D12 pen testing |
| 5 · Mobile, both AVDs | D7 regression · D14 compatibility · D20 mutation |
| 6 · Restore & close | D18 recovery |

**Two disciplines cannot be closed by this programme and are owner-blocked, not
skipped:** D15 usability (five strangers — proposal 104) and D12 pen testing
(an adversarial pass by someone who did not write the code).

---

## Wave order — one correction that is load-bearing

**Suite 19 (admin console) MUST precede Suite 14 (Sahayak).** Every credit
top-up route is `require_platform_role`, so the only door is Suite 19. In the
old order most of Suite 14's volume is structurally unreachable. Wave 6 now runs
19 → 17 → 14.

---

## Before Stage 1 opens — five things, and three are owner actions

1. **Bump `pyjwt` to 2.13.0** and run the backend suite. It signs every session
   this programme creates; five known vulnerabilities, fix published.
2. **Answer the recovery question** — Supabase backup retention and whether PITR
   is on. The only full-database path, and its parameters are unknown.
3. **Build the x86_64 APK** — `ARCHS=x86_64 bash mobile/scripts/build-apk.sh
   release`. Stage 5 has been blocked on this since 28 Aug.
4. **Decide `OUTBOUND_MODE` for the window** deliberately. On production,
   discovering it is not the same as choosing it.
5. **Fix O-13 before relying on D1** — the live-SQL ratchet counts a string, not
   a behaviour, so the discipline it enforces is currently unsound.

---

## The outstanding estate, swept 2026-08-30

Every open item across **105 proposals and 27 plans**, consolidated in §7 of the
proposal. Counts, by source:

| Source | Open |
|---|---|
| `PHASE-2` live blockers | 6 (L1–L6) |
| `93-F-OPEN-FINDINGS.md` | 19 of 22 — **one reclassified, see below** |
| Also-open from the suites | 5 (O-A … O-E) |
| `FINAL-VERDICT-00-90.md` §3 | 7 (V1–V7) |
| `93-E-ORPHANED-CAPABILITY-SWEEP.md` | 67 genuinely orphaned operations |
| `OWNER-ACTIONS.md` OPEN | 13 |
| 2026-08-30 QA audit | 8 (Q1–Q8) |

⚠ **These are citations, not measurements.** Nine were re-verified live for the
rescope and are marked ✎ in the proposal. **Stage 1 re-verifies the rest before
Stage 2 acts on any of them** — a finding filed on 27 Aug and fixed on 29 Aug
that is still "open" in a ledger is how a plan re-does work it already did.

### Two ledger entries the live read corrected

- **O-14 is NOT a tenancy hole.** One unscoped `is_org_admin` does remain at
  `approvals_router.py:570` against nine scoped call sites — but both statements
  it chooses between require a `project_assignments` row for the caller, so the
  unscoped answer can only widen the list to projects the caller is already a
  member of, and membership is org-bounded. Reclassified, and kept on record so
  the next sweep does not re-file it.
- **"0 of 98 employees linked to a login" is stale.** `manav_employees` is
  **empty** — the reseed took them. Wave 4 rebuilds from zero, so the link is
  typed, not repaired.
- Also stale: **"@mentions have never once worked"** — `mentions` holds 22 rows.
  Wave 2 asserts a delta, not a first row.

---

## Pointers

- The proposal: `docs/proposals/105-93-v5-production-and-the-full-qa-set.html`
- The brief every agent carries verbatim: `docs/plans/93-AGENT-BRIEF.md`
- What v5 supersedes: `93b-the-second-run.html` §4 (the volume plan) **only**
- Usability and UAT: `docs/proposals/104-uat-and-usability.html`
- Recovery: `docs/DISASTER-RECOVERY.md`
- The QA tooling that landed 2026-08-30: `docs/STATUS.md`, the entry headed
  "THE QA GAP AUDIT"
