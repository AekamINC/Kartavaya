"""THE SIDEBAR SAID 3 AND THE PAGE LISTED NOTHING.

The owner reported it from his own screen. Measured live before the fix:

    Kasti Pranami   badge=3    page lists=0
    Kasti ORG       badge=18   page lists=0
    QA Org Admin    badge=3    page lists=0
    E2E Test Owner  badge=15   page lists=9

Three separate causes, all of the same shape — two readers of one number, each
with its own hand-written rule:

1.  The queue's FIRST arm (`approvals`, "create this task") admitted only
    `project_assignments`. Its second arm, the history and the stats all
    admitted `project_assignments` OR `team_members`. Live: 203 team_members
    rows, 92 project_assignments rows, **129 people in the first and not the
    second** — counted by the badge, shown an empty queue.

2.  The badge counted ONE of the queue's TWO sources. The queue returns
    `approvals` rows and `tasks.approval_status` rows concatenated; the badge
    counted only the second, so it could not have agreed even with a caller who
    passed both membership tests.

3.  The badge had no org predicate under a comment reading "Scoped:".
    `is_org_admin` chose the branch; neither branch filtered by org, so an
    admin in three organisations saw all three backlogs in one number.

This file is a SOURCE test, deliberately. Reproducing the bug against a
database needs two membership tables, two approval sources, three orgs and a
user who is in one table and not the other — and a fixture that elaborate is
one somebody edits to make a failure go away. What actually went wrong is that
four queries drifted apart in one file, and that is a property of the source.
"""
import ast
import inspect
import re

import pytest

import server


# The four readers of this surface, and the badge that must agree with them.
_READERS = (
    "list_pending_approvals",
    "approval_history",
    "approval_stats",
)


def _fn_source(name: str) -> str:
    return inspect.getsource(getattr(server, name))


def test_the_shared_rule_exists_and_admits_both_membership_tables():
    """`team_members` and `project_assignments` are two records of the same
    fact and neither is authoritative. Admitting one is how 129 people were
    counted and then shown nothing."""
    src = inspect.getsource(server._may_approve)
    assert "project_assignments" in src
    assert "team_members" in src
    # Authority, not membership: a plain member of a project does not approve
    # its work. The badge's old admin branch had no role test at all, which is
    # why its number was the largest of the four.
    assert src.count("role IN ('owner','admin')") >= 2


@pytest.mark.parametrize("fn", _READERS)
def test_no_reader_writes_its_own_membership_rule(fn):
    """The failure mode is not a missing helper — it is somebody inlining one
    more EXISTS beside it, which is exactly how these four drifted."""
    src = _fn_source(fn)
    inlined = re.findall(
        r"EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(?:public\.)?"
        r"(project_assignments|team_members)",
        src,
    )
    assert not inlined, (
        f"{fn} writes its own membership rule ({inlined}). Call `_may_approve` "
        f"instead — two readers of one number must not be able to disagree "
        f"about who may see it."
    )


@pytest.mark.parametrize("fn", _READERS)
def test_every_reader_is_org_scoped(fn):
    src = _fn_source(fn)
    assert "_org_scope(" in src, (
        f"{fn} has no org predicate. An owner who is admin in three "
        f"organisations must not see three companies on one screen."
    )


def test_the_badge_counts_both_sources_and_uses_the_shared_rule():
    """The badge lives on the notification poll, not on the approvals router,
    which is precisely why it was forgotten when the queue was fixed."""
    src = inspect.getsource(server)
    # Find the poll handler by the key it returns.
    start = src.index('"approvals": approvals or 0')
    window = src[max(0, start - 3000):start]

    assert "_may_approve(" in window, (
        "the badge does not use the shared membership rule"
    )
    assert "_org_scope(" in window, (
        "the badge has no org predicate — the exact defect a comment reading "
        "'Scoped:' concealed"
    )
    # BOTH sources. Counting one is cause (2) above.
    assert "public.approvals" in window and "public.tasks" in window, (
        "the badge must count `approvals` AND `tasks.approval_status` — the "
        "queue concatenates both, so counting one cannot match it"
    )


def test_the_approvals_surface_qualifies_its_schema():
    """`tasks`, `approvals`, `team_members` and `project_assignments` live in
    `public`; the modules live in `staging`. Which table an unqualified name
    resolves to depends on `search_path` under PgBouncer — and this database is
    shared with production. `routers/reports.py` had the same defect and a
    ratchet was written for it there; this is that ratchet, here.
    """
    src = inspect.getsource(server._may_approve)
    for table in ("project_assignments", "team_members"):
        for m in re.finditer(rf"FROM\s+(\S*){table}", src):
            assert m.group(1) == "public.", (
                f"{table} is referenced unqualified in _may_approve"
            )


def test_may_approve_binds_its_parameters():
    """Built by f-string, so it is worth pinning that only a column NAME and a
    parameter INDEX are interpolated — never a value."""
    tree = ast.parse(inspect.getsource(server._may_approve))
    fn = tree.body[0]
    args = [a.arg for a in fn.args.args]
    assert args == ["team_col", "idx"], (
        "if _may_approve ever takes a value, it stops being a fragment and "
        "starts being an injection site"
    )
