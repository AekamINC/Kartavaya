"""
Security tests for vetana.py — payroll authorisation and PII masking.

Ported to the Tier-4 level model. `_gate` is `require_module_or_self("vetana")`,
whose VALUE is the caller's level set, so a test says what the caller holds by
overriding that one dependency — there is no `is_org_admin` in this file any
more and monkeypatching it (as this suite used to) now fails at fixture setup.

What is asserted here:
  - No grant at all = self scope: own payslips, own structure, own loans, own
    PDF, and nothing about anybody else.
  - The org-wide financial reads need a grant.
  - **admin does not satisfy approver.** Vetana is a separated-duty module:
    whoever defines what people are paid does not release the money. This is the
    assertion that most needs to exist, because the natural implementation —
    comparing ladder positions — passes every other test in this file and
    silently destroys the separation.
  - PAN, UAN and account numbers never leave in full through a JSON endpoint.
  - Pulling someone else's payslip PDF needs admin and is audited.
"""

import pytest

from middleware.role_tiers import ADMIN, APPROVER, EDITOR, VIEWER

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


@pytest.fixture
def levels(app):
    """Declare the caller's Tier-4 level set on Vetana.

    Call it with no arguments for "holds nothing", which is the ordinary
    employee and the case most of this file is about. The autouse fixture below
    already installs that default, so a test only calls this to raise it.
    """
    from routers.vetana import _gate

    def _set(*held):
        app.dependency_overrides[_gate] = lambda: frozenset(held)

    yield _set


@pytest.fixture(autouse=True)
def no_grant_by_default(app):
    """Every test starts as an employee holding no Vetana grant."""
    from routers.vetana import _gate
    app.dependency_overrides[_gate] = lambda: frozenset()
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


# ── Separated duty: admin is not approver ─────────────────────────
#
# The three routes that release money. Holding `admin` on Vetana must not reach
# any of them.

APPROVER_ROUTES = [
    ("patch", "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve"),
    ("patch", "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/revert"),
    ("patch", "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/disburse"),
]


def test_admin_does_not_satisfy_approver_in_vetana():
    """The rule itself, asserted where it is unconditionally true.

    This is the assertion the brief asked for, and it holds today: the resolver
    refuses admin at the approver rung on both separated-duty modules and
    nowhere else. It is a pure function, so it needs no request and cannot be
    affected by how the routes are currently sequenced.
    """
    from middleware.role_tiers import level_satisfies, any_level_satisfies

    assert level_satisfies(ADMIN, APPROVER, "vetana") is False
    assert level_satisfies(ADMIN, APPROVER, "ganit") is False
    assert any_level_satisfies(frozenset({ADMIN}), APPROVER, "vetana") is False

    # …and it is not a blanket refusal of admin, which would be a different bug.
    assert level_satisfies(ADMIN, EDITOR, "vetana") is True
    assert level_satisfies(ADMIN, VIEWER, "vetana") is True

    # …and only an explicit approver grant climbs that rung.
    assert level_satisfies(APPROVER, APPROVER, "vetana") is True
    assert any_level_satisfies(frozenset({ADMIN, APPROVER}), APPROVER, "vetana") is True

    # …and elsewhere the ladder is ordinary: Manav is hierarchical.
    assert level_satisfies(ADMIN, APPROVER, "manav") is True


@pytest.mark.parametrize("method,path", APPROVER_ROUTES)
async def test_admin_is_refused_on_the_routes_that_release_money(
    api_client, mock_pool, as_member, org_a, levels, method, path,
):
    """The separated duty, enforced at the route rather than only in the
    resolver.

    An org_owner and an org_admin both resolve to exactly this level set, so
    this is not a hypothetical grant — it is what the person who runs the
    company holds, and after PROPOSED_071 they still cannot release the payroll
    without a second, explicit, auditable approver grant.
    """
    levels(ADMIN)
    mock_pool.fetchrow.return_value = {"status": "processed", "run_id": "r1"}
    mock_pool.fetch.return_value = []

    resp = await getattr(api_client, method)(path)

    assert resp.status_code == 403
    assert "approver" in resp.json()["detail"].lower()


@pytest.mark.parametrize("method,path", APPROVER_ROUTES)
async def test_an_explicit_approver_grant_does_reach_them(
    api_client, mock_pool, as_member, org_a, levels, method, path,
):
    """The other half: the separation must refuse admin without also refusing
    the person who actually holds the authority. Without this, "nobody can
    approve anything" would pass the test above."""
    levels(APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed", "run_id": "r1"}
    mock_pool.fetch.return_value = []

    resp = await getattr(api_client, method)(path)

    assert resp.status_code != 403


@pytest.mark.parametrize("method,path", APPROVER_ROUTES)
async def test_someone_holding_both_rungs_reaches_them_either_way(
    api_client, mock_pool, as_member, org_a, levels, method, path,
):
    """The person the owner described — "one user can have both FYI but
    auditable" — reaches these routes both before and after the flip, which
    makes this the one assertion here that survives PROPOSED_071 unchanged.

    A caller holding ONLY `approver` is refused while `_RELEASE_LEVEL` is
    `ADMIN` (approver does not climb up to admin) and admitted after the flip.
    That inversion is exactly what is being sequenced, so it is asserted on
    `verify/hr-payroll-separated-duty` rather than here.
    """
    levels(ADMIN, APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed", "run_id": "r1"}
    mock_pool.fetch.return_value = []

    resp = await getattr(api_client, method)(path)

    assert resp.status_code != 403


async def test_holding_both_levels_is_allowed(
    api_client, mock_pool, as_member, org_a, levels,
):
    """One person may hold admin AND approver — the owner's "one user can have
    both FYI but auditable". The set is unioned, not reduced to a strongest, so
    both authorities survive."""
    levels(ADMIN, APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed"}
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(
        "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve"
    )
    assert resp.status_code == 200


async def test_approver_alone_cannot_define_what_people_are_paid(
    api_client, mock_pool, as_member, org_a, levels,
):
    """The separation runs both ways: approver releases money, admin defines the
    salary structures, and neither borrows the other's authority."""
    levels(APPROVER)
    resp = await api_client.post("/api/v1/vetana/salary-structures", json={
        "employee_id": EMP_OTHER, "ctc_annual": 1,
    })
    assert resp.status_code == 403


# ── Four eyes: the person who ran the payroll does not release it ──
#
# The level checks above ask WHAT someone holds. They cannot ask WHO acted,
# and both authorities can sit on one account (a sensitive module derives
# `admin` from the org role, so an org_admin granted approver holds both rungs).
# Measured live on 2026-08-03: one user processed a run and then approved it
# with every level check passing. These assert the control that closes it.


async def test_the_processor_cannot_approve_their_own_run(
    api_client, mock_pool, as_member, org_a, levels,
):
    """A second approver exists, so the person who ran it is refused."""
    levels(ADMIN, APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed", "created_by": "user_mem001"}
    mock_pool.fetchval.return_value = 1  # one OTHER approver in the org
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(
        "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve"
    )

    assert resp.status_code == 403
    detail = resp.json()["detail"].lower()
    assert "second pair of eyes" in detail
    # Names what to do, rather than a level the reader already holds.
    assert "approver" in detail


async def test_a_different_approver_may_approve_what_someone_else_ran(
    api_client, mock_pool, as_member, org_a, levels,
):
    """The other half — the control must not refuse the second person too,
    or "nobody can approve anything" would satisfy the test above."""
    levels(APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed", "created_by": "user_someone_else"}
    mock_pool.fetchval.return_value = 1
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(
        "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve"
    )

    assert resp.status_code == 200


async def test_a_sole_approver_is_not_locked_out_of_their_own_payroll(
    api_client, mock_pool, as_member, org_a, levels,
):
    """Counted against the live catalog before this rule was written: every org
    has exactly ONE Vetana approver. An unconditional four-eyes rule would not
    separate the duty, it would stop payroll company-wide — the same failure
    `_RELEASE_LEVEL`'s note was written to avoid.

    So where there is no second approver the release proceeds, and the audit
    log carries the self-approval. Granting a second approver turns the control
    on for that org with no code change.
    """
    levels(ADMIN, APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed", "created_by": "user_mem001"}
    mock_pool.fetchval.return_value = 0  # nobody else holds approver here
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(
        "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve"
    )

    assert resp.status_code == 200


# ── No grant reaches none of it ───────────────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/vetana/payroll/process", {"month": "2026-07"}),
    ("patch", "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/approve", None),
    ("patch", "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001/revert", None),
    ("patch", "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/disburse", None),
    ("post", "/api/v1/vetana/salary-structures", {"employee_id": EMP_OTHER, "ctc_annual": 1}),
])
async def test_money_moving_actions_refuse_a_caller_with_no_grant(
    api_client, mock_pool, as_member, org_a, method, path, body,
):
    call = getattr(api_client, method)
    resp = await call(path, json=body) if body is not None else await call(path)
    assert resp.status_code == 403


@pytest.mark.parametrize("path", [
    "/api/v1/vetana/payroll/runs",
    "/api/v1/vetana/payroll/runs/r0000000-0000-0000-0000-000000000001",
    "/api/v1/vetana/dashboard",
    "/api/v1/vetana/statutory-summary",
])
async def test_org_wide_reads_refuse_a_caller_with_no_grant(
    api_client, mock_pool, as_member, org_a, path,
):
    """There is no self-scoped version of the org's total salary bill, so these
    have no fallback — a caller holding nothing is refused outright."""
    resp = await api_client.get(path)
    assert resp.status_code == 403


ORG_WIDE_READS = [
    "/api/v1/vetana/payroll/runs",
    "/api/v1/vetana/dashboard",
    "/api/v1/vetana/statutory-summary",
]


@pytest.mark.parametrize("path", ORG_WIDE_READS)
async def test_a_viewer_grant_does_not_open_the_register(
    api_client, mock_pool, as_member, org_a, levels, path,
):
    """RBAC-SPEC.md: "**Viewer on Vetana is scoped to self**, not to the org. It
    is the only module where viewer means 'my own record'."

    So viewer and no-grant land in the same place on Vetana, which is the one
    module where that is the right answer and not a bug. The bar for anyone
    else's pay is `editor` — "prepare payroll runs" in the same matrix.
    """
    levels(VIEWER)
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(path)
    assert resp.status_code == 403


@pytest.mark.parametrize("path", ORG_WIDE_READS)
async def test_org_wide_reads_admit_an_editor_grant(
    api_client, mock_pool, as_member, org_a, levels, path,
):
    levels(EDITOR)
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(path)
    assert resp.status_code == 200


@pytest.mark.parametrize("path", ORG_WIDE_READS)
async def test_org_wide_reads_still_admit_an_org_admin(
    api_client, mock_pool, as_member, org_a, levels, path,
):
    """The narrowing above must not lock out anyone who could reach these
    before. org_owner and org_admin resolve to `admin`, and Vetana's separation
    only blocks admin at the APPROVER rung — admin still satisfies editor."""
    levels(ADMIN)
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(path)
    assert resp.status_code == 200


@pytest.mark.parametrize("path", ORG_WIDE_READS)
async def test_org_wide_reads_admit_an_approver(
    api_client, mock_pool, as_member, org_a, levels, path,
):
    """The separation is one-directional and this is the direction it does NOT
    run in. RBAC-SPEC defines the rung as "`approver` — everything editor can,
    plus approve/reject workflows", so approver climbs down to editor freely;
    what it must not do is let ADMIN climb UP to approver. Asserted because the
    obvious over-correction — making the two rungs mutually exclusive — would
    leave an approver unable to see the run they are approving.
    """
    levels(APPROVER)
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(path)
    assert resp.status_code == 200


# ── Self-scoping ──────────────────────────────────────────────────

async def test_payslip_list_is_scoped_to_own_employee_row(
    api_client, mock_pool, as_member, org_a,
):
    """With no grant the list must be narrowed to the caller's own employee id,
    never the whole org."""
    mock_pool.fetchval.return_value = EMP_SELF
    mock_pool.fetch.return_value = []

    resp = await api_client.get("/api/v1/vetana/payslips")
    assert resp.status_code == 200

    sql, *args = mock_pool.fetch.call_args[0]
    assert "p.employee_id=$2" in sql
    assert EMP_SELF in args


async def test_payslip_list_empty_when_caller_has_no_employee_row(
    api_client, mock_pool, as_member, org_a,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.get("/api/v1/vetana/payslips")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


async def test_payslip_list_rejects_asking_for_someone_else(
    api_client, mock_pool, as_member, org_a,
):
    mock_pool.fetchval.return_value = EMP_SELF
    resp = await api_client.get(f"/api/v1/vetana/payslips?employee_id={EMP_OTHER}")
    assert resp.status_code == 403


async def test_get_payslip_of_a_colleague_is_404_without_a_grant(
    api_client, mock_pool, as_member, org_a,
):
    """404 rather than 403 — a 403 would confirm the payslip exists."""
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    assert resp.status_code == 404


async def test_get_own_payslip_needs_no_grant_at_all(
    api_client, mock_pool, as_member, org_a,
):
    """The SELF_SCOPED_MODULES promise, stated as a test: an ordinary employee
    holding nothing still reads their own payslip."""
    mock_pool.fetchrow.return_value = {**PAYSLIP_ROW, "employee_user_id": "user_mem001"}
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    assert resp.status_code == 200
    assert resp.json()["payslip_number"] == "PS-001"


async def test_loans_are_scoped_to_own_employee_row(
    api_client, mock_pool, as_member, org_a,
):
    mock_pool.fetchval.return_value = EMP_SELF
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/vetana/loans")
    assert resp.status_code == 200
    sql, *args = mock_pool.fetch.call_args[0]
    assert "l.employee_id=$2" in sql
    assert EMP_SELF in args


async def test_salary_structures_are_scoped_to_own_employee_row(
    api_client, mock_pool, as_member, org_a,
):
    mock_pool.fetchval.return_value = EMP_SELF
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/vetana/salary-structures")
    assert resp.status_code == 200
    sql, *args = mock_pool.fetch.call_args[0]
    assert EMP_SELF in args


async def test_an_editor_grant_is_not_a_licence_to_read_the_register(
    api_client, mock_pool, as_member, org_a, levels,
):
    """`editor` outranks `viewer` on the ladder, so this passes — the assertion
    is that it goes through level_satisfies rather than an ad-hoc check, and
    that a grant of any kind stops the self-scope narrowing."""
    levels(EDITOR)
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/vetana/payslips")
    assert resp.status_code == 200
    sql, *args = mock_pool.fetch.call_args[0]
    assert "p.employee_id=$2" not in sql


# ── PII masking ───────────────────────────────────────────────────

async def test_payslip_detail_masks_pan_uan_and_account_number(
    api_client, mock_pool, as_member, org_a, levels,
):
    levels(ADMIN)
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
    api_client, mock_pool, as_member, org_a, levels,
):
    """IFSC, bank name and branch are public routing information — masking them
    would break the UI without protecting anything."""
    levels(ADMIN)
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    bank = resp.json()["bank_details"]
    assert bank["ifsc"] == "HDFC0001234"
    assert bank["bank_name"] == "HDFC Bank"
    assert bank["branch"] == "Andheri"


async def test_raw_identifiers_appear_nowhere_in_the_payslip_response(
    api_client, mock_pool, as_member, org_a, levels,
):
    """The strongest form of the assertion: the raw strings must not be
    anywhere in the serialized body, however it is nested."""
    levels(ADMIN)
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    raw = resp.text
    assert "ABCDE1234F" not in raw
    assert "100200300400" not in raw
    assert "912345678901" not in raw


async def test_own_payslip_json_is_masked_too(
    api_client, mock_pool, as_member, org_a,
):
    """Self scope is not a way round the masking. The employee gets their real
    figures from the PDF, which is the statutory document; the JSON that feeds
    the screen never carries a full account number for anyone."""
    mock_pool.fetchrow.return_value = {**PAYSLIP_ROW, "employee_user_id": "user_mem001"}
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001"
    )
    assert resp.status_code == 200
    assert "912345678901" not in resp.text


async def test_statutory_summary_masks_pan_and_uan(
    api_client, mock_pool, as_member, org_a, levels,
):
    levels(EDITOR)
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


# ── Payslip PDF: own is free, anyone else's needs admin and is audited ────────

async def test_own_payslip_pdf_needs_no_grant_and_is_not_audited(
    api_client, mock_pool, as_member, org_a, monkeypatch,
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


async def test_someone_elses_payslip_pdf_is_refused_without_a_grant(
    api_client, mock_pool, as_member, org_a,
):
    mock_pool.fetchrow.return_value = PAYSLIP_ROW  # employee_user_id = user_other999
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/pdf"
    )
    assert resp.status_code == 403


async def test_someone_elses_payslip_pdf_is_refused_for_a_mere_viewer(
    api_client, mock_pool, as_member, org_a, levels,
):
    """An unmasked identity document is a higher bar than reading a figure: a
    viewer reads the register with PAN and account number masked, and does not
    get the PDF where they are not."""
    levels(VIEWER)
    mock_pool.fetchrow.return_value = PAYSLIP_ROW
    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/pdf"
    )
    assert resp.status_code == 403


async def test_someone_elses_payslip_pdf_is_audited_for_an_admin(
    api_client, mock_pool, as_member, org_a, levels, monkeypatch,
):
    """Support access is never silent — and neither is an admin reading a
    colleague's bank account."""
    levels(ADMIN)
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


# ── The payslip document gets the fields its specification asks for ──────────

async def test_payslip_pdf_payload_carries_the_specified_employee_fields(
    api_client, mock_pool, as_member, org_a, monkeypatch,
):
    """`design-reference/Kartavaya Redesign/docs/Payslip.html` is the
    specification for this document. It prints a joining date, an ESI number, a
    leave-balance table and "A/c ending NNNN" — none of which the query behind
    this endpoint was selecting, so the renderer could not have shown them.

    This asserts the DATA reaches the renderer. The renderer itself still does
    not lay them out; that gap is recorded in the swarm report.
    """
    captured = {}

    def _fake_pdf(payslip, employee, org):
        captured["employee"] = employee
        captured["payslip"] = payslip
        return b"%PDF-1.4 fake"

    monkeypatch.setattr("services.payslip_pdf.generate_payslip_pdf", _fake_pdf)

    mock_pool.fetchrow.return_value = {
        **PAYSLIP_ROW,
        "employee_user_id": "user_mem001",
        "emp_row_id": EMP_SELF,
        "emp_pan": "ABCDE1234F",
        "esi_number": "3101234567",
        "date_of_joining": "2023-03-14",
        "designation": "Manager",
        "department_name": "Finance",
        "emp_email": "member@test.com",
    }
    mock_pool.fetch.return_value = [
        {"leave_name": "Earned leave", "allocated": 18, "used": 3, "carried_forward": 0},
    ]

    resp = await api_client.get(
        "/api/v1/vetana/payslips/p0000000-0000-0000-0000-000000000001/pdf"
    )
    assert resp.status_code == 200

    emp = captured["employee"]
    assert emp["date_of_joining"] == "2023-03-14"
    assert emp["esi_number"] == "3101234567"
    assert emp["bank_account_last4"] == "8901"
    assert emp["leave_balances"] == [
        {"name": "Earned leave", "opening": 18.0, "taken": 3.0, "balance": 15.0},
    ]


# ── Cross-tenant write guards ─────────────────────────────────────

async def test_create_loan_rejects_an_employee_from_another_org(
    api_client, mock_pool, as_member, org_a, levels,
):
    levels(ADMIN)
    mock_pool.fetchval.return_value = None  # employee not in this org
    resp = await api_client.post("/api/v1/vetana/loans", json={
        "employee_id": EMP_OTHER,
        "principal_amount": 50000,
        "emi_amount": 5000,
    })
    assert resp.status_code == 404


async def test_create_structure_rejects_an_employee_from_another_org(
    api_client, mock_pool, as_member, org_a, levels,
):
    """Added by the salvaged commit, and previously missing — the same hole that
    had already been closed on /loans."""
    levels(ADMIN)
    mock_pool.fetchval.return_value = None
    resp = await api_client.post("/api/v1/vetana/salary-structures", json={
        "employee_id": EMP_OTHER, "ctc_annual": 1,
    })
    assert resp.status_code == 404
