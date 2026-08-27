"""pin_directory.py — WHICH DISTRICT AND STATE A PIN IS IN, out of R2 into a table.

"PIN" is the Postal Index Number, the six-digit Indian postcode. `400001` is
Fort, Mumbai. It is not a password.

── WHAT THIS IS NOT ─────────────────────────────────────────────────────────

There are TWO government PIN datasets in R2 and they are constantly confused.
`services/pin_boundaries.py` opens with this same warning pointing the other
way, and both are worth keeping:

    shared/reference/pincode-boundaries/datagov-2025-05/{NN}.json
        the BOUNDARIES — 69 shards, 19,312 PINs, POLYGONS. Phase 7.3.
        They stay in R2 and never enter a table: 18.5 MB of geometry that is
        only ever streamed to a map is not something to JOIN.

    shared/reference/pin-directory/datagov-2025-05/pin-directory.csv  <- THIS
        the DIRECTORY — pincode,state,district,blocks,state_lgd,district_lgd.
        20,144 short rows that WILL be joined and filtered, so they go in
        `staging.pin_directory` (migration 233).

**Neither is authoritative and both are incomplete.** 58 PINs in this directory
have no boundary, and 531 PINs with a boundary are not in this directory.

── WHY A SERVICE AND NOT A SCRIPT WITH THE SQL INLINE ───────────────────────

`backend/scripts/load_pin_directory.py` is a thin CLI over this module and
holds no SQL of its own. Nothing in `tests/` imports from `scripts/` — checked,
not assumed — so SQL that lived there could never be PREPAREd against the real
schema, and CLAUDE.md's rule is that a statement is not trusted until it has
been. Everything testable is therefore here: the parse is pure, and the two
statements are module constants that `tests/test_pin_directory.py` sends Parse
and Describe for without executing them.

── ONE DEFINITION OF "IS THIS A PIN", AND IT IS ROUTING'S ───────────────────

`normalise_pin` is imported from `services/territory_routing.py` rather than
re-implemented, for the same reason `pin_boundaries.py` imports it. A directory
that accepted a PIN routing rejects would hold a row that can never be reached,
and a directory that rejected one routing accepts would leave a routed contact
with no district — and nobody could say which of the two was lying.

── THE TRAP THIS FILE EXISTS TO NOT FALL INTO ───────────────────────────────

`state_lgd` and `district_lgd` are ZERO-PADDED TEXT: Delhi is `'07'`, New Delhi
district is `'094'`. Every step from the CSV cell to the column is text, and the
column is `text` with a digits-only CHECK. `int()` appears nowhere in this file.
`'07'::integer` is a perfectly legal cast that raises nothing and silently stops
the value matching every other government dataset keyed on LGD — which is why
`parse_rows` asserts the padding rather than trusting it, and why the loader
refuses the whole file if one row has lost it.

── A PIN IS NOT UNIQUE, AND THE LOAD IS SHAPED AROUND THAT ──────────────────

Measured over all 20,144 rows on 2026-08-27, read-only, from the R2 copy:

    distinct pincodes                                18,839
    PINs resolving to exactly one (state, district)   17,610   -- only 93.5%
    PINs spanning more than one DISTRICT               1,229
    PINs spanning more than one STATE                     51
      110025 is DELHI/SOUTH EAST, DELHI/SOUTH *and* UTTAR PRADESH/BUDAUN
    duplicates on (pincode, district_lgd)                  0   <- the key
    duplicates on (pincode, state, district)               0   <- also enforced

`ON CONFLICT (pincode) DO NOTHING` would not have failed. It would have kept
whichever district was read first and thrown away the other two, in silence.

── IDEMPOTENT, AND WHAT THAT MEANS PRECISELY ────────────────────────────────

Running the loader twice does NOT produce 40,288 rows. `UPSERT_SQL` conflicts
on `(pincode, district_lgd)` and updates in place, and its `DO UPDATE` carries a
`WHERE ... IS DISTINCT FROM` guard, so a second run against an unchanged source
updates ZERO rows, stamps no `updated_at`, and reports `unchanged: 20144`
instead of claiming work it did not do. That is a stronger property than "does
not duplicate": the second run is observably a no-op, so a person can re-run it
to CHECK the table rather than only to fix it.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import re
from typing import NamedTuple

from services import storage
from services.territory_routing import normalise_pin

log = logging.getLogger(__name__)


#: Bump when the government publishes a new release AND it has been uploaded to
#: R2 under the new name, then add its digest to `KNOWN_DIGESTS` below. A
#: vintage is never rewritten in place, so the old rows stay loadable and a
#: refresh is a re-run of the loader, never a new migration.
VINTAGE = "datagov-2025-05"

#: Under `_resolve_r2(None)`'s `shared/` prefix — the PLATFORM bucket, never an
#: org's. One public government dataset, identical for every tenant, owned by
#: none of them. Same reasoning as the boundary shards; see
#: `scripts/upload_pincode_boundaries.py` for why copying it per-org is wrong.
def object_key(vintage: str = VINTAGE) -> str:
    return f"reference/pin-directory/{vintage}/pin-directory.csv"


#: sha256 of each vintage's CSV, so a load can prove it is writing the bytes
#: that were audited and not whatever is at that key today.
#:
#: THIS IS NOT PARANOIA ABOUT R2. It is that 20,144 rows are about to become the
#: thing that decides which district a customer's address is in, and "the file
#: at that key" is not the same claim as "the file whose 20,144 rows were
#: counted, whose keys were proven unique and whose LGD padding was checked".
#: The digest is what makes those two the same sentence. An unknown vintage
#: refuses and prints the digest it computed, so adding one is a one-line edit
#: by somebody who has looked.
KNOWN_DIGESTS = {
    # Verified on upload (PROGRESS.md, 2026-08-27) and again by this module's
    # own live test: 1,269,336 bytes.
    "datagov-2025-05":
        "f5de1b50855c29b863fd1a71dc9cb81a9aef0ea1a674602263ac2c5ba811cd28",
}

#: The header, exactly. Order matters — `parse_rows` reads by name, but a file
#: whose columns were reordered is a different file and should be looked at by a
#: person before 20,144 rows of it are trusted.
EXPECTED_HEADER = ["pincode", "state", "district", "blocks",
                   "state_lgd", "district_lgd"]

#: Measured, all 20,144 rows: state_lgd is always exactly 2 digits and
#: district_lgd always exactly 3, with 9 and 99 distinct values respectively
#: beginning '0'. These regexes are the same ones migration 233 puts on the
#: columns as CHECKs, so a row that would be refused by the database is refused
#: here first, with a line number.
_STATE_LGD_RE = re.compile(r"^[0-9]{2}$")
_DISTRICT_LGD_RE = re.compile(r"^[0-9]{3}$")

#: 20,144 rows x 6 text arrays is about 2.5 MB of bind parameters in one
#: message. It would work; it is chunked anyway so that memory is bounded and a
#: person watching the load sees it move. EVERY CHUNK IS IN THE SAME
#: TRANSACTION — see `load`.
CHUNK = 2000


class Row(NamedTuple):
    """One CSV line, every field a `str`. No field is ever an `int`.

    `blocks` stays the RAW JSON TEXT rather than a parsed list: it is validated
    as an array here and handed to Postgres as text with a `::jsonb` cast, so
    the load does no reshaping that could lose or reorder an entry.
    """
    pincode: str
    state: str
    district: str
    blocks: str
    state_lgd: str
    district_lgd: str


# ── Parsing, which is pure and is where every refusal happens ────────────────

def parse_rows(text: str) -> tuple[list[Row], list[str]]:
    """`(rows, problems)`. A non-empty `problems` means DO NOT LOAD.

    Collects rather than raises, and does not stop at the first bad line: an
    operator who is told "row 9,412 is wrong" fixes it and runs again to be told
    about row 9,413. The whole file is either good or reported.

    `problems` covers the source being wrong. It deliberately does NOT cover the
    source being *different* — a header in a new order, or a vintage whose
    digest is unknown, is refused earlier and louder, by `fetch_csv`.
    """
    problems: list[str] = []
    reader = csv.DictReader(io.StringIO(text))

    if reader.fieldnames != EXPECTED_HEADER:
        return [], [f"header is {reader.fieldnames!r}, expected "
                    f"{EXPECTED_HEADER!r}. Refusing to guess the columns."]

    rows: list[Row] = []
    for lineno, raw in enumerate(reader, start=2):     # 1 is the header
        # `.strip()` removes whitespace and NOTHING ELSE. It cannot touch a
        # leading zero, which is the one thing that must survive this function.
        values = {k: (raw.get(k) or "").strip() for k in EXPECTED_HEADER}

        # The product's single definition of "is this a PIN", imported from
        # routing. All 20,144 source rows pass it.
        pin = normalise_pin(values["pincode"])
        if not pin:
            problems.append(
                f"line {lineno}: {values['pincode']!r} is not a PIN "
                f"(six digits, never a leading zero)")
            continue

        if not values["state"] or not values["district"]:
            problems.append(f"line {lineno}: PIN {pin} has a blank state or "
                            f"district")
            continue

        # ⚠ THE PADDING CHECK. A file that arrived through a spreadsheet has
        #   '7' here instead of '07' and every other check in this function
        #   passes. This is the one that catches it, and it catches it BEFORE a
        #   row is written rather than months later via a join that returns
        #   nothing.
        if not _STATE_LGD_RE.match(values["state_lgd"]):
            problems.append(
                f"line {lineno}: state_lgd {values['state_lgd']!r} is not two "
                f"digits. If it reads '7' where it should read '07', the "
                f"zero-padding was destroyed upstream - do not load this file")
            continue
        if not _DISTRICT_LGD_RE.match(values["district_lgd"]):
            problems.append(
                f"line {lineno}: district_lgd {values['district_lgd']!r} is not "
                f"three digits. If it reads '94' where it should read '094', "
                f"the zero-padding was destroyed upstream")
            continue

        blocks = values["blocks"]
        try:
            parsed = json.loads(blocks) if blocks else []
        except ValueError as exc:
            problems.append(f"line {lineno}: PIN {pin} blocks is not JSON: {exc}")
            continue
        if not isinstance(parsed, list):
            problems.append(f"line {lineno}: PIN {pin} blocks is a "
                            f"{type(parsed).__name__}, not an array")
            continue
        # Normalised to compact JSON so the column holds one representation and
        # the `IS DISTINCT FROM` guard in the upsert compares content rather
        # than whitespace. jsonb would normalise it anyway; doing it here means
        # a re-run of an identically-meaning file is still `unchanged`.
        blocks = json.dumps(parsed, separators=(",", ":"))

        rows.append(Row(pin, values["state"], values["district"], blocks,
                        values["state_lgd"], values["district_lgd"]))

    return rows, problems


def key_collisions(rows) -> list[str]:
    """Both composite keys, checked in Python BEFORE any row is written.

    Migration 233 puts a UNIQUE index on each, so a colliding source would be
    caught by the database — as a `UniqueViolationError` two thirds of the way
    through a transaction that then rolls 20,144 rows back for nothing, naming
    one row and not its partner. Catching it here costs one pass over a list and
    reports BOTH sides of every collision, which is what an operator needs to
    decide whether the government changed something or the file is damaged.
    """
    seen_code: dict = {}
    seen_name: dict = {}
    out: list[str] = []
    for row in rows:
        code = (row.pincode, row.district_lgd)
        if code in seen_code:
            out.append(f"(pincode, district_lgd) {code} appears twice: "
                       f"{seen_code[code]} and {(row.state, row.district)}")
        else:
            seen_code[code] = (row.state, row.district)

        name = (row.pincode, row.state, row.district)
        if name in seen_name:
            out.append(f"(pincode, state, district) {name} appears twice, "
                       f"under district_lgd {seen_name[name]} and "
                       f"{row.district_lgd}")
        else:
            seen_name[name] = row.district_lgd
    return out


# ── R2 ───────────────────────────────────────────────────────────────────────

async def _r2() -> tuple:
    """(client, bucket, key_prefix) for the PLATFORM bucket, or (None, None, "").

    `org_id=None` is load-bearing and not a placeholder: it is what makes
    `_resolve_r2` answer with the platform bucket under `shared/`. The refusal
    below mirrors `pin_boundaries._r2` and `scripts/upload_pincode_boundaries`:
    if `_resolve_r2(None)` ever starts answering with an org prefix, this would
    read a tenant's namespace, and a read that quietly changes which tenant's
    bucket it points at is worth six lines to prevent.
    """
    client, bucket, key_prefix = await storage._resolve_r2(None)
    if client is None:
        return None, None, ""
    if key_prefix != "shared/":
        log.error("PIN directory: _resolve_r2(None) gave key_prefix %r, not "
                  "'shared/'. Refusing to read reference data out of an org "
                  "prefix.", key_prefix)
        return None, None, ""
    return client, bucket, key_prefix


async def fetch_csv(vintage: str = VINTAGE) -> tuple[str, str, int]:
    """`(text, sha256, bytes)` for that vintage's CSV. Raises; does not return None.

    RAISES RATHER THAN ANSWERING `None`, deliberately, and it is the one place
    this module departs from `pin_boundaries`. There, a failed read is a real
    answer a customer must be able to act on — `unavailable`, not `unmatched`.
    Here there is no customer and no partial answer worth having: an operator
    ran a command, and either 20,144 audited rows arrive or nothing should be
    written. `storage.download_file` is not used for the same reason it is not
    used by the boundary reader — it returns `None` for a missing key and for a
    dead bucket alike, so the message would not say which happened.

    The digest is checked against `KNOWN_DIGESTS` here rather than by the
    caller, so there is no path into this data that skips it.
    """
    client, bucket, key_prefix = await _r2()
    if client is None:
        raise RuntimeError(
            "R2 is not configured in this environment. Run this under "
            "`railway run -e staging -s Kartavya`.")

    key = f"{key_prefix}{object_key(vintage)}"
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
        body = obj["Body"].read()
    except Exception as exc:                                   # noqa: BLE001
        # Re-raised rather than propagated raw, because botocore's `NoSuchKey`
        # says the key and not what it was for. The vintage IS a segment of the
        # key, so the overwhelmingly likely cause is a `--vintage` that has
        # never been uploaded, and the message should say so.
        raise RuntimeError(
            f"could not read {bucket}/{key}: {exc}. The vintage is a segment of "
            f"that key -- if {vintage!r} was never uploaded, this is what that "
            f"looks like.") from exc
    digest = hashlib.sha256(body).hexdigest()

    expected = KNOWN_DIGESTS.get(vintage)
    if expected is None:
        raise RuntimeError(
            f"vintage {vintage!r} has no digest in pin_directory.KNOWN_DIGESTS. "
            f"The object at {bucket}/{key} is {len(body)} bytes, sha256 "
            f"{digest}. Add it to KNOWN_DIGESTS once somebody has checked the "
            f"file, rather than loading bytes nobody has looked at.")
    if digest != expected:
        raise RuntimeError(
            f"{bucket}/{key} is sha256 {digest}, expected {expected}. A vintage "
            f"is never rewritten in place, so this is either the wrong key or "
            f"the object changed. REFUSING to load it.")

    # utf-8-sig: the government's export carries a BOM, and a BOM left on the
    # front of the header makes the first column name '﻿pincode', which
    # fails EXPECTED_HEADER with a message nobody can read.
    return body.decode("utf-8-sig"), digest, len(body)


# ── The two statements. PREPAREd by tests/test_pin_directory.py ──────────────

#: ONE ROUND TRIP PER CHUNK, via `unnest` of six parallel text arrays, rather
#: than 20,144 INSERTs or an `executemany`. Every parameter carries an explicit
#: `::text[]` cast and `$7` an explicit `::text`: PgBouncer turns an untyped
#: parse error into an instant 500, and while nothing here is on a request path,
#: the statement is also what a later reader will copy.
#:
#: `blocks` travels as TEXT and is cast `::jsonb` in the SELECT, not bound as
#: jsonb. A bare `asyncpg.connect()` — which is what every `railway run` script
#: and every live test uses — has none of `db.py`'s codecs registered, so a
#: Python list bound to a jsonb parameter is a type error there and works when
#: pooled. Text plus a cast behaves identically on both, and the cast is what
#: refuses malformed JSON.
#:
#: ── THE CONFLICT TARGET, AND THE `WHERE` THAT MAKES A RE-RUN A NO-OP ────────
#:
#: `(pincode, district_lgd)` and NOT `(pincode)`. A PIN is not unique: 1,229 of
#: 18,839 span two or more districts and 51 span two or more STATES. `ON
#: CONFLICT (pincode) DO NOTHING` would not error — it would keep whichever
#: district arrived first and drop the rest in silence.
#:
#: The `WHERE ... IS DISTINCT FROM` on the DO UPDATE is what makes idempotence
#: observable rather than merely true. Without it a second run "updates" 20,144
#: rows, stamps every `updated_at` and reports a number that looks like work.
#: With it, a re-run against an unchanged source touches nothing and says so.
#: `IS DISTINCT FROM` and not `<>`, because `<>` is NULL when either side is and
#: a NULL comparison would skip the update instead of performing it.
UPSERT_SQL = """
INSERT INTO staging.pin_directory AS d
       (pincode, state, district, blocks, state_lgd, district_lgd,
        source_vintage)
SELECT t.pincode, t.state, t.district, t.blocks::jsonb, t.state_lgd,
       t.district_lgd, $7::text
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
              $6::text[])
       AS t(pincode, state, district, blocks, state_lgd, district_lgd)
    ON CONFLICT (pincode, district_lgd) DO UPDATE
   SET state          = EXCLUDED.state,
       district       = EXCLUDED.district,
       blocks         = EXCLUDED.blocks,
       state_lgd      = EXCLUDED.state_lgd,
       source_vintage = EXCLUDED.source_vintage,
       updated_at     = NOW()
 WHERE d.state          IS DISTINCT FROM EXCLUDED.state
    OR d.district       IS DISTINCT FROM EXCLUDED.district
    OR d.blocks         IS DISTINCT FROM EXCLUDED.blocks
    OR d.state_lgd      IS DISTINCT FROM EXCLUDED.state_lgd
    OR d.source_vintage IS DISTINCT FROM EXCLUDED.source_vintage
"""

#: PHASE-7 §7.2's acceptance, as one statement, so the loader reads back exactly
#: what the plan asks for instead of an operator retyping it. The two `state_lgd`
#: probes are the padding, read out of the COLUMN rather than out of the CSV:
#: they are the only proof that what survived the round trip is `'07'`.
SUMMARY_SQL = """
SELECT count(*)                                        AS row_count,
       count(DISTINCT pincode)                         AS pin_count,
       count(*) FILTER (WHERE pincode = '110003')      AS pin_110003,
       (SELECT count(DISTINCT state) FROM staging.pin_directory
         WHERE pincode = '110025')                     AS states_for_110025,
       (SELECT min(state_lgd) FROM staging.pin_directory
         WHERE state = 'DELHI')                        AS delhi_state_lgd,
       (SELECT min(district_lgd) FROM staging.pin_directory
         WHERE pincode = '110001')                     AS newdelhi_district_lgd,
       count(*) FILTER (WHERE source_vintage <> $1::text) AS other_vintage
  FROM staging.pin_directory
"""


# ── The load ─────────────────────────────────────────────────────────────────

class LoadResult(NamedTuple):
    """What the load did, in terms an operator can check against the plan."""
    before: int
    after: int
    touched: int       #: rows the upsert inserted OR updated
    inserted: int      #: after - before
    updated: int       #: touched - inserted
    unchanged: int     #: rows the `IS DISTINCT FROM` guard skipped


async def load(conn, rows, vintage: str = VINTAGE) -> LoadResult:
    """Upsert every row, in ONE transaction. Must be handed a CONNECTION.

    ── WHY ONE TRANSACTION, WHICH IS THE ANSWER TO "WHAT IF IT DIES HALFWAY" ──

    All 20,144 rows are inside a single `conn.transaction()`, so there is no
    halfway state to be left in: the load either lands whole or the table is
    exactly as it was. A container restart, a dropped connection or a bad row in
    chunk nine all end the same way, and nobody has to work out which chunks got
    through. 20,144 short rows is a small enough write that this costs nothing —
    the whole table is under 2 MB.

    A Pool will not do: `conn.transaction()` is a Connection method. The loader
    script opens a bare `asyncpg.connect()`, which is also why every statement
    above is written to work without `db.py`'s codecs.

    `execute()` returns the command status — `INSERT 0 <n>` — where n counts the
    rows actually inserted or updated and EXCLUDES those the `DO UPDATE ...
    WHERE` guard skipped. That is a documented number, which is why it is used
    in preference to the `RETURNING (xmax = 0)` trick for telling an insert from
    an update: the trick works, but it rests on undocumented tuple visibility,
    and `before`/`after` counts answer the same question from facts.
    """
    rows = list(rows)
    before = await conn.fetchval("SELECT count(*) FROM staging.pin_directory")

    touched = 0
    async with conn.transaction():
        for start in range(0, len(rows), CHUNK):
            chunk = rows[start:start + CHUNK]
            status = await conn.execute(
                UPSERT_SQL,
                [r.pincode for r in chunk],
                [r.state for r in chunk],
                [r.district for r in chunk],
                [r.blocks for r in chunk],
                [r.state_lgd for r in chunk],
                [r.district_lgd for r in chunk],
                vintage,
            )
            # "INSERT 0 1998" -> 1998. A status this code cannot parse is a
            # protocol change, not something to guess at.
            parts = status.split()
            if len(parts) != 3 or parts[0] != "INSERT":
                raise RuntimeError(f"unexpected command status {status!r}")
            touched += int(parts[2])

    after = await conn.fetchval("SELECT count(*) FROM staging.pin_directory")
    inserted = after - before
    return LoadResult(before=before, after=after, touched=touched,
                      inserted=inserted, updated=touched - inserted,
                      unchanged=len(rows) - touched)
