"""
org_resolver.py — Bridge between production team_id and staging org_id.
Production uses text team_id everywhere; staging modules use UUID org_id.
Orgs must be created by a platform admin — no auto-creation.
"""
from fastapi import Depends, HTTPException, Request
from db import get_pool
from auth_router import require_user
from middleware.role_tiers import ALL_PLATFORM_ROLES, SUPPORT_ROLES

#: Platform roles that may resolve an ARBITRARY org from the `X-Org-Id` header.
#:
#: Everything in `ALL_PLATFORM_ROLES` except support. `platform_support` is
#: specified at "**Zero by default.** Needs org-admin approval granting: time
#: limit, module scope, access level. Auto-expires." (`RBAC-SPEC.md` · Tier 1),
#: and the table that would record such an approval —
#: `staging.platform_support_sessions` — does not exist yet. `role_tiers.py:41`
#: says the same thing from the other side: "a holder of this role currently gets
#: nothing." A role that gets nothing must not be able to name any org in the
#: system and have the resolver agree.
#:
#: The other three no-reach roles are deliberately still here, and removing them
#: would BREAK the console rather than harden it:
#:   · `account_finance` and `account_manager` — `routers/subscription.py`'s admin
#:     endpoints (`:144` set-plan, `:208`, `:260`, `:302`) take
#:     `require_platform_role(*BILLING_CONSOLE_ROLES)` AND `Depends(get_org_id)`,
#:     and `AdminBillingPage` reaches them by sending this very header
#:     (`pages/admin/orgScope.js`). Both roles are in BILLING_CONSOLE_ROLES.
#:   · `srijan_admin` — `routers/hub.py` depends on `get_org_id` in 44 places.
#: `modules_for()` returning `frozenset()` for all three is about MODULE reach in
#: a customer org, which is a different question from whether they may resolve
#: one. The real fix for those is to give the billing and hub endpoints an
#: explicit `{org_id}` path parameter the way `admin_orgs.py` does, so the org is
#: an argument the guard can see rather than a header the resolver trusts. That
#: is an endpoint-shape change across two routers and is recorded, not smuggled
#: in here.
CROSS_ORG_HEADER_ROLES: tuple[str, ...] = tuple(
    r for r in ALL_PLATFORM_ROLES if r not in SUPPORT_ROLES
)


async def get_org_id(request: Request, user=Depends(require_user)):
    """Resolve the user's primary team_id to a staging.organisations UUID.
    Returns 403 if no org exists — admin must create it first."""
    cached = getattr(request.state, "_org_id", None)
    if cached is not None:
        return cached

    pool = await get_pool()

    # Prefer org from X-Org-Id header (org switcher)
    header_org = request.headers.get("x-org-id")
    if header_org:
        # Validate user belongs to this org
        is_member = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid "
            "AND role_code IN ('org_owner','org_admin','org_member')",
            user["user_id"], header_org,
        )
        # Platform staff can access any org
        if not is_member:
            is_platform = await pool.fetchval(
                "SELECT 1 FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code = ANY($2::text[])",
                user["user_id"], list(ALL_PLATFORM_ROLES),
            )
            if not is_platform:
                raise HTTPException(403, "You do not belong to this organisation")
        org = await pool.fetchrow(
            "SELECT id FROM staging.organisations WHERE id=$1::uuid AND is_active=TRUE",
            header_org,
        )
        if not org:
            raise HTTPException(404, "Organisation not found or inactive")
        org_id = str(org["id"])
        request.state._org_id = org_id
        return org_id

    # Fallback: resolve from user_roles (org-scoped roles)
    org_role = await pool.fetchrow(
        "SELECT org_id FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL "
        "AND role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY granted_at LIMIT 1",
        user["user_id"],
    )
    if org_role:
        org = await pool.fetchrow(
            "SELECT id FROM staging.organisations WHERE id=$1 AND is_active=TRUE",
            org_role["org_id"],
        )
        if org:
            org_id = str(org["id"])
            request.state._org_id = org_id
            return org_id

    raise HTTPException(
        403,
        "You are not a member of any organisation. "
        "Contact your administrator to be added.",
    )
