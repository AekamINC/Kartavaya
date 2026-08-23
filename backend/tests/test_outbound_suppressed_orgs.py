"""OUTBOUND_SUPPRESSED_ORGS — the per-org gate that rides the mode gate.

`OUTBOUND_MODE=live` went on staging on 2026-08-18 so real orgs could receive
real mail — and the same flip armed the E2E test org, whose tables hold ~1,600
seeded `@example.com` addresses. RFC 2606 domains hard-bounce by definition, so
one payroll re-run or one campaign send from that org is hundreds of bounces
against the shared verified sender identity. The mode is all-or-nothing; the
list is the scalpel: an org on `OUTBOUND_SUPPRESSED_ORGS` is treated exactly as
dry mode treats everyone, while every other org keeps sending.

WHAT IS PINNED HERE

  1. A send from a listed org is stopped IN LIVE MODE, on every channel family
     the mode gate guards, and the ledger says so: status 'suppressed',
     mode 'live', `detail.suppressed_by = 'org'` — a true sentence about a
     message that never left, distinguishable from a dry-mode row.
  2. Every other org is untouched. The whole point of the list over the mode.
  3. Unset (or empty) means NOTHING is suppressed — the var must fail open,
     or production with no list set would go quiet.
  4. Malformed entries are ignored, loudly, one at a time — a typo'd id must
     not take the module down at import and must not widen into "suppress
     everything".
  5. The org the gate checks is the SAME org the row is filed under: explicit
     argument first, `org_scope()` context second. A send with NO org cannot
     match and stays governed by OUTBOUND_MODE alone.
  6. The real email choke point honours it: `email_service.send_email` returns
     at the gate, starts no thread, and never touches a provider.

STYLE. Same seams as `tests/test_outbound_log.py`: the conftest mock pool, the
thirteen parallel lists decoded back through `_INSERT_COLUMNS`, `DRY_RUN` and
`SUPPRESSED_ORGS` PATCHED on the module — never set in the environment, so a
leak cannot turn another test's mock into a real delivery.
"""
import json

import pytest

import outbound
from services import outbound_log

#: The org this feature was built for — the staging E2E org (frontend/e2e-real),
#: whose seeded rows are the fake-domain addresses. The literal id, not a
#: placeholder: this is the value the Railway var carries.
E2E_ORG = "64e7bea6-6abe-490c-a2a4-27a60c6be916"

#: A real customer on the same staging service. The one whose mail MUST leave.
OTHER_ORG = "22222222-2222-2222-2222-222222222222"

#: Every channel family the mode gate guards, spelled the way the senders
#: spell them (`services/outbound_log._SUBCHANNELS` is keyed on these).
CHANNELS = (
    ("email", "arjun.patel@example.com"),
    ("push:expo", "user_549c9cac35aa"),
    ("push:web", "user_549c9cac35aa"),
    ("social:facebook", "104857600"),
    ("social:whatsapp_business", "919876543210"),
    ("whatsapp", "919876543210"),
)


# ════════════════════════════════════════════════════════════════════════════
# HARNESS — the same seams as test_outbound_log.py, for the same reasons
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def clean_slate():
    """Empty the writer's buffer and the org context around every test.

    Both are process-wide singletons the rest of the suite fills; without this
    a row queued by an unrelated file lands in the middle of an assertion here
    and the failure names this file.
    """
    def _clear():
        outbound_log._pending.clear()
        outbound_log._open_rows.clear()
        outbound_log._updates.clear()
        outbound_log._dormant = False
        outbound_log._dropped = 0
        outbound_log._last_warn = 0.0
        outbound_log._task = None
        outbound._ORG_ID.set(None)
        outbound._USER_ID.set(None)

    _clear()
    yield
    _clear()


@pytest.fixture
def live_mode(monkeypatch):
    """Open the mode gate — conftest sets `OUTBOUND_MODE=dry` for the suite.

    `begin()` re-reads the module global on every call ("read now, so a test
    may patch it"), which is the only reason the live path is testable.
    Patched, never set, so it cannot leak and turn a mock into a delivery.
    """
    monkeypatch.setattr(outbound, "DRY_RUN", False)
    return False


@pytest.fixture
def e2e_org_suppressed(monkeypatch):
    """Put the E2E org on the list, the same way `live_mode` opens the gate.

    Patched at `outbound.SUPPRESSED_ORGS` — the module global `_org_suppressed`
    re-reads per call — never via the environment, which was consumed at import
    and would silently not apply.
    """
    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS", frozenset({E2E_ORG}))
    return E2E_ORG


def _rows_written(pool) -> list[dict]:
    """Every row bound into the INSERT, decoded back through `_INSERT_COLUMNS`.

    Positional on purpose: the writer sends thirteen parallel lists into an
    UNNEST, so this reads a row exactly as Postgres would assemble one.
    """
    rows: list[dict] = []
    for call in list(pool.execute.call_args_list) + list(pool.fetch.call_args_list):
        args = call.args
        if not args or "INSERT INTO staging.outbound_log" not in str(args[0]):
            continue
        columns = args[1:]
        assert len(columns) == len(outbound_log._INSERT_COLUMNS)
        for values in zip(*columns):
            rows.append(dict(zip(outbound_log._INSERT_COLUMNS, values)))
    return rows


def _detail(row: dict) -> dict:
    return json.loads(row["detail"])


# ════════════════════════════════════════════════════════════════════════════
# 1. A LISTED ORG'S SEND IS STOPPED IN LIVE MODE, AND THE LEDGER SAYS WHY
#
# This is the deployment the feature exists for: OUTBOUND_MODE=live on staging,
# the E2E org on the list, everything else flowing.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_listed_orgs_email_is_suppressed_in_live_mode(
    mock_pool, live_mode, e2e_org_suppressed,
):
    assert outbound.DRY_RUN is False, "this test is about LIVE mode"

    blocked = outbound.suppressed(
        "email", "priya.sharma@example.com", "Payslip for August 2026",
        org_id=E2E_ORG, ref="payslip:PS-2026-08-42", bytes=41_000,
    )

    assert blocked is True, (
        "OUTBOUND_MODE=live let the E2E org send — every seeded @example.com "
        "address is a hard bounce against the verified sender domain"
    )
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1, "one attempt is one row — the ledger stays a count"
    row = rows[0]

    assert row["status"] == outbound_log.STATUS_SUPPRESSED == "suppressed"
    # 098: "A suppressed row with a provider set would be claiming a decision
    # that was never made." Same rule whichever gate fired.
    assert row["provider"] is None
    assert row["provider_message_id"] is None
    # The row is filed under the org that was suppressed — the ledger answers
    # "what did we refuse to send this org", not just "what did we refuse".
    assert str(row["org_id"]) == E2E_ORG
    # TRUTHFUL, NOT CONVENIENT: the process was live, so the row says live.
    # mode='live' + status='suppressed' is exactly the pairing that tells the
    # org gate apart from dry mode, and `suppressed_by` names the switch.
    assert _detail(row)["mode"] == "live"
    assert _detail(row)["suppressed_by"] == "org"
    # The attempt is still fully described — what it WOULD have cost is the
    # only figure this row will ever carry.
    assert row["bytes"] == 41_000
    assert row["purpose"] == "payslip"


@pytest.mark.parametrize("channel,target", CHANNELS)
async def test_every_channel_the_mode_gate_guards_is_guarded(
    mock_pool, live_mode, e2e_org_suppressed, channel, target,
):
    """The org check rides `begin()`, so coverage is structural, not per-sender.

    Stated over all the families rather than email alone, for the reason the
    module header records about WhatsApp: an exemption (or an omission) on the
    one channel nobody re-checked is how dry mode missed P7's sends for nine
    days.
    """
    assert outbound.suppressed(channel, target, "subject", org_id=E2E_ORG) is True

    await outbound_log.flush()
    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    assert rows[0]["status"] == "suppressed"
    assert rows[0]["provider"] is None, "no carrier was ever chosen"


async def test_the_org_from_the_request_context_is_matched_too(
    mock_pool, live_mode, e2e_org_suppressed,
):
    """The gate checks the SAME org the row is filed under.

    `email_service.send_email(to, subject, html)` has no org parameter — the
    org arrives via the ContextVar the middleware (or `org_scope()`) set. A
    check that only saw the explicit argument would wave through every sender
    in the product that relies on the context, which is most of them.
    """
    with outbound.org_scope(E2E_ORG, "user_e2e001"):
        blocked = outbound.suppressed(
            "email", "rahul.verma@example.com", "Invoice INV-042")

    assert blocked is True
    await outbound_log.flush()
    row = _rows_written(mock_pool)[0]
    assert row["status"] == "suppressed"
    assert str(row["org_id"]) == E2E_ORG


async def test_a_suppressed_org_attempt_cannot_be_completed_as_sent(
    mock_pool, live_mode, e2e_org_suppressed,
):
    """Gate parity with dry mode: nothing was handed to a provider, so a
    reported message id is a claim the row must refuse — `Attempt._closed`
    starts True for a blocked send, whichever gate blocked it."""
    att = outbound.begin("email", "priya.sharma@example.com", "August payslip",
                         org_id=E2E_ORG)
    assert att.blocked is True

    att.sent("0100018f-ses-message-id", provider="ses")
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert [r["status"] for r in rows] == ["suppressed"]
    assert rows[0]["provider_message_id"] is None


# ════════════════════════════════════════════════════════════════════════════
# 2. EVERY OTHER ORG IS UNTOUCHED
#
# The reason this is a list and not a mode: staging is live for real customers.
# ════════════════════════════════════════════════════════════════════════════

async def test_an_unlisted_org_sends_normally(
    mock_pool, live_mode, e2e_org_suppressed,
):
    blocked = outbound.suppressed(
        "email", "owner@unicodegroup.com", "Invoice INV-042", org_id=OTHER_ORG)

    assert blocked is False, (
        "an org that is not on the list was suppressed — the scalpel became "
        "the mode, and staging stopped sending for every real customer"
    )
    await outbound_log.flush()

    rows = _rows_written(mock_pool)
    assert len(rows) == 1, "the attempt is still recorded — the gate opened"
    row = rows[0]
    assert row["status"] == outbound_log.STATUS_QUEUED == "queued"
    assert _detail(row)["mode"] == "live"
    assert "suppressed_by" not in _detail(row)


async def test_a_send_with_no_org_stays_governed_by_the_mode_alone(
    mock_pool, live_mode, e2e_org_suppressed,
):
    """No explicit org, no context: a password reset, a bare worker.

    Suppressing every unattributed send would silently kill production
    password resets; guessing an org is worse than the gap. So None cannot
    match the list, and in live mode the send proceeds.
    """
    assert outbound.current_org() is None
    assert outbound.suppressed("email", "someone@customer.example",
                               "Reset your password") is False

    await outbound_log.flush()
    assert _rows_written(mock_pool)[0]["status"] == "queued"


async def test_a_non_uuid_org_id_at_the_gate_neither_matches_nor_raises(
    mock_pool, live_mode, e2e_org_suppressed,
):
    """'platform', a slug, '' — the strings callers really pass.

    The gate must be incapable of failing a send (`begin()` never raises), so
    an unparseable org answers "not on the list" rather than an exception.
    """
    for bad in ("platform", "", "org-42"):
        assert outbound.suppressed("email", "a@b.example", "s", org_id=bad) is False


# ════════════════════════════════════════════════════════════════════════════
# 3. UNSET MEANS NOTHING IS SUPPRESSED
# ════════════════════════════════════════════════════════════════════════════

async def test_an_unset_var_suppresses_nothing(mock_pool, live_mode, monkeypatch):
    """Production has no list set; the parse of nothing must be the empty set
    and the empty set must gate nothing — the var fails OPEN."""
    assert outbound._parse_suppressed_orgs(None) == frozenset()
    assert outbound._parse_suppressed_orgs("") == frozenset()

    monkeypatch.setattr(outbound, "SUPPRESSED_ORGS", frozenset())
    assert outbound.suppressed(
        "email", "owner@unicodegroup.com", "Invoice", org_id=E2E_ORG) is False

    await outbound_log.flush()
    assert _rows_written(mock_pool)[0]["status"] == "queued"


# ════════════════════════════════════════════════════════════════════════════
# 4. MALFORMED ENTRIES ARE IGNORED, ONE AT A TIME
# ════════════════════════════════════════════════════════════════════════════

def test_malformed_entries_are_dropped_and_the_valid_ones_kept():
    """A typo beside the E2E org must not unlist the E2E org.

    Parsed entry by entry: the bad ones are dropped (with a boot-time warning,
    asserted below), the good ones survive, and nothing raises at import.
    """
    parsed = outbound._parse_suppressed_orgs(
        f"not-a-uuid, ,platform,{E2E_ORG},64e7bea6")
    assert parsed == frozenset({E2E_ORG})


def test_a_malformed_entry_is_ignored_loudly(caplog):
    """Dropped WITH a line — the operator who typo'd the one id the list
    exists for finds out at boot, not from a bounce report."""
    import logging

    with caplog.at_level(logging.WARNING, logger="outbound"):
        parsed = outbound._parse_suppressed_orgs("oops-not-an-id")
    assert parsed == frozenset()
    assert any("IGNORED" in r.message for r in caplog.records)


def test_spellings_are_canonicalised_to_one_org():
    """Uppercase, braced and hyphenless spellings all name the same org —
    matched the way `outbound_log._as_uuid` reads the org on the row."""
    variants = ",".join([
        E2E_ORG.upper(),
        "{" + E2E_ORG + "}",
        E2E_ORG.replace("-", ""),
    ])
    assert outbound._parse_suppressed_orgs(variants) == frozenset({E2E_ORG})


async def test_a_uuid_object_at_the_gate_matches_the_list(
    mock_pool, live_mode, e2e_org_suppressed,
):
    """Callers pass org ids as strings AND as uuid.UUID — both must match."""
    import uuid as _uuid

    assert outbound.suppressed(
        "email", "a@example.com", "s", org_id=_uuid.UUID(E2E_ORG)) is True


# ════════════════════════════════════════════════════════════════════════════
# 5. DRY MODE STILL SUPPRESSES A LISTED ORG (AND SAYS 'dry')
# ════════════════════════════════════════════════════════════════════════════

async def test_dry_mode_plus_a_listed_org_is_still_suppressed(
    mock_pool, e2e_org_suppressed,
):
    """conftest's dry mode is in force here. The two gates are OR'd, not
    exclusive, and the row records the mode the process was really in."""
    assert outbound.DRY_RUN is True, "conftest sets OUTBOUND_MODE=dry"

    assert outbound.suppressed("email", "a@example.com", "s",
                               org_id=E2E_ORG) is True
    await outbound_log.flush()
    row = _rows_written(mock_pool)[0]
    assert row["status"] == "suppressed"
    assert _detail(row)["mode"] == "dry"


# ════════════════════════════════════════════════════════════════════════════
# 6. THE REAL EMAIL CHOKE POINT HONOURS IT
#
# Everything above exercises the gate through its own API. This is the claim
# that matters on staging: the sender every email in the product goes through
# returns at the gate — no thread, no provider, nothing on the wire.
# ════════════════════════════════════════════════════════════════════════════

async def test_send_email_from_the_listed_org_never_touches_a_provider(
    mock_pool, live_mode, e2e_org_suppressed, monkeypatch,
):
    import threading

    import email_service

    provider_calls: list = []

    class _SES:
        def send_email(self, **kwargs):
            provider_calls.append(kwargs)
            return {"MessageId": "must-never-exist"}

    threads_started: list = []

    class _Threading:
        @staticmethod
        def Thread(*args, **kwargs):
            t = threading.Thread(*args, **kwargs)
            threads_started.append(t)
            return t

    monkeypatch.setattr(email_service, "ses_client", _SES())
    monkeypatch.setattr(email_service, "threading", _Threading)

    with outbound.org_scope(E2E_ORG, "user_e2e001"):
        # Returns True — the deliberate exception `send_email` documents: the
        # operator asked for nothing to leave, and the ledger says so.
        assert email_service.send_email(
            "priya.sharma@example.com", "Payslip for August 2026",
            "<!DOCTYPE html><html><body><p>Payslip</p></body></html>",
            purpose="payslip",
        ) is True

    assert not threads_started, "a suppressed send must not even start a thread"
    assert not provider_calls, "the provider was called for a suppressed org"

    await outbound_log.flush()
    rows = _rows_written(mock_pool)
    assert len(rows) == 1
    assert rows[0]["status"] == "suppressed"
    assert str(rows[0]["org_id"]) == E2E_ORG
