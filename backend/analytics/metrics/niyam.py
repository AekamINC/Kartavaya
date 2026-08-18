"""Niyam (automation) metrics — proposal 62 §4: rules fired, actions executed
vs suppressed, failure rate, and which rules have never fired at all.

THE FACTS THIS FILE STANDS ON, read from migrations 141/143 and
services/niyam/engine.py rather than assumed:

· Four tables, all in **staging** and all schema-qualified here —
  `niyam_rules`, `niyam_events`, `niyam_runs`, `niyam_run_steps`. The live
  search_path does not include staging (the shadow-table incident, 142).
· Org scope: rules, events and runs carry `org_id`; **run_steps does NOT** —
  every step-level metric scopes through its run
  (`niyam_run_steps.run_id -> niyam_runs.org_id`).
· The outcome vocabulary is a CHECK constraint in 143:
  ok / refused / failed / skipped / dry. `dry` only ever lands on ACTION
  steps — an unarmed rule still evaluates its conditions for real and records
  their true verdicts; only its actions resolve to `dry`.
· **Every evaluation writes a run, matched or not** (engine.py's header: "a
  rule that evaluated and did not match is the normal case"). So "rules
  fired" here counts evaluations and shows how many stopped at a condition,
  rather than inventing a narrower "fired" the tables do not record.
· Run steps carry NO kind column, deliberately: a rule may be edited after a
  run, and 143 says the history "must keep saying what position ran, not
  follow the edit" — so joining `niyam_rule_steps` to classify a historical
  step would follow the edit and is never done here. An action step is
  recognised by its recorded detail instead: every action path in engine.py
  writes `{"verb": ...}` (ok, dry, and handler-raised failures alike) except
  the unknown-verb refusal, which writes `{"allowed": [...]}` — and no other
  step kind writes either key (conditions write reason+values, waits write
  reason+minutes).
· `dry_run` is stamped on the RUN, not re-derived from the arming flag later
  — the master switch can flip between runs, so the split rides on the column.

MODULE AND KEYS. These metrics declare `module="core"`: Niyam is not in
ALL_MODULES — its screens are org-role-gated, not module-gated, and automation
ships with every org — and the registry gates catalogues on module codes
(routers/analytics.py: `UNGATED_MODULES = frozenset({"core"})`), so "core" is
the one code that reaches every caller. The keys are `core.niyam_*`, NOT
`niyam.*`: `Metric.__post_init__` requires the key prefix to equal the module
("key must be '{module}.<name>'"), so the niyam namespace lives inside the
name, where the registry allows it.

The house rules, held as elsewhere: every parameter cast ($1::uuid, $2::date —
PgBouncer turns an untyped parse error into an instant 500), rates from sums
within each bucket never averaged rates, fired/actions are FLOW, never-fired
is STOCK, and no id ever reaches a label (rules are labelled by `name`).
"""
from analytics.registry import MetricRequest, metric
from analytics.windowing import bucket_expr

#: A step is an ACTION step iff its detail says so — see the module docstring:
#: run_steps has no kind column on purpose, and every engine.py action path
#: writes `verb` except the unknown-verb refusal, which writes `allowed`.
_ACTION_STEP = "(s.detail ? 'verb' OR s.detail ? 'allowed')"


@metric(
    key="core.niyam_rules_fired",
    module="core",  # Niyam is NOT a module code: not in ALL_MODULES, org-role-
                    # gated screens, ships with every org. The registry gates
                    # catalogues on module codes and "core" is the ungated one
                    # (routers/analytics.py UNGATED_MODULES) — any other value
                    # would gate an every-org capability out of the catalogue.
    label="Rules fired",
    unit="count",
    grain="flow",
    drill="niyam.runs",
    description="Rule runs recorded during the period — every evaluation "
                "writes a run, matched or not, so this counts evaluations: "
                "refused_runs says how many stopped at a condition, dry_runs "
                "how many came from unarmed rules.",
)
def rules_fired(req: MetricRequest):
    period = bucket_expr(req.bucket, "r.started_at")
    return (
        f"SELECT {period} AS period, COUNT(*) AS value, "
        "COUNT(*) FILTER (WHERE r.dry_run) AS dry_runs, "
        "COUNT(*) FILTER (WHERE ref.refused) AS refused_runs "
        "FROM staging.niyam_runs r "
        # One probe row per run, not a join fan-out: a run with three refused
        # condition steps must still count as ONE refused run.
        "LEFT JOIN LATERAL ("
        "  SELECT TRUE AS refused FROM staging.niyam_run_steps s "
        "  WHERE s.run_id = r.run_id AND s.outcome = 'refused' LIMIT 1"
        ") ref ON TRUE "
        "WHERE r.org_id = $1::uuid "
        "AND r.started_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="core.niyam_actions",
    module="core",  # "core" — the ungated module code; Niyam is not a module.
                    # See the note on core.niyam_rules_fired.
    label="Actions executed vs suppressed",
    unit="count",
    grain="flow",
    dimensions=("outcome",),
    drill="niyam.runs",
    description="Action steps recorded during the period — executed (ok) "
                "against suppressed: `dry` is an unarmed rule saying what it "
                "would have done, `refused` is a guard saying no. group_by="
                "outcome splits the full vocabulary (ok/refused/failed/"
                "skipped/dry).",
)
def actions(req: MetricRequest):
    period = bucket_expr(req.bucket, "s.created_at")
    # niyam_run_steps carries NO org_id — the org scope is the run's, always.
    base = (
        "FROM staging.niyam_run_steps s "
        "JOIN staging.niyam_runs r ON r.run_id = s.run_id "
        "WHERE r.org_id = $1::uuid "
        f"AND {_ACTION_STEP} "
        "AND s.created_at::date BETWEEN $2::date AND $3::date "
    )
    if req.group_by == "outcome":
        return (
            f"SELECT {period} AS period, s.outcome AS outcome, "
            "COUNT(*) AS value "
            + base +
            "GROUP BY 1, 2 ORDER BY 1, 2",
            [req.org_id, req.window.start, req.window.end],
        )
    return (
        f"SELECT {period} AS period, COUNT(*) AS value, "
        "COUNT(*) FILTER (WHERE s.outcome = 'ok') AS executed, "
        "COUNT(*) FILTER (WHERE s.outcome = 'dry') AS suppressed, "
        "COUNT(*) FILTER (WHERE s.outcome = 'refused') AS refused, "
        "COUNT(*) FILTER (WHERE s.outcome = 'failed') AS failed "
        + base +
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="core.niyam_failure_rate",
    module="core",  # "core" — the ungated module code; Niyam is not a module.
                    # See the note on core.niyam_rules_fired.
    label="Run failure rate",
    unit="pct",
    grain="flow",
    drill="niyam.runs",
    description="Share of runs that recorded a failed step, per bucket — "
                "counts over counts, with failed and total riding along so "
                "the % is auditable. A refused condition is the rule working, "
                "not a failure, and does not count here.",
)
def failure_rate(req: MetricRequest):
    period = bucket_expr(req.bucket, "r.started_at")
    return (
        f"SELECT {period} AS period, "
        "COUNT(*) FILTER (WHERE f.failed)::float / NULLIF(COUNT(*), 0)::float * 100 AS value, "
        "COUNT(*) FILTER (WHERE f.failed) AS failed, "
        "COUNT(*) AS runs "
        "FROM staging.niyam_runs r "
        # LIMIT 1 keeps this one row per run: a pipeline that failed twice is
        # still one failed run, and a fan-out here would inflate BOTH counts.
        "LEFT JOIN LATERAL ("
        "  SELECT TRUE AS failed FROM staging.niyam_run_steps s "
        "  WHERE s.run_id = r.run_id AND s.outcome = 'failed' LIMIT 1"
        ") f ON TRUE "
        "WHERE r.org_id = $1::uuid "
        "AND r.started_at::date BETWEEN $2::date AND $3::date "
        "GROUP BY 1 ORDER BY 1",
        [req.org_id, req.window.start, req.window.end],
    )


@metric(
    key="core.niyam_never_fired",
    module="core",  # "core" — the ungated module code; Niyam is not a module.
                    # See the note on core.niyam_rules_fired.
    label="Rules that have never fired",
    unit="days",
    grain="stock",
    drill="niyam.rules",
    description="Enabled rules with zero runs, as at today — each labelled by "
                "name, valued at days since it was created, with the event "
                "type it is waiting for. Every evaluation writes a run, so "
                "zero runs means the trigger event has never arrived (or "
                "arrived only before the rule existed).",
)
def never_fired(req: MetricRequest):
    # A listing, like ganit.top_debtors: no rows is the honest empty, so no
    # HAVING guard is needed and an org that is not yours returns nothing.
    # The label is the rule's NAME — rule_id never reaches the select list
    # (decision_names_not_ids).
    return (
        "SELECT ru.name AS label, "
        "(CURRENT_DATE - ru.created_at::date) AS value, "
        "ru.event_type AS event_type "
        "FROM staging.niyam_rules ru "
        "WHERE ru.org_id = $1::uuid AND ru.enabled "
        "AND NOT EXISTS ("
        "  SELECT 1 FROM staging.niyam_runs r WHERE r.rule_id = ru.rule_id"
        ") "
        "ORDER BY value DESC, label",
        [req.org_id],
    )
