"""sync.py — what a device needs that no list endpoint can tell it.

Owner's decision, 2026-08-09: the mobile app syncs what changed since the last
session. `?since=` on the list endpoints carries the CHANGES. This router
carries the two things a list cannot:

  · **deletions**, for the tables that delete for real. Migration 138 records
    them by trigger in `staging.sync_tombstones`, because a delta that only
    returns changed rows leaves a deleted task on the phone for ever.
  · **the clock and the horizon**, so a client can decide for itself whether a
    delta is even possible or whether it has been away too long.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from services.delta_sync import TOMBSTONE_DAYS, parse_since
from services.pulse import log_recorder_failure, note_app_version

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])
log = logging.getLogger(__name__)

#: One request should not be able to ask for every deletion ever recorded.
TOMBSTONE_LIMIT = 2000


@router.get("/state")
async def sync_state(user=Depends(require_user), org_id: str = Depends(get_org_id)):
    """The server's clock and how far back a delta can reach.

    A client calls this ONCE on a cold start, before it has a `synced_at` of its
    own, so that its first delta uses the server's clock rather than the
    device's. Phone clocks are wrong often enough that this cheap call is worth
    more than the round trip it costs.
    """
    now = datetime.now(timezone.utc)
    return {
        "synced_at": now.isoformat(),
        "tombstone_horizon": (now - timedelta(days=TOMBSTONE_DAYS)).isoformat(),
        "tombstone_days": TOMBSTONE_DAYS,
    }


@router.get("/tombstones")
async def list_tombstones(
    request: Request,
    since: str = Query(..., description="the `synced_at` from your last sync"),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
):
    """Records HARD-deleted since `since`, so the device can forget them.

    ── WHY `resync_required` IS A FIELD AND NOT A GUESS ────────────────────────

    Tombstones are pruned after thirty days. A device asking about a window that
    starts before the horizon cannot be brought up to date — the deletions it
    needs no longer exist — and the honest answer is "start again", not a short
    list that looks complete. A delta that silently omits old deletions is
    exactly the bug the tombstone table exists to prevent, one level up.

    Rows with a NULL `org_id` are included: `tasks` has no org column, so its
    tombstones cannot be scoped here. That is safe — a tombstone is an id and a
    word, it carries no content — and the device applies only the ids it holds.
    """
    when = parse_since(since)
    now = datetime.now(timezone.utc)
    horizon = now - timedelta(days=TOMBSTONE_DAYS)

    if when < horizon:
        return {
            "resync_required": True,
            "reason": f"the last sync is older than the {TOMBSTONE_DAYS}-day "
                      f"deletion history — some removals can no longer be listed",
            "synced_at": now.isoformat(),
            "data": [],
        }

    pool = await get_pool()

    # Pulse app-version freshness (proposal 68): this is the route a phone
    # hits every sync session, so the version header is noted here as well as
    # at login — otherwise a device that stays signed in for weeks never
    # reports the OTA it took. note_app_version's process-local seen-set
    # keeps this hot path at one write per (user, version) pair per process;
    # the guard below keeps collection from ever breaking a sync.
    try:
        version = request.headers.get("x-app-version")
        if version:
            await note_app_version(pool, user["user_id"], version)
    except Exception as exc:
        # The shared reporter, not a local log line: its once-per-process
        # latch keeps "migration 156 not applied yet" to ONE traceback across
        # every login and every sync poll, instead of one per request.
        log_recorder_failure("sync", exc)

    rows = await pool.fetch(
        "SELECT entity, entity_id, deleted_at FROM staging.sync_tombstones "
        "WHERE deleted_at > $1 AND (org_id = $2::uuid OR org_id IS NULL) "
        "ORDER BY deleted_at LIMIT $3",
        when, org_id, TOMBSTONE_LIMIT)

    data = [dict(r) for r in rows]
    truncated = len(data) >= TOMBSTONE_LIMIT
    return {
        "resync_required": False,
        "data": data,
        # On truncation the client must come back from the LAST row's timestamp
        # rather than from `synced_at`, or it skips everything past the cap.
        "synced_at": (data[-1]["deleted_at"].isoformat() if truncated
                      else now.isoformat()),
        "truncated": truncated,
        "tombstone_horizon": horizon.isoformat(),
    }
