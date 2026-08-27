"""
Cross-tenant denial across the finance and operations modules.

`user_roles` is the sole tenant path, and roughly 48 child tables still have no
`org_id` of their own. Where a table lacks one the scoping has to come through a
join to a parent that has it — and the point of these tests is that the join is
actually there, in the query, rather than assumed because the endpoint "feels"
scoped.

Three shapes are covered:

  · PARENT-GUARDED — the child table has no org_id, so the handler proves
    ownership of the parent first and 404s before it ever reads the child.
  · JOIN-SCOPED — the child is read in one query whose WHERE reaches org_id
    through a join. Asserted on the SQL, because that is where the guarantee is.
  · INPUT-SCOPED — ids arrive in a request body and are filtered against the
    caller's own rows before use.
"""
import pytest

from middleware import module_levels

FOREIGN_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"


@pytest.fixture(autouse=True)
def _reset_probe_cache():
    module_levels.reset_approver_table_cache()
    yield
    module_levels.reset_approver_table_cache()


@pytest.fixture
def ganit_gate(app):
    # BOTH gates. `_payables_gate` is `require_any_module("ganit", "kray")` and
    # it is a DIFFERENT dependency object from `_gate` — procurement became its
    # own module in `7770045b`, and every vendor-bill route moved behind it. A
    # fixture overriding only `_gate` therefore got a 403 from a route it meant
    # to be inside, and this file's whole subject is what a route returns when
    # the record belongs to another org: a 403 from the wrong door reads exactly
    # like the 404 being asserted and proves nothing about the org check.
    from routers.ganit import _gate, _payables_gate
    app.dependency_overrides[_gate] = lambda: None
    app.dependency_overrides[_payables_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)
    app.dependency_overrides.pop(_payables_gate, None)


@pytest.fixture
def dristi_gate(app):
    from routers.dristi import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def prachar_gate(app):
    from routers.prachar import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def vikray_gates(app):
    from routers.vikray import _gate, _ganit_gate
    app.dependency_overrides[_gate] = lambda: None
    app.dependency_overrides[_ganit_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)
    app.dependency_overrides.pop(_ganit_gate, None)


# ══════════════════════════════════════════════════════════════════════════════
# Parent-guarded children
# ══════════════════════════════════════════════════════════════════════════════

async def test_contract_audit_trail_denied_for_foreign_contract(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    """
    `ganit_contract_audit_trail` is keyed on contract_id alone and carries
    signer names, emails, IP addresses and user agents. The ownership check on
    the parent contract is the only thing scoping it.
    """
    mock_pool.fetchval.side_effect = None
    mock_pool.fetchval.return_value = None          # contract not in this org
    resp = await api_client.get(f"/api/v1/ganit/contracts/{FOREIGN_ID}/audit-trail")
    assert resp.status_code == 404


async def test_scheduled_report_logs_denied_for_foreign_report(
    api_client, mock_pool, as_admin, with_org_id, dristi_gate,
):
    """`dristi_report_logs` has no org_id — recipients and failure reasons."""
    mock_pool.fetchval.side_effect = None
    mock_pool.fetchval.return_value = None
    resp = await api_client.get(f"/api/v1/dristi/scheduled-reports/{FOREIGN_ID}/logs")
    assert resp.status_code == 404


async def test_vendor_bill_payments_unreachable_for_foreign_bill(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    """`ganit_vendor_payments` is read by bill_id with no org filter of its own."""
    mock_pool.fetchrow.return_value = None          # bill not in this org
    resp = await api_client.get(f"/api/v1/ganit/vendor-bills/{FOREIGN_ID}")
    assert resp.status_code == 404


async def test_foreign_order_is_not_visible(
    api_client, mock_pool, as_admin, with_org_id, vikray_gates,
):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get(f"/api/v1/vikray/orders/{FOREIGN_ID}")
    assert resp.status_code == 404


# ══════════════════════════════════════════════════════════════════════════════
# Join-scoped — assert the join is in the SQL
# ══════════════════════════════════════════════════════════════════════════════

async def test_time_entry_billing_scopes_through_task_team_and_org(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    """
    `time_entries` has no org_id. Scoping it by employee alone attributed every
    entry a multi-org contractor had ever logged to whichever org billed first;
    the entry's real parent is the task, and through it the team and the org.

    Both parents must appear in the WHERE/JOIN, and the employee join must be
    correlated to the same org rather than standing alone.
    """
    mock_pool.fetch.return_value = []               # no entries -> 400, fine
    await api_client.post(
        "/api/v1/ganit/invoices/from-time-entries",
        json={"date_from": "", "date_to": ""},
    )

    sql = " ".join(
        str(c.args[0]) for c in mock_pool.fetch.call_args_list if c.args
    )
    assert "JOIN tasks" in sql, "time entries must be tied to their task"
    assert "JOIN teams" in sql, "and through the task to the team that owns it"
    assert "tm.org_id=$1::uuid" in sql, "and the team is what carries org_id"
    assert "e.org_id = tm.org_id" in sql, (
        "the employee join must be correlated to the same org, or a contractor "
        "employed by two orgs re-opens the leak"
    )


async def test_time_entry_billing_marks_entries_in_the_real_table(
    api_client, mock_pool, as_admin, with_org_id, ganit_gate,
):
    """
    `staging.time_entries` does not exist. Writing the billed flag there raised
    inside the transaction and rolled the invoice back, so the endpoint 500'd on
    every call — and the flag that prevents billing the same hours twice was
    never actually set.
    """
    mock_pool.fetch.return_value = [{
        "entry_id": "te-1", "task_id": "tk-1", "minutes": 60,
        "description": "work", "user_id": "u-1",
        "employee_name": "A", "hourly_rate": 100,
    }]
    conn = mock_pool.acquire.return_value
    conn.fetchrow.return_value = {
        "id": "inv-1", "invoice_number": "INV-2026-0001", "total": 118,
    }

    resp = await api_client.post(
        "/api/v1/ganit/invoices/from-time-entries", json={},
    )
    assert resp.status_code == 200

    writes = " ".join(str(c.args[0]) for c in conn.execute.call_args_list if c.args)
    assert "UPDATE time_entries" in writes
    assert "staging.time_entries" not in writes


# ══════════════════════════════════════════════════════════════════════════════
# Input-scoped — ids from the request body
# ══════════════════════════════════════════════════════════════════════════════

async def test_sequence_enrollment_rejects_contacts_from_another_org(
    api_client, mock_pool, as_admin, with_org_id, prachar_gate,
):
    """
    `prachar_sequence_enrollments` has no org_id and the contact ids came
    straight from the body. Enrolling another tenant's contacts meant the
    sequence engine would then send this org's marketing to them.
    """
    async def _fetchrow(query, *args):
        if "prachar_sequences" in query:
            # `status` is read by the response, which now says whether the
            # enrolment will actually be sent anything — a sequence that is not
            # active schedules nothing, and "20 contacts enrolled" read as a
            # promise of twenty emails.
            return {"id": "seq-1", "org_id": "org-1", "status": "active"}
        if "prachar_sequence_steps" in query:
            # `step_order` as well as the delay: `current_step` is the position
            # the contact is WAITING FOR, and it was hardcoded to 1 for a
            # sequence whose first step may be numbered anything.
            return {"step_order": 1, "delay_days": 1}
        return None
    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetch.return_value = []               # none of the ids are ours

    resp = await api_client.post(
        f"/api/v1/prachar/sequences/{FOREIGN_ID}/enroll",
        json={"contact_ids": [FOREIGN_ID, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"]},
    )
    assert resp.status_code == 200
    assert resp.json()["enrolled"] == 0
    assert resp.json()["rejected"] == 2

    ownership = [
        c for c in mock_pool.fetch.call_args_list
        if c.args and "graha_contacts" in str(c.args[0])
    ]
    assert ownership, "contact ids must be checked against the caller's own org"
    assert "org_id=$1::uuid" in str(ownership[0].args[0])


# ══════════════════════════════════════════════════════════════════════════════
# Cross-MODULE reach — the other half of "who can read this"
# ══════════════════════════════════════════════════════════════════════════════

async def test_dristi_hr_refuses_without_manav(
    api_client, mock_pool, as_member, with_org_id, dristi_gate,
):
    """A dristi grant is not a grant to the employee register."""
    async def _fv(query, *args):
        return None                                  # no platform, no org role, no grant
    mock_pool.fetchval.side_effect = _fv

    resp = await api_client.get("/api/v1/dristi/hr")
    assert resp.status_code == 403


async def test_dristi_revenue_refuses_without_ganit(
    api_client, mock_pool, as_member, with_org_id, dristi_gate,
):
    """Nor to the accounting ledger."""
    async def _fv(query, *args):
        return None
    mock_pool.fetchval.side_effect = _fv

    resp = await api_client.get("/api/v1/dristi/revenue")
    assert resp.status_code == 403


async def test_dristi_pivot_refuses_a_source_the_caller_cannot_reach(
    api_client, mock_pool, as_member, with_org_id, dristi_gate,
):
    """
    The pivot builder is a general-purpose reader over eight tables, two of
    which are the invoice ledger and the employee register.
    """
    async def _fv(query, *args):
        return None
    mock_pool.fetchval.side_effect = _fv

    resp = await api_client.post(
        "/api/v1/dristi/query", json={"source": "employees", "measure": "count"},
    )
    assert resp.status_code == 403


async def test_dristi_overview_withholds_rather_than_failing(
    api_client, mock_pool, as_member, with_org_id, dristi_gate,
):
    """
    The dashboard must not 403 wholesale — that would break it for everyone.
    Blocks the caller cannot reach are omitted and named in `withheld`, so the
    UI can show an honest gap instead of a zero that reads like "paid nobody".
    """
    async def _fv(query, *args):
        return None
    mock_pool.fetchval.side_effect = _fv
    mock_pool.fetchrow.return_value = None

    resp = await api_client.get("/api/v1/dristi/overview")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["withheld"]) == {"crm", "deals", "revenue", "hr", "orders", "payroll"}
    assert body["payroll"] == {}
    assert body["revenue"] == {}
