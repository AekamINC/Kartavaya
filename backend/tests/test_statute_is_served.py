"""FORTY-FIVE ROWS OF THE LAW, SERVED TO NOBODY.

`staging.statute_calendar` holds the dated statute this product exists to help
firms obey — form numbers, sections, due days, thresholds, rates, each with an
`effective_from`/`effective_to` window and a `verified_on`. Nine skill handlers
read it through `services/statute.py`.

**No router served it.** Grepped across `backend/routers/`, the word `statute`
appeared exactly once, inside a code comment. So the corner dock's "Due" tab,
a firm's own filing calendar, and any statutory circular a firm might print all
wanted this table and none of them could ask for it.

This file pins the route's existence and, more importantly, the two properties
that make a statutory answer honest rather than merely present.
"""
import pytest

from routers import statute as statute_router_mod


def test_the_route_exists_at_all():
    """The whole point. A 45-row table with no HTTP surface."""
    paths = {r.path for r in statute_router_mod.router.routes}
    assert "/api/v1/statute/obligations" in paths, paths


def test_it_is_registered_on_the_app():
    """A router that exists and is never included is the same as no router —
    `routers/support_sessions.py` is the standing example in this codebase: 401
    lines, complete, and unreachable because nobody wired it in."""
    import server
    assert hasattr(server, "statute_router"), (
        "server.py does not import the statute router"
    )
    src = __import__("inspect").getsource(server)
    assert "app.include_router(statute_router)" in src, (
        "the statute router is imported but never included"
    )


def test_as_of_is_echoed_back():
    """A statutory table with no date on the page is a coin flip.

    The Income-tax Act 2025 transition renumbers 24Q→138, 26Q→140, 16→130 on
    2026-04-01, and `statute_calendar` carries BOTH versions of each. An answer
    that does not say which date it was true on cannot be checked, cannot be
    filed against, and cannot be reproduced next month.
    """
    src = __import__("inspect").getsource(statute_router_mod.list_obligations)
    assert '"as_of": stamp.isoformat()' in src, (
        "the response must carry the date its answer was true on"
    )


def test_a_malformed_date_is_refused_not_guessed():
    """`31-03-2026` is a date a person types. Answering it with today's law
    tells them something false about the law, which is worse than refusing."""
    with pytest.raises(Exception) as exc:
        statute_router_mod._parse_as_of("31-03-2026")
    assert "422" in str(exc.value) or "as_of" in str(exc.value)


def test_an_absent_date_means_today_and_that_is_deliberate():
    from datetime import datetime, timezone
    assert statute_router_mod._parse_as_of(None) == datetime.now(timezone.utc).date()
    assert statute_router_mod._parse_as_of("") == datetime.now(timezone.utc).date()


def test_a_good_date_survives_intact():
    from datetime import date
    assert statute_router_mod._parse_as_of("2026-04-01") == date(2026, 4, 1)


def test_the_filters_are_allowlisted_not_passed_through():
    """`authority` and `periodicity` reach a SQL predicate. Every dynamic
    identifier in this codebase comes from a server-side allowlist, and these
    are no exception."""
    assert statute_router_mod._AUTHORITIES == ("gst", "income_tax", "epfo", "esic")
    assert "standing" in statute_router_mod._PERIODICITIES


def test_standing_rules_are_called_out_rather_than_left_to_infer():
    """18 of the 45 live rows are rules in force with NO date — rates, ceilings,
    thresholds. A "due dates" screen that quietly included them would print a
    deadline for the ESI wage ceiling, which is not a thing that has one."""
    src = __import__("inspect").getsource(statute_router_mod.list_obligations)
    # Matched on single tokens rather than a phrase: the sentence is split
    # across two adjacent string literals ("...in force, not " "deadlines:"),
    # so a phrase match would be testing the line wrapping, not the meaning.
    assert "standing" in src
    assert "deadlines" in src


def test_the_router_never_hardcodes_a_statutory_fact():
    """`services/statute.py` is the only permitted source. A form number or a
    due day written into this file would be a fact with no date attached, and
    the renumbering already made three such literals wrong on their face
    elsewhere in this codebase.
    """
    import ast
    import inspect
    import re
    src = inspect.getsource(statute_router_mod)
    # Strip docstrings AND comments with `ast`, not by eye. The line-prefix
    # version this replaced left the MODULE docstring intact — and that
    # docstring discusses 24Q and 138 precisely because the renumbering is the
    # reason this rule exists — so the test failed on its own explanation of
    # itself. `ast.unparse` drops comments for free.
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if (isinstance(node, (ast.Module, ast.ClassDef,
                              ast.FunctionDef, ast.AsyncFunctionDef))
                and ast.get_docstring(node) is not None):
            node.body = node.body[1:]
    code = ast.unparse(tree)
    for pattern in (r"\b24Q\b", r"\b26Q\b", r"\bGSTR-\d", r"\bsection\s+\d{2,}"):
        assert not re.search(pattern, code), (
            f"a statutory literal ({pattern}) is written into the router; "
            f"read it from services.statute with an as_of instead"
        )
