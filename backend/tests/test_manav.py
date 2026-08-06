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
    # `get_employee` compares this against the caller to decide whether the row
    # is the caller's own. Priya is deliberately somebody else.
    "user_id": "user_other999",
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
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set, so overriding it is how a test says what the caller holds.

    The default here is `admin`, which is what the tests below were written
    against: they exercise the HR flows — create an employee, mark attendance,
    approve leave — and every one of those is an HR action. The level is lowered
    per-test with the `levels` fixture; the self-scope section at the bottom of
    this file is where "holds nothing" is asserted.
    """
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def levels(app):
    """Lower (or raise) the caller's Manav level set for one test."""
    from routers.manav import _gate

    def _set(*held):
        app.dependency_overrides[_gate] = lambda: frozenset(held)

    return _set


# ── Employees ────────────────────────────────────────────────────

async def test_list_employees(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = [EMPLOYEE_ROW]
    resp = await api_client.get("/api/v1/manav/employees")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


async def test_create_employee(api_client, mock_pool, as_admin, with_org_id):
    # The seat keys answer the attendance-seat read that runs just before the
    # INSERT (`services/seat_model.count_pahchan_seats`). `seat_limit: None` is
    # the uncapped state every live organisation is in, so the hire is admitted.
    mock_pool.fetchrow.return_value = {
        "id": "e001",
        "name": "Rahul",
        "employee_code": "EMP002",
        "seat_limit": None, "roster": 0, "exempt": 0, "module_active": True,
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


# ══════════════════════════════════════════════════════════════════
# Self scope — the reason this branch exists
#
# Manav is in role_tiers.SELF_SCOPED_MODULES: "every employee gets read access
# to THEIR OWN record with no grant at all […] Anything beyond their own row
# needs a grant." A caller holding nothing arrives with an EMPTY level set.
#
# The properties asserted below are the ones the brief asked to be proved,
# stated in terms of the two people involved rather than in terms of HTTP: a
# module VIEWER must not be able to read a COLLEAGUE's Aadhaar or bank account,
# and that same viewer must still read their OWN. The third — that admin does
# not satisfy approver on Vetana — lives in test_vetana_security.py, where the
# routes it applies to are.
# ══════════════════════════════════════════════════════════════════

SELF_USER_ID = "user_mem001"          # matches conftest's member_user
COLLEAGUE_EMP_ID = "e0000000-0000-0000-0000-0000000000ff"
OWN_EMP_ID = "e0000000-0000-0000-0000-00000000005e"

COLLEAGUE_ROW_WITH_PII = {
    **EMPLOYEE_ROW_WITH_PII,
    "id": COLLEAGUE_EMP_ID,
    "user_id": "user_other999",
}

OWN_ROW_WITH_PII = {
    **EMPLOYEE_ROW_WITH_PII,
    "id": OWN_EMP_ID,
    "user_id": SELF_USER_ID,
    "name": "Test Member",
}


# ── (a) a viewer cannot read a colleague's Aadhaar or bank details ──

async def test_viewer_cannot_read_a_colleagues_aadhaar_or_bank_details(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """A module VIEWER on Manav reads the directory. It must not hand back a
    colleague's Aadhaar number or bank account, in any form.

    Viewer is the level that makes this worth asserting: it is above self scope,
    so the row is legitimately readable, and the masking is the only thing
    standing between a directory permission and an identity document.
    """
    levels("viewer")
    mock_pool.fetchrow.return_value = COLLEAGUE_ROW_WITH_PII
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{COLLEAGUE_EMP_ID}")
    assert resp.status_code == 200

    raw = resp.text
    assert "123456789012" not in raw        # Aadhaar
    assert "50100123456789" not in raw      # account number
    assert "ABCDE1234F" not in raw          # PAN

    emp = resp.json()["employee"]
    assert emp["_pii_masked"] is True
    assert emp["aadhaar"].endswith("9012")
    assert emp["bank_details"]["account_number"].endswith("6789")


async def test_viewer_cannot_reach_the_unmasked_endpoint_at_all(
    app, api_client, mock_pool, as_member, with_org_id, levels,
):
    """The masked detail route is not the only way to the identity kit —
    /sensitive returns it in full. A viewer must be refused there even with the
    org-role gate ahead of it satisfied, which is why the route carries both.
    """
    from routers.manav import _pii_gate
    app.dependency_overrides[_pii_gate] = lambda: None
    try:
        levels("viewer")
        mock_pool.fetchrow.return_value = COLLEAGUE_ROW_WITH_PII
        resp = await api_client.get(
            f"/api/v1/manav/employees/{COLLEAGUE_EMP_ID}/sensitive",
        )
        assert resp.status_code == 403
        assert "123456789012" not in resp.text
    finally:
        app.dependency_overrides.pop(_pii_gate, None)


async def test_no_grant_cannot_see_that_a_colleagues_row_exists(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """Below viewer there is no colleague row at all — 404, not 403, so the
    answer does not confirm that employee id exists in this org."""
    levels()
    mock_pool.fetchrow.return_value = COLLEAGUE_ROW_WITH_PII
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{COLLEAGUE_EMP_ID}")
    assert resp.status_code == 404
    assert "Priya" not in resp.text


async def test_no_grant_sees_a_directory_one_row_long(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    levels()
    mock_pool.fetchval.return_value = OWN_EMP_ID
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/manav/employees")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "AND id=$2::uuid" in sql
    assert OWN_EMP_ID in args


async def test_no_grant_and_no_employee_row_sees_nothing(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """No grant and no employee row is NOT unrestricted access — there is simply
    no own-row to be scoped to."""
    levels()
    mock_pool.fetchval.return_value = None
    resp = await api_client.get("/api/v1/manav/employees")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


# ── (b) the same viewer CAN read their own ──────────────────────────

async def test_viewer_can_read_their_own_record(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """The other half of (a): narrowing the colleague path must not lock the
    employee out of their own personnel file."""
    levels("viewer")
    mock_pool.fetchrow.return_value = OWN_ROW_WITH_PII
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{OWN_EMP_ID}")
    assert resp.status_code == 200
    assert resp.json()["employee"]["name"] == "Test Member"


async def test_own_record_is_readable_with_no_grant_at_all(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """SELF_SCOPED_MODULES, stated as a test. An ordinary employee holds
    nothing and still reads their own row."""
    levels()
    mock_pool.fetchrow.return_value = OWN_ROW_WITH_PII
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{OWN_EMP_ID}")
    assert resp.status_code == 200
    assert resp.json()["employee"]["name"] == "Test Member"


async def test_own_record_is_masked_too(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """Reading your own row is not a way to read your own Aadhaar back out of
    the database. The masking is unconditional, which is what makes it safe to
    leave the identity columns on the detail query at all."""
    levels()
    mock_pool.fetchrow.return_value = OWN_ROW_WITH_PII
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{OWN_EMP_ID}")
    assert resp.status_code == 200
    assert "123456789012" not in resp.text
    assert "50100123456789" not in resp.text


# ── Self scope is read-only over records the employer owns ─────────

@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/manav/employees", {"name": "X"}),
    ("patch", "/api/v1/manav/employees/e0000000-0000-0000-0000-0000000000ff",
     {"designation": "Head of Everything"}),
    ("delete", "/api/v1/manav/employees/e0000000-0000-0000-0000-0000000000ff", None),
    ("post", "/api/v1/manav/attendance",
     {"employee_id": "e0000000-0000-0000-0000-0000000000ff", "status": "present"}),
    ("post", "/api/v1/manav/holidays", {"name": "X", "date": "2026-10-20"}),
    ("post", "/api/v1/manav/leave-types", {"name": "X", "code": "X"}),
])
async def test_self_scope_cannot_edit_the_employers_hr_records(
    api_client, mock_pool, as_member, with_org_id, levels, method, path, body,
):
    levels()
    call = getattr(api_client, method)
    resp = await call(path, json=body) if body is not None else await call(path)
    assert resp.status_code == 403


@pytest.mark.parametrize("path", [
    "/api/v1/manav/departments",
    "/api/v1/manav/stats",
    "/api/v1/manav/swaps",
    "/api/v1/manav/candidates",
    "/api/v1/manav/job-openings",
    "/api/v1/manav/assets",
])
async def test_self_scope_cannot_read_what_names_other_people(
    api_client, mock_pool, as_member, with_org_id, levels, path,
):
    levels()
    resp = await api_client.get(path)
    assert resp.status_code == 403


@pytest.mark.parametrize("path", [
    "/api/v1/manav/leave-types",
    "/api/v1/manav/holidays",
    "/api/v1/manav/announcements",
    "/api/v1/manav/shifts",
])
async def test_reference_data_stays_readable_at_self_scope(
    api_client, mock_pool, as_member, with_org_id, levels, path,
):
    """An employee cannot request leave against their own record without the
    leave types and the holiday calendar. None of these rows name a person."""
    levels()
    mock_pool.fetch.return_value = []
    resp = await api_client.get(path)
    assert resp.status_code == 200


# ── The two routes that lost their guard in the salvaged diff ──────

async def test_self_scope_cannot_read_a_colleagues_assets(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """`GET /employees/{id}/assets` was switched to the self-scope gate with no
    level check, so any employee could read any colleague's issued equipment by
    putting their id in the path."""
    levels()
    mock_pool.fetchval.return_value = OWN_EMP_ID
    resp = await api_client.get(f"/api/v1/manav/employees/{COLLEAGUE_EMP_ID}/assets")
    assert resp.status_code == 403


async def test_self_scope_can_read_its_own_assets(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    levels()
    mock_pool.fetchval.return_value = OWN_EMP_ID
    mock_pool.fetch.return_value = []
    resp = await api_client.get(f"/api/v1/manav/employees/{OWN_EMP_ID}/assets")
    assert resp.status_code == 200


async def test_self_scope_cannot_offer_away_a_colleagues_shift(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """`POST /swaps` took the schedule id straight from the body with no check
    that it was the caller's — so any employee could give away anyone's shift."""
    levels()
    mock_pool.fetchrow.return_value = {"id": "s1", "user_id": "user_other999"}
    resp = await api_client.post("/api/v1/manav/swaps", json={
        "requester_schedule_id": "50000000-0000-0000-0000-000000000001",
    })
    assert resp.status_code == 403


async def test_swap_refuses_a_schedule_from_another_org(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """The schedule is looked up with `org_id` in the WHERE clause, so a uuid
    from another tenant does not resolve — without which `GET /swaps` would join
    through it and print that tenant's employee name."""
    levels("editor")
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post("/api/v1/manav/swaps", json={
        "requester_schedule_id": "50000000-0000-0000-0000-000000000001",
    })
    assert resp.status_code == 404


async def test_self_scope_can_offer_away_its_own_shift(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """Giving away your own shift is self-service and must stay reachable."""
    levels()
    mock_pool.fetchrow.side_effect = [
        {"id": "s1", "user_id": SELF_USER_ID},   # the schedule lookup
        {"id": "swap1"},                          # the insert
    ]
    resp = await api_client.post("/api/v1/manav/swaps", json={
        "requester_schedule_id": "50000000-0000-0000-0000-000000000001",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "requested"


# ── Approving is not a self-service action ─────────────────────────

async def test_approving_leave_needs_the_approver_rung(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    levels("editor")
    resp = await api_client.patch(
        "/api/v1/manav/leaves/10000000-0000-0000-0000-000000000001/action",
        json={"status": "approved"},
    )
    assert resp.status_code == 403


async def test_manav_is_hierarchical_so_admin_does_approve(
    api_client, mock_pool, as_member, with_org_id, levels,
):
    """Manav is NOT a separated-duty module — only vetana and ganit are — so
    admin does satisfy approver here. Asserted so that adding Manav to
    SEPARATED_DUTY_MODULES becomes a visible decision rather than a silent
    behaviour change."""
    levels("admin")
    mock_pool.fetchrow.return_value = None
    resp = await api_client.patch(
        "/api/v1/manav/leaves/10000000-0000-0000-0000-000000000001/action",
        json={"status": "approved"},
    )
    assert resp.status_code == 404          # past the guard, then no such row
