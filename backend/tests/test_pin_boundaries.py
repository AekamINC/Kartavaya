"""Phase 7.3 — the PIN boundary reader, and the three buckets that must not merge.

`unmatched`, `unavailable` and `invalid` are the acceptance. They answer three
different questions and a customer acts differently on each:

    unmatched    the government published no boundary for that PIN. 58 PINs in
                 its own directory are in this state. Ordinary. Do nothing.
    unavailable  OUR object store did not answer. Nothing is wrong with the
                 territory. Try again.
    invalid      the value is not a PIN. Go and fix the territory.

Merge the first two and the map tells a customer "there is no shape for 110001"
during an outage of ours, and they edit a territory that was never wrong.
`storage.download_file` is that bug already built — it returns `None` for a
missing key and for a dead bucket alike — which is why the reader talks to the
client itself, and why every failure test below asserts on the bucket a PIN
landed in and on the two it did NOT.

── FOUR KINDS OF TEST, AND WHY THERE ARE FOUR ───────────────────────────────

  1. THE BUCKETS, against a scripted fake client. Not a MagicMock: a MagicMock
     answers happily to a key that does not exist, which is precisely how a
     wrong R2 key survives to production (`memory/mock_pool_hides_bad_sql`).
     `_FakeR2` holds a fixed key space, raises the way botocore raises, and
     counts its calls so a test can prove a round trip did NOT happen.

  2. THE AGREEMENT WITH ROUTING. The map must claim exactly the PINs routing
     matches. Two definitions of "is this a PIN" is how a contact routes into
     Surat while the map draws nothing there. Asserted against
     `territory_routing._pincodes_of` over the shapes the product can store.

  3. LIVE R2. A mocked object store hides a wrong key exactly the way a mock
     pool hides bad SQL, so the real bucket is read: the index, a real
     boundary, and — read-only, breaking nothing — two ways of making the read
     fail on purpose. Skipped when R2 is not configured.

  4. LIVE SCHEMA. `CLAIMED_PINS_SQL` is PREPAREd — Parse and Describe, no
     execution, no row read and none written.

── WHY THIS FILE NAMES NO ROUTER ────────────────────────────────────────────

`tests/test_every_writer_has_a_live_sql_test.py` marks a router "covered" when
any test file both PREPAREs a statement and mentions that router's import path.
This file prepares one. The CRM router is baselined there with thirty-odd write
paths nothing here proves anything about, so mentioning it would delete it from
the baseline on a technicality and retire a guarantee. That is why
`CLAIMED_PINS_SQL` is defined in the SERVICE and prepared from here, and why the
endpoint's own assertions live in `tests/test_territories.py`, which mentions
the router and prepares nothing. `tests/test_territory_routing.py` carries the
same note for the same reason.
"""
import asyncio
import io
import json
import os

import pytest

from services import pin_boundaries as pb
from services import territory_routing as tr


#: A valid, tiny GeoJSON ring: 4 positions, first == last.
RING = [[77.18, 28.62], [77.19, 28.62], [77.19, 28.63], [77.18, 28.62]]
POLYGON = {"t": "P", "c": [RING]}
MULTIPOLYGON = {"t": "M", "c": [[RING]]}

#: Live, verified 2026-08-27: `110001` has a boundary, `110009` does not, and
#: they share a shard. That pair IS PHASE-7 §7.3's acceptance case.
DELHI_WITH_A_SHAPE = "110001"
DELHI_WITHOUT_ONE = "110009"

#: The only PIN any live territory claims — E2E Test & Associates' "Gujarat".
SURAT = "395002"


class _NoSuchKey(Exception):
    """What botocore raises for a missing object.

    Verified live rather than assumed: a GET of an absent key under the real
    prefix raises `botocore.errorfactory.NoSuchKey`, `Error.Code` `NoSuchKey`,
    HTTP 404. The reader catches `Exception`, so the class matters less than
    the fact that a missing object RAISES rather than returning empty bytes.
    """


class _FakeR2:
    """A scripted stand-in for the boto3 client. Holds a key space, counts calls."""

    def __init__(self, objects, *, list_error=None, get_error=None):
        self.objects = objects
        self.list_error = list_error
        self.get_error = get_error
        self.lists = 0
        self.gets = []

    def list_objects_v2(self, **kwargs):
        self.lists += 1
        if self.list_error is not None:
            raise self.list_error
        prefix = kwargs["Prefix"]
        return {
            "Contents": [{"Key": k, "Size": 1}
                         for k in sorted(self.objects) if k.startswith(prefix)],
            "IsTruncated": False,
        }

    def get_object(self, Bucket, Key):          # noqa: N803 — boto3's own names
        self.gets.append(Key)
        if self.get_error is not None:
            raise self.get_error
        if Key not in self.objects:
            raise _NoSuchKey(Key)
        return {"Body": io.BytesIO(json.dumps(self.objects[Key]).encode())}


def _keyspace(shards: dict) -> dict:
    """`{'11': {'110001': POLYGON}}` -> the R2 keys those shards occupy."""
    base = f"shared/{pb._VINTAGE_PREFIX}"
    return {f"{base}{name}.json": payload for name, payload in shards.items()}


@pytest.fixture
def r2(monkeypatch):
    """Installs a fake client and hands the test back the object it can inspect.

    Caches are cleared on both sides of every test: they are module-level, and a
    shard left over from another test would answer a question this one never
    asked.
    """
    pb.reset_caches()

    def install(client, *, bucket="aekaminc", key_prefix="shared/"):
        async def _resolve(org_id):
            # org_id=None is not decoration. It is what makes `_resolve_r2`
            # answer with the PLATFORM bucket under `shared/`, where one public
            # government dataset belongs, rather than an org's own bucket.
            assert org_id is None, "the boundaries are never read per-org"
            return client, bucket, key_prefix
        monkeypatch.setattr(pb.storage, "_resolve_r2", _resolve)
        return client

    yield install
    pb.reset_caches()


# ══════════════════════════════════════════════════════════════════════════════
#  1 · A boundary that is there
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_found_pin_becomes_one_feature_that_names_itself(r2):
    """The PIN travels in `properties.pincode`, so a matched PIN is already
    named and the endpoint can report `matched` as a count without losing it."""
    r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])

    assert len(cover.features) == 1
    feature = cover.features[0]
    assert feature["type"] == "Feature"
    assert feature["properties"]["pincode"] == DELHI_WITH_A_SHAPE
    assert feature["geometry"] == {"type": "Polygon", "coordinates": [RING]}
    assert (cover.unmatched, cover.unavailable, cover.invalid) == ([], [], [])


async def test_the_compact_shape_expands_to_both_geojson_types(r2):
    """`t` is one letter in the file because 19,312 copies of the word
    "MultiPolygon" is 230 KB of nothing. It must still leave here as GeoJSON a
    map library will accept."""
    r2(_FakeR2(_keyspace({"11": {"110001": POLYGON, "110002": MULTIPOLYGON}})))
    cover = await pb.geometry_for_pins(["110001", "110002"])
    assert [f["geometry"]["type"] for f in cover.features] == [
        "Polygon", "MultiPolygon"]


async def test_the_plans_acceptance_case(r2):
    """PHASE-7 §7.3, word for word: a territory carrying 110001 and 110009 gives
    one Feature, `matched: 1`, `unmatched: ["110009"]`.

    A REAL PIN NAMED, not silently dropped. Both PINs live in the same shard, so
    this also proves the miss is decided per-PIN inside a shard that loaded
    perfectly well — not by the shard being absent.
    """
    r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE, DELHI_WITHOUT_ONE])

    assert len(cover.features) == 1
    assert cover.features[0]["properties"]["pincode"] == DELHI_WITH_A_SHAPE
    assert cover.unmatched == [DELHI_WITHOUT_ONE]
    assert cover.unavailable == []
    assert cover.invalid == []


# ══════════════════════════════════════════════════════════════════════════════
#  2 · unmatched — the dataset has no such boundary
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_shard_the_dataset_never_published_is_unmatched_with_no_get(r2):
    """Six prefixes — 29, 35, 54, 55, 65, 66 — have no shard at all, measured
    live against the 69 that do.

    The index is what makes this decidable. Without it the only way to find out
    is a GET that 404s, and a 404 is ALSO what an object that went away looks
    like. So the absence is answered from the listing and no GET is issued —
    asserted here, because "we did not ask" is the difference between the two
    buckets.
    """
    client = r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    cover = await pb.geometry_for_pins(["290001"])

    assert cover.unmatched == ["290001"]
    assert cover.unavailable == []
    assert client.gets == [], "a GET was issued for a shard the index denied"


async def test_a_pin_missing_from_a_shard_that_loaded_is_unmatched(r2):
    r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    cover = await pb.geometry_for_pins([DELHI_WITHOUT_ONE])
    assert cover.unmatched == [DELHI_WITHOUT_ONE]
    assert cover.unavailable == [] and cover.features == []


# ══════════════════════════════════════════════════════════════════════════════
#  3 · unavailable — WE do not know, and must not pretend otherwise
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_listing_failure_is_unavailable_and_never_unmatched(r2):
    """R2 refused the listing. Nothing is known about any PIN, so nothing may be
    reported as absent."""
    r2(_FakeR2({}, list_error=OSError("connection reset")))
    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE, SURAT])

    assert cover.unavailable == sorted([DELHI_WITH_A_SHAPE, SURAT])
    assert cover.unmatched == [], (
        "an outage was reported as 'this territory has no shapes' — the exact "
        "sentence PHASE-7 §7.3 forbids")
    assert cover.features == []


async def test_an_object_that_vanished_after_the_listing_is_unavailable(r2):
    """The index said the shard was there and the GET 404'd anyway.

    That is not an absent boundary — it is an object that went away between two
    calls, or credentials that can list and not read. Either way we do not know
    what the shard held, so its PINs cannot be called unmatched.
    """
    client = r2(_FakeR2(_keyspace({"11": {}})))
    client.get_error = _NoSuchKey("shared/.../11.json")

    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert cover.unavailable == [DELHI_WITH_A_SHAPE]
    assert cover.unmatched == []


async def test_r2_not_configured_is_unavailable_not_unmatched(r2, monkeypatch):
    """A machine with no R2 credentials knows nothing about any boundary.

    There is deliberately no local-disk fallback: `backend/data/pincode_
    boundaries/` exists only on the machine that ran the prepare script, and
    reading it would make the endpoint behave one way there and another in
    production — invisible in exactly the case this module exists to report.
    """
    async def _unconfigured(org_id):
        return None, None, ""
    monkeypatch.setattr(pb.storage, "_resolve_r2", _unconfigured)

    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert cover.unavailable == [DELHI_WITH_A_SHAPE]
    assert cover.unmatched == []


async def test_an_org_prefix_is_refused_rather_than_read(r2):
    """`_resolve_r2(None)` must answer `shared/`. If it ever answers an org
    prefix, this would be reading one tenant's namespace for a dataset that
    belongs to none of them — so it refuses, and refusing is `unavailable`.

    The upload script carries the mirror image of this check.
    """
    client = _FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}}))
    r2(client, key_prefix="org/64e7bea6/")

    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert cover.unavailable == [DELHI_WITH_A_SHAPE]
    assert client.lists == 0, "it listed an org prefix before refusing"


async def test_an_empty_index_is_an_outage_not_an_empty_dataset(r2):
    """A listing that matches nothing means the vintage constant is wrong or
    the upload never ran. Both are ours, not the customer's — and the live
    count is 69, so zero is never a legitimate answer."""
    r2(_FakeR2({}))
    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert cover.unavailable == [DELHI_WITH_A_SHAPE]
    assert cover.unmatched == []


async def test_a_boundary_we_hold_but_cannot_render_is_unavailable(r2):
    """A shard entry with an unknown `t`, or no coordinates, is a defect in our
    pipeline. We HAVE something for that PIN — so the one thing that must not
    be said is that no boundary exists."""
    r2(_FakeR2(_keyspace({"11": {
        "110001": {"t": "Z", "c": [RING]},          # not a type we write
        "110002": {"t": "P", "c": []},              # no rings
        "110003": "not even an object",
    }})))
    cover = await pb.geometry_for_pins(["110001", "110002", "110003"])
    assert cover.unavailable == ["110001", "110002", "110003"]
    assert cover.unmatched == [] and cover.features == []


# ══════════════════════════════════════════════════════════════════════════════
#  4 · invalid — not a PIN at all, and NAMED
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_value_that_is_not_a_pin_is_named_not_dropped(r2):
    """Unicode's client `INC UK` really does carry `pincode = 'NW1 245'`.

    A territory that claims five things and routes on four has to be able to
    say which one it lost — otherwise the customer sees a map with four shapes
    and no way to find out why.
    """
    r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    cover = await pb.geometry_for_pins(
        [DELHI_WITH_A_SHAPE, "NW1 245", "ahmedabad", "012345", ""])

    assert [f["properties"]["pincode"] for f in cover.features] == [
        DELHI_WITH_A_SHAPE]
    assert cover.invalid == ["NW1 245", "ahmedabad", "012345", "(blank)"], (
        "the entries must come back in the order they were typed, and a blank "
        "must read as something")
    assert cover.unmatched == [] and cover.unavailable == []


async def test_a_leading_zero_is_invalid_because_no_pin_has_one(r2):
    """The first digit is the postal region, 1-8. `012345` is a truncated
    something else, and accepting it would draw a shape for a typo."""
    r2(_FakeR2(_keyspace({"01": {"012345": POLYGON}})))
    cover = await pb.geometry_for_pins(["012345"])
    assert cover.invalid == ["012345"]
    assert cover.features == []


async def test_a_pincodes_value_that_is_not_a_list_is_named_rather_than_lost(r2):
    """`{"pincodes": "400001"}` is what somebody types when a territory has one
    PIN, and the product stores it — `TerritoryCreate.rules` is an untyped
    `dict`, so any JSON goes in. Verified against the live database: the column
    holds it happily.

    Routing ignores it, so the territory claims nothing. Without this the
    endpoint would answer "claims nothing, nothing invalid" and the customer's
    own text would have disappeared between the two — the same silent drop the
    `unmatched` bucket exists to prevent, one level up.
    """
    r2(_FakeR2({}))
    assert (await pb.geometry_for_pins("400001")).invalid == ["400001"]
    assert (await pb.geometry_for_pins({"a": 1})).invalid == ["{'a': 1}"]
    # ...and the two ways of saying "nothing is claimed" stay silent.
    assert (await pb.geometry_for_pins(None)).invalid == []
    assert (await pb.geometry_for_pins("null")).invalid == []
    assert (await pb.geometry_for_pins([])).invalid == []


async def test_a_very_long_entry_is_truncated_rather_than_echoed_whole(r2):
    """`rules` is a free JSON blob somebody can hand-edit. A 4 KB "PIN" must
    not become a 4 KB response field."""
    r2(_FakeR2({}))
    cover = await pb.geometry_for_pins(["x" * 900])
    assert len(cover.invalid[0]) == pb._LABEL_MAX


# ══════════════════════════════════════════════════════════════════════════════
#  5 · The four together — the property that matters
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_four_buckets_are_disjoint_and_complete(r2):
    """One call producing all four at once, because the risk is not that a
    single bucket is wrong — it is that two of them get merged."""
    client = r2(_FakeR2(_keyspace({
        "11": {DELHI_WITH_A_SHAPE: POLYGON},        # matched + unmatched
        "39": {},                                   # readable, empty
    })))
    original_get = client.get_object

    def get(Bucket, Key):                            # noqa: N803
        if Key.endswith("39.json"):
            raise OSError("read timeout")            # -> unavailable
        return original_get(Bucket=Bucket, Key=Key)
    client.get_object = get

    cover = await pb.geometry_for_pins(
        [DELHI_WITH_A_SHAPE, DELHI_WITHOUT_ONE, SURAT, "290001", "NW1 245"])

    matched = {f["properties"]["pincode"] for f in cover.features}
    assert matched == {DELHI_WITH_A_SHAPE}
    assert cover.unmatched == sorted([DELHI_WITHOUT_ONE, "290001"])
    assert cover.unavailable == [SURAT]
    assert cover.invalid == ["NW1 245"]

    buckets = [matched, set(cover.unmatched), set(cover.unavailable)]
    for i, left in enumerate(buckets):
        for right in buckets[i + 1:]:
            assert not (left & right), "a PIN landed in two buckets"
    assert len(matched) + len(cover.unmatched) + len(cover.unavailable) == 4


async def test_a_repeated_pin_claims_one_shape(r2):
    r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE] * 3)
    assert len(cover.features) == 1


async def test_a_repeated_bad_entry_is_named_once(r2):
    r2(_FakeR2({}))
    cover = await pb.geometry_for_pins(["NW1 245", "NW1 245"])
    assert cover.invalid == ["NW1 245"]


async def test_many_pins_in_one_shard_cost_one_read(r2):
    """A Gujarat territory can claim hundreds of PINs inside `39`. Reading the
    shard once per PIN would be 288 downloads of the same 700 KB."""
    client = r2(_FakeR2(_keyspace({"11": {f"1100{n:02d}": POLYGON
                                          for n in range(1, 40)}})))
    cover = await pb.geometry_for_pins([f"1100{n:02d}" for n in range(1, 40)])
    assert len(cover.features) == 39
    assert len(client.gets) == 1


async def test_a_territory_claiming_nothing_answers_empty_without_touching_r2(r2):
    client = r2(_FakeR2({}))
    cover = await pb.geometry_for_pins([])
    assert cover == pb.Coverage([], [], [], [])
    assert client.lists == 0 and client.gets == []


# ══════════════════════════════════════════════════════════════════════════════
#  6 · The map claims exactly what routing claims
# ══════════════════════════════════════════════════════════════════════════════

#: Every shape the product can actually store under `rules.pincodes`, including
#: the three that were verified against the live database on 2026-08-27.
RULE_SHAPES = [
    {"pincodes": ["395002"]},                     # the live Gujarat territory
    {"pincodes": []},                             # three live territories
    {},                                           # fifteen live territories
    {"pincodes": "400001"},                       # a bare string: legal, stored
    {"pincodes": [400001]},                       # JSON numbers: legal, stored
    {"pincodes": ["400001", "NW1 245", None, "", "400001", 110001]},
    {"pincodes": None},
    {"pincodes": {"400001": True}},
]


@pytest.mark.parametrize("rules", RULE_SHAPES)
async def test_the_map_looks_up_exactly_the_pins_routing_matches(rules, r2):
    """THE PROPERTY THIS WHOLE FILE EXISTS FOR.

    `territory_routing._pincodes_of` decides which PINs a territory routes.
    This module decides which PINs it draws. If they ever disagree, a contact
    routes into Surat while the map draws nothing there and no support ticket
    is answerable. They share `normalise_pin` — this asserts that sharing it is
    enough, over every shape the column can hold.
    """
    r2(_FakeR2({}))                       # everything -> unavailable, on purpose
    cover = await pb.geometry_for_pins(rules.get("pincodes"))

    drawn = ({f["properties"]["pincode"] for f in cover.features}
             | set(cover.unmatched) | set(cover.unavailable))
    assert drawn == set(tr._pincodes_of(rules)), (
        "the map and the router disagree about which PINs this territory claims")


def test_the_claim_parse_reads_both_connection_kinds():
    """`db.py` registers a jsonb codec, so a POOLED connection decodes
    `rules->'pincodes'` to a list. A bare `asyncpg.connect()` — the live tests,
    and every `railway run` script — has no codec and returns the JSON text.

    The second half of the tuple is the difference between "claimed nothing"
    and "claimed something that is not a list of PINs".
    """
    assert pb._claim(["400001"]) == (["400001"], None)
    assert pb._claim('["400001"]') == (["400001"], None)
    assert pb._claim('"400001"') == ([], "400001")   # a scalar is not a list
    assert pb._claim("not json") == ([], "not json")
    assert pb._claim({"400001": 1}) == ([], {"400001": 1})
    # The two ways of claiming nothing, which are NOT malformed.
    assert pb._claim(None) == ([], None)
    assert pb._claim("null") == ([], None)
    assert pb._claim([]) == ([], None)


def test_text_that_is_not_json_survives_as_itself():
    """So it can still be shown to the person who typed it. Answering `None`
    here would be the reader deciding that unreadable means absent."""
    assert pb._decoded("not json") == "not json"
    assert pb._decoded('"400001"') == "400001"
    assert pb._decoded("null") is None


class _Conn:
    """One `fetchrow`, scripted. Records what it was asked and with what."""

    def __init__(self, row):
        self._row = row
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return self._row


async def test_no_such_territory_is_not_the_same_as_no_pins():
    """THE SENTINEL, AND WHY IT IS NOT `None`.

    `rules -> 'pincodes'` returns NULL for a territory that simply has no
    `pincodes` key — fifteen of the eighteen live ones. If that shared `None`
    with "no such row", every territory that has never been given a PIN would
    answer 404 instead of an empty map.
    """
    gone = _Conn(None)
    assert await pb.claimed_entries(gone, "org", "tid") is pb.NO_SUCH_TERRITORY

    no_key = _Conn({"pincodes": None})
    assert await pb.claimed_entries(no_key, "org", "tid") is None

    listed = _Conn({"pincodes": '["395002"]'})
    assert await pb.claimed_entries(listed, "org", "tid") == ["395002"]


async def test_the_territory_read_binds_the_id_then_the_org():
    """A statement whose placeholders were renumbered by hand is exactly where
    an off-by-one lands, and it would swap an org id for a territory id."""
    conn = _Conn({"pincodes": None})
    await pb.claimed_entries(conn, "the-org", "the-territory")
    sql, args = conn.calls[0]
    assert sql is pb.CLAIMED_PINS_SQL
    assert args == ("the-territory", "the-org")


def test_the_attribution_is_a_licence_condition_and_is_served():
    """GODL-India permits commercial use WITH attribution. Served from the same
    module as the data so a frontend cannot credit a dataset it is not using."""
    assert "data.gov.in" in pb.ATTRIBUTION
    assert "GODL" in pb.ATTRIBUTION
    assert "Government of India" in pb.ATTRIBUTION


def test_the_vintage_matches_the_uploader():
    """The reader and the uploader name the same release. A vintage is never
    rewritten in place, so these two constants are the only thing deciding
    which release is live."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parent.parent / "scripts"
           / "upload_pincode_boundaries.py").read_text(encoding="utf-8")
    assert f'VINTAGE = "{pb.VINTAGE}"' in src
    assert pb._VINTAGE_PREFIX == f"reference/pincode-boundaries/{pb.VINTAGE}/"


# ══════════════════════════════════════════════════════════════════════════════
#  7 · The cache — the index is cached, a failure never is
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_index_is_read_once(r2):
    client = r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert client.lists == 1


async def test_a_failed_index_is_not_cached(r2):
    """A cached failure outlives the outage that caused it, and the next
    request is the one that would have succeeded."""
    client = r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}}),
                        list_error=OSError("connection reset")))
    assert (await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])).unavailable

    client.list_error = None
    cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert len(cover.features) == 1, "the outage was cached"
    assert client.lists == 2


async def test_the_shard_cache_is_bounded(r2):
    """The largest shard is 5.03 MB parsed, measured live. All 69 would be
    ~145 MB per worker against an observed peak of 0.85 GB on a 2 GB ceiling."""
    shards = {f"{10 + n}": {f"{10 + n}0001": POLYGON}
              for n in range(pb._SHARD_CACHE_MAX + 3)}
    r2(_FakeR2(_keyspace(shards)))
    for name in shards:
        await pb.geometry_for_pins([f"{name}0001"])
    assert len(pb._shard_cache) == pb._SHARD_CACHE_MAX


async def test_a_cached_shard_is_not_downloaded_twice(r2):
    client = r2(_FakeR2(_keyspace({"11": {DELHI_WITH_A_SHAPE: POLYGON}})))
    await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
    assert len(client.gets) == 1


# ══════════════════════════════════════════════════════════════════════════════
#  8 · LIVE R2 — a mocked object store hides a wrong key
# ══════════════════════════════════════════════════════════════════════════════

_R2_ENV = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
           "R2_BUCKET_NAME")

R2_SKIP = (
    "no R2 credentials. This half reads the REAL bucket, because a fake client "
    "answers happily to a key that does not exist — the same way a mock pool "
    "answers happily to a column that does not exist. Run it with:\n"
    "    cd backend && railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_pin_boundaries.py -q"
)

live_r2 = pytest.mark.skipif(
    not all(os.getenv(k) for k in _R2_ENV), reason=R2_SKIP)

#: Measured live 2026-08-27, read-only. 69 shards, 19,312 PINs, matching the
#: government's own published feature count.
LIVE_SHARDS = 69


@live_r2
async def test_live_the_index_is_the_sixty_nine_shards_that_were_uploaded():
    pb.reset_caches()
    try:
        index = await pb.shard_index(force=True)
        assert index is not None, "the live index would not list"
        assert len(index) == LIVE_SHARDS
        assert "11" in index and "39" in index
        # The six prefixes with no shard at all. This is what turns a PIN in
        # that range into `unmatched` without a GET.
        assert not ({"29", "35", "54", "55", "65", "66"} & index)
    finally:
        pb.reset_caches()


@live_r2
async def test_live_the_acceptance_case_against_the_real_bucket():
    """PHASE-7 §7.3's acceptance, through the real key path — which is the only
    thing that proves the key is right."""
    pb.reset_caches()
    try:
        cover = await pb.geometry_for_pins(
            [DELHI_WITH_A_SHAPE, DELHI_WITHOUT_ONE, "NW1 245"])
        assert len(cover.features) == 1
        assert cover.features[0]["properties"]["pincode"] == DELHI_WITH_A_SHAPE
        geometry = cover.features[0]["geometry"]
        assert geometry["type"] in ("Polygon", "MultiPolygon")
        # A Polygon's `coordinates[0]` IS the outer ring; a MultiPolygon's
        # `coordinates[0]` is a whole polygon and `[0][0]` is its outer ring.
        outer = (geometry["coordinates"][0] if geometry["type"] == "Polygon"
                 else geometry["coordinates"][0][0])
        assert len(outer) >= 4, (
            "a ring below 4 positions is not valid GeoJSON and draws nothing — "
            "SIMPLIFY_FLOOR in the prepare script exists for exactly this")
        assert outer[0] == outer[-1], "a linear ring must close"
        assert cover.unmatched == [DELHI_WITHOUT_ONE]
        assert cover.unavailable == []
        assert cover.invalid == ["NW1 245"]
    finally:
        pb.reset_caches()


@live_r2
async def test_live_the_one_pin_a_live_territory_claims_has_a_shape():
    """E2E Test & Associates' "Gujarat" carries exactly `["395002"]` and is the
    only territory in the database with a PIN. If this ever fails, the map for
    the only territory that can draw one is blank."""
    pb.reset_caches()
    try:
        cover = await pb.geometry_for_pins([SURAT])
        assert len(cover.features) == 1
        assert cover.unmatched == [] and cover.unavailable == []
    finally:
        pb.reset_caches()


@live_r2
async def test_live_a_missing_vintage_is_unavailable_not_unmatched(monkeypatch):
    """AN OUTAGE, SIMULATED READ-ONLY AGAINST THE REAL BUCKET.

    Nothing is written, deleted or moved: the reader is pointed at a vintage
    that has never existed, so the real `list_objects_v2` returns an empty
    listing. That is indistinguishable from a misconfiguration, which is ours
    and not the customer's — so every PIN must come back `unavailable`.
    """
    pb.reset_caches()
    monkeypatch.setattr(pb, "_VINTAGE_PREFIX",
                        "reference/pincode-boundaries/datagov-1999-01/")
    try:
        cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
        assert cover.unavailable == [DELHI_WITH_A_SHAPE]
        assert cover.unmatched == [], (
            "a vintage that is not there was reported as 'no boundary exists'")
    finally:
        pb.reset_caches()


@live_r2
async def test_live_an_object_that_is_gone_is_unavailable_not_unmatched(monkeypatch):
    """THE SHARPER HALF, and still read-only.

    The real index is loaded first, so the reader believes shard `11` exists —
    it does. The vintage is then swapped underneath it, so the GET goes to a key
    that has never existed and the real bucket answers `NoSuchKey`, HTTP 404.
    That 404 must NOT become `unmatched`: the index said the object was there,
    so all we have learnt is that we cannot read it.

    This is the case `storage.download_file` cannot express — it answers `None`
    for a missing key and for a dead bucket alike.
    """
    pb.reset_caches()
    index = await pb.shard_index(force=True)
    assert index is not None and "11" in index
    pb._shard_cache.clear()          # keep the index, drop any parsed shard

    monkeypatch.setattr(pb, "_VINTAGE_PREFIX",
                        "reference/pincode-boundaries/datagov-1999-01/")
    try:
        cover = await pb.geometry_for_pins([DELHI_WITH_A_SHAPE])
        assert cover.unavailable == [DELHI_WITH_A_SHAPE]
        assert cover.unmatched == []
        assert cover.features == []
    finally:
        pb.reset_caches()


# ══════════════════════════════════════════════════════════════════════════════
#  9 · LIVE SCHEMA — Parse and Describe, nothing executed
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection, so a statement is planned the way it
#: will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

DB_SKIP = (
    "no live database. This half PREPAREs the territory read against the real "
    "catalogue: Parse and Describe, no execution, no row read and none "
    "written. Run it with:\n"
    "    cd backend && railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_pin_boundaries.py -q"
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
            stmt = await conn.prepare(pb.CLAIMED_PINS_SQL)
            columns = await conn.fetch(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = ANY(current_schemas(false)) AND table_name='graha_territories'")
            return len(stmt.get_parameters()), {r["column_name"]: r["data_type"]
                                                for r in columns}
        finally:
            await conn.close()

    return asyncio.run(run())


def test_live_the_territory_read_parses_against_the_real_schema(described):
    """A MagicMock answers happily to a statement naming a column that is not
    there — that is how `gst_rate` survived in the billing router until it had
    never once succeeded."""
    binds, _columns = described
    assert binds == 2, "the statement takes the territory id and the org id"


def test_live_rules_is_jsonb_so_the_arrow_operator_is_the_right_read(described):
    """`rules -> 'pincodes'` and NOT `jsonb_array_elements_text(...)`.

    Verified against the live database: the set-returning form raises
    `InvalidParameterValueError: cannot extract elements from a scalar` on
    `{"pincodes": "400001"}`, a shape the product will happily store — so one
    territory saved with a bare string would 500 the map for the whole
    organisation. `->` returns NULL for every non-object and cannot fail.
    """
    _binds, columns = described
    assert columns.get("rules") == "jsonb"
    assert "jsonb_array_elements" not in pb.CLAIMED_PINS_SQL


def test_the_territory_read_is_scoped_to_the_org_and_to_live_rows():
    """`graha_territories.id` is unique table-wide and DELETE is a soft delete.
    The id alone reads another organisation's territory — the leak PHASE-7
    §7.1a closed in three other places, and this statement is a fourth place it
    could have opened."""
    assert "t.org_id = $2::uuid" in pb.CLAIMED_PINS_SQL
    assert "t.is_active = TRUE" in pb.CLAIMED_PINS_SQL
    assert "$1::uuid" in pb.CLAIMED_PINS_SQL, (
        "a bare $n into a uuid column is the untyped-parse 500 PgBouncer turns "
        "every ambiguous expression into")
