"""`manav.department_register` — and the two reports it deliberately is not.

Built and verified READ-ONLY against the live database on 2026-08-23. The
queries were run through `railway run` before this file existed, because a mock
pool answers any SQL and hides the ones Postgres would refuse.

Live shape at the time of writing (financial year 2025-04-01 → 2026-08-23):

    Aekam Inc              0 departments,  0 employees → 0 rows, correctly
    E2E Test & Associates 19 departments, 71 employees → 20 rows + footer + note
    Unicode Group         11 departments, 27 employees → 13 rows + footer + note

Both footers tie to the org's real headcount (71 and 27), which is the one
arithmetic property a headcount table has to have.

Rendered against fabricated rows here rather than the database, because what
can go wrong in this file is the LABELLING — a department that vanishes, a
person counted twice, a period column filed beside a state column — and none
of that needs Postgres to reproduce.
"""
import pytest

from services.report_defs import department_reports as dr


def _dept(**over):
    d = {"dept_name": "Audit", "in_dept_list": True, "has_staff": True,
         "dept_active": True, "head_name": "Meera Nair",
         "employees": 7, "active": 7, "joined_in": 1,
         "leave_days": 33.0, "leave_reqs": 17, "left_in": 1}
    d.update(over)
    return d


SPREAD = {"employees": 71, "active": 71, "no_department": 11,
          "linked_to_login": 0}


def _note(rows):
    return rows[-1][dr.DEPARTMENT]


def _body(rows):
    """Everything except the footer and the note."""
    return rows[:-2]


# ══════════════════════════════════════════════════════════════════════════
# neither side of the match may lose a row
# ══════════════════════════════════════════════════════════════════════════

def test_a_department_with_no_employees_is_listed_not_hidden():
    """14 of the 30 live department rows have no employee against them. An
    empty department is a FINDING — it is how a stale org chart shows up — and
    an inner join would have silently deleted all fourteen."""
    rows = dr.build_dept_rows([_dept(has_staff=False, employees=0, active=0,
                                     joined_in=0, leave_days=0, leave_reqs=0,
                                     left_in=0)], SPREAD)
    label = _body(rows)[0][dr.DEPARTMENT]
    assert dr.EMPTY_NOTE in label
    assert _body(rows)[0]["Employees"] == 0


def test_a_department_named_only_by_an_employee_still_prints():
    """Unicode Group's `Labour` — one employee names it, `manav_departments`
    has no row for it. Dropping the row drops a PERSON off a headcount."""
    rows = dr.build_dept_rows(
        [_dept(dept_name="Labour", in_dept_list=False, head_name="",
               employees=1, active=1)], SPREAD)
    label = _body(rows)[0][dr.DEPARTMENT]
    assert label.startswith("Labour")
    assert dr.UNLISTED_SUFFIX.strip() in label


def test_employees_with_no_department_get_their_own_line():
    """11 of 71 in the seeded org, 1 of 27 in Unicode. Folding them into a
    total makes the column stop tying to the org's headcount."""
    rows = dr.build_dept_rows(
        [_dept(dept_name="", in_dept_list=False, head_name="", employees=11,
               active=11)], SPREAD)
    assert _body(rows)[0][dr.DEPARTMENT] == dr.NOT_RECORDED


def test_the_footer_ties_to_the_headcount_the_note_states():
    """The one arithmetic property this table owes its reader."""
    rows = dr.build_dept_rows(
        [_dept(dept_name="Audit", employees=40, active=39),
         _dept(dept_name="Payroll", employees=20, active=20),
         _dept(dept_name="", in_dept_list=False, employees=11, active=11)],
        SPREAD)
    footer = rows[-2]
    assert footer[dr.DEPARTMENT] == "All departments"
    assert footer["Employees"] == 71 == SPREAD["employees"]
    assert footer["Head"] == dr.BLANK, "a name in a footer reads as a person"


def test_an_org_with_no_departments_returns_no_rows_at_all():
    """Aekam Inc, live: 0 and 0. `render_report_html` prints 'No rows for this
    period', which is true. A lone row of zeros would read as a firm that
    recorded nothing, which is a different and worse sentence."""
    assert dr.build_dept_rows([], {"employees": 0, "active": 0,
                                   "no_department": 0,
                                   "linked_to_login": 0}) == []


# ══════════════════════════════════════════════════════════════════════════
# every figure states what it counts and over what window
# ══════════════════════════════════════════════════════════════════════════

def test_the_note_separates_the_state_columns_from_the_period_columns():
    """The standing rule for this whole surface: `/reports` once printed
    lifetime totals under a weekly heading. Four of this table's six count
    columns are windowed and two are facts about today, and the row that says
    which sits INSIDE the table, where a CSV export carries it."""
    note = _note(dr.build_dept_rows([_dept()], SPREAD))
    assert "facts about TODAY" in note
    assert "Joined in period" in note and "Leave days taken" in note
    assert "Employees, Active and the head name" in note


def test_the_note_says_leave_is_days_and_not_requests():
    """Counting requests instead of days is a live defect elsewhere in this
    product — 151 requests against 292 actual days, feeding a pro-rata salary
    calculation. This section does not repeat it and says so."""
    note = _note(dr.build_dept_rows([_dept()], SPREAD))
    assert "in DAYS" in note and "not in" in note
    assert "'days'" in dr.DEPT_SQL or "SUM(l.days)" in dr.DEPT_SQL


def test_the_note_says_why_there_is_no_work_column():
    """96 of 98 employee records carry no `user_id`, so tasks, approvals and
    time cannot be rolled up by department. The absence has to be EXPLAINED on
    the page — otherwise a reader takes a headcount table for a performance
    table and finds the performance columns missing rather than impossible."""
    note = _note(dr.build_dept_rows([_dept()], SPREAD))
    assert "NO WORK COLUMNS APPEAR HERE" in note
    assert "not linked to a login" in note
    assert "71" in note  # the unlinked count, from the spread


def test_the_note_is_true_when_every_record_is_linked():
    """A note row that can print a false sentence is worse than no note row."""
    note = _note(dr.build_dept_rows(
        [_dept()], {"employees": 10, "active": 10, "no_department": 0,
                    "linked_to_login": 10}))
    assert "NO WORK COLUMNS APPEAR HERE" not in note
    assert "Every employee record is linked" in note
    assert "every one of them carries a department" in note


@pytest.mark.parametrize("n,verb", [(1, "carries"), (2, "carry")])
def test_the_note_agrees_with_itself_grammatically(n, verb):
    """This sentence prints on a document a firm sends out."""
    note = _note(dr.build_dept_rows(
        [_dept()], {"employees": 10, "active": 10, "no_department": n,
                    "linked_to_login": 10}))
    assert f"of them {verb} no department" in note


def test_nothing_is_sorted_by_a_metric():
    """`work_reports.py`'s rule, and here there is not even a work column to
    rank on. A department at the top of a list sorted by leave days reads as an
    accusation."""
    assert "ORDER BY COALESCE(d.dept_name, s.dept_name, '')" in dr.DEPT_SQL
    for metric in ("ORDER BY leave", "ORDER BY employees", "DESC"):
        assert metric not in dr.DEPT_SQL
    note = _note(dr.build_dept_rows([_dept()], SPREAD))
    assert "does not rank" in note


# ══════════════════════════════════════════════════════════════════════════
# the query's own discipline
# ══════════════════════════════════════════════════════════════════════════

def test_every_table_is_schema_qualified_and_every_parameter_is_cast():
    """A shadow table has bitten this repo (migration 142), and PgBouncer turns
    an untyped parse error into an instant 500 (the credits incident)."""
    for sql in (dr.DEPT_SQL, dr.DEPT_SPREAD_SQL):
        assert "public.manav_" in sql
        assert " manav_departments" not in sql.replace("public.manav_departments", "")
        assert "$1::uuid" in sql
    assert "$2::date" in dr.DEPT_SQL and "$3::date" in dr.DEPT_SQL
    assert "$4::int" in dr.DEPT_SQL


def test_both_halves_of_the_join_are_scoped_to_the_org():
    """The join key is a free-text NAME. Unscoped, two firms' `Audit`
    departments merge into one line — the graha_clients id-only join fault
    wearing a different hat."""
    assert dr.DEPT_SQL.count("$1::uuid") >= 2
    assert "h.org_id = d.org_id" in dr.DEPT_SQL
    assert "l.org_id = e.org_id" in dr.DEPT_SQL
    assert "o.org_id = e.org_id" in dr.DEPT_SQL


def test_no_uuid_is_ever_selected():
    """Names, not ids — `head_employee_id` is resolved to a name inside the
    query and never leaves it (decision_names_not_ids)."""
    # The OUTER select list — the columns that actually leave the query.
    # `head_employee_id` appears inside the CTE, where it is resolved to a
    # name; what must never appear is an id in the projection.
    outer = dr.DEPT_SQL.rsplit("SELECT COALESCE(d.dept_name", 1)[-1]
    outer = outer.split("  FROM depts d ")[0]
    assert "head_employee_id" not in outer
    assert "_id" not in outer.replace("in_dept_list", "")
    for row in dr.build_dept_rows([_dept()], SPREAD):
        for value in row.values():
            assert "-" not in str(value) or len(str(value)) != 36


def test_the_section_declares_manav_and_only_manav():
    """No vetana column and no pahchan column. `reads` cannot express 'the
    reader holds both grants for different reasons', so a page spanning them
    collapses two entitlements into one — and attendance is biometric data
    under the DPDP notice."""
    from services.report_defs import REPORT_DEFS, load_all
    load_all()
    d = REPORT_DEFS[dr.DEPT_KEY]
    assert d.reads == frozenset({"manav"})
    assert d.grain == "flow"
    assert "vetana" not in dr.DEPT_SQL and "pahchan" not in dr.DEPT_SQL
    assert "payslip" not in dr.DEPT_SQL and "attendance" not in dr.DEPT_SQL


def test_the_description_names_the_limitation_rather_than_hiding_it():
    from services.report_defs import REPORT_DEFS, load_all
    load_all()
    desc = REPORT_DEFS[dr.DEPT_KEY].description
    assert "NOT PERFORMANCE" in desc
    assert "96 of 98" in desc
    assert "8 of 30" in desc


def test_a_flow_section_handed_no_window_raises_rather_than_inventing_one():
    """`grain='flow'` is a contract with `report_section`. The two answers
    worse than raising are inventing a period and returning no rows, and
    neither is visible to the reader."""
    import asyncio
    with pytest.raises(ValueError, match="window"):
        asyncio.run(dr.department_register(None, "org", None))
