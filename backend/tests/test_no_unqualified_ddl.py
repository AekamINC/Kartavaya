"""Application code may not issue DDL without naming a schema.

WHY THIS EXISTS
---------------
`db.py` sets `search_path TO staging, public`, so an UNQUALIFIED `CREATE TABLE`
lands in `staging` — the first schema on the path — while nearly all of this
product's core tables live in `public`. The result is a shadow: two tables with
one name, the empty one winning every lookup that the search_path reaches.

That is not a hypothetical. Measured against the live database on 2026-08-16,
THIRTEEN names existed in both schemas, exactly matching the thirteen
unqualified `CREATE TABLE IF NOT EXISTS` statements in
`server.py:_run_startup_migrations()`. `public.notification_prefs` held the one
user who had configured quiet hours; the staging copy held nothing and answered
first. `public.task_reminders` held 346 rows while its reader saw an empty
table — the most likely mechanical cause of "331 of 331 reminders suppressed,
none ever reached a human".

And `staging.notifications` held exactly ONE row out of 3,644: a reminder from
2026-07-24, never read, addressed to a user who still exists. One write landed
in the shadow and 3,643 did not, which is the tell — `db.py:113` runs its SET
inside a `try` that logs a warning and carries on, and PgBouncer transaction
pooling does not guarantee the setting reaches the next statement anyway. The
schema a bare name resolves to is therefore NOT DETERMINISTIC. Migration 142
dropped the thirteen shadows so the fall-through always finds `public`; this
test is what stops the next one being created.

WHY A RATCHET AND NOT A CODE REVIEW NOTE
----------------------------------------
The failure is silent and it does not look like the change that caused it.
Someone adds an unqualified `CREATE TABLE` to a startup path; nothing breaks;
weeks later a query returns an empty list and the investigation starts in the
query. Nothing about that trail leads back to the DDL. So the rule is enforced
where it is cheap — at the point the DDL is written.

`ast`, not grep. A grep for "CREATE TABLE" flags this file's own docstring,
which is how a checker gets deleted by the first person it annoys.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent

#: DDL that binds a name to a schema. `DROP` is deliberately absent — dropping
#: an unqualified name is not how a shadow is CREATED, and migration 142 shows
#: the legitimate reasons to write one.
_DDL = re.compile(
    r"\b(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?"
    r"|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?"
    r"|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON)"
    r"\s+([A-Za-z_][\w.]*)",
    re.IGNORECASE,
)

#: Directories whose job IS to create schema. Migrations name their schema in
#: SQL files that a human applies deliberately; `scripts/` builds a throwaway
#: local database where there is only one schema and the distinction is
#: meaningless.
_EXEMPT_DIRS = {"migrations", "scripts", "tests", ".venv", "__pycache__"}


def _sql_strings(path: Path) -> list[tuple[int, str]]:
    """Every string LITERAL in a module, with its line number.

    Docstrings are excluded: this file, and `emit.py`, and migration 142's
    header all discuss `CREATE TABLE` in prose, and a checker that cannot tell
    prose from code is a checker that gets switched off.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except SyntaxError:
        return []

    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef,
                             ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                docstrings.add(id(body[0].value))

    out = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and id(node) not in docstrings):
            out.append((node.lineno, node.value))
    return out


def _offences(path: Path) -> list[str]:
    bad = []
    for lineno, text in _sql_strings(path):
        for m in _DDL.finditer(text):
            target = m.group(2)
            if "." in target:
                continue                      # schema named — fine
            if target.lower().startswith(("temp_", "tmp_", "pg_")):
                continue                      # session-local; no schema to pick
            try:
                where = path.relative_to(BACKEND)
            except ValueError:
                where = path          # a tmp_path module from the tests above
            bad.append(f"{where}:{lineno} — {m.group(1).strip()} {target}")
    return bad


def _app_modules() -> list[Path]:
    return [p for p in BACKEND.rglob("*.py")
            if not (_EXEMPT_DIRS & set(p.relative_to(BACKEND).parts))]


# ── the detector is tested before the tree is ────────────────────────────────
#
# A ratchet nobody has seen fail is a ratchet nobody knows is wired up.

def test_detector_flags_an_unqualified_create():
    src = 'X = "CREATE TABLE IF NOT EXISTS widgets (id TEXT)"'
    tree = ast.parse(src)
    literal = next(n for n in ast.walk(tree)
                   if isinstance(n, ast.Constant) and isinstance(n.value, str))
    assert _DDL.search(literal.value)
    assert "." not in _DDL.search(literal.value).group(2)


def test_detector_accepts_a_qualified_create():
    m = _DDL.search("CREATE TABLE IF NOT EXISTS public.widgets (id TEXT)")
    assert m and "." in m.group(2)


def test_detector_catches_alter_and_index_too():
    """All three bind a name to a schema, and all three were present in the
    startup block that produced the thirteen shadows."""
    assert _DDL.search("ALTER TABLE teams ADD COLUMN x TEXT").group(2) == "teams"
    assert _DDL.search(
        "CREATE INDEX IF NOT EXISTS idx_n ON notifications(user_id)"
    ).group(2) == "notifications"


def test_detector_is_not_fooled_by_prose(tmp_path):
    """A docstring that DISCUSSES the rule is not a violation of it.

    This module's own docstring says "CREATE TABLE" several times, as does
    migration 142's header and `emit.py`'s. A checker that cannot tell prose
    from code flags the very files that explain it, which is exactly how a
    checker gets deleted rather than fixed.

    Written against a synthetic module rather than this file, because this file
    legitimately contains unqualified DDL — in the detector fixtures above.
    Asserting the whole file is clean would be asserting the fixtures away.
    """
    mod = tmp_path / "prose.py"
    mod.write_text(
        '"""Never write CREATE TABLE widgets without a schema.\n\n'
        'ALTER TABLE teams is likewise forbidden here.\n"""\n'
        'def f():\n'
        '    """CREATE INDEX IF NOT EXISTS idx_x ON notifications(id) is prose too."""\n'
        '    return 1\n',
        encoding="utf-8",
    )
    assert _offences(mod) == []


def test_detector_still_catches_code_in_a_file_full_of_prose(tmp_path):
    """The other half of the same coin — prose must not become a hiding place."""
    mod = tmp_path / "mixed.py"
    mod.write_text(
        '"""Explains why CREATE TABLE must name a schema."""\n'
        'SQL = "CREATE TABLE IF NOT EXISTS widgets (id TEXT)"\n',
        encoding="utf-8",
    )
    assert len(_offences(mod)) == 1


# ── and then the real tree ───────────────────────────────────────────────────

def test_no_application_module_creates_an_unqualified_table():
    offences = sorted(o for p in _app_modules() for o in _offences(p))
    assert not offences, (
        "Unqualified DDL binds a table to whichever schema the search_path "
        "happens to resolve to, and under PgBouncer that is not deterministic. "
        "Name the schema explicitly — `public.` for core product tables, "
        "`staging.` for module tables. See migration 142.\n  " +
        "\n  ".join(offences)
    )


@pytest.mark.parametrize("name", [
    "activity_events", "approvals", "field_definitions", "field_values",
    "notification_prefs", "notifications", "org_settings", "project_assignments",
    "push_tokens", "push_web_subscriptions", "report_schedules",
    "task_reminders", "time_entries",
])
def test_the_thirteen_known_shadows_are_never_recreated_bare(name):
    """Named one by one so a failure says WHICH table came back.

    These thirteen are not a general worry — they are the exact set migration
    142 had to drop, and every one of them had a `public` twin holding the real
    data. A new unqualified CREATE of any of these names does not create a
    table; it hides one.
    """
    hits = [o for p in _app_modules() for o in _offences(p)
            if o.endswith(f" {name}")]
    assert not hits, f"{name} is being created unqualified again:\n  " + "\n  ".join(hits)
