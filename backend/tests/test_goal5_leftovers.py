"""The eight leftovers, each one verified by a review before it was written.

Every defect below was found by reading, and every one of them was invisible to
a green suite — which is the only reason this file exists as a file rather than
as six lines added to six others. The suite could not see them because each is a
question about the SECOND thing a handler does: not "does it answer 200" but
"what row is left behind afterwards", "what does it answer when the caller
mistypes", "does the number it recorded match the number it charged".

WHAT IS PINNED HERE, and the shape of the claim in each case:

1. A MALFORMED UUID IN A PATH IS NOT A 500. Parametrised over EVERY affected
   endpoint rather than a sample, because the defect was a per-handler omission
   and a sample proves only that somebody remembered the handlers in the sample.
   Sixteen routes: the twelve that predate the parity work and had the hole, and
   the four path-taking ones that already validated — held together in one list
   so the rule stays ONE rule. `_valid_uuid`'s docstring says "if this rule is
   ever changed, change all seventeen"; this is the test that makes that
   sentence enforceable rather than aspirational.

   THE CODE IS 404, NOT 400, and that is the shipped contract rather than a
   preference: `test_samvaad_search_and_pins.py`, `test_samvaad_directory.py`
   and `test_samvaad_gates.py` already pin the module's rule that a PATH segment
   answers 404 ("nothing of that name") and a BODY field answers 400 ("something
   wrong with your request"). Section 1 asserts both halves together — the paths
   AND `send_message`'s `parent_message_id` — because the value of the rule is
   that the two codes mean different things, and a test of one half cannot see
   the two drifting into each other.

2. THE `before=` CURSOR IS SCOPED TO THE CHANNEL. Unscoped, it resolved against
   every message row in the database: a FOREIGN-ORG id resolved to a real
   `created_at` and returned an ordinary page, a fabricated id resolved to NULL
   and returned nothing. The rows were never the leak — they were always the
   caller's own. The ANSWER was: it told the holder of an id whether that id
   named a real message anywhere in the product.

3. UNMUTING DOES NOT LEAVE YOU A MEMBER. Muting a public channel you never
   joined must write a membership row — there is nowhere else for the preference
   to live — and unmuting must take it away again. Flipping `muted` back to
   false and leaving the row was a one-way door: `member_count`, the member
   list, `@channel`'s fan-out and, because `cm_me.user_id IS NOT NULL` then
   holds, unread badges for a room never opened. One press of mute and one press
   of unmute — a pair whose whole meaning is "never mind" — joined you for good.

4. WHAT AN ARCHIVED CHANNEL REFUSES, AND WHAT IT DELIBERATELY DOES NOT. Five
   refusals and three permissions, asserted as one table. The permissions are
   the half worth testing: `update_channel` MUST stay open because it is the
   only unarchive path, and a "tightening" that closed it would make archiving
   irreversible — a change that looks like a security fix, passes review, and
   turns an archive into a deletion with the history left visible.

5. THE INVOICE BOOKS WHAT IT CHARGED. `line_items` and `line_ids` arrive as two
   unjoined lists of different lengths, so the id has to travel WITH the amount.
   The qty case is the one that matters: a loaded line billed ×2 disagrees with
   its join row without anybody typing a rupee figure at all.

6. MIGRATION 097 NAMES A COLUMN THAT DOES NOT ALREADY EXIST, AND IT IS TEXT. A
   user id in this product is `user_549c9cac35aa`. This repo has paid for
   forgetting that twice (030, 092), and 097's own header says so at length —
   which is worth exactly nothing if nobody checks the SQL under the prose.

STYLE. The pool is a mock, so — as `routers/messaging.py:30-41` warns — a mocked
cursor resolves any name you give it and NOTHING here proves a statement runs.
What these tests prove is which statements were BUILT and what was passed to
them, which is the half a mock can answer and the half that regressed. Section 6
reads the SQL text for the same reason `tests/test_prachar_audience.py` does.
"""
import pathlib
import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from conftest import TEST_ORG_ID

BACKEND = pathlib.Path(__file__).resolve().parents[1]
API = "/api/v1/messaging"

CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
MESSAGE_ID = "11111111-2222-3333-4444-555555555555"
ME = "user_mem001"                      # conftest's `member_user`
SOMEBODY_ELSE = "user_mem002"


# ════════════════════════════════════════════════════════════════════════════
# Harness
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Reach and the write-verb gate belong to `test_module_write_level.py`.

    Leaving them on would make every non-2xx below ambiguous between "the rule
    under test refused" and "this test user has no Sanvaad grant" — and half
    this file is about WHICH refusal a caller gets.
    """
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches at MODULE scope, so the cache is test state.

    Pinned TRUE — nothing here is about the window between a deploy and a
    hand-applied migration — and cleared afterwards so a deliberately expired
    deadline cannot leak into a later file in the same process, where the
    failure would land nowhere near its cause.
    """
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


def _sql(mock_pool):
    """Every statement the handler built, IN THE ORDER IT BUILT THEM.

    Order is not a luxury here. Section 3 has to say "and then it stopped" — an
    unmute that deletes the row and goes on to UPDATE it is a different handler
    from one that deletes and returns, and the pair of statements is identical
    either way. Reading `call_args_list` per method could only ever produce all
    the fetchrows followed by all the executes, which cannot express that.

    Watches the pool AND the connection, because `mark_read` runs inside
    `pool.acquire()` and everything else does not; a recorder watching one of
    them would report "no SQL" for a handler that had just written two
    statements.
    """
    return list(getattr(mock_pool, "_statements", []))


def _wire(mock_pool, *, channel=None, membership=None, message=None,
          level="admin", execute=None, same_org=True):
    """A pool that answers by SQL SHAPE, not by call order.

    `test_messaging_security.py` orders its side effects to match each handler's
    exact query sequence, and the spec for that work records the cost: adding one
    query to `send_message` broke every one of those tests at once. Nothing here
    depends on order, so a handler that grows a lookup stays green and these
    tests fail only when the BEHAVIOUR changes — which is the whole claim the
    file makes.
    """
    chan = {"type": "public", "is_archived": False} if channel is None else channel
    msg = message if message is not None else {
        "channel_id": CHANNEL_ID, "sender_id": ME, "pinned_at": None,
        "is_archived": chan.get("is_archived", False),
    }

    log: list[str] = []
    mock_pool._statements = log

    async def _fetchval(sql, *a):
        s = " ".join(str(sql).split())
        log.append(s)
        # `held_level`'s ladder, in the order it asks: platform role, org role,
        # then the module grant.
        if "org_id IS NULL" in s:
            return None
        if "role_code IN ('org_owner','org_admin')" in s:
            return None
        if "org_member_modules" in s:
            return level
        # `_assert_same_org` — the user being added belongs to this org.
        if "staging.user_roles" in s:
            return 1 if same_org else None
        # `_assert_not_archived` reads the boolean on its own.
        if "SELECT is_archived" in s:
            return chan.get("is_archived", False)
        return 0

    async def _fetchrow(sql, *a):
        s = " ".join(str(sql).split())
        log.append(s)
        # Messages before channels: `send_message`'s INSERT and `edit_message`'s
        # UPDATE both end in `RETURNING *` and both name a channel id, so a
        # looser match would hand them the channel row.
        if "staging.samvada_messages" in s:
            return msg
        if "staging.samvada_channels" in s:
            return chan
        if "staging.samvada_channel_members" in s:
            return membership
        return None

    async def _execute(sql, *a):
        s = " ".join(str(sql).split())
        log.append(s)
        if execute:
            for needle, tag in execute.items():
                if needle in s:
                    return tag
        return "UPDATE 1"

    async def _fetch(sql, *a):
        log.append(" ".join(str(sql).split()))
        return []

    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        owner.fetchval = AsyncMock(side_effect=_fetchval)
        owner.fetchrow = AsyncMock(side_effect=_fetchrow)
        owner.fetch = AsyncMock(side_effect=_fetch)
        owner.execute = AsyncMock(side_effect=_execute)
    return mock_pool


# ════════════════════════════════════════════════════════════════════════════
# 1 · A MALFORMED UUID IN A PATH IS NOT A 500
#
# `$1::uuid` on a string that is not one raises asyncpg's `DataError`, which
# FastAPI renders as a 500. A 500 is what the client shows as "something went
# wrong on our side" for a request the CALLER malformed — and it is noise in
# the error budget that hides the 500s that do matter.
#
# EVERY affected endpoint, not a sample. The defect was twelve independent
# omissions; a sample would only prove that somebody remembered the sample.
# ════════════════════════════════════════════════════════════════════════════

BAD = "not-a-uuid"

# (id, method, path, query, json). The body on each entry is the MINIMUM valid
# one: FastAPI validates the body before the handler runs, so an invalid body
# would answer 422 and the guard under test would never be reached — a test
# that passes for the wrong reason and goes on passing after the guard is
# deleted.
MALFORMED_PATH_ROUTES = [
    # ── The twelve that had the hole ────────────────────────────────────────
    ("list_messages",    "GET",    f"{API}/channels/{BAD}/messages",        None, None),
    ("send_message",     "POST",   f"{API}/channels/{BAD}/messages",        None, {"content": "hello"}),
    ("mark_read",        "POST",   f"{API}/channels/{BAD}/read",            None, None),
    ("list_members",     "GET",    f"{API}/channels/{BAD}/members",         None, None),
    ("add_member",       "POST",   f"{API}/channels/{BAD}/members",         {"user_id": SOMEBODY_ELSE}, None),
    ("remove_member",    "DELETE", f"{API}/channels/{BAD}/members/{SOMEBODY_ELSE}", None, None),
    ("update_channel",   "PATCH",  f"{API}/channels/{BAD}",                 None, {"name": "renamed"}),
    ("edit_message",     "PATCH",  f"{API}/messages/{BAD}",                 None, {"content": "edited"}),
    ("delete_message",   "DELETE", f"{API}/messages/{BAD}",                 None, None),
    ("get_thread",       "GET",    f"{API}/messages/{BAD}/thread",          None, None),
    ("add_reaction",     "POST",   f"{API}/messages/{BAD}/reactions",       {"emoji": "\U0001F44D"}, None),
    ("remove_reaction",  "DELETE", f"{API}/messages/{BAD}/reactions/%F0%9F%91%8D", None, None),
    # ── The four path-taking ones that already validated ────────────────────
    # Held in the SAME list rather than left to the files that introduced them,
    # because the property is "this module answers a bad path segment one way"
    # and a rule split across four files is a rule that drifts.
    ("pin_message",      "POST",   f"{API}/messages/{BAD}/pin",             None, None),
    ("unpin_message",    "DELETE", f"{API}/messages/{BAD}/pin",             None, None),
    ("list_pins",        "GET",    f"{API}/channels/{BAD}/pins",            None, None),
    ("set_channel_mute", "PUT",    f"{API}/channels/{BAD}/mute",            None, {"muted": True}),
]


@pytest.mark.parametrize(
    "handler,method,path,query,body", MALFORMED_PATH_ROUTES,
    ids=[r[0] for r in MALFORMED_PATH_ROUTES],
)
async def test_a_malformed_uuid_in_a_path_is_refused_not_a_500(
    api_client, as_member, with_org_id, mock_pool,
    handler, method, path, query, body,
):
    """404, and NOT because the row is missing — because the id is unusable.

    The distinction this module draws is between a PATH and a BODY. A path
    segment NAMES a resource, so an unusable one names no resource and answers
    in the same words a well-formed id for a deleted channel would. The next
    test is the other half of that rule and the two belong together.
    """
    _wire(mock_pool)
    r = await api_client.request(method, path, params=query, json=body)

    assert r.status_code != 500, (
        f"{handler} handed the caller a stack trace for an id they mistyped"
    )
    assert r.status_code == 404, (
        f"{handler} answered {r.status_code}. The module's rule is 404 on a bad "
        f"PATH segment and 400 on a bad BODY field — see `_valid_uuid`. Two "
        f"codes for one input class on one module is the drift this file exists "
        f"to catch: if the rule has genuinely changed, change all of them."
    )


@pytest.mark.parametrize(
    "handler,method,path,query,body", MALFORMED_PATH_ROUTES,
    ids=[r[0] for r in MALFORMED_PATH_ROUTES],
)
async def test_a_malformed_uuid_never_reaches_the_database(
    api_client, as_member, with_org_id, mock_pool,
    handler, method, path, query, body,
):
    """The guard is FIRST, before any lookup.

    Not a performance point. A guard placed after the first query is a guard
    that depends on that query happening to be one Postgres tolerates — and the
    moment somebody reorders two lines, the `DataError` is back with the test
    still green, because the refusal is still a 404 either way. Asserting that
    NOTHING ran is the only form of this check that cannot pass by accident.
    """
    _wire(mock_pool)
    await api_client.request(method, path, params=query, json=body)

    assert not _sql(mock_pool), (
        f"{handler} sent {_sql(mock_pool)[:1]} to Postgres with an id that "
        f"cannot be a uuid"
    )


async def test_a_malformed_uuid_in_a_body_is_a_400_and_says_why(
    api_client, as_member, with_org_id, mock_pool,
):
    """THE OTHER HALF OF THE RULE, and the reason section 1 is not just "not 500".

    `parent_message_id` is a field on a request rather than a name in a URL, so
    it answers 400 and says what was wrong with it. Pinned beside the 404s
    because the two codes only mean anything as a pair: converge them and the
    module has lost the distinction, and each half's own test would still pass.
    """
    _wire(mock_pool)
    r = await api_client.post(
        f"{API}/channels/{CHANNEL_ID}/messages",
        json={"content": "hello?", "parent_message_id": BAD},
    )
    assert r.status_code == 400, (
        "a bad BODY field answers 400 — see `test_samvaad_gates.py`, which "
        "pins the same rule from the other side"
    )


# ════════════════════════════════════════════════════════════════════════════
# 2 · THE `before=` CURSOR
#
# Two defects in one parameter. It was cast to `::uuid` unvalidated, and the
# subquery that resolved it was UNSCOPED — the last unscoped subquery in the
# file.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_malformed_before_cursor_is_an_empty_page_not_a_500(
    api_client, as_member, with_org_id, mock_pool,
):
    """Answered exactly as an UNKNOWN cursor is, and that symmetry is the point.

    Re-serving the newest page instead would hand the client rows it already
    has, which it appends and then asks again from the same place — a scroll
    that never reaches the end.
    """
    _wire(mock_pool, membership={"?column?": 1})
    r = await api_client.get(
        f"{API}/channels/{CHANNEL_ID}/messages", params={"before": BAD}
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_the_before_cursor_is_scoped_to_the_channel(
    api_client, as_member, with_org_id, mock_pool,
):
    """A FOREIGN-ORG message id must not resolve.

    THE ROWS WERE NEVER THE LEAK — they were always this caller's own channel's.
    The ANSWER was: an unscoped cursor resolved a foreign id to a real
    `created_at` and returned an ordinary page, while a fabricated id resolved
    to NULL and returned nothing. The difference between those two replies told
    the holder of an id whether it named a real message anywhere in the product.
    Scoped, a foreign id and a made-up one are the same thing: no such message
    in this channel, so no page.

    Asserted on the SQL the handler BUILT, because the pool is a mock and a
    mocked cursor resolves any name you give it. What can be proved here is that
    the predicate is PRESENT and PARAMETERISED on the channel — which is exactly
    the half a refactor silently loses.
    """
    _wire(mock_pool, membership={"?column?": 1})
    r = await api_client.get(
        f"{API}/channels/{CHANNEL_ID}/messages", params={"before": MESSAGE_ID}
    )
    assert r.status_code == 200

    cursor = [s for s in _sql(mock_pool) if "created_at <" in s]
    assert cursor, "the `before` branch built no cursor comparison at all"
    sub = cursor[0]
    assert re.search(r"WHERE\s+cur\.id\s*=\s*\$3::uuid\s+AND\s+cur\.channel_id\s*=\s*\$1::uuid", sub), (
        "the cursor subquery resolves a message id against EVERY message row in "
        "the database. A foreign-org id returns a page and a fabricated one "
        "returns nothing, which is a cross-tenant existence oracle.\n\n" + sub
    )


# ════════════════════════════════════════════════════════════════════════════
# 3 · UNMUTING A CHANNEL YOU NEVER JOINED DOES NOT LEAVE YOU A MEMBER
#
# `muted` is a column on `samvada_channel_members` and there is nowhere else in
# this schema for a per-channel preference to live, so muting a public channel
# you never opened HAS to write a membership row. The bug was never that; it was
# that unmuting set `muted = false` and left the row standing.
# ════════════════════════════════════════════════════════════════════════════

MEMBERS = "staging.samvada_channel_members"


async def test_muting_a_channel_you_never_joined_marks_the_row_as_not_a_join(
    api_client, as_member, with_org_id, mock_pool,
):
    """The row is written, and it is written CARRYING ITS OWN MARKER.

    Without a marker there is no way to tell an auto-created row from a real
    join, and therefore no safe way to take it away again — which is why the
    unmute below could only ever have been a `muted = false`. `joined_at` is the
    marker because it is the one column on this table with room for one: it is
    `NOT NULL DEFAULT NOW()`, every real join lets the default fire, and nothing
    in the product reads it.
    """
    _wire(mock_pool, execute={MEMBERS: "UPDATE 0"})   # no row yet — falls to INSERT
    r = await api_client.put(
        f"{API}/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 200
    assert r.json()["muted"] is True

    inserts = [s for s in _sql(mock_pool) if s.upper().startswith("INSERT INTO " + MEMBERS.upper())]
    assert inserts, "muting a channel with no membership row wrote nothing"
    assert "joined_at" in inserts[0] and "'-infinity'" in inserts[0], (
        "the row was written with a real-looking `joined_at`, so nothing "
        "downstream can tell it from a genuine join and the unmute can never "
        "safely remove it\n\n" + inserts[0]
    )


async def test_unmuting_removes_the_row_the_mute_created(
    api_client, as_member, with_org_id, mock_pool,
):
    """THE WHOLE DEFECT, in one assertion.

    A row left behind puts the caller in `member_count`, in
    `GET /channels/{id}/members`, in `@channel`'s fan-out and against the
    fifteen-head broadcast ceiling — and because every unread counter is
    `CASE WHEN cm_me.user_id IS NULL THEN 0`, a room they never opened starts
    showing them badges. `muted = false` is worth exactly as much as no row at
    all, so flipping it back changed nothing that mattered and kept everything
    that did.
    """
    _wire(mock_pool, execute={"DELETE FROM " + MEMBERS: "DELETE 1"})
    r = await api_client.put(
        f"{API}/channels/{CHANNEL_ID}/mute", json={"muted": False}
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "muted": False}

    ran = _sql(mock_pool)
    at = [i for i, s in enumerate(ran)
          if s.upper().startswith("DELETE FROM " + MEMBERS.upper())]
    assert at, (
        "unmuting flipped `muted` back to false and left the membership row. "
        "One press of mute and one press of unmute — a pair whose whole meaning "
        "is 'never mind' — joined the caller to the channel permanently."
    )

    # AND THEN IT STOPPED. Issuing the DELETE is only half the fix; the handler
    # has to notice that it worked and return. Falling through leaves an UPDATE
    # against a row that no longer exists — which matches nothing, so
    # `_rowcount` is 0, so the branch below it INSERTS THE ROW BACK, with
    # `muted = false` and a real `joined_at`. The membership would survive the
    # unmute after all, and now with no sentinel on it, so the next unmute could
    # never remove it either. A test that only asserted "a DELETE was built"
    # cannot tell that handler from this one.
    after = [s for s in ran[at[0] + 1:] if MEMBERS in s]
    assert not after, (
        "the unmute deleted the row and then kept going. The statements after "
        "the DELETE are:\n  " + "\n  ".join(after)
    )


async def test_the_unmute_delete_cannot_touch_a_real_membership(
    api_client, as_member, with_org_id, mock_pool,
):
    """Scoped by BOTH halves of the marker, and each is load-bearing.

    `joined_at = '-infinity'` is the sentinel the mute stamped. The `NOT EXISTS`
    over `samvada_messages` is the second half: `send_message` auto-joins a
    public channel on the first post by INSERTing only when no row exists, so
    somebody who muted first and posted afterwards keeps the sentinel row and is
    a real participant under it. Without the message clause, unmuting would
    silently remove a member who had been talking in the channel for months.
    """
    _wire(mock_pool, execute={"DELETE FROM " + MEMBERS: "DELETE 0"})
    await api_client.put(f"{API}/channels/{CHANNEL_ID}/mute", json={"muted": False})

    deletes = [s for s in _sql(mock_pool) if s.upper().startswith("DELETE FROM " + MEMBERS.upper())]
    assert deletes, "no DELETE was built at all"
    sql = deletes[0]
    assert "'-infinity'" in sql, (
        "the unmute DELETE is not restricted to rows the mute created, so it "
        "removes real members\n\n" + sql
    )
    assert "NOT EXISTS" in sql and "staging.samvada_messages" in sql, (
        "the unmute DELETE does not ask whether the caller has ever posted, so "
        "it evicts somebody who muted first and joined by posting afterwards"
        "\n\n" + sql
    )


async def test_unmuting_a_real_member_still_only_clears_the_flag(
    api_client, as_member, with_org_id, mock_pool,
):
    """The fix must not become its own bug.

    A genuine member's `joined_at` is a date, so the DELETE matches nothing and
    the handler falls through to the UPDATE it always ran. Their row, their
    role and their `last_read_at` survive — unmuting a channel you are actually
    in has to remain what it has always been.
    """
    _wire(mock_pool, execute={"DELETE FROM " + MEMBERS: "DELETE 0"})
    r = await api_client.put(
        f"{API}/channels/{CHANNEL_ID}/mute", json={"muted": False}
    )
    assert r.status_code == 200
    assert r.json()["muted"] is False

    updates = [s for s in _sql(mock_pool)
               if s.upper().startswith("UPDATE " + MEMBERS.upper()) and "muted" in s]
    assert updates, (
        "the DELETE matched nothing and the handler then did nothing either, so "
        "a real member's unmute was silently dropped"
    )
    inserts = [s for s in _sql(mock_pool) if s.upper().startswith("INSERT INTO " + MEMBERS.upper())]
    assert not inserts, "unmuting created a membership row"


async def test_being_added_by_somebody_clears_the_mute_sentinel(
    api_client, as_member, with_org_id, mock_pool,
):
    """The third place the invariant is held up, and the one nobody would guess.

    Being added by an admin is a REAL join. If the sentinel survived it, the
    person's next unmute would delete a membership somebody deliberately
    granted — silently — and they would drop out of the channel and out of
    `@channel` with nothing on screen saying so.

    And the `WHERE` is what keeps this from being a behaviour change: a row that
    is already a real join is touched by NOTHING, so re-adding an existing
    member does not reset their `last_read_at` and mark the channel read.
    """
    _wire(mock_pool, membership={"role": "admin"})
    r = await api_client.post(
        f"{API}/channels/{CHANNEL_ID}/members", params={"user_id": SOMEBODY_ELSE}
    )
    assert r.status_code == 201

    inserts = [s for s in _sql(mock_pool) if "INSERT INTO " + MEMBERS in s]
    assert inserts, "add_member wrote no membership row"
    sql = inserts[0]
    assert "DO UPDATE SET joined_at = NOW()" in sql, (
        "add_member leaves the mute sentinel in place, so the person's next "
        "unmute silently removes a membership an admin granted\n\n" + sql
    )
    assert "WHERE cm.joined_at = '-infinity'" in sql, (
        "the ON CONFLICT branch is unrestricted, so re-adding an existing "
        "member rewrites their row and marks the channel read\n\n" + sql
    )


# ════════════════════════════════════════════════════════════════════════════
# 4 · WHAT AN ARCHIVED CHANNEL REFUSES — AND WHAT IT DELIBERATELY DOES NOT
#
# The rule, as the router now records it: AN ARCHIVE IS CLOSED TO NEW CONTENT.
# Membership is not content — adding somebody changes not one line of what the
# channel says, it changes who may read the lines it already has.
#
# The three PERMISSIONS are the half worth testing. `update_channel` is the only
# unarchive path, and a plausible-looking tightening that closed it would make
# archiving irreversible: an archive nobody can re-open is a deletion with the
# history left visible.
# ════════════════════════════════════════════════════════════════════════════

ARCHIVED_REFUSES = [
    ("send_message",  "POST",   f"{API}/channels/{CHANNEL_ID}/messages", None, {"content": "hi"}),
    ("edit_message",  "PATCH",  f"{API}/messages/{MESSAGE_ID}",          None, {"content": "hi"}),
    ("delete_message","DELETE", f"{API}/messages/{MESSAGE_ID}",          None, None),
    ("add_reaction",  "POST",   f"{API}/messages/{MESSAGE_ID}/reactions", {"emoji": "\U0001F44D"}, None),
    ("pin_message",   "POST",   f"{API}/messages/{MESSAGE_ID}/pin",      None, None),
]


@pytest.mark.parametrize(
    "handler,method,path,query,body", ARCHIVED_REFUSES,
    ids=[r[0] for r in ARCHIVED_REFUSES],
)
async def test_an_archived_channel_refuses_new_content(
    api_client, as_member, with_org_id, mock_pool,
    handler, method, path, query, body,
):
    """"History stays searchable; nobody can post, including admins."

    Each of these puts something in front of a reader that the channel did not
    say before, which is exactly what the banner promises cannot happen.
    """
    _wire(mock_pool, channel={"type": "public", "is_archived": True},
          membership={"role": "admin"})
    r = await api_client.request(method, path, params=query, json=body)
    assert r.status_code == 403, (
        f"{handler} wrote into an archived channel (answered {r.status_code})"
    )


async def test_an_archived_channel_can_still_be_unarchived(
    api_client, as_member, with_org_id, mock_pool,
):
    """`update_channel` MUST STAY OPEN. This is not an oversight to be tidied.

    `is_archived` is a field on this body and this is the only route that writes
    it. Refuse here and archiving becomes irreversible — the one change in this
    section that would read as a security fix, pass review, and quietly turn
    every archive into a permanent deletion of a working room.
    """
    _wire(mock_pool, channel={"type": "public", "is_archived": True},
          membership={"role": "admin"})
    r = await api_client.patch(
        f"{API}/channels/{CHANNEL_ID}", json={"is_archived": False}
    )
    assert r.status_code == 200, (
        "the only unarchive path refuses to run on an archived channel, so "
        "nothing archived can ever be re-opened"
    )


ARCHIVED_ALLOWS = [
    # `add_member`: an archived PRIVATE channel is otherwise unreachable
    # forever. The only way to show #q1-audit to an auditor who arrives after it
    # closed would be unarchive → add → re-archive — three calls this router
    # already permits, which re-open posting and put the room back in every
    # member's live rail for the length of the detour. A refusal routed around
    # by a strictly more dangerous sequence is not a refusal.
    ("add_member",    "POST",   f"{API}/channels/{CHANNEL_ID}/members",
     {"user_id": SOMEBODY_ELSE}, None, 201),
    # `remove_member` with the target == the caller is the LEAVE path, and it is
    # the only way anybody gets out of a channel. Refusing it would mean
    # archiving a room locks everybody in it permanently: a private channel they
    # cannot post in, no longer need, and can never remove from their rail.
    ("remove_member", "DELETE", f"{API}/channels/{CHANNEL_ID}/members/{ME}",
     None, None, 200),
]


@pytest.mark.parametrize(
    "handler,method,path,query,body,expected", ARCHIVED_ALLOWS,
    ids=[r[0] for r in ARCHIVED_ALLOWS],
)
async def test_membership_is_not_content_so_an_archive_does_not_close_it(
    api_client, as_member, with_org_id, mock_pool,
    handler, method, path, query, body, expected,
):
    """The judgement call, recorded as a test so it stops being re-litigated.

    Written down here rather than left in a docstring because the next reader
    weighing these two against the five refusals either side will otherwise
    reach for consistency and close them — and consistency is the wrong
    instrument: those five add CONTENT, these two change WHO MAY READ IT, and
    archiving answers only the first question.
    """
    _wire(mock_pool, channel={"type": "private", "is_archived": True},
          membership={"role": "admin"})
    r = await api_client.request(method, path, params=query, json=body)
    assert r.status_code == expected, (
        f"{handler} was refused on an archived channel (answered "
        f"{r.status_code}). An archive is closed to new CONTENT; membership is "
        f"not content."
    )


# ════════════════════════════════════════════════════════════════════════════
# 5 · THE INVOICE BOOKS WHAT IT CHARGED
#
# `invoice_billing_lines.amount` is the system's only machine-readable record of
# what a client was actually charged for a line in a month. `record_billed` can
# deliver that only if the caller TELLS it; left to itself it copies
# `org_billing_lines.amount`, which is right for an untouched row and wrong for
# every other kind.
#
# THE INVOICE IS AUTHORITATIVE. `line_items` and `total_amount` are what the
# client reads and pays; the line is a standing term the invoice quotes.
# ════════════════════════════════════════════════════════════════════════════

INVOICES_URL = "/api/v1/subscription/admin/invoices"
LINE_ID = "cccccccc-dddd-eeee-ffff-000000000001"
OTHER_LINE = "cccccccc-dddd-eeee-ffff-000000000002"


@pytest.fixture
def billed(monkeypatch, mock_pool, app):
    """`POST /admin/invoices` with `record_billed` replaced by a recorder.

    The service itself has its own tests over a fake table. What is under test
    HERE is the PAIRING — that `create_invoice` joins two lists it receives
    separately and hands the result on — and a pairing cannot be tested through
    a direct call to `record_billed`, because the direct call is handed the very
    mapping that was the missing thing.
    """
    import routers.subscription as subscription
    import services.billing_lines as bl
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[get_org_id] = lambda: TEST_ORG_ID
    seen: dict = {}

    async def _record_billed(conn, **kwargs):
        seen.update(kwargs)
        return [{"line_id": str(i)} for i in kwargs.get("line_ids", [])]

    monkeypatch.setattr(bl, "record_billed", _record_billed)

    async def _payee(pool):
        # Pre-096 degrade. Nothing in this section is about collection, and a
        # real payee read would need four more SQL arms for no gain.
        return {"upi_vpa": None, "upi_payee_name": None,
                "why_missing": "096_billing_lines.sql has not been applied."}

    monkeypatch.setattr(subscription, "_platform_payee", _payee)

    async def _fetchval(sql, *a):
        s = " ".join(str(sql).split())
        if "MAX(CAST(SUBSTRING(invoice_number" in s:
            return 1
        if "staging.user_roles" in s:
            return "platform_admin"
        return None

    async def _fetchrow(sql, *a):
        if "INSERT INTO staging.subscription_invoices" in " ".join(str(sql).split()):
            return {"id": "dddddddd-eeee-ffff-0000-111111111111",
                    "invoice_number": a[1], "total": a[7],
                    "due_date": a[8], "payment_status": "pending"}
        return None

    conn = MagicMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=conn)
    conn.fetchval = AsyncMock(side_effect=_fetchval)
    conn.fetchrow = AsyncMock(side_effect=_fetchrow)
    conn.execute = AsyncMock(return_value="INSERT 0 1")
    conn.fetch = AsyncMock(return_value=[])
    mock_pool.acquire.return_value = conn
    mock_pool.fetchval.side_effect = _fetchval
    yield seen
    app.dependency_overrides.pop(get_org_id, None)


def _body(*items, line_ids):
    return {
        "period_start": "2026-08-01", "period_end": "2026-08-31",
        "due_date": "2026-09-07",
        "line_items": list(items),
        "line_ids": line_ids,
    }


async def test_record_billed_is_told_what_the_document_charged(
    api_client, as_admin, billed,
):
    """The line stands at ₹25,000; this document charges ₹30,000.

    The join row must say ₹30,000 — it is the record of what the CLIENT WAS
    CHARGED, and the client was charged what the document says. A join row that
    copied the line would leave the only machine-readable account of the month
    disagreeing with the paper the client is holding.
    """
    r = await api_client.post(INVOICES_URL, json=_body(
        {"description": "Platform fee", "amount": 30000, "qty": 1,
         "unit_amount": 30000, "line_id": LINE_ID},
        line_ids=[LINE_ID],
    ))
    assert r.status_code in (200, 201), r.text
    assert billed.get("amounts"), (
        "`record_billed` was called with no `amounts`, so it fell back to the "
        "line's standing figure and the join row disagrees with the invoice"
    )
    assert float(billed["amounts"][LINE_ID]) == 30000.0


async def test_a_qty_two_line_records_what_it_charged_without_anybody_typing_a_figure(
    api_client, as_admin, billed,
):
    """THE CASE THAT ARRIVES THROUGH A QUANTITY BOX.

    `InvoiceBuilder.jsx` folds `qty` into `amount` before sending, because the
    column the server sums is `item.amount`. So a support plan loaded once and
    billed ×2 for a missed month charges ₹50,000 while the line says ₹25,000 —
    the row that exists to prove what was charged disagreeing with the document,
    with nobody having edited a rupee figure at all. "Only an edited amount is
    affected" was the wrong reading of this gap.
    """
    r = await api_client.post(INVOICES_URL, json=_body(
        {"description": "Support", "amount": 50000, "qty": 2,
         "unit_amount": 25000, "line_id": LINE_ID},
        line_ids=[LINE_ID],
    ))
    assert r.status_code in (200, 201), r.text
    assert float(billed["amounts"][LINE_ID]) == 50000.0, (
        "the join row recorded the unit price, so the system's account of the "
        "month is half what the client was actually charged"
    )


async def test_an_amount_for_a_line_this_invoice_does_not_bill_is_ignored(
    api_client, as_admin, billed,
):
    """A `line_id` on an item that is NOT in `line_ids` discharges nothing.

    The operator deleted that row's id from the list, or the client sends more
    than it bills. Either way the line is not being discharged and nothing on
    this document may be booked against it — booking it would mark a line billed
    by an invoice that never charged for it, and `uq_ibl_line_period` would then
    treat that month as settled forever.
    """
    r = await api_client.post(INVOICES_URL, json=_body(
        {"description": "Platform fee", "amount": 25000, "qty": 1,
         "unit_amount": 25000, "line_id": LINE_ID},
        {"description": "Stale row", "amount": 9000, "qty": 1,
         "unit_amount": 9000, "line_id": OTHER_LINE},
        line_ids=[LINE_ID],
    ))
    assert r.status_code in (200, 201), r.text
    assert OTHER_LINE not in (billed.get("amounts") or {}), (
        "an amount was booked against a line this invoice does not discharge"
    )


async def test_the_pairing_survives_a_differently_spelled_uuid(
    api_client, as_admin, billed,
):
    """Upper case is the same id, and dropping it would be SILENT.

    `line_items` is `list[dict]` — unvalidated JSON — so the spelling is whatever
    the client put there, while `line_ids` is `list[UUID]` and comes back
    canonical. Match on the raw strings and the two never meet: the mapping
    quietly loses the entry, the line falls back to its own amount, and the join
    row goes back to disagreeing with the document. Which is the whole defect,
    reintroduced by a difference in case.
    """
    r = await api_client.post(INVOICES_URL, json=_body(
        {"description": "Platform fee", "amount": 31000, "qty": 1,
         "unit_amount": 31000, "line_id": LINE_ID.upper()},
        line_ids=[LINE_ID],
    ))
    assert r.status_code in (200, 201), r.text
    assert float((billed.get("amounts") or {}).get(LINE_ID, 0)) == 31000.0, (
        "an id spelled in upper case failed to pair, and nothing said so"
    )


async def test_a_malformed_line_id_on_an_item_does_not_take_the_invoice_down(
    api_client, as_admin, billed,
):
    """`record_billed` resolves every key through `_uuid()` BEFORE it asks
    whether that id is being billed, so an unusable key raises `UnknownLine` and
    fails an invoice it was never going to affect. Filtered out here instead."""
    r = await api_client.post(INVOICES_URL, json=_body(
        {"description": "Platform fee", "amount": 25000, "qty": 1,
         "unit_amount": 25000, "line_id": LINE_ID},
        {"description": "Typed by hand", "amount": 1000, "qty": 1,
         "unit_amount": 1000, "line_id": "not-a-uuid"},
        line_ids=[LINE_ID],
    ))
    assert r.status_code in (200, 201), r.text
    assert set(billed["amounts"]) == {LINE_ID}


# ════════════════════════════════════════════════════════════════════════════
# 6 · MIGRATION 097
#
# Read as SQL, not as prose. 097's header argues at length that the column is
# TEXT and that 030 and 092 are the two scars from forgetting it — which is
# worth nothing if the statement underneath says something else. Migrations here
# are applied BY HAND against a schema PRODUCTION WRITES TO; there is no
# rehearsal and no rollback.
# ════════════════════════════════════════════════════════════════════════════

M097 = BACKEND / "migrations" / "097_billing_updated_by.sql"
M096 = BACKEND / "migrations" / "096_billing_lines.sql"


def _statements(path: pathlib.Path) -> str:
    """The file with its comment lines removed.

    Both migrations argue their case at length in `--` comments, and every
    column name in this section appears there several times over. Matching
    against the raw text would let a file that only TALKS about `updated_by`
    pass a test for adding it.
    """
    return "\n".join(
        line for line in path.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("--")
    )


def test_097_exists_and_adds_updated_by_to_the_billing_lines():
    sql = _statements(M097)
    assert re.search(
        r"ALTER\s+TABLE\s+staging\.org_billing_lines\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+updated_by",
        sql, re.I,
    ), "097 does not actually add `updated_by` to staging.org_billing_lines"


def test_the_column_097_adds_does_not_already_exist():
    """A migration that re-adds an existing column is a no-op wearing a number.

    096 created this table with `created_by` and `ended_by` and NO `updated_by`
    — which is the gap 097 exists to close. If 096 had grown the column in the
    meantime, 097 would be inert and every amendment would go on being
    anonymous while the ledger said the fix had shipped.
    """
    create = _statements(M096)
    body = re.search(
        r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+staging\.org_billing_lines\s*\((.*?)\n\);",
        create, re.S | re.I,
    )
    assert body, "could not find 096's CREATE TABLE for org_billing_lines"
    assert not re.search(r"\bupdated_by\b", body.group(1)), (
        "096 already declares `updated_by`, so 097 adds nothing"
    )
    assert re.search(r"\bcreated_by\b", body.group(1))
    assert re.search(r"\bended_by\b", body.group(1))


def test_updated_by_is_text_and_not_uuid():
    """A user id in this product is `user_549c9cac35aa`, not a uuid.

    030_created_by_uuid_to_text.sql ("500 errors on every INSERT") and
    092_sales_target_salesperson_is_a_user_id.sql (a row that could never be
    saved by anyone, in any org, reported to the browser as a CORS error with no
    body) are what this costs. 096 wrote the same reasoning out for the two
    columns this one sits beside and made them TEXT; a third actor column of a
    different type on the same table would be worse than either.
    """
    sql = _statements(M097)
    m = re.search(
        r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+updated_by\s+([A-Za-z ]+?)\s*;",
        sql, re.I,
    )
    assert m, "097's ADD COLUMN has no readable type"
    assert m.group(1).strip().upper() == "TEXT", (
        f"097 declares `updated_by {m.group(1).strip()}`. It holds "
        f"public.users.user_id, which is TEXT — see 030 and 092."
    )


def test_097_is_additive_only():
    """ONE nullable column on ONE table. No DROP, no ALTER … TYPE, no
    SET NOT NULL, no backfill, no trigger. This is the property that makes it
    safe to hand-apply against a schema production writes to, and it is asserted
    rather than asked for in a comment."""
    sql = _statements(M097).upper()
    for forbidden in ("DROP ", "SET NOT NULL", "ALTER COLUMN", "TRUNCATE", "DELETE FROM"):
        assert forbidden not in sql, f"097 contains `{forbidden.strip()}`"
    assert "UPDATE STAGING." not in sql, "097 backfills, and 097 says it does not"
    assert sql.count("ADD COLUMN") == 1, "097 adds more than one column"


def test_097_guards_its_dependency_and_bounds_its_lock():
    """The two things that turn a bad moment into a clean rollback.

    GUARD 0 names 096 rather than letting an operator read "relation does not
    exist" and go hunting for a typo in a table name that is spelled correctly.
    `lock_timeout` matters more: the ALTER takes ACCESS EXCLUSIVE on
    `org_billing_lines` and, WHILE IT QUEUES, blocks every reader that arrives
    after it — the billing console, the top-up dialog and the invoice builder.
    """
    sql = _statements(M097)
    assert "to_regclass('staging.org_billing_lines')" in sql, (
        "097 does not check that 096 has been applied"
    )
    assert re.search(r"SET\s+LOCAL\s+lock_timeout", sql, re.I), (
        "097's ALTER can queue indefinitely and block every read of the billing "
        "lines while it waits"
    )
