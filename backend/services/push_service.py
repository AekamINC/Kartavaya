"""
push_service.py — Kartavaya push notifications via Expo Push API.

send_push(pool, *, recipient_id, kind, title, body, task_id=None, data=None, is_mine=True,
          org_id=None)
    Checks user prefs + quiet hours (IST = UTC+5:30) then fires.

fan_out_push(pool, *, recipient_ids, kind, title, body, task_id, is_mine_for, org_id=None)
    Calls send_push concurrently; is_mine_for is a set of user_ids who "own" the event.

prefs_allow(pool, user_id, kind, is_mine=True)
    The preference gate on its own, with no delivery attached. Exists so the
    OTHER push path can consult preferences too — see "The second path" below.

normalise_prefs() / normalise_window()
    Validation for the PUT that writes this table. The endpoint currently writes
    whatever JSON it is handed; these make that safe. See each docstring.


The other two paths — NOW GATED
──────────────────────────────
`send_push()` below is preference-aware, and it was never the only way a push
left this system. Two other paths called `send_web_push()` / `send_expo_push()`
directly — neither of which takes a `kind` or reads `notification_prefs` at all
— so everything raised through them ignored the user's settings completely:

  · `server.py:create_notification()` — the main helper. `approval_request`,
    `assigned`, `comment`, `approved`, `rejected`, `status_changed`, `done`.
  · `routers/task_reminders.py` — the due-date cron. `reminder`.

The preference for those kinds was never missing from the vocabulary: it is
right there in DEFAULT_PREFS and the customize hub renders a switch for each.
It was simply never consulted on either path, which is worse than a missing
switch — the user sets it, watches it save, and still gets the notification.

`prefs_allow()` is the gate, and it lives here because this is where the gate
belongs. **Both call sites now consult it**: `server.py:_push_if_allowed` and
the `channel_push` branch in `task_reminders.dispatch_reminders`. Pinned by
`tests/test_quiet_hours_parity.py`, which also asserts that each writes its
notification ROW above the gate — quiet hours suppress the device, never the
record.

If you add a third delivery path, gate it here too. That is the whole lesson of
the first two.
"""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from services.expo_push_service import report_expo

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

#: The channel this path records under. Deliberately NOT the same string as
#: `expo_push_service`'s `push:expo`, even though both end at the same Expo
#: endpoint: the two paths differ in whether the user's preferences and quiet
#: hours were consulted, and a table that could not tell them apart could not
#: answer "was this person notified through the gate or around it" — which is
#: the question this module's own docstring says was wrong for years.
_CHANNEL = "push"
IST = timezone(timedelta(hours=5, minutes=30))

# pref mode constants
MODE_OFF       = "off"
MODE_ALWAYS    = "always"
MODE_MINE_ONLY = "mine_only"
MODE_PROJECT   = "project"

#: The only modes that mean anything. A stored value outside this set is a
#: corrupted preference, not a new feature.
VALID_MODES: frozenset[str] = frozenset({MODE_OFF, MODE_ALWAYS, MODE_MINE_ONLY, MODE_PROJECT})

#: The delivery vocabulary, and the default for each kind.
#:
#: `reminder` is new here. It is not a re-labelling of an existing kind — it is
#: the one kind that genuinely had NO entry while still firing push
#: (`routers/task_reminders.py`, which calls send_web_push/send_expo_push
#: directly). Adding it changes no behaviour today, because reminders do not
#: route through send_push(); it makes the switch exist so that the call-site
#: fix reported alongside this file has something to read.
#:
#: Default `always`: a reminder is something the user explicitly asked for by
#: setting it on a task. Defaulting an opt-in to off would discard a request the
#: user already made.
#:
#: NOTE: `server.py` carries a byte-identical copy of this dict minus
#: `reminder`. Two copies of a vocabulary is how they drift. The GET endpoint
#: merges against ITS copy, so a kind added only here is enforced but invisible
#: in the UI. Reported — server.py should import this name instead.
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
    "reminder":         "always",
    # A Sanvaad message. `always` is not a new default so much as the one that
    # was already in force: until this row existed `_resolve_mode` fell through
    # to `DEFAULT_PREFS.get(kind, MODE_ALWAYS)`, so the gate was a no-op and
    # quiet hours were doing all the work. What changes is that the user can
    # now turn it DOWN — see services/samvaad_message_notify.NOTIF_TYPE.
    # `mine_only` would be the wrong quiet default here: a message addressed to
    # you is a DM, and DMs are the only messages that push at all.
    "message":          "always",
}

DEFAULT_QUIET_START = "22:00"
DEFAULT_QUIET_END   = "07:00"

#: Strict HH:MM, 00:00–23:59. Anything else is not a time.
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _parse_hhmm(value) -> Optional[int]:
    """Minutes since midnight, or None if `value` is not a valid HH:MM string.

    Returns None rather than raising. The caller that matters is inside
    send_push()'s broad `except Exception`, where a raise does not surface as an
    error — it silently swallows the notification. A malformed quiet_start would
    therefore have disabled ALL push for that user, permanently and invisibly.
    """
    if not isinstance(value, str):
        return None
    m = _HHMM.match(value.strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def _in_quiet_hours(quiet_start: str, quiet_end: str, *, now=None) -> bool:
    """True if `now` (IST) falls inside the quiet window.

    Half-open, [start, end): a window ending at 07:00 is over AT 07:00, so a
    07:00 reminder is delivered. Without that, a window and the alarm at its
    edge disagree by one minute forever.

    Three cases:

      start <  end   plain daytime window, 09:00–17:00.
      start >  end   WRAPS MIDNIGHT, 22:00–07:00. Quiet from 22:00 to 23:59 and
                     again from 00:00 to 06:59 — one window, two arcs of the
                     clock, which is why it cannot be a single comparison.
      start == end   ZERO-LENGTH. Read as "no quiet hours", never as "always
                     quiet". Both readings are defensible from the data alone,
                     so the tie is broken on consequence: reading it as all-day
                     silences every notification a user gets, indefinitely, with
                     no error and nothing on screen to explain it. Reading it as
                     off costs an unwanted buzz the user can fix in one click.

    A window that does not parse is treated as NO quiet hours, for the same
    reason: never let bad data mute someone silently.

    `now` is injectable so the wrap can be tested at a fixed clock instead of
    whenever the suite happens to run.
    """
    start = _parse_hhmm(quiet_start)
    end   = _parse_hhmm(quiet_end)

    if start is None or end is None:
        logger.warning(
            "notification_prefs: unusable quiet window (%r, %r) — treating as no quiet hours",
            quiet_start, quiet_end,
        )
        return False

    if start == end:
        return False

    now_ist = now or datetime.now(IST)
    now_t = now_ist.hour * 60 + now_ist.minute

    if start < end:           # e.g. 09:00–17:00
        return start <= now_t < end
    return now_t >= start or now_t < end   # wraps midnight, e.g. 22:00–07:00


def _mode_allows(mode: str, is_mine: bool) -> bool:
    """Does this mode permit delivery for an event that is/isn't the user's own?

    An unrecognised mode is NOT treated as `always`. The caller resolves it to
    the kind's documented default first (see `_resolve_mode`), so corruption
    degrades to the designed behaviour for that kind rather than to the loudest
    one.
    """
    if mode == MODE_OFF:
        return False
    if mode == MODE_ALWAYS:
        return True
    if mode == MODE_MINE_ONLY:
        return is_mine
    if mode == MODE_PROJECT:
        return True   # project-level events are always relevant
    return True


def _coerce_prefs(raw) -> dict:
    """A prefs dict from whatever the driver handed back.

    `db.py` registers a jsonb codec but SKIPS IT when the connection is behind
    PgBouncer, logging a warning and carrying on (db.py:41). So this column
    arrives as a dict most of the time and as a raw JSON string some of the
    time. The old code called `.get()` on it unconditionally; on the string path
    that raises AttributeError inside the broad `except`, and the push vanishes
    with a log line that names the wrong cause. `server.py`'s GET already guards
    this exact case — this is the same guard on the delivery side.
    """
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def _resolve_mode(prefs: dict, kind: str) -> str:
    """The effective mode for `kind`: the user's value if it is a real mode,
    otherwise this kind's documented default, otherwise `always`."""
    mode = prefs.get(kind)
    if isinstance(mode, str) and mode in VALID_MODES:
        return mode
    if mode is not None:
        logger.warning("notification_prefs: unknown mode %r for kind %r — using default", mode, kind)
    return DEFAULT_PREFS.get(kind, MODE_ALWAYS)


# ── Validation for the write path ────────────────────────────────────────────

def normalise_prefs(raw) -> dict:
    """Keep only known kinds with valid modes.

    The PUT endpoint currently stores `body.get("prefs", {})` verbatim: any key,
    any value, any depth, straight into jsonb. That is how a mode becomes the
    string "Off" or a nested object, and every read of it afterwards has to
    guess. Unknown keys are dropped rather than rejected so that a client one
    version ahead does not 400 the whole save.
    """
    if not isinstance(raw, dict):
        return {}
    return {
        k: v for k, v in raw.items()
        if k in DEFAULT_PREFS and isinstance(v, str) and v in VALID_MODES
    }


def normalise_window(start, end, *, current=None) -> tuple[str, str]:
    """Return a valid (quiet_start, quiet_end), falling back per field.

    `current` is the pair already stored. It is the whole point of this
    function: the PUT reads `body.get("quiet_start", "22:00")`, so a request
    that omits the field does not leave it alone — IT RESETS IT TO THE DEFAULT.
    A client that sends only `{"prefs": {...}}` to flip one switch silently
    overwrites a customised overnight window with 22:00–07:00, reporting
    success. Passing the stored pair as `current` makes the omitted field mean
    "unchanged", which is what every caller already assumes it means.
    """
    cur_start, cur_end = current or (DEFAULT_QUIET_START, DEFAULT_QUIET_END)
    ok_start = start if _parse_hhmm(start) is not None else (
        cur_start if _parse_hhmm(cur_start) is not None else DEFAULT_QUIET_START
    )
    ok_end = end if _parse_hhmm(end) is not None else (
        cur_end if _parse_hhmm(cur_end) is not None else DEFAULT_QUIET_END
    )
    return ok_start, ok_end


#: The window stored for "quiet hours are switched OFF". Any equal pair means
#: off (see `_in_quiet_hours`); this is the one written deliberately.
WINDOW_OFF = ("00:00", "00:00")


def dnd_enabled(quiet_start, quiet_end) -> bool:
    """Is a quiet-hours window actually in force?

    The designed control (`09-customization.md`, and `SetCustomize.jsx`'s
    `SSwitch on={p.dnd}`) is a BOOLEAN switch above the two time fields, and
    `21-notifications-inbox.md`'s `inDND()` returns early on `!prefs.dnd`. The
    `notification_prefs` table has no such column — only `quiet_start` and
    `quiet_end` — so without this the designed switch has nothing to bind to and
    a frontend would have to invent local state for it.

    No migration is needed to represent it, because a zero-length window already
    means "no quiet hours" everywhere in this module. `dnd` is therefore derived,
    not stored: equal (or unparseable) bounds are off, anything else is on.
    """
    s, e = _parse_hhmm(quiet_start), _parse_hhmm(quiet_end)
    return s is not None and e is not None and s != e


def encode_window(dnd: bool, start, end, *, current=None) -> tuple[str, str]:
    """The (quiet_start, quiet_end) to store for a given `dnd` switch position.

    Switching DND off must not discard the user's window — they will switch it
    back on and expect their hours to still be there. But there is nowhere to
    keep it, so an off switch writes WINDOW_OFF and the times return to the
    default next time. Stated here rather than discovered later; a `dnd` column
    is the real fix and belongs in a migration, not in application code.
    """
    if not dnd:
        return WINDOW_OFF
    s, e = normalise_window(start, end, current=current)
    if not dnd_enabled(s, e):
        # "On" with a zero-length window is a contradiction: honouring it
        # literally would silence nothing while the UI shows DND active.
        return DEFAULT_QUIET_START, DEFAULT_QUIET_END
    return s, e


# ── The preference gate, usable without sending ──────────────────────────────

async def prefs_verdict(pool, user_id: str, kind: str, *, is_mine: bool = True,
                        quiet_hours_apply: bool = True) -> tuple[bool, str]:
    """(allowed, why) — the two gates asked separately, and named.

    TWO GATES THAT ARE NOT THE SAME KIND OF THING
    ---------------------------------------------
    A PREFERENCE is a decision: this person said they do not want this. It is
    final, and re-asking later gives the same answer.

    QUIET HOURS are a clock: this person does not want to be INTERRUPTED right
    now. It says nothing about whether they want the message.

    `prefs_allow` collapsed both into one bool, so every caller inherited the
    stricter reading of each — and every refusal said "preference or quiet
    hours", which is two opposite answers to "will I get it later?" wearing one
    sentence.

    WHY `quiet_hours_apply` EXISTS
    ------------------------------
    Quiet hours exist to stop a phone buzzing at 2am. Applying them to a channel
    that does not interrupt does not DELAY the message — there is no queue here
    — it DESTROYS it. An in-app notification is a row in a list the person reads
    when they next open the app, which is the thing quiet hours are protecting
    them for. Niyam's first armed rule was refused at 01:15 IST for exactly this
    reason, and the message was simply lost.

    So the channel decides: anything that buzzes respects the clock, anything
    that waits silently does not. The PREFERENCE gate always applies — an
    explicit "do not tell me about this" is a decision about the message, not
    about the hour.

    Fails OPEN on a database error, as before: a notification the user did not
    ask to silence is a smaller harm than losing an approval request to a
    lookup timeout.
    """
    try:
        row = await pool.fetchrow(
            "SELECT prefs, quiet_start, quiet_end FROM notification_prefs WHERE user_id=$1",
            user_id,
        )
    except Exception as exc:
        logger.warning("prefs_allow: lookup failed for %s: %s — allowing", user_id, exc)
        return True, "the preference lookup failed, so it was allowed"

    if row:
        prefs       = _coerce_prefs(row["prefs"])
        quiet_start = row["quiet_start"] or DEFAULT_QUIET_START
        quiet_end   = row["quiet_end"]   or DEFAULT_QUIET_END
    else:
        prefs, quiet_start, quiet_end = {}, DEFAULT_QUIET_START, DEFAULT_QUIET_END

    if not _mode_allows(_resolve_mode(prefs, kind), is_mine):
        return False, f"this person has turned off {kind!r} notifications"
    if quiet_hours_apply and _in_quiet_hours(quiet_start, quiet_end):
        return False, f"it is quiet hours for this person ({quiet_start}-{quiet_end})"
    return True, "preferences allow it"


async def prefs_allow(pool, user_id: str, kind: str, *, is_mine: bool = True) -> bool:
    """True if this user's preferences permit a PUSH of `kind` right now.

    The original gate, unchanged in behaviour and still the right question for
    an interrupting channel: both gates apply. Kept as the name every existing
    caller uses, and implemented on `prefs_verdict` so there is one copy of the
    logic rather than two that drift.
    """
    allowed, _why = await prefs_verdict(pool, user_id, kind, is_mine=is_mine,
                                        quiet_hours_apply=True)
    return allowed


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
    org_id: Optional[str] = None,
) -> None:
    """Send a push notification to one user, respecting their prefs and quiet hours.

    `org_id` is the org this push belongs to, for the outbound record only — it
    changes nothing about who is notified. It is PASSED IN OR LEFT NULL and is
    never looked up from `recipient_id`: a user belongs to more than one org in
    this product, so a lookup would attribute every push to whichever row came
    back first. A row filed against the wrong org is worse than one filed
    against none — it is a wrong answer to "what did we send this org", and
    unlike a NULL there is nothing about it that looks wrong afterwards.
    """
    # Delivery only — this function writes no notification row (the caller does,
    # above the gate), so suppressing it costs nothing but the device buzz.
    #
    # `kind` goes in `ref` rather than in the title: it is what CAUSED the push —
    # an approval request, a mention — and outbound_log reads the head of `ref`
    # as the row's `purpose`, which is what an audit of "how much does this
    # product interrupt people, and for what" groups by.
    from outbound import begin
    att = begin(_CHANNEL, recipient_id, title,
                org_id=org_id, user_id=recipient_id, ref=kind)
    if att.blocked:
        return

    try:
        if not await prefs_allow(pool, recipient_id, kind, is_mine=is_mine):
            # The user's own settings stopped this, which is neither the kill
            # switch nor a fault — and the vocabulary has no word for it. Left
            # as `failed` with the reason spelled out rather than as `queued`,
            # because `queued` is reserved for "we are still waiting to hear
            # back" and a preference decision is already final. Worth a status
            # of its own the next time this table's vocabulary is opened.
            att.failed("stopped by notification preference or quiet hours")
            return

        token_rows = await pool.fetch(
            "SELECT token FROM push_tokens WHERE user_id=$1", recipient_id
        )
        tokens = [
            r["token"] for r in token_rows
            if r["token"] and r["token"].startswith("ExponentPushToken[")
        ]
        if not tokens:
            att.failed("no registered device")
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

        # The body was thrown away until now: this path checked the status code
        # and nothing else, so a 200 carrying nothing but DeviceNotRegistered
        # was indistinguishable from a delivery. Parsed behind its own guard —
        # a malformed body must still complete the row, not divert into the
        # failure branch below and report a transport error that did not happen.
        try:
            tickets = resp.json().get("data", [])
        except Exception:
            tickets = []
        report_expo(att, tickets)

    except Exception as exc:
        logger.warning("push_service.send_push failed for %s: %s", recipient_id, exc)
        # No `attempted` flag guards this: the Attempt closes on its first
        # answer, so a failure raised after `report_expo` has already spoken
        # cannot overwrite it, and one raised before it is the only answer there
        # is. The flag would have been a second copy of that state.
        att.failed(exc, provider="expo")


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
    org_id: Optional[str] = None,
) -> None:
    """Send push to multiple recipients concurrently.

    One `org_id` for the whole fan-out, because a fan-out is one event reaching
    several people in the same org. Recipients from more than one org are not a
    case this can serve, and passing an org that only fits some of them is the
    wrong-org failure `send_push` refuses to invent — those callers should leave
    it out.
    """
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
            org_id=org_id,
        )
        for uid in recipient_ids
    ], return_exceptions=True)
