"""The five payroll/attendance events fire from the write, and only from a real one.

Wired 2026-08-18: `payroll.published` and `payslip.disbursed` in
`routers/vetana.py`; `correction.requested` and `correction.decided` in
`routers/pahchan_attendance.py`; `enrollment.requested` in
`routers/pahchan.py`.

What these tests pin, per event:

  * the HAPPY PATH calls the emitter exactly once, ON THE CONNECTION of the
    business write (the fake pool lends itself out as the conn, so identity is
    checkable), with arguments read off the row the write returned;
  * at least one REFUSAL path emits nothing — a 400/403/404 must never leave
    an event behind claiming the thing happened;
  * nothing here wraps the emitter in try/except: a raise from the emitter
    propagates, because the transaction is the containment, not a swallow.

The payload DISCIPLINE (no salary figures, no punch times, no photo keys, no
free-text reasons) lives inside `services/niyam/subjects.py` and is covered by
the registry/payload tests. What a router can get wrong is the ARGUMENTS, so
the assertions here are about argument honesty: the exact keyword set each
emitter is called with, and where each value came from.

Fake-pool idiom from `tests/test_target_attainment.py` — its `_Pool.acquire`
proxies the acquired conn back into the same call ledger.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

import routers.pahchan as pahchan
import routers.pahchan_attendance as pahchan_attendance
import routers.vetana as vetana
from middleware.role_tiers import APPROVER


# ── fakes ────────────────────────────────────────────────────────────────────


class _Pool:
    """Records every call; hands out queued results FIFO per method.

    `acquire()` lends the pool itself out as the connection — same as the
    committed idiom in test_target_attainment — so `conn is pool` identifies
    "emitted on the business write's own connection".
    """

    def __init__(self):
        self.calls = []
        self.fetchrow_q: list = []
        self.fetchval_q: list = []

    async def fetch(self, q, *a):
        self.calls.append(("fetch", q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append(("fetchrow", q, a))
        return self.fetchrow_q.pop(0) if self.fetchrow_q else None

    async def fetchval(self, q, *a):
        self.calls.append(("fetchval", q, a))
        return self.fetchval_q.pop(0) if self.fetchval_q else None

    async def execute(self, q, *a):
        self.calls.append(("execute", q, a))
        return "UPDATE 1"

    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return pool

            async def __aexit__(_s, *exc):
                return False

        return _A()

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *exc):
                return False

        return _T()


class _Emit:
    """Stands in for a subjects.* emitter; records (conn, kwargs)."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, kw))
        return 1


def _wire(monkeypatch, module, pool, emitter_names):
    """Point the module at the fake pool and swap its emitters for recorders."""

    async def _get_pool():
        return pool

    monkeypatch.setattr(module, "get_pool", _get_pool)
    emitters = {}
    for name in emitter_names:
        emitters[name] = _Emit()
        monkeypatch.setattr(module, name, emitters[name])
    return emitters


APPROVER_LEVELS = frozenset({APPROVER})


# ═════════════════════════════════════════════════════════════════════════════
# payroll.published — the approval write, no salary figures in the arguments
# ═════════════════════════════════════════════════════════════════════════════


_RUN_ROW = {
    "id": "r1",
    "month": "2026-08",
    "employee_count": 3,
    "status": "approved",
    # RETURNING * carries the money columns; the emitter is the filter. The
    # test's business is that the ROW is handed over whole and untouched.
    "total_gross": 1234567.00,
}


@pytest.mark.asyncio
async def test_approving_a_run_emits_payroll_published(monkeypatch):
    pool = _Pool()
    e = _wire(monkeypatch, vetana, pool, ["payroll_published", "payslip_disbursed"])
    pool.fetchrow_q = [
        {"status": "processed", "created_by": "u_runner"},  # the status check
        dict(_RUN_ROW),                                     # UPDATE … RETURNING *
    ]

    out = await vetana.approve_run(
        "r1", object(), user={"user_id": "u_approver"}, org_id="org1",
        levels=APPROVER_LEVELS,
    )

    assert out == {"ok": True}
    assert len(e["payroll_published"].calls) == 1, "the approval must emit exactly once"
    conn, kw = e["payroll_published"].calls[0]
    assert conn is pool, "emitted off the business write's own connection"
    assert set(kw) == {"org_id", "actor_id", "run_id", "row"}, (
        "the emitter's whole vocabulary — anything more is a router smuggling "
        f"payload past subjects.py: {sorted(kw)}"
    )
    assert kw["org_id"] == "org1"
    assert kw["actor_id"] == "u_approver"
    assert kw["run_id"] == "r1"
    assert kw["row"]["month"] == "2026-08", "the row is the one the UPDATE returned"
    assert e["payslip_disbursed"].calls == [], "approval is not disbursement"

    # …and the emit rode INSIDE the same transaction as the status write: the
    # RETURNING * update is in the ledger before anything else touched the run.
    writes = [q for kind, q, _ in pool.calls
              if kind == "fetchrow" and "SET status='approved'" in q]
    assert writes and "RETURNING *" in writes[0]


@pytest.mark.asyncio
async def test_a_refused_approval_emits_nothing(monkeypatch):
    """Wrong state → 400, and no event claiming salaries became payable."""
    pool = _Pool()
    e = _wire(monkeypatch, vetana, pool, ["payroll_published"])
    pool.fetchrow_q = [{"status": "draft", "created_by": None}]

    with pytest.raises(HTTPException) as exc:
        await vetana.approve_run(
            "r1", object(), user={"user_id": "u_approver"}, org_id="org1",
            levels=APPROVER_LEVELS,
        )
    assert exc.value.status_code == 400
    assert e["payroll_published"].calls == []


@pytest.mark.asyncio
async def test_a_four_eyes_refusal_emits_nothing(monkeypatch):
    """The runner trying to self-approve where a second approver exists → 403,
    and no event: the four-eyes control and the event must agree."""
    pool = _Pool()
    e = _wire(monkeypatch, vetana, pool, ["payroll_published"])
    pool.fetchrow_q = [{"status": "processed", "created_by": "u_same"}]
    pool.fetchval_q = [1]  # one OTHER approver exists

    with pytest.raises(HTTPException) as exc:
        await vetana.approve_run(
            "r1", object(), user={"user_id": "u_same"}, org_id="org1",
            levels=APPROVER_LEVELS,
        )
    assert exc.value.status_code == 403
    assert e["payroll_published"].calls == []


@pytest.mark.asyncio
async def test_a_failed_publish_emit_is_not_swallowed(monkeypatch):
    """No try/except around the emitter — the transaction is the guarantee. An
    emitter that raises must surface, not vanish behind {"ok": true}."""
    pool = _Pool()
    _wire(monkeypatch, vetana, pool, ["payroll_published"])

    async def _boom(conn, **kw):
        raise RuntimeError("emit failed")

    monkeypatch.setattr(vetana, "payroll_published", _boom)
    pool.fetchrow_q = [
        {"status": "processed", "created_by": "u_runner"},
        dict(_RUN_ROW),
    ]

    with pytest.raises(RuntimeError):
        await vetana.approve_run(
            "r1", object(), user={"user_id": "u_approver"}, org_id="org1",
            levels=APPROVER_LEVELS,
        )


# ═════════════════════════════════════════════════════════════════════════════
# payslip.disbursed — once per RUN, at the moment the run finishes
# ═════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_the_last_disbursement_emits_once_for_the_run(monkeypatch):
    pool = _Pool()
    e = _wire(monkeypatch, vetana, pool, ["payslip_disbursed"])
    pool.fetchrow_q = [
        {"status": "approved", "run_id": "r1"},              # the payslip check
        {"id": "r1", "month": "2026-08", "status": "disbursed"},  # run flip RETURNING *
    ]
    pool.fetchval_q = [
        0,  # undisbursed after this flip → the run is done
        4,  # payslips actually flipped, counted in the same transaction
    ]

    out = await vetana.disburse_payslip(
        "p9", user={"user_id": "u_approver"}, org_id="org1", levels=APPROVER_LEVELS,
    )

    assert out == {"ok": True}
    assert len(e["payslip_disbursed"].calls) == 1
    conn, kw = e["payslip_disbursed"].calls[0]
    assert conn is pool
    assert set(kw) == {"org_id", "actor_id", "run_id", "month", "employee_count"}, (
        "the RUN is the entity — a payslip id in these arguments would be a "
        f"per-person salary event: {sorted(kw)}"
    )
    assert kw["run_id"] == "r1"
    assert kw["month"] == "2026-08", "month reads off the run row, its own text shape"
    assert kw["employee_count"] == 4, (
        "employee_count is the COUNTED number of flipped payslips, not the run "
        "row's planned counter"
    )


@pytest.mark.asyncio
async def test_a_mid_run_disbursement_emits_nothing(monkeypatch):
    """Three payslips still to go: the payslip flips, the run does not, and
    there is NO event — never one per payslip."""
    pool = _Pool()
    e = _wire(monkeypatch, vetana, pool, ["payslip_disbursed"])
    pool.fetchrow_q = [{"status": "approved", "run_id": "r1"}]
    pool.fetchval_q = [3]  # undisbursed remain

    out = await vetana.disburse_payslip(
        "p9", user={"user_id": "u_approver"}, org_id="org1", levels=APPROVER_LEVELS,
    )

    assert out == {"ok": True}
    assert e["payslip_disbursed"].calls == []
    assert not any("vetana_payroll_runs" in q for kind, q, _ in pool.calls
                   if kind == "fetchrow" and "UPDATE" in q), \
        "the run must not flip while payslips remain"


@pytest.mark.asyncio
async def test_an_unapproved_payslip_refuses_and_emits_nothing(monkeypatch):
    pool = _Pool()
    e = _wire(monkeypatch, vetana, pool, ["payslip_disbursed"])
    pool.fetchrow_q = [{"status": "draft", "run_id": "r1"}]

    with pytest.raises(HTTPException) as exc:
        await vetana.disburse_payslip(
            "p9", user={"user_id": "u_approver"}, org_id="org1",
            levels=APPROVER_LEVELS,
        )
    assert exc.value.status_code == 400
    assert e["payslip_disbursed"].calls == []
    assert not any(kind == "execute" for kind, _, _ in pool.calls), \
        "a refusal must write nothing at all"


# ═════════════════════════════════════════════════════════════════════════════
# correction.requested — the regularisation INSERT
# ═════════════════════════════════════════════════════════════════════════════


def _reg_body(**over):
    kw = dict(
        employee_id="e1",
        for_date="2026-08-01",
        requested_direction="in",
        requested_at_time="2026-08-01T09:00:00+05:30",
        reason="the punch never registered",
        punch_id=None,
        evidence_key=None,
    )
    kw.update(over)
    return pahchan_attendance.RegularisationCreate(**kw)


_REG_ROW = {
    "id": "reg1",
    "org_id": "org1",
    "employee_id": "e1",
    "punch_id": None,
    "for_date": date(2026, 8, 1),
    "requested_direction": "in",
    "requested_at_time": datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc),
    "reason": "the punch never registered",
    "evidence_key": None,
    "status": "pending",
    "created_at": datetime(2026, 8, 1, 9, 5, tzinfo=timezone.utc),
}


@pytest.mark.asyncio
async def test_requesting_a_correction_emits(monkeypatch):
    pool = _Pool()
    e = _wire(monkeypatch, pahchan_attendance, pool,
              ["correction_requested", "correction_decided"])
    pool.fetchval_q = [
        1,        # the caller IS this employee
        "u_emp",  # manav_employees.user_id, read in the same transaction
    ]
    pool.fetchrow_q = [dict(_REG_ROW)]  # INSERT … RETURNING *

    out = await pahchan_attendance.request_regularisation(
        _reg_body(), user={"user_id": "u_emp"}, org_id="org1",
    )

    assert len(e["correction_requested"].calls) == 1
    conn, kw = e["correction_requested"].calls[0]
    assert conn is pool
    assert set(kw) == {"org_id", "actor_id", "regularisation_id", "row",
                       "employee_user_id"}
    assert kw["regularisation_id"] == "reg1"
    assert kw["employee_user_id"] == "u_emp", \
        "the employee's LOGIN, resolved from the employee row — not assumed"
    assert kw["row"]["for_date"] == date(2026, 8, 1)
    assert e["correction_decided"].calls == [], "a request is not a decision"

    # The API's response shape did not grow with RETURNING *.
    assert set(out) == {"id", "for_date", "requested_direction", "status",
                        "created_at"}


@pytest.mark.asyncio
async def test_a_refused_correction_request_emits_nothing(monkeypatch):
    """Not their record, not a reviewer → 403, no INSERT, no event."""
    pool = _Pool()
    e = _wire(monkeypatch, pahchan_attendance, pool, ["correction_requested"])
    pool.fetchval_q = [None, None]  # not own record, not a reviewer

    with pytest.raises(HTTPException) as exc:
        await pahchan_attendance.request_regularisation(
            _reg_body(), user={"user_id": "u_other"}, org_id="org1",
        )
    assert exc.value.status_code == 403
    assert e["correction_requested"].calls == []
    assert not any(kind == "fetchrow" for kind, _, _ in pool.calls), \
        "the INSERT must never run on a refusal"


# ═════════════════════════════════════════════════════════════════════════════
# correction.decided — approved or DECLINED (064's CHECK), never 'rejected'
# ═════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["approved", "declined"])
async def test_deciding_a_correction_emits_either_way(monkeypatch, decision):
    pool = _Pool()
    e = _wire(monkeypatch, pahchan_attendance, pool, ["correction_decided"])
    monkeypatch.setattr(pahchan_attendance, "audit", lambda *a, **k: None)
    decided = {**_REG_ROW, "status": decision, "decided_by": "u_admin",
               "decision_note": "note" if decision == "declined" else None}
    pool.fetchrow_q = [decided]   # UPDATE … RETURNING *
    pool.fetchval_q = ["u_emp"]

    body = pahchan_attendance.RegularisationDecision(
        status=decision,
        decision_note="note" if decision == "declined" else None,
    )
    out = await pahchan_attendance.decide_regularisation(
        uuid4(), body, object(), user={"user_id": "u_admin"}, org_id="org1",
    )

    assert len(e["correction_decided"].calls) == 1
    conn, kw = e["correction_decided"].calls[0]
    assert conn is pool
    assert set(kw) == {"org_id", "actor_id", "regularisation_id", "row",
                       "decision", "employee_user_id"}
    assert kw["decision"] == decision, "the vocabulary is the CHECK's, off the row"
    assert kw["decision"] != "rejected"
    assert kw["employee_user_id"] == "u_emp"
    # The response keeps its pre-wiring shape.
    assert set(out) == {"id", "employee_id", "for_date", "requested_direction",
                        "status"}


@pytest.mark.asyncio
async def test_deciding_a_settled_correction_emits_nothing(monkeypatch):
    """The WHERE finds no pending row → 404, and no event — a re-decision that
    did not happen must not be announced."""
    pool = _Pool()
    e = _wire(monkeypatch, pahchan_attendance, pool, ["correction_decided"])
    monkeypatch.setattr(pahchan_attendance, "audit", lambda *a, **k: None)
    pool.fetchrow_q = [None]

    with pytest.raises(HTTPException) as exc:
        await pahchan_attendance.decide_regularisation(
            uuid4(),
            pahchan_attendance.RegularisationDecision(status="approved"),
            object(), user={"user_id": "u_admin"}, org_id="org1",
        )
    assert exc.value.status_code == 404
    assert e["correction_decided"].calls == []


@pytest.mark.asyncio
async def test_a_noteless_decline_refuses_before_touching_anything(monkeypatch):
    pool = _Pool()
    e = _wire(monkeypatch, pahchan_attendance, pool, ["correction_decided"])

    with pytest.raises(HTTPException) as exc:
        await pahchan_attendance.decide_regularisation(
            uuid4(),
            pahchan_attendance.RegularisationDecision(status="declined"),
            object(), user={"user_id": "u_admin"}, org_id="org1",
        )
    assert exc.value.status_code == 400
    assert e["correction_decided"].calls == []
    assert pool.calls == [], "refused before any query ran"


# ═════════════════════════════════════════════════════════════════════════════
# enrollment.requested — the reference-photo INSERT; the EMPLOYEE is the entity
# ═════════════════════════════════════════════════════════════════════════════


_EMP_ID = UUID("00000000-0000-0000-0000-00000000e001")


def _enroll_body(source="self_capture"):
    return pahchan.EnrollBody(
        employee_id=_EMP_ID, slot=1, object_key="pahchan/org1/e001/ref-1.jpg",
        source=source,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["self_capture", "hr_upload"])
async def test_enrolling_a_photo_emits_with_the_rows_own_method(monkeypatch, source):
    pool = _Pool()
    e = _wire(monkeypatch, pahchan, pool, ["enrollment_requested"])
    monkeypatch.setattr(pahchan, "audit", lambda *a, **k: None)

    async def _may(*a):
        return True

    monkeypatch.setattr(pahchan, "_may_view_others_biometrics", _may)
    pool.fetchrow_q = [
        {"id": str(_EMP_ID), "name": "E"},   # _employee_for → the caller IS e001
        {"user_id": "u_emp"},                # the org-membership + login lookup
        {"id": "p1", "slot": 1, "source": source, "approved_at": None},  # INSERT
    ]

    out = await pahchan.enroll_photo(
        _enroll_body(source), object(), user={"user_id": "u_emp"}, org_id="org1",
    )

    assert len(e["enrollment_requested"].calls) == 1
    conn, kw = e["enrollment_requested"].calls[0]
    assert conn is pool
    assert set(kw) == {"org_id", "actor_id", "employee_id", "method",
                       "employee_user_id"}, (
        "the photo row's id and object key are biometric material and must "
        f"not ride: {sorted(kw)}"
    )
    assert kw["employee_id"] == str(_EMP_ID), "the EMPLOYEE is the entity, not the photo"
    assert kw["method"] == source, "method reads the row's source column"
    assert kw["employee_user_id"] == "u_emp"
    assert "object_key" not in kw and "photo_id" not in kw
    assert out["id"] == "p1"


@pytest.mark.asyncio
async def test_enrolling_a_colleague_by_self_capture_refuses_and_emits_nothing(monkeypatch):
    pool = _Pool()
    e = _wire(monkeypatch, pahchan, pool, ["enrollment_requested"])
    monkeypatch.setattr(pahchan, "audit", lambda *a, **k: None)
    # The caller resolves to a DIFFERENT employee than the one being enrolled.
    pool.fetchrow_q = [{"id": str(uuid4()), "name": "Somebody Else"}]

    with pytest.raises(HTTPException) as exc:
        await pahchan.enroll_photo(
            _enroll_body("self_capture"), object(),
            user={"user_id": "u_intruder"}, org_id="org1",
        )
    assert exc.value.status_code == 403
    assert e["enrollment_requested"].calls == []
    assert not any(kind == "execute" for kind, _, _ in pool.calls), \
        "nothing may be written on the path that guards the verification model"
