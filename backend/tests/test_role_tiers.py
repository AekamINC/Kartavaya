"""
role_tiers.py — the authorisation model itself, asserted directly.

`middleware/role_tiers.py` is the single source of truth for what every role can
reach. Everything else in the RBAC stack reads from it, so a mistake here is not
one wrong endpoint, it is every endpoint at once. These are unit tests on that
file because that is the level the invariants live at; the request-level
counterparts are in test_rbac_isolation.py and test_scraper_cost_basis.py.

Three invariants are worth more than the rest and each has its own section:

  1. In Vetana and Ganit, ADMIN DOES NOT SATISFY APPROVER. Whoever defines what
     people are paid must not also release the money.
  2. `modules_for()` FAILS CLOSED. A role added to the database enum but not to
     this file grants NOTHING — otherwise the next role someone invents silently
     inherits god mode.
  3. `platform_owner` is in EVERY console guard set. Those sets exist because the
     guards they replace were bare strings, and a legacy-alias rename must never
     lock out all four god-mode accounts at once.

The expected tables below are written out by hand rather than derived from
`LEVELS.index()`. Deriving them would re-implement the function under test and
pass no matter what it did.
"""

import pytest

from middleware.role_tiers import (
    ALL_MODULES,
    ALL_PLATFORM_ROLES,
    BILLING_CONSOLE_ROLES,
    COMMERCIAL_ONLY_ROLES,
    DEFAULT_GRANT_LEVEL,
    FINANCE_CONSOLE_ROLES,
    GOD_MODE_ROLES,
    HIERARCHICAL_MODULES,
    HR_MODULES,
    LEVELS,
    MANAGER_MODULES,
    NO_APPROVER_MODULES,
    NO_VIEWER_MODULES,
    OPERATIONS_CONSOLE_ROLES,
    PLATFORM_ROLE_PRECEDENCE,
    SEPARATED_DUTY_MODULES,
    SRIJAN_COMMERCIAL_ROLES,
    STAFF_MODULES,
    SUPERUSER_ONLY_ROLES,
    can_reach_module,
    is_god_mode,
    level_satisfies,
    modules_for,
    strongest,
    valid_levels_for,
)

LADDER = ("viewer", "editor", "approver", "admin")


# ══════════════════════════════════════════════════════════════════════════════
# 1. level_satisfies — the separation of duty
# ══════════════════════════════════════════════════════════════════════════════

#: held -> required -> expected, for a module where the ladder is a plain
#: hierarchy. Admin can do everything an approver can, and more.
_HIERARCHICAL_TRUTH = {
    "viewer":   {"viewer": True, "editor": False, "approver": False, "admin": False},
    "editor":   {"viewer": True, "editor": True,  "approver": False, "admin": False},
    "approver": {"viewer": True, "editor": True,  "approver": True,  "admin": False},
    "admin":    {"viewer": True, "editor": True,  "approver": True,  "admin": True},
}

#: The same table for Vetana and Ganit. Exactly one cell differs — admin/approver
#: — and that cell is the entire point of the module.
_SEPARATED_TRUTH = {
    "viewer":   {"viewer": True, "editor": False, "approver": False, "admin": False},
    "editor":   {"viewer": True, "editor": True,  "approver": False, "admin": False},
    "approver": {"viewer": True, "editor": True,  "approver": True,  "admin": False},
    # ── the invariant ────────────────────────────────────────────────────────
    "admin":    {"viewer": True, "editor": True,  "approver": False, "admin": True},
}


@pytest.mark.parametrize("module_code", sorted(HIERARCHICAL_MODULES))
@pytest.mark.parametrize("held", LADDER)
@pytest.mark.parametrize("required", LADDER)
def test_hierarchical_modules_are_a_plain_ladder(module_code, held, required):
    """Eight of the eleven modules: admin can do everything an approver can."""
    assert level_satisfies(held, required, module_code) is _HIERARCHICAL_TRUTH[held][required], (
        f"{module_code}: held={held} required={required}"
    )


@pytest.mark.parametrize("module_code", sorted(SEPARATED_DUTY_MODULES))
@pytest.mark.parametrize("held", LADDER)
@pytest.mark.parametrize("required", LADDER)
def test_separated_duty_modules_do_not_let_admin_climb_into_approver(
    module_code, held, required
):
    """Vetana and Ganit: admin is breadth, approver is depth, and they do not
    nest. Admin manages salary structures and the chart of accounts; approver
    releases payments and closes periods."""
    assert level_satisfies(held, required, module_code) is _SEPARATED_TRUTH[held][required], (
        f"{module_code}: held={held} required={required}"
    )


@pytest.mark.parametrize("module_code", sorted(SEPARATED_DUTY_MODULES))
def test_admin_alone_cannot_approve_where_money_moves(module_code):
    """Stated on its own, without a table around it, because this single fact is
    the reason SEPARATED_DUTY_MODULES exists. If this test is ever 'fixed' by
    making it pass with admin, the separation is gone."""
    assert level_satisfies("admin", "approver", module_code) is False
    # And the explicit grant does work — the rung is reachable, just not by
    # inheritance. One person MAY hold both; it is a second, auditable grant.
    assert level_satisfies("approver", "approver", module_code) is True


def test_the_separation_is_a_real_difference_from_the_other_modules():
    """Contrast, so the table above cannot be trivially satisfied by returning
    False for admin/approver everywhere."""
    assert level_satisfies("admin", "approver", "graha") is True
    assert level_satisfies("admin", "approver", "vetana") is False


@pytest.mark.parametrize("module_code", ["vetana", "ganit", "graha", "kartavya"])
@pytest.mark.parametrize("bogus", ["superuser", "owner", "ADMIN", "", "approver "])
def test_an_unknown_level_never_satisfies_anything(module_code, bogus):
    """Fails closed in both positions. A typo in a grant row must deny, not
    crash and not pass."""
    assert level_satisfies(bogus, "viewer", module_code) is False
    assert level_satisfies("admin", bogus, module_code) is False


@pytest.mark.parametrize("module_code", ["vetana", "graha"])
def test_no_grant_satisfies_nothing(module_code):
    assert level_satisfies(None, "viewer", module_code) is False


# ══════════════════════════════════════════════════════════════════════════════
# 2. modules_for — fails closed
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("unknown_role", [
    "platform_superuser",     # a plausible future invention
    "org_owner",              # a real role, but Tier 3 — not a platform role
    "admin",                  # the legacy users.role value
    "PLATFORM_OWNER",         # right role, wrong case
    "platform_ownerr",        # a typo in a migration
    "support",
])
def test_modules_for_grants_nothing_to_a_role_this_file_does_not_know(unknown_role):
    """THE invariant that stops a future role silently inheriting god mode.

    A role can be added to the database CHECK constraint without being added
    here — the two are not linked by anything but discipline. When that happens
    the holder must reach no module at all, so the omission surfaces as "I can't
    see anything" rather than as unrestricted access to every customer's payroll.
    """
    assert modules_for(unknown_role) == frozenset()
    assert not is_god_mode(unknown_role)
    for module_code in ALL_MODULES:
        assert can_reach_module(unknown_role, module_code) is False


@pytest.mark.parametrize("empty", [None, ""])
def test_modules_for_grants_nothing_for_no_role(empty):
    """A user with no platform row at all — the overwhelmingly common case."""
    assert modules_for(empty) == frozenset()
    assert not is_god_mode(empty)


@pytest.mark.parametrize("role", sorted(GOD_MODE_ROLES))
def test_god_mode_reaches_every_module_under_either_spelling(role):
    """`platform_admin` is the legacy spelling of `platform_owner`. Both are
    honoured until the data migration retires the old rows — dropping the alias
    early locks out all four accounts at once."""
    assert modules_for(role) == ALL_MODULES
    assert is_god_mode(role)


def test_platform_manager_reaches_everything_except_hr_and_payroll():
    granted = modules_for("platform_manager")
    assert granted == MANAGER_MODULES
    assert granted == ALL_MODULES - HR_MODULES
    # Named explicitly: these two are the whole exclusion.
    assert "manav" not in granted and "vetana" not in granted
    # And it is genuinely broad otherwise — not accidentally empty.
    assert "ganit" in granted and "pahchan" in granted and "esign" in granted


def test_platform_staff_reaches_only_the_operating_set():
    granted = modules_for("platform_staff")
    assert granted == STAFF_MODULES
    # Excluded on purpose: finance, signed agreements, outbound WhatsApp,
    # attendance, and all HR.
    for withheld in ("ganit", "esign", "varta", "pahchan", "manav", "vetana"):
        assert withheld not in granted, withheld
    assert "srijan" in granted and "graha" in granted


@pytest.mark.parametrize("role", sorted(COMMERCIAL_ONLY_ROLES) + ["platform_support"])
def test_commercial_specialist_and_support_roles_reach_no_customer_module(role):
    """account_finance sees billing and srijan_admin sees AI config — both live
    behind console guards, not behind a customer's operational records.
    platform_support is gated on an approval flow that does not exist yet, so it
    grants nothing rather than everything."""
    assert modules_for(role) == frozenset()


def test_every_platform_role_is_accounted_for_in_the_module_map():
    """No Tier-1 role may be silently absent. Each one either reaches a defined
    set or is deliberately empty — nothing falls through unconsidered."""
    reaching = {r for r in ALL_PLATFORM_ROLES if modules_for(r)}
    assert reaching == {"platform_owner", "platform_admin", "platform_manager", "platform_staff"}


# ══════════════════════════════════════════════════════════════════════════════
# 3. valid_levels_for — a grant that would do nothing is refused up front
# ══════════════════════════════════════════════════════════════════════════════

_EXPECTED_LEVELS = {
    # No viewer (everyone in the org edits tasks) and no approver.
    "kartavya": ("editor", "admin"),
    # No approver — nothing in them to approve.
    "dristi":   ("viewer", "editor", "admin"),
    "srijan":   ("viewer", "editor", "admin"),
    "samvada":  ("viewer", "editor", "admin"),
    "esign":    ("viewer", "editor", "admin"),
    # The full ladder.
    "graha":    ("viewer", "editor", "approver", "admin"),
    "vikray":   ("viewer", "editor", "approver", "admin"),
    "prachar":  ("viewer", "editor", "approver", "admin"),
    "ganit":    ("viewer", "editor", "approver", "admin"),
    "vetana":   ("viewer", "editor", "approver", "admin"),
    "manav":    ("viewer", "editor", "approver", "admin"),
    "pahchan":  ("viewer", "editor", "approver", "admin"),
    "varta":    ("viewer", "editor", "approver", "admin"),
}


@pytest.mark.parametrize("module_code,expected", sorted(_EXPECTED_LEVELS.items()))
def test_valid_levels_for(module_code, expected):
    """Offering a level a module has no use for invites a grant that silently
    does nothing — the member editor shows it, an admin picks it, and it means
    nothing at request time."""
    assert valid_levels_for(module_code) == expected


def test_kartavya_is_the_only_module_without_a_viewer():
    assert NO_VIEWER_MODULES == frozenset({"kartavya"})
    assert "viewer" not in valid_levels_for("kartavya")
    # The client is the exception and is handled by the Tier-3 project role.
    assert "editor" in valid_levels_for("kartavya")


def test_the_no_approver_set_is_exactly_the_five_modules_with_nothing_to_approve():
    assert NO_APPROVER_MODULES == frozenset(
        {"kartavya", "dristi", "srijan", "samvada", "esign"}
    )
    for module_code in NO_APPROVER_MODULES:
        assert "approver" not in valid_levels_for(module_code), module_code


def test_a_default_grant_is_the_weakest_level_the_module_has():
    """A default of admin means every grant is full control and the four levels
    never get used — which is the opposite of the reason for having them."""
    assert DEFAULT_GRANT_LEVEL == "viewer"
    assert DEFAULT_GRANT_LEVEL == LEVELS[0]


# ══════════════════════════════════════════════════════════════════════════════
# 4. The five console guard sets
# ══════════════════════════════════════════════════════════════════════════════

_CONSOLE_SETS = {
    "FINANCE_CONSOLE_ROLES": FINANCE_CONSOLE_ROLES,
    "BILLING_CONSOLE_ROLES": BILLING_CONSOLE_ROLES,
    "SUPERUSER_ONLY_ROLES": SUPERUSER_ONLY_ROLES,
    "OPERATIONS_CONSOLE_ROLES": OPERATIONS_CONSOLE_ROLES,
    "SRIJAN_COMMERCIAL_ROLES": SRIJAN_COMMERCIAL_ROLES,
}

#: The sets that reach money — Aekam's own P&L, customer billing, irreversible
#: platform actions, and Srijan credit top-ups.
_MONEY_MOVING_SETS = (
    "FINANCE_CONSOLE_ROLES",
    "BILLING_CONSOLE_ROLES",
    "SUPERUSER_ONLY_ROLES",
    "SRIJAN_COMMERCIAL_ROLES",
)


@pytest.mark.parametrize("set_name", sorted(_CONSOLE_SETS))
def test_platform_owner_is_in_every_console_guard_set(set_name):
    """The lockout invariant.

    `require_platform_role("platform_admin")` locks out `platform_owner`. Today
    that is invisible, because every god-mode account still holds the legacy
    `platform_admin` row — it becomes a total lockout of all four accounts on the
    day those rows are renamed, which is exactly the migration this model exists
    for. Both spellings must be present in all five sets, always.
    """
    roles = _CONSOLE_SETS[set_name]
    assert "platform_owner" in roles, f"{set_name} would lock out the owner"
    assert "platform_admin" in roles, f"{set_name} would lock out the legacy alias"


@pytest.mark.parametrize("set_name", _MONEY_MOVING_SETS)
def test_platform_staff_is_in_no_money_moving_set(set_name):
    """platform_staff's operating set exists to let staff do the work, not to let
    them bill for it — the same separation Vetana and Ganit make between admin
    and approver. Authoring a Srijan skill and topping up a client's credit
    balance are both 'Srijan'; only one of them spends."""
    assert "platform_staff" not in _CONSOLE_SETS[set_name], set_name


def test_platform_staff_does_reach_the_operations_console():
    """The contrast that makes the test above mean something: platform_staff is
    excluded from the money sets specifically, not from everything. Before this
    set existed, every Srijan hub route required platform_admin, so all four
    platform_staff holders were locked out of the exact work the role was created
    for."""
    assert "platform_staff" in OPERATIONS_CONSOLE_ROLES


def test_role_assignment_is_god_mode_only():
    """A role that can grant roles can grant itself anything, so this one is
    never delegated."""
    assert set(SUPERUSER_ONLY_ROLES) == set(GOD_MODE_ROLES)


def test_aekams_own_finances_are_not_widened_to_platform_manager():
    """platform_manager is defined over a CUSTOMER's modules. Aekam's own P&L is
    not one of them."""
    assert "platform_manager" not in FINANCE_CONSOLE_ROLES
    # But it does supersede account_manager on customer billing.
    assert "platform_manager" in BILLING_CONSOLE_ROLES
    assert "account_manager" in BILLING_CONSOLE_ROLES


@pytest.mark.parametrize("set_name", sorted(_CONSOLE_SETS))
def test_no_console_set_admits_a_role_outside_the_platform_tier(set_name):
    """A console guard must never be satisfiable by an org-scoped role. If one
    ever is, an org_owner in any customer org reaches Aekam's console."""
    for role in _CONSOLE_SETS[set_name]:
        assert role in ALL_PLATFORM_ROLES, f"{set_name} admits non-platform role {role!r}"


# ══════════════════════════════════════════════════════════════════════════════
# 5. strongest() — precedence when a user holds several rows
# ══════════════════════════════════════════════════════════════════════════════

def test_precedence_covers_every_platform_role():
    """A role missing from the precedence list makes strongest() return None for
    a user who genuinely holds it — which reads downstream as 'no platform role'
    and silently demotes them."""
    assert set(PLATFORM_ROLE_PRECEDENCE) == set(ALL_PLATFORM_ROLES)
    assert len(PLATFORM_ROLE_PRECEDENCE) == len(set(PLATFORM_ROLE_PRECEDENCE))


@pytest.mark.parametrize("held,expected", [
    (["platform_staff", "platform_owner"], "platform_owner"),
    (["account_manager", "platform_manager"], "platform_manager"),
    (["platform_support", "platform_staff"], "platform_staff"),
    (["platform_admin", "platform_owner"], "platform_owner"),
    (["srijan_admin", "account_finance"], "account_finance"),
    (["account_manager"], "account_manager"),
])
def test_strongest_picks_the_most_privileged_row(held, expected):
    assert strongest(held) == expected
    # Order of the input must not matter.
    assert strongest(list(reversed(held))) == expected


@pytest.mark.parametrize("held", [None, [], (), ["not_a_role"], ["org_admin"]])
def test_strongest_is_none_when_no_platform_role_is_held(held):
    assert strongest(held) is None
