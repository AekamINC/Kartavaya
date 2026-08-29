"""
The DPDP notice acknowledgement — the router and migration 113 are ONE CONTRACT.

`routers/pahchan.py` writes `staging.pahchan_notice_acknowledgements` and reads
it back on `GET /v1/pahchan/me`. It does so under a deliberate degrade: any
`42P01` (no such table) or `42703` (no such column) is swallowed and answered as
`{"stored": false}` with a 200, because that gate sits above the camera on the
phone and 07 §2 is that NOTHING BLOCKS A PUNCH.

THAT DEGRADE IS ALSO A TRAP, and this file is the tripwire on it. A column
renamed on either side produces `42703`, which the router reads as "the migration
has not been applied". The product keeps working, keeps answering 200, and keeps
storing nothing — silently, forever, which is the exact condition the table
exists to end. Migration 113 is unapplied today, so there is no live database to
catch it either. The only remaining instrument is this: read both files and
insist they agree.

WHAT THIS FILE CANNOT DO. It does not touch a database and does not run SQL. It
proves the two texts name the same columns and that the exception classifier
covers the two SQLSTATEs. It cannot prove the INSERT executes, that the unique
index dedupes, or that a skewed device clock is accepted — 113 carries hand-run
verification queries for those, and they need the migration applied.
"""

import pathlib
import re

import pytest

from routers.pahchan import (
    PAHCHAN_NOTICE_VERSION,
    NoticeAckBody,
    _notice_store_absent,
)

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_MIGRATION = _BACKEND / "migrations" / "113_pahchan_notice_acknowledgements.sql"
_ROUTER = _BACKEND / "routers" / "pahchan.py"

#: The columns the router names, written out by hand. NOT parsed from the router
#: and then compared to the router — a test that computes both sides of its own
#: assertion agrees with itself.
_ROUTER_WRITES = {
    "org_id", "user_id", "employee_id", "notice_version",
    "acknowledged_at", "source", "was_offline",
}


class _FakePgError(Exception):
    """asyncpg raises exceptions carrying `sqlstate`; that attribute is all the
    classifier looks at, so this is a faithful stand-in for one."""

    def __init__(self, sqlstate: str):
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


# ── The degrade, which is the whole reason the gate is safe ──────────────────

@pytest.mark.parametrize("state", ["42P01", "42703"])
def test_a_missing_table_or_column_degrades_rather_than_raising(state):
    # 42P01 = the table is not there (113 unapplied). 42703 = it is there but a
    # column this code names is not. Both mean "the store is not what we were
    # promised", and neither may become a 500 in front of somebody's punch.
    assert _notice_store_absent(_FakePgError(state)) is True


@pytest.mark.parametrize("state", ["23505", "23503", "22001", "40001", None])
def test_every_other_database_error_is_still_an_error(state):
    # The degrade is narrow on purpose. A unique violation, a foreign-key
    # violation or a serialisation failure are real and must surface — swallowing
    # them would turn this endpoint into one that always says yes.
    assert _notice_store_absent(_FakePgError(state) if state else ValueError()) is False


# ── The contract with migration 113 ──────────────────────────────────────────

def _migration_sql() -> str:
    assert _MIGRATION.exists(), (
        f"{_MIGRATION.name} is missing. The router writes the table it creates; "
        "a missing migration is a failure here and not a skip."
    )
    return _MIGRATION.read_text(encoding="utf-8")


def _created_columns() -> set[str]:
    """The column names inside `CREATE TABLE ... pahchan_notice_acknowledgements`.

    Cut at the closing `);` rather than scanned over the whole file: 113 explains
    itself at length in `--` prose and that prose names columns it argues
    AGAINST having (`acknowledged BOOLEAN DEFAULT ...`, `consent`). A grep over
    the file would find those and pass a file that is wrong in the other
    direction.
    """
    sql = _migration_sql()
    start = sql.index("CREATE TABLE IF NOT EXISTS staging.pahchan_notice_acknowledgements")
    body = sql[sql.index("(", start) + 1 : sql.index("\n);", start)]
    cols = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("--"):
            continue
        m = re.match(r"([a-z_]+)\s+(UUID|TEXT|TIMESTAMPTZ|BOOLEAN)", line)
        if m:
            cols.add(m.group(1))
    return cols


def test_the_column_parser_reads_the_table_and_not_the_prose():
    # The guard on the guard. `id` is in the CREATE TABLE and nowhere else that
    # matters; `consent` appears only in the header, arguing that it must never
    # exist. If the parser were a grep, the second would be found.
    cols = _created_columns()
    assert "id" in cols
    assert "consent" not in cols
    assert "agreed" not in cols
    assert "opted_in" not in cols


def test_every_column_the_router_writes_exists_in_the_migration():
    missing = _ROUTER_WRITES - _created_columns()
    assert not missing, (
        f"routers/pahchan.py writes {sorted(missing)}, which 113 does not create. "
        "That is a 42703 at runtime, and the router swallows 42703 as "
        "'the migration is not applied' — so this would ship as a permanently "
        "silent no-op rather than as an error."
    )


def test_the_router_writes_the_table_the_migration_creates():
    src = _ROUTER.read_text(encoding="utf-8")
    assert "public.pahchan_notice_acknowledgements" in src
    # The table the first draft of this feature invented, before 113 was found.
    assert "pahchan_notice_acks" not in src


def test_the_on_conflict_target_is_the_index_that_exists():
    # `ON CONFLICT (a, b, c)` requires a unique index on exactly those columns in
    # some order; naming a different set raises 42P10, which is NOT in the
    # degrade list and would 500 in front of a punch.
    src = _ROUTER.read_text(encoding="utf-8")
    m = re.search(r"ON CONFLICT \(([^)]+)\) DO NOTHING", src)
    assert m, "the acknowledgement INSERT no longer uses ON CONFLICT DO NOTHING"
    target = {c.strip() for c in m.group(1).split(",")}

    sql = _migration_sql()
    idx = re.search(
        r"CREATE UNIQUE INDEX[^;]*?ON staging\.pahchan_notice_acknowledgements\s*\(([^)]+)\)",
        sql,
    )
    assert idx, "113 no longer declares a unique index on the acknowledgement table"
    assert target == {c.strip() for c in idx.group(1).split(",")}


def test_the_subject_is_the_account_and_not_the_employee():
    # Migration 113's measurement: 81 employee rows, 0 carrying a user_id, so
    # `_employee_for` resolves nobody. Keyed on the employee this table could not
    # accept one acknowledgement from one person, and the gate above the camera
    # would have to be waved through — which is the notice not existing.
    sql = _migration_sql()
    assert "user_id         TEXT NOT NULL" in sql
    idx = re.search(
        r"CREATE UNIQUE INDEX[^;]*?ON staging\.pahchan_notice_acknowledgements\s*\(([^)]+)\)",
        sql,
    )
    assert "user_id" in idx.group(1)
    assert "employee_id" not in idx.group(1)


def test_nothing_records_an_acknowledgement_by_omission():
    # THE ABSENCE OF A ROW MUST MEAN "NOT ACKNOWLEDGED". A boolean column with a
    # default is a way for a row to exist saying yes on somebody's behalf, and
    # `notice_version` with a default is a row that does not say what was read.
    sql = _migration_sql()
    body = sql[sql.index("CREATE TABLE IF NOT EXISTS staging.pahchan_notice_acknowledgements"):]
    body = body[: body.index("\n);")]
    # `acknowledged_at` is a TIMESTAMPTZ and is the record itself. What must
    # never appear is a column that can say yes without a person: a boolean
    # named for agreement, whatever its default.
    forbidden = re.compile(
        r"^\s*(acknowledged|agreed|consented?|consent_given|opted_in|has_consent)\s+", re.I,
    )
    for line in body.splitlines():
        if forbidden.match(line):
            pytest.fail(f"a consent-shaped column appeared: {line.strip()}")
    assert "acknowledged_at TIMESTAMPTZ NOT NULL," in body, (
        "acknowledged_at must stay a NOT NULL timestamp with no default — the "
        "client states when the person tapped and the server does not invent it"
    )
    assert not re.search(r"notice_version[^,]*DEFAULT", body)


# ── The request body ─────────────────────────────────────────────────────────

def test_the_version_defaults_rather_than_422ing():
    # A client that has not been updated must still record SOMETHING. An
    # acknowledgement filed under the wrong version is recoverable; a punch
    # blocked by a 422 is the thing 07 §2 exists to prevent.
    assert NoticeAckBody().version == PAHCHAN_NOTICE_VERSION


def test_the_device_clock_is_optional_and_is_never_invented_by_the_model():
    # 113's two clocks. The client states when the person tapped; if it does not,
    # the handler uses now — but the MODEL must not default it, or a client that
    # meant to send a three-day-old instant and failed to would look identical to
    # one that tapped this second.
    assert NoticeAckBody().acknowledged_at is None


def test_the_surface_vocabulary_is_exactly_web_and_mobile():
    from pydantic import ValidationError

    assert NoticeAckBody(source="web").source == "web"
    assert NoticeAckBody(source="mobile").source == "mobile"
    with pytest.raises(ValidationError):
        NoticeAckBody(source="kiosk")


def test_offline_is_stated_by_the_client_and_defaults_to_false():
    # Not inferred from the two timestamps here — a phone with a wrong clock
    # would make that inference lie in both directions (113).
    assert NoticeAckBody().was_offline is False
    assert NoticeAckBody(was_offline=True).was_offline is True
