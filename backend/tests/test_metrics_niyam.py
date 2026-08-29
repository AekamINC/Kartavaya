"""The Niyam metrics, held to what their docstring promises.

test_analytics_registry.py walks every declaration for the universal contract
(schema-qualified tables, $1::uuid, placeholder parity, window binding, bucket
honouring, dimension reachability). What lives HERE is the metric-SPECIFIC
guarantees a refactor could drop while every universal check stays green: the
org scope of run steps travelling through the RUN (run_steps has no org_id),
action steps recognised by their recorded detail and never by joining
niyam_rule_steps (history must not follow a rule edit), executed-vs-suppressed
split on the CHECK'd outcome vocabulary, failure rate as counts over counts,
and never-fired as an anti-join over enabled rules labelled by NAME.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
from datetime import date

import analytics.metrics.niyam  # noqa: F401 — registers on import; not yet in load_all()
from analytics.registry import REGISTRY, MetricRequest, load_all
from services.analytics_window import Window

load_all()

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

KEYS = (
    "core.niyam_rules_fired",
    "core.niyam_actions",
    "core.niyam_failure_rate",
    "core.niyam_never_fired",
)


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


def test_the_batch_is_declared_as_specified():
    expect = {
        "core.niyam_rules_fired": ("flow", "count", "operational"),
        "core.niyam_actions": ("flow", "count", "operational"),
        "core.niyam_failure_rate": ("flow", "pct", "operational"),
        "core.niyam_never_fired": ("stock", "days", "operational"),
    }
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["core.niyam_actions"].dimensions == ("outcome",)


def test_the_module_is_core_and_the_namespace_lives_in_the_name():
    """Niyam is not a module code — not in ALL_MODULES, org-role-gated screens,
    ships with every org — so these declare the UNGATED module, "core", and
    the registry's key-prefix-equals-module rule puts the niyam namespace
    inside the name. A metric declared module="niyam" would be gated out of
    every caller's catalogue for ever."""
    for key in KEYS:
        m = REGISTRY[key]
        assert m.module == "core", key
        assert key.startswith("core.niyam_"), key


# ── rules_fired ──────────────────────────────────────────────────────────────

def test_rules_fired_counts_every_evaluation_with_its_splits():
    """Every evaluation writes a run, matched or not (engine.py's header), so
    "fired" is evaluations — with the refused and dry splits riding along
    rather than a narrower "fired" the tables do not record."""
    sql, params = build("core.niyam_rules_fired")
    assert "FROM public.niyam_runs r" in sql
    assert "COUNT(*) AS value" in sql
    assert "COUNT(*) FILTER (WHERE r.dry_run) AS dry_runs" in sql
    assert "COUNT(*) FILTER (WHERE ref.refused) AS refused_runs" in sql
    assert "r.started_at::date BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_rules_fired_refused_probe_is_one_row_per_run():
    # LIMIT 1 in the lateral: a run with three refused steps is ONE refused
    # run; a bare join would fan out and inflate value and refused_runs both.
    sql, _ = build("core.niyam_rules_fired")
    assert "s.outcome = 'refused' LIMIT 1" in sql
    assert "r.org_id = $1::uuid" in sql


# ── actions ──────────────────────────────────────────────────────────────────

def test_actions_scope_through_the_run_because_steps_carry_no_org():
    """niyam_run_steps has NO org_id column (migration 143) — the only honest
    tenant path is run_steps.run_id -> niyam_runs.org_id."""
    sql, params = build("core.niyam_actions")
    assert "JOIN public.niyam_runs r ON r.run_id = s.run_id" in sql
    assert "r.org_id = $1::uuid" in sql
    assert "s.org_id" not in sql, "run_steps has no org_id to filter on"
    assert params == [ORG, WIN.start, WIN.end]


def test_actions_are_recognised_by_detail_never_by_joining_rule_steps():
    """Run steps mirror step_no rather than referencing the rule step, so the
    kind must come from what the run RECORDED: every engine.py action path
    writes `verb`, and the unknown-verb refusal writes `allowed`. Joining
    niyam_rule_steps would follow a later edit of the rule."""
    sql, _ = build("core.niyam_actions")
    assert "s.detail ? 'verb'" in sql
    assert "s.detail ? 'allowed'" in sql
    assert "niyam_rule_steps" not in sql


def test_actions_split_executed_against_suppressed():
    sql, _ = build("core.niyam_actions")
    assert "COUNT(*) FILTER (WHERE s.outcome = 'ok') AS executed" in sql
    assert "COUNT(*) FILTER (WHERE s.outcome = 'dry') AS suppressed" in sql
    assert "COUNT(*) FILTER (WHERE s.outcome = 'refused') AS refused" in sql
    assert "COUNT(*) FILTER (WHERE s.outcome = 'failed') AS failed" in sql
    assert "s.created_at::date BETWEEN $2::date AND $3::date" in sql


def test_actions_outcome_dimension_appears_only_when_asked_for():
    grouped, _ = build("core.niyam_actions", group_by="outcome")
    assert "s.outcome AS outcome" in grouped
    assert "GROUP BY 1, 2" in grouped
    assert grouped.rstrip().endswith("ORDER BY 1, 2")
    plain, _ = build("core.niyam_actions")
    assert "AS outcome" not in plain


# ── failure_rate ─────────────────────────────────────────────────────────────

def test_failure_rate_is_counts_over_counts_with_the_counts_shown():
    sql, _ = build("core.niyam_failure_rate")
    assert ("COUNT(*) FILTER (WHERE f.failed)::float / "
            "NULLIF(COUNT(*), 0)::float * 100") in sql
    assert "AS failed" in sql and "AS runs" in sql
    assert "AVG(" not in sql, "a rate is sums over sums, never averaged rates"


def test_failure_rate_a_failed_run_means_a_failed_step_counted_once():
    """A run's failure is derived from its steps — runs deliberately carry no
    status column (migration 143) — and LIMIT 1 keeps a twice-failed pipeline
    one failed run."""
    sql, params = build("core.niyam_failure_rate")
    assert "s.outcome = 'failed' LIMIT 1" in sql
    assert "FROM public.niyam_runs r" in sql
    assert "r.org_id = $1::uuid" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_failure_rate_does_not_count_refusals_as_failures():
    # A refused condition is the rule working. Only 'failed' may reach the
    # numerator.
    sql, _ = build("core.niyam_failure_rate")
    assert "'refused'" not in sql
    assert "'dry'" not in sql


# ── never_fired ──────────────────────────────────────────────────────────────

def test_never_fired_is_a_stock_binding_only_the_org():
    _, params = build("core.niyam_never_fired")
    assert params == [ORG]


def test_never_fired_is_enabled_rules_with_zero_runs():
    """The stock anti-join: enabled only (a disabled rule is not waiting for
    anything), and NOT EXISTS against the runs table — zero runs is the
    definition, because every evaluation writes a run."""
    sql, _ = build("core.niyam_never_fired")
    assert "FROM public.niyam_rules ru" in sql
    assert "ru.enabled" in sql
    assert "NOT EXISTS" in sql
    assert "public.niyam_runs r WHERE r.rule_id = ru.rule_id" in sql


def test_never_fired_labels_the_name_and_never_an_id():
    sql, _ = build("core.niyam_never_fired")
    assert "ru.name AS label" in sql
    # names-not-ids: rule_id belongs to the anti-join only, never the
    # select list.
    select_list = sql.split(" FROM ")[0]
    assert "rule_id" not in select_list


def test_never_fired_value_is_the_age_of_the_silence():
    sql, _ = build("core.niyam_never_fired")
    assert "(CURRENT_DATE - ru.created_at::date) AS value" in sql
    assert "ORDER BY value DESC, label" in sql
