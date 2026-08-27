"""The acknowledgement write path, parsed against the real schema.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

`POST /api/v1/hub/org/skills/findings/ack` and its DELETE have existed since
proposal 70 and `staging.skill_finding_ack` held **zero rows** on 2026-08-27 —
so not one of their statements had ever been executed against Postgres. Nothing
in the suite could tell: `tests/conftest.py` hands every module a MagicMock
pool, and a MagicMock answers happily to an INSERT naming a column that is not
there. That is exactly how `gst_rate` survived in the billing router until it
had never once succeeded (`tests/test_client_billing_invoices.py`), and an ack
path with the same defect would look identical from the outside — the button
would report success and the finding would come back next month.

Phase 4.3 puts a control in front of these statements, so they are about to run
for the first time. This parses them first.

── WHERE THE SQL LIVES, AND WHAT IS AND IS NOT CLAIMED ──────────────────────

The endpoints are in `routers/hub.py`; the three statements they execute are in
`services/skill_ack.py` — `record_ack`'s INSERT ... ON CONFLICT, `clear_ack`'s
DELETE, and `fetch_ack_set`'s SELECT, which the dispatcher runs on every run of
a wired skill. This file drives those three functions with a capture pool and
describes what comes out.

It deliberately does NOT import the hub router, and that is a statement rather
than an oversight. `test_every_writer_has_a_live_sql_test.py` marks a router
covered when a test that PREPAREs names it, and the hub router carries roughly
forty other write statements that nothing here parses. Naming it would retire
it from that baseline and buy silence on all forty. The debt stays visible; this
file covers the three statements Phase 4.3 ships.

── HOW ──────────────────────────────────────────────────────────────────────

Two halves, and the separation is the safety story. Staging and production share
one Supabase database (CLAUDE.md), so NOTHING here writes a row.

  1. CAPTURE, offline. Each function is driven with a pool that records the
     statement and its bound arguments and answers from a script. Runs
     everywhere, with or without a database.

  2. CHECK, live. `asyncpg.Connection.prepare()` sends Parse and Describe and
     STOPS: the server plans the statement, resolves every relation, column and
     parameter type, and returns the shapes. No `fetch`, no `execute`, no
     `fetchval` is ever called on the handle, so no row is read and none is
     written. Plus the catalogue, read directly — `prepare()` plans an INSERT
     that omits a NOT NULL column perfectly happily, because that violation is a
     runtime constraint and not a parse error.

     And one more thing only the live half can see: `ON CONFLICT (org_id, skill,
     finding_key)` needs a unique index over exactly those three columns. There
     is one — `uq_skill_finding_ack` — but it is an INDEX and not a table
     constraint, so it is invisible to `pg_constraint` and to the migration
     file. Without it every acknowledgement after the first on a finding raises
     `InvalidColumnReference`, which is a 500 on the button.

When there is no database the live half skips, loudly, with the command:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_skill_finding_ack_live_sql.py -q
"""
import asyncio
import os
import re

import pytest

from services import skill_ack


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
SKILL = "propose_payment_run"
KEY = "a33abe232980ce8683bb6576883b174f"
STATE = "8ac69484ecbfa10884f50263e0240d6e"
ACTOR = "user_f798947b8a2e"

TABLE = "skill_finding_ack"


class CapturePool:
    """Records every statement and its arguments. Executes nothing."""

    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        return "OK"

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return []


def _captured() -> list[tuple[str, str, tuple]]:
    """(path, sql, args) for every statement the ack path issues."""
    async def run():
        out = []
        for name, drive in (
            ("record", lambda p: skill_ack.record_ack(
                p, ORG, SKILL, key=KEY, label="INV-2291 — Sharma Traders",
                acknowledged_by=ACTOR, state=STATE, snooze_until=None, note="")),
            ("clear", lambda p: skill_ack.clear_ack(p, ORG, SKILL, key=KEY)),
            ("fetch", lambda p: skill_ack.fetch_ack_set(p, ORG, SKILL)),
        ):
            pool = CapturePool()
            await drive(pool)
            out.extend((name, sql, args) for sql, args in pool.calls)
        return out

    return asyncio.run(run())


# ══════════════════════════════════════════════════════════════════════════════
#  1 · Offline — the statements are built at all
# ══════════════════════════════════════════════════════════════════════════════

def test_the_three_statements_are_issued():
    paths = [p for p, _, _ in _captured()]
    assert paths == ["record", "clear", "fetch"], paths


def test_every_statement_is_schema_qualified():
    """`shadow_tables_and_search_path`: an unqualified write is its own defect.

    Migration 142 had to repair twins created by exactly this — a statement
    resolved through `search_path` into `public` while the reader looked in
    `staging`, so the row was written and never found.
    """
    unqualified = [
        (path, sql) for path, sql, _ in _captured()
        if TABLE in sql and f"staging.{TABLE}" not in sql
    ]
    assert not unqualified, unqualified


def test_the_key_the_endpoint_stores_cannot_be_a_uuid():
    """Migration 159's CHECK is `^[0-9a-f]{16,128}$`, and it is load-bearing.

    `finding_key` is rendered by nothing, but it IS returned by the endpoint,
    and a dashed UUID reaching it would defeat `check-rendered-ids` at the one
    place that ratchet cannot look — a column computed at runtime from a dict
    nobody wrote in JSX. `finding_key()` hashes, so the shape holds by
    construction; this asserts the construction.
    """
    key = skill_ack.finding_key({"bill": "INV-2291"})
    assert re.fullmatch(r"[0-9a-f]{16,128}", key), key
    assert skill_ack.state_hash({"balance_due": 42000}) != key


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection, so a statement is planned the way it
#: will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the acknowledgement statements against "
    "the real catalogue and cannot be done offline — a MagicMock pool answers "
    "happily to an INSERT naming a column that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_skill_finding_ack_live_sql.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _column_list(sql: str) -> list[str]:
    """The columns an INSERT names, from its own text."""
    match = re.search(r"INSERT\s+INTO\s+\S+\s*\(([^)]*)\)", sql, re.I | re.S)
    if not match:
        return []
    return [c.strip() for c in match.group(1).split(",") if c.strip()]


def _describe(calls):
    """Parse and Describe every statement. NOTHING IS EXECUTED."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for path, sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((path, sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((path, sql, len(stmt.get_parameters()), len(args)))
            catalogue = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = 'staging' AND table_name = $1",
                TABLE,
            )
            indexes = await conn.fetch(
                "SELECT indexdef FROM pg_indexes "
                "WHERE schemaname = 'staging' AND tablename = $1",
                TABLE,
            )
            return (failures, params, [dict(r) for r in catalogue],
                    [r["indexdef"] for r in indexes])
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Captured statements, described once for the whole file. Connects ONCE.

    A synchronous fixture running its own loop, deliberately: the suite pins
    `asyncio_default_fixture_loop_scope = function`, so a module-scoped async
    fixture would be sharing a loop it does not own.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    try:
        return _describe(_captured())
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means an uncast `$1 + $2`, which PgBouncer turns into
    an instant 500."""
    failures, _, _, _ = live
    assert not failures, "\n\n".join(
        f"[{path}] {err}\n{sql}" for path, sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    """Postgres counts the placeholders; the code counts the arguments. The
    INSERT carries eight and a hand-renumbered placeholder is exactly where the
    two part company."""
    _, params, _, _ = live
    wrong = [(p, sql, declared, bound)
             for p, sql, declared, bound in params if declared != bound]
    assert not wrong, "\n\n".join(
        f"[{p}] declares ${declared} but binds {bound} arguments\n{sql}"
        for p, sql, declared, bound in wrong)


def test_every_column_named_exists_and_every_required_one_is_supplied(live):
    """The half `prepare()` cannot do.

    A statement that omits a NOT NULL column plans perfectly — the violation is
    a runtime constraint, not a parse error. Read from the catalogue rather than
    from the migration ledger: migrations are applied by hand here and the
    ledger has been wrong before.
    """
    _, params, catalogue, _ = live
    known = {c["column_name"] for c in catalogue}
    required = {c["column_name"] for c in catalogue
                if c["is_nullable"] == "NO" and c["column_default"] is None}
    assert known, f"staging.{TABLE} is not in the catalogue at all"
    assert "finding_label" in required, (
        "the premise of this test changed: finding_label is no longer NOT "
        f"NULL-without-default on staging.{TABLE}"
    )

    seen = 0
    for path, sql, _, _ in params:
        cols = _column_list(sql)
        if not cols:
            continue
        seen += 1
        assert not (set(cols) - known), (
            f"[{path}] names columns staging.{TABLE} does not have: "
            f"{sorted(set(cols) - known)}"
        )
        assert not (required - set(cols)), (
            f"[{path}] omits NOT NULL columns with no default: "
            f"{sorted(required - set(cols))}"
        )
    assert seen == 1, f"expected exactly one INSERT to check, described {seen}"


def test_the_upsert_has_the_unique_index_it_conflicts_on(live):
    """`ON CONFLICT (org_id, skill, finding_key)` needs a unique index over
    exactly those three columns, and `uq_skill_finding_ack` is an INDEX rather
    than a table constraint — so it is invisible to `pg_constraint` and to the
    migration file, both of which have been read as evidence before.

    Without it, the FIRST acknowledgement of a finding succeeds and every
    re-acknowledgement raises `InvalidColumnReference`. That is the shape of
    defect this whole file exists to catch: it works once and then does not.
    """
    _, _, _, indexes = live
    wanted = re.compile(
        r"CREATE\s+UNIQUE\s+INDEX.*\(\s*org_id\s*,\s*skill\s*,\s*finding_key\s*\)",
        re.I | re.S,
    )
    assert any(wanted.search(d) for d in indexes), (
        "no unique index over (org_id, skill, finding_key); record_ack's "
        f"ON CONFLICT would raise on every re-acknowledgement.\n{indexes}"
    )
