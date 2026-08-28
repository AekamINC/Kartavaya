# Proposal 93 · R2 · risk report for the backup migration

**Written before the statement runs, not afterwards to justify it.** Standing
rule: migrations are pre-approved to this seat, the grant removes the wait and
not the report, and the write-path side effects are stated first.

Date 2026-08-28. Target: Supabase `toacecaewujfxjfrjwco`.

---

## 1. What it does

Creates one new schema, `reseed_backup_20260828`, and copies into it — by
`CREATE TABLE … AS SELECT` — every row belonging to the three target orgs from
every table that carries an `org_id`, across **both** product schemas.

    Unicode Group           fae87907-2f99-4b35-a241-c94d9e1e4a17
    E2E Test & Associates   64e7bea6-6abe-490c-a2a4-27a60c6be916
    UK AekamINC             4d7e9380-ff98-4c1d-bffd-a76df7e91f21

Expected volume, measured 2026-08-28: **26,063 rows across 142 tables** (Unicode
5,452 · E2E 20,280 · UK 331).

It also copies, unconditionally and in full:

- the 20 protected `public.tasks` rows (`team_ae1d58543b21`) and their children —
  comments, time entries, reminders, mentions, activity, notifications;
- the join-scoped rows §1.1 of the delete plan lists (223);
- the 1,104 `org_id IS NULL` rows that belong to target-org parents — **the ones
  an `org_id` predicate cannot see**, and therefore the ones a naive backup
  would silently omit while appearing complete.

## 2. Write-path side effects

- **It writes to no existing table.** No `UPDATE`, no `DELETE`, no `ALTER` on
  any live object. Every write goes into the new schema.
- **It does not touch `public.users`** (global, production-shared) or
  `staging.organisations`.
- **It adds a schema**, taking the database from 13 base-table schemas to 14.
  CLAUDE.md's schema census moves by one; that line is updated in the same
  commit.
- **Disk**: ~26k rows plus indexes-free copies. Trivial against this database.
- **Locks**: `CREATE TABLE AS SELECT` takes an `ACCESS SHARE` lock on each
  source table for the duration of its read. It does **not** block readers or
  writers of those tables. There is no exclusive lock anywhere in this migration.
- ⚠ **Production is live against `public` throughout.** `public.tasks`,
  `public.teams` and `public.users` are read and written by the production
  service while this runs. `ACCESS SHARE` is compatible with that, so production
  is unaffected — but the copy is a **point-in-time read, not a snapshot across
  tables**, and a row written to `public.tasks` mid-migration may or may not be
  in the backup. This matters only if the delete follows much later; R4 must
  re-verify counts against the backup immediately before it runs.

## 3. Blast radius if it is wrong

| Failure | Consequence | Severity |
|---|---|---|
| Schema name already exists | Statement aborts, nothing written | none |
| A table is missed | Backup is incomplete, and R4 would delete unbacked rows | **HIGH — this is the real risk** |
| Copies the wrong org | Extra rows in the backup | none — a superset is harmless |
| Runs out of disk | Statement aborts, partial schema left | low, and reversible by dropping the schema |
| Long read holds ACCESS SHARE | No blocking of production | none |

**The only serious risk is silent incompleteness**, which is exactly why §4's
verification counts every table rather than trusting the loop, and why the
`org_id IS NULL` sets are enumerated explicitly rather than assumed to ride along.

## 4. How it is verified — and it is not verified by the migration's own success

1. **Per-table row counts compared** between source (`WHERE org_id = ANY(...)`)
   and backup. Any table where they differ is a failure, reported by name.
2. **Table-count check**: 142 tables expected to hold rows; the backup must
   contain a relation for each.
3. ⚠ **A restore is PERFORMED and diffed** before R4 deletes anything — §7's
   gate, and the whole reason the backup exists. A backup nobody has restored is
   a belief, not a safety net. The restore is done into a *third* throwaway
   schema and diffed against source, so the restore itself touches nothing live.
4. The R2 **object key inventory** is already captured separately
   (`93-R2-OBJECT-INVENTORY.md`) — it must exist before R4 or the R2 objects
   become unfindable orphans.

## 5. Reversal

    DROP SCHEMA reseed_backup_20260828 CASCADE;

Complete and instant. The migration creates nothing outside that schema, so the
reversal is a single statement with no residue — no sequence, no type, no
function, no grant, no change to any existing object.

⚠ **The reversal is only safe while the backup is unused.** Once R4 has deleted
the live rows, this schema is the only copy, and dropping it is unrecoverable.
Per the standing rule, **it is dropped only when the owner names it**, at R9.

---

## Assessment

**Low risk, and it is the action that makes every later step safe.** It writes to
no existing object, takes no exclusive lock, is reversible by one statement, and
its only real hazard — silent incompleteness — is the thing §4 checks table by
table rather than inferring from the absence of an error.

Proceeding under the standing migration authorisation. Nothing is deleted by
this step, and R4 does not begin until the restore in §4.3 has been performed
and diffed.
