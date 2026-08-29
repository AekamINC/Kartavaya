"""A task's comment thread must not cross a tenant boundary.

── WHAT WAS MEASURED, AND HOW ────────────────────────────────────────────────

Found on 2026-08-29 while writing proposal 93 Suite 18 (client portal), from a
real browser session on `staging.kartavaya.com` — not from the source.

    caller  user_21457956f010  (kevalvshah03+1@gmail.com)
            org_admin of **Unicode Group only**. No Aekam Inc role, no
            project_assignments row on any team below. Confirmed from
            GET /api/auth/me and from staging.user_roles.

    GET /api/tasks/task_e03dc6c1e106            403  {"detail":"Not authorized"}
    GET /api/tasks/task_e03dc6c1e106/comments   200  three comments, verbatim,
                                                     with author names
    GET /api/tasks/task_76394cae4212/comments   200  another firm's working note
                                                     about a client's Google
                                                     Business verification
    GET /api/tasks/task_7a773897f58f/comments   200  "Please co-ordinate with
                                                     Sneha"

All three tasks belong to **Aekam Inc**. The task itself was refused and its
thread was not, which is the whole finding in two lines.

Live exposure at that moment, counted from the database:

    task_comments joined to their org      87 comments over 29 tasks
      · Unicode Group                      65 over 14
      · Aekam Inc                          22 over 15

readable by any of the authenticated accounts in the database. **ACTIVE** — the
GET above is the walk-through, not a hypothetical.

── THE SHAPE, BECAUSE IT IS THE ONE THAT KEEPS SHIPPING ──────────────────────

`list_comments` and `add_comment` asked ONE access question:

    if is_portal_client(user): check client_can_access_task(...)

and had no `else`. A gate written FOR THE CLIENT, with the staff path left as
the fall-through — the same shape as the four approval writes fixed the same
week, where an administrator of one company could decide another company's task
by id.

Its own siblings were already correct, which is what makes this a miss rather
than an oversight in design: `edit_comment` and `delete_comment` both carry
`is_org_admin(uid, org)` AND `_comment_task_in_org`, and
`routers/time_entries.py::_assert_task_access` guards the Time tab of the same
drawer with `may_reach_project`. The two handlers that FEED the drawer are the
two nobody came back to.

── WHY THESE TESTS ARE SHAPED THE WAY THEY ARE ───────────────────────────────

Two halves, deliberately:

1. **Source contract** — the `else` exists and reaches the gate. The behaviour
   needs a live database and two disagreeing tenants to reproduce, and a test
   that needs those is a test that gets deleted the first time it flakes. This
   is the same argument `tests/test_task_drawer_access.py` opens with, and this
   file is that file's other half: it proved the CLIENT branch was right and
   never asked what happened to everyone else.

2. **Behavioural, through the ASGI app** — a member on a task in no visible
   team is refused, and the SAME member on a task in a visible team is served.
   The second assertion is not padding. Refusing everybody would satisfy the
   first assertion perfectly, and it would re-open the 2026-08-08 defect where
   an org administrator could list a task and be refused its detail, leaving
   the drawer an empty skeleton. A gate is only correct if it is proved to open
   as well as to close.

⚠ THE WRITE HALF IS NOT PROBED AGAINST STAGING, AND THAT IS DELIBERATE.
`POST /tasks/{id}/comments` carried the identical hole, and it is the worse of
the two: the fan-out below it emails the task's creator, its assignees and its
`task_clients` rows, so injected text leaves the product and lands in the other
tenant's inbox. The probe IS the exploit, Aekam Inc is no-touch under proposal
93 §12, and this repo's standing rule is "never test validation by writing to
the live DB". Graded LATENT on that basis — the read half was walked through and
this one was not. It is covered here instead, where refusing costs nobody a row.
"""
import ast
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent

pytestmark = pytest.mark.asyncio


def _fn_source(name: str) -> str:
    """A handler's body with its docstring stripped.

    Stripped for the reason `test_task_drawer_access` gives: these files explain
    themselves at length, and a docstring that merely NAMES the gate would
    satisfy a search for it — the test would pass on prose while the code still
    fell through.
    """
    tree = ast.parse((BACKEND / "server.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body = body[1:]
            return "\n".join(ast.unparse(n) for n in body)
    raise AssertionError(f"{name} not found in server.py")


# ── 1. Source contract: neither handler may fall through ──────────────────────

GATE = "assert_may_reach_task_thread"


@pytest.mark.parametrize("handler", ["list_comments", "add_comment"])
async def test_the_non_client_branch_reaches_the_tenancy_gate(handler):
    body = _fn_source(handler)
    assert "is_portal_client" in body, (
        f"{handler} must still ask whether the caller is a portal client — that "
        f"branch is what keeps the firm's internal thread away from the "
        f"customer's own customer."
    )
    assert GATE in body, (
        f"{handler} has no tenancy gate for a caller who is NOT a portal "
        f"client, so it serves `WHERE c.task_id=$1` to anyone with a session. "
        f"Measured on staging 2026-08-29: a Unicode Group administrator read "
        f"22 Aekam Inc comments over 15 tasks by id, while GET on the tasks "
        f"themselves answered 403. Call {GATE}."
    )
    # An `else`, not a second `if`. Two independent conditions can both be
    # false; the point is that EVERY caller passes exactly one gate.
    assert re.search(r"else:\s*\n?\s*await " + GATE, body) or f"else:\n    await {GATE}" in body, (
        f"{handler} must reach {GATE} on the ELSE of the client branch. A "
        f"separate `if` can be skipped by a caller who satisfies neither, which "
        f"is the fall-through this file exists to close."
    )


async def test_the_gate_asks_both_halves_of_the_admin_question():
    """`is_org_admin(uid, org)` alone is not a tenancy check.

    `delete_task`'s rule, quoted in `approvals_router.org_admin_may_reach_task`:
    "`is_org_admin(uid, org)` says the caller administers THIS org;
    `task_is_in_org` says the task is IN it. A write may not be one predicate
    short." Scoping only the admin question narrows WHO reaches the hatch and
    says nothing about WHAT the hatch hands back — the exact shape of the
    previous half-fix, twice.
    """
    body = _fn_source(GATE)
    assert "is_org_admin" in body and "task_is_in_org" in body, (
        "the gate must ask both halves. `is_org_admin(uid)` with no org is True "
        "for an org_admin row in ANY organisation, and this repo has shipped "
        "that mistake in get_task, delete_task and approvals_router."
    )
    assert "get_visible_team_ids" in body, (
        "the gate must admit somebody whose project is visible in the ACTIVE "
        "org. Without this leg an ordinary member is refused the thread on a "
        "task they can list — the 2026-08-08 empty-drawer defect, in mirror "
        "image, and `test_task_drawer_access.py` exists because of it."
    )
    assert "task_clients" in body, (
        "the gate must admit a user named by a task_clients row — that grant is "
        "the whole of a shared task's authority."
    )


async def test_list_comments_resolves_the_active_org():
    """A gate that scopes to an org needs the org resolved on the request.

    `list_comments` took no `org` dependency at all, so even a correct predicate
    would have been asked with `org=None` — which falls back to the caller's
    HOME organisation and is not the one the switcher is on.
    """
    src = (BACKEND / "server.py").read_text(encoding="utf-8")
    sig = re.search(r"async def list_comments\((.*?)\):", src, re.S)
    assert sig, "list_comments not found"
    assert "active_org_id" in sig.group(1), (
        "list_comments must take `org=Depends(active_org_id)`; without it the "
        "tenancy gate is asked about the wrong organisation."
    )
    sig = re.search(r"async def add_comment\((.*?)\):", src, re.S)
    assert sig and "active_org_id" in sig.group(1), (
        "add_comment must take `org=Depends(active_org_id)` for the same reason."
    )


# ── 2. Behavioural: it closes, AND it opens ───────────────────────────────────

FOREIGN_TASK = "task_e03dc6c1e106"      # Aekam Inc, in the measurement above
OWN_TASK = "task_aaaaaabbbbbb"

#: What the leak returned. If any of this reaches a caller who should be
#: refused, the assertion says so by name rather than by row count.
FOREIGN_ROWS = [{
    "comment_id": "cmt_2acc049321b2", "task_id": FOREIGN_TASK,
    "user_id": "user_3339c020f0c0", "user_name": "Kasti Pranami",
    "body": "another firm's internal note",
    "created_at": __import__("datetime").datetime(2026, 8, 11, 12, 56, 13,
                                                  tzinfo=__import__("datetime").timezone.utc),
    "is_client_visible": False,
}]


def _wire(mock_pool, *, team_id, visible_teams, creator="user_someone_else"):
    """Point the mock at one task and one set of visible teams.

    `fetch` answers the comment rows unconditionally, so a handler that skips
    the gate returns them and the assertion fails LOUDLY with the leaked body in
    it. A mock that returned `[]` here would let a broken gate pass.
    """
    async def _fetchrow(query, *args):
        if "FROM tasks WHERE task_id" in query:
            return {"team_id": team_id, "user_id": creator,
                    "created_by_user_id": creator, "assignee_user_ids": []}
        return None

    async def _fetchval(query, *args):
        if "task_clients" in query:
            return None
        if "information_schema.columns" in query:
            return None          # the is_client_visible column is not applied
        if "staging.user_roles" in query:
            return None          # not an admin anywhere
        return None

    async def _fetch(query, *args):
        if "task_comments" in query:
            return FOREIGN_ROWS
        return []

    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetch.side_effect = _fetch

    import server
    server._comment_visibility_column = None

    async def _teams(pool, user_id, **kw):
        return list(visible_teams)
    return _teams


async def test_a_member_is_refused_another_tenants_thread(
        api_client, as_member, mock_pool, monkeypatch):
    import server
    teams = _wire(mock_pool, team_id="team_aekam_inc", visible_teams=[])
    monkeypatch.setattr(server, "get_visible_team_ids", teams)
    try:
        r = await api_client.get(f"/api/tasks/{FOREIGN_TASK}/comments")
        assert r.status_code == 403, (
            f"GET /tasks/{FOREIGN_TASK}/comments answered {r.status_code} to a "
            f"member with no membership of the task's project and no role in "
            f"its organisation. Body: {r.text[:300]}"
        )
        assert "internal note" not in r.text
    finally:
        server._comment_visibility_column = None


async def test_a_member_is_refused_posting_into_another_tenants_thread(
        api_client, as_member, mock_pool, monkeypatch):
    """The write half — the one not probed against staging. See the header."""
    import server
    teams = _wire(mock_pool, team_id="team_aekam_inc", visible_teams=[])
    monkeypatch.setattr(server, "get_visible_team_ids", teams)
    try:
        r = await api_client.post(f"/api/tasks/{FOREIGN_TASK}/comments",
                                  json={"body": "injected"})
        assert r.status_code == 403, (
            f"POST /tasks/{FOREIGN_TASK}/comments answered {r.status_code}. "
            f"This handler's fan-out emails the task's creator, its assignees "
            f"and its task_clients rows, so an accepted write leaves the "
            f"product and reaches the other tenant's inbox."
        )
        assert not mock_pool.fetchrow.call_args_list or all(
            "INSERT INTO task_comments" not in str(c) for c in mock_pool.fetchrow.call_args_list
        ), "the refusal happened AFTER the INSERT"
    finally:
        server._comment_visibility_column = None


async def test_the_gate_still_opens_for_a_member_of_the_project(
        api_client, as_member, mock_pool, monkeypatch):
    """⚠ THE HALF THAT STOPS THIS BECOMING THE 2026-08-08 DEFECT AGAIN.

    Refusing everybody would satisfy the two tests above and leave the drawer an
    empty skeleton for every ordinary member — which is the bug
    `test_task_drawer_access.py` was written for. The gate has to OPEN too.
    """
    import server
    teams = _wire(mock_pool, team_id="team_visible", visible_teams=["team_visible"])
    monkeypatch.setattr(server, "get_visible_team_ids", teams)
    try:
        r = await api_client.get(f"/api/tasks/{OWN_TASK}/comments")
        assert r.status_code == 200, (
            f"a member whose visible teams include the task's project was "
            f"refused its thread ({r.status_code}) — the drawer opens onto an "
            f"empty skeleton again. Body: {r.text[:300]}"
        )
        assert len(r.json()) == 1
    finally:
        server._comment_visibility_column = None


async def test_the_task_creator_still_reaches_their_own_thread(
        api_client, as_member, mock_pool, monkeypatch, member_user):
    """A personal task carries no project, so membership cannot be the only leg."""
    import server
    teams = _wire(mock_pool, team_id=None, visible_teams=[],
                  creator=member_user["user_id"])
    monkeypatch.setattr(server, "get_visible_team_ids", teams)
    try:
        r = await api_client.get(f"/api/tasks/{OWN_TASK}/comments")
        assert r.status_code == 200, (
            "the author of a task with no project was refused their own "
            "thread — a personal task would have no readable comments at all."
        )
    finally:
        server._comment_visibility_column = None


async def test_a_missing_task_is_404_not_403(
        api_client, as_member, mock_pool, monkeypatch):
    """`get_task`'s existing distinction, kept rather than invented.

    Not a new disclosure: the caller already learns existence from
    `GET /api/tasks/{id}`, which answers 404 for a task that is not there and
    403 for one that is. Diverging here would make the two endpoints disagree
    about the same fact.
    """
    import server

    async def _none(query, *args):
        return None
    mock_pool.fetchrow.side_effect = _none
    mock_pool.fetchval.side_effect = _none
    monkeypatch.setattr(server, "get_visible_team_ids",
                        lambda pool, user_id, **kw: _none(""))
    r = await api_client.get("/api/tasks/task_nosuchtask/comments")
    assert r.status_code == 404, r.text
