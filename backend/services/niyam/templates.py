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

from .subjects import TASK_CREATED, TASK_STATUS_CHANGED

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
)


def by_id(template_id: str):
    for t in TEMPLATES:
        if t["id"] == template_id:
            return t
    return None
