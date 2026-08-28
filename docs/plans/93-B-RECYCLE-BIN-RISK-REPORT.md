# Proposal 93 · B — migration 239, the recycle bin

> **Written BEFORE the statement runs**, which is the whole of the standing
> migration authorisation: it removes the wait, not the report. Verified from
> `pg_constraint` and the live catalogue afterwards, never from this file.

Owner-approved 2026-08-28, shape settled 2026-08-29. Two stages, SharePoint /
OneDrive shape.

---

## 1. What changes

**One new table, `staging.deleted_files`. Nothing existing is altered, dropped,
backfilled or re-pointed.**

| | |
|---|---|
| Tables created | 1 — `staging.deleted_files` |
| Columns added to existing tables | **0** |
| Columns dropped | **0** |
| Constraints added to existing tables | **0** |
| Rows written by the migration itself | **0** |
| Existing rows read by the migration | **0** |

```
staging.deleted_files
  id             uuid          pk, gen_random_uuid()
  org_id         uuid          NOT NULL          -- the tenant. every read is scoped on it
  source_kind    text          NOT NULL          -- CHECK IN ('task_attachment','graha_document')
  source_id      text          NOT NULL          -- tasks.task_id (text) or graha_documents.id (uuid), as text
  file_name      text          NOT NULL
  r2_key         text          NOT NULL
  file_url       text
  size_bytes     bigint        NOT NULL DEFAULT 0
  deleted_by     text          NOT NULL          -- users.user_id, which is text in this database
  deleted_at     timestamptz   NOT NULL DEFAULT now()
  stage2_at      timestamptz                     -- set when promoted EARLY by a person
  restored_at    timestamptz
  purged_at      timestamptz                     -- the R2 object is gone
  purge_error    text
```

### Why `stage2_at` is a column and `stage` is not

`stage` is **derived at read time** — stage 2 when `stage2_at IS NOT NULL OR
deleted_at < now() - interval '14 days'`.

This repo has ruled on exactly this twice. Migration 111 refuses a `status`
column on support sessions and 182 refuses a `closed_at`, both for one reason:
*a stored answer is a cache of an event and its failure mode is staleness*. A
recycle bin whose stage is stored is a bin that lies to the customer for as long
as the sweeper is late.

But "delete it from stage 1" is a **person's action**, not the passage of time,
and an age cannot express it. So the event gets a timestamp and the age is the
floor. Both, and the read takes whichever came first.

`source_id` is `text` and not `uuid` **because the two sources genuinely
disagree**: `public.tasks.task_id` is text, `staging.graha_documents.id` is
uuid. A uuid column would have made task attachments unstorable, and that is the
half of this feature with the live orphan in it.

---

## 2. Write-path side effects

**The migration has none.** It is `CREATE TABLE IF NOT EXISTS` plus two indexes.
No trigger, no rule, no default that fires on another table, no view replaced.
No existing router reads or writes this table until the code that ships with it
deploys.

**The ROUTERS that follow it do have side effects, and they are the real
subject:**

| Path | Today | After |
|---|---|---|
| `DELETE /api/tasks/{id}/attachments/{key}` (`server.py:5438`) | filters the JSONB array, **orphans the R2 object forever** | same filter, plus one `INSERT` into `deleted_files`. Object untouched. |
| `DELETE /v1/graha/documents/{id}` (`graha.py:4917`) | `is_active=FALSE`, object retained, **nothing lists it** | same, plus one `INSERT`. Now listable and restorable. |
| `DELETE /api/tasks/{id}` (`server.py:5487`) | hard-deletes the task; its attachments orphan wholesale | attachments captured to the bin first |
| Restore | does not exist | pointer written back; `restored_at` set |
| Purge | does not exist | `delete_file()` then `purged_at`; **quota decremented here and nowhere else** |

⚠ **`storage_used_bytes` is deliberately NOT decremented on delete.** Binned
files count against quota at both stages — the owner's decision, and the reason
is sound: an org that could delete its way under the limit would sit permanently
over it. `storage.py:746` is called once, at purge.

### The one that touches a table production serves

`public.tasks` is read and written by **production as well as staging**
(`db.py:21` — production sets no `DB_SCHEMA` and takes the `public` default).
So the task-attachment delete verb operates on a live production table.

What makes that survivable, measured rather than assumed: the verb is
**org-scoped and user-driven**. It runs only for a signed-in user who already
passes `assert_may_write_task` on that specific task, it changes one row by
`task_id`, and it has no path that touches a row the caller could not already
edit today. It is not a new capability — that route already exists and already
rewrites that column. This change makes it record what it destroyed.

---

## 3. Blast radius if it is wrong

| Failure | Consequence | Why it is bounded |
|---|---|---|
| Migration fails outright | Nothing changes | `CREATE TABLE IF NOT EXISTS`; no dependent object exists yet |
| Table created, routers not deployed | Nothing changes | An empty table nobody selects from |
| Routers deployed, table missing | **Every delete 500s** | ⚠ **This is the ordering hazard.** Migration lands FIRST, deploy second. See §6 |
| Bin row written, R2 delete never happens | Objects retained past 90 days | Costs money; destroys nothing. The safe direction |
| Purge runs on the wrong row | **An object is destroyed** | Purge is gated on `purged_at IS NULL AND restored_at IS NULL` and an explicit age floor, and the sweeper ships **DISARMED** |
| A customer restores something they should not see | Cross-tenant read | Every query carries `org_id = $n` and the routes are gated on org_owner/org_admin |

**Nothing in this migration can destroy data.** The only destructive verb in the
whole feature is the purge, and it ships unscheduled.

---

## 4. Live exposure, measured before the change rather than after

Read live, 2026-08-29, both product schemas:

- `staging.deleted_files` — **does not exist**. `public.deleted_files` — does
  not exist. No table matching `%recycle%|%deleted%|%trash%|%bin%|%purge%|
  %retention%` exists in either schema. This is the live query the "never call
  anything missing without one" rule demands, and it is what makes 239 a
  creation rather than a collision.
- Unicode Group and UK AekamINC hold **0 `graha_documents`** each.
- `public.tasks`: Unicode **20** (the protected team, exactly), UK **0**,
  Aekam Inc **220** (untouched, §12).

**So the feature ships against near-zero live data on the two test orgs**, and
the only populated org in the blast radius is Aekam Inc — whose rows this
programme guarantees are untouched and whose tasks no suite drives. The first
rows in `deleted_files` will be ones Suite 02.12 types itself.

---

## 5. Reversal, written before the change

```sql
DROP TABLE IF EXISTS staging.deleted_files;
```

Nothing else. No column to restore, no data to migrate back, no constraint to
re-add — that is the entire benefit of an additive-only migration and it is why
the design was chosen over adding `deleted_at`/`deleted_by` columns to
`graha_documents` and a shadow column to `tasks`.

⚠ **This DROP names one table and is not covered by the standing grant** — a
DROP is confirmed by name regardless. It is written here so the reversal exists
before the change does, not so it can be run without asking.

If the routers have already deployed, revert the deploy first, or every delete
verb 500s on a missing table — the mirror of the ordering hazard in §3.

---

## 6. Deploy order — a live hazard, stated because it has bitten this repo

**Migration 239 lands BEFORE the backend deploys.** A router that `INSERT`s into
a table that does not exist yet 500s on every delete, and `DELETE
/api/tasks/{id}/attachments/{key}` is a route that exists and is reachable
today.

The reverse order is safe and is the one to use: the table sits empty and unread
for as long as it takes the deploy to land.

---

## 7. Verification — by re-query, never by the statement reporting success

After the migration, and before any router is written:

1. `to_regclass('staging.deleted_files')` resolves; `public` copy still absent.
2. Column names, types and nullability read from `information_schema.columns`.
3. The CHECK on `source_kind` read from **`pg_constraint`**, not from this file
   — migration 238 exists because a CHECK was live that two repo files both
   declared "NOT APPLIED".
4. Both indexes present in `pg_indexes`.
5. Aekam Inc's §12 fingerprint re-measured: **11 seats / 220 tasks**, unchanged.

---

## Assessment

**Lowest-risk shape available for this feature.** Additive only, zero rows
touched, zero existing objects altered, a one-line reversal, and it lands
against orgs holding almost no files. The genuine risks are all in the *code*
that follows it — the purge verb and the deploy order — and both are named
above and handled: the purge ships disarmed, and the migration goes first.

The thing this replaces is worse than any risk listed here. Today
`TaskDrawer.jsx:621` and `server.py:5438` both drop the pointer and leave the
R2 object billed forever and unreachable by anyone, including Aekam, with no
confirmation and no undo.
