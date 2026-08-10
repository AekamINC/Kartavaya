"""The margin band, and the three shapes Apify writes a price in.

Every fixture here is a REAL payload shape observed on 2026-08-10 against the
nineteen actors in the live catalogue — not an invention. The first version of
this parser read only one of the three spellings and reported "no billable
event" for all nineteen, which looks exactly like a vendor that charges nothing.
That is the failure these tests exist to prevent recurring.
"""

import os

import pytest

os.environ.setdefault("USD_INR", "88")

from services.scraper_pricing import (      # noqa: E402
    MARGIN_MAX,
    MARGIN_MIN,
    achieved_margin_pct,
    credits_for,
    _effective_pricing,
    _tier_price,
    worst_case_cost_usd,
)


# ── The three price spellings ───────────────────────────────────────────────

def test_reads_the_rest_spelling():
    """`eventPriceUsd` — what /v2/acts returns."""
    assert _tier_price({"eventTitle": "result", "eventPriceUsd": 0.01}, "") == 0.01


def test_reads_the_mcp_spelling():
    """`priceUsd` — what the MCP tool returns for the same actor."""
    assert _tier_price({"title": "result", "priceUsd": 0.1}, "") == 0.1


def test_reads_the_keyed_tier_spelling():
    """`eventTieredPricingUsd`, a dict keyed by tier name."""
    ev = {"eventTieredPricingUsd": {
        "FREE": {"tieredEventPriceUsd": 0.0025},
        "GOLD": {"tieredEventPriceUsd": 0.0015},
    }}
    assert _tier_price(ev, "FREE") == 0.0025
    assert _tier_price(ev, "GOLD") == 0.0015


def test_unknown_tier_takes_the_dearest_price():
    """Guessing low means selling below cost, so an unknown tier pays list."""
    ev = {"eventTieredPricingUsd": {
        "FREE": {"tieredEventPriceUsd": 0.10},
        "DIAMOND": {"tieredEventPriceUsd": 0.005},
    }}
    assert _tier_price(ev, "NOT_A_TIER") == 0.10


# ── The minimum charge floor ────────────────────────────────────────────────

def test_floor_is_a_maximum_not_an_addition():
    """An actor that floors at $0.50 charges $0.50 for a small run.

    Google Maps meters 100 places at $0.004 = $0.40, under its own $0.50 floor,
    so a full run costs the floor. Adding the two would overprice by 80%.
    """
    assert worst_case_cost_usd(0.004, 0.00005, 100, min_charge=0.5) == 0.5


def test_large_run_exceeds_the_floor_and_meters():
    got = worst_case_cost_usd(0.10, 0.0, 25, min_charge=0.10)
    assert got == pytest.approx(2.5)


def test_no_floor_is_just_the_metered_cost():
    assert worst_case_cost_usd(0.002, 0.001, 10) == pytest.approx(0.021)


# ── The band the owner asked for ────────────────────────────────────────────

@pytest.mark.parametrize("cost_usd", [0.06, 0.15, 0.26, 0.5, 1.0, 2.5])
def test_realistic_costs_land_inside_the_band(cost_usd):
    """Every scraper between 30% and 50% — the owner's instruction, 2026-08-10."""
    credits = credits_for(cost_usd, 40)
    assert MARGIN_MIN <= achieved_margin_pct(cost_usd, credits) <= MARGIN_MAX


def test_the_band_is_unreachable_on_very_cheap_runs_and_we_go_high_not_low():
    """₹4 of granularity cannot express every price, and the tie-break matters.

    Meta Ad Library costs ₹3.34 a run. One credit is ₹4 — a 16% margin, under
    the floor. Two credits is ₹8 — 58%, over the ceiling. There is no integer
    in between, so the band is unreachable and something has to give.

    It gives UPWARD. Selling at 58% is a customer paying ₹8 for a scrape;
    selling at 16% is us paying to run somebody's lead generation. The daily
    watch reports these rows so the answer stays visible rather than becoming
    folklore — and the real fix, when it is worth building, is charging on
    results returned rather than a flat pre-charge per run.
    """
    cost = 0.038                                  # ≈ ₹3.34
    credits = credits_for(cost, 40)
    assert credits == 2
    assert achieved_margin_pct(cost, credits) > MARGIN_MAX
    assert achieved_margin_pct(cost, credits - 1) < MARGIN_MIN


def test_never_prices_below_cost():
    """The whole point. Charge must exceed cost for every input."""
    for cost in (0.001, 0.01, 0.1, 0.5, 1.05, 2.5, 10.0):
        assert achieved_margin_pct(cost, credits_for(cost, 40)) > 0


def test_rounds_down_when_rounding_up_overshoots():
    """A cheap run must not be overcharged by the ceiling.

    ₹4 of granularity on a ₹5 cost: rounding up to 3 credits (₹12) is a 58%
    margin, outside the band. 2 credits (₹8) is 37% and inside it.
    """
    cost = 5 / 88          # ≈ ₹5
    assert credits_for(cost, 40) == 2


def test_one_credit_floor_is_kept_even_when_it_overshoots():
    """A run costing ₹0.44 cannot be sold for less than one credit.

    X (Twitter) Business Profile really is this cheap. The band cannot be held
    because ₹4 is already nine times the cost, and the honest answer is to
    charge the minimum and let the watch report it as out of band — not to
    invent a fractional credit.
    """
    cost = 0.005
    assert credits_for(cost, 40) == 1
    assert achieved_margin_pct(cost, 1) > MARGIN_MAX


# ── Which pricing record is in force ────────────────────────────────────────

def test_picks_the_live_record_not_the_last_in_the_list():
    data = {"pricingInfos": [
        {"startedAt": "2020-01-01T00:00:00.000Z", "minimalMaxTotalChargeUsd": 0.1},
        {"startedAt": "2099-01-01T00:00:00.000Z", "minimalMaxTotalChargeUsd": 9.9},
    ]}
    assert _effective_pricing(data)["minimalMaxTotalChargeUsd"] == 0.1


def test_prices_ahead_of_an_imminent_rise():
    """A rise inside thirty days is taken NOW.

    Pricing behind a published increase means selling below cost on the morning
    it lands, with nobody watching. A few paise early is the cheaper error.
    """
    from datetime import datetime, timedelta, timezone
    soon = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat().replace("+00:00", "Z")
    data = {"pricingInfos": [
        {"startedAt": "2020-01-01T00:00:00.000Z", "minimalMaxTotalChargeUsd": 0.1},
        {"startedAt": soon, "minimalMaxTotalChargeUsd": 0.5},
    ]}
    assert _effective_pricing(data)["minimalMaxTotalChargeUsd"] == 0.5


def test_ignores_a_distant_future_rise():
    from datetime import datetime, timedelta, timezone
    later = (datetime.now(timezone.utc) + timedelta(days=200)).isoformat().replace("+00:00", "Z")
    data = {"pricingInfos": [
        {"startedAt": "2020-01-01T00:00:00.000Z", "minimalMaxTotalChargeUsd": 0.1},
        {"startedAt": later, "minimalMaxTotalChargeUsd": 9.9},
    ]}
    assert _effective_pricing(data)["minimalMaxTotalChargeUsd"] == 0.1


# ── The prices this actually produces, pinned ───────────────────────────────

@pytest.mark.parametrize("name,unit,floor,max_results,expect_credits", [
    ("Business Email Finder",     0.10,   0.0,  10,  37),
    ("Google Maps Leads",         0.004,  0.5,  100, 19),
    ("LinkedIn Profile Search",   0.10,   0.1,  25,  92),
    ("Instagram Posts",           0.0017, 0.005, 200, 13),
])
def test_observed_actors_price_as_measured(name, unit, floor, max_results, expect_credits):
    """Pinned against the live Apify API on 2026-08-10.

    If one of these moves, the vendor moved — which is the event the daily watch
    exists to catch, and a failing test here is the same news arriving earlier.
    """
    cost = worst_case_cost_usd(unit, 0.00005, max_results, floor)
    assert credits_for(cost, 40) == expect_credits, name
