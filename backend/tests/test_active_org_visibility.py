"""Switching organisation must change the data, including for god mode.

THE DEFECT, as the owner hit it: they hold `org_admin` in Aekam Inc, Unicode
Group and E2E Test & Associates, plus `platform_admin`. They pick E2E Test in
the org switcher and the Projects page shows Aekam Inc's projects.

Three separate mechanisms produced that one screenshot, and each gets its own
test below because each can regress on its own:

  (a) `middleware/roles.admin_org_id` ran
        SELECT org_id … role_code IN ('org_owner','org_admin') LIMIT 1
      with NO ORDER BY and NO org argument. One row out of three, chosen by
      planner luck, for a user who is an admin of all three.

  (b) `server.get_visible_team_ids` had no `org_id` parameter at all, so the
      validated `X-Org-Id` could not reach it even in principle. Its
      fall-through branch UNIONs `project_assignments`, `team_members` and
      `user_roles` constrained BY USER ONLY — a member of two orgs got the
      union of both orgs' teams on every page load.

  (d) `auth_router._module_grants` / `_module_levels` read `org_roles[0]`, the
      earliest-joined org, while `_org_for` two lines later resolved the header
      org for the badge. The breadcrumb changed; the module rail did not.

The settled rule these all violate: THE ACTIVE ORG WINS. Not the home org, not
the union, and god mode is not an exception —
`middleware/subscription.py:333` quotes the spec as "no one should be able to
see any other org data even god mode users".
"""
import inspect
from datetime import datetime, timezone

import pytest

import server

_NOW = datetime.now(timezone.utc)


# ── A world with two organisations ───────────────────────────────────────────
#
# Deliberately NOT constants inside each test: the point of every assertion
# below is that the answer differs between ORG_A and ORG_B, which is only
# meaningful if both orgs really do hold different teams.

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # "Aekam Inc"  — joined first
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # "E2E Test"   — joined second

TEAMS = {
    ORG_A: ["team_a1", "team_a2"],
    ORG_B: ["team_b1"],
}

#: user_id -> {org_id: role_code}, ordered as `granted_at` orders it.
ROLES = {
    # The owner. org_admin in BOTH — this is the shape that made (a) fire.
    "user_owner": {ORG_A: "org_admin", ORG_B: "org_admin"},
    # An ordinary member of two orgs — the shape that made (b) fire.
    "user_member": {ORG_A: "org_member", ORG_B: "org_member"},
    # Belongs to B only. The control: nothing here may ever hand them org A.
    "user_bonly": {ORG_B: "org_member"},
}

#: Teams with `org_id IS NULL` — 2 of the 29 on the live database. They belong
#: to no tenant, so they cannot leak one, and they are reachable ONLY by a
#: direct membership row (the `user_roles` leg joins on org_id, which never
#: matches NULL).
ORPHAN_TEAMS = ["team_orphan"]

#: Direct project/team membership rows, which carry no org_id of their own.
MEMBERSHIPS = {
    "user_member": ["team_a1", "team_b1", "team_orphan"],
    "user_bonly": ["team_b1"],
}


def _org_of(team_id):
    for org, teams in TEAMS.items():
        if team_id in teams:
            return org
    return None


class RecordingPool:
    """A pool that answers like the real SQL does — and records every query.

    Modelled on the actual statements rather than on the desired answer, so a
    fix that only changes the Python and leaves the SQL unconstrained still
    fails: `_answer` gives back the union across orgs unless the org reached
    the query as a bind parameter.
    """

    def __init__(self):
        self.queries = []

    def _answer(self, sql, args):
        org = next((a for a in args if a in TEAMS), None)
        uid = next((a for a in args if a in ROLES), None)

        if uid is None:
            # No user predicate at all — the "every team in the org" statement
            # an org admin gets, or, with no org either, the unconstrained
            # `SELECT team_id FROM teams` that returned all 29 live teams to
            # 7 of 10 platform accounts.
            return sorted(TEAMS[org]) if org else sorted(
                t for ts in TEAMS.values() for t in ts)

        reach = set(MEMBERSHIPS.get(uid, []))
        # The `user_roles` leg: every team of every org this user holds a role
        # in. This is the leg that returned Aekam's 24 teams inside E2E Test.
        for held_org in ROLES.get(uid, {}):
            reach |= set(TEAMS[held_org])
        if org is not None:
            # An org bind parameter is the ONLY thing that narrows it. Orphan
            # teams survive it only where the statement says `org_id IS NULL`
            # AND the user holds a direct membership row.
            keep = set(TEAMS[org])
            if "org_id IS NULL" in sql:
                keep |= set(ORPHAN_TEAMS) & set(MEMBERSHIPS.get(uid, []))
            reach &= keep
        return sorted(reach)

    async def fetch(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "team_id" not in flat:
            return []
        if "archived_at" in flat:
            return []
        return [{"team_id": t} for t in self._answer(flat, args)]

    async def fetchval(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "user_roles" in flat and "org_id" in flat:
            uid = next((a for a in args if a in ROLES), None)
            held = list(ROLES.get(uid, {}))
            return held[0] if held else None
        return None

    def team_queries(self):
        return [(s, a) for s, a in self.queries if "team_id" in s]


def _install_roles(monkeypatch):
    """Role helpers backed by ROLES, honouring an org argument when given."""

    async def _is_org_admin(uid, org_id=None):
        held = ROLES.get(uid, {})
        if org_id:
            return held.get(org_id) in ("org_owner", "org_admin")
        return any(r in ("org_owner", "org_admin") for r in held.values())

    async def _admin_org_id(uid, org_id=None):
        held = ROLES.get(uid, {})
        if org_id:
            return org_id if held.get(org_id) in ("org_owner", "org_admin") else None
        for org, role in held.items():
            if role in ("org_owner", "org_admin"):
                return org
        return None

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)
    monkeypatch.setattr(server, "admin_org_id", _admin_org_id)


@pytest.fixture(autouse=True)
def _clear_cache():
    server._team_ids_request_cache.clear()
    yield
    server._team_ids_request_cache.clear()


# ── 1. The active org wins, for god mode too ─────────────────────────────────

@pytest.mark.asyncio
async def test_org_admin_of_two_orgs_gets_the_org_the_header_named(monkeypatch):
    """The owner's screenshot, as an assertion.

    org_admin in A and B, `X-Org-Id: B` — the answer is B's team, and nothing
    of A's. Before the fix `get_visible_team_ids` had no `org_id` parameter, so
    this raised TypeError; the caller could not have expressed the question.
    """
    _install_roles(monkeypatch)
    pool = RecordingPool()

    got = await server.get_visible_team_ids(pool, "user_owner", org_id=ORG_B)

    assert sorted(got) == ["team_b1"], (
        f"switched to E2E Test and got {sorted(got)} — Aekam Inc's teams are "
        "team_a1/team_a2, and an org switcher that does not change the data is "
        "pointless"
    )


@pytest.mark.asyncio
async def test_an_ordinary_member_of_two_orgs_does_not_get_the_union(monkeypatch):
    """Defect (b): the fall-through branch was constrained by USER ONLY."""
    _install_roles(monkeypatch)
    pool = RecordingPool()

    got = await server.get_visible_team_ids(pool, "user_member", org_id=ORG_B)

    # Org A's teams, specifically. `team_orphan` belongs to no org and has its
    # own test below; the claim here is about the other TENANT's data.
    assert not (set(got) & set(TEAMS[ORG_A])), (
        f"member of two orgs got {sorted(got)} while scoped to org B, which "
        f"includes org A's {sorted(set(got) & set(TEAMS[ORG_A]))} — the UNION "
        "of project_assignments + team_members + user_roles is not a tenancy "
        "predicate"
    )
    assert "team_b1" in got


@pytest.mark.asyncio
async def test_switching_back_gives_the_first_org_again(monkeypatch):
    """The switch has to work in both directions, or it is just a different pin."""
    _install_roles(monkeypatch)
    pool = RecordingPool()

    assert sorted(await server.get_visible_team_ids(
        pool, "user_owner", org_id=ORG_A)) == ["team_a1", "team_a2"]


# ── 2. The request cache must not leak one org's answer into another ─────────

@pytest.mark.asyncio
async def test_request_cache_is_keyed_on_the_org(monkeypatch):
    """`_team_ids_request_cache` is keyed on the asyncio task id.

    Both calls below run in ONE task, which is exactly what a request is. If
    the org is missing from the key the first caller decides the answer for
    every later one — and a request that resolves org B after something else
    already resolved org A would serve A's teams under B's badge, from cache,
    with no query issued at all.
    """
    _install_roles(monkeypatch)
    pool = RecordingPool()

    first = await server.get_visible_team_ids(pool, "user_owner", org_id=ORG_A)
    second = await server.get_visible_team_ids(pool, "user_owner", org_id=ORG_B)

    assert sorted(first) == ["team_a1", "team_a2"]
    assert sorted(second) == ["team_b1"], (
        f"second call in the same request returned {sorted(second)} — the "
        "cache key is missing the org, so org A's answer was served for org B"
    )
    assert any(ORG_B in q[1] for q in pool.team_queries()), (
        "the org B call issued no query carrying org B: it was served entirely "
        "from a cache entry keyed without the org"
    )


@pytest.mark.asyncio
async def test_the_cache_still_saves_a_query_within_one_org(monkeypatch):
    """Keying on the org must not mean keying on nothing.

    The cache exists because a page load asks this question many times. Adding
    the org to the key is only correct if repeats within ONE org still hit.
    """
    _install_roles(monkeypatch)
    pool = RecordingPool()

    await server.get_visible_team_ids(pool, "user_owner", org_id=ORG_A)
    issued = len(pool.queries)
    await server.get_visible_team_ids(pool, "user_owner", org_id=ORG_A)

    assert len(pool.queries) == issued, "the second identical call re-queried"


# ── 3. The property: no branch may return a team outside the resolved org ────

@pytest.mark.asyncio
async def test_no_branch_returns_a_team_outside_the_resolved_org(monkeypatch):
    """Every user shape, every org, every branch — one rule.

    Stated as a property rather than as three cases, because the branch that
    leaked was the fall-through nobody was looking at. A future branch that
    forgets the predicate fails here without anyone having to think of it.
    """
    _install_roles(monkeypatch)

    for uid in ROLES:
        for org in (ORG_A, ORG_B):
            server._team_ids_request_cache.clear()
            pool = RecordingPool()
            got = await server.get_visible_team_ids(pool, uid, org_id=org)

            strays = [t for t in got
                      if _org_of(t) != org and t not in ORPHAN_TEAMS]
            assert not strays, (
                f"{uid} scoped to {org} received {strays}, which belong to "
                f"{[_org_of(t) for t in strays]}"
            )

            for sql, args in pool.team_queries():
                assert org in args, (
                    f"visibility query for {uid} in {org} carries no org bind "
                    f"parameter, so the database — not the Python — decides "
                    f"how much it returns: {sql}"
                )


@pytest.mark.asyncio
async def test_a_team_in_no_org_stays_with_the_member_who_holds_it(monkeypatch):
    """Scoping must not silently delete the teams that belong to no tenant.

    An `org_id IS NULL` team cannot leak another organisation's data, and it was
    only ever reachable through a direct membership row. `routers/search.py` and
    `routers/tasks_bulk.py` both write `(org_id IS NULL OR org_id = $2)` in
    their own narrowing; if this helper dropped those teams, both clauses would
    become dead code and their members would lose the team from search, bulk
    edit and the task list with nothing on screen to explain it.
    """
    _install_roles(monkeypatch)
    pool = RecordingPool()

    got = await server.get_visible_team_ids(pool, "user_member", org_id=ORG_B)
    assert "team_orphan" in got, (
        f"scoping to org B dropped the org-less team the user is a member of: {got}"
    )

    # And it stays a MEMBERSHIP question — a non-member does not acquire it.
    server._team_ids_request_cache.clear()
    other = await server.get_visible_team_ids(
        RecordingPool(), "user_bonly", org_id=ORG_B)
    assert "team_orphan" not in other, (
        "an org-less team reached a user who holds no membership row on it"
    )


@pytest.mark.asyncio
async def test_a_user_who_does_not_belong_to_the_org_gets_nothing(monkeypatch):
    """The control. `user_bonly` holds no row in A; A's teams are not theirs."""
    _install_roles(monkeypatch)
    pool = RecordingPool()

    got = await server.get_visible_team_ids(pool, "user_bonly", org_id=ORG_A)
    assert got == [], f"a non-member of org A received {got}"


@pytest.mark.asyncio
async def test_the_helper_accepts_an_org(monkeypatch):
    """The signature itself, so the failure names the cause and not a symptom.

    Without an `org_id` parameter the validated `X-Org-Id` cannot reach this
    function even in principle, however carefully every call site is written.
    """
    sig = inspect.signature(server.get_visible_team_ids)
    assert "org_id" in sig.parameters, (
        "get_visible_team_ids takes no org_id — the active org has no way in"
    )


# ── 4. admin_org_id confirms the named org, it does not guess ────────────────

@pytest.mark.asyncio
async def test_admin_org_id_confirms_the_named_org(monkeypatch):
    """Given an org, it must answer about THAT org or answer None.

    The old body took no org at all and returned one arbitrary row, so a caller
    holding admin in three orgs was answered "Aekam Inc" whatever they asked.
    """
    import middleware.roles as roles

    seen = {}

    class _P:
        async def fetchval(self, sql, *args):
            seen["sql"] = " ".join(sql.split())
            seen["args"] = args
            # The scoped statement must be the thing that filters. Answer only
            # when the org actually reached the query.
            if len(args) >= 2 and args[1] == ORG_B:
                return ORG_B
            return None

    async def _pool():
        return _P()

    monkeypatch.setattr(roles, "get_pool", _pool)

    got = await roles.admin_org_id("user_owner", ORG_B)
    assert got == ORG_B, (
        f"asked which org the caller administers when scoped to B, got {got!r}"
    )
    assert "org_id=$2::uuid" in seen["sql"], (
        f"the org was not used as a predicate: {seen['sql']}"
    )


@pytest.mark.asyncio
async def test_admin_org_id_refuses_an_org_the_caller_does_not_administer(monkeypatch):
    """No falling back to an arbitrary row when the named org says no."""
    import middleware.roles as roles

    class _P:
        async def fetchval(self, sql, *args):
            return None          # holds no admin row in the named org

    async def _pool():
        return _P()

    monkeypatch.setattr(roles, "get_pool", _pool)
    assert await roles.admin_org_id("user_owner", ORG_A) is None


@pytest.mark.asyncio
async def test_admin_org_id_is_deterministic_without_an_org(monkeypatch):
    """`LIMIT 1` with no `ORDER BY` is a bug on its own.

    Not because of what it returns today, but because what it returns is a
    planner decision — it can change on a version upgrade, a new index or a
    row count, with no code change and no deploy to blame.
    """
    import middleware.roles as roles

    seen = {}

    class _P:
        async def fetchval(self, sql, *args):
            seen["sql"] = " ".join(sql.split())
            return ORG_A

    async def _pool():
        return _P()

    monkeypatch.setattr(roles, "get_pool", _pool)
    await roles.admin_org_id("user_owner")

    assert "ORDER BY" in seen["sql"].upper(), (
        f"unordered LIMIT 1 over a multi-row set: {seen['sql']}"
    )


# ── 5. The second copy of the predicate ──────────────────────────────────────

def test_there_is_only_one_get_visible_team_ids():
    """Two implementations of one tenancy predicate is how one gets fixed.

    `utils.py:149` held an older copy with the same name and a branch that
    returned EVERY team in the database when `admin_org_id` came back empty —
    the exact hole that was closed in `server.py` on 965d0e82 and left open
    here. Nothing imported it, which is why nobody noticed.
    """
    import utils

    assert not hasattr(utils, "get_visible_team_ids"), (
        "utils.get_visible_team_ids is back. It is a second, unscoped copy of "
        "the predicate that decides which org's data a user sees; the moment "
        "something imports it the org switcher breaks again."
    )


# ── 6. End to end: the header reaches the predicate ──────────────────────────

async def test_the_org_header_reaches_the_visibility_predicate(
    api_client, mock_pool, as_member, monkeypatch
):
    """`GET /api/teams` with `X-Org-Id: B` must scope to B.

    Everything above tests the helper in isolation, which proves it CAN answer
    per-org. This proves the answer is actually asked for: that the route
    declares the dependency, that the dependency validates and returns the
    header org, and that the org survives the trip into
    `get_visible_team_ids`. Before the fix `server.py` contained no
    `Depends(get_org_id)` at all — measured, `grep -c` returned 0 — so the
    validated header stopped at the middleware and every one of these routes
    answered for whichever org the planner picked.
    """
    seen = {}

    async def _spy(pool, user_id, role=None, _user_dict=None,
                   include_archived=True, org_id=None):
        seen["org_id"] = org_id
        return ["team_b1"]

    monkeypatch.setattr(server, "get_visible_team_ids", _spy)

    async def fetchval_side(sql, *args):
        # `get_org_id` asks whether the caller belongs to the header org.
        if "user_roles" in sql and "org_id=$2::uuid" in sql:
            return 1
        return None

    async def fetchrow_side(sql, *args):
        if "staging.organisations" in sql:
            return {"id": ORG_B}
        return None

    async def fetch_side(sql, *args):
        if "FROM teams" in sql:
            return [{
                "team_id": "team_b1", "name": "E2E Project",
                "created_by": "user_mem001", "created_at": _NOW,
                "updated_at": _NOW, "deleted_at": None,
                "task_count": 0, "done_count": 0, "color": None,
            }]
        return []

    mock_pool.fetchval.side_effect = fetchval_side
    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side

    resp = await api_client.get("/api/teams", headers={"X-Org-Id": ORG_B})

    assert resp.status_code == 200, resp.text
    assert seen.get("org_id") == ORG_B, (
        f"the route resolved org_id={seen.get('org_id')!r} — the validated "
        f"X-Org-Id ({ORG_B}) never reached get_visible_team_ids, so the page "
        "renders whichever org the fallback happens to pick"
    )


def _org_resolving_pool(mock_pool, extra_fetchrow=None, extra_fetch=None):
    """Wire a mock pool so `get_org_id` accepts `X-Org-Id: ORG_B`."""

    async def fetchval_side(sql, *args):
        if "user_roles" in sql and "org_id=$2::uuid" in sql:
            return 1                      # yes, the caller belongs to org B
        return None

    async def fetchrow_side(sql, *args):
        if "staging.organisations" in sql:
            return {"id": ORG_B}
        if extra_fetchrow:
            return await extra_fetchrow(sql, *args)
        return None

    async def fetch_side(sql, *args):
        if extra_fetch:
            return await extra_fetch(sql, *args)
        return []

    mock_pool.fetchval.side_effect = fetchval_side
    mock_pool.fetchrow.side_effect = fetchrow_side
    mock_pool.fetch.side_effect = fetch_side


async def test_a_new_project_is_filed_under_the_active_org(
    api_client, mock_pool, as_member
):
    """A WRITE in the wrong org is worse than a read in the wrong org.

    `create_team` resolved the org with its own inline `ORDER BY granted_at
    LIMIT 1` — a third copy of the resolution, and header-blind. So a project
    created while switched to E2E Test was written with Aekam Inc's `org_id`,
    and then `get_visible_team_ids` — correctly scoped to E2E Test — could not
    show it back to the person who had just created it.
    """
    inserted = {}

    async def fetchrow_side(sql, *args):
        if "INSERT INTO teams" in sql:
            inserted["org_id"] = args[4]
            return {
                "team_id": "team_new", "name": "New", "created_by": "user_mem001",
                "created_at": _NOW, "updated_at": _NOW, "deleted_at": None,
                "task_count": 0, "done_count": 0, "color": None,
            }
        return None

    _org_resolving_pool(mock_pool, extra_fetchrow=fetchrow_side)

    resp = await api_client.post(
        "/api/teams", json={"name": "New"}, headers={"X-Org-Id": ORG_B}
    )

    assert resp.status_code == 200, resp.text
    assert inserted.get("org_id") == ORG_B, (
        f"project created while switched to org B was filed under "
        f"{inserted.get('org_id')!r}"
    )


async def test_the_member_picker_is_scoped_to_the_active_org(
    api_client, mock_pool, as_member, monkeypatch
):
    """`GET /api/users` fed the picker from `admin_org_id` with no org.

    Adding people to an E2E Test project, the picker listed Aekam Inc's staff —
    names the project could not actually contain.
    """
    import middleware.roles as roles

    asked = {}

    async def _admin_org_id(uid, org_id=None):
        asked["org_id"] = org_id
        return org_id

    async def _is_platform_staff(uid):
        return False

    monkeypatch.setattr(roles, "admin_org_id", _admin_org_id)
    monkeypatch.setattr(roles, "is_platform_staff", _is_platform_staff)
    _org_resolving_pool(mock_pool)

    resp = await api_client.get("/api/users", headers={"X-Org-Id": ORG_B})

    assert resp.status_code == 200, resp.text
    assert asked.get("org_id") == ORG_B, (
        f"the picker asked which org to list against with org_id="
        f"{asked.get('org_id')!r} — unscoped, that is one arbitrary admin row"
    )


# ── 7. The module rail follows the switcher ──────────────────────────────────

@pytest.mark.asyncio
async def test_module_grants_follow_the_active_org(monkeypatch):
    """Defect (d): `org_roles[0]` is the earliest-joined org, not the active one.

    A member with different module grants in two orgs switched org and got the
    breadcrumb of one and the sidebar of the other, because `_org_for`
    resolved the header and `_module_grants` did not.
    """
    import auth_router

    org_roles = [
        {"org_id": ORG_A, "role_code": "org_member", "org_name": "Aekam Inc"},
        {"org_id": ORG_B, "role_code": "org_member", "org_name": "E2E Test"},
    ]
    grants = {ORG_A: ["ganit"], ORG_B: ["vetana", "graha"]}

    class _P:
        async def fetch(self, sql, *args):
            org = next((a for a in args if a in grants), None)
            return [{"module_code": m} for m in grants.get(org, [])]

    got = await auth_router._module_grants(
        _P(), "user_member", [], org_roles, header_org=ORG_B
    )
    assert got == ["graha", "vetana"], (
        f"switched to E2E Test and the sidebar rendered {got} — Aekam Inc's "
        "grant is ['ganit'], so the rail stayed pinned to the org joined first"
    )


@pytest.mark.asyncio
async def test_module_levels_follow_the_active_org(monkeypatch):
    """Same defect, the depth half: write affordances render from these."""
    import auth_router

    org_roles = [
        {"org_id": ORG_A, "role_code": "org_member", "org_name": "Aekam Inc"},
        {"org_id": ORG_B, "role_code": "org_member", "org_name": "E2E Test"},
    ]
    levels = {ORG_A: [("ganit", "viewer")], ORG_B: [("graha", "editor")]}

    class _P:
        async def fetch(self, sql, *args):
            org = next((a for a in args if a in levels), None)
            return [{"module_code": m, "role": r} for m, r in levels.get(org, [])]

    got = await auth_router._module_levels(
        _P(), "user_member", [], org_roles, header_org=ORG_B
    )
    assert got == {"graha": "editor"}, (
        f"levels for the active org came back as {got}"
    )


@pytest.mark.asyncio
async def test_an_unheld_header_org_does_not_move_the_rail(monkeypatch):
    """A header naming an org the caller does not hold falls back, as `_org_for` does.

    `lib/api.js` attaches `X-Org-Id` to every request. This function must not
    be a second, weaker route to another org's entitlements than the one
    `middleware/org_resolver.get_org_id` guards.
    """
    import auth_router

    org_roles = [{"org_id": ORG_A, "role_code": "org_member", "org_name": "Aekam Inc"}]

    class _P:
        async def fetch(self, sql, *args):
            assert ORG_B not in args, "an org the caller does not hold was queried"
            return [{"module_code": "ganit"}]

    got = await auth_router._module_grants(
        _P(), "user_member", [], org_roles, header_org=ORG_B
    )
    assert got == ["ganit"]
