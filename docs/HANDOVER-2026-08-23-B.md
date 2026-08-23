# Handover — 2026-08-23, for a fresh session

Supersedes `HANDOVER-2026-08-23.md`. Everything here was measured or run, not
remembered. Read this, then `docs/OWNER-ACTIONS.md`.

---

## 1. Read these first, in this order

1. **`CLAUDE.md`** at the repo root — the house rules. The one that matters most
   is at the top: **staging and production share a single Supabase database**,
   so every migration and every write-path probe touches production data.
2. **`docs/OWNER-ACTIONS.md`** — two items open (2 and 7), five struck off.
3. **This file, §3** — what is left, with what is already established.
4. **`docs/proposals/82-scope.html`** — the thirteen workstreams A–M. Its status
   column is out of date; the table below supersedes it.

---

## 2. Where the thirteen workstreams stand

| | Workstream | State |
|---|---|---|
| **A** | Onboarding a new firm | **DONE** |
| **B** | Tenancy | **PHASES 1–3 DONE.** 079 now UNBLOCKED — see §4 |
| **C** | Products, unified | **DONE** |
| **D** | Notifications | **DONE** — all four pieces, see §2.1 |
| **E** | Tables: audit trail and control | **DONE** |
| **F** | Reports | **DONE** |
| **G** | Procurement | **DONE** (and see §5 — it is not "missing") |
| **H** | Compliance as a setting | **NOT STARTED** |
| **I** | Pahchan | **DONE** |
| **J** | Marketing | **NOT STARTED** |
| **K** | R2 storage | **DONE** |
| **L** | Two-factor authentication | **NOT STARTED** |
| **M** | Mobile | **CODE DONE, APK NOT BUILT** |

Pushed to `origin/staging` and deployed. Suites at the last push: **backend
13,749 pass / 0 fail**, **frontend 2,771 pass / 6 fail** (the same 6 in 4 files
listed in §6 — pre-existing), `npm run build` exit 0, `npm run check` green.

**Migrations 194–205 are applied and verified live.**

### 2.1 · D is finished. What it turned out to be

Worth reading even if you never touch notifications, because three of these were
invisible for months and the reason they were invisible repeats everywhere.

**@mentions on tasks had NEVER worked.** Measured: `public.mentions` holds
**zero rows, all time**; of 27 `mention` notifications, 22 are Sanvaad
`#general` and the other 5 are literally `Seeded E2E notification #N`. Ten real
comments named four different colleagues between 6 June and 23 July. Nobody was
ever told. Four separate causes, all closed:

- a **personal task** (`team_id IS NULL`, 36 live) skipped the display-name pass
  entirely, leaving only a regex that cannot match a name containing a space;
- **"longest wins" did not win** — `@Keval` is a substring of `@Keval Shah`, so
  both matched and a colleague who was never named got told they were;
- **pass 2 undid pass 1** by re-scanning the raw body;
- the `mentions` INSERT was a bare **`except: pass`**.

And the structural reason nobody noticed: mentions ran LAST inside one `try`
that also wrapped the recipient fan-out, a `task_clients` query and a push —
five jobs, one `except`, and a warning reading `comment fan-out failed` that
names none of the four things that then did not happen. **One try block over
several unrelated jobs is a bug waiting, and this codebase has more of them.**

**Follow-up notifications** fire and send (1,150 reminders, 663 sent, latest
today; the 487 suppressed are 483 test-org plus 4). What was missing was the
in-app channel — `process_pending_reminders` had email and push and no
`create_notification`. Added, and deliberately **not** gated on quiet hours:
in-app has no queue behind it, so holding one throws it away, while the email
genuinely is queued.

**Sanvaad sound/toast** worked, but `shouldDeliver` gated `toast` and `sound` on
the clock alone — a kind switched OFF still made a noise, while `push` and
`email` two lines below correctly stayed silent.

---

## 3. What is left

### H · Compliance as a setting — not started

`docs/proposals/80-*.html` is the spec, and the owner's rule is written in it:
*"build everything. org who is going to market is not our problem… they have to
comply not us."* Everything exists; what varies is a setting with the safe
default, audited, with the consequence stated next to the control.

**Do not build a setting that makes a compliance CLAIM.** There is no SOC 2, no
ISO 27001, no DPDP certification. "This org has chosen X retention window" is a
fact; "we are compliant with X" is a lie the customer would repeat to their own
regulator.

One live constraint: **migration 196 refuses per-scope retention overrides**,
because retention is a DPDP promise made to every person in an org in one notice
quoting one number.

### J · Marketing — not started

Inbox 15: "marketing templates cannot become campaigns" — **reproduce before
building**. The ICAI question is **settled**: build the capability as a setting,
do not re-open it.

The send path is the danger. `OUTBOUND_MODE=live` on staging since 2026-08-18,
there is no dry-run guard, and a cross-tenant write was found in
`pause_sequence` — assume its siblings share the shape until each is checked.
`staging.prachar_automations` has 0 rows ever and its engine returns 501; decide
dead-weight-or-gap on evidence.

### L · Two-factor authentication — not started

Auth is ours, not Supabase's: nothing can be enabled, everything must be built.
`docs/proposals/81-*.html` shipped a security page that **evidences the MFA gap
rather than papering over it**. **Optional per org, never mandatory** — the
owner's constraint.

What will bite: the interim state between password and code must not be a full
session; recovery codes hashed and single-use, or Aekam can sign in as anybody;
constant-time comparison (this codebase has had a timing oracle); slowapi on the
verify endpoint, keyed on the **last** `X-Forwarded-For` entry; and
`tests/test_platform_privacy.py` will fire — answer it, do not exempt it.

### M · Mobile — the APK

Code is done and pushed: altitude capture with `null` never becoming `0`, the
offline queue carrying it across a 72-hour replay, and the rules card. Not done:

- **Inbox 9, "attendance stuck at waiting for send", was never reproduced.** It
  needs a **cold restart** — hot reload lies on this app, and **Expo Go cannot
  run it at all** (react-native-mmkv is a native module).
- **No APK built.** `bash mobile/scripts/build-apk.sh release` — a debug APK
  carries no JS bundle and is useless off the build machine; the script applies
  the metaspace bump a release build needs.
- **iOS cannot be built here.** The blocker is an Apple Developer account.

Mobile suite was 834 pass / 0 fail. Tests are the node runner, not jest:
`npm test` in `mobile/`.

---

## 4. Tenancy — 079 is now unblocked

Phases 1–3 are done and deployed. The blocker is gone: the owner approved the
deletion and **migration 204 removed the 10 org-less projects**, so
`public.teams` is 42 rows with **0 NULL org_id**.

1. ~~Reconcile `team_members` into `project_assignments`~~ — migration 195.
2. ~~Move every read off `team_members`~~ — done; writers still DUAL-WRITE so the
   rename stays reversible.
3. ~~Rewrite `staging.user_org_context`~~ — migration 199.
4. **PROPOSED_079 — `teams.org_id NOT NULL`. READY TO RUN.**
5. **PROPOSED_080 — rename `team_members`.** Still last, still a separate
   decision; its own header says to watch a full business cycle between the
   rename and the drop. One thing still reads the table and cannot yet stop:
   `GET /api/teams/{id}`'s roster needs `member_id`, `email` and `status`, which
   `project_assignments` does not have. Grow those columns, or move pending
   project invitations into `public.invites` (which already has `org_id`,
   `module_grants` and an acceptance path). **Measured: ZERO `status='invited'`
   rows today**, so either way costs no data.
6. **PROPOSED_081 — RLS.** On for 98 tables, off for 203.

---

## 5. Two things that look broken and are not

**Procurement is not missing.** It is two tabs inside **Finance** —
`purchase orders` and `po approvals`, positions 6 and 7 of Ganit's 16 tabs
(`GanitPage.jsx:74`). It lives there deliberately: a purchase order counterparts
`ganit_vendors` and is what a vendor bill is matched against. Two reasons it is
hard to find: the tab strip overflows into "More +N", and **tab order is stored
per user** — `useTabPrefs` appends tabs that shipped after a saved row, so for
anyone with an older saved order they sit at the END of the strip. "Reset to
standard" in the customise sheet surfaces them.

**The Tasks table already has column control.** Same hook and same button as
Ganit (`TasksListPage.jsx:132` and `:415`), on the div-grid half of the
contract; the chip reads `Columns · 2 hidden`. **Sales → Orders** was the genuine
gap and is now fixed — it is a `<button>`-row grid, not a `<table>`, so the
arrangement work had nothing to attach to; `gridCells`/`gridTemplate` exist for
exactly that case.

---

## 6. Traps that cost real time — read before repeating them

- **Stale `__pycache__` produces phantom failures.** Source-inspecting tests read
  a file whose line numbers moved. Always
  `find . -name __pycache__ -not -path "./.venv/*" -exec rm -rf {} +` then
  `python -m pytest -q -p no:randomly`. Consecutive runs of an unchanged tree
  once gave 82, 34, 15, 2, 1 and 0 failures before this was understood.
- **Run pytest from `backend/`, never the repo root** (~58 spurious failures).
- **`npm run check` exits 0 on unparseable CSS.** Run `npm run build` too.
- **The 6 known frontend failures**, all pre-existing, are in
  `ganitInvoiceDrawer`, `labelShape`, `orgSettingsTabs` (3) and
  `sanvaadLegacyVocabulary`. Exactly these six means you broke nothing.
- **`org_id IS NULL` is a VALUE in this schema, not an absence, and it means
  something different in each table.** In `user_roles` it is a PLATFORM grant. An
  agent once read three separate NULL populations as one invented "fourth
  organisation"; the query that tells them apart is
  `WHERE org_id IS NOT NULL AND o.id IS NULL`, which returns zero.
- **A fake pool will confirm whatever you already believe.** It answers `[]` to
  any column name, and it has nobody called Keval. Two real defects this session
  survived a green unit test and were found only by probing the live database
  read-only with `railway run -e staging -s Kartavya python <script>`.
- **A migration's own assertion is worth more than its comment.** Migration 205's
  first draft deleted 40 regularisation rows on a plausible argument; its own
  check refused to commit, and was right — all 40 already had `punch_id` NULL and
  referenced nothing.
- **Never string-match CSS selectors to delete rules** — a delete-by-selector
  script once ate an unrelated rule via a comment.
- **Writing a NUL into a source file is easy** with escaped strings in a
  generated edit, and Python then refuses the import with `source code string
  cannot contain null bytes`. Prefer a sentinel that needs no escape.

---

## 7. Standing constraints from the owner

- **Staging only.** Railway, Vercel and Sentry stay in staging. **Do not merge
  `staging` into `main` and do not deploy production** — that is his call.
- **Never stop.** If something needs him it goes in `docs/OWNER-ACTIONS.md` and
  everything else carries on. A block parks a piece, never a batch and never a
  workstream. Finish the blocked piece the moment he actions it, unprompted.
- **Prove dead by measurement before deleting**, back up anything irreversible to
  a restore schema, and verify counts after.
- **`users.role` rows that look corrupt are REAL.** Never clean them.
- **GSTIN / PAN / TAN are non-mandatory and must block nothing.**
- **There is no payment gateway and never will be** — "paid" only ever comes from
  bank reconciliation.
- **Detailed risk report before any migration**, stating write-path side effects.
- Three restore schemas wait on his word before being dropped:
  `qa_cleanup_20260822` (OWNER-ACTIONS item 2), `owner_actions_20260823` and
  `punch_cleanup_20260823`.
