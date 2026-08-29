"""pin_boundaries.py — the SHAPE of a PIN code, read out of R2 one shard at a time.

`services/territory_routing.py` answers "which territory does this PIN belong
to". This file answers the other half: "what does that PIN look like on a map".
They share exactly one thing — `normalise_pin`, imported below — and that is
deliberate. **A territory must draw the same PINs it routes.** Two definitions
of "is this a PIN" in two modules is how a contact routes into Surat while the
map draws nothing there and nobody can say which one is lying.

── WHAT THIS IS NOT ─────────────────────────────────────────────────────────

There are TWO government PIN datasets in R2 and they are constantly confused:

    shared/reference/pin-directory/datagov-2025-05/pin-directory.csv
        the DIRECTORY — pincode,state,district,blocks,... 20,144 rows.
        Phase 7.2. Nothing here reads it. No table holds it yet either:
        `information_schema.tables` matching '%pin%' returns nothing in
        `staging` or `public` on 2026-08-27 (checked in both schemas, because
        a 42P01 is a fact about ONE schema).

    shared/reference/pincode-boundaries/datagov-2025-05/{NN}.json   <- THIS ONE
        the BOUNDARIES — 69 shards, 19,312 PINs, polygons.

**Neither is authoritative and both are incomplete.** 58 PINs in the directory
have no boundary, and 531 PINs with a boundary are not in the directory. So a
PIN missing from here is not evidence that the PIN does not exist, and this
module never says that it is — it says `unmatched`, which means precisely "no
boundary was published for it", and nothing more.

── THE THREE BUCKETS, WHICH ARE THE ACCEPTANCE ──────────────────────────────

Every PIN a territory claims comes back in exactly one of four places, and the
three failures MUST NOT BE MERGED:

    a Feature   the boundary was found and is drawn
    unmatched   the dataset has no boundary for that PIN
    unavailable the read failed — R2 is down, or misconfigured, or the object
                went away. WE DO NOT KNOW whether a boundary exists
    invalid     the value is not a PIN at all ('NW1 245', 'ahmedabad', '')

Collapsing `unavailable` into `unmatched` tells a customer "there is no shape
for 110001" when R2 is merely down, and they will go and edit a territory that
was never wrong. `storage.download_file` is exactly that trap already built —
it returns `None` on every failure including a missing key — which is why
nothing here calls it and this module talks to the client itself.

── THE CACHED INDEX IS WHAT MAKES A 404 DECIDABLE ───────────────────────────

Without it, a 404 from R2 is ambiguous: it means "the government published no
shard for PINs starting 29" *and* "somebody deleted the shard" *and* "the
vintage constant is wrong". One of those is `unmatched` and two are
`unavailable`, and guessing gets it wrong two times in three.

So the index — one `list_objects_v2` over the vintage prefix, cached — is read
first, and it turns the question into two decidable ones:

    prefix not in the index   -> the dataset covers no such range: `unmatched`,
                                 with no GET issued at all
    prefix in the index, GET  -> the object we were just told exists cannot be
    fails                        read: `unavailable`

Measured live 2026-08-27 against bucket `aekaminc` (read-only): the index holds
**69** shards, `11`-`85` with `29 35 54 55 65 66` absent, and they carry
**19,312** PINs between them with no duplicates — matching the government's own
published feature count. `110001` is present; `110009` is not; `395002` — the
one PIN any live territory claims — is.

A FAILURE IS NEVER CACHED. Only a successful listing is, so an outage clears on
the next request rather than on the next deploy.

── MEMORY, MEASURED, BECAUSE THIS IS A 2GB CONTAINER ────────────────────────

The shards are not small. Measured live: the largest (`75.json`) is 670,224
bytes on the wire, 528 PINs, 33,166 vertices, and **5.03 MB once parsed** — a
7.5x expansion, because every coordinate pair becomes a Python list of two
floats. The median shard is 245,551 bytes (~1.8 MB parsed).

So the parsed shards are held in a bounded LRU of `_SHARD_CACHE_MAX`, not a
dict that grows to all 69: 69 shards would be ~145 MB per gunicorn worker,
against an observed peak of 0.85 GB on a 2 GB ceiling with two workers.
Four is 7.4 MB typical, 19.3 MB if the four largest all land in it. A territory
almost always sits in one or two shards — the first two digits of a PIN are the
postal circle — so four is several territories deep.

── NO LOCAL-DISK FALLBACK, DELIBERATELY ─────────────────────────────────────

`backend/data/pincode_boundaries/` exists on the machine that ran the prepare
script and is gitignored. Reading it when R2 is unconfigured would mean the
endpoint behaves one way on the developer's machine and another in production,
and the difference would be invisible in exactly the case this module exists to
report. No credentials means `unavailable`, which is TRUE.
"""
import asyncio
import json
import logging
import time
from collections import OrderedDict
from typing import NamedTuple

from services import storage
from services.territory_routing import normalise_pin

log = logging.getLogger(__name__)


#: Bump when the government publishes a new release AND the upload script has
#: put it in R2 under the new name. `scripts/upload_pincode_boundaries.py`
#: carries the same constant; a vintage is never rewritten in place, so the two
#: can only ever disagree by one deploy, and the reader is what decides which
#: vintage is live.
VINTAGE = "datagov-2025-05"

#: Under `_resolve_r2(None)`'s `shared/` prefix — the PLATFORM bucket, never an
#: org's. One public government dataset, identical for every tenant, owned by
#: none of them. See the upload script for why copying it per-org is wrong.
_VINTAGE_PREFIX = f"reference/pincode-boundaries/{VINTAGE}/"

#: The first two digits of a PIN are the postal circle, and that is the shard.
_SHARD_KEY_LEN = 2

#: GODL-India / CC-BY-4.0 permits commercial use **with attribution**, so this
#: is a licence condition and not a nicety. Served from here so the credit and
#: the data come from one place: a frontend that hardcodes its own string can
#: drift from the dataset it is crediting.
#:
#: This is only the GODL half. The Mappls basemap's terms require a *logo*, not
#: a text credit — see PHASE-7 §7.5. Do not let this string be read as covering
#: both.
ATTRIBUTION = "Boundaries © Government of India (data.gov.in) — GODL-India"

#: A vintage is immutable, so this could be cached for the life of the process.
#: An hour instead, for one reason: it is also the only thing that re-probes
#: whether R2 is reachable at all, and a worker that cached the index before an
#: outage would otherwise answer from it for days while every GET failed.
_INDEX_TTL_SECONDS = 3600.0

#: See the memory paragraph in the module docstring. Four shards.
_SHARD_CACHE_MAX = 4

#: `{"shards": frozenset[str], "at": monotonic}` — or empty. SUCCESS ONLY.
_index_cache: dict = {}

#: name -> parsed shard, most-recently-used last.
_shard_cache: "OrderedDict[str, dict]" = OrderedDict()

#: The two shapes `prepare_pincode_boundaries.py` writes, and nothing else.
#: Stored one letter each because the shards are read by one function and never
#: by a human; 19,312 copies of the word "MultiPolygon" is 230 KB of nothing.
_GEOMETRY_TYPES = {"P": "Polygon", "M": "MultiPolygon"}

#: Longest raw value echoed back in `invalid`. It is the customer's own text
#: from their own territory, so there is nothing to hide — but `rules` is a free
#: JSON blob a person can hand-edit, and a 4 KB "PIN" should not become a 4 KB
#: response field.
_LABEL_MAX = 32


def reset_caches() -> None:
    """Drop the index and every parsed shard. For tests, and for a REPL.

    Not wired to any route on purpose: the vintage is immutable, so there is
    nothing an operator could need to flush that the hourly TTL does not.
    """
    _index_cache.clear()
    _shard_cache.clear()


# ── Which PINs does this territory claim, exactly as they were typed ─────────

#: Deliberately org-scoped AND `is_active`-scoped, matching
#: `territory_routing.TERRITORIES_SQL` predicate for predicate:
#: `graha_territories.id` is unique table-wide and DELETE is a soft delete, so
#: the id alone reads another organisation's territory — the leak PHASE-7 §7.1a
#: closed in three other places.
#:
#: `rules -> 'pincodes'` and NOT `jsonb_array_elements_text(rules->'pincodes')`.
#: Verified against the live database on 2026-08-27, every shape the product can
#: store:
#:
#:     {"pincodes":["400001","x"]} -> '["400001", "x"]'
#:     {"pincodes":"400001"}       -> '"400001"'      (a bare string: legal)
#:     {"pincodes":[400001]}       -> '[400001]'      (JSON numbers: legal)
#:     {}, [1,2], '"str"', 5, null -> NULL
#:
#: while `jsonb_array_elements_text` on the same scalar raises
#: `InvalidParameterValueError: cannot extract elements from a scalar`. One
#: territory saved with a bare string would therefore 500 the map for the whole
#: organisation. `->` cannot fail; the filtering happens in Python, the same way
#: and for the same reason as `territory_routing._pincodes_of`.
#:
#: ── WHY THIS STATEMENT LIVES IN A SERVICE AND NOT IN THE ROUTER ─────────────
#:
#: `tests/test_every_writer_has_a_live_sql_test.py` marks a router "covered"
#: when ANY test file both PREPAREs a statement and names that router. The CRM
#: router is baselined in its `UNCOVERED` list with thirty-odd write paths this
#: statement proves nothing about. A test that prepared this from
#: `routers.graha` would delete `graha` from that baseline on a technicality and
#: quietly retire the guarantee. `tests/test_territory_routing.py` records the
#: same trap for the same reason. So the SQL is defined here, and
#: `tests/test_pin_boundaries.py` prepares it against the real schema without
#: naming the router at all.
CLAIMED_PINS_SQL = (
    "SELECT t.rules -> 'pincodes' AS pincodes "
    "FROM public.graha_territories t "
    "WHERE t.id = $1::uuid AND t.org_id = $2::uuid AND t.is_active = TRUE"
)


#: What `claimed_entries` answers when the territory is not this organisation's,
#: or has been soft-deleted. `None` CANNOT carry that meaning: `None` is also
#: what `rules -> 'pincodes'` returns when the key is simply absent, which is
#: true of fifteen of the eighteen live territories and is not an error at all.
#: Collapsing the two would turn every territory that has never been given a PIN
#: into a 404.
NO_SUCH_TERRITORY = object()


def _decoded(raw):
    """`rules->'pincodes'` as a Python value, whatever the connection handed back.

    Both connection kinds reach this: `db.py` registers a jsonb codec so a
    POOLED connection decodes the column to a Python list, while a bare
    `asyncpg.connect()` — the live-schema tests, and every `railway run`
    script — has no codec and returns the raw JSON text.

    Text that is not JSON comes back AS ITSELF rather than as `None`, so a
    caller can still show it to the person who typed it.
    """
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError:
            return raw
    return raw


def _claim(raw) -> tuple:
    """`(entries, malformed)` — the claimed PIN list, and what was there instead.

    A value that is not a JSON array gives NO entries, which is the same answer
    `territory_routing._pincodes_of` gives it, and that is the point: the map
    must claim exactly what routing claims. The equivalence is asserted in
    `tests/test_pin_boundaries.py` over every shape the column actually holds,
    rather than assumed from two functions that look alike.

    `malformed` is the second half and it is not the same information. `None`
    there means "nothing was claimed" — no key, or a JSON null, which is fifteen
    of the eighteen live territories and perfectly ordinary. Anything else means
    the customer put SOMETHING under `pincodes` that cannot be a PIN list, and
    the caller names it rather than dropping it.
    """
    value = _decoded(raw)
    if isinstance(value, (list, tuple)):
        return list(value), None
    return [], value


async def claimed_entries(conn, org_id: str, territory_id: str):
    """The territory's PIN list **as typed** — or `NO_SUCH_TERRITORY`.

    An empty list is a real territory that claims nothing, and it must answer
    200 with an empty FeatureCollection rather than an error: three live
    territories carry exactly `{"pincodes": []}` and fifteen have no `pincodes`
    key at all.

    RAW and undecoded, which is the whole reason this exists beside
    `load_territories`. `Territory.pincodes` is the set routing SEES — already
    normalised, already deduplicated, every unusable entry dropped. The
    `invalid` bucket is the difference between the two, so it cannot be
    computed from the parsed set: it needs what the customer TYPED.
    """
    row = await conn.fetchrow(CLAIMED_PINS_SQL, str(territory_id), org_id)
    if row is None:
        return NO_SUCH_TERRITORY
    return _decoded(row["pincodes"])


# ── R2: the index, then the shards ───────────────────────────────────────────

async def _r2() -> tuple:
    """(client, bucket, key_prefix) for the platform bucket, or (None, None, "").

    `org_id=None` is load-bearing, not a placeholder: it is what makes
    `_resolve_r2` answer with the platform bucket under `shared/`. Passing an
    org would send this at that org's own bucket, where the boundaries have
    never been and never will be.

    The `shared/` assertion mirrors the refusal in
    `scripts/upload_pincode_boundaries.py`. If `_resolve_r2(None)` ever starts
    answering with an org prefix, this reads out of a tenant's namespace, and a
    read that quietly changes which tenant's bucket it is pointed at is worth
    six lines to prevent.
    """
    client, bucket, key_prefix = await storage._resolve_r2(None)
    if client is None:
        return None, None, ""
    if key_prefix != "shared/":
        log.error("PIN boundaries: _resolve_r2(None) gave key_prefix %r, not "
                  "'shared/'. Refusing to read boundaries out of an org prefix.",
                  key_prefix)
        return None, None, ""
    return client, bucket, key_prefix


async def shard_index(*, force: bool = False) -> frozenset | None:
    """Which shards exist under the live vintage. `None` means R2 did not answer.

    `None` is not "no shards" and the difference is the whole design: every PIN
    becomes `unavailable` rather than `unmatched`, because when the listing
    fails we do not know what the dataset holds.
    """
    cached = _index_cache.get("shards")
    if cached is not None and not force:
        if time.monotonic() - _index_cache.get("at", 0.0) < _INDEX_TTL_SECONDS:
            return cached

    client, bucket, key_prefix = await _r2()
    if client is None:
        log.warning("PIN boundaries: R2 is not configured; every PIN will be "
                    "reported unavailable rather than unmatched.")
        return None

    prefix = f"{key_prefix}{_VINTAGE_PREFIX}"
    try:
        names = await _list_shards(client, bucket, prefix)
    except Exception as exc:                                   # noqa: BLE001
        # NOT cached. A cached failure would outlive the outage that caused it.
        log.warning("PIN boundary index could not be listed from bucket=%s "
                    "prefix=%s: %s", bucket, prefix, exc)
        return None

    if not names:
        # An empty listing is indistinguishable from a wrong prefix, and both
        # are our fault rather than the customer's — so it is an outage, not
        # "your PINs have no shapes". 69 shards is the live count.
        log.error("PIN boundary index at bucket=%s prefix=%s is EMPTY. Either "
                  "the vintage constant is wrong or the upload never ran; "
                  "reporting every PIN as unavailable.", bucket, prefix)
        return None

    _index_cache["shards"] = names
    _index_cache["at"] = time.monotonic()
    log.info("PIN boundary index: %d shards under %s", len(names), prefix)
    return names


async def _list_shards(client, bucket: str, prefix: str) -> frozenset:
    """One `list_objects_v2`, paginated. Raises — the caller decides what that
    means, and it must not mean `unmatched`."""
    loop = asyncio.get_running_loop()
    names: set = set()
    token = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        # boto3 is blocking; every other R2 call in this codebase goes through
        # the executor for the same reason (`storage.download_file`).
        resp = await loop.run_in_executor(
            None, lambda kw=kwargs: client.list_objects_v2(**kw))
        for obj in resp.get("Contents", []):
            name = obj["Key"][len(prefix):]
            # Flat namespace by construction, but a stray sub-prefix must not
            # become a shard name that no GET can ever satisfy.
            if name.endswith(".json") and "/" not in name:
                names.add(name[: -len(".json")])
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
        if not token:
            break
    return frozenset(names)


async def _load_shard(name: str) -> dict | None:
    """One parsed shard, `None` if it could not be read. Never raises.

    `None` here always means `unavailable`, never `unmatched` — by the time
    this is called the index has already said the object exists.
    """
    cached = _shard_cache.get(name)
    if cached is not None:
        _shard_cache.move_to_end(name)
        return cached

    client, bucket, key_prefix = await _r2()
    if client is None:
        return None

    key = f"{key_prefix}{_VINTAGE_PREFIX}{name}.json"
    try:
        loop = asyncio.get_running_loop()
        obj = await loop.run_in_executor(
            None, lambda: client.get_object(Bucket=bucket, Key=key))
        payload = json.loads(obj["Body"].read())
    except Exception as exc:                                   # noqa: BLE001
        # Including NoSuchKey. The index said this key was there, so a 404 now
        # means it went away between the listing and the read — which is an
        # outage, not an absent boundary.
        log.warning("PIN boundary shard could not be read from bucket=%s "
                    "key=%s: %s", bucket, key, exc)
        return None

    if not isinstance(payload, dict):
        log.error("PIN boundary shard %s is not a JSON object", key)
        return None

    _shard_cache[name] = payload
    _shard_cache.move_to_end(name)
    while len(_shard_cache) > _SHARD_CACHE_MAX:
        _shard_cache.popitem(last=False)
    return payload


# ── The four buckets ─────────────────────────────────────────────────────────

class Coverage(NamedTuple):
    """What a set of claimed PINs turned into. Four lists, never merged.

    `features` is GeoJSON and names its PIN in `properties.pincode`, so the
    matched PINs are already named and a fifth `matched` list would be a second
    copy of the same six digits. The endpoint reports `matched` as a COUNT for
    that reason; the three failures are LISTS, because a customer cannot act on
    a number.
    """
    features: list
    unmatched: list
    unavailable: list
    invalid: list


def _label(raw) -> str:
    """A not-a-PIN entry, as the customer will read it back."""
    text = "" if raw is None else str(raw).strip()
    return text[:_LABEL_MAX] if text else "(blank)"


def _geometry(shape) -> dict | None:
    """`{"t","c"}` as it is stored -> a GeoJSON geometry. `None` if unusable."""
    if not isinstance(shape, dict):
        return None
    gtype = _GEOMETRY_TYPES.get(shape.get("t"))
    coords = shape.get("c")
    if gtype is None or not coords:
        return None
    return {"type": gtype, "coordinates": coords}


async def geometry_for_pins(entries) -> Coverage:
    """Every PIN in `entries`, as a Feature or in exactly one failure bucket.

    Takes the RAW entries — a `rules->'pincodes'` value, in any shape the
    product can store — because `invalid` can only be computed from what was
    typed. Validity is decided by `territory_routing.normalise_pin` and by
    nothing else, so the set this looks up is identical to the set routing
    matches on.

    Duplicates are collapsed: a territory listing `400001` twice claims one PIN
    and gets one Feature. `invalid` is deduplicated the same way and keeps the
    order it was typed in; the PIN lists are sorted, because they are answers
    rather than input.
    """
    features: list = []
    unmatched: list = []
    unavailable: list = []
    invalid: list = []
    seen_pins: set = set()
    seen_invalid: set = set()

    #: shard name -> the PINs wanted from it, so each shard is read once even
    #: when a territory claims four hundred PINs inside it.
    wanted: dict = {}

    claimed, malformed = _claim(entries)
    if malformed is not None:
        # `rules.pincodes` IS NOT A LIST. A bare string is what somebody types
        # when a territory has one PIN, and the product stores it —
        # `TerritoryCreate.rules` is an untyped `dict`, so any JSON goes in, and
        # the live database was checked for exactly this. `_pincodes_of` ignores
        # it, so routing claims nothing; without this line the endpoint would
        # answer "claims nothing, nothing invalid" and the customer's own text
        # would have vanished between the two. The one thing this must not do.
        invalid.append(_label(malformed))

    for raw in claimed:
        pin = normalise_pin(raw)
        if not pin:
            label = _label(raw)
            if label not in seen_invalid:
                seen_invalid.add(label)
                invalid.append(label)
            continue
        if pin in seen_pins:
            continue
        seen_pins.add(pin)
        wanted.setdefault(pin[:_SHARD_KEY_LEN], []).append(pin)

    if not wanted:
        return Coverage([], [], [], invalid)

    index = await shard_index()
    if index is None:
        # THE BUCKET THAT MUST NOT MERGE. R2 did not answer, so we do not know
        # whether these PINs have boundaries — and saying `unmatched` here is
        # the endpoint telling a customer their territory is wrong during an
        # outage of ours.
        for pins in wanted.values():
            unavailable.extend(pins)
        return Coverage([], [], sorted(unavailable), invalid)

    present = [name for name in wanted if name in index]
    for name in wanted:
        if name not in index:
            # The dataset publishes no shard for this range at all — prefixes
            # 29, 35, 54, 55, 65 and 66 have none. That is a real absence, and
            # it is answered without issuing a GET that could only 404.
            unmatched.extend(wanted[name])

    # Concurrently, because a territory spanning five shards is 5 x ~250 KB and
    # doing that serially is the difference between a map that opens and one
    # somebody reloads. `return_exceptions` is not needed — `_load_shard`
    # swallows its own failures into `None`, which is the bucket decision.
    payloads = await asyncio.gather(*(_load_shard(name) for name in present))

    for name, payload in zip(present, payloads):
        if payload is None:
            unavailable.extend(wanted[name])
            continue
        for pin in wanted[name]:
            shape = payload.get(pin)
            if shape is None:
                unmatched.append(pin)
                continue
            geometry = _geometry(shape)
            if geometry is None:
                # We HAVE something for this PIN and cannot render it. That is
                # not "no boundary exists" — the one thing this module must
                # never say when it is not true.
                log.error("PIN boundary for %s in shard %s is unusable: %r",
                          pin, name, list(shape)[:4] if isinstance(shape, dict)
                          else type(shape).__name__)
                unavailable.append(pin)
                continue
            features.append({
                "type": "Feature",
                "properties": {"pincode": pin},
                "geometry": geometry,
            })

    features.sort(key=lambda f: f["properties"]["pincode"])
    return Coverage(features, sorted(unmatched), sorted(unavailable), invalid)
