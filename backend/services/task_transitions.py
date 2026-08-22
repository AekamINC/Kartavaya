"""
task_transitions.py — THE task state machine, written down once.

WHY THIS FILE EXISTS
────────────────────
`tasks.status` was an unvalidated `Optional[str]` (server.py TaskUpdate) and SIX
code paths wrote it. ALL SIX now call `assert_transition`:

  1. POST   /api/v1/tasks                    server.py create_task
  2. PUT    /api/v1/tasks/{id}               server.py update_task  (+ its PATCH alias)
  3. PATCH  /api/v1/tasks/{id}/toggle        server.py toggle_task
  4. PATCH  /api/v1/tasks/{id}/move          server.py move_task
  5. PATCH  /api/v1/tasks/bulk               routers/tasks_bulk.py
  6. automation action `change_status`       services/automation_engine.py

None of them checked the value. Paths 5 and 6 stayed unchecked one batch longer
than the rest, and 5 was the one that mattered most: `BulkBar.jsx` built its
"Set status" menu from all six keys of `STATUS_LABELS` and patched straight
through the bulk route, so THE PRODUCT'S OWN STATUS-SETTING UI walked around
every refusal the other four made. Measured before this fix, as a non-approver
on a project with `requires_approval=TRUE`:

    PUT   /api/tasks/{id}     {"status":"done"}      → 403 NEEDS_APPROVER
    PATCH /api/v1/tasks/bulk  {"status":"done"}      → 200, row written
    PATCH /api/v1/tasks/bulk  {"status":"requested"} → 200, row written

That second value is the corrupting one: `requested` means "a client asked for
this to exist and it has not been approved into being", and its decline path is
`DELETE FROM tasks WHERE task_id=$1 AND status='requested'` (server.py
review_approval). Setting it by hand made an ordinary task deletable by an
unrelated approval decision. A gate four routes honour and the fifth ignores is
not a gate; it is a longer way round.

Four hand-written guards is how guards drift, and this repo already has that
scar: role checks were hardcoded tuples in five files and the one missed call
site failed silently in whichever direction was wrong. So: one module, one
predicate, called by every path that writes the column.

THE SIXTH PATH HAS NO PERSON BEHIND IT
──────────────────────────────────────
An automation runs detached, after the fact, with no request and no user. Any
team member can create one (`routers/automations.py` gates on `require_user`
plus team access, not on a project role), so "when priority is urgent →
change_status done" is a rule-shaped way to mark work done. `user=None` is
therefore accepted here and answers `is_task_approver` with **False**: a robot
is not an approver, and on an approval-gated project the action is refused and
reported on the automation's own result row rather than writing silently. Rules
A–C apply to it exactly as they do to a person.

THE VOCABULARY IS FIVE, NOT SIX
───────────────────────────────
Measured against the live database (public.tasks, 633 rows) on 2026-08-06:

    done 319 · todo 193 · in_progress 67 · in_review 54

`requested` 0 rows, `rejected` 0 rows. No path writes `rejected` at all — only
`approval_status='rejected'` is ever written (server.py, approvals_router.py) —
so it is retired here rather than carried forward as a sixth state that exists
only in a colour map.

`requested` is kept, because the client task-request flow really does create
rows in it (server.py request_task_creation: `INSERT … status='requested'`), but
it is DISJOINT from the pipeline. It is not "changes requested" — the design
blueprint uses that word for an approver bouncing work back, and the build uses
it for "not a task yet". Same string, incompatible meanings. The bounce-back
already exists and is correct: it is `approval_status='rejected'`, with its
mandatory-reason 400, in approvals_router.reject_task. It is not duplicated here.

WHAT IS REFUSED (and nothing else)
──────────────────────────────────
  A. A status that is not one of the five.            → 400
  B. Moving a task INTO `requested`.                  → 400
  C. Changing the status of a task that IS `requested`. → 400
  D. Entering `done` on a project whose owner turned
     the approval requirement on, by someone who is
     not an approver for that project.                → 403

A, B and C cannot refuse anything that works today: the live data holds only the
four pipeline states, so no existing row can be the subject of C, and B/A only
ever fired on values that corrupted data.

D is the one behavioural gate, and it is INERT until somebody deliberately turns
it on. `teams.requires_approval` is added by migration 117 with
`DEFAULT false` and **no backfill** — see that file for why the 41 task-level
`requires_approval=TRUE` rows are not propagated. Until the migration is applied
`_teams_has_policy_column()` reports False and the gate is skipped entirely, so
this module is a no-op on an unmigrated database. That is deliberate: the
migration will be unapplied for a while, and the read path has to be correct on
both sides of it.

WHO IS AN APPROVER
──────────────────
NOT a module-tier `approver` grant. `middleware/role_tiers.py` lists "kartavya"
in `NO_APPROVER_MODULES`, and the RBAC spec's permission matrix renders the
Kartavya/Approver cell as an em-dash — a module-level approver check would deny
every user in the org, including the founder. The approver for a task is the
TIER-3 project role, which is already implemented as
`approvals_router.is_project_owner` (`project_assignments.role` in
owner/admin), with org admin as the escape hatch. That predicate read
`team_members` OR `project_assignments` until the tenancy phase-2 cutover on
2026-08-22; migration 195 had made the second a strict superset of the first at
identical roles, so dropping the first arm admitted and refused exactly the same
people. Exactly that predicate is
reused here so the gate and the Approvals queue cannot disagree about who may
decide.

REFUSALS ARE STRINGS
────────────────────
Every task and approval surface renders a refusal as
`e?.response?.data?.detail || '<fallback>'` into a toast title or message
(TaskDrawer.jsx, ApprovalsPage.jsx). A Pydantic `Literal` on the field would
have produced FastAPI's `RequestValidationError`, whose `detail` is a LIST of
dicts — dropping that into a toast renders nothing or throws. So the guard lives
here and raises `HTTPException` with a plain sentence, and the client keeps ONE
code path for refusals instead of two.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ── The vocabulary ───────────────────────────────────────────────────────────

#: The ordered pipeline. Every edge between two LINE states is legal in both
#: directions — moving work backwards is a normal correction, not an error.
LINE = ("todo", "in_progress", "in_review", "done")

#: `requested` is a fifth status and is NOT on the line. See the docblock.
REQUESTED = "requested"

#: The complete set. `rejected` is deliberately absent.
TASK_STATUSES = LINE + (REQUESTED,)

#: The states a caller may put a task into. `requested` is written only by
#: `request_task_creation` and cleared only by `review_approval`, both of which
#: use raw SQL and neither of which is a caller-driven status change.
SETTABLE_STATUSES = LINE

#: The state the approval gate protects. Entering it is the decision an approver
#: is being asked to make, which is why the gate is on the destination and not
#: on one particular edge: `todo → done` skips the review just as thoroughly as
#: `in_review → done` does.
GATED_STATUS = "done"


# ── Refusal copy ─────────────────────────────────────────────────────────────
# One sentence each, and each one says what to do next. These reach the user
# verbatim through the toast; they are not log lines.

def _unknown(value: object) -> str:
    return (
        f"“{value}” is not a task status. A task can be To do, In progress, "
        "In review or Done."
    )


INTO_REQUESTED = (
    "A task cannot be moved into Requested. That state belongs to client task "
    "requests, which are created from the request form and cleared from Approvals."
)

OUT_OF_REQUESTED = (
    "This is a task request, not a task yet. Approve or decline it from "
    "Approvals and it will join the board."
)

NEEDS_APPROVER = (
    "This project requires approval before work is marked done. Ask a project "
    "owner or admin to approve it from Approvals."
)


# ── Is the project-level policy column there yet? ────────────────────────────
# Migration 117 is WRITTEN, NOT APPLIED — there is one `staging` schema and
# production writes to it too, so nothing in this repo applies its own DDL. The
# read path therefore has to be correct before AND after the migration lands.
#
# Probed once per process against information_schema rather than by catching an
# UndefinedColumn error per request: a failing query per task write is both a
# waste and, inside a transaction, a poisoned one.

_HAS_POLICY_COLUMN: Optional[bool] = None


def reset_schema_cache() -> None:
    """Forget the probe result. Tests use this; nothing in production calls it."""
    global _HAS_POLICY_COLUMN
    _HAS_POLICY_COLUMN = None


async def _teams_has_policy_column(pool) -> bool:
    global _HAS_POLICY_COLUMN
    if _HAS_POLICY_COLUMN is not None:
        return _HAS_POLICY_COLUMN
    try:
        found = await pool.fetchval(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name='teams' AND column_name='requires_approval' LIMIT 1"
        )
        _HAS_POLICY_COLUMN = bool(found)
    except Exception as exc:  # pragma: no cover - a probe must never 500 a write
        logger.warning("approval-policy column probe failed, gate stays off: %s", exc)
        _HAS_POLICY_COLUMN = False
    return _HAS_POLICY_COLUMN


async def project_requires_approval(pool, team_id: Optional[str]) -> bool:
    """Does this project require an approver to mark work done?

    False for a personal task (no project, so no project policy), and False on
    an unmigrated database. Never raises: a policy read that fails must not take
    down the task write it was guarding — it fails OPEN, because the alternative
    is that a schema hiccup freezes every board in the product.
    """
    if not team_id:
        return False
    if not await _teams_has_policy_column(pool):
        return False
    try:
        row = await pool.fetchrow(
            "SELECT requires_approval FROM teams WHERE team_id=$1", team_id
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("approval-policy read failed for %s, gate stays off: %s", team_id, exc)
        return False
    if not row:
        return False
    try:
        return bool(row["requires_approval"])
    except (KeyError, TypeError):
        return False


async def is_task_approver(pool, team_id: Optional[str], user: Optional[dict]) -> bool:
    """The SAME predicate the Approvals queue uses to decide who may act.

    Imported lazily: `approvals_router` pulls in `auth_router` and the FastAPI
    app wiring, and a top-level import here would drag that into every module
    that only wants the status vocabulary.
    """
    if not user or not user.get("user_id"):
        # No person — an automation. Checked BEFORE the personal-task branch so
        # a rule can never inherit "the owner is the owner" from a task that has
        # no project. Nobody is standing behind this write to be the approver.
        return False
    if not team_id:
        # A personal task has no project owner. Its owner is its owner.
        return True
    from approvals_router import is_project_owner
    from middleware.roles import is_org_admin

    if await is_project_owner(pool, team_id, user["user_id"]):
        return True
    return await is_org_admin(user["user_id"])


# ── The one validator ────────────────────────────────────────────────────────

def is_reopen(old_status: Optional[str], new_status: Optional[str]) -> bool:
    """True when a finished task is being un-finished.

    Reopening is ALLOWED — backward moves are normal — but it is a distinct
    event and every path that does it has to audit it. `toggle_task` flipped
    done→todo and wrote no activity event at all, so a completed task could be
    reopened with no trace; that is the reason this predicate is exported rather
    than inlined.
    """
    return old_status == "done" and new_status not in (None, "done")


async def _gate_answer(key, factory, cache: Optional[dict]):
    """Memoise one gate read for the life of a batch.

    A single `PATCH /api/v1/tasks/bulk` may carry 200 ids. Without this, moving
    a whole board column to Done would ask "does this project require approval"
    and "is this person an approver" once per row — up to 400 extra round trips
    for two answers that cannot change inside one transaction. The cache is
    created by the caller and dies with the request, so nothing is remembered
    across a policy change.

    `cache=None` (every single-task route) keeps the old behaviour exactly: one
    read, no dict, nothing to invalidate.
    """
    if cache is None:
        return await factory()
    if key not in cache:
        cache[key] = await factory()
    return cache[key]


async def assert_transition(
    pool,
    *,
    old_status: Optional[str],
    new_status: Optional[str],
    team_id: Optional[str],
    user: Optional[dict],
    cache: Optional[dict] = None,
) -> None:
    """Refuse an illegal status write. Returns None or raises HTTPException.

    `old_status=None` means creation. `new_status=None` means the caller is not
    touching the status, which is always fine. `user=None` means no person is
    behind the write — an automation — which can never satisfy the approver
    gate; see the module docblock.

    `pool` is anything with `fetchval`/`fetchrow`. `routers/tasks_bulk.py` hands
    in the CONNECTION it already holds rather than the pool: asking a pool for a
    second connection while holding one inside a transaction is how a busy pool
    deadlocks, and the reads here belong to that transaction anyway.

    `cache` is an optional per-batch memo — see `_gate_answer`.

    Raises with a plain-string `detail` so the existing toast path renders it —
    403 when the caller is the problem, 400 when the request is.
    """
    if new_status is None:
        return

    if new_status not in TASK_STATUSES:
        raise HTTPException(400, _unknown(new_status))

    if new_status == REQUESTED and old_status != REQUESTED:
        raise HTTPException(400, INTO_REQUESTED)

    if old_status == REQUESTED and new_status != REQUESTED:
        raise HTTPException(400, OUT_OF_REQUESTED)

    if new_status == GATED_STATUS and old_status != GATED_STATUS:
        # Both lookups go through the module globals on purpose: tests
        # monkeypatch `project_requires_approval` / `is_task_approver`, and a
        # local alias captured at import time would sail straight past them.
        gated = await _gate_answer(
            ("policy", team_id),
            lambda: project_requires_approval(pool, team_id),
            cache,
        )
        if gated:
            approver = await _gate_answer(
                ("approver", team_id),
                lambda: is_task_approver(pool, team_id, user),
                cache,
            )
            if not approver:
                raise HTTPException(403, NEEDS_APPROVER)


def status_from_column_name(name: Optional[str], is_done: bool, current: str) -> str:
    """Derive a status from the column a card was dragged into.

    Extracted from `move_task`, where it carried a real bug: the `"review"` test
    sat inside the same `or` chain as `"progress"`/`"doing"` and returned
    `in_progress`, so a column named plainly **“Review”** moved tasks to In
    progress and only a column with “approval” in its name reached `in_review`.
    Every board created from the default template has a Review column.

    Order matters: `is_done` wins over any name, and the review tests are
    checked BEFORE the progress tests so "In review" cannot be captured by a
    substring match on a word it does not contain.
    """
    if is_done:
        return "done"
    n = (name or "").lower()
    if "review" in n or "approval" in n:
        return "in_review"
    if "progress" in n or "doing" in n:
        return "in_progress"
    if "todo" in n or "to do" in n or "backlog" in n or "open" in n:
        return "todo"
    # An unrecognised column name is not a status statement. A card that was
    # already moving stays moving; anything else keeps what it had.
    return "in_progress" if current == "todo" else current
