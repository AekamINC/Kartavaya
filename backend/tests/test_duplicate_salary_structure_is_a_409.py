"""A second salary structure on the same effective date must be a 409, not a 500.

── THE DEFECT ──────────────────────────────────────────────────────────────

`vetana_salary_structures` carries `UNIQUE (org_id, employee_id,
effective_from)` and `create_structure` had no handler for it. So recording a
salary a second time from the same date — a correction typed twice, a revision
entered against the date already on file, a form resubmitted after a slow
response — returned:

    HTTP 500  {"detail":"Internal server error"}

The constraint is RIGHT to refuse: two structures effective the same morning
make "what is this person paid in September" ambiguous, and the payroll run
would pick whichever the planner reached first. What was wrong is that the
refusal named nothing, so the natural next action is to try again and fail
identically.

── HOW IT WAS FOUND, WHICH IS THE POINT ────────────────────────────────────

By RE-RUNNING the payroll seed against production. The first run created the
structure; the second got the 500. A once-only seed would never have seen it,
and no test did — `create_web_form` has answered 409 for this exact shape since
it was written, so the pattern was already in the codebase.
"""
import json

import asyncpg
import pytest
from fastapi import HTTPException

import routers.vetana as vetana

ORG = "11111111-1111-1111-1111-111111111111"
EMP = "22222222-2222-2222-2222-222222222222"
ACTOR = {"user_id": "user_admin001"}


class _Pool:
    """Employee lookup succeeds; the INSERT raises the real asyncpg error."""

    def __init__(self, on_insert=None):
        self.on_insert = on_insert
        self.inserted = []

    async def fetchval(self, q, *a):
        return 1 if "manav_employees" in q else None

    async def fetchrow(self, q, *a):
        if "INSERT INTO public.vetana_salary_structures" in q:
            if self.on_insert:
                raise self.on_insert
            self.inserted.append(a)
            return {"id": "s-1", "employee_id": EMP, "basic": 40000}
        return None


@pytest.fixture
def patched(monkeypatch):
    def use(pool):
        async def _get_pool():
            return pool
        monkeypatch.setattr(vetana, "get_pool", _get_pool)
        monkeypatch.setattr(vetana, "_require", lambda *a, **k: None)
        return pool
    return use


def _body():
    return vetana.SalaryStructureCreate(
        employee_id=EMP, effective_from="2026-04-01",
        ctc_annual=960000, basic=40000, hra=20000)


async def test_a_duplicate_answers_409_and_says_what_to_do(patched):
    patched(_Pool(on_insert=asyncpg.exceptions.UniqueViolationError(
        "duplicate key value violates unique constraint")))

    with pytest.raises(HTTPException) as raised:
        await vetana.create_structure(
            body=_body(), user=ACTOR, org_id=ORG, levels=["admin"])

    assert raised.value.status_code == 409, (
        "a duplicate must not surface as an unexplained 500")
    detail = str(raised.value.detail)
    # It has to NAME the date and say how to proceed. A 409 that says only
    # "conflict" is the same dead end the 500 was.
    assert "2026-04-01" in detail
    assert "already exists" in detail
    assert "revision" in detail or "Edit" in detail


async def test_the_ordinary_case_still_writes(patched):
    """THE ANTI-VACUITY FLOOR.

    A handler that raised 409 unconditionally would satisfy the test above
    while making it impossible to record any salary at all.
    """
    pool = patched(_Pool())

    out = await vetana.create_structure(
        body=_body(), user=ACTOR, org_id=ORG, levels=["admin"])

    assert out["id"] == "s-1"
    assert len(pool.inserted) == 1, "the structure was not written"


async def test_a_missing_employee_is_still_a_404_not_a_409(patched):
    """The new except must not swallow the tenancy check above it.

    `create_structure` refuses an employee outside the caller's org BEFORE the
    INSERT — that is the cross-tenant guard, and it must keep its own status.
    """
    class _NoEmployee(_Pool):
        async def fetchval(self, q, *a):
            return None

    patched(_NoEmployee())

    with pytest.raises(HTTPException) as raised:
        await vetana.create_structure(
            body=_body(), user=ACTOR, org_id=ORG, levels=["admin"])
    assert raised.value.status_code == 404


async def test_an_unrelated_database_error_is_NOT_turned_into_a_409(patched):
    """The except clause is narrow on purpose.

    Catching every exception here would turn a genuine fault — a bad cast, a
    dropped column, a connection lost mid-statement — into "you already have
    one", which is the failure-into-silence shape this codebase keeps finding.
    """
    patched(_Pool(on_insert=asyncpg.exceptions.PostgresSyntaxError("boom")))

    with pytest.raises(asyncpg.exceptions.PostgresSyntaxError):
        await vetana.create_structure(
            body=_body(), user=ACTOR, org_id=ORG, levels=["admin"])
