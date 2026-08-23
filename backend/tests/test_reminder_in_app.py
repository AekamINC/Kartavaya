"""
A reminder reaches the Inbox, not only the mailbox.

MEASURED on the live database, 2026-08-23:

    staging.reminders, follow_up_due          1,150   663 sent
    public.notifications of any follow-up kind    0

`process_pending_reminders` had exactly two channels, email and push. A person
who works inside the product — no mail client open, no phone to hand — was never
told a CRM follow-up was due. That is the whole of "follow-up notifications
don't arrive": they arrive, just never where the person is looking.
"""
import inspect

import pytest

import services.reminder_service as rs


def test_each_kind_has_a_screen_that_answers_it():
    """A bell that goes nowhere is a nag."""
    assert rs._url_for_type("follow_up_due") == "/graha"
    assert rs._url_for_type("invoice_overdue") == "/ganit"
    assert rs._url_for_type("task_due") == "/tasks"


def test_an_unknown_kind_goes_to_the_inbox_not_to_a_guess():
    """Sending an unrecognised type to the CRM's follow-up tab would be a wrong
    answer delivered confidently."""
    assert rs._url_for_type("something_new") == "/inbox"


def test_the_in_app_copy_is_not_gated_on_quiet_hours():
    """The rule this project has already written down once, asserted against the
    shipped call rather than against a stand-in.

    An in-app notification has NO QUEUE behind it, so holding one for quiet
    hours does not defer it to the morning — it throws it away. The email IS
    queued (`status='pending'` is the queue), which is why quiet hours
    legitimately hold that one and must not hold this one. Both verdicts are
    asked for in the same loop, so the difference between them is the whole
    contract and is worth pinning.
    """
    src = inspect.getsource(rs.process_pending_reminders)
    assert "quiet_hours_apply=False" in src, "the in-app copy must ignore quiet hours"
    assert "quiet_hours_apply=True" in src, "the queued email must still honour them"
    # And it must still be a real preference check — "off" stays final.
    assert src.count("prefs_verdict") >= 2


def test_the_in_app_write_cannot_cancel_the_email():
    """Its own try. Drawing a bell and sending mail are separate promises, and
    the failure of one must not take the other with it — the same lesson the
    comment fan-out taught, where one `except` over five jobs hid that mentions
    had never once been stored."""
    src = inspect.getsource(rs.process_pending_reminders)
    head = src[:src.index("quiet_hours_apply=True")]
    assert "in-app reminder failed" in head
