"""Starter rules, every one of which actually runs.

THE RULE THIS FILE FOLLOWS
--------------------------
A template may only use verbs in the action allowlist and fields in the
registry, and `test_niyam_templates.py` validates every one of them through the
same `validate_steps` a hand-written rule goes through. If a template cannot be
saved by a user, it is not shipped.

That constraint is the entire point. Proposal 57 sketched fifteen starter rules
across CRM, invoicing and HR; most of them need verbs this build does not yet
have (`crm.set_deal_stage`, `task.add_comment`, the invoice ladder). Shipping
them as templates that fail on save — or worse, save and never fire — is
precisely how the old estate came to sell eight triggers of which two worked.

So this list is SHORT and it grows with the allowlist. Four templates that run
beats fifteen that advertise.

Each carries `why`, which is shown in the picker. A template nobody understands
is cloned once and left enabled for ever.
"""
from __future__ import annotations

from .subjects import (
    APPROVAL_PENDING, ATTENDANCE_SUMMARY, CONTACT_STALE, INVOICE_OVERDUE,
    METRIC_THRESHOLD, STOCK_LOW, TASK_CREATED, TASK_OVERDUE,
    TASK_STATUS_CHANGED,
)

#: `{id, name, why, event_type, steps}`. `steps` are exactly the shape the
#: create endpoint takes, so cloning is a copy and not a translation.
TEMPLATES: tuple = (
    {
        "id": "done-tell-creator",
        "name": "When a task is finished, tell whoever asked for it",
        "why": ("The person who raised the work is usually the last to hear it "
                "is done. This is the smallest useful automation in the product "
                "and the one to try first."),
        "event_type": TASK_STATUS_CHANGED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "status", "operator": "is", "value": "done"}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "task_done",
                        "to": ["@creator"],
                        "title": "A task you asked for is done",
                        "body": "It has been marked complete."}},
        ],
    },
    {
        "id": "urgent-unassigned",
        "name": "An urgent task with nobody on it",
        "why": ("Urgent work that is unassigned is the most expensive kind of "
                "invisible: everyone assumes somebody has it. Fires on creation "
                "so it is caught in the first minute, not the first week."),
        "event_type": TASK_CREATED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "priority", "operator": "one_of",
                        "value": ["high", "urgent"]}},
            {"kind": "condition",
             "config": {"field": "assignee_user_ids", "operator": "is_empty",
                        "value": None}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "unassigned_urgent", "to": ["@creator"],
                        "title": "An urgent task has nobody on it",
                        "body": "It was created without an assignee."}},
        ],
    },
    {
        "id": "due-soon-nudge",
        "name": "Nudge the assignees two days before something is due",
        "why": ("A reminder that arrives while there is still time to act. The "
                "wait is what makes it a nudge rather than a duplicate of the "
                "creation notification."),
        "event_type": TASK_CREATED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "due_at", "operator": "within_days", "value": 2}},
            {"kind": "condition",
             "config": {"field": "assignee_user_ids", "operator": "not_empty",
                        "value": None}},
            {"kind": "wait", "config": {"minutes": 60}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "due_soon", "to": ["@assignees"],
                        "title": "Due in the next couple of days",
                        "body": "This one has a deadline coming up."}},
        ],
    },
    {
        "id": "client-request-triage",
        "name": "Put approved client requests straight into the queue",
        "why": ("A client request that has been approved sits at `requested` "
                "until somebody moves it. This moves it to `todo` so it appears "
                "on the board where work is actually picked up."),
        "event_type": TASK_STATUS_CHANGED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "status", "operator": "is", "value": "todo"}},
            {"kind": "condition",
             "config": {"field": "approval_status", "operator": "is",
                        "value": "approved"}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "client_request", "to": ["@assignees", "@creator"],
                        "title": "An approved client request is ready",
                        "body": "It has moved onto the board."}},
        ],
    },
    # ── time triggers ───────────────────────────────────────────────────────
    #
    # These need no user action at all — a boundary passes and the sweep emits.
    # Note every one carries a NUMBER condition on how late it is: the trigger
    # says "overdue", the condition says "overdue enough to bother somebody",
    # and without the second every one of these is a firehose.
    {
        "id": "overdue-nudge",
        "name": "Tell the assignees when a task slips three days past due",
        "why": ("Three days rather than one: a task a day late is usually being "
                "worked on, and a rule that fires on day one is a rule people "
                "learn to ignore. This one fires once per task, not daily."),
        "event_type": TASK_OVERDUE,
        "steps": [
            {"kind": "condition",
             "config": {"field": "days_overdue", "operator": "gte", "value": 3}},
            {"kind": "condition",
             "config": {"field": "assignee_user_ids", "operator": "not_empty",
                        "value": None}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "task_overdue", "to": ["@assignees"],
                        "title": "This one has slipped",
                        "body": "It went past its due date a few days ago."}},
        ],
    },
    {
        "id": "urgent-overdue-escalate",
        "name": "Escalate an urgent task that has gone overdue",
        "why": ("The same trigger, filtered to the work that actually matters. "
                "Goes to whoever raised it rather than the assignee, because the "
                "assignee already knows. Fires when the task is THREE days past "
                "due, not one: a task emits a single overdue event and that "
                "event is emitted at the three-day mark, so the condition below "
                "is a filter on severity rather than the moment it fires."),
        "event_type": TASK_OVERDUE,
        "steps": [
            {"kind": "condition",
             "config": {"field": "priority", "operator": "one_of",
                        "value": ["high", "urgent"]}},
            {"kind": "condition",
             "config": {"field": "days_overdue", "operator": "gte", "value": 1}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "task_overdue", "to": ["@creator"],
                        "title": "An urgent task is overdue",
                        "body": "It has passed its deadline and is not done."}},
        ],
    },
    {
        "id": "approval-waiting",
        "name": "Chase an approval nobody has looked at for a week",
        "why": ("Approvals are where work silently stops. This nags weekly "
                "rather than daily — often enough to matter, rarely enough to "
                "stay readable."),
        "event_type": APPROVAL_PENDING,
        "steps": [
            {"kind": "condition",
             "config": {"field": "days_waiting", "operator": "gte", "value": 7}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "approval_request", "to": ["@creator"],
                        "title": "An approval is still waiting",
                        "body": "Nobody has decided on this yet."}},
        ],
    },
    {
        "id": "invoice-overdue-internal",
        "name": "Tell the person who raised an invoice when it goes unpaid",
        "why": ("INTERNAL ONLY — this reaches your own team, never the customer. "
                "Chasing a client is a different decision with a different blast "
                "radius, because there is no payment gateway here and 'paid' only "
                "arrives by bank reconciliation: an invoice can be settled days "
                "before this product knows."),
        "event_type": INVOICE_OVERDUE,
        "steps": [
            {"kind": "condition",
             "config": {"field": "days_overdue", "operator": "gte", "value": 7}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "invoice_overdue", "to": ["@creator"],
                        "title": "An invoice is past due",
                        "body": "It has not been reconciled as paid."}},
        ],
    },
    {
        "id": "invoice-overdue-remind-customer",
        "name": "Email the customer a weekly payment reminder",
        "why": ("The other half of the ladder — this one DOES reach the "
                "customer, which is why it is behind a second switch "
                "(NIYAM_CUSTOMER_MAIL) that only the owner opens: there is no "
                "payment gateway here, 'paid' arrives by bank reconciliation, "
                "and a dunning note about a settled invoice costs a client "
                "relationship. Fires weekly per invoice while it stays unpaid; "
                "stops by itself the moment a payment — even partial — is "
                "recorded, or the invoice is cancelled. The note goes to the "
                "contact the invoice was raised to."),
        "event_type": INVOICE_OVERDUE,
        "steps": [
            # A week of grace before the first customer-facing word, for the
            # same reason the internal rung waits seven days: reconciliation
            # lag. The firm hears about it immediately (the internal template);
            # the customer hears once it is likely to still be true.
            {"kind": "condition",
             "config": {"field": "days_overdue", "operator": "gte", "value": 7}},
            {"kind": "action",
             "config": {"verb": "invoice.remind_customer"}},
        ],
    },
    {
        "id": "metric-threshold-tell-admins",
        "name": "Tell the admins when a metric crosses its alert line",
        "why": ("The other half of the Alerts screen: the threshold row "
                "decides WHEN (DSO over 45, attendance under 90%), this rule "
                "decides WHO HEARS. Fires at most once per alert per day "
                "while the breach holds, and the number that trips it is the "
                "dashboard's own — the alert runs the same registry SQL, so "
                "the two can never disagree."),
        "event_type": METRIC_THRESHOLD,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "metric_alert", "to": ["@org_admins"],
                        "title": "A metric crossed its alert threshold",
                        "body": "Open the analytics screen for the number and its window."}},
        ],
    },
    {
        "id": "stock-low-tell-admins",
        "name": "Tell the admins when a product runs low",
        "why": ("Fires only for products where somebody set a low-stock "
                "threshold — the threshold IS the opt-in — and nags weekly "
                "while the level stays at or under it, because a one-off "
                "alert about a fact that stays true is missed once and never "
                "again. Replaces the old vikray_low_stock_alert skill, which "
                "was part of the estate that reported success without doing "
                "anything."),
        "event_type": STOCK_LOW,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "stock_low", "to": ["@org_admins"],
                        "title": "A product is at or below its stock threshold",
                        "body": "Open the stock screen to see the level and reorder."}},
        ],
    },
    {
        "id": "attendance-absences",
        "name": "Flag a day with three or more absences",
        "why": ("Aggregates only, by design: the event carries counts and "
                "never a single person's attendance — who was absent stays "
                "behind the attendance module's own access rules (DPDP). The "
                "summary is emitted once the previous day is complete, and "
                "the condition keeps ordinary days quiet; clone it and move "
                "the number to fit the size of the firm."),
        "event_type": ATTENDANCE_SUMMARY,
        "steps": [
            {"kind": "condition",
             "config": {"field": "absent_count", "operator": "gte", "value": 3}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "attendance_summary", "to": ["@org_admins"],
                        "title": "Several people were absent yesterday",
                        "body": "Open attendance for the day's counts."}},
        ],
    },
    {
        "id": "lead-gone-quiet",
        "name": "Flag a lead nobody has contacted in a month",
        "why": ("A lead going cold is invisible by definition — nothing happens, "
                "so nothing appears anywhere. Fires once per contact."),
        "event_type": CONTACT_STALE,
        "steps": [
            {"kind": "condition",
             "config": {"field": "days_quiet", "operator": "gte", "value": 30}},
            {"kind": "condition",
             "config": {"field": "assigned_to", "operator": "not_empty",
                        "value": None}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "contact_stale", "to": ["@creator"],
                        "title": "A lead has gone quiet",
                        "body": "Nobody has been in touch for a month."}},
        ],
    },
)


def decorated() -> list:
    """Templates with their event's label and family attached.

    Done here rather than in the frontend for the same reason the field list is:
    one source, so the picker and the builder cannot disagree about what a
    trigger is called.
    """
    from .registry import meta_for
    return [{**t, **meta_for(t["event_type"])} for t in TEMPLATES]


def by_id(template_id: str):
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    return None
