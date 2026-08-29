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


def _strip_prose(src: str) -> str:
    """Remove `#` comments AND docstrings, leaving executable code only.

    Docstrings were not stripped before, and that is not a nicety: the repaired
    `is_project_member` QUOTES the spelling it used to have, so a sweep reading
    the whole file would flag the explanation of the fix as the bug. A check
    that forbids writing down what was wrong is a check people route around.
    """
    src = re.sub(r'"""(?:.|\n)*?"""', '""', src)
    src = re.sub(r"'''(?:.|\n)*?'''", "''", src)
    return "\n".join(l for l in src.splitlines()
                     if not l.strip().lstrip("#").startswith("#")
                     and not l.strip().startswith("#"))


CODE = _strip_prose(SRC)


# ── THE SWEEP THAT WAS TOO NARROW ────────────────────────────────────────────
#
# This started life as `user\.get\("role"\)\s*!=\s*"admin"` — the exact spelling
# of the three handlers it was written for. It could not match
#
#     if user.get("role") in ("admin", "owner"):
#
# which is how `server.is_project_member` was written, and that helper was the
# worst instance of this very bug: it returned a synthetic `{"role":"admin"}`
# from the JWT claim with NO DATABASE QUERY AT ALL, making a stale token a
# project admin of every project in the database. It sailed straight past a test
# whose own docstring called itself "swept rather than pinned to three line
# numbers" — because it was pinned to three SPELLINGS instead.
#
# Now: any comparison of the token's `role` claim against an authorisation
# value, `==`/`!=`/`in`/`not in`. Exported so other suites can assert against
# the same pattern rather than writing a fourth copy of it.
ROLE_CLAIM_RE = re.compile(
    r'user\.get\(\s*["\']role["\']\s*(?:,[^)]*)?\)\s*'
    r'(?:[!=]=\s*["\'](?:admin|owner|superadmin)["\']'
    r'|(?:not\s+)?in\s*\(\s*["\'](?:admin|owner|superadmin)["\'])'
)

#: Reads that RESTRICT rather than escalate — `role == "client"` only ever
#: refuses, so a stale claim there fails safe. Named so the distinction is a
#: decision rather than a gap in a regex.
_RESTRICTING_SPELLINGS = ('user.get("role")=="client"', 'user.get("role") == "client"')


def test_no_write_path_trusts_the_role_claim_on_the_token():
    """THE regression, swept rather than pinned to three line numbers."""
    hits = ROLE_CLAIM_RE.findall(CODE)
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
    # The whole function, not a fixed 1800 characters. That window stopped
    # 1,564 characters short of the SELECT and was being satisfied by the
    # DOCSTRING, which names the table in prose — so the assertion passed
    # without ever reading the query it exists to pin.
    end = re.search(r"\n(?:async )?def ", roles[i + 10:])
    body = roles[i: i + 10 + end.start()] if end else roles[i:]
    # And the prose is stripped, so only CODE can satisfy it.
    code = re.sub(r'"""(?:.|\n)*?"""', "", body)
    code = "\n".join(ln for ln in code.splitlines()
                     if not ln.strip().startswith("#"))
    assert "public.user_roles" in code, (
        "is_org_admin no longer reads public.user_roles in its own SQL")
    assert 'user.get("role")' not in code
