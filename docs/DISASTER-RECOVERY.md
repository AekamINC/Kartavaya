# Disaster recovery — what exists, what it covers, and what it does not

**Status: 🟡 the paths exist and one of them has now been measured. NO RESTORE
HAS EVER BEEN REHEARSED.**

Before this file, the entire recovery story for a product holding customer
financial records was one sentence in `CLAUDE.md`:

> **`premerge_backup_20260829`** — 258 tables, 29,608 rows, row-verified, the
> reversal path for the consolidation.

True when written. Never re-read. No runbook, no rehearsal, no test.

---

## The one dangerous fact, restated for recovery

Staging and production share **one Supabase project and one schema**
(`kartavya-sg`, `toacecaewujfxjfrjwco`, ap-southeast-1). There is no second
environment. A recovery action is a production action the moment it runs, and
there is nowhere to practise that is not also live.

---

## ⚠ The finding: the reversal path is not a database backup

Measured read-only 2026-08-30 — every statement a `SELECT`, nothing written:

| | recorded in `CLAUDE.md` | measured 2026-08-30 |
|---|---|---|
| `premerge_backup_20260829` tables | 258 | **265** |
| rows | 29,608 | **30,364** |
| of those tables, holding ≥1 row | — | **170** (95 are empty) |
| `public` tables | — | **300** |
| **`public` tables absent from the backup** | — | **42** |
| of those, holding rows | — | **24** |
| **rows the backup cannot restore** | — | **5,887** |

The 24 that hold data are the core PM domain:

    notifications 2850 · activity_events 1254 · task_reminders 372 · tasks 364
    project_columns 274 · team_members 206 · project_assignments 195
    task_comments 91 · time_entries 58 · invites 44 · teams 41 · users 30
    mentions 22 · categories 17 · push_web_subscriptions 17 · channel_members 16
    channels 8 · approvals 5 · push_tokens 5 · saved_views 5
    notification_prefs 4 · task_templates 4 · project_templates 3 · task_clients 2

### This is not a corrupted backup. It is a correct one, described as bigger than it is.

Migration 241 moved 258 tables out of the `staging` schema into `public`.
`premerge_backup_20260829` snapshots **that schema, before the move**. The
tables already living in `public` — the original production ones, which is where
`tasks`, `users` and `teams` live — were never in `staging`, so they were never
in the snapshot. **As a consolidation-reversal path it is complete and correct.**

**The risk is the name.** "The reversal path" reads like "the backup", and in an
incident nobody re-reads a migration note. Anyone reaching for this schema to
restore the database would recover 265 tables and silently not recover a single
task, user, team or notification — and the restore would *succeed*, which is the
worst possible way to find out.

`reseed_backup_20260828` has the same shape (265 tables) and the same limit.

---

## What the actual recovery paths are

| # | Path | Covers | Rehearsed? |
|---|---|---|---|
| 1 | **Supabase's own project backups** (`kartavya-sg`) | the whole database | **🔴 never** |
| 2 | `premerge_backup_20260829` | reversing migration 241 — 265 tables, 30,364 rows | 🔴 never restored, coverage now measured |
| 3 | `reseed_backup_20260828` | the state before proposal 93 Stage 2 wiped the test orgs | 🔴 never |
| 4 | `ledger_repair_20260826` (13 tables), `dead_tables_20260822` (2), `payroll_smallrun_20260827` (1), `tenancy_195_backup` (2) | single, dated repairs | n/a — not general recovery |
| 5 | **R2 object storage** — every file byte lives here, never in the DB | uploaded documents | 🔴 never |

**Path 1 is the only full-database answer.** Half of it is now measured and half
is not:

- **Plan: `Pro`** (org `AekamINC`, project `kartavya-sg`, ap-southeast-1), read
  2026-08-30. Pro carries **daily backups with 7-day retention by default**.
- **PITR is a paid add-on on this plan, and whether it is enabled is NOT
  readable through the management API.** That is one look at the dashboard, and
  it is the fact that decides the real RPO.

⚠ **If PITR is off, the recovery story is: 7 days of daily snapshots, plus a
consolidation-reversal schema that excludes every task, user and team.** That is
worth knowing before a production run begins, not during one.

---

## Re-verifying coverage — repeatable, read-only

    cd backend
    DATABASE_URL=... python scripts/check_backup_coverage.py

It re-measures and **fails when coverage gets worse**: more `public` tables
outside the backup, a shrinking backup, or a backup that lost rows. The baseline
is `backend/scripts/backup_coverage_baseline.json`.

It is deliberately **not in CI**. `ci.yml` says why in as many words: "staging
and production share one database, so a CI job with credentials could write to
live customer data from any pull request." This is a thing a person runs, or a
scheduled job with its own read-only credential.

It refuses to run without a DSN rather than skipping — a skipped recovery check
reports "recovery is fine" having checked nothing.

---

## Restore runbook — NOT YET REHEARSED

⚠ **Every step below is written from the schema layout, not from a rehearsal.**
Do not treat it as validated. The first person to run it is testing it.

### Before anything

1. **Establish what is actually broken**, and whether it is data or deploy.
   `GET /api/health` reports `current_schema()`, `environment`, `outbound_mode`
   and the deployed SHA — read it before assuming a data fault.
2. **Check what is deployed.** Staging has silently tracked `main` before
   (`incident_staging_branch_switch`). A "data loss" that is really a stale
   deploy needs a redeploy, not a restore.
3. **Stop the writers.** Six production crons are armed. A restore racing a
   cron writes a database that matches neither state.
4. **Take a fresh snapshot first**, whatever the pressure:
   `CREATE SCHEMA incident_<yyyymmdd>; ` then table-by-table `CREATE TABLE … AS
   SELECT * FROM public.…`. Restoring over the evidence loses the ability to
   answer what happened.

### Reversing the consolidation (path 2 only)

This is the only thing `premerge_backup_20260829` can do. It restores the 265
tables that came from `staging`. It **will not** restore the 42 tables listed
above; those need path 1.

    -- READ FIRST, and get a named approval. A DROP is approved BY NAME in this
    -- repo (`drop_approval_is_by_name`) — a prefix is not a stack.
    SELECT count(*) FROM premerge_backup_20260829.<table>;   -- expected rows
    SELECT count(*) FROM public.<table>;                     -- what is there now

Restore one table at a time, verifying counts after each. Never a loop over
`information_schema` — that is how 42 tables get missed in the other direction.

### After any restore

1. **Re-run the Supabase security advisor.** New tables arrive without RLS and
   `public` is exposed to PostgREST with the anon key compiled into the shipped
   browser bundle. A restored table with no RLS policy is a cross-tenant leak
   that produces no error and no log line. Treat a new `rls_disabled_in_public`
   as a breach, not a lint.
2. Confirm `/api/health` still reports `{"schema":"public"}`.
3. Re-run `python scripts/check_backup_coverage.py`.
4. Record what was restored, and the row counts before and after, in
   `docs/plans/PROGRESS.md`.

---

## What is owed, in priority order

1. **Confirm whether the PITR add-on is enabled.** Retention is answered — the
   org is on `Pro`, so 7-day daily backups by default. PITR is a paid add-on and
   its state is not readable through the management API. **Owner action, one look
   at the dashboard, and it decides the real RPO.**
2. **Rehearse a restore.** Into a fresh dated schema, never over `public`, one
   table, verified by row count. Until this happens every row above stays 🔴 —
   "the code shipped" and "a customer completed the flow" are different claims,
   and so are "a backup exists" and "a restore works".
3. **Rename or re-describe `premerge_backup_20260829`** wherever it is called
   "the reversal path" without saying what it excludes.
4. Decide whether the 42 uncovered tables need their own snapshot, or whether
   path 1 is accepted as their only cover — and write the decision down.
