# Proposal 93 · R1 freeze ledger

**This file exists so R9 can undo R1 without this session's memory.** Every value
below was read from the live Railway API *before* anything was changed. If the
session that wrote this file never comes back, restoring these exact values is
the whole of the un-freeze.

Measured 2026-08-28 via `railway status --json` (`deploy.cronSchedule` on each
service instance) and `list_variables` on the `Kartavya` service.

Project `Kartavya Production` — `d5e62983-a876-4c27-91f0-6af0ee6bf577`.

---

## Staging crons — the pre-freeze schedules to restore

Environment `staging` — `bf470f73-4b3f-4722-af77-c06f1012b76e`.

⚠ **There are SEVEN, not the five proposal 93 §7 assumed.** Disarming five would
have left `cron-publish` and `cron-niyam` firing every fifteen minutes into a
half-emptied org, which is precisely the evidence corruption R1 exists to stop.

| Service | Service id | Restore to |
|---|---|---|
| cron-daily | `62c25b67-11c1-4893-bbb3-e7c60fc75d5d` | `15 1 * * *` |
| cron-publish | `d7f9b207-d30a-4c1c-9705-88bfe2752bb0` | `*/15 * * * *` |
| cron-nightly | `2160d2c0-cab2-49b0-8585-60df0540b52e` | `0 21 * * *` |
| cron-report-dispatch | `22249f3d-aec4-42b7-9f8c-921eb69b336f` | `*/15 * * * *` |
| cron-hourly | `c31598dc-f0c3-4c90-9ded-e08126e754f1` | `0 2-14 * * *` |
| task-reminder-cron | `e6250c16-6d02-4c99-b935-780ceb2f599f` | `*/15 2-14 * * *` |
| cron-niyam | `e7466b21-9824-4cc3-8dc7-73aba013391b` | `*/15 * * * *` |

`Kartavya` (`9d853e3f-…`) is the app and carries no cron schedule. It is not
touched by the freeze.

## Staging variables to restore

| Variable | Restore to |
|---|---|
| `OUTBOUND_MODE` | `live` |
| `OUTBOUND_SUPPRESSED_ORGS` | `64e7bea6-6abe-490c-a2a4-27a60c6be916` |

⚠ **That suppressed org is E2E Test & Associates, and it is a trap for this
programme.** `send_email` returns `True` when the gate suppresses, so every mail
assertion in the E2E regression lane would read `sent` while nothing left the
building — the 1,562-row failure recorded in §0 of the proposal, exactly. Either
E2E's suppression is lifted for the mail suites or E2E's mail assertions are
declared out of scope in writing. It must not be left to be discovered from a
green run.

## Production — NOT frozen, and deliberately so

Environment `production` — `9709bc0a-0ee7-4a33-b38c-87b298ae6a6b`. Two crons are
armed there and are **left alone**: `task-reminder-cron` `*/15 2-14 * * *` and
`retention-cron` `0 3 * * *` (`87b9ebfa-…`, which exists in production only).

---

## ⚠ The finding that changes R4: production runs on `public`

`backend/db.py:21` — `DB_SCHEMA = os.getenv("DB_SCHEMA", "public")`. The
production service **sets no `DB_SCHEMA` at all**, so it takes the default and
runs on `public`. Staging sets `DB_SCHEMA=staging`.

That would be unremarkable except for what is actually in each schema, measured
from `information_schema`:

    staging   257 base tables
    public     42 base tables

**and `tasks`, `teams` and `users` exist ONLY in `public`.** `staging.tasks`
raises `42P01`. So staging and production are not merely sharing a database —
for core PM and for user identity **they read and write the same tables**.

The protected 20 are `public.tasks WHERE team_id = 'team_ae1d58543b21'`, in a
table production serves live.

**What makes R4 safe anyway, and it was measured rather than assumed:**
`public.tasks` contains only the five known orgs —

    Aekam Inc      220     Unicode Group  141     E2E   82
    UK AekamINC      2     (org_id NULL)   40

— so there is no third-party production customer whose rows an org-scoped delete
could reach. R4 stays strictly org-scoped for that reason, and the reason is
recorded here because it is the thing that would make a future blanket delete
catastrophic.

⚠ **The 40 `org_id IS NULL` tasks survive an org-scoped delete.** None is in the
protected team (all 20 protected rows carry Unicode's org_id). They are the
orphaned-authorship class §2 describes. Left in place deliberately; noted so the
post-delete count is not misread as a failed wipe.

⚠ **`public.users` is global.** Deleting 30 accounts removes them for every
schema at once, production included. This is why the delete list is computed from
seats and re-verified immediately before R4 rather than taken from the proposal's
2026-08-27 snapshot.
