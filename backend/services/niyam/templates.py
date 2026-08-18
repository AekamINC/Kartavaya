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
    APPROVAL_PENDING, ATTENDANCE_SUMMARY, CAMPAIGN_SENT, CONTACT_STALE,
    CONTACT_UNSUBSCRIBED, CORRECTION_REQUESTED, DEAL_CREATED,
    DOCUMENT_DECLINED, DOCUMENT_EXPIRING, DOCUMENT_SIGNED, EMPLOYEE_JOINED,
    ENROLL_REQUESTED, EXPENSE_CLAIMED, INVOICE_CANCELLED, INVOICE_CREATED,
    INVOICE_OVERDUE, INVOICE_PAID, LEAD_CONVERTED, LEAVE_REQUESTED,
    METRIC_THRESHOLD, ORDER_CREATED, ORDER_STATUS_CHANGED, PAYMENT_RECORDED,
    PAYROLL_PUBLISHED, PAYSLIP_DISBURSED, REPORT_DUE, STOCK_ADJUSTED,
    STOCK_LOW, TASK_CREATED, TASK_OVERDUE, TASK_STATUS_CHANGED,
    WHATSAPP_INBOUND,
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
        "id": "email-scheduled-reports",
        "name": "Deliver every scheduled report on its day",
        "why": ("The reports screen has let you schedule a report since the "
                "beginning; this rule is what actually sends them. It fires "
                "when a schedule reaches its day and hour, renders the module "
                "page the schedule names, and emails it to the recipients on "
                "the schedule — members of your org only. Clone it once; the "
                "per-report settings live on the reports screen, not here."),
        "event_type": REPORT_DUE,
        "steps": [
            {"kind": "action", "config": {"verb": "report.send"}},
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
    # ── the 2026-08 expansion: money, documents, people, outreach ────────────
    #
    # One starter per fact a firm actually reacts to, thresholds chosen so the
    # template is quiet at default sizes and the `why` says which number to
    # move. What is deliberately ABSENT: any task.create starter. The verb
    # exists, but a task needs a project and a template cannot know an org's
    # projects — a starter with a blank team_id would fail the same validation
    # a person's rule faces, and this file ships nothing that cannot be saved
    # as-is. The checklist rules are written by hand, where the builder offers
    # the org's own project list.
    {
        "id": "invoice-settled",
        "name": "When an invoice settles, tell the admins",
        "why": ("'Paid' in this product only ever comes from bank "
                "reconciliation — there is no gateway — so this fires on the "
                "ground truth, not on somebody's claim. The one moment in the "
                "money cycle everyone wants to hear about, and the one the "
                "old estate never announced."),
        "event_type": INVOICE_PAID,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "invoice_paid", "to": ["@org_admins"],
                        "title": "An invoice has been settled",
                        "body": "The books show it paid in full."}},
        ],
    },
    {
        "id": "large-invoice-raised",
        "name": "A second pair of eyes on any invoice over Rs 1,00,000",
        "why": ("Not approval — awareness. A large tax document leaving the "
                "firm is worth a glance from someone who did not write it. "
                "Move the number to fit the firm's ticket size."),
        "event_type": INVOICE_CREATED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "total", "operator": "gte", "value": 100000}},
            {"kind": "condition",
             "config": {"field": "invoice_type", "operator": "is",
                        "value": "tax_invoice"}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "invoice_large", "to": ["@org_admins"],
                        "title": "A large invoice was raised",
                        "body": "Worth a look while it is still fresh."}},
        ],
    },
    {
        "id": "invoice-cancelled-note",
        "name": "Tell the admins when an invoice is cancelled",
        "why": ("A cancellation is the one invoice write that removes money "
                "from the pipeline, and it happened silently until now. Low "
                "volume, high signal."),
        "event_type": INVOICE_CANCELLED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "invoice_cancelled", "to": ["@org_admins"],
                        "title": "An invoice was cancelled",
                        "body": "Its amount has left the receivables."}},
        ],
    },
    {
        "id": "large-payment-arrived",
        "name": "Flag any payment over Rs 50,000 the day it is recorded",
        "why": ("Most payments need no ceremony; a large one is worth knowing "
                "about the day it lands, not at month close. The threshold is "
                "the template's whole personality — move it."),
        "event_type": PAYMENT_RECORDED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "amount", "operator": "gte", "value": 50000}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "payment_large", "to": ["@org_admins"],
                        "title": "A large payment was recorded",
                        "body": "Check the invoice it was recorded against."}},
        ],
    },
    {
        "id": "first-order-from-client",
        "name": "Celebrate a client's first order",
        "why": ("A first order is a conversion, not a transaction — the "
                "moment a prospect becomes revenue. The event carries the "
                "distinction so the rule does not fire on order two."),
        "event_type": ORDER_CREATED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "is_first_order", "operator": "is",
                        "value": True}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "order_first", "to": ["@org_admins"],
                        "title": "A client placed their first order",
                        "body": "A new buying relationship just started."}},
        ],
    },
    {
        "id": "order-cancelled-alert",
        "name": "Tell the admins when an order is cancelled",
        "why": ("Cancellation restocks the goods and removes the revenue — "
                "two silent side effects worth a human glance. Fires only on "
                "the one status everyone means when they say 'what "
                "happened?'."),
        "event_type": ORDER_STATUS_CHANGED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "status", "operator": "is",
                        "value": "cancelled"}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "order_cancelled", "to": ["@org_admins"],
                        "title": "An order was cancelled",
                        "body": "Stock has been returned and the revenue "
                                "removed."}},
        ],
    },
    {
        "id": "big-deal-opened",
        "name": "Flag a deal worth Rs 1,00,000 entering the pipeline",
        "why": ("Big deals deserve attention on day one, while the firm can "
                "still influence them. Everything smaller stays quiet."),
        "event_type": DEAL_CREATED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "value", "operator": "gte", "value": 100000}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "deal_large", "to": ["@org_admins"],
                        "title": "A large deal entered the pipeline",
                        "body": "Worth assigning your best person early."}},
        ],
    },
    {
        "id": "lead-became-customer",
        "name": "Tell the admins when a lead converts",
        "why": ("Conversion is the CRM's finish line and the sales module's "
                "starting line — the handover moment where things get "
                "dropped. One note keeps both sides aware."),
        "event_type": LEAD_CONVERTED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "lead_converted", "to": ["@org_admins"],
                        "title": "A lead became a customer",
                        "body": "The company record is live — orders can "
                                "now be raised against it."}},
        ],
    },
    {
        "id": "stock-hand-adjustment",
        "name": "Note every stock level adjusted by hand",
        "why": ("Orders move stock automatically; a HAND adjustment is a "
                "person overriding the books — shrinkage, breakage, a "
                "miscount. Each one is small; the pattern is what an admin "
                "wants to see."),
        "event_type": STOCK_ADJUSTED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "stock_adjusted", "to": ["@org_admins"],
                        "title": "A stock level was adjusted by hand",
                        "body": "The move is on the stock ledger with its "
                                "reason."}},
        ],
    },
    {
        "id": "document-fully-signed",
        "name": "Tell the admins the moment everyone has signed",
        "why": ("'That was the last signature' is the fact the sender is "
                "waiting on, and it is exactly remaining_signers = 0. "
                "Partial signatures stay quiet."),
        "event_type": DOCUMENT_SIGNED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "remaining_signers", "operator": "is",
                        "value": 0}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "document_signed", "to": ["@org_admins"],
                        "title": "A document is fully signed",
                        "body": "Every signer has signed — it is ready to "
                                "use."}},
        ],
    },
    {
        "id": "document-declined-alert",
        "name": "Tell the admins when a signer declines",
        "why": ("A decline is the deal talking back. The event carries the "
                "reason the signer gave, because 'declined: price' routed "
                "today is a negotiation, and next week is a loss."),
        "event_type": DOCUMENT_DECLINED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "document_declined", "to": ["@org_admins"],
                        "title": "A signer declined a document",
                        "body": "Their reason, if they gave one, is on the "
                                "document's timeline."}},
        ],
    },
    {
        "id": "document-expiry-chase",
        "name": "Chase signatures before the request lapses",
        "why": ("Signing links die quietly — the default lifetime is seven "
                "days — and a lapsed request means re-sending and re-asking. "
                "Three days out is enough time to nudge a signer."),
        "event_type": DOCUMENT_EXPIRING,
        "steps": [
            {"kind": "condition",
             "config": {"field": "pending_signers", "operator": "gte",
                        "value": 1}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "document_expiring", "to": ["@org_admins"],
                        "title": "A signature request is about to lapse",
                        "body": "Signers are still pending and the link "
                                "expires in days."}},
        ],
    },
    {
        "id": "leave-request-heads-up",
        "name": "Tell the admins when leave is requested",
        "why": ("The request already sits in the HR queue; this is the nudge "
                "that stops it sitting there. Decisions delayed past the "
                "leave date decide themselves."),
        "event_type": LEAVE_REQUESTED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "leave_requested", "to": ["@org_admins"],
                        "title": "Leave has been requested",
                        "body": "It is waiting in the HR queue for a "
                                "decision."}},
        ],
    },
    {
        "id": "employee-joined-note",
        "name": "Tell the admins when an employee joins",
        "why": ("Day one is when the laptop, the logins and the seat get "
                "missed. One note to the people who provision things, the "
                "day the row is created."),
        "event_type": EMPLOYEE_JOINED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "employee_joined", "to": ["@org_admins"],
                        "title": "An employee has joined",
                        "body": "Time to sort access, equipment and the "
                                "first-week plan."}},
        ],
    },
    {
        "id": "large-expense-claimed",
        "name": "Flag an expense claim over Rs 10,000",
        "why": ("Small claims should flow; a large one deserves to be seen "
                "the day it is filed rather than discovered at approval "
                "time. Move the threshold to the firm's comfort."),
        "event_type": EXPENSE_CLAIMED,
        "steps": [
            {"kind": "condition",
             "config": {"field": "amount", "operator": "gte", "value": 10000}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "expense_large", "to": ["@org_admins"],
                        "title": "A large expense claim was filed",
                        "body": "It is in the approvals queue."}},
        ],
    },
    {
        "id": "payroll-published-note",
        "name": "Confirm each payroll run the moment it is published",
        "why": ("Publishing payroll is the month's biggest money action and "
                "it happens in a quiet corner of Vetana. The event carries "
                "the month and a headcount — deliberately never a salary "
                "figure."),
        "event_type": PAYROLL_PUBLISHED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "payroll_published", "to": ["@org_admins"],
                        "title": "A payroll run was published",
                        "body": "The month's run is ready for disbursement."}},
        ],
    },
    {
        "id": "payslips-disbursed-note",
        "name": "Confirm when a month's payslips go out",
        "why": ("One event per run — never one per person — closing the loop "
                "the publish note opened: the money the firm committed has "
                "now been handed to its people."),
        "event_type": PAYSLIP_DISBURSED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "payslip_disbursed", "to": ["@org_admins"],
                        "title": "Payslips have been disbursed",
                        "body": "The month's payroll is complete."}},
        ],
    },
    {
        "id": "attendance-correction-waiting",
        "name": "Tell the admins when an attendance correction is requested",
        "why": ("A correction request is an employee saying the record is "
                "wrong about THEM — the one queue that should never age. "
                "Statuses and dates only; the employee's reason stays "
                "behind the attendance module's own access rules."),
        "event_type": CORRECTION_REQUESTED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "correction_requested", "to": ["@org_admins"],
                        "title": "An attendance correction awaits review",
                        "body": "An employee says the record is wrong — "
                                "decide it while the day is fresh."}},
        ],
    },
    {
        "id": "enrollment-waiting",
        "name": "Tell the admins when someone requests attendance enrolment",
        "why": ("An unapproved enrolment is a person who cannot punch in — "
                "every day it waits is a day of absences that are nobody's "
                "fault. Usually a same-day decision, once somebody sees it."),
        "event_type": ENROLL_REQUESTED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "enrollment_requested", "to": ["@org_admins"],
                        "title": "An attendance enrolment awaits approval",
                        "body": "Approve it so their punches start "
                                "counting."}},
        ],
    },
    {
        "id": "campaign-sent-confirm",
        "name": "Confirm each campaign send with its delivered count",
        "why": ("Marketing never sent at all for months and nothing said so. "
                "This fires from the terminal status write with the "
                "DELIVERED count — the number that proves the send happened, "
                "not the audience somebody planned."),
        "event_type": CAMPAIGN_SENT,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "campaign_sent", "to": ["@org_admins"],
                        "title": "A campaign has been sent",
                        "body": "The delivered count is on the campaign "
                                "card."}},
        ],
    },
    {
        "id": "unsubscribe-note",
        "name": "Note every unsubscribe",
        "why": ("Each one is a person asking to be left alone — the firm "
                "must honour it everywhere, and a spike of them is the "
                "earliest warning a list has gone stale. The event carries "
                "the channel, never the address."),
        "event_type": CONTACT_UNSUBSCRIBED,
        "steps": [
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "contact_unsubscribed", "to": ["@org_admins"],
                        "title": "A contact unsubscribed",
                        "body": "They must not be contacted on this channel "
                                "again."}},
        ],
    },
    {
        "id": "whatsapp-new-enquiry",
        "name": "Flag a WhatsApp message from a new number",
        "why": ("A first message from an unknown number is usually a lead "
                "asking to be answered while their interest is warm. Known "
                "conversations stay quiet; the number itself never appears "
                "in the event."),
        "event_type": WHATSAPP_INBOUND,
        "steps": [
            {"kind": "condition",
             "config": {"field": "is_new_contact", "operator": "is",
                        "value": True}},
            {"kind": "action",
             "config": {"verb": "notify.send", "channel": "inapp",
                        "kind": "whatsapp_new_contact", "to": ["@org_admins"],
                        "title": "A new WhatsApp enquiry arrived",
                        "body": "Somebody new is waiting for a reply."}},
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
