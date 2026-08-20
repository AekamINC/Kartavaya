"""A template may only name a skill the server can actually run.

── Why this file exists ──────────────────────────────────────────────────────

`skill_dispatcher.SKILL_REGISTRY` opens with the record of what happens without
this check: every entry in the previous version pointed at a module that was
never written — `services.skills.ganit`, `.manav`, `.vetana`, `.vikray` — so
`_resolve_handler` raised ModuleNotFoundError on any function-backed step, and
nothing failed loudly because no template had ever carried one.

Templates now carry them. Migration 167 puts fourteen on the shelf, each naming
one handler, and the failure mode has moved: a template that names a function
this server does not implement is refused by `_run_function_step` AFTER it has
been assigned, in front of whoever pressed Run rather than whoever wrote the
row. There is no constraint the database can hold for this — the name is inside
a jsonb step — so the check lives here.

── Why it reads the migration and not the database ──────────────────────────

The same reasoning `tests/test_client_lifecycle.py` gives for parsing 163's
CHECK out of 163: the file IS the statement of intent, it is in version
control, and it is what a reviewer reads. A test against the live catalogue
would need credentials, would pass on a laptop that cannot reach the database,
and would say nothing about a migration that has been written and not yet run —
which is the window in which this mistake is cheap to fix.

The live catalogue is verified separately, inside the migration's own
transaction, by 167's VERIFY blocks. The two checks answer different questions
and both are wanted: this one asks whether the SQL names things that exist, and
that one asks whether the rows that landed are the rows intended.
"""
import asyncio
import inspect
import json
import re
from pathlib import Path

import pytest

from services.skill_dispatcher import (
    SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS, _resolve_handler,
)
from services.skills.modules import FUNCTION_MODULES

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"

#: Every migration that seeds or edits a template's steps. A new one belongs
#: here; the test that guards THAT is `test_no_seeding_migration_is_unchecked`.
SEEDING_MIGRATIONS = (
    "167_first_tier_skills.sql",
    "168_the_180_day_reversal.sql",
    "169_money_in_invoice_unpaid.sql",
)

#: Files that name a skill_function and are deliberately NOT checked. Both
#: reasons are about history, and neither is a licence for a new file.
#:
#:   059  names SEVENTEEN skill_functions and NOT ONE of them exists — the
#:        fiction `skill_dispatcher`'s header describes, written against a
#:        module layout that was planned and never built. Checking it would
#:        fail permanently and say nothing new. It is inert: probed read-only
#:        against the live database 2026-08-20, all 28 functions named by real
#:        template rows resolve, and NO row carries any of the seventeen, so
#:        those template seeds never landed. Six of them are recorded in
#:        `UNIMPLEMENTED_SKILL_FUNCTIONS`; the other eleven are not, which is
#:        its own small piece of work.
#:
#:   PROPOSED_*  are proposals, not migrations. migrations/README.md gives the
#:        prefix its meaning and nothing runs them. Their function names DO all
#:        resolve today — checked when this exclusion was written — so this
#:        costs no coverage of anything real.
UNCHECKED = ("059_skills_integration.sql",)

_FUNCTION_REF = re.compile(r'"skill_function"\s*:\s*"([a-z_0-9]+)"')
_STEPS_BLOCK = re.compile(r"'(\[\{.*?\}\])'::jsonb", re.DOTALL)
#: A single-quoted SQL literal, doubled-quote escapes included.
_SQL_STRING = re.compile(r"'(?:[^']|'')*'", re.DOTALL)
_LINE_COMMENT = re.compile(r"--[^\n]*")


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


def _code_only(sql: str) -> str:
    """The file with its comments and its string literals removed.

    The same move `tests/test_ganit_ops.py:_sql_only` makes and for the same
    reason. `test_nothing_in_a_seeding_migration_arms_a_skill` asserts a word is
    ABSENT, and 167 names that word twice on purpose — once in a comment saying
    it writes no trigger, once inside the RAISE message of the guard that
    refuses an armed row. A bare `in sql` matches the promise and fails on a
    correct file, which is a test that can only be satisfied by deleting the
    explanation.
    """
    return _SQL_STRING.sub("''", _LINE_COMMENT.sub("", sql))


def _named_functions(name: str) -> list[str]:
    return _FUNCTION_REF.findall(_sql(name))


def _step_arrays(name: str) -> list[list[dict]]:
    """Every `steps` literal in the file, parsed as the JSON it has to be."""
    return [json.loads(m) for m in _STEPS_BLOCK.findall(_sql(name))]


@pytest.mark.parametrize("migration", SEEDING_MIGRATIONS)
def test_every_named_function_is_registered(migration):
    """The headline. A name here that is not in the registry is a card that
    cannot run, discovered by a customer."""
    unknown = sorted({
        fn for fn in _named_functions(migration) if fn not in SKILL_REGISTRY
    })
    assert not unknown, (
        f"{migration} names skill_function(s) with no SKILL_REGISTRY entry: "
        f"{unknown}. `_run_function_step` refuses these, so the template would "
        f"be assignable and unrunnable."
    )


@pytest.mark.parametrize("migration", SEEDING_MIGRATIONS)
def test_every_named_function_resolves_to_a_real_handler(migration):
    """Registered is not the same as importable — that was the original bug."""
    for fn in sorted(set(_named_functions(migration))):
        handler = asyncio.run(_resolve_handler(fn))
        assert callable(handler), f"{fn} resolved to something uncallable"


@pytest.mark.parametrize("migration", SEEDING_MIGRATIONS)
def test_every_named_function_declares_its_modules(migration):
    """An undeclared handler falls through to SENSITIVE_MODULES and becomes
    maximally restricted — safe, but nobody can run the card and no error says
    why. See services/skills/modules.py."""
    undeclared = sorted({
        fn for fn in _named_functions(migration) if fn not in FUNCTION_MODULES
    })
    assert not undeclared, (
        f"{migration} names {undeclared}, which declare no module. They would "
        f"be refused for every caller."
    )


@pytest.mark.parametrize("migration", SEEDING_MIGRATIONS)
def test_a_seeded_skill_can_run_unattended(migration):
    """The same rule `test_a_skill_can_run_unattended` applies to the registry,
    applied to the templates that actually name a handler.

    A step supplies arguments through its own `params`, so a template MAY carry
    a subject-bound handler by naming the subject. 167 carries no params block
    at all, deliberately, so every function it names must be answerable from the
    org and the calendar alone.
    """
    for steps in _step_arrays(migration):
        for step in steps:
            fn = step.get("skill_function")
            if not fn:
                continue
            _, _, defaults = SKILL_REGISTRY[fn]
            supplied = set(defaults or {}) | set(step.get("params") or {})
            handler = asyncio.run(_resolve_handler(fn))
            required = [
                p_name
                for p_name, p in inspect.signature(handler).parameters.items()
                if p_name not in ("pool", "org_id", "user_id")
                and p.default is inspect.Parameter.empty
                and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)
                and p_name not in supplied
            ]
            assert not required, (
                f"{migration}: the step naming {fn} requires {required}, which "
                f"neither the registry defaults nor the step's own params "
                f"supply. The dispatcher refuses every run of this template."
            )


@pytest.mark.parametrize("migration", SEEDING_MIGRATIONS)
def test_a_free_skill_never_writes_and_never_draws(migration):
    """0 credits is a claim about what a run does, and two things break it.

    A WRITE step is not a pricing question but it is the same promise: these are
    checks, briefs and packs, and none of them may change a row. A step naming a
    write handler without `allow_writes` is refused at run time anyway — the
    point here is that it must not be written in the first place.
    """
    for steps in _step_arrays(migration):
        for step in steps:
            assert "agent_type" not in step, (
                f"{migration}: a step carries agent_type={step['agent_type']!r}. "
                f"Every template in this file is seeded with "
                f"estimated_credits = 0, and an agent step costs credits — that "
                f"is exactly the lie migration 166 was written to end."
            )
            assert step.get("generate_image") is False, (
                f"{migration}: a step does not say generate_image false. An "
                f"image is 79% of AI spend to date; say so explicitly."
            )
            assert step.get("skill_function") not in WRITE_SKILL_FUNCTIONS, (
                f"{migration}: a check/brief/pack names a write handler."
            )
            assert not step.get("allow_writes"), (
                f"{migration}: a check/brief/pack opts into writes."
            )


@pytest.mark.parametrize("migration", SEEDING_MIGRATIONS)
def test_nothing_in_a_seeding_migration_arms_a_skill(migration):
    """Arming is the owner's decision. A migration that stocks the shelf must
    not also schedule what it puts there — the two are separate deliberate acts
    and only one of them is this file's business."""
    code = _code_only(_sql(migration))
    offending = [
        line.strip() for line in code.splitlines()
        if "trigger_config" in line
        # The guard that REFUSES an armed row reads the column; it never writes
        # one. Everything else naming it in executable code is a write.
        and "IS NOT NULL" not in line
    ]
    assert not offending, (
        f"{migration} writes trigger_config: {offending}. Stocking a shelf and "
        f"scheduling what is on it are two separate deliberate acts, and only "
        f"the first is a migration's business."
    )


def test_no_seeding_migration_is_unchecked():
    """The drift guard on this file itself.

    A later migration that seeds a template and is not added to
    SEEDING_MIGRATIONS gets none of the checks above, which is the same silent
    hole in a different place. Everything excluded is excluded BY NAME with a
    reason recorded at UNCHECKED — a new file cannot fall through by resembling
    an old one.
    """
    seeds = sorted(
        p.name for p in MIGRATIONS.glob("*.sql")
        if not p.name.startswith("PROPOSED_")
        and _FUNCTION_REF.search(p.read_text(encoding="utf-8"))
    )
    missing = [s for s in seeds if s not in SEEDING_MIGRATIONS + UNCHECKED]
    assert not missing, (
        f"these migrations seed a skill_function step and are covered by "
        f"nothing: {missing}. Add each to SEEDING_MIGRATIONS, or to UNCHECKED "
        f"with the reason written down."
    )


def test_the_unchecked_list_has_not_gone_stale():
    """An exclusion that no longer names a real file is a hole nobody can see."""
    for name in SEEDING_MIGRATIONS + UNCHECKED:
        assert (MIGRATIONS / name).exists(), (
            f"{name} is listed in this file and does not exist. Either it was "
            f"renamed — renumbering is forbidden, see migrations/README.md — or "
            f"the entry is stale."
        )
