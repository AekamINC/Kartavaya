"""
Shared dispatch/cron secrets: constant-time comparison, and out of the URL.

Three unauthenticated cron endpoints authenticate with a shared secret —
`/api/internal/cron/*` (CRON_SECRET), `/api/reports/dispatch`
(REPORT_DISPATCH_SECRET) and `/api/task-reminders/dispatch`
(TASK_REMINDER_DISPATCH_SECRET). All three compared with `==` / `!=`, which on a
`str` short-circuits at the first differing byte: the time taken to fail is a
function of how many leading bytes were right, and a cron endpoint can be called
as often as an attacker likes.

Two of them also took the secret as `?request_secret=`. A secret in a query
string is written to every access log, proxy log and platform request log the
request passes through, and those outlive and out-scope the secret. The header
form is now preferred; the query form still works so a configured cron keeps
running.
"""

import os
from unittest.mock import AsyncMock, patch

import pytest

from utils import secret_matches


# ── The comparison helper ────────────────────────────────────────────────────

def test_matching_secret_is_accepted():
    assert secret_matches("s3cret-value", "s3cret-value") is True


@pytest.mark.parametrize("provided", [
    "s3cret-valuX",     # last byte wrong
    "X3cret-value",     # first byte wrong
    "s3cret-value ",    # trailing space
    "s3cret",           # prefix only
    "s3cret-value-more",
])
def test_wrong_secret_is_refused(provided):
    assert secret_matches(provided, "s3cret-value") is False


@pytest.mark.parametrize("provided,expected", [
    ("", ""),           # unset env var vs omitted parameter
    (None, None),
    ("", "s3cret"),     # omitted parameter
    ("s3cret", ""),     # unset env var
    (None, "s3cret"),
    ("s3cret", None),
])
def test_empty_never_matches(provided, expected):
    """An unset variable must not be satisfied by an omitted parameter.

    Both being "" would compare EQUAL under `==` and authorise the request.
    """
    assert secret_matches(provided, expected) is False


def test_uses_constant_time_primitive():
    """Pin the mechanism, not just the answers — the timing is the point."""
    import inspect

    src = inspect.getsource(secret_matches)
    assert "compare_digest" in src


# ── /api/task-reminders/dispatch ─────────────────────────────────────────────

@pytest.fixture
def reminder_secret(monkeypatch):
    secret = "task-reminder-dispatch-secret-0123456789"
    import routers.task_reminders as tr
    monkeypatch.setattr(tr, "DISPATCH_SECRET", secret)
    return secret


async def test_reminders_dispatch_accepts_header(api_client, mock_pool, reminder_secret):
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.post(
        "/api/task-reminders/dispatch",
        headers={"X-Dispatch-Secret": reminder_secret},
    )
    assert r.status_code == 200


async def test_reminders_dispatch_still_accepts_query(api_client, mock_pool, reminder_secret):
    """The deprecated form keeps working so a configured cron does not break."""
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.post(
        f"/api/task-reminders/dispatch?request_secret={reminder_secret}"
    )
    assert r.status_code == 200


@pytest.mark.parametrize("header", ["", "wrong", "task-reminder-dispatch-secret-012345678"])
async def test_reminders_dispatch_refuses_bad_secret(
    api_client, mock_pool, reminder_secret, header
):
    r = await api_client.post(
        "/api/task-reminders/dispatch",
        headers={"X-Dispatch-Secret": header},
    )
    assert r.status_code == 403


# ── /api/internal/cron/* ─────────────────────────────────────────────────────

async def test_cron_refuses_when_secret_unset(api_client, monkeypatch):
    """No configured secret must refuse, never wave through."""
    import routers.scheduler as sched
    monkeypatch.setattr(sched, "CRON_SECRET", "")
    r = await api_client.post(
        "/api/internal/cron/reminders", headers={"X-Cron-Secret": ""}
    )
    assert r.status_code == 403


async def test_cron_refuses_wrong_secret(api_client, monkeypatch):
    import routers.scheduler as sched
    monkeypatch.setattr(sched, "CRON_SECRET", "the-real-cron-secret")
    r = await api_client.post(
        "/api/internal/cron/reminders", headers={"X-Cron-Secret": "the-real-cron-secre"}
    )
    assert r.status_code == 403
