"""`?since=` — one contract, so twelve list endpoints cannot disagree about it.

Owner's decision, 2026-08-09: the mobile app syncs what changed since the last
session, for real, rather than refetching whole lists.

── WHAT A DELTA HAS TO GET RIGHT, AND WHAT GOES WRONG IF IT DOES NOT ─────────

**Deletions.** A delta that returns only changed rows never tells the device
about a row that was removed, so the device keeps it for ever and the user taps
a task that does not exist. Two kinds here and they are handled differently:

  · SOFT deletes (`is_active`, `deleted_at`) — the row survives, the delta
    carries it, and the CLIENT removes it. Which means a `?since=` request must
    NOT apply the `is_active=TRUE` filter that the same endpoint applies without
    it: filtering out the deactivated row is exactly how the deletion gets lost.
    `include_inactive_for_delta` is that rule, in one place.
  · HARD deletes — nothing survives, so migration 138's `sync_tombstones` table
    records them by trigger and `GET /v1/sync/tombstones` reads them back.

**The clock.** The `since` a client sends must be a timestamp the SERVER issued,
never one the device generated. Phone clocks are wrong — by minutes usually, by
hours when a timezone is mishandled — and a device whose clock runs fast asks
for changes since a moment in the future and is told, correctly and uselessly,
that nothing has changed. So every delta response carries `synced_at`, the
server's own `NOW()`, and the client stores THAT and sends it back next time.

**The boundary.** `>` and not `>=`, against the previous response's `synced_at`.
With `>=` every sync re-sends the rows that landed in the final microsecond of
the last one; with a client-side "now" it would miss the rows written while the
response was in flight. Taking the server's clock at the START of the query and
comparing strictly is what makes the window closed at one end and open at the
other with no gap and no overlap.

**The horizon.** Tombstones are pruned after 30 days. A device that has been
offline longer cannot be brought up to date by a delta — the deletions it needs
are gone — and must resync in full. `tombstone_horizon` is reported on every
response so the client can tell, rather than silently keeping rows that were
deleted five weeks ago.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

#: How long a tombstone is kept. A device offline longer than this must resync
#: in full — see the module docstring.
TOMBSTONE_DAYS = 30

#: Rejected outright rather than clamped. A `since` far in the past means the
#: client believes it is doing a delta while actually asking for everything,
#: which is the most expensive query in the product dressed as the cheapest.
MAX_SINCE_DAYS = 365


def parse_since(raw: str | None) -> datetime | None:
    """The `since` a caller sent, or None for a full list.

    Accepts ISO-8601 with or without a `Z`. A NAIVE timestamp is read as UTC
    rather than as server-local: the alternative is a delta whose window shifts
    by hours depending on which region the container happens to run in, and
    Railway has moved this service between regions before.
    """
    if raw in (None, ""):
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(
            400, f"`since` must be an ISO-8601 timestamp, not {raw!r}. Send back "
                 f"the `synced_at` from your previous response.") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if dt > now + timedelta(minutes=5):
        # A device whose clock runs fast would otherwise be told, correctly and
        # uselessly, that nothing has changed — for as long as its clock is
        # wrong. Five minutes of tolerance covers ordinary drift; beyond that
        # the client is told to resync rather than left silently stale.
        raise HTTPException(
            400, "`since` is in the future — the device clock is wrong. Resync "
                 "in full and use the `synced_at` this server returns.")
    if dt < now - timedelta(days=MAX_SINCE_DAYS):
        raise HTTPException(
            400, f"`since` is more than {MAX_SINCE_DAYS} days old. Resync in full.")
    return dt


def envelope(rows: list, since: datetime | None, synced_at: datetime,
             *, limit: int | None = None) -> dict:
    """The response shape every delta-capable list returns.

    `synced_at` is what the client stores and sends next time — see the module
    docstring on why the device's own clock must not be used.
    """
    out = {
        "data": rows,
        "synced_at": synced_at.isoformat(),
        "delta": since is not None,
        "tombstone_horizon": (
            datetime.now(timezone.utc) - timedelta(days=TOMBSTONE_DAYS)).isoformat(),
    }
    if limit is not None:
        out["limit"] = limit
        # A delta that hits the row cap is NOT a complete delta, and a client
        # that treats it as one will never learn about the rows past the cap.
        # Saying so lets it ask again from the last row's timestamp.
        out["truncated"] = len(rows) >= limit
    return out


def since_clause(column: str, since: datetime | None, params: list) -> str:
    """`AND <column> > $n`, or nothing. Appends the bind parameter.

    STRICTLY greater — see the module docstring on the boundary.
    """
    if since is None:
        return ""
    params.append(since)
    return f" AND {column} > ${len(params)}"


def include_inactive_for_delta(since: datetime | None) -> bool:
    """True when the caller is doing a delta.

    A delta MUST see soft-deleted rows: they are how the deletion reaches the
    device. Filtering them out is the single most likely way to ship a delta
    that looks perfect and leaves deleted records on every phone.
    """
    return since is not None
