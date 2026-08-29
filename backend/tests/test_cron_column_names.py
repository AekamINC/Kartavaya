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
# `state_code` re-measured 2026-08-25 (information_schema.columns, live). This set
# was written 2026-08-06 and so PREDATED migration 175, which added the column on
# 2026-08-20 — for five days this file asserted, inside an error message, that a
# column the database had did not exist. That is the exact failure its own header
# warns about: "a stale set is the only way this file can lie."
STAGING_MANAV_HOLIDAYS = {
    "id", "org_id", "name", "date", "is_optional", "created_at", "state_code",
}
# `state` is NOT here, and its absence is the point: it arrives in migration 220,
# which is written but NOT APPLIED. `attendance_auto_mark` therefore probes
# information_schema before selecting it and falls back to the org-wide behaviour
# — the guard that keeps the code deployable ahead of the migration. Add `state`
# to this set in the same commit that applies 220.
STAGING_MANAV_EMPLOYEES = {
    "id", "org_id", "status", "is_active", "user_id", "employee_code", "reporting_to",
}
# BOTH schemas checked. There is no metadata column and no jsonb column at all.
NOTIFICATIONS = {
    "notification_id", "user_id", "team_id", "type", "title", "message",
    "task_id", "url", "created_at", "read_at",
}

# The two columns that produced the 500s. Named individually rather than
# inferred, so this file states what it is defending against.
COLUMNS_THAT_DO_NOT_EXIST = {
    ("public.tasks", "due_date"),
    ("public.manav_holidays", "is_active"),
    ("notifications", "metadata"),
    ("manav_employees", "employee_id"),
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
        r"SELECT id, name.*?FROM public\.manav_holidays.*?\"\"\"", src, re.S
    )
    assert holiday_sql, "the holiday lookup has moved; update this test with it"
    body = holiday_sql.group(0)

    assert "is_active" not in body, (
        "public.manav_holidays has no is_active column — it has "
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
        r"SELECT id, name.*?FROM public\.manav_holidays.*?\"\"\"", src, re.S
    ).group(0)

    assert "is_optional" in holiday_sql, (
        "dropping is_active without adding is_optional would auto-mark optional "
        "holidays, asserting that nobody worked on a day people may choose to"
    )
    assert "COALESCE" in holiday_sql.upper(), (
        "is_optional is nullable; NULL means nobody said, which is not 'optional'"
    )


def test_deadline_agent_keeps_its_dedupe_after_losing_metadata():
    """Dropping metadata must not drop the guard it carried.

    The level lived in metadata->>'level' and stopped a task being warned about
    at 48h, then again at 24h, then again on the next hourly tick. The column
    does not exist, so it had to go — but deleting it outright would make the
    agent re-notify every hour, which is worse than the 500 it replaced because
    it fails in the direction of noise rather than silence.
    """
    src = _source("services/agents/deadline_agent.py")

    assert "deadline_warning_" in src, (
        "the level must survive somewhere; it is now folded into `type`"
    )
    for block in _sql_block_list(src):
        if "notifications" not in block:
            continue
        referenced = set(re.findall(r"\b([a-z_]+)\b", block)) & {
            "metadata", "notification_id", "user_id", "type", "title",
            "message", "task_id", "url", "team_id",
        }
        unknown = referenced - NOTIFICATIONS
        assert not unknown, (
            f"deadline_agent writes columns notifications does not have: "
            f"{sorted(unknown)}"
        )

    # The dedupe query must still be there, and still time-boxed.
    assert "INTERVAL '20 hours'" in src, "the re-notify guard was removed, not moved"


def test_manager_lookup_joins_on_id_not_employee_id():
    """`reporting_to` points at manav_employees.id; employee_id does not exist.

    This is the third bug in this one file, and it was only reachable once the
    first two were fixed — nothing overdue ever got this far. Fixing bugs one
    deploy at a time is how a file like this stays broken for months.
    """
    src = _source("services/agents/deadline_agent.py")
    for block in _sql_block_list(src):
        if "manav_employees" not in block:
            continue
        assert "employee_id" not in block, (
            "manav_employees has id / org_id / user_id / employee_code / "
            "reporting_to — there is no employee_id column"
        )
        assert "me2.id::text = me.reporting_to" in block, (
            "the manager join must resolve reporting_to against id AND cast, "
            "because migration 030 turned reporting_to into TEXT while id stayed "
            "uuid — `me2.id = me.reporting_to` is `operator does not exist: "
            "uuid = text`, which is what /cron/agents answered once the "
            "unqualified-table bug above it was fixed"
        )
        assert "me.reporting_to::uuid" not in block, (
            "cast the uuid to text, not the text to uuid — after 030 this column "
            "accepts any string and ::uuid raises on a malformed one, turning a "
            "bad row into a failed cron run for the whole organisation"
        )


def test_employee_lookup_may_still_use_is_active():
    """Guard against over-correcting: manav_employees DOES have is_active.

    Without this, the obvious 'fix' for the 500 is to delete every is_active in
    the file, which would silently include resigned employees in the auto-mark.

    EVERY employee lookup is checked, not the first one. There are two now — a
    state-aware branch and the fallback that runs until migration 220 lands —
    and a rule that only ever read the first would let the second one ship
    unfiltered, which is the "fixing bugs one deploy at a time" failure this
    file already records twice.
    """
    src = _source("services/skills/action/attendance_auto_mark.py")
    emp_sqls = [
        b for b in _sql_block_list(src)
        if "public.manav_employees" in b and "manav_holidays" not in b
    ]
    assert emp_sqls, "the employee lookup has moved; update this test with it"
    for block in emp_sqls:
        assert "is_active" in block, (
            "manav_employees.is_active exists and filtering on it is correct — "
            "removing it would auto-mark attendance for resigned staff"
        )
        assert "status = 'active'" in block, (
            "a resigned or absconding employee is not on the roster; dropping "
            "the status filter marks attendance for people who have left"
        )


def test_the_state_column_is_probed_before_it_is_selected():
    """`manav_employees.state` arrives in migration 220, which is NOT applied.

    Selecting a column that does not exist raises UndefinedColumnError and
    answers 500 for every organisation — which is precisely how /cron/hr spent
    months broken over `manav_holidays.is_active`, the bug at the top of this
    file. Migrations here are applied by hand against a database production also
    writes to, so "the code deployed and the column is not there yet" is a real
    window rather than a hypothetical one.

    So the module must ask the catalogue first. This pins the guard, not the
    query: delete the probe and this test fails before the cron does.
    """
    src = _source("services/skills/action/attendance_auto_mark.py")

    assert "information_schema.columns" in src, (
        "the state-column probe is gone; selecting manav_employees.state before "
        "migration 220 is applied is a 500 for every organisation"
    )
    assert "column_name = 'state'" in src, "the probe no longer asks about `state`"

    # And the un-scoped fallback must still exist, or the probe guards nothing.
    fallback = [
        b for b in _sql_block_list(src)
        if "public.manav_employees" in b and "state" not in b
    ]
    assert fallback, (
        "the query that does NOT select `state` was removed, so a database "
        "without the column has nothing to fall back to"
    )


# ═══════════════════════════════════════════════════════════════════════════
# The general guard
# ═══════════════════════════════════════════════════════════════════════════

#: Tables that exist in `staging` ONLY. Measured 2026-08-06 across both schemas.
#: An unqualified reference to one of these raises at runtime — see the test.
STAGING_ONLY_TABLES = {
    "manav_employees", "manav_holidays", "manav_attendance",
    "varta_business_accounts", "organisations", "user_roles",
}


def test_cron_paths_qualify_every_staging_only_table():
    """The fourth bug in deadline_agent.py, generalised.

    `db._init_conn` issues `SET search_path TO staging, public`, but staging
    reaches Postgres through PgBouncer on port 6543 in TRANSACTION pooling mode,
    where a session-level SET does not survive the connection going back to the
    pool. So unqualified names resolve to `public`, and it is measurable rather
    than theoretical: public.notifications holds 1,259 rows and
    staging.notifications holds 1, from three weeks earlier.

    `tasks`, `teams` and `notifications` all exist in public and so resolve.
    `manav_employees` exists only in staging, which is why /cron/agents answered
        relation "manav_employees" does not exist
    for all three organisations on the deployed build — AFTER the three column
    fixes, because nothing overdue had ever reached that line before.

    This is the whole class, not the one instance.
    """
    paths = [
        "routers/scheduler.py",
        "services/agents/deadline_agent.py",
        "services/agents/workload_agent.py",
        "services/skills/action/attendance_auto_mark.py",
    ]
    offenders = []
    for rel in paths:
        src = _source(rel)
        for stmt in _sql_block_list(src):
            # Strip qualified uses first, so `staging.manav_employees` cannot
            # match the bare-name pattern below.
            bare = re.sub(r"\b(?:staging|public)\.\w+", " ", stmt)
            for table in STAGING_ONLY_TABLES:
                if re.search(rf"\b(?:FROM|JOIN|INTO|UPDATE)\s+{table}\b", bare, re.I):
                    offenders.append(f"{rel}: unqualified `{table}`")

    assert not offenders, (
        "these tables exist only in the `staging` schema, and the search_path "
        "that would find them does not survive PgBouncer transaction pooling — "
        "so each of these raises `relation does not exist` at runtime:\n  "
        + "\n  ".join(sorted(set(offenders)))
    )


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
