"""
Shift bids: the half that awards them.

── WHAT WAS HALF-BUILT ───────────────────────────────────────────────────────

`staging.manav_shift_bids` and `manav_shift_bid_responses` have existed since
migration 027. Three of the four things a bid needs were built:

  · `POST /shift-bids`               — a manager opens a shift to the org
  · `GET  /shift-bids`               — the open bids, with a RESPONSE COUNT
  · `POST /shift-bids/{id}/apply`    — an employee volunteers

The fourth, `POST /shift-bids/{bid}/accept/{employee}`, existed as a route and
was unreachable in practice, because NOTHING ANYWHERE RETURNED THE APPLICANTS.
`GET /shift-bids` answers `responses` — an integer. A manager could see that
four people had volunteered and had no endpoint, and no screen, that would tell
them which four. There is no way to supply `{employee_id}` to the award route
without already knowing a uuid the product never shows you.

So the loop was: post a shift, employees apply, and the shift is never awarded.
`ScheduleGrid`'s coverage panel ends with "A shift covered by fewer than expected
is a gap to fill — post it under Bids", which pointed at the dead end.

Three defects in `accept_bid` itself, all of which only became reachable once
the applicants were visible:

  1. IT AWARDED TO ANYONE. The UPDATE on the responses table matched zero rows
     for an employee who had never applied, and the code carried on and wrote
     the schedule row regardless. A bid is a claim that someone volunteered; an
     award to a non-applicant is a roster assignment wearing a bid's clothes,
     and it inflates nothing while looking like consent.
  2. THE BID NEVER CLOSED. `status` stayed 'open' forever, so a one-slot shift
     could be awarded to six people and stayed at the top of the Bids list
     asking for a seventh. 027's CHECK already allows 'filled'; nothing wrote it.
  3. A SETTLED BID COULD BE AWARDED AGAIN. Nothing looked at `status`, so a
     cancelled bid was as awardable as an open one.

── WHAT THESE TESTS PIN ──────────────────────────────────────────────────────

The applicant list exists; an award requires an application; the last slot
closes the bid; a closed bid refuses. The cross-org half of the same endpoint
lives in `test_manav_cross_org_writes.py`.
"""

import pytest

BID_ID = "b0000000-0000-0000-0000-000000000001"
SHIFT_ID = "50000000-0000-0000-0000-000000000001"
EMP_A = "e0000000-0000-0000-0000-00000000000a"
EMP_B = "e0000000-0000-0000-0000-00000000000b"


def _bid(slots_needed=1, status="open"):
    return {
        "id": BID_ID,
        "shift_id": SHIFT_ID,
        "date": "2026-08-10",
        "slots_needed": slots_needed,
        "status": status,
    }


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def levels(app):
    from routers.manav import _gate

    def _set(*held):
        app.dependency_overrides[_gate] = lambda: frozenset(held)

    return _set


# ── The applicants ────────────────────────────────────────────────────────────

async def test_a_bid_lists_who_applied(api_client, mock_pool, as_admin, with_org_id):
    """The endpoint that made the award route reachable at all."""
    mock_pool.fetchrow.return_value = _bid(slots_needed=2)
    mock_pool.fetch.return_value = [
        {
            "id": "r1", "employee_id": EMP_A, "employee_name": "Priya Sharma",
            "employee_code": "EMP001", "status": "applied",
            "created_at": "2026-08-06T09:00:00Z",
        },
        {
            "id": "r2", "employee_id": EMP_B, "employee_name": "Rahul Verma",
            "employee_code": "EMP002", "status": "accepted",
            "created_at": "2026-08-06T09:05:00Z",
        },
    ]

    resp = await api_client.get(f"/api/v1/manav/shift-bids/{BID_ID}/responses")

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert [r["employee_name"] for r in payload["data"]] == ["Priya Sharma", "Rahul Verma"]
    # The manager needs the arithmetic as well as the names: two slots, one
    # already awarded, so one left. Derived here rather than in the browser so
    # every surface says the same number.
    assert payload["slots_needed"] == 2
    assert payload["slots_awarded"] == 1
    assert payload["bid_status"] == "open"


async def test_the_applicant_list_needs_more_than_self_scope(
    api_client, mock_pool, as_admin, with_org_id, levels,
):
    """It names other employees, so it is a viewer read and not a self-scope one.

    `GET /shift-bids` is deliberately readable with no grant — an open bid names
    nobody. The moment the answer is a list of colleagues, that stops being true.
    """
    levels()  # holds nothing
    mock_pool.fetchrow.return_value = _bid()

    resp = await api_client.get(f"/api/v1/manav/shift-bids/{BID_ID}/responses")

    assert resp.status_code == 403, resp.text


async def test_a_bid_from_another_org_has_no_applicants_to_show(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchrow.return_value = None

    resp = await api_client.get(f"/api/v1/manav/shift-bids/{BID_ID}/responses")

    assert resp.status_code == 404, resp.text
    # The route's own 404 and not FastAPI's "Not Found" for an unrouted path —
    # before this endpoint existed, the second assertion was the only thing
    # telling the two apart.
    assert resp.json()["detail"] == "Bid not found"
    assert mock_pool.fetch.await_count == 0


# ── The award ─────────────────────────────────────────────────────────────────

async def test_awarding_to_somebody_who_never_applied_is_refused(
    api_client, mock_pool, as_admin, with_org_id,
):
    """A bid is a record that somebody volunteered.

    The UPDATE used to match nothing and the code wrote the schedule row anyway,
    so 'accepted a bid' and 'was rostered by a manager' became the same row with
    the same provenance.
    """
    mock_pool.fetchrow.side_effect = [
        _bid(),   # the bid
        None,     # UPDATE ... RETURNING — this employee has no response row
    ]
    # `side_effect`, not `return_value` — the `as_admin` fixture installs its own
    # fetchval side_effect to answer the platform-role probe, and a side_effect
    # wins over a return_value. A test that sets the wrong one here gets 0 back
    # and passes for the wrong reason.
    mock_pool.fetchval.side_effect = [EMP_A]   # they ARE in this org

    resp = await api_client.post(f"/api/v1/manav/shift-bids/{BID_ID}/accept/{EMP_A}")

    assert resp.status_code == 404, resp.text
    assert "applied" in resp.json()["detail"].lower()
    # No roster row and no status change.
    assert mock_pool.execute.await_count == 0


async def test_awarding_the_last_slot_closes_the_bid(
    api_client, mock_pool, as_admin, with_org_id,
):
    """027's CHECK has allowed 'filled' since the table was created; nothing
    ever wrote it, so a one-slot shift stayed on the open list after it was
    covered and kept collecting applications nobody could honour."""
    mock_pool.fetchrow.side_effect = [
        _bid(slots_needed=1),
        {"id": "r1"},                      # the response row, now accepted
    ]
    mock_pool.fetchval.side_effect = [
        EMP_A,   # employee is in this org
        1,       # accepted responses after this award
    ]

    resp = await api_client.post(f"/api/v1/manav/shift-bids/{BID_ID}/accept/{EMP_A}")

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["slots_awarded"] == 1
    assert payload["bid_status"] == "filled"

    statements = " ".join(str(c.args[0]) for c in mock_pool.execute.await_args_list)
    assert "manav_schedules" in statements
    assert "'filled'" in statements


async def test_a_bid_with_a_slot_left_stays_open(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchrow.side_effect = [_bid(slots_needed=3), {"id": "r1"}]
    mock_pool.fetchval.side_effect = [EMP_A, 1]

    resp = await api_client.post(f"/api/v1/manav/shift-bids/{BID_ID}/accept/{EMP_A}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["bid_status"] == "open"
    statements = " ".join(str(c.args[0]) for c in mock_pool.execute.await_args_list)
    assert "'filled'" not in statements


async def test_a_settled_bid_cannot_be_awarded_again(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchrow.return_value = _bid(status="cancelled")

    resp = await api_client.post(f"/api/v1/manav/shift-bids/{BID_ID}/accept/{EMP_A}")

    assert resp.status_code == 409, resp.text
    assert mock_pool.execute.await_count == 0


# ── Applying ──────────────────────────────────────────────────────────────────

async def test_applying_to_a_settled_bid_is_refused(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Volunteering for a shift that is already covered raises an expectation
    the roster will not meet. It used to be accepted silently and counted."""
    mock_pool.fetchval.side_effect = [EMP_A]         # the caller's own employee row
    mock_pool.fetchrow.side_effect = [
        {"status": "filled"},                        # the bid
    ]

    resp = await api_client.post(f"/api/v1/manav/shift-bids/{BID_ID}/apply")

    assert resp.status_code == 409, resp.text
