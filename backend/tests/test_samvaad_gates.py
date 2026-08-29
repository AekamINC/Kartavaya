"""The five gates the second adversarial review found open, and the names behind them.

Everything in this file is a door that was standing open on a feature that had
already passed `pytest`, `npm run check`, vitest, `npm run build` and one full
round of adversarial review. That is the point of the file. None of these is a
crash, a 500 or a failing assertion anywhere — each one is a request that
succeeds and should not, which is invisible to a suite that only asks "does the
handler answer 2xx?".

In the order of what an attacker or an accident gets out of them:

1. **An archived channel refused only `send` and `pin`.** Edit, delete and
   reaction went through. The sharp end is the edit: archive `#q1-audit`, PATCH
   your own year-old message in it to "@channel please re-open this", and the
   hardening round's mention fan-out pages every member of that channel — a
   notification row and a push each — from a room the product's own banner says
   nobody can post in. Without the fan-out it was still wrong: it rewrites the
   visible text of an archived message, which is the one thing "History stays
   searchable" was meant to guarantee against. Delete is worse in a quieter way:
   `is_deleted = TRUE` removes the row from `list_messages`, `get_thread`,
   `list_pins` and `search` at once, so an archived channel could still be
   emptied one message at a time.

2. **`parent_message_id` came off the wire and went straight into the INSERT.**
   The only thing behind it was the column's own foreign key, which points at
   `samvada_messages(id)` and carries no org and no channel. So any message id in
   the database was an accepted parent, and none of it needed guessing —
   `GET /channels/{archived}/messages` hands the ids out by design.

3. **The same field with ANOTHER TENANT's message id is a cross-tenant write.**
   It is the most serious thing in this feature: a row in this org's channel
   whose `parent_message_id` points into somebody else's data, written by an
   ordinary editor with no privilege at all, and — before section 4 — read back
   out under their message by `get_thread`.

4. **The read half.** A write gate alone leaves whatever is already in the
   table. `get_thread` and the `thread_count`/`last_reply_at` sub-selects
   selected every row in the database pointing at a parent id, so a reply written
   from anywhere surfaced as "1 reply" under a message in a room its author could
   not post in, and its text was served to everyone who clicked.

5. **Muting a public channel you had never joined manufactured a four-figure
   unread badge.** `muted` is a column on `samvada_channel_members`, so a mute by
   a non-member has to write a membership row — and that row came out with
   `last_read_at` NULL. Every unread count in this module is
   `CASE WHEN cm_me.user_id IS NULL THEN 0 ELSE (… COALESCE(cm_me.last_read_at,
   '-infinity'))`, and the NULL-user check was the only thing holding the count
   at zero. Pressing mute on a five-year-old `#general` lit up the entire history
   as unread on the channel the user had just asked to be quiet.

Section 6 is the schema check, in the style of `tests/test_prachar_audience.py`.
The pool is mocked everywhere above and — exactly as `routers/messaging.py:30-41`
warns — a mocked cursor resolves any name you give it, so nothing above proves a
statement RUNS. It also carries the check the fixes themselves could not make:
none of these gates may name a column that 093 introduces, because 093 is applied
BY HAND and a gate that only closes after the migration is a gate that is open
for the length of the deploy window.

The fake pool and the fan-out probe are imported rather than copied, for the
reason `test_samvaad_hardening` records: one fake, one set of answers, so a
handler that changes the shape of a query breaks both files together instead of
this one quietly passing against a stale copy.
"""
import inspect
import pathlib
import re
from unittest.mock import AsyncMock

import pytest

from conftest import TEST_ORG_ID
from test_samvaad_hardening import fan_out_calls  # noqa: F401 — used as a fixture

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ROUTER = BACKEND / "routers" / "messaging.py"
MIGRATION_058 = BACKEND / "migrations" / "058_sanvaad_messaging.sql"
MIGRATION_093 = BACKEND / "migrations" / "093_sanvaad_slack_parity.sql"

#: The channel the caller is acting in.
CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
#: A second channel in the SAME org. Readable by the caller, which is the whole
#: problem: an archived or public channel hands its message ids out by design.
OTHER_CHANNEL_ID = "cccccccc-dddd-eeee-ffff-000000000000"
#: A channel belonging to somebody else's org.
FOREIGN_CHANNEL_ID = "dddddddd-eeee-ffff-0000-111111111111"

FOREIGN_ORG_ID = "00000000-0000-0000-0000-0000000000ff"

MESSAGE_ID = "11111111-2222-3333-4444-555555555555"
#: A real message, in this org, in a channel that is NOT the one being posted to.
OTHER_CHANNEL_MESSAGE_ID = "22222222-3333-4444-5555-666666666666"
#: A real message belonging to another tenant entirely.
FOREIGN_ORG_MESSAGE_ID = "33333333-4444-5555-6666-777777777777"
#: A message in this channel that is itself a reply.
REPLY_MESSAGE_ID = "44444444-5555-6666-7777-888888888888"

ARCHIVED_SENTENCE = "This channel is archived"


# ════════════════════════════════════════════════════════════════════════════
# Harness
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Reach and the write-verb gate belong to `test_module_write_level.py`.
    Leaving them on would make every non-2xx below ambiguous between "the gate
    is closed" and "there is no subscription"."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches at MODULE scope, so the cache is test state.

    Pinned TRUE, because every gate here must hold in the world where 093 has
    landed AND in the world where it has not — section 6 is what proves the
    second half, by showing no gate names a column 093 introduces. Left to the
    mock's default `fetchval` of `0`, the first test in the process would decide
    093 was never applied and poison every later file.
    """
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


#: The message table these tests pretend the database holds. Keyed by id; the
#: values are what the parent probe's `WHERE id=$1 AND channel_id=$2 AND
#: org_id=$3` is matched against, because that predicate returning NOTHING is
#: precisely how the gate refuses. A fake that answered the probe from call order
#: instead would pass whether or not the channel and org were in the WHERE.
MESSAGES = {
    MESSAGE_ID: {
        "channel_id": CHANNEL_ID, "org_id": TEST_ORG_ID,
        "parent_message_id": None, "is_deleted": False,
    },
    OTHER_CHANNEL_MESSAGE_ID: {
        "channel_id": OTHER_CHANNEL_ID, "org_id": TEST_ORG_ID,
        "parent_message_id": None, "is_deleted": False,
    },
    FOREIGN_ORG_MESSAGE_ID: {
        "channel_id": FOREIGN_CHANNEL_ID, "org_id": FOREIGN_ORG_ID,
        "parent_message_id": None, "is_deleted": False,
    },
    REPLY_MESSAGE_ID: {
        "channel_id": CHANNEL_ID, "org_id": TEST_ORG_ID,
        "parent_message_id": MESSAGE_ID, "is_deleted": False,
    },
}


def _wire(mock_pool, *, level="editor", archived=False, channel_type="public",
          membership=True, sender_id="user_mem001", exec_status="UPDATE 1",
          message_channel=CHANNEL_ID):
    """A pool whose answers are chosen by SQL shape, not by call order.

    `test_messaging_security.py` orders `fetchrow` side effects to match each
    handler's exact query sequence, and the record of this work says that adding
    one query to `send_message` breaks every one of those tests. The gates below
    ADD queries — a parent probe, an archive lookup — so a call-ordered fake
    would make every test here a test of the query order rather than of the gate.
    Nothing here depends on the order.

    `archived` is answered off the SQL rather than off a counter for the same
    reason: `send_message` and `pin_message` read the flag off a channel row they
    already hold, while `edit_message`, `delete_message` and `add_reaction` go
    through `_assert_not_archived`'s own `SELECT is_archived`. One flag, both
    shapes, so a handler that switches between them stays covered.
    """
    async def _fetchval(sql, *a):
        s = " ".join(str(sql).split())
        # First, or the level ladder's `return 0` fallback would answer the
        # archive probe with a falsy value and every archived test would pass
        # for the wrong reason.
        if "is_archived" in s and "samvada_channels" in s:
            return archived
        if "org_id IS NULL" in s:
            return None
        if "role_code IN ('org_owner','org_admin')" in s:
            return None
        if "org_member_modules" in s:
            return level
        return 0

    async def _fetchrow(sql, *a):
        s = " ".join(str(sql).split())
        # Messages before channels: the parent probe, `send_message`'s INSERT and
        # `edit_message`'s UPDATE all name a channel id, so a looser test would
        # hand one of them the channel row.
        if "public.samvada_messages" in s:
            if "SELECT parent_message_id" in s:
                # The probe, emulated as Postgres answers it: the row comes back
                # only if EVERY predicate matches. `a` is (parent, channel, org).
                row = MESSAGES.get(a[0])
                if row is None or row["is_deleted"]:
                    return None
                if len(a) >= 3 and (row["channel_id"] != a[1] or row["org_id"] != a[2]):
                    return None
                return {"parent_message_id": row["parent_message_id"]}
            if s.startswith("INSERT") or s.startswith("UPDATE"):
                return _message_row()
            return {"channel_id": message_channel, "sender_id": sender_id, "1": 1}
        if "public.samvada_channels" in s:
            return {"id": CHANNEL_ID, "type": channel_type,
                    "is_archived": archived, "name": "q1-audit"}
        if "public.samvada_channel_members" in s:
            return {"?column?": 1} if membership else None
        return None

    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        owner.fetchval = AsyncMock(side_effect=_fetchval)
        owner.fetchrow = AsyncMock(side_effect=_fetchrow)
        owner.fetch = AsyncMock(return_value=[])
        owner.execute = AsyncMock(return_value=exec_status)
    return mock_pool


def _message_row(**over) -> dict:
    row = {
        "id": MESSAGE_ID,
        "org_id": TEST_ORG_ID,
        "channel_id": CHANNEL_ID,
        "sender_id": "user_mem001",
        "content": "@channel please re-open this",
        "type": "text",
        "parent_message_id": None,
        "is_edited": False,
        "is_deleted": False,
    }
    row.update(over)
    return row


def _queries(mock_pool) -> list[tuple[str, list]]:
    """Every statement either the pool or its connection was asked to run."""
    out = []
    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        for name in ("execute", "fetch", "fetchrow", "fetchval"):
            m = getattr(owner, name, None)
            for call in getattr(m, "call_args_list", []) or []:
                if call.args and isinstance(call.args[0], str):
                    out.append((" ".join(call.args[0].split()), list(call.args[1:])))
    return out


def _matching(mock_pool, *fragments) -> list[tuple[str, list]]:
    return [(s, a) for s, a in _queries(mock_pool)
            if all(f in s for f in fragments)]


def _body(fn) -> str:
    """Source with the docstring and the `#` comments removed.

    Both legitimately DISCUSS the thing being asserted against — the comment on
    `send_message` spends thirty lines explaining what an unvalidated
    `parent_message_id` used to allow, in the same words this file would search
    for — so a naive source search asserts against the prose that documents the
    fix. `test_prachar_audience` failed exactly that way on its first run.
    """
    src = inspect.getsource(fn)
    doc = inspect.getdoc(fn)
    if doc:
        for quote in ('"""', "'''"):
            start = src.find(quote)
            if start != -1:
                end = src.find(quote, start + 3)
                if end != -1:
                    src = src[:start] + src[end + 3:]
                    break
    return "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#")
    )


# ════════════════════════════════════════════════════════════════════════════
# 1 · An archived channel is closed to every write, not just send and pin
# ════════════════════════════════════════════════════════════════════════════

async def test_editing_a_message_in_an_archived_channel_is_refused(
    api_client, as_member, with_org_id, mock_pool, member_user, fan_out_calls
):
    """THIS IS THE ONE THAT PAGES A CLOSED ROOM.

    The attack is three steps and needs no privilege beyond the editor level
    every Sanvaad grant now carries: archive `#q1-audit`; PATCH your own old
    message in it to "@channel please re-open this"; every member of that
    channel gets a notification row and a push. The room the product told them
    nobody can post in has just interrupted all of them, and the message they are
    pointed at is one that has been sitting there for a year.

    The fan-out is what made it expensive, but the edit was wrong before the
    fan-out existed: it rewrites the visible text of an archived message. The
    banner says "History stays searchable" — searchable history that can be
    rewritten is not history.

    Three assertions, because any one alone is satisfiable by a broken handler:
    the refusal, the UPDATE that must not have run, and the fan-out that must not
    have been reached.
    """
    _wire(mock_pool, archived=True, sender_id=member_user["user_id"])

    r = await api_client.patch(
        f"/api/v1/messaging/messages/{MESSAGE_ID}",
        json={"content": "@channel please re-open this"},
    )

    assert r.status_code == 403, r.text
    assert ARCHIVED_SENTENCE in r.json()["detail"], (
        "the caller is refused without being told the channel is archived, so "
        "the refusal reads as a permissions bug"
    )
    assert not _matching(mock_pool, "UPDATE public.samvada_messages", "content=$1"), (
        "the stored text of an archived message was rewritten"
    )
    assert fan_out_calls == [], (
        "`@channel` fanned out from an archived channel — one PATCH, one "
        "notification row and one push per member of a room nobody can post in"
    )


async def test_deleting_a_message_in_an_archived_channel_is_refused(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """The judgement call, and it goes the other way from `remove_reaction`.

    This file already has a written rule that a taking-back is allowed where the
    matching addition is not — `remove_reaction` is not editor-gated while
    `add_reaction` is, and unpin is allowed on an archived channel while pin is
    not. The rule does not reach this far, because those take back a decoration
    and this takes back THE RECORD: `is_deleted = TRUE` removes the row from
    `list_messages`, from `get_thread`, from `list_pins` and from `search`, which
    is every way the product can show it.

    A room whose contents can still be emptied one message at a time is not
    archived. It is quieter.
    """
    _wire(mock_pool, archived=True, sender_id=member_user["user_id"])

    r = await api_client.delete(f"/api/v1/messaging/messages/{MESSAGE_ID}")

    assert r.status_code == 403, r.text
    assert ARCHIVED_SENTENCE in r.json()["detail"]
    assert not _matching(mock_pool, "is_deleted=TRUE"), (
        "a message was erased from an archived channel's history — from the log, "
        "the thread, the pins and the search index at once"
    )


async def test_reacting_to_a_message_in_an_archived_channel_is_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """A reaction is new content in a closed room, by a smaller name.

    It is the same act as a pin: something appears under a message in a channel
    the banner says is closed, and everybody still reading that history sees it
    appear. `pin_message` has refused it since the first round; this is the door
    beside it that was left open.
    """
    _wire(mock_pool, archived=True)

    r = await api_client.post(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions", params={"emoji": "👍"}
    )

    assert r.status_code == 403, r.text
    assert ARCHIVED_SENTENCE in r.json()["detail"]
    assert not _matching(mock_pool, "INSERT INTO public.samvada_message_reactions"), (
        "a reaction was written into an archived channel"
    )


async def test_the_archived_reaction_refusal_comes_after_the_org_scoped_404(
    api_client, as_member, with_org_id, mock_pool
):
    """`add_reaction` orders 404 → access → archived → editor, matching
    `pin_message`.

    The ordering is not cosmetic. A check that fires before the org filter lets
    `test_add_reaction_404_for_other_org_message` pass on a refusal that proves
    nothing about tenancy — the test would still be green with cross-org scoping
    deleted. So a message this org cannot see must still 404 even when the
    channel it names is archived.
    """
    _wire(mock_pool, archived=True)
    mock_pool.fetchrow = AsyncMock(return_value=None)

    r = await api_client.post(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions", params={"emoji": "👍"}
    )
    assert r.status_code == 404, r.text


async def test_sending_into_an_archived_channel_is_still_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """The door that was already shut. Kept because the fix moved the sentence
    out of this handler and into a module constant, and a refactor that loses a
    refusal while tidying it up is the commonest way a closed gate reopens."""
    _wire(mock_pool, archived=True)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "anybody still here?"},
    )
    assert r.status_code == 403, r.text
    assert ARCHIVED_SENTENCE in r.json()["detail"]


async def test_removing_your_own_reaction_is_still_allowed_when_archived(
    api_client, as_member, with_org_id, mock_pool
):
    """The deliberate asymmetry, pinned so it stays deliberate.

    This is now the only write into an archived room that goes through, and it is
    the same two reasons `unpin_message` already runs on. It removes NOTHING from
    the history — the message, its text, its author and its place are untouched;
    what goes is one row saying this caller once pressed an emoji. And the
    alternative is a trap: somebody who reacted the minute before an admin
    archived would be stuck with it under their name forever, with no door out.

    THIS TEST PASSES BOTH BEFORE AND AFTER THE FIX, and that is what it is for.
    It is the thing a later "tidy up: gate every write on archived" would break,
    and the failure message is where the reasoning is written down.
    """
    _wire(mock_pool, archived=True)

    r = await api_client.delete(
        f"/api/v1/messaging/messages/{MESSAGE_ID}/reactions/%F0%9F%91%8D"
    )
    assert r.status_code == 200, r.text
    assert _matching(mock_pool, "DELETE FROM public.samvada_message_reactions"), (
        "withdrawing a reaction on an archived channel is now refused, which "
        "traps anybody who reacted in the minute before an admin archived it"
    )


def test_every_write_handler_reaches_the_one_archived_refusal():
    """Five doors, one sentence, and the sentence is a constant.

    It was a literal in `send_message` and a second copy in `pin_message`. Five
    copies drift, and a banner that only some of the doors honour is worse than
    no banner at all, because the user has been TOLD the room is closed and has
    stopped watching it.

    Stated structurally as well as behaviourally: the behavioural tests above are
    all satisfied by a handler that has stopped working entirely, and this one
    fails the moment a sixth write path appears without the check.
    """
    import routers.messaging as messaging

    for name in ("edit_message", "delete_message", "add_reaction"):
        src = _body(getattr(messaging, name))
        assert "_assert_not_archived(" in src, (
            f"{name} no longer asks whether the channel is archived"
        )
    for name in ("send_message", "pin_message"):
        src = _body(getattr(messaging, name))
        assert "_ARCHIVED_REFUSAL" in src, (
            f"{name} no longer raises the shared refusal; it holds the channel "
            f"row already, so it tests the flag off that rather than calling the "
            f"helper — but it must still say the same sentence"
        )

    literal = messaging._ARCHIVED_REFUSAL
    assert ROUTER.read_text(encoding="utf-8").count(literal) == 1, (
        "the refusal sentence is written out more than once; the second copy is "
        "the one that will not be updated"
    )


def test_the_archive_helper_is_not_folded_into_the_access_check():
    """The archive's whole promise is that the history stays readable.

    `_assert_channel_access` answers *may you SEE this room* and has nine callers;
    `list_members`, `list_pins`, `get_thread` and the poll must all keep passing
    on an archived channel. Folding the archive test into it would close the
    reading doors along with the writing ones — which is the opposite of what
    archiving means — and would leave the next reader working out which of nine
    callers wanted which half.
    """
    import routers.messaging as messaging

    assert "is_archived" not in _body(messaging._assert_channel_access), (
        "the read-access helper now refuses archived channels, so an archived "
        "channel's history is unreadable and the banner promising otherwise is a "
        "lie"
    )
    for name in ("list_members", "list_pins", "get_thread"):
        assert "_assert_not_archived(" not in _body(getattr(messaging, name)), (
            f"{name} refuses an archived channel; archiving is supposed to close "
            f"the room to writes, not delete it"
        )


# ════════════════════════════════════════════════════════════════════════════
# 2 · `parent_message_id` must name a message in THIS channel
# ════════════════════════════════════════════════════════════════════════════

async def test_a_parent_in_another_channel_is_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """The field went off the wire and into the INSERT with nothing in between.

    The only thing behind it was the column's own foreign key, which points at
    `samvada_messages(id)` and carries no org and no channel — so ANY message id
    in the database was an accepted parent, and none of them needed guessing. An
    archived channel is readable by design, so `GET /channels/{archived}/messages`
    hands out its ids; posting into a live channel with one of those as the parent
    hung a reply off a message in a room whose own send path refuses everybody,
    and `get_thread` then served that reply's text to the archived channel's
    readers.

    The refusal is a 400 and not a 404: the caller supplied a bad field in a body
    the server accepted, and the resource in the path — the channel — is real.
    """
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "replying over here",
              "parent_message_id": OTHER_CHANNEL_MESSAGE_ID},
    )

    assert r.status_code == 400, r.text
    assert not _matching(mock_pool, "INSERT INTO public.samvada_messages"), (
        "the reply was written with a parent in another channel"
    )


async def test_a_parent_that_does_not_exist_at_all_is_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """The foreign key would have caught this one and answered 500.

    `ForeignKeyViolationError` out of the INSERT is a 500 for what is plainly a
    bad request, and it is the only member of this family the old code refused at
    all — by accident, and in the most expensive way available.
    """
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "hello?",
              "parent_message_id": "99999999-9999-9999-9999-999999999999"},
    )
    assert r.status_code == 400, r.text


async def test_a_malformed_parent_id_is_a_400_and_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    """`$6::uuid` fed a string that is not one raises `DataError` in asyncpg,
    which reaches the client as a 500 with a stack trace behind it. Every uuid
    this router takes from a body is caller-supplied."""
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "hello?", "parent_message_id": "not-a-uuid"},
    )
    assert r.status_code == 400, r.text


async def test_an_empty_string_parent_is_a_plain_message_not_an_error(
    api_client, as_member, with_org_id, mock_pool
):
    """`""` is what a form field that was never filled in sends.

    Bound to `$6::uuid` it was a `DataError` — a 500 on an ordinary message that
    happened to travel with an empty field. It has to read as "no parent", which
    is what the sender meant, and the INSERT must then carry NULL rather than the
    empty string.
    """
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "just a message", "parent_message_id": ""},
    )
    assert r.status_code == 201, r.text
    inserts = _matching(mock_pool, "INSERT INTO public.samvada_messages")
    assert inserts, "the message was not written"
    assert "" not in inserts[-1][1], (
        'the empty string reached the INSERT as a parent id rather than NULL'
    )


async def test_a_reply_to_a_reply_is_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """Slack has no nested threads and neither does this product.

    The client cannot produce one — `list_messages` returns only
    `parent_message_id IS NULL`, so a reply is never a row you can aim at, and
    `ThreadPanel` passes neither `onReply` nor `onOpenThread` to the replies it
    renders. So a nested reply is write-only data: `get_thread` returns the DIRECT
    children of the id it is given, and a grandchild has no view anywhere that
    could display it. Accepting one writes a row into the channel that nobody,
    including its author, will ever see again.
    """
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "and another thing",
              "parent_message_id": REPLY_MESSAGE_ID},
    )

    assert r.status_code == 400, r.text
    assert "nest" in r.json()["detail"].lower(), (
        "the caller is told the target is not a message in this channel, which "
        "is false and unactionable — it is a real message and the problem is "
        "that it is already a reply"
    )
    assert not _matching(mock_pool, "INSERT INTO public.samvada_messages")


async def test_a_valid_parent_in_this_channel_still_posts(
    api_client, as_member, with_org_id, mock_pool
):
    """The gate has to let the feature through. A validation that refuses
    everything passes every test above and ships a broken thread panel."""
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "on it", "parent_message_id": MESSAGE_ID},
    )
    assert r.status_code == 201, r.text
    inserts = _matching(mock_pool, "INSERT INTO public.samvada_messages")
    assert inserts and MESSAGE_ID in inserts[-1][1], (
        "the reply was written without its parent"
    )


def test_the_parent_probe_binds_the_channel_and_the_org_and_not_only_the_id():
    """Stated structurally, because the behavioural tests cannot see the
    difference between a probe that filters on three columns and a fake that
    happens to answer as though it did.

    All three predicates carry weight and they fail differently: without
    `channel_id` a reply lands under a message in another room; without `org_id`
    it lands under another tenant's; without `is_deleted` it hangs off a message
    that no view in the product will ever render again.
    """
    from routers.messaging import send_message

    src = " ".join(_body(send_message).split())
    probe = re.search(
        r"SELECT parent_message_id FROM public\.samvada_messages\s+WHERE (.+?)\"\"\"",
        src,
    )
    assert probe, "send_message no longer probes the parent before the INSERT"
    where = probe.group(1)
    for predicate in ("id=$1::uuid", "channel_id=$2::uuid", "org_id=$3::uuid",
                      "is_deleted = FALSE"):
        assert predicate in where, (
            f"the parent probe does not filter on {predicate}:\n{where}"
        )


# ════════════════════════════════════════════════════════════════════════════
# 3 · … and in THIS org. The cross-tenant write.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_parent_belonging_to_another_org_is_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """THE MOST SERIOUS THING IN THIS FEATURE.

    An ordinary editor, with no privilege of any kind, posts a message in their
    own channel whose `parent_message_id` points into another tenant's data. The
    row is written into this org's channel, so no read filter anywhere refuses
    it, and before section 4 landed `get_thread` on the foreign parent served it
    back out to THAT tenant's members — a message this org's user composed,
    rendered underneath a message they cannot see, in a channel they are not in.

    Every other org-scoping hole in this router has been a read. This one writes.
    """
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "quietly landing in your thread",
              "parent_message_id": FOREIGN_ORG_MESSAGE_ID},
    )

    assert r.status_code == 400, r.text
    assert not _matching(mock_pool, "INSERT INTO public.samvada_messages"), (
        "a message was written whose parent belongs to another tenant"
    )
    assert not any(
        FOREIGN_ORG_MESSAGE_ID in args
        for sql, args in _queries(mock_pool)
        if sql.startswith(("INSERT", "UPDATE"))
    ), "another tenant's message id was bound to a write"


async def test_the_foreign_parent_and_the_local_stranger_are_told_the_same_thing(
    api_client, as_member, with_org_id, mock_pool
):
    """One sentence for "not in this channel" and "not in this org".

    Two different refusals would turn the 400 into a cross-tenant oracle: an id
    that answers "wrong channel" is an id that EXISTS somewhere in this database,
    and an id that answers "wrong org" says whose. The caller has no legitimate
    use for the difference — from where they stand both mean the same thing, and
    the message says the true and useful half of it.
    """
    _wire(mock_pool)

    async def _post(parent):
        return await api_client.post(
            f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
            json={"content": "x", "parent_message_id": parent},
        )

    foreign = await _post(FOREIGN_ORG_MESSAGE_ID)
    elsewhere = await _post(OTHER_CHANNEL_MESSAGE_ID)
    nonexistent = await _post("99999999-9999-9999-9999-999999999999")

    refusals = (foreign, elsewhere, nonexistent)
    # Asserted before the bodies are read, or a handler that accepts all three
    # dies here on a missing `detail` key instead of saying what it did.
    assert [r.status_code for r in refusals] == [400, 400, 400], (
        f"not every bad parent was refused: {[r.status_code for r in refusals]}"
    )
    details = {r.json()["detail"] for r in refusals}
    assert len(details) == 1, (
        f"the refusals differ by which id was passed, which tells the caller "
        f"where a message id they hold actually lives: {sorted(details)}"
    )


async def test_a_failed_parent_check_does_not_leave_a_membership_row_behind(
    api_client, as_member, with_org_id, mock_pool
):
    """THE POSITION OF THE CHECK IS PART OF THE FIX.

    `send_message` auto-joins a caller who posts into a public channel they are
    not in. Validating the parent AFTER that join writes a membership row on a
    request that then 400s — the caller is now in a channel they never
    successfully posted to, counted in its `member_count`, and a recipient of its
    `@channel`, which has a fifteen-member ceiling that this row can be the
    sixteenth of.
    """
    _wire(mock_pool, membership=False, channel_type="public")

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "x", "parent_message_id": FOREIGN_ORG_MESSAGE_ID},
    )

    assert r.status_code == 400, r.text
    assert not _matching(mock_pool, "INSERT INTO public.samvada_channel_members"), (
        "a failed send joined the caller to the channel anyway"
    )


async def test_the_parent_check_does_not_run_before_the_membership_refusal(
    api_client, as_member, with_org_id, mock_pool
):
    """The other half of the ordering, and it is a leak rather than a stray row.

    Validating the parent BEFORE the membership check turns the 403 into a
    membership oracle: somebody outside a private channel could tell a REAL
    message id of that channel from a made-up one by which refusal came back — a
    400 means the id exists in a room they cannot see, a 403 means it does not.
    That is the same leak `list_members` was fixed for, arriving through the
    reply field.

    THIS TEST PASSES BOTH BEFORE AND AFTER THE FIX. Before, because no check
    existed to be mis-ordered; after, because it is ordered correctly. It exists
    for the third state — the one where somebody moves the block up to "fail
    fast".
    """
    _wire(mock_pool, membership=False, channel_type="private")

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "x", "parent_message_id": MESSAGE_ID},
    )
    assert r.status_code == 403, r.text
    assert not _matching(mock_pool, "SELECT parent_message_id"), (
        "the parent was probed before the caller was refused membership, so the "
        "refusal now distinguishes a real message id of a private channel from "
        "an invented one"
    )


# ════════════════════════════════════════════════════════════════════════════
# 4 · The read side: a stale or foreign parent id cannot surface replies
# ════════════════════════════════════════════════════════════════════════════
#
# A write gate alone leaves every row already in the table, and nobody can say
# how many of those there are — the write path was open for the life of the
# feature and no query was ever run against production to count them. Both ends
# ship, or the fix is half a fix.

async def test_get_thread_scopes_the_replies_to_the_parents_own_org_and_channel(
    api_client, as_member, with_org_id, mock_pool
):
    """`_assert_channel_access` authorises ONE channel. This query selected every
    row in the database pointing at the parent id.

    So a reply written from somewhere else — another channel, another tenant — by
    anybody who held the id was served here as though it belonged, to whoever
    could see the parent. The access check above it is what makes this look safe:
    it is a real check, it passes, and then the query it guards reads rows it
    never authorised.
    """
    _wire(mock_pool)

    r = await api_client.get(f"/api/v1/messaging/messages/{MESSAGE_ID}/thread")
    assert r.status_code == 200, r.text

    replies = _matching(mock_pool, "m.parent_message_id = $1::uuid",
                        "public.samvada_messages m")
    assert replies, "the thread query is gone"
    sql, args = replies[-1]
    assert "m.org_id = $2::uuid" in sql and "m.channel_id = $3::uuid" in sql, (
        f"the thread is fetched by parent id alone, so a reply written from any "
        f"other channel or any other tenant is served under this message:\n{sql}"
    )
    assert args[1] == TEST_ORG_ID and args[2] == CHANNEL_ID, (
        f"the scoping predicates are bound to the wrong values: {args}"
    )


async def test_the_thread_count_subselects_are_scoped_the_same_way(
    api_client, as_member, with_org_id, mock_pool
):
    """The badge is what made the leak discoverable, and clickable.

    `thread_count` counted every row in the database pointing at a message, so a
    foreign reply showed up as "1 reply" under a message in a room its author
    could not post in — and `last_reply_at` timestamped it, which is what pushed
    the channel up the rail. The user clicks the badge, `get_thread` serves the
    text. Both sub-selects, not one: a count without a timestamp still renders
    the link.
    """
    _wire(mock_pool)

    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/messages")
    assert r.status_code == 200, r.text

    log = _matching(mock_pool, "FROM public.samvada_messages m", "thread_count")
    assert log, "the message log query is gone"
    sql = log[-1][0]

    subs = re.findall(
        r"FROM public\.samvada_messages (\w+) WHERE (.+?)\) AS (thread_count|last_reply_at)",
        sql,
    )
    assert len(subs) == 2, (
        f"expected a thread_count and a last_reply_at sub-select, found "
        f"{[s[2] for s in subs]}"
    )
    for alias, predicate, label in subs:
        for needed in (f"{alias}.channel_id = m.channel_id",
                       f"{alias}.org_id = m.org_id"):
            assert needed in predicate, (
                f"{label} counts rows without {needed}, so a reply written from "
                f"another channel or another tenant renders as a reply here:\n"
                f"{predicate}"
            )


async def test_the_message_log_still_hides_replies_from_the_channel_body(
    api_client, as_member, with_org_id, mock_pool
):
    """The reason a nested reply is unreachable, and therefore the reason the
    write gate in section 2 is allowed to be a write gate only.

    `list_messages` returns `parent_message_id IS NULL` and nothing else, so a
    reply is never a row the client can aim `onReply` at. If this predicate ever
    goes, every reply becomes a legal reply target, the nested-reply refusal
    starts firing on ordinary user actions, and rows written before that refusal
    existed become visible in a way nobody designed.
    """
    _wire(mock_pool)

    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/messages")
    assert r.status_code == 200, r.text

    log = _matching(mock_pool, "FROM public.samvada_messages m", "thread_count")
    assert "m.parent_message_id IS NULL" in log[-1][0], (
        "the channel log now returns replies as top-level messages"
    )


# ════════════════════════════════════════════════════════════════════════════
# 5 · Muting a channel you never joined does not invent an unread badge
# ════════════════════════════════════════════════════════════════════════════

async def test_muting_a_channel_you_never_joined_stamps_the_read_position(
    api_client, as_member, with_org_id, mock_pool
):
    """PRESSING MUTE LIT A FOUR-FIGURE BADGE ON THE CHANNEL IT SILENCED.

    `muted` is a column on `samvada_channel_members` and there is nowhere else in
    this schema for a per-channel preference to live, so a mute by a non-member
    has to write a membership row. What it must not do is write one that lies
    about the caller's history — and it did: `last_read_at` came out NULL.

    Every unread count in this module reads
    `COALESCE(cm_me.last_read_at, '-infinity')` behind a
    `CASE WHEN cm_me.user_id IS NULL THEN 0`. The NULL-USER CHECK WAS THE ONLY
    THING HOLDING THE COUNT AT ZERO for a channel nobody had joined — the exact
    bug `list_channels` documents fixing — and this INSERT walked the caller
    straight past it into the ELSE branch, where a NULL `last_read_at` floors the
    comparison at 1970 and counts the entire history of a five-year-old
    `#general`.

    `now()` is the honest value, not epoch and not NULL: the caller is looking at
    the rail this second, and "everything before now is read" is the true
    statement about somebody who has never opened the channel.
    """
    _wire(mock_pool, exec_status="UPDATE 0")

    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 200, r.text

    inserts = _matching(mock_pool, "INSERT INTO public.samvada_channel_members")
    assert inserts, "no membership row was written, so the mute was not recorded"
    sql, args = inserts[-1]
    assert "last_read_at" in sql, (
        "the row is written without a read position, so every message ever "
        "posted in the channel counts as unread on the channel the user has just "
        "asked to be quiet"
    )
    assert "now()" in sql and None not in args, (
        f"last_read_at is bound rather than stamped by the database, and the "
        f"value is NULL: {sql}"
    )


async def test_unmuting_a_channel_you_never_joined_writes_nothing_at_all(
    api_client, as_member, with_org_id, mock_pool
):
    """The absence of a row already IS "not muted".

    `muted` is read as `COALESCE(cm_me.muted, FALSE)` everywhere in this module,
    so an unmute with no row to update has nothing to record. The old code wrote
    one anyway: it stored a default nobody asked for and joined somebody to a
    channel in exchange for it — visible in `GET /members`, counted in
    `member_count`, resolved by `@channel`, and counting against the fifteen-head
    ceiling that takes broadcast away from every non-admin when it is crossed.

    A user who muted and then unmuted is left in the channel by the pair.
    """
    _wire(mock_pool, exec_status="UPDATE 0")

    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": False}
    )

    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "muted": False}
    assert not _matching(mock_pool, "INSERT INTO public.samvada_channel_members"), (
        "unmuting a channel the caller was never in joined them to it"
    )


async def test_a_real_members_read_position_survives_a_mute(
    api_client, as_member, with_org_id, mock_pool
):
    """The race the `ON CONFLICT` clause has to lose gracefully.

    Two mute calls arriving together, or a mute racing the member's own join:
    the second one finds a row and must touch `muted` and nothing else. Updating
    `last_read_at` there would mark a real member's channel fully read because
    they pressed mute — the same false statement as the bug above, in the
    opposite direction and about somebody who does have history to lose.
    """
    _wire(mock_pool, exec_status="UPDATE 1")

    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 200, r.text
    assert not _matching(mock_pool, "INSERT INTO public.samvada_channel_members"), (
        "an existing member's row was re-inserted rather than updated"
    )

    updates = _matching(mock_pool, "UPDATE public.samvada_channel_members", "muted")
    assert updates and "last_read_at" not in updates[-1][0], (
        "muting moved an existing member's read position, silently marking the "
        "channel read"
    )


def test_the_conflict_clause_updates_only_the_muted_column():
    """The same rule, stated where the race actually lives.

    The behavioural test above cannot reach this branch — it only fires when two
    calls collide inside the database — so the clause is read directly. A
    `DO UPDATE SET muted = …, last_read_at = now()` would look tidier and would
    reset the read position of whoever lost the race.
    """
    from routers.messaging import set_channel_mute

    src = " ".join(_body(set_channel_mute).split())
    conflict = re.search(r"ON CONFLICT \([^)]*\) DO UPDATE SET (.+?)\"\"\"", src)
    assert conflict, "the mute insert no longer handles the conflict"
    assigned = {a.split("=")[0].strip() for a in conflict.group(1).split(",")}
    assert assigned == {"muted"}, (
        f"the conflict clause also writes {sorted(assigned - {'muted'})}; a "
        f"racing mute must not touch a real member's read position"
    )


def test_the_unread_count_is_held_at_zero_only_by_the_missing_membership_row():
    """Why the two tests above are about a badge at all.

    This is the mechanism, read off the query rather than described: the count is
    zero for a channel you have not joined SOLELY because `cm_me.user_id` is
    NULL, and the moment any row exists the comparison falls through to
    `COALESCE(last_read_at, '-infinity')`, which is 1970 and therefore the whole
    history. Nothing about `set_channel_mute` says that; it is two hundred lines
    away in `list_channels`, which is exactly why the mute wrote the row it wrote.

    THIS TEST PASSES BOTH BEFORE AND AFTER THE FIX. It pins the assumption the
    fix depends on: if this query ever learns to floor a NULL `last_read_at` at
    the join date instead, the mute INSERT stops needing to stamp anything and
    somebody should be told so rather than discovering it.
    """
    from routers.messaging import list_channels

    src = " ".join(_body(list_channels).split())
    assert "CASE WHEN cm_me.user_id IS NULL THEN 0" in src, (
        "the unread count no longer zeroes for an unjoined channel"
    )
    assert "COALESCE(cm_me.last_read_at, '-infinity'::timestamptz)" in src, (
        "the unread floor for a member with no read position has changed; the "
        "mute INSERT stamps last_read_at specifically to stay off this branch"
    )


# ════════════════════════════════════════════════════════════════════════════
# 6 · The names. In the style of tests/test_prachar_audience.py.
# ════════════════════════════════════════════════════════════════════════════
#
# Everything above runs against a mocked pool, and a mocked cursor resolves any
# name you give it: `graha_contacts.type`, `vikray_targets.salesperson_id`,
# `bank_statement_lines.batch_id` and the pahchan `$2::date` were all green in
# this suite and all 500'd against the real database.
#
# This section carries one check the others cannot: EVERY COLUMN THESE GATES NAME
# MUST ALREADY EXIST IN 058. Migration 093 is applied by hand and is not applied
# yet; a gate that names `pinned_at` or `search_tsv` would raise
# UndefinedColumnError for the whole length of the deploy window — which on the
# archived paths means a 500 instead of a 403, and on the parent probe means the
# send path fails outright. The gates have to hold before the migration and
# after it, and 058 versus 093 is how that is asserted rather than assumed.

#: Names that read like columns but are not. `type` is the column on
#: `samvada_channels`; `kind` and `is_archived` on a MESSAGE are the two most
#: plausible ways to get this feature's flags wrong.
SQL_KEYWORDS = {
    "and", "or", "not", "null", "true", "false", "is", "in", "select", "from",
    "where", "as", "on", "by", "order", "limit", "case", "when", "then", "else",
    "end", "coalesce", "count", "max", "now", "asc", "desc", "insert", "into",
    "values", "update", "set", "delete", "conflict", "do", "nothing", "join",
    "left", "returning", "distinct", "exists", "interval",
}


def _columns_058() -> dict[str, set[str]]:
    """Every column 058 creates, per table, parsed from the migration.

    Parsed rather than transcribed. A hand-copied list is a second source of
    truth that goes stale silently, and the failure it produces — a name that is
    in the list and not in the database — is the exact class this section exists
    to catch.
    """
    sql = MIGRATION_058.read_text(encoding="utf-8")
    out: dict[str, set[str]] = {}
    for m in re.finditer(
        r"CREATE TABLE IF NOT EXISTS staging\.(\w+)\s*\((.*?)\n\);", sql, re.S
    ):
        table, body = m.group(1), m.group(2)
        cols = set()
        for line in body.splitlines():
            line = line.strip()
            word = re.match(r"([a-z_]+)\s", line)
            if not word:
                continue
            name = word.group(1)
            if name.upper() in ("UNIQUE", "PRIMARY", "CHECK", "FOREIGN",
                                "CONSTRAINT"):
                continue
            cols.add(name)
        out[table] = cols
    return out


def _columns_added_by_093() -> set[str]:
    return set(re.findall(
        r"ADD COLUMN IF NOT EXISTS (\w+)",
        MIGRATION_093.read_text(encoding="utf-8"),
    ))


def _sql_of(fn) -> str:
    """The handler's source with its double quotes dropped and its whitespace
    collapsed — i.e. the SQL the database actually receives.

    SQL in this codebase is built from ADJACENT STRING LITERALS, so
    `_assert_not_archived`'s query reads
    `"SELECT is_archived FROM staging.samvada_channels " "WHERE id=$1::uuid …"`
    in the source and a regex expecting `WHERE` to follow the table name never
    matches across the gap. `test_prachar_audience` records the same trap; this
    is the same fix. Single quotes survive on purpose — `'-infinity'` is part of
    the statement, not part of the Python.
    """
    return re.sub(r"\s+", " ", _body(fn).replace('"', " "))


def _names_in(sql: str) -> set[str]:
    """Every bare identifier compared, selected or assigned in a fragment.

    Deliberately loose — it over-collects, and the assertion is against a known
    column set, so an alias or a keyword that slips through is filtered by
    `SQL_KEYWORDS` rather than by a cleverer regex nobody will maintain.
    """
    stripped = re.sub(r"\$\d+(::\w+)?", " ", sql)
    stripped = re.sub(r"\b\w+\.", "", stripped)          # alias prefixes
    words = set(re.findall(r"\b[a-z_]{3,}\b", stripped))
    return {w for w in words if w not in SQL_KEYWORDS}


def test_every_column_the_archive_gate_names_exists_in_058():
    """`_assert_not_archived` is the one new query on three write paths.

    If `is_archived` were misspelt, an UndefinedColumnError would replace the 403
    on edit, delete and reaction — which is a 500 for every one of those requests,
    not just the archived ones, because the query runs before the flag is read.
    """
    from routers.messaging import _assert_not_archived

    cols = _columns_058()
    src = _sql_of(_assert_not_archived)
    # This scans the ROUTER SOURCE, not the migration file, so it follows the
    # runtime to `public.`. `cols` still comes from 058, which is a historical
    # record and still spells its DDL `staging.` — the table NAME is what the
    # two sides share.
    m = re.search(r"SELECT (\w+) FROM public\.(\w+) WHERE (.+?),", src)
    assert m, f"the archive gate no longer reads the channel:\n{src}"
    column, table, where = m.groups()

    assert table in cols, f"the archive gate reads public.{table}, which 058 " \
                          f"does not create"
    assert column in cols[table], (
        f"the archive gate selects {table}.{column}, which does not exist — "
        f"every edit, delete and reaction 500s instead of being refused"
    )
    unknown = _names_in(where) - cols[table]
    assert not unknown, f"the archive gate filters on {sorted(unknown)}"


def test_every_column_the_parent_probe_names_exists_in_058():
    """The probe runs on every reply, before the INSERT. A wrong name here is not
    "threads are broken", it is "replying is a 500"."""
    from routers.messaging import send_message

    cols = _columns_058()["samvada_messages"]
    src = " ".join(_body(send_message).split())
    probe = re.search(
        r"SELECT (parent_message_id) FROM public\.samvada_messages\s+WHERE (.+?)\"\"\"",
        src,
    )
    assert probe, "send_message no longer probes the parent"
    assert probe.group(1) in cols
    unknown = _names_in(probe.group(2)) - cols
    assert not unknown, (
        f"the parent probe filters on {sorted(unknown)}, which samvada_messages "
        f"does not have"
    )


def test_every_column_the_thread_scoping_names_exists_in_058():
    """Both read ends at once — `get_thread`'s WHERE and the two sub-selects in
    `list_messages`. These run on the two most-hit read paths in the module, so a
    wrong name is a channel that will not open."""
    import routers.messaging as messaging

    cols = _columns_058()["samvada_messages"]

    thread = " ".join(_body(messaging.get_thread).split())
    where = re.search(r"WHERE (m\.parent_message_id.+?)ORDER BY", thread)
    assert where, "the thread query lost its WHERE clause"
    unknown = _names_in(where.group(1)) - cols
    assert not unknown, f"get_thread filters on {sorted(unknown)}"

    log = " ".join(_body(messaging.list_messages).split())
    for alias, predicate, _label in re.findall(
        r"FROM public\.samvada_messages (\w+) WHERE (.+?)\) AS (thread_count|last_reply_at)",
        log,
    ):
        unknown = _names_in(predicate) - cols
        assert not unknown, (
            f"the {alias} sub-select names {sorted(unknown)}, which "
            f"samvada_messages does not have"
        )


def test_every_column_the_mute_insert_names_exists_in_058():
    """The INSERT gained `last_read_at`. It is a column 058 created and not one
    093 adds — worth asserting rather than assuming, because the whole fix is a
    column being written that was not written before."""
    from routers.messaging import set_channel_mute

    cols = _columns_058()["samvada_channel_members"]
    src = " ".join(_body(set_channel_mute).split())
    m = re.search(
        r"INSERT INTO public\.samvada_channel_members \(([^)]*)\)", src
    )
    assert m, "the mute no longer writes a membership row"
    named = {c.strip() for c in m.group(1).split(",") if c.strip()}
    unknown = named - cols
    assert not unknown, (
        f"the mute insert names {sorted(unknown)}, which "
        f"samvada_channel_members does not have"
    )
    assert "last_read_at" in named, (
        "the read position is not written, so the mute lights the badge it was "
        "pressed to silence"
    )


def test_no_gate_depends_on_a_column_093_introduces():
    """093 IS NOT APPLIED, AND IT IS APPLIED BY HAND.

    There is one `staging` schema and production writes to it, so applying 093 is
    a production change and the window between this code deploying and that
    happening is real — minutes, or days. A gate that names `pinned_at`,
    `pinned_by` or `search_tsv` is not a gate during that window: it is an
    UndefinedColumnError, which on the archived paths turns a 403 into a 500 and
    on the parent probe turns every reply into one.

    Every column these five fixes name came from 058. This is the assertion that
    keeps it that way.
    """
    import routers.messaging as messaging

    new_in_093 = _columns_added_by_093()
    assert new_in_093, "093 no longer adds any column; this test is asserting nothing"

    for fn in (messaging._assert_not_archived, messaging.set_channel_mute,
               messaging.get_thread):
        src = _body(fn)
        for column in new_in_093:
            assert not re.search(rf"\b{column}\b", src), (
                f"{fn.__name__} names {column}, which only exists after 093 is "
                f"applied by hand — until then this gate raises instead of "
                f"refusing"
            )

    # `send_message` and `list_messages` are checked on their gate fragments
    # rather than whole: both legitimately touch 093 columns elsewhere, behind
    # `_parity_ready`.
    probe = re.search(
        r"SELECT parent_message_id FROM public\.samvada_messages\s+WHERE (.+?)\"\"\"",
        " ".join(_body(messaging.send_message).split()),
    )
    assert probe
    for column in new_in_093:
        assert column not in probe.group(1), (
            f"the parent probe names {column}, which does not exist until 093 is "
            f"applied — so every reply 500s for the length of the deploy window"
        )


def test_the_two_tables_these_gates_read_are_created_by_058_not_093():
    """The relation half of the same question. `samvada_mentions`,
    `samvada_typing` and `samvada_presence` are 093's; none of these gates may
    touch them, or the gate is only closed on a database that has been
    migrated."""
    import routers.messaging as messaging

    from_093 = set(re.findall(
        r"CREATE TABLE IF NOT EXISTS staging\.(\w+)",
        MIGRATION_093.read_text(encoding="utf-8"),
    ))
    assert from_093, "093 creates no tables; this test is asserting nothing"

    for fn in (messaging._assert_not_archived, messaging.set_channel_mute,
               messaging.get_thread):
        src = _body(fn)
        for table in from_093:
            assert f"public.{table}" not in src, (
                f"{fn.__name__} reads public.{table}, which 093 creates — the "
                f"gate is open until somebody runs the migration by hand"
            )
