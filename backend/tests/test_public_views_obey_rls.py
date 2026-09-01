"""No view in `public` may run as its owner.

── WHY THIS IS A TEST AND NOT A MIGRATION ──────────────────────────────────

`public` is exposed to PostgREST and the anon key is compiled into the shipped
browser bundle. All ~300 tables carry RLS with no policies, which is why a
holder of that key reads nothing from them.

A VIEW is the exception, and silently. Without `security_invoker`, a view runs
as its OWNER — and every view here is owned by `postgres`, which holds
`rolbypassrls`. So such a view bypasses the deny-all RLS on every table it
reads, and the `GRANT SELECT ... TO anon` that PostgREST relies on hands that
straight to the browser. No error, no log line: it is a SELECT that works.

CLAUDE.md records this happening once already — "Two views were exactly this
hole on 2026-08-29 ... and were closed with `security_invoker = on`". The fix
was applied. Nothing was left behind to notice the third one.

── ⚠ AND THE SPELLING IS THE TRAP ──────────────────────────────────────────

`ALTER VIEW ... SET (security_invoker = on)` stores the string `on`.
`... = true` stores `true`. Both are correct and both are in use in this
database right now:

    pahchan_org_usage          security_invoker=on
    user_org_context           security_invoker=on
    v_org_credit_drift         security_invoker=on
    v_org_platform_line_drift  security_invoker=on
    v_active_support_sessions  security_invoker=true

An audit that matches only one spelling reports the other four as leaking. I
wrote that audit on 2026-09-01, believed it, and drafted a migration to "fix" a
hole that did not exist. The migration's own verify block used the same wrong
predicate and refused to commit — which is the only reason nothing was changed.

So this test accepts every truthy spelling Postgres will store, and the list is
the point of the file.
"""
import os

import pytest

#: Everything `reloptions` can hold for a true boolean.
TRUTHY = {"on", "true", "1", "yes"}

_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = ("No live DATABASE_URL. Run: cd backend && railway run "
           "--service Kartavaya -- python -m pytest "
           "tests/test_public_views_obey_rls.py -q")


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def run_live(factory):
    import asyncio
    import asyncpg

    if live_dsn() is None:
        pytest.skip(DB_SKIP)

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except (asyncpg.exceptions.InvalidPasswordError,
                asyncpg.exceptions.InvalidCatalogNameError, OSError) as exc:
            return ("__unreachable__", str(exc))
        try:
            return ("__ok__", await factory(conn))
        finally:
            await conn.close()

    kind, value = asyncio.run(run())
    if kind == "__unreachable__":
        pytest.skip(f"{DB_SKIP} ({value[:60]})")
    return value


def _invoker(reloptions) -> bool:
    """Whether this view's stored options turn security_invoker on."""
    for opt in (reloptions or []):
        name, _, value = str(opt).partition("=")
        if name.strip() == "security_invoker":
            return value.strip().lower() in TRUTHY
    return False


def test_live_every_view_in_public_runs_as_the_caller():
    async def views(conn):
        return await conn.fetch(
            "SELECT c.relname, c.reloptions FROM pg_class c "
            "  JOIN pg_namespace n ON n.oid = c.relnamespace "
            " WHERE n.nspname = 'public' AND c.relkind = 'v' "
            " ORDER BY c.relname")

    rows = run_live(views)
    # Anti-vacuity: if `public` ever held no views, every assertion below would
    # pass over nothing and this file would be a decoration.
    assert len(rows) > 0, "no views found in public — is this the right database?"

    leaking = [r["relname"] for r in rows if not _invoker(r["reloptions"])]
    assert leaking == [], (
        "these views run as their owner (postgres, BYPASSRLS) and are granted "
        f"to anon, so the browser's public key reads them across every org: {leaking}"
    )


def test_live_both_spellings_are_accepted():
    """The bug this file exists to prevent, asserted directly.

    Not a hypothetical: the database holds both spellings today, and an audit
    matching one of them called four healthy views a breach.
    """
    async def opts(conn):
        return await conn.fetch(
            "SELECT c.relname, c.reloptions FROM pg_class c "
            "  JOIN pg_namespace n ON n.oid = c.relnamespace "
            " WHERE n.nspname = 'public' AND c.relkind = 'v'")

    seen = set()
    for r in run_live(opts):
        for opt in (r["reloptions"] or []):
            name, _, value = str(opt).partition("=")
            if name.strip() == "security_invoker":
                seen.add(value.strip().lower())
    assert seen, "no view declared security_invoker at all"
    assert seen <= TRUTHY, f"a spelling this test does not know about: {seen - TRUTHY}"


def test_the_parser_rejects_a_falsy_or_missing_setting():
    """The floor. Without this, `_invoker` returning True unconditionally would
    make the live test above pass over a genuinely leaking view."""
    assert _invoker(["security_invoker=on"]) is True
    assert _invoker(["security_invoker=true"]) is True
    assert _invoker(["security_invoker=off"]) is False
    assert _invoker(["security_invoker=false"]) is False
    assert _invoker(["check_option=cascaded"]) is False
    assert _invoker([]) is False
    assert _invoker(None) is False
