"""A message produces a notification — the thing that had never once happened.

Measured on the live database, read-only, before any of this was written:

    staging.samvada_messages                        1,177 rows
    public.notifications                            4,797 rows
    public.notifications WHERE type is message-ish  0 rows

Every type in that table is task-shaped — `deadline_warning_overdue` 3,049,
`done` 538, `reminder` 351, `assigned` 229, `status_changed` 213, `approval*`,
`comment` 33 — with exactly one exception: `mention`, 35 rows, written by
`services/samvaad_mentions.py`. So "when someone messages, no notifications are
coming" was never a DELIVERY bug. Nothing was ever created to deliver.

What is pinned here, and how each one fails in production if it regresses:

1. **The names.** The pool is mocked everywhere below, and — exactly as
   `routers/messaging.py`'s banner warns — a mocked cursor resolves any relation
   you name. Section 1 checks the SQL against the migration and the verified
   catalogue instead, because this code runs INSIDE the send path: a column
   Postgres does not have would not break notifications, it would break sending
   a message, with an opaque 500.

2. **Who gets one.** Under-notify and the feature is still broken for the person
   who reported it; over-notify and a busy channel teaches everyone to switch
   notifications off, which costs them their mentions and their DMs too.

3. **The double-notify trap.** A message that names somebody has TWO writers
   that both consider it theirs. One notification, not two.

4. **Batching.** Ten messages in a minute must be one row.

5. **Quiet hours.** The row is written above every gate. An in-app notification
   suppressed for the hour is not delayed — there is no queue — it is LOST.

6. **DM versus channel.** A DM buzzes a phone; a channel does not.
"""
import asyncio
import ast
import inspect
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
SERVICE = BACKEND / "services" / "samvaad_message_notify.py"
MENTIONS = BACKEND / "services" / "samvaad_mentions.py"
ROUTER = BACKEND / "routers" / "messaging.py"

ORG = "11111111-1111-1111-1111-111111111111"
CHANNEL = "22222222-2222-2222-2222-222222222222"
MESSAGE = "33333333-3333-3333-3333-333333333333"
ROOT = "44444444-4444-4444-4444-444444444444"
ACTOR = "user_actor01"


# ════════════════════════════════════════════════════════════════════════════
# Harness
# ════════════════════════════════════════════════════════════════════════════

def member(user_id, *, muted=False, unread=1, prev_id=None, prev_stale=False,
           actor_name="Keval Shah"):
    """One row of the audience probe, in the shape the SELECT list produces."""
    return {
        "user_id": user_id, "muted": muted, "actor_name": actor_name,
        "unread": unread, "prev_id": prev_id, "prev_stale": prev_stale,
    }


class FakePool:
    """Answers by SQL SHAPE, never by call order.

    Call-ordered fakes turn every test in a file into a test of the query
    sequence: add one statement to the handler and thirty assertions about
    behaviour start failing for a reason that has nothing to do with behaviour.
    `test_samvaad_gates.py` records the same decision and the same reason.
    """

    def __init__(self, *, members=(), channel_type="public", channel_name="general",
                 thread_senders=(), channel_missing=False):
        self.members = list(members)
        self.channel_type = channel_type
        self.channel_name = channel_name
        self.thread_senders = list(thread_senders)
        self.channel_missing = channel_missing
        self.statements: list[tuple[str, list]] = []

    def _record(self, sql, args):
        self.statements.append((" ".join(str(sql).split()), list(args)))

    async def fetchrow(self, sql, *args):
        self._record(sql, args)
        if "samvada_channels" in sql:
            if self.channel_missing:
                return None
            return {"id": CHANNEL, "name": self.channel_name,
                    "type": self.channel_type}
        return None

    async def fetch(self, sql, *args):
        self._record(sql, args)
        if "DISTINCT sender_id" in sql:
            return [{"sender_id": s} for s in self.thread_senders]
        if "samvada_channel_members cm" in sql:
            rows = [m for m in self.members if m["user_id"] != args[1]]
            # Emulate `AND cm.user_id = ANY($7::text[])` — the thread arm.
            if len(args) >= 7:
                allowed = set(args[6])
                rows = [m for m in rows if m["user_id"] in allowed]
            return rows
        return []

    async def execute(self, sql, *args):
        self._record(sql, args)
        return "INSERT 0 1"

    # `async with pool.acquire() as conn` funnels straight back to us.
    def acquire(self):
        return self

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    # ── Readers ──
    def matching(self, *fragments):
        return [(s, a) for s, a in self.statements
                if all(f in s for f in fragments)]

    def inserts(self):
        return self.matching("INSERT INTO notifications")

    def updates(self):
        return self.matching("UPDATE notifications")

    def notified(self) -> set:
        """Every user id an INSERT was asked to write a notification for."""
        out = set()
        for _s, args in self.inserts():
            for a in args:
                if isinstance(a, list):
                    out |= {v for v in a if isinstance(v, str) and v.startswith("user_")}
        return out


@pytest.fixture
def push_log(monkeypatch):
    """Every push, recorded at the moment `send_push` is CALLED.

    A plain function rather than an `async def`: the fan-out fires push through
    `asyncio.ensure_future`, so an async stub's body may not run before the test
    ends and a real push would look like no push at all.
    """
    log: list[dict] = []

    def _stub(*args, **kwargs):
        log.append(kwargs)

        async def _noop():
            return None
        return _noop()

    import services.push_service as ps
    monkeypatch.setattr(ps, "send_push", _stub)
    return log


async def _fan_out(pool, **over):
    from services.samvaad_message_notify import fan_out_message_notification
    kwargs = dict(org_id=ORG, channel_id=CHANNEL, message_id=MESSAGE,
                  actor_id=ACTOR, content="the quarterly numbers are in")
    kwargs.update(over)
    n = await fan_out_message_notification(pool, **kwargs)
    # Anything scheduled with ensure_future gets a turn before we assert;
    # without this a push that really fired looks like one that never did.
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    return n


def _strip_prose(text: str) -> str:
    """Docstrings and `#` comments out, SQL in.

    These files DISCUSS the things this test searches for — the module docstring
    says the words "quiet hours" a dozen times explaining how they are honoured —
    so a naive source search asserts against the prose that documents the fix.
    Docstrings are located with `ast` and blanked BY LINE, so every other string
    literal (i.e. every query) survives; a regex sweep for triple quotes would
    delete the queries and leave half the prose, because the two alternate.
    """
    lines = text.splitlines()
    try:
        tree = ast.parse(text)
    except SyntaxError:                       # pragma: no cover
        tree = None
    if tree is not None:
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                     ast.AsyncFunctionDef)):
                continue
            body = getattr(node, "body", None)
            if not body:
                continue
            first = body[0]
            if (isinstance(first, ast.Expr)
                    and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                for ln in range(first.lineno - 1, first.end_lineno):
                    lines[ln] = ""
    return "\n".join(ln for ln in lines if not ln.lstrip().startswith("#"))


def _body(fn) -> str:
    src = inspect.getsource(fn)
    return _strip_prose(src)


# ════════════════════════════════════════════════════════════════════════════
# 1 · The names. A mocked cursor resolves anything; the catalogue does not.
# ════════════════════════════════════════════════════════════════════════════

#: The live columns, verified read-only against the database this app runs on,
#: 2026-08-20. `public.notifications` has NO `org_id` (PROPOSED_076 is not
#: applied) and NO `metadata`, which is exactly why the coalesce probe has to
#: find its target through `url`.
NOTIFICATIONS_COLUMNS = {
    "id", "notification_id", "user_id", "team_id", "type", "title", "message",
    "task_id", "url", "created_at", "read_at",
}
CHANNEL_MEMBER_COLUMNS = {
    "id", "channel_id", "user_id", "role", "joined_at", "last_read_at", "muted",
}
MESSAGE_COLUMNS = {
    "id", "org_id", "channel_id", "sender_id", "content", "type",
    "parent_message_id", "metadata", "is_edited", "is_deleted",
    "created_at", "updated_at", "pinned_at", "pinned_by", "search_tsv",
}
CHANNEL_COLUMNS = {
    "id", "org_id", "name", "description", "type", "created_by", "is_archived",
    "created_at", "updated_at", "color",
}

KNOWN_STAGING_RELATIONS = {
    "samvada_channels", "samvada_channel_members", "samvada_messages",
}


def _code() -> str:
    assert SERVICE.exists(), f"{SERVICE} does not exist"
    return _strip_prose(SERVICE.read_text(encoding="utf-8"))


def test_every_staging_relation_named_is_one_that_exists():
    """A misspelt table is an UndefinedTableError ON THE SEND PATH.

    This module is awaited inside `POST /channels/{id}/messages`, so a name
    Postgres does not have does not break notifications — it breaks sending a
    message, with a 500 the sender reads as "your message did not go".
    """
    for rel in set(re.findall(r"\bpublic\.(\w+)", _code())):
        assert rel in KNOWN_STAGING_RELATIONS, (
            f"samvaad_message_notify.py names public.{rel}, which is not a "
            f"relation this feature has"
        )


def test_the_notifications_table_is_never_schema_qualified_and_the_samvada_ones_always_are():
    """`public.notifications` vs `staging.samvada_*` — get this backwards on a
    shared database and the query either fails or, far worse, resolves against
    a shadow table. Migration 142's twins are the recorded precedent, and the
    house rule from that incident is: ALWAYS qualify the schema.

    `notifications` is the one exception every writer in this codebase already
    makes — `server.create_notification`, `utils.create_notification` and
    `samvaad_mentions` all name it bare — because `db.py` sets
    `search_path = staging, public` and there is no `staging.notifications` to
    shadow it. Writing `public.notifications` here would be correct SQL and
    inconsistent with all four other writers; this test pins the choice so it
    cannot drift silently either way.
    """
    code = _code()
    for table in ("samvada_channels", "samvada_channel_members", "samvada_messages"):
        for m in re.finditer(rf"(\w*\.?){table}\b", code):
            assert m.group(1) == "public.", (
                f"`{table}` is named without its `public.` schema at "
                f"offset {m.start()} — on this database that is how a query "
                f"finds a shadow table instead of the real one"
            )
    assert "public.notifications" not in code, (
        "notifications is qualified `public.` here and bare in every other "
        "writer in this codebase; one vocabulary, one spelling"
    )
    assert re.search(r"INSERT INTO\s+notifications\b", code)


def test_every_column_touched_on_notifications_exists():
    """The `graha_contacts.type` class of bug: an INSERT or an UPDATE naming a
    column the table does not have raises UndefinedColumnError before a row is
    written, and takes the send with it."""
    code = _code()
    m = re.search(r"INSERT INTO\s+notifications\s*\(([^)]*)\)", code)
    assert m, "no INSERT INTO notifications found"
    cols = {c.strip() for c in m.group(1).split(",") if c.strip()}
    unknown = cols - NOTIFICATIONS_COLUMNS
    assert not unknown, f"INSERT names columns notifications does not have: {unknown}"

    # The UPDATE's SET list.
    up = re.search(r"UPDATE notifications AS n\s+SET\s+(.*?)\s+FROM", code, re.S)
    assert up, "no UPDATE of notifications found"
    set_cols = {c.split("=")[0].strip() for c in up.group(1).split(",")}
    unknown = set_cols - NOTIFICATIONS_COLUMNS
    assert not unknown, f"UPDATE sets columns notifications does not have: {unknown}"


def test_task_id_is_never_written():
    """`InboxPage.jsx` reads `if (n.task_id) setDrawerTaskId(n.task_id); else if
    (n.url) navigate(n.url)`.

    Any non-null value in that column opens an EMPTY TASK DRAWER instead of the
    channel, and the deep link is never read — so the notification would prove
    something was said and then refuse to show it. Leaving the column out of the
    statement is what keeps it NULL; there is no default to fight.
    """
    m = re.search(r"INSERT INTO\s+notifications\s*\(([^)]*)\)", _code())
    assert "task_id" not in m.group(1), (
        "task_id is in the INSERT column list — every one of these "
        "notifications would open an empty task drawer instead of the channel"
    )
    assert "team_id" not in m.group(1), (
        "team_id is a PROJECT id. A channel is not a project."
    )


def test_every_bind_parameter_is_cast():
    """PgBouncer turns an untyped parse error into an INSTANT 500.

    `INSERT … SELECT` and `UPDATE … FROM unnest(...)` are both the "general
    SELECT" path in Postgres's parse analysis: the sub-select is analysed on its
    own and the output columns are coerced afterwards, so a bare `$4` in a select
    list is never coerced against its target column and comes back as "could not
    determine data type of parameter $4". asyncpg sends Parse with no parameter
    types at all, so it lands squarely there. `incident_credits_untyped_sql` is
    the recorded precedent: a sub-second 500 on every spend.
    """
    code = _code()
    for m in re.finditer(r"\$\d+(::\w+(\[\])?)?", code):
        assert m.group(1), (
            f"uncast bind parameter {m.group(0)!r} in samvaad_message_notify.py"
        )


def test_the_coalesce_probe_and_the_deep_link_agree_on_the_url_shape():
    """The batching in D3 finds its target with `url LIKE _link_prefix(...)||'%'`
    because `public.notifications` has no channel column. If `_deep_link` ever
    stops starting with `_link_prefix`, the probe finds nothing, every message
    inserts a fresh row, and ten messages are ten notifications again — silently,
    with nothing failing.
    """
    from services.samvaad_mentions import _deep_link, _link_prefix
    prefix = _link_prefix(CHANNEL)
    assert _deep_link(CHANNEL, MESSAGE, None).startswith(prefix)
    assert _deep_link(CHANNEL, MESSAGE, ROOT).startswith(prefix)
    assert _deep_link(CHANNEL.upper(), MESSAGE, None).startswith(prefix), (
        "a channel id spelled in a different case builds a different prefix, so "
        "two sends to one channel would miss each other and stop batching"
    )
    assert prefix.endswith("&"), (
        "without the trailing separator the prefix would also match a channel "
        "id that merely starts with these characters"
    )
    # And the module really does probe with it rather than writing the string out.
    assert "_link_prefix" in _code()


def test_the_type_written_is_not_one_of_the_eight_inbox_kinds():
    """`notifKinds.js` forbids a ninth KIND — a kind with no row in the
    preference table is one the user cannot switch off.

    `'message'` is a TYPE and not a kind: `kindKeyOf` returns null for it, so it
    renders with the neutral dot and its own title and claims no category. What
    it must NOT do is collide with an existing kind — `'mention'` would put every
    channel message in the inbox's Mentions tab, which is the one Sanvaad signal
    that already works.
    """
    from services.samvaad_message_notify import NOTIF_TYPE
    exact = {
        "assigned", "assign", "assignment", "mention", "mentioned", "comment",
        "approval", "approval_request", "request", "requested", "approved",
        "rejected", "reminder", "due", "due_soon", "deadline_warning",
        "deadline_escalation", "support", "support_access",
    }
    fuzzy = ("mention", "assign", "approval", "approved", "reject", "comment",
             "remind", "due", "deadline", "support")
    assert NOTIF_TYPE not in exact
    for stem in fuzzy:
        assert stem not in NOTIF_TYPE, (
            f"type {NOTIF_TYPE!r} contains the stem {stem!r}, so notifKinds' "
            f"FUZZY table would file every message under that kind"
        )


# ════════════════════════════════════════════════════════════════════════════
# 2 · Who gets one
# ════════════════════════════════════════════════════════════════════════════

async def test_a_channel_message_notifies_every_member_except_the_sender():
    """The bug, in one assertion. 1,177 messages produced zero of these."""
    pool = FakePool(members=[member(ACTOR), member("user_bela"), member("user_raj")])
    n = await _fan_out(pool)
    assert n == 2
    assert pool.notified() == {"user_bela", "user_raj"}
    assert ACTOR not in pool.notified(), "the sender was told about their own message"


async def test_the_notification_carries_a_deep_link_to_the_message():
    """A notification that lands the reader anywhere but on the message is a
    notification that proves something was said and refuses to show it."""
    pool = FakePool(members=[member("user_bela")])
    await _fan_out(pool)
    (_sql, args), = pool.inserts()
    assert any(isinstance(a, str) and a.startswith(f"/sanvaad?channel={CHANNEL}&")
               and f"message={MESSAGE}" in a for a in args)


async def test_a_muted_member_gets_nothing():
    """`PUT /channels/{id}/mute` is the ONLY switch a user has over this
    notification — there is no `message` row in `DEFAULT_PREFS` yet — so
    honouring it is not optional.

    Note this is the opposite of the mention rule, deliberately. A MENTION still
    records its row on a muted channel because being addressed by name is
    evidence the recipient is entitled to. Nobody is entitled to evidence that
    a room they muted carried on talking.
    """
    pool = FakePool(members=[member("user_bela", muted=True), member("user_raj")])
    await _fan_out(pool)
    assert pool.notified() == {"user_raj"}


async def test_nobody_is_notified_when_the_room_is_empty_and_nothing_is_written():
    pool = FakePool(members=[member(ACTOR)])
    assert await _fan_out(pool) == 0
    assert pool.inserts() == [] and pool.updates() == []


async def test_a_system_message_notifies_nobody():
    """`send_message` accepts `text` and `system`. Only the first is a person,
    and only a person is worth interrupting for."""
    pool = FakePool(members=[member("user_bela")])
    assert await _fan_out(pool, message_type="system") == 0
    assert pool.statements == [], "a system message ran a query at all"


async def test_a_deleted_channel_underneath_the_send_notifies_nobody():
    pool = FakePool(members=[member("user_bela")], channel_missing=True)
    assert await _fan_out(pool) == 0
    assert pool.inserts() == []


async def test_a_thread_reply_notifies_the_thread_and_not_the_room():
    """A reply is NOT IN THE CHANNEL LOG. `list_messages` and every unread count
    in the router filter `parent_message_id IS NULL`, so the reply does not
    appear in the room and does not move the room's badge. Telling the four
    people who were not in the conversation about a message they cannot see in
    any view they have is noise; the deep link's `&thread=` is the only route to
    it at all.
    """
    pool = FakePool(
        members=[member(ACTOR), member("user_bela"), member("user_raj"),
                 member("user_priya")],
        thread_senders=[ACTOR, "user_bela"],
    )
    await _fan_out(pool, parent_message_id=ROOT)
    assert pool.notified() == {"user_bela"}, (
        "a thread reply was fanned out to the whole channel"
    )
    # And the deep link carries the thread root, or the reader lands at the
    # bottom of the channel with nothing highlighted and the panel closed.
    (_sql, args), = pool.inserts()
    assert any(isinstance(a, str) and f"thread={ROOT}" in a for a in args)


async def test_a_thread_reply_with_nobody_else_in_the_thread_notifies_nobody():
    pool = FakePool(members=[member(ACTOR), member("user_bela")],
                    thread_senders=[ACTOR])
    assert await _fan_out(pool, parent_message_id=ROOT) == 0
    assert pool.inserts() == []


async def test_over_the_ceiling_nothing_is_written_and_the_warning_names_the_count(caplog):
    """A cap that trims silently reads to everybody as "the room was notified",
    and the first evidence otherwise is a colleague who never heard."""
    from services.samvaad_message_notify import MAX_RECIPIENTS
    crowd = [member(f"user_p{i:04d}") for i in range(MAX_RECIPIENTS + 5)]
    pool = FakePool(members=[member(ACTOR)] + crowd)
    with caplog.at_level("WARNING"):
        assert await _fan_out(pool) == 0
    assert pool.inserts() == [] and pool.updates() == []
    said = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any(str(MAX_RECIPIENTS) in m and str(len(crowd)) in m for m in said), (
        "the ceiling dropped a fan-out without naming both the count it "
        "dropped and the ceiling it crossed: " + " | ".join(said)
    )


# ════════════════════════════════════════════════════════════════════════════
# 3 · The double-notify trap
# ════════════════════════════════════════════════════════════════════════════

async def test_someone_the_mention_path_resolved_is_not_notified_again():
    """THE TRAP. Two writers both consider a message that names somebody theirs.

    `@Bela Rao standup in five` must be ONE notification for Bela — the mention,
    which is the more specific and more useful of the two — and not a mention
    plus a "new message" arriving together.
    """
    pool = FakePool(members=[member("user_bela"), member("user_raj")])
    await _fan_out(pool, content="@Bela Rao standup in five",
                   already_mentioned=frozenset({"user_bela"}))
    assert pool.notified() == {"user_raj"}


async def test_a_broadcast_dropped_by_the_mention_ceiling_is_not_picked_up_here():
    """`BROADCAST_NOTIFY_MAX_RECIPIENTS` deliberately gives a very large
    `@channel` its mention rows and its `@` badge and NO inbox row.

    That is why `fan_out_mentions` returns the RESOLVED set and not the NOTIFIED
    one. If this path notified everybody the ceiling dropped, it would spend
    exactly the fan-out the ceiling refused, and spend it silently.
    """
    pool = FakePool(members=[member("user_bela"), member("user_raj")])
    await _fan_out(pool, content="@channel all hands",
                   already_mentioned=frozenset({"user_bela", "user_raj"}))
    assert pool.inserts() == [] and pool.updates() == []


async def test_when_the_mention_path_is_skipped_the_named_person_still_gets_one():
    """093 outstanding, or the guard swallowing an error, hands this path an
    EMPTY set. One notification, never two — and never zero."""
    pool = FakePool(members=[member("user_bela")])
    await _fan_out(pool, content="@Bela Rao standup in five",
                   already_mentioned=frozenset())
    assert pool.notified() == {"user_bela"}


def test_fan_out_mentions_returns_what_it_resolved():
    """The contract the exclusion above depends on. A `-> None` here and the
    router's `mentioned` is always empty, silently, and everybody named gets two
    notifications for one message.
    """
    from services.samvaad_mentions import fan_out_mentions
    ann = inspect.signature(fan_out_mentions).return_annotation
    assert "frozenset" in str(ann), (
        f"fan_out_mentions returns {ann!r}; the message fan-out reads this set "
        f"to avoid double-notifying a mention"
    )


async def test_the_router_feeds_the_mention_result_into_the_message_fan_out():
    """Source-level, because the two calls being in the right ORDER with the
    right value flowing between them is the whole of the anti-double rule, and
    no mocked pool can observe an ordering that is expressed in Python."""
    from routers.messaging import send_message
    src = _body(send_message)
    m_at = src.find("_fan_out_mentions_guarded(")
    n_at = src.find("_notify_message_guarded(")
    assert m_at != -1 and n_at != -1, "send_message is missing one of the two fan-outs"
    assert m_at < n_at, (
        "the message fan-out runs BEFORE the mention fan-out, so it cannot "
        "know who was named and everybody mentioned gets two notifications"
    )
    assert re.search(r"mentioned\s*=\s*await\s+_fan_out_mentions_guarded", src), (
        "send_message throws away what the mention fan-out resolved"
    )
    assert re.search(r"mentioned\s*=\s*mentioned", src), (
        "the mention result is not passed to _notify_message_guarded"
    )


def test_edit_message_does_not_notify_the_room():
    """An edit is not a new message. Re-notifying a room because somebody fixed
    a typo is the failure the mention path's `is_edit` diff exists to avoid, and
    an archived `@channel` smuggled into an edit is the recorded attack."""
    from routers.messaging import edit_message, delete_message
    for fn in (edit_message, delete_message):
        assert "_notify_message_guarded(" not in _body(fn), (
            f"{fn.__name__} notifies the room; only send_message may"
        )


# ════════════════════════════════════════════════════════════════════════════
# 4 · Batching — one unread row per recipient per channel
# ════════════════════════════════════════════════════════════════════════════

async def test_a_second_message_updates_the_unread_row_instead_of_inserting():
    """Ten messages in a minute are ONE row, not ten. This is the difference
    between a notification people keep switched on and one they do not."""
    pool = FakePool(members=[member("user_bela", prev_id="notif_abc123abc123",
                                    unread=4)])
    await _fan_out(pool)
    assert pool.inserts() == [], "a second message inserted a second row"
    (sql, args), = pool.updates()
    assert "notif_abc123abc123" in args[0]
    assert "created_at = now()" in sql, (
        "the folded row was not lifted back to the top of the inbox, so the "
        "reader has already scrolled past it"
    )
    assert "read_at IS NULL" in sql, (
        "a recipient who read their inbox between the probe and this UPDATE "
        "would have the row they just read silently marked unread again"
    )


async def test_the_folded_row_says_how_many_messages_are_waiting():
    """The count is the recipient's own unread count for the channel — the same
    expression the channel badge uses — so the inbox row and the badge cannot
    disagree about how much there is to read."""
    pool = FakePool(members=[member("user_bela", prev_id="notif_abc", unread=10)])
    await _fan_out(pool)
    (_sql, args), = pool.updates()
    titles = [a for a in args if isinstance(a, list)][1]
    assert titles == ["10 new messages in #general"]


async def test_a_member_with_no_read_cursor_gets_a_sentence_and_not_a_wild_number():
    """`/live` reads a NULL `last_read_at` as `'-infinity'`, so a member who has
    never opened the channel counts its whole history as unread — 22 of the 170
    live member rows have that NULL. On a badge that is a wrong number; in a
    notification title it is a sentence, "944 new messages in #general" for one
    message. The probe returns NULL rather than a total when there is no cursor,
    and the title names the sender instead. Understating beats inventing.
    """
    code = _code()
    assert "CASE WHEN cm.last_read_at IS NULL THEN NULL" in code, (
        "the unread count no longer guards a missing read cursor"
    )
    assert "COALESCE(cm.last_read_at" not in code, (
        "the count coalesces a missing cursor to a floor again, which is what "
        "turns one message into `944 new messages`"
    )
    pool = FakePool(members=[member("user_bela", unread=0)])
    await _fan_out(pool)
    (_sql, args), = pool.inserts()
    titles = [a for a in args if isinstance(a, list)][2]
    assert titles == ["Keval Shah in #general"]


async def test_one_message_names_the_sender_rather_than_counting():
    pool = FakePool(members=[member("user_bela", unread=1)])
    await _fan_out(pool)
    (_sql, args), = pool.inserts()
    titles = [a for a in args if isinstance(a, list)][2]
    assert titles == ["Keval Shah in #general"]


async def test_a_dm_title_never_renders_a_bare_hash():
    """`find_or_create_dm` inserts `name = ''`, so `#` plus the name is a bare
    `#`. Every DM title names the sender instead."""
    pool = FakePool(members=[member("user_bela")], channel_type="dm",
                    channel_name="")
    await _fan_out(pool)
    (_sql, args), = pool.inserts()
    titles = [a for a in args if isinstance(a, list)][2]
    assert titles == ["Keval Shah"]
    assert "#" not in titles[0]


async def test_the_coalesce_probe_is_bounded_in_time_and_scoped_to_this_type():
    """Two jobs in one predicate.

    The type filter is what stops a `mention` row — same url shape, different
    meaning — being folded into and silently relabelled as a message. The time
    floor is what keeps the probe off the tail of a long notification history:
    `public.notifications` is indexed `(user_id, created_at DESC)` with nothing
    on `type`, so without it the LIMIT 1 walks every row a user has ever had.
    """
    code = _code()
    probe = code[code.find("LEFT JOIN LATERAL"):code.find("ON TRUE")]
    assert "type = $" in probe
    assert "read_at IS NULL" in probe
    assert "make_interval(hours =>" in probe
    assert "url LIKE" in probe
    assert "LIMIT 1" in probe


async def test_the_fan_out_costs_a_bounded_number_of_round_trips():
    """One probe and at most two writes, however many people are in the room.

    It used to be a per-recipient INSERT awaited in series in the mention path,
    INSIDE the sender's own request, so a 300-member channel made the sender wait
    out 300 sequential round trips before their own message appeared. That is
    the shape this must not grow back into.
    """
    pool = FakePool(members=[member(f"user_p{i:03d}") for i in range(60)])
    await _fan_out(pool)
    writes = [s for s, _a in pool.statements
              if s.startswith("INSERT") or s.startswith("UPDATE")]
    assert len(writes) == 1, f"{len(writes)} write statements for 60 recipients"
    assert len(pool.statements) <= 3, (
        f"{len(pool.statements)} queries for one message: "
        + "; ".join(s[:60] for s, _ in pool.statements)
    )


# ════════════════════════════════════════════════════════════════════════════
# 5 · Quiet hours suppress the device, never the record
# ════════════════════════════════════════════════════════════════════════════

def test_nothing_in_this_module_asks_the_clock_before_writing_a_row():
    """THE STANDING RULE. An in-app notification suppressed for quiet hours is
    not delayed — there is no queue anywhere in this product — it is LOST.

    `prefs_verdict`'s own docstring records the incident: Niyam's first armed
    rule was refused at 01:15 IST for exactly this reason and the message was
    simply gone. So this module must not reach for the window, the prefs, or any
    part of the gate itself; the ONLY thing it may do is hand the push to
    `send_push`, which asks both questions for the device and for nothing else.
    """
    code = _code()
    for forbidden in ("_in_quiet_hours", "prefs_verdict", "prefs_allow",
                      "quiet_start", "quiet_end", "DEFAULT_PREFS",
                      "quiet_hours_apply"):
        assert forbidden not in code, (
            f"samvaad_message_notify.py reaches for {forbidden!r}. The row is "
            f"written unconditionally; only the DEVICE may be gated, and only "
            f"inside send_push."
        )
    assert "send_push" in code, "the push does not go through the gated helper"


def test_the_row_is_written_above_the_push_in_source_order():
    """`server.create_notification` states the same rule in the same order and
    `tests/test_quiet_hours_parity.py` pins it for the other two delivery paths:
    the record goes to disk first, so a push that is refused — by preference or
    by the clock — leaves the inbox entry intact."""
    from services.samvaad_message_notify import fan_out_message_notification
    src = _body(fan_out_message_notification)
    assert src.find("INSERT INTO\n                notifications") != -1 \
        or src.find("INSERT INTO") != -1
    assert src.find("INSERT INTO") < src.find("ensure_future"), (
        "the push is scheduled before the notification rows are written"
    )


async def test_a_push_that_fails_does_not_cost_anybody_their_inbox_row(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("expo is down")
    import services.push_service as ps
    monkeypatch.setattr(ps, "send_push", _boom)

    pool = FakePool(members=[member("user_bela")], channel_type="dm",
                    channel_name="")
    n = await _fan_out(pool)
    assert n == 1
    assert pool.notified() == {"user_bela"}


async def test_the_push_goes_through_the_gated_helper_with_its_own_kind(push_log):
    """`push_service`'s module docstring asks that any new delivery path be
    gated there. Calling `send_web_push`/`send_expo_push` directly is what made
    every task notification ignore preferences and quiet hours for years."""
    pool = FakePool(members=[member("user_bela")], channel_type="dm",
                    channel_name="")
    await _fan_out(pool)
    assert len(push_log) == 1
    from services.samvaad_message_notify import NOTIF_TYPE
    assert push_log[0]["kind"] == NOTIF_TYPE
    assert push_log[0]["recipient_id"] == "user_bela"
    assert push_log[0]["is_mine"] is True, (
        "a DM is addressed to the recipient; is_mine=False would let a "
        "`mine_only` preference swallow it, which is the opposite of what that "
        "setting means to the person who set it"
    )
    assert push_log[0]["task_id"] is None, (
        "a task id here opens an empty task drawer instead of the channel"
    )


# ════════════════════════════════════════════════════════════════════════════
# 6 · DM versus channel
# ════════════════════════════════════════════════════════════════════════════

async def test_a_direct_message_pushes(push_log):
    pool = FakePool(members=[member("user_bela")], channel_type="dm",
                    channel_name="")
    await _fan_out(pool)
    assert [p["recipient_id"] for p in push_log] == ["user_bela"]


async def test_a_channel_message_writes_the_row_and_buzzes_nobody(push_log):
    """Slack's own default, and for the same reason: a room that buzzes every
    phone in it for every line is a room whose members switch notifications off
    — which costs them the mentions and the DMs too. A channel message that NAMES
    you still pushes, through the mention path, which is the point of naming
    somebody."""
    for kind in ("public", "private"):
        pool = FakePool(members=[member("user_bela")], channel_type=kind)
        await _fan_out(pool)
        assert pool.notified() == {"user_bela"}, f"{kind}: no in-app row"
    assert push_log == [], "a channel message buzzed a phone"


async def test_a_coalesced_dm_buzzes_again_only_once_the_row_has_gone_stale(push_log):
    """Without the re-arm a conversation that runs all afternoon buzzes once and
    is silent for the rest of the day. With it, ten rapid messages are one buzz
    and the reply an hour later is another."""
    fresh = FakePool(members=[member("user_bela", prev_id="notif_abc",
                                     prev_stale=False)],
                     channel_type="dm", channel_name="")
    await _fan_out(fresh)
    assert push_log == [], "a DM folded into a ninety-second-old row buzzed again"

    stale = FakePool(members=[member("user_bela", prev_id="notif_abc",
                                     prev_stale=True)],
                     channel_type="dm", channel_name="")
    await _fan_out(stale)
    assert [p["recipient_id"] for p in push_log] == ["user_bela"]


# ════════════════════════════════════════════════════════════════════════════
# 7 · The router guard: a missing notification must never become a duplicate
#     message
# ════════════════════════════════════════════════════════════════════════════

async def test_the_guard_swallows_everything_and_never_fails_the_send(monkeypatch):
    """By the time it runs, the message row is COMMITTED — `send_message` wrote
    it with a bare `pool.fetchrow`, its own connection, its own implicit
    transaction. An exception here cannot roll it back; all it can do is turn a
    201 into a 500, and `useChannelMessages` believes it: the optimistic row is
    stripped, "Failed to send" is toasted, and the user posts the message again.

    One missing notification must not become two posted messages.
    """
    import services.samvaad_message_notify as smn
    from routers.messaging import _notify_message_guarded

    async def _boom(*a, **k):
        raise RuntimeError("093 is not applied / the column is gone / anything")
    monkeypatch.setattr(smn, "fan_out_message_notification", _boom)

    await _notify_message_guarded(
        FakePool(), org_id=ORG, channel_id=CHANNEL, message_id=MESSAGE,
        actor_id=ACTOR, content="hello", message_type="text",
        parent_message_id=None, mentioned=frozenset(),
    )   # must simply return


async def test_the_guard_lets_a_client_disconnect_through(monkeypatch):
    """`Exception`, not `BaseException`. `asyncio.CancelledError` is a client
    disconnect and has to keep propagating or the request never actually stops.
    """
    import services.samvaad_message_notify as smn
    from routers.messaging import _notify_message_guarded

    async def _cancelled(*a, **k):
        raise asyncio.CancelledError()
    monkeypatch.setattr(smn, "fan_out_message_notification", _cancelled)

    with pytest.raises(asyncio.CancelledError):
        await _notify_message_guarded(
            FakePool(), org_id=ORG, channel_id=CHANNEL, message_id=MESSAGE,
            actor_id=ACTOR, content="hello", message_type="text",
            parent_message_id=None, mentioned=frozenset(),
        )


def test_the_message_path_does_not_wait_on_migration_093():
    """The one place this guard differs from the mention guard, and it is
    deliberate: nothing here touches an object 093 creates. It reads
    `samvada_channels` and `samvada_channel_members` (058) and writes
    `public.notifications`, which predates all of it. Message notifications
    therefore work on a database where 093 is still outstanding — which is
    exactly the state the mention feature spends its own guard surviving.
    """
    from routers.messaging import _notify_message_guarded
    assert "_parity_ready" not in _body(_notify_message_guarded)


def test_the_mention_guard_still_returns_the_empty_set_when_it_skips():
    """`frozenset()` on every path that does not run means "this layer claims
    nobody", so the message fan-out covers everyone including anybody who was
    named. The alternative — `None` — is a TypeError inside the `in` test, on
    the send path, after the message is committed."""
    from routers.messaging import _fan_out_mentions_guarded
    src = _body(_fan_out_mentions_guarded)
    assert src.count("frozenset()") >= 2
    assert "-> frozenset" in inspect.getsource(_fan_out_mentions_guarded).split("\n")[2] \
        or "frozenset" in str(inspect.signature(_fan_out_mentions_guarded).return_annotation)
