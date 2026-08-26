#!/usr/bin/env python
"""upload_pincode_boundaries.py — put the PIN boundary shards in R2, once.

    railway run -e staging -s Kartavya -- \\
        python backend/scripts/upload_pincode_boundaries.py --src backend/data/pincode_boundaries

Re-run it only when `prepare_pincode_boundaries.py` has produced a new vintage.
Objects are overwritten in place, so a re-run is idempotent.

WHY THE PLATFORM BUCKET, AND NEVER AN ORG BUCKET
------------------------------------------------
Every org can bring its own R2 credentials, and `services/storage.py` then
writes that org's files to that org's bucket. PIN code boundaries are the
opposite kind of object: **one public government dataset, identical for every
tenant, owned by none of them.** Copying 18.5MB into each org's bucket would
mean paying for it N times, refreshing it N times, and — the real cost — an org
that has not configured R2 would have no map at all.

`_resolve_r2(None)` already resolves to the platform bucket under the `shared/`
prefix, which exists for precisely this: an object with no org. So this script
passes no org id, ever. If you find yourself adding an `--org` flag here, the
requirement has been misread.

WHY THE KEYS SIT OUTSIDE THE `storage_keys.py` GRAMMAR
-------------------------------------------------------
That grammar is `module/{what}/{who}/{date}/{ulid}--{filename}` and it is built
for files a person uploaded: it wants an owning entity, an acting user and a
date partition for retention sweeps. None of those exist here. Nobody uploaded
this, it belongs to no entity, and it must never be swept.

So reference data gets its own flat namespace, deliberately:

    shared/reference/pincode-boundaries/{vintage}/{prefix}.json

The vintage segment is what makes a refresh safe. A new government release lands
beside the old one and the reader is repointed by changing one constant, so a
half-finished upload can never leave the map reading a mix of two vintages.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import storage  # noqa: E402

#: Bump this when the government publishes a new boundary release, then change
#: the same constant in the reader. Never overwrite a vintage in place.
VINTAGE = "datagov-2025-05"

PREFIX = f"reference/pincode-boundaries/{VINTAGE}/"


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True, help="directory of {prefix}.json shards")
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would be uploaded and exit")
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        print(f"not a directory: {args.src}", file=sys.stderr)
        return 1

    shards = sorted(f for f in os.listdir(args.src) if f.endswith(".json"))
    if not shards:
        print(f"no .json shards in {args.src}", file=sys.stderr)
        return 1

    total = sum(os.path.getsize(os.path.join(args.src, f)) for f in shards)
    print(f"{len(shards)} shards, {total / 1_048_576:.1f} MB")
    print(f"destination: <platform bucket>/shared/{PREFIX}")

    # org_id=None is the whole point — see the module docstring.
    client, bucket, key_prefix = await storage._resolve_r2(None)
    if client is None:
        print("R2 is not configured in this environment. Run under "
              "`railway run -e staging -s Kartavya`.", file=sys.stderr)
        return 2
    print(f"bucket={bucket} key_prefix={key_prefix!r}")

    if key_prefix != "shared/":
        print(f"REFUSING: expected key_prefix 'shared/', got {key_prefix!r}. "
              "This script must never write into an org prefix.", file=sys.stderr)
        return 3

    if args.dry_run:
        for f in shards[:5]:
            print(f"  would put {key_prefix}{PREFIX}{f}")
        print(f"  … and {max(0, len(shards) - 5)} more")
        return 0

    done = 0
    for name in shards:
        with open(os.path.join(args.src, name), "rb") as fh:
            body = fh.read()
        client.put_object(
            Bucket=bucket,
            Key=f"{key_prefix}{PREFIX}{name}",
            Body=body,
            ContentType="application/json",
            # Immutable by construction: a vintage is never rewritten, so the
            # reader can cache a shard for as long as it likes.
            CacheControl="public, max-age=31536000, immutable",
        )
        done += 1
        if done % 10 == 0 or done == len(shards):
            print(f"  {done}/{len(shards)}")

    print(f"uploaded {done} shards to shared/{PREFIX}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
