"""The organisations a user may switch between.

Before this, the product had no org switcher at all. `org_resolver.get_org_id`
reads `X-Org-Id` first and validates it, but the only caller that ever sent one
was the admin console. Everyone else fell through to

    ORDER BY granted_at LIMIT 1

— the OLDEST grant, always — so a member of two organisations could reach only
the first they were added to, and a grant added later was unreachable no matter
what they did. Measured on staging: an account with grants dated 16 Jul, 28 Jul
and 3 Aug could see only the July one.

That is not a demo inconvenience. A firm with two entities — a practice and a
consultancy arm, the ordinary shape of the customers this is built for — could
not see the second.

These pin the two properties that make the switcher safe rather than merely
present: it lists ONLY the caller's own memberships, and it lists each
organisation once.
"""
import pytest

import routers.org_switch as org_switch


class _Pool:
    """The membership query, plus the scalars `count_seats` and the support
    guard issue.

    `fetchval` is dispatched on the SQL text rather than on call order —
    `count_seats` fires three of them per org and `to_regclass` one more, so a
    positional stub would silently re-order the moment either helper changes.
    `test_cross_org_console_surface.py` uses the same shape.
    """

    def __init__(self, rows, *, seat_limit=None, joined=0, pending=0,
                 support_table=None, support_rows=None):
        self._rows = rows
        self._seat_limit = seat_limit
        self._joined = joined
        self._pending = pending
        self._support_table = support_table
        self._support_rows = support_rows or []
        self.sql = None
        self.args = None
        self.seat_calls = 0

    async def fetch(self, q, *a):
        if "platform_support_sessions" in q:
            return self._support_rows
        self.sql = q
        self.args = a
        return self._rows

    async def fetchval(self, q, *a):
        if "to_regclass" in q:
            return self._support_table
        if "COALESCE(o.max_users" in q:
            self.seat_calls += 1
            return self._seat_limit
        if "COUNT(DISTINCT user_id)" in q:
            return self._joined
        if "FROM invites" in q:
            return self._pending
        raise AssertionError(f"unstubbed fetchval: {q[:80]}")


def _row(oid, name, role, granted):
    return {"id": oid, "name": name, "logo_url": None,
            "role_code": role, "granted_at": granted}


@pytest.fixture
def pool_of(monkeypatch):
    def _install(rows, **kw):
        pool = _Pool(rows, **kw)

        async def _get_pool():
            return pool

        monkeypatch.setattr(org_switch, "get_pool", _get_pool)
        return pool

    return _install


@pytest.mark.asyncio
async def test_it_lists_every_org_the_user_belongs_to(pool_of):
    pool_of([
        _row("11111111-1111-1111-1111-111111111111", "Aekam Inc", "org_admin", 1),
        _row("22222222-2222-2222-2222-222222222222", "QA Test Corp", "org_admin", 2),
        _row("33333333-3333-3333-3333-333333333333", "E2E Test", "org_admin", 3),
    ])
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})

    assert [o["name"] for o in out["data"]] == ["Aekam Inc", "QA Test Corp", "E2E Test"]
    # The newest grant — the one that was previously unreachable — is offered.
    assert "E2E Test" in [o["name"] for o in out["data"]]


@pytest.mark.asyncio
async def test_the_default_is_what_the_resolver_would_have_picked(pool_of):
    """Ordered by granted_at, so the first entry is the org a caller that sends
    no header resolves to. The control tells the truth before anyone touches
    it."""
    pool_of([
        _row("11111111-1111-1111-1111-111111111111", "Aekam Inc", "org_owner", 1),
        _row("22222222-2222-2222-2222-222222222222", "QA Test Corp", "org_admin", 2),
    ])
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert out["default_id"] == "11111111-1111-1111-1111-111111111111"


@pytest.mark.asyncio
async def test_an_org_held_under_two_roles_is_listed_once(pool_of):
    """A user can hold several grants in one org. The switcher lists
    ORGANISATIONS; a duplicate entry reads as two companies with one name."""
    same = "11111111-1111-1111-1111-111111111111"
    pool_of([
        _row(same, "Aekam Inc", "org_owner", 1),
        _row(same, "Aekam Inc", "org_admin", 2),
    ])
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert len(out["data"]) == 1


@pytest.mark.asyncio
async def test_it_never_offers_an_org_the_user_is_not_a_member_of(pool_of):
    """Platform staff CAN resolve to any org through the header — that is the
    admin console's job and it is audited. This list is memberships only. A
    switcher that offered every tenant on the platform would be a different
    feature with a different risk."""
    pool = pool_of([])
    await org_switch.list_memberships(user={"user_id": "user_abc"})

    assert "ur.user_id = $1" in pool.sql, "the query is not scoped to the caller"
    assert "ur.org_id IS NOT NULL" in pool.sql, "platform-wide rows would leak in"
    assert pool.args[0] == "user_abc"


@pytest.mark.asyncio
async def test_only_active_organisations_are_offered(pool_of):
    """`org_resolver` answers 404 for an inactive org, so offering one would be
    a menu entry that cannot be chosen."""
    pool = pool_of([])
    await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert "o.is_active = TRUE" in pool.sql


@pytest.mark.asyncio
async def test_the_membership_roles_match_what_the_resolver_accepts(pool_of):
    """A list and a gate that disagree is a dead menu item: an org the switcher
    offers and the resolver then refuses."""
    from middleware.org_resolver import get_org_id  # noqa: F401  (import guard)
    import inspect
    from middleware import org_resolver

    resolver_sql = inspect.getsource(org_resolver)
    for role in org_switch.MEMBER_ROLES:
        assert role in resolver_sql, \
            f"the switcher offers {role} but org_resolver does not accept it"


@pytest.mark.asyncio
async def test_a_user_with_no_org_gets_an_empty_list_not_an_error(pool_of):
    """`org_resolver` already answers 403 with a usable message. The switcher
    simply has nothing to show, and the component renders nothing."""
    pool_of([])
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert out["data"] == []
    assert out["default_id"] is None


# ── Seats ───────────────────────────────────────────────────────────────────
#
# `organisations.max_users` is enforced and typed in by hand per org, so an org
# can sit at its ceiling with nothing on screen saying so until somebody fails
# to add an employee. These pin the three shapes the row has to render, and the
# one that would be a lie.

@pytest.mark.asyncio
async def test_a_capped_org_reports_used_and_limit(pool_of):
    pool_of(
        [_row("11111111-1111-1111-1111-111111111111", "Unicode Group", "org_owner", 1)],
        seat_limit=15, joined=5, pending=0,
    )
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    org = out["data"][0]
    assert (org["seats_used"], org["seats_limit"], org["seats_full"]) == (5, 15, False)


@pytest.mark.asyncio
async def test_a_pending_invite_holds_a_seat(pool_of):
    """The count MUST be the one the refusal uses. `count_seats.used` is
    joined + pending, so an org with 6 joined and 7 invited is at 13 — a second
    counter here that forgot the invites would print "6 of 15" on a row the API
    refuses at 13."""
    pool_of(
        [_row("22222222-2222-2222-2222-222222222222", "E2E Test", "org_admin", 1)],
        seat_limit=13, joined=6, pending=7,
    )
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert out["data"][0]["seats_used"] == 13
    assert out["data"][0]["seats_full"] is True


@pytest.mark.asyncio
async def test_no_cap_is_unlimited_not_zero(pool_of):
    """Six of seven rows in `staging.plans` have max_users NULL and two of the
    three live orgs have no cap at all. Collapsing NULL to 0 would render
    "9 of 0 seats" on the ordinary case; the client renders the role alone."""
    pool_of(
        [_row("33333333-3333-3333-3333-333333333333", "Aekam Inc", "org_owner", 1)],
        seat_limit=None, joined=9, pending=0,
    )
    org = (await org_switch.list_memberships(user={"user_id": "user_abc"}))["data"][0]
    assert org["seats_limit"] is None
    assert org["seats_full"] is False


@pytest.mark.asyncio
async def test_a_seat_count_that_fails_does_not_take_the_list_down(pool_of):
    """The switcher is on every page. A seat number is a nicety; the list of
    organisations a person may act as is not."""
    pool = pool_of([_row("44444444-4444-4444-4444-444444444444", "Aekam Inc", "org_owner", 1)])

    async def _boom(*a, **k):
        raise RuntimeError("subscriptions unreachable")

    import routers.org_invites as org_invites
    orig = org_invites.count_seats
    org_invites.count_seats = _boom
    try:
        out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    finally:
        org_invites.count_seats = orig
    assert len(out["data"]) == 1
    assert out["data"][0]["seats_limit"] is None
    assert pool.sql is not None


@pytest.mark.asyncio
async def test_the_strongest_role_names_the_row(pool_of):
    """"Member" printed under an owner reads as a demotion. Grants arrive in
    granted_at order, so first-wins would print whichever was added earliest."""
    same = "11111111-1111-1111-1111-111111111111"
    pool_of([
        _row(same, "Aekam Inc", "org_member", 1),
        _row(same, "Aekam Inc", "org_owner", 2),
    ])
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert out["data"][0]["role"] == "org_owner"


# ── Support sessions ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_support_is_empty_when_the_table_does_not_exist(pool_of):
    """`SELECT to_regclass('staging.platform_support_sessions')` returns NULL on
    the live database, measured 2026-08-06 — the DDL is unapplied. "No approved
    sessions" is the correct answer for every user today and it must be
    indistinguishable from a table that exists and is empty."""
    pool_of([_row("1" * 8 + "-1111-1111-1111-111111111111", "Aekam Inc", "org_owner", 1)],
            support_table=None)
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert out["support"] == []


@pytest.mark.asyncio
async def test_the_column_names_are_the_ones_migration_111_declares(pool_of):
    """`tests/test_migrations_111_115.py::PSS_COLUMNS` is the hand-written
    shape of `staging.platform_support_sessions`, and this query has to read
    THAT table rather than a plausible one. `ref` not `request_ref`,
    `requested_by` not `user_id`, `approved_*` not `granted_*` — every one of
    those would be a 42703 at runtime the first time the table exists, in a
    router, with nothing here to catch it."""
    import inspect
    src = inspect.getsource(org_switch._support_sessions)
    for col in ("s.ref", "s.requested_by", "s.approved_at", "s.approved_by",
                "s.denied_at", "s.revoked_at", "s.expires_at"):
        assert col in src, f"{col} is not what the query selects or filters on"
    for wrong in ("s.request_ref", "s.granted_at", "s.granted_by", "s.user_id"):
        assert wrong not in src, f"{wrong} is not a column on that table"


@pytest.mark.asyncio
async def test_an_approved_session_is_listed_with_its_request_and_expiry(pool_of):
    import datetime as _dt
    ends = _dt.datetime(2026, 8, 6, 18, 30, tzinfo=_dt.timezone.utc)
    pool_of(
        [_row("11111111-1111-1111-1111-111111111111", "Aekam Inc", "org_owner", 1)],
        support_table="staging.platform_support_sessions",
        support_rows=[{
            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "org_id": "99999999-9999-9999-9999-999999999999",
            "org_name": "Vardhman Traders",
            "ref": "SR-2418",
            "expires_at": ends,
            "approved_by_name": "R. Iyer",
        }],
    )
    out = await org_switch.list_memberships(user={"user_id": "user_abc"})
    assert out["support"] == [{
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "org_id": "99999999-9999-9999-9999-999999999999",
        "name": "Vardhman Traders",
        "ref": "SR-2418",
        "approved_by": "R. Iyer",
        "expires_at": ends.isoformat(),
    }]


@pytest.mark.asyncio
async def test_an_unapproved_or_expired_session_is_not_offered(pool_of):
    """Appearing in this list is what makes an org look reachable. A requested
    session is not an approved one, and an expired session must disappear
    rather than silently keep working."""
    pool_of([], support_table="staging.platform_support_sessions")
    await org_switch.list_memberships(user={"user_id": "user_abc"})
    import inspect
    src = inspect.getsource(org_switch._support_sessions)
    assert "s.approved_at IS NOT NULL" in src
    assert "s.denied_at IS NULL" in src
    assert "s.revoked_at IS NULL" in src
    # NOT a bare `> NOW()`. `granted_ttl_hours = 0` is "until revoked" and is
    # the only value that leaves an approved row with a NULL expiry; a bare
    # comparison drops exactly the open-ended sessions.
    assert "(s.expires_at IS NULL OR s.expires_at > NOW())" in src
    assert "s.requested_by = $1" in src, "the session list is not scoped to the caller"
