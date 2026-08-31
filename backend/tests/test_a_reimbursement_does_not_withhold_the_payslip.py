"""A payslip carrying a reimbursement must still be issuable.

── The defect ────────────────────────────────────────────────────────────────

`doc_validation.py` asserted the identity

    gross - deductions - net  ==  0   (within ₹1)

but `routers/vetana.py:2175-2177` builds a payslip as

    gross = gross_fixed + variable_total          # reimbursement EXCLUDED
    net   = gross - total_deductions + reimbursement_total

so `gross - deductions - net` equals **exactly `-reimbursements`** by
construction. Every payslip with one failed the check, `raise_if_incomplete`
raised, and `GET …/payslips/{id}/pdf` answered 422.

Read live 2026-08-31 — the only two such rows in the org:

    PS-2026-0062  Aditya Barot   gross 13,269.23  ded    51.92  reimb 875.00  net 14,092.31
    PS-2026-0089  Aarav Trivedi  gross 22,000.00  ded 6,000.00  reimb 750.00  net 16,750.00

Both are CORRECT records. The payroll arithmetic is right, the claims are
approved and correctly dated to August, and nothing about either is incomplete.
Only the DOCUMENT could not express them.

⚠ AND THE REFUSAL WAS A DEAD END. The gap's own remedy said "Vetana → re-run
payroll for this period", and a re-run produces byte-identical figures. No
screen, no user, no admin could clear it. Worse, `vetana.py:2317-2327` catches
`DocumentIncomplete` into `pdf_bytes = None` and sends the payslip email anyway
— so those two employees were told their payslip was ready and given nothing.

── Why the exclusion from `gross` is right, and stays ────────────────────────

Counting a reimbursement as wages inflated the loan-recovery ceiling under the
Payment of Wages Act s.7(3), fixed at `vetana.py:2115-2143`. The records were
never wrong. The identity was.

── ⚠ THE ORDER OF THE FIX, WHICH IS THE POINT ────────────────────────────────

Relaxing the validator FIRST would have been wrong, and it is the obvious move.
Until `payslip_pdf.py` changed, the check was a TRUE statement about the page:
the Earnings table listed "Reimbursements 875" beneath a "Gross earnings" foot
that excluded it, and the totals block read 13,269 − 51.92 = 14,092. Widening
the validator alone would have shipped the unverifiable wage record the check
exists to prevent.

So the template moved first — reimbursements out of Earnings, into the totals
block as "Add reimbursements" — and only then did the identity widen to match.
"""
import pytest

from services import doc_validation as dv


def _slip(**over):
    """A payslip row shaped like `vetana_payslips`, reconciling by default."""
    row = {
        "payslip_no": "PS-2026-0062",
        "employee_name": "Aditya Barot",
        "month": "2026-08",
        "gross": 13269.23,
        "total_deductions": 51.92,
        "reimbursements": 0.0,
        "net_pay": 13217.31,
        "basic": 10000.0,
    }
    row.update(over)
    return row


#: A complete employee and employer, so the only gap that can appear is the one
#: under test. Anything missing here would add its OWN blocking gap and the
#: filter below would still pass — which is how a test comes to assert nothing.
_EMPLOYEE = {"name": "Aditya Barot", "employee_code": "S7-01",
             "designation": "Analyst", "date_of_joining": "2026-01-01",
             "pan": "ABCDE1234F", "uan": "100000000000", "esi_number": "1234567890"}
_ORG = {"name": "Unicode Group", "address_line1": "1 Test Road",
        "city": "Surat", "state": "Gujarat", "pincode": "395007"}


def _net_gaps(row):
    """Only the blocking gaps this test is about."""
    chk = dv.validate_payslip(row, _EMPLOYEE, _ORG)
    return [g for g in chk.blocking if g.field == "payslip.net_pay"]


def test_the_live_payslip_that_could_not_be_issued():
    """PS-2026-0062, verbatim from production. ⚠ THIS IS THE WHOLE DEFECT."""
    row = _slip(gross=13269.23, total_deductions=51.92,
                reimbursements=875.00, net_pay=14092.31)
    assert _net_gaps(row) == [], (
        "a payslip whose figures reconcile once reimbursements are counted is "
        "still being withheld — GET /payslips/{id}/pdf answers 422 and the "
        "employee is mailed a notification with no document"
    )


def test_the_second_one_too():
    """PS-2026-0089. Two rows, so the fix is not tuned to one."""
    row = _slip(payslip_no="PS-2026-0089", employee_name="Aarav Trivedi",
                gross=22000.00, total_deductions=6000.00,
                reimbursements=750.00, net_pay=16750.00)
    assert _net_gaps(row) == []


def test_an_ordinary_payslip_is_unaffected():
    """No reimbursement — the identity is the one it always was."""
    assert _net_gaps(_slip()) == []


def test_a_genuinely_broken_slip_is_STILL_blocked():
    """⚠ THE CHECK MUST NOT HAVE BEEN TURNED OFF.

    This is the assertion that makes the others mean something. A payslip whose
    net is wrong by more than the reimbursement still has to be refused — the
    employee cannot verify what they were paid, which is the entire purpose of
    the document.
    """
    row = _slip(gross=13269.23, total_deductions=51.92,
                reimbursements=875.00, net_pay=99999.00)
    gaps = _net_gaps(row)
    assert len(gaps) == 1, "a slip that does not reconcile was allowed through"
    assert "99,999" in gaps[0].reason or "99999" in gaps[0].reason


def test_the_refusal_names_the_reimbursement_when_there_is_one():
    """A refusal a reader cannot act on is the failure mode this file exists for.

    If the slip is genuinely broken AND carries a reimbursement, the message has
    to show the term — otherwise the reader is handed arithmetic that appears
    wrong on its face.
    """
    row = _slip(gross=13269.23, total_deductions=51.92,
                reimbursements=875.00, net_pay=99999.00)
    reason = _net_gaps(row)[0].reason
    assert "reimbursement" in reason.lower(), (
        "the refusal shows gross and deductions but not the reimbursement that "
        "is part of the sum, so the numbers it prints do not add up either: %r"
        % reason
    )


def test_the_source_counts_reimbursements(  ):
    """The identity itself, read from the file, with comments stripped.

    ⚠ COMMENTS ARE STRIPPED FIRST. Twice in this codebase a source-reading
    assertion passed by matching its own explanatory prose rather than the code
    — recorded in STATUS.md as a check that stayed green over the thing it was
    written to catch.
    """
    from pathlib import Path

    src = Path(dv.__file__)
    code = "\n".join(
        l for l in src.read_text(encoding="utf-8").splitlines()
        if not l.strip().startswith("#")
    )
    assert "gross - deductions + reimbursements - net" in code, (
        "doc_validation no longer counts reimbursements in the net-pay identity. "
        "vetana.py computes net = gross - deductions + reimbursements, so "
        "dropping the term withholds the payslip of every employee who was "
        "reimbursed anything."
    )
