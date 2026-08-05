"""
org_resolver.py — Bridge between production team_id and staging org_id.
Production uses text team_id everywhere; staging modules use UUID org_id.
Orgs must be created by a platform admin — no auto-creation.
"""
import logging

from fastapi import Depends, HTTPException, Request
from db import get_pool
from auth_router import require_user
from middleware.role_tiers import ALL_PLATFORM_ROLES, SUPPORT_ROLES
from outbound import set_org

logger = logging.getLogger(__name__)

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


#: WHERE a platform role may use that header. Deny by default everywhere else.
#:
#: ── THE HOLE THIS CLOSES ─────────────────────────────────────────────────────
#:
#: The role check above answered "may this person ever act cross-org", and the
#: resolver then applied the answer to EVERY ROUTE IN THE PRODUCT. So a platform
#: role that exists to run the billing console could put any org's UUID in a
#: header and be obeyed by endpoints that have nothing to do with billing.
#: Measured on the live database, three chains that all worked:
#:
#:   · POST /api/v1/vikray/orders — a platform_staff INSERTs a row carrying the
#:     victim org's org_id. `require_module` returns early for a platform role
#:     on a non-sensitive module, so it is not even audited.
#:   · DELETE /api/tasks/bulk — no module gate at all. `is_org_admin` answers
#:     True for these role codes in ANY org, so the per-id project-role check is
#:     skipped and the DELETE executes against another org's tasks.
#:   · GET /api/v1/search — cross-module record search, scoped entirely by the
#:     header value.
#:
#: Nine of the ten live platform accounts are members of Aekam Inc only, and one
#: (sid@aekaminc.com) is a member of no org at all. All ten could name either of
#: the other two organisations and be obeyed.
#:
#: ── WHY A PATH ALLOW-LIST RATHER THAN REMOVING THE ROLES ─────────────────────
#:
#: The comment above records, correctly, that deleting account_finance,
#: account_manager or srijan_admin from that tuple BREAKS the console rather
#: than hardening it: `/v1/subscription/admin/*` resolves its org through this
#: header (`pages/admin/orgScope.js` sends it deliberately, per call site), and
#: `routers/hub.py` depends on `get_org_id` in 44 places. The role is not the
#: problem. The problem is that the answer was applied everywhere.
#:
#: It also proposes the eventual fix — give those endpoints an explicit
#: `{org_id}` path parameter, so the org is an argument a guard can see rather
#: than a header the resolver trusts. That remains the right destination and is
#: an endpoint-shape change across two routers. This is the same idea enforced
#: one layer up, and it needs no endpoint to move: the resolver already has the
#: request, so it can ask WHERE the header is being used, not only BY WHOM.
#:
#: Deny-by-default matters here. A surface accidentally left off this list fails
#: LOUDLY with a 403 naming the reason, which is a bug report. A surface
#: accidentally left ON is silent cross-tenant access, which is what the last
#: several months were.
#:
#: ORDINARY MEMBERS ARE NOT AFFECTED BY ANY OF THIS. The membership branch above
#: runs first and is unchanged — a person who belongs to two organisations
#: switches between them on every route, exactly as before. This narrows only
#: the platform escape hatch.
CROSS_ORG_HEADER_PREFIXES: tuple[str, ...] = (
    "/api/v1/subscription/",  # the billing console — BILLING_CONSOLE_ROLES
    "/api/v1/billing/",       # the same console's read side
    "/api/v1/admin/",         # the platform console (mostly {org_id}-in-path already)
    "/api/v1/hub/",           # the agency service Aekam runs FOR client orgs
)


def _cross_org_path_allowed(path: str) -> bool:
    """Is this a console surface, where a platform role may name another org?"""
    return path.startswith(CROSS_ORG_HEADER_PREFIXES)


# ── WHOSE SEND WAS IT ────────────────────────────────────────────────────────
#
# `staging.outbound_log` is read one way and one way only — `WHERE org_id =
# $1::uuid` (`routers/billing.py:1449`, `:1455`, `:1593`) — so a row with a NULL
# org is a row no client is ever shown. Every email and every push wrote NULL,
# because `email_service.send_email(to, subject, html)` has no org parameter and
# no caller could supply one. The screen built to answer an SES bill would have
# answered it empty, for every org, forever.
#
# The org is ALREADY RESOLVED HERE, on every request in the product, because
# tenancy needs it. Publishing it costs one call and makes every send that
# request causes attributable without a single sender knowing an org exists —
# which is the whole point. Threading a parameter through fourteen senders is the
# fix the fifteenth sender forgets, and forgetting is the failure this table was
# built to end. `outbound.begin()` takes it as a DEFAULT: an explicit `org_id=`
# passed at a sender still wins.
#
# THREE THINGS THIS DELIBERATELY DOES NOT DO:
#
#   * IT DOES NOT RESET. A ContextVar left set can leak the previous request's
#     org into the next one on the same worker, and on a money-adjacent log a
#     confidently wrong org is worse than the NULL it replaces. So this was
#     MEASURED on this stack rather than reasoned about: this dependency was
#     driven by a real uvicorn worker over ONE keep-alive connection, and every
#     bare request that followed read the default — async and `def` alike,
#     including twelve consecutive trips through anyio's REUSED worker threads,
#     before and after a second org resolved on the same socket.
#
#     Two independent boundaries make that true, which is why it is not luck.
#     `RequestResponseCycle.run_asgi` is a Task per request and a Task gets its
#     own copy of the context, so the set dies with the request. And all four
#     `@app.middleware("http")` in `server.py` are BaseHTTPMiddleware, which runs
#     everything downstream in a CHILD task — the same reason the value is not
#     visible to those middlewares after `call_next` returns, and the reason it
#     cannot climb back out to the connection that would carry it forward.
#     Checked on both stacks this repo runs: uvicorn 0.34 / starlette 0.46 as
#     deployed, and starlette 1.3, which is what the test suite imports.
#
#     There is nothing to reset, and `set_org(None)` is a deliberate no-op, so a
#     reset written here would be theatre rather than safety.
#
#   * IT DOES NOT SET WHEN NO ORG WAS RESOLVED. Every path below that cannot name
#     an org raises instead, and the ContextVar keeps its `None` default. A send
#     from a request with no org must file under no org: an unattributed row is a
#     gap somebody can see, and a plausible-looking wrong org is a gap nobody
#     can.
#
#   * IT DOES NOT TOUCH THE RESOLUTION. The `X-Org-Id` header, the platform-role
#     bypass and the `ORDER BY granted_at` fallback are the tenancy path for the
#     entire product and are exactly as they were. This reads the answer out; it
#     has no vote in it.
#
# Set from `async def` on purpose. A sync dependency or endpoint runs in anyio's
# worker thread, which is handed a COPY of the request context — reads reach it
# (a `def` endpoint that sends is covered), but a `set()` made there is thrown
# away when the thread returns.
def _attribute(org_id: str, user) -> str:
    """Name the org every send from this request belongs to. Returns it as-is.

    THE GUARD IS NOT REDUNDANT, even though `set_org` has one of its own. This
    dependency resolves tenancy for essentially every route in the product, so
    a raise from this line is not a lost log row — it is a 500 on everything,
    caused by an observability feature, which is the least defensible kind of
    outage there is. That the callee currently swallows its own failures is a
    fact about another module, and one a future edit there is free to change
    without ever reading this file.

    So the contract is stated where it is owed: attribution cannot affect the
    request. `org_id` is returned untouched on every path, which is the other
    half of the same promise — this function reads the resolution out, and has
    no vote in it.
    """
    try:
        set_org(org_id, user.get("user_id") if isinstance(user, dict) else None)
    except Exception:
        logger.debug("org_resolver: could not attribute this request's sends",
                     exc_info=True)
    return org_id


async def get_org_id(request: Request, user=Depends(require_user)):
    """Resolve the user's primary team_id to a staging.organisations UUID.
    Returns 403 if no org exists — admin must create it first."""
    cached = getattr(request.state, "_org_id", None)
    if cached is not None:
        # Re-published rather than assumed. `request.state` outlives a context —
        # it is the same object whichever task reads it — so the cheap assumption
        # that "the first resolution already set it" is one the cache itself does
        # not guarantee. A ContextVar set is a dict write; a wrong attribution on
        # this table is an hour of somebody's afternoon.
        return _attribute(cached, user)

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
        # A platform role may name another org ONLY on a console surface. See
        # CROSS_ORG_HEADER_PREFIXES for the three attack chains that worked when
        # this was a question about the ROLE alone and not about the ROUTE.
        if not is_member:
            path = getattr(getattr(request, "url", None), "path", "") or ""
            if not _cross_org_path_allowed(path):
                # Deliberately the same sentence a non-platform caller gets. A
                # distinct message here would tell a platform account which
                # routes still accept the header, which is a map of the escape
                # hatch. The log line below is where the distinction lives.
                logger.warning(
                    "cross-org header refused: user=%s org=%s path=%s "
                    "(platform roles may use X-Org-Id only on %s)",
                    user.get("user_id"), header_org, path,
                    ", ".join(CROSS_ORG_HEADER_PREFIXES),
                )
                raise HTTPException(403, "You do not belong to this organisation")

            is_platform = await pool.fetchval(
                "SELECT 1 FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code = ANY($2::text[])",
                user["user_id"], list(CROSS_ORG_HEADER_ROLES),
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
        return _attribute(org_id, user)

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
            return _attribute(org_id, user)

    raise HTTPException(
        403,
        "You are not a member of any organisation. "
        "Contact your administrator to be added.",
    )
