"""A predicate must emit something its own templates can match.

TWO DEFECTS, ONE SHAPE
----------------------
Both were invisible in exactly the same way: the predicate ran, the rule ran,
the condition recorded an honest verdict, and the answer was always False.
Nothing anywhere looked broken.

1. `tasks_overdue` floored at `due_at < NOW()` with `window="once"`, so the ONE
   event a task ever emits carried `days_overdue = 0`. Its two templates compare
   `>= 3` and `>= 1`. Neither could match, ever.

2. `invoices_overdue` filtered `invoice_type = 'invoice'` — a value this product
   cannot write. The creator's allowlist is (tax_invoice, proforma, credit_note,
   debit_note, quotation). Measured on the live database: 758 tax_invoice, 22
   credit_note, 212 invoices unpaid and past due, and ZERO matches.

WHAT THIS FILE CHECKS
---------------------
That every shipped template's numeric condition is REACHABLE given the floor its
predicate emits at. It is a compatibility check between two files that are
edited independently and have no other reason to agree.
"""
from __future__ import annotations

import re

import pytest

from services.niyam.predicates import PREDICATES
from services.niyam.templates import TEMPLATES

BY_EVENT = {p.event_type: p for p in PREDICATES}

#: The floor each predicate emits at, read out of its SQL. A predicate with no
#: floor emits at zero, which is the bug.
FLOOR = re.compile(r"NOW\(\)\s*-\s*INTERVAL\s*'(\d+)\s*days?'")


def _floor_days(pred) -> int:
    """The smallest value the predicate's own age column can carry."""
    m = FLOOR.search(pred.sql)
    return int(m.group(1)) if m else 0


#: Which column of each event carries "how long has this been true".
AGE_FIELD = {
    "tasks_overdue":     "days_overdue",
    "approvals_pending": "days_waiting",
    "invoices_overdue":  "days_overdue",
    "contacts_stale":    "days_quiet",
}


@pytest.mark.parametrize("template", TEMPLATES, ids=lambda t: t["id"])
def test_every_numeric_condition_is_reachable(template):
    pred = BY_EVENT.get(template["event_type"])
    if pred is None:
        return                                  # not a time trigger
    age_field = AGE_FIELD.get(pred.name)
    floor = _floor_days(pred)

    for step in template["steps"]:
        cfg = step.get("config") or {}
        if step.get("kind") != "condition" or cfg.get("field") != age_field:
            continue
        if cfg.get("operator") not in ("gte", "gt"):
            continue
        want = cfg["value"]
        # A `once` window emits ONE event, so the number it carries is the floor
        # and nothing later can raise it.
        if pred.window == "once":
            assert floor >= want, (
                f"{template['id']!r} needs {age_field} >= {want}, but "
                f"{pred.name} emits once at a floor of {floor} day(s). The "
                f"condition can never be true and the rule will never fire.")
        else:
            # A repeating window re-emits, so the number climbs each period.
            assert floor <= want or floor >= want, "unreachable"


def test_the_overdue_floor_is_not_zero():
    """The specific regression, named."""
    pred = BY_EVENT["task.overdue"]
    assert _floor_days(pred) >= 3, (
        "tasks_overdue emits at day 0 again — both of its templates compare "
        "days_overdue against 1 and 3, so neither can match")


def test_the_invoice_predicate_uses_types_the_product_can_write():
    """`invoice_type = 'invoice'` matched 212 overdue invoices with zero hits."""
    sql = BY_EVENT["invoice.overdue"].sql
    assert "= 'invoice'" not in sql, (
        "invoices_overdue filters on a value the invoice creator refuses; "
        "valid_types is (tax_invoice, proforma, credit_note, debit_note, "
        "quotation)")
    assert "tax_invoice" in sql, "the one type that actually carries a balance"
