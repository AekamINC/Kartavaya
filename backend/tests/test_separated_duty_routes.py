"""Separated duty, asserted on the ROUTES rather than on the function.

`test_separated_duty.py` and `test_role_tiers.py` pin `level_satisfies`
thoroughly and correctly: in Vetana and Ganit, admin does NOT satisfy approver.
Whoever defines what people are paid must not also release the money.

That function has **zero call sites in the entire backend**. It is a correct
model that nothing consults. `require_module` checks only that a grant row
exists, never its level, and Vetana's money-moving actions resolve through
`_require_payroll_admin` → `is_org_admin` — the same predicate that guards
`POST /salary-structures`. So the one person who sets a salary is, today, the
same person who approves the run that pays it.

    vetana.py  POST  /salary-structures            _require_payroll_admin
    vetana.py  PATCH /payroll/runs/{id}/approve    _require_payroll_admin
    vetana.py  PATCH /payslips/{id}/disburse       _require_payroll_admin

Reading the two suites above, it is very easy to conclude the separation is
enforced. It is not. These tests exist so that conclusion cannot be drawn from
the test suite alone.

──────────────────────────────────────────────────────────────────────────────
WHY THESE ARE xfail(strict=True) AND NOT PLAIN FAILURES
──────────────────────────────────────────────────────────────────────────────
They assert the behaviour the product is SUPPOSED to have, and it does not have
it, so they fail. The assertions below are not weakened in any way — no
`or 200`, no relaxed status set. What is declared is only the *expected
outcome*: a known-open defect.

`strict=True` matters. The moment enforcement lands, these XPASS, and a strict
xfail that passes is a hard FAILURE — so nobody can quietly close the gap without
being told to come back here and delete the markers. `strict=False`, which an
earlier salvage branch used for exactly this purpose, would have gone green
silently and told no one.

The alternative — leaving the suite hard-red on shared `staging` — trains a
20-agent swarm to ignore CI, and the first person who wants a green run deletes
the test. That is the outcome this file exists to prevent.

To see them as ordinary failures:  `pytest tests/test_separated_duty_routes.py --runxfail`
To see the reasons in a normal run: `pytest -rx`

**There is an unresolved spec contradiction blocking the actual fix, and it needs
the owner, not an agent:**

  * `RBAC-SPEC.md:65` — "Sensitive modules are role-derived, not granted. Vetana,
    Ganit and Manav have no per-member grant row at all." A grant row naming a
    sensitive module is invalid input.
  * The Tier-4 level model assumes a grant row *carrying a level* is precisely
    how approver is held.

Both cannot be true. Building enforcement against the wrong one is worse than the
present gap, because it would look enforced. These tests deliberately assert only
that admin-alone is REFUSED — they do not assert how approver is held, so
whichever way the contradiction is settled, they stay correct.
"""

import pytest

from middleware.role_tiers import SEPARATED_DUTY_MODULES, level_satisfies

ORG_A = "00000000-0000-0000-0000-00000000000a"
RUN_ID = "r0000000-0000-0000-0000-000000000001"
PAYSLIP_ID = "p0000000-0000-0000-0000-000000000001"

_OPEN_GAP = (
    "OPEN GAP — level_satisfies() has zero call sites. Vetana's money-moving "
    "routes resolve through _require_payroll_admin -> is_org_admin, which is the "
    "same predicate that guards POST /salary-structures. An org_admin who sets a "
    "salary can also approve the run that pays it. Blocked on the RBAC-SPEC:65 "
    "vs Tier-4 contradiction in the module docstring — needs the owner. Delete "
    "this marker when enforcement lands."
)


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def bypass_module_gate(app):
    """The subscription/module gate is not the subject here. The caller holds
    Vetana; the question is what holding it plus org_admin permits."""
    from routers.vetana import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def as_org_admin(monkeypatch):
    """An org_admin and nothing more — no approver grant of any kind.

    This is the ordinary case: the person who administers the org. The whole
    point of the separated-duty model is that this role, on its own, must not
    release money.
    """
    async def _yes(user_id, org_id=None):
        return True
    monkeypatch.setattr("routers.vetana.is_org_admin", _yes)


# ══════════════════════════════════════════════════════════════════════════════
# The model says admin is not approver. The routes do not ask.
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.xfail(strict=True, reason=_OPEN_GAP)
async def test_an_org_admin_alone_cannot_approve_a_payroll_run(
    api_client, mock_pool, as_admin, org_a, bypass_module_gate, as_org_admin,
):
    """Approving a run is the moment salaries become payable.

    `level_satisfies("admin", "approver", "vetana")` is False — the model is
    unambiguous. The route never asks it, so an org_admin approves today.
    """
    mock_pool.fetchrow.return_value = {"status": "processed"}
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(f"/api/v1/vetana/payroll/runs/{RUN_ID}/approve")

    assert resp.status_code == 403, (
        "an org_admin released a payroll run with no approver authority; "
        "the same role can also define the salary structure being paid"
    )


@pytest.mark.xfail(strict=True, reason=_OPEN_GAP)
async def test_an_org_admin_alone_cannot_disburse_a_payslip(
    api_client, mock_pool, as_admin, org_a, bypass_module_gate, as_org_admin,
):
    """Disbursement is the money actually leaving. Same predicate, same gap."""
    # `run_id` as well as `status`: the handler reads both, and a row missing it
    # raises KeyError, which would xfail this test for a broken-fixture reason
    # rather than for the gap it is meant to pin.
    mock_pool.fetchrow.return_value = {"status": "approved", "run_id": RUN_ID}
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(
        f"/api/v1/vetana/payslips/{PAYSLIP_ID}/disburse"
    )

    assert resp.status_code == 403


@pytest.mark.xfail(strict=True, reason=_OPEN_GAP)
async def test_defining_a_salary_and_approving_its_run_need_different_authority(
    api_client, mock_pool, as_admin, org_a, bypass_module_gate, as_org_admin,
):
    """The separation stated as one assertion, because this is the whole point.

    A single caller reaches BOTH the route that decides what someone is paid and
    the route that releases the payment. Whichever way the RBAC-SPEC
    contradiction is settled, these two must not resolve through one predicate.
    """
    mock_pool.fetchrow.return_value = {"status": "processed", "id": RUN_ID}
    mock_pool.fetch.return_value = []

    define = await api_client.post(
        "/api/v1/vetana/salary-structures",
        json={"employee_id": "e0000000-0000-0000-0000-00000000005e",
              "ctc_annual": 1},
    )
    approve = await api_client.patch(
        f"/api/v1/vetana/payroll/runs/{RUN_ID}/approve"
    )

    assert not (define.status_code < 400 and approve.status_code < 400), (
        "one caller both defined a salary structure and approved the payroll "
        "run that pays it"
    )


# ══════════════════════════════════════════════════════════════════════════════
# What IS true today — so the gap above is unmistakable rather than inferred
# ══════════════════════════════════════════════════════════════════════════════

def test_the_model_itself_is_correct_and_unambiguous():
    """Restated here, where the enforcement gap is documented, so the two are
    read together. If this ever fails, the gap is no longer the only problem."""
    for module_code in sorted(SEPARATED_DUTY_MODULES):
        assert level_satisfies("admin", "approver", module_code) is False
        assert level_satisfies("approver", "approver", module_code) is True
    # And the separation is specific, not a blanket refusal everywhere.
    assert level_satisfies("admin", "approver", "graha") is True


def test_the_money_routes_and_the_salary_route_share_one_predicate():
    """The mechanical statement of the gap: the two authorities that must differ
    are literally the same function call. Source-level, because that is the
    level at which the defect exists — every route below reads correct in
    isolation."""
    import inspect
    from routers import vetana

    src = inspect.getsource(vetana)
    for handler in ("approve_run", "disburse_payslip", "create_salary_structure"):
        fn = getattr(vetana, handler, None)
        if fn is None:
            continue
        body = inspect.getsource(fn)
        assert "_require_payroll_admin" in body, (
            f"{handler} no longer uses _require_payroll_admin — if it now takes "
            "a level, this file's xfail markers are stale"
        )
    assert "level_satisfies" not in src, (
        "vetana.py now consults level_satisfies — enforcement has landed, so "
        "remove the xfail markers above"
    )
