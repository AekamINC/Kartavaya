"""Publishing attendance to payroll had never once worked.

`POST /pahchan/attendance/publish` is the handoff that turns punches into the
`manav_attendance` rows Vetana prices a payslip from. It 500'd on every call,
for every org, since it was written:

    asyncpg.exceptions.DataError: invalid input for query argument $2:
    '2026-07-20' ('str' object has no attribute 'toordinal')

`$2::date` makes asyncpg infer a DATE parameter, so it wants a `datetime.date`
and refuses a `str`. `PublishBody` declares both dates as `str` and passed them
straight through. Confirmed unconditional: a window in 2020 containing zero
punches failed identically, so it was never about the data.

Third instance of this exact family in one programme — after the bank statement
import (`batch_id` uuid fed a string, 2b864aa8) and the sales target
(`salesperson_id` uuid fed a user id, eae0b912). All three presented as an
opaque "Internal server error" with nothing on screen.

The second fix here is not the crash. A window that runs BACKWARDS used to pair
nothing and answer "no attendance", which on a payroll input is worse than an
error: it is indistinguishable from a fortnight nobody worked.
"""
import inspect
import re
from datetime import date

import pytest

import routers.pahchan_attendance as pa


def _src() -> str:
    return inspect.getsource(pa.publish_attendance_to_payroll)


def test_the_dates_are_parsed_before_they_reach_sql():
    """The regression. A str against `$2::date` is the whole bug."""
    src = _src()
    assert "date.fromisoformat(body.from_date)" in src
    assert "date.fromisoformat(body.to_date)" in src
    assert "org_id, body.from_date, body.to_date" not in src, \
        "the raw strings are being passed to asyncpg again — this will 500"
    assert src.count("org_id, from_date, to_date") == 2, \
        "both the punch query and the regularisation query need the parsed dates"


def test_a_bad_date_is_a_400_that_quotes_it():
    """A date typed into a payroll window is ordinary human input, and
    `date.fromisoformat` raising out of the handler is another opaque 500."""
    src = _src()
    assert "except ValueError" in src
    assert "YYYY-MM-DD" in src


def test_a_backwards_window_is_refused():
    src = _src()
    assert "to_date < from_date" in src
    assert "Swap the dates" in src


@pytest.mark.asyncio
async def test_a_malformed_date_never_reaches_the_database(monkeypatch):
    async def _boom():
        raise AssertionError("the pool was opened before the dates were validated")

    monkeypatch.setattr(pa, "get_pool", _boom)

    with pytest.raises(pa.HTTPException) as e:
        await pa.publish_attendance_to_payroll(
            pa.PublishBody(from_date="20-07-2026", to_date="2026-08-02", dry_run=True),
            request=None, user={"user_id": "u1"}, org_id="org1",
        )
    assert e.value.status_code == 400
    assert "20-07-2026" in e.value.detail


@pytest.mark.asyncio
async def test_a_backwards_window_never_reaches_the_database(monkeypatch):
    """The dangerous one: it used to answer "nothing to pay" for a typo."""
    async def _boom():
        raise AssertionError("the pool was opened for a backwards window")

    monkeypatch.setattr(pa, "get_pool", _boom)

    with pytest.raises(pa.HTTPException) as e:
        await pa.publish_attendance_to_payroll(
            pa.PublishBody(from_date="2026-07-31", to_date="2026-07-01", dry_run=True),
            request=None, user={"user_id": "u1"}, org_id="org1",
        )
    assert e.value.status_code == 400
    assert "ends before it starts" in e.value.detail


@pytest.mark.asyncio
async def test_a_valid_window_reaches_sql_as_real_dates(monkeypatch):
    captured = []

    class _Pool:
        async def fetch(self, q, *a):
            captured.append(a)
            return []

        async def fetchrow(self, *a, **k):
            return None

    async def _get_pool():
        return _Pool()

    monkeypatch.setattr(pa, "get_pool", _get_pool)

    out = await pa.publish_attendance_to_payroll(
        pa.PublishBody(from_date="2026-07-20", to_date="2026-08-02", dry_run=True),
        request=None, user={"user_id": "u1"}, org_id="org1",
    )

    assert out["dry_run"] is True
    assert out["rows_written"] == 0, "a dry run must write nothing"
    for args in captured:
        assert isinstance(args[1], date), f"{args[1]!r} reached asyncpg as {type(args[1])}"
        assert isinstance(args[2], date)
