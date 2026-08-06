"""The deal a buyer would have seen labelled healthy after 203 days of silence.

`/cron/crm` was first run on 2026-08-06 and scored 510 of Aekam's 512 open deals
`at_risk`, which looked like the bug. It was not — measured against the live
database, those 512 deals have no activity rows at all and 510 are past their
close date. The arithmetic was reproduced in SQL and matched exactly.

The bug was the opposite. In the Unicode Group demo organisation — the one shown
to buyers — all 15 open deals were labelled `good`, and **10 of them were stale**,
the worst untouched for 203 days. In the E2E organisation, 33 of 50.

Two causes, one test each below, plus the guard that would have caught either.
Every number quoted here was measured on 2026-08-06 against project
`toacecaewujfxjfrjwco`.
"""
import pytest
from datetime import datetime, timedelta, timezone

from services.skills.detect import score_deals
from services.skills.detect import deal_health_scorer as dhs


class FakePool:
    """Enough pool to run the scorer. It asserts nothing about the SQL.

    A fake pool cannot catch a wrong column name — that is what
    test_cron_column_names.py is for. This file tests the arithmetic, which a
    fake pool tests perfectly well because the arithmetic never touches the
    database.
    """

    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, sql, *args):
        return self._rows


def _deal(**over):
    now = datetime.now(timezone.utc)
    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "title": "Annual maintenance contract",
        "value": 250000,
        "stage": "Proposal",
        "updated_at": now,
        "created_at": now,
        "expected_close_date": (now + timedelta(days=60)).date(),
        "probability": 60,
        "last_activity": now,
    }
    row.update(over)
    return row


async def _score_one(**over):
    out = await score_deals(FakePool([_deal(**over)]), "org")
    return out[0]


# ═══════════════════════════════════════════════════════════════════════════
# 1. A stale deal was labelled "good", because 100 − 30 landed on the boundary
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("days_quiet", [15, 30, 60, 141, 203])
async def test_a_stale_deal_is_never_called_good(days_quiet):
    """The exact live case: 203 days of silence, everything else clean, "good".

    Staleness was a flat −30 and `good` was `score >= 70`, so 100 − 30 = 70 was
    the healthiest label in the model — awarded to the single strongest warning
    sign the model has, and awarded identically at 15 days and at 203.
    """
    now = datetime.now(timezone.utc)
    d = await _score_one(last_activity=now - timedelta(days=days_quiet))

    assert d["health"] != "good", (
        f"a deal nobody has touched in {days_quiet} days scored {d['score']} and "
        f"was labelled 'good'. This is what the Unicode Group demo showed a buyer "
        f"for 10 of its 15 open deals."
    )
    assert any(f.startswith("no_activity_") for f in d["risk_factors"])


async def test_silence_costs_more_the_longer_it_lasts():
    """15 days quiet and 203 days quiet must not produce the same score."""
    now = datetime.now(timezone.utc)
    just_over = await _score_one(last_activity=now - timedelta(days=15))
    long_gone = await _score_one(last_activity=now - timedelta(days=203))

    assert long_gone["score"] < just_over["score"], (
        "a flat staleness penalty makes a seven-month silence indistinguishable "
        "from a two-week one"
    )
    assert long_gone["health"] == "critical", (
        f"203 days of silence scored {long_gone['score']}, which is not critical"
    )


async def test_a_genuinely_healthy_deal_is_still_good():
    """The guard against over-correcting: tightening the band must not flag everyone.

    A scorer that calls everything at_risk is exactly as useless as one that calls
    everything good, and it is the failure mode a fix like this invites.
    """
    d = await _score_one()
    assert d["health"] == "good", d
    assert d["risk_factors"] == []


# ═══════════════════════════════════════════════════════════════════════════
# 2. "Never contacted" was reported as "contacted a long time ago"
# ═══════════════════════════════════════════════════════════════════════════

async def test_a_deal_with_no_activity_says_never_contacted():
    """528 of 617 open deals have no activity row at all — the common case.

    `last_activity` falls back to `updated_at`, a machine timestamp, so a deal
    nobody had ever logged anything against reported `no_activity_203d`: "we
    spoke 203 days ago" about a conversation that never happened.
    """
    now = datetime.now(timezone.utc)
    d = await _score_one(
        last_activity=None,
        created_at=now - timedelta(days=203),
        updated_at=now,          # a background job touched the row today
    )

    assert any(f.startswith("never_contacted_") for f in d["risk_factors"]), (
        f"no activity has ever been logged, but the factors say {d['risk_factors']}"
    )
    assert not any(f.startswith("no_activity_0d") for f in d["risk_factors"]), (
        "measuring silence from updated_at makes an untouched deal look fresh "
        "the moment any background job writes to the row"
    )
    assert d["health"] != "good"


async def test_never_contacted_measures_from_creation_not_the_row_timestamp():
    """The clock matters, not just the label.

    Aekam's 512 deals were created in July and rewritten by a bulk process since.
    Measuring from updated_at answers "when did a process last write this row",
    which is not a question anybody in sales is asking.
    """
    now = datetime.now(timezone.utc)
    d = await _score_one(
        last_activity=None,
        created_at=now - timedelta(days=100),
        updated_at=now - timedelta(days=2),
    )
    factor = next(f for f in d["risk_factors"] if f.startswith("never_contacted_"))
    assert factor == "never_contacted_100d", (
        f"expected the age since creation, got {factor}"
    )


# ═══════════════════════════════════════════════════════════════════════════
# 3. The guard that would have caught either one
# ═══════════════════════════════════════════════════════════════════════════

async def test_the_score_is_a_score_and_not_a_constant():
    """A label awarded to 99.6% of rows is a constant wearing a score's clothing.

    This is the check that was missing. It does not assert any particular
    distribution is correct — it asserts that a spread of genuinely different
    deals does not collapse onto one label. Both of the bugs above collapsed it:
    one pushed everything to `good`, the other looked like it pushed everything
    to `at_risk`.
    """
    now = datetime.now(timezone.utc)
    spread = [
        _deal(id="1"),                                                   # clean
        _deal(id="2", probability=5),                                    # low prob
        _deal(id="3", last_activity=now - timedelta(days=20)),           # quiet
        _deal(id="4", last_activity=now - timedelta(days=200)),          # long gone
        _deal(id="5", expected_close_date=(now - timedelta(days=45)).date()),
        _deal(id="6", last_activity=None, created_at=now - timedelta(days=90)),
        _deal(id="7", stage="New", updated_at=now - timedelta(days=90),
              last_activity=now - timedelta(days=90), probability=10,
              expected_close_date=(now - timedelta(days=60)).date()),    # hopeless
    ]
    out = await score_deals(FakePool(spread), "org")
    labels = {d["health"] for d in out}

    assert len(labels) == 3, (
        f"seven deliberately different deals produced only {sorted(labels)}. "
        f"scores were {[d['score'] for d in out]}"
    )


def test_the_good_band_is_strict():
    """Pin the constant itself, because relaxing it silently restores the bug.

    100 − STALE_BASE lands exactly on GOOD_FLOOR. If a future edit changes the
    comparison back to >=, every deal that has just crossed the staleness line
    becomes 'good' again and nothing else in this file would notice.
    """
    assert 100 - dhs.STALE_BASE == dhs.GOOD_FLOOR, (
        "the boundary case this guard exists for has moved; re-derive it rather "
        "than editing this number"
    )
    import inspect
    src = inspect.getsource(dhs.score_deals)
    assert "score > GOOD_FLOOR" in src, (
        "`good` must be STRICTLY above the floor — `>=` is the original bug"
    )
