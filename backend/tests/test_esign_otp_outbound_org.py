"""The signing OTP must leave the building WITH an organisation on it.

── The defect this pins, measured rather than read ──────────────────────────

`POST /api/v1/esign/verify/{token}/otp/send` is a PUBLIC endpoint — no
`require_user`, no `get_org_id` — so the ContextVar `outbound.begin()` reads the
org from is unset when it calls `send_email(purpose="signing_otp")`.

Measured against staging on 2026-08-29, driving the real signing page in a fresh
browser context (proposal 93, Suite 15, test 15.08b):

    purpose            status  org_id
    signing_otp        sent    NULL          ← the code the signer types in
    signature_request  sent    fae87907-…    ← sent from an authenticated route
    signature_reminder sent    fae87907-…    ← sent from an authenticated route

The mail is genuinely sent and the row is genuinely written; it simply carries
no tenant. Every org-scoped read of `staging.outbound_log` is
`WHERE org_id = $1::uuid` (`routers/billing.py`), and
`/api/v1/billing/me/outbound/messages` reports `excludes_orgless: true` in its
own body — so a firm whose client says "I never got a code" opens the one screen
that answers that question per address and is told nothing was ever sent.

`email_service.send_email` names the outcome by hand: "a send from this function
with neither is an outbound row no org can ever see."

── Why this test asserts what it asserts ────────────────────────────────────

`outbound.begin()` captures on the CALLER's thread, before `send_email` hands
the provider call to a background thread — `email_service` says so at the
`plan()` call: "`threading.Thread` starts with an EMPTY context, and a read from
in there" is the thing to avoid. So the fact worth pinning is that
`outbound.current_org()` resolves to the DOCUMENT's org at the moment
`send_email` is entered. That is exactly what the row will carry.

The org is taken off `sign_documents`, not off `s.*`: `create_document` inserts
its signer rows without an `org_id` at all — only the Ganit path fills that
column — so `sign_signers.org_id` is NULL for every signer raised in this
module, and leaning on it would have been a fix that changed nothing.

⚠ PROVED TO BITE. With the `org_scope` block removed from `send_otp` this test
fails with `current_org() -> None`; restored, it passes. Recorded 2026-08-29.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import outbound
from routers import esign

DOC_ID = uuid.UUID("00000000-0000-0000-0000-0000000000dd")
SIGNER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
DOC_ORG = "fae87907-2f99-4b35-a241-c94d9e1e4a17"


class _Req:
    class _C:
        host = "203.0.113.9"
    client = _C()
    headers = {"user-agent": "pytest"}


def _signer_row():
    return {
        "id": SIGNER_ID,
        "document_id": DOC_ID,
        "name": "Asha Rao",
        "email": "success+otporg@simulator.amazonses.com",
        "status": "sent",
        "title": "Engagement letter",
        "doc_status": "sent",
        # ⚠ NULL on purpose. This is what `create_document` actually writes, and
        # a fix that read this column would have been a no-op.
        "org_id": None,
        "doc_org_id": DOC_ORG,
        "otp_code": None,
        "otp_expires_at": None,
    }


class _Pool:
    def __init__(self, row):
        self.row = row
        self.executed = []

    async def fetchrow(self, q, *_a, **_k):
        return self.row

    async def execute(self, q, *_a, **_k):
        self.executed.append(q)
        return None

    async def fetch(self, *_a, **_k):
        return []

    async def fetchval(self, *_a, **_k):
        return 1


@pytest.fixture
def sending(monkeypatch):
    """Install a pool and capture what `outbound` resolves at send time."""
    pool = _Pool(_signer_row())

    async def _get_pool():
        return pool

    monkeypatch.setattr(esign, "get_pool", _get_pool)

    seen = {}

    def _send_email(**kw):
        # The value `begin()` would read, read at the same moment and on the
        # same thread. Nothing here touches a provider or a database.
        seen["org"] = outbound.current_org()
        seen["purpose"] = kw.get("purpose")
        seen["to"] = kw.get("to_email")
        return True

    import email_service
    monkeypatch.setattr(email_service, "send_email", _send_email)

    # `send_otp` keeps its rate-limit ledger on the function object; a previous
    # test in the same process would otherwise spend this one's budget.
    if hasattr(esign.send_otp, "_sends"):
        esign.send_otp._sends.clear()

    return pool, seen


@pytest.mark.asyncio
async def test_the_signing_otp_carries_the_documents_org(sending):
    _pool, seen = sending

    out = await esign.send_otp("tok-otp-org", _Req())

    assert out["sent"] is True
    assert seen["purpose"] == "signing_otp"
    assert seen["org"] == DOC_ORG, (
        "the one-time code was sent with org=%r. A NULL org here is an "
        "`outbound_log` row no organisation can ever read: every org-scoped "
        "read of that table is `WHERE org_id = $1::uuid`, and "
        "/api/v1/billing/me/outbound/messages reports excludes_orgless=true. "
        "The firm would be told nothing was sent to a signer who was emailed a "
        "code." % (seen["org"],)
    )


@pytest.mark.asyncio
async def test_the_scope_is_put_back_afterwards(sending):
    """`org_scope`, not `set_org` — a request path must not leak its org."""
    before = outbound.current_org()
    await esign.send_otp("tok-otp-org-2", _Req())
    assert outbound.current_org() == before, (
        "send_otp left the outbound org set after it returned. This is a "
        "request path with no task boundary to throw the value away, so the "
        "next send on this worker would be attributed to the wrong tenant — "
        "which is why support_session.py:816 and reminder_service.py:546 both "
        "use `org_scope` rather than `set_org`."
    )
