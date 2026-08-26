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

Schema: migrations/PROPOSED_064_pahchan.sql — APPLIED, whatever its filename
still says. It defines `pahchan_sites`, `pahchan_punches`,
`pahchan_enrollment_photos`, `pahchan_regularisations` and `pahchan_policy`,
plus the `pahchan_org_usage` view §7 aggregates through; measured read-only
2026-08-26 all five hold rows (9 · 699 · 24 · 40 · 2) and the view exists. This
header read "not yet applied" until then, which is the one wrong fact that makes
a reader treat a live table as a draft — the file is left named PROPOSED_064
because renaming an applied migration is a riskier job than saying so here.
Later columns come from 106, 109, 113, 193 (altitude), 196 (policy scopes) and
209.
"""
import json
import math
from datetime import date, datetime, timedelta, timezone

import asyncpg
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel, Field, model_validator

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_org_role
from middleware.subscription import require_module
from services.audit import emit as audit
from services.niyam.subjects import enrollment_requested
from services.on_the_rolls import still_on_the_rolls
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
# platform_manager, sahayak_admin among them. Those are commercial and support
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
    # ── Altitude, and why None is not 0 here either ──────────────────────────
    #
    # Migration 193 added these two columns on 2026-08-22 and NOTHING has ever
    # written them: the schema was the whole of the feature. Every mobile
    # geolocation fix already carries an altitude — `ClockScreen` read
    # lat/lng/accuracy and stopped, with altitude sitting right there in the
    # same object.
    #
    # It matters for exactly one thing this module cannot otherwise do: a
    # multi-storey site. Two floors of one building are the same latitude and
    # longitude to within a metre, so a horizontal geofence cannot tell the
    # warehouse from the office above it. Vertical separation can, when the
    # site says what its floor is worth.
    #
    # `None` is "this device did not report one", which is ordinary — indoor
    # fixes and some Android devices give no altitude at all — and it must stay
    # distinguishable from a device reporting sea level. Defaulting to 0 would
    # place every silent device on the beach and flag every punch at a site
    # above it.
    altitude_m: Optional[float] = None
    altitude_accuracy_m: Optional[float] = None
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
    # ── The vertical half of the fence ───────────────────────────────────────
    #
    # BOTH OPTIONAL, and a site that names neither behaves exactly as it did
    # before migration 193 — the check is skipped entirely. That is the
    # default, and it is the right one: consumer GPS altitude is far noisier
    # than its horizontal fix, and a site at ground level gains nothing from a
    # test that would flag honest punches on a cloudy day.
    #
    # The bounds mirror the CHECK constraints migration 193 declared, so a bad
    # value is refused here with a sentence rather than at the database with a
    # constraint name. `altitude_m` spans Dead Sea shore to above Everest;
    # `altitude_tolerance_m` must be positive, and 193's own header suggests
    # setting it "so the separation is larger than the noise" — a storey is
    # roughly 3m and a decent fix is ±10m, so a tolerance under about 15m will
    # flag more honest punches than dishonest ones.
    altitude_m: Optional[float] = Field(None, gt=-500, lt=9000)
    altitude_tolerance_m: Optional[int] = Field(None, gt=0)

    @model_validator(mode="after")
    def _tolerance_needs_an_altitude(self):
        """`pahchan_sites_altitude_pair_ck`, said in English.

        A tolerance with no altitude is a window around nothing. The constraint
        refuses it; this refuses it with a sentence the person filling the form
        can act on.
        """
        if self.altitude_tolerance_m is not None and self.altitude_m is None:
            raise ValueError(
                "A vertical tolerance needs an altitude to be a tolerance of. "
                "Set the site's altitude, or leave both blank to skip the check."
            )
        return self


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
    # FALSE, and migration 106 flips the three column defaults to match.
    #
    # NOTHING SENDS THESE. `report_daily`, `report_weekly` and `report_monthly`
    # are written by `upsert_policy` below and read by no function anywhere in
    # the backend — no sender, no cron, no consumer of `report_recipients`
    # either. The flags were TRUE here and TRUE in the schema, so an org that
    # has never opened the policy screen was shown three ticked boxes under a
    # heading that says "Reports", promising a daily, a weekly and a monthly
    # attendance summary that no code exists to send.
    #
    # This is the argument `overtime_enabled` already makes twelve lines below,
    # applied to a promise instead of to a payment: a default that changes what
    # the product tells a customer it will do is nobody's default. Turning one
    # of these on is now a deliberate act, and the screen says plainly that
    # delivery is not built yet — see `frontend/src/pages/pahchan/
    # PahchanPolicy.jsx`.
    #
    # Measured 6 August 2026: `staging.pahchan_policy` holds 2 rows. The E2E
    # org has all three off; Unicode Group has weekly and monthly on with
    # `hr@unicodegroup.com` in the recipients — and that row was written by the
    # demo seed at 2026-08-05 12:39:35, not by anyone at the customer. So
    # flipping the defaults today strands nobody's real choice.
    "report_daily": False,
    "report_weekly": False,
    "report_monthly": False,
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


# ── The policy that actually applies to one person, at one place ─────────────
#
# `pahchan_policy` is keyed on `org_id` and nothing else, so a firm had ONE
# attendance policy for everybody. One radius for every site is the clearest
# failure of that: 150m is generous around a city office and useless around a
# factory compound, and widening it for the compound widens it for the office
# too. The same goes for every figure in the row — a shift that starts at 09:00
# for staff and 07:00 for plant, a grace period that is ten minutes for salaried
# people and zero for contractors on an hourly rate.
#
# Migration 196 adds `pahchan_policy_overrides`, four scopes, most specific wins:
#
#     org  →  site  →  category  →  employee
#
# `category` is `manav_employees.employment_type`, which already exists and
# already separates the people whose rules genuinely differ (measured live:
# 69 full_time, 15 intern, 14 contract). Inventing a second taxonomy would mean
# an HR admin maintaining two classifications of the same people, which is how
# two classifications come to disagree.

#: The keys an override may carry. NOT an allowlist for tidiness — the same list
#: is a CHECK constraint on the table (196), and it exists because retention and
#: reporting must stay org-level:
#:
#:   · retention is a DPDP promise made to every person in the organisation, in
#:     ONE notice quoting ONE number. `_retention` exists because a notice
#:     quoting a figure that was not the one in force has already shipped here.
#:     A per-employee window would make that notice wrong for somebody BY
#:     CONSTRUCTION, and they would be the last to know.
#:   · reporting is a commercial arrangement with the org, not a fact about a
#:     site.
#:
#: Enforced in BOTH places on purpose: the constraint is what stops a bad row
#: existing, and this is what gives the person writing it a sentence instead of
#: a constraint name.
POLICY_OVERRIDABLE_KEYS: frozenset[str] = frozenset({
    "default_radius_m",
    "grace_minutes",
    "allow_outside_geofence",
    "accuracy_flag_threshold_m",
    "standard_hours_per_day",
    "overtime_daily_threshold_hours",
    "overtime_weekly_threshold_hours",
    "overtime_multiplier",
    "overtime_enabled",
    "week_starts_on",
    "shift_start_time",
    "shift_end_time",
    "overnight_shift",
})

#: Least specific first. `_resolve_policy` applies them in this order, so a later
#: entry overwrites an earlier one KEY BY KEY — never wholesale. A site override
#: that names only `default_radius_m` leaves the employee's grace period exactly
#: where the org put it, which is the whole reason overrides are partial.
_SCOPE_ORDER = ("site", "category", "employee")


async def _resolve_policy(
    pool,
    org_id: str,
    *,
    employee: Optional[dict] = None,
    site_id: Optional[str] = None,
) -> dict:
    """The policy as it applies to THIS punch: org, then site, then category,
    then employee.

    Returns a plain dict in the same shape `_policy` returns, so every existing
    caller keeps working and nothing downstream has to learn about scopes.

    ── WHAT MAKES THIS SAFE TO PUT IN THE PUNCH PATH ────────────────────────
    An org with no override rows resolves EXACTLY what `_policy` resolves — the
    merge loop runs zero times. That is the property that made migration 196
    additive in effect and not just in form.

    Nothing here can refuse a punch. An unreadable override, a scope naming a
    site that has been deleted, a key that is no longer overridable: all of them
    are skipped, and the org-wide value stands. 07 §2 — nothing blocks a punch —
    applies to the code that DECIDES the rules just as much as to the code that
    applies them, and a policy lookup that could 500 would be a new way to stop
    somebody clocking in.
    """
    resolved = await _policy(pool, org_id)

    # One query for every override this org has. There are at most a handful per
    # org and they are read on every punch, so a per-scope round trip would be
    # three queries to answer a question that is nearly always "no overrides".
    rows = await pool.fetch(
        "SELECT scope_kind, scope_ref, overrides "
        "FROM staging.pahchan_policy_overrides WHERE org_id=$1::uuid",
        org_id,
    )
    if not rows:
        return resolved

    # Which value of `scope_ref` matches at each level, for this punch. `None`
    # means the level cannot match — no site resolved, no employee, an employee
    # with no employment_type — and a level that cannot match is skipped rather
    # than matched against the empty string.
    wanted = {
        "site": str(site_id) if site_id else None,
        "category": (employee or {}).get("employment_type") or None,
        "employee": str(employee["id"]) if employee and employee.get("id") else None,
    }

    by_scope: dict[str, dict] = {}
    for r in rows:
        kind, ref = r["scope_kind"], r["scope_ref"]
        if wanted.get(kind) is None or ref != wanted[kind]:
            continue
        raw = r["overrides"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except (ValueError, TypeError):
                continue
        if isinstance(raw, dict):
            by_scope[kind] = raw

    for kind in _SCOPE_ORDER:
        for key, value in (by_scope.get(kind) or {}).items():
            # Re-checked here as well as by the constraint. A key that WAS
            # overridable when the row was written and is not any more must stop
            # applying rather than keep applying invisibly.
            if key in POLICY_OVERRIDABLE_KEYS:
                resolved[key] = value

    return resolved


#: The three figures the retention promise is made of, and the ONE place the
#: policy column names are translated into the names the clients read.
#:
#: THE SERVER AND THE CLIENTS DISAGREED ON THE NAME. `pahchan_policy` stores
#: `punch_photo_retention_days`; `frontend/src/lib/pahchanNotice.js` and
#: `mobile/src/screens/pahchan/noticeCopy.ts` both read `punch_photo_days` and
#: fall back per key to `RETENTION_FALLBACK` when a key is absent. So a branch
#: that returned the raw policy row shipped a DPDP notice quoting 90 days to an
#: org whose window is 30 — silently, because a missing key is a fallback and
#: not an error. `MyBiometrics.tsx:155` rendered `undefined days, then deleted`
#: on the same data.
#:
#: This is why it is a function and not two dict literals: two literals is how
#: the two branches of `GET /v1/pahchan/me` came to answer in two shapes.
def _retention(policy: dict) -> dict:
    """The retention promise, in the names the clients actually read.

    `pahchanNotice.js:22-26` states the requirement this serves: "An org that
    shortened its punch-photo window to 30 days must not have its notice say
    90." A retention promise displayed from a constant is a promise about a
    different system.
    """
    return {
        "punch_photo_days": policy["punch_photo_retention_days"],
        "reference_photo_grace_days": policy["reference_photo_grace_days"],
        "record_retention_years": policy["record_retention_years"],
    }


async def _employee_for(pool, org_id: str, user_id: str) -> Optional[dict]:
    # `employment_type` is selected because `_resolve_policy` scopes on it — it
    # is the `category` level of org -> site -> category -> employee, and it is
    # the column that already separates the people whose attendance rules
    # genuinely differ (measured live 2026-08-22: 69 full_time, 15 intern, 14
    # contract). Selected HERE rather than fetched again in the resolver so the
    # punch path stays one employee lookup, and so a caller that has an employee
    # row always has enough to resolve their policy from it.
    return await pool.fetchrow(
        "SELECT id, name, employment_type FROM staging.manav_employees "
        "WHERE org_id=$1::uuid AND user_id=$2 AND is_active=TRUE",
        org_id, user_id,
    )


# ── The DPDP notice ───────────────────────────────────────────────────────────
#
# 07 §8 and the prototype's `PhNotice`. The WORDS live on the clients — one copy
# module per platform, `frontend/src/lib/pahchanNotice.js` and
# `mobile/src/screens/pahchan/noticeCopy.ts` — and the server holds only the
# fact that a given ACCOUNT saw a given version of them. That split is
# deliberate: a notice is a rendering problem, an acknowledgement is a record.
#
# THE SUBJECT IS THE ACCOUNT, NOT THE EMPLOYEE, and that is a measurement rather
# than a preference. `migrations/113_pahchan_notice_acknowledgements.sql` records
# it: `SELECT count(*), count(user_id) FROM staging.manav_employees` → 81 rows, 0
# with a user_id, on 6 August 2026. `_employee_for` below resolves the caller by
# exactly that column, so it returns None for EVERY caller on this database
# today. Keyed on the employee, this table could not accept one acknowledgement
# from one person and the gate above the camera would have to be waved through —
# which is the notice not existing, with extra steps. `employee_id` is recorded
# ALONGSIDE, when it happens to resolve.
#
# THIS VERSION STRING IS NOT AUTHORITATIVE OVER THE CLIENTS. It is what the
# server files an acknowledgement under when a client sends none. The clients
# send their own, and a client on an older build acknowledging an older wording
# must file THAT wording, not this one — the row is the answer to "what were
# they shown", and rewriting it to today's string would make it a lie.
PAHCHAN_NOTICE_VERSION = "2026-08-06.1"

#: A sanity ceiling on a client-supplied version string. The column is TEXT with
#: a non-blank CHECK and deliberately no vocabulary (113: "a copy edit must not
#: be a migration"), so this is only a guard against an absurd body.
_NOTICE_VERSION_MAX = 64


def _notice_store_absent(exc: Exception) -> bool:
    """
    Is this "migration 113 has not been applied"?

    `42P01` is `staging.pahchan_notice_acknowledgements` not existing; `42703` is
    it existing without a column this code names. Both mean the same thing to the
    caller — the store is not there — and both must degrade rather than raise.

    113 states the rule in its own words: "a compliance record that can block
    attendance has become an availability incident wearing a compliance costume."
    On the phone this acknowledgement sits above the camera, so a 500 here is a
    person who cannot clock in, and 07 §2 is that NOTHING BLOCKS A PUNCH.
    """
    return getattr(exc, "sqlstate", None) in ("42P01", "42703")


async def _notice_ack(pool, org_id: str, user_id: str, version: str) -> Optional[datetime]:
    """
    When this account acknowledged this exact wording, or None.

    Returns the DEVICE clock (`acknowledged_at`), because that is the legally
    interesting instant — the one that must precede the first photograph. 113
    keeps `recorded_at` beside it for ordering; nothing on a client surface wants
    to be told when a server wrote a row.

    MIN, not the row's own value, because the unique index is on
    (org_id, user_id, notice_version) and an ON CONFLICT DO NOTHING insert keeps
    the FIRST tap. MIN over no rows is NULL, not an error.

    Never raises for an absent table: `/me` must keep answering on a database
    where 113 has not run. The client then shows the notice again, which is the
    safe direction — showing a notice twice is a nuisance, recording an
    acknowledgement that never happened is not.
    """
    try:
        return await pool.fetchval(
            "SELECT MIN(acknowledged_at) FROM staging.pahchan_notice_acknowledgements "
            "WHERE org_id=$1::uuid AND user_id=$2 AND notice_version=$3",
            org_id, user_id, version,
        )
    except Exception as exc:  # noqa: BLE001 — narrowed immediately below
        if _notice_store_absent(exc):
            return None
        raise


async def _nearest_site(pool, org_id: str, lat: float, lng: float):
    """Nearest active site and the distance to it. Python-side because the table
    is a handful of rows per org and PostGIS is not installed — adding an
    extension for a ten-row nearest-neighbour would be the wrong trade."""
    sites = await pool.fetch(
        "SELECT id, name, lat, lng, radius_m, altitude_m, altitude_tolerance_m "
        "FROM staging.pahchan_sites "
        "WHERE org_id=$1::uuid AND is_active=TRUE",
        org_id,
    )
    best, best_d = None, None
    for site in sites:
        d = _haversine_m(lat, lng, float(site["lat"]), float(site["lng"]))
        if best_d is None or d < best_d:
            best, best_d = site, d
    return best, best_d


def _altitude_gap_m(
    reported_m: Optional[float],
    site_altitude_m: Optional[float],
    site_tolerance_m: Optional[int],
) -> Optional[float]:
    """How far above or below the site's floor this punch claims to be.

    `None` means the question was not asked, and there are three ways for that
    to be the right answer — all of which must behave identically to a product
    that has no altitude feature at all:

      · the site names no altitude          (the default; 193 says NULL means
                                             "do not check")
      · the site names no tolerance         (a floor with no window around it)
      · the device reported no altitude     (ordinary indoors, and on some
                                             Android hardware, always)

    The third is the one worth stating: a device that CANNOT report altitude
    must not be flagged for it. Migration 193's own header makes the same point
    about sea level — a device that reports nothing has to stay
    distinguishable from one reporting zero — and this is that rule at the
    other end of the wire.
    """
    if reported_m is None or site_altitude_m is None or site_tolerance_m is None:
        return None
    return abs(float(reported_m) - float(site_altitude_m))


def _compute_flags(
    body: PunchBody,
    policy: dict,
    distance_m: Optional[float],
    site_radius_m: Optional[int],
    has_reference_pair: bool,
    altitude_gap_m: Optional[float] = None,
    site_altitude_tolerance_m: Optional[int] = None,
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
    # ── The vertical half of the same fence ──────────────────────────────────
    #
    # Reuses "geo" rather than adding a flag code. It is the same finding — the
    # punch is not where the site is — and the reviewer's question ("was this
    # person here?") does not change because the discrepancy is vertical. A new
    # code would also have to be taught to every consumer of `flags`: the
    # review screen, the attendance bridge, the reports and the mobile client.
    #
    # This is what makes a multi-storey site possible. Two floors of one
    # building share a latitude and longitude to within a metre, so the
    # horizontal test above can never separate the warehouse from the office
    # over it. Nothing is REFUSED here, exactly as nothing is refused anywhere
    # else in this function — 07 §2, every branch records and flags.
    if (
        altitude_gap_m is not None
        and site_altitude_tolerance_m is not None
        and altitude_gap_m > float(site_altitude_tolerance_m)
    ):
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

    # ── THE KEY, IN THE ONE GRAMMAR (proposal 83 §4) ────────────────────────
    #
    # This was `folder = f"pahchan/{org_id}/punch"`, and on the platform bucket
    # the storage layer then prepended `org/{org_id}/` — so the stored key named
    # the same organisation TWICE. That is proposal 83's bug 2, and it was not
    # merely ugly: see the guard in `create_punch`, which expected the key to
    # START with `pahchan/` and therefore refused every photo taken by an org on
    # the platform bucket. Two of the three orgs are on it. Measured
    # 2026-08-23: 1,659 punches, ZERO with a photo_key.
    #
    # `pahchan/{kind}/{employee_id}/YYYY/MM/{id}--name.jpg`. The EMPLOYEE rather
    # than the acting account, because a punch photograph belongs to the person
    # in it, and the employee id is the one that survives their account being
    # replaced. `_employee_for` returns None for most accounts on this database
    # — the employee↔login link is still mostly unmade — and a missing scope
    # segment is DROPPED rather than rendered as an empty folder, so those keys
    # are `pahchan/punch/YYYY/MM/…` and remain perfectly valid.
    photo_kind = "reference" if kind == "reference" else "punch"
    pool = await get_pool()
    employee = await _employee_for(pool, org_id, user["user_id"])
    result = await storage.upload_file(
        file_bytes=data,
        filename=file.filename or "capture.jpg",
        content_type=file.content_type or "image/jpeg",
        user_id=user["user_id"],
        module="pahchan",
        scope=[photo_kind, str(employee["id"]) if employee else None],
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

    site = None
    distance_m = None
    if body.lat is not None and body.lng is not None:
        if body.site_id:
            site = await pool.fetchrow(
                "SELECT id, lat, lng, radius_m, altitude_m, altitude_tolerance_m "
                "FROM staging.pahchan_sites "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                str(body.site_id), org_id,
            )
            if site:
                distance_m = _haversine_m(
                    body.lat, body.lng, float(site["lat"]), float(site["lng"])
                )
        else:
            site, distance_m = await _nearest_site(pool, org_id, body.lat, body.lng)

    # ── The policy is resolved AFTER the site, and that ordering is the point ─
    #
    # It used to be the first thing this handler read, when there was one policy
    # per org and nothing about a punch could change it. Migration 196 adds
    # site → category → employee overrides, and the site is not known until the
    # geofence resolution above has run — so reading the policy first would
    # resolve the org-wide `accuracy_flag_threshold_m` and then judge the punch
    # against a site that overrides it.
    #
    # Nothing between the old position and this one reads `policy`.
    policy = await _resolve_policy(
        pool, org_id, employee=employee,
        site_id=str(site["id"]) if site else None,
    )

    ref_count = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.pahchan_enrollment_photos "
        "WHERE employee_id=$1::uuid AND replaced_at IS NULL AND approved_at IS NOT NULL",
        str(employee["id"]),
    )
    # Both are None unless the site declares an altitude AND a tolerance AND the
    # device reported one — see `_altitude_gap_m`. `site.keys()` rather than a
    # bare subscript because `_nearest_site` selects a narrower row than the
    # by-id branch above, and an absent key there must read as "not checked"
    # rather than raise.
    site_altitude_m = site["altitude_m"] if site and "altitude_m" in site.keys() else None
    site_altitude_tolerance_m = (
        site["altitude_tolerance_m"]
        if site and "altitude_tolerance_m" in site.keys() else None
    )
    altitude_gap_m = _altitude_gap_m(
        body.altitude_m, site_altitude_m, site_altitude_tolerance_m,
    )

    flags = _compute_flags(
        body, policy, distance_m,
        int(site["radius_m"]) if site else None,
        has_reference_pair=(ref_count or 0) >= 2,
        altitude_gap_m=altitude_gap_m,
        site_altitude_tolerance_m=(
            int(site_altitude_tolerance_m)
            if site_altitude_tolerance_m is not None else None
        ),
    )

    if body.photo_key:
        # ── The key must be one this endpoint's own uploader minted ──────────
        #
        # Without this a punch can name ANY object in the org's bucket: an
        # invoice, a payslip, or somebody else's reference photograph. A
        # malformed key is §2's one permitted 4xx.
        #
        # IT REFUSED EVERY PHOTO ON THE PLATFORM BUCKET. The check was
        # `startswith(f"pahchan/{org_id}/punch/")`, and `upload_file` returns
        # the key WITH the tenant prefix on it — `org/{org_id}/pahchan/…` for an
        # org without its own R2 account. Two of the three orgs are in exactly
        # that state, so for them this branch raised on every punch that
        # carried a photograph. Measured 2026-08-23: 1,659 punches, ZERO with a
        # photo_key. The feature has never worked for those orgs and the 400
        # said the photo belonged to another organisation, which was not true
        # and gave nobody anything to go on.
        #
        # So: strip the tenant prefix if it is there — and only THIS org's, so
        # a key naming another org's prefix still fails — then accept either
        # grammar. The old shape stays accepted because a client may hold a key
        # minted seconds before a deploy, and refusing it would lose a punch
        # photograph to a release.
        remainder = body.photo_key
        tenant_prefix = f"org/{org_id}/"
        if remainder.startswith(tenant_prefix):
            remainder = remainder[len(tenant_prefix):]

        accepted = (
            "pahchan/punch/",                 # the grammar (proposal 83 §4)
            f"pahchan/{org_id}/punch/",       # the shape before it
        )
        if not remainder.startswith(accepted):
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
                    mock_location, flags, client_punch_id,
                    altitude_m, altitude_accuracy_m)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
                       $7, $8, $9, $10, $11, $12,
                       $13, $14::text[], $15,
                       $16, $17)
               RETURNING id, direction, captured_at, received_at, flags, source""",
            org_id, str(employee["id"]), body.direction, body.captured_at,
            # An offline punch synced now; a live one has no separate sync moment.
            datetime.now(timezone.utc) if body.source == "offline" else None,
            body.photo_key,
            body.lat, body.lng, body.accuracy_m, distance_m,
            str(site["id"]) if site else None,
            body.source, body.mock_location, flags, body.client_punch_id,
            # Stored whether or not it was CHECKED. A punch at a site with no
            # declared altitude still records what the device reported, which
            # is what lets an operator set a site's altitude later from real
            # observations rather than from a map.
            body.altitude_m, body.altitude_accuracy_m,
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

async def _rules_for_employee(pool, org_id: str, policy: dict) -> dict:
    """The rules this person is actually judged by, in their own words.

    ── WHY THIS EXISTS ──────────────────────────────────────────────────────
    Every rule in this module was visible to the org and invisible to the
    person it decides about. An employee could see their punches and their
    flags and could not see WHY anything was flagged: not the radius, not the
    grace period, not the accuracy threshold, and — since migration 193 — not
    the altitude window either. A "geo" flag on an honest punch is a question
    an employee cannot answer without the number they missed by.

    That asymmetry is the whole objection to biometric attendance, and it is
    the one this module's own header sets out to avoid. The DPDP notice already
    tells them what is RECORDED; this tells them what is JUDGED.

    ── WHAT IT DOES NOT CONTAIN ─────────────────────────────────────────────
    Nothing about anybody else. No employee ids, no colleague's punches, no
    reviewer names. The sites come back because a site is a place, not a
    person, and an employee needs to know which fence they are inside.

    Inactive sites are omitted: a fence nobody is judged against is noise on a
    screen whose whole purpose is to be readable.
    """
    sites = await pool.fetch(
        "SELECT name, radius_m, altitude_m, altitude_tolerance_m "
        "FROM staging.pahchan_sites "
        "WHERE org_id=$1::uuid AND is_active IS NOT FALSE ORDER BY name",
        org_id,
    )
    return {
        # Each of these is a sentence the Me tab can render as-is. The numbers
        # come from the policy the org actually saved, never from the defaults
        # in this file — an employee reading a hardcoded 100m while their org
        # runs at 40m is exactly the failure `_retention` was fixed for.
        "grace_minutes": policy["grace_minutes"],
        "accuracy_flag_threshold_m": policy["accuracy_flag_threshold_m"],
        "allow_outside_geofence": policy["allow_outside_geofence"],
        "standard_hours_per_day": policy.get("standard_hours_per_day"),
        "overtime_enabled": policy.get("overtime_enabled"),
        "sites": [
            {
                "name": r["name"],
                "radius_m": r["radius_m"],
                # Both, or neither. A tolerance with no altitude cannot exist
                # (`pahchan_sites_altitude_pair_ck`), and an altitude with no
                # tolerance is recorded but not checked — so the client can say
                # "this site also checks your floor" on exactly the sites where
                # that is true.
                "altitude_m": r["altitude_m"],
                "altitude_tolerance_m": r["altitude_tolerance_m"],
                "checks_altitude": r["altitude_m"] is not None
                                   and r["altitude_tolerance_m"] is not None,
            }
            for r in sites
        ],
        # What each flag MEANS, so the register is readable without a manual.
        # Keyed by the code stored in `pahchan_punches.flags`, and every one of
        # them ends the same way for a reason: none of them refuses a punch.
        "flag_meanings": {
            "geo": "You were outside the site's area — or, where a site checks "
                   "it, above or below its floor by more than it allows.",
            "accuracy": "Your phone was not sure where it was. Weak signal "
                        "indoors and underground does this.",
            "mock": "The phone reported that its location was being simulated.",
            "offline": "Recorded without a connection and sent later.",
            "noref": "There are no approved reference photos for you yet. HR "
                     "enrols those; it is not something you did.",
            "retries": "The camera failed several times before this photo.",
            "reuse": "This photo had already been attached to another punch.",
        },
        "nothing_is_refused": True,
    }


@router.get("/me")
async def my_punches(
    days: int = 30,
    notice_version: str = PAHCHAN_NOTICE_VERSION,
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

    It also carries `notice`, which is what decides whether the phone shows the
    DPDP notice before the camera. `notice_version` is a query parameter and not
    a constant so that a client on an older build asks about the wording IT
    renders — asking about today's string would tell somebody who has already
    read the notice they are shown that they have not.
    """
    pool = await get_pool()
    version = (notice_version or PAHCHAN_NOTICE_VERSION)[:_NOTICE_VERSION_MAX]
    employee = await _employee_for(pool, org_id, user["user_id"])
    if not employee:
        # Read ONCE and named, rather than fetched inside the dict twice or
        # smuggled through a walrus: `retention` and `rules` are two views of
        # the same policy row, and two reads is two chances for them to be two
        # different policies.
        policy = await _policy(pool, org_id)
        return {
            "employee": None,
            "punches": [],
            # THE SAME SHAPE AS THE BRANCH BELOW, through the same helper. This
            # returned the raw policy row until 6 August 2026, whose column is
            # `punch_photo_retention_days` — a name neither client reads. Both
            # fall back per key, so the notice printed the hardcoded 90 on every
            # request and never once errored. This is the branch 100% of callers
            # take today (see the comment below), so 100% of DPDP notices served
            # quoted a retention window that was not the one in force.
            "retention": _retention(policy),
            # The SAME rules block as the branch below. Somebody whose account
            # is not yet linked to a personnel record is precisely the person
            # most likely to be wondering what happens when they punch, and
            # answering "no employee row, so no rules" would be a screen that
            # goes blank at the moment it is most needed.
            "rules": await _rules_for_employee(pool, org_id, policy),
            # STILL ANSWERED, and this branch is the common one rather than the
            # edge case: 0 of 81 employee rows carry a user_id today, so
            # `_employee_for` returns None for everybody. The acknowledgement is
            # keyed on the account, so it resolves here exactly as it does below.
            "notice": {
                "version": version,
                "acknowledged_at": await _notice_ack(pool, org_id, user["user_id"], version),
            },
        }

    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 120)))
    rows = await pool.fetch(
        "SELECT id, direction, captured_at, received_at, source, flags, "
        "       accuracy_m, distance_m, altitude_m, altitude_accuracy_m, "
        "       review_verdict "
        "FROM staging.pahchan_punches "
        "WHERE employee_id=$1::uuid AND captured_at >= $2 "
        "ORDER BY captured_at DESC",
        str(employee["id"]), since,
    )
    # Their OWN policy, not the org's. An employee on a contract whose grace
    # period is zero must not be shown the salaried ten minutes: a screen whose
    # entire purpose is "the rule you are judged by" is worse than nothing if it
    # states a rule somebody else is judged by.
    #
    # No `site_id`: the Me tab is a standing statement rather than a punch, and
    # a per-site figure belongs beside the site in the `sites` list, which
    # `_rules_for_employee` already carries.
    policy = await _resolve_policy(pool, org_id, employee=employee)
    return {
        "employee": {"id": str(employee["id"]), "name": employee["name"]},
        "punches": [dict(r) for r in rows],
        # Stated in plain words on the Me tab, not buried in a policy page.
        "retention": _retention(policy),
        # And the rules those punches were judged against. See
        # `_rules_for_employee`: what is recorded was already disclosed; what
        # decides was not.
        "rules": await _rules_for_employee(pool, org_id, policy),
        "notice": {
            "version": version,
            "acknowledged_at": await _notice_ack(pool, org_id, user["user_id"], version),
        },
    }


class NoticeAckBody(BaseModel):
    #: Which wording was on screen. Defaulted rather than required so a client
    #: that has not been updated still records SOMETHING — an acknowledgement
    #: filed under the wrong version is recoverable, a punch blocked by a 422 is
    #: the thing 07 §2 exists to prevent.
    version: str = Field(PAHCHAN_NOTICE_VERSION, min_length=1, max_length=_NOTICE_VERSION_MAX)
    #: The DEVICE clock at the tap. 113's "TWO CLOCKS": this is the legally
    #: interesting instant and it may precede the write by days, because the
    #: mobile gate clears offline. Absent means "now" — a web tap, where the two
    #: moments are the same moment.
    acknowledged_at: Optional[datetime] = None
    #: Which surface served it. `mobile` is the gate above the camera; `web` is
    #: the "What we record" tab, where there is no punch surface and so no gate.
    source: str = Field("web", pattern="^(web|mobile)$")
    #: Whether this was held on the device and synced later. Stated by the client
    #: rather than inferred from the two timestamps here — a phone with a wrong
    #: clock would make that inference lie in both directions (113).
    was_offline: bool = False


@router.post("/notice/ack")
async def acknowledge_notice(
    body: NoticeAckBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """
    Record that this account was served the DPDP notice.

    A notice you cannot prove you served is a notice you did not serve, so this
    IS stored — one row per (org, account, version), `ON CONFLICT DO NOTHING`, so
    a double tap or an offline replay cannot mint a second row and cannot move
    the first one's timestamp. The FIRST tap is the one that preceded the
    photograph and is therefore the one that matters.

    `employee_id` is recorded alongside when it resolves, which is never on this
    database today — see the note above `_notice_ack`. The compliance question
    ("was this person told before we photographed them?") is answerable from day
    one; the HR question ("who on my roster has been served?") gets better the
    day accounts and employees are linked.

    ── IT ANSWERS 200 WHEN IT COULD NOT STORE ANYTHING ───────────────────────────

    `staging.pahchan_notice_acknowledgements` arrives in migration 113, which is
    UNAPPLIED. Until it is, this returns `{"stored": false}` with a 200 and the
    client clears its gate on its own local record. That is not a convenience: on
    the phone this gate sits above the camera, so a 500 here is a person who
    cannot clock in. 07 §2 — "a blocked punch at a client site becomes a payroll
    dispute a week later, and the employee is right."

    `stored: false` is the client's cue to say "recorded on this device" rather
    than to show a date it did not earn, and the audit line is emitted either way
    so the attempt is not invisible.
    """
    pool = await get_pool()
    employee = await _employee_for(pool, org_id, user["user_id"])
    # The device clock, or now. NOT validated against the server's own — 113 is
    # explicit that refusing a skewed row means refusing the sync, which means
    # the gate never clears, which means the blocked punch.
    tapped_at = body.acknowledged_at or datetime.now(timezone.utc)

    stored = True
    acknowledged_at = None
    try:
        acknowledged_at = await pool.fetchval(
            "INSERT INTO staging.pahchan_notice_acknowledgements "
            "  (org_id, user_id, employee_id, notice_version, acknowledged_at, "
            "   source, was_offline) "
            "VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7) "
            "ON CONFLICT (org_id, user_id, notice_version) DO NOTHING "
            "RETURNING acknowledged_at",
            org_id, user["user_id"],
            str(employee["id"]) if employee else None,
            body.version, tapped_at, body.source, body.was_offline,
        )
        if acknowledged_at is None:
            # DO NOTHING fired — already acknowledged. Read the first one back
            # rather than reporting the instant we were just handed.
            acknowledged_at = await _notice_ack(pool, org_id, user["user_id"], body.version)
    except Exception as exc:  # noqa: BLE001 — narrowed immediately below
        if not _notice_store_absent(exc):
            raise
        stored = False

    audit(
        "pahchan.notice_ack",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_notice",
        resource_id=str(employee["id"]) if employee else user["user_id"],
        detail={
            "notice_version": body.version,
            "source": body.source,
            "was_offline": body.was_offline,
            "stored": stored,
        },
        # An acknowledgement that could not be stored is the one thing here
        # somebody would want to find in a log later.
        severity="info" if stored else "warn",
    )
    return {
        "version": body.version,
        "acknowledged_at": acknowledged_at,
        "stored": stored,
    }


# ── Per-employee consent — the data principal, not the account ───────────────
# `staging.pahchan_employee_consents` (migration 209). `/notice/ack` above
# records that an ACCOUNT saw the notice UI; most employees have none
# (measured live: 25 of 27 Unicode Group employees have no login), so the
# DPDP question — did THIS EMPLOYEE consent to biometric processing, and by
# what method — needed a path that does not require one. An admin records
# what was actually obtained (a paper form, a witnessed verbal declination),
# never fabricates a tap the employee never made.

class EmployeeConsentBody(BaseModel):
    employee_id: UUID
    method: str = Field(..., pattern="^(paper|verbal_witnessed)$")
    #: False is an opt-out, not a missing record — see migration 209.
    consented: bool
    note: Optional[str] = Field(None, max_length=2000)
    notice_version: str = Field(PAHCHAN_NOTICE_VERSION, min_length=1, max_length=_NOTICE_VERSION_MAX)


@router.post("/consent")
async def record_employee_consent(
    body: EmployeeConsentBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """An admin records what consent was actually obtained from one employee.

    Gated the same as viewing another person's biometrics — recording
    someone's consent (or opt-out) on their behalf is exactly that class of
    action, not a lesser one.
    """
    pool = await get_pool()
    if not await _may_view_others_biometrics(pool, user["user_id"], org_id):
        raise HTTPException(403, "Only an org admin can record consent for another person")

    emp = await pool.fetchrow(
        "SELECT id FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        str(body.employee_id), org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")

    row = await pool.fetchrow(
        "INSERT INTO staging.pahchan_employee_consents "
        "  (org_id, employee_id, notice_version, method, consented, recorded_by, note) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7) "
        "ON CONFLICT (org_id, employee_id, notice_version) DO UPDATE SET "
        "  method=EXCLUDED.method, consented=EXCLUDED.consented, "
        "  recorded_by=EXCLUDED.recorded_by, recorded_at=NOW(), note=EXCLUDED.note "
        "RETURNING id, employee_id, notice_version, method, consented, recorded_by, recorded_at, note",
        org_id, str(body.employee_id), body.notice_version, body.method,
        body.consented, user["user_id"], body.note,
    )

    audit(
        "pahchan.employee_consent_recorded", request, org_id=org_id, user_id=user["user_id"],
        resource_type="pahchan_employee_consent", resource_id=str(body.employee_id),
        detail={"method": body.method, "consented": body.consented, "notice_version": body.notice_version},
        severity="warn",
    )
    return dict(row)


@router.get("/consent")
async def list_employee_consents(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not await _may_view_others_biometrics(pool, user["user_id"], org_id):
        raise HTTPException(403, "Only an org admin can view consent records")
    rows = await pool.fetch(
        "SELECT c.employee_id, e.name AS employee_name, c.notice_version, c.method, "
        "c.consented, c.recorded_by, c.recorded_at, c.note "
        "FROM staging.pahchan_employee_consents c "
        "JOIN staging.manav_employees e ON e.id = c.employee_id "
        "WHERE c.org_id=$1::uuid ORDER BY c.recorded_at DESC",
        org_id,
    )
    return [dict(r) for r in rows]


async def _employee_opted_out(pool, employee_id: str) -> bool:
    """True if this employee's MOST RECENT recorded consent (any notice
    version) declined. A newer opt-in supersedes an older opt-out, and vice
    versa — this is a live status, not a history."""
    latest = await pool.fetchval(
        "SELECT consented FROM staging.pahchan_employee_consents "
        "WHERE employee_id=$1::uuid ORDER BY recorded_at DESC LIMIT 1",
        employee_id,
    )
    return latest is False


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
                  -- The vertical half of the fence, and the two numbers that
                  -- make a "geo" flag readable. Without them a reviewer looking
                  -- at a multi-storey site sees a flagged punch whose distance
                  -- is fifteen metres and no reason at all — the horizontal
                  -- test passed and the vertical one is why it is here.
                  p.altitude_m, p.altitude_accuracy_m,
                  s.altitude_m           AS site_altitude_m,
                  s.altitude_tolerance_m AS site_altitude_tolerance_m,
                  CASE WHEN p.altitude_m IS NOT NULL AND s.altitude_m IS NOT NULL
                       THEN abs(p.altitude_m - s.altitude_m)
                  END AS altitude_gap_m,
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
        "SELECT id, name, lat, lng, radius_m, altitude_m, altitude_tolerance_m, "
        "       is_active "
        "FROM staging.pahchan_sites "
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
        "INSERT INTO staging.pahchan_sites "
        "  (org_id, name, lat, lng, radius_m, altitude_m, altitude_tolerance_m) "
        "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) "
        "RETURNING id, name, radius_m, altitude_m, altitude_tolerance_m",
        org_id, body.name, body.lat, body.lng, body.radius_m,
        body.altitude_m, body.altitude_tolerance_m,
    )
    return dict(row)


class SiteAmend(BaseModel):
    """Every field of a site, all optional — a PATCH.

    There was no way to amend a site at all: `POST` and `GET`, and nothing
    between them. A radius typed wrong, a pin dropped on the wrong side of a
    building, or an office that moved meant creating a second site and leaving
    the first one flagging every punch at it. The altitude pair made that worse
    rather than better, because it is the field most likely to be got wrong
    first and corrected from real observations later.

    `is_active` is here rather than as a DELETE. A site is named by
    `pahchan_punches.geofence_id` on every punch ever recorded at it, and
    deleting one would either orphan those rows or take the attendance history
    with it. Deactivating stops it being offered and leaves the record intact.
    """
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_m: Optional[int] = Field(None, gt=0)
    altitude_m: Optional[float] = Field(None, gt=-500, lt=9000)
    altitude_tolerance_m: Optional[int] = Field(None, gt=0)
    is_active: Optional[bool] = None
    #: Clearing the vertical check is a real thing to want, and it cannot be
    #: said by omission — an absent `altitude_m` means "leave it alone", which
    #: is what every other field means. This says "stop checking altitude here",
    #: and it clears BOTH columns, because a tolerance without an altitude is
    #: what `pahchan_sites_altitude_pair_ck` refuses.
    clear_altitude: bool = False


#: The columns `PATCH /sites/{id}` may write. A server-side allowlist, not a
#: trust in the model: the SET clause interpolates these names, and the rule in
#: CLAUDE.md is that a dynamic identifier comes from a list like this one rather
#: than from whatever a payload happened to carry.
_SITE_AMENDABLE = ("name", "lat", "lng", "radius_m",
                   "altitude_m", "altitude_tolerance_m", "is_active")


@router.patch("/sites/{site_id}")
async def amend_site(
    site_id: UUID,
    body: SiteAmend,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Amend a site. Nothing here re-judges a punch that has already happened.

    A punch stores `distance_m` and its flags AT CAPTURE, so moving a fence
    changes what happens next and never what was already decided. That is the
    correct behaviour and it is worth stating: an operator who widens a radius
    to stop honest punches being flagged is not silently clearing yesterday's
    flags, and an operator who tightens one is not retroactively accusing
    anybody.
    """
    pool = await get_pool()

    updates = {
        k: v for k, v in body.dict(exclude_unset=True).items()
        if k in _SITE_AMENDABLE and v is not None
    }
    if body.clear_altitude:
        # Both, together. `pahchan_sites_altitude_pair_ck` refuses a tolerance
        # with no altitude, so clearing one without the other would be refused
        # by the database with a constraint name instead of a sentence.
        updates["altitude_m"] = None
        updates["altitude_tolerance_m"] = None

    if not updates:
        raise HTTPException(400, "Nothing to update")

    # The pair rule again, on the amend path: the site as it will BE, not as it
    # was sent. Setting a tolerance on a site that has no altitude is refused
    # here rather than at the constraint.
    if "altitude_tolerance_m" in updates and updates["altitude_tolerance_m"] is not None:
        resulting_altitude = updates.get("altitude_m")
        if resulting_altitude is None:
            resulting_altitude = await pool.fetchval(
                "SELECT altitude_m FROM staging.pahchan_sites "
                "WHERE id=$1::uuid AND org_id=$2::uuid",
                str(site_id), org_id,
            )
        if resulting_altitude is None:
            raise HTTPException(
                400,
                "A vertical tolerance needs an altitude to be a tolerance of. "
                "Set the site's altitude in the same change, or leave both blank "
                "to skip the check.",
            )

    sets, params, idx = [], [str(site_id), org_id], 3
    for k, v in updates.items():
        sets.append(f"{k}=${idx}")
        params.append(v)
        idx += 1

    row = await pool.fetchrow(
        f"UPDATE staging.pahchan_sites SET {', '.join(sets)} "
        f" WHERE id=$1::uuid AND org_id=$2::uuid "
        f" RETURNING id, name, lat, lng, radius_m, altitude_m, "
        f"           altitude_tolerance_m, is_active",
        *params,
    )
    if not row:
        raise HTTPException(404, "Site not found")
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
    # `fetchrow`, not `SELECT 1` — the row also answers who the employee's
    # LOGIN is for the event below, and a Record stays truthy when `user_id`
    # is NULL (not every employee has a login), so the 404 behaves as before.
    emp = await pool.fetchrow(
        "SELECT user_id FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
        str(body.employee_id), org_id,
    )
    if not emp:
        raise HTTPException(404, "Employee not found")

    # DPDP: consent that was declined must not be overridden by a later
    # enrollment attempt, from any source — HR upload included. This is not
    # a setting because there is no compliant "enforced off" for it; it is
    # the floor, not a guardrail a firm opts into.
    if await _employee_opted_out(pool, str(body.employee_id)):
        raise HTTPException(
            409,
            "This employee has declined biometric attendance and must be offered "
            "the alternative (manual or code-based) attendance path instead. "
            "See Pahchan → consent records.",
        )

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
            # ── ENROLLMENT IS AN EVENT, AND THE EMPLOYEE IS THE ENTITY ──────
            # `enrollment.requested` rides the insert's transaction. DPDP: the
            # photo row's object key is biometric material and never rides —
            # the arguments are the employee, the method (the row's `source`
            # column: 'hr_upload' | 'self_capture') and the employee's login,
            # nothing about the image itself.
            await enrollment_requested(
                conn, org_id=org_id, actor_id=user["user_id"],
                employee_id=str(body.employee_id), method=row["source"],
                employee_user_id=emp["user_id"],
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
        # EVERY NAME ON THIS LIST IS A JOB FOR SOMEBODY. It is not a count, it
        # is HR being asked to collect two face photographs from each of these
        # people — so counting `is_active = TRUE` alone put ten E2E employees
        # who left between 7 July and 3 August (measured 2026-08-26: 83 names,
        # 73 of them still employed) on a queue nobody can ever clear.
        #
        # THE FLAG IS NOT STALE DATA AND MUST NOT BE CLEARED TO FIX THIS.
        # `routers/manav.py:1958`: offboarding used to set `is_active=FALSE`,
        # which dropped the person out of payroll the same day and left an
        # outstanding salary advance unrecoverable. A leaver keeps the flag
        # until settlement on purpose; `manav_offboarding.last_working_day` is
        # the fact that answers whether they are still here.
        #
        # Imported from `services/on_the_rolls.py` rather than written out
        # again — one spelling of this predicate is the entire point of that
        # module, and a second one here would drift away from payroll's without
        # anything failing. A stock as at today, so it bounds on today.
        #
        # The pending-approval list above is deliberately NOT guarded: it holds
        # photographs somebody actually captured, each awaiting a decision, and
        # hiding one because its subject has since left leaves an unadjudicated
        # photograph in storage that nobody sees until retention deletes it.
        "SELECT e.id AS employee_id, e.name AS employee_name, e.employee_code, "
        "       COUNT(r.id) FILTER (WHERE r.approved_at IS NOT NULL) AS approved_count "
        "FROM staging.manav_employees e "
        "LEFT JOIN staging.pahchan_enrollment_photos r "
        "       ON r.employee_id = e.id AND r.replaced_at IS NULL "
        "WHERE e.org_id=$1::uuid AND e.is_active = TRUE"
        + still_on_the_rolls("e") +
        " GROUP BY e.id, e.name, e.employee_code "
        "HAVING COUNT(r.id) FILTER (WHERE r.approved_at IS NOT NULL) < 2 "
        "ORDER BY e.name",
        org_id,
    )
    return {
        "pending_approval": [dict(r) for r in pending],
        "incomplete": [dict(r) for r in missing],
    }


# ── Scoped policy: the same settings, for one site, category or person ───────


class PolicyScopeBody(BaseModel):
    """A partial override for one scope.

    `overrides` carries ONLY the keys this scope changes. That is the whole
    design decision and migration 196 argues it out: a full policy copy per
    scope would freeze every other setting at the value it had when the override
    was written, so an org that later shortened its grace period firm-wide would
    find one site silently keeping the old one — with the screen showing the new
    value and the punch judged by the old.
    """
    scope_kind: str = Field(..., pattern="^(site|category|employee)$")
    scope_ref: str = Field(..., min_length=1, max_length=200)
    overrides: dict
    note: Optional[str] = Field(None, max_length=400)


def _validated_overrides(raw: dict) -> dict:
    """The keys an override may carry, refused with a sentence.

    The same list is a CHECK constraint on the table. Both, deliberately: the
    constraint is what stops a bad row existing whatever writes it, and this is
    what gives the person filling in the form something they can act on instead
    of a constraint name.
    """
    if not isinstance(raw, dict) or not raw:
        raise HTTPException(
            400, "An override has to change something. Choose at least one setting.",
        )

    refused = sorted(set(raw) - POLICY_OVERRIDABLE_KEYS)
    if refused:
        raise HTTPException(
            400,
            f"These settings are the same for everybody in the organisation and "
            f"cannot be set per site, category or person: {', '.join(refused)}. "
            "Retention is quoted to every employee in one privacy notice, so a "
            "different window for different people would make that notice wrong "
            "for somebody by construction.",
        )
    return {k: raw[k] for k in raw}


@router.get("/policy/scopes")
async def list_policy_scopes(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Every override this org has, with the site or person it names.

    The label is resolved HERE rather than on the client, because the client
    must never be handed an id to render — `scope_ref` holds a uuid for the
    `site` and `employee` kinds, and the screen shows a name.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT o.id, o.scope_kind, o.scope_ref, o.overrides, o.note,
                  o.created_at, o.updated_at,
                  CASE o.scope_kind
                       WHEN 'site'     THEN s.name
                       WHEN 'employee' THEN e.name
                       ELSE o.scope_ref
                  END AS scope_label
             FROM staging.pahchan_policy_overrides o
             LEFT JOIN staging.pahchan_sites s
                    ON o.scope_kind = 'site'
                   AND s.org_id = o.org_id
                   AND s.id::text = o.scope_ref
             LEFT JOIN staging.manav_employees e
                    ON o.scope_kind = 'employee'
                   AND e.org_id = o.org_id
                   AND e.id::text = o.scope_ref
            WHERE o.org_id = $1::uuid
            ORDER BY array_position(ARRAY['site','category','employee']::text[],
                                    o.scope_kind),
                     scope_label""",
        org_id,
    )
    out = []
    for r in rows:
        d = dict(r)
        # A scope whose site or employee has been deleted. The row is shown
        # rather than hidden — an override that has stopped applying is exactly
        # the thing an admin wants to find and remove — but it is labelled as
        # what it is, and never as a bare id.
        if d["scope_label"] is None:
            d["scope_label"] = "(no longer exists)"
            d["orphaned"] = True
        else:
            d["orphaned"] = False
        out.append(d)
    return {"data": out}


@router.put("/policy/scopes")
async def upsert_policy_scope(
    body: PolicyScopeBody,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Create or replace one scope's override.

    PUT and not PATCH, and the distinction matters: `overrides` REPLACES the
    scope's whole override set. An admin who removes a key from the form means
    "this scope no longer overrides that", and a merge would leave it silently
    in force — the same failure the partial-override design exists to avoid, one
    level down.

    A scope naming something that does not exist is refused. The resolver treats
    an orphan as matching nothing, which is right for a site deleted AFTER the
    override was written and quite wrong as a way to CREATE one: an override
    that has never applied to anything is a setting somebody believes is in
    force.
    """
    overrides = _validated_overrides(body.overrides)
    pool = await get_pool()

    if body.scope_kind == "site":
        exists = await pool.fetchval(
            "SELECT 1 FROM staging.pahchan_sites WHERE id=$1::uuid AND org_id=$2::uuid",
            body.scope_ref, org_id,
        )
        if not exists:
            raise HTTPException(404, "No such site in this organisation")
    elif body.scope_kind == "employee":
        exists = await pool.fetchval(
            "SELECT 1 FROM staging.manav_employees WHERE id=$1::uuid AND org_id=$2::uuid",
            body.scope_ref, org_id,
        )
        if not exists:
            raise HTTPException(404, "No such employee in this organisation")
    else:
        # A category is a value of `manav_employees.employment_type`, not a row,
        # so "does it exist" means "does anybody in this org have it". Refusing
        # an unused category stops a typo becoming an override that never fires.
        exists = await pool.fetchval(
            "SELECT 1 FROM staging.manav_employees "
            "WHERE org_id=$1::uuid AND employment_type=$2 LIMIT 1",
            org_id, body.scope_ref,
        )
        if not exists:
            raise HTTPException(
                404,
                f"No employee in this organisation has the employment type "
                f"'{body.scope_ref}', so an override for it would never apply.",
            )

    row = await pool.fetchrow(
        """INSERT INTO staging.pahchan_policy_overrides
               (org_id, scope_kind, scope_ref, overrides, note, created_by, updated_by)
           VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $6)
           ON CONFLICT (org_id, scope_kind, scope_ref) DO UPDATE SET
               overrides  = EXCLUDED.overrides,
               note       = EXCLUDED.note,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()
        RETURNING id, scope_kind, scope_ref, overrides, note, updated_at""",
        org_id, body.scope_kind, body.scope_ref, json.dumps(overrides),
        body.note, user["user_id"],
    )

    # Audited at warn, like the org-level retention change above and for the
    # same reason: this decides how somebody's attendance is judged, and who
    # decided it has to survive. `scope_ref` is in the detail rather than in any
    # response the client renders.
    audit(
        "pahchan.policy_scope_set",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_policy_scope",
        resource_id=str(row["id"]),
        detail={"scope_kind": body.scope_kind, "scope_ref": body.scope_ref,
                "keys": sorted(overrides)},
        severity="warn",
    )
    return dict(row)


@router.delete("/policy/scopes/{scope_id}")
async def delete_policy_scope(
    scope_id: UUID,
    request: Request,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
    _r=Depends(_review_gate),
):
    """Remove an override. The scope falls back to the level above it.

    A real DELETE rather than a soft one: unlike a site, an override names no
    punch and no history. Nothing points at it, so removing it orphans nothing —
    and an override kept as a tombstone is a rule an admin can see and cannot
    tell is inactive.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        "DELETE FROM staging.pahchan_policy_overrides "
        " WHERE id=$1::uuid AND org_id=$2::uuid "
        " RETURNING scope_kind, scope_ref",
        str(scope_id), org_id,
    )
    if not row:
        raise HTTPException(404, "No such policy override in this organisation")

    audit(
        "pahchan.policy_scope_removed",
        request,
        org_id=org_id,
        user_id=user["user_id"],
        resource_type="pahchan_policy_scope",
        resource_id=str(scope_id),
        detail={"scope_kind": row["scope_kind"], "scope_ref": row["scope_ref"]},
        severity="warn",
    )
    return {"status": "removed", "scope_kind": row["scope_kind"]}


@router.get("/policy/effective")
async def effective_policy(
    employee_id: Optional[UUID] = None,
    site_id: Optional[UUID] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """What the policy RESOLVES to for a given person at a given site.

    Four levels merging key by key is easy to get wrong in one's head, and an
    admin who cannot see the answer will not trust the overrides. This is the
    same `_resolve_policy` the punch path runs — not a second implementation of
    the merge, which is how the screen and the engine come to disagree.
    """
    pool = await get_pool()
    employee = None
    if employee_id:
        employee = await pool.fetchrow(
            "SELECT id, name, employment_type FROM staging.manav_employees "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(employee_id), org_id,
        )
        if not employee:
            raise HTTPException(404, "No such employee in this organisation")

    resolved = await _resolve_policy(
        pool, org_id,
        employee=dict(employee) if employee else None,
        site_id=str(site_id) if site_id else None,
    )
    return {
        "policy": resolved,
        # Which levels were consulted, so the answer is explicable rather than
        # merely correct. Names, never ids.
        "scoped_by": {
            "site": bool(site_id),
            "category": bool(employee and employee["employment_type"]),
            "employee": bool(employee),
        },
        "employee": employee["name"] if employee else None,
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
