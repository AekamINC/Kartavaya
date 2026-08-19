"""A report must answer the question its own heading asks.

── What went wrong ───────────────────────────────────────────────────────────

`/reports` printed a document headed "12 Aug — 19 Aug" in which three of the
five sections ignored those dates entirely:

  * the four headline counts ran `FROM tasks WHERE team_id=$1` with no date
    predicate, so "179 done" was the project's lifetime total;
  * the throughput chart bucketed on `updated_at`, so retitling a task finished
    in March redrew it as work done today;
  * the detailed task list had no date filter either.

And the per-member table counted TIME-ENTRY ROWS per person while labelling the
result `tasks_done` — so somebody who logged their week in ten short entries
outranked somebody who logged one session and closed three tasks. The PDF then
crowned the top of that list "CHAMPION OF THE PERIOD" and wrote that they "led
the team with N tasks completed", by name, in a document a schedule can mail.

Every one of those is a false statement rather than a rough one, which is why
this is a test and not a backlog item.

── What is asserted ──────────────────────────────────────────────────────────

These are static assertions over the source. There is no database in the unit
suite, and the defect was never in the Python — it was in the SQL text and in
the sentence the PDF wrote. Reading the source is therefore the honest check,
and it is the same shape as `frontend/scripts/check-rendered-ids.mjs`.
"""
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPORTS = BACKEND / "routers" / "reports.py"
GENERATOR = BACKEND / "services" / "report_generator.py"


def _src(path: Path) -> str:
    # These two files carry a UTF-8 BOM in the repository.
    return path.read_text(encoding="utf-8-sig")


def _fetch_report_data_body() -> str:
    src = _src(REPORTS)
    start = src.index("async def _fetch_report_data")
    end = src.index("\n@router.get", start)
    return src[start:end]


# ── 1. Work done is counted on the completion timestamp ──────────────────────

def test_throughput_buckets_on_completion_not_last_edit():
    body = _fetch_report_data_body()
    chart = body[body.index("Daily throughput"):body.index("Per-member work")]
    assert "completed_at" in chart, "the throughput chart must bucket on completed_at"
    assert "updated_at AT TIME ZONE" not in chart, (
        "the throughput chart is bucketing on updated_at again — a task somebody "
        "merely edited will be drawn as a task closed that day"
    )


def test_the_done_count_is_scoped_to_the_period():
    body = _fetch_report_data_body()
    counts = body[body.index("counts = await pool.fetchrow"):body.index("todo         =")]
    done_filter = counts[counts.index("AS todo") : counts.index("AS done")]
    assert "completed_at >=" in done_filter and "completed_at <=" in done_filter, (
        "the 'done' headline count has no period predicate, so a weekly report "
        "will print the project's lifetime completions under a week's heading"
    )


def test_the_task_list_is_scoped_to_the_period():
    body = _fetch_report_data_body()
    task_list = body[body.index("task_list_rows = await pool.fetch"):body.index("Daily throughput")]
    assert "completed_at" in task_list, (
        "the detailed task list has no date predicate; it will list tasks closed "
        "years before the period the report claims to cover"
    )


# ── 2. Per-member counts come from who completed the task ────────────────────

def test_per_member_counts_do_not_come_from_time_entries():
    body = _fetch_report_data_body()
    # Bound the slice at `_serialize`: past that point the return dict legitimately
    # comprehends over `entries` to serialise the time-entry list, which is a
    # different thing entirely from counting them as completed tasks.
    member = body[body.index("Per-member work"):body.index("def _serialize")]
    assert "completed_by_user_id" in member, (
        "per-member task counts must come from completed_by_user_id"
    )
    assert "member_tasks_map" not in member and not re.search(r"for e in entries", member), (
        "per-member 'tasks_done' is being derived from time-entry rows again. "
        "That counts how many separate entries somebody logged, not what they "
        "finished, and it is what the champion callout was ranking on."
    )


# ── 3. No superlative about a named person ───────────────────────────────────

def test_the_pdf_crowns_nobody():
    src = _src(GENERATOR)
    live = "\n".join(
        line for line in src.splitlines()
        if not line.lstrip().startswith("#") and not line.lstrip().startswith("/*")
    )
    for phrase in ("CHAMPION OF THE PERIOD", "led the period", "Led the team"):
        assert phrase not in live, (
            f"the report PDF says {phrase!r} again. A superlative naming an "
            f"individual, in a document a schedule can mail to an address list, "
            f"is a claim the firm cannot take back — and the per-member table "
            f"already carries the facts without asserting who is best."
        )


# ── 4. States are not filed under the period ─────────────────────────────────

def test_state_counts_are_labelled_as_of_now():
    body = _fetch_report_data_body()
    assert '"as_of"' in body and '"state_fields"' in body, (
        "todo / in_progress / overdue are facts about this moment, not about the "
        "period. They must be returned with as_of and state_fields so a renderer "
        "cannot file them under the date range by accident."
    )
    assert '"done_undated"' in body, (
        "completed tasks with no completion date must be reported, not silently "
        "dropped from the period total — otherwise the figure just looks short"
    )


# ── 5. Every table is schema-qualified ───────────────────────────────────────

_TABLES = ("tasks", "teams", "users", "time_entries",
           "project_assignments", "report_schedules")


@pytest.mark.parametrize("table", _TABLES)
def test_tables_are_schema_qualified(table):
    """Hardening, not a live fix — all six resolve to `public` under the current
    search_path. But every other module in this codebase qualifies, and this repo
    has already been bitten once by a shadow table appearing in `staging` beside
    a `public` original (migration 142). An unqualified name means the answer
    depends on a session setting rather than on the query.
    """
    src = _src(REPORTS)
    bare = re.findall(
        rf"(?:FROM|JOIN|INTO|UPDATE|DELETE FROM)\s+{table}\b(?!\s*\()", src
    )
    assert not bare, (
        f"{len(bare)} unqualified reference(s) to {table!r} in routers/reports.py. "
        f"Write public.{table} — which schema an unqualified name resolves to "
        f"depends on search_path, not on the query."
    )
