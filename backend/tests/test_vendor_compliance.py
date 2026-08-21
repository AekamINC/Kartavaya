"""Catalogue #49, #50, #51 — and the ways an empty column becomes a false clear.

These three run on columns migration 175 created on 2026-08-20 and BACKFILLED
NOTHING into. Every one of them is NULL on every live row and no screen writes
any of them. That makes the failure mode of this module different from every
other skill on the shelf: it does not return the wrong rows, it returns NO rows,
and no rows on a statutory matter reads as "you are fine".

The load-bearing tests, in the order they matter:

  · `test_an_empty_column_is_never_a_clean_result` — the whole point. 80 vendors,
    none classed, zero findings, and the output must SAY it could not check.
  · `test_medium_is_not_swept_in_and_a_trader_is_not_either` — the two exclusions
    the folio insists on, and the reason the gate is `enterprise_class` rather
    than `is_msme`: a medium enterprise IS an MSME and IS outside the section.
  · `test_an_unrecorded_kind_is_not_a_trader` — the other half. NULL is "nobody
    has said", and dropping those rows would hide real exposure.
  · `test_the_clock_starts_at_acceptance_not_the_bill_date` — using bill_date
    reports a breach EARLY. Same bill, two dates, two verdicts.
  · `test_the_section_number_has_a_date_on_it` — s.43B(h) until 1 April 2026,
    s.37(2)(g) from it. Neither is ever a literal.
  · `test_no_window_in_the_calendar_means_no_breach_is_declared` — the calendar
    genuinely carries no window today. The handler must age and stop.
  · `test_an_agreed_term_alone_cannot_clear_a_bill` — the subtle one. Without
    the statutory ceiling a 90-day agreed term would clear a bill on day 60,
    which is a false all-clear built from a real column.
  · `test_the_first_alert_day_is_derived_from_the_window` — the folio corrects
    an earlier "day 28". 23 must fall OUT of 30 minus the lead, not be typed.
  · `test_below_the_threshold_is_never_reported_as_not_applicable` — turnover is
    a PAN-level floor this product cannot see. Three verdicts, never two.
  · `test_no_section_is_ever_inferred` — a wrong section on a compliance report
    is worse than none.

Live figures, read-only, all three orgs, 2026-08-20 — every handler returned
`verdict: could_not_check`:

  #49  0 of 80 vendors classed; 95 open bills worth Rs 44,08,192; 0 in scope
  #50  0 of 80 vendors with a section; 67 vendors with activity, all unattributed
  #51  0 of 787 documents with an IRN; E2E Test is INSIDE the threshold on
       Rs 7,04,38,000 of FY 2025-26 turnover and still could not be aged
"""
import inspect
import json
import re
from datetime import date, datetime, timezone

import pytest

#: The shape `check-rendered-ids` refuses on the frontend, applied to the data
#: before it ever gets there.
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

from services.skills.data import vendor_compliance as vc
from services.skills.data.vendor_compliance import (
    ALERT_LEAD_DAYS, COVERED_CLASSES, EXCLUDED_KIND, NEAR_THRESHOLD_RATIO,
    check_einvoice_window, check_msme_payment_clock, check_tds_thresholds,
    _fy_of, _section_key,
)

ORG = "00000000-0000-4000-8000-000000000049"
TODAY = date(2026, 8, 20)


def _text(out) -> str:
    """The whole payload as one lowercase string, for absence/presence checks."""
    return json.dumps(out, default=str).lower()


def _body(out) -> str:
    """The payload WITHOUT `limitations`.

    A caveat explaining why a figure is not shown necessarily contains the words
    for that figure, so asserting a phrase is absent has to exclude it first.
    """
    return json.dumps({k: v for k, v in out.items() if k != "limitations"},
                      default=str).lower()


class _Pool:
    """Canned result sets matched on a FRAGMENT OF THE SQL, never on call order.

    THE STATUTE ARM FILTERS BY KEY. `services/statute.py` narrows by
    `obligation_key` in SQL and resolves the version in Python, so a mock that
    returned every seeded row for every lookup would let `_resolve` choose
    between facts about DIFFERENT obligations. `check_msme_payment_clock` asks
    for three keys in one run — the section and both window legs — and without
    this filter one fixture row would answer all three, which would make
    `test_no_window_in_the_calendar_means_no_breach_is_declared` pass for
    entirely the wrong reason.
    """

    def __init__(self, fetch_by=None, row_by=None):
        self.fetch_by, self.row_by = fetch_by or {}, row_by or {}
        self.sql_seen: list[str] = []

    def _pick(self, table, sql, default):
        self.sql_seen.append(sql)
        for frag, payload in table.items():
            if frag in sql:
                return payload
        return default

    async def fetch(self, sql, *a):
        rows = self._pick(self.fetch_by, sql, [])
        if "statute_calendar" in sql and a and isinstance(a[0], str):
            return [r for r in rows if r.get("obligation_key") == a[0]]
        return rows

    async def fetchrow(self, sql, *a):
        return self._pick(self.row_by, sql, None)


def _statute(**kw):
    """One statute_calendar row in the shape services/statute.py returns."""
    row = {
        "obligation_key": vc.MSME_SECTION_KEY,
        "title": "Disallowance of a deduction for a payment to a micro or "
                 "small enterprise beyond the statutory window",
        "authority": "incometax", "statute": "Income-tax Act 1961",
        "form_number": None, "section_ref": "s.43B(h)", "periodicity": "standing",
        "due_day": None, "due_month": None, "due_month_offset": None,
        "window_days": None, "rate_percent": None, "threshold_amount": None,
        "state_code": None, "effective_from": date(2023, 4, 1),
        "effective_to": date(2026, 4, 1), "effective_from_exact": True,
        "source_ref": "Finance Act 2023", "notes": "", "verified_on": date(2026, 8, 19),
    }
    row.update(kw)
    return row


#: Both seeded versions of the disallowance, exactly as the live table holds
#: them: one closing on 1 April 2026 and one opening on it.
SECTION_ROWS = [
    _statute(),
    _statute(section_ref="s.37(2)(g)", statute="Income-tax Act 2025",
             effective_from=date(2026, 4, 1), effective_to=None),
]

#: The two window legs. NEITHER OF THESE EXISTS IN THE LIVE CALENDAR — they are
#: here only so the tests can prove what the handler does on the day they do.
WINDOW_ROWS = [
    _statute(obligation_key=vc.MSME_WINDOW_NO_AGREEMENT_KEY, window_days=15,
             title="MSME payment window — no written agreement",
             effective_from=date(2006, 10, 2), effective_to=None),
    _statute(obligation_key=vc.MSME_WINDOW_AGREED_MAX_KEY, window_days=45,
             title="MSME payment window — ceiling on an agreed term",
             effective_from=date(2006, 10, 2), effective_to=None),
]

EINVOICE_ROWS = [
    _statute(obligation_key=vc.EINVOICE_THRESHOLD_KEY, section_ref="rule 48(4)",
             statute="CGST Rules 2017", threshold_amount=50000000,
             title="E-invoicing applicability",
             effective_from=date(2023, 8, 1), effective_to=None),
]

EINVOICE_WINDOW = [
    _statute(obligation_key=vc.EINVOICE_WINDOW_KEY, window_days=30,
             title="E-invoice reporting window",
             effective_from=date(2023, 11, 1), effective_to=None),
]


def _vendor_facts(**kw):
    row = {
        "vendors_total": 0, "vendors_active": 0, "is_msme_recorded": 0,
        "class_recorded": 0, "micro_or_small": 0, "medium_out_of_scope": 0,
        "kind_recorded": 0, "traders_out_of_scope": 0, "terms_recorded": 0,
        "udyam_recorded": 0,
    }
    row.update(kw)
    return row


def _bill_facts(**kw):
    row = {"open_bills": 0, "open_balance": 0, "no_vendor": 0,
           "acceptance_recorded": 0}
    row.update(kw)
    return row


def _bill(**kw):
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "bill_number": "VB-0001", "bill_date": date(2026, 6, 1),
        "acceptance_date": None, "due_date": date(2026, 7, 1),
        "subtotal": 100000, "total": 118000, "amount_paid": 0,
        "status": "unpaid", "vendor": "Shree Ganesh Suppliers",
        # A finding that names a vendor and gives no way to reach them
        # is the defect these handlers were changed to fix.
        "vendor_id": "55555555-5555-4555-8555-555555555555",
        "vendor_email": "ganesh@example.com",
        "vendor_phone": "+91 8200100001",
        "enterprise_class": "micro", "vendor_kind": "manufacturer",
        "payment_terms_days": None, "udyam_number": "UDYAM-MH-01-0000001",
        "is_msme": True,
    }
    row.update(kw)
    return row


def _msme_pool(bills=(), facts=None, bill_facts=None, statute=None):
    return _Pool(
        fetch_by={
            "statute_calendar": list(statute if statute is not None
                                     else SECTION_ROWS + WINDOW_ROWS),
            "FROM staging.ganit_vendor_bills b\n        JOIN": list(bills),
        },
        row_by={
            "FROM staging.ganit_vendors": facts or _vendor_facts(),
            "FROM staging.ganit_vendor_bills b\n        WHERE":
                bill_facts or _bill_facts(),
        },
    )


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(
        vc, "utc_now", lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


# ══════════════════════════════════════════════════════════════════════════
# the shape the dispatcher demands
# ══════════════════════════════════════════════════════════════════════════

HANDLERS = (check_msme_payment_clock, check_tds_thresholds, check_einvoice_window)


@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
def test_every_parameter_after_org_id_has_a_default(fn):
    """A required parameter cannot be scheduled, and the unattended-run test
    fails the whole build for it. A period, a year and a horizon all have an
    answer a machine can work out at 6am."""
    params = list(inspect.signature(fn).parameters.values())
    assert [p.name for p in params[:2]] == ["pool", "org_id"]
    missing = [p.name for p in params[2:] if p.default is inspect.Parameter.empty]
    assert not missing, f"{fn.__name__} cannot be scheduled: {missing}"


@pytest.mark.asyncio
@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
async def test_the_output_survives_json_and_carries_the_two_required_keys(fn, frozen):
    out = await fn(_msme_pool(), ORG)
    json.dumps(out, default=str)
    assert isinstance(out["counts"], dict)
    assert out["limitations"] and all(isinstance(s, str) for s in out["limitations"])


@pytest.mark.asyncio
@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
async def test_no_uuid_is_rendered_as_a_name(fn, frozen):
    """Ids may be row handles. They may never be the thing a reader reads.

    Positional, not textual: every key that is NOT `*_id` is checked against the
    UUID shape, so a name field that starts carrying an id fails here even if
    nobody thought to add an assertion for that particular field.
    """
    out = await fn(_msme_pool(bills=[_bill()], facts=_vendor_facts(
        vendors_total=1, class_recorded=1, micro_or_small=1)), ORG)
    for bucket in ("past_the_window", "inside_the_window", "not_classified",
                   "unattributed", "crossed", "below_the_threshold",
                   "still_open", "closing", "final_day", "not_aged",
                   "window_closed_permanently", "section_recorded_but_no_threshold"):
        for row in out.get(bucket, []):
            for key, value in row.items():
                if key.endswith("_id"):
                    continue
                assert not UUID_RE.match(str(value)), \
                    f"{fn.__name__} renders a uuid as {key!r}"


# ══════════════════════════════════════════════════════════════════════════
# 49 · THE ONE THAT MATTERS — an empty column is not a clean result
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_an_empty_column_is_never_a_clean_result(frozen):
    """80 vendors, 95 open bills, not one enterprise class recorded.

    Zero findings here is not an answer, it is a check that never ran, and the
    output has to say which. `could_not_check` carries the DENOMINATOR so it
    cannot collapse into the finding count next to it.
    """
    out = await check_msme_payment_clock(
        _msme_pool(facts=_vendor_facts(vendors_total=80, vendors_active=80),
                   bill_facts=_bill_facts(open_bills=95, open_balance=4408192)),
        ORG)

    assert out["verdict"] == "could_not_check"
    assert out["counts"]["bills_past_the_window"] == 0
    assert out["counts"]["could_not_check"] == 80
    assert out["counts"]["vendors_total"] == 80
    assert out["counts"]["enterprise_class_recorded"] == 0
    assert out["counts"]["open_bills_total"] == 95

    joined = " ".join(out["limitations"]).lower()
    assert "0 of 80" in joined
    assert "not an org with no msme exposure" in joined
    # And it names the column and the screen that would have to write it.
    assert "ganit_vendors.enterprise_class" in joined
    assert "vendor screen" in joined


@pytest.mark.asyncio
async def test_no_findings_and_could_not_check_do_not_look_alike(frozen):
    """An org where the facts ARE recorded and nothing is wrong must produce a
    visibly different payload from an org where nothing was recorded at all."""
    recorded = await check_msme_payment_clock(
        _msme_pool(bills=[], facts=_vendor_facts(
            vendors_total=4, class_recorded=4, micro_or_small=2,
            medium_out_of_scope=2, kind_recorded=4),
            bill_facts=_bill_facts(open_bills=3, acceptance_recorded=3)),
        ORG)
    blind = await check_msme_payment_clock(
        _msme_pool(facts=_vendor_facts(vendors_total=4)), ORG)

    assert recorded["counts"]["could_not_check"] == 0
    assert blind["counts"]["could_not_check"] == 4
    assert recorded["counts"]["bills_past_the_window"] == \
           blind["counts"]["bills_past_the_window"] == 0
    assert recorded["counts"] != blind["counts"]


# ══════════════════════════════════════════════════════════════════════════
# 49 · the two exclusions, which are why the gate is not `is_msme`
# ══════════════════════════════════════════════════════════════════════════

def test_medium_is_not_a_covered_class():
    """A medium enterprise is Udyam-registered and `is_msme` is TRUE of it, and
    it is OUTSIDE the section. Testing the flag would sweep it in."""
    assert set(COVERED_CLASSES) == {"micro", "small"}
    assert "medium" not in COVERED_CLASSES


@pytest.mark.asyncio
async def test_the_sql_gate_excludes_medium_and_traders_and_not_nulls(frozen):
    """Read the query the handler actually sent, not a fixture that agreed with
    it. A mock pool hides bad SQL, so the predicate itself is asserted."""
    pool = _msme_pool(bills=[_bill()])
    await check_msme_payment_clock(pool, ORG)
    detail = next(s for s in pool.sql_seen
                  if "JOIN staging.ganit_vendors v" in s)

    assert "v.enterprise_class = ANY($3::text[])" in detail   # class, not is_msme
    assert "v.vendor_kind IS DISTINCT FROM $4::text" in detail  # NULL survives it
    assert "COALESCE(v.is_msme, TRUE)" in detail               # FALSE excludes only
    # And the tenant boundary and the org-carrying join are both present.
    assert "b.org_id = $1::uuid" in detail
    assert "v.org_id = b.org_id" in detail


@pytest.mark.asyncio
async def test_an_unrecorded_kind_is_not_a_trader(frozen):
    """NULL means nobody has said. Dropping those rows would hide exposure;
    listing them silently would assert a fact nobody recorded. So they are
    listed AND counted AND caveated."""
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(vendor_kind=None)],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1),
                   statute=SECTION_ROWS + WINDOW_ROWS),
        ORG)

    assert out["counts"]["kind_not_recorded"] == 1
    listed = out["past_the_window"] + out["inside_the_window"] + out["not_classified"]
    assert listed and listed[0]["vendor_kind"] == "(not recorded)"
    assert any("is not a trader" in s for s in out["limitations"])


def test_the_excluded_kind_is_trader_and_only_trader():
    assert EXCLUDED_KIND == "trader"


# ══════════════════════════════════════════════════════════════════════════
# 49 · the clock starts at acceptance
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_clock_starts_at_acceptance_not_the_bill_date(frozen):
    """Same bill, same window, one field different — and the verdict flips.

    Acceptance is on or after the bill date, so a clock started at the bill date
    runs out sooner and reports a breach that has not happened. Billed 1 July,
    accepted 10 August, 15-day leg, run on 20 August: 16 days from the bill date
    is a breach and 10 days from acceptance is not.
    """
    facts = _vendor_facts(vendors_total=1, class_recorded=1, micro_or_small=1,
                          kind_recorded=1)

    from_bill = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(bill_date=date(2026, 7, 1), acceptance_date=None)],
                   facts=facts), ORG)
    from_acceptance = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(bill_date=date(2026, 7, 1),
                                acceptance_date=date(2026, 8, 10))],
                   facts=facts,
                   bill_facts=_bill_facts(open_bills=1, acceptance_recorded=1)),
        ORG)

    assert from_bill["counts"]["bills_past_the_window"] == 1
    assert from_bill["past_the_window"][0]["clock_started_from"] == "bill_date (fallback)"
    assert from_bill["past_the_window"][0]["pay_by"] == date(2026, 7, 16)

    assert from_acceptance["counts"]["bills_past_the_window"] == 0
    assert from_acceptance["counts"]["bills_inside_the_window"] == 1
    assert from_acceptance["inside_the_window"][0]["clock_started_from"] == "acceptance_date"
    assert from_acceptance["inside_the_window"][0]["pay_by"] == date(2026, 8, 25)


@pytest.mark.asyncio
async def test_a_missing_acceptance_date_is_disclosed_as_erring_early(frozen):
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill()],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1)), ORG)
    joined = " ".join(out["limitations"]).lower()
    assert "no bill carries an acceptance date" in joined
    assert "errs early" in joined


# ══════════════════════════════════════════════════════════════════════════
# 49 · the 15-vs-45 split, and the section that moved
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_null_payment_terms_is_the_no_agreement_leg(frozen):
    """"NULL means no agreement recorded, i.e. the 15-day leg" — migration 175's
    own words. It must not become the 45-day leg by default."""
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(payment_terms_days=None,
                                bill_date=date(2026, 8, 12))],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1)), ORG)
    row = (out["past_the_window"] + out["inside_the_window"])[0]
    assert row["window_applied_days"] == 15
    assert row["leg"] == "no written agreement recorded"


@pytest.mark.asyncio
async def test_an_agreed_term_is_capped_at_the_statutory_ceiling(frozen):
    """A 90-day agreement does not buy 90 days. Billed 1 June, run 20 August:
    capped at 45 the deadline was 16 July and the bill is 35 days past it."""
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(payment_terms_days=90, bill_date=date(2026, 6, 1))],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1)), ORG)
    row = out["past_the_window"][0]
    assert row["agreed_terms_days"] == 90
    assert row["window_applied_days"] == 45
    assert row["pay_by"] == date(2026, 7, 16)
    assert row["days_past_the_window"] == 35


@pytest.mark.asyncio
async def test_an_agreed_term_alone_cannot_clear_a_bill(frozen):
    """The subtle false all-clear: with the agreed term present but the ceiling
    missing, a 90-day term would clear a 60-day-old bill using a real column.

    So the ceiling is REQUIRED, not optional, and its absence stops the clock
    for every bill rather than for the ones with no terms recorded.
    """
    only_short_leg = [r for r in WINDOW_ROWS
                      if r["obligation_key"] == vc.MSME_WINDOW_NO_AGREEMENT_KEY]
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(payment_terms_days=90, bill_date=date(2026, 6, 1))],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1),
                   statute=SECTION_ROWS + only_short_leg), ORG)

    assert out["clock_could_be_run"] is False
    assert out["counts"]["bills_inside_the_window"] == 0
    assert out["counts"]["bills_past_the_window"] == 0
    assert out["counts"]["bills_not_classified"] == 1
    assert out["statute_keys_missing"] == [vc.MSME_WINDOW_AGREED_MAX_KEY]


@pytest.mark.asyncio
async def test_no_window_in_the_calendar_means_no_breach_is_declared(frozen):
    """The live state on 2026-08-20: neither leg is seeded. The handler must age
    the bills and STOP — no deadline, no breach, no add-back figure."""
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(bill_date=date(2025, 1, 1))],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1),
                   statute=SECTION_ROWS), ORG)

    assert out["clock_could_be_run"] is False
    assert out["window_no_agreement_days"] is None
    assert out["window_agreed_ceiling_days"] is None
    assert out["statute_keys_missing"] == [
        vc.MSME_WINDOW_NO_AGREEMENT_KEY, vc.MSME_WINDOW_AGREED_MAX_KEY]

    assert out["counts"]["bills_past_the_window"] == 0
    assert out["counts"]["bills_not_classified"] == 1
    unclassified = out["not_classified"][0]
    assert unclassified["pay_by"] is None
    assert unclassified["days_past_the_window"] is None
    assert unclassified["age_in_days"] > 500          # ageing still works
    assert out["amount_at_risk"]["outstanding_including_tax"] == 0

    # Nothing anywhere may name a leg or a window, because naming one would be
    # naming a day-count no table supplied.
    assert unclassified["window_applied_days"] is None
    assert unclassified["leg"] is None
    # No LEG may be named either, because naming one names a day-count no table
    # supplied. (The missing-key names themselves contain the word "agreement",
    # which is why this asserts the leg phrase and not the bare word.)
    assert "no written agreement recorded" not in _body(out)
    assert "statutory ceiling" not in _body(out)
    assert out["limitations"][0].startswith("THE CLOCK WAS NOT RUN")


@pytest.mark.asyncio
async def test_the_section_number_has_a_date_on_it(frozen):
    """s.43B(h) of the Income-tax Act 1961 until 1 April 2026; s.37(2)(g) of the
    Income-tax Act 2025 from it. Both seeded, neither ever a literal."""
    before = await check_msme_payment_clock(
        _msme_pool(statute=SECTION_ROWS), ORG, as_at="2026-03-31")
    after = await check_msme_payment_clock(
        _msme_pool(statute=SECTION_ROWS), ORG, as_at="2026-04-01")

    assert before["section"] == "s.43B(h)"
    assert "43b(h)" in _body(before)
    assert "37(2)(g)" not in _body(before)

    assert after["section"] == "s.37(2)(g)"
    assert "37(2)(g)" in _body(after)
    assert "43b(h)" not in _body(after)


@pytest.mark.asyncio
async def test_no_recorded_section_prints_no_section(frozen):
    """The calendar is deliberately incomplete. An absent row is an answer."""
    out = await check_msme_payment_clock(_msme_pool(statute=[]), ORG)
    assert out["section"] is None
    assert "43b" not in _body(out)
    assert "37(2)" not in _body(out)
    assert any("records no msme.payment_disallowance" in s.lower()
               for s in out["limitations"])


@pytest.mark.asyncio
async def test_the_add_back_is_labelled_a_ceiling(frozen):
    """"A confident wrong number destroys trust in the whole shelf." The
    disallowance is of the deduction claimed, and this cannot see which bills
    were claimed as revenue expenditure — so both figures are ceilings."""
    out = await check_msme_payment_clock(
        _msme_pool(bills=[_bill(bill_date=date(2026, 1, 1))],
                   facts=_vendor_facts(vendors_total=1, class_recorded=1,
                                       micro_or_small=1)), ORG)
    risk = out["amount_at_risk"]
    assert risk["outstanding_including_tax"] == 118000.0
    assert risk["taxable_value_of_breached_bills"] == 100000.0
    assert "ceiling" in risk["basis"]
    assert any("ceilings" in s.lower() and "capitalised" in s.lower()
               for s in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 50 · section attribution, which is the whole difficulty
# ══════════════════════════════════════════════════════════════════════════

def _tds_pool(vendors=(), facts=None, expenses=None, statute=()):
    return _Pool(
        fetch_by={
            "statute_calendar": list(statute),
            "WITH billed AS": list(vendors),
        },
        row_by={
            "FROM staging.ganit_vendors\n        WHERE": facts or {
                "vendors_total": 0, "section_recorded": 0},
            "FROM staging.ganit_expenses": expenses or {
                "expenses_in_year": 0, "linked_to_a_vendor": 0,
                "tds_amount_recorded": 0, "tds_recorded_total": 0},
        },
    )


def _tds_vendor(**kw):
    row = {
        "id": "22222222-2222-4222-8222-222222222222",
        "name": "Ganga Printers", "tds_section": None,
        "vendor_email": "ganga@example.com", "vendor_phone": "+91 8200126234",
        "taxable": 250000, "gross": 295000, "documents": 4,
        "tds_deducted": 0, "tds_not_recorded": 4, "paid_in_year": 0,
    }
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_no_section_is_ever_inferred(frozen):
    """A vendor called "Printers" is not evidence of a contract section. An
    unattributed vendor is listed loudly and tested against NOTHING."""
    out = await check_tds_thresholds(
        _tds_pool(vendors=[_tds_vendor()],
                  facts={"vendors_total": 63, "section_recorded": 0}), ORG)

    assert out["verdict"] == "could_not_check"
    assert out["counts"]["crossed"] == 0
    assert out["counts"]["vendors_with_no_section"] == 1
    assert out["counts"]["could_not_check"] == 1
    assert out["unattributed"][0]["section"] is None
    assert "194" not in _body(out)

    joined = " ".join(out["limitations"]).lower()
    assert "0 of 63" in joined
    assert "unattributed is not below-the-threshold" in joined
    assert "ganit_vendors.tds_section" in joined


@pytest.mark.asyncio
async def test_a_recorded_section_with_no_threshold_gets_no_verdict(frozen):
    """The live state: no `tds.threshold.*` key exists for any section. A vendor
    with a section still gets a running total and NO verdict, and the key it
    asked for is named so the CTO can seed exactly that row."""
    out = await check_tds_thresholds(
        _tds_pool(vendors=[_tds_vendor(tds_section="194C")],
                  facts={"vendors_total": 1, "section_recorded": 1}), ORG)

    assert out["counts"]["section_recorded_but_no_threshold"] == 1
    assert out["counts"]["crossed"] == 0
    assert out["counts"]["below"] == 0
    row = out["section_recorded_but_no_threshold"][0]
    assert row["statute_key_asked_for"] == "tds.threshold.194c"
    assert "threshold" not in row
    assert out["statute_keys_missing"] == ["tds.threshold.194c"]
    assert any("carries no threshold" in s for s in out["limitations"])


@pytest.mark.asyncio
async def test_crossed_and_approaching_are_split_when_a_threshold_exists(frozen):
    """The day the key is seeded: 30,00,000 threshold, one vendor over it and
    one inside the last ten per cent."""
    threshold = _statute(obligation_key="tds.threshold.194c",
                         section_ref="s.194C", threshold_amount=3000000,
                         title="Threshold — payments to contractors",
                         effective_from=date(2016, 4, 1), effective_to=None)
    out = await check_tds_thresholds(
        _tds_pool(vendors=[
            _tds_vendor(tds_section="194C", taxable=3200000),
            _tds_vendor(id="33333333-3333-4333-8333-333333333333",
                        name="Metro IT Solutions", tds_section="s.194 C",
                        taxable=2800000),
            _tds_vendor(id="44444444-4444-4444-8444-444444444444",
                        name="Om Stationers", tds_section="194C", taxable=100000),
        ], facts={"vendors_total": 3, "section_recorded": 3},
            statute=[threshold]), ORG)

    assert out["verdict"] == "checked"
    assert out["counts"]["crossed"] == 1
    assert out["counts"]["within_the_last_10_percent"] == 1
    assert out["counts"]["below"] == 1
    assert out["counts"]["could_not_check"] == 0
    assert out["crossed"][0]["headroom"] == -200000.0
    # Two spellings of one section resolve to one key, not two missing ones.
    assert out["statute_keys_missing"] == []


def test_the_section_key_normalises_spelling():
    assert _section_key("194C") == _section_key("s.194C") == _section_key("194 c")
    assert _section_key("194C") == "tds.threshold.194c"


def test_the_near_threshold_band_is_the_last_ten_percent():
    assert NEAR_THRESHOLD_RATIO == 0.90


@pytest.mark.asyncio
async def test_paid_in_year_is_never_read_as_proof_of_non_payment(frozen):
    """`ganit_vendor_payments` holds ONE row in the entire database, so a
    `paid_in_year` of zero is an artefact of the schema, not a fact about the
    vendor. The caveat has to travel with the figure."""
    out = await check_tds_thresholds(
        _tds_pool(vendors=[_tds_vendor()],
                  facts={"vendors_total": 1, "section_recorded": 0}), ORG)
    assert out["unattributed"][0]["paid_in_year"] == 0
    assert any("near-empty by construction" in s.lower()
               and "was not paid" in s.lower() for s in out["limitations"])


@pytest.mark.asyncio
async def test_the_threshold_base_is_the_taxable_value(frozen):
    """Where GST is shown separately it does not enter the threshold. The gross
    figure is reported beside it and is explicitly not the tested one."""
    out = await check_tds_thresholds(
        _tds_pool(vendors=[_tds_vendor(taxable=250000, gross=295000)],
                  facts={"vendors_total": 1, "section_recorded": 0}), ORG)
    row = out["unattributed"][0]
    assert row["credited_taxable_value"] == 250000.0
    assert row["credited_including_tax"] == 295000.0
    assert any("not the figure a threshold is tested on" in s.lower()
               for s in out["limitations"])


@pytest.mark.asyncio
async def test_unlinked_expense_spend_is_reported_as_missing(frozen):
    """0 of 378 expenses carry a vendor_id, so a vendor's running total is a
    floor and the reader is told by how much it might be short."""
    out = await check_tds_thresholds(
        _tds_pool(facts={"vendors_total": 15, "section_recorded": 0},
                  expenses={"expenses_in_year": 39, "linked_to_a_vendor": 0,
                            "tds_amount_recorded": 0, "tds_recorded_total": 0}),
        ORG)
    assert out["counts"]["expenses_in_year"] == 39
    assert out["counts"]["expenses_linked_to_a_vendor"] == 0
    assert any("0 of 39 carry a vendor link" in s for s in out["limitations"])


@pytest.mark.asyncio
async def test_a_null_tds_amount_is_not_read_as_nothing_deducted(frozen):
    out = await check_tds_thresholds(
        _tds_pool(vendors=[_tds_vendor()],
                  facts={"vendors_total": 1, "section_recorded": 0}), ORG)
    assert out["unattributed"][0]["documents_with_no_tds_recorded"] == 4
    assert any("different from 0.00" in s for s in out["limitations"])


@pytest.mark.asyncio
async def test_the_threshold_is_resolved_as_of_the_year_end_not_today(frozen):
    """A section renumbered on 1 April must not be read off the run date. The
    obligation for FY 2025-26 arises at that year's end, so the lookup anchors
    on 31 March 2026 even though the run is in August 2026."""
    out = await check_tds_thresholds(
        _tds_pool(vendors=[_tds_vendor(tds_section="194C")],
                  facts={"vendors_total": 1, "section_recorded": 1}),
        ORG, financial_year="2025-26")
    assert out["thresholds_resolved_as_of"] == date(2026, 3, 31)
    assert out["as_at"] == TODAY


def test_the_financial_year_defaults_across_the_april_boundary():
    assert _fy_of(date(2026, 3, 31)) == "2025-26"
    assert _fy_of(date(2026, 4, 1)) == "2026-27"
    assert _fy_of(date(2026, 8, 20)) == "2026-27"


# ══════════════════════════════════════════════════════════════════════════
# 51 · applicability first, then the window
# ══════════════════════════════════════════════════════════════════════════

def _inv(**kw):
    row = {
        "id": "55555555-5555-4555-8555-555555555555",
        "invoice_number": "INV-2026-0101", "invoice_type": "tax_invoice",
        "invoice_date": date(2026, 7, 1), "total": 118000, "subtotal": 100000,
        "doc_status": "final", "is_export": False, "irn": None,
        "recipient_gstin": "27AAAAA0000A1Z5", "customer": "Shree Ganesh Traders",
    }
    row.update(kw)
    return row


def _einv_pool(invoices=(), years=(), counts=None, statute=EINVOICE_ROWS):
    return _Pool(
        fetch_by={
            "statute_calendar": list(statute),
            "SELECT (EXTRACT(YEAR FROM i.invoice_date)": list(years),
            "AND i.irn IS NULL": list(invoices),
        },
        row_by={
            "count(*) FILTER (WHERE i.irn IS NOT NULL)": counts or {
                "documents": 0, "with_irn": 0, "drafts": 0,
                "not_yet_dated": 0, "exports": 0, "no_recipient_gstin": 0},
        },
    )


def _year(fy_start, taxable, documents=10):
    return {"fy_start": fy_start, "taxable_value": taxable, "documents": documents}


@pytest.mark.asyncio
async def test_below_the_threshold_is_never_reported_as_not_applicable(frozen):
    """Aggregate turnover is a PAN-level figure this product cannot see, and the
    seeded rule says crossing it in ANY year from 2017-18 keeps you in. So below
    the visible floor is `not_established`, never `not_applicable`, and the
    documents are still listed."""
    out = await check_einvoice_window(
        _einv_pool(invoices=[_inv()], years=[_year(2026, 3010900)],
                   counts={"documents": 89, "with_irn": 0, "drafts": 5,
                           "not_yet_dated": 13, "exports": 0,
                           "no_recipient_gstin": 43}), ORG)

    assert out["applicability"] == "not_established"
    assert out["verdict"] == "could_not_check"
    assert "not_applicable" not in _text(out)
    assert out["turnover_is_a_floor"] is True
    # Listed rather than hidden, and every row flagged.
    assert out["counts"]["b2b_documents_examined"] == 1
    listed = out["not_aged"] + out["still_open"] + out["closing"]
    assert listed and all(r["conditional"] for r in listed)
    assert any("not the same as not applicable" in s.lower()
               for s in out["limitations"])


@pytest.mark.asyncio
async def test_over_the_threshold_is_safe_in_one_direction(frozen):
    """Over IS over: a floor that clears the bar settles applicability, and the
    caveat flips from "may not apply" to "certainly does"."""
    out = await check_einvoice_window(
        _einv_pool(invoices=[_inv()],
                   years=[_year(2025, 70438000), _year(2026, 33250122)],
                   counts={"documents": 692, "with_irn": 0, "drafts": 97,
                           "not_yet_dated": 0, "exports": 0,
                           "no_recipient_gstin": 144},
                   statute=EINVOICE_ROWS), ORG)

    assert out["applicability"] == "inside"
    assert out["highest_visible_turnover"] == 70438000.0
    assert out["threshold"] == 50000000.0
    assert not any(r["conditional"] for r in out["not_aged"])
    assert any("looks over certainly is" in s.lower() for s in out["limitations"])


@pytest.mark.asyncio
async def test_the_turnover_test_reads_every_year_not_only_the_current_one(frozen):
    """The seeded rule: "crossing it in ANY financial year from 2017-18 onwards
    — once you cross it you stay in, so a skill testing only the current year
    understates". The crossing here is in the EARLIER year."""
    out = await check_einvoice_window(
        _einv_pool(years=[_year(2025, 70438000), _year(2026, 1000)]), ORG)
    assert out["applicability"] == "inside"
    assert [y["financial_year"] for y in out["turnover_by_year"]] == \
           ["2025-26", "2026-27"]


@pytest.mark.asyncio
async def test_no_threshold_in_the_calendar_is_unknown_not_clear(frozen):
    out = await check_einvoice_window(
        _einv_pool(invoices=[_inv()], years=[_year(2026, 5)], statute=[]), ORG)
    assert out["applicability"] == "unknown"
    assert out["threshold"] is None
    assert "50000000" not in _body(out)
    assert any("could not be tested at all" in s.lower() for s in out["limitations"])


@pytest.mark.asyncio
async def test_the_first_alert_day_is_derived_from_the_window(frozen):
    """The folio corrects an earlier "day 28": the window is 30 days from the
    invoice date, so the alerts are day 23 and day 30. Neither number is typed
    here — 23 falls out of 30 minus the lead, so a differently seeded window
    moves both together."""
    out = await check_einvoice_window(
        _einv_pool(years=[_year(2025, 70438000)],
                   statute=EINVOICE_ROWS + EINVOICE_WINDOW), ORG)

    assert out["window_days"] == 30
    assert out["alert_lead_days"] == ALERT_LEAD_DAYS == 7
    assert out["first_alert_on_day"] == 23
    assert out["first_alert_on_day"] == out["window_days"] - out["alert_lead_days"]
    assert out["first_alert_on_day"] != 28


@pytest.mark.asyncio
async def test_the_three_bands_land_on_the_right_days(frozen):
    """Run on 20 August with a 30-day window: raised 28 July is day 23 and has
    seven days left; raised 21 July is day 30 and has none; raised 20 July is
    day 31 and the window has closed."""
    out = await check_einvoice_window(
        _einv_pool(
            invoices=[
                _inv(id="a1111111-1111-4111-8111-111111111111",
                     invoice_number="INV-CLOSING", invoice_date=date(2026, 7, 28)),
                _inv(id="b1111111-1111-4111-8111-111111111111",
                     invoice_number="INV-FINAL", invoice_date=date(2026, 7, 21)),
                _inv(id="c1111111-1111-4111-8111-111111111111",
                     invoice_number="INV-CLOSED", invoice_date=date(2026, 7, 20)),
                _inv(id="d1111111-1111-4111-8111-111111111111",
                     invoice_number="INV-FRESH", invoice_date=date(2026, 8, 18)),
            ],
            years=[_year(2025, 70438000)],
            statute=EINVOICE_ROWS + EINVOICE_WINDOW), ORG)

    assert out["clock_could_be_run"] is True
    assert [r["document"] for r in out["closing"]] == ["INV-CLOSING"]
    assert out["closing"][0]["age_in_days"] == 23
    assert out["closing"][0]["days_left"] == 7
    assert [r["document"] for r in out["final_day"]] == ["INV-FINAL"]
    assert out["final_day"][0]["age_in_days"] == 30
    assert out["final_day"][0]["days_left"] == 0
    assert [r["document"] for r in out["window_closed_permanently"]] == ["INV-CLOSED"]
    assert [r["document"] for r in out["still_open"]] == ["INV-FRESH"]
    assert out["counts"]["not_aged"] == 0


@pytest.mark.asyncio
async def test_no_window_in_the_calendar_ages_but_declares_nothing(frozen):
    """The live state: `gst.einvoice.reporting_window` does not exist. Nothing
    may be called closed, and 30 must not appear as a deadline."""
    out = await check_einvoice_window(
        _einv_pool(invoices=[_inv(invoice_date=date(2026, 1, 1))],
                   years=[_year(2025, 70438000)]), ORG)

    assert out["clock_could_be_run"] is False
    assert out["window_days"] is None
    assert out["first_alert_on_day"] is None
    assert out["statute_keys_missing"] == [vc.EINVOICE_WINDOW_KEY]
    assert out["counts"]["window_closed_permanently"] == 0
    assert out["counts"]["not_aged"] == 1
    row = out["not_aged"][0]
    assert row["report_by"] is None and row["days_left"] is None
    assert row["age_in_days"] > 200
    assert out["limitations"][0].startswith("THE CLOCK WAS NOT RUN")


@pytest.mark.asyncio
async def test_a_null_irn_is_called_unrecorded_and_not_unreported(frozen):
    """Nothing in this product writes `ganit_invoices.irn`. Calling a NULL a
    missed filing would accuse a firm that reports through the portal."""
    out = await check_einvoice_window(
        _einv_pool(invoices=[_inv()], years=[_year(2025, 70438000)],
                   counts={"documents": 692, "with_irn": 0, "drafts": 0,
                           "not_yet_dated": 0, "exports": 0,
                           "no_recipient_gstin": 0}), ORG)
    joined = " ".join(out["limitations"]).lower()
    assert "0 of 692 documents carry an irn" in joined
    assert "unrecorded, not unreported" in joined
    assert "ganit_invoices.irn" in joined


@pytest.mark.asyncio
async def test_documents_with_no_recipient_gstin_are_counted_not_cleared(frozen):
    """GSTIN is non-mandatory and blocks nothing, so a genuine B2B sale can have
    no GSTIN recorded. Those documents were not examined, and saying so is the
    difference between a denominator and a clean result."""
    out = await check_einvoice_window(
        _einv_pool(invoices=[], years=[_year(2025, 70438000)],
                   counts={"documents": 692, "with_irn": 0, "drafts": 97,
                           "not_yet_dated": 0, "exports": 0,
                           "no_recipient_gstin": 144}), ORG)
    assert out["counts"]["no_recipient_gstin_not_examined"] == 144
    assert out["counts"]["b2b_documents_examined"] == 0
    joined = " ".join(out["limitations"]).lower()
    assert "144 document(s) have neither and were not examined" in joined
    assert "blocks nothing" in joined


@pytest.mark.asyncio
async def test_drafts_and_future_documents_are_excluded_and_disclosed(frozen):
    out = await check_einvoice_window(
        _einv_pool(years=[_year(2026, 3010900)],
                   counts={"documents": 89, "with_irn": 0, "drafts": 5,
                           "not_yet_dated": 13, "exports": 0,
                           "no_recipient_gstin": 43}), ORG)
    assert out["counts"]["drafts_excluded"] == 5
    assert out["counts"]["future_dated_excluded"] == 13
    joined = " ".join(out["limitations"]).lower()
    assert "doc_status` defaults to 'final'" in joined
    assert "not yet raised" in joined


@pytest.mark.asyncio
async def test_the_sql_carries_the_org_on_both_customer_joins(frozen):
    """The FK is on the id alone, and an id-only join has been proved live to
    print another practice's customer name. A mock pool would never catch it, so
    the query text itself is asserted."""
    pool = _einv_pool(years=[_year(2025, 70438000)])
    await check_einvoice_window(pool, ORG)
    detail = next(s for s in pool.sql_seen if "AND i.irn IS NULL" in s)

    assert "cl.id = i.client_id AND cl.org_id = i.org_id" in detail
    assert "ct.id = i.contact_id AND ct.org_id = i.org_id" in detail
    assert "i.org_id = $1::uuid" in detail
    assert detail.count("org_id = i.org_id") == 2


# ══════════════════════════════════════════════════════════════════════════
# caps, and the honesty about them
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_capped_list_says_it_was_capped(frozen):
    """Live, `check_einvoice_window` against E2E Test returns 200 of 548 B2B
    documents. A truncated list that does not say so is a wrong count."""
    out = await check_einvoice_window(
        _einv_pool(invoices=[_inv(id=f"{i:08d}-1111-4111-8111-111111111111",
                                  invoice_number=f"INV-{i:04d}")
                             for i in range(3)],
                   years=[_year(2025, 70438000)]), ORG, limit=3)
    assert out["counts"]["capped_at"] == 3
    assert out["counts"]["was_capped"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("fn", HANDLERS, ids=lambda f: f.__name__)
async def test_a_zero_limit_does_not_become_an_empty_query(fn, frozen):
    """`LIMIT 0` would return nothing and read as no findings."""
    out = await fn(_msme_pool(), ORG, limit=0)
    assert out["counts"]["capped_at"] >= 1
