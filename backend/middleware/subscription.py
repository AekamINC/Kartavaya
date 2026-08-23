"""
subscription.py — Feature gating middleware.
Use require_module("sahayak") as a FastAPI dependency to restrict endpoints
to orgs that have that module active.

Sahayak is a bundled module — included in every paid plan. Other modules
(graha, manav, etc.) are activated per-org by admin.

`require_any_module("graha", "ganit", "vikray")` is the same gate for a record
that more than one module legitimately owns — see its docstring for what "any"
has to mean when the answer is no.
"""
from datetime import datetime, timezone, timedelta
from fastapi import Depends, HTTPException, Request

from db import get_pool
from middleware.org_resolver import (
    SUPPORT_READ_ONLY_MODULES, active_support_session, get_org_id, session_modules,
)
from services.audit import emit as audit
from middleware.role_tiers import (
    ALL_ORG_ROLES, ALL_PLATFORM_ROLES, HR_ADMIN_MODULES, HR_ADMIN_ROLES,
    ORG_MANAGEMENT_ROLES, ORG_ROLES, PLATFORM_ROLE_PRECEDENCE, can_reach_module,
    is_god_mode, refuse_module_for_org_roles,
    ADMIN, DEFAULT_GRANT_LEVEL, EDITOR, LEVELS, level_satisfies,
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

BUNDLED_MODULES = {"sahayak", "esign"}

# Modules holding payroll, financial records, HR files or biometric attendance.
# `pahchan` is here because its rows are face-match scores and selfies against a
# named employee — biometric-adjacent data that is at least as sensitive as the
# HR file it attaches to, and the standing constraints already single it out.
SENSITIVE_MODULES = {"vetana", "ganit", "manav", "pahchan", "kray"}

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


def support_level(module_code: str, session) -> str:
    """The level this session ACTUALLY holds on this module. One definition.

    Written once and read twice — by `support_refusal`, which enforces it, and by
    the audit row, which reports it. When those were two expressions the audit
    row said `admin` for a session the customer had capped at `viewer`, so the
    trail described a grant nobody made.

    `SUPPORT_READ_ONLY_MODULES` wins over whatever the customer approved: an
    `editor` on prachar, varta or sanvaad does not change a record, it SENDS, in
    the customer's name, to the customer's contacts.
    """
    if session is None:
        return PLATFORM_MODULE_LEVEL
    if module_code in SUPPORT_READ_ONLY_MODULES:
        return "viewer"
    return session["access_level"]


def support_refusal(
    module_code: str, session, *, is_write: bool, otherwise: str
) -> str | None:
    """What a CUSTOMER-GRANTED session permits here. None means proceed.

    IT BOTH LIFTS AND CAPS, and the caller must consult it WHENEVER A SESSION IS
    LIVE — not only when the answer would otherwise be no. A session that could
    only ever lift is a session that adds authority and removes none, which is
    the opposite of what the customer pressed Approve on.

    ── WHY THIS FUNCTION HAS TO EXIST ──────────────────────────────────────────
    `can_reach_module('platform_support', anything)` is False by design, and
    `role_tiers.modules_for` keeps it that way, so `platform_refusal` refuses a
    support agent on EVERY `require_module` route. Widening `org_resolver` alone
    would therefore produce a feature that is both useless and leaky at once:
    the operator gets 403 on the invoice screen they were let in for, while
    `/api/tasks/bulk` (no module gate at all) and `/api/v1/search` (cross-module
    record search) have no `require_module` to refuse them. The second half is
    closed in `org_resolver.SUPPORT_MODULE_PREFIXES`, which does not list either
    path. This is the first half.

    REACH STILL COMES FROM THE SESSION, NEVER FROM THE ROLE. `otherwise` — the
    refusal `platform_refusal` already produced — is returned unchanged whenever
    there is no live session, so with the table absent (production's state
    today) this function changes nothing for anybody.

    THREE THINGS IT WILL NOT LIFT:
      · a module the customer did not approve. `session_modules` re-filters the
        row against `SUPPORT_REQUESTABLE_MODULES`, so `vetana`, `manav` and
        `pahchan` cannot be lifted even by a row typed in by hand in psql. Since
        the cap below, they are also not reachable by a role that would have had
        them anyway.
      · a WRITE by a `viewer`. That is the cap RBAC-SPEC:19 asks for, applied to
        the level the customer chose rather than to `PLATFORM_MODULE_LEVEL`.
      · a write on `prachar`, `varta` or `sanvaad` at ANY approved level. An
        editor there does not change a record — it SENDS, in the customer's
        name, to the customer's contacts.
    """
    if session is None:
        return otherwise

    # ── A SESSION CAPS AS WELL AS LIFTS ─────────────────────────────────────
    #
    # This used to `return otherwise` here, and `otherwise` is None whenever the
    # operator's platform ROLE already reaches the module. Combined with the
    # caller below only consulting this function when `platform_refusal` had
    # already said no, the customer's choices were never applied to anybody who
    # did not need them: measured, a `platform_staff` holding a
    # `graha / viewer / 2 hours` session was ALLOWED to POST to graha, vikray,
    # prachar, sahayak, dristi and sanvaad, with the audit row recording
    # `level: 'admin'` and no session ref at all. The customer approved Viewer on
    # one module and granted Admin write on six.
    #
    # So the rule is stated the only way it can be true: INSIDE AN ORG THE
    # OPERATOR IS NOT A MEMBER OF, A LIVE SESSION IS THE WHOLE OF THEIR
    # AUTHORITY. A module the customer did not name is refused even if the role
    # would have reached it, which is what "the customer decides" has to mean.
    #
    # `session_modules` re-filters the row against SUPPORT_REQUESTABLE_MODULES,
    # so `vetana`, `manav` and `pahchan` land here as "not named" and are refused
    # whatever a hand-written row says.
    if module_code not in session_modules(session):
        return (
            f"This support session covers "
            f"{', '.join(session_modules(session)) or 'no modules'}, "
            f"which does not include {module_code}."
        )

    level = support_level(module_code, session)

    if is_write and level != EDITOR:
        return (
            f"This support session holds {level.title()} on {module_code}"
            + (" (sending modules are read-only for support)"
               if module_code in SUPPORT_READ_ONLY_MODULES else "")
            + ", which does not permit this change."
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


# ══════════════════════════════════════════════════════════════════════════════
# WHY A REFUSAL FROM THIS GATE CARRIES A STAGE
#
# `require_module` refuses for seven different reasons and says so in seven
# different sentences, all of them 403. One gate asking one question can throw
# the reason away; `require_any_module` asks the same question of several
# modules and then has to CHOOSE which of several refusals to show a person, and
# choosing by matching on English prose is a bug waiting for a copy-edit.
#
# So the reason travels as data alongside the sentence. `ModuleRefusal` IS an
# `HTTPException` with the same status and the same `detail`, so every existing
# `except HTTPException`, every `pytest.raises(HTTPException)` and every response
# body is unchanged. Nothing outside this file needs to know it exists.

#: Refusal stages, FARTHEST from admitted first. The ORDER is the policy — see
#: `_nearest_refusal`. Read it as "how close did this caller get to yes".
REFUSAL_STAGES: tuple[str, ...] = (
    "subscription",     # the org is not a live customer at all
    "support",          # the customer's own support session does not cover this
    "platform",         # an Aekam role may not reach this module
    "ceiling",          # this org role is capped below every module
    "module_inactive",  # the org has never activated this module
    "no_grant",         # the org has it; this person was not granted it
    "level",            # this person HOLDS it, one rung below Editor
)


class ModuleRefusal(HTTPException):
    """A 403 from the module gate, with the reason as data as well as prose."""

    def __init__(self, detail: str, *, stage: str, module_code: str):
        super().__init__(403, detail)
        self.stage = stage
        self.module_code = module_code


def require_module(module_code: str):
    """Returns a FastAPI dependency that checks if the org has the module active
    AND the user has been granted access to this module.

    `module_code` is used exactly as written. It briefly went through an alias
    map so the Srijan → Sahayak rename could ship in three deploys; the rows
    moved in `migrations/108_srijan_to_sahayak.sql` and the map is gone. The
    header of `role_tiers.ALL_MODULES` records the order that rename had to run
    in, and the one way it still went wrong.
    """

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

                # ── MEMBERSHIP, DECIDED BEFORE ANYTHING USES IT ──────────────
                #
                # This lookup used to happen only when an audit row was going to
                # be written, which saved a query on non-sensitive reads. It has
                # to move up, because it is now the question that decides whether
                # a support session is consulted at all — and "is this Aekam
                # account even supposed to be in this org" is the right thing to
                # ask first in a gate whose whole subject is cross-tenant access.
                #
                # `ORG_ROLES` rather than three literals.
                #
                # DELIBERATELY THE NARROW SET, and no longer identical to the
                # one `org_resolver` uses — which is now `ORG_TENANT_ROLES`,
                # because a project-only holder has to be able to resolve their
                # own organisation. Here the answer SUPPRESSES the support-session
                # lookup, so widening it would mean an Aekam account that holds a
                # free `aekam_team` row in a customer's org stops needing the
                # customer's approval to cross into that org's modules. The two
                # questions read the same in English and are opposite in effect:
                # "may they name this org" wants every tenant code, "have they
                # already been vouched for" wants only the paid ones.
                is_member = bool(await pool.fetchval(
                    "SELECT 1 FROM staging.user_roles "
                    "WHERE user_id=$1 AND org_id=$2::uuid "
                    "AND role_code = ANY($3::text[])",
                    user.get("user_id"), org_id, list(ORG_ROLES),
                ))

                # ── THE SESSION IS READ WHETHER OR NOT THE ROLE NEEDS IT ─────
                #
                # This was `if refusal:` — the session was looked up only when the
                # answer would otherwise have been no. That made the customer's
                # `access_level` and module list dead code for every platform role
                # that already reached the module by role, which is 4 of the 8:
                # measured, `platform_refusal` answers ALLOW for platform_staff,
                # platform_manager, platform_admin and platform_owner on graha,
                # sanvaad and prachar, so the `if` never fired and `support`
                # stayed None. A customer who approved "graha, view only, 2 hours"
                # had in fact granted admin write across STAFF_MODULES.
                #
                # NON-MEMBERS ONLY, and that is the whole of the cost control.
                # An Aekam account acting inside its OWN org (nine of the ten live
                # platform accounts are members of Aekam Inc and nothing else)
                # takes the same one membership query it already paid for and no
                # session query at all — so the common path is unchanged, and so
                # is every deployment where migration 111 is unapplied.
                # `active_support_session` answers None on 42P01 and caches on
                # `request.state`, so this is at most one extra query per request
                # for an operator who is genuinely inside a customer's org.
                support = None
                if not is_member:
                    support = await active_support_session(
                        pool, user.get("user_id"), org_id, request
                    )
                refusal = support_refusal(
                    module_code, support, is_write=is_write, otherwise=refusal
                )
                if refusal:
                    # The stage names WHOSE rule refused: the customer's own
                    # session, or the platform role ladder. `support_refusal`
                    # returns `otherwise` unchanged when no session is live, so
                    # a live session is exactly when the sentence is the
                    # customer's.
                    raise ModuleRefusal(
                        refusal,
                        stage="support" if support else "platform",
                        module_code=module_code,
                    )

                plan = None
                if platform_audit_needed(module_code, is_write=is_write):
                    plan = platform_audit_row(
                        module_code,
                        is_write=is_write,
                        is_member=is_member,
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
                            "member": is_member,
                            # THE LEVEL THE SESSION ACTUALLY HOLDS, from the same
                            # function that enforced it a few lines up. Reading
                            # `access_level` straight off the row here is what
                            # made the trail claim `admin` on a session the
                            # customer had capped at `viewer`.
                            "level": support_level(module_code, support),
                            # Present only when a customer-granted session is
                            # what let this request through. The ref is the
                            # token the customer's approval mail and their own
                            # audit log both name, so the two trails join.
                            **({"support_session": support["ref"]}
                               if support else {}),
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

            # ── EVERY Tier-2 row, and the ceiling before anything else ────────
            #
            # This used to be one `fetchval` over the two literals
            # `('org_owner','org_admin')`, which answered "does this caller get
            # every enabled module for free" and nothing more. Three Tier-2 codes
            # now exist that it could not see, and two of them are roles whose
            # entire definition is a CEILING rather than a grant:
            #
            #   hr_admin              Manav and Pahchan, in their own org.
            #   org_client            the project. Nothing else.
            #   aekam_team            the project. Nothing else.
            #
            # A ceiling that is not applied in THIS function is not applied at
            # all — every module router in the product hangs on `require_module`,
            # and it is the only gate all twelve share. So the refusal is made
            # here, from `role_tiers`, before the grant table is consulted:
            # a capped caller must not be able to reach a module by holding a
            # grant row for it.
            #
            # Costs the same as before for existing data. Measured on the live
            # database 2026-08-06: `staging.user_roles` holds 28 org-scoped rows
            # across exactly the three original codes, so `module_ceiling_for`
            # answers None for every one of them and this branch behaves
            # identically to the `fetchval` it replaces.
            org_role_rows = await pool.fetch(
                "SELECT role_code FROM staging.user_roles "
                "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
                user_id, org_id, list(ALL_ORG_ROLES),
            )
            org_roles = [r["role_code"] for r in org_role_rows]

            ceiling_refusal = refuse_module_for_org_roles(org_roles, module_code)
            if ceiling_refusal:
                raise ModuleRefusal(
                    ceiling_refusal, stage="ceiling", module_code=module_code)

            # org_owner and org_admin get all enabled modules. So does an
            # hr_admin, WITHIN its ceiling — they administer those two modules,
            # which is the role, and requiring a grant row on top would mean the
            # role granted nothing on its own.
            org_role = (
                any(r in ORG_MANAGEMENT_ROLES for r in org_roles)
                or (
                    any(r in HR_ADMIN_ROLES for r in org_roles)
                    and module_code in HR_ADMIN_MODULES
                )
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
                    raise ModuleRefusal(
                        f"You don't have access to the {module_code} module. "
                        "Ask your org admin to grant it.",
                        stage="no_grant",
                        module_code=module_code,
                    )
                # A row written before the level column existed, or holding a
                # value the ladder does not know, reads as the weakest level.
                # Failing upward would hand write access to every legacy row.
                if held not in LEVELS:
                    held = DEFAULT_GRANT_LEVEL

                if is_write and not level_satisfies(held, EDITOR, module_code):
                    raise ModuleRefusal(
                        f"Your {module_code} access is {held.title()}: you can "
                        f"read it, but not change it. Ask an org admin for Editor.",
                        stage="level",
                        module_code=module_code,
                    )

        cache_key = f"{org_id}:{module_code}"
        now = datetime.now(timezone.utc)

        if len(_cache) > _CACHE_MAX_SIZE:
            _cache.clear()

        if cache_key in _cache:
            cached_at, is_active = _cache[cache_key]
            if now - cached_at < _CACHE_TTL:
                if not is_active:
                    raise ModuleRefusal(
                        f"Module '{module_code}' is not active. "
                        "Contact your administrator to activate it.",
                        stage="module_inactive",
                        module_code=module_code,
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
            # The one refusal that is true of every module at once, which is
            # why `require_any_module` can pass it straight through.
            raise ModuleRefusal(
                "Subscription is not active",
                stage="subscription", module_code=module_code)

        if module_code in BUNDLED_MODULES:
            features = sub["features"] if isinstance(sub["features"], dict) else {}
            if features.get(module_code):
                _cache[cache_key] = (now, True)
                return
            else:
                _cache[cache_key] = (now, False)
                raise ModuleRefusal(
                    f"Module '{module_code}' requires a paid plan. "
                    "Contact your administrator to upgrade.",
                    stage="module_inactive",
                    module_code=module_code,
                )

        mod = await pool.fetchval(
            "SELECT 1 FROM staging.module_subscriptions "
            "WHERE org_id=$1::uuid AND module_code=$2 AND is_active=TRUE",
            org_id, module_code,
        )

        is_active = mod is not None
        _cache[cache_key] = (now, is_active)

        if not is_active:
            raise ModuleRefusal(
                f"Module '{module_code}' is not active. "
                "Contact your administrator to activate it.",
                stage="module_inactive",
                module_code=module_code,
            )

    return _check


def _nearest_refusal(
    refusals: list[ModuleRefusal], *, subject: str | None
) -> ModuleRefusal:
    """Of several 403s, the ONE a person should be shown.

    See `require_any_module` for the argument. Three cases, in order:

      1. every module refused with the SAME sentence — say it. This is the
         `subscription` case and it is the common one: "Subscription is not
         active" is a fact about the org, not about a module, so all three
         answers collapse to one and no choosing is needed.
      2. one module got the caller strictly nearer than the others — say ITS
         sentence, verbatim. Nearest is defined by `REFUSAL_STAGES`, and the
         point is that the sentence is then ACTIONABLE: "Your ganit access is
         Viewer … ask an org admin for Editor" is a door that opens, where
         "you don't have the graha module" would send the same person to buy a
         CRM they do not want.
      3. a tie — several modules refused at the same stage, which is what a
         caller holding NONE of them looks like. Now no module may be named:
         every one of them is equally far away, and naming the first is how a
         Finance-only firm gets told to buy CRM. `subject` names the DATA
         instead, and the action ("ask your org admin") is true whichever
         module the org actually owns. Without a `subject` there is nothing
         truer to say than the first refusal, so that is the fallback.

    A `level` tie is deliberately NOT case 3: a caller who is Viewer on two
    modules is one Editor grant from writing, and naming either module is a
    door that opens. Case 3 is only for the stages that mean "no way in".
    """
    rank = {stage: i for i, stage in enumerate(REFUSAL_STAGES)}
    best = max(refusals, key=lambda r: rank.get(r.stage, -1))

    if all(r.detail == best.detail for r in refusals):
        return best

    tied = [r for r in refusals if r.stage == best.stage]
    if len(tied) == 1 or best.stage == "level" or not subject:
        return best

    return ModuleRefusal(
        f"You don't have access to {subject}. Ask your org admin to grant "
        f"you a module that includes {subject}.",
        stage=best.stage,
        module_code=best.module_code,
    )


def require_any_module(*codes: str, subject: str | None = None):
    """Like `require_module`, but ANY ONE of `codes` is enough.

    ── WHY THIS EXISTS ─────────────────────────────────────────────────────
    A `graha_clients` row is not a CRM record that Finance borrows. It is THE
    company record for the whole product: an invoice bills it, a sales order
    belongs to it, and a contact's `client_id` points at it. Three modules own
    the same object, and `require_module("graha")` said only the first of them
    may open it — so a firm that bought Ganit and not the CRM got a 403 on its
    own customer list.

    ── IT DOES NOT FORK `require_module` ───────────────────────────────────
    Each code gets a real `require_module` dependency, built once here and then
    CALLED, in order, until one of them returns. Everything that gate does —
    the platform-role ladder, the sensitive-module refusal, the customer's
    support session, the org-role ceiling, the grant level, the write rung, the
    subscription check and the module cache — happens exactly as it does for a
    single-module route, because it IS that code running.

      · AUDIT ROWS STAY HONEST. `require_module` writes its platform-crossing
        row only AFTER the refusal check passes, so a code that refuses writes
        nothing. Exactly one row is written, naming the module that actually
        admitted the caller.
      · ORDER IS THE OWNING MODULE FIRST. It decides only which module an
        admitted platform crossing is recorded against, and which sentence a
        lone refusal carries — never who gets in, because a pass on any code
        is a pass.
      · COST. One extra round of queries per code that refuses BEFORE the one
        that passes. A refusal on the grant check is two queries and no
        subscription lookup, and `_cache` is shared, so the realistic worst
        case on a two-code gate is one extra `user_roles` fetch.

    ── WHAT "ANY" HAS TO MEAN WHEN THE ANSWER IS NO ────────────────────────
    A caller holding none of the codes has produced several different 403s, and
    the tempting answer — concatenate them — is the wrong one twice over. It
    reads as a price list ("buy CRM, Finance or Sales"), and it is usually not
    even the caller's problem: they are far more likely to be a viewer, or
    ungranted, inside an org that already pays for one of them. `_nearest_refusal`
    picks the single sentence that is both true and actionable, and falls back
    to naming the DATA rather than any module when every door is equally shut.
    `subject` is that name — a plain-English noun phrase such as
    "clients and contacts", never a module code.

    Returns the module code that admitted the caller, so a handler that wants
    to know which door it came through can take the dependency's value.
    """
    if not codes:
        raise ValueError("require_any_module needs at least one module code")

    gates = [(code, require_module(code)) for code in codes]

    async def _check(request: Request, org_id: str = Depends(get_org_id)):
        refusals: list[ModuleRefusal] = []
        for code, gate in gates:
            try:
                # `org_id` is passed explicitly: `Depends` is resolved for
                # ROUTES only, and a direct call would otherwise hand the inner
                # check the sentinel object instead of the org.
                await gate(request, org_id=org_id)
                return code
            except ModuleRefusal as refusal:
                refusals.append(refusal)
        raise _nearest_refusal(refusals, subject=subject)

    return _check


def clear_module_cache(org_id: str = None):
    """Clear cache when subscription changes. Call after activate/deactivate."""
    if org_id:
        keys = [k for k in _cache if k.startswith(f"{org_id}:")]
        for k in keys:
            del _cache[k]
    else:
        _cache.clear()
