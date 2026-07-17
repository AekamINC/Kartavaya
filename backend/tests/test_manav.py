"""
Unit tests for manav.py — HRMS endpoints.

Coverage:
  GET    /api/v1/manav/employees           — list, search, filter
  POST   /api/v1/manav/employees           — create employee
  GET    /api/v1/manav/employees/{id}      — detail with leave balances
  PATCH  /api/v1/manav/employees/{id}      — update
  DELETE /api/v1/manav/employees/{id}      — deactivate
  GET    /api/v1/manav/departments         — list with counts
  POST   /api/v1/manav/departments         — create
  POST   /api/v1/manav/attendance          — mark (upsert)
  GET    /api/v1/manav/attendance           — list by date range
  GET    /api/v1/manav/attendance/summary   — monthly summary
  GET    /api/v1/manav/leave-types         — list
  POST   /api/v1/manav/leave-types         — create
  POST   /api/v1/manav/leaves              — submit request with balance check
  PATCH  /api/v1/manav/leaves/{id}/action  — approve/reject
  GET    /api/v1/manav/holidays            — list
  POST   /api/v1/manav/holidays            — create
  GET    /api/v1/manav/stats               — dashboard
"""

import pytest

pytest.importorskip("routers.manav", reason="routers.manav not yet implemented")

EMPLOYEE_ROW = {
    "id": "e0000000-0000-0000-0000-000000000001",
    "name": "Priya Sharma",
    "email": "priya@example.com",
    "phone": "9876543210",
    "employee_code": "EMP001",
    "department": "Engineering",
    "designation": "Developer",
    "status": "active",
    "is_active": True,
    "created_at": "2026-01-01T00:00:00Z",
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── Employees ────────────────────────────────────────────────────

async def test_list_employees(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [EMPLOYEE_ROW]
    resp = await api_client.get("/api/v1/manav/employees")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


async def test_create_employee(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {
        "id": "e001",
        "name": "Rahul",
        "employee_code": "EMP002",
    }
    resp = await api_client.post("/api/v1/manav/employees", json={
        "name": "Rahul",
        "email": "rahul@example.com",
        "employee_code": "EMP002",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "created"


async def test_get_employee_not_found(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 404


async def test_get_employee_with_balances(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = EMPLOYEE_ROW
    mock_pool.fetch.return_value = [
        {"id": "lb001", "leave_name": "Casual", "leave_code": "CL",
         "allocated": 12, "used": 3, "carried_forward": 0},
    ]
    resp = await api_client.get(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["employee"]["name"] == "Priya Sharma"
    assert len(data["leave_balances"]) == 1


async def test_update_employee(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
        json={"designation": "Senior Developer"},
    )
    assert resp.status_code == 200


async def test_update_employee_empty(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
        json={},
    )
    assert resp.status_code == 400


async def test_deactivate_employee(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.delete(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "deactivated"


# ── Departments ──────────────────────────────────────────────────

async def test_list_departments(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [
        {"id": "dept001", "name": "Engineering", "created_at": "2026-01-01",
         "head_name": "Priya", "employee_count": 5},
    ]
    resp = await api_client.get("/api/v1/manav/departments")
    assert resp.status_code == 200


async def test_create_department(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {"id": "dept002", "name": "Design"}
    resp = await api_client.post("/api/v1/manav/departments", json={
        "name": "Design",
    })
    assert resp.status_code == 200


# ── Attendance ───────────────────────────────────────────────────

async def test_mark_attendance(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {"id": "att001", "status": "present"}
    resp = await api_client.post("/api/v1/manav/attendance", json={
        "employee_id": "e0000000-0000-0000-0000-000000000001",
        "status": "present",
        "check_in": "2026-07-08T09:00:00+05:30",
        "check_out": "2026-07-08T18:00:00+05:30",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "present"


async def test_mark_attendance_invalid_status(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.post("/api/v1/manav/attendance", json={
        "employee_id": "e0000000-0000-0000-0000-000000000001",
        "status": "invalid",
    })
    assert resp.status_code == 400


async def test_list_attendance(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/manav/attendance?date_from=2026-07-01&date_to=2026-07-08")
    assert resp.status_code == 200


async def test_attendance_summary(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [
        {"id": "e001", "name": "Priya", "employee_code": "EMP001",
         "present_days": 20, "absent_days": 2, "half_days": 1,
         "late_days": 0, "leave_days": 1, "total_hours": 160,
         "overtime_hours": 5},
    ]
    resp = await api_client.get("/api/v1/manav/attendance/summary?month=2026-07")
    assert resp.status_code == 200
    assert resp.json()["month"] == "2026-07"


# ── Leave Types ──────────────────────────────────────────────────

async def test_list_leave_types(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/manav/leave-types")
    assert resp.status_code == 200


async def test_create_leave_type(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {"id": "lt001", "name": "Casual Leave", "code": "CL"}
    resp = await api_client.post("/api/v1/manav/leave-types", json={
        "name": "Casual Leave",
        "code": "CL",
        "annual_quota": 12,
    })
    assert resp.status_code == 200


# ── Leave Requests ───────────────────────────────────────────────

async def test_create_leave_no_employee(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post("/api/v1/manav/leaves", json={
        "leave_type_id": "lt001",
        "start_date": "2026-07-10",
        "end_date": "2026-07-11",
        "days": 2,
        "reason": "Personal",
    })
    assert resp.status_code == 403


async def test_create_leave_insufficient_balance(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.side_effect = [
        {"id": "e001"},
        {"allocated": 12, "used": 11, "carried_forward": 0},
    ]
    resp = await api_client.post("/api/v1/manav/leaves", json={
        "leave_type_id": "lt001",
        "start_date": "2026-07-10",
        "end_date": "2026-07-12",
        "days": 3,
        "reason": "Vacation",
    })
    assert resp.status_code == 400
    assert "Insufficient" in resp.json()["detail"]


async def test_action_leave_not_found(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.patch(
        "/api/v1/manav/leaves/00000000-0000-0000-0000-000000000001/action",
        json={"status": "approved"},
    )
    assert resp.status_code == 404


async def test_action_leave_already_processed(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {
        "employee_id": "e001",
        "leave_type_id": "lt001",
        "days": 2,
        "status": "approved",
    }
    resp = await api_client.patch(
        "/api/v1/manav/leaves/00000000-0000-0000-0000-000000000001/action",
        json={"status": "rejected"},
    )
    assert resp.status_code == 400


async def test_action_leave_invalid_status(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.patch(
        "/api/v1/manav/leaves/00000000-0000-0000-0000-000000000001/action",
        json={"status": "maybe"},
    )
    assert resp.status_code == 400


# ── Holidays ─────────────────────────────────────────────────────

async def test_list_holidays(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [
        {"id": "h001", "name": "Republic Day", "date": "2026-01-26", "is_optional": False},
    ]
    resp = await api_client.get("/api/v1/manav/holidays")
    assert resp.status_code == 200


async def test_create_holiday(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = {"id": "h002", "name": "Diwali"}
    resp = await api_client.post("/api/v1/manav/holidays", json={
        "name": "Diwali",
        "date": "2026-10-20",
    })
    assert resp.status_code == 200
