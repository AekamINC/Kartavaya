"""Tests for services/proration.py — pure proration math.

The figures below changed on 2026-08-26 and the old ones are quoted beside
them, because the change was a DECISION and not a bug fix: owner decision 0.17,
"calendar minus Sundays, everywhere". A month is now as long here as it is on a
payslip — August 2026 is 26 days in both — so a mid-cycle credit and the
payroll beside it divide by the same denominator.
"""
from datetime import date
from decimal import Decimal

from services.proration import (
    days_in_period,
    module_cotermination,
    plan_change_lines,
    prorate,
    should_waive,
)


def test_days_in_period():
    # Was 31/28/29 — plain calendar days. Now the Sundays are out, which is what
    # `vetana.py` writes on every payslip as `working_days`.
    assert days_in_period(date(2026, 8, 1), date(2026, 9, 1)) == 26
    assert days_in_period(date(2026, 2, 1), date(2026, 3, 1)) == 24
    assert days_in_period(date(2024, 2, 1), date(2024, 3, 1)) == 25


def test_prorate_remaining():
    # Was 1548.39 (16/31). 13 billable days of 26.
    result = prorate(3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 16), direction="remaining")
    assert result == Decimal("1500.00")


def test_prorate_elapsed():
    # Was 1451.61 (15/31). The two halves of August 2026 hold 13 billable days
    # each, so the split is exact — and elapsed + remaining is the whole month,
    # which is the property a proration must never lose.
    result = prorate(3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 16), direction="elapsed")
    assert result == Decimal("1500.00")


def test_elapsed_and_remaining_are_the_whole_month():
    args = (3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 16))
    assert (prorate(*args, direction="elapsed")
            + prorate(*args, direction="remaining")) == Decimal("3000.00")


def test_prorate_event_at_start():
    result = prorate(3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 1), direction="remaining")
    assert result == Decimal("3000.00")


def test_prorate_event_at_end():
    result = prorate(3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 9, 1), direction="remaining")
    assert result == Decimal("0.00")


def test_prorate_zero_amount():
    result = prorate(0, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 15))
    assert result == Decimal("0.00")


def test_should_waive():
    assert should_waive(date(2026, 8, 31), date(2026, 8, 29)) is True
    assert should_waive(date(2026, 8, 31), date(2026, 8, 28)) is True
    assert should_waive(date(2026, 8, 31), date(2026, 8, 15)) is False


def test_plan_change_lines_upgrade():
    lines = plan_change_lines(
        old_rate=1000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert len(lines) == 2
    assert "credit" in lines[0]["description"].lower()
    assert "charge" in lines[1]["description"].lower()
    assert all(l["cadence"] == "one_off" for l in lines)


def test_plan_change_lines_downgrade():
    lines = plan_change_lines(
        old_rate=3000, new_rate=1000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert len(lines) == 2


# ── THE CREDIT IS A CREDIT (Phase 3.2, migration 222) ───────────────────────
#
# A mid-cycle change used to write BOTH halves as `kind='setup'`, which is a
# charge, so the client was billed for the plan they left as well as the one
# they moved to. These four tests are the ones that would have caught it.


def test_the_unused_half_is_a_credit_not_a_second_charge():
    lines = plan_change_lines(
        old_rate=8000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    kinds = [l["kind"] for l in lines]
    assert kinds == ["credit", "setup"], "was ['setup', 'setup'] — two debits"


def test_a_downgrade_nets_to_what_the_client_gets_back():
    # ₹8,000 → ₹3,000 halfway through August 2026: 13 billable days of 26.
    # Credit ₹4,000 for the plan not used, charge ₹1,500 for the one that is —
    # so Aekam owes ₹2,500, and the old two-debit shape billed ₹5,500 instead.
    lines = plan_change_lines(
        old_rate=8000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    credit, charge = lines
    assert credit["amount"] == Decimal("4000.00")
    assert charge["amount"] == Decimal("1500.00")
    net = charge["amount"] - credit["amount"]
    assert net == Decimal("-2500.00")


def test_an_upgrade_nets_to_the_difference():
    # ₹1,000 → ₹3,000 on the same date: the client pays the difference for the
    # days that are left, ₹1,000, and not ₹2,000 of gross charges.
    lines = plan_change_lines(
        old_rate=1000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    credit, charge = lines
    assert charge["amount"] - credit["amount"] == Decimal("1000.00")


def test_the_credit_amount_is_stored_positive():
    # The magnitude stays positive — `org_billing_lines.amount` is
    # CHECK (amount >= 0) and the KIND carries the sign. A negative here would
    # be refused by the column and by `billing_lines._money`.
    lines = plan_change_lines(
        old_rate=8000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert all(l["amount"] > 0 for l in lines)


def test_the_credit_is_one_off():
    # `org_billing_lines_credit_ck` (migration 222) refuses a monthly credit —
    # that is a discount that runs for ever, not a proration.
    lines = plan_change_lines(
        old_rate=8000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert all(l["cadence"] == "one_off" for l in lines)


def test_the_description_counts_the_days_it_charged_for():
    # It said "unused 16 days" beside a figure worth thirteen — the calendar
    # difference next to a billable-day price.
    lines = plan_change_lines(
        old_rate=8000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert "13 days" in lines[0]["description"]
    assert "13 days" in lines[1]["description"]


def test_plan_change_lines_waived():
    lines = plan_change_lines(
        old_rate=1000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 30),
    )
    assert len(lines) == 0


def test_plan_change_lines_outside_period():
    lines = plan_change_lines(
        old_rate=1000, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 7, 15),
    )
    assert len(lines) == 0


def test_plan_change_from_free():
    lines = plan_change_lines(
        old_rate=0, new_rate=3000,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert len(lines) == 1
    assert "charge" in lines[0]["description"].lower()


def test_plan_change_to_free():
    lines = plan_change_lines(
        old_rate=3000, new_rate=0,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        change_date=date(2026, 8, 16),
    )
    assert len(lines) == 1
    assert "credit" in lines[0]["description"].lower()


def test_module_cotermination_mid_cycle():
    result = module_cotermination(
        module_rate=500,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        activation_date=date(2026, 8, 16),
    )
    assert result is not None
    assert result["kind"] == "setup"
    assert result["cadence"] == "one_off"
    assert float(result["amount"]) > 0


def test_module_cotermination_start_of_cycle():
    result = module_cotermination(
        module_rate=500,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        activation_date=date(2026, 8, 1),
    )
    assert result is None


def test_module_cotermination_waived():
    result = module_cotermination(
        module_rate=500,
        period_start=date(2026, 8, 1), period_end=date(2026, 9, 1),
        activation_date=date(2026, 8, 30),
    )
    assert result is None
