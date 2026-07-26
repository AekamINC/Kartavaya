"""
setup_local_db.py — Apply all migrations to local Supabase to replicate staging.

Usage:
  cd backend
  copy .env.local .env
  python scripts/setup_local_db.py

Runs:
  1. Python migrations (001, 002) for public schema tables
  2. All SQL migrations (007-060) for staging schema
  3. Seed data (admin user, org, plans, subscription)
"""
import asyncio
import os
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
        mig_dir = BACKEND / "migrations"
        sql_files = sorted(mig_dir.glob("*.sql"))

        # Migrations that don't apply to fresh local DB
        SKIP_MIGRATIONS = {"029"}

        for sql_file in sql_files:
            num = sql_file.name.split("_")[0]
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
            except Exception as e:
                err = str(e)
                if "already exists" in err or "duplicate" in err.lower():
                    print("SKIP (already exists)")
                elif "does not exist" in err:
                    print(f"SKIP (missing dep: {err[:80]})")
                else:
                    print(f"WARN: {err[:120]}")

        # ── Step 4: Seed data ──
        print("\n[4/4] Seeding data ...")
        await _seed_data(conn)

        print("\nLocal DB setup complete!")
        print("  Studio:   http://127.0.0.1:54423")
        print("  DB:       postgresql://postgres:postgres@127.0.0.1:54422/postgres")

    finally:
        await conn.close()


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

    # Create staging schema if not yet
    await conn.execute("CREATE SCHEMA IF NOT EXISTS staging")

    # Check if organisations table exists before seeding
    has_orgs = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='staging' AND table_name='organisations'"
    )
    if has_orgs:
        await conn.execute("""
            INSERT INTO staging.organisations (id, name, team_id, is_active, owner_user_id,
                storage_limit_bytes, storage_used_bytes)
            VALUES ($1::uuid, $2, $3, TRUE, $4, 10737418240, 0)
            ON CONFLICT (id) DO NOTHING
        """, org_id, "Local Dev Org", team_id, admin_id)
        print("  Organisation seeded.")

    # Create team
    await conn.execute("""
        INSERT INTO teams (team_id, name, owner_id, org_id)
        VALUES ($1, $2, $3, $4::uuid)
        ON CONFLICT (team_id) DO NOTHING
    """, team_id, "Local Dev Project", admin_id, org_id)

    # Assign admin to team
    await conn.execute("""
        INSERT INTO project_assignments (team_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (team_id, user_id) DO NOTHING
    """, team_id, admin_id)

    # Seed user_roles (RBAC)
    has_roles = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='staging' AND table_name='user_roles'"
    )
    if has_roles:
        for role in ("platform_admin", "org_admin"):
            await conn.execute("""
                INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by)
                VALUES ($1, $2::uuid, $3, $1)
                ON CONFLICT DO NOTHING
            """, admin_id, org_id, role)
        print("  User roles (platform_admin + org_admin) seeded.")

    # Seed plans
    has_plans = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='staging' AND table_name='plans'"
    )
    if has_plans:
        await conn.execute("""
            INSERT INTO staging.plans (id, name, code, price_monthly, price_annual,
                max_users, features, is_active, default_credits)
            VALUES
                (gen_random_uuid(), 'Free', 'free', 0, 0, 3, '{"projects": true}', TRUE, 0),
                (gen_random_uuid(), 'Professional', 'professional', 999, 9999, 50,
                    '{"projects": true, "graha": true, "ganit": true, "manav": true, "vikray": true, "vetana": true, "dristi": true, "prachar": true, "srijan": true}', TRUE, 1000)
            ON CONFLICT DO NOTHING
        """)
        print("  Plans seeded.")

    # Seed subscription
    has_subs = await conn.fetchval(
        "SELECT 1 FROM information_schema.tables WHERE table_schema='staging' AND table_name='subscriptions'"
    )
    if has_subs:
        plan_id = await conn.fetchval("SELECT id FROM staging.plans WHERE code='professional' LIMIT 1")
        if plan_id:
            await conn.execute("""
                INSERT INTO staging.subscriptions (org_id, plan_id, billing_cycle, status,
                    current_period_start, current_period_end)
                VALUES ($1::uuid, $2, 'annual', 'active', NOW(), NOW() + INTERVAL '1 year')
                ON CONFLICT (org_id) DO NOTHING
            """, org_id, plan_id)
            print("  Subscription (Professional plan) seeded.")

    print(f"\n  Admin login:  admin@kartavaya.com / admin123")


if __name__ == "__main__":
    asyncio.run(main())
