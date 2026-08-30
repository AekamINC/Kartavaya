#!/usr/bin/env python3
"""check_backup_coverage.py — does the reversal path still cover what we think?

── Why this exists ───────────────────────────────────────────────────────────

`CLAUDE.md` names `premerge_backup_20260829` as "258 tables, 29,608 rows,
row-verified, the reversal path for the consolidation". That sentence has been
true since the evening it was written and has never been checked again.

It is also the ONLY sentence in the repository about recovery. There is no
runbook, no restore rehearsal, and no test — the entire disaster-recovery story
was one line of prose describing a snapshot nobody had looked at since.

Run 2026-08-30, read-only, this found three things:

  1. THE NUMBERS HAVE MOVED. 265 tables and 30,364 rows, not 258 and 29,608.
     Not alarming on its own — CLAUDE.md already warns that the schema count is
     "a measurement with a date, not a constant" — but it means the recorded
     figure was being cited rather than re-run, which is exactly what that
     warning is about.

  2. 95 OF THE 265 BACKUP TABLES ARE EMPTY. Only 170 hold a row.

  3. ⚠ 42 TABLES IN `public` ARE NOT IN THE BACKUP AT ALL, and 24 of them hold
     5,887 rows — including `tasks` (364), `users` (30), `teams` (41),
     `team_members` (206), `project_assignments` (195), `task_comments` (91),
     `notifications` (2,850) and `activity_events` (1,254). The entire core PM
     domain.

── What finding 3 does and does not mean ─────────────────────────────────────

It is NOT a corrupted backup. It is the backup doing exactly its job and being
described as something bigger.

Migration 241 moved 258 tables out of the `staging` schema into `public`.
`premerge_backup_20260829` is a snapshot of THAT schema, taken before the move.
The tables already living in `public` — the original production ones, which is
where core PM lives — were never in `staging`, so they were never in the
snapshot. As a consolidation-reversal path it is complete and correct.

THE RISK IS THE NAME. "The reversal path" reads like "the backup", and in an
incident nobody re-reads a migration note. Anyone reaching for this schema to
restore the database would recover 265 tables and silently not recover every
task, user, team and notification in the product.

The actual full-database recovery path is Supabase's own backups for this
project (`kartavya-sg`, region ap-southeast-1). This schema is a supplement to
that, never a substitute.

── What this script does ─────────────────────────────────────────────────────

Re-runs the measurement and fails when coverage gets WORSE — when the number of
`public` tables absent from the backup grows, or the backup shrinks. It is a
ratchet on a fact nobody was re-reading.

⚠ READ ONLY. Every statement is a SELECT. It touches the database staging and
production share, so it is deliberately incapable of writing: no DDL, no DML,
and the connection is opened read-only where the driver allows it.

── Usage ─────────────────────────────────────────────────────────────────────

    cd backend
    DATABASE_URL=... python scripts/check_backup_coverage.py
    DATABASE_URL=... python scripts/check_backup_coverage.py --write

It is NOT wired into CI, and that is deliberate: CI has no DATABASE_URL, and
`ci.yml` says why in as many words — "staging and production share one database,
so a CI job with credentials could write to live customer data from any pull
request". This is a thing a person runs, and a thing a scheduled job with its
own read-only credential could run later.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = Path(__file__).resolve().parent
BASELINE = HERE / "backup_coverage_baseline.json"
BACKUP_SCHEMA = os.environ.get("BACKUP_SCHEMA", "premerge_backup_20260829")

COVERAGE_SQL = """
WITH b AS (
  SELECT c.relname,
         (xpath('/row/c/text()',
           query_to_xml(format('SELECT count(*) AS c FROM %I.%I', $1, c.relname),
             false, true, '')))[1]::text::bigint AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = $1 AND c.relkind = 'r'
),
p AS (
  SELECT c.relname,
         (xpath('/row/c/text()',
           query_to_xml(format('SELECT count(*) AS c FROM %I.%I', 'public', c.relname),
             false, true, '')))[1]::text::bigint AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
)
SELECT
  (SELECT count(*) FROM b)                                       AS backup_tables,
  (SELECT coalesce(sum(n),0) FROM b)                             AS backup_rows,
  (SELECT count(*) FROM b WHERE n > 0)                           AS backup_tables_with_rows,
  (SELECT count(*) FROM p)                                       AS public_tables,
  (SELECT count(*) FROM p WHERE relname NOT IN (SELECT relname FROM b))
                                                                 AS uncovered_tables,
  (SELECT count(*) FROM p WHERE n > 0
      AND relname NOT IN (SELECT relname FROM b))                AS uncovered_tables_with_rows,
  (SELECT coalesce(sum(n),0) FROM p WHERE relname NOT IN (SELECT relname FROM b))
                                                                 AS uncovered_rows
"""

UNCOVERED_SQL = """
SELECT c.relname,
       (xpath('/row/c/text()',
         query_to_xml(format('SELECT count(*) AS c FROM %I.%I', 'public', c.relname),
           false, true, '')))[1]::text::bigint AS n
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind = 'r'
  AND c.relname NOT IN (
    SELECT c2.relname FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
    WHERE n2.nspname = $1 AND c2.relkind = 'r')
ORDER BY n DESC NULLS LAST, c.relname
"""


async def measure(dsn: str) -> tuple[dict, list[tuple[str, int]]]:
    import asyncpg

    conn = await asyncpg.connect(dsn)
    try:
        # Belt and braces on top of "every statement is a SELECT": the session
        # itself refuses writes. This runs against the database production uses.
        await conn.execute("SET default_transaction_read_only = on")
        row = await conn.fetchrow(COVERAGE_SQL, BACKUP_SCHEMA)
        uncovered = await conn.fetch(UNCOVERED_SQL, BACKUP_SCHEMA)
    finally:
        await conn.close()

    return dict(row), [(r["relname"], r["n"] or 0) for r in uncovered]


def main() -> int:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("check_backup_coverage: DATABASE_URL is not set.", file=sys.stderr)
        print("This asks a live question and there is no honest offline answer —", file=sys.stderr)
        print("a skip here would report 'recovery is fine' having checked nothing.", file=sys.stderr)
        return 1

    try:
        m, uncovered = asyncio.run(measure(dsn))
    except Exception as exc:                      # noqa: BLE001 - reported, never swallowed
        print(f"check_backup_coverage: could not measure — {type(exc).__name__}: {exc}", file=sys.stderr)
        print("UNKNOWN is not a pass. Fix the connection and run it again.", file=sys.stderr)
        return 1

    # ANTI-VACUITY. A schema that has been dropped answers every count with 0,
    # and "0 tables uncovered" would be the best possible score.
    if m["backup_tables"] == 0:
        print(f"check_backup_coverage: schema `{BACKUP_SCHEMA}` holds ZERO tables.", file=sys.stderr)
        print("The reversal path does not exist. That is the loudest possible failure,", file=sys.stderr)
        print("not a clean coverage report.", file=sys.stderr)
        return 1

    print(f"check_backup_coverage: `{BACKUP_SCHEMA}` vs `public`\n")
    print(f"    backup      {m['backup_tables']:>5} tables   {m['backup_rows']:>8} rows"
          f"   ({m['backup_tables_with_rows']} hold a row, {m['backup_tables'] - m['backup_tables_with_rows']} are empty)")
    print(f"    public      {m['public_tables']:>5} tables")
    print(f"    UNCOVERED   {m['uncovered_tables']:>5} tables   {m['uncovered_rows']:>8} rows"
          f"   ({m['uncovered_tables_with_rows']} of them hold data)\n")

    if uncovered:
        print("  in `public` and NOT in the backup — this snapshot cannot restore them:")
        for name, n in uncovered[:12]:
            print(f"      {n:>8}  {name}" if n else f"      {'—':>8}  {name}")
        if len(uncovered) > 12:
            print(f"      … and {len(uncovered) - 12} more, all empty")
        print("\n  ⚠ This is the backup being correct and being described as bigger than it is.")
        print("    It snapshots the pre-merge `staging` schema, so tables that already lived")
        print("    in `public` were never in it. As a CONSOLIDATION REVERSAL it is complete.")
        print("    As 'the backup' it is not, and the name invites that mistake in an incident.")
        print("    Full-database recovery is Supabase's own backups for kartavya-sg.\n")

    if "--write" in sys.argv:
        BASELINE.write_text(json.dumps({
            "_comment": "Disaster-recovery coverage. Coverage may IMPROVE; a drop fails "
                        "check_backup_coverage.py. See that file for what these numbers mean.",
            "_recorded": "2026-08-30",
            "_schema": BACKUP_SCHEMA,
            "measured": {k: int(v) for k, v in m.items()},
            "uncovered_with_rows": {n: int(c) for n, c in uncovered if c},
        }, indent=2) + "\n", encoding="utf-8")
        print(f"  recorded to {BASELINE.name}")
        return 0

    if not BASELINE.exists():
        print(f"check_backup_coverage: no baseline at {BASELINE.name}. Create it with --write.", file=sys.stderr)
        return 1

    base = json.loads(BASELINE.read_text(encoding="utf-8"))["measured"]
    problems = []
    if m["uncovered_tables"] > base["uncovered_tables"]:
        problems.append(
            f"{m['uncovered_tables'] - base['uncovered_tables']} MORE table(s) are now outside the "
            f"backup ({base['uncovered_tables']} -> {m['uncovered_tables']}). Every new table since "
            "the snapshot widens the gap between what exists and what can be restored."
        )
    if m["backup_tables"] < base["backup_tables"]:
        problems.append(
            f"the backup SHRANK, {base['backup_tables']} -> {m['backup_tables']} tables. "
            "Something dropped from the reversal path."
        )
    if m["backup_rows"] < base["backup_rows"]:
        problems.append(
            f"the backup lost rows, {base['backup_rows']} -> {m['backup_rows']}. A backup is "
            "append-never; losing rows means something wrote to it."
        )

    if problems:
        print("✘ recovery coverage got WORSE:\n", file=sys.stderr)
        for p in problems:
            print(f"    · {p}", file=sys.stderr)
        print("\n  Re-record with --write only after deciding the new state is acceptable.", file=sys.stderr)
        return 1

    print("✓ coverage has not regressed since the baseline.")
    if m["uncovered_tables"] == base["uncovered_tables"]:
        print(f"  {m['uncovered_tables']} table(s) remain outside the reversal path — unchanged, still true,")
        print("  and still the thing to fix. See docs/DISASTER-RECOVERY.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
