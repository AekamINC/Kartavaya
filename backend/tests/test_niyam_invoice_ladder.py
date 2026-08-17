"""The A4 ladder's customer rung: gated, re-checked, and honest about stops.

Catalogue #1 (approved): "Chases an unpaid invoice on a schedule … Stops the
moment the customer pays, part-pays, or you put it on hold." The cadence is
the `invoices_overdue` predicate re-firing weekly; the verb sends one note per
firing and re-reads the CURRENT invoice row for every stop, because "paid"
only ever arrives by bank reconciliation and the event snapshot can be days
staler than the ledger.

The whole rung ships INERT: `NIYAM_CUSTOMER_MAIL` (A0 Q1) is off by default,
and the refusal names the variable so the runs pane answers "why did nothing
send" without a shell.
"""
from __future__ import annotations

import datetime

import pytest

ORG = "11111111-2222-3333-4444-555555555555"
INV = "99999999-8888-7777-6666-555555555555"


def _invoice(**over):
    row = {
        "invoice_number": "INV-042",
        "invoice_date": datetime.date(2026, 7, 1),
        "due_date": datetime.date(2026, 7, 31),
        "total": 118000.0,
        "amount_paid": 0.0,
        "balance_due": 118000.0,
        "payment_status": "unpaid",
        "cancelled_at": None,
        "is_active": True,
        "contact_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "client_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    }
    row.update(over)
    return row


class _Conn:
    def __init__(self, invoice=None, contact_email=None, client_emails=()):
        self.invoice = invoice
        self.contact_email = contact_email
        self.client_emails = list(client_emails)

    async def fetchrow(self, sql, *a):
        assert "FROM staging.ganit_invoices" in sql
        assert "org_id = $2::uuid" in sql, "the invoice fetch must be org-scoped"
        return dict(self.invoice) if self.invoice else None

    async def fetchval(self, sql, *a):
        assert "FROM staging.graha_contacts" in sql
        return self.contact_email

    async def fetch(self, sql, *a):
        assert "client_id = $1::uuid" in sql
        return [{"email": e} for e in self.client_emails]


def _event():
    return {"entity_id": INV, "org_id": ORG,
            "payload": {"after": {"invoice_number": "INV-042"}}}


async def _run(conn, monkeypatch=None, armed=False):
    from services.niyam.actions import ACTIONS
    if monkeypatch is not None and armed:
        monkeypatch.setenv("NIYAM_CUSTOMER_MAIL", "1")
    return await ACTIONS["invoice.remind_customer"].run(
        conn, config={}, event=_event())


# ── the gate ─────────────────────────────────────────────────────────────────

async def test_shipped_state_refuses_and_names_the_variable():
    """Unset means off, and the refusal must say WHICH switch is closed —
    'customer mail is not armed' with the variable name, not a generic fail."""
    conn = _Conn(invoice=_invoice(), contact_email="accounts@customer.example")
    r = await _run(conn)
    assert r.outcome == "refused"
    assert "NIYAM_CUSTOMER_MAIL" in r.detail["reason"]


async def test_armed_it_hands_to_the_single_choke_point(monkeypatch):
    """With the gate open, the send goes through email_service.send_email —
    where OUTBOUND_MODE, _safe_subject and outbound_log all live — with the
    invoice purpose, and the body is escaped wholesale."""
    import email_service

    sent = []

    def spy(address, subject, html_body, **kw):
        sent.append((address, subject, html_body, kw))
        return True

    monkeypatch.setattr(email_service, "send_email", spy)
    conn = _Conn(invoice=_invoice(), contact_email="accounts@customer.example")
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "ok", r.detail
    [(address, subject, html_body, kw)] = sent
    assert address == "accounts@customer.example"
    assert "INV-042" in subject
    assert kw["purpose"] == "invoice_reminder"
    assert "&lt;" not in html_body and "<script" not in html_body
    # The detail names the invoice and the SOURCE of the address, never the
    # address itself — outbound_log holds that; the runs pane must not.
    assert "accounts@customer.example" not in str(r.detail)
    assert "INV-042" in r.detail["reason"]


async def test_a_hostile_invoice_number_cannot_reach_html(monkeypatch):
    """The body is composed from CRM data a customer can influence. Escaped
    at the choke point in send.py, not trusted here."""
    import email_service

    sent = []
    monkeypatch.setattr(email_service, "send_email",
                        lambda a, s, h, **kw: sent.append(h) or True)
    conn = _Conn(invoice=_invoice(invoice_number='<img src=x onerror=alert(1)>'),
                 contact_email="a@b.example")
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "ok"
    assert "<img" not in sent[0]
    assert "&lt;img" in sent[0]


# ── the stops, re-checked at run time ────────────────────────────────────────

@pytest.mark.parametrize("row,phrase", [
    (_invoice(payment_status="paid", balance_due=0.0, amount_paid=118000.0),
     "paid"),
    (_invoice(balance_due=0.0), "paid"),
    (_invoice(amount_paid=500.0, payment_status="partial",
              balance_due=117500.0), "part-payment"),
    (_invoice(cancelled_at=datetime.datetime(2026, 8, 1,
                                             tzinfo=datetime.timezone.utc)),
     "cancelled"),
    (_invoice(is_active=False), "cancelled"),
], ids=["paid", "zero-balance", "part-paid", "cancelled", "deactivated"])
async def test_the_chase_stops_on_current_state(monkeypatch, row, phrase):
    """Every stop reads the row as it is NOW, so an invoice settled between
    the weekly firing and the run refuses instead of dunning somebody who
    already paid — the exact failure A0 Q1 exists to prevent."""
    conn = _Conn(invoice=row, contact_email="a@b.example")
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "refused"
    assert phrase in r.detail["reason"]


async def test_a_vanished_invoice_is_a_refusal_not_a_fault(monkeypatch):
    r = await _run(_Conn(invoice=None), monkeypatch, armed=True)
    assert r.outcome == "refused"


# ── the address ──────────────────────────────────────────────────────────────

async def test_the_invoice_contact_wins_over_the_client_book(monkeypatch):
    import email_service
    sent = []
    monkeypatch.setattr(email_service, "send_email",
                        lambda a, s, h, **kw: sent.append(a) or True)
    conn = _Conn(invoice=_invoice(), contact_email="named@customer.example",
                 client_emails=["other@customer.example"])
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "ok"
    assert sent == ["named@customer.example"]


async def test_exactly_one_client_contact_is_a_fallback(monkeypatch):
    import email_service
    sent = []
    monkeypatch.setattr(email_service, "send_email",
                        lambda a, s, h, **kw: sent.append(a) or True)
    conn = _Conn(invoice=_invoice(contact_id=None),
                 client_emails=["only@customer.example"])
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "ok"
    assert sent == ["only@customer.example"]


async def test_several_candidates_is_a_refusal_with_the_count(monkeypatch):
    """Guessing which of three colleagues receives a payment demand is not
    this engine's call — the refusal states the data fact so a human fixes
    the invoice (name a contact) rather than the rule."""
    conn = _Conn(invoice=_invoice(contact_id=None),
                 client_emails=["a@c.example", "b@c.example", "c@c.example"])
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "refused"
    assert "3" in r.detail["reason"]


async def test_no_address_anywhere_is_a_refusal(monkeypatch):
    conn = _Conn(invoice=_invoice(contact_id=None), client_emails=[])
    r = await _run(conn, monkeypatch, armed=True)
    assert r.outcome == "refused"


# ── the read-only promise ────────────────────────────────────────────────────

def test_the_verb_never_writes_the_invoice():
    """The chase reads money and never moves it. The engine-wide ratchet
    (`test_the_allowlist_contains_no_money_verb`) scans every handler; this
    pins the specific claim for the one verb whose NAME says invoice."""
    import inspect
    from services.niyam.actions import InvoiceRemindCustomer
    code = inspect.getsource(InvoiceRemindCustomer)
    for word in ("INSERT", "UPDATE", "DELETE"):
        assert word not in code, f"{word} found in a read-only verb"


# ── the template ─────────────────────────────────────────────────────────────

def test_the_customer_template_waits_a_week_and_uses_the_verb():
    """Grace before the first customer-facing word: the internal rung tells
    the firm immediately; the customer hears at 7+ days, when 'unpaid' has
    survived a reconciliation cycle and is likely to still be true."""
    from services.niyam.templates import TEMPLATES
    [t] = [t for t in TEMPLATES if t["id"] == "invoice-overdue-remind-customer"]
    conditions = [s["config"] for s in t["steps"] if s["kind"] == "condition"]
    assert {"field": "days_overdue", "operator": "gte", "value": 7} in conditions
    actions = [s["config"]["verb"] for s in t["steps"] if s["kind"] == "action"]
    assert actions == ["invoice.remind_customer"]
    assert "NIYAM_CUSTOMER_MAIL" in t["why"], \
        "the picker must say this one is behind the owner's switch"


def test_the_dunning_purpose_rides_the_invoice_address():
    """A payment reminder belongs on the address the customer's accounts
    department already recognises as billing — same bucket as the bill."""
    from services.email_senders import _BUCKET
    assert _BUCKET["invoice_reminder"] == "invoice"
