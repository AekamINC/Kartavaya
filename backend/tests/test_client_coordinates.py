"""PUT/DELETE /api/v1/graha/{clients,contacts}/{id}/coordinate — Phase 8.4.

── WHY THIS ROUTE EXISTS, AND WHY IT IS THE LAST STEP IN THE PHASE ──────────

§8.4 is the only step in the map programme that CREATES AN OBLIGATION.
Everything before it is reversible: a link out to Google Maps, a PIN polygon
drawn from a government dataset we already hold, an autosuggest whose result is
thrown away. A STORED coordinate is different — it is a piece of data with a
vendor's terms attached to it, and the terms of the two vendors this product
can touch are incompatible with each other:

    Google  a cached coordinate is permitted for 30 DAYS
    Mappls  caching a geocode result is FORBIDDEN OUTRIGHT

So the four columns ship together or not at all. A bare `lat`/`lng` pair
answers "where did this come from?" with a shrug, and a shrug complies with
neither rule.

── WHAT THESE TESTS ARE FOR ────────────────────────────────────────────────

  1. `geo_fetched_at` IS SERVER-SIDE AND UNREACHABLE. Not "we don't set it" —
     there is no field on the model and no bind position in the SQL. A
     caller-supplied timestamp would let the 30-day retention clock be reset by
     the thing it constrains.
  2. THE FOUR COLUMNS MOVE TOGETHER. Set writes all four; clear nulls all
     four; neither can produce a half-coordinate or a bare pair.
  3. EVERY STATEMENT IS SCOPED BY `org_id`. This is tenant data on a table
     three modules share, and a cross-tenant write here would be a real
     defect, not a hardening opportunity.
  4. THE ALLOWLIST HAS NO MAPPLS VALUE, and the router's copy of it and the
     migration's CHECK are read out of both files and compared.
  5. THE SQL IS PREPAREd AGAINST THE REAL SCHEMA. CLAUDE.md: never ship a
     router without one test that executes its SQL against the real schema.
     Skipped with instructions when there is no database, which is CI today.

⚠ MIGRATION 237 IS NOT APPLIED AS THIS FILE IS WRITTEN. The live half measures
  the catalogue first and says so in words; the PREPARE tests skip until the
  columns exist, and `test_migration_237_has_been_applied` FAILS until then. A
  skip that hides the state of the schema is how a green suite hid a live 500
  in this repo before.
"""
import math
import os
import re
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException


MIGRATION = (Path(__file__).resolve().parents[1]
             / "migrations" / "237_client_contact_coordinates.sql")

CLIENTS = "staging.graha_clients"
CONTACTS = "staging.graha_contacts"

#: Surat, where Unicode Group's clients actually are.
SURAT = (21.1702, 72.8311)


@pytest.fixture
def route():
    from routers import graha
    return graha


# ══════════════════════════════════════════════════════════════════════════════
#  0 · A pool that records the statement instead of running it
# ══════════════════════════════════════════════════════════════════════════════

class _Pool:
    """Captures the SQL and the binds. Writes nothing, anywhere, ever."""

    def __init__(self, row=None):
        self.row = row
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return self.row

    @property
    def sql(self):
        assert len(self.calls) == 1, f"expected one statement, got {len(self.calls)}"
        return self.calls[0][0]

    @property
    def binds(self):
        assert len(self.calls) == 1, f"expected one statement, got {len(self.calls)}"
        return self.calls[0][1]


SET_ROW = {
    "lat": Decimal("21.1702000"), "lng": Decimal("72.8311000"),
    "geo_source": "user_pin", "geo_fetched_at": "2026-08-28T09:00:00+00:00",
}

USER = {"user_id": "11111111-1111-1111-1111-111111111111"}
ORG = "22222222-2222-2222-2222-222222222222"
REC = "33333333-3333-3333-3333-333333333333"


def _body(route, lat=SURAT[0], lng=SURAT[1], geo_source="user_pin"):
    return route.CoordinateWrite(lat=lat, lng=lng, geo_source=geo_source)


def _install(route, monkeypatch, row=None):
    pool = _Pool(row)

    async def _get_pool():
        return pool

    monkeypatch.setattr(route, "get_pool", _get_pool)
    return pool


# ══════════════════════════════════════════════════════════════════════════════
#  1 · geo_fetched_at is the server's, and no caller can reach it
# ══════════════════════════════════════════════════════════════════════════════

def test_the_request_model_has_no_geo_fetched_at_field(route):
    """The strongest form of "server-side": there is no field to send.

    A `geo_fetched_at` on this model would be the only thing standing between a
    caller and resetting the 30-day Google retention clock on a coordinate they
    captured last year — and the thing standing there would be a convention.
    """
    model = route.CoordinateWrite
    fields = set(getattr(model, "model_fields", None) or model.__fields__)
    assert fields == {"lat", "lng", "geo_source"}, (
        f"CoordinateWrite grew a field: {sorted(fields)}. If it is "
        "geo_fetched_at, read the block comment above the route.")


def test_the_timestamp_is_NOW_in_the_statement_and_not_a_bind(route):
    for table, stmts in route.COORDINATE_SQL.items():
        assert "geo_fetched_at=NOW()" in stmts["set"], table
        # Six binds and no more: id, org_id, lat, lng, geo_source, actor.
        # A seventh would be the timestamp arriving from outside.
        assert set(re.findall(r"\$(\d+)", stmts["set"])) == {
            "1", "2", "3", "4", "5", "6"}, stmts["set"]


@pytest.mark.asyncio
async def test_setting_a_coordinate_writes_all_four_columns(route, monkeypatch):
    pool = _install(route, monkeypatch, row=SET_ROW)
    out = await route.set_contact_coordinate(
        contact_id=REC, body=_body(route), user=USER, org_id=ORG)

    sql = pool.sql
    assert CONTACTS in sql
    for col in ("lat=", "lng=", "geo_source=", "geo_fetched_at="):
        assert col in sql, f"{col} missing — the four columns move together"
    assert out["status"] == "updated"
    assert out["lat"] == pytest.approx(SURAT[0])
    assert out["geo_source"] == "user_pin"
    assert out["geo_fetched_at"] == SET_ROW["geo_fetched_at"]


@pytest.mark.asyncio
async def test_the_coordinate_is_bound_as_an_exact_decimal(route, monkeypatch):
    """`Decimal(str(x))`, never `Decimal(float)`.

    `Decimal(21.1702)` is 21.17019999999999880984592...; through `str()` the
    value that arrives is the value that lands. The column is `numeric(10,7)`
    precisely so a stored coordinate round-trips exactly, and binding a float's
    binary error into it would throw that away at the door.
    """
    pool = _install(route, monkeypatch, row=SET_ROW)
    await route.set_client_coordinate(
        client_id=REC, body=_body(route), user=USER, org_id=ORG)
    _id, _org, lat, lng, source, actor = pool.binds
    assert isinstance(lat, Decimal) and isinstance(lng, Decimal)
    assert lat == Decimal("21.1702"), f"bound {lat!r}"
    assert lng == Decimal("72.8311"), f"bound {lng!r}"
    assert source == "user_pin"
    assert actor == USER["user_id"]


# ══════════════════════════════════════════════════════════════════════════════
#  2 · Tenancy. This is the one that would be a real defect
# ══════════════════════════════════════════════════════════════════════════════

def test_every_statement_is_scoped_by_org_id_and_id(route):
    """Four statements, four org checks. `graha_clients` is THE company record
    for three modules; an unscoped UPDATE here reaches every tenant."""
    for table, stmts in route.COORDINATE_SQL.items():
        for verb, sql in stmts.items():
            assert "WHERE id=$1::uuid AND org_id=$2::uuid" in sql, (
                f"{table}.{verb} is not org-scoped: {sql}")


@pytest.mark.asyncio
@pytest.mark.parametrize("handler,kw", [
    ("set_client_coordinate", {"client_id": REC}),
    ("set_contact_coordinate", {"contact_id": REC}),
])
async def test_a_record_in_another_org_is_a_404_and_not_a_lying_success(
        route, monkeypatch, handler, kw):
    """`RETURNING` gives `None` when the org check matched nothing.

    `delete_client`'s comment names this exact failure: a route that throws the
    result away and answers `{"status": "updated"}` unconditionally reports
    success for a write that touched no row, and it is unfalsifiable from the
    UI. 404 rather than 403, so this route cannot be used to ask whether a
    given id belongs to somebody else.
    """
    _install(route, monkeypatch, row=None)
    with pytest.raises(HTTPException) as e:
        await getattr(route, handler)(
            body=_body(route), user=USER, org_id=ORG, **kw)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_clearing_a_record_in_another_org_is_also_a_404(
        route, monkeypatch):
    _install(route, monkeypatch, row=None)
    with pytest.raises(HTTPException) as e:
        await route.clear_contact_coordinate(
            contact_id=REC, user=USER, org_id=ORG)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_the_table_name_can_only_come_from_the_allowlist(
        route, monkeypatch):
    """The table is interpolated into SQL with an f-string. That is only ever
    safe because of this guard, so the guard is tested rather than trusted."""
    pool = _install(route, monkeypatch, row=SET_ROW)
    with pytest.raises(HTTPException) as e:
        await route._set_coordinate(
            "staging.users", REC, _body(route), USER, ORG)
    assert e.value.status_code == 500
    assert pool.calls == [], "a statement was issued for an unknown table"
    assert set(route._COORD_TABLES.values()) == {CLIENTS, CONTACTS}


def test_the_routes_are_registered(route):
    """Written and NOT registered is exactly how `/api/v1/support-sessions`
    404'd while its page, its router and its tests all existed. Read off the
    OPENAPI SCHEMA — an included router is a wrapper with no `.path`, so a
    membership test against `app.routes` is vacuously false."""
    import server
    spec = server.app.openapi()["paths"]
    for path in ("/api/v1/graha/clients/{client_id}/coordinate",
                 "/api/v1/graha/contacts/{contact_id}/coordinate"):
        assert path in spec, f"{path} is not registered — the route 404s"
        assert set(spec[path]) == {"put", "delete"}, (
            f"{path} answers {sorted(spec[path])} — set is a PUT and clear is "
            "a DELETE; a PATCH here would be `update_contact`'s shape, which "
            "drops nulls on the floor and could never clear anything")


def test_the_routes_are_behind_the_same_gates_as_the_records_they_write(route):
    import inspect
    for name in ("set_client_coordinate", "clear_client_coordinate",
                 "set_contact_coordinate", "clear_contact_coordinate"):
        src = inspect.getsource(getattr(route, name))
        assert "require_user" in src, name
        assert "get_org_id" in src, name
        assert "_crm_entity_gate" in src, (
            f"{name} must use the widened clients-and-contacts gate, not "
            "`_gate` — a Ganit-only firm owns its own client records")


# ══════════════════════════════════════════════════════════════════════════════
#  3 · What may be stored, and what may not
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_mappls_coordinate_is_refused(route, monkeypatch):
    """THE LICENCE TEST.

    Mappls forbids caching a geocode result to avoid fees, so a Mappls-derived
    coordinate has no lawful home in this database. It is refused here with a
    sentence, and refused again by `*_geo_source_ck` if this tuple is ever
    widened by mistake. Two layers, because a licence breach is not the kind of
    thing to leave to one.
    """
    pool = _install(route, monkeypatch, row=SET_ROW)
    for bad in ("mappls_geocode", "mappls_suggest", "mappls"):
        with pytest.raises(HTTPException) as e:
            await route.set_contact_coordinate(
                contact_id=REC, body=_body(route, geo_source=bad),
                user=USER, org_id=ORG)
        assert e.value.status_code == 400
    assert pool.calls == [], "a refused coordinate still reached the database"
    assert not any("mappls" in s for s in route.GEO_SOURCES)


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["", "GOOGLE", "user pin", "guess", "null"])
async def test_an_unknown_provenance_is_refused(route, monkeypatch, bad):
    _install(route, monkeypatch, row=SET_ROW)
    with pytest.raises(HTTPException) as e:
        await route.set_client_coordinate(
            client_id=REC, body=_body(route, geo_source=bad),
            user=USER, org_id=ORG)
    assert e.value.status_code == 400
    assert "geo_source" in e.value.detail


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["user_pin", "device_gps", "manual_entry",
                                    "google_places", "import"])
async def test_each_lawful_provenance_is_accepted(route, monkeypatch, source):
    _install(route, monkeypatch, row={**SET_ROW, "geo_source": source})
    out = await route.set_contact_coordinate(
        contact_id=REC, body=_body(route, geo_source=source),
        user=USER, org_id=ORG)
    assert out["geo_source"] == source


@pytest.mark.asyncio
@pytest.mark.parametrize("lat,lng", [
    (91, 72.8311), (-90.5, 72.8311), (21.1702, 181), (21.1702, -180.5),
])
async def test_a_coordinate_off_the_earth_is_refused(
        route, monkeypatch, lat, lng):
    pool = _install(route, monkeypatch, row=SET_ROW)
    with pytest.raises(HTTPException) as e:
        await route.set_client_coordinate(
            client_id=REC, body=_body(route, lat=lat, lng=lng),
            user=USER, org_id=ORG)
    assert e.value.status_code == 400
    assert pool.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("lat,lng", [
    (float("nan"), 72.8311), (21.1702, float("inf")),
    (float("-inf"), float("nan")),
])
async def test_NaN_and_Infinity_are_refused_as_numbers_not_as_ranges(
        route, monkeypatch, lat, lng):
    """`json.loads` accepts the bare literals `NaN` and `Infinity`.

    `NaN >= -90` is FALSE, so a range check alone would refuse it — with a
    message about a range, which is not what went wrong. And `Decimal('NaN')`
    is a perfectly good Decimal, so a refusal that happened later would be no
    refusal at all.
    """
    _install(route, monkeypatch, row=SET_ROW)
    with pytest.raises(HTTPException) as e:
        await route.set_contact_coordinate(
            contact_id=REC, body=_body(route, lat=lat, lng=lng),
            user=USER, org_id=ORG)
    assert e.value.status_code == 400
    assert "finite" in e.value.detail, (
        f"refused for the wrong reason: {e.value.detail!r}")
    assert not math.isfinite(lat) or not math.isfinite(lng)


@pytest.mark.asyncio
async def test_null_island_is_refused(route, monkeypatch):
    """(0, 0) is what a failed geocode, an empty form and a dropped decimal all
    produce. It is a real point in the Gulf of Guinea and no customer of an
    Indian PM SaaS is there. The DATABASE allows it — a CHECK is about what is
    representable — and this route does not, because the alternative is a row
    stamped `user_pin` that no human ever pointed at.
    """
    pool = _install(route, monkeypatch, row=SET_ROW)
    with pytest.raises(HTTPException) as e:
        await route.set_client_coordinate(
            client_id=REC, body=_body(route, lat=0, lng=0),
            user=USER, org_id=ORG)
    assert e.value.status_code == 400
    assert pool.calls == []
    # A zero in ONE half is a real place — the equator off Sumatra, the
    # Greenwich meridian — and must NOT be swept up by the same rule.
    _install(route, monkeypatch, row=SET_ROW)
    await route.set_client_coordinate(
        client_id=REC, body=_body(route, lat=0, lng=72.8311),
        user=USER, org_id=ORG)


# ══════════════════════════════════════════════════════════════════════════════
#  4 · Clearing takes all four, or it is refused by the database
# ══════════════════════════════════════════════════════════════════════════════

def test_clearing_nulls_all_four_columns_in_one_statement(route):
    """Nulling the pair and leaving the provenance behind raises 23514 against
    `*_geo_complete_ck` — a source that outlives the coordinate it described is
    unrepresentable, not merely discouraged."""
    for table, stmts in route.COORDINATE_SQL.items():
        clear = stmts["clear"]
        for col in ("lat=NULL", "lng=NULL", "geo_source=NULL",
                    "geo_fetched_at=NULL"):
            assert col in clear, f"{table} clear leaves {col.split('=')[0]} behind"
        # Three binds: id, org_id, actor. No coordinate is sent to clear one.
        assert set(re.findall(r"\$(\d+)", clear)) == {"1", "2", "3"}, clear


@pytest.mark.asyncio
async def test_clearing_reports_cleared_and_stamps_the_actor(
        route, monkeypatch):
    pool = _install(route, monkeypatch, row={"id": REC})
    out = await route.clear_client_coordinate(
        client_id=REC, user=USER, org_id=ORG)
    assert out == {"status": "cleared"}
    assert pool.binds == (REC, ORG, USER["user_id"])
    assert "updated_by=$3" in pool.sql, (
        "who removed this coordinate has no answer anywhere else — the row "
        "survives the clear and nothing else records the act")


# ══════════════════════════════════════════════════════════════════════════════
#  5 · The router's allowlist and the migration's CHECK are ONE list
# ══════════════════════════════════════════════════════════════════════════════

def test_the_migration_exists_and_is_numbered_237(route):
    assert MIGRATION.exists(), f"{MIGRATION} is missing"


def test_the_allowlist_in_the_router_matches_the_CHECK_in_the_migration(route):
    """Two copies of one list is how a value gets added in one place.

    The router's refusal produces a 400 with a sentence; the constraint's
    produces a 23514 the user reads as "Internal Server Error". They must
    refuse the same set, and the only way to know is to read both files.
    """
    sql = MIGRATION.read_text(encoding="utf-8")
    tail = sql.split("geo_source IS NULL OR geo_source IN")[1]
    in_migration = tuple(re.findall(r"''([a-z_]+)''", tail.split("))")[0]))
    assert in_migration == route.GEO_SOURCES, (
        f"migration says {in_migration}, router says {route.GEO_SOURCES}")
    assert not any("mappls" in v for v in in_migration), (
        "a Mappls value was added to the CHECK — Mappls forbids caching a "
        "geocode result, so this is a licence change, not a schema change")


def test_the_migration_backfills_nothing_and_defaults_nothing(route):
    """§8.4: a coordinate is written only when a human deliberately drops a
    pin. A DEFAULT or an UPDATE in this file would be a coordinate nobody
    chose, on 389 rows, with a provenance that would have to be invented."""
    body = MIGRATION.read_text(encoding="utf-8")
    # Comments carry the reversal DDL and the retention sweep, both of which
    # legitimately contain UPDATE and DELETE. Strip them before looking.
    live = "\n".join(l for l in body.splitlines()
                     if not l.lstrip().startswith("--"))
    for forbidden in ("INSERT INTO", "UPDATE ", "DELETE FROM", "DEFAULT "):
        assert forbidden not in live.upper(), (
            f"237 contains {forbidden.strip()} outside a comment")
    assert "NUMERIC(10,7)" in live, (
        "the type stopped matching pahchan_punches.lat")


# ══════════════════════════════════════════════════════════════════════════════
#  6 · LIVE SCHEMA — Parse and Describe, nothing written
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

DB_SKIP = (
    "no live database. This half PREPAREs all four of the route's statements "
    "against the real catalogue and reads the columns back. NO ROW IS "
    "WRITTEN. Run it with:\n"
    "    cd backend && railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_client_coordinates.py -q"
)

NOT_APPLIED = (
    "migration 237 has not been applied — see "
    "test_migration_237_has_been_applied, which fails rather than skips"
)

#: The catalogue query, run against BOTH product schemas. A column absent from
#: `staging` is a fact about `staging` only; CLAUDE.md records a day lost to
#: exactly that inference, and `public.report_schedules` was declared missing
#: while it had a CRUD and an armed hourly cron.
_COLUMNS_SQL = """
SELECT table_schema, table_name, column_name, data_type,
       numeric_precision, numeric_scale, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema IN ('staging','public')
   AND table_name IN ('graha_clients','graha_contacts')
   AND column_name IN ('lat','lng','geo_source','geo_fetched_at')
 ORDER BY table_schema, table_name, column_name
"""

_CONSTRAINTS_SQL = """
SELECT n.nspname AS schema, t.relname AS table, c.conname AS name,
       c.convalidated, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname IN ('staging','public')
   AND t.relname IN ('graha_clients','graha_contacts')
   AND c.conname LIKE '%geo%'
 ORDER BY 1, 2, 3
"""


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


@pytest.fixture(scope="module")
def live():
    if live_dsn() is None:
        pytest.skip(DB_SKIP)
    import asyncio
    import asyncpg
    from routers import graha

    async def run():
        # statement_cache_size=0: PgBouncer in transaction mode, where a cached
        # server-side statement belongs to a session that will not be there
        # next time. This is the trap that turns into an instant 500.
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            cols = [dict(r) for r in await conn.fetch(_COLUMNS_SQL)]
            cons = [dict(r) for r in await conn.fetch(_CONSTRAINTS_SQL)]
            out = {"columns": cols, "constraints": cons, "prepared": {},
                   "prepare_error": None, "coordinates_written": None}
            if len(cols) < 8:
                # 237 is not applied. PREPARE would raise 42703 and take the
                # whole module down with an error that names a column rather
                # than the migration.
                return out
            for table, stmts in graha.COORDINATE_SQL.items():
                for verb, sql in stmts.items():
                    # Parse + Describe. The catalogue resolves every column and
                    # every cast. NOTHING EXECUTES: no UPDATE runs, no row is
                    # touched, and this is the only way this suite is ever
                    # allowed near a write statement on a shared production
                    # database.
                    stmt = await conn.prepare(sql)
                    out["prepared"][f"{table}.{verb}"] = {
                        "binds": [t.name for t in stmt.get_parameters()],
                        "columns": [a.name for a in stmt.get_attributes()],
                    }
            out["coordinates_written"] = [
                dict(r) for r in await conn.fetch(
                    "SELECT 'clients' AS t, count(*) AS n "
                    "FROM staging.graha_clients WHERE lat IS NOT NULL "
                    "UNION ALL SELECT 'contacts', count(*) "
                    "FROM staging.graha_contacts WHERE lat IS NOT NULL")]
            return out
        finally:
            await conn.close()

    return asyncio.new_event_loop().run_until_complete(run())


def test_migration_237_has_been_applied(live):
    """FAILS, rather than skips, until the owner applies 237.

    A skip here would let the whole live half report green against a schema
    that cannot serve the route — which is the exact shape of the two blockers
    `docs/plans/PHASE-6` records. Both product schemas are read, so "the
    columns are absent" is a measurement and not an inference from one 42703.
    """
    found = {(c["table_schema"], c["table_name"], c["column_name"])
             for c in live["columns"]}
    missing = sorted(
        f"staging.{t}.{c}"
        for t in ("graha_clients", "graha_contacts")
        for c in ("lat", "lng", "geo_source", "geo_fetched_at")
        if ("staging", t, c) not in found)
    assert not missing, (
        "migration 237 is not applied. Measured live in BOTH product schemas, "
        f"absent: {missing}. Apply "
        "backend/migrations/237_client_contact_coordinates.sql.")


def test_the_columns_are_nullable_with_no_default(live):
    """A DEFAULT here would be a coordinate nobody chose, on every row."""
    if len(live["columns"]) < 8:
        pytest.skip(NOT_APPLIED)
    for c in live["columns"]:
        assert c["is_nullable"] == "YES", c
        assert c["column_default"] is None, c


def test_lat_and_lng_are_numeric_10_7_like_a_punch(live):
    """`double precision` is a legal type that raises nothing and silently
    stops a stored coordinate round-tripping exactly — and makes every future
    join to `pahchan_punches` need a cast somebody will pick a direction for at
    random. Read out of the COLUMN, which is the only place it can be proved.
    """
    if len(live["columns"]) < 8:
        pytest.skip(NOT_APPLIED)
    pairs = [c for c in live["columns"] if c["column_name"] in ("lat", "lng")]
    assert len(pairs) == 4
    for c in pairs:
        assert c["data_type"] == "numeric", f"{c['table_name']}.{c['column_name']} is {c['data_type']}"
        assert (c["numeric_precision"], c["numeric_scale"]) == (10, 7), c


def test_all_six_constraints_are_present_and_validated(live):
    """From `pg_constraint`, never from the migration file.

    `ADD COLUMN IF NOT EXISTS` SKIPS AN INLINE CHECK WHOLE when the column
    already exists, so a green migration run is not evidence a constraint
    landed — migration 233 records the same trap. 237 adds them as separate
    guarded `ADD CONSTRAINT` statements for exactly this reason, and this is
    the test that proves it worked.
    """
    if len(live["columns"]) < 8:
        pytest.skip(NOT_APPLIED)
    names = {c["name"] for c in live["constraints"]}
    expected = {f"{t}_geo_{k}_ck"
                for t in ("graha_clients", "graha_contacts")
                for k in ("range", "complete", "source")}
    assert expected <= names, f"missing: {sorted(expected - names)}"
    for c in live["constraints"]:
        assert c["convalidated"], f"{c['name']} is NOT VALID — it is not enforced"
    # The licence control, read out of the catalogue and not out of the file.
    for c in live["constraints"]:
        if c["name"].endswith("_geo_source_ck"):
            assert "mappls" not in c["def"].lower(), c["def"]
            for v in ("user_pin", "device_gps", "manual_entry",
                      "google_places", "import"):
                assert v in c["def"], f"{v} missing from {c['name']}"


def test_all_four_statements_parse_against_the_real_catalogue(live):
    """A statement is not trusted until the server has planned it.

    `prepare` is Parse + Describe: every column, every cast and every bind type
    is resolved by the catalogue, and nothing executes. This is the check whose
    absence has shipped a live blocker in this repo twice.
    """
    if not live["prepared"]:
        pytest.skip(NOT_APPLIED)
    assert set(live["prepared"]) == {
        "staging.graha_clients.set", "staging.graha_clients.clear",
        "staging.graha_contacts.set", "staging.graha_contacts.clear"}
    for key, got in live["prepared"].items():
        if key.endswith(".set"):
            assert got["binds"] == ["uuid", "uuid", "numeric", "numeric",
                                    "text", "text"], (key, got["binds"])
            assert got["columns"] == ["lat", "lng", "geo_source",
                                      "geo_fetched_at"], key
        else:
            assert got["binds"] == ["uuid", "uuid", "text"], (key, got["binds"])
            assert got["columns"] == ["id"], key


def test_no_coordinate_exists_yet_and_that_is_the_expected_state(live):
    """§8.4 ships an empty column and fills it one deliberate pin at a time.

    This is not an assertion that the count must stay 0 for ever — it is the
    reading, printed, so that "the migration backfilled nothing" is a
    measurement immediately after it runs rather than a claim in a header.
    """
    if live["coordinates_written"] is None:
        pytest.skip(NOT_APPLIED)
    counts = {r["t"]: r["n"] for r in live["coordinates_written"]}
    assert set(counts) == {"clients", "contacts"}
    for t, n in counts.items():
        assert n >= 0
    print(f"\ncoordinates written: {counts}")
