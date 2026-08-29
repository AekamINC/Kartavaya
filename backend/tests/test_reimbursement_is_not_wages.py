"""A loan may not be recovered out of a reimbursement, and a June run may not
pay an August expense.

Two defects found by proposal 93 Suite 08 on 2026-08-29, both in the monthly
salary computation in `routers/vetana.py`, and both proved on live rows — on
**2 of the 2 reimbursements this product has ever paid**.

── 1. THE LOAN TOOK THE WHOLE REIMBURSEMENT ────────────────────────────────

    loan_capacity = max(0.0, gross_fixed + reimbursement_total - statutory - floor)

A reimbursement is the employee's OWN MONEY coming back: they paid for
something the firm needed and the firm owes them. Handing it to the capacity
lets a lender take it, and the person has then funded the firm's expense and
received nothing.

The 50% take-home floor does not save them, because the floor is a share of
`gross_fixed` — and in a month somebody did not work, half of zero is zero
while the reimbursement is still counted in full.

**PS-2026-0011, Aarav Trivedi, June 2026, live:** gross ₹0.00, reimbursement
₹750.00, **loan deduction ₹750.00, net pay ₹0.00**. The control case sits in the
same run — PS-2026-0019, Aditya Barot, identical ₹0.00 gross, ₹875.00
reimbursement, no active loan, **net ₹875.00**. The loan is the only difference
between the two payslips.

⚠ The paragraph directly above the line already gave the reason it was wrong.
It explains that the capacity is computed on the FIXED gross so that "adding a
bonus can never increase what is taken out of somebody's pay" — and the next
line added a reimbursement, which is not even an earning. A comment that states
the rule its own code breaks is the same shape as the `$4::date` fault in
`pahchan_attendance.py`, which is why both got a check rather than a note.

Payment of Wages Act 1936 s.2(vi) excludes from "wages" any sum paid to defray
special expenses entailed on the employee by the nature of their employment.
s.7 deductions — s.7(2)(f) recovery of an advance among them — are deductions
FROM WAGES, and the s.7(3) ceiling is a share of wages. So counting a
reimbursement in the base inflates that ceiling with money the Act says is not
wages at all.

── 2. THE SWEEP HAD NO UPPER BOUND, SO A RUN PAID FUTURE EXPENSES ──────────

The claim query selected every approved, unreimbursed claim with no reference
to the period being paid. Live: expenses incurred on **5 and 6 August 2026**
were reimbursed on **June 2026** payslips. A payslip is filed, disputed and
audited years later; a June salary certificate carrying an August expense
cannot be defended.

The bound is `expense_date <= month_end`, the END of the period — deliberately
not the period itself. An expense incurred on the 28th and approved on the 3rd
must still be paid; it rides the next run. Bounding to the month exactly would
strand any claim approved after its own month closed, and nothing would ever
pick it up again.

── HOW THIS IS ASSERTED ────────────────────────────────────────────────────

The capacity is tested by EVALUATING THE EXPRESSION THE MODULE ACTUALLY
CONTAINS, not by reimplementing it. A test that re-derived the arithmetic would
agree with itself forever. The live figures go in, and the live wrong answer is
what must not come out.
"""
import ast
import asyncio
import os
import re

import pytest

import routers.vetana as vetana

_SRC = open(vetana.__file__, encoding="utf-8").read()

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO public"


def _capacity_expression() -> str:
    """The right-hand side of `loan_capacity = …`, as the module has it."""
    m = re.search(r"^\s*loan_capacity = (.+)$", _SRC, re.M)
    assert m, "loan_capacity is no longer assigned as one expression in vetana.py"
    return m.group(1).strip()


def test_the_capacity_expression_does_not_read_the_reimbursement():
    expr = _capacity_expression()
    names = {n.id for n in ast.walk(ast.parse(expr, mode="eval")) if isinstance(n, ast.Name)}
    assert "reimbursement_total" not in names, (
        "loan recovery is being computed on money that is not wages: %s\n"
        "A reimbursement is the employee's own spending coming back. Live, this "
        "took the ENTIRE 750.00 owed to Aarav Trivedi on PS-2026-0011 and paid "
        "him 0.00." % expr
    )


def test_the_live_case_that_paid_somebody_nothing():
    """PS-2026-0011 — the real numbers, through the real expression."""
    env = {
        "max": max,
        "gross_fixed": 0.0,             # he worked none of June
        "reimbursement_total": 750.0,   # his own money, spent for the firm
        "statutory": 0.0,               # nothing owed on a nil wage
        "floor": 0.0,                   # 50% of 0 — the floor protects nothing
    }
    capacity = eval(_capacity_expression(), {"__builtins__": {}}, env)  # noqa: S307
    assert capacity == 0.0, (
        "a loan can still be recovered from a reimbursement: capacity came out "
        "at %r on the exact figures of PS-2026-0011, where the lender took all "
        "750.00 and Aarav Trivedi was paid 0.00 for money he had already spent "
        "on the firm's behalf." % capacity
    )


def test_a_loan_is_still_recovered_from_actual_wages():
    """The fix must not stop legitimate recovery — PS-2026-0089, live."""
    env = {
        "max": max,
        "gross_fixed": 7015.38,
        "reimbursement_total": 0.0,
        "statutory": 553.54,
        "floor": 3507.69,
    }
    capacity = eval(_capacity_expression(), {"__builtins__": {}}, env)  # noqa: S307
    assert round(capacity, 2) == 2954.15, (
        "recovery from wages has changed: expected 2,954.15 (the amount actually "
        "taken on PS-2026-0089), got %r. The floor is meant to bind the loan, "
        "not abolish it." % capacity
    )


def _claim_sql() -> str:
    m = re.search(
        r"approved_claims = await pool\.fetch\(\s*(.*?)\n\s*org_id, emp_id",
        _SRC, re.S)
    assert m, "the approved-claims query is no longer built where this test looks"
    return re.sub(r"\s+", " ", "".join(re.findall(r'"([^"]*)"', m.group(1)))).strip()


def test_the_claim_sweep_is_bounded_by_the_period_being_paid():
    sql = _claim_sql()
    assert "expense_date <=" in sql, (
        "the reimbursement sweep has no upper bound again, so a run pays "
        "expenses that had not happened yet. Live, claims dated 5 and 6 August "
        "2026 were reimbursed on JUNE 2026 payslips: %s" % sql
    )
    assert "expense_date <= $3::date" in sql, (
        "the bound must be an explicit ::date parameter. asyncpg infers the "
        "Python type from the cast, and this repo has shipped a str bound to "
        "$n::date four times: %s" % sql
    )


def test_payroll_pays_only_what_the_expenses_screen_shows():
    sql = _claim_sql()
    assert "is_active=TRUE" in sql.replace(" = ", "="), (
        "GET /manav/expense-claims filters `c.is_active=TRUE` and payroll does "
        "not, so the two can disagree about what is owed. Nothing sets the "
        "column FALSE today — there is no delete route, and live exposure is "
        "zero — but a payment the screen cannot account for is not a defect "
        "anyone would find quickly: %s" % sql
    )


@pytest.mark.skipif(
    os.environ.get("DATABASE_URL", _PLACEHOLDER_DSN) == _PLACEHOLDER_DSN,
    reason="no live database; the claim query is parsed against the real catalogue",
)
def test_the_claim_query_parses_against_the_real_catalogue():
    """`expense_date` and `is_active` must actually be on the table.

    Nothing is executed. `prepare()` sends Parse and Describe and stops, which
    matters because **staging and production share one Supabase database** —
    and `conftest.py` hands every module a MagicMock pool that would answer
    happily to a column that does not exist.
    """
    import asyncpg

    async def go():
        conn = await asyncpg.connect(os.environ["DATABASE_URL"])
        try:
            await conn.execute(_SEARCH_PATH)
            await conn.prepare(_claim_sql())
        finally:
            await conn.close()

    asyncio.run(go())
