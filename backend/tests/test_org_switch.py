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
    def __init__(self, rows):
        self._rows = rows
        self.sql = None
        self.args = None

    async def fetch(self, q, *a):
        self.sql = q
        self.args = a
        return self._rows


def _row(oid, name, role, granted):
    return {"id": oid, "name": name, "logo_url": None,
            "role_code": role, "granted_at": granted}


@pytest.fixture
def pool_of(monkeypatch):
    def _install(rows):
        pool = _Pool(rows)

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
