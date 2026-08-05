"""
pahchan.py — Pahchan · पहचान (attendance)

v1 is: the employee signs in with their own account, takes a live selfie, and
punches in or out. The organisation verifies by HUMAN COMPARISON against two
reference photos captured at enrollment. Face matching is parked to v2 and device
enrollment is dropped.

Spec: design-handover/07-pahchan.md. Two of its rules shape almost every handler
here and are easy to undo by accident:

  §2 NOTHING BLOCKS A PUNCH. Location off, accuracy worse than ±100m, outside the
  geofence, no reference pair, mock location detected — every one of those records
  and flags. None of them refuse. "Field staff are the reason this module exists.
  A blocked punch at a client site becomes a payroll dispute a week later, and the
  employee is right." So there is exactly one 4xx on the punch path: a malformed
  body. Everything else is a flag.

  §7 AEKAM SEES A COUNT. The platform surface gets the number of Pahchan users per
  org and nothing else — no names, photographs, locations or times. Enforced in
  the query, via a view that aggregates before the data leaves the database,
  because "a console endpoint that fetches the roster and returns a length has
  already read the roster".

Schema: migrations/PROPOSED_064_pahchan.sql (not yet applied).
"""
import math
from datetime import date, datetime, timedelta, timezone

import asyncpg
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.subscription import require_module
from services.audit import emit as audit
from services import storage

router = APIRouter(prefix="/api/v1/pahchan", tags=["pahchan-attendance"])

_gate = require_module("pahchan")
# Reviewing someone else's attendance, and reading the photographs attached to
# it, is not something module membership alone should permit.
_review_gate = require_org_role("org_owner", "org_admin")

# Platform roles that may read another person's biometric data. Exactly one, and
# it is the same set `_review_gate` admits.
#
# This is deliberately NOT `is_org_admin`, which returns True for eight platform
# role codes — platform_staff, platform_support, account_manager, account_finance,
# platform_manager, srijan_admin among them. Those are commercial and support
# roles. 07 §7 is explicit that the platform sees "the count of Pahchan users per
# organisation. Nothing else. No names, no photographs, no locations, no times",
# so a billing role must not be able to resolve an employee's face, and the check
# that guards a face has to be the narrowest one in the module rather than the
# widest. `platform_admin` alone is god mode, held by three people, and removing
# it would lock support out of every org.
_BIOMETRIC_PLATFORM_ROLES = ("platform_admin",)


async def _may_view_others_biometrics(pool, user_id: str, org_id: str) -> bool:
    """
    Whether this caller may read a reference photograph belonging to someone else.

    Mirrors `_review_gate` rather than reusing it, because the answer depends on
    WHOSE record is being read — a FastAPI dependency cannot see the path param,
    and the self case must stay open (07 §9 puts the employee's own reference pair
    on their Me tab). Same breadth, checked inline.
    """
    return bool(
        await pool.fetchval(
            "SELECT 1 FROM staging.user_roles WHERE user_id=$1 AND ("
            "  (org_id IS NULL AND role_code = ANY($3::text[]))"
            "  OR (org_id=$2::uuid AND role_code IN ('org_owner','org_admin'))"
            ")",
            user_id, org_id, list(_BIOMETRIC_PLATFORM_ROLES),
        )
    )

# 07 §1: front camera, in-app, retake limit 3. Enforced on the client; the server
# only sees the result. Kept here as the reason the size ceiling is small.
# 768 KB, down from 4 MB. Both capture paths already compress on the device
# before anything is queued or sent, so 4 MB was never a limit on what arrives —
# it was 20-50x above it:
#
#   · a punch      — ClockScreen.tsx:299  resize 720px,  JPEG q0.75  → ~50-80 KB
#   · an enrolment — EnrollScreen.tsx:101 resize 1080px, JPEG q0.85  → ~150-300 KB
#
# There is no web capture path at all; the browser pages only VIEW photos. So
# this ceiling exists for a malformed or hostile client, and it should sit just
# far enough above the honest maximum to never reject a real face.
#
# JPEG, NOT PNG. PNG is lossless and made for flat graphics; a photograph
# encoded as PNG is roughly 8-15x LARGER than the same photograph as JPEG — that
# 720px face would go from ~60 KB to somewhere near 600 KB. For a camera frame
# the lossy codec is the small one, so both capture paths are right to write
# JPEG and this cap assumes they keep doing so.
#
# IF A LEGITIMATE ENROLMENT IS EVER REFUSED HERE, the knob is the client resize
# in EnrollScreen, not this number — a worker who cannot enrol is a worse
# outcome than a slightly larger file.
MAX_PHOTO_BYTES = 768 * 1024

#: Captures that failed before the one that landed, past which the punch is
#: flagged for a human. The server owns this number rather than the client so
#: the threshold cannot be edited away by whoever is holding the phone.
RETRY_FLAG_THRESHOLD = 3

EARTH_RADIUS_M = 6_371_000.0


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres. Adequate at geofence scale — the error
    against a proper geodesic is centimetres at 150m, and the radius itself is a
    policy guess to ±tens of metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


# ── Models ────────────────────────────────────────────────────────────────────

class PunchBody(BaseModel):
    direction: str = Field(..., pattern="^(in|out)$")
    # Device clock at capture. 07 §4: this and received_at are not
    # interchangeable, and this one is what payroll reads.
    captured_at: datetime
    lat: Optional[float] = None
    lng: Optional[float] = None
    # Never defaulted to 0 — a missing accuracy is None and flags. Zero would read
    # as a perfect fix and clear the very check it should fail.
    accuracy_m: Optional[float] = None
    site_id: Optional[UUID] = None
    photo_key: Optional[str] = None
    device_id: Optional[str] = None
    # None = not checked on this platform, which is not the same as False.
    mock_location: Optional[bool] = None
    source: str = Field("live", pattern="^(live|offline)$")
    client_punch_id: str = Field(..., min_length=8, max_length=64)
    # How many captures failed before this one landed. The client used to
    # HIDE THE SHUTTER at three, which contradicted this module's own rule
    # that nothing blocks a punch -- three camera errors in a dark doorway
    # locked someone out of clocking in entirely. It now punches through and
    # flags, which is what every other condition here does.
    retry_count: int = Field(0, ge=0, le=99)


class ReviewBody(BaseModel):
    verdict: str = Field(..., pattern="^(ok|flagged)$")


class PolicyBody(BaseModel):
    default_radius_m: Optional[int] = Field(None, gt=0)
    grace_minutes: Optional[int] = Field(None, ge=0)
    allow_outside_geofence: Optional[bool] = None
    accuracy_flag_threshold_m: Optional[int] = Field(None, gt=0)
    punch_photo_retention_days: Optional[int] = Field(None, gt=0)
    reference_photo_grace_days: Optional[int] = Field(None, gt=0)
    record_retention_years: Optional[int] = Field(None, gt=0)
    report_recipients: Optional[list[str]] = None
    report_daily: Optional[bool] = None
    report_weekly: Optional[bool] = None
    report_monthly: Optional[bool] = None

    # ── Shift and overtime (migration 082) ───────────────────────────────────
    # Until these existed the attendance bridge refused to compute overtime,
    # because deriving it needs a standard day and there was none to read.
    # Thresholds follow the Factories Act 1948: §54 nine hours a day, §51
    # forty-eight a week, §59 twice the ordinary rate beyond either. Per-org
    # rather than constant because state Shops & Establishments Acts differ.
    standard_hours_per_day: Optional[float] = Field(None, gt=0, le=24)
    overtime_daily_threshold_hours: Optional[float] = Field(None, gt=0, le=24)
    overtime_weekly_threshold_hours: Optional[float] = Field(None, gt=0, le=168)
    overtime_multiplier: Optional[float] = Field(None, ge=1)
    overtime_enabled: Optional[bool] = None
    week_starts_on: Optional[int] = Field(None, ge=1, le=7)
    shift_start_time: Optional[str] = None
    shift_end_time: Optional[str] = None
    overnight_shift: Optional[bool] = None


class SiteBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    lat: float
    lng: float
    radius_m: int = Field(150, gt=0)


# ── Helpers ───────────────────────────────────────────────────────────────────

DEFAULT_POLICY = {
    "default_radius_m": 150,
    "grace_minutes": 10,
    "allow_outside_geofence": True,
    "accuracy_flag_threshold_m": 100,
    "punch_photo_retention_days": 90,
    "reference_photo_grace_days": 45,
    "record_retention_years": 3,
    "report_recipients": [],
    "report_daily": True,
    "report_weekly": True,
    "report_monthly": True,
    # Mirrors migration 082's column defaults. `overtime_enabled` is False so an
    # org that never opens this screen keeps exactly today's behaviour — turning
    # overtime on changes what people are paid and is nobody's default.
    "standard_hours_per_day": 8.0,
    "overtime_daily_threshold_hours": 9.0,
    "overtime_weekly_threshold_hours": 48.0,
    "overtime_multiplier": 2.0,
    "overtime_enabled": False,
    "week_starts_on": 1,
    "shift_start_time": None,
    "shift_end_time": None,
    "overnight_shift": False,
}


async def _policy(pool, org_id: str) -> dict:
    """The org's policy, or the defaults. An org with no policy row must still be
    able to punch — requiring setup before the first punch is a blocker, and §2
    says nothing blocks a punch."""
    row = await pool.fetchrow(
        "SELECT * FROM staging.pahchan_policy WHERE org_id=$1::uuid", org_id
    )
    return dict(row) if row else dict(DEFAULT_POLICY)


async def _employee_for(pool, org_id: str, user_id: str) -> Optional[dict]:
    return await pool.fetchrow(
        "SELECT id, name FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND user_id=$2 AND is_active=TRUE",
        org_id, user_id,
    )


async def _nearest_site(pool, org_id: str, lat: float, lng: float):
    """Nearest active site and the distance to it. Python-side because the table
    is a handful of rows per org and PostGIS is not installed — adding an
    extension for a ten-row nearest-neighbour would be the wrong trade."""
    sites = await pool.fetch(
        "SELECT id, name, lat, lng, radius_m FROM staging.pahchan_sites "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    best, best_d = None, None
    for site in sites:
        d = _haversine_m(lat, lng, float(site["lat"]), float(site["lng"]))
        if best_d is None or d < best_d:
            best, best_d = site, d
    return best, best_d


def _compute_flags(
    body: PunchBody,
    policy: dict,
    distance_m: Optional[float],
    site_radius_m: Optional[int],
    has_reference_pair: bool,
) -> list[str]:
    """
    07 §2's table, in one place.

    Every branch RECORDS and flags. There is no branch that refuses, and adding
    one is the single change most likely to break the module's purpose.
    """
    flags: list[str] = []

    if body.lat is None or body.lng is None:
        flags.append("geo")          # location off entirely
    if body.accuracy_m is None:
        flags.append("accuracy")     # missing is not zero
    elif body.accuracy_m > float(policy["accuracy_flag_threshold_m"]):
        # Weak GPS is not fraud. Indoor and basement fixes routinely exceed
        # ±100m, and blocking on accuracy would lock out warehouse and
        # parking-level staff specifically. So: flag, never block.
        flags.append("accuracy")
    if distance_m is not None and site_radius_m is not None and distance_m > site_radius_m:
        if "geo" not in flags:
            flags.append("geo")
    if body.mock_location is True:
        flags.append("mock")
    if body.source == "offline":
        flags.append("offline")
    if not has_reference_pair:
        # Nothing to compare the selfie against yet. Records, flags, and HR is
        # prompted to enroll — it does not stop the employee being paid.
        flags.append("noref")
    if body.retry_count >= RETRY_FLAG_THRESHOLD:
        # Asks a manager to look at the day; it does not refuse the punch and
        # is not an accusation. A bad front camera produces this exactly as
        # readily as someone hunting for a frame that hides where they are.
        flags.append("retries")
    return flags


# ── Punch ─────────────────────────────────────────────────────────────────────

@router.post("/punch/photo")
async def upload_punch_photo(
    request: Request,
    file: UploadFile = File(...),
    kind: str = Form("punch"),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Store a capture and return its object key.

    Separate from the punch itself because capture and upload fail independently:
    the punch is recorded the moment the button is pressed, and the image may take
    three days and four networks to arrive. The client holds the local URI in its
    punch queue until this returns a key.

    Returns the KEY only, never a URL. 07 §4: photo_key is an object-store key and
    never a URL in any payload — URLs are minted per request, signed and
    short-lived, so a key in a log or a cache is not an exposure.
    """
    # Chunked, so a 500MB body is refused in flight rather than after it is all
    # resident. A site worker's phone on a bad network is the likeliest source
    # of an oversized upload here, and it is also the likeliest to retry.
    data = await storage.read_capped(
        file, MAX_PHOTO_BYTES, f"{MAX_PHOTO_BYTES // (1024 * 1024)}MB photo",
    )
    if not data:
        raise HTTPException(400, "Empty upload")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Not an image")

    folder = f"pahchan/{org_id}/{'reference' if kind == 'reference' else 'punch'}"
    result = await storage.upload_file(
        file_bytes=data,
        filename=file.filename or "capture.jpg",
        content_type=file.content_type or "image/jpeg",
        user_id=user["user_id"],
        folder=folder,
        org_id=org_id,
    )
    if not result.get("key"):
        # The data-URI fallback in storage.py has no key, and a punch photo held
        # as base64 in a column is not a photo we can retain or delete on schedule.
        raise HTTPException(503, "Object storage is not configured for this organisation")
    return {"photo_key": result["key"], "size": result["size"]}


@router.post("/punch")
async def create_punch(
    body: PunchBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Record a punch. Idempotent on (org_id, client_punch_id).

    The only 4xx here is a malformed body or an unlinked account. Every degraded
    condition in §2 records and flags — see _compute_flags.
    """
    pool = await get_pool()

    employee = await _employee_for(pool, org_id, user["user_id"])
    if not employee:
        # Not a degraded punch — there is no employee record to attach it to, so
        # there is nothing to record. This is the one genuine precondition.
        raise HTTPException(
            409,
            "Your account is not linked to an employee record. Ask HR to link it before clocking in.",
        )

    # Idempotency first, before any work. A replayed punch after a timeout must
    # return the original rather than creating a second attendance record.
    #
    # Scoped to THIS employee, not just the org. `client_punch_id` is a
    # client-supplied string, and matching on (org, id) alone meant a caller who
    # sent an id that happened to exist got back somebody else's punch — its id,
    # direction, capture time and flags — without any ownership check. Real clients
    # send a UUIDv4 so a collision is vanishingly unlikely, but the field accepts
    # any 8–64 character string, so "unlikely" was a property of the well-behaved
    # client rather than of this endpoint.
    existing = await pool.fetchrow(
        "SELECT id, direction, captured_at, flags FROM staging.pahchan_punches "
        "WHERE org_id=$1::uuid AND client_punch_id=$2 AND employee_id=$3::uuid",
        org_id, body.client_punch_id, str(employee["id"]),
    )
    if existing:
        return {"punch": dict(existing), "duplicate": True}

    policy = await _policy(pool, org_id)

    site = None
    distance_m = None
    if body.lat is not None and body.lng is not None:
        if body.site_id:
            site = await pool.fetchrow(
                "SELECT id, lat, lng, radius_m FROM staging.pahchan_sites "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                str(body.site_id), org_id,
            )
            if site:
                distance_m = _haversine_m(
                    body.lat, body.lng, float(site["lat"]), float(site["lng"])
                )
        else:
            site, distance_m = await _nearest_site(pool, org_id, body.lat, body.lng)

    ref_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.pahchan_enrollment_photos "
        "WHERE employee_id=$1::uuid AND replaced_at IS NULL AND approved_at IS NOT NULL",
        str(employee["id"]),
    )
    flags = _compute_flags(
        body, policy, distance_m,
        int(site["radius_m"]) if site else None,
        has_reference_pair=(ref_count or 0) >= 2,
    )

    if body.photo_key:
        # The key must be one this endpoint's own uploader minted for THIS org's
        # punch folder — `pahchan/{org}/punch/{uuid}.ext`. Without this, a punch
        # can name any object in the org's bucket: an invoice, a payslip, or a
        # reference photograph. A malformed key is §2's one permitted 4xx.
        expected = f"pahchan/{org_id}/punch/"
        if not body.photo_key.startswith(expected):
            raise HTTPException(400, "That photo does not belong to this organisation's attendance store")

        # A photo already attached to a different punch.
        #
        # 07 §1 bans the gallery so that "one saved selfie works forever" is
        # impossible — "every punch after the first is a file copy… not a degraded
        # version of the feature; it is the absence of it". But camera-only is
        # enforced in the mobile UI, and the UI is not the boundary: an employee
        # calling this endpoint directly could send the same key every day and
        # never take another photograph.
        #
        # RECORDED AND FLAGGED, not refused — §2. A blocked punch becomes a
        # payroll dispute a week later, and a reused key is a question for the
        # reviewer rather than a proven fraud: it is also what a buggy client
        # retrying with a stale key looks like. The human comparison is what
        # decides, and this is exactly the kind of thing it should be told about.
        reused = await pool.fetchval(
            "SELECT 1 FROM staging.pahchan_punches "
            "WHERE org_id=$1::uuid AND photo_key=$2 AND client_punch_id <> $3 LIMIT 1",
            org_id, body.photo_key, body.client_punch_id,
        )
        if reused:
            flags.append("reuse")

    try:
        row = await pool.fetchrow(
            """INSERT INTO staging.pahchan_punches
                   (org_id, employee_id, direction, captured_at, synced_at, photo_key,
                    lat, lng, accuracy_m, distance_m, geofence_id, source,
                    mock_location, flags, client_punch_id)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
                       $7, $8, $9, $10, $11, $12,
                       $13, $14::text[], $15)
               RETURNING id, direction, captured_at, received_at, flags, source""",
            org_id, str(employee["id"]), body.direction, body.captured_at,
            # An offline punch synced now; a live one has no separate sync moment.
            datetime.now(timezone.utc) if body.source == "offline" else None,
            body.photo_key,
            body.lat, body.lng, body.accuracy_m, distance_m,
            str(site["id"]) if site else None,
            body.source, body.mock_location, flags, body.client_punch_id,
        )
    except asyncpg.UniqueViolationError:
        # (org_id, client_punch_id) is unique org-wide, so this is a different
        # employee in this org having already used that id. The lookup above is
        # scoped to the caller, so it did not match, and returning the other
        # person's row here is exactly what that scoping exists to prevent.
        #
        # This is one of the two 4xx on the punch path and it does not contradict
        # §2. A well-behaved client sends a UUIDv4 and can never reach this; a
        # client that reaches it has sent a malformed identifier, which §2 already
        # excepts. Refusing is also the safe direction — the alternative is
        # silently attributing this punch to whoever owns the colliding row.
        raise HTTPException(
            409,
            "That punch identifier is already in use. Retry with a new one — "
            "your punch has not been recorded.",
        )

    audit(
        "pahchan.punch",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_punch",
        resource_id=str(row["id"]),
        detail={"direction": body.direction, "flags": flags, "source": body.source},
        severity="warn" if flags else "info",
    )
    return {"punch": dict(row), "duplicate": False}


# ── The employee's own record ─────────────────────────────────────────────────

@router.get("/me")
async def my_punches(
    days: int = 30,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    The signed-in employee's own punches. No photo keys.

    This is what the attendance-only shell's *Me* tab reads. 07 §9 is specific
    that Me is not a reduced Settings — it carries the employee's own register and
    the retention promise in plain words, which is why the policy's retention
    figures come back with it.
    """
    pool = await get_pool()
    employee = await _employee_for(pool, org_id, user["user_id"])
    if not employee:
        return {"employee": None, "punches": [], "retention": await _policy(pool, org_id)}

    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 120)))
    rows = await pool.fetch(
        "SELECT id, direction, captured_at, received_at, source, flags, "
        "       accuracy_m, distance_m, review_verdict "
        "FROM staging.pahchan_punches "
        "WHERE employee_id=$1::uuid AND captured_at >= $2 "
        "ORDER BY captured_at DESC",
        str(employee["id"]), since,
    )
    policy = await _policy(pool, org_id)
    return {
        "employee": {"id": str(employee["id"]), "name": employee["name"]},
        "punches": [dict(r) for r in rows],
        # Stated in plain words on the Me tab, not buried in a policy page.
        "retention": {
            "punch_photo_days": policy["punch_photo_retention_days"],
            "reference_photo_grace_days": policy["reference_photo_grace_days"],
            "record_retention_years": policy["record_retention_years"],
        },
    }


# ── The register ──────────────────────────────────────────────────────────────

@router.get("/register")
async def register(
    on: Optional[date] = None,
    flagged_only: bool = False,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """
    A day's punches with the reference pair alongside, for human comparison.

    07 §3 calls this "the surface that decides whether this works": human
    comparison is the only verification, so if the reviewer cannot keep up, the
    feature is theatre. That is why the reference keys come back on the same row
    rather than needing a call per employee — a request per face is what makes a
    day unclearable.

    IDs, not keys, and never URLs. The client asks for a signed URL per image it
    actually displays, so scrolling past a row never mints a link to that person's
    face.

    The object key itself does not cross the wire either. The client cannot use a
    key — signing is by row id, deliberately, so that there is no endpoint anywhere
    that will sign an arbitrary key handed to it — so sending the key would be
    exposing the storage path of a photograph of someone's face for no purpose.
    `has_photo` is what the client actually needs: it distinguishes "still loading"
    from "the 90-day retention job has deleted this", which are the same blank slot
    otherwise.
    """
    pool = await get_pool()
    day = on or datetime.now(timezone.utc).date()

    rows = await pool.fetch(
        """SELECT p.id, p.direction, p.captured_at, p.received_at, p.source,
                  p.flags, p.accuracy_m, p.distance_m, p.mock_location,
                  -- The detail states the coordinates (07 §3). They are behind
                  -- `_review_gate` like the rest of this row, and they go no
                  -- further: the client draws the accuracy radius itself rather
                  -- than putting them in a tile URL to a third-party map host.
                  p.lat, p.lng,
                  (p.photo_key IS NOT NULL) AS has_photo,
                  p.review_verdict, p.reviewed_at, p.reviewed_by,
                  e.id AS employee_id, e.name AS employee_name, e.employee_code,
                  s.name AS site_name,
                  (SELECT array_agg(r.id ORDER BY r.slot)
                     FROM staging.pahchan_enrollment_photos r
                    WHERE r.employee_id = e.id
                      AND r.replaced_at IS NULL
                      AND r.approved_at IS NOT NULL) AS reference_ids
             FROM staging.pahchan_punches p
             JOIN staging.manav_employees e ON e.id = p.employee_id
             LEFT JOIN staging.pahchan_sites s ON s.id = p.geofence_id
            WHERE p.org_id = $1::uuid
              AND p.captured_at >= $2::date
              AND p.captured_at <  ($2::date + INTERVAL '1 day')
              AND ($3::bool IS FALSE OR (p.flags <> '{}' AND p.review_verdict IS NULL))
            ORDER BY p.captured_at ASC""",
        org_id, day, flagged_only,
    )
    return {"date": str(day), "punches": [dict(r) for r in rows]}


@router.patch("/punches/{punch_id}/review")
async def review_punch(
    punch_id: UUID,
    body: ReviewBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Record a reviewer's verdict. Audited — a verdict is an attendance decision
    about a person, and who made it has to survive."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """UPDATE staging.pahchan_punches
              SET review_verdict=$1, reviewed_by=$2, reviewed_at=NOW()
            WHERE id=$3::uuid AND org_id=$4::uuid
        RETURNING id, review_verdict, reviewed_at""",
        body.verdict, user["user_id"], str(punch_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Punch not found")

    audit(
        "pahchan.punch_reviewed",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_punch",
        resource_id=str(punch_id),
        detail={"verdict": body.verdict},
    )
    return dict(row)


@router.get("/punches/{punch_id}/photo")
async def punch_photo_url(
    punch_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """
    Mint a short-lived signed URL for one punch photo.

    Per image, on demand, and audited. Photographs of employees' faces are the
    most sensitive thing this module holds, so every view is attributable — and a
    URL that expires cannot be pasted into a chat and still work tomorrow.
    """
    pool = await get_pool()
    key = await pool.fetchval(
        "SELECT photo_key FROM staging.pahchan_punches WHERE id=$1::uuid AND org_id=$2::uuid",
        str(punch_id), org_id,
    )
    if not key:
        # Also the 90-day retention case: the record outlives the photo, so a
        # missing key on an existing punch is expected rather than an error.
        raise HTTPException(404, "No photo on file for this punch")

    url = await storage.sign_key(org_id, key)
    if not url:
        raise HTTPException(503, "Could not sign the photo URL")

    audit(
        "pahchan.photo_viewed",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_punch",
        resource_id=str(punch_id),
        severity="warn",
    )
    return {"url": url}


# ── Sites and policy ──────────────────────────────────────────────────────────

@router.get("/sites")
async def list_sites(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, lat, lng, radius_m, is_active FROM staging.pahchan_sites "
        "WHERE org_id=$1::uuid ORDER BY name",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/sites", status_code=201)
async def create_site(
    body: SiteBody,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO staging.pahchan_sites (org_id, name, lat, lng, radius_m) "
        "VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id, name, radius_m",
        org_id, body.name, body.lat, body.lng, body.radius_m,
    )
    return dict(row)


# ── Enrollment: the reference pair ────────────────────────────────────────────

class EnrollBody(BaseModel):
    employee_id: UUID
    slot: int = Field(..., ge=1, le=2)
    object_key: str = Field(..., min_length=1)
    # A photo HR uploads is vouched for by HR. One the employee takes is not
    # vouched for by anyone until HR looks at it.
    source: str = Field(..., pattern="^(hr_upload|self_capture)$")
    replaces_reason: Optional[str] = None


@router.get("/enrollment/{employee_id}")
async def get_enrollment(
    employee_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    An employee's live reference pair.

    Readable by the employee themselves as well as by HR, because 07 §9 puts the
    employee's own reference pair on their *Me* tab — someone whose face is on file
    is entitled to see which photographs those are.
    """
    pool = await get_pool()
    caller = await _employee_for(pool, org_id, user["user_id"])
    is_self = caller and str(caller["id"]) == str(employee_id)
    if not is_self:
        # Not their own record, so this needs the reviewer gate. Checked inline
        # rather than as a dependency because the answer depends on whose record
        # it is, which a dependency cannot see.
        #
        # This used to call `is_org_admin`, which passes eight platform role codes
        # including account_finance and platform_support. That made the enrollment
        # read the WIDEST-gated biometric surface in the module while /register and
        # /punches/{id}/photo were the narrowest, and it contradicted 07 §7. See
        # `_may_view_others_biometrics`.
        if not await _may_view_others_biometrics(pool, user["user_id"], org_id):
            raise HTTPException(403, "Only an org admin can view another employee's reference photos")

    rows = await pool.fetch(
        "SELECT id, slot, object_key, source, captured_at, approved_at, approved_by "
        "FROM staging.pahchan_enrollment_photos "
        "WHERE employee_id=$1::uuid AND org_id=$2::uuid AND replaced_at IS NULL "
        "ORDER BY slot",
        str(employee_id), org_id,
    )
    photos = [dict(r) for r in rows]
    approved = [p for p in photos if p["approved_at"]]
    return {
        "photos": photos,
        # The flag the punch path reads. Two APPROVED photos, not two photos —
        # a pending self-capture is not yet something to compare against.
        "complete": len(approved) >= 2,
        "pending_approval": len(photos) - len(approved),
    }


@router.get("/enrollment/photos/{photo_id}/url")
async def enrollment_photo_url(
    photo_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Mint a short-lived signed URL for ONE reference photograph.

    Without this the module does not verify anything. 07 §3 makes human comparison
    the only verification mechanism in v1 — the reviewer looks at the punch selfie
    beside both references and decides. The register returns `reference_keys`, but
    a key is inert by design (§4: "never a URL in any payload"), so with nothing to
    exchange a key for, the two reference slots stayed empty and the reviewer was
    confirming against blank boxes. §3 names that outcome exactly: a reviewer who
    cannot compare "confirms everything without looking, which is worse than no
    review, because it manufactures a record of verification that did not happen."

    The same gap made HR approve enrollment photos sight-unseen, which is the act
    of vouching that a face belongs to a person.

    Per image, on demand, and audited — the same discipline as the punch photo
    endpoint, because a reference photograph is the more sensitive of the two: it
    is the identity baseline, and it outlives any single punch.

    Self-access is deliberate (§9): the Me tab shows employees their own reference
    pair, because "someone whose face is photographed twice a day should be able to
    see what is held and for how long without asking".
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT object_key, employee_id FROM staging.pahchan_enrollment_photos "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        str(photo_id), org_id,
    )
    if not row:
        # Also the retention case: a reference photo is deleted outright at
        # employment + the grace window, so a missing row is expected rather than
        # an error worth alarming anyone about.
        raise HTTPException(404, "No reference photo on file")

    caller = await _employee_for(pool, org_id, user["user_id"])
    is_self = caller and str(caller["id"]) == str(row["employee_id"])
    if not is_self:
        if not await _may_view_others_biometrics(pool, user["user_id"], org_id):
            raise HTTPException(403, "Only an org admin can view another employee's reference photos")

    url = await storage.sign_key(org_id, row["object_key"])
    if not url:
        raise HTTPException(503, "Could not sign the photo URL")

    audit(
        "pahchan.reference_photo_viewed",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_enrollment_photo",
        resource_id=str(photo_id),
        detail={"employee_id": str(row["employee_id"]), "self": bool(is_self)},
        severity="warn",
    )
    return {"url": url}


@router.post("/enrollment", status_code=201)
async def enroll_photo(
    body: EnrollBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Attach a reference photo to a slot.

    Two upload paths, per the agreed v1: HR uploads during employee creation, or
    the employee self-captures on first run. A self-capture lands PENDING and
    appears in HR's approval queue; an HR upload is approved on arrival, because
    HR verified the person's identity at hiring and is the one vouching.

    An employee may only ever enroll THEMSELVES. Without that check, anyone with
    module access could put their own face on a colleague's record and then punch
    as them — which would defeat the entire verification model in one request.

    Replacing an existing slot marks the old row `replaced_at` rather than
    overwriting it. Swapping a reference photo to match a different face is the
    obvious attack, so a replacement has to be visible.
    """
    pool = await get_pool()
    caller = await _employee_for(pool, org_id, user["user_id"])
    is_self = caller and str(caller["id"]) == str(body.employee_id)

    if body.source == "self_capture":
        if not is_self:
            raise HTTPException(403, "A self-capture can only enroll your own record")
    else:
        # Same narrow gate as the read. Attaching a reference photo to someone
        # else's record is the attack this module's whole verification model rests
        # on not being possible — "anyone with module access could put their own
        # face on a colleague's record and then punch as them". A commercial
        # platform role must not be able to do it either.
        if not await _may_view_others_biometrics(pool, user["user_id"], org_id):
            raise HTTPException(403, "Only an org admin can upload a reference photo for someone else")

    # The employee must belong to this org. Without this an admin could attach a
    # photo to any employee_id in the database by guessing a UUID.
    exists = await pool.fetchval(
        "SELECT 1 FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        str(body.employee_id), org_id,
    )
    if not exists:
        raise HTTPException(404, "Employee not found")

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Retire whatever is live in this slot. Same transaction as the insert,
            # so the unique-live index can never see two rows at once.
            await conn.execute(
                "UPDATE staging.pahchan_enrollment_photos "
                "SET replaced_at = NOW(), replaced_reason = $3 "
                "WHERE employee_id=$1::uuid AND slot=$2 AND replaced_at IS NULL",
                str(body.employee_id), body.slot,
                body.replaces_reason or "replaced by a newer capture",
            )
            row = await conn.fetchrow(
                """INSERT INTO staging.pahchan_enrollment_photos
                       (org_id, employee_id, slot, object_key, source, uploaded_by,
                        approved_by, approved_at)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
                   RETURNING id, slot, source, approved_at""",
                org_id, str(body.employee_id), body.slot, body.object_key,
                body.source, user["user_id"],
                user["user_id"] if body.source == "hr_upload" else None,
                datetime.now(timezone.utc) if body.source == "hr_upload" else None,
            )

    audit(
        "pahchan.reference_enrolled",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_enrollment_photo",
        resource_id=str(row["id"]),
        detail={"employee_id": str(body.employee_id), "slot": body.slot, "source": body.source},
        severity="warn",
    )
    return dict(row)


@router.post("/enrollment/{photo_id}/approve")
async def approve_enrollment(
    photo_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Approve a self-captured reference photo. Audited: approving it is the act of
    vouching that this face belongs to this employee, and everything downstream
    rests on that."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """UPDATE staging.pahchan_enrollment_photos
              SET approved_by=$1, approved_at=NOW()
            WHERE id=$2::uuid AND org_id=$3::uuid AND replaced_at IS NULL
        RETURNING id, employee_id, slot""",
        user["user_id"], str(photo_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Reference photo not found")

    audit(
        "pahchan.reference_approved",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_enrollment_photo",
        resource_id=str(photo_id),
        detail={"employee_id": str(row["employee_id"]), "slot": row["slot"]},
        severity="warn",
    )
    return dict(row)


@router.get("/enrollment/queue/pending")
async def enrollment_queue(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Self-captured photos awaiting HR approval, plus employees with no pair at
    all — the `noref` flag's other half. An employee who cannot be verified is a
    gap in the register, so both cases surface in one queue."""
    pool = await get_pool()
    pending = await pool.fetch(
        # `r.id` and not `r.object_key`: approving is the act of vouching that this
        # face belongs to this employee, so HR has to SEE it — and they see it by
        # exchanging this id for a signed URL, never by being handed a storage path.
        "SELECT r.id, r.slot, r.captured_at, "
        "       e.id AS employee_id, e.name AS employee_name, e.employee_code "
        "FROM staging.pahchan_enrollment_photos r "
        "JOIN staging.manav_employees e ON e.id = r.employee_id "
        "WHERE r.org_id=$1::uuid AND r.approved_at IS NULL AND r.replaced_at IS NULL "
        "ORDER BY r.captured_at",
        org_id,
    )
    missing = await pool.fetch(
        "SELECT e.id AS employee_id, e.name AS employee_name, e.employee_code, "
        "       COUNT(r.id) FILTER (WHERE r.approved_at IS NOT NULL) AS approved_count "
        "FROM staging.manav_employees e "
        "LEFT JOIN staging.pahchan_enrollment_photos r "
        "       ON r.employee_id = e.id AND r.replaced_at IS NULL "
        "WHERE e.org_id=$1::uuid AND e.is_active = TRUE "
        "GROUP BY e.id, e.name, e.employee_code "
        "HAVING COUNT(r.id) FILTER (WHERE r.approved_at IS NOT NULL) < 2 "
        "ORDER BY e.name",
        org_id,
    )
    return {
        "pending_approval": [dict(r) for r in pending],
        "incomplete": [dict(r) for r in missing],
    }


@router.get("/policy")
async def get_policy(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    return await _policy(pool, org_id)


@router.patch("/policy")
async def update_policy(
    body: PolicyBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Upsert the org's policy. Retention changes are audited: shortening a
    retention window deletes people's records sooner, which is a decision someone
    has to own."""
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    pool = await get_pool()
    merged = {**DEFAULT_POLICY, **(await _policy(pool, org_id)), **updates}

    import json
    row = await pool.fetchrow(
        """INSERT INTO staging.pahchan_policy
               (org_id, default_radius_m, grace_minutes, allow_outside_geofence,
                accuracy_flag_threshold_m, punch_photo_retention_days,
                reference_photo_grace_days, record_retention_years,
                report_recipients, report_daily, report_weekly, report_monthly,
                standard_hours_per_day, overtime_daily_threshold_hours,
                overtime_weekly_threshold_hours, overtime_multiplier,
                overtime_enabled, week_starts_on, shift_start_time,
                shift_end_time, overnight_shift)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12,
                   $13, $14, $15, $16, $17, $18,
                   NULLIF($19,'')::time, NULLIF($20,'')::time, $21)
           ON CONFLICT (org_id) DO UPDATE SET
               default_radius_m           = EXCLUDED.default_radius_m,
               grace_minutes              = EXCLUDED.grace_minutes,
               allow_outside_geofence     = EXCLUDED.allow_outside_geofence,
               accuracy_flag_threshold_m  = EXCLUDED.accuracy_flag_threshold_m,
               punch_photo_retention_days = EXCLUDED.punch_photo_retention_days,
               reference_photo_grace_days = EXCLUDED.reference_photo_grace_days,
               record_retention_years     = EXCLUDED.record_retention_years,
               report_recipients          = EXCLUDED.report_recipients,
               report_daily               = EXCLUDED.report_daily,
               report_weekly              = EXCLUDED.report_weekly,
               report_monthly             = EXCLUDED.report_monthly,
               standard_hours_per_day          = EXCLUDED.standard_hours_per_day,
               overtime_daily_threshold_hours  = EXCLUDED.overtime_daily_threshold_hours,
               overtime_weekly_threshold_hours = EXCLUDED.overtime_weekly_threshold_hours,
               overtime_multiplier             = EXCLUDED.overtime_multiplier,
               overtime_enabled                = EXCLUDED.overtime_enabled,
               week_starts_on                  = EXCLUDED.week_starts_on,
               shift_start_time                = EXCLUDED.shift_start_time,
               shift_end_time                  = EXCLUDED.shift_end_time,
               overnight_shift                 = EXCLUDED.overnight_shift,
               updated_at                 = NOW()
        RETURNING *""",
        org_id, merged["default_radius_m"], merged["grace_minutes"],
        merged["allow_outside_geofence"], merged["accuracy_flag_threshold_m"],
        merged["punch_photo_retention_days"], merged["reference_photo_grace_days"],
        merged["record_retention_years"], json.dumps(merged["report_recipients"]),
        merged["report_daily"], merged["report_weekly"], merged["report_monthly"],
        merged["standard_hours_per_day"], merged["overtime_daily_threshold_hours"],
        merged["overtime_weekly_threshold_hours"], merged["overtime_multiplier"],
        merged["overtime_enabled"], merged["week_starts_on"],
        # asyncpg wants a `time`, and the API speaks strings. NULLIF in the SQL
        # turns "" back into NULL so clearing a shift window works, which the
        # 082 CHECK requires to happen for both ends together.
        str(merged["shift_start_time"] or ""), str(merged["shift_end_time"] or ""),
        merged["overnight_shift"],
    )

    retention_keys = {
        "punch_photo_retention_days", "reference_photo_grace_days", "record_retention_years",
    }
    if retention_keys & updates.keys():
        audit(
            "pahchan.retention_changed",
            request,
            org_id=org_id,
            user_id=user["user_id"],
            detail={k: updates[k] for k in retention_keys & updates.keys()},
            severity="warn",
        )
    return dict(row)
