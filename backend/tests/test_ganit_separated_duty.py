"""
Separated duty in Ganit — admin does not satisfy approver.

The rule (role_tiers.py, owner's decision 2026-07-26): in Vetana and Ganit,
ADMIN AND APPROVER ARE NOT A HIERARCHY. Admin is breadth — the chart of
accounts, the salary structures. Approver is depth — closing the period,
releasing the money. Whoever defines what people are paid must not also be the
one who releases it.

`level_satisfies()` encoded that rule from the day the tier model landed and was
never called by anything. These tests cover both the pure rule and the guard
that now enforces it, in both of the guard's states — before and after
PROPOSED_074 creates the table that an approver grant lives in.
"""
import pytest

from middleware import module_levels
from middleware.role_tiers import (
    ADMIN,
    APPROVER,
    EDITOR,
    SEPARATED_DUTY_MODULES,
    VIEWER,
    level_satisfies,
)

TEST_ORG_ID = "00000000-0000-0000-0000-0000000000aa"


# ══════════════════════════════════════════════════════════════════════════════
# The rule itself
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_admin_does_not_satisfy_approver_in_separated_modules(module):
    """The whole point. If this passes trivially one day, the rule is gone."""
    assert level_satisfies(ADMIN, APPROVER, module) is False


@pytest.mark.parametrize("module", sorted(SEPARATED_DUTY_MODULES))
def test_only_approver_approves_in_separated_modules(module):
    assert level_satisfies(APPROVER, APPROVER, module) is True
    assert level_satisfies(EDITOR, APPROVER, module) is False
    assert level_satisfies(VIEWER, APPROVER, module) is False
    assert level_satisfies(None, APPROVER, module) is False


def test_ganit_is_a_separated_duty_module():
    """Guards against someone 'simplifying' ganit out of the set."""
    assert "ganit" in SEPARATED_DUTY_MODULES
    assert "vetana" in SEPARATED_DUTY_MODULES


@pytest.mark.parametrize("module", ["graha", "vikray", "prachar", "esign"])
def test_admin_still_satisfies_approver_in_hierarchical_modules(module):
    """The exception is narrow. Everywhere else admin really does cover approver."""
    assert level_satisfies(ADMIN, APPROVER, module) is True


def test_admin_still_satisfies_the_lower_rungs_in_ganit():
    """Separation applies to the approver rung only — admin is still admin."""
    assert level_satisfies(ADMIN, VIEWER, "ganit") is True
    assert level_satisfies(ADMIN, EDITOR, "ganit") is True
    assert level_satisfies(ADMIN, ADMIN, "ganit") is True


# ══════════════════════════════════════════════════════════════════════════════
# The guard — before PROPOSED_074 (approver table absent)
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _reset_probe_cache():
    """The table-exists probe latches for the process; tests must not inherit it."""
    module_levels.reset_approver_table_cache()
    yield
    module_levels.reset_approver_table_cache()


@pytest.fixture
def bypass_module_gate(app):
    from routers.ganit import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


def _route_fetchval(mock_pool, *, table_exists, org_role=None,
                    platform_role=None, approver_row=None):
    """Answer the guard's four probes by matching on query text."""
    async def _fv(query, *args):
        if "to_regclass" in query:
            return table_exists
        if "org_module_approvers" in query:
            return approver_row
        if "public.user_roles" in query and "org_id IS NULL" in query:
            return platform_role
        if "public.user_roles" in query and "org_owner" in query:
            return org_role
        return 0
    mock_pool.fetchval.side_effect = _fv


async def test_before_migration_org_owner_may_still_cancel(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """
    Until the approver table exists there is nowhere to record an approver, so
    enforcing it would lock every org out of its own books. The guard falls back
    to today's access rather than failing closed on an unmigrated database.
    """
    _route_fetchval(mock_pool, table_exists=False, org_role="org_owner")
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/cancel",
    )
    assert resp.status_code == 200


async def test_before_migration_plain_member_is_still_refused(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """The fallback is a fallback, not an open door."""
    _route_fetchval(mock_pool, table_exists=False, org_role=None, platform_role=None)
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/cancel",
    )
    assert resp.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# The guard — after PROPOSED_074 (approver table present)
# ══════════════════════════════════════════════════════════════════════════════

async def test_org_admin_without_approver_grant_cannot_cancel_invoice(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """
    The rule, enforced end to end. org_admin holds every breadth power in Ganit
    and still cannot void a tax document without a second, explicit grant.
    """
    _route_fetchval(mock_pool, table_exists=True, org_role="org_admin", approver_row=None)
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/cancel",
    )
    assert resp.status_code == 403
    assert "approver" in resp.json()["detail"].lower()


async def test_org_admin_without_approver_grant_cannot_pay_a_vendor_bill(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """Money leaving the company is the other separated action."""
    _route_fetchval(mock_pool, table_exists=True, org_role="org_admin", approver_row=None)
    resp = await api_client.post(
        "/api/v1/ganit/vendor-bills/00000000-0000-0000-0000-000000000001/payments",
        json={"amount": 5000},
    )
    assert resp.status_code == 403


async def test_explicit_approver_grant_allows_the_cancel(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """One user MAY hold both — it just has to be visible. Owner's note."""
    _route_fetchval(mock_pool, table_exists=True, org_role="org_admin", approver_row=1)
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/cancel",
    )
    assert resp.status_code == 200


async def test_platform_admin_cannot_approve_without_an_explicit_grant(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """
    The stronger half of the rule. God mode reaches every module, and reaching
    Ganit is not the same as being the customer's finance approver — Aekam
    support must never be able to release a customer's money.
    """
    _route_fetchval(
        mock_pool, table_exists=True, platform_role="platform_admin", approver_row=None,
    )
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/cancel",
    )
    assert resp.status_code == 403


async def test_ordinary_bookkeeping_is_not_gated_on_approver(
    api_client, mock_pool, as_member, with_org_id, bypass_module_gate,
):
    """
    Recording a customer receipt is not an approval. Separation must not creep
    into ordinary work — that is how a control gets switched off wholesale.
    """
    _route_fetchval(mock_pool, table_exists=True, org_role="org_admin", approver_row=None)
    mock_pool.fetchrow.return_value = {
        "total": 1000, "amount_paid": 0, "payment_status": "unpaid",
    }
    resp = await api_client.post(
        "/api/v1/ganit/invoices/00000000-0000-0000-0000-000000000001/payments",
        json={"amount": 500},
    )
    assert resp.status_code == 200
