"""The IFSC directory reader — the four answers it must keep apart.

── WHY THE STATUSES MATTER MORE THAN THE LOOKUP ────────────────────────────

`statutory_ids.py` already says what is at stake: "A salary credited on a wrong
IFSC is routed to a different branch." The lookup itself is a dict access. What
is easy to get wrong, and expensive, is collapsing the reasons a lookup found
nothing:

    malformed    they have not finished typing
    unknown      eleven valid characters naming no branch that exists
    unavailable  R2 could not be read; their details may be perfectly correct
    found

A screen that draws `unavailable` as a validation failure tells a payroll clerk
their correct bank details are wrong, during an outage, at the moment they are
trying to pay people. Nothing about that failure is visible in review — the code
reads fine, and it only misbehaves when the bucket does.
"""
import asyncio
import json

import pytest

from services import ifsc_directory as ifsc


@pytest.fixture(autouse=True)
def _clean():
    ifsc.reset_caches()
    yield
    ifsc.reset_caches()


#: One split bank and one that is not, which is the whole of the shard rule.
INDEX = {"vintage": ifsc.VINTAGE, "count": 183214, "split": ["SBIN"],
         "codes": ["SBIN", "KKBK"]}

SHARDS = {
    "_index": INDEX,
    # SBIN is split, so this holds only the IFSCs ending in '1'.
    "SBIN-1": {"SBIN0000001": ["State Bank of India", "Fort", "MUMBAI",
                               "MUMBAI", "MAHARASHTRA", "Horniman Circle"]},
    # KKBK is not split, so the whole bank is one object.
    "KKBK": {"KKBK0000958": ["Kotak Mahindra Bank", "Nariman Point", "MUMBAI",
                             "MUMBAI", "MAHARASHTRA", "Nariman Point"]},
}


def _install(monkeypatch, shards=SHARDS, fail=()):
    """Serve shards from a dict. `fail` names objects that read as unavailable."""
    reads = []

    async def fake_read(name):
        reads.append(name)
        if name in fail:
            return None
        return shards.get(name)

    monkeypatch.setattr(ifsc, "_read_json", fake_read)
    return reads


# ── normalise ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expect", [
    ("SBIN0000001", "SBIN0000001"),
    ("sbin0000001", "SBIN0000001"),
    ("  SBIN 0000001 ", "SBIN0000001"),
    ("SBIN-0000001", "SBIN0000001"),
    ("HDFC0CAACOB", "HDFC0CAACOB"),
])
def test_normalise_accepts_what_a_person_pastes(raw, expect):
    # People paste an IFSC out of a bank letter or a PDF, and it arrives with
    # spaces and hyphens in it. Refusing those would be refusing a correct code.
    assert ifsc.normalise(raw) == expect


@pytest.mark.parametrize("raw", [
    None, "", "SBIN000000", "SBIN00000012", "SBI0000001",
    "SBIN1000001",           # the 5th character must be a literal zero
    "SB!N0000001", 12345,
])
def test_normalise_refuses_what_is_not_an_ifsc(raw):
    assert ifsc.normalise(raw) is None


# ── shard_for: the index decides, never the threshold ───────────────────────

def test_shard_for_splits_only_the_banks_the_index_names():
    split = frozenset({"SBIN"})
    assert ifsc.shard_for("SBIN0000001", split) == "SBIN-1"
    assert ifsc.shard_for("KKBK0000958", split) == "KKBK"


def test_shard_for_ignores_the_threshold_entirely():
    """The regression this is really about.

    `SPLIT_ABOVE` decided the layout when the shards were WRITTEN. A reader that
    re-applied it would compute a different key the moment a bank crossed the
    line, and every lookup for that bank would ask for an object that does not
    exist — a whole bank silently becoming "no such branch" without a single
    error anywhere.
    """
    # An empty split set means nothing is split, whatever any threshold says.
    assert ifsc.shard_for("SBIN0000001", frozenset()) == "SBIN"
    # And a tiny bank IS split if the index says it was.
    assert ifsc.shard_for("KKBK0000958", frozenset({"KKBK"})) == "KKBK-8"


# ── describe: the four answers ───────────────────────────────────────────────

def test_found_returns_the_branch(monkeypatch):
    _install(monkeypatch)
    out = asyncio.run(ifsc.describe("SBIN0000001"))
    assert out["status"] == "found"
    assert out["branch"]["bank"] == "State Bank of India"
    assert out["branch"]["branch"] == "Fort"
    assert out["branch"]["state"] == "MAHARASHTRA"
    assert out["branch"]["ifsc"] == "SBIN0000001"
    # A licence condition, not a nicety — served with the data so the two
    # cannot drift, exactly like `pin_boundaries.ATTRIBUTION`.
    assert out["attribution"]


def test_found_reads_an_unsplit_bank_from_the_whole_bank_object(monkeypatch):
    reads = _install(monkeypatch)
    out = asyncio.run(ifsc.describe("KKBK0000958"))
    assert out["status"] == "found"
    assert "KKBK" in reads and "KKBK-8" not in reads


def test_malformed_is_not_unknown(monkeypatch):
    _install(monkeypatch)
    assert asyncio.run(ifsc.describe("SBIN000"))["status"] == "malformed"


def test_malformed_never_touches_r2(monkeypatch):
    """A form runs this per keystroke. Half a code must not be 618 GETs."""
    reads = _install(monkeypatch)
    asyncio.run(ifsc.describe("SB"))
    assert reads == []


def test_unknown_is_a_valid_code_with_no_branch(monkeypatch):
    _install(monkeypatch)
    out = asyncio.run(ifsc.describe("KKBK0999999"))
    assert out["status"] == "unknown"
    assert out["branch"] is None


def test_a_bank_that_does_not_exist_is_unknown_not_unavailable(monkeypatch):
    """THE DEFECT A LIVE READ-BACK FOUND AND THESE UNIT TESTS DID NOT.

    `ZZZZ0999999` is eleven valid characters naming a bank that has never
    existed. Before the index carried `codes`, it reached a GET for a shard that
    had never been written, the GET 404'd, and the answer was `unavailable` —
    which a form must not draw as a validation failure. So the product would
    have told somebody their obviously invented IFSC was an outage.

    The original fixture could not have caught this: it served shards from a
    dict, and a missing key and a simulated outage both came back None. That is
    an assertion satisfied by the shape of its own fixture, and the only reason
    it surfaced is that the directory was read back from R2 for real.
    """
    reads = _install(monkeypatch)
    out = asyncio.run(ifsc.describe("ZZZZ0999999"))
    assert out["status"] == "unknown"
    # And it did not spend a GET finding that out.
    assert "ZZZZ" not in reads


def test_an_index_with_no_codes_does_not_reject_every_bank(monkeypatch):
    """A vintage written before `codes` existed must degrade to "cannot say".

    Treating an empty list as "no bank exists" would turn every lookup in the
    product into `unknown` off one stale index — a total outage dressed as a
    confident answer, which is the worse of the two failures.
    """
    _install(monkeypatch, shards={**SHARDS, "_index": {"count": 1, "split": ["SBIN"]}})
    assert asyncio.run(ifsc.describe("SBIN0000001"))["status"] == "found"


def test_unavailable_when_the_index_cannot_be_read(monkeypatch):
    _install(monkeypatch, fail=("_index",))
    out = asyncio.run(ifsc.describe("SBIN0000001"))
    # NOT "unknown". Their IFSC may be perfectly correct.
    assert out["status"] == "unavailable"


def test_unavailable_when_the_shard_cannot_be_read(monkeypatch):
    _install(monkeypatch, fail=("SBIN-1",))
    assert asyncio.run(ifsc.describe("SBIN0000001"))["status"] == "unavailable"


def test_lookup_and_describe_agree(monkeypatch):
    _install(monkeypatch)
    assert asyncio.run(ifsc.lookup("SBIN0000001"))["branch"] == "Fort"
    assert asyncio.run(ifsc.lookup("KKBK0999999")) is None


# ── caching ──────────────────────────────────────────────────────────────────

def test_a_failed_index_read_is_not_cached(monkeypatch):
    """SUCCESS IS CACHED, FAILURE IS NOT.

    A failed probe held for the hour-long TTL would turn a thirty-second R2 blip
    into an hour of "no such branch" — indistinguishable, to the person typing,
    from the branch genuinely not existing.
    """
    state = {"fail": True}
    reads = []

    async def flaky(name):
        reads.append(name)
        if name == "_index" and state["fail"]:
            return None
        return SHARDS.get(name)

    monkeypatch.setattr(ifsc, "_read_json", flaky)
    assert asyncio.run(ifsc.describe("SBIN0000001"))["status"] == "unavailable"
    state["fail"] = False
    assert asyncio.run(ifsc.describe("SBIN0000001"))["status"] == "found"
    assert reads.count("_index") == 2, "the failure was cached"


def test_a_shard_is_read_once_then_served_from_memory(monkeypatch):
    reads = _install(monkeypatch)
    for _ in range(3):
        asyncio.run(ifsc.describe("SBIN0000001"))
    assert reads.count("SBIN-1") == 1


def test_the_shard_cache_is_bounded(monkeypatch):
    """618 shards must not become 618 resident dicts per worker."""
    many = {"_index": {"count": 1, "split": []}}
    for i in range(10):
        code = f"BNK{i}"
        many[code] = {f"{code}0000001": ["B", "Br", "C", "D", "S", "A"]}
    _install(monkeypatch, shards=many)
    for i in range(10):
        asyncio.run(ifsc.describe(f"BNK{i}0000001"))
    assert len(ifsc._shard_cache) <= ifsc._SHARD_CACHE_MAX


def test_a_shard_row_of_the_wrong_shape_is_not_served(monkeypatch):
    """A malformed shard is a broken ingest, not a branch with blank fields."""
    broken = {"_index": {"count": 1, "split": []},
              "KKBK": {"KKBK0000958": ["only", "three", "fields"]}}
    _install(monkeypatch, shards=broken)
    assert asyncio.run(ifsc.describe("KKBK0000958"))["status"] == "unknown"


def test_reset_caches_clears_both():
    ifsc._index_cache["value"] = {"count": 1, "split": frozenset()}
    ifsc._shard_cache["X"] = {}
    ifsc.reset_caches()
    assert not ifsc._index_cache and not ifsc._shard_cache


# ── the shape the shards are actually written in ────────────────────────────

def test_the_reader_and_the_writer_agree_on_the_field_order():
    """The positional row is a contract between two files.

    `prepare_ifsc_directory.build_shards` packs six values in one order and this
    module unpacks them in another list. If those drift, every lookup returns a
    branch whose address is in the bank-name field — valid JSON, valid dict,
    entirely wrong, and nothing raises.
    """
    from scripts import prepare_ifsc_directory as prep
    header_order = [c.lower() for c in
                    ("BANK", "BRANCH", "CENTRE", "DISTRICT", "STATE", "ADDRESS")]
    assert list(ifsc._FIELDS) == header_order
    # And the writer reads those six columns out of the CSV in that same order.
    assert prep.EXPECTED_HEADER[:1] == ["BANK"]
    assert prep.EXPECTED_HEADER[2:7] == ["BRANCH", "CENTRE", "DISTRICT", "STATE", "ADDRESS"]


def test_a_vintage_has_a_known_digest():
    """An unaudited vintage must not be uploadable. See the prepare script."""
    from scripts import prepare_ifsc_directory as prep
    assert ifsc.VINTAGE in prep.KNOWN_DIGESTS
    assert len(prep.KNOWN_DIGESTS[ifsc.VINTAGE]) == 64


def test_the_release_is_pinned_not_latest():
    """`-latest` is how a dataset changes under you between two runs."""
    from scripts import prepare_ifsc_directory as prep
    assert "latest" not in prep.RELEASE
    assert prep.CSV_URL.startswith("https://")
    assert prep.RELEASE in prep.CSV_URL
