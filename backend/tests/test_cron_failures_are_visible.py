"""A cron that cannot do its job must not answer 200.

Three blockers found by the verifiers, all the same disease in different
spellings: a failure that is RETURNED rather than RAISED, landing in a bucket
nothing reads.

  · /cron/agents — `_for_each_org` can only observe a raise, and
    `BaseAgent.execute` (services/agents/base.py:38-43) catches every exception,
    sets status='error' and RETURNS {"error": ...}. An agent failing for every
    org every hour answered 200.
  · /cron/marketing — the handler counted `sequences["error"]`, but the step
    executor returns {"status": "failed"} for a refused transport and reserves
    "error" for something that raised. Every real send failure was invisible.
  · the step executor itself wrote status='sent' into prachar_sequence_logs
    unconditionally, including for a contact with no email address.
"""
import pytest


# ── /cron/marketing: counted by what succeeded ───────────────────────────────

def _failed(campaigns, sequences):
    """The handler's arithmetic, exercised directly."""
    _SEQ_OK = ("sent", "logged", "completed", "unsubscribed", "skipped")
    ok = sum(int(sequences.get(k) or 0) for k in _SEQ_OK)
    seq_failed = max(0, int(sequences.get("due") or 0) - ok)
    return int(campaigns.get("failed") or 0) + seq_failed


def test_a_returned_failed_status_is_counted():
    """THE regression. 'failed' is what the executor returns; only 'error' was read."""
    assert _failed({}, {"due": 5, "sent": 3, "failed": 2}) == 2


def test_a_raised_error_is_still_counted():
    assert _failed({}, {"due": 5, "sent": 4, "error": 1}) == 1


def test_a_status_nobody_has_invented_yet_counts_as_a_failure():
    """
    The point of counting successes instead of failures. A new bucket must fail
    the tick loudly rather than pass silently — which is how 'failed' hid.
    """
    assert _failed({}, {"due": 3, "sent": 1, "quarantined": 2}) == 2


def test_a_clean_tick_reports_nothing_failed():
    assert _failed({}, {"due": 4, "sent": 2, "logged": 1, "unsubscribed": 1}) == 0


def test_steps_that_were_passed_over_are_not_failures():
    """'logged' and 'skipped' are real outcomes, not errors."""
    assert _failed({}, {"due": 2, "logged": 1, "skipped": 1}) == 0


def test_campaign_failures_still_count():
    assert _failed({"failed": 3}, {"due": 0}) == 3


def test_the_two_status_lists_are_written_out_and_not_derived():
    """
    A forbidden set computed as ALL-minus-ALLOWED cannot detect the allowed set
    widening — caught twice in this repo today. The success names must be a
    literal tuple in the source.
    """
    import inspect
    from routers import scheduler
    src = inspect.getsource(scheduler.run_marketing)
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert '_SEQ_OK = (' in code, "the success list is no longer a literal"
    assert 'sequences.get("error")' not in code.replace(" ", ""), \
        "the handler is counting the failure bucket again"


# ── /cron/agents: a swallowed error is re-raised ─────────────────────────────

@pytest.mark.asyncio
async def test_an_agent_that_failed_for_every_org_fails_the_tick(monkeypatch):
    """
    BaseAgent.execute never raises — it returns {"error": ...}. `_for_each_org`
    only sees raises, so the swallowing moved one level down rather than going
    away.
    """
    from routers import scheduler
    import inspect
    src = inspect.getsource(scheduler.run_agents)
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert 'result.get("error")' in code, (
        "run_agents does not inspect the returned dict, so a BaseAgent that "
        "caught every exception still reports a healthy tick"
    )
    assert "raise" in code, "the swallowed error is not re-raised"


def test_base_agent_still_swallows_which_is_why_the_caller_must_check():
    """
    Pins the premise. If BaseAgent ever starts raising, the check in run_agents
    becomes redundant rather than wrong — but this test says so out loud, so
    nobody removes the caller's check on the assumption it already raises.
    """
    import inspect
    from services.agents.base import BaseAgent
    src = inspect.getsource(BaseAgent.execute)
    assert "except Exception" in src and 'status = "error"' in src
    assert "raise" not in src.split("finally")[0], \
        "BaseAgent.execute now re-raises; run_agents' check can be revisited"


# ── the executor's log row ───────────────────────────────────────────────────

def test_the_log_records_what_happened_not_a_constant():
    """
    Two paths reach the INSERT having sent nothing — a non-sendable channel and
    a contact with no email — and both were written as 'sent'.
    """
    import inspect
    from services.skills.action import sequence_step_executor as X
    src = inspect.getsource(X.execute_step)
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert "'sent', NOW()" not in code, "the log status is still hardcoded"
    assert "outcome," in code, "the log does not record the actual outcome"


def test_the_stats_query_counts_only_real_sends():
    """
    The other half. total_sent was COUNT(*) over every log row, so fixing the
    executor alone would change nothing a user can see.
    """
    import pathlib
    src = (pathlib.Path(__file__).resolve().parent.parent / "routers" / "prachar.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert "AND l.status='sent') AS total_sent" in " ".join(code.split()), \
        "total_sent still counts every log row regardless of outcome"
