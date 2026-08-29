"""Manav asked the flag, not the fact — and two of its reads then ACTED on it.

`manav_employees.is_active` is a flag somebody has to remember to clear.
`manav_offboarding.last_working_day` is a fact somebody already recorded. In
E2E Test & Associates they disagree by TEN people, whose last working days run
from 2026-07-07 to 2026-08-03 — up to seven weeks before this was written.

**THE FLAG IS NOT STALE DATA.** `routers/manav.py` records above the
offboarding section that exits used to set `is_active=FALSE`, which dropped the
person out of payroll the same day and left an outstanding salary advance
unrecoverable. A leaver therefore KEEPS the flag until settlement, on purpose:
the ten sit at `initiated` (2), `in_clearance` (3), `completed` (2) and
`settled` (3) — a live workflow, not corruption. So the reads are what change,
and they change by reaching for ONE predicate — `services.on_the_rolls` — so
that twenty-five hand-written variants cannot drift apart again.

WHAT THE TEN WERE COSTING, measured read-only against the shared
staging/production database on 2026-08-26, org 64e7bea6:

    POST /manav/announcements — employees emailed .......... 83 → 73
      ...of the ten dropped, how many hold an address ....... 10 of 10
    POST /manav/assets/{id}/assign — assignable employees ... 83 → 73
      ...company assets currently issued to the ten .......... 8
    GET  /manav/employees (the directory) .................. 83 → 73
    GET  /manav/stats total_employees ...................... 83 → 73
    GET  /manav/schedules/coverage total_employees ......... 83 → 73
    GET  /manav/employees/awaiting-link ................... 83 → 73
    GET  /manav/departments employee_count ..... Accounts 8→6, Payroll 8→6,
                Compliance 8→7, Taxation 8→7, Administration/Audit/Advisory/IT 7→6
    GET  /manav/leaves/check-conflicts department_size ..... the same per-dept
                figures; the CONFLICT LIST itself moves by 0 rows today (all 24
                leave requests belonging to the ten ended before their exits).

The first two are not reports. One SENDS INTERNAL MAIL to ten ex-employees
every time an announcement is posted; the other HANDS COMPANY PROPERTY to
somebody who has left. They are tested behaviourally below — at the mailer and
at the refusal — rather than by reading their SQL.

WHY NOTHING IS SEEDED
---------------------
Staging and production share one Supabase database (CLAUDE.md, "The one
dangerous fact"), so seeding a leaver would write a `manav_offboarding` row
into production. Nothing in this file writes anything anywhere. The offline
half drives the real handlers against a pool that answers according to the
predicate each statement actually states; the live half parses those statements
against the real catalogue and counts real rows, read-only.

The live half SKIPS with no database. Run it with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_manav_reads_who_is_on_the_rolls.py -q
"""
import asyncio
import inspect
import os
import re
from datetime import date

import pytest

from routers import manav
from services.on_the_rolls import still_on_the_rolls

#: The two organisations in scope. Everything above was measured over these.
E2E = "64e7bea6-6abe-490c-a2a4-27a60c6be916"
UNICODE = "fae87907-2f99-4b35-a241-c94d9e1e4a17"
IN_SCOPE = (E2E, UNICODE)

#: Whatever the database would call CURRENT_DATE when these statements run.
TODAY = date.today()

#: An HR admin. Manav is not a separated-duty module, so this one level
#: satisfies viewer, editor and admin — every gate on the sites below.
HR_ADMIN = frozenset({"admin"})
USER = {"user_id": "user_hr_admin"}

#: An offboarding row that exists and names no last working day — a distinct
#: sentinel rather than None, because "no exit row" and "an exit nobody has
#: dated" are different facts and only the second is a question about NULL.
UNDATED = object()

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. These checks parse Manav's SQL against the real "
    "catalogue and count real leavers; neither can be done offline. Run them "
    "with:\n    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_manav_reads_who_is_on_the_rolls.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def norm(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


# ══════════════════════════════════════════════════════════════════════════
#  The people
# ══════════════════════════════════════════════════════════════════════════

def emp(eid, exit_day, *, dept="Accounts", email=None):
    return {
        "id": eid,
        "employee_code": eid.upper(),
        "name": eid.replace("-", " ").title(),
        "email": email if email is not None else f"{eid}@e2e.example",
        "phone": "",
        "department": dept,
        "designation": "Associate",
        "employment_type": "full_time",
        "status": "active",
        "date_of_joining": date(2024, 1, 1),
        "shift": "",
        "created_at": None,
        "user_id": None,
        "state": "27",
        "created_by": None,
        "updated_by": None,
        "exit": exit_day,
    }


STAYER = emp("stayer", None)
#: The E2E leaver with the most recent exit: last working day 2026-08-03,
#: offboarding `settled`, still carrying `is_active=TRUE`.
LEAVER = emp("leaver", date(2026, 8, 3))
#: Serving notice. An exit dated in the future is not an exit yet, and this
#: person is still on the rolls, still gets the announcement, still gets a
#: laptop issued to them.
ON_NOTICE = emp("on-notice", date(2099, 1, 1))
#: The last working day IS today. They were on the rolls today.
LAST_DAY_TODAY = emp("last-day", TODAY)
#: An exit somebody started and nobody dated.
UNDATED_EXIT = emp("undated", UNDATED)

EVERYONE = [STAYER, LEAVER, ON_NOTICE, LAST_DAY_TODAY, UNDATED_EXIT]
#: Everyone the guard must keep. Only `LEAVER` may disappear.
KEPT = [STAYER, ON_NOTICE, LAST_DAY_TODAY, UNDATED_EXIT]


def _guard_applies(sql: str) -> bool:
    """Does this statement actually ASK about the offboarding table?

    Deliberately not a second implementation of the guard — it enforces what
    the SQL says, so these tests answer "does the query ask?". Whether the
    database agrees is what the live half is for.
    """
    return "public.manav_offboarding x" in sql


def _survivors(sql: str, employees) -> list[dict]:
    """Everyone the statement's OWN conditions admit.

    Two conditions are modelled — the leaver guard and the pre-existing
    "has an address" test on the announcement recipients — and each is applied
    only when the SQL states it. A fake that applied a filter the query does
    not carry would prove a guard that is not there.
    """
    out = list(employees)
    if "email != ''" in sql:
        out = [e for e in out if e["email"]]
    if _guard_applies(sql):
        out = [e for e in out
               if not (e["exit"] is not None and e["exit"] is not UNDATED
                       and e["exit"] < TODAY)]
    return out


# ══════════════════════════════════════════════════════════════════════════
#  The pool — records every statement, answers employees honestly
# ══════════════════════════════════════════════════════════════════════════

class _Pool:
    """A MagicMock answers one canned value to every query, which is exactly how
    a filter that is not there gets "proved". This routes on the SQL instead.
    """

    def __init__(self, employees=EVERYONE, *, asset=None):
        self.statements: list[tuple[str, tuple]] = []
        self._employees = list(employees)
        self._asset = asset or {"id": "asset-1", "name": "MacBook Air",
                                "asset_type": "laptop"}

    # ── plumbing ─────────────────────────────────────────────────────────
    def _record(self, sql, args):
        self.statements.append((norm(sql), args))

    # ── the database ─────────────────────────────────────────────────────
    async def fetch(self, sql, *args):
        self._record(sql, args)
        n = norm(sql)
        if "FROM public.manav_departments d" in n:
            return [{"id": "dept-1", "name": "Accounts", "created_at": None,
                     "head_name": "Stayer",
                     "employee_count": len(_survivors(n, self._employees))}]
        if "FROM public.manav_leave_requests lr" in n:
            rows = []
            for e in _survivors(n, self._employees):
                if e is STAYER:
                    continue
                rows.append({"id": f"lr-{e['id']}", "start_date": TODAY,
                             "end_date": TODAY, "days": 1, "status": "approved",
                             "employee_name": e["name"],
                             "employee_code": e["employee_code"]})
            return rows
        if "FROM public.manav_schedules s" in n:
            return []
        if "public.manav_employees" in n:
            rows = _survivors(n, self._employees)
            return [dict(e, _total=len(rows)) for e in rows]
        raise AssertionError(f"unexpected fetch: {n[:160]}")

    async def fetchval(self, sql, *args):
        self._record(sql, args)
        n = norm(sql)
        if "public.manav_employees" in n:
            return len(_survivors(n, self._employees))
        return 0

    async def fetchrow(self, sql, *args):
        self._record(sql, args)
        n = norm(sql)
        if "INSERT INTO public.manav_announcements" in n:
            return {"id": "ann-1", "title": args[1]}
        if "UPDATE public.manav_assets" in n:
            return dict(self._asset)
        if "public.manav_employees" in n:
            wanted = str(args[0])
            for e in _survivors(n, self._employees):
                if e["id"] == wanted:
                    return dict(e)
            return None
        raise AssertionError(f"unexpected fetchrow: {n[:160]}")

    async def execute(self, sql, *args):
        self._record(sql, args)
        return "UPDATE 1"


@pytest.fixture
def pool(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(manav, "get_pool", _get_pool)
    return p


def run(coro):
    return asyncio.run(coro)


# ══════════════════════════════════════════════════════════════════════════
#  THE TWO THAT ACT. Tested at the act, not at the SQL.
# ══════════════════════════════════════════════════════════════════════════

class TestAnnouncementsStopMailingPeopleWhoHaveLeft:
    """The worst read in the sweep. Every announcement posted in E2E was
    emailed to ten ex-employees, all ten of whom hold an address."""

    def _post(self, pool, monkeypatch):
        sent: list[str] = []
        import services.employee_email as mailer
        monkeypatch.setattr(
            mailer, "send_announcement_email",
            lambda to, name, title, body, org_name="": sent.append(to))
        run(manav.create_announcement(
            manav.AnnouncementCreate(title="Diwali holiday", body="Closed."),
            user=USER, org_id=E2E, levels=HR_ADMIN))
        return sent

    def test_a_leaver_is_not_emailed(self, pool, monkeypatch):
        sent = self._post(pool, monkeypatch)
        assert LEAVER["email"] not in sent, (
            "an internal announcement was emailed to somebody whose last "
            "working day was 2026-08-03. Ten E2E ex-employees receive every "
            "one of these today.")

    def test_everybody_still_on_the_rolls_is_emailed(self, pool, monkeypatch):
        """The guard narrows the list to the people who have left and nobody
        else — somebody serving notice, somebody on their last day and somebody
        whose exit nobody has dated all still work here."""
        sent = self._post(pool, monkeypatch)
        assert sorted(sent) == sorted(e["email"] for e in KEPT)

    def test_an_employee_with_no_address_is_still_not_mailed(self, monkeypatch):
        """The pre-existing `email <> ''` condition survives the rewrite. It is
        the reason `send_announcement_email` is never called with an empty
        recipient, and appending a predicate is how such a clause gets lost."""
        p = _Pool([STAYER, emp("no-address", None, email="")])

        async def _get_pool():
            return p
        monkeypatch.setattr(manav, "get_pool", _get_pool)
        sent = self._post(p, monkeypatch)
        assert sent == [STAYER["email"]]


class TestAssetsAreNotIssuedToPeopleWhoHaveLeft:
    """Eight company assets are currently assigned to the ten. This is the
    route that assigned them and it would assign a ninth today."""

    def _assign(self, pool, monkeypatch, employee_id):
        import services.employee_email as mailer
        monkeypatch.setattr(mailer, "send_asset_email",
                            lambda *a, **k: None)
        return run(manav.assign_asset(
            "asset-1", manav.AssetAssign(employee_id=employee_id),
            user=USER, org_id=E2E, levels=HR_ADMIN))

    def test_assigning_to_a_leaver_is_refused(self, pool, monkeypatch):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            self._assign(pool, monkeypatch, LEAVER["id"])
        assert exc.value.status_code == 404, (
            "company property was handed to somebody who left on 2026-08-03")

    def test_nothing_is_written_when_it_is_refused(self, pool, monkeypatch):
        """The refusal has to land BEFORE the UPDATE. A 404 raised after the
        write would leave the asset issued and the caller told it was not."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            self._assign(pool, monkeypatch, LEAVER["id"])
        assert not any("UPDATE public.manav_assets" in s
                       for s, _ in pool.statements), pool.statements

    def test_somebody_serving_notice_can_still_be_issued_an_asset(
            self, pool, monkeypatch):
        """They are still working. Refusing here would be the flag's mistake
        made in the other direction."""
        assert self._assign(pool, monkeypatch, ON_NOTICE["id"])["id"] == "asset-1"

    def test_an_ordinary_employee_is_unaffected(self, pool, monkeypatch):
        assert self._assign(pool, monkeypatch, STAYER["id"])["id"] == "asset-1"


# ══════════════════════════════════════════════════════════════════════════
#  The stocks — counts, directories, denominators
# ══════════════════════════════════════════════════════════════════════════

def test_the_directory_lists_who_is_on_the_rolls(pool):
    """83 rows in E2E, 73 of them people who still work there."""
    out = run(manav.list_employees(user=USER, org_id=E2E, levels=HR_ADMIN))
    ids = [r["id"] for r in out["data"]]
    assert LEAVER["id"] not in ids, (
        "the employee directory still lists ten people who have left E2E")
    assert ids == [e["id"] for e in KEPT]
    assert out["total"] == len(KEPT), (
        "the window total counts rows the directory does not show, so the "
        "'showing N of M' strip disagrees with itself")


def test_department_headcount_counts_who_is_on_the_rolls(pool):
    out = run(manav.list_departments(user=USER, org_id=E2E, levels=HR_ADMIN))
    assert out["data"][0]["employee_count"] == len(KEPT), (
        "a department's headcount still includes leavers — live, Accounts "
        "and Payroll each read 8 against a true 6")


def test_the_department_delete_guard_counts_who_is_on_the_rolls(pool):
    """The number in the refusal has to be a number the directory would also
    show, or an admin is told a department holds staff they cannot find in it.
    """
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        run(manav.delete_department("dept-1", user=USER, org_id=E2E,
                                    levels=HR_ADMIN))
    assert exc.value.status_code == 400
    assert f"{len(KEPT)} active employee(s)" in exc.value.detail, (
        "the refusal counts people who have left: " + exc.value.detail)


def test_a_department_only_leavers_remain_in_can_be_closed(monkeypatch):
    """The other half of the same guard, and the one an admin actually hits.
    On the flag alone a department every one of whose members has gone can
    never be closed — the refusal cites staff who do not work there."""
    p = _Pool([LEAVER])

    async def _get_pool():
        return p
    monkeypatch.setattr(manav, "get_pool", _get_pool)

    out = run(manav.delete_department("dept-1", user=USER, org_id=E2E,
                                      levels=HR_ADMIN))
    assert out == {"status": "deleted"}


def test_stats_headcount_counts_who_is_on_the_rolls(pool):
    out = run(manav.hrms_stats(user=USER, org_id=E2E, levels=HR_ADMIN))
    assert out["total_employees"] == len(KEPT), (
        "the HR dashboard tile reads 83 against a true 73")


def test_the_leave_conflict_denominator_counts_who_is_on_the_rolls(pool):
    """`department_size` is the denominator of the >30% understaffing warning.
    Counting leavers in it makes every department look better covered than it
    is — live, Accounts and Payroll are each a quarter smaller (8 → 6) than
    this read them."""
    out = run(manav.check_leave_conflicts(
        employee_id=STAYER["id"], start_date=TODAY.isoformat(),
        end_date=TODAY.isoformat(), user=USER, org_id=E2E, levels=HR_ADMIN))
    assert out["department_size"] == len(KEPT)


def test_the_colleagues_on_leave_list_names_only_colleagues(pool):
    """Who else is away that week. Somebody who has left is not away — they are
    gone, and their old approved leave is not a staffing conflict with a
    request being made now.

    This is the one site in the sweep that moves NO live row today: all 24
    leave requests belonging to E2E's ten ended before their own last working
    days, so none overlaps a window on or after an exit. It is guarded anyway
    — the exposure is one approved-leave-through-notice away, and a numerator
    and a denominator that disagree about who counts make the ratio above
    them stop meaning anything.
    """
    out = run(manav.check_leave_conflicts(
        employee_id=STAYER["id"], start_date=TODAY.isoformat(),
        end_date=TODAY.isoformat(), user=USER, org_id=E2E, levels=HR_ADMIN))
    names = [c["employee_name"] for c in out["conflicts"]]
    assert LEAVER["name"] not in names
    assert out["conflict_count"] == len(names)


def test_schedule_coverage_counts_who_is_on_the_rolls(pool):
    """`total_employees` is what a day's assigned count is compared against, so
    an inflated denominator reports every single day as under-staffed."""
    out = run(manav.schedule_coverage(
        date_from=TODAY.isoformat(), date_to=TODAY.isoformat(),
        user=USER, org_id=E2E, levels=HR_ADMIN))
    assert out["total_employees"] == len(KEPT)


def test_the_awaiting_link_queue_counts_who_is_on_the_rolls(pool):
    """An enrolment queue. Offering to give a login to somebody who left is
    offering an action nobody wants taken, and it inflates the denominator of
    "12 of 98 done" — the one number this screen exists to state."""
    out = run(manav.list_employees_awaiting_link(
        user=USER, org_id=E2E, levels=HR_ADMIN))
    assert LEAVER["id"] not in [r["id"] for r in out["data"]]
    assert out["counts"]["awaiting_link"] == len(KEPT)


# ══════════════════════════════════════════════════════════════════════════
#  One predicate, not twenty-five
# ══════════════════════════════════════════════════════════════════════════

#: The alias a statement's guard is written against, pulled back out of the
#: statement itself. Two aliases are legitimately in play — `e` almost
#: everywhere, `de` in the department-count subquery where `e` is already the
#: department HEAD's row — so the check below rebuilds the expected fragment
#: for the alias each statement actually used rather than assuming one.
_ALIAS = re.compile(r"manav_offboarding x WHERE x\.org_id = (\w+)\.org_id")


def exercise_every_guarded_site(p, monkeypatch):
    """Call every rewritten handler once, so `p.statements` holds them all.

    `delete_department` REFUSES here and that is the correct outcome — four of
    the five fake employees are still on the rolls. Its count statement has
    already been issued and recorded by then, which is what this helper is
    collecting; the refusal itself is asserted on in its own test above.
    """
    from fastapi import HTTPException
    import services.employee_email as mailer
    monkeypatch.setattr(mailer, "send_announcement_email", lambda *a, **k: None)
    monkeypatch.setattr(mailer, "send_asset_email", lambda *a, **k: None)

    run(manav.create_announcement(
        manav.AnnouncementCreate(title="t", body="b"),
        user=USER, org_id=E2E, levels=HR_ADMIN))
    run(manav.list_employees(user=USER, org_id=E2E, levels=HR_ADMIN))
    run(manav.list_departments(user=USER, org_id=E2E, levels=HR_ADMIN))
    try:
        run(manav.delete_department("dept-1", user=USER, org_id=E2E,
                                    levels=HR_ADMIN))
    except HTTPException:
        pass
    run(manav.hrms_stats(user=USER, org_id=E2E, levels=HR_ADMIN))
    run(manav.check_leave_conflicts(
        employee_id=STAYER["id"], start_date=TODAY.isoformat(),
        end_date=TODAY.isoformat(), user=USER, org_id=E2E, levels=HR_ADMIN))
    run(manav.schedule_coverage(
        date_from=TODAY.isoformat(), date_to=TODAY.isoformat(),
        user=USER, org_id=E2E, levels=HR_ADMIN))
    run(manav.list_employees_awaiting_link(
        user=USER, org_id=E2E, levels=HR_ADMIN))
    run(manav.assign_asset(
        "asset-1", manav.AssetAssign(employee_id=STAYER["id"]),
        user=USER, org_id=E2E, levels=HR_ADMIN))
    return p


def test_every_site_uses_the_shared_predicate_verbatim(pool, monkeypatch):
    """Twenty-five hand-written copies is the failure `services.on_the_rolls`
    exists to prevent, so the check is on the EXACT fragment the module emits,
    not on "contains manav_offboarding". A variant that drops
    `status <> 'cancelled'` or joins on the employee id alone would pass a
    looser assertion and be a different bug.
    """
    exercise_every_guarded_site(pool, monkeypatch)

    guarded = [s for s, _ in pool.statements if "manav_offboarding" in s]
    assert guarded, "not one Manav read asks about the offboarding table"

    for sql in guarded:
        found = _ALIAS.search(sql)
        assert found, (
            "this statement names the offboarding table without the shared "
            "predicate's shape around it:\n  " + sql[:220])
        assert norm(still_on_the_rolls(found.group(1))) in sql, (
            "this statement writes its own leaver predicate instead of "
            "appending `still_on_the_rolls(...)`. Twenty-five hand-written "
            "copies is the whole reason that module exists:\n  " + sql[:220])


def test_the_router_never_writes_its_own_copy_of_the_predicate():
    """A grep, so a future site cannot quietly inline a twenty-sixth variant."""
    src = inspect.getsource(manav)
    assert src.count("manav_offboarding x") == 0, (
        "routers/manav.py names the offboarding alias directly. The predicate "
        "comes from services.on_the_rolls and nowhere else.")
    assert "still_on_the_rolls" in src


def test_no_flow_query_was_guarded():
    """STOCK carries the guard; FLOW must not. An ex-employee's July salary was
    still paid in July, and their July attendance still happened — adding the
    guard to a query over a PERIOD rewrites history.

    Named explicitly because they sit next to the sites that DO change:
    `list_attendance`, `attendance_summary` and `performance_summary` all read
    per-day rows over a date range and all still see everybody.
    """
    for fn in (manav.list_attendance, manav.attendance_summary,
               manav.performance_summary):
        src = inspect.getsource(fn)
        assert "still_on_the_rolls" not in src, (
            f"{fn.__name__} is a FLOW — it reports what happened in a period. "
            "Guarding it deletes the attendance of everybody who has since "
            "left, for the months in which they were working.")


def test_self_scope_is_deliberately_not_guarded():
    """`_own_employee_id` answers "which employee row is me", and that does not
    stop being true the day somebody's notice runs out.

    The flag is kept until SETTLEMENT precisely so a leaver stays in payroll
    long enough for an advance to be recovered — two of E2E's ten carry
    advances totalling ₹1,15,000. Guarding this would revoke, on the day after
    the last working day, the leaver's read of their own attendance, own leave,
    own assets to return and own bonus awards: exactly the mid-settlement
    cut-off the `is_active` behaviour was designed to prevent, applied to the
    person rather than to payroll.

    Zero of E2E's 83 employee records carry a `user_id` today, so no leaver can
    reach any of it in any case. This test is here so the decision is a
    decision and not an oversight — if it is reversed, reverse it on purpose.
    """
    # The BODY, not the source: the function's own docstring argues this at
    # length and names the predicate it does not use, so a substring test over
    # the whole source would only ever find the explanation.
    body = inspect.getsource(manav._own_employee_id).split('"""')[2]
    assert "still_on_the_rolls" not in body, (
        "self scope is now closed the day after somebody's last working day. "
        "That is a product decision, not a sweep — see this test's docstring.")
    assert "is_active=TRUE" in body


# ══════════════════════════════════════════════════════════════════════════
#  Live — parse against the real catalogue, count real rows. READ ONLY.
# ══════════════════════════════════════════════════════════════════════════

def live(work):
    """One event loop per call: asyncpg binds a connection to the loop that
    made it. A connection failure SKIPS; anything `work` raises propagates."""
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    import asyncpg

    async def run_it():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except Exception as exc:                              # noqa: BLE001
            return False, exc
        try:
            await conn.execute(_SEARCH_PATH)
            return True, await work(conn)
        finally:
            await conn.close()

    reached, value = asyncio.run(run_it())
    if not reached:
        pytest.skip(f"could not reach the database: {value}\n\n{SKIP_REASON}")
    return value


def _captured_guarded_sql(monkeypatch) -> list[str]:
    """Every statement the rewritten handlers issue that names the guard —
    captured from the real handlers rather than retyped here, so what the live
    half parses is exactly what production sends."""
    p = _Pool()

    async def _get_pool():
        return p
    monkeypatch.setattr(manav, "get_pool", _get_pool)
    exercise_every_guarded_site(p, monkeypatch)
    return [s for s, _ in p.statements if "manav_offboarding" in s]


def test_live_every_rewritten_statement_parses(monkeypatch):
    """THE ONE THING A MOCK POOL CANNOT PROVE. `prepare()` sends Parse and
    Describe and stops: the server plans the statement and resolves every
    relation, column and parameter type. No row is read and none is written —
    which matters, because this is production's database as well as staging's.
    """
    statements = _captured_guarded_sql(monkeypatch)
    assert len(statements) >= 9, (
        f"only {len(statements)} Manav statements carry the guard; the sweep "
        "names nine sites plus the two that act")

    async def work(conn):
        for sql in statements:
            await conn.prepare(sql)
        return len(statements)

    assert live(work) == len(statements)


def test_live_the_guard_removes_exactly_the_people_who_have_left():
    """PROVED ON REAL ROWS, WITHOUT WRITING ONE.

    Runs the flag-only count and the guarded one side by side over both
    in-scope orgs and asserts three things about the difference: everyone it
    drops holds a non-cancelled exit dated before today; nobody it keeps does;
    and it drops somebody — otherwise the test passes with the guard deleted.

    Measured when written: E2E 83 → 73; Unicode 26 → 26, because its one leaver
    was ALSO deactivated by hand. That comparison is the shape of the whole
    defect — the guard held exactly where a person remembered to apply it.
    """
    guarded = ("SELECT e.id FROM public.manav_employees e "
               "WHERE e.org_id=$1::uuid AND e.is_active=TRUE"
               + still_on_the_rolls("e"))
    flag_only = ("SELECT e.id FROM public.manav_employees e "
                 "WHERE e.org_id=$1::uuid AND e.is_active=TRUE")

    async def work(conn):
        out = []
        for org in IN_SCOPE:
            kept = {r["id"] for r in await conn.fetch(guarded, org)}
            everyone = {r["id"] for r in await conn.fetch(flag_only, org)}
            left = {r["employee_id"] for r in await conn.fetch(
                "SELECT DISTINCT employee_id FROM public.manav_offboarding "
                " WHERE org_id=$1::uuid AND status <> 'cancelled' "
                "   AND last_working_day < CURRENT_DATE", org)}
            out.append((org, kept, everyone, left))
        return out

    dropped_total = 0
    for org, kept, everyone, left in live(work):
        dropped = everyone - kept
        dropped_total += len(dropped)
        assert dropped <= left, (
            f"org {org}: the guard dropped {len(dropped - left)} people who "
            "hold no past exit date — it is removing the wrong rows")
        assert not (kept & left), (
            f"org {org}: {len(kept & left)} people whose last working day has "
            "passed are still counted as on the rolls")
    assert dropped_total > 0, (
        "the guard removed nobody in either org, so this test would pass with "
        "it deleted. Ten E2E employees held a past exit date on 2026-08-26; "
        "if they have since been deactivated, say so here rather than "
        "deleting the assertion.")


def test_live_the_ten_were_really_being_emailed_and_really_hold_assets():
    """What the two harmful sites were actually costing, counted rather than
    asserted about. Nothing is deleted or unassigned — the eight assets are the
    owner's to reclaim; this only proves the reads were wrong."""
    async def work(conn):
        return await conn.fetchrow(
            "WITH leavers AS ("
            "  SELECT e.id, e.email FROM public.manav_employees e "
            "    JOIN public.manav_offboarding x "
            "      ON x.org_id = e.org_id AND x.employee_id = e.id "
            "     AND x.status <> 'cancelled' "
            "   WHERE e.org_id = $1::uuid AND e.is_active = TRUE "
            "     AND x.last_working_day < CURRENT_DATE) "
            "SELECT (SELECT COUNT(*) FROM leavers) AS leavers, "
            "       (SELECT COUNT(*) FROM leavers "
            "         WHERE email IS NOT NULL AND email <> '') AS mailable, "
            "       (SELECT COUNT(*) FROM public.manav_assets a "
            "         WHERE a.org_id = $1::uuid AND a.is_active = TRUE "
            "           AND a.assigned_to IN (SELECT id FROM leavers)) AS assets",
            E2E)

    row = live(work)
    assert row["leavers"] > 0, (
        "E2E holds no flagged leaver any more; this measurement is stale. Ten "
        "existed on 2026-08-26 — re-measure rather than deleting the check.")
    assert row["mailable"] == row["leavers"], (
        f"{row['leavers'] - row['mailable']} of the leavers now hold no email "
        "address, so the announcement figure in this file's header has moved")
    assert row["assets"] > 0, (
        "no company asset is issued to a leaver any longer — eight were on "
        "2026-08-26")
