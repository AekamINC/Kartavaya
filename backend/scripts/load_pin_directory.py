#!/usr/bin/env python
"""load_pin_directory.py — put the 20,144-row PIN directory in the table, once.

    cd backend && railway run -e staging -s Kartavya -- \\
        python scripts/load_pin_directory.py --dry-run
    cd backend && railway run -e staging -s Kartavya -- \\
        python scripts/load_pin_directory.py

Needs migration `233_pin_directory.sql` applied first; it says so and stops if
the table is not there.

WHY THIS IS A SCRIPT AND NOT A ROUTE
------------------------------------
Phase 7.1 put its backfill behind `POST /v1/graha/contacts/route-all`, gated
`is_org_admin`, and PHASE-7 records the reason as "a route not a migration,
because rewriting live rows should be something a person triggers and can read
the result of". Both halves of that reason are honoured here, and the second
half is why the shape is still different:

  · **That route rewrites the CALLING ORG'S OWN contacts.** An org admin
    triggering work scoped to their own tenant is exactly who should hold that
    button. `public.pin_directory` has NO `org_id` — it is one national
    dataset every tenant reads — so an `is_org_admin` route would let any one
    customer's admin reload platform-wide reference data underneath every other
    customer. That is not the same permission; it is a tenancy inversion.
  · **No customer ever needs this to run.** A route would add an authenticated,
    rate-limit-shaped HTTP surface that writes 20,144 rows and exists solely for
    an operator — an attack surface with no user, and one more path into a table
    whose whole value is that it is the government's data and not ours.
  · The property the plan actually wants — a person triggers it deliberately and
    reads the result — is precisely what `railway run` gives, and it is how the
    sibling dataset already got into R2
    (`scripts/upload_pincode_boundaries.py`).
  · It also keeps a 20,144-row write out of the request path. That is a
    long-held transaction on a database production shares, issued from a
    gunicorn worker on a 2 GB container through a PgBouncer pool in transaction
    mode. There is no reason for it to be there.

RE-RUNNING IS SAFE AND IS THE POINT
-----------------------------------
`services/pin_directory.UPSERT_SQL` conflicts on `(pincode, district_lgd)` and
its DO UPDATE is guarded `IS DISTINCT FROM`, so a second run against the same
vintage inserts nothing, updates nothing, stamps no timestamp and prints
`unchanged: 20144`. Running it twice does not produce 40,288 rows; running it
twice is how you CHECK the table.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import pin_directory as pd  # noqa: E402

#: PHASE-7 §7.2's acceptance, so the script checks the plan's numbers rather
#: than an operator reading them off a screen. A source that no longer matches
#: these is not necessarily wrong — the government may have published a new
#: vintage — but it IS a different file, and the digest check in `fetch_csv`
#: will already have refused it. These are belt and braces on a live write.
EXPECT_ROWS = 20144
EXPECT_PINS = 18839


def _table_missing_message() -> str:
    return ("public.pin_directory does not exist. Apply "
            "backend/migrations/233_pin_directory.sql first:\n"
            "    the migration creates the table, this script fills it, and "
            "they are deliberately separate -- see the migration header.")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vintage", default=pd.VINTAGE,
                    help=f"government release to load (default {pd.VINTAGE})")
    ap.add_argument("--dry-run", action="store_true",
                    help="read, parse and check everything; write nothing")
    args = ap.parse_args()

    # ── 1 · Read the source, digest-checked ──────────────────────────────────
    print(f"vintage: {args.vintage}")
    try:
        text, digest, size = await pd.fetch_csv(args.vintage)
    except Exception as exc:                                   # noqa: BLE001
        print(f"could not read the CSV: {exc}", file=sys.stderr)
        return 2
    print(f"read {size:,} bytes from R2, sha256 {digest[:16]}... (matches)")

    # ── 2 · Parse it, and refuse the whole file if anything is wrong ─────────
    rows, problems = pd.parse_rows(text)
    if problems:
        print(f"REFUSING: {len(problems)} problem(s) in the source. Nothing "
              f"has been written.", file=sys.stderr)
        for line in problems[:20]:
            print(f"  {line}", file=sys.stderr)
        if len(problems) > 20:
            print(f"  ... and {len(problems) - 20} more", file=sys.stderr)
        return 3

    collisions = pd.key_collisions(rows)
    if collisions:
        # Caught here rather than as a UniqueViolationError two thirds of the
        # way through the transaction, which would name one row and not its
        # partner and roll everything back to say so.
        print(f"REFUSING: {len(collisions)} key collision(s). Migration 233 "
              f"enforces both keys, so this file cannot load as it stands.",
              file=sys.stderr)
        for line in collisions[:10]:
            print(f"  {line}", file=sys.stderr)
        return 4

    pins = len({r.pincode for r in rows})
    print(f"parsed {len(rows):,} rows, {pins:,} distinct PINs, "
          f"0 key collisions on either key")
    if len(rows) != EXPECT_ROWS or pins != EXPECT_PINS:
        # Not fatal by itself -- a new vintage legitimately has new numbers --
        # but it is never a thing to notice AFTER the write.
        print(f"  NOTE: PHASE-7 7.2 expects {EXPECT_ROWS:,} rows and "
              f"{EXPECT_PINS:,} PINs for {pd.VINTAGE}. This source differs; "
              f"check that the vintage is the one you meant.")

    # The two facts that would be invisible in a row count and are the whole
    # reason the schema looks the way it does.
    padded = sum(1 for r in rows if r.state_lgd.startswith("0"))
    states_of: dict = {}
    districts_of: dict = {}
    for r in rows:
        states_of.setdefault(r.pincode, set()).add(r.state)
        districts_of.setdefault(r.pincode, set()).add(r.district)
    multi_state = sum(1 for s in states_of.values() if len(s) > 1)
    multi_district = sum(1 for d in districts_of.values() if len(d) > 1)
    print(f"  {padded:,} rows carry a zero-padded state_lgd (e.g. '07'), "
          f"still TEXT")
    print(f"  {multi_district:,} PINs span more than one district; "
          f"{multi_state} do not resolve to a single state")

    if args.dry_run:
        print("dry run: nothing written.")
        return 0

    # ── 3 · Write, in one transaction ────────────────────────────────────────
    import asyncpg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set. Run this under "
              "`railway run -e staging -s Kartavya`.", file=sys.stderr)
        return 2

    # statement_cache_size=0 because the connection goes through PgBouncer in
    # transaction mode, where a cached server-side statement belongs to a
    # session that will not be there next time.
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        exists = await conn.fetchval(
            "SELECT to_regclass('pin_directory') IS NOT NULL")
        if not exists:
            print(_table_missing_message(), file=sys.stderr)
            return 5

        print(f"writing {len(rows):,} rows in one transaction "
              f"({pd.CHUNK:,} per statement) ...")
        result = await pd.load(conn, rows, args.vintage)
        print(f"  before {result.before:,} -> after {result.after:,}")
        print(f"  inserted {result.inserted:,} | updated {result.updated:,} | "
              f"unchanged {result.unchanged:,}")

        # ── 4 · Read the acceptance back OUT OF THE DATABASE ─────────────────
        # Not out of the CSV, and not out of the numbers above: the only thing
        # that proves the padding survived the round trip is reading the column.
        s = await conn.fetchrow(pd.SUMMARY_SQL, args.vintage)
        print("live read-back:")
        print(f"  count(*)                     {s['row_count']:,}   "
              f"(PHASE-7 7.2 expects {EXPECT_ROWS:,})")
        print(f"  count(DISTINCT pincode)      {s['pin_count']:,}   "
              f"(expects {EXPECT_PINS:,})")
        print(f"  rows for 110003              {s['pin_110003']}       "
              f"(expects 3)")
        print(f"  distinct states for 110025   {s['states_for_110025']}       "
              f"(expects 2 - Delhi AND Uttar Pradesh)")
        print(f"  state_lgd for DELHI          {s['delhi_state_lgd']!r}    "
              f"(expects '07', NOT '7')")
        print(f"  district_lgd for 110001      "
              f"{s['newdelhi_district_lgd']!r}   (expects '094', NOT '94')")
        if s["other_vintage"]:
            # Never deleted here. A row the new release did not mention is a
            # fact about the release, and deciding what to do with it is not a
            # thing a loader should do on its own.
            print(f"  WARNING: {s['other_vintage']:,} rows still carry an older "
                  f"source_vintage. They were NOT deleted.")

        ok = (s["row_count"] == EXPECT_ROWS and s["pin_count"] == EXPECT_PINS
              and s["pin_110003"] == 3 and s["states_for_110025"] == 2
              and s["delhi_state_lgd"] == "07"
              and s["newdelhi_district_lgd"] == "094")
        print("ACCEPTANCE: " + ("PASS" if ok else "FAIL - read the lines above"))
        return 0 if ok else 6
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
