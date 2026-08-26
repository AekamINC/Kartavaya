"""Phase 2.6 — the geofence and offline metrics compute instead of refusing.

WHAT WAS WRONG. Both metrics shipped as `absent_metric(...)`, so
/api/v1/analytics/run answered **422 with an "impossible" reason** for anyone
who asked. The reason given was that `migrations/PROPOSED_064_pahchan.sql` is
not applied. It is applied. Two proposals flagged this and neither acted, and
this suite's own `test_absent_reasons_name_the_unapplied_migration` was
REQUIRING the stale sentence, which is how it survived a release.

THE LIVE EVIDENCE these tests stand on — `railway run -e staging -s Kartavya`,
READ ONLY transaction, 2026-08-25. Every statement was a SELECT; nothing was
written to a database that staging and production share.

    SELECT lat, lng, distance_m, geofence_id, flags
      FROM staging.pahchan_punches LIMIT 1;
    -> lat=23.0365700  lng=72.5288000  distance_m=47.00
       geofence_id=d1000000-…-0001  flags={}

    SELECT COUNT(*) AS total, COUNT(lat), COUNT(lng), COUNT(distance_m),
           COUNT(geofence_id), COUNT(*) FILTER (WHERE flags <> '{}')
      FROM staging.pahchan_punches;
    -> 699 rows, and lat/lng/distance_m/geofence_id populated on ALL 699.
       68 carry a flag: accuracy 41, offline 26, geo 2.

    staging.pahchan_sites  ->  9 rows, lat/lng NOT NULL, radius_m 120-200
    staging.pahchan_policy ->  2 rows, grace_minutes 10-15

THE SHIPPED SQL, EXECUTED AGAINST THAT SCHEMA (the mock pool below accepts any
string, so validity is proven by hand, per test_analytics_registry.py's own
note). Both builders were run read-only over 2026-06-01..2026-08-31 in every
bucket. `pahchan.geofence_exceptions`, monthly:

    period=2026-06-01 value=0 punches=230 beyond_radius=0 unresolved=0 max=89.0
    period=2026-07-01 value=0 punches=425 beyond_radius=0 unresolved=0 max=89.0
    period=2026-08-01 value=2 punches=44  beyond_radius=2 unresolved=0 max=240.0

`pahchan.offline_reconciliation`, monthly:

    period=2026-07-01 value=26 offline_punches=26 late_sync=0 max_lag_hours=0.0008

Bound to an org id that cannot exist, both return ZERO ROWS — never a
{value: null} shape. Those are the rows fed to the recording pool below, so
the payload asserted here is the payload the live database produced.
"""
import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from analytics.registry import REGISTRY, MetricRequest, load_all
from analytics.windowing import BUCKETS
from routers import analytics as ax
from services.analytics_window import Window

load_all()

WIN = Window(date(2026, 6, 1), date(2026, 8, 31))
ORG = "22222222-2222-2222-2222-222222222222"
USER = {"user_id": "11111111-1111-1111-1111-111111111111"}
FROM, TO = "2026-06-01", "2026-08-31"

GEOFENCE = "pahchan.geofence_exceptions"
OFFLINE = "pahchan.offline_reconciliation"

#: Verbatim from the live probe recorded above.
LIVE_GEOFENCE_ROWS = [
    {"period": date(2026, 6, 1), "value": 0, "punches": 230,
     "beyond_radius": 0, "unresolved": 0, "max_distance_m": 89.0},
    {"period": date(2026, 7, 1), "value": 0, "punches": 425,
     "beyond_radius": 0, "unresolved": 0, "max_distance_m": 89.0},
    {"period": date(2026, 8, 1), "value": 2, "punches": 44,
     "beyond_radius": 2, "unresolved": 0, "max_distance_m": 240.0},
]
LIVE_OFFLINE_ROWS = [
    {"period": date(2026, 7, 1), "value": 26, "offline_punches": 26,
     "late_sync": 0, "max_lag_hours": 0.0008333333333333333},
]


def build(key: str, bucket: str = "month"):
    sql, params = REGISTRY[key].sql(
        MetricRequest(org_id=ORG, window=WIN, bucket=bucket)
    )
    return " ".join(sql.split()), params


class RecordingPool:
    """Same double as test_analytics_run.py — it records, it never validates."""

    def __init__(self, rows):
        self.calls = []
        self._rows = rows

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._rows


class FakeRequest:
    class _State:
        _auth_user = {"user_id": "u-1"}

    state = _State()
    method = "GET"


def call_run(monkeypatch, key, rows, **kw):
    """Drive the real /run coroutine over a pool seeded with the live rows."""
    pool = RecordingPool(rows)

    async def _get_pool():
        return pool

    def _require_module(code):
        async def _check(request, org_id):
            return None
        return _check

    monkeypatch.setattr(ax, "get_pool", _get_pool)
    monkeypatch.setattr(ax, "require_module", _require_module)
    payload = asyncio.run(
        ax.run(FakeRequest(), metric=key, date_from=FROM, date_to=TO,
               user=USER, org_id=ORG, **kw)
    )
    return payload, pool


# ── the fault itself ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("key", [GEOFENCE, OFFLINE])
def test_the_metric_no_longer_declares_itself_impossible(key):
    """The registry-level fault: `absent` set is what makes /run answer 422."""
    m = REGISTRY[key]
    assert m.absent is None, (
        f"{key} still refuses to compute: {m.absent!r} — but the columns it "
        "names were read out of the live database on 2026-08-25"
    )
    assert m.sql is not None


@pytest.mark.parametrize("key,rows", [(GEOFENCE, LIVE_GEOFENCE_ROWS),
                                      (OFFLINE, LIVE_OFFLINE_ROWS)])
def test_run_returns_numbers_where_it_used_to_raise_the_impossible_sentinel(
    monkeypatch, key, rows
):
    """End to end through the route: the 422 is gone and every row's `value`
    is a real number. This is the acceptance line of Phase 2.6 — "the
    geofence/distance metrics return numbers instead of an 'impossible'
    sentinel" — asserted on the rows the live database actually returned."""
    payload, _ = call_run(monkeypatch, key, rows)

    assert payload["metric"] == key
    assert payload["unit"] == "count" and payload["grain"] == "flow"
    assert payload["data"], "a metric that answers must answer with rows"
    for row in payload["data"]:
        assert isinstance(row["value"], (int, float)), row
        assert not isinstance(row["value"], bool), row
        assert row["value"] >= 0, row

    # The specific numbers the live probe produced, carried through unharmed.
    assert [r["value"] for r in payload["data"]] == [r["value"] for r in rows]


@pytest.mark.parametrize("key", [GEOFENCE, OFFLINE])
def test_the_route_cannot_be_made_to_raise_422_for_these_two(monkeypatch, key):
    """The regression guard: re-declaring either as absent puts the 422 back,
    and /run's absent branch is the ONLY thing that produces it."""
    try:
        call_run(monkeypatch, key, [])
    except HTTPException as exc:  # pragma: no cover - this is the failure
        raise AssertionError(f"{key} raised {exc.status_code}: {exc.detail}")


# ── the columns, on the tables they were proven on ───────────────────────────

def test_geofence_sql_reads_the_five_columns_verified_live():
    """lat/lng are on BOTH pahchan_punches and pahchan_sites; distance_m,
    geofence_id and flags are on pahchan_punches; radius_m is on
    pahchan_sites. All read out of information_schema on 2026-08-25."""
    sql, params = build(GEOFENCE)
    assert "FROM staging.pahchan_punches p" in sql
    assert "LEFT JOIN staging.pahchan_sites s ON s.id = p.geofence_id" in sql
    for col in ("p.flags", "p.distance_m", "p.geofence_id", "s.radius_m"):
        assert col in sql, col
    assert params == [ORG, WIN.start, WIN.end]


def test_offline_sql_reads_the_capture_versus_receipt_timeline():
    sql, _ = build(OFFLINE)
    assert "FROM staging.pahchan_punches p" in sql
    assert "p.source = 'offline'" in sql
    assert "p.received_at - p.captured_at <= INTERVAL '72 hours'" in sql


# ── the definitions, so a rewrite has to argue with a test ───────────────────

def test_geofence_headline_is_the_capture_time_verdict_not_todays_radius():
    """The 'geo' flag is what the write path stamped when the punch was taken;
    distance_m > radius_m re-judges it against the radius as it stands now.
    Both ship, because the two disagreeing means a geofence moved under
    recorded history — collapsing them would hide that."""
    sql, _ = build(GEOFENCE)
    assert "COUNT(*) FILTER (WHERE 'geo' = ANY(p.flags)) AS value" in sql
    assert "COUNT(*) FILTER (WHERE p.distance_m > s.radius_m) AS beyond_radius" in sql
    # A punch with no site is judged as neither in nor out.
    assert "COUNT(*) FILTER (WHERE p.geofence_id IS NULL) AS unresolved" in sql
    assert "AVG(" not in sql


def test_offline_splits_reconciled_from_late_and_never_averages():
    sql, _ = build(OFFLINE)
    assert "AS value" in sql and "AS offline_punches" in sql
    assert "AS late_sync" in sql and "AS max_lag_hours" in sql
    assert "AVG(" not in sql


def test_offline_returns_no_row_for_a_bucket_that_had_nothing_to_reconcile():
    """A bucket of purely live punches has no offline punch in it, and
    '0 reconciled' there reads as a failure rather than as an absence of the
    case — proposal 62 §10, no convincing zeros."""
    sql, _ = build(OFFLINE)
    assert "HAVING COUNT(*) FILTER (WHERE p.source = 'offline') > 0" in sql


def test_geofence_ships_a_true_zero_because_no_exceptions_is_the_good_news():
    """The opposite call from offline's, deliberately: a bucket WITH punches
    and no exceptions is a real, useful zero — the live June and July rows are
    exactly that — so geofence_exceptions carries no HAVING. A bucket with no
    punches at all still returns nothing, because there is nothing to group."""
    sql, _ = build(GEOFENCE)
    assert "HAVING" not in sql
    assert 0 in [r["value"] for r in LIVE_GEOFENCE_ROWS]


# ── house rules, restated on the punch table ─────────────────────────────────

@pytest.mark.parametrize("key", [GEOFENCE, OFFLINE])
def test_the_day_is_cut_in_ist_not_the_sessions_utc(key):
    """staging.pahchan_punches.captured_at is timestamptz and the live session
    runs UTC, so a 04:00 IST punch is 22:30 UTC the PREVIOUS day. Truncating
    in UTC would file an early shift under the wrong day, week and month —
    and the same expression bounds the window, so the end date is whole rather
    than cut at midnight UTC."""
    for bucket in sorted(BUCKETS):
        sql, _ = build(key, bucket=bucket)
        assert (
            f"date_trunc('{bucket}', (p.captured_at AT TIME ZONE 'Asia/Kolkata'))::date"
        ) in sql, (key, bucket)
        assert (
            "(p.captured_at AT TIME ZONE 'Asia/Kolkata')::date "
            "BETWEEN $2::date AND $3::date"
        ) in sql, (key, bucket)
    # received_at is never the punch's time (07 §4): a punch captured 09:41 and
    # synced 11:38 is a 09:41 punch.
    assert "date_trunc('month', (p.received_at" not in build(key)[0]


@pytest.mark.parametrize("key", [GEOFENCE, OFFLINE])
def test_dpdp_the_punch_table_carries_employee_id_and_it_never_escapes(key):
    """staging.pahchan_punches has an employee_id column — unlike the tables
    the older pahchan metrics read, one careless SELECT here would put a
    person in an analytics response. Attendance detail is god-mode-only by
    design (project_pahchan_dpdp_access); analytics must not be the side
    door."""
    sql, _ = build(key)
    assert "employee_id" not in sql
    assert "photo_key" not in sql, "a face-photo key is not an analytics column"
    for banned in ("reviewed_by", "client_punch_id", "p.lat", "p.lng"):
        assert banned not in sql, f"{key}: {banned} is per-person detail"
    assert REGISTRY[key].drill is None
    assert REGISTRY[key].dimensions == ()


@pytest.mark.parametrize("key", [GEOFENCE, OFFLINE])
def test_org_scoped_and_cast_and_fully_bound(key):
    sql, params = build(key)
    assert "WHERE p.org_id = $1::uuid" in sql
    assert params == [ORG, WIN.start, WIN.end]
