"""Authoring-time refusal, and the templates that have to survive it.

The design's promise is that a broken rule is UNWRITABLE. The old engine made
the same check at runtime and was right to — it just made it after the rule was
saved, after the builder had offered the field, on a rule the UI showed as
Active for ever. These tests pin the check to the moment before the row exists.
"""
from __future__ import annotations

import pytest

from services.niyam.templates import TEMPLATES, by_id
from services.niyam.validate import (
    MAX_RECIPIENTS, MAX_WAIT_MINUTES, RuleInvalid, validate_event_type, validate_steps,
)
from services.niyam.subjects import TASK_CREATED, TASK_STATUS_CHANGED

NOTIFY = {"kind": "action",
          "config": {"verb": "notify.send", "to": ["user_a"],
                     "title": "t", "channel": "inapp"}}


def steps(*s):
    return list(s)


# ── the templates are the strongest test in this file ────────────────────────

@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t["id"])
def test_every_shipped_template_validates(template):
    """A template a user cannot save is not a template, it is an advertisement.

    Proposal 57 sketched fifteen starter rules; most need verbs this build does
    not have. Shipping those would recreate the exact disease being cured — a
    builder selling triggers that never fire.
    """
    validate_event_type(template["event_type"])
    out = validate_steps(template["event_type"], template["steps"])
    assert out and any(s["kind"] == "action" for s in out)


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t["id"])
def test_every_template_uses_only_allowlisted_verbs(template):
    from services.niyam.actions import ACTIONS
    for s in template["steps"]:
        if s["kind"] == "action":
            assert s["config"]["verb"] in ACTIONS


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t["id"])
def test_every_template_explains_itself(template):
    """A template nobody understands is cloned once and left enabled for ever."""
    assert len(template["why"]) > 40


def test_template_ids_are_unique():
    ids = [t["id"] for t in TEMPLATES]
    assert len(ids) == len(set(ids))
    assert by_id(ids[0]) is not None
    assert by_id("nope") is None


# ── conditions ───────────────────────────────────────────────────────────────

def test_a_field_the_event_does_not_carry_is_refused_at_save():
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "condition",
             "config": {"field": "invoice_total", "operator": "is", "value": 1}},
            NOTIFY))
    assert e.value.step_no == 0
    assert "cannot ask about it" in e.value.message


def test_an_operator_the_kind_does_not_offer_is_refused():
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "condition",
             "config": {"field": "priority", "operator": "within_days", "value": 2}},
            NOTIFY))
    assert "not a way to compare" in e.value.message


def test_a_value_outside_a_select_is_refused():
    """`tasks.status` has no CHECK in the database, so this list is the only
    thing standing between an author and a rule that can never match."""
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "condition",
             "config": {"field": "status", "operator": "is", "value": "finished"}},
            NOTIFY))
    assert "not a status" in e.value.message.lower() or "Choose one of" in e.value.message


def test_a_condition_with_no_comparand_is_refused():
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "condition",
             "config": {"field": "title", "operator": "contains", "value": "  "}},
            NOTIFY))


def test_one_of_needs_a_non_empty_list():
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "condition",
             "config": {"field": "priority", "operator": "one_of", "value": []}},
            NOTIFY))


def test_is_empty_needs_no_comparand():
    out = validate_steps(TASK_CREATED, steps(
        {"kind": "condition",
         "config": {"field": "assignee_user_ids", "operator": "is_empty", "value": None}},
        NOTIFY))
    assert len(out) == 2


# ── actions ──────────────────────────────────────────────────────────────────

def test_a_verb_outside_the_allowlist_is_refused():
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED,
                       steps({"kind": "action", "config": {"verb": "invoice.create"}}))
    assert "not something a rule can do" in e.value.message


def test_a_notification_with_nobody_to_send_to_is_refused():
    """The old engine's `assign_to` defaulted to [], wrote it, reported success,
    and unassigned everyone on the task."""
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "action",
             "config": {"verb": "notify.send", "to": [], "title": "t"}}))
    assert e.value.field == "to"


def test_a_notification_with_no_title_is_refused():
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "action",
             "config": {"verb": "notify.send", "to": ["user_a"], "title": " "}}))
    assert e.value.field == "title"


def test_a_rule_may_not_become_a_broadcast():
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "action",
             "config": {"verb": "notify.send", "title": "t",
                        "to": [f"user_{i}" for i in range(MAX_RECIPIENTS + 1)]}}))


def test_an_unknown_channel_is_refused():
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "action",
             "config": {"verb": "notify.send", "to": ["user_a"], "title": "t",
                        "channel": "sms"}}))
    assert e.value.field == "channel"


# ── waits ────────────────────────────────────────────────────────────────────

def test_a_wait_must_be_positive_and_bounded():
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED,
                       steps({"kind": "wait", "config": {"minutes": 0}}, NOTIFY))
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED,
                       steps({"kind": "wait", "config": {"minutes": MAX_WAIT_MINUTES + 1}},
                             NOTIFY))


def test_a_rule_cannot_end_on_a_wait():
    """It would go to sleep and wake up to do nothing."""
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED,
                       steps(NOTIFY, {"kind": "wait", "config": {"minutes": 10}}))
    assert "cannot end on a wait" in e.value.message


# ── the shape of a rule ──────────────────────────────────────────────────────

def test_a_rule_that_would_do_nothing_is_refused():
    """Migration 103 exists because the old builder allowed this and the page
    had to render 'This rule does nothing' against stored rules whose run count
    was still climbing. A draft is `enabled=false`, not an action-less rule."""
    with pytest.raises(RuleInvalid) as e:
        validate_steps(TASK_STATUS_CHANGED, steps(
            {"kind": "condition",
             "config": {"field": "status", "operator": "is", "value": "done"}}))
    assert "would do nothing" in e.value.message


def test_an_empty_rule_is_refused():
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED, [])


def test_steps_are_renumbered_from_zero():
    """The client's step_no is not trusted: a gap or duplicate would either
    violate the UNIQUE constraint or silently reorder the pipeline."""
    out = validate_steps(TASK_STATUS_CHANGED, [
        {"kind": "condition", "step_no": 99,
         "config": {"field": "status", "operator": "is", "value": "done"}},
        {**NOTIFY, "step_no": 5},
    ])
    assert [s["step_no"] for s in out] == [0, 1]


def test_an_unknown_event_type_is_refused():
    # "nonsense.event", because the previous probe was `invoice.paid` — a
    # declared-but-unwired type at the time, and a REAL one since the 2026-08
    # wiring wave. A probe must be a string that can never become true.
    with pytest.raises(RuleInvalid) as e:
        validate_event_type("nonsense.event")
    assert "not something this product emits" in e.value.message


def test_an_unknown_step_kind_is_refused():
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED, steps({"kind": "branch", "config": {}}))
