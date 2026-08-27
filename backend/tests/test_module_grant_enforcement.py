"""What a module grant actually buys you.

Two questions, and the codebase answers them in two different places:

  1. Does holding the Manav module let you read a colleague's Aadhaar and bank
     account? It must not. The protection is `_pii_gate` on
     `/employees/{id}/sensitive`, and until this file NOTHING exercised it —
     every existing test of that endpoint starts by overriding `_pii_gate` to a
     no-op, so all of them would have passed with the gate deleted.

  2. Does the LEVEL on a grant (viewer / editor / approver / admin) restrict
     anything at request time? Today: no. See the last section — that gap is
     characterised here rather than left implicit, because the model that
     defines those levels is meticulously tested in `test_role_tiers.py` and it
     is easy to read that suite as evidence the levels are enforced.

The module gate itself is bypassed where the question is about a narrower gate,
and exercised directly where the question is about the module gate.
"""

import pytest

from middleware.role_tiers import level_satisfies
from middleware.subscription import SENSITIVE_MODULES

ORG_A = "00000000-0000-0000-0000-00000000000a"
EMPLOYEE_ID = "e0000000-0000-0000-0000-000000000001"
SENSITIVE_URL = f"/api/v1/manav/employees/{EMPLOYEE_ID}/sensitive"

FULL_PII_ROW = {
    "id": EMPLOYEE_ID,
    "name": "Priya Sharma",
    "employee_code": "EMP001",
    "aadhaar": "123456789012",
    "pan": "ABCDE1234F",
    "bank_details": {"account_number": "50100123456789", "ifsc": "HDFC0001234"},
}


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def bypass_module_gate(app):
    """Holding the Manav module at `admin` is a given in these tests — the
    question is whether holding it is SUFFICIENT to read an identity document.

    `_gate` is now `require_module_or_self`, and its VALUE is the caller's
    Tier-4 level set rather than None. Returning the strongest level is
    deliberate: it removes the module ladder as an explanation for any refusal
    below, so what these tests observe is `_pii_gate` and nothing else.
    """
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


# ══════════════════════════════════════════════════════════════════════════════
# 1. A module grant is not authority to read an identity document
# ══════════════════════════════════════════════════════════════════════════════

async def test_module_membership_alone_cannot_read_a_colleagues_aadhaar(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """THE test this endpoint did not have.

    Every other test of `/sensitive` overrides `_pii_gate` away, so the entire
    protection on full Aadhaar, PAN and bank account was unexercised. The caller
    here holds the Manav module and no org role — the ordinary case for anyone
    in an HR team who is not the owner.
    """
    mock_pool.fetchval.return_value = None      # no platform row, no org role
    mock_pool.fetchrow.return_value = FULL_PII_ROW

    resp = await api_client.get(SENSITIVE_URL)

    assert resp.status_code == 403
    # And nothing leaked in the refusal body.
    assert "123456789012" not in resp.text
    assert "50100123456789" not in resp.text


async def test_the_refusal_happens_before_the_row_is_even_read(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """A gate that refuses after loading the row is one refactor away from
    returning it. FastAPI resolves dependencies before the handler body, so the
    query must never run."""
    seen = []

    async def _fetchrow(query, *args):
        seen.append(query)
        return FULL_PII_ROW

    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.side_effect = _fetchrow

    await api_client.get(SENSITIVE_URL)

    assert not any("aadhaar" in q for q in seen), (
        "the identity columns were selected despite the caller being refused"
    )


async def test_the_pii_gate_asks_for_an_org_role_scoped_to_this_org(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """The 403 above is only meaningful if the check is genuinely scoped. A gate
    that queried without `org_id` would also 403 against an empty mock, while in
    production admitting an org_admin from a DIFFERENT customer."""
    seen = {}

    async def _fetchval(query, *args):
        if "org_id=$2::uuid" in query:
            seen["query"] = query
            seen["args"] = args
        return None

    mock_pool.fetchval.side_effect = _fetchval
    await api_client.get(SENSITIVE_URL)

    assert "query" in seen, "the org-scoped role lookup never ran"
    assert ORG_A in seen["args"]
    assert set(seen["args"][-1]) == {"org_owner", "org_admin"}


async def test_an_org_admin_may_read_it_and_the_read_is_recorded(
    api_client, mock_pool, as_member, org_a, bypass_module_gate, monkeypatch,
):
    """The contrast. Without it every test above passes on an endpoint that
    refuses everyone, which would be a different bug.

    The audit row is part of the contract, not a nicety: `require_org_role`
    passes platform staff unconditionally, so without it their access to an
    identity document would be silent."""
    recorded = []
    monkeypatch.setattr(
        "routers.manav.audit",
        lambda action, request, **kw: recorded.append((action, kw)),
    )

    async def _fetchval(query, *args):
        # Not platform staff; is an org_admin in THIS org.
        if "role_code = 'platform_admin'" in query:
            return None
        if "org_id=$2::uuid" in query:
            return "org_admin"
        return None

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.return_value = FULL_PII_ROW

    resp = await api_client.get(SENSITIVE_URL)

    assert resp.status_code == 200
    assert resp.json()["employee"]["aadhaar"] == "123456789012"
    assert resp.json()["audited"] is True

    assert recorded, "an identity-document read left no audit row"
    action, kw = recorded[0]
    assert action == "manav.employee_pii_revealed"
    assert kw["severity"] == "warn"
    assert kw["resource_id"] == EMPLOYEE_ID
    assert set(kw["detail"]["fields"]) == {"aadhaar", "pan", "bank_details"}


async def test_a_platform_bypass_is_recorded_as_a_bypass(
    api_client, mock_pool, as_member, org_a, bypass_module_gate, monkeypatch,
):
    """God mode reaches this employee's Aadhaar without an org_admin row of its
    own. The audit row has to say so, or a support read is indistinguishable
    from the customer's own admin reading their own employee.

    IT DOES NEED AN ORG ROW NOW — a bare `org_member` one, supplied below.
    `require_org_role` used to wave god mode through with no membership of any
    kind, which made this the same request in Unicode Group's employee file as
    in Aekam's. `middleware/roles.may_act_in_org` closed that; the bypass this
    test is about is the one INSIDE an organisation the caller belongs to, where
    the platform row still outranks a weak org row and the audit row is the only
    thing that records which of the two got them in.

    The god-mode probe reads `GOD_MODE_ROLES` rather than the bare string
    `'platform_admin'` it used to. That literal excluded `platform_owner` — the
    exact lockout `role_tiers.py` warns about, invisible today only because every
    god-mode account still holds a legacy `platform_admin` row. This routes on
    the parameterised query, so it follows the fix rather than pinning the
    string that had the bug in it.
    """
    from middleware.role_tiers import GOD_MODE_ROLES, ORG_ROLES

    recorded = []
    monkeypatch.setattr(
        "routers.manav.audit",
        lambda action, request, **kw: recorded.append((action, kw)),
    )
    monkeypatch.setattr(
        "routers.manav.is_platform_staff", lambda uid: _true()
    )

    probed = {}

    async def _fetchval(query, *args):
        # The platform probe: org_id IS NULL, no org-scoped predicate.
        if "org_id IS NULL" in query and "org_id=$2::uuid" not in query:
            probed["roles"] = args[-1]
            return 1
        # The membership probe — `SELECT 1`, org-scoped. A bare org_member, so
        # the org-role lookup below it (which asks for org_owner/org_admin) still
        # misses and the platform row is still what admits them.
        if "SELECT 1 FROM staging.user_roles" in query:
            probed["membership"] = args[-1]
            return 1
        return None

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.return_value = FULL_PII_ROW

    resp = await api_client.get(SENSITIVE_URL)

    assert resp.status_code == 200
    assert recorded[0][1]["detail"]["via"] == "platform_bypass"

    # And the probe asked for the whole god-mode set, so renaming the legacy
    # rows cannot lock every god-mode account out of every org at once.
    assert set(probed["roles"]) == set(GOD_MODE_ROLES)
    assert "platform_owner" in probed["roles"]

    # The membership question was actually asked. Without this the test would
    # pass again the day someone deletes the check, because the mock above
    # answers whatever it is asked.
    assert set(probed["membership"]) == set(ORG_ROLES)


async def _true():
    return True


# ══════════════════════════════════════════════════════════════════════════════
# 2. The masked endpoint is what module membership DOES buy
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_module_member_gets_the_masked_row_not_a_refusal(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """The detail endpoint is deliberately reachable on a module grant — HR staff
    need to see who is on file. What makes that safe is that it never emits a
    full identifier, so the two endpoints are tested as a pair.

    `user_id` is a COLLEAGUE's, not the caller's: the endpoint now self-scopes,
    so reading your own row proves nothing about what a grant buys. This is the
    grant path, which is the one that matters here.
    """
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.return_value = {
        **FULL_PII_ROW,
        "user_id": "user_a_colleague",
        "employment_type": "full_time",
    }
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{EMPLOYEE_ID}")

    assert resp.status_code == 200
    body = resp.text
    assert "123456789012" not in body
    assert "50100123456789" not in body
    assert resp.json()["employee"]["_pii_masked"] is True


async def test_no_grant_at_all_cannot_read_a_colleagues_row_even_masked(
    app, api_client, mock_pool, as_member, org_a,
):
    """Self scope is "my own record", not "everyone's, masked". An employee with
    no Manav grant reads their own row and nothing else.

    404 rather than 403 is deliberate and worth pinning: a 403 would confirm
    that an employee with that id exists in this org, which is itself a
    disclosure.
    """
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset()
    try:
        mock_pool.fetchval.return_value = None
        mock_pool.fetchrow.return_value = {
            **FULL_PII_ROW,
            "user_id": "user_a_colleague",
            "employment_type": "full_time",
        }
        mock_pool.fetch.return_value = []

        resp = await api_client.get(f"/api/v1/manav/employees/{EMPLOYEE_ID}")

        assert resp.status_code == 404
        assert "123456789012" not in resp.text
    finally:
        app.dependency_overrides.pop(_gate, None)


# ══════════════════════════════════════════════════════════════════════════════
# 3. Grant LEVELS are now enforced — `middleware/module_levels.py`
# ══════════════════════════════════════════════════════════════════════════════
#
# This section used to hold characterisation tests asserting that
# `level_satisfies` had ZERO call sites and that a viewer grant and an admin
# grant reached the same endpoints. They were written to fail the day enforcement
# landed, so that the gap could not close silently and unremarked.
#
# They fired. `middleware/module_levels.py` is the missing consumer, and the
# routes read it. The characterisation tests have been replaced by tests of the
# thing that now exists — which is what those tests instructed whoever saw them
# fail to do.

def test_level_satisfies_now_has_production_callers():
    """The inverse of the test that used to live here.

    It is kept, rather than simply deleted, because a guard that is deleted or
    quietly unwired reverts the product to the state this file was written to
    document, and nothing else would notice.
    """
    import pathlib
    backend = pathlib.Path(__file__).resolve().parent.parent
    callers = []
    for path in backend.rglob("*.py"):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        if path.name == "role_tiers.py":
            continue          # the definition itself
        if "level_satisfies" in path.read_text(encoding="utf-8", errors="ignore"):
            callers.append(path.name)
    assert "module_levels.py" in callers, (
        "the Tier-4 guard no longer consults level_satisfies — module grant "
        "levels have stopped being enforced"
    )


def test_the_module_level_gate_reads_the_level_not_just_existence():
    """`held_level` selects `role` — the column carrying the level — rather than
    `SELECT 1`. That single difference is what separates a viewer from an admin
    at request time, and it was the whole defect."""
    import inspect
    from middleware import module_levels
    src = inspect.getsource(module_levels.held_level)
    assert "SELECT role FROM staging.org_member_modules" in src


def test_an_unknown_or_legacy_grant_level_reads_as_the_weakest_not_the_strongest():
    """Grant rows predate the level column. Failing UPWARD on an unrecognised
    value would hand full control to every legacy row at once — the failure mode
    is silent and total, so it is worth its own test."""
    import inspect
    from middleware import module_levels
    src = inspect.getsource(module_levels.held_level)
    assert "DEFAULT_GRANT_LEVEL" in src
    assert "grant if grant in LEVELS else DEFAULT_GRANT_LEVEL" in src
    from middleware.role_tiers import DEFAULT_GRANT_LEVEL, LEVELS
    assert DEFAULT_GRANT_LEVEL == LEVELS[0] == "viewer"


def test_the_separation_of_duty_model_itself_is_still_correct():
    """Not redundant with test_role_tiers.py — this is the one property that
    matters most, restated where enforcement is documented, so the two are read
    together."""
    for module_code in ("vetana", "ganit"):
        assert level_satisfies("admin", "approver", module_code) is False
    assert level_satisfies("admin", "approver", "graha") is True


def test_the_sensitive_modules_are_the_ones_holding_money_and_identity():
    """The set that triggers audited platform access. Vetana and Ganit are the
    separated-duty modules; Manav holds the identity documents this file is
    about; Pahchan holds biometric attendance."""
    # `kray` joined on 2026-08-23 (`7770045b`). It belongs under the rule
    # this set states: procurement holds vendor bills, payment records and
    # supplier bank details — financial records, the same category as
    # Ganit's. The reason is written beside the set itself in
    # `middleware/subscription.py`, which is what this assertion demands
    # when it says "confirm the new membership is what the owner decided".
    assert SENSITIVE_MODULES == {"vetana", "ganit", "manav", "pahchan", "kray"}
