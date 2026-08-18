"""Refusing a broken rule at AUTHORING time, which is the whole design.

The old engine validated at runtime and was right to: it checked whether the
event could answer the condition, found it could not, refused to fire, and wrote
the reason to a server log. Everything about that is correct except WHERE it
happened. The rule was already saved, the builder had already offered the field,
and the UI displayed it as Active for ever.

So the same check runs here, before the row exists. A condition the event cannot
answer is not saveable; an action the allowlist does not contain is not
saveable; a rule that would do nothing is not saveable. What the builder offers
and what the engine can evaluate come from ONE registry, so they cannot drift.

WHY A RULE WITH NO ACTION IS REFUSED
------------------------------------
Migration 103 exists because the old builder saved rules whose actions could
never run, and the page had to render "This rule does nothing" against them. A
rule that does nothing is not a draft — a draft is `enabled=false`. It is a rule
someone believes is working, and its run count still climbs.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any

from .actions import ACTIONS
from .conditions import _as_datetime, _as_number
from .registry import OPERATORS, catalog_event_types, field

#: A wait is measured in minutes and capped at 30 days. There is no product
#: reason to wait longer, and an unbounded wait is a run that sits in the resume
#: index for ever — plus a typo (90000 meaning 90 seconds) becomes two months.
MAX_WAIT_MINUTES = 60 * 24 * 30

#: One rule may not fan out past this. A rule is a rule, not a mailing list; a
#: recipient list this long is a sign somebody is using an automation as a
#: broadcast tool, which is what `notify.send` is deliberately bad at.
MAX_RECIPIENTS = 20

#: Deliberately small. A pipeline longer than this is unreadable in a card list,
#: and the design chose a linear list precisely so that a rule stays legible.
MAX_STEPS = 12


class RuleInvalid(ValueError):
    """Carries the step number so the builder can point at the right card."""

    def __init__(self, message: str, *, step_no: int | None = None, field_: str | None = None):
        super().__init__(message)
        self.message = message
        self.step_no = step_no
        self.field = field_

    def as_dict(self) -> dict:
        return {"error": self.message, "step_no": self.step_no, "field": self.field}


def validate_event_type(event_type: str) -> None:
    """Refuse a trigger the product cannot actually emit.

    ── WHY THIS IS NOT `REGISTRY` ──────────────────────────────────────────────

    `REGISTRY` is what the ENGINE can EVALUATE. It still holds `contact.created`
    and `deal.stage_changed`, whose emitters are written in `subjects.py` and
    called by nothing — so gating here on `REGISTRY` accepted a rule that can
    never fire, and the message said so in the same breath: it read "is not
    something this product emits" while admitting two event types the product
    does not emit.

    Hiding them from `GET /catalog` fixed the builder and nothing else. Review
    proved the API still returned 201 for a client that posted the event_type
    directly, and that the refusal for an unknown trigger LISTED both as valid
    choices. A rule saved that way can never accumulate a run, so arming it is
    refused too — with a message telling its author to wait for dry runs that
    cannot happen.

    `catalog_event_types()` is the same list the builder is offered, so the two
    cannot drift: one function, two callers.

    NOT APPLIED TO EXISTING RULES. This runs on CREATE only (`niyam_rules.py`
    POST /rules). `PATCH` validates steps against the rule's stored event_type
    and never re-checks the type itself, which is deliberate — withdrawing a
    trigger must not strand a rule somebody already saved, leaving them unable
    to edit or disable it.
    """
    if event_type not in catalog_event_types():
        raise RuleInvalid(
            f"`{event_type}` is not something this product emits. "
            f"Choose one of: {', '.join(catalog_event_types())}")


def _validate_condition(event_type: str, cfg: dict, step_no: int) -> None:
    key, op, want = cfg.get("field"), cfg.get("operator"), cfg.get("value")

    spec = field(event_type, key) if key else None
    if spec is None:
        raise RuleInvalid(
            f"`{key}` is not something a `{event_type}` event carries, so a "
            f"rule cannot ask about it.", step_no=step_no, field_=key)

    allowed = OPERATORS.get(spec.kind, ())
    if op not in allowed:
        raise RuleInvalid(
            f"`{op}` is not a way to compare a {spec.kind}. "
            f"For {spec.label!r} you can use: {', '.join(allowed)}",
            step_no=step_no, field_=key)

    # The comparand's SHAPE is checked here rather than left to the evaluator,
    # because the evaluator's answer would be `failed` at 3am on a real event
    # instead of a red field while somebody is looking at it.
    if op in ("is_empty", "not_empty"):
        return
    if op == "one_of":
        if not isinstance(want, (list, tuple)) or not want:
            raise RuleInvalid("`one of` needs at least one value to match against.",
                              step_no=step_no, field_=key)
        return
    if want is None or (isinstance(want, str) and not want.strip()):
        raise RuleInvalid(f"{spec.label!r} needs a value to compare against.",
                          step_no=step_no, field_=key)
    if spec.kind == "number" and _as_number(want) is None:
        raise RuleInvalid(f"{spec.label!r} compares numbers, and {want!r} is not one.",
                          step_no=step_no, field_=key)
    if spec.kind == "date":
        if op == "within_days":
            days = _as_number(want)
            if days is None or days <= 0:
                raise RuleInvalid("`within` needs a positive number of days.",
                                  step_no=step_no, field_=key)
        elif _as_datetime(want) is None:
            raise RuleInvalid(f"{want!r} is not a date this engine can read.",
                              step_no=step_no, field_=key)
    if spec.options and op in ("is", "is_not") and want not in spec.options:
        raise RuleInvalid(
            f"{want!r} is not a {spec.label.lower()}. Choose one of: "
            f"{', '.join(map(str, spec.options))}", step_no=step_no, field_=key)


def _validate_action(cfg: dict, step_no: int) -> None:
    verb = cfg.get("verb")
    if verb not in ACTIONS:
        raise RuleInvalid(
            f"`{verb}` is not something a rule can do. "
            f"Available: {', '.join(sorted(ACTIONS))}", step_no=step_no)

    if verb == "task.set_status":
        from services.task_transitions import TASK_STATUSES
        if cfg.get("status") not in TASK_STATUSES:
            raise RuleInvalid(
                f"Setting a task to {cfg.get('status')!r} is not a status this "
                f"product has. Choose one of: {', '.join(sorted(TASK_STATUSES))}",
                step_no=step_no, field_="status")

    if verb == "notify.send":
        to = cfg.get("to")
        if isinstance(to, str):
            to = [to]
        if not to:
            # The old engine's `assign_to` defaulted to `[]`, wrote it, and
            # reported success — unassigning everyone on the task. An empty
            # recipient list is an unfinished rule, and it is refused rather
            # than saved and discovered later.
            #
            # A TOKEN counts as naming somebody. "@assignees" is a question the
            # engine answers per event, and refusing it here would make the
            # commonest rule anyone wants ("tell whoever asked for it")
            # unwritable without hardcoding a person it is not about.
            raise RuleInvalid("Choose at least one person to notify.",
                              step_no=step_no, field_="to")
        if len(to) > MAX_RECIPIENTS:
            raise RuleInvalid(
                f"A rule may notify at most {MAX_RECIPIENTS} people. "
                f"This one names {len(to)}.", step_no=step_no, field_="to")
        if not (cfg.get("title") or "").strip():
            raise RuleInvalid("A notification needs a title.",
                              step_no=step_no, field_="title")
        # Validated against what can be DELIVERED, not what is recognised. The
        # two were one set, `email` was in it, and `deliver()` refuses email —
        # so a rule naming it saved cleanly, reported valid, and failed on every
        # event for ever. A channel that cannot deliver is a broken rule, and a
        # broken rule must be unwritable.
        from .send import CHANNELS, PLANNED_CHANNELS
        channel = cfg.get("channel", "inapp")
        if channel in PLANNED_CHANNELS:
            raise RuleInvalid(
                f"Niyam cannot send {channel} yet, so a rule that used it would "
                f"never reach anyone. Choose "
                f"{' or '.join(sorted(CHANNELS))} for now.",
                step_no=step_no, field_="channel")
        if channel not in CHANNELS:
            raise RuleInvalid(
                f"`{channel}` is not a way Niyam can reach someone. "
                f"Available: {', '.join(sorted(CHANNELS))}",
                step_no=step_no, field_="channel")

    if verb == "task.create":
        title = (cfg.get("title") or "").strip()
        if not title:
            raise RuleInvalid("A task needs a title.",
                              step_no=step_no, field_="title")
        if len(title) > 500:
            raise RuleInvalid("A task title can be at most 500 characters.",
                              step_no=step_no, field_="title")
        if not (cfg.get("team_id") or "").strip():
            # Most events belong to no team, so the target cannot come from
            # the event — the rule must name where the task goes, and a rule
            # that names nowhere is unfinished.
            raise RuleInvalid("Choose which project the task is created in.",
                              step_no=step_no, field_="team_id")
        if len(cfg.get("description") or "") > 4000:
            raise RuleInvalid(
                "A task description can be at most 4,000 characters.",
                step_no=step_no, field_="description")

    if verb == "report.send":
        # The verb reads EVERYTHING from the schedule row the event names —
        # recipients, type, window — re-read at run time, so config carries
        # nothing. A stray key is somebody expecting a setting that will
        # silently never apply, which is a broken rule and refused like one.
        extra = sorted(set(cfg) - {"verb"})
        if extra:
            raise RuleInvalid(
                f"report.send takes no settings — the schedule row carries "
                f"them all. Remove: {', '.join(extra)}",
                step_no=step_no, field_=extra[0])

    if verb == "task.add_comment":
        body = (cfg.get("body") or "").strip()
        if not body:
            # An empty comment saved now is a blank line discovered in a task
            # thread later — refused at save time like every other unfinished
            # rule.
            raise RuleInvalid("A comment needs something to say.",
                              step_no=step_no, field_="body")
        if len(body) > 4000:
            # The same ceiling the human route enforces (`CommentCreate.body`,
            # max_length=4000) — a rule must not be able to write a comment a
            # person could not.
            raise RuleInvalid("A comment can be at most 4,000 characters.",
                              step_no=step_no, field_="body")


def _validate_wait(cfg: dict, step_no: int) -> None:
    minutes = _as_number(cfg.get("minutes"))
    if minutes is None or minutes <= 0:
        raise RuleInvalid("A wait needs a positive number of minutes.",
                          step_no=step_no, field_="minutes")
    if minutes > MAX_WAIT_MINUTES:
        raise RuleInvalid(
            f"The longest wait is {MAX_WAIT_MINUTES // (60 * 24)} days. "
            f"This one is {minutes / (60 * 24):.0f}.",
            step_no=step_no, field_="minutes")


def validate_steps(event_type: str, steps: list) -> list:
    """Check every step and return them renumbered 0..n-1.

    Renumbering rather than trusting the client's `step_no`: the order is what
    the author sees in the card list, and a gap or a duplicate would either
    violate the UNIQUE constraint or silently reorder the pipeline.
    """
    if not steps:
        raise RuleInvalid("A rule needs at least one step.")
    if len(steps) > MAX_STEPS:
        raise RuleInvalid(f"A rule may have at most {MAX_STEPS} steps.")

    out = []
    for i, step in enumerate(steps):
        kind = (step or {}).get("kind")
        cfg = (step or {}).get("config") or {}
        if kind == "condition":
            _validate_condition(event_type, cfg, i)
        elif kind == "action":
            _validate_action(cfg, i)
        elif kind == "wait":
            _validate_wait(cfg, i)
        else:
            raise RuleInvalid(
                f"`{kind}` is not a kind of step. A rule is made of conditions, "
                f"actions and waits.", step_no=i)
        out.append({"step_no": i, "kind": kind, "config": cfg})

    if not any(s["kind"] == "action" for s in out):
        # Not a draft — a draft is `enabled=false`. This is a rule somebody
        # believes is working, whose run count would climb for ever while it did
        # nothing. Migration 103 exists because the old builder allowed exactly
        # this and the page had to render "This rule does nothing".
        raise RuleInvalid("This rule would do nothing — add an action.")

    if out[-1]["kind"] == "wait":
        # A wait at the end is a rule that goes to sleep and wakes up to do
        # nothing. Cheap to catch, confusing to debug.
        raise RuleInvalid("A rule cannot end on a wait — nothing would happen "
                          "when it woke up.", step_no=len(out) - 1)
    return out
