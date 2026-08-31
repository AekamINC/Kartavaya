"""The professional-tax band on a payslip must contain the figure it was read against.

── WHAT WAS FOUND, AND HOW ────────────────────────────────────────────────────

Suite 08.8 asks for proof that the WORK STATE reaches the professional-tax
lookup — a ladder consulted with the wrong state still varies with salary, so
variation alone proves nothing. It found zero such proofs, and chasing that
zero into the live data turned up something else entirely.

August 2026, Unicode Group, measured 2026-08-31:

    name             fixed pay    variable        gross    band       PT
    Nikhil Parekh     9,307.69           —     9,307.69    7,501-10,000   175
    Anjali Pandya       307.70  +17,500.00    17,807.69    0-7,500          0
    Devansh Jani      1,538.46  +20,000.00    21,538.46    0-7,500          0
    Aditya Barot        769.24  +12,500.00    13,269.23    0-14,999         0

Maharashtra's ladder — in this database, shared, effective 2024-04-01 — charges
₹200 above ₹10,000. Two employees earning ₹17,808 and ₹21,538 were charged
nothing, and each payslip carries a frozen band that does NOT contain the gross
printed beside it.

── WHY IT HAPPENS ─────────────────────────────────────────────────────────────

`_compute_statutory` receives `gross_fixed`; commission and bonus arrive as
separate arguments. PF and ESI each have explicit switches deciding whether the
variable earnings join their base — "a firm may put commission in the PF base
and keep a bonus out of it". Professional tax has NO such switch and is always
read off fixed pay, while `vetana_payslips.gross` includes the variable
earnings. So the two can disagree, and here they do.

── WHAT THIS FILE DOES AND DOES NOT DECIDE ────────────────────────────────────

⚠ IT DOES NOT DECIDE WHETHER PT IS DUE ON A BONUS. That is a question about the
state Act and about what "salary or wages earned" takes in, and it changes money
remitted to a state government. It is the owner's, and 93 §14 reserves it.

What is NOT in doubt either way is that the DOCUMENT must be readable: a payslip
printing a gross of ₹17,807.69 beside a band of ₹0–7,500 cannot be explained to
the employee who is disputing it or to the inspector auditing it. `pt_base` is
recorded for exactly that reason, and these tests hold the two together — the
band must contain the base, and the base must be the figure the rule actually
used.

If the statutory answer later becomes "PT is due on total earnings", the fix is
to pass a different base and these tests keep holding: they assert consistency,
not a particular base.
"""
import pytest

from routers.vetana import _compute_statutory


MH = [
    {"state_code": "27", "state_name": "Maharashtra", "slab_from": 0,
     "slab_to": 7500, "monthly_tax": 0, "effective_from": None, "month": None, "is_own": False},
    {"state_code": "27", "state_name": "Maharashtra", "slab_from": 7501,
     "slab_to": 10000, "monthly_tax": 175, "effective_from": None, "month": None, "is_own": False},
    {"state_code": "27", "state_name": "Maharashtra", "slab_from": 10001,
     "slab_to": None, "monthly_tax": 200, "effective_from": None, "month": None, "is_own": False},
]

STRUCTURE = {
    "pf_applicable": True, "esi_applicable": True,
    "professional_tax_applicable": True, "tds_applicable": True,
}


def run(gross_fixed, *, commission=0.0, bonus=0.0, state="27"):
    out = _compute_statutory(
        gross_fixed * 0.5, gross_fixed, dict(STRUCTURE),
        commission=commission, bonus=bonus,
        pt_slabs=MH, employee_state=state,
    )
    return out, out["treatment"]


class TestTheBandAndTheBaseAgree:
    @pytest.mark.parametrize("fixed,expected", [
        (5_000.0, 0.0),
        (9_307.69, 175.0),
        (17_807.69, 200.0),
        (21_538.46, 200.0),
    ])
    def test_the_ladder_itself_is_read_correctly(self, fixed, expected):
        """The lookup is sound; the base is the question. Pinned so a change to
        the base cannot be mistaken for a change to the ladder."""
        out, _ = run(fixed)
        assert out["professional_tax"] == expected

    @pytest.mark.parametrize("fixed,commission,bonus", [
        (307.70, 0.0, 17_500.0),
        (1_538.46, 0.0, 20_000.0),
        (9_307.69, 0.0, 0.0),
        (12_000.0, 3_000.0, 0.0),
    ])
    def test_the_frozen_band_contains_the_base_it_was_read_against(
        self, fixed, commission, bonus,
    ):
        """⚠ THE ASSERTION THE WHOLE FILE EXISTS FOR.

        Whatever base the product chooses, the band recorded on the payslip has
        to contain it. A band that does not is a document nobody can explain,
        and it is what let a ₹17,808 payslip carry a ₹0–7,500 band without
        anything noticing.
        """
        _, treatment = run(fixed, commission=commission, bonus=bonus)
        band = treatment["pt_slab"]
        base = treatment["pt_base"]
        assert base is not None, "the payslip does not record what PT was read against"
        assert band is not None, f"no band was frozen for a base of {base}"
        assert band["slab_from"] <= base, (
            f"the frozen band starts at {band['slab_from']} and PT was read "
            f"against {base} — the band does not contain its own base"
        )
        if band["slab_to"] is not None:
            assert base <= band["slab_to"], (
                f"the frozen band ends at {band['slab_to']} and PT was read "
                f"against {base} — the band does not contain its own base"
            )

    def test_the_base_is_the_fixed_pay_and_says_what_it_left_out(self):
        """The reading that makes the payslip explicable.

        ⚠ THIS TEST IS A STATEMENT OF FACT, NOT AN ENDORSEMENT. It records
        which base is in use so that a change to it is a deliberate edit here
        rather than a silent drift — and so the two figures a reader compares
        are both on the document.
        """
        _, treatment = run(307.70, bonus=17_500.0)
        assert treatment["pt_base"] == 307.70
        assert treatment["pt_base_excludes"] == {"commission": 0.0, "bonus": 17_500.0}
        # And the consequence, stated: the gross a payslip prints is the fixed
        # pay PLUS these, so the two numbers on the face of the document differ
        # by exactly what this key names.
        assert sum(treatment["pt_base_excludes"].values()) == 17_500.0

    def test_no_band_means_no_base_to_explain(self):
        """An employee with no state consulted no ladder, so there is nothing
        to reconcile — and `pt_base` must not imply otherwise by standing alone
        with a null band on a NON-zero tax."""
        out, treatment = run(20_000.0, state=None)
        assert treatment["pt_slab"] is None
        assert out["professional_tax"] == 0.0, (
            "a payslip charged professional tax with no band recorded, so the "
            "figure cannot be traced to any ladder"
        )

    def test_a_zero_band_is_still_recorded(self):
        """⚠ THE ZERO THAT MUST NOT BE SILENT.

        "This state levies nothing at this salary" and "no ladder was read" are
        different facts and both produce ₹0. Only the first can be explained to
        an employee, and it can only be explained if the band is on the record.
        """
        _, treatment = run(5_000.0)
        assert treatment["pt_slab"] is not None, (
            "a ₹0 professional tax was recorded with no band, so it is "
            "indistinguishable from a state that was never looked up"
        )
        assert treatment["pt_slab"]["slab_to"] == 7500
        assert treatment["pt_basis"] == "slab"
