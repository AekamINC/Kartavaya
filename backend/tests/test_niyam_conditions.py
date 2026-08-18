"""The condition evaluator: what it matches, and what it refuses to guess at.

The refusals carry the weight. An action sits on the other side of every
condition, so a clause that cannot be evaluated must never pass — the opposite
of the frontend FilterBuilder this shares its operator names with.
"""
from __future__ import annotations

import datetime as _dt

import pytest

from services.niyam import conditions as C
from services.niyam import registry as R
from services.niyam.subjects import (
    CONTACT_CREATED, DEAL_STAGE_CHANGED, TASK_STATUS_CHANGED,
)

NOW = _dt.datetime(2026, 8, 16, 12, 0, tzinfo=_dt.timezone.utc)


def payload(**after):
    return {"before": {}, "after": after}


def ev(after, cfg, event_type=TASK_STATUS_CHANGED):
    return C.evaluate(payload(**after), event_type, cfg, now=NOW)


# ── the ordinary cases ───────────────────────────────────────────────────────

def test_select_is_and_is_not():
    assert ev({"status": "done"}, {"field": "status", "operator": "is", "value": "done"}).passed
    assert not ev({"status": "todo"}, {"field": "status", "operator": "is", "value": "done"}).passed
    assert ev({"status": "todo"}, {"field": "status", "operator": "is_not", "value": "done"}).passed


def test_text_contains_is_case_insensitive():
    cfg = {"field": "title", "operator": "contains", "value": "LEDGER"}
    assert ev({"title": "Reconcile the august ledger"}, cfg).passed


def test_number_comparisons():
    cfg = {"field": "assignee_count", "operator": "gte", "value": 2}
    assert ev({"assignee_count": 3}, cfg).passed
    assert not ev({"assignee_count": 1}, cfg).passed


def test_a_list_uses_contains_for_membership():
    """`is` on a list would compare the whole array to one id and match nothing.
    'Assigned to Priya' is the condition people most want."""
    cfg = {"field": "assignee_user_ids", "operator": "contains", "value": "user_priya"}
    assert ev({"assignee_user_ids": ["user_a", "user_priya"]}, cfg).passed
    assert not ev({"assignee_user_ids": ["user_a"]}, cfg).passed


def test_unassigned_is_is_empty_not_a_null_check():
    """`assignee_user_ids` is never null — subjects.py defaults it to []."""
    cfg = {"field": "assignee_user_ids", "operator": "is_empty", "value": None}
    assert ev({"assignee_user_ids": []}, cfg).passed
    assert not ev({"assignee_user_ids": ["user_a"]}, cfg).passed


def test_within_days_looks_forward_only():
    """An already-overdue task is NOT 'due within 2 days'. Overdue is a
    temporal predicate the sweep emits, not an operator."""
    cfg = {"field": "due_at", "operator": "within_days", "value": 2}
    soon = (NOW + _dt.timedelta(days=1)).isoformat()
    past = (NOW - _dt.timedelta(days=1)).isoformat()
    far  = (NOW + _dt.timedelta(days=9)).isoformat()
    assert ev({"due_at": soon}, cfg).passed
    assert not ev({"due_at": past}, cfg).passed
    assert not ev({"due_at": far}, cfg).passed


def test_one_of():
    cfg = {"field": "priority", "operator": "one_of", "value": ["high", "urgent"]}
    assert ev({"priority": "urgent"}, cfg).passed
    assert not ev({"priority": "low"}, cfg).passed


# ── the inversion ────────────────────────────────────────────────────────────

def test_a_null_value_REFUSES_rather_than_passing():
    """FilterBuilder.jsx returns true here. A rule must not.

    That single line is the difference between a view showing an extra row and
    an automation emailing a customer because it could not tell whether it
    should have.
    """
    v = ev({"due_at": None}, {"field": "due_at", "operator": "before", "value": NOW.isoformat()})
    assert v.outcome == "refused"
    assert not v.passed
    assert "empty" in v.reason


@pytest.mark.parametrize("op", ["is_empty", "not_empty"])
def test_the_two_null_safe_operators_still_evaluate_on_null(op):
    v = ev({"category_id": None}, {"field": "category_id", "operator": op, "value": None})
    assert v.outcome in ("ok", "refused"), "must be a real verdict, never 'failed'"


def test_an_empty_string_counts_as_empty():
    """`graha_contacts.source` defaults to '' rather than NULL, so an author
    asking 'lead source is empty' means both and would otherwise get neither."""
    v = C.evaluate(payload(source=""), CONTACT_CREATED,
                   {"field": "source", "operator": "is_empty", "value": None}, now=NOW)
    assert v.passed


# ── failed, which is not the same as refused ─────────────────────────────────

def test_a_field_the_event_type_does_not_carry_is_FAILED_not_refused():
    """A permanently broken rule must not look like one that has not matched yet."""
    v = ev({"status": "done"}, {"field": "invoice_total", "operator": "is", "value": 1})
    assert v.outcome == "failed"
    assert "not a field" in v.reason


def test_an_operator_the_kind_does_not_offer_is_FAILED():
    v = ev({"priority": "high"},
           {"field": "priority", "operator": "within_days", "value": 2})
    assert v.outcome == "failed"
    assert v.detail["allowed"]


def test_a_field_the_registry_promises_but_the_event_omits_is_FAILED():
    """An emitter that drifted from its own contract. This is the class of bug
    `test_niyam_payload_keys_are_real` exists to prevent, caught at runtime as
    well because a stored rule outlives the emitter that made it valid."""
    v = ev({"status": "done"}, {"field": "priority", "operator": "is", "value": "high"})
    assert v.outcome == "failed"
    assert "carries no" in v.reason


def test_an_unparseable_date_is_FAILED_not_a_silent_pass():
    v = ev({"due_at": "next tuesday"},
           {"field": "due_at", "operator": "before", "value": NOW.isoformat()})
    assert v.outcome == "failed"


def test_a_condition_with_no_field_or_operator_is_FAILED():
    assert ev({}, {}).outcome == "failed"
    assert ev({}, {"field": "status"}).outcome == "failed"


def test_a_bool_is_not_a_number():
    """`has_email: True` must not compare as 1 — that would make
    'has_email is 1' a rule somebody could write and misread."""
    v = C.evaluate(payload(value=True), DEAL_STAGE_CHANGED,
                   {"field": "value", "operator": "gt", "value": 0}, now=NOW)
    assert v.outcome == "failed"


# ── the whole pipeline ───────────────────────────────────────────────────────

def test_evaluate_all_returns_the_first_non_ok_verdict():
    """Returned, not reduced to a boolean, so the run step can say WHICH
    condition stopped the rule — the answer to the most common question anyone
    asks about an automation product."""
    cfgs = [
        {"field": "status", "operator": "is", "value": "done"},
        {"field": "priority", "operator": "is", "value": "urgent"},
    ]
    v = C.evaluate_all(payload(status="done", priority="low"), TASK_STATUS_CHANGED, cfgs, now=NOW)
    assert v.outcome == "refused"
    assert v.detail["field"] == "priority"


def test_no_conditions_at_all_passes():
    """A rule with no conditions is 'on every event of this type', which is a
    legitimate and common rule."""
    assert C.evaluate_all(payload(status="done"), TASK_STATUS_CHANGED, [], now=NOW).passed


# ── the registry's own promises ──────────────────────────────────────────────

def test_every_registry_field_has_at_least_one_operator():
    """A field with no operators is offerable and unusable — it would appear in
    the builder's field list and then present an empty operator dropdown."""
    for event_type in R.REGISTRY:
        for f in R.fields_for(event_type):
            assert R.operators_for(event_type, f.key), f"{event_type}.{f.key}"


def test_an_unknown_event_type_offers_nothing():
    # `nonsense.event`, the validator tests' spelling of "never real". This
    # used to probe with `invoice.paid`, which the 2026-08 expansion then
    # DECLARED — a fixture chosen as unknown must be unknowable, not merely
    # unknown today.
    assert R.fields_for("nonsense.event") == ()
    assert R.operators_for("nonsense.event", "anything") == ()


def test_the_envelope_source_is_not_confusable_with_the_lead_source():
    """Two different things share the name `source`: the lead's origin (a
    payload field) and the allowlisted {app,import,sweep,cron} envelope column.
    Only the payload one is conditionable."""
    assert R.field(CONTACT_CREATED, "source").label == "Lead source"
    assert "source" in R.ENVELOPE_FIELDS


def test_task_statuses_come_from_the_transition_policy():
    """Restating them here would let the two drift, and the policy is the one
    that refuses a transition at runtime."""
    from services.task_transitions import TASK_STATUSES
    assert set(R.field(TASK_STATUS_CHANGED, "status").options) == set(TASK_STATUSES)


def test_deal_stage_is_not_a_hardcoded_select():
    """The options are per-org rows in graha_pipelines.stages. A fixed list
    would be wrong for any org that edited its pipeline."""
    assert R.field(DEAL_STAGE_CHANGED, "stage").kind == "text"
