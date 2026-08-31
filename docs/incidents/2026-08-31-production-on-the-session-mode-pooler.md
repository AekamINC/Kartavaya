# Production ran on the session-mode pooler, capped at 15 clients

**Found** 2026-08-31 ~12:40 IST, while reading a suite-16 failure.
**Severity** live 500s to real users, on the first day real users were on the app.

## 1. WHAT IS WRONG, AND HOW IT WAS SEEN

Suite 16.01 failed with `GET /api/v1/org/members → 500`. The endpoint was not
the problem. Railway's deploy log for the same second:

    12:02:04  [2] Starting gunicorn 23.0.0
    12:02:04  [3] Booting worker with pid: 3          <- ONE worker
    12:02:08      DB pool created successfully
    12:02:13      asyncpg.exceptions.InternalServerError:
                  (EMAXCONNSESSION) max clients reached in session mode
                  - max clients are limited to pool_size: 15

Five seconds after the pool came up, SIX unrelated endpoints 500'd together:

    /api/users        /api/tasks        /api/activity/feed
    /api/v1/ganit/stats                 /api/v1/hub/skills/templates
    /api/v1/org/members

That is not six bugs. It is one exhausted connection pool, and every one of
those requests returned `{"detail":"Internal server error"}` to whoever made it.

## 2. THE CAUSE — MEASURED, NOT CITED

`DATABASE_URL` on the production service points at port **5432** of
`aws-1-ap-southeast-1.pooler.supabase.com`. On a `pooler.supabase.com` host
5432 is **Supavisor in SESSION mode**, not a direct connection: it pins one
Postgres backend per client for the life of the connection, and the project's
session pool is 15 clients TOTAL.

Probed live rather than read from documentation — connect, `SELECT 1`, close,
no writes:

    5432 session   opened= 5/16  stopped_by=EMAXCONNSESSION (limit 15)
    6543 txn       opened=24/24  stopped_by=(reached target)

**Five.** The production API's own pool is `max_size=10`, so it cannot even
reach its own configured size, and anything else touching the database — a
cron, a migration, a probe, a second container during a deploy overlap — takes
from the same 15.

The inversion is the part worth stating plainly:

| | port | mode | ceiling |
|---|---|---|---|
| staging — 30 commits stale, no users | 6543 | transaction | no refusal at 24 |
| **production — real users** | **5432** | **session** | **15, of which 5 free** |

`CLAUDE.md` records this as "only the pooler port differs". It is not a neutral
difference. Production holds the degraded one.

## 3. WHY THE CODE DID NOT CATCH IT, AND A SECOND TRAP

`db.py:_direct_dsn` is documented backwards:

    """Convert Supabase pooler URL (port 6543) to direct connection (port 5432)."""
    return re.sub(r':6543/', ':5432/', dsn)

On a `pooler.supabase.com` host that is not a direct connection — it is the
same pooler in the *worse* mode. So the boot-time fallback, which exists to
survive a pooler outage, silently trades a ~200-client ceiling for a 15-client
one and logs it as success. (A genuine direct host exists —
`db.toacecaewujfxjfrjwco.supabase.co` — and resolves IPv6-only.)

The fallback is not how production got here (`create_pool` opens only
`min_size=2`, so it succeeded at 12:02:08 and the wall was hit later, on
demand, at request time where nothing catches it). But it is armed for next
time, and `EMAXCONNSESSION` is an `InternalServerError`, which the `except`
clause does not list — so it can never trigger the fallback anyway.

## 4. WHAT MAKES THE FIX SAFE

Transaction mode forbids session-scoped state. Checked, not assumed:

- `statement_cache_size=0` — already set. This is the one that breaks loudly.
- `_init_conn` registers only asyncpg **client-side** type codecs, and
  deliberately sets no `search_path` (migration 241; its comment explains why).
- `git grep`: no `LISTEN`/`NOTIFY`, no `pg_advisory_lock` (`niyam/sweep.py`
  claims a ROW instead and says why), no `CREATE TEMP`, no explicit
  `.prepare()`/`.cursor()`. Every "bare SET" hit is an `UPDATE … SET`.
- `SET LOCAL` is transaction-scoped and therefore unaffected.

Staging has been running 6543 the whole time, which is a working precedent.

## 5. CHANGE, BLAST RADIUS, REVERSAL

**Change** production `DATABASE_URL` port `5432` → `6543`. One variable. No
schema change, no migration, no row read or written by the change itself.

**Blast radius** a redeploy of the `Kartavaya` service — the API is down for
the restart (~40s). No other service carries this variable.

**Reversal** set the port back to `5432`. Instant, and it restores exactly the
state described above, including the 15-client ceiling.

**Verification** `/api/health` must report `db: connected` and
`schema: public`, and the ceiling probe must not refuse.
