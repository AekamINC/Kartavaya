"""
expo_push_service.py — Send Expo push notifications to mobile devices.
Reads tokens from the push_tokens table (registered via POST /me/push_tokens).
"""
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_expo_push(pool, *, user_id: str, title: str, body: str, url: str = "/", task_id: str | None = None):
    """Send an Expo push notification to all registered devices for a user."""
    from outbound import suppressed
    if suppressed("push:expo", user_id, title):
        return

    try:
        rows = await pool.fetch(
            "SELECT token, device_id FROM push_tokens WHERE user_id=$1", user_id
        )
    except Exception as exc:
        logger.warning("expo_push: failed to fetch tokens for %s: %s", user_id, exc)
        return

    if not rows:
        return

    messages = [
        {
            "to":    row["token"],
            "title": title,
            "body":  body,
            "data":  {"url": url, "taskId": task_id},
            "sound": "default",
            "channelId": "default",
        }
        for row in rows
    ]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
    except Exception as exc:
        logger.warning("expo_push: HTTP error for user %s: %s", user_id, exc)
        return

    # Remove stale tokens reported by Expo
    stale_tokens = set()
    for item, row in zip(data, rows):
        if item.get("status") == "error" and item.get("details", {}).get("error") == "DeviceNotRegistered":
            stale_tokens.add(row["device_id"])

    if stale_tokens:
        for device_id in stale_tokens:
            try:
                await pool.execute("DELETE FROM push_tokens WHERE device_id=$1", device_id)
                logger.info("expo_push: removed stale token device_id=%s", device_id)
            except Exception:
                pass


async def fan_out_expo_push(pool, *, user_ids: list[str], title: str, body: str, url: str = "/", task_id: str | None = None):
    """Send Expo push to multiple users concurrently."""
    if not user_ids:
        return
    await asyncio.gather(
        *(send_expo_push(pool, user_id=uid, title=title, body=body, url=url, task_id=task_id) for uid in user_ids),
        return_exceptions=True,
    )
