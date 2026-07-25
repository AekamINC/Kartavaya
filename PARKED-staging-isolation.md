# Parked: staging isolation & outbound safety

**Status:** parked 2026-07-25, nothing implemented. Discuss before any redesign testing begins.

Self-contained on purpose — a session with no prior context can pick this up.

---

## The question that started it

Can the team test the redesign on staging.kartavaya.com without affecting the people using the original PM tool?

Short answer: **not yet, and the dangerous part isn't the database.**

---

## How the two environments actually relate

| | v1 (`main` branch) | v2 (`staging` branch) |
|---|---|---|
| Frontend | kartavaya.com | staging.kartavaya.com |
| Backend | `kartavya-production` | `kartavya-staging` |
| Core tables | unqualified → **`public`** | unqualified → **`public`** (same rows) |
| Module tables | none | **`staging.*`** (CRM, HR, payroll, orgs, RBAC) |
| R2 storage | one global bucket from `R2_BUCKET_NAME` env | **per-org** creds in `staging.organisations` |

Verified from the deployed bundle, not from config: staging's frontend does call `kartavya-staging`.

**`staging` is not an environment — it is the v2 module schema**, built to extend v1 rather than replace it. That is why 33 foreign keys cross from `staging.*` into `public.*`. The name causes this confusion every time; renaming it to `v2` or `app` is worth doing once the redesign ships.

`db.py` already runs `SET search_path TO staging, public` when `DB_SCHEMA=staging`. Main's `db.py` has no such line. So the routing mechanism exists; only the tables are missing.

---

## Three risks, in the order they actually matter

### 1 · Outbound side effects — **DONE** (`c010c11`)

Built 2026-07-25. `OUTBOUND_MODE=live|dry` in `backend/outbound.py`, guarding
`email_service.send_email`, all three push services, and all 11
`social_publisher.publish_to_*` entry points via a decorator.

**One manual step outstanding: set `OUTBOUND_MODE=dry` on the `kartavya-staging`
Railway service.** Until that variable is set the switch is inert — `live` is
the default, deliberately, so production needs no change.

AI inference is deliberately *not* guarded (blocking it makes Srijan untestable;
spend is metered and visible). WhatsApp is not guarded because it does not send
yet — `send_wa_message` stores `pending` behind a TODO. Both documented in
`outbound.py`.

The original finding, for context:

Searched for `DRY_RUN`, `SANDBOX`, any staging check. **None existed.** `DB_SCHEMA` routes the database and nothing else.

So from staging, with production credentials:

- **Email** sends through SES for real
- **WhatsApp / Varta** sends real messages to real customers
- **Srijan AI** calls cost real money against real credits
- **Srijan publishing** posts publicly via per-client OAuth

Testing the redesign means clicking through Ganit, Sanvaad, Prachar and Srijan. Someone opening the invoice screen and pressing *Send payment reminder* sends a **real WhatsApp to a real client of a customer**. No schema isolation prevents this — it never touches the database on the way out.

**Fix:** one env var, e.g. `OUTBOUND_MODE=live|dry`, checked in `email_service.py`, the WhatsApp sender and the Srijan publish path. In `dry`, log the payload instead of sending. `dry` on `kartavya-staging`, `live` on production. Small and self-contained.

### 2 · Files — cloning copies keys, not objects

`public.tasks.attachments` is JSONB holding R2 keys; `public.message_attachments.r2_key` likewise. Copy the rows and both point at the **same objects**.

Reading is harmless. **Deleting is not** — remove an attachment while testing and the real object is gone, and the production task silently loses its file.

Current state: only `QA Test Corp` has R2 credentials (bucket `kartavya-storage`). `Aekam Inc` has none, so its v2 file operations fail rather than write.

**Fix:** `staging.organisations` already has an `r2_prefix` column. Set a prefix for the org staging uses so new uploads land in their own namespace.

### 3 · Database — the schema clone

The original proposal, and the least dangerous of the three.

**Scope:** 15 tables exist in `public` with no `staging` copy — `users`, `tasks`, `teams`, `team_members`, `task_comments`, `invites`, `automations`, `categories`, `dashboards`, `mentions`, `project_columns`, `project_templates`, `saved_views`, `task_clients`, `task_templates`. 13 others already exist in both.

**Why it is cheap:**
- Every one of the 30 staging tables carrying a cross-schema FK is **empty** (`staging.subscriptions` has 2 rows). Repointing an FK on an empty table is a catalog operation — no validation scan, cannot fail.
- Data to copy is ~700 rows total (`project_columns` 227, `tasks` 200, `team_members` 186, `teams` 39, `task_comments` 23, `invites` 15, `users` 12, rest ≤3).
- **No sequences or identity columns** on any of the 15 — verified. So `LIKE ... INCLUDING ALL` cannot accidentally share a sequence with production, and a re-copy preserves ids exactly.

**Production impact:** the migration only *reads* from `public` and *creates* tables in `staging`. Nothing in `public` is renamed, altered, or has a row changed. The one contact point is `DROP CONSTRAINT`, which needs a brief `ACCESS EXCLUSIVE` lock on the referenced production table — an FK installs triggers on both sides.

The risk is not duration but the **lock queue**: behind a slow query, the `ALTER` waits and everything after it piles up. Mitigate with `SET lock_timeout = '3s'` before each statement so it aborts and retries instead of queueing. Run outside working hours.

Permanent effect on production: `public.tasks`, `public.users`, `public.teams`, `public.field_definitions` lose FK triggers they never relied on.

---

## What happens at merge / cutover

Merging moves code, not data. After the clone the two deliberately fork: the core team keeps working in `public`, testing accumulates in `staging`.

At cutover the real data is still in `public`, so:

1. Truncate the cloned staging core tables
2. Re-copy fresh from `public`
3. Deploy v2 as the only app
4. `public` becomes the archive

**Test data never reaches production** — the snapshot is scaffolding and gets thrown away. Cheap because there are no sequences: a re-copy preserves ids exactly, so nothing renumbers and no reference breaks.

The trade, stated plainly: **a data fork reconciled once at cutover, versus test records visible to the team for the whole testing period.**

---

## Recommended order

1. ~~**Outbound kill-switch**~~ — **done** (`c010c11`). Still needs `OUTBOUND_MODE=dry` set on Railway staging.
2. **R2 prefix** on the staging org — one `UPDATE`
3. **Schema clone** — reviewable `.sql`, run in the evening with `lock_timeout`

---

## Decisions needed

- [ ] **Set `OUTBOUND_MODE=dry` on `kartavya-staging` in Railway** — the switch is inert until this is done
- [ ] Schema clone: do it, or test inside one quarantined team instead?
- [ ] Rename `staging` schema → `v2` / `app` after the redesign ships?
- [ ] `account_manager`: `PLAN_RBAC.md` says removed, but 2 users hold it and the code treats it as platform staff
- [ ] `admin@aekaminc.com` holds `platform_admin` — the plan says god-mode is exactly 3 people (Bhoomi, Sid, Keval)

---

## Related work already landed

- `15fda69` — accessibility: focus traps, dialog ids, toast live regions, skip link
- `405e732` — RBAC: `staging.user_roles` is now the sole authorisation source; all 13 `role == "admin"` escape hatches closed

Neither touches production. Both are staging-branch only.

---

## Separate finding, unrelated to staging

**The production schema is not reproducible from the repo.** 53 migration files, and none of them creates `users`, `tasks`, `teams`, `team_members`, `task_comments` or `invites`. Every migration assumes they already exist. Those tables live only in the live database — if it were lost, the core PM tool could not be rebuilt from source.

Worth capturing into a migration regardless of what happens with staging.
