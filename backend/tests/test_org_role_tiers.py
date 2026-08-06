"""
test_org_role_tiers.py — the Tier-2 half of the role model.

Three roles land here and each one is a different KIND of role, which is why
they are pinned together rather than in three files:

    hr_admin     an ORG's HR administrator. Manav and Pahchan, in their own
                 organisation, and nothing else. Consumes a seat: they sign in
                 and use the product.
    org_client   the customer's client.
    aekam_team   Aekam's own people on a customer project.

The last two are PROJECT-ONLY and consume NO seat. Their whole surface is
projects, tasks, task approvals and notifications — today's production
client-portal permission set — and the way that is enforced is that they reach
NO module at all. Anything wider goes through a support session
(`platform_support_sessions`, 959eb031); it never goes through widening these.

Most of what follows is pure — no database, no FastAPI — because the questions
are pure. "Does hr_admin reach vetana" is a fact about a dict, and a test that
needs a mocked pool to ask it is a test that can be satisfied by a mock.
"""
import re
from pathlib import Path

import pytest

from middleware.role_tiers import (
    ADMIN,
    ALL_MODULES,
    ALL_ORG_ROLES,
    GOD_MODE_ROLES,
    HR_ADMIN_MODULES,
    HR_ADMIN_ROLES,
    HR_MODULES,
    ORG_MANAGEMENT_ROLES,
    ORG_ROLE_MODULE_CEILING,
    ORG_ROLE_PRECEDENCE,
    ORG_ROLES,
    ORG_TENANT_ROLES,
    PROJECT_ONLY_ROLES,
    PROJECT_ONLY_SURFACES,
    SEAT_CONSUMING_ORG_ROLES,
    module_ceiling_for,
    modules_for,
    refuse_module_for_org_roles,
    role_consumes_seat,
    strongest_org_role,
)

BACKEND = Path(__file__).resolve().parent.parent


# ── hr_admin: the gap in the model ───────────────────────────────────────────

def test_hr_admin_is_an_org_role_and_not_a_platform_one():
    """It is the ORG's HR administrator. A platform role would reach every org,
    which is the opposite of what this role is for."""
    from middleware.role_tiers import ALL_PLATFORM_ROLES

    assert HR_ADMIN_ROLES == ("hr_admin",)
    assert "hr_admin" in ALL_ORG_ROLES
    assert "hr_admin" not in ALL_PLATFORM_ROLES
    # `modules_for` is the Tier-1 lookup. Asked about an org code it must answer
    # NOTHING rather than fall through to some default — that default is how a
    # role invented next month inherits god mode.
    assert modules_for("hr_admin") == frozenset()


def test_hr_admin_reaches_manav_and_pahchan_and_nothing_else():
    assert HR_ADMIN_MODULES == frozenset({"manav", "pahchan"})
    ceiling = module_ceiling_for(["hr_admin"])
    assert ceiling == frozenset({"manav", "pahchan"})
    for module in sorted(ALL_MODULES - HR_ADMIN_MODULES):
        assert refuse_module_for_org_roles(["hr_admin"], module), (
            f"hr_admin was admitted to {module}"
        )
    for module in sorted(HR_ADMIN_MODULES):
        assert refuse_module_for_org_roles(["hr_admin"], module) is None


def test_hr_admin_does_not_reach_payroll_or_the_books():
    """Manav is personnel, Vetana is what people are PAID and Ganit is the
    books. An HR administrator who could also release a payroll run would be
    both halves of the separated duty `SEPARATED_DUTY_MODULES` exists to keep
    apart."""
    assert "vetana" not in HR_ADMIN_MODULES
    assert "ganit" not in HR_ADMIN_MODULES
    assert refuse_module_for_org_roles(["hr_admin"], "vetana")
    assert refuse_module_for_org_roles(["hr_admin"], "ganit")


def test_pahchan_is_still_not_in_HR_MODULES():
    """MEASURED, and deliberate under the DPDP notice: only god mode reaches
    attendance across orgs. `HR_MODULES` is what a PLATFORM role is refused by
    REACH; `HR_ADMIN_MODULES` is what an ORG's own HR administrator may reach in
    their OWN org. Adding pahchan to the first is the "tidy-up" the brief
    forbids, and it would change what `MANAGER_MODULES` means.

    Attendance is not refused to platform_manager by `HR_MODULES` at all — it is
    refused by `subscription.SENSITIVE_MODULES`, one gate later, which is the
    FOUR-code set. Both facts are pinned because the whole risk here is somebody
    reading one of the two sets and concluding the other is wrong."""
    from middleware.subscription import SENSITIVE_MODULES, platform_refusal

    assert HR_MODULES == frozenset({"manav", "vetana"})
    assert "pahchan" not in HR_MODULES

    # Reach says yes for the manager tier — and the sensitive gate then says no.
    assert "pahchan" in modules_for("platform_manager")
    assert "pahchan" in SENSITIVE_MODULES
    for role in ("platform_manager", "platform_staff"):
        assert platform_refusal(role, "pahchan", is_write=False), (
            f"{role} reached attendance"
        )
    assert platform_refusal(GOD_MODE_ROLES[0], "pahchan", is_write=False) is None


def test_hr_admin_consumes_a_seat():
    """They sign in and use the product. A role that reaches two modules and
    costs nothing is a way to buy Manav for free."""
    assert role_consumes_seat("hr_admin") is True
    assert "hr_admin" in SEAT_CONSUMING_ORG_ROLES


# ── The two project-only roles ───────────────────────────────────────────────

def test_project_only_roles_are_exactly_org_client_and_aekam_team():
    assert PROJECT_ONLY_ROLES == ("org_client", "aekam_team")


def test_project_only_roles_reach_no_module_at_all():
    """This is the WHOLE enforcement, and it is why it is stated as an empty
    set rather than as a list of refusals. Every module router in the product is
    `require_module(...)`-gated, so a role whose ceiling is empty is confined to
    the surfaces that are NOT module-gated — core PM and notifications — with no
    per-module rule to keep in step."""
    for role in PROJECT_ONLY_ROLES:
        assert module_ceiling_for([role]) == frozenset()
        for module in sorted(ALL_MODULES):
            assert refuse_module_for_org_roles([role], module), (
                f"{role} was admitted to {module}"
            )


def test_project_only_roles_consume_no_seat():
    for role in PROJECT_ONLY_ROLES:
        assert role_consumes_seat(role) is False
        assert role not in SEAT_CONSUMING_ORG_ROLES


def test_the_project_only_surface_is_the_client_portal_set():
    """Projects, tasks, task approvals, notifications. Widening this set is the
    shortcut the support session exists to prevent, so it is pinned by value."""
    assert PROJECT_ONLY_SURFACES == frozenset({
        "projects", "tasks", "task_approvals", "notifications",
    })


def test_a_project_only_role_cannot_be_widened_by_a_module_grant_row():
    """A grant row naming a module does not rescue a capped role. If it did,
    "give the client Graha for a minute" would be one row away and the ceiling
    would be advisory."""
    for role in PROJECT_ONLY_ROLES:
        # The ceiling is computed from the ROLES, never from the grants — so a
        # caller cannot pass a grant in to change the answer.
        assert module_ceiling_for([role]) == frozenset()
    assert refuse_module_for_org_roles(["org_client", "aekam_team"], "graha")


# ── The ceiling, and the case that must NOT be capped ────────────────────────

def test_an_uncapped_role_removes_the_ceiling():
    """A person may hold two rows. Somebody who is both the HR administrator
    and an ordinary member is not confined to HR — their member grants are
    real."""
    assert module_ceiling_for(["hr_admin", "org_member"]) is None
    assert module_ceiling_for(["org_member"]) is None
    assert module_ceiling_for(["org_admin"]) is None
    assert module_ceiling_for(["org_owner"]) is None
    assert refuse_module_for_org_roles(["hr_admin", "org_member"], "graha") is None


def test_two_capped_roles_union_their_ceilings():
    assert module_ceiling_for(["hr_admin", "org_client"]) == HR_ADMIN_MODULES


def test_no_rows_means_no_ceiling():
    """No org row at all is not "capped to nothing" — it is a question for the
    subscription gate and the grant table, not for this function. Answering
    frozenset() here would refuse every platform caller acting in a customer
    org."""
    assert module_ceiling_for([]) is None
    assert module_ceiling_for(None) is None
    assert refuse_module_for_org_roles([], "graha") is None


def test_an_unknown_org_code_never_lifts_a_ceiling():
    """Fails closed. A role code this file has not been taught about must not
    act as the uncapped role that removes the cap — that would make "invent a
    role code" a way past the ceiling."""
    assert module_ceiling_for(["org_client", "not_a_real_role"]) == frozenset()
    assert refuse_module_for_org_roles(["org_client", "not_a_real_role"], "graha")


# ── The sets other modules build on ──────────────────────────────────────────

def test_org_roles_is_unchanged_so_nothing_silently_gained_a_seat():
    """`ORG_ROLES` is what `org_invites.SEAT_ROLES` and the resolver were built
    from. Adding the new codes to it — rather than to the new sets — is the
    single mistake that would give a client a paid seat, so the old tuple is
    pinned by value."""
    assert ORG_ROLES == ("org_owner", "org_admin", "org_member")


def test_the_tenant_set_holds_every_org_code():
    """"Holds a row in this organisation at all". A project-only role has to be
    in it or the org resolver refuses them their own organisation and the role
    is dead on arrival."""
    assert set(ORG_TENANT_ROLES) == set(ALL_ORG_ROLES)
    for role in PROJECT_ONLY_ROLES + HR_ADMIN_ROLES:
        assert role in ORG_TENANT_ROLES


def test_precedence_covers_every_org_code_exactly_once():
    """`strongest_org_role` reads this, and so does the `array_position`
    ordering in the two gates. A code missing from it sorts nowhere and the
    answer becomes row order."""
    assert sorted(ORG_ROLE_PRECEDENCE) == sorted(ALL_ORG_ROLES)
    assert len(set(ORG_ROLE_PRECEDENCE)) == len(ORG_ROLE_PRECEDENCE)
    assert ORG_ROLE_PRECEDENCE[0] == "org_owner"
    assert strongest_org_role(["org_client", "org_admin"]) == "org_admin"
    assert strongest_org_role(["hr_admin", "org_member"]) == "hr_admin"
    assert strongest_org_role([]) is None
    assert strongest_org_role(["nonsense"]) is None


def test_every_capped_role_is_a_real_org_role():
    for code in ORG_ROLE_MODULE_CEILING:
        assert code in ALL_ORG_ROLES
    # Management roles are never capped — an owner capped to a module list
    # would be locked out of their own organisation.
    for code in ORG_MANAGEMENT_ROLES:
        assert code not in ORG_ROLE_MODULE_CEILING


def test_the_ceilings_name_only_modules_that_exist():
    for code, ceiling in ORG_ROLE_MODULE_CEILING.items():
        assert ceiling <= ALL_MODULES, f"{code} names a module that does not exist"


# ── The gates that have to consult the model ─────────────────────────────────

def _code_only(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


def test_the_subscription_gate_applies_the_ceiling():
    """`require_module` is the gate every module router hangs on. If it does not
    ask for the ceiling, the ceiling is a comment."""
    code = _code_only("middleware/subscription.py")
    assert "refuse_module_for_org_roles" in code, (
        "require_module does not consult the org-role ceiling"
    )
    assert not re.search(
        r"role_code IN \('org_owner','org_admin'\)", code
    ), "the org-role short-circuit still reads two literals and cannot see hr_admin"


def test_the_org_resolver_admits_every_tenant_role():
    """A project-only role that cannot resolve its own organisation is a role
    that 403s on every request. Both literals in `get_org_id` — the header
    branch and the fallback — have to read the shared set."""
    code = _code_only("middleware/org_resolver.py")
    assert code.count("ORG_TENANT_ROLES") >= 2, (
        "get_org_id still hardcodes the three original org codes"
    )
    assert not re.search(
        r"role_code IN \('org_owner','org_admin','org_member'\)", code
    ), "an org-role literal survives in the resolver"


def test_the_seat_counter_counts_the_seat_consuming_set():
    code = _code_only("routers/org_invites.py")
    assert "SEAT_CONSUMING_ORG_ROLES" in code, (
        "SEAT_ROLES is still ORG_ROLES, so hr_admin consumes no seat"
    )


# ── The database has to admit the codes ──────────────────────────────────────

def test_a_migration_widens_the_role_code_check_to_every_code():
    """MEASURED on the live database 2026-08-06: `user_roles_role_code_check`
    admits twelve codes and none of the three new ones. Assigning one without
    the migration is a 23514 from Postgres, not a 400 from the API.

    This walks the .sql rather than the database because the migration is
    WRITTEN and deliberately NOT APPLIED — staging and production share one
    schema, so applying it is a production change."""
    from middleware.role_tiers import ALL_PLATFORM_ROLES

    matches = sorted(
        (BACKEND / "migrations").glob("*_org_role_codes.sql")
    )
    assert matches, "no migration adds the new role codes to the CHECK constraint"
    sql = matches[-1].read_text(encoding="utf-8")
    assert "user_roles_role_code_check" in sql
    for code in set(ALL_ORG_ROLES) | set(ALL_PLATFORM_ROLES):
        assert f"'{code}'" in sql, f"{code} is missing from the new CHECK constraint"
    # The legacy codes live in real rows and dropping them from the constraint
    # would make those rows unwritable.
    for legacy in ("developer", "srijan_admin"):
        assert f"'{legacy}'" in sql, f"{legacy} was dropped from the constraint"
