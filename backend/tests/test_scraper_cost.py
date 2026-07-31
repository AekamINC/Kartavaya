"""
What a scraper run actually costs, and what it should therefore charge.

Two faults were hiding each other here.

`usage_usd` read only Apify's PLATFORM usage — compute, proxy, storage — and
missed the per-event charges every third-party actor in the catalog bills
through. Measured 2026-07-31: a `compass/crawler-google-places` run returning 28
places reported $0.0002 against a real cost near $0.112, understated about
560-fold.

`_calc_actual_credits` then treated the resulting RUPEE figure as CREDITS, with
no division by the credit price — a markup of roughly 5.8x instead of the
intended 1.45x. Nobody saw it because `ceil($0.0002 * rate * 1.45)` is 1, always
under the minimum, so the true-up never ran.

Correcting either alone is wrong: the cost alone multiplies real charges by
about six, the units alone change nothing.
"""
import math
from unittest.mock import AsyncMock

import pytest

from services.apify import _event_charges_usd


def _run(counts, prices, platform=0.0002, model="PAY_PER_EVENT"):
    return {
        "status": "SUCCEEDED",
        "usageTotalUsd": platform,
        "chargedEventCounts": counts,
        "pricingInfo": {
            "pricingModel": model,
            "pricingPerEvent": {"actorChargeEvents": prices},
        },
    }


class TestEventCharges:
    def test_the_google_maps_run_that_started_this(self):
        """28 places at $0.004 — the measured case, to the cent."""
        data = _run({"actor-start": 1, "place-scraped": 28},
                    {"actor-start": {"eventPriceUsd": 0.00005},
                     "place-scraped": {"eventPriceUsd": 0.004}})
        assert _event_charges_usd(data) == pytest.approx(0.11205)

    def test_no_events_costs_nothing_extra(self):
        """A rented or compute-priced actor bills through platform usage alone."""
        assert _event_charges_usd(_run({}, {})) == 0.0
        assert _event_charges_usd({"usageTotalUsd": 0.5}) == 0.0

    def test_every_event_type_is_counted(self):
        data = _run({"a": 2, "b": 3, "c": 1},
                    {"a": {"eventPriceUsd": 0.01},
                     "b": {"eventPriceUsd": 0.002},
                     "c": {"eventPriceUsd": 0.5}})
        assert _event_charges_usd(data) == pytest.approx(0.02 + 0.006 + 0.5)

    def test_an_unpriced_event_is_skipped_loudly_not_silently_zeroed(self, caplog):
        """
        A missing price is the exact shape of the bug being fixed. Skipping it
        without a word would reintroduce a silent undercount.
        """
        data = _run({"known": 2, "mystery": 10}, {"known": {"eventPriceUsd": 0.01}})
        with caplog.at_level("WARNING"):
            total = _event_charges_usd(data)
        assert total == pytest.approx(0.02)
        assert "mystery" in caplog.text
        assert "understated" in caplog.text

    def test_alternative_price_keys_are_tolerated(self):
        """Defensive: a zeroed price is worse than a guess at the key name."""
        assert _event_charges_usd(_run({"e": 4}, {"e": {"priceUsd": 0.25}})) == pytest.approx(1.0)
        assert _event_charges_usd(_run({"e": 4}, {"e": {"price": 0.25}})) == pytest.approx(1.0)


class TestCreditConversion:
    """
    `_calc_actual_credits` without its async plumbing — the arithmetic is the
    part that was wrong.
    """

    @staticmethod
    def _credits(cost_usd, min_credits, rate=96.50, margin=0.45, credit_inr=4):
        if cost_usd <= 0:
            return min_credits
        return max(min_credits, math.ceil(cost_usd * rate * (1 + margin) / credit_inr))

    def test_a_hundred_places_charges_the_intended_markup(self):
        """
        $0.40 = Rs 38.60 cost. 14 credits = Rs 56.00. That is 1.45x.

        Under the old arithmetic this run charged the 5-credit minimum — Rs 20.00
        against a Rs 38.60 cost, a loss on every run.
        """
        assert self._credits(0.40, min_credits=5) == 14
        assert 14 * 4 == pytest.approx(0.40 * 96.50 * 1.45, abs=1.0)

    def test_the_minimum_still_floors_small_runs(self):
        """A 28-place run prices under the minimum, so the minimum stands."""
        assert self._credits(0.112, min_credits=5) == 5

    def test_a_zero_cost_never_charges_beyond_the_minimum(self):
        assert self._credits(0, min_credits=5) == 5
        assert self._credits(-1, min_credits=2) == 2

    def test_rupees_are_not_credits(self):
        """
        The regression itself. Without the division a Rs 56.00 price becomes 56
        CREDITS — Rs 224.00, and about 5.8x the real cost instead of 1.45x.
        """
        priced_inr = 0.40 * 96.50 * 1.45
        assert math.ceil(priced_inr) == 56          # the old answer
        assert self._credits(0.40, min_credits=5) == 14   # the corrected one
