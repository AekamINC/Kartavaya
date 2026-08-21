"""
The three GST cliffs, and the four sentences they are not allowed to get wrong.

`gst_cliffs` holds three handlers that a CA acts on. Most of what follows is not
about arithmetic — the arithmetic is a sum of four columns. It is about the
wording, the denominators and the dates, because each of those has a way of
being wrong that costs a firm money without ever looking wrong:

  · `brief_ims_expectations` must never claim to have RECONCILED anything. It
    has seen one side of the month — the org's own books — and a report that
    says "matched" when it has never touched the portal teaches a preparer to
    trust a comparison that did not happen.

  · `brief_itc_at_risk_of_lapse` must never promise 30 November. The bar is the
    EARLIER of 30 November and the date the annual return went in, this product
    records no GSTR-9 filing date, and a firm that filed GSTR-9 in October shut
    its own window in October. And the figure is credit AT RISK, not credit
    LOST: nothing records whether the credit was availed.

  · `check_dead_gst_slabs` must judge a document line against the rates in force
    ON THE DOCUMENT'S OWN DATE. The 12% slab existed for eight years, so an
    invoice dated May 2025 at 12% is correct history and flagging it would send
    somebody to re-issue years of correct invoices. The product MASTER is judged
    as at today instead, because a price list has no date.

  · And when the master and the line disagree, the report must name WHICH SIDE
    is stale. On the live seeded org 205 of 207 mismatches are an 18% line
    against a master still on the abolished 12% — the line is right — and the
    obvious phrasing ("this invoice disagrees with the master") would have two
    hundred correct invoices re-issued at a rate that no longer exists in law.

Every denominator on all three outputs is defended too. A skill that truncates
must say so, and a covered fraction that reads as the whole is the single most
damaging thing a compliance report can do — so the headline figures come from an
UNCAPPED aggregate while only the listings are capped, and the tests below prove
the two are separate queries rather than the same rows counted twice.

Live figures at the time of writing, read-only against the seeded org
(64e7bea6…) on 2026-08-20:

    brief_ims_expectations  2026-07  →  9 bills, 19,883.52 tax, 0 without GSTIN
                            2026-08  →  22 bills, 49,638.96 tax, 16 without a
                                        vendor GSTIN carrying 23,040.00 of tax
    brief_itc_at_risk_of_lapse 2025-26 → 108 bills, 40 vendors, 913,343.04 at
                                        risk, bar 2026-11-30, 102 days left
    check_dead_gst_slabs     → 12 products on the abolished 12%, 0 document
                               lines on a dead slab, 207 mismatches of which
                               205 are the master being the stale side
"""
import inspect
import json
from datetime import date

import pytest

from services.skills.data.gst_cliffs import (
    _last_ended_financial_year,
    _period_bounds,
    brief_ims_expectations,
    brief_itc_at_risk_of_lapse,
    check_dead_gst_slabs,
)
from services.skills.timeutil import return_period
from services.statute import _COLS

# A fixture value, and deliberately NOT the seeded org's id even in part. The
# pool below is a fake, so this is only ever a value to assert on — but an id
# that LOOKS like the real one gets copied into a live probe, and the probe then
# returns nothing and reads as a regression.
ORG = "00000000-0000-4000-8000-000000000002"

_ABOLISHED = date(2025, 9, 22)   # the day 12% and 28% stopped existing


# ── fixtures ─────────────────────────────────────────────────────────────────

def _statute(key, **kw):
    """One `staging.statute_calendar` row, every column present.

    Every column is filled because `services/statute.py` selects the full `_COLS`
    tuple and its callers reach for whichever they need; a fixture that carried
    only the interesting three would KeyError somewhere far from the test that
    wrote it, and would do so only when a handler started reading a new column.
    """
    row = {c: None for c in _COLS}
    row.update({
        "obligation_key": key,
        "effective_from": date(2017, 7, 1),
        "effective_to": None,
        "state_code": None,
    })
    row.update(kw)
    return row


#: The real catalogue, as it stands live. 12% and 28% end on 22 September 2025;
#: 40% begins the same day. One date, written once, so there is no off-by-one to
#: argue about — `statute.py` treats `effective_to` as half-open.
CATALOGUE = [
    _statute("gst.rate.nil", rate_percent=0),
    _statute("gst.rate.5", rate_percent=5),
    _statute("gst.rate.12", rate_percent=12, effective_to=_ABOLISHED),
    _statute("gst.rate.18", rate_percent=18),
    _statute("gst.rate.28", rate_percent=28, effective_to=_ABOLISHED),
    _statute("gst.rate.40", rate_percent=40, effective_from=_ABOLISHED),
    _statute(
        "gst.itc.time_limit",
        effective_from=date(2022, 10, 1),
        due_day=30, due_month=11, periodicity="annual",
        section_ref="s.16(4)", source_ref="CGST Act 2017, s.16(4)",
    ),
]


def _without_links(node):
    """The payload minus every `link` value.

    The uuid ban was written to stop an id being SHOWN. A `link` is followed,
    not read, and the owner asked for exactly that: "give link to each data so
    when user click it takes to data". So the ban stands everywhere except the
    one field whose whole job is to be a destination -- and the scan below is
    run over the payload with those values removed, so an id that escapes into
    a name, a label or a detail still fails.
    """
    if isinstance(node, dict):
        return {k: _without_links(v) for k, v in node.items() if k != "link"}
    if isinstance(node, list):
        return [_without_links(v) for v in node]
    return node


def _bill(**kw):
    """One row in the shape both vendor-bill queries return."""
    row = {
        "vendor_name": "National Paper House Pvt Ltd",
        "vendor_gstin": "27BBPPV2015X1ZP",
        # A finding that names a vendor and gives no way to reach them
        # is the defect these handlers were changed to fix.
        "vendor_id": "44444444-4444-4444-4444-444444444444",
        "vendor_email": "vendor15@example.com",
        "vendor_phone": "+91 8200105195",
        "bill_number": "VB-0143",
        "internal_ref": "REF-0143",
        "bill_date": date(2026, 7, 8),
        "taxable_value": 28132.0,
        "cgst": 2531.88, "sgst": 2531.88, "igst": 0.0, "cess": 0.0,
        "total": 33195.76,
        "amount_paid": 0.0,
        "is_reverse_charge": False,
        "currency": "INR",
        "status": "unpaid",
    }
    row.update(kw)
    # Derived here because it is derived in the query too. A fixture that let a
    # test hand-set `tax_value` inconsistently with the four heads would pass
    # while the real SQL disagreed with it.
    row["tax_value"] = round(sum(row[h] for h in ("cgst", "sgst", "igst", "cess")), 2)
    return row


def _summary(**kw):
    """The uncapped aggregate row. Defaults describe an empty, clean month."""
    row = {
        "bills": 0, "vendors": 0, "taxable_value": 0.0, "tax_value": 0.0,
        "bills_without_gstin": 0, "tax_without_gstin": 0.0,
        "bills_with_no_tax": 0, "reverse_charge_bills": 0, "non_inr_bills": 0,
        "bills_without_vendor_gstin": 0,
    }
    row.update(kw)
    return row


class _Pool:
    """A fake pool that routes on the SQL it is handed, and records every call.

    Routed on SQL text rather than on call order, deliberately. Call-order
    fakes pass whatever the handler does — reorder two queries and the fixture
    silently feeds bills to the product scan — whereas this one fails loudly the
    moment a query it does not recognise arrives.
    """

    def __init__(self, *, catalogue=None, bills=None, summary=None,
                 products=None, product_total=0, dead_lines=None,
                 mismatches=None, coverage=None):
        self.catalogue = CATALOGUE if catalogue is None else catalogue
        self.bills = bills or []
        self.summary = summary or _summary()
        self.products = products or []
        self.product_total = product_total
        self.dead_lines = dead_lines or []
        self.mismatches = mismatches or []
        self.coverage = coverage or {"n_lines": 0, "n_compared": 0}
        self.sql_seen: list[str] = []
        self.args_seen: list[tuple] = []

    # -- routing -------------------------------------------------------------

    def _statute_rows(self, sql, args):
        if "obligation_key = $1::text" in sql:
            key, state = args[0], args[1]
            return [r for r in self.catalogue
                    if r["obligation_key"] == key
                    and (r["state_code"] is None or r["state_code"] == state)]
        prefix = args[1]
        return [r for r in self.catalogue
                if prefix is None or r["obligation_key"].startswith(prefix)]

    async def fetch(self, sql, *args):
        self.sql_seen.append(sql)
        self.args_seen.append(args)
        if "statute_calendar" in sql:
            return self._statute_rows(sql, args)
        if "all_lines" in sql:
            return self.dead_lines
        if "master AS" in sql:
            rows = []
            for m in self.mismatches:
                row = dict(m)
                row["n_mismatches"] = self.coverage.get(
                    "n_mismatches", len(self.mismatches))
                row["n_lines"] = self.coverage["n_lines"]
                row["n_compared"] = self.coverage["n_compared"]
                rows.append(row)
            return rows
        if "ganit_products" in sql:
            return self.products
        if "ganit_vendor_bills" in sql:
            return self.bills
        raise AssertionError(f"unrouted fetch:\n{sql}")

    async def fetchrow(self, sql, *args):
        self.sql_seen.append(sql)
        self.args_seen.append(args)
        if "master AS" in sql:
            return dict(self.coverage)
        if "ganit_vendor_bills" in sql:
            return dict(self.summary)
        raise AssertionError(f"unrouted fetchrow:\n{sql}")

    async def fetchval(self, sql, *args):
        self.sql_seen.append(sql)
        self.args_seen.append(args)
        if "ganit_products" in sql:
            return self.product_total
        raise AssertionError(f"unrouted fetchval:\n{sql}")


def _text(out) -> str:
    """Every string the caller could possibly show a reader, flattened."""
    return json.dumps(out, default=str).lower()


# ── the dispatcher will refuse a handler that needs a subject ────────────────

@pytest.mark.parametrize("handler", [
    brief_ims_expectations, brief_itc_at_risk_of_lapse, check_dead_gst_slabs,
])
def test_every_handler_runs_from_the_org_and_the_calendar_alone(handler):
    """A parameter with no default means the skill can never be scheduled.

    `services/skill_dispatcher.py` refuses to call a handler declaring a
    parameter with no default that nobody supplied, so a signature — not a
    template, not a registry line — silently decides whether a skill can run
    unattended. This asserts the same rule as
    `tests/test_a_skill_can_run_unattended.py`, but directly against the
    signature, so it holds before these three reach `SKILL_REGISTRY` as well as
    after.
    """
    required = [
        name for name, p in inspect.signature(handler).parameters.items()
        if name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
        and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
    ]
    assert not required, (
        f"{handler.__name__} requires {required}, which a schedule has no way "
        f"to supply — the dispatcher will refuse every run."
    )


@pytest.mark.asyncio
async def test_the_ims_brief_defaults_to_the_period_being_filed():
    """The PREVIOUS month, not the current one. August's 3B is due 20 September."""
    pool = _Pool()
    out = await brief_ims_expectations(pool, ORG)
    assert out["period"] == return_period()


def test_the_lapse_brief_defaults_to_the_year_whose_deadline_is_live():
    """The most recently ENDED financial year, never the running one.

    s.16(4) bars a year's credit on 30 November FOLLOWING that year, so the year
    with a live deadline in August 2026 is 2025-26 and its bar is 30 November
    2026. Defaulting to the running year would report a deadline fifteen months
    out and read to a preparer as "nothing to do here".

    The 31 March / 1 April pair is the whole test: an Indian FY turns over on 1
    April, and a `>= 4` written as `> 4` moves every answer by a year for one
    month of every year.
    """
    assert _last_ended_financial_year(date(2026, 8, 20)) == "2025-26"
    assert _last_ended_financial_year(date(2026, 3, 31)) == "2024-25"
    assert _last_ended_financial_year(date(2026, 4, 1)) == "2025-26"
    assert _last_ended_financial_year(date(2027, 1, 1)) == "2025-26"


# ── 1 · the IMS brief ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_ims_brief_never_claims_to_have_reconciled_anything():
    """The sentence that would teach a preparer to trust a comparison that
    never happened.

    This handler has seen the org's own books and nothing else. There is no GSTN
    connection in this product. If the output ever says matched, reconciled,
    accepted, rejected or pending, a reader will believe the portal has been
    consulted — and will stop checking the one thing this skill exists to make
    them check.
    """
    pool = _Pool(bills=[_bill()], summary=_summary(bills=1, tax_value=5063.76))
    text = _text(await brief_ims_expectations(pool, ORG))

    for banned in ("reconciled", "reconciliation with", "matched against the portal",
                   "accepted on ims", "rejected on ims"):
        assert banned not in text or "not an ims reconciliation" in text

    # And the disclaimer must be present as DATA, not merely absent as a claim.
    # A language model handed this dict will reproduce the fields; it cannot
    # reproduce a docstring it never sees.
    out = await brief_ims_expectations(pool, ORG)
    assert "NOT an IMS reconciliation" in out["what_this_is_not"]
    assert "no GSTN connection" in out["what_this_is_not"]


@pytest.mark.asyncio
async def test_the_ims_brief_splits_on_the_vendor_gstin_and_totals_the_unclaimable():
    """Two lists, and a running total that travels on each row.

    A bill from a vendor with no GSTIN will never appear on IMS — an
    unregistered supplier files no GSTR-1 — so its tax is not claimable. The
    running total is on the ROW rather than only in a footer because this list
    is read top-down and abandoned partway, and a reader who stops at the second
    row should still see what those two cost.
    """
    out = await brief_ims_expectations(
        pool := _Pool(
            bills=[
                _bill(bill_number="VB-1", vendor_gstin="27BBPPV2015X1ZP", igst=1800.0,
                      cgst=0.0, sgst=0.0),
                _bill(bill_number="VB-2", vendor_gstin=None, igst=1440.0,
                      cgst=0.0, sgst=0.0, vendor_name="E2E Vendor 0cg83"),
                _bill(bill_number="VB-3", vendor_gstin="   ", igst=900.0,
                      cgst=0.0, sgst=0.0, vendor_name="E2E Vendor 0wvrp"),
            ],
            summary=_summary(bills=3, tax_value=4140.0,
                             bills_without_gstin=2, tax_without_gstin=2340.0),
        ),
        ORG,
    )
    assert pool  # the fake was actually used

    assert [b["bill"] for b in out["with_vendor_gstin"]] == ["VB-1"]
    without = out["without_vendor_gstin"]
    assert [b["bill"] for b in without] == ["VB-2", "VB-3"]
    # A GSTIN of three spaces is no GSTIN. `NULLIF(btrim(...), '')` does that in
    # SQL; the fixture proves the Python side agrees rather than treating the
    # whitespace string as truthy.
    assert without[1]["vendor_gstin"] is None

    assert without[0]["running_tax_that_cannot_be_claimed"] == 1440.0
    assert without[1]["running_tax_that_cannot_be_claimed"] == 2340.0
    assert out["totals"]["tax_that_cannot_be_claimed"] == 2340.0
    assert "not claimable as input credit" in " ".join(out["caveats"])


@pytest.mark.asyncio
async def test_a_missing_gstin_is_reported_and_never_treated_as_a_defect():
    """GSTIN, PAN and TAN are non-mandatory and block nothing. This has drifted
    back into the product more than once.

    The absence is worth a number — that tax genuinely cannot be claimed — but
    the output must offer the innocent reading alongside it, because a blank
    GSTIN is as likely to be a vendor record nobody finished as an unregistered
    supplier, and this handler cannot tell which.
    """
    out = await brief_ims_expectations(
        _Pool(bills=[_bill(vendor_gstin=None)],
              summary=_summary(bills=1, tax_value=5063.76,
                               bills_without_gstin=1, tax_without_gstin=5063.76)),
        ORG,
    )
    joined = " ".join(out["caveats"])
    assert "blocks nothing" in joined
    assert "never completed" in joined
    assert "report, not a refusal" in joined
    text = _text(out)
    for banned in ("invalid gstin", "must be fixed", "blocked", "cannot be filed"):
        assert banned not in text


@pytest.mark.asyncio
async def test_the_ims_headline_is_the_whole_month_even_when_the_list_is_cut():
    """The covered-fraction failure, which is the one this file exists against.

    The totals come from an UNCAPPED aggregate and the listings from a capped
    query. If they were the same rows, an org with 300 bills would be handed a
    headline covering 200 with nothing on the page saying which 200 — a number
    that reads as the whole month and is not. Here the fake returns two rows
    against a summary of 300, and the handler must report 300, say 2 of 300, and
    say WHICH figures are complete.
    """
    out = await brief_ims_expectations(
        _Pool(bills=[_bill(bill_number="VB-1"), _bill(bill_number="VB-2")],
              summary=_summary(bills=300, tax_value=999999.0, taxable_value=5555555.0)),
        ORG,
    )
    assert out["totals"]["bills"] == 300
    assert out["totals"]["listed"] == 2
    assert out["totals"]["tax_value"] == 999999.0

    caveat = next(c for c in out["caveats"] if c.startswith("TRUNCATED"))
    assert "2 of 300" in caveat
    assert "cover the WHOLE period and are complete" in caveat


@pytest.mark.asyncio
async def test_an_empty_month_says_so_rather_than_returning_silence():
    """A nil answer is a finding. Silence is indistinguishable from a skipped run."""
    out = await brief_ims_expectations(_Pool(), ORG, period="2026-07")
    assert out["totals"]["bills"] == 0
    joined = " ".join(out["caveats"])
    assert "No vendor bill is recorded for 2026-07" in joined
    assert "finding, not a skipped check" in joined
    # And the useful half: an IMS dashboard that is NOT empty is then all news.
    assert "missing from your books" in joined


@pytest.mark.asyncio
async def test_month_zero_is_refused_rather_than_answered_with_january():
    """`date(y, 0 + 1, 1)` is a valid 1 January, so '2026-00' used to sail through.

    Month 13 already raised. Only the zero slipped, and a zero is exactly what a
    caller building the string from an off-by-one month index produces — so the
    report would have come back full of January's bills under a period string
    that does not exist.
    """
    for bad in ("2026-00", "2026-13", "2026", "not-a-period", "2026-0x"):
        out = await brief_ims_expectations(_Pool(), ORG, period=bad)
        assert "error" in out, f"{bad!r} was accepted"

    # None and '' are NOT bad input — they are the absence of input, and the
    # absence of input is the whole reason this handler has a default. An earlier
    # draft of this test demanded an error for both, which would have meant
    # refusing every scheduled run: the dispatcher passes nothing, `period or
    # return_period()` supplies the month being filed, and that is correct.
    for absent in (None, ""):
        out = await brief_ims_expectations(_Pool(), ORG, period=absent)
        assert out.get("period") == return_period(), f"{absent!r} lost the default"

    with pytest.raises(ValueError):
        _period_bounds("2026-00")
    # Half-open, and December must roll the year rather than raising.
    assert _period_bounds("2026-12") == (date(2026, 12, 1), date(2027, 1, 1))


@pytest.mark.asyncio
async def test_the_ims_brief_scopes_the_vendor_join_to_the_same_org():
    """`c.org_id = x.org_id` on every graha/vendor join, without exception.

    The FK is on id alone, so a join on id can surface another practice's vendor
    row — and the vendor's GSTIN is the exact field this handler splits on, so a
    cross-tenant read here does not merely leak a name, it moves a bill into the
    wrong half of the report.
    """
    pool = _Pool(bills=[_bill()], summary=_summary(bills=1))
    await brief_ims_expectations(pool, ORG)

    joins = [s for s in pool.sql_seen if "ganit_vendors" in s]
    assert joins, "no vendor join was issued at all"
    for sql in joins:
        assert "v.org_id = b.org_id" in sql
        assert "staging.ganit_vendor_bills" in sql   # schema-qualified, always
    for args in pool.args_seen:
        if args:
            assert args[0] == ORG


# ── 2 · the credit that lapses ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_lapse_brief_says_at_risk_and_never_says_lost():
    """The first honesty requirement, on the face of the output.

    Nothing in this product records whether ITC was availed. Every figure is tax
    CHARGED. For a firm filing monthly 3Bs most of that credit was taken months
    ago and there is nothing here to lose, so the figure overstates — and a
    number that cannot be tied out and does not say so poisons every other skill
    in the catalogue, not just this one.
    """
    out = await brief_itc_at_risk_of_lapse(
        _Pool(bills=[_bill()], summary=_summary(bills=1, vendors=1, tax_value=5063.76)),
        ORG, financial_year="2025-26",
    )
    headline = out["what_this_figure_is"]
    assert "AT RISK OF LAPSE" in headline
    assert "NOT credit that has been lost" in headline
    assert "no ITC-availed flag" in headline
    assert "overstates" in headline

    # The direction of the error is stated in the limitations too, because the
    # headline is one field and a summariser may drop it.
    assert any("tax charged, not credit outstanding" in lim
               for lim in out["limitations"])


@pytest.mark.asyncio
async def test_the_lapse_brief_never_promises_november_to_a_firm_that_filed_in_october():
    """The second honesty requirement, and the expensive one.

    s.16(4) bars ITC after the EARLIER of 30 November and the date the annual
    return was actually filed. This product has no filing table at all — verified
    against the live schema on 2026-08-20 — so it cannot apply the earlier of the
    two. A firm that filed GSTR-9 in October has already shut its own window, and
    a report that hands it "you have until 30 November" is handing it time it
    does not have.
    """
    out = await brief_itc_at_risk_of_lapse(
        _Pool(bills=[_bill()], summary=_summary(bills=1, tax_value=5063.76)),
        ORG, financial_year="2025-26",
    )
    warning = out["the_deadline_may_already_have_passed"]
    assert "EARLIER of" in warning
    assert "annual return" in warning
    assert "October" in warning
    assert "records no GSTR-9 filing date" in warning
    assert out["deadline"]["is_the_outer_limit_only"] is True
    assert any("OUTER limit only" in lim for lim in out["limitations"])


@pytest.mark.asyncio
async def test_the_deadline_is_read_from_the_catalogue_and_not_written_into_the_code():
    """Change the catalogue row, and the reported date must change with it.

    A hardcoded 30 November would pass every other test in this file. This is the
    only one that can tell the difference: the fixture moves the bar to 15
    October and the handler must follow it, because a statutory fact is never a
    constant — form 24Q became 138 on one day and the 12% slab died on another.
    """
    moved = [r for r in CATALOGUE if r["obligation_key"] != "gst.itc.time_limit"]
    moved.append(_statute("gst.itc.time_limit", effective_from=date(2022, 10, 1),
                          due_day=15, due_month=10, section_ref="s.16(4)"))
    out = await brief_itc_at_risk_of_lapse(
        _Pool(catalogue=moved, summary=_summary(bills=0)),
        ORG, financial_year="2025-26",
    )
    assert out["deadline"]["date"] == "2026-10-15"

    # "30 November FOLLOWING the financial year": FY 2025-26 ends 31 March 2026,
    # so the bar is in 2026. Built off the START of the window it would land in
    # 2025 — a full year early, every year, and unnoticeably so in a year where
    # nobody checks.
    normal = await brief_itc_at_risk_of_lapse(
        _Pool(summary=_summary()), ORG, financial_year="2025-26")
    assert normal["deadline"]["date"] == "2026-11-30"
    assert normal["window"] == {"from": "2025-04-01", "to": "2026-03-31"}


@pytest.mark.asyncio
async def test_a_catalogue_with_no_bar_reports_no_date_rather_than_guessing_one():
    """Missing reference data must not become an invented statutory deadline.

    The rule still applies and is still stated; the DATE is withheld, because a
    date this system did not read is a date nobody should act on.
    """
    out = await brief_itc_at_risk_of_lapse(
        _Pool(catalogue=[r for r in CATALOGUE
                         if r["obligation_key"] != "gst.itc.time_limit"],
              summary=_summary(bills=1, tax_value=100.0)),
        ORG, financial_year="2025-26",
    )
    assert out["deadline"] is None
    assert "No date is stated" in out["the_deadline_may_already_have_passed"]
    assert "s.16(4) bars the credit" in out["the_deadline_may_already_have_passed"]
    assert any("gap in the reference data" in c for c in out["caveats"])


@pytest.mark.asyncio
async def test_a_bar_already_passed_is_reported_as_lost_time_not_as_work():
    """FY 2024-25's bar fell on 30 November 2025 and is gone.

    Reporting it as a deadline with a negative number of days left, and nothing
    else, would have somebody chase credit that is already time-barred.
    """
    out = await brief_itc_at_risk_of_lapse(
        _Pool(summary=_summary(bills=0)), ORG, financial_year="2024-25")
    assert out["deadline"]["date"] == "2025-11-30"
    assert out["deadline"]["has_passed"] is True
    assert out["deadline"]["days_remaining"] < 0
    assert any("time-barred" in c for c in out["caveats"])
    assert any("record of what was lost, not a list of work" in c
               for c in out["caveats"])


@pytest.mark.asyncio
async def test_the_lapse_headline_is_the_whole_year_even_when_the_list_is_cut():
    """Same covered-fraction rule as the IMS brief, on the number that matters."""
    out = await brief_itc_at_risk_of_lapse(
        _Pool(bills=[_bill(bill_number="VB-1")],
              summary=_summary(bills=108, vendors=40, tax_value=913343.04)),
        ORG, financial_year="2025-26",
    )
    assert out["totals"]["tax_at_risk"] == 913343.04
    assert out["totals"]["bills"] == 108
    assert out["totals"]["listed"] == 1
    caveat = next(c for c in out["caveats"] if c.startswith("TRUNCATED"))
    assert "1 of 108" in caveat
    assert "covers the WHOLE year and is complete" in caveat

    # Rupees at the top is the brief for this skill, so the exposure is the FIRST
    # key of the totals block — the one a reader who reads one number reads.
    assert next(iter(out["totals"])) == "tax_at_risk"


@pytest.mark.asyncio
async def test_a_reverse_charge_bill_from_a_vendor_with_no_gstin_keeps_both_notes():
    """Two conditions, two notes. The first cut overwrote `entry["note"]`.

    A reverse-charge bill from a vendor with no GSTIN met both conditions, and
    the second assignment silently dropped the reverse-charge half — the more
    important half, because the s.16(4) clock for RCM credit runs from a
    self-invoice this product does not record at all.
    """
    out = await brief_itc_at_risk_of_lapse(
        _Pool(bills=[_bill(is_reverse_charge=True, vendor_gstin=None)],
              summary=_summary(bills=1, tax_value=5063.76,
                               reverse_charge_bills=1, bills_without_vendor_gstin=1)),
        ORG, financial_year="2025-26",
    )
    notes = " ".join(out["bills"][0]["notes"])
    assert "self-invoice" in notes
    assert "unregistered" in notes
    assert out["bills"][0]["reverse_charge"] is True
    # Counted, not silently excluded — a row that vanishes is worse than a row
    # that is wrong out loud.
    assert any("ARE counted" in c for c in out["caveats"])


@pytest.mark.asyncio
async def test_a_year_with_no_tax_says_so_rather_than_returning_an_empty_list():
    out = await brief_itc_at_risk_of_lapse(
        _Pool(summary=_summary(bills=4, bills_with_no_tax=4)),
        ORG, financial_year="2025-26",
    )
    joined = " ".join(out["caveats"])
    assert "carry no GST on record and are not listed" in joined
    assert "Nothing is at risk of lapsing" in joined
    assert "finding, not a skipped check" in joined


@pytest.mark.asyncio
async def test_an_unparseable_financial_year_is_refused():
    for bad in ("2025", "2025-27", "twenty-five", "2025/26/27"):
        out = await brief_itc_at_risk_of_lapse(_Pool(), ORG, financial_year=bad)
        assert "error" in out, f"{bad!r} was accepted"
    # '2025/26' IS a legitimate spelling — `fy_bounds` accepts either separator —
    # and refusing it would be a false rejection dressed as validation.
    ok = await brief_itc_at_risk_of_lapse(_Pool(), ORG, financial_year="2025/26")
    assert "error" not in ok


# ── 3 · dead slabs ───────────────────────────────────────────────────────────

def _line(**kw):
    row = {
        "source": "invoice line",
        "document": "INV-2026-0085",
        "document_date": date(2026, 8, 4),
        "doc_status": "final",
        "description": "Printed Statutory Registers",
        "rate": 12,
        "hsn_code": "48201090",
    }
    row.update(kw)
    return row


def _product(**kw):
    row = {"name": "A4 Copier Paper (Ream)", "gst_rate": 12,
           "hsn_code": "4802", "sac_code": None, "is_active": True}
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_the_live_slabs_come_from_the_catalogue_not_from_this_code():
    """0 / 5 / 18 / 40 today; 12 and 28 died on 22 September 2025.

    And asked as of a date BEFORE that day, 12 and 28 must come back alive —
    which is what proves the set is resolved rather than written down.
    """
    now = await check_dead_gst_slabs(_Pool(), ORG, as_at="2026-08-20")
    assert now["live_slabs"] == [0.0, 5.0, 18.0, 40.0]

    before = await check_dead_gst_slabs(_Pool(), ORG, as_at="2025-09-21")
    assert before["live_slabs"] == [0.0, 5.0, 12.0, 18.0, 28.0]

    # Half-open windows: 22 September is the first day the old slabs are gone and
    # the first day 40% exists. One date, one boundary, no off-by-one.
    on_the_day = await check_dead_gst_slabs(_Pool(), ORG, as_at="2025-09-22")
    assert 12.0 not in on_the_day["live_slabs"]
    assert 40.0 in on_the_day["live_slabs"]


@pytest.mark.asyncio
async def test_a_line_that_was_right_when_it_was_issued_is_not_a_finding():
    """The 12% slab existed for eight years. History is not a defect.

    This is the single most damaging way this handler could be wrong: judging
    every line against today's slabs turns a clean org's report into a list of
    every correct invoice it raised before September 2025, and somebody would
    then re-issue them at a rate the Council removed.
    """
    pool = _Pool(dead_lines=[
        _line(document="INV-OLD", document_date=date(2025, 5, 1), rate=12),
        _line(document="INV-NEW", document_date=date(2026, 5, 1), rate=12),
    ])
    out = await check_dead_gst_slabs(pool, ORG, as_at="2026-08-20")

    flagged = [f["document"] for f in out["findings"]["document_lines"]]
    assert flagged == ["INV-NEW"]
    assert out["counts"]["document_lines_correct_when_issued"] == 1
    assert out["counts"]["document_lines_on_a_dead_slab"] == 1

    # The excluded one is disclosed, not silently dropped: a count that moves for
    # an unstated reason is a count nobody can check.
    joined = " ".join(out["caveats"])
    assert "WAS in force on the date of their own document" in joined
    assert "re-issuing them" in joined

    # And the abolition date is named, taken from a catalogue row this run had
    # already fetched rather than from a constant in the module.
    assert out["findings"]["document_lines"][0]["rate_abolished_on"] == "2025-09-22"


@pytest.mark.asyncio
async def test_the_product_master_is_judged_as_at_today_because_it_carries_no_date():
    """The asymmetry at the heart of this handler.

    A document is a record of something that happened on a day. A product is a
    forward-looking price list with no day at all, so every future document
    raised from it inherits its rate — which makes a master still on 12% wrong
    TODAY, whatever it was worth in 2024.
    """
    out = await check_dead_gst_slabs(
        _Pool(products=[_product()], product_total=12), ORG, as_at="2026-08-20")

    finding = out["findings"]["product_master"][0]
    assert finding["rate"] == 12.0
    assert "carries no date" in finding["why"]
    assert "wrong TODAY" in finding["why"]
    assert out["counts"]["products_on_a_dead_slab"] == 12
    assert any(c.startswith("TRUNCATED") and "1 of 12" in c for c in out["caveats"])


@pytest.mark.asyncio
async def test_a_mismatch_names_which_side_is_stale():
    """205 of the 207 live mismatches are the MASTER being wrong, not the line.

    The obvious phrasing — "this invoice line disagrees with the product master"
    — reads as an instruction to correct the invoice, and correcting two hundred
    correct invoices to an abolished 12% would put a rate that does not exist in
    law onto live documents. So the verdict names the stale side explicitly, and
    the three cases are genuinely different findings.
    """
    out = await check_dead_gst_slabs(
        _Pool(mismatches=[
            {"document": "INV-1", "document_date": date(2026, 8, 3),
             "description": "A4 Copier Paper (Ream)", "line_rate": 18, "master_rate": 12},
            {"document": "INV-2", "document_date": date(2026, 8, 3),
             "description": "Old Stock Item", "line_rate": 28, "master_rate": 18},
            {"document": "INV-3", "document_date": date(2026, 8, 3),
             "description": "USB Drive 64GB", "line_rate": 18, "master_rate": 5},
        ], coverage={"n_lines": 1230, "n_compared": 1027, "n_mismatches": 3}),
        ORG, as_at="2026-08-20",
    )
    verdicts = [m["which_side_is_stale"]
                for m in out["findings"]["rate_disagrees_with_product_master"]]

    assert "PRODUCT MASTER is the side carrying a rate that no longer exists" in verdicts[0]
    assert "do not touch the invoice" in verdicts[0].lower()

    assert "INVOICE LINE carries a rate that no longer exists" in verdicts[1]
    assert "document is the one that needs correcting" in verdicts[1]

    assert "Both rates are in force today" in verdicts[2]
    assert "Neither side is wrong on its face" in verdicts[2]

    # And the master-is-stale case is loud enough to survive summarising.
    joined = " ".join(out["caveats"])
    assert "Fix the master. Do NOT correct those invoices" in joined


@pytest.mark.asyncio
async def test_the_mismatch_count_states_the_population_it_was_drawn_from():
    """A mismatch count from 83% of the lines must not read as if it covered all.

    `line_items[].product_id` is empty on all 1,230 invoice lines on the seeded
    org, so the link is an exact product-NAME match covering 1,027 of them. The
    203 that could not be linked were not compared at all, and the output has to
    say that in the same breath as the count — otherwise "207 mismatches" reads
    as a complete answer about a population it never saw.
    """
    out = await check_dead_gst_slabs(
        _Pool(mismatches=[{"document": "INV-1", "document_date": date(2026, 8, 3),
                           "description": "A4 Copier Paper (Ream)",
                           "line_rate": 18, "master_rate": 12}],
              coverage={"n_lines": 1230, "n_compared": 1027, "n_mismatches": 207}),
        ORG, as_at="2026-08-20",
    )
    cov = out["coverage"]
    assert cov == {
        "invoice_lines": 1230,
        "compared_against_the_master": 1027,
        "not_linkable_to_a_product": 203,
        "how": cov["how"],
    }
    assert "product_id` is empty" in cov["how"]
    assert "never guessed" in cov["how"]
    assert "Vendor-bill lines are not compared at all" in cov["how"]

    joined = " ".join(out["caveats"])
    assert "203 of 1230 invoice lines could not be linked" in joined
    assert "covers 1027 lines, not all of them" in joined
    assert "TRUNCATED: 1 of 207 rate mismatches" in joined


@pytest.mark.asyncio
async def test_a_clean_org_reports_its_coverage_rather_than_a_bare_zero():
    """`count(*) OVER ()` cannot report through an empty result set.

    Without the separate coverage read, a healthy org came back saying "0 invoice
    lines compared" — indistinguishable from the comparison never having run,
    and that ambiguity is exactly what makes a zero untrustworthy.
    """
    out = await check_dead_gst_slabs(
        _Pool(coverage={"n_lines": 1230, "n_compared": 1027}), ORG, as_at="2026-08-20")

    assert out["counts"]["rate_mismatches"] == 0
    assert out["coverage"]["invoice_lines"] == 1230
    assert out["coverage"]["compared_against_the_master"] == 1027

    joined = " ".join(out["caveats"])
    assert "finding, not a skipped check" in joined
    assert "until the Council moves a rate again" in joined


@pytest.mark.asyncio
async def test_an_empty_catalogue_refuses_to_report_rather_than_condemning_everything():
    """The worst available failure direction, refused outright.

    If migration 158 were unapplied — or the schema qualification slipped, the
    way migration 142's shadow tables did — the live set would be empty and EVERY
    rate in the org would look abolished. That report goes to a CA who acts on
    it, so the handler declines instead, and says the fault is in the reference
    data rather than in the org.
    """
    out = await check_dead_gst_slabs(
        _Pool(catalogue=[], products=[_product()], product_total=12),
        ORG, as_at="2026-08-20",
    )
    assert "error" in out
    assert "reference-data fault, not a finding about this org" in out["error"]
    assert "findings" not in out


@pytest.mark.asyncio
async def test_dead_slabs_is_declared_on_demand_and_not_monthly():
    """A monthly schedule would guarantee eleven empty reports a year.

    A dead slab is fixed once and then returns zero until the Council next moves
    a rate. The cadence is on the OUTPUT, not only in the docstring, because the
    person choosing a schedule in the template editor reads the skill's own
    words and not this module's source.
    """
    out = await check_dead_gst_slabs(_Pool(), ORG, as_at="2026-08-20")
    assert "ON DEMAND, not monthly" in out["cadence"]
    assert "eleven empty reports a year" in out["cadence"]
    assert "ON DEMAND" in check_dead_gst_slabs.__doc__
    assert "NOT A MONTHLY SKILL" in check_dead_gst_slabs.__doc__


@pytest.mark.asyncio
async def test_no_hsn_digit_length_check_anywhere():
    """4 vs 6 digits turns on turnover, and this product records no turnover.

    Shipping the check would flag every small firm's perfectly compliant 4-digit
    HSN codes as defects. The brief for this batch asked for it to be left out;
    this is the ratchet that keeps it out.
    """
    text = _text(await check_dead_gst_slabs(
        _Pool(dead_lines=[_line()], products=[_product()], product_total=1),
        ORG, as_at="2026-08-20"))
    for banned in ("digit", "6-digit", "4-digit", "hsn is too short", "hsn length"):
        assert banned not in text

    src = inspect.getsource(check_dead_gst_slabs)
    assert "length(" not in src.replace("length(hsn", "")   # no digit-count SQL


@pytest.mark.asyncio
async def test_a_bad_as_at_is_refused_rather_than_silently_becoming_today():
    for bad in ("yesterday", "2026-13-01", "2026-02-30", "20-08-2026"):
        out = await check_dead_gst_slabs(_Pool(), ORG, as_at=bad)
        assert "error" in out, f"{bad!r} was accepted"

    # '20260820' IS a date. `date.fromisoformat` has accepted the basic ISO 8601
    # form since 3.11, and an earlier draft of this test demanded it be rejected
    # — which would have been a false rejection dressed up as validation, of
    # exactly the kind the GSTIN rule in this codebase exists to prevent.
    assert (await check_dead_gst_slabs(
        _Pool(), ORG, as_at="20260820"))["as_at"] == "2026-08-20"
    # And no argument at all means today, which is what a schedule supplies.
    assert "error" not in await check_dead_gst_slabs(_Pool(), ORG)


# ── things all three must obey ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_no_handler_ever_returns_a_uuid():
    """Names, not ids. `frontend/scripts/check-rendered-ids.mjs` is the web-side
    ratchet; this is the one for a skill payload, which reaches a reader through
    a language model rather than through a component.

    Vendor rows are grouped and joined on `vendor_id` inside the SQL — that is
    correct, because two vendors can share a name — but the id must never leave
    the handler.
    """
    outs = [
        await brief_ims_expectations(
            _Pool(bills=[_bill()], summary=_summary(bills=1)), ORG),
        await brief_itc_at_risk_of_lapse(
            _Pool(bills=[_bill()], summary=_summary(bills=1, tax_value=1.0)),
            ORG, financial_year="2025-26"),
        await check_dead_gst_slabs(
            _Pool(products=[_product()], product_total=1,
                  dead_lines=[_line()],
                  mismatches=[{"document": "INV-1", "document_date": date(2026, 8, 3),
                               "description": "x", "line_rate": 18, "master_rate": 12}],
                  coverage={"n_lines": 10, "n_compared": 8, "n_mismatches": 1}),
            ORG, as_at="2026-08-20"),
    ]
    import re
    uuid_re = re.compile(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
    for out in outs:
        found = uuid_re.findall(json.dumps(_without_links(out), default=str))
        assert not found, f"a uuid reached the output: {found}"


@pytest.mark.asyncio
async def test_every_query_is_schema_qualified_and_scoped_to_one_org():
    """`search_path` does not include `staging`, and a shadow table in `public`
    has bitten this repo before (migration 142). Every table reference is
    qualified, and $1 is the org on every data query.
    """
    pool = _Pool(bills=[_bill()], summary=_summary(bills=1), products=[_product()],
                 product_total=1, dead_lines=[_line()],
                 coverage={"n_lines": 1, "n_compared": 1})
    await brief_ims_expectations(pool, ORG)
    await brief_itc_at_risk_of_lapse(pool, ORG, financial_year="2025-26")
    await check_dead_gst_slabs(pool, ORG, as_at="2026-08-20")

    for sql in pool.sql_seen:
        for table in ("ganit_vendor_bills", "ganit_vendors", "ganit_products",
                      "ganit_invoices", "statute_calendar"):
            if table in sql:
                assert f"staging.{table}" in sql, f"{table} unqualified in:\n{sql}"
        if "staging.ganit_" in sql:
            assert "org_id = $1::uuid" in sql, f"unscoped query:\n{sql}"


@pytest.mark.asyncio
async def test_no_handler_writes_anything():
    """Read-only, and provably so. Staging and production share one database."""
    pool = _Pool(bills=[_bill()], summary=_summary(bills=1), products=[_product()],
                 product_total=1, dead_lines=[_line()],
                 coverage={"n_lines": 1, "n_compared": 1})
    await brief_ims_expectations(pool, ORG)
    await brief_itc_at_risk_of_lapse(pool, ORG, financial_year="2025-26")
    await check_dead_gst_slabs(pool, ORG, as_at="2026-08-20")

    assert not hasattr(pool, "execute_called")
    for sql in pool.sql_seen:
        head = sql.strip().lstrip("(").upper()
        assert head.startswith(("SELECT", "WITH")), f"not a read:\n{sql}"
        for verb in ("INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER ", "CREATE "):
            assert verb not in sql.upper(), f"{verb.strip()} in:\n{sql}"


@pytest.mark.asyncio
async def test_no_handler_asks_for_an_image():
    """Statutory briefs must never generate one. Images are 79% of AI spend."""
    for out in (
        await brief_ims_expectations(_Pool(), ORG),
        await brief_itc_at_risk_of_lapse(_Pool(), ORG, financial_year="2025-26"),
        await check_dead_gst_slabs(_Pool(), ORG, as_at="2026-08-20"),
    ):
        assert "generate_image" not in out
        assert "image_prompt" not in out
        assert "image" not in _text(out)


def test_if_the_lead_has_registered_these_the_wiring_agrees():
    """Passes before the registry lines land, and tightens the moment they do.

    The registry and `services/skills/modules.py` belong to the lead — four
    agents editing those two files would clobber each other — so this cannot
    assert the entries exist. It asserts that IF they exist they are right: the
    right module path, the right function, and a module declaration, whose
    absence is the failure that produced `modules.py` in the first place.
    """
    from services.skill_dispatcher import SKILL_REGISTRY
    from services.skills.modules import FUNCTION_MODULES

    for name in ("brief_ims_expectations", "brief_itc_at_risk_of_lapse",
                 "check_dead_gst_slabs"):
        if name not in SKILL_REGISTRY:
            continue
        module_path, fn_name, _defaults = SKILL_REGISTRY[name]
        assert module_path == "services.skills.data.gst_cliffs"
        assert fn_name == name
        assert name in FUNCTION_MODULES, (
            f"{name} is registered but declares no module. Every handler here "
            f"reads Ganit tables: frozenset({{'ganit'}})."
        )
        assert FUNCTION_MODULES[name] == frozenset({"ganit"})
