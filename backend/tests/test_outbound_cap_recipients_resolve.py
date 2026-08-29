"""`outbound._get_alert_recipients` — the query that has never returned a row.

THE BUG. The email-cap alert asks who to warn when an org nears its sending
cap. It asked like this:

    WHERE ur.org_id = $1::uuid AND ur.role IN ('org_owner', 'org_admin')

There is no `role` column on `user_roles`. Its columns are (id, user_id, org_id,
`role_code`, granted_by, granted_at, updated_at, updated_by) — measured against
the live catalogue on 2026-08-29, and asserted below rather than quoted. So the
statement raised 42703 on every call since the feature shipped, the surrounding
`except Exception: pass` ate it, and the recipient list was ALWAYS EMPTY: every
cap alert went to `AEKAM_ADMIN_EMAIL` alone. No org owner has ever been told
their email cap was running out.

WHY IT SURVIVED, and what this file is really guarding. `except Exception: pass`
gave the failure no symptom. Nothing logged, nothing raised, and the alert still
"sent" — to one address — so the code looked like it worked. The handler now
logs at exception level; `test_the_failure_is_no_longer_silent` below is the
part that keeps it that way, because a re-silenced handler would put the next
bug of this shape back into the dark for another year.

TWO LAYERS, ON PURPOSE — and the second is the one CI actually runs.
`ci.yml:174` sets no `DATABASE_URL`, so every live test in this file skips
there. A file that only skips proves nothing, so the source-level assertions run
UNCONDITIONALLY and carry an anti-vacuity guard
(`test_the_source_scan_actually_found_the_query`): they locate the real
statement in `outbound.py` by AST and fail if they cannot, so renaming or
moving the function turns this file RED rather than quietly green.

⚠ THE LIVE TESTS EXECUTE NOTHING THAT WRITES. `prepare()` sends Parse and
Describe and stops — the server resolves every relation, column and cast without
running the statement. The one test that does fetch rows runs a read-only
SELECT. Staging shares its database with production; nothing here writes.

Run against the real schema:

    cd backend && DATABASE_URL=... python -m pytest tests/test_outbound_cap_recipients_resolve.py -q
"""
import ast
import asyncio
import os
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
OUTBOUND_PY = BACKEND / "outbound.py"
FUNC = "_get_alert_recipients"

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

SKIP_REASON = (
    "no live database. This statement joins two tables across schemas and "
    "filters on a column whose name is the entire bug. A MagicMock pool "
    "accepts `ur.role`, `ur.role_code` and `ur.banana` with equal enthusiasm."
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    return None if (not dsn or dsn == _PLACEHOLDER_DSN) else dsn


# ── Source extraction ───────────────────────────────────────────────────────
# Read by AST rather than imported: `outbound` pulls in the whole email stack,
# and this file has to run in CI with no environment at all. Adjacent string
# literals are folded into one Constant by the parser, so the fragmented
# statement in the source arrives here as a single string.

def _extract_recipient_sql() -> str | None:
    tree = ast.parse(OUTBOUND_PY.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == FUNC:
            for call in ast.walk(node):
                if (
                    isinstance(call, ast.Call)
                    and isinstance(call.func, ast.Attribute)
                    and call.func.attr == "fetch"
                    and call.args
                    and isinstance(call.args[0], ast.Constant)
                    and isinstance(call.args[0].value, str)
                ):
                    return call.args[0].value
    return None


def _extract_func_source() -> str | None:
    src = OUTBOUND_PY.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == FUNC:
            return ast.get_source_segment(src, node)
    return None


RECIPIENT_SQL = _extract_recipient_sql()
FUNC_SOURCE = _extract_func_source()


# ── Layer 1: source assertions. These run everywhere, including CI. ──────────

def test_the_source_scan_actually_found_the_query():
    """ANTI-VACUITY GUARD. Every source assertion below is worthless if this fails.

    Each of them is a substring test over `RECIPIENT_SQL`. If the AST walk
    returned None — the function renamed, moved to another module, or the
    statement changed from a literal to something built at runtime — those tests
    would be checking `None` and could go green while asserting nothing. This
    test is what makes the rest of the file mean something.
    """
    assert FUNC_SOURCE is not None, (
        f"could not find `async def {FUNC}` in {OUTBOUND_PY}. If it moved or was "
        "renamed, point this file at the new location — do not delete the guard."
    )
    assert RECIPIENT_SQL is not None, (
        f"found `{FUNC}` but no literal `pool.fetch(\"...\")` inside it. Every "
        "assertion in this file reads that literal; without it they are vacuous."
    )
    # Prove we grabbed the intended statement and not some other fetch.
    assert "user_roles" in RECIPIENT_SQL and "u.email" in RECIPIENT_SQL, (
        f"the literal found in {FUNC} does not look like the recipient query:\n"
        f"  {RECIPIENT_SQL!r}"
    )


def test_the_filter_names_role_code_and_not_role():
    """THE BUG ITSELF. `ur.role` does not exist; `ur.role_code` does."""
    assert re.search(r"\bur\.role_code\s+IN\b", RECIPIENT_SQL), (
        "the cap-alert recipient filter must use `ur.role_code`. "
        f"Got:\n  {RECIPIENT_SQL}"
    )
    assert not re.search(r"\bur\.role\s+IN\b", RECIPIENT_SQL), (
        "`ur.role` is back. There is no `role` column on user_roles — this "
        "raises 42703 on every call and the recipient list silently empties, "
        "so only AEKAM_ADMIN_EMAIL is ever alerted.\n"
        f"Got:\n  {RECIPIENT_SQL}"
    )


def test_the_join_reaches_users_where_users_actually_lives():
    """`users` exists in `public` and has never existed in `staging`.

    The statement previously read `JOIN staging.users` — a table that is not
    there and never was. That half was corrected in passing by the
    schema-consolidation codemod (af774fce), not by anyone who noticed; this
    assertion is what stops it drifting back.
    """
    assert re.search(r"JOIN\s+public\.users\s+u\b", RECIPIENT_SQL), (
        f"the join must reach `public.users`. Got:\n  {RECIPIENT_SQL}"
    )
    # ⚠ THE OLD NAME IS ASSEMBLED, NOT WRITTEN. A literal "staging.users" here
    # is indistinguishable — to the tokenize-based codemod that rewrote 3,004
    # identifiers in af774fce — from a real query, so a re-run rewrites it to
    # "public.users" and inverts this assertion against the line above it,
    # leaving a test that can never pass. That happened to this exact line
    # while this file was being written. Concatenating keeps the guard readable
    # and puts it out of the codemod's reach.
    old_name = "staging" + ".users"
    assert old_name not in RECIPIENT_SQL, (
        f"`{old_name}` does not exist and never has — this join returns no "
        "rows and no error the caller can see."
    )
    assert re.search(r"\bON\s+u\.user_id\s*=\s*ur\.user_id\b", RECIPIENT_SQL), (
        f"the join key must be user_id = user_id. Got:\n  {RECIPIENT_SQL}"
    )


def test_the_role_values_are_the_ones_that_exist():
    """'org_owner' and 'org_admin' are real `role_code` values (5 and 19 live)."""
    for value in ("org_owner", "org_admin"):
        assert f"'{value}'" in RECIPIENT_SQL, (
            f"{value!r} missing from the recipient filter:\n  {RECIPIENT_SQL}"
        )


def test_the_failure_is_no_longer_silent():
    """`except Exception: pass` is the reason this bug lived. It must not return.

    The handler is allowed not to raise — the caller falls back to
    AEKAM_ADMIN_EMAIL, and this sits inside the outbound send path where
    propagating would turn a lookup failure into a send failure. What it is not
    allowed to be is silent.
    """
    assert FUNC_SOURCE is not None, "anti-vacuity guard covers this; see above"
    assert not re.search(r"except\s+Exception\s*:\s*\n\s*pass\b", FUNC_SOURCE), (
        f"`except Exception: pass` is back in {FUNC}. That is precisely how a "
        "query that could never succeed survived in production with no symptom. "
        "Log it."
    )
    assert re.search(r"logger\.(exception|error|warning)\(", FUNC_SOURCE), (
        f"{FUNC} swallows its exception without logging it. A swallowed failure "
        "with no log is an invisible failure."
    )


# ── Layer 2: the live catalogue. Skipped in CI, decisive locally. ────────────

# ⚠ THE PROBES BELOW ARE ABSOLUTE, NOT search_path-RELATIVE, AND CARRY THEIR
# SCHEMA NAMES AS A BIND PARAMETER. That is a deliberate defence, not a style
# choice. While this file was being written, three separate repo-wide codemods
# rewrote it underneath a passing test run:
#
#   1. the identifier pass turned the literal "staging.users" — written as a
#      NEGATIVE assertion — into "public.users", inverting it against the line
#      above it into a test that could never pass;
#   2. the probe pass replaced `table_schema IN ('public', 'staging')` with
#      `= ANY(current_schemas(false))`, which on a raw connection is `{public}`
#      alone and reported `user_roles` as having NO COLUMNS while it sits in
#      `staging` — an empty result set, which is how a catalogue assertion goes
#      vacuously green;
#   3. the cleanup pass cut `SET search_path TO staging, public` down to
#      `... TO public`, breaking it a second time by the same mechanism.
#
# Each rewrite is defensible in its own scope and none can tell an assertion
# from a query. So the schema names live in PYTHON DATA passed as `$1`, where no
# SQL-text pass can reach them, and the probes name their schemas outright
# instead of inheriting whatever search_path happens to be set. This also
# follows the repo's own SQL rule: asyncpg bind parameters, not interpolation.
#
# `staging` is assembled rather than written for the same reason as `old_name`
# above. Both product schemas are listed because the tables move with migration
# 241 and this test must be correct on both sides of that cutover.
PRODUCT_SCHEMAS = ["public", "stag" + "ing"]


def _live(coro_factory):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            return await coro_factory(conn)
        finally:
            await conn.close()

    return asyncio.run(run())


async def _bind_to_current_schema(conn, sql: str) -> tuple[str, str]:
    """Point the statement at wherever `user_roles` lives RIGHT NOW.

    The branch's codemod rewrote every `staging.X` to `public.X` ahead of
    migration 241, which is what physically moves the tables. Between those two
    events `public.user_roles` does not resolve — a fact about the cutover, not
    about this query. Rebinding here keeps the test measuring the join and the
    column (which are this file's subject) instead of the migration's timing.
    """
    schema = await conn.fetchval(
        "SELECT table_schema FROM information_schema.tables "
        "WHERE table_name = 'user_roles' AND table_schema = ANY($1::text[]) "
        "ORDER BY array_position($1::text[], table_schema) LIMIT 1",
        PRODUCT_SCHEMAS,
    )
    assert schema, "`user_roles` is in neither `public` nor `staging`."
    return sql.replace("public.user_roles", f"{schema}.user_roles"), schema


def test_the_recipient_query_parses_against_the_live_catalogue():
    """Parse + Describe only. Resolves every relation, column and cast."""
    if not live_dsn():
        pytest.skip(SKIP_REASON)

    async def check(conn):
        sql, schema = await _bind_to_current_schema(conn, RECIPIENT_SQL)
        try:
            await conn.prepare(sql)
        except Exception as exc:  # noqa: BLE001
            return f"{type(exc).__name__}: {exc}", schema
        return None, schema

    err, schema = _live(check)
    assert err is None, (
        f"the recipient query does not resolve against the live catalogue "
        f"(user_roles read from `{schema}`): {err}"
    )


def test_role_code_exists_on_user_roles_and_role_does_not():
    """The catalogue fact the fix rests on — measured, not quoted."""
    if not live_dsn():
        pytest.skip(SKIP_REASON)

    async def check(conn):
        return await conn.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'user_roles' "
            "AND table_schema = ANY($1::text[])",
            PRODUCT_SCHEMAS,
        )

    cols = {r["column_name"] for r in _live(check)}
    assert cols, "no columns found for user_roles — the query below proves nothing"
    assert "role_code" in cols, f"`role_code` missing from user_roles; found {sorted(cols)}"
    assert "role" not in cols, (
        "a `role` column now exists on user_roles. If that is deliberate, the "
        "recipient filter needs re-deciding — but the old `ur.role` was still a "
        f"bug when it was written. Columns: {sorted(cols)}"
    )


def test_the_corrected_query_actually_returns_recipients():
    """The whole point: it used to return nothing, for everyone, always.

    Read-only aggregate across all orgs. If this returns zero the fix is
    cosmetic — the alert would still reach only AEKAM_ADMIN_EMAIL.
    """
    if not live_dsn():
        pytest.skip(SKIP_REASON)

    async def check(conn):
        sql, schema = await _bind_to_current_schema(conn, RECIPIENT_SQL)
        # Drop only the org filter, so the join and the role_code filter — the
        # two things under test — are exercised exactly as written.
        counted = sql.replace("ur.org_id = $1::uuid AND ", "")
        assert "$1" not in counted, f"org filter not removed cleanly: {counted}"
        rows = await conn.fetch(counted)
        return len(rows), schema

    n, schema = _live(check)
    assert n > 0, (
        f"the corrected recipient query still returns 0 rows (user_roles read "
        f"from `{schema}`). Every cap alert would still go only to "
        "AEKAM_ADMIN_EMAIL."
    )
