"""
Three checks, and the sentences they are not allowed to say.

`stock_and_crm` holds `check_impossible_stock`, `check_unfillable_orders` and
`check_stale_retainer_rates`. Most of what follows is not about arithmetic. It
is about the two ways a check like this destroys its own reader:

  1. By presenting a covered FRACTION as the whole. Live, every open order line
     on the seeded e2e org carries `"product_id": ""`, so
     `check_unfillable_orders` can see none of that org's order book. A report
     that came back with no shortages and said nothing else would be read as a
     clean bill of health for an order book it never looked at. That is the
     single most damaging thing a compliance report can do, and
     `test_a_check_that_could_not_look_never_reads_as_clean` is the test that
     exists to stop it.

  2. By presenting a suspicion as a fact. `vikray_stock` (a balance) and
     `vikray_stock_moves` (a ledger) disagree on 29 of the seeded org's 31
     stock rows, because stock is loaded straight onto the balance and no
     opening-balance row exists anywhere. So a running total computed from the
     ledger dives negative for products that were never actually short. Those
     findings are graded `unverified`, and the grading is pinned here.

The rest pins the shape:

  · the cumulative-commitment distinction, which is the only reason
    `check_unfillable_orders` is not a duplicate of `find_low_stock` — a
    product with 10 on hand and two orders of 6 is fine per order and short
    across the book, and nothing else in the product can see that;
  · a confirmed order whose stock deduction IS on record must not be counted
    again, or the check invents a shortage out of its own double-count;
  · `renewal_reminder_days` is 30 on all 63 live rows, so a skill claiming to
    honour a window the firm chose would be inventing the choice — the output
    has to say whose window it is;
  · no user, client or product id is ever emitted, by any of the three.

Live figures at the time of writing, read-only on 2026-08-20. On the seeded
e2e org (64e7bea6): one negative running total each on 10 products, all
`unverified`; zero negative balances; 176 open order lines, none naming a
product; 10 contracts whose status says 'expired' against an end date of
2027-03-31. On the other seeded org (fae87907): one confirmed negative balance
— 'Statutory Audit' at −3, which is a SERVICE — and 10 products short across
13 open lines.
"""
import inspect
import json
import re

import pytest

from services.skills.data.stock_and_crm import (
    OPEN_ORDER_STATUSES,
    check_impossible_stock,
    check_stale_retainer_rates,
    check_unfillable_orders,
)

# A fixture value, and deliberately nothing like either seeded org's id. The
# pool below is a fake, so this is only ever an argument to assert on — an id
# that LOOKS real gets copied into a live probe, which then returns nothing and
# reads as a regression.
ORG = "00000000-0000-4000-8000-000000000009"

#: Anything shaped like a UUID. Used to prove none of the three handlers ever
#: puts one on its output: names, not ids, everywhere.
UUID_RX = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


class _Pool:
    """Routes each query to a canned answer by a marker in its own SQL.

    Routing on the SQL rather than on call order deliberately: a handler that
    grows a fourth query would otherwise silently receive the answer meant for
    the third, and the test would keep passing while the handler read the wrong
    table.
    """

    def __init__(self, **answers):
        self.answers = answers
        self.seen: list[str] = []

    def _route(self, sql):
        self.seen.append(sql)
        markers = {
            "WITH led AS": "stock_rows_q",
            "AS stock_rows": "stock_coverage_q",
            "WITH line AS": "order_lines_q",
            "AS open_lines": "order_coverage_q",
            "AS days,": "reminder_q",
            "staging.ganit_recurring": "recurring_q",
            "staging.ganit_contracts k": "contracts_q",
        }
        for marker, key in markers.items():
            if marker in sql:
                return self.answers.get(key, [])
        raise AssertionError(f"unrouted query:\n{sql[:400]}")

    async def fetch(self, sql, *args):
        return self._route(sql)

    async def fetchrow(self, sql, *args):
        got = self._route(sql)
        return got[0] if isinstance(got, list) and got else got


def _text(out) -> str:
    """Every string the caller could show a reader, flattened."""
    return json.dumps(out, default=str).lower()


def _claims(out) -> str:
    """The parts of the output that ASSERT something, without the disclaimers.

    `what_this_is`, `not_checked` and `limitations` exist precisely to say "this
    is not a valuation" and "nothing here has been corrected", so they contain
    the very words a forbidden-phrase scan is looking for. Scanning them made
    the first version of these tests fail on the handler doing exactly the right
    thing. The rule being enforced is that the FINDINGS never claim what the
    disclaimers deny, so the findings are what gets scanned.
    """
    return json.dumps(
        {k: out[k] for k in ("counts", "findings", "products", "contracts",
                             "recurring_profiles", "coverage", "caveats")
         if k in out},
        default=str,
    ).lower()


def _sql_for(pool, marker) -> str:
    return next(s for s in pool.seen if marker in s)


# ── Fixtures in the shape each query actually returns ──────────────────────

def _stock(**kw):
    """One row of `check_impossible_stock`'s main query.

    `ledger_net` is NOT derived here, on purpose: the whole finding is that the
    balance and the ledger disagree, so a fixture that forced them to agree
    could never exercise the grading this handler exists for.
    """
    row = {
        "product_name": "Toner Cartridge",
        "unit": "NOS",
        "is_service": False,
        "product_is_active": True,
        "has_cost_price": False,
        "has_stock_row": True,
        "on_hand": 0.0,
        "low_stock_threshold": 0.0,
        "ledger_net": 0.0,
        "inbound": None,
        "outbound": None,
        "moves": 0,
        "first_move": None,
        "last_move": None,
        "lowest_running": None,
        "first_negative_date": None,
        "_total": 1,
    }
    row.update(kw)
    return row


def _stock_coverage(**kw):
    row = {"stock_rows": 31, "movement_rows": 129,
           "active_products": 81, "products_without_cost_price": 81}
    row.update(kw)
    return row


def _line(**kw):
    row = {
        "order_number": "SO-2026-0001",
        "status": "draft",
        "order_date": __import__("datetime").date(2026, 8, 1),
        "expected_delivery": __import__("datetime").date(2026, 8, 15),
        "customer": "Agarwal Textiles",
        "line_description": "Toner Cartridge",
        "qty": 1.0,
        "product_name": "Toner Cartridge",
        "unit": "NOS",
        "is_service": False,
        "on_hand": 10.0,
        "has_stock_row": True,
        "deduction_recorded": False,
        "_total": 1,
    }
    row.update(kw)
    return row


def _order_coverage(**kw):
    row = {"open_lines": 1, "lines_naming_a_product": 1,
           "lines_with_no_readable_quantity": 0, "open_orders": 1}
    row.update(kw)
    return row


def _contract(**kw):
    import datetime as _dt
    row = {
        "title": "Annual Retainer FY26",
        "status": "active",
        "start_date": _dt.date(2026, 4, 1),
        "end_date": _dt.date(2026, 9, 30),
        "contract_value": 356535.0,
        "renewal_reminder_days": 30,
        "last_changed": _dt.date(2026, 8, 3),
        "created_on": _dt.date(2026, 5, 20),
        "days_to_end": 41,
        "unchanged_too_long": False,
        "client": "Gupta Traders",
        "_total": 1,
    }
    row.update(kw)
    return row


def _profile(**kw):
    import datetime as _dt
    row = {
        "frequency": "monthly",
        "subtotal": 24609.0,
        "gst_rate": 18.0,
        "next_date": _dt.date(2026, 8, 21),
        "end_date": None,
        "created_on": _dt.date(2025, 1, 3),
        "client": "Gokul Dairy Foods Pvt Ltd",
        "invoices_raised": 18,
        "distinct_amounts_billed": 1,
        "first_billed": _dt.date(2025, 2, 1),
        "_total": 1,
    }
    row.update(kw)
    return row


# ══════════════════════════════════════════════════════════════════════════
# Every one of the three must be schedulable at all
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("handler", [
    check_impossible_stock, check_unfillable_orders, check_stale_retainer_rates])
def test_a_handler_needs_nothing_a_schedule_cannot_supply(handler):
    """The dispatcher refuses any handler with an undefaulted parameter.

    Not a style rule: `_run_function_step` fails the run closed rather than
    passing None into a query, so a single parameter without a default makes
    the skill impossible to schedule and therefore impossible to sell. Pinned
    here as well as in `test_a_skill_can_run_unattended.py`, because that file
    reads the registry and these three are not in it until the lead pastes them
    in — this test fails the moment the signature drifts, not the moment the
    registry catches up.
    """
    required = [
        name for name, p in inspect.signature(handler).parameters.items()
        if name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
        and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
    ]
    assert not required, (
        f"{handler.__name__} requires {required}, which a schedule cannot "
        f"supply. Give it a default or the dispatcher will refuse every run."
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("marker", ["graha_clients", "graha_contacts"])
async def test_every_graha_join_carries_org_id(marker):
    """A join on the id alone can print another practice's client name.

    The foreign key on `graha_clients` is on `id` and nothing else, so
    `ON cl.id = o.client_id` will happily match a row belonging to a different
    org if the id is ever wrong. Every such ON clause must also carry org_id,
    and it is cheap to prove by reading the SQL the handler actually built.
    """
    import services.skills.data.stock_and_crm as mod
    source = inspect.getsource(mod)
    for line in source.splitlines():
        if f"staging.{marker}" in line and "JOIN" in line:
            # The ON clause is the next line in every case; check the window.
            idx = source.splitlines().index(line)
            window = " ".join(source.splitlines()[idx:idx + 3])
            assert "org_id" in window, (
                f"a join to staging.{marker} does not carry org_id:\n{window}"
            )


# ══════════════════════════════════════════════════════════════════════════
# 1 · check_impossible_stock
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_negative_balance_is_always_confirmed():
    """You cannot hold minus three of a thing. Nothing grades that down."""
    pool = _Pool(
        stock_rows_q=[_stock(product_name="Statutory Audit", is_service=True,
                             on_hand=-3.0, ledger_net=-3.0, outbound=-3.0,
                             moves=2, lowest_running=-3.0)],
        stock_coverage_q=[_stock_coverage()],
    )
    out = await check_impossible_stock(pool, ORG)

    neg = [f for f in out["findings"] if f["check"] == "negative_on_hand"]
    assert len(neg) == 1
    assert neg[0]["confidence"] == "confirmed"
    assert neg[0]["on_hand"] == -3.0
    assert out["counts"]["negative_on_hand"] == 1


@pytest.mark.asyncio
async def test_a_ledger_that_cannot_explain_the_balance_grades_unverified():
    """The live shape: 269 on hand against a ledger summing to −16.

    The ledger dives negative because it starts at zero for stock that was
    loaded straight onto the balance. Reporting that as a confirmed shortage
    would send somebody to count a shelf that is full.
    """
    pool = _Pool(
        stock_rows_q=[_stock(product_name="Envelope A4 (100)", on_hand=269.0,
                             ledger_net=-16.0, outbound=-16.0, inbound=None,
                             moves=4, lowest_running=-16.0,
                             first_negative_date=__import__("datetime").date(2026, 6, 19))],
        stock_coverage_q=[_stock_coverage()],
    )
    out = await check_impossible_stock(pool, ORG)

    dips = [f for f in out["findings"] if f["check"] == "went_negative"]
    assert dips and dips[0]["confidence"] == "unverified"
    assert dips[0]["implied_opening_balance"] == 285.0
    assert dips[0]["movement_ledger_explains_the_balance"] is False
    # The balance must travel with the finding, or the reader corrects a
    # balance that was never wrong.
    assert "269" in dips[0]["detail"]
    assert out["counts"]["confirmed"] == 0
    assert out["counts"]["unverified"] == len(out["findings"])


@pytest.mark.asyncio
async def test_a_complete_ledger_that_dips_is_confirmed():
    """Balance −3, ledger −3: nothing innocent is left to explain it."""
    pool = _Pool(
        stock_rows_q=[_stock(on_hand=-3.0, ledger_net=-3.0, outbound=-3.0,
                             moves=2, lowest_running=-3.0,
                             first_negative_date=__import__("datetime").date(2026, 8, 3))],
        stock_coverage_q=[_stock_coverage()],
    )
    out = await check_impossible_stock(pool, ORG)
    dips = [f for f in out["findings"] if f["check"] == "went_negative"]
    assert dips and dips[0]["confidence"] == "confirmed"
    assert "confirmed" in dips[0]["detail"].lower()


@pytest.mark.asyncio
async def test_it_makes_no_valuation_claim():
    """`cost_price` is TODAY's cost and orders snapshot none. So: no value.

    The fourth check somebody always suggests — "items with movement but no
    valuation" — cannot be built on this data, and the count that stands in for
    it must not be allowed to read as one.
    """
    pool = _Pool(stock_rows_q=[], stock_coverage_q=[_stock_coverage()])
    out = await check_impossible_stock(pool, ORG)

    joined = " ".join(out["not_checked"]).lower()
    assert "data-completeness" in joined
    assert "not a valuation" in joined
    # The disclaimer is allowed to say "valuation". The findings are not
    # allowed to imply one, so only the findings are scanned.
    body = _claims(out)
    for forbidden in ("stock value", "valuation", "worth ", "closing value",
                      "cost of ", "rupee value"):
        assert forbidden not in body, f"a finding implies a valuation: {forbidden!r}"


@pytest.mark.asyncio
async def test_it_never_says_it_fixed_anything():
    """This is a check. It corrects nothing, and must never imply it did.

    A negative quantity is evidence of a write that went wrong; zeroing it — or
    saying it was zeroed — destroys the only trace of the thing somebody has to
    investigate.
    """
    pool = _Pool(
        stock_rows_q=[_stock(on_hand=-3.0, ledger_net=-3.0, outbound=-3.0,
                             moves=2, lowest_running=-3.0)],
        stock_coverage_q=[_stock_coverage()],
    )
    out = await check_impossible_stock(pool, ORG)
    # The headline is allowed — and required — to say nothing was corrected.
    assert "has been corrected" in out["what_this_is"].lower()
    body = _claims(out)
    for claim in ("corrected", "has been reset", "we have adjusted",
                  "set to zero", "written back", "we fixed"):
        assert claim not in body, f"a finding claims a write: {claim!r}"


@pytest.mark.asyncio
async def test_a_service_carrying_stock_is_named_as_such():
    """'Statutory Audit' at −3 is a SERVICE. The fix is on the product record.

    Sending somebody to the warehouse to count audits is a wasted afternoon,
    and it is exactly what a bare "negative stock" line would do.
    """
    pool = _Pool(
        stock_rows_q=[_stock(product_name="Statutory Audit", is_service=True,
                             on_hand=-3.0, ledger_net=-3.0, outbound=-3.0,
                             moves=2, lowest_running=-3.0)],
        stock_coverage_q=[_stock_coverage()],
    )
    out = await check_impossible_stock(pool, ORG)
    caveats = " ".join(out["caveats"]).lower()
    assert "service" in caveats and "statutory audit" in caveats
    assert out["findings"][0]["is_service"] is True


@pytest.mark.asyncio
async def test_truncation_is_stated_and_the_counts_called_a_floor():
    """A covered fraction that reads as the whole is the worst failure here."""
    rows = [_stock(product_name=f"Item {i}", on_hand=-float(i + 1),
                   ledger_net=-float(i + 1), outbound=-float(i + 1), moves=1,
                   _total=57)
            for i in range(3)]
    pool = _Pool(stock_rows_q=rows, stock_coverage_q=[_stock_coverage()])
    out = await check_impossible_stock(pool, ORG, limit=3)

    caveats = " ".join(out["caveats"]).lower()
    assert "truncated" in caveats
    assert "57" in caveats
    assert "floor" in caveats


@pytest.mark.asyncio
async def test_a_nil_answer_says_it_looked():
    """An empty findings list must be distinguishable from a check that died."""
    pool = _Pool(stock_rows_q=[], stock_coverage_q=[_stock_coverage()])
    out = await check_impossible_stock(pool, ORG)
    assert out["findings"] == []
    assert "a finding, not a skipped check" in " ".join(out["caveats"]).lower()


# ══════════════════════════════════════════════════════════════════════════
# 2 · check_unfillable_orders
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_second_order_goes_short_and_the_first_does_not():
    """The whole reason this is not a duplicate of `find_low_stock`.

    Ten on hand, two orders of six. Each is fine on its own and a per-product
    low-stock alert sees nothing wrong. The second one cannot be picked, and
    only something that reads the order book in pick order can say so.
    """
    import datetime as _dt
    pool = _Pool(
        order_lines_q=[
            _line(order_number="SO-1", order_date=_dt.date(2026, 8, 1), qty=6.0,
                  on_hand=10.0, customer="Agarwal Textiles", _total=2),
            _line(order_number="SO-2", order_date=_dt.date(2026, 8, 5), qty=6.0,
                  on_hand=10.0, customer="Verma Textiles", _total=2),
        ],
        order_coverage_q=[_order_coverage(open_lines=2, lines_naming_a_product=2,
                                          open_orders=2)],
    )
    out = await check_unfillable_orders(pool, ORG)

    assert out["counts"]["short_after_others"] == 1
    assert out["counts"]["short_now"] == 0
    assert out["counts"]["fillable"] == 1

    lines = out["products"][0]["lines"]
    assert lines[0]["order"] == "SO-1" and lines[0]["verdict"] == "fillable"
    assert lines[1]["order"] == "SO-2"
    assert lines[1]["verdict"] == "short_after_others"
    assert lines[1]["short_by"] == 2.0
    # The customer is the point of the finding, and it is a NAME.
    assert lines[1]["customer"] == "Verma Textiles"


@pytest.mark.asyncio
async def test_a_line_is_never_charged_with_an_earlier_lines_deficit():
    """Two on hand, then orders of 5 and 2. The second is short by 2, not by 5.

    Once the running balance has gone negative, `qty - available` charges the
    later line with the earlier one's shortfall as well as its own. Live, a
    line for 2 units of 'Lead CRM' against an available of −3 reported itself
    short by 5, which reads as a bigger order than the customer placed.
    """
    import datetime as _dt
    pool = _Pool(
        order_lines_q=[
            _line(order_number="SO-1", order_date=_dt.date(2026, 8, 1), qty=5.0,
                  on_hand=2.0, _total=2),
            _line(order_number="SO-2", order_date=_dt.date(2026, 8, 5), qty=2.0,
                  on_hand=2.0, _total=2),
        ],
        order_coverage_q=[_order_coverage(open_lines=2, lines_naming_a_product=2)],
    )
    out = await check_unfillable_orders(pool, ORG)
    lines = out["products"][0]["lines"]
    assert lines[0]["short_by"] == 3.0          # 5 wanted, 2 on hand
    assert lines[1]["short_by"] == 2.0          # its own 2, not 2 − (−3)
    assert lines[1]["quantity_ordered"] == 2.0
    # The product-level shortfall still carries the whole hole.
    assert out["products"][0]["shortfall_after_all_open_orders"] == -5.0


@pytest.mark.asyncio
async def test_a_line_bigger_than_the_whole_balance_is_short_now():
    """Short on its own account, not because of the queue. Different fix."""
    pool = _Pool(
        order_lines_q=[_line(qty=12.0, on_hand=10.0)],
        order_coverage_q=[_order_coverage()],
    )
    out = await check_unfillable_orders(pool, ORG)
    assert out["counts"]["short_now"] == 1
    assert out["counts"]["short_after_others"] == 0


@pytest.mark.asyncio
async def test_a_line_already_deducted_is_not_counted_twice():
    """Confirming an order deducts its stock. Counting it again invents a hole.

    Live, only two of 114 confirmed orders carry the deduction — the rest were
    seeded straight into the table — so neither assumption is safe and the
    movement record decides per line.
    """
    pool = _Pool(
        order_lines_q=[
            _line(order_number="SO-1", status="confirmed", qty=8.0, on_hand=10.0,
                  deduction_recorded=True, _total=2),
            _line(order_number="SO-2", status="confirmed", qty=8.0, on_hand=10.0,
                  deduction_recorded=False, _total=2),
        ],
        order_coverage_q=[_order_coverage(open_lines=2, lines_naming_a_product=2)],
    )
    out = await check_unfillable_orders(pool, ORG)

    assert out["excluded"]["lines_whose_stock_is_already_deducted"] == 1
    assert out["counts"]["order_lines_examined"] == 1
    # Only SO-2 remains, 8 against 10 on hand, so nothing is short.
    assert out["products"] == []
    assert out["counts"]["short_now"] == 0


@pytest.mark.asyncio
async def test_a_check_that_could_not_look_never_reads_as_clean():
    """The load-bearing test in this file.

    On the seeded e2e org all 176 open lines carry `"product_id": ""`, so this
    check can see none of them. Coming back with an empty list and a cheerful
    silence would tell a firm their order book is fine when it was never
    examined.
    """
    pool = _Pool(
        order_lines_q=[],
        order_coverage_q=[_order_coverage(open_lines=176, lines_naming_a_product=0,
                                          open_orders=169)],
    )
    out = await check_unfillable_orders(pool, ORG)

    caveats = " ".join(out["caveats"]).lower()
    assert "not a clean bill of health" in caveats
    assert "176" in caveats
    assert "could not look" in caveats
    assert out["coverage"]["lines_this_check_cannot_see"] == 176


@pytest.mark.asyncio
async def test_partial_coverage_is_stated_as_a_percentage_and_a_floor():
    """Seeing 13 of 189 lines and saying nothing is the same failure, smaller."""
    pool = _Pool(
        order_lines_q=[_line(qty=12.0, on_hand=0.0)],
        order_coverage_q=[_order_coverage(open_lines=189, lines_naming_a_product=13,
                                          open_orders=170)],
    )
    out = await check_unfillable_orders(pool, ORG)
    caveats = " ".join(out["caveats"]).lower()
    assert "incomplete" in caveats
    assert "176" in caveats          # 189 − 13, the lines it cannot see
    assert "floor" in caveats


@pytest.mark.asyncio
async def test_a_product_with_no_stock_record_is_treated_as_zero_and_said_so():
    """Zero is what the stock screen shows, so the check must match it.

    But "never set up" and "none left" are different problems with different
    fixes, and the output has to leave room for both.
    """
    pool = _Pool(
        order_lines_q=[_line(product_name="Lead CRM", qty=5.0, on_hand=0.0,
                             has_stock_row=False)],
        order_coverage_q=[_order_coverage()],
    )
    out = await check_unfillable_orders(pool, ORG)
    caveats = " ".join(out["caveats"]).lower()
    assert "no stock record" in caveats and "lead crm" in caveats
    assert out["products"][0]["stock_record_exists"] is False


@pytest.mark.asyncio
async def test_both_quantity_spellings_are_read():
    """`quantity` and `qty` are both live, and reading one loses the other.

    200 of the 226 open lines on the seeded org spell it `qty`; the current
    write path spells it `quantity`. The SQL must COALESCE both, which is
    cheapest to prove by reading the statement the handler built.
    """
    pool = _Pool(order_lines_q=[], order_coverage_q=[_order_coverage()])
    await check_unfillable_orders(pool, ORG)
    sql = _sql_for(pool, "WITH line AS")
    assert "'quantity'" in sql and "'qty'" in sql


@pytest.mark.asyncio
async def test_only_unfulfilled_statuses_are_treated_as_open():
    """Dispatched and delivered goods have left. Counting them is double work."""
    assert set(OPEN_ORDER_STATUSES) == {"draft", "confirmed"}
    for gone in ("dispatched", "delivered", "closed", "cancelled"):
        assert gone not in OPEN_ORDER_STATUSES


@pytest.mark.asyncio
async def test_no_id_ever_reaches_the_output():
    """Names, not ids — for the customer and for everything else."""
    pool = _Pool(
        order_lines_q=[_line(qty=12.0, on_hand=1.0)],
        order_coverage_q=[_order_coverage()],
    )
    out = await check_unfillable_orders(pool, ORG)
    assert not UUID_RX.search(json.dumps(out, default=str))


# ══════════════════════════════════════════════════════════════════════════
# 3 · check_stale_retainer_rates
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_default_everywhere_is_not_a_preference_the_firm_expressed():
    """The correction to this skill's own argument.

    `renewal_reminder_days` defaults to 30, both editing screens pre-fill 30,
    and all 63 live rows still read 30. So the column records OUR default. A
    skill that said "we reminded you when you asked to be reminded" would be
    inventing the request.
    """
    pool = _Pool(
        contracts_q=[_contract()],
        reminder_q=[{"days": 30, "n": 63}],
        recurring_q=[],
    )
    out = await check_stale_retainer_rates(pool, ORG)

    block = out["reminder_window_is_configured"]
    assert block["the_firm_has_set_this"] is False
    assert block["distribution"] == {30: 63}
    note = block["note"].lower()
    assert "default" in note
    assert "not a window the firm chose" in note


@pytest.mark.asyncio
async def test_an_org_with_no_engagements_is_not_told_off_about_its_defaults():
    """The third state, found by running this against the live second org.

    With no contract rows at all the distribution is empty, and the "every row
    reads 30" note then describes rows that do not exist — which reads as a
    claim that the firm has engagements and has not configured them.
    """
    pool = _Pool(contracts_q=[], reminder_q=[], recurring_q=[])
    out = await check_stale_retainer_rates(pool, ORG)
    note = out["reminder_window_is_configured"]["note"].lower()
    assert "no engagement records exist" in note
    assert "default" not in note


@pytest.mark.asyncio
async def test_a_firm_that_did_set_it_is_credited_with_having_set_it():
    """The other side of the same fact: honour a real choice when there is one."""
    pool = _Pool(
        contracts_q=[_contract(renewal_reminder_days=90, days_to_end=85)],
        reminder_q=[{"days": 30, "n": 40}, {"days": 90, "n": 7}],
        recurring_q=[],
    )
    out = await check_stale_retainer_rates(pool, ORG)
    block = out["reminder_window_is_configured"]
    assert block["the_firm_has_set_this"] is True
    assert "their own choice" in block["note"].lower()
    # 85 days out is beyond the 60-day horizon but inside their 90-day window,
    # which is the whole reason the column is read at all.
    assert "in_the_firms_reminder_window" in out["contracts"][0]["reasons"]
    assert "expiring_soon" not in out["contracts"][0]["reasons"]


@pytest.mark.asyncio
async def test_a_status_that_contradicts_its_own_dates_is_called_out():
    """Ten live rows say 'expired' against an end date of 2027-03-31.

    Until the two agree, no renewal reminder built on either can be relied on —
    which makes this finding a precondition for the rest of the report, not a
    footnote to it.
    """
    pool = _Pool(
        contracts_q=[_contract(status="expired", days_to_end=223,
                               end_date=__import__("datetime").date(2027, 3, 31))],
        reminder_q=[{"days": 30, "n": 63}],
        recurring_q=[],
    )
    out = await check_stale_retainer_rates(pool, ORG)

    row = out["contracts"][0]
    assert "status_contradicts_dates" in row["reasons"]
    assert "expired" in row["contradiction"]
    assert out["counts"]["status_contradicts_dates"] == 1
    assert "contradicts" in " ".join(out["caveats"]).lower()


@pytest.mark.asyncio
async def test_an_in_force_contract_with_no_end_date_is_a_finding():
    """Nothing will ever prompt a review of a fee with no end date."""
    pool = _Pool(
        contracts_q=[_contract(end_date=None, days_to_end=None)],
        reminder_q=[{"days": 30, "n": 63}],
        recurring_q=[],
    )
    out = await check_stale_retainer_rates(pool, ORG)
    assert "no end date" in out["contracts"][0]["contradiction"].lower()


@pytest.mark.asyncio
async def test_staleness_comes_from_the_query_not_from_re_derivation():
    """`updated_at::date` has already lost the time; re-deriving disagrees.

    A row admitted by the SQL's timestamp comparison but rejected by a Python
    date comparison would appear on the list with no reason attached, which is
    worse than either answer on its own.
    """
    pool = _Pool(
        contracts_q=[_contract(unchanged_too_long=True, days_to_end=400,
                               end_date=__import__("datetime").date(2027, 9, 30))],
        reminder_q=[{"days": 30, "n": 63}],
        recurring_q=[],
    )
    out = await check_stale_retainer_rates(pool, ORG)
    assert out["contracts"][0]["reasons"] == ["unchanged_too_long"]
    assert out["counts"]["unchanged_too_long"] == 1
    sql = _sql_for(pool, "staging.ganit_contracts k")
    assert "AS unchanged_too_long" in sql


@pytest.mark.asyncio
async def test_it_admits_there_is_no_rate_history_anywhere():
    """The claim this skill is not allowed to make.

    'The fee has not been revised' is not knowable. `ganit_contracts` has only
    `updated_at`, which any edit resets, and `ganit_recurring` has no edit
    column at all.
    """
    pool = _Pool(
        contracts_q=[_contract()],
        reminder_q=[{"days": 30, "n": 63}],
        recurring_q=[_profile()],
    )
    out = await check_stale_retainer_rates(pool, ORG)

    limitations = " ".join(out["limitations"]).lower()
    assert "no rate history" in limitations
    assert "no `updated_at` column" in limitations
    # And the profile row repeats it where the reader is actually looking.
    assert "no edit date" in out["recurring_profiles"][0]["detail"].lower()


@pytest.mark.asyncio
async def test_the_only_fee_evidence_is_what_was_actually_billed():
    """One distinct amount across eighteen invoices: the fee has never moved.

    Evidence, not proof — and it is the only thing in the system that speaks to
    a fee revision at all, so it is reported rather than inferred from.
    """
    pool = _Pool(
        contracts_q=[],
        reminder_q=[{"days": 30, "n": 63}],
        recurring_q=[_profile(invoices_raised=18, distinct_amounts_billed=1)],
    )
    out = await check_stale_retainer_rates(pool, ORG)
    row = out["recurring_profiles"][0]
    assert row["invoices_raised"] == 18
    assert row["distinct_amounts_billed"] == 1
    assert row["client"] == "Gokul Dairy Foods Pvt Ltd"


@pytest.mark.asyncio
async def test_esign_is_not_offered_as_a_mobile_step():
    """eSign is web-only and is not a mobile destination."""
    pool = _Pool(contracts_q=[_contract()], reminder_q=[{"days": 30, "n": 63}],
                 recurring_q=[])
    out = await check_stale_retainer_rates(pool, ORG)
    assert "web-only" in out["what_this_is"].lower()
    body = _text(out)
    assert "on your phone" not in body and "in the app" not in body


@pytest.mark.asyncio
async def test_a_nil_answer_states_both_windows():
    """No findings must name the windows it looked through, or it means nothing."""
    pool = _Pool(contracts_q=[], reminder_q=[], recurring_q=[])
    out = await check_stale_retainer_rates(pool, ORG, horizon_days=45,
                                           stale_months=6)
    caveats = " ".join(out["caveats"]).lower()
    assert "45 days" in caveats and "6 months" in caveats
    assert "a finding, not a skipped check" in caveats


@pytest.mark.asyncio
async def test_no_id_reaches_the_engagement_output_either():
    pool = _Pool(contracts_q=[_contract()], reminder_q=[{"days": 30, "n": 63}],
                 recurring_q=[_profile()])
    out = await check_stale_retainer_rates(pool, ORG)
    assert not UUID_RX.search(json.dumps(out, default=str))
