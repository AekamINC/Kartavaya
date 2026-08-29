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
  and never from a request whose signature failed. Meta redelivers batches, so
  a `wa_message_id` already recorded as inbound is skipped WHOLE (no row, no
  event), and the emit carries `dedupe_key="wa.in:{id}"` as the belt for the
  race the seen-check cannot close.
- THE REPAIR: the webhook's contact INSERT was a lead writer that emitted
  nothing, so WhatsApp-born leads were invisible to every "a lead or contact
  is added" rule that fires for the web form, the scrapers and inbound email.
  It now calls `contact_created` (source='import', no actor), and only when
  this webhook actually created the row.

THE FAKE POOL IS NO LONGER `test_target_attainment`'s. That idiom had
`acquire()` lend the pool ITSELF out as the connection and `transaction()` be
a stateless no-op — which made "the emitter rode the write's own connection
inside its transaction" satisfiable by calling the emitter on the bare pool
with no transaction anywhere. Here `acquire()` lends a DISTINCT `_Conn` per
entry (recorded in `pool.lent`) that proxies every statement back to the
pool's ledger, and `_Conn.transaction()` flips `in_tx` on the way in and out.
The recorders capture `in_tx` AT CALL TIME, so the assertions can say what
the docstrings always claimed: the emitter got a conn `acquire()` actually
lent, not the pool, while that conn's transaction was open. The emitters are
monkeypatched in the ROUTER's namespace — the routers import them at module
level for exactly this reason.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

import asyncpg
import pytest
from fastapi import HTTPException

import outbound
import routers.prachar as prachar
import routers.whatsapp as whatsapp


# ── The fake pool (the upgraded idiom: distinct conns, real in_tx) ──


class _Conn:
    """One lent connection. Proxies every statement back to the pool's
    ledger/answer machinery, so a test that swaps `pool.fetchrow` still
    scripts what the conn answers — but the conn is NOT the pool, and its
    transaction state is real enough to be asserted on."""

    def __init__(self, pool):
        self._pool = pool
        self.in_tx = False

    async def fetch(self, q, *a):
        return await self._pool.fetch(q, *a)

    async def fetchrow(self, q, *a):
        return await self._pool.fetchrow(q, *a)

    async def fetchval(self, q, *a):
        return await self._pool.fetchval(q, *a)

    async def execute(self, q, *a):
        return await self._pool.execute(q, *a)

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(_s):
                conn.in_tx = True
                return _s

            async def __aexit__(_s, *exc):
                conn.in_tx = False
                return False
        return _T()


class _Pool:
    def __init__(self):
        self.calls = []
        self.lent = []      # every conn acquire() ever handed out, in order

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
    # with _conn.transaction():`. The pool lends a DISTINCT conn each time and
    # remembers it — deliberately NOT itself, so `emitter(pool, ...)` with no
    # transaction can no longer satisfy the wiring assertions. The pool has no
    # `transaction()` of its own for the same reason: code that opens a
    # transaction on the pool instead of a lent conn should crash here.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                conn = _Conn(pool)
                pool.lent.append(conn)
                return conn

            async def __aexit__(_s, *exc):
                return False
        return _A()


class _Recorder:
    """Stands in for an emitter; remembers each call's conn, the conn's
    transaction state AT THAT MOMENT, and the kwargs."""

    def __init__(self):
        self.calls = []

    async def __call__(self, conn, **kw):
        self.calls.append((conn, getattr(conn, "in_tx", False), kw))
        return 1


def _rode_the_write(pool, call):
    """The one rule, now unfakeable: the conn was lent by THIS pool's
    acquire(), it is not the pool itself, and its transaction was open at the
    moment the emitter ran. Returns the kwargs for further assertions."""
    conn, in_tx, kw = call
    assert conn is not pool, "the emitter was handed the bare pool, not a conn"
    assert conn in pool.lent, "the emitter's conn never came from acquire()"
    assert in_tx, "the emitter ran outside the write's transaction"
    return kw


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
        # `client_id` because `/send` now refuses an audience containing anybody
        # the firm does not act for (ICAI Clause 6 — services/prachar_compliance
        # .py). Without it this stub makes the route 403 before it ever reaches
        # the terminal write these tests are about.
        return [{"id": "22222222-2222-2222-2222-222222222222",
                 "email": "lead@example.com", "name": "A", "company": "",
                 "client_id": "33333333-3333-3333-3333-333333333333"}]

    monkeypatch.setattr(prachar, "_resolve_audience", _audience)

    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "UPDATE public.prachar_campaigns" in q and "RETURNING" in q:
            # the terminal write's RETURNING * row
            return _campaign_row(status="sent", total_recipients=a[0])
        if "SELECT * FROM public.prachar_campaigns" in q:
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
    kw = _rode_the_write(pool, rec.calls[0])
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
                if "UPDATE public.prachar_campaigns" in q and "status='sent'" in q]
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
               if "UPDATE public.prachar_campaigns" in q)


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
        if "INSERT INTO public.prachar_unsubscribes" in q:
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
    kw = _rode_the_write(pool, rec.calls[0])
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
        if "INSERT INTO public.prachar_unsubscribes" in q:
            return {"id": "un1", "org_id": a[0], "email": a[1], "reason": "link"}
        return None

    pool.fetchrow = _fetchrow

    resp = await prachar.public_unsubscribe(token="tok")

    assert resp.status_code == 200
    assert len(rec.calls) == 1
    kw = _rode_the_write(pool, rec.calls[0])
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
        if "INSERT INTO public.varta_contacts" in q:
            return {"id": "vc1", "org_id": a[0], "phone_number": a[1],
                    "name": a[2], "graha_contact_id": None, "opted_in": False}
        if "varta_contacts" in q:                      # the SELECT
            return {"id": "vc1"} if contact_exists else None
        if "INSERT INTO public.varta_conversations" in q:
            return {"id": "conv1"}
        if "varta_conversations" in q:                 # the SELECT
            return None
        if "varta_messages" in q:
            return {"id": "m1"}
        return None

    pool.fetchrow = _fetchrow
    return pool


def _wire_webhook(monkeypatch, pool):
    monkeypatch.setenv("META_APP_SECRET", _SECRET)
    _use(monkeypatch, whatsapp, pool)
    created, inbound = _Recorder(), _Recorder()
    monkeypatch.setattr(whatsapp, "contact_created", created)
    monkeypatch.setattr(whatsapp, "whatsapp_inbound", inbound)
    return created, inbound


async def test_a_first_message_creates_the_lead_and_both_events(monkeypatch):
    pool = _webhook_pool(contact_exists=False)
    created, inbound = _wire_webhook(monkeypatch, pool)

    req = _signed_request({"from": "919999999999", "id": "wamid.1",
                           "type": "text", "text": {"body": "Hello"},
                           "profile": {"name": "Ravi"}})
    out = await whatsapp.webhook_receive(req)
    assert out == {"ok": True}

    # THE REPAIR: the webhook's contact INSERT emits like every other lead
    # writer — import source, no invented actor.
    assert len(created.calls) == 1
    kw = _rode_the_write(pool, created.calls[0])
    assert kw["org_id"] == "org1"
    assert kw["actor_id"] is None
    assert kw["source"] == "import"
    assert kw["contact_id"] == "vc1"
    # the row keys are mapped to the names the emitter reads: a WhatsApp-born
    # contact HAS a phone, and its lead source is a true statement.
    assert kw["row"]["phone"] == "919999999999"
    assert kw["row"]["source"] == "whatsapp"

    assert len(inbound.calls) == 1
    kw = _rode_the_write(pool, inbound.calls[0])
    assert kw["org_id"] == "org1"
    assert kw["message_id"] == "m1"
    assert kw["conversation_id"] == "conv1"
    # RAW, deliberately: hashing is the emitter's job, so no caller can put a
    # phone number into a log with its own retention window.
    assert kw["phone_number"] == "919999999999"
    assert kw["has_media"] is False
    assert kw["is_new_contact"] is True
    # both events rode ONE lent conn — the message's single transaction
    assert created.calls[0][0] is inbound.calls[0][0]


async def test_a_known_sender_emits_inbound_only(monkeypatch):
    pool = _webhook_pool(contact_exists=True)
    created, inbound = _wire_webhook(monkeypatch, pool)

    req = _signed_request({"from": "919999999999", "id": "wamid.2",
                           "type": "image"})
    await whatsapp.webhook_receive(req)

    assert created.calls == [], \
        "an existing contact was not created — no contact.created"
    assert len(inbound.calls) == 1
    kw = _rode_the_write(pool, inbound.calls[0])
    assert kw["is_new_contact"] is False
    assert kw["has_media"] is True, "an image message carries an attachment"


async def test_a_forged_webhook_emits_nothing(monkeypatch):
    """The refusal path: a request Meta did not sign writes nothing and
    therefore announces nothing."""
    pool = _webhook_pool(contact_exists=False)
    created, inbound = _wire_webhook(monkeypatch, pool)

    body = json.dumps({"entry": []}).encode()
    with pytest.raises(HTTPException) as exc:
        await whatsapp.webhook_receive(_Req(body, "sha256=" + "0" * 64))

    assert exc.value.status_code == 403
    assert created.calls == [] and inbound.calls == []
    assert pool.calls == [], "a refused request must not reach the database"


# ═════════════════════════════════════════════════════════════
# webhook idempotency — Meta redelivers, this endpoint holds still
# ═════════════════════════════════════════════════════════════


async def test_a_redelivered_message_is_skipped_whole(monkeypatch):
    """Meta redelivers a whole batch whenever the endpoint fails to 200. A
    `wa_message_id` already recorded as inbound is skipped ENTIRELY: no second
    inbox row, no second whatsapp.inbound, no contact.created — and the batch
    still gets its 200, or Meta redelivers forever."""
    pool = _webhook_pool(contact_exists=False)

    async def _fetchval(q, *a):
        pool.calls.append((q, a))
        if "varta_messages" in q and "wa_message_id" in q:
            return 1        # the seen-check: this message already landed
        return None

    pool.fetchval = _fetchval
    created, inbound = _wire_webhook(monkeypatch, pool)

    req = _signed_request({"from": "919999999999", "id": "wamid.1",
                           "type": "text", "text": {"body": "Hello"},
                           "profile": {"name": "Ravi"}})
    out = await whatsapp.webhook_receive(req)

    assert out == {"ok": True}, "the redelivered batch must still 200"
    assert inbound.calls == [], "a message already recorded announces nothing"
    assert created.calls == [], "…and invents no contact on the way through"
    inserts = [q for q, _ in pool.calls if "INSERT INTO" in q]
    assert inserts == [], "a seen message writes no row of any kind"
    # and the check itself asked about INBOUND rows for THIS org and message
    seen = [(q, a) for q, a in pool.calls
            if "varta_messages" in q and "wa_message_id" in q and "SELECT" in q]
    assert seen and "direction='inbound'" in seen[0][0]
    assert seen[0][1] == ("org1", "wamid.1")


async def test_first_delivery_hands_the_emitter_its_dedupe_key(monkeypatch):
    """The seen-check closes the redelivery loop only between committed
    transactions; the dedupe_key on the emit is the belt for the race it
    cannot close. First delivery of wamid.42 → `wa.in:wamid.42`."""
    pool = _webhook_pool(contact_exists=True)
    _created, inbound = _wire_webhook(monkeypatch, pool)

    req = _signed_request({"from": "919999999999", "id": "wamid.42",
                           "type": "text", "text": {"body": "Namaste"}})
    await whatsapp.webhook_receive(req)

    assert len(inbound.calls) == 1
    kw = _rode_the_write(pool, inbound.calls[0])
    assert kw["dedupe_key"] == "wa.in:wamid.42"


async def test_a_concurrent_redelivery_that_hits_157s_index_is_skipped_whole(
        monkeypatch):
    """The race the seen-check cannot close, landing. Two deliveries of one
    batch can BOTH observe "not seen" before either commits; once migration
    157's unique index exists, the loser's inbound INSERT raises
    UniqueViolationError inside its own transaction. That message must be
    skipped WHOLE — the transaction has already rolled back (no row, no
    contact write) and no event may be emitted for it — while the REST of
    the batch still processes and the batch still answers 200, exactly what
    157's header promises. Without the catch, the violation 5xxes the
    webhook and Meta redelivers the whole batch for ever."""
    pool = _webhook_pool(contact_exists=True)
    base_fetchrow = pool.fetchrow

    async def _racing_fetchrow(q, *a):
        if "INSERT INTO public.varta_messages" in q and "wamid.dup" in a:
            pool.calls.append((q, a))   # the ledger still sees the attempt
            raise asyncpg.exceptions.UniqueViolationError(
                'duplicate key value violates unique constraint '
                '"varta_messages_inbound_wamid_key"')
        return await base_fetchrow(q, *a)

    pool.fetchrow = _racing_fetchrow
    created, inbound = _wire_webhook(monkeypatch, pool)

    payload = {
        "object": "whatsapp_business_account",
        "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
            "metadata": {"phone_number_id": "111222"},
            "messages": [
                # the loser of the race — its INSERT hits the index
                {"from": "919999999999", "id": "wamid.dup", "type": "text",
                 "text": {"body": "Landed via the other delivery"}},
                # an innocent bystander in the same batch
                {"from": "918888888888", "id": "wamid.ok", "type": "text",
                 "text": {"body": "Namaste"}},
            ],
        }}]}],
    }
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(_SECRET.encode(), body,
                               hashlib.sha256).hexdigest()

    out = await whatsapp.webhook_receive(_Req(body, sig))

    assert out == {"ok": True}, (
        "a duplicate concurrent delivery must not fail the batch — Meta "
        "redelivers everything for ever on a non-200"
    )
    # the duplicate announced nothing; the bystander announced once
    assert len(inbound.calls) == 1, \
        "a message whose INSERT the unique index refused emitted an event"
    kw = _rode_the_write(pool, inbound.calls[0])
    assert kw["dedupe_key"] == "wa.in:wamid.ok"
    assert created.calls == [], "no contact was invented on either path"
    # both messages REACHED the insert — the duplicate was skipped at the
    # seam, not dropped before it
    attempts = [q for q, _ in pool.calls
                if "INSERT INTO public.varta_messages" in q]
    assert len(attempts) == 2


async def test_an_empty_wa_id_still_inserts_with_no_dedupe_key(monkeypatch):
    """A message Meta sends without an id cannot be deduped — but it is still
    a message someone sent. It lands (no seen-check, since there is nothing to
    look up) and the emit says dedupe_key=None rather than minting a colliding
    'wa.in:' for every id-less message."""
    pool = _webhook_pool(contact_exists=True)
    _created, inbound = _wire_webhook(monkeypatch, pool)

    req = _signed_request({"from": "919999999999", "id": "",
                           "type": "text", "text": {"body": "Hello"}})
    out = await whatsapp.webhook_receive(req)

    assert out == {"ok": True}
    assert any("INSERT INTO public.varta_messages" in q for q, _ in pool.calls), \
        "an id-less message still lands in the inbox"
    seen = [q for q, _ in pool.calls
            if "SELECT 1 FROM public.varta_messages" in q]
    assert seen == [], "no id, nothing to look up — the seen-check is skipped"
    assert len(inbound.calls) == 1
    kw = _rode_the_write(pool, inbound.calls[0])
    assert kw["dedupe_key"] is None
