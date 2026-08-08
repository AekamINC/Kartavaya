"""The task drawer must not refuse a task the caller can already list.

Reported from staging on 2026-08-08: opening a task left the drawer an empty
skeleton and the console showed 403 on `/tasks/{id}/comments`, `/time/task/{id}`
and `/activity/task/{id}`. Two independent causes, both reproduced against the
live database with `kevalvshah03+1@gmail.com` — an `org_admin` of the task's own
organisation:

  1. Every "is this caller a client" gate read the legacy `users.role` column.
     That account carries `users.role='client'` while holding `org_admin`, so
     the comment list took the client branch and returned `[]`.
  2. The time and activity gates asked only `team_members` UNION
     `project_assignments`. The task LIST is org-scoped, so an org administrator
     who is not on the project could list a task and be refused its detail.

These are source-contract tests. The behaviour needs a live database and two
disagreeing role tables to reproduce, and a test that needs those is a test that
gets deleted the first time it flakes.
"""
import ast
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _source(path: str) -> str:
    return (BACKEND / path).read_text(encoding="utf-8")


def _fn_source(path: str, name: str) -> str:
    """Return a function's body with its docstring stripped.

    Stripped because these files explain themselves at length, and a docstring
    that merely NAMES the old check would satisfy a search for it — the test
    would pass on prose while the code still did the wrong thing.
    """
    tree = ast.parse(_source(path))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body = body[1:]
            return "\n".join(ast.unparse(n) for n in body)
    raise AssertionError(f"{name} not found in {path}")


# ── 1. No client gate may read the legacy column ───────────────────────────────

#: The files whose client gates decide what a caller SEES. `invite_router.py` is
#: deliberately absent: it reads `target["role"]` — the role of the person being
#: invited, not the caller's — which is a different question this must not touch.
CLIENT_GATED = ("server.py", "routers/time_entries.py")

LEGACY_GATE = re.compile(r'user\.get\(\s*["\']role["\']\s*\)\s*==\s*["\']client["\']')


def test_client_gates_do_not_read_the_legacy_users_role_column():
    for path in CLIENT_GATED:
        hits = LEGACY_GATE.findall(_source(path))
        assert not hits, (
            f"{path} still decides 'is a client' from users.role. That column "
            f"disagrees with staging.user_roles on live data — two org_admin "
            f"accounts carry role='client' — so this hides their own "
            f"organisation's comments and files from them. Use "
            f"middleware.roles.is_portal_client."
        )


def test_is_portal_client_requires_both_the_column_and_the_absence_of_a_role():
    body = _fn_source("middleware/roles.py", "is_portal_client")
    # The column is still necessary: without it this would RECLASSIFY people who
    # were never clients, which is the loosening direction.
    assert "!= 'client'" in body or '!= "client"' in body, (
        "is_portal_client must still require users.role='client'; dropping that "
        "would turn non-clients into clients."
    )
    assert "user_roles" in body, (
        "is_portal_client must consult staging.user_roles — the column alone is "
        "the bug it exists to fix."
    )
    # An ALLOW-LIST, not "any role that is not org_client". The two agree on
    # today's role codes and disagree on the next one invented: a deny-list
    # declassifies a client the moment an unrecognised code appears in their
    # rows, and declassifying a client is the direction that SHOWS them the
    # firm's internal comments about their own file.
    assert "= ANY(" in body, (
        "is_portal_client must test membership of a named staff-side set. A "
        "`role_code <> ...` deny-list fails open on any role code added later."
    )
    from middleware.roles import ORG_ROLES, HR_ADMIN_ROLES, ALL_PLATFORM_ROLES
    from middleware.role_tiers import PROJECT_ONLY_ROLES
    staff_side = set(ORG_ROLES) | set(HR_ADMIN_ROLES) | set(ALL_PLATFORM_ROLES)
    assert not (staff_side & set(PROJECT_ONLY_ROLES)), (
        "org_client and aekam_team are project-only roles. Neither is a reason "
        "to hand someone the firm's internal thread, so neither may appear in "
        "the staff-side set."
    )


# ── 2. The drawer's gates must admit the org's own administrators ──────────────

MEMBERSHIP_ONLY = re.compile(r"FROM\s+team_members\s+WHERE\s+team_id", re.I)


def test_drawer_gates_go_through_the_shared_helper():
    for path, fn in (("routers/time_entries.py", "_assert_task_access"),
                     ("routers/time_entries.py", "_assert_team_access"),
                     ("routers/activity.py", "task_activity"),
                     ("routers/activity.py", "team_activity")):
        body = _fn_source(path, fn)
        assert "may_reach_project" in body, (
            f"{path}:{fn} must ask may_reach_project. Asking team_members "
            f"directly is what refused an org_admin their own task's detail."
        )
        assert not MEMBERSHIP_ONLY.search(body), (
            f"{path}:{fn} still queries team_members inline. Two copies of an "
            f"access rule is how the drawer and the list came to disagree."
        )


def test_may_reach_project_scopes_the_admin_leg_to_the_projects_own_org():
    body = _fn_source("middleware/roles.py", "may_reach_project")
    assert "FROM teams WHERE team_id" in body, (
        "The admin leg must resolve the org from the PROJECT's team, not from "
        "the caller's active org — otherwise an admin of org A reaches org B's "
        "projects by switching the org selector."
    )
    assert "is_org_admin" in body, "The admin leg must go through is_org_admin."
    # A team with no org has no tenant to administer. Falling through to True
    # would admit every org admin in the database to those projects.
    assert "return False" in body, (
        "may_reach_project must fail closed for a team with no org_id and for a "
        "task with no team."
    )
