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
        "pahchan.late_arrivals": ("flow", "count", ("team",)),
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


def test_absent_reasons_may_not_rest_on_an_applied_migration():
    """This test used to REQUIRE every absence reason to name
    PROPOSED_064_pahchan.sql — and so it pinned a stale fact in place for a
    release. The tables that migration declares are applied: a READ ONLY probe
    of the live database on 2026-08-25 found staging.pahchan_punches (699
    rows, with lat, lng, distance_m, geofence_id and flags all populated on
    every row), staging.pahchan_sites (9) and staging.pahchan_policy (2).

    So the assertion is inverted. Three metrics have now moved out of the
    absent set and compute; the ONE that remains is blocked by a missing WRITE
    — no shift is stamped on any attendance or punch row — which no migration
    in the ledger closes. No pahchan absence may lean on that migration
    again."""
    # late_arrivals LEFT this set on 2026-09-07 — see its own tests below.
    # Its reason was not a schema gap and not the DPDP boundary either: it
    # claimed an arrival needed per-person grouping to isolate, which is true
    # of pahchan_punches and false of manav_attendance, where the write path
    # has already collapsed a person-day into one row carrying check_in.
    assert ABSENT_KEYS == ["pahchan.attendance_by_shift"]
    for key in ABSENT_KEYS:
        m = REGISTRY[key]
        assert m.sql is None
        assert len(m.absent) > 60, key
        assert "PROPOSED_064" not in m.absent, (
            f"{key}: those tables are live — this reason is stale"
        )
        assert "not applied" not in m.absent, (
            f"{key}: an absence may not be justified by an unapplied migration"
        )


def test_absent_reasons_may_not_rest_on_a_row_count():
    """A row count is a MEASUREMENT WITH A DATE, not a fact about the schema.

    The attendance_by_shift reason carried "(027, 12 rows live)" about
    manav_shift_definitions. Re-measured 2026-09-07: that table holds **0** —
    migration 260 cleared every non-Aekam row — so the reason was arguing from
    a number that had been false for a week. It happened to reach the right
    conclusion, which is exactly why nobody caught it.

    The sibling test above stops an absence going stale on MIGRATION grounds.
    This one stops it going stale on DATA grounds. An absence must rest on the
    shape of the schema — a column that does not exist, a boundary that
    forbids a join — never on how many rows something happens to hold today,
    because that is the one part of the claim that changes without anybody
    editing this file.
    """
    for key in ABSENT_KEYS:
        m = REGISTRY[key]
        hit = re.search(r"\b\d+\s+rows?\b", m.absent)
        assert hit is None, (
            f"{key}: absence cites a row count ({hit.group(0)!r}) — "
            "re-measure it or state the structural reason instead"
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
    assert "FROM public.manav_attendance" in sql
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
    assert "JOIN public.manav_employees e ON e.id = a.employee_id" in sql
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
    assert "FROM public.vetana_payslips p" in sql


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


# ── late_arrivals ────────────────────────────────────────────────────────────
# Absent until 2026-09-07 on a reason that was simply wrong: "an arrival is the
# first 'in' punch of a person's day, and isolating it needs a per-person
# grouping that the DPDP boundary forbids outright". True of pahchan_punches,
# false of manav_attendance — `services/attendance_bridge.py` has already
# collapsed a person-day to ONE row (idx_manav_attendance_unique on
# (employee_id, date)) and `check_in` on that row IS the arrival. The
# per-person grouping happened in the write path, hours before analytics.
#
# The boundary itself is untouched and is still pinned by the DPDP test above,
# which runs over every metric including this one.

def test_late_arrivals_reads_the_paired_arrival_not_raw_punches():
    """The whole reason this metric can exist. Reading pahchan_punches would
    score three punches as three late arrivals; manav_attendance.check_in is
    one arrival per person per day because the bridge made it so."""
    sql, _ = build("pahchan.late_arrivals")
    assert "FROM public.manav_attendance a" in sql
    assert "pahchan_punches" not in sql
    assert "a.check_in" in sql
    # No window function, no per-person partition — the collapse is upstream.
    assert "PARTITION BY" not in sql
    assert "ROW_NUMBER" not in sql


def test_late_arrivals_compares_in_ist_against_shift_plus_grace():
    sql, _ = build("pahchan.late_arrivals")
    assert "(a.check_in AT TIME ZONE 'Asia/Kolkata')::time" in sql
    assert "pol.shift_start_time + make_interval(mins => COALESCE(pol.grace_minutes, 0))" in sql
    # Strictly greater: an arrival exactly on the grace boundary is on time.
    assert ">" in sql and "<=" in sql


def test_late_arrivals_counts_only_days_somebody_arrived():
    """A holiday, a leave day or a no-show has no check_in. It is not a late
    arrival and it is not an on-time one either, so it leaves the denominator
    — this metric is punctuality among people who came in, not attendance."""
    sql, _ = build("pahchan.late_arrivals")
    assert "AND a.check_in IS NOT NULL" in sql


def test_late_arrivals_refuses_an_org_with_no_shift_and_refuses_overnight():
    """Two stated exclusions, both of which must be in the SQL rather than in
    the description. Without a shift there is no threshold, and shipping 0
    would be a convincing zero; an overnight shift cannot be judged by a
    wall-clock comparison at all."""
    sql, _ = build("pahchan.late_arrivals")
    assert "JOIN public.pahchan_policy pol ON pol.org_id = a.org_id" in sql
    assert "AND pol.shift_start_time IS NOT NULL" in sql
    assert "AND NOT COALESCE(pol.overnight_shift, false)" in sql


def test_late_arrivals_ships_the_pair_and_a_null_worst_when_nobody_was_late():
    """value alone is unreadable — 3 late is different in a team of 4 and a
    team of 400 — so on_time and arrivals ride with it. worst_minutes_late is
    FILTERed so a bucket with nobody late gets NULL, not 0: "nobody was late"
    and "the worst offender was bang on the threshold" are different facts."""
    sql, _ = build("pahchan.late_arrivals")
    assert "AS value" in sql
    assert "AS on_time" in sql
    assert "COUNT(*) AS arrivals" in sql
    assert "AS worst_minutes_late" in sql
    worst = sql[sql.index("MAX(EXTRACT(EPOCH"):sql.index("AS worst_minutes_late")]
    assert "FILTER (WHERE" in worst, "an unfiltered MAX reports 0 for a clean bucket"


def test_late_arrivals_cuts_by_team_positionally():
    sql, _ = build("pahchan.late_arrivals", group_by="team")
    assert "COALESCE(NULLIF(e.department, ''), 'No department') AS team" in sql
    assert "GROUP BY 1, 2" in sql
    # And the DPDP join is the only employee_id in it — the module-wide pin
    # asserts this too, restated here so this metric's own file is complete.
    assert sql.count("employee_id") == 1
    assert "JOIN public.manav_employees e ON e.id = a.employee_id" in sql


def test_late_arrivals_has_no_drill_and_no_person_dimension():
    m = REGISTRY["pahchan.late_arrivals"]
    assert m.drill is None
    assert m.dimensions == ("team",)
    assert "employee" not in m.dimensions and "person" not in m.dimensions
