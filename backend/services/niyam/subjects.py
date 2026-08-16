"""One place that decides what each event TYPE looks like.

Every emitter goes through a function here rather than calling `emit_event`
with a hand-built payload. The reason is the defect this whole design exists to
fix: the old engine's four callers each passed a different, thinner context —
`{task_id, team_id}` from one, a little more from another — so a condition on
`priority` was evaluable from no caller at all, and the rule that used one
simply never fired while showing as Active for ever.

A condition builder can only offer fields the event is guaranteed to carry.
"Guaranteed" is a promise about every emitter at once, so it has to be made in
one file. If a new call site cannot fill the shape below, that is the signal
that it is not the same event.

Payload keys are the FIELD NAMES a rule author sees. They are part of the
product's contract with saved rules, not an implementation detail: renaming one
silently breaks every stored rule that compares it, so a rename is a migration.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from .emit import emit_event

#: Event type strings. Named constants because they are compared in three
#: places — the emitter, the rule's trigger, and the condition registry — and a
#: typo in any of them is a rule that silently never fires.
TASK_CREATED = "task.created"
TASK_STATUS_CHANGED = "task.status_changed"
CONTACT_CREATED = "contact.created"
DEAL_STAGE_CHANGED = "deal.stage_changed"

#: TEMPORAL events. Nothing in the product "does" these — no user action makes a
#: task overdue; a boundary passes and the fact becomes true. They are emitted by
#: the sweep with `source='sweep'` and no actor, which is exactly what the
#: `niyam_events_actor_ck` constraint permits and what it exists to distinguish
#: from an unattributable `app` write.
TASK_OVERDUE = "task.overdue"
APPROVAL_PENDING = "approval.pending"
INVOICE_OVERDUE = "invoice.overdue"
CONTACT_STALE = "contact.stale"


def _task_fields(row: Optional[Mapping[str, Any]]) -> dict:
    """The comparable half of a task row.

    This IS the answer to "which conditions may a task rule offer". Everything
    here is a scalar a typed operator can compare; the description, the
    subtasks and the attachments are deliberately absent because no condition
    can usefully compare them and carrying them would put the product's content
    in an event log with its own retention window.
    """
    if not row:
        return {}
    assignees = row.get("assignee_user_ids") or []
    # `due_at`, NOT `due_date`. There is no `due_date` column on `tasks` — the
    # column is `due_at`, and an earlier draft of this file read the name that
    # does not exist. `_clean` preserves None, so the key was PRESENT AND NULL
    # in every event ever emitted: indistinguishable from a task with no
    # deadline, and a "due within 2 days" rule would have matched nothing while
    # looking perfectly correct in the builder. `deadline_agent.py` lost a whole
    # agent to this same two-letter difference.
    #
    # The key is named for the column for the same reason. FilterBuilder already
    # calls this field `due_at` on the frontend, and two names for one concept
    # across the two surfaces a rule author moves between is exactly how the old
    # builder came to offer conditions its engine could not evaluate.
    due = row.get("due_at")
    return {
        "status": row.get("status"),
        "priority": row.get("priority"),
        "title": row.get("title"),
        "project_id": row.get("team_id"),
        "column_id": row.get("column_id"),
        "category_id": row.get("category_id"),
        "due_at": due.isoformat() if hasattr(due, "isoformat") else due,
        "assignee_count": len(assignees) if isinstance(assignees, (list, tuple)) else 0,
        # The list, not just the count: "assigned to Priya" is one of the
        # conditions people most want, and the old builder offered it against
        # an event that never carried it.
        "assignee_user_ids": list(assignees) if isinstance(assignees, (list, tuple)) else [],
        "approval_status": row.get("approval_status"),
        # `created_by_user_id`, NOT `user_id`. Both columns exist, which is why
        # this was wrong and looked right: `tasks.user_id` is the owner of a
        # PERSONAL task and is NULL for every project task, so "notify whoever
        # created it" would have resolved to nobody on precisely the rows a rule
        # runs against. Personal tasks carry no team_id, so they resolve to no
        # org and emit nothing at all — meaning the old key was null in 100% of
        # emitted events.
        "created_by": row.get("created_by_user_id"),
    }


async def task_created(conn, *, org_id, actor_id, task_id, row) -> Optional[int]:
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=TASK_CREATED,
        actor_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        after=_task_fields(row),
    )


async def task_status_changed(
    conn, *, org_id, actor_id, task_id, old_row, new_row,
) -> Optional[int]:
    """Emitted by EVERY path that writes `tasks.status`, and there are five.

    Two of them — the Kanban drag and the done-toggle — emitted nothing at all
    under the old engine, which is why a rule on "status becomes Done" fired
    from the edit form and not from the board. Automation that works sometimes
    is worse than automation that does not work, because nobody reports it.

    `before` carries the full shape too, not just the old status: a rule that
    asks "was it previously blocked" is asking about `before.status`, and a
    rule that asks "did the assignee change in the same write" needs both.
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=TASK_STATUS_CHANGED,
        actor_id=actor_id,
        entity_type="task",
        entity_id=task_id,
        before=_task_fields(old_row),
        after=_task_fields(new_row),
    )


async def contact_created(conn, *, org_id, actor_id, contact_id, row, source="app") -> Optional[int]:
    """A CRM contact or lead.

    `source` is a real parameter here because this event genuinely arrives from
    four places: a person in the product, the public web form, a scraper
    import, and inbound email. The audit found two of the five writers emitting
    nothing; the fix is that they all call this, and the ones with no person
    behind them say `import` rather than inventing an actor.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=CONTACT_CREATED,
        source=source,
        actor_id=actor_id,
        entity_type="contact",
        # str(), because this one is a real uuid. `staging.graha_contacts.id` is
        # a UUID column while `tasks.task_id` is text, and `entity_id` binds
        # `$4::text` — asyncpg refuses to coerce a uuid.UUID into a text
        # parameter and raises DataError at bind time. `emit_event` contains
        # that inside its savepoint and returns None, so the CRM event would
        # simply never appear, with one line in a log nobody reads.
        entity_id=str(contact_id) if contact_id is not None else None,
        after={
            "contact_type": row.get("contact_type"),
            "source": row.get("source"),
            "company": row.get("company"),
            "client_id": str(row.get("client_id")) if row.get("client_id") else None,
            "assigned_to": row.get("assigned_to"),
            "has_email": bool(row.get("email")),
            "has_phone": bool(row.get("phone")),
        },
    )


async def deal_stage_changed(
    conn, *, org_id, actor_id, deal_id, old_stage, new_stage, row=None,
) -> Optional[int]:
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=DEAL_STAGE_CHANGED,
        actor_id=actor_id,
        entity_type="deal",
        entity_id=str(deal_id) if deal_id is not None else None,   # uuid — see contact_created
        before={"stage": old_stage},
        after={
            "stage": new_stage,
            "value": float(row["value"]) if row.get("value") is not None else None,
            "assigned_to": row.get("assigned_to"),
            "client_id": str(row.get("client_id")) if row.get("client_id") else None,
        },
    )


# ── temporal subjects ────────────────────────────────────────────────────────
#
# Emitted by `predicates.py` only. Each takes an explicit `dedupe_key` because
# a temporal fact is true continuously — a task is overdue every second of every
# day — and without a window the sweep would emit one event per tick and a rule
# would notify somebody every tick. The key makes "once per window" an INDEX
# (`niyam_events_dedupe_idx`) rather than a code path somebody has to remember.


async def temporal(conn, *, org_id, event_type, entity_type, entity_id,
                   dedupe_key, after) -> Optional[int]:
    """The one emitter for every temporal predicate.

    `source='sweep'` and NO actor, deliberately: nobody did this. Inventing an
    actor here would be the exact lie the actor column exists to prevent, and
    the CHECK constraint would accept it — `actor_id` is only mandatory for
    `app` events.
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=event_type,
        source="sweep",
        actor_id=None,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        dedupe_key=dedupe_key,
        after=after,
    )
