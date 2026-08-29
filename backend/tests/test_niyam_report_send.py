"""S4/N12 — scheduled reports delivered through Niyam, and only to members.

The `dristi_scheduled_reports` table shipped in migration 027 with a UI that
saves rows and NOTHING that delivers them: `/cron/reports` is a 501 stub and
the in-router dispatcher was triple-gated off. The delivery that now exists is
the `reports_due` predicate (one event per schedule per day, at its appointed
day and hour) plus the `report.send` verb (render the module page's own
letterhead document, mail it to the schedule's recipients — cut to MEMBERS).

What these tests pin, in order of how expensive the regression would be:

  * the recipient cut. A schedule's recipient list is free text; the verb
    mails exactly the addresses that belong to members of THIS org and skips
    the rest BY COUNT, in words. Nothing Niyam mails on a timer leaves the
    firm.
  * `last_sent_at` is stamped on the SAME connection as the send, because the
    predicate's "already sent today" guard reads that column.
  * every `dristi_report_logs` row carries org_id — the live table gained the
    column precisely because org-NULL log rows are invisible to the per-org
    log view forever.
  * the window arithmetic (`schedule_window`): first send spans one period;
    thereafter it runs since `last_sent_at`; a resumed schedule cannot build
    a five-year query.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from services.module_report import (
    FIRST_SPAN_DAYS, REPORT_TYPE_MODULES, member_recipients, schedule_window,
)
from services.analytics_window import MAX_SPAN_DAYS
from services.niyam.actions import ACTIONS
from services.niyam.send import Delivery


# ── the window arithmetic ────────────────────────────────────────────────────

def test_first_send_spans_one_period():
    for freq, days in FIRST_SPAN_DAYS.items():
        win = schedule_window(freq, None)
        assert win.end == date.today()
        assert (win.end - win.start).days == days


def test_after_the_first_send_the_window_runs_since_last_sent():
    last = datetime.now(timezone.utc) - timedelta(days=3)
    win = schedule_window("weekly", last)
    assert win.start == last.date()
    assert win.end == date.today()


def test_a_resumed_schedule_cannot_build_a_five_year_query():
    last = datetime.now(timezone.utc) - timedelta(days=4000)
    win = schedule_window("monthly", last)
    assert win.days <= MAX_SPAN_DAYS


def test_a_future_last_sent_collapses_to_today_not_an_inverted_range():
    last = datetime.now(timezone.utc) + timedelta(days=2)
    win = schedule_window("daily", last)
    assert win.start == win.end == date.today()


def test_custom_reports_have_no_module_on_purpose():
    """'custom' is dashboard-backed; rendering a module page under its name
    would mail a guess with the right title on it."""
    assert "custom" not in REPORT_TYPE_MODULES
    assert set(REPORT_TYPE_MODULES) == {"overview", "revenue", "pipeline",
                                        "hr", "sales"}


# ── the member cut ───────────────────────────────────────────────────────────

class _MemberPool:
    def __init__(self, member_emails):
        self.member_emails = member_emails
        self.asked = []

    async def fetch(self, q, *a):
        self.asked.append((q, a))
        assert "FROM public.users" in q and "public.user_roles" in q
        wanted = a[1]
        return [{"email": e} for e in self.member_emails if e in wanted]


@pytest.mark.asyncio
async def test_recipients_are_normalised_deduped_and_cut_to_members():
    pool = _MemberPool(["priya@firm.in"])
    members, skipped = await member_recipients(
        pool, "org1",
        ["  Priya@Firm.in ", "priya@firm.in", "outsider@gmail.com", "", "junk"])
    assert members == ["priya@firm.in"]
    # outsider@gmail.com is the one usable-but-not-member address; the empty
    # string and the @-less junk never counted as recipients at all.
    assert skipped == 1


@pytest.mark.asyncio
async def test_no_usable_address_asks_the_database_nothing():
    pool = _MemberPool([])
    members, skipped = await member_recipients(pool, "org1", ["", "junk", None])
    assert members == [] and skipped == 0
    assert pool.asked == [], "an empty list must not round-trip to the DB"


# ── the verb ─────────────────────────────────────────────────────────────────

SCHEDULE = {
    "org_id": "org1", "name": "Monday revenue", "report_type": "revenue",
    "frequency": "weekly",
    "recipients": ["priya@firm.in", "outsider@gmail.com"], "is_active": True,
    "last_sent_at": None, "created_by": "owner-1",
}


class _Conn:
    """The verb's whole world: schedule row, member rows, a ledger of writes."""

    def __init__(self, schedule=SCHEDULE, members=("priya@firm.in",)):
        self.schedule = dict(schedule) if schedule else None
        self.members = list(members)
        self.executed = []

    async def fetchrow(self, q, *a):
        if "FROM public.dristi_scheduled_reports" in q:
            return self.schedule
        # The guarded stamp is a write the assertions read — recorded here
        # because it runs through fetchrow (UPDATE ... RETURNING id) now.
        if "SET last_sent_at = NOW()" in q:
            self.executed.append((q, a))
            return {"id": a[0]}
        if "FROM public.organisations" in q:
            return None
        return None

    async def fetch(self, q, *a):
        if "FROM public.users" in q:
            wanted = a[1]
            return [{"email": e} for e in self.members if e in wanted]
        return []

    async def execute(self, q, *a):
        self.executed.append((q, a))
        return "OK"


@pytest.fixture
def quiet_render(monkeypatch):
    """The render is proven by the module-report suite; here it is stubbed so
    the verb's tests are about delivery, not WeasyPrint. The entitlement
    check is stubbed to "allowed" the same way — it has its own test below,
    and these tests are about what happens after it says yes."""
    import services.module_report as mr
    monkeypatch.setattr(mr, "render_report_html",
                        lambda org, label, period, widgets: "<html>doc</html>")

    async def _allowed(pool, schedule):
        return ""

    monkeypatch.setattr(mr, "schedule_blocked_reason", _allowed)


@pytest.fixture
def sent(monkeypatch):
    """Capture deliveries; every one succeeds unless the test says otherwise."""
    import services.niyam.send as send
    out = []

    async def _fake(conn, *, address, subject, html_document, ref):
        out.append({"address": address, "subject": subject,
                    "html": html_document, "ref": ref})
        return Delivery("ok", "captured")

    monkeypatch.setattr(send, "deliver_report_email", _fake)
    return out


def _event(entity_id="s1", org_id="org1", name="Monday revenue"):
    return {"entity_id": entity_id, "org_id": org_id,
            "payload": {"after": {"name": name}}}


@pytest.mark.asyncio
async def test_the_happy_path_sends_stamps_and_logs(quiet_render, sent):
    conn = _Conn()
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "ok", result.detail

    assert [s["address"] for s in sent] == ["priya@firm.in"]
    assert sent[0]["html"] == "<html>doc</html>"
    assert "Monday revenue" in sent[0]["subject"]

    stamps = [q for q, _ in conn.executed
              if "SET last_sent_at = NOW()" in q]
    assert stamps, "last_sent_at was not stamped — the predicate's " \
                   "'already sent today' guard reads it"
    logs = [(q, a) for q, a in conn.executed if "dristi_report_logs" in q]
    assert len(logs) == 1
    log_q, log_a = logs[0]
    assert "org_id" in log_q, "an org-NULL log row is invisible to the org"
    assert "'sent'" in log_q
    assert log_a[2] == 1                       # recipients_count = one member
    assert "skipped" in (log_a[3] or "")       # ...and the outsider is stated

    # The runs pane must never print an inbox.
    assert "priya@firm.in" not in str(result.detail)
    assert "skipped" in str(result.detail)


@pytest.mark.asyncio
async def test_a_vanished_schedule_refuses(quiet_render, sent):
    conn = _Conn(schedule=None)
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "refused"
    assert sent == []


@pytest.mark.asyncio
async def test_a_switched_off_schedule_refuses_at_run_time(quiet_render, sent):
    """The row is re-read on the run's connection: a schedule disabled between
    the sweep and the run is honoured as disabled."""
    conn = _Conn(schedule={**SCHEDULE, "is_active": False})
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "refused"
    assert sent == []
    assert not any("last_sent_at" in q for q, _ in conn.executed)


@pytest.mark.asyncio
async def test_a_custom_report_refuses_in_words(quiet_render, sent):
    conn = _Conn(schedule={**SCHEDULE, "report_type": "custom"})
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "refused"
    assert "custom" in result.detail["reason"]
    assert sent == []


@pytest.mark.asyncio
async def test_all_outsiders_refuses_and_logs_a_skip_row(quiet_render, sent):
    conn = _Conn(members=())
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "refused"
    assert "members only" in result.detail["reason"]
    assert sent == []
    logs = [(q, a) for q, a in conn.executed if "dristi_report_logs" in q]
    assert len(logs) == 1 and "'skipped'" in logs[0][0]
    assert "org_id" in logs[0][0]
    # Refusal must NOT stamp last_sent_at — tomorrow's sweep should retry
    # and keep saying so, visibly, until somebody fixes the recipient list.
    assert not any("last_sent_at" in q for q, _ in conn.executed)


@pytest.mark.asyncio
async def test_every_handover_failing_is_a_failure_and_still_stamps(
        quiet_render, monkeypatch):
    """Stamp-FIRST is the contract, deliberately: the engine gives an action
    no transaction and a sent email cannot be rolled back, so the choice is
    which failure costs less — stamp-first loses one visibly-failed day
    ('failed' log row, retried by the predicate's grace tomorrow because
    a failed run is still a rare event), stamp-last let the stranded-run
    reaper re-execute the loop and mail every member twice. The review that
    flipped this found the old test pinning the double-blast ordering."""
    import services.niyam.send as send

    async def _dead(conn, **kw):
        return Delivery("failed", "the email layer refused the handover")

    monkeypatch.setattr(send, "deliver_report_email", _dead)
    conn = _Conn()
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "failed"
    assert any("SET last_sent_at = NOW()" in q for q, _ in conn.executed), \
        "the stamp must precede delivery — stamp-last re-mails the org on resume"
    logs = [q for q, _ in conn.executed if "dristi_report_logs" in q]
    assert logs and "'failed'" in logs[0]


@pytest.mark.asyncio
async def test_already_sent_today_refuses_without_mailing(quiet_render, sent):
    """The duplicate guard: two rules on report.due, a same-window dristi
    sweep, or a resumed run all arrive here and leave at the re-check."""
    today = datetime.now(timezone.utc)
    conn = _Conn(schedule={**SCHEDULE, "last_sent_at": today})
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "refused"
    assert "already sent today" in result.detail["reason"]
    assert sent == []
    assert not any("SET last_sent_at" in q for q, _ in conn.executed)


@pytest.mark.asyncio
async def test_a_blocked_owner_refuses_before_any_render(monkeypatch, sent):
    """Entitlement is re-checked against the schedule's OWNER at delivery —
    the same rule the other two doors enforce. A creator who lost the source
    module keeps the schedule row; they must stop receiving the books."""
    import services.module_report as mr

    async def _blocked(pool, schedule):
        return "owner owner-1 can no longer reach ganit, which report type 'revenue' reads"

    monkeypatch.setattr(mr, "schedule_blocked_reason", _blocked)
    conn = _Conn()
    result = await ACTIONS["report.send"].run(conn, config={}, event=_event())
    assert result.outcome == "refused"
    assert "can no longer reach" in result.detail["reason"]
    assert sent == []
    assert not any("SET last_sent_at" in q for q, _ in conn.executed)


def test_describe_names_the_report_not_the_uuid():
    text = ACTIONS["report.send"].describe({}, _event(name="Monday revenue"))
    assert "Monday revenue" in text
    assert "s1" not in text


# ── one spine, two doors ─────────────────────────────────────────────────────

def test_the_dristi_run_now_path_renders_the_same_document():
    """Proposal 65 S4: retire the JSON-dump body. run-now and report.send must
    resolve the same arrangement and render the same letterhead — proven by
    both importing the delivery pieces from services/module_report rather
    than keeping private copies."""
    import inspect

    import routers.dristi as dristi

    src = inspect.getsource(dristi._deliver_scheduled_report)
    for name in ("REPORT_TYPE_MODULES", "member_recipients",
                 "module_arrangement", "render_report_html",
                 "schedule_window"):
        assert name in src, f"run-now no longer shares {name} with report.send"
    assert "<pre>" not in src, "the JSON-dump body is back"


def test_report_send_is_in_the_allowlist_and_validated():
    from services.niyam.validate import RuleInvalid, validate_steps

    steps = validate_steps("report.due", [
        {"kind": "action", "config": {"verb": "report.send"}},
    ])
    assert steps
    with pytest.raises(RuleInvalid):
        validate_steps("report.due", [
            {"kind": "action",
             "config": {"verb": "report.send", "recipients": ["x@y.z"]}},
        ])
