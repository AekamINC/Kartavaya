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
    """Holding the Manav module is a given in these tests — the question is
    whether holding it is SUFFICIENT."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: None
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
    """`require_org_role` waves platform_admin through with no org row at all.
    The audit row has to say so, or a support read is indistinguishable from the
    customer's own admin reading their own employee."""
    recorded = []
    monkeypatch.setattr(
        "routers.manav.audit",
        lambda action, request, **kw: recorded.append((action, kw)),
    )
    monkeypatch.setattr(
        "routers.manav.is_platform_staff", lambda uid: _true()
    )

    async def _fetchval(query, *args):
        if "role_code = 'platform_admin'" in query:
            return 1
        return None

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.return_value = FULL_PII_ROW

    resp = await api_client.get(SENSITIVE_URL)

    assert resp.status_code == 200
    assert recorded[0][1]["detail"]["via"] == "platform_bypass"


async def _true():
    return True


# ══════════════════════════════════════════════════════════════════════════════
# 2. The masked endpoint is what module membership DOES buy
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_module_member_gets_the_masked_row_not_a_refusal(
    api_client, mock_pool, as_member, org_a, bypass_module_gate,
):
    """The detail endpoint is deliberately reachable on module membership — HR
    staff need to see who is on file. What makes that safe is that it never
    emits a full identifier, so the two endpoints are tested as a pair."""
    mock_pool.fetchval.return_value = None
    mock_pool.fetchrow.return_value = {**FULL_PII_ROW, "employment_type": "full_time"}
    mock_pool.fetch.return_value = []

    resp = await api_client.get(f"/api/v1/manav/employees/{EMPLOYEE_ID}")

    assert resp.status_code == 200
    body = resp.text
    assert "123456789012" not in body
    assert "50100123456789" not in body
    assert resp.json()["employee"]["_pii_masked"] is True


# ══════════════════════════════════════════════════════════════════════════════
# 3. Grant LEVELS are stored and surfaced, and enforced nowhere
# ══════════════════════════════════════════════════════════════════════════════
#
# `test_role_tiers.py` pins `level_satisfies` thoroughly, including the invariant
# that admin does not satisfy approver in Vetana and Ganit. That function is
# correct. It is also, at the time of writing, called by NOTHING outside the
# tests — `require_module` reads only whether a grant row exists.
#
# These are characterisation tests. They assert what is true today so that the
# day someone wires levels in, they fail and force a deliberate update, rather
# than the gap staying invisible. They are not an endorsement of the gap; it is
# written up in swarm-reports/ as the largest open finding from this branch.

def test_level_satisfies_has_no_caller_in_the_request_path():
    """If this fails, levels have started being enforced somewhere — go and
    delete this test and the section comment above it, with thanks."""
    import pathlib
    backend = pathlib.Path(__file__).resolve().parent.parent
    callers = []
    for path in backend.rglob("*.py"):
        if "tests" in path.parts or "__pycache__" in path.parts:
            continue
        if path.name == "role_tiers.py":
            continue          # the definition itself
        if "level_satisfies" in path.read_text(encoding="utf-8", errors="ignore"):
            callers.append(str(path.relative_to(backend)))
    assert callers == [], (
        "level_satisfies now has production callers: "
        f"{callers}. The separation-of-duty model is being enforced — update "
        "this file's section 3 and add request-level tests for it."
    )


def test_the_module_gate_reads_existence_not_level():
    """`SELECT 1 FROM staging.org_member_modules` — the `role` column that holds
    the level is not in the projection, so a viewer grant and an admin grant are
    the same grant at request time."""
    import inspect
    from middleware import subscription
    src = inspect.getsource(subscription.require_module)
    assert "org_member_modules" in src
    assert "SELECT 1 FROM staging.org_member_modules" in src, (
        "the module gate's grant query changed — if it now selects the level, "
        "section 3 of this file is out of date"
    )


def test_the_separation_of_duty_model_itself_is_still_correct():
    """Not redundant with test_role_tiers.py — this is the one property that
    matters most, restated where the enforcement gap is documented, so the two
    are read together."""
    for module_code in ("vetana", "ganit"):
        assert level_satisfies("admin", "approver", module_code) is False
    assert level_satisfies("admin", "approver", "graha") is True


def test_the_sensitive_modules_are_the_ones_holding_money_and_identity():
    """The set that triggers audited platform access. Vetana and Ganit are the
    separated-duty modules; Manav holds the identity documents this file is
    about; Pahchan holds biometric attendance."""
    assert SENSITIVE_MODULES == {"vetana", "ganit", "manav", "pahchan"}
