"""Departments — one line per department, and the two questions it cannot answer.

Every figure quoted below was measured READ-ONLY against the live database on
2026-08-22 and re-verified on 2026-08-23.

WHY THIS IS AN HR REPORT AND NOT A PERFORMANCE REPORT
─────────────────────────────────────────────────────
The request was "department and employee performance". The employee half
already exists — `core.work_by_person` in `work_reports.py`, one line per
person over tasks, approvals, follow-ups and activities, alphabetical, with its
denominators beside its numerators. The obvious next step is to roll those same
columns up by department, and THE DATABASE CANNOT DO IT.

`staging.manav_employees.user_id` is NULL on 96 of 98 rows. `work_by_person`
keys on `public.users.user_id`; a department keys on `manav_employees`. The
join between the two populations is that column, and it is empty:

    98 personnel files — 1,659 punches, 242 leave requests, 1,095 payslips
    32 logins         — tasks, time, deals, approvals
    2 rows link them

So "tasks closed by the Audit department" is not a hard query, it is an
UNANSWERABLE one, for 96 of 98 people. Rolling a per-person task count up by
department would therefore produce a table in which almost every department
reads zero — which is not a small error, it is a table that says the Audit
department did no work. There is no version of that worth printing.

What a department CAN honestly report is what `manav` records against the
employee row itself: who is in it, who leads it, what leave it took, and who
left. That is this section. The column list is short on purpose and the
description says out loud what is missing and why, so nobody reads the absence
of a work column as the absence of work.

The linking feature is fully built — the endpoint, its migration and its test
all ship. Nobody has ever pressed the button. When those 96 rows are filled,
the work columns become a two-hour change here and not before.

THE FIVE FACTS THIS SECTION IS BUILT ON
───────────────────────────────────────
1. THE LINK IS A TEXT COLUMN, NOT A FOREIGN KEY.
   `manav_employees.department` is `text`; `manav_departments` has `id`, `name`,
   `head_employee_id`, `is_active` and no code column. Nothing constrains the
   two to agree. Matched case-insensitively on the trimmed name, within the
   org — 60 of 60 in the seeded org, 25 of 26 in Unicode Group.

2. BOTH SIDES OF THAT MATCH CAN MISS, AND BOTH MISSES ARE PRINTED.
   · 14 department rows have no employee at all (11 seeded `E2E Advisory …`
     rows plus 3 inactive Unicode ones). They print with a headcount of zero
     rather than disappearing, because "this department is empty" is a finding.
   · 1 employee names a department — Unicode's `Labour` — that has no row in
     `manav_departments`. It prints on its own line, marked, rather than being
     dropped into a total nobody can reconcile. A FULL OUTER JOIN, for exactly
     this reason: an inner join loses a person, and losing a person off a
     headcount is the one thing this table must not do.
   · Employees with no department text at all (11 of 71 in the seeded org,
     1 of 27 in Unicode) go to a `NOT RECORDED` line. Same rule.

3. AEKAM INC HAS NO DEPARTMENTS AND NO EMPLOYEES — 0 and 0.
   The section returns an empty list there and `render_report_html` prints
   "No rows for this period", which is true. It is not evidence of a fault.

4. ONLY 8 OF 30 DEPARTMENTS NAME A HEAD, and all 8 are in one org. The column
   prints blank, never "Unassigned" — a report that invents a word for an empty
   cell teaches its reader that the cell means something.

5. LEAVE IS COUNTED IN DAYS, NOT IN REQUESTS.
   `manav_leave_requests.days` is a numeric and it is the column. Counting
   requests instead is a live defect elsewhere in this product — 151 requests
   against 292 actual days, so every multi-day leave was under-credited by
   roughly half, and it fed a pro-rata salary calculation. This section does
   not repeat it.

WHAT IS NOT HERE, AND WHY
─────────────────────────
No salary, no payslip and no attendance. Attendance is biometric data under the
DPDP notice and folding it into a report gated on `manav` alone would launder
it past a gate that never sees it. Pay is a `vetana` fact; `reads` cannot
express "the reader holds both grants for different reasons", so a page
spanning them is a page that collapses two entitlements into one.

No ranking, no score and no per-head productivity ratio — the same rule
`work_reports.py` holds, for the same reason, and here there is not even a work
column to rank on.

AND NO CLIENT PROFITABILITY. It was asked for and it is not buildable. Cost
attribution to a client is 0% by EVERY route that exists: 0 of 289 time entries
(tasks carry no client key at all), 0 of 11 users (no employee rate is
reachable, because of the same NULL `user_id` above), 0 of 378 expenses, 0 of
189 vendor bills. Rs41.3m of recorded cost and Rs106.4m of payroll, Rs0 of it
attributable to any client. A margin column over a zero cost denominator renders
every client at 100% margin — a claim nobody made and the single most quotable
wrong number the product could emit. `frontend/src/pages/ReportsPage.jsx` says
so on the screen where somebody would look for it, rather than this shipping as
an empty report.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import BLANK, ROW_CAP, window_or_raise

DEPT_KEY = "manav.department_register"

#: The name column. The footer's label and the note row both sit here — never
#: in a count column, where a spreadsheet would try to parse the word.
DEPARTMENT = "Department"

#: The row for employees whose `department` text is empty. Not a department and
#: not a rounding error: it is people the org has filed under nothing.
NOT_RECORDED = "NOT RECORDED — no department on the employee record"

#: The suffix on a department name that exists only on employee records. The
#: name is still printed, because the reader knows what "Labour" is even though
#: `manav_departments` does not.
UNLISTED_SUFFIX = " (not in the department list)"

#: The label on a department row that no employee names.
EMPTY_NOTE = "no employees"

#: The count columns, in print order. The footer sums exactly these.
DEPT_COUNTS = ("Employees", "Active", "Joined in period",
               "Leave days taken", "Leave requests", "Left in period")

#: One row per department, by FULL OUTER JOIN of two aggregates.
#:
#: Two sides, because both can miss. `depts` is every department row the org
#: holds; `staff` is every distinct department NAME its employees claim. The
#: join is on the case-folded, trimmed name — the only key the two share, since
#: `manav_employees.department` is free text with no constraint on it.
#:
#: `$1::uuid` on both halves, and the join is inside the org on both sides: a
#: name-based join across orgs would merge two firms' "Audit" departments into
#: one line, which is the graha_clients id-only join fault wearing a different
#: hat.
DEPT_SQL = (
    "WITH depts AS ("
    "  SELECT lower(btrim(d.name)) AS mkey, "
    "         min(btrim(d.name)) AS dept_name, "
    "         bool_or(d.is_active) AS dept_active, "
    # The head, by NAME. `head_employee_id` is a uuid and never leaves this
    # query — names, not ids, on anything printed.
    "         min(COALESCE(btrim(h.name), '')) AS head_name "
    "    FROM public.manav_departments d "
    "    LEFT JOIN public.manav_employees h "
    "           ON h.id = d.head_employee_id AND h.org_id = d.org_id "
    "   WHERE d.org_id = $1::uuid "
    "   GROUP BY 1"
    "), "
    "staff AS ("
    "  SELECT lower(btrim(COALESCE(e.department, ''))) AS mkey, "
    "         min(btrim(COALESCE(e.department, ''))) AS dept_name, "
    "         COUNT(*)::int AS employees, "
    "         COUNT(*) FILTER (WHERE e.is_active)::int AS active, "
    # A FLOW column: who joined inside the window.
    "         COUNT(*) FILTER (WHERE e.date_of_joining "
    "                 BETWEEN $2::date AND $3::date)::int AS joined_in, "
    # Leave, in DAYS. Approved only — a pending request is a request, not
    # leave taken, and counting it would inflate every department that simply
    # has a slow approver.
    "         COALESCE(SUM(lv.days), 0)::numeric(12,1) AS leave_days, "
    "         COALESCE(SUM(lv.reqs), 0)::int AS leave_reqs, "
    "         COUNT(*) FILTER (WHERE ex.employee_id IS NOT NULL)::int AS left_in "
    "    FROM public.manav_employees e "
    "    LEFT JOIN LATERAL ("
    "        SELECT COALESCE(SUM(l.days), 0) AS days, COUNT(*) AS reqs "
    "          FROM public.manav_leave_requests l "
    "         WHERE l.employee_id = e.id AND l.org_id = e.org_id "
    "           AND lower(COALESCE(l.status, '')) = 'approved' "
    "           AND l.start_date BETWEEN $2::date AND $3::date"
    "    ) lv ON TRUE "
    "    LEFT JOIN LATERAL ("
    "        SELECT 1 AS employee_id FROM public.manav_offboarding o "
    "         WHERE o.employee_id = e.id AND o.org_id = e.org_id "
    "           AND o.last_working_day BETWEEN $2::date AND $3::date "
    "         LIMIT 1"
    "    ) ex ON TRUE "
    "   WHERE e.org_id = $1::uuid "
    "   GROUP BY 1"
    ") "
    "SELECT COALESCE(d.dept_name, s.dept_name, '') AS dept_name, "
    "       (d.mkey IS NOT NULL) AS in_dept_list, "
    "       (s.mkey IS NOT NULL) AS has_staff, "
    "       COALESCE(d.dept_active, TRUE) AS dept_active, "
    "       COALESCE(d.head_name, '') AS head_name, "
    "       COALESCE(s.employees, 0) AS employees, "
    "       COALESCE(s.active, 0) AS active, "
    "       COALESCE(s.joined_in, 0) AS joined_in, "
    "       COALESCE(s.leave_days, 0) AS leave_days, "
    "       COALESCE(s.leave_reqs, 0) AS leave_reqs, "
    "       COALESCE(s.left_in, 0) AS left_in "
    "  FROM depts d "
    "  FULL OUTER JOIN staff s ON s.mkey = d.mkey "
    # ALPHABETICAL. Never by headcount and never by leave — see the module
    # docstring. A department at the top of a list sorted by leave days reads
    # as an accusation.
    " ORDER BY COALESCE(d.dept_name, s.dept_name, '') "
    " LIMIT $4::int"
)

#: The org's own totals for the same window, so the note row can state what the
#: table does NOT cover. Without it a reader who adds the Employees column and
#: gets fewer than the org's headcount has no way to find the difference.
DEPT_SPREAD_SQL = (
    "SELECT COUNT(*)::int AS employees, "
    "       COUNT(*) FILTER (WHERE e.is_active)::int AS active, "
    "       COUNT(*) FILTER (WHERE COALESCE(btrim(e.department), '') = '')::int "
    "           AS no_department, "
    "       COUNT(*) FILTER (WHERE COALESCE(btrim(e.user_id), '') <> '')::int "
    "           AS linked_to_login "
    "  FROM public.manav_employees e WHERE e.org_id = $1::uuid"
)


def _label(row: dict) -> str:
    """The department's name, plus whichever caveat applies to it.

    Three cases and each says which it is on the row itself, because the
    alternative is a footnote under a table somebody screenshots without it.
    """
    name = str(row.get("dept_name") or "").strip()
    if not name:
        return NOT_RECORDED
    if not row.get("in_dept_list"):
        return name + UNLISTED_SUFFIX
    if not row.get("has_staff"):
        return f"{name} ({EMPTY_NOTE})"
    if not row.get("dept_active"):
        return f"{name} (closed)"
    return name


def _count_footer(rows: list, columns: tuple, label: str) -> dict:
    """Every count column summed, every other column blank.

    Not `_shared.total_row`: that helper rounds to two decimals for money and
    would print `12.0` where a reader expects `12`. Leave days ARE fractional
    (half-days are recorded), so that one column keeps a single decimal.
    """
    out: dict = {}
    for key in (rows[0].keys() if rows else ()):
        if key not in columns:
            out[key] = label if key == DEPARTMENT else BLANK
        elif key == "Leave days taken":
            out[key] = round(sum(float(r.get(key) or 0) for r in rows), 1)
        else:
            out[key] = sum(int(r.get(key) or 0) for r in rows)
    return out


def spread_note(rows: list, spread: dict) -> dict:
    """The row that says what this table does not know, inside the table.

    Next to the numbers it qualifies, in the same place `work_reports` and
    `_shared.overflow_row` put theirs — not in a description that a CSV export
    drops on the floor.
    """
    employees = int(spread.get("employees") or 0)
    active = int(spread.get("active") or 0)
    no_dept = int(spread.get("no_department") or 0)
    linked = int(spread.get("linked_to_login") or 0)
    unlinked = employees - linked

    # "1 of them carry" is the sentence a plural-only template writes, and this
    # note prints on a document a firm sends out.
    dept_clause = (
        f"{no_dept:,} of them {'carries' if no_dept == 1 else 'carry'} no "
        f"department on their record and {'sits' if no_dept == 1 else 'sit'} "
        f"on the '{NOT_RECORDED}' line" if no_dept else
        "every one of them carries a department on their record")
    # Written for the fully-linked case too. A note row that can print a false
    # sentence is worse than no note row.
    link_clause = (
        f"NO WORK COLUMNS APPEAR HERE because {unlinked:,} of the {employees:,} "
        f"employee records are not linked to a login, and tasks, approvals and "
        f"time are recorded against logins. That is data entry, not a "
        f"measurement limit — see 'Work by person' for what the linked "
        f"population did" if unlinked else
        "Every employee record is linked to a login, so per-person work "
        "figures are available in 'Work by person'")
    note = (
        f"This org holds {employees:,} employee records, {active:,} of them "
        f"active; {dept_clause}. Employees, Active and the head name are "
        f"facts about TODAY, not about the period — only 'Joined in period', "
        f"'Leave days taken', 'Leave requests' and 'Left in period' are "
        f"windowed. Leave is counted in DAYS from approved requests, not in "
        f"requests. {link_clause}. A department with no employees is listed "
        f"rather than hidden, and a department named only on an employee "
        f"record is marked '{UNLISTED_SUFFIX.strip()}'. Rows are "
        f"alphabetical; this page does not rank anything."
    )
    return {key: (note if key == DEPARTMENT else BLANK)
            for key in (rows[0].keys() if rows else ())}


def build_dept_rows(depts: list, spread: dict) -> list:
    """The table. Pure, so the footer, the labelling and the note are all
    testable without a database."""
    rows = [{
        DEPARTMENT: _label(d),
        "Head": str(d.get("head_name") or BLANK),
        # STOCK columns first — who is in it now.
        "Employees": int(d.get("employees") or 0),
        "Active": int(d.get("active") or 0),
        # FLOW columns — what happened in the window.
        "Joined in period": int(d.get("joined_in") or 0),
        "Leave days taken": round(float(d.get("leave_days") or 0), 1),
        "Leave requests": int(d.get("leave_reqs") or 0),
        "Left in period": int(d.get("left_in") or 0),
    } for d in depts]
    if not rows:
        # An org with no departments and no employees — Aekam Inc today —
        # gets "No rows for this period" from the renderer, which is true. A
        # lone row of zeros would read as a firm that recorded nothing.
        return []
    out = [*rows, _count_footer(rows, DEPT_COUNTS, "All departments")]
    out.append(spread_note(out, spread))
    return out


@report_def(
    key=DEPT_KEY,
    module="manav",
    # `manav` alone. Every table read here is a manav table: departments,
    # employees, leave requests, offboarding. No vetana column and no pahchan
    # column, deliberately — see the module docstring.
    reads=frozenset({"manav"}),
    label="Department register",
    grain="flow",
    sensitivity="operational",
    description=(
        "One line per department, ALPHABETICAL BY NAME — no rank, no position "
        "column and nothing sorted by a metric. 'Employees', 'Active' and the "
        "head name are facts about TODAY; 'Joined in period', 'Leave days "
        "taken', 'Leave requests' and 'Left in period' are windowed, and the "
        "note row inside the table says which is which. Leave is counted in "
        "DAYS from APPROVED requests, never in requests — counting requests "
        "under-credits every multi-day leave by roughly half. A department "
        "with no employees is listed with a headcount of zero rather than "
        "hidden, a department named only on an employee record is marked, and "
        "employees with no department at all get their own line. "
        "LIMITATIONS: this reports HEADCOUNT AND LEAVE, NOT PERFORMANCE. "
        "There is no tasks-closed column and there cannot be one — "
        "manav_employees.user_id is NULL on 96 of 98 rows, so almost no "
        "employee record can be joined to the login that carries their tasks, "
        "approvals and time. Rolling work up by department would print zero "
        "against departments that did the work. Only 8 of 30 departments name "
        "a head, and the column is blank where none is named rather than "
        "guessing. The department link is free text with no foreign key, so "
        "it is matched on the trimmed name inside the org; 60 of 60 employee "
        "records match in the seeded org and 25 of 26 in the one real org "
        "that uses departments. No salary, no payslip and no attendance: pay "
        "is a vetana grant and attendance is biometric data under the DPDP "
        "notice, and this section is gated on manav alone."
    ),
)
async def department_register(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, DEPT_KEY)
    # ROW_CAP as a runaway guard only, and no `capped()` call: these rows are
    # one per DEPARTMENT, so the ceiling is the shape of the org chart. The
    # largest org holds 19 today.
    depts = await pool.fetch(DEPT_SQL, str(org_id), win.start, win.end, ROW_CAP)
    spread = await pool.fetchrow(DEPT_SPREAD_SQL, str(org_id))
    return build_dept_rows([dict(d) for d in depts],
                           dict(spread) if spread else {})
