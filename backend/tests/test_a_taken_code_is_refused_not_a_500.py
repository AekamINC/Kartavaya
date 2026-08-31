"""A duplicate employee code told the administrator their network was broken.

── THE DEFECT, FROM THE LIVE TRACEBACK ────────────────────────────────────────

`idx_manav_emp_code` is `UNIQUE (org_id, employee_code) WHERE employee_code IS
NOT NULL`, and it is CORRECT — a code must not be re-used, because payslips,
attendance and the asset register all identify a person through it.

What was missing was anybody catching the refusal. `create_employee` INSERTed
with no `ON CONFLICT` and no `except`, so `asyncpg.exceptions.
UniqueViolationError` escaped the handler. Sentry PYTHON-FASTAPI-1P, six events,
last 2026-08-31T20:19:29Z, at `routers/manav.py:1324`.

⚠ AND THE MESSAGE THE CUSTOMER GOT WAS THE WORST POSSIBLE ONE.
The exception propagates OUTWARD past `CORSMiddleware` into
`ServerErrorMiddleware`, which sits outside it — so the 500 carries no
`Access-Control-Allow-Origin`. The browser reports `net::ERR_FAILED` with no
response event at all, and `frontend/src/pages/manav/_shared.jsx:123` answers a
null response with:

    "No response from the server — check your connection."

So the product told an administrator that THEIR OWN NETWORK was broken, when the
server had refused their write for a reason it knew exactly. That is the one
message that makes somebody stop looking at what they typed.

⚠ AND THE CODE MAY BE HELD BY SOMEBODY THEY CANNOT SEE.
The employee directory applies `still_on_the_rolls()`, so anybody whose last
working day has passed is hidden from every list — while their code stays taken.
Four people hold codes on the live org that way today. A refusal saying only
"already exists" would send an admin to search a list the holder is not in.

── THE SAME SHAPE, TWICE ──────────────────────────────────────────────────────

`create_asset` carried it too, 3,300 lines away in the same file, against
`idx_assets_tag`. No live event yet — closed because it is the same defect, not
because it has cost anybody anything.

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

That both routes answer 409 with a message an admin can act on, that the 409
survives (nobody "helpfully" widens the except back to a 500), and — the one
that matters most — that a NON-unique database error is still allowed to
propagate. An `except Exception` that swallows everything would be the
fail-open shape this codebase keeps finding: a real fault reported as a tidy
409 about a code that was never the problem.
"""
import pytest


class FakeUniqueViolation(Exception):
    """asyncpg raises with `sqlstate` on the exception; `_pg_code` reads it
    without importing asyncpg into the router."""
    sqlstate = "23505"


class FakeUndefinedColumn(Exception):
    """42703. A genuine fault that must NOT be dressed up as a 409."""
    sqlstate = "42703"


EMPLOYEE = {
    "employee_code": "S7-03", "name": "Someone New",
    "email": "someone@example.invalid", "date_of_joining": "2026-08-01",
}
ASSET = {"asset_tag": "AST-S7-24", "name": "A laptop", "category": "laptop"}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: ["admin", "editor", "viewer"]
    yield
    app.dependency_overrides.pop(_gate, None)


def _raise(exc):
    async def boom(*_a, **_k):
        raise exc
    return boom


class TestADuplicateEmployeeCode:
    @pytest.mark.anyio
    async def test_it_is_a_409_and_not_a_500(
        self, api_client, mock_pool, as_admin, with_org_id, monkeypatch,
    ):
        monkeypatch.setattr(mock_pool, "acquire", _acquire_raising(FakeUniqueViolation()))
        r = await api_client.post("/api/v1/manav/employees", json=EMPLOYEE)
        assert r.status_code == 409, (
            f"a taken employee code answered {r.status_code}. A 500 here carries "
            f"no CORS headers, so the browser reports net::ERR_FAILED and the "
            f"screen tells the admin their own connection is broken"
        )

    @pytest.mark.anyio
    async def test_the_refusal_names_the_code_and_the_remedy(
        self, api_client, mock_pool, as_admin, with_org_id, monkeypatch,
    ):
        monkeypatch.setattr(mock_pool, "acquire", _acquire_raising(FakeUniqueViolation()))
        r = await api_client.post("/api/v1/manav/employees", json=EMPLOYEE)
        detail = str(r.json()["detail"])
        assert "S7-03" in detail, "the refusal does not say WHICH code is taken"
        assert "different code" in detail.lower(), "the refusal names no remedy"

    @pytest.mark.anyio
    async def test_it_warns_that_the_holder_may_be_invisible(
        self, api_client, mock_pool, as_admin, with_org_id, monkeypatch,
    ):
        """⚠ THE HALF AN ADMIN CANNOT WORK OUT ALONE.

        `still_on_the_rolls()` hides a leaver from every employee list while
        their code stays theirs. Without this sentence the admin searches a
        list the holder is not in, finds nothing, and concludes the product is
        wrong — which is exactly what happened to Suite 07.2.
        """
        monkeypatch.setattr(mock_pool, "acquire", _acquire_raising(FakeUniqueViolation()))
        r = await api_client.post("/api/v1/manav/employees", json=EMPLOYEE)
        detail = str(r.json()["detail"]).lower()
        assert "left" in detail and "hides" in detail, (
            "the refusal does not warn that the code may belong to somebody the "
            "employee list does not show"
        )

    @pytest.mark.anyio
    async def test_a_different_database_error_is_still_a_fault(
        self, api_client, mock_pool, as_admin, with_org_id, monkeypatch,
    ):
        """⚠ THE ASSERTION THAT STOPS THE FIX BECOMING THE NEXT DEFECT.

        An `except Exception` that answered 409 to everything would report a
        missing column, a type error or a dead connection as a tidy message
        about a code that was never the problem — the fail-open shape this
        codebase keeps finding. Only 23505 may be caught.
        """
        monkeypatch.setattr(mock_pool, "acquire", _acquire_raising(FakeUndefinedColumn()))
        with pytest.raises(FakeUndefinedColumn):
            await api_client.post("/api/v1/manav/employees", json=EMPLOYEE)


class TestADuplicateAssetTag:
    @pytest.mark.anyio
    async def test_it_is_a_409_and_names_the_tag(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.side_effect = FakeUniqueViolation()
        r = await api_client.post("/api/v1/manav/assets", json=ASSET)
        assert r.status_code == 409
        assert "AST-S7-24" in str(r.json()["detail"])

    @pytest.mark.anyio
    async def test_a_different_database_error_is_still_a_fault(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.side_effect = FakeUndefinedColumn()
        with pytest.raises(FakeUndefinedColumn):
            await api_client.post("/api/v1/manav/assets", json=ASSET)


def _acquire_raising(exc):
    """`create_employee` writes inside `pool.acquire()` / `conn.transaction()`,
    so the failure has to be raised from the connection the block obtains."""
    class _Conn:
        def transaction(self):
            return _Txn()

        async def fetchrow(self, *_a, **_k):
            raise exc

        async def fetchval(self, *_a, **_k):
            return None

        async def execute(self, *_a, **_k):
            return None

    class _Txn:
        async def __aenter__(self):
            return None

        async def __aexit__(self, *_a):
            return False

    class _Acquire:
        async def __aenter__(self):
            return _Conn()

        async def __aexit__(self, *_a):
            return False

    def acquire(*_a, **_k):
        return _Acquire()

    return acquire
