"""Slab bands, a scheme's scope, two schemes at once, a bonus, and the
statutory switches — the owner's four messages of 2026-08-21, and the mistakes
each of them invites.

WHAT IS BEING PINNED HERE, IN ONE SENTENCE EACH
───────────────────────────────────────────────
  · A BAND PAYS ON ITS OWN PORTION. "3% from 1L to 5L ... 3.75% 5L to 7.5L and
    so on" — the owner's words, and a decision, not a setting. The other
    reading of the same English pays nearly double, so every test that looks
    like it is about arithmetic is about which cheque somebody receives.
  · A SCHEME HAS A SCOPE. The same 3% on a person's own invoices and on their
    whole department's are wildly different amounts. Teams ARE departments.
  · TWO SCHEMES AT ONCE. A monthly-own and an annual-department arrangement
    are both current and both pay, over different windows and different
    revenue. The failure mode is silent: a resolver that returns "the" scheme
    drops one and nothing anywhere is red.
  · ROW ORDER MUST NEVER REACH THE MONEY. Bands arriving 7.5/3/4 pay exactly
    what bands arriving 3/4/7.5 pay, and two bands at one threshold are
    refused rather than resolved.
  · AN ABSENCE IS NOT A ZERO. No bonus awarded is not a ₹0 bonus; a
    department nobody has set is not ₹0 of departmental revenue; a commission
    that cannot be computed writes no payslip line rather than a ₹0.00 one.
  · NOTHING BLOCKS A RUN, AND THE PAYSLIP SAYS WHAT IT DID. An unanswered
    statutory flag is read at a stated default and the payslip records that it
    was, so a checkbox ticked in March cannot restate January.

Every figure is written out in full and checked by hand in the docstring that
asserts it, because a slab test that only compares the code against itself
proves nothing about what anybody is paid.

Nothing in this file touches a database. The migration assertions read the
migration FILE, so they test the SQL that will be applied rather than a
constant somebody wrote to agree with Python.
"""
from __future__ import annotations

import ast
import inspect
import re
import textwrap
from datetime import date
from decimal import Decimal

import pytest

from services import commission as C
from services.report_defs import commission_reports as CR

MIGRATION = "migrations/190_commission_slabs_and_bonus.sql"

#: A Friday, mid-quarter, mid-financial-year. Absolute, like every other date
#: in these suites: a test that computes its own "today" fails one morning in
#: CI for no reason and passes again by lunchtime.
ANCHOR = date(2026, 8, 21)

#: The owner's own ladder, in his own numbers: "3% on 1lakh above and 4% 5
#: above 7.5% above 10lakh".
OWNERS_LADDER = ((Decimal("100000"), Decimal("3")),
                 (Decimal("500000"), Decimal("4")),
                 (Decimal("1000000"), Decimal("7.5")))

#: And the rung he added when he explained the reading: "company can add more
#: threshold 3.75% 5L to 7.5L and so on". Proof that nothing caps the ladder.
EXTENDED_LADDER = ((Decimal("100000"), Decimal("3")),
                   (Decimal("500000"), Decimal("3.75")),
                   (Decimal("750000"), Decimal("4")),
                   (Decimal("1000000"), Decimal("7.5")))


def scheme(**over) -> C.Scheme:
    kw = dict(eligible=True, basis="turnover", period="monthly",
              revenue_scope="own", bands=OWNERS_LADDER,
              effective_from=date(2026, 4, 1), effective_to=None)
    kw.update(over)
    return C.Scheme(**kw)


def turnover(amount) -> C.Figures:
    """Turnover known, cost not — the shape every live figure has today."""
    return C.figures(Decimal(amount), None, cost_reason=C.NOT_RECORDED)


def migration_sql() -> str:
    return open(MIGRATION, encoding="utf-8").read()


def migration_ddl() -> str:
    """The migration with its comments stripped.

    The header ARGUES the design and prints a full rollback script — `UPDATE`,
    `DROP`, `DELETE` and all — inside `--` comments. A scan for dangerous
    statements that read the whole file would fire on the explanation rather
    than on the SQL.
    """
    return "\n".join(re.sub(r"--.*$", "", line)
                     for line in migration_sql().splitlines())


def vetana():
    return __import__("routers.vetana", fromlist=["x"])


def code_only(obj) -> str:
    """An object's source with every comment and docstring removed.

    The scans below are about what the code READS, and this file, like the
    modules it scans, argues its decisions at length in prose — including by
    naming the things it deliberately does not read. A scan over raw source
    would fire on the explanation and would then be loosened until it stopped,
    which is how a ratchet becomes decoration.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(obj)))
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list) or not body:
            continue
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                 ast.AsyncFunctionDef)):
            continue
        first = body[0]
        if (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            body.pop(0)
            if not body:
                body.append(ast.Pass())
    return ast.unparse(ast.fix_missing_locations(tree))


def bonus_awards_ddl() -> str:
    """Just the CREATE TABLE for the awards, without the COMMENTs that discuss
    it. A COMMENT explaining why there is no payslip_id contains the words
    "payslip_id", and a scan that read it would conclude the opposite."""
    ddl = migration_ddl()
    start = ddl.index("CREATE TABLE IF NOT EXISTS staging.manav_bonus_awards")
    return ddl[start:ddl.index(");", start)]


# ══════════════════════════════════════════════════════════════════════════
# 1 · the ladder, worked by hand
# ══════════════════════════════════════════════════════════════════════════

def test_the_owners_ladder_pays_47000_and_not_90000():
    """₹12,00,000 against 3% from ₹1L, 4% from ₹5L, 7.5% from ₹10L.

        first  ₹1,00,000               earns nothing
        ₹1L → ₹5L   = ₹4,00,000 at 3%      = ₹12,000
        ₹5L → ₹10L  = ₹5,00,000 at 4%      = ₹20,000
        above ₹10L  = ₹2,00,000 at 7.5%    = ₹15,000
                                             ───────
                                             ₹47,000

    The other reading of the same English — you land in the 7.5% band and 7.5%
    applies to everything — pays ₹90,000. The owner settled it on 2026-08-21
    ("3% from 1L to 5L"), so ₹90,000 must be unreachable: there is no setting
    that produces it and no branch that computes it.
    """
    due = C.commission_due(scheme(), turnover("1200000"))
    assert due.amount == Decimal("47000.00")
    assert due.amount != Decimal("90000.00")
    # Everything above the entry rung earned something; the first lakh did not.
    assert due.commissionable == Decimal("1100000.00")
    assert due.top_rate_percent == Decimal("7.5")


def test_the_ladder_has_no_cap_on_how_many_rungs():
    """"and so on" — the owner. Adding a 3.75% rung from ₹5L to ₹7.5L must
    simply work, and must change the answer by exactly the arithmetic:

        ₹1L → ₹5L    = ₹4,00,000 at 3%      = ₹12,000
        ₹5L → ₹7.5L  = ₹2,50,000 at 3.75%   =  ₹9,375
        ₹7.5L → ₹10L = ₹2,50,000 at 4%      = ₹10,000
        above ₹10L   = ₹2,00,000 at 7.5%    = ₹15,000
                                              ───────
                                              ₹46,375
    """
    due = C.commission_due(scheme(bands=EXTENDED_LADDER), turnover("1200000"))
    assert due.amount == Decimal("46375.00")
    assert len(scheme(bands=EXTENDED_LADDER).bands) == 4


def test_a_boundary_belongs_to_the_band_that_starts_there():
    """"4% from ₹5 lakh" includes ₹5 lakh. At exactly ₹5,00,000 the 3% band has
    paid ₹12,000 on ₹1L–₹5L and the 4% band's slice is empty, so the answer is
    ₹12,000 — and `threshold_met` is True, because the rung WAS reached."""
    due = C.commission_due(scheme(), turnover("500000"))
    assert due.amount == Decimal("12000.00")
    assert due.threshold_met is True


def test_below_the_lowest_rung_is_a_real_zero():
    """₹90,000 against a ladder that starts at ₹1,00,000. This is the one zero
    the page may print: it is an ANSWER, and the person can check it."""
    due = C.commission_due(scheme(), turnover("90000"))
    assert due.amount == Decimal("0.00")
    assert due.threshold_met is False
    assert due.reason == ""
    assert due.computable is True


def test_bands_out_of_order_compute_exactly_the_same_figure():
    """THE ROW-ORDER TEST. A ladder handed over highest-first, or shuffled, must
    pay what the same ladder handed over lowest-first pays. There is no order in
    a table, so an answer that depends on one changes between two runs of the
    same report."""
    shuffled = (OWNERS_LADDER[2], OWNERS_LADDER[0], OWNERS_LADDER[1])
    reversed_ = tuple(reversed(OWNERS_LADDER))
    f = turnover("1200000")
    baseline = C.commission_due(scheme(), f)
    for order in (shuffled, reversed_):
        assert C.commission_due(scheme(bands=order), f) == baseline
    # …and the ladder is normalised on the way in, so what is stored and what
    # is printed are lowest-first however it arrived.
    assert [b.from_amount for b in scheme(bands=shuffled).bands] == \
        [Decimal("100000"), Decimal("500000"), Decimal("1000000")]


def test_two_bands_at_one_threshold_are_refused_rather_than_resolved():
    """Two rows both saying "from ₹5,00,000", one at 4% and one at 6%. Which
    pays would depend on which was read first. The database refuses it
    (manav_commission_bands_one_per_threshold_uniq) and so does this, so a
    caller assembling bands by hand cannot produce a figure the database would
    never have stored."""
    with pytest.raises(ValueError, match="same amount"):
        scheme(bands=((Decimal("500000"), Decimal("4")),
                      (Decimal("500000"), Decimal("6"))))


def test_a_band_rate_must_be_stated_and_above_zero():
    """"The first lakh earns nothing" is said by the lowest band starting AT one
    lakh — not by a 0% band, which is the same fact stated twice."""
    with pytest.raises(ValueError, match="above zero"):
        scheme(bands=((Decimal("0"), Decimal("0")),))
    with pytest.raises(ValueError, match="pays more than was sold"):
        scheme(bands=((Decimal("0"), Decimal("120")),))


def test_rounding_happens_once_at_the_end_and_not_band_by_band():
    """Two slices of ₹100 at 0.125% are ₹0.125 each.

    Rounded band by band they are ₹0.13 + ₹0.13 = ₹0.26. Accumulated exactly
    and rounded once they are ₹0.25. The second is right, and the first is a
    figure the person cannot reproduce from the rates on their own payslip.
    """
    due = C.commission_due(
        scheme(bands=((Decimal("0"), Decimal("0.125")),
                      (Decimal("100"), Decimal("0.125")))), turnover("200"))
    assert due.amount == Decimal("0.25")
    assert due.amount != Decimal("0.26")


def test_a_single_band_is_the_old_flat_arrangement_unchanged():
    """Migration 185 stored one rate over one threshold. That is a one-band
    ladder and pays exactly what it always paid: 5% of the ₹2L above a ₹10L
    threshold on ₹12L = ₹10,000. The superseded columns are not read, so there
    is no second code path to drift."""
    flat = scheme(bands=((Decimal("1000000"), Decimal("5")),))
    assert C.commission_due(flat, turnover("1200000")).amount == Decimal("10000.00")
    src = inspect.getsource(C.from_row)
    for superseded in ("rate_percent", "threshold_amount", "threshold_mode"):
        assert f'row["{superseded}"]' not in src, \
            f"from_row still reads the superseded {superseded}"


def test_a_negative_period_reaches_no_rung_and_never_pays_backwards():
    """A period whose credit notes exceed its invoices. Recovering an
    overpayment is an employment decision with notice periods behind it, not
    arithmetic, and a negative number invites something downstream to pay it."""
    due = C.commission_due(scheme(bands=((Decimal("0"), Decimal("5")),)),
                           turnover("-300000"))
    assert due.amount == Decimal("0.00")
    assert due.amount >= 0


# ══════════════════════════════════════════════════════════════════════════
# 2 · an eligible scheme with no terms stays impossible
# ══════════════════════════════════════════════════════════════════════════

def test_an_eligible_scheme_with_no_bands_is_refused():
    """MIGRATION 189'S PROPERTY, WHICH BANDS MUST NOT QUIETLY REMOVE.

    Eligible with no terms reads on every screen as "this person is on
    commission", computes a plausible ₹0 every period, and owes somebody money
    nobody can see. 189 made it unstorable with a row CHECK; the terms now live
    in a child table, so migration 190 moves the rule to a deferred trigger and
    this constructor enforces the same thing.
    """
    with pytest.raises(ValueError, match="no terms"):
        scheme(bands=())


def test_an_eligible_scheme_must_say_whose_revenue_it_measures():
    """There is no default scope for the same reason there is no default rate:
    a person's own sales and their whole department's are different amounts of
    money, and the owner said the firm decides its own commission."""
    with pytest.raises(ValueError, match="WHOSE REVENUE"):
        scheme(revenue_scope=None)


def test_an_ineligible_scheme_may_state_nothing_at_all():
    """"Not on commission" is a RECORDED fact and must be recordable without
    inventing terms or a scope for it. Different from no scheme at all, which
    is a question for HR."""
    off = C.Scheme(eligible=False, basis="turnover", period="monthly",
                   effective_from=date(2026, 4, 1))
    due = C.commission_due(off, turnover("5000000"))
    assert due.reason == C.NOT_ON_COMMISSION
    assert due.amount is None


# ══════════════════════════════════════════════════════════════════════════
# 3 · whose revenue — own, or the department's
# ══════════════════════════════════════════════════════════════════════════

def test_the_scope_is_a_property_of_the_scheme_and_never_inferred():
    assert scheme(revenue_scope="department").measures_department is True
    assert scheme(revenue_scope="own").measures_department is False
    with pytest.raises(ValueError, match="revenue_scope"):
        scheme(revenue_scope="reporting_line")


def test_a_department_scoped_scheme_with_no_department_says_so_not_zero():
    """THE ONE REFUSAL THAT MATTERS HERE. 11 of 98 live employees have no
    department. Paying a team leader ₹0 because nobody filled in a column would
    be indistinguishable from their department having sold nothing, and it is
    the failure this product keeps almost making."""
    unresolvable = C.figures(None, None,
                             turnover_reason=C.DEPARTMENT_NOT_SET,
                             cost_reason=C.DEPARTMENT_NOT_SET)
    due = C.commission_due(scheme(revenue_scope="department"), unresolvable)
    assert due.amount is None
    assert due.reason == C.DEPARTMENT_NOT_SET
    assert C.DEPARTMENT_NOT_SET in C.REASONS
    # And it is a WORD in the cell, never a number.
    assert C.cell(due.amount, due.reason) == C.DEPARTMENT_NOT_SET


def test_team_means_department_and_nothing_reads_the_reporting_line():
    """The owner: "but yes teams is department". `reporting_to` exists on the
    employee table and is filled on 0 of 98 rows; it is not filled, not read
    and not dropped."""
    for module in (C, CR, vetana()):
        assert "reporting_to" not in code_only(module), \
            f"{module.__name__} reads reporting_to — teams are departments"


# ══════════════════════════════════════════════════════════════════════════
# 4 · monthly AND yearly, both paying
# ══════════════════════════════════════════════════════════════════════════

#: The owner's example as two rows: "if person is leading a team he gets his
#: own of what he do but he gets yearly commission on total GP of his team".
MONTHLY_OWN = dict(period="monthly", revenue_scope="own",
                   bands=((Decimal("500000"), Decimal("3")),))
ANNUAL_TEAM = dict(period="annual", revenue_scope="department",
                   basis="gross_profit",
                   bands=((Decimal("2000000"), Decimal("2")),))


def test_a_person_on_a_monthly_own_and_an_annual_team_scheme_is_paid_by_both():
    """₹8,00,000 of their own in the month: 3% of the ₹3L above ₹5L = ₹9,000.
    ₹30,00,000 of departmental gross profit over the year: 2% of the ₹10L above
    ₹20L = ₹20,000. Two arrangements, two windows, two sets of revenue, two
    payments — and not a penny of double counting, because each is computed
    over its own period and each period ends exactly once."""
    monthly, annual = scheme(**MONTHLY_OWN), scheme(**ANNUAL_TEAM)

    live = C.schemes_in_force([monthly, annual], date(2026, 8, 31))
    assert len(live) == 2, "one of the two arrangements was dropped"
    assert {s.period for s in live} == {"monthly", "annual"}
    assert {s.revenue_scope for s in live} == {"own", "department"}

    assert C.commission_due(monthly, turnover("800000")).amount == Decimal("9000.00")
    dept_gp = C.figures(Decimal("5000000"), Decimal("2000000"))
    assert dept_gp.gross_profit == Decimal("3000000.00")
    assert C.commission_due(annual, dept_gp).amount == Decimal("20000.00")


def test_the_single_scheme_resolver_would_have_dropped_one_of_them():
    """Stated as a test rather than a comment, because this is exactly the
    silent failure the plural resolver exists to prevent: `scheme_in_force`
    returns ONE arrangement, and with two current schemes one of them — and
    somebody's cheque — simply disappears."""
    both = [scheme(**MONTHLY_OWN), scheme(**ANNUAL_TEAM)]
    assert C.scheme_in_force(both, date(2026, 8, 31)) is not None
    assert len(C.schemes_in_force(both, date(2026, 8, 31))) == 2


def test_each_scheme_is_paid_in_the_month_its_own_period_ends():
    """Payroll runs monthly and a scheme settles monthly, quarterly or
    annually, so a scheme is paid in the payroll month whose last day IS the
    last day of its settlement period. In March a person on both is paid twice,
    over two different windows. In August, only the monthly one."""
    august, march = date(2026, 8, 31), date(2027, 3, 31)
    assert C.settles_on("monthly", august) is True
    assert C.settles_on("annual", august) is False
    assert C.settles_on("quarterly", august) is False       # Q2 ends 30 Sept
    assert C.settles_on("quarterly", date(2026, 9, 30)) is True
    assert C.settles_on("monthly", march) is True
    assert C.settles_on("annual", march) is True


def test_a_mid_month_date_settles_nothing():
    """No settlement period ends in the middle of a month, and answering "yes"
    for a date that is not a month end would pay a commission over a window
    that has not closed."""
    for period in C.PERIODS:
        assert C.settles_on(period, ANCHOR) is False


def test_the_annual_period_is_financial_and_ends_in_march():
    """A calendar year would settle everybody's annual commission on 31
    December, three months out of step with the accounts and the TDS
    statements."""
    assert C.period_bounds("annual", date(2026, 8, 31)) == (date(2026, 4, 1),
                                                            date(2027, 3, 31))
    assert C.settles_on("annual", date(2026, 12, 31)) is False


def test_two_open_schemes_on_the_same_period_and_scope_are_still_the_mistake():
    """Relaxing the one-open-scheme rule must not relax it out of existence.
    Two current MONTHLY-OWN schemes make a person's rate depend on row order;
    `schemes_in_force` resolves that deterministically (latest effective_from
    wins) rather than by whichever arrived first, and the database refuses to
    store it at all."""
    old = scheme(**{**MONTHLY_OWN, "effective_from": date(2026, 4, 1)})
    new = scheme(**{**MONTHLY_OWN, "effective_from": date(2026, 7, 1),
                    "bands": ((Decimal("500000"), Decimal("6")),)})
    for order in ([old, new], [new, old]):
        live = C.schemes_in_force(order, date(2026, 8, 31))
        assert len(live) == 1
        assert live[0].effective_from == date(2026, 7, 1)


def test_commission_total_adds_schemes_but_never_counts_an_absence_as_zero():
    """A person on two schemes of which one is computable is paid the one that
    is; a person on two schemes of which neither is gets None — the question
    could not be answered — and NOT ₹0, which would say the ladders were
    reached and paid nothing."""
    both = [scheme(**MONTHLY_OWN), scheme(period="annual", revenue_scope="own",
                                          bands=((Decimal("2000000"),
                                                  Decimal("2")),))]
    assert C.commission_total(both, turnover("2000000")) == Decimal("45000.00")
    unknown = C.figures(None, None, turnover_reason=C.NOT_ATTRIBUTABLE,
                        cost_reason=C.NOT_RECORDED)
    assert C.commission_total(both, unknown) is None


# ══════════════════════════════════════════════════════════════════════════
# 5 · the consultant page
# ══════════════════════════════════════════════════════════════════════════

FULL_SPREAD = {"docs": 10, "docs_attributed": 10, "value": 5000000.0,
               "value_attributed": 5000000.0, "lines": 20, "lines_costed": 0,
               "employees_unlinked": 0}


def as_json(s: C.Scheme) -> dict:
    """One scheme in the shape PNL_SQL returns it — every money value as TEXT,
    which is what stops a rate reaching Python as a binary float."""
    return {
        "eligible": s.eligible, "basis": s.basis, "period": s.period,
        "revenue_scope": s.revenue_scope,
        "effective_from": s.effective_from.isoformat(),
        "effective_to": None if s.effective_to is None else s.effective_to.isoformat(),
        "bands": [{"from_amount": str(b.from_amount),
                   "rate_percent": str(b.rate_percent)} for b in s.bands],
    }


def person(schemes, **over) -> dict:
    p = {"person": "Anita Desai", "turnover": 1200000.0, "docs": 10,
         "cost": None, "lines_costed": 0, "has_employee": True,
         "department": "Audit", "dept_turnover": 5000000.0, "dept_docs": 40,
         "dept_cost": None, "dept_lines_costed": 0,
         "schemes": [as_json(s) for s in schemes]}
    p.update(over)
    return p


def test_the_page_prints_the_ladder_as_ranges_and_says_whose_revenue():
    """A "Rate %" column showing only 7.5 would be a smaller lie than a zero
    but a lie all the same: it is not the rate most of the money earned. And
    the floors alone ("3% from ₹1L") is the phrasing that produced the
    ambiguity in the first place, so the cell prints RANGES."""
    row = CR.build_pnl_rows([person([scheme()])], FULL_SPREAD,
                            date(2026, 8, 31), period_start=date(2026, 8, 1))[0]
    assert row["Commission"] == 47000.0
    assert row["Rate %"] == ("3% on ₹100,000.00–₹500,000.00; "
                             "4% on ₹500,000.00–₹1,000,000.00; "
                             "7.5% above ₹1,000,000.00")
    assert row["Commission basis"] == "Turnover — their own attributed revenue"
    assert row["Status"] == "Due"


def test_a_department_scoped_row_is_computed_on_the_departments_figures():
    """₹50,00,000 of departmental turnover, not the person's own ₹12,00,000.
    Same ladder, and the answer differs by ₹3,32,000 — which is why the scope
    is resolved once, explicitly, and never inferred."""
    dept = scheme(revenue_scope="department")
    row = CR.build_pnl_rows([person([dept])], FULL_SPREAD,
                            date(2026, 8, 31), period_start=date(2026, 8, 1))[0]
    # ₹1L–₹5L at 3% = 12,000; ₹5L–₹10L at 4% = 20,000;
    # ₹10L–₹50L = ₹40,00,000 at 7.5% = 3,00,000. Total ₹3,32,000.
    assert row["Commission"] == 332000.0
    assert "department" in row["Commission basis"]
    # The person's OWN turnover column is untouched by the scheme's scope.
    assert row["Turnover"] == 1200000.0


def test_a_department_scoped_row_with_no_department_prints_the_reason():
    """Never ₹0. The scheme is real and the ladder is real; the revenue it is
    measured on cannot be identified."""
    row = CR.build_pnl_rows([person([scheme(revenue_scope="department")],
                                    department=None)],
                            FULL_SPREAD, date(2026, 8, 31),
                            period_start=date(2026, 8, 1))[0]
    assert row["Commission"] == C.DEPARTMENT_NOT_SET
    assert row["Commission"] != 0 and row["Commission"] != 0.0


def test_a_person_on_two_schemes_has_both_listed_and_only_this_ones_paid():
    """The report window is one month. The monthly scheme settles over it and
    is paid; the annual one settles in March and is NAMED rather than added —
    applying both to one window would pay twice."""
    row = CR.build_pnl_rows(
        [person([scheme(**MONTHLY_OWN),
                 scheme(period="annual", revenue_scope="own",
                        bands=((Decimal("2000000"), Decimal("2")),))])],
        FULL_SPREAD, date(2026, 8, 31), period_start=date(2026, 8, 1))[0]
    # ₹12,00,000, 3% of the ₹7L above ₹5L = ₹21,000. The annual 2% is NOT in
    # this figure.
    assert row["Commission"] == 21000.0
    assert "annual" in row["Status"] and "separately" in row["Status"]
    assert "Monthly" in row["Settles"] and "Annual" in row["Settles"]


def test_a_window_that_settles_none_of_a_persons_schemes_prints_a_reason():
    """Not a zero. Zero would say the ladders were reached and paid nothing;
    the truth is that this window is not the period either is measured over."""
    row = CR.build_pnl_rows(
        [person([scheme(**MONTHLY_OWN),
                 scheme(period="annual", revenue_scope="own",
                        bands=((Decimal("2000000"), Decimal("2")),))])],
        FULL_SPREAD, ANCHOR, period_start=date(2026, 8, 1))[0]
    assert isinstance(row["Commission"], str)
    assert "none over this window" in row["Commission"]
    assert row["Commission"] != 0 and row["Commission"] != 0.0


def test_an_unattributed_person_with_a_ladder_still_says_not_attributable():
    """The live case for every person in the database. A recorded ladder does
    not make a turnover knowable, and it must not conjure a figure out of a SUM
    over zero attributed invoices."""
    spread = {**FULL_SPREAD, "docs_attributed": 0, "value_attributed": 0.0}
    row = CR.build_pnl_rows([person([scheme()], turnover=None)], spread,
                            date(2026, 8, 31), period_start=date(2026, 8, 1))[0]
    assert row["Turnover"] == C.NOT_ATTRIBUTABLE
    assert row["Commission"] == C.NOT_ATTRIBUTABLE


# ══════════════════════════════════════════════════════════════════════════
# 6 · the bonus
# ══════════════════════════════════════════════════════════════════════════

def test_a_bonus_with_no_award_is_nothing_rather_than_zero():
    """THE RULE, one level along from turnover. ₹0.00 under a bonus heading
    beside a person's name says they were considered and given nothing. When
    nobody has awarded anything, that sentence is false."""
    assert C.bonus_total([]) is None
    assert C.bonus_total(None) is None
    assert C.bonus_total([C.BonusAward(Decimal("5000"), "Diwali")]) \
        == Decimal("5000.00")


def test_two_awards_in_one_month_are_two_awards():
    """A festival bonus and a performance bonus in the same month are two real
    decisions with two reasons. There is deliberately no unique key on
    (employee, month) that would force one of them to be lost."""
    awards = [C.BonusAward(Decimal("5000"), "Diwali", "2026-10"),
              C.BonusAward(Decimal("12000"), "Closed the Sharma audit early",
                           "2026-10")]
    assert C.bonus_total(awards) == Decimal("17000.00")
    labels = [C.bonus_line_label(a) for a in awards]
    assert labels[0] == "Bonus — Diwali"
    assert len(set(labels)) == 2, "two awards must not share one payslip line"


def test_a_bonus_of_zero_is_refused_and_a_bonus_with_no_reason_is_refused():
    """A ₹0 bonus is an unfinished form. A discretionary payment with no stated
    reason cannot be audited, defended, or explained to the person who did not
    get one."""
    with pytest.raises(ValueError, match="not a bonus"):
        C.BonusAward(Decimal("0"), "Diwali")
    with pytest.raises(ValueError, match="say why"):
        C.BonusAward(Decimal("5000"), "   ")


def test_a_bonus_is_computed_from_nothing():
    """A rule about what the code may READ, not about what it returns: no
    turnover, no threshold, no rate, no band and no department may appear
    anywhere near a bonus."""
    src = code_only(C.BonusAward) + code_only(C.bonus_total)
    for forbidden in ("turnover", "threshold", "band", "rate_percent",
                      "department", "commission_due"):
        assert forbidden not in src, \
            f"the bonus reads {forbidden} — a bonus is a decision, not a figure"


# ══════════════════════════════════════════════════════════════════════════
# 7 · what reaches a payslip
# ══════════════════════════════════════════════════════════════════════════

def test_an_uncomputable_commission_writes_no_line_rather_than_a_zero_one():
    """A ₹0.00 beside the word "Commission" on a payslip says the person earned
    none. For every person in this database today the truth is that no invoice
    records who sold it. A missing line makes no claim; a zero makes a false
    one."""
    assert C.earning_line("Commission", None) is None
    assert C.earning_line("Commission", Decimal("0")) is None
    assert C.earning_line("Bonus", Decimal("0.004")) is None      # rounds to 0
    assert C.earning_line("Bonus", Decimal("5000")) == {
        "label": "Bonus", "amount": 5000.0}


def test_a_commission_line_names_the_period_it_was_earned_over():
    """A person on a monthly and an annual scheme sees TWO commission lines on
    their March payslip. Two lines both labelled "Commission" is a payslip that
    looks like a duplicate."""
    monthly = C.commission_line_label(scheme(**MONTHLY_OWN), date(2027, 3, 1),
                                      date(2027, 3, 31))
    annual = C.commission_line_label(scheme(**ANNUAL_TEAM), date(2026, 4, 1),
                                     date(2027, 3, 31))
    assert monthly != annual
    assert "monthly" in monthly and "2027-03-01" in monthly
    assert "annual" in annual and "2026-04-01" in annual


def test_payroll_adds_the_variable_earnings_to_gross_and_to_nothing_else():
    """WHAT THIS CHANGE DOES TO A PAYSLIP, pinned in the source.

    gross goes up by the total of the commission and bonus lines, net goes up
    by the same amount, and no deduction moves unless a firm has ticked one of
    the four base switches.
    """
    src = inspect.getsource(vetana())
    assert "gross = round(gross_fixed + variable_total, 2)" in src
    # The loan recovery floor stays on the FIXED salary, so a bonus can never
    # increase what is taken out of somebody's pay.
    assert "round(gross_fixed * _NET_PAY_FLOOR_PCT, 2)" in src
    assert "gross_fixed + reimbursement_total - statutory - floor" in src


def test_payroll_writes_other_earnings_and_adds_no_earnings_column():
    """`vetana_payslips.other_earnings` already exists and already carries
    arrears in this exact shape. `$N::text::jsonb`, because db.py registers a
    jsonb codec whose encoder IS json.dumps — binding an already-dumped string
    to a plain jsonb parameter encodes it twice and the column holds a JSON
    STRING, the defect that crashed Graha's Documents tab."""
    src = inspect.getsource(vetana())
    assert '"other_earnings" + treat_col' in src
    assert "$30::text::jsonb" in src
    assert "json.dumps(other_earnings)" in src
    # The ONLY column this migration adds to a payslip is the record of which
    # statutory treatment it was computed under. No earnings column: commission
    # and bonus are entries in the array that already exists.
    ddl = migration_ddl()
    payslip_alters = [ln.strip() for ln in ddl.splitlines()
                      if "ADD COLUMN" in ln
                      and "statutory_treatment" in ln]
    assert len(payslip_alters) == 1
    assert "ADD COLUMN IF NOT EXISTS other_earnings" not in ddl
    # Exactly ONE ALTER against the payslip table in the whole file, and its
    # column is the treatment record. Anything else would be an earnings
    # column, which this design does not need and must not grow.
    assert ddl.count("ALTER TABLE staging.vetana_payslips") == 1
    after = ddl[ddl.index("ALTER TABLE staging.vetana_payslips"):]
    assert "statutory_treatment jsonb" in after[:after.index(";")]


# ══════════════════════════════════════════════════════════════════════════
# 8 · the statutory switches — optional, and recorded
# ══════════════════════════════════════════════════════════════════════════

def structure(**over) -> dict:
    s = {"pf_enabled": True, "esi_enabled": False, "pt_applicable": True,
         "tds_regime": "new"}
    s.update(over)
    return s


def stat(basic=50000.0, gross=100000.0, commission=0.0, bonus=0.0, **flags):
    return vetana()._compute_statutory(basic, gross, structure(**flags),
                                       commission=commission, bonus=bonus)


def test_an_unset_flag_reads_at_its_columns_own_default_not_as_false():
    """THE BUG THIS FIXES. Every guard used to read `if structure["pf_enabled"]`
    — asyncpg returns None for NULL, None is falsy, so a NULL read as OFF while
    the column's DEFAULT is TRUE. A structure that left the column NULL
    silently lost its provident fund and nobody was told.

    No NULL exists in any of these today (94 structures, NULL=0 on all four),
    so this removes a trap rather than repairing damage.
    """
    assert vetana()._flag({"pf_enabled": None}, "pf_enabled") == (True, True)
    assert vetana()._flag({}, "pf_enabled") == (True, True)
    assert vetana()._flag({"pf_enabled": False}, "pf_enabled") == (False, False)
    # A NULL is not a "no": the payslip records that nobody had answered.
    assert "pf_enabled" in stat(pf_enabled=None)["treatment"]["unanswered"]
    assert stat(pf_enabled=None)["pf_employee"] == 1800


def test_an_unanswered_flag_never_blocks_a_run():
    """The owner: "we dont know how company operates so we dont block". A
    structure with every switch unset must compute a payslip, not raise."""
    out = vetana()._compute_statutory(50000.0, 100000.0, {})
    assert out["pf_employee"] == 1800
    assert out["professional_tax"] == 200
    assert out["tds"] > 0
    assert set(out["treatment"]["unanswered"]) == set(
        vetana()._FLAG_WHEN_UNSET)


def test_tds_can_now_be_switched_off_and_could_not_be_before():
    """The one place the product decided for a firm and could not be told
    otherwise: the slab table ran unconditionally and `tds_regime` only chose
    which table. Default TRUE, because 871 of 1,095 existing payslips carry a
    TDS figure and a migration must not stop deducting anybody's tax."""
    assert stat()["tds"] > 0
    assert stat(tds_applicable=False)["tds"] == 0
    assert stat(tds_applicable=None)["tds"] == stat(tds_applicable=True)["tds"]
    assert vetana()._FLAG_WHEN_UNSET["tds_applicable"] is True


def test_commission_and_bonus_stay_out_of_every_base_until_a_firm_says_so():
    """FALSE IS A CHOICE AND IT IS THE BEHAVIOUR-PRESERVING ONE. With no switch
    ticked — the state of every structure in the database today — a ₹5,00,000
    commission changes not one deduction."""
    plain = stat()
    with_money = stat(commission=500000.0, bonus=100000.0)
    for head in ("pf_employee", "pf_employer", "esi_employee", "esi_employer",
                 "professional_tax", "tds"):
        assert plain[head] == with_money[head], \
            f"{head} moved when nobody had said commission or bonus belongs in it"


def test_each_of_the_four_switches_moves_only_its_own_base():
    """Four independent answers, because a firm treats the two components
    differently. PF is computed on the payable BASIC and ESI on the gross;
    those subjects are unchanged and only what they include moves.

    PF on ₹50,000 basic is already at the ₹1,800 cap, so the test uses a basic
    below it: ₹10,000 basic is ₹1,200, and adding a ₹5,000 commission takes the
    base to ₹15,000 and the deduction to ₹1,800.
    """
    base = dict(basic=10000.0, gross=100000.0, commission=5000.0, bonus=2000.0)
    assert stat(**base)["pf_employee"] == 1200                     # 12% of 10k
    assert stat(**base, commission_in_pf_base=True)["pf_employee"] == 1800
    assert stat(**base, bonus_in_pf_base=True)["pf_employee"] == 1440
    # …and neither PF switch touches ESI.
    assert stat(**base, commission_in_pf_base=True)["esi_employee"] == \
        stat(**base)["esi_employee"]


def test_the_esi_ceiling_is_tested_against_the_base_it_charges():
    """₹20,000 gross is under the ₹21,000 ceiling and attracts ESI. Adding a
    ₹2,000 commission to the ESI BASE takes it over, so ESI stops applying —
    which is the ceiling doing its job on the base, not the ceiling moving.
    ₹21,000 and the 0.75%/3.25% rates are law and are untouched."""
    on = stat(basic=10000.0, gross=20000.0, esi_enabled=True)
    assert on["esi_employee"] == 150.0                    # 0.75% of 20,000
    over = stat(basic=10000.0, gross=20000.0, commission=2000.0,
                esi_enabled=True, commission_in_esi_base=True)
    assert over["esi_employee"] == 0
    assert over["treatment"]["esi_base"] == 22000.0


def test_no_rate_ceiling_or_threshold_inside_the_statutory_function_moved():
    """PF 12% capped at ₹1,800, ESI 0.75% and 3.25% under ₹21,000, PT ₹200 over
    ₹15,000, the ₹50,000 standard deduction and both slab tables are LAW. This
    change alters WHETHER a component is computed and WHAT BASE it uses. Never
    the arithmetic."""
    src = inspect.getsource(vetana()._compute_statutory)
    for law in ("0.12", "1800", "0.0075", "0.0325", "21000", "200", "15000",
                "50000", "300000", "700000", "250000", "112500", "140000"):
        assert law in src, f"the statutory constant {law} has gone"
    # PT and TDS still compute on the FIXED gross — widening those two bases
    # was not asked for and is owed, not done unasked.
    assert "if pt_on and gross > 15000" in src
    assert "max(gross * 12 - 50000, 0)" in src


def test_the_payslip_records_which_treatment_it_was_computed_under():
    """A payslip is filed, disputed and audited years later, and "was commission
    in the PF base that month?" must be answerable FROM THE PAYSLIP. Somebody
    ticking a checkbox in March must not silently restate January."""
    t = stat(commission=500000.0, bonus=100000.0,
             commission_in_pf_base=True)["treatment"]
    assert t["commission_in_pf_base"] is True
    assert t["bonus_in_pf_base"] is False
    assert t["commission"] == 500000.0 and t["bonus"] == 100000.0
    assert t["pf_base"] == 550000.0
    assert t["tds_regime"] == "new"
    # And it lands on the payslip row rather than only in a log.
    src = inspect.getsource(vetana())
    assert 'treatment = stat.pop("treatment")' in src
    assert "json.dumps(treatment)" in src
    assert '", statutory_treatment"' in src


def test_payroll_still_runs_when_the_treatment_column_is_absent():
    """Code deploys before migrations are applied here. A payroll run that
    500s on an unknown column would be exactly the blocking the owner ruled
    out, so the column is asked for ONCE per run and its absence is a warning,
    not a failure."""
    src = inspect.getsource(vetana())
    assert "payslip_records_treatment" in src
    assert "information_schema.columns" in src
    assert "will not record which statutory treatment" in src


# ══════════════════════════════════════════════════════════════════════════
# 9 · the migration says what this commit says
# ══════════════════════════════════════════════════════════════════════════

def test_the_migration_is_one_transaction_that_proves_itself():
    sql = migration_sql()
    # The DDL, not the header: the ROLLBACK script in the comments is itself a
    # BEGIN/COMMIT pair, and counting it would be counting the explanation.
    assert migration_ddl().count("BEGIN;") == 1
    assert sql.rstrip().endswith("COMMIT;")
    assert "$verify$" in sql, "no VERIFY block — the file asserts nothing"
    assert "SET LOCAL lock_timeout" in sql
    assert sql.count("RAISE EXCEPTION") >= 10


def test_the_migration_writes_nothing_that_survives():
    """It creates two empty tables and adds columns. The single INSERT is
    VERIFY 8's probe, which must be REFUSED — and if it is not, the RAISE that
    follows aborts the whole transaction and takes the probe row with it."""
    ddl = migration_ddl()
    assert ddl.count("INSERT INTO") == 1, \
        "an unexpected INSERT — this migration seeds nothing"
    assert "MUST NEVER COMMIT" in ddl
    assert "DELETE FROM" not in ddl
    assert "DROP TABLE" not in ddl
    assert "DROP COLUMN" not in ddl
    # The one UPDATE in the file lives in the ROLLBACK comment, not the DDL.
    assert "UPDATE staging." not in ddl


def test_the_migration_leaves_no_default_that_decides_money():
    """The owner: "no default commission percentage please org decide its own
    commission". Whose revenue a scheme measures is the same kind of decision,
    so it gets the same rule."""
    ddl = migration_ddl()
    assert "ADD COLUMN IF NOT EXISTS revenue_scope text;" in ddl
    assert "eligible IS NOT TRUE OR revenue_scope IS NOT NULL" in ddl
    # A band states its own floor and its own rate; neither is supplied.
    assert re.search(r"from_amount\s+numeric\(14,2\) NOT NULL,", ddl)
    assert re.search(r"rate_percent\s+numeric\(6,3\) NOT NULL,", ddl)
    assert "from_amount   numeric(14,2) NOT NULL DEFAULT" not in ddl
    # `eligible` and `bonus_eligible` keep theirs — a default that REFUSES is
    # safe by construction and is the opposite of the fault above.
    assert "bonus_eligible boolean NOT NULL DEFAULT FALSE" in ddl


def test_the_migration_supersedes_the_old_columns_without_deleting_them():
    """Superseded is not the same as deleted. Dropping a column is
    irreversible against a shared production database and buys nothing."""
    ddl = migration_ddl()
    for superseded in ("rate_percent", "threshold_amount", "threshold_mode"):
        assert f"DROP COLUMN IF EXISTS {superseded}" not in ddl
    assert "ALTER COLUMN threshold_mode DROP DEFAULT" in ddl
    sql = migration_sql()
    assert "SUPERSEDED" in sql
    for superseded in ("rate_percent", "threshold_amount", "threshold_mode"):
        assert f"COMMENT ON COLUMN staging.manav_commission_schemes.{superseded}" \
            in sql, f"{superseded} is not documented as superseded in the database"


def test_the_migration_keeps_row_order_out_of_the_money():
    ddl = migration_ddl()
    assert "UNIQUE (scheme_id, from_amount)" in ddl, \
        "two bands at one threshold would make the payout depend on row order"
    # One OPEN scheme per employee per (period, scope) — relaxed, not removed.
    assert "one_open_scheme_per_period_idx" in ddl
    assert "(org_id, employee_id, period, revenue_scope)" in ddl
    assert "(org_id, employee_id, period, revenue_scope, effective_from)" in ddl
    # NULLS NOT DISTINCT on BOTH, or two ineligible schemes — which record no
    # scope — would both be storable and both be "current".
    for idx in ("manav_commission_schemes_version_uniq_idx",
                "manav_commission_schemes_one_open_scheme_per_period_idx"):
        block = ddl[ddl.index(idx):]
        assert "NULLS NOT DISTINCT" in block[:block.index(";")], idx
    # …and the old, stricter rules are gone, or a person could not hold a
    # monthly-own and an annual-department scheme at once.
    assert "DROP INDEX IF EXISTS staging.manav_commission_schemes_one_open_scheme_idx" in ddl
    assert "DROP CONSTRAINT IF EXISTS manav_commission_schemes_version_uniq" in ddl


def test_the_migration_keeps_an_eligible_scheme_with_no_terms_unstorable():
    """189's property, re-stated so it can see the child table. A row CHECK
    cannot count rows in another table, so it becomes a DEFERRABLE constraint
    trigger — deferred because a scheme and its bands are written in one
    transaction and the scheme necessarily lands first."""
    ddl = migration_ddl()
    assert "manav_commission_terms_stated" in ddl
    assert ddl.count("CREATE CONSTRAINT TRIGGER") == 2, \
        "the rule must fire on the bands too, or removing the last band is a door"
    assert ddl.count("DEFERRABLE INITIALLY DEFERRED") >= 2
    assert "AFTER INSERT OR UPDATE OR DELETE ON staging.manav_commission_bands" in ddl


def test_the_migration_records_a_bonus_as_a_decision_somebody_made():
    """Amount, why, which payroll month, who awarded it, when — and no payslip
    id, because process_payroll deletes and re-inserts a month's payslips and a
    stamped award would vanish on the second run."""
    table = bonus_awards_ddl()
    for column in ("amount", "reason", "pay_period", "awarded_by", "awarded_at"):
        assert re.search(rf"\n    {column}\s", table), f"bonus award has no {column}"
    assert "CHECK (amount > 0)" in table
    assert "btrim(reason) <> ''" in table
    # No payslip id ON THE TABLE — the award is keyed on the MONTH, so a
    # re-run of payroll picks up the same awards instead of losing them.
    assert "payslip_id" not in table
    assert "'^[0-9]{4}-(0[1-9]|1[0-2])$'" in table


def test_the_migration_adds_the_five_statutory_switches_all_optional():
    """"we dont know how company operates so we dont block" — so every switch
    is nullable with a default, and none of them is NOT NULL."""
    ddl = migration_ddl()
    for flag in ("tds_applicable", "commission_in_pf_base",
                 "commission_in_esi_base", "bonus_in_pf_base",
                 "bonus_in_esi_base"):
        assert f"ADD COLUMN IF NOT EXISTS {flag}" in ddl
        line = next(ln for ln in ddl.splitlines()
                    if f"ADD COLUMN IF NOT EXISTS {flag}" in ln)
        assert "NOT NULL" not in line, f"{flag} is NOT NULL — that blocks"
        assert "DEFAULT" in line, f"{flag} has no default reading"
    assert "tds_applicable         boolean DEFAULT TRUE" in ddl
    assert "statutory_treatment jsonb DEFAULT '{}'::jsonb" in ddl
    # The pre-existing three are NOT touched: firms are already using them.
    for existing in ("pf_enabled", "esi_enabled", "pt_applicable"):
        assert f"ALTER COLUMN {existing}" not in ddl
        assert f"ADD COLUMN IF NOT EXISTS {existing}" not in ddl


def test_no_inline_check_rides_on_an_add_column_if_not_exists():
    """PostgreSQL skips the WHOLE clause when the column already exists, so an
    inline CHECK there is silently never created and the migration reports
    success having added nothing."""
    for line in migration_ddl().splitlines():
        if "ADD COLUMN IF NOT EXISTS" in line:
            assert "CHECK" not in line.upper(), line


def test_every_new_key_is_composite_so_a_row_cannot_reach_another_org():
    """Joining on a child id alone can surface another org's row — the shape of
    the graha_clients leak — and no reader remembering a predicate is as strong
    as a key that cannot express the mistake."""
    ddl = migration_ddl()
    assert "FOREIGN KEY (scheme_id, org_id)" in ddl
    assert "FOREIGN KEY (employee_id, org_id)" in ddl
    assert "REFERENCES staging.manav_commission_schemes (id, org_id)" in ddl
    assert "REFERENCES staging.manav_employees (id, org_id)" in ddl


def test_the_new_router_paths_never_return_a_person_identifier():
    """decision_names_not_ids. A commission page names people; the only id that
    leaves these endpoints is the arrangement's or the award's own."""
    manav = __import__("routers.manav", fromlist=["x"])
    src = inspect.getsource(manav._scheme_payload)
    assert "employee_id" not in src and "user_id" not in src
    assert '"id": str(row["id"])' in src
    # …and the superseded columns are not put on the wire either, or a screen
    # could render one of two answers about somebody's pay.
    for superseded in ("rate_percent", "threshold_amount", "threshold_mode"):
        assert f'row["{superseded}"]' not in src
