"""The inbound half — and the four ways it could be confidently wrong.

Catalogue #37, #38 and #44. These are not arithmetic tests. Each handler here
has one specific way it could lie, and each lie is a different kind of expensive:

  · #37 could UNDERSTATE THE RESIDUAL. That is the margin hole. Every trick that
    shrinks the residual — ranking the rules so an ambiguous message resolves to
    something, projecting monthly volume off a capped sample, quietly counting a
    "probably spam" as labelled — makes the model tier look cheaper than it is,
    and the number is the whole basis of the pricing decision. So:
      `test_ambiguity_is_never_resolved_by_precedence`
      `test_the_projection_uses_the_full_count_not_the_capped_sample`
      `test_the_residual_is_reported_as_a_monthly_call_volume`

  · #38 could turn from PULL into PUSH, or ground a reply in the wrong client.
    An auto-drafter costs one call per message instead of one per request — 250
    calls for the live org's 250 inbound messages. And because every parameter
    must default, the handler picks a conversation when none is named, which is
    exactly how one client's dues get quoted to another. So:
      `test_it_says_which_conversation_it_chose_and_that_it_chose`
      `test_nothing_here_sends_or_subscribes`
      `test_an_unlinked_number_says_no_ledger_was_read`

  · #44 could ASSIGN A BUCKET. The product has no GSTR-2B data at all — a
    search of every column in `staging` for 2b/gstr2/itc returns one false
    positive — so a bucket printed here is a guess inside a letter to a tax
    officer, over a firm's signature. So:
      `test_no_row_is_ever_given_a_bucket`
      `test_it_never_calls_itself_a_reconciliation`
      `test_a_missing_statute_row_is_stated_not_invented`

Live figures at the time of writing, read-only 2026-08-20:

  250 inbound WhatsApp messages in ONE org of three; 100 labelled by the rules
  (50 bill_query, 50 payment_claim), 0 ambiguous, 150 unlabelled — a residual of
  **60.0%**, twice the folio's 30% assumption, projecting to ~643 model calls
  per org per month. 189 vendor bills across the three orgs (166/20/3), 16 of
  them with no vendor GSTIN. Zero rows in `varta_business_accounts` anywhere.
"""
import ast
import inspect
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest

from services.skills.data.inbox_triage import (
    PROJECTION_MONTH_DAYS,
    ROUTES,
    RULES,
    brief_mismatch_schedule,
    brief_reply_grounding,
    check_inbound_triage,
    classify,
    _language_evidence,
)

SRC = Path(inspect.getsourcefile(check_inbound_triage)).read_text(encoding="utf-8")

ORG = "00000000-0000-4000-8000-000000000037"
# ANCHORED ON THE REAL CLOCK, NOT ON A LITERAL.
#
# These were `date(2026, 8, 20)`, and the suite went red at midnight on the 21st
# with `assert 11 == 10`: every fixture below is written as an OFFSET from this
# anchor (`TODAY - timedelta(days=10)` is "ten days overdue"), while the code
# under test computes overdue-ness against the real `date.today()`. A frozen
# anchor makes that arithmetic true on exactly one day and drifts by one every
# day after, so the failure says nothing about the product.
#
# The alternative — freezing the clock inside the module under test — would be
# testing a different program. What these tests are about is the offsets, so the
# offsets are what is pinned; the anchor moves with the world.
TODAY = date.today()
NOW = datetime.combine(TODAY, time(9, 0), tzinfo=timezone.utc)


def _text(out) -> str:
    """The whole output as one lower-cased string, for absence/presence checks."""
    return json.dumps(out, default=str).lower()


def _body(out) -> str:
    """The output WITHOUT `limitations`.

    Asserting a phrase is absent has to exclude the caveats first: the sentence
    explaining why we do not say X necessarily contains X.
    """
    trimmed = {k: v for k, v in out.items() if k != "limitations"}
    return json.dumps(trimmed, default=str).lower()


class _Pool:
    """Replays canned result sets, matched on a FRAGMENT OF THE SQL.

    Matched by fragment rather than call order so inserting a query into a
    handler does not silently shift every fixture by one — which is how a suite
    starts asserting on the wrong rows while staying green.

    `statute_calendar` is special-cased: `services/statute._resolve` picks
    between the rows it is handed, so a fake that returns EVERY statute row to
    EVERY lookup makes a test pass by choosing a fact about a different
    obligation. The bind parameter is honoured here for that reason.
    """

    def __init__(self, fetch_by=None, row_by=None, statute=None):
        self.fetch_by = fetch_by or {}
        self.row_by = row_by or {}
        self.statute = statute or {}
        self.sql_seen: list[str] = []

    async def fetch(self, sql, *args):
        self.sql_seen.append(sql)
        if "staging.statute_calendar" in sql:
            return list(self.statute.get(args[0], []))
        for fragment, payload in self.fetch_by.items():
            if fragment in sql:
                return payload
        return []

    async def fetchrow(self, sql, *args):
        self.sql_seen.append(sql)
        for fragment, payload in self.row_by.items():
            if fragment in sql:
                return payload
        return None

    async def fetchval(self, sql, *args):
        self.sql_seen.append(sql)
        return None


# ── #37 fixtures ──────────────────────────────────────────────────────────

def _msg(text, **kw):
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "conversation_id": "22222222-2222-4222-8222-222222222222",
        "content": text,
        "created_at": NOW - timedelta(days=1),
        "type": "text",
        "sender_profile_name": "Divya Nair",
    }
    row.update(kw)
    return row


def _triage_pool(messages, total=None, first=None, last=None):
    n = len(messages) if total is None else total
    return _Pool(
        fetch_by={"FROM staging.varta_messages m\n        LEFT JOIN": messages},
        row_by={"count(*)::int AS inbound_total": {
            "inbound_total": n,
            "first_at": first or (NOW - timedelta(days=6)),
            "last_at": last or NOW,
        }},
    )


# ══════════════════════════════════════════════════════════════════════════
# #37 · the residual IS the deliverable
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_residual_is_reported_as_a_monthly_call_volume():
    """THE headline. A residual nobody has measured is a recurring bill nobody
    has agreed to.

    Live: 150 of 250 messages unlabelled, projecting to ~643 calls per org per
    month — more than double the folio's 30% assumption.
    """
    messages = [_msg("Invoice bhej dijiye")] * 2 + [_msg("Kal office aana hai?")] * 3
    out = await check_inbound_triage(_triage_pool(messages), ORG)

    assert out["counts"]["labelled"] == 2
    assert out["counts"]["unlabelled"] == 3
    assert out["counts"]["residual"] == 3

    p = out["residual_projection"]
    assert p["residual_share"] == 0.6
    assert p["projected_monthly_model_calls"] is not None
    assert p["projected_monthly_model_calls"] > 0
    # …and it must announce that it is an estimate, with the window it used.
    assert p["is_an_estimate"] is True
    assert p["observed_days"] == 7
    assert p["projection_month_days"] == PROJECTION_MONTH_DAYS
    assert p["what_a_cap_must_cover"] == p["projected_monthly_model_calls"]


@pytest.mark.asyncio
async def test_the_projection_uses_the_full_count_not_the_capped_sample():
    """A projection built on a capped sample understates the bill by exactly the
    amount that was capped away.

    The classification sample is capped; the VOLUME comes from an unbounded
    count. Here 3 of 900 messages are read, and the projection must still be
    built on 900.
    """
    messages = [_msg("Kal office aana hai?")] * 3
    out = await check_inbound_triage(_triage_pool(messages, total=900), ORG, limit=3)

    assert out["counts"]["classified_sample"] == 3
    assert out["counts"]["inbound_in_window"] == 900
    assert out["counts"]["was_capped"] is True

    p = out["residual_projection"]
    assert p["inbound_in_window"] == 900
    # 900 over 7 days scaled to 30 days, all of it residual.
    assert p["projected_monthly_inbound"] == round(900 / 7 * 30)
    assert p["projected_monthly_model_calls"] == p["projected_monthly_inbound"]
    # And the cap is DECLARED, not merely applied.
    assert any("capped at 3" in l for l in out["limitations"])
    assert any("897 were not" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_ambiguity_is_never_resolved_by_precedence():
    """A precedence table shrinks the residual without making a label true.

    A message matching two rules is the rules disagreeing. Ranking them would
    make the margin hole look smaller on paper and change nothing about whether
    the label is right — and the residual is the number the pricing decision
    rests on.
    """
    out = await check_inbound_triage(
        _triage_pool([_msg("Payment done but the invoice is wrong")]), ORG,
    )

    assert out["counts"]["labelled"] == 0
    assert out["counts"]["ambiguous"] == 1
    assert out["counts"]["residual"] == 1

    row = out["ambiguous"][0]
    assert row["label"] is None
    assert set(row["matched"]) >= {"payment_claim", "bill_query", "complaint"}
    assert "not ranked" in row["why"]


def test_a_message_matching_one_rule_is_labelled_and_shows_the_words():
    """A reader who disagrees with a label needs the word that caused it."""
    v = classify("Payment done, receipt?")
    assert v["verdict"] == "labelled"
    assert v["label"] == "payment_claim"
    assert "payment done" in v["matched"]["payment_claim"]


def test_the_rules_match_whole_words_only():
    """`bill` must not fire on `billion` and `paid` must not fire on `unpaid` —
    a false label is worse than no label, because labelled is the kind a person
    routes without reading."""
    assert classify("Our billion dollar plan")["verdict"] == "unlabelled"
    assert classify("The amount is unpaid")["label"] != "payment_claim"


def test_every_seeded_live_message_lands_where_the_docstring_says():
    """The residual figure in the module docstring is only honest if these five
    strings — the entire live inbound corpus, 50 copies each — classify the way
    it claims."""
    assert classify("Payment done, receipt?")["label"] == "payment_claim"
    assert classify("Invoice bhej dijiye")["label"] == "bill_query"
    for residual in ("Namaste, GSTR filing ho gayi kya?",
                     "Documents ready hain",
                     "Kal office aana hai?"):
        assert classify(residual)["verdict"] == "unlabelled", residual


def test_a_link_is_reported_as_a_link_not_as_a_verdict():
    """'Contains a link' is a fact about the message; 'spam' is a judgement.
    The reader gets to see the gap between them."""
    v = classify("Claim your prize http://bit.ly/x")
    assert "contains a link" in v["matched"]["spam"]


@pytest.mark.asyncio
async def test_it_labels_and_routes_but_assigns_nothing():
    """`varta_conversations.assigned_to` is free text with no routing table.
    Naming a desk is a suggestion; nothing is written."""
    out = await check_inbound_triage(_triage_pool([_msg("Invoice bhej dijiye")]), ORG)

    assert out["labelled"][0]["route_to"] == ROUTES["bill_query"]
    assert any("routes nothing and assigns nothing" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_an_empty_inbox_is_not_reported_as_a_clean_one():
    """An org with a quiet inbox and one that never connected WhatsApp both
    produce zero rows. `varta_business_accounts` holds zero rows in EVERY org on
    this database, so today the honest reading is the second."""
    out = await check_inbound_triage(_triage_pool([], total=0, first=None, last=None), ORG)

    assert out["counts"]["inbound_in_window"] == 0
    assert out["residual_projection"]["residual_share"] is None
    assert out["residual_projection"]["projected_monthly_model_calls"] is None
    assert "never connected whatsapp" in _text(out)


@pytest.mark.asyncio
async def test_the_script_limitation_is_always_stated():
    """The rules are English and romanised Hindi only, so for an org whose
    clients write in Devanagari the residual is a FLOOR."""
    out = await check_inbound_triage(_triage_pool([_msg("Invoice bhej dijiye")]), ORG)
    assert any("romanised hindi only" in l.lower() for l in out["limitations"])
    assert any("not measured, not zero" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_no_uuid_reaches_the_reader_as_a_sender_name():
    """Names, not ids. The ids present are row handles the UI acts on."""
    out = await check_inbound_triage(_triage_pool([_msg("Invoice bhej dijiye")]), ORG)
    name = out["labelled"][0]["sender_profile_name"]
    assert not re.fullmatch(r"[0-9a-f-]{36}", name or "")
    assert name == "Divya Nair"


# ══════════════════════════════════════════════════════════════════════════
# #38 · pull, never push — and never the wrong client
# ══════════════════════════════════════════════════════════════════════════

def _conv(**kw):
    row = {
        "id": "22222222-2222-4222-8222-222222222222",
        "status": "open",
        "started_at": NOW - timedelta(days=3),
        "resolved_at": None,
        "varta_contact_id": "33333333-3333-4333-8333-333333333333",
        "profile_name": "Divya Nair",
        "phone_number": "+91 5000268137",
        "graha_contact_id": "44444444-4444-4444-8444-444444444444",
        "opted_in": True,
        "last_inbound_at": NOW - timedelta(hours=2),
        "inbound_count": 10,
    }
    row.update(kw)
    return row


def _person(**kw):
    row = {
        "id": "44444444-4444-4444-8444-444444444444",
        "name": "Divya Nair",
        "company": "Joshi Logistics & Sons",
        "email": "divya@example.com",
        "phone": "+91 5000268137",
        "client_id": "55555555-5555-4555-8555-555555555555",
        "client_name": "Joshi Logistics & Sons",
    }
    row.update(kw)
    return row


def _reply_pool(conv=None, person=None, invoices=(), payments=(), orders=(), thread=None):
    thread = thread if thread is not None else [
        {"direction": "inbound", "content": "Namaste, GSTR filing ho gayi kya?",
         "created_at": NOW - timedelta(hours=2), "type": "text", "template_name": None},
    ]
    return _Pool(
        fetch_by={
            "FROM staging.varta_messages m\n        WHERE": thread,
            "FROM staging.ganit_invoices i\n                WHERE": list(invoices),
            "FROM staging.ganit_payments p": list(payments),
            "FROM staging.vikray_orders v": list(orders),
        },
        row_by={
            "FROM staging.varta_conversations c": conv,
            "FROM staging.graha_contacts gc": person,
        },
    )


def _open_invoice(**kw):
    row = {
        "id": "66666666-6666-4666-8666-666666666666",
        "invoice_number": "INV-2608-007",
        "invoice_date": TODAY - timedelta(days=40),
        "due_date": TODAY - timedelta(days=10),
        "total": 386281.26,
        "balance_due": 386281.26,
        "payment_status": "unpaid",
    }
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_it_says_which_conversation_it_chose_and_that_it_chose():
    """Every parameter must default, so this picks a conversation when none is
    named. A default that does not announce itself is how one client's dues get
    quoted to another."""
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(), person=_person()), ORG,
    )

    assert "most recent inbound" in out["chose_the_conversation_because"].lower()
    assert out["conversation"]["whatsapp_profile_name"] == "Divya Nair"
    assert any("no conversation was named" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_named_conversation_says_it_was_named():
    """The named and defaulted cases must not read alike on the output."""
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(), person=_person()), ORG,
        conversation_id="22222222-2222-4222-8222-222222222222",
    )
    assert out["chose_the_conversation_because"] == "named by the caller"
    assert not any("no conversation was named" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_it_grounds_the_reply_in_the_ledger_not_in_a_guess():
    """Open invoices, the last payment, order status — the four things the
    catalogue asks for, all read, none inferred."""
    payment = {"amount": 386281.26, "payment_date": TODAY, "payment_method": "cash",
               "reference": "PMT-INV-2608-007", "invoice_number": "INV-2608-007"}
    order = {"order_number": "SO-2608-0300", "order_date": TODAY - timedelta(days=5),
             "expected_delivery": TODAY + timedelta(days=5), "status": "dispatched",
             "total": 12000.0, "invoice_id": None}
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(), person=_person(),
                    invoices=[_open_invoice()], payments=[payment], orders=[order]),
        ORG,
    )

    g = out["grounding"]
    assert g["company"] == "Joshi Logistics & Sons"
    assert g["open_invoices"][0]["invoice_number"] == "INV-2608-007"
    assert g["open_invoices"][0]["days_overdue"] == 10
    assert g["last_payment"]["against_invoice"] == "INV-2608-007"
    assert g["recent_orders"][0]["status"] == "dispatched"
    assert out["counts"]["outstanding_total"] == 386281.26


@pytest.mark.asyncio
async def test_an_unlinked_number_says_no_ledger_was_read():
    """23 of the 60 live WhatsApp contacts reach no company and some reach no
    CRM contact at all. An empty invoice list must never read as 'nothing
    outstanding' — that is the sentence a draft would repeat to a client."""
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(graha_contact_id=None), person=None), ORG,
    )

    assert out["grounding"]["is_linked_to_crm"] is False
    assert out["counts"]["open_invoices"] == 0
    assert any("no ledger" in l.lower() for l in out["limitations"])
    assert any("not looked up" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_contact_with_no_company_says_what_it_could_not_see():
    """A client is the COMPANY. Without one, only this person's own rows were
    found and anything billed to the company elsewhere is invisible."""
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(), person=_person(client_id=None, client_name=None)), ORG,
    )

    assert out["grounding"]["is_linked_to_a_company"] is False
    assert out["grounding"]["company"] == "Joshi Logistics & Sons"   # the free-text fallback
    assert any("not attached to a client company" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_the_language_is_evidence_and_never_an_identification():
    """There is no language column. Every live message is romanised Hindi in
    Latin script — the exact case Unicode-block detection cannot decide — so a
    drafter gets evidence, not an answer."""
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(), person=_person()), ORG,
    )
    ev = out["grounding"]["language_evidence"]

    assert ev["is_an_identification"] is False
    assert "kya" in ev["romanised_markers"]
    assert ev["scripts_present"] == {}
    assert "hint" in ev["note"].lower()


def test_a_script_is_reported_as_a_script_not_as_a_language():
    """Devanagari carries Hindi and Marathi alike. Naming the script is a fact;
    naming the language would be a guess."""
    ev = _language_evidence("नमस्ते, बिल भेज दीजिए")
    assert "Devanagari" in ev["scripts_present"]
    assert ev["is_an_identification"] is False
    assert "script is not a language" in ev["note"]


@pytest.mark.asyncio
async def test_no_conversation_at_all_is_an_absence_of_a_conversation():
    """Two orgs of three have none. That is not an absence of dues — no ledger
    was read at all."""
    out = await brief_reply_grounding(_reply_pool(conv=None), ORG)

    assert out["counts"]["conversations_found"] == 0
    assert out["grounding"] is None
    assert "not an absence of dues" in _text(out)
    assert out["delivery"]["sent"] is False


@pytest.mark.asyncio
async def test_the_pull_not_push_rule_is_on_the_output_every_time():
    """A caveat a language model never sees is a caveat the reader never sees.
    This one is the difference between a feature and a leak, so it ships on the
    output rather than living only in a docstring."""
    out = await brief_reply_grounding(
        _reply_pool(conv=_conv(), person=_person()), ORG,
    )
    joined = " ".join(out["limitations"]).lower()
    assert "pull only" in joined
    assert "one per message" in joined
    assert out["delivery"]["will_send"] is False


# ══════════════════════════════════════════════════════════════════════════
# #44 · the schedule, and never a bucket
# ══════════════════════════════════════════════════════════════════════════

GSTR3B_ROW = {
    "obligation_key": "gst.return.gstr3b", "title": "Monthly summary return",
    "authority": "gst", "statute": "CGST Act", "form_number": "GSTR-3B",
    "section_ref": "s.39", "periodicity": "monthly", "due_day": 20,
    "due_month": None, "due_month_offset": 1, "window_days": None,
    "rate_percent": None, "threshold_amount": None, "state_code": None,
    "effective_from": date(2021, 1, 1), "effective_to": None,
    "effective_from_exact": None, "source_ref": None, "notes": None,
    "verified_on": None,
}
ITC_ROW = dict(
    GSTR3B_ROW,
    obligation_key="gst.itc.time_limit",
    title="Time limit to claim input tax credit for a financial year",
    form_number=None, section_ref="s.16(4)", periodicity="annual",
    due_day=30, due_month=11, due_month_offset=None,
    effective_from=date(2022, 10, 1),
)


def _bill(**kw):
    row = {
        "id": "77777777-7777-4777-8777-777777777777",
        "bill_number": "VB-0140",
        "internal_ref": "VB-0140",
        "bill_date": date(2026, 7, 2),
        "due_date": date(2026, 7, 30),
        "subtotal": 5140.00,
        "cgst": 462.60,
        "sgst": 462.60,
        "igst": 0.00,
        "cess": 0.00,
        "total": 6065.20,
        "amount_paid": 0.00,
        "status": "unpaid",
        "is_reverse_charge": False,
        "currency": "INR",
        "vendor_name": "National Paper House",
        "vendor_gstin": "27BBFPV2005Z1ZF",
    }
    row.update(kw)
    return row


def _schedule_pool(bills, statute=None):
    return _Pool(
        fetch_by={"FROM staging.ganit_vendor_bills b": bills},
        statute=statute if statute is not None else {
            "gst.return.gstr3b": [GSTR3B_ROW],
            "gst.itc.time_limit": [ITC_ROW],
        },
    )


@pytest.mark.asyncio
async def test_no_row_is_ever_given_a_bucket():
    """THE headline for #44. The product holds no GSTR-2B data, so a bucket is
    a guess inside a letter to a tax officer, over a firm's signature."""
    out = await brief_mismatch_schedule(_schedule_pool([_bill(), _bill(igst=925.20, cgst=0, sgst=0)]),
                                        ORG, period="2026-07")

    assert out["counts"]["bills"] == 2
    assert out["counts"]["buckets_assigned"] == 0
    for row in out["schedule"]:
        assert row["bucket"] is None
        assert row["bucket_assigned_by"] == "human"
    assert out["bucket_assignment"]["assigned_here"] is False
    assert any("bucket is the human" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_it_never_calls_itself_a_reconciliation():
    """Catalogue #59's lesson: a skill that calls itself a reconciliation while
    comparing a number to itself is caught by the first CA who runs it. The
    other side does not exist in this product."""
    out = await brief_mismatch_schedule(_schedule_pool([_bill()]), ORG, period="2026-07")

    # `limitations` is excluded first — the caveat explaining why we do NOT call
    # it a reconciliation necessarily contains the word.
    assert "reconcil" not in _body(out)
    assert any("one side of a comparison" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_the_schedule_is_invoice_level_with_the_tax_split():
    """What the rescope promises the human: the figures they assign buckets to."""
    out = await brief_mismatch_schedule(
        _schedule_pool([_bill(), _bill(subtotal=11634.00, cgst=0, sgst=0, igst=2094.12,
                                       total=13728.12, bill_number="VB-0138")]),
        ORG, period="2026-07",
    )

    assert [r["bill_number"] for r in out["schedule"]] == ["VB-0140", "VB-0138"]
    assert out["totals"]["taxable_value"] == 16774.00
    assert out["totals"]["cgst"] == 462.60
    assert out["totals"]["igst"] == 2094.12
    assert out["totals"]["tax_total"] == round(462.60 + 462.60 + 2094.12, 2)
    assert out["schedule"][0]["tax_total"] == 925.20


@pytest.mark.asyncio
async def test_a_bill_with_no_vendor_gstin_is_included_and_flagged():
    """GSTIN IS NON-MANDATORY AND BLOCKS NOTHING. 16 of the live org's bills
    have no vendor GSTIN; dropping them would quietly change the total the firm
    is explaining."""
    out = await brief_mismatch_schedule(
        _schedule_pool([_bill(), _bill(vendor_gstin=None, bill_number="VB-0999",
                                       subtotal=1000.0, cgst=0, sgst=0, igst=0,
                                       total=1000.0)]),
        ORG, period="2026-07",
    )

    assert out["counts"]["bills"] == 2
    assert out["counts"]["bills_without_vendor_gstin"] == 1
    assert out["totals"]["taxable_value"] == 6140.00
    row = next(r for r in out["schedule"] if r["bill_number"] == "VB-0999")
    assert row["vendor_gstin_recorded"] is False
    assert any("blocks nothing" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_missing_statute_row_is_stated_not_invented():
    """If the calendar has no row, SAY SO — never print a form number from
    memory. Form 24Q became 138 on 1 April 2026; a literal here would be wrong
    within a year of being written."""
    out = await brief_mismatch_schedule(_schedule_pool([_bill()], statute={}),
                                        ORG, period="2026-07")

    assert out["return_in_force"] is None
    assert out["itc_time_limit_in_force"] is None
    assert any("records no `gst.return.gstr3b`" in g for g in out["statute_gaps"])
    # Nothing anywhere printed a form number the calendar did not supply.
    assert "gstr-3b" not in _body(out)
    assert "s.16(4)" not in _body(out)


@pytest.mark.asyncio
async def test_the_statute_lookup_is_keyed_and_not_answered_from_the_wrong_row():
    """A fake pool returning every statute row to every lookup makes a test pass
    by resolving a fact about a DIFFERENT obligation. The pool filters on the
    bind parameter, and this proves the handler asks for the right two keys."""
    pool = _schedule_pool([_bill()])
    out = await brief_mismatch_schedule(pool, ORG, period="2026-07")

    assert out["return_in_force"]["form_number"] == "GSTR-3B"
    assert out["itc_time_limit_in_force"]["section_ref"] == "s.16(4)"
    assert out["return_in_force"]["resolved_as_of"] == date(2026, 7, 31)


@pytest.mark.asyncio
async def test_the_intimation_itself_is_reported_as_not_in_the_calendar():
    """The calendar carries no GSTR-2B key and no rule 88D / DRC-01C key, so the
    intimation this answers is not identified by form or section anywhere."""
    out = await brief_mismatch_schedule(_schedule_pool([_bill()]), ORG, period="2026-07")
    assert any("no key for gstr-2b" in g.lower() for g in out["statute_gaps"])


@pytest.mark.asyncio
async def test_an_empty_period_is_an_absence_of_recorded_bills():
    """An org that books its purchases elsewhere and one that made none produce
    the same empty schedule. They are not the same fact."""
    out = await brief_mismatch_schedule(_schedule_pool([]), ORG, period="2026-07")

    assert out["counts"]["bills"] == 0
    assert out["totals"]["taxable_value"] == 0
    assert any("absence of recorded bills" in l.lower() for l in out["limitations"])
    assert any("made none both produce this empty schedule" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_capped_schedule_calls_its_totals_a_floor():
    """A total that was truncated and does not say so is a figure somebody sends
    to a tax officer."""
    out = await brief_mismatch_schedule(
        _schedule_pool([_bill(), _bill(), _bill()]), ORG, period="2026-07", limit=3,
    )
    assert out["counts"]["was_capped"] is True
    assert any("floor" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_the_period_defaults_to_the_month_being_filed():
    """A GST intimation is answered about a period that has closed, so the
    default is the PREVIOUS month — the same clock as every other GST handler."""
    from services.skills.timeutil import return_period

    out = await brief_mismatch_schedule(_schedule_pool([]), ORG)
    assert out["period"] == return_period()
    assert out["period_start"].day == 1
    assert out["period_end"].month == out["period_start"].month


# ══════════════════════════════════════════════════════════════════════════
# the promises the module makes about itself
# ══════════════════════════════════════════════════════════════════════════

def test_nothing_here_writes():
    """These read. Delivery, assignment and recording are separate armed
    decisions the owner makes."""
    lowered = SRC.lower()
    for verb in ("insert into", "update staging.", "delete from", "upsert"):
        assert verb not in lowered, verb


def test_nothing_here_sends_or_subscribes():
    """#38 is PULL. The leak is not the model, it is wiring the model to an
    event — so nothing in this file may reach a send path or a subscription."""
    tree = ast.parse(SRC)
    imported = {
        n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module
    } | {
        a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names
    }
    for banned in ("services.email_service", "services.whatsapp", "services.varta",
                   "httpx", "requests", "aiohttp"):
        assert not any(m.startswith(banned) for m in imported), banned
    for call in ("send_email", "send_message", "send_template", "publish("):
        assert call not in SRC


def test_every_query_is_scoped_to_one_org():
    """The tenant boundary. Every SQL string in the file filters on it."""
    tree = ast.parse(SRC)
    sqls = [
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and "FROM staging." in n.value
    ]
    assert len(sqls) >= 6, "no SQL found — the extraction is wrong, not the handler"
    for sql in sqls:
        assert "org_id = $1::uuid" in sql, sql


def test_both_graha_joins_carry_org_id():
    """The FK on `graha_clients` is on the id ALONE, so an id-only join prints
    another practice's client name against this practice's conversation. Proved
    live; see migration 163."""
    joins = re.findall(r"(?:LEFT )?JOIN staging\.graha_(\w+) (\w+)\s+ON ([^\n]+)", SRC)
    assert joins, "no graha join found — the extraction is wrong"
    for _table, _alias, on in joins:
        assert "org_id" in on, on


def test_every_varta_join_carries_org_id_too():
    """Same rule, same reason: `varta_conversations` and `varta_contacts` are
    joined on ids that are unique per row but not per tenant in the FK."""
    joins = re.findall(r"(?:LEFT )?JOIN staging\.varta_(\w+) (\w+)\s+ON ([^\n]+)", SRC)
    assert joins
    for _table, _alias, on in joins:
        assert "org_id" in on, on


@pytest.mark.parametrize("handler", [
    check_inbound_triage, brief_reply_grounding, brief_mismatch_schedule,
])
def test_every_parameter_defaults(handler):
    """A handler with a required parameter cannot be scheduled. #38 is
    subject-bound by nature and STILL defaults — it picks a conversation and
    says which."""
    required = [
        n for n, p in inspect.signature(handler).parameters.items()
        if n not in ("pool", "org_id") and p.default is inspect.Parameter.empty
    ]
    assert not required, required


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["triage", "reply", "schedule"])
async def test_the_output_survives_json_dumps_and_carries_the_contract(case):
    """`counts` is a dict and `limitations` is a non-empty list of honest
    strings, on every handler, on every path. asyncpg hands back Decimal and
    date, neither of which json.dumps takes without help."""
    if case == "triage":
        out = await check_inbound_triage(_triage_pool([_msg("Invoice bhej dijiye")]), ORG)
    elif case == "reply":
        out = await brief_reply_grounding(_reply_pool(conv=_conv(), person=_person()), ORG)
    else:
        out = await brief_mismatch_schedule(_schedule_pool([_bill()]), ORG, period="2026-07")

    assert isinstance(out["counts"], dict) and out["counts"]
    assert isinstance(out["limitations"], list) and out["limitations"]
    assert all(isinstance(l, str) and l.strip() for l in out["limitations"])
    json.dumps(out, default=str)


def test_the_rule_set_covers_exactly_the_six_catalogue_categories():
    """bill query, order, payment claim, complaint, job enquiry, spam. Adding a
    seventh silently changes the residual, which is the number the pricing
    decision rests on."""
    assert set(RULES) == {
        "bill_query", "order", "payment_claim", "complaint", "job_enquiry", "spam",
    }
    assert set(ROUTES) == set(RULES)
