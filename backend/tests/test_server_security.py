"""
Unit tests for server.py security middleware and global exception handler.

Coverage:
  Security headers  — X-Frame-Options, X-Content-Type-Options, HSTS,
                      Referrer-Policy, Permissions-Policy on every response
  Exception handler — 500 with generic message, no stack trace
  Rate limiter      — login endpoint has 5/minute decorator
"""

import pytest


# ── Security headers ─────────────────────────────────────────────────────────

async def test_x_frame_options(api_client, as_admin):
    resp = await api_client.get("/api/")
    assert resp.headers["X-Frame-Options"] == "DENY"


async def test_x_content_type_options(api_client, as_admin):
    resp = await api_client.get("/api/")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


async def test_referrer_policy(api_client, as_admin):
    resp = await api_client.get("/api/")
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


async def test_permissions_policy(api_client, as_admin):
    resp = await api_client.get("/api/")
    assert resp.headers["Permissions-Policy"] == "geolocation=(), microphone=(), camera=()"


async def test_hsts_with_railway_env(api_client, as_admin, monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    resp = await api_client.get("/api/")
    assert "max-age=" in resp.headers.get("Strict-Transport-Security", "")


async def test_security_headers_on_unauthenticated(api_client):
    """Security headers are added even to unauthenticated/error responses."""
    resp = await api_client.get("/api/auth/me")
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


async def test_security_headers_on_post(api_client):
    """Security headers are added to POST responses too."""
    resp = await api_client.post("/api/auth/login", json={
        "email": "x@x.com", "password": "x",
    })
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


# ── Global exception handler ────────────────────────────────────────────────

async def test_global_exception_handler_returns_500():
    """The global exception handler returns 500 with generic message, no stack trace."""
    from unittest.mock import MagicMock
    from server import _global_exception_handler

    mock_request = MagicMock()
    mock_request.method = "GET"
    mock_request.url.path = "/api/test"

    resp = await _global_exception_handler(mock_request, RuntimeError("DB exploded"))
    assert resp.status_code == 500
    import json
    body = json.loads(resp.body)
    assert body["detail"] == "Internal server error"
    assert "DB exploded" not in str(body)
    assert "Traceback" not in str(body)


# ── Rate limiter decorator ───────────────────────────────────────────────────

async def test_login_rate_limit_decorator_exists():
    """Verify the login endpoint has a 5/minute rate limit decorator via source inspection."""
    import ast
    import inspect
    import auth_router

    source_file = inspect.getfile(auth_router)
    with open(source_file, encoding="utf-8-sig") as f:
        tree = ast.parse(f.read())

    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "login":
            decorators_src = [ast.dump(d) for d in node.decorator_list]
            joined = " ".join(decorators_src)
            assert "5/minute" in joined, (
                f"Expected @limiter.limit('5/minute') on login, decorators: {joined}"
            )
            return

    pytest.fail("login function not found in auth_router source")
