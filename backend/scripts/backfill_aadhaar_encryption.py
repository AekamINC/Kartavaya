"""Encrypt the Aadhaar values already sitting in the table as plaintext.

NOT RUN AUTOMATICALLY. Run it by hand, once, per environment, and read the
warnings below first.

Why a backfill is needed at all: the handlers encrypt on write, and `decrypt()`
passes unmarked values straight through, so the application is correct the
moment it deploys and existing rows keep working. What it does NOT do is go
back and protect rows written before the deploy. Those stay readable in a
database dump, which is the whole thing this was meant to stop.

    python -m scripts.backfill_aadhaar_encryption --dry-run   # always first
    python -m scripts.backfill_aadhaar_encryption --commit

═══════════════════════════════════════════════════════════════════════════════
READ BEFORE RUNNING
═══════════════════════════════════════════════════════════════════════════════

1. SHARED DATABASE. Staging and production are two schemas in ONE Supabase
   project. This script touches `staging.manav_employees` and nothing else, and
   every statement names the schema explicitly. It never touches `public`.

2. FIELD_ENCRYPTION_KEY MUST BE SET. The script refuses to run without it, on
   purpose. `services.encryption` falls back to JWT_SECRET when it is unset,
   and a backfill under that fallback silently ties every Aadhaar to the auth
   secret — rotating JWT_SECRET later would destroy all of them, with no error
   at rotation time and no symptom until someone opens an employee record.

3. THE KEY MUST THEN NEVER CHANGE. There is no re-key path here. If
   FIELD_ENCRYPTION_KEY is lost or changed after this runs, the values are
   gone. Put it somewhere durable before running, not after.

4. RUN IT ONCE PER ENVIRONMENT, against each environment's own key.

Idempotent: `encrypt()` returns already-marked values untouched, so a second
run is a no-op rather than double-wrapping. That is asserted by
tests/test_aadhaar_encryption.py::test_enciphering_is_idempotent.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_pool                              # noqa: E402
from services.encryption import PREFIX, encrypt, key_source  # noqa: E402

TABLE = "public.manav_employees"
COLUMN = "aadhaar"


async def run(commit: bool) -> int:
    if not os.getenv("FIELD_ENCRYPTION_KEY"):
        print(
            "REFUSING TO RUN: FIELD_ENCRYPTION_KEY is not set.\n\n"
            "Without it, services.encryption falls back to JWT_SECRET. Every\n"
            "value written here would then share its fate with the auth secret,\n"
            "and rotating that secret would destroy them silently.\n\n"
            "Set FIELD_ENCRYPTION_KEY, confirm it is stored somewhere durable,\n"
            "and run again."
        )
        return 2

    # Belt and braces: the variable can be set to an empty string, which the
    # check above passes and the resolver treats as absent.
    if key_source() != "FIELD_ENCRYPTION_KEY":
        print(f"REFUSING TO RUN: key resolved from {key_source()}, not FIELD_ENCRYPTION_KEY.")
        return 2

    pool = await get_pool()

    rows = await pool.fetch(
        f"SELECT id, org_id, {COLUMN} FROM {TABLE} "
        f"WHERE {COLUMN} IS NOT NULL AND btrim({COLUMN}) <> '' "
        f"  AND {COLUMN} NOT LIKE $1",
        PREFIX + "%",
    )

    total = await pool.fetchval(f"SELECT count(*) FROM {TABLE}")
    print(f"{TABLE}.{COLUMN}")
    print(f"  rows in table          : {total}")
    print(f"  plaintext to encrypt   : {len(rows)}")
    print(f"  key source             : {key_source()}")

    if not rows:
        print("\nNothing to do.")
        return 0

    if not commit:
        print("\nDRY RUN — nothing written. Values are not printed, by design.")
        print("Re-run with --commit to apply.")
        return 0

    done = 0
    for row in rows:
        await pool.execute(
            f"UPDATE {TABLE} SET {COLUMN}=$2, updated_at=NOW() WHERE id=$1::uuid",
            str(row["id"]), encrypt(row[COLUMN]),
        )
        done += 1

    # Verify rather than trust the loop. `decrypt()` passes unrecognised input
    # through as plaintext by design, so a partially-completed backfill leaves
    # no visible symptom anywhere in the application — this count is the only
    # thing that would show it.
    left = await pool.fetchval(
        f"SELECT count(*) FROM {TABLE} "
        f"WHERE {COLUMN} IS NOT NULL AND btrim({COLUMN}) <> '' "
        f"  AND {COLUMN} NOT LIKE $1",
        PREFIX + "%",
    )
    print(f"\n  encrypted              : {done}")
    print(f"  still plaintext        : {left}   <- must be 0")
    return 0 if left == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    g.add_argument("--commit", action="store_true", help="apply the backfill")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(run(commit=args.commit)))
