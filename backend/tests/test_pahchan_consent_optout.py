"""Pahchan consent capture and the opt-out attendance path — Phase 4.2.

── WHAT IS UNDER TEST, AND WHY IT NEEDED A LIVE HALF ────────────────────────

Four new statements in `routers/pahchan.py`, three of which touch a table this
router had never written to:

    POST /v1/pahchan/consent/me        INSERT staging.pahchan_employee_consents
    GET  /v1/pahchan/consent/roster    SELECT, three-way LEFT JOIN + LATERAL
    POST /v1/pahchan/attendance/manual INSERT staging.manav_attendance
    GET  /v1/pahchan/attendance/manual SELECT, LATERAL on the consent table

`tests/conftest.py` hands every module a MagicMock pool, and a MagicMock
answers happily to an INSERT naming a column that is not there — which is how
`client_billing.py` shipped two INSERTs that had never once succeeded. So the
offline half here proves only what the router BUILDS, and everything about
whether those statements can run is checked against the real catalogue.

── THE THREE CONSTRAINTS THAT DECIDE WHETHER ANY OF THIS WORKS ──────────────

Measured read-only on the live database 2026-08-26, and each is asserted below
from `pg_constraint` rather than from a migration file:

  1. `pahchan_employee_consents_method_check` admits 'self_acknowledged'.
     Migration 209 declares it and `EmployeeConsentBody`'s pattern —
     `^(paper|verbal_witnessed)$` — could never write it. `POST /consent/me` is
     the first and only route that does, so if that value were ever dropped
     from the CHECK the employee's own answer would 500 and nothing else would.

  2. `manav_attendance_marked_by_check` admits 'manual' and does NOT admit
     'pahchan'. The second half is not this router's business but it is why
     the first half is written the way it is — see the finding at the foot of
     this file.

  3. `pahchan_attendance.py`'s publish upsert carries
     `WHERE staging.manav_attendance.marked_by IS DISTINCT FROM 'manual'`, and
     that clause is the ONLY thing that stops a nightly publish overwriting a
     day recorded on the opt-out path. `attendance_bridge.MARKED_BY_MANUAL` is
     the constant behind it, and `_MARKED_BY_MANUAL` in this router is a
     separate literal. `test_the_opt_out_row_uses_the_value_the_bridge_protects`
     pins the two together, because if they ever part company an opted-out
     employee's attendance is silently reverted and nothing fails.

── NOTHING HERE WRITES A ROW ────────────────────────────────────────────────

Staging and production share one Supabase database. The offline half drives the
handlers with a pool that records statements and answers from a script; the
live half calls `asyncpg.Connection.prepare()`, which sends Parse and Describe
and stops. Pattern and reasoning: `tests/test_client_billing_invoices.py`.

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_pahchan_consent_optout.py -q
"""
import asyncio
import os
import pathlib
import re
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException

import routers.pahchan as pahchan
from services.attendance_bridge import MARKED_BY_MANUAL


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
EMPLOYEE = "22222222-2222-2222-2222-222222222222"
ACTOR = "user_admin001"

EMPLOYEE_ROW = {"id": EMPLOYEE, "name": "A Person", "employment_type": "full_time"}
#: What `record_manual_attendance` selects — deliberately narrower, and the
#: needle below relies on the two SELECT lists differing.
EMPLOYEE_NARROW = {"id": EMPLOYEE, "name": "A Person"}

CONSENT_ROW = {
    "notice_version": pahchan.PAHCHAN_NOTICE_VERSION,
    "method": "self_acknowledged",
    "consented": False,
    "recorded_at": datetime(2026, 8, 26, tzinfo=timezone.utc),
    "note": None,
}

ATTENDANCE_ROW = {
    "id": "33333333-3333-3333-3333-333333333333",
    "date": date(2026, 8, 26),
    "status": "present",
    "work_hours": 9.0,
    "notes": "Recorded without biometrics — employee declined.",
}


# ── needles ──────────────────────────────────────────────────
# Each names exactly one statement. `_EMP_FULL` and `_EMP_NARROW` differ only
# in their SELECT list, which is what keeps them distinguishable.

_EMP_FULL = "SELECT id, name, employment_type FROM public.manav_employees"
_EMP_NARROW = "SELECT id, name FROM public.manav_employees"
_ROLES = "SELECT 1 FROM public.user_roles"
_OPTED_OUT = "SELECT consented FROM public.pahchan_employee_consents"

#: What `_employee_opted_out` reads: the `consented` COLUMN of the newest row,
#: not a boolean meaning "opted out". It answers `latest is False`, so `False`
#: is a person who declined, `True` is a person who agreed and `None` is a
#: person nobody has asked. Scripting the wrong one of those inverts the test
#: and it still passes for the wrong reason, which is why they are named.
DECLINED = False
AGREED = True
NEVER_ASKED = None
_LATEST = "SELECT notice_version, method, consented, recorded_at, note"
_CONSENT_INSERT = "INSERT INTO public.pahchan_employee_consents"
_ATTENDANCE_INSERT = "INSERT INTO public.manav_attendance"
_ROSTER = "COUNT(r.id) FILTER (WHERE r.approved_at IS NOT NULL) AS approved_refs"
_MANUAL_LIST = "FROM public.manav_attendance a"
_PUNCH_INSERT = "INSERT INTO public.pahchan_punches"


# ── the capture pool ─────────────────────────────────────────

class CapturePool:
    """Records every statement and its arguments; answers from a script.

    Holds no connection, so nothing reached through it can touch the shared
    database. Same shape as `test_client_billing_invoices.CapturePool`.
    """

    def __init__(self, script=None):
        self.script = script or []
        self.calls = []

    def _answer(self, sql, default):
        for needle, value in self.script:
            if needle in sql:
                return value
        return default

    def _record(self, sql, args):
        self.calls.append((sql, args))

    def statements(self):
        return [sql for sql, _ in self.calls]

    def one(self, needle):
        hits = [c for c in self.calls if needle in c[0]]
        assert len(hits) == 1, (
            f"expected exactly one statement containing {needle!r}, "
            f"found {len(hits)}")
        return hits[0]

    async def fetch(self, sql, *args, **kw):
        self._record(sql, args)
        return self._answer(sql, [])

    async def fetchrow(self, sql, *args, **kw):
        self._record(sql, args)
        return self._answer(sql, None)

    async def fetchval(self, sql, *args, **kw):
        self._record(sql, args)
        return self._answer(sql, None)

    async def execute(self, sql, *args, **kw):
        self._record(sql, args)
        return "INSERT 0 1"

    def acquire(self):
        pool = self

        class _Acquired:
            async def __aenter__(self):
                return pool

            async def __aexit__(self, *exc):
                return False

        return _Acquired()

    def transaction(self, **kw):
        return self.acquire()


class AuditLog:
    """Stands in for `services.audit.emit`.

    Swapped in rather than left alone because the real one calls
    `asyncio.ensure_future(_write(...))`, which would reach the pool and put
    statements this file did not issue into `calls`. Recording them also lets
    the consent events be asserted: a withdrawal changes what may lawfully be
    stored about somebody and is the loudest thing this module writes.
    """

    def __init__(self):
        self.events = []

    def __call__(self, action, request=None, **kw):
        self.events.append((action, kw))

    def actions(self):
        return [a for a, _ in self.events]


def drive(script, coro_factory, *, expect=None):
    """Run one handler against a CapturePool. Returns (pool, audit, result).

    `expect` is an HTTP status to require; the result is then the raised
    `HTTPException`.
    """
    import db

    async def run():
        pool = CapturePool(script)
        log = AuditLog()
        original_pool, db._pool = db._pool, pool
        original_audit, pahchan.audit = pahchan.audit, log
        try:
            try:
                result = await coro_factory()
            except HTTPException as exc:
                if expect is None:
                    raise
                assert exc.status_code == expect, (
                    f"expected {expect}, got {exc.status_code}: {exc.detail}")
                return pool, log, exc
            assert expect is None, f"expected {expect}, but the call succeeded"
            return pool, log, result
        finally:
            db._pool = original_pool
            pahchan.audit = original_audit

    return asyncio.run(run())


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The employee's own answer
# ══════════════════════════════════════════════════════════════════════════════

SELF_CONSENT_SCRIPT = [
    (_EMP_FULL, EMPLOYEE_ROW),
    (_CONSENT_INSERT, CONSENT_ROW),
]


def _self_consent(consented=False):
    return pahchan.record_own_consent(
        body=pahchan.SelfConsentBody(consented=consented),
        request=None, user={"user_id": ACTOR}, org_id=ORG, _g=None,
    )


def test_the_employee_writes_the_method_no_other_route_can():
    """`self_acknowledged` is in migration 209's CHECK and was unreachable.

    `EmployeeConsentBody.method` is `^(paper|verbal_witnessed)$`, so the only
    endpoint that inserted into this table refused the very value the schema
    calls the strongest evidence. This is the route that writes it.
    """
    pool, _, _ = drive(SELF_CONSENT_SCRIPT, lambda: _self_consent(False))
    sql, args = pool.one(_CONSENT_INSERT)
    assert "'self_acknowledged'" in sql
    # Not a bind parameter: there is exactly one value this route may write and
    # a placeholder would invite a caller to choose.
    assert args == (ORG, EMPLOYEE, pahchan.PAHCHAN_NOTICE_VERSION, False, ACTOR, None)


def test_withdrawal_is_the_same_endpoint_with_the_other_boolean():
    """DPDP asks that taking consent back be no harder than giving it. A second
    route to find would be harder by exactly the amount of finding it."""
    agreed, _, _ = drive(SELF_CONSENT_SCRIPT, lambda: _self_consent(True))
    withdrew, _, _ = drive(SELF_CONSENT_SCRIPT, lambda: _self_consent(False))
    assert agreed.one(_CONSENT_INSERT)[0] == withdrew.one(_CONSENT_INSERT)[0]
    assert agreed.one(_CONSENT_INSERT)[1][3] is True
    assert withdrew.one(_CONSENT_INSERT)[1][3] is False


def test_it_amends_rather_than_doubles():
    """Migration 209: "consent is amended, not doubled" — one live answer per
    employee per notice version, enforced by the unique index."""
    pool, _, _ = drive(SELF_CONSENT_SCRIPT, lambda: _self_consent(True))
    sql, _ = pool.one(_CONSENT_INSERT)
    assert "ON CONFLICT (org_id, employee_id, notice_version) DO UPDATE" in sql
    assert "recorded_at=NOW()" in sql


def test_an_unlinked_account_is_told_so_and_writes_nothing():
    """107 of 109 employee rows carry no `user_id`. A 409 that names the admin
    path beats a 500, and beats a row attributed to nobody."""
    pool, _, exc = drive([(_EMP_FULL, None)], lambda: _self_consent(False), expect=409)
    assert "not linked to an employee record" in exc.detail
    assert not any(_CONSENT_INSERT in s for s in pool.statements())


def test_it_is_scoped_to_the_caller_and_cannot_name_anyone_else():
    """`_employee_for` is the whole authorisation on this route — there is no
    admin gate, deliberately — so the employee id written must be the one it
    resolved and never a value from the body."""
    pool, _, _ = drive(SELF_CONSENT_SCRIPT, lambda: _self_consent(False))
    lookup_sql, lookup_args = pool.one(_EMP_FULL)
    assert lookup_args == (ORG, ACTOR)
    assert "user_id=$2" in lookup_sql
    assert pool.one(_CONSENT_INSERT)[1][1] == EMPLOYEE
    # `SelfConsentBody` carries no employee_id at all, which is the structural
    # half of the same guarantee.
    assert "employee_id" not in pahchan.SelfConsentBody.model_fields


def test_the_answer_is_audited_as_a_warning():
    _, log, _ = drive(SELF_CONSENT_SCRIPT, lambda: _self_consent(False))
    assert log.actions() == ["pahchan.employee_consent_self_recorded"]
    _, kw = log.events[0]
    assert kw["severity"] == "warn"
    assert kw["detail"]["consented"] is False
    assert kw["detail"]["method"] == "self_acknowledged"


def test_the_employees_own_view_never_carries_a_user_id():
    """`_latest_consent` is what `GET /me` returns to the person themselves.
    `recorded_by` is a user id and the owner's rule is that none is ever
    rendered; it does not leave the database on this path at all."""
    sql, _ = asyncio.run(_latest_consent_statement())
    assert "recorded_by" not in sql


async def _latest_consent_statement():
    pool = CapturePool([(_LATEST, None)])
    await pahchan._latest_consent(pool, EMPLOYEE)
    return pool.one(_LATEST)


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The roster — the finding, rendered
# ══════════════════════════════════════════════════════════════════════════════

ROSTER_SCRIPT = [(_ROLES, 1), (_ROSTER, [])]


def test_the_roster_starts_from_the_payroll_not_from_the_consent_table():
    """`GET /consent` lists rows that EXIST, and there are none — 0 against 12
    enrolled faces. A screen built on it is empty, which is the shape of the
    finding rather than the finding. So: employees LEFT JOINed to consents."""
    pool, _, _ = drive(ROSTER_SCRIPT, lambda: pahchan.consent_roster(
        user={"user_id": ACTOR}, org_id=ORG, _g=None))
    sql, _ = pool.one(_ROSTER)
    assert "FROM public.manav_employees e" in sql
    assert "LEFT JOIN LATERAL" in sql
    assert "LEFT JOIN public.pahchan_enrollment_photos" in sql


def test_the_roster_asks_only_people_who_are_still_here():
    """Asking a leaver for consent is a job nobody can ever complete. Same
    predicate the enrolment queue uses, from `services/on_the_rolls.py`."""
    pool, _, _ = drive(ROSTER_SCRIPT, lambda: pahchan.consent_roster(
        user={"user_id": ACTOR}, org_id=ORG, _g=None))
    sql, _ = pool.one(_ROSTER)
    assert "public.manav_offboarding" in sql
    assert "x.org_id = e.org_id" in sql


def test_the_roster_returns_a_name_and_never_the_recorder_id():
    pool, _, _ = drive(ROSTER_SCRIPT, lambda: pahchan.consent_roster(
        user={"user_id": ACTOR}, org_id=ORG, _g=None))
    sql, _ = pool.one(_ROSTER)
    assert "AS recorded_by_name" in sql
    assert not re.search(r"\bc\.recorded_by\b(?!\s*$)(?![^,]*AS)", sql.split("FROM")[0])


def test_a_non_admin_cannot_read_the_roster():
    """Same gate as reading somebody else's reference photograph."""
    _, _, exc = drive([(_ROLES, None)], lambda: pahchan.consent_roster(
        user={"user_id": ACTOR}, org_id=ORG, _g=None), expect=403)
    assert "org admin" in exc.detail


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The alternative attendance path
# ══════════════════════════════════════════════════════════════════════════════

MANUAL_SCRIPT = [
    (_ROLES, 1),
    (_EMP_NARROW, EMPLOYEE_NARROW),
    (_OPTED_OUT, DECLINED),
    (_ATTENDANCE_INSERT, ATTENDANCE_ROW),
]


def _manual(**over):
    payload = {
        "employee_id": EMPLOYEE,
        "for_date": "2026-08-26",
        "check_in": "2026-08-26T04:00:00+00:00",
        "check_out": "2026-08-26T13:00:00+00:00",
        "status": "present",
    }
    payload.update(over)
    return pahchan.record_manual_attendance(
        body=pahchan.ManualAttendanceBody(**payload),
        request=None, user={"user_id": ACTOR}, org_id=ORG, _g=None,
    )


def test_the_opt_out_row_uses_the_value_the_bridge_protects():
    """THE LOAD-BEARING ONE.

    `pahchan_attendance.py`'s publish upsert only leaves a row alone when
    `marked_by IS DISTINCT FROM` `attendance_bridge.MARKED_BY_MANUAL`. Any
    tidier-looking value here — 'pahchan_optout', say — would leave an
    opted-out employee's day to be silently overwritten by the next publish,
    and nothing would fail while it happened.
    """
    assert pahchan._MARKED_BY_MANUAL == MARKED_BY_MANUAL
    pool, _, _ = drive(MANUAL_SCRIPT, _manual)
    _, args = pool.one(_ATTENDANCE_INSERT)
    assert args[-1] == MARKED_BY_MANUAL


def test_the_publish_guard_the_opt_out_row_depends_on_is_still_there():
    """A cross-file assertion, because the clause lives in a file this change
    does not own and is the only thing keeping the row.

    If `pahchan_attendance.py` ever drops the `IS DISTINCT FROM` guard, this
    fails HERE — where the reason is written down — rather than showing up as
    an opted-out employee's attendance quietly reverting after a publish.
    """
    src = (pathlib.Path(pahchan.__file__).parent / "pahchan_attendance.py").read_text(
        encoding="utf-8")
    # Whitespace-normalised: the clause is written across adjacent string
    # literals with alignment padding inside them, and an assertion that breaks
    # when somebody re-indents is an assertion somebody deletes.
    flat = re.sub(r"\s+", " ", src)
    assert "manav_attendance.marked_by IS DISTINCT FROM $11" in flat, (
        "the publish upsert no longer skips hand-entered rows — an opt-out "
        "attendance day is now overwritten by every publish")
    # $11 is the parameter, and this is what is bound to it.
    assert "MARKED_BY_BRIDGE, MARKED_BY_MANUAL," in flat


def test_it_refuses_for_anyone_who_has_not_declined():
    """Restricting it is what makes it the ALTERNATIVE path rather than a way
    around the face check: without this, an enrolled employee's day could be
    typed in with no photograph, no location and no reviewer."""
    script = [(_ROLES, 1), (_EMP_NARROW, EMPLOYEE_NARROW), (_OPTED_OUT, AGREED)]
    pool, _, exc = drive(script, _manual, expect=409)
    assert "declined biometric attendance" in exc.detail
    assert not any(_ATTENDANCE_INSERT in s for s in pool.statements())


def test_no_recorded_answer_is_not_a_decline():
    """`_employee_opted_out` reads `latest is False`, so an absent row is not an
    opt-out. The 409 must fire for the 12 enrolled-with-no-answer employees too
    — they have not declined, they have not been asked."""
    script = [(_ROLES, 1), (_EMP_NARROW, EMPLOYEE_NARROW), (_OPTED_OUT, NEVER_ASKED)]
    _, _, exc = drive(script, _manual, expect=409)
    assert "has not" in exc.detail


def test_an_incomplete_pair_gives_null_hours_not_zero():
    """`attendance_bridge`: "someone who clocked in and never clocked out has an
    unknown day, not an empty one. Zero is a number payroll will happily
    multiply.\""""
    pool, _, _ = drive(MANUAL_SCRIPT, lambda: _manual(check_out=None))
    _, args = pool.one(_ATTENDANCE_INSERT)
    assert args[6] is None


def test_hours_come_from_the_pair():
    pool, _, _ = drive(MANUAL_SCRIPT, _manual)
    _, args = pool.one(_ATTENDANCE_INSERT)
    assert args[6] == 9.0


def test_the_row_says_why_it_exists():
    """`marked_by='manual'` is the same value HR's own corrections use — that is
    deliberate and load-bearing — so the note is the only thing on the row that
    distinguishes an opt-out day from an ordinary correction."""
    pool, _, _ = drive(MANUAL_SCRIPT, lambda: _manual(note="Signed register"))
    _, args = pool.one(_ATTENDANCE_INSERT)
    assert args[7] == "Recorded without biometrics — employee declined. Signed register"


def test_a_foreign_employee_is_not_found():
    """The employee lookup is scoped to the org. Without it an admin could write
    attendance for any uuid in the database by guessing one."""
    script = [(_ROLES, 1), (_EMP_NARROW, None)]
    pool, _, exc = drive(script, _manual, expect=404)
    assert exc.detail == "Employee not found"
    _, args = pool.one(_EMP_NARROW)
    assert args == (EMPLOYEE, ORG)


def test_a_non_admin_cannot_record_somebody_elses_day():
    _, _, exc = drive([(_ROLES, None)], _manual, expect=403)
    assert "org admin" in exc.detail


def test_the_status_vocabulary_is_the_columns_own():
    """Checked against the live CHECK in the live half below; here only that a
    value outside it is refused before any statement is built."""
    with pytest.raises(ValueError):
        pahchan.ManualAttendanceBody(
            employee_id=EMPLOYEE, for_date="2026-08-26", status="probably_present")


def test_times_out_of_order_are_refused():
    with pytest.raises(ValueError):
        pahchan.ManualAttendanceBody(
            employee_id=EMPLOYEE, for_date="2026-08-26",
            check_in="2026-08-26T13:00:00+00:00",
            check_out="2026-08-26T04:00:00+00:00")


def test_the_list_shows_only_people_who_declined():
    """HR corrections share `marked_by='manual'` and are somebody else's
    screen. The LATERAL is what separates them."""
    pool, _, _ = drive([(_ROLES, 1), (_MANUAL_LIST, [])],
                       lambda: pahchan.list_manual_attendance(
                           days=30, user={"user_id": ACTOR}, org_id=ORG, _g=None))
    sql, _ = pool.one(_MANUAL_LIST)
    assert "c.consented IS FALSE" in sql
    assert "a.marked_by=$2" in sql


# ══════════════════════════════════════════════════════════════════════════════
#  4 · A withdrawn consent stops the photograph, not the punch
# ══════════════════════════════════════════════════════════════════════════════

PUNCH_SCRIPT = [
    (_EMP_FULL, EMPLOYEE_ROW),
    ("SELECT id, direction, captured_at, flags FROM public.pahchan_punches", None),
    ("SELECT * FROM public.pahchan_policy", None),
    ("FROM public.pahchan_policy_overrides", []),
    ("FROM public.pahchan_sites", []),
    ("SELECT COUNT(*) FROM public.pahchan_enrollment_photos", 2),
    (_OPTED_OUT, DECLINED),
    (_PUNCH_INSERT, {"id": "p1", "direction": "in", "captured_at": None,
                     "received_at": None, "flags": [], "source": "live"}),
]


def _punch(photo_key="pahchan/punch/2026/08/x.jpg"):
    return pahchan.create_punch(
        body=pahchan.PunchBody(
            direction="in",
            captured_at="2026-08-26T04:00:00+00:00",
            client_punch_id="c" * 12,
            photo_key=photo_key,
        ),
        request=None, user={"user_id": ACTOR}, org_id=ORG, _g=None,
    )


def test_an_opted_out_employees_punch_is_recorded_without_the_photograph():
    """07 §2 — nothing blocks a punch — and DPDP: no lawful basis to store the
    face. Both are satisfied by dropping the key and keeping the row."""
    pool, _, out = drive(PUNCH_SCRIPT, _punch)
    _, args = pool.one(_PUNCH_INSERT)
    assert args[5] is None, "the photo key reached the punch row"
    assert out["duplicate"] is False


def test_dropping_the_photograph_adds_no_flag():
    """`Punch.is_eligible` treats any flag with no verdict as unpayable, so a
    new flag here would quietly make every day an opted-out employee works need
    a reviewer before it became pay."""
    pool, _, _ = drive(PUNCH_SCRIPT, _punch)
    _, args = pool.one(_PUNCH_INSERT)
    flags = args[13]
    assert "optout" not in flags and "consent" not in flags


def test_a_photo_less_punch_costs_no_consent_query():
    """The check runs only when there is a key to drop, so the ordinary punch
    path is unchanged."""
    pool, _, _ = drive(PUNCH_SCRIPT, lambda: _punch(photo_key=None))
    assert not any(_OPTED_OUT in s for s in pool.statements())


def test_the_face_of_someone_who_declined_never_reaches_the_object_store():
    """`upload_punch_photo` refuses BEFORE `storage.upload_file`. Refusing after
    would leave the image in R2 with the retention sweep as the only thing that
    ever removes it."""
    import db

    class _File:
        filename = "selfie.jpg"
        content_type = "image/jpeg"

    uploaded = []

    async def _read_capped(file, limit, label=None):
        return b"\xff\xd8\xff"

    async def _upload_file(**kw):
        uploaded.append(kw)
        return {"key": "pahchan/punch/x.jpg", "size": 3}

    async def run():
        pool = CapturePool([(_EMP_FULL, EMPLOYEE_ROW), (_OPTED_OUT, DECLINED)])
        original_pool, db._pool = db._pool, pool
        original_read = pahchan.storage.read_capped
        original_upload = pahchan.storage.upload_file
        pahchan.storage.read_capped = _read_capped
        pahchan.storage.upload_file = _upload_file
        try:
            with pytest.raises(HTTPException) as caught:
                await pahchan.upload_punch_photo(
                    request=None, file=_File(), kind="punch",
                    user={"user_id": ACTOR}, org_id=ORG, _g=None)
            return caught.value
        finally:
            db._pool = original_pool
            pahchan.storage.read_capped = original_read
            pahchan.storage.upload_file = original_upload

    exc = asyncio.run(run())
    assert exc.status_code == 409
    assert "declined biometric attendance" in exc.detail
    assert uploaded == [], "the photograph was uploaded before the refusal"


# ══════════════════════════════════════════════════════════════════════════════
#  5 · The live half — the only thing a mock pool cannot prove
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily "
    "to an INSERT naming a column that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_pahchan_consent_optout.py -q"
)


def live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _captured_calls():
    """(path, sql, args) for every statement the four new handlers issue, plus
    the punch INSERT on the opt-out branch."""
    out = []
    for name, script, factory in (
        ("consent/me", SELF_CONSENT_SCRIPT, lambda: _self_consent(False)),
        ("consent/roster", ROSTER_SCRIPT, lambda: pahchan.consent_roster(
            user={"user_id": ACTOR}, org_id=ORG, _g=None)),
        ("attendance/manual POST", MANUAL_SCRIPT, _manual),
        ("attendance/manual GET", [(_ROLES, 1), (_MANUAL_LIST, [])],
         lambda: pahchan.list_manual_attendance(
             days=30, user={"user_id": ACTOR}, org_id=ORG, _g=None)),
        ("punch (opted out)", PUNCH_SCRIPT, _punch),
    ):
        pool, _, _ = drive(script, factory)
        out.extend((name, sql, args) for sql, args in pool.calls)
    return out


def _describe(calls):
    """Parse and Describe every statement, then read the catalogue.

    NOTHING IS EXECUTED: `prepare()` sends Parse and Describe and returns a
    handle no `fetch`/`execute` is ever called on. `statement_cache_size=0`
    because the connection goes through PgBouncer in transaction mode.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for path, sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((path, sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((path, sql, len(stmt.get_parameters()), len(args)))
            columns = await conn.fetch(
                "SELECT table_name, column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = ANY(current_schemas(false)) "
                "  AND table_name IN ('manav_attendance', 'pahchan_employee_consents')"
            )
            checks = await conn.fetch(
                "SELECT conrelid::regclass::text AS rel, conname, "
                "       pg_get_constraintdef(oid) AS def "
                "FROM pg_constraint "
                "WHERE conrelid IN ("
                "  'public.manav_attendance'::regclass, "
                "  'public.pahchan_employee_consents'::regclass) "
                "  AND contype = 'c'"
            )
            return (failures, params,
                    [dict(r) for r in columns], [dict(r) for r in checks])
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Skips only when the DATABASE cannot be reached — never when it answers.

    `_describe` casts `'public.manav_attendance'::regclass` and
    `'public.pahchan_employee_consents'::regclass`, either of which raises
    UndefinedTableError when the relation is absent. Under a blanket
    `except Exception` that raise became a skip, so a MISSING TABLE turned all
    eight live tests in this file green-by-absence — including
    `test_every_statement_plans_on_the_real_schema`, which exists to report
    exactly that. Narrowed to connection failures, a reachable database that
    lacks the table now fails loudly instead.
    """
    import asyncpg

    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    calls = _captured_calls()
    try:
        return _describe(calls)
    except (OSError, asyncio.TimeoutError,
            asyncpg.PostgresConnectionError,
            asyncpg.InvalidAuthorizationSpecificationError,
            asyncpg.InvalidCatalogNameError) as exc:
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def _column_list(sql):
    """The column names in an INSERT's `(a, b, c)` list."""
    match = re.search(r"INSERT INTO\s+[\w.\"]+\s*\(([^)]*)\)", sql, re.S)
    assert match, f"no column list found in:\n{sql}"
    return [c.strip() for c in match.group(1).split(",") if c.strip()]


def test_every_statement_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means an untyped parameter expression, which PgBouncer
    turns into an instant 500."""
    failures, _, _, _ = live
    assert not failures, "\n\n".join(
        f"[{path}] {err}\n{sql}" for path, sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    _, params, _, _ = live
    wrong = [(p, sql, declared, bound)
             for p, sql, declared, bound in params if declared != bound]
    assert not wrong, "\n\n".join(
        f"[{p}] declares ${declared} but binds {bound} arguments\n{sql}"
        for p, sql, declared, bound in wrong)


def test_both_inserts_name_real_columns_and_supply_every_required_one(live):
    """`prepare()` plans a statement that omits a NOT NULL column perfectly
    happily — the violation is a runtime constraint, not a parse error — so this
    is the half Parse and Describe cannot do. Read from the catalogue, never
    from the migration ledger: migrations are applied by hand here."""
    _, params, columns, _ = live
    seen = set()
    for table, needle in (
        ("pahchan_employee_consents", _CONSENT_INSERT),
        ("manav_attendance", _ATTENDANCE_INSERT),
    ):
        known = {c["column_name"] for c in columns if c["table_name"] == table}
        assert known, f"public.{table} has no columns — wrong schema?"
        required = {c["column_name"] for c in columns
                    if c["table_name"] == table
                    and c["is_nullable"] == "NO" and c["column_default"] is None}
        for path, sql, _, _ in params:
            if needle not in sql:
                continue
            seen.add(table)
            cols = set(_column_list(sql))
            assert not (cols - known), (
                f"[{path}] names columns public.{table} does not have: "
                f"{sorted(cols - known)}")
            assert not (required - cols), (
                f"[{path}] omits NOT NULL columns with no default: "
                f"{sorted(required - cols)}")
    assert seen == {"pahchan_employee_consents", "manav_attendance"}, (
        f"described only {sorted(seen)} — the capture stopped reaching a write path")


def _check_def(checks, rel, needle):
    for row in checks:
        if row["rel"].endswith(rel) and needle in row["def"]:
            return row["def"]
    raise AssertionError(
        f"no CHECK on {rel} mentioning {needle!r}; found "
        + ", ".join(f"{r['conname']}: {r['def']}" for r in checks))


def test_the_method_this_route_writes_is_admitted_by_the_check(live):
    """`self_acknowledged` is migration 209's own value and `POST /consent/me`
    is the only route that can write it. If it were ever dropped from the CHECK,
    the employee's own answer would 500 and nothing else would."""
    _, _, _, checks = live
    assert "self_acknowledged" in _check_def(
        checks, "pahchan_employee_consents", "method")


def test_manual_is_admitted_and_is_what_this_router_writes(live):
    _, _, _, checks = live
    definition = _check_def(checks, "manav_attendance", "marked_by")
    assert f"'{MARKED_BY_MANUAL}'" in definition


def test_the_status_list_in_this_router_is_the_columns_own(live):
    """Copied vocabularies drift. This one is compared with the CHECK rather
    than with `routers/manav.py`, because the database is what refuses."""
    _, _, _, checks = live
    definition = _check_def(checks, "manav_attendance", "status")
    live_values = set(re.findall(r"'([a-z_]+)'::text", definition))
    assert live_values == set(pahchan._ATTENDANCE_STATUSES), (
        f"the column admits {sorted(live_values)}; this router offers "
        f"{sorted(pahchan._ATTENDANCE_STATUSES)}")


def test_the_router_file_is_the_one_under_test(live):
    _, params, _, _ = live
    assert len(params) >= 12, (
        f"only {len(params)} statements described — the capture stopped "
        f"reaching the handlers")
    assert pathlib.Path(pahchan.__file__).name == "pahchan.py"


# ══════════════════════════════════════════════════════════════════════════════
#  A FINDING THIS FILE FOUND AND DELIBERATELY DOES NOT FIX
# ══════════════════════════════════════════════════════════════════════════════
#
# `attendance_bridge.MARKED_BY_BRIDGE` is 'pahchan', and
# `manav_attendance_marked_by_check` admits only
# ('system', 'manual', 'biometric', 'geo'). So every row
# `POST /v1/pahchan/publish` has ever tried to insert violates that CHECK.
# Measured read-only 2026-08-26 on the live database:
#
#     staging.manav_attendance  marked_by='system'   512 rows
#                               marked_by='manual'     6 rows
#                               marked_by='pahchan'    0 rows
#     staging.pahchan_punches                        699 rows
#
# 699 punches and not one bridged row. `routers/pahchan_attendance.py` is
# outside this change's file surface, so this is recorded rather than repaired
# — and it is precisely why the opt-out path writes `manual` and goes straight
# to `manav_attendance` instead of manufacturing punches for somebody who
# declined to be photographed.
