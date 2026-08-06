"""
org_resolver.py — Bridge between production team_id and staging org_id.
Production uses text team_id everywhere; staging modules use UUID org_id.
Orgs must be created by a platform admin — no auto-creation.
"""
import logging

import asyncpg
from fastapi import Depends, HTTPException, Request
from db import get_pool
from auth_router import require_user
from middleware.role_tiers import ALL_PLATFORM_ROLES, SUPPORT_ROLES
from outbound import set_org
from services.audit import emit as audit

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
#:   · `sahayak_admin` — `routers/hub.py` depends on `get_org_id` in 44 places.
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
#: account_manager or sahayak_admin from that tuple BREAKS the console rather
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


# ═════════════════════════════════════════════════════════════════════════════
# PLATFORM SUPPORT SESSIONS — the second, independent way through the header.
#
# Authorised by the owner, 2026-08-06: "Build platform support sessions,
# including the scoped X-Org-Id widening in backend/middleware/org_resolver.py".
# That authorises a narrow, approval-gated, time-boxed, audited widening and
# nothing wider, so everything below is written to make the narrowness legible.
#
# THE RULE THAT OUTRANKS EVERYTHING ELSE HERE: SUPPORT ACCESS IS NEVER SILENT.
# `design-handover/11-platform-admin.md` states it as the rule that outranks
# everything else in that file. Opening a session writes to the CUSTOMER'S own
# audit log and mails their owner — see `services/support_session.open_session`,
# where both are inside the transaction that grants the access. This file
# handles the other half: every request a live session admits leaves a row.
#
# WHAT A SESSION IS. A grant the CUSTOMER made: requested by one Aekam account,
# approved by an org_owner or org_admin of that one organisation, capped at
# viewer or editor, scoped to a list of modules, and carrying a clock. It is
# resolved per request from a live SQL predicate and it dies with the request
# that read it. There is no row in `user_roles`, no cached token, no residue.
#
# NOTHING ABOUT THE ROLE CHANGES. `CROSS_ORG_HEADER_ROLES` still excludes
# `platform_support`; `role_tiers.modules_for('platform_support')` still returns
# `frozenset()`. Reach comes from the SESSION, never from the role.
# ═════════════════════════════════════════════════════════════════════════════

#: THE PATHS A SUPPORT SESSION MAY USE, derived from the modules the CUSTOMER
#: approved. A SECOND, INDEPENDENT allow-list.
#:
#: It is not merged into CROSS_ORG_HEADER_PREFIXES and must never be. Those four
#: prefixes are unlocked by a ROLE; these are unlocked by a proven SESSION.
#: Adding a module prefix to the console tuple would hand every one of the seven
#: roles in CROSS_ORG_HEADER_ROLES cross-org reach into the product on the header
#: alone — which is `POST /api/v1/vikray/orders`, the first of the three measured
#: chains this file was narrowed to close.
#:
#: Every prefix here is `require_module`-gated, which is what makes each request
#: a session makes auditable. Derived by reading the routers:
#: `grep -rn 'require_module("' routers/*.py` against the APIRouter prefixes.
SUPPORT_MODULE_PREFIXES: dict[str, tuple[str, ...]] = {
    "graha":   ("/api/v1/graha/",),
    "vikray":  ("/api/v1/vikray/",),
    "prachar": ("/api/v1/prachar/",),          # covers /prachar/ads too
    "dristi":  ("/api/v1/dristi/",),
    "sanvaad": ("/api/v1/messaging/",),
    "esign":   ("/api/v1/esign/",),
    "varta":   ("/api/v1/whatsapp/",),
    "ganit":   ("/api/v1/ganit/", "/api/v1/documents/"),
    "sahayak": ("/api/v1/hub/", "/api/v1/scrapers/"),
}

#: EMPTY, AND IT HAS TO STAY EMPTY. This tuple used to hold two entries and both
#: of them were wrong. It is kept as a named, empty constant rather than deleted
#: so that the reasoning is where the next person would add one back.
#:
#: ── WHAT IT HELD, AND WHAT EACH ONE COST ────────────────────────────────────
#:
#: `"/api/v1/me"` — a STRING PREFIX, not a path segment.
#: `"/api/v1/messaging/channels".startswith("/api/v1/me")` is True, and the shell
#: branch returned True BEFORE it consulted `modules`, so the customer's approved
#: module list was not read at all for those paths. Walking the real route table
#: (741 APIRoutes, recursing `_IncludedRouter.original_router`): the two entries
#: matched 38 routes, of which 11 were intended and 27 WERE THE ENTIRE SANVAAD
#: SURFACE — every route in `routers/messaging.py`, all 27 org-bearing, including
#: `GET /api/v1/messaging/search`, `POST /api/v1/messaging/dm` and
#: `POST /api/v1/messaging/channels/{id}/messages`. A session with ZERO approved
#: modules resolved the customer's org on all of them.
#:
#: And it bought NOTHING for its stated purpose. Measured on the same walk: all
#: six routes under `/api/v1/me/` answer `org=no` — not one of them depends on
#: `get_org_id`, so not one of them was ever asking this function a question.
#: It was pure collision surface.
#:
#: `"/api/v1/org/profile"` — five routes, all org-bearing, NONE `require_module`-
#: gated. `get_profile` returns `_PROFILE_COLUMNS`: name, **gstin, pan, tan,
#: billing_address, bank_details**, email, phone, invoice_note and the rest, and
#: `get_senders` returns every configured from-address for the org's nine
#: purposes. That is the customer's financial identity, handed to an operator the
#: customer approved for NOTHING — with no module gate, so no
#: `platform.sensitive_module_access` row and no level check either.
#:
#: ── WHY THE ANSWER IS "NOTHING OUTSIDE A MODULE SCOPE" ──────────────────────
#:
#: The only defensible rule is that a session reaches what the customer named and
#: not one path more. `/api/v1/org/profile` did not disappear — it moved into
#: `SUPPORT_UNGATED_READ_PREFIXES` under `ganit`, so the customer has to approve
#: the module that holds their books before anybody sees their bank details, and
#: it is admitted for reads only.
SUPPORT_SHELL_PREFIXES: tuple[str, ...] = ()

#: Paths a session may reach that carry NO `require_module`, keyed by the module
#: the CUSTOMER must have approved. READS ONLY — see `_support_path_allowed`.
#:
#: A path with no module gate is a path where `subscription.support_refusal`
#: never runs, so nothing there consults the session's `access_level` and nothing
#: writes a module audit row. A READ in that position is defensible because the
#: resolver still writes one `platform.support_session_access` row naming the
#: path; a WRITE in that position is not, because it would change a customer's
#: record with the level check skipped. So the method is part of the rule.
#:
#: `ganit` for `/api/v1/org/profile` is not a convenience. The org's GSTIN, PAN,
#: TAN, billing address and bank details ARE the finance module's subject
#: matter — `pages/ganit/_shared.jsx` and `InvoiceForm.jsx` both fetch that row
#: to put the seller on an invoice — and `ganit` is the one sensitive module a
#: session may lift, which is exactly the deliberate, customer-approved decision
#: this data should sit behind.
#:
#: The three WRITES on that prefix (`PATCH /org/profile`,
#: `PUT /org/profile/senders`, `POST /org/profile/onboarding-complete`) each also
#: carry `require_org_role(*ORG_SETTINGS_ROLES)`, which since the god-mode
#: narrowing needs real membership. That is a second refusal and not the first
#: one: the method rule below refuses them here, before the org is resolved.
SUPPORT_UNGATED_READ_PREFIXES: dict[str, tuple[str, ...]] = {
    "ganit": ("/api/v1/org/profile",),
}

#: The methods that cannot change a record. Everything else is a write.
_SUPPORT_SAFE_METHODS: frozenset[str] = frozenset({"GET", "HEAD", "OPTIONS"})

#: Which modules a session may be requested for AT ALL. The nine above.
#:
#: `vetana` (payroll), `manav` (personnel files) and `pahchan` (face photographs
#: and locations, twice a day) are ABSENT and must stay absent. A support ticket
#: about a payslip is answered by the customer reading their own payslip to you.
#: `subscription.SENSITIVE_MODULES` refuses all four sensitive codes to every
#: non-god-mode platform role; `ganit` is the one a session may lift, because
#: "the invoice run is stuck" is the ticket this feature exists for, and it is
#: sensitive so it writes an audit row on every read as well as every write.
SUPPORT_REQUESTABLE_MODULES: frozenset[str] = frozenset(SUPPORT_MODULE_PREFIXES)

#: Modules where a session is capped at VIEWER whatever the customer approved.
#: An `editor` on these does not change a record — it SENDS, in the customer's
#: name, to the customer's contacts. Enforced in `subscription.support_refusal`.
SUPPORT_READ_ONLY_MODULES: frozenset[str] = frozenset({"prachar", "varta", "sanvaad"})


_SUPPORT_TABLE_ABSENT_LOGGED = False

#: READ THE VIEW, NEVER THE TABLE. `staging.v_active_support_sessions` is the one
#: place the four live-ness clauses are written — approved, not denied, not
#: revoked, and a clock that is either in the future or absent (a NULL expiry is
#: UNTIL REVOKED and is LIVE, not expired). A predicate re-derived at a call site
#: drifts, and the drift is always permissive: the clause a reader forgets is one
#: that EXCLUDES rows. `tests/test_support_sessions.py` asserts the view still
#: carries all four, and asserts that THIS query names the view and not the table
#: — so dropping `revoked_at IS NULL` from either side fails loudly.
#:
#: POSITIVE in every term: THIS organisation, THIS user, live RIGHT NOW. There is
#: no `NOT revoked` written here and there must never be one.
#:
#: `NOW()` is evaluated BY POSTGRES, on every request. A process that has been up
#: for six hours must not still believe a two-hour session is open, and it cannot,
#: because no timestamp on this path was ever read into Python.
_SUPPORT_SESSION_SQL = """
    SELECT s.id, s.ref, s.modules, s.access_level, s.expires_at, s.approved_by
      FROM staging.v_active_support_sessions s
     WHERE s.org_id = $1::uuid
       AND s.requested_by = $2
     ORDER BY s.approved_at DESC
     LIMIT 1
"""


async def active_support_session(pool, user_id: str, org_id: str, request=None):
    """The live session this user holds IN THIS ORG, or None.

    EVERYTHING MUST WORK WITH THE TABLE ABSENT. That is production's state today
    and stays so until the owner applies `migrations/111_platform_support_sessions.sql`
    by hand. `42P01` means "no sessions", which is the TRUE answer, and it is
    logged ONCE per process — a warning on every request is its own outage.

    NOTHING ELSE IS CAUGHT. A connection failure must not read as "no session";
    it raises, and a raise here refuses. Fail closed.

    Cached on `request.state` when a request is given, because `get_org_id` and
    `subscription.require_module` both ask, and two queries per request for one
    unchanging fact is a cost with no purchase.
    """
    global _SUPPORT_TABLE_ABSENT_LOGGED

    # Lower-cased because `get_org_id` caches under the raw header string and
    # `require_module` asks again under `str(org["id"])`, which is Postgres's
    # canonical lower-case UUID. Both cast to the same `::uuid` in SQL, so a
    # case-sensitive key would only ever cost a second identical query.
    cache_key = (user_id, str(org_id).lower())
    if request is not None:
        cached = getattr(request.state, "_support_session", None)
        if cached is not None and cached[0] == cache_key:
            return cached[1]

    try:
        row = await pool.fetchrow(_SUPPORT_SESSION_SQL, org_id, user_id)
    except asyncpg.UndefinedTableError:
        if not _SUPPORT_TABLE_ABSENT_LOGGED:
            _SUPPORT_TABLE_ABSENT_LOGGED = True
            logger.warning(
                "staging.v_active_support_sessions is absent — migration 111 is "
                "unapplied, so no support session can be live. Logged once."
            )
        row = None

    if request is not None:
        request.state._support_session = (cache_key, row)
    return row


def session_modules(session) -> tuple[str, ...]:
    """The modules on a session row, narrowed to the ones a session may hold.

    Intersected with `SUPPORT_REQUESTABLE_MODULES` rather than trusted, so a row
    written before this tuple was narrowed — or by hand, in psql — cannot carry
    `vetana`. The request endpoint validates on the way in; this validates on the
    way out, and the second one is the one that holds when the first is bypassed.

    A row that does not carry a `modules` field REACHES NOTHING. That is the
    fail-closed answer and it is not a swallow: an empty tuple makes
    `_support_path_allowed` False for every module path, so the request is
    refused. The alternative — letting a KeyError out — turns a malformed row
    into a 500 on an ordinary page load, and a 500 is not a safer refusal than
    a refusal.
    """
    if session is None:
        return ()
    try:
        raw = session["modules"] or ()
    except (KeyError, TypeError, IndexError):
        return ()
    if isinstance(raw, str):
        return ()
    return tuple(m for m in raw if m in SUPPORT_REQUESTABLE_MODULES)


def _path_in(path: str, prefix: str) -> bool:
    """Does `path` lie under `prefix`, ON A SEGMENT BOUNDARY?

    `str.startswith` IS NOT A PATH TEST and this whole feature was leaking
    because it was used as one: `"/api/v1/messaging/channels".startswith(
    "/api/v1/me")` is True, and that one character of overlap put the customer's
    entire Sanvaad inside a shell prefix meant for the caller's own profile.

    So a prefix matches the path itself or a path with a `/` after it, and
    nothing else. `/api/v1/ganit` matches `/api/v1/ganit` and
    `/api/v1/ganit/invoices`; it does not match `/api/v1/ganitx`. The trailing
    slash the constants happen to carry is normalised away rather than relied
    on — depending on every author remembering it is how the collision above got
    written in the first place.
    """
    base = prefix.rstrip("/")
    return path == base or path.startswith(base + "/")


def _support_path_allowed(path: str, modules, method: str = "GET") -> bool:
    """Is this path inside the scope the CUSTOMER approved? Positive only.

    THE MODULE LIST IS CONSULTED FIRST AND ALWAYS. There is no branch above it
    that can return True without reading it — that branch is what
    `SUPPORT_SHELL_PREFIXES` was, and it is empty now.

    `method` decides only whether the ungated reads apply. A route with no
    `require_module` is a route where nothing checks the session's access_level
    and nothing writes a module audit row, so a session may READ one and may
    never write one. Defaults to GET so a caller that forgets to pass the method
    gets the narrower answer, never the wider one.
    """
    mods = tuple(modules or ())
    for module in mods:
        for prefix in SUPPORT_MODULE_PREFIXES.get(module, ()):
            if _path_in(path, prefix):
                return True

    if (method or "GET").upper() in _SUPPORT_SAFE_METHODS:
        for module in mods:
            for prefix in SUPPORT_UNGATED_READ_PREFIXES.get(module, ()):
                if _path_in(path, prefix):
                    return True

    return False


def _audit_support_request(request, org_id: str, user, session) -> None:
    """ONE ROW PER REQUEST A SESSION ADMITS.

    `01-navigation` records that only ganit, manav and vetana log a platform
    bypass and the other nine modules can be read with no trace. This closes it
    for a support session with NO new middleware, because the resolver is already
    the one function every tenant route passes through and it already holds the
    user, the org, the path and the method.

    Fire-and-forget, and this is the ONLY place in this feature where that is
    acceptable: a lost row for one GET is a gap in a trail, whereas a blocking
    audit INSERT on the hot path is a 500 on every request. The rows that must
    NOT be best-effort are the open, the deny and the revoke, and those are
    written INSIDE the transaction that changes the state — see
    `services/support_session.py`, which does not import `services.audit` at all
    for exactly that reason.

    Written once per request. `get_org_id` re-enters through its
    `request.state._org_id` cache for every dependency that asks for the org; a
    row per dependency would be a count of dependencies.
    """
    if getattr(request.state, "_support_audited", False):
        return
    request.state._support_audited = True
    audit(
        "platform.support_session_access",
        request,
        org_id=org_id,
        user_id=user.get("user_id") if isinstance(user, dict) else None,
        resource_type="support_session",
        resource_id=session["ref"],
        detail={
            "path": str(getattr(getattr(request, "url", None), "path", "")),
            "method": getattr(request, "method", None),
            "modules": list(session_modules(session)),
            "access_level": session["access_level"],
            "approved_by": session["approved_by"],
            "expires_at": (
                session["expires_at"].isoformat() if session["expires_at"] else None
            ),
        },
        # An Aekam account operating inside a customer organisation is the event
        # somebody should be able to find in one query. Never `info`.
        severity="warn",
    )


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
        #
        # TWO WAYS THROUGH, TRIED IN THIS ORDER AND NEVER MERGED:
        #   1. the CONSOLE — a platform role, on one of four console prefixes.
        #      Unchanged in every particular.
        #   2. a SUPPORT SESSION — a grant the customer made, on the module
        #      prefixes the customer approved. Tried only after the console
        #      check has already said no, so the console's answer cannot change.
        admitted_session = None
        if not is_member:
            path = getattr(getattr(request, "url", None), "path", "") or ""
            admitted = None

            if _cross_org_path_allowed(path):
                is_platform = await pool.fetchval(
                    "SELECT 1 FROM staging.user_roles "
                    "WHERE user_id=$1 AND org_id IS NULL "
                    "AND role_code = ANY($2::text[])",
                    user["user_id"], list(CROSS_ORG_HEADER_ROLES),
                )
                if is_platform:
                    admitted = "console"

            if admitted is None:
                # A SESSION GRANTS AN ORG, NOT A ROUTE — which is why the org is
                # proven first and the path is checked second, against the module
                # list the customer approved rather than against any tuple of
                # prefixes a platform ROLE unlocks.
                session = await active_support_session(
                    pool, user["user_id"], header_org, request
                )
                if session is not None and _support_path_allowed(
                    path, session_modules(session),
                    getattr(request, "method", "GET"),
                ):
                    # The row is written AFTER the organisation is confirmed
                    # active, a few lines down — an audit row saying access
                    # happened on a request that then 404s is a trail that
                    # disagrees with what occurred.
                    admitted_session = session
                    admitted = "support_session"

            if admitted is None:
                # Deliberately the same sentence a non-platform caller gets. A
                # distinct message here would tell a platform account which
                # routes still accept the header, which is a map of the escape
                # hatch. The log line below is where the distinction lives.
                logger.warning(
                    "cross-org header refused: user=%s org=%s path=%s "
                    "(platform roles may use X-Org-Id only on %s; a support "
                    "session reaches only the modules its customer approved)",
                    user.get("user_id"), header_org, path,
                    ", ".join(CROSS_ORG_HEADER_PREFIXES),
                )
                raise HTTPException(403, "You do not belong to this organisation")
        org = await pool.fetchrow(
            "SELECT id FROM staging.organisations WHERE id=$1::uuid AND is_active=TRUE",
            header_org,
        )
        if not org:
            raise HTTPException(404, "Organisation not found or inactive")
        org_id = str(org["id"])
        # DEACTIVATING THE ORGANISATION CLOSES EVERY SESSION IN IT, with no
        # sweeper and no revocation: this `is_active=TRUE` check is above, and
        # `ON DELETE CASCADE` on `platform_support_sessions.org_id` takes the
        # rows away entirely if the org is deleted.
        if admitted_session is not None:
            _audit_support_request(request, org_id, user, admitted_session)
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
