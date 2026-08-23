"""test_udin_register.py — the UDIN register, and the two boundaries that matter.

THE DELIVERABLES here are `TestTheGenerationBoundary` and
`TestTheRevocationBoundary`. A document signed exactly at the window edge is the
whole reason this register exists, and both edges are asserted from BOTH sides:
the last permissible moment must be permissible, and the next one must not be.

ICAI counts the generation window in whole days with BOTH END DATES INCLUDED
(FAQs on UDIN, 6th edn January 2026, Q19), so a 60-day window ends on
`signed_on + 59`. It counts the revocation window in hours from the INSTANT of
generation (announcement of 23 June 2023), so 48 hours means strictly `<`. Get
either wrong by one and a firm is told it has a day, or two hours, that it does
not — which is worse than telling it nothing, because it will act on it.

── WHY THE POOL IS FAKE AND WHAT THAT COSTS ────────────────────────────────
The suite has no database (tests/conftest.py swaps in a MagicMock), so the pool
here is a recorder: it returns rows this file invents and REMEMBERS THE SQL AND
THE BOUND PARAMETERS. That is the point. A mock pool hides bad SQL, so the
window arithmetic deliberately lives in Python and the SQL is handed date
BOUNDS — and `TestTheBoundsThatGoIntoTheSql` asserts the bounds that were
actually bound, which is the only part a fake pool can honestly prove. The SQL
text itself is asserted by shape (`TestTheSqlShape`) and the migration by shape
(`TestTheMigrationShape`).
"""
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import asyncpg
import pytest

from services.custody import udin
from services.custody.udin import UdinError, UdinWindows

UTC = timezone.utc

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "161_udin_register.sql"
)

ORG = "64e7bea6-0000-4000-8000-000000000000"


# ── a pool that remembers what it was asked ─────────────────────────────────

class RecordingPool:
    """Answers `fetch` from a canned table and records every call.

    Matching is on a SUBSTRING of the SQL rather than on call order, so a test
    does not silently pass because two queries happened to run in the order it
    assumed.
    """

    def __init__(self, answers=()):
        self.answers = list(answers)
        self.calls = []

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        for needle, rows in self.answers:
            if needle in sql:
                if isinstance(rows, Exception):
                    raise rows
                return rows
        return []

    def call_for(self, needle):
        for sql, args in self.calls:
            if needle in sql:
                return sql, args
        raise AssertionError(f"no call whose SQL contained {needle!r}: {self.calls}")


def open_row(**over):
    """One `status='signed'` register row, with the columns the service must NOT
    return already present — client_id, org_id and signed_by_user_id are real
    columns on `staging.udin_register` and a `SELECT *`-shaped refactor would
    start leaking them."""
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "org_id": ORG,
        "client_id": "22222222-2222-4222-8222-222222222222",
        "client_name": "Gokul Dairy Foods Private Limited",
        "document_kind": "gst_or_tax_audit_report",
        "document_title": "Tax audit report u/s 44AB",
        "document_ref": "TAR/2026/014",
        "financial_year": "2025-26",
        "signed_on": date(2026, 7, 1),
        "signed_by_member": "CA Meera Iyer",
        "signed_by_membership_no": "304576",
        "signed_by_user_id": "user_21457956f010",
        "source_module": "",
        "notes": "",
    }
    row.update(over)
    return row


def generated_row(**over):
    row = {
        "id": "33333333-3333-4333-8333-333333333333",
        "org_id": ORG,
        "client_id": "22222222-2222-4222-8222-222222222222",
        "client_name": "Gokul Dairy Foods Private Limited",
        "document_kind": "certificate",
        "document_title": "Net worth certificate",
        "document_ref": "NW/2026/003",
        "financial_year": "2025-26",
        "signed_on": date(2026, 8, 17),
        "signed_by_member": "CA Meera Iyer",
        "signed_by_membership_no": "304576",
        "signed_by_user_id": "user_21457956f010",
        "udin": "26304576AKTSBN1359",
        "udin_generated_at": datetime(2026, 8, 18, 9, 0, tzinfo=UTC),
    }
    row.update(over)
    return row


# ── THE DELIVERABLE: the generation boundary ────────────────────────────────

class TestTheGenerationBoundary:
    """A document signed exactly at the window edge.

    Every assertion here fails if anyone ever writes `signed_on + 60`.
    """

    def test_the_window_ends_on_signed_on_plus_fiftynine_not_plus_sixty(self):
        signed = date(2026, 3, 1)
        deadline = udin.generation_deadline(signed, window_days=60)
        # 1 March + 59 days. Both end dates count, so 1 March is day 1.
        assert deadline == date(2026, 4, 29)
        assert deadline == signed + timedelta(days=59)
        # THE BUG THIS FILE EXISTS TO PREVENT:
        assert deadline != signed + timedelta(days=60)

    def test_the_signing_date_itself_is_day_one(self):
        signed = date(2026, 3, 1)
        assert udin.day_of_window(signed, signed) == 1
        assert udin.days_left(signed, signed, window_days=60) == 59

    def test_on_the_last_permissible_day_zero_days_are_left_and_it_is_not_lapsed(self):
        signed = date(2026, 3, 1)
        edge = udin.generation_deadline(signed, window_days=60)
        assert udin.day_of_window(signed, edge) == 60
        assert udin.days_left(signed, edge, window_days=60) == 0
        assert udin.is_lapsed(signed, edge, window_days=60) is False
        # 0 must read as "today is the last day", never as "expired".
        assert udin.urgency(0) == "last_day"

    def test_the_day_after_the_edge_is_lapsed(self):
        signed = date(2026, 3, 1)
        past = udin.generation_deadline(signed, window_days=60) + timedelta(days=1)
        assert udin.day_of_window(signed, past) == 61
        assert udin.days_left(signed, past, window_days=60) == -1
        assert udin.is_lapsed(signed, past, window_days=60) is True
        assert udin.urgency(-1) == "lapsed"

    def test_the_day_before_the_edge_still_has_one_day(self):
        signed = date(2026, 3, 1)
        eve = udin.generation_deadline(signed, window_days=60) - timedelta(days=1)
        assert udin.days_left(signed, eve, window_days=60) == 1
        assert udin.is_lapsed(signed, eve, window_days=60) is False

    def test_the_edge_holds_across_a_month_end_and_a_february(self):
        # 2026 is not a leap year; this is the arithmetic a hand-written
        # "+2 months" would get wrong.
        assert udin.generation_deadline(date(2026, 1, 1), window_days=60) == date(2026, 3, 1)
        assert udin.generation_deadline(date(2027, 1, 1), window_days=60) == date(2027, 3, 1)
        # 2028 IS a leap year, so the same signing date lands a day earlier.
        assert udin.generation_deadline(date(2028, 1, 1), window_days=60) == date(2028, 2, 29)

    def test_the_forward_and_inverse_forms_round_trip(self):
        # `signed_on_for_deadline` is what turns a filter into a SQL bound. If
        # it disagreed with `generation_deadline` by a day, the at-risk list
        # would quietly drop or invent a day's worth of rows.
        for offset in range(0, 400, 37):
            signed = date(2026, 1, 1) + timedelta(days=offset)
            deadline = udin.generation_deadline(signed, window_days=60)
            assert udin.signed_on_for_deadline(deadline, window_days=60) == signed

    def test_a_one_day_window_ends_on_the_signing_date(self):
        # The degenerate case proves the `- 1` is not a fudge factor: a window
        # of 1 day means "the day you signed it", not "the day after".
        assert udin.generation_deadline(date(2026, 3, 1), window_days=1) == date(2026, 3, 1)
        assert udin.days_left(date(2026, 3, 1), date(2026, 3, 1), window_days=1) == 0

    def test_a_zero_or_negative_window_is_refused(self):
        with pytest.raises(UdinError):
            udin.generation_deadline(date(2026, 3, 1), window_days=0)
        with pytest.raises(UdinError):
            udin.signed_on_for_deadline(date(2026, 3, 1), window_days=-5)

    def test_a_document_dated_in_the_future_does_not_raise(self):
        # A data-entry error must not take down the list for the other 400 rows.
        signed = date(2026, 9, 1)
        assert udin.day_of_window(signed, date(2026, 8, 19)) == -12
        assert udin.urgency(71, started=False) == "not_started"


# ── THE DELIVERABLE: the revocation boundary ────────────────────────────────

class TestTheRevocationBoundary:
    """48 hours from the INSTANT of generation, and `within` excludes the edge."""

    GENERATED = datetime(2026, 8, 18, 9, 0, 0, tzinfo=UTC)

    def test_the_deadline_is_generation_plus_fortyeight_hours(self):
        assert udin.revocable_until(self.GENERATED, window_hours=48) == datetime(
            2026, 8, 20, 9, 0, 0, tzinfo=UTC
        )

    def test_one_second_before_the_edge_it_is_still_revocable(self):
        now = self.GENERATED + timedelta(hours=48) - timedelta(seconds=1)
        assert udin.is_revocable(self.GENERATED, now=now, window_hours=48) is True
        assert udin.revocation_window(self.GENERATED, now=now)["seconds_left"] == 1

    def test_at_exactly_fortyeight_hours_it_is_no_longer_revocable(self):
        # "within 48 hours from the time of its generation" — the instant 48
        # hours later is not within it. Strictly `<`, not `<=`.
        now = self.GENERATED + timedelta(hours=48)
        assert udin.is_revocable(self.GENERATED, now=now, window_hours=48) is False
        assert udin.revocation_window(self.GENERATED, now=now)["seconds_left"] == 0

    def test_one_second_after_the_edge_it_is_not_revocable(self):
        now = self.GENERATED + timedelta(hours=48, seconds=1)
        assert udin.is_revocable(self.GENERATED, now=now, window_hours=48) is False

    def test_the_countdown_clamps_at_zero_rather_than_going_negative(self):
        # A negative countdown reads as an enormous one after formatting.
        late = udin.revocation_window(self.GENERATED, now=self.GENERATED + timedelta(days=9))
        assert late["seconds_left"] == 0
        assert late["is_revocable"] is False

    def test_at_the_moment_of_generation_the_whole_window_is_left(self):
        w = udin.revocation_window(self.GENERATED, now=self.GENERATED, window_hours=48)
        assert w["is_revocable"] is True
        assert w["seconds_left"] == 48 * 3600

    def test_a_naive_datetime_is_read_as_utc_instead_of_raising(self):
        # `datetime.utcnow()` is naive and is still written all over this
        # codebase. Comparing it with an aware timestamp raises TypeError, which
        # would 500 the whole revocation panel.
        naive_now = self.GENERATED.replace(tzinfo=None) + timedelta(hours=1)
        assert udin.is_revocable(self.GENERATED, now=naive_now, window_hours=48) is True
        naive_gen = self.GENERATED.replace(tzinfo=None)
        assert udin.revocable_until(naive_gen).tzinfo is not None

    def test_the_window_hours_come_from_the_argument_not_from_a_constant(self):
        # If the Council ever moves 48, nothing here may keep answering 48.
        now = self.GENERATED + timedelta(hours=20)
        assert udin.is_revocable(self.GENERATED, now=now, window_hours=48) is True
        assert udin.is_revocable(self.GENERATED, now=now, window_hours=12) is False


# ── the windows, resolved from the policy table ─────────────────────────────

def window_rows():
    return [
        {"window_key": "generate", "window_amount": 60, "window_unit": "days",
         "effective_from": date(2021, 9, 17), "effective_to": None},
        {"window_key": "revoke", "window_amount": 48, "window_unit": "hours",
         "effective_from": date(2023, 6, 23), "effective_to": None},
    ]


class TestTheWindowsAreDataNotConstants:

    @pytest.mark.asyncio
    async def test_the_table_answers_when_it_has_a_covering_row(self):
        pool = RecordingPool([("staging.udin_window", window_rows())])
        w = await udin.load_windows(pool, as_of=date(2026, 8, 19))
        assert (w.generate_days, w.revoke_hours) == (60, 48)
        assert w.sources == {"generate": "table", "revoke": "table"}

    @pytest.mark.asyncio
    async def test_a_changed_window_is_honoured_without_a_deploy(self):
        # The whole reason this is a table: the generation window has already
        # moved once (15 -> 60 on 17 September 2021).
        rows = window_rows()
        rows.append({"window_key": "generate", "window_amount": 90, "window_unit": "days",
                     "effective_from": date(2026, 4, 1), "effective_to": None})
        pool = RecordingPool([("staging.udin_window", rows)])
        w = await udin.load_windows(pool, as_of=date(2026, 8, 19))
        assert w.generate_days == 90
        # ... and the OLD window still answers for an older date.
        old = await udin.load_windows(pool, as_of=date(2026, 3, 31))
        assert old.generate_days == 60

    @pytest.mark.asyncio
    async def test_the_validity_window_is_half_open(self):
        # effective_to is the first day the fact is NOT true — the same
        # convention services/statute.py uses. One date, written once.
        rows = [
            {"window_key": "generate", "window_amount": 15, "window_unit": "days",
             "effective_from": date(2019, 2, 1), "effective_to": date(2021, 9, 17)},
            {"window_key": "generate", "window_amount": 60, "window_unit": "days",
             "effective_from": date(2021, 9, 17), "effective_to": None},
        ]
        pool = RecordingPool([("staging.udin_window", rows)])
        assert (await udin.load_windows(pool, as_of=date(2021, 9, 16))).generate_days == 15
        assert (await udin.load_windows(pool, as_of=date(2021, 9, 17))).generate_days == 60

    @pytest.mark.asyncio
    async def test_a_row_with_the_wrong_unit_is_skipped_not_misread(self):
        # 48 stored as 'days' must never become a 48-DAY revocation window.
        rows = [{"window_key": "revoke", "window_amount": 48, "window_unit": "days",
                 "effective_from": date(2023, 6, 23), "effective_to": None}]
        pool = RecordingPool([("staging.udin_window", rows)])
        w = await udin.load_windows(pool, as_of=date(2026, 8, 19))
        assert w.revoke_hours == udin.ICAI_REVOKE_WINDOW_HOURS
        assert w.revoke_source == "icai-default"

    @pytest.mark.asyncio
    async def test_it_falls_back_to_the_icai_numbers_when_the_table_is_absent(self):
        # Migration 161 is NOT applied. The register must still work.
        pool = RecordingPool([
            ("staging.udin_window", asyncpg.exceptions.UndefinedTableError("no table")),
        ])
        w = await udin.load_windows(pool, as_of=date(2026, 8, 19))
        assert (w.generate_days, w.revoke_hours) == (60, 48)
        assert w.sources == {"generate": "icai-default", "revoke": "icai-default"}

    @pytest.mark.asyncio
    async def test_an_empty_table_falls_back_too(self):
        pool = RecordingPool([("staging.udin_window", [])])
        w = await udin.load_windows(pool, as_of=date(2026, 8, 19))
        assert (w.generate_days, w.revoke_hours) == (60, 48)
        assert w.generate_source == "icai-default"

    @pytest.mark.asyncio
    async def test_as_of_is_keyword_only_and_has_no_default(self):
        # Same rule as services/statute.py: a window read "as of today" is the
        # wrong window for a document signed last November.
        pool = RecordingPool([("staging.udin_window", window_rows())])
        with pytest.raises(TypeError):
            await udin.load_windows(pool)


# ── the at-risk list ────────────────────────────────────────────────────────

class TestTheAtRiskList:

    AS_OF = date(2026, 8, 19)

    @pytest.mark.asyncio
    async def test_it_reports_the_day_of_the_window_and_what_is_left(self):
        # Signed 1 July 2026, asked on 19 August 2026: day 50 of 60.
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [open_row(signed_on=date(2026, 7, 1))]),
        ])
        rows = await udin.at_risk(pool, ORG, as_of=self.AS_OF)
        assert len(rows) == 1
        row = rows[0]
        assert row["day_of_window"] == 50
        assert row["generate_by"] == date(2026, 8, 29)
        assert row["days_left"] == 10
        assert row["is_lapsed"] is False
        assert row["urgency"] == "due_soon"

    @pytest.mark.asyncio
    async def test_a_row_signed_exactly_at_the_edge_is_reported_as_the_last_day(self):
        # THE BOUNDARY, through the whole service and not just the arithmetic.
        edge = udin.signed_on_for_deadline(self.AS_OF, window_days=60)
        assert edge == date(2026, 6, 21)
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [open_row(signed_on=edge)]),
        ])
        row = (await udin.at_risk(pool, ORG, as_of=self.AS_OF))[0]
        assert row["day_of_window"] == 60
        assert row["days_left"] == 0
        assert row["is_lapsed"] is False
        assert row["urgency"] == "last_day"
        assert row["generate_by"] == self.AS_OF

    @pytest.mark.asyncio
    async def test_one_day_earlier_is_lapsed(self):
        edge = udin.signed_on_for_deadline(self.AS_OF, window_days=60)
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [open_row(signed_on=edge - timedelta(days=1))]),
        ])
        row = (await udin.at_risk(pool, ORG, as_of=self.AS_OF))[0]
        assert row["days_left"] == -1
        assert row["is_lapsed"] is True
        assert row["urgency"] == "lapsed"

    @pytest.mark.asyncio
    async def test_it_is_ordered_by_least_time_left_first(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [
                open_row(id="c", signed_on=date(2026, 8, 10), document_title="C"),
                open_row(id="a", signed_on=date(2026, 6, 25), document_title="A"),
                open_row(id="b", signed_on=date(2026, 7, 15), document_title="B"),
            ]),
        ])
        rows = await udin.at_risk(pool, ORG, as_of=self.AS_OF)
        assert [r["id"] for r in rows] == ["a", "b", "c"]
        assert [r["days_left"] for r in rows] == sorted(r["days_left"] for r in rows)

    @pytest.mark.asyncio
    async def test_it_never_hands_back_a_client_org_or_user_id(self):
        # NAMES, NOT IDS. The fixture row carries all three; none may escape.
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [open_row()]),
        ])
        row = (await udin.at_risk(pool, ORG, as_of=self.AS_OF))[0]
        assert "client_id" not in row
        assert "org_id" not in row
        assert "signed_by_user_id" not in row
        assert row["client_name"] == "Gokul Dairy Foods Private Limited"
        assert row["signed_by_member"] == "CA Meera Iyer"
        # The MRN is not a system identifier — it is printed on the document.
        assert row["signed_by_membership_no"] == "304576"
        # The register row's own id IS returned; a caller has to address it.
        assert row["id"]

    @pytest.mark.asyncio
    async def test_a_future_dated_signing_is_flagged_and_does_not_crash(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [open_row(signed_on=date(2026, 9, 1))]),
        ])
        row = (await udin.at_risk(pool, ORG, as_of=self.AS_OF))[0]
        assert row["day_of_window"] < 1
        assert row["urgency"] == "not_started"

    @pytest.mark.asyncio
    async def test_an_unknown_document_kind_still_renders(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [open_row(document_kind="peer_review")]),
        ])
        row = (await udin.at_risk(pool, ORG, as_of=self.AS_OF))[0]
        assert row["document_kind_label"] == "peer_review"

    @pytest.mark.asyncio
    async def test_a_caller_may_pass_windows_it_has_already_resolved(self):
        pool = RecordingPool([("staging.udin_register", [open_row()])])
        rows = await udin.at_risk(
            pool, ORG, as_of=self.AS_OF, windows=UdinWindows(generate_days=90)
        )
        assert rows[0]["window_days"] == 90
        assert rows[0]["generate_by"] == date(2026, 7, 1) + timedelta(days=89)
        # ... and it did NOT re-read the policy table.
        assert not any("udin_window" in sql for sql, _ in pool.calls)

    @pytest.mark.asyncio
    async def test_a_bad_limit_or_a_negative_within_days_is_refused(self):
        pool = RecordingPool([("staging.udin_window", window_rows())])
        with pytest.raises(UdinError):
            await udin.at_risk(pool, ORG, as_of=self.AS_OF, limit=0)
        with pytest.raises(UdinError):
            await udin.at_risk(pool, ORG, as_of=self.AS_OF, within_days=-1)


class TestTheBoundsThatGoIntoTheSql:
    """The only part of the SQL a fake pool can honestly prove.

    The window arithmetic is in Python precisely so that the filters are bind
    parameters this test can read back. If someone moves the arithmetic into the
    WHERE clause, these assertions stop meaning anything — and that is exactly
    the change nobody would notice, so they are written to fail loudly if the
    bound values change shape.
    """

    AS_OF = date(2026, 8, 19)

    @pytest.mark.asyncio
    async def test_by_default_neither_bound_is_applied(self):
        pool = RecordingPool([("staging.udin_window", window_rows())])
        await udin.at_risk(pool, ORG, as_of=self.AS_OF)
        _, args = pool.call_for("staging.udin_register")
        assert args == (ORG, None, None, udin.DEFAULT_LIMIT)

    @pytest.mark.asyncio
    async def test_excluding_lapsed_binds_the_signing_date_whose_deadline_is_today(self):
        pool = RecordingPool([("staging.udin_window", window_rows())])
        await udin.at_risk(pool, ORG, as_of=self.AS_OF, include_lapsed=False)
        _, args = pool.call_for("staging.udin_register")
        # as_of - 59, NOT as_of - 60: the row signed that day is on its LAST
        # day and must be kept, not dropped.
        assert args[1] == date(2026, 6, 21)
        assert args[1] == self.AS_OF - timedelta(days=59)
        assert udin.generation_deadline(args[1], window_days=60) == self.AS_OF

    @pytest.mark.asyncio
    async def test_within_days_binds_the_far_edge(self):
        pool = RecordingPool([("staging.udin_window", window_rows())])
        await udin.at_risk(pool, ORG, as_of=self.AS_OF, within_days=7)
        _, args = pool.call_for("staging.udin_register")
        assert udin.generation_deadline(args[2], window_days=60) == self.AS_OF + timedelta(days=7)

    @pytest.mark.asyncio
    async def test_within_days_zero_means_due_today(self):
        pool = RecordingPool([("staging.udin_window", window_rows())])
        await udin.at_risk(pool, ORG, as_of=self.AS_OF, within_days=0)
        _, args = pool.call_for("staging.udin_register")
        assert udin.generation_deadline(args[2], window_days=60) == self.AS_OF

    @pytest.mark.asyncio
    async def test_the_bounds_move_with_the_window_not_with_a_constant(self):
        pool = RecordingPool([("staging.udin_register", [])])
        await udin.at_risk(
            pool, ORG, as_of=self.AS_OF, include_lapsed=False,
            windows=UdinWindows(generate_days=90),
        )
        _, args = pool.call_for("staging.udin_register")
        assert args[1] == self.AS_OF - timedelta(days=89)

    @pytest.mark.asyncio
    async def test_the_revocation_cutoff_is_bound_not_written_as_an_interval(self):
        now = datetime(2026, 8, 19, 12, 0, tzinfo=UTC)
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", []),
        ])
        await udin.revocable_now(pool, ORG, now=now)
        sql, args = pool.call_for("staging.udin_register")
        assert args[1] == now - timedelta(hours=48)
        assert "interval" not in sql.lower()
        assert "now()" not in sql.lower()


# ── the 48-hour list ────────────────────────────────────────────────────────

class TestTheRevocableList:

    NOW = datetime(2026, 8, 19, 12, 0, tzinfo=UTC)

    @pytest.mark.asyncio
    async def test_it_returns_what_is_still_inside_the_window(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [
                generated_row(udin_generated_at=self.NOW - timedelta(hours=1)),
            ]),
        ])
        rows = await udin.revocable_now(pool, ORG, now=self.NOW)
        assert len(rows) == 1
        assert rows[0]["seconds_left"] == 47 * 3600
        assert rows[0]["revocable_until"] == self.NOW + timedelta(hours=47)

    @pytest.mark.asyncio
    async def test_a_row_exactly_fortyeight_hours_old_is_excluded(self):
        # The SQL cutoff is `>=`, so this row COMES BACK from the database and
        # is dropped here — which is the point of deciding it in Python.
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [
                generated_row(udin_generated_at=self.NOW - timedelta(hours=48)),
            ]),
        ])
        assert await udin.revocable_now(pool, ORG, now=self.NOW) == []

    @pytest.mark.asyncio
    async def test_a_row_one_second_inside_the_window_survives(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [
                generated_row(udin_generated_at=self.NOW - timedelta(hours=48) + timedelta(seconds=1)),
            ]),
        ])
        rows = await udin.revocable_now(pool, ORG, now=self.NOW)
        assert [r["seconds_left"] for r in rows] == [1]

    @pytest.mark.asyncio
    async def test_it_is_ordered_by_what_runs_out_first(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [
                generated_row(id="fresh", document_title="Fresh",
                              udin_generated_at=self.NOW - timedelta(hours=2)),
                generated_row(id="stale", document_title="Stale",
                              udin_generated_at=self.NOW - timedelta(hours=47)),
            ]),
        ])
        rows = await udin.revocable_now(pool, ORG, now=self.NOW)
        assert [r["id"] for r in rows] == ["stale", "fresh"]

    @pytest.mark.asyncio
    async def test_it_never_hands_back_a_client_org_or_user_id(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [
                generated_row(udin_generated_at=self.NOW - timedelta(hours=1)),
            ]),
        ])
        row = (await udin.revocable_now(pool, ORG, now=self.NOW))[0]
        assert {"client_id", "org_id", "signed_by_user_id"} & set(row) == set()
        # Only the member who generated a UDIN can revoke it (FAQ Q151), so the
        # list has to name them.
        assert row["signed_by_member"] == "CA Meera Iyer"

    @pytest.mark.asyncio
    async def test_a_generated_row_missing_its_instant_is_skipped_not_fatal(self):
        # The CHECK on staging.udin_register makes this impossible; a register
        # that refuses to render is worse than one that omits an impossible row.
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", [generated_row(udin_generated_at=None)]),
        ])
        assert await udin.revocable_now(pool, ORG, now=self.NOW) == []


# ── the summary ─────────────────────────────────────────────────────────────

class TestTheSummary:

    AS_OF = date(2026, 8, 19)

    @pytest.mark.asyncio
    async def test_it_counts_statuses_and_buckets_the_open_work(self):
        edge = udin.signed_on_for_deadline(self.AS_OF, window_days=60)
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("GROUP BY status", [
                {"status": "signed", "n": 4},
                {"status": "generated", "n": 11},
                {"status": "revoked", "n": 1},
            ]),
            ("staging.udin_register", [
                {"signed_on": edge},                              # last_day
                {"signed_on": edge - timedelta(days=1)},          # lapsed
                {"signed_on": edge + timedelta(days=2)},          # critical
                {"signed_on": self.AS_OF},                        # open
            ]),
        ])
        s = await udin.register_summary(pool, ORG, as_of=self.AS_OF)
        assert s["by_status"] == {"signed": 4, "generated": 11, "revoked": 1,
                                  "not_required": 0}
        assert s["open_by_urgency"]["lapsed"] == 1
        assert s["open_by_urgency"]["last_day"] == 1
        assert s["open_by_urgency"]["critical"] == 1
        assert s["open_by_urgency"]["open"] == 1
        assert s["open_total"] == 4
        assert s["lapsed"] == 1
        # The soonest deadline that is still reachable — the lapsed row does not
        # get to be "next", it is already gone.
        assert s["next_deadline"] == self.AS_OF
        assert s["window_days"] == 60
        assert s["revoke_window_hours"] == 48
        assert s["window_sources"] == {"generate": "table", "revoke": "table"}

    @pytest.mark.asyncio
    async def test_the_count_query_carries_no_limit(self):
        # A count that silently caps is the one lie a compliance register may
        # never tell.
        pool = RecordingPool([("staging.udin_window", window_rows())])
        await udin.register_summary(pool, ORG, as_of=self.AS_OF)
        for sql, _ in pool.calls:
            if "udin_register" in sql:
                assert "LIMIT" not in sql.upper()


# ── the UDIN string: described, never rejected ──────────────────────────────

class TestUdinSyntaxIsAdvisoryOnly:
    """GSTIN, PAN and TAN block nothing in this product, and neither does this.

    A UDIN that does not match the published syntax is RECORDED, with a note.
    A validator that refused it would refuse a real UDIN the day ICAI changes
    its generator, and a register that cannot record the truth is useless.
    """

    def test_a_well_formed_udin_is_decomposed(self):
        out = udin.udin_syntax("26304576AKTSBN1359", signed_on=date(2026, 7, 1))
        assert out["matches_published_syntax"] is True
        assert out["year_2digit"] == "26"
        assert out["membership_no"] == "304576"
        assert out["notes"] == []

    def test_a_malformed_udin_is_still_recorded_with_a_note(self):
        out = udin.udin_syntax("NOT-A-UDIN")
        assert out["is_present"] is True
        assert out["matches_published_syntax"] is False
        assert out["notes"]
        assert "recorded as entered" in " ".join(out["notes"])

    def test_an_absent_udin_is_not_an_error(self):
        for value in ("", "   ", None):
            out = udin.udin_syntax(value)
            assert out["is_present"] is False
            assert out["notes"] == []

    def test_a_udin_belonging_to_another_member_is_flagged(self):
        # Digits 3-8 ARE the generating member's MRN. In a four-partner firm
        # this is the realistic paste error and nothing else would catch it.
        out = udin.udin_syntax("26999999AKTSBN1359", membership_no="304576")
        assert out["matches_published_syntax"] is True
        assert any("304576" in n and "999999" in n for n in out["notes"])

    def test_a_membership_number_shorter_than_six_digits_is_padded_not_rejected(self):
        out = udin.udin_syntax("26000042AKTSBN1359", membership_no="42")
        assert out["notes"] == []

    def test_a_december_signing_may_carry_next_years_digits(self):
        # The window is 60 days, so a December signing legitimately generates in
        # January. Flagging that would train people to ignore the notes.
        assert udin.udin_syntax("27304576AKTSBN1359", signed_on=date(2026, 12, 20))["notes"] == []
        assert udin.udin_syntax("26304576AKTSBN1359", signed_on=date(2026, 12, 20))["notes"] == []
        odd = udin.udin_syntax("19304576AKTSBN1359", signed_on=date(2026, 12, 20))
        assert odd["notes"]

    def test_it_lowercases_nothing_and_never_raises(self):
        for junk in (12345, "  26304576aktsbn1359  ", "x" * 400, []):
            out = udin.udin_syntax(junk)
            assert isinstance(out["notes"], list)
        assert udin.udin_syntax(" 26304576aktsbn1359 ")["udin"] == "26304576AKTSBN1359"


# ── the SQL, by shape ───────────────────────────────────────────────────────

def _service_sql():
    return {
        name: getattr(udin, name)
        for name in dir(udin)
        if name.startswith("_SELECT") and isinstance(getattr(udin, name), str)
    }


def _register_sql():
    """Only the queries that read `staging.udin_register` — the tenant-owned
    relation. Selected by the TABLE they touch and not by a hand-kept list, so a
    query added later is covered by the tenancy tests the day it is written
    rather than the day somebody remembers to add it here."""
    return {
        name: sql for name, sql in _service_sql().items()
        if "staging.udin_register" in sql
    }


class TestTenancy:
    """EVERY read is org-scoped, asserted in the SQL and at the call.

    Written after a mutation run showed the hole: deleting `org_id = $1::uuid`
    from `_SELECT_OPEN_DATES` — which turns the summary's open-work count into
    every firm's backlog on the platform — left the whole suite green. Nothing
    else in this file looks at the WHERE clause's tenant predicate, and
    `TestTheBoundsThatGoIntoTheSql` only reads args[1:] onwards.

    A mock pool cannot prove that Postgres filters; what it CAN prove is that
    the predicate is still written and that the org is still the value bound to
    it. Both halves are needed: the predicate alone could be bound the wrong
    argument, and the argument alone could be bound to a predicate that is gone.
    """

    AS_OF = date(2026, 8, 19)
    OTHER = "9999aaaa-0000-4000-8000-000000000000"

    def test_every_register_query_carries_the_tenant_predicate(self):
        # `$1::uuid` and not merely `org_id`: an `org_id` that appears only in
        # the SELECT list, or a predicate rewritten to bind some other
        # parameter, must both fail here.
        for name, sql in _register_sql().items():
            assert "org_id = $1::uuid" in sql, f"{name} is not org-scoped"

    @pytest.mark.asyncio
    async def test_the_org_is_the_first_bound_argument_of_every_register_read(self):
        pool = RecordingPool([
            ("staging.udin_window", window_rows()),
            ("staging.udin_register", []),
        ])
        await udin.at_risk(pool, ORG, as_of=self.AS_OF)
        await udin.revocable_now(pool, ORG, now=datetime(2026, 8, 19, 9, 0, tzinfo=UTC))
        await udin.register_summary(pool, ORG, as_of=self.AS_OF)
        register_calls = [
            (sql, args) for sql, args in pool.calls if "staging.udin_register" in sql
        ]
        # at_risk, revocable_now, and the summary's two reads.
        assert len(register_calls) == 4, register_calls
        for sql, args in register_calls:
            assert args and args[0] == ORG, (sql, args)

    @pytest.mark.asyncio
    async def test_the_org_reaches_the_query_as_given_and_is_not_defaulted(self):
        # A signature that quietly fell back to some ambient org would be the
        # same leak wearing a different hat, so the org actually asked for is
        # the one that must arrive.
        pool = RecordingPool([("staging.udin_window", window_rows())])
        await udin.at_risk(pool, self.OTHER, as_of=self.AS_OF)
        _, args = pool.call_for("staging.udin_register")
        assert args[0] == self.OTHER

    def test_the_windows_read_is_the_only_unscoped_query(self):
        # `staging.udin_window` holds ICAI's policy, which is the same for every
        # firm — it is the one relation here with no tenant. This test is what
        # stops that exemption quietly spreading: a new query that reads the
        # REGISTER without a tenant predicate lands in `unscoped` and fails,
        # because `_register_sql` selects on the relation, not on a name a
        # future author could pick badly.
        unscoped = [
            name for name, sql in _service_sql().items()
            if "org_id = $1::uuid" not in sql
        ]
        assert unscoped == ["_SELECT_WINDOWS"], unscoped
        assert "staging.udin_window" in udin._SELECT_WINDOWS
        # No parameter at all, so there is no argument that could be mistaken
        # for a tenant and no way this query grows one unnoticed.
        assert "$" not in udin._SELECT_WINDOWS


class TestTheSqlShape:

    def test_every_bind_parameter_is_cast(self):
        # PgBouncer turns an untyped parameter expression into a parse error and
        # an instant 500 — it has cost this repo a real incident in the credits
        # ledger. Every `$n` in this module must carry its type.
        for name, sql in _service_sql().items():
            for match in re.finditer(r"\$\d+", sql):
                tail = sql[match.end():match.end() + 2]
                assert tail == "::", f"{name}: {match.group(0)} is not cast"

    def test_every_relation_is_schema_qualified(self):
        # A shadow table has bitten this repo (migration 142). Never rely on
        # search_path.
        #
        # `public.` is admitted alongside `staging.` because the author joins
        # added for migration 201 read `public.users` — the one relation in
        # these queries that genuinely lives there, because a login is global
        # and not a tenant's. What this test enforces is QUALIFICATION, not the
        # word "staging": `public.users` names its schema, which is the whole
        # protection. `tests/test_custody_writes.py` already admits exactly this
        # pair for exactly this reason, and two tests over the same package
        # disagreeing about which schemas exist would be worse than either.
        for name, sql in _service_sql().items():
            for match in re.finditer(r"\b(?:FROM|JOIN)\s+(\S+)", sql):
                assert match.group(1).startswith(("staging.", "public.")), \
                    f"{name}: {match.group(1)}"

    def test_no_sql_does_date_arithmetic(self):
        # The window lives in exactly one place and it is Python. An `interval`
        # or a `+ 60` in here would be asserted by nothing, because the suite's
        # pool is a mock.
        for name, sql in _service_sql().items():
            low = sql.lower()
            assert "interval" not in low, name
            assert "now()" not in low, name
            assert "current_date" not in low, name
            assert not re.search(r"signed_on\s*[+-]\s*\d", low), name

    def test_no_sql_selects_a_client_org_or_user_identifier(self):
        # NAMES, NOT IDS, enforced at the point the columns are chosen rather
        # than only where they are assembled.
        for name, sql in _service_sql().items():
            select = sql.split("FROM")[0]
            for banned in ("client_id", "signed_by_user_id"):
                assert banned not in select, f"{name} selects {banned}"

    def test_the_open_scan_matches_its_partial_index(self):
        # Alias-qualified since the author joins landed. `public.users` carries
        # an `id`, a `created_at` and an `updated_at` of its own, so every
        # column in these two queries had to be prefixed or the planner would
        # refuse them as ambiguous — which PgBouncer returns as an instant 500
        # on the default view of the busiest compliance list in the product.
        # The predicates and the ordering are unchanged, and they are what
        # `idx_udin_register_open` is matched on.
        assert "r.status = 'signed'" in udin._SELECT_OPEN
        assert "ORDER BY r.signed_on ASC" in udin._SELECT_OPEN
        assert "r.status = 'generated'" in udin._SELECT_REVOCABLE


# ── the migration, by shape ─────────────────────────────────────────────────

def _sql_body(text: str) -> str:
    """The migration with its `--` comments stripped.

    Written by hand rather than with a regex because the header is most of the
    file and the seed's note text contains dashes; a naive `re.sub(r'--.*', ...)`
    would cut inside a quoted string and leave the body unparseable.
    """
    out = []
    i = 0
    in_quote = False
    while i < len(text):
        ch = text[i]
        if in_quote:
            if ch == "'":
                if text[i + 1:i + 2] == "'":
                    out.append("''")
                    i += 2
                    continue
                in_quote = False
            out.append(ch)
            i += 1
            continue
        if ch == "'":
            in_quote = True
            out.append(ch)
            i += 1
            continue
        if ch == "-" and text[i + 1:i + 2] == "-":
            nl = text.find("\n", i)
            i = len(text) if nl == -1 else nl
            continue
        out.append(ch)
        i += 1
    return "".join(out)


class TestTheMigrationShape:

    TEXT = MIGRATION.read_text(encoding="utf-8")

    def test_it_exists_and_names_what_it_touches(self):
        head = self.TEXT[: self.TEXT.index("BEGIN;")]
        for needed in ("staging.udin_register", "staging.udin_window",
                       "IF IT RUNS TWICE", "HOW TO UNDO IT"):
            assert needed in head, needed

    def test_it_is_idempotent(self):
        body = _sql_body(self.TEXT)
        creates = re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(\S+)", body)
        assert creates, "no DDL found"
        for token in creates:
            assert token == "IF", f"a CREATE without IF NOT EXISTS: {token}"
        # A trigger has no IF NOT EXISTS in any Postgres; OR REPLACE (PG 14+,
        # this server is 17.6) is the idempotent spelling.
        assert body.count("CREATE OR REPLACE TRIGGER") == 2
        assert "CREATE TRIGGER" not in body.replace("CREATE OR REPLACE TRIGGER", "")
        # The seed must not overwrite a hand-correction on a re-run.
        assert "ON CONFLICT ON CONSTRAINT uq_udin_window_version DO NOTHING" in body
        assert "DO UPDATE" not in body

    def test_it_wraps_itself_in_a_transaction_with_a_lock_timeout(self):
        body = _sql_body(self.TEXT)
        assert body.count("BEGIN;") == 1 and body.count("COMMIT;") == 1
        assert "SET LOCAL lock_timeout" in body

    def test_it_alters_and_drops_nothing(self):
        body = _sql_body(self.TEXT).upper()
        for forbidden in ("ALTER TABLE", "DROP TABLE", "DROP COLUMN", "DELETE FROM",
                          "UPDATE STAGING.", "TRUNCATE"):
            assert forbidden not in body, forbidden

    def test_every_relation_it_names_is_schema_qualified(self):
        body = _sql_body(self.TEXT)
        for match in re.finditer(
            r"(?:CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+\S+\s+BEFORE\s+UPDATE\s+ON|"
            r"REFERENCES|INSERT\s+INTO|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|"
            r"COMMENT\s+ON\s+TABLE)\s+(\S+)",
            body,
        ):
            assert match.group(1).startswith("staging."), match.group(1)

    def test_it_does_not_use_the_cast_that_a_check_constraint_rejects(self):
        # `date::timestamptz` is STABLE (pg_cast, probed on the live server), and
        # Postgres refuses a non-immutable expression in a CHECK — so the obvious
        # spelling fails at APPLY time, which is the worst place to find out.
        body = _sql_body(self.TEXT)
        assert "::timestamptz" not in body
        assert "AT TIME ZONE 'UTC'" in body

    def test_the_seed_carries_both_windows_with_their_units_and_citations(self):
        body = _sql_body(self.TEXT)
        assert "('generate', 60, 'days'" in body
        assert "('revoke', 48, 'hours'" in body
        # The citation in the seed must be the SAME url the module documents.
        # A compliance window with no source, or with two different sources, is
        # a rumour — and the two drifting apart is how it becomes one.
        assert udin.ICAI_REVOKE_WINDOW_URL in body
        assert udin.ICAI_GENERATE_WINDOW_URL in body

    def test_the_seed_agrees_with_the_python_fallbacks(self):
        # If someone changes one and not the other, the register answers one
        # number before the migration is applied and a different one after.
        body = _sql_body(self.TEXT)
        assert f"('generate', {udin.ICAI_GENERATE_WINDOW_DAYS}, 'days'" in body
        assert f"('revoke', {udin.ICAI_REVOKE_WINDOW_HOURS}, 'hours'" in body
        assert f"DATE '{udin.ICAI_GENERATE_WINDOW_FROM.isoformat()}'" in body
        assert f"DATE '{udin.ICAI_REVOKE_WINDOW_FROM.isoformat()}'" in body

    def test_the_register_has_no_lapsed_status(self):
        # Whether the window has closed is a fact about today. A stored copy is
        # wrong from midnight until whatever job flips it.
        body = _sql_body(self.TEXT)
        status_ck = body[body.index("udin_register_status_ck"):][:300]
        assert "'lapsed'" not in status_ck
        for status in udin.STATUSES:
            assert f"'{status}'" in status_ck

    def test_the_document_kinds_agree_with_the_service(self):
        body = _sql_body(self.TEXT)
        kind_ck = body[body.index("udin_register_kind_ck"):][:400]
        for kind in udin.DOCUMENT_KINDS:
            assert f"'{kind}'" in kind_ck

    def test_the_udin_column_does_not_encode_the_published_syntax(self):
        # GSTIN / PAN / TAN block nothing here, and neither may this. A CHECK
        # that encoded YY-MRN-random would refuse a real UDIN the day ICAI
        # changed its generator.
        body = _sql_body(self.TEXT)
        shape = body[body.index("udin_register_udin_shape_ck"):][:220]
        assert "[0-9A-Za-z]{18}" in shape
        assert "{6}" not in shape
        # And the membership number carries no format constraint at all.
        assert "signed_by_membership_no_ck" not in body

    def test_there_is_no_foreign_key_to_the_esign_tables(self):
        # A statutory register must outlive the workflow artefact that happened
        # to produce the document; envelopes get cancelled and purged.
        body = _sql_body(self.TEXT)
        assert "sign_documents" not in body
        assert "REFERENCES staging.organisations" in body
        assert "REFERENCES staging.graha_clients" in body

    def test_the_open_index_is_partial_on_the_status_the_service_scans(self):
        body = _sql_body(self.TEXT)
        assert "idx_udin_register_open" in body
        block = body[body.index("idx_udin_register_open"):][:220]
        assert "(org_id, signed_on)" in block
        assert "WHERE status = 'signed'" in block
