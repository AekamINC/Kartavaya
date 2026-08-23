"""A report is claimed before it is sent, not after it is sent.

`POST /api/reports/dispatch` is finished code that nothing has ever called —
its own docstring says "called hourly by Railway cron" and no cron existed. It
is being armed now, so the failure modes that only matter once something calls
it matter today.

── THE ONE THAT DECIDED THE ORDER ──────────────────────────────────────────

`next_run_at` moved forward only AFTER every recipient had been mailed, inside
the same `try` as the send. Three ways that mails a customer's client the same
report twice:

  · A schedule with three recipients where the second address fails. The
    exception skips the UPDATE, the row is still due, and the next hour mails
    all three again — including the one that already received it.
  · The container dying between the send and the UPDATE. Railway restarts it;
    the row is still due.
  · Two invocations overlapping. It runs hourly on a job that can take minutes,
    and both would read the same due row.

`OUTBOUND_MODE` has been `live` since 2026-08-18, so all three send real mail.

The row is now CLAIMED first: `next_run_at` moves in a conditional UPDATE that
takes only if the row is still due, so a second worker matches nothing and
skips.

── THE TRADE, WHICH IS DELIBERATE ──────────────────────────────────────────

A send that fails is SKIPPED rather than retried. For outbound mail that is the
right way round: a missed report is visible and recoverable — the next one
covers a longer window and `last_sent_at` stands still on the schedules panel —
while a duplicate is already in somebody's client's inbox and no amount of
retrying takes it back.
"""
import inspect
import re

from routers import reports


def _code(fn) -> str:
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.lstrip().startswith("#")
    )


def test_the_claim_happens_before_any_mail_is_sent():
    code = _code(reports.dispatch_reports)
    assert code.index("UPDATE public.report_schedules") < code.index("send_report_email"), (
        "the schedule is still being marked after the send — a failure on the "
        "second recipient re-mails the first an hour later"
    )


def test_the_claim_is_conditional_on_the_row_still_being_due():
    """Not a bare UPDATE by id. Two overlapping invocations both read the same
    due row from the SELECT; only one may take it."""
    code = _code(reports.dispatch_reports)
    claim = re.search(r"UPDATE public\.report_schedules.{0,400}", code, re.S)
    assert claim, "the claim is no longer recognisable"
    assert "next_run_at <= $3" in claim.group(0), (
        "the claim does not re-check that the row is due, so it cannot fence "
        "off a concurrent invocation"
    )
    assert "RETURNING schedule_id" in claim.group(0)


def test_a_schedule_someone_else_claimed_is_skipped_and_not_sent():
    code = _code(reports.dispatch_reports)
    assert "if not claimed:" in code
    tail = code[code.index("if not claimed:"):][:400]
    assert "continue" in tail
    assert "send_report_email" not in tail


def test_the_success_update_no_longer_moves_the_schedule():
    """`next_run_at` moved at the claim. Writing it again after the send would
    put back the window the claim exists to close."""
    code = _code(reports.dispatch_reports)
    success = code[code.index("SET last_sent_at"):][:200]
    assert "next_run_at" not in success


def test_last_sent_at_still_records_only_a_real_send():
    """It is what tells an operator the difference between "sent" and "was due
    and did not go" — so it must not be written by the claim."""
    code = _code(reports.dispatch_reports)
    claim = re.search(r"UPDATE public\.report_schedules.{0,400}", code, re.S).group(0)
    assert "last_sent_at" not in claim


def test_the_org_scope_is_still_opened_per_schedule():
    """Not once around the loop. This cron walks every team in the product, so
    a scope set once files every report after the first under the previous org
    — which is worse than the NULL it replaced, because it reads as a fact.

    Fixed in `9b085413`; pinned here because arming the cron is what makes it
    matter.
    """
    code = _code(reports.dispatch_reports)
    assert "with org_scope(sched[" in code
    assert code.index("for sched in due:") < code.index("with org_scope(")


def test_the_org_comes_from_the_team_and_not_from_a_backlink():
    """`teams.org_id` is canonical. `organisations.team_id` runs the opposite
    way and names only the founding team — migration 199 settled that."""
    code = _code(reports.dispatch_reports)
    assert "t.org_id AS team_org_id" in code


def test_a_failure_leaves_the_schedule_moved_on_rather_than_due():
    """The trade, asserted so nobody reverses it by accident while making
    retries "better"."""
    code = _code(reports.dispatch_reports)
    handler = code[code.index("except Exception as exc:"):]
    assert "next_run_at" not in handler, (
        "the failure path now rewinds the schedule — that reintroduces the "
        "duplicate send this ordering exists to prevent"
    )
