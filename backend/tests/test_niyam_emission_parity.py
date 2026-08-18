"""Every writer of a watched column must emit.

── THE DEFECT THIS EXISTS TO PREVENT ────────────────────────────────────────

The old estate emitted from ROUTES, and the audit of 2026-08-16 measured the
cost: two of five lead-creation writers and two of four task-status writers
emitted nothing at all. One of the silent ones was the Kanban drag — the most
common status change in the product — so a rule on "status becomes Done" fired
when somebody used the edit form and not when they dragged the card.

Automation that works sometimes is worse than automation that never works,
because nobody knows to report it, and the bug looks like flakiness rather than
absence. The rule Niyam adopts instead is that emission belongs to whatever
owns the write.

── WHY A RATCHET AND NOT A CONVENTION ───────────────────────────────────────

A convention is kept by memory, and the failure mode is one plausible new
handler written in a hurry that looks correct in review. The house rule after
the orphan-selector incident is to ship a CHECK and prove it fails, so this
walks the actual source: every function containing a write to a watched
table/column is required to also contain an emit call, or to be named below
with a reason.

The scan is `ast`-based rather than grep. A watched string inside a comment or
a docstring is not a write — and a grep-based version of this check would flag
this very file.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent

#: (file, SQL fragment that identifies a write) -> the emit that must accompany
#: it. Fragments are matched against string literals in the function body, so
#: they must appear in the SQL as written.
WATCHED = [
    ("server.py", "UPDATE tasks SET status="),
    ("server.py", "INSERT INTO tasks"),
    # The 2026-08-18 sweep found three writers whose SQL begins with the
    # approval column and ALSO sets `status=` further along the same statement
    # — the one spelling this list did not know, so "when a task is finished"
    # rules never fired for an approval-driven finish. Watch the spelling in
    # both files that use it; writers that touch approval bookkeeping WITHOUT
    # moving `status` are named in EXEMPT, which is the reviewable act.
    ("server.py", "UPDATE tasks SET approval_status="),
    ("approvals_router.py", "UPDATE tasks SET approval_status="),
    ("approvals_router.py", "UPDATE tasks SET status="),
    # Closing a sales order wins the CRM deal. This write bypassed the deal
    # emitter for months — the same fact fired rules from the CRM board and
    # not from sales.
    ("routers/vikray.py", "SET stage='Won'"),
]

#: Functions allowed to write a watched column WITHOUT emitting, each with the
#: reason. Every entry is a decision somebody made on purpose; adding one is a
#: reviewable act, which is the whole point of naming them rather than counting.
EXEMPT = {
    # Restores a task from the bin. The status it writes is the status the task
    # already had before deletion, so nothing changed and no rule should fire
    # on a row simply reappearing.
    "restore_task",
    # Erases a project and everything under it. By the time this runs the rows
    # are going; a rule acting on a task that is about to stop existing would
    # be acting on nothing.
    "delete_team",
    "purge_team",
    # The recurring-task generator writes a fresh row with the template's
    # status. Its creation event is emitted by the same helper that creates any
    # task; a second one here would double every recurrence.
    "_spawn_recurrence",
    # Rejecting a task-level approval writes approval bookkeeping only —
    # `status` does not move, the task stays where it was, and a rule firing
    # on "nothing changed" would be noise.
    "_reject_task_approval",
    # Sending a task to the client for approval sets approval_status to
    # 'pending_client' and nothing else; the task's status is untouched until
    # the client decides.
    "_approve_task_send_client",
}

#: What counts as emitting. Any of these names being CALLED inside the function
#: satisfies the requirement.
EMITTERS = {"task_created", "task_status_changed", "contact_created", "deal_stage_changed", "emit_event"}


def _functions(path: Path):
    """Yield (name, node) for every function in a module, including nested."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield node.name, node


def _string_literals(node) -> str:
    """Every string constant in this function, concatenated.

    Docstrings are excluded: a docstring quoting `UPDATE tasks SET status=` is
    documentation, not a write, and treating it as one is how a checker starts
    flagging the comment that explains it.
    """
    body = node.body[1:] if (node.body and isinstance(node.body[0], ast.Expr)
                             and isinstance(node.body[0].value, ast.Constant)
                             and isinstance(node.body[0].value.value, str)) else node.body
    out = []
    for sub in body:
        for n in ast.walk(sub):
            if isinstance(n, ast.Constant) and isinstance(n.value, str):
                out.append(n.value)
            elif isinstance(n, ast.JoinedStr):
                for v in n.values:
                    if isinstance(v, ast.Constant) and isinstance(v.value, str):
                        out.append(v.value)
    return "\n".join(out)


def _calls(node) -> set[str]:
    names = set()
    for n in ast.walk(node):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name):
                names.add(f.id)
            elif isinstance(f, ast.Attribute):
                names.add(f.attr)
    return names


def _writers():
    """Every (file, function) that writes a watched column."""
    found = []
    for filename, fragment in WATCHED:
        path = BACKEND / filename
        for name, node in _functions(path):
            if fragment in _string_literals(node):
                found.append((filename, name, fragment, node))
    return found


# ── the detector proves itself first ─────────────────────────────────────────

def test_the_scanner_finds_a_write():
    """If this fails the ratchet is asleep: a scanner that matches nothing
    passes for ever and protects nothing. check-orphan-selectors shipped in
    exactly that state once and silently lost 677 selectors."""
    assert _writers(), "the scanner found no watched writes at all — it is broken, not the code"


def test_the_scanner_ignores_a_docstring():
    src = 'async def f():\n    """UPDATE tasks SET status=$1 — prose, not a write."""\n    return 1\n'
    node = ast.parse(src).body[0]
    assert "UPDATE tasks SET status=" not in _string_literals(node)


def test_the_scanner_sees_a_real_write():
    src = 'async def f(c):\n    await c.execute("UPDATE tasks SET status=$1", x)\n'
    node = ast.parse(src).body[0]
    assert "UPDATE tasks SET status=" in _string_literals(node)


def test_the_scanner_sees_an_emit_call():
    src = 'async def f(c):\n    await task_status_changed(c, org_id=1)\n'
    node = ast.parse(src).body[0]
    assert EMITTERS & _calls(node)


# ── and then the real tree ───────────────────────────────────────────────────

@pytest.mark.parametrize(
    "filename,func,fragment",
    [(f, n, fr) for f, n, fr, _ in _writers()],
    ids=lambda v: v if isinstance(v, str) else "",
)
def test_every_watched_writer_emits(filename, func, fragment):
    """A route that writes a watched column and emits nothing is invisible to
    every rule — the Kanban-drag defect, which shipped for months."""
    if func in EXEMPT:
        pytest.skip(f"{func} is exempt by name — see EXEMPT in this file")

    node = next(n for name, n in _functions(BACKEND / filename) if name == func)
    assert EMITTERS & _calls(node), (
        f"{filename}:{func} writes `{fragment}` and emits no Niyam event.\n"
        "Either call the matching services/niyam/subjects.py helper inside the "
        "same transaction as the write, or add the function to EXEMPT with the "
        "reason. A silent writer is a rule that fires for some gestures and not "
        "others — see docs/proposals/55-niyam-automation.html §3."
    )
