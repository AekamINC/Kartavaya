"""Phase 0.22 — `tasks.client_id`, checked against the real schema.

Migration 226 adds the column; this asserts the three statements that touch it
PARSE against the live catalogue, and that the tenancy rule is the one being
enforced.

NOTHING IS EXECUTED. `asyncpg.Connection.prepare()` sends Parse and Describe and
stops — the server plans the statement and returns the shapes without reading or
writing a row. Staging shares its database with production (CLAUDE.md), so that
distinction is the safety story, and it is the same pattern
`tests/test_client_billing_invoices.py` uses.

Run the live half with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_tasks_client_id.py -q
"""
import asyncio
import inspect
import os
import re

import pytest

import server


_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the task write-path SQL against the "
    "real catalogue and cannot be done offline — conftest hands every module a "
    "MagicMock pool, which answers happily to a statement naming a column that "
    "does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_tasks_client_id.py -q"
)

#: The ownership predicate, verbatim from `_assert_client_in_org`.
OWNERSHIP_SQL = (
    "SELECT id FROM staging.graha_clients WHERE id=$1::uuid AND org_id=$2::uuid"
)

#: The column list and VALUES of the task INSERT, lifted from the handler at
#: import time so this cannot drift from the statement it claims to test.
def _task_insert_sql() -> str:
    src = inspect.getsource(server)
    m = re.search(r"INSERT INTO tasks \(task_id,user_id,team_id.*?RETURNING \*", src, re.S)
    assert m, "the task INSERT moved — this test can no longer find it"
    return m.group(0)


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


# ── Offline: the rule, not the plumbing ──────────────────────────────────────

def test_the_ownership_check_carries_the_org():
    """An FK on `graha_clients.id` alone would accept ANOTHER org's customer —
    that is the documented join leak. The predicate has to name the org."""
    src = inspect.getsource(server._assert_client_in_org)
    assert "org_id=$2::uuid" in src, (
        "the client ownership check no longer scopes by org, so a task can be "
        "given another organisation's customer"
    )
    assert "graha_clients" in src


def test_an_unknown_client_is_refused_not_dropped():
    """Silently ignoring a client_id the caller cannot use creates the task with
    no customer and reports success — and the hours then get moved by hand."""
    src = inspect.getsource(server._assert_client_in_org)
    assert "404" in src and "not in this organisation" in src


def test_the_insert_and_the_update_both_carry_the_column():
    src = inspect.getsource(server)
    assert "sort_order,org_id,client_id)" in src, "the task INSERT dropped client_id"
    assert "_assert_client_in_org(pool, payload.client_id, _org)" in src, (
        "the create path no longer checks the client against the task's org"
    )
    assert 'if "client_id" in data:' in src, "the update path no longer sets client_id"


def test_the_column_is_optional_on_both_models():
    """An internal task has no customer. Requiring one would make every
    checklist item a billing decision."""
    assert server.TaskCreate.model_fields["client_id"].default is None
    assert server.TaskUpdate.model_fields["client_id"].default is None


# ── Live: the statements, planned by Postgres ────────────────────────────────

@pytest.fixture(scope="module")
def live():
    dsn = live_dsn()
    if not dsn:
        pytest.skip(SKIP_REASON)
    return dsn


def test_the_statements_plan_on_the_real_schema(live):
    import asyncpg

    statements = [
        ("ownership", OWNERSHIP_SQL),
        ("insert", _task_insert_sql()),
        # The UPDATE is assembled from a list at run time; this is the shape it
        # builds when a client is the only field being changed.
        ("update", "UPDATE tasks SET client_id=$1::uuid WHERE task_id=$2"),
        # And the read the profitability report needs, scoped the only way it
        # may be scoped.
        ("report", "SELECT t.client_id, c.name, count(*) AS tasks, "
                   "COALESCE(SUM(t.estimated_minutes),0) AS minutes "
                   "FROM tasks t JOIN staging.graha_clients c "
                   "  ON c.id = t.client_id AND c.org_id = t.org_id "
                   "WHERE t.org_id=$1::uuid AND t.client_id IS NOT NULL "
                   "GROUP BY t.client_id, c.name"),
    ]

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for label, sql in statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                       # noqa: BLE001
                    failures.append((label, f"{type(exc).__name__}: {exc}"))
            return failures
        finally:
            await conn.close()

    failures = asyncio.run(run())
    assert not failures, "\n".join(f"{label}: {err}" for label, err in failures)


def test_the_column_exists_and_is_nullable(live):
    """Read from the catalogue, never from the migration file — an inline CHECK
    on `ADD COLUMN IF NOT EXISTS` is skipped whole when the column exists, so a
    migration file is not evidence of anything."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetchrow(
                "SELECT data_type, is_nullable FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name='tasks' "
                "  AND column_name='client_id'"
            )
        finally:
            await conn.close()

    row = asyncio.run(run())
    assert row is not None, "migration 226 has not been applied — every task create 500s"
    assert row["data_type"] == "uuid"
    assert row["is_nullable"] == "YES", (
        "client_id became NOT NULL — every internal task is now unsaveable"
    )


def test_public_tasks_still_has_no_foreign_keys(live):
    """The no-FK decision in migration 226 is this table's own pattern, and a
    later FK on `client_id` would accept another org's customer while looking
    like integrity."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetch(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid='public.tasks'::regclass AND contype='f'"
            )
        finally:
            await conn.close()

    fks = [r["conname"] for r in asyncio.run(run())]
    assert not fks, (
        f"public.tasks grew foreign keys {fks} — if one of them is on client_id, "
        f"read migration 226: graha_clients.id is unique table-wide, so an FK "
        f"admits another organisation's customer. Tenancy is the write path's job."
    )
