"""Erasing a project, and the one place that knows what "the project" is.

The cascade lived inline in `server.py`'s `DELETE /teams/{id}/purge` and nowhere
else, which was fine while a human clicking a button was the only way a project
could be erased. The owner's decision of 2026-08-09 — "if delete happens it gets
deleted after 7 days" — adds a second caller, the retention cron, and two copies
of a nine-table cascade is how a table gets added to one and not the other.

There is no `ON DELETE CASCADE` on these foreign keys, so the order matters:
children before parents, and `time_entries` before `tasks` because it is keyed
on the task rather than on the team.
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

#: How long a soft-deleted project stays restorable. The same figure as
#: `server.PROJECT_BIN_DAYS` — imported from here by that module so the window
#: and the erasure cannot drift apart. Owner's decision, 2026-08-09.
PROJECT_BIN_DAYS = 7


async def purge_project(pool, team_id: str) -> None:
    """Erase one project and everything hanging off it. Irreversible.

    Runs in ONE transaction: a cascade that stops half way leaves tasks whose
    project no longer exists, which is worse than not having started.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM activity_events WHERE team_id=$1", team_id)
            await conn.execute(
                "DELETE FROM time_entries WHERE task_id IN "
                "(SELECT task_id FROM tasks WHERE team_id=$1)", team_id)
            await conn.execute("DELETE FROM tasks WHERE team_id=$1", team_id)
            # BOTH membership tables, and that is not redundancy. Phase 2 of the
            # tenancy cutover moved the READS onto `project_assignments`; the
            # WRITES still go to both, because PROPOSED_080 only stays reversible
            # while `team_members` is maintained. A purge that stopped deleting
            # from `team_members` would leave rows behind pointing at a team that
            # no longer exists — and nothing would raise, because these tables
            # carry no foreign key to `teams`. That is exactly the silent orphan
            # this cascade's docstring is about.
            await conn.execute(
                "DELETE FROM public.project_assignments WHERE team_id=$1::text", team_id)
            await conn.execute(
                "DELETE FROM public.team_members WHERE team_id=$1::text", team_id)
            await conn.execute("DELETE FROM project_columns WHERE team_id=$1", team_id)
            await conn.execute("DELETE FROM automations WHERE team_id=$1", team_id)
            try:
                await conn.execute("DELETE FROM approvals WHERE team_id=$1", team_id)
            except Exception as exc:  # noqa: BLE001
                log.debug("DELETE approvals skipped (table may not exist): %s", exc)
            await conn.execute("DELETE FROM teams WHERE team_id=$1", team_id)


async def expired_projects(pool) -> list[dict]:
    """Projects whose restore window has run out — the purge candidates.

    Separate from the purge itself SO IT CAN BE COUNTED FIRST. The last time a
    deleting job was armed on this platform it was armed without anybody knowing
    how many rows it would take on its first run; that is not repeated here.
    """
    rows = await pool.fetch(
        f"SELECT team_id, name, deleted_at FROM teams "
        f"WHERE deleted_at IS NOT NULL "
        f"  AND deleted_at < NOW() - INTERVAL '{PROJECT_BIN_DAYS} days' "
        f"ORDER BY deleted_at")
    return [dict(r) for r in rows]


async def purge_expired_projects(pool, *, dry_run: bool = False) -> dict:
    """Empty the bin of everything past its window.

    `dry_run` counts and names them without deleting, which is what the first
    call should be.
    """
    candidates = await expired_projects(pool)
    if dry_run:
        return {"dry_run": True, "count": len(candidates),
                "projects": [c["name"] for c in candidates]}
    for c in candidates:
        await purge_project(pool, c["team_id"])
        log.info("Purged expired project %r (deleted %s)", c["name"], c["deleted_at"])
    return {"dry_run": False, "purged": len(candidates),
            "projects": [c["name"] for c in candidates]}
