"""
Security tests for vetana.py — payroll authorisation and PII masking.

Before this suite, all 19 endpoints in vetana.py carried exactly one guard:
`require_module("vetana")`, which checks module membership with no role level.
So anyone holding a Vetana grant could read every colleague's CTC, net pay, PAN
and bank account, approve a payroll run and mark salaries disbursed.

What is asserted here:
  - Money-moving actions (process, approve, revert, disburse) need an org role.
  - Salary structures, payslips and loans are self-scoped without an org role.
  - PAN, UAN and account numbers never leave in full through a JSON endpoint,
    the same rule already enforced on `manav_employees`.
  - Pulling someone else's payslip PDF is audited.
"""

import pytest

ORG_A = "00000000-0000-0000-0000-00000000000a"
EMP_SELF = "e0000000-0000-0000-0000-00000000005e"
EMP_OTHER = "e0000000-0000-0000-0000-0000000000ff"

PAYSLIP_ROW = {
    "id": "p0000000-0000-0000-0000-000000000001",
    "payslip_number": "PS-001",
    "month": "2026-07",
    "gross": 100000,
    "net_pay": 84000,
    "status": "approved",
    "employee_name": "Priya Sharma",
    "employee_code": "EMP001",
    "pan": "ABCDE1234F",
    "uan": "100200300400",
    "bank_details": {
        "account_number": "912345678901",
        "ifsc": "HDFC0001234",
        "bank_name": "HDFC Bank",
        "branch": "Andheri",
    },
    "employee_user_id": "user_other999",
}


@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    from routers.vetana import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def not_payroll_admin(monkeypatch):
    """The caller holds the Vetana module but no org role."""
    async def _no(user_id, org_id=None):
        return False
    monkeypatch.setattr("routers.vetana.is_org_admin", _no)


@pytest.fixture
def is_payroll_admin(monkeypatch):
    async def _yes(user_id, org_id=None):
        return True
    monkeypatch.setattr("routers.vetana.is_org_admin", _yes)


# ── Money-moving actions need an org role ─────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/vetana/payroll/process", {"month": "2026-07"}),
    ("patch", "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve", None),
    ("patch", "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/revert", None),
    ("patch", "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/disburse", None),
    ("post", "/api/v1/vetana/salary-structures", {"employee_id": EMP_OTHER, "ctc_annual": 1}),
])
async def test_money_moving_actions_refuse_module_membership_alone(
    api_client, mock_pool, as_member, org_a, not_payroll_admin, method, path, body,
):
    call = getattr(api_client, method)
    resp = await call(path, json=body) if body is not None else await call(path)
    assert resp.status_code == 403
    assert "org admin" in resp.json()["detail"].lower()


async def test_approve_run_allowed_for_org_admin(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin,
):
    mock_pool.fetchrow.return_value = {"status": "processed"}
    mock_pool.fetch.return_value = []
    resp = await api_client.patch(
        "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve"
    )
    assert resp.status_code == 200


# ── Org-wide financial reads need an org role ─────────────────────

@pytest.mark.parametrize("path", [
    "/api/v1/vetana/payroll/runs",
    "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001",
    "/api/v1/vetana/dashboard",
    "/api/v1/vetana/statutory-summary",
])
async def test_org_wide_reads_refuse_module_membership_alone(
    api_client, mock_pool, as_member, org_a, not_payroll_admin, path,
):
    resp = await api_client.get(path)
    assert resp.status_code == 403


# ── Self-scoping ──────────────────────────────────────────────────

async def test_payslip_list_is_scoped_to_own_employee_row(
    api_client, mock_pool, as_member, org_a, not_payroll_admin,
):
    """Without an org role the list must be narrowed to the caller's own
    employee id, never the whole org."""
    mock_pool.fetchval.return_value = EMP_SELF
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vetana/payslips")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "p.employee_id=$2" in sql
    assert EMP_SELF in args


async def test_payslip_list_empty_when_caller_has_no_employee_row(
    api_client, mock_pool, as_member, org_a, not_payroll_admin,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.get("/api/v1/vetana/payslips")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


async def test_payslip_list_rejects_asking_for_someone_else(
    api_client, mock_pool, as_member, org_a, not_payroll_admin,
):
    mock_pool.fetchval.return_value = EMP_SELF
    resp = await api_client.get(f"/api/v1/vetana/payslips?employee_id={EMP_OTHER}")
    assert resp.status_code == 403


async def test_get_payslip_of_a_colleague_is_404_without_org_role(
    api_client, mock_pool, as_member, org_a, not_payroll_admin,
):
    """404 rather than 403 — a 403 would confirm the payslip exists."""
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    assert resp.status_code == 404


async def test_loans_are_scoped_to_own_employee_row(
    api_client, mock_pool, as_member, org_a, not_payroll_admin,
):
    mock_pool.fetchval.return_value = EMP_SELF
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/vetana/loans")
    assert resp.status_code == 200
    sql, *args = mock_pool.fetch.call_args[0]
    assert "l.employee_id=$2" in sql
    assert EMP_SELF in args


# ── PII masking ───────────────────────────────────────────────────

async def test_payslip_detail_masks_pan_uan_and_account_number(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin,
):
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["pan"].endswith("234F")
    assert body["pan"] != "ABCDE1234F"
    assert body["uan"].endswith("0400")
    assert body["uan"] != "100200300400"
    assert body["bank_details"]["account_number"].endswith("8901")
    assert body["bank_details"]["account_number"] != "912345678901"
    assert body["_pii_masked"] is True


async def test_payslip_detail_keeps_bank_routing_data_legible(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin,
):
    """IFSC, bank name and branch are public routing information — masking them
    would break the UI without protecting anything."""
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    bank = resp.json()["bank_details"]
    assert bank["ifsc"] == "HDFC0001234"
    assert bank["bank_name"] == "HDFC Bank"
    assert bank["branch"] == "Andheri"


async def test_raw_identifiers_appear_nowhere_in_the_payslip_response(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin,
):
    """The strongest form of the assertion: the raw strings must not be
    anywhere in the serialized body, however it is nested."""
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    raw = resp.text
    assert "ABCDE1234F" not in raw
    assert "100200300400" not in raw
    assert "912345678901" not in raw


async def test_statutory_summary_masks_pan_and_uan(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin,
):
    mock_pool.fetch.return_value = [{
        "payslip_number": "PS-001",
        "employee_name": "Priya Sharma",
        "employee_code": "EMP001",
        "pan": "ABCDE1234F",
        "uan": "100200300400",
        "basic": 40000, "gross": 100000,
        "pf_employee": 1800, "pf_employer": 1800,
        "esi_employee": 0, "esi_employer": 0,
        "professional_tax": 200, "tds": 5000,
    }]
    mock_pool.fetchrow.return_value = {}
    resp = await api_client.get("/api/v1/vetana/statutory-summary?month=2026-07")
    assert resp.status_code == 200
    assert "ABCDE1234F" not in resp.text
    assert "100200300400" not in resp.text


# ── Payslip PDF: own is free, anyone else's is audited ────────────

async def test_own_payslip_pdf_needs_no_org_role_and_is_not_audited(
    api_client, mock_pool, as_member, org_a, not_payroll_admin, monkeypatch,
):
    """An employee is entitled to their own payslip with real figures on it,
    and pulling your own document is not an access event worth a row."""
    emitted = []
    monkeypatch.setattr(
        "routers.vetana.audit",
        lambda action, request=None, **kw: emitted.append(action),
    )
    monkeypatch.setattr(
        "services.payslip_pdf.generate_payslip_pdf",
        lambda *a, **k: b"%PDF-1.4 fake",
    )
    mock_pool.fetchrow.return_value = {**PAYSLIP_ROW, "employee_user_id": "user_mem001"}

    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/pdf"
    )
    assert resp.status_code == 200
    assert emitted == []


async def test_someone_elses_payslip_pdf_is_refused_without_an_org_role(
    api_client, mock_pool, as_member, org_a, not_payroll_admin,
):
    mock_pool.fetchrow.return_value = PAYSLIP_ROW  # employee_user_id = user_other999
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/pdf"
    )
    assert resp.status_code == 403


async def test_someone_elses_payslip_pdf_is_audited_for_an_org_admin(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin, monkeypatch,
):
    """Support access is never silent — and neither is an admin reading a
    colleague's bank account."""
    emitted = []
    monkeypatch.setattr(
        "routers.vetana.audit",
        lambda action, request=None, **kw: emitted.append((action, kw)),
    )
    monkeypatch.setattr(
        "services.payslip_pdf.generate_payslip_pdf",
        lambda *a, **k: b"%PDF-1.4 fake",
    )
    mock_pool.fetchrow.return_value = PAYSLIP_ROW

    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/pdf"
    )
    assert resp.status_code == 200
    assert len(emitted) == 1
    action, kw = emitted[0]
    assert action == "vetana.payslip_pdf_downloaded"
    assert kw["severity"] == "warn"
    assert kw["detail"]["fields"] == ["pan", "uan", "bank_account"]


# ── Cross-tenant write guard on loans ─────────────────────────────

async def test_create_loan_rejects_an_employee_from_another_org(
    api_client, mock_pool, as_admin, org_a, is_payroll_admin,
):
    mock_pool.fetchval.return_value = None  # employee not in this org
    resp = await api_client.post("/api/v1/vetana/loans", json={
        "employee_id": EMP_OTHER,
        "principal_amount": 50000,
        "emi_amount": 5000,
    })
    assert resp.status_code == 404
