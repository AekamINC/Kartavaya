"""
samvaad_message_notify.py — a notification when somebody SENDS A MESSAGE.

── What was broken ───────────────────────────────────────────────────────────

Measured on the live database, read-only, 2026-08-20: `staging.samvada_messages`
holds 1,177 rows and `public.notifications` holds ZERO rows of any message-shaped
type. Every notification type that exists there is task-shaped
(`deadline_warning_*`, `assigned`, `done`, `reminder`, `status_changed`,
`approval*`, `comment`) with one exception — `mention`, 35 rows, written by
`services/samvaad_mentions.py`.

So the owner's report ("when someone messages, no notifications are coming") is
not a delivery bug and never was. Sending a message wrote a row into
`samvada_messages`, bumped `samvada_channels.updated_at`, and — unless the text
happened to contain an `@` that resolved — did nothing else. There was no
notification to fail to deliver. `samvada_mentions` is the ONLY thing in this
module that has ever written a `notifications` row.

This module is the missing writer. It is separate from `samvaad_mentions`
because the two answer different questions: that one asks "who was NAMED", this
one asks "who is in the room". They share the deep-link shape and the body
preview (imported from there, not copied — `_link_prefix`, `_deep_link` and
`_notification_body`) and nothing else.

── THE FIVE DECISIONS, and why each went the way it did ──────────────────────

D1 · WHO GETS ONE
     Every member of the channel except the sender, minus four exclusions:

       · MUTED members. `samvada_channel_members.muted` is the per-channel
         switch this product already ships (`PUT /channels/{id}/mute`), and it
         is the ONLY switch a user has over this notification — see the note on
         `NOTIF_TYPE` about `DEFAULT_PREFS`. Honouring it is not optional.
         (A mute on a channel you never joined writes a membership row stamped
         `joined_at = '-infinity'`; unmuting DELETES that row. So a sentinel row
         always carries `muted = TRUE` and the mute filter already covers it.
         There is deliberately no second `joined_at` predicate here — two tests
         of one fact is how they come to disagree.)

       · Anyone the MENTION fan-out already resolved. See D2.

       · On a THREAD REPLY, everybody who is not in the thread. A reply is not
         in the channel log at all: `list_messages` and every unread count in
         `routers/messaging.py` filter `parent_message_id IS NULL`, so a reply
         does not appear in the room and does not move the room's badge. Telling
         six people about a message that is invisible in the only view they
         have, reachable solely through this notification's `&thread=` deep
         link, is noise for the four who were not in the conversation. The
         audience for a reply is therefore the thread: whoever wrote the root
         and whoever has replied under it. Anyone NAMED in the reply still hears
         about it, through the mention path, exactly as before.

       · Non-members of a PUBLIC channel. They can read the room; they never
         joined it. `samvaad_mentions._readable_by` deliberately widens to the
         whole org for a public channel, because being named by hand is an act
         aimed at a person. A message is not aimed at anybody, so the audience
         here is membership and only membership. Widening it would notify every
         person in the organisation about every message in every public channel.

     "Every member except the sender is probably wrong for a busy channel" —
     the fix for a busy channel is D3, not a narrower audience. Once ten
     messages collapse into one row, a busy channel costs a member exactly one
     inbox entry, which is what it should cost.

     NOT excluded: people who are currently online, or currently reading the
     channel. There is no honest signal for it. `samvada_presence` is ORG-wide
     and carries no channel column, so "online" cannot mean "looking at this
     room"; `last_read_at` moves only when the client calls `POST /read`, on
     channel open and on window focus, so it is stale for anyone who has been
     reading with the tab in the background. Suppressing on either would delete
     an in-app row for somebody who may never have seen the message — and there
     is NO QUEUE here, so a suppressed in-app notification is not delayed, it is
     lost. The coalescing in D3 makes this cost nothing anyway: a person who is
     genuinely reading the channel clears the row by opening their inbox once.

D2 · A MENTION IS NOT NOTIFIED TWICE
     `send_message` runs the mention fan-out first and passes what it resolved
     into `already_mentioned` here; everybody in that set is dropped before a
     single row is written. The set is EVERYONE THE MENTION PATH RESOLVED, not
     everyone it notified, and the difference is deliberate:

       · Resolved and notified → excluding them is the whole point: one
         notification, not two.
       · Resolved but MUTED → `samvaad_mentions` writes their mention row and
         deliberately sends no notification. They are muted here too, so the
         exclusion changes nothing; it is stated so the two paths cannot drift.
       · Resolved but dropped by `BROADCAST_NOTIFY_MAX_RECIPIENTS` → a
         deliberate downgrade over there (mention row and `@` badge, no inbox
         row, no push). If this path then handed each of them a "new message"
         notification it would spend exactly the fan-out that ceiling exists to
         refuse, and it would do it silently. The ceiling's decision stands.

     If the mention fan-out is SKIPPED or FAILS — 093 not applied, or the guard
     in `routers/messaging.py` swallowing an error — the set arrives empty and
     the mentioned person gets the ordinary message notification instead. One
     notification, never two, and never zero.

D3 · BATCHING: ONE UNREAD ROW PER RECIPIENT PER CHANNEL
     Not per-message, and not a digest.

     Per-message is what "ten messages, ten notifications" means, and it is what
     makes people switch notifications off entirely. A digest needs a scheduler
     and a queue; there is neither here (`/cron/reports` is a 501 stub and must
     stay one), and a digest also gets a DM wrong — a DM is worth interrupting
     for and worth interrupting for NOW.

     So: coalesce. If the recipient already has an UNREAD `message` notification
     for THIS channel, the new message UPDATES it in place — new title, new
     preview, new deep link, `created_at` bumped to now so it floats to the top
     of the inbox — instead of inserting a second one. Ten messages in a minute
     are one row that says "10 new messages in #general" and points at the
     newest one. Once the recipient reads that row, the next message starts a
     fresh one, because at that point they have caught up and a new arrival is
     genuinely new.

     `COALESCE_WINDOW_HOURS` bounds it at both ends. A row left unread for two
     days is not a live conversation any more, so a message after that starts
     over rather than reviving a stale entry — and, just as importantly, the
     bound is what keeps the lookup cheap: `public.notifications` is indexed
     `(user_id, created_at DESC)` and has no index on `type`, so without a time
     floor the LIMIT 1 probe walks every notification a long-lived user has ever
     received before concluding there is nothing to coalesce into.

     THE COALESCE TARGET IS FOUND BY `url` PREFIX, and that is why `_link_prefix`
     lives in `samvaad_mentions` rather than being written out here. There is no
     channel column on `public.notifications` (no `org_id` either — PROPOSED_076
     is not applied) and `team_id` is a PROJECT id, so writing a channel id into
     it would be a lie that some later join would believe. The url is the only
     honest carrier, it is built by one function, and the probe matches the
     prefix that function guarantees. `type = 'message'` is in the same WHERE,
     so a `mention` row — which shares the url shape — can never be coalesced
     into and silently relabelled.

D4 · QUIET HOURS SUPPRESS THE DEVICE, NEVER THE RECORD
     The row is written unconditionally, above every gate, exactly as
     `server.create_notification` does it and exactly as `samvaad_mentions`
     does it. Nothing in this file asks the clock before writing.

     The PUSH goes through `services.push_service.send_push`, which is the one
     helper that consults `notification_prefs` AND the quiet window
     (`prefs_allow` → `prefs_verdict(quiet_hours_apply=True)`). That is the
     correct gate for an interrupting channel and the correct gate ONLY for an
     interrupting channel: `prefs_verdict`'s own docstring records that quiet
     hours applied to a silent channel do not delay the message, they destroy
     it, because there is no queue to hold it. So a message that arrives at 2am
     buzzes nobody and is sitting in the inbox at 8am with its real timestamp.

     There is no third delivery path invented here. `push_service`'s module
     docstring asks that any new path be gated through it; this one is.

D5 · A DM PUSHES. A CHANNEL DOES NOT.
     The schema supports the distinction: `samvada_channels.type` is
     `public | private | dm` (058), and `find_or_create_dm` is what writes the
     third. (Live today: 63 public, 12 private, 0 dm — the DM path exists in the
     product and has not been used yet, so this rule is being written before it
     can be got wrong rather than after.)

     A DM is addressed to one person and cannot be anything else; it is worth a
     device buzz. A channel message is addressed to a room, and a room that
     buzzes every phone in it for every line is a room whose members turn
     notifications off — which costs them the mentions and the DMs too. This is
     also Slack's own default (direct messages and mentions push; channel
     activity does not), so it is the behaviour people already expect.

     Channel messages therefore get the in-app row and no push. A channel
     message that NAMES you still pushes, through `samvaad_mentions`, which is
     the whole point of naming somebody.

     `PUSH_REARM_MINUTES` is the one softening. A DM that coalesces into a row
     the recipient has been ignoring for half an hour buzzes again; one that
     coalesces into a row from ninety seconds ago does not. Without it a
     conversation that runs all afternoon buzzes once and then goes silent for
     the rest of the day; with it, ten rapid messages are one buzz and the reply
     an hour later is another.

── No websockets, no realtime publish, no email ──────────────────────────────

Nothing is published anywhere. The in-app toast is driven by a POLL:
`NotificationContext` calls `GET /notifications/poll` on a 60-second interval
and `NotifToast` renders what that returns. Writing the row IS the delivery.
There is no realtime channel to publish to and none is touched here — the known
platform fault about realtime publishing with RLS off is not on this path.
No email either, for the reason `samvaad_mentions` gives: there is no task id to
build a deep link from and the email templates are all task-shaped.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from services.audit_actors import display_name

logger = logging.getLogger(__name__)

#: The `type` written into `public.notifications`.
#:
#: `'message'` IS A NEW STRING IN THAT COLUMN and that is a deliberate, narrow
#: choice rather than an oversight. Two rules pull in opposite directions:
#:
#:   · `frontend/src/pages/inbox/notifKinds.js` carries a banner forbidding a
#:     ninth KIND, because a kind with no row in the preference table is a kind
#:     the user cannot switch off.
#:   · Reusing an existing kind would be worse. `'mention'` would put every
#:     message in the inbox's Mentions tab (`matchesTab` filters on the kind) and
#:     destroy the one Sanvaad signal that works. `'comment'` renders as "New
#:     comment" — a task's comment — and its `DEFAULT_PREFS` mode is
#:     `mine_only`, which would silence every channel message permanently.
#:
#: So this is a TYPE and not a ninth KIND, and the two are different things in
#: that file: `kindKeyOf` returns null for it, it renders with the neutral dot
#: and its own title, and it claims no category the preference table cannot
#: switch off. That file's own text says this is the honest outcome for an
#: unmapped type, and names `workload_warning`, `automation`, `status_changed`,
#: `done` and `created` as the ones already living that way.
#:
#: THE SWITCH-OFF STILL EXISTS, which is what makes it acceptable: it is
#: `PUT /channels/{id}/mute`, per channel, honoured at D1 above — a better
#: control for chat than one global on/off would be.
#:
#: SETTLED. The `"message"` row now exists in `push_service.DEFAULT_PREFS`, the
#: switch is rendered by `components/customize/NotifyPrefs.jsx`, and
#: `pages/inbox/notifKinds.js` carries the kind, so the inbox row names itself
#: rather than falling to the neutral dot. `server.py` no longer keeps a copy of
#: the dict — it imports the one name.
#:
#: The stored default is `always`, which is what `_resolve_mode` already
#: resolved to via `DEFAULT_PREFS.get(kind, MODE_ALWAYS)`. Nobody's delivery
#: changes; what changes is that the gate is now reachable, so a user can turn
#: this down instead of muting notifications wholesale.
NOTIF_TYPE = "message"

#: How long an unread `message` notification stays coalescible. See D3.
#:
#: Two jobs in one number, and the smaller one is the reason it is not larger:
#: `public.notifications` is indexed `(user_id, created_at DESC)` with nothing on
#: `type`, so this is the floor that stops the probe walking a user's entire
#: notification history.
COALESCE_WINDOW_HOURS = 48

#: A coalesced DM buzzes again once the row it is folding into is this old. See
#: D5. Ten messages in a minute are one buzz; the reply an hour later is another.
PUSH_REARM_MINUTES = 30

#: How many people ONE message may be notified about.
#:
#: A DIFFERENT PRESSURE from `samvaad_mentions.BROADCAST_NOTIFY_MAX_RECIPIENTS`,
#: and it is worth saying why, because the number is the same and the reasoning
#: is not. Over there the cost is per-recipient: one Expo round trip each, so
#: 300 members meant 300 HTTP calls started from inside the sender's request.
#: Here the row fan-out is THREE statements whatever the audience size — one
#: probe, one UPDATE, one INSERT, all `unnest` — and channels do not push at
#: all, so the marginal cost of the 300th recipient is one array element.
#:
#: The ceiling is therefore a bound on the pathological case rather than a
#: routine brake, and it is set at the same number so that one Sanvaad fan-out
#: cannot be quietly larger than the other. Over it, NOTHING is written and a
#: WARNING names the count: the channel's own unread badge is untouched and
#: still counts every message, so the room does not go dark — it stops buying an
#: inbox row per person per conversation.
#:
#: Live today the largest channel has 6 members, so this has never fired.
MAX_RECIPIENTS = 200

#: Enough of the message to recognise it. Same number as the mention path uses,
#: because they land in the same inbox list and a preview that is 140 characters
#: from one writer and 200 from another reads as a bug.
_PREVIEW_CHARS = 140


def _title(*, actor_name: str, channel_label: str, is_dm: bool,
           unread: int, is_reply: bool) -> str:
    """What the inbox row says.

    The count comes from the recipient's own unread count for the channel, which
    is the same expression the channel badge uses — so the row and the badge
    cannot disagree about how much there is to read.

    A THREAD REPLY ALWAYS READS AS ONE, and that is correct rather than a gap:
    the unread count filters `parent_message_id IS NULL`, so replies genuinely do
    not accumulate in it. Saying "3 new messages" over a thread reply would be
    quoting a number that counts something else.

    `unread` ARRIVES AS 0 WHEN THERE IS NO READ CURSOR (`last_read_at IS NULL`,
    22 of 170 live member rows) and the sender is named instead of a count being
    invented. See the probe query for why that is not the same as `/live`'s
    answer, and why the difference is deliberate.
    """
    if is_reply:
        return (f"{actor_name} replied in a thread" if is_dm
                else f"{actor_name} replied in a thread in {channel_label}")
    if unread > 1:
        return (f"{unread} new messages from {actor_name}" if is_dm
                else f"{unread} new messages in {channel_label}")
    return actor_name if is_dm else f"{actor_name} in {channel_label}"


async def _thread_audience(pool, org_id: str, root_id) -> list[str]:
    """Everybody in this thread: whoever wrote the root, and whoever replied.

    Threads here are FLAT — `parent_message_id` is the root and not the message
    one level up, which is why one `OR` covers the whole conversation and no
    recursive query is needed. `routers/messaging.py:send_message` refuses a
    reply to a reply, and `get_thread` reads the direct children of one id, so
    there is no deeper shape for this to miss.

    Deleted messages are excluded. Somebody whose only contribution to a thread
    has been deleted is not in the conversation any more.

    The senders returned here are not filtered for channel membership, because
    they do not need to be: posting into a channel joins you to it
    (`send_message` auto-joins on a public channel), so every one of these has a
    membership row, and the caller intersects with that table anyway.
    """
    rows = await pool.fetch(
        """
        SELECT DISTINCT sender_id
          FROM public.samvada_messages
         WHERE org_id = $1::uuid
           AND (id = $2::uuid OR parent_message_id = $2::uuid)
           AND is_deleted = FALSE
        """,
        org_id, root_id,
    )
    return [r["sender_id"] for r in rows]


async def _push_one(pool, *, org_id: str, uid: str, title: str, body: str,
                    url: str) -> None:
    """One push, behind the shared fan-out gate. Never raises.

    Detached, so a raise has no caller to reach — it would surface as "Task
    exception was never retrieved" at garbage-collection time, in a line naming
    neither the recipient nor the message. Everything is caught and named here.

    THE GATE IS `samvaad_mentions._push_gate()`, not a second one of our own.
    Both Sanvaad fan-outs compete for the same ten connections in `db.py`, and
    two independent semaphores of four would be a budget of eight. It is
    imported inside the function, like everything else in this module, so the
    import graph at module scope stays empty and no future import can close a
    cycle at start-up.

    `is_mine=True` matches `samvaad_mentions._push_one` and is the same
    argument: a direct message is addressed to the recipient, so a `mine_only`
    preference must not swallow it. (Today no `message` row exists in
    `DEFAULT_PREFS` at all, so the mode resolves to `always` — see `NOTIF_TYPE`.
    This is written for the day that row is added.)
    """
    try:
        from services.push_service import send_push
        from services.samvaad_mentions import _push_gate
        async with _push_gate():
            await send_push(
                pool,
                recipient_id=uid,
                kind=NOTIF_TYPE,
                title=title,
                body=body,
                task_id=None,
                data={"url": url},
                is_mine=True,
                org_id=org_id,
            )
    except Exception as exc:
        # A device that cannot be buzzed must not cost anybody their inbox row,
        # which is already on disk by the time this runs.
        logger.warning("sanvaad message push failed for %s: %s", uid, exc)


async def fan_out_message_notification(
    pool, *, org_id: str, channel_id, message_id, actor_id: str, content: str,
    parent_message_id=None, message_type: str = "text",
    already_mentioned: frozenset[str] | set[str] = frozenset(),
) -> int:
    """Notify the room about a message THAT IS ALREADY COMMITTED. Returns the
    number of people notified.

    Called from inside `send_message`, on the send path only. NOT on edit and
    NOT on delete: an edit is not a new message, and re-notifying a channel
    because somebody fixed a typo is the failure mode `samvaad_mentions` spends
    a paragraph avoiding.

    In-request rather than `_bg()`, for the same reason the mention fan-out is:
    a background task is dropped silently on a Railway restart, and a
    notification that silently never happened is indistinguishable from the bug
    this module was written to fix. The cost is bounded — one `fetch` and at
    most two `execute`s, none of them per-recipient — and the push, which is the
    only part that can be lost without losing the record, is the only part that
    is detached.

    Every DB write here is an INSERT or an UPDATE of `public.notifications` for
    the recipients computed below. Nothing else is written.
    """
    # A system message is machinery — "X added Y to the channel" — not somebody
    # talking. `send_message` accepts `text` and `system`; only the first is a
    # person, and only a person is worth an interruption.
    if message_type != "text":
        return 0

    channel = await pool.fetchrow(
        "SELECT id, name, type FROM public.samvada_channels "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not channel:
        # The router resolved this row two statements ago. If it is gone now,
        # the channel was deleted underneath the send and there is no room left
        # to notify.
        return 0

    is_dm = channel["type"] == "dm"
    # A DM's `name` is `''` (`find_or_create_dm` inserts it empty), so `#` plus
    # the name renders as a bare `#`. Every DM title names the sender instead —
    # see `_title` — so the label is never reached on that branch.
    label = "" if is_dm else f"#{channel['name']}"

    is_reply = parent_message_id is not None
    thread_only: list[str] = []
    if is_reply:
        thread_only = await _thread_audience(pool, org_id, parent_message_id)
        # The sender is the only person in a thread they just started a reply
        # in — nobody to tell.
        if not [uid for uid in thread_only if uid != actor_id]:
            return 0

    # ── One probe: the audience, their mute flag, their unread count, the row
    # to coalesce into, and the sender's display name.
    #
    # The `notifications` LATERAL is D3's coalesce target. `type` is in the
    # WHERE so a `mention` row — same url shape, different meaning — can never
    # be picked up and relabelled, and `make_interval(hours => $N::int)` is the
    # time floor that keeps the probe off the tail of a long notification
    # history. `read_at IS NULL` is the rest of the rule: a row the recipient
    # has already read is not a row to fold into.
    #
    # The unread count is the expression `GET /live` uses for the channel badge,
    # so the inbox row and the badge cannot disagree about how much is waiting —
    # WITH ONE DELIBERATE DIFFERENCE. `/live` reads a NULL `last_read_at` as
    # `'-infinity'`, so a member who has never opened the channel counts its
    # ENTIRE history as unread; 22 of the 170 live member rows have that NULL.
    # On a badge that is a wrong number. In a notification title it is a
    # sentence — "944 new messages in #general" for one message — so the count
    # is NULL here when there is no read cursor, and `_title` falls back to
    # naming the sender. Understating beats inventing.
    #
    # The `/live` badge itself is NOT corrected here: it is another handler, the
    # same shape appears in `GET /unread`, and the fix belongs with whoever owns
    # the badge. Reported, not silently diverged from without saying so.
    #
    # The sender's name is a scalar sub-select in the SELECT list rather than a
    # second `fetchrow`. It repeats down the rows, which costs nothing at these
    # sizes, and it keeps this whole step to ONE round trip — `send_message` is
    # on the request path and `tests/test_messaging_security.py` orders its
    # `fetchrow` stubs by call sequence, so an extra `fetchrow` here would break
    # a dozen tests that are not about notifications at all.
    #
    # EVERY PARAMETER IS CAST. `user_id` is TEXT (`user_<hex>`, never a uuid);
    # `channel_id` is a uuid; PgBouncer turns an untyped parse error into an
    # instant 500 rather than into a message anybody can read.
    # NOT an f-string over REQUEST DATA, and never one: no value reaches this
    # statement except as a bind parameter, and the only text ever appended to
    # it is the fixed thread predicate below. The one interpolation is
    # `audit_actors.display_name`, which is composed entirely of that module's
    # own string constants plus a literal alias written here — no request data
    # and no `$n`, so the `$2`/`$5` numbering is untouched.
    #
    # THE ACTOR LADDER NO LONGER ENDS AT AN EMAIL. THE OWNER RULED (2026-08-23)
    # that a display-name ladder must never do so: Aekam must not see client
    # emails, and a person is named by their name — an email used as a display
    # fallback is a CONTACT DETAIL rendered as a LABEL, and this one is rendered
    # into a notification title and pushed to a device. MEASURED FIRST,
    # read-only, on the live database: **0 of 35 accounts** have neither
    # `full_name` nor `name`, so the rung has never fired on real data.
    #
    # NOT LEFT BLANK — a blank sender reads as "nobody sent this", a different
    # and false claim — so it ends at `'Unnamed member'`, the wording
    # `routers/procurement.py:391` already uses rather than a third phrasing.
    # A DELETED actor still returns no row from this scalar sub-select, so it is
    # still NULL and the `or "Someone"` fallback still covers that case; the new
    # terminal only fires for an account that exists and has no name.
    sql = f"""
        SELECT cm.user_id,
               cm.muted,
               (SELECT {display_name('u')}
                  FROM users u WHERE u.user_id = $2::text) AS actor_name,
               CASE WHEN cm.last_read_at IS NULL THEN NULL ELSE (
                    SELECT COUNT(*)
                      FROM public.samvada_messages m
                     WHERE m.channel_id = cm.channel_id
                       AND m.is_deleted = FALSE
                       AND m.parent_message_id IS NULL
                       AND m.sender_id <> cm.user_id
                       AND m.created_at > cm.last_read_at
               ) END AS unread,
               n.notification_id AS prev_id,
               (n.created_at < now() - make_interval(mins => $5::int)) AS prev_stale
          FROM public.samvada_channel_members cm
          LEFT JOIN LATERAL (
               SELECT notification_id, created_at
                 FROM notifications
                WHERE user_id = cm.user_id
                  AND type = $3::text
                  AND read_at IS NULL
                  AND url LIKE $4::text
                  AND created_at > now() - make_interval(hours => $6::int)
                ORDER BY created_at DESC
                LIMIT 1
          ) n ON TRUE
         WHERE cm.channel_id = $1::uuid
           AND cm.user_id <> $2::text
    """
    # Built beside the SQL rather than passed unconditionally: asyncpg binds
    # POSITIONALLY and raises `InterfaceError: the server expects 6 arguments
    # for this query, 7 were passed` — it does not ignore the spare. The channel
    # arm has no `$7`, so handing it the thread array would 500 every ordinary
    # message while thread replies carried on working.
    from services.samvaad_mentions import _link_prefix
    args = [
        channel_id, actor_id, NOTIF_TYPE, _link_prefix(channel_id) + "%",
        PUSH_REARM_MINUTES, COALESCE_WINDOW_HOURS,
    ]
    if is_reply:
        sql += "\n           AND cm.user_id = ANY($7::text[])"
        args.append(thread_only)

    rows = await pool.fetch(sql, *args)

    # D1 and D2, in one pass. `muted` is the user's own switch; `already_mentioned`
    # is the mention path's claim on these people — see D2 for why it is the
    # RESOLVED set and not the notified one.
    targets = [
        r for r in rows
        if not r["muted"] and r["user_id"] not in already_mentioned
    ]
    if not targets:
        return 0

    if len(targets) > MAX_RECIPIENTS:
        # Loud, and it names the number. A ceiling that trims silently reads to
        # everybody as "the room was notified", and the first evidence otherwise
        # is a colleague who never heard.
        logger.warning(
            "sanvaad message fan-out over ceiling: org=%s channel=%s actor=%s "
            "message=%s - %d recipients, ceiling %d. NO notification rows were "
            "written for this message. The channel's own unread badge is "
            "unaffected and still counts it.",
            org_id, channel_id, actor_id, message_id,
            len(targets), MAX_RECIPIENTS,
        )
        return 0

    actor_name = (targets[0]["actor_name"] or "Someone")
    from services.samvaad_mentions import _deep_link, _notification_body
    body = _notification_body(content)
    if not body:
        # `notifications.message` is NOT NULL, and an empty preview renders as a
        # blank row that says nothing happened. An attachment-only or
        # whitespace-only message is still a message.
        body = "Sent a message"
    # `parent_message_id` IS the thread root — threads are flat — so it is
    # exactly what `_deep_link`'s third argument wants. Without it the reader is
    # dropped at the bottom of the channel with nothing highlighted and the
    # thread closed, because a reply is never in the channel log and so never in
    # the DOM.
    url = _deep_link(channel_id, message_id, parent_message_id)

    coalesce_ids, coalesce_titles = [], []
    insert_ids, insert_users, insert_titles = [], [], []
    push_to: list[tuple[str, str]] = []

    for r in targets:
        title = _title(
            actor_name=actor_name, channel_label=label, is_dm=is_dm,
            unread=int(r["unread"] or 0), is_reply=is_reply,
        )
        if r["prev_id"]:
            coalesce_ids.append(r["prev_id"])
            coalesce_titles.append(title)
            # D5's re-arm: a DM folding into a row the recipient has been
            # ignoring for half an hour buzzes again; one folding into a row
            # from ninety seconds ago does not.
            if is_dm and r["prev_stale"]:
                push_to.append((r["user_id"], title))
        else:
            # `notification_id` has NO column default — it is a bare TEXT unique
            # key — so every writer in this codebase mints its own
            # `notif_<12 hex>`. Minting it here rather than in SQL keeps ONE
            # implementation of that id format; an
            # `'notif_' || substr(md5(random()::text),1,12)` expression would be
            # a second, different one.
            insert_ids.append(f"notif_{uuid.uuid4().hex[:12]}")
            insert_users.append(r["user_id"])
            insert_titles.append(title)
            if is_dm:
                push_to.append((r["user_id"], title))

    # ── The rows. Written UNCONDITIONALLY and above every gate: quiet hours and
    # a switched-off preference suppress the DEVICE, never the record. There is
    # no queue behind an in-app notification, so one suppressed for the hour is
    # not delayed, it is lost. `server.create_notification` states the same rule
    # in the same order and `tests/test_quiet_hours_parity.py` pins it for the
    # other two delivery paths.
    if coalesce_ids:
        # THE BATCHING, in one statement. `created_at = now()` is what lifts the
        # folded row back to the top of the inbox — without it, ten messages
        # would update a row the reader has already scrolled past.
        #
        # `read_at IS NULL` is repeated here even though the probe already
        # filtered on it: the probe and this UPDATE are two round trips, and a
        # recipient who opened their inbox in between must not have a row they
        # have just read silently marked unread again.
        #
        # Every parameter cast — `UPDATE … FROM unnest(...)` is the same "general
        # SELECT" parse path that makes a bare `$n` in an `INSERT … SELECT` come
        # back as "could not determine data type of parameter".
        await pool.execute(
            """
            UPDATE notifications AS n
               SET title      = x.title,
                   message    = $3::text,
                   url        = $4::text,
                   created_at = now()
              FROM unnest($1::text[], $2::text[]) AS x(nid, title)
             WHERE n.notification_id = x.nid
               AND n.read_at IS NULL
            """,
            coalesce_ids, coalesce_titles, body, url,
        )

    if insert_ids:
        # ONE round trip for the whole fan-out, in the same `unnest` shape the
        # mention path uses.
        #
        # `task_id` IS NOT NAMED, and that is load-bearing. `InboxPage.jsx:59`
        # reads `if (n.task_id) setDrawerTaskId(n.task_id); else if (n.url)
        # navigate(n.url)` — any non-null value there opens an EMPTY TASK DRAWER
        # instead of the channel, and the url is never read. Leaving the column
        # out of the statement is what keeps it NULL.
        #
        # `team_id` is left out for a different reason: it is a PROJECT id. A
        # channel is not a project, and there is no join that would survive
        # putting a channel id in that column.
        await pool.execute(
            """
            INSERT INTO notifications
                (notification_id, user_id, type, title, message, url)
            SELECT x.nid, x.uid, $4::text, x.title, $5::text, $6::text
              FROM unnest($1::text[], $2::text[], $3::text[])
                AS x(nid, uid, title)
            """,
            insert_ids, insert_users, insert_titles, NOTIF_TYPE, body, url,
        )

    # ── The device. LAST, and only after the rows are on disk, so a push that
    # is refused — by preference or by the clock — leaves the inbox entries
    # intact. `send_push` is the gate (see D4); nothing here asks the clock.
    #
    # D5: `push_to` is empty for every channel message, so this loop does not
    # run at all outside a DM.
    if push_to:
        from services.samvaad_mentions import _PUSH_TASKS
        for uid, title in push_to:
            try:
                task = asyncio.ensure_future(
                    _push_one(pool, org_id=org_id, uid=uid, title=title,
                              body=body, url=url)
                )
                # `asyncio.ensure_future` returns a task the loop holds only
                # weakly: with no strong reference the push can be collected
                # mid-flight and vanish with no log line at all. The same set the
                # mention path uses, for the same reason.
                _PUSH_TASKS.add(task)
                task.add_done_callback(_PUSH_TASKS.discard)
            except Exception as exc:
                # `_push_one` swallows its own failures; this catches the ones
                # that happen before it ever runs — no running loop, a rejected
                # task. The send is not failed for either.
                logger.warning(
                    "sanvaad message push could not be scheduled for %s: %s",
                    uid, exc,
                )

    return len(targets)
