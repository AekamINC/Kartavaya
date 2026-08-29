#!/usr/bin/env python
"""apply_235_drop_sales_territory_stack.py — apply migration 235, once.

    cd backend && railway run -e staging -s Kartavya -- \\
        python scripts/apply_235_drop_sales_territory_stack.py --dry-run
    cd backend && railway run -e staging -s Kartavya -- \\
        python scripts/apply_235_drop_sales_territory_stack.py

WHAT THIS IS FOR
----------------
The migration is DDL against a database production shares. Three properties are
worth a script rather than pasting SQL into a console:

  · **The guard's NOTICEs must be READ.** Migration 235 re-counts every table
    inside the transaction and RAISEs NOTICE with each number. Those notices are
    the evidence that the drop was justified at the moment it happened rather
    than at the moment it was audited. asyncpg discards notices unless something
    listens, so this script listens and prints every one.
  · **`--dry-run` runs the entire migration and then ROLLS BACK.** Every guard
    executes against live state, the DROP is planned and executed, and nothing
    survives. It is the only way to find out that the guards pass without
    finding out by dropping the tables.
  · **Verification is a SEPARATE connection, opened after the commit.** Reading
    back on the same connection inside the same transaction proves nothing about
    what was committed.

`statement_cache_size=0` throughout: the connection goes through PgBouncer in
transaction mode, where a cached server-side statement belongs to a session that
will not be there next time.

A post-commit verification that THROWS does not mean the migration failed
(`memory/mcp_denial_may_still_execute`). If the read-back errors, re-read the
state before concluding anything.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
MIGRATION = os.path.join(BACKEND, "migrations",
                         "235_drop_sales_territory_stack.sql")

NAMES = ["sales_territories", "sales_targets", "sales_routing_rules"]
SCHEMAS = ["staging", "public"]


def _listen(conn) -> None:
    conn.add_log_listener(
        lambda _c, msg: print(f"    [postgres {msg.severity}] {msg.message}"))


async def _state(conn) -> dict:
    """Everything the report needs, read-only."""
    out: dict = {"tables": {}, "trigger": None, "function": None}
    for s in SCHEMAS:
        for n in NAMES:
            q = f"{s}.{n}"
            exists = await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", q)
            count = None
            if exists:
                count = await conn.fetchval(f'SELECT count(*) FROM "{s}"."{n}"')
            out["tables"][q] = (bool(exists), count)
    out["trigger"] = await conn.fetchval(
        "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE NOT t.tgisinternal AND t.tgname = 'trg_stg_deal_close_target' "
        "AND n.nspname = ANY(current_schemas(false)) AND c.relname = 'crm_deals'")
    out["function"] = await conn.fetchval(
        "SELECT count(*) FROM pg_proc p JOIN pg_namespace n "
        "ON n.oid = p.pronamespace WHERE n.nspname = ANY(current_schemas(false)) "
        "AND p.proname = 'sales_update_target_on_deal_close'")
    # Must SURVIVE: shared by 27 triggers across the schema.
    out["touch_updated_at"] = await conn.fetchval(
        "SELECT count(*) FROM pg_proc p JOIN pg_namespace n "
        "ON n.oid = p.pronamespace WHERE n.nspname = ANY(current_schemas(false)) "
        "AND p.proname = 'touch_updated_at'")
    out["crm_deals"] = await conn.fetchval(
        "SELECT count(*) FROM staging.crm_deals") \
        if await conn.fetchval(
            "SELECT to_regclass('crm_deals') IS NOT NULL") else None
    return out


def _print_state(label: str, st: dict) -> None:
    print(f"  {label}")
    for q, (exists, count) in st["tables"].items():
        if exists:
            print(f"    {q:34s} EXISTS   count(*) = {count}")
        else:
            print(f"    {q:34s} absent")
    print(f"    trg_stg_deal_close_target on staging.crm_deals : "
          f"{st['trigger']}")
    print(f"    staging.sales_update_target_on_deal_close()    : "
          f"{st['function']}")
    print(f"    staging.touch_updated_at()  [MUST STAY = 1]    : "
          f"{st['touch_updated_at']}")
    print(f"    staging.crm_deals count(*)  [MUST NOT CHANGE]  : "
          f"{st['crm_deals']}")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="run the whole migration, then ROLL BACK")
    args = ap.parse_args()

    if not os.path.exists(MIGRATION):
        print(f"missing: {MIGRATION}", file=sys.stderr)
        return 2
    with open(MIGRATION, "r", encoding="utf-8") as fh:
        sql = fh.read()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is not set. Run this under "
              "`railway run -e staging -s Kartavya`.", file=sys.stderr)
        return 2

    import asyncpg

    mode = "DRY RUN (rolls back)" if args.dry_run else "APPLY (commits)"
    print(f"migration : {os.path.basename(MIGRATION)}")
    print(f"mode      : {mode}")
    print("NOTE: staging and production share this database. This is DDL.\n")

    # ── BEFORE, on its own connection ────────────────────────────────────────
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        before = await _state(conn)
        print("=== BEFORE ===")
        _print_state("(read on a connection of its own)", before)
    finally:
        await conn.close()

    live = [q for q, (e, _) in before["tables"].items() if e]
    if not live:
        print("\nAll three are already absent. Nothing to do.")
        return 0
    nonempty = [q for q, (e, c) in before["tables"].items() if e and c]
    if nonempty:
        print(f"\nREFUSING before opening a transaction: {nonempty} hold rows. "
              f"The migration's own guard would abort too; this just says so "
              f"without taking a lock.", file=sys.stderr)
        return 3

    # ── RUN, in ONE transaction ──────────────────────────────────────────────
    print("\n=== RUNNING (one transaction) ===")
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    rolled_back = False
    try:
        _listen(conn)
        tx = conn.transaction()
        await tx.start()
        try:
            await conn.execute(sql)
            inside = await _state(conn)
            print("  in-transaction read (NOT yet committed):")
            for q, (e, c) in inside["tables"].items():
                print(f"    {q:34s} {'EXISTS' if e else 'absent'}")
            if args.dry_run:
                await tx.rollback()
                rolled_back = True
                print("  DRY RUN: rolled back. Nothing was changed.")
            else:
                await tx.commit()
                print("  COMMITTED.")
        except Exception:
            if not rolled_back:
                await tx.rollback()
            raise
    except Exception as exc:                                    # noqa: BLE001
        print(f"\nFAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("The transaction was rolled back; the database is as it was.",
              file=sys.stderr)
        return 4
    finally:
        await conn.close()

    # ── AFTER, on a THIRD connection, opened after the commit ────────────────
    print("\n=== AFTER (separate connection, opened after commit) ===")
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        after = await _state(conn)
        _print_state("(independent read)", after)
    finally:
        await conn.close()

    if args.dry_run:
        ok = (after["tables"] == before["tables"]
              and after["trigger"] == before["trigger"]
              and after["function"] == before["function"])
        print("\nDRY RUN ACCEPTANCE: "
              + ("PASS — guards ran, drop executed, state is unchanged."
                 if ok else "FAIL — state moved during a dry run. Investigate."))
        return 0 if ok else 6

    ok = (not any(e for e, _ in after["tables"].values())
          and after["trigger"] == 0
          and after["function"] == 0
          and after["touch_updated_at"] == 1
          and after["crm_deals"] == before["crm_deals"])
    print("\nACCEPTANCE: " + ("PASS — all three gone in BOTH schemas, the "
                              "trigger and its function gone, "
                              "touch_updated_at() intact, crm_deals unchanged."
                              if ok else "FAIL — read the lines above."))
    return 0 if ok else 6


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
