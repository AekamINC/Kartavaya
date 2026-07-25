"""
push_service.py — Kartavaya push notifications via Expo Push API.

send_push(pool, *, recipient_id, kind, title, body, task_id=None, data=None, is_mine=True)
    Checks user prefs + quiet hours (IST = UTC+5:30) then fires.

fan_out_push(pool, *, recipient_ids, kind, title, body, task_id, is_mine_for)
    Calls send_push concurrently; is_mine_for is a set of user_ids who "own" the event.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
IST = timezone(timedelta(hours=5, minutes=30))

# pref mode constants
MODE_OFF       = "off"
MODE_ALWAYS    = "always"
MODE_MINE_ONLY = "mine_only"
MODE_PROJECT   = "project"

DEFAULT_PREFS = {
    "mention":          "always",
    "approval_request": "always",
    "approved":         "always",
    "rejected":         "always",
    "assigned":         "always",
    "comment":          "mine_only",
    "status_changed":   "project",
    "done":             "project",
    "created":          "off",
}


def _in_quiet_hours(quiet_start: str, quiet_end: str) -> bool:
    """Return True if current IST time falls within quiet window (handles midnight wrap)."""
    now_ist = datetime.now(IST)
    now_t = now_ist.hour * 60 + now_ist.minute

    def _parse(s: str) -> int:
        h, m = s.split(":")
        return int(h) * 60 + int(m)

    start = _parse(quiet_start)
    end   = _parse(quiet_end)

    if start <= end:          # e.g. 09:00–17:00
        return start <= now_t < end
    else:                     # wraps midnight e.g. 22:00–07:00
        return now_t >= start or now_t < end


def _mode_allows(mode: str, is_mine: bool) -> bool:
    if mode == MODE_OFF:
        return False
    if mode == MODE_ALWAYS:
        return True
    if mode == MODE_MINE_ONLY:
        return is_mine
    if mode == MODE_PROJECT:
        return True   # project-level events are always relevant
    return True


async def send_push(
    pool,
    *,
    recipient_id: str,
    kind: str,
    title: str,
    body: str,
    task_id: Optional[str] = None,
    data: Optional[dict] = None,
    is_mine: bool = True,
) -> None:
    """Send a push notification to one user, respecting their prefs and quiet hours."""
    # Delivery only — this function writes no notification row, so suppressing
    # it costs nothing but the device buzz.
    from outbound import suppressed
    if suppressed("push", recipient_id, f"{kind}: {title}"):
        return

    try:
        prefs_row = await pool.fetchrow(
            "SELECT prefs, quiet_start, quiet_end FROM notification_prefs WHERE user_id=$1",
            recipient_id,
        )
        if prefs_row:
            prefs       = prefs_row["prefs"] or {}
            quiet_start = prefs_row["quiet_start"] or "22:00"
            quiet_end   = prefs_row["quiet_end"]   or "07:00"
        else:
            prefs       = {}
            quiet_start = "22:00"
            quiet_end   = "07:00"

        mode = prefs.get(kind, DEFAULT_PREFS.get(kind, MODE_ALWAYS))

        if not _mode_allows(mode, is_mine):
            return

        if _in_quiet_hours(quiet_start, quiet_end):
            return

        token_rows = await pool.fetch(
            "SELECT token FROM push_tokens WHERE user_id=$1", recipient_id
        )
        tokens = [
            r["token"] for r in token_rows
            if r["token"] and r["token"].startswith("ExponentPushToken[")
        ]
        if not tokens:
            return

        payload_data = dict(data) if data else {}
        if task_id:
            payload_data["taskId"] = task_id

        messages = [
            {
                "to":    token,
                "title": title,
                "body":  body,
                "data":  payload_data,
                "sound": "default",
                "channelId": "default",
            }
            for token in tokens
        ]

        async with httpx.AsyncClient(timeout=10) as client:
            for attempt in range(2):   # one retry on 5xx
                resp = await client.post(
                    EXPO_PUSH_URL,
                    json=messages,
                    headers={
                        "Accept":       "application/json",
                        "Content-Type": "application/json",
                    },
                )
                if resp.status_code < 500 or attempt == 1:
                    resp.raise_for_status()
                    break
                await asyncio.sleep(1)

    except Exception as exc:
        logger.warning("push_service.send_push failed for %s: %s", recipient_id, exc)


async def fan_out_push(
    pool,
    *,
    recipient_ids: list[str],
    kind: str,
    title: str,
    body: str,
    task_id: Optional[str] = None,
    data: Optional[dict] = None,
    is_mine_for: Optional[set] = None,
) -> None:
    """Send push to multiple recipients concurrently."""
    if not recipient_ids:
        return
    is_mine_for = is_mine_for or set()
    await asyncio.gather(*[
        send_push(
            pool,
            recipient_id=uid,
            kind=kind,
            title=title,
            body=body,
            task_id=task_id,
            data=data,
            is_mine=(uid in is_mine_for),
        )
        for uid in recipient_ids
    ], return_exceptions=True)
