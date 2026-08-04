"""
samvaad_mentions.py — @mentions for Sanvaad CHANNEL messages: resolve, record,
notify, push.

── Why this is not `services/mentions.py` ────────────────────────────────────

`services/mentions.py` is task-shaped. It takes a `task_id`, reads the task's
`team_id`, resolves candidates out of `team_members`, writes a `mentions` row
keyed to a `comment_id`, and sends an email whose deep link is built from the
task id. Not one of those five things exists here: a channel has an `org_id` and
not a `team_id`, `team_members` is the legacy tenant path that must not appear
in new code (`user_roles` is the sole tenant path), the row is keyed to a
`message_id`, and there is no task to link to — so `send_mention_email` would
have to fabricate a task id and would produce a broken link in a real inbox.

The two-pass RESOLUTION STRATEGY is the part worth keeping, and it is
reimplemented here rather than imported, because the query that feeds pass 1 is
the org/channel one and the one over there is the team one. Everything that file
learned the hard way is carried across and is restated below at the line that
depends on it.

── What was actually broken ──────────────────────────────────────────────────

Nothing recorded a Sanvaad mention. The composer inserted `@Full Name `, the
renderer bolded it, and that was the entire feature: no row, no badge, no
notification, no push. Being named in a channel and not being named in a channel
produced byte-identical results. `migrations/093_sanvaad_slack_parity.sql`
creates the table that was missing; this module is the only thing that writes it.

── The five rules that are easy to get backwards ─────────────────────────────

1. A MUTED CHANNEL STILL RECORDS THE MENTION. It suppresses the notification row
   and the push, and nothing else. Muting means "do not interrupt me", not "hide
   this from me" — the mention row is what drives the in-app badge and the
   mentions feed, and deleting someone's evidence that they were addressed by
   name is not a thing a mute switch should do.
2. THE NOTIFICATION ROW IS WRITTEN BEFORE THE PUSH IS FIRED, always, and the
   push is gated while the row is not. That ordering is stated in
   `services/push_service.py`'s module docstring and pinned by
   `tests/test_quiet_hours_parity.py` for the two other delivery paths: quiet
   hours suppress the device, never the record.
3. AN EDIT CAN CREATE A MENTION BUT MUST NEVER RE-SEND ONE. See
   `fan_out_mentions`; the insert's `RETURNING` is what makes that true without a
   read-then-write race.
4. THE DATABASE WRITES ARE NOT WRAPPED IN try/except *HERE*. Push failures are
   caught, at the push, where the alternative is losing the record too. The
   mention insert is left to raise, because a swallow beside the statement hides
   the one failure worth seeing: an `UndefinedColumnError` — 093 not applied, a
   column renamed — is indistinguishable, once caught, from a message that
   mentioned nobody. `frontend/src/__tests__/renderMentions.test.jsx` exists
   because that class of silence had already shipped once.

   THAT RAISE NO LONGER FAILS THE SEND, and this rule used to claim it did.
   Both call sites go through `routers/messaging.py:_fan_out_mentions_guarded`,
   which catches everything and logs at ERROR naming the message id — and it is
   right to. By the time the fan-out runs, the message row is COMMITTED on its
   own connection (`send_message` writes it with a bare `pool.fetchrow`) or the
   edit has already replaced the stored text; nothing raised here can roll
   either back. All a raise can still do is turn a 201 into a 500, and the
   client believes it: `useChannelMessages` strips its optimistic row and toasts
   "Failed to send", so a message that is in the database disappears off the
   sender's screen and they post it again. One unrecorded mention becomes two
   posted messages.

   So the rule is LOUD, NOT FATAL — loud in the log line at the router, which is
   where somebody can act on it, and never in the response, which is where it
   would only lie. Nothing is unrecoverable: every recipient is derived from
   `content`, which is on the row, so an edit re-runs the whole resolution.
5. A BROADCAST HAS A CEILING, AND CROSSING IT IS NOT SILENT. Everything above
   `BROADCAST_NOTIFY_MAX_RECIPIENTS` keeps its `samvada_mentions` rows and loses
   its notification rows and its pushes, with a WARNING that names the count.
   `BROADCAST_FREE_FOR_ALL_MAX_MEMBERS` gates only who may broadcast; this gates
   how far a permitted broadcast can reach. Without it a channel admin's
   `@channel` on a 300-person org is 300 inbox rows and 300 Expo calls started
   from inside the sender's own request.

── No websockets, and no email ───────────────────────────────────────────────

Delivery is the in-app notification row plus Expo push. There is no websocket
anywhere in Sanvaad: Supabase's pooler runs in transaction mode on :6543 where
`LISTEN`/`NOTIFY` does not work, and the service runs multiple gunicorn workers
so an in-process broadcast would reach one worker's clients only. The client
polls. There is no email, for the reason given at the top.
"""
from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
import uuid
import weakref

logger = logging.getLogger(__name__)

#: Single-token handles typed by hand: `@alice`, `@alice.smith`, `@a@b.com`.
#: This CANNOT match a display name containing a space — which is nearly every
#: display name — which is why the display-name pass runs first and why that
#: pass masks what it consumed before this one runs. See `_resolve`.
#:
#: The `(?:^|[^\w@])` prefix is the one change from `services/mentions.py`'s
#: bare `@([\w.-]+)`, and it is the same guard `messageUtils.splitMentions`
#: carries on the render side. Without it `mail@keval.com` resolves a user
#: called Keval and notifies them about a message that contains an email address
#: and not their name — a mention the client does not bold, sent to somebody
#: nobody addressed.
MENTION_RE = re.compile(r"(?:^|[^\w@])@([\w.-]+)")

#: `@here` and `@channel` are stored in `content` as exactly these two ASCII
#: strings, lower-case, because that is what the composer inserts and what
#: `splitMentions` renders. Matching them case-insensitively here would resolve
#: a mention the renderer does not bold — an inserter and a parser that disagree
#: is the original Sanvaad mention bug, so the resolver stays exactly as strict
#: as the renderer.
#:
#: `(^|[^\w@])` keeps `an@here.com` from paging the channel; `(?![\w@])` keeps
#: `@channels` from doing it. A trailing `.`, `!` or `,` is fine — `@here.` at
#: the end of a sentence is a real mention.
_BROADCAST_RE = {
    "here":    re.compile(r"(^|[^\w@])@here(?![\w@])"),
    "channel": re.compile(r"(^|[^\w@])@channel(?![\w@])"),
}

#: `@channel`/`@here` from a non-admin are honoured only on a channel this size
#: or smaller. The choice is between "anyone can page 200 people" and "the
#: feature exists but nobody may use it"; a small team paging itself is normal
#: and a large channel is where the abuse lives, so the line is drawn on member
#: count and channel admins are above it. A non-admin's broadcast on a larger
#: channel resolves to ZERO recipients and the message still posts normally —
#: no error, no partial notify, because half a broadcast is worse than none.
BROADCAST_FREE_FOR_ALL_MAX_MEMBERS = 15

#: How many people ONE broadcast may actually be notified about. A DIFFERENT
#: question from the constant above, and the one that was missing: that one asks
#: *who may page the room*, this one asks *how big a room may be paged*. A
#: channel admin was above the first check and below no second one, so `@channel`
#: on a 300-member org meant 300 notification rows and 300 Expo calls — and any
#: editor can create a public channel, add the whole org (`add_member` only
#: requires membership) and make themselves its admin.
#:
#: Over this line the mention rows are still written and the notification/push
#: fan-out is dropped. That is a DOWNGRADE, not a silencing: the mention row is
#: what lights the channel's `@` badge and what the mentions feed reads, so the
#: broadcast still arrives in-app for everyone — it just stops buying an inbox
#: entry and a device buzz per person. Raising this number costs one row and one
#: HTTP call per additional recipient, on the send path, and that is the only
#: thing to weigh when a real org outgrows it.
BROADCAST_NOTIFY_MAX_RECIPIENTS = 200

#: Distinct hand-typed handles considered in pass 2. A message is not a mailing
#: list; this bounds the work a pathological body can ask for.
_MAX_HANDLES = 25

#: First N characters of the message body carried into the notification.
_NOTIF_BODY_CHARS = 140

#: The query parameter that carries the THREAD ROOT on a mention deep link.
#:
#: THE NAME IS `thread`, and it is pulled out here rather than left inline
#: because it is the half of a contract whose other half cannot import it: a url
#: is a wire format, and `ChannelsTab` reads it with literal
#: `params.get('channel')` / `params.get('message')` calls. The two sides
#: disagreeing about a string is this codebase's most frequent defect, so the
#: string gets a name and a paragraph.
#:
#: The three parameters divide the work cleanly: `channel` picks the room,
#: `thread` decides whether the thread panel opens, `message` is the row to
#: highlight — in the log when `thread` is absent, inside the panel when it is
#: not. A client that reads `parent` or `root` instead finds nothing, opens no
#: panel, and lands on the channel with nothing highlighted, which is exactly
#: the failure `_deep_link` exists to close.
MENTION_URL_THREAD_PARAM = "thread"

#: `asyncio.ensure_future` returns a task the event loop holds only weakly. With
#: no strong reference the push can be garbage-collected mid-flight and vanish
#: with no log line at all. Holding it here until it finishes is the documented
#: fix; `services/mentions.py` predates the guidance and does not do it.
_PUSH_TASKS: set[asyncio.Task] = set()

#: How many of those tasks may be inside `send_push` at once. Each one is a
#: `notification_prefs` fetchrow, a `push_tokens` fetch and an Expo POST, and the
#: two queries take a pool connection each — so an ungated fan-out of N asks the
#: pool for up to 2N connections at once against `db.py`'s `max_size=10`, and the
#: HTTP request that is still trying to finish the send queues behind its own
#: background work. Four leaves six connections for real traffic; the fan-out
#: simply takes longer, which is free because it is already off the request.
PUSH_FAN_OUT_CONCURRENCY = 4

#: One semaphore per event loop, not one per process.
#:
#: `asyncio.Semaphore` binds itself to the first loop that CONTENDS on it and
#: raises `RuntimeError: … is bound to a different event loop` from every other
#: one. A module-level singleton is therefore fine in gunicorn (one loop per
#: worker) and a trap everywhere else — a test suite makes a fresh loop per test,
#: and the failure would surface only once a fan-out was big enough to block,
#: i.e. in exactly the case this gate exists for. Keyed weakly so a closed loop
#: takes its semaphore with it rather than leaking one per test.
_PUSH_GATES: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _push_gate() -> asyncio.Semaphore:
    """The push semaphore for the loop we are running on. See `_PUSH_GATES`."""
    loop = asyncio.get_running_loop()
    gate = _PUSH_GATES.get(loop)
    if gate is None:
        gate = asyncio.Semaphore(PUSH_FAN_OUT_CONCURRENCY)
        _PUSH_GATES[loop] = gate
    return gate


# ── Text search, copied deliberately ─────────────────────────────────────────

#: Unicode combining-mark categories. Devanagari and Gujarati matras live here.
_MARK_CATEGORIES = frozenset({"Mn", "Mc", "Me"})
#: ZWNJ / ZWJ. Indic conjuncts are written with these and they are not
#: punctuation — deleting them rewrites the word.
_JOINERS = frozenset({"‌", "‍"})


def _keep_char(ch: str) -> bool:
    """Whether a character survives into the tsquery token.

    `str.isalnum()` ALONE IS WRONG HERE, and wrong in the exact direction this
    product cannot afford. Devanagari matras are `Mn`/`Mc` combining marks, not
    alphanumerics, so `"".join(c for c in "राकेश" if c.isalnum())` yields
    `रकश` — a word that is not the word, and does not prefix-match the stored
    one. Gujarati behaves identically. Bilingual search would have looked
    implemented and silently returned nothing for every Indic name.

    Marks and joiners are admitted; everything else that is not alphanumeric is
    dropped, which still excludes every `tsquery` operator (`& | ! ( ) : * < >`)
    and the quote.
    """
    if ch.isalnum() or ch in _JOINERS:
        return True
    return unicodedata.category(ch) in _MARK_CATEGORIES


def build_tsquery(q: str) -> str:
    """Compile a user string into a prefix tsquery: `raakesh nag` → `raakesh:* & nag:*`.

    THIS IS A DELIBERATE COPY of `routers/search.py:_tsquery` / `_keep_char`, not
    an import. `search.py` is a router: importing it from a service drags in
    `middleware.subscription`, `middleware.roles` and the router graph, and
    `routers/messaging.py` imports this module — so the import would close a
    cycle at start-up. Forty lines duplicated is the cheaper of the two
    problems. If the character rules change over there, change them here too;
    that is the cost of the copy and it is stated so nobody has to discover it.

    Returns `''` for an all-punctuation input. THE CALLER MUST SKIP THE TSQUERY
    ARM ENTIRELY when it is empty — `to_tsquery('simple', '')` is not a query
    that matches nothing, it is a syntax error.

    The result is ALWAYS passed as a bind parameter to `to_tsquery(...)` and
    never concatenated into SQL. This filter is a correctness guard, not the
    injection defence.
    """
    tokens = []
    for word in (q or "").split():
        cleaned = "".join(ch for ch in word if _keep_char(ch)).strip("".join(_JOINERS))
        # A token of nothing but combining marks is not a word — it cannot
        # prefix-match anything and `to_tsquery` would choke on the bare `:*`.
        if cleaned and any(ch.isalnum() for ch in cleaned):
            tokens.append(f"{cleaned}:*")
    return " & ".join(tokens)


# ── Internals ────────────────────────────────────────────────────────────────

async def _channel_row(pool, channel_id, org_id: str):
    """The channel, or None if it is not in this org.

    Org-scoped on purpose even though every caller has already checked: this
    module writes notification bodies containing message text, and the org
    filter is the thing standing between that and a cross-tenant leak. It is one
    fetchrow and it is not worth trusting the caller for.
    """
    return await pool.fetchrow(
        "SELECT id, name, type FROM staging.samvada_channels "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )


async def _readable_by(pool, channel_id, org_id: str, channel_type: str):
    """Everyone who can READ this channel, as `[{user_id, email, display}]`.

    This is the candidate universe for every pass below, and scoping it this way
    is the whole safety property: a mention notification quotes 140 characters of
    the message body, so resolving somebody who cannot open the channel would
    mail them its contents.

      · private / dm → the member rows, and nothing else.
      · public       → members UNION every org member, because anyone in the org
                       can open a public channel and so anyone can be mentioned
                       into one. The `user_roles` arm is the same shape
                       `messaging.directory` uses (`role_code IN (...)`), and
                       `UNION` rather than `UNION ALL` because a user with two
                       role rows in one org would otherwise appear twice.

    `display` is `COALESCE(full_name, name, email)`, byte-identical to what
    `MentionTextarea`/`MentionInput` insert after the `@`. If those two ever
    disagree the feature silently stops resolving, which is how it was broken
    for task comments for months.
    """
    sql = """
        SELECT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS display
          FROM staging.samvada_channel_members cm
          JOIN users u ON u.user_id = cm.user_id
         WHERE cm.channel_id = $1::uuid
    """
    # `args` is built next to the SQL rather than passed unconditionally.
    # asyncpg binds POSITIONALLY and raises `InterfaceError: the server expects 1
    # argument for this query, 2 were passed` — it does not ignore the spare. So
    # handing `org_id` to the private-channel arm, which has no `$2`, would 500
    # every mention in every private channel and every DM while the public
    # channels this is usually tested on carried on working.
    args = [channel_id]
    if channel_type == "public":
        sql += """
        UNION
        SELECT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS display
          FROM staging.user_roles ur
          JOIN users u ON u.user_id = ur.user_id
         WHERE ur.org_id = $2::uuid
           AND ur.role_code IN ('org_owner','org_admin','org_member')
        """
        args.append(org_id)
    return await pool.fetch(sql, *args)


def _match_display_names(content: str, candidates) -> tuple[dict, str]:
    """Pass 1 — display-name mentions, longest first, consuming what they match.

    Returns `({user_id: row}, masked_content)`.

    LONGEST FIRST is the rule `services/mentions.py` documents: a member called
    "Keval" must not shadow "Keval Shah". But sorting alone only guarantees that
    "Keval Shah" is FOUND — it does not stop "Keval" being found in the same
    span, and that second half is what mattered. `@Keval Shah` would have
    notified two people, one of whom was never named.

    So a match is BLANKED OUT of the working copy (same length, NUL bytes, which
    are neither word characters nor `.`/`-`) before the next candidate is tried,
    and pass 2 runs over the same masked copy. That is exactly what
    `messageUtils.splitMentions` does on the render side — one alternation,
    longest branch first, `last = start + match.length` — so the set of names the
    server notifies is the same set the client bolds. Those two agreeing is the
    entire point; a bolded name that notifies nobody is the bug this file is
    replacing.

    `(^|[^\\w@])` mirrors the renderer's own prefix guard, so `mail@keval shah`
    is an address and not a mention.
    """
    found: dict = {}
    work = content
    lowered = content.lower()

    # Longest display name first — see above.
    for row in sorted(candidates, key=lambda r: len(r["display"] or ""), reverse=True):
        display = (row["display"] or "").strip()
        if not display:
            continue
        needle = f"@{display.lower()}"
        # Cheap reject before compiling a regex. On a public channel the
        # candidate list is the whole org, and most of them are not in a
        # forty-word message.
        if needle not in lowered:
            continue
        pat = re.compile(r"(^|[^\w@])" + re.escape(needle), re.IGNORECASE)
        if not pat.search(work):
            # Present as a substring but never at a mention boundary.
            continue
        found[row["user_id"]] = row
        work = pat.sub(
            lambda mo: mo.group(1) + "\0" * (len(mo.group(0)) - len(mo.group(1))),
            work,
        )

    return found, work


async def _match_handles(pool, masked: str, universe: dict) -> dict:
    """Pass 2 — single-token handles, over the masked body.

    Kept from `services/mentions.py` for hand-typed `@alice` / `@alice@corp.com`
    that never went through the picker. Two changes:

      · It runs over the MASKED body, so the `Keval` that `@Keval Shah` leaves
        behind cannot resolve a *different* user who happens to be called Keval.
      · One query with `= ANY(...)` instead of one query per handle. The old
        shape is an N+1 against `public.users` on the send path.

    The result is then intersected with `universe` — the people who can read this
    channel. `_assert_same_org` semantics are the floor the spec asks for, and
    this is stricter in exactly one place that matters: on a PRIVATE channel an
    org member who is not in the room cannot be resolved, so the notification
    body cannot carry private-room text to somebody who was never in the room.
    On a public channel the two rules are identical, because the universe there
    IS the org.
    """
    handles = {h.lower() for h in MENTION_RE.findall(masked)}
    handles -= {"here", "channel"}      # broadcast tokens, handled separately
    if not handles:
        return {}

    rows = await pool.fetch(
        """
        SELECT user_id, email, COALESCE(full_name,name,email) AS display
          FROM users
         WHERE LOWER(email) = ANY($1::text[])
            OR LOWER(name) = ANY($1::text[])
            OR LOWER(full_name) = ANY($1::text[])
        """,
        sorted(handles)[:_MAX_HANDLES],
    )
    return {r["user_id"]: r for r in rows if r["user_id"] in universe}


async def _broadcast_recipients(pool, channel_id, org_id: str, kind: str) -> list[str]:
    """Who `@channel` / `@here` reaches. Membership, in both cases.

    `@channel` is every member row. `@here` narrows that to members whose
    presence row says `online` and was refreshed inside five minutes — NOT
    `away`, which is what the `/live` poll writes while the tab is hidden, and
    which is precisely the state "here" is meant to exclude.

    `@here` on a channel where nobody is currently online reaches nobody and
    writes nothing. That is correct and must not be "fixed" by falling back to
    `@channel`: a broadcast that quietly widens itself is worse than one that
    does nothing.

    THERE IS DELIBERATELY NO `LIMIT` HERE, and adding one is the wrong fix for
    the right worry. Everyone this returns gets a `samvada_mentions` row, and
    those rows go in as a single `unnest` insert whose cost is one round trip
    regardless of length — while a `LIMIT` would decide, invisibly and by
    membership order, whose badge lights up. The expensive part is the
    per-recipient notification and push, and that is what
    `BROADCAST_NOTIFY_MAX_RECIPIENTS` governs, in `fan_out_mentions`, where the
    number that was dropped can be logged.
    """
    if kind == "channel":
        rows = await pool.fetch(
            "SELECT user_id FROM staging.samvada_channel_members WHERE channel_id=$1::uuid",
            channel_id,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT cm.user_id
              FROM staging.samvada_channel_members cm
              JOIN staging.samvada_presence p
                ON p.user_id = cm.user_id AND p.org_id = $2::uuid
             WHERE cm.channel_id = $1::uuid
               AND p.status = 'online'
               AND p.last_seen_at > now() - interval '5 minutes'
            """,
            channel_id, org_id,
        )
    return [r["user_id"] for r in rows]


async def _resolve(pool, *, org_id, channel_id, channel, content, actor_id,
                   sender_is_channel_admin) -> list[tuple[str, str]]:
    """The shared body of `resolve_mentions`, given an already-fetched channel."""
    universe_rows = await _readable_by(pool, channel_id, org_id, channel["type"])
    universe = {r["user_id"]: r for r in universe_rows}

    by_name, masked = _match_display_names(content, universe_rows)
    by_handle = await _match_handles(pool, masked, universe)

    # Ordered, and the order decides `kind` on collision: a person named
    # explicitly keeps `kind='user'` rather than being flattened into the
    # broadcast that also caught them, because the badge and the mentions feed
    # read that column and "somebody said your name" is a different event from
    # "somebody paged the room".
    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _add(uid: str, kind: str) -> None:
        # The author is never mentioned by their own message. No row, no
        # notification, no badge — matching `process_mentions`, and matching
        # what anyone would expect from typing their own name.
        if uid == actor_id or uid in seen:
            return
        seen.add(uid)
        out.append((uid, kind))

    for uid in list(by_name) + list(by_handle):
        _add(uid, "user")

    wanted = [k for k, rx in _BROADCAST_RE.items() if rx.search(masked)]
    if wanted:
        allowed = sender_is_channel_admin
        if not allowed:
            member_count = await pool.fetchval(
                "SELECT COUNT(*) FROM staging.samvada_channel_members WHERE channel_id=$1::uuid",
                channel_id,
            )
            allowed = (member_count or 0) <= BROADCAST_FREE_FOR_ALL_MAX_MEMBERS
        if allowed:
            # `here` before `channel`: if a message carries both, the narrower
            # and more urgent one should be the kind that survives the unique
            # constraint. Arbitrary but fixed, so two runs agree.
            for kind in ("here", "channel"):
                if kind in wanted:
                    for uid in await _broadcast_recipients(pool, channel_id, org_id, kind):
                        _add(uid, kind)

    return out


def _channel_label(channel) -> str:
    """What to call this channel inside a notification title.

    A DM has an empty `name` (`find_or_create_dm` inserts `''`), so `#` plus the
    name would render as a bare `#`. "a direct message" is used instead — the
    actor is already named in the same sentence, so nothing is lost by not
    naming the room, and the alternative phrasings all read as "Keval Shah
    mentioned you in Keval Shah".
    """
    if channel["type"] == "dm":
        return "a direct message"
    return f"#{channel['name']}"


def _title_for(kind: str, actor_name: str, label: str) -> str:
    if kind == "channel":
        return f"{actor_name} notified {label}"
    if kind == "here":
        return f"{actor_name} notified {label} (here)"
    return f"{actor_name} mentioned you in {label}"


def _notification_body(content: str) -> str:
    """Whitespace-collapsed preview of the message, ellipsised at 140 chars.

    Collapsed rather than truncated raw: a message that opens with a fenced code
    block would otherwise put its newlines into a push payload and render as a
    blank notification on Android.
    """
    flat = " ".join((content or "").split())
    return flat[:_NOTIF_BODY_CHARS] + "…" if len(flat) > _NOTIF_BODY_CHARS else flat


async def _thread_root(pool, message_id):
    """The thread this message is in, or None if it is not a reply.

    `parent_message_id` IS the root and not the message one level up: threads
    here are flat. `GET /messages/{id}/thread` collects every reply with a single
    `WHERE m.parent_message_id = $1::uuid`, and `ThreadPanel` posts each reply
    with `parent_message_id: root.id`, so there is no chain to walk and a
    recursive query would be a second, different model of threading.

    Read back off the row rather than passed in, because neither call site has
    it to give: `_fan_out_mentions_guarded` takes a `message_id` and nothing
    else, and its signature is pinned by the router's own tests. One fetchval,
    only on a message that mentions somebody, and only once the fan-out already
    knows it has an unmuted recipient to build a url for.
    """
    return await pool.fetchval(
        "SELECT parent_message_id FROM staging.samvada_messages WHERE id=$1::uuid",
        message_id,
    )


def _deep_link(channel_id, message_id, thread_root) -> str:
    """Where the notification takes the reader.

    `/sanvaad?channel=<id>&message=<id>`, plus `&thread=<root id>` when the
    mentioned message is a thread reply. See `MENTION_URL_THREAD_PARAM` for the
    name and who reads it.

    THE THIRD PARAMETER IS NOT DECORATION. `list_messages` filters
    `parent_message_id IS NULL`, so a reply is never in the channel log and
    therefore never in the DOM — and `ChatPane`'s deep-link effect is a
    `getElementById('m-' + focusMessageId)` that returns silently when the node
    is absent. Without the root, "@Bela Rao can you check this" typed into a
    thread notifies Bela, and the click drops her at the bottom of the channel
    with nothing highlighted and the thread closed. The mentions feed shows her
    the reply's body at the same time, so she can read text she has no way to
    navigate to — a notification that is worse than none, because it proves
    something was said to her and then refuses to show it in place.

    The link is built even for a root message that has replies of its own: it is
    in the log, `message` finds it there, and opening a panel the sender did not
    write into would move the reader somewhere they were not addressed.
    """
    url = f"/sanvaad?channel={channel_id}&message={message_id}"
    if thread_root:
        url += f"&{MENTION_URL_THREAD_PARAM}={thread_root}"
    return url


async def _push_one(pool, uid: str, title: str, body: str, url: str) -> None:
    """One push, behind the fan-out gate. Never raises.

    This runs as a detached task, so a raise here has no caller to reach: it
    would surface as "Task exception was never retrieved" at garbage-collection
    time, in a log line that names neither the recipient nor the message. Every
    failure is therefore caught and named on the way out.

    The gate is acquired around the WHOLE of `send_push`, not just the HTTP call,
    because the two pool queries in front of it are the half that competes with
    live request traffic for `db.py`'s ten connections.

    `send_push` is imported inside the function rather than at module scope for
    the same reason `build_tsquery` is a copy: `push_service` is cheap, but this
    module is imported by `routers/messaging.py` and keeping its import graph to
    nothing at all is what stops the next import from closing a cycle at
    start-up.
    """
    try:
        from services.push_service import send_push
        async with _push_gate():
            await send_push(
                pool,
                recipient_id=uid,
                kind="mention",          # DEFAULT_PREFS['mention'] == 'always'
                title=title,
                body=body,
                task_id=None,
                data={"url": url},
                # `is_mine=True` matches `process_mentions`. Passing False would
                # let a `mine_only` preference swallow a mention, which is the
                # opposite of what that setting means to the person who set it.
                is_mine=True,
            )
    except Exception as exc:
        # A device that cannot be buzzed must not cost the sender their message,
        # and it must not cost the other 199 recipients their push either.
        logger.warning("sanvaad mention push failed for %s: %s", uid, exc)


# ── Public API ───────────────────────────────────────────────────────────────

async def resolve_mentions(pool, *, org_id: str, channel_id, content: str,
                           actor_id: str, sender_is_channel_admin: bool
                           ) -> list[tuple[str, str]]:
    """→ `[(user_id, kind)]` — kind in {'user','here','channel'}. Excludes actor_id.

    Ordered: named users first, then `@here`, then `@channel`. The caller relies
    on that order, because it is what decides which `kind` a person who was both
    named and paged ends up with.

    NO ENDPOINT CALLS THIS, AND IT IS NOT DEAD — do not delete it on that
    evidence. It is the tested unit behind `fan_out_mentions`: every resolution
    rule in this module (a two-word display name, a self-mention, the two
    broadcast ceilings, `@here` versus `@channel`, `@channels` and `an@here.com`
    resolving to nobody) is pinned through this function in section 4 of
    `tests/test_samvaad_mentions.py`, because asserting them through the fan-out
    would mean reading them back out of an INSERT's bind parameters. Removing it
    removes the seam those tests answer at, not a caller.

    `fan_out_mentions` does not go through it — the two share `_resolve` instead,
    so the send path does not fetch the channel row twice.
    """
    channel = await _channel_row(pool, channel_id, org_id)
    if not channel:
        return []
    return await _resolve(
        pool, org_id=org_id, channel_id=channel_id, channel=channel,
        content=content, actor_id=actor_id,
        sender_is_channel_admin=sender_is_channel_admin,
    )


async def fan_out_mentions(pool, *, org_id: str, channel_id, message_id,
                           actor_id: str, content: str, is_edit: bool) -> None:
    """Record the mentions in `content`, then notify and push the unmuted ones.

    Called INSIDE the request that sends or edits the message, not in a
    background task: the mention row is part of the message, and a `_bg()` task
    is dropped silently on a Railway restart (`server.py:_bg`). The push is the
    only thing that goes to the background, because the push is the only part
    that can be lost without losing the record.

    ── Muted ────────────────────────────────────────────────────────────────
    Every recipient gets a `samvada_mentions` row. Only the unmuted ones get a
    `public.notifications` row and a push. See rule 1 at the top of this file.

    ── Blast radius ─────────────────────────────────────────────────────────
    Three separate bounds, because the same fan-out is expensive in three
    different ways and no single one of them covers the others:

      · `BROADCAST_NOTIFY_MAX_RECIPIENTS` caps how many people ONE `@channel` or
        `@here` may be notified about. Over it, the mention rows still go in and
        the notification/push fan-out is dropped with a WARNING. See rule 5.
      · The notification insert is ONE statement, not one per recipient. It ran
        in series inside the request, so the sender waited out every round trip
        before their own message appeared.
      · The push fan-out runs behind `_push_gate()`. Ungated it asked the pool
        for two connections per recipient at once, against a `max_size` of ten.

    ── Editing ──────────────────────────────────────────────────────────────
    An edit can create a mention and must never re-send one, so on `is_edit` the
    rows already recorded against this message are read first and subtracted.
    The commonest edit is a typo fix, and it must be completely silent.

    Rows for names REMOVED by an edit are deliberately left in place. Deleting
    them would retract a notification the recipient may already have read, and
    decrement a badge for something that genuinely happened. That also makes the
    whole operation idempotent under retry, which is what the `ON CONFLICT DO
    NOTHING` below is for — the diff decides who is notified, the constraint
    decides who is stored, and neither can produce a second notification.
    """
    if "@" not in (content or ""):
        # The overwhelmingly common path. No queries at all.
        return

    channel = await _channel_row(pool, channel_id, org_id)
    if not channel:
        # The router checked this already; if it is gone by now the message is
        # not ours to annotate.
        return

    mem = await pool.fetchrow(
        "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, actor_id,
    )
    sender_is_channel_admin = bool(mem and mem["role"] == "admin")

    resolved = await _resolve(
        pool, org_id=org_id, channel_id=channel_id, channel=channel,
        content=content, actor_id=actor_id,
        sender_is_channel_admin=sender_is_channel_admin,
    )
    if not resolved:
        return

    kind_by_user = {uid: kind for uid, kind in resolved}
    fresh = [uid for uid, _ in resolved]

    if is_edit:
        # Only on the edit path. A new message cannot already have mention rows,
        # and paying for this read on every send would be a query nobody reads.
        existing = {
            r["mentioned_user_id"] for r in await pool.fetch(
                "SELECT mentioned_user_id FROM staging.samvada_mentions WHERE message_id=$1::uuid",
                message_id,
            )
        }
        fresh = [uid for uid in fresh if uid not in existing]
        if not fresh:
            # A typo fix, or a name that was already in the text. Nothing to
            # store, nothing to send, and no further queries.
            return

    # One statement rather than a loop. `@channel` on a large channel is the
    # case that matters: a per-recipient INSERT would be one round trip per
    # member, on the send path, while the user waits for their message to appear.
    #
    # `ON CONFLICT DO NOTHING` on top of the diff above, not instead of it: the
    # diff is what keeps an edit quiet, and the constraint is what keeps a
    # retried request from writing a second row.
    await pool.execute(
        """
        INSERT INTO staging.samvada_mentions
            (org_id, channel_id, message_id, mentioned_user_id, kind)
        SELECT $1::uuid, $2::uuid, $3::uuid, x.uid, x.kind
          FROM unnest($4::text[], $5::text[]) AS x(uid, kind)
        ON CONFLICT (message_id, mentioned_user_id) DO NOTHING
        """,
        org_id, channel_id, message_id,
        fresh,
        [kind_by_user[uid] for uid in fresh],
    )
    # NOT wrapped in try/except. Caught here, a missing table and a message that
    # mentioned nobody are the same non-event; left to raise, it reaches the
    # router's guard, which cannot fail the already-committed send and logs the
    # statement's real error instead — see rule 4 at the top of this file.

    # `muted` is per (channel, member). Somebody mentioned into a PUBLIC channel
    # they have never joined has no member row at all — absent is not muted, and
    # an unjoined public channel that says your name should still reach you.
    muted_rows = await pool.fetch(
        "SELECT user_id, muted FROM staging.samvada_channel_members "
        "WHERE channel_id=$1::uuid AND user_id = ANY($2::text[])",
        channel_id, fresh,
    )
    muted = {r["user_id"] for r in muted_rows if r["muted"]}

    targets = [uid for uid in fresh if uid not in muted]

    # ── The ceiling ──────────────────────────────────────────────────────────
    # Everything up to here is bounded: the resolver's work is bounded by the
    # message body, and the mention insert is one statement whatever its length.
    # Everything below is PER RECIPIENT — an inbox row and an Expo round trip
    # each — and `@channel` is the one input that can make "per recipient" mean
    # "per person in the org".
    #
    # Only the broadcast kinds are measured. Somebody named by hand is somebody
    # a human typed the name of, and there are only ever as many of those as fit
    # in one message; dropping them would break the ordinary case to fix the
    # abusive one. So a message that pages 4,000 people and names two still
    # notifies the two.
    #
    # The WARNING is the point of doing it this way. A cap that trims the list
    # and says nothing reads to the sender as "everyone was notified", and the
    # first evidence otherwise is a colleague who never heard about the outage.
    over_ceiling = [uid for uid in targets if kind_by_user[uid] != "user"]
    if len(over_ceiling) > BROADCAST_NOTIFY_MAX_RECIPIENTS:
        logger.warning(
            "sanvaad broadcast over ceiling: org=%s channel=%s actor=%s "
            "message=%s kinds=%s — %d mention rows written, %d broadcast "
            "recipients dropped from the notification and push fan-out "
            "(ceiling %d). They keep the @ badge and the mentions feed; no "
            "inbox row and no device buzz was sent to them.",
            org_id, channel_id, actor_id, message_id,
            "+".join(sorted({kind_by_user[uid] for uid in over_ceiling})),
            len(fresh), len(over_ceiling), BROADCAST_NOTIFY_MAX_RECIPIENTS,
        )
        targets = [uid for uid in targets if kind_by_user[uid] == "user"]

    if not targets:
        return

    actor = await pool.fetchrow(
        "SELECT COALESCE(full_name, name, email) AS display FROM users WHERE user_id=$1",
        actor_id,
    )
    actor_name = (actor["display"] if actor else None) or "Someone"

    label = _channel_label(channel)
    body  = _notification_body(content)
    # `NotificationsModal.jsx:105` pushes this straight through react-router and
    # `ChannelsTab` reads the params on mount. Without this exact shape the
    # notification is a dead end — which is what every Sanvaad notification would
    # have been, since there were none.
    #
    # The thread lookup is HERE and not up with the channel row: it is a query,
    # and everything above this line can still decide there is nobody to notify —
    # a muted room, a broadcast over the ceiling, an edit that named no one new.
    # A url nobody receives is not worth a round trip.
    url   = _deep_link(channel_id, message_id, await _thread_root(pool, message_id))

    # `notification_id` HAS NO COLUMN DEFAULT — it is a bare TEXT primary key —
    # so every writer in this codebase mints its own `notif_<12 hex>`. Batching
    # does not change that rule, it only moves the minting to the line above the
    # statement instead of inside a loop. Generating them in SQL instead (an
    # `'notif_' || substr(md5(random()::text),1,12)` expression) would be a
    # second implementation of an id format that already has one, and a
    # different one — `uuid4().hex` is not `md5(random())`.
    notif_ids = [f"notif_{uuid.uuid4().hex[:12]}" for _ in targets]
    # The title is the only per-recipient value: `@channel` says "notified
    # #accounts", a name says "mentioned you in #accounts", and a person who was
    # both keeps `kind='user'` from the resolver. Body and url are the same for
    # everyone, so they stay scalar binds rather than being repeated N times.
    titles = [_title_for(kind_by_user[uid], actor_name, label) for uid in targets]

    # ONE round trip for the whole fan-out, in the same `unnest` shape as the
    # mention insert above. It used to be one `INSERT` per recipient inside this
    # loop, awaited in series, INSIDE the request that sends the message — so an
    # admin's `@channel` on a 300-member org made the sender wait for 300
    # sequential round trips before their own message appeared. That is not a
    # rare enough case to pay for: any editor can create a public channel, add
    # the org and become its admin.
    #
    # `type` is the EXISTING `'mention'` kind, not a new `'sanvaad_mention'`.
    # `frontend/src/pages/inbox/notifKinds.js` already maps it — icon, colour and
    # the Mentions tab — and its banner forbids a ninth kind, because a kind with
    # no row in the preferences table is a kind the user cannot switch off. It
    # stays an unadorned literal in the SELECT list so Postgres resolves it
    # against the target column exactly as it did in the VALUES form.
    #
    # `task_id` IS NOT NAMED, and that is load-bearing rather than incidental.
    # `InboxPage.jsx:59` reads `if (n.task_id) setDrawerTaskId(n.task_id); else
    # if (n.url) navigate(n.url)` — any non-null value here opens an EMPTY TASK
    # DRAWER instead of the channel, and the message id in `url` is never read.
    # Leaving the column out of the statement is what keeps it NULL; there is no
    # default to fight.
    #
    # EVERY PARAMETER IS CAST, and that is not decoration — it is the difference
    # between this statement working and every mention 500ing at Parse time.
    # `INSERT … SELECT` is the "general SELECT" path in Postgres's parse
    # analysis: the sub-select is analysed on its own and the INSERT then coerces
    # its OUTPUT COLUMNS, so a bare `$4` in the select list is never coerced
    # against `message` and stays untyped — `could not determine data type of
    # parameter $4`. asyncpg sends Parse with no parameter types at all and lets
    # the server infer, so it lands squarely on that path. The same statement in
    # the `VALUES ($1, $2, …)` form infers from the columns and needs no casts,
    # which is exactly why converting one into the other looks safe.
    #
    # The array casts also say which type: `notification_id`, `user_id` and
    # `title` are TEXT, and `user_id` in particular is `user_<something>` and not
    # a uuid — `uuid[]` here would be a DataError on every send.
    #
    # `'mention'` is left bare on purpose. It is a literal and not a parameter,
    # so none of the above applies to it: an unknown-type literal in a sub-select
    # resolves to text and then to the column. `'mention'::text` would mean the
    # same thing to Postgres, but `test_samvaad_mentions` reads this select list
    # with a regex to check the notification kind, and would report the kind as
    # `mention'::text` — a green test turning red on a change that changes
    # nothing is its own kind of cost.
    await pool.execute(
        """
        INSERT INTO notifications (notification_id, user_id, type, title, message, url)
        SELECT x.nid, x.uid, 'mention', x.title, $4::text, $5::text
          FROM unnest($1::text[], $2::text[], $3::text[]) AS x(nid, uid, title)
        """,
        notif_ids, targets, titles, body, url,
    )

    # Push LAST, and only after the rows are on disk. Quiet hours and a
    # switched-off preference suppress the device, never the record — so this
    # failing, or being silenced, must leave the inbox entries intact.
    #
    # One task per recipient, all created here rather than one task that gathers
    # them: `_push_gate()` is what bounds the concurrency, so the tasks are cheap
    # and only `PUSH_FAN_OUT_CONCURRENCY` of them are ever inside `send_push` at
    # once. Scheduling them individually also keeps the ordering the rest of this
    # file relies on — every push is queued before this function returns, so a
    # caller that awaits one loop iteration sees all of them, and none of them
    # can start before the statement above has committed.
    for uid, title in zip(targets, titles):
        try:
            task = asyncio.ensure_future(_push_one(pool, uid, title, body, url))
            _PUSH_TASKS.add(task)
            task.add_done_callback(_PUSH_TASKS.discard)
        except Exception as exc:
            # `_push_one` swallows its own failures; this catches the ones that
            # happen before it ever runs — no running loop, a rejected task. The
            # send is not failed for either.
            logger.warning(
                "sanvaad mention push could not be scheduled for %s: %s", uid, exc
            )
