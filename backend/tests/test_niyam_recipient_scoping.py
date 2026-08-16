"""A rule cannot notify somebody in another company.

THE HOLE
--------
`resolve_recipients` passes an unrecognised entry through as a literal user id,
so a rule may name a specific person alongside a token. Validation checks only
that the `to` list is non-empty and within MAX_RECIPIENTS — it never asks who
those people are.

And `public.notifications` has no `org_id` column and no foreign keys. Every
reader filters on `user_id` ALONE. So a rule authored in one org named a user id
belonging to another and the notification landed in that stranger's list, in a
product where the whole tenancy story is that companies cannot see each other.

The tokens were never the risk — `rules_for` scopes a rule to its event's org.
The literal pass-through was, and nothing checked it.
"""
from __future__ import annotations

import pytest

from services.niyam.actions import ACTIONS, _members_only

OUR_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"


class _Conn:
    """A membership table with exactly one member of one org."""

    def __init__(self, members=("user_ours",), explode=False):
        self.members = set(members)
        self.explode = explode
        self.written: list = []

    async def fetch(self, sql, *args):
        if self.explode:
            raise RuntimeError("the membership lookup failed")
        assert "staging.user_roles" in sql
        asked = args[1]
        return [{"user_id": u} for u in asked if u in self.members]

    async def execute(self, sql, *args):
        self.written.append((sql, args))
        return "INSERT 0 1"

    async def fetchrow(self, *a, **k):
        return None


def _event(**after):
    return {"org_id": OUR_ORG, "entity_id": "task_x", "entity_type": "task",
            "payload": {"after": after}}


@pytest.mark.asyncio
async def test_a_stranger_is_dropped():
    kept = await _members_only(_Conn(), ["user_ours", "user_theirs"],
                               org_id=OUR_ORG)
    assert kept == ["user_ours"]


@pytest.mark.asyncio
async def test_the_rest_of_the_list_still_goes_through():
    """Filter, do not refuse. Somebody leaving the org must not silence a rule
    for everyone else on it."""
    conn = _Conn(members=("a", "c"))
    assert await _members_only(conn, ["a", "b", "c"], org_id=OUR_ORG) == ["a", "c"]


@pytest.mark.asyncio
async def test_a_failed_lookup_notifies_nobody():
    """FAILS CLOSED, unlike every other gate in the send path.

    The polarity is argued from consequence, as all the others are: the harm on
    the other side of this one is writing into a stranger's notification list.
    """
    assert await _members_only(_Conn(explode=True), ["user_ours"],
                               org_id=OUR_ORG) == []


@pytest.mark.asyncio
async def test_an_event_with_no_org_notifies_nobody():
    assert await _members_only(_Conn(), ["user_ours"], org_id=None) == []


@pytest.mark.asyncio
async def test_notify_send_refuses_when_every_recipient_is_a_stranger(monkeypatch):
    """End to end through the action, which is where it actually matters."""
    async def _deliver(conn, **kw):                       # pragma: no cover
        raise AssertionError("deliver() must not be reached for a stranger")

    monkeypatch.setattr("services.niyam.send.deliver", _deliver)
    res = await ACTIONS["notify.send"].run(
        _Conn(members=("user_ours",)),
        config={"verb": "notify.send", "channel": "inapp", "kind": "task_done",
                "to": ["user_theirs"], "title": "t", "body": "b"},
        event=_event(created_by="user_ours"))
    assert res.outcome == "refused"
    assert "nobody" in res.detail["reason"]


@pytest.mark.asyncio
async def test_a_token_recipient_is_checked_too(monkeypatch):
    """@creator is org-safe by construction, but it is not EXEMPT.

    Relying on `rules_for` alone would mean the gate has an unguarded path
    through it the day somebody adds a token that reads a different field.
    """
    sent = []

    async def _deliver(conn, **kw):
        from services.niyam.send import Delivery
        sent.append(kw["user_id"])
        return Delivery("ok", "in-app notification created")

    monkeypatch.setattr("services.niyam.send.deliver", _deliver)
    res = await ACTIONS["notify.send"].run(
        _Conn(members=("user_ours",)),
        config={"verb": "notify.send", "channel": "inapp", "kind": "task_done",
                "to": ["@creator"], "title": "t", "body": "b"},
        event=_event(created_by="user_outsider"))
    assert res.outcome == "refused", "a token resolving outside the org must not send"
    assert sent == []
