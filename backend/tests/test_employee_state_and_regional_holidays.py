"""Where somebody works, and the holiday that only closes their state.

The hole this closes
--------------------
Two columns, one join, and neither end of it could be filled in.

  · `staging.manav_employees` had NO state column at all, and
    `services/skills/data/payroll_statutory.py:786` printed that as a permanent
    limitation on every professional-tax brief: "Nothing records which state
    each employee works in, so the amounts below are what the payroll run
    deducted and are not re-derived from any slab."
  · `staging.manav_holidays.state_code` HAS existed since migration 175, but
    `list_holidays` never selected it and `HolidayCreate` never accepted it, so
    a value written there was invisible to the only screen that shows holidays.

Measured read-only against the shared database 2026-08-25:

    38 holidays · 0 with a state_code
    98 employees · 0 with a state (the column does not exist yet)
    staging.pay_professional_tax · state_code '24' Gujarat, '27' Maharashtra,
                                   '29' Karnataka — NUMERIC

WHICH CONVENTION, AND WHY IT IS PINNED HERE
-------------------------------------------
The database holds two spellings of a state and migration 180's header says the
choice between them was deferred. This module chooses NUMERIC ('27'), and the
choice is not cosmetic: the professional-tax slabs are keyed numerically, so an
alphabetic employee state joins to nothing and computes zero PT for everybody,
silently. `test_the_stored_convention_matches_the_professional_tax_slabs` is
that decision written down as a failing test rather than as a comment.

Why the tests are shaped like this
----------------------------------
`routers/messaging.py:30-41` records what a mocked pool is worth: a fake cursor
resolves any table name handed to it, so an HTTP test proves the handler asked,
never that the database could answer. So the rules worth proving live in pure
functions and are tested directly; the HTTP tests assert only what HTTP can —
which SQL was issued and what was bound to it. The auto-mark tests use a fake
pool that ROUTES ON THE SQL, so the decision under test (who gets a row) is
observed rather than assumed.
"""
import re
from datetime import date

import pytest

from routers.manav import _EMP_SAFE_COLS, _clean_state, _state_name
from services.skills.action import attendance_auto_mark as auto
from services.skills.action.attendance_auto_mark import (
    _holiday_applies_to,
    mark_holidays_weekends,
)

TEST_ORG = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def forget_the_state_column_probe():
    """`_HAS_EMPLOYEE_STATE` is a module-level cache that outlives a test.

    It is deliberately one-way in production — a column is never dropped under a
    running process — but a test that proves the pre-migration fallback must not
    inherit a True set by the test above it. Cleared both sides, because the
    order tests run in is not this file's business.
    """
    auto._HAS_EMPLOYEE_STATE = False
    yield
    auto._HAS_EMPLOYEE_STATE = False


# ══════════════════════════════════════════════════════════════════════════════
# The convention
# ══════════════════════════════════════════════════════════════════════════════


class TestTheStoredForm:
    @pytest.mark.parametrize("given", ["27", 27, " 27 ", "MH", "mh", "Maharashtra"])
    def test_every_spelling_of_one_state_stores_the_same_two_characters(self, given):
        """A state typed three ways is one state. Storing three strings is how a
        join silently returns nothing."""
        assert _clean_state(given) == "27"

    @pytest.mark.parametrize("blank", ["", "   ", None])
    def test_blank_is_null_rather_than_a_state(self, blank):
        assert _clean_state(blank) is None

    def test_an_unknown_state_is_dropped_rather_than_refused(self):
        """NEVER a 4xx. GSTIN, PAN and TAN block nothing in this product and a
        work state is weaker than any of them — a hire must not fail because
        somebody sent a state this codelist has not heard of."""
        assert _clean_state("Atlantis") is None
        assert _clean_state("ZZ") is None

    def test_the_stored_convention_matches_the_professional_tax_slabs(self):
        """THE decision this feature turns on, pinned.

        `staging.pay_professional_tax.state_code` holds '24', '27' and '29' —
        measured read-only 2026-08-25. A parallel piece of work computes PT by
        joining an employee's state against that column. If this normaliser ever
        starts returning 'MH' the join matches nothing and every employee in the
        product is quietly assessed zero professional tax, with no error.
        """
        for numeric, alpha in (("24", "GJ"), ("27", "MH"), ("29", "KA")):
            assert _clean_state(alpha) == numeric
            assert _clean_state(numeric) == numeric
            assert _clean_state(numeric).isdigit()

    def test_a_stored_code_still_has_a_name_to_show_a_person(self):
        """`check-rendered-ids.mjs` is about ids, but the principle is wider: a
        calendar that says "27" is a calendar nobody can read."""
        assert _state_name("27") == "Maharashtra"
        assert _state_name(None) is None
        assert _state_name("zz") is None

    @pytest.mark.parametrize("alpha", ["MH", "GJ", "KA", "DL", "TG"])
    def test_what_we_write_satisfies_the_live_check_constraints(self, alpha):
        """`manav_holidays_state_ck` — read live from pg_constraint 2026-08-25 —
        is `state_code IS NULL OR ~ '^[A-Z]{2,3}$' OR ~ '^[0-9]{1,2}$'`, and
        migration 220 gives `manav_employees.state` the same pair. A value this
        product writes that the column would refuse is an insert that 500s.
        """
        stored = _clean_state(alpha)
        assert re.fullmatch(r"[0-9]{1,2}", stored), stored
        # And the alphabetic form stays legal, because an importer may send it.
        assert re.fullmatch(r"[A-Z]{2,3}", alpha)


def test_the_employee_column_list_carries_state():
    """`SELECT *` is BANNED on manav_employees — the table is an identity kit —
    so a column missing from `_EMP_SAFE_COLS` is a column the detail endpoint
    can never read back, however well the write path works."""
    assert re.search(r"\bstate\b", _EMP_SAFE_COLS), _EMP_SAFE_COLS


# ══════════════════════════════════════════════════════════════════════════════
# The write paths — only what HTTP can prove
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set. Editing a personnel file or the calendar needs `admin`; the
    permission rules themselves are `test_manav.py`'s subject, not this file's."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


#: One canned row answers every `fetchrow` the create handler makes, so it has to
#: satisfy the INSERT's RETURNING clause AND the attendance-seat read that runs
#: just before it. `seat_limit: None` is the uncapped state every live
#: organisation is in, so the hire is admitted and these tests stay about state.
CREATED_EMPLOYEE = {
    "id": "e0000000-0000-0000-0000-000000000001",
    "name": "Priya", "employee_code": "EMP001",
    "seat_limit": None, "roster": 0, "exempt": 0, "module_active": True,
}


class TestTheEmployeeWritePath:
    async def test_a_state_reaches_the_insert_normalised(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = CREATED_EMPLOYEE
        r = await api_client.post("/api/v1/manav/employees", json={
            "name": "Priya", "state": "Maharashtra",
        })
        assert r.status_code == 200, r.text
        sql, *params = mock_pool.fetchrow.call_args[0]
        assert "state" in sql, "the INSERT no longer names the state column"
        assert "27" in params, (
            "'Maharashtra' must reach the row as '27' — the form sends a code "
            f"and the API accepts a name, and both store one value. bound: {params}"
        )

    async def test_no_state_binds_null_rather_than_an_empty_string(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """'' would satisfy the CHECK by accident and then read as a state that
        matches nobody. NULL is the column's own word for "nobody has said"."""
        mock_pool.fetchrow.return_value = CREATED_EMPLOYEE
        r = await api_client.post("/api/v1/manav/employees", json={"name": "Priya"})
        assert r.status_code == 200, r.text
        params = mock_pool.fetchrow.call_args[0][1:]
        assert params[-1] is None, f"state was bound as {params[-1]!r}, not NULL"

    async def test_an_unknown_state_does_not_refuse_the_hire(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The product rule, applied: an optional identifier blocks NOTHING.
        The record is created and the state is simply not recorded."""
        mock_pool.fetchrow.return_value = CREATED_EMPLOYEE
        r = await api_client.post("/api/v1/manav/employees", json={
            "name": "Priya", "state": "Atlantis",
        })
        assert r.status_code == 200, r.text
        assert mock_pool.fetchrow.call_args[0][-1] is None

    async def test_an_edit_writes_the_state_normalised(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The EDIT form is a separate shape from the create form, and a field
        wired into one and not the other saves on create and is silently dropped
        on every edit afterwards."""
        r = await api_client.patch(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
            json={"state": "KA"},
        )
        assert r.status_code == 200, r.text
        sql, *params = mock_pool.execute.call_args[0]
        assert "state=$" in sql, sql
        assert "29" in params, params

    async def test_an_empty_state_clears_it(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """Somebody moves office. `null` is dropped by the handler's own
        `if v is not None` filter, so "" has to be the way to unset it — the
        same convention `bank_details` already uses for clearing a key."""
        r = await api_client.patch(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
            json={"state": ""},
        )
        assert r.status_code == 200, r.text
        sql, *params = mock_pool.execute.call_args[0]
        assert "state=$" in sql, sql
        assert None in params, params

    async def test_an_edit_that_says_nothing_about_the_state_leaves_it_alone(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """`exclude_unset`. A PATCH of the designation must not blank a state
        the payroll run is about to read."""
        r = await api_client.patch(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
            json={"designation": "Senior Developer"},
        )
        assert r.status_code == 200, r.text
        assert "state" not in mock_pool.execute.call_args[0][0]

    async def test_the_directory_reads_the_state_back(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """A column the list cannot show is a column nobody can see is empty —
        the same reason `user_id` was added to this query."""
        mock_pool.fetch.return_value = []
        r = await api_client.get("/api/v1/manav/employees")
        assert r.status_code == 200
        assert "state" in mock_pool.fetch.call_args[0][0]


class TestTheHolidayWritePath:
    async def test_a_state_holiday_is_stored_normalised(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = {
            "id": "h002", "name": "Gudi Padwa", "date": "2026-03-19", "state_code": "27",
        }
        r = await api_client.post("/api/v1/manav/holidays", json={
            "name": "Gudi Padwa", "date": "2026-03-19", "state_code": "MH",
        })
        assert r.status_code == 200, r.text
        sql, *params = mock_pool.fetchrow.call_args[0]
        assert "state_code" in sql, "the INSERT no longer names state_code"
        assert params[-1] == "27", params

    async def test_a_holiday_with_no_state_is_null_meaning_everywhere(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """Migration 175's own column comment: NULL means the holiday applies
        everywhere, and that is the correct reading of the 38 rows that predate
        the column. The form's default must land on that value, not on ''."""
        mock_pool.fetchrow.return_value = {
            "id": "h003", "name": "Republic Day", "date": "2026-01-26", "state_code": None,
        }
        r = await api_client.post("/api/v1/manav/holidays", json={
            "name": "Republic Day", "date": "2026-01-26",
        })
        assert r.status_code == 200, r.text
        assert mock_pool.fetchrow.call_args[0][-1] is None

    async def test_an_unknown_state_does_not_refuse_the_holiday(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """A holiday that fails to save is a working day nobody was told about."""
        mock_pool.fetchrow.return_value = {
            "id": "h004", "name": "Onam", "date": "2026-08-26", "state_code": None,
        }
        r = await api_client.post("/api/v1/manav/holidays", json={
            "name": "Onam", "date": "2026-08-26", "state_code": "Narnia",
        })
        assert r.status_code == 200, r.text
        assert mock_pool.fetchrow.call_args[0][-1] is None

    async def test_the_calendar_selects_the_state_back_and_names_it(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The column has existed since migration 175 and this SELECT did not
        list it, so a written value was invisible on the only screen that shows
        holidays — the write path and the read path each looked correct alone."""
        mock_pool.fetch.return_value = [
            {"id": "h001", "name": "Gudi Padwa", "date": "2026-03-19",
             "is_optional": False, "state_code": "27"},
        ]
        r = await api_client.get("/api/v1/manav/holidays")
        assert r.status_code == 200
        assert "state_code" in mock_pool.fetch.call_args[0][0]
        row = r.json()["data"][0]
        assert row["state_code"] == "27"
        assert row["state_name"] == "Maharashtra", "the calendar would render a bare code"

    async def test_a_legacy_alphabetic_row_still_resolves_to_a_name(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """`manav_holidays_state_ck` accepts 'MH' as well as '27', so a row an
        importer wrote may carry either. The reader normalises; only the writer
        picks a side."""
        mock_pool.fetch.return_value = [
            {"id": "h001", "name": "Gudi Padwa", "date": "2026-03-19",
             "is_optional": False, "state_code": "MH"},
        ]
        r = await api_client.get("/api/v1/manav/holidays")
        assert r.json()["data"][0]["state_name"] == "Maharashtra"


# ══════════════════════════════════════════════════════════════════════════════
# The decider — who actually gets marked
#
# The acceptance criterion for Phase 1.6 is "a state holiday only counts against
# employees in that state", and NOTHING in the write paths above makes that
# true. This is the code that does.
# ══════════════════════════════════════════════════════════════════════════════


class FakePool:
    """A pool that ROUTES ON THE SQL, because that is the decision under test.

    A MagicMock would answer the holiday query, the employee query and the
    catalogue probe with the same canned value, which is how a mocked pool
    "proves" a filter that is not there. Every INSERT is recorded so the test can
    assert who was marked and as WHAT, rather than counting.
    """

    def __init__(self, holidays, employees, *, has_state_column=True, already=()):
        self._holidays = holidays
        self._employees = employees
        self._has_state = has_state_column
        self._already = set(already)
        self.inserted = {}
        self.selected_employee_sql = []

    async def fetchval(self, sql, *args):
        if "information_schema.columns" in sql:
            return self._has_state
        raise AssertionError(f"unexpected fetchval: {sql}")

    async def fetch(self, sql, *args):
        if "manav_holidays" in sql:
            return self._holidays
        if "manav_employees" in sql:
            self.selected_employee_sql.append(sql)
            if "state" in sql.split("FROM")[0]:
                return self._employees
            # The pre-migration query does not select the column at all, so the
            # rows it hands back cannot carry it. Modelled honestly: a fake that
            # returned `state` anyway would let a missing guard pass.
            return [{"id": e["id"]} for e in self._employees]
        raise AssertionError(f"unexpected fetch: {sql}")

    async def fetchrow(self, sql, *args):
        if "manav_attendance" in sql:
            return {"?column?": 1} if args[0] in self._already else None
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def execute(self, sql, *args):
        assert "manav_attendance" in sql, sql
        # (id, org_id, employee_id, date, status)
        self.inserted[args[2]] = args[4]
        return "INSERT 0 1"


MON = date(2026, 3, 19)      # a Thursday — an ordinary working day
SAT = date(2026, 3, 21)      # a Saturday

MH_HOLIDAY = {"id": "h1", "name": "Gudi Padwa", "state_code": "27"}
NATIONAL = {"id": "h2", "name": "Republic Day", "state_code": None}

IN_MH = {"id": "emp-mh", "state": "27"}
IN_KA = {"id": "emp-ka", "state": "29"}
NO_STATE = {"id": "emp-none", "state": None}


class TestWhoAStateHolidayCloses:
    def test_the_rule_itself(self):
        """Stated as a table, because the two NULLs mean different things and
        both of them mean yes."""
        assert _holiday_applies_to(None, "27") is True      # national → everyone
        assert _holiday_applies_to(None, None) is True
        assert _holiday_applies_to("27", "27") is True      # same state
        assert _holiday_applies_to("27", None) is True      # nobody has said
        assert _holiday_applies_to("27", "29") is False     # the only False
        assert _holiday_applies_to("MH", "27") is True      # two conventions

    async def test_a_state_holiday_does_not_mark_an_employee_elsewhere(self):
        """THE acceptance criterion for 1.6. Marking a Karnataka employee
        'holiday' for a Maharashtra holiday asserts they did not work — the same
        unknowable claim this module refuses to make about an ordinary absence.
        """
        pool = FakePool([MH_HOLIDAY], [IN_MH, IN_KA, NO_STATE])
        out = await mark_holidays_weekends(pool, TEST_ORG, MON)

        assert pool.inserted == {"emp-mh": "holiday", "emp-none": "holiday"}
        assert "emp-ka" not in pool.inserted, (
            "the Karnataka employee was marked for a Maharashtra holiday"
        )
        assert out["marked"] == 2

    async def test_an_employee_with_no_state_is_still_marked(self):
        """Nobody has said where they work — 98 of 98 rows are in that state the
        day the column ships. Reading silence as "not in Maharashtra" would stop
        marking Maharashtra's holidays for an entire workforce the moment one
        regional holiday was entered."""
        pool = FakePool([MH_HOLIDAY], [NO_STATE])
        await mark_holidays_weekends(pool, TEST_ORG, MON)
        assert pool.inserted == {"emp-none": "holiday"}

    async def test_a_holiday_with_no_state_still_marks_everyone(self):
        pool = FakePool([NATIONAL], [IN_MH, IN_KA, NO_STATE])
        await mark_holidays_weekends(pool, TEST_ORG, MON)
        assert set(pool.inserted) == {"emp-mh", "emp-ka", "emp-none"}
        assert set(pool.inserted.values()) == {"holiday"}

    async def test_a_national_holiday_beside_a_state_one_covers_everybody(self):
        """`fetchrow` took ONE row. Two holidays can fall on one date, and
        letting an arbitrary one of them decide the day would either overstate a
        regional closure or drop a national one."""
        pool = FakePool([MH_HOLIDAY, NATIONAL], [IN_MH, IN_KA])
        await mark_holidays_weekends(pool, TEST_ORG, MON)
        assert set(pool.inserted) == {"emp-mh", "emp-ka"}

    async def test_somebody_the_state_holiday_misses_still_gets_the_weekend(self):
        """A Saturday is a Saturday in Karnataka too. Deciding the status once
        for the whole org would have made the regional holiday overwrite it."""
        pool = FakePool([MH_HOLIDAY], [IN_MH, IN_KA], has_state_column=True)
        await mark_holidays_weekends(pool, TEST_ORG, SAT)
        assert pool.inserted == {"emp-mh": "holiday", "emp-ka": "weekend"}

    async def test_an_existing_attendance_row_is_never_overwritten(self):
        """Somebody who clocked in on a holiday worked on it. The old code
        checked this and the new per-employee loop must still."""
        pool = FakePool([NATIONAL], [IN_MH, IN_KA], already={"emp-mh"})
        out = await mark_holidays_weekends(pool, TEST_ORG, MON)
        assert pool.inserted == {"emp-ka": "holiday"}
        assert out["marked"] == 1

    async def test_an_ordinary_working_day_writes_nothing(self):
        pool = FakePool([], [IN_MH, IN_KA])
        assert await mark_holidays_weekends(pool, TEST_ORG, MON) == {"marked": 0}
        assert pool.inserted == {}


class TestTheGuardThatKeepsThisDeployableBeforeMigration220:
    async def test_without_the_column_it_behaves_exactly_as_it_did(self):
        """Migration 220 is written and NOT applied, and migrations here are run
        by hand against a database production also writes to — so "deployed, but
        the column is not there" is a real window. Selecting `state` in it raises
        UndefinedColumnError and answers 500 for every organisation, which is how
        /cron/hr spent months broken over `manav_holidays.is_active`.
        """
        pool = FakePool([MH_HOLIDAY], [IN_MH, IN_KA, NO_STATE], has_state_column=False)
        await mark_holidays_weekends(pool, TEST_ORG, MON)

        assert set(pool.inserted) == {"emp-mh", "emp-ka", "emp-none"}, (
            "before the column exists this must mark everybody, exactly as the "
            "org-wide version always did"
        )
        for sql in pool.selected_employee_sql:
            assert "SELECT id FROM" in sql, (
                "the pre-migration path selected a column the database does not "
                f"have: {sql}"
            )

    async def test_a_date_with_no_regional_holiday_never_asks_the_catalogue(self):
        """The probe costs a query, and a national holiday needs no state at all.
        A pool that refuses the question proves it is not asked."""
        class NoProbe(FakePool):
            async def fetchval(self, sql, *args):
                raise AssertionError("the catalogue was probed for nothing")

        pool = NoProbe([NATIONAL], [IN_MH, IN_KA])
        await mark_holidays_weekends(pool, TEST_ORG, MON)
        assert set(pool.inserted) == {"emp-mh", "emp-ka"}

    async def test_the_probe_result_is_cached_once_it_is_true(self):
        """One catalogue read per process, not one per organisation per night.
        Only True is cached — a False would go stale the moment the migration
        landed and would keep the old behaviour for the life of the worker."""
        calls = []

        class Counting(FakePool):
            async def fetchval(self, sql, *args):
                calls.append(sql)
                return True

        pool = Counting([MH_HOLIDAY], [IN_MH])
        await mark_holidays_weekends(pool, TEST_ORG, MON)
        await mark_holidays_weekends(pool, TEST_ORG, MON)
        assert len(calls) == 1, calls
