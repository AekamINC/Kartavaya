"""Migration 235 — the sales territory stack is gone, and must stay gone.

    staging.sales_territories · staging.sales_targets · staging.sales_routing_rules

These three were dropped on 2026-08-27. They were empty, nothing read them, and
the product's real target model is `staging.vikray_targets` (migration 020) —
which is exactly what makes them dangerous to leave untested: a name like
`sales_targets` reads like the obvious place to put a sales target, and the next
person to add targets to Vikray will reach for it by instinct.

So this file is a RATCHET, not a feature test. It fails if anything re-creates
the three, references them, or writes SQL against them.

── FOUR THINGS ARE CHECKED, AND WHY EACH ────────────────────────────────────

  1. **No migration re-creates them.** A `CREATE TABLE` naming any of the three
     in `backend/migrations/` fails this file. Migrations 030 and 201 name
     `sales_targets` in ALTER/array-of-names form and are historical, already
     applied, and immutable — they are allowlisted BY NUMBER, so a NEW migration
     doing the same thing is still caught.

  2. **No application code names them.** One reference exists in the repository
     and it is prose: `analytics/metrics/vikray.py` says "there is no
     sales_targets table". That sentence was wrong when it was written and is
     true now, so it is allowlisted BY FILE — but only as a comment. Anything
     that looks like SQL against the three fails wherever it appears.

  3. **Migration 235 keeps its shape.** No `CASCADE`, all three named in one
     statement, and the guard block present. A later edit that "simplifies" the
     migration by adding CASCADE would make the no-CASCADE protection — the
     thing that makes the drop honest — silently absent from the record.

  4. **LIVE: all three are absent from BOTH schemas**, and the trigger and
     function that wrote into `sales_targets` are gone with them, while
     `staging.touch_updated_at()` — shared by 27 triggers — survives. Skipped
     without DATABASE_URL, like every other live test here.

A 42P01 is a fact about ONE SCHEMA (`memory/negative_query_is_per_schema`), so
the live check asks `to_regclass` for `staging.*` AND `public.*` separately
rather than concluding from a single failed query.
"""
from __future__ import annotations

import os
import re

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
MIGRATIONS = os.path.join(BACKEND, "migrations")

#: The three, exactly as they were named in the owner's approval.
DROPPED = ("sales_territories", "sales_targets", "sales_routing_rules")

_NAMES_RE = re.compile(
    r"\bsales_(?:territories|targets|routing_rules)\b", re.IGNORECASE)

#: Historical migrations that name `sales_targets` and are already applied.
#: Allowlisted by NUMBER so that a NEW migration doing the same is still caught.
HISTORICAL_MIGRATIONS = {
    "030_created_by_uuid_to_text.sql",
    "201_updated_by_everywhere.sql",
    "235_drop_sales_territory_stack.sql",
}

#: The single prose reference in application code, allowlisted by file. The test
#: below still asserts the mention there is a COMMENT and not a statement.
PROSE_ONLY = {os.path.join("analytics", "metrics", "vikray.py")}

#: The one-shot operator script that PERFORMED the drop. It names all three
#: because verifying their absence is its whole job, and it is not application
#: code: nothing imports it and no request path reaches it. Allowlisted by name
#: rather than by directory, so a NEW script under scripts/ querying these
#: tables is still caught.
OPERATOR_SCRIPTS = {os.path.join("scripts",
                                 "apply_235_drop_sales_territory_stack.py")}

#: Directories that are not application code.
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".pytest_cache", "venv",
             ".venv", "migrations", "tests"}


def _migration_files() -> list[str]:
    return sorted(f for f in os.listdir(MIGRATIONS) if f.endswith(".sql"))


def _python_sources() -> list[str]:
    out: list[str] = []
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".py"):
                out.append(os.path.join(root, f))
    return out


# ── 1 · No migration may re-create the three ────────────────────────────────

def test_no_migration_recreates_the_dropped_tables() -> None:
    offenders: list[str] = []
    for name in _migration_files():
        if name in HISTORICAL_MIGRATIONS:
            continue
        with open(os.path.join(MIGRATIONS, name), encoding="utf-8") as fh:
            body = fh.read()
        for line in body.splitlines():
            stripped = line.strip()
            if stripped.startswith("--"):
                continue
            if _NAMES_RE.search(line):
                offenders.append(f"{name}: {stripped[:110]}")
    assert not offenders, (
        "Migration 235 dropped sales_territories, sales_targets and "
        "sales_routing_rules on 2026-08-27 after measuring 0 rows in each and "
        "no inbound dependency. A migration naming them again is either "
        "re-creating a dead stack or reaching for the wrong table: the live "
        "sales target model is staging.vikray_targets (migration 020).\n  "
        + "\n  ".join(offenders))


def test_the_historical_allowlist_is_still_accurate() -> None:
    """An allowlist that names a file which no longer mentions the three is an
    allowlist nobody is maintaining. It must shrink, not rot."""
    stale = []
    for name in sorted(HISTORICAL_MIGRATIONS):
        path = os.path.join(MIGRATIONS, name)
        assert os.path.exists(path), f"allowlisted migration is missing: {name}"
        with open(path, encoding="utf-8") as fh:
            if not _NAMES_RE.search(fh.read()):
                stale.append(name)
    assert not stale, (
        "these migrations no longer name any of the three; drop them from "
        f"HISTORICAL_MIGRATIONS: {stale}")


# ── 2 · No application code may name them ───────────────────────────────────

def test_no_application_code_references_the_dropped_tables() -> None:
    allowed = {p.replace("\\", "/") for p in PROSE_ONLY | OPERATOR_SCRIPTS}
    offenders: list[str] = []
    for path in _python_sources():
        rel = os.path.relpath(path, BACKEND)
        if rel.replace("\\", "/") in allowed:
            continue
        with open(path, encoding="utf-8") as fh:
            for i, line in enumerate(fh, 1):
                if _NAMES_RE.search(line):
                    offenders.append(f"{rel}:{i}: {line.strip()[:110]}")
    assert not offenders, (
        "these tables do not exist. Any query naming one raises 42P01 at "
        "runtime, and no test with a mock pool will catch it "
        "(memory/mock_pool_hides_bad_sql). Use staging.vikray_targets.\n  "
        + "\n  ".join(offenders))


def test_the_operator_script_allowlist_is_still_accurate() -> None:
    for rel in OPERATOR_SCRIPTS:
        path = os.path.join(BACKEND, rel)
        assert os.path.exists(path), (
            f"allowlisted operator script is missing: {rel}. Remove it from "
            f"OPERATOR_SCRIPTS rather than leaving a hole in the ratchet.")


def test_the_one_allowed_reference_is_prose_and_not_sql() -> None:
    for rel in PROSE_ONLY:
        path = os.path.join(BACKEND, rel)
        assert os.path.exists(path), f"allowlisted file is missing: {rel}"
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        hits = [ln.strip() for ln in body.splitlines() if _NAMES_RE.search(ln)]
        assert hits, (
            f"{rel} no longer mentions the three; remove it from PROSE_ONLY "
            f"so the allowlist does not outlive its reason.")
        for hit in hits:
            assert not re.search(
                r"\b(FROM|JOIN|INTO|UPDATE|TABLE|DELETE\s+FROM)\s+"
                r"[\"']?(public\.)?sales_(territories|targets|routing_rules)",
                hit, re.IGNORECASE), (
                f"{rel} contains what looks like SQL against a dropped table, "
                f"not prose: {hit!r}")


# ── 3 · Migration 235 must keep its shape ───────────────────────────────────

def _migration_235() -> str:
    path = os.path.join(MIGRATIONS, "235_drop_sales_territory_stack.sql")
    assert os.path.exists(path), "migration 235 is missing from the repository"
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _migration_235_sql() -> str:
    """235 without its comments.

    The header is a risk report that quotes the very strings these tests forbid
    — "never n_live_tup", "NO CASCADE", the reversal DDL. Asserting against the
    raw file would fail on the documentation and pass on the statements, which
    is precisely backwards."""
    return "\n".join(ln for ln in _migration_235().splitlines()
                     if not ln.strip().startswith("--"))


def test_migration_235_names_all_three_in_one_statement() -> None:
    body = _migration_235_sql()
    m = re.search(r"DROP\s+TABLE\s+IF\s+EXISTS(.*?);", body,
                  re.IGNORECASE | re.DOTALL)
    assert m, "migration 235 has no DROP TABLE statement"
    stmt = m.group(1)
    for name in DROPPED:
        assert f"staging.{name}" in stmt, (
            f"staging.{name} is not in the single DROP statement. The three "
            f"reference each other; one statement is what resolves the "
            f"ordering, and deletion order is fatal reversed.")
    assert len(re.findall(r"DROP\s+TABLE", body, re.IGNORECASE)) == 1, (
        "there must be exactly ONE DROP TABLE in migration 235")


def test_migration_235_never_cascades() -> None:
    body = _migration_235_sql()
    for line in body.splitlines():
        assert "CASCADE" not in line.upper() or "ON DELETE CASCADE" in line.upper(), (
            "migration 235 must not CASCADE. Without it, an unforeseen "
            "dependency makes the statement FAIL and leaves the database as it "
            "was. With it, the dependency is dropped silently and the report "
            f"reads 'it worked'. Offending line: {line.strip()!r}")


def test_migration_235_recounts_inside_the_transaction() -> None:
    body = _migration_235_sql()
    assert "count(*)" in body, (
        "migration 235 must re-count with count(*) inside the transaction. "
        "n_live_tup lies: it reported 23 and 14 for two tables that both held "
        "23 in the same week this was written.")
    assert "n_live_tup" not in body, "235 must not consult the estimator"
    assert "RAISE EXCEPTION" in body, (
        "the guard must RAISE, not RAISE NOTICE, when a table is non-empty — "
        "a notice does not abort the transaction")


def test_migration_235_drops_the_untracked_trigger_dependency() -> None:
    """The one dependency a plain DROP would NOT have caught.

    `staging.crm_deals` carried an AFTER UPDATE trigger whose plpgsql body
    UPDATEs `staging.sales_targets`. A function body is parsed when it runs, so
    PostgreSQL records no dependency: the DROP would have succeeded and left a
    42P01 behind every deal close. Removing it is not optional and must not be
    quietly dropped from the migration by a later edit."""
    body = _migration_235_sql()
    assert "DROP TRIGGER IF EXISTS trg_stg_deal_close_target" in body
    assert "sales_update_target_on_deal_close" in body
    assert "DROP FUNCTION IF EXISTS staging.touch_updated_at" not in body, (
        "staging.touch_updated_at() is shared by 27 triggers across the schema "
        "and must never be dropped by this migration")


# ── 4 · LIVE · the three are absent from BOTH schemas ───────────────────────

#: `tests/conftest.py` does `os.environ.setdefault("DATABASE_URL", ...)` with
#: this value, so "DATABASE_URL is set" is NOT the same question as "there is a
#: live database". Guarding on truthiness alone turns this into a connection
#: error on every developer's machine. Same constant, same reason, as
#: `test_billing_credit_sql_is_valid.py`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

SKIP_REASON = (
    "no live database. This half reads pg_catalog to prove the three tables, "
    "the trigger and the function are really gone; nothing offline can answer "
    "that. Run it with:\n"
    "    cd backend && railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_sales_territory_stack_dropped.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


@pytest.mark.asyncio
async def test_live_the_three_are_gone_from_both_schemas() -> None:
    dsn = live_dsn()
    if dsn is None:
        pytest.skip(SKIP_REASON)

    import asyncpg

    # statement_cache_size=0: PgBouncer in transaction mode rejects prepared
    # statements held across sessions.
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        still_here = []
        for schema in ("staging", "public"):
            for name in DROPPED:
                q = f"{schema}.{name}"
                if await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", q):
                    still_here.append(q)
        assert not still_here, (
            f"migration 235 dropped these; they are back: {still_here}")

        trig = await conn.fetchval(
            "SELECT count(*) FROM pg_trigger t "
            "JOIN pg_class c ON c.oid = t.tgrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE NOT t.tgisinternal AND n.nspname = 'public' "
            "AND t.tgname = 'trg_stg_deal_close_target'")
        assert trig == 0, (
            "trg_stg_deal_close_target is back on public.crm_deals. Its body "
            "UPDATEs public.sales_targets, which does not exist: every deal "
            "close now raises 42P01.")

        fn = await conn.fetchval(
            "SELECT count(*) FROM pg_proc p "
            "JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public' "
            "AND p.proname = 'sales_update_target_on_deal_close'")
        assert fn == 0, "the trigger function is back"

        # Nothing anywhere may name them in a function body — the class of
        # dependency the constraint graph does not record.
        bodies = await conn.fetch(
            "SELECT n.nspname, p.proname FROM pg_proc p "
            "JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE p.prosrc ~* 'sales_(territories|targets|routing_rules)'")
        assert not bodies, (
            "function bodies name a dropped table (untracked dependency, "
            f"42P01 at runtime): {[(r[0], r[1]) for r in bodies]}")

        # And the shared function that must have SURVIVED the drop.
        #
        # The schema is NAMED here rather than left to `current_schemas()`.
        # `count(*) == 1` is only a tripwire while the filter is exact: a
        # search-path-relative filter counts whatever happens to be in scope,
        # so a SECOND copy of `touch_updated_at` in another schema would either
        # be missed or push the count to 2 and be read as "the drop went
        # wrong". After the consolidation the one true copy is `public`'s —
        # before 241 has run this returns 0 and says so, which is the answer
        # worth having.
        shared = await conn.fetchval(
            "SELECT count(*) FROM pg_proc p "
            "JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'public' AND p.proname = 'touch_updated_at'")
        assert shared == 1, (
            f"expected exactly one public.touch_updated_at(), found {shared}. "
            "It backs 27 triggers; migration 235 was never allowed to touch "
            "it, and 241 must move it rather than duplicate it.")
    finally:
        await conn.close()
