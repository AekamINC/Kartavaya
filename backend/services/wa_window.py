"""
wa_window.py — Meta's 24-hour customer service window, decided on the SERVER.

`frontend/src/pages/sanvaad/varta/waWindow.js` already models this window, and
its own header says why that is not enough:

    "The endpoint is still worth adding, because this derivation only sees the
     newest page (50 messages); a conversation with more than 50 outbound
     messages since the last inbound one reads as 'never opened'."

That is the benign half of the problem. The other half is that a UI-only rule is
not a rule at all. `POST /conversations/{id}/messages` took `{content, type}`
from anyone who could reach the route and wrote it straight into
`varta_messages` with no reference to the window — so a closed conversation
could be sent free-form text by curl, by a stale tab whose `windowState` was
computed an hour ago, or by any client that simply did not run our JavaScript.
Meta rejects those at the edge, which means the product's own record of what it
sent diverges from what the customer received, and a Business Account that keeps
attempting them gets rate-limited and eventually flagged.

So the window is derived here, from the whole conversation rather than a page of
it, and the send route refuses on it. The frontend keeps its copy: it is what
turns the composer into a template picker BEFORE the user types, which is a
different job from refusing, and both are wanted.

WHAT THE WINDOW IS
------------------
Meta opens a 24-hour "customer service window" at each INBOUND message. Inside
it, free-form messages of any type are allowed. Outside it — including a
conversation where the customer has never written first — only a template Meta
has APPROVED may be sent.

The clock is the newest inbound message, not the newest message: an outbound
reply does not extend the window, which is the single most common
misunderstanding of this rule and the reason `direction='inbound'` is in the
WHERE rather than an ORDER BY over everything.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

WINDOW_SECONDS = 24 * 60 * 60


def state_from(last_inbound: Optional[datetime], now: Optional[datetime] = None) -> dict:
    """`{open, expires_at, remaining_seconds, ever_inbound}` from one timestamp.

    Pure, so the arithmetic can be tested without a database. `now` is injected
    for the same reason.

    A naive timestamp is read as UTC rather than rejected: asyncpg returns
    TIMESTAMPTZ as aware, but a seed, a fixture or a driver change that hands
    over a naive value must not make this raise inside a send.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    if not last_inbound:
        # Never written to us. Meta treats this as closed, not as open-by-default
        # — a business cannot open a conversation with free-form text.
        return {
            "open": False,
            "expires_at": None,
            "remaining_seconds": 0,
            "ever_inbound": False,
        }

    if last_inbound.tzinfo is None:
        last_inbound = last_inbound.replace(tzinfo=timezone.utc)

    expires_at = last_inbound + timedelta(seconds=WINDOW_SECONDS)
    remaining = int((expires_at - now).total_seconds())
    return {
        "open": remaining > 0,
        "expires_at": expires_at.isoformat(),
        "remaining_seconds": max(0, remaining),
        "ever_inbound": True,
    }


async def window_state(pool, conv_id: str, org_id: str) -> dict:
    """The window for one conversation, over ALL of its inbound messages.

    `org_id` is in the WHERE as well as `conversation_id`. The conversation has
    already been proved to belong to the org by the caller, so this is
    redundant — and it stays, because the day someone reuses this helper without
    that proof is the day the redundancy is the only thing scoping it.
    """
    row = await pool.fetchrow(
        """
        SELECT MAX(created_at) AS last_inbound
        FROM public.varta_messages
        WHERE conversation_id = $1::uuid
          AND org_id = $2::uuid
          AND direction = 'inbound'
        """,
        conv_id,
        org_id,
    )
    last_inbound = row["last_inbound"] if row else None
    return state_from(last_inbound)
