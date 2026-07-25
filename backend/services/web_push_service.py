"""
web_push_service.py — VAPID Web Push for Kartavaya.

Stores PushSubscription objects (from browser's pushManager.subscribe()) in the
push_web_subscriptions table and delivers Web Push messages via pywebpush.

Environment variables required:
  VAPID_PUBLIC_KEY   — base64url-encoded uncompressed EC public key (65 bytes raw → 87 chars)
  VAPID_PRIVATE_KEY  — base64url-encoded 32-byte raw EC private scalar
  VAPID_MAILTO       — mailto: claim sent in VAPID header, e.g. "mailto:hello@example.com"
"""
import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

VAPID_PUBLIC_KEY  = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_MAILTO      = os.environ.get("VAPID_MAILTO", "mailto:hello@Kartavaya.app")

_configured = bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY != "not-configured")


def is_configured() -> bool:
    return _configured


async def save_subscription(pool, user_id: str, subscription: dict) -> None:
    """Upsert a browser PushSubscription for a user."""
    endpoint = subscription.get("endpoint", "")
    if not endpoint:
        return
    p256dh = (subscription.get("keys") or {}).get("p256dh", "")
    auth   = (subscription.get("keys") or {}).get("auth", "")
    await pool.execute(
        """
        INSERT INTO push_web_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (endpoint) DO UPDATE SET
            user_id  = EXCLUDED.user_id,
            p256dh   = EXCLUDED.p256dh,
            auth     = EXCLUDED.auth,
            updated_at = NOW()
        """,
        user_id, endpoint, p256dh, auth,
    )


async def remove_subscription(pool, endpoint: str) -> None:
    await pool.execute("DELETE FROM push_web_subscriptions WHERE endpoint=$1", endpoint)


async def send_web_push(pool, *, user_id: str, title: str, body: str, url: str = "/") -> None:
    """Send a Web Push notification to all browser subscriptions for user_id."""
    from outbound import suppressed
    if suppressed("push:web", user_id, title):
        return

    if not _configured:
        return
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed — skipping web push")
        return

    rows = await pool.fetch(
        "SELECT endpoint, p256dh, auth FROM push_web_subscriptions WHERE user_id=$1",
        user_id,
    )
    if not rows:
        return

    import json
    payload = json.dumps({"title": title, "body": body, "url": url})
    stale = []

    for row in rows:
        try:
            webpush(
                subscription_info={
                    "endpoint": row["endpoint"],
                    "keys": {"p256dh": row["p256dh"], "auth": row["auth"]},
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_MAILTO},
            )
        except WebPushException as exc:
            if exc.response is not None and exc.response.status_code in (404, 410):
                stale.append(row["endpoint"])
            else:
                logger.warning("web push failed for %s: %s", user_id, exc)
        except Exception as exc:
            logger.warning("web push error for %s: %s", user_id, exc)

    for ep in stale:
        await remove_subscription(pool, ep)


async def fan_out_web_push(
    pool,
    *,
    user_ids: list[str],
    title: str,
    body: str,
    url: str = "/",
) -> None:
    if not _configured or not user_ids:
        return
    await asyncio.gather(*[
        send_web_push(pool, user_id=uid, title=title, body=body, url=url)
        for uid in user_ids
    ], return_exceptions=True)
