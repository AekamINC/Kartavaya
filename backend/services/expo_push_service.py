"""
expo_push_service.py — Send Expo push notifications to mobile devices.
Reads tokens from the push_tokens table (registered via POST /me/push_tokens).
"""
import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

#: One row per CALL, not per device. A user with a phone and a tablet gets two
#: Expo messages and one record: the question the log answers is "did we notify
#: this person", and a row per device would make a count of notifications depend
#: on how many devices they happened to have registered.
#:
#: `bytes` is never passed on this channel. It exists to reconcile the SES
#: invoice (services/outbound_log.py, "WHY SIZE"); Expo bills nothing by size,
#: so a number there for a push would make the column mean two things.
_CHANNEL = "push:expo"

#: What this path is FOR, when the caller does not say. `purpose` is NOT NULL
#: and the writer's fallback is 'unclassified', which 098 asks to be watched and
#: driven down — it means "nobody has decided", and on this path somebody has:
#: every caller here is delivering a product notification to a device.
#:
#: A caller that knows the notification `kind` should pass it instead. It is the
#: same vocabulary `push_service.DEFAULT_PREFS` keys on and the same one both
#: callers of this function already consult `prefs_allow` with, so the switch
#: the user set and the bucket the send is counted in are one word.
_PURPOSE = "notification"


def report_expo(att, tickets) -> None:
    """Complete an outbound Attempt from Expo's ticket list.

    Expo answers with one ticket per message, each either accepted with an id or
    rejected with a reason — DeviceNotRegistered being the common one, and the
    same signal the stale-token cleanup below acts on.

    A call counts as SENT if ANY device accepted it. "Delivered to the phone but
    not the tablet" is a third fact that neither word states, and the Attempt
    API carries an error only on the failing path — so the per-device rejections
    are recorded when NOTHING got through and are otherwise left to the
    stale-token cleanup, which acts on the same signal. Naming the gap here
    rather than filing a partial delivery as an outright failure: the person was
    notified, and a count of notifications that says otherwise is wrong in the
    direction that matters.

    Lives here and is used by `push_service.send_push` too. Both post the same
    payload to the same endpoint, and this ticket format belongs to Expo rather
    than to either module — push_service already carries a note about what a
    second copy of a shared vocabulary costs.

    Never raises, and every `.get` sits behind an isinstance check rather than
    trusting the shape. Both callers run this on the line before work that must
    still happen: an unexpected payload would otherwise cost the stale-token
    cleanup here and the failure branch there.
    """
    rows = [t for t in tickets if isinstance(t, dict)] if isinstance(tickets, list) else []
    ids = [str(t.get("id")) for t in rows if t.get("status") == "ok" and t.get("id")]
    refusals = "; ".join(
        str((t.get("details") or {}).get("error") or t.get("message") or "error")
        for t in rows if t.get("status") == "error"
    )
    if ids:
        att.sent(",".join(ids), provider="expo")
        return
    att.failed(refusals or "expo returned no tickets", provider="expo")


async def send_expo_push(
    pool, *, user_id: str, title: str, body: str, url: str = "/",
    task_id: str | None = None, org_id: str | None = None,
    kind: str | None = None,
):
    """Send an Expo push notification to all registered devices for a user.

    `org_id` and `kind` are for the outbound record only and change nothing
    about what is delivered. Both are PASSED IN OR LEFT NULL. In particular the
    org is never looked up from `user_id`: a user belongs to more than one org
    here, so a lookup would file every push under whichever row came back first,
    and a row under the wrong org is a wrong answer to "what did we send this
    org" that nothing afterwards makes look wrong. A NULL says "not known",
    which is true.
    """
    from outbound import begin
    # `ref` carries the kind for the same reason `push_service.send_push` does:
    # the writer reads the head of `ref` as `purpose`, so the cause of the push
    # and the bucket it is counted in stay one word. `purpose` is passed as well
    # so that a caller with no kind still lands somewhere real — `kind or
    # _PURPOSE` is exactly the head `ref` would have given when there is one.
    att = begin(_CHANNEL, user_id, title, org_id=org_id, user_id=user_id,
                ref=kind, purpose=kind or _PURPOSE)
    if att.blocked:
        return

    # Every return below closes the row it was opened with. `begin()` records
    # the attempt at the gate, before this function knows whether there is a
    # device to send to, so a bare `return` would leave a row reading 'queued'
    # forever — and 'queued' is how a process that died mid-send looks. These
    # are not that: nothing reached Expo and the reason is known, so they say so.
    try:
        rows = await pool.fetch(
            "SELECT token, device_id FROM push_tokens WHERE user_id=$1", user_id
        )
    except Exception as exc:
        logger.warning("expo_push: failed to fetch tokens for %s: %s", user_id, exc)
        att.failed(exc)
        return

    if not rows:
        att.failed("no registered device")
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
        att.failed(exc, provider="expo")
        return

    report_expo(att, data)

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


async def fan_out_expo_push(
    pool, *, user_ids: list[str], title: str, body: str, url: str = "/",
    task_id: str | None = None, org_id: str | None = None,
    kind: str | None = None,
):
    """Send Expo push to multiple users concurrently.

    One `org_id` for the whole fan-out: a fan-out is one event reaching several
    people in the same org. A caller whose recipients span orgs has no single
    right answer here and should leave it out rather than pick one.
    """
    if not user_ids:
        return
    await asyncio.gather(
        *(send_expo_push(pool, user_id=uid, title=title, body=body, url=url,
                         task_id=task_id, org_id=org_id, kind=kind)
          for uid in user_ids),
        return_exceptions=True,
    )
