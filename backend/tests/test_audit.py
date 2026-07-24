"""
Unit tests for services/audit.py — emit() and _write().
"""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient


@pytest.fixture
def mock_audit_pool():
    pool = MagicMock()
    pool.execute = AsyncMock()
    return pool


# ── _write() ────────────────────────────────────────────────────────────────

async def test_write_inserts_into_audit_log(mock_audit_pool):
    with patch("services.audit.get_pool", return_value=mock_audit_pool):
        from services.audit import _write
        await _write("auth.login", user_id="user_001", ip="1.2.3.4", severity="info")

    mock_audit_pool.execute.assert_called_once()
    sql = mock_audit_pool.execute.call_args[0][0]
    assert "staging.audit_log" in sql
    args = mock_audit_pool.execute.call_args[0]
    assert args[3] == "auth.login"
    assert args[6] == "1.2.3.4"


async def test_write_failure_logs_warning_and_does_not_raise(mock_audit_pool):
    mock_audit_pool.execute.side_effect = Exception("connection refused")
    with patch("services.audit.get_pool", return_value=mock_audit_pool):
        from services.audit import _write
        with patch("services.audit.log") as mock_log:
            await _write("auth.login", user_id="user_001")
            mock_log.warning.assert_called_once()
            assert "audit write failed" in mock_log.warning.call_args[0][0]


# ── emit() ──────────────────────────────────────────────────────────────────

async def test_emit_extracts_ip_from_x_forwarded_for():
    from services.audit import emit

    request = MagicMock()
    request.headers = {"x-forwarded-for": "203.0.113.50, 70.41.3.18", "user-agent": "TestAgent/1.0"}
    request.client = MagicMock()
    request.client.host = "127.0.0.1"

    with patch("services.audit._write", new_callable=AsyncMock) as mock_write:
        with patch("asyncio.ensure_future") as mock_ensure:
            mock_ensure.side_effect = lambda coro: asyncio.get_event_loop().create_task(coro)
            emit("auth.login", request, user_id="user_001")
            await asyncio.sleep(0.05)

        mock_write.assert_called_once()
        kwargs = mock_write.call_args[1]
        assert kwargs["ip"] == "203.0.113.50"
        assert kwargs["user_agent"] == "TestAgent/1.0"


async def test_emit_uses_client_host_when_no_forwarded_header():
    from services.audit import emit

    request = MagicMock()
    request.headers = {"user-agent": "TestAgent/1.0"}
    request.client = MagicMock()
    request.client.host = "10.0.0.1"

    with patch("services.audit._write", new_callable=AsyncMock) as mock_write:
        with patch("asyncio.ensure_future") as mock_ensure:
            mock_ensure.side_effect = lambda coro: asyncio.get_event_loop().create_task(coro)
            emit("auth.login", request, user_id="user_001")
            await asyncio.sleep(0.05)

        mock_write.assert_called_once()
        kwargs = mock_write.call_args[1]
        assert kwargs["ip"] == "10.0.0.1"
