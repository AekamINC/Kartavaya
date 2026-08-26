"""
Unit tests for routers/attendance.py — self-service clock in/out.

Coverage:
  GET  /api/attendance/me/today   — punch state for today
  POST /api/attendance/clock-in   — open a shift, with and without a geo fix
  POST /api/attendance/clock-out  — close a shift
  GET  /api/attendance/me         — history
"""

ENTRY_OPEN = {
    "entry_id": "att_000000000001",
    "user_id": "user_admin001",
    "work_date": "2026-08-26",
    "clock_in_at": "2026-08-26T03:30:00Z",
    "clock_out_at": None,
    "minutes": None,
    "in_latitude": 23.0225,
    "in_longitude": 72.5714,
    "in_altitude": 53.4,
    "in_accuracy_m": 12.0,
    "in_altitude_accuracy_m": 3.5,
    "in_source": "ios-pwa",
    "out_latitude": None,
    "out_longitude": None,
    "out_altitude": None,
    "out_accuracy_m": None,
    "out_altitude_accuracy_m": None,
    "out_source": None,
}

ENTRY_CLOSED = {
    **ENTRY_OPEN,
    "clock_out_at": "2026-08-26T12:30:00Z",
    "minutes": 540,
    "out_latitude": 23.0230,
    "out_longitude": 72.5720,
    "out_altitude": 55.1,
    "out_accuracy_m": 9.0,
    "out_altitude_accuracy_m": 4.0,
    "out_source": "ios-pwa",
}

GEO = {
    "latitude": 23.0225,
    "longitude": 72.5714,
    "altitude": 53.4,
    "accuracy": 12.0,
    "altitude_accuracy": 3.5,
    "source": "ios-pwa",
}


# ── Today ────────────────────────────────────────────────────────

async def test_today_when_never_punched(api_client, mock_pool, as_member):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.get("/api/attendance/me/today")
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "out"
    assert body["entry"] is None


async def test_today_when_clocked_in(api_client, mock_pool, as_member):
    mock_pool.fetchrow.return_value = ENTRY_OPEN
    resp = await api_client.get("/api/attendance/me/today")
    assert resp.status_code == 200
    body = resp.json()
    assert body["state"] == "in"
    assert body["entry"]["clock_in_location"]["altitude"] == 53.4
    assert body["entry"]["clock_out_location"] is None


async def test_today_when_shift_finished(api_client, mock_pool, as_member):
    mock_pool.fetchrow.return_value = ENTRY_CLOSED
    resp = await api_client.get("/api/attendance/me/today")
    assert resp.status_code == 200
    assert resp.json()["state"] == "done"


# ── Clock in ─────────────────────────────────────────────────────

async def test_clock_in_with_geo(api_client, mock_pool, as_member):
    mock_pool.fetchrow.side_effect = [None, ENTRY_OPEN]
    resp = await api_client.post("/api/attendance/clock-in", json=GEO)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "clocked_in"
    loc = body["entry"]["clock_in_location"]
    assert (loc["latitude"], loc["longitude"], loc["altitude"]) == (23.0225, 72.5714, 53.4)
    assert loc["source"] == "ios-pwa"


async def test_clock_in_without_geo_is_allowed(api_client, mock_pool, as_member):
    """A denied location permission must never block recording a shift."""
    no_geo = {**ENTRY_OPEN, "in_latitude": None, "in_longitude": None,
              "in_altitude": None, "in_accuracy_m": None,
              "in_altitude_accuracy_m": None, "in_source": None}
    mock_pool.fetchrow.side_effect = [None, no_geo]
    resp = await api_client.post("/api/attendance/clock-in")
    assert resp.status_code == 200
    assert resp.json()["entry"]["clock_in_location"] is None


async def test_clock_in_twice_is_rejected(api_client, mock_pool, as_member):
    mock_pool.fetchrow.return_value = {"entry_id": "att_1", "clock_out_at": None}
    resp = await api_client.post("/api/attendance/clock-in", json=GEO)
    assert resp.status_code == 409
    assert "Already clocked in" in resp.json()["detail"]


async def test_clock_in_after_clock_out_is_rejected(api_client, mock_pool, as_member):
    mock_pool.fetchrow.return_value = {"entry_id": "att_1", "clock_out_at": "2026-08-26T12:30:00Z"}
    resp = await api_client.post("/api/attendance/clock-in", json=GEO)
    assert resp.status_code == 409
    assert "Already clocked out" in resp.json()["detail"]


async def test_clock_in_rejects_out_of_range_latitude(api_client, mock_pool, as_member):
    resp = await api_client.post("/api/attendance/clock-in", json={**GEO, "latitude": 120})
    assert resp.status_code == 422


async def test_clock_in_forbidden_for_clients(api_client, mock_pool, as_client_user):
    resp = await api_client.post("/api/attendance/clock-in", json=GEO)
    assert resp.status_code == 403


async def test_clock_in_normalises_unknown_source(api_client, mock_pool, as_member):
    mock_pool.fetchrow.side_effect = [None, ENTRY_OPEN]
    resp = await api_client.post("/api/attendance/clock-in", json={**GEO, "source": "hax"})
    assert resp.status_code == 200
    # The unknown source is coerced to 'browser' before it reaches the INSERT.
    assert mock_pool.fetchrow.await_args.args[-1] == "browser"


# ── Clock out ────────────────────────────────────────────────────

async def test_clock_out(api_client, mock_pool, as_member):
    mock_pool.fetchrow.side_effect = [{"entry_id": "att_000000000001"}, ENTRY_CLOSED]
    resp = await api_client.post("/api/attendance/clock-out", json=GEO)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "clocked_out"
    assert body["entry"]["minutes"] == 540
    assert body["entry"]["clock_out_location"]["latitude"] == 23.0230


async def test_clock_out_without_clock_in(api_client, mock_pool, as_member):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.post("/api/attendance/clock-out", json=GEO)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Not clocked in"


async def test_clock_out_forbidden_for_clients(api_client, mock_pool, as_client_user):
    resp = await api_client.post("/api/attendance/clock-out", json=GEO)
    assert resp.status_code == 403


# ── History ──────────────────────────────────────────────────────

async def test_my_history(api_client, mock_pool, as_member):
    mock_pool.fetch.return_value = [ENTRY_CLOSED, ENTRY_CLOSED]
    resp = await api_client.get("/api/attendance/me")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["entries"]) == 2
    assert body["total_minutes"] == 1080


async def test_my_history_with_date_range(api_client, mock_pool, as_member):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/attendance/me?date_from=2026-08-01&date_to=2026-08-26")
    assert resp.status_code == 200
    # user_id + both dates are passed as bound parameters, never interpolated.
    assert mock_pool.fetch.await_args.args[1:] == ("user_mem001", "2026-08-01", "2026-08-26")
