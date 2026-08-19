"""test_client_lifecycle.py — the client entry/exit register (migration 163).

THE DELIVERABLE IS `TestClause8DoesNotOverreach`. Every other class here
supports it.

It is easy to write a compliance product that demands the predecessor letter,
and the tests for that write themselves. The failure that actually kills the
feature is the opposite one: demanding it where the law does not, so a firm
cannot record a GST return without producing a letter to a previous auditor who
does not exist. That firm stops using the register, and the audits which DO need
the letter stop being tracked with it. Over-demanding is not the safe direction —
it loses the same thing by a different route.

So Clause (8) is asserted here in BOTH directions, and the negative cases
outnumber the positive ones on purpose:

    · a non-audit engagement never demands it (all twelve types)
    · a first-ever appointment never demands it, even for a statutory audit
    · a predecessor who was not a chartered accountant never demands it
    · an NOC or any reply is never demanded, on any engagement

── NO DATABASE ──────────────────────────────────────────────────────────────
tests/conftest.py swaps db._pool for a MagicMock, so nothing here reaches
Postgres. Every rule under test is therefore in Python, which is where
services/custody/lifecycle.py deliberately put it (module docstring), and the
SQL is asserted separately and by shape in `TestTheSqlShape` — because a mock
pool hides bad SQL, and a predicate pushed into the WHERE clause would be
asserted by nothing at all.

The one thing that IS read off disk is migration 163 itself:
`TestTheMigrationAndThePythonAgree` parses the CHECK constraints out of the .sql
and asserts the Python vocabulary matches. A hand-written list of engagement
types would pass green while the database refused half of them.
"""
import re
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from services.custody import lifecycle
from services.custody.lifecycle import (
    AUDIT_ENGAGEMENT_TYPES,
    ENGAGEMENT_TYPES,
    NON_AUDIT_ENGAGEMENT_TYPES,
    Gap,
    clause8_applies,
    entry_gaps,
    exit_gaps,
    incomplete_at_entry,
    outstanding_at_exit,
    predecessor_communication_state,
    retention_expiring,
    retention_until_for,
    retention_years_for,
)

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "163_client_engagement_lifecycle.sql"
)

ORG = "64e7bea6-0000-0000-0000-000000000001"
ENG = "11111111-2222-3333-4444-555555555555"


# ── builders ─────────────────────────────────────────────────────────────────
#
# Defaults are the COMPLETE case, so every test names only the thing it is
# about. A builder whose defaults are broken makes each test assert several
# things by accident and none of them on purpose.

def engagement(**over):
    row = {
        "engagement_id": ENG,
        "org_id": ORG,
        "client_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "client_name": "Sharma Textiles Private Limited",
        "engagement_type": "tax_audit",
        "financial_year": "2025-26",
        "status": "active",
        "accepted_on": date(2026, 5, 1),
        "started_on": date(2026, 5, 4),
        "engagement_letter_signed_on": date(2026, 5, 2),
        "had_predecessor": False,
        "predecessor_is_ca": None,
        "predecessor_name": None,
        "predecessor_not_required_reason": "First appointment",
        "exit_initiated_on": None,
        "closed_on": None,
        "records_handover_status": "not_started",
        "records_handover_ack_by": None,
        "portal_access_revoked_at": None,
        "final_invoice_id": None,
        "final_billing_status": "pending",
        "retention_anchor_date": None,
        "retention_years": 7,
        "retention_until": None,
    }
    row.update(over)
    return row


def exiting(**over):
    """A clean, COMPLETE exit. Tests break one thing at a time off it."""
    row = engagement(
        status="exiting",
        exit_initiated_on=date(2026, 6, 1),
        exit_reason="not_reappointed",
        records_handover_status="completed",
        records_handover_on=date(2026, 6, 10),
        records_handover_ack_by="Anita Sharma, Finance Head",
        portal_access_revoked_at=date(2026, 6, 11),
        final_invoice_id="99999999-8888-7777-6666-555555555555",
        final_billing_status="invoiced",
        final_invoice_balance_due=Decimal("0"),
        final_invoice_doc_status="final",
        final_invoice_payment_status="paid",
        retention_anchor_date=date(2026, 3, 31),
        retention_until=date(2033, 3, 31),
    )
    row.update(over)
    return row


def comm(**over):
    """A timely, evidenced attempt: dispatched before acceptance, delivered."""
    row = {
        "engagement_id": ENG,
        "mode": "registered_post_ad",
        "dispatched_on": date(2026, 4, 20),
        "proof_ref": "RP123456789IN",
        "proof_file_key": None,
        "delivery_outcome": "delivered",
        "delivered_on": date(2026, 4, 24),
        "reply_received_on": None,
        "reply_summary": None,
    }
    row.update(over)
    return row


def codes(gaps):
    return {g.code for g in gaps}


# ══ THE DELIVERABLE ══════════════════════════════════════════════════════════

class TestClause8DoesNotOverreach:
    """The register must not block work Clause (8) never touched."""

    @pytest.mark.parametrize("kind", sorted(NON_AUDIT_ENGAGEMENT_TYPES))
    def test_a_non_audit_engagement_never_demands_the_predecessor_letter(self, kind):
        """Bookkeeping, a GST return, an ROC filing, payroll, a certificate.

        Clause (8) reaches "a position as auditor". Not one of these is one —
        and the row here is the WORST case for the product: the firm took over
        from another chartered accountant, said so, and recorded no letter. On
        an audit that is a blocking gap. On these twelve it must be silent, and
        `not_required` must short-circuit before anything else is evaluated.
        """
        row = engagement(
            engagement_type=kind,
            had_predecessor=True,
            predecessor_is_ca=True,
        )

        assert clause8_applies(kind, had_predecessor=True, predecessor_is_ca=True) is False
        assert predecessor_communication_state(row, []) == "not_required"

        found = codes(entry_gaps(row, []))
        assert not any(c.startswith("predecessor") for c in found), (
            f"{kind} is not an audit; nothing about a previous auditor may be "
            f"demanded, but got {sorted(found)}"
        )

    @pytest.mark.parametrize("kind", sorted(NON_AUDIT_ENGAGEMENT_TYPES))
    def test_a_non_audit_engagement_is_never_blocked(self, kind):
        """Not one gap on a non-audit engagement may be `blocking`.

        Whatever else the register reports — an unsigned engagement letter, a
        missing acceptance date — none of it is a rule that stops a firm filing
        a return, and nothing in this product may pretend it is.
        """
        row = engagement(
            engagement_type=kind,
            had_predecessor=True,
            predecessor_is_ca=True,
            engagement_letter_signed_on=None,
            accepted_on=None,
        )
        assert not any(g.blocking for g in entry_gaps(row, []))

    def test_a_first_ever_appointment_demands_nothing_even_on_a_statutory_audit(self):
        """There is nobody to write to. The clause is silent, not lenient."""
        row = engagement(
            engagement_type="statutory_audit",
            had_predecessor=False,
            predecessor_is_ca=None,
        )
        assert clause8_applies(
            "statutory_audit", had_predecessor=False, predecessor_is_ca=None
        ) is False
        assert predecessor_communication_state(row, []) == "not_required"
        assert not any(c.startswith("predecessor") for c in codes(entry_gaps(row, [])))

    def test_a_predecessor_who_was_not_a_chartered_accountant_demands_nothing(self):
        """The clause names a chartered accountant, or a Restricted Certificate
        Rules 1932 certified auditor. A departing non-CA bookkeeper is neither.
        """
        row = engagement(
            engagement_type="statutory_audit",
            had_predecessor=True,
            predecessor_is_ca=False,
            predecessor_name="Ledger & Co (not a CA firm)",
        )
        assert clause8_applies(
            "statutory_audit", had_predecessor=True, predecessor_is_ca=False
        ) is False
        assert predecessor_communication_state(row, []) == "not_required"
        assert not any(g.blocking for g in entry_gaps(row, []))

    def test_no_reply_is_ever_demanded_and_a_silent_predecessor_blocks_nothing(self):
        """The misconduct is failing to communicate, not proceeding without an
        NOC. A predecessor who never answers must not be able to hold an
        incoming auditor's engagement hostage through this product.
        """
        row = engagement(
            engagement_type="statutory_audit",
            had_predecessor=True,
            predecessor_is_ca=True,
        )
        attempts = [comm(reply_received_on=None, reply_summary=None)]

        assert predecessor_communication_state(row, attempts) == "satisfied"
        assert not any(c.startswith("predecessor") for c in codes(entry_gaps(row, attempts)))

    def test_gstin_pan_and_tan_are_never_part_of_completeness(self):
        """These are non-mandatory in this product and block nothing. It has
        drifted back more than once, and a "compliance completeness" screen is
        exactly where it drifts back next. The register has no such columns and
        must never grow the words.
        """
        blank = engagement(
            engagement_type="statutory_audit",
            had_predecessor=True,
            predecessor_is_ca=True,
            engagement_letter_signed_on=None,
            accepted_on=None,
        )
        text = " ".join(
            f"{g.code} {g.label} {g.basis}"
            for g in entry_gaps(blank, []) + exit_gaps(exiting(records_handover_status="not_started"))
        ).lower()
        for word in ("gstin", "pan ", "tan ", "udyam"):
            assert word not in text, f"completeness must not mention {word!r}"


# ══ the positive direction ═══════════════════════════════════════════════════

class TestClause8Applies:

    @pytest.mark.parametrize("kind", sorted(AUDIT_ENGAGEMENT_TYPES))
    def test_every_audit_type_demands_it_when_a_ca_preceded(self, kind):
        """ICAI: "all types of audits viz., statutory audit, tax audit, internal
        audit, concurrent audit or any other kind of audit" (icai.org/post/5645).
        `other_audit` is that "any other kind" and is in the set for that reason.
        """
        assert clause8_applies(kind, had_predecessor=True, predecessor_is_ca=True) is True

        row = engagement(engagement_type=kind, had_predecessor=True, predecessor_is_ca=True)
        gaps = entry_gaps(row, [])
        assert "predecessor_communication_missing" in codes(gaps)
        assert any(g.blocking for g in gaps)

    def test_the_gap_cites_the_clause(self):
        row = engagement(
            engagement_type="tax_audit", had_predecessor=True, predecessor_is_ca=True
        )
        gap = next(
            g for g in entry_gaps(row, []) if g.code == "predecessor_communication_missing"
        )
        assert "Clause (8)" in gap.basis
        assert "First Schedule" in gap.basis

    def test_an_unknown_predecessor_is_reported_but_does_not_block(self):
        """It followed somebody, and nobody has recorded what that somebody was.

        The letter may or may not be owed. The remedy is to answer a question,
        so this is reported and is NOT blocking — the alternative is a product
        that stops an engagement because a text field is empty.
        """
        row = engagement(
            engagement_type="statutory_audit",
            had_predecessor=True,
            predecessor_is_ca=None,
        )
        assert predecessor_communication_state(row, []) == "status_unknown"

        gaps = entry_gaps(row, [])
        assert "predecessor_status_unknown" in codes(gaps)
        assert not any(g.blocking for g in gaps)


class TestWhatSatisfiesTheCommunication:

    def _audit(self, **over):
        base = {
            "engagement_type": "statutory_audit",
            "had_predecessor": True,
            "predecessor_is_ca": True,
            "accepted_on": date(2026, 5, 1),
        }
        base.update(over)
        return engagement(**base)

    def test_dispatched_and_delivered_before_acceptance_satisfies(self):
        assert predecessor_communication_state(self._audit(), [comm()]) == "satisfied"

    def test_dispatched_on_the_day_of_acceptance_is_not_a_reasonable_wait(self):
        """SAME-DAY IS NOT AFTER, AND IT IS ALSO NOT COMPLIANCE.

        This test asserted `satisfied` until 2026-08-19, on the reading that
        Clause (8) says "without FIRST communicating" and a letter posted on the
        morning of the day the firm signed did precede the signature. That reads
        half the requirement. ICAI's own FAQ makes the member guilty who failed
        to communicate in writing "and if he did not wait for a reasonable
        length of time for a reply to be received from him"
        (https://icai.org/post/5645) — so posting and signing the same day is
        the fact pattern the FAQ describes, and a register that answers
        "satisfied" to it has told the firm the one thing that would stop it
        changing what it does next time.
        """
        attempt = comm(dispatched_on=date(2026, 5, 1), delivered_on=date(2026, 5, 3))
        row = self._audit()
        assert predecessor_communication_state(row, [attempt]) == "accepted_without_wait"

    def test_dispatched_after_acceptance_is_late_and_not_satisfied(self):
        """The letter went out. The clause was still breached, and calling this
        "satisfied" would bury the only fact anybody can act on.
        """
        attempt = comm(dispatched_on=date(2026, 5, 20), delivered_on=date(2026, 5, 24))
        row = self._audit()

        assert predecessor_communication_state(row, [attempt]) == "late"
        gaps = entry_gaps(row, [attempt])
        assert "predecessor_communication_late" in codes(gaps)
        assert any(g.blocking for g in gaps)

    def test_before_acceptance_is_measured_against_acceptance_not_today(self):
        """No acceptance date means nothing has been accepted, so nothing can
        have been accepted late. Any evidenced attempt is timely.
        """
        row = self._audit(accepted_on=None)
        attempt = comm(dispatched_on=date(2030, 1, 1), delivered_on=date(2030, 1, 5))
        assert predecessor_communication_state(row, [attempt]) == "satisfied"

    def test_awaiting_acknowledgement_with_no_reference_is_not_evidence(self):
        attempt = comm(
            delivery_outcome="awaiting",
            delivered_on=None,
            proof_ref=None,
            proof_file_key=None,
        )
        row = self._audit()
        assert predecessor_communication_state(row, [attempt]) == "unevidenced"
        assert "predecessor_communication_unevidenced" in codes(entry_gaps(row, [attempt]))

    def test_a_tracking_reference_is_evidence_even_before_the_ack_comes_back(self):
        attempt = comm(delivery_outcome="awaiting", delivered_on=None, proof_ref="RP999IN")
        assert predecessor_communication_state(self._audit(), [attempt]) == "satisfied"

    def test_a_returned_letter_is_evidence_of_the_opposite(self):
        """The tracking number on a returned letter proves it came back. It can
        never make the attempt count, whatever reference it carries.
        """
        attempt = comm(
            delivery_outcome="returned_undelivered",
            delivered_on=None,
            proof_ref="RP123456789IN",
        )
        assert predecessor_communication_state(self._audit(), [attempt]) == "unevidenced"

    def test_a_refused_letter_is_not_evidence_of_delivery(self):
        attempt = comm(delivery_outcome="refused", delivered_on=None, proof_ref="RP1IN")
        assert predecessor_communication_state(self._audit(), [attempt]) == "unevidenced"

    def test_two_attempts_where_only_the_second_landed_satisfies(self):
        """Registered post comes back; the firm sends again. This is why the
        attempts are rows and not a column — a single `communicated_at` could
        only hold the second date and would say nothing about the first.
        """
        attempts = [
            comm(dispatched_on=date(2026, 3, 4), delivery_outcome="returned_undelivered",
                 delivered_on=None),
            comm(dispatched_on=date(2026, 3, 11), delivery_outcome="delivered",
                 delivered_on=date(2026, 3, 14)),
        ]
        assert predecessor_communication_state(self._audit(), attempts) == "satisfied"

    def test_a_late_evidenced_attempt_after_an_early_unevidenced_one_is_late(self):
        """The early attempt cannot be proved and the provable one was too late.
        Neither half rescues the other.
        """
        attempts = [
            comm(dispatched_on=date(2026, 4, 1), delivery_outcome="awaiting",
                 delivered_on=None, proof_ref=None),
            comm(dispatched_on=date(2026, 6, 1), delivery_outcome="delivered",
                 delivered_on=date(2026, 6, 5)),
        ]
        assert predecessor_communication_state(self._audit(), attempts) == "late"


class TestTheReasonableWaitForAReply:
    """ICAI requires the incoming auditor to allow a reasonable time for a
    reply. It fixes no number of days, so this module picked one — and the
    tests here exist mostly to hold the consequences of that choice honest:
    the duty is reported, and it never blocks.
    """

    def _audit(self, **over):
        base = {
            "engagement_type": "statutory_audit",
            "had_predecessor": True,
            "predecessor_is_ca": True,
            "accepted_on": date(2026, 5, 1),
        }
        base.update(over)
        return engagement(**base)

    def test_a_full_reasonable_interval_satisfies(self):
        attempt = comm(dispatched_on=date(2026, 4, 24), delivered_on=date(2026, 4, 26))
        assert predecessor_communication_state(self._audit(), [attempt]) == "satisfied"

    def test_one_day_short_of_the_interval_is_not_satisfied(self):
        """The boundary, asserted from both sides, because an off-by-one here
        either accuses a firm that complied or clears one that did not.
        """
        short = comm(dispatched_on=date(2026, 4, 25), delivered_on=date(2026, 4, 27))
        exact = comm(dispatched_on=date(2026, 4, 24), delivered_on=date(2026, 4, 26))
        assert predecessor_communication_state(self._audit(), [short]) == "accepted_without_wait"
        assert predecessor_communication_state(self._audit(), [exact]) == "satisfied"

    def test_the_interval_is_measured_from_the_earliest_timely_attempt(self):
        """Writing a second time does not shorten the wait the firm allowed."""
        attempts = [
            comm(dispatched_on=date(2026, 3, 1), delivered_on=date(2026, 3, 4)),
            comm(dispatched_on=date(2026, 4, 30), delivered_on=date(2026, 5, 2)),
        ]
        assert predecessor_communication_state(self._audit(), attempts) == "satisfied"

    def test_a_reply_that_arrived_before_acceptance_is_the_wait(self):
        """The interval exists so the predecessor can answer. This one answered
        the next day; there is nothing left to wait for.
        """
        attempt = comm(
            dispatched_on=date(2026, 4, 30),
            delivered_on=date(2026, 4, 30),
            reply_received_on=date(2026, 4, 30),
        )
        assert predecessor_communication_state(self._audit(), [attempt]) == "satisfied"

    def test_a_reply_that_arrived_after_acceptance_does_not_rescue_it(self):
        attempt = comm(
            dispatched_on=date(2026, 4, 30),
            delivered_on=date(2026, 5, 2),
            reply_received_on=date(2026, 5, 9),
        )
        assert predecessor_communication_state(self._audit(), [attempt]) == "accepted_without_wait"

    def test_a_reply_to_an_earlier_unevidenced_attempt_still_counts(self):
        """Replies are one conversation, not one per envelope. A predecessor who
        answered the letter that cannot be tracked has still answered.
        """
        attempts = [
            comm(dispatched_on=date(2026, 4, 28), delivery_outcome="awaiting",
                 delivered_on=None, proof_ref=None, reply_received_on=date(2026, 4, 29)),
            comm(dispatched_on=date(2026, 4, 30), delivered_on=date(2026, 5, 1)),
        ]
        assert predecessor_communication_state(self._audit(), attempts) == "satisfied"

    def test_no_wait_is_owed_before_the_firm_has_accepted(self):
        row = self._audit(accepted_on=None)
        attempt = comm(dispatched_on=date(2026, 4, 30), delivered_on=date(2026, 4, 30))
        assert predecessor_communication_state(row, [attempt]) == "satisfied"

    def test_it_is_reported_and_cites_the_duty_without_claiming_a_deadline(self):
        attempt = comm(dispatched_on=date(2026, 5, 1), delivered_on=date(2026, 5, 3))
        gaps = entry_gaps(self._audit(), [attempt])
        gap = next(g for g in gaps if g.code == "predecessor_reply_time_not_allowed")

        assert "Clause (8)" in gap.basis
        # The one thing this basis must say, because the number is ours: ICAI
        # does not fix a period. A basis that implied it did would be this
        # product inventing a statutory deadline, which is the worst defect
        # available to a compliance register.
        assert "fixes no period" in gap.basis

    def test_it_never_blocks_because_the_number_of_days_is_not_ICAIs(self):
        """The duty is ICAI's; seven days is this repo's. Blocking a firm's work
        against a threshold we invented is the overreach the whole module is
        written against — and `predecessor_communication_missing` on the same
        engagement still blocks, so this is a deliberate distinction and not a
        module that has stopped blocking anything.
        """
        attempt = comm(dispatched_on=date(2026, 5, 1), delivered_on=date(2026, 5, 3))
        unwaited = entry_gaps(self._audit(), [attempt])
        assert not any(g.blocking for g in unwaited)
        assert any(g.blocking for g in entry_gaps(self._audit(), []))

    def test_a_non_audit_engagement_never_reaches_the_wait_rule(self):
        """The carve-out survives the new state. Same-day everything on payroll
        work still demands nothing at all.
        """
        for kind in sorted(NON_AUDIT_ENGAGEMENT_TYPES):
            row = self._audit(engagement_type=kind)
            attempt = comm(dispatched_on=date(2026, 5, 1), delivered_on=date(2026, 5, 1))
            assert predecessor_communication_state(row, [attempt]) == "not_required"
            assert "predecessor_reply_time_not_allowed" not in codes(entry_gaps(row, [attempt]))


# ══ exit ═════════════════════════════════════════════════════════════════════

class TestExit:

    def test_an_engagement_that_is_not_leaving_reports_nothing(self):
        """An exit checklist that starts on the day a client is onboarded is a
        checklist nobody reads by the time it matters.
        """
        assert exit_gaps(engagement()) == []

    def test_a_complete_exit_reports_nothing(self):
        assert exit_gaps(exiting()) == []

    def test_status_alone_does_not_start_the_exit_clock(self):
        """`exit_initiated_on` is the trigger, not `status`. A status column is
        a thing somebody forgets to move; a date is a thing somebody typed.
        """
        assert exit_gaps(engagement(status="exiting", exit_initiated_on=None)) == []

    def test_a_closed_exit_is_off_the_worklist(self):
        assert exit_gaps(exiting(closed_on=date(2026, 7, 1), records_handover_status="not_started")) == []

    def test_records_not_handed_back(self):
        assert "records_not_handed_back" in codes(
            exit_gaps(exiting(records_handover_status="not_started", records_handover_ack_by=None))
        )

    def test_a_handover_nobody_signed_for_is_the_dispute_you_cannot_win(self):
        found = codes(exit_gaps(exiting(records_handover_ack_by=None)))
        assert "handover_unacknowledged" in found
        assert "records_not_handed_back" not in found

    def test_a_blank_acknowledgement_is_not_an_acknowledgement(self):
        assert "handover_unacknowledged" in codes(exit_gaps(exiting(records_handover_ack_by="   ")))

    def test_handover_may_be_not_applicable(self):
        """A firm that only ever held scans of documents the client still has
        has nothing to hand back, and must be able to say so.
        """
        found = codes(exit_gaps(exiting(records_handover_status="not_applicable",
                                        records_handover_ack_by=None)))
        assert "records_not_handed_back" not in found
        assert "handover_unacknowledged" not in found

    def test_portal_access_not_revoked(self):
        assert "portal_access_not_revoked" in codes(exit_gaps(exiting(portal_access_revoked_at=None)))

    def test_no_final_bill_raised(self):
        found = codes(exit_gaps(exiting(final_billing_status="pending", final_invoice_id=None)))
        assert "final_bill_not_raised" in found

    def test_a_final_invoice_still_in_draft_was_never_issued(self):
        found = codes(exit_gaps(exiting(final_invoice_doc_status="draft",
                                        final_invoice_balance_due=Decimal("11800"))))
        assert "final_invoice_still_draft" in found
        assert "final_invoice_unpaid" not in found

    def test_a_final_invoice_with_a_balance_is_unpaid(self):
        """`balance_due`, not `doc_status`. `doc_status` defaults to 'final' and
        says nothing about payment, and "paid" in this product only ever comes
        from bank reconciliation.
        """
        found = codes(exit_gaps(exiting(final_invoice_balance_due=Decimal("11800.00"))))
        assert "final_invoice_unpaid" in found

    def test_a_settled_bill_reports_nothing(self):
        assert exit_gaps(exiting(final_billing_status="settled",
                                 final_invoice_balance_due=None)) == []

    def test_a_written_off_bill_reports_nothing(self):
        assert exit_gaps(exiting(final_billing_status="written_off",
                                 final_invoice_balance_due=Decimal("11800"))) == []

    def test_an_exit_with_no_retention_clock_is_reported_here_or_nowhere(self):
        """It cannot appear in `retention_expiring` — there is no date to
        compare — so if this gap did not exist, a box of working papers with no
        destruction date would be invisible to the entire product.
        """
        found = codes(exit_gaps(exiting(retention_anchor_date=None, retention_until=None)))
        assert "retention_clock_unset" in found

    def test_nothing_at_exit_blocks(self):
        """Exit hygiene is the firm's own discipline. None of it is a rule that
        stops work, and marking it blocking would train people to ignore the
        one flag that is.
        """
        broken = exiting(
            records_handover_status="not_started",
            records_handover_ack_by=None,
            portal_access_revoked_at=None,
            final_billing_status="pending",
            final_invoice_id=None,
            retention_anchor_date=None,
            retention_until=None,
        )
        assert not any(g.blocking for g in exit_gaps(broken))


# ══ retention ════════════════════════════════════════════════════════════════

class TestRetention:

    def test_audit_documentation_is_seven_years(self):
        """SQC 1 para 83 as amended by the ICAI Council on 19 August 2009 — it
        was TEN years before that, which is precisely why this number is a
        constant with a citation and not a literal buried in a query.
        """
        for kind in AUDIT_ENGAGEMENT_TYPES:
            assert retention_years_for(kind) == 7

    def test_non_audit_defaults_to_the_same_seven(self):
        for kind in NON_AUDIT_ENGAGEMENT_TYPES:
            assert retention_years_for(kind) == 7

    def test_the_clock_starts_at_the_report_not_the_exit(self):
        """An audit reported in 2021 for a client who walked out in 2026 comes
        out of the window in 2028, not 2033. `retention_until_for` takes the
        anchor and nothing else, so an exit date cannot reach it by accident.
        """
        assert retention_until_for(date(2021, 9, 30), 7) == date(2028, 9, 30)

    def test_a_leap_day_anchor_lands_on_28_february(self):
        """`date(2031, 2, 29)` does not exist and would raise, and a retention
        screen that throws on one row in a thousand shows nothing to anybody.
        28 rather than 1 March: this is the first day destruction is permitted,
        so an error of a day must fall on the side of keeping the paper.
        """
        assert retention_until_for(date(2024, 2, 29), 7) == date(2031, 2, 28)

    def test_a_leap_day_anchor_landing_on_a_leap_year_is_untouched(self):
        assert retention_until_for(date(2024, 2, 29), 8) == date(2032, 2, 29)

    def test_no_anchor_means_no_date_rather_than_a_guess(self):
        assert retention_until_for(None, 7) is None

    def test_a_missing_or_absurd_period_means_no_date(self):
        assert retention_until_for(date(2026, 4, 1), None) is None
        assert retention_until_for(date(2026, 4, 1), 0) is None

    def test_an_iso_string_anchor_is_accepted(self):
        assert retention_until_for("2021-09-30", 7) == date(2028, 9, 30)


# ══ the queries ══════════════════════════════════════════════════════════════

def _pool(*result_sets):
    """A pool whose successive .fetch() calls return the given result sets."""
    pool = AsyncMock()
    pool.fetch = AsyncMock(side_effect=list(result_sets))
    return pool


class TestIncompleteAtEntry:

    @pytest.mark.asyncio
    async def test_it_stitches_the_attempts_onto_the_right_engagement(self):
        rows = [
            engagement(engagement_id="eng-a", engagement_type="statutory_audit",
                       had_predecessor=True, predecessor_is_ca=True),
            engagement(engagement_id="eng-b", engagement_type="statutory_audit",
                       had_predecessor=True, predecessor_is_ca=True,
                       engagement_letter_signed_on=None),
        ]
        attempts = [comm(engagement_id="eng-b")]

        out = await incomplete_at_entry(_pool(rows, attempts), ORG)
        by_id = {r["engagement_id"]: r for r in out}

        assert by_id["eng-a"]["predecessor_state"] == "missing"
        assert by_id["eng-b"]["predecessor_state"] == "satisfied"
        assert by_id["eng-b"]["predecessor_comms"] == attempts

    @pytest.mark.asyncio
    async def test_a_complete_engagement_is_dropped(self):
        out = await incomplete_at_entry(_pool([engagement()], []), ORG)
        assert out == []

    @pytest.mark.asyncio
    async def test_blocking_rows_sort_first(self):
        """The screen must open on the breached clause, not on the engagement
        letter that has not come back from the printer.
        """
        rows = [
            engagement(engagement_id="letter-only", engagement_letter_signed_on=None,
                       accepted_on=date(2026, 1, 1)),
            engagement(engagement_id="clause8", engagement_type="tax_audit",
                       had_predecessor=True, predecessor_is_ca=True,
                       accepted_on=date(2026, 8, 1)),
        ]
        out = await incomplete_at_entry(_pool(rows, []), ORG)

        assert [r["engagement_id"] for r in out] == ["clause8", "letter-only"]
        assert out[0]["blocking"] is True
        assert out[1]["blocking"] is False

    @pytest.mark.asyncio
    async def test_it_scopes_by_org_on_both_queries(self):
        pool = _pool([], [])
        await incomplete_at_entry(pool, ORG)
        assert [c.args[1] for c in pool.fetch.call_args_list] == [ORG, ORG]


class TestOutstandingAtExit:

    @pytest.mark.asyncio
    async def test_a_complete_exit_is_dropped_and_a_broken_one_is_not(self):
        rows = [exiting(engagement_id="clean"),
                exiting(engagement_id="messy", portal_access_revoked_at=None)]
        out = await outstanding_at_exit(_pool(rows), ORG)

        assert [r["engagement_id"] for r in out] == ["messy"]
        assert "portal_access_not_revoked" in codes(out[0]["gaps"])


class TestRetentionExpiring:

    @pytest.mark.asyncio
    async def test_days_remaining_goes_negative_for_papers_already_past(self):
        """Overdue rows are included and sort first. A report that only showed
        the future would let a shredding backlog grow invisibly — the failure
        services/pahchan_retention.py was rewritten to stop.
        """
        rows = [
            exiting(engagement_id="soon", status="closed", retention_until=date(2026, 10, 1)),
            exiting(engagement_id="overdue", status="closed", retention_until=date(2026, 1, 1)),
        ]
        out = await retention_expiring(_pool(rows, []), ORG, as_of=date(2026, 8, 19))

        assert [r["engagement_id"] for r in out["expiring"]] == ["overdue", "soon"]
        assert out["expiring"][0]["days_remaining"] < 0
        assert out["expiring"][1]["days_remaining"] == 43

    @pytest.mark.asyncio
    async def test_a_live_engagement_can_never_be_offered_for_destruction(self):
        """Somebody filled in a retention date on an engagement that is still
        running. Destroying those papers is the one outcome this must never
        suggest, so the status rule is applied after the SQL and in one place.
        """
        rows = [exiting(engagement_id="live", status="active", retention_until=date(2026, 1, 1))]
        out = await retention_expiring(_pool(rows, []), ORG, as_of=date(2026, 8, 19))
        assert out["expiring"] == []

    @pytest.mark.asyncio
    async def test_engagements_with_no_clock_come_back_separately(self):
        """"May be destroyed next month" and "nobody knows what this is" are
        different problems and must not share a heading.
        """
        unset = [exiting(engagement_id="nodate", status="closed", retention_until=None)]
        out = await retention_expiring(_pool([], unset), ORG, as_of=date(2026, 8, 19))

        assert out["expiring"] == []
        assert [r["engagement_id"] for r in out["unset"]] == ["nodate"]

    @pytest.mark.asyncio
    async def test_as_of_is_required_and_is_not_quietly_today(self):
        """A retention review run "as at 31 March" in June must not answer for
        June. Same rule as services/statute.obligation().
        """
        with pytest.raises(ValueError):
            await retention_expiring(_pool([], []), ORG, as_of=None)

    @pytest.mark.asyncio
    async def test_the_horizon_is_passed_as_an_integer_parameter(self):
        pool = _pool([], [])
        await retention_expiring(pool, ORG, as_of=date(2026, 8, 19), within_days=30)
        first = pool.fetch.call_args_list[0].args
        assert first[1:] == (ORG, date(2026, 8, 19), 30)


# ══ the SQL, which the mock pool cannot check ════════════════════════════════

class TestTheSqlShape:
    """A MagicMock pool hides bad SQL completely. These assert by shape."""

    ALL = [
        lifecycle._SELECT_OPEN_ENGAGEMENTS,
        lifecycle._SELECT_OPEN_COMMS,
        lifecycle._SELECT_EXITING,
        lifecycle._SELECT_RETENTION_DUE,
        lifecycle._SELECT_RETENTION_UNSET,
    ]

    @pytest.mark.parametrize("sql", ALL)
    def test_every_table_is_schema_qualified(self, sql):
        """search_path here is `"$user", public, extensions`, so an unqualified
        name resolves to nothing — and migration 142 exists because thirteen
        shadow tables in `public` were winning the lookup.
        """
        for match in re.finditer(r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)", sql):
            name = match.group(1)
            assert name.startswith("staging."), f"{name} is not schema-qualified"

    @pytest.mark.parametrize("sql", ALL)
    def test_every_parameter_carries_an_explicit_cast(self, sql):
        """An untyped `$1` or `$2 + $3` is a PgBouncer parse error that surfaces
        as an instant 500 with no useful message. It killed every credit spend
        in this product exactly once.
        """
        uncast = re.findall(r"\$\d+(?!\s*::)", sql)
        assert not uncast, f"uncast parameters: {uncast}"

    @pytest.mark.parametrize("sql", ALL)
    def test_every_query_is_scoped_to_one_org(self, sql):
        assert "org_id = $1::uuid" in sql

    def test_the_retention_horizon_arithmetic_is_fully_cast(self):
        """`$2::date + $3::int`. Both halves. This is the exact expression shape
        that produced the credits incident.
        """
        assert "($2::date + $3::int)" in lifecycle._SELECT_RETENTION_DUE

    def test_the_exit_query_left_joins_the_invoice(self):
        """An INNER JOIN would hide every exit that was never billed — the exits
        most worth seeing.
        """
        assert "LEFT JOIN staging.ganit_invoices" in lifecycle._SELECT_EXITING

    def test_no_query_selects_star(self):
        for sql in self.ALL:
            assert "SELECT *" not in sql


class TestEveryJoinIsOrgScoped:
    """THE RATCHET THIS FILE WAS MISSING.

    `WHERE e.org_id = $1` scopes the ENGAGEMENT rows and nothing else. Every
    other table in the query arrives through a join, and a join on an id alone
    will fetch whatever row has that id — including one belonging to a
    different practice. Migration 163 cannot stop it: the foreign key is on
    `graha_clients(id)`, and there is no UNIQUE (id, org_id) on that table for a
    composite key to reference (adding one would mean ALTERing a table this
    migration is not allowed to touch).

    Probed read-only against the live database on 2026-08-19 with the engagement
    rows supplied as a CTE and the client rows real: an engagement stamped org A
    whose `client_id` pointed at a client of org B came back inside org A's
    result carrying ORG B'S CLIENT NAME. Adding `AND c.org_id = e.org_id`
    returned org A's own row and nothing else.

    A mock pool cannot see any of this, and the old
    `test_every_query_is_scoped_to_one_org` passed the whole time — it asserted
    the string "org_id = $1::uuid" was somewhere in the query, which it was.
    """

    JOIN = re.compile(
        r"\b(?:LEFT\s+)?JOIN\s+(staging\.\w+)\s+(\w+)\s+ON\b([^\n]*(?:\n\s{8,}[^\n]*)*)",
        re.IGNORECASE,
    )

    @pytest.mark.parametrize("sql", TestTheSqlShape.ALL)
    def test_every_joined_table_carries_its_own_org_predicate(self, sql):
        joins = self.JOIN.findall(sql)
        assert joins, "no joins parsed — the regex has drifted from the SQL"
        for table, alias, on_clause in joins:
            assert re.search(rf"\b{alias}\.org_id\s*=", on_clause), (
                f"{table} is joined as `{alias}` with no org predicate in its ON "
                f"clause; a row from another org can come back through it"
            )

    @pytest.mark.parametrize("sql", TestTheSqlShape.ALL)
    def test_the_driving_table_is_filtered_by_the_parameter(self, sql):
        assert re.search(r"WHERE\s+\w+\.org_id\s*=\s*\$1::uuid", sql)

    def test_the_invoice_org_predicate_is_in_the_join_not_the_where(self):
        """In a WHERE clause `i.org_id = e.org_id` would silently turn the LEFT
        JOIN into an inner one — NULL never equals anything — and every exit
        that was never billed would vanish from the worklist. That is the same
        bug as the INNER JOIN this suite already guards against, arriving by a
        route the existing test cannot see.
        """
        sql = lifecycle._SELECT_EXITING
        on_clause = sql.split("LEFT JOIN staging.ganit_invoices", 1)[1].split("WHERE", 1)[0]
        assert "i.org_id = e.org_id" in on_clause
        where = sql.split("WHERE", 1)[1]
        assert "i.org_id" not in where

    def test_no_row_returns_the_org_id_it_was_asked_for(self):
        """The caller passed the org in, so a uuid of it on every row tells
        nobody anything and gives a careless screen one more id to render.
        `client_id` and `engagement_id` stay — those are what a link is made of.
        """
        assert "AS org_id" not in lifecycle._ENGAGEMENT_COLS
        assert "AS org_id" not in lifecycle._EXIT_COLS
        for sql in TestTheSqlShape.ALL:
            assert "AS org_id" not in sql


# ══ the migration and the Python must agree ══════════════════════════════════

def _sql() -> str:
    """Migration 163 with its `--` comments removed.

    NOT optional decoration. 163 is two thirds prose, and that prose QUOTES the
    statements it is describing — "both CREATE TABLE and all six CREATE INDEX
    are IF NOT EXISTS", "`SET LOCAL lock_timeout` below". Every structural
    assertion below matched the comment instead of the code on the first run and
    passed or failed for the wrong reason. A file that explains itself at length
    is a file whose tests must read the code and not the explanation.

    Single-quoted literals are stepped over rather than scanned, because a `--`
    inside one is data. There are none in 163 today; the day somebody seeds a
    row containing a dash is not the day to discover this.
    """
    text = MIGRATION.read_text(encoding="utf-8")
    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "'":
            j = text.find("'", i + 1)
            j = n if j == -1 else j + 1
            out.append(text[i:j])
            i = j
        elif ch == "-" and text.startswith("--", i):
            nl = text.find("\n", i)
            i = n if nl == -1 else nl
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _check_allowlist(name: str) -> set[str]:
    """Pull the quoted values out of one named `... = ANY (ARRAY[...])` CHECK.

    `CONSTRAINT\\s+name` and not `f"CONSTRAINT {name} "`: several of 163's
    constraints wrap onto the next line before the CHECK, and a literal trailing
    space silently found nothing.
    """
    sql = MIGRATION.read_text(encoding="utf-8")
    match = re.search(rf"CONSTRAINT\s+{re.escape(name)}\b", sql)
    assert match, f"migration 163 has no constraint named {name}"
    open_bracket = sql.index("ARRAY[", match.end())
    close_bracket = sql.index("]", open_bracket)
    return set(re.findall(r"'([^']+)'", sql[open_bracket:close_bracket]))


class TestTheMigrationAndThePythonAgree:
    """The vocabularies are in two files. Nothing but this notices a drift.

    Python classifying a type the database refuses to store fails in front of a
    user as an insert error, not here as a red test — and the specific drift
    that matters is a NEW AUDIT TYPE added to the CHECK and forgotten in
    AUDIT_ENGAGEMENT_TYPES, which would silently stop demanding the predecessor
    letter for it. That is the worst bug this module could ship.
    """

    def test_the_engagement_type_allowlists_are_identical(self):
        assert _check_allowlist("client_engagements_type_ck") == set(ENGAGEMENT_TYPES)

    def test_the_audit_and_non_audit_sets_do_not_overlap(self):
        assert AUDIT_ENGAGEMENT_TYPES & NON_AUDIT_ENGAGEMENT_TYPES == frozenset()

    def test_every_type_ending_in_audit_is_classified_as_one(self):
        """A belt-and-braces reading of the naming convention the CHECK promises:
        if a future author adds `esg_audit` to the SQL and forgets the frozenset,
        this fails before anyone notices the behaviour.

        `other_non_audit` ALSO ends in "_audit", which is the trap this test fell
        into on its first run — a suffix rule that reads "audit" out of the word
        "non_audit" would classify the catch-all for everything Clause (8) does
        NOT reach as an audit, and start demanding predecessor letters for
        payroll. Excluded explicitly rather than by renaming the type, because
        the exclusion is the thing worth leaving visible.
        """
        for kind in _check_allowlist("client_engagements_type_ck"):
            if kind.endswith("_audit") and not kind.endswith("non_audit"):
                assert kind in AUDIT_ENGAGEMENT_TYPES, (
                    f"{kind} is named an audit but is not treated as one"
                )

    def test_the_non_audit_catch_all_is_not_treated_as_an_audit(self):
        """The other half of the trap above, asserted directly."""
        assert "other_non_audit" in NON_AUDIT_ENGAGEMENT_TYPES
        assert "other_non_audit" not in AUDIT_ENGAGEMENT_TYPES
        assert lifecycle.is_audit("other_non_audit") is False

    def test_the_statuses_the_python_filters_on_exist_in_the_check(self):
        allowed = _check_allowlist("client_engagements_status_ck")
        assert set(lifecycle.OPEN_STATUSES) <= allowed
        assert {"completed", "exiting", "closed"} <= allowed

    def test_the_handover_and_billing_vocabularies_match_the_python(self):
        handover = _check_allowlist("client_engagements_handover_status_ck")
        assert {"completed", "not_applicable"} <= handover

        billing = _check_allowlist("client_engagements_final_billing_ck")
        assert {"settled", "written_off", "not_applicable", "invoiced"} <= billing

    def test_the_delivery_outcomes_the_python_reads_exist_in_the_check(self):
        outcomes = _check_allowlist("cepc_outcome_ck")
        assert set(lifecycle._DELIVERED_OUTCOMES) <= outcomes
        assert {"returned_undelivered", "refused", "awaiting"} <= outcomes


class TestTheMigrationIsSafeToApply:
    """The house rules for a migration nobody has applied yet."""

    def test_it_is_idempotent(self):
        sql = _sql()
        assert sql.count("CREATE TABLE IF NOT EXISTS") == 2
        assert "CREATE TABLE staging." not in sql
        for stmt in re.findall(r"CREATE INDEX[^\n]*", sql):
            assert "IF NOT EXISTS" in stmt, stmt
        # ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form, so a second
        # run would abort on it. Every CHECK is inline instead.
        assert "ADD CONSTRAINT" not in sql

    def test_the_lock_timeout_is_inside_a_transaction(self):
        """`SET LOCAL` outside a transaction block is a WARNING and a no-op, so
        the timeout that stops this queueing behind a long transaction on
        ganit_invoices would silently not exist.
        """
        sql = _sql()
        assert sql.index("BEGIN;") < sql.index("SET LOCAL lock_timeout")
        assert sql.rstrip().endswith("COMMIT;")

    def test_it_writes_no_rows(self):
        """Staging and production share this database. A register migration has
        no business inserting anything, and 163 seeds nothing at all.
        """
        # Statement-leading only. A bare substring search calls `ON DELETE
        # CASCADE` a DELETE and fails a migration that writes nothing — which is
        # exactly what it did on the first run.
        banned = ("INSERT", "UPDATE", "DELETE", "DROP", "TRUNCATE", "ALTER")
        for line in _sql().upper().splitlines():
            first = line.strip().split(" ")[0]
            assert first not in banned, f"migration 163 must not {first}: {line.strip()}"


# ══ names, not ids ═══════════════════════════════════════════════════════════

_UUIDISH = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}", re.I)


class TestTheMigrationUnderTheRealGrammar:
    """The string tests above are the floor; this is the ceiling.

    Everything else in this file reads migration 163 as text, and text is a
    weak instrument on a file that is two thirds prose and QUOTES ITS OWN
    STATEMENTS in that prose ("both CREATE TABLE and all six CREATE INDEX are
    IF NOT EXISTS"). The comment stripper those tests rely on already had to be
    made quote-aware once. This class hands the file to PostgreSQL's own
    grammar instead and asks what statements are actually in it, which catches
    two things no substring scan can:

      · a SYNTAX ERROR. Nothing else here would notice one, and the first
        person to find out would be whoever applies this against the shared
        production database.
      · a statement type nobody thought to grep for.

    SKIPPED where pglast is not installed — it is not in requirements.txt and
    this suite must not start requiring it. That is why the text-based
    assertions stay: they run everywhere, this runs where it can.
    """

    def _statements(self):
        pglast = pytest.importorskip(
            "pglast", reason="pglast is optional; the text-based migration tests still run"
        )
        return pglast.parse_sql(MIGRATION.read_text(encoding="utf-8"))

    def test_it_parses(self):
        """A migration that does not parse is a migration that fails halfway
        through against a database staging and production share.
        """
        assert self._statements()

    def test_it_contains_nothing_but_the_two_tables_and_their_indexes(self):
        """The header claims: creates two tables and six indexes, ALTERs
        nothing, DROPs nothing, writes no rows. Asserted against the parse tree
        rather than against the prose that makes the claim.
        """
        kinds = [type(st.stmt).__name__ for st in self._statements()]
        assert kinds.count("CreateStmt") == 2
        assert kinds.count("IndexStmt") == 6
        assert set(kinds) == {
            "TransactionStmt", "VariableSetStmt", "CreateStmt", "IndexStmt",
        }, f"migration 163 contains an unexpected statement type: {sorted(set(kinds))}"

    def test_every_created_object_is_in_the_staging_schema(self):
        """An unqualified CREATE lands wherever search_path points, which on
        this database is `public` — and thirteen shadow tables in `public` are
        why migration 142 exists.
        """
        for st in self._statements():
            node = st.stmt
            if type(node).__name__ in ("CreateStmt", "IndexStmt"):
                assert node.relation.schemaname == "staging", (
                    f"{node.relation.relname} is not schema-qualified"
                )

    def test_every_create_is_if_not_exists(self):
        """The whole idempotency claim, read off the flag PostgreSQL itself
        parsed rather than off the word in the SQL text.
        """
        for st in self._statements():
            node = st.stmt
            if type(node).__name__ in ("CreateStmt", "IndexStmt"):
                assert node.if_not_exists is True, (
                    f"{node.relation.relname} would abort a second run"
                )

    def test_the_lock_timeout_is_genuinely_transaction_local(self):
        """`is_local` is what SET LOCAL compiles to. Outside a transaction block
        it is a WARNING and a silent no-op, and the timeout that stops this file
        queueing behind a long transaction on ganit_invoices would not exist.
        """
        sets = [st.stmt for st in self._statements()
                if type(st.stmt).__name__ == "VariableSetStmt"]
        assert [(v.name, v.is_local) for v in sets] == [("lock_timeout", True)]


class TestNamesNotIds:

    def test_no_gap_text_can_ever_carry_an_id(self):
        """A partner must not be told that "e3f1…-9ac2 is missing its
        predecessor letter". The register knows the client's name; that is what
        it renders.
        """
        broken_entry = engagement(
            engagement_type="statutory_audit",
            had_predecessor=True,
            predecessor_is_ca=True,
            engagement_letter_signed_on=None,
            accepted_on=None,
        )
        broken_exit = exiting(
            records_handover_status="not_started",
            records_handover_ack_by=None,
            portal_access_revoked_at=None,
            final_billing_status="pending",
            final_invoice_id=None,
            retention_anchor_date=None,
            retention_until=None,
        )
        for gap in entry_gaps(broken_entry, []) + exit_gaps(broken_exit):
            assert isinstance(gap, Gap)
            assert not _UUIDISH.search(f"{gap.code} {gap.label} {gap.basis}")

    @pytest.mark.asyncio
    async def test_every_returned_row_carries_the_client_name(self):
        rows = [engagement(engagement_letter_signed_on=None)]
        out = await incomplete_at_entry(_pool(rows, []), ORG)
        assert out[0]["client_name"] == "Sharma Textiles Private Limited"
