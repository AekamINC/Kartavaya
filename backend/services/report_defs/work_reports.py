"""Per-person work — the two sections a director asks for by name.

Every figure quoted below was measured READ-ONLY against the live database on
2026-08-21, all orgs unless an org is named.

WHY THIS FILE EXISTS AND WHAT IT REFUSES TO BE
──────────────────────────────────────────────
`analytics/metrics/core.py` already answers "how many tasks were closed" and
"who holds the most open work". Neither can put one person on one line beside
what was GIVEN to them, and that missing second number is the whole argument:
a per-person count without its denominator reads as merit when it is
allocation. Someone closing 40 of 40 and someone closing 40 of 120 print the
same number in every product that ships this report badly.

So there is NO RANK HERE, in any form. Rows are alphabetical by name, there
is no position column, no total-score column, and nothing is sorted by a
metric. The product already shipped a "champion of the period" once; it
counted the wrong table, it was removed on 2026-08-19, and
`tests/test_a_report_reports_its_own_period.py` ratchets against its return.
A page a promotion decision rests on must make the reader do the comparing,
because only the reader knows what the work was.

THE SEVEN FACTS THE SECTIONS ARE BUILT ON
─────────────────────────────────────────
1. TASKS HAVE NO org_id. The one honest path is
   `tasks.team_id -> public.teams.team_id -> teams.org_id`, joined on the TEXT
   key `teams.team_id`, never `teams.id` (uuid) — that join raises
   `text = uuid`. 698 of 735 tasks resolve; the other 37 (36 with no team, 1
   dangling) are invisible here and to every core metric. Said out loud
   because a person's total is short by exactly those rows.

2. `assignee_user_ids` IS AN ARRAY, and 111 tasks carry more than one name.
   698 tasks expand to 812 assignee rows. Each assignee is counted ONCE, in
   full, so the task columns SUM TO MORE THAN THE NUMBER OF TASKS — the note
   row says so with the measured figures for the period on the page. The
   alternative, splitting a task 1/n across its assignees, invents a fraction
   the data does not contain: nothing anywhere records who did which part.

3. `completed_by_user_id` IS THE CLOSER, AND IT IS NOT THE ASSIGNEE.
   43 of 231 closures were performed by somebody who was not on the task, and
   60 tasks were created and closed by the same person. Both are ordinary — a
   manager ticking off a finished job, somebody logging their own work — and
   both would flatter or rob a person if the two were collapsed. So
   `Tasks closed` counts the ASSIGNEE'S work reaching done and `Closed by
   them` counts the click, side by side.

   Fill rate is per-org and it matters: in the two real orgs the column is
   100% filled (172/172 and 57/57); in the seeded E2E org it is 2 of 102. A
   report run against seed data therefore shows a nearly empty `Closed by
   them` column, which is the truth about that org's data, not a bug here.

4. 21 OF THE 698 RESOLVABLE TASKS ARE `done` WITH NO `completed_at`, and
   they belong to NO PERIOD.
   They cannot be windowed and they are not silently dropped: they carry
   their own all-time column, `Done, undated`, so a person's line does not
   just look short.

5. 253 OF THE 698 RESOLVABLE TASKS ARE ARCHIVED, AND THEY ARE IN.
   `core.py`'s rule, kept: flow counts include archived work (work that was
   finished and later filed away still happened), stock counts exclude it (an
   archived task is on nobody's plate). `Open now` is the only stock column
   in the flow section and it excludes them.

6. FOLLOW-UPS ARE THE CLEANEST PER-PERSON SIGNAL IN THE DATABASE.
   `staging.graha_follow_ups.assigned_to` is filled on all 136 rows and all
   136 carry an org_id — a single owner, no array, no ambiguity. That is why
   this section crosses into a second module at all, and `reads` says so:
   follow-ups and activities are GRAHA tables, and a caller without a CRM
   grant is not offered this section.

7. EVERY PERSON KEY RESOLVES TO A NAME. All 759 assignee entries, all 241
   closers, all 42 approval reviewers, all 136 follow-up owners, all 221
   activity authors and all 289 time entries resolve through `public.users`.
   Two labels are shared by six user rows today — all system or unused
   accounts, none of them in the work data — and the grouping is by the USER
   ROW, never by the name, so two real namesakes get two lines rather than
   one merged line that would misattribute a promotion case. `public.users`
   carries no org_id and is not scoped: every key reaching it came out of a
   row this org already owns.

WHAT IS NOT HERE, AND WILL NOT BE
─────────────────────────────────
No salary, no payslip, no attendance. A page spanning tasks, attendance and
pay collapses four separate grants into one document, and `reads` cannot
express "the reader held all four for different reasons".

No productivity score and no per-hour rate. `estimated_minutes` is set on 127
of 735 tasks, so tasks have no size on 83% of the book; any ratio built on
that is a number about data entry.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import BLANK, ROW_CAP, window_or_raise

WORK_KEY = "core.work_by_person"
LOAD_KEY = "core.workload_now"

#: The name column. Both sections lead with it, and the footer's label sits
#: here — never in a date or a count column, where a spreadsheet would try to
#: parse the word as a value.
PERSON = "Person"

#: The row the org-level footer is labelled with.
ALL_PEOPLE = "All people"

#: A task with an empty `assignee_user_ids`. 53 of the 698 resolvable tasks.
#: This is not a person and it is not a rounding error: it is work the org
#: allocated to nobody, and it belongs on the page for exactly that reason.
UNASSIGNED = "Unassigned"

#: A person key that no longer resolves through `public.users`. 0 rows today
#: on every one of the six keys this file reads. The label exists so that the
#: first deleted account prints a word instead of vanishing from a column its
#: work is still counted in — and so that it never prints the raw id.
UNRECORDED = "Person no longer on record"

#: The count columns of the work section, in print order. The footer sums
#: exactly these; anything not named here is blanked in the footer.
WORK_COUNTS = (
    "Tasks assigned", "Tasks closed", "Closed by them", "Done, undated",
    "Open now", "Approvals raised", "Approvals decided",
    "Follow-ups due", "Follow-ups completed", "Activities logged",
    "Minutes logged",
)

#: The count columns of the workload section. `Oldest open item` is a date
#: and `Oldest open task` is a title; neither is summable, so neither is here.
LOAD_COUNTS = ("Open now", "Overdue", "Due within 7 days")


# ══════════════════════════════════════════════════════════════════════════
# A · core.work_by_person
# ══════════════════════════════════════════════════════════════════════════

#: One row per person, eleven columns, one query.
#:
#: The shape is a UNION ALL of per-source contribution rows — every branch
#: emits the same eleven columns and fills only its own — rather than eleven
#: correlated subqueries or a chain of FULL OUTER JOINs. The reason is that
#: the sources key on SEVEN DIFFERENT person columns (an assignee array, a
#: closer, an approval requester, an approval reviewer, a follow-up owner, an
#: activity author, a time-entry author) and reach the org down three
#: different paths. A join chain would have to pick one of them as the spine,
#: and whoever is missing from that spine — the reviewer who is on no task,
#: the person who only logs time — would silently drop off the page.
#:
#: `LEFT JOIN LATERAL unnest(...)` rather than a bare `CROSS JOIN unnest`: a
#: cross join drops every task with an empty assignee array, which is 53 rows
#: of allocation this report exists to show.
WORK_SQL = (
    "WITH scoped AS ("
    # THE org path for tasks. teams.team_id (text), never teams.id (uuid).
    "  SELECT t.assignee_user_ids, t.completed_by_user_id, t.completed_at, "
    "         t.created_at, t.status, t.archived_at "
    "    FROM public.tasks t "
    "    JOIN public.teams tm ON tm.team_id = t.team_id "
    "   WHERE tm.org_id = $1::uuid"
    "), "
    "contrib AS ("
    # 1 · What was PUT ON this person, what of it reached done, and the
    #     undated tail — all keyed on the assignee, one row per assignee.
    "  SELECT a.uid AS uid, "
    "         COUNT(*) FILTER (WHERE t.created_at::date "
    "                 BETWEEN $2::date AND $3::date) AS assigned_in, "
    "         COUNT(*) FILTER (WHERE t.completed_at::date "
    "                 BETWEEN $2::date AND $3::date) AS closed_in, "
    "         0 AS closed_by, "
    # All-time on purpose: a `done` row with no completed_at is in no period.
    "         COUNT(*) FILTER (WHERE t.status = 'done' "
    "                 AND t.completed_at IS NULL) AS done_undated, "
    # The one stock column. Archived work is on nobody's plate.
    "         COUNT(*) FILTER (WHERE t.archived_at IS NULL "
    "                 AND t.status <> 'done') AS open_now, "
    "         0 AS appr_raised, 0 AS appr_decided, "
    "         0 AS fu_due, 0 AS fu_done, 0 AS acts, 0 AS minutes "
    "    FROM scoped t "
    "    LEFT JOIN LATERAL unnest(t.assignee_user_ids) AS a(uid) ON TRUE "
    "   GROUP BY 1 "
    "  UNION ALL "
    # 2 · Who pressed done. Its own branch because 43 closers were not on the
    #     task and would otherwise never appear at all.
    "  SELECT t.completed_by_user_id, 0, 0, COUNT(*), 0, 0, 0, 0, 0, 0, 0, 0 "
    "    FROM scoped t "
    "   WHERE t.completed_by_user_id IS NOT NULL "
    "     AND t.completed_at::date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1 "
    "  UNION ALL "
    # 3 · Approvals RAISED — the denominator half of the approval pair.
    #     approvals carry no org_id and no archived_at; same text team key.
    "  SELECT a.requested_by, 0, 0, 0, 0, 0, COUNT(*), 0, 0, 0, 0, 0 "
    "    FROM public.approvals a "
    "    JOIN public.teams tm ON tm.team_id = a.team_id "
    "   WHERE tm.org_id = $1::uuid "
    "     AND a.requested_by IS NOT NULL "
    "     AND a.created_at::date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1 "
    "  UNION ALL "
    # 4 · Approvals DECIDED. reviewed_at is filled on all 42 reviewed rows.
    "  SELECT a.reviewed_by, 0, 0, 0, 0, 0, 0, COUNT(*), 0, 0, 0, 0 "
    "    FROM public.approvals a "
    "    JOIN public.teams tm ON tm.team_id = a.team_id "
    "   WHERE tm.org_id = $1::uuid "
    "     AND a.reviewed_by IS NOT NULL "
    "     AND a.reviewed_at::date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1 "
    "  UNION ALL "
    # 5 · Follow-ups OWNED (due in the period) and COMPLETED in it — the
    #     cleanest pair in the database: one owner per row, 136 of 136 filled.
    "  SELECT f.assigned_to, 0, 0, 0, 0, 0, 0, 0, "
    "         COUNT(*) FILTER (WHERE f.due_at::date "
    "                 BETWEEN $2::date AND $3::date), "
    "         COUNT(*) FILTER (WHERE f.is_completed = TRUE "
    "                 AND f.completed_at::date "
    "                 BETWEEN $2::date AND $3::date), 0, 0 "
    "    FROM staging.graha_follow_ups f "
    "   WHERE f.org_id = $1::uuid "
    "     AND f.assigned_to IS NOT NULL "
    "   GROUP BY 1 "
    "  UNION ALL "
    # 6 · Activities logged. `graha_activities` has no owner column at all —
    #     only `created_by` — so this counts the person who RECORDED the call
    #     or the meeting, which is not necessarily the person who made it.
    #     Named in the description rather than dressed up as ownership.
    "  SELECT g.created_by, 0, 0, 0, 0, 0, 0, 0, 0, 0, COUNT(*), 0 "
    "    FROM staging.graha_activities g "
    "   WHERE g.org_id = $1::uuid "
    "     AND g.created_by IS NOT NULL "
    "     AND g.created_at::date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1 "
    "  UNION ALL "
    # 7 · Minutes logged. time_entries carry no team at all and scope TWO
    #     hops: entry -> task -> team -> org.
    "  SELECT te.user_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "
    "         COALESCE(SUM(te.minutes), 0)::int "
    "    FROM public.time_entries te "
    "    JOIN public.tasks t2 ON t2.task_id = te.task_id "
    "    JOIN public.teams tm ON tm.team_id = t2.team_id "
    "   WHERE tm.org_id = $1::uuid "
    "     AND te.user_id IS NOT NULL "
    "     AND te.started_at::date BETWEEN $2::date AND $3::date "
    "   GROUP BY 1"
    ") "
    # The name, and ONLY the name. Grouping is by `u.id` — the user ROW — so
    # two people who share a display name stay two lines; a merged line is
    # exactly the misattribution a promotion review must not make. `u.id`
    # appears in GROUP BY and never in a selected column (names-not-ids).
    "SELECT COALESCE(u.full_name, u.name, u.email, "
    "       CASE WHEN c.uid IS NULL THEN $4::text ELSE $5::text END) AS person, "
    "       SUM(c.assigned_in)::int AS assigned_in, "
    "       SUM(c.closed_in)::int AS closed_in, "
    "       SUM(c.closed_by)::int AS closed_by, "
    "       SUM(c.done_undated)::int AS done_undated, "
    "       SUM(c.open_now)::int AS open_now, "
    "       SUM(c.appr_raised)::int AS appr_raised, "
    "       SUM(c.appr_decided)::int AS appr_decided, "
    "       SUM(c.fu_due)::int AS fu_due, "
    "       SUM(c.fu_done)::int AS fu_done, "
    "       SUM(c.acts)::int AS acts, "
    "       SUM(c.minutes)::int AS minutes "
    "  FROM contrib c "
    # users is global (no org_id column exists on it). Every key reaching it
    # came out of a row already scoped to $1, so this join cannot widen the
    # scope — it can only name somebody this org's own data already points at.
    "  LEFT JOIN public.users u ON u.user_id = c.uid "
    " GROUP BY u.id, person "
    # ALPHABETICAL. Never by a metric — see the module docstring.
    " ORDER BY person "
    " LIMIT $6::int"
)

#: The org's own totals for the same period — the denominator BEHIND the
#: denominators. Without it a reader adding up the `Tasks assigned` column
#: finds a number larger than the org's task count and has no way to know why.
WORK_SPREAD_SQL = (
    "SELECT COUNT(*) FILTER (WHERE t.created_at::date "
    "               BETWEEN $2::date AND $3::date) AS raised, "
    "       COUNT(*) FILTER (WHERE t.completed_at::date "
    "               BETWEEN $2::date AND $3::date) AS closed, "
    "       COUNT(*) FILTER (WHERE COALESCE(cardinality(t.assignee_user_ids), 0) > 1 "
    "               AND (t.created_at::date BETWEEN $2::date AND $3::date "
    "                 OR t.completed_at::date BETWEEN $2::date AND $3::date)) "
    "               AS co_assigned, "
    "       COUNT(*) FILTER (WHERE COALESCE(cardinality(t.assignee_user_ids), 0) = 0 "
    "               AND (t.created_at::date BETWEEN $2::date AND $3::date "
    "                 OR t.completed_at::date BETWEEN $2::date AND $3::date)) "
    "               AS unassigned, "
    # All-time, both of them: an undated `done` row is in no period at all,
    # and the archived count is a statement about the whole book being read.
    "       COUNT(*) FILTER (WHERE t.status = 'done' "
    "               AND t.completed_at IS NULL) AS done_undated, "
    "       COUNT(*) FILTER (WHERE t.archived_at IS NOT NULL) AS archived "
    "  FROM public.tasks t "
    "  JOIN public.teams tm ON tm.team_id = t.team_id "
    " WHERE tm.org_id = $1::uuid"
)


def _count_footer(rows: list, columns: tuple, label: str) -> dict:
    """The footer: every count column summed, every other column blank.

    Counts, not money — `_shared.total_row` rounds to two decimals and would
    print `12.0` where a person expects `12`. The label goes in the name
    column and nowhere else, so a date or a count column never holds a word a
    spreadsheet cannot parse.
    """
    return {key: (sum(int(r.get(key) or 0) for r in rows) if key in columns
                  else (label if key == PERSON else BLANK))
            for key in rows[0].keys()}


def spread_note(rows: list, spread: dict) -> dict:
    """The row that says WHY the columns do not add up to the task count.

    This is not a caveat buried in a description nobody prints: it is a row
    inside the table, next to the numbers it explains, in the same place
    `_shared.overflow_row` puts its admission. A reader who totals the
    `Tasks assigned` column gets a number larger than the org ever raised, and
    the only honest answers to "why" are on this line.
    """
    co = int(spread.get("co_assigned") or 0)
    un = int(spread.get("unassigned") or 0)
    raised = int(spread.get("raised") or 0)
    closed = int(spread.get("closed") or 0)
    undated = int(spread.get("done_undated") or 0)
    archived = int(spread.get("archived") or 0)
    # Both halves are written for the zero case as well as the ordinary one.
    # "0 tasks have more than one assignee, so the columns sum to more than
    # the task count" is a false sentence, and a note row that can print a
    # false sentence is worse than no note row.
    spread_clause = (
        f"{co:,} of the tasks counted here have more than one assignee and "
        f"are counted once for EACH of them, so the task columns sum to more "
        f"than the task count" if co else
        "No task counted here has more than one assignee, so the task "
        "columns are not inflated by co-assignment")
    unassigned_clause = (
        f"{un:,} have no assignee at all and sit on the {UNASSIGNED} line"
        if un else "every task counted here has an assignee")
    note = (
        f"The org raised {raised:,} tasks and closed {closed:,} in this "
        f"period. {spread_clause}; {unassigned_clause}. 'Done, undated' is "
        f"all-time, not this period: {undated:,} tasks in this org are done "
        f"with no completion date and belong to no period. Archived tasks "
        f"are INCLUDED ({archived:,} in the org) — work that was finished "
        f"and later filed away still happened. Rows are alphabetical; this "
        f"page does not rank anyone."
    )
    return {key: (note if key == PERSON else BLANK)
            for key in (rows[0].keys() if rows else ())}


def build_work_rows(people: list, spread: dict) -> list:
    """The table. Pure, so both the footer and the note are testable without
    a database."""
    rows = [{
        PERSON: str(p.get("person") or UNRECORDED),
        # ALLOCATION first, then what happened to it. The order on the page is
        # the order of the argument: this much was given, this much closed.
        "Tasks assigned": int(p.get("assigned_in") or 0),
        "Tasks closed": int(p.get("closed_in") or 0),
        "Closed by them": int(p.get("closed_by") or 0),
        "Done, undated": int(p.get("done_undated") or 0),
        "Open now": int(p.get("open_now") or 0),
        "Approvals raised": int(p.get("appr_raised") or 0),
        "Approvals decided": int(p.get("appr_decided") or 0),
        "Follow-ups due": int(p.get("fu_due") or 0),
        "Follow-ups completed": int(p.get("fu_done") or 0),
        "Activities logged": int(p.get("acts") or 0),
        "Minutes logged": int(p.get("minutes") or 0),
    } for p in people]
    if not rows:
        # `render_report_html` prints "No rows for this period" for an empty
        # list, which is the honest page. A lone row of zeros reads as "these
        # people did nothing", which is a different and much worse sentence.
        return []
    out = [*rows, _count_footer(rows, WORK_COUNTS, ALL_PEOPLE)]
    out.append(spread_note(out, spread))
    return out


@report_def(
    key=WORK_KEY,
    module="core",
    # Follow-ups and activities are GRAHA tables. A section that joins a
    # second module's data must say so or the join is an entitlement bypass
    # wearing a report's clothes — so a caller without a CRM grant is not
    # offered this section at all, rather than shown it with two blank
    # columns.
    reads=frozenset({"core", "graha"}),
    label="Work by person",
    grain="flow",
    sensitivity="operational",
    description=(
        "One line per person for the period, ALPHABETICAL BY NAME — there is "
        "no rank, no position column and nothing sorted by a metric. Every "
        "count sits beside its denominator: tasks assigned beside tasks "
        "closed, approvals raised beside approvals decided, follow-ups due "
        "beside follow-ups completed. A task with more than one assignee is "
        "counted once for EACH of them, so the task columns sum to more than "
        "the number of tasks; the note row carries the period's real totals. "
        "'Tasks closed' is the assignee's work reaching done; 'Closed by "
        "them' is who pressed done, and the two differ. 'Done, undated' and "
        "'Open now' are ALL-TIME columns on a windowed page, because a done "
        "task with no completion date belongs to no period and open work is "
        "a fact about today. Archived tasks are included. LIMITATIONS: tasks "
        "have no size (estimated_minutes is set on 127 of 735), so nothing "
        "here measures effort; 43 of 231 closures were performed by someone "
        "who was not an assignee and 60 tasks were created and closed by the "
        "same person; 37 of 735 tasks resolve to no team and so to no org "
        "and are absent from every line; activities count who RECORDED the "
        "activity, not who performed it; and in an org whose closer column "
        "was never filled, 'Closed by them' reads near zero for everyone. "
        "AND THE DENOMINATOR ITSELF HAS A LIMIT: 'Tasks assigned' counts "
        "tasks RAISED in the period, because no assignment date is recorded "
        "anywhere — nothing stores when work was handed to somebody — so a "
        "task created earlier and taken on now is counted in the earlier "
        "period, and a person can close more than the column beside it "
        "shows was assigned."
    ),
)
async def work_by_person(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, WORK_KEY)
    # ROW_CAP, not ROW_CAP + 1, and no `capped()` call: these rows are one per
    # PERSON, not one per document, so the ceiling is the size of the firm and
    # cannot be reached by a wide period the way a register's can. It is here
    # as a runaway guard only — the largest org produces 17 rows today.
    people = await pool.fetch(WORK_SQL, str(org_id), win.start, win.end,
                              UNASSIGNED, UNRECORDED, ROW_CAP)
    spread = await pool.fetchrow(WORK_SPREAD_SQL, str(org_id),
                                 win.start, win.end)
    return build_work_rows([dict(p) for p in people],
                           dict(spread) if spread else {})


# ══════════════════════════════════════════════════════════════════════════
# B · core.workload_now
# ══════════════════════════════════════════════════════════════════════════

#: What each person is holding RIGHT NOW. A stock: `window` is None by
#: contract and there is no date filter anywhere in this query.
#:
#: `Open now` is this section's own denominator — overdue is read against it,
#: never on its own, because "eleven overdue" says nothing until you know
#: whether it is eleven of twelve or eleven of ninety.
LOAD_SQL = (
    "SELECT COALESCE(u.full_name, u.name, u.email, "
    "       CASE WHEN a.uid IS NULL THEN $2::text ELSE $3::text END) AS person, "
    "       COUNT(*)::int AS open_now, "
    # now(), not CURRENT_DATE: due_at is a timestamptz and the product's own
    # overdue definition (`core.overdue_tasks`) is `due_at < now()`. Two
    # definitions of overdue in one product is how a screen and a report come
    # to disagree in front of the person they are about.
    "       COUNT(*) FILTER (WHERE t.due_at < now())::int AS overdue, "
    "       COUNT(*) FILTER (WHERE t.due_at >= now() "
    "               AND t.due_at < now() + interval '7 days')::int AS due_soon, "
    # The oldest thing still open, by the date it was RAISED — the age of the
    # backlog rather than the age of a deadline, because a task with no due
    # date is ordinary here and a due-date-based oldest would skip those rows
    # in silence.
    "       MIN(t.created_at)::date AS oldest_open, "
    "       (ARRAY_AGG(t.title ORDER BY t.created_at))[1] AS oldest_title "
    "  FROM public.tasks t "
    "  JOIN public.teams tm ON tm.team_id = t.team_id "
    "  LEFT JOIN LATERAL unnest(t.assignee_user_ids) AS a(uid) ON TRUE "
    "  LEFT JOIN public.users u ON u.user_id = a.uid "
    " WHERE tm.org_id = $1::uuid "
    # A stock excludes archived work — it is on nobody's plate — and excludes
    # done. `status <> 'done'`, not `status IN (...)`: the live vocabulary is
    # todo / in_progress / in_review / requested / done, and an inclusion list
    # silently drops the next status somebody adds.
    "   AND t.archived_at IS NULL "
    "   AND t.status <> 'done' "
    " GROUP BY u.id, person "
    " ORDER BY person "
    " LIMIT $4::int"
)


def build_load_rows(people: list) -> list:
    """The table. Pure."""
    rows = [{
        PERSON: str(p.get("person") or UNRECORDED),
        "Open now": int(p.get("open_now") or 0),
        "Overdue": int(p.get("overdue") or 0),
        "Due within 7 days": int(p.get("due_soon") or 0),
        "Oldest open item": p.get("oldest_open"),
        # The title, never an id. A task nobody titled prints blank rather
        # than the word None, which a spreadsheet would happily filter on.
        "Oldest open task": str(p.get("oldest_title") or "").strip(),
    } for p in people]
    if not rows:
        return []
    # The footer sums the three counts; the date and the title are blanked,
    # because the oldest item of a group of people is not the sum of anything.
    return [*rows, _count_footer(rows, LOAD_COUNTS, ALL_PEOPLE)]


@report_def(
    key=LOAD_KEY,
    module="core",
    reads=frozenset({"core"}),
    label="Workload now",
    grain="stock",
    sensitivity="operational",
    description=(
        "What each person is holding as at today — open tasks, how many of "
        "those are overdue, how many fall due within a week, and the oldest "
        "item still open with the date it was raised. ALPHABETICAL BY NAME: "
        "there is no rank and no busiest-person row. Overdue is always read "
        "against the Open now column beside it, because a count of overdue "
        "work means nothing without the size of the pile it came from. A "
        "task with more than one assignee is counted once for EACH of them, "
        "so the columns sum to more than the number of open tasks, and work "
        "assigned to nobody is shown on its own line rather than dropped. "
        "Archived and done tasks are excluded — an archived task is on "
        "nobody's plate. Overdue means the due date has passed, the same "
        "definition the Overdue tasks metric uses. LIMITATIONS: a task with "
        "no due date can never be overdue and never falls due soon; tasks "
        "that resolve to no team resolve to no org and are absent."
    ),
)
async def workload_now(pool, org_id: str, window=None) -> list:
    """`window` is None by contract (grain='stock') and is ignored: what a
    person is holding is a fact about today, not about a period."""
    people = await pool.fetch(LOAD_SQL, str(org_id), UNASSIGNED, UNRECORDED,
                              ROW_CAP)
    return build_load_rows([dict(p) for p in people])
