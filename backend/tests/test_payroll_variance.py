"""
`compare_payroll_months` — and the false alarm it was specced to produce.

This handler was verified BUILDABLE at a hand-picked month rather than at its own
default. At the default it would have shipped the worst class of bug this whole
effort exists to prevent: not a crash, not an empty answer, but a confident and
maximally alarming claim that is entirely an artefact of the calendar.

Aekam Inc has exactly one payslip row, for 2026-07. A wall-clock default asks for
2026-08, finds nothing, and the FULL OUTER JOIN reports the org's only employee
as `dropped_out_of_run` — the highest-severity value the `movement` field can
emit — when nothing has happened except that August has not been run yet.

Two changes, and these tests pin both:

  · the default is the LATEST MONTH THAT HAS PAYSLIPS, never today;
  · `dropped_out_of_run` is suppressed when the compared month has no payslips
    at all, because "the run has not been made" and "this person was dropped
    from the run" are different facts the join cannot distinguish.
"""
import pytest

from services.skills.data.payroll_variance import compare_payroll_months

ORG = "045b76ad-654b-42dd-b4b1-731700efc6c3"


class _Pool:
    """A payroll register with a controllable set of months."""

    def __init__(self, months=("2026-07",), current_count=None, rows=None):
        self.months = list(months)
        self._current_count = current_count
        self.rows = rows or []
        self.asked_for = None

    async def fetchval(self, sql, *args):
        if "max(month)" in sql:
            return max(self.months) if self.months else None
        if "count(*)" in sql:
            month = args[1]
            if self._current_count is not None:
                return self._current_count
            return 1 if month in self.months else 0
        raise AssertionError(f"unexpected fetchval: {sql[:60]}")

    async def fetch(self, sql, *args):
        self.asked_for = args[1]
        return self.rows


def _row(**kw):
    base = {
        "employee_name": "Amit Kumar", "prior_month": "2026-06",
        # Reachability. Somebody who dropped OUT of the run is exactly the
        # person who needs ringing, so the contact is COALESCEd across both
        # halves of the outer join rather than taken from the current one.
        "person_id": "88888888-8888-4888-8888-888888888888",
        "employee_email": "amit@example.com",
        "employee_phone": "+91 90000 00088",
        "movement": "compared", "net_now": 2500, "net_prior": 2414.81,
        "net_delta": 85.19, "net_delta_pct": 3.53, "deductions_delta": 0,
        "loan_delta": 0, "overtime_delta": 0, "present_days_delta": 0,
        "unpaid_leave_delta": 0,
    }
    base.update(kw)
    return base


# ── The default ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_default_month_is_the_latest_with_payslips_not_today():
    """
    The fix. Aekam has payslips for 2026-07 only; asking for the wall-clock month
    is what manufactured the false alarm.
    """
    pool = _Pool(months=("2026-06", "2026-07"))

    out = await compare_payroll_months(pool, ORG)

    assert out["month"] == "2026-07"
    assert pool.asked_for == "2026-07"


@pytest.mark.asyncio
async def test_an_explicit_month_is_still_honoured():
    """The default is a default, not a cage — a payroll officer may compare any
    month they like."""
    pool = _Pool(months=("2026-06", "2026-07"))

    out = await compare_payroll_months(pool, ORG, month="2026-06")

    assert out["month"] == "2026-06"
    assert pool.asked_for == "2026-06"


@pytest.mark.asyncio
async def test_an_org_that_has_never_run_payroll_gets_an_honest_empty_answer():
    """Not an error, and emphatically not a finding about anybody's pay."""
    pool = _Pool(months=())

    out = await compare_payroll_months(pool, ORG)

    assert out["month"] is None
    assert out["changes"] == []
    assert "nothing to compare" in out["note"]
    assert "pay" in out["note"]


# ── The suppression ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_nobody_is_reported_dropped_when_the_run_has_not_been_made():
    """
    THE REGRESSION. With no payslips in the compared month every prior employee
    falls out of the join, and calling that "dropped from the run" is a claim
    about payroll derived from a calendar.
    """
    pool = _Pool(
        months=("2026-07",),
        current_count=0,
        rows=[_row(movement="dropped_out_of_run", net_now=None,
                   net_prior=2414.81, net_delta=-2414.81, net_delta_pct=-100.00)],
    )

    out = await compare_payroll_months(pool, ORG, month="2026-08")

    assert out["changes"] == [], "reported a phantom drop from a run that never happened"
    assert "has not happened" in out["note"]


@pytest.mark.asyncio
async def test_a_real_drop_is_still_reported_when_the_run_did_happen():
    """The counterpart, and the reason the suppression is conditional rather
    than a deletion: when the month HAS been run, somebody missing from it is a
    genuine and serious finding."""
    pool = _Pool(
        months=("2026-08",),
        current_count=12,
        rows=[
            _row(employee_name="Neha Gupta", movement="dropped_out_of_run",
                 net_now=None, net_prior=31000, net_delta=-31000),
            _row(employee_name="Amit Kumar"),
        ],
    )

    out = await compare_payroll_months(pool, ORG, month="2026-08")

    movements = {c["employee"]: c["movement"] for c in out["changes"]}
    assert movements["Neha Gupta"] == "dropped_out_of_run"
    assert movements["Amit Kumar"] == "compared"
    assert "note" not in out or "has not happened" not in out.get("note", "")


@pytest.mark.asyncio
async def test_new_joiners_are_never_suppressed():
    """`new_this_month` is not the alarming direction and carries no false-alarm
    risk — an employee present now and absent before is simply new."""
    pool = _Pool(
        months=("2026-08",), current_count=0,
        rows=[_row(movement="new_this_month", net_prior=None, net_delta=2500)],
    )

    out = await compare_payroll_months(pool, ORG, month="2026-08")

    assert [c["movement"] for c in out["changes"]] == ["new_this_month"]


# ── Reporting ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_missing_percentage_is_explained_rather_than_shown_as_zero():
    """
    `net_delta_pct` is NULL wherever the prior net was zero — every QA row at its
    own default. A zero there would read as "no change", which is the opposite of
    what happened.
    """
    pool = _Pool(
        months=("2026-08",), current_count=4,
        rows=[_row(net_prior=0, net_delta_pct=None, net_delta=2500)],
    )

    out = await compare_payroll_months(pool, ORG)

    assert out["changes"][0]["net_delta_pct"] is None
    assert "rupee threshold" in out["note"]


@pytest.mark.asyncio
async def test_both_thresholds_are_reported_so_a_reader_knows_what_was_filtered():
    pool = _Pool(months=("2026-07",), current_count=1, rows=[_row()])

    out = await compare_payroll_months(pool, ORG, threshold_pct=5.0, threshold_amount=500.0)

    assert out["thresholds"] == {"pct": 5.0, "amount": 500.0}


@pytest.mark.asyncio
async def test_money_comes_back_as_float_not_decimal():
    """asyncpg hands back Decimal, which json.dumps cannot serialise — the run
    path writes these straight into a jsonb column."""
    import json
    pool = _Pool(months=("2026-07",), current_count=1, rows=[_row()])

    out = await compare_payroll_months(pool, ORG)

    json.dumps(out)   # raises on Decimal
    assert isinstance(out["changes"][0]["net_now"], float)
