"""Ratchet: runtime schema probes must be search_path-relative.

WHY THIS TEST EXISTS
====================
The `staging` schema is being folded into `public`, after which `staging` will
not exist. A probe that still names it does **not** raise. `to_regclass`
returns NULL for an unknown relation, and an `information_schema` filter on a
dead schema simply matches no row. The caller then takes its "table absent"
branch *silently*. Two of those branches are security controls:

  * `backend/auth_router.py` - a NULL probe skips 2FA entirely, including the
    `tfa_enforced` 403, and still issues a full session JWT.
  * `backend/middleware/module_levels.py` - a NULL probe lets any org admin and
    any platform staff release payroll and invoices.

So a hardcoded schema inside a probe is not a style nit. It is a silent
authorisation bypass on a delayed fuse, and it looks exactly like healthy code
until the day the schema disappears. This test converts that whole class of
silent failure into a loud one - from pure source analysis, with **no
database**, so it runs in CI where `DATABASE_URL` is unset.

`public` is forbidden for the same reason as `staging`. The rule is not "name
the right schema", it is "name no schema": a probe must resolve through
`search_path`, so that moving a table between schemas cannot change the answer.

WHAT THIS TEST DOES NOT COVER - read this before trusting it
============================================================
It matches probe *syntax* in executable code. It deliberately does **not**:

  * Follow a schema-qualified name stored in a constant and handed to a probe
    somewhere else. `routers/org_security.py` has exactly that shape today:
    `TOTP_TABLES = ("staging.user_totp", "staging.user_mfa_factors")` feeding
    `SELECT to_regclass($1)`. That is a live instance of the bug this file is
    about, and a regex cannot see it. It needs eyes.
  * Flag ordinary `FROM staging.foo` queries. Those raise `42P01` - loud, and
    therefore the opposite of the failure guarded here.

If you extend the rules, extend `test_the_matcher_catches_a_planted_violation`
in the same commit. A ratchet nobody has watched fail is not evidence.
"""

from __future__ import annotations

import io
import os
import re
import tokenize
from collections import Counter
from pathlib import Path

import pytest

# -- What to scan -------------------------------------------------------------

BACKEND_ROOT = Path(__file__).resolve().parent.parent

#: `tests` holds this file and its fixtures, which quote the forbidden patterns
#: on purpose. `migrations` is applied history - it is a record of what ran, and
#: rewriting it would be a lie about the past.
EXCLUDED_DIRS = {
    ".venv", "venv", "site-packages", "__pycache__", ".git",
    "tests", "migrations", "node_modules",
}

# -- The rules ----------------------------------------------------------------

SCHEMAS = r"(?:staging|public)"

FORBIDDEN_PATTERNS = {
    # SELECT to_regclass('staging.user_totp')  ->  NULL once staging is gone.
    "to_regclass_literal": re.compile(
        r"to_regclass\s*\(\s*['\"]" + SCHEMAS + r"\.", re.I),
    # 'staging.user_totp'::regclass - raises, but only if the surrounding code
    # does not swallow it; several of these sites sit inside `except Exception`.
    "regclass_cast": re.compile(
        r"['\"]" + SCHEMAS + r"\.\w+['\"]\s*::\s*regclass", re.I),
    # information_schema.tables / .columns filtered to a dead schema.
    "table_schema": re.compile(
        r"table_schema\s*=\s*['\"]" + SCHEMAS + r"['\"]", re.I),
    # pg_tables / pg_indexes / pg_stat_* catalogue views.
    "schemaname": re.compile(
        r"schemaname\s*=\s*['\"]" + SCHEMAS + r"['\"]", re.I),
    # pg_namespace joins.
    "nspname": re.compile(
        r"nspname\s*=\s*['\"]" + SCHEMAS + r"['\"]", re.I),
    # The codemod-proof variant: the SQL is parameterised and looks clean, but
    # the schema is glued onto the bind value on the same line, e.g.
    #     pool.fetchval("SELECT to_regclass($1)", f"staging.{name}")
    "to_regclass_bind_with_literal": re.compile(
        r"to_regclass\s*\(\s*\$\d.*['\"]" + SCHEMAS + r"\.", re.I),
}

#: Proof the probes were rewritten rather than merely deleted. If the codemod is
#: ever reverted wholesale these counts collapse and the anti-vacuity test says
#: so, instead of the ratchet going quietly green over an empty tree.
RELATIVE_PATTERNS = {
    "to_regclass_relative": re.compile(r"to_regclass\s*\(\s*(['\"])[A-Za-z_]\w*\1"),
    "current_schemas": re.compile(r"current_schemas\s*\(\s*false\s*\)", re.I),
}

# -- Known-outstanding baseline -----------------------------------------------
#
# Measured 2026-08-29 against the codemod's output. These are real violations of
# the rule above that this test does not have the standing to fix - they live in
# runtime files owned by another change in flight.
#
# The `table_schema='public'` entries are the *survivable* half of the bug: once
# the consolidation lands they happen to name the right schema, so they will
# keep working. They are still wrong - they hardcode a schema - and they are
# listed here so that the count can only go down.
#
# THIS IS A CEILING, NOT AN AMNESTY. A count above the number here fails. A
# count below it also fails, in `test_the_baseline_has_not_silently_been_fixed`,
# which tells you to delete the entry. Do not raise a number to get to green.
KNOWN_OUTSTANDING = {
    ("routers/org_invites.py", "table_schema"): 1,
    ("server.py", "table_schema"): 3,
    # Builds `f"staging.{name}"` as the bind value for `to_regclass($1)`. This
    # one is NOT survivable: post-consolidation every probe returns NULL, so
    # `prachar_compliance.table_exists()` answers False forever and the
    # compliance gate degrades to silence.
    # FIXED 2026-08-29: the schema was glued onto the bind value
    # (f"staging.{name}"), so no rewrite of the SQL text could see it.
    # Now passes `name` bare and resolves through search_path.
    ("services/prachar_compliance.py", "to_regclass_bind_with_literal"): 0,
}

# -- Source analysis ----------------------------------------------------------


class Violation:
    __slots__ = ("relpath", "lineno", "rule", "line")

    def __init__(self, relpath, lineno, rule, line):
        self.relpath, self.lineno, self.rule, self.line = relpath, lineno, rule, line

    def __str__(self):
        return "{}:{}: [{}] {}".format(
            self.relpath, self.lineno, self.rule, self.line.strip())


def _strip_comments_and_docstrings(raw):
    """Blank every comment and docstring, keeping line numbers intact.

    A raw-text scan is useless here: the tree carries six docstrings that
    *document* these very probes, and flagging them would get this file deleted
    by the next person to read it.

    The subtle part, and the reason this is not three lines long, is deciding
    whether a STRING token is a docstring. `tokenize` emits NL (not NEWLINE)
    for line breaks **inside brackets**, so if NL is treated as a valid
    docstring predecessor then every multi-line SQL argument -

        await pool.fetchval(
            "SELECT to_regclass('staging.user_totp')"
        )

    - is misread as a docstring, blanked, and this whole test silently checks
    nothing while staying green. A docstring is a string that opens a *logical
    line* at bracket depth zero; that is what the two state variables below
    track, and `test_the_matcher_catches_a_planted_violation` holds the line.
    """
    lines = raw.decode("utf-8", "replace").splitlines()
    blanks = {}

    def blank(row, start, end):
        blanks.setdefault(row, []).append((start, end))

    depth = 0
    at_line_start = True  # True at the head of a logical line, and at file start

    for tok in tokenize.tokenize(io.BytesIO(raw).readline):
        ttype, text = tok.type, tok.string
        (srow, scol), (erow, ecol) = tok.start, tok.end

        if ttype == tokenize.COMMENT:
            blank(srow, scol, ecol)
            continue
        if ttype == tokenize.NL:
            # Whitespace only. It does NOT open a logical line - see above.
            continue
        if ttype in (tokenize.NEWLINE, tokenize.INDENT,
                     tokenize.DEDENT, tokenize.ENCODING):
            at_line_start = True
            continue
        if ttype == tokenize.STRING:
            if depth == 0 and at_line_start:
                for row in range(srow, erow + 1):
                    start = scol if row == srow else 0
                    end = ecol if row == erow else len(lines[row - 1])
                    blank(row, start, end)
            at_line_start = False
            continue
        if ttype == tokenize.OP:
            if text in "([{":
                depth += 1
            elif text in ")]}":
                depth = max(0, depth - 1)
        at_line_start = False

    out = []
    for i, line in enumerate(lines, 1):
        if i in blanks:
            chars = list(line)
            for start, end in blanks[i]:
                for j in range(start, min(end, len(chars))):
                    chars[j] = " "
            out.append("".join(chars))
        else:
            out.append(line)
    return out


def _scan_source(raw, relpath):
    """Violations and legitimate-probe counts for one file's bytes."""
    original = raw.decode("utf-8", "replace").splitlines()
    code = _strip_comments_and_docstrings(raw)
    violations = []
    counts = Counter()

    for lineno, code_line in enumerate(code, 1):
        for rule, pattern in FORBIDDEN_PATTERNS.items():
            if pattern.search(code_line):
                violations.append(
                    Violation(relpath, lineno, rule, original[lineno - 1]))
        for name, pattern in RELATIVE_PATTERNS.items():
            found = len(pattern.findall(code_line))
            if found:
                counts[name] += found
    return violations, counts


def _iter_runtime_files():
    for dirpath, dirnames, filenames in os.walk(BACKEND_ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for filename in sorted(filenames):
            if filename.endswith(".py"):
                yield Path(dirpath) / filename


def _scan_tree():
    violations = []
    counts = Counter()
    files_with_relative_probes = set()
    scanned = []
    untokenisable = []

    for path in _iter_runtime_files():
        relpath = path.relative_to(BACKEND_ROOT).as_posix()
        scanned.append(relpath)
        raw = path.read_bytes()
        try:
            found, file_counts = _scan_source(raw, relpath)
        except (tokenize.TokenError, SyntaxError, IndentationError) as exc:
            untokenisable.append("{}: {}".format(relpath, exc))
            continue
        violations.extend(found)
        counts.update(file_counts)
        if file_counts:
            files_with_relative_probes.add(relpath)

    return violations, counts, scanned, files_with_relative_probes, untokenisable


# One walk, reused by every test below.
(VIOLATIONS, RELATIVE_COUNTS, SCANNED,
 RELATIVE_FILES, UNTOKENISABLE) = _scan_tree()


# -- The ratchet --------------------------------------------------------------


def test_every_runtime_file_could_actually_be_read():
    """A file the scanner cannot parse is a file it cannot vouch for."""
    assert not UNTOKENISABLE, (
        "These files could not be tokenised, so the ratchet is blind to "
        "them:\n  " + "\n  ".join(UNTOKENISABLE)
    )


def test_no_new_hardcoded_schema_in_probes():
    """No probe may name `staging` or `public`, beyond the frozen baseline."""
    observed = Counter((v.relpath, v.rule) for v in VIOLATIONS)

    offenders = []
    for key, count in sorted(observed.items()):
        allowed = KNOWN_OUTSTANDING.get(key, 0)
        if count > allowed:
            relpath, rule = key
            lines = [str(v) for v in VIOLATIONS if (v.relpath, v.rule) == key]
            offenders.append(
                "  {} [{}]: {} hit(s), baseline allows {}\n".format(
                    relpath, rule, count, allowed)
                + "\n".join("      " + line for line in lines)
            )

    assert not offenders, (
        "A schema probe names a schema instead of resolving through "
        "search_path.\n\n"
        + "\n".join(offenders)
        + "\n\nWhy this fails the build: once `staging` no longer exists, this "
          "probe returns NULL rather than raising, and the caller takes its "
          "'table absent' branch silently. In auth_router.py that branch skips "
          "2FA and still issues a session JWT; in middleware/module_levels.py "
          "it lets any org admin release payroll.\n\n"
          "The fix is to drop the schema, not to change it:\n"
          "    to_regclass('staging.user_totp')  ->  to_regclass('user_totp')\n"
          "    table_schema = 'staging'          ->  "
          "table_schema = ANY(current_schemas(false))\n\n"
          "Do NOT add an entry to KNOWN_OUTSTANDING to get to green."
    )


def test_the_baseline_has_not_silently_been_fixed():
    """A baseline entry that no longer matches must be deleted, not left to rot.

    Split from the ratchet above on purpose: fixing runtime code should never
    make the *violation* test red. This one goes red instead, and clearing it is
    a one-line deletion.
    """
    observed = Counter((v.relpath, v.rule) for v in VIOLATIONS)

    stale = []
    for (relpath, rule), allowed in sorted(KNOWN_OUTSTANDING.items()):
        actual = observed.get((relpath, rule), 0)
        if actual < allowed:
            stale.append(
                "  {} [{}]: baseline says {}, found {}".format(
                    relpath, rule, allowed, actual))

    assert not stale, (
        "Good news, then a chore: these were fixed, so the baseline now grants "
        "amnesty nobody is using.\n\n"
        + "\n".join(stale)
        + "\n\nLower or delete the entry in KNOWN_OUTSTANDING in "
          "backend/tests/test_no_hardcoded_schema_in_probes.py. The ratchet "
          "only ratchets if it tightens."
    )


# -- Anti-vacuity: prove the scan is still looking at something ---------------


def test_the_scan_is_not_vacuous():
    """A broken walk, or a stripper that eats everything, must FAIL not pass.

    Measured 2026-08-29: 338 files scanned, 14 relative `to_regclass` probes and
    19 `current_schemas(false)` filters across 20 files. The floors below sit
    well under those so ordinary deletion does not trip them - but a walk that
    returns nothing, or a stripper that blanks live code, cannot clear them.
    """
    assert len(SCANNED) >= 250, (
        "the file walk visited only {} files - it rotted. Expected ~338 under "
        "{}. Check EXCLUDED_DIRS and that BACKEND_ROOT still points at the "
        "backend package.".format(len(SCANNED), BACKEND_ROOT)
    )

    assert "auth_router.py" in SCANNED, (
        "auth_router.py was not scanned. It holds the 2FA probe this entire "
        "file exists to protect; if the walk misses it, nothing here is worth "
        "anything."
    )
    assert "middleware/module_levels.py" in SCANNED, (
        "middleware/module_levels.py was not scanned - that is the payroll and "
        "invoice release gate."
    )

    relative_total = sum(RELATIVE_COUNTS.values())
    assert relative_total >= 25, (
        "the scan matched only {} search_path-relative probes - it rotted. "
        "Expected ~33. Either the stripper is now blanking executable code, or "
        "the codemod has been reverted; both are emergencies and neither "
        "should show up as a green test.".format(relative_total)
    )
    assert RELATIVE_COUNTS["to_regclass_relative"] >= 8, (
        "only {} relative to_regclass probes remain - it rotted "
        "(expected ~14).".format(RELATIVE_COUNTS["to_regclass_relative"])
    )
    assert RELATIVE_COUNTS["current_schemas"] >= 12, (
        "only {} current_schemas(false) filters remain - it rotted "
        "(expected ~19).".format(RELATIVE_COUNTS["current_schemas"])
    )
    assert len(RELATIVE_FILES) >= 12, (
        "relative probes were found in only {} files - it rotted "
        "(expected ~20).".format(len(RELATIVE_FILES))
    )


#: Files whose PROSE describes a staging-qualified probe, and how many such
#: lines each carries. Deliberately NOT pinned to line numbers: the first
#: version of this test was, and a one-line insertion elsewhere in
#: `support_session.py` shifted 77 -> 78 and turned the whole ratchet red for a
#: reason that had nothing to do with what it guards. A count per file keeps the
#: anti-vacuity property — the prose must still exist, and in the same volume —
#: without breaking every time an unrelated line lands above it.
DOCUMENTED_PROBE_SITES = [
    ("routers/messaging.py", 1),
    ("routers/org_modules.py", 1),
    ("routers/org_security.py", 1),
    ("routers/org_switch.py", 1),
    ("services/support_session.py", 2),
]


def test_the_stripper_removes_prose_but_leaves_code():
    """The six docstrings that *describe* these probes must not be flagged.

    This is the test that keeps the ratchet credible. Six places in the tree
    write to_regclass of a staging-qualified name inside prose, explaining why
    the probe behaves as it does - exactly the knowledge that stops someone
    reintroducing the bug. A raw-text scan flags all six; this scan must flag
    none, while still catching real code.
    """
    raw_hits, stripped_hits = [], []
    pattern = FORBIDDEN_PATTERNS["to_regclass_literal"]

    expected_total = sum(n for _, n in DOCUMENTED_PROBE_SITES)

    for relpath, expected_count in DOCUMENTED_PROBE_SITES:
        path = BACKEND_ROOT / relpath
        assert path.exists(), (
            "{} has moved; update DOCUMENTED_PROBE_SITES".format(relpath))
        raw = path.read_bytes()
        original = raw.decode("utf-8", "replace").splitlines()
        code = _strip_comments_and_docstrings(raw)

        found = [n for n, line in enumerate(original, 1) if pattern.search(line)]
        assert len(found) == expected_count, (
            "{} carries {} prose probe line(s), expected {}. If the prose was "
            "deliberately removed, lower the count; do not delete the entry, "
            "because an empty list makes this test prove nothing."
            .format(relpath, len(found), expected_count)
        )
        raw_hits.extend("{}:{}".format(relpath, n) for n in found)

        for n in found:
            if n <= len(code) and pattern.search(code[n - 1]):
                stripped_hits.append("{}:{}: {}".format(
                    relpath, n, original[n - 1].strip()))

    # Anti-vacuity for the stripper itself: if the prose is gone, this test is
    # no longer proving anything and must be re-pointed rather than left green.
    assert len(raw_hits) == expected_total, (
        "only {} of {} documented probe sites still contain the pattern in raw "
        "text: {}. This test now proves nothing about the comment stripper - "
        "re-point DOCUMENTED_PROBE_SITES at prose that still exists.".format(
            len(raw_hits), expected_total, raw_hits)
    )
    assert not stripped_hits, (
        "The comment/docstring stripper is flagging prose, not code:\n  "
        + "\n  ".join(stripped_hits)
        + "\n\nThese are documentation of the probes, not probes. A ratchet "
          "that fails on its own explanatory comments gets deleted."
    )


PLANTED = b'''"""Module docstring: to_regclass('public.user_totp') is NULL here."""


async def probe_in_parens(pool):
    # A comment mentioning to_regclass('public.user_totp') must be ignored.
    return await pool.fetchval(
        "SELECT to_regclass('public.user_totp')"
    )


async def relative_probe(pool):
    """Docstring naming to_regclass('public.user_totp') is only prose."""
    return await pool.fetchval("SELECT to_regclass('user_totp')")
'''


def test_the_matcher_catches_a_planted_violation():
    """Positive control. The machinery must fail on a real violation.

    Every assertion elsewhere in this file is a claim that something is absent.
    Absence is exactly what a broken scanner reports, so one test has to prove
    the scanner still bites - and specifically that it bites through the
    `tokenize` trap: the offending SQL below sits on its own line inside
    parentheses, preceded by an NL token. Treat NL as a docstring predecessor
    and this planted violation goes undetected, along with every real one.
    """
    violations, counts = _scan_source(PLANTED, "planted.py")
    lines_hit = sorted(v.lineno for v in violations)

    assert lines_hit == [7], (
        "expected exactly one violation, on line 7 - the multi-line SQL "
        "argument - but got lines {}. An empty result means the "
        "NL-inside-parentheses trap has been reintroduced: bracketed SQL is "
        "being misread as a docstring and blanked, so this scanner sees "
        "nothing anywhere. Extra lines mean prose is being matched as "
        "code.".format(lines_hit)
    )

    only = violations[0]
    assert only.rule == "to_regclass_literal"
    assert "public.user_totp" in only.line
    assert "planted.py:7" in str(only), (
        "the failure message must name file:line so the next person can act "
        "without re-deriving anything; got {}".format(only)
    )

    # And the legitimate relative probe on the last line must still be counted,
    # or the anti-vacuity floors are measuring nothing.
    assert counts["to_regclass_relative"] == 1, (
        "the relative-probe counter saw {} probes in the planted module, "
        "expected 1".format(counts["to_regclass_relative"])
    )
