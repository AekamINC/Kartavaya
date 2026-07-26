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


# ── Employee PII masking ─────────────────────────────────────────
# `manav_employees` carries Aadhaar, PAN and bank details on the same row as the
# name, and the module gate grants on membership with no role level — so a module
# viewer reaches the detail endpoint. These tests pin the two properties that
# keep that safe: the detail endpoint never emits a full identifier, and the full
# values live behind a separate gate.

EMPLOYEE_ROW_WITH_PII = {
    **EMPLOYEE_ROW,
    "aadhaar": "123456789012",
    "pan": "ABCDE1234F",
    "bank_details": {
        "account_number": "50100123456789",
        "ifsc": "HDFC0001234",
        "bank_name": "HDFC Bank",
        "account_name": "Priya Sharma",
    },
}


async def test_get_employee_masks_identity_documents(
    api_client, mock_pool, as_admin, with_org_id
):
    """The detail endpoint must never return a full Aadhaar, PAN or account
    number, whatever the caller's role."""
    mock_pool.fetchrow.return_value = EMPLOYEE_ROW_WITH_PII
    mock_pool.fetch.return_value = []
    resp = await api_client.get(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 200
    emp = resp.json()["employee"]

    assert emp["aadhaar"] != "123456789012"
    assert emp["pan"] != "ABCDE1234F"
    assert emp["bank_details"]["account_number"] != "50100123456789"

    # Last four survive so HR can confirm which document is on file.
    assert emp["aadhaar"].endswith("9012")
    assert emp["pan"].endswith("234F")
    assert emp["bank_details"]["account_number"].endswith("6789")
    assert emp["_pii_masked"] is True

    # Public routing data is not secret and stays legible.
    assert emp["bank_details"]["ifsc"] == "HDFC0001234"

    # Nothing anywhere in the payload leaks the raw values.
    body = resp.text
    assert "123456789012" not in body
    assert "ABCDE1234F" not in body
    assert "50100123456789" not in body


async def test_get_employee_masking_handles_missing_documents(
    api_client, mock_pool, as_admin, with_org_id
):
    """Absent is not the same as hidden — empty stays empty so the UI can tell
    "not on file" from "masked"."""
    mock_pool.fetchrow.return_value = {
        **EMPLOYEE_ROW, "aadhaar": None, "pan": "", "bank_details": None,
    }
    mock_pool.fetch.return_value = []
    resp = await api_client.get(
        "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001",
    )
    assert resp.status_code == 200
    emp = resp.json()["employee"]
    assert emp["aadhaar"] is None
    assert emp["pan"] == ""
    assert emp["bank_details"] is None


async def test_sensitive_endpoint_returns_full_values_when_authorised(
    app, api_client, mock_pool, as_admin, with_org_id
):
    from routers.manav import _pii_gate
    app.dependency_overrides[_pii_gate] = lambda: None
    try:
        mock_pool.fetchrow.return_value = {
            "id": EMPLOYEE_ROW["id"], "name": "Priya Sharma",
            "employee_code": "EMP001",
            "aadhaar": "123456789012", "pan": "ABCDE1234F",
            "bank_details": {"account_number": "50100123456789"},
        }
        resp = await api_client.get(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001/sensitive",
        )
        assert resp.status_code == 200
        emp = resp.json()["employee"]
        assert emp["aadhaar"] == "123456789012"
        assert emp["pan"] == "ABCDE1234F"
        # The caller is told the read was recorded.
        assert resp.json()["audited"] is True
    finally:
        app.dependency_overrides.pop(_pii_gate, None)


async def test_sensitive_endpoint_404_for_other_org(
    app, api_client, mock_pool, as_admin, with_org_id
):
    from routers.manav import _pii_gate
    app.dependency_overrides[_pii_gate] = lambda: None
    try:
        mock_pool.fetchrow.return_value = None
        resp = await api_client.get(
            "/api/v1/manav/employees/e0000000-0000-0000-0000-000000000001/sensitive",
        )
        assert resp.status_code == 404
    finally:
        app.dependency_overrides.pop(_pii_gate, None)


# ── Masking helpers ──────────────────────────────────────────────

def test_mask_tail_keeps_last_four():
    from routers.manav import _mask_tail
    assert _mask_tail("123456789012", 4) == "••••••••9012"


def test_mask_tail_groups_aadhaar():
    from routers.manav import _mask_tail
    assert _mask_tail("123456789012", 4, group=4) == "•••• •••• 9012"


def test_mask_tail_short_value_fully_masked():
    """A value shorter than the reveal window must not become the reveal."""
    from routers.manav import _mask_tail
    assert _mask_tail("123", 4) == "•••"


def test_mask_tail_passes_through_empty():
    from routers.manav import _mask_tail
    assert _mask_tail(None) is None
    assert _mask_tail("") == ""


def test_mask_bank_masks_only_the_account_number():
    from routers.manav import _mask_bank
    out = _mask_bank({
        "account_number": "50100123456789",
        "ifsc": "HDFC0001234",
        "bank_name": "HDFC Bank",
    })
    assert out["account_number"].endswith("6789")
    assert "50100123456789" not in out["account_number"]
    assert out["ifsc"] == "HDFC0001234"
    assert out["bank_name"] == "HDFC Bank"


def test_mask_bank_does_not_mutate_input():
    from routers.manav import _mask_bank
    original = {"account_number": "50100123456789"}
    _mask_bank(original)
    assert original["account_number"] == "50100123456789"
