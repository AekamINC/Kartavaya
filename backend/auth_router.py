"""
auth_router.py — Kartavaya by Aekam Inc
Invite-only auth. No public registration.
Roles: admin | member | client
"""
import hashlib
import hmac
import json
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field

from db import get_pool
from limiter import limiter
from middleware.role_tiers import (
    ADMIN, DEFAULT_GRANT_LEVEL, LEVELS, modules_for, strongest,
)
from services.audit import emit as audit

_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") != "0"
_COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", None) or None

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable must be set")
JWT_ALGORITHM = "HS256"
JWT_TTL_DAYS = 7


def _hash_password(password: str, salt: str) -> str:
    """Return the PBKDF2-SHA256 hex digest of password with the given salt."""
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000).hex()


def _verify_password(password: str, salt: str, stored: str) -> bool:
    """Return True if the password matches the stored hash using constant-time comparison."""
    return hmac.compare_digest(_hash_password(password, salt), stored)


def _create_token(user_id: str, iat: Optional[datetime] = None) -> str:
    """Create a signed JWT for the given user_id, expiring in JWT_TTL_DAYS days.

    `iat` exists for ONE caller: `reset_password`, which has just written a
    revocation cutoff and must mint a token that is on the valid side of it.
    Passing the exact cutoff makes that true by construction rather than by
    luck. PyJWT writes `iat` as integer seconds TRUNCATED DOWN, so a token
    minted a few milliseconds after a cutoff would otherwise carry an `iat`
    BELOW it and `require_user` would 401 the person who just reset their
    password.

    MUST NOT BE IN THE FUTURE. PyJWT validates `iat` and raises
    `ImmatureSignatureError` for a future-dated one, which would make the
    returned token undecodable rather than merely revoked. `reset_password`
    passes its own `datetime.now()`, so this cannot happen; do not "improve" it
    into a database timestamp. Every other call site passes nothing.
    """
    issued = iat or datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "exp": issued + timedelta(days=JWT_TTL_DAYS), "iat": issued},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )


def _auth_response(token: str, body: dict) -> JSONResponse:
    """Return a JSON response that also sets the session_token httpOnly cookie."""
    resp = JSONResponse(content=body)
    resp.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        max_age=JWT_TTL_DAYS * 86400,
        path="/",
        domain=_COOKIE_DOMAIN,
    )
    return resp


def _decode_claims(token: str) -> Optional[dict]:
    """Decode a JWT and return its full claims dict, or None if invalid."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def _decode_token(token: str) -> Optional[str]:
    """Decode a JWT and return the user_id subject, or None if invalid.

    Signature-and-expiry ONLY — this says nothing about revocation. It is kept
    returning `str | None` because `routers/reports.py` imports it as
    `_auth_decode`; use `resolve_token_user_id` if you need the revocation
    check too.
    """
    claims = _decode_claims(token)
    return claims.get("sub") if claims else None


# Columns `require_user` puts on `request.state._auth_user`. `sessions_valid_from`
# rides a lookup that already happens on every authenticated request, so
# enforcing revocation costs +1 column on a single-row primary-key read and
# ZERO extra round-trips. See migrations/118_session_revocation.sql.
_USER_COLUMNS_BASE = (
    "user_id,email,name,full_name,role,avatar,position,company_name,"
    "member_role,receives_approval_emails"
)
_USER_COLUMNS = _USER_COLUMNS_BASE + ",sessions_valid_from"

SESSION_REVOKED_DETAIL = "Signed out — the password on this account was changed."

# Flipped to False the first time Postgres says `sessions_valid_from` does not
# exist, i.e. this code was deployed before 118_session_revocation.sql was
# applied. WHY A FALLBACK AND NOT A HARD FAILURE: without it that ordering
# mistake 500s every authenticated request in the product — a total outage —
# whereas with it revocation is merely not yet in force, which is exactly where
# the product stood before this change. It is a DEGRADED state, not a normal
# one: it logs an error, and `GET /api/v1/me/sessions` reports it to the user
# instead of claiming a revocation that is not running. The correct order is
# migration first (it is inert on its own), then deploy.
_revocation_column_present = True


def revocation_active() -> bool:
    """True if the revocation cutoff column is present and being enforced."""
    return _revocation_column_present


def _is_undefined_column(exc: Exception) -> bool:
    """True if `exc` is Postgres 42703 undefined_column for our cutoff column."""
    if getattr(exc, "sqlstate", None) == "42703":
        return True
    return "sessions_valid_from" in str(exc) and "column" in str(exc).lower()


async def _fetch_auth_user(pool, user_id: str, columns: str, base_columns: str):
    """Read the auth row, degrading to `base_columns` if the migration is absent."""
    global _revocation_column_present
    if _revocation_column_present:
        try:
            return await pool.fetchrow(f"SELECT {columns} FROM users WHERE user_id=$1", user_id)
        except Exception as exc:  # noqa: BLE001 — narrowed by _is_undefined_column
            if not _is_undefined_column(exc):
                raise
            _revocation_column_present = False
            logger.error(
                "sessions_valid_from is missing: session revocation is NOT in force. "
                "Apply backend/migrations/118_session_revocation.sql, then redeploy."
            )
    return await pool.fetchrow(f"SELECT {base_columns} FROM users WHERE user_id=$1", user_id)


def _session_is_revoked(claims: dict, user: dict) -> bool:
    """True if this token was issued before the account's revocation cutoff.

    NULL cutoff means the account has never been revoked, which is every
    account until somebody resets a password — so the migration signs nobody
    out and needs no deploy grace window.

    COMPARED IN WHOLE SECONDS, on both sides, and that is not a rounding
    nicety — it is the third of three independent guards against signing out
    the person who just reset their password. PyJWT writes `iat` as integer
    seconds TRUNCATED DOWN. A cutoff carrying microseconds (say T.567891) would
    therefore sit ABOVE the `iat` of a token minted moments later in the same
    second (floor → T), and `T < T.567891` revokes it. Flooring the cutoff too
    puts both values in the units the claim is actually expressed in, so the
    check stays correct even if `reset_password`'s own truncation is ever
    dropped. Revocation is unharmed: a token from the previous second still has
    `iat` strictly below the floored cutoff.

    RESIDUAL, STATED NOT PAPERED OVER: a token issued in the SAME one-second
    tick as the reset survives it.

    FAILS CLOSED on a missing `iat`. `_create_token` has always written one, so
    a real token without `iat` does not exist; refusing it is strictly safer
    than treating "no issue time" as "issued recently".
    """
    cutoff = user.get("sessions_valid_from")
    if cutoff is None:
        return False
    iat = claims.get("iat")
    if iat is None:
        return True
    if cutoff.tzinfo is None:
        # The column is TIMESTAMPTZ, so asyncpg hands back an aware datetime and
        # this does not fire. It is here because the failure it prevents is
        # SILENT AND HOURS WIDE: `.timestamp()` on a naive datetime assumes the
        # process's local time zone, which on a server west of UTC would revoke
        # every token issued in the last several hours, and east of UTC would
        # revoke nothing for several hours. Both look like intermittent bugs.
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    return int(iat) < int(cutoff.timestamp())


async def resolve_token_user_id(token: str) -> Optional[str]:
    """Validate a raw token the way `require_user` does and return the user_id.

    For the ONE authenticated path that does not go through `require_user`:
    the platform-staff fallback on the report dispatch endpoint
    (`routers/reports.py`). Without this, a revoked token would still be
    accepted there — a revocation with a hole in it is worse than none, because
    it is untestable in the place it leaks.
    """
    claims = _decode_claims(token)
    if not claims or not claims.get("sub"):
        return None
    pool = await get_pool()
    user = await _fetch_auth_user(
        pool, claims["sub"], "user_id, sessions_valid_from", "user_id",
    )
    if not user:
        return None
    if _session_is_revoked(claims, dict(user)):
        return None
    return claims["sub"]


async def require_user(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """FastAPI dependency that validates the Bearer token and returns the user dict."""
    # Cache resolved user on the request state for this request's lifetime.
    # Avoids a DB round-trip when multiple dependencies call require_user
    # on the same request (e.g. require_admin → require_user).
    cached = getattr(request.state, "_auth_user", None)
    if cached is not None:
        return cached

    token = credentials.credentials if credentials else request.cookies.get("session_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    claims = _decode_claims(token)
    user_id = claims.get("sub") if claims else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    pool = await get_pool()
    user = await _fetch_auth_user(pool, user_id, _USER_COLUMNS, _USER_COLUMNS_BASE)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    result = dict(user)
    # Revocation. Its own detail string, distinct from "Invalid or expired
    # token", so the web and mobile clients can say WHY instead of implying the
    # session merely lapsed.
    if _session_is_revoked(claims, result):
        raise HTTPException(status_code=401, detail=SESSION_REVOKED_DETAIL)
    request.state._auth_user = result
    return result


async def require_admin(user=Depends(require_user)):
    """FastAPI dependency that raises 403 unless the user has the admin role."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


class AcceptInviteBody(BaseModel):
    token: str
    name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


def _safe_user(
    u: dict,
    platform_roles: list[str] | None = None,
    org_roles: list[dict] | None = None,
    module_grants: list[str] | None = None,
    module_levels: dict[str, str] | None = None,
    org: dict | None = None,
) -> dict:
    """Return a public-safe subset of user fields for API responses."""
    out = {
        "id": u["user_id"],
        "user_id": u["user_id"],
        "name": u["name"],
        "email": u["email"],
        "role": u.get("role", "member"),
        "avatar": u.get("avatar"),
    }
    if platform_roles:
        out["platform_roles"] = platform_roles
    if org_roles:
        out["org_roles"] = org_roles
    # `is not None`, NOT truthiness. An EMPTY list is a real answer — "this
    # member has been granted nothing" — and it is the answer the nav needs in
    # order to hide the modules group. Dropping it on falsiness would turn the
    # one case that matters back into "no opinion", which is what left ten
    # module links in the sidebar of a member who gets 403 on every one.
    if module_grants is not None:
        out["module_grants"] = module_grants
    # Same three-state contract as `module_grants`, and for the same reason: an
    # empty MAP means "granted nothing", an ABSENT key means "no opinion — this
    # caller writes everywhere its subscription reaches". `is not None` keeps
    # those apart. See `_module_levels`.
    if module_levels is not None:
        out["module_levels"] = module_levels
    # THE SAME THREE-STATE CONTRACT AGAIN, and here it is load-bearing in a way
    # the other two are not: `Protected.jsx` REDIRECTS on this key.
    #
    # An ABSENT `org` means "no opinion" and the gate stays quiet. That is the
    # answer for a caller with no org membership, for a freshly invited account
    # whose roles have not been read, and for any request where the org lookup
    # failed. A DB hiccup must never be able to say "your setup is incomplete"
    # and trap every user of the product in a wizard.
    if org is not None:
        out["org"] = org
    return out


#: Whether `staging.organisations.onboarding_complete` exists on the live
#: database — i.e. whether `migrations/116_onboarding_complete.sql` has been
#: applied. THERE IS ONE `staging` SCHEMA AND PRODUCTION WRITES TO IT TOO, so
#: 116 is a file that somebody applies by hand and this code reaches a database
#: that does not have the column for as long as that takes.
#:
#: Cached only once the answer is YES, for `org_profile._available_columns`'s
#: reason: the migration may be applied under a long-running process, and a
#: permanently cached "no" would keep the gate inert until the next redeploy.
_onboarding_column_present: bool = False


async def _onboarding_column_exists(pool) -> bool:
    global _onboarding_column_present
    if _onboarding_column_present:
        return True
    row = await pool.fetchrow(
        "SELECT 1 AS ok FROM information_schema.columns "
        "WHERE table_schema='staging' AND table_name='organisations' "
        "AND column_name='onboarding_complete'"
    )
    # The query returns at most one row, and only when the column exists.
    _onboarding_column_present = row is not None
    return _onboarding_column_present


def _active_org_role(org_roles: list[dict], header_org: str | None = None) -> dict | None:
    """WHICH org this session is scoped to — the one answer, in one place.

    `X-Org-Id` is honoured ONLY when the id appears in the caller's OWN
    `org_roles`, which were read from `staging.user_roles` two statements ago.
    That check needs no query — the rows are already in hand — and it is the
    same rule `middleware/org_resolver.get_org_id` enforces against the database
    for every other route in the product. Otherwise the earliest grant wins,
    because `or_rows` is `ORDER BY granted_at` and that is the org
    `get_org_id`'s own fallback resolves to when no header is sent.

    ── WHY THIS IS A FUNCTION AND NOT THREE COPIES OF A CONDITIONAL ────────────

    It used to be one copy, inside `_org_for`, and the other two readers did not
    have it. `_module_grants` and `_module_levels` took `org_roles[0]` — the
    EARLIEST-JOINED org — while `_org_for` resolved the header org two lines
    later for the badge. So an ordinary member of two orgs switched
    organisation and the breadcrumb changed while the module rail stayed pinned
    to the org they joined first: the sidebar of one company over the data of
    another, on the same screen.

    Three readers of "which org is this" is three chances to disagree. Now there
    is one, and a fourth reader gets it right by calling it.
    """
    if not org_roles:
        return None
    if header_org:
        for r in org_roles:
            if str(r.get("org_id")) == str(header_org):
                return r
    return org_roles[0]


async def _org_for(pool, org_roles: list[dict], header_org: str | None = None) -> dict | None:
    """The org this session is scoped to, and whether it still needs setting up.

    `Protected.jsx` has implemented 12-auth-onboarding.md §5's redirect since the
    wizard was routed — `user?.org?.onboarding_complete === false` sends the
    caller to `/onboarding` — and this payload has never carried an `org` key of
    any kind, so the gate could not fire even in principle. This is the field it
    reads.

    ── WHICH org ────────────────────────────────────────────────────────────
    `or_rows` is ordered by `granted_at`, so `[0]` is the org
    `middleware/org_resolver.py` falls back to when no `X-Org-Id` is sent —
    every request in the product is scoped to that one, so the gate must be too.

    `X-Org-Id` is honoured ONLY when the id appears in the caller's OWN
    `org_roles`. `lib/api.js:38` attaches that header to every request including
    this one, and the cross-org header bypass is a live, measured leak
    (`middleware/org_resolver.CROSS_ORG_HEADER_PREFIXES` documents three chains
    that worked). A membership check here is cheap and needs no query: the rows
    are already in hand.

    ── MISSING COLUMN MEANS COMPLETE ────────────────────────────────────────
    Not "incomplete", and not absent. While 116 is unapplied every org reports
    `onboarding_complete: true`, so nobody is redirected anywhere. An unapplied
    migration must not be able to trap a user in a wizard, and it is the state
    the product is in until the owner runs the file.

    Returns None — "no opinion" — on ANY failure, and for a caller with no org.
    """
    active = _active_org_role(org_roles, header_org)
    if not active or not active.get("org_id"):
        return None
    org_id = str(active["org_id"])

    try:
        if await _onboarding_column_exists(pool):
            row = await pool.fetchrow(
                "SELECT id::text AS id, name, onboarding_complete "
                "FROM staging.organisations WHERE id=$1::uuid",
                org_id,
            )
            if not row:
                return None
            return {
                "id": row["id"],
                "name": row["name"],
                "onboarding_complete": bool(row["onboarding_complete"]),
            }
        row = await pool.fetchrow(
            "SELECT id::text AS id, name FROM staging.organisations WHERE id=$1::uuid",
            org_id,
        )
        if not row:
            return None
        return {"id": row["id"], "name": row["name"], "onboarding_complete": True}
    except Exception:  # noqa: BLE001 — see the docblock: no opinion, never `false`
        logger.debug("auth: could not resolve the session org", exc_info=True)
        return None


async def _module_levels(
    pool, user_id: str, platform_roles: list[str], org_roles: list[dict],
    header_org: str | None = None,
) -> dict[str, str] | None:
    """
    The caller's LEVEL on each module — `{"ganit": "viewer", …}`.

    F32: write affordances render from the module's page shell rather than from
    the caller's level, so a `ganit:viewer` is handed the full Create Invoice
    form and a member with no grants is offered `Run payroll`. The API refuses
    every one, so nothing is at risk but the user's effort and trust.

    The reason it was never fixed on the client is that **the client had nothing
    to consult**. `_module_grants` answers reach — which modules appear in the
    nav — and says nothing about depth. `useSanvaadAccess.js` says so in its own
    header and works around it by fetching a bespoke `/v1/messaging/me`, which
    is one module's answer to a question every module has.

    This is that answer for all of them, mirroring
    `middleware/subscription.require_module` gate for gate so the button and the
    endpoint cannot disagree:

      gate 1  platform staff bypass the level check entirely -> ADMIN on every
              module `role_tiers.modules_for()` lets them reach
      gate 2  org_owner / org_admin short-circuit the grant lookup -> None,
              "no opinion", they write everywhere the subscription reaches
      gate 3  org_member gets exactly the level on its grant row

    A row holding a level the ladder does not know reads as the WEAKEST level,
    exactly as `require_module` does — failing upward would advertise write
    access that the API then refuses, which is the bug this field exists to end.
    """
    platform_role = strongest(platform_roles)
    if platform_role:
        return {code: ADMIN for code in sorted(modules_for(platform_role))}

    if not org_roles:
        return None

    # THE ACTIVE org, not the earliest-joined one. A member can hold
    # `ganit: viewer` in one org and `ganit: admin` in another; reading the
    # wrong row means the write buttons on screen belong to a different company
    # than the data under them.
    primary = _active_org_role(org_roles, header_org)
    if primary.get("role_code") in ("org_owner", "org_admin"):
        return None

    rows = await pool.fetch(
        "SELECT module_code, role FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        user_id,
        primary["org_id"],
    )
    return {
        r["module_code"]: (r["role"] if r["role"] in LEVELS else DEFAULT_GRANT_LEVEL)
        for r in rows
    }


async def _module_grants(
    pool, user_id: str, platform_roles: list[str], org_roles: list[dict],
    header_org: str | None = None,
) -> list[str] | None:
    """
    Which module codes this user may actually reach — the nav's entitlement feed.

    `01-navigation.md` §4 lists `module_grants[]` on `GET /v1/me` as the field that
    "drives every nav predicate", and `RBAC-SPEC.md` · Denied states rule 1 is
    explicit about what the nav must then do: **"No access → absent from the
    sidebar, never a greyed-out row that advertises what is missing."**

    This MIRRORS `middleware/subscription.py::require_module`, gate for gate, so the
    sidebar cannot promise a module the API refuses:

      gate 1  a platform role decides reach through `role_tiers.modules_for()`
      gate 2  org_owner / org_admin reach every module of their org
      gate 3  org_member reaches only what `org_member_modules` names

    Returning ``None`` means "no opinion" and the client leaves every module
    visible. That is reserved for the two cases where this function genuinely
    cannot answer — an administrator, whose reach is the plan rather than a grant
    row, and a user with no organisation at all. An empty LIST is a different
    answer and is returned deliberately: it means "nothing", and the nav must
    show nothing.

    Sensitive modules are NOT subtracted. This paragraph used to say they were,
    and it outlived the code it described: the subtraction WAS F33, it was
    removed at the return below, and this text stayed behind arguing for it.
    A docstring that recommends the bug is how the bug comes back — see the
    return for why the reading was wrong.
    """
    platform_role = strongest(platform_roles)
    if platform_role:
        return sorted(modules_for(platform_role))

    if not org_roles:
        # A portal client, or staff not yet placed in an org. Neither renders the
        # staff module rail, so there is nothing to gate.
        return None

    # The user's ACTIVE org, resolved the same way `middleware/org_resolver.py`
    # resolves it — the `X-Org-Id` header when the caller holds that org, the
    # earliest grant otherwise. Picking a different org here than the API picks
    # would gate the nav against modules the requests are not even scoped to,
    # which is precisely what `org_roles[0]` did: switch org, and the sidebar
    # kept rendering the entitlements of the org joined first.
    primary = _active_org_role(org_roles, header_org)
    if primary.get("role_code") in ("org_owner", "org_admin"):
        return None

    rows = await pool.fetch(
        "SELECT module_code FROM staging.org_member_modules "
        "WHERE user_id=$1 AND org_id=$2::uuid",
        user_id,
        primary["org_id"],
    )
    # NOT `- SENSITIVE_MODULES`. That subtraction was F33: a member holding
    # `ganit: viewer` got `module_grants: []`, so `navConfig.js:284` hid Finance
    # from the sidebar while `/ganit` typed directly rendered the module in full
    # with real financial data — because `middleware/subscription.require_module`
    # honours the grant (gate 2 reads `org_member_modules` and applies no
    # sensitive-module carve-out to org members; only the PLATFORM bypass above
    # distinguishes sensitive modules).
    #
    # The subtraction was justified by reading `SENSITIVE_MODULES` as a
    # prohibition. It is not one — `role_tiers.py:203` defines it as "modules
    # whose grants are WITHHELD BY DEFAULT when a member is added without an
    # explicit list". A default about what to grant says nothing about what to
    # display once a grant exists, and `PUT /v1/org/members/{id}/modules`
    # deliberately accepts these codes.
    #
    # So this must mirror `require_module` exactly: the nav shows what the API
    # honours. Hiding a granted module does not protect anything — the data is
    # reachable either way — it just means the member has to be told the URL.
    return sorted({r["module_code"] for r in rows})


#: What an invite preview says when the token is no good. ONE string for every
#: failure — unknown, expired, already accepted and revoked are indistinguishable
#: from outside, so a token cannot be probed for which kind of wrong it is.
_INVITE_DEAD = "This invitation link is not valid. It may have expired, already been used, or been withdrawn."


@router.get("/invite/{token}")
@limiter.limit("20/minute")
async def preview_invite(request: Request, token: str):
    """What the person is being asked to accept, before they accept it.

    The accept screen used to show a name field and a password field and nothing
    about the organisation, the inviter, the role or the module grants — every
    one of which was already stored on the invite row by
    `routers/org_invites.create_org_invite` and applied by `accept_invite`
    below. The data was there; there was no way to read it.

    **On disclosure.** This is an unauthenticated endpoint that returns an email
    address and an organisation name, and that is deliberate rather than an
    oversight. The caller has to hold a 256-bit `secrets.token_urlsafe(32)` that
    was mailed to that address, so holding it already implies knowing it —
    `accept_invite` accepts nothing else, and would let the same caller SET THE
    PASSWORD on the account. A preview strictly discloses less than the accept
    it precedes.

    What it will not do is distinguish *why* a token is no good. Unknown,
    expired, spent and revoked all answer 404 with one string, so the endpoint
    cannot be used to sweep for live tokens or to confirm that a given address
    was ever invited.
    """
    pool = await get_pool()
    # `SELECT *`, and the `.keys()` guards below, for the same reason
    # `accept_invite` uses them: `org_id` and `module_grants` arrive with
    # `PROPOSED_073_org_scoped_invites.sql`, which is a PROPOSAL — naming those
    # columns in the select list would raise UndefinedColumnError on an
    # unmigrated database instead of degrading to the platform-invite shape.
    invite = await pool.fetchrow("SELECT * FROM invites WHERE token=$1", token)
    if (
        not invite
        or invite["accepted_at"] is not None
        or invite["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc)
    ):
        raise HTTPException(status_code=404, detail=_INVITE_DEAD)

    org_id = invite["org_id"] if "org_id" in invite.keys() else None
    org_name = None
    org_members = None
    org_max_users = None
    org_seats_pending = None
    if org_id:
        org_name = await pool.fetchval(
            "SELECT name FROM staging.organisations WHERE id=$1::uuid", str(org_id)
        )
        # The member count used to be returned on its own, with no ceiling
        # beside it — "6 people" and no way to know whether that was 6 of 5.
        # `accept_invite` below now refuses at the ceiling, so this screen has
        # to be able to say so BEFORE someone types a password into a form that
        # is going to 409.
        #
        # Counted through the same helper the refusal uses, so the two cannot
        # disagree, and with this invitee's own pending row excluded because it
        # is the seat they are about to take.
        from routers.org_invites import count_seats

        seats = await count_seats(pool, str(org_id), exclude_email=invite["email"])
        org_members = seats.joined
        org_max_users = seats.limit
        org_seats_pending = seats.pending

    inviter = None
    if invite["invited_by"]:
        inviter = await pool.fetchval(
            "SELECT COALESCE(full_name, name, email) FROM users WHERE user_id=$1",
            invite["invited_by"],
        )

    raw = invite["module_grants"] if "module_grants" in invite.keys() else None
    try:
        grants = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (TypeError, ValueError):
        grants = []

    # A grant is re-checked against the org's live subscriptions for the same
    # reason `accept_invite` re-checks before writing one: an invite is good for
    # seven days and a module can be switched off inside that window. Promising
    # access on this screen that the accept will then silently drop is the exact
    # mismatch worth avoiding, since this screen is the promise.
    if grants and org_id:
        active = {
            r["module_code"]
            for r in await pool.fetch(
                "SELECT module_code FROM staging.module_subscriptions "
                "WHERE org_id=$1::uuid AND is_active = TRUE",
                str(org_id),
            )
        }
        grants = [g for g in grants if (g or {}).get("code") in active]

    # Whether the address already has an account decides which form the screen
    # draws. Today this can only be TRUE for someone who signed up in the window
    # between issue and acceptance — both invite creators refuse an address that
    # already has one (`invite_router.py:365`, `org_invites.py:236`).
    has_account = await pool.fetchval(
        "SELECT 1 FROM users WHERE LOWER(email)=LOWER($1)", invite["email"]
    )

    return {
        "email": invite["email"],
        "full_name": invite["full_name"],
        "account_type": invite["role"],
        "org_id": str(org_id) if org_id else None,
        "org_name": org_name,
        "org_members": org_members,
        # None means UNLIMITED, not zero — the tiers that are not sold per user
        # have no seat count on either the org or the plan.
        "org_max_users": org_max_users,
        "org_seats_pending": org_seats_pending,
        "org_role": invite["member_role"] if org_id else None,
        "invited_by_name": inviter,
        "module_grants": [
            {"code": g.get("code"), "role": g.get("role") or "viewer"}
            for g in grants if (g or {}).get("code")
        ],
        "expires_at": invite["expires_at"].replace(tzinfo=timezone.utc).isoformat(),
        "account_exists": bool(has_account),
    }


@router.post("/invite/{token}/decline")
@limiter.limit("10/minute")
async def decline_invite(request: Request, token: str):
    """Turn down an invitation. The reference screen offers it; nothing did it.

    Declining expires the row rather than deleting it, so the org's own
    `GET /api/v1/org/invites` stops listing it (that query is
    `expires_at > NOW()`) while the audit trail of who invited whom survives.

    Same single answer as the preview for a token that is not live, and it is
    idempotent — declining twice is not an error, because a person who clicks it
    again has not done anything wrong.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE invites SET expires_at = NOW() "
        "WHERE token=$1 AND accepted_at IS NULL AND expires_at > NOW() "
        "RETURNING invite_id, email",
        token,
    )
    if not row:
        raise HTTPException(status_code=404, detail=_INVITE_DEAD)
    audit("auth.invite_declined", request, detail={"invite_id": row["invite_id"]}, severity="warn")
    return {"ok": True}


@router.post("/accept-invite")
@limiter.limit("10/minute")
async def accept_invite(request: Request, body: AcceptInviteBody):
    """Called when a user clicks their invite link and sets their password."""
    pool = await get_pool()
    invite = await pool.fetchrow("SELECT * FROM invites WHERE token=$1", body.token)
    if not invite:
        raise HTTPException(status_code=400, detail="Invite link is invalid or has expired")

    # Invite already accepted — never verify the password here (brute-force oracle).
    # Direct the user to the login page instead.
    if invite["accepted_at"] is not None:
        raise HTTPException(status_code=400, detail="Account already activated — please sign in.")

    if invite["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite link has expired. Ask your admin for a new one.")

    existing = await pool.fetchrow("SELECT user_id FROM users WHERE email=$1", invite["email"])
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    # ── The seat is re-checked HERE, and this is the whole point ─────────────
    #
    # A pending invite holds a seat, and every issuing path counts one. But a
    # reservation taken at issue time is not a hold unless somebody re-reads it
    # at acceptance, and this endpoint checked NOTHING: it read the token, made
    # the account and wrote the `user_roles` row.
    #
    # The sequence that produced six people in a five-seat org with no god mode
    # involved: 4 joined + 1 pending; the platform console adds a fifth member
    # (its own count never saw the pending invite); the invitee clicks their
    # link; 6. Every step was permitted by the code that ran it.
    #
    # Before the account is created, deliberately. Refusing after would leave an
    # orphan login belonging to no organisation and a spent invite, which is a
    # worse state than the refusal — the invitation stays live and works the
    # moment a seat is freed.
    #
    # Their own pending row is excluded from the count: it is the seat they are
    # taking, not a competing claim on it.
    invite_org_id = invite["org_id"] if "org_id" in invite.keys() else None
    if invite_org_id:
        from routers.org_invites import assert_seat_available

        await assert_seat_available(
            pool, str(invite_org_id), email=invite["email"],
        )

    salt = uuid.uuid4().hex
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    role = invite["role"]  # "member" or "client"
    # Carry invite metadata into the user record so admin-set fields aren't lost
    full_name = invite.get("full_name") or body.name
    member_role = invite.get("member_role")
    receives_approval_emails = invite.get("receives_approval_emails", True)

    await pool.execute(
        """INSERT INTO users
               (user_id, name, full_name, email, password_hash, salt, role,
                member_role, receives_approval_emails)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
        user_id, body.name, full_name, invite["email"],
        _hash_password(body.password, salt), salt, role,
        member_role, receives_approval_emails,
    )
    await pool.execute(
        "UPDATE invites SET accepted_at=NOW() WHERE token=$1", body.token
    )

    # ── Org-scoped invite (migration 073) ────────────────────────────────────
    # A platform-console invite has org_id NULL and behaves exactly as before.
    # An org invite has to actually produce the membership, or the invitee ends
    # up with an account belonging to nothing and no way to tell why.
    #
    # Grants are RE-VALIDATED here rather than trusted from the invite row: an
    # invite is good for seven days, and a module can be deactivated in that
    # window. Writing a grant for a module the org no longer has would hand
    # someone access their organisation is not paying for, and it would be
    # invisible — it only surfaces the day the module is switched back on.
    #
    # `invite_org_id` was resolved above, before the account was created, so the
    # seat check could run while refusing was still free.
    if invite_org_id:
        org_role = invite["member_role"] or "org_member"
        if org_role not in ("org_owner", "org_admin", "org_member"):
            org_role = "org_member"

        await pool.execute(
            "INSERT INTO staging.user_roles (user_id, org_id, role_code, granted_by) "
            "VALUES ($1, $2::uuid, $3, $4) "
            "ON CONFLICT DO NOTHING",
            user_id, str(invite_org_id), org_role, invite["invited_by"],
        )

        raw_grants = invite["module_grants"] if "module_grants" in invite.keys() else None
        try:
            grants = json.loads(raw_grants) if isinstance(raw_grants, str) else (raw_grants or [])
        except (TypeError, ValueError):
            grants = []

        if grants:
            active = {
                r["module_code"]
                for r in await pool.fetch(
                    "SELECT module_code FROM staging.module_subscriptions "
                    "WHERE org_id=$1::uuid AND is_active = TRUE",
                    str(invite_org_id),
                )
            }
            from middleware.role_tiers import default_level_for, refuse_grant_shape

            for g in grants:
                code = (g or {}).get("code")
                if not code or code not in active:
                    continue
                # `or "viewer"` was the whole of this path's validation, and it
                # was applied to a value read straight out of the invite JSON.
                # Nothing checked that the level was one the module has a use
                # for, so any writer of `invites.module_grants` — present or
                # future — had an unvalidated route into the grant table, and a
                # module whose new grants start higher (Sanvaad, editor) was
                # silently downgraded on acceptance.
                #
                # `refuse_grant_shape`, not `refuse_grant`: the granting
                # authority here belonged to the INVITER and was checked when the
                # invite was created. The caller is the invitee, who holds no org
                # role yet — passing theirs would skip the separated-duty rule
                # and passing the owner's would assert something untrue. See
                # `role_tiers.refuse_grant`.
                level = (g or {}).get("role") or default_level_for(code)
                if refuse_grant_shape(code, level) is not None:
                    continue
                await pool.execute(
                    "INSERT INTO staging.org_member_modules "
                    "    (user_id, org_id, module_code, role, granted_by) "
                    "VALUES ($1, $2::uuid, $3, $4, $5) "
                    "ON CONFLICT DO NOTHING",
                    user_id, str(invite_org_id), code, level, invite["invited_by"],
                )
    # Activate any pending team invites for this email
    await pool.execute(
        "UPDATE team_members SET user_id=$1, status='active', updated_at=NOW() WHERE email=$2 AND status='invited'",
        user_id, invite["email"],
    )
    # Sync to project_assignments so the user can create/view tasks.
    #
    # `$1::text` in BOTH positions, and it is the difference between an
    # invitation that can be accepted and one that cannot.
    #
    # `project_assignments.user_id` is `character varying`; `team_members.user_id`
    # is `text`. Untyped, asyncpg has to deduce ONE type for `$1` from two
    # columns that disagree, and it refuses — so this statement raised on every
    # acceptance. It sits AFTER the `users` INSERT and the `team_members` sync,
    # both of which commit on their own, so the account half-landed: the person
    # existed, held a team row, and could not sign in to anything because the
    # request 500'd before the session was returned. Re-accepting hit the
    # already-used-invite guard.
    #
    # Same shape and same fix as `server.py`'s approval update, which carries the
    # note that the columns should be reconciled to one type — that is a
    # migration on a schema production shares, and this is the change that stops
    # the 500 today.
    await pool.execute("""
        INSERT INTO project_assignments (assignment_id, team_id, user_id, role)
        SELECT 'pa_' || substr(md5(random()::text), 1, 12), team_id, $1::text,
               CASE WHEN role IN ('owner','admin','member','client') THEN role ELSE 'member' END
        FROM team_members
        WHERE user_id=$1::text AND status='active'
        ON CONFLICT (team_id, user_id) DO NOTHING
    """, user_id)
    user = await pool.fetchrow("SELECT * FROM users WHERE user_id=$1", user_id)

    try:
        from email_service import send_welcome_email
        send_welcome_email(invite["email"], body.name)
    except Exception:
        pass

    token = _create_token(user_id)
    audit("auth.invite_accepted", request, user_id=user_id, detail={"email": invite["email"]})
    return _auth_response(token, {"token": token, "user": _safe_user(dict(user))})


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginBody):
    """Authenticate with email and password and return a JWT and user profile."""
    pool = await get_pool()
    user = await pool.fetchrow("SELECT * FROM users WHERE email=$1", body.email.lower())
    if not user or not _verify_password(body.password, user["salt"], user["password_hash"]):
        audit("auth.login_failed", request, detail={"email": body.email.lower()}, severity="warn")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        user["user_id"],
    )
    platform_roles = [r["role_code"] for r in pr]
    # ORDER BY granted_at for the same reason `/me` and `/refresh` do it, and it
    # was missing here alone: `org_roles[0]` must be the org
    # `middleware/org_resolver.py` falls back to when no `X-Org-Id` is sent, or
    # the nav is gated against one org while every request it fires is scoped to
    # another. Without the clause the row order is whatever the planner returns.
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY ur.granted_at",
        user["user_id"],
    )
    org_roles = [dict(r) for r in or_rows]
    # Login sent NEITHER field, so between signing in and the first `/auth/me`
    # the client had "no opinion" on both: every module in the sidebar and every
    # write button enabled, for a member entitled to neither. The window is
    # short, but it is the first screen a new member ever sees.
    grants = await _module_grants(pool, user["user_id"], platform_roles, org_roles)
    levels = await _module_levels(pool, user["user_id"], platform_roles, org_roles)
    # `org` for the same reason, one step earlier: `lib/auth.js` writes this
    # payload to `Kartavaya_user` and the whole product reads it from there, so a
    # login that omitted the key would leave the session shaped differently from
    # every later `/auth/me`. No header is honoured here — a login carries no org
    # context and there is nothing to switch to yet.
    org = await _org_for(pool, org_roles)
    token = _create_token(user["user_id"])
    audit("auth.login", request, user_id=user["user_id"])
    return _auth_response(token, {"token": token, "user": _safe_user(
        dict(user), platform_roles, org_roles, grants, levels, org)})


@router.post("/refresh")
@limiter.limit("30/minute")
async def refresh(request: Request, current_user: dict = Depends(require_user)):
    """Extend a session that is still alive. **It cannot revive a dead one.**

    That limit is the whole design, so it is stated first. `require_user` rejects
    an expired JWT, which means this endpoint only ever sees a token that is
    still valid — it slides the seven-day window forward for someone who is
    using the product, and answers 401 to someone whose window has closed. There
    is no refresh token anywhere in this file and no table to hold one, so a
    sliding window is the honest ceiling; anything more would need a token store,
    which is also what `reset_password` would need to revoke other sessions.

    `AUTH-SPEC.md` and `12-auth-onboarding.md` both assume `/auth/refresh`
    exists. It did not, in any form — so "verify session refresh" had nothing to
    verify, and the frontend had nothing to call before deciding a 401 meant the
    session was over.

    Re-reads the user's roles rather than echoing the request's, because the
    point of a refresh is to pick up what changed. A member promoted to org_admin
    an hour ago gets the new nav on the next refresh instead of on the next
    sign-in.
    """
    pool = await get_pool()
    user_id = current_user["user_id"]
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        user_id,
    )
    # ORDER BY granted_at for the same reason `me` does: `or_rows[0]` has to be
    # the org `middleware/org_resolver.py` falls back to, or the nav is gated
    # against one org while the requests are scoped to another.
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY ur.granted_at",
        user_id,
    )
    platform_roles = [r["role_code"] for r in pr]
    org_roles = [dict(r) for r in or_rows]
    # The header reaches all three now. It used to reach only `_org_for` below,
    # so a refresh fired from a tab with org B selected returned org B's badge
    # and org A's module rail.
    _hdr = request.headers.get("x-org-id")
    grants = await _module_grants(pool, user_id, platform_roles, org_roles, _hdr)
    levels = await _module_levels(pool, user_id, platform_roles, org_roles, _hdr)
    # A refresh re-reads roles precisely so a change is picked up without a fresh
    # sign-in; the org's setup state changes on the same timescale and belongs in
    # the same read. The header is honoured here — a refresh fires from a tab
    # that already has an org selected.
    org = await _org_for(pool, org_roles, request.headers.get("x-org-id"))
    token = _create_token(user_id)
    return _auth_response(
        token,
        {"token": token, "user": _safe_user(
            current_user, platform_roles, org_roles, grants, levels, org)},
    )


@router.post("/logout")
async def logout():
    """Clear the session cookie (client also drops localStorage token)."""
    resp = JSONResponse(content={"ok": True})
    resp.delete_cookie(
        key="session_token",
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="lax",
        path="/",
        domain=_COOKIE_DOMAIN,
    )
    return resp


class ForgotPasswordBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str
    password: str = Field(..., min_length=8, max_length=128)


@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(request: Request, body: ForgotPasswordBody):
    """Generate a password-reset token and email it. Always returns 200 to avoid email enumeration."""
    pool = await get_pool()
    user = await pool.fetchrow("SELECT user_id, name, email FROM users WHERE email=$1", body.email.lower())
    if user:
        reset_token = secrets.token_urlsafe(32)
        await pool.execute(
            """UPDATE users SET password_reset_token=$1,
               password_reset_expires=NOW() + INTERVAL '1 hour'
               WHERE user_id=$2""",
            reset_token, user["user_id"],
        )
        try:
            from email_service import send_password_reset_email
            send_password_reset_email(user["email"], user["name"] or user["email"], reset_token)
        except Exception:
            pass
    return {"ok": True}


@router.post("/reset-password")
async def reset_password(request: Request, body: ResetPasswordBody):
    """Verify a password-reset token, set the new password, and SIGN OUT every
    other device.

    The sign-out is the thing the reset email has always promised
    (`email_service.send_password_reset_email`, and `AUTH-SPEC.md` lists it as a
    required element of that template). It is done by stamping
    `users.sessions_valid_from`; `require_user` then refuses any token whose
    `iat` predates it. There is no session table and no per-request extra query
    — see `_session_is_revoked`.

    THE CUTOFF COMES FROM THE APPLICATION CLOCK, NOT FROM `NOW()`, AND THAT IS
    THE WHOLE TRICK. The cutoff is only ever compared against a JWT `iat`, and
    an `iat` is unavoidably written by this process. Taking the cutoff from the
    database introduces an app-vs-database skew dependency that did not exist
    before, and it has a sharp edge in both directions:

      · database BEHIND the app — the cutoff is older than it should be, and
        tokens issued in the gap survive a reset that should have killed them;
      · database AHEAD of the app — MEASURED, NOT THEORISED: minting the
        replacement token with a future `iat` makes PyJWT raise
        `ImmatureSignatureError` on the very next request, so the reset hands
        back a token that nothing can decode until the app clock catches up.
        The first draft of this function did exactly that and
        `test_reset_survives_the_database_clock_running_ahead` caught it.

    One clock for both values removes the entire class. The cutoff written here
    and the `iat` of the token returned here are the SAME instant, so the new
    token is on the valid side of its own cutoff by construction rather than by
    luck — no skew, and no future-dated token.

    Truncated to whole seconds because PyJWT writes `iat` as integer seconds,
    truncated DOWN. A microsecond-precise cutoff would sit ABOVE the `iat` of
    the token minted in the same instant, and the person who just reset their
    password would be 401'd on their next click. `_session_is_revoked` floors
    both sides as well, so the check stays correct even if this truncation is
    ever dropped.

    RESIDUAL, STATED NOT PAPERED OVER: a token issued in the SAME one-second
    tick as the reset survives it. Exploiting that requires signing in with the
    old password within the same second the new one is set.
    """
    pool = await get_pool()
    user = await pool.fetchrow(
        "SELECT * FROM users WHERE password_reset_token=$1 AND password_reset_expires > NOW()",
        body.token,
    )
    if not user:
        raise HTTPException(status_code=400, detail="Reset link is invalid or has expired.")
    global _revocation_column_present
    salt = uuid.uuid4().hex
    # Computed ONCE — PBKDF2 at 260k iterations costs about a second, and the
    # fallback path below must not pay for it twice.
    pw_hash = _hash_password(body.password, salt)
    cutoff = datetime.now(timezone.utc).replace(microsecond=0)
    revoked = False
    if revocation_active():
        try:
            await pool.execute(
                """UPDATE users SET password_hash=$1, salt=$2,
                   password_reset_token=NULL, password_reset_expires=NULL,
                   sessions_valid_from=$4
                   WHERE user_id=$3""",
                pw_hash, salt, user["user_id"], cutoff,
            )
            revoked = True
        except Exception as exc:  # noqa: BLE001 — narrowed by _is_undefined_column
            if not _is_undefined_column(exc):
                raise
            # The migration has not been applied. The password must still be
            # changed — refusing the reset would be a worse failure than not
            # revoking — but say so, loudly, and fall through to the write that
            # does not name the column.
            _revocation_column_present = False
            logger.error(
                "Password reset for %s did NOT revoke other sessions: "
                "sessions_valid_from is missing. Apply "
                "backend/migrations/118_session_revocation.sql, then redeploy.",
                user["user_id"],
            )
    if not revoked:
        # Migration 118 not applied. The password change must still land.
        await pool.execute(
            """UPDATE users SET password_hash=$1, salt=$2,
               password_reset_token=NULL, password_reset_expires=NULL
               WHERE user_id=$3""",
            pw_hash, salt, user["user_id"],
        )
    # Same instant as the cutoff, so the token this reset hands back is on the
    # valid side of the cutoff this reset just wrote.
    token = _create_token(user["user_id"], iat=cutoff)
    audit(
        "auth.password_reset", request, user_id=user["user_id"], severity="warn",
        # Whether the sessions were actually ended is the security-relevant half
        # of this event, and it is not inferable from the audit row otherwise.
        detail={"sessions_revoked": revoked},
    )
    return _auth_response(token, {"token": token, "user": _safe_user(dict(user))})


@router.get("/me")
async def me(request: Request, current_user: dict = Depends(require_user)):
    """Return the authenticated user's public profile."""
    pool = await get_pool()
    pr = await pool.fetch(
        "SELECT role_code FROM staging.user_roles WHERE user_id=$1 AND org_id IS NULL",
        current_user["user_id"],
    )
    # ORDER BY granted_at, so `or_rows[0]` is the SAME org
    # `middleware/org_resolver.py` falls back to when no `X-Org-Id` header is
    # sent. Without the ordering the row order is whatever the planner returns,
    # and `_module_grants` below could gate the nav against one org while every
    # request the nav fires is scoped to another.
    or_rows = await pool.fetch(
        "SELECT ur.org_id::text, ur.role_code, o.name AS org_name "
        "FROM staging.user_roles ur "
        "JOIN staging.organisations o ON o.id = ur.org_id "
        "WHERE ur.user_id=$1 AND ur.org_id IS NOT NULL "
        "AND ur.role_code IN ('org_owner','org_admin','org_member') "
        "ORDER BY ur.granted_at",
        current_user["user_id"],
    )
    platform_roles = [r["role_code"] for r in pr]
    org_roles = [dict(r) for r in or_rows]
    # `/v1/me` is what the nav reads on every org switch. All three readers of
    # "which org" get the same header, so the badge, the module rail and the
    # write affordances cannot describe three different organisations.
    _hdr = request.headers.get("x-org-id")
    grants = await _module_grants(pool, current_user["user_id"], platform_roles, org_roles, _hdr)
    levels = await _module_levels(pool, current_user["user_id"], platform_roles, org_roles, _hdr)
    # `Protected.jsx` reads `org.onboarding_complete` off this response and
    # nothing else in the product supplies it. See `_org_for`.
    org = await _org_for(pool, org_roles, request.headers.get("x-org-id"))
    return _safe_user(current_user, platform_roles, org_roles, grants, levels, org)
