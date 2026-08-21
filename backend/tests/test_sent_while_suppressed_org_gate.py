"""The sent-while-suppressed disease, per-org edition: bookkeeping must ask
`outbound.is_suppressed(org)`, never `outbound.DRY_RUN`.

THE HOLE. `OUTBOUND_SUPPRESSED_ORGS` blocks a listed org's sends at
`outbound.begin()` while the process is LIVE — `DRY_RUN` reads False the
whole time. Three callers decided their own status columns by reading
`outbound.DRY_RUN` alone, so for a listed org every one of them stamped
`status='sent', sent_at=NOW()` over messages the gate refused:

    routers/prachar.py        — the interactive campaign dispatch
    services/reminder_service — the reminder loop (the original 1,562-row lie)
    services/skills/action/campaign_sender.py — the scheduled campaign runner

The cure is ONE predicate, `outbound.is_suppressed(org_id)`, true when
either gate (mode or list) would stop that org's send, consulted by every
bookkeeping caller with the SAME org the send runs under.

WHAT IS PINNED HERE, for each of the three callers, in a LIVE process:
  · a listed org's run records 'suppressed' bookkeeping;
  · an unlisted org's run still records 'sent' — the list is a scalpel,
    not a second dry mode.

STYLE. Each caller is driven through its own file's existing rig (the
reminder MagicMock pool from test_reminders_respect_people.py, the scripted
pools from test_prachar_drip.py / test_niyam_wiring_prachar_whatsapp.py).
`DRY_RUN` and `SUPPRESSED_ORGS` are PATCHED on the outbound module — never
set in the environment — the idiom test_outbound_suppressed_orgs.py
documents: `begin()` and `is_suppressed()` re-read the module globals per
call precisely so a test may patch them, and a patch cannot leak and turn
another test's mock into a real delivery.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

import outbound
from services import outbound_log


@pytest.fixture(autouse=True)
def _clean_outbound_buffer():
    """`begin()` buffers a ledger row per attempt; empty the process-wide
    buffer around every test so nothing here leaks into another file's
    assertions (the same hygiene test_outbound_suppressed_orgs.py keeps)."""
    outbound_log._pending.clear()
    outbound_log._updates.clear()
    outbound_log._open_rows.clear()
    yield
    outbound_log._pending.clear()
    outbound_log._updates.clear()
    outbound_log._open_rows.clear()


#: The org this gate was built for — the staging E2E org, same literal as
#: test_outbound_suppressed_orgs.py.
LISTED_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"

#: A real customer org on the same service: the one whose mail MUST leave.
OTHER_ORG = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def live_with_listed_org(monkeypatch):
    """A LIVE process with the E2E org on the list — the exact deployment the
    per-org gate exists for, and the state where reading DRY_RUN lies."""
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS", frozenset({LISTED_ORG}))


# ════════════════════════════════════════════════════════════════════════════
# 0. THE PREDICATE ITSELF — both gates, one answer, never an exception
# ════════════════════════════════════════════════════════════════════════════


def test_is_suppressed_reads_both_gates(live_with_listed_org, monkeypatch):
    assert outbound.is_suppressed(LISTED_ORG) is True
    assert outbound.is_suppressed(OTHER_ORG) is False
    assert outbound.is_suppressed(None) is False, \
        "no attributable org — governed by the mode alone, which is live"
    monkeypatch.setattr(outbound, "DRY_RUN", True)
    assert outbound.is_suppressed(OTHER_ORG) is True, "dry mode stops everyone"
    assert outbound.is_suppressed(None) is True


def test_is_suppressed_never_raises_on_garbage(live_with_listed_org):
    """Bookkeeping must not be able to fail a send path."""
    for bad in ("platform", "", "org-42", 42, object()):
        assert outbound.is_suppressed(bad) is False


def test_the_predicate_answers_exactly_what_begin_answered(
    live_with_listed_org,
):
    """The whole contract: `is_suppressed(org)` is `begin(...).blocked` for
    the same org — so a caller's status column can never disagree with the
    ledger's again."""
    for org in (LISTED_ORG, OTHER_ORG, None):
        att = outbound.begin("email", "a@example.com", "s", org_id=org)
        assert outbound.is_suppressed(org) is att.blocked, org


# ════════════════════════════════════════════════════════════════════════════
# 1. THE REMINDER LOOP (services/reminder_service.py)
#
# The module the disease is named after: 1,562 reminders said 'sent' while
# 1,562 outbound rows said 'suppressed'. The rig is
# test_reminders_respect_people.py's, org swapped per test.
# ════════════════════════════════════════════════════════════════════════════

from services import reminder_service  # noqa: E402


def _reminder(org_id, **over):
    base = {"id": 1, "org_id": org_id, "channel": "email",
            "email": "someone@example.com", "recipient_user_id": "user_x",
            "reminder_type": "invoice_overdue", "message": "m"}
    base.update(over)
    return base


def _reminder_pool(monkeypatch, org_id):
    p = MagicMock()
    p.fetch = AsyncMock(return_value=[_reminder(org_id)])
    p.fetchrow = AsyncMock(return_value=None)     # no prefs row → defaults
    p.execute = AsyncMock(return_value="UPDATE 1")

    async def _get_pool():
        return p

    monkeypatch.setattr(reminder_service, "get_pool", _get_pool)
    monkeypatch.setattr("email_service.send_email", lambda **k: True)
    monkeypatch.setattr("services.push_service._in_quiet_hours",
                        lambda *a, **k: False)
    return p


def _reminder_statuses(pool):
    out = []
    for call in pool.execute.await_args_list:
        args = call.args
        if args and "staging.reminders SET status" in args[0]:
            out.append(args[2] if len(args) > 2 else
                       ("suppressed" if "'suppressed'" in args[0] else "sent"))
    return out


@pytest.mark.asyncio
async def test_a_listed_orgs_reminder_is_recorded_suppressed_in_live_mode(
    live_with_listed_org, monkeypatch,
):
    """DRY_RUN is False here. Reading it would say 'sent' — the 1,562-row
    lie, re-told through the org gate."""
    pool = _reminder_pool(monkeypatch, LISTED_ORG)
    await reminder_service.process_pending_reminders()
    assert _reminder_statuses(pool) == ["suppressed"], (
        "the org gate refused the send in a live process and the reminder "
        "recorded 'sent' — bookkeeping read DRY_RUN instead of the gate"
    )


@pytest.mark.asyncio
async def test_an_unlisted_orgs_reminder_is_still_recorded_sent(
    live_with_listed_org, monkeypatch,
):
    pool = _reminder_pool(monkeypatch, OTHER_ORG)
    out = await reminder_service.process_pending_reminders()
    assert out["sent"] == 1
    assert _reminder_statuses(pool) == ["sent"], (
        "an org that is not on the list had its reminder written as "
        "suppressed — the scalpel became the mode"
    )


# ════════════════════════════════════════════════════════════════════════════
# 2. THE SCHEDULED CAMPAIGN RUNNER (services/skills/action/campaign_sender.py)
#
# Scripted pool in the test_prachar_drip.py manner: answers each statement by
# a fragment of its SQL and records every write.
# ════════════════════════════════════════════════════════════════════════════

CAMP_ID = "11111111-1111-1111-1111-111111111111"


class _CampaignPool:
    def __init__(self, org_id):
        self.org_id = org_id
        self.executed: list[tuple] = []

    async def fetchrow(self, sql, *args):
        if "FROM staging.prachar_campaigns c" in sql:
            return {"id": CAMP_ID, "org_id": self.org_id, "name": "Diwali",
                    "subject": "Hello {{name}}", "body_html": "<p>Hi</p>",
                    "channel": "email", "status": "scheduled",
                    "template_id": None, "audience_filter": {},
                    "org_name": "Acme"}
        return None

    async def fetchval(self, sql, *args):
        # The ICAI gate re-reads client linkage off the materialised rows before
        # anything is sent (`services/prachar_compliance.py`). This fixture's one
        # recipient is a client, so the gate finds nobody to refuse — which is
        # what lets this test go on asking the question it is actually about,
        # namely what the outbound suppression gate records.
        if "gc.client_id IS NULL" in sql:
            return 0
        # "already materialised" — keeps the runner off the router import.
        if "COUNT(*) FROM staging.prachar_campaign_contacts" in sql:
            return 1
        return 0

    async def fetch(self, sql, *args):
        if "FROM staging.prachar_campaign_contacts cc" in sql:
            return [{"id": "cc1", "contact_id": "ct1",
                     "email": "lead@example.com", "name": "A",
                     # campaign_sender selects `c.company` for {{company}}
                     "company": "A Ltd"}]
        return []

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))
        return "UPDATE 1"

    def wrote(self, needle):
        return [(s, a) for s, a in self.executed if needle in s]


async def _run_scheduled_campaign(monkeypatch, org_id):
    import email_service
    import services.skills.action.campaign_sender as sender

    monkeypatch.setattr(email_service, "send_email", lambda *a, **k: True)
    pool = _CampaignPool(org_id)
    result = await sender.send_campaign(pool, CAMP_ID)
    return pool, result


@pytest.mark.asyncio
async def test_a_listed_orgs_scheduled_campaign_records_suppressed(
    live_with_listed_org, monkeypatch,
):
    pool, result = await _run_scheduled_campaign(monkeypatch, LISTED_ORG)
    assert result["suppressed"] == 1 and result["sent"] == 0
    assert pool.wrote("SET status = 'suppressed'"), \
        "the contact row does not say the gate stopped it"
    assert not pool.wrote("SET status = 'sent'"), (
        "a live process + a listed org wrote 'sent' over a message the org "
        "gate refused — the runner read DRY_RUN instead of the gate"
    )
    # …and the campaign itself is 'suppressed' with sent_at cleared, the
    # zero-delivery contract this module already keeps for dry mode.
    camp = pool.wrote("UPDATE staging.prachar_campaigns")
    assert any("'suppressed'" in s for s, _ in camp)


@pytest.mark.asyncio
async def test_an_unlisted_orgs_scheduled_campaign_still_records_sent(
    live_with_listed_org, monkeypatch,
):
    pool, result = await _run_scheduled_campaign(monkeypatch, OTHER_ORG)
    assert result["sent"] == 1 and result["suppressed"] == 0
    assert pool.wrote("SET status = 'sent'")
    assert not pool.wrote("SET status = 'suppressed'")


# ════════════════════════════════════════════════════════════════════════════
# 3. THE INTERACTIVE DISPATCH (routers/prachar.py)
#
# The rig is test_niyam_wiring_prachar_whatsapp.py's `_run_send`: the route
# is called directly, its background `_dispatch` gathered to completion, and
# the writes read back off the pool ledger.
# ════════════════════════════════════════════════════════════════════════════

import routers.prachar as prachar  # noqa: E402


class _RoutePool:
    """The wiring file's pool: distinct lent conns so the terminal write's
    transaction (and its emitter) still runs."""

    def __init__(self):
        self.calls = []

    async def fetch(self, q, *a):
        self.calls.append((q, a))
        return []

    async def execute(self, q, *a):
        self.calls.append((q, a))
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        self.calls.append((q, a))
        return None

    def acquire(self):
        pool = self

        class _Conn:
            in_tx = False

            async def fetchrow(self, q, *a):
                return await pool.fetchrow(q, *a)

            async def execute(self, q, *a):
                return await pool.execute(q, *a)

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

        class _A:
            async def __aenter__(_s):
                return _Conn()

            async def __aexit__(_s, *exc):
                return False
        return _A()


async def _run_interactive_send(monkeypatch, org_id):
    pool = _RoutePool()

    async def _get_pool():
        return pool

    monkeypatch.setattr(prachar, "get_pool", _get_pool)
    monkeypatch.setattr(prachar, "send_email", lambda *a, **k: True)

    async def _emit(_conn, **kw):
        return 1

    monkeypatch.setattr(prachar, "campaign_sent", _emit)

    async def _audience(_pool, _org, _filters):
        # `client_id` because the real resolver now filters on it and `/send`
        # refuses an audience containing anybody the firm does not act for
        # (ICAI Clause 6 — see services/prachar_compliance.py). A stub that
        # omits it makes this test assert a 403 about advertising conduct
        # instead of the outbound suppression it is here to check.
        return [{"id": "22222222-2222-2222-2222-222222222222",
                 "email": "lead@example.com", "name": "A", "company": "",
                 "client_id": "33333333-3333-3333-3333-333333333333"}]

    monkeypatch.setattr(prachar, "_resolve_audience", _audience)

    campaign = {"id": CAMP_ID, "name": "Diwali offer", "channel": "email",
                "status": "draft", "audience_filter": {},
                "subject": "Hello {{name}}", "body_html": "<p>Namaste</p>",
                "template_id": None, "total_recipients": 1}

    async def _fetchrow(q, *a):
        pool.calls.append((q, a))
        if "UPDATE staging.prachar_campaigns" in q and "RETURNING" in q:
            return dict(campaign, status="sent", total_recipients=a[0])
        if "SELECT * FROM staging.prachar_campaigns" in q:
            return dict(campaign)
        return None

    pool.fetchrow = _fetchrow

    await prachar.send_campaign(CAMP_ID, user={"user_id": "u9"}, org_id=org_id)
    pending = list(prachar._background_tasks)
    if pending:
        await asyncio.gather(*pending)
    return pool


@pytest.mark.asyncio
async def test_a_listed_orgs_interactive_send_records_suppressed(
    live_with_listed_org, monkeypatch,
):
    pool = await _run_interactive_send(monkeypatch, LISTED_ORG)
    contact_writes = [q for q, _ in pool.calls
                      if "UPDATE staging.prachar_campaign_contacts" in q]
    assert any("status='suppressed'" in q for q in contact_writes), \
        "the contact row does not say the gate stopped it"
    assert not any("status='sent'" in q for q in contact_writes), (
        "a live process + a listed org wrote 'sent', sent_at=NOW() over a "
        "message the org gate refused — the dispatch read DRY_RUN instead "
        "of the gate"
    )
    # zero delivered → the campaign is 'suppressed' with sent_at cleared
    assert any("status='suppressed'" in q and "sent_at=NULL" in q
               for q, _ in pool.calls
               if "UPDATE staging.prachar_campaigns" in q)


@pytest.mark.asyncio
async def test_an_unlisted_orgs_interactive_send_still_records_sent(
    live_with_listed_org, monkeypatch,
):
    pool = await _run_interactive_send(monkeypatch, OTHER_ORG)
    contact_writes = [q for q, _ in pool.calls
                      if "UPDATE staging.prachar_campaign_contacts" in q]
    assert any("status='sent'" in q for q in contact_writes)
    assert not any("status='suppressed'" in q for q in contact_writes)
