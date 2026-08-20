"""Every skill must say what it cannot see — under a name a reader will find.

── Why this file exists ──────────────────────────────────────────────────────

These outputs go to chartered accountants, and most of them go there THROUGH A
LANGUAGE MODEL: a template's data step returns this dict and a later step is
asked to write prose from it. So a caveat the model does not recognise is a
caveat the reader never sees, and the handler's honesty evaporates somewhere
between the query and the page.

Sixty-one skills were built across several sessions and several authors, and
they converged on FIVE names for the same thing:

    limitations        the handlers written to the swarm contract — the majority
    caveats            people_checks.brief_statutory_dues
    caveat             SINGULAR, set conditionally by four Phase-2 handlers:
                       gst_readiness, lead_triage, payables_run, project_brief
    what_this_is       gst_cliffs, and two people_checks handlers
    what_this_is_not   brief_advance_tax_reserve, where the FIRST key of the
                       output has to be "this is not tax advice"

None is wrong alone. Together they are a problem: a prompt saying "repeat the
limitations verbatim" silently drops part of the shelf.

This renames nothing — several modules and their suites assert on the current
names, and churning them is a large diff for no behavioural gain. It pins the
VOCABULARY: one of these five, and no sixth.

── AND IT RECORDS A REAL GAP RATHER THAN HIDING IT ──────────────────────────

Twenty-six handlers say nothing at all about what they cannot see. Every one of
them predates the written contract — they are the Phase 1/2 registry
(`find_overdue`, `score_deals`, `aggregate_kpis`, the action handlers) built
before "state your limits" was a rule.

They are listed in `WITHOUT_A_CAVEAT` below. That list is a DEBT, not a
permission: it may only shrink. A new handler landing without a caveat fails,
and removing a name from the list is the commit that pays part of the debt off.

── Why it reads the source rather than running the handlers ─────────────────

The suite is offline by design: `pytest.ini` pins `testpaths = tests` and the
pool is a MagicMock, which is what keeps it runnable with no database. Several
handlers build the caveat key dynamically, so the honest offline test is
whether the handler NAMES one at all — which is exactly what breaks if somebody
introduces a fifth.
"""
import ast
import asyncio
import inspect
from pathlib import Path

import pytest

from services.skill_dispatcher import SKILL_REGISTRY, _resolve_handler

#: The four names in use, and the only ones a consumer has to know.
#:
#: ADDING A SIXTH IS THE THING THIS FILE EXISTS TO PREVENT. If new work wants a
#: different word, use `limitations` — that is what the contract fixed on and
#: what most of the shelf uses.
CAVEAT_KEYS = ("limitations", "caveats", "caveat", "what_this_is",
               "what_this_is_not")

#: `error` is not a caveat. A handler that could not run returns it instead, and
#: that is a different statement — "I failed" rather than "here is what I cannot
#: see". Named so the distinction is deliberate rather than an omission somebody
#: later "fixes" by merging the two.
NOT_A_CAVEAT = ("error",)

#: Handlers that say NOTHING about what they cannot see. Measured 2026-08-20.
#:
#: Every one predates the contract. THIS LIST MAY ONLY SHRINK — it is a debt,
#: not a permission, and `test_the_debt_list_has_not_grown` refuses a longer
#: one. Paying it off is a handler at a time: add the caveat the handler
#: actually owes and delete its name here.
#:
#: The ones that matter most are the ones a firm acts on hardest:
#:   propose_payment_run     proposes money leaving, and says nothing about what
#:                           it cannot see (it has no notion of a duplicate —
#:                           that is what catalogue #06 exists for)
#:   check_payroll_readiness 131 live blockers on the seeded org, no caveat
#:   match_bank_transactions returns ONE best match and silently discards ties;
#:                           see services/skills/data/bank_matching.py, which
#:                           documents that at length and is its replacement
WITHOUT_A_CAVEAT = frozenset({
    "aggregate_kpis", "check_dept_coverage", "check_expense_policy",
    "check_payroll_readiness", "compare_payroll_months",
    "detect_anomalies", "detect_attendance_patterns", "execute_onboarding",
    "execute_sequence_step", "find_coverage_gaps", "find_low_stock",
    "find_overdue_followups", "find_overdue_invoices", "find_overdue_tasks",
    "find_overdue_vendor_bills", "find_stalled_agreements",
    "generate_due_invoices", "get_account_brief", "get_my_desk",
    "get_team_workload", "mark_holidays_weekends", "match_bank_transactions",
    "scan_upcoming_deadlines", "score_candidate",
    "score_deals", "send_campaign", 
})


def _handler_source(skill_function: str) -> str:
    handler = asyncio.run(_resolve_handler(skill_function))
    return inspect.getsource(handler)


def _module_source(skill_function: str) -> str:
    handler = asyncio.run(_resolve_handler(skill_function))
    return Path(inspect.getsourcefile(handler)).read_text(encoding="utf-8")


def _names_a_caveat(src: str) -> list[str]:
    return [k for k in CAVEAT_KEYS if f'"{k}"' in src or f"'{k}'" in src]


def test_there_are_skills_to_check():
    """A registry that failed to import would make every test below vacuous —
    the classic way a guard reports green while guarding nothing."""
    assert len(SKILL_REGISTRY) >= 50, f"expected the full shelf, got {len(SKILL_REGISTRY)}"


@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_every_skill_states_what_it_cannot_see(skill_function):
    """One of the five recognised keys — unless it is on the debt list."""
    try:
        src = _handler_source(skill_function)
    except Exception as exc:
        pytest.skip(f"{skill_function} does not resolve: {exc}")

    found = _names_a_caveat(src)

    if skill_function in WITHOUT_A_CAVEAT:
        # Pinned the other way: if it HAS acquired one, the debt was paid and
        # the name must come off the list, or the list stops meaning anything.
        assert not found, (
            f"{skill_function} now states its limits ({found}) but is still "
            f"listed in WITHOUT_A_CAVEAT. Remove it from that set — the list is "
            f"a debt and this entry has been paid."
        )
        return

    assert found, (
        f"{skill_function} names none of {list(CAVEAT_KEYS)}.\n\n"
        f"Every skill must say what it cannot see, under a name a consumer "
        f"recognises — these outputs are handed to a language model as "
        f"grounding, and a caveat it does not recognise is one the reader never "
        f"gets. Use `limitations`."
    )


def test_the_debt_list_has_not_grown():
    """Twenty-six handlers owe a caveat. Twenty-seven would mean new work
    shipped without one, which is the rule this whole file encodes."""
    assert len(WITHOUT_A_CAVEAT) <= 26, (
        f"WITHOUT_A_CAVEAT has grown to {len(WITHOUT_A_CAVEAT)}. It may only "
        f"shrink: a new handler must state its limits."
    )
    unknown = WITHOUT_A_CAVEAT - set(SKILL_REGISTRY)
    assert not unknown, (
        f"WITHOUT_A_CAVEAT names handlers that are not registered: "
        f"{sorted(unknown)}. A stale entry is a hole nobody can see."
    )


@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_no_sixth_caveat_key_creeps_in(skill_function):
    """The drift guard. Five names is already four too many; six is a prompt
    that silently drops part of the shelf."""
    try:
        src = _module_source(skill_function)
    except Exception as exc:
        pytest.skip(f"{skill_function} does not resolve: {exc}")

    suspicious = {
        # NOT `warnings`: check_payroll_readiness uses it for NON-BLOCKING
        # FINDINGS — things it found, beside `blockers` — which is a different
        # concept from what the skill cannot see. Flagging it would force a
        # rename that loses a real distinction.
        "limitation", "disclaimers", "disclaimer",
        "notes_for_the_reader", "what_you_cannot_see", "known_gaps",
    }
    offenders = sorted({
        n.value for n in ast.walk(ast.parse(src))
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and n.value in suspicious
    })

    assert not offenders, (
        f"{skill_function}'s module uses {offenders} as an output key. The "
        f"recognised names are {list(CAVEAT_KEYS)}; a sixth means every prompt "
        f"that reads a caveat has to learn it. Use `limitations`."
    )


def test_error_is_not_treated_as_a_caveat():
    """Pinned so the distinction survives somebody tidying this file. A handler
    that could not run returns `error` — 'I failed', not 'here is what I cannot
    see'. Conflating them lets a crashed skill pass as an honest one."""
    assert not set(CAVEAT_KEYS) & set(NOT_A_CAVEAT)


def test_limitations_is_the_dominant_name():
    """It is what the written contract fixed on and what new work must use."""
    counts = {k: 0 for k in CAVEAT_KEYS}
    for fn in sorted(SKILL_REGISTRY):
        if fn in WITHOUT_A_CAVEAT:
            continue
        try:
            found = _names_a_caveat(_handler_source(fn))
        except Exception:
            continue
        if found:
            counts[found[0]] += 1

    others = sum(v for k, v in counts.items() if k != "limitations")
    assert counts["limitations"] > others, (
        f"`limitations` should be the dominant name; got {counts}. If that has "
        f"flipped, the contract changed and this file should say so."
    )
