"""
The pre-3B pack, and the sentence it is not allowed to say.

`brief_itc_reversal_risk` reports vendor bills unpaid 180 days and the input tax
credit Rule 37 puts at risk. Most of what follows is not about arithmetic. It is
about the fact that this number CANNOT BE TIED OUT, and that the output has to
say so in words the reader will actually see.

A CA opening this will try to reconcile it against their own Rule 37 working. It
will not reconcile, because the system records no ITC-availed flag, cannot see a
Schedule I deemed supply, and has no availment date from which s.50(3) interest
could run. A figure that cannot be tied out and does not say so is worse than no
figure at all: it does not just fail here, it makes the preparer stop believing
the GSTR-1 readiness pack and the 3B brief as well. Hence
`test_it_never_claims_to_be_the_amount_to_reverse` and the three limitation
tests, which are the load-bearing tests in this file.

The rest pins the statutory shape:

  · the 180 days run from the INVOICE date, never the due date — the sibling
    handler `propose_payment_run` ages off `due_date` and is right to, which is
    exactly why somebody will eventually "fix" this one to match;
  · the reversal is PROPORTIONATE to the unpaid part (Rule 37(1)), so a bill
    58% unpaid puts 58% of its tax at risk, not all of it;
  · reverse-charge supplies are OUTSIDE Rule 37 by its own proviso, and the
    column that records them exists, so they are excluded and the exclusion is
    counted rather than silent;
  · the reversal is due in the return for the period immediately AFTER the one
    the 180 days expired in, so a single undifferentiated list would have a
    preparer reverse next month's items this month.

Live figures at the time of writing, read-only against the seeded org for
2026-07: 38 bills, 33 vendors, 293,364.61 at risk, of which only 3 bills fall
due in that return and 32 were already due in an earlier one.
"""
import inspect
import json
from datetime import date, datetime, timedelta, timezone

import pytest

from services.skill_dispatcher import SKILL_REGISTRY
from services.skills.data.itc_reversal import (
    RULE_37_DAYS,
    brief_itc_reversal_risk,
)
from services.skills.modules import FUNCTION_MODULES
from services.skills.timeutil import return_period

# A fixture value, and deliberately not the seeded org's id even in part. The
# pool below is a fake, so this is only ever an argument to assert on — but an
# id that LOOKS like the real one gets copied into a live probe, and the probe
# then returns nothing and reads as a regression. That happened once with an
# earlier version of this constant, which carried the seeded org's real first
# segment and an invented remainder.
ORG = "00000000-0000-4000-8000-000000000001"
SKILL = "brief_itc_reversal_risk"


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
    """One row in the shape the handler's own SQL returns.

    `unpaid`, `deadline_date` and `days_since_invoice` are DERIVED here rather
    than passed in, because they are derived in the query too. A fixture that
    let a test hand-set `unpaid` inconsistently with `total - amount_paid` would
    pass while the real query disagreed with it.
    """
    row = {
        "vendor_id": "11111111-1111-1111-1111-111111111111",
        "vendor_name": "Ganga Printers Pvt Ltd",
        "vendor_gstin": "07BBSPV2018M1ZS",
        # A finding that names a vendor and gives no way to reach them
        # is the defect these handlers were changed to fix.
        "vendor_email": "vendor18@example.com",
        "vendor_phone": "+91 8200126234",
        "bill_number": "VB-0063",
        "internal_ref": "REF-0063",
        "bill_date": date(2025, 10, 19),
        "total": 100000.0,
        "amount_paid": 0.0,
        "cgst": 0.0, "sgst": 0.0, "igst": 18000.0, "cess": 0.0,
        "currency": "INR",
        "status": "unpaid",
    }
    row.update(kw)
    row["unpaid"] = row["total"] - row["amount_paid"]
    row["deadline_date"] = row["bill_date"] + timedelta(days=RULE_37_DAYS)
    row["days_since_invoice"] = 400
    return row


class _Pool:
    """Records the SQL it was given and replays a fixed set of bills."""

    def __init__(self, rows=None, reverse_charge_count=0):
        self.rows = rows if rows is not None else [_bill()]
        self.reverse_charge_count = reverse_charge_count
        self.fetch_sql = None
        self.fetch_args = None
        self.fetchval_sql = None

    async def fetch(self, sql, *args):
        self.fetch_sql, self.fetch_args = sql, args
        return self.rows

    async def fetchval(self, sql, *args):
        self.fetchval_sql = sql
        return self.reverse_charge_count


async def _run(pool, **kw):
    return await brief_itc_reversal_risk(pool, ORG, **kw)


def _text(out) -> str:
    """Every string the caller could possibly show a reader, flattened."""
    return json.dumps(out, default=str).lower()


# ── The wording. These are the tests this handler exists to pass. ───────────

@pytest.mark.asyncio
async def test_it_never_claims_to_be_the_amount_to_reverse():
    """The one sentence that would destroy trust in the whole catalogue.

    The product cannot know a credit was availed, so it cannot know a reversal
    is owed. Saying otherwise produces a number a CA will spend an afternoon
    failing to tie out, and after that they will not believe the GSTR-1 pack
    either.
    """
    out = await _run(_Pool())
    text = _text(out)

    # Each phrase must be absent, or DENIED — "not the exact amount to reverse"
    # is the sentence this test exists to require, and a plain substring ban
    # would fail the handler for carrying its own disclaimer. So the claim is
    # only a defect when nothing negates it.
    for forbidden in (
        "must reverse",
        "you must reverse",
        "the exact tax",
        "exact amount to reverse",
        "amount you have to reverse",
        "tax payable on reversal",
    ):
        at = text.find(forbidden)
        while at != -1:
            # A short window, because a negation that is further away than this
            # is not one the reader will connect to the claim.
            window = text[max(0, at - 12):at]
            assert "not " in window or "never " in window, (
                f"output claims certainty it cannot have: {forbidden!r} at "
                f"...{text[max(0, at - 60):at + len(forbidden)]}"
            )
            at = text.find(forbidden, at + len(forbidden))

    assert "at risk of reversal" in text, (
        "the figure must be described as CREDIT AT RISK OF REVERSAL — that "
        "phrasing is the whole contract with the reader"
    )
    assert "credit_at_risk" in out["totals"]
    assert "not the exact amount to reverse" in out["what_this_figure_is"].lower()


@pytest.mark.asyncio
async def test_the_three_limitations_are_on_the_face_of_the_output():
    """In the returned dict, not in a docstring.

    The output is handed to a language model and only then to a person. A
    caveat that lives in a comment is a caveat the reader never sees, so each of
    the three reasons the figure cannot be tied out has to be a value in the
    data.
    """
    out = await _run(_Pool())
    limitations = " ".join(out["limitations"]).lower()

    # 1 · no ITC-availed flag: charged is not availed.
    assert "availed" in limitations and "charged" in limitations
    # 2 · Schedule I deemed supplies are invisible here.
    assert "schedule i" in limitations
    # 3 · no s.50 interest, because the availment date is not recorded.
    assert "interest" in limitations and "50" in limitations

    assert len(out["limitations"]) >= 3


@pytest.mark.asyncio
async def test_it_says_what_comes_back():
    """A two-sided fact, not a penalty notice.

    The credit is re-availed in full when the supplier is paid, in Table 4A(5),
    with no time limit — the s.16(4) cut-off does not apply to it. Omitting that
    turns a cash-flow prompt into a fine, and the obvious action (pay the vendor
    before filing) stops being obvious.
    """
    out = await _run(_Pool())
    back = out["what_comes_back"].lower()

    assert "4a(5)" in back
    assert "no time limit" in back
    assert "16(4)" in back
    assert "4b(2)" in out["where_it_goes"].lower()


# ── The statutory shape ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_clock_runs_from_the_invoice_date_not_the_due_date():
    """Rule 37 counts 180 days from the date of ISSUE of the invoice.

    `propose_payment_run` ages the same table off `due_date`, correctly, for a
    payment run. Copying that here would let a bill on 90-day terms sit 270 days
    unpaid before this pack noticed it, and would skip a bill with no due date
    at all. The query must name `bill_date` and must not touch `due_date`.
    """
    pool = _Pool()
    await _run(pool)

    assert f"b.bill_date + {RULE_37_DAYS}" in pool.fetch_sql
    assert "due_date" not in pool.fetch_sql, (
        "the Rule 37 clock is not the payment-terms clock"
    )


@pytest.mark.asyncio
async def test_the_reversal_is_proportionate_to_the_unpaid_part():
    """Rule 37(1) reverses in proportion to what is still owed.

    Nine of the seeded org's forty-one candidates are part-paid. Taking the
    whole tax on a bill that is more than half settled would overstate it by
    more than half, and it would overstate it in the direction that costs the
    client money.
    """
    out = await _run(_Pool([_bill(total=34104.36, amount_paid=14451.0,
                                  igst=5202.36)]))
    bill = out["vendors"][0]["bill_detail"][0]

    assert bill["unpaid_proportion"] == pytest.approx(0.5763, abs=1e-4)
    assert bill["tax_charged_on_bill"]["igst"] == 5202.36
    # 5202.36 × 19653.36/34104.36 — verified against the live row VB-0014.
    assert bill["credit_at_risk"] == pytest.approx(2997.97, abs=0.01)
    assert bill["credit_at_risk"] < bill["tax_charged_on_bill"]["igst"]


@pytest.mark.asyncio
async def test_a_fully_unpaid_bill_puts_its_whole_tax_at_risk():
    out = await _run(_Pool([_bill(total=100000.0, amount_paid=0.0, igst=18000.0)]))
    assert out["totals"]["credit_at_risk"] == 18000.0
    assert out["vendors"][0]["bill_detail"][0]["unpaid_proportion"] == 1.0


@pytest.mark.asyncio
async def test_a_zero_total_bill_does_not_divide_by_zero():
    """A malformed row must not take a scheduled run down.

    `total` is NOT NULL DEFAULT 0, so a bill with zero total and tax on it is
    reachable. `unpaid / total` on that row raises ZeroDivisionError and kills
    every remaining vendor in the pack.
    """
    out = await _run(_Pool([_bill(total=0.0, amount_paid=-500.0, igst=90.0)]))
    assert out["vendors"][0]["bill_detail"][0]["unpaid_proportion"] == 1.0


@pytest.mark.asyncio
async def test_reverse_charge_is_excluded_by_the_query_and_counted_out_loud():
    """The proviso puts reverse charge outside Rule 37 — and we CAN see it.

    `ganit_vendor_bills.is_reverse_charge` exists live. On a reverse-charge
    supply the recipient pays the tax itself, so failing to pay the supplier
    claws back nothing; counting those bills would be a plain overstatement.
    They are filtered in SQL so the row cap is spent on real exposure, and the
    number filtered is disclosed, because a row that silently vanishes from a
    statutory pack is worse than one that is wrong out loud.
    """
    pool = _Pool(reverse_charge_count=4)
    out = await _run(pool)

    assert "is_reverse_charge" in pool.fetch_sql
    assert "= FALSE" in pool.fetch_sql
    assert out["excluded"]["reverse_charge_bills"] == 4
    assert "reverse-charge" in " ".join(out["limitations"]).lower()


@pytest.mark.asyncio
async def test_a_bill_with_no_tax_is_left_out_and_said_so():
    """No tax charged means no credit to reverse.

    Listing it with a zero invites somebody to reverse zero and tick it off as
    handled, so it is counted instead — and the count is disclosed, along with
    where the money side of it does show up.
    """
    out = await _run(_Pool([_bill(cgst=0.0, sgst=0.0, igst=0.0, cess=0.0)]))

    assert out["vendors"] == []
    assert out["excluded"]["bills_with_no_tax_on_record"] == 1
    assert any("no gst on record" in c.lower() for c in out["caveats"])


@pytest.mark.asyncio
async def test_cess_is_carried_not_dropped():
    """`cess` arrived on this table with `is_reverse_charge` and is easy to miss."""
    out = await _run(_Pool([_bill(igst=18000.0, cess=1200.0)]))
    assert out["totals"]["credit_at_risk_by_head"]["cess"] == 1200.0
    assert out["totals"]["credit_at_risk"] == 19200.0


# ── Which return the reversal belongs in ───────────────────────────────────

@pytest.mark.asyncio
async def test_each_bill_names_the_return_its_reversal_belongs_in():
    """Rule 37(1): the return for the period immediately FOLLOWING the expiry.

    A bill whose 180 days ran out on 17 April 2026 is reversed in the May 2026
    3B, not the April one. Getting this wrong by a month is a wrong return, not
    a rounding error.
    """
    out = await _run(_Pool([_bill(bill_date=date(2025, 10, 19))]), period="2026-05")
    bill = out["vendors"][0]["bill_detail"][0]

    assert bill["rule_37_deadline"] == "2026-04-17"
    assert bill["reversal_due_in_return"] == "2026-05"
    assert bill["falls_in"] == "this_return"


@pytest.mark.asyncio
async def test_a_december_expiry_rolls_into_january_of_the_next_year():
    """The month-after arithmetic, at the one boundary that is easy to get wrong."""
    # 180 days before 20 December 2026.
    expiry = date(2026, 12, 20)
    out = await _run(_Pool([_bill(bill_date=expiry - timedelta(days=RULE_37_DAYS))]),
                     period="2027-01")
    assert out["vendors"][0]["bill_detail"][0]["reversal_due_in_return"] == "2027-01"


@pytest.mark.asyncio
async def test_arrears_and_forewarning_are_not_mixed_with_this_month_s_work():
    """Three buckets, because one list would be misread in both directions.

    A preparer given one undifferentiated list reverses next month's items this
    month, and never notices that the bulk of the exposure was already due in a
    return they have filed.
    """
    out = await _run(_Pool([
        _bill(bill_date=date(2025, 1, 1), bill_number="OLD"),    # long expired
        _bill(bill_date=date(2025, 10, 19), bill_number="NOW"),  # expires 2026-04
        _bill(bill_date=date(2025, 12, 1), bill_number="SOON"),  # expires 2026-05
    ]), period="2026-05")

    buckets = {b["bill"]: b["falls_in"]
               for g in out["vendors"] for b in g["bill_detail"]}
    assert buckets == {"OLD": "earlier_return", "NOW": "this_return",
                       "SOON": "next_return"}

    assert set(out["by_when_due"]) == {"earlier_return", "this_return", "next_return"}
    assert sum(v["bills"] for v in out["by_when_due"].values()) == 3


# ── Grouping, tenancy and the house rules ──────────────────────────────────

@pytest.mark.asyncio
async def test_two_vendors_with_the_same_name_are_not_merged():
    """Grouping is on the vendor ROW, never on the name.

    The live data has four `ganit_vendors` rows carrying the same name inside
    one org, and the seeded org has both 'Metro IT Solutions Pvt Ltd' and
    'Metro IT Solutions & Co'. Grouping on the label would invent a counterparty
    that owes the sum of two real ones.
    """
    out = await _run(_Pool([
        _bill(vendor_id="aaaaaaaa-0000-0000-0000-000000000001",
              vendor_name="Om Stationers", vendor_gstin="27AAQCR5055K1ZR"),
        _bill(vendor_id="bbbbbbbb-0000-0000-0000-000000000002",
              vendor_name="Om Stationers", vendor_gstin="07BBSPV2018M1ZS"),
    ]))
    assert len(out["vendors"]) == 2
    assert out["totals"]["vendors"] == 2


@pytest.mark.asyncio
async def test_no_identifier_is_ever_rendered():
    """Names, not IDs. The vendor id is a grouping key and nothing else.

    `frontend/scripts/check-rendered-ids.mjs` is the ratchet on the UI side; a
    skill handler that emits a uuid into its own output slips underneath it,
    because by then it is just a string in a language model's context.
    """
    out = await _run(_Pool())
    text = json.dumps(out, default=str)

    text = json.dumps(_without_links(json.loads(text)), default=str)         if text.lstrip().startswith(("{", "[")) else text
    assert "11111111-1111-1111-1111-111111111111" not in text
    assert ORG not in text
    assert "vendor_id" not in text


@pytest.mark.asyncio
async def test_the_query_is_scoped_to_one_org_and_reads_nothing_else():
    pool = _Pool()
    await _run(pool)

    assert "b.org_id = $1::uuid" in pool.fetch_sql
    # The vendor join carries the tenant too — a wrong vendor_id must not be
    # able to read another org's counterparty name.
    assert "v.org_id = b.org_id" in pool.fetch_sql
    assert pool.fetch_args[0] == ORG
    # Every table qualified. An unqualified name resolves against search_path,
    # and this repo has already been bitten by a shadow twin of a staging table.
    assert "public.ganit_vendor_bills" in pool.fetch_sql
    assert "public.ganit_vendors" in pool.fetch_sql

    for write in ("insert ", "update ", "delete ", "merge "):
        assert write not in pool.fetch_sql.lower(), "this handler is read-only"


@pytest.mark.asyncio
async def test_a_soft_deleted_vendor_does_not_delete_the_exposure():
    """LEFT JOIN, not the inner join `routers/ganit.py` uses.

    The credit is at risk whether or not somebody tidied up the vendor master.
    """
    pool = _Pool([_bill(vendor_name="(vendor record unavailable)", vendor_gstin=None)])
    out = await _run(pool)

    assert "LEFT JOIN public.ganit_vendors" in pool.fetch_sql
    assert out["vendors"][0]["vendor"] == "(vendor record unavailable)"
    assert out["totals"]["credit_at_risk"] == 18000.0


# ── Scheduling, defaults and bad input ─────────────────────────────────────

def test_it_can_run_unattended():
    """No parameter without a default beyond org_id.

    The dispatcher refuses a handler whose signature declares one nobody
    supplied, so such a skill can never run on a schedule — and a pre-filing
    pack that has to be launched by hand on the right day is a pack nobody runs.
    `tests/test_a_skill_can_run_unattended.py` enforces this across the whole
    registry; it is repeated here so the failure names this handler.
    """
    required = [
        name for name, p in inspect.signature(brief_itc_reversal_risk).parameters.items()
        if name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
    ]
    assert not required, f"{SKILL} cannot be scheduled: it requires {required}"


@pytest.mark.asyncio
async def test_the_default_period_is_the_one_being_filed():
    """The previous month, not this one.

    GSTR-3B for August is due on 20 September, so somebody running the pre-3B
    pack in September is preparing August. Defaulting to the current month would
    measure the 180 days as at a date that has not happened and report a period
    that cannot be filed yet.
    """
    pool = _Pool()
    out = await _run(pool)

    assert out["period"] == return_period()
    assert out["period"] < datetime.now(timezone.utc).strftime("%Y-%m")
    # The cutoff handed to the query is the last day of that period.
    assert out["as_at"].startswith(out["period"])
    assert pool.fetch_args[1].isoformat() == out["as_at"]


@pytest.mark.asyncio
async def test_a_malformed_period_is_an_error_not_an_exception():
    """A scheduled run must fail with a sentence, not a traceback."""
    # '2026-00' is in this list because it is the one bad month `date()` accepts
    # by accident: `date(2026, 0 + 1, 1)` is a valid 1 January, so month zero
    # used to be taken and come back as at 2025-12-31 — a cutoff in the wrong
    # YEAR, with every bill bucketed against a period string no return exists
    # for. 13 and up already raised. Zero is what an off-by-one month index
    # produces, which is how it would arrive.
    for bad in ("not-a-period", "2026/07", "202607", "2026-13", "2026-xx",
                "2026-00", "2026-07-01"):
        out = await brief_itc_reversal_risk(_Pool(), ORG, period=bad)
        assert "error" in out, f"{bad!r} was accepted"
        assert "YYYY-MM" in out["error"]


@pytest.mark.asyncio
async def test_an_empty_period_falls_back_to_the_default_rather_than_erroring():
    """`''` means nobody supplied one, not that somebody supplied a bad one.

    The dispatcher hands through whatever a step's `params` carry, and an empty
    string is what an untouched form field sends. Treating it as malformed would
    turn a blank field into a failed scheduled run. Same behaviour as
    `check_gstr1_readiness`.
    """
    out = await brief_itc_reversal_risk(_Pool(), ORG, period="")
    assert out.get("period") == return_period()


@pytest.mark.asyncio
async def test_an_empty_result_says_it_is_a_finding():
    """Nothing found and nothing checked look identical unless one of them speaks."""
    out = await _run(_Pool([]))

    assert out["totals"]["bills"] == 0
    assert any("finding, not a skipped check" in c for c in out["caveats"])
    # And the limitations still stand: a nil answer is not a clean bill of health.
    assert len(out["limitations"]) >= 3


@pytest.mark.asyncio
async def test_the_cap_is_disclosed_as_a_floor():
    out = await _run(_Pool([_bill(bill_number=f"VB-{i}") for i in range(3)]), limit=3)
    assert any("floor" in c for c in out["caveats"])


@pytest.mark.asyncio
async def test_a_foreign_currency_bill_is_listed_but_kept_out_of_the_totals():
    """GST is an INR tax and nothing records which unit these columns are in.

    Every bill is INR today. `currency` and `exchange_rate` exist on the table,
    so the day one is not, the totals must not silently absorb it — and it must
    not silently disappear either.
    """
    out = await _run(_Pool([
        _bill(bill_number="INR-1", igst=18000.0),
        _bill(bill_number="USD-1", currency="USD", igst=500.0),
    ]))

    assert out["totals"]["credit_at_risk"] == 18000.0
    assert out["totals"]["bills"] == 1
    listed = {b["bill"] for g in out["vendors"] for b in g["bill_detail"]}
    assert listed == {"INR-1", "USD-1"}
    assert any("not in inr" in c.lower() for c in out["caveats"])
    # The row says for itself that it is not in the figures, so a reader who
    # adds the column up and lands short can see which line is the difference.
    marked = {b["bill"]: b["counted_in_totals"]
              for g in out["vendors"] for b in g["bill_detail"]}
    assert marked == {"INR-1": True, "USD-1": False}


@pytest.mark.asyncio
async def test_every_aggregate_on_the_page_adds_up_to_the_headline():
    """`totals`, `by_when_due` and the vendor rows are ONE population.

    The first version gated only the headline `totals` on currency, so a
    foreign-currency bill still landed in `by_when_due` and in its vendor's
    `credit_at_risk`. Two INR bills of 18,000 and one USD bill of 500 then
    produced a headline of 18,000 with a by-vendor column that summed to 18,500,
    and nothing on the page accounted for the 500. That is the exact failure —
    a figure a CA cannot tie out — that this whole handler is written to avoid,
    and it would not have shown up until the first foreign-currency bill was
    recorded. Every aggregate is asserted against the headline here, so the next
    exclusion anyone adds has to be applied in all three places or this fails.
    """
    out = await _run(_Pool([
        _bill(bill_number="INR-1", igst=18000.0),
        _bill(bill_number="USD-1", currency="USD", igst=500.0,
              vendor_id="cccccccc-0000-0000-0000-000000000003",
              vendor_name="Offshore Supplies Ltd"),
    ]))

    head = out["totals"]
    assert head["credit_at_risk"] == round(
        sum(v["credit_at_risk"] for v in out["by_when_due"].values()), 2)
    assert head["credit_at_risk"] == round(
        sum(g["credit_at_risk"] for g in out["vendors"]), 2)
    assert head["bills"] == sum(v["bills"] for v in out["by_when_due"].values())
    assert head["bills"] == sum(g["bills"] for g in out["vendors"])
    # The excluded vendor is still printed — it is just counted nowhere, and
    # `totals["vendors"]` counts contributors rather than printed rows so the
    # vendor count and the bill count come from the same population.
    assert len(out["vendors"]) == 2
    assert head["vendors"] == 1
    offshore = next(g for g in out["vendors"] if g["vendor"] == "Offshore Supplies Ltd")
    assert offshore["bills"] == 0 and offshore["bills_not_in_totals"] == 1
    assert offshore["credit_at_risk"] == 0.0


@pytest.mark.asyncio
async def test_a_run_that_excluded_everything_still_reaches_a_conclusion():
    """Nil because nothing qualified, and nil because everything was excluded,
    are different findings and must not look the same.

    A run where every candidate bill was reverse-charge used to come back with
    empty totals, an empty vendor list and not one caveat — indistinguishable
    from a check that never ran. `excluded` carried the count, but a preparer
    looking for a conclusion reads the caveats.
    """
    out = await _run(_Pool([], reverse_charge_count=3))

    assert out["totals"]["bills"] == 0
    said = " ".join(out["caveats"]).lower()
    assert "finding, not a skipped check" in said
    assert "reverse-charge" in said and "3" in said
    # And it must NOT claim nothing is unpaid past 180 days — three bills are.
    assert "no vendor bill is unpaid" not in said


# ── Registration ───────────────────────────────────────────────────────────

def test_it_is_registered_and_declares_the_module_it_reads():
    """A handler nobody registered is a handler nobody can run.

    And a registered name with no line in `FUNCTION_MODULES` falls through to
    the maximally-restricted default: safe, but it means nobody can run it and
    nothing says why.
    """
    assert SKILL in SKILL_REGISTRY
    module_path, fn_name, defaults = SKILL_REGISTRY[SKILL]
    assert fn_name == "brief_itc_reversal_risk"
    assert module_path.endswith("itc_reversal")
    assert defaults == {"limit": 200}

    assert FUNCTION_MODULES[SKILL] == frozenset({"ganit"})


def test_it_is_not_a_write_skill():
    from services.skill_dispatcher import WRITE_SKILL_FUNCTIONS

    assert SKILL not in WRITE_SKILL_FUNCTIONS
