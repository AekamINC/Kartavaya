"""
roles.py — Multi-role gating middleware.

Supports platform-wide roles (org_id=NULL) and org-scoped roles.
A user can have multiple roles. Platform roles apply everywhere.

Usage:
  Depends(require_role("admin"))              — legacy, checks users.role
  Depends(require_platform_role("platform_admin", "account_manager"))
  Depends(require_org_role("org_admin", "srijan_admin"))
"""
from fastapi import Depends, HTTPException

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import ALL_PLATFORM_ROLES, GOD_MODE_ROLES


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
    """Check staging.user_roles for platform-wide roles (org_id IS NULL)."""

    async def _check(user=Depends(require_user)):
        pool = await get_pool()
        role = await pool.fetchval(
            "SELECT role_code FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
            user["user_id"], list(allowed_roles),
        )
        if not role:
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

    return _check


def require_org_role(*allowed_roles: str):
    """Check staging.user_roles for org-scoped roles.

    God mode passes unconditionally — removing it would lock support out of
    every org.

    That check reads `GOD_MODE_ROLES`, not the bare string `'platform_admin'`.
    The literal excluded `platform_owner`, which is the exact lockout
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

        is_platform = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL "
            "AND role_code = ANY($2::text[])",
            user["user_id"], list(GOD_MODE_ROLES),
        )
        if is_platform:
            return user

        role = await pool.fetchval(
            "SELECT role_code FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
            user["user_id"], org_id, list(allowed_roles),
        )
        if not role:
            raise HTTPException(
                403,
                f"This action requires one of: {', '.join(allowed_roles)}",
            )
        return user

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
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[])",
        user_id, list(ALL_PLATFORM_ROLES),
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
    """
    pool = await get_pool()
    if org_id:
        return bool(await pool.fetchval(
            "SELECT 1 FROM staging.user_roles WHERE user_id=$1 AND ("
            "  (org_id IS NULL AND role_code = ANY('{platform_owner,platform_admin,platform_manager,platform_staff,account_manager,account_finance,srijan_admin,platform_support}'::text[]))"
            "  OR (org_id=$2::uuid AND role_code IN ('org_owner','org_admin'))"
            ")",
            user_id, org_id,
        ))
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles WHERE user_id=$1 AND ("
        "  (org_id IS NULL AND role_code = ANY('{platform_owner,platform_admin,platform_manager,platform_staff,account_manager,account_finance,srijan_admin,platform_support}'::text[]))"
        "  OR (org_id IS NOT NULL AND role_code IN ('org_owner','org_admin'))"
        ")",
        user_id,
    ))


async def admin_org_id(user_id: str) -> str | None:
    """The org whose teams this user may see in full, or None.

    Used by the visibility helpers that previously expanded `role == 'admin'`
    into "every team in the org". Returns None for platform staff with no org
    row, which the callers treat as unrestricted — the same as before.
    """
    pool = await get_pool()
    return await pool.fetchval(
        "SELECT org_id::text FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL "
        "AND role_code IN ('org_owner','org_admin') LIMIT 1",
        user_id,
    )


async def get_user_roles(user_id: str, org_id: str = None) -> list[str]:
    """Get all roles for a user. Returns platform + org-scoped roles."""
    pool = await get_pool()
    if org_id:
        rows = await pool.fetch(
            "SELECT role_code FROM staging.user_roles "
            "WHERE user_id=$1 AND (org_id IS NULL OR org_id=$2::uuid)",
            user_id, org_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT role_code FROM staging.user_roles WHERE user_id=$1",
            user_id,
        )
    return [r["role_code"] for r in rows]
