"""A revoked admin must not still be an admin.

`users.role` is the legacy admin flag, and the JWT carries it. So
`user.get("role") == "admin"` asks what the column said WHEN THE TOKEN WAS
MINTED — not what it says now. Two consequences, and the second is the one that
matters: the power outlived revocation for the life of the token, and a JWT
claim cannot be scoped to an organisation at all.

Three write paths in server.py still asked it after the rest of the codebase had
moved on (middleware/roles.py:135-156, approvals_router, get_visible_team_ids):

  · DELETE /api/tasks/{task_id}  — a PERMANENT delete of any task in the
    database, with no org and no team predicate anywhere on the path
  · PATCH  /api/tasks/{id}/comments/{id}
  · DELETE /api/tasks/{id}/comments/{id}

Measured before the change: six accounts held users.role='admin', all six
vendor-controlled — so this was reachable by Aekam staff rather than
customer-to-customer. That lowers the grade and does not change the fix.
"""
import pathlib
import re

SRC = (pathlib.Path(__file__).resolve().parent.parent / "server.py").read_text(encoding="utf-8")
CODE = "\n".join(l for l in SRC.splitlines() if not l.strip().lstrip("#").startswith("#")
                 and not l.strip().startswith("#"))


def test_no_write_path_trusts_the_role_claim_on_the_token():
    """THE regression, swept rather than pinned to three line numbers."""
    hits = re.findall(r'user\.get\("role"\)\s*!=\s*"admin"', CODE)
    assert not hits, (
        f"{len(hits)} write path(s) still authorise from the JWT's role claim, which "
        "survives revocation and cannot be scoped to an org"
    )


def test_the_three_repaired_handlers_read_the_role_at_request_time():
    for fn in ("delete_task", "edit_comment", "delete_comment"):
        i = CODE.index(f"async def {fn}(")
        body = CODE[i:i + 1400]
        assert "is_org_admin(" in body, f"{fn} no longer has an admin escape hatch at all"


def test_the_delete_still_refuses_a_stranger():
    """
    Removing the JWT shortcut must not remove the ordinary check underneath it —
    a delete that anyone can call is worse than one a stale token can call.
    """
    i = CODE.index("async def delete_task(")
    body = CODE[i:i + 1400]
    assert "project_assignments" in body
    assert '403' in body


def test_is_org_admin_reads_the_database_not_the_token():
    """
    Pins the premise. If is_org_admin ever starts reading a claim, these three
    fixes silently become the bug they replaced.
    """
    roles = (pathlib.Path(__file__).resolve().parent.parent / "middleware" / "roles.py").read_text(encoding="utf-8")
    i = roles.index("async def is_org_admin(")
    body = roles[i:i + 1800]
    assert "staging.user_roles" in body
    assert 'user.get("role")' not in body
