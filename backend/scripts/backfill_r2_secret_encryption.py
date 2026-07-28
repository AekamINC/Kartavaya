"""Encrypt the R2 secret access keys already stored in plaintext.

NOT RUN AUTOMATICALLY. Run by hand, once, per environment.

    python -m scripts.backfill_r2_secret_encryption --dry-run
    python -m scripts.backfill_r2_secret_encryption --commit

Run from `backend/`, not the repo root, and install the dependencies first
(`pip install -r requirements.txt`) or this fails on `import asyncpg`.

WHY: `organisations.r2_secret_access_key` is a Cloudflare R2 credential. In the
clear, a database dump or a leaked read-only connection string yields WRITE
access to every org's file storage. The write paths now encrypt
(`routers/admin_orgs.py`, both the create and update routes) and the read path
decrypts (`services/storage.py`), so new and updated rows are already covered.
This handles the rows that predate that.

SAFE TO DEPLOY BEFORE RUNNING: `decrypt()` passes unmarked values straight
through, so plaintext rows keep working until this runs. There is no ordering
requirement between the deploy and the backfill.

NOT TOUCHED, deliberately:
  · `verify_r2_credentials` in admin_orgs.py sends the secret to Cloudflare to
    test it. That must stay plaintext — it is outbound, not at rest.
  · every `*_key` column (`file_key`, `logo_key`, `object_key`, `photo_key`,
    `resume_key`, `results_r2_key`, `evidence_key`, `signed_file_key`) is an R2
    OBJECT PATH, not a secret. They are the lookup path; encrypting them breaks
    file retrieval outright.
  · `varta_business_accounts.webhook_verify_token` is queried by EQUALITY
    (`WHERE webhook_verify_token=$1`). Fernet ciphertext is randomised, so
    encrypting it would break that lookup permanently.

FIELD_ENCRYPTION_KEY must be set. The script refuses the JWT_SECRET fallback,
because a backfill under it ties the data to the auth secret and rotating that
secret would destroy it with no error at rotation time.
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_pool                                      # noqa: E402
from services.encryption import PREFIX, encrypt, key_source  # noqa: E402

TABLE = "staging.organisations"
COLUMN = "r2_secret_access_key"


async def run(commit: bool) -> int:
    if not os.getenv("FIELD_ENCRYPTION_KEY") or key_source() != "FIELD_ENCRYPTION_KEY":
        print(
            "REFUSING TO RUN: FIELD_ENCRYPTION_KEY is not set.\n\n"
            "Without it, services.encryption falls back to JWT_SECRET. Every\n"
            "value written here would then share its fate with the auth secret,\n"
            "and rotating that secret would destroy them silently — it fails on\n"
            "READ, long after the rotation.\n\n"
            "Set FIELD_ENCRYPTION_KEY, store it somewhere durable (there is no\n"
            "re-key path), and run again."
        )
        return 2

    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT id, {COLUMN} FROM {TABLE} "
        f"WHERE {COLUMN} IS NOT NULL AND btrim({COLUMN}) <> '' "
        f"  AND {COLUMN} NOT LIKE $1",
        PREFIX + "%",
    )
    total = await pool.fetchval(f"SELECT count(*) FROM {TABLE}")

    print(f"{TABLE}.{COLUMN}")
    print(f"  orgs in table        : {total}")
    print(f"  plaintext to encrypt : {len(rows)}")
    print(f"  key source           : {key_source()}")

    if not rows:
        print("\nNothing to do.")
        return 0
    if not commit:
        print("\nDRY RUN — nothing written. Values are not printed, by design.")
        return 0

    for row in rows:
        await pool.execute(
            f"UPDATE {TABLE} SET {COLUMN}=$2 WHERE id=$1::uuid",
            str(row["id"]), encrypt(row[COLUMN]),
        )

    left = await pool.fetchval(
        f"SELECT count(*) FROM {TABLE} "
        f"WHERE {COLUMN} IS NOT NULL AND btrim({COLUMN}) <> '' "
        f"  AND {COLUMN} NOT LIKE $1",
        PREFIX + "%",
    )
    print(f"\n  encrypted            : {len(rows)}")
    print(f"  still plaintext      : {left}   <- must be 0")

    print(
        "\nNOW VERIFY THE ROUND TRIP before trusting this: open any page that\n"
        "loads a file for one of these orgs. If storage stops working, the\n"
        "decrypt path is wrong and the plaintext is already gone — which is why\n"
        "the dry run exists."
    )
    return 0 if left == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    g.add_argument("--commit", action="store_true", help="apply the backfill")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(run(commit=args.commit)))
