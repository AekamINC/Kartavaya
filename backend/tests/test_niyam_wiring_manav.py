"""The six HR events are emitted by the writes that own them — and only there.

Wired 2026-08-18: leave.requested, leave.decided, employee.joined,
employee.exited, expense.claimed, expense.decided. Every emitter is awaited on
the SAME connection as the business write, inside its transaction (emit.py's
one rule), and none of them fires on a refusal path.

The fake pool follows `tests/test_target_attainment.py`: `acquire()` lends the
pool itself back as the connection, so pool-level and connection-level calls
land in one ledger — and, usefully here, `conn is pool` lets each test assert
the emitter was handed the transaction's own connection rather than the pool.

The emitters are monkeypatched IN THE ROUTER'S NAMESPACE. That is the whole
reason routers/manav.py imports them at module level rather than inside each
handler the way graha/vikray do: a function-local import re-binds the real
emitter on every call and the wiring becomes unprovable.

`employee.joined` has TWO call sites because the product has two places an
employee row is born — POST /employees and POST /candidates/{id}/hire. One
event per actual row creation; the already-converted guard on the hire path is
what keeps it from ever being two for one person.
"""
import pytest
from fastapi import HTTPException

import routers.manav as manav


# ── the fake pool (test_target_attainment.py's idiom) ────────────────────────

class _Pool:
    def __init__(self):
        self.calls = []

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return None

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return None

    # The wired writes run inside a transaction with the Niyam emitter, so the
    # fake pool lends out a conn that proxies every call back into the same
    # ledger the assertions read.
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


class _Recorder:
    """Stands in for one emitter; remembers every call it was awaited with."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, kw))
        return 1


EMITTERS = ("leave_requested", "leave_decided", "employee_joined",
            "employee_exited", "expense_claimed", "expense_decided")


@pytest.fixture
def emitted(monkeypatch):
    """All six emitters replaced by recorders — so every refusal test proves
    not merely that ITS emitter stayed silent but that NOTHING emitted."""
    recs = {name: _Recorder() for name in EMITTERS}
    for name, rec in recs.items():
        assert hasattr(manav, name), (
            f"routers.manav no longer holds {name!r} at module level — "
            "the wiring moved and this suite is patching air"
        )
        monkeypatch.setattr(manav, name, rec)
    return recs


def _silent_except(recs, *allowed):
    return [n for n, r in recs.items() if r.calls and n not in allowed]


@pytest.fixture
def pool(monkeypatch):
    p = _Pool()

    async def _get_pool():
        return p

    monkeypatch.setattr(manav, "get_pool", _get_pool)
    return p


ADMIN = frozenset({"admin"})
NOBODY = frozenset()
USER = {"user_id": "u-admin", "name": "Test Admin"}


def _dispatch(pool, table_rows):
    """fetchrow answers by SQL substring; unmatched queries answer None (which
    is also what makes the pahchan seat count read as uncapped)."""
    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        for frag, row in table_rows.items():
            if frag in q:
                return dict(row) if isinstance(row, dict) else row
        return None

    pool.fetchrow = _fetchrow


def _fetchval_returns(pool, value):
    async def _fetchval(q, *a):
        pool.calls.append((q, a))
        return value

    pool.fetchval = _fetchval


# ── leave.requested ──────────────────────────────────────────────────────────

_LEAVE_ROW = {
    "id": "lr-1", "org_id": "org1", "employee_id": "e1",
    "leave_type_id": "lt-1", "days": 2.0,
    "start_date": "2026-09-01", "end_date": "2026-09-02",
    "reason": "personal", "status": "pending",
}


async def test_submitting_leave_emits_on_the_writes_own_connection(pool, emitted):
    _dispatch(pool, {
        "SELECT id FROM staging.manav_employees": {"id": "e1"},
        "INSERT INTO staging.manav_leave_requests": _LEAVE_ROW,
    })
    _fetchval_returns(pool, "login-1")

    out = await manav.create_leave_request(
        manav.LeaveRequest(leave_type_id="lt-1", start_date="2026-09-01",
                           end_date="2026-09-02", days=2),
        user=USER, org_id="org1", levels=NOBODY,   # self-service needs no grant
    )

    assert out["status"] == "submitted"
    (conn, kw), = emitted["leave_requested"].calls
    assert conn is pool, "the emitter must ride the business write's connection"
    assert kw["org_id"] == "org1"
    assert kw["actor_id"] == "u-admin"
    assert kw["request_id"] == "lr-1"
    assert kw["row"]["leave_type_id"] == "lt-1"
    assert kw["employee_user_id"] == "login-1", \
        "employee_user_id is manav_employees.user_id, resolved in-transaction"
    assert not _silent_except(emitted, "leave_requested")


async def test_leave_without_an_employee_record_emits_nothing(pool, emitted):
    # No employee row for the caller → 403, and no INSERT happened.
    with pytest.raises(HTTPException) as e:
        await manav.create_leave_request(
            manav.LeaveRequest(leave_type_id="lt-1", start_date="2026-09-01",
                               end_date="2026-09-02", days=2),
            user=USER, org_id="org1", levels=NOBODY,
        )
    assert e.value.status_code == 403
    assert not _silent_except(emitted)


async def test_insufficient_balance_emits_nothing(pool, emitted):
    _dispatch(pool, {
        "SELECT id FROM staging.manav_employees": {"id": "e1"},
        "SELECT allocated, used, carried_forward":
            {"allocated": 2, "used": 2, "carried_forward": 0},
    })
    with pytest.raises(HTTPException) as e:
        await manav.create_leave_request(
            manav.LeaveRequest(leave_type_id="lt-1", start_date="2026-09-01",
                               end_date="2026-09-02", days=2),
            user=USER, org_id="org1", levels=NOBODY,
        )
    assert e.value.status_code == 400
    assert not _silent_except(emitted)


# ── leave.decided ────────────────────────────────────────────────────────────

_PENDING_LR = {
    "employee_id": "e1", "leave_type_id": "lt-1", "days": 2,
    "status": "pending", "start_date": "2026-09-01", "end_date": "2026-09-02",
}


@pytest.mark.parametrize("decision", ["approved", "rejected"])
async def test_actioning_leave_emits_one_event_with_the_decision(pool, emitted, decision):
    decided = dict(_LEAVE_ROW, status=decision)
    _dispatch(pool, {
        "SELECT employee_id, leave_type_id, days, status": _PENDING_LR,
        "UPDATE staging.manav_leave_requests": decided,
        # the post-decision notify lookup — no email, so no send is attempted
        "SELECT name, email FROM staging.manav_employees": None,
    })
    _fetchval_returns(pool, "login-1")

    out = await manav.action_leave_request(
        "10000000-0000-0000-0000-000000000001",
        manav.LeaveAction(status=decision),
        user=USER, org_id="org1", levels=ADMIN,
    )

    assert out["status"] == decision
    (conn, kw), = emitted["leave_decided"].calls
    assert conn is pool
    assert kw["decision"] == decision, \
        "one event for both outcomes, the decision in the payload"
    assert kw["request_id"] == "10000000-0000-0000-0000-000000000001"
    assert kw["employee_user_id"] == "login-1"
    assert kw["actor_id"] == "u-admin"
    assert not _silent_except(emitted, "leave_decided")


async def test_actioning_an_already_decided_leave_emits_nothing(pool, emitted):
    _dispatch(pool, {
        "SELECT employee_id, leave_type_id, days, status":
            dict(_PENDING_LR, status="approved"),
    })
    with pytest.raises(HTTPException) as e:
        await manav.action_leave_request(
            "10000000-0000-0000-0000-000000000001",
            manav.LeaveAction(status="rejected"),
            user=USER, org_id="org1", levels=ADMIN,
        )
    assert e.value.status_code == 400
    assert not _silent_except(emitted)


# ── employee.joined (site 1: POST /employees) ────────────────────────────────

_EMP_ROW = {
    "id": "e-new", "org_id": "org1", "user_id": None,
    "name": "Rahul", "employee_code": "EMP002",
    "department": "Engineering", "designation": "Developer",
    "is_active": True, "status": "active",
}


async def test_creating_an_employee_emits_joined(pool, emitted):
    _dispatch(pool, {"INSERT INTO staging.manav_employees": _EMP_ROW})

    out = await manav.create_employee(
        manav.EmployeeCreate(name="Rahul", employee_code="EMP002",
                             department="Engineering", designation="Developer"),
        user=USER, org_id="org1", levels=ADMIN,
    )

    # RETURNING * feeds the emitter; the RESPONSE keeps its three keys — a
    # personnel row carries PAN/Aadhaar/bank and none of that may leave here.
    assert set(out) == {"status", "id", "name", "employee_code"}
    (conn, kw), = emitted["employee_joined"].calls
    assert conn is pool
    assert kw["employee_id"] == "e-new"
    assert kw["row"]["department"] == "Engineering"
    assert kw["actor_id"] == "u-admin"
    assert not _silent_except(emitted, "employee_joined")


async def test_a_refused_hire_emits_nothing(pool, emitted):
    with pytest.raises(HTTPException) as e:
        await manav.create_employee(
            manav.EmployeeCreate(name="Rahul"),
            user=USER, org_id="org1", levels=NOBODY,   # no admin grant
        )
    assert e.value.status_code == 403
    assert not _silent_except(emitted)
    assert not pool.calls, "a refused hire must ask the database nothing"


# ── employee.joined (site 2: hiring a candidate ALSO births the row) ─────────

async def test_hiring_a_candidate_emits_joined_for_that_row_creation(pool, emitted):
    _dispatch(pool, {
        "SELECT * FROM staging.manav_candidates": {
            "id": "c1", "converted_employee_id": None,
            "full_name": "Rahul", "email": "r@x.in", "phone": "9",
        },
        "INSERT INTO staging.manav_employees": _EMP_ROW,
    })

    out = await manav.hire_candidate(
        "c0000000-0000-0000-0000-000000000001",
        user=USER, org_id="org1", levels=ADMIN,
    )

    assert out["ok"] is True
    (conn, kw), = emitted["employee_joined"].calls
    assert conn is pool
    assert kw["employee_id"] == "e-new"
    assert not _silent_except(emitted, "employee_joined")


async def test_rehiring_a_converted_candidate_emits_nothing(pool, emitted):
    # The guard that keeps "one event per actual row creation" true: a
    # candidate already converted creates no second row and no second event.
    _dispatch(pool, {
        "SELECT * FROM staging.manav_candidates":
            {"id": "c1", "converted_employee_id": "e-old"},
    })
    with pytest.raises(HTTPException) as e:
        await manav.hire_candidate(
            "c0000000-0000-0000-0000-000000000001",
            user=USER, org_id="org1", levels=ADMIN,
        )
    assert e.value.status_code == 400
    assert not _silent_except(emitted)


# ── employee.exited ──────────────────────────────────────────────────────────

_OFFBOARDING = {
    "id": "ob1", "employee_id": "e1", "exit_type": "retirement",
    "status": "in_progress", "employee_name": "Priya Sharma",
    "clearance": [{"item": "laptop", "done": True}],
}

_EXITING_EMP = dict(_EMP_ROW, id="e1", user_id="login-9",
                    is_active=False, status="resigned")


async def test_completing_offboarding_emits_exited_with_the_exit_type(pool, emitted):
    _dispatch(pool, {
        "SELECT o.*, e.name AS employee_name": _OFFBOARDING,
        "UPDATE staging.manav_employees": _EXITING_EMP,
    })

    out = await manav.complete_offboarding(
        "0b000000-0000-0000-0000-000000000001",
        user=USER, org_id="org1", levels=ADMIN,
    )

    assert out["status"] == "completed"
    (conn, kw), = emitted["employee_exited"].calls
    assert conn is pool
    assert kw["employee_id"] == "e1"
    assert kw["exit_type"] == "retirement", \
        "exit_type rides from the offboarding row's CHECK vocabulary"
    assert kw["row"]["user_id"] == "login-9"
    assert not _silent_except(emitted, "employee_exited")


async def test_completion_refused_on_pending_clearance_emits_nothing(pool, emitted):
    _dispatch(pool, {
        "SELECT o.*, e.name AS employee_name": dict(
            _OFFBOARDING, clearance=[{"item": "laptop", "done": False}],
        ),
    })
    with pytest.raises(HTTPException) as e:
        await manav.complete_offboarding(
            "0b000000-0000-0000-0000-000000000001",
            user=USER, org_id="org1", levels=ADMIN,
        )
    assert e.value.status_code == 409
    assert not _silent_except(emitted)


async def test_completing_twice_emits_nothing_the_second_time(pool, emitted):
    _dispatch(pool, {
        "SELECT o.*, e.name AS employee_name":
            dict(_OFFBOARDING, status="completed"),
    })
    with pytest.raises(HTTPException) as e:
        await manav.complete_offboarding(
            "0b000000-0000-0000-0000-000000000001",
            user=USER, org_id="org1", levels=ADMIN,
        )
    assert e.value.status_code == 409
    assert not _silent_except(emitted)


# ── expense.claimed ──────────────────────────────────────────────────────────

_CLAIM_ROW = {
    "id": "cl-1", "org_id": "org1", "employee_id": "e1",
    "category": "travel", "amount": 1200.0, "status": "pending",
    "expense_date": "2026-08-01", "description": "",
}


async def test_claiming_an_expense_emits(pool, emitted):
    _dispatch(pool, {
        "SELECT id FROM staging.manav_employees": {"id": "e1"},
        "INSERT INTO staging.manav_expense_claims": _CLAIM_ROW,
    })
    _fetchval_returns(pool, "login-1")

    out = await manav.create_expense_claim(
        manav.ExpenseClaimCreate(category="travel", expense_date="2026-08-01",
                                 amount=1200),
        user=USER, org_id="org1", levels=NOBODY,   # own claim is self-service
    )

    assert out["id"] == "cl-1"
    (conn, kw), = emitted["expense_claimed"].calls
    assert conn is pool
    assert kw["claim_id"] == "cl-1"
    assert kw["row"]["amount"] == 1200.0
    assert kw["employee_user_id"] == "login-1"
    assert not _silent_except(emitted, "expense_claimed")


async def test_a_nonpositive_claim_emits_nothing(pool, emitted):
    with pytest.raises(HTTPException) as e:
        await manav.create_expense_claim(
            manav.ExpenseClaimCreate(category="travel",
                                     expense_date="2026-08-01", amount=0),
            user=USER, org_id="org1", levels=NOBODY,
        )
    assert e.value.status_code == 400
    assert not _silent_except(emitted)
    assert not pool.calls


# ── expense.decided ──────────────────────────────────────────────────────────
#
# 'paid' is deliberately NOT here: disbursement is Vetana's fact, not an HR
# decision, so only approve and reject emit — one event, the decision in the
# payload, exactly like leave.decided.

@pytest.fixture
def as_org_admin(monkeypatch):
    async def _yes(pool, user, org_id):
        return True

    monkeypatch.setattr(manav, "_is_org_admin", _yes)


@pytest.mark.parametrize("handler,decision", [
    ("approve_expense_claim", "approved"),
    ("reject_expense_claim", "rejected"),
])
async def test_deciding_a_claim_emits_the_decision(pool, emitted, as_org_admin,
                                                   handler, decision):
    _dispatch(pool, {
        "UPDATE staging.manav_expense_claims": dict(_CLAIM_ROW, status=decision),
        "SELECT name, email FROM staging.manav_employees": None,   # no notify
    })
    _fetchval_returns(pool, "login-1")

    args = ["cl-1"]
    if handler == "reject_expense_claim":
        args.append(manav.ExpenseClaimAction(status="rejected",
                                             rejection_reason="no receipt"))
    out = await getattr(manav, handler)(
        *args, user=USER, org_id="org1", levels=ADMIN,
    )

    assert out["status"] == decision
    (conn, kw), = emitted["expense_decided"].calls
    assert conn is pool
    assert kw["decision"] == decision
    assert kw["claim_id"] == "cl-1"
    assert kw["employee_user_id"] == "login-1"
    assert kw["actor_id"] == "u-admin"
    assert not _silent_except(emitted, "expense_decided")


@pytest.mark.parametrize("handler", ["approve_expense_claim", "reject_expense_claim"])
async def test_deciding_a_claim_that_is_not_pending_emits_nothing(
    pool, emitted, as_org_admin, handler,
):
    # The UPDATE's `status='pending'` filter misses → 404 raised BEFORE the
    # emitter, inside the transaction, which unwinds having announced nothing.
    args = ["cl-1"]
    if handler == "reject_expense_claim":
        args.append(manav.ExpenseClaimAction(status="rejected"))
    with pytest.raises(HTTPException) as e:
        await getattr(manav, handler)(*args, user=USER, org_id="org1", levels=ADMIN)
    assert e.value.status_code == 404
    assert not _silent_except(emitted)


@pytest.mark.parametrize("handler", ["approve_expense_claim", "reject_expense_claim"])
async def test_a_non_admin_decision_emits_nothing(pool, emitted, monkeypatch, handler):
    async def _no(pool, user, org_id):
        return False

    monkeypatch.setattr(manav, "_is_org_admin", _no)
    args = ["cl-1"]
    if handler == "reject_expense_claim":
        args.append(manav.ExpenseClaimAction(status="rejected"))
    with pytest.raises(HTTPException) as e:
        await getattr(manav, handler)(*args, user=USER, org_id="org1", levels=ADMIN)
    assert e.value.status_code == 403
    assert not _silent_except(emitted)
