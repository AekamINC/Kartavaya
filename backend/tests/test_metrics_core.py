"""Core PM metric guards — the file-specific assertions the generic registry
walk cannot make.

test_analytics_registry.py proves every metric's SHAPE (schema-qualified,
$1::uuid, placeholder parity, window binding, bucket honesty). This file pins
the SEMANTIC guards core.py's docstring promises, so that a refactor which
keeps the shape but drops a guard fails here by name:

· the org hop joins **teams.team_id (text)** — `tm.id` (uuid) matches nothing
  and once raised `text = uuid`;
· medians are percentile_cont(0.5), never AVG — the mean of a skewed
  turnaround distribution flatters it;
· workload labels are NAMES resolved in SQL, with 'Unassigned' for the
  unresolvable — a raw uid never reaches an output column;
· archived_at: stocks exclude archived tasks, flows include them;
· the four declared-absent metrics stay declared — deleting an absence is a
  product claim, not a cleanup.
"""
import re
from datetime import date

import pytest

from analytics.registry import REGISTRY, MetricRequest, load_all
from services.analytics_window import Window

load_all()

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

#: Every runnable core metric, split by the table it scans.
TASK_METRICS = [
    "core.tasks_by_status",
    "core.throughput",
    "core.overdue",
    "core.lead_time",
    "core.workload",
]
APPROVAL_METRICS = ["core.approval_turnaround"]
STOCKS = ["core.tasks_by_status", "core.overdue", "core.workload"]
FLOWS = ["core.throughput", "core.lead_time", "core.approval_turnaround"]
MEDIANS = ["core.lead_time", "core.approval_turnaround"]


def build(key, bucket="month", group_by=None):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    return m.sql(MetricRequest(org_id=ORG, window=win, bucket=bucket,
                               group_by=group_by))


def test_all_core_metrics_are_registered():
    for key in TASK_METRICS + APPROVAL_METRICS:
        assert key in REGISTRY, f"{key} missing from the registry"
        assert REGISTRY[key].module == "core"


# ── The org hop: teams.team_id (text), NEVER teams.id (uuid) ────────────────

@pytest.mark.parametrize("key", TASK_METRICS)
def test_task_metrics_join_teams_on_the_text_key(key):
    sql, _ = build(key)
    assert "tm.team_id = t.team_id" in sql, f"{key}: wrong or missing team join\n{sql}"
    assert "tm.id" not in sql, f"{key}: joined teams.id (uuid) — matches nothing\n{sql}"
    assert "tm.org_id = $1::uuid" in sql, f"{key}: org scope missing or uncast\n{sql}"


@pytest.mark.parametrize("key", APPROVAL_METRICS)
def test_approval_metrics_join_teams_on_the_text_key(key):
    sql, _ = build(key)
    assert "tm.team_id = a.team_id" in sql, f"{key}: wrong or missing team join\n{sql}"
    assert "tm.id" not in sql, f"{key}: joined teams.id (uuid) — matches nothing\n{sql}"
    assert "tm.org_id = $1::uuid" in sql, f"{key}: org scope missing or uncast\n{sql}"
    assert "public.approvals" in sql, (
        f"{key}: must read public.approvals, not staging.approval_requests (0 rows, dead)"
    )


# ── Medians: percentile_cont, never AVG ─────────────────────────────────────

@pytest.mark.parametrize("key", MEDIANS)
def test_medians_use_percentile_cont_never_avg(key):
    sql, _ = build(key)
    assert "percentile_cont(0.5)" in sql, f"{key}: median vanished\n{sql}"
    assert "WITHIN GROUP" in sql
    assert not re.search(r"\bAVG\s*\(", sql, re.IGNORECASE), (
        f"{key}: AVG over a skewed duration distribution is not the median\n{sql}"
    )
    # Days as a float, not a Postgres interval the JSON renderer would mangle.
    assert "EXTRACT(EPOCH FROM" in sql and "86400" in sql, (
        f"{key}: duration not converted to fractional days\n{sql}"
    )


def test_lead_time_is_labelled_lead_time_not_cycle_time():
    """No status-transition history exists, so created→done is LEAD time and
    must say so — claiming cycle time would be a lie the catalogue repeats."""
    m = REGISTRY["core.lead_time"]
    sql, _ = build("core.lead_time")
    assert "t.completed_at - t.created_at" in sql
    assert "t.completed_at::date BETWEEN $2::date AND $3::date" in sql
    assert "lead time" in m.description.lower()
    assert "cycle time" in m.description.lower(), (
        "the description must state why this is not cycle time"
    )


def test_approval_turnaround_measures_decided_in_window():
    sql, params = build("core.approval_turnaround")
    assert "a.reviewed_at - a.created_at" in sql
    assert "a.reviewed_at IS NOT NULL" in sql, "undecided approvals must not enter the median"
    assert "a.reviewed_at::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


# ── Workload: names, not ids ────────────────────────────────────────────────

def test_workload_labels_are_names_never_ids():
    sql, _ = build("core.workload")
    # Resolution happens in SQL, with the house display chain and an honest
    # label for the unresolvable.
    assert "COALESCE(u.full_name, u.name, u.email, 'Unassigned')" in sql, sql
    assert "LEFT JOIN public.users u ON u.user_id = a.uid" in sql, sql
    assert "unnest(t.assignee_user_ids)" in sql, sql
    # The SELECT list carries no raw id — label and count only.
    select_list = sql.split(" FROM ", 1)[0]
    assert "uid" not in select_list, f"raw uid in output columns\n{select_list}"
    assert "user_id" not in select_list, f"raw user_id in output columns\n{select_list}"


def test_workload_keeps_unassigned_tasks():
    """A bare CROSS JOIN unnest drops tasks whose assignee array is empty —
    the LATERAL join must be LEFT so they surface as 'Unassigned'."""
    sql, _ = build("core.workload")
    assert "LEFT JOIN LATERAL unnest" in sql, sql


def test_workload_description_states_co_assignee_counting():
    m = REGISTRY["core.workload"]
    assert "once per assignee" in m.description, (
        "the description must state that co-assigned tasks count once per "
        "assignee (the column sums past the task total)"
    )


# ── archived_at: stocks exclude, flows include ──────────────────────────────

@pytest.mark.parametrize("key", STOCKS)
def test_stock_metrics_exclude_archived_tasks(key):
    sql, params = build(key)
    assert "t.archived_at IS NULL" in sql, (
        f"{key}: an archived task is not on anybody's plate\n{sql}"
    )
    assert len(params) == 1, f"{key}: a stock binds only the org"


@pytest.mark.parametrize("key", FLOWS)
def test_flow_metrics_do_not_filter_archived(key):
    """Work that was finished and later archived still happened. (Approvals
    carry no archived_at at all — the assertion holds there trivially.)"""
    sql, params = build(key)
    assert "archived_at" not in sql, (
        f"{key}: a flow must count archived work — it happened\n{sql}"
    )
    assert params[1:] == [WIN.start, WIN.end], f"{key}: window not bound as $2/$3"


# ── Overdue: the definition, pinned ─────────────────────────────────────────

def test_overdue_definition():
    sql, params = build("core.overdue")
    assert "t.status <> 'done'" in sql
    assert "t.due_at < now()" in sql
    assert "t.archived_at IS NULL" in sql
    # The age split is FILTERed off the same scan, strictly narrower than the
    # headline: value >= overdue_7 >= overdue_30.
    assert "FILTER (WHERE t.due_at < now() - interval '7 days')" in sql
    assert "FILTER (WHERE t.due_at < now() - interval '30 days')" in sql
    assert "overdue_7" in sql and "overdue_30" in sql
    assert params == [ORG]
    assert REGISTRY["core.overdue"].grain == "stock"


def test_overdue_never_binds_a_window():
    """A stock ignores the window by contract — overdue-as-at-March is a
    question this schema cannot answer (no due_at history)."""
    sql, _ = build("core.overdue")
    assert "$2" not in sql and "$3" not in sql


# ── The declared absences stay declared ─────────────────────────────────────

def test_the_four_absent_metrics_are_still_declared():
    for key in ("core.billable_split", "core.utilisation",
                "core.project_margin", "core.burndown"):
        m = REGISTRY.get(key)
        assert m is not None, f"{key}: absence declaration deleted"
        assert m.absent and m.sql is None, f"{key}: absence turned runnable without a schema change"
