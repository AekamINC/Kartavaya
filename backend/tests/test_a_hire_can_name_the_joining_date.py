"""A hire could only ever start TODAY, which is the one day onboarding cannot use.

── THE DEFECT ─────────────────────────────────────────────────────────────────

`hire_candidate` wrote the personnel row with the joining date hardcoded:

    "VALUES ($1::uuid, $2, $3, $4, CURRENT_DATE, 'full_time', $5) "

So every person hired through recruitment joined on the day somebody clicked
the button. There was no way to record a joiner starting on the 1st of next
month — and that is precisely the case onboarding exists for. Everything you
want to happen BEFORE somebody arrives (issue the laptop, raise the login,
collect the signed offer) has to be scheduled against a date that is not today,
and the product could not hold one.

`employee.joined` fires at row creation, so with a hardcoded CURRENT_DATE the
event and the start date were the same instant by construction. Nothing could
ever be scheduled ahead of a joiner because no future date existed to schedule
against.

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

The new field, and — as importantly — the four things it must NOT change.
`RecruitmentTab.jsx` posts to this route with NO BODY AT ALL, so a hire that
names nothing has to keep behaving exactly as it did. A change that made the
body required would break the only caller in the product.

It also pins the seat gate this path was missing. `create_employee` calls
`assert_pahchan_seat_available` and its comment claims its INSERT is "the ONLY"
moment somebody joins the attendance roster — "One admission, one gate." This
route births an employee row too and did not call it, so an org at its Pahchan
cap could take on unlimited people by routing them through recruitment.
"""
import pytest

CAND = "cb7d48e5-831c-40d3-b9c8-2dd1f7d4e652"
PATH = f"/api/v1/manav/candidates/{CAND}/hire"


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """The module gate is not what is under test; the hire body is."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: ["admin", "editor", "viewer"]
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def quiet_emitter(monkeypatch):
    """`employee.joined` has its own wiring suite; this file is about the INSERT."""
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr("routers.manav.employee_joined", _noop)


@pytest.fixture(autouse=True)
def open_seats(monkeypatch):
    """The seat gate reads a plan row the mock pool has no idea about.

    Left alone it dies on `KeyError: 'seat_limit'` inside `seat_model.py` — a
    harness gap that reads exactly like a refused hire. `TestTheSecondDoorIsGatedToo`
    overrides this with its own spy, which is the only place the gate is the
    thing under test.
    """
    async def _open(*a, **k):
        return None
    monkeypatch.setattr("routers.manav.assert_pahchan_seat_available", _open)


def unconverted(mock_pool):
    """A candidate who has not yet been hired, then the row the INSERT returns."""
    mock_pool.fetchrow.side_effect = [
        {"id": CAND, "full_name": "Bhavin Chokshi", "email": "b@example.com",
         "phone": "9900000000", "stage": "offer", "converted_employee_id": None},
        {"id": "0efbf133-1626-462e-be7b-fb3f1b0adfee", "name": "Bhavin Chokshi"},
    ]


def insert_call(mock_pool):
    """The INSERT is the second fetchrow — the first is the candidate lookup."""
    for call in mock_pool.fetchrow.await_args_list:
        if "INSERT INTO public.manav_employees" in str(call.args[0]):
            return call
    raise AssertionError("no INSERT into manav_employees was issued")


class TestTheJoiningDateCanBeNamed:
    @pytest.mark.anyio
    async def test_a_future_date_is_bound(self, api_client, mock_pool, as_admin, with_org_id):
        """The whole point: hire somebody who starts next month."""
        unconverted(mock_pool)
        r = await api_client.post(PATH, json={"date_of_joining": "2026-10-01"})
        assert r.status_code == 200, r.text
        assert "2026-10-01" in insert_call(mock_pool).args, (
            "the joining date the caller named never reached the INSERT"
        )

    @pytest.mark.anyio
    async def test_the_date_is_no_longer_hardcoded(self, api_client, mock_pool, as_admin, with_org_id):
        """⚠ THE REGRESSION GUARD.

        A bare `CURRENT_DATE` in the VALUES list is the defect itself. It must
        only ever appear inside the COALESCE that supplies the default.
        """
        unconverted(mock_pool)
        await api_client.post(PATH, json={"date_of_joining": "2026-10-01"})
        sql = " ".join(str(insert_call(mock_pool).args[0]).split())
        assert "COALESCE(NULLIF($5,'')::date, CURRENT_DATE)" in sql, (
            "the joining date is not defaulted through COALESCE — if this is a "
            "bare CURRENT_DATE again, every hire starts today"
        )

    @pytest.mark.anyio
    async def test_department_and_designation_reach_the_row(self, api_client, mock_pool, as_admin, with_org_id):
        """`manav_candidates` holds neither, so the hire is the first place to say them."""
        unconverted(mock_pool)
        await api_client.post(PATH, json={
            "department": "Audit", "designation": "Article Assistant"})
        args = insert_call(mock_pool).args
        assert "Audit" in args and "Article Assistant" in args


class TestTheOldCallerIsUntouched:
    """`RecruitmentTab.jsx` sends no body. That must keep working."""

    @pytest.mark.anyio
    async def test_no_body_at_all_still_hires(self, api_client, mock_pool, as_admin, with_org_id):
        unconverted(mock_pool)
        r = await api_client.post(PATH)
        assert r.status_code == 200, (
            f"a hire with no body was refused — this is how the only caller in "
            f"the product posts: {r.text}"
        )

    @pytest.mark.anyio
    async def test_an_omitted_date_binds_empty_so_the_server_supplies_today(
            self, api_client, mock_pool, as_admin, with_org_id):
        """Empty string, NOT a Python-computed date.

        Computing `date.today()` here would take the date off the API container
        rather than the database, and the two can sit on different sides of
        midnight. The COALESCE keeps one clock.
        """
        unconverted(mock_pool)
        await api_client.post(PATH, json={})
        # args[0] is the SQL, so $1 is args[1] and $5 — date_of_joining — is args[5].
        assert insert_call(mock_pool).args[5] == "", (
            "the omitted date did not bind as '' — the COALESCE cannot fire"
        )

    @pytest.mark.anyio
    async def test_an_omitted_employment_type_still_defaults_to_full_time(
            self, api_client, mock_pool, as_admin, with_org_id):
        unconverted(mock_pool)
        await api_client.post(PATH, json={})
        sql = " ".join(str(insert_call(mock_pool).args[0]).split())
        assert "COALESCE(NULLIF($6,''), 'full_time')" in sql


class TestBadInputIsRefusedBeforeTheWrite:
    @pytest.mark.anyio
    async def test_a_malformed_date_is_a_400_that_names_the_field(
            self, api_client, mock_pool, as_admin, with_org_id):
        """Not a 500.

        Left to the `::date` cast, a malformed date is an asyncpg DataError —
        and through PgBouncer that is an instant 500 with no useful log line,
        which is the failure mode `CLAUDE.md` warns about for untyped
        parameter expressions.
        """
        unconverted(mock_pool)
        r = await api_client.post(PATH, json={"date_of_joining": "01-10-2026"})
        assert r.status_code == 400, r.text
        assert "date_of_joining" in str(r.json().get("detail", ""))

    @pytest.mark.anyio
    async def test_a_malformed_date_writes_nothing(
            self, api_client, mock_pool, as_admin, with_org_id):
        """⚠ REFUSED BEFORE THE INSERT, NOT AFTER IT."""
        unconverted(mock_pool)
        await api_client.post(PATH, json={"date_of_joining": "not-a-date"})
        sql = " ".join(str(c.args[0]) for c in mock_pool.fetchrow.await_args_list)
        assert "INSERT INTO public.manav_employees" not in sql, (
            "a personnel record was written for a hire that was refused"
        )

    @pytest.mark.anyio
    async def test_an_unknown_employment_type_is_refused(
            self, api_client, mock_pool, as_admin, with_org_id):
        """The same tuple `create_employee` checks. Two birth sites, one vocabulary."""
        unconverted(mock_pool)
        r = await api_client.post(PATH, json={"employment_type": "freelance"})
        assert r.status_code == 400
        assert "full_time" in str(r.json().get("detail", ""))


class TestTheSecondDoorIsGatedToo:
    @pytest.mark.anyio
    async def test_the_pahchan_seat_gate_runs_on_this_path(
            self, api_client, mock_pool, as_admin, with_org_id, monkeypatch):
        """`create_employee` says "One admission, one gate". There were two doors.

        Latent rather than live — no org has `max_pahchan_seats` set — but a cap
        switched on later would have been enforced at one door of two.
        """
        called = []

        async def _spy(pool, org_id):
            called.append(org_id)

        monkeypatch.setattr("routers.manav.assert_pahchan_seat_available", _spy)
        unconverted(mock_pool)
        r = await api_client.post(PATH, json={})
        assert r.status_code == 200, r.text
        assert called, (
            "hiring a candidate never consulted the attendance seat cap, so an "
            "org at its limit can still take people on through recruitment"
        )

    @pytest.mark.anyio
    async def test_a_refused_seat_writes_no_personnel_file(
            self, api_client, mock_pool, as_admin, with_org_id, monkeypatch):
        from fastapi import HTTPException

        async def _full(pool, org_id):
            raise HTTPException(402, "No attendance seats remain.")

        monkeypatch.setattr("routers.manav.assert_pahchan_seat_available", _full)
        unconverted(mock_pool)
        r = await api_client.post(PATH, json={})
        assert r.status_code == 402
        sql = " ".join(str(c.args[0]) for c in mock_pool.fetchrow.await_args_list)
        assert "INSERT INTO public.manav_employees" not in sql
