"""Tests for services.billing_cycle — pure helpers and the cron logic."""
from datetime import date
import pytest
from services.billing_cycle import next_anchor, period_end_for


class TestNextAnchor:
    def test_same_day(self):
        assert next_anchor(15, date(2026, 8, 15)) == date(2026, 8, 15)

    def test_future_in_same_month(self):
        assert next_anchor(20, date(2026, 8, 10)) == date(2026, 8, 20)

    def test_past_in_month_rolls_forward(self):
        assert next_anchor(5, date(2026, 8, 10)) == date(2026, 9, 5)

    def test_december_rolls_to_january(self):
        assert next_anchor(10, date(2026, 12, 15)) == date(2027, 1, 10)

    def test_feb_clamp(self):
        assert next_anchor(28, date(2027, 2, 1)) == date(2027, 2, 28)

    def test_anchor_1_on_first(self):
        assert next_anchor(1, date(2026, 9, 1)) == date(2026, 9, 1)

    def test_anchor_1_after_first(self):
        assert next_anchor(1, date(2026, 9, 2)) == date(2026, 10, 1)


class TestPeriodEndFor:
    def test_monthly(self):
        assert period_end_for(date(2026, 8, 15), "monthly") == date(2026, 9, 15)

    def test_monthly_december(self):
        assert period_end_for(date(2026, 12, 1), "monthly") == date(2027, 1, 1)

    def test_monthly_jan31_clamps_to_feb28(self):
        end = period_end_for(date(2026, 1, 31), "monthly")
        assert end == date(2026, 2, 28)

    def test_annual(self):
        assert period_end_for(date(2026, 3, 15), "annual") == date(2027, 3, 15)
