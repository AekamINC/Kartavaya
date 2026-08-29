"""
setup_local_db.py — Apply all migrations to local Supabase to replicate staging.

Usage:
  cd backend
  copy .env.local .env
  python scripts/setup_local_db.py

Runs:
  1. Python migrations (001, 002) for public schema tables
  2. Every NUMBERED SQL migration (007-241), in order
  3. Seed data (admin user, org, plans, subscription)

Migration 241 consolidates `staging` into `public`, so a complete replay ends
with the product in ONE schema — the same shape as the live database after the
cutover. This script does not create `staging` itself; migration 010 does, and
241 empties it again.
"""
import asyncio
import os
import re
import sys
from pathlib import Path

# Ensure backend dir is on path
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv
load_dotenv(BACKEND / ".env")

import asyncpg


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL not set. Copy .env.local to .env first.")
        sys.exit(1)

    print(f"Connecting to {dsn.split('@')[-1]} ...")
    conn = await asyncpg.connect(dsn)

    try:
        # ── Step 1: Create base public tables (users, teams, tasks etc.) ──
        print("\n[1/4] Creating public schema tables ...")
        await _create_public_tables(conn)

        # ── Step 2: Run Python migrations ──
        print("\n[2/4] Running Python migrations ...")
        await _run_python_migration(conn, "001")
        await _run_python_migration(conn, "002")

        # ── Step 3: Run all SQL migrations in order ──
        print("\n[3/4] Running SQL migrations ...")
        await _run_sql_migrations(conn)
        await _verify_bootstrap(conn)

        # ── Step 4: Seed data ──
        print("\n[4/4] Seeding data ...")
        await _seed_data(conn)

        print("\nLocal DB setup complete!")
        print("  Studio:   http://127.0.0.1:54423")
        print("  DB:       postgresql://postgres:postgres@127.0.0.1:54422/postgres")

    finally:
        await conn.close()


class BootstrapError(RuntimeError):
    """A failure that makes the resulting database untrustworthy. Never skipped.

    The point of this class is that it is NOT caught by the per-migration
    handler. Everything that handler swallows is, by construction, survivable;
    anything that is not survivable has to bypass it or the run ends by printing
    success over a database nobody should develop against.
    """


# Only APPLIED HISTORY is replayed: `NNN_*.sql`, 007 through 241.
#
# `PROPOSED_*.sql` are proposals, not migrations. PROPOSED_080 opens with
# "PROPOSAL ONLY — AND NOT READY TO SCHEDULE", and migrations/README.md tracks
# them separately from the applied table. 28 of the 29 still address `staging.`.
# They are excluded for a second reason too: under `sorted()` they land AFTER
# every numbered file ('P' = 0x50 sorts above '9' = 0x39), so the old
# `glob("*.sql")` replayed all 29 of them LAST — i.e. on top of the schema
# migration 241 had just consolidated, which is the one state they were never
# written against. Applying them would build a local database that matches
# neither staging nor production.
MIGRATION_RE = re.compile(r"^(\d{3})_.*\.sql$")

# Missing-schema failures do not all look alike. Measured on PostgreSQL 17.10:
#
#   CREATE TABLE / CREATE INDEX / ALTER TABLE in a missing schema
#       -> 3F000  InvalidSchemaNameError   schema "x" does not exist
#   SELECT / INSERT in a missing schema
#       -> 42P01  UndefinedTableError      relation "x.t" does not exist
#
# The second is byte-for-byte the shape of a genuinely missing TABLE, so no test
# on the error text can separate them — which is exactly how the old
# `elif "does not exist" in err:` branch came to swallow `schema "staging" does
# not exist` and report a successful bootstrap over a near-empty database.
# 3F000 is therefore matched by SQLSTATE (authoritative, and what migrations
# actually raise, being overwhelmingly DDL), with a text check kept alongside it
# for any driver path that surfaces the message without the code.
_MISSING_SCHEMA_TEXT = re.compile(r'schema "[^"]+" does not exist')

# A run is judged by how much of it FAILED, not by whether it reached the end.
# Above this share of missing-dep skips and warnings the database is not the
# product and the run stops instead of claiming success.
MAX_FAILED_SHARE = 0.25


async def _run_sql_migrations(conn):
    """Replay the numbered migrations. Raises BootstrapError if the result is junk."""
    mig_dir = BACKEND / "migrations"
    all_sql = sorted(mig_dir.glob("*.sql"))
    numbered = [p for p in all_sql if MIGRATION_RE.match(p.name)]
    excluded = sorted(p.name for p in all_sql if not MIGRATION_RE.match(p.name))

    if not numbered:
        raise BootstrapError(
            f"No numbered migrations found in {mig_dir}. Nothing would be built, "
            "and a run that replays nothing must not report success."
        )

    print(f"  {len(numbered)} numbered migration(s) to replay "
          f"({numbered[0].name} .. {numbered[-1].name}); "
          f"{len(excluded)} non-migration file(s) excluded.")
    if excluded:
        print(f"  Excluded (proposals, not applied history): {len(excluded)} file(s), "
              f"e.g. {', '.join(excluded[:3])}")

    # Migrations that don't apply to a fresh local DB
    SKIP_MIGRATIONS = {"029"}

    applied = skipped_exists = skipped_dep = warned = 0

    for sql_file in numbered:
        num = MIGRATION_RE.match(sql_file.name).group(1)
        if num in SKIP_MIGRATIONS:
            print(f"  {sql_file.name} ... SKIP (not needed for fresh DB)")
            continue
        print(f"  {sql_file.name} ...", end=" ")
        sql = sql_file.read_text(encoding="utf-8")

        # Run each migration in its own transaction so one failure doesn't block the rest
        try:
            async with conn.transaction():
                await conn.execute(sql)
            print("OK")
            applied += 1
        except Exception as e:
            err = str(e)
            is_missing_schema = (
                isinstance(e, asyncpg.InvalidSchemaNameError)
                or getattr(e, "sqlstate", None) == "3F000"
                or _MISSING_SCHEMA_TEXT.search(err) is not None
            )
            if is_missing_schema:
                print("FAIL")
                raise BootstrapError(
                    f"{sql_file.name} failed because a SCHEMA is missing, not a table:\n"
                    f"    {err.strip()[:300]}\n\n"
                    "  This is fatal and is deliberately not skippable. A migration\n"
                    "  corpus replayed without the schema it targets builds almost\n"
                    "  nothing, and every later migration fails the same way — so the\n"
                    "  run would print 'SKIP (missing dep: ...)' a couple of hundred\n"
                    "  times and then announce a complete bootstrap over an empty\n"
                    "  database. Debugging against that database wastes a day.\n\n"
                    "  Fix the cause and re-run. Do not skip past it."
                ) from e

            if "already exists" in err or "duplicate" in err.lower():
                print("SKIP (already exists)")
                skipped_exists += 1
            elif "does not exist" in err:
                print(f"SKIP (missing dep: {err[:80]})")
                skipped_dep += 1
            else:
                print(f"WARN: {err[:120]}")
                warned += 1

    attempted = applied + skipped_exists + skipped_dep + warned
    print(f"\n  Migrations: {applied} applied, {skipped_exists} already present, "
          f"{skipped_dep} skipped (missing dep), {warned} warned "
          f"({attempted} attempted).")

    # ── ANTI-VACUITY ────────────────────────────────────────────────────────
    # Neither counter alone separates "this database was already built" from
    # "nothing got built": a healthy fresh replay is nearly all `applied`, a
    # healthy re-run is nearly all `already present`, and both are fine. What is
    # never fine is a run dominated by missing-dep skips and warnings, because
    # that database is not the product no matter how the script ends.
    if attempted == 0:
        raise BootstrapError(
            "Every migration was skipped by name — nothing was attempted. "
            "Refusing to report a successful bootstrap."
        )
    failed = skipped_dep + warned
    if failed > attempted * MAX_FAILED_SHARE:
        raise BootstrapError(
            f"{failed} of {attempted} migrations did not apply "
            f"({failed / attempted:.0%}, limit {MAX_FAILED_SHARE:.0%}).\n"
            "  The resulting database does not match the product. This is reported\n"
            "  as a failure rather than a wall of SKIP lines followed by\n"
            "  'Local DB setup complete!'."
        )
    return {
        "applied": applied,
        "skipped_exists": skipped_exists,
        "skipped_dep": skipped_dep,
        "warned": warned,
        "attempted": attempted,
    }


#: Tables without which this database is not the product. Deliberately the four
#: the seeding step already probes for — it silently seeded nothing when they
#: were absent, and then the script said "setup complete" anyway.
CORE_TABLES = ("organisations", "user_roles", "plans", "subscriptions")


async def _verify_bootstrap(conn):
    """Assert the replay actually built the product. The last line of defence.

    ⚠ THIS, NOT THE ERROR CLASSIFIER, IS WHAT CATCHES A MISSING SCHEMA — and the
    reason is worth stating because it is counter-intuitive. Measured on
    PostgreSQL 17.10, replaying `011_hub_foundation.sql` with no `staging`
    schema fails with:

        42P01  relation "staging.add_on_modules" does not exist

    NOT 3F000. Postgres reports a missing schema as a missing RELATION for
    queries and DML, and that message is byte-for-byte what a genuinely missing
    TABLE produces. No test on the error — text or SQLSTATE — can separate the
    two, so a classifier alone cannot make this safe. What is unmistakable is
    the RESULT: a database with no `organisations` table is not the product, no
    matter which error got it there.
    """
    missing = []
    for table in CORE_TABLES:
        if not await conn.fetchval("SELECT to_regclass($1)", table):
            missing.append(table)
    if missing:
        raise BootstrapError(
            f"the migrations ran but {len(missing)} core table(s) are absent: "
            f"{', '.join(missing)}.\n"
            "  This database is not the product. The seeding step used to probe\n"
            "  for exactly these, seed nothing when they were missing, and let the\n"
            "  script print 'Local DB setup complete!' over the hole — so the\n"
            "  first symptom was a developer debugging behaviour that had no\n"
            "  data behind it. Fix the replay, not this check."
        )
    print(f"  Verified: all {len(CORE_TABLES)} core tables present.")


async def _create_public_tables(conn):
    """Create the foundational public schema tables that migrations expect."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT,
            full_name TEXT,
            password_hash TEXT,
            avatar_url TEXT,
            phone TEXT,
            role TEXT DEFAULT 'user',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            last_login TIMESTAMPTZ,
            password_reset_token TEXT,
            password_reset_expires TIMESTAMPTZ,
            expo_push_token TEXT,
            notification_preferences JSONB DEFAULT '{}',
            mobile_push_enabled BOOLEAN DEFAULT TRUE,
            reminder_offset_minutes INTEGER DEFAULT 30,
            daily_digest_enabled BOOLEAN DEFAULT FALSE,
            daily_digest_time TEXT DEFAULT '09:00'
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS teams (
            team_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            owner_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            deleted_at TIMESTAMPTZ,
            deleted_by TEXT,
            color TEXT,
            org_id UUID
        )
    """)

    # `team_members` STAYS, and is created before `project_assignments` on
    # purpose. Phase 2 of the tenancy cutover moved the READS onto
    # `project_assignments`; the WRITES still go to both, and PROPOSED_080's
    # rename is only reversible while this table is still maintained. A local
    # database missing it would make every dual-writing code path — the invite
    # flow, `auth_router`, `services/project_purge.py` — fail on a machine where
    # it is supposed to be easiest to notice.
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS team_members (
            id TEXT PRIMARY KEY DEFAULT ('tm_' || substr(md5(random()::text), 1, 12)),
            team_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            status TEXT DEFAULT 'active',
            invited_email TEXT,
            invited_by TEXT,
            joined_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(team_id, user_id)
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'todo',
            priority TEXT DEFAULT 'medium',
            due_date TIMESTAMPTZ,
            assignee_id TEXT,
            created_by TEXT,
            labels JSONB DEFAULT '[]',
            subtasks JSONB DEFAULT '[]',
            attachments JSONB DEFAULT '[]',
            custom_fields JSONB DEFAULT '{}',
            position INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS project_assignments (
            assignment_id TEXT PRIMARY KEY DEFAULT ('pa_' || substr(md5(random()::text), 1, 12)),
            team_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(team_id, user_id)
        )
    """)
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_pa_user ON project_assignments(user_id)")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_pa_team ON project_assignments(team_id)")

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS activity_events (
            event_id TEXT PRIMARY KEY DEFAULT ('evt_' || substr(md5(random()::text), 1, 12)),
            task_id TEXT,
            team_id TEXT NOT NULL,
            actor_id TEXT,
            type TEXT NOT NULL,
            data JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS time_entries (
            entry_id TEXT PRIMARY KEY,
            task_id TEXT,
            user_id TEXT NOT NULL,
            started_at TIMESTAMPTZ,
            ended_at TIMESTAMPTZ,
            minutes INTEGER,
            description TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT NOT NULL,
            title TEXT,
            body TEXT,
            data JSONB DEFAULT '{}',
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS web_push_subscriptions (
            id TEXT PRIMARY KEY DEFAULT ('wps_' || substr(md5(random()::text), 1, 12)),
            user_id TEXT NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            keys JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    # Tables expected by migration 007 (RLS policies)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS field_definitions (
            field_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            name TEXT NOT NULL,
            field_type TEXT DEFAULT 'text',
            options JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS field_values (
            id TEXT PRIMARY KEY DEFAULT ('fv_' || substr(md5(random()::text), 1, 12)),
            field_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            value TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS saved_views (
            view_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            name TEXT NOT NULL,
            filters JSONB DEFAULT '{}',
            sort JSONB DEFAULT '[]',
            columns JSONB DEFAULT '[]',
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS dashboards (
            dashboard_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            name TEXT NOT NULL,
            widgets JSONB DEFAULT '[]',
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS automations (
            automation_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            name TEXT NOT NULL,
            trigger_type TEXT,
            conditions JSONB DEFAULT '{}',
            actions JSONB DEFAULT '[]',
            is_active BOOLEAN DEFAULT TRUE,
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS project_templates (
            template_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            tasks JSONB DEFAULT '[]',
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS task_templates (
            template_id TEXT PRIMARY KEY,
            team_id TEXT,
            name TEXT NOT NULL,
            data JSONB DEFAULT '{}',
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS mentions (
            mention_id TEXT PRIMARY KEY DEFAULT ('mn_' || substr(md5(random()::text), 1, 12)),
            task_id TEXT,
            user_id TEXT NOT NULL,
            mentioned_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    print("  Public tables created.")


async def _run_python_migration(conn, num):
    """Inline the SQL from Python migration files (they just ALTER TABLE)."""
    if num == "001":
        await conn.execute("""
            ALTER TABLE project_assignments
              ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ DEFAULT NOW()
        """)
        print(f"  {num} - project_assignments columns OK")
    elif num == "002":
        await conn.execute("""
            ALTER TABLE users
              ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
              ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ
        """)
        print(f"  {num} - password_reset columns OK")


async def _seed_data(conn):
    """Seed minimum data to log in and use the app."""
    import hashlib
    import uuid as _uuid

    # Admin password: "admin123" (local only)
    pwd = "admin123"
    salt = _uuid.uuid4().hex
    pw_hash = hashlib.pbkdf2_hmac("sha256", pwd.encode(), salt.encode(), 260_000).hex()

    admin_id = "local_admin_001"
    org_id = "00000000-0000-0000-0000-000000000001"
    team_id = "local_team_001"

    # Ensure salt column exists
    await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS salt TEXT")

    # Create admin user
    await conn.execute("""
        INSERT INTO users (user_id, email, name, full_name, password_hash, salt, role)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE SET password_hash=$5, salt=$6
    """, admin_id, "admin@kartavaya.com", "Admin", "Local Admin", pw_hash, salt, "user")

    # NO `CREATE SCHEMA IF NOT EXISTS staging` HERE — deliberately removed.
    #
    # It never helped: seeding is step 4 and the migrations are step 3, so the
    # schema was created AFTER everything that could have needed it. Migration
    # 010 is what actually creates `staging` during the replay, and migration 241
    # then moves every object out of it into `public`. Re-creating it here would
    # rebuild — empty — the very two-schema world the consolidation removes, and
    # leave a local database in a shape the live one is no longer in.

    # Check if organisations table exists before seeding
    has_orgs = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name='organisations'"
    )
    if has_orgs:
        await conn.execute("""
            INSERT INTO public.organisations (id, name, team_id, is_active, owner_user_id,
                storage_limit_bytes, storage_used_bytes)
            VALUES ($1::uuid, $2, $3, TRUE, $4, 10737418240, 0)
            ON CONFLICT (id) DO NOTHING
        """, org_id, "Local Dev Org", team_id, admin_id)
        print("  Organisation seeded.")

        # The org's Niyam system account -- mirrors admin_orgs.create_org and
        # migration 148, so the engine's task.add_comment verb works locally.
        await conn.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE")
        await conn.execute("""
            INSERT INTO users (user_id, email, name, full_name,
                               password_hash, salt, role, is_system)
            VALUES ('niyam_' || replace($1::text, '-', ''),
                    'niyam+' || replace($1::text, '-', '') || '@system.kartavaya.invalid',
                    'Niyam', 'Niyam', '!system-account-cannot-log-in', '!none',
                    'member', TRUE)
            ON CONFLICT (user_id) DO NOTHING
        """, org_id)
        print("  Niyam system account seeded.")

    # Create team
    await conn.execute("""
        INSERT INTO teams (team_id, name, owner_id, org_id)
        VALUES ($1, $2, $3, $4::uuid)
        ON CONFLICT (team_id) DO NOTHING
    """, team_id, "Local Dev Project", admin_id, org_id)

    # Assign admin to team — BOTH membership tables, mirroring what the live
    # database looks like after migration 195: `project_assignments` is a strict
    # superset of the active `team_members` rows, at identical roles. The seed
    # wrote only the first, so a local database reproduced neither the old world
    # (both tables) nor the new one (a superset) — it reproduced a state that has
    # never existed live, which is the worst kind of fixture. Any code still
    # reading `team_members` now finds the row it finds in production.
    await conn.execute("""
        INSERT INTO project_assignments (team_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (team_id, user_id) DO NOTHING
    """, team_id, admin_id)
    await conn.execute("""
        INSERT INTO team_members (team_id, user_id, role, status)
        VALUES ($1, $2, 'owner', 'active')
        ON CONFLICT (team_id, user_id) DO NOTHING
    """, team_id, admin_id)

    # Seed user_roles (RBAC)
    has_roles = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name='user_roles'"
    )
    if has_roles:
        for role in ("platform_admin", "org_admin"):
            await conn.execute("""
                INSERT INTO public.user_roles (user_id, org_id, role_code, granted_by)
                VALUES ($1, $2::uuid, $3, $1)
                ON CONFLICT DO NOTHING
            """, admin_id, org_id, role)
        print("  User roles (platform_admin + org_admin) seeded.")

    # Seed plans
    has_plans = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name='plans'"
    )
    if has_plans:
        await conn.execute("""
            INSERT INTO public.plans (id, name, code, price_monthly, price_annual,
                max_users, features, is_active, default_credits)
            VALUES
                (gen_random_uuid(), 'Free', 'free', 0, 0, 3, '{"projects": true}', TRUE, 0),
                (gen_random_uuid(), 'Professional', 'professional', 999, 9999, 50,
                    '{"projects": true, "graha": true, "ganit": true, "manav": true, "vikray": true, "vetana": true, "dristi": true, "prachar": true, "sahayak": true}', TRUE, 1000)
            ON CONFLICT DO NOTHING
        """)
        print("  Plans seeded.")

    # Seed subscription
    has_subs = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name='subscriptions'"
    )
    if has_subs:
        plan_id = await conn.fetchval("SELECT id FROM public.plans WHERE code='professional' LIMIT 1")
        if plan_id:
            await conn.execute("""
                INSERT INTO public.subscriptions (org_id, plan_id, billing_cycle, status,
                    current_period_start, current_period_end)
                VALUES ($1::uuid, $2, 'annual', 'active', NOW(), NOW() + INTERVAL '1 year')
                ON CONFLICT (org_id) DO NOTHING
            """, org_id, plan_id)
            print("  Subscription (Professional plan) seeded.")

    print(f"\n  Admin login:  admin@kartavaya.com / admin123")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BootstrapError as exc:
        # Exit non-zero and WITHOUT the success banner. The whole point of this
        # class is that the run is not allowed to end looking fine.
        print(f"\nBOOTSTRAP FAILED\n\n  {exc}\n", file=sys.stderr)
        sys.exit(1)
