"""
tasks_bulk.py — `PATCH /api/v1/tasks/bulk` and `DELETE /api/v1/tasks/bulk`.

── Why this file exists ──────────────────────────────────────────────────────

`04-boards-table-views.md` §4 specifies both routes. Neither existed — the
backend had no bulk task surface at all — so `components/views/BulkBar.jsx`
fans out over the per-task endpoints with `Promise.allSettled` and says so in
its own header. Selecting forty rows and setting a status is forty round trips,
forty authorisation checks, forty activity rows and forty automation fires,
with no ordering guarantee and nothing stopping the selection from ending up
half-applied if the tab is closed midway.

BulkBar is deliberately left alone; `frontend/**` belongs to other agents this
batch. These routes are the destination, and the note in BulkBar's header —
"replace the fan-out the day the two bulk endpoints land" — is the handoff.

── Two properties that sound contradictory, and are not ──────────────────────

The brief asks for a batch that is TRANSACTIONAL and a result that is PER-ID.
Taken naively those fight: one transaction means all-or-nothing, and
all-or-nothing has nothing per-id to report.

They are reconciled with SAVEPOINTS. The batch opens one transaction on one
connection; each id runs inside a nested `conn.transaction()`, which asyncpg
implements as a savepoint. An id that fails — gone, forbidden, or rejected by a
constraint — rolls back to its own savepoint and is reported as failed; the
others are unaffected and commit together. So:

  · No half-applied selection from a dropped connection or a crashed worker.
    The whole applicable set lands or none of it does.
  · A row the caller may not touch does not poison the other thirty-nine.
  · The response names every id and why it failed, which is strictly more than
    `Promise.allSettled` can report — allSettled knows a request rejected, not
    whether the task was missing or the caller was refused.

Side effects — activity rows, automations, assignment pushes — are emitted
AFTER the commit, never inside it. Firing an automation for a transaction that
then rolls back is worse than firing it late.

── The narrow patch model, and why `extra="forbid"` ──────────────────────────

`BulkTaskPatch` is much smaller than `TaskUpdate`, and it FORBIDS UNKNOWN KEYS.

That second part is the important one. Pydantic's default is to drop keys the
model does not declare — silently, with a 200 and a success toast. A caller
that sends `assignees` instead of `assignee_user_ids`, or `dueAt` instead of
`due_at`, is told the write succeeded and the data is gone. That failure has
already happened once in this codebase, which is reason enough never to accept
it on a route that mutates a hundred rows at a time. Here a misspelt field is a
422 naming the offending key.

The field set is what a selection toolbar can meaningfully set across many
rows: status, column, priority, category, assignees, tags, due date. Absent on
purpose:

  · `title` / `description` — per-row prose. A bulk overwrite of forty titles
    is a data-loss button, not a feature.
  · `attachments` / `subtasks` / `custom_fields` — per-row structures; one
    value applied to a selection would clobber each row's own.
  · `approval_status` — it has its own authorisation rung in `update_task`
    (project owner/admin or org admin) and its own endpoints in
    `approvals_router.py`. Approving forty items from a toolbar is not a thing
    the UI offers, and a bulk route is the wrong place to introduce it.
  · `team_id` — moving tasks between projects changes who can see them. That is
    a visibility change wearing a bulk edit's clothes.

── Authorisation ─────────────────────────────────────────────────────────────

Per id, matching the single-task endpoints — a bulk route must never be the
cheap way around a check the singular route makes.

PATCH mirrors `server.update_task`: the task is reachable if it is in the
caller's visible teams, or they own it, or they created it.

DELETE mirrors `server.delete_task`'s RULE but not its IMPLEMENTATION. That
endpoint still tests `user.get("role") != "admin"` — the legacy JWT admin claim
that the RBAC overhaul replaced, and which survives in a token minted before
the flag was revoked. This file asks `middleware.roles.is_org_admin`, which
reads `staging.user_roles`. That is strictly NARROWER than the claim it
replaces, so nothing is widened by the difference; `server.py` belongs to
another agent and the divergence is reported rather than patched.

No role string is written in this file. Privilege questions go to
`middleware.roles`, which reads `staging.user_roles` and
`middleware/role_tiers.py`. See `API_CONTRACT_AUDIT.md` §"RBAC deviation" for
why these are `require_user` and not `require_platform_role`: bulk edit is a
customer-facing toolbar, and gating it on a platform-console role set would
leave it working for Aekam staff and dead for every firm that bought the
product.

── The org boundary ──────────────────────────────────────────────────────────

Visible teams are intersected with the ACTIVE org before anything is touched,
the same narrowing `routers/search.py` applies. A team carrying a different
`org_id` is dropped even when `get_visible_team_ids` returned it — which it can,
for platform staff and for users holding roles in more than one org.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import is_org_admin

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks-bulk"])

#: One selection. Large enough for "select all" on a full board, small enough
#: that the transaction does not sit on rows for seconds.
_MAX_IDS = 200


class _Refused(Exception):
    """
    A per-id refusal, carrying the status the singular endpoint would return.

    Raised inside a savepoint so the id rolls back alone. It is an exception
    rather than a return value because it has to unwind out of the nested
    `conn.transaction()` context for the savepoint to release — returning early
    would commit the savepoint on the way out.
    """

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class BulkTaskPatch(BaseModel):
    """
    The fields a selection toolbar may set. See the module header for what is
    deliberately absent and why.

    `extra="forbid"` is load-bearing, not tidiness: without it a renamed or
    misspelt key is dropped in silence and reported as success.
    """

    model_config = ConfigDict(extra="forbid")

    status: Optional[str] = None
    column_id: Optional[str] = None
    priority: Optional[str] = None
    category_id: Optional[str] = None
    assignee_user_ids: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    #: ISO-8601, or `null` to clear. `None` and "absent" are different here —
    #: see `_changes()`.
    due_at: Optional[str] = None


class BulkPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_ids: list[str] = Field(..., min_length=1, max_length=_MAX_IDS)
    patch: BulkTaskPatch

    @field_validator("task_ids")
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        # A duplicated id would otherwise get two result entries and two
        # activity rows for one row of data.
        seen, out = set(), []
        for i in v:
            i = (i or "").strip()
            if i and i not in seen:
                seen.add(i)
                out.append(i)
        if not out:
            raise ValueError("task_ids must contain at least one non-empty id")
        return out


class BulkDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_ids: list[str] = Field(..., min_length=1, max_length=_MAX_IDS)

    @field_validator("task_ids")
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        seen, out = set(), []
        for i in v:
            i = (i or "").strip()
            if i and i not in seen:
                seen.add(i)
                out.append(i)
        if not out:
            raise ValueError("task_ids must contain at least one non-empty id")
        return out


def _ok(task_id: str, **extra: Any) -> dict:
    return {"task_id": task_id, "ok": True, **extra}


def _err(task_id: str, status: int, error: str) -> dict:
    return {"task_id": task_id, "ok": False, "status": status, "error": error}


async def _allowed_team_ids(pool, user_id: str, org_id: str) -> set[str]:
    """
    The caller's visible teams, narrowed to the active org.

    Deferred import: `server.py` imports this router, so a module-level import
    of `server` would be circular. Reusing the helper rather than restating the
    visibility rule is the point — a bulk route that computes reachability
    differently from the task list is a bulk route that can reach further.
    """
    from server import get_visible_team_ids  # deferred: server imports this router

    visible = await get_visible_team_ids(pool, user_id)
    if not visible:
        return set()
    rows = await pool.fetch(
        "SELECT team_id FROM teams "
        "WHERE team_id = ANY($1::text[]) "
        "  AND deleted_at IS NULL "
        "  AND (org_id IS NULL OR org_id = $2::uuid)",
        list(visible), org_id,
    )
    return {r["team_id"] for r in rows}


def _changes(patch: BulkTaskPatch) -> dict[str, Any]:
    """
    Only the keys the caller actually sent.

    `exclude_unset` and not `exclude_none`: `{"due_at": null}` means CLEAR THE
    DUE DATE and `{}` means leave it alone. Collapsing the two would make
    "remove the deadline from these twelve tasks" unexpressible, and it is one
    of the four things the bar offers.
    """
    return patch.model_dump(exclude_unset=True)


def _build_update(changes: dict[str, Any]) -> tuple[str, list[Any]]:
    """
    Compose the SET clause. Column names come from this file's own closed set,
    never from caller input — `BulkTaskPatch` has already rejected anything
    else with a 422.
    """
    from utils import parse_dt  # deferred only to keep import order flat

    sets: list[str] = []
    vals: list[Any] = []

    for key in ("status", "column_id", "priority", "category_id"):
        if key in changes:
            vals.append(changes[key])
            sets.append(f"{key}=${len(vals)}")

    for key in ("assignee_user_ids", "tags"):
        if key in changes:
            vals.append(changes[key] or [])
            sets.append(f"{key}=${len(vals)}::text[]")

    if "due_at" in changes:
        vals.append(parse_dt(changes["due_at"]) if changes["due_at"] else None)
        sets.append(f"due_at=${len(vals)}")

    sets.append("updated_at=NOW()")
    return ", ".join(sets), vals


@router.patch("/bulk")
async def bulk_patch_tasks(
    body: BulkPatchRequest,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
) -> dict[str, Any]:
    """
    Apply one patch to many tasks in a single transaction.

    Returns a per-id result: `updated` counts rows that were applied, `failed`
    counts ids that were refused, missing, or rejected by the database, and
    `results` names each one. An id whose values already matched the patch is
    `ok` — the caller asked for a state and the row is in it. Reporting that as
    a failure would make BulkBar's "12 updated · 2 failed" toast lie about work
    that is, in fact, done.

    `status` on each successful row is the task's status AFTER the write, which
    is not always the status that was sent: moving into a column flagged
    `is_done` forces `done`, exactly as `server.update_task` does.
    """
    changes = _changes(body.patch)
    if not changes:
        raise HTTPException(400, "patch must contain at least one field to change")

    # `column_id` alone implies a status move in `update_task` (a column flagged
    # `is_done` forces status='done'). Bulk keeps that rule so a task dragged
    # into Done by the bar and one dragged by hand end up in the same state.
    pool = await get_pool()
    teams = await _allowed_team_ids(pool, user["user_id"], org_id)
    uid = user["user_id"]

    set_clause, base_vals = _build_update(changes)

    results: list[dict] = []
    # (task_id, old_status, new_status, old_assignees, new_assignees, team_id)
    effects: list[tuple] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            for task_id in body.task_ids:
                try:
                    async with conn.transaction():  # savepoint, per id
                        existing = await conn.fetchrow(
                            "SELECT task_id, team_id, user_id, created_by_user_id, "
                            "       status, assignee_user_ids "
                            "FROM tasks WHERE task_id=$1",
                            task_id,
                        )
                        if not existing:
                            raise _Refused(404, "Task not found")

                        reachable = (
                            (existing["team_id"] and existing["team_id"] in teams)
                            or existing["user_id"] == uid
                            or existing["created_by_user_id"] == uid
                        )
                        if not reachable:
                            # 404, not 403: the caller cannot see this task, so
                            # confirming it exists tells them something about
                            # another org's data.
                            raise _Refused(404, "Task not found")

                        vals = list(base_vals)
                        set_sql = set_clause
                        if "column_id" in changes and changes["column_id"] and "status" not in changes:
                            done = await conn.fetchval(
                                "SELECT is_done FROM project_columns WHERE column_id=$1",
                                changes["column_id"],
                            )
                            if done:
                                vals.append("done")
                                set_sql = f"{set_clause}, status=${len(vals)}"

                        vals.append(task_id)
                        row = await conn.fetchrow(
                            f"UPDATE tasks SET {set_sql} WHERE task_id=${len(vals)} "
                            "RETURNING task_id, team_id, status, assignee_user_ids",
                            *vals,
                        )
                except _Refused as refused:
                    results.append(_err(task_id, refused.status, refused.detail))
                    continue
                except Exception as exc:
                    log.warning("bulk patch: %s failed: %s", task_id, exc)
                    results.append(_err(task_id, 400, str(exc)))
                    continue

                old_status = existing["status"]
                new_status = row["status"]
                old_assignees = list(existing["assignee_user_ids"] or [])
                new_assignees = list(row["assignee_user_ids"] or [])
                results.append(_ok(task_id, status=new_status))
                effects.append(
                    (task_id, old_status, new_status, old_assignees, new_assignees, row["team_id"])
                )

    # ── After the commit ──────────────────────────────────────────────────
    # Activity, automations and pushes for work that is now durable. Inside the
    # transaction an automation could fire for a change that then rolled back.
    await _emit_patch_effects(pool, uid, user, effects, changes)

    updated = sum(1 for r in results if r["ok"])
    return {
        "requested": len(body.task_ids),
        "updated": updated,
        "failed": len(results) - updated,
        "results": results,
    }


@router.delete("/bulk")
async def bulk_delete_tasks(
    body: Optional[BulkDeleteRequest] = Body(default=None),
    ids: Optional[list[str]] = Query(default=None),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
) -> dict[str, Any]:
    """
    Delete many tasks in a single transaction, per-id authorised.

    Ids may arrive in a JSON body (`{"task_ids": [...]}`) or as repeated `?ids=`
    query parameters. Both are accepted because a DELETE with a request body is
    legal but not universally survivable — some proxies and fetch wrappers drop
    it — and a bulk delete that silently receives an empty id list is the worst
    possible thing to be ambiguous about. Sending neither is a 400; the route
    never treats "no ids" as "all".
    """
    task_ids: list[str] = []
    if body is not None:
        task_ids = body.task_ids
    elif ids:
        seen, task_ids = set(), []
        for i in ids:
            i = (i or "").strip()
            if i and i not in seen:
                seen.add(i)
                task_ids.append(i)
    if not task_ids:
        raise HTTPException(400, "Provide task_ids in the body or repeated ?ids= parameters")
    if len(task_ids) > _MAX_IDS:
        raise HTTPException(400, f"At most {_MAX_IDS} tasks may be deleted in one call")

    pool = await get_pool()
    uid = user["user_id"]
    teams = await _allowed_team_ids(pool, uid, org_id)
    org_admin = await is_org_admin(uid, org_id)

    results: list[dict] = []
    deleted_effects: list[tuple[str, Optional[str], str]] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            for task_id in task_ids:
                try:
                    async with conn.transaction():  # savepoint, per id
                        row = await conn.fetchrow(
                            "SELECT task_id, team_id, user_id, title FROM tasks WHERE task_id=$1",
                            task_id,
                        )
                        if not row:
                            raise _Refused(404, "Task not found")

                        if row["team_id"]:
                            if row["team_id"] not in teams:
                                raise _Refused(404, "Task not found")
                            if not org_admin:
                                member = await conn.fetchval(
                                    "SELECT role FROM project_assignments "
                                    "WHERE team_id=$1 AND user_id=$2",
                                    row["team_id"], uid,
                                )
                                # Same rule as `server.delete_task`: only a
                                # project owner or admin deletes other people's
                                # work. Deleting is not an edit.
                                if member not in ("owner", "admin"):
                                    raise _Refused(
                                        403, "Only a project admin or owner can delete tasks"
                                    )
                        else:
                            # Personal task — the owner, and nobody else. Not
                            # even an org admin: a personal task has no project
                            # for an admin to be an admin of.
                            if row["user_id"] != uid:
                                raise _Refused(404, "Task not found")

                        await conn.execute("DELETE FROM tasks WHERE task_id=$1", task_id)
                except _Refused as refused:
                    results.append(_err(task_id, refused.status, refused.detail))
                    continue
                except Exception as exc:
                    log.warning("bulk delete: %s failed: %s", task_id, exc)
                    results.append(_err(task_id, 400, str(exc)))
                    continue

                results.append(_ok(task_id))
                deleted_effects.append((task_id, row["team_id"], row["title"]))

    await _emit_delete_effects(pool, uid, deleted_effects)

    deleted = sum(1 for r in results if r["ok"])
    return {
        "requested": len(task_ids),
        "deleted": deleted,
        "failed": len(results) - deleted,
        "results": results,
    }


# ── Post-commit side effects ──────────────────────────────────────────────────


async def _emit_patch_effects(pool, uid: str, user: dict, effects: list[tuple], changes: dict):
    """
    Activity rows, automations and assignment pushes for a committed batch.

    Everything here is best-effort by construction — `log_event` swallows its
    own errors and `_bg` logs rather than raises — because a batch that already
    committed must not be reported as failed over a notification.
    """
    if not effects:
        return
    try:
        from server import _bg
        from services.activity_logger import log_assigned, log_event
        from services.automation_engine import fire_automations
    except Exception as exc:  # pragma: no cover
        log.warning("bulk: side-effect imports unavailable: %s", exc)
        return

    for task_id, old_status, new_status, old_assignees, new_assignees, team_id in effects:
        if old_status != new_status:
            await log_event(
                pool,
                task_id=task_id,
                actor_id=uid,
                event_type="status_changed",
                data={"from": old_status, "to": new_status, "via": "bulk"},
            )
            _bg(
                fire_automations(
                    pool,
                    "status_changed",
                    {
                        "task": {"task_id": task_id, "team_id": team_id},
                        "team_id": team_id,
                        "from": old_status,
                        "to": new_status,
                    },
                ),
                label="fire_automations",
            )
        if "assignee_user_ids" in changes:
            added = [u for u in new_assignees if u not in old_assignees]
            removed = [u for u in old_assignees if u not in new_assignees]
            if added or removed:
                await log_assigned(
                    pool, task_id=task_id, actor_id=uid, added=added, removed=removed
                )

    # One push per newly-assigned person for the whole batch, not one per task.
    # Forty tasks assigned at once is one action by one person; forty
    # notifications for it is the notification bug, not the feature.
    if "assignee_user_ids" in changes:
        newly = {
            u
            for _, _, _, old_a, new_a, _ in effects
            for u in new_a
            if u not in old_a and u != uid
        }
        if newly:
            try:
                from server import actor_display, _bg as _bg2
                from services.push_service import fan_out_push

                count = len(effects)
                _bg2(
                    fan_out_push(
                        pool,
                        recipient_ids=list(newly),
                        kind="assigned",
                        title=f"You were assigned to {count} {'task' if count == 1 else 'tasks'}",
                        body=f"Assigned by {actor_display(user, 'Someone')}.",
                        task_id=effects[0][0],
                        is_mine_for=newly,
                    ),
                    label="bulk_assignee_push",
                )
            except Exception as exc:
                log.warning("bulk: assignee push failed: %s", exc)


async def _emit_delete_effects(pool, uid: str, deleted: list[tuple[str, Optional[str], str]]):
    """
    A deleted task cannot carry an activity row — `activity_events.task_id`
    points at a row that is gone — so the event is recorded against the TEAM,
    which is what a project's history needs anyway: "these twelve were deleted".
    """
    if not deleted:
        return
    try:
        from services.activity_logger import log_event
    except Exception as exc:  # pragma: no cover
        log.warning("bulk: activity logger unavailable: %s", exc)
        return

    by_team: dict[str, list[str]] = {}
    for _task_id, team_id, title in deleted:
        if team_id:
            by_team.setdefault(team_id, []).append(title)
    for team_id, titles in by_team.items():
        await log_event(
            pool,
            team_id=team_id,
            actor_id=uid,
            event_type="tasks_deleted",
            data={"count": len(titles), "titles": titles[:20], "via": "bulk"},
        )
