# Proposal 93 · v5 rescope — the route file

**The document is `docs/proposals/105-93-v5-production-and-the-full-qa-set.html`.
Read it in full.** This file is a route, not a substitute — the single biggest
failure of the 28 Aug sessions was planning from a compressed summary of 93 and
silently losing most of its scope. **If you find yourself planning from a
summary, stop and re-read.**

Written 2026-08-30, after the QA gap audit, before the production window opens.

---

## §0 is the contract — read it, do not summarise it

⚠ **The first cut of v5 said "carried verbatim: the seat, the four judgements,
the operating standards, Rules 1–3, the seven suite rules" and then POINTED at
them instead of carrying them.** A pointer is a summary. The document warned
against planning from a summary on page one while being one on page two.

§0 of the proposal now writes all of it out, so an agent holding only that file
has the whole contract:

| §0 | What it carries |
|---|---|
| 0.1 | **Why** — the owner's words, and the three consequences (delete first; an emptied org is not a new org; a new customer does not work in dependency order) |
| 0.2 | **The seat** — all seven hats, and the thing each one exists to stop |
| 0.3 | **Seven operating standards**, each one a scar |
| 0.4 | **The four judgements** this seat owns and may not delegate |
| 0.5 | **Rules 1–3** in full — every row typed by a user; stop and fix but prove which first; never write without asserting the org ID |
| 0.6 | **The eight suite rules**, each learned from a FALSE finding |
| 0.7 | **How it is driven** — the interaction vocabulary table. Click, Type, Select, Drag, Hover, Keyboard, and what must be true after each |
| 0.8 | **The five organisations** and their dispositions |
| 0.9 | **The harness** — Playwright configs and projects; the accounts and which can actually sign in; the two AVDs and how mobile is driven |
| 0.10 | **Every interaction class** — text, forms, buttons, selects, drag, upload, download, email, hover, keyboard, second browser context, mobile touch — each with what counts as proof |
| 0.11 | **OUTBOUND_MODE = LIVE**, the owner's decision, and the pre-flight it makes mandatory |

**The one line that governs everything else:** a row landing in a table proves
the write path and says nothing about whether the drawer opened, the drag
persisted, or the button was reachable by keyboard. Every interaction asserts
its own observable consequence — never merely that it did not throw.

v5's eighteen disciplines are that same idea one level up: *"it rendered"* is to
*"it is accessible, fast, translated and works in Safari"* what *"it did not
throw"* is to *"the drag persisted"*.

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

## The six production gates — every one blocking

⚠ **P0 was added on the owner's instruction: nothing in this run touches staging,
at all.** It exists because the mistake was already made twice in one afternoon —
an APK verified for the right *spelling* and not the right *environment*, and a
`mobile/.env` that silently pins every local build to staging while the only
production profile sits in `eas.json`, which `build-apk.sh` never reads.

| | Gate | Blocks |
|---|---|---|
| **P0** | **Every surface points at PRODUCTION** — `node scripts/check-production-targets.mjs` reads `.env.e2e`, `mobile/.env`, **the URL inlined inside the built APK**, and `/api/health` on both services | **everything** |
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

## Before Stage 1 opens — five things, and NONE is still blocking

⚠ **This list said "three are owner actions" and that was wrong.** Two were
checked and turned out to be dev work; the one real owner action has since been
answered. Recording the corrections rather than editing them away, because
"owner-blocked" and "nobody has tried" are different sentences and collapsing
them is how work sits still.

**Status 2026-08-30:** item 3 is **DONE** (APK built and verified), item 4 is
**DECIDED** (live). Items 1, 2 and 5 remain.

| # | Item | Whose | Why |
|---|---|---|---|
| 1 | **Bump `pyjwt` to 2.13.0** and run the backend suite | **dev** | A `requirements.txt` edit. It signs every session this programme creates; five known vulnerabilities, fix published. Only the DEPLOY is the owner's. |
| 2 | **Confirm backup retention and PITR** | **split** | Measured 2026-08-30: the org is on the **Pro** plan, which carries 7-day daily backups by default; PITR is a paid add-on. **Whether that add-on is enabled is not readable through the API** — that half is a look at the dashboard. |
| 3 | ~~Build the x86_64 APK~~ **✅ DONE 2026-08-30 13:30** | **dev** | ⚠ It was never owner-blocked. And the *previous* x86_64 APK (29 Aug 15:50) **pointed at a dead host** — `22b970c9` corrected `kartavya-` → `kartavaya-` at 16:09, nineteen minutes later, and Expo INLINES that URL at build time. Rebuilt, signed (v2 scheme), 53 MB, and **verified to contain the corrected hostname and zero instances of the dead one**. |
| 4 | ~~Decide `OUTBOUND_MODE`~~ **✅ DECIDED 2026-08-30 — LIVE** | **owner, ANSWERED** | Real mail leaves the building. Production is already in that state. ⚠ **`suppressed_orgs_digest` reads `"0"` — the EMPTY set — so no org is shielded and the RECIPIENT SCHEME is the only guard.** See §0.11: 45% SES simulator, 50% gmail plus-tags, 5% plain `test@unicodegroup.com` (the plus-tagged form BOUNCES on IONOS). Gate P3 is rewritten as a data check because the digest guard is not in force. |
| 5 | **Fix O-13 before relying on D1** | **dev** | The live-SQL ratchet counts a string, not a behaviour, so the discipline it enforces is currently unsound. |

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
