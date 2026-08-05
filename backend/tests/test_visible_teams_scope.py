"""An admin of no org is not an admin of every org.

`get_visible_team_ids` is the helper that decides which projects a user can see,
and through them which tasks, boards and time entries. It had a branch with NO
PREDICATE:

    if await is_org_admin(user_id):
        org_id = await admin_org_id(user_id)
        if org_id: ... WHERE org_id=$1 ...
        else:      SELECT team_id FROM teams WHERE deleted_at IS NULL   # <- every team

`is_org_admin(user_id)` answers True for PLATFORM roles as well as for
org_owner/org_admin, and with no org argument it answers globally.
`admin_org_id` then looks for an ORG-SCOPED admin row and returns None for a
platform account that has none. Its own docstring says the callers "treat as
unrestricted" — and this caller did.

MEASURED ON THE LIVE DATABASE: 7 of the 10 platform accounts hold a platform
role and no org-scoped admin row. All seven received every one of the 29 teams
across all 3 organisations, and through them 557 tasks. No header, no forged id
— an ordinary page load.

The fix fails closed by FALLING THROUGH to the ordinary membership query, which
is not "nothing": the vendor's own staff are members of Aekam Inc, so they keep
Aekam's teams. Only an account belonging to no org loses anything, and what it
loses is other companies' data.
"""
import pytest

import server


class _Pool:
    """Records every query issued so the test can assert on the predicate."""

    def __init__(self, rows=None):
        self.rows = rows if rows is not None else []
        self.queries = []

    async def fetch(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return self.rows


@pytest.fixture(autouse=True)
def _clear_cache():
    server._team_ids_request_cache.clear()
    yield
    server._team_ids_request_cache.clear()


def _roles(monkeypatch, *, is_admin, org):
    async def _is_org_admin(uid, org_id=None):
        return is_admin

    async def _admin_org_id(uid):
        return org

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)
    monkeypatch.setattr(server, "admin_org_id", _admin_org_id)


@pytest.mark.asyncio
async def test_a_platform_account_with_no_org_row_does_not_get_every_team(monkeypatch):
    """THE regression. This is the branch 7 of 10 live platform accounts took."""
    _roles(monkeypatch, is_admin=True, org=None)
    pool = _Pool([{"team_id": "team_ownmembership"}])

    await server.get_visible_team_ids(pool, "user_platform01")

    assert pool.queries, "no query was issued at all"
    sql, args = pool.queries[0]
    assert "user_id=$1" in sql, (
        "the query has no user predicate — this is the unrestricted branch, and it "
        f"returns every team in the database: {sql}"
    )
    assert "user_platform01" in args


@pytest.mark.asyncio
async def test_such_an_account_keeps_the_teams_its_own_memberships_give_it(monkeypatch):
    """
    Fail closed must not mean fail blank. Aekam's own staff are members of Aekam
    Inc, so they keep Aekam's teams — which is exactly what the owner says god
    mode should see.
    """
    _roles(monkeypatch, is_admin=True, org=None)
    pool = _Pool([{"team_id": "team_aekam001"}, {"team_id": "team_aekam002"}])

    got = await server.get_visible_team_ids(pool, "user_platform01")
    assert got == ["team_aekam001", "team_aekam002"]


@pytest.mark.asyncio
async def test_a_real_org_admin_still_sees_the_whole_of_their_own_org(monkeypatch):
    """The legitimate case. An org_admin of org A gets org A's teams — all of them."""
    _roles(monkeypatch, is_admin=True, org="org-a-uuid")
    pool = _Pool([{"team_id": "team_a1"}, {"team_id": "team_a2"}])

    got = await server.get_visible_team_ids(pool, "user_orgadmin1")
    assert got == ["team_a1", "team_a2"]

    sql, args = pool.queries[0]
    assert "org_id=$1::uuid" in sql, "an org admin's query lost its org predicate"
    assert args == ("org-a-uuid",)


@pytest.mark.asyncio
async def test_an_ordinary_member_is_unchanged(monkeypatch):
    _roles(monkeypatch, is_admin=False, org=None)
    pool = _Pool([{"team_id": "team_mine"}])

    assert await server.get_visible_team_ids(pool, "user_member01") == ["team_mine"]
    sql, _ = pool.queries[0]
    assert "user_id=$1" in sql


@pytest.mark.asyncio
async def test_no_branch_can_ever_issue_a_query_without_a_predicate(monkeypatch):
    """
    The property, rather than the three cases. Whatever the role combination,
    the SQL that decides visibility must be constrained by either the user or an
    org — never by nothing. A future branch that forgets fails here.
    """
    for is_admin, org in ((True, None), (True, "org-a-uuid"), (False, None), (False, "org-a-uuid")):
        server._team_ids_request_cache.clear()
        _roles(monkeypatch, is_admin=is_admin, org=org)
        pool = _Pool([])
        await server.get_visible_team_ids(pool, "user_x")
        for sql, _ in pool.queries:
            assert ("user_id=$1" in sql) or ("org_id=$1::uuid" in sql), (
                f"unconstrained visibility query for is_admin={is_admin} org={org}: {sql}"
            )
