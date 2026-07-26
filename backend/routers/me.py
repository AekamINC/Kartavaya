"""
me.py — account self-service for the authenticated caller, and nobody else.

Three controls in Customize → Data shipped inert because these endpoints did
not exist. The frontend agent was right not to fake them: a dead "sign out
everywhere" button is worse than no button, because the user believes they have
used it.

Two of the three can be built honestly. One cannot, and this file does not
pretend otherwise.


WHAT COULD NOT BE BUILT: SESSION REVOCATION
───────────────────────────────────────────
`auth_router._create_token` mints `{"sub", "exp", "iat"}` and nothing else —
no `jti`, no server-side record. `_decode_token` verifies the signature and the
expiry and asks the database only "does this user still exist". There is no
session table, so:

  · the set of live tokens for a user IS NOT KNOWABLE — a token is valid
    because it verifies, not because anything recorded it;
  · a token CANNOT BE INVALIDATED before its 7-day expiry. Not by logging out,
    not by changing the password, not by any endpoint in this file.

Password reset already has this hole: it clears the reset token and mints a new
JWT, but every other token issued to that account keeps working for up to seven
days. A stolen token survives the password change that was made BECAUSE it was
stolen.

So `GET /sessions` returns what is true and refuses to imply the rest:

  · `current` — the caller's own token, decoded. Real, and the only session
    this system can actually see.
  · `devices` — push registrations. These are DEVICES REGISTERED FOR
    NOTIFICATIONS, not sessions and never labelled as such. A signed-in browser
    that declined notification permission does not appear; a device that
    appears may have been signed out months ago. Deregistering one truthfully
    stops notifications to it and truthfully does NOT sign it out.
  · `revocation.supported: false` — machine-readable, so a UI cannot render a
    revoke button by accident, plus a plain-language reason for the screen.

`PROPOSED_067` carries the schema for real revocation. It is a proposal because
the fix is not schema alone: `_create_token` must add a `jti` and `require_user`
must check it on every request, and `auth_router.py` is owned elsewhere. The
exact changes are in the report. Until they land, this file states the limit
rather than papering over it.


SELF-SCOPING
────────────
Every endpoint reads `user["user_id"]` from the verified token. No handler takes
a user id from a path, a query or a body — for `/me/*` that would not be a
parameter, it would be a privilege-escalation hole with a friendly name. The
one place an identifier IS accepted from the client (`/devices/deregister`)
scopes the DELETE by the caller's id in the same statement, so a foreign id
matches zero rows instead of deleting someone else's registration.

No role guard is correct here beyond authentication: these endpoints are the
caller acting on their own record, which every authenticated user may do. The
one place a role IS consulted is the last-god-mode-holder check on deletion,
and that reads `role_tiers.GOD_MODE_ROLES` rather than a bare string.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_router import JWT_ALGORITHM, JWT_SECRET, require_user
from db import get_pool
from limiter import limiter
from middleware.role_tiers import GOD_MODE_ROLES
from services.audit import emit as audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/me", tags=["me"])

#: How long a deletion request waits before it may be acted on. The delay IS
#: the safety feature: account deletion is the one request whose regret arrives
#: after the click, and a queue with no pause is a hard delete with extra steps.
DELETION_GRACE_DAYS = 30

#: Request kinds stored in staging.account_requests.
KIND_EXPORT = "export"
KIND_DELETE = "delete"

_OPEN_STATUSES = ("pending", "processing")


class DeregisterDevice(BaseModel):
    """`device_ref` is a push registration id, NEVER a user id.

    Mobile: the `device_id` from push_tokens. Web: the subscription `endpoint`.
    Both are matched against the caller's own rows only.
    """
    kind: str = Field(..., pattern="^(mobile|web)$")
    device_ref: str = Field(..., min_length=1, max_length=1024)


class DeleteRequest(BaseModel):
    reason: str | None = Field(None, max_length=2000)


def _missing_table(exc: Exception) -> bool:
    return isinstance(exc, asyncpg.exceptions.UndefinedTableError)


def _pending_migration() -> HTTPException:
    """503, not 500.

    `staging.account_requests` ships as PROPOSED_067 and this repo does not
    apply migrations from application code. Until an operator runs it these
    endpoints have nowhere to write, and the caller deserves to be told that
    their request was NOT recorded rather than shown a generic failure they
    might read as "try again".
    """
    return HTTPException(
        503,
        "Account requests are not available yet — the account_requests table "
        "has not been created on this environment. Your request was NOT "
        "recorded. Please contact support.",
    )


def _bearer_or_cookie(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return request.cookies.get("session_token")


# ── Sessions ─────────────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions(request: Request, user=Depends(require_user)):
    """The caller's current session, their registered push devices, and a plain
    statement that other sessions can be neither listed nor revoked.

    Read the shape literally. `sessions` is not a list of sessions, because this
    system cannot produce one — `current` is the single session it can see, and
    `devices` are notification registrations that are NOT evidence of a signed-in
    session either way.
    """
    pool = await get_pool()
    uid = user["user_id"]

    current: dict = {
        "is_current": True,
        "issued_at": None,
        "expires_at": None,
        "transport": None,
        "user_agent": (request.headers.get("user-agent") or "")[:512] or None,
        "ip": (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
               or (request.client.host if request.client else None)),
    }

    token = _bearer_or_cookie(request)
    if token:
        current["transport"] = (
            "bearer" if (request.headers.get("authorization") or "").lower().startswith("bearer ")
            else "cookie"
        )
        try:
            claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if claims.get("iat"):
                current["issued_at"] = datetime.fromtimestamp(claims["iat"], timezone.utc).isoformat()
            if claims.get("exp"):
                current["expires_at"] = datetime.fromtimestamp(claims["exp"], timezone.utc).isoformat()
        except jwt.PyJWTError:
            # require_user already accepted this request, so a failure here is a
            # decode quirk and not an auth problem. Report the session without
            # its timestamps rather than 500ing a read-only screen.
            logger.warning("me/sessions: could not decode an already-accepted token")

    devices: list[dict] = []
    try:
        for r in await pool.fetch(
            "SELECT device_id, platform, created_at FROM push_tokens "
            "WHERE user_id=$1 ORDER BY created_at DESC",
            uid,
        ):
            devices.append({
                "kind": "mobile",
                "device_ref": r["device_id"],
                "platform": r["platform"],
                "registered_at": r["created_at"].isoformat() if r["created_at"] else None,
            })
    except Exception as exc:
        logger.warning("me/sessions: push_tokens read failed: %s", exc)

    try:
        for r in await pool.fetch(
            "SELECT endpoint, updated_at FROM push_web_subscriptions "
            "WHERE user_id=$1 ORDER BY updated_at DESC",
            uid,
        ):
            devices.append({
                "kind": "web",
                "device_ref": r["endpoint"],
                # The push service host (FCM, Mozilla, Apple) is the only thing
                # an endpoint truthfully tells us. It is not a device name and
                # must not be shown as one.
                "platform": (r["endpoint"].split("/")[2] if "://" in r["endpoint"] else None),
                "registered_at": r["updated_at"].isoformat() if r["updated_at"] else None,
            })
    except Exception as exc:
        logger.warning("me/sessions: push_web_subscriptions read failed: %s", exc)

    return {
        "current": current,
        # Deliberately not "sessions". There is no second session to list.
        "other_sessions_known": False,
        "devices": devices,
        "revocation": {
            "supported": False,
            "reason": (
                "Sign-in tokens are stateless: they are validated by signature and "
                "expiry alone, and nothing records which ones exist. Kartavaya "
                "cannot list your other sign-ins or end them early. Every token "
                "stops working within 7 days of being issued."
            ),
            "token_lifetime_days": 7,
        },
        "devices_note": (
            "These are devices registered to receive notifications, not a list of "
            "sign-ins. Removing one stops notifications to it. It does not sign "
            "that device out."
        ),
    }


@router.post("/devices/deregister")
async def deregister_device(
    payload: DeregisterDevice,
    request: Request,
    user=Depends(require_user),
):
    """Stop notifications to one of the caller's own registered devices.

    Scoped by `user_id` in the DELETE itself, so a `device_ref` belonging to
    someone else matches nothing. `POST /api/push/unsubscribe` deletes by
    endpoint with NO user scoping — any authenticated user can silence another
    user's browser notifications by supplying their endpoint. That endpoint is
    in server.py; the defect is reported, and this is the scoped alternative.

    Returns `removed: false` rather than 404 for an unknown ref: distinguishing
    "not yours" from "does not exist" would confirm the existence of another
    user's registration to anyone who guessed one.
    """
    pool = await get_pool()
    uid = user["user_id"]

    if payload.kind == "mobile":
        result = await pool.execute(
            "DELETE FROM push_tokens WHERE device_id=$1 AND user_id=$2",
            payload.device_ref, uid,
        )
    else:
        result = await pool.execute(
            "DELETE FROM push_web_subscriptions WHERE endpoint=$1 AND user_id=$2",
            payload.device_ref, uid,
        )

    removed = result.rsplit(" ", 1)[-1] not in ("0", "")
    if removed:
        audit(
            "me.device_deregistered", request, user_id=uid,
            resource_type="push_device", detail={"kind": payload.kind},
        )
    return {
        "removed": removed,
        "note": "Notifications to this device are stopped. It is not signed out.",
    }


# ── Export ───────────────────────────────────────────────────────────────────

@router.post("/export")
@limiter.limit("3/hour")
async def request_export(request: Request, user=Depends(require_user)):
    """Record a request for a copy of the caller's own data.

    This QUEUES a request. It does not produce a file, and the response says so
    in a field the UI can read rather than in prose it might drop. There is no
    worker on this queue yet — an operator fulfils it. Telling the user "your
    download will appear shortly" would be the same false claim as a dead
    sign-out button.

    One open request at a time: a second click returns the first request
    unchanged instead of stacking duplicates for an operator to reconcile.
    """
    pool = await get_pool()
    uid = user["user_id"]

    try:
        existing = await pool.fetchrow(
            "SELECT request_id, status, requested_at FROM staging.account_requests "
            "WHERE user_id=$1 AND kind=$2 AND status = ANY($3::text[]) "
            "ORDER BY requested_at DESC LIMIT 1",
            uid, KIND_EXPORT, list(_OPEN_STATUSES),
        )
        if existing:
            return {
                "request_id": existing["request_id"],
                "status": existing["status"],
                "requested_at": existing["requested_at"].isoformat(),
                "already_open": True,
                "automated_delivery": False,
                "note": "You already have an export request in progress.",
            }

        request_id = f"areq_{uuid.uuid4().hex[:16]}"
        row = await pool.fetchrow(
            "INSERT INTO staging.account_requests (request_id, user_id, kind, status) "
            "VALUES ($1, $2, $3, 'pending') RETURNING requested_at",
            request_id, uid, KIND_EXPORT,
        )
    except Exception as exc:
        if _missing_table(exc):
            raise _pending_migration()
        raise

    audit("me.export_requested", request, user_id=uid,
          resource_type="account_request", resource_id=request_id)

    return {
        "request_id": request_id,
        "status": "pending",
        "requested_at": row["requested_at"].isoformat(),
        "already_open": False,
        # The honest part. There is no worker on this queue.
        "automated_delivery": False,
        "note": (
            "Your request has been recorded. Exports are prepared manually and "
            "sent to your registered email address — this is not an automatic "
            "download and no file is ready yet."
        ),
    }


# ── Deletion ─────────────────────────────────────────────────────────────────

@router.post("/delete")
@limiter.limit("3/hour")
async def request_deletion(
    payload: DeleteRequest,
    request: Request,
    user=Depends(require_user),
):
    """Queue account deletion, with a grace period and no immediate effect.

    Nothing is deleted here — not a row, not a flag on the user. This writes a
    request with a `scheduled_for` date and returns it. Anything else would make
    a self-service button into an irreversible destructive action.

    Refuses if the caller is the last remaining god-mode holder: deleting them
    leaves an installation nobody can administer, and no self-service control
    should be able to do that. Fails closed — if the role check itself errors,
    the request is refused rather than allowed through.
    """
    pool = await get_pool()
    uid = user["user_id"]

    try:
        holds_god_mode = await pool.fetchval(
            "SELECT 1 FROM staging.user_roles "
            "WHERE user_id=$1 AND org_id IS NULL AND role_code = ANY($2::text[])",
            uid, list(GOD_MODE_ROLES),
        )
        if holds_god_mode:
            remaining = await pool.fetchval(
                "SELECT COUNT(DISTINCT user_id) FROM staging.user_roles "
                "WHERE org_id IS NULL AND role_code = ANY($1::text[]) AND user_id <> $2",
                list(GOD_MODE_ROLES), uid,
            )
            if not remaining:
                raise HTTPException(
                    409,
                    "You are the only administrator of this installation. Grant "
                    "administrator access to someone else before requesting "
                    "deletion of your own account.",
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("me/delete: god-mode check failed for %s: %s", uid, exc)
        raise HTTPException(
            503,
            "Could not verify account ownership right now. Your request was NOT "
            "recorded. Please try again shortly.",
        )

    try:
        existing = await pool.fetchrow(
            "SELECT request_id, status, requested_at, scheduled_for "
            "FROM staging.account_requests "
            "WHERE user_id=$1 AND kind=$2 AND status = ANY($3::text[]) "
            "ORDER BY requested_at DESC LIMIT 1",
            uid, KIND_DELETE, list(_OPEN_STATUSES),
        )
        if existing:
            return {
                "request_id": existing["request_id"],
                "status": existing["status"],
                "requested_at": existing["requested_at"].isoformat(),
                "scheduled_for": existing["scheduled_for"].isoformat() if existing["scheduled_for"] else None,
                "already_open": True,
                "cancellable": True,
                "note": "You already have a deletion request pending.",
            }

        request_id = f"areq_{uuid.uuid4().hex[:16]}"
        scheduled_for = datetime.now(timezone.utc) + timedelta(days=DELETION_GRACE_DAYS)
        row = await pool.fetchrow(
            "INSERT INTO staging.account_requests "
            "(request_id, user_id, kind, status, scheduled_for, reason) "
            "VALUES ($1, $2, $3, 'pending', $4, $5) RETURNING requested_at",
            request_id, uid, KIND_DELETE, scheduled_for, payload.reason,
        )
    except Exception as exc:
        if _missing_table(exc):
            raise _pending_migration()
        raise

    audit("me.deletion_requested", request, user_id=uid,
          resource_type="account_request", resource_id=request_id, severity="warning")

    return {
        "request_id": request_id,
        "status": "pending",
        "requested_at": row["requested_at"].isoformat(),
        "scheduled_for": scheduled_for.isoformat(),
        "grace_period_days": DELETION_GRACE_DAYS,
        "already_open": False,
        "cancellable": True,
        "note": (
            f"Your account is scheduled for deletion in {DELETION_GRACE_DAYS} days. "
            "Nothing has been deleted yet and you can cancel at any point before "
            "then. Your sign-in continues to work in the meantime."
        ),
    }


@router.delete("/delete")
async def cancel_deletion(request: Request, user=Depends(require_user)):
    """Cancel the caller's own pending deletion request.

    The reason the grace period is worth having. Scoped to `status='pending'`:
    a request an operator has already begun processing is not cancellable from
    here, and saying otherwise would be another false claim.
    """
    pool = await get_pool()
    uid = user["user_id"]

    try:
        cancelled = await pool.fetchval(
            "UPDATE staging.account_requests SET status='cancelled', cancelled_at=NOW() "
            "WHERE user_id=$1 AND kind=$2 AND status='pending' RETURNING request_id",
            uid, KIND_DELETE,
        )
    except Exception as exc:
        if _missing_table(exc):
            raise _pending_migration()
        raise

    if not cancelled:
        raise HTTPException(404, "You have no pending deletion request to cancel.")

    audit("me.deletion_cancelled", request, user_id=uid,
          resource_type="account_request", resource_id=cancelled)
    return {"cancelled": True, "request_id": cancelled}


@router.get("/requests")
async def list_requests(user=Depends(require_user)):
    """The caller's own export and deletion requests. Read-only."""
    pool = await get_pool()
    try:
        rows = await pool.fetch(
            "SELECT request_id, kind, status, requested_at, scheduled_for, "
            "cancelled_at, completed_at FROM staging.account_requests "
            "WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 50",
            user["user_id"],
        )
    except Exception as exc:
        if _missing_table(exc):
            raise _pending_migration()
        raise

    def _iso(v):
        return v.isoformat() if v else None

    return {
        "requests": [
            {
                "request_id": r["request_id"],
                "kind": r["kind"],
                "status": r["status"],
                "requested_at": _iso(r["requested_at"]),
                "scheduled_for": _iso(r["scheduled_for"]),
                "cancelled_at": _iso(r["cancelled_at"]),
                "completed_at": _iso(r["completed_at"]),
            }
            for r in rows
        ]
    }
