"""ifsc_directory.py — which bank and branch an IFSC names, read from R2.

── WHY THIS EXISTS ──────────────────────────────────────────────────────────

`services/statutory_ids.py` already validates the SHAPE of an IFSC and says
exactly why it bothers: "A salary credited on a wrong IFSC is routed to a
different branch." But `^[A-Z]{4}0[A-Z0-9]{6}$` only proves somebody typed
eleven characters in the right pattern. `HDFC0999999` passes it and does not
exist, and the money goes wherever a nonexistent branch code sends it.

So the product asked a payroll clerk to type a bank name and a branch by hand,
next to a code that already contains both, and could not tell them when the two
disagreed. This module closes that: given an IFSC, the bank, branch, centre,
district, state and address that the RBI directory says it is.

── WHY R2 AND NOT A TABLE ───────────────────────────────────────────────────

183,214 branches. It is a public reference dataset, identical for every tenant,
owned by none of them, and it is replaced wholesale rather than edited — which
is the same argument `pin_boundaries.py` makes for the boundary shards and the
one the owner made for this: keep the database free. A table would also need
RLS, and CLAUDE.md is explicit that a table in `public` without it is a silent
cross-tenant leak. There is nothing tenant-scoped here to leak, and the way to
keep that true is to not create the table.

── SHARDING, AND WHY IT IS NOT THE OBVIOUS ONE ──────────────────────────────

The obvious shard key is the four-letter bank code, and it does not work: SBIN
alone has 26,498 branches, a 3.8 MB object to answer one lookup. The next
obvious key is the character after the mandatory `0`, and that is worse — it is
`0` for almost every bank, so `SBIN0` still holds 26,482.

⚠ THE LAST CHARACTER IS THE ONLY WELL-DISTRIBUTED ONE, and it is used only for
the banks that need it. Measured over the whole 2026-09-01 release:

    shard by bank code, splitting the 19 banks above 2,000 branches
    -> 618 objects, median 5,286 bytes, largest 1,762,330

That largest is in the same range as the PIN boundary shards this codebase
already reads (median 245,551, largest 670,224 raw / ~1.8 MB parsed), so it
takes the same bounded LRU rather than a cleverer scheme. Which banks are split
is recorded in the index, not guessed: a reader that assumed the rule would
break the day a 1,900-branch bank opened its 2,001st.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import OrderedDict
from typing import Optional

from services import storage

log = logging.getLogger(__name__)


#: Bump when a newer RBI release has been prepared AND uploaded under the new
#: name, then add its digest to `KNOWN_DIGESTS` in the prepare script. A vintage
#: is never rewritten in place, so a refresh is a re-run of the loader and never
#: a migration — same discipline as `pin_directory.VINTAGE`.
VINTAGE = "rbi-2026-09-01"

#: Under `_resolve_r2(None)`'s `shared/` prefix — the PLATFORM bucket, never an
#: org's. See the module docstring.
_VINTAGE_PREFIX = f"reference/ifsc/{VINTAGE}/"

#: Written by the prepare script. `{"vintage":…, "count":…, "split":[codes]}`.
INDEX_NAME = "_index"

#: Above this many branches a bank is split by the last character of the IFSC.
#: Duplicated from the prepare script deliberately — this module never applies
#: it, it only documents what the index means. The index is the authority.
SPLIT_ABOVE = 2000

#: RBI publishes the directory; the redistribution used here is razorpay/ifsc,
#: which is MIT-licensed and machine-readable. Served from here so the credit
#: and the data come from one place, exactly like `pin_boundaries.ATTRIBUTION`.
ATTRIBUTION = "Bank branch data © Reserve Bank of India, via razorpay/ifsc (MIT)"

#: A vintage is immutable, so this could be cached forever. An hour instead, for
#: the reason `pin_boundaries` gives: it is also the only thing that re-probes
#: whether R2 is reachable, and a worker that cached before an outage would
#: otherwise answer from a stale index for days while every GET failed.
_INDEX_TTL_SECONDS = 3600.0

#: Four shards. The largest is 1.7 MB and a payroll run touches a handful of
#: banks, so this holds the working set of a realistic session without holding
#: all 618.
_SHARD_CACHE_MAX = 4

_index_cache: dict = {}
_shard_cache: "OrderedDict[str, dict]" = OrderedDict()

#: The same expression `statutory_ids.py` validates with. Repeated rather than
#: imported because that module raises a field-level HTTP error designed for a
#: form, and this one answers None for a lookup — importing it would drag a
#: 400-shaped refusal into a read path that has no field to name.
_IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")

#: The order `prepare_ifsc_directory.py` packs each row in. Positional because
#: 183,214 copies of six key names is megabytes of nothing — the same argument
#: `pin_boundaries` makes for storing "P"/"M" instead of "Polygon".
_FIELDS = ("bank", "branch", "centre", "district", "state", "address")


def reset_caches() -> None:
    """Drop the index and every parsed shard. For tests, and for a REPL."""
    _index_cache.clear()
    _shard_cache.clear()


def normalise(ifsc: Optional[str]) -> Optional[str]:
    """An IFSC as the directory stores it, or None if it is not one.

    Uppercased and stripped of the spaces a person pastes from a bank letter.
    Returning None rather than raising is deliberate: this is a lookup, and
    "that is not an IFSC" and "that IFSC is not in the directory" are answered
    the same way by the caller — neither is an error, both are "no match".
    """
    if not ifsc:
        return None
    cleaned = re.sub(r"[\s-]+", "", str(ifsc)).upper()
    return cleaned if _IFSC_RE.match(cleaned) else None


def shard_for(ifsc: str, split_codes: frozenset) -> str:
    """Which object holds this IFSC, given the index's list of split banks.

    ⚠ `split_codes` COMES FROM THE INDEX, never from `SPLIT_ABOVE`. The
    threshold decided the layout when the shards were written; applying it at
    read time would compute a different answer the moment a bank crossed it,
    and every lookup for that bank would ask for a key that does not exist.
    """
    code = ifsc[:4]
    return f"{code}-{ifsc[-1]}" if code in split_codes else code


async def _r2():
    """The platform bucket, or `(None, None, "")`.

    The `shared/` assertion mirrors `pin_boundaries._r2` and the refusal in the
    upload script: if `_resolve_r2(None)` ever starts answering with an org
    prefix, this reads out of a tenant's namespace.
    """
    client, bucket, key_prefix = await storage._resolve_r2(None)
    if client is None:
        return None, None, ""
    if key_prefix != "shared/":
        log.error("IFSC directory: _resolve_r2(None) gave key_prefix %r, not "
                  "'shared/'. Refusing to read the directory out of an org "
                  "prefix.", key_prefix)
        return None, None, ""
    return client, bucket, key_prefix


async def _read_json(name: str) -> Optional[dict]:
    """One object under this vintage, parsed. None if it could not be read."""
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
        # Including NoSuchKey. For a shard the index has already said the key is
        # there, so a 404 now is an outage rather than an absent branch.
        log.warning("IFSC object could not be read from bucket=%s key=%s: %s",
                    bucket, key, exc)
        return None
    if not isinstance(payload, dict):
        log.error("IFSC object %s is not a JSON object", key)
        return None
    return payload


async def _index() -> Optional[dict]:
    """`{"count": int, "split": frozenset}`, or None when R2 is unreachable.

    SUCCESS IS CACHED, FAILURE IS NOT. A failed probe cached for an hour would
    turn a thirty-second R2 blip into an hour of "no such branch" — which is
    indistinguishable, to a payroll clerk, from the branch genuinely not
    existing, and that is the wrong thing to be confident about.
    """
    now = asyncio.get_running_loop().time()
    cached = _index_cache.get("at")
    if cached is not None and now - cached < _INDEX_TTL_SECONDS:
        return _index_cache.get("value")

    payload = await _read_json(INDEX_NAME)
    if payload is None:
        return None

    value = {
        "count": int(payload.get("count") or 0),
        "split": frozenset(payload.get("split") or ()),
        # Every bank code in the release. See `_known_bank` — without it a
        # nonexistent bank is indistinguishable from an unreachable bucket.
        "codes": frozenset(payload.get("codes") or ()),
    }
    _index_cache["value"] = value
    _index_cache["at"] = now
    return value


async def _load_shard(name: str) -> Optional[dict]:
    """One parsed shard, from cache or R2. Never raises."""
    cached = _shard_cache.get(name)
    if cached is not None:
        _shard_cache.move_to_end(name)
        return cached

    payload = await _read_json(name)
    if payload is None:
        return None

    _shard_cache[name] = payload
    _shard_cache.move_to_end(name)
    while len(_shard_cache) > _SHARD_CACHE_MAX:
        _shard_cache.popitem(last=False)
    return payload


def _known_bank(code: str, index: dict) -> bool:
    """Whether the release contains this four-letter bank code at all.

    ⚠ THIS IS THE DIFFERENCE BETWEEN "no such bank" AND "R2 is down", and it is
    not a refinement — it was a live defect. Before the index carried `codes`,
    `ZZZZ0999999` reached a GET for a shard that had never existed, the GET
    404'd, and the answer came back `unavailable`. A form must not draw
    `unavailable` as a validation failure, so a plainly invented code was
    reported to the person typing it as an outage.

    The unit tests did not catch it. They served shards from a dict that
    returned None for a missing key exactly as it did for a simulated outage —
    an assertion satisfied by the shape of its own fixture. A live read-back
    caught it in one line.

    An index written before `codes` existed has an empty set here. That must
    read as "cannot say", not as "no bank exists", or one stale index would turn
    every lookup in the product into `unknown`.
    """
    codes = index.get("codes") or frozenset()
    return code in codes if codes else True


async def lookup(ifsc: Optional[str]) -> Optional[dict]:
    """The branch an IFSC names, or None.

    ⚠ NONE IS AMBIGUOUS ON PURPOSE AND THE CALLER MUST NOT RESOLVE IT.
    It means "not a valid IFSC", "no such branch", or "R2 could not be read",
    and a caller that turned any of those into "this IFSC is wrong" would tell a
    payroll clerk their correct bank details are invalid during an outage. The
    route above this reports availability separately; see `describe`.
    """
    key = normalise(ifsc)
    if not key:
        return None

    index = await _index()
    if index is None:
        return None

    if not _known_bank(key[:4], index):
        return None

    shard = await _load_shard(shard_for(key, index["split"]))
    if shard is None:
        return None

    row = shard.get(key)
    if not isinstance(row, list) or len(row) != len(_FIELDS):
        return None

    out = dict(zip(_FIELDS, (str(v or "").strip() for v in row)))
    out["ifsc"] = key
    return out


async def describe(ifsc: Optional[str]) -> dict:
    """A lookup with the three outcomes kept apart.

    `{"status": "found"|"unknown"|"malformed"|"unavailable", "branch": …}`.

    This is the shape a form needs. "unavailable" must never be drawn as a
    validation failure — the person's IFSC may be perfectly correct and the
    bucket simply unreachable — and `lookup()` alone cannot say which happened.
    """
    key = normalise(ifsc)
    if not key:
        return {"status": "malformed", "branch": None, "vintage": VINTAGE}

    index = await _index()
    if index is None:
        return {"status": "unavailable", "branch": None, "vintage": VINTAGE}

    # A bank code the release has never heard of is a definite answer, and it
    # is reachable without touching R2 a second time.
    if not _known_bank(key[:4], index):
        return {"status": "unknown", "branch": None, "vintage": VINTAGE}

    shard = await _load_shard(shard_for(key, index["split"]))
    if shard is None:
        return {"status": "unavailable", "branch": None, "vintage": VINTAGE}

    row = shard.get(key)
    if not isinstance(row, list) or len(row) != len(_FIELDS):
        return {"status": "unknown", "branch": None, "vintage": VINTAGE}

    branch = dict(zip(_FIELDS, (str(v or "").strip() for v in row)))
    branch["ifsc"] = key
    return {
        "status": "found",
        "branch": branch,
        "vintage": VINTAGE,
        "attribution": ATTRIBUTION,
    }
