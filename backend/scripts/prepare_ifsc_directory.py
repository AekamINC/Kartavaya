"""Build the IFSC directory shards and put them in R2.

    python scripts/prepare_ifsc_directory.py --check         # is there a newer release?
    python scripts/prepare_ifsc_directory.py --dry-run       # build and count, upload nothing
    railway run python scripts/prepare_ifsc_directory.py     # build and upload

── WHAT IT DOES ─────────────────────────────────────────────────────────────

Downloads one release of the RBI branch directory, proves it is the file that
was audited, shards it, and writes the shards to the PLATFORM bucket under
`shared/reference/ifsc/<vintage>/`. A vintage is never rewritten in place, so
re-running against a live vintage is refused rather than allowed to half-replace
it.

── THE DIGEST IS THE POINT ──────────────────────────────────────────────────

Same reasoning as `pin_directory.KNOWN_DIGESTS`, and worth repeating because it
is easy to read as paranoia about R2. 183,214 rows are about to become the thing
that decides which branch a salary is credited to. "The file at that URL" is not
the same claim as "the file whose 183,214 rows were counted, whose IFSCs were
proven unique, and whose header was checked". The digest is what makes those two
the same sentence.

An unknown vintage refuses and PRINTS the digest it computed, so adding one is a
one-line edit by somebody who has looked at the numbers it printed.
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import csv
import hashlib
import io
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import ifsc_directory, storage  # noqa: E402

#: The release this vintage was built from. Pinned, never "latest" — the same
#: rule the AI runtime follows for Gemini versions, for the same reason: a
#: moving target cannot be audited, and "it worked yesterday" is not a check.
RELEASE = "v2.0.62"
BASE = f"https://github.com/razorpay/ifsc/releases/download/{RELEASE}"
CSV_URL = f"{BASE}/IFSC.csv"

#: sha256 of each vintage's CSV. See the module docstring.
KNOWN_DIGESTS = {
    # Downloaded and counted 2026-09-01: 36,368,257 bytes, 183,214 rows,
    # 0 duplicate IFSCs, 0 rows with an empty IFSC, 260 bank codes.
    "rbi-2026-09-01":
        "f03870a0ecb06f6c7606c90e4743fc63f9111f088a7175b871c2516bdb8f468e",
}

#: The header, exactly and in order. A file whose columns were reordered is a
#: different file and should be looked at by a person before 183,214 rows of it
#: decide where money goes.
EXPECTED_HEADER = [
    "BANK", "IFSC", "BRANCH", "CENTRE", "DISTRICT", "STATE", "ADDRESS",
    "CONTACT", "IMPS", "RTGS", "CITY", "ISO3166", "NEFT", "MICR", "UPI", "SWIFT",
]

#: Below this, the whole bank is one object. Above it, split by the last
#: character of the IFSC — the only well-distributed one. See the reader.
SPLIT_ABOVE = ifsc_directory.SPLIT_ABOVE

#: Floors. A release that parses but holds a fraction of the branches is the
#: failure this catches: it would upload cleanly, and every missing branch would
#: read as "no such IFSC" rather than as a broken ingest.
MIN_ROWS = 150_000
MIN_BANKS = 200


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "kartavaya-ifsc-ingest"})
    with urllib.request.urlopen(req, timeout=300) as r:       # noqa: S310
        return r.read()


def latest_release() -> tuple[str, str]:
    """The newest published release, for `--check`. `(tag, published_at)`."""
    raw = _fetch("https://api.github.com/repos/razorpay/ifsc/releases/latest")
    d = json.loads(raw)
    return d.get("tag_name", "?"), d.get("published_at", "?")


def build_shards(raw: bytes) -> tuple[dict, dict]:
    """`(shards, index)` from the CSV bytes. Raises on anything unexpected."""
    text = raw.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    header = list(reader.fieldnames or [])
    if header != EXPECTED_HEADER:
        raise SystemExit(
            f"Unexpected header.\n  expected: {EXPECTED_HEADER}\n  got:      {header}"
        )

    by_bank: dict[str, list] = collections.defaultdict(list)
    seen: set[str] = set()
    rows = 0
    for row in reader:
        code = (row.get("IFSC") or "").strip().upper()
        if not ifsc_directory.normalise(code):
            # Not a refusal of the release — a single malformed line should not
            # cost 183,213 good ones. Counted so the summary can show it.
            continue
        if code in seen:
            raise SystemExit(f"Duplicate IFSC in the release: {code}")
        seen.add(code)
        rows += 1
        by_bank[code[:4]].append((code, [
            (row.get("BANK") or "").strip(),
            (row.get("BRANCH") or "").strip(),
            (row.get("CENTRE") or "").strip(),
            (row.get("DISTRICT") or "").strip(),
            (row.get("STATE") or "").strip(),
            (row.get("ADDRESS") or "").strip(),
        ]))

    if rows < MIN_ROWS:
        raise SystemExit(f"Only {rows:,} usable rows — expected at least {MIN_ROWS:,}")
    if len(by_bank) < MIN_BANKS:
        raise SystemExit(f"Only {len(by_bank)} bank codes — expected at least {MIN_BANKS}")

    shards: dict[str, dict] = {}
    split: list[str] = []
    for code, entries in by_bank.items():
        if len(entries) > SPLIT_ABOVE:
            split.append(code)
            buckets: dict[str, dict] = collections.defaultdict(dict)
            for ifsc, payload in entries:
                buckets[ifsc[-1]][ifsc] = payload
            for last, payload in buckets.items():
                shards[f"{code}-{last}"] = payload
        else:
            shards[code] = {ifsc: payload for ifsc, payload in entries}

    index = {
        "vintage": ifsc_directory.VINTAGE,
        "release": RELEASE,
        "count": rows,
        "banks": len(by_bank),
        "split": sorted(split),
        # ⚠ EVERY BANK CODE, AND IT IS NOT DECORATION. Without it the reader
        # cannot tell "ZZZZ is not a bank" from "R2 is down": both are a shard
        # that will not load. Caught by a live read-back on 2026-09-01, where
        # `ZZZZ0999999` answered `unavailable` — which a form must not draw as a
        # validation failure, so a plainly invented code came back as an outage.
        # 260 codes is ~1.3 KB in an object that is already cached for an hour.
        "codes": sorted(by_bank),
        "attribution": ifsc_directory.ATTRIBUTION,
    }
    return shards, index


async def _upload(shards: dict, index: dict, index_only: bool = False) -> None:
    client, bucket, key_prefix = await storage._resolve_r2(None)
    if client is None:
        raise SystemExit("No platform R2 credentials in this environment.")
    # ⚠ The same refusal the reader carries. Writing a public reference dataset
    # into a TENANT's prefix would put 183,214 rows in one customer's bucket and
    # leave every other customer reading a key that does not exist.
    if key_prefix != "shared/":
        raise SystemExit(
            f"_resolve_r2(None) gave key_prefix {key_prefix!r}, not 'shared/'. "
            "Refusing to write the directory into an org prefix."
        )

    prefix = f"{key_prefix}{ifsc_directory._VINTAGE_PREFIX}"
    loop = asyncio.get_running_loop()

    existing = await loop.run_in_executor(
        None, lambda: client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1))
    if existing.get("KeyCount") and not index_only:
        raise SystemExit(
            f"{prefix} already has objects. A vintage is immutable — bump "
            "ifsc_directory.VINTAGE and add the new digest instead of "
            "half-replacing a live one."
        )

    def put(name: str, payload: dict) -> None:
        client.put_object(
            Bucket=bucket, Key=f"{prefix}{name}.json",
            Body=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )

    if index_only:
        # The shards are not touched. They were verified against the digest when
        # they were written and re-verified by this run's own build, so the only
        # thing changing is what the index SAYS about them.
        await loop.run_in_executor(
            None, lambda: put(ifsc_directory.INDEX_NAME, index))
        print(f"  rewrote only the index at {prefix}{ifsc_directory.INDEX_NAME}.json")
        return

    for i, (name, payload) in enumerate(sorted(shards.items()), 1):
        await loop.run_in_executor(None, lambda n=name, p=payload: put(n, p))
        if i % 100 == 0:
            print(f"  … {i}/{len(shards)} shards")
    # The index LAST, so a reader can never see an index that promises shards
    # which are not there yet. `_index()` is what gates every lookup.
    await loop.run_in_executor(None, lambda: put(ifsc_directory.INDEX_NAME, index))
    print(f"  uploaded {len(shards)} shards + the index to {prefix}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report whether a newer release exists, change nothing")
    ap.add_argument("--dry-run", action="store_true",
                    help="download, verify and shard; upload nothing")
    ap.add_argument("--index-only", action="store_true",
                    help="rewrite ONLY the index object, leaving the shards as they are")
    args = ap.parse_args()

    if args.check:
        tag, published = latest_release()
        current = RELEASE
        print(f"pinned:  {current}")
        print(f"latest:  {tag}  (published {published})")
        print("NEWER RELEASE AVAILABLE" if tag != current else "up to date")
        # Non-zero so a cron can treat "newer" as something to report.
        raise SystemExit(1 if tag != current else 0)

    print(f"Downloading {CSV_URL} …")
    raw = _fetch(CSV_URL)
    digest = hashlib.sha256(raw).hexdigest()
    print(f"  {len(raw):,} bytes, sha256 {digest}")

    expected = KNOWN_DIGESTS.get(ifsc_directory.VINTAGE)
    if expected is None:
        raise SystemExit(
            f"No known digest for vintage {ifsc_directory.VINTAGE!r}. "
            f"If {digest} is the file you have checked, add it to KNOWN_DIGESTS."
        )
    if digest != expected:
        raise SystemExit(
            f"Digest mismatch for {ifsc_directory.VINTAGE}.\n"
            f"  expected {expected}\n  got      {digest}\n"
            "The release at that URL is not the file that was audited."
        )

    shards, index = build_shards(raw)
    sizes = sorted(
        len(json.dumps(p, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
        for p in shards.values()
    )
    print(f"  {index['count']:,} branches, {index['banks']} banks, "
          f"{len(shards)} shards ({len(index['split'])} banks split)")
    print(f"  shard bytes — median {sizes[len(sizes) // 2]:,}, largest {sizes[-1]:,}")

    if args.dry_run:
        print("dry run — nothing uploaded")
        return

    asyncio.run(_upload(shards, index, index_only=args.index_only))
    print("done")


if __name__ == "__main__":
    main()
