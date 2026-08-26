"""
attendance.py — self-service clock in / clock out with geolocation.

Lets an employee record their own shift from any browser: iOS Safari, the
installed home-screen PWA, Android, or desktop. No native app required.

Design notes
------------
- Timestamps are always NOW() on the server. The client supplies geolocation
  only; it never supplies the time, so a wrong or tampered device clock
  cannot shift a shift.
- work_date is the IST calendar date at the moment of clock-in. A shift that
  runs past midnight still belongs to the day it started.
- Geolocation is optional. If the employee denies the permission or the fix
  times out, the punch is still recorded with NULL coordinates — attendance
  must never be blocked by a GPS failure.

Table: attendance_entries (migrations/010_attendance.sql)
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_router import require_user
from db import get_pool

router = APIRouter(prefix="/api/attendance", tags=["attendance"])

IST = timezone(timedelta(hours=5, minutes=30))

# Sources the UI may declare. Anything else is stored as 'browser'.
_VALID_SOURCES = frozenset({"ios-pwa", "android-pwa", "browser", "app"})


class GeoFix(BaseModel):
    """A W3C GeolocationCoordinates reading, as sent by the browser.

    Field names mirror `position.coords` so the frontend can forward the
    reading with minimal reshaping. Everything is optional: iOS reports
    `altitude` as null on most devices when the fix comes from wifi rather
    than GPS, and the whole object is absent when permission is denied.
    """
    latitude:  Optional[float] = Field(None, ge=-90,  le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    altitude:  Optional[float] = None
    accuracy:  Optional[float] = Field(None, ge=0)
    altitude_accuracy: Optional[float] = Field(None, ge=0)
    source:    Optional[str] = None


def _source(geo: Optional[GeoFix]) -> Optional[str]:
    if geo is None or not geo.source:
        return None
    return geo.source if geo.source in _VALID_SOURCES else "browser"


def _coords(geo: Optional[GeoFix]) -> tuple:
    """Flatten a GeoFix into the column order used by both punch statements."""
    if geo is None:
        return (None, None, None, None, None, None)
    return (
        geo.latitude, geo.longitude, geo.altitude,
        geo.accuracy, geo.altitude_accuracy, _source(geo),
    )


def _today_ist() -> date:
    """The IST calendar date for the current instant."""
    return datetime.now(IST).date()


def _row(entry) -> dict:
    """Serialize an attendance row for the client."""
    if entry is None:
        return None
    d = dict(entry)
    return {
        "entry_id":     d.get("entry_id"),
        "work_date":    d.get("work_date"),
        "clock_in_at":  d.get("clock_in_at"),
        "clock_out_at": d.get("clock_out_at"),
        "minutes":      d.get("minutes"),
        "clock_in_location":  _location(d, "in"),
        "clock_out_location": _location(d, "out"),
    }


def _location(d: dict, prefix: str) -> Optional[dict]:
    lat = d.get(f"{prefix}_latitude")
    lng = d.get(f"{prefix}_longitude")
    if lat is None and lng is None:
        return None
    return {
        "latitude":  lat,
        "longitude": lng,
        "altitude":  d.get(f"{prefix}_altitude"),
        "accuracy":  d.get(f"{prefix}_accuracy_m"),
        "altitude_accuracy": d.get(f"{prefix}_altitude_accuracy_m"),
        "source":    d.get(f"{prefix}_source"),
    }


def _deny_clients(user: dict) -> None:
    if user.get("role") == "client":
        raise HTTPException(403, "Clients cannot record attendance")


_SELECT_COLS = """
    entry_id, user_id, work_date, clock_in_at, clock_out_at, minutes,
    in_latitude,  in_longitude,  in_altitude,  in_accuracy_m,  in_altitude_accuracy_m,  in_source,
    out_latitude, out_longitude, out_altitude, out_accuracy_m, out_altitude_accuracy_m, out_source
"""


@router.get("/me/today")
async def my_today(pool=Depends(get_pool), user=Depends(require_user)):
    """Today's punch state — drives whether the UI shows Clock In or Clock Out."""
    work_date = _today_ist()
    row = await pool.fetchrow(
        f"SELECT {_SELECT_COLS} FROM attendance_entries WHERE user_id=$1 AND work_date=$2",
        user["user_id"], work_date,
    )
    entry = _row(row)
    return {
        "work_date": work_date,
        "server_time": datetime.now(timezone.utc),
        "state": "out" if entry is None else ("in" if entry["clock_out_at"] is None else "done"),
        "entry": entry,
    }


@router.post("/clock-in")
async def clock_in(
    geo: Optional[GeoFix] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Open today's shift. Idempotent-ish: a second call while already clocked
    in is rejected rather than silently overwriting the original punch time."""
    _deny_clients(user)
    work_date = _today_ist()

    existing = await pool.fetchrow(
        "SELECT entry_id, clock_out_at FROM attendance_entries WHERE user_id=$1 AND work_date=$2",
        user["user_id"], work_date,
    )
    if existing is not None:
        if existing["clock_out_at"] is None:
            raise HTTPException(409, "Already clocked in today")
        raise HTTPException(409, "Already clocked out for today")

    lat, lng, alt, acc, alt_acc, src = _coords(geo)
    row = await pool.fetchrow(
        f"""
        INSERT INTO attendance_entries
          (user_id, work_date, clock_in_at,
           in_latitude, in_longitude, in_altitude,
           in_accuracy_m, in_altitude_accuracy_m, in_source)
        VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8)
        RETURNING {_SELECT_COLS}
        """,
        user["user_id"], work_date, lat, lng, alt, acc, alt_acc, src,
    )
    return {"status": "clocked_in", "entry": _row(row)}


@router.post("/clock-out")
async def clock_out(
    geo: Optional[GeoFix] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """Close today's open shift and stamp the elapsed minutes."""
    _deny_clients(user)
    work_date = _today_ist()

    open_entry = await pool.fetchrow(
        "SELECT entry_id FROM attendance_entries "
        "WHERE user_id=$1 AND work_date=$2 AND clock_out_at IS NULL",
        user["user_id"], work_date,
    )
    if open_entry is None:
        raise HTTPException(409, "Not clocked in")

    lat, lng, alt, acc, alt_acc, src = _coords(geo)
    row = await pool.fetchrow(
        f"""
        UPDATE attendance_entries
        SET clock_out_at = NOW(),
            minutes = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - clock_in_at))::int / 60),
            out_latitude = $2, out_longitude = $3, out_altitude = $4,
            out_accuracy_m = $5, out_altitude_accuracy_m = $6, out_source = $7,
            updated_at = NOW()
        WHERE entry_id = $1
        RETURNING {_SELECT_COLS}
        """,
        open_entry["entry_id"], lat, lng, alt, acc, alt_acc, src,
    )
    return {"status": "clocked_out", "entry": _row(row)}


@router.get("/me")
async def my_history(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    pool=Depends(get_pool),
    user=Depends(require_user),
):
    """The caller's own punch history, newest first. Defaults to 30 days."""
    filters, vals = ["user_id = $1"], [user["user_id"]]
    if date_from:
        filters.append(f"work_date >= ${len(vals) + 1}::date")
        vals.append(date_from)
    if date_to:
        filters.append(f"work_date <= ${len(vals) + 1}::date")
        vals.append(date_to)

    rows = await pool.fetch(
        f"SELECT {_SELECT_COLS} FROM attendance_entries "
        f"WHERE {' AND '.join(filters)} ORDER BY work_date DESC LIMIT 180",
        *vals,
    )
    entries = [_row(r) for r in rows]
    return {
        "entries": entries,
        "total_minutes": sum(e["minutes"] or 0 for e in entries),
    }
