"""What happens to a payroll run after it is approved — and the four lies.

Catalogue #23-#27. Three of these five are ABSENCE claims, because the product
records no challan, parses no bank narration into a statutory head, and does not
know which state an employee works in. The failure mode is therefore not a wrong
row — it is a confident sentence built on an absence.

The load-bearing tests:

  · `test_a_missing_debit_is_never_called_an_unpaid_challan` — #23 may say a
    debit is not VISIBLE. It may never say the PF was not paid. Live, two of
    three orgs return "no debit visible" and one of those has simply never
    imported a statement.
  · `test_the_form_number_follows_the_year_not_the_clock` — the single most
    likely thing to get wrong here. Form 16 became Form 130 and 24Q became 138
    on 1 April 2026. Verified live from the same code: FY 2025-26 resolves 16,
    FY 2026-27 resolves 130.
  · `test_the_annexure_never_claims_to_be_the_form` — the certificate is built
    on TRACES after the statement is processed and Part A comes from there. It
    cannot be produced here.
  · `test_arrears_are_not_dropped_from_the_annexure` — `other_earnings` is a
    jsonb ARRAY, so `SUM()` over it raises `function sum(jsonb) does not exist`.
    The live probe caught it; a mock pool hid it completely. Every non-empty
    value measured live is an arrears line, and a salary certificate that
    silently drops arrears understates the year for exactly the people whose pay
    was revised.
  · `test_crossing_the_esi_ceiling_does_not_end_the_obligation` — the rule is
    the JOIN of the ceiling and the contribution period, not the ceiling.

Live figures, read-only 2026-08-20:

  #23  seeded org: PF Rs2,15,282.64 owed, NO debit visible. Unicode Group: both
       PF and ESI not visible.
  #24  seeded org 60 employees at 12 months each; no fanout (max = min = 12),
       and the three duplicate NAMES are three real employees with distinct codes.
  #25  seeded org Q2: 60 rows, 59 with tax deducted, Rs7,54,916.77, form 138.
  #26  seeded org: 60 of 60 above the ceiling with no contribution. Unicode: 21
       of 24.
  #27  `pay_professional_tax` is PER-ORG: Aekam Inc has all 9 slab rows across
       3 states; the other two orgs have NONE.
"""
import inspect
from datetime import date, datetime, timezone

import pytest

from services.skills.data import payroll_statutory as ps
from services.skills.data.payroll_statutory import (
    APPROVED_STATUSES, DEBIT_TOLERANCE, TDS_MARCH_EXCEPTION_MONTH,
    brief_professional_tax, check_esi_ceiling_crossings,
    check_pf_esi_debit_missing, pack_form130_annexure, pack_quarterly_deductees,
    _month_bounds, _quarter_of,
)

ORG = "00000000-0000-4000-8000-000000000023"


class _Pool:
    """Canned result sets matched on a fragment of the SQL, never on call order.

    THE STATUTE ARM FILTERS BY KEY, and it has to. `services/statute.py` narrows
    by `obligation_key` in the SQL and resolves the VERSION in Python, so a mock
    that hands back every seeded row for every lookup makes `_resolve` choose
    between facts about different obligations. It did: a wage-ceiling row and a
    contribution-period row were returned together, the ceiling won both
    lookups, and the period end came back None while the test that should have
    caught it looked correct. Filtering here is what makes these tests mean
    anything.
    """

    def __init__(self, fetch_by=None, row_by=None, val_by=None):
        self.fetch_by, self.row_by, self.val_by = fetch_by or {}, row_by or {}, val_by or {}

    def _pick(self, table, sql, default):
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

    async def fetchval(self, sql, *a):
        return self._pick(self.val_by, sql, None)


def _statute(**kw):
    row = {
        "obligation_key": "epf.remittance", "title": "EPF remittance",
        "authority": "epfo", "statute": "EPF Act", "form_number": "ECR",
        "section_ref": None, "periodicity": "monthly", "due_day": 15,
        "due_month": None, "due_month_offset": 1, "window_days": None,
        "rate_percent": None, "threshold_amount": None, "state_code": None,
        "effective_from": date(2017, 6, 1), "effective_to": None,
        "effective_from_exact": False, "source_ref": "x", "notes": "x",
        "verified_on": date(2026, 8, 20),
    }
    row.update(kw)
    return row


def _run(**kw):
    row = {
        "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "month": "2026-07",
        "status": "approved", "total_gross": 3000000.0, "total_pf": 215282.64,
        "total_esi": 0.0, "total_pt": 12000.0, "total_tds": 754916.77,
        "employee_count": 60,
        "approved_at": datetime(2026, 8, 3, tzinfo=timezone.utc),
        "processed_at": datetime(2026, 8, 3, tzinfo=timezone.utc),
    }
    row.update(kw)
    return row


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(ps, "utc_now",
                        lambda: datetime(2026, 8, 20, 6, 0, tzinfo=timezone.utc))


# ══════════════════════════════════════════════════════════════════════════
# 23 · the absence claim
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_missing_debit_is_never_called_an_unpaid_challan(frozen):
    """It may say a debit is not VISIBLE. It may never say PF was not paid."""
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_bank_statement_lines": []},
                 row_by={"vetana_payroll_runs": _run()})

    out = await check_pf_esi_debit_missing(pool, ORG)

    pf = [h for h in out["heads"] if h["head"] == "Provident fund"][0]
    assert pf["state"] == "no debit visible"
    assert pf["owed"] == 215282.64
    assert pf["due_on"] == date(2026, 8, 15)

    body = " ".join(h["state"] for h in out["heads"]).lower()
    assert "not paid" not in body and "unpaid" not in body
    assert any("absence claim" in l.lower() for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_debit_in_the_window_is_a_candidate_not_a_match(frozen):
    """The real remittance bundles employer share, admin charges and EDLI, none
    of which the run total carries — so a sighting is not a reconciliation."""
    line = {"id": "1", "statement_date": date(2026, 8, 14),
            "description": "EPFO ECR", "reference": "", "amount": -220000.0}
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_bank_statement_lines": [line]},
                 row_by={"vetana_payroll_runs": _run()})

    out = await check_pf_esi_debit_missing(pool, ORG)

    pf = [h for h in out["heads"] if h["head"] == "Provident fund"][0]
    assert pf["state"] == "a candidate debit was seen"
    assert pf["candidates"][0]["amount"] == 220000.0
    assert any("sighting, not a match" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_nothing_owed_is_not_a_finding(frozen):
    """ESI is genuinely zero in the seeded org. A head with no liability must
    not read as a missed payment."""
    pool = _Pool(fetch_by={"statute_calendar": [_statute()],
                           "ganit_bank_statement_lines": []},
                 row_by={"vetana_payroll_runs": _run(total_esi=0.0)})

    out = await check_pf_esi_debit_missing(pool, ORG)

    esi = [h for h in out["heads"] if h["head"] == "ESI"][0]
    assert esi["state"] == "nothing owed"
    assert out["counts"]["heads_not_visible"] == 1        # PF only


@pytest.mark.asyncio
async def test_no_approved_run_is_the_absence_of_a_question(frozen):
    pool = _Pool(row_by={"vetana_payroll_runs": None})

    out = await check_pf_esi_debit_missing(pool, ORG)

    assert out["run_found"] is False
    assert "absence of a question" in out["limitations"][0]


def test_status_is_the_authority_not_the_approval_timestamp():
    """The seeded org's 2026-07 run carries an approved_at and a LATER
    processed_at — approved, reopened, reprocessed. Reading approved_at would
    call that settled."""
    assert APPROVED_STATUSES == ("approved", "disbursed")
    src = inspect.getsource(ps._latest_approved_run)
    assert "approved_at IS NOT NULL" not in src
    assert "status = ANY" in src


# ══════════════════════════════════════════════════════════════════════════
# 24 · the annexure
# ══════════════════════════════════════════════════════════════════════════

def _emp(**kw):
    row = {
        "employee_id": "e1", "name": "Deepak Rane", "employee_code": "EMP-007",
        "pan": "ABCDE1234F", "months": 12, "gross": 838836.0, "basic": 400000.0,
        "hra": 160000.0, "conveyance": 19200.0, "medical": 15000.0,
        "special_allowance": 200000.0, "da": 36864.0, "other_earnings": 0.0,
        "pf_employee": 48000.0, "professional_tax": 2400.0, "tds": 41940.0,
    }
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_the_annexure_never_claims_to_be_the_form(frozen):
    """The certificate is generated on TRACES after the quarterly statement is
    processed, and Part A comes from there. It cannot be produced here."""
    pool = _Pool(fetch_by={"statute_calendar": [
                     _statute(obligation_key="tds.certificate.salary",
                              form_number="16", periodicity="annual",
                              due_day=15, due_month=6, due_month_offset=None,
                              effective_to=date(2026, 4, 1))],
                 "vetana_payslips p": [_emp()]})

    out = await pack_form130_annexure(pool, ORG)

    assert out["is_the_form"] is False
    assert "working, not a certificate" in out["what_this_is"].lower()
    assert "TRACES" in out["what_this_is"]


@pytest.mark.asyncio
async def test_the_form_number_follows_the_year_not_the_clock(frozen):
    """Form 16 became Form 130 from FY 2026-27. Verified live from this code:
    FY 2025-26 resolves 16, FY 2026-27 resolves 130."""
    old = _statute(obligation_key="tds.certificate.salary", form_number="16",
                   periodicity="annual", due_day=15, due_month=6,
                   due_month_offset=None, effective_from=date(1962, 4, 1),
                   effective_to=date(2026, 4, 1))
    new = _statute(obligation_key="tds.certificate.salary", form_number="130",
                   periodicity="annual", due_day=None, due_month=None,
                   due_month_offset=None, effective_from=date(2026, 4, 1),
                   effective_to=None)
    pool = _Pool(fetch_by={"statute_calendar": [old, new],
                           "vetana_payslips p": [_emp()]})

    assert (await pack_form130_annexure(
        pool, ORG, financial_year="2025-26"))["feeds_certificate"] == "16"
    assert (await pack_form130_annexure(
        pool, ORG, financial_year="2026-27"))["feeds_certificate"] == "130"


@pytest.mark.asyncio
async def test_arrears_are_not_dropped_from_the_annexure(frozen):
    """`other_earnings` is a jsonb ARRAY of {label, amount}; SUM() over it
    raises. Measured live, every non-empty value is an arrears line, and a
    certificate that drops arrears understates the year for exactly the people
    whose pay was revised."""
    pool = _Pool(fetch_by={"statute_calendar": [],
                           "vetana_payslips p": [_emp(other_earnings=11000.0)]})

    out = await pack_form130_annexure(pool, ORG)

    s17 = out["employees"][0]["heads"]["Salary as per section 17(1)"]
    # basic 400000 + da 36864 + special 200000 + other 11000
    assert s17 == 647864.0

    # …and the query must not SUM the jsonb column directly.
    src = inspect.getsource(pack_form130_annexure)
    assert "SUM(p.other_earnings)" not in src
    assert "jsonb_array_elements" in src


@pytest.mark.asyncio
async def test_an_employee_with_no_pan_is_an_exception_not_a_silent_row(frozen):
    pool = _Pool(fetch_by={"statute_calendar": [],
                           "vetana_payslips p": [_emp(pan=None, tds=41940.0)]})

    out = await pack_form130_annexure(pool, ORG)

    issues = {e["issue"] for e in out["exceptions"]}
    assert "no PAN on record" in issues
    assert "tax deducted with no PAN" in issues


@pytest.mark.asyncio
async def test_a_part_year_record_is_flagged_without_being_called_wrong(frozen):
    """A joiner and a gap look identical, so it says so rather than accusing."""
    pool = _Pool(fetch_by={"statute_calendar": [], "vetana_payslips p": [_emp(months=3)]})

    out = await pack_form130_annexure(pool, ORG)

    exc = [e for e in out["exceptions"] if "3 month" in e["issue"]][0]
    assert "not necessarily wrong" in exc["consequence"]


# ══════════════════════════════════════════════════════════════════════════
# 25 · the deductee pack
# ══════════════════════════════════════════════════════════════════════════

def test_the_quarter_helper_starts_the_year_in_april():
    assert _quarter_of(date(2026, 4, 1))[0] == 1
    assert _quarter_of(date(2026, 7, 31)) == (2, date(2026, 7, 1), date(2026, 9, 30))
    assert _quarter_of(date(2026, 1, 15)) == (4, date(2026, 1, 1), date(2026, 3, 31))
    assert _quarter_of(date(2026, 3, 31))[0] == 4


@pytest.mark.asyncio
async def test_the_deductee_pack_says_nothing_about_challans(frozen):
    """'Ship the deductee list; delete the challan sentence.' total_tds is a
    computed liability, not a deposited challan, and there is no challan record
    anywhere in this product."""
    rows = [{"employee_id": "e1", "name": "Aadhya Nair", "employee_code": "EMP-1",
             "pan": "ABCDE1234F", "month": "2026-07", "gross": 100000.0, "tds": 12000.0}]
    pool = _Pool(fetch_by={"statute_calendar": [
                     _statute(obligation_key="tds.statement.salary",
                              form_number="138", periodicity="quarterly",
                              due_day=None, due_month=None, due_month_offset=None,
                              effective_from=date(2026, 4, 1))],
                 "vetana_payslips p": rows})

    out = await pack_quarterly_deductees(pool, ORG)

    assert out["counts"]["rows_with_tax_deducted"] == 1
    assert out["counts"]["total_deducted"] == 12000.0
    assert "challan" not in " ".join(str(d) for d in out["deductees"]).lower()
    assert any("NO CHALLAN INFORMATION" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_the_quarterly_statement_prints_no_due_date(frozen):
    """Q4 differs from the other three, so no uniform day-of-month exists and
    the calendar carries none. It must explain rather than leave a blank."""
    pool = _Pool(fetch_by={"statute_calendar": [], "vetana_payslips p": []})

    out = await pack_quarterly_deductees(pool, ORG)

    assert out["due_on"] is None
    assert "not due on a uniform day" in out["why_no_due_date"]


@pytest.mark.asyncio
async def test_tax_deducted_with_no_pan_is_called_out_separately(frozen):
    rows = [{"employee_id": "e1", "name": "X", "employee_code": "E1", "pan": "  ",
             "month": "2026-07", "gross": 100000.0, "tds": 9000.0}]
    pool = _Pool(fetch_by={"statute_calendar": [], "vetana_payslips p": rows})

    out = await pack_quarterly_deductees(pool, ORG)

    assert out["counts"]["rows_with_tax_and_no_pan"] == 1
    assert out["deducted_but_no_pan"][0]["tax_deducted"] == 9000.0


# ══════════════════════════════════════════════════════════════════════════
# 26 · the ESI ceiling
# ══════════════════════════════════════════════════════════════════════════

_CEILING = _statute(obligation_key="esi.wage_ceiling", threshold_amount=21000,
                    periodicity="standing", due_day=None, due_month=None,
                    due_month_offset=None, form_number=None,
                    title="ESI wage ceiling")
_P1 = _statute(obligation_key="esi.contribution_period.first", due_day=30,
               due_month=9, due_month_offset=None, periodicity="standing",
               form_number=None, threshold_amount=None)


def _slip(**kw):
    row = {"employee_id": "e1", "name": "Rohit Menon", "employee_code": "EMP-9",
           "esi_number": None, "month": "2026-07", "gross": 25000.0,
           "esi_employee": 0.0, "esi_employer": 0.0}
    row.update(kw)
    return row


@pytest.mark.asyncio
async def test_crossing_the_esi_ceiling_does_not_end_the_obligation(frozen):
    """The rule is the JOIN of the ceiling and the period, not the ceiling.

    An employee whose wages rise above the ceiling mid-period keeps contributing
    to the period end. Stopping the month the raise landed is the inspection
    finding this check exists for.
    """
    pool = _Pool(fetch_by={"statute_calendar": [_CEILING, _P1],
                           "vetana_payslips p": [_slip()]},
                 val_by={"max(month)": "2026-07"})

    out = await check_esi_ceiling_crossings(pool, ORG, month="2026-07")

    assert out["ceiling"] == 21000.0
    assert out["contribution_period_ends"] == date(2026, 9, 30)
    assert out["counts"]["crossed_and_still_owed"] == 1
    assert "end of it" in out["crossed_and_still_owed"][0]["why"]


@pytest.mark.asyncio
async def test_someone_over_the_ceiling_who_is_contributing_is_not_a_finding(frozen):
    pool = _Pool(fetch_by={"statute_calendar": [_CEILING, _P1],
                           "vetana_payslips p": [_slip(esi_employee=187.0)]})

    out = await check_esi_ceiling_crossings(pool, ORG, month="2026-07")

    assert out["counts"]["crossed_and_still_owed"] == 0


@pytest.mark.asyncio
async def test_with_no_recorded_ceiling_nothing_is_compared(frozen):
    """A missing calendar row is a gap, not a clean month."""
    pool = _Pool(fetch_by={"statute_calendar": [], "vetana_payslips p": [_slip()]})

    out = await check_esi_ceiling_crossings(pool, ORG, month="2026-07")

    assert out["ceiling"] is None
    assert out["counts"]["crossed_and_still_owed"] == 0
    assert "not a clean month" in out["limitations"][0]


@pytest.mark.asyncio
async def test_it_admits_one_month_cannot_prove_a_mid_period_crossing(frozen):
    pool = _Pool(fetch_by={"statute_calendar": [_CEILING, _P1],
                           "vetana_payslips p": [_slip()]})

    out = await check_esi_ceiling_crossings(pool, ORG, month="2026-07")

    assert any("THIS READS ONE MONTH" in l for l in out["limitations"])
    assert any("question to check, not a confirmed breach" in l for l in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# 27 · professional tax
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_professional_tax_prints_no_due_date_and_no_penalty(frozen):
    """PT is a STATE levy. The slab table carries neither column, and a date
    printed from memory would be wrong in a different state every month."""
    pool = _Pool(fetch_by={"pay_professional_tax": [],
                           "vetana_payslips p": []},
                 row_by={"vetana_payroll_runs": _run()})

    out = await brief_professional_tax(pool, ORG)

    assert out["due_date"] is None and out["penalty"] is None
    assert any("NO DUE DATE AND NO PENALTY" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_an_org_with_no_slabs_is_told_it_has_none(frozen):
    """The slab table is PER-ORG — every row carries an org_id — so two of the
    three live orgs have no slabs at all rather than a national default."""
    pool = _Pool(fetch_by={"pay_professional_tax": [], "vetana_payslips p": []},
                 row_by={"vetana_payroll_runs": _run()})

    out = await brief_professional_tax(pool, ORG)

    assert out["counts"]["slab_rows_for_this_org"] == 0
    assert "NO professional tax slabs recorded" in out["limitations"][0]


@pytest.mark.asyncio
async def test_the_slab_query_is_scoped_to_the_org(frozen):
    """It is per-org seed data; an unscoped read would show one firm another
    firm's configuration."""
    src = inspect.getsource(brief_professional_tax)
    assert "FROM staging.pay_professional_tax" in src
    idx = src.index("FROM staging.pay_professional_tax")
    assert "org_id = $1::uuid" in src[idx:idx + 260]


@pytest.mark.asyncio
async def test_the_annual_ptec_is_named_as_out_of_scope(frozen):
    pool = _Pool(fetch_by={"pay_professional_tax": [], "vetana_payslips p": []},
                 row_by={"vetana_payroll_runs": _run()})

    out = await brief_professional_tax(pool, ORG)

    assert any("PTEC" in l for l in out["limitations"])


# ══════════════════════════════════════════════════════════════════════════
# what the module promises about itself
# ══════════════════════════════════════════════════════════════════════════

SRC = inspect.getsource(ps)


def test_nothing_here_writes():
    for verb in ("insert into", "update ", "delete from"):
        assert verb not in SRC.lower(), verb


def test_the_march_tds_exception_is_named_not_buried():
    """March's deduction is due 30 April, not 7 April, and one calendar row
    cannot hold two due days — 172's own note says so."""
    assert TDS_MARCH_EXCEPTION_MONTH == 3


def test_no_statutory_amount_is_a_literal():
    """The ESI ceiling comes from the calendar. 21000 must not appear in code."""
    import ast

    tree = ast.parse(SRC)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:]
    literals = {n.value for n in ast.walk(tree)
                if isinstance(n, ast.Constant) and isinstance(n.value, (int, float, str))}

    assert 21000 not in literals
    for banned in ("Form 16", "Form 130", "24Q", "138"):
        assert banned not in literals, banned


@pytest.mark.parametrize("fn", [
    check_pf_esi_debit_missing, pack_form130_annexure, pack_quarterly_deductees,
    check_esi_ceiling_crossings, brief_professional_tax,
])
def test_every_handler_runs_from_the_org_and_the_calendar_alone(fn):
    required = [n for n, p in inspect.signature(fn).parameters.items()
                if n not in ("pool", "org_id") and p.default is inspect.Parameter.empty]
    assert not required, f"{fn.__name__} requires {required}"


@pytest.mark.parametrize("fn", [
    check_pf_esi_debit_missing, pack_form130_annexure, pack_quarterly_deductees,
    check_esi_ceiling_crossings, brief_professional_tax,
])
@pytest.mark.asyncio
async def test_every_handler_always_returns_limitations(fn, frozen):
    """Every one of these is wrong in a way the reader cannot see."""
    pool = _Pool(row_by={"vetana_payroll_runs": _run()},
                 val_by={"max(month)": "2026-07"})

    out = await fn(pool, ORG)

    assert out["limitations"], fn.__name__
    assert all(isinstance(l, str) and l.strip() for l in out["limitations"])


def test_the_debit_tolerance_is_loose_on_purpose():
    """The real remittance bundles employer share, admin charges and EDLI. A
    tight band would report a paying firm as delinquent every month."""
    assert DEBIT_TOLERANCE >= 0.2


def test_month_bounds_handles_december():
    assert _month_bounds("2026-12") == (date(2026, 12, 1), date(2026, 12, 31))
    assert _month_bounds("2026-02") == (date(2026, 2, 1), date(2026, 2, 28))
