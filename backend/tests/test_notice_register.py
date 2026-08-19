"""
test_notice_register — the clock, tested where the bugs actually are.

Everything here exercises the arithmetic and the banding in
`services/custody/notices.py`, which take dates and return dates and touch
nothing else. That is the whole point of the module's shape: every way this
register can be wrong is a wrong DATE or a wrong ORDER, and neither needs a
connection to reproduce.

The schema itself is verified by probing the live catalogue read-only, not by
simulating it (`mock_pool_hides_bad_sql`): `staging.notice_register` and
`staging.notice_type` were confirmed absent on 19 August 2026, and the columns
the queries join to (`graha_clients.name`, `organisations.id`,
`public.users.name`) were confirmed present with the types migration 162
assumes, as was every date this file asserts.

THE ONE POOL IN THIS FILE IS A TENANCY POOL AND NOTHING ELSE. It simulates the
org predicate and no other part of any statement, and no test uses it to assert
what a query MEANS — only who it is allowed to return rows about. That
distinction is the whole of `mock_pool_hides_bad_sql`: a pool that fabricates
results lets wrong SQL look right, whereas this one is a way of deleting a WHERE
clause on purpose and checking that something screams.

It was added after the fact. The first version of this file had no pool, and
deleting `r.org_id = $1::uuid` from `client_history` — a cross-tenant leak of
which companies are under assessment — left all 27 tests green. A suite that
cannot fail on that is not testing the thing that matters most.

The dates below are absolute, never `today() + n`. A relative date makes a test
that passes in August and fails in February, and the whole subject of this file
is what happens at the end of a month.
"""
import re
from datetime import date

import pytest

from services.custody import notices
from services.custody.notices import (
    CRITICAL,
    CrossOrgLeak,
    ESCALATED,
    OVERDUE,
    SCHEDULED,
    SOON,
    STOPPED,
    URGENCY_ORDER,
    URGENT,
    NoticeUrgency,
    compute_due_on,
    days_remaining,
    describe_urgency,
    sort_by_urgency,
    urgency_of,
    urgency_rank,
)


# ── the month-end straddle, which is the reason this file exists ─────────────
#
# Every value below was measured against the live PostgreSQL 17.6 server on
# 19 August 2026 with the exact expression migration 162's generated column
# uses, so these are not my arithmetic — they are the database's, written down.

def test_thirty_day_window_straddling_january_into_march():
    """An ASMT-10 served on 31 January is due on 2 March, not 2 February.

    Thirty days from the last day of January crosses the whole of February and
    lands two days into March. The plausible wrong answers are all worse than
    useless: "end of February" (28 Feb) is four days early and would have the
    practice believe it had missed a deadline it had not, and any "add one
    month" reading (28 Feb / 2 Mar by luck) is right here only by accident and
    wrong for a 7-day or 3-month window.
    """
    assert compute_due_on(date(2026, 1, 31), window_days=30) == date(2026, 3, 2)


def test_thirty_day_window_straddling_a_leap_february():
    """The same notice one year on: 2028 has a 29 February, so the date moves.

    2028-01-31 + 30 days is 1 March 2028, one day EARLIER in March than the
    2026 answer, because February absorbed an extra day. Any implementation
    that hardcodes February at 28 gets this wrong, and gets it wrong in the
    direction that reports a deadline LATER than it is.
    """
    assert compute_due_on(date(2028, 1, 31), window_days=30) == date(2028, 3, 1)


def test_seven_day_window_straddling_a_month_end():
    """A rule 88C DRC-01B served on 27 February 2026 is due on 6 March."""
    assert compute_due_on(date(2026, 2, 27), window_days=7) == date(2026, 3, 6)


def test_three_month_appeal_window_clamps_at_a_short_month():
    """An APL-01 against an order communicated on 31 January is due 30 April.

    Three MONTHS, not ninety days — s.107(1) says months. 31 January plus three
    months is 31 April, which does not exist, and Postgres clamps DOWN to
    30 April. Rolling forward to 1 May instead would be one day late on a
    limitation period that is then simply gone: after it, s.107(4) leaves only
    a further month the appellate authority MAY condone, at its discretion.

    Ninety days from the same date would be 1 May — so the two readings differ,
    and the wrong one is the one that loses the appeal.
    """
    assert compute_due_on(date(2026, 1, 31), window_months=3) == date(2026, 4, 30)
    assert compute_due_on(date(2026, 1, 31), window_days=90) == date(2026, 5, 1)


def test_three_month_window_clamps_across_a_year_end():
    """30 November + 3 months is 28 February of the NEXT year, clamped."""
    assert compute_due_on(date(2026, 11, 30), window_months=3) == date(2027, 2, 28)


def test_three_month_window_off_a_leap_day():
    """29 February 2028 + 12 months is 28 February 2029 — the day disappears."""
    assert compute_due_on(date(2028, 2, 29), window_months=12) == date(2029, 2, 28)


def test_drc_07_three_months_from_service_is_a_calendar_computation():
    """A DRC-07 served 31 December 2026: s.78 gives three months, so 31 March.

    March has 31 days, so nothing clamps here and the answer is the last day of
    March. Included because it is the case where months-arithmetic and a naive
    "same day, three months on" agree — a test suite that only contains the
    clamping cases cannot tell a correct implementation from one that clamps
    everything.
    """
    assert compute_due_on(date(2026, 12, 31), window_months=3) == date(2027, 3, 31)


# ── the override, and the refusal to invent a date ──────────────────────────

def test_the_date_on_the_notice_beats_the_statutory_cap():
    """Rule 99(1) caps an ASMT-10 at thirty days; a notice may say fifteen.

    'not exceeding thirty days ... or such further period as may be permitted
    by him' — the thirty is a ceiling on the officer, not the taxpayer's
    entitlement. Computing thirty when the paper says fifteen invents a
    fortnight the practice does not have.
    """
    got = compute_due_on(
        date(2026, 1, 31), window_days=30, due_on_override=date(2026, 2, 15)
    )
    assert got == date(2026, 2, 15)


def test_an_extension_beyond_the_cap_is_also_honoured():
    """Rule 99(1) also lets the officer permit a FURTHER period. Honour that too."""
    got = compute_due_on(
        date(2026, 1, 31), window_days=30, due_on_override=date(2026, 4, 10)
    )
    assert got == date(2026, 4, 10)


def test_a_notice_specified_window_refuses_rather_than_inventing_a_deadline():
    """A DRC-01 has no statutory reply period, so there is nothing to compute.

    Rule 142 prescribes none — the representation goes in DRC-06 by whatever
    date the officer wrote. Returning `received_on` here (which is what
    `received_on + 0` gives) would render as 'due today' on the day it arrived
    and 'overdue' every day after, for ever. Refusing is louder.
    """
    with pytest.raises(ValueError, match="reply period is set by the notice"):
        compute_due_on(date(2026, 3, 10))


def test_a_deadline_before_the_notice_is_rejected():
    """The commonest data-entry error in this table is a dd/mm swap."""
    with pytest.raises(ValueError, match="precedes received_on"):
        compute_due_on(date(2026, 3, 10), due_on_override=date(2026, 2, 10))


def test_days_and_months_together_are_refused():
    """Postgres applies months before days and the two orders disagree.

    2026-01-30 + (1 month, 1 day) is 2026-03-01 months-first and 2026-02-28
    days-first — measured on the live server. Migration 162 forbids the
    combination in the schema; this refuses it before the INSERT, where a
    caller assembling a window by hand will actually see it.
    """
    with pytest.raises(ValueError, match="days OR months"):
        compute_due_on(date(2026, 1, 30), window_days=1, window_months=1)


# ── the urgency judgement ───────────────────────────────────────────────────

AS_OF = date(2026, 8, 19)


def test_a_notice_due_today_is_critical_and_not_overdue():
    """Zero days left is not late. Replies are filed on the due date routinely.

    A register that calls today's deadline 'overdue' is crying wolf on the one
    band that must stay believable, and a band nobody believes is a band nobody
    reads.
    """
    u = urgency_of(AS_OF, AS_OF)
    assert u.band == CRITICAL
    assert u.days_remaining == 0
    assert describe_urgency(u) == "Due today."


def test_the_band_boundaries_are_where_they_are_documented():
    """2/3 and 7/8 and 30/31, checked on both sides of each edge."""
    def band(days_out):
        return urgency_of(date.fromordinal(AS_OF.toordinal() + days_out), AS_OF).band

    assert band(-1) == OVERDUE
    assert band(0) == CRITICAL
    assert band(2) == CRITICAL
    assert band(3) == URGENT
    assert band(7) == URGENT     # the entire life of a rule 88C window
    assert band(8) == SOON
    assert band(30) == SOON      # the entire life of an ASMT-10 window
    assert band(31) == SCHEDULED


@pytest.mark.parametrize("status", ["replied", "closed", "withdrawn"])
def test_a_stopped_clock_has_no_urgency_however_old(status):
    """A notice replied to in 2023 must not still be counting down in 2026.

    This is the failure that kills a compliance list: it fills with rows that
    are loud and finished, people learn to scroll past the loud rows, and the
    one live emergency scrolls past with them.
    """
    u = urgency_of(date(2023, 1, 1), AS_OF, status=status)
    assert u.band == STOPPED
    assert u.days_remaining is None
    assert describe_urgency(u) == "The clock has stopped."


def test_escalated_outranks_every_overdue_row():
    """An escalated notice is the consequence, not the warning.

    A DRC-01 that became a DRC-07 is worse than a DRC-01 that is merely late,
    even when the late one is later. Rank, not date, has to decide that.
    """
    escalated = urgency_of(date(2026, 8, 18), AS_OF, status="escalated")
    very_late = urgency_of(date(2025, 1, 1), AS_OF, status="open")
    assert escalated.band == ESCALATED
    assert very_late.band == OVERDUE
    assert urgency_rank(escalated.band) < urgency_rank(very_late.band)


def test_working_day_windows_report_themselves_as_conservative():
    """REG-17 gives seven WORKING days; we compute seven calendar days.

    That is earlier than the truth, never later, which is the only direction
    this module may err — but it must SAY so rather than assert a precision it
    does not have. There is no national holiday calendar to have here: a GST
    holiday depends on the state.
    """
    u = urgency_of(date(2026, 8, 24), AS_OF, working_days=True)
    assert u.conservative is True
    assert "working days" in describe_urgency(u)
    assert "later" in describe_urgency(u)


def test_an_open_notice_with_no_date_is_treated_as_due_now():
    """Cannot happen through migration 162's CHECK; if it does, fail loud.

    'We do not know when this is due' on a department notice reads as 'due now'
    and nothing else. The alternative — sorting it to the calm end — is how an
    unknown becomes an unknown nobody looked at.
    """
    u = urgency_of(None, AS_OF)
    assert u.band == OVERDUE
    assert describe_urgency(u) == "No reply date recorded — treat as due now."


def test_overdue_wording_counts_days_not_weeks():
    u = urgency_of(date(2026, 8, 18), AS_OF)
    assert describe_urgency(u) == "Overdue by 1 day."
    u = urgency_of(date(2026, 8, 17), AS_OF)
    assert describe_urgency(u) == "Overdue by 2 days."


# ── the ordering, which is what a partner actually reads ────────────────────

def _row(client, due, status="open", working_days=False):
    return {
        "client_name": client,
        "status": status,
        "urgency": urgency_of(due, AS_OF, status=status, working_days=working_days),
    }


def test_the_list_is_ordered_worst_first_then_soonest():
    """Band first, then due date inside the band, then client name.

    The tie-break on date inside `overdue` is the part that is easy to omit and
    the part that matters most: a notice ninety days past due and one that
    lapsed yesterday are both 'overdue', and only one of them is an emergency.
    """
    rows = [
        _row("Vasudha Textiles", date(2026, 9, 30)),                      # scheduled
        _row("Nandan Exports", date(2026, 5, 1)),                         # overdue, badly
        _row("Bhatt & Co", date(2026, 8, 18)),                            # overdue, just
        _row("Surya Foods", date(2026, 8, 19)),                           # critical
        _row("Meera Logistics", date(2026, 7, 1), status="escalated"),    # escalated
        _row("Anand Steel", date(2026, 6, 1), status="closed"),           # stopped
        _row("Kaveri Mills", date(2026, 8, 25)),                          # urgent
    ]
    got = [r["client_name"] for r in sort_by_urgency(rows)]
    assert got == [
        "Meera Logistics",    # escalated
        "Nandan Exports",     # overdue since May
        "Bhatt & Co",         # overdue since yesterday
        "Surya Foods",        # due today
        "Kaveri Mills",       # 6 days
        "Vasudha Textiles",   # 42 days
        "Anand Steel",        # clock stopped
    ]


def test_ordering_is_stable_on_a_tie_and_never_uses_an_id():
    """Two notices due the same day sort by client name, and stay put.

    A row id would also be a stable tie-break and is deliberately not used: ids
    are never rendered anywhere in this product, and a sort key nobody can see
    is a sort nobody can check.
    """
    rows = [
        _row("Zenith Alloys", date(2026, 8, 21)),
        _row("Ambika Traders", date(2026, 8, 21)),
        _row("Kailash Print", date(2026, 8, 21)),
    ]
    got = [r["client_name"] for r in sort_by_urgency(rows)]
    assert got == ["Ambika Traders", "Kailash Print", "Zenith Alloys"]
    assert got == [r["client_name"] for r in sort_by_urgency(sort_by_urgency(rows))]


def test_sort_does_not_mutate_the_rows_it_was_given():
    rows = [_row("Bhatt & Co", date(2026, 8, 18))]
    before = dict(rows[0])
    sort_by_urgency(rows)
    assert rows[0] == before


def test_every_band_has_a_rank_and_an_unknown_one_raises():
    """A band missing from URGENCY_ORDER must not sort silently to the end.

    Sorting an unrecognised band last is indistinguishable from hiding it, and
    hiding a notice is the single failure this whole register exists to prevent.
    """
    for band in URGENCY_ORDER:
        assert isinstance(urgency_rank(band), int)
    with pytest.raises(ValueError, match="unknown urgency band"):
        urgency_rank("probably_fine")


# ── the arithmetic underneath ───────────────────────────────────────────────

def test_days_remaining_is_signed_and_counts_whole_days():
    assert days_remaining(date(2026, 8, 19), AS_OF) == 0
    assert days_remaining(date(2026, 8, 20), AS_OF) == 1
    assert days_remaining(date(2026, 8, 18), AS_OF) == -1
    # across a month end, in both directions
    assert days_remaining(date(2026, 9, 1), date(2026, 8, 31)) == 1
    assert days_remaining(date(2026, 3, 1), date(2026, 1, 31)) == 29


def test_urgency_carries_the_due_date_it_judged():
    """The band and the date it came from travel together.

    A band without its date is unauditable — a partner told 'urgent' with no
    date cannot tell a wrong window from a wrong clock.
    """
    u = urgency_of(date(2026, 8, 25), AS_OF)
    assert u == NoticeUrgency(URGENT, 6, date(2026, 8, 25), False)


# ── tenancy, which is the only part of this module that can hurt somebody ────
#
# Everything above this line is arithmetic and cannot leak anything. Everything
# below it exists because the arithmetic tests were the whole suite once, and a
# deliberately deleted `r.org_id = $1::uuid` did not disturb a single one of
# them. The bands and the month-ends are what this register gets WRONG; the org
# predicate is what it gets DANGEROUS.

ORG = "3f2b6c10-4a51-4d6e-9f01-2b7c8d9e0a11"
OTHER_ORG = "9c1d5e40-7b32-4a88-b0f5-6e4a2c1d3b77"
CLIENT_A = "11111111-1111-4111-8111-111111111111"


def _register_row(*, org_id=ORG, client_name="Vasudha Textiles", **over):
    """One row shaped exactly like `_SELECT` returns it, `org_id` included.

    `org_id` is in here because the statement selects it — it is read for the
    tenancy guard and dropped before the row is returned. A fixture that omitted
    it would be testing a shape the module never sees.
    """
    row = {
        "org_id": org_id,
        "reference_no": "ZD290824000123",
        "received_on": date(2026, 8, 1),
        "due_on": date(2026, 8, 31),
        "due_date_from_notice": False,
        "window_in_working_days": False,
        "status": "open",
        "replied_on": None,
        "notes": "",
        "client_name": client_name,
        "notice_type": "gst_asmt_10",
        "notice_type_label": "GST ASMT-10 — scrutiny of returns",
        "authority": "gst",
        "form_no": "ASMT-10",
        "reply_form_no": "ASMT-11",
        "statute_ref": "CGST Act s.61; CGST Rules r.99",
        "statute_key": None,
        "window_basis": "statutory_max",
        "consequence": "The scrutiny stops being a question and becomes a demand.",
        "source_url": "https://example.invalid/r99",
        "owner_name": "Priya Nair",
    }
    row.update(over)
    return row


def _type_row(*, org_id=None, code="gst_asmt_10", label="GST ASMT-10"):
    return {
        "org_id": org_id, "code": code, "label": label, "authority": "gst",
        "form_no": "ASMT-10", "reply_form_no": "ASMT-11", "statute_ref": "r.99",
        "statute_key": None, "reply_window_days": 30, "reply_window_months": 0,
        "window_basis": "statutory_max", "window_in_working_days": False,
        "consequence": "becomes a demand", "source_url": "https://example.invalid/r99",
        "is_system": org_id is None,
    }


class TenancyPool:
    """Applies the org predicate to in-memory rows, and NOTHING else.

    It does not simulate a date comparison, a status filter, a LIMIT or an
    ORDER BY, and no test below asks it to: those belong to the database and
    faking them is how a mock comes to certify SQL that does not work
    (`mock_pool_hides_bad_sql`). What it does simulate is the one thing a unit
    test can honestly simulate — whose rows the statement is entitled to see.

    `honour_org=False` is the point of the class. It is the pool behaving
    exactly as the database would if the WHERE clause had been deleted, which
    is a thing a refactor does and a code review misses.
    """

    def __init__(self, rows, *, honour_org=True):
        self.rows = list(rows)
        self.honour_org = honour_org
        self.statements = []

    async def fetch(self, query, *args):
        self.statements.append((query, args))
        org = args[0]
        if not self.honour_org:
            return list(self.rows)
        return [
            r for r in self.rows
            if r["org_id"] is None or str(r["org_id"]).lower() == str(org).lower()
        ]


async def test_another_practices_notice_is_never_returned():
    """Two pools, because only the second one can fail against broken SQL.

    With a pool that honours the predicate, the foreign row is simply absent —
    which a MagicMock could also produce and which therefore proves nothing
    about the statement. With `honour_org=False` the database is behaving as it
    would with the clause deleted, and the module has to notice by itself.
    """
    mine = _register_row(client_name="Vasudha Textiles")
    theirs = _register_row(org_id=OTHER_ORG, client_name="A Rival's Client Pvt Ltd")

    honest = TenancyPool([mine, theirs])
    rows = await notices.open_by_urgency(honest, ORG, as_of=AS_OF)
    assert [r["client_name"] for r in rows] == ["Vasudha Textiles"]

    leaky = TenancyPool([mine, theirs], honour_org=False)
    with pytest.raises(CrossOrgLeak):
        await notices.open_by_urgency(leaky, ORG, as_of=AS_OF)


async def test_the_leak_is_refused_at_every_entry_point():
    """Each function is its own statement, so each needs its own proof.

    `client_history` is the one that matters most and is the easiest to talk
    yourself out of: it already takes a client_id, so a reader assumes the
    client is the scope. It is not — migration 162 could not make the client FK
    composite, so a client_id alone identifies a row in ANY practice.
    """
    theirs = _register_row(org_id=OTHER_ORG, client_name="A Rival's Client Pvt Ltd")
    leaky = TenancyPool([theirs], honour_org=False)

    for call in (
        lambda: notices.open_by_urgency(leaky, ORG, as_of=AS_OF),
        lambda: notices.overdue(leaky, ORG, as_of=AS_OF),
        lambda: notices.client_history(leaky, ORG, CLIENT_A, as_of=AS_OF),
    ):
        with pytest.raises(CrossOrgLeak):
            await call()


async def test_another_practices_private_notice_type_is_refused():
    """A type a practice minted names a department and often a city with it.

    'Sales-tax dept, Nashik — spot verification' tells a rival where a client
    is being looked at. System types (org_id NULL) belong to everybody and must
    still come back — a guard that refused those would empty the catalogue.
    """
    system = _type_row()
    theirs = _type_row(org_id=OTHER_ORG, code="nashik_spot",
                       label="Nashik — spot verification")

    honest = TenancyPool([system, theirs])
    got = await notices.notice_types(honest, ORG)
    assert [r["code"] for r in got] == ["gst_asmt_10"]

    leaky = TenancyPool([system, theirs], honour_org=False)
    with pytest.raises(CrossOrgLeak):
        await notices.notice_types(leaky, ORG)


async def test_every_register_statement_narrows_by_org_in_sql_too():
    """The Python guard is the second line, never the first.

    Without the predicate the database ships every practice's rows over the
    wire before Python throws them away: the leak is then in the query log, in
    the plan, and in this process's memory, even though no user ever saw it.
    This is the assertion the original suite was missing — deleting the clause
    from `client_history` left all 27 of its tests green.
    """
    pool = TenancyPool([])
    await notices.open_by_urgency(pool, ORG, as_of=AS_OF)
    await notices.overdue(pool, ORG, as_of=AS_OF)
    await notices.client_history(pool, ORG, CLIENT_A, as_of=AS_OF)
    assert len(pool.statements) == 3
    for query, args in pool.statements:
        assert "r.org_id" in query and "$1::uuid" in query
        assert args[0] == ORG, "org_id must be the FIRST bound parameter"

    await notices.notice_types(pool, ORG)
    catalogue, args = pool.statements[-1]
    assert "org_id IS NULL OR org_id = $1::uuid" in catalogue
    assert args[0] == ORG


def test_the_client_name_join_is_org_scoped():
    """The leak a WHERE clause on `r` cannot reach.

    Migration 162's client FK is `graha_clients(id)`, not `(org_id, id)`, so
    the database permits a register row pointing at another practice's company.
    On such a row `r.org_id = $1` is satisfied and `c.name` is the other
    practice's client. The value leaks off the JOINED table, so the join is
    where it has to be stopped. dsc.py joins this same table the same way.

    The comments are stripped before the match, and that is not tidiness. The
    first version of this test asserted the substring against the raw statement
    and PASSED with the predicate deleted from the join — because the SQL
    comment that explains the predicate quotes it. A test that a comment can
    satisfy is testing the prose.
    """
    sql = "\n".join(
        line for line in notices._SELECT.splitlines()
        if not line.strip().startswith("--")
    )
    assert re.search(
        r"JOIN\s+staging\.graha_clients\s+c\s+ON\s+c\.id\s*=\s*r\.client_id"
        r"\s+AND\s+c\.org_id\s*=\s*r\.org_id",
        sql,
    ), "the graha_clients join is not org-scoped"


async def test_no_uuid_leaves_this_module():
    """org_id is read for the guard and dropped. Names, not ids.

    Every register read joins out to a name — the client is `client_name`, the
    owner is `owner_name` — and this asserts on the whole returned row rather
    than on a list of columns, so a column ADDED later is caught too.
    """
    pool = TenancyPool([_register_row()])
    rows = await notices.open_by_urgency(pool, ORG, as_of=AS_OF)
    assert rows
    for row in rows:
        assert "org_id" not in row
        for key, value in row.items():
            assert not key.endswith("_id"), f"{key} is an id"
            assert not (isinstance(value, str) and len(value) == 36
                        and value.count("-") == 4), f"{key} looks like a uuid"

    types = await notices.notice_types(TenancyPool([_type_row()]), ORG)
    assert types and all("org_id" not in t for t in types)


async def test_org_id_case_does_not_fake_a_leak():
    """asyncpg returns a lower-case uuid; a JWT claim is often upper-case.

    Comparing them unfolded turns a correct query into a CrossOrgLeak, which is
    a 500 that reads like a security incident and gets escalated as one.
    """
    pool = TenancyPool([_register_row(org_id=ORG.upper())])
    rows = await notices.open_by_urgency(pool, ORG.lower(), as_of=AS_OF)
    assert [r["client_name"] for r in rows] == ["Vasudha Textiles"]


def test_the_statement_reads_org_id_back_for_the_guard():
    """The guard can only fire on a column the SELECT actually returns.

    A pool hands back whatever fixture it was given, so no amount of pool-based
    testing can notice `r.org_id` being dropped from the SELECT list — the
    fixture still has the key and the guard still passes. Deleting that one
    line disables the tenancy guard on every read, and only an assertion
    against the statement itself can see it happen.
    """
    sql = "\n".join(
        line for line in notices._SELECT.splitlines()
        if not line.strip().startswith("--")
    )
    assert re.search(r"SELECT\s+r\.org_id\s*,", sql), (
        "the statement no longer selects r.org_id, so _decorate's tenancy "
        "guard has nothing to check"
    )


async def test_overdue_is_measured_against_as_of_and_never_against_the_server():
    """`CURRENT_DATE` is UTC. Every deadline in this table is an Indian date.

    From 18:30 UTC the two calendars disagree, and they disagree precisely
    about the notices due today: a reply the practice still has hours to file
    in Delhi is already yesterday's in the database. It would also make
    `overdue()` and `open_by_urgency()`, called in the same breath, disagree
    with each other.
    """
    pool = TenancyPool([])
    await notices.overdue(pool, ORG, as_of=AS_OF)
    query, args = pool.statements[-1]
    body = "\n".join(
        line for line in query.splitlines() if not line.strip().startswith("--")
    )
    assert "CURRENT_DATE" not in body.upper(), "the server's clock is not IST"
    assert "$3::date" in body
    assert AS_OF in args, "as_of must be bound, not implied"
