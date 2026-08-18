"""
server.py — Kartavaya API v2 by Aekam Inc
Monolith routes stay; new v2 routers mounted at the bottom.
R2 upload router replaces the old base64 /api/upload endpoint.

Bug fixes (2026-05-14):
  FIX #4: get_visible_team_ids now UNIONs team_members so users who
          were invited and registered after the invite (no project_assignments
          row) can still see their teams.
  FIX #5: update_team_member guards the project_assignments role UPDATE
          with `if payload.role` to avoid writing NULL when only status
          is being changed.
"""

import asyncio
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import asyncpg
import sentry_sdk
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.cors import CORSMiddleware

# .env MUST load before any app module is imported. auth_router raises at import
# time when JWT_SECRET is unset, and it used to be imported ~64 lines before
# load_dotenv() ran further down this file — so the server could only ever start
# when the variables were already exported by the shell. Railway exports them, so
# this was invisible in deployment and fatal locally: `uvicorn server:app` died
# with "JWT_SECRET environment variable must be set" while .env sat right there.
_ROOT_DIR = Path(__file__).parent
load_dotenv(_ROOT_DIR / ".env")

from auth_router import require_user, JWT_SECRET as _JWT_SECRET
from limiter import limiter
from auth_router import router as auth_router
from middleware.roles import (require_platform_role, is_org_admin, admin_org_id,
                              is_portal_client)
# The ONE org resolver. `active_org_id` below wraps it rather than reimplementing
# it — a second resolution path is a second set of header rules to keep in step.
from middleware.org_resolver import get_org_id

_require_admin = require_platform_role("platform_admin", "account_manager")
from invite_router import router as invite_router
from approvals_router import router as approvals_router
from db import close_pool, get_pool
from health import router as health_router
# The outbound log buffers in memory and is drained by the shutdown hook below,
# BEFORE close_pool() — see that hook. Imported here rather than inside it so an
# import error surfaces at boot instead of at the one moment rows are at risk.
from services import outbound_log
# Aliased because `audit` is a common local name in this 6k-line module and a
# shadowed import fails at the call site rather than at the import.
from services.audit import emit as _audit_emit

# ── v2 routers ────────────────────────────────────────────
from routers.fields      import router as fields_router
from routers.views       import router as views_router
from routers.activity    import router as activity_router
from routers.dashboards  import router as dashboards_router
from routers.templates   import router as templates_router
from routers.time_entries import router as time_router
from routers.uploads     import router as uploads_router   # R2-backed upload
from routers.reports        import router as reports_router
from routers.documents      import router as documents_router  # generated PDFs
from routers.task_reminders import router as task_reminders_router
from routers.subscription   import router as subscription_router
from routers.hub            import router as hub_router
from routers.admin_orgs     import router as admin_orgs_router
from routers.billing        import router as billing_router
from routers.hub_chat       import router as hub_chat_router
from routers.hub_publish    import router as hub_publish_router
from routers.hub_connectors import router as hub_connectors_router
from routers.lead_sources   import router as lead_sources_router
from routers.graha          import router as graha_router
from routers.ganit          import router as ganit_router
from routers.manav          import router as manav_router
from routers.vikray         import router as vikray_router
from routers.vetana         import router as vetana_router
from routers.analytics      import router as analytics_router
from routers.dristi         import router as dristi_router
from routers.prachar        import router as prachar_router
from routers.prachar_ads    import router as prachar_ads_router
from routers.esign          import router as esign_router
from routers.org_members    import router as org_members_router
from routers.org_invites    import router as org_invites_router
from routers.pahchan_attendance import router as pahchan_attendance_router
from routers.org_profile    import router as org_profile_router
from routers.org_switch     import router as org_switch_router
from routers.org_modules    import router as org_modules_router
from routers.org_security   import router as org_security_router
from routers.scrapers       import router as scrapers_router
# Imported at module scope on purpose. A local import inside the startup wrapper
# would turn a renamed symbol into a caught-and-logged line at boot, i.e. a
# silently disabled refund path; here it fails the process loudly instead.
from routers.scrapers       import sweep_stranded_runs
from routers.scheduler      import router as scheduler_router
from routers.niyam          import router as niyam_router
from routers.niyam_rules    import router as niyam_rules_router
from routers.messaging      import router as messaging_router
from routers.sanvaad_sahayak import router as sanvaad_sahayak_router
from routers.whatsapp       import router as whatsapp_router
from routers.pahchan        import router as pahchan_router
from routers.me             import router as me_router
from routers.audit          import router as audit_router
from routers.search         import router as search_router
from routers.tasks_bulk     import router as tasks_bulk_router
from routers.pay           import router as pay_router
from routers.sync          import router as sync_router
from services.gita            import get_verse_of_the_day
from services.web_push_service import (
    is_configured as wp_is_configured,
    save_subscription as wp_save_subscription,
    remove_subscription as wp_remove_subscription,
    send_web_push,
    fan_out_web_push,
    VAPID_PUBLIC_KEY as VAPID_PUB,
)
from services.expo_push_service import send_expo_push, fan_out_expo_push
from utils import SQL_USER_ROLE

# ── Shared constants ──────────────────────────────────────
_NOT_TEAM_MEMBER  = "Not a team member"
# Single definition for the COALESCE name expression used across all queries.
_COALESCE_NAME    = "COALESCE(full_name, name, email)"
_SQL_USER_ROLE    = SQL_USER_ROLE          # local alias kept for backward compat
_SQL_GET_SUBTASKS = "SELECT subtasks,team_id FROM tasks WHERE task_id=$1 AND team_id=ANY($2::text[])"
_SQL_SET_SUBTASKS = "UPDATE tasks SET subtasks=$1,updated_at=NOW() WHERE task_id=$2 AND team_id=ANY($3::text[]) RETURNING *"

ROOT_DIR = Path(__file__).parent

# Whitelist for column names used in dynamic SQL fragments — never interpolate user input
_VALID_SCOPE_COLS: frozenset = frozenset({"team_id", "user_id"})

# Per-task team_ids cache: keyed by (asyncio_task_id, user_id) so concurrent requests
# never share entries. Entries are removed after each request completes.
_team_ids_request_cache: dict = {}

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# httpx logs every outbound request LINE at INFO — method, full URL, query string
# and all. That is how the Apify API key reached the deploy log: the token rode
# in `?token=`, and the status poll fires one request every six seconds for the
# length of a scrape.
#
# The keys have been moved into headers (services/apify.py, ai_router.py,
# rag.py, provider_costs.py), so this is the second lock rather than the fix —
# a future call that puts something sensitive in a URL should not publish it by
# default. WARNING still carries genuine transport failures.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


def _bg(coro, *, label: str = "background") -> asyncio.Task:
    """Schedule *coro* as a fire-and-forget background task.
    Any exception it raises is caught and logged rather than becoming an
    unhandled asyncio exception that would silently pollute stderr.

    NOTE: asyncio tasks are in-process only. A Railway dyno restart drops all
    pending _bg() tasks silently. For critical side-effects (approval emails,
    automation triggers) that must survive restarts, persist the intent to a DB
    queue table first, then process from a cron worker. This is a known
    limitation — do not add new critical workflows as bare _bg() calls.
    """
    async def _run() -> None:
        try:
            await coro
        except Exception as exc:
            logger.warning("background task '%s' failed: %s", label, exc)
    return asyncio.create_task(_run())

# Defined ABOVE the Sentry init, deliberately. The init used to carry its own
# copy — `os.environ.get("ENVIRONMENT", os.environ.get(…))` — which returns ""
# for a variable that is SET BUT EMPTY, the exact trap this helper exists to
# close and which the comment above documents at length for the docs switch.
# Every Sentry event would have been filed under an empty environment, and an
# alert that cannot say whether it came from staging or production is nearly
# useless when the two share a database.
def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or "").strip() or default

_ENVIRONMENT = (_env("ENVIRONMENT") or _env("RAILWAY_ENVIRONMENT") or "production").casefold()

# ── THE ERROR SINK, AND WHY IT IS CONFIGURED THIS HEAVILY ───────────────────
#
# Unset until 2026-08-16, so every log.exception in this product went to the
# Railway log stream and nothing alerted. `PATCH /api/tasks/{id}` 500'd for
# every user for ten days and was found by accident.
#
# The defaults are the danger. Measured against the pinned SDK:
#   · include_local_variables defaults TRUE — every frame's locals are
#     serialized, so a 500 in payroll or CRM ships salary figures, PAN and
#     rendered email bodies. A regex cannot save this: a short plaintext
#     password inside a model repr has no pattern. It must be OFF, not filtered.
#   · request BODIES are attached regardless of send_default_pii — only cookies
#     and identity are PII-gated — bounded only by a 10 KB default.
#   · LoggingIntegration is a DEFAULT integration, so every logger.error becomes
#     an event; four of this backend's error lines interpolate a recipient's
#     email address.
#   · SQL breadcrumbs are added unconditionally, from a database production
#     shares.
#
# See `sentry_scrub.py` for what still gets through, which is not nothing.
_SENTRY_DSN = os.environ.get("SENTRY_DSN")
if _SENTRY_DSN:
    import logging as _logging

    import sentry_scrub
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.scrubber import DEFAULT_DENYLIST, EventScrubber

    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        environment=_ENVIRONMENT,
        # Falls back rather than failing: without a release an issue cannot be
        # attributed to a deploy, and production and staging are 1,000+ commits
        # apart.
        release=os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "unknown",
        server_name="kartavaya-api",

        # The four that actually stop the bleeding.
        include_local_variables=False,
        include_source_context=False,
        max_request_body_size="never",
        send_default_pii=False,

        # Tracing off until the scrubbing has been watched on a real project —
        # transaction events take a SEPARATE hook and multiply volume.
        traces_sample_rate=0.0,
        profiles_sample_rate=0.0,
        attach_stacktrace=False,
        max_value_length=512,
        max_breadcrumbs=20,

        # level=WARNING kills the INFO breadcrumb trail, which carries recipient
        # addresses and the database user. event_level=ERROR is KEPT: this
        # backend has no capture_exception calls and hundreds of handlers that
        # log rather than re-raise, so without it Sentry would see only the
        # exceptions that escape the ASGI app — a minority of real failures.
        integrations=[LoggingIntegration(level=_logging.WARNING,
                                         event_level=_logging.ERROR)],

        # recursive=True: the SDK default is False, so nested dicts leak. The
        # denylist is EXACT-KEY, so every variant has to be spelled out —
        # "x_cron_secret" does not match "secret".
        event_scrubber=EventScrubber(
            recursive=True,
            denylist=DEFAULT_DENYLIST + [
                "email", "to_email", "from_email", "employee_email",
                "recipient", "recipients", "signer", "contact",
                "user_id", "org_id", "team_id", "client_id", "member_id",
                "invite_id", "invite_link", "invite_token", "entity_id",
                "x_cron_secret", "cron_secret", "x_dispatch_secret",
                "request_secret", "expected", "x_org_id",
                "jwt", "access_token", "refresh_token",
                "password_hash", "salt", "new_password", "current_password",
                "old_password", "body", "payload", "user", "dsn",
                "signed_url", "presigned_url", "html_content", "raw",
            ],
        ),
        before_send=sentry_scrub.before_send,
        before_send_transaction=sentry_scrub.before_send_transaction,
        before_breadcrumb=sentry_scrub.before_breadcrumb,
    )

# ── Interactive API docs: on everywhere except production ────────────────────
#
# /docs and /openapi.json were reachable on production WITH NO CREDENTIAL,
# serving 116 endpoint paths and 54 data schemas — including the whole
# /api/admin/* surface, request and response shapes, and every field name.
#
# That is not itself a vulnerability: the endpoints behind it still require auth.
# It is reconnaissance. It hands anyone the complete map of what to attack, which
# fields exist on a payslip, and which admin routes to try first — for a product
# holding payroll and bank details.
#
# Staging KEEPS them: they are how the API gets exercised by hand, and staging is
# the environment that exists to be poked at. The switch is an explicit env var
# rather than a code change, so it can be turned on for an hour to debug
# production and back off again without a deploy.
# os.environ.get(k, default) returns "" for a var that is SET BUT EMPTY, not the
# default — and an empty ENVIRONMENT is easy to end up with in a Railway config.
# Read naively, "" != "production" and the docs come back on in production. This
# has to fail CLOSED, so empty is treated as unset.
#
# The empty case was fixed. The SPELLING case was not, and it reopened the same
# hole: `_ENVIRONMENT != "production"` is a denylist with exactly one entry, so
# every value that is not that precise 10-character lowercase string turned the
# docs back on. Measured, before this change:
#
#     ENVIRONMENT=production   docs off
#     ENVIRONMENT=Production   DOCS ON      <- Railway environment names are
#     ENVIRONMENT=PRODUCTION   DOCS ON         free text and are title-cased by
#     ENVIRONMENT=prod         DOCS ON         hand all the time
#     ENVIRONMENT=main         DOCS ON
#     ENVIRONMENT=live         DOCS ON
#
# `RAILWAY_ENVIRONMENT` carries whatever the environment was NAMED in the
# dashboard, so "Production" is not a hypothetical typo — it is what you get by
# creating the environment through the UI and capitalising it.
#
# So the test is inverted into an ALLOWLIST. Docs are served only when the
# environment is a name we recognise as non-production. Anything unrecognised —
# a new environment name, a typo, a capitalisation, an empty value, a variable
# that never got set — is treated as production and serves nothing. Adding a new
# non-production environment now requires adding it here, which is a visible
# change in a security-relevant list rather than a silent default.

#: The only environments that may serve the API map. Compared case-insensitively.
_NON_PRODUCTION_ENVIRONMENTS: frozenset[str] = frozenset({
    "staging", "stage",
    "local", "dev", "development",
    "test", "testing", "qa", "preview",
})

_EXPOSE_DOCS = _env("EXPOSE_API_DOCS").casefold() in ("1", "true", "yes")
_DOCS_ON = _EXPOSE_DOCS or _ENVIRONMENT in _NON_PRODUCTION_ENVIRONMENTS

app = FastAPI(
    title="Kartavaya API v2",
    description="Team task management by Aekam Inc",
    # None removes the route entirely — a 404, not a 401. An authenticated docs
    # page would still confirm the path exists.
    docs_url="/docs" if _DOCS_ON else None,
    redoc_url="/redoc" if _DOCS_ON else None,
    openapi_url="/openapi.json" if _DOCS_ON else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

@app.middleware("http")
async def global_write_rate_limit(request: Request, call_next):
    """Apply a default rate limit to all mutating requests (POST/PUT/PATCH/DELETE)."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        # The SAME key function slowapi uses. This read `get_remote_address`
        # directly, which behind Railway's edge is the proxy — so this "120
        # writes per minute per IP" was 120 writes per minute for the entire
        # product, shared by every customer. See `limiter.py` for the whole
        # story and for why the last X-Forwarded-For entry is the honest one.
        from limiter import client_ip as _client_ip
        key = f"global_write:{_client_ip(request)}"
        import time
        _now = int(time.time())
        _bucket = _write_rate_buckets.get(key)
        if _bucket and _bucket[0] == _now // 60:
            if _bucket[1] >= 120:
                return JSONResponse(status_code=429, content={"detail": "Too many requests"})
            _write_rate_buckets[key] = (_bucket[0], _bucket[1] + 1)
        else:
            _write_rate_buckets[key] = (_now // 60, 1)
    return await call_next(request)

_write_rate_buckets: dict = {}


@app.exception_handler(Exception)
async def _global_exception_handler(request: Request, exc: Exception):
    """Prevent stack traces from leaking to clients.

    `logger.exception`, not `logger.error(..., traceback.format_exc())`. The old
    form produced TWO Sentry events for one failure — the exception itself,
    caught upstream of this handler because Starlette re-raises after calling
    it, plus a second event whose entire message was a formatted traceback
    shipped as a STRING. Two issues for one fault, one of them unglueable to the
    other and neither deduplicating against it.

    `exc_info` gives the SDK the real exception object, so the traceback travels
    as structured frames it can group on — and as frames the scrubber can walk,
    which a pre-formatted string is not.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path,
                     exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.scheme == "https" or os.environ.get("RAILWAY_ENVIRONMENT"):
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return response
api_router = APIRouter(prefix="/api")

# ── CORS ──────────────────────────────────────────
DEFAULT_ORIGINS = [
    "https://kartavya.com",
    "https://www.kartavya.com",
    "https://staging.kartavya.com",
    "https://kartavaya.com",
    "https://www.kartavaya.com",
    "https://staging.kartavaya.com",
    "https://kartavya.vercel.app",
    "https://kartavya-aekam.vercel.app",
    "https://kartavya-production.akeam.vercel.app",
    "https://kartavya-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavya-git-main-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavya-git-v2-plan-kevalvshah03-6145s-projects.vercel.app",
    "https://kartavya-git-staging-kevalvshah03-6145s-projects.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    # The Android app. Capacitor serves the bundled web assets from a WebView
    # whose origin is `https://localhost` under `androidScheme: "https"` — a real
    # cross-origin request to this API, indistinguishable from a browser's except
    # that no browser will ever send it. `capacitor://localhost` is the iOS
    # equivalent and the Android default before the https scheme; both are listed
    # so the same build serves either.
    #
    # This is narrower than it looks: `localhost` here is the DEVICE's own
    # WebView, not a machine on any network, so no third party can present it.
    "https://localhost",
    "capacitor://localhost",
]
_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
ALLOWED_ORIGINS = list(dict.fromkeys(DEFAULT_ORIGINS + _extra))

# Workspace super-owner — auto-added as owner on every new project so the
# company account always has full visibility, regardless of who created it.
DEFAULT_OWNER_EMAIL = os.environ.get("DEFAULT_OWNER_EMAIL", "admin@aekaminc.com")

# Regex covers PR preview deployments on both Vercel tenants (kevalvshah03 + akeam).
_VERCEL_PREVIEW_RE = (
    r"https://kartavya-[a-z0-9-]+-kevalvshah03-6145s-projects\.vercel\.app"
    r"|https://kartavya-[a-z0-9-]+\.akeam\.vercel\.app"
    r"|https://([a-z0-9-]+\.)?kartavaya\.com"
    r"|https://[Kk]artavaya-git-[a-z0-9-]+-kevalvshah03-6145s-projects\.vercel\.app"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_VERCEL_PREVIEW_RE,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # `allow_headers` governs REQUEST headers. Without `expose_headers` the
    # browser hands JavaScript only the six CORS-safelisted RESPONSE headers,
    # so everything below was set by a handler and then discarded before any
    # caller could read it. The frontend is cross-origin from this API in every
    # environment, so this was never not the case.
    #
    #   Content-Disposition   every document route sets it, and the name it
    #                         carries is the real document number
    #                         (SOA-1A2B3C4D-20260731.pdf). `lib/documents.js:34`
    #                         documents this exact requirement and keeps a
    #                         guessed fallback for when it is missing — and the
    #                         fallback has been the only path in production,
    #                         which is why downloads never carried their real
    #                         names. There is even a test for the fallback.
    #   X-Kartavaya-*         added by the Tally export so "a caller that only
    #                         downloads still learns what was left out, without
    #                         parsing the comment block" (documents.py:1352).
    #                         No caller could read either one, so a held-back
    #                         invoice could not be surfaced.
    #
    # Exposing a response header is not a grant of access: ALLOWED_ORIGINS
    # still decides who may make the request at all, and none of these carry
    # anything the body does not already contain.
    expose_headers=[
        "Content-Disposition",
        "X-Kartavaya-Voucher-Count",
        "X-Kartavaya-Held-Back",
    ],
)


#: A request slower than this is logged with its timing. 1s is well clear of
#: normal — the whole dashboard's other eight calls land in 350-700ms — so this
#: stays quiet until something is actually wrong.
_SLOW_REQUEST_MS = 1000


@app.middleware("http")
async def request_timing(request: Request, call_next):
    """How long the SERVER spent, separate from how long the client waited.

    Added 2026-07-31 after a day of diagnosing latency from outside the process
    and being wrong five times — cold starts, region, memory, serialisation, a
    missing index — because every measurement available from a browser mixes
    server time with the client's own link, and this one had ~400ms of it.

    What finally could not be explained away: on one dashboard load `/tasks`
    took 14,108ms while seven sibling requests in the same wave finished in
    357-702ms. Same pool, same network, same instant. Its SQL measures 0.283ms.
    So the time is inside the request and nothing outside could see where.

    `Server-Timing` is a standard header — browser devtools render it natively —
    so the server's own figure now appears beside the client's in the network
    panel. The gap between the two IS the network, which is the number that was
    missing all day.
    """
    import time as _t
    start = _t.perf_counter()
    response = await call_next(request)
    dur_ms = (_t.perf_counter() - start) * 1000
    response.headers["Server-Timing"] = f'app;dur={dur_ms:.1f}'
    if dur_ms >= _SLOW_REQUEST_MS:
        logger.warning(
            "SLOW %s %s took %.0fms", request.method, request.url.path, dur_ms
        )
    return response


@app.middleware("http")
async def clear_request_cache(request, call_next):
    """Evict per-request team_id cache entries after each HTTP request completes."""
    import asyncio
    task_id = id(asyncio.current_task())
    try:
        return await call_next(request)
    finally:
        # Remove only entries belonging to this request's asyncio task
        keys_to_remove = [k for k in _team_ids_request_cache if k[0] == task_id]
        for k in keys_to_remove:
            _team_ids_request_cache.pop(k, None)



# ── Helpers ───────────────────────────────────────────────────
# now_utc(), parse_dt(), get_db() live in utils.py — use those for new code.
# The local get_visible_team_ids below is kept because it adds request-level
# caching (_team_ids_request_cache) that the utils version does not have.

from utils import now_utc, parse_dt, get_db  # noqa: E402 — after FastAPI imports

# THE ONE PREDICATE for "may this caller write a task", imported at module level
# rather than deferred inside each handler. Thirteen handlers call it; thirteen
# `from services.task_actor import …` lines inside function bodies is thirteen
# places for the next writer's copy to go missing, and this module imports
# nothing but fastapi so there is no cycle to avoid.
# See services/task_actor.py for what a Tier-3 `client` is and why the rule is
# NOT inside `assert_transition`.
from services.task_actor import (  # noqa: E402
    assert_may_write_task, assert_client_of_project,
)

def actor_display(user: dict, fallback: str = "Someone") -> str:
    """Return the best display name for a user dict. Prefers full_name > name > email."""
    return user.get("full_name") or user.get("name") or user.get("email") or fallback

# `active_org_id` is the non-raising wrapper around `get_org_id`, and it now
# lives beside the thing it wraps (`middleware/org_resolver.py`) rather than
# here. It moved because `routers/activity.py` needs it too: this module
# imports that router, so a router cannot import a dependency back out of
# this file at decoration time. Re-exported under the same name so every
# `Depends(active_org_id)` in this file — and any monkeypatch of
# `server.active_org_id` — keeps working unchanged.
from middleware.org_resolver import active_org_id  # noqa: E402,F401


async def _home_org_id(pool, user_id: str) -> str | None:
    """The org a request resolves to when it carries no `X-Org-Id` header.

    Deliberately the SAME rule and the same ordering as
    `middleware/org_resolver.get_org_id`'s fallback — earliest `granted_at`
    wins. `get_visible_team_ids` is reached from a few places that have no
    request object to resolve a header from (the notification sweep, the
    scheduler), and from call sites not yet threaded. Those must not fall back
    to "the union of every org this user belongs to", which is what the absence
    of an org used to mean here; they fall back to ONE org, and it is the same
    one the rest of the request would have picked.

    Not joined to `staging.organisations`: an inactive org is a question for
    `get_org_id`, which 403s on it before any route body runs. Answering with an
    inactive org's teams here would be a narrower answer than the caller has
    already been granted, never a wider one, so the extra join buys nothing and
    costs a join on the hottest predicate in the product.
    """
    return await pool.fetchval(
        "SELECT org_id::text FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NOT NULL "
        "AND role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY granted_at, org_id::text LIMIT 1",
        user_id,
    )


async def get_visible_team_ids(pool, user_id, role=None, _user_dict=None,
                               include_archived: bool = True,
                               org_id: str | None = None):
    """Return team IDs visible to user_id, WITHIN ONE ORGANISATION.

    Caches result in _team_ids_request_cache for the duration of a request.
    FIX #4: UNIONs team_members so users invited before registering still see teams.

    ── `include_archived` DEFAULTS TO TRUE, AND THAT DIRECTION IS DELIBERATE ──

    Archiving a finished project (migration 104) hides it from pickers and
    boards and must NOT hide it from reports: revenue, hours, invoices and
    payroll for a completed engagement are exactly the numbers a firm looks
    back at. A year-end total that silently drops every finished project is
    worse than no total at all.

    So the default is the SAFE one. A caller that forgets this parameter keeps
    counting everything, which is wrong on a picker in a visible, complainable
    way — "why is last year's audit still in my list" — and wrong on a report in
    a way nobody notices until the figure is used. Given one of those has to be
    the default, it is the one that fails loudly.

    The cache key carries the flag, or the first caller in a request would
    decide the answer for every later one — and a report and a board genuinely
    do run in the same request.

    ── `org_id` IS THE ACTIVE ORGANISATION, AND IT IS ENFORCED ─────────────────

    Pass the value `Depends(get_org_id)` resolved: it has already been validated
    against the caller's `user_roles` rows, so this function does not re-litigate
    membership, it OBEYS the answer.

    This parameter did not exist, and that was the defect. The owner holds
    org_admin in three organisations; they picked E2E Test in the switcher and
    the Projects page rendered Aekam Inc's projects. Two mechanisms, one screen:

      * the admin branch asked `admin_org_id(user_id)` with no org, and got one
        of three rows chosen by planner luck — always Aekam Inc in practice;
      * the fall-through branch UNIONed `project_assignments`, `team_members`
        and `user_roles` constrained BY USER ONLY, so a member of two orgs got
        the union of both. Measured on the live database: Aekam Inc's 24 teams
        and 219 tasks came back on every page load in every org, while E2E Test
        actually holds 1 team and 332 tasks.

    Every branch below now carries `org_id` as a BIND PARAMETER rather than
    filtering in Python afterwards. That distinction is the whole guarantee: a
    predicate the database enforces cannot be skipped by a later `if`, and a
    branch added below without one fails `test_active_org_visibility.py`'s
    property test rather than quietly leaking.

    ── WHEN NO ORG IS PASSED ───────────────────────────────────────────────────

    It resolves the caller's HOME org — `_home_org_id`, the same earliest-grant
    rule `get_org_id` uses with no header — and scopes to that. It does not fall
    back to the old union. A caller that cannot name an org (the notification
    sweep, the scheduler, a route not yet threaded) gets ONE org's answer, and
    the same one the request would have resolved anyway. Only a user who belongs
    to no organisation at all reaches the unscoped path, and for them there is no
    second org to leak from — they see the teams their own membership rows name,
    which is what a portal client is.

    ── THE CACHE KEY CARRIES THE ORG ───────────────────────────────────────────

    Or the first caller in a request decides the answer for every later one. That
    is not hypothetical here the way it is for `include_archived`: `get_org_id`
    is itself cached on `request.state`, so a request genuinely can ask this
    question for one org and then for another, and a key without the org would
    serve the first org's teams for the second WITH NO QUERY ISSUED AT ALL —
    the failure that leaves no trace in the logs.
    """
    import asyncio
    task_id = id(asyncio.current_task())

    # Resolved BEFORE the cache key is built. Two callers in one request, one
    # naming the org and one not, must land on the same entry when they mean the
    # same org — otherwise the key is keyed on how the caller was written rather
    # than on what it asked.
    org = org_id or await _home_org_id(pool, user_id)

    cache_key = (task_id, user_id, include_archived, org)
    cached = _team_ids_request_cache.get(cache_key)
    if cached is not None:
        return cached

    # Authority is staging.user_roles, not the legacy users.role column. `role`
    # and `_user_dict` are still accepted for call-site compatibility but are no
    # longer trusted: both ultimately carried the JWT's admin claim, which
    # survived the flag being revoked.
    # ── AN ADMIN OF NO ORG IS NOT AN ADMIN OF EVERY ORG ─────────────────────
    #
    # `is_org_admin(user_id)` answers True for a PLATFORM role as well as for
    # org_owner/org_admin, and with no org argument it answers globally.
    # `admin_org_id` then looks for an ORG-SCOPED admin row — and its own
    # docstring records what used to happen next: "Returns None for platform
    # staff with no org row, which the callers treat as unrestricted."
    #
    # This was that caller. `SELECT team_id FROM teams WHERE deleted_at IS NULL`
    # has no predicate at all. Measured on the live database today: 7 of the 10
    # platform accounts hold a platform role and NO org-scoped admin row, so all
    # seven received every one of the 29 teams across all 3 organisations, and
    # through them 557 tasks. No header, no forged id, no special request —
    # this one fires on an ordinary page load.
    #
    # FAIL CLOSED, and note the fall-through is not "nothing": an admin with no
    # org row is simply a user, so they keep exactly the teams their own
    # memberships give them. For the vendor's own staff, who are members of
    # Aekam Inc, that is Aekam's teams — which is the whole of what the owner
    # says god mode should see. The only people who lose anything are accounts
    # belonging to no org, and what they lose is other companies' data.
    #
    # `search.py` and `tasks_bulk.py` already re-narrow this list to the active
    # org, so they were never exposed. They are two callers out of many, which
    # is precisely why the narrowing belongs here rather than at each call site.
    #
    # ── ADMIN OF *THIS* ORG, NOT ADMIN OF SOME ORG ──────────────────────────
    #
    # With an org in hand the question is asked ABOUT THAT ORG, and `org` is the
    # answer's scope whether or not the caller administers it. `admin_org_id` is
    # only consulted on the unscoped path now, because on the scoped path there
    # is nothing for it to decide: we already know which org, and all that
    # remains is whether this caller sees all of it or only their own memberships
    # in it.
    if org:
        admin_here = await is_org_admin(user_id, org)
    else:
        # No org resolved from a header and none from `user_roles`. The only
        # remaining way an org can appear is an org-scoped admin row, which is
        # the shape `admin_org_id` reads — and which `_home_org_id` would
        # already have found, so in practice this is reached only when the two
        # disagree (a monkeypatched helper, or an admin row whose role_code is
        # outside the member list). Kept because the previous behaviour depended
        # on this exact pairing and losing it would be a silent narrowing.
        org = await admin_org_id(user_id) if await is_org_admin(user_id) else None
        admin_here = org is not None

    if org and admin_here:
        all_teams = await pool.fetch(
            "SELECT team_id FROM teams WHERE org_id=$1::uuid AND deleted_at IS NULL", org)
        result = [r["team_id"] for r in all_teams]
    elif org:
        # THE SAME THREE LEGS, ANCHORED TO `teams`. `project_assignments` and
        # `team_members` carry no `org_id` of their own, so a UNION of them
        # cannot be scoped — which is exactly how a member of two orgs got both
        # orgs' teams. Anchoring on `teams` and asking the membership questions
        # as EXISTS puts `t.org_id = $2` in front of every leg at once, so there
        # is one place the predicate can go missing instead of three.
        #
        # `t.deleted_at IS NULL` now covers all three legs. It previously
        # governed only the `user_roles` leg, so a soft-deleted project still
        # appeared for anyone holding a direct assignment row on it.
        #
        # THE `org_id IS NULL` LEG IS NOT A HOLE, and it is spelled out rather
        # than folded into the predicate above so it cannot be read as one.
        # 2 of the 29 live teams carry no `org_id`. A team in no organisation is
        # not "another organisation's data" — there is no tenant it could be
        # leaking from — and it was never reachable through the `user_roles` leg
        # anyway, since `ur.org_id = t.org_id` never matches NULL. It was
        # reachable only by a DIRECT membership row, and that is exactly what it
        # stays reachable by here. `routers/search.py` and `routers/tasks_bulk.py`
        # both already write `(org_id IS NULL OR org_id = $2)` in their own
        # narrowing for the same reason; had this branch dropped them, those two
        # clauses would have quietly become dead code and the members of those
        # two teams would have lost them from search, bulk edit and the task
        # list with nothing to point at.
        #
        # ── WHAT THIS BRANCH COSTS, MEASURED RATHER THAN ASSUMED ────────────
        #
        # Before, a direct membership row was sufficient on its own whatever org
        # the team was in. Now it is not: a team in a DIFFERENT, non-null org is
        # unreachable, and the user cannot switch to that org to get it back —
        # `get_org_id` requires a `staging.user_roles` row on both its header
        # path and its fallback, so the header 403s, `active_org_id` turns that
        # into None and `_home_org_id` returns their OTHER org.
        #
        # Read-only against the live database on 2026-08-06, that population is
        # NOT empty: 3 users, 4 (user, team) pairs, 22 tasks, over 3 live teams
        # in 2 orgs. One of the three is the VENDOR's own platform_admin sitting
        # on two Unicode Group project teams — restoring that would be restoring
        # the cross-tenant read this whole change exists to close, so the answer
        # is not simply "seed everyone a row". The rows, the query that found
        # them and the per-user decision are written up in
        # `migrations/120_seed_missing_org_roles.sql`, which is deliberately NOT
        # applied: who belongs to which organisation is the owner's call.
        #
        # The narrowing SHIPS ANYWAY. This is a tenancy boundary, and a leak
        # outranks a regression in convenience; 22 tasks becoming unreachable to
        # 3 accounts is the price, it is named here so nobody has to rediscover
        # it from a support ticket, and 120 is the remedy when the owner decides.
        rows = await pool.fetch(
            """
            SELECT t.team_id FROM teams t
            WHERE t.deleted_at IS NULL
              AND (
                (t.org_id = $2::uuid AND (
                    EXISTS (SELECT 1 FROM project_assignments pa
                             WHERE pa.team_id = t.team_id AND pa.user_id = $1)
                    OR EXISTS (SELECT 1 FROM team_members tm
                                WHERE tm.team_id = t.team_id AND tm.user_id = $1
                                  AND tm.status = 'active')
                    OR EXISTS (SELECT 1 FROM staging.user_roles ur
                                WHERE ur.user_id = $1 AND ur.org_id = t.org_id
                                  AND ur.role_code IN ('org_owner','org_admin','org_member'))
                ))
                OR (t.org_id IS NULL AND (
                    EXISTS (SELECT 1 FROM project_assignments pa
                             WHERE pa.team_id = t.team_id AND pa.user_id = $1)
                    OR EXISTS (SELECT 1 FROM team_members tm
                                WHERE tm.team_id = t.team_id AND tm.user_id = $1
                                  AND tm.status = 'active')
                ))
              )
            """,
            user_id, org,
        )
        result = [r["team_id"] for r in rows]
    else:
        # NO ORG EXISTS TO SCOPE TO. `_home_org_id` returned nothing, which means
        # this user holds no `user_roles` row in any organisation: a portal
        # client, or staff not yet placed. There is no second org for their teams
        # to leak from, and the `user_roles` leg is dropped entirely because it
        # would match nothing — what is left is their own membership rows, which
        # is also what reaches the 2 live teams that carry no `org_id` at all.
        rows = await pool.fetch(
            """
            SELECT team_id FROM project_assignments WHERE user_id=$1
            UNION
            SELECT team_id FROM team_members WHERE user_id=$1 AND status='active'
            """,
            user_id,
        )
        result = [r["team_id"] for r in rows]

    # Drop archived projects, if this caller asked to. Applied to the ASSEMBLED
    # list rather than to each query above, because the non-admin branch UNIONs
    # `project_assignments` and `team_members`, neither of which carries
    # `archived_at` — filtering there would mean three more joins to express one
    # rule, and a rule expressed three times is a rule that will disagree with
    # itself.
    #
    # Guarded on the column existing: migration 104 is applied by hand and the
    # deploy is separate, so before it lands this must not raise. A picker that
    # briefly still shows a finished project is a cosmetic wait; a 500 on the
    # helper that decides visibility takes the whole product down.
    if not include_archived and result and await archive_column_ready(pool):
        archived = await pool.fetch(
            "SELECT team_id FROM teams WHERE team_id = ANY($1::text[]) "
            "  AND archived_at IS NOT NULL",
            result,
        )
        hidden = {r["team_id"] for r in archived}
        if hidden:
            result = [t for t in result if t not in hidden]

    _team_ids_request_cache[cache_key] = result
    return result

async def is_project_member(pool, team_id: str, user: dict) -> dict | None:
    """Return this caller's role on this project, or None.

    ── WHAT THIS USED TO DO, AND WHY IT WAS THE WORST OF THE THREE ─────────────

    The first line was:

        if user.get("role") in ("admin", "owner"):
            return {"role": "admin"}

    That is not "trusting the legacy column" — it is a synthetic membership
    returned from the JWT claim with NO DATABASE QUERY AT ALL. Measured with a
    pool that raises on any query:

        is_project_member(pool, 'team_belonging_to_another_org',
                          {'user_id': 'user_x', 'role': 'admin'})
            -> {'role': 'admin'}          (nothing was asked)

    So the claim on the token granted PROJECT-ADMIN of every project in the
    database — any `team_id`, no org predicate, no team predicate — and it was
    `users.role` as it stood WHEN THE TOKEN WAS MINTED, which survives the flag
    being revoked and cannot be scoped to an organisation at all. `users.role`
    is a per-user GLOBAL column; the tier model is per-org and per-module.

    Ten routes are gated on this. Five of them test `mem["role"] in
    ("owner","admin")`, which the synthetic dict satisfied: create/update/delete
    and reorder columns, and the project brand kit.

    ── WHAT IT ASKS NOW ────────────────────────────────────────────────────────

    The same question the rest of this file already asks — `is_org_admin`
    against `staging.user_roles`, at request time — and SCOPED TO THIS TEAM'S
    ORG, because `middleware/roles.is_org_admin`'s scoped branch requires the
    platform holder to actually belong to that org. `approvals_router.py:124`
    wrote down two hours before this change why it refused to reuse this helper.
    It can be reused now.

    `org_id IS NULL` falls through to the unscoped call deliberately: 2 of the
    29 live teams have no org, there is nothing to scope to, and
    `get_visible_team_ids` already relies on the same fall-through. Refusing
    there would break both.

    ── AND IT RETURNS THE REAL ROLE ────────────────────────────────────────────

    Membership is read BEFORE the admin question, and the row is returned as it
    stands rather than collapsed to `{"role": "admin"}`. That is what lets a
    caller tell a Tier-3 `client` from an owner — the distinction `create_task`
    could not previously make, because every answer said `admin`.

    ── WHAT THE NARROWING COSTS, MEASURED ──────────────────────────────────────

    Six accounts hold `users.role IN ('admin','owner')`, all six
    vendor-controlled. Five hold a real `staging.user_roles` org row and keep
    every project inside their own org. The sixth (sid@aekaminc.com) holds
    `platform_admin` and NO org row — and `get_visible_team_ids` already returns
    zero teams for exactly that shape, since 965d0e82. This change makes the two
    agree; it does not take away an access anybody currently has.
    """
    from middleware.roles import is_org_admin

    # Membership first: it is the specific answer, and the caller needs the real
    # role rather than the label an admin escape hatch would overwrite it with.
    row = await pool.fetchrow(
        "SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",
        team_id, user["user_id"]
    )
    if row:
        return row
    # Fallback: team_members covers users added after their invite acceptance
    row = await pool.fetchrow(
        "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
        team_id, user["user_id"]
    )
    if row:
        return row

    # No membership row. Org admins of THIS TEAM'S org still administer it —
    # that is the access `get_visible_team_ids` already grants them, and before
    # this change the two disagreed about it.
    org_row = await pool.fetchrow("SELECT org_id FROM teams WHERE team_id=$1", team_id)
    org_id = org_row["org_id"] if org_row else None
    if await is_org_admin(user["user_id"], str(org_id) if org_id else None):
        # "admin" is the label `get_team` already synthesises for org-level
        # access, so the frontend's `your_role` handling needs no new branch.
        return {"role": "admin"}
    return None


#: How long a soft-deleted project stays restorable. Owner's decision,
#: 2026-08-09: seven days, not thirty. Declared in `services/project_purge` and
#: imported rather than repeated, because the window and the job that acts on it
#: must be the same number — three places used to spell the interval out and a
#: fourth would have been written wrong.
from services.project_purge import PROJECT_BIN_DAYS  # noqa: E402


async def require_project_admin(pool, team_id: str, user: dict) -> dict:
    """The gate for archiving, deleting and restoring ONE project.

    ── WHY THIS EXISTS ─────────────────────────────────────────────────────────

    All five routes were gated on `_require_admin`, which is
    `require_platform_role("platform_admin", "account_manager")` — an **Aekam**
    role. So the customer who owns the project could not archive it, could not
    delete it, and could not restore it; only the vendor could. The owner
    reported this as "archive/delete doesn't work", and that is what it was.

    ── WHO MAY, PER THE OWNER, 2026-08-09 ──────────────────────────────────────

    "both, Org admin and project module-admin … project-module admin he/she can
    see only project they are part of. can archived, delete, org admin can see
    all."

    Which is exactly the two answers `is_project_member` already distinguishes:

      · an org admin of THIS TEAM'S org  → every project in the org;
      · `owner` or `admin` on the project itself → that project only.

    Core PM is NOT a grantable Tier-4 module (`kartavya` is absent from
    `ALL_MODULES` — see `middleware/role_tiers.LADDER_MODULES`), so
    "project module-admin" cannot mean a `held_module_levels` grant. It means
    the project role, which is where project administration has always lived.

    Returns the team row (id, name, org_id) so the caller can name the project
    in the notification without a second query. Raises 404 before 403 only for a
    team that does not exist at all — a team the caller cannot see answers 403,
    not 404, because the two are indistinguishable to them anyway and 403 is the
    honest answer to "you may not".
    """
    team = await pool.fetchrow(
        "SELECT team_id, name, org_id, deleted_at FROM teams WHERE team_id=$1",
        team_id)
    if not team:
        raise HTTPException(404, "Project not found")
    mem = await is_project_member(pool, team_id, user)
    # `.get` rather than `[...]`: a membership row with no role is not an
    # admin, and it must answer 403 rather than 500 on a KeyError.
    if not mem or (mem.get("role") if hasattr(mem, "get") else None) not in ("owner", "admin"):
        raise HTTPException(403, "Only an organisation admin or a project "
                                 "owner/admin can do this")
    return team


async def notify_org_owner_project_state(pool, team: dict, actor: dict, what: str) -> None:
    """Tell the org owner that someone archived or deleted one of their projects.

    The owner's words: "email should get to org owner that user: keval shah
    deleted / archived Project: xyz". So the mail names the PERSON and the
    PROJECT — never an id, per the names-not-ids rule.

    Best-effort and never raises: the state change has already been committed
    and a mail failure must not turn a successful archive into a 500. The actor
    is skipped when they ARE the org owner — nobody needs telling what they just
    did themselves.
    """
    try:
        if not team.get("org_id"):
            return
        owners = await pool.fetch(
            "SELECT u.user_id, u.email, COALESCE(u.full_name, u.name, u.email) AS name "
            "FROM staging.user_roles r JOIN users u ON u.user_id = r.user_id "
            "WHERE r.org_id=$1 AND r.role_code='org_owner'",
            str(team["org_id"]))
        actor_name = (actor.get("full_name") or actor.get("name")
                      or actor.get("email") or "Someone")
        from email_service import send_project_state_email
        for row in owners:
            if row["user_id"] == actor.get("user_id") or not row["email"]:
                continue
            send_project_state_email(
                row["email"], row["name"], actor_name,
                team["name"] or "a project", what,
                restore_days=PROJECT_BIN_DAYS if what == "deleted" else None)
    except Exception as exc:  # noqa: BLE001 — see docstring
        logger.warning("project %s notification failed: %s", what, exc)


async def normalize_orders(pool, scope_col, scope_val, column_id):
    """Re-sequence sort_order for all tasks in the given column, closing any gaps.

    Holds a pg_advisory_xact_lock keyed on (scope_val, column_id) so concurrent
    move operations on the same column don't interleave and corrupt sort_order.
    """
    if scope_col not in _VALID_SCOPE_COLS:
        raise ValueError(f"Invalid scope_col: {scope_col!r}")
    import hashlib
    lock_key = int(hashlib.md5(f"{scope_val}:{column_id}".encode()).hexdigest()[:15], 16) % (2**63)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", lock_key)
            rows = await conn.fetch(
                f"SELECT task_id FROM tasks WHERE {scope_col}=$1 AND column_id=$2 ORDER BY sort_order ASC, updated_at ASC",
                scope_val, column_id,
            )
            if not rows:
                return
            values_sql = ",".join(f"(${i*2+1}::int, ${i*2+2}::text)" for i in range(len(rows)))
            params = []
            for idx, row in enumerate(rows):
                params.extend([idx, row["task_id"]])
            await conn.execute(
                f"UPDATE tasks SET sort_order=v.idx, updated_at=NOW() "
                f"FROM (VALUES {values_sql}) AS v(idx, task_id) "
                f"WHERE tasks.task_id=v.task_id",
                *params,
            )

async def _push_if_allowed(pool, *, user_id, kind, title, message, url, task_id, is_mine=True):
    """Ask the user's preferences first, then fire both push channels.

    THE GATE THAT WAS MISSING ENTIRELY. `send_web_push` and `send_expo_push`
    take a `user_id` and fire — neither accepts a `kind`, and neither reads
    `notification_prefs`. `create_notification` called them directly, so every
    kind raised through it (`approval_request`, `assigned`, `comment`,
    `status_changed`, `done`, `rejected`, `approved`, `reminder`) went to the
    device regardless of quiet hours and regardless of the per-kind switch.

    That is worse than a missing setting. The vocabulary was never missing —
    `DEFAULT_PREFS` has every one of those kinds and the customize hub renders a
    switch for each. It was simply never consulted on this path, so the user set
    it, watched it save, and still got the notification at 3am. A control that
    reports success and changes nothing teaches people the product lies.

    `notif_type` is already the right vocabulary: the strings this helper is
    called with are the same strings `DEFAULT_PREFS` is keyed on. No mapping
    needed — only the question.

    Runs in the background so the extra prefs round trip is off the request
    path, and fails OPEN inside `prefs_allow`: losing an approval request to a
    lookup timeout is a bigger harm than one unwanted buzz.

    `is_mine=True` is the permissive reading of `mine_only`, and deliberately
    so. This change's job is to stop delivering what the user switched OFF and
    what quiet hours forbid; deciding whose event it is needs ownership context
    these call sites do not carry, and guessing wrong would silence something
    they asked for. Off and quiet hours are unambiguous — those are gated now.
    """
    from services.push_service import prefs_allow
    if not await prefs_allow(pool, user_id, kind, is_mine=is_mine):
        return
    await send_web_push(pool, user_id=user_id, title=title, body=message, url=url or "/")
    await send_expo_push(pool, user_id=user_id, title=title, body=message, url=url or "/", task_id=task_id)


async def create_notification(pool, user_id, notif_type, title, message, task_id=None, team_id=None, url=None, push=True, is_mine=True):
    """Insert a notification row and fire a Web Push if the user has a subscription.

    Pass push=False to write the in-app row only (used for reminders whose
    push channel was switched off).

    THE ROW IS WRITTEN UNCONDITIONALLY, above the push gate. Quiet hours and a
    switched-off kind suppress the DEVICE, never the record: the notification
    still lands in the Inbox with its real timestamp, because the record is when
    it happened, not when you were willing to be interrupted by it.
    """
    await pool.execute(
        "INSERT INTO notifications (notification_id,user_id,team_id,type,title,message,task_id,url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        f"notif_{uuid.uuid4().hex[:12]}", user_id, team_id, notif_type, title, message, task_id, url,
    )
    if not push: return
    # One background task, not two: the preference lookup is shared by both
    # channels, and firing them separately would ask the same question twice.
    _bg(_push_if_allowed(
        pool, user_id=user_id, kind=notif_type, title=title, message=message,
        url=url, task_id=task_id, is_mine=is_mine,
    ), label="gated_push")

async def _replace_task_reminders(pool, task_id: str, due_dt, reminders: List["ReminderIn"]) -> List["ReminderOut"]:
    """Delete unsent reminders for a task and insert the new set, computed off due_dt.

    Wrapped in a transaction so a failed INSERT rolls back the DELETE — reminders
    are never left in a partially-written state.
    Reminders whose offset isn't in REMINDER_OFFSETS, whose channels aren't a
    recognized subset, or whose computed fire_at has already passed are skipped.
    """
    if not due_dt or not reminders:
        await pool.execute("DELETE FROM task_reminders WHERE task_id=$1 AND sent_at IS NULL", task_id)
        return []
    now = now_utc(); out = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM task_reminders WHERE task_id=$1 AND sent_at IS NULL", task_id)
            for r in reminders:
                if r.offset_minutes not in REMINDER_OFFSETS: continue
                channels = [c for c in r.channels if c in REMINDER_CHANNELS] or ["in_app"]
                fire_at = due_dt - timedelta(minutes=r.offset_minutes)
                if fire_at <= now: continue
                row = await conn.fetchrow(
                    """INSERT INTO task_reminders (task_id,offset_minutes,channel_inapp,channel_push,channel_email,fire_at)
                       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
                    task_id, r.offset_minutes, "in_app" in channels, "push" in channels, "email" in channels, fire_at,
                )
                out.append(_reminder_row_to_out(row))
    return out

def _reminder_row_to_out(row) -> "ReminderOut":
    channels = [c for c, flag in (("in_app", row["channel_inapp"]), ("push", row["channel_push"]), ("email", row["channel_email"])) if flag]
    return ReminderOut(reminder_id=row["reminder_id"], offset_minutes=row["offset_minutes"], channels=channels, fire_at=row["fire_at"], sent_at=row["sent_at"])

async def _fetch_task_reminders(pool, task_id: str) -> List["ReminderOut"]:
    rows = await pool.fetch("SELECT * FROM task_reminders WHERE task_id=$1 AND sent_at IS NULL ORDER BY fire_at ASC", task_id)
    return [_reminder_row_to_out(r) for r in rows]

async def ensure_default_columns(pool, team_id):
    """Create the five default kanban columns for a new project if none exist yet."""
    existing = await pool.fetchval("SELECT COUNT(*) FROM project_columns WHERE team_id=$1", team_id)
    if existing == 0:
        defaults = [
            ("To Do","#0082c6",0,False),("In Progress","#03a1b6",1,False),
            ("In Review","#8b5cf6",2,False),("Approval","#f59e0b",3,False),("Done","#05b7aa",4,True),
        ]
        for name,color,order,is_done in defaults:
            await pool.execute(
                "INSERT INTO project_columns (column_id,team_id,name,color,sort_order,is_done) VALUES ($1,$2,$3,$4,$5,$6)",
                f"col_{uuid.uuid4().hex[:12]}",team_id,name,color,order,is_done,
            )

async def client_can_access_task(pool, task_id, user_id):
    """Returns True if a client user can access this task."""
    row = await pool.fetchrow("SELECT team_id, created_by_user_id, assignee_user_ids FROM tasks WHERE task_id=$1", task_id)
    if not row: return False
    if row["created_by_user_id"] == user_id: return True
    if user_id in (row["assignee_user_ids"] or []): return True
    if row["team_id"]:
        pa = await pool.fetchrow("SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2", row["team_id"], user_id)
        if pa: return True
    tc = await pool.fetchrow("SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2", task_id, user_id)
    return bool(tc)


# ── Models ─────────────────────────────────────────────
class ProjectColumnCreate(BaseModel):
    name:str; color:str="#0082c6"; is_done:bool=False
class ProjectColumnUpdate(BaseModel):
    name:Optional[str]=None; color:Optional[str]=None; is_done:Optional[bool]=None; sort_order:Optional[int]=None
class ProjectColumnOut(BaseModel):
    column_id:str; team_id:str; name:str; color:str; sort_order:int; is_done:bool; created_at:datetime
class CategoryCreate(BaseModel):
    name:str; color:str="#0082c6"
class CategoryOut(BaseModel):
    category_id:str; user_id:str; name:str; color:str; created_at:datetime; updated_at:datetime
class TeamCreate(BaseModel):
    name:str; brand_settings:Optional[dict]=None
class TeamOut(BaseModel):
    team_id:str; name:str; created_by:str; created_at:datetime; updated_at:datetime
    task_count:int=0; done_count:int=0; color:Optional[str]=None
    brand_settings:Optional[dict]=None
    archived_at:Optional[datetime]=None
    #: May THIS caller archive, delete and restore THIS project? Sent because
    #: the page used to decide it from `users.role === 'admin'` in the JWT — a
    #: global column for a per-org fact, held by six vendor accounts and nobody
    #: else, so no customer ever saw the delete control. The server already
    #: knows the answer (`require_project_admin`); the page should not be
    #: guessing it.
    can_admin:bool=False

    @field_validator("brand_settings", mode="before")
    @classmethod
    def _parse_brand_settings(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        return v

class TeamMemberAdd(BaseModel):
    email:str; role:str="member"
class TeamMemberUpdate(BaseModel):
    role:Optional[str]=None; status:Optional[str]=None
class TeamMemberOut(BaseModel):
    member_id:str; team_id:str; email:str; user_id:Optional[str]=None; role:str; status:str; created_at:datetime; updated_at:datetime
class Attachment(BaseModel):
    name:str; url:str; key:Optional[str]=None
    is_private:bool=False; visible_to:List[str]=[]
    # `18-documents.md` and `19-client-portal.md` both require a file row to read
    # "name, size, who shared it, when". Only `name` was expressible before these
    # four fields — and TaskDrawer.jsx has been sending `size` at upload all
    # along, where the model silently discarded it.
    #
    # All four are Optional and default to None because attachments live in the
    # `tasks.attachments` JSONB blob, not in their own table: every row written
    # before this change has none of these keys, and must still validate. That is
    # also why adding them needs NO migration.
    #
    # `uploaded_by` is a user_id and is INTERNAL — it must never reach a client.
    # `uploaded_by_name` is the snapshot that answers "who shared it" for the
    # portal without exposing an identifier or an email.
    size:Optional[int]=None
    uploaded_by:Optional[str]=None
    uploaded_by_name:Optional[str]=None
    uploaded_at:Optional[datetime]=None
class Subtask(BaseModel):
    subtask_id:str=Field(default_factory=lambda:f"sub_{uuid.uuid4().hex[:12]}"); title:str; is_done:bool=False; order:int=0; assignee_user_id:Optional[str]=None
class Recurrence(BaseModel):
    rule:str="none"; interval:int=1
REMINDER_OFFSETS = {2880, 1440, 240, 120, 60, 30, 15}
REMINDER_CHANNELS = {"in_app", "push", "email"}
class ReminderIn(BaseModel):
    offset_minutes:int; channels:List[str]=["in_app"]
class ReminderOut(BaseModel):
    reminder_id:str; offset_minutes:int; channels:List[str]; fire_at:datetime; sent_at:Optional[datetime]=None
class TaskCreate(BaseModel):
    title:str; description:Optional[str]=None; status:str="todo"; column_id:Optional[str]=None
    priority:str="medium"; category_id:Optional[str]=None; tags:List[str]=[]; team_id:Optional[str]=None
    assignee_user_ids:List[str]=[]; assignee_emails:List[str]=[]; due_at:Optional[str]=None
    reminder_at:Optional[str]=None; reminders:List[ReminderIn]=[]; recurrence:Recurrence=Field(default_factory=Recurrence)
    estimated_minutes:Optional[int]=None; attachments:List[Attachment]=[]
    custom_fields:Dict[str,Any]={}; subtasks:List[Subtask]=[]
class TaskUpdate(BaseModel):
    title:Optional[str]=None; description:Optional[str]=None; status:Optional[str]=None
    column_id:Optional[str]=None; priority:Optional[str]=None; category_id:Optional[str]=None
    tags:Optional[List[str]]=None; team_id:Optional[str]=None; assignee_user_ids:Optional[List[str]]=None
    assignee_emails:Optional[List[str]]=None; due_at:Optional[str]=None; reminder_at:Optional[str]=None
    recurrence:Optional[Recurrence]=None; estimated_minutes:Optional[int]=None
    attachments:Optional[List[Attachment]]=None; custom_fields:Optional[Dict[str,Any]]=None
    subtasks:Optional[List[Subtask]]=None; approval_status:Optional[str]=None
class TaskOut(BaseModel):
    task_id:str; user_id:Optional[str]=None; team_id:Optional[str]=None; column_id:Optional[str]=None
    created_by_user_id:str; assigned_by_user_id:Optional[str]=None; completed_by_user_id:Optional[str]=None
    title:str; description:Optional[str]=None; status:str; priority:str; category_id:Optional[str]=None
    tags:List[str]=[]; assignee_user_ids:List[str]=[]; assignee_emails:List[str]=[]; assignee_names:List[str]=[]
    due_at:Optional[datetime]=None; reminder_at:Optional[datetime]=None; reminder_sent_at:Optional[datetime]=None
    recurrence:Recurrence=Field(default_factory=Recurrence); estimated_minutes:Optional[int]=None
    attachments:List[Attachment]=[]; custom_fields:Dict[str,Any]={}; subtasks:List[Subtask]=[]
    order:int=0; created_at:datetime; updated_at:datetime; completed_at:Optional[datetime]=None
    approval_status:Optional[str]=None; approval_notes:Optional[str]=None; approved_by:Optional[str]=None
    approval_requested_at:Optional[datetime]=None; approval_decided_at:Optional[datetime]=None
    requires_approval:bool=False; created_by_name:Optional[str]=None
    archived_at:Optional[datetime]=None; reminders:List[ReminderOut]=[]
class TaskMoveIn(BaseModel):
    column_id:str; order:int
class CommentCreate(BaseModel):
    body:str=Field(...,min_length=1,max_length=4000)
    # Fail closed. A comment is internal unless the author deliberately says
    # otherwise, so an internal thread cannot become client-visible by omission,
    # by a client-side default, or by a caller that predates this field.
    is_client_visible:bool=False
class CommentOut(BaseModel):
    comment_id:str; task_id:str; user_id:str; user_name:str; body:str; created_at:datetime
    # Backed by `task_comments.is_client_visible`, which DOES NOT EXIST YET —
    # see backend/migrations/PROPOSED_072_task_comment_client_visibility.sql.
    # Until that migration is applied the column probe below reports False for
    # every row, so `list_comments` serves a client NOTHING rather than guessing
    # which internal comments are safe. That is the intended pre-migration state.
    is_client_visible:bool=False


# ── Client shape ──────────────────────────────────────────────────────────────
#
# `19-client-portal.md`: "The failure mode is a well-meaning
# `GET /api/client/tasks` that returns the full task object and lets the
# component pick fields. [...] The endpoint returns a client shape, or this will
# leak eventually."
#
# These models are that shape. They are allow-lists: a field reaches a client
# because it is written out below, never because it was added to `TaskOut`. A
# new internal field on the task therefore cannot reach the portal by default,
# which is the whole point — the previous arrangement inverted that.
#
# Wire names are camelCase via alias so the payload matches what the portal's
# components already consume, while the Python side keeps backend snake_case.
class ClientAttachmentOut(BaseModel):
    """A file row: name, size, who shared it, when — and nothing else.

    Deliberately absent: `key` (R2 storage internals), `visible_to` (a list of
    OTHER people's user ids), `is_private` (the firm's classification of its own
    documents), and `uploaded_by` (an internal user id — the NAME crosses, the
    identifier does not).
    """
    model_config = ConfigDict(populate_by_name=True)
    name:str
    url:str
    size:Optional[int]=None
    shared_by:Optional[str]=Field(default=None,alias="sharedBy")
    shared_at:Optional[datetime]=Field(default=None,alias="sharedAt")

class ClientDecisionOut(BaseModel):
    """A decision this client made, shown back to them as the written record."""
    outcome:str
    note:str=""
    at:Optional[datetime]=None

class ClientTaskOut(BaseModel):
    """One task as its client sees it.

    Excluded on purpose, each because `19` names it or because it derives from
    something `19` names: `assignee_user_ids`, `assignee_emails`,
    `assignee_names` (other members' data, and the assignee-picker leak);
    `estimated_minutes` (time, and everything derived from it); `custom_fields`
    and `subtasks` (the firm's internal decomposition of the work);
    `approved_by`, `column_id`, `sort_order`, `user_id`, `category_id`,
    `priority`, `tags` (the firm's triage); `created_by_user_id`,
    `assigned_by_user_id`, `completed_by_user_id` (internal identifiers);
    `reminders`, `reminder_at`, `reminder_sent_at` (the firm's follow-up
    machinery); and the raw six-value `status`.

    `requested_by` is a NAME and is kept — `19`'s ApprovalCard is explicitly
    "who asked and when". An email is not a name and does not cross.
    """
    model_config = ConfigDict(populate_by_name=True)
    task_id:str=Field(alias="taskId")
    ref:str
    title:str
    note:str=""
    state:str
    expected_at:Optional[datetime]=Field(default=None,alias="expectedAt")
    updated_at:Optional[datetime]=Field(default=None,alias="updatedAt")
    created_at:Optional[datetime]=Field(default=None,alias="createdAt")
    requested_by:Optional[str]=Field(default=None,alias="requestedBy")
    project_id:Optional[str]=Field(default=None,alias="projectId")
    files:List[ClientAttachmentOut]=[]
    decision:Optional[ClientDecisionOut]=None
    awaiting_me:bool=Field(default=False,alias="awaitingMe")

class ClientApprovalOut(BaseModel):
    """An approval waiting on this client.

    Excluded on purpose: `requested_by_email` (a staff email address — `19`'s
    never-see list names "team member emails and phone numbers beyond the single
    named contact"), `reviewed_by` and `review_notes` (the firm's internal
    review trail), and `request_type` (internal vocabulary).
    """
    model_config = ConfigDict(populate_by_name=True)
    approval_id:str=Field(alias="approvalId")
    task_id:Optional[str]=Field(default=None,alias="taskId")
    ref:str=""
    title:str="Untitled"
    ask:str=""
    requested_by:Optional[str]=Field(default=None,alias="requestedBy")
    requested_at:Optional[datetime]=Field(default=None,alias="requestedAt")
    # No `files` here on purpose: the portal already joins an approval to its
    # task by `taskId` and reads the files off that, so duplicating them would
    # mean two places to get attachment filtering right instead of one.

class ClientProjectOut(BaseModel):
    """A project as its client sees it: the name they recognise, and an id.

    `/client/projects` used to return `dict(r)` over `SELECT t.*`, so every
    column of `teams` crossed to an external browser — `created_by` (an internal
    user id), `org_id` (tenancy internals), `brand_settings`, `deleted_at`. The
    portal read exactly two of them. This is those two.
    """
    model_config = ConfigDict(populate_by_name=True)
    project_id:str=Field(alias="projectId")
    name:str
class DashboardSummaryOut(BaseModel):
    todo:int; in_progress:int; done:int; overdue:int; due_24h:int
class PushSubscriptionIn(BaseModel):
    model_config=ConfigDict(extra="ignore"); endpoint:str; keys:Dict[str,str]
class NotificationOut(BaseModel):
    notification_id:str; user_id:str; team_id:Optional[str]=None; type:str; title:str; message:str
    task_id:Optional[str]=None; url:Optional[str]=None; created_at:datetime; read_at:Optional[datetime]=None
class MarkReadIn(BaseModel):
    notification_ids:List[str]=[]; mark_all:bool=False


_team_org_cache: Dict[str, Optional[str]] = {}

async def _resolve_org_id(pool, team_id: str) -> Optional[str]:
    """Resolve org_id from team_id, caching only the ANSWER — never the absence.

    A team's org never changes, so a resolved id is safe to hold for the life of
    the process. `None` is not the same kind of fact: it means "no org link
    YET", and teams do acquire one — by backfill, by the org-scoping migrations
    still working through ~48 child tables, or simply by being created a moment
    before the link is written. Caching that negative pinned the wrong answer
    until the next redeploy, and the failure was silent in exactly the place it
    hurts: `_refresh_task_attachments` returns early when the org is unknown, so
    the board served the STALE stored R2 URL instead of a fresh presigned one.
    Attachments quietly stop opening, and nothing logs a reason.

    Re-querying for the unlinked minority costs one indexed fetchrow on a path
    that already does several. That is the right side to be wrong on.
    """
    if not team_id:
        return None
    if team_id in _team_org_cache:
        return _team_org_cache[team_id]
    row = await pool.fetchrow("SELECT org_id FROM teams WHERE team_id=$1", team_id)
    # `.get`, not `row["org_id"]`. Against the real database the two are
    # identical — asyncpg always hands back the column the query selected — so
    # this costs nothing in production and cannot hide a schema fault. It
    # matters because this function is now called from every write path that
    # emits an event, which puts it behind test stubs written for entirely
    # unrelated endpoints; a catch-all `fetchrow` stub answering a *teams* query
    # with whatever row its own test cares about would otherwise raise KeyError
    # in a file that has nothing to do with orgs.
    val = row.get("org_id") if row is not None else None
    org_id = str(val) if val else None
    if org_id is not None:
        _team_org_cache[team_id] = org_id
    return org_id

async def _refresh_task_attachments(pool, task: "TaskOut") -> "TaskOut":
    """Re-sign attachment URLs using the task's org R2 credentials."""
    if not task.attachments:
        return task
    org_id = await _resolve_org_id(pool, task.team_id)
    if not org_id:
        return task
    from services.storage import sign_key
    refreshed = []
    for a in task.attachments:
        if a.key:
            fresh_url = await sign_key(org_id, a.key)
            # model_copy, not a field-by-field rebuild: the old form listed five
            # fields explicitly, so `size`/`uploaded_by`/`uploaded_by_name`/
            # `uploaded_at` would have been dropped here on every read — the
            # exact bug that lost `size` on the way in. A copy carries whatever
            # the model gains next without anyone having to remember this line.
            refreshed.append(a.model_copy(update={"url": fresh_url or a.url}))
        else:
            refreshed.append(a)
    task.attachments = refreshed
    return task

def _pj(v, d):
    """Parse a JSONB column that asyncpg may hand back as str or as a decoded value.

    Module level because two attachment endpoints already called it as `pj`
    from module scope, where it did not exist — it was nested inside
    row_to_task. Both of those raised NameError on every request.
    """
    if isinstance(v, str): return json.loads(v)
    return v if v is not None else d


def row_to_task(r) -> TaskOut:
    """Convert an asyncpg Record from the tasks table to a TaskOut Pydantic model."""
    pj = _pj
    def col(key,default=None):
        try:
            if key in r: return r[key]
        except (KeyError,TypeError): pass
        return default
    return TaskOut(
        task_id=r["task_id"],user_id=r["user_id"],team_id=r["team_id"],column_id=r.get("column_id"),
        created_by_user_id=r["created_by_user_id"],assigned_by_user_id=r["assigned_by_user_id"],
        completed_by_user_id=r["completed_by_user_id"],title=r["title"],description=r["description"],
        status=r["status"],priority=r["priority"],category_id=r["category_id"],
        tags=list(r["tags"] or []),assignee_user_ids=list(r["assignee_user_ids"] or []),
        assignee_emails=list(r["assignee_emails"] or []),assignee_names=list(col("assignee_names") or []),
        due_at=r["due_at"],reminder_at=r["reminder_at"],reminder_sent_at=r["reminder_sent_at"],
        recurrence=Recurrence(rule=r["recurrence_rule"] or "none",interval=r["recurrence_interval"] or 1),
        estimated_minutes=r["estimated_minutes"],
        attachments=[Attachment(**a) for a in pj(r["attachments"],[])],
        custom_fields=pj(r["custom_fields"],{}),
        subtasks=[Subtask(**s) for s in pj(r["subtasks"],[])],
        order=r["sort_order"] or 0,created_at=r["created_at"],updated_at=r["updated_at"],
        completed_at=r["completed_at"],
        approval_status=col("approval_status"),approval_notes=col("approval_notes"),
        approved_by=col("approved_by"),approval_requested_at=col("approval_requested_at"),
        approval_decided_at=col("approval_decided_at"),requires_approval=bool(col("requires_approval",False)),
        created_by_name=col("created_by_name"),archived_at=col("archived_at"),
    )


# ── Routes ─────────────────────────────────────────────

@api_router.get("/")
async def root():
    """Return a simple health-check payload confirming the API is running."""
    return {"message":"Kartavaya API v2","by":"Aekam Inc","status":"ok"}

# `/auth/me` and `/auth/logout` were ALSO defined here, on `api_router`, and both
# were shadowed — `auth_router` mounts at line ~3005 and `api_router` at ~3009, so
# the first match won and these never served a request.
#
# Removed rather than left, because they were only ever one line from serving. The
# two implementations were not variants of each other:
#
#   · `auth_router`'s `/me` reads `staging.user_roles` and returns `platform_roles`
#     and `module_grants`. The nav is built from those — `navConfig.js:126` names
#     `auth_router.py::_module_grants` by hand. The version here returned a flat
#     profile with neither, so had the mount order ever been reordered the whole
#     RBAC-driven nav would have silently emptied, with no error anywhere.
#   · `auth_router`'s `/logout` honours `_COOKIE_SECURE` and `_COOKIE_DOMAIN`. This
#     one hardcoded `secure=True` and passed no domain, so it could not reliably
#     clear a cookie it had not set the same way.
#
# Two handlers on one path is not a duplicate to tidy later; it is a behaviour
# change waiting on an unrelated edit to `include_router` ordering.


# ── Mobile: push tokens ───────────────────────────────────────────────────────

@api_router.post("/me/push_tokens")
async def register_push_token(body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Register or refresh a mobile push token for the authenticated user."""
    platform  = body.get("platform","unknown")
    token     = body.get("token","")
    device_id = body.get("device_id","")
    if not token or not device_id:
        raise HTTPException(400,"token and device_id are required")
    await pool.execute("""
        INSERT INTO push_tokens (user_id,platform,token,device_id)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (device_id) DO UPDATE SET token=EXCLUDED.token, user_id=EXCLUDED.user_id, platform=EXCLUDED.platform
    """, user["user_id"], platform, token, device_id)
    return {"ok":True}

@api_router.delete("/me/push_tokens/{device_id}")
async def unregister_push_token(device_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Remove a mobile push token by device ID for the authenticated user."""
    await pool.execute("DELETE FROM push_tokens WHERE device_id=$1 AND user_id=$2", device_id, user["user_id"])
    return {"ok":True}


# ── Mobile: notification prefs ────────────────────────────────────────────────

# The vocabulary lives in push_service, which is what actually enforces it.
# This module used to carry a byte-identical copy, which had already drifted:
# push_service gained a `reminder` kind that this copy did not have, so the
# switch was enforced on delivery and invisible in the UI. One definition.
from services.push_service import (        # noqa: E402
    DEFAULT_PREFS,
    DEFAULT_QUIET_START,
    DEFAULT_QUIET_END,
    dnd_enabled,
    encode_window,
    normalise_prefs,
)

@api_router.get("/me/notification_prefs")
async def get_notification_prefs(pool=Depends(get_db),user=Depends(require_user)):
    """Return the authenticated user's notification preferences merged with defaults."""
    row = await pool.fetchrow("SELECT prefs, quiet_start, quiet_end FROM notification_prefs WHERE user_id=$1", user["user_id"])
    if not row:
        return {
            "prefs": DEFAULT_PREFS,
            "quiet_start": DEFAULT_QUIET_START,
            "quiet_end": DEFAULT_QUIET_END,
            "dnd": dnd_enabled(DEFAULT_QUIET_START, DEFAULT_QUIET_END),
        }
    import json as _json
    prefs = row["prefs"] if isinstance(row["prefs"], dict) else _json.loads(row["prefs"] or "{}")
    # Drop stored junk before merging, so the UI is never handed a mode it has
    # no switch position for. Same normalisation the delivery side applies.
    merged = {**DEFAULT_PREFS, **normalise_prefs(prefs)}
    q_start = row["quiet_start"] or DEFAULT_QUIET_START
    q_end   = row["quiet_end"] or DEFAULT_QUIET_END
    on = dnd_enabled(q_start, q_end)
    return {
        "prefs": merged,
        # Kept for the mobile client, which reads these two names today.
        "quiet_start": q_start,
        "quiet_end": q_end,
        # `dnd` is what the designed switch binds to (09-customization.md,
        # SetCustomize.jsx). Derived, not stored — see push_service.dnd_enabled.
        # When off, the times are the defaults to show in the disabled fields
        # rather than the 00:00/00:00 that encodes "off", which would read as a
        # real window the user never chose.
        "dnd": on,
        "dnd_from": q_start if on else DEFAULT_QUIET_START,
        "dnd_to":   q_end if on else DEFAULT_QUIET_END,
    }

@api_router.put("/me/notification_prefs")
async def set_notification_prefs(body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Save notification preferences and quiet-hours window for the authenticated user.

    Two things this used to get wrong.

    It stored `body["prefs"]` verbatim — any key, any value, any depth, straight
    into jsonb — so a mode could become "Off" or a nested object and every later
    read had to guess. `normalise_prefs` keeps known kinds with valid modes and
    drops the rest, rather than 400ing a client that is one version ahead.

    And it read `body.get("quiet_start", "22:00")`, so a request that OMITTED the
    field did not leave it alone, it reset it to the default. A client sending
    only `{"prefs": {...}}` to flip one switch silently overwrote a customised
    overnight window and reported success. Passing the stored pair as `current`
    makes an omitted field mean "unchanged", which is what callers already
    assume it means.
    """
    import json as _json
    current = await pool.fetchrow(
        "SELECT quiet_start, quiet_end FROM notification_prefs WHERE user_id=$1",
        user["user_id"],
    )
    # NULL columns must read as the defaults, not as a zero-length window —
    # otherwise a row with NULL quiet hours would be taken as "DND off" and a
    # save that never mentioned DND would silently switch it off.
    cur_pair = (
        (current["quiet_start"] or DEFAULT_QUIET_START,
         current["quiet_end"] or DEFAULT_QUIET_END)
        if current else None
    )

    # `dnd` is the designed switch; `dnd_from`/`dnd_to` are its fields. The older
    # `quiet_start`/`quiet_end` names stay accepted so the mobile client keeps
    # working. Omitting `dnd` entirely means "leave the switch where it is".
    start = body.get("dnd_from", body.get("quiet_start"))
    end   = body.get("dnd_to",   body.get("quiet_end"))
    if "dnd" in body:
        quiet_start, quiet_end = encode_window(
            bool(body["dnd"]), start, end, current=cur_pair,
        )
    else:
        quiet_start, quiet_end = encode_window(
            dnd_enabled(*cur_pair) if cur_pair else True, start, end, current=cur_pair,
        )
    prefs = normalise_prefs(body.get("prefs", {}))
    await pool.execute("""
        INSERT INTO notification_prefs (user_id, prefs, quiet_start, quiet_end)
        VALUES ($1, $2::jsonb, $3, $4)
        ON CONFLICT (user_id) DO UPDATE
          SET prefs=$2::jsonb, quiet_start=$3, quiet_end=$4, updated_at=NOW()
    """, user["user_id"], _json.dumps(prefs), quiet_start, quiet_end)
    return {"ok":True}


@api_router.get("/projects/{team_id}/columns",response_model=List[ProjectColumnOut])
async def list_columns(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Return all kanban columns for the given project, creating defaults if none exist."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,"Not a project member")
    await ensure_default_columns(pool,team_id)
    rows=await pool.fetch("SELECT * FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC",team_id)
    return [ProjectColumnOut(**dict(r)) for r in rows]

@api_router.post("/projects/{team_id}/columns",response_model=ProjectColumnOut)
async def create_column(team_id:str,payload:ProjectColumnCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a new kanban column in the given project."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403,"Owner or admin required")
    max_order=await pool.fetchval("SELECT COALESCE(MAX(sort_order),-1) FROM project_columns WHERE team_id=$1",team_id)
    column_id=f"col_{uuid.uuid4().hex[:12]}"
    row=await pool.fetchrow("INSERT INTO project_columns (column_id,team_id,name,color,sort_order,is_done) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        column_id,team_id,payload.name.strip(),payload.color,max_order+1,payload.is_done)
    return ProjectColumnOut(**dict(row))

@api_router.put("/projects/{team_id}/columns/{column_id}",response_model=ProjectColumnOut)
async def update_column(team_id:str,column_id:str,payload:ProjectColumnUpdate,pool=Depends(get_db),user=Depends(require_user)):
    """Update name, colour, done-flag, or sort order of a project column."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    updates,vals=[],[]
    if payload.name is not None:       updates.append(f"name=${len(vals)+1}");       vals.append(payload.name.strip())
    if payload.color is not None:      updates.append(f"color=${len(vals)+1}");      vals.append(payload.color)
    if payload.is_done is not None:    updates.append(f"is_done=${len(vals)+1}");    vals.append(payload.is_done)
    if payload.sort_order is not None: updates.append(f"sort_order=${len(vals)+1}"); vals.append(payload.sort_order)
    if not updates: raise HTTPException(400,"Nothing to update")
    updates.append(f"updated_at=${len(vals)+1}"); vals.append(now_utc()); vals+=[team_id,column_id]
    row=await pool.fetchrow(f"UPDATE project_columns SET {', '.join(updates)} WHERE team_id=${len(vals)-1} AND column_id=${len(vals)} RETURNING *",*vals)
    if not row: raise HTTPException(404)
    return ProjectColumnOut(**dict(row))

@api_router.delete("/projects/{team_id}/columns/{column_id}")
async def delete_column(team_id:str,column_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Delete a project column, moving its tasks to the next available column."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    remaining=await pool.fetchval("SELECT COUNT(*) FROM project_columns WHERE team_id=$1",team_id)
    if remaining<=1: raise HTTPException(400,"Cannot delete the last column")
    first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 AND column_id!=$2 ORDER BY sort_order ASC LIMIT 1",team_id,column_id)
    if first_col: await pool.execute("UPDATE tasks SET column_id=$1 WHERE column_id=$2",first_col["column_id"],column_id)
    await pool.execute("DELETE FROM project_columns WHERE team_id=$1 AND column_id=$2",team_id,column_id)
    return {"ok":True}

@api_router.post("/projects/{team_id}/columns/reorder")
async def reorder_columns(team_id:str,body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Reorder project columns according to the provided ordered_ids list."""
    mem=await is_project_member(pool,team_id,user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    ordered_ids = body.get("ordered_ids", [])
    if not isinstance(ordered_ids, list): raise HTTPException(400,"ordered_ids must be a list")
    if len(ordered_ids) > 100: raise HTTPException(400,"Too many columns in reorder request")
    if ordered_ids:
        values_sql = ",".join(f"(${i*2+1}::int, ${i*2+2}::text)" for i in range(len(ordered_ids)))
        params = []
        for idx, cid in enumerate(ordered_ids):
            params.extend([idx, cid])
        await pool.execute(
            f"UPDATE project_columns SET sort_order=v.idx "
            f"FROM (VALUES {values_sql}) AS v(idx, column_id) "
            f"WHERE project_columns.column_id=v.column_id AND project_columns.team_id=${ len(params)+1 }",
            *params, team_id,
        )
    return {"ok":True}

# ── Client-scoped endpoints ──────────────────────────────────────────

#: Six internal statuses collapse to three. `in_review` means nothing to a
#: client; "With us" and "With you" answer the only question they have, which is
#: whether the ball is in their court. `19-client-portal.md` requires that this
#: mapping live in the serializer "so the portal cannot drift from it".
CLIENT_STATE_WITH_US  = "with_us"
CLIENT_STATE_WITH_YOU = "with_you"
CLIENT_STATE_DONE     = "done"

def _client_state(task: "TaskOut") -> str:
    """`pending_client` outranks status: a task can be `in_review` AND waiting on
    the client at once, and the waiting is the part they act on. `rejected` is
    With us — the client asked for changes and the firm has them."""
    if task.approval_status == "pending_client": return CLIENT_STATE_WITH_YOU
    if task.status == "done":                    return CLIENT_STATE_DONE
    return CLIENT_STATE_WITH_US

def _client_ref(task_id: Optional[str]) -> str:
    """`#a1b2c3`. Never a sequential integer — that counts the firm's customers."""
    return f"#{str(task_id)[-6:]}" if task_id else ""

def _client_files(task: "TaskOut") -> List[ClientAttachmentOut]:
    """Attachments reduced to the four fields a client may see."""
    return [
        ClientAttachmentOut(
            name=a.name or "Attachment", url=a.url, size=a.size,
            shared_by=a.uploaded_by_name, shared_at=a.uploaded_at,
        )
        for a in (task.attachments or []) if a.url
    ]

def _to_client_task(task: "TaskOut", uid: str) -> ClientTaskOut:
    """Build the client shape from an already-attachment-filtered TaskOut.

    Every field is written out by hand. Nothing spreads the source model — a
    spread is how a field added upstream next month arrives here without anyone
    deciding that it should.
    """
    decided = task.approved_by == uid and task.approval_status in ("approved", "rejected")
    return ClientTaskOut(
        task_id=task.task_id,
        ref=_client_ref(task.task_id),
        title=task.title or "Untitled",
        # The description is what the firm wrote for the client to read. It is
        # the only prose that crosses; comments never do — they are gated
        # separately on `task_comments.is_client_visible`.
        note=task.description or "",
        state=_client_state(task),
        expected_at=task.due_at,
        updated_at=task.updated_at or task.created_at,
        created_at=task.created_at,
        requested_by=task.created_by_name,
        project_id=task.team_id,
        files=_client_files(task),
        decision=ClientDecisionOut(
            outcome=task.approval_status, note=task.approval_notes or "",
            at=task.approval_decided_at,
        ) if decided else None,
        awaiting_me=task.approval_status == "pending_client",
    )

@api_router.get("/client/tasks",response_model=List[ClientTaskOut])
async def client_tasks(pool=Depends(get_db),user=Depends(require_user)):
    """Return the caller's own tasks, in the client shape.

    Three things were wrong here and all three are fixed below.

    1. The response model was `TaskOut`, so `assignee_names`, `assignee_emails`,
       `estimated_minutes`, `custom_fields` and `subtasks` all crossed to an
       external party. It is now `ClientTaskOut`, an allow-list.
    2. `_filter_private_attachments` was never applied — uniquely among the task
       reads — so files a firm had marked private went to the client WITH LIVE
       SIGNED R2 URLS. It is applied now, and before the URLs are re-signed, so
       a private file is not even handed a fresh URL on the way out.
    3. The `project_assignments` clause returned every task in a project the
       client was assigned to, including work assigned to firm members they have
       never met. It is now narrowed to tasks that are genuinely theirs: they
       raised it, they are on it, it was explicitly shared with them via
       `task_clients`, their sign-off is the gate, or they already decided it.
    """
    uid = user["user_id"]
    rows=await pool.fetch("""
        SELECT t.*,
               COALESCE(cu.full_name,cu.name,cu.email) AS created_by_name
        FROM tasks t
        LEFT JOIN users cu ON cu.user_id=t.created_by_user_id
        WHERE t.archived_at IS NULL
          AND (t.created_by_user_id=$1
           OR $1=ANY(t.assignee_user_ids)
           OR t.approved_by=$1
           OR EXISTS(SELECT 1 FROM task_clients tc WHERE tc.task_id=t.task_id AND tc.user_id=$1)
           OR (t.approval_status='pending_client'
               AND EXISTS(SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1)))
        ORDER BY t.updated_at DESC
    """, uid)
    out: List[ClientTaskOut] = []
    for r in rows:
        task = row_to_task(r)
        # Filter BEFORE re-signing: a private attachment the caller may not see
        # should never be handed a fresh signed URL, even transiently.
        task = _filter_private_attachments(task, uid, r["created_by_user_id"] == uid)
        task = await _refresh_task_attachments(pool, task)
        out.append(_to_client_task(task, uid))
    return out

@api_router.get("/client/projects", response_model=List[ClientProjectOut])
async def client_projects(pool=Depends(get_db),user=Depends(require_user)):
    """Return the projects this client is on, in the client shape.

    The SELECT was `t.*` and the return was `[dict(r) for r in rows]`, so the
    whole `teams` row reached an external browser: `created_by`, `org_id`,
    `brand_settings`, `deleted_at` and the rest. The portal used `team_id` and
    `name`. Those are now the only two columns read and the only two that
    cross — the same allow-list argument as `ClientTaskOut`, applied to the one
    client endpoint that had been left on a raw row.
    """
    rows=await pool.fetch("""
        SELECT DISTINCT ON (t.team_id) t.team_id, t.name, t.created_at
        FROM teams t
        WHERE t.deleted_at IS NULL AND (
            EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1)
            OR EXISTS (
                SELECT 1 FROM staging.user_roles ur
                WHERE ur.user_id=$1 AND ur.org_id=t.org_id
                  AND ur.role_code IN ('org_owner','org_admin','org_member')
                  AND t.org_id IS NOT NULL
            )
        )
        ORDER BY t.team_id, t.created_at DESC
    """,user["user_id"])
    return [ClientProjectOut(project_id=r["team_id"], name=r["name"] or "Project") for r in rows]

@api_router.get("/client/approvals", response_model=List[ClientApprovalOut])
async def client_approvals(pool=Depends(get_db), user=Depends(require_user)):
    """Return the approvals that are genuinely this client's, in the client shape.

    The first result set used to be scoped only by `project_assignments` on
    `a.team_id`, so a client assigned to a project was handed THE FIRM'S OWN
    pending approval queue for that project — internal staff requests they have
    no part in — and every row carried `requested_by_email`, a staff email
    address. `19-client-portal.md`'s never-see list names exactly that: "team
    member emails and phone numbers beyond the single named contact".

    Now both sets are scoped to approvals the client raised themselves or that
    sit on a task explicitly shared with them, and the response model is an
    allow-list that has no email field to populate. `reviewed_by`,
    `review_notes`, `request_type` and the raw `status` stopped crossing with it
    — the old `SELECT a.*` shipped all four.
    """
    uid = user["user_id"]
    approval_rows, task_rows = await asyncio.gather(
      pool.fetch("""
        SELECT a.approval_id,
               a.task_id,
               t.title                                AS task_title,
               a.request_data,
               a.created_at,
               COALESCE(u.full_name, u.name, u.email) AS requested_by_name
        FROM   approvals a
        JOIN   users u ON u.user_id = a.requested_by
        LEFT   JOIN tasks t ON t.task_id = a.task_id
        WHERE  a.status = 'pending'
          AND  (
                 a.requested_by = $1
              OR EXISTS (
                   SELECT 1 FROM task_clients tc
                   WHERE  tc.task_id = a.task_id AND tc.user_id = $1
                 )
               )
        ORDER BY a.created_at DESC
    """, uid),
      pool.fetch("""
        SELECT
            CONCAT('task_approval--', t.task_id)   AS approval_id,
            t.task_id,
            t.title                                AS task_title,
            jsonb_build_object(
                'title',       t.title,
                'description', t.description
            )                                      AS request_data,
            t.approval_requested_at                AS created_at,
            COALESCE(u.full_name, u.name, u.email) AS requested_by_name
        FROM   tasks t
        JOIN   users u ON u.user_id = t.created_by_user_id
        WHERE  t.approval_status = 'pending_client'
          AND  (
               EXISTS (SELECT 1 FROM project_assignments WHERE team_id = t.team_id AND user_id = $1)
            OR EXISTS (SELECT 1 FROM task_clients WHERE task_id = t.task_id AND user_id = $1)
          )
        ORDER BY t.approval_requested_at DESC NULLS LAST
    """, uid),
    )

    def _shape(r) -> ClientApprovalOut:
        rd = _pj(r["request_data"], {}) or {}
        return ClientApprovalOut(
            approval_id=r["approval_id"],
            task_id=r["task_id"],
            ref=_client_ref(r["task_id"]),
            title=r["task_title"] or "Untitled",
            # The ask, verbatim, as the firm submitted it.
            ask=(rd.get("description") if isinstance(rd, dict) else None) or "",
            requested_by=r["requested_by_name"],
            requested_at=r["created_at"],
        )

    return [_shape(r) for r in approval_rows] + [_shape(r) for r in task_rows]

@api_router.post("/tasks/{task_id}/clients/{target_user_id}")
async def add_client_to_task(task_id:str,target_user_id:str,pool=Depends(get_db),user=Depends(_require_admin)):
    """Grant a client user access to a specific task.

    THE THIRD WRITER OF `task_clients`, and it was the barest of the three: an
    INSERT with no check that the target is a client of that project, or in the
    same organisation, or that the task belongs to the caller's org at all.
    `_require_admin` is a PLATFORM role, so it does not answer any of those.

    Same predicate as both forwards — the grant means the same thing whichever
    route writes it.
    """
    task=await pool.fetchrow("SELECT team_id FROM tasks WHERE task_id=$1",task_id)
    if not task: raise HTTPException(404,"Task not found")
    await assert_client_of_project(pool,team_id=task["team_id"],user_id=target_user_id)
    await pool.execute("INSERT INTO task_clients (id,task_id,user_id,invited_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",f"tc_{uuid.uuid4().hex[:12]}",task_id,target_user_id,user["user_id"])
    return {"ok":True}

@api_router.delete("/tasks/{task_id}/clients/{target_user_id}")
async def remove_client_from_task(task_id:str,target_user_id:str,pool=Depends(get_db),user=Depends(_require_admin)):
    """Revoke a client user's access to a specific task."""
    await pool.execute("DELETE FROM task_clients WHERE task_id=$1 AND user_id=$2",task_id,target_user_id)
    return {"ok":True}

# ── Org settings (brand kit) ──────────────────────────────────────────────────

async def _get_org_settings(pool, org_id: str | None) -> dict:
    """The brand kit OF ONE ORGANISATION.

    `org_settings` was a two-row table keyed on `key` alone — `brand_colors` and
    `brand_fonts`, for the whole database. Every organisation read the same two
    rows and every organisation's save overwrote them. `migrations/126` adds the
    `org_id` and moves the primary key onto `(org_id, key)`; this is the half of
    the fix that lives in code, and the two must ship together (see the report:
    the `ON CONFLICT (org_id, key)` below needs 126's constraint to exist).

    `org_id` None is NOT "any org". `active_org_id` answers None for portal
    clients and for staff whose only membership is an `org_id IS NULL` team, and
    for them there is no brand kit to read — the empty kit is the honest answer
    and the frontend already renders defaults for it. Returning "whatever row
    exists" is precisely the behaviour that made one org's kit everybody's.
    """
    if not org_id:
        return {"brand_colors": [], "brand_fonts": []}
    rows = await pool.fetch(
        "SELECT key, value FROM org_settings "
        "WHERE org_id=$1::uuid AND key IN ('brand_colors','brand_fonts')",
        org_id,
    )
    data = {r["key"]: list(r["value"]) for r in rows}
    return {"brand_colors": data.get("brand_colors", []), "brand_fonts": data.get("brand_fonts", [])}

@api_router.get("/settings")
async def get_org_settings(pool=Depends(get_db), user=Depends(require_user),
                           org=Depends(active_org_id)):
    """Return workspace brand kit (colors + fonts) — readable by all non-client users."""
    return await _get_org_settings(pool, org)

@api_router.put("/settings")
async def update_org_settings(body: dict, pool=Depends(get_db), user=Depends(require_user),
                              org=Depends(active_org_id)):
    """Persist workspace brand kit. Org owner or admin OF THE ACTIVE ORG only.

    Surfaced by widening the sweep in `tests/test_stale_admin_token.py`, which
    could previously only see `!= "admin"`. Same defect class as
    `is_project_member`: the JWT's `users.role` claim survives revocation and
    carries no org. It was also broken for the people it was meant to serve —
    a real org owner's `users.role` is 'member', so this refused them.

    ── AND THEN IT ASKED THE WRONG QUESTION ANYWAY ─────────────────────────────

    `is_org_admin(user["user_id"])` with no org is True for an
    `org_owner`/`org_admin` row in ANY organisation. Paired with a table keyed on
    `key` alone, an admin of one tenant rewrote every tenant's branding in a
    single PUT — a cross-tenant WRITE from a settings screen, with no header to
    forge and nothing to notice it.

    `org` None REFUSES here, where the read degrades to empty. The two are not
    inconsistent: there is no organisation for the caller to be an admin of, so
    the gate has no True to give. Falling back to the unscoped question on the
    None branch is how a half-fix leaves the hole open, and it is the shape this
    package exists to remove.
    """
    if not org or not await is_org_admin(user["user_id"], org):
        raise HTTPException(status_code=403, detail="Admin access required")
    for key in ("brand_colors", "brand_fonts"):
        if key in body:
            await pool.execute(
                "INSERT INTO org_settings(org_id, key, value) VALUES($1::uuid, $2, $3::jsonb) "
                "ON CONFLICT(org_id, key) DO UPDATE SET value = EXCLUDED.value",
                org, key, json.dumps(body[key])
            )
    return await _get_org_settings(pool, org)

# Keep old endpoint as alias so existing frontend code doesn't break mid-deploy
@api_router.put("/settings/brand-colors")
async def update_brand_colors_compat(body: dict, pool=Depends(get_db), user=Depends(require_user),
                                     org=Depends(active_org_id)):
    # Same replacement as `update_org_settings` above — this alias is the same
    # write behind an older path, so it must not be the easier way in. That
    # applies to the org scoping exactly as it applied to the role lookup: an
    # alias that skips the narrowing is the same hole with a different URL.
    if not org or not await is_org_admin(user["user_id"], org):
        raise HTTPException(status_code=403, detail="Admin access required")
    colors = body.get("colors", [])
    await pool.execute(
        "INSERT INTO org_settings(org_id, key, value) VALUES($1::uuid, 'brand_colors', $2::jsonb) "
        "ON CONFLICT(org_id, key) DO UPDATE SET value = EXCLUDED.value",
        org, json.dumps(colors)
    )
    return {"brand_colors": colors}

@api_router.post("/client/tasks/request", response_model=ClientTaskOut)
async def client_request_task(payload:TaskCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a task request from a client user, pending team approval.

    Returns `ClientTaskOut`, the same allow-list its two sibling client reads
    use. It declared `TaskOut` before — the full internal shape, including the
    firm's `custom_fields`, `subtasks`, `estimated_minutes` and assignee
    identifiers. Nothing leaked in practice, because the row is created here and
    is the client's own, so those fields are empty on the way out; it was a shape
    violation, and the shape is what stops the next field added to `TaskOut` from
    crossing to an external party without anyone deciding that it should.

    What did cross was the firm's own internals rather than another client's
    data: `column_id` and `sort_order` (the board structure), `approval_id`, and
    the raw `status='requested'` and `priority` — the triage vocabulary 19's
    never-see list names.
    """
    if user.get("role") != "client":
        raise HTTPException(403, "Only client users can submit task requests")
    if not payload.team_id: raise HTTPException(400,"team_id required")
    assignment=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",payload.team_id,user["user_id"])
    if not assignment: raise HTTPException(403,"Not a project member")
    # Create approval record first
    approval_id=f"approval_{uuid.uuid4().hex[:12]}"
    await pool.execute("INSERT INTO approvals (approval_id,team_id,requested_by,status,request_type,request_data) VALUES ($1,$2,$3,'pending','create',$4)",
        approval_id,payload.team_id,user["user_id"],json.dumps(payload.model_dump(mode="json")))
    # Create actual task with status='requested' so it appears on the board
    first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC LIMIT 1",payload.team_id)
    column_id=first_col["column_id"] if first_col else None
    max_row=await pool.fetchrow("SELECT MAX(sort_order) AS mo FROM tasks WHERE team_id=$1 AND column_id=$2",payload.team_id,column_id)
    next_order=(max_row["mo"] or -1)+1; task_id=f"task_{uuid.uuid4().hex[:12]}"
    actor_name=actor_display(user)
    # mode="json" throughout: Attachment.uploaded_at is a datetime, and a bare
    # model_dump() hands json.dumps a datetime object, which raises.
    atts_json=json.dumps([a.model_dump(mode="json") for a in (payload.attachments or [])])
    # A client request IS a task creation, and one worth a rule ("when a client
    # asks for work, tell the project lead"). It emits with `status='requested'`
    # in the payload, so a rule that only wants real tasks can say so — rather
    # than this path staying silent and every such rule quietly missing half the
    # work the product creates. Transactional because the event must exist if
    # and only if the row does; the surrounding statements are separate
    # autocommits already, so this is the only pairing that matters.
    _org = await _resolve_org_id(pool, payload.team_id)
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row=await _conn.fetchrow("""
                INSERT INTO tasks (task_id,team_id,column_id,created_by_user_id,created_by_name,
                    title,description,status,priority,approval_id,attachments,custom_fields,subtasks,sort_order)
                VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10::jsonb,'{}' ::jsonb,'[]'::jsonb,$11)
                RETURNING *""",
                task_id,payload.team_id,column_id,user["user_id"],actor_name,
                payload.title,payload.description,payload.priority or "medium",approval_id,atts_json,next_order)
            if _org and row:
                from services.niyam.subjects import task_created
                await task_created(_conn, org_id=_org, actor_id=user["user_id"],
                                   task_id=task_id, row=row)
    # Link approval to task
    await pool.execute("UPDATE approvals SET request_data=$1 WHERE approval_id=$2",
        json.dumps({**payload.model_dump(mode="json"),"task_id":task_id}),approval_id)
    # Notify project owners/admins — in-app + email
    try:
        reviewers = await pool.fetch("""
            SELECT u.user_id, u.email,
                   COALESCE(u.full_name, u.name, u.email) AS name,
                   COALESCE(u.receives_approval_emails, TRUE) AS wants_email
            FROM project_assignments pa
            JOIN users u ON u.user_id = pa.user_id
            WHERE pa.team_id=$1 AND pa.role IN ('owner','admin') AND pa.user_id != $2
        """, payload.team_id, user["user_id"])
        team_row = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", payload.team_id)
        project_name = team_row["name"] if team_row else None
        for r in reviewers:
            await create_notification(
                pool, r["user_id"], "approval_request",
                "New task request",
                f"{actor_name} requested: {payload.title}",
                task_id, payload.team_id, "/approvals"
            )
            if r["wants_email"]:
                try:
                    from email_service import send_approval_request_email
                    send_approval_request_email(
                        r["email"], r["name"],
                        requester_name=actor_name,
                        task_title=payload.title,
                        notes=payload.description,
                        project=project_name,
                        priority=payload.priority,
                    )
                except Exception as email_err:
                    logger.warning("approval request email failed: %s", email_err)
    except Exception as notif_err:
        logger.warning("approval request notification failed: %s", notif_err)
    # Same reducer as `/client/tasks`, so a request the client just submitted
    # comes back in exactly the shape the list will hand them a moment later.
    task = row_to_task(row)
    # Filter before re-signing, as at `/client/tasks`. The caller created this
    # row a few lines above, so the filter is a no-op today — it is here so the
    # ordering is the same at all three client task endpoints and stays correct
    # if this ever returns a row the caller did not create.
    task = _filter_private_attachments(task, user["user_id"], True)
    task = await _refresh_task_attachments(pool, task)
    return _to_client_task(task, user["user_id"])

# ── Approvals ───────────────────────────────────────────────────

def _org_scope(team_col: str, idx: int, org: str | None) -> str:
    """`AND the team is in the active org` — one definition, four readers.

    Every predicate on the /approvals surface was a user-only EXISTS over
    `project_assignments` / `team_members`, with no org bind parameter anywhere.
    Those two tables carry no `org_id` of their own, which is precisely why
    `get_visible_team_ids` was re-anchored to `teams`; this is the same move,
    expressed as a fragment so the queue, the history, the counters and the
    project policy list cannot drift apart the way `routers/activity.py` drifted
    from `server.py`.

    `org_id IS NULL` is included for the reason it is included everywhere else:
    2 of the 29 live teams belong to no organisation, so there is no tenant they
    could be leaking from, and dropping them would silently remove those
    projects from the approvals queue of the people who work on them.

    Returns the EMPTY STRING when no org resolved. `active_org_id` answers None
    for portal clients and for staff whose only team has no `org_id`; refusing
    them would turn a leak into an outage on a screen they are entitled to.
    """
    if not org:
        return ""
    return (f" AND EXISTS (SELECT 1 FROM teams tt WHERE tt.team_id={team_col} "
            f"AND (tt.org_id=${idx}::uuid OR tt.org_id IS NULL))")


@api_router.get("/approvals/pending")
async def list_pending_approvals(pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Return all pending approvals and task-level approvals the user can action.

    SCOPED TO THE ACTIVE ORG. An owner who is project owner/admin in three
    organisations saw all three orgs' pending approvals on one screen, because
    every predicate below is constrained by user alone.
    """
    uid = user["user_id"]
    _scope_a = _org_scope("a.team_id", 2, org)
    _scope_t = _org_scope("t.team_id", 2, org)
    _args = (uid,) if not org else (uid, org)
    # Standard approvals table records (task creation requests)
    #
    # `task_title` ADDED 2026-08-08, and the bug it fixes was visible on screen:
    # the tablet's Today column listed three approvals reading "Untitled task".
    #
    # This arm was `SELECT a.*`, and `approvals` HAS a `task_id` column but no
    # title. The mobile client classifies a row with a string `task_id` as a
    # task approval (`api/approvals.isTaskApproval`) and then looks for
    # `task_title`, which was never sent — so it fell back to its honest label
    # and printed it three times. The client was right; the response was
    # incomplete, which is the same shape as the audit log that could not name
    # anyone, and no frontend change could have fixed either.
    #
    # COALESCE, not a plain join: this table carries BOTH kinds of row. One
    # names an existing task (join `tasks` for its title) and one is a REQUEST
    # to create a task that does not exist yet, whose intended title lives in
    # `request_data->>'title'`. Either can be null on a malformed row, so the
    # client keeps its fallback — a response is not a guarantee.
    rows = await pool.fetch(f"""
        SELECT a.*, COALESCE(u.full_name,u.name,u.email) AS requester_name,
               u.email AS requested_by_email,
               COALESCE(NULLIF(TRIM(t.title), ''),
                        NULLIF(TRIM(a.request_data->>'title'), '')) AS task_title
        FROM approvals a JOIN users u ON u.user_id=a.requested_by
        LEFT JOIN tasks t ON t.task_id = a.task_id
        WHERE a.status='pending'
        AND EXISTS(SELECT 1 FROM project_assignments WHERE team_id=a.team_id AND user_id=$1 AND role IN('owner','admin'))
        {_scope_a}
        ORDER BY a.created_at DESC
    """, *_args)
    # Task-level approvals (approval_status='pending')
    task_rows = await pool.fetch(f"""
        SELECT
            CONCAT('task_approval--', t.task_id) AS approval_id,
            t.task_id,
            t.title AS task_title,
            t.approval_notes AS notes,
            t.approval_requested_at AS created_at,
            t.team_id,
            t.priority,
            t.due_at AS task_due_at,
            COALESCE(u.full_name, u.name, u.email) AS requester_name,
            u.email AS requested_by_email,
            'task_completion' AS request_type,
            jsonb_build_object('title', t.title, 'description', t.description, 'priority', t.priority) AS request_data
        FROM tasks t
        JOIN users u ON u.user_id = t.created_by_user_id
        WHERE t.approval_status = 'pending'
        AND (
            EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=t.team_id AND tm.user_id=$1 AND tm.role IN ('owner','admin') AND tm.status='active')
        )
        {_scope_t}
        ORDER BY t.approval_requested_at DESC NULLS LAST
    """, *_args)
    return [dict(r) for r in rows] + [dict(r) for r in task_rows]

@api_router.get("/approvals/history")
async def approval_history(pool=Depends(get_db), user=Depends(require_user), org=Depends(active_org_id)):
    """Return approved and rejected task approvals visible to the user.

    Scoped to the active org by the same `_org_scope` fragment /pending uses —
    the queue and its history must not be able to disagree about which company
    they are showing.
    """
    uid = user["user_id"]
    _args = (uid,) if not org else (uid, org)
    task_rows = await pool.fetch(f"""
        SELECT
            CONCAT('task_approval--', t.task_id) AS approval_id,
            t.task_id,
            t.title AS task_title,
            t.approval_status AS status,
            t.approval_notes AS notes,
            t.approval_decided_at AS updated_at,
            COALESCE(u.full_name, u.name, u.email) AS requester_name
        FROM tasks t
        JOIN users u ON u.user_id = t.created_by_user_id
        WHERE t.approval_status IN ('approved','rejected')
        AND t.approval_decided_at IS NOT NULL
        AND (
            EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=t.team_id AND tm.user_id=$1 AND tm.role IN ('owner','admin') AND tm.status='active')
        )
        {_org_scope("t.team_id", 2, org)}
        ORDER BY t.approval_decided_at DESC NULLS LAST
        LIMIT 50
    """, *_args)
    return [dict(r) for r in task_rows]


@api_router.get("/approvals/stats")
async def approval_stats(pool=Depends(get_db), user=Depends(require_user), org=Depends(active_org_id)):
    """Today's decision counts.

    The approvals page derived these by filtering /approvals/history in the
    browser, but that endpoint is capped at 50 rows. On a day with more than 50
    decisions the tiles under-reported — silently, and with a plausible number,
    which is the worst way for a count to be wrong. Counted in SQL against the
    same visibility predicate so the two views cannot disagree.

    "Today" is the caller's civil day in IST, which is the only timezone this
    product operates in; UTC would roll the counter over at 5:30am local.
    """
    uid = user["user_id"]
    _args = (uid,) if not org else (uid, org)
    row = await pool.fetchrow(f"""
        SELECT
            COUNT(*) FILTER (WHERE t.approval_status='approved') AS approved_today,
            COUNT(*) FILTER (WHERE t.approval_status='rejected') AS rejected_today
        FROM tasks t
        WHERE t.approval_status IN ('approved','rejected')
        AND t.approval_decided_at IS NOT NULL
        AND (t.approval_decided_at AT TIME ZONE 'Asia/Kolkata')::date
            = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        AND (
            EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id=t.team_id AND tm.user_id=$1 AND tm.role IN ('owner','admin') AND tm.status='active')
        )
        {_org_scope("t.team_id", 2, org)}
    """, *_args)
    return {
        "approved_today": row["approved_today"] or 0,
        "rejected_today": row["rejected_today"] or 0,
    }


# ── The approval requirement, per project ────────────────────────────────────
#
# `services/task_transitions` refuses a non-approver entering `done` when the
# project requires approval. Without these two routes that would be a policy
# nobody could set — the column would be added by migration 117, read by the
# gate, and left FALSE forever, which is exactly the "renders and does nothing"
# shape the column being replaced already had.
#
# They sit beside /approvals/pending on purpose: the queue and the switch that
# fills it are one surface, and the caller predicate must be the same in both.

_POLICY_PROJECTS_PREDICATE = """
    t.deleted_at IS NULL AND t.archived_at IS NULL AND (
        EXISTS (SELECT 1 FROM project_assignments pa
                 WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
     OR EXISTS (SELECT 1 FROM team_members tm
                 WHERE tm.team_id=t.team_id AND tm.user_id=$1 AND tm.role IN ('owner','admin')
                   AND tm.status='active')
    )
"""

_POLICY_UNAVAILABLE = (
    "The approval requirement is not switched on for this database yet. "
    "Migration 117 adds the setting; until it is applied every project behaves "
    "as it does today."
)


class ApprovalPolicyIn(BaseModel):
    requires_approval: bool


@api_router.get("/approvals/policy")
async def get_approval_policy(pool=Depends(get_db), user=Depends(require_user)):
    """Projects this caller may set the approval requirement on.

    `available` is False on a database where migration 117 has not been applied.
    The panel renders that as a sentence rather than as a dead switch — a toggle
    that flips and changes nothing is the thing this whole change exists to stop
    shipping.
    """
    from services.task_transitions import _teams_has_policy_column
    uid = user["user_id"]
    available = await _teams_has_policy_column(pool)
    col = "COALESCE(t.requires_approval, FALSE)" if available else "FALSE"
    rows = await pool.fetch(f"""
        SELECT t.team_id, t.name, {col} AS requires_approval
        FROM teams t
        WHERE {_POLICY_PROJECTS_PREDICATE}
        ORDER BY t.name
    """, uid)
    return {
        "available": available,
        "projects": [
            {"team_id": r["team_id"], "name": r["name"],
             "requires_approval": bool(r["requires_approval"])}
            for r in rows
        ],
    }


@api_router.patch("/approvals/policy/{team_id}")
async def set_approval_policy(team_id: str, payload: ApprovalPolicyIn,
                              pool=Depends(get_db), user=Depends(require_user)):
    """Turn the approval requirement on or off for one project.

    Gated by the SAME predicate the gate itself uses to decide who may approve —
    `is_project_owner`, with org admin as the escape hatch. Anything narrower
    would let someone be refused by a rule they are also unable to change; a
    module-tier `approver` check would refuse everyone, because role_tiers puts
    "kartavya" in NO_APPROVER_MODULES.
    """
    from services.task_transitions import _teams_has_policy_column, is_task_approver
    if not await _teams_has_policy_column(pool):
        raise HTTPException(400, _POLICY_UNAVAILABLE)
    team = await pool.fetchrow(
        "SELECT team_id, name FROM teams WHERE team_id=$1 AND deleted_at IS NULL", team_id)
    if not team:
        raise HTTPException(404, "That project does not exist, or it was deleted.")
    if not await is_task_approver(pool, team_id, user):
        raise HTTPException(403, "Only a project owner or admin can change the approval requirement.")
    await pool.execute(
        "UPDATE teams SET requires_approval=$1, updated_at=NOW() WHERE team_id=$2",
        payload.requires_approval, team_id)
    return {"team_id": team_id, "name": team["name"],
            "requires_approval": payload.requires_approval}


# ── Task-approval helpers (called by review_approval) ────────────────────────

async def _reject_task_approval(pool, task: dict, task_id: str, notes: str, user: dict) -> dict:
    """Persist a task rejection and notify the requester."""
    await pool.execute(
        "UPDATE tasks SET approval_status='rejected', approved_by=$1, approval_notes=$2,"
        " approval_decided_at=NOW(), updated_at=NOW() WHERE task_id=$3",
        user["user_id"], notes, task_id,
    )
    if task["created_by_user_id"] and task["created_by_user_id"] != user["user_id"]:
        await create_notification(
            pool, task["created_by_user_id"], "rejected",
            f"Task rejected: {task['title']}", notes or "",
            task_id, task["team_id"], "/tasks",
        )
    return {"ok": True, "status": "rejected"}


async def _approve_task_send_client(
    pool, task: dict, task_id: str, notes: str, client_email: str, user: dict
) -> dict:
    """Approve by forwarding to a client for final sign-off; sends magic-link email."""
    client = await pool.fetchrow(
        "SELECT user_id, COALESCE(full_name,name) AS name FROM users WHERE LOWER(email)=$1",
        client_email.lower(),
    )
    if not client:
        raise HTTPException(404, "Client user not found with that email")
    # THE SECOND FORWARD, and it is a separate function with the same defect —
    # `WHERE LOWER(email)=$1` over the whole `users` table. Guarding
    # `approvals_router.request_client_approval` and not this one would leave a
    # gate that six callers honour and the seventh walks around, which is
    # exactly the shape that shipped on the task-approval gate.
    await assert_client_of_project(pool, team_id=task.get("team_id"), user_id=client["user_id"])
    await pool.execute(
        "INSERT INTO task_clients (id,task_id,user_id,invited_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        f"tc_{uuid.uuid4().hex[:12]}", task_id, client["user_id"], user["user_id"],
    )
    import jwt as _jwt_local
    token = _jwt_local.encode(
        {
            "task_id": task_id, "client_user_id": client["user_id"],
            "type": "client_approval",
            "exp": datetime.now(timezone.utc).timestamp() + 86400 * 7,
        },
        _JWT_SECRET, algorithm="HS256",
    )
    await pool.execute(
        "UPDATE tasks SET approval_status='pending_client', approval_requested_at=NOW(),"
        " approval_notes=$1, updated_at=NOW() WHERE task_id=$2",
        notes, task_id,
    )
    try:
        from email_service import send_approval_request_email
        approver_name = actor_display(user, "Team")
        send_approval_request_email(
            client_email, client["name"] or client_email,
            approver_name, task["title"],
            notes=notes, approve_token=token,
        )
    except Exception as exc:
        logger.warning("client approval email failed: %s", exc)
    return {"ok": True, "status": "pending_client"}


async def _approve_task_mark_done(
    pool, task: dict, task_id: str, notes: str, user: dict
) -> dict:
    """Approve by moving the task to the done column."""
    done_col = await pool.fetchrow(
        "SELECT column_id FROM project_columns WHERE team_id=$1 AND is_done=TRUE"
        " ORDER BY sort_order DESC LIMIT 1",
        task["team_id"],
    )
    new_col_id = done_col["column_id"] if done_col else task["column_id"]
    # This write sets status='done', and EVERY path that writes tasks.status
    # emits — subjects.py's founding contract. This one went silent for months
    # because its SQL begins `UPDATE tasks SET approval_status=`, which is
    # exactly the spelling the parity ratchet did not look for: a rule on
    # "when a task is finished" fired from the board and the edit form but
    # not from an approval, which is precisely when somebody asked to be told.
    from services.niyam.subjects import task_status_changed
    _org = await _resolve_org_id(pool, task["team_id"])
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            _before = await _conn.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
            _after = await _conn.fetchrow(
                # `$1::text` on the SECOND use, and it is not decoration.
                #
                # `$1` is assigned to two columns that are NOT the same type —
                # `tasks.approved_by` is `character varying` and
                # `tasks.completed_by_user_id` is `text` — so Postgres deduced a
                # different type for the same parameter from each side and refused
                # the whole statement:
                #
                #     AmbiguousParameterError: inconsistent types deduced for parameter $1
                #     DETAIL: character varying versus text
                #
                # Which means **approving a task always returned 500**. The request
                # could be raised and appeared in the queue, and the decision could
                # never be recorded. Rejecting was unaffected: it sets `approved_by`
                # alone, so there was only ever one type to deduce.
                #
                # BOTH uses are cast, not just one. Casting only the second flipped
                # the error to "text versus character varying" and left it failing:
                # the uncast `approved_by=$1` still deduced varchar from its own
                # side, so there were still two deductions for one parameter.
                # Pinning both sides to `text` leaves Postgres with a single
                # answer, and assigning text to the varchar column is an ordinary
                # widening.
                #
                # The columns should also be reconciled to one type, but that is a
                # migration on a shared database; this is the change that stops
                # the 500.
                "UPDATE tasks SET approval_status='approved', approved_by=$1::text, approval_notes=$2,"
                " approval_decided_at=NOW(), column_id=$3, status='done',"
                " completed_at=NOW(), completed_by_user_id=$1::text, updated_at=NOW() WHERE task_id=$4"
                " RETURNING *",
                user["user_id"], notes, new_col_id, task_id,
            )
            if _org and _after:
                await task_status_changed(
                    _conn, org_id=_org, actor_id=user["user_id"],
                    task_id=task_id, old_row=_before, new_row=_after,
                )
    if task["created_by_user_id"] and task["created_by_user_id"] != user["user_id"]:
        await create_notification(
            pool, task["created_by_user_id"], "approved",
            f"Task approved: {task['title']}", notes or "",
            task_id, task["team_id"], "/tasks",
        )
    return {"ok": True, "status": "approved", "new_column_id": new_col_id}


@api_router.post("/approvals/{approval_id}/review")
async def review_approval(approval_id:str,body:dict,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Approve or reject a task creation request or task-level approval."""
    try:
        return await _review_approval_inner(approval_id, body, pool, user, org=org)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("review_approval 500: approval_id=%s error=%s", approval_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Approval error: {type(exc).__name__}: {exc}")

async def _review_approval_inner(approval_id:str,body:dict,pool,user,org:str|None=None):
    """
    ── BOTH ESCAPE HATCHES ARE SCOPED TO THE ACTIVE ORG ───────────────────────

    This is a WRITE. Approving marks the task done and mails the requester;
    rejecting stamps a decision on another firm's record. Both branches below
    used the unscoped `is_org_admin(user["user_id"])`, which is True for an
    `org_owner`/`org_admin` row in ANY organisation, and on True the entire
    project-membership check was skipped — so an org_admin of one small org
    could decide every other tenant's approvals by id.

    Two predicates, both required, exactly as in `get_task` and `delete_task`:
    `is_org_admin(uid, org)` says the caller administers THIS org, and
    `task_is_in_org` says the record is IN it. Either alone still leaves the
    boundary open — the previous pass proved that by scoping only the first.
    """
    status=body.get("status"); notes=body.get("notes","")
    send_to_client = body.get("send_to_client", False)
    client_email   = body.get("client_email", "")
    if status not in ("approved","rejected"): raise HTTPException(400,"status must be approved or rejected")
    if approval_id.startswith("task_approval--"):
        task_id = approval_id.split("--", 1)[1]
        # Must be owner/admin of the project
        task = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
        if not task: raise HTTPException(404, "Task not found")
        is_pa = await pool.fetchrow(
            "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin')",
            task["team_id"], user["user_id"]
        )
        is_tm = await pool.fetchrow(
            "SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin') AND status='active'",
            task["team_id"], user["user_id"]
        )
        is_admin = (await is_org_admin(user["user_id"], org) if org
                    else await is_org_admin(user["user_id"]))
        if is_admin:
            is_admin = await task_is_in_org(
                pool, org, team_id=task["team_id"],
                owner_ids=(task["user_id"], task["created_by_user_id"]))
        if not (is_pa or is_tm or is_admin):
            raise HTTPException(403, "Only project owner/admin can review task approvals")

        if status == "rejected":
            if not notes: raise HTTPException(400, "Rejection reason is required")
            return await _reject_task_approval(pool, dict(task), task_id, notes, user)
        if send_to_client and client_email:
            return await _approve_task_send_client(pool, dict(task), task_id, notes, client_email, user)
        return await _approve_task_mark_done(pool, dict(task), task_id, notes, user)
    approval=await pool.fetchrow("SELECT * FROM approvals WHERE approval_id=$1",approval_id)
    if not approval: raise HTTPException(404)
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",approval["team_id"],user["user_id"])
    if not mem:
        mem = await pool.fetchrow(
            "SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",
            approval["team_id"], user["user_id"]
        )
    is_owner_admin = mem and mem["role"] in ("owner","admin")
    is_system_admin = (await is_org_admin(user["user_id"], org) if org
                       else await is_org_admin(user["user_id"]))
    if is_system_admin:
        # `approvals` rows carry a `team_id` and no owner, so the team IS the
        # tenancy signal here — there is no personal-approval shape to fall back
        # on the way `tasks` has one.
        is_system_admin = await task_is_in_org(
            pool, org, team_id=approval["team_id"])
    if not (is_owner_admin or is_system_admin):
        raise HTTPException(403, "Not authorised to review this approval")
    await pool.execute("UPDATE approvals SET status=$1,reviewed_by=$2,reviewed_at=NOW(),review_notes=$3 WHERE approval_id=$4",status,user["user_id"],notes,approval_id)
    if approval["request_type"]=="create":
        data=json.loads(approval["request_data"])
        existing_task_id=data.get("task_id")
        if status=="approved":
            # A client request being approved IS a status change — `requested`
            # becomes `todo` — and it is one of the more useful things to hang
            # a rule on ("when a client request is approved, tell the project").
            # The emission-parity ratchet found this path silent; it was not a
            # deliberate omission, it was simply never wired.
            from services.niyam.subjects import task_created, task_status_changed
            _org = await _resolve_org_id(pool, approval["team_id"])
            if existing_task_id:
                # Task already exists with status='requested' — promote to 'todo'
                first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order LIMIT 1",approval["team_id"])
                col=first_col["column_id"] if first_col else None
                async with pool.acquire() as _conn:
                    async with _conn.transaction():
                        _before=await _conn.fetchrow("SELECT * FROM tasks WHERE task_id=$1",existing_task_id)
                        _after=await _conn.fetchrow("UPDATE tasks SET status='todo',column_id=COALESCE($1,column_id),updated_at=NOW() WHERE task_id=$2 RETURNING *",col,existing_task_id)
                        if _org and _after:
                            await task_status_changed(_conn, org_id=_org, actor_id=user["user_id"],
                                                      task_id=existing_task_id, old_row=_before, new_row=_after)
            else:
                # Legacy: no task yet — create it
                task_id=f"task_{uuid.uuid4().hex[:12]}"
                col=await pool.fetchval("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order LIMIT 1",approval["team_id"])
                async with pool.acquire() as _conn:
                    async with _conn.transaction():
                        _row=await _conn.fetchrow("INSERT INTO tasks (task_id,team_id,column_id,created_by_user_id,title,description,status,priority,approval_id) VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$8) RETURNING *",
                            task_id,approval["team_id"],col,approval["requested_by"],data["title"],data.get("description"),data.get("priority","medium"),approval_id)
                        if _org and _row:
                            await task_created(_conn, org_id=_org, actor_id=user["user_id"],
                                               task_id=task_id, row=_row)
        elif status=="rejected" and existing_task_id:
            # Remove the 'requested' task since it was declined
            await pool.execute("DELETE FROM tasks WHERE task_id=$1 AND status='requested'",existing_task_id)
        # Email the requester (client) about the decision
        if status == "approved":
            try:
                requester = await pool.fetchrow(
                    "SELECT email, COALESCE(full_name, name, email) AS name FROM users WHERE user_id=$1",
                    approval["requested_by"]
                )
                reviewer_name = actor_display(user, "")
                if requester and requester["email"]:
                    from email_service import send_request_approved_email
                    send_request_approved_email(
                        requester["email"], requester["name"],
                        reviewer_name=reviewer_name,
                        task_title=data.get("title", "your task"),
                    )
            except Exception as _exc:
                logger.warning("request approved email failed: %s", _exc)
    return {"ok":True,"status":status}

# ── Comments ────────────────────────────────────────────────────

#: Cached once per process. `task_comments.is_client_visible` does not exist
#: until PROPOSED_072 is applied, and staging shares a database with production,
#: so this file must run correctly on BOTH schemas. Probing rather than
#: hardcoding means the migration takes effect with no code change and no
#: redeploy — and, critically, that the pre-migration answer is False for every
#: row, which is the fail-closed direction.
_comment_visibility_column: Optional[bool] = None

async def _has_client_visible_column(pool) -> bool:
    global _comment_visibility_column
    if _comment_visibility_column is None:
        _comment_visibility_column = bool(await pool.fetchval(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='task_comments' "
            "AND column_name='is_client_visible'"
        ))
    return _comment_visibility_column

@api_router.get("/tasks/{task_id}/comments",response_model=List[CommentOut])
async def list_comments(task_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Return comments on a task in chronological order.

    A client sees ONLY comments explicitly marked client-visible.
    `19-client-portal.md`'s never-see list opens with "Internal comments. Only
    comments explicitly marked client-visible", and before this the endpoint
    served a client every comment on any task they could reach — the firm's
    internal discussion of their own file, verbatim.

    Until PROPOSED_072 lands there is no flag to be true, so a client gets an
    empty list. That is deliberate: no comments is correct, and guessing which
    internal comments are safe is not.
    """
    is_client = await is_portal_client(user)
    if is_client:
        if not await client_can_access_task(pool, task_id, user["user_id"]):
            raise HTTPException(403, "Not authorised to view comments on this task")
    has_flag = await _has_client_visible_column(pool)
    if not has_flag and is_client:
        return []
    flag_col = "c.is_client_visible" if has_flag else "false AS is_client_visible"
    where = "c.task_id=$1" + (" AND c.is_client_visible IS TRUE" if is_client else "")
    rows=await pool.fetch(
        f"SELECT c.comment_id,c.task_id,c.user_id,COALESCE(u.full_name,u.name) AS user_name,"
        f"c.body,c.created_at,{flag_col} "
        f"FROM task_comments c JOIN users u ON u.user_id=c.user_id "
        f"WHERE {where} ORDER BY c.created_at ASC", task_id)
    return [CommentOut(**dict(r)) for r in rows]

@api_router.post("/tasks/{task_id}/comments",response_model=CommentOut)
async def add_comment(task_id:str,body:CommentCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Add a comment to a task and fan-out notifications to relevant users."""
    author_is_client = await is_portal_client(user)
    if author_is_client:
        if not await client_can_access_task(pool, task_id, user["user_id"]):
            raise HTTPException(403, "Not authorised to comment on this task")
    comment_id=f"cmt_{uuid.uuid4().hex[:12]}"
    # A client's own words are not internal firm data, so a comment authored BY
    # a client is client-visible by definition — otherwise they would post into
    # a thread they cannot read back. Everything an internal user writes stays
    # internal unless they explicitly said otherwise.
    client_visible = True if author_is_client else bool(body.is_client_visible)
    if await _has_client_visible_column(pool):
        row=await pool.fetchrow(
            "INSERT INTO task_comments (comment_id,task_id,user_id,body,is_client_visible) "
            "VALUES ($1,$2,$3,$4,$5) RETURNING *",
            comment_id,task_id,user["user_id"],body.body,client_visible)
    else:
        row=await pool.fetchrow("INSERT INTO task_comments (comment_id,task_id,user_id,body) VALUES ($1,$2,$3,$4) RETURNING *",comment_id,task_id,user["user_id"],body.body)
    try:
        task=await pool.fetchrow("SELECT title,team_id,created_by_user_id,assignee_user_ids FROM tasks WHERE task_id=$1",task_id)
        if task:
            recipients=set()
            if task["created_by_user_id"] and task["created_by_user_id"]!=user["user_id"]: recipients.add(task["created_by_user_id"])
            for uid in (task["assignee_user_ids"] or []):
                if uid!=user["user_id"]: recipients.add(uid)
            cr=await pool.fetch("SELECT user_id FROM task_clients WHERE task_id=$1",task_id)
            for c in cr:
                if c["user_id"]!=user["user_id"]: recipients.add(c["user_id"])
            preview=body.body[:140]+("…" if len(body.body)>140 else "")
            actor_name=actor_display(user)
            for rid in recipients:
                await create_notification(pool,rid,"comment",f"New comment on {task['title']}",f"{actor_name}: {preview}",task_id,task["team_id"],"/tasks")
            if recipients:
                try:
                    from services.push_service import fan_out_push
                    task_owner_ids={task["created_by_user_id"]}|(set(task["assignee_user_ids"] or []))
                    asyncio.create_task(fan_out_push(
                        pool,
                        recipient_ids=list(recipients),
                        kind="comment",
                        title=f"New comment on {task['title']}",
                        body=f"{actor_name}: {preview}",
                        task_id=task_id,
                        is_mine_for=task_owner_ids,
                    ))
                except Exception as _pe:
                    logger.warning("comment push failed: %s", _pe)
            from services.mentions import process_mentions
            await process_mentions(pool,comment_id,body.body,task_id,user["user_id"])
            from services.activity_logger import log_event
            await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="commented",data={"preview":preview[:80]})
    except Exception as e:
        logger.warning("comment fan-out failed: %s", e)
    actor_name=actor_display(user)
    return CommentOut(comment_id=row["comment_id"],task_id=row["task_id"],user_id=row["user_id"],user_name=actor_name,body=row["body"],created_at=row["created_at"],is_client_visible=client_visible)

async def _comment_task_in_org(pool, org: str | None, task_id: str) -> bool:
    """Is the task this comment hangs off inside the active organisation?

    THE SECOND HALF, and neither half is sufficient alone — the same pairing
    `get_task` and `delete_task` already use. `is_org_admin(uid, org)` at the
    call site says the caller administers THIS organisation; this says the
    comment's task is IN it. Scoping only the admin question narrows WHO reaches
    the hatch and says nothing about WHAT the hatch reaches, which is the exact
    shape of the previous half-fix.

    A comment carries no team of its own, so the task is fetched to get one.
    Called only after the admin question has already said yes and only when the
    caller is not the author, so an ordinary edit of your own comment pays for
    neither query.
    """
    task = await pool.fetchrow(
        "SELECT team_id, user_id, created_by_user_id FROM tasks WHERE task_id=$1",
        task_id)
    if not task:
        return False
    return await task_is_in_org(
        pool, org, team_id=task["team_id"],
        owner_ids=(task["user_id"], task["created_by_user_id"]))


@api_router.put("/tasks/{task_id}/comments/{comment_id}",response_model=CommentOut)
async def edit_comment(task_id:str,comment_id:str,body:CommentCreate,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Edit the body of an existing comment; only the author or an admin may do so."""
    row=await pool.fetchrow("SELECT * FROM task_comments WHERE comment_id=$1 AND task_id=$2",comment_id,task_id)
    if not row: raise HTTPException(404)
    # `is_org_admin`, not the JWT's `role` claim. The claim is the legacy
    # users.role column as it stood when the token was minted, so it outlived
    # revocation and could not be scoped to an org — a stale admin token edited
    # anyone's comment in any organisation. Read at request time now, like the
    # rest of this file.
    #
    # AND SCOPED. The request-time read fixed the stale token and left the
    # cross-org half untouched: with no org argument `is_org_admin` is True for
    # an admin row in ANY organisation, and this handler resolved no org at all
    # — no `get_visible_team_ids`, no team predicate, nothing. An org_admin of
    # one small org could rewrite any comment in the database by id.
    if row["user_id"]!=user["user_id"]:
        _admin = (await is_org_admin(user["user_id"], org) if org
                  else await is_org_admin(user["user_id"]))
        if not (_admin and await _comment_task_in_org(pool, org, task_id)):
            raise HTTPException(403,"Can only edit your own comments")
    updated=await pool.fetchrow("UPDATE task_comments SET body=$1 WHERE comment_id=$2 RETURNING *",body.body,comment_id)
    try:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="comment_edited",data={"preview":body.body[:80]})
    except Exception as _e: logger.debug("activity log failed (comment_edited): %s", _e)
    actor_name=actor_display(user)
    # An edit changes the text, never the audience. Re-deciding who may read a
    # comment is a separate, deliberate act; folding it into a body edit would
    # let a typo fix silently publish an internal note to the client.
    return CommentOut(comment_id=updated["comment_id"],task_id=updated["task_id"],user_id=updated["user_id"],user_name=actor_name,body=updated["body"],created_at=updated["created_at"],is_client_visible=bool(updated.get("is_client_visible") or False))

@api_router.delete("/tasks/{task_id}/comments/{comment_id}")
async def delete_comment(task_id:str,comment_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Delete a task comment; only the author or an admin may do so."""
    row=await pool.fetchrow("SELECT user_id FROM task_comments WHERE comment_id=$1 AND task_id=$2",comment_id,task_id)
    if not row: raise HTTPException(404)
    # Same replacement as edit_comment above, and for the same reason — and the
    # same org narrowing, which matters more here: this one is destructive and
    # there is no undo.
    if row["user_id"]!=user["user_id"]:
        _admin = (await is_org_admin(user["user_id"], org) if org
                  else await is_org_admin(user["user_id"]))
        if not (_admin and await _comment_task_in_org(pool, org, task_id)):
            raise HTTPException(403,"Can only delete your own comments")
    await pool.execute("DELETE FROM task_comments WHERE comment_id=$1",comment_id)
    try:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="comment_deleted",data={})
    except Exception as _e: logger.debug("activity log failed (comment_deleted): %s", _e)
    return {"ok":True}

@api_router.post("/tasks/{task_id}/subtasks",response_model=TaskOut)
async def add_subtask(task_id:str,body:Subtask,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Append a new subtask to a task's subtask list."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    # A subtask carries no status, so `assert_transition` never saw these four
    # routes at all. `_SQL_SET_SUBTASKS` is a bare `team_id=ANY(...)` predicate
    # and a client's project is in that array.
    await assert_may_write_task(pool,team_id=task["team_id"],user=user,task_id=task_id)
    subtasks=json.loads(task["subtasks"] or "[]")
    new_sub={"subtask_id":f"sub_{uuid.uuid4().hex[:12]}","title":body.title,"is_done":False,"order":len(subtasks)}
    subtasks.append(new_sub)
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    try:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="subtask_added",data={"title":body.title})
    except Exception as _e: logger.debug("activity log failed (subtask_added): %s", _e)
    return row_to_task(row)

@api_router.patch("/tasks/{task_id}/subtasks/{subtask_id}",response_model=TaskOut)
async def toggle_subtask(task_id:str,subtask_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Toggle the is_done flag on a subtask."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    await assert_may_write_task(pool,team_id=task["team_id"],user=user,task_id=task_id)
    subtasks=json.loads(task["subtasks"] or "[]")
    for s in subtasks:
        if s["subtask_id"]==subtask_id: s["is_done"]=not s.get("is_done",False)
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    return row_to_task(row)

@api_router.delete("/tasks/{task_id}/subtasks/{subtask_id}",response_model=TaskOut)
async def delete_subtask(task_id:str,subtask_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Remove a subtask from a task's subtask list by its ID."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    await assert_may_write_task(pool,team_id=task["team_id"],user=user,task_id=task_id)
    subtasks=json.loads(task["subtasks"] or "[]")
    removed=[s for s in subtasks if s["subtask_id"]==subtask_id]
    subtasks=[s for s in subtasks if s["subtask_id"]!=subtask_id]
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    try:
        from services.activity_logger import log_event
        title=removed[0]["title"] if removed else ""
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="subtask_deleted",data={"title":title})
    except Exception as _e: logger.debug("activity log failed (subtask_deleted): %s", _e)
    return row_to_task(row)

class SubtaskPatch(BaseModel):
    assignee_user_id: Optional[str] = None
    title: Optional[str] = None

@api_router.put("/tasks/{task_id}/subtasks/{subtask_id}",response_model=TaskOut)
async def update_subtask(task_id:str,subtask_id:str,body:SubtaskPatch,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Update the title or assignee of an existing subtask."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    task=await pool.fetchrow(_SQL_GET_SUBTASKS,task_id,team_ids)
    if not task: raise HTTPException(404)
    await assert_may_write_task(pool,team_id=task["team_id"],user=user,task_id=task_id)
    subtasks=json.loads(task["subtasks"] or "[]")
    for s in subtasks:
        if s["subtask_id"]==subtask_id:
            if body.assignee_user_id is not None:
                # Validate the assignee belongs to this task's team
                member=await pool.fetchrow(
                    "SELECT 1 FROM project_assignments WHERE team_id=$1 AND user_id=$2 UNION SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active' LIMIT 1",
                    task["team_id"], body.assignee_user_id
                )
                if not member: raise HTTPException(400,"Assignee is not a member of this project")
                s["assignee_user_id"]=body.assignee_user_id
            if body.title is not None: s["title"]=body.title
    row=await pool.fetchrow(_SQL_SET_SUBTASKS,json.dumps(subtasks),task_id,team_ids)
    if not row: raise HTTPException(404, "Task not found")
    return row_to_task(row)

# ── Teams ────────────────────────────────────────────────────────

@api_router.get("/teams")
async def list_teams(since:Optional[str]=None,
                     pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Projects visible to the caller — or, with `?since=`, those changed since.

    A delta carries BINNED projects too (`deleted_at IS NOT NULL`), because a
    project deleted since the last sync is a change the device has to hear
    about; the client removes any row it receives carrying `deleted_at`. A
    project PURGED outright arrives through `GET /v1/sync/tombstones` instead.
    """
    from datetime import datetime, timezone

    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    synced_at = datetime.now(timezone.utc)
    team_ids=await get_visible_team_ids(pool,user["user_id"],org_id=org)
    if not team_ids:
        return envelope([], since_dt, synced_at) if since_dt is not None else []
    rows=await pool.fetch("""
        SELECT t.*,
          COALESCE(tc.cnt,0)::int AS task_count,
          COALESCE(dc.cnt,0)::int AS done_count
        FROM teams t
        LEFT JOIN (SELECT team_id,COUNT(*) cnt FROM tasks GROUP BY team_id) tc ON tc.team_id=t.team_id
        LEFT JOIN (SELECT team_id,COUNT(*) cnt FROM tasks WHERE status='done' GROUP BY team_id) dc ON dc.team_id=t.team_id
        WHERE t.team_id=ANY($1::text[]) AND ($2::timestamptz IS NOT NULL OR t.deleted_at IS NULL)
          AND ($2::timestamptz IS NULL OR t.updated_at > $2)
        ORDER BY t.updated_at DESC
    """, team_ids, since_dt)
    # `can_admin` resolved for the whole page in two queries rather than one per
    # card: the org question is asked once, and the project roles come back in a
    # single row set.
    admin_here = await is_org_admin(user["user_id"], str(org) if org else None)
    my_admin_teams: set[str] = set()
    if not admin_here:
        mine = await pool.fetch(
            "SELECT team_id FROM project_assignments "
            "WHERE user_id=$1 AND team_id=ANY($2::text[]) AND role IN ('owner','admin') "
            "UNION "
            "SELECT team_id FROM team_members "
            "WHERE user_id=$1 AND team_id=ANY($2::text[]) AND status='active' "
            "  AND role IN ('owner','admin')",
            user["user_id"], team_ids)
        my_admin_teams = {r["team_id"] for r in mine}
    out = []
    for r in rows:
        d = dict(r)
        d["can_admin"] = admin_here or d["team_id"] in my_admin_teams
        out.append(TeamOut(**d))
    if since_dt is not None:
        return envelope([o.model_dump() for o in out], since_dt, synced_at)
    return out

# ── MUST be before GET /teams/{team_id} to avoid "bin" matching as a team_id ──
@api_router.get("/teams/bin")
async def list_deleted_teams(pool=Depends(get_db), user=Depends(require_user),
                             org=Depends(active_org_id)):
    """Soft-deleted projects still inside the restore window.

    ── THIS HAD NO ORG PREDICATE ───────────────────────────────────────────────

    The query was `WHERE t.deleted_at IS NOT NULL` and nothing else — every
    deleted project in the database, every organisation. That was survivable
    only because the route was gated on an Aekam platform role. Opening the bin
    to org admins (which is the point of this change: a customer must be able to
    restore their own project) makes the missing predicate a cross-tenant leak,
    so the scoping lands in the same commit as the gate, not after it.

    Scoped through `get_visible_team_ids`, which is the org-enforced list the
    rest of this file already trusts, then narrowed to the projects this caller
    may actually administer — org admins see the whole org's bin, a project
    owner/admin sees only their own.
    """
    team_ids = await get_visible_team_ids(pool, user["user_id"], org_id=org)
    if not team_ids:
        return []
    rows = await pool.fetch(f"""
        SELECT t.*,
               COALESCE(u.full_name, u.name, u.email) AS deleted_by_name,
               EXTRACT(EPOCH FROM (NOW() - t.deleted_at)) / 86400 AS days_deleted
        FROM teams t
        LEFT JOIN users u ON u.user_id = t.deleted_by
        WHERE t.team_id = ANY($1::text[])
          AND t.deleted_at IS NOT NULL
          AND t.deleted_at > NOW() - INTERVAL '{PROJECT_BIN_DAYS} days'
        ORDER BY t.deleted_at DESC
    """, team_ids)
    out = []
    for r in rows:
        mem = await is_project_member(pool, r["team_id"], user)
        if mem and mem["role"] in ("owner", "admin"):
            out.append(dict(r))
    return out

async def _ensure_default_owner(pool, team_id: str, creator: dict):
    """Add DEFAULT_OWNER_EMAIL as owner on every project, unless they created it themselves."""
    if not DEFAULT_OWNER_EMAIL or creator.get("email", "").lower() == DEFAULT_OWNER_EMAIL.lower():
        return
    owner = await pool.fetchrow("SELECT user_id, email FROM users WHERE email=$1", DEFAULT_OWNER_EMAIL)
    if not owner:
        return
    # team_id is freshly created here, so no existing row can collide —
    # neither table has a unique constraint on (team_id,user_id) to upsert against.
    await pool.execute(
        "INSERT INTO team_members (member_id,team_id,email,user_id,role,status) "
        "VALUES ($1,$2,$3,$4,'owner','active')",
        f"mem_{uuid.uuid4().hex[:12]}", team_id, owner["email"], owner["user_id"],
    )
    await pool.execute(
        "INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by) "
        "VALUES ($1,$2,$3,'owner',$4)",
        f"assign_{uuid.uuid4().hex[:12]}", team_id, owner["user_id"], owner["user_id"],
    )


@api_router.post("/teams",response_model=TeamOut)
async def create_team(payload:TeamCreate,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Create a new project and set the caller as owner with default kanban columns."""
    team_id=f"team_{uuid.uuid4().hex[:12]}"
    bs = json.dumps(payload.brand_settings or {"colors":[],"fonts":[]})
    # org_id is SET HERE, and it is load-bearing rather than tidy metadata.
    #
    # `get_visible_team_ids` resolves an org_owner/org_admin's projects as
    # "every team in my org" — `SELECT team_id FROM teams WHERE org_id=$1`
    # (server.py:383). This INSERT never set org_id, so every project an
    # administrator created landed with org_id NULL and was invisible to the
    # person who had just created it. Measured live: two POSTs returned 200 and
    # the page still read "No projects yet".
    #
    # It did NOT affect ordinary members, which is why it survived: their branch
    # of that query UNIONs `project_assignments` and `team_members`, and both of
    # those rows ARE written below. Only the org-scoped branch reads org_id, and
    # only administrators take it — the same people who create projects.
    #
    # Resolved from `staging.user_roles`, the sole tenant path, taking the
    # earliest grant so it matches the org `middleware/org_resolver.py` falls
    # back to when no `X-Org-Id` header is sent. A user with no org row gets
    # NULL, exactly as before, so nothing that worked before starts failing.
    #
    # THE ACTIVE ORG FIRST, and only then the earliest grant. This inline query
    # was a THIRD copy of the resolution (`org_resolver`'s fallback and
    # `_home_org_id` being the other two), and being header-blind it filed every
    # project the owner created while switched to E2E Test under Aekam Inc —
    # then `get_visible_team_ids`, scoped to E2E Test, could not show it back to
    # them. A read that shows the wrong org is a bad afternoon; a WRITE that
    # lands in the wrong org is a row somebody has to go and move.
    org_id = org or await _home_org_id(pool, user["user_id"])
    row=await pool.fetchrow(
        "INSERT INTO teams (team_id,name,created_by,brand_settings,org_id) "
        "VALUES ($1,$2,$3,$4::text::jsonb,NULLIF($5,'')::uuid) RETURNING *",
        team_id,payload.name,user["user_id"],bs,org_id or "")
    await pool.execute("INSERT INTO team_members (member_id,team_id,email,user_id,role,status) VALUES ($1,$2,$3,$4,'owner','active')",f"mem_{uuid.uuid4().hex[:12]}",team_id,user["email"],user["user_id"])
    await pool.execute("INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by) VALUES ($1,$2,$3,'owner',$4)",f"assign_{uuid.uuid4().hex[:12]}",team_id,user["user_id"],user["user_id"])
    await _ensure_default_owner(pool,team_id,creator=user)
    await ensure_default_columns(pool,team_id)
    return TeamOut(**dict(row))

@api_router.patch("/teams/{team_id}/brand")
async def update_team_brand(team_id:str, body:dict, pool=Depends(get_db), user=Depends(require_user)):
    """Update a project's brand kit (colors + fonts). Owner/admin of the project only."""
    mem = await is_project_member(pool, team_id, user)
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    await pool.execute(
        "UPDATE teams SET brand_settings=$1::jsonb, updated_at=NOW() WHERE team_id=$2",
        json.dumps(body), team_id
    )
    return {"ok": True}

@api_router.get("/users")
async def list_users(request:Request,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Users available to add to a project — the member picker.

    This used to return every registered user on the platform: display name,
    email, role and company, for every tenant, gated on `users.role == 'admin'`
    — a global column with no org scope on it at all. Two things were wrong.
    Whoever held that flag saw every customer's staff directory, and an actual
    org owner did not (their `users.role` is 'member'), so the picker was
    simultaneously too open and broken for the people meant to use it.

    Now: platform staff see everyone, because supporting a customer means being
    able to find their users. An org owner or admin sees their own org. Nobody
    else gets a directory.

    ── AEKAM DOES NOT SEE CUSTOMER EMAIL ADDRESSES ─────────────────────────────

    Changed 2026-08-07 on the owner's instruction: "Aekam must not be able to see
    client personal data, and orgs must not see each other's."

    The platform branch above returned `email` for EVERY user of EVERY tenant, to
    all eight platform roles, and left no audit row — so a support account could
    read the whole customer base's address book and nothing recorded that it had.
    Two changes:

      · The branch selects a NAME and the organisations that name belongs to. It
        does not select `email`, and `display_name` no longer COALESCEs down to
        one — which was the same leak wearing a different column name. A user
        with no name on file is listed as such, which is enough to find them and
        then ask.
      · Reading the platform-wide directory now writes `platform.user_directory_
        read`. Reading a customer's data is the event this product's audit log
        exists to record, and the org branch below needs no row for the same
        reason: it is an org's own admin reading their own members.

    Contact details are not gone, they are gated: the approved support-session
    flow (`routers/support_sessions.py`) is where an Aekam account asks for
    access to one organisation, gets it granted, and leaves a row saying so.
    Billing surfaces get seat COUNTS, never a roster.
    """
    from middleware.roles import is_platform_staff, admin_org_id

    if await is_platform_staff(user["user_id"]):
        rows = await pool.fetch(
            # No `email`, and no COALESCE onto it. The org names come from
            # `user_roles`, the sole tenant path, so support can still tell two
            # people with the same name apart by who they work for — which is
            # the whole reason the directory exists.
            "SELECT u.user_id, "
            "       COALESCE(NULLIF(TRIM(u.full_name),''), NULLIF(TRIM(u.name),''), "
            "                'Name not on file') AS display_name, "
            "       u.role, u.company_name, "
            "       COALESCE(ARRAY_AGG(DISTINCT o.name) FILTER (WHERE o.name IS NOT NULL), "
            "                '{}')::text[] AS orgs "
            "FROM users u "
            "LEFT JOIN staging.user_roles ur ON ur.user_id = u.user_id "
            "LEFT JOIN staging.organisations o ON o.id = ur.org_id "
            # The per-org Niyam automation accounts (migration 148) hold no
            # user_roles row, so every org-scoped list already misses them --
            # this LEFT JOIN over ALL of public.users is the one directory in
            # the product that would still show them.
            "WHERE NOT COALESCE(u.is_system, FALSE) "
            "GROUP BY u.user_id, u.full_name, u.name, u.role, u.company_name "
            "ORDER BY display_name ASC"
        )
        _audit_emit(
            "platform.user_directory_read",
            request,
            user_id=user["user_id"],
            org_id=org,
            detail={"rows": len(rows)},
            severity="warn",
        )
        return [dict(r) for r in rows]

    # Scoped to the ACTIVE org: this is the project member picker, and an
    # unscoped `admin_org_id` handed the owner Aekam Inc's staff directory while
    # they were adding people to an E2E Test project — so the picker offered
    # names that the project could not actually contain. With `org` passed,
    # `admin_org_id` CONFIRMS rather than guesses, and the 403 below now means
    # "you do not administer the organisation you are switched to", which is the
    # true statement; it used to mean "you administer nothing anywhere".
    org_id = await admin_org_id(user["user_id"], org)
    if not org_id:
        raise HTTPException(403, "This action requires an org owner or org admin")

    rows = await pool.fetch(
        "SELECT u.user_id,COALESCE(u.full_name,u.name,u.email) AS display_name,"
        "u.email,u.role,u.company_name "
        "FROM users u "
        "JOIN staging.user_roles ur ON ur.user_id = u.user_id "
        "WHERE ur.org_id=$1::uuid "
        "GROUP BY u.user_id,u.full_name,u.name,u.email,u.role,u.company_name "
        "ORDER BY display_name ASC",
        org_id,
    )
    return [dict(r) for r in rows]

@api_router.get("/teams/{team_id}")
async def get_team(team_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Return a project with its member list and the caller's role."""
    # Check project_assignments first, fall back to team_members
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem:
        mem=await pool.fetchrow("SELECT role FROM team_members WHERE team_id=$1 AND user_id=$2 AND status='active'",team_id,user["user_id"])
    if not mem:
        # No membership row of either kind. Before refusing, ask the SAME
        # question GET /teams asks, via the same helper — otherwise list and
        # detail answer differently and the UI contradicts itself.
        #
        # They did. Measured live on staging 2026-07-28 as an org_admin:
        # GET /teams returned 24 teams and GET /teams/{id} returned 403 on 22
        # of them, because the list is org-scoped through user_roles and this
        # handler was scoped to membership rows only. Opening any task whose
        # project the caller does not personally belong to logged a 403.
        #
        # get_visible_team_ids is the right predicate rather than
        # is_project_member: its authority is staging.user_roles, and it holds
        # an org admin to teams inside THEIR org. is_project_member still keys
        # its bypass on the legacy users.role column, which line 348 above
        # records as untrusted because it rode in the JWT and outlived the flag
        # being revoked. Using it here would have granted cross-org reads.
        #
        # The call is request-cached, and on this path the list endpoint has
        # usually already primed it, so it costs no extra query.
        if team_id not in await get_visible_team_ids(pool,user["user_id"],org_id=org):
            raise HTTPException(403,_NOT_TEAM_MEMBER)
        # Visible without a membership row means org-level access. "admin" is
        # the label is_project_member already synthesises for that case, so the
        # frontend's your_role handling needs no new branch.
        mem={"role":"admin"}
    team=await pool.fetchrow("SELECT * FROM teams WHERE team_id=$1",team_id)
    members=await pool.fetch("""
        SELECT tm.*,COALESCE(u.full_name,u.name,u.email) AS display_name,
               u.position,u.company_name,u.member_role,u.receives_approval_emails
        FROM team_members tm LEFT JOIN users u ON u.user_id=tm.user_id
        WHERE tm.team_id=$1 ORDER BY tm.created_at ASC""",team_id)
    return {"team":dict(team),"members":[dict(m) for m in members],"your_role":mem["role"]}

@api_router.get("/teams/{team_id}/clients")
async def list_team_clients(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Returns users with role='client' in the team — for the send-to-client dropdown."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,_NOT_TEAM_MEMBER)
    rows=await pool.fetch("""
        SELECT tm.user_id, COALESCE(u.full_name,u.name,u.email) AS display_name, u.email
        FROM team_members tm
        LEFT JOIN users u ON u.user_id=tm.user_id
        WHERE tm.team_id=$1 AND tm.status='active' AND tm.user_id IS NOT NULL
          AND tm.role='client'
        ORDER BY display_name ASC
    """,team_id)
    return [dict(r) for r in rows]

@api_router.get("/teams/{team_id}/members")
async def list_team_members(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Returns member list for @mention autocomplete. Accessible to all project members incl. clients."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,_NOT_TEAM_MEMBER)
    rows=await pool.fetch("""
        SELECT tm.user_id, COALESCE(u.full_name,u.name,u.email) AS display_name, u.email
        FROM team_members tm
        LEFT JOIN users u ON u.user_id=tm.user_id
        WHERE tm.team_id=$1 AND tm.status='active' AND tm.user_id IS NOT NULL
        ORDER BY display_name ASC
    """,team_id)
    return [dict(r) for r in rows]

@api_router.post("/teams/{team_id}/members",response_model=TeamMemberOut)
async def add_team_member(team_id:str,payload:TeamMemberAdd,pool=Depends(get_db),user=Depends(require_user)):
    """Add or re-invite a member to a project by email."""
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    email=payload.email.strip().lower()
    existing_user=await pool.fetchrow("SELECT user_id FROM users WHERE email=$1",email)
    uid=existing_user["user_id"] if existing_user else None
    await pool.execute("DELETE FROM team_members WHERE team_id=$1 AND email=$2",team_id,email)
    if uid: await pool.execute("DELETE FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,uid)
    row=await pool.fetchrow("INSERT INTO team_members (member_id,team_id,email,user_id,role,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        f"mem_{uuid.uuid4().hex[:12]}",team_id,email,uid,payload.role,"active" if uid else "invited")
    if uid: await pool.execute("INSERT INTO project_assignments (assignment_id,team_id,user_id,role,assigned_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (team_id,user_id) DO UPDATE SET role=EXCLUDED.role",
        f"assign_{uuid.uuid4().hex[:12]}",team_id,uid,payload.role,user["user_id"])
    return TeamMemberOut(**dict(row))

@api_router.put("/teams/{team_id}/members/{member_id}",response_model=TeamMemberOut)
async def update_team_member(team_id:str,member_id:str,payload:TeamMemberUpdate,pool=Depends(get_db),user=Depends(require_user)):
    """Update a team member's role or status within a project."""
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    updates,vals=[],[]
    if payload.role:   updates.append(f"role=${len(vals)+1}");   vals.append(payload.role)
    if payload.status: updates.append(f"status=${len(vals)+1}"); vals.append(payload.status)
    updates.append(f"updated_at=${len(vals)+1}"); vals.append(now_utc()); vals+=[team_id,member_id]
    row=await pool.fetchrow(f"UPDATE team_members SET {', '.join(updates)} WHERE team_id=${len(vals)-1} AND member_id=${len(vals)} RETURNING *",*vals)
    if not row: raise HTTPException(404)
    # FIX #5: only sync project_assignments role when a role was actually provided.
    # Without this guard a status-only PATCH would write None/NULL into role.
    if payload.role and row["user_id"]:
        await pool.execute("UPDATE project_assignments SET role=$1 WHERE team_id=$2 AND user_id=$3",payload.role,team_id,row["user_id"])
    return TeamMemberOut(**dict(row))

@api_router.delete("/teams/{team_id}")
async def delete_team(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Soft-delete: move project to bin. Restorable for PROJECT_BIN_DAYS."""
    team = await require_project_admin(pool, team_id, user)
    if team["deleted_at"] is not None:
        raise HTTPException(404, "Project not found")
    await pool.execute(
        "UPDATE teams SET deleted_at=NOW(), deleted_by=$1 WHERE team_id=$2",
        user["user_id"], team_id
    )
    await notify_org_owner_project_state(pool, team, user, "deleted")
    return {"ok": True, "soft_deleted": True, "restore_days": PROJECT_BIN_DAYS}

_archive_ready: dict = {}


async def archive_column_ready(pool) -> bool:
    """Has migration 104 been applied?

    Migrations here are applied BY HAND and the deploy is a separate act, so
    BOTH orders happen. Probing means this code works either way: before the
    column exists an archive attempt answers 503 naming the migration, rather
    than 500ing on UndefinedColumn or — far worse — appearing to succeed.

    Cached ASYMMETRICALLY, the same way `_parity_ready` and `_colour_ready` do
    it: TRUE is remembered forever because a column does not un-exist, FALSE for
    sixty seconds so applying the migration takes effect without a redeploy.
    """
    import time
    if _archive_ready.get("yes"):
        return True
    if time.monotonic() < _archive_ready.get("recheck_after", 0):
        return False
    ok = await pool.fetchval(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='teams' AND column_name='archived_at'"
    )
    if ok:
        _archive_ready["yes"] = True
        return True
    _archive_ready["recheck_after"] = time.monotonic() + 60
    return False


@api_router.post("/teams/{team_id}/archive")
async def archive_team(team_id: str, pool=Depends(get_db), user=Depends(require_user)):
    """Archive a finished project. NOT a delete — see migration 104.

    `deleted_at` is a thirty-day countdown to erasure, which is right for "this
    was a mistake" and wrong for "this engagement finished". A completed audit is
    the firm's record: it should leave the project list and must never acquire a
    deletion date. So this is a third state, and reports keep counting it.
    """
    if not await archive_column_ready(pool):
        raise HTTPException(503, "Archiving is not available yet — migration 104 "
                                 "has not been applied to this database.")
    team = await require_project_admin(pool, team_id, user)
    if team["deleted_at"] is not None:
        raise HTTPException(404, "Project not found")
    # `archived_at IS NULL` in the WHERE, so archiving twice does not rewrite the
    # date — the archive stamp is a fact about when it finished, and a second
    # click should not move it.
    changed = await pool.execute(
        "UPDATE teams SET archived_at=NOW(), archived_by=$1 "
        "WHERE team_id=$2 AND archived_at IS NULL",
        user["user_id"], team_id)
    # Only on the transition. A second click updates no row, and the org owner
    # should not be mailed twice about one archive.
    if changed and not changed.endswith(" 0"):
        await notify_org_owner_project_state(pool, team, user, "archived")
    return {"ok": True, "archived": True}


@api_router.post("/teams/{team_id}/unarchive")
async def unarchive_team(team_id: str, pool=Depends(get_db), user=Depends(require_user)):
    """Bring an archived project back to the live list."""
    if not await archive_column_ready(pool):
        raise HTTPException(503, "Archiving is not available yet — migration 104 "
                                 "has not been applied to this database.")
    await require_project_admin(pool, team_id, user)
    team = await pool.fetchrow(
        "SELECT team_id FROM teams WHERE team_id=$1 AND deleted_at IS NULL "
        "  AND archived_at IS NOT NULL", team_id)
    if not team:
        raise HTTPException(404, "Project not found or not archived")
    await pool.execute(
        "UPDATE teams SET archived_at=NULL, archived_by=NULL WHERE team_id=$1", team_id)
    return {"ok": True}


@api_router.post("/teams/{team_id}/restore")
async def restore_team(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Restore a soft-deleted project from the bin."""
    await require_project_admin(pool, team_id, user)
    team = await pool.fetchrow(
        "SELECT team_id FROM teams WHERE team_id=$1 AND deleted_at IS NOT NULL "
        f"AND deleted_at > NOW() - INTERVAL '{PROJECT_BIN_DAYS} days'",
        team_id
    )
    if not team: raise HTTPException(404, "Project not found in bin or restore window expired")
    await pool.execute("UPDATE teams SET deleted_at=NULL, deleted_by=NULL WHERE team_id=$1", team_id)
    return {"ok": True}

@api_router.delete("/teams/{team_id}/purge")
async def purge_team(team_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Permanently delete a project from the bin, before its window runs out.

    Same gate as delete and restore: whoever may put a project in the bin may
    empty it. The alternative — leaving this on the vendor's platform role —
    means a customer who deletes a project by mistake cannot get rid of it
    either, and has to ask Aekam to finish the job. The typed-name confirmation
    in the dialog is the guard here, not the role.
    """
    from services.project_purge import purge_project
    await require_project_admin(pool, team_id, user)
    await purge_project(pool, team_id)
    return {"ok": True}

@api_router.patch("/teams/{team_id}/color")
async def set_team_color(team_id:str,body:dict,pool=Depends(get_db),user=Depends(require_user)):
    """Set project colour (hex string). Any project member can update."""
    mem=await is_project_member(pool,team_id,user)
    if not mem: raise HTTPException(403,"Not a project member")
    color = body.get("color")
    if not color or not isinstance(color, str) or not color.startswith("#"):
        raise HTTPException(400, "color must be a hex string e.g. #05b7aa")
    await pool.execute("UPDATE teams SET color=$1 WHERE team_id=$2", color, team_id)
    return {"ok": True, "color": color}

@api_router.delete("/teams/{team_id}/members/{member_id}")
async def remove_team_member(team_id:str,member_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Remove a member from a project and revoke their project assignment."""
    mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,user["user_id"])
    if not mem or mem["role"] not in ("owner","admin"): raise HTTPException(403)
    member=await pool.fetchrow("SELECT user_id FROM team_members WHERE team_id=$1 AND member_id=$2",team_id,member_id)
    await pool.execute("DELETE FROM team_members WHERE team_id=$1 AND member_id=$2",team_id,member_id)
    if member and member["user_id"]: await pool.execute("DELETE FROM project_assignments WHERE team_id=$1 AND user_id=$2",team_id,member["user_id"])
    return {"ok":True}

# ── Categories ───────────────────────────────────────────────────

@api_router.get("/categories",response_model=List[CategoryOut])
async def list_categories(pool=Depends(get_db),user=Depends(require_user)):
    """Return all task categories belonging to the authenticated user."""
    return [CategoryOut(**dict(r)) for r in await pool.fetch("SELECT * FROM categories WHERE user_id=$1 ORDER BY updated_at DESC",user["user_id"])]

@api_router.post("/categories",response_model=CategoryOut)
async def create_category(payload:CategoryCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a new task category for the authenticated user."""
    row=await pool.fetchrow("INSERT INTO categories (category_id,user_id,name,color) VALUES ($1,$2,$3,$4) RETURNING *",f"cat_{uuid.uuid4().hex[:12]}",user["user_id"],payload.name,payload.color)
    return CategoryOut(**dict(row))

@api_router.delete("/categories/{category_id}")
async def delete_category(category_id:str,pool=Depends(get_db),user=Depends(require_user)):
    """Delete a category and unlink it from all tasks."""
    await pool.execute("UPDATE tasks SET category_id=NULL,updated_at=NOW() WHERE user_id=$1 AND category_id=$2",user["user_id"],category_id)
    await pool.execute("DELETE FROM categories WHERE user_id=$1 AND category_id=$2",user["user_id"],category_id)
    return {"ok":True}

# ── Tasks ────────────────────────────────────────────────────────

@api_router.get("/tasks")
async def list_tasks(status:Optional[str]=None,category_id:Optional[str]=None,q:Optional[str]=None,
                     team_id:Optional[str]=None,assigned_to_me:Optional[bool]=None,
                     archived:Optional[bool]=False,
                     since:Optional[str]=None,
                     limit:Optional[int]=500,offset:Optional[int]=0,
                     pool=Depends(get_db),user=Depends(require_user),
                     org=Depends(active_org_id)):
    """Tasks visible to the caller, filtered — or CHANGED SINCE a given moment.

    ── `?since=` ───────────────────────────────────────────────────────────────

    Owner's decision, 2026-08-09: the mobile app syncs what changed since the
    last session rather than refetching whole lists. With `since` this returns
    only rows whose `updated_at` is strictly later, wrapped in the delta
    envelope (`services/delta_sync`), and:

      * the ARCHIVED filter is not applied. Without `since`, archived tasks are
        excluded because a board should not show them; WITH it, a task archived
        since the last sync is a CHANGE the device has to hear about, and
        filtering it out is how the phone keeps showing a task the web archived.
        The client removes any row it receives carrying `archived_at`.
      * deletions do not appear here at all — tasks are hard-deleted, so they
        arrive through `GET /v1/sync/tombstones` (migration 138).

    The response SHAPE differs between the two modes on purpose: a plain call
    still answers a bare array, which every existing caller expects, and a delta
    answers an object carrying `synced_at`. A client that asks for a delta has
    already opted into reading the envelope.
    """
    from datetime import datetime, timezone

    from services.delta_sync import envelope, parse_since

    since_dt = parse_since(since)
    # Taken BEFORE the query, so a row written while the query runs falls into
    # the NEXT window rather than into neither. See `delta_sync`'s docstring.
    synced_at = datetime.now(timezone.utc)

    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    conditions=["(t.user_id=$1 OR t.team_id=ANY($2::text[])"
                " OR t.created_by_user_id=$1"
                " OR EXISTS(SELECT 1 FROM task_clients tc WHERE tc.task_id=t.task_id AND tc.user_id=$1))"]
    if since_dt is None:
        if archived:
            conditions.append("t.archived_at IS NOT NULL")
        else:
            conditions.append("t.archived_at IS NULL")
    vals=[user["user_id"],team_ids]
    if since_dt is not None:
        conditions.append(f"t.updated_at > ${len(vals)+1}")
        vals.append(since_dt)
    if team_id:        conditions.append(f"t.team_id=${len(vals)+1}");       vals.append(team_id)
    if status:         conditions.append(f"t.status=${len(vals)+1}");         vals.append(status)
    if category_id:    conditions.append(f"t.category_id=${len(vals)+1}");   vals.append(category_id)
    if q:              conditions.append(f"t.title ILIKE ${len(vals)+1}");    vals.append(f"%{q}%")
    if assigned_to_me: conditions.append(f"${len(vals)+1}=ANY(t.assignee_user_ids)"); vals.append(user["user_id"])
    _lim = min(limit if limit is not None else 500, 500)
    _off = max(offset if offset is not None else 0, 0)
    _lim_idx = len(vals) + 1
    _off_idx = len(vals) + 2
    rows=await pool.fetch(f"""
        SELECT t.task_id, t.user_id, t.team_id, t.column_id,
               t.created_by_user_id, t.assigned_by_user_id, t.completed_by_user_id,
               t.title, t.description, t.status, t.priority, t.category_id,
               t.tags, t.assignee_user_ids, t.assignee_emails,
               t.due_at, t.reminder_at, t.reminder_sent_at,
               t.recurrence_rule, t.recurrence_interval, t.estimated_minutes,
               t.attachments, t.custom_fields, t.subtasks,
               t.sort_order, t.created_at, t.updated_at, t.completed_at,
               t.board_id, t.column_slug, t.requires_approval,
               t.approval_status, t.approved_by, t.approval_notes,
               t.approval_requested_at, t.approval_decided_at, t.approval_id,
               t.archived_at,
               COALESCE(cu.full_name,cu.name,cu.email) AS created_by_name,
               ARRAY(
                 SELECT COALESCE(au.full_name,au.name,au.email)
                 FROM unnest(t.assignee_user_ids) AS uid
                 LEFT JOIN users au ON au.user_id=uid
               ) AS assignee_names,
               pc.name AS column_name,
               pc.color AS column_color
        FROM tasks t
        LEFT JOIN users cu ON cu.user_id=t.created_by_user_id
        LEFT JOIN project_columns pc ON pc.column_id=t.column_id
        WHERE {' AND '.join(conditions)}
        ORDER BY t.sort_order ASC
        LIMIT ${_lim_idx} OFFSET ${_off_idx}
    """,*vals, _lim, _off)
    # `_refresh_task_attachments` re-signs every attachment against live R2
    # credentials, so anything reaching it unfiltered leaves here with a working
    # download URL. This list is the org-wide read — it was the one task read
    # that never applied `_filter_private_attachments`, so a file the uploader
    # had marked private went to every member of every visible team WITH A FRESH
    # SIGNED URL. Filter first, exactly as `/client/tasks` does: a private
    # attachment the caller may not see must never be handed a signed URL, even
    # transiently.
    uid = user["user_id"]
    _admin: Optional[bool] = None
    tasks: List[TaskOut] = []
    for r in rows:
        t = row_to_task(r)
        if any(a.is_private for a in (t.attachments or [])):
            is_creator = r["created_by_user_id"] == uid
            if not is_creator and _admin is None:
                # Resolved at most once per request, and only when a private
                # attachment actually exists — not once per row.
                #
                # SCOPED: unscoped, `is_org_admin(uid)` is True for an admin row
                # in ANY org, so an admin of one org saw private attachments on
                # every row this list returned. `org` is already a dependency of
                # this route; there was never a reason not to pass it.
                _admin = await is_org_admin(uid, org) if org else await is_org_admin(uid)
            t = _filter_private_attachments(t, uid, is_creator or bool(_admin))
        tasks.append(await _refresh_task_attachments(pool, t))
    if since_dt is None:
        return tasks
    # The delta envelope, and only for a delta — a plain call keeps answering the
    # bare array every existing caller reads.
    return envelope(tasks, since_dt, synced_at, limit=_lim)


@api_router.post("/tasks/auto-archive")
async def auto_archive_tasks(pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Archive all done tasks that have been completed for more than 30 days."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    result=await pool.execute("""
        UPDATE tasks SET archived_at=NOW(), updated_at=NOW()
        WHERE archived_at IS NULL
          AND completed_at IS NOT NULL
          AND completed_at < NOW() - INTERVAL '30 days'
          AND (user_id=$1 OR team_id=ANY($2::text[]) OR created_by_user_id=$1)
          AND (
            status='done'
            OR column_id IN (
              SELECT column_id FROM project_columns WHERE is_done=TRUE
            )
          )
    """,user["user_id"],team_ids)
    count=int((result or "UPDATE 0").split()[-1])
    return {"archived":count}


async def _assert_task_write(pool, task_id: str, user: dict, team_ids: list) -> None:
    """Look up a task's project, then ask the one predicate about it.

    For the two routes that match and write in a single statement and so have no
    row in hand to read `team_id` off. Silent on a task the caller cannot see:
    the route's own `RETURNING *` already answers 404 for that, and raising a
    403 here instead would turn "no such task" into "a task exists and you may
    not touch it", which is a probe oracle for an id the caller never held.
    """
    row = await pool.fetchrow(
        "SELECT team_id FROM tasks WHERE task_id=$1 AND "
        "(user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id, user["user_id"], team_ids,
    )
    if not row:
        return
    await assert_may_write_task(pool, team_id=row["team_id"], user=user, task_id=task_id)


@api_router.patch("/tasks/{task_id}/archive",response_model=TaskOut)
async def archive_task(task_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Manually archive a single task."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    # Read, ask, then write. This route matched and updated in ONE statement, so
    # there was no point at which the caller's project role could be consulted
    # — the row was already gone from the board by the time anything else ran.
    # Archiving is not a soft action here: it takes the firm's work off every
    # board and picker in the product.
    await _assert_task_write(pool,task_id,user,team_ids)
    row=await pool.fetchrow("""
        UPDATE tasks SET archived_at=NOW(), updated_at=NOW()
        WHERE task_id=$1 AND archived_at IS NULL
          AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)
        RETURNING *
    """,task_id,user["user_id"],team_ids)
    if not row: raise HTTPException(404)
    return row_to_task(row)


@api_router.patch("/tasks/{task_id}/unarchive",response_model=TaskOut)
async def unarchive_task(task_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Restore an archived task back to the active list."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    await _assert_task_write(pool,task_id,user,team_ids)
    row=await pool.fetchrow("""
        UPDATE tasks SET archived_at=NULL, updated_at=NOW()
        WHERE task_id=$1 AND archived_at IS NOT NULL
          AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)
        RETURNING *
    """,task_id,user["user_id"],team_ids)
    if not row: raise HTTPException(404)
    return row_to_task(row)


@api_router.post("/tasks",response_model=TaskOut)
async def create_task(payload:TaskCreate,pool=Depends(get_db),user=Depends(require_user)):
    """Create a task, send assignment notifications, and fire automation rules."""
    if payload.team_id:
        mem=await is_project_member(pool,payload.team_id,user)
        if not mem: raise HTTPException(403)
        # `if not mem` was the whole test, and a Tier-3 client's row is truthy.
        # Measured: POST {"title":"Made by a client","team_id":"team_001"} as a
        # `client` returned 200 with the row written. Membership is not a licence
        # to write; `assert_transition` below is a STATUS machine and has no
        # opinion on who the caller is.
        await assert_may_write_task(pool,team_id=payload.team_id,user=user)
        user_id_field,scope_col,scope_val=None,"team_id",payload.team_id
    else:
        user_id_field,scope_col,scope_val=user["user_id"],"user_id",user["user_id"]
    if scope_col not in _VALID_SCOPE_COLS:
        raise ValueError(f"Invalid scope_col: {scope_col!r}")
    column_id=payload.column_id
    if not column_id and payload.team_id:
        first_col=await pool.fetchrow("SELECT column_id FROM project_columns WHERE team_id=$1 ORDER BY sort_order ASC LIMIT 1",payload.team_id)
        column_id=first_col["column_id"] if first_col else None
    status=payload.status or "todo"
    if column_id:
        col=await pool.fetchrow("SELECT is_done FROM project_columns WHERE column_id=$1",column_id)
        if col and col["is_done"]: status="done"
    # Write path 1 of 4. `status` arrived as a free string (TaskCreate.status is
    # `str="todo"`), so a task could be born in a state nothing reads. Checked
    # before the INSERT, not after.
    from services.task_transitions import assert_transition
    await assert_transition(pool,old_status=None,new_status=status,team_id=payload.team_id,user=user)
    due_dt=parse_dt(payload.due_at)
    reminder_dt=parse_dt(payload.reminder_at) or (due_dt-timedelta(hours=2) if due_dt else None)
    max_row=await pool.fetchrow(f"SELECT MAX(sort_order) AS mo FROM tasks WHERE {scope_col}=$1 AND column_id=$2",scope_val,column_id)
    next_order=(max_row["mo"] or -1)+1; task_id=f"task_{uuid.uuid4().hex[:12]}"
    actor_name=actor_display(user)
    row=await pool.fetchrow("""
        INSERT INTO tasks (task_id,user_id,team_id,column_id,created_by_user_id,assigned_by_user_id,
           created_by_name,title,description,status,priority,category_id,tags,assignee_user_ids,assignee_emails,
           due_at,reminder_at,recurrence_rule,recurrence_interval,estimated_minutes,attachments,custom_fields,subtasks,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14::text[],$15::text[],
                $16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23::jsonb,$24)
        RETURNING *""",
        task_id,user_id_field,payload.team_id,column_id,user["user_id"],
        user["user_id"] if (payload.assignee_user_ids or payload.assignee_emails) else None,
        actor_name,payload.title,payload.description,status,payload.priority,payload.category_id,
        payload.tags or [],payload.assignee_user_ids or [],
        [e.strip().lower() for e in payload.assignee_emails if e.strip()],
        due_dt,reminder_dt,payload.recurrence.rule,payload.recurrence.interval,payload.estimated_minutes,
        json.dumps([a.model_dump(mode="json") for a in payload.attachments or []]),
        json.dumps(payload.custom_fields or {}),json.dumps([s.model_dump() for s in payload.subtasks or []]),next_order)
    team_name=None
    if payload.team_id:
        tr=await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1",payload.team_id)
        team_name=tr["name"] if tr else None
    for uid in set(payload.assignee_user_ids or []):
        if uid==user["user_id"]: continue
        await create_notification(pool,uid,"assigned","Task assigned",f"You were assigned: {payload.title}",task_id,payload.team_id,"/tasks")
        try:
            from email_service import send_task_assignment_email
            assignee=await pool.fetchrow("SELECT email,COALESCE(full_name,name) AS name FROM users WHERE user_id=$1",uid)
            if assignee: send_task_assignment_email(assignee["email"],assignee["name"] or assignee["email"],payload.title,task_id,team_name)
        except Exception as e:
            logger.warning("assignment email failed: %s", e)
    from services.activity_logger import log_event
    await log_event(pool,task_id=task_id,team_id=payload.team_id,actor_id=user["user_id"],event_type="created",data={"title":payload.title})
    # Write path 1 of 4. The INSERT above is a single autocommitted statement,
    # so there is no open transaction to join; the event is emitted immediately
    # after against the row that was returned. The narrow window this leaves —
    # task inserted, process dies before the event — is the one case the outbox
    # cannot close without restructuring the whole handler, and it fails in the
    # safe direction: a missing creation event costs a rule one firing, where a
    # spurious one would act on a task that does not exist.
    from services.niyam.subjects import task_created
    _org = await _resolve_org_id(pool, payload.team_id)
    if _org:
        async with pool.acquire() as _conn:
            await task_created(_conn, org_id=_org, actor_id=user["user_id"], task_id=task_id, row=row)
    out=await _fetch_enriched_task(pool,task_id,viewer_id=user["user_id"])
    out.reminders=await _replace_task_reminders(pool,task_id,due_dt,payload.reminders)
    return out


async def _notify_status_changed(pool, row, existing, old_status: str, new_status: str, actor: dict, task_id: str):
    """Fan-out in-app + email notifications after a task status change."""
    actor_name   = actor_display(actor, "Someone")
    actor_id     = actor["user_id"]
    assignees    = list(row.get("assignee_user_ids") or [])
    creator_id   = existing["created_by_user_id"]
    team_id      = existing.get("team_id")

    # Notify: assignees + creator, excluding the actor
    notif_targets = list({uid for uid in assignees + ([creator_id] if creator_id else []) if uid and uid != actor_id})

    # In-app notifications
    for uid in notif_targets:
        try:
            await create_notification(pool, uid, "status_changed",
                f"Task status updated: {row['title']}",
                f"{actor_name} moved it to {new_status}",
                task_id, team_id, "/tasks")
        except Exception:
            pass

    # Email notifications
    try:
        if notif_targets:
            user_rows = await pool.fetch(
                "SELECT user_id, COALESCE(full_name,name,email) AS name, email FROM users WHERE user_id=ANY($1::text[])",
                notif_targets
            )
            project_row  = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", team_id) if team_id else None
            project_name = project_row["name"] if project_row else None
            from email_service import send_status_changed_email
            for ur in user_rows:
                if ur["email"]:
                    send_status_changed_email(
                        ur["email"], ur["name"] or ur["email"],
                        actor_name, row["title"], task_id,
                        new_status, project=project_name,
                    )
    except Exception as _e:
        logger.warning("status_changed email failed: %s", _e)

    # Task-done: notify ALL project members
    if new_status == "done" and team_id:
        try:
            member_rows = await pool.fetch("""
                SELECT DISTINCT u.user_id, COALESCE(u.full_name,u.name,u.email) AS name, u.email
                FROM team_members tm
                JOIN users u ON u.user_id = tm.user_id
                WHERE tm.team_id=$1 AND tm.status='active' AND tm.user_id IS NOT NULL
                  AND tm.user_id != $2
            """, team_id, actor_id)
            project_row  = await pool.fetchrow("SELECT name FROM teams WHERE team_id=$1", team_id) if not locals().get("project_name") else None
            project_name = (project_row["name"] if project_row else None) if project_row else locals().get("project_name")
            from email_service import send_task_done_email
            for mr in member_rows:
                if mr["email"]:
                    # In-app notification
                    try:
                        await create_notification(pool, mr["user_id"], "done",
                            f"Task completed: {row['title']}",
                            f"{actor_name} marked it as done.",
                            task_id, team_id, "/tasks")
                    except Exception:
                        pass
                    # Email
                    send_task_done_email(
                        mr["email"], mr["name"] or mr["email"],
                        actor_name, row["title"],
                    )
        except Exception as _e:
            logger.warning("task_done notification failed: %s", _e)


async def _fetch_enriched_task(pool, task_id: str, viewer_id: Optional[str] = None,
                               viewer_is_admin: Optional[bool] = None,
                               org_id: Optional[str] = None) -> "TaskOut":
    """Re-fetch a task with all JOIN'd fields (column_name, column_color, assignee_names).

    Pass `viewer_id` to have private attachments stripped for that caller. It is
    applied BEFORE the URLs are re-signed, so a file the caller may not see is
    never handed a fresh signed R2 URL even transiently — the same ordering
    `/client/tasks` uses.

    Every caller that hands its result straight back to a user should pass it.
    `viewer_id=None` is the un-filtered form and is only correct for internal
    callers that are not serialising the result to an HTTP response.

    ── `org_id` GATES ATTACHMENT CONTENT, NOT ROW VISIBILITY ─────────────────

    Pass it whenever the caller has an active org. The fall-through below asked
    `is_org_admin(viewer_id)` with NO org, which is True for an `org_owner` /
    `org_admin` row in ANY organisation — so an admin of one org who reached
    another org's task by any path was handed that org's PRIVATE attachments.
    `get_task` resolves its own scoped answer and passes it, so the hot path was
    already covered; this closes the four callers that do not, in the one place
    that decides attachment CONTENT rather than which rows come back.
    """
    row = await pool.fetchrow("""
        SELECT t.*,
               COALESCE(cu.full_name, cu.name, cu.email) AS created_by_name,
               ARRAY(
                 SELECT COALESCE(u.full_name, u.name, u.email)
                 FROM unnest(t.assignee_user_ids) AS aid
                 JOIN users u ON u.user_id = aid
               ) AS assignee_names,
               pc.name  AS column_name,
               pc.color AS column_color
        FROM tasks t
        LEFT JOIN users cu ON cu.user_id = t.created_by_user_id
        LEFT JOIN project_columns pc ON pc.column_id = t.column_id
        WHERE t.task_id = $1
    """, task_id)
    if not row: return None
    out = row_to_task(row)
    if viewer_id is not None and any(a.is_private for a in (out.attachments or [])):
        is_creator = row["created_by_user_id"] == viewer_id
        if not is_creator and viewer_is_admin is None:
            viewer_is_admin = (await is_org_admin(viewer_id, org_id) if org_id
                               else await is_org_admin(viewer_id))
        out = _filter_private_attachments(out, viewer_id, is_creator or bool(viewer_is_admin))
    out = await _refresh_task_attachments(pool, out)
    out.reminders = await _fetch_task_reminders(pool, task_id)
    return out

def _filter_private_attachments(task_out, user_id: str, is_creator: bool) -> "TaskOut":
    """Strip private attachments the caller is not allowed to see."""
    filtered = [
        a for a in (task_out.attachments or [])
        if not a.is_private or is_creator or user_id in (a.visible_to or [])
    ]
    task_out.attachments = filtered
    return task_out

async def task_is_in_org(pool, org: str | None, *, team_id: str | None,
                         owner_ids: tuple[str | None, ...] = ()) -> bool:
    """Is this task inside the organisation the session is scoped to?

    ── WHY A TASK NEEDS ITS OWN PREDICATE ─────────────────────────────────────

    `get_visible_team_ids(…, org_id=org)` answers "which teams may this caller
    see in this org", and every route that asks it is scoped. The routes that
    are NOT scoped are the ones that never ask, because they short-circuit on
    `is_org_admin` first — and narrowing WHO reaches that hatch (the previous
    pass) is not the same as narrowing WHAT it hands back. `get_task` still
    returned any task in the database to an admin of the active org, and
    `delete_task` still DELETED one. This is the missing half.

    ── HOW A TASK'S ORG IS DERIVED ────────────────────────────────────────────

    `tasks.org_id` DOES NOT EXIST. It is added only in
    `migrations/PROPOSED_076_org_id_add_nullable.sql:66`, which is unapplied and
    is the owner's decision to run, so the org has to be reached through the
    task's team — the same route `get_visible_team_ids` takes.

      team_id set   -> `teams.org_id` must equal `org`, **or be NULL**. The NULL
                       leg is not a hole and is spelled out for the same reason
                       `get_visible_team_ids` spells it out: 2 of the 29 live
                       teams carry no `org_id`, a team in no organisation has no
                       tenant to leak from, and dropping it would 403 the people
                       whose only membership is one of those two.

      team_id NULL  -> a PERSONAL task. It has no team, so the only tenancy
                       signal left is its owner: the task is in `org` when its
                       `user_id` or `created_by_user_id` holds a `user_roles`
                       row there. An admin keeps reading their own members'
                       personal tasks; another tenant's are refused.

    ── `org is None` MEANS "NO OPINION", NOT "EVERYTHING" ─────────────────────

    True, deliberately. `active_org_id` returns None for the two populations its
    own docstring names — portal clients, who hold no org role at all, and staff
    whose only membership is an `org_id IS NULL` team. Refusing them here would
    turn the leak into a 403 on the main task surface, which is a different
    incident with the same root cause. They keep exactly the answer they had.
    """
    if not org:
        return True
    if team_id:
        return bool(await pool.fetchval(
            "SELECT 1 FROM teams WHERE team_id=$1 "
            "AND (org_id=$2::uuid OR org_id IS NULL) LIMIT 1",
            team_id, org))
    ids = [u for u in owner_ids if u]
    if not ids:
        # A personal task with no owner recorded at all. Nothing ties it to a
        # tenant, so the admin hatch does not open on it; the creator/assignee
        # paths below are unaffected and still reach it.
        return False
    return bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles WHERE org_id=$2::uuid "
        "AND user_id = ANY($1::text[]) LIMIT 1",
        ids, org))


@api_router.get("/tasks/{task_id}",response_model=TaskOut)
async def get_task(task_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Return a single task by ID, enforcing visibility and access rules."""
    row=await pool.fetchrow("SELECT t.*,COALESCE(u.full_name,u.name,u.email) AS created_by_name FROM tasks t LEFT JOIN users u ON u.user_id=t.created_by_user_id WHERE t.task_id=$1",task_id)
    if not row: raise HTTPException(404)
    uid=user["user_id"]; is_creator=row["created_by_user_id"]==uid
    # Resolved once: this gates both private-attachment visibility and the
    # unrestricted read below, and it must come from staging.user_roles rather
    # than the JWT's admin claim.
    #
    # SCOPED TO THE ACTIVE ORG, because `if _is_admin: return await _out()` two
    # lines down is an unconditional read of the task — no team check, no org
    # check. Unscoped, `is_org_admin(uid)` answers True for an org_admin row in
    # ANY organisation, so the owner (org_admin in three) could read any task in
    # any of them by id regardless of which org the switcher was on, and the
    # `get_visible_team_ids` narrowing below never ran. `org` is None only for a
    # caller with no org at all, and for them this falls back to exactly the
    # global question it asked before — which is NOT free of consequence; see
    # `tests/test_orgless_admin_hatch.py` for the one account that still reaches
    # this hatch through the `else`, and why closing it is a decision rather
    # than a cleanup.
    _is_admin = await is_org_admin(uid, org) if org else await is_org_admin(uid)
    # AND THE TASK HAS TO BE IN THAT ORG TOO. Scoping the ADMIN question above
    # narrowed WHO reaches the hatch below; it did nothing about WHAT the hatch
    # hands back, which was any task in the database by id — measured, one query
    # issued, `get_visible_team_ids` never reached.
    #
    # Resolved once and folded into `_admin_here` rather than tested only at the
    # hatch, because `viewer_is_admin` rides on the same answer: an admin who
    # reaches ANOTHER org's task through the assignee path below must not also
    # be handed that org's PRIVATE attachments by `_fetch_enriched_task`.
    _admin_here = _is_admin and await task_is_in_org(
        pool, org, team_id=row["team_id"],
        owner_ids=(row["user_id"], row["created_by_user_id"]))
    async def _out():
        # Filtering moved inside `_fetch_enriched_task` so it runs BEFORE the
        # URLs are re-signed. `_admin_here` is already resolved, so passing it
        # keeps this to the same single `user_roles` lookup as before.
        return await _fetch_enriched_task(pool, task_id, viewer_id=uid,
                                          viewer_is_admin=is_creator or _admin_here)
    if _admin_here: return await _out()
    if is_creator: return await _out()
    if uid in (row["assignee_user_ids"] or []): return await _out()
    if row["team_id"]:
        team_ids=await get_visible_team_ids(pool,uid,_user_dict=user,org_id=org)
        if row["team_id"] in team_ids: return await _out()
    client_link=await pool.fetchrow("SELECT 1 FROM task_clients WHERE task_id=$1 AND user_id=$2",task_id,uid)
    if client_link: return await _out()
    raise HTTPException(403,"Not authorized")


@api_router.put("/tasks/{task_id}/reminders",response_model=List[ReminderOut])
async def set_task_reminders(task_id:str,payload:List[ReminderIn],pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Replace all pending reminders for a task. Usable at creation time or any time after, from the drawer."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    existing=await pool.fetchrow(
        "SELECT due_at, team_id FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id,user["user_id"],team_ids
    )
    if not existing: raise HTTPException(404)
    # `team_id` is selected alongside `due_at` purely so the question below can
    # be asked — a second round trip to learn the project of a row already in
    # hand is a round trip that will eventually be skipped by someone.
    await assert_may_write_task(pool,team_id=existing["team_id"],user=user,task_id=task_id)
    if not existing["due_at"] and payload:
        raise HTTPException(400,"Task has no due date — set one before adding reminders")
    return await _replace_task_reminders(pool,task_id,existing["due_at"],payload)


@api_router.put("/tasks/{task_id}",response_model=TaskOut)
async def update_task(task_id:str,payload:TaskUpdate,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Update allowed task fields and emit activity events for status and assignee changes."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    existing=await pool.fetchrow(
        "SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id,user["user_id"],team_ids
    )
    if not existing:
        if await client_can_access_task(pool, task_id, user["user_id"]):
            existing = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
        if not existing: raise HTTPException(404)
    # Two independent doors led here for a client and BOTH were real: the
    # `project_assignments` leg of `get_visible_team_ids` has no role filter, so
    # a client's project is in `team_ids`; and failing that,
    # `client_can_access_task` is the fallback one line above. Reachability was
    # never the question — this is.
    await assert_may_write_task(pool,team_id=existing["team_id"],user=user,task_id=task_id)
    data=payload.model_dump(exclude_unset=True); updates,vals=[],[]
    old_status=existing["status"]; old_assignees=list(existing.get("assignee_user_ids") or [])

    # Dropping a card into a done column is a status change even when the caller
    # never named one. That used to be appended straight onto `updates` two
    # hundred lines below, which put it BEHIND the guard instead of in front of
    # it — the one implicit write to `tasks.status` in the whole file, and the
    # one an approval gate would have missed. Resolved here so there is exactly
    # ONE status decision per request and exactly one thing to validate.
    if "column_id" in data and data["column_id"] and "status" not in data:
        _col=await pool.fetchrow("SELECT is_done FROM project_columns WHERE column_id=$1",data["column_id"])
        if _col and _col["is_done"]: data["status"]="done"

    # Write path 2 of 4 (PATCH /tasks/{id} is an alias of this function, so it
    # is covered by the same line). Raises HTTPException with a plain-string
    # detail — see services/task_transitions.py on why this is not a Literal.
    from services.task_transitions import assert_transition, is_reopen
    await assert_transition(pool,old_status=old_status,new_status=data.get("status"),
                            team_id=existing["team_id"],user=user)
    # approval_status gated: only admins/owners may approve or reject
    if "approval_status" in data and data["approval_status"] in ("approved","rejected"):
        # Scoped to the active org: approving is a decision on someone's work,
        # and an admin row in a different organisation is not authority over it.
        is_sys_admin = (await is_org_admin(user["user_id"], org) if org
                        else await is_org_admin(user["user_id"]))
        member_role = None
        if existing["team_id"]:
            mr = await pool.fetchrow(
                "SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",
                existing["team_id"], user["user_id"]
            )
            member_role = mr["role"] if mr else None
        if not is_sys_admin and member_role not in ("owner", "admin"):
            raise HTTPException(403, "Only project admins and owners can approve or reject tasks")
    for k in ["title","description","status","priority","category_id","estimated_minutes","column_id","approval_status"]:
        if k in data: updates.append(f"{k}=${len(vals)+1}"); vals.append(data[k])
    if "approval_status" in data and data["approval_status"] in ("approved","rejected"):
        updates.append(f"approved_by=${len(vals)+1}"); vals.append(user["user_id"])
        updates.append(f"approval_decided_at=${len(vals)+1}"); vals.append(now_utc())
    for k in ["tags","assignee_user_ids","assignee_emails"]:
        if k in data: updates.append(f"{k}=${len(vals)+1}::text[]"); vals.append(data[k])
    # Attachment metadata must survive a caller that does not echo it back.
    # TaskDrawer.jsx re-sends its attachment list as {name,url,key,is_private,
    # visible_to} on every save (frontend/src/components/TaskDrawer.jsx:412),
    # so `size` and the three uploader fields would be wiped from every file on
    # the next edit of any task. Merge them back by `key` — the attachment's
    # stable identity. A caller may still CHANGE these fields by sending new
    # values; omitting them no longer DESTROYS them.
    if data.get("attachments") is not None:
        prior = {
            a.get("key"): a
            for a in (_pj(existing["attachments"], []) or []) if isinstance(a, dict) and a.get("key")
        }
        merged = []
        for item in data["attachments"]:
            d = item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
            old = prior.get(d.get("key")) or {}
            for f in ("size", "uploaded_by", "uploaded_by_name", "uploaded_at"):
                if d.get(f) is None and old.get(f) is not None:
                    d[f] = old[f]
            merged.append(d)

        # An attachments write is wholesale — whatever list arrives replaces the
        # column. But the caller was SHOWN a filtered list: `_filter_private_attachments`
        # removes private files they may not see. So their client round-trips a list
        # with those files missing, and saving any unrelated edit — a title, a
        # priority — silently destroyed a colleague's private attachment.
        #
        # Nothing surfaced it. The deleter never saw the file, and the owner only
        # finds out when they go looking for it.
        #
        # Re-attach exactly what this caller could not have seen, and only when they
        # did not send it back. A file they CAN see and omitted is a real deletion and
        # is left alone. Predicate mirrors `_filter_private_attachments`; keep them
        # in step.
        _uid = user["user_id"]
        _privileged = (existing["created_by_user_id"] == _uid) or (
            await is_org_admin(_uid, org) if org else await is_org_admin(_uid))
        _sent = {d.get("key") for d in merged if d.get("key")}
        for _key, _old in prior.items():
            if _key in _sent:
                continue
            _could_see = (
                not _old.get("is_private")
                or _privileged
                or _uid in (_old.get("visible_to") or [])
            )
            if not _could_see:
                merged.append(_old)
        data["attachments"] = merged
    for k in ["attachments","custom_fields","subtasks"]:
        if k in data and data[k] is not None:
            updates.append(f"{k}=${len(vals)+1}::jsonb")
            v=data[k]; vals.append(json.dumps([i.model_dump(mode="json") if hasattr(i,'model_dump') else i for i in v] if isinstance(v,list) else v))
    if "due_at" in data:      updates.append(f"due_at=${len(vals)+1}");      vals.append(parse_dt(data["due_at"]))
    if "reminder_at" in data:
        updates.append(f"reminder_at=${len(vals)+1}"); vals.append(parse_dt(data["reminder_at"]))
        # Clear the sent-marker whenever the time is rewritten. Both dispatch
        # queries require `reminder_sent_at IS NULL`, and nothing else in the
        # backend ever sets it back — so without this a reminder fires exactly
        # once per task, ever. Snoozing or rescheduling was accepted by the API,
        # stored, shown in the UI, and then silently never delivered, which is
        # the worst shape a reminder bug can take.
        updates.append("reminder_sent_at=NULL")
    if "recurrence" in data and data["recurrence"]:
        rec=data["recurrence"]
        updates.append(f"recurrence_rule=${len(vals)+1}");     vals.append(rec.get("rule","none") if isinstance(rec,dict) else rec.rule)
        updates.append(f"recurrence_interval=${len(vals)+1}"); vals.append(rec.get("interval",1) if isinstance(rec,dict) else rec.interval)
    # (The done-column inference that used to live here has moved to the top of
    # this function, ahead of the transition guard. See the note there.)
    if not updates: return row_to_task(existing)
    updates.append(f"updated_at=${len(vals)+1}"); vals.append(now_utc()); vals.append(task_id)
    # Write path 2 of 4. Same transaction, same reason as paths 3 and 4.
    from services.niyam.subjects import task_status_changed
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row=await _conn.fetchrow(f"UPDATE tasks SET {', '.join(updates)} WHERE task_id=${len(vals)} RETURNING *",*vals)
            if old_status!=row["status"]:
                _org = await _resolve_org_id(pool, existing["team_id"])
                if _org:
                    await task_status_changed(_conn, org_id=_org, actor_id=user["user_id"],
                                              task_id=task_id, old_row=existing, new_row=row)
    new_status=row["status"]; new_assignees=list(row.get("assignee_user_ids") or [])
    from services.activity_logger import log_event, log_assigned, log_field_changed
    if old_status!=new_status:
        # `reopen` is carried on the event rather than being a second event
        # type: the activity feed already renders status_changed, and a new type
        # would render as nothing until every consumer learned it. Un-finishing
        # a finished task is the state change people go looking for afterwards.
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="status_changed",
                        data={"from":old_status,"to":new_status,"reopen":is_reopen(old_status,new_status)})
        await _notify_status_changed(pool, row, existing, old_status, new_status, user, task_id)
    for _field in ["title","description","priority"]:
        if _field in data and data[_field] != existing.get(_field):
            await log_field_changed(pool,task_id=task_id,actor_id=user["user_id"],field_name=_field,from_val=existing.get(_field),to_val=data[_field])
    if "due_at" in data:
        old_due = str(existing.get("due_at") or "")
        new_due = str(parse_dt(data["due_at"]) or "")
        if old_due != new_due:
            await log_field_changed(pool,task_id=task_id,actor_id=user["user_id"],field_name="due_at",from_val=old_due or None,to_val=new_due or None)
    if "assignee_user_ids" in data:
        added=[u for u in new_assignees if u not in old_assignees]
        removed=[u for u in old_assignees if u not in new_assignees]
        if added or removed:
            await log_assigned(pool,task_id=task_id,actor_id=user["user_id"],added=added,removed=removed)
        if added:
            try:
                from services.push_service import fan_out_push
                actor_name=actor_display(user, "Someone")
                asyncio.create_task(fan_out_push(
                    pool,
                    recipient_ids=[u for u in added if u!=user["user_id"]],
                    kind="assigned",
                    title=f"You were assigned to {row['title']}",
                    body=f"Assigned by {actor_name}.",
                    task_id=task_id,
                    is_mine_for=set(added),
                ))
            except Exception as _pe:
                logger.warning("assignee push failed: %s", _pe)
    return await _fetch_enriched_task(pool, task_id, viewer_id=user["user_id"], org_id=org)


@api_router.patch("/tasks/{task_id}",response_model=TaskOut)
async def patch_task(task_id:str,payload:TaskUpdate,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """PATCH alias used by the client 'Mark as Reviewed' CTA.

    `org` is declared here only so it can be PASSED ON. `update_task` grew an
    `org=Depends(active_org_id)` parameter in a555eddef and this caller was not
    updated, so the default — the unresolved `Depends` sentinel object — was
    handed to `get_visible_team_ids` as an org id. It is truthy, so it took the
    scoped branch and asyncpg was asked to encode a `Depends` as a uuid: every
    PATCH on a task 500'd. FastAPI resolves dependencies for ROUTES, never for
    a Python call, and `test_no_unresolved_depends.py` now says so mechanically.
    """
    return await update_task(task_id, payload, pool, user, org)


@api_router.post("/tasks/{task_id}/attachments", response_model=TaskOut)
async def add_task_attachment(
    task_id: str,
    file: UploadFile = File(...),
    pool=Depends(get_db),
    user=Depends(require_user),
    org=Depends(active_org_id),
):
    """Upload a file to R2 and append it to the task's attachments list."""
    from routers.uploads import MAX_BYTES, MAX_BYTES_VIDEO, ALLOWED_TYPES, ALLOWED_EXTENSIONS, VIDEO_EXTENSIONS
    from services.storage import upload_file
    import mimetypes as _mt

    # Access check
    team_ids = await get_visible_team_ids(pool, user["user_id"], _user_dict=user, org_id=org)
    row = await pool.fetchrow(
        "SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id, user["user_id"], team_ids,
    )
    if not row:
        if await client_can_access_task(pool, task_id, user["user_id"]):
            row = await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1", task_id)
        if not row:
            raise HTTPException(404)
    # Uploading to the firm's task is a write to it. Checked BEFORE the file is
    # read off the wire, so a refused caller does not get to spend 25 MB of the
    # worker's memory proving it.
    await assert_may_write_task(pool, team_id=row["team_id"], user=user, task_id=task_id)

    fname = (file.filename or "upload").lower()
    ext   = "." + fname.rsplit(".", 1)[-1] if "." in fname else ""
    is_video = ext in VIDEO_EXTENSIONS
    limit = MAX_BYTES_VIDEO if is_video else MAX_BYTES

    # Chunked. `await file.read()` put the whole body in the worker and only
    # then compared it to the limit, so the check bounded what was STORED and
    # not what was held — the opposite of what protects a 2GB container.
    #
    # The label said "5 MB" while `limit` was MAX_BYTES, which is 25. Anyone
    # rejected at 6MB was told a number that had not been true for a long time.
    from services.storage import read_capped
    content = await read_capped(file, limit)   # label derived from `limit`, so it cannot drift

    mime  = file.content_type or _mt.guess_type(file.filename or "")[0] or "application/octet-stream"
    if mime not in ALLOWED_TYPES and not mime.startswith("video/") and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "File type not allowed.")
    if ext in {".heic", ".heif"} and mime == "application/octet-stream":
        mime = f"image/{ext.lstrip('.')}"
    if ext in VIDEO_EXTENSIONS and mime == "application/octet-stream":
        mime = "video/quicktime" if ext == ".mov" else f"video/{ext.lstrip('.')}"

    folder = f"projects/{row['team_id']}" if row.get("team_id") else None
    result = await upload_file(file_bytes=content, filename=file.filename or "upload", content_type=mime, user_id=user["user_id"], folder=folder)

    current = _pj(row["attachments"], [])
    if len(current) >= 5:
        raise HTTPException(400, "Maximum 5 attachments per task")

    # Size, uploader and time are all already known right here — `len(content)`
    # was measured against the limit ten lines up, and the caller is the
    # uploader. They were simply never written down. `uploaded_by_name` is
    # snapshotted rather than joined on read so a file row stays truthful after
    # the uploader leaves the firm, and so the client portal never needs a join
    # against `users` to render "who shared it".
    uploader_name = await pool.fetchval(
        "SELECT COALESCE(full_name, name, email) FROM users WHERE user_id=$1", user["user_id"]
    )
    current.append({
        "name": file.filename or "upload",
        "url": result["url"],
        "key": result.get("key"),
        "size": len(content),
        "uploaded_by": user["user_id"],
        "uploaded_by_name": uploader_name,
        "uploaded_at": now_utc().isoformat(),
    })
    updated = await pool.fetchrow(
        "UPDATE tasks SET attachments=$1::jsonb, updated_at=$2 WHERE task_id=$3 RETURNING *",
        json.dumps(current), now_utc(), task_id,
    )
    return row_to_task(updated)


@api_router.delete("/tasks/{task_id}/attachments/{key:path}", response_model=TaskOut)
async def delete_task_attachment(
    task_id: str,
    key: str,
    pool=Depends(get_db),
    user=Depends(require_user),
    org=Depends(active_org_id),
):
    """Remove an attachment from a task by its R2 key."""
    team_ids = await get_visible_team_ids(pool, user["user_id"], _user_dict=user, org_id=org)
    row = await pool.fetchrow(
        "SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]) OR created_by_user_id=$2)",
        task_id, user["user_id"], team_ids,
    )
    if not row:
        raise HTTPException(404)
    await assert_may_write_task(pool, team_id=row["team_id"], user=user, task_id=task_id)

    current  = _pj(row["attachments"], [])
    filtered = [a for a in current if a.get("key") != key]
    updated  = await pool.fetchrow(
        "UPDATE tasks SET attachments=$1::jsonb, updated_at=$2 WHERE task_id=$3 RETURNING *",
        json.dumps(filtered), now_utc(), task_id,
    )
    return row_to_task(updated)


@api_router.post("/admin/migrate-data-uris")
async def migrate_data_uri_attachments(
    user=Depends(require_user),
    pool=Depends(get_db),
):
    """Re-upload data: URI attachments to R2. One-time migration for old files.

    Rewrites `attachments` on EVERY task in the database that matches, with no
    org predicate anywhere on the path — so of the three sites the widened sweep
    surfaced, this is the one where a stale token cost the most. `superadmin` is
    not a value `users.role`'s CHECK constraint permits (owner|admin|member|
    client, migration 001), so that half of the tuple never matched anything.

    `is_platform_staff` rather than `is_org_admin`: this is a vendor maintenance
    route, not a customer one, and it crosses every org by design.
    """
    from middleware.roles import is_platform_staff
    if not await is_platform_staff(user["user_id"]):
        raise HTTPException(403, "Admin only")
    from services.storage import upload_file
    import base64, mimetypes as _mt

    rows = await pool.fetch("SELECT task_id, attachments FROM tasks WHERE attachments::text LIKE '%data:%'")
    migrated = 0
    errors = []
    for row in rows:
        raw = row["attachments"]
        atts = json.loads(raw) if isinstance(raw, str) else (raw or [])
        changed = False
        for att in atts:
            url = att.get("url", "")
            if not url.startswith("data:"):
                continue
            try:
                header, b64 = url.split(",", 1)
                mime = header.split(":")[1].split(";")[0] if ":" in header else "application/octet-stream"
                content = base64.b64decode(b64)
                fname = att.get("name", "file")
                ext = "." + fname.rsplit(".", 1)[-1] if "." in fname else ""
                if not ext:
                    ext_guess = _mt.guess_extension(mime) or ""
                    fname += ext_guess
                result = await upload_file(
                    file_bytes=content, filename=fname,
                    content_type=mime, user_id="migration",
                )
                att["url"] = result["url"]
                att["key"] = result.get("key")
                changed = True
                migrated += 1
            except Exception as exc:
                errors.append({"task_id": row["task_id"], "name": att.get("name"), "error": str(exc)})
        if changed:
            await pool.execute(
                "UPDATE tasks SET attachments=$1::jsonb, updated_at=$2 WHERE task_id=$3",
                json.dumps(atts), now_utc(), row["task_id"],
            )
    return {"migrated": migrated, "errors": errors}


@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Permanently delete a task; only project admins/owners or the personal task owner may delete."""
    doc=await pool.fetchrow("SELECT team_id,user_id,created_by_user_id FROM tasks WHERE task_id=$1",task_id)
    if not doc: raise HTTPException(404)
    # ── THE ESCAPE HATCH IS READ AT REQUEST TIME, NOT OFF THE TOKEN ─────────
    #
    # This was `if user.get("role") != "admin"`, which is the legacy
    # `users.role` column as it was WHEN THE TOKEN WAS MINTED. Two consequences,
    # and the second is the one that matters: a token issued while its holder
    # was an admin kept the power for the token's whole life after the flag was
    # revoked, and the claim cannot be scoped to an organisation at all — so it
    # permitted a PERMANENT DELETE of any task in the database, with no org and
    # no team predicate anywhere on the path.
    #
    # `is_org_admin` reads staging.user_roles now, which is the direction the
    # rest of this codebase has already moved in (middleware/roles.py:135-156,
    # and the same replacement was made in approvals_router and
    # get_visible_team_ids). Measured before the change: six accounts held
    # users.role='admin', all six vendor-controlled — so this was reachable by
    # Aekam staff rather than customer-to-customer, which lowers the grade and
    # does not change the fix.
    #
    # ── AND THE HATCH IS SCOPED TO THE ACTIVE ORG ──────────────────────────
    #
    # `is_org_admin(user_id)` with no org is True for an `org_owner`/`org_admin`
    # row in ANY organisation and for every platform role
    # (`middleware/roles.py:341-347`), and on True the whole membership check
    # below is skipped and `DELETE FROM tasks WHERE task_id=$1` runs with no org
    # and no team predicate. Measured: an org_admin of one small org
    # permanently deleted another tenant's task by id, switcher irrelevant.
    #
    # Both halves are needed and neither is sufficient. `is_org_admin(uid, org)`
    # says the caller administers THIS org; `task_is_in_org` says the task is IN
    # it. `get_task` had the first half only, and still returned every task in
    # the database. A destructive write may not be one predicate short.
    _may_bypass = (await is_org_admin(user["user_id"], org) if org
                   else await is_org_admin(user["user_id"]))
    if _may_bypass:
        _may_bypass = await task_is_in_org(
            pool, org, team_id=doc["team_id"],
            owner_ids=(doc["user_id"], doc["created_by_user_id"]))
    if not _may_bypass:
        if doc["team_id"]:
            mem=await pool.fetchrow("SELECT role FROM project_assignments WHERE team_id=$1 AND user_id=$2",doc["team_id"],user["user_id"])
            if not mem or mem["role"] not in ("owner","admin"):
                raise HTTPException(403,"Only project admin or owner can delete tasks")
        else:
            # Personal task — only the owner can delete
            personal=await pool.fetchrow("SELECT user_id FROM tasks WHERE task_id=$1",task_id)
            if not personal or personal["user_id"]!=user["user_id"]:
                raise HTTPException(403,"Only project admin or owner can delete tasks")
    await pool.execute("DELETE FROM tasks WHERE task_id=$1",task_id)
    return {"ok":True}

@api_router.patch("/tasks/{task_id}/toggle",response_model=TaskOut)
async def toggle_task(task_id:str,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Toggle a task between done and todo status."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    doc=await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]))",task_id,user["user_id"],team_ids)
    if not doc: raise HTTPException(404)
    await assert_may_write_task(pool,team_id=doc["team_id"],user=user,task_id=task_id)
    new_status="todo" if doc["status"]=="done" else "done"
    # Write path 3 of 4. This route flipped the status unconditionally and wrote
    # NO activity event — the only status write in the file that left no trace,
    # so a completed task could be reopened and the feed would not say by whom.
    from services.task_transitions import assert_transition, is_reopen
    await assert_transition(pool,old_status=doc["status"],new_status=new_status,
                            team_id=doc["team_id"],user=user)
    # The write and its event share ONE transaction: the event must exist if
    # and only if the status changed. Emitting after an autocommitted UPDATE
    # would leave a window where the row moved and no rule ever heard about it,
    # which is the failure this whole design is built to remove.
    from services.niyam.subjects import task_status_changed
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row=await _conn.fetchrow("UPDATE tasks SET status=$1,completed_at=$2,completed_by_user_id=$3,updated_at=NOW() WHERE task_id=$4 RETURNING *",
                new_status,now_utc() if new_status=="done" else None,user["user_id"] if new_status=="done" else None,task_id)
            _org = await _resolve_org_id(pool, doc["team_id"])
            if _org:
                await task_status_changed(_conn, org_id=_org, actor_id=user["user_id"],
                                          task_id=task_id, old_row=doc, new_row=row)
    from services.activity_logger import log_event
    await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="status_changed",
                    data={"from":doc["status"],"to":new_status,"reopen":is_reopen(doc["status"],new_status)})
    await _notify_status_changed(pool, row, dict(doc), doc["status"], new_status, user, task_id)
    return row_to_task(row)

@api_router.patch("/tasks/{task_id}/move",response_model=TaskOut)
async def move_task(task_id:str,payload:TaskMoveIn,pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Move a task to a different column and update its status accordingly."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    doc=await pool.fetchrow("SELECT * FROM tasks WHERE task_id=$1 AND (user_id=$2 OR team_id=ANY($3::text[]))",task_id,user["user_id"],team_ids)
    if not doc: raise HTTPException(404)
    await assert_may_write_task(pool,team_id=doc["team_id"],user=user,task_id=task_id)
    from services.task_transitions import assert_transition, is_reopen, status_from_column_name
    col=await pool.fetchrow("SELECT * FROM project_columns WHERE column_id=$1",payload.column_id)
    if col:
        # The name→status heuristic now lives in services/task_transitions.py,
        # where it is tested. It carried a real bug here: `"review"` shared an
        # or-branch with `"progress"`/`"doing"` and returned `in_progress`, so a
        # column named plainly "Review" — which every board built from the
        # default template has — moved cards to In progress, and `in_review` was
        # reachable only from a column with "approval" in its name.
        new_status=status_from_column_name(col["name"],bool(col["is_done"]),doc["status"])
    else:
        new_status=doc["status"]
    # Write path 4 of 4.
    await assert_transition(pool,old_status=doc["status"],new_status=new_status,
                            team_id=doc["team_id"],user=user)
    completed_at=now_utc() if new_status=="done" else None
    completed_by=user["user_id"] if new_status=="done" else None

    # Moving column resets pending approval; approved/rejected states are preserved
    new_approval_status = None if doc["approval_status"] == "pending" else doc["approval_status"]

    # THE KANBAN DRAG. This is the path that emitted nothing under the old
    # engine, so a rule on "status becomes Done" fired when someone edited the
    # task and not when they dragged the card into the Done column — the same
    # rule, working or not working depending on which gesture the user chose.
    from services.niyam.subjects import task_status_changed
    async with pool.acquire() as _conn:
        async with _conn.transaction():
            row=await _conn.fetchrow(
                "UPDATE tasks SET column_id=$1,status=$2,sort_order=$3,completed_at=$4,completed_by_user_id=$5,approval_status=$6,updated_at=NOW() WHERE task_id=$7 RETURNING *",
                payload.column_id,new_status,payload.order,completed_at,completed_by,new_approval_status,task_id)
            # Only when the status actually moved. A drag between two columns
            # that map to the same status is a reorder, not a status change,
            # and emitting one would fire every rule on every tidy-up.
            if doc["status"]!=new_status:
                _org = await _resolve_org_id(pool, doc["team_id"])
                if _org:
                    await task_status_changed(_conn, org_id=_org, actor_id=user["user_id"],
                                              task_id=task_id, old_row=doc, new_row=row)
    if doc["status"]!=new_status:
        from services.activity_logger import log_event
        await log_event(pool,task_id=task_id,actor_id=user["user_id"],event_type="status_changed",
                        data={"from":doc["status"],"to":new_status,"reopen":is_reopen(doc["status"],new_status)})
        await _notify_status_changed(pool, row, dict(doc), doc["status"], new_status, user, task_id)

    return await _fetch_enriched_task(pool, task_id, viewer_id=user["user_id"], org_id=org)

# ── Notifications ─────────────────────────────────────────────────

@api_router.get("/notifications",response_model=List[NotificationOut])
async def list_notifications(
    unread_only: bool = False,
    limit: int = 200,
    before: Optional[str] = None,
    before_id: Optional[str] = None,
    pool=Depends(get_db),
    user=Depends(require_user),
):
    """Return one page of the authenticated user's notifications, newest first.

    KEYSET, NOT OFFSET. `before` / `before_id` are the `created_at` and
    `notification_id` of the last row the caller already has. Offset paging is
    wrong for this table specifically: rows are inserted at the head while the
    user reads, so `OFFSET 40` after a new arrival re-serves a row the caller
    already rendered and skips one it never saw. A keyset cursor is anchored to
    a row, so an insert above it changes nothing about the page below it.

    The tiebreaker is not decoration. `_notify_status_changed` and the reminder
    dispatch both insert a row per recipient inside one loop, so a batch shares
    a `created_at` to the microsecond; ordering on that column alone leaves the
    order inside a batch undefined and a cursor sitting mid-batch can drop or
    repeat its neighbours. `(created_at, notification_id)` is unique because
    `notification_id` is the primary key.

    `limit` defaults to 200 — the cap this endpoint has always applied — so every
    existing caller (the mobile client, which sends no paging params at all) is
    served exactly what it was before.
    """
    limit = max(1, min(int(limit or 200), 200))
    where = ["user_id=$1"]
    args = [user["user_id"]]
    if unread_only:
        where.append("read_at IS NULL")
    cursor_at = parse_dt(before)
    if cursor_at and before_id:
        args.extend([cursor_at, before_id])
        where.append(f"(created_at, notification_id) < (${len(args)-1}, ${len(args)})")
    args.append(limit)
    sql = (
        "SELECT * FROM notifications WHERE " + " AND ".join(where)
        + " ORDER BY created_at DESC, notification_id DESC"
        + f" LIMIT ${len(args)}"
    )
    return [NotificationOut(**dict(r)) for r in await pool.fetch(sql, *args)]

@api_router.post("/notifications/mark-read")
async def mark_read(payload:MarkReadIn,pool=Depends(get_db),user=Depends(require_user)):
    """Mark one, many, or all notifications as read for the authenticated user."""
    if payload.mark_all: await pool.execute("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL",user["user_id"])
    elif payload.notification_ids: await pool.execute("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND notification_id=ANY($2::text[])",user["user_id"],payload.notification_ids)
    return {"ok":True}

@api_router.post("/notifications/process")
async def process_notifications(pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Process due task reminders and create notification rows for each."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],org_id=org)
    rows=await pool.fetch("SELECT * FROM tasks WHERE (user_id=$1 OR team_id=ANY($2::text[])) AND status!='done' AND reminder_at IS NOT NULL AND reminder_at<=$3 AND reminder_sent_at IS NULL",user["user_id"],team_ids,now_utc())
    for t in rows:
        recipients=set(t["assignee_user_ids"] or [])
        if not recipients and t["user_id"]: recipients.add(t["user_id"])
        for uid in recipients:
            await create_notification(pool,uid,"reminder","Task reminder",f"Due soon: {t['title']}",t["task_id"],t["team_id"],"/tasks")
        await pool.execute("UPDATE tasks SET reminder_sent_at=NOW(),updated_at=NOW() WHERE task_id=$1",t["task_id"])
    return {"ok":True,"created":len(rows)}

@api_router.get("/dashboard/summary",response_model=DashboardSummaryOut)
async def dashboard_summary(pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Return task count summary (todo, in-progress, done, overdue, due-24h) for the dashboard."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org); now=now_utc()
    row=await pool.fetchrow("""
        SELECT
          COUNT(*) FILTER (WHERE status='todo')        AS todo,
          COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
          COUNT(*) FILTER (WHERE status='done')        AS done,
          COUNT(*) FILTER (WHERE status!='done' AND due_at<$3)                         AS overdue,
          COUNT(*) FILTER (WHERE status!='done' AND due_at>=$3 AND due_at<$4)          AS due_24h
        FROM tasks
        WHERE (user_id=$1 OR team_id=ANY($2::text[]))
    """,user["user_id"],team_ids,now,now+timedelta(hours=24))
    return DashboardSummaryOut(todo=row["todo"],in_progress=row["in_progress"],done=row["done"],overdue=row["overdue"],due_24h=row["due_24h"])

@api_router.get("/notifications/poll")
async def poll_notifications(pool=Depends(get_db),user=Depends(require_user),org=Depends(active_org_id)):
    """Process due reminders, return unread count + any notifications created in the last 70 s."""
    team_ids=await get_visible_team_ids(pool,user["user_id"],_user_dict=user,org_id=org)
    # Process reminders
    rows=await pool.fetch(
        "SELECT * FROM tasks WHERE (user_id=$1 OR team_id=ANY($2::text[])) AND status!='done'"
        " AND reminder_at IS NOT NULL AND reminder_at<=$3 AND reminder_sent_at IS NULL",
        user["user_id"],team_ids,now_utc()
    )
    for t in rows:
        recipients=set(t["assignee_user_ids"] or [])
        if not recipients and t["user_id"]: recipients.add(t["user_id"])
        for uid in recipients:
            await create_notification(pool,uid,"reminder","Task reminder",f"Due soon: {t['title']}",t["task_id"],t["team_id"],"/tasks")
        await pool.execute("UPDATE tasks SET reminder_sent_at=NOW(),updated_at=NOW() WHERE task_id=$1",t["task_id"])
    unread=await pool.fetchval(
        "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL",
        user["user_id"]
    )
    # Return notifications created in the last 70 s so the client can toast them
    fresh=await pool.fetch(
        "SELECT * FROM notifications WHERE user_id=$1 AND read_at IS NULL"
        " AND created_at > NOW() - INTERVAL '70 seconds' ORDER BY created_at DESC LIMIT 5",
        user["user_id"]
    )
    # Pending approvals the user can actually action. 01-navigation.md §4 asks
    # for ONE call returning { inbox, approvals } — the sidebar declared
    # `badge: 'approvals'` on /approvals and nothing ever fetched the number,
    # so the badge element was gated on a hardcoded 0 and never mounted.
    #
    # It rides on this endpoint rather than a new one because this is already
    # polled every 60 s; a second poll for a second integer is the waste §4
    # names. Mirrors the visibility rules in approvals_router.get_pending_approvals.
    from middleware.roles import is_org_admin
    # Scoped: the wide branch below counts pending approvals across every team
    # the caller holds any row on, so an unscoped admin answer put another org's
    # backlog in this org's badge.
    if (await is_org_admin(user["user_id"], org) if org
            else await is_org_admin(user["user_id"])):
        approvals = await pool.fetchval("""
            SELECT COUNT(*) FROM tasks t
            WHERE t.approval_status = 'pending'
              AND (
                EXISTS (SELECT 1 FROM project_assignments pa WHERE pa.team_id=t.team_id AND pa.user_id=$1)
                OR EXISTS (SELECT 1 FROM team_members tmem WHERE tmem.team_id=t.team_id AND tmem.user_id=$1 AND tmem.status='active')
              )
        """, user["user_id"])
    else:
        approvals = await pool.fetchval("""
            SELECT COUNT(*) FROM tasks t
            JOIN team_members tmem ON tmem.team_id = t.team_id AND tmem.user_id = $1
            WHERE t.approval_status = 'pending'
              AND tmem.role IN ('owner', 'admin')
              AND tmem.status = 'active'
        """, user["user_id"])

    return {
        "unread": unread or 0,
        "approvals": approvals or 0,
        "fresh": [NotificationOut(**dict(r)).model_dump(mode="json") for r in fresh],
    }

@api_router.get("/push/vapid-public-key")
async def get_vapid_public_key(user=Depends(require_user)):
    return {"public_key": VAPID_PUB if wp_is_configured() else "not-configured"}

@api_router.post("/push/subscribe")
async def subscribe_push(payload: PushSubscriptionIn, user=Depends(require_user)):
    pool = await get_pool()
    sub = payload.model_dump()
    await wp_save_subscription(pool, user["user_id"], sub)
    return {"ok": True}

@api_router.post("/push/unsubscribe")
async def unsubscribe_push(payload: PushSubscriptionIn, user=Depends(require_user)):
    """Unsubscribe one of the CALLER'S OWN browser push registrations.

    The endpoint arrives in the request body, so it must be scoped to the caller.
    Unscoped, this deleted by endpoint alone and any authenticated user could
    silence any other user's browser notifications by supplying their endpoint —
    the victim would see no error, their notifications would just stop.
    """
    pool = await get_pool()
    endpoint = (payload.model_dump() or {}).get("endpoint", "")
    if endpoint:
        await wp_remove_subscription(pool, endpoint, user["user_id"])
    return {"ok": True}


# ── App assembly ────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(invite_router)
app.include_router(approvals_router)
app.include_router(health_router)
app.include_router(api_router)

# v2 routers
app.include_router(fields_router)
app.include_router(views_router)
app.include_router(activity_router)
app.include_router(dashboards_router)
app.include_router(templates_router)
app.include_router(time_router)
app.include_router(uploads_router)   # R2-backed file upload (replaces old base64 /api/upload)
app.include_router(reports_router)
app.include_router(documents_router)  # quotation / statement / GSTR-3B / TDS / agreement / project report
app.include_router(task_reminders_router)
app.include_router(subscription_router)
app.include_router(hub_router)
app.include_router(admin_orgs_router)
app.include_router(billing_router)
app.include_router(hub_chat_router)
app.include_router(hub_publish_router)
app.include_router(hub_connectors_router)
app.include_router(lead_sources_router)
app.include_router(graha_router)
app.include_router(ganit_router)
app.include_router(manav_router)
app.include_router(vikray_router)
app.include_router(vetana_router)
app.include_router(analytics_router)
app.include_router(dristi_router)
app.include_router(prachar_router)
app.include_router(prachar_ads_router)
app.include_router(esign_router)
app.include_router(org_members_router)
app.include_router(org_invites_router)
app.include_router(pahchan_attendance_router)
app.include_router(org_profile_router)
app.include_router(org_switch_router)
app.include_router(org_modules_router)
app.include_router(org_security_router)
app.include_router(scrapers_router)
app.include_router(scheduler_router)
app.include_router(niyam_router)
app.include_router(niyam_rules_router)
app.include_router(messaging_router)
# Shares `/api/v1/messaging` and `messaging.py`'s own module gate and access
# check — see routers/sanvaad_sahayak.py for why it is a separate file.
app.include_router(sanvaad_sahayak_router)
app.include_router(whatsapp_router)
app.include_router(pahchan_router)
app.include_router(me_router)
# Both of these were written, reviewed and left unregistered, so the module was
# dead while its callers shipped. `GET /api/search` is what CommandPalette.jsx:107
# has always called — the palette treats one 404 as "absent" and stops asking, so
# the symptom was a quiet ⌘K that only ever returned the static commands.
# `/api/v1/tasks/bulk` is what BulkBar.jsx:74,102 calls; without it every bulk
# action fell back to nothing. Registering a router is the whole fix in both cases.
# search.py defers its `from server import get_visible_team_ids` to call time
# precisely so this import is not circular.
app.include_router(audit_router)
app.include_router(search_router)
app.include_router(tasks_bulk_router)
# The only unauthenticated route that returns invoice data. Rate-limited per IP
# inside the router; see routers/pay.py for why every refusal is a 404.
app.include_router(pay_router)
app.include_router(sync_router)

# ── Local file storage (dev only) ────────────────────────────────────────────
_local_storage = os.getenv("LOCAL_STORAGE_PATH")
if _local_storage:
    from starlette.staticfiles import StaticFiles
    Path(_local_storage).mkdir(parents=True, exist_ok=True)
    app.mount("/local-files", StaticFiles(directory=_local_storage), name="local-files")

# ── Verse of the day (public) ────────────────────────────────────────────────
@app.get("/api/verse-of-the-day")
async def verse_of_the_day():
    """Return today's Bhagavad Gita verse — same verse for all users all day."""
    return await get_verse_of_the_day()


async def _run_startup_migrations():
    """Run idempotent schema migrations in the background so the server is ready immediately."""
    try:
        pool = await get_pool()
        already = await pool.fetchval(
            "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='notifications'")
        if already:
            return
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.project_assignments (
                assignment_id TEXT PRIMARY KEY DEFAULT ('pa_' || substr(md5(random()::text), 1, 12)),
                team_id       TEXT NOT NULL,
                user_id       TEXT NOT NULL,
                role          TEXT NOT NULL DEFAULT 'member',
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(team_id, user_id)
            )
        """)
        await pool.execute("""
            CREATE INDEX IF NOT EXISTS idx_project_assignments_user ON public.project_assignments(user_id)
        """)
        await pool.execute("""
            CREATE INDEX IF NOT EXISTS idx_project_assignments_team ON public.project_assignments(team_id)
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.activity_events (
                event_id    TEXT PRIMARY KEY DEFAULT ('evt_' || substr(md5(random()::text), 1, 12)),
                task_id     TEXT REFERENCES public.tasks(task_id) ON DELETE CASCADE,
                team_id     TEXT NOT NULL,
                actor_id    TEXT,
                type        TEXT NOT NULL,
                data        JSONB DEFAULT '{}',
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE INDEX IF NOT EXISTS idx_activity_events_team ON public.activity_events(team_id, created_at DESC)
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.time_entries (
                entry_id    TEXT PRIMARY KEY,
                task_id     TEXT REFERENCES public.tasks(task_id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                started_at  TIMESTAMPTZ,
                ended_at    TIMESTAMPTZ,
                minutes     INTEGER,
                description TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Soft-delete columns on teams
        await pool.execute("ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
        await pool.execute("ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS deleted_by TEXT")
        # Project colour
        await pool.execute("ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS color TEXT")
        # Mobile: push tokens + notification prefs
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.push_tokens (
                id          TEXT PRIMARY KEY DEFAULT ('pt_' || substr(md5(random()::text),1,12)),
                user_id     TEXT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
                platform    TEXT NOT NULL,
                token       TEXT NOT NULL,
                device_id   TEXT NOT NULL UNIQUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.notification_prefs (
                user_id     TEXT PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
                prefs       JSONB NOT NULL DEFAULT '{}',
                quiet_start TEXT NOT NULL DEFAULT '22:00',
                quiet_end   TEXT NOT NULL DEFAULT '07:00',
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Notifications table
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.notifications (
                notification_id TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                team_id         TEXT,
                type            TEXT NOT NULL,
                title           TEXT NOT NULL,
                message         TEXT NOT NULL DEFAULT '',
                task_id         TEXT,
                url             TEXT,
                read_at         TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC)")
        # Custom fields tables
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.field_definitions (
                field_id    TEXT PRIMARY KEY,
                team_id     TEXT NOT NULL REFERENCES public.teams(team_id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL,
                config      JSONB NOT NULL DEFAULT '{}',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.field_values (
                task_id     TEXT NOT NULL REFERENCES public.tasks(task_id) ON DELETE CASCADE,
                field_id    TEXT NOT NULL REFERENCES public.field_definitions(field_id) ON DELETE CASCADE,
                value       JSONB,
                PRIMARY KEY (task_id, field_id)
            )
        """)
        # (subtasks are JSONB — no separate table migration needed)
        # Approvals table (client task request workflow)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.approvals (
                approval_id  TEXT PRIMARY KEY,
                team_id      TEXT,
                requested_by TEXT,
                status       TEXT NOT NULL DEFAULT 'pending',
                request_type TEXT,
                request_data JSONB,
                task_id      TEXT,
                reviewed_by  TEXT,
                reviewed_at  TIMESTAMPTZ,
                review_notes TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_approvals_team ON public.approvals(team_id)")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON public.approvals(task_id)")
        await pool.execute("ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approval_id TEXT")
        # Web Push subscriptions
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.push_web_subscriptions (
                id         TEXT PRIMARY KEY DEFAULT ('pws_' || substr(md5(random()::text),1,12)),
                user_id    TEXT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
                endpoint   TEXT NOT NULL UNIQUE,
                p256dh     TEXT NOT NULL,
                auth       TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_pws_user ON public.push_web_subscriptions(user_id)")
        # Tasks extra columns
        await pool.execute("ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
        await pool.execute("ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_by_user_id TEXT")
        # Report schedules
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.report_schedules (
                schedule_id   TEXT PRIMARY KEY,
                team_id       TEXT NOT NULL,
                created_by    TEXT,
                frequency     TEXT NOT NULL DEFAULT 'weekly',
                file_formats  TEXT[] NOT NULL DEFAULT ARRAY['pdf'],
                recipients    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
                day_of_week   INTEGER,
                day_of_month  INTEGER,
                send_hour_utc INTEGER NOT NULL DEFAULT 2,
                is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                next_run_at   TIMESTAMPTZ,
                last_sent_at  TIMESTAMPTZ,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_report_sched_team ON public.report_schedules(team_id)")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_report_sched_next ON public.report_schedules(next_run_at) WHERE is_active=TRUE")
        # Task reminders (multi-offset, multi-channel)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.task_reminders (
                reminder_id     TEXT PRIMARY KEY DEFAULT ('tr_' || substr(md5(random()::text),1,12)),
                task_id         TEXT NOT NULL REFERENCES public.tasks(task_id) ON DELETE CASCADE,
                offset_minutes  INTEGER NOT NULL,
                channel_inapp   BOOLEAN NOT NULL DEFAULT TRUE,
                channel_push    BOOLEAN NOT NULL DEFAULT TRUE,
                channel_email   BOOLEAN NOT NULL DEFAULT FALSE,
                fire_at         TIMESTAMPTZ NOT NULL,
                sent_at         TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_task_reminders_due ON public.task_reminders(fire_at) WHERE sent_at IS NULL")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_task_reminders_task ON public.task_reminders(task_id)")
        # `key TEXT PRIMARY KEY` is what made one organisation's brand kit every
        # organisation's brand kit — see `_get_org_settings`. The shape below is
        # the post-`migrations/126` one, so a database created from scratch is
        # born correct; 126 is what carries an EXISTING database across, and this
        # deliberately does not ALTER anything, because a startup ALTER is a
        # migration applied by deploy rather than by decision, and `staging` is
        # the schema production writes to as well.
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS public.org_settings (
                org_id UUID NOT NULL,
                key    TEXT NOT NULL,
                value  JSONB NOT NULL DEFAULT '[]',
                PRIMARY KEY (org_id, key)
            )
        """)
        await pool.execute("ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS brand_settings JSONB NOT NULL DEFAULT '{\"colors\":[],\"fonts\":[]}'::jsonb")
        await pool.execute("ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS authorized_signatory_name TEXT DEFAULT ''")
        await pool.execute("ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS authorized_signatory_designation TEXT DEFAULT ''")
        # Org credit tables (migration 052)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS staging.hub_org_credits (
                org_id      UUID PRIMARY KEY REFERENCES staging.organisations(id) ON DELETE CASCADE,
                balance     INTEGER NOT NULL DEFAULT 0,
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS staging.hub_user_credits (
                org_id      UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                allocated   INTEGER NOT NULL DEFAULT 0,
                used        INTEGER NOT NULL DEFAULT 0,
                updated_at  TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (org_id, user_id)
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_hub_user_credits_org ON staging.hub_user_credits(org_id)")
        await pool.execute("""
            CREATE TABLE IF NOT EXISTS staging.hub_org_credit_transactions (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id          UUID NOT NULL REFERENCES staging.organisations(id) ON DELETE CASCADE,
                user_id         TEXT,
                amount          INTEGER NOT NULL,
                balance_after   INTEGER NOT NULL,
                tx_type         TEXT NOT NULL DEFAULT 'debit',
                description     TEXT DEFAULT '',
                created_by      TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_hub_org_credit_tx_org ON staging.hub_org_credit_transactions(org_id)")
        # AI logs org_id column (migration 053)
        await pool.execute("ALTER TABLE staging.hub_ai_logs ADD COLUMN IF NOT EXISTS org_id UUID")
        await pool.execute("CREATE INDEX IF NOT EXISTS idx_hub_ai_logs_org_id ON staging.hub_ai_logs(org_id)")
        # Per-org markup percentage (migration 054)
        await pool.execute("ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(5,4) NOT NULL DEFAULT 0.30")
        # Plan default credits & monthly reset tracking (migration 055)
        await pool.execute("ALTER TABLE staging.plans ADD COLUMN IF NOT EXISTS default_credits INTEGER NOT NULL DEFAULT 0")
        await pool.execute("ALTER TABLE staging.hub_org_credits ADD COLUMN IF NOT EXISTS credits_reset_at TIMESTAMPTZ DEFAULT NOW()")
        await pool.execute("ALTER TABLE staging.hub_scraper_runs ADD COLUMN IF NOT EXISTS credits_charged INTEGER DEFAULT 0")
        await pool.execute("ALTER TABLE staging.hub_scraper_catalog ADD COLUMN IF NOT EXISTS credit_cost INTEGER NOT NULL DEFAULT 2")
        # REMOVED: the CASE backfill that derived credit_cost from cost_per_run
        # `WHERE credit_cost = 2`. 2 is that column's own DEFAULT, so the filter
        # could not tell a row nobody had priced from a row an operator had
        # deliberately priced at 2 — and it re-ran on every boot, so every such
        # decision was quietly re-bucketed at the next restart. credit_cost is
        # not a hint: services/credits.price_of reads this exact column for
        # kind='scraper', so that was a boot job moving a live price.
        # The catalog has been through this backfill many times over; a row
        # added from here on is priced by whoever inserts it.
        await pool.execute("UPDATE staging.plans SET default_credits=200 WHERE code='free' AND default_credits=0")
        await pool.execute("UPDATE staging.plans SET default_credits=500 WHERE code='starter' AND default_credits=0")
        await pool.execute("UPDATE staging.plans SET default_credits=1000 WHERE code='growth' AND default_credits=0")
        await pool.execute("UPDATE staging.plans SET default_credits=2000 WHERE code='scale' AND default_credits=0")
        # Per-org monthly_credits and monthly_price overrides
        await pool.execute("ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS monthly_credits INTEGER NOT NULL DEFAULT 0")
        await pool.execute("ALTER TABLE staging.organisations ADD COLUMN IF NOT EXISTS monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0")
        # REMOVED: the plan-default re-seed, which ran
        #     UPDATE organisations SET monthly_credits = plans.default_credits
        #      WHERE monthly_credits = 0 AND default_credits > 0
        # on every boot. monthly_credits is a NEGOTIATED figure that the owner
        # sets per org by hand, and 0 is one of the terms it can hold — not a
        # blank waiting to be filled. Plans carry no commercial truth;
        # default_credits is a brochure number. So that statement could not tell
        # an agreed zero from an unset one and always resolved it the expensive
        # way, undoing the owner's decision at the next restart.
        # A plan default may never write to an org's negotiated column.
        # Post-095 it is worse than untidy: credits.roll_period SETs
        # allowance_balance from monthly_credits every period and writes a
        # 'grant' ledger row, so an overwritten 0 becomes a recurring monthly
        # grant that reads, on the ledger, as something a human chose.
        # Setting an org's number is PATCH /admin/orgs/{id}/settings.
        #
        # REMOVED with it: the hub_org_credits seed. It inserted
        # (org_id, balance, credits_reset_at) — `balance` alone — which post-095
        # leaves allowance_balance and purchased_balance at 0 while balance says
        # N. The org then reads 0 spendable through services/credits.py, which
        # spends the buckets, and N through anything still reading `balance`;
        # the row lands in staging.v_org_credit_drift the moment it is written.
        # services/credits.balance_of creates the wallet — all three columns and
        # period_start in one INSERT — and 095 §3 gives every existing org a row.
        # That leaves ONE writer of this money table instead of two that
        # disagree about the same row, which is the point of the exercise.
        # Ensure all users with role='admin' have platform_admin in user_roles
        await pool.execute("""
            INSERT INTO staging.user_roles (user_id, org_id, role_code)
            SELECT user_id, NULL, 'platform_admin'
            -- NOT is_system is belt-and-braces: Niyam accounts are seeded with
            -- role='member', but a system row must never be one UPDATE away
            -- from platform_admin.
            FROM users WHERE role = 'admin' AND NOT COALESCE(is_system, FALSE)
            ON CONFLICT DO NOTHING
        """)
        logger.info("Startup migrations OK")
    except Exception as e:
        logger.warning("Startup migration warning (non-fatal): %s", e)


async def _sweep_stranded_scraper_runs():
    """Give back scraper charges whose poller died with the previous process.

    routers/scrapers._poll_run is an in-process asyncio task that holds an
    upfront debit until the scrape reports back. A deploy kills it mid-flight
    and takes the refund with it: the run sits at 'running' forever, the money
    is gone, and no screen anywhere says so. A restart is the only moment those
    rows can be found, which is why sweep_stranded_runs is not self-scheduling
    and why its single caller is here.

    Never raises. A stranded run is already stranded — failing the boot over it
    would take the product down without giving anybody their credits back — so
    this logs at ERROR and the next restart sweeps again.
    """
    try:
        result = await sweep_stranded_runs()
        if result.get("swept") or result.get("failed") or result.get("error"):
            logger.warning("Stranded scraper run sweep: %s", result)
    except Exception as e:
        logger.error(
            "Stranded scraper run sweep did not run: %s — any scraper charge "
            "held by a poller lost in the last deploy is still held", e)


async def _startup_background():
    """The boot work nothing should wait for, in the order it has to happen in.

    The sweep runs AFTER the migrations, not beside them. The block above takes
    an AccessExclusiveLock on staging.hub_scraper_runs (ADD COLUMN
    credits_charged) and on staging.hub_org_credits, and the sweep reads the
    first and locks rows in the second — racing them would put a credit
    transaction and a DDL statement in a queue behind each other on this
    process's own tables. Migrations swallow their own failures, so an
    unhealthy schema still lets the sweep have its attempt.
    """
    await _run_startup_migrations()
    await _sweep_stranded_scraper_runs()


@app.on_event("startup")
async def startup():
    """Log configuration and kick off background boot work so the server is ready immediately."""
    dsn=os.environ.get("DATABASE_URL","NOT SET")
    if "@" in dsn:
        parts=dsn.split("@"); user_part=parts[0].split("://")[-1].split(":")[0]; host_part=parts[1]
        logger.info("DATABASE_URL: postgresql://%s:***@%s", user_part, host_part)
    else:
        logger.info("DATABASE_URL: %s", dsn)
    r2_bucket = os.environ.get("R2_BUCKET_NAME", "NOT SET")
    logger.info("R2_BUCKET: %s | R2_PUBLIC_URL: %s", r2_bucket, os.environ.get('R2_PUBLIC_URL', '<presigned>'))
    logger.info("CORS origins: %s", ALLOWED_ORIGINS)
    logger.info("Kartavaya API v2 ready — custom fields, automations, activity, time tracking, R2 uploads")
    # Run schema migrations, then the stranded-run sweep, in the background so
    # gunicorn workers are ready immediately. The healthcheck hits /api/health
    # which also warms the pool, so the background task completes well before
    # real user traffic arrives.
    #
    # Every worker and every replica runs this, and that is fine for the sweep:
    # credits.refund is refund-once at the database, so the losers of that race
    # write nothing. It is a fire-and-forget task — a dyno killed before it
    # finishes drops it silently — which is survivable only because the work is
    # idempotent and the next boot repeats it. Do not put anything here that is
    # not both.
    asyncio.create_task(_startup_background())

@app.on_event("shutdown")
async def shutdown():
    """Drain the outbound log, then close the database connection pool.

    ORDER IS THE WHOLE POINT. `outbound_log.write()` buffers in memory and
    returns — that is why a payroll run that mails 71 payslips costs one
    statement and nothing on the request path — so whatever is still buffered
    when this hook runs exists ONLY in this process. `shutdown()` is the drain,
    and it needs the pool that `close_pool()` is about to take away; after that
    line there is nothing left to write with.

    It matters here more than it would elsewhere because Railway redeploys this
    service constantly, and the rows most likely to be in the buffer at that
    moment are the most interesting ones: `email_service` and
    `services/employee_email` report the provider's answer from a background
    thread that can outlive the request that started it, and that answer is the
    half of the row carrying the SES MessageId — the only join key a later
    bounce notification has.

    Bounded and non-raising by construction (see its docstring), so a logger
    cannot fail a deploy any more than it can fail a send.
    """
    await outbound_log.shutdown()
    await close_pool()

def App():
    """Return the FastAPI application instance (used by some ASGI runners)."""
    return app
