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

#: The channel this path records under. `outbound_log` translates it to family
#: 'push' with provider 'webpush', which is what distinguishes these rows from
#: the two Expo paths that end at the same person on a different device.
_CHANNEL = "push:web"

#: What this path is FOR, when the caller does not say. The writer's fallback is
#: 'unclassified' — "nobody has decided" — and 098 asks for that count to be
#: driven down. On this path somebody has decided: every caller is delivering a
#: product notification to a browser. A caller that knows the notification
#: `kind` should pass it instead; it is the vocabulary `push_service`'s
#: `DEFAULT_PREFS` keys on and the one both callers already consult
#: `prefs_allow` with.
_PURPOSE = "notification"


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


async def remove_subscription(pool, endpoint: str, user_id: str | None = None) -> None:
    """Delete a web-push subscription, scoped to its owner when one is known.

    `user_id` is optional ONLY so that an internal caller pruning a subscription
    the push service itself rejected (410 Gone) can still do so without a user
    in hand. Every caller that acts on a request from a browser MUST pass it.

    Without the scope this deletes by endpoint alone, and the endpoint arrives in
    a request body: any authenticated user could unsubscribe any other user's
    browser by supplying their endpoint, silently stopping their notifications
    with no error on either side.
    """
    if user_id is None:
        await pool.execute("DELETE FROM push_web_subscriptions WHERE endpoint=$1", endpoint)
        return
    await pool.execute(
        "DELETE FROM push_web_subscriptions WHERE endpoint=$1 AND user_id=$2",
        endpoint, user_id,
    )


async def send_web_push(
    pool, *, user_id: str, title: str, body: str, url: str = "/",
    org_id: str | None = None, kind: str | None = None,
) -> None:
    """Send a Web Push notification to all browser subscriptions for user_id.

    `org_id` and `kind` are for the outbound record only and change nothing
    about what is delivered. Both are PASSED IN OR LEFT NULL, and the org is
    never looked up from `user_id`: a user belongs to more than one org in this
    product, so a lookup would file every push under whichever row came back
    first. A row under the wrong org is a wrong answer to "what did we send this
    org" and nothing about it looks wrong afterwards; a NULL says "not known",
    which is true.
    """
    from outbound import begin
    # `ref` carries the kind because the writer reads its head as `purpose`, so
    # the cause of the push and the bucket it is counted in stay one word.
    att = begin(_CHANNEL, user_id, title, org_id=org_id, user_id=user_id,
                ref=kind, purpose=kind or _PURPOSE)
    if att.blocked:
        return

    # Every return below closes the row `begin()` already wrote — this used to
    # call `suppressed()`, which records the attempt and has no way to report
    # what became of it, so EVERY web push in the product was left reading
    # 'queued'. 098 reads a row still queued as "the process died between the
    # provider call and the answer", which was false for every one of them.
    #
    # NONE of the early returns names a provider, because at those lines nothing
    # has been constructed — no VAPID client, nothing contacted — and asserting
    # a carrier there would be claiming a decision nobody made. Only the two
    # branches at the bottom, after `webpush()` has actually spoken to a push
    # service, name one.
    #
    # That is as far as this file reaches. The WRITER still applies its own
    # channel-derived guess ('push:web' -> 'webpush') to every row that is not
    # `suppressed`, so an unconfigured deployment's row does end up naming a
    # provider it never used — exactly as `expo_push_service`'s "no registered
    # device" row already reads 'expo'. The rule outbound_log actually holds is
    # the one that matters here and it holds: a SUPPRESSED row, which is every
    # row staging writes, carries no provider at all.
    if not _configured:
        att.failed("VAPID keys not configured")
        return
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("pywebpush not installed — skipping web push")
        att.failed("pywebpush not installed")
        return

    try:
        rows = await pool.fetch(
            "SELECT endpoint, p256dh, auth FROM push_web_subscriptions WHERE user_id=$1",
            user_id,
        )
    except Exception as exc:
        # Recorded and re-raised. This lookup has always propagated to the
        # caller — `fan_out_web_push` gathers with return_exceptions and
        # `server.py` wraps it — and completing the row must not change who
        # hears about a database failure.
        att.failed(exc)
        raise

    if not rows:
        att.failed("no browser subscription")
        return

    import json
    payload = json.dumps({"title": title, "body": body, "url": url})
    stale = []
    delivered = 0
    refusals = []

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
            delivered += 1
        except WebPushException as exc:
            refusals.append(str(exc))
            if exc.response is not None and exc.response.status_code in (404, 410):
                stale.append(row["endpoint"])
            else:
                logger.warning("web push failed for %s: %s", user_id, exc)
        except Exception as exc:
            refusals.append(str(exc))
            logger.warning("web push error for %s: %s", user_id, exc)

    # One row per CALL, not per browser — the same reasoning `report_expo` gives
    # for devices. The question is "did we notify this person", and a row per
    # subscription would make a count of notifications depend on how many
    # browsers they happened to have registered. So a call counts as SENT if ANY
    # subscription took it, and the per-subscription refusals are recorded only
    # when nothing got through: a stale tablet subscription beside a laptop that
    # popped the notification is not a failed notification, and the pruning
    # below acts on that same signal anyway.
    #
    # There is no message id to record: Web Push answers with a status and no
    # identifier, so `provider_message_id` is genuinely absent rather than lost.
    if delivered:
        att.sent(provider="webpush")
    else:
        att.failed("; ".join(refusals) or "no subscription accepted it",
                   provider="webpush")

    for ep in stale:
        # These rows were just read back under this same user_id, so scoping the
        # delete costs nothing and keeps the unscoped branch unreachable here.
        await remove_subscription(pool, ep, user_id)


async def fan_out_web_push(
    pool,
    *,
    user_ids: list[str],
    title: str,
    body: str,
    url: str = "/",
    org_id: str | None = None,
    kind: str | None = None,
) -> None:
    """Send Web Push to several users concurrently.

    One `org_id` for the whole fan-out: a fan-out is one event reaching several
    people in the same org. A caller whose recipients span orgs has no single
    right answer and should leave it out rather than pick one.

    NOTE the `_configured` short-circuit, which is older than the outbound log
    and is left alone deliberately — changing it would change nothing about
    delivery and a great deal about the row count. It means an unconfigured
    deployment records nothing here while a direct `send_web_push` records
    'VAPID keys not configured' per recipient. Worth settling when somebody
    decides whether "the product has no web push at all" is an attempted send.
    """
    if not _configured or not user_ids:
        return
    await asyncio.gather(*[
        send_web_push(pool, user_id=uid, title=title, body=body, url=url,
                      org_id=org_id, kind=kind)
        for uid in user_ids
    ], return_exceptions=True)
