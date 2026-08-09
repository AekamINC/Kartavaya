"""Closed deals leave the board by themselves.

Owner, 2026-08-09: "kanban done/won/lost should auto archive after 7 days".
A deal that reached Won or Lost is finished work, and a board whose last two
columns only ever grow stops being a board.

── ARCHIVING IS NOT DELETING, AND THE DIFFERENCE IS THE MONEY ────────────────

`is_active=FALSE` is what the delete handler does to a deal, and every won-value
figure in Dristi and in the CRM report filters on it. Archiving through that
column would quietly remove archived wins from revenue. So this writes its own
nullable timestamp, `graha_deals.archived_at`, and nothing that counts money
looks at it.

── THE COLUMN IS PROBED, NOT ASSUMED ─────────────────────────────────────────

Migration 133 was APPLIED on 2026-08-09. The probe stays because migrations
here are applied BY HAND and the deploy is a separate act, so both orders happen
and a fresh database — a branch, a restore, a new environment — reaches this
code before the column exists. Where it does not exist `archive_ready()` answers
False, the list filters are not added and the sweep returns
`{"skipped": "migration"}` — rather than 500ing on UndefinedColumn, and above
all rather than appearing to work.
"""
from __future__ import annotations

import logging
import time

log = logging.getLogger(__name__)

#: Days after a deal reaches Won or Lost before it leaves the board.
DEAL_ARCHIVE_DAYS = 7

#: The stages that close a deal. `won_at` / `lost_at` are already stamped by the
#: deal update handler, so the clock starts when the stage changed and not when
#: the sweep first noticed.
CLOSED_STAGES = ("Won", "Lost")

_ready: dict = {}


async def archive_ready(pool) -> bool:
    """Has `migration 133` been applied?

    Cached asymmetrically, the same way `server.archive_column_ready` does it:
    TRUE forever because a column does not un-exist, FALSE for sixty seconds so
    applying the migration takes effect without a redeploy.
    """
    if _ready.get("yes"):
        return True
    if time.monotonic() < _ready.get("recheck_after", 0):
        return False
    ok = await pool.fetchval(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='staging' AND table_name='graha_deals' "
        "  AND column_name='archived_at'")
    if ok:
        _ready["yes"] = True
        return True
    _ready["recheck_after"] = time.monotonic() + 60
    return False


async def sweep_org(pool, org_id: str, *, dry_run: bool = False) -> dict:
    """Archive one organisation's closed-and-cold deals.

    `COALESCE(won_at, lost_at, updated_at)` because `won_at`/`lost_at` were added
    later than the stages themselves: a deal closed before those columns existed
    has neither, and falling back to `updated_at` archives it on the same rule
    rather than leaving it on the board for ever.
    """
    if not await archive_ready(pool):
        return {"skipped": "migration"}
    sql = (
        "FROM staging.graha_deals "
        "WHERE org_id=$1::uuid AND is_active=TRUE AND archived_at IS NULL "
        "  AND stage = ANY($2::text[]) "
        f" AND COALESCE(won_at, lost_at, updated_at) < NOW() - INTERVAL '{DEAL_ARCHIVE_DAYS} days'"
    )
    if dry_run:
        n = await pool.fetchval(f"SELECT COUNT(*) {sql}", org_id, list(CLOSED_STAGES))
        return {"dry_run": True, "would_archive": n or 0}
    rows = await pool.fetch(
        f"UPDATE staging.graha_deals SET archived_at=NOW() "
        f"WHERE id IN (SELECT id {sql}) RETURNING id",
        org_id, list(CLOSED_STAGES))
    if rows:
        log.info("Archived %d closed deal(s) for organisation %s", len(rows), org_id)
    return {"archived": len(rows)}
