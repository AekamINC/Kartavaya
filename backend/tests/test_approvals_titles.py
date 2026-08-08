"""A pending approval must arrive with something to call it.

MEASURED ON THE TABLET, 2026-08-07: the Today column's "Waiting on you" pane
listed three rows reading "Untitled task". That string is `api/approvals.
approvalTitle`'s honest fallback and the client was behaving correctly — the
RESPONSE was incomplete.

`/approvals/pending` has two arms. The task arm already selects `t.title AS
task_title`. The other arm was `SELECT a.*` from `approvals`, a table that HAS
a `task_id` column and no title — so the mobile client classified those rows as
task approvals (`isTaskApproval` tests `task_id`), looked for `task_title`, and
found nothing. Same shape as the audit log that could not name anyone: no
frontend change could have fixed it.
"""
import ast
import inspect
import textwrap

import server


def _sql(fn) -> str:
    """The function's string literals — its SQL. The comment above this query
    explains the bug and contains the words it asserts on."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    parts = [n.value for n in ast.walk(tree)
             if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    doc = ast.get_docstring(tree.body[0])
    if doc in parts:
        parts.remove(doc)
    return " ".join(" ".join(parts).split())


def test_both_arms_of_the_pending_queue_return_a_title():
    sql = _sql(server.list_pending_approvals)
    assert sql.count("task_title") >= 2, "one of the two arms still sends no title"


def test_the_request_arm_joins_the_task_and_falls_back_to_the_request():
    """This table carries BOTH kinds of row: one names an existing task, one is
    a request to create a task that does not exist yet and whose intended title
    is in `request_data`. Either alone would leave the other blank."""
    sql = _sql(server.list_pending_approvals)
    assert "LEFT JOIN tasks t ON t.task_id = a.task_id" in sql
    assert "a.request_data->>'title'" in sql


def test_the_join_is_LEFT_so_a_creation_request_is_not_dropped():
    """An inner join would silently shorten the queue by exactly the rows that
    have no task yet — which is the whole point of a creation request."""
    sql = _sql(server.list_pending_approvals)
    assert "LEFT JOIN tasks" in sql
    assert "INNER JOIN tasks" not in sql.upper()
