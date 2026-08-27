"""GET /api/v1/pincodes/{pin} — the route 8.2 was owed. Phase 8.2.

── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────

Two agents building 8.2 and 8.3 independently hit the same wall: the only
boundary route is per-territory, and the two live orgs are arranged so that
walking territories finds nothing.

    E2E Test & Associates    17 territories    0 client pincodes
    Unicode Group             0 territories   21 client pincodes

Every client pincode belongs to the org with no territory. Without this route
the PIN popover draws an empty panel for the only organisation that has
addresses in it.

── WHAT THESE TESTS ARE FOR ─────────────────────────────────────────────────

Three things, and the third is the one the repo has been bitten by:

  1. the two government datasets DISAGREE in both directions and the response
     must never derive one from the other;
  2. a PIN is not unique — `directory` is a list and a `LIMIT 1` must fail;
  3. THE SQL IS PREPAREd AGAINST THE REAL SCHEMA. CLAUDE.md: never ship a
     router without one test that executes its SQL against the real schema.
     That rule exists because a green suite has hidden a live 500 here before.
     Skipped with instructions when there is no database, which is CI today.
"""
import os

import pytest

from services import pin_directory as pdir


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The shape, with both datasets stubbed
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def route():
    from routers import pincodes
    return pincodes


class _Cover:
    """`pin_boundaries.Coverage` in the shape the route reads."""
    def __init__(self, features=(), unmatched=(), unavailable=(), invalid=()):
        self.features = list(features)
        self.unmatched = list(unmatched)
        self.unavailable = list(unavailable)
        self.invalid = list(invalid)


FEATURE = {
    "type": "Feature",
    "properties": {"pincode": "395002"},
    "geometry": {"type": "Polygon", "coordinates": [[[72.8, 21.1], [72.9, 21.2]]]},
}


def _row(state, district, blocks=None):
    return {
        "pincode": "395002", "state": state, "district": district,
        "blocks": blocks if blocks is not None else ["SURAT CITY"],
        "state_lgd": "24", "district_lgd": "492",
        "source_vintage": "datagov-2025-05",
    }


async def _call(route, monkeypatch, pin, *, rows=(), cover=None):
    monkeypatch.setattr(route, "get_pool", _noop_pool)
    monkeypatch.setattr(route.pin_directory, "lookup", _returning(list(rows)))
    monkeypatch.setattr(route.pin_boundaries, "geometry_for_pins",
                        _returning(cover if cover is not None else _Cover()))
    return await route.pincode_detail.__wrapped__(None, pin, user={"id": "u"})


def _returning(value):
    async def _f(*a, **k):
        return value
    return _f


async def _noop_pool(*a, **k):
    return object()


@pytest.mark.asyncio
async def test_a_pin_in_both_datasets_is_named_and_drawn(route, monkeypatch):
    out = await _call(route, monkeypatch, "395002",
                      rows=[_row("GUJARAT", "SURAT")],
                      cover=_Cover(features=[FEATURE]))
    assert out["valid"] is True
    assert out["pincode"] == "395002"
    assert out["boundary_status"] == "drawn"
    assert out["boundary"]["properties"]["pincode"] == "395002"
    assert [d["district"] for d in out["directory"]] == ["SURAT"]
    assert out["directory"][0]["state"] == "GUJARAT"


@pytest.mark.asyncio
async def test_the_district_list_keeps_EVERY_row(route, monkeypatch):
    """1,229 PINs span two or more districts; 51 span two or more states.

    `110020` is genuinely both SOUTH DELHI and SOUTH EAST DELHI. An endpoint
    that answered one of them would be right, for ever, about a question that
    has two answers — and no reader could tell the other existed.
    """
    out = await _call(route, monkeypatch, "395002", rows=[
        _row("DELHI", "SOUTH DELHI"), _row("DELHI", "SOUTH EAST DELHI"),
    ], cover=_Cover(features=[FEATURE]))
    assert len(out["directory"]) == 2, (
        "the endpoint kept one district for a PIN that spans two — a LIMIT 1 "
        "has appeared in LOOKUP_SQL or in the route")
    assert {d["district"] for d in out["directory"]} == {
        "SOUTH DELHI", "SOUTH EAST DELHI"}


@pytest.mark.asyncio
async def test_a_boundary_with_no_directory_row_still_draws(route, monkeypatch):
    """531 PINs WITH a boundary are absent from the directory.

    The datasets disagree in this direction too. An empty `directory` must not
    suppress the shape, and it must not read as "no such pincode".
    """
    out = await _call(route, monkeypatch, "395002",
                      rows=[], cover=_Cover(features=[FEATURE]))
    assert out["directory"] == []
    assert out["boundary_status"] == "drawn"
    assert out["boundary"] is not None


@pytest.mark.asyncio
async def test_a_directory_row_with_no_boundary_is_unmatched_not_an_error(
        route, monkeypatch):
    """58 PINs in the directory have no published shape. Ordinary."""
    out = await _call(route, monkeypatch, "395002",
                      rows=[_row("GUJARAT", "SURAT")],
                      cover=_Cover(unmatched=["395002"]))
    assert out["boundary_status"] == "unmatched"
    assert out["boundary"] is None
    assert out["directory"][0]["district"] == "SURAT"


@pytest.mark.asyncio
async def test_unavailable_never_becomes_unmatched(route, monkeypatch):
    """THE BUCKET THAT MUST NOT MERGE.

    R2 not answering means we DO NOT KNOW whether a shape exists. Reporting
    `unmatched` there is this product telling a customer their pincode has no
    postal area, during an outage of ours, in a sentence that sounds certain.
    """
    out = await _call(route, monkeypatch, "395002",
                      rows=[_row("GUJARAT", "SURAT")],
                      cover=_Cover(unavailable=["395002"]))
    assert out["boundary_status"] == "unavailable", (
        "an R2 outage was reported as 'this pincode has no boundary'")


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["NW1 245", "095002", "39500", "3950021",
                                 "395 002", "", "   ", "abcdef"])
async def test_a_value_that_is_not_a_pin_is_refused_and_not_corrected(
        route, monkeypatch, bad):
    """`INC UK` really holds `pincode = 'NW1 245'`.

    Refused, echoed back exactly as given, and NOT tidied into something that
    would validate. §8.0's rule in the other direction.
    """
    out = await _call(route, monkeypatch, bad)
    assert out["valid"] is False
    assert out["boundary_status"] == "invalid"
    assert out["directory"] == []
    assert out["boundary"] is None
    assert out["pincode"] == bad.strip()[:32]


@pytest.mark.asyncio
async def test_the_definition_of_a_pin_is_routings_and_not_a_second_copy(route):
    """One definition, imported. A route laxer than routing would offer a
    lookup the rest of the product refuses; a stricter one would leave a
    routed contact unable to see its own area."""
    import inspect
    from services import territory_routing
    src = inspect.getsource(route)
    assert "normalise_pin" in src
    assert route.normalise_pin is territory_routing.normalise_pin
    # And no second regex smuggled in beside it.
    assert "[1-9]" not in src, (
        "a PIN regex was re-implemented in the router; import normalise_pin")


@pytest.mark.asyncio
async def test_both_credits_ride_on_every_answer(route, monkeypatch):
    """Including the refusals, so a panel still holding the previous PIN's
    shape can never be in a state where it shows it uncredited."""
    for kw in ({"rows": [_row("GUJARAT", "SURAT")],
                "cover": _Cover(features=[FEATURE])},
               {"cover": _Cover(unavailable=["395002"])},
               {}):
        out = await _call(route, monkeypatch, "395002", **kw)
        assert "Government of India" in out["attribution"]
        assert out["vintage"] == "datagov-2025-05"
    bad = await _call(route, monkeypatch, "NW1 245")
    assert "Government of India" in bad["attribution"]


def test_the_route_is_registered(route):
    """Written and NOT registered is exactly how `/api/v1/support-sessions`
    404'd while its page, its router and its tests all existed.

    Read off the OPENAPI SCHEMA and not `app.routes`. This FastAPI keeps an
    included router as a wrapper with no `.path`, so a membership test against
    `app.routes` is vacuously false for every router in the product — it would
    pass the moment the assertion was inverted and never fail otherwise.
    `tests/test_billing_lines_wiring.py` documents the same trap.
    """
    import server
    paths = set(server.app.openapi()["paths"])
    assert "/api/v1/pincodes/{pincode}" in paths, (
        "routers/pincodes.py is not included in server.py — the route 404s")


def test_it_is_behind_require_user(route):
    import inspect
    src = inspect.getsource(route.pincode_detail)
    assert "require_user" in inspect.getsource(route)
    assert "limiter.limit" in inspect.getsource(route)
    assert "org_id" not in src, (
        "this route reads two government datasets and no tenant data; an "
        "org_id parameter would imply a scoping it does not perform")


# ══════════════════════════════════════════════════════════════════════════════
#  2 · LIVE SCHEMA — Parse and Describe, nothing written
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

DB_SKIP = (
    "no live database. This half PREPAREs the route's statement against the "
    "real catalogue and reads one PIN back. No row is written. Run it with:\n"
    "    cd backend && railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_pincode_lookup.py -q"
)


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


@pytest.fixture(scope="module")
def live():
    if live_dsn() is None:
        pytest.skip(DB_SKIP)
    import asyncio
    import asyncpg

    async def run():
        # statement_cache_size=0: PgBouncer in transaction mode, where a cached
        # server-side statement belongs to a session that will not be there
        # next time. This is the trap that turns into an instant 500.
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            stmt = await conn.prepare(pdir.LOOKUP_SQL)
            # 110020 is the documented two-district PIN. Read, never written.
            multi = await conn.fetch(pdir.LOOKUP_SQL, "110020")
            surat = await conn.fetch(pdir.LOOKUP_SQL, "395002")
            absent = await conn.fetch(pdir.LOOKUP_SQL, "999999")
            return {
                "binds": len(stmt.get_parameters()),
                "columns": [a.name for a in stmt.get_attributes()],
                "multi": [dict(r) for r in multi],
                "surat": [dict(r) for r in surat],
                "absent": [dict(r) for r in absent],
            }
        finally:
            await conn.close()

    return asyncio.new_event_loop().run_until_complete(run())


def test_the_statement_parses_against_the_real_catalogue(live):
    """A statement is not trusted until the server has planned it.

    `prepare` is Parse + Describe: the catalogue resolves every column and
    every cast, and nothing executes. This is the check whose absence has
    shipped a live blocker in this repo twice.
    """
    assert live["binds"] == 1
    assert live["columns"] == [
        "pincode", "state", "district", "blocks", "state_lgd",
        "district_lgd", "source_vintage"]


def test_a_pin_really_does_return_more_than_one_row(live):
    """Not a claim from a docstring — the rows, out of the live table.

    If this ever returns one row the endpoint is still correct; the test is
    what tells us the two-district case stopped being real, rather than us
    finding out from a customer whose district silently changed.
    """
    assert len(live["multi"]) >= 2, (
        f"110020 returned {len(live['multi'])} row(s) — it is documented as "
        "spanning SOUTH DELHI and SOUTH EAST DELHI")
    assert len({r["district"] for r in live["multi"]}) >= 2


def test_the_padding_survived_the_round_trip(live):
    """`state_lgd` is ZERO-PADDED TEXT. `'07'`, never 7.

    An `integer` anywhere on this path is a legal cast that raises nothing and
    silently stops the value matching every other government dataset keyed on
    LGD. Read out of the COLUMN, which is the only place it can be proved.
    """
    rows = live["multi"] + live["surat"]
    assert rows, "no rows at all — has the 7.2 load been run?"
    for r in rows:
        assert isinstance(r["state_lgd"], str)
        assert len(r["state_lgd"]) == 2, f"lost its padding: {r['state_lgd']!r}"
        assert len(r["district_lgd"]) == 3


def test_an_unknown_pin_returns_no_rows_rather_than_raising(live):
    """`999999` is a valid PIN by the regex and is in no release we hold.

    Empty is the answer, and the endpoint reports it as "this release does not
    list it" — never as "no such place".
    """
    assert live["absent"] == []
