"""
A Manav write must never name an employee outside the caller's organisation.

── WHAT WAS WRONG ────────────────────────────────────────────────────────────

Four write paths in `routers/manav.py` took an `employee_id` (and in two cases a
`shift_id`) straight from the request body or the URL and wrote a row with the
CALLER'S `org_id` beside it. Nothing checked that the id named a row in that
org:

  · `POST /schedules`                        — assign_schedule
  · `POST /schedules/bulk`                   — bulk_assign
  · `POST /shift-bids/{bid}/accept/{emp}`    — accept_bid
  · `POST /attendance`                       — mark_attendance

The comparison that makes this a defect rather than a theoretical one is inside
this same file. `POST /swaps` already carries the check and states the reason in
prose: "The schedule must also be in this org. Without that check a uuid from
another tenant could be attached to a row here, and `GET /swaps` joins through it
and would print that tenant's employee name." Every sentence of that is true of
the four endpoints above, and `GET /schedules` and `GET /attendance` both join
`manav_employees` on id alone with the org filter on the SCHEDULE row — so the
foreign employee's name and code come back.

`assign_schedule` is the worst of the four because it does not stop at a row. It
looks the employee up with `WHERE id=$1::uuid` — no org — and, if that row has an
email, SENDS THEM A SHIFT ROSTER EMAIL. A stranger's employee learns they are on
a night shift at a company they have never worked for.

These need an editor grant, so the attacker is an ordinary HR editor in any
tenant plus a guessed uuid. That is a low bar for "writes into another tenant's
personnel data and emails their staff", and it is the direction of the check that
matters: an id that does not resolve in this org must be a 404, not a write.

── WHAT THESE TESTS PIN ──────────────────────────────────────────────────────

One test per endpoint, each asserting the 404 AND that no row was written. The
`assign_schedule` one additionally asserts the email was never handed off,
because a 404 that still sends the mail is the same incident with a tidier
status code.
"""

from unittest.mock import AsyncMock, patch

import pytest

FOREIGN_EMPLOYEE = "e0000000-0000-0000-0000-0000000000ff"
FOREIGN_SHIFT = "50000000-0000-0000-0000-0000000000ff"
BID_ID = "b0000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """Editor on Manav — the level all four of these endpoints require. The
    point of every test here is that a legitimate editor in tenant A still
    cannot reach into tenant B, so the grant is deliberately present."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


# ── POST /schedules ───────────────────────────────────────────────────────────

async def test_assigning_a_schedule_to_a_foreign_employee_is_refused(
    api_client, mock_pool, as_admin, with_org_id,
):
    # The org-membership probe finds nothing. Everything after it is set up to
    # succeed, so a passing test can only mean the probe stopped the request.
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.side_effect = [
        {"id": "5c000000-0000-0000-0000-000000000001"},
        {"name": "Someone Else", "email": "success+foreign@simulator.amazonses.com"},
        {"name": "Night", "start_time": "22:00", "end_time": "06:00"},
    ]

    with patch(
        "services.employee_email.send_shift_schedule_email", new=AsyncMock()
    ) as sender:
        resp = await api_client.post(
            "/api/v1/manav/schedules",
            json={
                "employee_id": FOREIGN_EMPLOYEE,
                "shift_id": FOREIGN_SHIFT,
                "date": "2026-08-10",
            },
        )

    assert resp.status_code == 404, resp.text
    # No INSERT, and — the part that makes this more than a bad row — no mail.
    assert mock_pool.fetchrow.await_count == 0
    assert sender.await_count == 0
    assert sender.call_count == 0


async def test_bulk_assign_refuses_the_whole_batch_on_a_foreign_employee(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Refused whole, not partially applied.

    A batch that writes the rows it likes and 404s on the one it does not leaves
    the caller unable to say what happened, and leaves a half-built roster
    behind. The ids are checked before anything is written.
    """
    mock_pool.fetchval.return_value = None

    resp = await api_client.post(
        "/api/v1/manav/schedules/bulk",
        json={
            "assignments": [
                {
                    "employee_id": FOREIGN_EMPLOYEE,
                    "shift_id": FOREIGN_SHIFT,
                    "date": "2026-08-10",
                },
            ]
        },
    )

    assert resp.status_code == 404, resp.text
    assert mock_pool.execute.await_count == 0


# ── POST /attendance ──────────────────────────────────────────────────────────

async def test_marking_attendance_for_a_foreign_employee_is_refused(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.return_value = {"id": "a1", "status": "present"}

    resp = await api_client.post(
        "/api/v1/manav/attendance",
        json={"employee_id": FOREIGN_EMPLOYEE, "date": "2026-08-10", "status": "present"},
    )

    assert resp.status_code == 404, resp.text
    assert mock_pool.fetchrow.await_count == 0


# ── POST /shift-bids/{bid_id}/accept/{employee_id} ────────────────────────────

async def test_awarding_a_bid_to_a_foreign_employee_is_refused(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The bid is this org's; the employee is not.

    Without the check this wrote a `manav_schedules` row carrying this org's
    org_id and another tenant's employee_id — the roster then lists a name that
    belongs to a company the reader has never heard of.
    """
    mock_pool.fetchrow.return_value = {
        "id": BID_ID,
        "shift_id": "50000000-0000-0000-0000-000000000001",
        "date": "2026-08-10",
        "slots_needed": 1,
        "status": "open",
    }
    mock_pool.fetchval.return_value = None

    resp = await api_client.post(
        f"/api/v1/manav/shift-bids/{BID_ID}/accept/{FOREIGN_EMPLOYEE}"
    )

    assert resp.status_code == 404, resp.text
    assert mock_pool.execute.await_count == 0
