"""
The four reconciliation-edge handlers, and the ways each of them could lie.

None of these is a hard arithmetic problem. Every one of them is a report that
goes in front of a chartered accountant, and a report of this kind fails by
reading as settled when it is a guess, or as clean when it was never measured.
So the load-bearing tests here are the ones that separate those:

  · `test_an_org_with_no_upi_address_is_not_a_threading_failure` — the seeded
    org holds 289 live payment links and ZERO UPI receiving addresses. Counting
    those 289 as lost references would send somebody to fix a note field when
    the repair is to enter a VPA.
  · `test_the_builder_is_read_from_the_builder` — #17's whole claim is about
    which UPI fields exist. The handler must READ them from `upi.pay_uri`, so
    this test asserts the output agrees with the live function rather than
    asserting `tr` is missing. A test that hard-codes the gap fails on the day
    the gap is fixed, which teaches the next engineer to delete the test.
  · `test_a_screenshot_can_never_produce_a_paid_invoice` — the single rule #39
    exists to enforce. Every claim is `claimed`, unconfirmed, and the refusal is
    on the output rather than only in a docstring.
  · `test_one_class_is_not_sold_as_perfect_rules` — the live data holds exactly
    one class, so every derived rule is 100% pure by arithmetic. A purity of 1.0
    presented without that fact is the most plausible confident lie in this file.
  · `test_a_missing_statement_is_not_a_difference_of_everything` — with no
    statement imported, the whole of a period's receipts would otherwise be
    reported as an unexplained difference. Aekam would have shown ₹88,500 and
    Unicode ₹3,24,212, both of them entirely artefacts of absent data.
  · `test_screen_rejects_a_citation` / `test_screen_rejects_a_numeral` — the
    constraint that makes #43 safe, as a check rather than a wish.

Live figures at the time of writing, read-only against the three organisations
on 2026-08-20:

  #17   Aekam 5 live links / 5 threaded · Unicode 38 / 38 · E2E 289 / 0 (no UPI
        address at all). Builder emits am, cu, pa, pn, tn — no `tr` anywhere.
        E2E return path, 180 days: 76 credits, 66 naming an invoice, 10 not.
  #39   0 WhatsApp Business accounts in all three orgs; 0 of 250 inbound
        messages carry an attachment; 0 claims.
  #42   E2E: 259 lines, 0 carrying a category, 128 carrying a matched_type,
        1 distinct class, 3 candidates (INV, PMT, UPI) each also firing on 32
        lines nobody classified.
  #43   2026-07 · E2E books receipts ₹46,87,631.90, electronic ₹26,32,787.62,
        reconciled credits ₹2,15,492.00, difference ₹24,17,295.62. Aekam and
        Unicode: not_measured. Unicode fails ledger identity on INV-2026-0007.
"""
import inspect
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skills.data.recon_rules import (
    DRAFTING_CONSTRAINTS,
    MIN_RULE_TOKEN_LETTERS,
    UPI_NOTE_LIMIT,
    _month_bounds,
    _rule_tokens,
    _threading_verdict,
    _upi_fields,
    brief_working_paper_figures,
    check_narration_rule_candidates,
    check_payment_proof_claims,
    check_upi_reference_threading,
    screen_drafted_note,
)

# A fixture value, and deliberately NOT the seeded org's id even in part. An id
# that LOOKS like the real one gets copied into a live probe, the probe returns
# nothing, and the nothing reads as a regression.
ORG = "00000000-0000-4000-8000-000000000042"

TODAY = date(2026, 8, 20)
NOW = datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc)


def _text(out) -> str:
    """Every string a caller could possibly show a reader, flattened."""
    return json.dumps(out, default=str).lower()


def _body_only(out) -> str:
    """The output WITHOUT its limitations.

    Several tests assert a phrase is absent. The caveat explaining why the
    handler does not say X necessarily contains X, so an assertion over the
    whole blob would fail on a correct file.
    """
    trimmed = {k: v for k, v in out.items() if k not in ("limitations", "blocker")}
    return json.dumps(trimmed, default=str).lower()


class _Pool:
    """Replays canned result sets matched on a FRAGMENT of the SQL.

    Fragment matching rather than call order: inserting a query into a handler
    then does not silently shift every fixture by one, which is how a suite
    starts asserting on the wrong rows while staying green. Insertion order
    breaks ties, so the more specific fragment goes in first.
    """

    def __init__(self, fetch_by=None, row_by=None):
        self.fetch_by = fetch_by or {}
        self.row_by = row_by or {}
        self.sql_seen: list[str] = []
        self.args_seen: list[tuple] = []

    def _pick(self, table, sql, default):
        self.sql_seen.append(sql)
        for fragment, payload in table.items():
            if fragment in sql:
                return payload
        return default

    async def fetch(self, sql, *args):
        self.args_seen.append(args)
        return self._pick(self.fetch_by, sql, [])

    async def fetchrow(self, sql, *args):
        self.args_seen.append(args)
        return self._pick(self.row_by, sql, None)


# ═══════════════════════════════════════════════════════════════════════════
# fixtures
# ═══════════════════════════════════════════════════════════════════════════

def _invoice(number="INV-2026-0042", **kw):
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "invoice_number": number,
        "invoice_date": TODAY - timedelta(days=20),
        "currency": "INR",
        "balance_due": 29500,
        "doc_status": "final",
        "payment_status": "unpaid",
        "pay_token": "abcdefgh12345678",
        "customer": "Chopra Retail LLP",
        "customer_email": "sneha.bansal83@example.com",
        "customer_phone": "+91 9100296393",
    }
    row.update(kw)
    return row


def _credit(desc="UPI/PMT-INV-2026-0042", ref="UTR000000212074", **kw):
    row = {
        "id": "22222222-2222-4222-8222-222222222222",
        "statement_date": TODAY - timedelta(days=3),
        "amount": 29500,
        "description": desc,
        "reference": ref,
        "is_reconciled": False,
    }
    row.update(kw)
    return row


def _threading_pool(*, org_name="Chopra & Co", upi_accounts=1, invoices=None,
                    credits=None, numbers=None):
    invoices = invoices if invoices is not None else [_invoice()]
    credits = credits if credits is not None else [_credit()]
    numbers = numbers if numbers is not None else [{"invoice_number": "INV-2026-0042"}]
    return _Pool(
        row_by={
            "to_regclass": {"ok": True},
            "FROM public.organisations o": {"org_name": org_name,
                                             "fallback_vpa": ""},
            "FROM public.org_upi_accounts a": {"n": upi_accounts},
            "FROM public.ganit_invoices i": {"n": len(invoices)},
        },
        fetch_by={
            "COALESCE(btrim(i.invoice_number), '') <> ''": numbers,
            "FROM public.ganit_invoices i": invoices,
            "FROM public.ganit_bank_statement_lines l": credits,
        },
    )


# ═══════════════════════════════════════════════════════════════════════════
# every handler must be schedulable, and must survive json.dumps
# ═══════════════════════════════════════════════════════════════════════════

HANDLERS = (
    check_upi_reference_threading,
    check_payment_proof_claims,
    check_narration_rule_candidates,
    brief_working_paper_figures,
)


@pytest.mark.parametrize("fn", HANDLERS)
def test_a_handler_can_run_unattended(fn):
    """Nothing after `pool, org_id` may be required.

    A handler with a required parameter cannot be scheduled at all — it is
    registered, subject-bound and unrunnable, which is how two GST handlers and
    the bank matcher spent months looking finished.
    """
    params = list(inspect.signature(fn).parameters.values())
    assert [p.name for p in params[:2]] == ["pool", "org_id"]
    for p in params[2:]:
        assert p.default is not inspect.Parameter.empty, f"{fn.__name__}.{p.name}"


@pytest.mark.asyncio
async def test_every_output_survives_json_dumps_and_carries_its_caveats():
    outs = [
        await check_upi_reference_threading(_threading_pool(), ORG),
        await check_payment_proof_claims(_Pool(), ORG),
        await check_narration_rule_candidates(_Pool(), ORG),
        await brief_working_paper_figures(_Pool(), ORG, period="2026-07"),
    ]
    for out in outs:
        json.dumps(out, default=str)
        assert isinstance(out["counts"], dict)
        assert out["limitations"], "a handler with no limitations is claiming omniscience"
        assert all(isinstance(x, str) and x.strip() for x in out["limitations"])


# ═══════════════════════════════════════════════════════════════════════════
# #17 · UPI reference threading
# ═══════════════════════════════════════════════════════════════════════════

def test_the_builder_is_read_from_the_builder():
    """The field list must come from `upi.pay_uri`, not from this file.

    Deliberately NOT `assert tr_emitted is False`. The gap is real today and the
    point of #17 is to close it; a test that hard-codes the gap goes red on the
    day somebody fixes it, and the next engineer learns to delete tests instead
    of trusting them. So this asserts AGREEMENT with the live function.
    """
    from services import upi

    uri = upi.pay_uri("probe@ybl", "Probe Payee", 100.0, "INV-PROBE-0001 Probe Firm")
    fields = _upi_fields()
    assert fields["tr_emitted"] == ("tr=" in uri)
    assert fields["reference_in_tn"] == ("INV" in uri.upper())
    for key in fields["fields_emitted"]:
        assert f"{key}=" in uri
    assert fields["note_field_limit"] == UPI_NOTE_LIMIT


def test_a_long_org_name_pushes_the_invoice_number_out_of_the_note():
    """The QR route builds '<org> <number>' and truncates at 60.

    The organisation's name goes FIRST, so a long name silently deletes the
    reference — the failure #17 is meant to prevent, arriving through the very
    change meant to prevent it.
    """
    short_ok, _ = _threading_verdict("INV-2026-0042", "Chopra & Co")
    assert short_ok

    long_name = "Ramanathan Krishnamurthy Venkataraman and Associates LLP"
    assert len(long_name) > UPI_NOTE_LIMIT - len("INV-2026-0042")
    ok, why = _threading_verdict("INV-2026-0042", long_name)
    assert not ok
    assert "truncat" in why or "off the end" in why


def test_a_short_invoice_number_is_never_counted_as_threaded():
    """A two-character number is not a reference the matcher will look for.

    `bank_matching` refuses to search a narration for a token under four
    characters, because '12' matches half the lines in a statement file and a
    false NAMED match is worse than no match — named is the kind a person
    trusts without checking. Counting such an invoice as threaded would promise
    a match that the matcher will never make.
    """
    ok, why = _threading_verdict("12", "Chopra & Co")
    assert not ok
    assert "alphanumeric" in why


@pytest.mark.asyncio
async def test_an_org_with_no_upi_address_is_not_a_threading_failure():
    """No UPI address is a missing VPA, not a lost reference.

    Measured live: the seeded org holds 289 invoices with live payment links and
    zero receiving addresses. Reporting those as un-threaded references would
    send somebody to fix a note field when the repair is in Settings.
    """
    out = await check_upi_reference_threading(
        _threading_pool(upi_accounts=0), ORG)
    assert out["upi_addresses"]["can_render_a_upi_code"] is False
    assert out["counts"]["reference_threaded"] == 0
    reasons = " ".join(r["why"] for r in out["not_threaded"])
    assert "no upi receiving address" in reasons.lower()
    assert any("no upi receiving address" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_the_outward_and_return_rates_are_never_multiplied():
    """An org that renders no UPI code cannot evidence an end-to-end rate.

    Its statement references were written by somebody else. Saying so is the
    difference between a measurement and a coincidence dressed as one.
    """
    out = await check_upi_reference_threading(
        _threading_pool(upi_accounts=0), ORG)
    assert out["counts"]["credits_examined"] == 1
    assert any("unmeasurable" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_no_credits_in_the_window_is_not_measured_rather_than_clean():
    """Zero credits and zero references must not read alike.

    An organisation that never imported a statement and one whose narrations
    carry nothing both show zero here. Only the first is 'not measured'.
    """
    out = await check_upi_reference_threading(_threading_pool(credits=[]), ORG)
    assert out["counts"]["credits_examined"] == 0
    assert any("not measured" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_credit_naming_an_invoice_is_counted_on_the_normalised_form():
    """`UPI/PMT-INV-2026-0042` names `INV-2026-0042`.

    The bank strips and replaces separators at will, which is why both sides go
    through the matcher's own normalisation and not a raw comparison.
    """
    out = await check_upi_reference_threading(_threading_pool(), ORG)
    assert out["counts"]["credits_naming_an_invoice"] == 1
    assert out["counts"]["credits_naming_nothing"] == 0

    blind = await check_upi_reference_threading(
        _threading_pool(credits=[_credit(desc="NEFT-Balaji Traders Pvt Ltd")]), ORG)
    assert blind["counts"]["credits_naming_nothing"] == 1
    assert blind["counts"]["credits_naming_nothing_and_still_open"] == 1


@pytest.mark.asyncio
async def test_threading_reports_its_denominator_and_says_when_it_capped():
    """'0 of 289' and 'check skipped' are different results."""
    out = await check_upi_reference_threading(
        _threading_pool(invoices=[_invoice(), _invoice(number="INV-2026-0043")]),
        ORG, limit=1)
    assert out["counts"]["invoices_examined"] == 2  # the fake ignores LIMIT
    assert out["counts"]["was_capped"] is True
    assert "invoices_with_a_live_link" in out["counts"]


@pytest.mark.asyncio
async def test_threading_never_renders_an_id_as_a_name():
    """Names, not ids. The customer column is a name or a stated absence."""
    out = await check_upi_reference_threading(
        _threading_pool(upi_accounts=0), ORG)
    row = out["not_threaded"][0]
    assert row["customer"] == "Chopra Retail LLP"
    assert ORG not in json.dumps(out, default=str)


# ═══════════════════════════════════════════════════════════════════════════
# #39 · payment proof capture
# ═══════════════════════════════════════════════════════════════════════════

def _proof_pool(*, waba_active=1, proofs=None, invoices=None, lines=None,
                inbound_total=12):
    proofs = proofs if proofs is not None else []
    return _Pool(
        row_by={
            "FROM public.varta_business_accounts b": {"total": 1,
                                                       "active": waba_active},
            "FROM public.varta_messages m": {"inbound_total": inbound_total,
                                              "with_media": len(proofs)},
        },
        fetch_by={
            "FROM public.varta_messages m": proofs,
            "payment_status IN ('unpaid', 'partial')": invoices or [],
            "FROM public.ganit_bank_statement_lines l": lines or [],
        },
    )


def _proof(content="Paid your invoice INV-2026-0042 today", **kw):
    row = {
        "id": "33333333-3333-4333-8333-333333333333",
        "created_at": NOW - timedelta(days=1),
        "content": content,
        "type": "image",
        "media_url": "https://example.invalid/proof.jpg",
        "sender": "Sanjay Patel",
        "customer": "Chopra Retail LLP",
        "client_id": "44444444-4444-4444-8444-444444444444",
    }
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_a_screenshot_can_never_produce_a_paid_invoice():
    """The one rule this handler exists to enforce.

    Every claim is `claimed` and unconfirmed, the refusal is ON THE OUTPUT, and
    nothing anywhere states a payment_status of paid for the claim itself.
    """
    out = await check_payment_proof_claims(
        _proof_pool(proofs=[_proof()],
                    invoices=[{"id": "55555555-5555-4555-8555-555555555555",
                               "invoice_number": "INV-2026-0042",
                               "invoice_date": TODAY,
                               "balance_due": 29500,
                               "payment_status": "unpaid",
                               "client_id": "44444444-4444-4444-8444-444444444444",
                               "customer": "Chopra Retail LLP"}]),
        ORG)
    assert out["counts"]["claims"] == 1
    assert out["counts"]["claims_confirmed"] == 0
    claim = out["claims"][0]
    assert claim["status"] == "claimed"
    assert claim["confirmed"] is False
    refused = " ".join(r["refused"] for r in out["refusals"]).lower()
    assert "marking an invoice paid from a screenshot" in refused
    assert any("bank reconciliation" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_named_invoice_beats_the_senders_open_list():
    """A message naming an invoice has identified it; the client link guesses."""
    open_inv = [{"id": "55555555-5555-4555-8555-555555555555",
                 "invoice_number": "INV-2026-0042", "invoice_date": TODAY,
                 "balance_due": 29500, "payment_status": "unpaid",
                 "client_id": "44444444-4444-4444-8444-444444444444",
                 "customer": "Chopra Retail LLP"},
                {"id": "66666666-6666-4666-8666-666666666666",
                 "invoice_number": "INV-2026-0099", "invoice_date": TODAY,
                 "balance_due": 11800, "payment_status": "unpaid",
                 "client_id": "44444444-4444-4444-8444-444444444444",
                 "customer": "Chopra Retail LLP"}]
    named = await check_payment_proof_claims(
        _proof_pool(proofs=[_proof()], invoices=open_inv), ORG)
    assert named["claims"][0]["likely_invoices_basis"] == "the message names this invoice"
    assert [i["invoice_number"] for i in named["claims"][0]["likely_invoices"]] \
        == ["INV-2026-0042"]

    silent = await check_payment_proof_claims(
        _proof_pool(proofs=[_proof(content="sent it")], invoices=open_inv), ORG)
    assert silent["claims"][0]["likely_invoices_basis"].startswith("the sender's client")
    assert len(silent["claims"][0]["likely_invoices"]) == 2


@pytest.mark.asyncio
async def test_no_waba_is_a_blocker_reported_with_a_denominator():
    """0 attachments out of 250 inbound messages is a measurement.

    A bare zero is not: it reads as a clean inbox rather than as a channel that
    does not exist. Measured live, all three organisations hold zero WhatsApp
    Business accounts.
    """
    out = await check_payment_proof_claims(
        _proof_pool(waba_active=0, inbound_total=250), ORG)
    assert out["blocked"] is True
    assert "whatsapp business account" in out["blocker"].lower()
    assert out["counts"]["inbound_messages_examined"] == 250
    assert out["counts"]["inbound_messages_with_an_attachment"] == 0
    assert any("0 of 250" in x for x in out["limitations"])


@pytest.mark.asyncio
async def test_a_claim_shows_names_and_ids_only_as_handles():
    """Never a UUID where a reader expects a person or a company."""
    out = await check_payment_proof_claims(
        _proof_pool(proofs=[_proof()]), ORG)
    claim = out["claims"][0]
    assert claim["sender"] == "Sanjay Patel"
    assert claim["customer"] == "Chopra Retail LLP"
    assert claim["claim_id"] == "33333333-3333-4333-8333-333333333333"
    assert "-4333-" not in claim["sender"] and "-4333-" not in claim["customer"]


@pytest.mark.asyncio
async def test_the_claim_store_gap_is_stated_not_worked_around():
    """There is nowhere to file a claim, and pretending otherwise is worse."""
    out = await check_payment_proof_claims(_proof_pool(), ORG)
    joined = " ".join(out["limitations"]).lower()
    assert "nowhere to file" in joined
    assert "ganit_payments" in joined


# ═══════════════════════════════════════════════════════════════════════════
# #42 · bank narration rules
# ═══════════════════════════════════════════════════════════════════════════

def _line(desc, matched_type=None, category=None, **kw):
    row = {
        "id": kw.pop("id", "77777777-7777-4777-8777-777777777777"),
        "statement_date": TODAY - timedelta(days=5),
        "amount": 29500,
        "description": desc,
        "reference": kw.pop("reference", "UTR000000212074"),
        "matched_type": matched_type,
        "category": category,
        "is_reconciled": matched_type is not None,
    }
    row.update(kw)
    return row


def _rules_pool(lines, columns=("category", "categorised_by", "categorised_at")):
    base = ["id", "org_id", "statement_date", "description", "reference", "amount",
            "matched_payment_id", "matched_type", "is_reconciled", "batch_id"]
    return _Pool(
        fetch_by={
            "information_schema.columns": [{"column_name": c}
                                           for c in [*base, *columns]],
            "FROM public.ganit_bank_statement_lines l": lines,
        },
    )


def test_a_token_carrying_digits_is_never_a_rule():
    """`UTR000000212074` names one transaction; `2603` names one month's batch.

    A rule keyed on either is a lookup with a support of one wearing a rule's
    clothes, and it would be reported with a perfect purity.
    """
    toks = _rule_tokens("UTR000000212074", "UPI/PMT-INV-2603-018")
    assert toks == {"UPI", "PMT", "INV"}
    assert all(t.isalpha() and len(t) >= MIN_RULE_TOKEN_LETTERS for t in toks)


@pytest.mark.asyncio
async def test_one_class_is_not_sold_as_perfect_rules():
    """Purity of 1.0 over a single class is arithmetic, not accuracy.

    Live, `matched_type` has exactly ONE non-null value across 128 reconciled
    lines. Every candidate is therefore unanimous, and a reader shown 100%
    without that fact would adopt rules nothing has ever tested.
    """
    lines = [_line(f"UPI/PMT-INV-2603-{n:03d}", matched_type="invoice_payment",
                   id=f"7777777{n}-7777-4777-8777-777777777777")
             for n in range(1, 6)]
    out = await check_narration_rule_candidates(_rules_pool(lines), ORG)
    assert out["counts"]["distinct_classes"] == 1
    assert all(c["purity"] == 1.0 for c in out["candidates_unvalidated"])
    assert any("cannot be validated" in x.lower() for x in out["limitations"])
    assert any("arithmetic" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_an_empty_category_column_is_still_a_blocker():
    """The columns exist and nothing has ever written one.

    They appeared on the live table on 2026-08-20 and hold 0 of 259 rows. The
    blocker moved from "no column" to "no rows", and the repair moved with it —
    a screen that lets a person categorise, not another migration.
    """
    lines = [_line("UPI/PMT-INV-2603-001", matched_type="invoice_payment"),
             _line("NEFT-Balaji Traders", id="88888888-8888-4888-8888-888888888888")]
    out = await check_narration_rule_candidates(_rules_pool(lines), ORG)
    assert out["blocked"] is True
    assert out["category_column_present"] == "category"
    assert out["counts"]["lines_carrying_a_category"] == 0
    assert "nothing has ever been written" in out["blocker"].lower()
    assert out["class_source"] == "matched_type"


@pytest.mark.asyncio
async def test_a_real_category_beats_the_matched_type_standin():
    """Once lines carry a category, that is the class and the stand-in retires."""
    lines = [
        _line("BANK CHARGES GST", category="bank_charge",
              id="99999999-9999-4999-8999-999999999991"),
        _line("BANK CHARGES GST", category="bank_charge",
              id="99999999-9999-4999-8999-999999999992"),
        _line("BANK CHARGES GST", category="bank_charge",
              id="99999999-9999-4999-8999-999999999993"),
        _line("UPI/PMT-INV-2603-001", category="customer_receipt",
              id="99999999-9999-4999-8999-999999999994"),
        _line("UPI/PMT-INV-2603-002", category="customer_receipt",
              id="99999999-9999-4999-8999-999999999995"),
        _line("UPI/PMT-INV-2603-003", category="customer_receipt",
              id="99999999-9999-4999-8999-999999999996"),
    ]
    out = await check_narration_rule_candidates(_rules_pool(lines), ORG)
    assert out["class_source"] == "category"
    assert out["blocked"] is False
    assert out["counts"]["distinct_classes"] == 2
    assert not any("cannot be validated" in x.lower() for x in out["limitations"])
    assert not any("stand-in" in x.lower() for x in out["limitations"])
    tokens = {c["token"]: c["assigns"] for c in out["candidates_unvalidated"]}
    assert tokens["CHARGES"] == "bank_charge"
    assert tokens["PMT"] == "customer_receipt"


@pytest.mark.asyncio
async def test_a_missing_column_reports_the_column_that_would_fix_it():
    """Where the schema cannot hold an answer, name what is owed."""
    out = await check_narration_rule_candidates(
        _rules_pool([_line("UPI/PMT-INV-2603-001", matched_type="invoice_payment")],
                    columns=()),
        ORG)
    assert out["blocked"] is True
    assert out["category_column_present"] is None
    assert "category_source" in out["blocker"]
    assert "'human' or 'rule'" in out["blocker"]


@pytest.mark.asyncio
async def test_collisions_with_unclassified_lines_are_reported():
    """A rule firing on lines nobody classified is wrong silently.

    Live, all three candidates fire on 32 lines with no class at all — the
    figure to read before adopting any of them.
    """
    lines = [_line("UPI/PMT-INV-2603-001", matched_type="invoice_payment",
                   id="aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
             _line("UPI/PMT-INV-2603-002", matched_type="invoice_payment",
                   id="aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
             _line("UPI/PMT-INV-2603-003", matched_type="invoice_payment",
                   id="aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
             _line("UPI/PMT-INV-2604-021", id="aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaaa")]
    out = await check_narration_rule_candidates(_rules_pool(lines), ORG)
    upi = next(c for c in out["candidates_unvalidated"] if c["token"] == "UPI")
    assert upi["support"] == 3
    assert upi["also_fires_on_unclassified_lines"] == 1


@pytest.mark.asyncio
async def test_no_model_tier_is_offered():
    """The whole point. A model reading a statement monthly is the cost to avoid."""
    out = await check_narration_rule_candidates(_rules_pool([]), ORG)
    assert out["model_tier"]["offered"] is False
    assert "residual" in out["model_tier"]["why_not"].lower()
    assert any("no model tier" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_no_statement_lines_is_not_measured_rather_than_no_rules():
    out = await check_narration_rule_candidates(_rules_pool([]), ORG)
    assert out["counts"]["lines_examined"] == 0
    assert any("not measured" in x.lower() for x in out["limitations"])


# ═══════════════════════════════════════════════════════════════════════════
# #43 · working paper figures and the constraint that makes them safe
# ═══════════════════════════════════════════════════════════════════════════

def _paper_pool(*, drift_rows=None, drift_n=0, drift_gross=0,
                lines_in_period=16, open_in_period=7,
                receipts=None, credits_total=215492, credits_n=9):
    receipts = receipts if receipts is not None else [
        {"method": "bank_transfer", "n": 8, "total": 1962335.81},
        {"method": "cash", "n": 4, "total": 1031680.61},
        {"method": "cheque", "n": 8, "total": 1023163.67},
        {"method": "upi", "n": 6, "total": 670451.81},
    ]
    return _Pool(
        row_by={
            "SUM(ABS(ROUND": {"n": drift_n, "gross": drift_gross},
            "AS in_period": {"in_period": lines_in_period,
                             "open_in_period": open_in_period},
            "MIN(l.statement_date)": {"lo": date(2025, 8, 1), "hi": date(2026, 8, 2),
                                      "n": 259},
            "COALESCE(SUM(l.amount), 0) AS total": {"n": credits_n,
                                                    "total": credits_total},
        },
        fetch_by={
            "ROUND(i.total - i.amount_paid - i.balance_due, 2) <> 0": drift_rows or [],
            "FROM public.ganit_payments p": receipts,
        },
    )


@pytest.mark.asyncio
async def test_a_missing_statement_is_not_a_difference_of_everything():
    """With nothing imported, the period's whole receipts are not a finding.

    Live, this guard would otherwise have reported ₹88,500 against Aekam and
    ₹3,24,212 against Unicode — both of them entirely artefacts of the data not
    being there, and both stated with two decimal places.
    """
    out = await brief_working_paper_figures(
        _paper_pool(lines_in_period=0, open_in_period=0, credits_total=0,
                    credits_n=0),
        ORG, period="2026-07")
    guard = next(d for d in out["differences"] if d["guard"] == "receipts_vs_bank")
    assert guard["status"] == "not_measured"
    assert "nothing to compare" in guard["not_measured_because"]
    assert out["counts"]["differences_found"] == 0
    assert out["counts"]["guards_not_measured"] == 2
    assert any("not agreement" in x.lower() for x in out["limitations"])


@pytest.mark.asyncio
async def test_cash_and_cheque_receipts_are_not_compared_to_the_bank():
    """Including them manufactures a difference every month for a cash practice."""
    out = await brief_working_paper_figures(_paper_pool(), ORG, period="2026-07")
    by_ref = {f["ref"]: f for f in out["figures"]}
    books = next(f for f in out["figures"]
                 if f["label"].startswith("receipts recorded"))
    electronic = next(f for f in out["figures"]
                      if "UPI or bank transfer" in f["label"])
    assert round(books["value"], 2) == 4687631.90
    assert round(electronic["value"], 2) == 2632787.62
    guard = next(d for d in out["differences"] if d["guard"] == "receipts_vs_bank")
    assert guard["status"] == "difference"
    assert round(by_ref[guard["magnitude_ref"]]["value"], 2) == 2417295.62
    methods = {r["method"] for r in out["exhibits"]["receipts_vs_bank"]}
    assert {"cash", "cheque"} <= methods, "the split must stay visible"


@pytest.mark.asyncio
async def test_every_figure_has_a_unique_ref_and_the_guards_point_at_real_ones():
    """A placeholder that resolves to nothing is how a note loses a number."""
    out = await brief_working_paper_figures(_paper_pool(), ORG, period="2026-07")
    refs = [f["ref"] for f in out["figures"]]
    assert len(refs) == len(set(refs))
    known = set(refs)
    for d in out["differences"]:
        assert set(d["figure_refs"]) <= known
        assert d["magnitude_ref"] in known
    assert set(out["drafting_brief"]["known_refs"]) == known
    assert out["figures_are_frozen"] is True


@pytest.mark.asyncio
async def test_a_ledger_identity_break_is_a_difference_with_a_named_customer():
    """Live: Unicode's INV-2026-0007 carries a total of 0.00 against 60,000 paid."""
    out = await brief_working_paper_figures(
        _paper_pool(drift_n=1, drift_gross=60000, drift_rows=[{
            "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "invoice_number": "INV-2026-0007",
            "invoice_date": date(2026, 7, 22),
            "total": 0, "amount_paid": 60000, "balance_due": 0, "gap": -60000,
            "payment_status": "paid", "doc_status": "final",
            "customer": "Sanchay Finserv",
        }]),
        ORG, period="2026-07")
    guard = next(d for d in out["differences"] if d["guard"] == "ledger_identity")
    assert guard["status"] == "difference"
    row = out["exhibits"]["ledger_identity"][0]
    assert row["customer"] == "Sanchay Finserv"
    assert row["invoice_number"] == "INV-2026-0007"
    assert row["gap"] == -60000.0


@pytest.mark.asyncio
async def test_an_unparseable_period_measures_nothing_and_says_so():
    out = await brief_working_paper_figures(_paper_pool(), ORG, period="July")
    assert "error" in out
    assert out["counts"]["guards_run"] == 0
    assert any("nothing was measured" in x.lower() for x in out["limitations"])


def test_month_bounds_rolls_over_december_without_date_arithmetic():
    assert _month_bounds("2026-12") == (date(2026, 12, 1), date(2027, 1, 1))
    assert _month_bounds("2026-07") == (date(2026, 7, 1), date(2026, 8, 1))
    assert _month_bounds("2026-13") is None
    assert _month_bounds("2026-7") is None
    assert _month_bounds("") is None


@pytest.mark.asyncio
async def test_the_handler_drafts_no_prose_and_states_no_cause():
    """It returns figures and rules. Sentences are somebody else's job.

    `limitations` and `blocker` are excluded: the caveat explaining that this
    never guesses a cause necessarily contains the word 'cause'.
    """
    out = await brief_working_paper_figures(_paper_pool(), ORG, period="2026-07")
    body = _body_only(out)
    assert "because the client" not in body
    assert "appears to be" not in body
    assert "likely due to" not in body
    assert screen_drafted_note(json.dumps(out["drafting_brief"]["may_say"])) == []


# ── the constraint, as a check rather than a wish ──────────────────────────

def test_the_constraints_are_on_the_output_and_name_citations():
    out_constraints = " ".join(DRAFTING_CONSTRAINTS).lower()
    assert "no statutory citations" in out_constraints
    assert "authority" in out_constraints
    assert "numerals" in out_constraints


def test_screen_rejects_a_citation():
    """The rule that must never be relaxed, tested in both spellings."""
    for prose in (
        "The difference arises under section 16 of the Act, 2017.",
        "Refer Rule 42 for the treatment.",
        "As per the notification issued this year.",
        "The department has confirmed the position.",
        "Form 3B was filed for the period.",
        "This follows Ind AS treatment.",
    ):
        found = screen_drafted_note(prose)
        assert found, prose
        assert found[0]["kind"] in ("citation", "numeral")


def test_screen_rejects_a_numeral_typed_into_prose():
    """Every figure arrives as a placeholder. A digit is a figure invented."""
    found = screen_drafted_note("The books show 46,87,631.90 for the period.")
    assert any(v["kind"] == "numeral" for v in found)


def test_screen_accepts_a_note_built_only_from_placeholders():
    clean = ("The receipts recorded in the books for the period, {{F5}}, include "
             "{{F6}} received electronically. The statement shows {{F7}} "
             "reconciled against receipts. The two compared figures differ by "
             "{{F8}}.")
    assert screen_drafted_note(clean, known_refs=["F5", "F6", "F7", "F8"]) == []


def test_screen_rejects_a_placeholder_that_is_not_in_the_table():
    found = screen_drafted_note("A difference of {{F99}} arose.",
                                known_refs=["F1"])
    assert any(v["kind"] == "unknown_placeholder" for v in found)


def test_screen_is_a_floor_and_never_a_sign_off():
    """A note that says nothing passes cleanly, and that is by design.

    Written down so nobody later reads a clean screen as approval of the prose.
    """
    assert screen_drafted_note("") == []
    assert screen_drafted_note("Nothing to report.") == []
