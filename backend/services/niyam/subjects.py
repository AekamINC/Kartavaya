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

import hashlib
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
STOCK_LOW = "stock.low"
#: A configured threshold on an analytics-registry metric was breached (D7).
#: Emitted by services/niyam/metric_alerts.py, once per alert per day while
#: the breach holds. The payload carries the metric's key, label, the value
#: that tripped it and the threshold — numbers, never a person.
METRIC_THRESHOLD = "metric.threshold"
#: One event per org per day, carrying COUNTS ONLY. The aggregate-only shape
#: is DPDP by design: a single person's attendance is sensitive data that
#: lives behind Pahchan's own access rules, and an event log with its own
#: retention window is not a place it may leak into. `absent_count` is a
#: condition; "who" is a question the module answers to those allowed to ask.
#:
#: The same discipline extends to the pahchan WORKFLOW events below
#: (CORRECTION_*, ENROLL_REQUESTED): they carry counts, statuses and the
#: date under dispute — never a punch time, never a photo key, never anything
#: biometric, and never the free-text reason (an employee explaining a missed
#: punch writes things about their own day that belong behind Pahchan's access
#: rules, not in a rule engine's log).
ATTENDANCE_SUMMARY = "attendance.summary"

# ── the 2026-08 expansion ────────────────────────────────────────────────────
#
# Declared ahead of their emitters being wired into the routers, which is the
# normal order of things (see registry.UNWIRED — every name below starts life
# there and leaves in the same commit as its first call site). Grouped by the
# module that owns the write.

#: Finance (ganit). Money values are rendered to float by the emitters —
#: every money column in this product is DECIMAL and `_clean` silently drops
#: a Decimal, so an unrendered total is a condition that can never fire.
INVOICE_CREATED = "invoice.created"
PAYMENT_RECORDED = "payment.recorded"
INVOICE_PAID = "invoice.paid"
INVOICE_CANCELLED = "invoice.cancelled"

#: Sales (vikray).
ORDER_CREATED = "order.created"
ORDER_STATUS_CHANGED = "order.status_changed"
ORDER_FULFILLED = "order.fulfilled"
STOCK_ADJUSTED = "stock.adjusted"

#: CRM (graha) — beyond the two originals. A client is the COMPANY; a
#: conversion is a contact BECOMING attached to one, which is why
#: LEAD_CONVERTED carries `client_id` and not a person.
DEAL_CREATED = "deal.created"
CLIENT_CREATED = "client.created"
LEAD_CONVERTED = "lead.converted"

#: E-sign (web-only; `staging.sign_documents` / `staging.sign_signers`).
#: Signers are usually EXTERNAL parties acting through a token, with no user
#: account here — their events carry `source='import'` and no actor, the same
#: convention contact_created uses for writers with no person behind them.
DOCUMENT_SENT = "document.sent"
DOCUMENT_SIGNED = "document.signed"
DOCUMENT_DECLINED = "document.declined"
#: TEMPORAL: nobody "does" an expiry — a boundary approaches. Emitted by the
#: sweep with `source='sweep'` and NO actor, exactly like the temporal block
#: above. The predicate that finds near-expiry documents lives in
#: `predicates.py`; the emitter below is its shape.
DOCUMENT_EXPIRING = "document.expiring"

#: HR (manav).
LEAVE_REQUESTED = "leave.requested"
LEAVE_DECIDED = "leave.decided"
EMPLOYEE_JOINED = "employee.joined"
EMPLOYEE_EXITED = "employee.exited"
EXPENSE_CLAIMED = "expense.claimed"
EXPENSE_DECIDED = "expense.decided"

#: Payroll (vetana). Deliberately the thinnest payloads in this file: a
#: payroll run's totals are salary data, and salary data must not ride into
#: a rule engine whose events any rule author can condition on. A run is a
#: month, a headcount and a person who published it — nothing else.
PAYROLL_PUBLISHED = "payroll.published"
PAYSLIP_DISBURSED = "payslip.disbursed"

#: Attendance workflow (pahchan) — see the extended DPDP note on
#: ATTENDANCE_SUMMARY above. Statuses and dates only.
CORRECTION_REQUESTED = "correction.requested"
CORRECTION_DECIDED = "correction.decided"
#: `ENROLL_`, not `ENROLLMENT_`: the import-discipline ratchet substring-scans
#: imported names for model markers and "enroLLMent" contains one. The EVENT
#: string keeps the full word — it is data, not an import.
ENROLL_REQUESTED = "enrollment.requested"

#: Marketing (prachar).
CAMPAIGN_SENT = "campaign.sent"
CONTACT_UNSUBSCRIBED = "contact.unsubscribed"

#: WhatsApp (varta). The inbound webhook is Meta pushing at us — no product
#: user acts, so the event carries `source='import'` and no actor, and the
#: sender's number NEVER appears: only a hash of it (see whatsapp_inbound).
WHATSAPP_INBOUND = "whatsapp.inbound"

#: Analytics (dristi) — TEMPORAL. A row in `staging.dristi_scheduled_reports`
#: reaches its appointed day and hour; nobody "does" that, so it is swept like
#: every boundary fact above (`source='sweep'`, no actor, daily dedupe). This
#: event is what finally gives the schedules table a caller: the table shipped
#: in migration 027 and its dispatcher was a 501 stub from that day to this.
#: The payload carries the schedule's own settings and a recipient COUNT —
#: never the addresses, which stay in the row for `report.send` to re-read at
#: run time.
REPORT_DUE = "report.due"


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


# ── rendering helpers for the expansion emitters ─────────────────────────────
#
# `_clean` (emit.py) DROPS a value it cannot serialise — silently, with no log
# line. Every money column in this product is DECIMAL and every date column is
# a date/datetime, so an emitter that forwards a row value raw produces a
# payload key that is sometimes absent, which `read()` reports as MISSING and
# every operator refuses. These three make the rendering impossible to forget.


def _num(v) -> Optional[float]:
    """DECIMAL → float, preserving None."""
    return float(v) if v is not None else None


def _day(v):
    """date/datetime → ISO string, preserving None — the due_at lesson."""
    return v.isoformat() if hasattr(v, "isoformat") else v


def _id(v) -> Optional[str]:
    """uuid.UUID (or anything id-shaped) → str, preserving None.

    Same reason contact_created stringifies: asyncpg refuses to coerce a
    uuid.UUID into a text bind, and a uuid in a payload dict is unserialisable
    to `_clean`, which would drop the key without a word."""
    return str(v) if v is not None else None


# ═════════════════════════════════════════════════════════════════════════════
# Finance (ganit)
# ═════════════════════════════════════════════════════════════════════════════


def _invoice_fields(row: Optional[Mapping[str, Any]]) -> dict:
    """The trio every invoice event carries. `client_id`, not `contact_id`:
    a client is the COMPANY the money is about, and rules route on companies."""
    row = row or {}
    return {
        "invoice_number": row.get("invoice_number"),
        "total": _num(row.get("total")),
        "client_id": _id(row.get("client_id")),
    }


async def invoice_created(conn, *, org_id, actor_id, invoice_id, row) -> Optional[int]:
    """Emitted by the ganit invoice INSERT — the mutator, not the route.

    `doc_status`, deliberately: it defaults to 'final' and says nothing about
    editability (unpaid invoices are editable regardless — the product rule
    that keeps regressing), but "a draft was raised" vs "a final was raised"
    is a real thing a rule wants to distinguish. `invoice_type` is in the
    payload because a credit note is not a sale and a rule that congratulates
    the team on one is wrong.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=INVOICE_CREATED,
        actor_id=actor_id,
        entity_type="invoice",
        entity_id=_id(invoice_id),
        after={
            **_invoice_fields(row),
            "invoice_type": row.get("invoice_type"),
            "doc_status": row.get("doc_status"),
            "created_by": _id(row.get("created_by")),
        },
    )


async def payment_recorded(
    conn, *, org_id, actor_id, payment_id, payment_row, invoice_row,
) -> Optional[int]:
    """Emitted by `record_payment` after the invoice's running totals are
    updated — `invoice_row` is the invoice AS RE-READ after the payment
    applied, so `balance_due` is what is still owed, not what was.

    `balance_due` is the column's name and the same field invoice.overdue
    already offers — one vocabulary, or a rule author meets two names for one
    number. There is no gateway and never will be: this event is a person
    typing in money that arrived at the bank.
    """
    payment_row = payment_row or {}
    invoice_row = invoice_row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=PAYMENT_RECORDED,
        actor_id=actor_id,
        entity_type="payment",
        entity_id=_id(payment_id),
        after={
            "invoice_number": invoice_row.get("invoice_number"),
            "amount": _num(payment_row.get("amount")),
            # `payment_method`, the column (018's CHECK) — not "mode".
            "payment_method": payment_row.get("payment_method"),
            "client_id": _id(invoice_row.get("client_id")),
            "balance_due": _num(invoice_row.get("balance_due")),
        },
    )


async def invoice_paid(
    conn, *, org_id, actor_id, invoice_id, row, via, source="app",
) -> Optional[int]:
    """Emitted by whichever write takes `payment_status` to 'paid' — and there
    are exactly two: the last recorded payment, and bank reconciliation.

    `via` says which, because "paid" means different things to a rule: a
    recorded payment is a person's claim, a reconciliation is the bank's.
    A reconciliation import with no person behind it passes `source='import'`
    and no actor, the contact_created convention.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=INVOICE_PAID,
        source=source,
        actor_id=actor_id,
        entity_type="invoice",
        entity_id=_id(invoice_id),
        after={**_invoice_fields(row), "via": via},
    )


async def invoice_cancelled(conn, *, org_id, actor_id, invoice_id, row) -> Optional[int]:
    """Emitted by `cancel_invoice`. There is no `cancelled_by` column — the
    table records `cancelled_at` and a reason — so the payload's
    `cancelled_by` IS the actor, stated as a field because "tell the raiser
    when someone else cancels their invoice" needs it comparable, not just
    in the envelope. The free-text `cancel_reason` deliberately stays out.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=INVOICE_CANCELLED,
        actor_id=actor_id,
        entity_type="invoice",
        entity_id=_id(invoice_id),
        after={**_invoice_fields(row), "cancelled_by": _id(actor_id)},
    )


# ═════════════════════════════════════════════════════════════════════════════
# Sales (vikray)
# ═════════════════════════════════════════════════════════════════════════════


def _order_fields(row: Optional[Mapping[str, Any]]) -> dict:
    row = row or {}
    return {
        "order_number": row.get("order_number"),
        "total": _num(row.get("total")),
        # migration 136: orders point at the client COMPANY. Nullable on old
        # rows — `is_empty` answers that, honestly.
        "client_id": _id(row.get("client_id")),
    }


async def order_created(
    conn, *, org_id, actor_id, order_id, row, is_first_order,
) -> Optional[int]:
    """Emitted by the vikray order INSERT.

    `is_first_order` is not a column — the caller computes it (a COUNT of
    prior orders for the same `client_id`, inside the same transaction) and
    passes the answer, because "a new customer ordered" is the single most
    wanted sales rule and no row can answer it alone. A caller that cannot
    resolve a client passes False rather than guessing.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=ORDER_CREATED,
        actor_id=actor_id,
        entity_type="order",
        entity_id=_id(order_id),
        after={
            **_order_fields(row),
            "is_first_order": bool(is_first_order),
            "created_by": _id(row.get("created_by")),
        },
    )


async def order_status_changed(
    conn, *, org_id, actor_id, order_id, old_status, new_status, row,
) -> Optional[int]:
    """Emitted by EVERY write of `vikray_orders.status` — the task_status_changed
    lesson applies unchanged: a rule that fires from one status writer and not
    another is worse than no rule.

    `before` carries the full shape with the OLD status so "was it previously
    dispatched" is askable; `row` is the order row (either side of the write —
    the trio does not change with status).
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=ORDER_STATUS_CHANGED,
        actor_id=actor_id,
        entity_type="order",
        entity_id=_id(order_id),
        before={**_order_fields(row), "status": old_status},
        after={**_order_fields(row), "status": new_status},
    )


async def order_fulfilled(conn, *, org_id, actor_id, order_id, row) -> Optional[int]:
    """Emitted when an order reaches 'delivered' — a named event on top of the
    status change because "an order was fulfilled" is the moment follow-up
    rules (thank-you, feedback, reorder nudge) hang off, and asking authors to
    write `status is delivered` conditions spells the vocabulary into every
    rule that a future status rename would then silently break.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=ORDER_FULFILLED,
        actor_id=actor_id,
        entity_type="order",
        entity_id=_id(order_id),
        after=_order_fields(row),
    )


async def stock_adjusted(
    conn, *, org_id, actor_id, product_id, product_name,
    quantity_before, quantity_after,
) -> Optional[int]:
    """Emitted by the MANUAL stock adjustment write (the one that inserts a
    `vikray_stock_moves` row with reason 'manual_adjustment') — not by order
    fulfilment, whose movements are the order's story, not an adjustment.

    Before/after quantities as two payload numbers rather than a before/after
    envelope: the pair is what a shrinkage rule compares, and the stock row
    itself has only `quantity_on_hand`, so the caller passes both sides of
    the write it just made. `adjusted_by` is the actor (`stock_moves.created_by`
    stores the same person).
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=STOCK_ADJUSTED,
        actor_id=actor_id,
        entity_type="product",
        entity_id=_id(product_id),
        after={
            "product_name": product_name,
            "quantity_before": _num(quantity_before),
            "quantity_after": _num(quantity_after),
            "adjusted_by": _id(actor_id),
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# CRM (graha)
# ═════════════════════════════════════════════════════════════════════════════


async def deal_created(conn, *, org_id, actor_id, deal_id, row) -> Optional[int]:
    """Emitted by the graha deal INSERT. The shape mirrors deal_stage_changed's
    `after` — same fields, same types — so a rule author moving between the
    two deal events meets one vocabulary. `stage` is text, not a select, for
    the reason the registry states: the options are per-org pipeline rows.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=DEAL_CREATED,
        actor_id=actor_id,
        entity_type="deal",
        entity_id=_id(deal_id),
        after={
            "title": row.get("title"),
            "value": _num(row.get("value")),
            "stage": row.get("stage"),
            "client_id": _id(row.get("client_id")),
            "assigned_to": _id(row.get("assigned_to")),
            "created_by": _id(row.get("created_by")),
        },
    )


async def client_created(conn, *, org_id, actor_id, client_id, row) -> Optional[int]:
    """Emitted when a `graha_clients` row — the COMPANY, the thing that stays
    when contacts come and go — is created.

    `has_gstin` is a bool, never the GSTIN itself: a rule wants "unregistered
    client, nudge for details", and GSTIN is non-mandatory and blocks nothing,
    which is a product rule this event must not tempt anyone to re-litigate
    by making the value comparable.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=CLIENT_CREATED,
        actor_id=actor_id,
        entity_type="client",
        entity_id=_id(client_id),
        after={
            "name": row.get("name"),
            "has_gstin": bool((row.get("gstin") or "").strip()),
            "created_by": _id(row.get("created_by")),
        },
    )


async def lead_converted(conn, *, org_id, actor_id, contact_id, row) -> Optional[int]:
    """Emitted by the write that attaches a contact to a client company /
    flips its `contact_type` — pass the row AS CONVERTED, so `contact_type`
    is what the contact became and `client_id` is the company it now belongs
    to. `converted_by` is the actor: no column records the conversion, the
    PATCH's author is the fact.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=LEAD_CONVERTED,
        actor_id=actor_id,
        entity_type="contact",
        entity_id=_id(contact_id),
        after={
            "contact_type": row.get("contact_type"),
            "company": row.get("company"),
            "client_id": _id(row.get("client_id")),
            "converted_by": _id(actor_id),
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# E-sign (sign_documents / sign_signers — web-only, never a mobile surface)
# ═════════════════════════════════════════════════════════════════════════════


async def document_sent(conn, *, org_id, actor_id, document_id, row) -> Optional[int]:
    """Emitted by the send route's status write (`draft` → `sent`), by the
    person pressing send — the last moment an e-sign event HAS a product user
    as its actor. `signer_count` reads `signers_total`, which the create
    route sets from the signer list it just inserted.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=DOCUMENT_SENT,
        actor_id=actor_id,
        entity_type="document",
        entity_id=_id(document_id),
        after={
            "document_title": row.get("title"),
            "signer_count": _num(row.get("signers_total")),
            "sent_by": _id(actor_id),
        },
    )


async def document_signed(
    conn, *, org_id, document_id, row, signer_email, remaining_signers,
    source="import",
) -> Optional[int]:
    """Emitted by the token signing route. The signer is an EXTERNAL party
    with no account here, so there is no actor and `source='import'` — the
    contact_created convention for writers with no person behind them.

    `signer_email_domain` is derived HERE from the address and only the
    domain survives: "someone @bigclient.com signed" is a routable fact,
    the address itself is a person and stays in the module. The caller
    passes `remaining_signers` (signers_total − signers_completed, after
    this signature) because "that was the last one" is the rule everybody
    actually wants.
    """
    row = row or {}
    domain = None
    if signer_email and "@" in signer_email:
        domain = signer_email.rsplit("@", 1)[-1].strip().lower() or None
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=DOCUMENT_SIGNED,
        source=source,
        actor_id=None,
        entity_type="document",
        entity_id=_id(document_id),
        after={
            "document_title": row.get("title"),
            "signer_email_domain": domain,
            "remaining_signers": _num(remaining_signers),
        },
    )


async def document_declined(
    conn, *, org_id, document_id, row, declined_reason, source="import",
) -> Optional[int]:
    """Emitted by the token decline route — external signer, no actor,
    `source='import'`, same as document_signed.

    `declined_reason` is the one free-text field in this whole expansion,
    carried deliberately: it is the single fact the sender needs routed
    ("declined: price") and it already lives in `sign_signers.declined_reason`
    as the product's own record of the decline.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=DOCUMENT_DECLINED,
        source=source,
        actor_id=None,
        entity_type="document",
        entity_id=_id(document_id),
        after={
            "document_title": row.get("title"),
            "declined_reason": declined_reason,
        },
    )


async def document_expiring(
    conn, *, org_id, document_id, document_title, days_left, pending_signers,
    dedupe_key,
) -> Optional[int]:
    """SWEEP-EMITTED, actor NULL, `source='sweep'` — a temporal fact, not an
    action: nobody "does" an expiry, the signers' `expires_at` boundary
    approaches. The predicate that finds near-expiry documents belongs in
    `predicates.py` and is not written here; this is the shape it fills.

    `dedupe_key` is mandatory for the same reason every temporal emitter
    takes one: "expiring" is true continuously, and without a window the
    sweep would emit every tick.
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=DOCUMENT_EXPIRING,
        source="sweep",
        actor_id=None,
        entity_type="document",
        entity_id=_id(document_id),
        dedupe_key=dedupe_key,
        after={
            "document_title": document_title,
            "days_left": _num(days_left),
            "pending_signers": _num(pending_signers),
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# HR (manav)
# ═════════════════════════════════════════════════════════════════════════════
#
# Every event here carries `employee_user_id` — `manav_employees.user_id`, the
# LOGIN of the employee the row is about, resolved by the caller from the
# employee row and passed explicitly. It is nullable in the table (not every
# employee has a login) and therefore nullable here; `is_empty` answers that.
# It is a `users` id, never a `manav_employees` id, because rules notify
# people and only a user id can be notified.


async def leave_requested(
    conn, *, org_id, actor_id, request_id, row, employee_user_id,
) -> Optional[int]:
    """Emitted by the leave-request INSERT.

    `leave_type_id`, the column — the type NAMES live in `manav_leave_types`,
    per-org rows like pipeline stages, so the builder resolves options per org
    the way it already does for Client and Project. The free-text `reason`
    stays in the module. `days` is DECIMAL(4,1) — half-days are real.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=LEAVE_REQUESTED,
        actor_id=actor_id,
        entity_type="leave_request",
        entity_id=_id(request_id),
        after={
            "leave_type_id": _id(row.get("leave_type_id")),
            "days": _num(row.get("days")),
            "start_date": _day(row.get("start_date")),
            "employee_user_id": _id(employee_user_id),
            "requested_by": _id(actor_id),
        },
    )


async def leave_decided(
    conn, *, org_id, actor_id, request_id, row, decision, employee_user_id,
) -> Optional[int]:
    """Emitted by the approve/reject write. ONE event for both outcomes with
    `decision` in the payload — two event types would make "tell the employee
    either way" a two-rule chore, and the status CHECK says the vocabulary:
    'approved' or 'rejected'. The table stores the decider in `approved_by`
    whichever way it went; the payload calls it what it is.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=LEAVE_DECIDED,
        actor_id=actor_id,
        entity_type="leave_request",
        entity_id=_id(request_id),
        after={
            "leave_type_id": _id(row.get("leave_type_id")),
            "days": _num(row.get("days")),
            "decision": decision,
            "employee_user_id": _id(employee_user_id),
            "decided_by": _id(actor_id),
        },
    )


async def employee_joined(conn, *, org_id, actor_id, employee_id, row) -> Optional[int]:
    """Emitted by the employee INSERT — the onboarding moment. Department and
    designation are the two routable facts ("new joiner in Engineering →
    notify the lead"); everything else on that row is HR's business, and most
    of it (PAN, Aadhaar, bank details) must never be event material.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=EMPLOYEE_JOINED,
        actor_id=actor_id,
        entity_type="employee",
        entity_id=_id(employee_id),
        after={
            "department": row.get("department"),
            "designation": row.get("designation"),
            "employee_user_id": _id(row.get("user_id")),
        },
    )


async def employee_exited(
    conn, *, org_id, actor_id, employee_id, row, exit_type,
) -> Optional[int]:
    """Emitted when offboarding completes. `exit_type` comes from the
    `manav_offboarding` row (its CHECK is the vocabulary — resignation,
    termination, retirement, end_of_contract, abandonment, redundancy,
    death), passed by the caller since the employee row alone does not carry
    it; `row` is the employee. The voluntary/involuntary split is the one
    every attrition rule needs.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=EMPLOYEE_EXITED,
        actor_id=actor_id,
        entity_type="employee",
        entity_id=_id(employee_id),
        after={
            "department": row.get("department"),
            "exit_type": exit_type,
            "employee_user_id": _id(row.get("user_id")),
        },
    )


async def expense_claimed(
    conn, *, org_id, actor_id, claim_id, row, employee_user_id,
) -> Optional[int]:
    """Emitted by the `manav_expense_claims` INSERT (the EMPLOYEE claim —
    not ganit's client-billable expenses, a different table and a different
    story). `category` is text: the column has no CHECK and defaults to
    'other', so a select would hardcode a vocabulary the data does not keep.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=EXPENSE_CLAIMED,
        actor_id=actor_id,
        entity_type="expense_claim",
        entity_id=_id(claim_id),
        after={
            "amount": _num(row.get("amount")),
            "category": row.get("category"),
            "employee_user_id": _id(employee_user_id),
        },
    )


async def expense_decided(
    conn, *, org_id, actor_id, claim_id, row, decision, employee_user_id,
) -> Optional[int]:
    """Emitted by the approve/reject write on a claim — one event, `decision`
    in the payload, same reasoning as leave_decided. 'paid' is NOT a decision:
    it is Vetana disbursing later, and a rule about payout timing belongs on
    payroll events.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=EXPENSE_DECIDED,
        actor_id=actor_id,
        entity_type="expense_claim",
        entity_id=_id(claim_id),
        after={
            "amount": _num(row.get("amount")),
            "decision": decision,
            "employee_user_id": _id(employee_user_id),
            "decided_by": _id(actor_id),
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# Payroll (vetana)
# ═════════════════════════════════════════════════════════════════════════════


async def payroll_published(conn, *, org_id, actor_id, run_id, row) -> Optional[int]:
    """Emitted when a payroll run is approved/published.

    NO TOTALS, DELIBERATELY. `vetana_payroll_runs` carries total_gross,
    total_net and five more money columns, and none of them ride: salary data
    must not flow into a table every rule author can condition on and every
    notification template can interpolate. A run, for rule purposes, is a
    month, a headcount and who published it. `month` is the column's own name
    and shape ('2026-08').
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=PAYROLL_PUBLISHED,
        actor_id=actor_id,
        entity_type="payroll_run",
        entity_id=_id(run_id),
        after={
            "month": row.get("month"),
            "employee_count": _num(row.get("employee_count")),
            "published_by": _id(actor_id),
        },
    )


async def payslip_disbursed(
    conn, *, org_id, actor_id, run_id, month, employee_count,
) -> Optional[int]:
    """Emitted ONCE per disbursement — the entity is the RUN, never a payslip.

    A per-payslip event would be a per-person salary fact with a name
    attached, which is exactly what the payroll payload rule above exists to
    keep out. `employee_count` is how many payslips the write just flipped
    to 'disbursed'; the caller counts them because the run row's own counter
    is the planned number, not the flipped one.
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=PAYSLIP_DISBURSED,
        actor_id=actor_id,
        entity_type="payroll_run",
        entity_id=_id(run_id),
        after={
            "month": month,
            "employee_count": _num(employee_count),
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# Attendance workflow (pahchan) — counts, statuses and dates ONLY.
# See the DPDP note on ATTENDANCE_SUMMARY: no punch times, no photo keys,
# nothing biometric, and never the employee's free-text reason.
# ═════════════════════════════════════════════════════════════════════════════


async def correction_requested(
    conn, *, org_id, actor_id, regularisation_id, row, employee_user_id,
) -> Optional[int]:
    """Emitted by the `pahchan_regularisations` INSERT.

    `for_date` is the column (the day under dispute). `reason_type` is
    DERIVED, not read: the table's `reason` is mandatory free text an
    employee writes about their own day, and it stays behind Pahchan's access
    rules — but `punch_id` being NULL vs set is the real split (the punch
    never existed vs an existing punch is wrong), and it is answerable from
    the row without carrying a word of the reason.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=CORRECTION_REQUESTED,
        actor_id=actor_id,
        entity_type="regularisation",
        entity_id=_id(regularisation_id),
        after={
            "for_date": _day(row.get("for_date")),
            "reason_type": "wrong_punch" if row.get("punch_id") else "missing_punch",
            "employee_user_id": _id(employee_user_id),
        },
    )


async def correction_decided(
    conn, *, org_id, actor_id, regularisation_id, row, decision, employee_user_id,
) -> Optional[int]:
    """Emitted by the approve/decline write. The vocabulary is 'approved' or
    'declined' — migration 064's CHECK, and NOT 'rejected'; the pahchan
    router has already tripped over that once. The decline's mandatory
    `decision_note` stays in the module with the rest of the free text.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=CORRECTION_DECIDED,
        actor_id=actor_id,
        entity_type="regularisation",
        entity_id=_id(regularisation_id),
        after={
            "for_date": _day(row.get("for_date")),
            "decision": decision,
            "employee_user_id": _id(employee_user_id),
            "decided_by": _id(actor_id),
        },
    )


async def enrollment_requested(
    conn, *, org_id, actor_id, employee_id, method, employee_user_id,
) -> Optional[int]:
    """Emitted when enrollment reference photos land awaiting HR approval.

    The entity is the EMPLOYEE, not the photo row — the photo's object key is
    biometric material and neither it nor anything about the image may ride.
    `method` reads `pahchan_enrollment_photos.source` ('hr_upload' |
    'self_capture'), renamed because `source` already means two things in
    this engine (the envelope's origin and CRM's lead source) and a third
    meaning is how the ENVELOPE_FIELDS note says vocabularies rot.
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=ENROLL_REQUESTED,
        actor_id=actor_id,
        entity_type="employee",
        entity_id=_id(employee_id),
        after={
            "employee_user_id": _id(employee_user_id),
            "method": method,
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# Marketing (prachar)
# ═════════════════════════════════════════════════════════════════════════════


async def campaign_sent(conn, *, org_id, actor_id, campaign_id, row) -> Optional[int]:
    """Emitted when a campaign's send actually STARTS moving mail — the
    status write to 'sent'/'sending', by the person who pressed send. This
    module's history demands the distinction: marketing "sent" nothing for
    months while every surface said it had. `recipient_count` reads
    `total_recipients`; the audience itself never rides.
    """
    row = row or {}
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=CAMPAIGN_SENT,
        actor_id=actor_id,
        entity_type="campaign",
        entity_id=_id(campaign_id),
        after={
            "campaign_name": row.get("name"),
            "channel": row.get("channel"),
            "recipient_count": _num(row.get("total_recipients")),
            "sent_by": _id(actor_id),
        },
    )


async def contact_unsubscribed(
    conn, *, org_id, actor_id, contact_id, channel, via, source="app",
) -> Optional[int]:
    """Emitted by both unsubscribe paths, which is why `via` exists: 'link'
    is the contact acting on themselves through the public unsubscribe URL
    (no actor — pass `source='import'`, actor None), 'manual' is a person in
    the product doing it for them (app + actor). Named `via`, not `source`,
    for the ENVELOPE_FIELDS collision reason. No email address rides — the
    contact id is the entity and that is enough for any rule.
    """
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=CONTACT_UNSUBSCRIBED,
        source=source,
        actor_id=actor_id,
        entity_type="contact",
        entity_id=_id(contact_id),
        after={
            "channel": channel,
            "via": via,
        },
    )


# ═════════════════════════════════════════════════════════════════════════════
# WhatsApp (varta)
# ═════════════════════════════════════════════════════════════════════════════


async def whatsapp_inbound(
    conn, *, org_id, message_id, phone_number, conversation_id,
    has_media, is_new_contact,
) -> Optional[int]:
    """Emitted by the Meta webhook handler — an external push, so no actor
    and `source='import'`.

    THE RAW NUMBER NEVER RIDES. The emitter takes it and hashes it here —
    digits only, then md5 truncated to 12 hex chars, the exact recipe the
    attendance predicate uses on org ids — so no caller can accidentally put
    a phone number into a log with its own retention window. A hash is
    enough: rules need "same sender" distinctness, never reversibility, and
    the digits-only normalisation makes '+91 98…' and '9198…' the same
    sender. Message CONTENT is banned twice over (`_BANNED_KEYS`); this
    event is "a message arrived", never what it said.
    """
    digits = "".join(ch for ch in (phone_number or "") if ch.isdigit())
    from_hash = hashlib.md5(digits.encode()).hexdigest()[:12] if digits else None
    return await emit_event(
        conn,
        org_id=org_id,
        event_type=WHATSAPP_INBOUND,
        source="import",
        actor_id=None,
        entity_type="whatsapp_message",
        entity_id=_id(message_id),
        after={
            "from_hash": from_hash,
            "conversation_id": _id(conversation_id),
            "has_media": bool(has_media),
            "is_new_contact": bool(is_new_contact),
        },
    )
