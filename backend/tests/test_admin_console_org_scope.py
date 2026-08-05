"""
Cross-org exposure through the platform console (`/api/admin/*`).

`GET /api/admin/users` was `SELECT … FROM users ORDER BY created_at DESC` — no
predicate of any kind — behind a Tier-1 role check, and the edit, role-change,
delete, reset-link and invite-revoke routes reached the same unbounded set by id.
Measured on the live database 2026-08-05: 20 user rows, all 10 platform accounts
able to read and write every one, while 9 of those accounts belong to Aekam Inc
alone.

The owner's specification: a platform account's entire cross-org surface is the
NUMBER of users under an org, inviting an org admin, and changing the org's
point-of-contact address. A member list is not on it, and god mode does not
widen it.

── WHY THE REAL WORK IS IN THE PURE-FUNCTION CLASS ──────────────────────────────

The suite mocks the pool, and a mocked cursor resolves whatever table name it is
handed. An HTTP test here can prove that a handler ASKED for something; it cannot
prove the answer was correct, because the answer is whatever the mock was told to
say. So the rule itself lives in `may_reach_user`, a pure function with no
database in the way, and that is where it is driven hard. The HTTP tests below
are deliberately narrow: they assert on the SQL TEXT the handler sends and on the
arguments bound to it — the one thing a mock can honestly witness.
"""

import pytest

from invite_router import may_reach_user
from middleware.role_tiers import GOD_MODE_ROLES, STAFF_ROLES


GOD = GOD_MODE_ROLES[0]
STAFF = STAFF_ROLES[0]

AEKAM = "045b76ad-654b-42dd-b4b1-731700efc6c3"
UNICODE = "fae87907-2f99-4b35-a241-c94d9e1e4a17"
E2E = "64e7bea6-6abe-490c-a2a4-27a60c6be916"

TARGET = "user_target001"


# ── The rule itself ──────────────────────────────────────────────────────────

class TestMayReachUser:
    """Every branch of the tenancy decision, with no pool in the way."""

    def test_a_shared_org_is_reachable(self):
        assert may_reach_user(frozenset({AEKAM}), frozenset({AEKAM})) is True

    def test_a_foreign_org_is_not_reachable(self):
        """The finding, reduced: Aekam staff must not reach a Unicode member."""
        assert may_reach_user(frozenset({AEKAM}), frozenset({UNICODE})) is False

    def test_the_test_org_is_not_reachable_either(self):
        assert may_reach_user(frozenset({AEKAM}), frozenset({E2E})) is False

    def test_one_org_in_common_is_enough(self):
        """The live account that legitimately belongs to all three orgs keeps
        reaching all three; it is not an all-or-nothing match."""
        assert may_reach_user(
            frozenset({AEKAM, UNICODE, E2E}), frozenset({UNICODE})
        ) is True

    def test_overlap_is_required_not_mere_multiplicity(self):
        """Holding many orgs does not help if none of them is the target's."""
        assert may_reach_user(frozenset({AEKAM, E2E}), frozenset({UNICODE})) is False

    def test_a_caller_with_no_org_reaches_no_org_member(self):
        """sid@aekaminc.com is a platform_admin belonging to no org. Under the
        specification that is not a bug to route around: god mode switches only
        between orgs it is part of."""
        assert may_reach_user(frozenset(), frozenset({AEKAM})) is False

    def test_a_target_belonging_to_nobody_is_reachable(self):
        """The deliberate decision, not an oversight — `create_invite` on this
        router mints org-less accounts, so the console must be able to see and
        remove what it creates. Documented at length on `may_reach_user`."""
        assert may_reach_user(frozenset({AEKAM}), frozenset()) is True

    def test_an_org_less_caller_still_reaches_an_org_less_target(self):
        assert may_reach_user(frozenset(), frozenset()) is True

    @pytest.mark.parametrize("caller,target", [
        (frozenset({AEKAM}), frozenset({UNICODE, E2E})),
        (frozenset({UNICODE}), frozenset({AEKAM})),
        (frozenset({E2E}), frozenset({AEKAM, UNICODE})),
    ])
    def test_no_pair_of_disjoint_org_sets_is_ever_reachable(self, caller, target):
        assert may_reach_user(caller, target) is False


# ── What the handlers ask the database for ───────────────────────────────────

@pytest.fixture
def as_platform(app, member_user, mock_pool):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


def _console_pool(mock_pool, caller_role, caller_orgs=(), captured=None):
    """Wire the mock so the caller holds `caller_role` and belongs to `caller_orgs`.

    `captured` collects (query, args) for the non-role queries so a test can
    assert on the SQL the handler actually sent.
    """
    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return caller_role if caller_role in allowed else None
        return None

    async def fetch(query, *args):
        if "org_id IS NOT NULL" in query and "DISTINCT" in query:
            return [{"org_id": o} for o in caller_orgs]
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return [{"role_code": caller_role}] if caller_role else []
        if captured is not None:
            captured.append((query, args))
        return []

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = fetch
    return mock_pool


async def test_list_users_is_no_longer_an_unfiltered_select(
    api_client, as_platform, mock_pool
):
    """The finding itself. The handler must send a predicate, and must bind the
    caller's own orgs to it rather than a constant."""
    captured = []
    _console_pool(mock_pool, GOD, caller_orgs=(AEKAM,), captured=captured)

    r = await api_client.get("/api/admin/users")
    assert r.status_code == 200, r.text

    user_queries = [(q, a) for q, a in captured if "FROM users" in q]
    assert user_queries, "list_users never queried users"
    query, args = user_queries[0]

    # Comments are stripped before matching. This repo has shipped checks that
    # were satisfied by their own explanatory prose; a docstring mentioning
    # `staging.user_roles` must not be able to pass a test about the SQL.
    sql = "\n".join(
        line for line in query.splitlines() if not line.strip().startswith("--")
    )
    assert "staging.user_roles" in sql, "no join to the tenant path"
    assert "org_id = ANY" in sql, "the caller's orgs are not bound into the query"
    assert [AEKAM] in [list(a) if isinstance(a, (list, tuple)) else a for a in args], (
        "the caller's own orgs were not passed as a parameter"
    )


async def test_list_users_binds_an_empty_org_set_for_an_org_less_caller(
    api_client, as_platform, mock_pool
):
    """An org-less platform account must not fall back to 'everything'."""
    captured = []
    _console_pool(mock_pool, GOD, caller_orgs=(), captured=captured)

    r = await api_client.get("/api/admin/users")
    assert r.status_code == 200, r.text

    query, args = next((q, a) for q, a in captured if "FROM users" in q)
    assert [] in [list(a) if isinstance(a, (list, tuple)) else a for a in args], (
        "an org-less caller did not bind an empty org array"
    )


async def test_the_invite_listing_is_scoped_to_the_callers_orgs(
    api_client, as_platform, mock_pool
):
    """20 of the 35 live invite rows belong to the other two orgs, 7 of them
    still-live pending invitations. Who an org is hiring is org data."""
    captured = []
    _console_pool(mock_pool, GOD, caller_orgs=(AEKAM,), captured=captured)

    r = await api_client.get("/api/admin/invites")
    assert r.status_code == 200, r.text

    query, args = next((q, a) for q, a in captured if "FROM invites" in q)
    sql = "\n".join(
        line for line in query.splitlines() if not line.strip().startswith("--")
    )
    assert "org_id" in sql, "the invite listing is still unscoped"
    assert "ANY" in sql


async def test_the_team_folder_map_is_scoped(api_client, as_platform, mock_pool):
    """Project names are org data — 3 of the 27 live projects are not Aekam's."""
    captured = []
    _console_pool(mock_pool, STAFF, caller_orgs=(AEKAM,), captured=captured)

    r = await api_client.get("/api/admin/teams")
    assert r.status_code == 200, r.text

    query, args = next((q, a) for q, a in captured if "FROM teams" in q)
    assert "org_id" in query, "the team map is still unscoped"


async def test_only_god_mode_is_offered_the_unattributed_teams(
    api_client, as_platform, mock_pool
):
    """Two live teams have a NULL org_id and cannot be attributed to anyone.
    They go to the operator who can fix the backfill, and to nobody else."""
    for role, expected in ((STAFF, False), (GOD, True)):
        captured = []
        _console_pool(mock_pool, role, caller_orgs=(AEKAM,), captured=captured)
        r = await api_client.get("/api/admin/teams")
        assert r.status_code == 200, r.text
        _, args = next((q, a) for q, a in captured if "FROM teams" in q)
        assert expected in args, (
            f"{role} was passed include_unattributed={not expected}"
        )


# ── The write paths ──────────────────────────────────────────────────────────
#
# A read leak is bad; a platform account editing or deleting another org's user
# is worse, and every one of these routes reached its target by raw id with no
# tenancy question asked. These prove the guard is WIRED INTO each handler —
# `may_reach_user` being correct is worth nothing on a route that never calls it.


def _two_org_pool(mock_pool, caller_role, caller_user_id, caller_orgs, target_orgs):
    """Caller and TARGET in different organisations."""
    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return caller_role if caller_role in allowed else None
        return None

    async def fetch(query, *args):
        if "org_id IS NOT NULL" in query and "DISTINCT" in query:
            orgs = target_orgs if args[0] == TARGET else caller_orgs
            return [{"org_id": o} for o in orgs]
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            # Nobody here holds a platform role except the caller, so the
            # SENIORITY guard cannot be what produces the refusal.
            return [{"role_code": caller_role}] if args[0] == caller_user_id else []
        return []

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = fetch
    return mock_pool


@pytest.mark.parametrize("method,path,body", [
    ("patch",  f"/api/admin/users/{TARGET}",                  {"full_name": "Renamed"}),
    ("put",    f"/api/admin/users/{TARGET}/role",             {"role": "member"}),
    ("delete", f"/api/admin/users/{TARGET}",                  None),
    ("post",   f"/api/admin/users/{TARGET}/send-reset-link",  None),
])
async def test_god_mode_cannot_write_to_a_user_in_another_org(
    api_client, as_platform, mock_pool, member_user, method, path, body
):
    """God mode is used deliberately: the specification says god mode does not
    widen the cross-org surface, so the strongest role on the platform must be
    refused here exactly like the weakest."""
    _two_org_pool(mock_pool, GOD, member_user["user_id"],
                  caller_orgs=(AEKAM,), target_orgs=(UNICODE,))

    r = await getattr(api_client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 404, (
        f"{method.upper()} {path} reached a user in another org: {r.status_code} {r.text}"
    )

    # ── The status code alone is NOT enough, and this is not belt-and-braces ──
    #
    # Two of these four routes end in `fetchrow(...) or raise 404 "User not
    # found"`, and a mocked pool whose `fetchrow` was never given a value
    # produces that 404 by itself. Asserting only on 404 therefore passed with
    # the tenancy guard DISCONNECTED — measured, by disconnecting it — which
    # would have shipped two routes believed to be covered and not covered at
    # all. So the assertion is pinned to the refusal this guard actually emits.
    detail = r.json().get("detail", "")
    assert detail.endswith("no such user."), (
        f"{method.upper()} {path} returned 404 for an unrelated reason "
        f"({detail!r}) — the org guard is not what refused it"
    )

    # And nothing may have been written before the refusal. `send-reset-link`
    # overwrites a live password-reset token; a guard that fires after the
    # UPDATE has already done the damage it exists to prevent.
    assert not mock_pool.execute.await_count, (
        f"{method.upper()} {path} issued a write before refusing"
    )

    # The refusal must not confirm that the id exists or name the other org —
    # otherwise every write route becomes a membership oracle.
    assert UNICODE not in detail and "organis" not in detail.lower()


@pytest.mark.parametrize("method,path,body", [
    ("patch",  f"/api/admin/users/{TARGET}",                  {"full_name": "Renamed"}),
    ("put",    f"/api/admin/users/{TARGET}/role",             {"role": "member"}),
    ("delete", f"/api/admin/users/{TARGET}",                  None),
    ("post",   f"/api/admin/users/{TARGET}/send-reset-link",  None),
])
async def test_the_same_writes_still_work_inside_the_callers_own_org(
    api_client, as_platform, mock_pool, member_user, method, path, body
):
    """The ceiling must not become a wall — the console still has to work."""
    _two_org_pool(mock_pool, GOD, member_user["user_id"],
                  caller_orgs=(AEKAM,), target_orgs=(AEKAM,))
    mock_pool.fetchrow.return_value = {
        "user_id": TARGET, "role": "member", "name": "T", "email": "t@test.com",
        "full_name": None, "position": None, "company_name": None,
        "member_role": None, "receives_approval_emails": True, "avatar": None,
        "created_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc),
    }
    r = await getattr(api_client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 200, f"{method.upper()} {path} broke in-org: {r.text}"


async def test_work_cannot_be_reassigned_to_a_user_in_another_org(
    api_client, as_platform, mock_pool, member_user
):
    """`reassign_to` REWRITES authorship across tasks, approvals, time entries
    and automations. Unscoped, it moves one org's work under another org's
    person — a cross-tenant WRITE through a parameter that reads like a tidy-up.
    Here the deletion target is legitimately in-org; only the recipient is not.
    """
    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return GOD if GOD in allowed else None
        return None

    async def fetch(query, *args):
        if "org_id IS NOT NULL" in query and "DISTINCT" in query:
            return [{"org_id": UNICODE if args[0] == "user_outsider" else AEKAM}]
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return [{"role_code": GOD}] if args[0] == member_user["user_id"] else []
        return []

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = fetch

    r = await api_client.delete(
        f"/api/admin/users/{TARGET}?reassign_to=user_outsider"
    )
    assert r.status_code == 404, (
        f"work was reassignable across orgs: {r.status_code} {r.text}"
    )
    # Pinned to THIS guard's wording for the same measured reason as the test
    # above: with the guard removed, the unconfigured `fetchrow` below it
    # produces its own 404 ("Reassign target user not found") and a test that
    # checked only the status code went on passing.
    detail = r.json().get("detail", "")
    assert detail.startswith("Reassigning to"), (
        f"404 came from an unrelated path ({detail!r}), not the org guard"
    )
    assert not mock_pool.execute.await_count, "rows were rewritten before refusing"


async def test_an_invite_belonging_to_another_org_cannot_be_revoked(
    api_client, as_platform, mock_pool
):
    """7 live pending invitations belong to orgs that are not Aekam's. Revoking
    one means somebody's new hire clicks a dead link and nothing says why."""
    captured = []
    _console_pool(mock_pool, GOD, caller_orgs=(AEKAM,), captured=captured)

    seen = {}

    async def execute(query, *args):
        seen["query"] = query
        seen["args"] = args
        return "DELETE 0"          # the row was out of scope

    mock_pool.execute.side_effect = execute

    r = await api_client.delete("/api/admin/invites/inv_someoneelses")
    assert r.status_code == 404, r.text
    assert "org_id" in seen["query"], "revoke_invite is still unscoped"
    assert [AEKAM] in [
        list(a) if isinstance(a, (list, tuple)) else a for a in seen["args"]
    ]
