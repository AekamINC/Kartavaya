"""`include_reply_counts` on GET /channels/{id}/messages, and what it may not gate.

WHAT THIS PARAMETER TURNED OUT TO BE. The brief called it the gate on Sanvaad's
reply counts. It is not, and the file says so before the tests do: `thread_count`
and `last_reply_at` have been on every row of every call since the thread work
landed, with no parameter, and the shipped client reads both —
`sanvaad/Message.jsx:346` decides whether the thread link renders at all from
`Number(msg.thread_count) || 0`, and `:610` stamps "Last reply 20m ago" from
`msg.last_reply_at`. Neither call site in `useChannelMessages.js` (`:127`
unpaged, `:376` paged) passes a flag. A parameter defaulting FALSE that gated
those two would therefore not preserve the existing caller's response, it would
delete two fields out from under the deployed UI — the exact regression the
default is supposed to prevent. So the default returns what the default returned
yesterday, and the flag gates the one key that is new: `thread_faces`, the three
replier avatars `Msg2Chat.jsx:135-137` draws beside the count.

HOW THESE TESTS ARE WRITTEN, and why not the obvious way. A decorative test here
asserts `"include_reply_counts" in sql` and passes against any implementation
that mentions the string. The fake below instead EVALUATES each sub-select: it
finds the expression that ends `) AS thread_count`, reads which predicates that
expression actually carries, and applies only those to an in-memory message
table. Drop `AND t.is_deleted = FALSE` from the router and the fake counts the
retracted reply and `test_a_deleted_reply_is_not_counted` goes red on the NUMBER,
not on a missing substring. Drop `DISTINCT ON` and one person's two replies come
back as two faces. Drop the `COALESCE(..., '[]')` and the empty-thread test gets
`None` where it demanded `[]`.

It dispatches on the QUERY and never on call order, for the reason
`test_recurring_invoice_generator._Pool` records in its own docstring: ordering
side effects to match a handler's exact query sequence is what made adding one
query to another module cost eight unrelated red tests.

WHAT IT CANNOT PROVE. The pool is fake, so nothing here shows a statement runs
against Postgres — `routers/messaging.py:30-41` is emphatic about this, and it is
why the scoping fix in that file was verified against the live catalogue instead.
`test_the_flag_changes_nothing_but_the_one_expression` is the compensating check:
it does not model the database at all, it takes the SQL the handler emits with
the flag off and with the flag on and shows the second is the first plus one
expression and nothing else.
"""
import inspect
import re
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from conftest import TEST_ORG_ID

CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
OTHER_CHANNEL_ID = "cccccccc-dddd-eeee-ffff-000000000000"
FOREIGN_ORG_ID = "00000000-0000-0000-0000-0000000000ff"

ROOT_ID = "11111111-2222-3333-4444-555555555555"
QUIET_ROOT_ID = "99999999-8888-7777-6666-555555555555"
#: The cursor the paged arm scrolls back from. It has to be a real uuid: an
#: unparseable `before` is answered with an empty page before any query runs
#: (`list_messages`, the `_valid_uuid` guard), so a placeholder here would make
#: the paging tests pass against a handler that never looked at the flag.
NEWEST_ID = "77777777-6666-5555-4444-333333333333"

T0 = datetime(2026, 8, 5, 9, 0, tzinfo=timezone.utc)


def _at(minutes: int) -> datetime:
    return T0 + timedelta(minutes=minutes)


#: The user table the INNER JOIN resolves against. A sender missing from here
#: drops its message, which is what `JOIN users u` does.
USERS = {
    "user_mem001": {"full_name": "Aanya Rao", "avatar": "aanya.png"},
    "user_mem002": {"full_name": "Rohan Iyer", "avatar": None},
    "user_mem003": {"full_name": "Bela Nair", "avatar": "bela.png"},
    "user_mem004": {"full_name": "Devi Menon", "avatar": None},
    # Only ever seen on the rows that must NOT surface, and never on a legitimate
    # reply. A face list that leaks one of these names it.
    "user_mem005": {"full_name": "Other Channel", "avatar": None},
    "user_mem006": {"full_name": "Other Tenant", "avatar": None},
}

#: Exactly the columns `m.*` expands to. Frozen here so that the key-set
#: assertion below is a statement about the handler and not about the fixture.
MESSAGE_COLUMNS = (
    "id", "org_id", "channel_id", "sender_id", "content", "type",
    "parent_message_id", "is_deleted", "created_at", "edited_at", "pinned_at",
)

#: The response keys the endpoint returned BEFORE this change, transcribed from
#: `_COLS` rather than derived from it, so widening one is a deliberate
#: two-place edit and never an accident.
DEFAULT_KEYS = set(MESSAGE_COLUMNS) | {
    "sender_name", "sender_avatar", "thread_count", "last_reply_at",
    "reactions", "seen_by", "seen_count",
}


def _msg(mid, *, sender="user_mem001", parent=None, deleted=False, at=T0,
         channel=CHANNEL_ID, org=TEST_ORG_ID, content="hello"):
    return {
        "id": mid, "org_id": org, "channel_id": channel, "sender_id": sender,
        "content": content, "type": "text", "parent_message_id": parent,
        "is_deleted": deleted, "created_at": at, "edited_at": None,
        "pinned_at": None,
    }


# ════════════════════════════════════════════════════════════════════════════
# The fake: dispatches on the query, and evaluates the predicates it finds
# ════════════════════════════════════════════════════════════════════════════

def _flat(sql) -> str:
    return " ".join(str(sql).split())


def _expr_for(sql: str, alias: str):
    """The full parenthesised sub-select that ends `) AS <alias>`.

    Walks back from the closing paren counting depth, so a sub-select that
    itself contains parentheses — every one of these does — is returned whole.
    Returns None when the query does not name that alias at all, which is how
    the default arm is told from the flagged one.
    """
    hit = re.search(rf"\)\s+AS\s+{alias}\b", sql)
    if not hit:
        return None
    end = sql.index(")", hit.start())
    depth = 0
    for j in range(end, -1, -1):
        if sql[j] == ")":
            depth += 1
        elif sql[j] == "(":
            depth -= 1
            if depth == 0:
                return sql[j:end + 1]
    raise AssertionError(f"unbalanced parentheses before AS {alias}")


def _replies_matching(expr: str, root: dict, messages) -> list:
    """Rows the sub-select `expr` would see, applying ONLY its own predicates.

    This is the whole point of the fixture. The scoping on these sub-selects is
    not decoration — `thread_count` once counted every row in the database
    pointing at a message id, which surfaced "1 reply" under a message in a room
    the replier could not post in. Any predicate removed from the router is a
    predicate not applied here, and the count the test asserts changes.
    """
    rows = list(messages)
    if "parent_message_id = m.id" in expr:
        rows = [r for r in rows if r["parent_message_id"] == root["id"]]
    if re.search(r"\.is_deleted = FALSE", expr):
        rows = [r for r in rows if not r["is_deleted"]]
    if re.search(r"\.channel_id = m\.channel_id", expr):
        rows = [r for r in rows if r["channel_id"] == root["channel_id"]]
    if re.search(r"\.org_id = m\.org_id", expr):
        rows = [r for r in rows if r["org_id"] == root["org_id"]]
    return sorted(rows, key=lambda r: r["created_at"])


def _faces(expr: str, root: dict, messages):
    rows = _replies_matching(expr, root, messages)
    if "DISTINCT ON" in expr:
        first = {}
        for r in rows:                      # already oldest-first
            first.setdefault(r["sender_id"], r)
        rows = sorted(first.values(), key=lambda r: r["created_at"])
    cap = re.search(r"LIMIT (\d+)", expr)
    if cap:
        rows = rows[: int(cap.group(1))]
    out = [
        {"user_id": r["sender_id"],
         "full_name": USERS[r["sender_id"]]["full_name"],
         "avatar": USERS[r["sender_id"]]["avatar"]}
        for r in rows if r["sender_id"] in USERS
    ]
    # `COALESCE(json_agg(...), '[]')` is the difference between `[]` and `None`
    # on a root with no replies, and the client spreads the value.
    if not out and "COALESCE(json_agg" not in expr:
        return None
    return out


class _Wire:
    """Installs query-dispatched answers onto the conftest pool."""

    def __init__(self, pool, messages, *, channel=None, membership=True):
        self.pool = pool
        self.messages = messages
        self.channel = channel or {"type": "public", "is_archived": False}
        self.membership = {"?column?": 1} if membership else None
        self.queries = []
        pool.fetch = AsyncMock(side_effect=self._fetch)
        pool.fetchrow = AsyncMock(side_effect=self._fetchrow)
        pool.fetchval = AsyncMock(return_value=0)

    async def _fetchrow(self, sql, *args):
        s = _flat(sql)
        self.queries.append(s)
        if "staging.samvada_channel_members" in s:
            return self.membership
        if "staging.samvada_channels" in s:
            return self.channel
        return None

    async def _fetch(self, sql, *args):
        s = _flat(sql)
        self.queries.append(s)
        # Recognised by `seen_count`, which is unconditional and belongs to a
        # different feature, so the fake still recognises the statement if the
        # thread columns are ever gated away — and the test then fails on the
        # missing key instead of on an empty page.
        if "FROM staging.samvada_messages m" not in s or "AS seen_count" not in s:
            return []
        return self._list_messages(s, args)

    # ── the list query, evaluated ────────────────────────────────────────────
    def _list_messages(self, s: str, args) -> list:
        channel_id, limit = args[0], args[1]
        rows = list(self.messages)
        if "m.channel_id = $1::uuid" in s:
            rows = [r for r in rows if r["channel_id"] == channel_id]
        if "m.is_deleted = FALSE" in s:
            rows = [r for r in rows if not r["is_deleted"]]
        if "m.parent_message_id IS NULL" in s:
            rows = [r for r in rows if r["parent_message_id"] is None]
        if "m.created_at <" in s:
            # The cursor sub-select is scoped to the channel; a cursor that is
            # not in this channel resolves to NULL and the page is empty.
            cur = next(
                (r for r in self.messages
                 if r["id"] == args[2]
                 and (r["channel_id"] == channel_id
                      or "cur.channel_id = $1::uuid" not in s)),
                None,
            )
            if cur is None:
                return []
            rows = [r for r in rows if r["created_at"] < cur["created_at"]]

        rows = [r for r in rows if r["sender_id"] in USERS]      # JOIN users
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        rows = rows[:limit]

        count_expr = _expr_for(s, "thread_count")
        last_expr = _expr_for(s, "last_reply_at")
        faces_expr = _expr_for(s, "thread_faces")

        out = []
        for r in rows:
            row = {c: r[c] for c in MESSAGE_COLUMNS}
            row["sender_name"] = USERS[r["sender_id"]]["full_name"]
            row["sender_avatar"] = USERS[r["sender_id"]]["avatar"]
            # A key the query does not ask for is a key the response does not
            # carry — that is how a flag that gated `thread_count` would show up
            # here, as the missing field the deployed client reads, rather than
            # as a crash inside the fixture.
            if count_expr is not None:
                replies = _replies_matching(count_expr, r, self.messages)
                row["thread_count"] = len(replies) if "COUNT(*)" in count_expr else None
            if last_expr is not None:
                latest = _replies_matching(last_expr, r, self.messages)
                row["last_reply_at"] = (
                    max(x["created_at"] for x in latest) if latest else None)
            row["reactions"] = []
            row["seen_by"] = []
            row["seen_count"] = 0
            if faces_expr is not None:
                row["thread_faces"] = _faces(faces_expr, r, self.messages)
            out.append(row)
        return out

    def list_sql(self) -> str:
        return next(q for q in self.queries
                    if "FROM staging.samvada_messages m" in q and "AS seen_count" in q)


# ════════════════════════════════════════════════════════════════════════════
# Fixtures
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """The subscription/reach gate is `test_module_write_level.py`'s subject.
    Left on, every assertion below would be ambiguous between "the flag is
    wrong" and "there is no subscription"."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches at module scope, so the cache is test state and a
    test that leaves it set poisons every later file in the process."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


#: One root with a live thread, one root nobody answered, and the four kinds of
#: reply that must not be counted: deleted, another channel's, another tenant's,
#: and a second reply from somebody who already appears.
@pytest.fixture
def wire(mock_pool):
    messages = [
        _msg(ROOT_ID, sender="user_mem001", at=_at(0), content="root"),
        _msg(QUIET_ROOT_ID, sender="user_mem001", at=_at(1), content="nobody replied"),
        _msg("r1", sender="user_mem002", parent=ROOT_ID, at=_at(5)),
        _msg("r2", sender="user_mem003", parent=ROOT_ID, at=_at(6)),
        _msg("r3", sender="user_mem002", parent=ROOT_ID, at=_at(7)),
        _msg("r4", sender="user_mem004", parent=ROOT_ID, at=_at(8)),
        _msg("d1", sender="user_mem004", parent=ROOT_ID, at=_at(9), deleted=True),
        # EARLIER than every legitimate reply, and from senders who appear
        # nowhere else. Both are deliberate: at t+10 they would fall outside the
        # three-face cap and a lost predicate would leave no trace in the
        # response, and sharing a sender with a real reply would let `DISTINCT
        # ON` hide the leak by collapsing the two into one face.
        _msg("x1", sender="user_mem005", parent=ROOT_ID, at=_at(2),
             channel=OTHER_CHANNEL_ID),
        _msg("f1", sender="user_mem006", parent=ROOT_ID, at=_at(3),
             org=FOREIGN_ORG_ID),
    ]
    return _Wire(mock_pool, messages)


async def _get(api_client, **params):
    r = await api_client.get(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages", params=params)
    assert r.status_code == 200, r.text
    return {row["id"]: row for row in r.json()}


# ════════════════════════════════════════════════════════════════════════════
# 1. The default response, which is the regression that matters
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_default_call_returns_exactly_the_keys_it_returned_before(
    api_client, as_member, with_org_id, wire
):
    """No `thread_faces`, and nothing else added or dropped either."""
    rows = await _get(api_client)
    assert set(rows[ROOT_ID]) == DEFAULT_KEYS
    assert "thread_faces" not in rows[ROOT_ID]


@pytest.mark.asyncio
async def test_the_default_call_still_carries_the_count_and_the_last_reply(
    api_client, as_member, with_org_id, wire
):
    """`Message.jsx:346` and `:610` read these with no flag. If a default-FALSE
    parameter ever gates them, the deployed thread link disappears — which is
    why the flag gates only the new key."""
    rows = await _get(api_client)
    assert rows[ROOT_ID]["thread_count"] == 4
    assert rows[ROOT_ID]["last_reply_at"] is not None


@pytest.mark.asyncio
async def test_the_flag_changes_nothing_but_the_one_expression(
    api_client, as_member, with_org_id, mock_pool
):
    """The SQL with the flag on is the SQL with the flag off plus `thread_faces`.

    This is the check the fake cannot make: it compares the two statements the
    handler actually emits, character for character, so a flag that also
    reorders a join, drops a predicate or changes the ORDER BY fails here even
    though every behavioural assertion above would still pass.
    """
    off = _Wire(mock_pool, [])
    await _get(api_client)
    plain = off.list_sql()

    on = _Wire(mock_pool, [])
    await _get(api_client, include_reply_counts=1)
    flagged = on.list_sql()

    faces = _expr_for(flagged, "thread_faces")
    assert faces is not None, "include_reply_counts=1 added no thread_faces expression"
    stripped = flagged.replace(f", {faces} AS thread_faces", "")
    assert stripped == plain, (
        "the flag changed the query beyond adding thread_faces:\n"
        f"  with flag, stripped: {stripped}\n  without flag:        {plain}"
    )


@pytest.mark.asyncio
async def test_the_parameter_is_bounded(api_client, as_member, with_org_id, wire):
    """`ge=0, le=1`. A stray `include_reply_counts=2` is a client bug and gets a
    422, not a silently-true flag."""
    r = await api_client.get(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        params={"include_reply_counts": 2})
    assert r.status_code == 422


# ════════════════════════════════════════════════════════════════════════════
# 2. What the flag turns on
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_asking_for_it_returns_the_repliers(
    api_client, as_member, with_org_id, wire
):
    """`Msg2Chat.jsx:136` maps `m.thread.faces` to an avatar and an initial, so
    each entry needs an id, a name and an avatar that may be null."""
    rows = await _get(api_client, include_reply_counts=1)
    faces = rows[ROOT_ID]["thread_faces"]
    assert [f["user_id"] for f in faces] == ["user_mem002", "user_mem003", "user_mem004"]
    assert faces[0] == {"user_id": "user_mem002", "full_name": "Rohan Iyer",
                        "avatar": None}
    assert faces[1]["avatar"] == "bela.png"


@pytest.mark.asyncio
async def test_one_person_replying_twice_is_one_face(
    api_client, as_member, with_org_id, wire
):
    """`user_mem002` posted r1 and r3. The prototype draws distinct people, not
    a repeat of the same avatar — that is what `DISTINCT ON (sender_id)` buys,
    and the count beside it still says 4."""
    rows = await _get(api_client, include_reply_counts=1)
    ids = [f["user_id"] for f in rows[ROOT_ID]["thread_faces"]]
    assert len(ids) == len(set(ids))
    assert rows[ROOT_ID]["thread_count"] == 4


@pytest.mark.asyncio
async def test_the_faces_are_the_earliest_repliers_and_there_are_at_most_three(
    api_client, as_member, with_org_id, mock_pool
):
    """Five distinct repliers, three drawn. The cap has to be applied AFTER the
    per-sender dedupe and ordered by first reply — a LIMIT inside `DISTINCT ON`
    would return the three lowest sender ids instead, which is arbitrary."""
    late = _msg("r9", sender="user_mem001", parent=ROOT_ID, at=_at(30))
    w = _Wire(mock_pool, [
        _msg(ROOT_ID, sender="user_mem003", at=_at(0)),
        _msg("r1", sender="user_mem004", parent=ROOT_ID, at=_at(5)),
        _msg("r2", sender="user_mem003", parent=ROOT_ID, at=_at(6)),
        _msg("r3", sender="user_mem002", parent=ROOT_ID, at=_at(7)),
        late,
    ])
    rows = await _get(api_client, include_reply_counts=1)
    assert [f["user_id"] for f in rows[ROOT_ID]["thread_faces"]] == [
        "user_mem004", "user_mem003", "user_mem002"]
    assert rows[ROOT_ID]["thread_count"] == 4
    assert w.list_sql()


# ════════════════════════════════════════════════════════════════════════════
# 3. Nothing counted that should not be
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_deleted_reply_is_not_counted_and_leaves_no_face(
    api_client, as_member, with_org_id, wire
):
    """`d1` is `user_mem004`'s SECOND reply and it is deleted, so removing
    `is_deleted = FALSE` from the new sub-select would not change the face list
    — hence the count assertion beside it, which does move. Deletion in this
    router is `is_deleted = TRUE` and never a DELETE (`delete_message`), so
    every read has to carry the predicate itself."""
    rows = await _get(api_client, include_reply_counts=1)
    assert rows[ROOT_ID]["thread_count"] == 4          # r1 r2 r3 r4, not d1
    assert rows[ROOT_ID]["last_reply_at"] == _at(8).isoformat()


@pytest.mark.asyncio
async def test_only_the_deleted_reply_leaves_a_thread_with_no_faces(
    api_client, as_member, with_org_id, mock_pool
):
    """The face list on its own: one replier, one retraction, nobody left."""
    _Wire(mock_pool, [
        _msg(ROOT_ID, sender="user_mem001", at=_at(0)),
        _msg("d1", sender="user_mem002", parent=ROOT_ID, at=_at(5), deleted=True),
    ])
    rows = await _get(api_client, include_reply_counts=1)
    assert rows[ROOT_ID]["thread_count"] == 0
    assert rows[ROOT_ID]["thread_faces"] == []


@pytest.mark.asyncio
async def test_a_reply_from_another_channel_or_another_tenant_leaves_no_face(
    api_client, as_member, with_org_id, wire
):
    """`x1` and `f1` point at this root from another channel and another org.

    They predate the write-path gate and are still in the table; the count
    already refuses them, and the faces must refuse them the same way or the
    avatar row and the number beside it disagree. Both are the OLDEST replies on
    the root, so either predicate lost puts a stranger at the front of the face
    list rather than off the end of a three-face cap.
    """
    rows = await _get(api_client, include_reply_counts=1)
    ids = [f["user_id"] for f in rows[ROOT_ID]["thread_faces"]]
    assert ids == ["user_mem002", "user_mem003", "user_mem004"]
    assert rows[ROOT_ID]["thread_count"] == 4


@pytest.mark.asyncio
async def test_a_root_with_no_replies_is_zero_and_empty_and_never_null(
    api_client, as_member, with_org_id, wire
):
    """`0`, `[]`, `None` — in that order and no other. `thread_count` must not
    be null because `Message.jsx:346` coerces it and a null would read as zero
    by luck rather than by contract; `thread_faces` must not be null because the
    client spreads it, which is why `reactions` and `seen_by` are COALESCE'd."""
    rows = await _get(api_client, include_reply_counts=1)
    quiet = rows[QUIET_ROOT_ID]
    assert quiet["thread_count"] == 0
    assert quiet["thread_faces"] == []
    assert quiet["last_reply_at"] is None


# ════════════════════════════════════════════════════════════════════════════
# 4. The cursor arm, and the four queries that must not have moved
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_paged_arm_honours_the_flag_too(
    api_client, as_member, with_org_id, mock_pool
):
    """`useChannelMessages.js:376` scrolls back with `before`, and it is a
    different SQL statement. Both arms build from the same `_COLS`; this is what
    keeps that true."""
    _Wire(mock_pool, [
        _msg(NEWEST_ID, sender="user_mem001", at=_at(50)),
        _msg(ROOT_ID, sender="user_mem001", at=_at(0)),
        _msg("r1", sender="user_mem002", parent=ROOT_ID, at=_at(5)),
    ])
    rows = await _get(api_client, before=NEWEST_ID, include_reply_counts=1)
    assert ROOT_ID in rows
    assert [f["user_id"] for f in rows[ROOT_ID]["thread_faces"]] == ["user_mem002"]
    assert rows[ROOT_ID]["thread_count"] == 1


@pytest.mark.asyncio
async def test_the_paged_arm_default_is_unchanged_as_well(
    api_client, as_member, with_org_id, mock_pool
):
    _Wire(mock_pool, [
        _msg(NEWEST_ID, sender="user_mem001", at=_at(50)),
        _msg(ROOT_ID, sender="user_mem001", at=_at(0)),
        _msg("r1", sender="user_mem002", parent=ROOT_ID, at=_at(5)),
    ])
    rows = await _get(api_client, before=NEWEST_ID)
    assert set(rows[ROOT_ID]) == DEFAULT_KEYS
    assert rows[ROOT_ID]["thread_count"] == 1


def test_no_other_handler_learned_about_this_flag():
    """The named failure mode for this change was editing the WRONG
    `parent_message_id IS NULL`.

    There are five in this file: two are the arms of `list_messages`, and the
    other three belong to `list_channels`' unread sub-select, `GET /unread` and
    the 4s `/live` poll. `search_messages` has none — it deliberately RETURNS
    `parent_message_id` so a hit inside a thread can be resolved to its root,
    and filtering it would break jump-to-message. This reads each handler's own
    source and asserts the change landed in exactly one of them. It is a
    structural check and it is named as one; the behavioural checks are above.
    """
    from routers import messaging as M

    others = ["list_channels", "unread_counts", "live", "search_messages",
              "get_thread", "list_mentions", "list_pins"]
    for name in others:
        src = inspect.getsource(getattr(M, name))
        assert "include_reply_counts" not in src, f"{name} grew the flag"
        assert "thread_faces" not in src, f"{name} grew thread_faces"

    listing = inspect.getsource(M.list_messages)
    assert "include_reply_counts" in listing
    assert "thread_faces" in listing


def test_the_new_subselect_is_scoped_like_the_two_beside_it():
    """Read off the source, not off a mock: the fake honours whatever predicates
    it finds, so it proves the three sub-selects AGREE, not that any of them is
    scoped at all. Both statements are needed and neither substitutes for the
    other."""
    from routers import messaging as M

    src = " ".join(inspect.getsource(M.list_messages).split())
    faces = _expr_for(src, "thread_faces")
    assert faces is not None
    for predicate in ("parent_message_id = m.id", "is_deleted = FALSE",
                      "channel_id = m.channel_id", "org_id = m.org_id"):
        assert predicate in faces, f"thread_faces is missing `{predicate}`"
