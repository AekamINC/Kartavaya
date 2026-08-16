"""Evaluating one condition, and refusing rather than guessing.

THE POLARITY, STATED ONCE
-------------------------
The frontend's FilterBuilder returns True for a clause it cannot evaluate
(`if (!raw || !c.value) return true`). That is CORRECT for a view — an
incomplete filter should not hide rows from someone who is still typing it — and
it is catastrophic here, because the thing on the other side of a rule's
condition is an ACTION. A view that shows too many rows is untidy; a rule that
fires because it could not tell whether it should have is a message sent to a
customer.

So: the operator strings are shared with FilterBuilder, and the semantics are
inverted. An unevaluable condition NEVER passes.

THREE OUTCOMES, NOT TWO
-----------------------
    ok       the condition matched; the pipeline continues
    refused  it legitimately did not match — this is the normal, common, boring
             outcome, and the run records what was compared so that "why did my
             rule not fire" has an answer that is not a server log
    failed   it could not be evaluated at all: the field is not carried by this
             event type, the operator does not exist for the field's kind, or
             the stored comparand is the wrong shape. That is a BUG in the rule,
             not a fact about the data, and collapsing it into `refused` is how
             a permanently broken rule comes to look like a rule that simply
             has not matched yet.

The old engine had the right instinct here — it refused and logged the field
name. What it lacked was anywhere for a person to read the refusal.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any, NamedTuple, Optional

from .registry import MISSING, NULL_SAFE, OPERATORS, field, read

#: `''` counts as empty as well as NULL, because `graha_contacts.source`
#: defaults to the empty string rather than to NULL — an author asking "lead
#: source is empty" means both and would otherwise get neither. See `_is_empty`.


class Verdict(NamedTuple):
    outcome: str          # 'ok' | 'refused' | 'failed'
    reason: str
    detail: dict

    @property
    def passed(self) -> bool:
        return self.outcome == "ok"


def _v(outcome: str, reason: str, **detail) -> Verdict:
    return Verdict(outcome, reason, detail)


def _is_empty(value: Any) -> bool:
    """Empty means "nothing is there", NOT "falsy".

    `0` is a number somebody chose and `False` is an answer somebody gave; both
    are values. Treating them as empty is the classic truthiness bug, and here
    it would make "deal value is empty" match a deal worth nothing — which is a
    deal, not a blank.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return value is None


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None                       # a bool is not a number here
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _as_datetime(value: Any) -> Optional[_dt.datetime]:
    """Parse the ISO strings `subjects.py` renders, and nothing else.

    Payload dates are always `isoformat()` output because `_clean` DROPS a raw
    datetime — so anything else arriving here is a shape the emitter should have
    rendered and did not, which is a `failed`, not a silent pass.
    """
    if isinstance(value, _dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=_dt.timezone.utc)
    if isinstance(value, str):
        try:
            parsed = _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=_dt.timezone.utc)
    return None


def evaluate(payload, event_type: str, config: dict, *, now=None) -> Verdict:
    """Evaluate one stored condition against one event's payload.

    `config` is `{"field": ..., "operator": ..., "value": ...}` as the builder
    stored it. Nothing here trusts it: a rule saved months ago may name a field
    the registry has since dropped, and that must surface as `failed` rather
    than as an exception inside a drain loop.
    """
    key = (config or {}).get("field")
    op = (config or {}).get("operator")
    want = (config or {}).get("value")

    if not key or not op:
        return _v("failed", "the condition stores no field or no operator",
                  field=key, operator=op)

    spec = field(event_type, key)
    if spec is None:
        # The registry is the authority on what is askable. A field that is not
        # in it either never existed or was removed, and both mean this rule can
        # no longer be evaluated — which the author needs told, loudly.
        return _v("failed",
                  f"`{key}` is not a field that `{event_type}` events carry",
                  field=key, event_type=event_type)

    if op not in OPERATORS.get(spec.kind, ()):
        return _v("failed",
                  f"`{op}` is not an operator for a {spec.kind} field",
                  field=key, operator=op, kind=spec.kind,
                  allowed=list(OPERATORS.get(spec.kind, ())))

    got = read(payload, event_type, key)

    if got is MISSING:
        # The registry says the event type carries it, and this event does not.
        # That is an emitter that has drifted from its own contract, and it is
        # exactly the class of bug `test_niyam_payload_keys_are_real` exists for.
        return _v("failed",
                  f"this event carries no `{key}`, though `{event_type}` should",
                  field=key)

    if got is None and op not in NULL_SAFE:
        # THE INVERSION. FilterBuilder passes here; a rule must not.
        return _v("refused",
                  f"`{key}` is empty, and `{op}` cannot compare an empty value",
                  field=key, operator=op, got=None)

    return _apply(spec, op, got, want, now=now)


def _apply(spec, op, got, want, *, now=None) -> Verdict:
    d = {"field": spec.key, "operator": op, "got": got, "want": want}

    if op == "is_empty":
        return _v("ok" if _is_empty(got) else "refused",
                  f"`{spec.key}` is {'empty' if _is_empty(got) else 'not empty'}", **d)
    if op == "not_empty":
        return _v("refused" if _is_empty(got) else "ok",
                  f"`{spec.key}` is {'empty' if _is_empty(got) else 'not empty'}", **d)

    if spec.kind == "list":
        items = got if isinstance(got, (list, tuple)) else []
        if op == "contains":
            return _v("ok" if want in items else "refused",
                      f"`{spec.key}` {'contains' if want in items else 'does not contain'} {want!r}", **d)
        if op == "not_contains":
            return _v("refused" if want in items else "ok",
                      f"`{spec.key}` {'contains' if want in items else 'does not contain'} {want!r}", **d)

    if spec.kind == "number":
        a, b = _as_number(got), _as_number(want)
        if a is None or b is None:
            return _v("failed",
                      f"`{spec.key}` compares numbers, and one side is not one", **d)
        ok = {"is": a == b, "is_not": a != b, "gt": a > b,
              "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
        return _v("ok" if ok else "refused", f"{a} {op} {b} is {ok}", **d)

    if spec.kind == "date":
        left = _as_datetime(got)
        if left is None:
            return _v("failed",
                      f"`{spec.key}` is not a date this engine can read: {got!r}", **d)
        moment = now or _dt.datetime.now(_dt.timezone.utc)
        if op == "within_days":
            days = _as_number(want)
            if days is None:
                return _v("failed", "`within_days` needs a number of days", **d)
            # Deliberately forward-looking and inclusive of now: "due within 2
            # days" is a question about the near future, and a task that is
            # already overdue is NOT within the next two days. Overdue is a
            # separate temporal predicate the sweep emits, not an operator.
            ok = moment <= left <= moment + _dt.timedelta(days=days)
            return _v("ok" if ok else "refused",
                      f"`{spec.key}` is {'within' if ok else 'outside'} the next {days:g} days", **d)
        right = _as_datetime(want)
        if right is None:
            return _v("failed", f"`{op}` needs a date to compare against", **d)
        ok = left < right if op == "before" else left > right
        return _v("ok" if ok else "refused", f"{left.isoformat()} {op} {right.isoformat()}", **d)

    if spec.kind == "bool":
        ok = bool(got) is bool(want)
        return _v("ok" if ok else "refused", f"`{spec.key}` is {bool(got)}", **d)

    # text and select
    if op == "one_of":
        options = want if isinstance(want, (list, tuple)) else None
        if options is None:
            return _v("failed", "`one_of` needs a list of values", **d)
        ok = got in options
        return _v("ok" if ok else "refused",
                  f"`{spec.key}` is {'one of' if ok else 'not one of'} {list(options)!r}", **d)

    left = got if isinstance(got, str) else str(got)
    right = want if isinstance(want, str) else str(want)
    if op == "is":
        ok = left == right
    elif op == "is_not":
        ok = left != right
    elif op == "contains":
        ok = right.lower() in left.lower()
    elif op == "not_contains":
        ok = right.lower() not in left.lower()
    else:                                   # unreachable: guarded by OPERATORS
        return _v("failed", f"unhandled operator `{op}`", **d)
    return _v("ok" if ok else "refused", f"{left!r} {op} {right!r} is {ok}", **d)


def evaluate_all(payload, event_type: str, configs, *, now=None) -> Verdict:
    """Every condition must pass. The FIRST non-ok verdict is the answer.

    Returned rather than reduced to a boolean so the run step can record which
    condition stopped the rule and what it compared — the whole reason a person
    can answer "why did my rule not fire" without reading a log.
    """
    for cfg in configs or ():
        verdict = evaluate(payload, event_type, cfg, now=now)
        if verdict.outcome != "ok":
            return verdict
    return _v("ok", "every condition passed", count=len(list(configs or ())))
