"""`GET /live` — the one poll — plus typing, presence and per-channel mute.

Decision D1 is the load-bearing thing in this file, and it is a rate-limit
decision dressed up as a routing one.

`server.global_write_rate_limit` allows 120 POST/PUT/PATCH/DELETE per client IP
per wall-clock minute. A dedicated typing endpoint pinging every three seconds
is twenty writes a minute PER USER; four colleagues in one office, behind one
NAT, would spend two-thirds of that office's entire write budget on animated
dots, and the fifth person's invoice would 429. Worse,
`middleware.subscription._is_write` treats any POST whose path does not end in
one of `READ_SHAPED_POSTS` as a write, so a typing POST would 403 for a legacy
`viewer` grant-holder before the handler ever ran — somebody allowed to READ a
channel would be unable to show that they are typing in it.

So typing and presence travel as query flags on a GET. The two tests that pin
that (`_is_write` on `/live`, and the length of `READ_SHAPED_POSTS`) look
trivial and are the most valuable pair here: they are what stops the next person
from "tidying up" the poll into a POST, or widening the read-shaped exception
list to make room for one — which is a security decision, not a convenience.

D4 is the other half: this is a POLL and stays one. Supabase's pooler runs in
transaction mode on :6543 where `LISTEN`/`NOTIFY` does not work, and the service
runs several gunicorn workers, so an in-process broadcast reaches one worker's
clients and silently misses the rest.

The pool is mocked. These tests assert what the handler DID — which statements
it issued and what it bound to them — not that the SQL executes; per
`routers/messaging.py:30-41`, no mocked cursor can answer that question.
"""
import inspect
import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from conftest import TEST_ORG_ID

CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
OTHER_ORG_CHANNEL = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches its catalogue probe at MODULE scope, forever.

    Left to the mock's default `fetchval` of `0`, the first test in the process
    would conclude 093 was never applied and every later test in every later file
    would silently get the degraded path — no presence writes, no typing, empty
    mention counts — failing nowhere near the test that caused it.
    """
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


def _wire(mock_pool, *, level="editor", channel=None, membership=None,
          channel_rows=None, typing_rows=None, presence_rows=None,
          exec_status="UPDATE 1"):
    """A connection whose answers are chosen by SQL shape.

    `/live` runs everything inside `async with pool.acquire() as conn`, so the
    connection mock carries the load and the pool mock only answers the level
    ladder. Both are wired, because a handler that moved a query from one to the
    other should not silently stop being tested.
    """
    async def _fetchval(sql, *a):
        s = " ".join(str(sql).split())
        if "org_id IS NULL" in s:
            return None
        if "role_code IN ('org_owner','org_admin')" in s:
            return None
        if "org_member_modules" in s:
            return level
        return 0

    async def _fetchrow(sql, *a):
        s = " ".join(str(sql).split())
        if "FROM public.samvada_channels" in s:
            return channel
        if "samvada_channel_members" in s:
            return membership
        if "mention_unread" in s or "server_time" in s:
            return {"mention_unread": 4, "server_time": "2026-08-04T11:02:03.114Z"}
        return None

    async def _fetch(sql, *a):
        s = " ".join(str(sql).split())
        if "public.samvada_typing" in s:
            return list(typing_rows or [])
        if "public.samvada_presence" in s:
            return list(presence_rows or [])
        if "public.samvada_channels c" in s:
            return list(channel_rows or [])
        return []

    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        owner.fetchval = AsyncMock(side_effect=_fetchval)
        owner.fetchrow = AsyncMock(side_effect=_fetchrow)
        owner.fetch = AsyncMock(side_effect=_fetch)
        owner.execute = AsyncMock(return_value=exec_status)
    return mock_pool


def _queries(mock_pool) -> list[tuple[str, list]]:
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


def _req(method: str, path: str):
    r = MagicMock()
    r.method = method
    r.url = MagicMock()
    r.url.path = path
    return r


# ════════════════════════════════════════════════════════════════════════════
# D1 — the poll is a GET, and the exception list did not grow
# ════════════════════════════════════════════════════════════════════════════

def test_the_live_poll_does_not_count_against_the_write_budget():
    """Four seconds apart, per user, all day. If this ever becomes a write, one
    office behind one NAT burns its whole 120-per-minute budget on presence and
    the next person to save an invoice gets a 429 they cannot explain."""
    from middleware.subscription import _is_write
    assert _is_write(_req("GET", "/api/v1/messaging/live")) is False


def test_muting_a_channel_does_count_as_a_write():
    """D3, stated rather than worked around. `PUT /mute` is a genuine write and
    takes the verb gate, which means a legacy `viewer` grant cannot mute. That is
    accepted: every grant issued since `NEW_GRANT_LEVEL_BY_MODULE['sanvaad']`
    became EDITOR is an editor, and a viewer who cannot post has the weakest case
    for needing to silence a channel."""
    from middleware.subscription import _is_write
    assert _is_write(_req("PUT", "/api/v1/messaging/channels/x/mute")) is True
    assert _is_write(_req("POST", "/api/v1/messaging/mentions/read")) is True


def test_the_read_shaped_post_exception_list_did_not_grow():
    """Making `/live` a POST and adding it here is the shortcut this work
    deliberately did not take. Every entry in that tuple is a hole in the rule
    that closed 210 write routes, and widening it is a security decision rather
    than a convenience."""
    from middleware.subscription import READ_SHAPED_POSTS
    assert len(READ_SHAPED_POSTS) == 4, (
        f"READ_SHAPED_POSTS is now {READ_SHAPED_POSTS!r}. Each entry lets a "
        f"viewer through on a POST; adding one to accommodate a poll is how the "
        f"typing indicator would end up bypassing the write gate."
    )


def test_there_is_no_post_endpoint_for_typing_or_presence():
    """The whole point of D1. A second route doing this by POST would reopen the
    hole even if `/live` stayed a GET."""
    from routers.messaging import router
    for r in router.routes:
        path = r.path
        methods = getattr(r, "methods", set())
        if path.endswith(("/typing", "/presence", "/heartbeat")):
            assert methods <= {"GET", "HEAD", "OPTIONS"}, (
                f"{sorted(methods)} {path} — typing and presence must ride the "
                f"GET poll, not their own write route"
            )


def test_the_live_route_is_registered():
    from routers.messaging import router
    registered = {
        (r.path, verb) for r in router.routes for verb in getattr(r, "methods", set())
    }
    assert ("/api/v1/messaging/live", "GET") in registered
    assert ("/api/v1/messaging/channels/{channel_id}/mute", "PUT") in registered


def test_the_poll_comment_says_it_is_a_poll_rather_than_apologising_for_it():
    """D4. The next person to read this handler will wonder why there is no
    websocket, and the answer — transaction-mode pooler, multiple workers — has
    to be at the site, or it gets rediscovered as a "TODO: use websockets"."""
    from routers.messaging import live
    src = inspect.getsource(live).lower()
    assert "transaction mode" in src or "listen" in src
    assert "gunicorn" in src or "worker" in src


# ════════════════════════════════════════════════════════════════════════════
# GET /live
# ════════════════════════════════════════════════════════════════════════════

async def test_live_answers_200_with_the_five_keys_the_client_reads(
    api_client, as_member, with_org_id, mock_pool
):
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/live")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"channels", "typing", "presence", "mention_unread", "server_time"}


async def test_a_viewer_may_poll(api_client, as_member, with_org_id, mock_pool):
    """`/live` carries the unread counts and the typing list. Gating it on editor
    would leave a viewer — somebody explicitly entitled to READ every channel
    they belong to — with a rail that never updates and no idea anyone was
    typing."""
    _wire(mock_pool, level="viewer")
    r = await api_client.get("/api/v1/messaging/live")
    assert r.status_code == 200, r.text


async def test_the_heartbeat_is_written_on_every_poll(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """The heartbeat IS the poll. There is no separate "I am here" call, which is
    the point — a separate call is one more thing a client can forget to make,
    and then everybody looks permanently offline."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live")
    hits = _matching(mock_pool, "INSERT INTO public.samvada_presence", "ON CONFLICT")
    assert hits, "no presence heartbeat was written"
    sql, args = hits[-1]
    assert "DO UPDATE SET last_seen_at = now()" in sql, (
        "the heartbeat inserts but never refreshes an existing row, so a user "
        "goes 'away' 70 seconds after their first ever poll and stays there"
    )
    assert TEST_ORG_ID in args and member_user["user_id"] in args
    assert "online" in args


async def test_a_hidden_tab_reports_away_rather_than_online(
    api_client, as_member, with_org_id, mock_pool
):
    """`@here` is defined as `status='online'`, not merely "has a recent row". If
    a backgrounded tab kept reporting online, `@here` would page everybody who
    left a browser open — which is `@channel` with extra steps."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live", params={"away": 1})
    sql, args = _matching(mock_pool, "INSERT INTO public.samvada_presence")[-1]
    assert "away" in args and "online" not in args


async def test_typing_upserts_only_for_a_channel_the_caller_may_read(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """Without the access check a caller could plant their own name in the typing
    list of a private channel they are not in, and everybody who IS in it would
    watch a stranger appear to type."""
    _wire(mock_pool, channel={"type": "public"})
    r = await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": CHANNEL_ID, "typing": 1}
    )
    assert r.status_code == 200, r.text
    hits = _matching(mock_pool, "INSERT INTO public.samvada_typing")
    assert hits, "typing=1 wrote no typing row"
    sql, args = hits[-1]
    assert "ON CONFLICT (channel_id, user_id) DO UPDATE SET updated_at = now()" in sql
    assert CHANNEL_ID in args and member_user["user_id"] in args


async def test_typing_is_not_written_for_a_private_channel_the_caller_is_not_in(
    api_client, as_member, with_org_id, mock_pool
):
    _wire(mock_pool, channel={"type": "private"}, membership=None)
    r = await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": CHANNEL_ID, "typing": 1}
    )
    assert r.status_code == 200, "a refused channel must not fail the whole poll"
    assert not _matching(mock_pool, "INSERT INTO public.samvada_typing")
    assert r.json()["typing"] == []


async def test_typing_zero_deletes_the_row_rather_than_waiting_for_a_timeout(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """The composer going quiet is what stops the dots. Relying on the 8-second
    read window instead means the dots linger for eight seconds after every
    message is sent, on every message."""
    _wire(mock_pool, channel={"type": "public"})
    await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": CHANNEL_ID, "typing": 0}
    )
    hits = _matching(mock_pool, "DELETE FROM public.samvada_typing", "user_id=$2")
    assert hits, "typing=0 left the row in place"
    assert CHANNEL_ID in hits[-1][1] and member_user["user_id"] in hits[-1][1]


async def test_the_poll_sweeps_abandoned_typing_rows_in_the_open_channel(
    api_client, as_member, with_org_id, mock_pool
):
    """A tab closed mid-word leaves a row nobody deletes, and the person shows as
    typing forever. The sweep is still the backstop for that, and it is still not
    a cron — a cron is a thing nobody notices has stopped.

    It is scoped to the open channel. `samvada_typing`'s only index is
    `PRIMARY KEY (channel_id, user_id)`, so an unqualified `WHERE updated_at < …`
    is a sequential scan of every org's rows under a row-exclusive lock, and this
    poll runs fifteen times a minute per user. Scoped, it is a primary-key prefix
    scan of the handful of rows in one room."""
    _wire(mock_pool, channel={"type": "public"})
    await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": CHANNEL_ID, "typing": 1}
    )
    hits = _matching(mock_pool, "DELETE FROM public.samvada_typing", "updated_at <")
    assert hits, "abandoned typing rows are never cleaned up"
    sql, args = hits[-1]
    assert "15 seconds" in sql
    assert "channel_id=$1::uuid" in sql.replace(" ", ""), sql
    assert CHANNEL_ID in args


async def test_a_rail_only_poll_does_not_sweep(
    api_client, as_member, with_org_id, mock_pool
):
    """The narrow case that pays for the scoping, and the one a "tidy-up" would
    undo first. With no channel open there is no channel to sweep, and the old
    unqualified DELETE fired here anyway — every idle rail scanning every other
    org's typing rows, forever.

    Dropping it loses nothing a user could see: the typing list is read scoped to
    one channel AND filtered `updated_at > now() - interval '8 seconds'`, so a
    stale row elsewhere was never renderable here. It is swept by the first poll
    that opens THAT channel — the first moment anybody could have seen it."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live")
    assert not _matching(
        mock_pool, "DELETE FROM public.samvada_typing", "updated_at <"
    ), "a poll with no channel open is sweeping the whole table again"


async def test_the_typing_list_excludes_the_caller(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """Nobody needs to be told they are typing, and rendering it would put a
    permanent "You are typing…" under your own composer.

    Asserted on the query rather than the response: the exclusion is `t.user_id
    <> $2` in SQL, and a mocked cursor returns whatever it is handed regardless
    of the predicate — so the response is not evidence either way.
    """
    _wire(mock_pool, channel={"type": "public"})
    await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": CHANNEL_ID, "typing": 1}
    )
    hits = _matching(mock_pool, "FROM public.samvada_typing t")
    assert hits, "no typing list was read"
    sql, args = hits[-1]
    assert re.search(r"t\.user_id (<>|!=) \$\d+", sql), sql
    assert member_user["user_id"] in args
    assert "8 seconds" in sql, "the staleness window is gone"
    assert "LIMIT 5" in sql


async def test_an_unknown_channel_id_is_still_a_200(
    api_client, as_member, with_org_id, mock_pool
):
    """A channel deleted, archived or left underneath a running poll must not
    turn the poll into a 404 — the client would raise an error banner for a race
    it has already recovered from, four seconds before recovering again."""
    _wire(mock_pool, channel=None)
    r = await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": OTHER_ORG_CHANNEL}
    )
    assert r.status_code == 200, r.text
    assert r.json()["typing"] == []


async def test_a_malformed_channel_id_is_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    """`$1::uuid` on a non-uuid raises asyncpg's `DataError`. On a four-second
    poll that is a 500 every four seconds for as long as the client holds the bad
    value."""
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/live", params={"channel_id": "nope"})
    assert r.status_code == 200, r.text


async def test_the_channel_counts_cover_the_same_channels_as_the_rail(
    api_client, as_member, with_org_id, mock_pool
):
    """`GET /channels` and `/live` must agree about which channels exist, or the
    rail flickers between two numbers as the slower call lands. Public channels
    in the org, plus the private and DM ones the caller belongs to — the same
    predicate, and a LEFT JOIN so an unjoined public channel appears with zero
    rather than vanishing."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live")
    hits = _matching(mock_pool, "FROM public.samvada_channels c")
    assert hits, "no channel counts were read"
    sql, args = hits[-1]
    assert "LEFT JOIN public.samvada_channel_members" in sql
    assert "c.type = 'public' OR cm_me.user_id IS NOT NULL" in sql
    assert "c.org_id = $1::uuid" in sql
    assert TEST_ORG_ID in args


async def test_your_own_message_is_not_unread(
    api_client, as_member, with_org_id, mock_pool
):
    """`list_channels` counted it, which is why sending a message used to bump
    your own badge to 1 until the next poll. `/live` corrects it, and the two
    have to agree or the badge flickers."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live")
    sql, _ = _matching(mock_pool, "FROM public.samvada_channels c")[-1]
    assert re.search(r"m\.sender_id (<>|!=) \$\d+", sql), (
        f"the unread count still includes the caller's own messages:\n{sql}"
    )


async def test_presence_is_derived_in_sql_not_in_python(
    api_client, as_member, with_org_id, mock_pool
):
    """A Railway container whose clock has drifted 90 seconds would otherwise
    report the entire org offline. The comparison has to happen against the
    database's `now()`, which is also where `last_seen_at` came from."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live")
    hits = _matching(mock_pool, "FROM public.samvada_presence p")
    assert hits, "presence was never read"
    sql, args = hits[-1]
    assert "now() - interval '70 seconds'" in sql
    assert "now() - interval '5 minutes'" in sql
    assert TEST_ORG_ID in args


async def test_a_stale_user_is_omitted_from_the_presence_map(
    api_client, as_member, with_org_id, mock_pool
):
    """Not sent as "offline". In a 200-person org that is the difference between
    a 40-byte map and a 4KB one, four seconds apart, forever — and the client
    already reads an absent key as offline."""
    _wire(mock_pool, presence_rows=[
        {"user_id": "u_online", "state": "online"},
        {"user_id": "u_away", "state": "away"},
    ])
    r = await api_client.get("/api/v1/messaging/live")
    assert r.json()["presence"] == {"u_online": "online", "u_away": "away"}


async def test_the_poll_takes_one_connection_for_the_whole_handler(
    api_client, as_member, with_org_id, mock_pool
):
    """Six round trips on six separate checkouts is six chances to queue on the
    pool — every four seconds, per user, for every user in the org."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/live")
    assert mock_pool.acquire.call_count == 1, (
        f"the poll checked out {mock_pool.acquire.call_count} connections"
    )


async def test_the_poll_degrades_instead_of_500ing_before_the_migration(
    api_client, as_member, with_org_id, mock_pool
):
    """093 is applied by hand, and this endpoint fires every four seconds. The
    window between deploying the code and running the migration would otherwise
    be a continuous stream of `UndefinedTableError` from the busiest route in the
    module."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(False)
    _wire(mock_pool, channel={"type": "public"})
    r = await api_client.get(
        "/api/v1/messaging/live", params={"channel_id": CHANNEL_ID, "typing": 1}
    )
    assert r.status_code == 200, r.text
    for absent in ("public.samvada_typing", "public.samvada_presence",
                   "public.samvada_mentions"):
        assert not _matching(mock_pool, absent), (
            f"the poll still queries {absent} before 093 has been applied"
        )


# ════════════════════════════════════════════════════════════════════════════
# PUT /channels/{id}/mute
# ════════════════════════════════════════════════════════════════════════════

async def test_mute_404s_for_a_channel_in_another_org(
    api_client, as_member, with_org_id, mock_pool
):
    """Muting is a personal preference row keyed on (channel, user). Writing one
    for a foreign channel id would create a membership row joining this caller to
    another tenant's channel — the cross-tenant WRITE `_assert_same_org` exists
    to prevent, by a different door."""
    _wire(mock_pool, channel=None)
    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 404
    assert not _matching(mock_pool, "muted")


async def test_mute_403s_on_a_private_channel_the_caller_is_not_in(
    api_client, as_member, with_org_id, mock_pool
):
    _wire(mock_pool, channel={"type": "private"}, membership=None)
    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 403


async def test_mute_sets_the_column_and_echoes_the_value(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """PUT, not PATCH: it sets one boolean to a stated value and is idempotent.
    The echo is what the client patches its row with, so it must be the value
    that was written and not the value that was requested by a different call."""
    _wire(mock_pool, channel={"type": "public"})
    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "muted": True}

    hits = _matching(mock_pool, "UPDATE public.samvada_channel_members", "muted")
    assert hits, "nothing wrote the muted column"
    sql, args = hits[-1]
    assert CHANNEL_ID in args and member_user["user_id"] in args and True in args


async def test_muting_a_public_channel_you_never_joined_creates_the_row(
    api_client, as_member, with_org_id, mock_pool
):
    """`_assert_channel_access` has already established this can only be a public
    channel — anything else would have raised 403. The honest alternative is a
    404 telling the user their own preference does not exist."""
    _wire(mock_pool, channel={"type": "public"}, exec_status="UPDATE 0")
    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 200, r.text
    hits = _matching(mock_pool, "INSERT INTO public.samvada_channel_members", "muted")
    assert hits, "no member row was created for the mute"
    assert "ON CONFLICT (channel_id, user_id) DO UPDATE SET muted" in hits[-1][0]


async def test_a_dm_can_be_muted(api_client, as_member, with_org_id, mock_pool):
    """Deliberately NOT refused. A DM is the single most likely thing somebody
    wants to silence for an afternoon, and a "cannot mute a DM" rule reads as a
    bug to the person who wanted it."""
    _wire(mock_pool, channel={"type": "dm"}, membership={"1": 1})
    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": True}
    )
    assert r.status_code == 200, r.text


async def test_an_archived_channel_can_still_be_muted(
    api_client, as_member, with_org_id, mock_pool
):
    """Mute is a preference, not content. Refusing it on an archived channel
    would leave somebody unable to silence a channel that still receives
    mentions from edits and pins."""
    _wire(mock_pool, channel={"type": "public", "is_archived": True})
    r = await api_client.put(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/mute", json={"muted": False}
    )
    assert r.status_code == 200, r.text
    assert r.json()["muted"] is False


async def test_a_malformed_channel_id_on_mute_is_a_404_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    _wire(mock_pool)
    r = await api_client.put(
        "/api/v1/messaging/channels/not-a-uuid/mute", json={"muted": True}
    )
    assert r.status_code == 404


# ════════════════════════════════════════════════════════════════════════════
# The two new tables have to be the ones 093 creates
# ════════════════════════════════════════════════════════════════════════════

def test_the_typing_and_presence_tables_match_the_migration():
    """The `graha_contacts.type` shape again: Python names a relation Postgres
    does not have, and it surfaces as an opaque 500 on the busiest route in the
    module. A mocked cursor resolves any name, so this compares the code against
    the migration rather than against the mock."""
    import pathlib
    backend = pathlib.Path(__file__).resolve().parents[1]
    sql = (backend / "migrations" / "093_sanvaad_slack_parity.sql").read_text(
        encoding="utf-8"
    )
    for table, columns in (
        ("samvada_typing", ("channel_id", "user_id", "updated_at")),
        ("samvada_presence", ("org_id", "user_id", "last_seen_at", "status")),
    ):
        assert f"CREATE TABLE IF NOT EXISTS staging.{table}" in sql, (
            f"093 does not create staging.{table}"
        )
        block = sql.split(f"staging.{table}", 1)[1].split(";", 1)[0]
        for column in columns:
            assert re.search(rf"\b{column}\b", block), (
                f"staging.{table} has no {column} column in 093"
            )

    # Both upserts depend on a primary key that is exactly (channel_id, user_id)
    # and (org_id, user_id). Without it `ON CONFLICT` raises
    # InvalidColumnReference and the poll 500s on its first write.
    assert "PRIMARY KEY (channel_id, user_id)" in sql
    assert "PRIMARY KEY (org_id, user_id)" in sql
