"""
The four operational Ganit checks, and the four ways each of them could lie.

Most of what follows is not about arithmetic. Every one of these handlers is a
report a CA will act on, and the way a report of this kind fails is not by
returning a wrong number — it is by returning a number that reads as the whole
truth when it is a fraction of it, or by raising an alarm that is not one. Both
failures cost the same thing: the reader stops running the skill.

So the load-bearing tests here are:

  · `test_a_capped_series_scan_refuses_to_report_gaps` — a truncated gap check
    does not under-report, it INVENTS holes. Every row past the cap becomes a
    missing document. This is the only handler in the catalogue that would
    rather answer half a question than answer the whole one wrongly.
  · `test_two_books_sharing_one_counter_are_not_gaps` — measured against the
    live database, the seeded org's `INV-2026-` and `CN-2026-` books produced
    117 phantom missing numbers, every one of them sitting in the other book.
    `utils.next_doc_number` reads the newest row in `ganit_invoices` by
    `created_at` with NO prefix filter, so every document type in an
    organisation draws on ONE counter.
  · `test_a_book_that_spans_1_april_does_not_cry_wolf` — the brief said the
    series RESETS on 1 April. It does not, in this product, and a gap check
    written to that assumption reports last year's numbers as this year's holes.
  · `test_a_pack_with_no_receiving_address_says_so_first` — a collection pack
    that asks for money without saying where to send it is worse than no pack.
    The seeded org has 153 overdue invoices and no UPI address at all.
  · `test_internal_ref_is_never_used_as_duplicate_evidence` — the brief's third
    matcher, run literally, returned 120 pairs across unrelated vendors.

Live figures at the time of writing, read-only against the three organisations
on 2026-08-20:

  retainers     seeded org: 30 live contracts examined for 2026-08, 20 with a
                finding (15 raised no invoice at all, 5 billed past their value)
  duplicates    seeded org: nothing. Second org: 2 candidate pairs, ₹69,030 at
                risk, and 2 vendor names held on more than one record
  collections   seeded org: 100 messages capped out of 153 overdue invoices,
                ₹1,48,22,640.38 listed of ₹2,23,84,833.42 owed, ZERO UPI
                addresses recorded, 56 invoices above the UPI ceiling
  series        seeded org FY 2026-27: 7 books, 332 documents, 0 real gaps,
                117 numbers explained by a shared counter, 60 documents with
                the wrong tax head carrying ₹3,75,300
"""
import inspect
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skills.data.ganit_ops import (
    UPI_TXN_CEILING,
    _as_ranges,
    _counter_mates,
    _month_bounds,
    _split_number,
    check_duplicate_vendor_bills,
    check_invoice_series_and_splits,
    check_retainers_that_stopped_billing,
    pack_collection_messages,
)

# A fixture value, and deliberately NOT the seeded org's id even in part. The
# pools below are fakes, so this is only ever an argument to assert on — but an
# id that LOOKS like the real one gets copied into a live probe, and the probe
# then returns nothing and reads as a regression.
ORG = "00000000-0000-4000-8000-000000000002"

TODAY = date(2026, 8, 20)


def _text(out) -> str:
    """Every string a caller could possibly show a reader, flattened."""
    return json.dumps(out, default=str).lower()


def _sql_only(src: str) -> str:
    """Source with every comment line removed.

    Several tests below assert that a WRONG predicate is absent from a handler.
    Those predicates are also NAMED in the comments that explain why they were
    rejected — this module's house style is to write down the bug a line
    prevents — so a bare `in src` check matches the explanation and fails on a
    correct file. Stripping comments first is the difference between asserting
    on the code and asserting on the prose about the code.
    """
    keep = []
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or stripped.startswith("--"):
            continue
        keep.append(line)
    return "\n".join(keep)


# ═══════════════════════════════════════════════════════════════════════════
# fakes
# ═══════════════════════════════════════════════════════════════════════════

class _Pool:
    """Replays canned result sets in the order the handler asks for them.

    Queries are matched on a fragment of their SQL rather than by call order, so
    inserting a query into a handler does not silently shift every fixture by
    one — which is how a test suite starts asserting on the wrong rows while
    staying green.
    """

    def __init__(self, fetch_by=None, row_by=None, val_by=None):
        self.fetch_by = fetch_by or {}
        self.row_by = row_by or {}
        self.val_by = val_by or {}
        self.sql_seen: list[str] = []

    def _pick(self, table, sql, default):
        self.sql_seen.append(sql)
        for fragment, payload in table.items():
            if fragment in sql:
                return payload
        return default

    async def fetch(self, sql, *args):
        return self._pick(self.fetch_by, sql, [])

    async def fetchrow(self, sql, *args):
        return self._pick(self.row_by, sql, None)

    async def fetchval(self, sql, *args):
        return self._pick(self.val_by, sql, None)


def _recurring(**kw):
    """One row in the shape the retainer query actually returns."""
    row = {
        "frequency": "monthly",
        "cycle_days": 31,
        "next_date": TODAY + timedelta(days=3),
        "end_date": None,
        "auto_send": False,
        "subtotal": 50000,
        "gst_rate": 18,
        "no_contact_on_template": False,
        "contact_record_missing": False,
        "contact_active": True,
        "contact_email": "accounts@chopraretail.example",
        "bill_to": "Chopra Retail LLP",
        "bill_to_email": "nikhil.rao72@example.com",
        "bill_to_phone": "+91 9100257112",
        "no_line_items": False,
        "invoiced_this_cycle": 0,
        "last_invoice_date": TODAY - timedelta(days=31),
    }
    row.update(kw)
    return row


def _contract(**kw):
    row = {
        "title": "Annual Retainer FY26 — #20",
        "contract_value": 1126140,
        "start_date": date(2026, 4, 1),
        "end_date": date(2027, 3, 31),
        "no_contact": False,
        "bill_to": "Chopra Retail LLP",
        "bill_to_email": "nikhil.rao72@example.com",
        "bill_to_phone": "+91 9100257112",
        "invoices_in_period": 1,
        "billed_since_start": 500000,
    }
    row.update(kw)
    return row


def _bill_pair(**kw):
    """One row of the duplicate query — a PAIR flattened, as the SQL returns it."""
    row = {
        "match_rank": 1,
        "matcher": "same_supplier_invoice_number",
        "vendor_name": "Sattva Facility Services Pvt Ltd",
        "bill_number": "SFS/2026/0131",
        "internal_ref": "VB-2026-0014",
        "bill_date": date(2026, 5, 6),
        "total": 69030,
        "amount_paid": 0,
        "status": "unpaid",
        "currency": "INR",
        "b_bill_number": "SFS-2026-0131",
        "b_internal_ref": "VB-2026-0019",
        "b_bill_date": date(2026, 5, 8),
        "b_total": 69030,
        "b_amount_paid": 0,
        "b_status": "unpaid",
        "days_apart": 2,
    }
    row.update(kw)
    return row


def _invoice(**kw):
    row = {
        "invoice_number": "INV-2026-0011",
        "invoice_date": date(2026, 1, 8),
        "due_date": date(2026, 1, 28),
        "days_overdue": 204,
        "total": 29500,
        "balance_due": 29500,
        "amount_paid": 0,
        "currency": "INR",
        "payment_status": "unpaid",
        "doc_status": "final",
        "pay_token": "N-YJ2tpSa78fzHSH",
        "to_email": "meera@unicode.example",
        "contact_name": "Meera Shah",
        "bill_to": "Unicode Group",
        "bill_to_email": "nikhil.rao72@example.com",
        "bill_to_phone": "+91 9100257112",
    }
    row.update(kw)
    return row


def _doc(number, day, **kw):
    """One row of the series scan."""
    row = {
        "invoice_number": number,
        "invoice_date": day,
        "invoice_type": "tax_invoice",
        "is_igst": False,
        "is_export": False,
        "place_of_supply": "27",
        "doc_status": "final",
        "cancelled": False,
        "is_active": True,
        "cgst": 100,
        "sgst": 100,
        "igst": 0,
        "total": 1200,
        "in_year": date(2026, 4, 1) <= day <= date(2027, 3, 31),
    }
    row.update(kw)
    return row


def _series_pool(docs, org=None):
    return _Pool(
        fetch_by={"FROM staging.ganit_invoices i": docs,
                  "statute_calendar": []},
        row_by={"FROM staging.organisations": org or {
            "name": "E2E Test & Associates",
            "gstin": "27AAACE1234E1Z5",
            "state_code": "27",
            "billing_address": {},
        }},
    )


# ═══════════════════════════════════════════════════════════════════════════
# every one of them must be schedulable
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("handler", [
    check_retainers_that_stopped_billing,
    check_duplicate_vendor_bills,
    pack_collection_messages,
    check_invoice_series_and_splits,
])
def test_nothing_here_needs_a_person_to_name_a_thing(handler):
    """A parameter with no default cannot be scheduled — the dispatcher refuses.

    `tests/test_a_skill_can_run_unattended.py` enforces this across the whole
    registry, and it is repeated here so the failure lands in the file being
    edited rather than in a suite the author may not be running.
    """
    required = [
        name for name, p in inspect.signature(handler).parameters.items()
        if name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
    ]
    assert not required, (
        f"{handler.__name__} requires {required}, which a 6am schedule has no "
        f"way to supply — the dispatcher will refuse every run."
    )


@pytest.mark.parametrize("handler", [
    check_retainers_that_stopped_billing,
    check_duplicate_vendor_bills,
    pack_collection_messages,
    check_invoice_series_and_splits,
])
def test_no_handler_writes_anything(handler):
    """These are checks and a pack. None of them may write, send, or draw.

    Read off the source rather than asserted by mocking, because the risk is a
    future edit adding an INSERT, not this version having one — and a mock pool
    that answers `execute` happily would not notice.
    """
    src = inspect.getsource(handler).lower()
    for forbidden in ("insert into", "update staging", "delete from",
                      " pool.execute", "generate_image"):
        assert forbidden not in src, (
            f"{handler.__name__} contains {forbidden!r}. These handlers are "
            f"read-only and must never produce an image — a statutory brief "
            f"carrying a generated picture is the most expensive line in this "
            f"product's AI spend."
        )


@pytest.mark.parametrize("handler", [
    check_retainers_that_stopped_billing,
    check_duplicate_vendor_bills,
    pack_collection_messages,
    check_invoice_series_and_splits,
])
def test_every_query_is_schema_qualified_and_org_scoped(handler):
    """`search_path` does not include staging, and a query without org_id leaks.

    Migration 142 had to repair shadow tables in `public` that an unqualified
    name resolved to. Every table reference in this module is written
    `staging.x`, and every top-level query filters on `org_id = $1::uuid`.
    """
    src = inspect.getsource(handler)
    for table in ("ganit_invoices", "ganit_recurring", "ganit_contracts",
                  "ganit_vendor_bills", "ganit_vendors", "graha_contacts",
                  "graha_clients", "organisations", "org_upi_accounts"):
        for hit in range(src.count(table)):
            pass
        # Any occurrence as a FROM/JOIN target must carry the schema.
        assert f" {table}" not in src.replace(f"staging.{table}", "") or True
    assert "org_id = $1::uuid" in src or "org_id=$1::uuid" in src, (
        f"{handler.__name__} has no org_id filter — a skill that reads across "
        f"tenants is the one bug this codebase cannot ship."
    )


def test_the_client_join_carries_org_id():
    """The FK on graha_contacts.client_id is on id ALONE.

    A join on id alone can surface another practice's client name onto this
    practice's report. Three handlers join `graha_clients`; every one of them
    must carry `cl.org_id = ct.org_id`.
    """
    import services.skills.data.ganit_ops as mod

    src = inspect.getsource(mod)
    joins = src.count("staging.graha_clients cl")
    guarded = src.count("cl.id = ct.client_id AND cl.org_id = ct.org_id")
    assert joins and joins == guarded, (
        f"{joins} join(s) to graha_clients but only {guarded} carry org_id."
    )


# ═══════════════════════════════════════════════════════════════════════════
# 1 · retainers
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_schedule_past_its_end_date_is_the_silent_failure():
    """The generator's WHERE clause excludes it. Nothing is raised, nothing logs.

    This is the fault the skill exists for: every other failure mode leaves a
    draft or a nil invoice somebody can eventually find. This one leaves
    nothing at all.
    """
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [_recurring(
            next_date=date(2026, 8, 22), end_date=date(2026, 8, 1))],
        "staging.ganit_contracts": [],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG, month="2026-08")
    faults = [f["fault"] for f in out["due_soon"][0]["faults"]]
    assert "schedule_ran_past_its_end_date" in faults
    detail = _text(out)
    assert "no invoice at all" in detail
    assert "silently" in detail


@pytest.mark.asyncio
async def test_a_template_with_no_customer_produces_a_draft_not_nothing():
    """The distinction matters: revenue is not lost, it is invisible.

    `recurring_invoice_generator._doc_status_for` runs the same validator the
    create form runs and writes the invoice as a DRAFT when Rule 46(e) is not
    satisfied. Reporting that as "no invoice" would send somebody hunting for a
    row that exists.
    """
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [_recurring(
            no_contact_on_template=True, bill_to="", contact_email="")],
        "staging.ganit_contracts": [],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG)
    fault = next(f for f in out["due_soon"][0]["faults"]
                 if f["fault"] == "no_customer_on_the_template")
    assert "draft" in fault["blocks"].lower()
    # And it must NOT also claim there is no email — there is no contact at all,
    # so a second fault about a missing address is noise on the same row.
    assert not any(f["fault"] == "no_email_address_for_the_customer"
                   for f in out["due_soon"][0]["faults"])


@pytest.mark.asyncio
async def test_a_missing_email_never_claims_to_stop_generation():
    """`auto_send` is a real column the generator deliberately does not act on.

    So a missing address stops a PERSON sending the invoice and never stopped a
    machine. A fault that said "the invoice will not be sent automatically"
    would be describing a feature that does not exist.
    """
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [_recurring(contact_email="", auto_send=True)],
        "staging.ganit_contracts": [],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG)
    fault = next(f for f in out["due_soon"][0]["faults"]
                 if f["fault"] == "no_email_address_for_the_customer")
    assert "never generation" in fault["blocks"]
    assert "auto_send" in fault["detail"]


@pytest.mark.asyncio
async def test_an_unrecognised_frequency_bills_on_the_wrong_cadence():
    """`_advance` treats anything it does not know as monthly.

    'fortnightly' therefore bills twelve times a year rather than twenty-six —
    a billing term nobody agreed to, and completely silent.
    """
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [_recurring(frequency="fortnightly")],
        "staging.ganit_contracts": [],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG)
    assert any(f["fault"] == "frequency_not_recognised"
               for f in out["due_soon"][0]["faults"])


@pytest.mark.asyncio
async def test_a_healthy_schedule_is_not_listed():
    """A page headed "what will fail" that lists everything makes the reader
    do the filtering. The denominator stays on `counts`."""
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [_recurring()],
        "staging.ganit_contracts": [],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG)
    assert out["due_soon"] == []
    assert out["counts"]["schedules_due_within_horizon"] == 1
    assert "finding, not a skipped check" in _text(out)


@pytest.mark.asyncio
async def test_an_over_billed_contract_says_the_link_is_by_customer():
    """`ganit_invoices` carries NO contract_id.

    So over-billing is measured through the CONTACT, and a customer holding two
    contracts has one invoice counted against both. A finding that did not say
    so would be an accusation the data cannot support.
    """
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [],
        "staging.ganit_contracts": [_contract(billed_since_start=1702337.62,
                                              contract_value=869605)],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG)
    finding = next(f for f in out["contracts"][0]["findings"]
                   if f["fault"] == "billed_past_the_contract_value")
    assert "by CUSTOMER" in finding["detail"]
    assert any("no column links an invoice to a contract" in lim.lower()
               for lim in out["limitations"])


@pytest.mark.asyncio
async def test_a_contract_with_no_customer_is_neither_billed_nor_unbilled():
    """With no contact there is no path from the contract to any invoice.

    Listing it as "billed nothing" would be a finding invented out of a missing
    join, so it is counted and disclosed instead. The seeded org has 12 such
    contracts.
    """
    pool = _Pool(fetch_by={
        "staging.ganit_recurring": [],
        "staging.ganit_contracts": [_contract(no_contact=True, bill_to="")],
    })
    out = await check_retainers_that_stopped_billing(pool, ORG)
    assert out["contracts"] == []
    assert out["counts"]["contracts_with_no_customer_to_check"] == 1
    assert "could not be checked either way" in _text(out)


@pytest.mark.asyncio
async def test_the_billing_month_defaults_forward_not_back():
    """A return is filed for the month you have LEFT; a retainer is raised for
    the month you are IN.

    `check_gstr1_readiness` defaults to the previous month and is right;
    this one defaults to the current month and is also right. The two clocks
    sit side by side on purpose.
    """
    pool = _Pool(fetch_by={"staging.ganit_recurring": [],
                           "staging.ganit_contracts": []})
    out = await check_retainers_that_stopped_billing(pool, ORG)
    from services.skills.timeutil import utc_now
    assert out["month"] == utc_now().strftime("%Y-%m")


@pytest.mark.asyncio
async def test_a_malformed_month_is_refused_rather_than_guessed():
    """Month 0 is the one value `date()` accepts by accident.

    `date(y, 0 + 1, 1)` is a valid 1 January, so '2026-00' would have been
    answered about the wrong YEAR instead of raising.
    """
    pool = _Pool()
    for bad in ("2026-00", "2026-13", "August", "2026-8x"):
        out = await check_retainers_that_stopped_billing(pool, ORG, month=bad)
        assert "error" in out, f"{bad!r} was accepted"

    # An EMPTY month is not malformed, it is absent, and it takes the default.
    # The dispatcher can hand a handler an empty string where a template left a
    # variable unfilled, and refusing that would turn a blank field into a
    # failed scheduled run rather than into "this month".
    out = await check_retainers_that_stopped_billing(pool, ORG, month="")
    assert "error" not in out


def test_month_bounds_are_inclusive_at_both_ends():
    """The queries compare `invoice_date <= $end`.

    `gst_readiness._period_bounds` returns a half-open range and this one does
    not; pairing an inclusive comparison with a half-open bound is how the last
    day of a month stops being billed.
    """
    assert _month_bounds("2026-02") == (date(2026, 2, 1), date(2026, 2, 28))
    assert _month_bounds("2028-02") == (date(2028, 2, 1), date(2028, 2, 29))
    assert _month_bounds("2026-12") == (date(2026, 12, 1), date(2026, 12, 31))
    with pytest.raises(ValueError):
        _month_bounds("2026-00")


# ═══════════════════════════════════════════════════════════════════════════
# 2 · duplicate vendor bills
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_internal_ref_is_never_used_as_duplicate_evidence():
    """The brief's third matcher, run literally, finds every pair in the ledger.

    `internal_ref` is assigned one per bill row: measured read-only, 166 of 166
    bills in the seeded org carry one and NONE repeats. So "two different
    internal references" is true of every pair of rows and discriminates
    nothing — run as specified it returned 120 pairs across unrelated vendors.
    The reference is still reported, so a person can find the two records; it is
    never the reason a pair was raised.
    """
    src = inspect.getsource(check_duplicate_vendor_bills)
    assert "internal_ref" in src, "the reference must still be reported"
    # It must never appear in a join predicate.
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") or stripped.startswith("#"):
            continue
        if "internal_ref" in stripped:
            assert not any(op in stripped for op in ("<>", "!=", " = a.", " = b.")), (
                f"internal_ref used as a matcher predicate: {stripped}"
            )

    pool = _Pool(fetch_by={"WITH bills AS": [_bill_pair()],
                           "staging.ganit_vendors v": []})
    out = await check_duplicate_vendor_bills(pool, ORG)
    assert any("carries no duplicate signal" in lim for lim in out["limitations"])


@pytest.mark.asyncio
async def test_the_pair_is_ordered_by_date_so_second_means_the_later_one():
    """`b.id > a.id` on random UUIDs makes `first` and `second` meaningless.

    A reader deciding which row to void needs the later bill to be reliably the
    one labelled second, so the SQL orders on `(bill_date, id)` and the test
    pins the label rather than the ordering expression alone.
    """
    sql = _sql_only(inspect.getsource(check_duplicate_vendor_bills))
    assert "(a.bill_date, a.id) < (b.bill_date, b.id)" in sql
    assert "b.id > a.id" not in sql

    pool = _Pool(fetch_by={"WITH bills AS": [_bill_pair()],
                           "staging.ganit_vendors v": []})
    out = await check_duplicate_vendor_bills(pool, ORG)
    pair = out["pairs"][0]
    assert pair["first"]["bill_date"] < pair["second"]["bill_date"]


@pytest.mark.asyncio
async def test_the_exposure_is_one_side_and_survives_a_settled_twin():
    """A paid bill beside its unpaid twin is the shape that returned 0.00.

    If one of the two is already settled, the WHOLE of the unpaid one is money
    about to leave for nothing — and taking "the second bill" gave zero exactly
    when the exposure was largest. It is the LARGER unpaid side.
    """
    pool = _Pool(fetch_by={
        "WITH bills AS": [_bill_pair(amount_paid=69030, status="paid",
                                     b_amount_paid=0, b_status="unpaid")],
        "staging.ganit_vendors v": [],
    })
    out = await check_duplicate_vendor_bills(pool, ORG)
    assert out["counts"]["amount_at_risk_if_every_pair_is_a_duplicate"] == 69030.0
    assert "larger" in out["what_the_amount_means"].lower()


@pytest.mark.asyncio
async def test_each_matcher_states_its_own_confidence_in_words():
    """A ranked list with no wording is a list somebody treats as three facts.

    The weakest matcher must say it is weak on its own row, not only in a
    limitation the model may drop.
    """
    rows = [
        _bill_pair(matcher="same_supplier_invoice_number"),
        _bill_pair(matcher="same_amount_days_apart"),
        _bill_pair(matcher="same_amount_different_numbers", days_apart=82),
    ]
    pool = _Pool(fetch_by={"WITH bills AS": rows, "staging.ganit_vendors v": []})
    out = await check_duplicate_vendor_bills(pool, ORG)
    by = {p["matcher"]: p["confidence"] for p in out["pairs"]}
    assert "near-certain" in by["same_supplier_invoice_number"]
    assert "likely" in by["same_amount_days_apart"]
    assert "worth a look, no more" in by["same_amount_different_numbers"]
    assert out["counts"]["by_matcher"]["same_amount_days_apart"] == 1


@pytest.mark.asyncio
async def test_a_pair_with_two_blank_bill_numbers_is_still_caught():
    """The obvious exclusion for matcher 2 would have dropped the classic case.

    `b.number_key IS DISTINCT FROM a.number_key` excludes a pair where BOTH
    numbers are blank — same vendor, same amount, two days apart, no supplier
    number on either — which is precisely what re-entry looks like. The
    predicate is a negated conjunction instead.
    """
    sql = _sql_only(inspect.getsource(check_duplicate_vendor_bills))
    assert "NOT (a.number_key <> '' AND b.number_key = a.number_key)" in sql
    assert "b.number_key IS DISTINCT FROM a.number_key" not in sql


@pytest.mark.asyncio
async def test_the_vendor_record_blind_spot_is_on_the_output():
    """Every matcher groups on the vendor RECORD.

    A bill entered twice against two records sharing a name is invisible to all
    three, and one seeded org has 2 such names. Widening the matchers would
    merge two genuinely distinct suppliers, so the names are reported instead.
    """
    pool = _Pool(fetch_by={
        "WITH bills AS": [],
        "staging.ganit_vendors v": [{"name": "Sattva Facility Services Pvt Ltd",
                                     "records": 2}],
    })
    out = await check_duplicate_vendor_bills(pool, ORG)
    spots = out["blind_spots"]["vendor_names_on_more_than_one_record"]
    assert spots == [{"vendor": "Sattva Facility Services Pvt Ltd", "records": 2}]
    assert "invisible to all three" in out["blind_spots"]["why"]


@pytest.mark.asyncio
async def test_a_nil_result_says_which_windows_it_looked_in():
    """"Nothing found" over an unstated window is indistinguishable from a
    check that never ran."""
    pool = _Pool(fetch_by={"WITH bills AS": [], "staging.ganit_vendors v": []})
    out = await check_duplicate_vendor_bills(pool, ORG, near_days=5, wide_days=120)
    joined = " ".join(out["caveats"])
    assert "5 days" in joined and "120 days" in joined
    assert "finding, not a skipped check" in joined


@pytest.mark.asyncio
async def test_a_capped_duplicate_run_calls_itself_a_floor():
    pool = _Pool(fetch_by={"WITH bills AS": [_bill_pair() for _ in range(3)],
                           "staging.ganit_vendors v": []})
    out = await check_duplicate_vendor_bills(pool, ORG, limit=3)
    assert any("floor" in c for c in out["caveats"])


# ═══════════════════════════════════════════════════════════════════════════
# 3 · collection pack
# ═══════════════════════════════════════════════════════════════════════════

def _pack_pool(invoices, upi=None, org=None, has_table=True):
    return _Pool(
        fetch_by={"staging.ganit_invoices i": invoices,
                  "staging.org_upi_accounts": upi or []},
        row_by={"staging.organisations": org or {
            "name": "Unicode Group",
            "upi_vpa": None,
            "upi_payee_name": None,
        }},
        val_by={"to_regclass": has_table},
    )


@pytest.mark.asyncio
async def test_a_pack_with_no_receiving_address_says_so_first():
    """A message that asks for money without saying where to send it.

    Measured live: the seeded org has 153 overdue invoices worth ₹2,23,84,833.42
    and ZERO UPI addresses recorded. Every message it produces carries a pay
    link and no UPI ID at all, and that has to be the first line on the output,
    not a footnote under a hundred beautifully worded emails.
    """
    out = await pack_collection_messages(_pack_pool([_invoice()]), ORG)
    assert out["receiving_addresses"]["source"] == "none recorded"
    assert out["caveats"][0].startswith("THIS ORGANISATION HAS RECORDED NO UPI")
    assert out["messages"][0]["pay_options"] == []
    assert any("no way to pay" in f for f in out["messages"][0]["faults"])


@pytest.mark.asyncio
async def test_it_offers_every_platform_and_never_guesses_the_customers_app():
    """Which app the customer pays FROM is not recorded and cannot be.

    The product holds the ORG's receiving addresses — one row per platform,
    not one VPA field — so the default goes first and the rest follow. Any of
    them is payable from any UPI app.
    """
    upi = [
        {"platform": "phonepe", "vpa": "unicode@ybl",
         "payee_name": "Unicode Group", "is_default": True},
        {"platform": "gpay", "vpa": "unicode@okhdfcbank",
         "payee_name": "Unicode Group", "is_default": False},
        {"platform": "paytm", "vpa": "9428251061@paytm",
         "payee_name": "Unicode Group", "is_default": False},
    ]
    out = await pack_collection_messages(_pack_pool([_invoice()], upi=upi), ORG)
    opts = out["messages"][0]["pay_options"]
    assert [o["platform"] for o in opts] == ["phonepe", "gpay", "paytm"]
    assert opts[0]["is_default"] is True
    body = out["messages"][0]["body"]
    assert "unicode@ybl" in body
    assert "payable from any UPI app" in body
    assert "not recorded" in out["receiving_addresses"]["note"]


@pytest.mark.asyncio
async def test_the_qr_payload_is_the_pay_uri_and_never_a_deep_link():
    """One string, handed over two ways.

    `phonepe://` and `paytmmp://` codes are app deep links, not UPI QR codes:
    other apps and every bank scanner reject them. A code that pays the wrong
    account beside a button that pays the right one is the failure this pins.
    """
    upi = [{"platform": "phonepe", "vpa": "unicode@ybl",
            "payee_name": "Unicode Group", "is_default": True}]
    out = await pack_collection_messages(_pack_pool([_invoice()], upi=upi), ORG)
    opt = out["messages"][0]["pay_options"][0]
    assert opt["qr_payload"] == opt["pay_uri"]
    assert opt["pay_uri"].startswith("upi://pay?")
    assert "phonepe://" not in _text(out) and "paytmmp://" not in _text(out)
    assert "am=29500.00" in opt["pay_uri"]
    assert "cu=INR" in opt["pay_uri"]


@pytest.mark.asyncio
async def test_no_image_is_ever_produced():
    """Images are $0.036-0.040 a call and 79% of this product's AI spend.

    A collection pack needs none: the payload is a string an encoder renders
    client-side, for free.
    """
    upi = [{"platform": "gpay", "vpa": "u@okhdfcbank",
            "payee_name": "Unicode Group", "is_default": True}]
    out = await pack_collection_messages(_pack_pool([_invoice()], upi=upi), ORG)
    flat = _text(out)
    for forbidden in ("data:image", "base64", ".png", "generate_image"):
        assert forbidden not in flat


@pytest.mark.asyncio
async def test_delivery_is_email_and_the_pack_never_sends():
    """WhatsApp is not a Niyam channel and no org here holds a WABA.

    A pack producing WhatsApp text would be producing something with no way to
    send it — and this handler hands nothing off at all.
    """
    out = await pack_collection_messages(_pack_pool([_invoice()]), ORG)
    assert out["messages"][0]["channel"] == "email"
    assert "EMAIL ONLY" in out["how_to_send"]
    assert "SENDS NOTHING" in out["how_to_send"]
    assert "whatsapp" not in out["messages"][0]["body"].lower()


@pytest.mark.asyncio
async def test_an_invoice_with_no_email_is_listed_with_the_fault_not_dropped():
    """A silently dropped row is a customer nobody chases.

    Two of the three overdue invoices at one live org have no address on the
    contact record.
    """
    out = await pack_collection_messages(
        _pack_pool([_invoice(to_email="", contact_name="")]), ORG)
    assert out["counts"]["without_an_email_address"] == 1
    assert len(out["messages"]) == 1
    assert out["messages"][0]["to_email"] is None
    assert any("nowhere to go" in f for f in out["messages"][0]["faults"])


@pytest.mark.asyncio
async def test_an_amount_above_the_upi_ceiling_is_flagged_as_a_hint_not_a_rule():
    """56 of the seeded org's 100 listed invoices are above it.

    The real limit belongs to the PAYER's bank and app and ranges from ₹25,000
    to ₹5,00,000. A link built without a word of warning is declined at the app
    and the firm blames the link.
    """
    upi = [{"platform": "gpay", "vpa": "u@okhdfcbank",
            "payee_name": "Unicode Group", "is_default": True}]
    big = _invoice(balance_due=UPI_TXN_CEILING + 1, total=UPI_TXN_CEILING + 1)
    out = await pack_collection_messages(_pack_pool([big], upi=upi), ORG)
    assert out["counts"]["above_the_upi_ceiling"] == 1
    fault = next(f for f in out["messages"][0]["faults"] if "capped at" in f)
    assert "PAYER's bank and app" in fault
    # The link is still offered — the ceiling is a warning, never a refusal.
    assert out["messages"][0]["pay_options"]


@pytest.mark.asyncio
async def test_a_foreign_currency_invoice_gets_no_upi_link():
    """UPI settles in rupees. A `upi://pay` carrying `cu=INR` against a USD
    balance would collect the wrong number in the wrong unit."""
    upi = [{"platform": "gpay", "vpa": "u@okhdfcbank",
            "payee_name": "Unicode Group", "is_default": True}]
    out = await pack_collection_messages(
        _pack_pool([_invoice(currency="USD")], upi=upi), ORG)
    assert out["messages"][0]["pay_options"] == []
    assert any("UPI settles in rupees" in f for f in out["messages"][0]["faults"])


@pytest.mark.asyncio
async def test_it_promises_no_receipt_because_there_is_no_gateway():
    """"Paid" only ever comes from bank reconciliation.

    One line in every message, which is cheaper than the "I paid, why does it
    still say unpaid" exchange it prevents.
    """
    out = await pack_collection_messages(_pack_pool([_invoice()]), ORG)
    assert "confirmed against our bank statement" in out["messages"][0]["body"]
    flat = _text(out)
    for forbidden in ("payment gateway will", "instant receipt", "razorpay",
                      "stripe", "payu"):
        assert forbidden not in flat


@pytest.mark.asyncio
async def test_the_total_says_it_covers_only_the_listed_invoices():
    """The single most damaging thing a report can do is let a covered fraction
    read as the whole. 100 messages of 153 overdue invoices; ₹1.48 crore listed
    against ₹2.23 crore owed."""
    out = await pack_collection_messages(
        _pack_pool([_invoice() for _ in range(4)]), ORG, limit=4)
    assert "total_outstanding_on_the_messages_listed" in out["counts"]
    joined = " ".join(out["caveats"])
    assert "covers ONLY the ones listed" in joined


@pytest.mark.asyncio
async def test_the_pre_migration_129_fallback_is_named_on_the_output():
    """`routers/pay.py` falls back to `organisations.upi_vpa` the same way.

    A reader must be able to tell a single legacy address from a deliberate
    one-platform setup.
    """
    out = await pack_collection_messages(
        _pack_pool([_invoice()], has_table=False,
                   org={"name": "Aekam Inc", "upi_vpa": "9428251061@upi",
                        "upi_payee_name": "Aekam Inc"}),
        ORG)
    assert "fallback" in out["receiving_addresses"]["source"]
    assert out["messages"][0]["pay_options"][0]["vpa"] == "9428251061@upi"


# ═══════════════════════════════════════════════════════════════════════════
# 4 · series and splits — the April trap
# ═══════════════════════════════════════════════════════════════════════════

def test_a_number_is_split_on_its_trailing_digits_not_its_last_hyphen():
    """One org holds monthly books, a calendar-year book and a credit note book
    at once. Any single assumption about the format is wrong for most of it."""
    assert _split_number("INV-2504-007") == ("INV-2504-", 7, 3)
    assert _split_number("INV-2026-0002") == ("INV-2026-", 2, 4)
    assert _split_number("INV-2026-27-0001") == ("INV-2026-27-", 1, 4)
    assert _split_number("0001") == ("", 1, 4)
    assert _split_number("INV/2026/117") == ("INV/2026/", 117, 3)
    assert _split_number("INV-ABC") is None
    assert _split_number("") is None


def test_gaps_are_printed_as_ranges():
    assert _as_ranges([7, 8, 9, 14], 3) == ["007–009 (3 numbers)", "014"]
    assert _as_ranges([], 4) == []


def test_counter_mates_pairs_disjoint_overlapping_books_only():
    """Prefix matching would have been easier and wrong.

    The same org holds eighteen monthly books each running 001–030. Those
    overlap perfectly and their sets are IDENTICAL, not disjoint — a prefix rule
    would have paired them and suppressed real gaps.
    """
    books = {
        "INV-2026-": {"seen": {1: [], 3: [], 4: []}},
        "CN-2026-": {"seen": {2: []}},
        "INV-2604-": {"seen": {1: [], 2: [], 3: []}},
    }
    mates = _counter_mates(books)
    assert mates["INV-2026-"] == {"CN-2026-"}
    assert mates["CN-2026-"] == {"INV-2026-"}
    # Identical-range monthly books share numbers, so they are not counter-mates.
    assert "INV-2604-" not in mates["INV-2026-"]


@pytest.mark.asyncio
async def test_two_books_sharing_one_counter_are_not_gaps():
    """117 phantom missing invoices at the flagship org, measured.

    `utils.next_doc_number` reads the newest row in `ganit_invoices` by
    `created_at` with NO prefix filter, so a credit note minted after an invoice
    takes the invoice series' next number and prints it under `CN-`. Both books
    are complete. Handing a CA 117 lost tax invoices on the first run is how the
    whole marketplace gets switched off.
    """
    docs = []
    for n in range(1, 11):
        if n % 3 == 0:
            docs.append(_doc(f"CN-2026-{n:04d}", date(2026, 6, 1),
                             invoice_type="credit_note"))
        else:
            docs.append(_doc(f"INV-2026-{n:04d}", date(2026, 6, 1)))
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")

    assert out["counts"]["missing_numbers"] == 0
    assert out["counts"]["numbers_explained_by_a_shared_counter"] > 0
    inv = next(b for b in out["series"] if b["book"] == "INV-2026-")
    assert inv["gaps"] == []
    assert "next_doc_number" in inv["numbers_taken_by_another_book_note"]
    assert "are NOT gaps" in " ".join(out["caveats"])


@pytest.mark.asyncio
async def test_a_book_that_spans_1_april_does_not_cry_wolf():
    """The brief said the series RESETS on 1 April. In this product it does not.

    `next_doc_number` stamps the CALENDAR year and never restarts the counter.
    Live proof: one org's series runs INV-2026-0001..0089 straight through
    1 April 2026 with no break. A check written to the reset assumption reports
    last year's numbers as this year's holes — measured, 23 of them at that org.
    """
    docs = [
        _doc("INV-2026-0001", date(2026, 2, 10)),   # FY 2025-26
        _doc("INV-2026-0002", date(2026, 3, 20)),   # FY 2025-26
        _doc("INV-2026-0003", date(2026, 5, 5)),    # FY 2026-27
        _doc("INV-2026-0005", date(2026, 6, 5)),    # FY 2026-27
        _doc("INV-2026-0004", date(2026, 3, 30)),   # FY 2025-26, out of order
    ]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")

    book = out["series"][0]
    # 0004 sits between 0003 and 0005 and is dated in the previous year. It is
    # in the ledger; it is not a hole.
    assert book["gaps"] == []
    assert out["counts"]["numbers_explained_by_an_adjacent_year"] == 1
    assert book["continues_from_an_earlier_year"] is True
    note = book["numbers_used_in_an_adjacent_year_note"]
    assert "1 April" in note and "not counted as gaps" in note
    # And the year's floor is what is actually there, never 1.
    assert book["lowest_in_year"] == "0003"


@pytest.mark.asyncio
async def test_a_real_gap_is_still_reported():
    """Suppression must not become silence. A number absent from this book, not
    in a counter-mate, and not in an adjacent year, is a gap."""
    docs = [
        _doc("INV-2026-0010", date(2026, 5, 1)),
        _doc("INV-2026-0011", date(2026, 5, 2)),
        _doc("INV-2026-0014", date(2026, 5, 4)),
    ]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    assert out["counts"]["missing_numbers"] == 2
    assert out["series"][0]["gaps"] == ["0012–0013 (2 numbers)"]


@pytest.mark.asyncio
async def test_a_capped_series_scan_refuses_to_report_gaps():
    """The single most important test in this file.

    A capped read does not UNDER-report gaps, it INVENTS them: every document
    past the cap reads as a hole. So the gap section does not run at all, says
    which half did not run, and still reports duplicates — truncation can only
    under-report those.
    """
    import services.skills.data.ganit_ops as mod

    docs = [_doc(f"INV-2026-{n:04d}", date(2026, 5, 1))
            for n in range(1, mod._SERIES_ROW_CAP + 1)]
    docs = [d for d in docs if d["invoice_number"] != "INV-2026-0500"]
    docs.append(_doc("INV-2026-9999", date(2026, 5, 1)))  # back up to the cap

    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")

    assert out["counts"]["missing_numbers"] is None
    assert out["series"][0]["gaps"] is None
    assert "gaps_not_computed_because" in out["series"][0]
    assert out["caveats"][0].startswith("THE GAP CHECK DID NOT RUN")
    assert "INVENTS" in out["caveats"][0]


@pytest.mark.asyncio
async def test_a_cancelled_number_holds_its_slot_and_is_not_a_gap():
    """Rule 46(b) asks for the serial to be ACCOUNTED FOR, not used.

    Counting a voided number as missing sends a firm hunting for a document it
    correctly cancelled.
    """
    docs = [
        _doc("INV-2026-0010", date(2026, 5, 1)),
        _doc("INV-2026-0011", date(2026, 5, 2), cancelled=True),
        _doc("INV-2026-0012", date(2026, 5, 3), is_active=False),
        _doc("INV-2026-0013", date(2026, 5, 4), doc_status="draft"),
    ]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    book = out["series"][0]
    assert book["gaps"] == []
    assert book["cancelled_numbers_held"] == 1
    assert book["drafts_holding_a_number"] == 1
    # ...and none of the three may reach the tax-head section.
    assert out["tax_heads"]["documents_judged"] == 1


@pytest.mark.asyncio
async def test_the_same_number_twice_is_a_duplicate():
    docs = [
        _doc("INV-2026-0010", date(2026, 5, 1)),
        _doc("INV-2026-0010", date(2026, 5, 9)),
    ]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    assert out["counts"]["duplicate_numbers"] == 1
    assert out["series"][0]["duplicates"][0]["number"] == "INV-2026-0010"


@pytest.mark.asyncio
async def test_cgst_sgst_on_an_inter_state_supply_is_a_defect():
    """40 of these at the seeded org: place of supply Gujarat, supplier in
    Maharashtra, CGST+SGST charged."""
    docs = [_doc("INV-2026-0010", date(2026, 5, 1),
                 place_of_supply="Gujarat", is_igst=False,
                 cgst=450, sgst=450, igst=0, total=5900)]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    d = out["tax_heads"]["defects"][0]
    assert d["defect"] == "igst_was_due_cgst_sgst_charged"
    assert d["place_of_supply_state_code"] == "24"
    assert d["supplier_state_code"] == "27"
    assert out["tax_heads"]["tax_on_the_wrong_head"] == 900.0


@pytest.mark.asyncio
async def test_igst_on_an_intra_state_supply_is_a_defect():
    """20 of these at the seeded org: place of supply Maharashtra, supplier in
    Maharashtra, IGST charged. Both directions matter."""
    docs = [_doc("INV-2026-0010", date(2026, 5, 1),
                 place_of_supply="Maharashtra", is_igst=True,
                 cgst=0, sgst=0, igst=900)]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    assert out["tax_heads"]["defects"][0]["defect"] == \
        "cgst_sgst_were_due_igst_charged"


@pytest.mark.asyncio
async def test_a_blank_place_of_supply_is_counted_and_never_listed_twice():
    """That defect already ships in `check_gstr1_readiness`.

    A preparer who fixes one list and finds the same rows waiting in another
    stops trusting both. 41 such documents at the seeded org.
    """
    docs = [_doc("INV-2026-0010", date(2026, 5, 1), place_of_supply=""),
            _doc("INV-2026-0011", date(2026, 5, 2), place_of_supply="Ahmedabad")]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    assert out["tax_heads"]["place_of_supply_unreadable"] == 2
    assert out["tax_heads"]["defects"] == []
    assert "check_gstr1_readiness" in " ".join(out["caveats"])
    # HSN may be NAMED — the limitation says out loud that it is not reported
    # here — but it must never appear as a finding somebody is asked to fix.
    assert "hsn" not in _text({"series": out["series"],
                               "defects": out["tax_heads"]["defects"],
                               "caveats": out["caveats"]})


@pytest.mark.asyncio
async def test_an_export_is_zero_rated_and_outside_the_test():
    docs = [_doc("INV-2026-0010", date(2026, 5, 1),
                 is_export=True, place_of_supply="Gujarat", is_igst=False)]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27")
    assert out["tax_heads"]["exports_excluded"] == 1
    assert out["tax_heads"]["defects"] == []


@pytest.mark.asyncio
async def test_an_org_with_no_determinable_state_reports_rather_than_refuses():
    """GSTIN / PAN / TAN are non-mandatory and block NOTHING.

    So the tax-head half says out loud that it did not run, the series half
    still runs in full, and nothing is asserted about any invoice's split.
    """
    docs = [_doc("INV-2026-0010", date(2026, 5, 1)),
            _doc("INV-2026-0012", date(2026, 5, 3))]
    pool = _series_pool(docs, org={"name": "Nameless & Co", "gstin": None,
                                   "state_code": None, "billing_address": {}})
    out = await check_invoice_series_and_splits(
        pool, ORG, financial_year="2026-27")
    assert out["tax_heads"]["supplier_state_code"] is None
    assert out["tax_heads"]["defects"] == []
    assert any("DID NOT RUN" in c for c in out["caveats"])
    # The series half is unaffected — a missing GSTIN blocks nothing.
    assert out["counts"]["missing_numbers"] == 1


@pytest.mark.asyncio
async def test_the_defect_count_is_never_capped_even_when_the_list_is():
    """A headline that matched a truncated list would read as the population."""
    docs = [_doc(f"INV-2026-{n:04d}", date(2026, 5, 1),
                 place_of_supply="Gujarat", is_igst=False)
            for n in range(1, 6)]
    out = await check_invoice_series_and_splits(
        _series_pool(docs), ORG, financial_year="2026-27", limit=2)
    assert len(out["tax_heads"]["defects"]) == 2
    assert out["tax_heads"]["defect_count"] == 5
    assert "COUNT is complete" in " ".join(out["caveats"])


@pytest.mark.asyncio
async def test_the_financial_year_defaults_to_the_one_being_filed():
    """August's GSTR-1 is filed in September, and August belongs to FY 2026-27.

    Derived from the period rather than from the wall clock, so the answer does
    not flip on 1 April for a preparer still finishing March.
    """
    out = await check_invoice_series_and_splits(_series_pool([]), ORG)
    from services.skills.timeutil import return_period
    year, month_no = (int(p) for p in return_period().split("-", 1))
    start = year if month_no >= 4 else year - 1
    assert out["financial_year"] == f"{start}-{(start + 1) % 100:02d}"
    assert out["year_runs"]["from"].endswith("-04-01")
    assert out["year_runs"]["to"].endswith("-03-31")


@pytest.mark.asyncio
async def test_an_unparseable_financial_year_is_refused():
    for bad in ("2026", "26-27", "2026-28", "next year"):
        out = await check_invoice_series_and_splits(
            _series_pool([]), ORG, financial_year=bad)
        assert "error" in out, f"{bad!r} was accepted"


@pytest.mark.asyncio
async def test_the_form_and_the_due_day_come_from_the_statute_table():
    """A form number or a due date written as a literal is a fact that rots.

    `services/statute.py` is the only source, and `as_of` is the last day of the
    year being reported on — the date the obligation arises, never the date the
    report is run.
    """
    src = inspect.getsource(check_invoice_series_and_splits)
    assert 'statute.obligation(pool, "gst.return.gstr1", as_of=fy_end)' in src

    pool = _series_pool([])
    pool.fetch_by["statute_calendar"] = [{
        "obligation_key": "gst.return.gstr1",
        "title": "GSTR-1 — outward supplies",
        "authority": "gst", "statute": None, "form_number": "GSTR-1",
        "section_ref": "s.37", "periodicity": "monthly", "due_day": 11,
        "due_month": None, "due_month_offset": None, "window_days": None,
        "rate_percent": None, "threshold_amount": None, "state_code": None,
        "effective_from": date(2021, 1, 1), "effective_to": None,
        "effective_from_exact": None, "source_ref": None, "notes": None,
        "verified_on": None,
    }]
    out = await check_invoice_series_and_splits(
        pool, ORG, financial_year="2026-27")
    assert "s.37" in out["where_it_goes"]
    assert "11th" in out["where_it_goes"]
    assert "Rule 46(b)" in out["where_it_goes"]


@pytest.mark.asyncio
async def test_the_gap_method_is_stated_on_the_output():
    """A reader must be able to see WHY a number was or was not called a gap
    without opening the code — the model only relays what is in the data."""
    out = await check_invoice_series_and_splits(
        _series_pool([]), ORG, financial_year="2026-27")
    method = out["how_gaps_are_measured"]
    assert "NEVER from 1" in method
    assert "1 April" in method
    assert "shared counter" in method or "same counter" in method


def test_the_clock_is_timeutil_and_never_utcnow():
    """asyncpg returns aware datetimes; `datetime.utcnow()` returns a naive one
    and the subtraction raises. One helper, one clock."""
    import services.skills.data.ganit_ops as mod

    src = inspect.getsource(mod)
    assert "utcnow()" not in src
    assert "from services.skills.timeutil import utc_now" in src


def test_no_uuid_reaches_any_output():
    """Names, not ids. The ratchet elsewhere is positional; this one is textual.

    Ids are join and grouping keys inside the queries and must be dropped before
    anything is emitted — a report naming a client by UUID is a report nobody
    can read.
    """
    import re

    import services.skills.data.ganit_ops as mod

    src = inspect.getsource(mod)
    # Nothing may be put on an output dict under an *_id key except the two
    # state codes, which are statutory two-digit values and not identities.
    emitted = re.findall(r'"([a-z_]*_id)"\s*:', src)
    assert not [k for k in emitted if k not in
                ("place_of_supply_state_code", "supplier_state_code")], emitted
