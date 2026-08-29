"""The professional-tax ladder, as something a person can set.

The hole this closes
--------------------
NOTHING in this product could write `staging.pay_professional_tax`. Every
reference in `backend/` was a read — `routers/vetana.py::_pt_slabs` and
`services/skills/data/payroll_statutory.py` — and the nine live rows exist
because a migration put them there. So a state nobody seeded, a rate change, or
Maharashtra's different February figure could only be fixed by shipping another
migration.

That is the same shape as every Phase-1 defect: a column with no write path.

What must never happen
----------------------
**A shared row must not be editable by an organisation.** `org_id IS NULL` is
national reference data read by everybody; letting one firm PATCH or DELETE it
would change every other firm's payroll deductions from inside their own
settings screen. That is the single most dangerous thing these four endpoints
could do, so it is the first thing tested — and it is tested on both write verbs
and on the read, because a list that hid the shared rows would send an
administrator to create duplicates of bands that already apply to them.

What must never block
---------------------
Owner's rule, 2026-08-26: like GSTIN, PAN and TAN this is OPTIONAL and must
block nothing. An org that sets nothing keeps the shared ladder; an org that
sets a partial one falls back through it; no match at all deducts zero, which is
the owner's existing decision. The only refusal here is a band that could never
match anything, refused at the moment somebody types it — a refusal to SAVE, and
never a refusal to run payroll.

Why the tests are shaped like this
----------------------------------
`routers/messaging.py:30-41` records what a mocked pool is worth: a fake cursor
resolves any table name handed to it, so an HTTP test proves the handler asked,
never that the database could answer. So these assert what HTTP can — which SQL
was issued, what was bound to it, and which status came back.
"""
import pytest

pytestmark = pytest.mark.asyncio

SHARED_ROW = {
    "id": 1, "state_code": "27", "state_name": "Maharashtra",
    "slab_from": 10001, "slab_to": None, "monthly_tax": 200,
    "effective_from": None, "month": None, "is_own": True,
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """`_gate` is `require_module_or_self("vetana")` and its VALUE is the
    caller's Tier-4 level set. Who may reach Vetana at all is
    `test_vetana_security.py`'s subject, not this file's."""
    from routers.vetana import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


class TestASharedRowIsReadByEveryoneAndEditableByNobody:
    """The tenancy rule. Four endpoints, one thing that must not happen."""

    async def test_the_update_is_scoped_to_the_callers_own_rows(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The WHERE clause must name org_id. Without it, `id=1` is somebody
        else's Maharashtra band and this endpoint rewrites the national ladder.
        """
        mock_pool.fetchrow.return_value = SHARED_ROW
        r = await api_client.patch("/api/v1/vetana/pt-slabs/1",
                                   json={"monthly_tax": 300})
        assert r.status_code == 200, r.text
        # Both the ownership pre-read and the UPDATE itself must be scoped.
        for call in mock_pool.fetchrow.call_args_list:
            sql = call[0][0]
            assert "org_id=$" in sql.replace(" ", ""), sql

    async def test_the_delete_is_scoped_to_the_callers_own_rows(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.execute.return_value = "DELETE 1"
        r = await api_client.delete("/api/v1/vetana/pt-slabs/1")
        assert r.status_code == 200, r.text
        sql = mock_pool.execute.call_args[0][0]
        assert "org_id=$" in sql.replace(" ", ""), sql
        assert "DELETE FROM public.pay_professional_tax" in sql

    async def test_a_row_that_is_not_yours_is_a_404_and_not_a_403(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """A distinct refusal would confirm that somebody else's row is there.
        404 is the same answer a row that does not exist gets."""
        mock_pool.fetchrow.return_value = None
        r = await api_client.patch("/api/v1/vetana/pt-slabs/1",
                                   json={"monthly_tax": 300})
        assert r.status_code == 404, r.text

    async def test_deleting_a_row_that_is_not_yours_is_a_404(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.execute.return_value = "DELETE 0"
        r = await api_client.delete("/api/v1/vetana/pt-slabs/1")
        assert r.status_code == 404, r.text

    async def test_the_list_shows_shared_rows_as_well_as_the_orgs_own(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """A screen showing only the org's own rows would present an empty
        ladder as "nothing is deducted" while nine shared bands were doing the
        work — and send an administrator to duplicate bands that already apply.
        """
        mock_pool.fetch.return_value = []
        r = await api_client.get("/api/v1/vetana/pt-slabs")
        assert r.status_code == 200, r.text
        sql = mock_pool.fetch.call_args[0][0]
        assert "org_id IS NULL" in sql, sql
        assert "is_own" in sql, sql


class TestTheWritePathItself:

    async def test_a_created_band_belongs_to_the_calling_org(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """Never a NULL org_id. A create that wrote one would silently add to
        the ladder every other organisation reads."""
        mock_pool.fetchrow.return_value = SHARED_ROW
        r = await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "state_name": "Maharashtra",
            "slab_from": 10001, "monthly_tax": 300, "month": 2,
        })
        assert r.status_code == 200, r.text
        sql, *params = mock_pool.fetchrow.call_args[0]
        assert "INSERT INTO public.pay_professional_tax" in sql
        assert "$1::uuid" in sql, "org_id is not bound as the first parameter"
        assert params[0], "org_id was bound empty"

    async def test_the_month_reaches_the_insert(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = SHARED_ROW
        await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "monthly_tax": 300, "month": 2,
        })
        sql, *params = mock_pool.fetchrow.call_args[0]
        assert "month" in sql
        assert 2 in params, params

    async def test_no_month_binds_null_meaning_every_month(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """NULL is EVERY month, which is what all nine seeded rows are. Binding
        anything else would make an ordinary band apply to one month only."""
        mock_pool.fetchrow.return_value = SHARED_ROW
        await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "monthly_tax": 200,
        })
        params = mock_pool.fetchrow.call_args[0][1:]
        assert params[-1] is None, params

    async def test_an_iso_date_is_not_bound_straight_into_a_date_param(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """`::text::date`, never a bare `::date` on a string. This repo has paid
        for that bind twice — the statement of account 500'd on it for as long
        as it had existed, and the pivot dashboard still does."""
        mock_pool.fetchrow.return_value = SHARED_ROW
        await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "monthly_tax": 200, "effective_from": "2026-04-01",
        })
        sql = mock_pool.fetchrow.call_args[0][0]
        assert "::text::date" in sql, sql

    async def test_clearing_a_figure_back_is_possible(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """`monthly_tax = 0` is a real answer — a band a state levies nothing on
        — and must stay distinguishable from "not mentioned", or a figure
        entered by mistake can never be corrected to zero."""
        mock_pool.fetchrow.return_value = SHARED_ROW
        r = await api_client.patch("/api/v1/vetana/pt-slabs/1",
                                   json={"monthly_tax": 0})
        assert r.status_code == 200, r.text
        sql = mock_pool.fetchrow.call_args_list[-1][0][0]
        assert "monthly_tax=$" in sql.replace(" ", ""), sql


class TestItRefusesOnlyWhatCouldNeverMatch:
    """Save-time validation. None of this can stop a payroll run."""

    async def test_a_band_ending_below_its_start_is_refused(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        r = await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "slab_from": 20000, "slab_to": 10000,
            "monthly_tax": 200,
        })
        assert r.status_code == 400, r.text
        assert "below where it starts" in r.text

    async def test_a_blank_upper_bound_means_and_above_and_is_allowed(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        mock_pool.fetchrow.return_value = SHARED_ROW
        r = await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "slab_from": 10001, "monthly_tax": 200,
        })
        assert r.status_code == 200, r.text

    async def test_a_month_outside_the_year_is_refused(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        r = await api_client.post("/api/v1/vetana/pt-slabs", json={
            "state_code": "27", "monthly_tax": 200, "month": 13,
        })
        assert r.status_code == 400, r.text

    async def test_a_band_with_no_state_is_still_accepted(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """NOTHING HERE IS MANDATORY. A half-entered ladder is a normal state of
        a settings screen somebody is part-way through, and refusing it would
        make this the blocking field the owner's rule forbids. A band naming no
        state simply matches no employee — which `_pt_from_slabs` already reads
        as zero, without raising.
        """
        mock_pool.fetchrow.return_value = SHARED_ROW
        r = await api_client.post("/api/v1/vetana/pt-slabs",
                                  json={"state_code": "", "monthly_tax": 200})
        assert r.status_code == 200, r.text
