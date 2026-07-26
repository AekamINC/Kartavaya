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

# ── Tier 2: organisation ──────────────────────────────────────────────────────
#
# These were the one tier this file did not name, so Tier 2 was still written as
# bare strings at every call site — `role_code IN ('org_owner','org_admin',
# 'org_member')` appears in `org_resolver.py`, `roles.py` and `subscription.py`,
# and `('org_owner','org_admin')` in several more. That is the exact 84-strings
# problem this module was created to end, just one tier down: adding an org role
# means finding every one, and a missed site fails silently in whichever
# direction is wrong.
#
# Naming them changes no behaviour. It gives the next person one place to edit.

#: Every Tier-2 code. Membership of an org at all — the sole tenant path.
ORG_ROLES: tuple[str, ...] = ("org_owner", "org_admin", "org_member")

#: Org roles that manage the org rather than merely belong to it. These are the
#: two that `require_module` already treats as holding every enabled module
#: without an explicit grant row, so they are the natural stand-in for "module
#: admin" until `org_member_modules.role` exists (see PROPOSED_065).
ORG_MANAGEMENT_ROLES: tuple[str, ...] = ("org_owner", "org_admin")

# ── Module reach ──────────────────────────────────────────────────────────────

#: Employee personal data. HR and Payroll hold salaries and personnel files;
#: Ganit holds the org's finances; Pahchan holds photographs of employees' faces
#: and their locations, twice a day.
HR_MODULES: frozenset[str] = frozenset({"manav", "vetana"})

#: Module codes as they appear in `require_module(...)`, verified against
#: backend/routers/.
#:
#: Messaging is `sanvaad`, ONE spelling, everywhere. It used to be `samvada`
#: here and in the CHECK while `staging.module_subscriptions`, the nav and the
#: design reference all said `sanvaad`, so `require_module("samvada")` looked
#: the entitlement up under a code that table has never held and Sanvaad was
#: unreachable for every user in every org. Three separate workarounds existed
#: to paper over it; all three are gone.
#:
#: The TABLES keep the `samvada_` prefix — `staging.samvada_messages` and its
#: five siblings are applied and are named in the design reference. A table name
#: is not a module code, and renaming those is a data migration for no gain.
ALL_MODULES: frozenset[str] = frozenset({
    "graha", "vikray", "prachar", "srijan", "dristi", "sanvaad",
    "ganit", "esign", "varta", "pahchan", "manav", "vetana",
})

#: platform_staff's operating set. Excludes finance (ganit), signed agreements
#: (esign), outbound WhatsApp (varta), attendance (pahchan) and all HR.
STAFF_MODULES: frozenset[str] = frozenset({
    "graha", "vikray", "prachar", "srijan", "dristi", "sanvaad",
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


# ── Tier 2: org roles ─────────────────────────────────────────────────────────
#
# This file was created to end 84 hardcoded PLATFORM role strings. The same
# smell exists one tier down and had no home until now: `require_org_role(
# "org_admin", "org_owner")` is written out as literals at ~15 call sites across
# org_members, org_profile, org_modules, org_security, manav, pahchan and graha.
# It fails the same way — add or rename an org role and you must find every one,
# and a missed site silently refuses access or grants it.
#
# These are named sets, not a hierarchy: `require_org_role` takes a varargs list
# and `platform_admin` passes it unconditionally regardless, so there is nothing
# to rank here.

#: Everyone who may OPEN organisation settings. Read access across the org
#: settings surface — profile, modules, security, the member list.
ORG_SETTINGS_ROLES: tuple[str, ...] = ("org_admin", "org_owner")

#: Writes that can lock the whole organisation out of something, or hand the
#: writer access they did not have. `org_owner` ALONE — deliberately narrower
#: than ORG_SETTINGS_ROLES, and the reason is a live gap rather than a taste:
#: `subscription.py`'s org-role short-circuit reads
#: `role_code IN ('org_owner','org_admin')` and skips the per-user grant check
#: on a hit. So an org_admin already reaches every ACTIVE module with no grant
#: row. If org_admin could also switch a module ON, an org_admin could hand
#: themselves Vetana — payroll — in one request with no owner involved.
ORG_OWNER_ONLY: tuple[str, ...] = ("org_owner",)


#: Ranked most-privileged first. Where a user holds several platform rows, the
#: strongest wins — matching how `subscription.py` already picks a role with
#: `ORDER BY (role_code = 'platform_admin') DESC LIMIT 1`.
PLATFORM_ROLE_PRECEDENCE: tuple[str, ...] = (
    "platform_owner", "platform_admin",
    "platform_manager", "platform_staff",
    "account_finance", "srijan_admin", "account_manager",
    "platform_support",
)


#: Tier 2 — the org roles that run an organisation. This file had constants for
#: Tier 1 and Tier 4 but none for Tier 2, so `require_org_role("org_owner",
#: "org_admin")` stayed written out by hand at every call site — the exact habit
#: this module exists to end, one tier lower down. Named here so the HR PII gate
#: reads from the same place as everything else.
ORG_ADMIN_ROLES: tuple[str, ...] = ("org_owner", "org_admin")


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
    "kartavya", "graha", "vikray", "prachar", "dristi", "srijan", "sanvaad", "esign",
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
    "kartavya", "dristi", "srijan", "sanvaad", "esign",
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


# ═══════════════════════════════════════════════════════════════════════════
# Tier 4, part two — resolving what a caller actually holds
#
# ADD-ONLY. Nothing above this line changed: roles.py, org_resolver.py,
# subscription.py, invite_router.py, admin_orgs.py, org_members.py, hub.py,
# scrapers.py, subscription router and task_reminders all import from this file,
# and a rename here is a silent breakage in eight places.
#
# Everything below imports lazily, inside function bodies. `org_resolver` and
# `subscription` both import THIS module at their own module scope, so a
# top-level import of either here is a cycle.
# ═══════════════════════════════════════════════════════════════════════════


def any_level_satisfies(held, required: str, module_code: str) -> bool:
    """Does ANY level this caller holds satisfy `required` for this module?

    A caller holds a SET of levels, not one. On a separated-duty module the set
    is the whole point: admin and approver are two different authorities and
    neither implies the other, so "the strongest level wins" is the wrong
    reduction — it would let admin mask an approver grant, or the reverse.

    Empty set, unknown level, unknown required level: False. Every one of those
    is a bug or a role nobody has taught this file about, and the safe answer to
    both is no.
    """
    if not held:
        return False
    return any(level_satisfies(h, required, module_code) for h in held)


async def held_module_levels(
    user_id: str | None, org_id: str | None, module_code: str
) -> frozenset[str]:
    """Every Tier-4 level this user holds on this module in this org.

    An EMPTY set is meaningful: it means "no grant at all", which for the three
    modules in SELF_SCOPED_MODULES is the ordinary case for an ordinary employee
    and entitles them to read their own row and nothing else.

    Three sources, unioned:

      · a platform role that may reach this module      → admin
      · org_owner / org_admin                           → admin
      · a row in staging.org_member_modules             → whatever it says

    Unioned rather than ranked because `staging.org_member_modules` will, after
    PROPOSED_067, be able to hold more than one row per person per module — the
    owner's "one user can have both admin and approver, auditable". Today the
    UNIQUE constraint caps it at one, so this returns at most two entries; the
    shape is right either way and the callers do not change when it lands.

    Fails closed: a missing user, a missing org, a module this file has never
    heard of, or a level outside LEVELS contributes nothing.
    """
    if not user_id or not org_id or module_code not in ALL_MODULES:
        return frozenset()

    from db import get_pool  # lazy: db imports nothing from middleware

    pool = await get_pool()
    levels: set[str] = set()

    # Aekam staff. `can_reach_module` is the same lookup `require_module` makes,
    # so a role that is refused the module there cannot acquire a level here —
    # for the HR modules that means god mode only, and that crossing has already
    # written an audit row by the time this runs.
    platform_role = await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[]) "
        "ORDER BY array_position($2::text[], role_code) LIMIT 1",
        user_id, list(PLATFORM_ROLE_PRECEDENCE),
    )
    if platform_role and can_reach_module(platform_role, module_code):
        levels.add(ADMIN)

    org_role = await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid "
        "AND role_code IN ('org_owner','org_admin') LIMIT 1",
        user_id, org_id,
    )
    if org_role:
        levels.add(ADMIN)

    # `org_member_modules.role` is added by PROPOSED_066 §1, which is PROPOSED —
    # the highest APPLIED migration in backend/migrations is 061. Until it runs,
    # this SELECT raises UndefinedColumnError, and because this function is on
    # the path of EVERY Manav and Vetana request that would be a total outage of
    # both modules rather than a refusal.
    #
    # So the missing column degrades to "a grant row exists, at the default
    # level" — which is exactly the value PROPOSED_066 gives the column
    # (`DEFAULT 'viewer'`), so behaviour does not change when the migration
    # lands. It is not a bypass: org_owner/org_admin and god mode reach `admin`
    # through the two queries above and never touch this one.
    import asyncpg

    try:
        rows = await pool.fetch(
            "SELECT role FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
            user_id, org_id, module_code,
        )
        for row in rows:
            granted = row["role"]
            if granted in LEVELS:
                levels.add(granted)
    except asyncpg.UndefinedColumnError:
        if await pool.fetchval(
            "SELECT 1 FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
            user_id, org_id, module_code,
        ):
            levels.add(DEFAULT_GRANT_LEVEL)

    return frozenset(levels)


def require_module_or_self(module_code: str):
    """`require_module`, except a caller with NO grant is admitted SELF-SCOPED.

    Returns a FastAPI dependency whose VALUE is the caller's level set, so a
    route writes `levels=Depends(_gate)` and has both the gate and the answer
    from one resolution per request (FastAPI caches a dependency per request).

    An empty set means self scope: read your own row, and submit the things that
    are yours to submit. It is never authority over anybody else's record, and
    `any_level_satisfies(frozenset(), anything, ...)` is False, so a route that
    forgets to special-case self scope refuses rather than leaks.

    Only the three modules in SELF_SCOPED_MODULES may use this. Anywhere else,
    "no grant" means no.
    """
    if module_code not in SELF_SCOPED_MODULES:
        # Raised at import time, not request time: a self-scope gate on a module
        # that has no self to scope to is a mistake that must not reach a deploy.
        raise ValueError(
            f"{module_code!r} is not in SELF_SCOPED_MODULES — use require_module()"
        )

    from fastapi import Depends, HTTPException, Request

    from auth_router import require_user
    from middleware.org_resolver import get_org_id
    from middleware.subscription import BUNDLED_MODULES, require_module

    inner = require_module(module_code)

    async def _check(
        request: Request,
        user=Depends(require_user),
        org_id: str = Depends(get_org_id),
    ) -> frozenset[str]:
        levels = await held_module_levels(user.get("user_id"), org_id, module_code)
        if levels:
            # Grant holders take the ordinary path in full — subscription state,
            # module activation, the sensitive-module audit row, all unchanged.
            await inner(request, org_id=org_id)
            return levels

        from db import get_pool

        pool = await get_pool()

        # Aekam staff with no reach into this module are REFUSED, not silently
        # downgraded to self scope. They are not employees of this org, so there
        # is no own-row for them to fall back to, and `require_module` says no
        # in words worth keeping.
        is_platform = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
            user.get("user_id"), list(ALL_PLATFORM_ROLES),
        )
        if is_platform or module_code in BUNDLED_MODULES:
            # BUNDLED_MODULES can never be self-scoped — none of the three are
            # bundled — so reaching here means the sets have drifted. Delegate
            # and let the ordinary gate refuse.
            await inner(request, org_id=org_id)
            return frozenset()

        # Self scope still requires the org to actually have the module. Reading
        # your own payslip is not a way into a module the customer never bought.
        sub_status = await pool.fetchval(
            "SELECT status FROM staging.subscriptions WHERE org_id=$1::uuid", org_id
        )
        if not sub_status or sub_status in ("cancelled", "paused"):
            raise HTTPException(403, "Subscription is not active")

        active = await pool.fetchval(
            "SELECT 1 FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
            org_id, module_code,
        )
        if not active:
            raise HTTPException(
                403,
                f"Module '{module_code}' is not active. "
                "Contact your administrator to activate it.",
            )
        return frozenset()

    return _check
