"""
role_tiers.py — the single source of truth for what each role can reach.

Before this file the tier model lived as 84 hardcoded strings across five
modules: `("platform_admin", "account_manager")` written out by hand in
`roles.py`, `subscription.py`, `org_resolver.py`, `admin_orgs.py` and
`invite_router.py`. Adding a role meant finding all 84 and getting every one
right, and MISSING ONE FAILS SILENTLY IN THE DANGEROUS DIRECTION — a forgotten
call site does not error, it just refuses access, or grants it.

Owner's decision, 2026-07-26:

    platform_owner    god mode. Four people. Every module, every org.
    platform_manager  CRUD on every module EXCEPT HR and Payroll.
    platform_staff    CRUD on the operating set — CRM, sales, marketing, Srijan
                      (including authoring skills and publishing), analytics,
                      messaging, core PM and automations.

`platform_admin` is kept as a LEGACY ALIAS of `platform_owner`, not removed.
The database still holds `platform_admin` rows and the CHECK constraint still
admits it; dropping it before the data migrates would lock out all four god-mode
accounts at once. It is retired by deleting rows, not by deleting code.

`account_manager` is superseded by `platform_manager`. It is kept readable for
the same reason and grants nothing on its own — see COMMERCIAL_ONLY_ROLES.
"""

# ── Tier 1: platform ──────────────────────────────────────────────────────────

#: God mode. `platform_admin` is the legacy spelling of `platform_owner`; both
#: are honoured until the data migration retires the old rows.
GOD_MODE_ROLES: tuple[str, ...] = ("platform_owner", "platform_admin")

#: Everything except HR and Payroll.
MANAGER_ROLES: tuple[str, ...] = ("platform_manager",)

#: The operating set. Narrower than manager.
STAFF_ROLES: tuple[str, ...] = ("platform_staff",)

#: Approval-gated, time-boxed support access. Specified in RBAC-SPEC and NOT yet
#: implemented — `platform_support_sessions` does not exist, so a holder of this
#: role currently gets nothing. Listed so the enum and the code agree.
SUPPORT_ROLES: tuple[str, ...] = ("platform_support",)

#: Commercial and specialist roles that reach billing or AI config, never a
#: customer's operational records.
COMMERCIAL_ONLY_ROLES: tuple[str, ...] = ("account_manager", "account_finance", "srijan_admin")

#: Every Tier-1 code. Used for "is this user platform staff at all".
ALL_PLATFORM_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + SUPPORT_ROLES + COMMERCIAL_ONLY_ROLES
)

# ── Module reach ──────────────────────────────────────────────────────────────

#: Employee personal data. HR and Payroll hold salaries and personnel files;
#: Ganit holds the org's finances; Pahchan holds photographs of employees' faces
#: and their locations, twice a day.
HR_MODULES: frozenset[str] = frozenset({"manav", "vetana"})

#: Module codes as they appear in `require_module(...)`, verified against
#: backend/routers/. Note `samvada` — the nav calls the same module `sanvaad`.
ALL_MODULES: frozenset[str] = frozenset({
    "graha", "vikray", "prachar", "srijan", "dristi", "samvada",
    "ganit", "esign", "varta", "pahchan", "manav", "vetana",
})

#: platform_staff's operating set. Excludes finance (ganit), signed agreements
#: (esign), outbound WhatsApp (varta), attendance (pahchan) and all HR.
STAFF_MODULES: frozenset[str] = frozenset({
    "graha", "vikray", "prachar", "srijan", "dristi", "samvada",
})

#: platform_manager: everything except HR and Payroll.
MANAGER_MODULES: frozenset[str] = ALL_MODULES - HR_MODULES


def modules_for(platform_role: str | None) -> frozenset[str]:
    """
    Which modules this platform role may reach in a customer org.

    A role this file does not know about gets NOTHING. That default matters: a
    role added to the database enum but not to this file must fail closed, or
    the next role someone invents silently inherits god mode.
    """
    if not platform_role:
        return frozenset()
    if platform_role in GOD_MODE_ROLES:
        return ALL_MODULES
    if platform_role in MANAGER_ROLES:
        return MANAGER_MODULES
    if platform_role in STAFF_ROLES:
        return STAFF_MODULES
    # Commercial, specialist and support roles reach no operational module.
    # account_finance sees billing; srijan_admin sees AI config; both are
    # elsewhere. platform_support is gated on an approval flow that does not
    # exist yet, so it grants nothing rather than everything.
    return frozenset()


def can_reach_module(platform_role: str | None, module_code: str) -> bool:
    """True if this platform role may cross into `module_code` for a customer."""
    return module_code in modules_for(platform_role)


def is_god_mode(platform_role: str | None) -> bool:
    return platform_role in GOD_MODE_ROLES


#: Ranked most-privileged first. Where a user holds several platform rows, the
#: strongest wins — matching how `subscription.py` already picks a role with
#: `ORDER BY (role_code = 'platform_admin') DESC LIMIT 1`.
PLATFORM_ROLE_PRECEDENCE: tuple[str, ...] = (
    "platform_owner", "platform_admin",
    "platform_manager", "platform_staff",
    "account_finance", "srijan_admin", "account_manager",
    "platform_support",
)


def strongest(roles: list[str] | tuple[str, ...] | None) -> str | None:
    """The most privileged platform role from a set, or None."""
    if not roles:
        return None
    for candidate in PLATFORM_ROLE_PRECEDENCE:
        if candidate in roles:
            return candidate
    return None
