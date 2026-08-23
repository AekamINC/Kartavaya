"""`GET /directory` has to answer for a CHANNEL, not only for the org.

`services/samvaad_mentions._readable_by` decides who a mention can resolve to:
CHANNEL MEMBERS ONLY for a `private` channel and for a `dm`, members UNION the
org for a `public` one — deliberately, because a mention notification quotes 140
characters of the message body, so resolving somebody who cannot open the
channel would mail them its contents.

`/directory` answered a different question: every `org_member` in the org whose
`full_name` matched, alphabetically, capped. The gap between those two sets is
the worst failure this feature has. Pick a colleague the channel cannot resolve
and the composer inserts a correct-looking `@Full Name `, the message posts, the
resolver finds no candidate, and there is no mention row, no notification, no
push and no badge. NOTHING TELLS THE SENDER — the name is not even bolded.

Both clients now narrow the page themselves. That closes the common case and
opens two more, and neither of them can be closed from the client:

  · THE LIMIT WAS TAKEN BEFORE THE CHANNEL WAS KNOWN. In an org where more than
    `limit` people match a two-letter query, a genuine member sorting past the
    cut never reached the client at all — and the client, with nothing left
    after its own filter, then says "Only people in this conversation can be
    mentioned". The same silence, reached from the other direction.
  · `full_name` IS NULLABLE in `public.users`. The resolver coalesces to `name`
    then `email` and matches such a person happily; the endpoint returned the
    bare column, so both pickers had a blank row to draw and both drop it.

The pool is mocked, so — exactly as `routers/messaging.py:30-41` warns at
length — nothing in this file proves the SQL RUNS. A mocked cursor resolves any
table name you hand it, and every read endpoint in this router once 500'd
against the real database with the whole suite green. What these tests prove is
that the candidate set, the display string and the access order are PRESENT and
PARAMETERISED, and that the router and the resolver still AGREE about who can be
mentioned — which is the half a refactor silently loses.
"""
import inspect
import re
from unittest.mock import AsyncMock

import pytest

import routers.messaging as messaging
import services.samvaad_mentions as mentions
from conftest import TEST_ORG_ID
from services.audit_actors import display_name

DIRECTORY = "/api/v1/messaging/directory"

CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
NAMELESS = "user_nameless01"

#: Any truthy row. `_assert_channel_access` only asks whether one came back.
MEMBER_ROW = {"?column?": 1}

#: The one expression that has to be identical on both sides. `_readable_by`
#: aliases it `display` and this endpoint aliases it `full_name`; the ALIAS is a
#: wire name and may differ, the EXPRESSION may not — it is what the composer
#: inserts after the `@` and what the resolver matches the inserted text
#: against, and those two disagreeing is the original Sanvaad mention bug.
#:
#: PINNED TO THE PROPERTY, NOT TO A SPELLING. This used to be the literal
#: `COALESCE(u.full_name, u.name, u.email)`, which made the leak the owner
#: banned on 2026-08-23 — a display ladder ending at an email address — a thing
#: the suite REQUIRED. Both sides now compose the ladder from the one module
#: that owns it, so this constant is whatever that module emits: the identity
#: the mention feature depends on is enforced by construction, and the separate
#: assertion below is that neither side reaches an email column.
DISPLAY = display_name("u")

#: The call, as it is written in both source files. The rendered constant above
#: cannot appear in either any more — they interpolate it — so the source-level
#: identity test matches on this.
DISPLAY_CALL = "display_name('u')"

_ROLE_CODES = re.compile(r"role_code IN \(([^)]*)\)")


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Skip `require_module('sanvaad')` — reach and the write-verb gate are
    tested in `test_module_write_level.py`, and leaving them on here would make
    every refusal below ambiguous between "not a member" and "no subscription".
    """
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


def _wire(mock_pool, *, channel=None, membership=None, rows=None):
    """Answer by SQL SHAPE, not by call order.

    `test_messaging_security.py` orders `fetchrow` side-effect LISTS to match a
    handler's exact sequence, and that costs a broken test for every query ever
    added anywhere in the handler. These tests assert what came back and what
    the query said, so they survive the router reordering its own round trips
    and fail only when behaviour changes.
    """
    if rows is None:
        rows = []

    async def _fetchrow(sql, *a):
        s = " ".join(str(sql).split())
        if "FROM staging.samvada_channels" in s:
            return channel
        if "samvada_channel_members" in s:
            return membership
        return None

    async def _fetch(sql, *a):
        return list(rows)

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)
    mock_pool.fetch = AsyncMock(side_effect=_fetch)
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


def _the_directory_query(mock_pool) -> tuple[str, list]:
    hits = [(s, a) for s, a in _queries(mock_pool) if "avatar_url" in s]
    assert hits, "no directory query was issued"
    return hits[-1]


def _code_of(fn) -> str:
    """Source with the docstring and the `#` comments removed.

    Both legitimately DISCUSS the thing being compared — `directory`'s docstring
    names `_readable_by`, quotes the coalesce and explains the role list — so a
    test that scans the raw source would assert against its own explanation.
    `test_prachar_audience._body` failed exactly this way on its first run.
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


def _norm(text: str) -> str:
    return " ".join(text.split())


# ── The parameter exists and is optional ─────────────────────────────────────

def test_the_directory_route_is_registered():
    """A crisp failure when it is absent, instead of mysterious 404s in every
    test below."""
    registered = {
        (r.path, verb)
        for r in messaging.router.routes
        for verb in getattr(r, "methods", set())
    }
    assert (DIRECTORY, "GET") in registered


def test_channel_id_is_optional_and_defaults_to_absent():
    """Web and mobile both call this endpoint with no `channel_id` today — the
    channel member picker and the DM picker are not resolving a mention and have
    no channel to scope to. A required parameter would 422 both of them."""
    params = inspect.signature(messaging.directory).parameters
    assert "channel_id" in params, "the endpoint cannot be scoped to a channel"
    assert params["channel_id"].default is None, (
        "channel_id must default to absent, or every existing caller 422s"
    )


# ── Without a channel_id nothing changes ─────────────────────────────────────

async def test_without_a_channel_id_the_directory_is_still_the_whole_org(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """The unscoped call is a live contract, not a legacy path: `ChannelList`
    opens a DM with it and `ChannelDetails` adds a member with it. Its query,
    its parameters and its column list are asserted whole, so a change to the
    scoped arm cannot quietly drag this one along with it."""
    _wire(mock_pool)
    r = await api_client.get(DIRECTORY, params={"q": "ke"})
    assert r.status_code == 200, r.text

    sql, args = _the_directory_query(mock_pool)
    assert "FROM staging.user_roles ur" in sql
    assert "samvada_channel_members" not in sql, (
        "the unscoped directory now joins the channel members table; it has no "
        "channel to scope to"
    )
    assert "u.full_name ILIKE $3" in sql, (
        "the unscoped arm no longer filters the bare column it always returned"
    )
    assert args == [TEST_ORG_ID, member_user["user_id"], "%ke%", 50]
    assert not [s for s, _ in _queries(mock_pool) if "samvada_channels" in s], (
        "an absent channel_id still cost a channel lookup on the picker's "
        "hottest read"
    )


# ── The scoped set is the resolver's universe ────────────────────────────────

async def test_a_private_channel_scopes_the_set_to_its_members(
    api_client, as_member, with_org_id, mock_pool
):
    """`_readable_by` returns the member rows AND NOTHING ELSE for a private
    channel. Offering the org here means offering names that resolve to nobody —
    a message that looks like it mentions somebody and notifies no one."""
    _wire(mock_pool, channel={"type": "private"}, membership=MEMBER_ROW)
    r = await api_client.get(
        DIRECTORY, params={"q": "ke", "channel_id": CHANNEL_ID}
    )
    assert r.status_code == 200, r.text

    sql, args = _the_directory_query(mock_pool)
    assert "FROM staging.samvada_channel_members cm" in sql
    assert "user_roles" not in sql, (
        "a private channel's picker is drawn from the org, which is the whole "
        "defect: the resolver will refuse every name that is not a member"
    )
    assert CHANNEL_ID in args, "the channel was never bound to the query"


async def test_a_dm_scopes_the_set_to_its_two_members(
    api_client, as_member, with_org_id, mock_pool
):
    """A DM is the case where the gap is widest — the resolver's universe is two
    people — and it is where the client's fallback note ("Only people in this
    conversation can be mentioned") is most often the only thing on screen."""
    _wire(mock_pool, channel={"type": "dm"}, membership=MEMBER_ROW)
    r = await api_client.get(DIRECTORY, params={"channel_id": CHANNEL_ID})
    assert r.status_code == 200, r.text

    sql, _ = _the_directory_query(mock_pool)
    assert "FROM staging.samvada_channel_members cm" in sql
    assert "user_roles" not in sql, "a DM's picker offers the whole org"


async def test_a_public_channel_scopes_to_its_members_union_the_org(
    api_client, as_member, with_org_id, mock_pool
):
    """Anyone in the org can open a public channel, so anyone can be mentioned
    into one — and `_readable_by` says so with a UNION over `user_roles`. Both
    arms, or somebody who has not joined the room is silently unmentionable in
    it."""
    _wire(mock_pool, channel={"type": "public"}, membership=MEMBER_ROW)
    r = await api_client.get(
        DIRECTORY, params={"q": "ke", "channel_id": CHANNEL_ID}
    )
    assert r.status_code == 200, r.text

    sql, args = _the_directory_query(mock_pool)
    assert "FROM staging.samvada_channel_members cm" in sql
    assert "FROM staging.user_roles ur" in sql
    assert re.search(r"\bUNION\b(?!\s+ALL)", sql), (
        "UNION ALL, or no union at all: a user holding two role rows in one org "
        "is offered twice"
    )
    assert CHANNEL_ID in args and TEST_ORG_ID in args


async def test_a_public_channel_the_caller_has_never_joined_still_answers(
    api_client, as_member, with_org_id, mock_pool
):
    """The picker opens in a public channel before anybody joins it — posting is
    what joins you. A 403 here would make the first message in every public
    channel unmentionable."""
    _wire(mock_pool, channel={"type": "public"}, membership=None)
    r = await api_client.get(DIRECTORY, params={"channel_id": CHANNEL_ID})
    assert r.status_code == 200, r.text


# ── The LIMIT can no longer cut a member ─────────────────────────────────────

async def test_the_search_runs_inside_the_scoped_set(
    api_client, as_member, with_org_id, mock_pool
):
    """THIS IS THE POINT OF THE PARAMETER. The old query matched and ordered
    across the org and then cut; a member who sorted past the cut was dropped by
    the server before the client could keep them, and the user was told only
    people in this conversation can be mentioned.

    So the candidate subquery carries no LIMIT of its own: the search and the
    cut are both taken over rows that have already been narrowed to this
    channel.
    """
    _wire(mock_pool, channel={"type": "private"}, membership=MEMBER_ROW)
    r = await api_client.get(
        DIRECTORY, params={"q": "ke", "channel_id": CHANNEL_ID, "limit": 6}
    )
    assert r.status_code == 200, r.text

    sql, args = _the_directory_query(mock_pool)
    upper = sql.upper()
    assert upper.count("LIMIT") == 1, (
        f"the candidate set has a LIMIT of its own, so the cut is taken before "
        f"the search — which is the defect, not the fix:\n{sql}"
    )
    assert upper.index("ILIKE") < upper.index("LIMIT"), (
        f"the LIMIT is applied ahead of the search:\n{sql}"
    )
    assert "%ke%" in args, "the search needle was not bound"
    assert 6 in args, "the caller's limit was not bound"


async def test_the_caller_is_never_offered_their_own_name(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """`_resolve._add` drops the actor, so your own name in your own message
    resolves to nobody. Offering it would spend a picker row on a mention that
    can never be recorded."""
    _wire(mock_pool, channel={"type": "private"}, membership=MEMBER_ROW)
    r = await api_client.get(DIRECTORY, params={"channel_id": CHANNEL_ID})
    assert r.status_code == 200, r.text

    sql, args = _the_directory_query(mock_pool)
    assert re.search(r"cand\.user_id <> \$\d+", sql), f"the caller is offered:\n{sql}"
    assert member_user["user_id"] in args


# ── The display string is the resolver's ─────────────────────────────────────

async def test_a_member_with_no_full_name_is_offered(
    api_client, as_member, with_org_id, mock_pool
):
    """`full_name` is nullable in `public.users`. The resolver coalesces to
    `name` and then to a stated label, so such a person IS mentionable — and both pickers drop
    a row whose `full_name` is blank, so they were never offered.

    The fix is on the wire and not in the clients: scoped, `full_name` carries
    the coalesced display, which is exactly the string the composer inserts and
    exactly the string the resolver matches it against.
    """
    row = {
        "user_id": NAMELESS,
        # What the ladder now yields for such a member. It used to be their
        # EMAIL — the leak, sitting in a fixture.
        "full_name": "Unnamed member",
        "avatar_url": None,
    }
    _wire(mock_pool, channel={"type": "private"}, membership=MEMBER_ROW, rows=[row])
    r = await api_client.get(
        DIRECTORY, params={"q": "name", "channel_id": CHANNEL_ID}
    )
    assert r.status_code == 200, r.text
    assert r.json() == [row], "the nameless member was dropped on the way out"

    sql, _ = _the_directory_query(mock_pool)
    assert DISPLAY in sql, (
        "the scoped query returns the bare `full_name` column, so a member with "
        "a NULL one is a blank row every picker throws away"
    )
    assert "u.full_name ILIKE" not in sql, (
        "the scoped search still filters the bare column, so that same member "
        "cannot be found by typing the name they are actually shown under"
    )
    assert re.search(r"cand\.full_name ILIKE \$\d+", sql), (
        "the search does not run over the display string the picker renders"
    )


def test_the_scoped_directory_offers_the_string_the_resolver_matches():
    """One expression, two files, and they must be identical.

    The composer inserts `@` plus what this endpoint returned; the resolver
    matches that literal text against `_readable_by`'s `display`. An inserter and
    a parser that disagree is the original Sanvaad mention bug, and it fails
    silently in both directions — no row, no badge, no push, no error.
    """
    resolver = _norm(_code_of(mentions._readable_by))
    picker = _norm(_code_of(messaging.directory))
    assert DISPLAY_CALL in resolver, (
        "_readable_by no longer composes its display string from "
        "audit_actors.display_name; the picker is now pinned to another spelling"
    )
    assert DISPLAY_CALL in picker, (
        "the channel-scoped directory does not return the display string the "
        "resolver will match, so a picked name can resolve to nobody"
    )
    # The owner's ruling, asserted as a property rather than as a spelling: a
    # display ladder never ends at a contact detail. Measured 2026-08-23, 0 of
    # 35 live accounts would ever have reached that rung, so this removes no
    # behaviour anybody has seen — it removes the possibility.
    for name, code in (("_readable_by", resolver), ("directory", picker)):
        assert "u.email" not in code.replace("u.user_id, u.email,", ""), (
            f"{name} names a person by their email address again"
        )


def test_the_public_arm_admits_the_same_org_roles_as_the_resolver():
    """`_readable_by`'s public arm and this endpoint's have to agree about which
    `role_code` rows count as being in the org. If the picker's list is wider it
    offers people the resolver refuses; if it is narrower it hides people who
    could have been mentioned."""
    resolver = set(_ROLE_CODES.findall(_norm(_code_of(mentions._readable_by))))
    picker = set(_ROLE_CODES.findall(_norm(_code_of(messaging.directory))))
    assert resolver, "_readable_by no longer filters on role_code at all"
    assert picker == resolver, (
        f"the directory admits {sorted(picker)} and the resolver admits "
        f"{sorted(resolver)}"
    )


# ── Access · the org-scoped 404 first, then the channel rule ─────────────────

async def test_a_channel_in_another_org_is_a_404_before_anything_else(
    api_client, as_member, with_org_id, mock_pool
):
    """The org-scoped 404 runs FIRST, the order `pin_message` and `add_reaction`
    document: a refusal that fires ahead of the org filter would let this test
    pass even if cross-tenant scoping were deleted."""
    _wire(mock_pool, channel=None)
    r = await api_client.get(DIRECTORY, params={"channel_id": CHANNEL_ID})
    assert r.status_code == 404

    lookups = [(s, a) for s, a in _queries(mock_pool) if "samvada_channels" in s]
    assert lookups, "the channel was never looked up"
    first, args = lookups[0]
    assert "org_id=$2::uuid" in first, (
        f"the first channel lookup is not org-scoped:\n{first}"
    )
    assert TEST_ORG_ID in args, "the caller's org was never bound"
    assert not [s for s, _ in _queries(mock_pool) if "avatar_url" in s], (
        "a channel this org cannot see still produced a directory page"
    )


async def test_a_non_member_of_a_private_channel_is_refused(
    api_client, as_member, with_org_id, mock_pool
):
    """Being in the org is not permission to read a private channel, and the
    member list of one is exactly what this returns. `_assert_channel_access` is
    the same rule `list_messages`, `list_members` and `list_pins` enforce; it is
    called rather than re-implemented off the row already in hand."""
    _wire(mock_pool, channel={"type": "private"}, membership=None)
    r = await api_client.get(DIRECTORY, params={"channel_id": CHANNEL_ID})
    assert r.status_code == 403
    assert "member" in r.json()["detail"].lower()
    assert not [s for s, _ in _queries(mock_pool) if "avatar_url" in s], (
        "the refusal came after the member list had already been read"
    )


async def test_a_malformed_channel_id_is_a_404_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    """`$1::uuid` on a string that is not one raises asyncpg's `DataError`, which
    surfaces as a 500 with a stack trace. The value comes off the query string,
    so it is caller-supplied and is checked before any statement runs."""
    _wire(mock_pool)
    r = await api_client.get(
        DIRECTORY, params={"channel_id": "not-a-uuid"}
    )
    assert r.status_code == 404
    assert not _queries(mock_pool), "a malformed id still reached the database"


async def test_a_blank_channel_id_is_refused_rather_than_silently_widened(
    api_client, as_member, with_org_id, mock_pool
):
    """`search_messages` ignores an unparseable `channel_id` and searches the
    whole org, and that is right there — it can only widen a result set to rows
    the caller may already read.

    Here it is not. A caller that sent the parameter is asking to be scoped, and
    answering with the whole org re-opens the exact silence the parameter closes:
    a private channel's picker full of people the resolver will refuse. So it is
    refused rather than quietly widened.
    """
    _wire(mock_pool)
    r = await api_client.get(DIRECTORY, params={"channel_id": ""})
    assert r.status_code == 404
    assert not [s for s, _ in _queries(mock_pool) if "avatar_url" in s], (
        "an empty channel_id fell through to the org-wide directory"
    )
