"""The pahchan metrics, held to the boundary their docstring promises.

The pin that outranks every other in this file is THE DPDP PIN: attendance
detail is deliberately god-mode-only (project_pahchan_dpdp_access), so no
employee identifier — id, name, code, email — may escape any query this
module builds, no metric may offer a per-person dimension, and no metric may
declare a drill into the register. A refactor that adds "just one" per-person
cut must turn this file red before it turns a screen into a side door.

analytics.metrics.pahchan is not yet wired into load_all() (that file belongs
to the integrator), so this suite imports it directly AND mirrors the
universal registry rules (test_analytics_registry.py) over the pahchan set —
the declarations must already pass them on the day the import line lands.

Every assertion scans the SQL string the builder actually returns — never a
comment, never a docstring — so a change to the query is what changes a test.
"""
import re
from datetime import date

from analytics.registry import REGISTRY, MetricRequest, load_all
from analytics.windowing import BUCKETS
from services.analytics_window import Window

load_all()
import analytics.metrics.pahchan  # noqa: E402,F401  (registers on import)

WIN = Window(date(2026, 4, 1), date(2026, 6, 30))
ORG = "00000000-0000-0000-0000-000000000000"

PAHCHAN = {k: m for k, m in REGISTRY.items() if m.module == "pahchan"}
SQL_KEYS = sorted(k for k, m in PAHCHAN.items() if m.sql is not None)
ABSENT_KEYS = sorted(k for k, m in PAHCHAN.items() if m.absent)


def build(key: str, *, group_by=None, bucket: str = "month"):
    """The (whitespace-normalised SQL, params) a metric builds."""
    m = REGISTRY[key]
    win = WIN if m.grain == "flow" else None
    sql, params = m.sql(
        MetricRequest(org_id=ORG, window=win, bucket=bucket, group_by=group_by)
    )
    return " ".join(sql.split()), params


def every_build(key: str):
    """Every SQL variant a metric can produce: ungrouped + each dimension."""
    m = REGISTRY[key]
    for dim in (None, *m.dimensions):
        yield dim, build(key, group_by=dim)[0]


def test_the_batch_is_declared_as_specified():
    expect = {
        "pahchan.attendance_rate": ("flow", "pct", ("team",)),
        "pahchan.absenteeism": ("flow", "count", ("team",)),
        "pahchan.hours_worked": ("flow", "hours", ("team",)),
        "pahchan.vetana_reconciliation": ("flow", "days", ()),
        "pahchan.attendance_by_shift": ("flow", "pct", ()),
        "pahchan.late_arrivals": ("flow", "count", ()),
        "pahchan.geofence_exceptions": ("flow", "count", ()),
        "pahchan.offline_reconciliation": ("flow", "count", ()),
    }
    assert sorted(PAHCHAN) == sorted(expect)
    for key, (grain, unit, dims) in expect.items():
        m = REGISTRY[key]
        assert (m.grain, m.unit, m.dimensions) == (grain, unit, dims), key


# ── THE DPDP PIN ─────────────────────────────────────────────────────────────

def test_dpdp_no_employee_identifier_escapes_any_query():
    """The boundary itself: every SQL variant of every pahchan metric is a
    team/day aggregate. employee_id may exist ONLY as the join key that
    resolves an attendance row to its department — never in a SELECT list,
    never in a GROUP BY — and no name-shaped employee column appears at all.
    The count equality below proves the SELECT-list claim for every select
    list in the statement, including subqueries."""
    banned_everywhere = (
        "employee_code", "e.name", "e.email", "e.phone", "u.email",
        "aadhaar", "user_id", "date_of_birth",
    )
    for key in SQL_KEYS:
        for dim, sql in every_build(key):
            where = f"{key} group_by={dim}"
            # employee_id occurs exactly as the department join key, nowhere
            # else — so no SELECT list, label or output column can carry it.
            assert sql.count("employee_id") == sql.count(
                "ON e.id = a.employee_id"
            ), where
            for token in banned_everywhere:
                assert token not in sql, f"{where}: {token} escaped"
            # Every GROUP BY is positional (period / team) — grouping by a
            # person is impossible to express without failing here.
            for m in re.finditer(r"GROUP BY (\S+)", sql):
                assert m.group(1).rstrip(",") == "1", where


def test_dpdp_no_per_person_dimension_and_no_drill_into_the_register():
    for key, m in PAHCHAN.items():
        assert "employee" not in m.dimensions, key
        assert "person" not in m.dimensions, key
        # The register is god-mode-only; a drill would grant through
        # analytics what the module itself refuses.
        assert m.drill is None, f"{key} declares a drill into attendance"


# ── universal rules, mirrored until load_all() wires this module ─────────────

def test_pahchan_passes_the_registry_walk_it_will_join():
    for key in SQL_KEYS:
        m = REGISTRY[key]
        sql, params = build(key)
        assert re.search(r"\b(staging|public)\.", sql), key
        assert "$1::uuid" in sql and params[0] == ORG, key
        placeholders = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert placeholders == set(range(1, len(params) + 1)), key
        assert m.grain == "flow" and params[1] == WIN.start and params[2] == WIN.end
        for b in sorted(BUCKETS):
            bsql, _ = build(key, bucket=b)
            assert f"date_trunc('{b}'" in bsql and "::date" in bsql, (key, b)
        for dim in m.dimensions:
            dsql, _ = build(key, group_by=dim)
            assert dim in dsql, (key, dim)


def test_absent_reasons_name_the_unapplied_migration():
    assert ABSENT_KEYS == [
        "pahchan.attendance_by_shift",
        "pahchan.geofence_exceptions",
        "pahchan.late_arrivals",
        "pahchan.offline_reconciliation",
    ]
    for key in ABSENT_KEYS:
        m = REGISTRY[key]
        assert m.sql is None
        assert len(m.absent) > 60, key
        assert "PROPOSED_064_pahchan.sql" in m.absent, (
            f"{key}: the reason must name the unapplied migration"
        )


# ── attendance_rate ──────────────────────────────────────────────────────────

def test_attendance_rate_is_sums_over_sums_with_payrolls_own_formula():
    sql, params = build("pahchan.attendance_rate")
    assert (
        "(COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) "
        "+ 0.5 * COUNT(*) FILTER (WHERE a.status = 'half_day'))::float "
        "/ NULLIF(COUNT(*) FILTER (WHERE a.status NOT IN ('holiday', 'weekend')), 0)::float "
        "* 100 AS value"
    ) in sql
    assert "AVG(" not in sql, "the mean of per-day rates is not the period's rate"
    assert "AS attended" in sql and "AS marked" in sql
    assert "FROM staging.manav_attendance" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_attendance_rate_drops_buckets_with_no_workable_days():
    # All-holiday buckets have no denominator: dropped, never a null row.
    sql, _ = build("pahchan.attendance_rate")
    assert (
        "HAVING COUNT(*) FILTER (WHERE a.status NOT IN ('holiday', 'weekend')) > 0"
    ) in sql


def test_attendance_rate_team_cut_is_department_with_an_honest_empty_label():
    sql, _ = build("pahchan.attendance_rate", group_by="team")
    assert "COALESCE(NULLIF(e.department, ''), 'No department') AS team" in sql
    assert "JOIN staging.manav_employees e ON e.id = a.employee_id" in sql
    assert "GROUP BY 1, 2" in sql and sql.rstrip().endswith("ORDER BY 1, 2")
    # department is free text with no FK — the lookup table must not be
    # joined (the ganit_expense_categories trap).
    assert "manav_departments" not in sql
    # And the join exists ONLY for the team cut.
    plain, _ = build("pahchan.attendance_rate")
    assert "manav_employees" not in plain and "team" not in plain


# ── absenteeism ──────────────────────────────────────────────────────────────

def test_absenteeism_splits_unplanned_from_approved():
    sql, _ = build("pahchan.absenteeism")
    assert "COUNT(*) FILTER (WHERE a.status = 'absent') AS unplanned" in sql
    assert "COUNT(*) FILTER (WHERE a.status = 'on_leave') AS approved" in sql
    assert "COUNT(*) FILTER (WHERE a.status IN ('absent', 'on_leave')) AS value" in sql


def test_absenteeism_description_states_the_status_mapping():
    # The mapping is a product decision, not an implementation detail — the
    # catalogue must say it (proposal 62: descriptions carry the definition).
    d = REGISTRY["pahchan.absenteeism"].description
    assert "unplanned" in d and "'absent'" in d
    assert "approved" in d and "'on_leave'" in d


# ── hours_worked ─────────────────────────────────────────────────────────────

def test_hours_worked_sums_recorded_hours_and_drops_unrecorded_buckets():
    sql, _ = build("pahchan.hours_worked")
    assert "SUM(a.work_hours)::float AS value" in sql
    assert "SUM(COALESCE(a.overtime_hours, 0))::float AS overtime" in sql
    assert "COUNT(*) FILTER (WHERE a.work_hours IS NOT NULL) AS recorded_days" in sql
    # Marked-but-unrecorded is "no data", never "nobody worked".
    assert "HAVING SUM(a.work_hours) IS NOT NULL" in sql
    assert "AVG(" not in sql


# ── vetana_reconciliation ────────────────────────────────────────────────────

def test_reconciliation_compares_like_with_like():
    """Both sides must use payroll's own day formula (routers/vetana.py):
    present + late count 1, half_day counts 0.5, payslips sum present_days —
    so the delta isolates real gaps instead of a definitional mismatch."""
    sql, params = build("pahchan.vetana_reconciliation")
    attended = (
        "COUNT(*) FILTER (WHERE a.status IN ('present', 'late')) "
        "+ 0.5 * COUNT(*) FILTER (WHERE a.status = 'half_day')"
    )
    assert attended in sql
    # And it is the SAME expression attendance_rate scores with — one
    # definition of a day, everywhere.
    rate_sql, _ = build("pahchan.attendance_rate")
    assert attended in rate_sql
    assert "COALESCE(SUM(p.present_days), 0)::float" in sql
    assert "SELECT vetana_days - attendance_days AS value" in sql
    assert params == [ORG, WIN.start, WIN.end]


def test_reconciliation_ranges_text_months_and_honours_the_soft_delete():
    sql, _ = build("pahchan.vetana_reconciliation")
    # vetana_payslips.month is TEXT 'YYYY-MM' — ranged with text BETWEEN on
    # to_char bounds, zero-padded on both sides.
    assert (
        "p.month BETWEEN to_char($2::date, 'YYYY-MM') "
        "AND to_char($3::date, 'YYYY-MM')"
    ) in sql
    assert "p.is_active = TRUE" in sql
    assert "FROM staging.vetana_payslips p" in sql


def test_reconciliation_answers_when_either_side_has_data_and_ghosts_get_nothing():
    # Attendance with no payroll and payroll with no attendance are both
    # 100% gaps the metric exists to show; an org with neither — including
    # an org that is not yours — returns no rows, never {value: null}.
    sql, _ = build("pahchan.vetana_reconciliation")
    assert "HAVING COUNT(*) > 0 OR EXISTS (" in sql
    assert "COALESCE(SUM(att), 0)::float AS attendance_days" in sql


def test_reconciliation_is_the_same_single_row_under_every_bucket():
    # dso's precedent: the inner query honours the bucket, the outer sum of
    # sums is invariant to how the window is cut.
    for b in sorted(BUCKETS):
        sql, _ = build("pahchan.vetana_reconciliation", bucket=b)
        assert sql.startswith("SELECT vetana_days - attendance_days AS value"), b
