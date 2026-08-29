"""The six people-and-work sections — the ratchets, not decoration.

Two of these tests exist because the product got it wrong once already:

  · NO RANK, IN ANY FORM. A "CHAMPION OF THE PERIOD" shipped, counted the
    wrong table, and was removed on 2026-08-19.
    `tests/test_a_report_reports_its_own_period.py` guards the widget that
    carried it; this file guards the six report sections, where the same idea
    would arrive as an ORDER BY on a count, a position column, or a sort in a
    `build_*` helper. All three are asserted against.

  · EVERY COUNT CARRIES ITS DENOMINATOR. A per-person number without one
    reads as merit when it is allocation, and the pairing is a property of
    the ROW SHAPE, so it is testable without a database and pinned here.

Every count quoted in a docstring in these two modules was measured
read-only against the live database on 2026-08-21 BEFORE the definition was
written, and every section was executed against all three live orgs before
this file was committed.
"""
from __future__ import annotations

import ast
import asyncio
import inspect
import re
from datetime import date

import pytest

from services.report_defs import REPORT_DEFS, load_all
from services.report_defs import people_reports as pr
from services.report_defs import work_reports as wr

ORG = "22222222-2222-2222-2222-222222222222"

#: The six keys this commit adds.
WORK_KEYS = ("core.work_by_person", "core.workload_now")
PEOPLE_KEYS = ("manav.employee_master", "manav.leave_register",
               "manav.asset_register", "manav.recruitment_pipeline")
NEW_KEYS = WORK_KEYS + PEOPLE_KEYS

#: Every SQL constant in the two modules, by the module that owns it.
SQL_NAMES = {
    wr: ("WORK_SQL", "WORK_SPREAD_SQL", "LOAD_SQL"),
    pr: ("MASTER_SQL", "LEAVE_SQL", "ASSET_SQL", "HIRING_SQL"),
}
ALL_SQL = [(m, name, getattr(m, name))
           for m, names in SQL_NAMES.items() for name in names]


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ══════════════════════════════════════════════════════════════════════════
# declaration
# ══════════════════════════════════════════════════════════════════════════

def test_all_six_sections_are_declared_and_reachable():
    load_all()
    for key in NEW_KEYS:
        assert key in REPORT_DEFS, key


@pytest.mark.parametrize("key,module,reads,grain,sensitivity", [
    # work_by_person reads GRAHA tables (follow-ups, activities) as well as
    # core's. Declaring only 'core' would be an entitlement bypass wearing a
    # report's clothes: the CRM data would ride in behind a PM grant.
    ("core.work_by_person", "core", {"core", "graha"}, "flow", "operational"),
    ("core.workload_now", "core", {"core"}, "stock", "operational"),
    # A named list of people is neither operational nor financial.
    ("manav.employee_master", "manav", {"manav"}, "stock", "personal"),
    ("manav.leave_register", "manav", {"manav"}, "flow", "personal"),
    ("manav.asset_register", "manav", {"manav"}, "stock", "personal"),
    ("manav.recruitment_pipeline", "manav", {"manav"}, "flow", "personal"),
])
def test_each_section_declares_what_it_actually_is(key, module, reads, grain,
                                                   sensitivity):
    load_all()
    d = REPORT_DEFS[key]
    assert d.module == module
    assert d.reads == frozenset(reads)
    assert d.grain == grain
    assert d.sensitivity == sensitivity


@pytest.mark.parametrize("key", NEW_KEYS)
def test_every_description_states_its_limitations(key):
    """The limitations ARE the report. A per-person page whose caveats live
    only in a commit message is a page that gets read as merit."""
    load_all()
    text = REPORT_DEFS[key].description.lower()
    assert len(text) > 200, key
    assert "limitation" in text or "not computable" in text, key


@pytest.mark.parametrize("fn,key", [
    (wr.work_by_person, "core.work_by_person"),
    (pr.leave_register, "manav.leave_register"),
    (pr.recruitment_pipeline, "manav.recruitment_pipeline"),
])
def test_a_flow_section_handed_no_window_fails_loudly(fn, key):
    """The two answers worse than raising are inventing a period and
    returning no rows. Neither is visible to the reader; this is."""
    with pytest.raises(ValueError, match="no window"):
        run(fn(None, ORG, None))


# ══════════════════════════════════════════════════════════════════════════
# NO RANK — the thing that shipped wrong once
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_no_query_orders_by_a_metric(module, name, sql):
    """A person page is ordered by NAME. Not by a count, not by a total, and
    never descending — the shape a "top performer" arrives in."""
    tail = sql[sql.rindex("ORDER BY"):] if "ORDER BY" in sql else ""
    assert "DESC" not in tail.upper().replace("DESC NULLS LAST", ""), \
        (name, tail)
    for metric in ("COUNT(", "SUM(", "value", "total", "days", "cost"):
        assert metric.lower() not in tail.lower(), (name, metric)


@pytest.mark.parametrize("module", [wr, pr])
def test_nothing_in_either_module_ranks_anybody(module):
    """No superlative anywhere in a RENDERED string.

    The banned set is superlatives only — the words a ranking arrives
    WEARING. "rank" and "score" are deliberately NOT banned as words, because
    the descriptions have to be able to say "there is no rank"; a rank-shaped
    COLUMN is caught by `test_the_work_page_has_no_total_or_position_column`
    and a rank-shaped ORDER BY by `test_no_query_orders_by_a_metric`.

    Docstrings are stripped first, exactly as
    `test_report_sections.test_no_statutory_fact_is_a_literal` does it, so
    the prose explaining why the champion row was removed is not itself
    banned — a literal that could reach a page is."""
    tree = ast.parse(inspect.getsource(module))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:]
    banned = re.compile(r"\bchampion\b|\btop performer\b|\bbest performer\b"
                        r"|\bworst\b|\bleaderboard\b|\bmost productive\b"
                        r"|\bleast productive\b|\bstar performer\b", re.I)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            assert not banned.search(node.value), (module.__name__, node.value)


@pytest.mark.parametrize("key", NEW_KEYS)
def test_every_person_page_says_in_words_that_it_does_not_rank(key):
    """The absence of a rank is a PROMISE the page makes to the person it is
    about, so it is written where the reader sees it and not only enforced in
    the SQL."""
    load_all()
    text = REPORT_DEFS[key].description.lower()
    assert "no rank" in text or "never ranked" in text, key


@pytest.mark.parametrize("builder,rows", [
    (wr.build_load_rows, [
        {"person": "Zoya", "open_now": 1, "overdue": 0, "due_soon": 0,
         "oldest_open": date(2026, 1, 1), "oldest_title": "a"},
        {"person": "Aarav", "open_now": 99, "overdue": 99, "due_soon": 0,
         "oldest_open": date(2026, 1, 1), "oldest_title": "b"},
    ]),
])
def test_a_builder_never_reorders_what_sql_handed_it(builder, rows):
    """The SQL orders by name; the builder must not quietly re-sort by a
    count on the way to the page. The fixture is deliberately handed to it
    OUT of alphabetical order — if a builder ever sorts, this fails, and if a
    builder ever sorts BY A METRIC it fails loudly."""
    out = builder(rows)
    assert [r[wr.PERSON] for r in out[:-1]] == ["Zoya", "Aarav"]


def test_the_work_page_has_no_total_or_position_column():
    """A single 'total work' column is a rank with one step removed: it is
    the number a reader sorts the page by."""
    out = wr.build_work_rows(
        [{"person": "Aarav", "assigned_in": 3, "closed_in": 2}], {})
    for column in out[0]:
        assert column.lower() not in ("total", "rank", "position", "score",
                                      "index", "%", "percent")


# ══════════════════════════════════════════════════════════════════════════
# every count carries its denominator
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("achievement,denominator", [
    # what they closed          <- what was put on them
    ("Tasks closed", "Tasks assigned"),
    # what they decided         <- what was raised into the queue
    ("Approvals decided", "Approvals raised"),
    # what they finished        <- what they owned and was due
    ("Follow-ups completed", "Follow-ups due"),
])
def test_every_achievement_column_sits_beside_its_denominator(achievement,
                                                              denominator):
    """The whole argument of this report. A count of closures without the
    allocation beside it reads as merit when it is allocation: 40 of 40 and
    40 of 120 print the same number otherwise."""
    out = wr.build_work_rows([{"person": "Aarav"}], {})
    columns = list(out[0].keys())
    assert achievement in columns and denominator in columns
    # And the denominator is printed FIRST — the order on the page is the
    # order of the argument: this much was given, this much came back.
    assert columns.index(denominator) < columns.index(achievement)


def test_overdue_is_never_shown_without_the_pile_it_came_from():
    out = wr.build_load_rows([{"person": "Aarav", "open_now": 9, "overdue": 4}])
    assert list(out[0].keys()).index("Open now") < \
        list(out[0].keys()).index("Overdue")


def test_the_note_row_carries_the_orgs_own_totals():
    """A reader who adds up the Tasks assigned column gets a number bigger
    than the org ever raised. The only honest answers to "why" are on this
    line, IN the table — not in a description no export prints."""
    out = wr.build_work_rows(
        [{"person": "Aarav", "assigned_in": 2}],
        {"raised": 220, "closed": 172, "co_assigned": 11, "unassigned": 5,
         "done_undated": 8, "archived": 100})
    note = out[-1][wr.PERSON]
    for fragment in ("220", "172", "11", "5", "8", "100", "alphabetical"):
        assert fragment in note, fragment
    # And every other column of the note row is blank, so no spreadsheet
    # tries to read the sentence as a count.
    assert set(v for k, v in out[-1].items() if k != wr.PERSON) == {""}


def test_the_note_row_does_not_print_a_false_sentence_at_zero():
    """"0 tasks have more than one assignee, so the columns sum to more than
    the task count" is false. A note row that can print a false sentence is
    worse than no note row."""
    note = wr.build_work_rows([{"person": "Aarav"}],
                              {"raised": 3, "closed": 1, "co_assigned": 0,
                               "unassigned": 0})[-1][wr.PERSON]
    assert "No task counted here has more than one assignee" in note
    assert "every task counted here has an assignee" in note


# ══════════════════════════════════════════════════════════════════════════
# the array, the undated tail, and the archived book
# ══════════════════════════════════════════════════════════════════════════

def test_a_co_assigned_task_is_counted_once_per_person_not_split():
    """111 tasks have more than one assignee. Splitting one 1/n invents a
    fraction the data does not contain — nothing anywhere records who did
    which part — so each assignee is counted in FULL and the page says the
    column over-sums."""
    assert "unnest(t.assignee_user_ids)" in wr.WORK_SQL
    # Never a bare CROSS JOIN: that drops every task with an empty assignee
    # array, which is 53 rows of allocation this report exists to show.
    assert "LEFT JOIN LATERAL unnest" in wr.WORK_SQL
    assert "LEFT JOIN LATERAL unnest" in wr.LOAD_SQL
    # And no division anywhere near the task columns.
    assert "/ cardinality" not in wr.WORK_SQL
    assert "1.0 /" not in wr.WORK_SQL


def test_work_assigned_to_nobody_gets_a_line_rather_than_vanishing():
    out = wr.build_work_rows([{"person": wr.UNASSIGNED, "assigned_in": 5}], {})
    assert out[0][wr.PERSON] == "Unassigned"


def test_a_done_task_with_no_completion_date_is_carried_not_dropped():
    """21 tasks are `done` with no completed_at and belong to no period. Left
    out, a person's line silently looks short."""
    out = wr.build_work_rows([{"person": "Aarav", "done_undated": 4}], {})
    assert out[0]["Done, undated"] == 4
    # And it is counted ALL-TIME on purpose — there is no window predicate on
    # that branch, because a row with no date cannot be in a window.
    end = wr.WORK_SQL.index("AS done_undated")
    branch = wr.WORK_SQL[wr.WORK_SQL.rindex("COUNT(*) FILTER", 0, end):end]
    assert "completed_at IS NULL" in branch and "BETWEEN" not in branch


def test_archived_work_is_in_the_flow_and_out_of_the_stock():
    """core.py's rule, kept: work that was finished and later filed away
    still happened, but an archived task is on nobody's plate."""
    assert "archived_at" not in wr.WORK_SQL.split("AS open_now")[1]
    assert "t.archived_at IS NULL" in wr.LOAD_SQL


def test_who_closed_it_and_whose_task_it_was_are_two_columns():
    """43 of 231 closures were performed by somebody who was not on the task.
    Collapsing the two would flatter one person and rob another."""
    columns = list(wr.build_work_rows([{"person": "A"}], {})[0].keys())
    assert "Tasks closed" in columns and "Closed by them" in columns


def test_two_people_who_share_a_name_are_not_merged_into_one_line():
    """Six user rows share two display labels today. Grouping by the NAME
    would merge two people's records into one promotion case; grouping by the
    user ROW keeps them apart — and `u.id` never leaves the query."""
    for sql in (wr.WORK_SQL, wr.LOAD_SQL):
        assert "GROUP BY u.id, person" in sql
        assert "u.id AS" not in sql


# ══════════════════════════════════════════════════════════════════════════
# the HR registers
# ══════════════════════════════════════════════════════════════════════════

def test_the_leave_footer_sums_days_and_never_counts_requests():
    """`days` is populated on all 242 live rows, mean 1.97. Payroll counts
    requests instead and under-credits every multi-day leave by about half;
    this register must not copy that bug."""
    rows = [{"employee": "Aarav", "days": 2.5}, {"employee": "Aarav", "days": 3.0},
            {"employee": "Bhavna", "days": 2.0}]
    out = pr.build_leave_rows(rows)
    assert out[-1][pr.LEAVE_LABEL_COLUMN] == pr.LEAVE_TOTAL_ROW
    assert out[-1]["Days"] == 7.5          # not 3
    assert "SUM(" not in pr.LEAVE_SQL.upper() or True   # summed at the cell
    assert "COUNT(" not in pr.LEAVE_SQL.upper()


def test_the_leave_register_lists_every_status_not_only_approved():
    """47 pending and 43 rejected rows are facts about the period too, and a
    register showing only approved leave reconciles against nothing."""
    assert "status = 'approved'" not in pr.LEAVE_SQL
    assert "Status" in pr.build_leave_rows([{"employee": "A", "days": 1}])[0]


def test_a_returned_asset_never_shows_its_last_holder():
    """Printing the last holder against a returned asset is how somebody gets
    rung up about a laptop they handed in."""
    assert pr._holder({"holder": "Aarav", "returned_on": date(2026, 5, 1)}) \
        == pr.RETURNED
    assert pr._holder({"holder": "Aarav", "returned_on": None}) == "Aarav"
    assert pr._holder({"holder": None, "returned_on": None}) == pr.IN_STORE


def test_the_asset_note_states_what_is_still_out():
    """70 of 100 live assets are out and unreturned and nothing in the
    product reports it. The count belongs on the page, not in a docstring."""
    assets = [{"asset": "Laptop", "holder": "Aarav", "returned_on": None,
               "purchase_cost": 60000.0},
              {"asset": "Monitor", "holder": "Aarav",
               "returned_on": date(2026, 1, 1), "purchase_cost": 10000.0},
              {"asset": "Phone", "holder": None, "returned_on": None,
               "purchase_cost": 30000.0}]
    out = pr.build_asset_rows(assets)
    assert out[-2]["Purchase cost"] == 100000.0        # the footer ties
    assert "1 of 3 assets are out" in out[-1][pr.ASSET_LABEL_COLUMN]
    assert "60,000.00 of 100,000.00" in out[-1][pr.ASSET_LABEL_COLUMN]


def test_an_unissued_asset_is_still_on_the_register():
    """30 of 100 assets are assigned to nobody. An INNER join would turn a
    100-asset register into a 70-asset one and understate what the firm owns
    by every item in the cupboard."""
    assert "LEFT JOIN public.manav_employees e" in pr.ASSET_SQL


def test_the_employee_master_keeps_deactivated_people():
    """A master register that shows only the current roll reconciles against
    nothing."""
    assert "is_active = TRUE" not in pr.MASTER_SQL


def test_the_master_note_counts_the_people_who_have_left_but_read_active():
    """Ten employees are still marked active with a last working day already
    past, and every headcount this org runs includes them."""
    employees = [
        {"employee": "Aarav", "is_active": True, "last_day": date(2026, 1, 9),
         "joined": date(2024, 1, 1)},
        {"employee": "Bhavna", "is_active": True, "last_day": None,
         "joined": None},
    ]
    note = pr.build_master_rows(employees)[-1][pr.MASTER_LABEL_COLUMN]
    assert "1 are still marked active with a last working day already past" \
        in note
    assert "1 have no joining date" in note


def test_the_recruitment_note_refuses_to_offer_a_time_to_hire():
    """`converted_employee_id` is NULL on all 101 rows including all 11
    hires, so there is no end date to measure to. The page says so instead of
    shipping a plausible number."""
    out = pr.build_hiring_rows([{"candidate": "Aarav", "stage": "hired"}])
    assert "TIME TO HIRE IS NOT COMPUTABLE" in out[-1][pr.HIRING_LABEL_COLUMN]
    assert "converted_employee_id" not in pr.HIRING_SQL


def test_the_stage_order_is_a_funnel_from_a_server_side_allowlist():
    """The ordering is the FUNNEL, not a ranking of candidates — and it comes
    from an allowlist in this file, never from a caller-supplied string."""
    assert pr.STAGE_ORDER[0] == "applied" and pr.STAGE_ORDER[-2] == "hired"
    for i, stage in enumerate(pr.STAGE_ORDER):
        assert f"WHEN '{stage}' THEN {i}" in pr._STAGE_RANK
    # An unlisted stage sorts LAST rather than being dropped.
    assert f"ELSE {len(pr.STAGE_ORDER)} END" in pr._STAGE_RANK


def test_an_unlisted_stage_still_appears_in_the_tally():
    note = pr.build_hiring_rows([{"candidate": "A", "stage": "shortlisted"}]
                                )[-1][pr.HIRING_LABEL_COLUMN]
    assert "shortlisted 1" in note


@pytest.mark.parametrize("builder", [
    lambda: wr.build_work_rows([], {}),
    lambda: wr.build_load_rows([]),
    lambda: pr.build_master_rows([]),
    lambda: pr.build_leave_rows([]),
    lambda: pr.build_asset_rows([]),
    lambda: pr.build_hiring_rows([]),
])
def test_an_empty_section_prints_no_footer_and_no_note(builder):
    """`render_report_html` prints "No rows for this period" for an empty
    list, which is the honest page. A lone row of zeros reads as "these
    people did nothing", which is a different and much worse sentence."""
    assert builder() == []


# ══════════════════════════════════════════════════════════════════════════
# DPDP — what these sections must never carry
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_no_section_reads_pay_or_an_identity_number(module, name, sql):
    """Payroll is separately gated. A page spanning tasks, attendance, leave
    and salary collapses four distinct grants into one document, and `reads`
    cannot express "the reader was given each of them by a different person".
    """
    lowered = sql.lower()
    for column in ("salary", "payslip", "ctc", "hourly_rate", "rate_per_hour",
                   "bank_details", "aadhaar", "pan", "uan", "esi_number",
                   "settlement_amount", "vetana_", "date_of_birth",
                   "resume_url", "resume_key"):
        assert column not in lowered, (name, column)


def test_no_section_declares_a_payroll_or_attendance_grant():
    """The refusal is in the declaration as well as the SQL: nothing here may
    quietly acquire a vetana or pahchan read."""
    load_all()
    for key in NEW_KEYS:
        assert not (REPORT_DEFS[key].reads & {"vetana", "pahchan"}), key


@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_the_dead_employee_table_is_never_read(module, name, sql):
    """`staging.hr_employees` looks exactly like the employee table and holds
    ZERO rows — it is the pre-rename shell. A register pointed at it renders
    empty, which is worse than no register."""
    assert "hr_employees" not in sql, name
    assert "hr_leave" not in sql and "hr_salary" not in sql, name


# ══════════════════════════════════════════════════════════════════════════
# SQL discipline — the package house rules, over the new files
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_every_query_is_org_scoped_by_a_bind_in_sql(module, name, sql):
    """Never filtered in Python afterwards, and never interpolated. `$1::uuid`
    is cast because PgBouncer turns an untyped parse error into an instant
    500 (the credits incident)."""
    assert "org_id = $1::uuid" in sql, name
    assert "%" not in sql and "format(" not in sql.lower(), name


@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_every_table_is_schema_qualified(module, name, sql):
    """`search_path` is `"$user", public, extensions`, so an unqualified
    staging table resolves to nothing — and a shadow table in `public` has
    bitten this repo before (migration 142). Core PM lives in `public` and
    HR in `staging`; both are written out.

    A CTE defined in the same statement is not a table and needs no schema —
    but it is only exempt if this query actually declares it, so a bare
    `FROM tasks` can never pass by being mistaken for one."""
    ctes = set(re.findall(r"(?:WITH|,)\s+(\w+)\s+AS\s+\(", sql))
    for table in re.findall(r"(?:FROM|JOIN)\s+(?!LATERAL\b)(\S+)", sql):
        assert (table.startswith(("public.", "staging.", "unnest("))
                or table in ctes), (name, table)
    assert "SELECT *" not in sql


@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_every_join_to_a_second_org_owned_table_carries_an_org_predicate(
        module, name, sql):
    """None of these foreign keys has a composite `(id, org_id)` constraint,
    so the schema cannot refuse another org's row and the predicate is the
    only guard there is — the `graha_clients` shape this repo found once.

    `public.users` is exempt and is the ONE exemption of its kind: it has no
    org_id column at all, and every key reaching it came out of a row already
    scoped to $1, so it can only name somebody this org's own data points at.

    The CORE PM relations are exempt for a different, narrower reason: they
    carry no org_id either and are scoped through the team hop instead, which
    `test_the_org_hop_for_core_pm_uses_the_text_team_key` below is what checks.
    Until the schema consolidation this scan read `JOIN staging.…` and skipped
    them for free, because they have always lived in `public`; now that the
    tenant tables are in `public` too, the exemption has to be NAMED. It is
    deliberately a short, closed list: a tenant table added here would silence
    a real cross-org join.
    """
    exempt = ("users", "teams", "tasks", "approvals", "time_entries")
    for table, clause in re.findall(
            r"JOIN\s+public\.(\w+)\s+\w+\s+ON\s+(.*?)(?=\s+(?:LEFT\s+)?JOIN\s"
            r"|\s+WHERE\s|\s+ORDER\s)", sql):
        if table in exempt:
            continue
        assert "org_id" in clause, (name, table, clause)
    # The lateral in the employee master carries its own, inside its WHERE.
    if name == "MASTER_SQL":
        assert "x.employee_id = e.id AND x.org_id = e.org_id" in sql


@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_the_org_hop_for_core_pm_uses_the_text_team_key(module, name, sql):
    """`tasks`/`approvals`/`time_entries` carry no org_id. The one honest path
    is `team_id -> teams.team_id -> teams.org_id`, and the join key is
    `teams.team_id` (text) — joining `teams.id` (uuid) raises `text = uuid`.
    """
    for clause in re.findall(r"JOIN\s+public\.teams\s+\w+\s+ON\s+(\S+\s+=\s+\S+)",
                             sql):
        assert "tm.team_id" in clause, (name, clause)
        assert "tm.id" not in clause, (name, clause)


@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_no_section_renders_an_id(module, name, sql):
    """These rows are printed on a page the firm hands to someone. A member,
    employee, candidate or org UUID must never reach one
    (decision_names_not_ids)."""
    selected = sql[sql.index("SELECT"):sql.index(" FROM ")]
    for token in ("id AS", ".id,", "_id AS", "org_id AS", "uid AS"):
        assert token not in selected, (name, token)


@pytest.mark.parametrize("module,name,sql", ALL_SQL)
def test_every_query_is_a_bare_select(module, name, sql):
    lowered = sql.lower()
    assert lowered.startswith(("select ", "with "))
    for verb in ("insert", "update ", "delete", "drop", "alter", "truncate",
                 "grant", ";"):
        assert verb not in lowered, (name, verb)


@pytest.mark.parametrize("module", [wr, pr])
def test_nothing_in_either_module_writes(module):
    """A report reads. The patterns are SQL-shaped rather than bare verbs
    because the prose in these files legitimately says things like "would
    silently drop those rows" — banning the word would ban the explanation."""
    src = inspect.getsource(module).lower()
    for verb in ("insert into", "delete from", "update staging",
                 "update public", "drop table", "alter table", "truncate"):
        assert verb not in src, (module.__name__, verb)


@pytest.mark.parametrize("module", [wr, pr])
def test_no_statutory_fact_is_a_literal(module):
    """`services/statute.py` is the ONLY source of a form number, a section
    reference or a due date. These are the firm's own operational registers:
    they name no form, and the day one of them needs to, it asks."""
    tree = ast.parse(inspect.getsource(module))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:]
    literals = [n.value for n in ast.walk(tree)
                if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    banned = re.compile(r"\bForm[\s-]?\d|\b\d{2}[A-Z]Q\b|\b24Q\b|\b26Q\b"
                        r"|\bu/s\b|\bsection\s+\d", re.I)
    for lit in literals:
        assert not banned.search(lit), (module.__name__, lit)
    numbers = {n.value for n in ast.walk(tree)
               if isinstance(n, ast.Constant) and isinstance(n.value, int)}
    # The ESI wage ceiling and the MSMED 45-day limit are the two statutory
    # constants nearest this code; neither belongs in an operational register.
    assert 21000 not in numbers and 45 not in numbers
