"""SIXTY-ONE SKILLS THAT ANSWERED A QUESTION AND TOLD NOBODY.

Fifty-nine of the seventy-eight live templates are `skill_function`-only: they
carry no model step, cost nothing, and their whole value is the finding — the
forty-two unpaid vendor bills, the employees with no UAN, the invoices that
cannot be filed.

`execute_org_skill` put that finding into `prior_facts` and nowhere else.
`prior_facts` exists solely to ground a LATER model step's prompt, so on a
template with no model step it was read by nothing and garbage-collected when
the loop ended. Only an AI step writes a `hub_content_items` row, so the
response carried `content_ids: []`, and the screen said:

    "Finished — 3 steps, 0 credits. 0 items are waiting in the Content tab."

A run that had just listed a firm's entire overdue book reported a count of
zero. Nothing downstream could have rendered it, because nothing downstream
ever received it.

This file pins the path from a handler's return value to the caller. It is a
SOURCE test: reaching that code needs a granted org skill, a live pool and a
credit wallet, and a test that needs all three to notice a deleted dict key is
not the test that will notice it.
"""
import ast
import inspect
import re

import pytest

from routers import hub


def _appends(body: str, status: str) -> list[str]:
    """Every `outputs.append({...})` in `body` whose dict carries `status`.

    Brace-COUNTING rather than a regex, and the reason is a bug this test had
    on its first run: the failed-step record contains
    `f"{type(exc).__name__}: {exc}"`, so a `[^}]*` scan stops at the first
    inner brace and reports the block as absent. The test then accused correct
    code, which is the one thing a ratchet must never do.
    """
    out = []
    needle = 'outputs.append({'
    i = body.find(needle)
    while i != -1:
        depth, j = 0, i + len(needle) - 1
        while j < len(body):
            if body[j] == '{':
                depth += 1
            elif body[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        block = body[i:j + 1]
        if f'"status": "{status}"' in block:
            out.append(block)
        i = body.find(needle, j)
    return out


def _run_functions():
    """Both run paths. The org one is what a customer presses; the client one
    is the agency surface. They were written apart and drifted apart, and the
    findings defect was present in BOTH — which is the argument for testing
    them as a pair rather than trusting one to stand for the other."""
    src = inspect.getsource(hub)
    tree = ast.parse(src)
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            body = ast.get_source_segment(src, node) or ""
            if "_run_function_step(" in body and "prior_facts" in body:
                out[node.name] = body
    return out


def test_both_run_paths_are_found():
    """A rename that hid one of them would make every test below vacuous."""
    fns = _run_functions()
    assert len(fns) >= 2, (
        f"expected the org and client run paths, found {sorted(fns)}"
    )


@pytest.mark.parametrize("size", [1, 2])
def test_the_finding_is_recorded_not_only_prompted(size):
    """`data` must reach `outputs`. This is the whole fix.

    Parametrised only so the failure message names which path broke."""
    fns = sorted(_run_functions().items())
    name, body = fns[size - 1] if len(fns) >= size else fns[0]

    blocks = _appends(body, "ok")
    assert blocks, f"{name}: no successful-function-step record found"
    recorded = blocks[0]

    assert '"data"' in recorded, (
        f"{name} records a function step without its findings. `data` is what "
        f"the skill FOUND; without it the run reports a count and the caller "
        f"has nothing to draw. This is the defect the file's docstring "
        f"describes."
    )
    assert '"label"' in recorded, (
        f"{name}: a finding with no label renders as an anonymous table"
    )
    assert '"truncated"' in recorded, (
        f"{name}: a clipped finding must SAY it was clipped. A silently short "
        f"list on a compliance check is worse than no list."
    )


def test_the_size_bound_exists_and_is_a_number_not_a_guess():
    """`hub_org_skill_runs.outputs` is jsonb written on EVERY run. An unbounded
    copy of a large report goes into the database each time and back out in
    every response that reads it."""
    assert isinstance(hub._MAX_FINDING_CHARS, int)
    assert 5_000 <= hub._MAX_FINDING_CHARS <= 100_000, (
        "too small hides real findings, too large writes reports into a run row"
    )


@pytest.mark.parametrize("size", [1, 2])
def test_an_oversized_finding_degrades_to_text_rather_than_to_nothing(size):
    fns = sorted(_run_functions().items())
    name, body = fns[size - 1] if len(fns) >= size else fns[0]
    assert '"data_text"' in body, (
        f"{name}: when a finding will not fit, send the text. 'We could not "
        f"show you this' is a worse answer than an unstyled one."
    )


def test_the_response_carries_the_findings():
    """Recording them on the run row is half the job — the caller that pressed
    Run gets the response, not the row."""
    src = inspect.getsource(hub)
    # Both completed-run responses.
    bodies = re.findall(
        r'return\s*\{[^}]*"run_id":\s*str\(run_id\)[^}]*\}', src, re.S)
    assert len(bodies) >= 2, "expected both run responses"
    for i, b in enumerate(bodies):
        assert '"outputs"' in b, (
            f"run response {i + 1} returns counts but not findings — the "
            f"screen can only draw a number from it"
        )


def test_the_assigned_list_returns_the_taxonomy():
    """Migration 166 built `module` and `skill_type` and the endpoint a
    customer actually reads returned neither, so 61 assigned skills rendered
    as one flat list with nothing to group or filter by."""
    src = inspect.getsource(hub.list_org_skills)
    assert "t.module" in src and "t.skill_type" in src, (
        "the assigned-skills list must return the taxonomy it is grouped by"
    )


def test_a_failed_function_step_still_says_why():
    """The pre-existing behaviour, pinned so the findings change did not
    quietly cost it: one unreadable source must not void a paid run, and the
    model must be told the source was unavailable rather than empty."""
    for name, body in _run_functions().items():
        blocks = _appends(body, "failed")
        assert blocks, f"{name}: a failed step records nothing"
        assert '"error"' in blocks[0], (
            f"{name}: a failed step must name its error"
        )
        assert "not as empty" in body, (
            f"{name}: the model must be told an unavailable source is unknown, "
            f"not empty — an absent list reads as an all-clear"
        )
