"""`outbound_log` must record WHICH ADDRESS a message went out as.

── The gap, measured 2026-08-30 ────────────────────────────────────────────────

Live production, 336 rows:

    SELECT string_agg(DISTINCT k, ', ')
      FROM public.outbound_log, LATERAL jsonb_object_keys(detail) AS k;
    -> "mode, ref"

The From address was in neither, and there is no column for it. So the ledger
could not answer *"which address did this go out as?"* — the single question the
whole senders feature exists to control.

That matters because `email_senders.pick_from` has FIVE documented ways to fall
back to `FROM_EMAIL`, four of them live right now: no purpose, no bucket, no row
for the org, a row that is not verified, or the lookup failing. An org can
configure `payroll@theirdomain` and still have every payslip go out as
`no-reply@kartavaya.com` — and nothing in the ledger would say so. The only way
to find out was to reproduce it.

It was also the reason a question could not be answered on 2026-08-30: asked
whether the Unicode org's configured senders had ever been used, the log could
not say, because it never recorded the answer.

── Why it was missing, which is the interesting half ───────────────────────────

Threading, not neglect. `outbound.begin()` runs on the CALLER's thread — it has
to, it is the last line guaranteed to see the request context, and that is how
fourteen senders with no org parameter still get an org. But the address is
resolved LATER, in the SENDING thread (`email_service.py`, "RESOLVED HERE, in the
sending thread"), deliberately, because resolving may hit the database for the
org's row and blocking is free there and costly on the caller.

So at `begin()` time the address genuinely is not known. `Attempt.sender()` is
the setter that closes the window: `_finish` writes the WHOLE row rather than a
delta, so anything recorded before completion lands in the same INSERT.
"""
import pytest

import outbound


def _attempt():
    """A bare Attempt, no gate and no database — this is a pure-data test.

    `begin()` reads module state, a ContextVar and the email cap; none of that is
    what is under test here. The behaviour under test is entirely "does the
    address reach `fields['detail']`", so the Attempt is built directly.
    """
    return outbound.Attempt(False, {
        "id": "00000000-0000-0000-0000-000000000001",
        "detail": None,
    })


def test_the_sender_is_recorded_in_detail():
    att = _attempt()
    att.sender("Kartavaya <payroll@unicodegroup.com>")
    assert att._fields["detail"]["from"] == "Kartavaya <payroll@unicodegroup.com>"


def test_it_merges_rather_than_replacing_the_context():
    """`detail` already carries the caller's context — a run id, a device count.

    Replacing it would trade one missing fact for another.
    """
    att = outbound.Attempt(False, {
        "id": "00000000-0000-0000-0000-000000000002",
        "detail": {"run_id": "PR-2026-08", "suppressed_by": "org"},
    })
    att.sender("no-reply@kartavaya.com")
    d = att._fields["detail"]
    assert d["from"] == "no-reply@kartavaya.com"
    assert d["run_id"] == "PR-2026-08", "the caller's context was dropped"
    assert d["suppressed_by"] == "org", "the suppression reason was dropped"


def test_it_does_not_mutate_the_callers_dict():
    """The caller's dict is the caller's — the same rule `begin()` follows when
    it adds `suppressed_by` on a COPY."""
    context = {"run_id": "PR-2026-08"}
    att = outbound.Attempt(False, {"id": "x", "detail": context})
    att.sender("no-reply@kartavaya.com")
    assert "from" not in context, "sender() mutated the dict the caller passed in"


@pytest.mark.parametrize("value", [None, ""])
def test_an_absent_address_never_overwrites_a_real_one(value):
    """`resolve()` cannot return "" — but if it ever did, the last real value
    must win. A row that loses its sender is the bug this file exists to stop."""
    att = _attempt()
    att.sender("payroll@unicodegroup.com")
    att.sender(value)
    assert att._fields["detail"]["from"] == "payroll@unicodegroup.com"


def test_it_never_raises_and_never_breaks_the_send():
    """Nothing in outbound may become the sender's problem. A detail column that
    cannot be built is worth losing; a payslip is not."""
    att = outbound.Attempt(False, {"id": "x", "detail": object()})  # unmergeable
    att.sender("no-reply@kartavaya.com")   # must not raise


def test_email_service_records_the_sender_at_every_resolve_site():
    """Every place that resolves a From must also record it.

    Static, and deliberately so: exercising the real send path needs SES, a
    thread and a pool, and a mocked version of all three would be testing the
    mock. What must stay true is that no `from_plan.resolve()` is left without an
    `att.sender()` beside it — and that is exactly checkable.

    Mutation-proved: delete either `att.sender(from_email)` line and this fails.
    """
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "email_service.py").read_text(
        encoding="utf-8-sig"
    )
    resolves = src.count("from_email = from_plan.resolve()")
    records = src.count("att.sender(from_email)")
    assert resolves > 0, "the resolve site moved — this test is now checking nothing"
    assert records == resolves, (
        f"{resolves} site(s) resolve a From address but only {records} record it. "
        "Every resolve must be followed by att.sender(from_email), or that "
        "message's row cannot say which address it went out as."
    )
