"""
subscription.py — Feature gating middleware.
Use require_module("srijan") as a FastAPI dependency to restrict endpoints
to orgs that have that module active.

Srijan is a bundled module — included in every paid plan. Other modules
(graha, manav, etc.) are activated per-org by admin.
"""
from datetime import datetime, timezone, timedelta
from fastapi import Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import get_org_id
from services.audit import emit as audit
from middleware.role_tiers import (
    ALL_PLATFORM_ROLES, ORG_ROLES, PLATFORM_ROLE_PRECEDENCE, can_reach_module,
    is_god_mode, ADMIN, DEFAULT_GRANT_LEVEL, EDITOR, LEVELS, level_satisfies,
)

#: POST routes that READ. The verb rule below treats POST/PUT/PATCH/DELETE as a
#: write, which is right almost everywhere and wrong for these: generating a
#: document or running a saved query takes a body because the parameters do not
#: fit in a URL, not because anything changes. Requiring Editor for them would
#: stop a viewer downloading a GSTR-3B they are entitled to read.
#:
#: Matched on the path SUFFIX so the router prefix is irrelevant. Keep this list
#: short and justified — every entry is a hole in the rule, and the rule is what
#: closed 210 routes. If an entry here ever starts writing, it must leave.
READ_SHAPED_POSTS: tuple[str, ...] = (
    "/pdf",        # every document generator: gstr3b, tds challan, agreement, project report
    "/query",      # dristi's saved-report runner
    "/export",     # data export
    "/preview",
)


def _is_write(request: Request) -> bool:
    """Does this request change anything?

    GET/HEAD/OPTIONS never do. Everything else does, unless its path is one of
    the read-shaped POSTs above.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return False
    path = request.url.path.rstrip("/")
    return not any(path.endswith(suffix) for suffix in READ_SHAPED_POSTS)

_cache: dict = {}
_CACHE_TTL = timedelta(minutes=5)
_CACHE_MAX_SIZE = 2000

BUNDLED_MODULES = {"srijan", "esign"}

# Modules holding payroll, financial records, HR files or biometric attendance.
# `pahchan` is here because its rows are face-match scores and selfies against a
# named employee — biometric-adjacent data that is at least as sensitive as the
# HR file it attaches to, and the standing constraints already single it out.
SENSITIVE_MODULES = {"vetana", "ganit", "manav", "pahchan"}

# Which modules each platform role may reach now lives in ONE file. It used to be
# hardcoded tuples here and in four other modules; adding a role meant finding
# every one, and a missed call site fails silently in whichever direction is
# wrong. See middleware/role_tiers.py.
#
# `account_manager` grants nothing on its own: it is a commercial role — create
# orgs, toggle modules, chase invoices — and it previously bypassed this gate for
# every module in every org, so whoever ran the commercial side could read any
# customer's payroll, Aadhaar and attendance without leaving a trace. It is
# superseded by platform_manager and kept only so existing rows stay readable.
SUPPORT_PLATFORM_ROLES = ALL_PLATFORM_ROLES


# ══════════════════════════════════════════════════════════════════════════════
# THE PLATFORM BRANCH — what a platform role must satisfy, as three pure
# functions rather than as control flow that can be jumped over.
#
# ── WHAT WENT WRONG ──────────────────────────────────────────────────────────
#
# The branch used to end in a bare `return` for every non-sensitive module. That
# one statement left the function BEFORE the write-level check, before the
# subscription check, and before anything that could write an audit row — so the
# measured chain was:
#
#     POST /api/v1/vikray/orders, a platform_staff, `vikray` in STAFF_MODULES
#       → reach check passes
#       → `vikray` is not sensitive
#       → return
#       → the handler INSERTs a row carrying whichever org_id was resolved
#       → NOTHING IS RECORDED ANYWHERE
#
# The cross-org half of that is closed elsewhere (`org_resolver.py`, c7494db6:
# the `X-Org-Id` header is now a console scope). The half that lived HERE is the
# silence, and the silence is the actual defect — a privileged path that leaves
# no trace cannot be audited, cannot be reviewed, and is discovered only by
# someone reading the source. Everything else is consequence.
#
# So the policy is written out as data-in / decision-out below. A pure function
# cannot be skipped by an early return, can be tested without a database, and
# reads as a list of rules rather than as a path through an `if`.
#
# ── WHAT IS DELIBERATELY UNCHANGED ───────────────────────────────────────────
#
# The sensitive-module rule is RIGHT and is not touched: a non-god-mode platform
# role is refused outright on {vetana, ganit, manav, pahchan}, and a god-mode
# crossing is recorded. That refusal bites `platform_manager` in particular,
# whose MANAGER_MODULES (ALL_MODULES - HR_MODULES) still contains `ganit` and
# `pahchan`. Its real silent-write set was therefore the staff six plus `esign`
# and `varta` — eight modules — not everything.
#
# Platform REACH is also unchanged. Aekam runs an agency service for client orgs
# through /hub, and narrowing `can_reach_module` here would break that rather
# than harden it. This changes what a crossing COSTS (a row), not who may cross.

#: The action name a SENSITIVE crossing writes. Unchanged, and deliberately so:
#: 312 rows in `staging.audit_log` already carry this name (measured 2026-08-05 —
#: it is the second most common action in the entire table, after `auth.login`).
#: Every one of them means "a god-mode account was GRANTED a sensitive module".
#: Reusing it for anything else — a refusal, a non-sensitive module — would
#: retroactively change what those 312 rows say.
SENSITIVE_ACCESS_ACTION = "platform.sensitive_module_access"

#: The action name a non-sensitive platform WRITE writes. New, and separate from
#: the above for the reason directly above it.
PLATFORM_WRITE_ACTION = "platform.module_write"

#: What a platform role holds on a module it may reach.
#:
#: NOT invented here. `role_tiers.held_module_levels` already answers exactly
#: this question for the routes that ask for a level directly — "a platform role
#: that `can_reach_module` contributes ADMIN" — and that is the shipped contract
#: those routes are written against. Naming the same constant here means this
#: gate and that resolver cannot disagree about what an Aekam account holds; if
#: the answer ever changes it changes in both places or the tests below fail.
PLATFORM_MODULE_LEVEL: str = ADMIN


def platform_refusal(
    platform_role: str, module_code: str, *, is_write: bool
) -> str | None:
    """Why this platform role may NOT proceed, or None if it may.

    Three rules, in this order, because the order is itself the policy: a role
    that cannot reach a module at all should be told that and not told which
    modules hold payroll.
    """
    # 1. Reach. One lookup, shared with every other gate in the product, so the
    #    answer cannot differ between here and `held_module_levels`.
    if not can_reach_module(platform_role, module_code):
        return (
            f"The {platform_role} role cannot access the {module_code} module."
        )

    # 2. Payroll, the books, HR files, biometric attendance. God mode only.
    if module_code in SENSITIVE_MODULES and not is_god_mode(platform_role):
        return (
            f"The {platform_role} role cannot access the {module_code} module. "
            "It holds payroll, financial, HR or biometric data."
        )

    # 3. THE WRITE-LEVEL CHECK — the same rule an ordinary org member gets a few
    #    lines further down, applied to the level a platform role holds instead
    #    of skipped.
    #
    #    BE HONEST ABOUT WHAT THIS DOES TODAY: `PLATFORM_MODULE_LEVEL` is ADMIN,
    #    and `level_satisfies(ADMIN, EDITOR, m)` is True for all twelve modules,
    #    so this rule REFUSES NOTHING right now. It is not theatre for two
    #    reasons worth writing down rather than discovering:
    #
    #      · It puts the platform branch THROUGH the enforcement point instead
    #        of around it. The old bare `return` meant that raising the bar for
    #        writes — a rung above Editor, a per-module rung, anything — would
    #        silently not apply to the ten platform accounts, and nobody would
    #        find out. Now the rung is decided in one place for everyone.
    #      · `level_satisfies` is NOT a plain hierarchy on the separated-duty
    #        modules: `level_satisfies(ADMIN, APPROVER, "vetana")` is False,
    #        because whoever defines what people are paid must not also release
    #        the money. The moment anything routed through here requires
    #        APPROVER, this line starts refusing, and it refuses correctly.
    if is_write and not level_satisfies(
        PLATFORM_MODULE_LEVEL, EDITOR, module_code
    ):
        return (
            f"The {platform_role} role holds "
            f"{PLATFORM_MODULE_LEVEL.title()} on the {module_code} module, "
            "which does not permit this change."
        )

    return None


def platform_audit_needed(module_code: str, *, is_write: bool) -> bool:
    """Does a crossing of this shape have to leave a row?

    TWO triggers, and the gap between them is a deliberate, measured decision
    rather than an oversight:

      · every WRITE. This is the new one and it is the fix. A platform role
        changing a customer's data is rare — 16 sensitive-module writes across
        the whole audit log — and it is the exact event that happened with no
        trace.
      · every SENSITIVE module, read or write. Unchanged.

    A non-sensitive READ by a platform role stays silent. That is the standing
    volume decision and it is not mine to reverse in a middleware: this
    dependency guards ~400 endpoints, list and dashboard traffic dominates them,
    and a row per read would bury the ~330 warn-severity rows that carry the
    signal underneath a flood of routine GETs. Making the audit unreadable is
    itself a security regression.

    THE GAP THAT LEAVES: a platform role reading a NON-sensitive module in an
    org it does not belong to is still silent. After c7494db6 that can only
    happen on the four console prefixes, and of those only `/api/v1/hub/` passes
    through `require_module` — so the residue is Aekam's own agency service
    reading client data. It is recorded in the row we DO write (`member`, below)
    whenever the same request also writes, and it is reported as an open item
    rather than closed here, because closing it means editing a tripwire test
    that asserts this silence on purpose.
    """
    return is_write or module_code in SENSITIVE_MODULES


def platform_audit_row(
    module_code: str, *, is_write: bool, is_member: bool
) -> tuple[str, str] | None:
    """(action, severity) for this crossing, or None if it writes no row.

    Severity separates the two things that look identical in a log and are not:

      · `warn`  — a sensitive module, OR an org the caller does not belong to.
        The second is the spec's actual line: "no one should be able to see any
        other org data even god mode users." An Aekam account operating inside a
        customer org is the event somebody should be able to find in one query.
      · `info`  — an ordinary write by an Aekam account inside an org it is a
        member of. Nine of the ten live platform accounts are members of Aekam
        Inc and of nothing else, so this is what most rows will be, and drowning
        the warns in them would defeat the point of writing any.

    A sensitive crossing is `warn` regardless of membership. Reading a salary
    register is not made routine by belonging to the org.
    """
    if not platform_audit_needed(module_code, is_write=is_write):
        return None
    sensitive = module_code in SENSITIVE_MODULES
    action = SENSITIVE_ACCESS_ACTION if sensitive else PLATFORM_WRITE_ACTION
    severity = "warn" if (sensitive or not is_member) else "info"
    return action, severity


def require_module(module_code: str):
    """Returns a FastAPI dependency that checks if the org has the module active
    AND the user has been granted access to this module."""

    async def _check(request: Request, org_id: str = Depends(get_org_id)):
        # get_org_id depends on require_user, so _auth_user is guaranteed set
        user = getattr(request.state, "_auth_user", None)

        pool = await get_pool()

        # Decided ONCE, and used by both the platform branch and the org-member
        # branch below. Two call sites asking the same question of the same
        # request is how they drift apart.
        is_write = _is_write(request)

        # Platform staff bypass the per-user module GRANT check — they hold no
        # `org_member_modules` row in a customer org and requiring one would
        # lock all ten accounts out of everything. They do NOT bypass the rung
        # that grant would have bought them, and they do not pass unrecorded.
        # See the block above `require_module` for the whole policy; it lives in
        # pure functions so that this branch cannot skip past it.
        if user:
            # A user can hold several platform rows. Order so the strongest
            # wins — otherwise someone who is both platform_admin and
            # account_manager would be refused or admitted at random depending
            # on row order, and the audit row would name the wrong role.
            platform_role = await pool.fetchval(
                "SELECT role_code FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id IS NULL "
                "AND role_code = ANY($2::text[]) "
                "ORDER BY array_position($2::text[], role_code) LIMIT 1",
                user.get("user_id"), list(PLATFORM_ROLE_PRECEDENCE),
            )
            if platform_role:
                # Reach, sensitivity and the write rung, in one call. Every
                # refusal this gate makes for a platform role is in there; there
                # is no second place to look and no path around it.
                refusal = platform_refusal(
                    platform_role, module_code, is_write=is_write
                )
                if refusal:
                    raise HTTPException(403, refusal)

                plan = None
                is_member = False
                if platform_audit_needed(module_code, is_write=is_write):
                    # Membership is looked up ONLY when a row is going to be
                    # written. It costs a round trip, and the common case — a
                    # platform account reading a non-sensitive list — writes no
                    # row and must not pay for one. The whole branch is reachable
                    # by ten accounts, so the cost is bounded either way, but a
                    # query made for a value nobody reads is still a query.
                    #
                    # `ORG_ROLES` rather than three literals, and the same
                    # predicate `org_resolver` uses to decide the question in the
                    # first place — so "is a member" means one thing product-wide.
                    is_member = await pool.fetchval(
                        "SELECT 1 FROM staging.user_roles "
                        "WHERE user_id=$1 AND org_id=$2::uuid "
                        "AND role_code = ANY($3::text[])",
                        user.get("user_id"), org_id, list(ORG_ROLES),
                    )
                    plan = platform_audit_row(
                        module_code,
                        is_write=is_write,
                        is_member=bool(is_member),
                    )

                if plan:
                    action, severity = plan
                    audit(
                        action,
                        request,
                        org_id=org_id,
                        user_id=user.get("user_id"),
                        resource_type="module",
                        resource_id=module_code,
                        detail={
                            "role": platform_role,
                            "path": str(request.url.path),
                            "method": request.method,
                            # Kept verbatim. 312 existing rows carry this key and
                            # whatever reads them must keep matching.
                            "via": "platform_bypass",
                            # New, and the two facts the old row could not
                            # answer: did this request CHANGE anything, and was
                            # the Aekam account even supposed to be in this org.
                            "write": is_write,
                            "member": bool(is_member),
                            "level": PLATFORM_MODULE_LEVEL,
                        },
                        severity=severity,
                    )

                # THE SUBSCRIPTION GATE IS STILL BYPASSED HERE, ON PURPOSE, AND
                # THIS IS THE ONE PIECE OF THE ORIGINAL FINDING LEFT OPEN.
                #
                # Falling through would put platform roles through "is the org a
                # live customer" and "has the org activated this module", which
                # is superficially the obvious hardening. It was measured against
                # the live database (2026-08-05) before being rejected:
                #
                #   · All three orgs — Aekam Inc, Unicode Group, the E2E test org
                #     — have an ACTIVE subscription and ten active modules, so
                #     that half changes nothing for anyone.
                #   · `varta` has NO `module_subscriptions` row in ANY org and
                #     never has (`routers/subscription.py:560` says the same).
                #     `routers/whatsapp.py` is gated `require_module("varta")`.
                #     Falling through therefore takes WhatsApp away from all ten
                #     platform accounts — the only people it currently works for.
                #
                # That is a functional regression, not a hardening: the gate it
                # would newly enforce answers a BILLING question about Aekam's own
                # staff, not a tenancy one, and it was not on the path of the
                # measured chain (`vikray` is active in all three orgs, so this
                # gate would not have stopped that INSERT either). The security
                # content of this branch is the refusal above and the row above
                # it; both now happen. Reversing this is a one-line change —
                # delete the `return` — once `varta` has a row.
                return

        # Gate 2: per-user module grant (before subscription check for fast 403)
        if user:
            user_id = user.get("user_id")
            # org_owner and org_admin get all enabled modules
            org_role = await pool.fetchval(
                "SELECT role_code FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id=$2::uuid "
                "AND role_code IN ('org_owner','org_admin')",
                user_id, org_id,
            )
            if not org_role:
                # org_member needs explicit grant.
                #
                # Reads the LEVEL, not merely the row. This used to be
                # `SELECT 1`, which answered reach — "is there a grant" — and
                # never depth. Since `DEFAULT_GRANT_LEVEL` is `viewer`, every
                # new grant and every invite is created read-only and was then
                # permitted to write on 210 of 234 module-gated write routes.
                # Only ten routes enforced a level, all by hand.
                #
                # The rung is decided by the HTTP verb rather than per route,
                # because 210 hand-classifications is a week of work that would
                # be wrong somewhere, and a rule that lives in one place cannot
                # drift out of sync with the handlers.
                held = await pool.fetchval(
                    "SELECT role FROM staging.org_member_modules "
                    "WHERE user_id=$1 AND org_id=$2::uuid AND module_code=$3",
                    user_id, org_id, module_code,
                )
                if held is None:
                    raise HTTPException(
                        403,
                        f"You don't have access to the {module_code} module. "
                        "Ask your org admin to grant it.",
                    )
                # A row written before the level column existed, or holding a
                # value the ladder does not know, reads as the weakest level.
                # Failing upward would hand write access to every legacy row.
                if held not in LEVELS:
                    held = DEFAULT_GRANT_LEVEL

                if is_write and not level_satisfies(held, EDITOR, module_code):
                    raise HTTPException(
                        403,
                        f"Your {module_code} access is {held.title()}: you can "
                        f"read it, but not change it. Ask an org admin for Editor.",
                    )

        cache_key = f"{org_id}:{module_code}"
        now = datetime.now(timezone.utc)

        if len(_cache) > _CACHE_MAX_SIZE:
            _cache.clear()

        if cache_key in _cache:
            cached_at, is_active = _cache[cache_key]
            if now - cached_at < _CACHE_TTL:
                if not is_active:
                    raise HTTPException(
                        403,
                        f"Module '{module_code}' is not active. "
                        "Contact your administrator to activate it.",
                    )
                return

        sub = await pool.fetchrow(
            "SELECT s.status, p.features FROM staging.subscriptions s "
            "JOIN staging.plans p ON p.id = s.plan_id "
            "WHERE s.org_id=$1::uuid",
            org_id,
        )
        if not sub or sub["status"] in ("cancelled", "paused"):
            _cache[cache_key] = (now, False)
            raise HTTPException(403, "Subscription is not active")

        if module_code in BUNDLED_MODULES:
            features = sub["features"] if isinstance(sub["features"], dict) else {}
            if features.get(module_code):
                _cache[cache_key] = (now, True)
                return
            else:
                _cache[cache_key] = (now, False)
                raise HTTPException(
                    403,
                    f"Module '{module_code}' requires a paid plan. "
                    "Contact your administrator to upgrade.",
                )

        mod = await pool.fetchval(
            "SELECT 1 FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
            org_id, module_code,
        )

        is_active = mod is not None
        _cache[cache_key] = (now, is_active)

        if not is_active:
            raise HTTPException(
                403,
                f"Module '{module_code}' is not active. "
                "Contact your administrator to activate it.",
            )

    return _check


def clear_module_cache(org_id: str = None):
    """Clear cache when subscription changes. Call after activate/deactivate."""
    if org_id:
        keys = [k for k in _cache if k.startswith(f"{org_id}:")]
        for k in keys:
            del _cache[k]
    else:
        _cache.clear()
