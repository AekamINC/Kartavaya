"""What a rule may ask about — and therefore what the builder may offer.

THE DEFECT THIS FILE IS THE ANSWER TO
-------------------------------------
The old builder offered `priority` and `assignee` conditions on task events, and
its engine's callers passed `{task_id, team_id}`. So the condition was
unevaluable from every call site: the engine correctly refused to fire and wrote
the reason to a server log, while the UI showed the rule as Active for ever.

The fix is not a better runtime check. It is that the SAME table decides what a
condition may be written against and what an event is guaranteed to carry. A
field appears here only if every emitter of that event type fills it, which is
a promise `subjects.py` makes in one place and `test_niyam_payload_keys_are_real`
enforces.

TYPE DRIVES OPERATORS, NOT THE OTHER WAY AROUND
-----------------------------------------------
A date offers before/after/within_days. A select offers is/is_not/one_of. A list
offers contains. Nothing else is offerable, so "priority is after 3 days" is not
a rule you can save and then wonder about.

WHAT IS DELIBERATELY NOT HERE
-----------------------------
* Custom fields. There are TWO custom-field systems with different type
  vocabularies, different scoping and different value storage — PM's
  `field_definitions` (team-scoped, values in a `field_values` table) and CRM's
  `graha_custom_fields` (org-scoped, values in a `custom_data` JSONB column) —
  plus a third unrelated `tasks.custom_fields` JSONB column. None of the three
  is carried by any event today. Offering them would require widening the
  emitters, which `subjects.py` makes a contract change. Deliberately deferred
  rather than half-built.

* Deal `stage` as a fixed option list. `graha_deals.stage` is TEXT with no
  CHECK; the real options live per-org in `graha_pipelines.stages`. A hardcoded
  select would be wrong for any org that edited its pipeline, so `stage` is
  typed `text` here and its options are resolved per org at authoring time.
"""
from __future__ import annotations

from typing import Any, Mapping, NamedTuple, Optional

from .subjects import (
    APPROVAL_PENDING,
    ATTENDANCE_SUMMARY,
    CAMPAIGN_SENT,
    CLIENT_CREATED,
    CONTACT_CREATED,
    CONTACT_STALE,
    CONTACT_UNSUBSCRIBED,
    CORRECTION_DECIDED,
    CORRECTION_REQUESTED,
    DEAL_CREATED,
    DEAL_STAGE_CHANGED,
    DOCUMENT_DECLINED,
    DOCUMENT_EXPIRING,
    DOCUMENT_SENT,
    DOCUMENT_SIGNED,
    EMPLOYEE_EXITED,
    EMPLOYEE_JOINED,
    ENROLL_REQUESTED,
    EXPENSE_CLAIMED,
    EXPENSE_DECIDED,
    INVOICE_CANCELLED,
    INVOICE_CREATED,
    INVOICE_OVERDUE,
    INVOICE_PAID,
    LEAD_CONVERTED,
    LEAVE_DECIDED,
    LEAVE_REQUESTED,
    METRIC_THRESHOLD,
    ORDER_CREATED,
    ORDER_FULFILLED,
    ORDER_STATUS_CHANGED,
    PAYMENT_RECORDED,
    PAYROLL_PUBLISHED,
    PAYSLIP_DISBURSED,
    REPORT_DUE,
    STOCK_ADJUSTED,
    STOCK_LOW,
    TASK_CREATED,
    TASK_OVERDUE,
    TASK_STATUS_CHANGED,
    WHATSAPP_INBOUND,
)

#: The sentinel for "this event type does not carry that field at all".
#:
#: Three states are distinguishable and they mean different things: a field the
#: event carries and is null (`None`), a field the event carries with a value,
#: and a field the event NEVER carries (`MISSING`). The old engine had exactly
#: this sentinel and refused to fire on it rather than guessing; conflating
#: MISSING with None is how "is empty" comes to match every event of a type that
#: has never heard of the field.
class _Missing:
    __slots__ = ()

    def __repr__(self) -> str:            # pragma: no cover - debugging aid
        return "MISSING"

    def __bool__(self) -> bool:
        return False


MISSING = _Missing()


class Field(NamedTuple):
    """One thing a condition may be written against."""
    key: str
    label: str
    kind: str                    # text | select | number | date | list | bool
    options: tuple = ()          # for `select`; empty means "resolved per org"


#: Operators, keyed by field kind. The STRINGS are taken from the frontend's
#: existing FilterBuilder so a rule author meets one vocabulary across both
#: surfaces — but NOT its semantics. FilterBuilder returns True for a clause it
#: cannot evaluate (`if (!raw || !c.value) return true`), which is right for a
#: view, where an incomplete filter should not hide rows, and catastrophic for a
#: rule, where it would fire the action.
OPERATORS: dict[str, tuple[str, ...]] = {
    "text":   ("is", "is_not", "contains", "not_contains", "is_empty", "not_empty"),
    "select": ("is", "is_not", "one_of", "is_empty", "not_empty"),
    "number": ("is", "is_not", "gt", "gte", "lt", "lte"),
    "date":   ("before", "after", "within_days", "is_empty", "not_empty"),
    # `contains` on a list means membership. "Assigned to Priya" is the single
    # condition people most want, and `is` on a list would compare the whole
    # array to one id and match nothing.
    "list":   ("contains", "not_contains", "is_empty", "not_empty"),
    "bool":   ("is",),
}

#: Operators that are ABOUT absence, and are therefore the only ones that may be
#: evaluated against a null. Every other operator refuses on null — see
#: `conditions.evaluate`.
NULL_SAFE = frozenset({"is_empty", "not_empty"})

#: `tasks.status` has no CHECK constraint; the allowlist is Python-side. Taken
#: from the transition policy rather than restated, so a status added there is
#: offerable here without anyone remembering. The frontend's map carries a sixth
#: value (`rejected`) that the policy calls deliberately absent — following the
#: policy, not the map.
def _task_statuses() -> tuple:
    from services.task_transitions import TASK_STATUSES
    return tuple(TASK_STATUSES)


#: `tasks.priority` has no CHECK either, and its Pydantic model types it as a
#: bare `str` with a default. So this list is not derived from anything — it is
#: written here, and it is the only allowlist that exists.
PRIORITIES = ("low", "medium", "high", "urgent")


def _task_fields() -> tuple:
    return (
        Field("status", "Status", "select", _task_statuses()),
        Field("priority", "Priority", "select", PRIORITIES),
        Field("title", "Title", "text"),
        Field("project_id", "Project", "select"),
        Field("column_id", "Board column", "select"),
        Field("category_id", "Category", "select"),
        # `due_at`, matching both the column and FilterBuilder's field id. An
        # earlier draft called it `due_date` on one side and read a column that
        # does not exist on the other.
        Field("due_at", "Due date", "date"),
        Field("assignee_user_ids", "Assignees", "list"),
        Field("assignee_count", "Number of assignees", "number"),
        Field("approval_status", "Approval status", "select"),
        Field("created_by", "Created by", "select"),
    )


#: The registry proper. Keys are event types; values are what `payload.after`
#: guarantees for that type.
REGISTRY: dict[str, tuple] = {
    TASK_CREATED:        _task_fields,      # callables — resolved lazily below
    TASK_STATUS_CHANGED: _task_fields,
    CONTACT_CREATED: lambda: (
        Field("contact_type", "Contact type", "text"),
        # NOTE the collision: this is the LEAD's origin (a free-text column
        # defaulting to ''), not the event envelope's `source`, which is the
        # allowlisted {app, import, sweep, cron}. Two different things with one
        # name, both visible to an author — so the label says which, and
        # `envelope_field` below keeps the envelope out of the registry.
        Field("source", "Lead source", "text"),
        Field("company", "Company", "text"),
        Field("client_id", "Client", "select"),
        Field("assigned_to", "Assigned to", "select"),
        Field("has_email", "Has an email address", "bool"),
        Field("has_phone", "Has a phone number", "bool"),
    ),
    # ── temporal ────────────────────────────────────────────────────────────
    #
    # These carry a "how late is it" number, which is the field almost every
    # useful time rule is really about: not "is it overdue" (the event already
    # says that) but "is it overdue ENOUGH to bother somebody". Without it a
    # rule author can only express the trigger, not the severity.
    TASK_OVERDUE: lambda: _task_fields() + (
        Field("days_overdue", "Days overdue", "number"),
    ),
    APPROVAL_PENDING: lambda: (
        Field("request_type", "Request type", "text"),
        Field("project_id", "Project", "select"),
        Field("created_by", "Requested by", "select"),
        Field("task_id", "Task", "text"),
        Field("days_waiting", "Days waiting", "number"),
    ),
    INVOICE_OVERDUE: lambda: (
        Field("invoice_number", "Invoice number", "text"),
        Field("balance_due", "Balance due", "number"),
        Field("total", "Invoice total", "number"),
        # `text`, not `select`: there is no CHECK on this column and the
        # vocabulary has moved before.
        Field("payment_status", "Payment status", "text"),
        Field("client_id", "Client", "select"),
        Field("created_by", "Raised by", "select"),
        Field("days_overdue", "Days overdue", "number"),
    ),
    CONTACT_STALE: lambda: (
        Field("contact_type", "Contact type", "text"),
        Field("source", "Lead source", "text"),
        Field("company", "Company", "text"),
        Field("assigned_to", "Assigned to", "select"),
        Field("client_id", "Client", "select"),
        Field("lead_score", "Lead score", "number"),
        Field("days_quiet", "Days since contact", "number"),
    ),
    DEAL_STAGE_CHANGED: lambda: (
        # `text`, not `select`: the options are per-org rows in
        # graha_pipelines.stages, not a constant.
        Field("stage", "Stage", "text"),
        Field("value", "Deal value", "number"),
        Field("assigned_to", "Assigned to", "select"),
        Field("client_id", "Client", "select"),
    ),
    STOCK_LOW: lambda: (
        Field("product_name", "Product", "text"),
        Field("quantity_on_hand", "Quantity on hand", "number"),
        Field("low_stock_threshold", "Low-stock threshold", "number"),
        # threshold - on_hand: "how far below" is the severity number a rule
        # is really about, same reasoning as days_overdue on the time events.
        Field("shortfall", "Shortfall", "number"),
    ),
    METRIC_THRESHOLD: lambda: (
        Field("metric", "Metric", "text"),
        Field("label", "Metric name", "text"),
        Field("value", "Measured value", "number"),
        Field("threshold", "Threshold", "number"),
        Field("window_days", "Window (days)", "number"),
    ),
    # The schedule's own settings, so a rule can scope itself ("only the
    # revenue reports", "weekly ones only"). The recipient LIST is not
    # offerable — addresses stay in the row for report.send to re-read; a
    # count is the most a condition needs.
    REPORT_DUE: lambda: (
        Field("name", "Report name", "text"),
        # 027's CHECK on dristi_scheduled_reports.report_type.
        Field("report_type", "Report type", "select",
              ("overview", "revenue", "pipeline", "hr", "sales", "custom")),
        # 027's CHECK on frequency.
        Field("frequency", "Frequency", "select",
              ("daily", "weekly", "monthly")),
        Field("recipient_count", "Recipients", "number"),
    ),
    # COUNTS ONLY — see the constant's note in subjects.py. No person, no id,
    # no list of names is offerable here, and that absence is the design.
    ATTENDANCE_SUMMARY: lambda: (
        Field("report_date", "Report date", "date"),
        Field("marked_count", "People marked", "number"),
        Field("present_count", "Present", "number"),
        Field("absent_count", "Absent", "number"),
        Field("late_count", "Late", "number"),
        Field("half_day_count", "Half day", "number"),
        Field("on_leave_count", "On leave", "number"),
    ),
    # ── the 2026-08 expansion ───────────────────────────────────────────────
    #
    # Every select's option tuple below is copied from the owning table's
    # CHECK constraint (the migration is cited), because a vocabulary invented
    # here is a rule that can never match. Selects with NO options are
    # resolved per org at authoring time — Client, Project and every person
    # field work that way already, and person fields are selects rather than
    # text because a text field would have authors typing raw UUIDs, which
    # the names-not-ids rule forbids ever showing them.
    #
    # ── finance (ganit) ─────────────────────────────────────────────────────
    INVOICE_CREATED: lambda: (
        Field("invoice_number", "Invoice number", "text"),
        # 018's CHECK on ganit_invoices.invoice_type.
        Field("invoice_type", "Invoice type", "select",
              ("tax_invoice", "proforma", "credit_note", "debit_note", "quotation")),
        Field("total", "Invoice total", "number"),
        Field("client_id", "Client", "select"),
        # 019's CHECK. Defaults to 'final' — and says NOTHING about
        # editability, which is payment_status's job. Do not "fix" that.
        Field("doc_status", "Document status", "select",
              ("draft", "final", "sent", "viewed")),
        Field("created_by", "Raised by", "select"),
    ),
    PAYMENT_RECORDED: lambda: (
        Field("invoice_number", "Invoice number", "text"),
        Field("amount", "Amount received", "number"),
        # `payment_method`, the column (018's CHECK) — not "mode".
        Field("payment_method", "Payment method", "select",
              ("cash", "bank_transfer", "upi", "cheque", "card", "other")),
        Field("client_id", "Client", "select"),
        # The invoice's own column, and the same name invoice.overdue offers.
        Field("balance_due", "Balance still due", "number"),
    ),
    INVOICE_PAID: lambda: (
        Field("invoice_number", "Invoice number", "text"),
        Field("total", "Invoice total", "number"),
        Field("client_id", "Client", "select"),
        # A recorded payment is a person's claim; a reconciliation is the
        # bank's. There is no gateway, so there is no third value.
        Field("via", "Paid via", "select", ("payment", "reconciliation")),
    ),
    INVOICE_CANCELLED: lambda: (
        Field("invoice_number", "Invoice number", "text"),
        Field("total", "Invoice total", "number"),
        Field("client_id", "Client", "select"),
        Field("cancelled_by", "Cancelled by", "select"),
    ),
    # ── sales (vikray) ──────────────────────────────────────────────────────
    ORDER_CREATED: lambda: (
        Field("order_number", "Order number", "text"),
        Field("total", "Order total", "number"),
        Field("client_id", "Client", "select"),
        Field("is_first_order", "First order from this client", "bool"),
        Field("created_by", "Created by", "select"),
    ),
    ORDER_STATUS_CHANGED: lambda: (
        Field("order_number", "Order number", "text"),
        Field("total", "Order total", "number"),
        Field("client_id", "Client", "select"),
        # 020's CHECK on vikray_orders.status. `before` carries the same
        # shape with the old status — "was it previously dispatched" is
        # `before.status`, same as tasks.
        Field("status", "Status", "select",
              ("draft", "confirmed", "dispatched", "delivered", "closed", "cancelled")),
    ),
    ORDER_FULFILLED: lambda: (
        Field("order_number", "Order number", "text"),
        Field("total", "Order total", "number"),
        Field("client_id", "Client", "select"),
    ),
    STOCK_ADJUSTED: lambda: (
        Field("product_name", "Product", "text"),
        Field("quantity_before", "Quantity before", "number"),
        Field("quantity_after", "Quantity after", "number"),
        Field("adjusted_by", "Adjusted by", "select"),
    ),
    # ── crm (graha) ─────────────────────────────────────────────────────────
    DEAL_CREATED: lambda: (
        Field("title", "Title", "text"),
        Field("value", "Deal value", "number"),
        # `text`, not `select`, for DEAL_STAGE_CHANGED's reason: the options
        # are per-org rows in graha_pipelines.stages, not a constant.
        Field("stage", "Stage", "text"),
        Field("client_id", "Client", "select"),
        Field("assigned_to", "Assigned to", "select"),
        Field("created_by", "Created by", "select"),
    ),
    CLIENT_CREATED: lambda: (
        Field("name", "Company name", "text"),
        # A bool, never the GSTIN itself — and GSTIN is non-mandatory and
        # blocks nothing, a product rule no event may re-litigate.
        Field("has_gstin", "Has a GSTIN", "bool"),
        Field("created_by", "Created by", "select"),
    ),
    LEAD_CONVERTED: lambda: (
        # 018's CHECK on graha_contacts.contact_type — what the contact BECAME.
        Field("contact_type", "Contact type", "select",
              ("lead", "customer", "vendor", "partner")),
        Field("company", "Company", "text"),
        Field("client_id", "Client", "select"),
        Field("converted_by", "Converted by", "select"),
    ),
    # ── e-sign ──────────────────────────────────────────────────────────────
    DOCUMENT_SENT: lambda: (
        Field("document_title", "Document title", "text"),
        Field("signer_count", "Number of signers", "number"),
        Field("sent_by", "Sent by", "select"),
    ),
    DOCUMENT_SIGNED: lambda: (
        Field("document_title", "Document title", "text"),
        # The domain, never the address — a person stays in the module.
        Field("signer_email_domain", "Signer's email domain", "text"),
        # "That was the last one" is remaining_signers = 0.
        Field("remaining_signers", "Signers still pending", "number"),
    ),
    DOCUMENT_DECLINED: lambda: (
        Field("document_title", "Document title", "text"),
        Field("declined_reason", "Reason given", "text"),
    ),
    DOCUMENT_EXPIRING: lambda: (
        Field("document_title", "Document title", "text"),
        # The severity number, same reasoning as days_overdue.
        Field("days_left", "Days until expiry", "number"),
        Field("pending_signers", "Signers still pending", "number"),
    ),
    # ── hr (manav) ──────────────────────────────────────────────────────────
    LEAVE_REQUESTED: lambda: (
        # `leave_type_id`, the column. The NAMES are per-org rows in
        # manav_leave_types — resolved at authoring time like Client.
        Field("leave_type_id", "Leave type", "select"),
        Field("days", "Days", "number"),
        Field("start_date", "Starts on", "date"),
        Field("employee_user_id", "Employee", "select"),
        Field("requested_by", "Requested by", "select"),
    ),
    LEAVE_DECIDED: lambda: (
        Field("leave_type_id", "Leave type", "select"),
        Field("days", "Days", "number"),
        # 018's CHECK: the decided states are exactly these two.
        Field("decision", "Decision", "select", ("approved", "rejected")),
        Field("employee_user_id", "Employee", "select"),
        Field("decided_by", "Decided by", "select"),
    ),
    EMPLOYEE_JOINED: lambda: (
        Field("department", "Department", "text"),
        Field("designation", "Designation", "text"),
        Field("employee_user_id", "Employee", "select"),
    ),
    EMPLOYEE_EXITED: lambda: (
        Field("department", "Department", "text"),
        # 083's CHECK on manav_offboarding.exit_type.
        Field("exit_type", "Exit type", "select",
              ("resignation", "termination", "retirement", "end_of_contract",
               "abandonment", "redundancy", "death")),
        Field("employee_user_id", "Employee", "select"),
    ),
    EXPENSE_CLAIMED: lambda: (
        Field("amount", "Amount", "number"),
        # `text`: manav_expense_claims.category has no CHECK and defaults to
        # 'other' — the vocabulary is whatever the data holds.
        Field("category", "Category", "text"),
        Field("employee_user_id", "Employee", "select"),
    ),
    EXPENSE_DECIDED: lambda: (
        Field("amount", "Amount", "number"),
        # 'paid' is not a decision — it is Vetana disbursing later.
        Field("decision", "Decision", "select", ("approved", "rejected")),
        Field("employee_user_id", "Employee", "select"),
        Field("decided_by", "Decided by", "select"),
    ),
    # ── payroll (vetana) — NO salary numbers, see subjects.py ───────────────
    PAYROLL_PUBLISHED: lambda: (
        Field("month", "Payroll month", "text"),
        Field("employee_count", "Employees in the run", "number"),
        Field("published_by", "Published by", "select"),
    ),
    PAYSLIP_DISBURSED: lambda: (
        Field("month", "Payroll month", "text"),
        Field("employee_count", "Payslips disbursed", "number"),
    ),
    # ── attendance workflow (pahchan) — statuses and dates ONLY ─────────────
    CORRECTION_REQUESTED: lambda: (
        Field("for_date", "Day in question", "date"),
        # Derived from punch_id being null — never the free-text reason.
        Field("reason_type", "Kind of correction", "select",
              ("missing_punch", "wrong_punch")),
        Field("employee_user_id", "Employee", "select"),
    ),
    CORRECTION_DECIDED: lambda: (
        Field("for_date", "Day in question", "date"),
        # 064's CHECK: 'declined', NOT 'rejected'.
        Field("decision", "Decision", "select", ("approved", "declined")),
        Field("employee_user_id", "Employee", "select"),
        Field("decided_by", "Decided by", "select"),
    ),
    ENROLL_REQUESTED: lambda: (
        Field("employee_user_id", "Employee", "select"),
        # pahchan_enrollment_photos.source, renamed — `source` already means
        # two things in this engine and a third is how vocabularies rot.
        Field("method", "Enrollment method", "select",
              ("hr_upload", "self_capture")),
    ),
    # ── marketing (prachar) ─────────────────────────────────────────────────
    CAMPAIGN_SENT: lambda: (
        Field("campaign_name", "Campaign", "text"),
        # 021's CHECK on prachar_campaigns.channel.
        Field("channel", "Channel", "select", ("email", "sms", "whatsapp")),
        Field("recipient_count", "Recipients", "number"),
        Field("sent_by", "Sent by", "select"),
    ),
    CONTACT_UNSUBSCRIBED: lambda: (
        Field("channel", "Channel", "select", ("email", "sms", "whatsapp")),
        # `via`, not `source` — the ENVELOPE_FIELDS collision reason.
        Field("via", "Unsubscribed via", "select", ("link", "manual")),
    ),
    # ── whatsapp (varta) ────────────────────────────────────────────────────
    WHATSAPP_INBOUND: lambda: (
        # A 12-hex-char hash, never the number — see whatsapp_inbound.
        Field("from_hash", "Sender (hashed)", "text"),
        Field("conversation_id", "Conversation", "text"),
        Field("has_media", "Has an attachment", "bool"),
        Field("is_new_contact", "First message from this sender", "bool"),
    ),
}

#: How each event type is PRESENTED, and how it is grouped.
#:
#: Served by the catalog so the builder never has to translate `task.status_changed`
#: into English, and never has to guess which events belong together. Both were
#: previously invented in the frontend, which is the same drift this registry
#: exists to prevent — just applied to labels instead of fields.
#:
#: `family` is what the rule is ABOUT, and it is what the UI colours by. Colour
#: that encodes the domain is information; colour chosen per card is decoration,
#: and decoration cannot be read.
#:
#: `temporal` says whether the trigger is a boundary passing rather than a
#: person acting. That is the single most useful thing to tell a rule author
#: apart at a glance: an event rule fires when somebody does something, a time
#: rule fires because nobody did.
EVENT_META: dict[str, dict] = {
    TASK_CREATED:        {"label": "A task is created",          "family": "task",     "temporal": False},
    TASK_STATUS_CHANGED: {"label": "A task changes status",      "family": "task",     "temporal": False},
    TASK_OVERDUE:        {"label": "A task goes past its due date", "family": "task",  "temporal": True},
    APPROVAL_PENDING:    {"label": "An approval is left waiting", "family": "approval", "temporal": True},
    INVOICE_OVERDUE:     {"label": "An invoice goes unpaid",      "family": "invoice",  "temporal": True},
    CONTACT_CREATED:     {"label": "A lead or contact is added",  "family": "crm",      "temporal": False},
    CONTACT_STALE:       {"label": "A lead goes quiet",           "family": "crm",      "temporal": True},
    DEAL_STAGE_CHANGED:  {"label": "A deal moves stage",          "family": "crm",      "temporal": False},
    STOCK_LOW:           {"label": "A product runs low on stock", "family": "sales",    "temporal": True},
    ATTENDANCE_SUMMARY:  {"label": "A day's attendance is summarised", "family": "hr",  "temporal": True},
    METRIC_THRESHOLD:    {"label": "A metric crosses its alert threshold", "family": "analytics", "temporal": True},
    REPORT_DUE:          {"label": "A scheduled report falls due",     "family": "analytics", "temporal": True},
    # ── the 2026-08 expansion. Labelled now, offered only once wired — the
    # catalog never serves a meta for an UNWIRED type, so these sit ready.
    INVOICE_CREATED:     {"label": "An invoice is raised",           "family": "invoice",  "temporal": False},
    PAYMENT_RECORDED:    {"label": "A payment is recorded",          "family": "invoice",  "temporal": False},
    INVOICE_PAID:        {"label": "An invoice is fully paid",       "family": "invoice",  "temporal": False},
    INVOICE_CANCELLED:   {"label": "An invoice is cancelled",        "family": "invoice",  "temporal": False},
    ORDER_CREATED:       {"label": "A sales order is created",       "family": "sales",    "temporal": False},
    ORDER_STATUS_CHANGED: {"label": "A sales order changes status",  "family": "sales",    "temporal": False},
    ORDER_FULFILLED:     {"label": "A sales order is fulfilled",     "family": "sales",    "temporal": False},
    STOCK_ADJUSTED:      {"label": "A stock level is adjusted by hand", "family": "sales", "temporal": False},
    DEAL_CREATED:        {"label": "A deal is opened",               "family": "crm",      "temporal": False},
    CLIENT_CREATED:      {"label": "A client company is added",      "family": "crm",      "temporal": False},
    LEAD_CONVERTED:      {"label": "A lead becomes a customer",      "family": "crm",      "temporal": False},
    DOCUMENT_SENT:       {"label": "A document goes out for signature", "family": "esign", "temporal": False},
    DOCUMENT_SIGNED:     {"label": "A signer signs a document",      "family": "esign",    "temporal": False},
    DOCUMENT_DECLINED:   {"label": "A signer declines a document",   "family": "esign",    "temporal": False},
    DOCUMENT_EXPIRING:   {"label": "A signature request nears expiry", "family": "esign",  "temporal": True},
    LEAVE_REQUESTED:     {"label": "Leave is requested",             "family": "hr",       "temporal": False},
    LEAVE_DECIDED:       {"label": "A leave request is decided",     "family": "hr",       "temporal": False},
    EMPLOYEE_JOINED:     {"label": "An employee joins",              "family": "hr",       "temporal": False},
    EMPLOYEE_EXITED:     {"label": "An employee exits",              "family": "hr",       "temporal": False},
    EXPENSE_CLAIMED:     {"label": "An expense claim is submitted",  "family": "hr",       "temporal": False},
    EXPENSE_DECIDED:     {"label": "An expense claim is decided",    "family": "hr",       "temporal": False},
    PAYROLL_PUBLISHED:   {"label": "A payroll run is published",     "family": "payroll",  "temporal": False},
    PAYSLIP_DISBURSED:   {"label": "A payroll run is disbursed",     "family": "payroll",  "temporal": False},
    CORRECTION_REQUESTED: {"label": "An attendance correction is requested", "family": "hr", "temporal": False},
    CORRECTION_DECIDED:  {"label": "An attendance correction is decided", "family": "hr",  "temporal": False},
    ENROLL_REQUESTED: {"label": "An attendance enrollment awaits approval", "family": "hr", "temporal": False},
    CAMPAIGN_SENT:       {"label": "A campaign is sent",             "family": "marketing", "temporal": False},
    CONTACT_UNSUBSCRIBED: {"label": "A contact unsubscribes",        "family": "marketing", "temporal": False},
    WHATSAPP_INBOUND:    {"label": "A WhatsApp message arrives",     "family": "whatsapp",  "temporal": False},
}


#: EVENT TYPES THE BUILDER MUST NOT OFFER, BECAUSE NOTHING EMITS THEM.
#:
#: AN EVENT LEAVES THIS SET IN THE SAME COMMIT AS ITS FIRST EMITTER — one
#: line removed here, one call site added in a router, one commit. Wiring
#: agents: delete YOUR line only.
#:
#: The set has been emptied once before, and it is worth saying how.
#: `contact.created` and `deal.stage_changed` were declared, offered by the
#: builder in plain English, and emitted by nothing — the EXACT defect this
#: engine was built to remove, since the old Tasks builder offered eight
#: triggers of which six were strings nothing emitted. They were withdrawn into
#: this set rather than deleted, then wired: five contact writers (a person
#: adding one, an inbound enquiry, the public web form, a scraper import, a
#: marketplace push) and the deal PATCH. Emptying this set was the two-line
#: change the withdrawal was designed to leave behind.
#:
#: A new event type is DECLARED long before its writer is found — that gap is
#: normal, and this is where it lives so the gap is never customer-facing.
#: `test_niyam_catalog_only_offers_real_triggers` derives what is actually
#: emitted from the code, so it fails whichever way the two drift: an offered
#: trigger with no emitter, or a name left here after its emitter landed.
#: Today it holds the whole 2026-08 expansion: every emitter below exists in
#: `subjects.py`, ready to call, and nothing calls it yet.
#: EMPTY for the second time, 2026-08-18. The whole 2026-08 expansion is
#: wired: seven router files gained their call sites in one fan-out (each
#: emitter on the business write's own connection, inside its transaction),
#: `document.expiring` and `report.due` landed as sweep predicates, and every
#: line here left in that same change — exactly the two-line ending the
#: withdrawal was designed for. The set stays, because the NEXT declared
#: event starts life here too.
UNWIRED: frozenset[str] = frozenset()


def catalog_event_types() -> list[str]:
    """The event types a rule author may actually choose.

    `REGISTRY` is what the ENGINE can evaluate; this is what the PRODUCT can
    honestly offer. They differ only by events whose emitter is unwritten.
    """
    return sorted(set(REGISTRY) - UNWIRED)


def meta_for(event_type: str) -> dict:
    """Presentation for one event type, with a readable fallback.

    Falls back to the raw type rather than to "Unknown": a new event that nobody
    has labelled yet should still be pickable, and its dotted name is a worse
    label but a true one.
    """
    return EVENT_META.get(event_type, {"label": event_type, "family": "task",
                                       "temporal": False})


#: Names belonging to the event ENVELOPE rather than to any payload. They are
#: never offerable as conditions, and the list exists so a future author cannot
#: accidentally introduce `source` twice with two meanings.
ENVELOPE_FIELDS = frozenset({"source", "actor_id", "event_type", "org_id",
                             "entity_type", "entity_id", "occurred_at"})


def fields_for(event_type: str) -> tuple:
    """Every field a rule on `event_type` may condition on. Empty if unknown."""
    factory = REGISTRY.get(event_type)
    if factory is None:
        return ()
    return factory()


def field(event_type: str, key: str) -> Optional[Field]:
    for f in fields_for(event_type):
        if f.key == key:
            return f
    return None


def operators_for(event_type: str, key: str) -> tuple:
    """The operators offerable for one field. Empty when the field is unknown —
    which is the whole point: a condition the event cannot answer has no
    operators, so it cannot be built."""
    f = field(event_type, key)
    return OPERATORS.get(f.kind, ()) if f else ()


def read(payload: Mapping[str, Any], event_type: str, key: str) -> Any:
    """Read one field out of `payload.after`, returning MISSING if the event
    type does not carry it at all.

    The distinction matters: `None` means "this task has no due date", MISSING
    means "this kind of event has never carried a due date". The first is
    answerable by `is_empty`; the second must refuse.
    """
    if field(event_type, key) is None:
        return MISSING
    after = (payload or {}).get("after") or {}
    if key not in after:
        return MISSING
    return after[key]
