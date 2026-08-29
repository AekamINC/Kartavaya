"""
The audit-actor SQL fragment, checked for the two things that can go wrong with
it silently.

WHY THESE TESTS AND NOT OTHERS
------------------------------
`services/audit_actors` is a string builder, so most of what it does is proved
the moment a router using it returns a row — and the composed queries WERE
probed against the live database before this file existed, which is the only
way to prove SQL is valid (a mock pool hides bad SQL).

What a live probe of one router does NOT catch is the two failures that would
show up months later in a different router:

  1. THE EMAIL RUNG COMING BACK. `routers/graha.py` used to resolve this exact
     column with `COALESCE(u.full_name, u.name, u.email)`, so a user row with no
     name printed that person's EMAIL ADDRESS into a table column — the
     platform-privacy rule inverted, in the one place nobody reads twice. This
     module exists to have one copy of that ladder; a test that the copy has no
     `email` in it is the ratchet that keeps it that way.

  2. A BIND PARAMETER APPEARING IN THE FRAGMENT. Every caller splices these
     strings into a query whose `$n` numbering it is managing by hand. If this
     module ever emitted a `$1`, every caller's numbering would shift by one and
     the failure would be a runtime 500 on a path nobody tested — or worse, a
     value bound into the wrong column. PgBouncer turns the untyped variant of
     that into an instant 500 with no useful message.

Neither is caught by a type checker and neither is visible in review of the
CALLER, which is why they are checks and not comments.
"""

from services.audit_actors import (
    ACTOR_SORT_KEYS,
    CREATOR_ALIAS,
    UPDATER_ALIAS,
    actor_joins,
    actor_select,
)


def test_the_ladder_never_reaches_email():
    """
    The privacy rule, as a check rather than a comment.

    `graha.py` fell back to `u.email` for two years. A name is absent or it is
    not; a missing name is an absence the UI states, never an excuse to disclose
    a different personal detail in its place.
    """
    both = actor_select("t", created=True, updated=True) + actor_joins(
        "t", created=True, updated=True
    )
    assert "email" not in both.lower()


def test_no_bind_parameters_are_emitted():
    """
    Callers number their own `$n`. This module must add none, or every one of
    them shifts.
    """
    both = actor_select("t", created=True, updated=True) + actor_joins(
        "t", created=True, updated=True
    )
    assert "$" not in both


def test_select_is_comma_terminated_and_joins_are_space_terminated():
    """
    The concatenation contract. `actor_select` sits in the middle of a column
    list and `actor_joins` between the FROM and the WHERE — get the terminator
    wrong and you get `…AS has_creatorCOUNT(*)`, which parses as a column alias
    and returns the wrong shape rather than raising.
    """
    sel = actor_select("t", updated=True)
    assert sel.endswith(", ")
    joins = actor_joins("t", updated=True)
    assert joins.endswith(" ")
    assert not joins.endswith("  ")


def test_both_absences_are_reported_separately():
    """
    `ByCell` renders an em dash for "nobody is recorded" and the word `unknown`
    for "there is an id but no user row behind it any more" — a deleted account.
    It can only do that if the query sends the boolean ALONGSIDE the name. A
    NULL name on its own collapses the two.
    """
    sel = actor_select("t", created=True, updated=True)
    assert "AS created_by_name" in sel
    assert "(t.created_by IS NOT NULL) AS has_creator" in sel
    assert "AS updated_by_name" in sel
    assert "(t.updated_by IS NOT NULL) AS has_updater" in sel


def test_flags_select_which_halves_are_emitted():
    """
    A table with `created_by` and no `updated_by` must not get an `updated_by`
    reference — that is a 42703 at runtime, on 200 of the 265 tables.
    """
    only_created = actor_select("t", created=True, updated=False)
    assert "updated_by" not in only_created
    assert "created_by" in only_created

    only_updated = actor_select("t", created=False, updated=True)
    assert "created_by" not in only_updated
    assert "updated_by" in only_updated

    assert actor_select("t", created=False, updated=False) == ""
    assert actor_joins("t", created=False, updated=False) == ""


def test_joins_are_left_and_schema_qualified():
    """
    LEFT, because an INNER join here makes rows VANISH when the person who
    created them is deleted — data loss that looks like a filter working.

    Schema-qualified, because migration 142 exists: a query that trusted
    `search_path` found a shadow table in the other schema and read it for
    weeks.
    """
    joins = actor_joins("t", created=True, updated=True)
    assert joins.count("LEFT JOIN public.users") == 2
    assert "INNER JOIN" not in joins
    assert f"{CREATOR_ALIAS}.user_id = t.created_by" in joins
    assert f"{UPDATER_ALIAS}.user_id = t.updated_by" in joins


def test_the_two_join_aliases_are_distinct():
    """One join per actor column. Reusing one alias is a syntax error at best
    and, if the table were joined once, silently resolves both columns against
    the creator."""
    assert CREATOR_ALIAS != UPDATER_ALIAS


def test_the_alias_is_the_only_thing_a_caller_controls():
    """
    Callers pass a table alias, which is a literal in the router source and
    never request data. Proving the alias is what varies — and that nothing else
    does — is what keeps this module out of the dynamic-identifier rule that
    covers sort keys and column names.
    """
    a = actor_select("aa", updated=True)
    b = actor_select("bb", updated=True)
    assert a.replace("aa.", "X.") == b.replace("bb.", "X.")


def test_sort_keys_are_an_allowlist_of_exactly_the_four_columns():
    """
    Dynamic identifiers come from a server-side allowlist. A router that looks a
    client-supplied sort key up in this dict cannot be handed a fifth value.
    """
    assert set(ACTOR_SORT_KEYS) == {
        "created_at",
        "updated_at",
        "created_by_name",
        "updated_by_name",
    }
    assert all(k == v for k, v in ACTOR_SORT_KEYS.items())


# ═══════════════════════════════════════════════════════════════════════════
# THE RATCHET — no display-name ladder anywhere in the backend reaches .email
# ═══════════════════════════════════════════════════════════════════════════
#
# The tests above prove `services/audit_actors` is clean. That is necessary and
# nowhere near sufficient: the leak this workstream found was not IN a shared
# module, it was fifty-six hand-written copies of one line spread across
# twenty-odd files, each of which looked fine on its own.
#
#     COALESCE(u.full_name, u.name, u.email) AS sender_name
#
# THE OWNER'S RULING (2026-08-23): a display-name ladder must never end at an
# email address. Two standing rules meet there — Aekam must not see client
# emails, and a person is named by their name — and an email as a display
# fallback is a contact detail rendered as a label.
#
# A comment saying so protects nothing, because the next author writing the
# fifty-seventh copy will not have read it; they will copy the fifty-sixth. So
# the rule is a check that walks the tree. This is the piece that would have
# caught the original leak, and it is the piece that was missing.
#
# WHY A SOURCE SCAN AND NOT A UNIT TEST PER SITE: there is no seam. These are
# SQL string literals inside routers, most of them in triple-quoted blocks with
# no function boundary to call. The property is textual, so the check is
# textual — and being textual it also catches the Python twin in
# `server.py:actor_display`, which was the same bug in a different language and
# which no SQL-shaped test would have found.

import re
from pathlib import Path

#: `COALESCE(x.full_name, x.name, x.email)` and its no-space variants, for ONE
#: consistent alias. Anchored on `.email` as the LAST rung specifically: a query
#: that selects `u.email` as its own column is legitimate and common — the
#: mention notifier and the invite mailer both need an address to send to — and
#: a check that fired on those would be turned off within a week.
_EMAIL_LADDER = re.compile(
    r"COALESCE\(\s*(\w+)\.(?:full_name|name)\s*,"
    r"(?:[^()]*?)\1\.email\s*[,)]",
    re.IGNORECASE,
)

_ROOT = Path(__file__).resolve().parent.parent

#: Directories with no rendered output of their own.
_SKIP_DIRS = {"tests", "migrations", "__pycache__", ".venv", "venv", "node_modules"}

#: The ONE file exempt, and only because it is the module that owns the rule.
#: `services/audit_actors` quotes the bad ladder verbatim in its docstring to
#: explain the leak it exists to prevent — and that quotation is not a comment
#: line, so the comment skip below does not reach it. Exempting the file costs
#: nothing: `test_the_ladder_never_reaches_email` above asserts on what that
#: module actually EMITS, which is a stronger check than a text scan of it.
#: Nothing else may be added here — a second name in this set is how a ratchet
#: becomes decorative.
_SKIP_FILES = {"audit_actors.py"}


def _python_sources():
    for path in _ROOT.rglob("*.py"):
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if path.name in _SKIP_FILES:
            continue
        yield path


def _offending_lines(path: Path):
    """Lines where a display ladder reaches `.email`, COMMENTS EXCLUDED.

    Comments are stripped for a reason learnt in this very file: several of the
    fixed sites carry prose that QUOTES the old ladder to explain what the bug
    was and why the rung is gone. A check that fired on those would teach the
    next reader to delete the explanation rather than keep the property — which
    is the opposite of what a ratchet is for. `test_doc_prefixes` already had to
    learn this once.
    """
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        # `#` is a Python comment; `--` is a SQL one, and the SQL comments live
        # INSIDE the triple-quoted query strings this check is scanning. Missing
        # that second form is not hypothetical — the first version of this check
        # fired on `services/skills/data/my_desk.py`, where the `--` prose
        # explaining the removed rungs quotes the old ladder verbatim. The only
        # way to "fix" that would have been to delete the explanation.
        stripped = line.lstrip()
        if stripped.startswith("#") or stripped.startswith("--"):
            continue
        if _EMAIL_LADDER.search(line):
            out.append((n, line.strip()))
    return out


def test_no_sql_display_ladder_falls_back_to_email():
    hits = []
    for path in _python_sources():
        for n, line in _offending_lines(path):
            hits.append(f"{path.relative_to(_ROOT).as_posix()}:{n}  {line[:110]}")
    assert not hits, (
        "a display-name ladder falls back to an email address, which renders a "
        "person's contact detail as their label:\n  "
        + "\n  ".join(hits)
        + "\n\nUse services.audit_actors.display_name(alias), or end the ladder "
          "at a stated label such as 'Unassigned'. Never at .email, and never "
          "blank — a blank cell reads as 'nobody did this'."
    )


def test_the_ratchet_actually_catches_the_shapes_that_shipped():
    """Prove the check FAILS on the real thing, or it proves nothing.

    A regex that matches nothing passes every tree, including a broken one.
    These are the exact strings that were live in this repo on 2026-08-23 —
    every spacing variant that existed, because the first draft of this pattern
    required a space after each comma and sailed past all nine of `server.py`'s
    compact copies.
    """
    shipped = [
        "COALESCE(u.full_name, u.name, u.email) AS actor_name,",
        "COALESCE(cu.full_name,cu.name,cu.email) AS created_by_name",
        '"COALESCE(ow.full_name, ow.name, ow.email) AS owner_name "',
        "COALESCE(u.full_name, u.name, u.email, 'Unassigned') AS owner_name",
        "COALESCE(u.full_name, u.name, u.email, s.approved_by) AS approved_by_name",
        "SELECT COALESCE(u2.full_name, u2.name, u2.email)",
    ]
    for line in shipped:
        assert _EMAIL_LADDER.search(line), f"ratchet does NOT catch: {line}"


def test_the_ratchet_does_not_fire_on_a_legitimate_email_column():
    """The false positives that would get this check deleted.

    Selecting somebody's address AS an address is not the bug — the mention
    notifier and the invite mailer cannot send without one. The bug is an
    address standing in for a NAME.
    """
    fine = [
        "SELECT u.user_id, u.email, COALESCE(u.full_name, u.name) AS full_name",
        "COALESCE(NULLIF(btrim(u.full_name), ''), NULLIF(btrim(u.name), ''), 'Unnamed member')",
        "SELECT ct.email AS contact_email FROM public.graha_contacts ct",
        "WHERE email=$1 AND NOT COALESCE(is_system, FALSE)",
        "COALESCE(NULLIF(btrim(ct.email), ''), '') AS to_email,",
    ]
    for line in fine:
        assert not _EMAIL_LADDER.search(line), f"false positive on: {line}"
