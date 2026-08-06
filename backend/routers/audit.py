"""audit.py — reading the audit log.

── 828 ROWS AND NOT ONE READER ──────────────────────────────────────────────

`services/audit.emit` has been writing to `staging.audit_log` for months. Before
this file, `grep -rn "FROM staging.audit_log" --include=*.py` returned ZERO hits
across the whole backend: no endpoint, no screen, no export. The table was
write-only, and the only way to see a row was to open a SQL console.

That is not a small gap for this particular table. An audit log exists to answer
one question — "who reached my organisation's data, and when" — and a log nobody
can read does not answer it. The security work this repository did this week
added rows for every platform crossing into a customer org; without this file
those rows are invisible to the customer they are about.

── WHO MAY READ IT ──────────────────────────────────────────────────────────

The org's own admins, scoped to their own org. Deliberately NOT platform staff
by way of a header: the whole point of the rows added this week is that a
platform account crossing into a customer org LEAVES A TRACE, and letting that
same account read and filter the trace of its own visit is a straight conflict.
`get_org_id` plus `require_org_role` is the correct pair, and it means the org
that was visited is the org that can see the visit.

── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────

No delete, no edit, no retention control. An audit row a user can remove is not
an audit row. Retention belongs to the retention job, which is policy applied
uniformly, not to a screen where somebody can choose which visit to forget.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])

#: Read-only for every role that can see it, so the gate is the same on both
#: endpoints and there is one place to change who may look.
_reader = require_org_role("org_owner", "org_admin")

#: A page of history, bounded. The table grows without limit and a screen that
#: asks for all of it is a screen that times out on the org it matters most for.
_PAGE_MAX = 200


@router.get("/events")
async def list_audit_events(
    action: Optional[str] = None,
    severity: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=_PAGE_MAX),
    before_id: Optional[int] = Query(None, description="Keyset cursor: the id of the oldest row you already have"),
    org_id: str = Depends(get_org_id),
    _r=Depends(_reader),
):
    """This organisation's audit history, newest first.

    KEYSET PAGINATION, not OFFSET. `id` is a bigint sequence and the table is
    append-only, so `id < $before` is exact and stays exact while rows arrive
    underneath — an OFFSET page silently repeats or skips a row every time
    something is written between two requests, which on an audit log means a
    visit that appears twice or never.
    """
    pool = await get_pool()

    where = ["org_id = $1::uuid"]
    args: list = [org_id]

    def _next():
        return f"${len(args) + 1}"

    if action:
        where.append(f"action = {_next()}"); args.append(action)
    if severity:
        where.append(f"severity = {_next()}"); args.append(severity)
    if user_id:
        where.append(f"user_id = {_next()}"); args.append(user_id)
    if before_id:
        where.append(f"id < {_next()}"); args.append(before_id)

    args.append(limit)
    rows = await pool.fetch(
        # `ip` is INET; cast so the JSON encoder does not have to know that.
        "SELECT id, ts, user_id, action, resource_type, resource_id, "
        "       host(ip) AS ip, user_agent, detail, severity "
        f"  FROM staging.audit_log WHERE {' AND '.join(where)} "
        f" ORDER BY id DESC LIMIT ${len(args)}",
        *args,
    )
    out = [dict(r) for r in rows]
    return {
        "data": out,
        # The cursor for the next page, or null at the end. Returned rather than
        # left to the client to derive, so "what do I pass next" is never a
        # question about this API.
        "next_before_id": out[-1]["id"] if len(out) == limit else None,
    }


@router.get("/summary")
async def audit_summary(
    days: int = Query(30, ge=1, le=365),
    org_id: str = Depends(get_org_id),
    _r=Depends(_reader),
):
    """What has been happening, by action — the shape before the detail.

    Exists because the list alone answers "show me everything" and not "is
    anything unusual". A count per action over a window is what makes a single
    `platform.module_write` against your org visible without reading 800 rows.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT action, severity, count(*) AS n, max(ts) AS last_at "
        "  FROM staging.audit_log "
        " WHERE org_id = $1::uuid AND ts > NOW() - ($2 || ' days')::interval "
        " GROUP BY action, severity "
        " ORDER BY n DESC",
        org_id, str(days),
    )
    return {"days": days, "data": [dict(r) for r in rows]}
