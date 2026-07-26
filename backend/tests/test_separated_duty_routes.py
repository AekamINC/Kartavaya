"""Separated duty at the ROUTE, and the one line still holding it back.

History, because it explains what this file is for.

When it was written, `level_satisfies` had zero call sites. The four-rung ladder
and the rule "in Vetana and Ganit, admin does NOT satisfy approver" were true of
a pure function nobody called, `require_module` checked only that a grant row
existed, and an `org_admin` got 200 from every money route in Vetana. The tests
here asserted 403, failed, and were marked `xfail(strict=True)` so the gap could
not close silently.

It has since closed. `middleware/module_levels.py` is the missing consumer,
`routers/vetana.py` resolves a level set per request, and every check goes
through `any_level_satisfies(...)`. The xfails are gone because there is now real
behaviour to assert instead.

────────────────────────────────────────────────────────────────────────────────
What is still open, and why it is not a defect
────────────────────────────────────────────────────────────────────────────────
`vetana._RELEASE_LEVEL` is `ADMIN`, not `APPROVER`. That is deliberate and
documented at length at its definition: `staging.org_member_modules` holds zero
rows, so nobody holds `approver` on vetana in any org. Shipping `APPROVER` today
would not narrow who can approve a payroll run — it would empty it, and payroll
would stop company-wide. `PROPOSED_071_vetana_approver_backfill.sql` grants the
rung to each org's owner first.

So the remaining change is one line, after one migration. These tests are built
around that: they prove the machinery refuses admin at the approver rung **right
now**, without waiting for the flip, by asking for `APPROVER` explicitly. The day
`_RELEASE_LEVEL` becomes `APPROVER`, the routes inherit behaviour these tests
have already pinned.

They deliberately do NOT assert `_RELEASE_LEVEL == APPROVER`. That would be a
test demanding a change whose prerequisite migration has not run — i.e. a test
demanding that payroll stop.
"""

import pytest

from middleware.role_tiers import (
    ADMIN,
    APPROVER,
    EDITOR,
    SEPARATED_DUTY_MODULES,
    VIEWER,
    any_level_satisfies,
    level_satisfies,
)

ORG_A = "00000000-0000-0000-0000-00000000000a"
RUN_ID = "r0000000-0000-0000-0000-000000000001"


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def held(app):
    """Set the caller's Tier-4 level set on Vetana.

    `_gate` is `require_module_or_self`, and its VALUE is the level set. Setting
    it directly is what lets these tests ask "what does holding exactly `admin`
    reach" — the question separated duty turns on.
    """
    from routers.vetana import _gate

    def _set(*levels):
        app.dependency_overrides[_gate] = lambda: frozenset(levels)

    yield _set
    app.dependency_overrides.pop(_gate, None)


# ══════════════════════════════════════════════════════════════════════════════
# 1. The route helper refuses admin at the approver rung — today
# ══════════════════════════════════════════════════════════════════════════════

def test_holding_admin_on_vetana_does_not_satisfy_approver():
    """The check the money routes make, called the way they call it.

    `_can` goes through `any_level_satisfies` → `level_satisfies`, never
    `LEVELS.index(a) >= LEVELS.index(b)` at the call site. That comparison is the
    one that quietly lets admin approve, and it is why the rule lives in
    role_tiers rather than at each route.
    """
    from routers.vetana import _can

    assert _can(frozenset({ADMIN}), ADMIN) is True
    assert _can(frozenset({ADMIN}), APPROVER) is False
    assert _can(frozenset({APPROVER}), APPROVER) is True


def test_the_refusal_message_says_why_rather_than_just_no():
    """A 403 reading "you need admin" to someone who HAS admin is a support
    ticket. The approver refusal has to explain that these are two authorities,
    not two seniorities."""
    from fastapi import HTTPException
    from routers.vetana import _require

    with pytest.raises(HTTPException) as exc:
        _require(frozenset({ADMIN}), APPROVER)

    detail = exc.value.detail.lower()
    assert exc.value.status_code == 403
    assert "approver" in detail
    assert "not the same authority" in detail or "does not release" in detail


@pytest.mark.parametrize("weaker", [VIEWER, EDITOR])
def test_levels_below_admin_reach_neither_rung(weaker):
    from routers.vetana import _can
    assert _can(frozenset({weaker}), APPROVER) is False
    assert _can(frozenset({weaker}), ADMIN) is False


def test_an_empty_level_set_approves_nothing():
    """Vetana is self-scoped: an employee with no grant reads their own payslip.
    That must not extend to releasing anyone's money."""
    from routers.vetana import _can
    assert _can(frozenset(), APPROVER) is False
    assert _can(frozenset(), ADMIN) is False


# ══════════════════════════════════════════════════════════════════════════════
# 2. End to end at the route, with the approver rung demanded
# ══════════════════════════════════════════════════════════════════════════════

async def test_approving_a_run_refuses_admin_once_the_rung_is_demanded(
    api_client, mock_pool, as_member, org_a, held, monkeypatch,
):
    """The real route, a real caller holding exactly `admin`, and the approver
    rung demanded — which is what `_RELEASE_LEVEL` becomes after PROPOSED_071.

    This is the test that would have caught the original defect, and it passes
    now rather than waiting on the migration. Patching the constant is legitimate
    precisely because it is documented as the one remaining line.
    """
    monkeypatch.setattr("routers.vetana._RELEASE_LEVEL", APPROVER)
    held(ADMIN)
    mock_pool.fetchrow.return_value = {"status": "processed"}
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(f"/api/v1/vetana/payroll/runs/{RUN_ID}/approve")

    assert resp.status_code == 403, (
        "admin on Vetana released a payroll run; whoever defines what people "
        "are paid must not also release the money"
    )
    assert "approver" in resp.json()["detail"].lower()


async def test_approving_a_run_admits_an_explicit_approver_grant(
    api_client, mock_pool, as_member, org_a, held, monkeypatch,
):
    """The contrast. Without it the test above passes on a route that refuses
    everybody — a different bug, and a worse one, because payroll stops."""
    monkeypatch.setattr("routers.vetana._RELEASE_LEVEL", APPROVER)
    held(APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed"}
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(f"/api/v1/vetana/payroll/runs/{RUN_ID}/approve")

    assert resp.status_code == 200


async def test_one_person_may_hold_both_but_it_takes_two_grants(
    api_client, mock_pool, as_member, org_a, held, monkeypatch,
):
    """The rule is not "these must be two people" — small firms exist. It is that
    the second authority is a second, separately-revocable grant rather than
    something admin confers by itself."""
    monkeypatch.setattr("routers.vetana._RELEASE_LEVEL", APPROVER)
    held(ADMIN, APPROVER)
    mock_pool.fetchrow.return_value = {"status": "processed"}
    mock_pool.fetch.return_value = []

    resp = await api_client.patch(f"/api/v1/vetana/payroll/runs/{RUN_ID}/approve")

    assert resp.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# 3. The hold itself, recorded so it cannot be forgotten
# ══════════════════════════════════════════════════════════════════════════════

def test_the_release_rung_is_a_named_constant_not_three_literals():
    """Three routes release money. Spelling the rung at each is how one of the
    three gets missed, and a half-enforced separation is worse than none because
    it reads as enforced."""
    import inspect
    from routers import vetana

    src = inspect.getsource(vetana)
    assert src.count("_require(levels, _RELEASE_LEVEL)") >= 3, (
        "a money route stopped using the shared release rung"
    )


def test_the_remaining_change_is_documented_where_it_will_be_read():
    """`_RELEASE_LEVEL` is ADMIN today because org_member_modules is empty, so
    demanding APPROVER would empty the set of people who can approve rather than
    narrow it. That reasoning has to live at the constant — a reader who finds
    ADMIN and no explanation reasonably concludes the rule was abandoned."""
    import inspect
    from routers import vetana

    src = inspect.getsource(vetana)
    marker = src[:src.index("_RELEASE_LEVEL = ")]
    assert "PROPOSED_071" in marker, (
        "the migration that unblocks the approver rung is no longer named at "
        "the constant it unblocks"
    )


def test_the_model_is_correct_for_every_separated_duty_module():
    """Restated where enforcement lives, so the two are read together."""
    for module_code in sorted(SEPARATED_DUTY_MODULES):
        assert level_satisfies(ADMIN, APPROVER, module_code) is False
        assert level_satisfies(APPROVER, APPROVER, module_code) is True
        assert any_level_satisfies(frozenset({ADMIN}), APPROVER, module_code) is False
    # Specific, not a blanket refusal: elsewhere the ladder is a plain hierarchy.
    assert level_satisfies(ADMIN, APPROVER, "graha") is True
