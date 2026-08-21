"""NINETY HANDLERS, SEVENTY-EIGHT CARDS, AND NOTHING THAT TESTED THEM AS A SET.

Every skill in this product had a test of its own arithmetic and no test of its
membership. `SKILL_REGISTRY` grew to ninety entries across a dozen sessions and
five parallel authors, and the questions nobody was asking were the ones that
only make sense across the whole shelf:

    does every entry still import?
    can every entry be RUN — from the dock, with one click, supplying nothing?
    is every entry that writes declared as one, and nothing else?
    does every card on the shelf name a handler that exists?
    does any of them print a uuid where a person's name belongs?

Running all ninety by hand against the live database on 2026-08-21 answered
them, and two of the answers were breakage:

    find_coverage_gaps     RAISED  column sd.min_staff does not exist
    find_overdue_tasks     RAISED  a bad join (fixed separately)

`find_coverage_gaps` had been in the registry since the first Phase-1 batch,
selecting a column `staging.manav_shift_definitions` HAS NEVER HAD — migration
027 created that table with no staffing requirement on it at all. Nothing
caught it because nothing had ever run it, and a mock pool cannot: the offline
suite hands every handler a MagicMock that answers `[]` to any statement,
valid or not. THAT IS THE HOLE, and it is why this file has a sibling —
`test_skill_sql_is_valid.py` parses every skill's SQL against the live
catalogue without executing a byte of it. This file covers everything a mock
pool CAN prove, and is careful to prove nothing that only the mock believes.

── THE DISTINCTION THIS FILE PINS ───────────────────────────────────────────

Seven more of the ninety came back "NEEDS <param>" on that same sweep. They are
NOT broken. They are the skills that answer about one named thing — WHICH
client, WHICH claim, WHICH candidate — and a one-click run has nothing to put
there. That is a design fact about each handler, and it has to be knowable
BEFORE somebody presses Run rather than as a ValueError in front of them.

`NEEDS_RUNTIME_INPUT` below is that ledger, and it is asserted EXACT in both
directions, the way `test_client_id_write_paths.KNOWN_GAPS` is. Adding a
parameter with no default to any handler therefore fails this suite until
somebody decides how the dock supplies it — which is the decision that was
being made silently, one signature at a time.

── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────

The handlers are never CALLED. A test that calls a handler with a MagicMock
pool and asserts on the result is asserting on the fixture it just wrote: the
mock echoes back whatever it was told to, so the query can be nonsense and the
assertion still passes. Every check here is either introspection of the
registry or analysis of the source, and the one thing that genuinely needs a
database is in the sibling file, where it is skipped honestly when there is no
database to reach.
"""
import ast
import asyncio
import inspect
import os
import re
from pathlib import Path

import pytest

from services.skill_dispatcher import (
    RUNTIME_FORBIDDEN_PARAMS,
    SKILL_REGISTRY,
    UNIMPLEMENTED_SKILL_FUNCTIONS,
    WRITE_SKILL_FUNCTIONS,
    _resolve_handler,
    describe_skill_functions,
)
from services.skills.modules import FUNCTION_MODULES

BACKEND = Path(__file__).resolve().parent.parent
MIGRATIONS = BACKEND / "migrations"

#: The shelf as measured on 2026-08-21. A floor, not an equality: new skills
#: are expected and must not have to edit this line. It exists so that an
#: import failure which empties the registry cannot make every parametrised
#: test below vanish into a green run — the classic way a guard reports
#: success while guarding nothing.
SHELF_FLOOR = 90


# ══════════════════════════════════════════════════════════════════════════════
#  LEDGER 1 — the skills a one-click run cannot supply
# ══════════════════════════════════════════════════════════════════════════════

#: Handlers that declare a parameter with no default which neither the registry
#: defaults nor the run path fill. `_run_function_step` refuses these unless the
#: template names the value in `params`, or opens it through `runtime_params`
#: for the person pressing Run to type.
#:
#: EVERY ENTRY IS A DESIGN DECISION, NOT A DEFECT. Each answers about one named
#: subject, and a schedule has no way to choose the subject:
#:
#:   check_dept_coverage    would approving THIS leave breach THIS department
#:   check_expense_policy   judging WHICH claim
#:   detect_anomalies       WHICH series
#:   execute_onboarding     WHICH new joiner
#:   execute_sequence_step  WHICH enrolment
#:   get_account_brief      a brief on WHICH client — the dispatcher's own
#:                          worked example of why `runtime_params` exists
#:   match_bank_transactions WHICH statement lines. See catalogue #16 and
#:                          `services/skills/data/bank_matching.py`: the
#:                          schedulable half of this question shipped as
#:                          `check_unmatched_receipts`, which needs nothing.
#:   score_candidate        WHOM
#:   send_campaign          WHICH campaign
#:
#: ASSERTED EXACT, BOTH WAYS. A handler that acquires a required parameter and
#: is not listed here fails; an entry here whose handler has since gained a
#: default fails too, because a stale ledger is a hole nobody can see.
#:
#: `user_id` never appears: the dispatcher injects the CALLER's own
#: (`supplied.setdefault("user_id", user_id)`), so a handler taking it — like
#: `get_my_desk` — is still runnable from the dock. A hand-run that passes no
#: user reports `get_my_desk NEEDS user_id`, and that is the sweep's harness
#: talking, not the product.
NEEDS_RUNTIME_INPUT: dict[str, tuple[str, ...]] = {
    "check_dept_coverage":     ("dept", "end_date", "start_date"),
    "check_expense_policy":    ("expense",),
    "detect_anomalies":        ("metric",),
    "execute_onboarding":      ("employee_id",),
    "execute_sequence_step":   ("enrollment_id",),
    "get_account_brief":       ("contact_id",),
    "match_bank_transactions": ("bank_txns",),
    "score_candidate":         ("candidate",),
    "send_campaign":           ("campaign_id",),
}


#: Handlers the dispatcher REFUSES, because they do not accept `org_id` and so
#: cannot be scoped to one tenant. Measured 2026-08-21.
#:
#: This is the refusal `_run_function_step` documents at length: passing
#: `org_id` to a handler that does not name it is a TypeError, and scoping it
#: from outside is impossible, because the filter belongs inside the handler's
#: own query. Each of these selects by an entity id with no org filter of its
#: own, so the alternative to refusing is a cross-tenant read.
#:
#: EVERY ENTRY IS A DEAD CARD. The skill is registered, appears in the step
#: editor as unavailable, and cannot be run by any route. Paying one off means
#: giving its handler `org_id` and filtering on it in the statement — not
#: wrapping the call.
#:
#:   execute_sequence_step  Prachar. Selects an enrolment by id and writes
#:                          against it; a write, so the refusal is the only
#:                          safe answer and not merely the tidy one.
#:   score_candidate        Vetana. Pure arithmetic over a candidate dict
#:                          handed in — it runs no query at all, which is why
#:                          it never grew an org filter. Cheapest of the three
#:                          to fix and the least urgent, since it reads
#:                          nothing.
#:   send_campaign          Prachar, and the most dangerous of the three:
#:                          it takes a campaign id, reads the recipients and
#:                          SENDS. OUTBOUND_MODE is live on staging.
CANNOT_BE_SCOPED: frozenset[str] = frozenset({
    "execute_sequence_step",
    "score_candidate",
    "send_campaign",
})


# ══════════════════════════════════════════════════════════════════════════════
#  LEDGER 2 — a person's id printed with no name beside it
# ══════════════════════════════════════════════════════════════════════════════

#: Read handlers that return a person's identifier in a row that carries no
#: printable name for that person. EMPTY, and it is meant to stay that way.
#:
#: `services/skills/data/overdue_finder.py` is the reference. It returns BOTH:
#:
#:     "owner":      str(r["owner_id"]) if r["owner_id"] else None,
#:     "owner_name": r["owner_name"] or "Unassigned",
#:
#: — the id because callers key on it (chase counts, grouping, the ack key) and
#: the name because that is the one question a chase list exists to answer. It
#: got there the hard way: the handler used to return the id alone, the dock
#: cannot render a uuid (`frontend/scripts/check-rendered-ids.mjs` forbids it,
#: and rightly — a uuid tells a reader nothing), so the finding reached the
#: screen with WHO left blank.
#:
#: An entry here would have to argue that a row naming a person legitimately
#: cannot name them. Write the argument down; do not just add the name.
RENDERS_AN_ID_WITHOUT_A_NAME: dict[str, str] = {}

#: Key fragments that mean "this value identifies a PERSON or a TENANT" — the
#: three kinds of id the names-not-ids rule is about. An entity's own `id` is
#: not one of them: an invoice id in a finding is a handle the caller needs and
#: nobody is asked to read it as a name.
_IDENTITY_WORDS = (
    "user", "owner", "assignee", "assigned", "employee", "member", "contact",
    "client", "approver", "signer", "staff", "manager", "created_by",
    "raised_by", "org",
)

#: Key fragments that mean "this value is printable". `who`, `company` and the
#: bare person nouns are here because the shelf really does use them that way:
#: `services/skills/data/client_register.py` pairs `client_row_handle` with
#: `client`, which holds the client's name, and `varta_consent.py` pairs
#: `contact_id` with `who`.
_PRINTABLE_WORDS = ("name", "who", "label", "title", "email", "code",
                    "company", "person")


# ══════════════════════════════════════════════════════════════════════════════
#  LEDGER 3 — names in the catalogue that are not skill functions
# ══════════════════════════════════════════════════════════════════════════════

#: Snake-case literals in a template-seeding migration that LOOK like a handler
#: name to the scanner below and are not one.
#:
#:   generate_image   a step key, not a function. Every seeded step carries
#:                    `"generate_image": false` — see
#:                    test_the_catalogue_names_real_skills, which requires it.
NOT_A_SKILL_FUNCTION = frozenset({"generate_image"})

#: Migration 059's seventeen ghosts, recorded so the scanner can skip that one
#: file without skipping it silently.
#:
#: 059 was written against a module layout that was planned and never built —
#: `services.skills.ganit`, `.manav`, `.vetana`, none of them ever written — so
#: not one of these seventeen resolves to anything. It is INERT: probed
#: read-only against the live database on 2026-08-20, no live template row
#: carries any of them, so those seeds never landed.
#:
#: SIX of the seventeen are recorded in `UNIMPLEMENTED_SKILL_FUNCTIONS`. The
#: other ELEVEN are not, and that gap is pinned here rather than left as a
#: sentence in a comment somewhere, so that recording one of them — or building
#: it — is a visible edit.
GHOSTS_OF_059 = frozenset({
    "dristi_scheduled_reports", "ganit_categorize_expenses",
    "ganit_overdue_invoices", "ganit_recurring_invoices",
    "graha_contact_dedup", "graha_followup_reminders", "graha_stale_deals",
    "manav_auto_mark_attendance", "manav_onboarding_checklist",
    "manav_schedule_shifts", "manav_sync_leave_balances", "pm_auto_archive",
    "pm_deadline_escalation", "prachar_campaign_scheduler",
    "vetana_deliver_payslips", "vetana_trigger_payroll",
    "vikray_low_stock_alert",
})

#: The catalogue's naming convention, as migration 166 fixed it: a skill is a
#: CHECK, a BRIEF or a PACK, or one of the older verbs. Used only to spot a
#: function name inside a migration's VALUES list — 177 through 180 build their
#: steps as `'"skill_function":"' || v.fn || '"'`, so the JSON-shaped regex the
#: older catalogue test uses does not see them at all.
_VERBS = ("check_", "brief_", "pack_", "find_", "get_", "score_", "detect_",
          "triage_", "compare_", "propose_", "scan_", "aggregate_", "weekly_",
          "match_", "execute_", "generate_", "mark_", "send_")

_LINE_COMMENT = re.compile(r"--[^\n]*")
_SQL_LITERAL = re.compile(r"'((?:[^']|'')*)'", re.S)
_JSON_FUNCTION_REF = re.compile(r'"skill_function"\s*:\s*"([a-z_0-9]+)"')
_SNAKE = re.compile(r"[a-z][a-z0-9_]*_[a-z0-9_]+")


# ══════════════════════════════════════════════════════════════════════════════
#  Source analysis. Nothing here executes a handler.
# ══════════════════════════════════════════════════════════════════════════════

def _handler(skill_function):
    return asyncio.run(_resolve_handler(skill_function))


def _module_functions(handler) -> dict[str, ast.AST]:
    """Every function defined in the handler's module, by name."""
    source = Path(inspect.getsourcefile(handler)).read_text(encoding="utf-8")
    return {
        node.name: node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _reachable(defs: dict[str, ast.AST], entry: str) -> set[str]:
    """The entry function and everything it calls by name inside its module.

    A handler's SQL is frequently not in the handler: `people_checks` and
    `client_register` both push their statements into module-level helpers, so
    reading only the entry function's source would miss most of the shelf and
    report it clean. Call-graph within the module is enough — a call into
    another module is followed by neither test here, and the two places that
    matter (`services/skills/action/`, and the write scan below) are covered by
    the directory rule instead.
    """
    seen: set[str] = set()
    stack = [entry]
    while stack:
        name = stack.pop()
        if name in seen or name not in defs:
            continue
        seen.add(name)
        for node in ast.walk(defs[name]):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                stack.append(node.func.id)
    return seen


def _string_constants(node: ast.AST) -> str:
    """Every string literal under `node`, joined.

    STRING LITERALS ONLY, so a docstring that says "this never runs an UPDATE"
    cannot be mistaken for one. That is not hypothetical: half the modules on
    this shelf spend more lines explaining what they refuse to write than
    writing anything, and a naive `"UPDATE" in source` would call every one of
    them a write path. Docstrings are excluded by taking `Expr` statements out
    first; ordinary literals — which is what SQL is — are kept.
    """
    docstrings = {
        n.value for n in ast.walk(node)
        if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
    }
    return "\n".join(
        n.value for n in ast.walk(node)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and n not in docstrings
    )


#: A statement that changes rows.
#:
#: `FOR UPDATE` cannot match: it is a locking clause on a SELECT and takes no
#: `SET`. `updated_at` cannot match: a keyword needs whitespace after it.
#: `TRUNCATE` must be followed by `TABLE`, because four modules on this shelf
#: use the English word — "free to show, truncate, replace or drop" — about
#: what a payment app does to a UPI note, and a bare `\btruncate\b` called
#: `check_upi_reference_threading` a write path on the strength of a sentence.
_WRITE_SQL = re.compile(
    r"\b(insert\s+into|update\s+[a-z_.\"]+\s+set|delete\s+from|truncate\s+table)\b",
    re.I,
)

#: Functions that put something in front of a person outside this system. A
#: send is not a row change and is every bit as irreversible — more so, since
#: a row can be corrected and a delivered email cannot be recalled.
#:
#: `execute_onboarding` is why this signal exists at all. It is a declared
#: write handler and it runs no INSERT, UPDATE or DELETE anywhere: it reads the
#: employee, reads two tables to see what already exists, and SENDS A WELCOME
#: EMAIL. A detector that only looked for write SQL would have reported it
#: clean and, worse, would have made "this skill does not write" mean "this
#: skill does not touch the database" — which is not the promise the gate is
#: making. `OUTBOUND_MODE` is live on staging; the mail is real.
_OUTBOUND_CALLS = frozenset({
    "send_email", "send_bulk_email", "send_push", "send_push_to_users",
    "send_whatsapp", "send_sms", "publish", "dispatch_email",
})


def _writes_by_source(skill_function: str) -> tuple[bool, str]:
    """Does this handler change anything? Answered from the source, not the name.

    Three signals:

      · its own SQL, or the SQL of any helper it calls, contains a statement
        that writes;
      · it calls something that sends;
      · the handler lives under `services/skills/action/`, the directory the
        write handlers were deliberately put in — a backstop, so that a write
        this scan cannot follow into another module still lands on the right
        side of the line.

    Deriving it from the NAME would be circular — `generate_due_invoices` and
    `check_duplicate_vendor_bills` are named after what they do, so a name test
    proves only that somebody named them consistently. `pack_collection_messages`
    is the case that makes the point: it drafts a chase message for every
    overdue customer and SENDS NOTHING, and a name-shaped rule that decided
    "pack + messages = writes" would either wrongly gate it or, worse, teach a
    reader that a pack is a send.
    """
    _, fn_name, _ = SKILL_REGISTRY[skill_function]
    handler = _handler(skill_function)
    path = Path(inspect.getsourcefile(handler))

    match = _write_sql_in(handler, fn_name)
    if match:
        return True, f"{match!r} in {path.name}"
    sends = _outbound_calls_in(handler, fn_name)
    if sends:
        return True, f"calls {sorted(sends)} in {path.name}"
    if "/services/skills/action/" in path.as_posix():
        return True, f"lives in services/skills/action/ ({path.name})"
    return False, ""


def _write_sql_in(handler, fn_name: str) -> str | None:
    """The first row-changing statement this handler can reach, if any."""
    defs = _module_functions(handler)
    blob = "\n".join(
        _string_constants(defs[name]) for name in _reachable(defs, fn_name)
        if name in defs
    )
    found = _WRITE_SQL.search(blob)
    return found.group(0) if found else None


def _outbound_calls_in(handler, fn_name: str) -> set[str]:
    """Every sender this handler can reach, by the name it is called under."""
    defs = _module_functions(handler)
    calls: set[str] = set()
    for name in _reachable(defs, fn_name):
        if name not in defs:
            continue
        for node in ast.walk(defs[name]):
            if not isinstance(node, ast.Call):
                continue
            called = (node.func.id if isinstance(node.func, ast.Name)
                      else node.func.attr if isinstance(node.func, ast.Attribute)
                      else None)
            if called in _OUTBOUND_CALLS:
                calls.add(called)
    return calls


def _is_identity_expression(node: ast.AST) -> str | None:
    """The column this expression reads, if it reads an identifier column.

    Deliberately shallow: only `r["x_id"]`, `str(r["x_id"])`, and the two
    guarded forms those are written in (`... if ... else None`, `... or ...`).
    An `ast.walk` here was the first attempt and it was wrong in both
    directions — it reached inside a NESTED dict, so `{"contact": {"id": ...}}`
    was reported as an id printed at the outer level when the inner dict names
    the contact perfectly well, and it counted
    `len({r["id"] for r in unplaced})`, which is a COUNT of rows and not an id
    at all.
    """
    if (isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)):
        key = node.slice.value.lower()
        if key == "id" or key.endswith("_id") or key.endswith("_uuid"):
            return key
        return None
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id == "str" and len(node.args) == 1):
        return _is_identity_expression(node.args[0])
    if isinstance(node, ast.IfExp):
        return (_is_identity_expression(node.body)
                or _is_identity_expression(node.orelse))
    if isinstance(node, ast.BoolOp):
        for value in node.values:
            found = _is_identity_expression(value)
            if found:
                return found
    return None


def _identity_fields(skill_function: str) -> list[dict]:
    """Every dict entry in this handler that puts a person's id in a row.

    Returns one record per entry, each saying whether a printable name sits
    beside it in the same dict.
    """
    module_path, fn_name, _ = SKILL_REGISTRY[skill_function]
    handler = _handler(skill_function)
    defs = _module_functions(handler)

    found: list[dict] = []
    for name in sorted(_reachable(defs, fn_name)):
        if name not in defs:
            continue
        for node in ast.walk(defs[name]):
            if not isinstance(node, ast.Dict):
                continue
            keys = [
                k.value if isinstance(k, ast.Constant) and isinstance(k.value, str)
                else None
                for k in node.keys
            ]
            for key, value in zip(keys, node.values):
                if key is None:
                    continue
                column = _is_identity_expression(value)
                if not column:
                    continue
                if not (_is_identity_key(key) or _is_identity_key(column)):
                    continue
                # A sibling names the person if it READS as a name and does not
                # itself hold an id. Two shapes count, because the shelf uses
                # both: an explicitly printable key (`owner_name`, `who`), and
                # a bare person noun holding something that is not an
                # identifier — `client_register.py` pairs `client_row_handle`
                # with `client`, which holds the client's name.
                siblings = [
                    other for i, other in enumerate(keys)
                    if other and other != key
                    and (_is_printable_key(other) or _is_identity_key(other))
                    and not _is_identity_expression(node.values[i])
                ]
                found.append({
                    "function": name,
                    "line": node.lineno,
                    "key": key,
                    "column": column,
                    "named_by": siblings,
                    "row": [k for k in keys if k],
                })
    return found


def _is_identity_key(key: str) -> bool:
    return any(word in key.lower() for word in _IDENTITY_WORDS)


def _is_printable_key(key: str) -> bool:
    return any(word in key.lower() for word in _PRINTABLE_WORDS)


def _required_beyond_defaults(skill_function: str) -> tuple[str, ...]:
    """What a caller must still name after the registry defaults are applied.

    `pool` and `org_id` come from the dispatcher; `user_id` is injected from
    the caller's own session. Everything else with no default is a question
    somebody has to answer before the skill can run.
    """
    _, _, defaults = SKILL_REGISTRY[skill_function]
    params = inspect.signature(_handler(skill_function)).parameters
    return tuple(sorted(
        name for name, spec in params.items()
        if name not in ("pool", "org_id", "user_id")
        and spec.default is inspect.Parameter.empty
        and spec.kind in (spec.POSITIONAL_OR_KEYWORD, spec.KEYWORD_ONLY)
        and name not in (defaults or {})
    ))


def _template_migrations() -> list[Path]:
    """Every migration that puts a card on the shelf.

    Globbed, not listed. A hand-kept list of files is the thing that let 177
    through 180 seed twelve templates with no coverage at all: the older
    catalogue test names its seven migrations explicitly and its drift guard
    looks for the JSON-shaped `"skill_function":"name"`, which those four do
    not contain — they concatenate the name in from a VALUES column.
    """
    return sorted(
        path for path in MIGRATIONS.glob("*.sql")
        if not path.name.startswith("PROPOSED_")
        and "hub_skill_templates" in path.read_text(encoding="utf-8",
                                                    errors="replace")
    )


def _functions_named_by(path: Path) -> set[str]:
    """Skill function names a seeding migration puts on a card.

    Comments are stripped FIRST, and that ordering is load-bearing. These files
    open with pages of prose, and the prose has apostrophes in it — "the firm's
    books" — so every unpaired `'` in a header shifts SQL literal parsing for
    the rest of the file. Extracting literals from the raw text found ZERO
    names in migration 178, whose three cards are perfectly ordinary rows.
    """
    text = _LINE_COMMENT.sub("", path.read_text(encoding="utf-8", errors="replace"))
    names = set(_JSON_FUNCTION_REF.findall(text))
    names |= {
        literal for literal in _SQL_LITERAL.findall(text)
        if _SNAKE.fullmatch(literal or "") and literal.startswith(_VERBS)
    }
    return names - NOT_A_SKILL_FUNCTION


# ══════════════════════════════════════════════════════════════════════════════
#  1 · Every entry imports
# ══════════════════════════════════════════════════════════════════════════════

def test_the_shelf_is_whole():
    """A registry that failed to import makes every parametrised test below
    vacuous — the classic way a suite reports green while checking nothing."""
    assert len(SKILL_REGISTRY) >= SHELF_FLOOR, (
        f"expected at least {SHELF_FLOOR} skills, found {len(SKILL_REGISTRY)}. "
        f"If skills were deliberately removed, lower SHELF_FLOOR in the same "
        f"commit and say why."
    )


@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_every_registry_entry_resolves_to_an_async_handler(skill_function):
    """Module path resolves, the function exists on it, and it is a coroutine.

    This is the check whose absence is written into `skill_dispatcher`'s own
    header: every entry of the PREVIOUS registry pointed at a module nobody had
    written, and nothing failed loudly because no template carried a
    function-backed step. Templates carry them now.
    """
    module_path, fn_name, defaults = SKILL_REGISTRY[skill_function]

    handler = _handler(skill_function)
    assert callable(handler), f"{skill_function} resolved to something uncallable"
    assert inspect.iscoroutinefunction(handler), (
        f"{skill_function} -> {module_path}.{fn_name} is not async. "
        f"`_run_function_step` awaits the result, so a plain function returns "
        f"a value that is never awaited and the step records a coroutine "
        f"object as its finding."
    )
    assert isinstance(defaults, dict), (
        f"{skill_function}'s registry defaults are {type(defaults).__name__}, "
        f"not a dict; `_run_function_step` splats them into the call."
    )


@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_every_handler_can_be_scoped_to_one_tenant(skill_function):
    """`_run_function_step` refuses a handler that cannot take `org_id`.

    Refusing is right — passing org_id to a handler that does not accept it is
    a TypeError, and scoping from the outside is impossible because the filter
    belongs inside the handler's own query — but the refusal arrives in front
    of whoever pressed Run. Seven handlers were once on the wrong side of this
    and each selected by a team or entity id with no org filter of its own,
    which is a cross-TENANT read.
    """
    params = inspect.signature(_handler(skill_function)).parameters
    scopable = ("org_id" in params
                or any(p.kind is inspect.Parameter.VAR_KEYWORD
                       for p in params.values()))

    if skill_function in CANNOT_BE_SCOPED:
        assert not scopable, (
            f"{skill_function} takes org_id now. Remove it from "
            f"CANNOT_BE_SCOPED — the debt is paid and the dispatcher will run "
            f"it."
        )
        return

    assert scopable, (
        f"{skill_function} does not accept org_id, so the dispatcher refuses "
        f"every run of it. Give its handler org_id and filter on it inside the "
        f"query — the tenant boundary belongs in the statement, not around it. "
        f"If it genuinely cannot be scoped, record it in CANNOT_BE_SCOPED with "
        f"the reason, and know that the card is dead until somebody does."
    )


def test_the_unscopable_ledger_is_exact():
    """Three handlers are refused by the dispatcher. Four would mean new work
    shipped a card nobody can run; two would mean one was fixed and the ledger
    was not."""
    measured = set()
    for name in SKILL_REGISTRY:
        params = inspect.signature(_handler(name)).parameters
        if not ("org_id" in params
                or any(p.kind is inspect.Parameter.VAR_KEYWORD
                       for p in params.values())):
            measured.add(name)
    assert measured == set(CANNOT_BE_SCOPED), (
        f"CANNOT_BE_SCOPED disagrees with the signatures.\n"
        f"  newly unscopable: {sorted(measured - set(CANNOT_BE_SCOPED))}\n"
        f"  now scopable: {sorted(set(CANNOT_BE_SCOPED) - measured)}"
    )


@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_every_handler_declares_which_modules_it_reads(skill_function):
    """`services/skills/modules.py` is what the entitlement gate reads.

    An undeclared handler falls through to the maximally-restricted default:
    safe, but nobody can run the card and no error explains why. Note the
    check is for the KEY, not for a non-empty value — `FREE` is an empty
    frozenset and is a real declaration, meaning "this reads nothing gated".
    """
    assert skill_function in FUNCTION_MODULES, (
        f"{skill_function} declares no modules. Add it to FUNCTION_MODULES — "
        f"`FREE` if it reads nothing that needs a grant."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  2 · Every entry is runnable, or is declared unrunnable
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_a_one_click_run_can_supply_every_parameter(skill_function):
    """The dock supplies `pool`, `org_id` and the caller's `user_id`. Anything
    else with no default must come from the registry's own defaults — or the
    skill is on-demand only and says so in NEEDS_RUNTIME_INPUT."""
    required = _required_beyond_defaults(skill_function)

    if skill_function in NEEDS_RUNTIME_INPUT:
        assert required == NEEDS_RUNTIME_INPUT[skill_function], (
            f"{skill_function} needs {list(required)}, but NEEDS_RUNTIME_INPUT "
            f"records {list(NEEDS_RUNTIME_INPUT[skill_function])}. The ledger "
            f"is what the dock is built against; update it deliberately."
        )
        return

    assert not required, (
        f"{skill_function} cannot be run from the dock: it requires "
        f"{list(required)} and nothing supplies them, so `_run_function_step` "
        f"raises ValueError in front of whoever pressed Run.\n\n"
        f"Either give the parameter a default (the calendar ones live in "
        f"services/skills/timeutil.py), put a value in the registry defaults, "
        f"or add {skill_function!r} to NEEDS_RUNTIME_INPUT to say deliberately "
        f"that this skill answers about one named subject and the dock must "
        f"ask for it."
    )


def test_the_runtime_input_ledger_is_exact():
    """Both directions. A ledger that only grows is a list of excuses."""
    measured = {
        name: _required_beyond_defaults(name)
        for name in SKILL_REGISTRY
        if _required_beyond_defaults(name)
    }
    assert measured == NEEDS_RUNTIME_INPUT, (
        f"NEEDS_RUNTIME_INPUT no longer describes the shelf.\n"
        f"  gained a requirement: "
        f"{sorted(set(measured) - set(NEEDS_RUNTIME_INPUT))}\n"
        f"  no longer requires anything: "
        f"{sorted(set(NEEDS_RUNTIME_INPUT) - set(measured))}\n"
        f"  changed: "
        f"{sorted(k for k in set(measured) & set(NEEDS_RUNTIME_INPUT) if measured[k] != NEEDS_RUNTIME_INPUT[k])}"
    )


def test_the_two_ledgers_of_on_demand_skills_agree():
    """`test_a_skill_can_run_unattended.SUBJECT_BOUND` answers the same question
    for the scheduler that this file answers for the dock, and they must not
    drift: a skill a schedule cannot run is exactly a skill one click cannot
    run, because a schedule supplies strictly less than a person does."""
    from test_a_skill_can_run_unattended import SUBJECT_BOUND

    assert set(NEEDS_RUNTIME_INPUT) == set(SUBJECT_BOUND), (
        f"the dock ledger and the scheduler ledger disagree.\n"
        f"  only NEEDS_RUNTIME_INPUT: "
        f"{sorted(set(NEEDS_RUNTIME_INPUT) - set(SUBJECT_BOUND))}\n"
        f"  only SUBJECT_BOUND: "
        f"{sorted(set(SUBJECT_BOUND) - set(NEEDS_RUNTIME_INPUT))}"
    )


def test_the_step_editor_reports_what_a_skill_needs_before_it_is_run():
    """The whole point of the distinction: unrunnable must be KNOWABLE.

    `describe_skill_functions` is what the step editor and the dock read. If it
    under-reports `needs`, a template saves cleanly and fails at run time in
    front of the customer rather than the author — which is the failure mode
    this area has already had once, in the other direction.
    """
    described = {row["name"]: row for row in describe_skill_functions()}

    assert set(described) == set(SKILL_REGISTRY), (
        "describe_skill_functions dropped or invented entries"
    )

    reported = {
        name: tuple(sorted(row["needs"]))
        for name, row in described.items() if row["needs"]
    }
    assert reported == NEEDS_RUNTIME_INPUT, (
        f"the step editor's `needs` disagrees with the ledger: {reported}"
    )

    broken = {name for name, row in described.items() if not row["available"]}
    assert broken == set(CANNOT_BE_SCOPED), (
        f"describe_skill_functions reports these unavailable: {sorted(broken)}, "
        f"and CANNOT_BE_SCOPED records {sorted(CANNOT_BE_SCOPED)}. An "
        f"unavailable entry is offered to nobody and can never be run, so the "
        f"two must agree or the editor is greying the wrong rows."
    )
    for name in sorted(broken):
        assert described[name].get("unavailable_reason"), (
            f"{name} is offered as unavailable with no reason. A greyed row "
            f"with no explanation is indistinguishable from a bug."
        )


@pytest.mark.parametrize("skill_function", sorted(NEEDS_RUNTIME_INPUT))
def test_an_on_demand_parameter_may_actually_be_asked_for(skill_function):
    """A skill that needs a subject must be ABLE to receive one.

    `RUNTIME_FORBIDDEN_PARAMS` is the list a template may never open to the
    person pressing Run, because a runtime value may select which ROW and never
    which SOURCE. If a required parameter were also forbidden, the skill would
    be unrunnable by every route at once and no error would say so.
    """
    forbidden = sorted(
        set(NEEDS_RUNTIME_INPUT[skill_function]) & RUNTIME_FORBIDDEN_PARAMS
    )
    assert not forbidden, (
        f"{skill_function} requires {forbidden}, which `runtime_params` "
        f"strips. It cannot be run at all: not from a schedule, not from the "
        f"dock, and not by naming the value in the step."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  3 · Writes are declared, and only writes
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("skill_function", sorted(SKILL_REGISTRY))
def test_a_handler_that_writes_is_declared_as_one(skill_function):
    """Derived from the SOURCE — the SQL it runs and the directory it lives in.

    `WRITE_SKILL_FUNCTIONS` is what makes a write opt-in per step. A handler
    that writes and is not in it can be added to any template by any org admin
    and will run without `allow_writes`, which reaches customers and money:
    `send_campaign` sends real mail, and `OUTBOUND_MODE` is live on staging.
    """
    writes, evidence = _writes_by_source(skill_function)
    declared = skill_function in WRITE_SKILL_FUNCTIONS

    if writes and not declared:
        pytest.fail(
            f"{skill_function} changes rows — {evidence} — and is NOT in "
            f"WRITE_SKILL_FUNCTIONS. Any step naming it would run unguarded. "
            f"Add it to that frozenset, or move the write out of the handler."
        )
    if declared and not writes:
        pytest.fail(
            f"{skill_function} is declared a write handler and no statement it "
            f"reaches writes anything. Either the write was removed — in which "
            f"case take it out of WRITE_SKILL_FUNCTIONS, so that steps stop "
            f"having to opt in to a write that no longer happens — or it moved "
            f"into a module this scan does not follow, in which case say so "
            f"here."
        )


def test_the_write_ledger_is_exactly_what_the_source_says():
    """Stated once more as a set, so the failure names the whole disagreement
    rather than one parametrised case at a time."""
    measured = {
        name for name in SKILL_REGISTRY if _writes_by_source(name)[0]
    }
    assert measured == set(WRITE_SKILL_FUNCTIONS), (
        f"WRITE_SKILL_FUNCTIONS disagrees with the source.\n"
        f"  writes but undeclared: {sorted(measured - set(WRITE_SKILL_FUNCTIONS))}\n"
        f"  declared but writes nothing: "
        f"{sorted(set(WRITE_SKILL_FUNCTIONS) - measured)}"
    )


def test_the_write_scan_can_actually_see_a_write():
    """A detector that finds nothing anywhere would pass the test above by
    agreeing with an empty set.

    So every declared write handler must be caught by what it DOES — a write
    statement or a send — and never by the directory backstop alone. The
    directory rule is there to catch a write that moved out of reach of this
    scan; if it were carrying the whole result, the scan would be dead and
    nobody would know.
    """
    assert WRITE_SKILL_FUNCTIONS, "the write ledger is empty"
    for name in sorted(WRITE_SKILL_FUNCTIONS):
        _, fn_name, _ = SKILL_REGISTRY[name]
        handler = _handler(name)
        evidence = _write_sql_in(handler, fn_name) or _outbound_calls_in(
            handler, fn_name)
        assert evidence, (
            f"{name} is a declared write handler and the scan sees neither a "
            f"write statement nor a send in it — only the directory it lives "
            f"in. The detector has gone blind, which would make every 'this "
            f"skill does not write' result meaningless."
        )


def test_a_pack_drafts_and_does_not_send():
    """The distinction migration 166's vocabulary rests on, pinned by example.

    `pack_collection_messages` assembles a chase message for every overdue
    customer. It is the handler most likely to be mistaken for a sender, and it
    must never become one without that being a deliberate, reviewed edit.
    """
    assert "pack_collection_messages" in SKILL_REGISTRY
    assert "pack_collection_messages" not in WRITE_SKILL_FUNCTIONS
    writes, evidence = _writes_by_source("pack_collection_messages")
    assert not writes, (
        f"pack_collection_messages now writes ({evidence}). A pack drafts; it "
        f"does not send and does not record. If this became a send, it needs "
        f"WRITE_SKILL_FUNCTIONS, a step-level allow_writes, and a different "
        f"name."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  4 · Every card on the shelf names a handler that exists
# ══════════════════════════════════════════════════════════════════════════════

def test_the_seeding_migrations_are_found():
    """Guard on the glob. If this returns nothing, the two tests below pass by
    checking an empty set."""
    found = _template_migrations()
    assert len(found) >= 15, (
        f"expected the template-seeding migrations, found "
        f"{[p.name for p in found]}"
    )


@pytest.mark.parametrize(
    "migration", [p.name for p in _template_migrations()])
def test_every_template_names_a_registered_skill(migration):
    """A card naming a function this server does not implement is assignable,
    unrunnable, and only discovered by the customer who presses Run.

    Read from the migrations rather than from the database, for the reason the
    older catalogue test gives: the file is the statement of intent, it is in
    version control, and a check that needs credentials says nothing about a
    migration that has been written and not yet run — which is the window in
    which the mistake is cheap to fix.
    """
    path = MIGRATIONS / migration
    named = _functions_named_by(path)

    if migration.startswith("059_"):
        assert named == GHOSTS_OF_059, (
            f"059's ghosts have changed: {sorted(named ^ GHOSTS_OF_059)}. That "
            f"file is excluded from the check below because NOT ONE of its "
            f"seventeen names has ever resolved; if it has been edited, the "
            f"exclusion needs rewriting rather than extending."
        )
        return

    unknown = sorted(name for name in named if name not in SKILL_REGISTRY)
    assert not unknown, (
        f"{migration} seeds a card naming {unknown}, which has no "
        f"SKILL_REGISTRY entry. `_run_function_step` refuses it."
    )


def test_the_live_catalogue_is_covered_and_not_a_handful_of_cards():
    """Fifty-nine of the seventy-eight live templates carry a skill_function,
    and that is what makes them cost nothing. A scan that saw six of them would
    pass every test above."""
    named: set[str] = set()
    for path in _template_migrations():
        if path.name.startswith("059_"):
            continue
        named |= _functions_named_by(path)

    assert len(named) >= 59, (
        f"only {len(named)} distinct skill functions were found across the "
        f"seeding migrations; the live catalogue names at least 59. The "
        f"extraction has gone blind — check whether a new migration builds its "
        f"steps in a shape neither the JSON regex nor the literal scan sees."
    )
    assert named <= set(SKILL_REGISTRY)


def test_the_ghosts_of_059_are_still_ghosts():
    """Six of the seventeen are recorded in `UNIMPLEMENTED_SKILL_FUNCTIONS` and
    eleven are not. Pinned so that recording one — or building it — is visible
    rather than a comment nobody reads."""
    assert UNIMPLEMENTED_SKILL_FUNCTIONS <= GHOSTS_OF_059
    unrecorded = GHOSTS_OF_059 - UNIMPLEMENTED_SKILL_FUNCTIONS
    assert len(unrecorded) == 11, (
        f"{len(unrecorded)} of 059's names are unrecorded, expected 11: "
        f"{sorted(unrecorded)}"
    )
    resolvable = sorted(name for name in GHOSTS_OF_059 if name in SKILL_REGISTRY)
    assert not resolvable, (
        f"{resolvable} is registered now. Take it out of GHOSTS_OF_059 and out "
        f"of UNIMPLEMENTED_SKILL_FUNCTIONS if it is there — a name that both "
        f"exists and is recorded as never built is a contradiction the next "
        f"reader has to resolve."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  5 · Names, not ids
# ══════════════════════════════════════════════════════════════════════════════

def test_the_reference_handler_returns_the_owner_by_name():
    """`find_overdue` is the pattern the rest are measured against.

    It returns the id AND the name: the id because callers key on it — chase
    counts, grouping, the ack key — and the name because WHO is the entire
    question a chase list exists to answer. The absence sentence matters too: a
    reader seeing "Unassigned" knows the follow-up has nobody on it, where a
    blank reads as a rendering bug and a uuid reads as noise.
    """
    source = inspect.getsource(_handler("find_overdue_tasks"))
    assert '"owner_name"' in source, (
        "find_overdue no longer returns owner_name. This is the reference for "
        "every other handler on the shelf; if it goes, the pattern goes."
    )
    assert '"owner"' in source, (
        "find_overdue no longer returns the owner id. Callers key on it."
    )
    assert "Unassigned" in source, (
        "the missing-name fallback is gone. An absent owner must read as a "
        "sentence, not as an empty cell."
    )


@pytest.mark.parametrize(
    "skill_function",
    sorted(set(SKILL_REGISTRY) - set(WRITE_SKILL_FUNCTIONS)))
def test_no_handler_prints_a_person_as_an_id(skill_function):
    """A row that identifies a person must also name them.

    Write handlers are excluded, and the exclusion is the point rather than an
    omission: `generate_due_invoices` puts `contact_id` into an invoice it is
    INSERTING, where a foreign key is the required value and nobody is being
    asked to read it. This rule is about what a reader is shown.
    """
    offenders = [
        field for field in _identity_fields(skill_function)
        if not field["named_by"]
    ]

    if skill_function in RENDERS_AN_ID_WITHOUT_A_NAME:
        assert offenders, (
            f"{skill_function} is listed in RENDERS_AN_ID_WITHOUT_A_NAME and "
            f"now names every person it identifies. Remove the entry — the "
            f"debt is paid."
        )
        return

    assert not offenders, (
        f"{skill_function} returns a person's identifier with no printable "
        f"name beside it:\n"
        + "\n".join(
            f"  {o['function']}:{o['line']}  {o['key']} <- {o['column']}  "
            f"row keys {o['row']}"
            for o in offenders
        )
        + "\n\nThe dock cannot render a uuid — see "
          "frontend/scripts/check-rendered-ids.mjs — so this finding reaches "
          "the screen with WHO left blank. Join the name in the query the way "
          "services/skills/data/overdue_finder.py does (LEFT JOIN public.users, "
          "coalesce name/full_name, and a sentence for the absent case), or "
          "record the entry in RENDERS_AN_ID_WITHOUT_A_NAME with the argument "
          "for why this row cannot name the person it is about."
    )


def test_the_names_not_ids_ledger_is_exact():
    """A stale allowlist is a hole nobody can see."""
    unknown = sorted(set(RENDERS_AN_ID_WITHOUT_A_NAME) - set(SKILL_REGISTRY))
    assert not unknown, (
        f"RENDERS_AN_ID_WITHOUT_A_NAME names handlers that are not registered: "
        f"{unknown}"
    )
    assert set(RENDERS_AN_ID_WITHOUT_A_NAME) <= (
        set(SKILL_REGISTRY) - set(WRITE_SKILL_FUNCTIONS)
    ), "a write handler is not subject to this rule and does not belong here"


def test_the_names_not_ids_scan_actually_finds_identity_fields():
    """The check above passes for a handler that returns nothing at all, so the
    scan has to be shown to see something. Measured 2026-08-21: at least a
    dozen rows across the shelf carry a person's id, and every one of them
    carries the name too."""
    total = sum(
        len(_identity_fields(name))
        for name in sorted(set(SKILL_REGISTRY) - set(WRITE_SKILL_FUNCTIONS))
    )
    assert total >= 10, (
        f"the identity scan found {total} person-identifying fields across the "
        f"whole shelf, which is too few to believe. It has stopped matching — "
        f"probably a change in how rows are built — and is now proving nothing."
    )


# ══════════════════════════════════════════════════════════════════════════════
#  6 · The harness itself
# ══════════════════════════════════════════════════════════════════════════════

def test_nothing_here_runs_a_write_skill():
    """This file never calls a handler at all, and the write handlers reach
    real customers: `send_campaign` sends mail and OUTBOUND_MODE is live on
    staging. Pinned as source, because the day somebody adds a "just run them
    all and see" test is the day this needs to be visible."""
    source = Path(__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    awaited_handlers = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Await)
    ]
    assert not awaited_handlers, (
        "a handler is being awaited in this file. Every check here is static "
        "for a reason: a MagicMock pool echoes its fixture back, so calling a "
        "read handler proves only that the mock answered, and calling a write "
        "handler is a real send."
    )
    assert "OUTBOUND_MODE" in os.environ, (
        "conftest must have pinned OUTBOUND_MODE before any app import"
    )
    assert os.environ["OUTBOUND_MODE"] == "dry"
