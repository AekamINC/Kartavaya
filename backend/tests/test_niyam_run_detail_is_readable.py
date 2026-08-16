"""Every recorded outcome must carry a sentence, and never a person's id.

TWO RULES, ONE PLACE
--------------------
The runs pane renders `detail.reason` and nothing else. That is deliberate —
printing a whole detail dict would put user ids on screen, which this product
forbids — but it means an outcome with no `reason` renders as a BLANK LINE
under its outcome chip.

The first draft had exactly that hole in the worst possible place: the armed
send that actually reached somebody returned `{"delivered": 1, "recipients":
[...]}` with no `reason`, so the one run proving the automation worked would
have shown an "ok" chip and nothing beside it.

So: every outcome carries a sentence, and no sentence carries an id.
"""
from __future__ import annotations

import inspect
import re

import pytest

from services.niyam.actions import ACTIONS, ActionResult


class _Conn:
    """Enough asyncpg to drive an action without a database."""
    def __init__(self, row=None):
        self.row = row
        self.executed = []

    async def fetchrow(self, *a, **k):
        return self.row

    async def execute(self, sql, *a, **k):
        self.executed.append(sql)
        return "INSERT 0 1"

    async def fetchval(self, *a, **k):
        return None


def _event(**after):
    return {"org_id": "00000000-0000-0000-0000-000000000000",
            "entity_id": "task_probe", "entity_type": "task",
            "payload": {"after": after}, "after": after}


@pytest.mark.asyncio
async def test_notify_send_says_what_it_did(monkeypatch):
    from services.niyam import actions as mod

    async def _deliver(conn, **kw):
        from services.niyam.send import Delivery
        return Delivery("ok", "in-app notification created")

    monkeypatch.setattr("services.niyam.send.deliver", _deliver)
    res = await ACTIONS["notify.send"].run(
        _Conn(),
        config={"verb": "notify.send", "channel": "inapp", "kind": "task_done",
                "to": ["@creator"], "title": "A task you asked for is done",
                "body": "It has been marked complete."},
        event=_event(created_by="user_abc123", status="done"))

    assert res.outcome == "ok"
    assert res.detail.get("reason"), "an ok send with no reason renders blank"
    assert res.detail["reason"] == "notified 1 person in the app"


@pytest.mark.asyncio
async def test_a_refusal_says_why(monkeypatch):
    res = await ACTIONS["notify.send"].run(
        _Conn(),
        config={"verb": "notify.send", "channel": "inapp", "to": ["@creator"],
                "title": "x"},
        event=_event(created_by=None, status="done"))
    assert res.outcome == "refused"
    assert res.detail["reason"]


def test_no_outcome_is_recorded_without_a_reason():
    """Static: every ActionResult constructed in the module names a reason.

    A runtime test can only reach the paths it thinks of. This reads the source
    instead, so an action added next year is covered on the day it is written.
    """
    src = inspect.getsource(__import__("services.niyam.actions",
                                       fromlist=["actions"]))
    # `_ok(...)`/`_refused(...)`/`_failed(...)` and bare ActionResult("...", {...})
    bare = re.findall(r'ActionResult\(\s*"(ok|refused|failed)"\s*,\s*\{([^}]*)\}',
                      src, re.S)
    for outcome, body in bare:
        assert "reason" in body, (
            f'ActionResult("{outcome}", ...) is built without a `reason` key, '
            f"so the runs pane would render it as an empty line")
    oks = re.findall(r"return _ok\((.*?)\)\n", src, re.S)
    for call in oks:
        assert "reason" in call, (
            "_ok(...) called without a reason — the runs pane prints only "
            "`detail.reason`")


def test_a_reason_never_carries_a_user_id():
    """The reason is rendered; ids must stay in the un-rendered part."""
    src = inspect.getsource(__import__("services.niyam.actions",
                                       fromlist=["actions"]))
    for line in src.splitlines():
        if "reason" not in line or line.strip().startswith("#"):
            continue
        assert "user_id" not in line, (
            f"a rendered reason interpolates a user id: {line.strip()!r} — "
            f"names, not ids")
