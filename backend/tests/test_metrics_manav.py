"""The manav (HR) metrics, held to the guards their docstring promises.

Two layers, deliberately. The manav module is not yet wired into
analytics.registry.load_all() (that edit is the integration step, owned
elsewhere), so test_analytics_registry.py's universal walk — collected before
this file imports the module — never sees these declarations. The first
section therefore REPLICATES the universal contract locally for every manav
key: schema-qualified tables, $1::uuid cast, placeholder parity, window
binding, bucket honouring, dimension reachability, actionable absent reasons.
Delete that section only when load_all() imports manav and the universal walk
covers it.

The second section is the metric-SPECIFIC pins, in the ganit idiom: the
guarantees a refactor could drop while every universal check stays green —
leavers counted from offboarding rows rather than a leaving date that does
not exist, the annualisation formula, the reconstruction rules, the
percentile_cont headline, the GREATEST floor on leave balances, and
'Unassigned' where blank free text would otherwise vanish. Every assertion
scans the SQL string the builder actually returns — never a comment, never a
docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

import pytest

import analytics.metrics.manav  # noqa: F401  — registers the declarations
from analytics.metrics.manav import _headcount_asat
from analytics.registry import REGISTRY, MetricRequest
from analytics.windowing import BUCKETS
from services.analytics_window import Window
from services.on_the_rolls import still_on_the_rolls

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

MANAV_SQL = sorted(
    k for k, m in REGISTRY.items() if k.startswith("manav.") and m.sql is not None
)
MANAV_ABSENT = sorted(
    k for k, m in REGISTRY.items() if k.startswith("manav.") and m.absent
)


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


# ── The universal contract, replicated for manav until load_all() covers it ──

def test_the_manav_batch_is_not_empty():
    assert MANAV_SQL, "no runnable manav metrics registered"
    assert MANAV_ABSENT, "the declared-absent manav set vanished"


@pytest.mark.parametrize("key", MANAV_SQL)
def test_every_runnable_manav_metric_builds_sound_sql(key):
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(MetricRequest(org_id=ORG, window=win, bucket="month"))

    assert isinstance(sql, str) and isinstance(params, list)
    assert re.search(r"\b(staging|public)\.", sql), f"{key}: unqualified table\n{sql}"
    assert "$1::uuid" in sql, f"{key}: org parameter not cast\n{sql}"
    assert params[0] == ORG

    placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert placeholders == set(range(1, len(params) + 1)), (
        f"{key}: SQL names {sorted(placeholders)} but {len(params)} params bound"
    )

    if m.grain == "flow":
        assert len(params) >= 3, f"{key}: a flow metric must bind its window"
        assert params[1] == win.start and params[2] == win.end


@pytest.mark.parametrize("key", MANAV_SQL)
def test_manav_flow_metrics_honour_every_bucket(key):
    m = REGISTRY[key]
    if m.grain != "flow":
        pytest.skip("stocks take no bucket")
    for b in sorted(BUCKETS):
        sql, _ = m.sql(MetricRequest(org_id=ORG, window=WIN, bucket=b))
        assert f"date_trunc('{b}'" in sql, f"{key} ignored bucket={b}"
        assert "::date" in sql


@pytest.mark.parametrize("key", MANAV_ABSENT)
def test_manav_absent_metrics_carry_their_reason(key):
    m = REGISTRY[key]
    assert m.sql is None
    assert len(m.absent) > 60, f"{key}: absence reason too thin to act on"


def test_manav_dimensions_are_reachable():
    for key in MANAV_SQL:
        m = REGISTRY[key]
        for dim in m.dimensions:
            win = WIN if m.grain == "flow" else None
            sql, _ = m.sql(MetricRequest(org_id=ORG, window=win,
                                         bucket="month", group_by=dim))
            assert dim in sql, f"{key}: group_by={dim} accepted but absent from SQL"


def test_every_manav_key_is_module_prefixed():
    for key in MANAV_SQL + MANAV_ABSENT:
        assert REGISTRY[key].module == "manav"


# ── The batch declaration pin ────────────────────────────────────────────────

def test_the_batch_is_declared_as_specified():
    expect = {
        "manav.headcount": ("stock", "count", "operational"),
        "manav.headcount_bridge": ("flow", "count", "operational"),
        "manav.attrition": ("flow", "pct", "operational"),
        "manav.tenure": ("stock", "days", "operational"),
        "manav.department_mix": ("stock", "count", "operational"),
        "manav.designation_mix": ("stock", "count", "operational"),
        "manav.span_of_control": ("stock", "count", "operational"),
        "manav.leave_liability_days": ("stock", "days", "operational"),
        "manav.time_to_fill": ("flow", "days", "operational"),
        "manav.confirmations_due": ("stock", "count", "operational"),
        "manav.leave_liability_inr": ("stock", "inr", "financial"),
    }
    assert set(expect) == set(MANAV_SQL) | set(MANAV_ABSENT), "batch drifted"
    for key, (grain, unit, sensitivity) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.sensitivity) == (grain, unit, sensitivity), key
    assert REGISTRY["manav.headcount"].dimensions == ("employment_type",)
    assert REGISTRY["manav.attrition"].dimensions == ("exit_class",)
    assert REGISTRY["manav.tenure"].dimensions == ("band",)


# ── On the rolls: the one guard five stocks share ────────────────────────────
# manav_employees.is_active is a FLAG somebody must remember to clear;
# manav_offboarding.last_working_day is a FACT already recorded. Live in E2E on
# 2026-08-26 the two disagreed by ten people who had left up to seven weeks
# earlier — and the flag is KEPT until settlement on purpose (routers/manav.py
# :1958: clearing it at exit once dropped a leaver out of payroll with an
# unrecovered salary advance, and two of these ten carry ₹1,15,000 between
# them). The data is right; the READS have to ask the right question — and ask
# it the SAME way, via services/on_the_rolls, never a local retelling.

GUARD = " ".join(still_on_the_rolls("e").split())

#: Every manav STOCK site, with the group_by that reaches it. A stock answers
#: "who is on the rolls NOW" and must carry the guard. The flows below must
#: not: an ex-employee's July exit still happened in July.
ROLLS_SITES = [
    ("manav.headcount", None),
    ("manav.headcount", "employment_type"),
    ("manav.tenure", None),
    ("manav.tenure", "band"),
    ("manav.department_mix", None),
    ("manav.designation_mix", None),
    ("manav.leave_liability_days", None),
]

FLOW_SITES = [
    ("manav.headcount_bridge", None),
    ("manav.attrition", None),
    ("manav.attrition", "exit_class"),
]


@pytest.mark.parametrize("key,group_by", ROLLS_SITES)
def test_every_stock_site_carries_the_shared_rolls_guard(key, group_by):
    sql, _ = build(key, group_by=group_by)
    assert GUARD in sql, (
        f"{key} (group_by={group_by}) trusts is_active alone — E2E's ten "
        f"departed-but-flagged employees count as present\n{sql}"
    )


@pytest.mark.parametrize("key,group_by", ROLLS_SITES)
def test_the_guard_narrows_is_active_and_never_replaces_it(key, group_by):
    """A hand-deactivation with no offboarding row is an exit too — undated,
    but real, and the legacy DELETE path still writes exactly that. The guard
    removes the dated leavers the flag is still deliberately carrying; it is
    not a substitute for the flag."""
    sql, _ = build(key, group_by=group_by)
    assert "is_active = TRUE" in sql, sql


@pytest.mark.parametrize("key,group_by", ROLLS_SITES)
def test_no_stock_site_hand_writes_its_own_exit_test(key, group_by):
    """Twenty-five hand-written copies is the failure services/on_the_rolls.py
    exists to prevent. A stock may reach manav_offboarding ONLY through the
    shared fragment — so the table is named exactly as often as the guard is,
    which is once."""
    sql, _ = build(key, group_by=group_by)
    assert sql.count("staging.manav_offboarding") == sql.count(GUARD) == 1, sql


@pytest.mark.parametrize("key,group_by", ROLLS_SITES)
def test_the_guard_correlates_to_an_alias_the_query_actually_declares(key, group_by):
    """The fragment says e.org_id and e.id. A site that dropped it into a
    query with no alias would not parse — and inlining an aliasless variant
    to dodge that is the twenty-sixth copy. Declare `e`."""
    sql, _ = build(key, group_by=group_by)
    assert re.search(r"staging\.manav_employees e\b", sql), sql


@pytest.mark.parametrize("key,group_by", FLOW_SITES)
def test_flow_metrics_never_carry_the_rolls_guard(key, group_by):
    """Guarding a flow rewrites history: the bridge would lose the very
    leavers it exists to count, and attrition its whole numerator."""
    sql, _ = build(key, group_by=group_by)
    assert GUARD not in sql, sql


def test_the_stock_guard_and_the_asat_reconstruction_stay_one_rule():
    """attrition rebuilds headcount at a PAST date; the stocks ask about
    today. Same question from two sides, so they must agree clause for clause
    — the org_id+id join (manav_offboarding has no composite constraint, and
    a join on the child id alone reaches another tenant) and the cancelled
    exclusion (a withdrawn resignation is not a departure). Only the boundary
    flips: the reconstruction keeps an exit still AHEAD of d, the guard drops
    one already BEHIND today. Two spellings of one rule is the ceiling —
    a third is the drift this whole sweep was cleaning up."""
    asat = " ".join(_headcount_asat("$2").split())
    for clause in ("x.org_id = e.org_id", "x.employee_id = e.id",
                   "x.status <> 'cancelled'"):
        assert clause in GUARD, f"guard lost {clause}"
        assert clause in asat, f"reconstruction lost {clause}"
    assert "x.last_working_day < CURRENT_DATE" in GUARD
    assert "x.last_working_day > $2::date" in asat


# ── headcount ────────────────────────────────────────────────────────────────

def test_headcount_counts_the_rolls_not_the_dashboards_narrower_status():
    """is_active is the employment flag — both exit paths clear it. Someone
    on notice is still headcount; the dashboard's status='active' count is a
    different, narrower question and must not leak in here."""
    sql, params = build("manav.headcount")
    assert "FROM staging.manav_employees" in sql
    assert "is_active = TRUE" in sql
    assert "status = 'active'" not in sql
    assert "COUNT(*) FILTER (WHERE status = 'on_notice') AS on_notice" in sql
    assert params == [ORG]


def test_headcount_is_a_ghost_org_guarded_single_row():
    sql, _ = build("manav.headcount")
    assert "HAVING COUNT(*) > 0" in sql


def test_headcount_employment_type_split_only_when_asked():
    grouped, _ = build("manav.headcount", group_by="employment_type")
    assert "employment_type AS label" in grouped
    assert "GROUP BY employment_type" in grouped
    plain, _ = build("manav.headcount")
    assert "employment_type" not in plain


# ── headcount_bridge ─────────────────────────────────────────────────────────

def test_bridge_joins_the_two_dated_facts_that_exist():
    """manav_employees has NO leaving date — the dated exit lives on
    manav_offboarding.last_working_day, and that is what the leaver leg must
    read. The joiner leg reads date_of_joining."""
    sql, params = build("manav.headcount_bridge")
    assert "FROM staging.manav_employees" in sql
    assert "date_of_joining BETWEEN $2::date AND $3::date" in sql
    assert "UNION ALL" in sql
    assert "FROM staging.manav_offboarding o" in sql
    assert "o.last_working_day BETWEEN $2::date AND $3::date" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_bridge_value_is_the_net_with_both_sides_shown():
    sql, _ = build("manav.headcount_bridge")
    assert "SUM(joined) AS joiners" in sql
    assert "SUM(departed) AS leavers" in sql
    assert "SUM(joined) - SUM(departed) AS value" in sql


def test_bridge_excludes_cancelled_exits_and_never_filters_is_active():
    """A cancelled offboarding is a mistake, not a leaver. And a joiner who
    has since left still JOINED — an is_active filter on a flow would rewrite
    history every time someone departs."""
    sql, _ = build("manav.headcount_bridge")
    assert "o.status <> 'cancelled'" in sql
    assert "is_active" not in sql


# ── attrition ────────────────────────────────────────────────────────────────

def test_attrition_is_the_documented_annualised_formula():
    """leavers ÷ avg(start, end reconstructed headcount) × 365/days × 100 —
    each piece pinned so the formula in the description stays the formula in
    the SQL."""
    sql, params = build("manav.attrition")
    assert "* (365.0 / ($3::date - $2::date + 1)) * 100" in sql
    assert "NULLIF(h.avg_headcount, 0)" in sql
    assert ") / 2.0 AS avg_headcount" in sql
    assert "AVG(" not in sql, "attrition is a ratio of sums, never an averaged rate"
    assert params == [ORG, WIN.start, WIN.end]


def test_attrition_reconstruction_only_counts_placeable_employees():
    """Headcount at a past date can only include people whose joining AND
    leaving can be placed in time: date_of_joining set, and either still
    active or holding a live offboarding whose last_working_day is after the
    date. The DELETE-deactivated (no offboarding row) are excluded, stated in
    the description."""
    sql, _ = build("manav.attrition")
    assert "e.date_of_joining IS NOT NULL" in sql
    assert "e.date_of_joining <= $2::date" in sql
    assert "e.date_of_joining <= $3::date" in sql
    assert "e.is_active = TRUE OR EXISTS" in sql
    assert "x.last_working_day > $2::date" in sql
    assert "x.last_working_day > $3::date" in sql
    assert "x.status <> 'cancelled'" in sql


def test_attrition_leavers_come_from_offboarding_rows():
    sql, _ = build("manav.attrition")
    assert "FROM staging.manav_offboarding o" in sql
    assert "o.status <> 'cancelled'" in sql
    assert "o.last_working_day BETWEEN $2::date AND $3::date" in sql


def test_attrition_zero_leavers_is_an_honest_zero_and_a_ghost_org_is_no_rows():
    """An org with headcount and no exits has 0% attrition — a real answer.
    An org with no reconstructable headcount gets no rows, never a
    {value: null} shape (the ganit.outstanding rule)."""
    sql, _ = build("manav.attrition")
    assert "COALESCE(SUM(leavers), 0)" in sql
    assert "WHERE h.avg_headcount > 0" in sql


def test_attrition_exit_class_is_the_three_way_split_only_when_asked():
    """exit_type's seven values split three ways — forcing end_of_contract
    and death into voluntary or involuntary would be a fiction."""
    grouped, _ = build("manav.attrition", group_by="exit_class")
    assert "IN ('resignation', 'retirement', 'abandonment')" in grouped
    assert "'voluntary'" in grouped
    assert "IN ('termination', 'redundancy') THEN 'involuntary'" in grouped
    assert "ELSE 'other' END" in grouped
    assert "GROUP BY exit_class" in grouped
    plain, _ = build("manav.attrition")
    assert "exit_class" not in plain


def test_attrition_is_the_same_ratio_of_sums_under_every_bucket():
    # The leaver count is bucketed inside and summed outside — the annualised
    # number must be identical whichever bucket the caller sends.
    for b in sorted(BUCKETS):
        sql, _ = build("manav.attrition", bucket=b)
        assert "* (365.0 / ($3::date - $2::date + 1)) * 100" in sql, b
        assert "COALESCE(SUM(leavers), 0)" in sql, b


# ── tenure ───────────────────────────────────────────────────────────────────

def test_tenure_headline_is_a_median_with_the_mean_labelled_as_a_mean():
    sql, params = build("manav.tenure")
    assert "percentile_cont(0.5) WITHIN GROUP" in sql
    assert "(ORDER BY CURRENT_DATE - date_of_joining)" in sql
    assert "AVG(CURRENT_DATE - date_of_joining)::float AS mean_days" in sql
    assert "AS value" in sql.split("AS mean_days")[0], "the median is the headline"
    assert params == [ORG]


def test_tenure_excludes_the_unmeasurable_and_guards_the_ghost_org():
    sql, _ = build("manav.tenure")
    assert "date_of_joining IS NOT NULL" in sql
    assert "is_active = TRUE" in sql
    assert "HAVING COUNT(*) > 0" in sql


def test_tenure_bands_only_when_asked_and_ordered_by_service_not_size():
    grouped, _ = build("manav.tenure", group_by="band")
    for edge in ("< 365", "< 1095", "< 1825"):
        assert edge in grouped, edge
    for label in ("'< 1 yr'", "'1-3 yrs'", "'3-5 yrs'", "'5+ yrs'"):
        assert label in grouped, label
    assert "ORDER BY MIN(CURRENT_DATE - date_of_joining)" in grouped
    plain, _ = build("manav.tenure")
    assert "band" not in plain


# ── department_mix / designation_mix ─────────────────────────────────────────

def test_mixes_fold_blank_free_text_into_unassigned():
    """department and designation are TEXT DEFAULT '' — blank rows are real
    and must group under 'Unassigned', not vanish or sit under an empty
    label. NULLIF handles '', COALESCE handles NULL."""
    dept, dparams = build("manav.department_mix")
    assert "COALESCE(NULLIF(department, ''), 'Unassigned') AS label" in dept
    desg, gparams = build("manav.designation_mix")
    assert "COALESCE(NULLIF(designation, ''), 'Unassigned') AS label" in desg
    for sql, params in ((dept, dparams), (desg, gparams)):
        assert "is_active = TRUE" in sql
        assert "FROM staging.manav_employees" in sql
        assert params == [ORG]


def test_mixes_never_join_the_departments_table():
    # manav_departments does not constrain the free-text column — a join
    # would silently drop every employee whose value has no department row.
    sql, _ = build("manav.department_mix")
    assert "manav_departments" not in sql


# ── span_of_control ──────────────────────────────────────────────────────────

def test_span_is_declared_absent_over_the_unwritten_link():
    """Live probe 2026-08-18: reporting_to is NULL/empty on every one of the
    98 employee rows, and migration 030 retyped it TEXT against the uuid id.
    An unwritten link must be a stated absence, not an empty chart."""
    from analytics.registry import REGISTRY
    m = REGISTRY["manav.span_of_control"]
    assert m.absent and "reporting_to" in m.absent
    assert "030" in m.absent, "the retype is half the reason and must be named"


# ── leave_liability_days ─────────────────────────────────────────────────────

def test_leave_liability_is_the_floored_arithmetic_over_current_year_rows():
    sql, params = build("manav.leave_liability_days")
    assert ("GREATEST(b.allocated + COALESCE(b.carried_forward, 0) "
            "- b.used, 0)") in sql
    assert "b.year = EXTRACT(YEAR FROM CURRENT_DATE)::int" in sql
    assert params == [ORG]


def test_leave_liability_counts_paid_types_for_current_employees_only():
    sql, _ = build("manav.leave_liability_days")
    assert "t.is_paid = TRUE" in sql
    assert "e.is_active = TRUE" in sql
    assert "FROM staging.manav_leave_balances b" in sql
    assert "HAVING COUNT(*) > 0" in sql


def test_leave_liability_days_never_reaches_for_a_salary():
    """The rupee half is declared absent — no encashment basis exists. The
    day metric must not smuggle a pricing in."""
    sql, _ = build("manav.leave_liability_days")
    for forbidden in ("basic", "gross", "ctc", "hourly_rate", "salary",
                      "vetana"):
        assert forbidden not in sql, forbidden


# ── the declared absences ────────────────────────────────────────────────────

def test_time_to_fill_is_absent_naming_the_missing_requisition_date():
    m = REGISTRY["manav.time_to_fill"]
    assert m.sql is None
    assert "opened" in m.absent
    assert "manav_job_openings" in m.absent
    assert "created_at" in m.absent, "the reason must say why created_at is not it"


def test_confirmations_due_is_absent_naming_the_missing_probation_column():
    m = REGISTRY["manav.confirmations_due"]
    assert m.sql is None
    assert "probation" in m.absent
    assert "manav_employees" in m.absent


def test_leave_liability_inr_is_absent_pointing_at_the_days_metric():
    m = REGISTRY["manav.leave_liability_inr"]
    assert m.sql is None
    assert m.sensitivity == "financial"
    assert "encashment" in m.absent
    assert "manav.leave_liability_days" in m.absent, (
        "the reason must point the reader at the half that DOES ship"
    )
