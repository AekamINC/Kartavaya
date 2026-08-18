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
    CONTACT_CREATED,
    CONTACT_STALE,
    DEAL_STAGE_CHANGED,
    INVOICE_OVERDUE,
    METRIC_THRESHOLD,
    STOCK_LOW,
    TASK_CREATED,
    TASK_OVERDUE,
    TASK_STATUS_CHANGED,
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
}


#: EVENT TYPES THE BUILDER MUST NOT OFFER, BECAUSE NOTHING EMITS THEM.
#:
#: EMPTY TODAY, and it is worth saying why it existed rather than deleting it.
#:
#: `contact.created` and `deal.stage_changed` were declared here, offered by the
#: builder in plain English, and emitted by nothing — the EXACT defect this
#: engine was built to remove, since the old Tasks builder offered eight
#: triggers of which six were strings nothing emitted. They were withdrawn into
#: this set rather than deleted, then wired: five contact writers (a person
#: adding one, an inbound enquiry, the public web form, a scraper import, a
#: marketplace push) and the deal PATCH. Emptying this set was the two-line
#: change the withdrawal was designed to leave behind.
#:
#: KEEP IT. A new event type is DECLARED long before its writer is found — that
#: gap is normal, and this is where it lives so the gap is never customer-facing.
#: `test_niyam_catalog_only_offers_real_triggers` derives what is actually
#: emitted from the code, so it fails whichever way the two drift: an offered
#: trigger with no emitter, or a name left here after its emitter landed.
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
