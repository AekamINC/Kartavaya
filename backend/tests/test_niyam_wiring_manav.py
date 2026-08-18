"""The six HR events are emitted by the writes that own them — and only there.

Wired 2026-08-18: leave.requested, leave.decided, employee.joined,
employee.exited, expense.claimed, expense.decided. Every emitter is awaited on
the SAME connection as the business write, inside its transaction (emit.py's
one rule), and none of them fires on a refusal path.

The fake pool USED to follow `tests/test_target_attainment.py`, lending the
pool itself back as the connection with a no-op `transaction()` — which made
"the emitter rode the write's connection inside its transaction" vacuously
satisfiable: calling the emitter on the bare pool, with no transaction at all,
passed `conn is pool`. Now `acquire()` lends a DISTINCT `_Conn` (appended to
`pool.lent`) that proxies every call back into the pool's ledger/answer
machinery, and `_Conn.transaction()` flips `in_tx` on entry and exit. Each
recorder captures the conn AND `in_tx` at call time, so the assertions demand
all three: the conn was lent by this pool's acquire(), it is not the pool, and
the transaction was open at the moment of emission. Mutant-proven: handing an
emitter the pool, or hoisting it outside the transaction, fails these tests.

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


# ── the fake pool (strengthened past test_target_attainment.py's idiom) ──────

class _Conn:
    """A connection lent by `_Pool.acquire()` — distinct from the pool, so
    `conn is pool` can never be satisfied by an autocommit pool-level call.

    Every query proxies back to the pool's CURRENT fetch/fetchrow/fetchval/
    execute (looked up at call time, so `_dispatch`/`_fetchval_returns`
    monkeypatching keeps working), landing in the one ledger the tests read.
    `in_tx` is True exactly while `transaction()` is open.
    """

    def __init__(self, pool):
        self._pool = pool
        self.in_tx = False

    async def fetch(self, q, *a):
        return await self._pool.fetch(q, *a)

    async def fetchrow(self, q, *a):
        return await self._pool.fetchrow(q, *a)

    async def fetchval(self, q, *a):
        return await self._pool.fetchval(q, *a)

    async def execute(self, q, *a):
        return await self._pool.execute(q, *a)

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(_s):
                conn.in_tx = True
                return _s

            async def __aexit__(_s, *exc):
                conn.in_tx = False
                return False
        return _T()


class _Pool:
    def __init__(self):
        self.calls = []
        self.lent = []   # every _Conn acquire() ever handed out

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

    # The wired writes run inside a transaction with the Niyam emitter. The
    # pool lends a DISTINCT _Conn per acquire() — never itself — and records
    # it, so the tests can prove the emitter's conn came from acquire().
    # The pool deliberately has NO transaction() method: the pool is not a
    # connection, and giving it one is what made the old idiom vacuous.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                conn = _Conn(pool)
                pool.lent.append(conn)
                return conn

            async def __aexit__(_s, *exc):
                return False
        return _A()


class _Recorder:
    """Stands in for one emitter; remembers every call it was awaited with —
    the conn, AND whether that conn's transaction was open at call time
    (captured NOW, because `in_tx` is False again by the time asserts run)."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, getattr(conn, "in_tx", False), kw))
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


def _sole_emission_inside_the_write(pool, rec):
    """The recorder fired exactly once, on a conn THIS pool's acquire() lent
    (never the pool itself), while that conn's transaction was open. This is
    emit.py's one rule, stated so a pool-level or hoisted call cannot pass."""
    (conn, in_tx, kw), = rec.calls
    assert conn is not pool, \
        "emitter was handed the POOL — an autocommit call, not the write's conn"
    assert conn in pool.lent, \
        "emitter's conn was never lent by this pool's acquire()"
    assert in_tx, \
        "emitter ran with the conn's transaction closed — outside the write's transaction"
    return conn, kw


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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["leave_requested"])
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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["leave_decided"])
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


async def test_losing_the_decision_race_is_a_409_and_emits_nothing(pool, emitted):
    # The read-then-decide gap: the pre-check read `pending` off the pool, but
    # by the time the transaction's UPDATE ran, a rival decision had landed.
    # The UPDATE's own `AND org_id AND status='pending'` transition guard
    # matches zero rows — RETURNING answers None — and the handler must turn
    # that into a 409 with NOTHING emitted, because no state changed here.
    _dispatch(pool, {
        "SELECT employee_id, leave_type_id, days, status": _PENDING_LR,
        # deliberately NO answer for the UPDATE: the guarded write missed
    })
    with pytest.raises(HTTPException) as e:
        await manav.action_leave_request(
            "10000000-0000-0000-0000-000000000001",
            manav.LeaveAction(status="approved"),
            user=USER, org_id="org1", levels=ADMIN,
        )
    assert e.value.status_code == 409
    assert not _silent_except(emitted)

    # Pin the guard itself, not just the fake's answer: the decision UPDATE
    # must carry the org fence and the pending transition in its WHERE, and
    # bind the caller's org — that is what makes the loser match zero rows on
    # a real database rather than double-deciding.
    (upd_q, upd_args), = [
        (q, a) for q, a in pool.calls
        if q.startswith("UPDATE staging.manav_leave_requests")
    ]
    assert "AND org_id=" in upd_q
    assert "AND status='pending'" in upd_q
    assert "RETURNING" in upd_q
    assert "org1" in upd_args


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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["employee_joined"])
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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["employee_joined"])
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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["employee_exited"])
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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["expense_claimed"])
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
    conn, kw = _sole_emission_inside_the_write(pool, emitted["expense_decided"])
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
