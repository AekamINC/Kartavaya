"""The 2026-08 expansion: 29 event types declared ahead of their wiring.

WHAT THIS FILE PINS
-------------------
The expansion is an INTERFACE handed to a fan-out: `subjects.py` holds the
emitter for every new type, `registry.py` holds its guaranteed fields, and
`UNWIRED` holds every name until its first call site lands. Wiring agents
remove one line each. This file makes the interface a contract rather than a
convention:

  * every new type is in REGISTRY with non-empty, typed fields;
  * every new type is in UNWIRED today, and declared-but-unwired NEVER
    reaches `catalog_event_types()` — the builder cannot sell a rule on it,
    and the validator refuses it outright;
  * the eleven original types are byte-for-byte untouched and NOT in UNWIRED
    — an expansion that moves an existing field breaks saved rules, which is
    a migration, not an edit;
  * every emitter exists, is async, and names the event type it emits via
    the constant — the same fact `test_niyam_catalog_only_offers_real_triggers`
    reads off the AST to decide what is wired.
"""
from __future__ import annotations

import ast
import inspect
import io
import pathlib

import pytest

from services.niyam import registry, subjects
from services.niyam.emit import _BANNED_KEYS
from services.niyam.registry import OPERATORS
from services.niyam.validate import RuleInvalid, validate_event_type

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: The interface, pinned in literals. Event type → the emitter wiring agents
#: call. Literal strings on purpose: renaming a constant must not quietly
#: rename what this file checks.
NEW_TYPES: dict[str, str] = {
    # finance (ganit)
    "invoice.created":      "invoice_created",
    "payment.recorded":     "payment_recorded",
    "invoice.paid":         "invoice_paid",
    "invoice.cancelled":    "invoice_cancelled",
    # sales (vikray)
    "order.created":        "order_created",
    "order.status_changed": "order_status_changed",
    "order.fulfilled":      "order_fulfilled",
    "stock.adjusted":       "stock_adjusted",
    # crm (graha)
    "deal.created":         "deal_created",
    "client.created":       "client_created",
    "lead.converted":       "lead_converted",
    # e-sign
    "document.sent":        "document_sent",
    "document.signed":      "document_signed",
    "document.declined":    "document_declined",
    "document.expiring":    "document_expiring",
    # hr (manav)
    "leave.requested":      "leave_requested",
    "leave.decided":        "leave_decided",
    "employee.joined":      "employee_joined",
    "employee.exited":      "employee_exited",
    "expense.claimed":      "expense_claimed",
    "expense.decided":      "expense_decided",
    # payroll (vetana)
    "payroll.published":    "payroll_published",
    "payslip.disbursed":    "payslip_disbursed",
    # attendance workflow (pahchan)
    "correction.requested": "correction_requested",
    "correction.decided":   "correction_decided",
    "enrollment.requested": "enrollment_requested",
    # marketing (prachar)
    "campaign.sent":        "campaign_sent",
    "contact.unsubscribed": "contact_unsubscribed",
    # whatsapp (varta)
    "whatsapp.inbound":     "whatsapp_inbound",
}

#: The registry as it stood BEFORE the expansion — (key, kind) per type.
#: Payload keys are the product's contract with saved rules; a drift here is
#: a broken stored rule, so the snapshot is exact and deliberate.
ORIGINAL_TASK_SHAPE = (
    ("status", "select"), ("priority", "select"), ("title", "text"),
    ("project_id", "select"), ("column_id", "select"), ("category_id", "select"),
    ("due_at", "date"), ("assignee_user_ids", "list"),
    ("assignee_count", "number"), ("approval_status", "select"),
    ("created_by", "select"),
)

ORIGINAL_ELEVEN: dict[str, tuple] = {
    "task.created":        ORIGINAL_TASK_SHAPE,
    "task.status_changed": ORIGINAL_TASK_SHAPE,
    "task.overdue":        ORIGINAL_TASK_SHAPE + (("days_overdue", "number"),),
    "approval.pending": (
        ("request_type", "text"), ("project_id", "select"),
        ("created_by", "select"), ("task_id", "text"),
        ("days_waiting", "number"),
    ),
    "invoice.overdue": (
        ("invoice_number", "text"), ("balance_due", "number"),
        ("total", "number"), ("payment_status", "text"),
        ("client_id", "select"), ("created_by", "select"),
        ("days_overdue", "number"),
    ),
    "contact.created": (
        ("contact_type", "text"), ("source", "text"), ("company", "text"),
        ("client_id", "select"), ("assigned_to", "select"),
        ("has_email", "bool"), ("has_phone", "bool"),
    ),
    "contact.stale": (
        ("contact_type", "text"), ("source", "text"), ("company", "text"),
        ("assigned_to", "select"), ("client_id", "select"),
        ("lead_score", "number"), ("days_quiet", "number"),
    ),
    "deal.stage_changed": (
        ("stage", "text"), ("value", "number"), ("assigned_to", "select"),
        ("client_id", "select"),
    ),
    "stock.low": (
        ("product_name", "text"), ("quantity_on_hand", "number"),
        ("low_stock_threshold", "number"), ("shortfall", "number"),
    ),
    "metric.threshold": (
        ("metric", "text"), ("label", "text"), ("value", "number"),
        ("threshold", "number"), ("window_days", "number"),
    ),
    "attendance.summary": (
        ("report_date", "date"), ("marked_count", "number"),
        ("present_count", "number"), ("absent_count", "number"),
        ("late_count", "number"), ("half_day_count", "number"),
        ("on_leave_count", "number"),
    ),
}


# ── every new type is fully declared ─────────────────────────────────────────

@pytest.mark.parametrize("event_type", sorted(NEW_TYPES))
def test_every_new_type_is_registered_with_typed_fields(event_type):
    fields = registry.fields_for(event_type)
    assert fields, f"{event_type} is not in REGISTRY, or declares no fields"
    keys = [f.key for f in fields]
    assert len(keys) == len(set(keys)), (
        f"{event_type} declares a duplicate field key: {keys}"
    )
    for f in fields:
        assert f.key and f.label, f"{event_type}.{f.key!r} has no label"
        assert f.kind in OPERATORS, (
            f"{event_type}.{f.key} is kind {f.kind!r}, which OPERATORS does "
            f"not know — no operator could ever be offered for it"
        )
        assert registry.operators_for(event_type, f.key), (
            f"{event_type}.{f.key} resolves to zero operators"
        )


@pytest.mark.parametrize("event_type", sorted(NEW_TYPES))
def test_no_new_field_key_is_a_banned_payload_key(event_type):
    """`_clean` strips banned keys WITHOUT a log line. A registry field named
    `message` would be guaranteed on paper and absent in every event — the
    present-and-never-fillable defect in a new costume."""
    for f in registry.fields_for(event_type):
        assert f.key.lower() not in _BANNED_KEYS, (
            f"{event_type}.{f.key} collides with emit._BANNED_KEYS: `_clean` "
            "would strip it from every payload, silently"
        )


# ── unwired today, and unwired means unreachable ─────────────────────────────

@pytest.mark.parametrize("event_type", sorted(NEW_TYPES))
def test_every_new_type_is_currently_unwired(event_type):
    """A wiring agent removes its line from UNWIRED in the same commit as the
    first call site. Until then the name must sit here."""
    assert event_type in registry.UNWIRED, (
        f"{event_type} left UNWIRED — that is only legitimate in the commit "
        "that wires its first emitter call site"
    )


def test_declared_but_unwired_never_reaches_the_catalog():
    """THE invariant. REGISTRY is what the engine can evaluate; the catalog is
    what the product can honestly offer; UNWIRED is exactly their difference."""
    offered = set(registry.catalog_event_types())
    assert not (offered & set(NEW_TYPES)), (
        "the builder is offering expansion triggers nothing emits: "
        f"{sorted(offered & set(NEW_TYPES))}"
    )
    assert not (offered & registry.UNWIRED)
    assert registry.UNWIRED <= set(registry.REGISTRY), (
        "UNWIRED names events that are not in REGISTRY — a stale name hides "
        "nothing"
    )


@pytest.mark.parametrize("event_type", sorted(NEW_TYPES))
def test_the_validator_refuses_an_unwired_type_outright(event_type):
    """Hiding from the catalog fixed the builder once and nothing else — a
    client POSTing the type directly must be refused, not humoured."""
    with pytest.raises(RuleInvalid):
        validate_event_type(event_type)


# ── the original eleven are untouched ────────────────────────────────────────

def test_the_original_eleven_are_exactly_what_they_were():
    """Payload keys are the contract with saved rules; renaming one is a
    migration. The expansion may add types, never move existing fields."""
    for event_type, expected in ORIGINAL_ELEVEN.items():
        got = tuple((f.key, f.kind) for f in registry.fields_for(event_type))
        assert got == expected, (
            f"{event_type} drifted.\n  expected {expected}\n  got      {got}"
        )


def test_no_original_type_was_swept_into_unwired():
    """All eleven are emitted today (app call sites or predicates); putting one
    in UNWIRED would withdraw a working trigger from the builder."""
    swept = set(ORIGINAL_ELEVEN) & registry.UNWIRED
    assert not swept, f"originally-wired types found in UNWIRED: {sorted(swept)}"
    offered = set(registry.catalog_event_types())
    missing = set(ORIGINAL_ELEVEN) - offered
    assert not missing, f"originally-offered types left the catalog: {sorted(missing)}"


# ── the emitters exist, are async, and emit what they say ────────────────────

@pytest.mark.parametrize("event_type,emitter", sorted(NEW_TYPES.items()))
def test_every_emitter_exists_and_is_async(event_type, emitter):
    fn = getattr(subjects, emitter, None)
    assert fn is not None, f"subjects.{emitter} does not exist"
    assert inspect.iscoroutinefunction(fn), (
        f"subjects.{emitter} is not async — every emitter takes the caller's "
        "connection and awaits emit_event inside the caller's transaction"
    )


def _event_type_by_emitter() -> dict[str, str]:
    """Emitter name → the event type its `event_type=` keyword names, read off
    the AST the same way the catalog ratchet reads it."""
    src = io.open(ROOT / "services" / "niyam" / "subjects.py", encoding="utf-8").read()
    tree = ast.parse(src)
    consts = {n.targets[0].id: n.value.value
              for n in tree.body
              if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
              and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
    out = {}
    for fn in tree.body:
        if not isinstance(fn, ast.AsyncFunctionDef):
            continue
        for node in ast.walk(fn):
            if isinstance(node, ast.keyword) and node.arg == "event_type":
                if isinstance(node.value, ast.Name) and node.value.id in consts:
                    out[fn.name] = consts[node.value.id]
    return out


@pytest.mark.parametrize("event_type,emitter", sorted(NEW_TYPES.items()))
def test_every_emitter_names_its_own_event_type(event_type, emitter):
    """The catalog ratchet decides "wired" by finding a CALL to the emitter and
    reading the constant it passes as `event_type=`. An emitter that passed a
    literal string, or the wrong constant, would wire one event while claiming
    another — and this interface exists so that cannot happen."""
    by_emitter = _event_type_by_emitter()
    assert by_emitter.get(emitter) == event_type, (
        f"subjects.{emitter} does not pass event_type=<constant for "
        f"{event_type!r}> — it emits {by_emitter.get(emitter)!r}"
    )


def test_the_expansion_is_all_twenty_nine():
    """A guard on the guard, the metric-alerts pattern: parametrised tests
    skip on an empty set, so the count itself is pinned."""
    assert len(NEW_TYPES) == 29
    assert len(registry.UNWIRED) >= 29
