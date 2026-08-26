"""Phase 5.1 — the first payroll constant to come out of a literal.

Proposal 79 calls `statute_calendar` "the best idea in the product". It is real:
45 rows, read by eight skill modules — and it protected NOTHING a customer is
billed on, because the payroll engine hardcoded its constants instead.

`services/statute.py` already resolves a key at a date correctly: half-open
intervals, ranked supersession, `as_of` mandatory. It was simply never called
from `routers/vetana.py`.

WHAT COULD ACTUALLY BE WIRED, AND WHAT COULD NOT
------------------------------------------------
Measured against the live table on 2026-08-26 — 45 rows, 11 with a
`rate_percent`, 8 with a `threshold_amount`:

  · `esi.wage_ceiling`  → 21,000, effective 2017-01-01, verified 2026-08-20
                          against ESI (Central) Rules 1950 rule 50. **Wired.**
  · `epf.remittance`    → a DUE DATE. No rate, no threshold. So PF's 12% and
                          its ₹1,800 cap have nowhere to be read from.
  · `tds.*`             → thirteen keys, every one a statement, certificate or
                          deposit date. The income-tax slab ladder is not in
                          this table at all.

A constant with nowhere to read it from is not improved by pretending
otherwise, so 0.75%, 3.25%, 12%, ₹1,800 and both slab tables stay literal and
say why. Phase 5.1 is complete for the one key the store can answer and
explicitly incomplete for the rest — see PROGRESS for what 5.2 must add.

WHY IT CHANGES NOTHING TODAY, WHICH IS THE POINT
------------------------------------------------
The dated ceiling equals the literal it replaced, so no payslip moves. Live
exposure either way: 3 salary structures carry `esi_enabled`, 15 payslips hold
a non-zero ESI figure, ₹2,213.31 in total across both in-scope organisations. A
mechanism lands best when its first act is to change nothing.
"""
from datetime import date

import pytest

import routers.vetana as vetana


class TestTheCeilingIsDatedAndTheRatesAreNot:

    def test_no_ceiling_supplied_keeps_the_statutory_literal(self):
        """THE SAFETY ASYMMETRY, and it is NOT the choice made for professional
        tax. An absent PT slab means "this state levies nothing" — a defensible
        zero. An absent ESI ceiling would mean "no ceiling" and charge ESI to
        people the Act exempts. A missing row must never WIDEN a deduction."""
        base = {"pf_enabled": False, "esi_enabled": True, "pt_applicable": False,
                "tds_applicable": False}
        under = vetana._compute_statutory(0, 20000, dict(base), esi_ceiling=None)
        over = vetana._compute_statutory(0, 22000, dict(base), esi_ceiling=None)
        assert under["esi_employee"] > 0, "somebody under 21,000 was not charged ESI"
        assert over["esi_employee"] == 0, (
            "somebody over the statutory 21,000 ceiling was charged ESI when the "
            "law store could not be read — a missing row widened a deduction")

    def test_a_dated_ceiling_is_used_when_the_store_answers(self):
        base = {"pf_enabled": False, "esi_enabled": True, "pt_applicable": False,
                "tds_applicable": False}
        # A ceiling raised to 25,000 brings a 22,000 earner into ESI.
        raised = vetana._compute_statutory(0, 22000, dict(base), esi_ceiling=25000.0)
        assert raised["esi_employee"] > 0

    def test_a_lowered_ceiling_takes_somebody_out(self):
        base = {"pf_enabled": False, "esi_enabled": True, "pt_applicable": False,
                "tds_applicable": False}
        lowered = vetana._compute_statutory(0, 20000, dict(base), esi_ceiling=15000.0)
        assert lowered["esi_employee"] == 0

    def test_the_rates_did_not_move(self):
        """0.75% and 3.25% are law and stay literal — the ceiling is what became
        dated. Pinned so a future edit cannot quietly re-rate ESI while claiming
        to be wiring the calendar."""
        base = {"pf_enabled": False, "esi_enabled": True, "pt_applicable": False,
                "tds_applicable": False}
        out = vetana._compute_statutory(0, 20000, dict(base), esi_ceiling=21000.0)
        assert out["esi_employee"] == pytest.approx(20000 * 0.0075)
        assert out["esi_employer"] == pytest.approx(20000 * 0.0325)

    def test_esi_off_is_still_off_whatever_the_ceiling_says(self):
        base = {"pf_enabled": False, "esi_enabled": False, "pt_applicable": False,
                "tds_applicable": False}
        out = vetana._compute_statutory(0, 10000, dict(base), esi_ceiling=99999.0)
        assert out["esi_employee"] == 0 and out["esi_employer"] == 0


class TestTheRunAsksForTheRightDate:

    def test_the_ceiling_is_read_at_the_period_end_not_today(self):
        """`as_of` is the date the OBLIGATION arises — the last day of the month
        being paid — not the date somebody presses the button. That is what
        `services/statute.py` means by `as_of` and why it refuses to default it,
        and it is the whole acceptance criterion for 5.1: re-running an old
        month must use the ceiling that applied to THAT month.
        """
        import inspect
        src = inspect.getsource(vetana)
        assert "_esi_ceiling(pool, month_end)" in src, (
            "the run no longer reads the ceiling at the period end; a re-run of "
            "an old month would silently apply today's law")

    def test_the_reader_never_lets_a_payroll_run_die(self):
        """A payroll run must not stop because the law store is unreadable —
        the same rule `_pt_from_slabs` follows for an unparseable slab."""
        import inspect
        src = inspect.getsource(vetana._esi_ceiling)
        assert "except Exception" in src, src
        assert "return None" in src, src


@pytest.mark.asyncio
async def test_a_dated_change_affects_only_runs_on_or_after_its_as_of():
    """The acceptance criterion, exercised against the real resolver.

    Two versions of one key, superseding on 2026-04-01. `services/statute.py`
    ranks and half-open-bounds them; this proves the payroll reader inherits
    that rather than reimplementing it — a second resolution rule is how two
    surfaces come to disagree about what the law was.
    """
    rows = [
        {"obligation_key": "esi.wage_ceiling", "threshold_amount": 21000,
         "effective_from": date(2017, 1, 1), "effective_to": date(2026, 4, 1),
         "effective_from_exact": True, "state_code": None},
        {"obligation_key": "esi.wage_ceiling", "threshold_amount": 25000,
         "effective_from": date(2026, 4, 1), "effective_to": None,
         "effective_from_exact": True, "state_code": None},
    ]

    class _Pool:
        async def fetch(self, *_a, **_k):
            return rows

    before = await vetana._esi_ceiling(_Pool(), date(2026, 3, 31))
    on = await vetana._esi_ceiling(_Pool(), date(2026, 4, 1))
    after = await vetana._esi_ceiling(_Pool(), date(2026, 8, 31))

    assert before == 21000, "a month before the change used the new ceiling"
    assert on == 25000, "the change did not take effect on its own as_of"
    assert after == 25000


@pytest.mark.asyncio
async def test_an_unreadable_store_returns_none_rather_than_raising():
    class _Boom:
        async def fetch(self, *_a, **_k):
            raise RuntimeError("law store unavailable")

    assert await vetana._esi_ceiling(_Boom(), date(2026, 8, 31)) is None
