"""A skill that needs someone to name a thing cannot run on a schedule.

── Why this file exists ──────────────────────────────────────────────────────

`services/skill_dispatcher.py` refuses to call a handler that declares a
parameter with no default which neither the step's `params`, the registry's
defaults, nor its `runtime_params` supplied. That refusal is correct — passing
`None` into a query is worse — but it means a handler's SIGNATURE silently
decides whether the skill can ever run unattended, and nothing was checking.

Two of the most valuable skills in the marketplace were on the wrong side of it.
`check_gstr1_readiness` and `brief_gstr3b_liability` both required `period`, so
neither could complete a scheduled or one-click run at all. Both now default to
`return_period()`.

── The distinction this test encodes ─────────────────────────────────────────

Some handlers genuinely need a subject and always will:

    get_account_brief(contact_id)     a brief about WHICH client?
    check_expense_policy(expense)     judging WHICH claim?
    score_candidate(candidate)        scoring WHOM?

Those are on-demand skills by nature, and the dispatcher's `runtime_params`
allowlist is exactly the mechanism for them — its own docstring names
`get_account_brief` as the motivating case. They belong in SUBJECT_BOUND below.

Everything else must be answerable from the org and the calendar alone, because
that is what a schedule can supply. A period, a week, a horizon — all of those
have a right answer that a machine can work out at 6am, and a handler that makes
a person type one is a handler nobody automates.

So: adding a required parameter to a handler is a design decision about whether
the skill can ever be scheduled. Make it here, deliberately, or this fails.

Note `user_id` is excluded throughout: the dispatcher injects it
(`supplied.setdefault("user_id", user_id)`), so a handler taking it is not
thereby unschedulable — `get_my_desk` reads correctly as broken and is not.
"""
import asyncio
import inspect
from datetime import date, datetime, timezone

import pytest

from services.skill_dispatcher import SKILL_REGISTRY, _resolve_handler
from services.skills.timeutil import coming_week_start, return_period

#: Handlers whose whole purpose is to answer about one named thing. A schedule
#: cannot choose the thing, so these are on-demand and that is not a defect.
#: Adding a name here is a deliberate statement that the skill is not automatable.
SUBJECT_BOUND = {
    "check_dept_coverage",      # which department's leave is being approved
    "check_expense_policy",     # which claim
    "detect_anomalies",         # which metric
    "execute_onboarding",       # which employee
    "execute_sequence_step",    # which enrolment
    "get_account_brief",        # which client — the dispatcher's own example
    "match_bank_transactions",  # which statement lines; see catalogue #16, the
                                # fix is to feed it the unreconciled backlog
    "score_candidate",          # which applicant
    "send_campaign",            # which campaign
}


def _required_beyond_org(name: str) -> list[str]:
    """Parameters a caller must name for this handler, after every default."""
    _, _, registry_defaults = SKILL_REGISTRY[name]
    handler = asyncio.run(_resolve_handler(name))
    return [
        p_name
        for p_name, p in inspect.signature(handler).parameters.items()
        if p_name not in ("pool", "org_id", "user_id")
        and p.default is inspect.Parameter.empty
        and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
        and p_name not in (registry_defaults or {})
    ]


@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_a_handler_runs_from_the_org_and_the_calendar_alone(skill_function):
    """Unless it is declared subject-bound, a skill must need nothing named."""
    try:
        required = _required_beyond_org(skill_function)
    except Exception as exc:  # an unresolvable handler is a different test's job
        pytest.skip(f"{skill_function} does not resolve: {exc}")

    if skill_function in SUBJECT_BOUND:
        assert required, (
            f"{skill_function} is listed in SUBJECT_BOUND but now needs nothing "
            f"named. Remove it from that set — it can be scheduled."
        )
        return

    assert not required, (
        f"{skill_function} cannot run unattended: it requires {required}, which "
        f"a schedule has no way to supply, so the dispatcher will refuse every "
        f"run. Either give the parameter a sensible default (see "
        f"services/skills/timeutil.py for the calendar ones), add it to the "
        f"registry defaults, or add {skill_function!r} to SUBJECT_BOUND to say "
        f"deliberately that this skill is on-demand only."
    )


def test_the_gst_skills_default_to_the_period_being_filed():
    """Both GST handlers must default, and to the PREVIOUS month, not this one.

    GSTR-1 for August is due 11 September and 3B for August on the 20th, so a
    person opening either in September wants August. Defaulting to the current
    month would hand back a period that is not fileable yet and reads as empty.
    """
    for name in ("check_gstr1_readiness", "brief_gstr3b_liability"):
        assert not _required_beyond_org(name), f"{name} still requires a period"

    assert return_period(datetime(2026, 9, 15, tzinfo=timezone.utc)) == "2026-08"
    assert return_period(datetime(2026, 1, 3, tzinfo=timezone.utc)) == "2025-12"
    assert return_period(datetime(2026, 12, 31, tzinfo=timezone.utc)) == "2026-11"


def test_coverage_looks_at_the_week_you_can_still_fix():
    """Always a future Monday — including when today is a Monday."""
    for day, expected in (
        (datetime(2026, 8, 17, tzinfo=timezone.utc), date(2026, 8, 24)),  # Monday
        (datetime(2026, 8, 19, tzinfo=timezone.utc), date(2026, 8, 24)),  # Wednesday
        (datetime(2026, 8, 23, tzinfo=timezone.utc), date(2026, 8, 24)),  # Sunday
    ):
        got = coming_week_start(day)
        assert got == expected, f"{day:%a %d %b} gave {got}, expected {expected}"
        assert got.weekday() == 0, "a week starts on Monday"
        assert got > day.date(), "coverage is a forward question"
