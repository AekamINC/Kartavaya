"""
role_tiers.py — the single source of truth for what each role can reach.

Before this file the tier model lived as 84 hardcoded strings across five
modules: `("platform_admin", "account_manager")` written out by hand in
`roles.py`, `subscription.py`, `org_resolver.py`, `admin_orgs.py` and
`invite_router.py`. Adding a role meant finding all 84 and getting every one
right, and MISSING ONE FAILS SILENTLY IN THE DANGEROUS DIRECTION — a forgotten
call site does not error, it just refuses access, or grants it.

Owner's decision, 2026-07-26:

    platform_owner    god mode. THREE people. Every module, every org.
                      `RBAC-SPEC.md:18` names them individually; that list is
                      authoritative and this comment is not. Counted here
                      because an audit that expects a fourth either hunts for
                      an account that should not exist or accepts one that
                      does.
    platform_manager  CRUD on every module EXCEPT HR and Payroll.
    platform_staff    CRUD on the operating set — CRM, sales, marketing, Sahayak
                      (including authoring skills and publishing), analytics,
                      messaging, core PM and automations.

`platform_admin` is kept as a LEGACY ALIAS of `platform_owner`, not removed.
The database still holds `platform_admin` rows and the CHECK constraint still
admits it; dropping it before the data migrates would lock out every god-mode
account at once. It is retired by deleting rows, not by deleting code.

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

#: Commercial roles that reach billing, never a customer's operational records.
#:
#: `sahayak_admin` was here and should not have been. It is not a commercial role
#: — it authors skills — and being listed here is exactly why it could not do
#: that: `modules_for` returns nothing for this tuple, so the role NAMED AFTER
#: the module was refused the module. It passed
#: `require_platform_role(*OPERATIONS_CONSOLE_ROLES)` on `create_skill_template`
#: and was then refused by `_hub_gate` on the same request, with
#: "The sahayak_admin role cannot access the sahayak module."
#:
#: Nobody hit it because the role has zero holders — verified against the live
#: catalog 2026-08-02. It has been dead since it was written.
COMMERCIAL_ONLY_ROLES: tuple[str, ...] = ("account_manager", "account_finance")

#: Authors Sahayak skills, and nothing else.
#:
#: Owner's decision, 2026-08-02: keep `sahayak_admin` and repair it rather than
#: mint a new code. It already exists in the live CHECK constraint, in
#: `PLATFORM_ROLE_PRECEDENCE`, in the console's assignable list and in
#: `adminNav.js`, which already documents its surface as "the Sahayak hub at
#: /hub". Zero holders means repairing it breaks no account and no session, and
#: a new code would need a DDL against the shared production database to buy
#: what this one already has.
SKILL_AUTHOR_ROLES: tuple[str, ...] = ("sahayak_admin",)

#: What an author may reach: Sahayak, and only Sahayak.
#:
#: Deliberately NOT `STAFF_MODULES`. An author writes the templates; they have no
#: business in a customer's CRM, sales pipeline or analytics. The templates they
#: write are then run BY somebody else, whose own grants decide what data those
#: templates may read — see `services/skills/modules.py`.
SKILL_AUTHOR_MODULES: frozenset[str] = frozenset({"sahayak"})

#: Every Tier-1 code. Used for "is this user platform staff at all".
ALL_PLATFORM_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + SUPPORT_ROLES
    + COMMERCIAL_ONLY_ROLES + SKILL_AUTHOR_ROLES
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

# ── Tier 2, part two: the org roles that are not plain membership ────────────
#
# `ORG_ROLES` above is deliberately UNCHANGED and must stay that way. Six other
# modules build on it — `org_invites.SEAT_ROLES`, `seat_model.ORG_SEAT_ROLES`,
# `roles.may_act_in_org`'s belongs-check, `subscription`'s membership probe and
# `org_resolver` twice — and every one of them means something slightly
# different by "an org role". Widening that one tuple to carry three new codes
# would have given a customer's CLIENT a paid seat and a support-session
# exemption in the same edit, silently, because those consumers do not agree on
# what they are asking. So the new codes arrive in NEW sets, each named after
# the question it answers, and each consumer picks the one it means.

#: The ORGANISATION's HR administrator. Owner's decision, Wave 3: they manage
#: Manav and Pahchan for their OWN organisation and nothing else.
#:
#: This is the gap the four-tier model had. Until now the only way to let
#: somebody run HR was `org_admin`, which — through `require_module`'s org-role
#: short-circuit — reaches EVERY active module including Ganit and Vetana. So
#: appointing an HR administrator meant handing them the books and the payroll
#: run, and the alternative was per-module grant rows that nothing named.
HR_ADMIN_ROLES: tuple[str, ...] = ("hr_admin",)

#: Manav (personnel files) and Pahchan (attendance). NOT Vetana.
#:
#: Vetana is what people are PAID. `SEPARATED_DUTY_MODULES` already states that
#: defining salary structures and releasing money against them are two
#: authorities and that neither implies the other; an HR administrator who
#: reached payroll by role alone would hold the first half unconditionally and
#: be one grant row from the second. If a firm wants their HR administrator on
#: payroll too, that is an explicit, auditable Vetana grant on top — which is
#: exactly the shape the owner asked for.
#:
#: ── THIS IS NOT `HR_MODULES`, AND THE TWO MUST NOT BE MERGED ────────────────
#:
#: `HR_MODULES` (manav, vetana) is what a PLATFORM role is REFUSED — Aekam's own
#: staff, crossing into a customer's organisation. This set is what an ORG's own
#: HR administrator may reach INSIDE THEIR OWN ORG. They overlap on `manav` and
#: differ on both of the others, and each difference is a decision:
#:
#:   pahchan  is here and not there. Attendance is biometric data under the DPDP
#:            notice and only GOD MODE crosses into it from the platform side —
#:            measured, and deliberate. The customer's own HR administrator is
#:            not crossing into anything; it is their own roster.
#:   vetana   is there and not here, for the separated-duty reason above.
#:
#: The tidy-looking merge — "make HR_MODULES the HR set" — would hand attendance
#: to `platform_manager` in every organisation in the database.
HR_ADMIN_MODULES: frozenset[str] = frozenset({"manav", "pahchan"})

#: The two roles that see a PROJECT and nothing else. Owner's decision, settled
#: 2026-08-06.
#:
#:   org_client   the customer's own client, on the customer's project.
#:   aekam_team   Aekam's people working on a customer's project.
#:
#: Different people, identical permission set, and they are two codes rather
#: than one because an audit that cannot tell "our client saw this" from "the
#: vendor saw this" is not an audit.
PROJECT_ONLY_ROLES: tuple[str, ...] = ("org_client", "aekam_team")

#: What project-only means, written down. Exactly today's production
#: client-portal permission set.
#:
#: These are SURFACE names and not module codes on purpose: none of the four is
#: module-gated. Core PM is reached by org membership (`kartavya` is absent from
#: `ALL_MODULES` — see `LADDER_MODULES`), and notifications hang off it. So this
#: tuple documents the intent and `PROJECT_ONLY_MODULES` enforces it.
PROJECT_ONLY_SURFACES: frozenset[str] = frozenset({
    "projects", "tasks", "task_approvals", "notifications",
})

#: EMPTY, and that empty set is the whole enforcement.
#:
#: Every module router in the product hangs on `require_module(...)`. A role
#: whose ceiling is empty is refused all twelve by one rule, so the surface a
#: project-only role reaches is precisely the surface that is NOT module-gated —
#: core PM and notifications. There is no per-module list to keep in step and no
#: module added next month that quietly lands inside it.
#:
#: ── DO NOT WIDEN THIS TO SOLVE A TICKET ─────────────────────────────────────
#:
#: When an Aekam colleague needs Graha in a customer's org for an afternoon, the
#: answer is a SUPPORT SESSION — `platform_support_sessions`, shipped in
#: 959eb031 — which the customer approves, which is time-boxed, which names the
#: modules it covers and which writes an audit row per crossing. Adding a module
#: here instead grants it to every holder of the role, in every organisation,
#: permanently, with nobody's approval and no expiry. That is not a shortcut to
#: the same place; it is a different thing wearing its name.
PROJECT_ONLY_MODULES: frozenset[str] = frozenset()

#: Every Tier-2 code that exists.
ALL_ORG_ROLES: tuple[str, ...] = ORG_ROLES + HR_ADMIN_ROLES + PROJECT_ONLY_ROLES

#: "Holds a row in THIS organisation at all" — the tenant path, and the question
#: `org_resolver.get_org_id` is actually asking on both of its branches.
#:
#: A project-only role has to be in here or it cannot resolve its own
#: organisation, and a role that cannot resolve an org 403s on every request in
#: the product. That is the difference between a role and a row.
ORG_TENANT_ROLES: tuple[str, ...] = ALL_ORG_ROLES

#: "Costs the organisation a seat". `org_invites.SEAT_ROLES` and
#: `seat_model.ORG_SEAT_ROLES` are built from this.
#:
#: `hr_admin` is in it: they sign in and use the product, and a role that
#: reaches two modules for free is a way to buy Manav without paying for it.
#: The two project-only roles are deliberately OUT — the owner's decision is
#: that a client seeing their own project, and an Aekam colleague working on it,
#: cost the customer nothing. That is a commercial decision with a security
#: consequence, which is why it is stated beside the ceiling that pays for it:
#: the roles are free BECAUSE they reach nothing but the project.
SEAT_CONSUMING_ORG_ROLES: tuple[str, ...] = ORG_ROLES + HR_ADMIN_ROLES

#: Who a scheduled report may be MAILED to — "the firm", not the tenant path.
#: The distinction matters because `ORG_TENANT_ROLES` answers a different
#: question ("holds any row in this org", which project-only roles must, or
#: they cannot resolve their own org) and using it as a mailing cut let a
#: portal client — the CUSTOMER'S person, refused every module by design —
#: receive the full Finance letterhead because somebody typed their address
#: into a schedule. Same composition as the seat set today, aliased so the
#: next reader knows the reports contract is "firm staff", not "consumes a
#: seat", and the two may diverge without either meaning changing.
REPORT_RECIPIENT_ROLES: tuple[str, ...] = ORG_ROLES + HR_ADMIN_ROLES

#: Ranked most-privileged first, the Tier-2 twin of `PLATFORM_ROLE_PRECEDENCE`.
#: Used by `strongest_org_role` and by the `array_position` ordering in the
#: gates — where somebody holds two rows the answer must not depend on which was
#: written first.
ORG_ROLE_PRECEDENCE: tuple[str, ...] = (
    "org_owner", "org_admin", "hr_admin", "org_member", "aekam_team", "org_client",
)

#: The MOST a holder of this role may reach, by role alone.
#:
#: A role ABSENT from this dict has no ceiling — org_owner, org_admin and
#: org_member are bounded by the grant table and the subscription, not by a list
#: here. Presence is what makes a role capped.
ORG_ROLE_MODULE_CEILING: dict[str, frozenset[str]] = {
    "hr_admin": HR_ADMIN_MODULES,
    "org_client": PROJECT_ONLY_MODULES,
    "aekam_team": PROJECT_ONLY_MODULES,
}


def role_consumes_seat(role_code: str | None) -> bool:
    """Does granting this role cost the organisation a seat?

    THE SEAT CONSEQUENCE, in one place, because the console has to show it at
    the point of granting and the counter has to apply it at the point of
    counting — and those two disagreeing is how a customer is billed for a role
    the screen told them was free.

    Answers False for a platform role: Aekam's own staff are not seats in a
    customer's allowance. Answers False for a code nobody has heard of, which is
    the safe direction for a BILLING question — an unknown role that silently
    started charging would reach an invoice before it reached a test.
    """
    return role_code in SEAT_CONSUMING_ORG_ROLES


def strongest_org_role(roles) -> str | None:
    """The most privileged Tier-2 role from a set, or None."""
    if not roles:
        return None
    for candidate in ORG_ROLE_PRECEDENCE:
        if candidate in roles:
            return candidate
    return None


def module_ceiling_for(org_roles) -> frozenset[str] | None:
    """The modules these org roles may reach BY ROLE, or None for "no ceiling".

    `None` and `frozenset()` are different answers and the distinction is the
    whole design:

        None          nothing here caps this caller. Either they hold an
                      uncapped role (owner, admin, member) or they hold no org
                      row at all — a platform caller acting inside a customer's
                      organisation, whose reach is `modules_for` and whose gate
                      is `platform_refusal`. Returning frozenset() for the
                      no-rows case would refuse every one of them.
        frozenset()   capped to nothing. A project-only role, refused all twelve
                      modules by one rule.

    ── ONE UNCAPPED ROLE LIFTS THE CEILING ─────────────────────────────────────

    Somebody may hold two rows. A person who is the HR administrator AND an
    ordinary member is not confined to HR: their member grants are real, they
    were granted deliberately, and voiding them because a second row exists
    would make appointing an HR administrator a way to silently revoke
    somebody's CRM access. So a single uncapped role answers None.

    Capped roles UNION rather than intersect, for the same reason: two grants
    give more, never less.

    ── AN UNKNOWN CODE IS NOT AN UNCAPPED ROLE ─────────────────────────────────

    A code this file has never been taught about contributes an EMPTY ceiling
    rather than lifting one. Fails closed: otherwise "invent a role code" is a
    way past the cap, and the CHECK constraint is the only thing standing
    between an attacker with a write and an uncapped role.
    """
    if not org_roles:
        return None
    ceilings: list[frozenset[str]] = []
    for role in org_roles:
        if role in ORG_ROLE_MODULE_CEILING:
            ceilings.append(ORG_ROLE_MODULE_CEILING[role])
        elif role in ALL_ORG_ROLES:
            return None  # a known, uncapped role — owner, admin or member
        else:
            ceilings.append(frozenset())  # unknown: contributes nothing
    return frozenset().union(*ceilings) if ceilings else None


def refuse_module_for_org_roles(org_roles, module_code: str) -> str | None:
    """Why this caller may not reach this module by org role, or None.

    Returns the SENTENCE rather than a boolean because the two capped roles need
    different words: an HR administrator has hit a boundary they can be told
    about, while a project-only holder is being told that the whole product
    outside their project is not theirs — and pointing the second at "ask your
    org admin for a grant" would send them to ask for something no admin should
    give them.
    """
    ceiling = module_ceiling_for(org_roles)
    if ceiling is None or module_code in ceiling:
        return None

    if any(r in PROJECT_ONLY_ROLES for r in org_roles):
        return (
            "Your access to this organisation covers its projects, tasks, task "
            "approvals and notifications. It does not cover "
            f"{module_code}, and no grant widens it — ask the organisation to "
            "raise a support session if you need more."
        )
    return (
        f"An HR administrator manages {', '.join(sorted(HR_ADMIN_MODULES))} for "
        f"this organisation, not {module_code}."
    )

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
    "graha", "vikray", "prachar", "sahayak", "dristi", "sanvaad",
    "ganit", "esign", "varta", "pahchan", "manav", "vetana", "kray",
})

#: ── THE RENAME, AND WHY THERE IS NO ALIAS HERE ANY MORE ─────────────────────
#:
#: The module was `srijan` (सृजन, "creation") and is now `sahayak` (सहायक, "the
#: assistant") — सृजन fitted when it only generated content and stopped fitting
#: when it grew a chatbot, a knowledge base, skills and scrapers. It also
#: collided: the chatbot is a conversation, and conversation is already
#: Sanvaad's word.
#:
#: Renaming a module code was not a rename, it was THREE deploys, in an order
#: that was not negotiable because staging and production share one database:
#:
#:   1. Teach every gate to accept BOTH codes, via a `MODULE_ALIASES` map that
#:      lived here. Deployed alone, in e5b566d9.
#:   2. Rename the code sites — routers, then the frontend.
#:   3. Migrate the rows: `module_subscriptions` (3), `org_member_modules` (3),
#:      `plans.features` (4 + 3 keys), `add_on_modules` (1). That is
#:      `migrations/108_srijan_to_sahayak.sql`, applied 2026-08-06. THEN, and
#:      only then, delete the alias — which is why it is not above.
#:
#: The window closed the wrong way round in practice and it is worth recording
#: how: the alias folded INBOUND only, code → the new name. That covers a
#: half-renamed backend, which is what it was written for. It does NOT cover a
#: database still holding the old value, so between pass 2 shipping and 108
#: being applied, `sahayak` was in BUNDLED_MODULES and every gate asked the
#: database for a code no row held — a 403 on both the plan check and the grant
#: check. If you rename the next module, alias in BOTH directions or migrate the
#: rows in the same deploy.
#:
#: Two things kept the old spelling on purpose. `hub` is not part of this at all
#: — the owner was explicit that it is the internal name of the agency service,
#: appears in 44 route paths, and renaming it would be a second migration for a
#: word no customer reads. And the R2 prefix `srijan/images` stays: 40 stored
#: objects live under it, and renaming a pointer does not move bytes.

#: platform_staff's operating set. Excludes finance (ganit), signed agreements
#: (esign), outbound WhatsApp (varta), attendance (pahchan) and all HR.
STAFF_MODULES: frozenset[str] = frozenset({
    "graha", "vikray", "prachar", "sahayak", "dristi", "sanvaad",
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
    if platform_role in SKILL_AUTHOR_ROLES:
        return SKILL_AUTHOR_MODULES
    # Commercial and support roles reach no operational module. account_finance
    # sees billing, which is elsewhere. platform_support is gated on an approval
    # flow that does not exist yet, so it grants nothing rather than everything.
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
#     `platform_admin` row. It becomes a total lockout of every god-mode account
#     on the day those rows are renamed — which is exactly the migration this
#     model was designed for.
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

#: Day-to-day operating work: authoring and publishing Sahayak skills, running
#: scrapers, configuring reminder automations.
#:
#: This is the set that makes `platform_staff` mean anything. Before it, every
#: Sahayak hub route required platform_admin/account_manager/sahayak_admin, so all
#: four platform_staff holders were locked out of the exact work the role was
#: created for — "Sahayak, including authoring skills and publishing" — and both
#: platform_manager holders with them.
OPERATIONS_CONSOLE_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + STAFF_ROLES + ("account_manager", "sahayak_admin")
)

#: Sahayak work that MOVES OR REPORTS MONEY: client records, credit top-ups, spend
#: analytics.
#:
#: Deliberately NOT OPERATIONS_CONSOLE_ROLES. Authoring a skill and topping up a
#: client's credit balance are both "Sahayak", but only one of them spends. The
#: operating set exists to let staff do the work, not to let them bill for it —
#: the same separation Vetana and Ganit make between admin and approver.
#: `sahayak_admin` is deliberately NOT here any more. Authoring a skill and
#: topping up a client's credit balance are both "Sahayak", and only one of them
#: spends — the same separation this tuple's own comment already draws. An
#: author who could also move credits would be able to fund the runs of the
#: templates they wrote.
SAHAYAK_COMMERCIAL_ROLES: tuple[str, ...] = (
    GOD_MODE_ROLES + MANAGER_ROLES + ("account_manager", "account_finance")
)

#: Modules whose grants are withheld by default when a member is added without an
#: explicit list. Broader than HR_MODULES: it adds `ganit`, the org's finances.
#: Payroll, personnel files and the books are not handed out by omission.
SENSITIVE_MODULES: frozenset[str] = HR_MODULES | {"ganit", "kray"}


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
    "account_finance", "sahayak_admin", "account_manager",
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

#: Every module code the Tier-4 ladder has an opinion about.
#:
#: NOT `ALL_MODULES`, and the difference is one code: `kartavya`. Core PM is
#: levelled (no viewer — everyone in the org edits tasks) but it is NOT
#: grantable: it is absent from `ALL_MODULES`, so `_validate_grant("kartavya",
#: …)` answers 400 and `held_module_levels` returns the empty set. Four files
#: already state that this is deliberate — `frontend/src/pages/org/catalogue.js`,
#: `server.py`, `services/task_transitions.py`, `services/skills/modules.py` —
#: and core PM is reached by org MEMBERSHIP rather than by a grant row.
#:
#: It is declared here because until it was, `kartavya` appeared in three ladder
#: sets and in no set that said what the ladder's domain WAS, so "the ladder sets
#: disagree with ALL_MODULES" looked like drift instead of a decision. The
#: alternative — adding `kartavya` to `ALL_MODULES` — would turn a 400 into a
#: writable grant row for a module nothing gates on, which is a behaviour change
#: nobody asked for. Naming the domain costs nothing and lets
#: `test_sensitive_module_grants.py` assert the sets agree.
LADDER_MODULES: frozenset[str] = ALL_MODULES | {"kartavya"}

#: Modules where the ladder is a plain hierarchy: admin can do everything an
#: approver can, and more.
#: "Admin can do all" — the owner's words, and true everywhere it does not
#: move money.
#:
#: `manav`, `pahchan` and `varta` were in NEITHER this set nor
#: `SEPARATED_DUTY_MODULES`, so three of the thirteen ladder modules were
#: described by no ladder set at all. That was documentation lagging behaviour
#: rather than a live defect — `level_satisfies` treats anything outside
#: `SEPARATED_DUTY_MODULES` hierarchically, so all three already behaved this
#: way — but a set that is silent about a module cannot be checked, and a
#: money-moving module added to `ALL_MODULES` and to neither set would inherit
#: "admin approves" without anyone stating it. The two sets now PARTITION
#: `LADDER_MODULES`, and the test asserts the partition rather than the
#: membership, so the next module has to be classified to land.
HIERARCHICAL_MODULES: frozenset[str] = frozenset({
    "kartavya", "graha", "vikray", "prachar", "dristi", "sahayak", "sanvaad",
    "esign", "manav", "pahchan", "varta", "kray",
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
    "kartavya", "dristi", "sahayak", "sanvaad", "esign",
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


#: Modules whose NEW grants start higher than `DEFAULT_GRANT_LEVEL`.
#:
#: Sanvaad is `editor` on the owner's decision. The reasoning is specific to it
#: and does not generalise: Sanvaad is a MESSAGING module, and a `viewer` there
#: cannot post. Adding a colleague to the team chat and having them silently
#: unable to speak is not a narrow permission, it is a broken invitation — the
#: module's whole purpose is the thing a viewer is denied. Everywhere else,
#: viewer is a useful state: reading invoices, payslips or the CRM without
#: writing is a real job.
#:
#: This is deliberately a per-module table and NOT a change to
#: `DEFAULT_GRANT_LEVEL`. Raising the global default would make every new grant
#: in every module a writer, which is the opposite of why RBAC exists here and
#: would deepen the open finding that `require_module` gates reach rather than
#: depth. One module moved on its merits; the ladder is untouched.
#:
#: Only consulted when a grant is CREATED with no level. It is not a fallback
#: for a malformed row — `module_levels.held_level` still reads an unknown value
#: as `DEFAULT_GRANT_LEVEL`, because failing upward there would hand control to
#: every legacy row.
NEW_GRANT_LEVEL_BY_MODULE: dict[str, str] = {
    "sanvaad": EDITOR,
}


def default_level_for(module_code: str) -> str:
    """The level a NEW grant on this module starts at when none is given.

    Falls back to `DEFAULT_GRANT_LEVEL`, and refuses to return a level the
    module has no use for — a per-module default that is not in
    `valid_levels_for` would create grants that silently do nothing.
    """
    level = NEW_GRANT_LEVEL_BY_MODULE.get(module_code, DEFAULT_GRANT_LEVEL)
    return level if level in valid_levels_for(module_code) else DEFAULT_GRANT_LEVEL


# ═══════════════════════════════════════════════════════════════════════════
# THE ONE GRANT REFUSAL
#
# Four endpoints can write a row into `staging.org_member_modules`:
#
#   routers/org_members.py   POST   /api/v1/org/members                (add)
#   routers/org_members.py   PUT    /api/v1/org/members/{id}/modules   (replace)
#   routers/org_invites.py   POST   /api/v1/org/invites                (via accept)
#   auth_router.py           POST   /auth/accept-invite                (writes them)
#
# Until this function existed, the separated-duty rule — "only an owner may
# grant approver on vetana/ganit" — lived in ONE of them, written inline in
# `org_invites._validate_grants`. The other three did not have it. The two
# org_members endpoints validate the module code and the level and nothing else,
# so an org_admin could `PUT /api/v1/org/members/{their own user_id}/modules`
# with `{"code": "vetana", "role": "approver"}` and hold admin (by org role) plus
# approver (by the new row) on payroll — defining what people are paid AND
# releasing the money, which is the single pair the separation exists to keep
# apart. Measured: 16 of 16 sensitive module/level combinations were accepted.
#
# A rule enforced on one writer of four is not enforced. It reads as enforced,
# which is worse, because the file that carries it documents the rule at length
# and the three that do not carry it look like they inherit it.
#
# So the rule moved here — pure, no database, no FastAPI — and the writers call
# it. `test_sensitive_module_grants.py` WALKS THE ROUTERS for statements against
# the grant table and asserts each writer's module reaches this function, so a
# fifth writer added next month fails a test instead of quietly reopening this.
#
# ── WHAT THIS DELIBERATELY DOES NOT REFUSE ─────────────────────────────────
#
# 1. It does not reject grants naming a sensitive module. `RBAC-SPEC.md:65-71`
#    says "a grant row naming a sensitive module is invalid input and must be
#    rejected"; that sentence is dated 25 Jul and is superseded by the 26 Jul
#    separated-duty decision recorded above. Measured against the live database
#    2026-08-06: `staging.org_member_modules` holds five `vetana`/`approver` rows
#    across three orgs, and they are the ONLY representation of "may release
#    payroll" — `routers/vetana.py` has no org_module_approvers fallback.
#    Implementing the spec's literal remedy deletes the ability to appoint a
#    payroll approver and payroll fails closed with a 403.
#
# 2. It does not refuse a caller granting APPROVER to THEMSELVES. That looks
#    like the obvious second rule and it contradicts the owner's recorded
#    decision three screens up: "One person MAY hold both — that is allowed and
#    sometimes necessary in a small firm… one user can have both FYI but
#    auditable." Since org_owner/org_admin already resolve to ADMIN by role,
#    "both" IS the self-grant case, and refusing it would leave a single-owner
#    firm with no way to appoint any payroll approver at all — there is nobody
#    else to appoint and nobody above the owner to ask. The owner-only rule below
#    already stops the escalation that matters, because the caller it refuses
#    (org_admin) cannot grant approver to themselves OR to anyone else. What was
#    missing from the permitted case was the word "auditable": the org endpoints
#    wrote no audit row on any path. They do now, at severity `warn`, carrying
#    `self_grant`.
# ═══════════════════════════════════════════════════════════════════════════

from typing import NamedTuple


class GrantRefusal(NamedTuple):
    """Why a grant was refused, and with which status.

    A refusal carries its own status code because the two halves are genuinely
    different answers: an unknown module or an impossible level is malformed
    INPUT (400), while "you personally may not hand out this authority" is a
    denial of AUTHORITY (403). Returning a bare string and letting each call
    site pick a status is how `org_invites` came to answer 403 and 400 for
    neighbouring conditions in one loop.
    """

    status: int
    detail: str


def refuse_grant_shape(module_code: str, level: str) -> GrantRefusal | None:
    """Is this a grant that could mean anything at all? None if it is fine.

    The half of the policy that needs no caller: a real module, at a level that
    module has a use for. Separate from `refuse_grant` because `accept-invite`
    can apply THIS and must not apply the authority half — see below.
    """
    if module_code not in ALL_MODULES:
        return GrantRefusal(400, f"Unknown module: {module_code}")

    allowed = valid_levels_for(module_code)
    if level not in allowed:
        return GrantRefusal(
            400,
            f"'{level}' is not a level {module_code} has. "
            f"Valid: {', '.join(allowed)}.",
        )
    return None


def grant_needs_owner_authority(
    module_code: str,
    level: str,
    *,
    caller_org_role: str | None,
) -> bool:
    """Is this a grant only an organisation OWNER may decide?

    The separated-duty rule, stated once. `refuse_grant` asks this to decide
    whether to refuse; `org_members` and `org_invites` ask it to decide whether
    the org needs an owner looked up at all, and to flag the audit row when the
    grant went through on the no-owner fallback. Three call sites, one condition
    — the alternative is the same boolean retyped three times, which is exactly
    how `org_invites` and its three sibling writers drifted apart.

    `caller_org_role is None` is the god-mode/platform caller `refuse_grant`'s
    docstring describes, and answers False here for the same reason it is not
    refused there.
    """
    return (
        level == APPROVER
        and module_code in SEPARATED_DUTY_MODULES
        and caller_org_role is not None
        and caller_org_role != "org_owner"
    )


def refuse_grant(
    module_code: str,
    level: str,
    *,
    caller_org_role: str | None,
    org_has_owner: bool = True,
) -> GrantRefusal | None:
    """The whole policy for one grant, for a caller who is handing it out.

    `caller_org_role` is the granter's Tier-2 role IN THE ORG BEING WRITTEN TO,
    or None for a caller who holds no row there — a god-mode/platform caller
    whom `require_org_role` has already vouched for. None therefore SKIPS the
    authority rule, which is the behaviour `org_invites._assert_may_grant_role`
    has always had, kept identical here so moving the rule changes no verdict.

    NOT used by `auth_router.accept-invite`, on purpose. There the caller is the
    INVITEE, not the granter — the granting authority was the inviter's, and was
    checked when the invite was created. Passing the invitee's org role (they
    have none yet) would skip the rule; passing "org_owner" would be a lie. That
    path calls `refuse_grant_shape` instead, which is a check it did not have at
    all: it read `role` straight out of the invite JSON with a `or "viewer"`
    fallback and wrote it unvalidated, so any future writer of
    `invites.module_grants` inherited a raw path into the grant table.

    `org_has_owner` — DOES THE ORGANISATION HAVE AN OWNER AT ALL. Defaults to
    True, which is the strict answer: a call site that has not looked gets the
    refusal, so forgetting to pass it is a refusal and never a bypass.

    Measured on the live database 2026-08-06, `staging.user_roles` grouped by
    org: Unicode Group (fae87907) holds FOUR `org_admin` rows, one `org_member`
    and ZERO `org_owner`. With the rule stated as "owner or nobody" that org has
    no caller who can appoint a payroll approver — and no way to acquire one,
    because nothing in this backend writes an `org_owner` row into an existing
    org: `org_members.update_member_role` accepts only org_admin/org_member,
    `admin_orgs.assign_role` narrows to `INVITABLE_ORG_ROLE = "org_admin"`, and
    `org_invites._assert_may_grant_role` lets only an owner invite an owner. A
    refusal whose remedy does not exist is an outage, not a guard.

    The fallback is safe SPECIFICALLY because the no-owner state cannot be
    manufactured to reach it: `org_members.remove_member` answers 403 to
    removing an owner, and `update_member_role`'s UPDATE is scoped to
    `role_code IN ('org_admin','org_member')` so an owner cannot be demoted
    either. An org without an owner arrived there outside the product, and an
    admin cannot put their own org into that state to escape this rule.

    It is not silent. `org_members._audit_grants` marks the row
    `no_owner_fallback: true`, and `grant_audit_severity` already answers `warn`
    for every separated-duty approver grant.
    """
    shape = refuse_grant_shape(module_code, level)
    if shape is not None:
        return shape

    # An org_admin granting approver on vetana/ganit would be creating the
    # counterparty to their own authority — they already hold ADMIN on every
    # active module by role alone (`subscription.py`'s org-role short-circuit),
    # so this one grant is the whole of the separation. Only an owner does it —
    # unless there is no owner to do it, see above.
    if grant_needs_owner_authority(
        module_code, level, caller_org_role=caller_org_role
    ) and org_has_owner:
        return GrantRefusal(
            403,
            f"Only an organisation owner can grant approver on {module_code}. "
            "Administering a module and releasing money against it are "
            "deliberately separate.",
        )

    return None


def grant_audit_severity(module_code: str, level: str) -> str:
    """`warn` for a grant worth reading in an audit review, else `info`.

    Reads `subscription.SENSITIVE_MODULES` — the FOUR-code set including
    `pahchan` — and not the three-code set in this file. The two differ on
    purpose and both are correct for their own job: this file's set is "withheld
    from the auto-grant path", subscription's is "a platform role may not cross
    into this at all". For deciding whether a human should re-read a grant
    change, biometric attendance belongs in scope, so the wider set wins. Any
    new rule written against "the sensitive set" must say which one it means —
    this one says.
    """
    from middleware.subscription import SENSITIVE_MODULES as WIDE_SENSITIVE

    if module_code in WIDE_SENSITIVE or level in (APPROVER, ADMIN):
        return "warn"
    return "info"


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
    # for the HR modules that means god mode only.
    #
    # THIS COMMENT USED TO CLAIM the crossing "has already written an audit row
    # by the time this runs". CORRECTED 2026-08-06: that is true only when
    # `module_code` is the module the ROUTE is gated on. It is not true for the
    # skill and Sahayak paths, where the route's gate is instantiated once as
    # `require_module("sahayak")` and this function is then asked about `ganit`
    # — `require_module("ganit")` never executes anywhere in that request, so
    # `platform_audit_row` was never asked about it and no row named it. That
    # gap is now closed on the caller's side, in
    # `services/skills/modules._audit_module_crossings`, which emits one row per
    # SENSITIVE module a platform caller is about to read. Nothing is written
    # here: this function is a pure resolution and several callers ask it the
    # same question more than once per request.
    platform_role = await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[]) "
        "ORDER BY array_position($2::text[], role_code) LIMIT 1",
        user_id, list(PLATFORM_ROLE_PRECEDENCE),
    )
    if platform_role and can_reach_module(platform_role, module_code):
        levels.add(ADMIN)

    # EVERY Tier-2 row, not the two management codes. Three reasons, and the
    # first two are new roles rather than tidying:
    #
    #   · `hr_admin` resolves ADMIN, but only on `HR_ADMIN_MODULES`.
    #   · a CAPPED caller contributes nothing outside their ceiling, and that
    #     has to include their grant rows — otherwise "give the client Graha for
    #     a minute" is one row away and the ceiling is advisory.
    #   · the org half of this function is now one query for every shape of
    #     caller instead of one query plus an assumption about the other codes.
    org_role_rows = await pool.fetch(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
        user_id, org_id, list(ALL_ORG_ROLES),
    )
    org_roles = [r["role_code"] for r in org_role_rows]

    ceiling = module_ceiling_for(org_roles)
    capped = ceiling is not None and module_code not in ceiling

    # The cap is applied to the ORG contribution alone and never to the platform
    # one above. An Aekam account that holds god mode AND an `aekam_team` row in
    # a customer's org is still god mode — the project-only row is what they
    # hold as a colleague on the project, not a demotion of the platform role,
    # and stripping the platform reach here would be a lockout nobody asked for.
    if not capped:
        if any(r in ORG_MANAGEMENT_ROLES for r in org_roles):
            levels.add(ADMIN)
        elif any(r in HR_ADMIN_ROLES for r in org_roles) and module_code in HR_ADMIN_MODULES:
            # An HR administrator ADMINISTERS their two modules — that is the
            # role — so they hold admin there without a grant row, exactly as
            # org_admin does everywhere. `SEPARATED_DUTY_MODULES` is untouched:
            # neither of the two is in it, so this cannot become an approver.
            levels.add(ADMIN)

    # `org_member_modules.role` EXISTS in the live database, `DEFAULT 'viewer'`,
    # with both of PROPOSED_066 §1's CHECK constraints. PROPOSED_066 is applied
    # despite still being labelled "PROPOSED — Review before running"; the
    # migrations audit read it out of the live catalog, and the file headers in
    # backend/migrations cannot be trusted for this question.
    #
    # I briefly wrapped this in `except asyncpg.UndefinedColumnError` on the
    # assumption the column was missing. It is not, and the fallback is worse
    # than nothing on a payroll module: it would turn a dropped column into a
    # silent `viewer` grant instead of a loud failure. Removed deliberately.
    #
    # SKIPPED ENTIRELY FOR A CAPPED CALLER. A grant row does not rescue a role
    # whose ceiling excludes the module — see `module_ceiling_for`. Skipping the
    # query rather than filtering the result is deliberate: it is the same
    # verdict and it says out loud that the row is not consulted, so nobody
    # later "optimises" the filter away and reopens it.
    if not capped:
        rows = await pool.fetch(
            "SELECT role FROM staging.org_member_modules "
            "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
            user_id, org_id, module_code,
        )
        for row in rows:
            granted = row["role"]
            if granted in LEVELS:
                levels.add(granted)

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
