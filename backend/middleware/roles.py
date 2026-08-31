"""
roles.py — Multi-role gating middleware.

Supports platform-wide roles (org_id=NULL) and org-scoped roles.
A user can have multiple roles.

Platform roles used to apply EVERYWHERE, and that sentence is what this file was
for a year: a row with `org_id IS NULL` satisfied every org-scoped gate in every
organisation without anyone asking which organisation was being acted on. They
now apply within an organisation the holder is part of — see `may_act_in_org`,
which is the single place that decision is made and the only place it should be
changed.

Usage:
  Depends(require_role("admin"))              — legacy, checks users.role
  Depends(require_platform_role("platform_admin", "account_manager"))
  Depends(require_org_role("org_admin", "sahayak_admin"))
"""
import logging

from fastapi import Depends, HTTPException

log = logging.getLogger(__name__)

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES,
    HR_ADMIN_ROLES,
    GOD_MODE_ROLES,
    MANAGER_ROLES,
    ORG_MANAGEMENT_ROLES,
    ORG_ROLES,
    SUPPORT_ROLES,
)

#: Platform roles that count as "org admin" for the visibility helpers below.
#: Everything except support, which holds nothing until an org approves it —
#: see `org_resolver.ORG_SWITCH_ROLES` for the full reasoning.
PLATFORM_ORG_ADMIN_ROLES: tuple[str, ...] = tuple(
    r for r in ALL_PLATFORM_ROLES if r not in SUPPORT_ROLES
)


def may_act_in_org(
    *,
    holds_org_role: bool,
    holds_platform_role: bool,
    belongs_to_org: bool,
) -> bool:
    """THE DECISION. Pure, so it can be tested without a database.

    Three inputs, and the middle one is the whole finding:

      holds_org_role       the caller holds one of the roles this gate asks for,
                           IN THE ORGANISATION BEING ACTED ON.
      holds_platform_role  the caller holds a platform row (org_id IS NULL).
                           Which platform roles count is the CALLER's question —
                           `require_org_role` asks about god mode,
                           `is_org_admin` asks about PLATFORM_ORG_ADMIN_ROLES.
      belongs_to_org       the caller holds ANY Tier-2 row in that same org.

    A platform role is not a membership. It used to be treated as one: both
    callers below answered "yes" on the platform row alone, without ever looking
    at the org they were being asked about, so one row in `staging.user_roles`
    with `org_id IS NULL` was a key to every organisation in the database.

    The owner's specification, in his words: "no one should be able to see any
    other org data even god mode users. God mode can only switch between orgs if
    they are part of it." `belongs_to_org` is "part of it" — the whole of what
    was missing.

    Deliberately NOT `holds_org_role` on the platform branch. Requiring god mode
    to ALSO hold org_owner/org_admin would be tighter and would break the
    product: measured on the live database today, Unicode Group has no
    `org_owner` at all and the one account that belongs to all three
    organisations holds `org_admin` in each, so the owner-only surfaces
    (`ORG_OWNER_ONLY` — switching a module on, org security) would have become
    unreachable in the customer org and unreachable for him everywhere. That is
    the outage this narrowing has to avoid while still closing the leak: the
    leak lives in organisations the caller has NO row in, and this refuses
    exactly those.

    Never widens. For every input, this is False wherever the old rule was
    False: the old rule was `holds_platform_role or holds_org_role`, and every
    term here is a conjunction of that. `test_roles_org_scope.py` proves it over
    the whole truth table rather than asserting it here in prose.
    """
    if holds_org_role:
        return True
    return holds_platform_role and belongs_to_org


def require_role(*allowed_roles: str):
    """Legacy: checks users.role field. Keep for backward compat."""

    async def _check(user=Depends(require_user)):
        if user.get("role") not in allowed_roles:
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _check


def require_platform_role(*allowed_roles: str):
    r"""Check `public.user_roles` for platform-wide roles (`org_id IS NULL`).

    ── THE REFUSAL IS READ BY CUSTOMERS, SO IT IS WRITTEN FOR THEM ─────────────

    This used to raise, verbatim:

        This action requires one of: platform_owner, platform_admin,
        platform_manager, account_manager, account_finance

    and the frontend prints the server's `detail` straight into a toast, so that
    sentence was shown to a paying customer — Aekam's internal role codes, in a
    list, with nothing they can do about any of them.

    Three suites caught it independently (14.12, 14.16, 14.18), each asserting
    `not /requires one of:\s*platform_/i` on the toast, which is how a message
    written for a stack trace ends up measured as a product defect.

    ⚠ THE GATE IS UNCHANGED. Only the sentence moved. These endpoints are Aekam's
    own account-management surface and a tenant must keep getting 403 — a
    separation of duties `role_tiers.py:500` describes as letting staff "do the
    work, not bill for it". What was wrong was telling the customer to go and
    acquire `platform_owner`.

    The role list is not lost: it goes to the LOG, where the person who needs it
    is the one debugging, not the one clicking.
    """

    async def _check(user=Depends(require_user)):
        pool = await get_pool()
        role = await pool.fetchval(
            "SELECT role_code FROM public.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
            user["user_id"], list(allowed_roles),
        )
        if not role:
            log.info(
                "platform-role refusal: user=%s needed one of %s",
                user.get("user_id"), ", ".join(allowed_roles),
            )
            raise HTTPException(
                403,
                "This is an Aekam account-management action, so it cannot be done "
                "from an organisation login. Ask your Aekam contact to make the "
                "change.",
            )
        return user

    return _check


def require_org_role(*allowed_roles: str):
    """Check staging.user_roles for org-scoped roles.

    ── GOD MODE NO LONGER PASSES UNCONDITIONALLY ────────────────────────────────

    It used to. The platform probe below returned the user before the org-scoped
    lookup had run, so a god-mode row — one row, `org_id IS NULL` — passed EVERY
    org-role gate in EVERY organisation, with no membership check of any kind.
    What that gate guards is not a report: org member removal, org role changes,
    module grants, the org profile, the Manav PII reveal and Pahchan review.

    It now requires that the caller be part of the organisation being acted on.
    Measured against the live database before this change, for the four
    god-mode accounts:

      admin@aekaminc.com     org_owner of Aekam Inc  → keeps Aekam, loses
                                                       Unicode Group and the E2E org
      bhoomi@aekaminc.com    org_admin of Aekam Inc  → the same
      kevalvshah03@gmail.com org_admin of all three  → loses nothing
      sid@aekaminc.com       member of no org        → loses every org-role gate

    In the owner's own framing: the vendor's own staff keep Aekam Inc and lose
    two other companies. That is the intended answer, not a side effect.

    The refusal is small because `org_resolver.py` already narrowed the way in
    (commit c7494db6): outside the four console prefixes a platform role can no
    longer name another org with `X-Org-Id` at all, so the remaining reach was
    `/api/v1/billing/me/*` and three org-scoped `/api/v1/subscription/` routes.
    Those are the org's OWN bill and its own invoice history — a customer's
    spend, broken down by which of their people spent it. Aekam's equivalents
    take the org as a PATH PARAMETER and are guarded by `require_platform_role`
    (`billing.py` `/orgs/{org_id}/*`, `subscription.py` `/admin/*`), so the
    console keeps its commercial surfaces. `AdminBillingPage.jsx:130` is the one
    console call that goes through this gate; see the report for the endpoint it
    should move to.

    A god-mode holder who belongs to the org passes on the strength of the
    platform row even where their org row is weaker than the gate asks —
    `may_act_in_org` explains why that branch is not narrowed to
    org_owner/org_admin, and it is the difference between this and a lockout.

    The god-mode probe reads `GOD_MODE_ROLES`, not the bare string
    `'platform_admin'`. The literal excluded `platform_owner`, which is the exact
    lockout
    `role_tiers.py` warns about at length: today it is invisible, because every
    god-mode account still holds the legacy `platform_admin` row, and it becomes
    a total lockout of all of them on the day the data migration renames those
    rows — which is the migration the tier model was designed for. Widening to
    the named set changes nothing today (no `platform_owner` rows exist yet) and
    prevents the failure later.

    `account_manager` used to pass here too. It no longer does. It is a
    commercial role (create orgs, toggle modules, chase invoices) and this
    dependency guards org member management, org profile, HR PII reveal and
    Pahchan review — none of which are commercial actions. Aekam's commercial
    surfaces live behind `require_platform_role` in `admin_orgs.py` and are
    unaffected.
    """

    async def _check(user=Depends(require_user), org_id: str = Depends(get_org_id)):
        pool = await get_pool()

        # Both of these queries are UNCHANGED — same text, same parameters, same
        # order — because this dependency guards essentially every org surface in
        # the product and the change worth making here is to the VERDICT, not to
        # the shape of the request. What changed is that the first one no longer
        # returns on its own.
        is_platform = await pool.fetchval(
            "SELECT 1 FROM public.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL "
            "AND role_code = ANY($2::text[])",
            user["user_id"], list(GOD_MODE_ROLES),
        )

        role = await pool.fetchval(
            "SELECT role_code FROM public.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
            user["user_id"], org_id, list(allowed_roles),
        )

        # The third question — "are they part of this organisation at all" — is
        # asked ONLY of a god-mode caller whose org row did not already answer
        # the gate. An ordinary member pays nothing for it, which is why it is
        # here rather than folded into the query above: this file is on the hot
        # path of every request in the product.
        #
        # `SELECT 1` rather than `SELECT role_code` is not cosmetic. It is what
        # tells this query apart from the one above in a test that routes a
        # mocked pool on SQL text, and those tests are how the two are told apart
        # at all — see `tests/test_roles_org_scope.py`.
        belongs = False
        if is_platform and not role:
            belongs = bool(await pool.fetchval(
                "SELECT 1 FROM public.user_roles "
                "WHERE user_id=$1 AND org_id=$2::uuid "
                "AND role_code = ANY($3::text[]) LIMIT 1",
                user["user_id"], org_id, list(ORG_ROLES),
            ))

        if may_act_in_org(
            holds_org_role=bool(role),
            holds_platform_role=bool(is_platform),
            belongs_to_org=belongs,
        ):
            return user

        raise HTTPException(
            403,
            f"This action requires one of: {', '.join(allowed_roles)}",
        )

    return _check


async def is_platform_staff(user_id: str) -> bool:
    """Check if the user holds ANY Tier-1 platform role.

    The set is `ALL_PLATFORM_ROLES` — all eight codes. This docstring used to say
    "platform_admin or account_manager", naming two of them and understating the
    guard by six; the code below has read the full tuple for a while.

    NOTE: this is "is Aekam staff", not "may read anything". Its call sites are
    all Kartavya project surfaces — templates, views, time entries, activity —
    where seeing the project structure is what support means. It must not be
    used to gate payroll, HR, accounting or attendance: those are guarded by
    `require_module`, which admits only GOD MODE for sensitive modules — through
    `is_god_mode()`, so both spellings of it — and writes an audit row when it
    does.
    """
    pool = await get_pool()
    return bool(await pool.fetchval(
        "SELECT 1 FROM public.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[])",
        user_id, list(ALL_PLATFORM_ROLES),
    ))


#: Who may write a project's MEMBERSHIP rows in an organisation they are not a
#: member of. God mode plus the manager tier — deliberately NOT `platform_staff`.
#:
#: Owner's decision, 2026-08-27: "platform account having role account manager
#: can probably do." `account_manager` is superseded by `platform_manager`
#: (`role_tiers.py:29`), so that is the role named, and god mode is included
#: because it is defined as "every module, every org" and excluding it would be
#: incoherent rather than safer.
MEMBERSHIP_WRITE_ROLES: tuple[str, ...] = GOD_MODE_ROLES + MANAGER_ROLES


async def may_manage_project_membership(user_id: str) -> bool:
    """May this platform account add or re-role a project member in ANY org?

    ── WHY THIS IS NOT `is_platform_staff` ─────────────────────────────────────

    `is_platform_staff` answers "is this person Aekam staff" and reads ALL EIGHT
    platform codes. Its own docstring says its call sites are Kartavya project
    surfaces "where seeing the project structure is what support means" — and
    adding somebody to a project, or changing their role on it, is not seeing.
    It is an ACCESS-CONTROL WRITE in a customer's organisation.

    Used as the bypass on `add_team_member` / `update_team_member` it let **all
    ten** live platform accounts write membership rows into **all five**
    organisations, including the one org none of them belongs to — a bypass that
    directly contradicted `may_act_in_org` sitting beside it. Live role counts
    when this was narrowed, 2026-08-27: `platform_admin` 4, `platform_staff` 4,
    `platform_manager` 2.

    So this narrows the write to **6 of the 10**, and specifically takes it away
    from the four `platform_staff` accounts, whose tier is defined as the
    operating set — CRM, sales, marketing, analytics, messaging — and not
    permissions.

    ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────

    It does not restore the 403 that `af74d321` was raised to fix. That fix was
    real: platform staff genuinely could not use TeamsPage at all. This keeps the
    bypass for the tier that has a business reason to manage a customer's
    account and removes it from the tier that does not, which is the shape the
    owner asked for rather than a revert.

    It is also NOT a privacy control and must not be read as one. The email
    disclosure these two routes carried was fixed separately in `183f1ac0`; both
    now return an address only when the same request supplied one.
    """
    pool = await get_pool()
    return bool(await pool.fetchval(
        "SELECT 1 FROM public.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[])",
        user_id, list(MEMBERSHIP_WRITE_ROLES),
    ))


async def is_org_admin(user_id: str, org_id: str | None = None) -> bool:
    """True for platform staff, and for org_owner / org_admin.

    This replaces the legacy `users.role == 'admin'` check. That read a column
    on the users table which the JWT also carried, so anyone holding a token
    minted while they were an admin kept admin powers, and the value could not
    be scoped to an organisation at all. `staging.user_roles` is the single
    source of truth for authorisation.

    `org_id` is optional because most call sites do not yet carry org context —
    they inherited the old global check. Passing it scopes the answer properly
    and should be done wherever the org is known; omitting it preserves the
    previous global behaviour, which is still strictly narrower than the column
    it replaces (6 role holders rather than every user flagged admin).

    The platform half used to be an eight-name Postgres array literal written
    inline, twice. Two consequences, both now gone: it was a ninth copy of a set
    role_tiers already exports, so a new platform role would have been admitted
    here only if someone remembered both copies; and it listed
    `platform_support`, making a support account an org admin in EVERY org —
    the same absent approval gate closed in `org_resolver.py`.

    ── WHEN `org_id` IS GIVEN, THE PLATFORM ROW IS NO LONGER ENOUGH ─────────────

    The scoped branch answered True for a platform row held in ANY org, which is
    to say it ignored the argument that made it scoped. That is the second half
    of the same finding: `tasks_bulk.py:418` asks this question and SKIPS the
    per-id project-role check on a True, so `DELETE /api/tasks/bulk` executed
    against another organisation's tasks. `search.py:542`, `graha.py` (17 call
    sites) and `manav.py:2746` ask it too.

    Now a platform role is an org admin only in an organisation it belongs to.
    All ten live platform accounts belong to Aekam Inc except one, which belongs
    to none, so what is lost is: Unicode Group and the E2E test organisation,
    for every platform account except the one that legitimately holds
    `org_admin` in all three.

    ── THE UNSCOPED BRANCH IS DELIBERATELY UNTOUCHED ───────────────────────────

    `server.py:433 get_visible_team_ids` was fixed on 965d0e82 and its
    correctness DEPENDS on what `is_org_admin(user_id)` and `admin_org_id(user_id)`
    return with no org argument: it pairs a True from this with a None from
    `admin_org_id` to mean "platform account with no org-scoped admin row →
    fall through to ordinary membership". Changing what this returns for a
    one-argument call would silently break that fix, so this adds a scoped path
    and leaves the global answer exactly as it was. Making the remaining
    one-argument call sites pass their org is the direction of travel this
    docstring already recommends, and it is their change to make, not this
    file's.
    """
    pool = await get_pool()
    platform = list(PLATFORM_ORG_ADMIN_ROLES)
    if org_id:
        # ORG_ROLES is ordered management-first, so `array_position` returns
        # org_owner/org_admin ahead of a bare org_member when someone holds two
        # rows — the answer must not depend on which row was written first.
        org_role = await pool.fetchval(
            "SELECT role_code FROM public.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[]) "
            "ORDER BY array_position($3::text[], role_code) LIMIT 1",
            user_id, org_id, list(ORG_ROLES),
        )
        if org_role in ORG_MANAGEMENT_ROLES:
            return True
        if not org_role:
            # Not a member of this organisation. No platform row rescues that,
            # so the platform probe is not even issued — the cross-org case is
            # now the CHEAPEST one to refuse rather than the most expensive one
            # to allow.
            return False
        return may_act_in_org(
            holds_org_role=False,
            holds_platform_role=bool(await pool.fetchval(
                "SELECT 1 FROM public.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code = ANY($2::text[])",
                user_id, platform,
            )),
            belongs_to_org=True,
        )
    return bool(await pool.fetchval(
        "SELECT 1 FROM public.user_roles WHERE user_id=$1 AND ("
        "  (org_id IS NULL AND role_code = ANY($2::text[]))"
        "  OR (org_id IS NOT NULL AND role_code IN ('org_owner','org_admin'))"
        ")",
        user_id, platform,
    ))


async def admin_org_id(user_id: str, org_id: str | None = None) -> str | None:
    """The org whose teams this user may see in full, or None.

    Used by the visibility helpers that previously expanded `role == 'admin'`
    into "every team in the org". Returns None for platform staff with no org
    row, which the callers treat as unrestricted — the same as before.

    ── WITH AN `org_id`: CONFIRM, DO NOT GUESS ─────────────────────────────────

    The scoped call answers exactly one question — "does this caller hold
    org_owner/org_admin IN THIS ORG" — and answers None when they do not. It
    NEVER falls back to some other org the caller happens to administer, because
    the whole point of the argument is that the caller has already decided which
    org this request is about. A fallback would mean an org switcher that quietly
    substitutes a different organisation whenever the user is not an admin of the
    one they picked, which is the defect this parameter exists to end: the owner
    holds org_admin in all three organisations, switched to E2E Test, and the
    Projects page rendered Aekam Inc.

    Note what the scoped branch does NOT do: a platform role does not rescue a
    missing org row here. `is_org_admin(user_id, org_id)` is the function that
    weighs platform roles against org membership, and it is a separate question
    from "which org's teams are yours in full". Callers that want the platform
    answer must ask for it by name.

    ── WITHOUT ONE: STILL DETERMINISTIC ────────────────────────────────────────

    The unscoped statement used to be `… LIMIT 1` with NO `ORDER BY` over a set
    that genuinely has three rows for the owner. That is not merely "returns the
    wrong org"; it is a result the QUERY PLANNER chooses, so it can change on a
    Postgres upgrade, a new index, or a row count crossing a threshold, with no
    code change and no deploy to blame it on. `granted_at` is the same ordering
    `middleware/org_resolver.get_org_id` falls back to when no `X-Org-Id` header
    is sent, so a header-less request now resolves the same org through both
    paths instead of two independently arbitrary ones. `org_id::text` breaks ties
    for rows written in the same transaction, where `granted_at` is identical.
    """
    pool = await get_pool()
    if org_id:
        return await pool.fetchval(
            "SELECT org_id::text FROM public.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid "
            "AND role_code IN ('org_owner','org_admin') LIMIT 1",
            user_id, org_id,
        )
    return await pool.fetchval(
        "SELECT org_id::text FROM public.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL "
        "AND role_code IN ('org_owner','org_admin') "
        "ORDER BY granted_at, org_id::text LIMIT 1",
        user_id,
    )


async def get_user_roles(user_id: str, org_id: str = None) -> list[str]:
    """Get all roles for a user. Returns platform + org-scoped roles."""
    pool = await get_pool()
    if org_id:
        rows = await pool.fetch(
            "SELECT role_code FROM public.user_roles "
            "WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2::uuid)",
            user_id, org_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT role_code FROM public.user_roles WHERE user_id=$1",
            user_id,
        )
    return [r["role_code"] for r in rows]


async def is_portal_client(user: dict) -> bool:
    """Is this caller a CLIENT PORTAL user — the customer's own customer?

    This replaces the bare `user.get("role") == "client"` that gated comment
    visibility, attachment filtering and time logging. That read the legacy
    `users.role` column, which is a single global string and cannot express
    "client of org A, admin of org B" — and, on live data, disagreed with
    `staging.user_roles` outright: two accounts carry `users.role='client'`
    while holding `org_admin`. Both are org administrators who were shown an
    empty comment list and no files on their own organisation's tasks, because
    every client gate believed the column.

    `staging.user_roles` is the source of truth (see `is_org_admin` above for
    the same argument applied to `'admin'`), so the column alone is not enough
    to conclude "client". A caller stops being a portal client only when they
    hold one of the STAFF-SIDE roles named below.

    ── AN ALLOW-LIST, NOT `role_code <> 'org_client'` ─────────────────────────

    Both spellings fix the reported bug; they differ on the role code nobody has
    invented yet. "Anything that is not `org_client`" declassifies a client the
    moment a new code appears anywhere in their rows, and declassifying a client
    is the direction that SHOWS THEM the firm's internal comments about their
    own file. An allow-list gets that wrong the safe way round: an unrecognised
    role leaves them a client and someone has to add it deliberately.

    `aekam_team` and `org_client` are both absent, so neither lifts the client
    treatment on its own — they are the two `PROJECT_ONLY_ROLES`, and neither is
    a reason to hand someone the firm's internal thread.

    ── WHY THIS CANNOT LOOSEN A REAL CLIENT'S GATES ───────────────────────────

    The column is still required, so nobody who was NOT a client before becomes
    a non-client now; the only accounts this can reclassify are ones already
    holding an org's management or HR role, or a platform role, which is
    precisely the bug.

    Takes the user dict rather than an id because the column lives on it and
    the common case — an ordinary member — answers False with no query at all.
    """
    if user.get("role") != "client":
        return False
    pool = await get_pool()
    staff_side = list(ORG_ROLES + HR_ADMIN_ROLES + ALL_PLATFORM_ROLES)
    return not bool(await pool.fetchval(
        "SELECT 1 FROM public.user_roles "
        "WHERE user_id=$1 AND role_code = ANY($2::text[]) LIMIT 1",
        user["user_id"], staff_side,
    ))


async def may_reach_project(pool, team_id: str | None, user_id: str) -> bool:
    """May this caller reach a project's task detail — comments, time, activity?

    The task LIST is org-scoped through `get_visible_team_ids`, but the drawer's
    sub-resources asked a narrower question: `team_members` UNION
    `project_assignments`, and nothing else. The two disagree, so an org_admin
    could list a task in their own organisation and be refused its detail — the
    drawer opened onto an empty skeleton. Reported from staging on 2026-08-08
    against `task_ug03_04`, whose project has three members, none of them the
    org's administrator.

    Membership stays the primary answer. The addition is the org's own
    administrators, and it is SCOPED TO THE PROJECT'S OWN ORG — resolved from
    `teams.org_id` here, never from the caller's active org — so this admits an
    admin to their own tenant's projects and to no one else's. A team with no
    `org_id` has no tenant to administer, so the admin leg simply does not open
    on it and membership remains the only way in.

    ── WHY THE `team_members` LEG IS GONE ─────────────────────────────────────

    This is the CANONICAL note for the whole phase-2 sweep; the other thirteen
    migrated reads point here rather than restate it.

    Project membership ran on two tables that disagreed. Migration
    `195_reconcile_team_members_into_project_assignments.sql` closed the gap —
    every active `team_members` row now has a `project_assignments` row at the
    IDENTICAL role — so `project_assignments` is a strict superset and dropping
    the `team_members` leg from a READ cannot revoke anybody. Measured on the
    live database after 195 landed: 198 active `team_members`, 219
    `project_assignments`, 0 missing, 0 role disagreements, and the 21 extra
    rows are all `owner`. That is the entire safety argument, and it holds only
    while every writer keeps feeding BOTH tables — which is why phase 2 removes
    reads and touches no write. See `PROPOSED_080_team_members_retire.sql`,
    step 2 of "THE ORDER THAT MUST BE FOLLOWED".

    This particular leg is PROJECT membership, not org membership, despite
    living in the role middleware: the org question is asked separately below,
    at request time, against `staging.user_roles`. The two were never the same
    check and are not merged here.
    """
    if not team_id:
        return False
    row = await pool.fetchrow(
        "SELECT 1 FROM public.project_assignments WHERE team_id=$1 AND user_id=$2 "
        "LIMIT 1",
        team_id, user_id,
    )
    if row:
        return True
    team_org = await pool.fetchval(
        "SELECT org_id::text FROM teams WHERE team_id=$1", team_id)
    if not team_org:
        return False
    return await is_org_admin(user_id, team_org)
