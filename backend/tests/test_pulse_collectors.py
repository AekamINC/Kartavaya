"""The two owner-approved Pulse collectors (proposal 68): surface/OS at
login and the phone app's version header. Nothing else was approved — in
particular NO IP or geolocation collection of any kind — and the assertions
here hold the mechanism to exactly that shape.

The contract under test, in order of how much it matters:

  · a RAISING recorder still returns the caller their token — collection may
    never break a login, and that guarantee is proved by breaking it;
  · the raw User-Agent string never appears in any Pulse INSERT's SQL or
    bind values — only the parsed enums travel;
  · the parser is total: real UA strings land on the documented enums and
    garbage (None, bytes, numbers) answers ('web', 'other') without raising;
  · the version upsert is ON CONFLICT (user_id) — one row per person;
  · the sync-path seen-set writes a (user, version) pair at most once per
    process, and a failed write does not poison it;
  · both metrics are in the Pulse catalogue with module 'pulse'.

── WHY THE TWO METRICS ARE NOT LIVE-PROBED, ALONE IN THIS REGISTRY ──────────
Every other Pulse query was live-probed read-only before its test was
written (the mock-pool-hides-bad-SQL rule). pulse.surface_os and
pulse.app_versions CANNOT be: they read staging.pulse_logins and
staging.pulse_app_versions, which migration 156 creates and 156 is NOT
applied. Until it is, review and these shape assertions are the only checks
those two queries get — which is why their SQL is deliberately boring.
"""
import asyncio
import datetime
import pathlib
import re

import pytest

import auth_router
from analytics.registry import MetricRequest
from helpers import TEST_PASSWORD
from routers import sync
from services import pulse as pulse_service
from services.analytics_window import Window
from services.pulse import (
    DEFAULT_LAYOUT,
    PULSE_REGISTRY,
    _last_written_version,
    note_app_version,
    parse_user_agent,
    pulse_catalogue,
    record_app_version,
    record_login_pulse,
)


def run(coro):
    return asyncio.run(coro)


class RecordingPool:
    def __init__(self):
        self.calls = []

    async def execute(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return "INSERT 0 1"

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return []


@pytest.fixture(autouse=True)
def clean_seen_set():
    """The last-written dict is module state that outlives any one test."""
    _last_written_version.clear()
    yield
    _last_written_version.clear()


# ── the parser: table-driven over real UA strings ────────────────────────────

UA_CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                 "AppleWebKit/537.36 (KHTML, like Gecko) "
                 "Chrome/126.0.0.0 Safari/537.36")
UA_SAFARI_MAC = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                 "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                 "Version/17.4 Safari/605.1.15")
UA_FIREFOX_LINUX = ("Mozilla/5.0 (X11; Linux x86_64; rv:126.0) "
                    "Gecko/20100101 Firefox/126.0")
UA_OKHTTP = "okhttp/4.12.0"
UA_EXPO_ANDROID = "Expo/2.31.2 okhttp/4.9.2"
UA_RN_ANDROID = "Kartavaya/2.0.3 ReactNative/0.81 okhttp/4.12.0"
UA_EXPO_IOS = "Expo/2.31.2 CFNetwork/1408.0.4 Darwin/22.5.0"
UA_APP_IPAD = "Kartavaya/2.1.0 (iPad; iPadOS 17.4) Expo/54.0.0"
UA_SAFARI_IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                    "Version/17.4 Mobile/15E148 Safari/604.1")
UA_CHROME_ANDROID = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) "
                     "Chrome/126.0.0.0 Mobile Safari/537.36")


@pytest.mark.parametrize("ua,header,expected", [
    # The web enum: windows / macos / linux out of desktop browsers.
    (UA_CHROME_WIN, None, ("web", "windows")),
    (UA_SAFARI_MAC, None, ("web", "macos")),
    (UA_FIREFOX_LINUX, None, ("web", "linux")),
    # An iPhone Safari UA says "like Mac OS X" and must NOT read as macOS;
    # Android Chrome says "Linux;" and must NOT read as desktop Linux.
    (UA_SAFARI_IPHONE, None, ("web", "other")),
    (UA_CHROME_ANDROID, None, ("web", "other")),
    # The app, by UA signature alone (a request that lost its header).
    (UA_OKHTTP, None, ("app", "android")),
    (UA_EXPO_ANDROID, None, ("app", "android")),
    (UA_RN_ANDROID, None, ("app", "android")),
    # Apple patterns recognised NOW, for the day that build ships.
    (UA_EXPO_IOS, None, ("app", "ios")),
    (UA_APP_IPAD, None, ("app", "ipados")),
    # The header alone is proof of the app, whatever the UA looks like.
    (UA_CHROME_ANDROID, "2.0.3", ("app", "android")),
    ("", "2.0.3", ("app", "android")),
    # Unknown → ('web', 'other'), never a guess.
    (None, None, ("web", "other")),
    ("", None, ("web", "other")),
    ("curl/8.5.0", None, ("web", "other")),
])
def test_the_parser_lands_real_uas_on_the_documented_enums(ua, header, expected):
    assert parse_user_agent(ua, header) == expected


def test_the_parser_is_total_and_never_raises():
    """Any input at all answers ('web', 'other') — a UA parse must not be
    able to break a login, as a property of the function itself."""
    for garbage in (b"\xff\xfebytes", 42, object(), ["a", "list"]):
        assert parse_user_agent(garbage) == ("web", "other")  # type: ignore[arg-type]
    # A garbage header must not raise either; whatever it reads as, the
    # answer stays inside the enum.
    surface, os_name = parse_user_agent(None, b"2.0.3")  # type: ignore[arg-type]
    assert surface in ("web", "app") and isinstance(os_name, str)


def test_every_parser_output_is_a_documented_enum_pair():
    """The tables can only emit what migration 156's header documents."""
    web_os = {"windows", "macos", "linux", "other"}
    app_os = {"android", "ios", "ipados"}
    for ua, header in [(u, h) for u in (
        UA_CHROME_WIN, UA_SAFARI_MAC, UA_FIREFOX_LINUX, UA_OKHTTP,
        UA_EXPO_ANDROID, UA_RN_ANDROID, UA_EXPO_IOS, UA_APP_IPAD,
        UA_SAFARI_IPHONE, UA_CHROME_ANDROID, None, "", "curl/8.5.0",
    ) for h in (None, "2.0.3")]:
        surface, os_name = parse_user_agent(ua, header)
        assert surface in ("web", "app")
        assert os_name in (app_os if surface == "app" else web_os), (ua, header)


# ── the recorder: enums only, never the UA ───────────────────────────────────

def test_the_recorder_binds_enums_and_never_the_raw_ua():
    pool = RecordingPool()
    run(record_login_pulse(pool, "user_aaa111", UA_CHROME_WIN, None))
    assert len(pool.calls) == 1
    sql, args = pool.calls[0]
    assert "INSERT INTO public.pulse_logins" in sql
    assert "$1::text" in sql and "$2::text" in sql and "$3::text" in sql
    assert args == ["user_aaa111", "web", "windows"]
    # The privacy contract, asserted on the wire shape: no fragment of the
    # UA reaches any SQL or bind of any recorded call.
    for sql, args in pool.calls:
        assert UA_CHROME_WIN not in sql
        for value in args:
            assert not (isinstance(value, str) and "Mozilla" in value)
            assert value != UA_CHROME_WIN


def test_a_login_with_the_version_header_also_upserts_one_row_per_user():
    pool = RecordingPool()
    run(record_login_pulse(pool, "user_aaa111", UA_OKHTTP, "2.0.3"))
    assert len(pool.calls) == 2
    login_sql, login_args = pool.calls[0]
    assert login_args == ["user_aaa111", "app", "android"]
    ver_sql, ver_args = pool.calls[1]
    assert "INSERT INTO public.pulse_app_versions" in ver_sql
    assert "ON CONFLICT (user_id) DO UPDATE" in ver_sql
    assert "version = EXCLUDED.version" in ver_sql
    assert ver_args == ["user_aaa111", "2.0.3"]


def test_the_upsert_sql_shape_is_one_row_per_user():
    pool = RecordingPool()
    run(record_app_version(pool, "user_aaa111", "2.0.3"))
    sql, args = pool.calls[0]
    assert "public.pulse_app_versions" in sql
    assert "ON CONFLICT (user_id)" in sql
    assert "updated_at = now()" in sql
    assert args == ["user_aaa111", "2.0.3"]


# ── the version header is CLIENT INPUT: sanitised at the recorder seam ───────
# Accepted: ^[0-9A-Za-z._+-]{1,32}$ after strip. Anything else is DISCARDED —
# no write, no exception. A control character survives h11 and later 500s
# every Pulse xlsx export (openpyxl IllegalCharacterError); junk and
# over-long strings render verbatim on the Aekam board.


def test_a_control_character_version_is_discarded_not_written():
    pool = RecordingPool()
    run(record_login_pulse(pool, "user_aaa111", UA_OKHTTP, "2.0.3\x00"))
    version_writes = [c for c in pool.calls
                      if "pulse_app_versions" in c[0]]
    assert version_writes == [], (
        "a version with a control character reached the table — the next "
        "xlsx export of pulse.app_versions is a 500"
    )
    # the login row itself still lands: discarding the version must not
    # discard the login
    assert any("pulse_logins" in c[0] for c in pool.calls)


def test_an_overlong_version_is_discarded_not_written():
    pool = RecordingPool()
    run(record_app_version(pool, "user_aaa111", "x" * 33))
    assert pool.calls == [], "33 chars of junk is not an app version"
    # …and the sync-path recorder discards it the same way
    run(note_app_version(pool, "user_aaa111", "x" * 33))
    assert pool.calls == []


def test_a_real_version_still_writes():
    pool = RecordingPool()
    run(record_app_version(pool, "user_aaa111", " 2.0.3 "))
    assert len(pool.calls) == 1
    assert pool.calls[0][1] == ["user_aaa111", "2.0.3"], "stripped, then kept"


def test_a_discarded_version_does_not_poison_the_last_written_record():
    """Discarded means DISCARDED: no write, and no entry in the process-local
    dict — junk must neither be remembered nor displace the real record."""
    pool = RecordingPool()
    run(note_app_version(pool, "user_aaa111", "\x07junk"))
    assert pool.calls == [] and "user_aaa111" not in _last_written_version

    run(note_app_version(pool, "user_aaa111", "2.0.3"))
    assert len(pool.calls) == 1, "the real version after junk still writes"
    assert _last_written_version.get("user_aaa111") == "2.0.3"

    # and junk AFTER a real version leaves the real record standing
    run(note_app_version(pool, "user_aaa111", "<script>alert(1)</script>"))
    assert len(pool.calls) == 1
    assert _last_written_version.get("user_aaa111") == "2.0.3"


# ── the login seam: collection can never break or slow a login ───────────────

async def _drain_pulse_tasks():
    """The recording is fire-and-forget (`auth_router._spawn_login_pulse`),
    so a test that asserts on the WRITES waits for the spawned task rather
    than racing it. Done tasks discard themselves, so gather is a no-op when
    the write already landed."""
    pending = list(auth_router._pulse_tasks)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


async def test_login_records_one_pulse_row_with_enums_only(
        api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post(
        "/api/auth/login",
        json={"email": admin_user["email"], "password": TEST_PASSWORD},
        headers={"User-Agent": UA_CHROME_WIN},
    )
    assert resp.status_code == 200
    await _drain_pulse_tasks()
    pulse_calls = [c for c in mock_pool.execute.await_args_list
                   if "public.pulse_logins" in c.args[0]]
    assert len(pulse_calls) == 1
    assert list(pulse_calls[0].args[1:]) == \
        [admin_user["user_id"], "web", "windows"]
    # The raw UA is in no bind of any pulse write (audit_log's own UA column
    # is a different, pre-existing surface — this contract is Pulse's).
    for c in mock_pool.execute.await_args_list:
        if "pulse_" in c.args[0]:
            assert all(a != UA_CHROME_WIN for a in c.args[1:])


async def test_an_app_login_upserts_the_version_too(
        api_client, mock_pool, admin_user):
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post(
        "/api/auth/login",
        json={"email": admin_user["email"], "password": TEST_PASSWORD},
        headers={"User-Agent": UA_OKHTTP, "X-App-Version": "2.0.3"},
    )
    assert resp.status_code == 200
    await _drain_pulse_tasks()
    login_calls = [c for c in mock_pool.execute.await_args_list
                   if "public.pulse_logins" in c.args[0]]
    assert list(login_calls[0].args[1:]) == \
        [admin_user["user_id"], "app", "android"]
    ver_calls = [c for c in mock_pool.execute.await_args_list
                 if "public.pulse_app_versions" in c.args[0]]
    assert len(ver_calls) == 1
    assert list(ver_calls[0].args[1:]) == [admin_user["user_id"], "2.0.3"]


async def test_a_raising_recorder_still_returns_the_token(
        api_client, mock_pool, admin_user, monkeypatch):
    """THE hard constraint. The collector blowing up in any way at all must
    cost the person nothing: 200, token, user — the login they asked for."""
    async def broken(*a, **kw):
        raise RuntimeError("the pulse collector is on fire")

    monkeypatch.setattr(auth_router, "record_login_pulse", broken)
    mock_pool.fetchrow.return_value = admin_user
    resp = await api_client.post(
        "/api/auth/login",
        json={"email": admin_user["email"], "password": TEST_PASSWORD},
        headers={"User-Agent": UA_CHROME_WIN},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data and data["user"]["email"] == admin_user["email"]
    await _drain_pulse_tasks()   # let the spawned task fail before teardown


async def test_the_login_response_never_waits_on_the_recorder(
        api_client, mock_pool, admin_user, monkeypatch):
    """The recording is fire-and-forget — a recorder that BLOCKS FOR EVER
    must cost the login nothing. If the login path awaited the insert (the
    old shape), this post would sit on the never-resolving future until the
    wait_for below tears it down."""
    entered = asyncio.Event()

    async def stuck(*a, **kw):
        entered.set()
        await asyncio.Event().wait()          # resolves never

    monkeypatch.setattr(auth_router, "record_login_pulse", stuck)
    mock_pool.fetchrow.return_value = admin_user
    resp = await asyncio.wait_for(
        api_client.post(
            "/api/auth/login",
            json={"email": admin_user["email"], "password": TEST_PASSWORD},
            headers={"User-Agent": UA_CHROME_WIN},
        ),
        timeout=5,
    )
    assert resp.status_code == 200
    assert "token" in resp.json()
    # the recorder really was invoked — the token just never waited on it
    await asyncio.wait_for(entered.wait(), timeout=5)
    # put the stuck task down so it cannot leak into another test
    for task in list(auth_router._pulse_tasks):
        task.cancel()
    await asyncio.gather(*auth_router._pulse_tasks, return_exceptions=True)


def test_an_undefined_table_failure_logs_its_traceback_once(
        monkeypatch, caplog):
    """Migration 156 not applied means EVERY login's recorder raises
    UndefinedTable. The first failure carries the full traceback; every
    later one is a quiet one-liner — a pre-migration deployment must not
    bury its log under one traceback per login."""
    import logging

    from asyncpg.exceptions import UndefinedTableError

    monkeypatch.setattr(pulse_service, "_undefined_table_logged", False)
    exc = UndefinedTableError('relation "public.pulse_logins" does not exist')

    with caplog.at_level(logging.INFO, logger="services.pulse"):
        for _ in range(3):
            pulse_service.log_recorder_failure("login", exc)

    with_tb = [r for r in caplog.records if r.exc_info]
    assert len(with_tb) == 1, (
        "the missing-table traceback must appear exactly once per process"
    )
    assert with_tb[0].levelno == logging.WARNING
    quiet = [r for r in caplog.records if not r.exc_info]
    assert len(quiet) == 2, "later failures still log — one line each"

    # a DIFFERENT failure is a real fault and keeps its traceback every time
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="services.pulse"):
        pulse_service.log_recorder_failure("login", RuntimeError("on fire"))
        pulse_service.log_recorder_failure("login", RuntimeError("on fire"))
    assert sum(1 for r in caplog.records if r.exc_info) == 2


# ── the sync seam: the seen-set and the never-breaks guard ───────────────────

class _SyncRequest:
    def __init__(self, headers=None):
        self.headers = headers or {}
        self.client = None


def _recent_since():
    return (datetime.datetime.now(datetime.timezone.utc)
            - datetime.timedelta(days=1)).isoformat()


async def test_the_sync_route_upserts_once_per_user_version_pair(mock_pool):
    req = _SyncRequest({"x-app-version": "2.0.3"})
    for _ in range(3):
        out = await sync.list_tombstones(
            request=req, since=_recent_since(),
            user={"user_id": "user_aaa111"}, org_id="org-1")
        assert out["resync_required"] is False
    ver_calls = [c for c in mock_pool.execute.await_args_list
                 if "public.pulse_app_versions" in c.args[0]]
    assert len(ver_calls) == 1          # three polls, one write
    assert list(ver_calls[0].args[1:]) == ["user_aaa111", "2.0.3"]
    # A NEW version is a new fact and writes again — this is how an OTA
    # shows up the day it lands, without waiting for the next login.
    req2 = _SyncRequest({"x-app-version": "2.0.4"})
    await sync.list_tombstones(request=req2, since=_recent_since(),
                               user={"user_id": "user_aaa111"}, org_id="org-1")
    ver_calls = [c for c in mock_pool.execute.await_args_list
                 if "public.pulse_app_versions" in c.args[0]]
    assert len(ver_calls) == 2


async def test_a_versionless_sync_writes_nothing(mock_pool):
    await sync.list_tombstones(
        request=_SyncRequest({}), since=_recent_since(),
        user={"user_id": "user_aaa111"}, org_id="org-1")
    assert not any("pulse_" in c.args[0]
                   for c in mock_pool.execute.await_args_list)


async def test_a_raising_version_recorder_never_breaks_a_sync(
        mock_pool, monkeypatch):
    async def broken(*a, **kw):
        raise RuntimeError("no")

    monkeypatch.setattr(sync, "note_app_version", broken)
    out = await sync.list_tombstones(
        request=_SyncRequest({"x-app-version": "2.0.3"}),
        since=_recent_since(),
        user={"user_id": "user_aaa111"}, org_id="org-1")
    assert out["resync_required"] is False and out["data"] == []


def test_a_failed_write_does_not_poison_the_seen_set():
    """The version is recorded only AFTER the INSERT lands, so a transient DB
    failure is retried on the next poll instead of being dropped for the
    life of the process."""
    class FailingPool:
        async def execute(self, sql, *args):
            raise RuntimeError("db away")

    with pytest.raises(RuntimeError):
        run(note_app_version(FailingPool(), "user_aaa111", "2.0.3"))
    assert _last_written_version.get("user_aaa111") != "2.0.3"

    pool = RecordingPool()
    run(note_app_version(pool, "user_aaa111", "2.0.3"))
    assert len(pool.calls) == 1
    assert _last_written_version.get("user_aaa111") == "2.0.3"


def test_an_ota_rollback_is_visible_a_repeat_is_not():
    """A→B→A must write THREE times — the old seen-SET kept the pair
    (user, A) for ever, so a rollback to A never landed and the adoption
    board kept saying B about a phone running A. A→A stays one write: the
    dict is still the hot-path write guard."""
    pool = RecordingPool()
    for v in ("2.0.3", "2.0.4", "2.0.3"):
        run(note_app_version(pool, "user_aaa111", v))
    assert [a[1] for _, a in pool.calls] == ["2.0.3", "2.0.4", "2.0.3"], (
        "the rollback write is missing — the recorder still remembers "
        "every version it has ever seen instead of the LAST one it wrote"
    )

    pool2 = RecordingPool()
    run(note_app_version(pool2, "user_bbb222", "2.0.3"))
    run(note_app_version(pool2, "user_bbb222", "2.0.3"))
    assert len(pool2.calls) == 1, "an unchanged version re-wrote per poll"


def test_the_seen_set_is_declared_process_local_on_purpose():
    """The WHY must survive refactors: the comment stating that a restart
    re-upserting once is harmless is part of the reviewed contract."""
    src = pathlib.Path(pulse_service.__file__).read_text(encoding="utf-8")
    assert "PROCESS-LOCAL on purpose" in src
    assert "idempotent" in src


# ── the two metrics: catalogued, boring, and honest about zero ───────────────

def test_both_metrics_are_in_the_catalogue_as_pulse():
    metas = {m["key"]: m for m in pulse_catalogue()}
    surface = metas["pulse.surface_os"]
    versions = metas["pulse.app_versions"]
    assert surface["module"] == "pulse" and versions["module"] == "pulse"
    assert surface["grain"] == "flow" and surface["viz"] == "bars"
    assert versions["grain"] == "stock" and versions["viz"] == "table"
    board = {w["metric"] for w in DEFAULT_LAYOUT}
    assert {"pulse.surface_os", "pulse.app_versions"} <= board


def test_surface_os_labels_rows_the_way_the_proposal_draws_them():
    win = Window(datetime.date(2026, 7, 19), datetime.date(2026, 8, 18))
    sql, params = PULSE_REGISTRY["pulse.surface_os"].sql(
        MetricRequest(org_id="", window=win, bucket="day"))
    # Every enum pair the parser can emit has its row name spelled out,
    # Apple builds included — they light up the day one ships.
    for label in ("'Web · Windows'", "'Web · macOS'", "'Web · Linux'",
                  "'Web · other'", "'Android app'", "'iOS app'",
                  "'iPadOS app'"):
        assert label in sql
    assert "public.pulse_logins" in sql
    assert "$1::date" in sql and "$2::date" in sql
    assert params == [win.start, win.end]
    # No id and no raw column leaves the query — labels and counts only.
    assert not re.search(r"AS\s+(?:user_id|uid)\b", sql)


def test_app_versions_reads_the_one_row_per_user_table():
    sql, params = PULSE_REGISTRY["pulse.app_versions"].sql(
        MetricRequest(org_id="", window=None, bucket="day"))
    assert "public.pulse_app_versions" in sql
    assert "COUNT(*)::int" in sql
    assert params == []


# ── migration 156: additive only, the reviewed contract ──────────────────────

def test_migration_156_is_additive_and_holds_only_the_two_approved_tables():
    path = (pathlib.Path(__file__).resolve().parents[1]
            / "migrations" / "156_pulse_usage.sql")
    sql = path.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS staging.pulse_logins" in sql
    assert "CREATE TABLE IF NOT EXISTS staging.pulse_app_versions" in sql
    assert re.search(r"user_id\s+TEXT\s+PRIMARY\s+KEY", sql)
    assert "pulse_logins_occurred_at" in sql
    assert "BEGIN;" in sql and "COMMIT;" in sql
    live = "\n".join(l for l in sql.splitlines()
                     if not l.strip().startswith("--"))
    for verb in ("ALTER ", "DROP ", "UPDATE ", "DELETE ", "INSERT "):
        assert verb not in live.upper(), f"{verb.strip()} in a 156 executable line"
    assert "share" in sql.lower()       # the shared-DB note, like 154/155
    # The approved shape and nothing more: no IP, no geo, no city, no state.
    for word in ("ip", "geo", "city", "state", "location"):
        assert not re.search(rf"^\s*{word}\w*\s+\w+", live,
                             re.IGNORECASE | re.MULTILINE), \
            f"a column shaped like {word!r} has no business in 156"
