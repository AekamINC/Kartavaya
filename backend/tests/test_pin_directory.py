"""Phase 7.2 — the PIN directory, and the two ways of getting it silently wrong.

Both failure modes here are SILENT. Neither raises, neither shows up in a row
count, and both are only discovered months later by a query that returns
nothing:

  1. **`pincode` treated as unique.** `ON CONFLICT (pincode) DO NOTHING` does
     not error on this dataset. It keeps whichever district was read first and
     drops the other two, so a customer in Nizamuddin is filed under NEW DELHI
     district because their row lost a race in a CSV. 1,229 of 18,839 PINs span
     more than one district and 51 span more than one STATE.
  2. **`state_lgd` / `district_lgd` stored as `integer`.** `'07'::integer` is a
     perfectly legal cast. Delhi becomes 7, New Delhi district becomes 94, and
     the values stop matching every other government dataset keyed on LGD.

So the tests below do not check that the loader "works". They check that those
two things are impossible: the padding is asserted out of the COLUMN and not out
of the CSV, and the conflict target is asserted to be composite.

── FOUR KINDS OF TEST, AND WHY THERE ARE FOUR ───────────────────────────────

  1. THE PARSE, pure. Every refusal `parse_rows` can make, including the one
     that exists solely to catch a file that came back through a spreadsheet
     with its leading zeros eaten.
  2. THE STATEMENT. `UPSERT_SQL`'s conflict target and its `IS DISTINCT FROM`
     guard, asserted as text, because those two clauses ARE the idempotence and
     a refactor that quietly drops either leaves every other test passing.
  3. LIVE SCHEMA. Both statements PREPAREd — Parse and Describe, no execution,
     no row read and none written — plus the catalogue read directly, because
     `prepare()` plans a statement against an `integer` column perfectly
     happily. The `data_type` assertion is the one that catches the trap.
  4. LIVE DATA. PHASE-7 §7.2's acceptance read back out of the table:
     20,144 / 18,839, `110003` three times, `110025` in two STATES, and
     `state_lgd` still reading `'07'`. Read-only.

── WHY THIS FILE NAMES NO ROUTER ────────────────────────────────────────────

`tests/test_every_writer_has_a_live_sql_test.py` marks a router "covered" when
any test file both PREPAREs a statement and mentions that router's import path.
This file PREPAREs two. Mentioning the CRM router — which is baselined there
with thirty-odd write paths nothing here proves anything about — would delete it
from that baseline on a technicality and quietly retire the guarantee.
`tests/test_pin_boundaries.py` and `tests/test_territory_routing.py` both carry
this same note, and it is the reason the SQL lives in the service module rather
than in `scripts/load_pin_directory.py`: nothing under `tests/` imports from
`scripts/`, so a statement written there could never be prepared at all.
"""
import asyncio
import json
import os

import pytest

from services import pin_directory as pdir
from services import territory_routing as tr


HEADER = "pincode,state,district,blocks,state_lgd,district_lgd"


def csv_of(*lines: str) -> str:
    return "\n".join((HEADER,) + lines) + "\n"


#: One good line, and the padding in it is the point: '07' and '094'.
DELHI = '110001,DELHI,NEW DELHI,"[""NEW DELHI""]",07,094'


# ══════════════════════════════════════════════════════════════════════════════
#  1 · THE PARSE
# ══════════════════════════════════════════════════════════════════════════════

def test_a_good_row_parses_and_every_field_is_a_string():
    rows, problems = pdir.parse_rows(csv_of(DELHI))
    assert problems == []
    assert len(rows) == 1
    row = rows[0]
    assert all(isinstance(v, str) for v in row), (
        "one of these came back as an int. That is how the zero-padding dies")


def test_the_zero_padding_survives_the_parse():
    """`'07'`, NOT `7`. The single most likely way to get 7.2 wrong."""
    rows, _ = pdir.parse_rows(csv_of(DELHI))
    assert rows[0].state_lgd == "07"
    assert rows[0].district_lgd == "094"
    assert rows[0].state_lgd != "7" and rows[0].district_lgd != "94"


def test_an_lgd_that_lost_its_padding_is_refused_by_name():
    """A file that came back through a spreadsheet. Every other check passes."""
    rows, problems = pdir.parse_rows(
        csv_of('110001,DELHI,NEW DELHI,"[""NEW DELHI""]",7,094'))
    assert rows == []
    assert len(problems) == 1
    assert "zero-padding" in problems[0]
    assert "state_lgd" in problems[0]


def test_a_district_lgd_that_lost_its_padding_is_refused_too():
    rows, problems = pdir.parse_rows(
        csv_of('110001,DELHI,NEW DELHI,"[""NEW DELHI""]",07,94'))
    assert rows == []
    assert "district_lgd" in problems[0] and "zero-padding" in problems[0]


def test_a_four_digit_district_lgd_is_refused():
    """The check is a shape, not a minimum length: '0940' is not a code."""
    rows, problems = pdir.parse_rows(
        csv_of('110001,DELHI,NEW DELHI,"[]",07,0940'))
    assert rows == [] and len(problems) == 1


def test_what_counts_as_a_pin_is_routings_definition_and_not_a_second_one():
    """Two definitions of "is this a PIN" is how a contact routes into Surat
    while the directory holds no row for it and nobody can say which is lying."""
    for bad in ("012345", "40001", "4000011", "ahmedabad", "NW1 245", ""):
        rows, problems = pdir.parse_rows(
            csv_of(f'{bad},GUJARAT,SURAT,"[]",24,492'))
        assert rows == [], f"{bad!r} was accepted here"
        assert tr.normalise_pin(bad) == "", f"{bad!r} is accepted by routing"
    assert tr.normalise_pin("395002") == "395002"
    rows, problems = pdir.parse_rows(csv_of('395002,GUJARAT,SURAT,"[]",24,492'))
    assert len(rows) == 1 and problems == []


def test_a_blank_state_or_district_is_refused():
    rows, problems = pdir.parse_rows(csv_of('110001,,NEW DELHI,"[]",07,094'))
    assert rows == [] and "blank state or district" in problems[0]


def test_blocks_must_be_a_json_array_and_is_stored_compactly():
    rows, _ = pdir.parse_rows(
        csv_of('110003,DELHI,NEW DELHI,"[""NEW DELHI"", ""DELHI""]",07,094'))
    assert json.loads(rows[0].blocks) == ["NEW DELHI", "DELHI"]
    # Compact, so a source that differs only in whitespace is still `unchanged`
    # on a re-run rather than counting as 20,144 updates.
    assert rows[0].blocks == '["NEW DELHI","DELHI"]'

    for bad in ('"{""a"": 1}"', '"not json"', '"5"'):
        rows, problems = pdir.parse_rows(
            csv_of(f'110001,DELHI,NEW DELHI,{bad},07,094'))
        assert rows == [], f"{bad} was accepted as a blocks array"
        assert len(problems) == 1


def test_the_na_blocks_are_kept_because_they_are_the_sources_own_content():
    """2,435 live rows carry the literal 'NA'. It is not clean and it is not
    ours to drop — the table comment carries the warning instead."""
    rows, problems = pdir.parse_rows(
        csv_of('110025,DELHI,SOUTH EAST,"[""NA"",""NEW DELHI""]",07,677'))
    assert problems == []
    assert json.loads(rows[0].blocks) == ["NA", "NEW DELHI"]


def test_a_reordered_header_is_refused_rather_than_guessed():
    text = ("state,pincode,district,blocks,state_lgd,district_lgd\n"
            'DELHI,110001,NEW DELHI,"[]",07,094\n')
    rows, problems = pdir.parse_rows(text)
    assert rows == []
    assert "header is" in problems[0]


def test_every_bad_line_is_reported_not_just_the_first():
    """An operator told about row 9,412 fixes it and is then told about 9,413."""
    rows, problems = pdir.parse_rows(csv_of(
        '110001,DELHI,NEW DELHI,"[]",7,094',
        '110002,DELHI,CENTRAL,"[]",07,95',
        DELHI,
    ))
    assert len(problems) == 2
    assert len(rows) == 1, "the good row still parses"
    assert "line 2" in problems[0] and "line 3" in problems[1]


# ── The multi-district / multi-state shape, which is the whole schema ─────────

def test_one_pin_in_three_districts_gives_three_rows_and_no_collision():
    """`110003` is NEW DELHI/094, SOUTH EAST/677 and SOUTH/098. The handover
    said two. Anything that dedupes on `pincode` keeps one of these three."""
    rows, problems = pdir.parse_rows(csv_of(
        '110003,DELHI,NEW DELHI,"[]",07,094',
        '110003,DELHI,SOUTH EAST,"[]",07,677',
        '110003,DELHI,SOUTH,"[]",07,098',
    ))
    assert problems == []
    assert len(rows) == 3
    assert len({r.pincode for r in rows}) == 1
    assert pdir.key_collisions(rows) == []


def test_one_pin_in_two_states_is_not_a_collision_either():
    """`110025` is DELHI/SOUTH EAST, DELHI/SOUTH and UTTAR PRADESH/BUDAUN. It
    is the row 7.6's "a PIN fills district and state" is false for."""
    rows, _ = pdir.parse_rows(csv_of(
        '110025,DELHI,SOUTH EAST,"[]",07,677',
        '110025,UTTAR PRADESH,BUDAUN,"[]",09,149',
        '110025,DELHI,SOUTH,"[]",07,098',
    ))
    assert len({r.state for r in rows}) == 2
    assert pdir.key_collisions(rows) == []


def test_a_repeated_pincode_and_district_lgd_IS_a_collision():
    """Caught in Python, before a UniqueViolationError rolls 20,144 rows back
    to name one side of it."""
    rows, _ = pdir.parse_rows(csv_of(
        '110003,DELHI,NEW DELHI,"[]",07,094',
        '110003,DELHI,NEW DELHI,"[]",07,094',
    ))
    collisions = pdir.key_collisions(rows)
    assert collisions and "district_lgd" in collisions[0]


def test_the_same_named_district_under_two_codes_is_also_a_collision():
    """The second unique index, which is the one that stops a join doubling."""
    rows, _ = pdir.parse_rows(csv_of(
        '110003,DELHI,NEW DELHI,"[]",07,094',
        '110003,DELHI,NEW DELHI,"[]",07,095',
    ))
    collisions = pdir.key_collisions(rows)
    assert collisions
    assert any("state, district" in c for c in collisions)


# ══════════════════════════════════════════════════════════════════════════════
#  2 · THE STATEMENT — the two clauses that ARE the idempotence
# ══════════════════════════════════════════════════════════════════════════════

def test_the_conflict_target_is_composite_and_never_pincode_alone():
    sql = " ".join(pdir.UPSERT_SQL.split())
    assert "ON CONFLICT (pincode, district_lgd) DO UPDATE" in sql
    assert "ON CONFLICT (pincode) " not in sql, (
        "a PIN is not unique: 1,229 span two or more districts and 51 span two "
        "or more STATES. Conflicting on pincode alone does not error - it keeps "
        "whichever district was read first and drops the rest, silently")


def test_the_do_update_is_guarded_so_a_re_run_is_observably_a_no_op():
    sql = " ".join(pdir.UPSERT_SQL.split())
    assert "IS DISTINCT FROM" in sql, (
        "without the guard a second run 'updates' 20,144 rows, stamps every "
        "updated_at and reports a number that looks like work")
    # Every column the upsert can change must be in the guard, or a change to
    # that column would be written and then reported as unchanged.
    for col in ("state", "district", "blocks", "state_lgd", "source_vintage"):
        assert f"d.{col} IS DISTINCT FROM EXCLUDED.{col}" in sql, col


def test_every_bind_in_the_upsert_carries_an_explicit_cast():
    """PgBouncer turns an untyped parse error into an instant 500, and this
    statement is also what the next reader will copy."""
    sql = pdir.UPSERT_SQL
    for i in range(1, 7):
        assert f"${i}::text[]" in sql, f"${i} is not cast"
    assert "$7::text" in sql


def test_the_chunks_all_sit_in_one_transaction():
    """The answer to "what if it dies halfway" is that there is no halfway.

    Asserted from the source rather than from the docstring: a refactor that
    moved `conn.transaction()` inside the chunk loop would leave the docstring
    saying "one transaction" and the loader able to stop half-loaded.
    """
    import inspect
    src = inspect.getsource(pdir.load)
    assert "async with conn.transaction():" in src
    body = src.split("async with conn.transaction():", 1)[1]
    assert "for start in range(" in body, (
        "the chunk loop must be INSIDE the transaction, or a failure in chunk "
        "nine leaves eight chunks committed")


# ══════════════════════════════════════════════════════════════════════════════
#  3 · LIVE SCHEMA — Parse and Describe, nothing executed
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection, so a statement is planned the way it
#: will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

DB_SKIP = (
    "no live database. This half PREPAREs the loader's statements against the "
    "real catalogue and reads back the loaded rows: Parse and Describe, no "
    "execution, no row written. Run it with:\n"
    "    cd backend && railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_pin_directory.py -q"
)


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


@pytest.fixture(scope="module")
def described():
    """Prepared once for the whole file. A synchronous fixture running its own
    loop, deliberately: the suite pins `asyncio_default_fixture_loop_scope =
    function`, so a module-scoped async fixture would share a loop it does not
    own."""
    if live_dsn() is None:
        pytest.skip(DB_SKIP)
    import asyncpg

    async def run():
        # statement_cache_size=0 because the connection goes through PgBouncer
        # in transaction mode, where a cached server-side statement belongs to a
        # session that will not be there next time.
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            upsert = await conn.prepare(pdir.UPSERT_SQL)
            summary = await conn.prepare(pdir.SUMMARY_SQL)
            columns = await conn.fetch(
                "SELECT column_name, data_type, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_schema='staging' AND table_name='pin_directory'")
            indexes = await conn.fetch(
                "SELECT indexname, indexdef FROM pg_indexes "
                "WHERE schemaname='staging' AND tablename='pin_directory'")
            checks = await conn.fetch(
                "SELECT c.conname, pg_get_constraintdef(c.oid) AS def "
                "FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid "
                "JOIN pg_namespace n ON n.oid = t.relnamespace "
                "WHERE n.nspname='staging' AND t.relname='pin_directory'")
            live = await conn.fetchrow(pdir.SUMMARY_SQL, pdir.VINTAGE)
            return {
                "upsert_binds": len(upsert.get_parameters()),
                "summary_binds": len(summary.get_parameters()),
                "columns": {r["column_name"]: r["data_type"] for r in columns},
                "indexes": {r["indexname"]: r["indexdef"] for r in indexes},
                "checks": {r["conname"]: r["def"] for r in checks},
                "live": dict(live),
            }
        finally:
            await conn.close()

    return asyncio.run(run())


def test_live_both_statements_parse_against_the_real_schema(described):
    """A MagicMock answers happily to a statement naming a column that is not
    there — that is how `gst_rate` survived in the billing router until it had
    never once succeeded."""
    assert described["upsert_binds"] == 7
    assert described["summary_binds"] == 1


def test_live_the_lgd_columns_are_TEXT_and_not_integer(described):
    """THE TRAP, asserted against the CATALOGUE.

    `prepare()` plans the upsert against an `integer` column perfectly happily —
    `'07'::integer` is legal — so the statement parsing proves nothing here. The
    only thing that does is the declared type.
    """
    cols = described["columns"]
    assert cols.get("state_lgd") == "text", (
        f"state_lgd is {cols.get('state_lgd')!r}. An integer column turns '07' "
        f"into 7 with no error and it stops matching every other government "
        f"dataset keyed on LGD. The table has to be rebuilt, not patched")
    assert cols.get("district_lgd") == "text"
    assert cols.get("pincode") == "text"
    assert cols.get("blocks") == "jsonb"
    assert "org_id" not in cols, (
        "national reference data has no tenant column; if one appeared, the "
        "reversal in migration 233 stopped being exact")


def test_live_both_composite_keys_are_enforced(described):
    """Two measurements from a plan become two facts that stay true."""
    defs = " | ".join(described["indexes"].values())
    assert "UNIQUE" in defs
    assert "pin_directory_pin_district_uniq" in described["indexes"]
    assert "pin_directory_pin_state_district_uniq" in described["indexes"]
    # And nothing unique on `pincode` alone, which would reject 1,305 rows.
    for name, ddl in described["indexes"].items():
        assert "UNIQUE" not in ddl or "(pincode)" not in ddl.replace(" ", ""), (
            f"{name} makes pincode unique. 1,229 PINs span two or more "
            f"districts")


def test_live_the_check_constraints_are_really_there(described):
    """From `pg_constraint`, never from the migration file: an inline CHECK on
    `ADD COLUMN IF NOT EXISTS` is skipped WHOLE when the column exists, so a
    migration is not evidence a constraint is."""
    checks = described["checks"]
    assert "pin_directory_pincode_ck" in checks
    assert "pin_directory_state_lgd_ck" in checks
    assert "pin_directory_district_lgd_ck" in checks
    assert "[0-9]{2}" in checks["pin_directory_state_lgd_ck"]
    assert "[0-9]{3}" in checks["pin_directory_district_lgd_ck"]


# ══════════════════════════════════════════════════════════════════════════════
#  4 · LIVE DATA — PHASE-7 7.2's acceptance, read back out of the table
# ══════════════════════════════════════════════════════════════════════════════

def test_live_the_acceptance_counts_are_off_zero(described):
    """`count(*)` -> 20144 and `count(DISTINCT pincode)` -> 18839.

    This is also the standing guard against a double load: 40,288 here means the
    upsert's conflict target stopped matching an index.
    """
    live = described["live"]
    assert live["row_count"] == 20144, f"count(*) is {live['row_count']:,}"
    assert live["pin_count"] == 18839, f"distinct pincodes is {live['pin_count']:,}"


def test_live_a_pin_is_not_unique_and_the_table_proves_it(described):
    live = described["live"]
    assert live["pin_110003"] == 3, (
        "110003 is NEW DELHI/094, SOUTH EAST/677 and SOUTH/098. Fewer than "
        "three rows means something deduplicated on pincode")
    assert live["states_for_110025"] == 2, (
        "110025 is in DELHI and in UTTAR PRADESH. This is the row that makes "
        "7.6's 'a PIN fills district and state' false")


def test_live_the_zero_padding_survived_the_round_trip(described):
    """The only proof that matters: read out of the COLUMN, not the CSV."""
    live = described["live"]
    assert live["delhi_state_lgd"] == "07", (
        f"DELHI's state_lgd reads {live['delhi_state_lgd']!r}. If it says '7' "
        f"the padding was destroyed somewhere between R2 and the column")
    assert live["newdelhi_district_lgd"] == "094"


def test_live_every_row_carries_the_vintage_it_was_loaded_from(described):
    assert described["live"]["other_vintage"] == 0


# ══════════════════════════════════════════════════════════════════════════════
#  5 · LIVE R2 — a mocked object store hides a wrong key
# ══════════════════════════════════════════════════════════════════════════════

_R2_ENV = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
           "R2_BUCKET_NAME")

live_r2 = pytest.mark.skipif(
    not all(os.getenv(k) for k in _R2_ENV),
    reason="no R2 credentials. This half reads the REAL bucket, because a fake "
           "client answers happily to a key that does not exist - the same way "
           "a mock pool answers happily to a column that does not exist.")


@live_r2
async def test_live_r2_the_csv_is_the_bytes_that_were_audited():
    text, digest, size = await pdir.fetch_csv()
    assert size == 1_269_336
    assert digest == pdir.KNOWN_DIGESTS[pdir.VINTAGE]
    rows, problems = pdir.parse_rows(text)
    assert problems == [], problems[:3]
    assert len(rows) == 20144
    assert len({r.pincode for r in rows}) == 18839
    assert pdir.key_collisions(rows) == []


@live_r2
async def test_live_r2_an_unknown_vintage_refuses_rather_than_loading():
    """The digest check is what makes "the file at that key" and "the file whose
    rows were counted" the same sentence."""
    with pytest.raises(RuntimeError) as exc:
        await pdir.fetch_csv("datagov-1999-01")
    # Either refusal is correct and which one fires depends only on whether a
    # file happens to be at that key: no object -> the read refuses and names
    # the vintage; an object -> the digest is unknown and it refuses to load
    # bytes nobody has looked at. What must NOT happen is a load.
    message = str(exc.value)
    assert "datagov-1999-01" in message or "KNOWN_DIGESTS" in message
