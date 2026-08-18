"""The prachar and varta writes now tell Niyam — honestly, and only then.

Three events plus one repair, and each has a way of being a lie that these
tests exist to keep shut:

- `campaign.sent` fires from the TERMINAL send write only — after delivery was
  attempted and something actually left. This module recorded 'sent' for
  months while every outbound row said 'suppressed'; an event emitted from the
  pre-dispatch 'sending' stamp, or from the suppressed branch, would re-tell
  that lie to every rule that trusts it.
- `contact.unsubscribed` fires from BOTH unsubscribe paths (via='manual' from
  the authenticated route, via='link' from the public URL, which has no actor
  and says source='import') — and from neither when the address was already on
  the list, because ON CONFLICT DO NOTHING returning no row means nothing
  changed.
- `whatsapp.inbound` fires from the Meta webhook with the RAW phone number —
  hashing is the emitter's job, so no caller can put a number in the log —
  and never from a request whose signature failed.
- THE REPAIR: the webhook's contact INSERT was a lead writer that emitted
  nothing, so WhatsApp-born leads were invisible to every "a lead or contact
  is added" rule that fires for the web form, the scrapers and inbound email.
  It now calls `contact_created` (source='import', no actor), and only when
  this webhook actually created the row.

The fake pool is `test_target_attainment`'s: `acquire()` lends the pool itself
back out as the connection, so every statement inside the wired transactions
lands in the same ledger the assertions read. The emitters are monkeypatched
in the ROUTER's namespace — the routers import them at module level for
exactly this reason.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

import pytest
from fastapi import HTTPException

import outbound
import routers.prachar as prachar
import routers.whatsapp as whatsapp


# ── The fake pool (the test_target_attainment idiom) ─────────


class _Pool:
    def __init__(self):
        self.calls = []

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def fetchrow(self, q, *a):
        self.calls.append((q, a))
        return None

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return None

    # The wired writes run inside `async with pool.acquire() as _conn: async
    # with _conn.transaction():`, so the fake pool lends out a conn that
    # proxies every call back into the same ledger the assertions read.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return pool

            async def __aexit__(_s, *exc):
                return False
        return _A()

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *exc):
                return False
        return _T()


class _Recorder:
    """Stands in for an emitter; remembers every call's kwargs."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, kw))
        return 1


def _use(monkeypatch, module, pool):
    async def _get_pool():
        return pool

    monkeypatch.setattr(module, "get_pool", _get_pool)


# ═════════════════════════════════════════════════════════════
# campaign.sent
# ═════════════════════════════════════════════════════════════

_CAMP_ID = "11111111-1111-1111-1111-111111111111"


def _campaign_row(**over):
    row = {
        "id": _CAMP_ID,
        "name": "Diwali offer",
        "channel": "email",
        "status": "draft",
        "audience_filter": {},
        "subject": "Hello {{name}}",
        "body_html": "<p>Namaste</p>",
        "template_id": None,
        "total_recipients": 1,
    }
    row.update(over)
    return row


async def _run_send(monkeypatch, pool, *, dry_run):
    """Drive `send_campaign` end to end, including its background dispatch."""
    _use(monkeypatch, prachar, pool)
    monkeypatch.setattr(outbound, "DRY_RUN", dry_run, raising=False)
    monkeypatch.setattr(prachar, "send_email", lambda *a, **k: True)

    async def _audience(_pool, _org, _filters):
        return [{"id": "22222222-2222-2222-2222-222222222222",
                 "email": "lead@example.com", "name": "A", "company": ""}]

    monkeypatch.setattr(prachar, "_resolve_audience", _audience)

    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "UPDATE staging.prachar_campaigns" in q and "RETURNING" in q:
            # the terminal write's RETURNING * row
            return _campaign_row(status="sent", total_recipients=a[0])
        if "SELECT * FROM staging.prachar_campaigns" in q:
            return _campaign_row()
        return None

    pool.fetchrow = _fetchrow

    out = await prachar.send_campaign(
        _CAMP_ID, user={"user_id": "u9"}, org_id="org1",
    )
    # `send_campaign` returns before `_dispatch` has run a single step; the
    # task is created on the way out. Run it to completion here.
    pending = list(prachar._background_tasks)
    if pending:
        await asyncio.gather(*pending)
    return out


async def test_a_delivered_campaign_emits_from_the_terminal_write(monkeypatch):
    pool = _Pool()
    rec = _Recorder()
    monkeypatch.setattr(prachar, "campaign_sent", rec)

    await _run_send(monkeypatch, pool, dry_run=False)

    assert len(rec.calls) == 1, "one delivered campaign, one event"
    conn, kw = rec.calls[0]
    assert conn is pool, "the emitter must ride the write's own connection"
    assert kw["org_id"] == "org1"
    assert kw["actor_id"] == "u9", "the actor is the person who pressed send"
    assert kw["campaign_id"] == _CAMP_ID
    # `total_recipients` on the terminal row is the DELIVERED count — the
    # emitter reads it as `recipient_count`, so the payload counts people
    # actually reached, not people planned.
    assert kw["row"]["total_recipients"] == 1
    assert kw["row"]["name"] == "Diwali offer"

    # …and the write it rode carries RETURNING, inside the same transaction.
    terminal = [q for q, _ in pool.calls
                if "UPDATE staging.prachar_campaigns" in q and "status='sent'" in q]
    assert terminal and "RETURNING *" in terminal[0]


async def test_a_fully_suppressed_campaign_emits_nothing(monkeypatch):
    """OUTBOUND_MODE=dry means nothing left the building. 1,562 reminders once
    said 'sent' over 1,562 suppressions; the event may not repeat that."""
    pool = _Pool()
    rec = _Recorder()
    monkeypatch.setattr(prachar, "campaign_sent", rec)

    await _run_send(monkeypatch, pool, dry_run=True)

    assert rec.calls == [], "a suppressed campaign reached nobody — no event"
    # the suppressed terminal write still happened, eventlessly
    assert any("status='suppressed'" in q for q, _ in pool.calls
               if "UPDATE staging.prachar_campaigns" in q)


# ═════════════════════════════════════════════════════════════
# contact.unsubscribed — via='manual' (the authenticated route)
# ═════════════════════════════════════════════════════════════


async def test_manual_unsubscribe_emits_with_an_actor(monkeypatch):
    pool = _Pool()
    rec = _Recorder()
    monkeypatch.setattr(prachar, "contact_unsubscribed", rec)
    _use(monkeypatch, prachar, pool)

    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "INSERT INTO staging.prachar_unsubscribes" in q:
            return {"id": "un1", "org_id": a[0], "email": a[1], "reason": a[2]}
        return None

    async def _fetchval(q, *a):
        pool.calls.append((q, a))
        if "graha_contacts" in q:
            return "33333333-3333-3333-3333-333333333333"
        return None

    pool.fetchrow = _fetchrow
    pool.fetchval = _fetchval

    await prachar.add_unsubscribe(
        email=" Lead@Example.COM ", reason="manual",
        user={"user_id": "u9"}, org_id="org1",
    )

    assert len(rec.calls) == 1
    conn, kw = rec.calls[0]
    assert conn is pool
    assert kw["actor_id"] == "u9", "manual is a person in the product acting"
    assert kw["via"] == "manual"
    assert kw["channel"] == "email"
    assert kw["contact_id"] == "33333333-3333-3333-3333-333333333333"
    assert kw.get("source", "app") == "app"
    # the CRM lookup used the normalised address, in the same transaction
    lookup = [a for q, a in pool.calls if "graha_contacts" in q]
    assert lookup and lookup[0][1] == "lead@example.com"


async def test_an_address_already_on_the_list_emits_nothing(monkeypatch):
    """ON CONFLICT DO NOTHING returns no row — nothing changed, and a
    suppression already in force must not be re-announced."""
    pool = _Pool()  # default fetchrow: None, the conflict outcome
    rec = _Recorder()
    monkeypatch.setattr(prachar, "contact_unsubscribed", rec)
    _use(monkeypatch, prachar, pool)

    out = await prachar.add_unsubscribe(
        email="lead@example.com", reason="manual",
        user={"user_id": "u9"}, org_id="org1",
    )

    assert out == {"ok": True}, "the route's answer is unchanged — idempotent"
    assert rec.calls == [], "a no-op write may not produce an event"


# ═════════════════════════════════════════════════════════════
# contact.unsubscribed — via='link' (the public URL, no actor)
# ═════════════════════════════════════════════════════════════


async def test_link_unsubscribe_emits_with_no_actor(monkeypatch):
    pool = _Pool()
    rec = _Recorder()
    monkeypatch.setattr(prachar, "contact_unsubscribed", rec)
    _use(monkeypatch, prachar, pool)

    from services import prachar_unsubscribe as unsub_mod
    monkeypatch.setattr(unsub_mod, "read", lambda t: ("org1", "lead@example.com"))

    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "INSERT INTO staging.prachar_unsubscribes" in q:
            return {"id": "un1", "org_id": a[0], "email": a[1], "reason": "link"}
        return None

    pool.fetchrow = _fetchrow

    resp = await prachar.public_unsubscribe(token="tok")

    assert resp.status_code == 200
    assert len(rec.calls) == 1
    _conn, kw = rec.calls[0]
    assert kw["actor_id"] is None, "the recipient has no account here"
    assert kw["source"] == "import", "no product user behind the write"
    assert kw["via"] == "link"
    assert kw["channel"] == "email"


async def test_a_bad_token_writes_nothing_and_emits_nothing(monkeypatch):
    pool = _Pool()
    rec = _Recorder()
    monkeypatch.setattr(prachar, "contact_unsubscribed", rec)
    _use(monkeypatch, prachar, pool)

    from services import prachar_unsubscribe as unsub_mod
    monkeypatch.setattr(unsub_mod, "read", lambda t: None)

    resp = await prachar.public_unsubscribe(token="garbage")

    assert resp.status_code == 400
    assert rec.calls == [], "a refused token is not an unsubscribe"
    assert pool.calls == [], "…and it must not touch the database at all"


# ═════════════════════════════════════════════════════════════
# whatsapp.inbound + the contact_created repair (the Meta webhook)
# ═════════════════════════════════════════════════════════════

_SECRET = "test_meta_app_secret"


class _Req:
    def __init__(self, body: bytes, sig: str | None):
        self._body = body
        self.headers = {"x-hub-signature-256": sig} if sig else {}

    async def body(self):
        return self._body


def _signed_request(msg: dict) -> _Req:
    payload = {
        "object": "whatsapp_business_account",
        "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
            "metadata": {"phone_number_id": "111222"},
            "messages": [msg],
        }}]}],
    }
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return _Req(body, sig)


def _webhook_pool(*, contact_exists: bool) -> _Pool:
    pool = _Pool()

    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "varta_business_accounts" in q:
            return {"id": "acc1", "org_id": "org1"}
        if "INSERT INTO staging.varta_contacts" in q:
            return {"id": "vc1", "org_id": a[0], "phone_number": a[1],
                    "name": a[2], "graha_contact_id": None, "opted_in": False}
        if "varta_contacts" in q:                      # the SELECT
            return {"id": "vc1"} if contact_exists else None
        if "INSERT INTO staging.varta_conversations" in q:
            return {"id": "conv1"}
        if "varta_conversations" in q:                 # the SELECT
            return None
        if "varta_messages" in q:
            return {"id": "m1"}
        return None

    pool.fetchrow = _fetchrow
    return pool


async def test_a_first_message_creates_the_lead_and_both_events(monkeypatch):
    monkeypatch.setenv("META_APP_SECRET", _SECRET)
    pool = _webhook_pool(contact_exists=False)
    _use(monkeypatch, whatsapp, pool)
    created, inbound = _Recorder(), _Recorder()
    monkeypatch.setattr(whatsapp, "contact_created", created)
    monkeypatch.setattr(whatsapp, "whatsapp_inbound", inbound)

    req = _signed_request({"from": "919999999999", "id": "wamid.1",
                           "type": "text", "text": {"body": "Hello"},
                           "profile": {"name": "Ravi"}})
    out = await whatsapp.webhook_receive(req)
    assert out == {"ok": True}

    # THE REPAIR: the webhook's contact INSERT emits like every other lead
    # writer — import source, no invented actor.
    assert len(created.calls) == 1
    conn, kw = created.calls[0]
    assert conn is pool, "the emitter must ride the write's own connection"
    assert kw["org_id"] == "org1"
    assert kw["actor_id"] is None
    assert kw["source"] == "import"
    assert kw["contact_id"] == "vc1"
    # the row keys are mapped to the names the emitter reads: a WhatsApp-born
    # contact HAS a phone, and its lead source is a true statement.
    assert kw["row"]["phone"] == "919999999999"
    assert kw["row"]["source"] == "whatsapp"

    assert len(inbound.calls) == 1
    _conn, kw = inbound.calls[0]
    assert kw["org_id"] == "org1"
    assert kw["message_id"] == "m1"
    assert kw["conversation_id"] == "conv1"
    # RAW, deliberately: hashing is the emitter's job, so no caller can put a
    # phone number into a log with its own retention window.
    assert kw["phone_number"] == "919999999999"
    assert kw["has_media"] is False
    assert kw["is_new_contact"] is True


async def test_a_known_sender_emits_inbound_only(monkeypatch):
    monkeypatch.setenv("META_APP_SECRET", _SECRET)
    pool = _webhook_pool(contact_exists=True)
    _use(monkeypatch, whatsapp, pool)
    created, inbound = _Recorder(), _Recorder()
    monkeypatch.setattr(whatsapp, "contact_created", created)
    monkeypatch.setattr(whatsapp, "whatsapp_inbound", inbound)

    req = _signed_request({"from": "919999999999", "id": "wamid.2",
                           "type": "image"})
    await whatsapp.webhook_receive(req)

    assert created.calls == [], \
        "an existing contact was not created — no contact.created"
    assert len(inbound.calls) == 1
    _conn, kw = inbound.calls[0]
    assert kw["is_new_contact"] is False
    assert kw["has_media"] is True, "an image message carries an attachment"


async def test_a_forged_webhook_emits_nothing(monkeypatch):
    """The refusal path: a request Meta did not sign writes nothing and
    therefore announces nothing."""
    monkeypatch.setenv("META_APP_SECRET", _SECRET)
    pool = _webhook_pool(contact_exists=False)
    _use(monkeypatch, whatsapp, pool)
    created, inbound = _Recorder(), _Recorder()
    monkeypatch.setattr(whatsapp, "contact_created", created)
    monkeypatch.setattr(whatsapp, "whatsapp_inbound", inbound)

    body = json.dumps({"entry": []}).encode()
    with pytest.raises(HTTPException) as exc:
        await whatsapp.webhook_receive(_Req(body, "sha256=" + "0" * 64))

    assert exc.value.status_code == 403
    assert created.calls == [] and inbound.calls == []
    assert pool.calls == [], "a refused request must not reach the database"
