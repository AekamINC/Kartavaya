"""The dunning selector reached three documents nobody is owed money on.

FOUND BY READING A LIVE REMINDER, NOT BY READING THE CODE
--------------------------------------------------------
Phase 2 closed "draft invoices are dunned and counted as revenue" across four
surfaces on 2026-08-26. `services/reminder_service.py::_INVOICE_SCAN` was not
one of them — and it is the surface that actually sends the email. The four
that were fixed all *display* a number; this one puts a letter in front of a
customer.

Live at the time of writing, both in-scope organisations: **359** rows in
`staging.reminders` with `reminder_type='invoice_overdue'` pointed at documents
these guards exclude. 347 were in E2E Test & Associates, where the outbound
fence held them at `status='suppressed'`. **12 were in Unicode Group, where it
did not, and they carry `status='sent'`.**

Of the 228 invoices the selector matched before this change, 174 survive it —
so 54 documents were being dunned that nobody owes anything on.

WHY THESE THREE, AND WHY `balance_due` RATHER THAN THE STATUS COLUMN
-------------------------------------------------------------------
They are the same family `record_payment` refuses, seen from the other side. A
receipt against them is wrong because the money cannot be owed; a dunning letter
is wrong for exactly the same reason, so the two paths should agree.

The third guard is the one that could not have been written from the status
column. `payment_status='unpaid'` on a zero-total invoice is not a contradiction
the product prevents — INV-2026-0007 and INV-2026-0047 both read exactly that,
and only one of them came from this session's ledger repair, so the shape
predates it. Status is a label somebody set; the balance is arithmetic. Guard on
the arithmetic.

WHAT THE ASSERTIONS CAN AND CANNOT PROVE
----------------------------------------
`routers/messaging.py:30-41` records what a mocked pool is worth: a fake cursor
resolves any table you hand it, so an HTTP test proves the handler ASKED, never
that the database could answer. These therefore assert on the SQL text, the same
way `test_reminder_scan.py` does — and `test_reminder_scan.py::test_every_column_exists`
is what proves the columns named here are real, by checking them against the
live schema map. The two files are complementary and neither is sufficient alone.
"""
import re

import services.reminder_service as rs


def _sql() -> str:
    """The scan with SQL comments stripped, so prose can never satisfy a grep.

    The module's own header explains the rule: a `--` comment inside the SQL
    would let a future version pass these tests with an explanation of itself
    rather than with a WHERE clause.
    """
    return re.sub(r"--[^\n]*", "", rs._INVOICE_SCAN)


class TestTheSelectorRefusesWhatCannotBeOwed:

    def test_a_draft_is_not_dunned(self):
        sql = _sql()
        assert "doc_status" in sql, (
            "the dunning cron still chases unissued documents — nobody has been "
            "sent them, so nobody can be late paying:\n" + sql
        )
        assert "COALESCE(i.doc_status, '')" in sql, (
            "guard is not nullable-safe; every row predating the column drops "
            "out of dunning entirely:\n" + sql
        )
        assert "<> 'draft'" in sql, sql

    def test_a_credit_note_is_not_dunned(self):
        sql = _sql()
        assert "invoice_type" in sql, (
            "a credit note is money owed the OTHER way; dunning one asks the "
            "customer to pay for a refund you owe them:\n" + sql
        )
        assert "<> 'credit_note'" in sql, sql

    def test_a_zero_balance_is_not_dunned(self):
        """The guard the status column could not supply.

        This is the one with a live sending to its name: 'Invoice INV-2026-0007
        is overdue. Balance: Rs 0.00', sent 2026-08-26 13:04 UTC, and it would
        have repeated every three days indefinitely.
        """
        sql = _sql()
        assert "i.balance_due > 0" in sql, (
            "an invoice with nothing outstanding is still dunned, and the "
            "message renders the balance it is chasing as zero:\n" + sql
        )

    def test_the_ordinary_overdue_invoice_still_qualifies(self):
        """THE REGRESSION GUARD. Three conditions were added to the only path
        that chases money; the ordinary case must be untouched."""
        sql = _sql()
        assert "i.payment_status NOT IN ('paid', 'void')" in sql, sql
        assert "i.due_date < NOW()" in sql, sql
        assert "i.is_active = TRUE" in sql, sql

    def test_the_three_day_dedupe_survived(self):
        """The guards were inserted above the NOT EXISTS block. If that block
        were displaced, every overdue invoice would be re-dunned on every tick
        — a worse failure than the one being fixed."""
        sql = _sql()
        assert "INTERVAL '3 days'" in sql, sql
        assert "reminder_type = 'invoice_overdue'" in sql, sql


class TestTheMessageStillReadsFromTheRowItSelected:

    def test_the_balance_is_still_projected(self):
        """`_invoice_row` interpolates `row['balance_due']` into the message.
        A guard that filtered on a column the SELECT stopped returning would
        raise at send time, not scan time — the failure would surface a tick
        later and in a different function."""
        assert "i.balance_due" in _sql()

    def test_the_message_names_the_invoice_and_the_balance(self):
        row = {
            "org_id": "11111111-1111-1111-1111-111111111111",
            "entity_id": "22222222-2222-2222-2222-222222222222",
            "recipient": "user_1",
            "invoice_number": "INV-2026-0007",
            "balance_due": 590,
        }
        message = rs._invoice_row(row)[-1]
        assert "INV-2026-0007" in message
        assert "590" in message
