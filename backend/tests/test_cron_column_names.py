"""The two cron jobs that had never run, and the reason neither ever could.

On 2026-08-06 every endpoint in `routers/scheduler.py` was called for the first
time. Nine worked. Two answered 500, both for the same reason and neither
catchable by any test that existed:

    /cron/hr      column "is_active" does not exist   (staging.manav_holidays)
    /cron/agents  column t.due_date does not exist    (public.tasks) — and
                  Postgres' own HINT said "Perhaps you meant t.due_at"

A unit test with a fake pool cannot catch this. The fake accepts any SQL, so the
query passes locally and fails only against a real database — which, for a job
nothing ever called, meant never. Both bugs sat in the tree from the day they
were written.

So this file does not mock a pool. It reads the SQL out of the modules and
checks every column it references against the column list the DATABASE actually
has, recorded below. That turns "the schema drifted" from a runtime 500 into a
red test.

COLUMN SETS MEASURED AGAINST THE LIVE DATABASE 2026-08-06 via
information_schema.columns. If a migration changes one of these tables, update
the set here in the same commit — a stale set is the only way this file can lie.
"""
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

# ── measured 2026-08-06, information_schema.columns ──────────────────────────
PUBLIC_TASKS = {
    "task_id", "title", "status", "team_id", "due_at", "assignee_user_ids",
    "requires_approval", "approval_status", "user_id", "created_by_user_id",
}
STAGING_MANAV_HOLIDAYS = {"id", "org_id", "name", "date", "is_optional", "created_at"}
STAGING_MANAV_EMPLOYEES = {"id", "org_id", "status", "is_active"}

# The two columns that produced the 500s. Named individually rather than
# inferred, so this file states what it is defending against.
COLUMNS_THAT_DO_NOT_EXIST = {
    ("public.tasks", "due_date"),
    ("staging.manav_holidays", "is_active"),
}


def _source(rel: str) -> str:
    return (BACKEND / rel).read_text(encoding="utf-8")


def _sql_block_list(src: str) -> list:
    """Each triple-quoted SQL block, kept SEPARATE.

    Separate matters. attendance_auto_mark.py holds the holidays query and the
    employees query a few lines apart, and manav_EMPLOYEES legitimately has
    is_active. Join them and the holiday statement inherits the employee
    statement's tokens, which accuses the fixed code of the bug it just fixed —
    the first version of this file did exactly that.
    """
    return [
        b for b in re.findall(r'"""(.*?)"""', src, re.S)
        if re.search(r"\bSELECT\b", b, re.I)
    ]


def _sql_blocks(src: str) -> str:
    """All SQL in one string. Only for checks that are not table-scoped."""
    return "\n".join(_sql_block_list(src))


# ═══════════════════════════════════════════════════════════════════════════
# /cron/agents — services/agents/deadline_agent.py
# ═══════════════════════════════════════════════════════════════════════════

def test_deadline_agent_reads_due_at_because_due_date_does_not_exist():
    """The exact failure: `column t.due_date does not exist`, all three orgs."""
    src = _source("services/agents/deadline_agent.py")
    sql = _sql_blocks(src)

    assert "due_at" in sql, "deadline_agent no longer selects due_at at all"

    # Not a substring check on the whole file — the header comment mentions
    # due_date deliberately, to explain the bug. Only the SQL must be clean.
    referenced = set(re.findall(r"\bt\.([a-z_]+)", sql))
    unknown = referenced - PUBLIC_TASKS
    assert not unknown, (
        f"deadline_agent references columns public.tasks does not have: "
        f"{sorted(unknown)}. public.tasks has {sorted(PUBLIC_TASKS)}."
    )

    # And the Python that reads the row must use the same key, or the query is
    # fixed while the handler still raises KeyError one line later.
    assert 'task["due_at"]' in src, "query uses due_at but the row is read by another key"
    assert 'task["due_date"]' not in src


# ═══════════════════════════════════════════════════════════════════════════
# /cron/hr — services/skills/action/attendance_auto_mark.py
# ═══════════════════════════════════════════════════════════════════════════

def test_holiday_lookup_does_not_reference_is_active():
    """The exact failure: `column "is_active" does not exist`, all three orgs.

    manav_EMPLOYEES has is_active; manav_HOLIDAYS does not. The query that broke
    was the holiday one, and the employee query below it — which uses the same
    column name legitimately — is why the mistake reads as plausible.
    """
    src = _source("services/skills/action/attendance_auto_mark.py")

    holiday_sql = re.search(
        r"SELECT id, name FROM staging\.manav_holidays.*?\"\"\"", src, re.S
    )
    assert holiday_sql, "the holiday lookup has moved; update this test with it"
    body = holiday_sql.group(0)

    assert "is_active" not in body, (
        "staging.manav_holidays has no is_active column — it has "
        f"{sorted(STAGING_MANAV_HOLIDAYS)}. This is the exact query that made "
        "POST /api/internal/cron/hr answer 500 for every organisation."
    )


def test_optional_holidays_are_not_auto_marked():
    """An optional holiday is one people MAY work, so it cannot be asserted.

    This module's own docstring refuses to write an 'absent' row because the
    system cannot know somebody did not work. Marking every employee 'holiday'
    on an optional holiday is the same unknowable claim, so the replacement for
    the broken predicate is is_optional rather than nothing at all.
    """
    src = _source("services/skills/action/attendance_auto_mark.py")
    holiday_sql = re.search(
        r"SELECT id, name FROM staging\.manav_holidays.*?\"\"\"", src, re.S
    ).group(0)

    assert "is_optional" in holiday_sql, (
        "dropping is_active without adding is_optional would auto-mark optional "
        "holidays, asserting that nobody worked on a day people may choose to"
    )
    assert "COALESCE" in holiday_sql.upper(), (
        "is_optional is nullable; NULL means nobody said, which is not 'optional'"
    )


def test_employee_lookup_may_still_use_is_active():
    """Guard against over-correcting: manav_employees DOES have is_active.

    Without this, the obvious 'fix' for the 500 is to delete every is_active in
    the file, which would silently include resigned employees in the auto-mark.
    """
    src = _source("services/skills/action/attendance_auto_mark.py")
    emp_sql = re.search(
        r"SELECT id FROM staging\.manav_employees.*?\"\"\"", src, re.S
    )
    assert emp_sql, "the employee lookup has moved; update this test with it"
    assert "is_active" in emp_sql.group(0), (
        "manav_employees.is_active exists and filtering on it is correct — "
        "removing it would auto-mark attendance for resigned staff"
    )


# ═══════════════════════════════════════════════════════════════════════════
# The general guard
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("table,column", sorted(COLUMNS_THAT_DO_NOT_EXIST))
def test_no_cron_path_references_a_column_that_does_not_exist(table, column):
    """Both dead column names, swept across every file the cron endpoints reach.

    Scoped to the cron paths rather than the whole tree: `due_date` and
    `is_active` are legitimate column names on other tables, and a repo-wide ban
    would be a false accusation the first time someone queried one of those.
    """
    paths = [
        "routers/scheduler.py",
        "services/agents/deadline_agent.py",
        "services/skills/action/attendance_auto_mark.py",
    ]
    table_name = table.split(".")[-1]

    for rel in paths:
        for stmt in _sql_block_list(_source(rel)):
            if table_name not in stmt:
                continue
            assert not re.search(rf"\b{column}\b", stmt), (
                f"{rel} references {table}.{column}, which does not exist. "
                f"This is the bug that made a cron endpoint answer 500 on "
                f"2026-08-06 the first time anything ever called it."
            )
