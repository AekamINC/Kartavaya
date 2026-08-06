"""
Security tests for `routers/me.py` — the account self-service router.

A `/me/*` router is where horizontal privilege escalation hides, because every
handler is *supposed* to touch a user's own row and the only thing separating
"my data" from "yours" is which identifier reaches the SQL. These tests assert
that separation directly rather than trusting the handler's shape:

  * every route rejects an unauthenticated caller;
  * every SQL statement a route issues is bound to the CALLER'S id, taken from
    the verified token;
  * a user id supplied by the client — in a body, a query string or a device
    reference — never reaches the database as the row selector.

`VICTIM_ID` is the id these tests try to reach. It must never appear in any
query the router issues while `as_member` is the caller.
"""
import pytest
from unittest.mock import AsyncMock

VICTIM_ID = "user_victim999"
CALLER_ID = "user_mem001"          # matches conftest's member_user

# Every route on the router, as (method, path, json-body-or-None).
ROUTES = [
    ("get",    "/api/v1/me/sessions",           None),
    ("post",   "/api/v1/me/devices/deregister", {"kind": "web", "device_ref": "x"}),
    ("post",   "/api/v1/me/export",             None),
    ("post",   "/api/v1/me/delete",             {}),
    ("delete", "/api/v1/me/delete",             None),
    ("get",    "/api/v1/me/requests",           None),
]


def _all_bound_args(mock_pool):
    """Every positional argument bound into every statement this request ran."""
    seen = []
    for m in (mock_pool.fetch, mock_pool.fetchrow, mock_pool.fetchval, mock_pool.execute):
        for call in m.call_args_list:
            seen.extend(call.args[1:])          # args[0] is the SQL itself
    return seen


def _all_sql(mock_pool):
    sql = []
    for m in (mock_pool.fetch, mock_pool.fetchrow, mock_pool.fetchval, mock_pool.execute):
        for call in m.call_args_list:
            if call.args:
                sql.append(call.args[0])
    return sql


def _migrated(mock_pool):
    """Make the mock behave as if PROPOSED_067 Part A has been applied.

    Without this the default mock returns None for the `INSERT ... RETURNING`,
    which no real Postgres ever does. Modelling the applied state keeps these
    tests exercising the success path rather than an artefact of the harness.
    """
    from datetime import datetime, timezone
    ts = datetime(2026, 7, 26, 12, 0, tzinfo=timezone.utc)

    async def _fetchrow(sql, *args):
        if "INSERT INTO staging.account_requests" in sql:
            return {"requested_at": ts}
        return None            # no open request, no notification_prefs row

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)
    return mock_pool


# ── The router is actually mounted ───────────────────────────────────────────

def _mounted_paths(router, seen=None):
    """Every path reachable on the app.

    FastAPI wraps each `include_router` in an `_IncludedRouter` that keeps the
    real router on `.original_router`, so a flat scan of `app.routes` sees only
    the routes registered directly on the app.
    """
    seen = seen if seen is not None else set()
    for r in getattr(router, "routes", []):
        path = getattr(r, "path", None)
        if path:
            seen.add(path)
        inner = getattr(r, "original_router", None)
        if inner is not None:
            _mounted_paths(inner, seen)
        elif hasattr(r, "routes"):
            _mounted_paths(r, seen)
    return seen


def test_router_is_registered(app):
    """The whole point of the review: this router was committed but never
    included in server.py, so all six endpoints 404'd instead of working."""
    paths = _mounted_paths(app)
    for _, path, _ in ROUTES:
        assert path in paths, f"{path} is not mounted — routers/me.py is dead code"


# ── Authentication ───────────────────────────────────────────────────────────

@pytest.mark.anyio
@pytest.mark.parametrize("method,path,body", ROUTES)
async def test_requires_auth(api_client, method, path, body):
    """No route is reachable without a token."""
    kwargs = {"json": body} if body is not None else {}
    r = await getattr(api_client, method)(path, **kwargs)
    assert r.status_code in (401, 403), f"{method.upper()} {path} returned {r.status_code}"


# ── Self-scoping: the caller's id, and only the caller's id ──────────────────

@pytest.mark.anyio
async def test_sessions_reads_only_callers_rows(api_client, as_member, mock_pool):
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/me/sessions")
    assert r.status_code == 200

    for sql in _all_sql(mock_pool):
        if "push_tokens" in sql or "push_web_subscriptions" in sql:
            assert "user_id=$1" in sql.replace(" ", ""), f"unscoped read: {sql}"
    assert CALLER_ID in _all_bound_args(mock_pool)
    assert VICTIM_ID not in _all_bound_args(mock_pool)


@pytest.mark.anyio
async def test_sessions_never_claims_a_session_list(api_client, as_member, mock_pool):
    """This screen must not assert anything about sessions that is untrue.

    UPDATED DELIBERATELY 2026-08-06, which is what the previous version of this
    test asked for in as many words. It required `revocation.supported is
    False`, and that became the false statement: `auth_router.reset_password`
    now stamps `users.sessions_valid_from` and `require_user` refuses every
    token issued before it, so other sessions CAN be ended.

    What has NOT changed, and is structural rather than unbuilt: tokens still
    carry no `jti` and nothing records that a session exists, so they cannot be
    ENUMERATED. `other_sessions_known` is the assertion that survives, and it
    is the one a UI must consult before it renders anything resembling a
    session list. A capability to end sessions is not evidence that a list of
    them exists — the two are separate keys precisely so a future change to one
    cannot quietly move the other.
    """
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/me/sessions")
    body = r.json()
    # The permanent guarantee.
    assert body["other_sessions_known"] is False
    # Devices must never be presented as sessions.
    assert "sessions" not in body
    # Revocation follows whether migration 118 is actually present — it is not
    # hard-coded in either direction.
    from auth_router import revocation_active
    assert body["revocation"]["supported"] is revocation_active()
    assert body["revocation"]["method"] == (
        "password_reset" if revocation_active() else None
    )
    # Whatever it reports, the prose must agree with the flag.
    reason = body["revocation"]["reason"]
    if revocation_active():
        assert "cannot be listed" in reason
        assert "can be ended" in reason
        assert "end them early" not in reason
    else:
        assert "cannot list your other sign-ins or end them early" in reason


@pytest.mark.anyio
async def test_deregister_scopes_delete_by_caller(api_client, as_member, mock_pool):
    """A device_ref belonging to someone else must match zero rows.

    The endpoint accepts an identifier from the client, so the DELETE has to
    carry the caller's id in the same statement — otherwise supplying a victim's
    push endpoint silences their notifications.
    """
    mock_pool.execute = AsyncMock(return_value="DELETE 0")
    r = await api_client.post(
        "/api/v1/me/devices/deregister",
        json={"kind": "web", "device_ref": "https://fcm.googleapis.com/fcm/send/VICTIM"},
    )
    assert r.status_code == 200
    assert r.json()["removed"] is False       # not 404 — no existence oracle

    sql = mock_pool.execute.call_args.args[0].replace(" ", "")
    assert "user_id=$2" in sql, f"DELETE is not scoped to the caller: {sql}"
    assert CALLER_ID in mock_pool.execute.call_args.args[1:]


@pytest.mark.anyio
async def test_deregister_mobile_scopes_delete_by_caller(api_client, as_member, mock_pool):
    mock_pool.execute = AsyncMock(return_value="DELETE 0")
    r = await api_client.post(
        "/api/v1/me/devices/deregister",
        json={"kind": "mobile", "device_ref": "victim-device-id"},
    )
    assert r.status_code == 200
    sql = mock_pool.execute.call_args.args[0].replace(" ", "")
    assert "user_id=$2" in sql
    assert CALLER_ID in mock_pool.execute.call_args.args[1:]


@pytest.mark.anyio
async def test_deregister_rejects_unknown_kind(api_client, as_member):
    """`kind` is a closed set; anything else must not reach a query."""
    r = await api_client.post(
        "/api/v1/me/devices/deregister",
        json={"kind": "../../etc", "device_ref": "x"},
    )
    assert r.status_code == 422


# ── A client-supplied user id must never become the row selector ─────────────

@pytest.mark.anyio
async def test_body_user_id_is_ignored_on_export(api_client, as_member, mock_pool):
    """Smuggling a user_id in the body must not retarget the request."""
    _migrated(mock_pool)
    r = await api_client.post("/api/v1/me/export", json={"user_id": VICTIM_ID})
    assert r.status_code == 200

    bound = _all_bound_args(mock_pool)
    assert VICTIM_ID not in bound
    assert CALLER_ID in bound


@pytest.mark.anyio
async def test_query_user_id_is_ignored_on_requests(api_client, as_member, mock_pool):
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get(f"/api/v1/me/requests?user_id={VICTIM_ID}")
    assert r.status_code in (200, 503)
    bound = _all_bound_args(mock_pool)
    assert VICTIM_ID not in bound
    if bound:
        assert CALLER_ID in bound


@pytest.mark.anyio
async def test_body_user_id_is_ignored_on_delete(api_client, as_member, mock_pool):
    _migrated(mock_pool)
    r = await api_client.post(
        "/api/v1/me/delete", json={"user_id": VICTIM_ID, "reason": "test"},
    )
    assert r.status_code == 200

    bound = _all_bound_args(mock_pool)
    assert VICTIM_ID not in bound
    assert CALLER_ID in bound


@pytest.mark.anyio
async def test_cancel_deletion_scopes_update_to_caller(api_client, as_member, mock_pool):
    mock_pool.fetchval = AsyncMock(return_value=None)
    r = await api_client.delete("/api/v1/me/delete")
    assert r.status_code in (404, 503)
    for sql in _all_sql(mock_pool):
        if "account_requests" in sql and "UPDATE" in sql:
            assert "user_id=$1" in sql.replace(" ", ""), f"unscoped update: {sql}"


@pytest.mark.anyio
async def test_all_account_requests_queries_filter_by_user(api_client, as_member, mock_pool):
    """Belt and braces: no statement touching account_requests may omit user_id."""
    mock_pool.fetch = AsyncMock(return_value=[])
    await api_client.get("/api/v1/me/requests")
    for sql in _all_sql(mock_pool):
        if "account_requests" in sql:
            assert "user_id" in sql, f"account_requests touched without user_id: {sql}"


# ── Role guards come from role_tiers, never from a literal ───────────────────

def test_no_hardcoded_role_strings_in_router():
    """The last-admin check must read role_tiers.GOD_MODE_ROLES, not a literal.

    A bare 'platform_owner' here is how a role rename silently turns a guard
    into a no-op.
    """
    import pathlib
    src = pathlib.Path(__file__).resolve().parents[1] / "routers" / "me.py"
    text = src.read_text(encoding="utf-8")
    code = "\n".join(
        line for line in text.splitlines()
        if not line.lstrip().startswith("#")
    )
    # The docstring legitimately names the constant; the code must not inline
    # the role values themselves.
    assert '"platform_owner"' not in code
    assert "'platform_owner'" not in code
    assert '"platform_admin"' not in code
    assert "'platform_admin'" not in code
    assert "GOD_MODE_ROLES" in code


def test_god_mode_roles_is_the_shared_constant():
    from middleware.role_tiers import GOD_MODE_ROLES
    from routers.me import GOD_MODE_ROLES as imported
    assert imported is GOD_MODE_ROLES


@pytest.mark.anyio
async def test_last_god_mode_holder_cannot_delete_themselves(api_client, as_member, mock_pool):
    """Deleting the only administrator leaves an installation nobody can run."""
    async def _fetchval(sql, *args):
        if "user_roles" in sql and "COUNT" in sql:
            return 0            # nobody else holds god mode
        if "user_roles" in sql:
            return 1            # the caller does
        return 0

    mock_pool.fetchval = AsyncMock(side_effect=_fetchval)
    r = await api_client.post("/api/v1/me/delete", json={})
    assert r.status_code == 409
    assert "only administrator" in r.json()["detail"]


@pytest.mark.anyio
async def test_delete_fails_closed_when_role_check_errors(api_client, as_member, mock_pool):
    """If the guard itself cannot run, refuse — never fall through to the write."""
    mock_pool.fetchval = AsyncMock(side_effect=RuntimeError("pool exhausted"))
    r = await api_client.post("/api/v1/me/delete", json={})
    assert r.status_code == 503
    assert "NOT recorded" in r.json()["detail"]


@pytest.mark.anyio
async def test_missing_table_reports_not_recorded(api_client, as_member, mock_pool):
    """PROPOSED_067 is unapplied on every environment today, so this is the live
    path. The caller must be told their request was NOT stored, not handed a
    generic 500 they might read as 'try again'."""
    import asyncpg

    mock_pool.fetchrow = AsyncMock(
        side_effect=asyncpg.exceptions.UndefinedTableError("no such table")
    )
    r = await api_client.post("/api/v1/me/export")
    assert r.status_code == 503
    assert "NOT" in r.json()["detail"]


@pytest.mark.anyio
async def test_double_click_race_is_not_a_500(api_client, as_member, mock_pool):
    """The partial unique index rejects the second insert of a double click.
    The loser of that race must see 'already open', not a server error."""
    import asyncpg

    async def _fetchrow(sql, *args):
        if "INSERT INTO staging.account_requests" in sql:
            raise asyncpg.exceptions.UniqueViolationError("one open request")
        return None

    mock_pool.fetchrow = AsyncMock(side_effect=_fetchrow)
    r = await api_client.post("/api/v1/me/export")
    assert r.status_code == 200
    assert r.json()["already_open"] is True


# ── Regression: /api/push/unsubscribe was unscoped ───────────────────────────

@pytest.mark.anyio
async def test_push_unsubscribe_is_scoped_to_caller(api_client, as_member, mock_pool):
    """Any authenticated user could previously delete any other user's web-push
    subscription by supplying their endpoint, silently stopping the victim's
    notifications. The DELETE must carry the caller's id.
    """
    mock_pool.execute = AsyncMock(return_value="DELETE 0")
    r = await api_client.post(
        "/api/push/unsubscribe",
        json={
            "endpoint": "https://fcm.googleapis.com/fcm/send/VICTIM-ENDPOINT",
            "keys": {"p256dh": "k", "auth": "a"},
        },
    )
    assert r.status_code == 200

    deletes = [
        c for c in mock_pool.execute.call_args_list
        if c.args and "push_web_subscriptions" in c.args[0] and "DELETE" in c.args[0]
    ]
    assert deletes, "expected a delete against push_web_subscriptions"
    for call in deletes:
        assert "user_id" in call.args[0], f"unscoped delete: {call.args[0]}"
        assert CALLER_ID in call.args[1:]
