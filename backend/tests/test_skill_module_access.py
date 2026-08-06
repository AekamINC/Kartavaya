"""
Srijan is not a way around SENSITIVE_MODULES.

The gap, stated once: the whole skill path is gated on
`require_module("sahayak")` and nothing else, while sixteen of the twenty-three
handlers behind it read a table belonging to another module — `ganit_invoices`,
`manav_employees`, `vetana_salary_structures`, `manav_attendance`. So a user
holding a Srijan grant and nothing else could read the books, the payroll
register and the attendance log through a skill.

The widest instance needed no data step at all: `aggregate_kpis` is wired as the
`kpis` context source, so any template carrying `"context": ["kpis"]` returned
revenue, spend and headcount to whoever pressed Run.

Owner's decision, 2026-08-02: **refuse the run**, do not omit the source. The
reasoning is recorded on `SkillAccessDenied`. These tests pin the refusal, the
point in the run at which it lands, and the two drift checks that stop a new
handler or a new context source from arriving undeclared.
"""
import pytest

from services.skills import context as ctxmod
from services.skills.modules import (
    FUNCTION_MODULES, SOURCE_MODULES, modules_for_step, withheld_modules,
)
from services.skill_dispatcher import SKILL_REGISTRY
from middleware.role_tiers import ALL_MODULES, SENSITIVE_MODULES

ORG = "00000000-0000-0000-0000-00000000000a"
USER = "user_test001"


# ── The declarations cannot drift from the things they describe ─────────────

def test_every_registered_function_declares_its_modules():
    """
    A handler added to the registry without a line in FUNCTION_MODULES is the
    exact failure this file exists to prevent. It would fall through to the
    `SENSITIVE_MODULES` default and be maximally restricted — safe, but the
    author should be told rather than left wondering why nobody can run it.
    """
    undeclared = set(SKILL_REGISTRY) - set(FUNCTION_MODULES)
    assert not undeclared, f"no module declared for: {sorted(undeclared)}"

    stale = set(FUNCTION_MODULES) - set(SKILL_REGISTRY)
    assert not stale, f"declared but not registered: {sorted(stale)}"


def test_every_context_source_declares_its_module():
    undeclared = set(ctxmod.SOURCES) - set(SOURCE_MODULES)
    assert not undeclared, f"no module declared for context source: {sorted(undeclared)}"

    stale = set(SOURCE_MODULES) - set(ctxmod.SOURCES)
    assert not stale, f"declared but not a real source: {sorted(stale)}"


@pytest.mark.parametrize("declared", [FUNCTION_MODULES, SOURCE_MODULES])
def test_declared_modules_are_real_module_codes(declared):
    """A typo would silently grant access: `held_module_levels` returns an empty
    set for a code it does not know, so a misspelled module reads as 'withheld'
    — safe — but `modules_for_step` intersects with ALL_MODULES, so a typo there
    would vanish from the requirement set entirely."""
    for name, mods in declared.items():
        unknown = set(mods) - ALL_MODULES
        assert not unknown, f"{name} declares unknown module(s): {sorted(unknown)}"


def test_the_sensitive_handlers_are_all_declared_sensitive():
    """
    The blast radius of the original gap, pinned by name. Every one of these
    reads a Ganit, Manav or Vetana table; if any stops requiring that grant, it
    is reachable by a Srijan-only user again.
    """
    expected = {
        "aggregate_kpis": {"ganit", "graha", "manav"},
        "find_overdue_invoices": {"ganit"},
        "find_overdue_vendor_bills": {"ganit"},
        "find_stalled_agreements": {"ganit"},
        "detect_attendance_patterns": {"manav"},
        "detect_anomalies": {"ganit"},
        "match_bank_transactions": {"ganit", "graha"},
        "check_dept_coverage": {"manav"},
        "find_coverage_gaps": {"manav"},
        "score_candidate": {"manav"},
        "generate_due_invoices": {"ganit"},
        "mark_holidays_weekends": {"manav"},
        "process_document_expiry": {"ganit", "manav"},
        "allocate_leave_yearly": {"manav"},
        "auto_schedule_week": {"manav"},
        "execute_onboarding": {"manav", "vetana"},
        "escalate": {"ganit", "manav"},
    }
    for fn, mods in expected.items():
        assert set(FUNCTION_MODULES[fn]) == mods, f"{fn} changed what it requires"
        assert set(FUNCTION_MODULES[fn]) & SENSITIVE_MODULES, f"{fn} lost its sensitive claim"


# ── What a step needs ───────────────────────────────────────────────────────

def test_a_plain_content_step_needs_nothing():
    """The six templates already in the catalog. This gate must be a no-op for
    them, or shipping it breaks everything that works today."""
    step = {"agent_type": "social_media", "prompt_template": "Write a post about {topic}."}

    assert modules_for_step(step) == frozenset()


def test_a_data_step_needs_its_handler_s_modules():
    assert modules_for_step({"skill_function": "find_overdue_invoices"}) == frozenset({"ganit"})


def test_a_grounded_step_needs_its_sources_modules():
    step = {"agent_type": "email", "prompt_template": "Chase them.",
            "context": ["receivables", "attendance"]}

    assert modules_for_step(step) == frozenset({"ganit", "manav"})


def test_function_and_context_are_unioned_not_ranked():
    """A data step may also request context, and both read real data."""
    step = {"skill_function": "score_deals", "context": ["receivables"]}

    assert modules_for_step(step) == frozenset({"graha", "ganit"})


def test_an_undeclared_name_is_maximally_restricted_not_free():
    """
    The safety posture. A handler or source that arrives without a declaration
    must fail closed — the failure being somebody refused, never somebody
    reading payroll.
    """
    assert modules_for_step({"skill_function": "something_nobody_declared"}) >= SENSITIVE_MODULES
    assert modules_for_step({"context": ["nobody_declared_this"]}) >= SENSITIVE_MODULES


# ── The refusal ─────────────────────────────────────────────────────────────

@pytest.fixture
def grants(monkeypatch):
    """Give the caller a named set of modules; everything else is ungranted."""
    def _install(*held):
        async def _levels(user_id, org_id, module_code):
            return frozenset({"admin"}) if module_code in held else frozenset()
        monkeypatch.setattr("services.skills.modules.held_module_levels", _levels)
    return _install


@pytest.mark.asyncio
async def test_a_srijan_only_user_is_refused_the_books(grants):
    """The headline case: Srijan and nothing else must not reach Ganit."""
    grants("sahayak")

    with pytest.raises(ctxmod.SkillAccessDenied) as e:
        await ctxmod.assert_step_access(
            [{"skill_function": "find_overdue_invoices"}], USER, ORG
        )

    assert e.value.withheld == frozenset({"ganit"})


@pytest.mark.asyncio
async def test_the_kpis_context_source_is_refused_without_a_data_step(grants):
    """
    The widest instance, and the one needing no data step at all. Any template
    with `"context": ["kpis"]` returned revenue, spend and headcount.
    """
    grants("sahayak")

    with pytest.raises(ctxmod.SkillAccessDenied) as e:
        await ctxmod.assert_step_access(
            [{"agent_type": "email", "prompt_template": "Brief me.", "context": ["kpis"]}],
            USER, ORG,
        )

    assert e.value.withheld == frozenset({"ganit", "graha", "manav"})


@pytest.mark.asyncio
async def test_holding_some_of_the_modules_is_not_enough(grants):
    """
    A cross-module skill needs EVERY module it reads. Holding two of three and
    getting a confident answer over the third is the failure the refusal exists
    to prevent.
    """
    grants("sahayak", "ganit", "graha")

    with pytest.raises(ctxmod.SkillAccessDenied) as e:
        await ctxmod.assert_step_access(
            [{"skill_function": "aggregate_kpis"}], USER, ORG
        )

    assert e.value.withheld == frozenset({"manav"})


@pytest.mark.asyncio
async def test_a_fully_granted_user_passes(grants):
    grants("sahayak", "ganit", "graha", "manav")

    await ctxmod.assert_step_access([{"skill_function": "aggregate_kpis"}], USER, ORG)


@pytest.mark.asyncio
async def test_the_existing_content_templates_are_unaffected(grants):
    """
    The compatibility guarantee. None of the six seeded templates carries a
    `skill_function` or a `context` key, so this gate must not touch them.
    """
    grants()      # no modules at all

    await ctxmod.assert_step_access(
        [
            {"agent_type": "social_media", "prompt_template": "LinkedIn post for {{brand_name}}"},
            {"agent_type": "social_media", "prompt_template": "Instagram post"},
            {"agent_type": "ad_copy", "prompt_template": "Festive offer for {festival_name}"},
        ],
        USER, ORG,
    )


@pytest.mark.asyncio
async def test_the_refusal_names_the_module_in_words_a_person_can_act_on(grants):
    """A module code means nothing to whoever pressed Run, and a refusal that
    does not say what to ask for teaches nobody anything."""
    grants("sahayak")

    with pytest.raises(ctxmod.SkillAccessDenied) as e:
        await ctxmod.assert_step_access(
            [{"skill_function": "execute_onboarding", "allow_writes": True}], USER, ORG
        )

    message = str(e.value)
    assert "HR" in message and "Payroll" in message
    assert "manav" not in message and "vetana" not in message


@pytest.mark.asyncio
async def test_every_step_is_checked_not_just_the_first(grants):
    """
    Checked up front, all of them. Per-step checking charges for steps one to
    three and refuses at step four — the customer has paid for a run they cannot
    have and the completed steps are already in their content library.
    """
    grants("sahayak", "graha")

    with pytest.raises(ctxmod.SkillAccessDenied) as e:
        await ctxmod.assert_step_access(
            [
                {"skill_function": "score_deals"},                    # graha — fine
                {"agent_type": "email", "prompt_template": "Write."},  # nothing
                {"skill_function": "detect_attendance_patterns"},      # manav — not held
            ],
            USER, ORG,
        )

    assert e.value.withheld == frozenset({"manav"})


@pytest.mark.asyncio
async def test_withheld_modules_returns_empty_when_nothing_is_needed(grants):
    grants()

    assert await withheld_modules(USER, ORG, frozenset()) == frozenset()


# ── Where the refusal lands ─────────────────────────────────────────────────
#
# THIS SECTION WAS REWRITTEN 2026-08-04 BECAUSE IT HAD STOPPED CHECKING.
#
# It used to find the charge with `inspect.getsource(...).index("deduct_org_credits")`.
# Migration 095 converted `run_org_skill` to `credits.spend_standalone`, and the
# old name survived in the comment explaining the conversion — so the search kept
# finding it, the ordering kept comparing, and the test kept passing while the
# thing it names had not been in the function for a deploy. A test that passes on
# the words in a comment is worse than no test, because it is counted.
#
# So the ordering is now read off the PARSE TREE. `ast` drops comments entirely
# and never looks inside a string literal, which makes "the name appears" and
# "the call happens" two different questions again. The run-row INSERT has no
# distinguishing callable name, so it is located by the SQL it emits — the other
# thing the review allows, and the only one available for a bare `pool.fetchrow`.

#: Every entry point in the product that takes credits out of a wallet. The
#: assertion below requires the access check to precede ALL of them AND requires
#: at least one to be present: a handler that starts charging through a name this
#: set has never heard of must fail here rather than pass by charging invisibly.
DEBIT_CALLS = frozenset({
    "credits.spend", "credits.spend_standalone",   # the 095 choke point
    "deduct_credits", "deduct_org_credits",        # the deprecated ai_router shims
})


def _dotted(node):
    """`credits.spend_standalone` from the Attribute chain that spells it."""
    import ast

    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    return ""


def _calls(fn):
    """(line, dotted name, first string argument) for every call in `fn`.

    Parsed, not grepped — see the section note above. The string argument comes
    back because a statement is sometimes the only thing that identifies a call:
    two `pool.fetchrow`s are indistinguishable by name and only one of them
    writes the run row.
    """
    import ast
    import inspect
    import textwrap

    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        sql = next((a.value for a in node.args
                    if isinstance(a, ast.Constant) and isinstance(a.value, str)), "")
        out.append((node.lineno, _dotted(node.func), sql))
    return sorted(out)


@pytest.mark.parametrize("fn_name", ["run_skill", "run_org_skill"])
def test_the_check_runs_before_any_credit_is_deducted(fn_name):
    """
    A source-order assertion, deliberately.

    The refusal being CORRECT is tested above; this tests that it is EARLY, and
    earliness is a property of where the call sits, not of what it returns. A
    refusal after the first deduction charges the customer for a run they are
    not allowed to have and leaves the completed steps' content in their
    library — so moving the guard below the loop would pass every other test in
    this file.

    It also has to precede the run-row INSERT, or a refused run leaves a
    permanently 'running' row nobody completes.

    EVERY charge is compared, not the first one found. `run_org_skill` charges
    twice per step — once for the text, once for the image — and a guard that
    beat only the first would still be letting a refused user buy a picture.
    """
    import routers.hub as hub

    calls = _calls(getattr(hub, fn_name))

    guards = [line for line, name, _ in calls
              if name.rsplit(".", 1)[-1] == "assert_step_access"]
    charges = [line for line, name, _ in calls if name in DEBIT_CALLS]
    inserts = [line for line, _, sql in calls
               if "INSERT INTO" in sql and "_skill_runs" in sql]

    assert guards, f"{fn_name}: no assert_step_access call — the gate is gone"
    assert charges, (
        f"{fn_name}: no call to any of {sorted(DEBIT_CALLS)}. Either this "
        f"function stopped charging, or it charges through a name this test has "
        f"never heard of — add it to DEBIT_CALLS rather than deleting this line."
    )
    assert inserts, f"{fn_name}: no INSERT into a *_skill_runs table"

    assert min(guards) < min(charges), (
        f"{fn_name}: access check runs AFTER the first charge (line "
        f"{min(guards)} vs {min(charges)})"
    )
    assert min(guards) < min(inserts), (
        f"{fn_name}: access check runs AFTER the run row is written"
    )


def test_the_ordering_is_read_from_calls_not_from_comments():
    """
    The defect that made the test above vacuous, reproduced on purpose.

    `_decoy` is `run_org_skill`'s exact shape after 095: it charges through the
    NEW name before the guard, and carries the OLD name after the guard, in a
    comment explaining the change. That is what makes it the right decoy — the
    old substring search finds the guard first and reports the ordering fine, so
    it is green on a function that charges a user it has not yet checked.

    Kept as a test rather than as prose because the helper is only trustworthy
    for as long as this stays true of it.
    """
    import inspect

    def _decoy(pool):
        from services import credits
        credits.spend_standalone(pool)                 # the real charge, FIRST
        assert_step_access(pool)                       # noqa: F821 — the guard, too late
        # 095 note: this used to be deduct_org_credits, on its own connection

    source = inspect.getsource(_decoy)
    assert source.index("assert_step_access") < source.index("deduct_org_credits"), (
        "the decoy is only useful if a substring search gets it wrong — the old "
        "name has to appear after the guard, and only in a comment"
    )

    calls = _calls(_decoy)
    charges = [line for line, name, _ in calls if name in DEBIT_CALLS]
    guards = [line for line, name, _ in calls if name == "assert_step_access"]

    assert len(charges) == 1, "a name in a comment is not a call"
    assert min(charges) < min(guards), (
        "the decoy charges before it checks, and the parse tree must say so"
    )
