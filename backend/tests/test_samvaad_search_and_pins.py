"""Sanvaad search and pinned messages.

`GET /search` is the most dangerous read in this module and the reason this file
leads with tenancy. Every other read here carries a channel id in the path, so
scoping is a WHERE clause on a row somebody already named. Search has no such
anchor: it walks `staging.samvada_messages` across the whole table and decides
for itself which rows the caller may see. Get that predicate wrong and one
firm's client list, salary discussion or bank detail comes back in another
firm's search box — and it comes back looking like a working feature, because a
search that returns MORE results does not look broken.

Two things carry the rule and neither may be dropped:

  · the org predicate sits ON THE CHANNEL JOIN (`c.org_id = $2::uuid`), where a
    later edit to the WHERE list cannot lose it;
  · membership is `c.type = 'public' OR EXISTS (… cm.user_id = $1)`, verbatim
    the rule `_assert_channel_access` and `list_messages` enforce.

The pool is mocked, so — as `routers/messaging.py:30-41` warns at length — none
of these tests prove the SQL RUNS. A mocked cursor resolves any table name you
give it, and every read endpoint in this router once 500'd against the real
database with the whole suite green. What they prove is that the predicate is
PRESENT and PARAMETERISED, which is the half that a refactor silently loses.

Pins are the smaller half of the file: an org-scoped 404 before anything else, a
cap so `GET /pins` can stay unpaged, and an unpin rule that stops one member
quietly removing another member's pin.
"""
import inspect
import pathlib
import re
from unittest.mock import AsyncMock

import pytest

from conftest import TEST_ORG_ID

CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
MESSAGE_ID = "11111111-2222-3333-4444-555555555555"
OTHER_USER = "user_someone_else"
PINNED_AT = "2026-08-04T10:00:00+00:00"

BACKEND = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Skip `require_module('sanvaad')` — reach and the write-verb gate are
    tested in `test_module_write_level.py`, and leaving them on here would make
    every 403 below ambiguous between "wrong level" and "no subscription"."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches its catalogue probe at MODULE scope, forever.

    Left alone, the first test in this process answers the probe with the mock's
    default `fetchval` of `0`, the router concludes 093 was never applied, and
    every later test in every later file gets the degraded pre-migration
    behaviour — search with no `search_tsv`, pins that return `[]`, mentions that
    return `[]`. The failures land nowhere near the test that caused them. So the
    cache is stated explicitly per test and cleared afterwards.
    """
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


def _wire(
    mock_pool, *,
    level: str = "editor",
    message: dict | None = None,
    channel: dict | None = None,
    membership: dict | None = None,
    member_role: dict | None = None,
    pin_count: int = 0,
    updated: dict | None = None,
    rows: list | None = None,
):
    """Answer by SQL SHAPE, not by call order.

    `test_messaging_security.py` orders `fetchrow` side-effect LISTS to match each
    handler's exact sequence, and this work's spec records what that costs: one
    new query anywhere in `send_message` breaks every test that mocks it. These
    tests assert what came back and what the query said, so they survive the
    router reordering its own round trips and fail only when behaviour changes.
    """
    if rows is None:
        rows = []

    async def _fetchval(sql, *a):
        s = " ".join(str(sql).split())
        # `held_level` asks three questions in this order.
        if "org_id IS NULL" in s:
            return None                                   # no platform role
        if "role_code IN ('org_owner','org_admin')" in s:
            return None                                   # not an org admin
        if "org_member_modules" in s:
            return level
        if "COUNT(*)" in s and "pinned_at IS NOT NULL" in s:
            return pin_count
        if "SELECT pinned_at FROM staging.samvada_messages" in s:
            return PINNED_AT
        return 0

    async def _fetchrow(sql, *a):
        s = " ".join(str(sql).split())
        if s.upper().startswith("UPDATE"):
            return updated
        if "FROM staging.samvada_messages" in s:
            return message
        if "FROM staging.samvada_channels" in s:
            return channel
        if "samvada_channel_members" in s and "role" in s:
            return member_role
        if "samvada_channel_members" in s:
            return membership
        return None

    async def _fetch(sql, *a):
        return list(rows)

    mock_pool.fetchval = AsyncMock(side_effect=_fetchval)
    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)
    mock_pool.fetch = AsyncMock(side_effect=_fetch)
    mock_pool.execute = AsyncMock(return_value="UPDATE 1")
    return mock_pool


def _queries(mock_pool) -> list[tuple[str, list]]:
    """Every statement the handler issued, on the pool and on any connection it
    checked out, normalised to one line."""
    out = []
    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        for name in ("execute", "fetch", "fetchrow", "fetchval"):
            m = getattr(owner, name, None)
            for call in getattr(m, "call_args_list", []) or []:
                if call.args and isinstance(call.args[0], str):
                    out.append((" ".join(call.args[0].split()), list(call.args[1:])))
    return out


def _code_of(fn) -> str:
    """Source with the docstring and the `#` comments removed.

    Both legitimately DISCUSS the thing being banned — `search_messages`'s
    docstring says "`'simple'`, never `'english'`" — so a test that scans the raw
    source asserts against its own explanation. `test_prachar_audience._body`
    failed exactly this way on its first run.
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


def _the_search_query(mock_pool) -> tuple[str, list]:
    hits = [(s, a) for s, a in _queries(mock_pool)
            if "FROM staging.samvada_messages m" in s and "ORDER BY m.created_at DESC" in s]
    assert hits, "no search query was issued"
    return hits[-1]


# ── The routes have to exist at all ──────────────────────────────────────────

def test_the_search_and_pin_routes_are_registered():
    """A crisp failure when they are absent, instead of eleven mysterious 404s."""
    from routers.messaging import router
    registered = {
        (r.path, verb)
        for r in router.routes
        for verb in getattr(r, "methods", set())
    }
    for path, verb in (
        ("/api/v1/messaging/search", "GET"),
        ("/api/v1/messaging/messages/{message_id}/pin", "POST"),
        ("/api/v1/messaging/messages/{message_id}/pin", "DELETE"),
        ("/api/v1/messaging/channels/{channel_id}/pins", "GET"),
    ):
        assert (path, verb) in registered, f"{verb} {path} is not registered"


# ── Search · tenancy ─────────────────────────────────────────────────────────

async def test_search_scopes_the_channel_join_to_the_callers_own_org(
    api_client, as_member, with_org_id, mock_pool
):
    """Without this predicate, one firm searches another firm's messages.

    There is no channel id in the path to fall back on. `c.org_id = $2::uuid` on
    the JOIN is the only thing standing between a search box and every
    conversation in the database.
    """
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/search", params={"q": "invoice"})
    assert r.status_code == 200, r.text

    sql, args = _the_search_query(mock_pool)
    assert re.search(r"JOIN staging\.samvada_channels c ON c\.id = m\.channel_id "
                     r"AND c\.org_id = \$\d+::uuid", sql), (
        f"the org filter is not on the channel join:\n{sql}"
    )
    assert TEST_ORG_ID in args, "the caller's org was never bound to the query"


async def test_search_returns_only_public_channels_and_ones_the_caller_is_in(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """Being in the same org is not permission to read a private channel or a
    DM. Search is the one read here with no `_assert_channel_access` in front of
    it, so it has to carry the same rule inline — and it has to be the SAME rule,
    or a private channel becomes searchable by everyone in the firm."""
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/search", params={"q": "salary"})
    assert r.status_code == 200

    sql, args = _the_search_query(mock_pool)
    assert "c.type = 'public'" in sql
    assert re.search(
        r"EXISTS \(\s*SELECT 1 FROM staging\.samvada_channel_members cm\s+"
        r"WHERE cm\.channel_id = c\.id AND cm\.user_id = \$\d+\)", sql
    ), f"the membership arm is gone:\n{sql}"
    assert member_user["user_id"] in args, "the caller was never bound to the query"


async def test_search_never_returns_a_deleted_message(
    api_client, as_member, with_org_id, mock_pool
):
    """A deleted message is gone from the log. Leaving it findable by text makes
    deletion a lie."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/search", params={"q": "oops"})
    sql, _ = _the_search_query(mock_pool)
    assert "m.is_deleted = FALSE" in sql


# ── Search · the query itself ────────────────────────────────────────────────

async def test_search_refuses_a_one_character_query(api_client, as_member, with_org_id, mock_pool):
    """A single letter matches most of the table. The floor is two."""
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/search", params={"q": "a"})
    assert r.status_code == 422


def test_the_tsquery_is_a_bind_parameter_and_never_an_f_string():
    """The compiled query is caller text. Concatenating it into SQL is the only
    injection hole this feature could have, and `to_tsquery(` is exactly where a
    future edit would be tempted to put it — the WHERE list around it is already
    assembled with f-strings for the parameter numbering.

    Source inspection rather than a runtime assertion on purpose: a runtime test
    only proves the branch it took, and the dangerous branch is whichever one
    nobody wrote a test for.
    """
    from routers.messaging import search_messages
    src = _code_of(search_messages)
    assert re.search(r"to_tsquery\('simple', \$\d+\)", src), (
        "the tsquery is no longer bound as a positional parameter"
    )
    for m in re.finditer(r"to_tsquery\(([^)]*)\)", src):
        assert "{" not in m.group(1), (
            f"an f-string expression is interpolated into to_tsquery({m.group(1)}) — "
            f"the compiled query must be a bind parameter"
        )


def test_search_uses_the_simple_text_search_configuration():
    """English stemming mangles Devanagari and makes Hindi terms unsearchable.
    The generated column in migration 093 is `'simple'`; if the query is not, the
    GIN index is never used and the two disagree about what a word is."""
    from routers.messaging import search_messages
    code = _code_of(search_messages)
    assert "'english'" not in code
    assert "to_tsquery('simple'" in code


async def test_a_query_that_compiles_to_nothing_still_searches(
    api_client, as_member, with_org_id, mock_pool
):
    """`to_tsquery('simple', '')` is a syntax error, not an empty match.

    `build_tsquery('!!')` strips every character and returns ''. Passing that
    through would 500 the search box for anyone who typed punctuation; the ILIKE
    arm has to answer alone.
    """
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/search", params={"q": "!!"})
    assert r.status_code == 200, r.text
    sql, _ = _the_search_query(mock_pool)
    assert "to_tsquery" not in sql, (
        "an empty tsquery was still passed to to_tsquery, which raises a syntax "
        "error before a row is read"
    )
    assert "ILIKE" in sql


async def test_search_matches_inside_a_token_as_well_as_on_word_boundaries(
    api_client, as_member, with_org_id, mock_pool
):
    """A tsvector never matches INSIDE a token: somebody typing `nag` looking for
    `nagar`, or `4021` looking for `INV-2026-4021`, gets nothing from tsquery
    alone. Both arms, always, exactly as `routers/search.py` does it."""
    _wire(mock_pool)
    await api_client.get("/api/v1/messaging/search", params={"q": "nag"})
    sql, args = _the_search_query(mock_pool)
    assert "to_tsquery" in sql and "ILIKE" in sql, sql
    assert "%nag%" in args, "the ILIKE needle was not bound"


async def test_search_before_the_migration_does_not_name_the_generated_column(
    api_client, as_member, with_org_id, mock_pool
):
    """Migrations here are applied BY HAND. There is always a window in which
    this code is deployed and 093 is not, and search fires on a 300ms debounce —
    so that window would be a stream of `UndefinedColumnError` 500s from the
    search box rather than one failure somebody notices."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(False)
    _wire(mock_pool)
    r = await api_client.get("/api/v1/messaging/search", params={"q": "invoice"})
    assert r.status_code == 200, r.text
    sql, _ = _the_search_query(mock_pool)
    assert "m.search_tsv" not in sql
    assert "m.pinned_at" not in sql


async def test_search_reports_another_page_without_counting_the_whole_table(
    api_client, as_member, with_org_id, mock_pool
):
    """`more` is `limit + 1` rows fetched and truncated. A COUNT over the same
    predicate would double the cost of a query that fires on every keystroke
    after the debounce."""
    extra = [
        {"id": f"m{i}", "channel_id": CHANNEL_ID, "content": "x", "sender_id": "u",
         "created_at": None, "pinned_at": None, "channel_name": "#a",
         "channel_type": "public", "sender_name": "U", "sender_avatar": None}
        for i in range(3)
    ]
    _wire(mock_pool, rows=extra)
    r = await api_client.get(
        "/api/v1/messaging/search", params={"q": "invoice", "limit": 2}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["results"]) == 2, "the sentinel row was returned to the client"
    assert body["more"] is True

    sql, args = _the_search_query(mock_pool)
    assert "COUNT(" not in sql.upper(), "search runs a COUNT it does not need"
    assert 3 in args, "search did not ask for limit + 1 rows"


# ── Pins · access, in the documented order ───────────────────────────────────

async def test_pin_404s_for_a_message_in_another_org(
    api_client, as_member, with_org_id, mock_pool
):
    """The org-scoped 404 runs FIRST — before the channel check and before the
    level check. A 403 that fires ahead of the org filter would let this test
    pass even if cross-tenant scoping were deleted, which is the trap
    `add_reaction` already documents."""
    _wire(mock_pool, message=None)
    r = await api_client.post(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 404


async def test_pin_403s_on_a_private_channel_the_caller_is_not_in(
    api_client, as_member, with_org_id, mock_pool
):
    """Holding a message id is not membership. Without this, anyone in the org
    could pin into a private channel or a DM they have never been in — and the
    pin then renders in that channel's header for the people who ARE in it."""
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_at": None, "is_archived": False},
        channel={"type": "private"},
        membership=None,
    )
    r = await api_client.post(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 403
    assert "member" in r.json()["detail"].lower()


async def test_a_viewer_cannot_pin(api_client, as_member, with_org_id, mock_pool):
    """A pin changes what everybody in the channel sees at the top of the
    window. `ScreensSanvaad.jsx` puts a viewer behind a locked composer; a
    viewer who can pin has written to the channel by another route."""
    _wire(
        mock_pool, level="viewer",
        message={"channel_id": CHANNEL_ID, "pinned_at": None, "is_archived": False},
        channel={"type": "public"},
    )
    r = await api_client.post(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 403
    assert "Viewer" in r.json()["detail"]


async def test_pinning_an_already_pinned_message_does_not_steal_attribution(
    api_client, as_member, with_org_id, mock_pool
):
    """Two people tapping pin at once, or one person double-tapping, must not
    rewrite `pinned_by`. The second caller still gets a 200 — from their side the
    message is pinned, which is what they asked for."""
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_at": PINNED_AT, "is_archived": False},
        channel={"type": "public"},
    )
    r = await api_client.post(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 200
    assert r.json()["pinned_at"] == PINNED_AT
    writes = [s for s, _ in _queries(mock_pool)
              if s.upper().startswith("UPDATE") and "pinned_by" in s]
    assert not writes, "a re-pin rewrote pinned_by and stole the attribution"


async def test_the_pin_cap_is_enforced(api_client, as_member, with_org_id, mock_pool):
    """`GET /pins` is unpaged, and it is unpaged BECAUSE of this cap. Remove the
    cap and the chat header eventually loads every pinned message in the channel
    on every open."""
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_at": None, "is_archived": False},
        channel={"type": "public"},
        pin_count=50,
    )
    r = await api_client.post(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 400
    assert "Unpin one first" in r.json()["detail"]


async def test_a_malformed_message_id_is_a_404_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    """`$1::uuid` on a string that is not one raises asyncpg's `DataError`, which
    surfaces as a 500 with a stack trace. The id comes straight off the URL, so
    it is caller-supplied and has to be checked."""
    _wire(mock_pool)
    r = await api_client.post("/api/v1/messaging/messages/not-a-uuid/pin")
    assert r.status_code == 404
    r = await api_client.delete("/api/v1/messaging/messages/not-a-uuid/pin")
    assert r.status_code == 404
    r = await api_client.get("/api/v1/messaging/channels/not-a-uuid/pins")
    assert r.status_code == 404


async def test_nobody_can_pin_into_an_archived_channel(
    api_client, as_member, with_org_id, mock_pool
):
    """"History stays searchable; nobody can post" — and a pin is content the
    channel did not have before."""
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_at": None, "is_archived": True},
        channel={"type": "public"},
    )
    r = await api_client.post(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 403
    assert "archived" in r.json()["detail"].lower()


# ── Unpin · whose pin is it ──────────────────────────────────────────────────

async def test_unpin_refuses_someone_who_neither_pinned_it_nor_runs_the_channel(
    api_client, as_member, with_org_id, mock_pool
):
    """Otherwise any member can quietly remove the thing another member pinned,
    and the only trace is that the header changed."""
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_by": OTHER_USER},
        channel={"type": "public"},
        member_role={"role": "member"},
    )
    r = await api_client.delete(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 403
    assert "unpin" in r.json()["detail"].lower()
    assert not [s for s, _ in _queries(mock_pool) if "pinned_at = NULL" in s]


async def test_a_channel_admin_can_unpin_somebody_elses_pin(
    api_client, as_member, with_org_id, mock_pool
):
    """The override matters: a pin left by somebody who has since left the org
    would otherwise be permanent."""
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_by": OTHER_USER},
        channel={"type": "public"},
        member_role={"role": "admin"},
    )
    r = await api_client.delete(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 200
    assert [s for s, _ in _queries(mock_pool)
            if "pinned_at = NULL" in s and "pinned_by = NULL" in s], (
        "the unpin cleared neither column"
    )


async def test_you_can_always_unpin_your_own_pin(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    _wire(
        mock_pool,
        message={"channel_id": CHANNEL_ID, "pinned_by": member_user["user_id"]},
        channel={"type": "public"},
        member_role=None,
    )
    r = await api_client.delete(f"/api/v1/messaging/messages/{MESSAGE_ID}/pin")
    assert r.status_code == 200


# ── Listing pins ─────────────────────────────────────────────────────────────

async def test_listing_pins_404s_for_a_channel_in_another_org(
    api_client, as_member, with_org_id, mock_pool
):
    _wire(mock_pool, channel=None)
    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/pins")
    assert r.status_code == 404


async def test_listing_pins_403s_for_a_private_channel_the_caller_is_not_in(
    api_client, as_member, with_org_id, mock_pool
):
    """The pins are message bodies. Enumerating them is reading the channel."""
    _wire(mock_pool, channel={"type": "private"}, membership=None)
    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/pins")
    assert r.status_code == 403


async def test_listing_pins_excludes_deleted_messages(
    api_client, as_member, with_org_id, mock_pool
):
    """A message deleted after it was pinned keeps its `pinned_at`. Without the
    filter its body reappears, permanently, at the top of the channel."""
    _wire(mock_pool, channel={"type": "public"})
    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/pins")
    assert r.status_code == 200
    sql = [s for s, _ in _queries(mock_pool) if "pinned_at IS NOT NULL" in s]
    assert sql, "no pins query was issued"
    assert "m.is_deleted = FALSE" in sql[-1]


async def test_listing_pins_before_the_migration_is_empty_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    """The chat header loads this on every channel open. A 500 here takes the
    header down for the whole window between deploying and applying 093."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(False)
    _wire(mock_pool, channel={"type": "public"})
    r = await api_client.get(f"/api/v1/messaging/channels/{CHANNEL_ID}/pins")
    assert r.status_code == 200
    assert r.json() == []


# ── The columns these queries name have to be in the migration ───────────────

def test_the_pin_and_search_columns_are_the_ones_093_adds():
    """A green suite proves nothing about a column name — a mocked cursor
    resolves whatever you ask it for. This is the one check in this file that
    compares the code against the schema rather than against a mock.
    """
    migration = BACKEND / "migrations" / "093_sanvaad_slack_parity.sql"
    assert migration.exists(), "migration 093 is missing"
    sql = migration.read_text(encoding="utf-8")

    router_src = (BACKEND / "routers" / "messaging.py").read_text(encoding="utf-8")
    for column in ("pinned_at", "pinned_by", "search_tsv"):
        assert f"ADD COLUMN IF NOT EXISTS {column}" in sql, (
            f"093 does not add {column} to staging.samvada_messages"
        )
        assert column in router_src, f"nothing in the router reads {column}"
