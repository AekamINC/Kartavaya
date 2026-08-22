"""Phase 2 of the `team_members` retirement: the READS moved, the WRITES did not.

`backend/migrations/PROPOSED_080_team_members_retire.sql` records a six-step
sequence for retiring `public.team_members`. Step 1 — migration 195 — reconciled
it into `public.project_assignments`. Step 2 is this: every call site that asks
"may this person open or administer this project" reads `project_assignments`
alone.

WHAT MAKES THAT SAFE, measured against the live database on 2026-08-22, after
195 was applied:

    team_members (every row status='active')                   198
    project_assignments                                        219
    active team_members with NO project_assignments row          0   ← was 127
    project_assignments with no active team_members row         21
    rows where the two disagree about ROLE                       0
    owner/admin in team_members but not owner/admin in
      project_assignments                                        0

`project_assignments` is a strict superset at identical roles, so removing the
`team_members` leg from a read cannot narrow anybody's answer. If somebody
reverses 195, these reads start revoking access silently — which is why the
first test below pins the direction that matters (a PA-only grant is honoured)
and the rest pin that no read names the retired table at all.

WHAT DID NOT MOVE, and must not be "finished" by a later pass without a decision
from the owner:

  · the writes. Step 4 is a RENAME, chosen over a DROP precisely because it is
    reversible — and it is reversible only while `team_members` is still being
    maintained. Cutting reads and writes over in one change throws that away.
  · `GET /api/teams/{id}`'s `members` roster. `project_assignments` has no
    `member_id`, no `email` and no `status`, so it cannot represent a person
    invited by email who has not registered — the row `add_team_member` writes
    with `user_id` NULL and `status='invited'`.
"""

import inspect
import re

import pytest

import server


# ── The pool that refuses ────────────────────────────────────────────────────

class NoTeamMembersPool:
    """Answers membership questions, and raises if a query names `team_members`.

    A test that only asserts on the RESULT cannot tell "reads one table" from
    "reads two and the second happened to be empty". This can: the failure is
    the query text, at the moment it is issued, naming the statement.
    """

    def __init__(self, teams=(), assignments=(), roles=()):
        #: (team_id, org_id)
        self.teams = list(teams)
        #: (team_id, user_id, role)
        self.assignments = list(assignments)
        #: (user_id, org_id, role_code)
        self.roles = list(roles)
        self.queries = []

    def _guard(self, sql):
        flat = " ".join(sql.split())
        self.queries.append(flat)
        if "team_members" in flat:
            raise AssertionError(
                "a membership READ still names `team_members`, which "
                "PROPOSED_080 step 4 renames out from under it:\n  " + flat
            )
        return flat

    async def fetch(self, sql, *args):
        flat = self._guard(sql)
        if "FROM teams t" in flat or "FROM teams" in flat:
            uid = args[0] if args else None
            org = args[1] if len(args) > 1 else None
            out = []
            for team_id, team_org in self.teams:
                if org is not None and team_org not in (org, None):
                    continue
                direct = any(t == team_id and u == uid for t, u, _ in self.assignments)
                by_org = team_org is not None and any(
                    u == uid and o == team_org
                    and rc in ("org_owner", "org_admin", "org_member")
                    for u, o, rc in self.roles
                )
                if direct or by_org:
                    out.append({"team_id": team_id})
            return out
        if "project_assignments" in flat:
            uid = args[0] if args else None
            return [{"team_id": t} for t, u, _ in self.assignments if u == uid]
        return []

    async def fetchrow(self, sql, *args):
        flat = self._guard(sql)
        if "project_assignments" in flat and len(args) >= 2:
            team_id, uid = args[0], args[1]
            for t, u, role in self.assignments:
                if t == team_id and u == uid:
                    return {"role": role}
        return None

    async def fetchval(self, sql, *args):
        self._guard(sql)
        return None

    async def execute(self, sql, *args):
        self._guard(sql)


@pytest.fixture(autouse=True)
def _clear_cache():
    server._team_ids_request_cache.clear()
    yield
    server._team_ids_request_cache.clear()


ORG = "11111111-1111-4111-8111-111111111111"


# ── 1. The 21: a grant that exists ONLY in project_assignments ───────────────

@pytest.mark.asyncio
async def test_a_grant_only_in_project_assignments_is_visible(monkeypatch):
    """The population migration 195 deliberately left alone, and did not copy back.

    21 live `project_assignments` rows have no active `team_members` twin —
    people granted a project through the newer paths (`auth_router`'s sync,
    `invite_router`, the org console). They could always open the project,
    because `get_visible_team_ids` UNIONed both tables. This asserts the cutover
    kept them, which is the direction that a badly-written "read one table"
    change would silently break.
    """
    async def _no(uid, org_id=None):
        return False
    monkeypatch.setattr(server, "is_org_admin", _no)
    monkeypatch.setattr(server, "admin_org_id", _no)

    pool = NoTeamMembersPool(
        teams=[("team_pa_only", ORG)],
        assignments=[("team_pa_only", "user_pa_only", "member")],
        roles=[("user_pa_only", ORG, "org_member")],
    )

    got = await server.get_visible_team_ids(pool, "user_pa_only", org_id=ORG)

    assert got == ["team_pa_only"], (
        f"a person whose only grant is a project_assignments row got {got} — "
        "after migration 195 that table is the whole answer, and dropping them "
        "is a 403 on a project they worked in yesterday"
    )


@pytest.mark.asyncio
async def test_the_no_org_branch_also_honours_a_pa_only_grant(monkeypatch):
    """The portal-client branch — no `user_roles` row anywhere — used to UNION too.

    It is now a single SELECT, which also removes a set operation whose two
    `user_id` columns had different types (`character varying` against `text`).
    That is the shape `auth_router`'s sync comment warns about: untyped, asyncpg
    cannot deduce one type and PgBouncer returns the parse error as a 500.
    """
    async def _no(uid, org_id=None):
        return False
    monkeypatch.setattr(server, "is_org_admin", _no)
    monkeypatch.setattr(server, "admin_org_id", _no)

    pool = NoTeamMembersPool(
        teams=[("team_orphan", None)],
        assignments=[("team_orphan", "user_portal", "client")],
    )

    got = await server.get_visible_team_ids(pool, "user_portal", org_id=None)

    assert got == ["team_orphan"]
    assert not any(
        " UNION " in q for q in pool.queries if "project_assignments" in q
    ), (
        "the unscoped branch still UNIONs. With one table left there is nothing "
        "to union with, and the UNION is what forced the untyped $1 across two "
        "column types"
    )


@pytest.mark.asyncio
async def test_is_project_member_answers_from_project_assignments_alone():
    """The explicit `team_members` fallback under this query is gone.

    It existed because a user invited before they registered had no assignment
    row. Migration 195 copied all 127 of those across and no role disagreed, so
    the fallback could only ever return a row the first query already returned.
    """
    pool = NoTeamMembersPool(
        assignments=[("team_1", "user_1", "admin")],
    )

    mem = await server.is_project_member(pool, "team_1", {"user_id": "user_1"})

    assert mem is not None and mem["role"] == "admin", (
        "is_project_member must return the REAL role, not a synthesised "
        "'admin' — five routes distinguish owner/admin from client on it"
    )


# ── 2. The authority checks, as SQL text ─────────────────────────────────────
#
# `_may_approve` and `_POLICY_PROJECTS_PREDICATE` are fragments interpolated
# into f-strings, so there is no call to observe — the text IS the behaviour.

def test_the_approval_fragment_names_one_table():
    frag = server._may_approve("t.team_id", 1)
    assert "team_members" not in frag, (
        "the approvals queue still admits `team_members`. The badge and the "
        "queue share this fragment precisely so they cannot disagree about who "
        "may approve; two tables is how they disagreed the first time"
    )
    assert "public.project_assignments" in frag
    assert "role IN ('owner','admin')" in frag, (
        "an approval is an act of authority, not of membership — the role "
        "predicate is not decoration"
    )


def test_the_project_policy_predicate_names_one_table():
    assert "team_members" not in server._POLICY_PROJECTS_PREDICATE
    assert "public.project_assignments" in server._POLICY_PROJECTS_PREDICATE
    assert "role IN ('owner','admin')" in server._POLICY_PROJECTS_PREDICATE


@pytest.mark.parametrize("fn_name", [
    "get_visible_team_ids",
    "is_project_member",
    "_review_approval_inner",
    "update_subtask",
    "list_teams",
    "get_team",
    "list_team_members",
    "list_team_clients",
])
def test_no_membership_read_names_the_retired_table(fn_name):
    """One assertion per cut-over call site, against the source.

    `get_team` is in this list even though its `members` roster still reads
    `team_members` — the roster is a projection, not a gate, and this test
    looks only at SELECTs that decide authorisation. The check below is
    therefore "no SELECT of a ROLE or a membership EXISTS names it", not "the
    word does not appear".
    """
    src = inspect.getsource(getattr(server, fn_name))
    # Strip comments and docstrings: every one of these functions explains the
    # cutover in prose that necessarily names the table it stopped reading.
    code = re.sub(r'"""(?:.|\n)*?"""', "", src)
    code = "\n".join(
        line for line in code.splitlines() if not line.strip().startswith("#")
    )
    offenders = [
        line for line in code.splitlines()
        if "team_members" in line
        and re.search(r"\b(SELECT|EXISTS|UNION)\b", line, re.I)
    ]
    # `get_team`'s roster is the one permitted read, and it is permitted because
    # `project_assignments` cannot hold `member_id`, `email` or `status`.
    if fn_name == "get_team":
        offenders = [o for o in offenders if "tm.*" not in o]
    assert not offenders, (
        f"server.{fn_name} still READS team_members:\n  "
        + "\n  ".join(o.strip() for o in offenders)
        + "\nPROPOSED_080 step 4 renames that table; a missed read becomes a "
          "500 on the first request that hits it."
    )


# ── 3. The writes stay dual. This is the rollback. ───────────────────────────

WRITERS = {
    "create_team": "the first owner row of a brand-new project",
    "_ensure_default_owner": "DEFAULT_OWNER_EMAIL seeded onto every project",
    "add_team_member": "adding or re-inviting somebody by email",
    "update_team_member": "a role or status change",
    "remove_team_member": "revoking a project",
}


@pytest.mark.parametrize("fn_name,what", sorted(WRITERS.items()))
def test_every_membership_writer_still_writes_both_tables(fn_name, what):
    """A source assertion, because a mock pool binds anything to anything.

    THE POINT IS THE ROLLBACK. `PROPOSED_080` step 4 renames `team_members`
    rather than dropping it, and the rename is instantly reversible — but only
    while the table is still current. The moment a writer stops maintaining it,
    reverting the read cutover would restore a table that has been silently
    going stale for however long, and hand people access levels that were
    revoked. So the reads move alone, and both tables stay in step until the
    owner signs off the whole sequence.
    """
    src = inspect.getsource(getattr(server, fn_name))
    code = "\n".join(
        line for line in src.splitlines() if not line.strip().startswith("#")
    )
    writes_tm = re.search(
        r"\b(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?team_members\b", code, re.I)
    writes_pa = re.search(
        r"\b(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?project_assignments\b",
        code, re.I)
    assert writes_tm, (
        f"server.{fn_name} ({what}) no longer writes team_members. Phase 2 is a "
        "READ cutover; stopping the write throws away the only reason step 4 is "
        "a rename and not a drop."
    )
    assert writes_pa, (
        f"server.{fn_name} ({what}) does not write project_assignments — which "
        "is now the table every membership READ consults, so this grant would "
        "not exist as far as authorisation is concerned"
    )


# ── 4. The half of a write that phase 2 had to add ───────────────────────────

def test_deactivating_a_member_removes_their_project_assignment():
    """`project_assignments` has no `status`; membership IS the row.

    `update_team_member` synced only the ROLE (FIX #5, 2026-05-14). Setting
    `status='inactive'` wrote `team_members` and nothing else, which was
    harmless while the reads asked `team_members.status='active'` — and became
    a silent non-revocation the instant they stopped. The member would keep the
    project, the board and the tasks, while the roster showed them removed.
    """
    src = inspect.getsource(server.update_team_member)
    code = "\n".join(
        line for line in src.splitlines() if not line.strip().startswith("#")
    )
    assert re.search(
        r"DELETE FROM public\.project_assignments", code), (
        "a non-active status must delete the assignment row — there is no "
        "status column there to set, so the row's absence is the revocation"
    )
    assert re.search(
        r"ON CONFLICT \(team_id,\s*user_id\) DO UPDATE", code), (
        "re-activation and role changes must upsert, not UPDATE: an UPDATE is a "
        "silent no-op when the row was deleted by a previous deactivation"
    )


def test_the_reactivation_upsert_casts_the_user_id():
    """`$3::varchar`, and the reason is a 500 this project has already paid for.

    The value comes out of the `team_members` UPDATE's RETURNING row, where
    `user_id` is `text`; it goes into `project_assignments.user_id`, which is
    `character varying`. `tests/test_auth.py::
    test_the_project_assignment_sync_casts_its_one_placeholder` records what an
    untyped placeholder across those two types costs: PgBouncer turns the parse
    error into an instant 500, and no mock-pool test can see it.
    """
    src = inspect.getsource(server.update_team_member)
    stmts = re.findall(
        r"(INSERT INTO public\.project_assignments(?:.|\n)*?)\"\s*,", src)
    assert stmts, "the project_assignments upsert has moved or been renamed"
    for stmt in stmts:
        assert "$3::varchar" in stmt, (
            "the user_id placeholder reaching project_assignments is uncast:\n"
            + stmt
        )
