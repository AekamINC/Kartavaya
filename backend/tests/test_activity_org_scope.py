"""The activity feed is a twin of both root defects, and it feeds the Today page.

`server.get_visible_team_ids` was given an `org_id` and `middleware.roles.
admin_org_id` was made deterministic. `routers/activity.py` was not touched, and
it contains its own copy of each:

  (a) line 129, verbatim:
        SELECT org_id FROM staging.user_roles
        WHERE user_id=$1 AND org_id IS NOT NULL LIMIT 1
      An unordered LIMIT 1 over a set that has three rows for the owner — the
      planner picks the org. This is the exact statement `admin_org_id` was
      fixed for.

  (b) lines 141-149, verbatim:
        SELECT team_id FROM team_members WHERE user_id=$1 AND status='active'
        UNION
        SELECT team_id FROM project_assignments WHERE user_id=$1
      Constrained BY USER ONLY. This is the exact UNION `get_visible_team_ids`
      was re-anchored to `teams` to kill; a member of two orgs gets both orgs'
      events whatever the switcher says.

  (c) the `sees_every_org` branch, which reads EVERY team in EVERY organisation
      for god mode. `middleware/subscription.py:333` quotes the spec as "no one
      should be able to see any other org data even god mode users".

Reachability: `pages/ActivityFeedPage.jsx:75` calls `/activity/feed`, and
`pages/DashboardPage.jsx:140` calls it with `{limit: 6}` on the Today
dashboard. Both are top-level screens.
"""
import pytest

from routers import activity as A

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # Aekam Inc — joined first
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # E2E Test  — the active org

TEAMS = {ORG_A: ["team_a1", "team_a2"], ORG_B: ["team_b1"]}

#: Direct membership rows, which carry no org_id of their own — the UNION legs.
MEMBERSHIPS = {"user_member": ["team_a1", "team_b1"]}

EVENTS = {
    "team_a1": {"id": "ev_a1", "team_id": "team_a1", "type": "task_created"},
    "team_a2": {"id": "ev_a2", "team_id": "team_a2", "type": "task_created"},
    "team_b1": {"id": "ev_b1", "team_id": "team_b1", "type": "task_created"},
}


class Pool:
    """Answers like the real SQL. Nothing narrows unless an org is bound."""

    def __init__(self, roles, platform_role=None):
        self.roles = roles                 # {org_id: role_code}
        self.platform_role = platform_role
        self.queries = []

    async def fetchval(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "org_id IS NULL" in flat and "role_code" in flat:
            return self.platform_role
        return None

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "SELECT org_id FROM public.user_roles" in flat:
            # The planner's choice, modelled as the FIRST row — which for the
            # owner is Aekam Inc, the org they joined first and are not on.
            held = [o for o in self.roles]
            return {"org_id": held[0]} if held else None
        return None

    async def fetch(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "FROM activity_events" in flat:
            team_ids = args[0] if args else []
            return [EVENTS[t] for t in team_ids if t in EVENTS]
        if "team_id" in flat:
            return [{"team_id": t} for t in self._teams(flat, args)]
        return []

    def _teams(self, flat, args):
        org = next((str(a) for a in args if str(a) in TEAMS), None)
        uid = next((a for a in args if isinstance(a, str) and a.startswith("user_")), None)
        if uid is None:
            return sorted(TEAMS[org]) if org else sorted(
                t for ts in TEAMS.values() for t in ts)
        reach = set(MEMBERSHIPS.get(uid, []))
        for held in self.roles:
            reach |= set(TEAMS[held])
        if org is not None:
            reach &= set(TEAMS[org])
        return sorted(reach)


def _norm(rows):
    return sorted(r["team_id"] for r in rows)


@pytest.fixture(autouse=True)
def _roles(monkeypatch):
    """`is_org_admin` / `admin_org_id` backed by the pool's own role map."""
    import middleware.roles as R
    import server

    state = {}

    async def _is_org_admin(uid, org_id=None):
        held = state.get("roles", {})
        if org_id:
            return held.get(str(org_id)) in ("org_owner", "org_admin")
        return any(r in ("org_owner", "org_admin") for r in held.values())

    async def _admin_org_id(uid, org_id=None):
        held = state.get("roles", {})
        if org_id:
            return org_id if held.get(str(org_id)) in ("org_owner", "org_admin") else None
        for o, r in held.items():
            if r in ("org_owner", "org_admin"):
                return o
        return None

    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)
    monkeypatch.setattr(server, "admin_org_id", _admin_org_id)
    monkeypatch.setattr(R, "is_org_admin", _is_org_admin, raising=False)
    server._team_ids_request_cache.clear()
    yield state
    server._team_ids_request_cache.clear()


# ── (b) the user-only UNION ──────────────────────────────────────────────────

async def test_a_member_of_two_orgs_does_not_get_both_orgs_events(_roles):
    """The owner's complaint, on the Today dashboard.

    Membership rows in A and B, switched to B. Before the fix the UNION was
    constrained by user only, so `team_a1`'s events came back under B's badge.
    """
    _roles["roles"] = {ORG_A: "org_member", ORG_B: "org_member"}
    pool = Pool(_roles["roles"])

    rows = await A.feed_activity(pool=pool, user={"user_id": "user_member"}, org=ORG_B)

    assert _norm(rows) == ["team_b1"], (
        f"scoped to E2E Test and got {_norm(rows)} — team_a1 is Aekam Inc's, "
        "and `SELECT team_id FROM team_members WHERE user_id=$1 UNION …` is not "
        "a tenancy predicate"
    )


# ── (a) the unordered LIMIT 1 ────────────────────────────────────────────────

async def test_an_admin_of_three_orgs_gets_the_org_the_header_named(_roles):
    """`SELECT org_id … LIMIT 1` with no ORDER BY and no org argument.

    org_admin in both, switched to B. The bypass branch resolved its own org
    with a planner-chosen LIMIT 1 and handed back that org's teams — so the
    switcher moved and the feed did not.
    """
    _roles["roles"] = {ORG_A: "org_admin", ORG_B: "org_admin"}
    pool = Pool(_roles["roles"])

    rows = await A.feed_activity(pool=pool, user={"user_id": "user_owner"}, org=ORG_B)

    assert _norm(rows) == ["team_b1"], (
        f"admin of both orgs, switched to E2E Test, got {_norm(rows)}"
    )


async def test_switching_back_gives_the_other_org(_roles):
    """A switch, not a different pin."""
    _roles["roles"] = {ORG_A: "org_admin", ORG_B: "org_admin"}
    pool = Pool(_roles["roles"])

    rows = await A.feed_activity(pool=pool, user={"user_id": "user_owner"}, org=ORG_A)
    assert _norm(rows) == ["team_a1", "team_a2"]


# ── (c) god mode is not an exception ─────────────────────────────────────────

async def test_god_mode_does_not_read_every_org(_roles):
    """`sees_every_org` read EVERY team in EVERY organisation.

    The settled rule is that the active org wins for god mode too. A platform
    owner who is a member of B sees B; the other tenant is not theirs to read
    from a feed endpoint.
    """
    _roles["roles"] = {ORG_B: "org_admin"}
    pool = Pool(_roles["roles"], platform_role="platform_owner")

    rows = await A.feed_activity(pool=pool, user={"user_id": "user_god"}, org=ORG_B)

    assert not (set(_norm(rows)) & set(TEAMS[ORG_A])), (
        f"god mode read {_norm(rows)}, which includes Aekam Inc's "
        f"{sorted(set(_norm(rows)) & set(TEAMS[ORG_A]))}"
    )


# ── the endpoint must still answer at all ────────────────────────────────────

async def test_no_active_org_still_returns_the_callers_own_memberships(_roles):
    """A portal client or org-less account resolves no org.

    `active_org_id` returns None for them, and the feed must not become an
    outage — `get_visible_team_ids` falls back to membership only.
    """
    _roles["roles"] = {}
    pool = Pool({})
    rows = await A.feed_activity(pool=pool, user={"user_id": "user_member"}, org=None)
    assert _norm(rows) == ["team_a1", "team_b1"]


async def test_the_feed_asks_the_one_shared_helper(_roles):
    """Not a fourth copy of the predicate.

    The whole failure mode here was a fixed function with an unfixed twin, so
    the fix has to be a CALL rather than another restatement of the UNION.
    """
    _roles["roles"] = {ORG_B: "org_member"}
    pool = Pool(_roles["roles"])
    await A.feed_activity(pool=pool, user={"user_id": "user_member"}, org=ORG_B)

    restated = [q for q, _ in pool.queries
                if "FROM team_members" in q and "UNION" in q and "teams t" not in q]
    assert not restated, (
        f"activity.py still restates the membership UNION itself: {restated}"
    )
