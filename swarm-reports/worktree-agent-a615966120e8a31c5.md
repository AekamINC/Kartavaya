# Vetana · वेतन — split, then styled

Branch `worktree-agent-a615966120e8a31c5`. Module: **Vetana (Payroll)**.

## What was asked, and where it stands

| | before | after |
|---|---|---|
| `VetanaPage.jsx` | 857 lines | **178**, route file only |
| inline styles (whole module) | 87 | **3** |
| tab files | 0 | **8** (6 tabs + `_shared` + `statutoryCalendar`) |
| module stylesheet | — | `styles/vetana.css`, 271 lines, tokens only |

The 3 remaining inline styles are the same thing three times: `width: ${pct}%`
on a proportion bar. That is a per-instance computed value and is the correct
place for an inline style — the alternative is a CSS custom property set inline,
which is the same thing spelled longer.

## Gates

```
node scripts/check-tokens.mjs    344 declared, 239 referenced, 0 missing
node scripts/check-classes.mjs   2343 selectors, 1637 classes used, 0 missing a rule
npx vite build                   built in 9.68s
npx vitest run                   35 files, 587 tests, all passing
```

The 3 unhandled rejections vitest reports are pre-existing and in
`task-flow.test.jsx` (`TaskDrawer.jsx:196`, `KanbanView.jsx:134`) — neither file
is touched by this branch.

## The defect this module actually had

Six `catch {}` blocks, each followed by a `length === 0` check. So a failed
request rendered the **empty state**:

> "No payroll runs — select a month and process payroll to generate payslips."

That sentence, shown when the request failed, says *nobody is owed anything*. It
is invisible in a screenshot, because a broken payroll page and a payroll page
for a company with no employees look identical.

Every tab now goes through `useResource` / `useList` in `_shared.jsx`, which keep
`loading` / `error` / `data` apart and hold `data` at `null` while `error` is
set, so the two cannot be collapsed. `vetana-states.test.jsx` asserts each list
tab twice — once against a server that answers, once against one that 500s —
using **the same regex for both halves**, so neither assertion can be vacuous.

## Against the rendered reference

Compared element by element against `__ref/Kartavaya Redesign.html` → Payroll
(`ScreenVetana` in `ScreensMore.jsx`, `VetanaStatutory` in `ScreensThin.jsx`).

Matched: the `People · जन` kicker, `वेतन` / `Payroll` title pair, the lede, the
`Run payroll` action, all four figures **above** the tab strip
(gross / deductions / net payable / compliance due) with their Devanagari, the
six tabs with theirs, the run table, the Source card, and the compliance
calendar with form numbers, amounts, due dates and notes.

Three deliberate departures, all in the same direction — the reference is a
mockup of one firm in Mumbai and hard-codes things this build must not invent:

1. **The "Registrations" card is not built.** It lists a PF establishment code,
   an ESIC employer code, a PT enrolment certificate and a TAN.
   `staging.organisations` has a column for none of them — they arrive with
   `PROPOSED_080_statutory_document_identifiers.sql`, which has not been applied,
   and `/v1/org/profile` does not expose them. Building it means inventing four
   identifiers on a compliance screen.
2. **Professional tax carries no due date.** The reference prints
   "31 Aug 2026" and the Maharashtra form MTR-6. PT is levied by state and the
   schedule differs by state and by liability size. The row shows its real
   amount and says the date follows the state schedule. A missing date a reader
   can see is safe; an invented one is not.
3. **Every other date is derived from the wage month and prints its rule** —
   EPF Scheme 1952 para 38, ESI Regulations reg. 31, Income-tax Rule 31A(2). A
   compliance date a reader cannot check is a date they have to trust. Note the
   24Q quarters are the Indian financial year, so a Q4 wage month is due 31 May,
   not "one month after the quarter" — that is the one most often got wrong.

## Things found while building, now surfaced

- **`process_payroll` emails every employee**, payslip PDF attached, and
  re-running a month deletes and rebuilds its payslips — so a second click is a
  second round of email to everybody. It fired on one unconfirmed click. Now
  behind a confirm that names that consequence.
- **An employee with no salary structure is skipped in silence.** The run
  iterates structures, not people, so they appear in no run, no payslip list and
  no statutory register. The Dashboard now puts the two counts side by side:
  *"2 of 3 active employees have no salary structure."*
- **The payslip refusal was being swallowed.** `doc_validation` answers 422 with
  every blocking gap named — field, reason, and where to fix it. The old handler
  read `detail` as a **string**; on that status it is an **object**, so the best
  case was `[object Object]` and the actual case was the four-word toast "Failed
  to download payslip". A careful refusal that reads as a broken button is how
  the refusal gets "fixed" by being bypassed. It now renders as the work list it
  is.
- **Overtime (migration 082).** `overtime_enabled` defaults FALSE and there was
  no UI for it anywhere. The Payroll tab's Source card runs
  `POST /v1/pahchan/attendance/publish` with `dry_run: true` — which writes
  nothing, by the endpoint's own contract — and prints whether overtime was
  computed **in the API's own words**, plus the thresholds and multiplier from
  `GET /v1/pahchan/policy`, with the Factories Act sections cited. "0 hours of
  overtime" and "overtime was never calculated" look identical on a payslip and
  mean opposite things.

## Separated duty — deliberately NOT changed

`vetana` is in `SEPARATED_DUTY_MODULES`; admin does not satisfy approver, and the
backend enforces it (`_RELEASE_LEVEL = APPROVER`). I did **not** add a
client-side level gate around the Approve control. `separated-duty.test.jsx` pins
that decision with two `it.fails` blocks and its header says plainly: *"DO NOT
close the gap by guessing. There is an unresolved contradiction that needs the
owner"* — `RBAC-SPEC.md:65` says sensitive modules have no per-member grant row
at all, while the Tier-4 level model assumes a grant row carrying a level is
exactly how approver is held. Both cannot be true, and enforcement built against
the wrong one would look enforced.

What I did instead: the backend's 403 is a written explanation, and it is now
shown **verbatim and kept on screen** rather than flashed as a toast. It is a
rule someone has to read and act on.

One test edit was unavoidable. `separated-duty.test.jsx` read
`pages/VetanaPage.jsx` as a file and asserted `/Approve Payroll/` appears in it.
The split moves that control to `pages/vetana/PayrollTab.jsx`. It now scans the
whole module directory — pinned to one path it went red on a pure file move
(noise) and would have gone **green and silent** had the control moved to a file
the path no longer named (the failure that matters). All 21 tests still pass,
including both `it.fails` pins.

## Not done / caveats

- **No screenshots.** The shared browser pane would not composite frames in this
  session (`screenshot failed: the Browser pane is not displayed`), so I could
  not capture reference and build side by side as images. I rendered the
  reference on my own dev server (port 5342, asserting `location.href` on every
  read) and extracted its text, then rendered my build through the e2e harness
  and extracted its text, and compared element by element. That is stricter than
  a screenshot for structure and copy, and weaker for layout and spacing —
  layout rests on the stylesheet and the `vite build`, not on a visual check.
- **The write paths were not exercised.** Staging and production share one
  Supabase database, so I did not click Process payroll, Approve, Disburse,
  Write off, or Save. They are wired to the same endpoints the previous version
  used; the new surface around them is what changed.
- `POST /v1/pahchan/attendance/publish` needs the Pahchan module and
  org owner/admin. A payroll editor without those gets a plain statement of that
  in the Source card, not an error — it is a normal configuration.
