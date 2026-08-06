"""
Pahchan's attendance summary reports are configured and nothing sends them.

WHAT WAS WRONG. `staging.pahchan_policy` carries `report_daily`,
`report_weekly`, `report_monthly` and `report_recipients`. NO FUNCTION IN THE
BACKEND READS ANY OF THEM. There is no sender, no template, no cron and no
consumer of the recipient list — the only three things that touch those names
are the Pydantic model, the defaults dict and the upsert.

That alone is dead configuration. What made it a promise is that all three flags
defaulted to TRUE, in `DEFAULT_POLICY` and in the schema: an org that has never
opened the policy screen was shown three ticked boxes under a heading that says
"Reports", each naming a summary email that no code exists to send.

WHAT WAS DONE, AND WHAT WAS NOT. The defaults are false here and in migration
106 (written, not applied), and the screen carries a warning saying delivery is
not built. The columns are kept and the checkboxes stay usable, because the
preference is real and is what a sender will read on the day one is written —
what was wrong was the silence, not the checkbox.

The sender itself was NOT built, and that is a decision rather than an omission:
it needs a cron service, and this product has twelve of thirteen cron routes
with no scheduler already. Adding a thirteenth unscheduled route would be the
same defect in a new place.

MEASURED 6 August 2026. `staging.pahchan_policy` holds 2 rows: the E2E test org
with all three off, and Unicode Group with weekly and monthly on and
`hr@unicodegroup.com` in the recipients — a row written by the demo seed at
2026-08-05 12:39:35, not by anyone at the customer. So flipping the defaults
strands nobody's real choice.

THE TRIPWIRE HERE FAILS ON GOOD NEWS. `test_nothing_reads_the_report_flags` goes
red the day a sender exists. Red means "there is a reader now — revisit the
defaults and take the warning off the screen".
"""

import ast
import os

import routers.pahchan as pahchan


BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

#: The four columns, written out. Not derived from the model, because the model
#: is one of the three places that would have to be wrong together for this to
#: be silently satisfied.
REPORT_COLUMNS = (
    "report_daily",
    "report_weekly",
    "report_monthly",
    "report_recipients",
)

#: The three that are a promise. `report_recipients` is a list and defaults to
#: empty, which promises nothing on its own.
REPORT_FLAGS = ("report_daily", "report_weekly", "report_monthly")


def test_no_summary_report_is_on_by_default():
    """An org that never opens the screen is not recorded as wanting three
    reports the product cannot deliver.

    This is the argument `overtime_enabled` already makes in the same dict —
    "an org that never opens this screen keeps exactly today's behaviour" —
    applied to a promise instead of to a payment.
    """
    for flag in REPORT_FLAGS:
        assert pahchan.DEFAULT_POLICY[flag] is False, (
            f"{flag} defaults to True, so every org that has never opened the "
            f"Pahchan policy screen is shown a ticked box for a report nothing "
            f"sends. If a sender now exists, this test is the wrong thing to "
            f"change first — see test_nothing_reads_the_report_flags."
        )


def test_the_recipient_list_defaults_to_empty():
    """A default recipient would be a stranger's address on a report."""
    assert pahchan.DEFAULT_POLICY["report_recipients"] == []


def test_the_defaults_dict_still_covers_every_report_column():
    """`_policy` returns this dict verbatim for an org with no row.

    A column missing here is a KeyError on the screen for a brand-new org, which
    is how the policy page would go blank for exactly the orgs least able to
    diagnose it.
    """
    for column in REPORT_COLUMNS:
        assert column in pahchan.DEFAULT_POLICY


def _stripped_source(path: str) -> str:
    """Source with every comment and docstring removed.

    All four column names are written in prose in `routers/pahchan.py`, in
    migration 106 and in this file's own docstring. A raw scan would find the
    explanation of the absence and call it a reader.
    """
    with open(path, "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef,
                                 ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = getattr(node, "body", None)
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)):
            node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def test_the_stripper_actually_strips():
    """Without this the scan below could be reading nothing at all."""
    raw = open(pahchan.__file__, "r", encoding="utf-8").read()
    stripped = _stripped_source(pahchan.__file__)
    # In the comment above DEFAULT_POLICY's report flags, and nowhere else.
    assert "nobody's default" in raw
    assert "nobody's default" not in stripped


def _python_files():
    skip = {"__pycache__", "tests", "migrations", "node_modules", ".venv",
            "venv", "scripts"}
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(root, name)


def test_nothing_reads_the_report_flags():
    """Only `routers/pahchan.py` names these columns, and only to store them.

    THIS GOING RED IS NOT NECESSARILY A REGRESSION. A sender landing is exactly
    what makes it fail. When that happens: add the sender's module to
    `READERS_ALLOWED`, decide deliberately whether the defaults should go back
    to True, and take the "Not being delivered yet" warning off
    `frontend/src/pages/pahchan/PahchanPolicy.jsx`.

    Keeping the allowed set literal, rather than "everything except a sender",
    is what makes a second reader appearing visible at all.
    """
    READERS_ALLOWED = {"routers/pahchan.py"}

    readers = []
    for path in _python_files():
        rel = os.path.relpath(path, BACKEND).replace(os.sep, "/")
        if rel in READERS_ALLOWED:
            continue
        try:
            code = _stripped_source(path)
        except SyntaxError:
            continue
        for column in REPORT_COLUMNS:
            if column in code:
                readers.append(f"{rel}: {column}")

    assert not readers, (
        "Something now references a Pahchan report column:\n  "
        + "\n  ".join(readers)
        + "\nIf a summary sender has landed, add it to READERS_ALLOWED, revisit "
          "DEFAULT_POLICY, and remove the warning from PahchanPolicy.jsx."
    )


def test_pahchan_itself_only_stores_them_and_never_acts_on_them():
    """Inside the one allowed file, the columns appear in SQL and in the model.

    The distinction that matters is between a column being WRITTEN and a column
    being ACTED ON. A branch on the flag — `if policy["report_weekly"]:` — is
    the first line of a sender, and its absence is the finding.
    """
    code = _stripped_source(pahchan.__file__)
    for flag in REPORT_FLAGS:
        for acting in (
            f'if policy["{flag}"]',
            f"if policy['{flag}']",
            f'policy.get("{flag}")',
            f"policy.get('{flag}')",
            f'if merged["{flag}"]',
        ):
            assert acting not in code, (
                f"{flag} is being branched on in routers/pahchan.py — something "
                f"is acting on a flag nothing delivers."
            )


def test_the_acting_scan_would_catch_a_sender():
    """The check above passing means nothing unless the pattern can match.

    A sender's first line is a branch on the flag; a store is a column name in
    SQL. These two strings are the difference, and the scan has to tell them
    apart.
    """
    sender_like = 'if policy["report_weekly"]:\n    await send_summary(...)\n'
    store_like = "INSERT INTO staging.pahchan_policy (report_weekly) VALUES ($1)"
    assert 'if policy["report_weekly"]' in sender_like
    assert 'if policy["report_weekly"]' not in store_like
