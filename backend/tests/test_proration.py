"""Tests for services/proration.py — pure proration math."""
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
    assert days_in_period(date(2026, 8, 1), date(2026, 9, 1)) == 31
    assert days_in_period(date(2026, 2, 1), date(2026, 3, 1)) == 28
    assert days_in_period(date(2024, 2, 1), date(2024, 3, 1)) == 29


def test_prorate_remaining():
    result = prorate(3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 16), direction="remaining")
    assert result == Decimal("1548.39")


def test_prorate_elapsed():
    result = prorate(3000, date(2026, 8, 1), date(2026, 9, 1), date(2026, 8, 16), direction="elapsed")
    assert result == Decimal("1451.61")


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
