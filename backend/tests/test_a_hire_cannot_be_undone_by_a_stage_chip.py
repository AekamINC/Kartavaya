"""A hire is the end of the recruitment pipeline, and a chip could undo it.

── THE DEFECT, FOUND IN THE LIVE DATA ─────────────────────────────────────────

`hire_candidate` refuses to convert the same candidate twice — the guard is
explicit and it has a message. NOTHING refused the reverse. `PATCH
/candidates/{id}/stage` would move a candidate who ALREADY HAD an employee
record back to `offer`, back to `screening`, or mark them `rejected`, and the
row would then contradict itself: the recruitment register saying the offer is
still open while the personnel register has the person on the payroll.

Suite 07.7 found it by reading what was there. Bhavin Chokshi, Unicode Group:

    converted_employee_id  0efbf133-1626-462e-be7b-fb3f1b0adfee
    stage                  offer
    updated_at             2026-08-31 09:40:49+00

The suite reported "no write request was made at all" — because its own loop
skips a candidate that is already converted, and then asserted the stage was
`hired`. One row product-wide; migration 248 repaired it.

── WHY IT IS NOT COSMETIC, IN THE ORDER A CUSTOMER MEETS IT ───────────────────

  · The candidate card re-offers the whole pipeline INCLUDING **Hire**, and
    `hire_candidate` answers that click `400 Candidate has already been
    converted to an employee`. A control that can only fail is a dead control,
    which is precisely the shape Suite 22 exists to find.
  · `rejected` against somebody who is already an employee is a record that
    contradicts the personnel register sitting next to it.
  · The recruitment funnel counts by stage. A hired person parked at `offer`
    undercounts hires and overcounts live offers, for as long as the row stands.

── WHAT THIS FILE PINS ────────────────────────────────────────────────────────

The refusal, and — as importantly — the four things it must NOT refuse. A
guard that also blocks ordinary pipeline movement would be a worse defect than
the one it fixes, because every recruitment screen in the product depends on
this one route.
"""
import pytest


CAND = "cb7d48e5-831c-40d3-b9c8-2dd1f7d4e652"
EMP = "0efbf133-1626-462e-be7b-fb3f1b0adfee"
PATH = f"/api/v1/manav/candidates/{CAND}/stage"


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """The module gate is not what is under test; the stage guard is."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: ["admin", "editor", "viewer"]
    yield
    app.dependency_overrides.pop(_gate, None)


def converted(mock_pool, employee_id):
    """`fetchval` answers the converted-employee probe; `fetchrow` the UPDATE.

    ⚠ `side_effect`, NOT `return_value` — `as_admin` installs its own fetchval
    side_effect for the role lookup and that wins over a return_value, which is
    the note `test_manav.py::test_mark_attendance` already carries.
    """
    mock_pool.fetchval.side_effect = [employee_id]
    mock_pool.fetchrow.return_value = {
        "id": CAND, "full_name": "Bhavin Chokshi", "stage": "hired",
        "converted_employee_id": employee_id,
    }


class TestAConvertedCandidateCannotBeMovedBack:
    @pytest.mark.anyio
    @pytest.mark.parametrize("stage", ["applied", "screening", "interview", "offer", "rejected"])
    async def test_every_stage_but_hired_is_refused(self, api_client, mock_pool, as_admin, with_org_id, stage):
        converted(mock_pool, EMP)
        r = await api_client.patch(PATH, json={"stage": stage})
        assert r.status_code == 409, (
            f"a candidate with a personnel record was moved to '{stage}'. The "
            f"recruitment register now contradicts the personnel register, and "
            f"the card re-offers a Hire button that can only answer 400"
        )

    @pytest.mark.anyio
    async def test_the_refusal_names_the_remedy(self, api_client, mock_pool, as_admin, with_org_id):
        """A refusal a person cannot act on is the failure mode this suite tracks.

        Somebody looking at this screen is usually trying to record that the
        person is LEAVING. That is a different register and a different
        decision, and no amount of editing the candidate row is it — so the
        message has to say where to go.
        """
        converted(mock_pool, EMP)
        r = await api_client.patch(PATH, json={"stage": "rejected"})
        detail = str(r.json().get("detail", "")).lower()
        assert "already been hired" in detail
        assert "exit" in detail, "the refusal does not name offboarding as the way out"
        assert "rejected" in detail, "the refusal does not say which move was refused"

    @pytest.mark.anyio
    async def test_the_write_never_happened(self, api_client, mock_pool, as_admin, with_org_id):
        """⚠ REFUSED BEFORE THE UPDATE, NOT AFTER IT.

        A 409 raised after the row had already been written would report the
        rule and break it in the same request — the fail-open shape this
        codebase keeps finding, where the handler's own exception path is what
        makes the damage invisible.
        """
        converted(mock_pool, EMP)
        await api_client.patch(PATH, json={"stage": "offer"})
        sql = " ".join(str(c.args[0]) for c in mock_pool.fetchrow.await_args_list)
        assert "UPDATE public.manav_candidates" not in sql, (
            "the stage UPDATE ran and THEN the request was refused"
        )


class TestWhatItMustStillAllow:
    """⚠ THE HALF THAT MATTERS MORE.

    Every recruitment screen in the product moves a candidate through this one
    route. A guard that also blocked ordinary movement would be a worse defect
    than the one it fixes, and it would look exactly like a working fix from
    the refusal tests above.
    """

    @pytest.mark.anyio
    @pytest.mark.parametrize("stage", ["applied", "screening", "interview", "offer", "rejected"])
    async def test_an_unconverted_candidate_moves_freely(
        self, api_client, mock_pool, as_admin, with_org_id, stage,
    ):
        mock_pool.fetchval.side_effect = [None]          # never hired
        mock_pool.fetchrow.return_value = {
            "id": CAND, "full_name": "Arjun Rana", "stage": stage,
            "converted_employee_id": None,
        }
        r = await api_client.patch(PATH, json={"stage": stage})
        assert r.status_code == 200, (
            f"a candidate who has NOT been hired can no longer be moved to "
            f"'{stage}' — the guard is reading the wrong thing and the whole "
            f"recruitment pipeline is frozen"
        )

    @pytest.mark.anyio
    async def test_hired_to_hired_is_not_refused(self, api_client, mock_pool, as_admin, with_org_id):
        """Idempotence. `hire_candidate` already wrote `stage='hired'`, so a
        screen re-sending the value it can see must not be told off for it."""
        converted(mock_pool, EMP)
        r = await api_client.patch(PATH, json={"stage": "hired"})
        assert r.status_code == 200

    @pytest.mark.anyio
    async def test_an_invalid_stage_is_still_a_400_not_a_409(
        self, api_client, mock_pool, as_admin, with_org_id,
    ):
        """The stage vocabulary is checked FIRST, and stays a 400.

        Ordering matters for the caller: 'that is not a stage' and 'that stage
        is not available for this person' are different problems with different
        fixes, and collapsing them into one code loses the difference.
        """
        converted(mock_pool, EMP)
        r = await api_client.patch(PATH, json={"stage": "promoted"})
        assert r.status_code == 400
        assert "must be one of" in str(r.json().get("detail", ""))
