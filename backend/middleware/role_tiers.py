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


# ── Console guard sets ────────────────────────────────────────────────────────
#
# These exist because the guards they replace were written as bare strings at the
# call site, which is the same failure this module was created to end. Two
# concrete consequences were live before they landed:
#
#   · `require_platform_role("platform_admin")` locks out `platform_owner`. Today
#     that is invisible, because every god-mode account still holds the legacy
#     `platform_admin` row. It becomes a total lockout of all four accounts on
#     the day those rows are renamed — which is exactly the migration this model
#     was designed for.
#   · `require_platform_role("platform_admin", "account_manager")` omits
#     `platform_manager`, the role that SUPERSEDES `account_manager`. The
#     successor reached strictly less than the role it replaced.

#: Aekam's own commercial data — platform-wide KPIs, cost summaries, provider
#: reconciliation, margin. NOT widened to platform_manager: that role is defined
#: over a CUSTOMER's modules, and Aekam's own P&L is not one of them.
FINANCE_CONSOLE_ROLES: tuple[str, ...] = GOD_MODE_ROLES + ("account_finance",)

#: Customer subscriptions, plans, invoices and payments. `platform_manager` is
#: included because it supersedes `account_manager`; `platform_staff` is not,
#: because its operating set deliberately excludes finance.
BILLING_CONSOLE_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + ("account_manager", "account_finance")
)

#: Irreversible or trust-establishing platform actions: assigning and revoking
#: roles, deactivating an org, writing storage credentials. God mode only.
#: Role assignment in particular must never be delegated — a role that can grant
#: roles can grant itself anything.
SUPERUSER_ONLY_ROLES: tuple[str, ...] = GOD_MODE_ROLES

#: Day-to-day operating work: authoring and publishing Srijan skills, running
#: scrapers, configuring reminder automations.
#:
#: This is the set that makes `platform_staff` mean anything. Before it, every
#: Srijan hub route required platform_admin/account_manager/srijan_admin, so all
#: four platform_staff holders were locked out of the exact work the role was
#: created for — "Srijan, including authoring skills and publishing" — and both
#: platform_manager holders with them.
OPERATIONS_CONSOLE_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + ("account_manager", "srijan_admin")
)

#: Srijan work that MOVES OR REPORTS MONEY: client records, credit top-ups, spend
#: analytics.
#:
#: Deliberately NOT OPERATIONS_CONSOLE_ROLES. Authoring a skill and topping up a
#: client's credit balance are both "Srijan", but only one of them spends. The
#: operating set exists to let staff do the work, not to let them bill for it —
#: the same separation Vetana and Ganit make between admin and approver.
SRIJAN_COMMERCIAL_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + ("account_manager", "account_finance", "srijan_admin")
)

#: Modules whose grants are withheld by default when a member is added without an
#: explicit list. Broader than HR_MODULES: it adds `ganit`, the org's finances.
#: Payroll, personnel files and the books are not handed out by omission.
SENSITIVE_MODULES: frozenset[str] = HR_MODULES | {"ganit"}


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


# ═══════════════════════════════════════════════════════════════════════════
# Tier 4 — module levels
#
# Owner's decision, 2026-07-26.
# ═══════════════════════════════════════════════════════════════════════════

VIEWER, EDITOR, APPROVER, ADMIN = "viewer", "editor", "approver", "admin"

#: The ladder, weakest first.
LEVELS: tuple[str, ...] = (VIEWER, EDITOR, APPROVER, ADMIN)

#: Modules where the ladder is a plain hierarchy: admin can do everything an
#: approver can, and more. Eight of the eleven.
#: "Admin can do all" — the owner's words, and true everywhere it does not
#: move money.
HIERARCHICAL_MODULES: frozenset[str] = frozenset({
    "kartavya", "graha", "vikray", "prachar", "dristi", "srijan", "samvada", "esign",
})

#: Modules where APPROVER AND ADMIN ARE NOT A HIERARCHY.
#:
#: Admin is breadth, approver is depth. In Vetana, admin manages salary
#: structures and statutory config; approver approves runs and releases payments.
#: **Admin alone cannot approve a payroll run.** Whoever defines what people are
#: paid must not also be the one who releases the money. Same shape in Ganit:
#: admin owns the chart of accounts, approver closes periods.
#:
#: One person MAY hold both — that is allowed and sometimes necessary in a small
#: firm. The point is that it becomes an explicit, auditable second grant rather
#: than something admin quietly includes. Owner's note: "one user can have both
#: FYI but auditable."
SEPARATED_DUTY_MODULES: frozenset[str] = frozenset({"vetana", "ganit"})

#: Modules with no approver level at all — nothing in them to approve.
NO_APPROVER_MODULES: frozenset[str] = frozenset({
    "kartavya", "dristi", "srijan", "samvada", "esign",
})

#: Kartavya has no viewer: everyone in the org edits tasks. Client is the
#: exception and is handled by the Tier-3 project role, not by a module level.
NO_VIEWER_MODULES: frozenset[str] = frozenset({"kartavya"})

#: Modules where every employee gets read access to THEIR OWN record with no
#: grant at all — own payslip, own profile, own attendance. Anything beyond
#: their own row needs a grant.
SELF_SCOPED_MODULES: frozenset[str] = frozenset({"vetana", "manav", "pahchan"})


def level_satisfies(held: str | None, required: str, module_code: str) -> bool:
    """
    Does `held` satisfy `required` for this module?

    Hierarchical for most modules. For Vetana and Ganit, ADMIN DOES NOT SATISFY
    APPROVER — holding admin there means you configure it, not that you can
    release money against it. A user who needs both holds both, visibly.
    """
    if held is None:
        return False
    if held not in LEVELS or required not in LEVELS:
        return False

    if module_code in SEPARATED_DUTY_MODULES and required == APPROVER:
        # Only an explicit approver grant approves here. Admin is breadth, not
        # seniority, so it does not climb into this rung.
        return held == APPROVER

    return LEVELS.index(held) >= LEVELS.index(required)


def valid_levels_for(module_code: str) -> tuple[str, ...]:
    """The levels that mean something for this module. Offering a level a module
    has no use for invites a grant that silently does nothing."""
    levels = list(LEVELS)
    if module_code in NO_APPROVER_MODULES:
        levels.remove(APPROVER)
    if module_code in NO_VIEWER_MODULES:
        levels.remove(VIEWER)
    return tuple(levels)


#: What a new grant starts at when no level is given.
#:
#: NOT the spec's `admin`. The owner's reason for wanting RBAC at all was to give
#: specific, multiple, narrow roles to specific users — and a default of admin
#: means every grant is full control and the four levels never get used. A grant
#: starts at the least it can be and is raised deliberately.
DEFAULT_GRANT_LEVEL: str = VIEWER
