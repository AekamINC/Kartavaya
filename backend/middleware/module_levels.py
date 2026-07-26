"""
module_levels.py — Tier-4 enforcement: the guard that reads a module grant LEVEL.

`role_tiers.level_satisfies()` has encoded the four-level ladder — and the
separated-duty exception for Vetana and Ganit — since the tier model landed. It
had **zero call sites**. The level was written on every grant
(`org_member_modules.role`), returned to the UI, rendered in the member editor,
and never once consulted by a guard. `require_module()` checks only that a grant
ROW EXISTS; a `viewer` and an `admin` reached exactly the same endpoints.

So the rule "in Ganit and Vetana, admin does NOT satisfy approver" was true of a
pure function nobody called. This module is the missing consumer.

────────────────────────────────────────────────────────────────────────────────
Why the approver grant needs somewhere new to live
────────────────────────────────────────────────────────────────────────────────

`PROPOSED_065` states the standing rule for sensitive modules:

    Vetana, Ganit and Manav must have NO per-member grant row at all.
    Access is a function of the org role.

That is correct for *reach* — you do not hand out the books by adding a row. But
it means the schema has **nowhere to record "this person may approve in Ganit"**:
`org_member_modules` is forbidden for `ganit`, and `user_roles` carries only
org_owner / org_admin / org_member. Separated duty was therefore not merely
unenforced, it was **not representable**.

`PROPOSED_074` adds `staging.org_module_approvers` — a narrow, auditable table
whose only purpose is to name the approver for a separated-duty module. It is
deliberately NOT `org_member_modules`: an approver grant is not module reach, it
is a second, explicit, separately-revocable authority. The owner's words —
"one user can have both FYI but auditable".

────────────────────────────────────────────────────────────────────────────────
Activation is driven by the migration, not by a deploy
────────────────────────────────────────────────────────────────────────────────

Enforcing approver against a table that does not exist yet would lock every org
out of cancelling an invoice or paying a vendor bill the moment this ships —
including single-person firms with no second person to grant. So the resolver
probes for the table once and caches the answer:

  · table ABSENT  → separated duty is not yet active. org_owner / org_admin keep
                    the access they have today. Behaviour is unchanged.
  · table PRESENT → separated duty is live. Only an explicit approver row
                    approves; admin is breadth, not seniority, and does not
                    climb into it.

Applying PROPOSED_074 turns enforcement on by itself, with no code change. That
ordering matters: the migration author decides the cutover, and can seed the
approver rows in the same transaction so nobody is locked out mid-flight.
"""
import logging

from fastapi import Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.role_tiers import (
    APPROVER,
    DEFAULT_GRANT_LEVEL,
    LEVELS,
    PLATFORM_ROLE_PRECEDENCE,
    SEPARATED_DUTY_MODULES,
    can_reach_module,
    level_satisfies,
)

logger = logging.getLogger(__name__)

#: Tri-state cache for "does the approver table exist". None = not yet probed.
#: Process-local and never invalidated downward: a table does not un-create
#: itself, and re-probing on every request would add a round trip to the hot
#: path of every guarded endpoint.
_approver_table_exists: bool | None = None


async def approver_table_available(pool) -> bool:
    """True once `staging.org_module_approvers` exists. Cached after first hit."""
    global _approver_table_exists
    if _approver_table_exists is None:
        try:
            _approver_table_exists = bool(await pool.fetchval(
                "SELECT to_regclass('staging.org_module_approvers') IS NOT NULL"
            ))
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning("approver table probe failed, assuming absent: %s", exc)
            return False
    return _approver_table_exists


def reset_approver_table_cache() -> None:
    """Test seam. Production never needs this — see the note on the cache."""
    global _approver_table_exists
    _approver_table_exists = None


async def _platform_role(pool, user_id: str) -> str | None:
    """The caller's strongest platform role, or None. Mirrors subscription.py."""
    return await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[]) "
        "ORDER BY array_position($2::text[], role_code) LIMIT 1",
        user_id, list(PLATFORM_ROLE_PRECEDENCE),
    )


async def _org_role(pool, user_id: str, org_id: str) -> str | None:
    return await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid "
        "AND role_code IN ('org_owner','org_admin')",
        user_id, org_id,
    )


async def has_explicit_approver_grant(pool, user_id: str, org_id: str, module_code: str) -> bool:
    """An explicit, auditable approver row for this user, org and module."""
    if not await approver_table_available(pool):
        return False
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.org_module_approvers "
        "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3 "
        "AND revoked_at IS NULL",
        user_id, org_id, module_code,
    ))


async def held_level(pool, user_id: str, org_id: str, module_code: str) -> str | None:
    """
    The ladder level this user holds on this module, ignoring the separated-duty
    exception (which `require_level` applies on top — it is a question about the
    REQUIRED level, not about what is held).

    Platform staff and org owners/admins hold `admin`: breadth over the whole
    module. An ordinary member holds whatever their grant says.
    """
    platform_role = await _platform_role(pool, user_id)
    if platform_role and can_reach_module(platform_role, module_code):
        return "admin"

    if await _org_role(pool, user_id, org_id):
        return "admin"

    grant = await pool.fetchval(
        "SELECT role FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
        user_id, org_id, module_code,
    )
    if grant is None:
        return None
    # A grant row written before the level column existed, or holding a value the
    # ladder does not know, is read as the weakest level rather than trusted.
    # Failing upward here would hand full control to every legacy row.
    return grant if grant in LEVELS else DEFAULT_GRANT_LEVEL


def require_level(module_code: str, required: str):
    """
    FastAPI dependency: the caller must satisfy `required` on `module_code`.

    Stacks on top of `require_module(module_code)`, which stays responsible for
    subscription state and module reach. This dependency answers only the
    narrower question of DEPTH.

    For Vetana and Ganit at the `approver` rung this refuses org_owner,
    org_admin and platform staff alike unless they hold an explicit approver
    grant. Refusing platform staff is deliberate and is the stronger half of the
    rule: Aekam support must never be able to release a customer's money.
    """

    async def _check(request: Request, org_id: str = Depends(get_org_id)):
        user = getattr(request.state, "_auth_user", None)
        if not user:
            raise HTTPException(401, "Authentication required")
        user_id = user.get("user_id")
        pool = await get_pool()

        separated = module_code in SEPARATED_DUTY_MODULES and required == APPROVER

        if separated:
            # Until PROPOSED_074 is applied there is nowhere to record an
            # approver, so enforcing it would lock everyone out. Fall back to
            # the access these roles have today and say so in the log.
            if not await approver_table_available(pool):
                if await _org_role(pool, user_id, org_id):
                    return
                if await _platform_role(pool, user_id):
                    return
                raise HTTPException(
                    403,
                    f"This action requires approver rights on {module_code}.",
                )
            if await has_explicit_approver_grant(pool, user_id, org_id, module_code):
                return
            raise HTTPException(
                403,
                f"This action requires an explicit approver grant on "
                f"{module_code}. Administering {module_code} and approving in it "
                f"are separate authorities — holding admin does not confer "
                f"approver.",
            )

        held = await held_level(pool, user_id, org_id, module_code)
        if not level_satisfies(held, required, module_code):
            raise HTTPException(
                403,
                f"This action requires {required} rights on {module_code}.",
            )

    return _check
