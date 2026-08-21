"""The HR registers — the four books about people that nothing prints today.

Every figure below was measured READ-ONLY against the live database on
2026-08-21. All-org counts unless an org is named.

WHY THESE FOUR AND NOT A FIFTH
──────────────────────────────
`analytics/metrics/manav.py` answers headcount, attrition and leave in
aggregate. None of it can be handed to anybody: "11 leavers" is not a list,
"70 assets out" is not a recovery sheet, and a director preparing a review
needs the rows, not the total. These are the four registers whose rows exist
and are complete enough to print.

THE FIFTH — PAY — IS DELIBERATELY ABSENT, and this is the file it would
otherwise land in. Payroll (`vetana`) is separately gated, and a document
spanning tasks, attendance, leave and salary collapses four distinct grants
into one page: `reads` can say "this section needs manav AND vetana", but it
cannot say "the reader was given each of them for a different reason and by a
different person". Nothing here reads a salary, a payslip, a bank detail, a
PAN, an Aadhaar or a UAN — not even to sort by.

WHAT `sensitivity` SAYS HERE
────────────────────────────
`operational` and `financial` are the two values the metric registry has ever
used, and neither is true of an employee register: the DPDP exposure of a
list of named people with their joining dates is not the exposure of a
turnover figure. These four declare `personal`. Nothing switches on the
value today — `registry.py` and `sections_for` only carry it through to the
catalogue, and the frontend does not branch on it — so the term costs nothing
and states the fact. If a consumer ever does branch, `personal` must fall on
the strict side of the branch, never into an `else` that means operational.

THE SIX SCHEMA FACTS THESE REGISTERS STAND ON
─────────────────────────────────────────────
1. `staging.manav_employees` IS THE EMPLOYEE TABLE. 98 rows.
   `staging.hr_employees` also exists, looks exactly like it, and holds ZERO
   rows — it is the pre-rename shell and it is dead. It is named here so the
   next reader does not have to discover that twice, and it is never read.
   (Nine `hr_*` shells exist beside it; the same applies to all of them.)

2. THERE IS NO LEAVING DATE ON AN EMPLOYEE. `date_of_joining` exists and is
   filled on all 98; no ALTER ever added its opposite. The only dated exit
   anywhere is `staging.manav_offboarding.last_working_day` — 11 rows, all 11
   dated. So the master register carries the exit from that table or carries
   nothing, and says which.

   TEN EMPLOYEES ARE STILL MARKED ACTIVE WITH A LAST WORKING DAY IN THE PAST.
   That is not corrected here — a report does not repair its source — but the
   note row COUNTS them, because a headcount that quietly includes ten people
   who have left is the kind of number a decision gets made on.

3. `manav_leave_requests.days` IS POPULATED ON ALL 242 ROWS, mean 1.97, and
   totals 477 days. Counting requests instead of days — which is what payroll
   does today — under-credits every multi-day leave by roughly half. This
   register sums DAYS. `COUNT(*)` appears nowhere near its footer.

4. `manav_assets` HAS 100 ROWS, 70 OF THEM OUT AND UNRETURNED, ₹50,80,120 at
   purchase. `assigned_to` is a uuid into `manav_employees` and all 70 join
   cleanly. Nothing in the product reports this at all today.

5. `manav_candidates.converted_employee_id` IS NULL ON ALL 101 ROWS,
   including all 11 marked `hired`. So there is no link from a hire back to
   the employee it became, and TIME TO HIRE IS NOT COMPUTABLE — not
   approximately, not with a join, not at all. The description says so rather
   than the report shipping a plausible number.

6. EVERY JOIN IS ORG-SCOPED ON BOTH SIDES. None of these foreign keys carries
   a composite `(id, org_id)` constraint, so the schema cannot refuse another
   org's employee id and the predicate is the only guard there is — the
   `graha_clients` shape this repo already found once.

AND, AS EVERYWHERE IN THIS PACKAGE: names, never ids. An employee, candidate
or asset-holder uuid must not reach a printed row.
"""
from __future__ import annotations

from services.report_defs import report_def
from services.report_defs._shared import (
    BLANK, ROW_CAP, capped, finish, money, overflow_row, window_or_raise)

MASTER_KEY = "manav.employee_master"
LEAVE_KEY = "manav.leave_register"
ASSET_KEY = "manav.asset_register"
HIRING_KEY = "manav.recruitment_pipeline"

#: See the module docstring. A named list of people is neither an operational
#: count nor a financial one.
PERSONAL = "personal"

#: What an unnamed record prints. Every one of the 98 employees and all 101
#: candidates carry a name today; the fallback exists so the first blank one
#: prints a word instead of an empty cell that sorts to the top of the page
#: and explains nothing — and so that nothing is ever tempted to fall back to
#: an id.
UNNAMED = "Name not recorded"


# ══════════════════════════════════════════════════════════════════════════
# C · manav.employee_master
# ══════════════════════════════════════════════════════════════════════════

MASTER_LABEL_COLUMN = "Employee"

#: The people register. One row per employee, alphabetical.
#:
#: The offboarding row is fetched through a LATERAL rather than a plain join.
#: `manav_offboarding` has no unique constraint on `employee_id`: a second row
#: for the same person — a re-hire who leaves twice, a mistake corrected by
#: insertion — would print that employee TWICE in a headcount register, which
#: is the one document that must not double-count anybody. The lateral takes
#: the latest exit and the row count stays 98.
MASTER_SQL = (
    "SELECT e.name AS employee, "
    "       e.employee_code AS code, "
    "       e.designation AS designation, "
    "       e.department AS department, "
    "       e.date_of_joining AS joined, "
    "       e.status AS status, "
    "       e.is_active AS is_active, "
    "       o.last_working_day AS last_day "
    "  FROM staging.manav_employees e "
    "  LEFT JOIN LATERAL ("
    "    SELECT x.last_working_day "
    "      FROM staging.manav_offboarding x "
    # Scoped on org_id as well as employee_id — no composite FK exists, so
    # this predicate is the only thing stopping another org's exit record
    # from naming a date beside this org's employee.
    "     WHERE x.employee_id = e.id AND x.org_id = e.org_id "
    "     ORDER BY x.last_working_day DESC NULLS LAST "
    "     LIMIT 1"
    "  ) o ON TRUE "
    " WHERE e.org_id = $1::uuid "
    # No `is_active` guard: a master register that hides deactivated people is
    # not a master register, and `status` plus the exit date say which is
    # which on the face of the row.
    " ORDER BY e.name, e.employee_code "
    " LIMIT $2::int"
)


def _note_row(rows: list, label_column: str, note: str) -> dict:
    """A sentence INSIDE the table, in the column the reader is already
    reading down — the same place `_shared.overflow_row` puts its admission.

    A caveat that lives only in the section description is a caveat that does
    not reach the paper, the CSV or the XLSX sheet; every export path prints
    the rows and only the rows.
    """
    return {key: (note if key == label_column else BLANK)
            for key in (rows[0].keys() if rows else ())}


def build_master_rows(employees: list, dropped: int = 0) -> list:
    """The table. Pure, so the note row's arithmetic is testable without a
    database."""
    rows = [{
        MASTER_LABEL_COLUMN: str(e.get("employee") or UNNAMED),
        "Code": str(e.get("code") or "").strip(),
        "Designation": str(e.get("designation") or "").strip(),
        "Department": str(e.get("department") or "").strip(),
        "Joined": e.get("joined"),
        # As recorded. The live vocabulary is `active` and `resigned`; it is
        # printed exactly as stored rather than mapped to prettier English,
        # because the CHECK admits more values than the data has yet used and
        # a map that silently swallows a new one is worse than a raw word.
        "Status": str(e.get("status") or "").strip(),
        # Blank, not a dash: this column goes into a spreadsheet as a date.
        "Last working day": e.get("last_day"),
    } for e in employees]
    if not rows:
        return []

    # The three facts a reader of a headcount MUST be handed with it.
    total = len(rows)
    with_exit = sum(1 for e in employees if e.get("last_day") is not None)
    # The ten. An employee whose last working day has passed while the record
    # still says active is counted in every headcount this org runs.
    stale = sum(1 for e in employees
                if e.get("is_active") and e.get("last_day") is not None)
    no_join = sum(1 for e in employees if e.get("joined") is None)
    out = [*rows]
    if dropped:
        out.append(overflow_row(out, MASTER_LABEL_COLUMN, dropped))
    out.append(_note_row(out, MASTER_LABEL_COLUMN, (
        f"{total:,} employee records, active and inactive alike — a master "
        f"register that hides deactivated people is not one. {with_exit:,} "
        f"have a last working day, which comes from the offboarding record "
        f"and NOT from the employee row: there is no leaving-date column, so "
        f"anyone deactivated without an offboarding record has an exit that "
        f"cannot be placed in time and shows a blank here. "
        f"{stale:,} are still marked active with a last working day already "
        f"past, and every headcount this org runs includes them. "
        f"{no_join:,} have no joining date. Rows are alphabetical; this page "
        f"does not rank anyone and carries no pay, no bank detail and no "
        f"identity number.")))
    return out


@report_def(
    key=MASTER_KEY,
    module="manav",
    reads=frozenset({"manav"}),
    label="Employee master",
    grain="stock",
    sensitivity=PERSONAL,
    description=(
        "Every employee record as at today — name, code, designation, "
        "department, joining date, status and, where one exists, the last "
        "working day. ALPHABETICAL BY NAME; no rank, no length-of-service "
        "ordering. Deactivated people are INCLUDED and their status says so, "
        "because a master register that shows only the current roll cannot "
        "be reconciled against anything. The last working day comes from the "
        "offboarding record: the employee row has no leaving-date column at "
        "all, so somebody deactivated without an offboarding record has an "
        "exit that cannot be dated and prints blank. The note row counts the "
        "people who are still marked active with a last working day already "
        "past. Carries NO salary, bank detail or identity number, and never "
        "will: pay is a separate grant and belongs on a separate page. "
        "LIMITATIONS: there is no length-of-service or probation column "
        "anywhere, so nothing here says whether someone is confirmed; the "
        "reporting line is stored as free text and is not resolved to a "
        "manager's name; and an employee deactivated without an offboarding "
        "record has an exit that cannot be dated at all."
    ),
)
async def employee_master(pool, org_id: str, window=None) -> list:
    """`window` is None by contract (grain='stock'): a roll is a fact about
    today."""
    rows = await pool.fetch(MASTER_SQL, str(org_id), ROW_CAP + 1)
    employees, dropped = capped([dict(r) for r in rows])
    return build_master_rows(employees, dropped)


# ══════════════════════════════════════════════════════════════════════════
# D · manav.leave_register
# ══════════════════════════════════════════════════════════════════════════

LEAVE_LABEL_COLUMN = "Employee"
LEAVE_TOTAL_ROW = "All leave"

#: DAYS, never a count of requests. The mean request is 1.97 days, so a
#: register footed on `COUNT(*)` reports barely half the leave that was
#: actually taken — the bug payroll ships today, not copied here.
LEAVE_DAY_COLUMNS = ("Days",)

#: One row per request, in the period, by employee.
#:
#: The window anchors on `start_date` — the day the leave BEGAN — and not on
#: an overlap test. An overlap would put a leave that straddles a month end
#: into both months at its full length, so two consecutive monthly registers
#: would sum to more days than were taken; anchoring puts every request in
#: exactly one period. Live spread: start dates run 2025-04-03 to 2026-09-14,
#: so future-dated leave exists and a window ending today will not show it.
LEAVE_SQL = (
    "SELECT e.name AS employee, "
    "       lt.name AS leave_type, "
    "       l.start_date AS starts, "
    "       l.end_date AS ends, "
    "       COALESCE(l.days, 0)::float AS days, "
    "       l.status AS status "
    "  FROM staging.manav_leave_requests l "
    # INNER on the employee: a leave request whose employee cannot be named
    # would print under a fallback label in a register whose whole subject is
    # who was away. All 242 live rows join, so this drops nothing today — and
    # on the day one does not join, an absent row is more honest than a row
    # of leave attributed to nobody. Org-scoped on BOTH sides: there is no
    # composite (id, org_id) FK and only this predicate can refuse a foreign
    # employee id.
    "  JOIN staging.manav_employees e "
    "    ON e.id = l.employee_id AND e.org_id = l.org_id "
    # LEFT on the type: 242 of 242 join today, but an unnamed leave type is
    # not a reason to drop a day of absence off the register.
    "  LEFT JOIN staging.manav_leave_types lt "
    "    ON lt.id = l.leave_type_id AND lt.org_id = l.org_id "
    " WHERE l.org_id = $1::uuid "
    "   AND l.start_date BETWEEN $2::date AND $3::date "
    # Every status is listed, approved or not. A register showing only
    # approved leave cannot be reconciled against the requests that were made,
    # and 47 pending / 43 rejected rows are a fact about the period too — the
    # Status column carries the difference and the reader does the filtering.
    " ORDER BY e.name, l.start_date "
    " LIMIT $4::int"
)


def build_leave_rows(requests: list, dropped: int = 0) -> list:
    """The table. Pure, so the days footer is testable without a database."""
    rows = [{
        LEAVE_LABEL_COLUMN: str(r.get("employee") or UNNAMED),
        "Leave type": str(r.get("leave_type") or "").strip(),
        "From": r.get("starts"),
        "To": r.get("ends"),
        # DAYS. The column the footer sums, and the reason this register
        # exists rather than a count of requests.
        "Days": money(r.get("days")),
        "Status": str(r.get("status") or "").strip(),
    } for r in requests]
    return finish(rows, LEAVE_LABEL_COLUMN, LEAVE_TOTAL_ROW,
                  LEAVE_DAY_COLUMNS, dropped)


@report_def(
    key=LEAVE_KEY,
    module="manav",
    reads=frozenset({"manav"}),
    label="Leave register",
    grain="flow",
    sensitivity=PERSONAL,
    description=(
        "Every leave request whose leave BEGAN in the period, one row each, "
        "alphabetical by employee then by date — there is no rank and no "
        "most-absent line; who took the most leave is not a question this "
        "page answers, because leave is an entitlement and not a score. The "
        "footer sums DAYS, never "
        "a count of requests: the average request is about two days long, so "
        "counting requests reports roughly half the leave actually taken. "
        "Requests of every status are listed — approved, pending, rejected "
        "and cancelled — with the status on the row, because a register "
        "showing only approved leave cannot be reconciled against what was "
        "asked for. A request is placed in the period its leave STARTED in, "
        "so a leave straddling a period end appears once, at full length, in "
        "the earlier period. LIMITATIONS: leave dated in the future exists "
        "and will not appear until its period; a request whose employee "
        "record cannot be found is absent rather than attributed to nobody; "
        "no leave balance, entitlement or encashment value is shown, and no "
        "pay figure of any kind."
    ),
)
async def leave_register(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, LEAVE_KEY)
    rows = await pool.fetch(LEAVE_SQL, str(org_id), win.start, win.end,
                            ROW_CAP + 1)
    requests, dropped = capped([dict(r) for r in rows])
    return build_leave_rows(requests, dropped)


# ══════════════════════════════════════════════════════════════════════════
# E · manav.asset_register
# ══════════════════════════════════════════════════════════════════════════

ASSET_LABEL_COLUMN = "Asset"
ASSET_TOTAL_ROW = "All assets"
ASSET_MONEY_COLUMNS = ("Purchase cost",)

#: What an asset that was never issued prints in the holder column. Blank is
#: wrong here: a blank reads as "we do not know who has it", and "nobody has
#: it, it is in store" is a different and much better answer.
IN_STORE = "In store"

#: What an asset that came back prints. Also not blank, and deliberately not
#: the returning holder's name — the register's question is who has it NOW.
RETURNED = "Returned"

#: Every asset, one row, alphabetical by asset name. 100 rows live.
ASSET_SQL = (
    "SELECT a.name AS asset, "
    "       a.asset_tag AS tag, "
    "       a.category AS category, "
    "       a.serial_number AS serial_number, "
    "       e.name AS holder, "
    "       a.assigned_date AS assigned_on, "
    "       a.returned_date AS returned_on, "
    "       a.condition AS condition, "
    "       COALESCE(a.purchase_cost, 0)::float AS purchase_cost "
    "  FROM staging.manav_assets a "
    # LEFT: 30 of 100 assets are assigned to nobody and an INNER join would
    # drop them, turning a 100-asset register into a 70-asset one and
    # understating what the firm owns by every item sitting in the cupboard.
    # Org-scoped on both sides — no composite (id, org_id) FK exists.
    "  LEFT JOIN staging.manav_employees e "
    "    ON e.id = a.assigned_to AND e.org_id = a.org_id "
    " WHERE a.org_id = $1::uuid "
    " ORDER BY a.name, a.asset_tag "
    " LIMIT $2::int"
)


def _holder(asset: dict) -> str:
    """Who has it NOW — the only question a recovery sheet is asking.

    Three states, three words: a name while it is out, `Returned` once it
    came back, `In store` if it was never issued. Printing the last holder's
    name against a returned asset is how somebody gets rung up about a laptop
    they handed in.
    """
    if asset.get("returned_on") is not None:
        return RETURNED
    if asset.get("holder"):
        return str(asset["holder"])
    return IN_STORE


def build_asset_rows(assets: list, dropped: int = 0) -> list:
    """The table. Pure, so the outstanding arithmetic is testable without a
    database."""
    rows = [{
        ASSET_LABEL_COLUMN: str(a.get("asset") or UNNAMED),
        "Tag": str(a.get("tag") or "").strip(),
        "Category": str(a.get("category") or "").strip(),
        "Serial number": str(a.get("serial_number") or "").strip(),
        "Held by": _holder(a),
        "Assigned on": a.get("assigned_on"),
        "Returned on": a.get("returned_on"),
        "Condition": str(a.get("condition") or "").strip(),
        "Purchase cost": money(a.get("purchase_cost")),
    } for a in assets]
    if not rows:
        return []

    # The number the register exists for, stated rather than left to be
    # counted by hand off a hundred rows.
    out_now = [a for a in assets
               if a.get("returned_on") is None and a.get("holder")]
    out_cost = money(sum(money(a.get("purchase_cost")) for a in out_now))
    total_cost = money(sum(money(a.get("purchase_cost")) for a in assets))
    out = finish(rows, ASSET_LABEL_COLUMN, ASSET_TOTAL_ROW,
                 ASSET_MONEY_COLUMNS, dropped)
    out.append(_note_row(out, ASSET_LABEL_COLUMN, (
        f"{len(out_now):,} of {len(rows):,} assets are out and not yet "
        f"returned, {out_cost:,.2f} of {total_cost:,.2f} at purchase cost. "
        f"Purchase cost is what was PAID, not a written-down value — no "
        f"depreciation is recorded anywhere, so the Total is an original "
        f"cost and not a valuation. 'Held by' is who has it now: a returned "
        f"asset shows Returned rather than its last holder, and an asset "
        f"that was never issued shows In store.")))
    return out


@report_def(
    key=ASSET_KEY,
    module="manav",
    reads=frozenset({"manav"}),
    label="Asset register",
    grain="stock",
    sensitivity=PERSONAL,
    description=(
        "Every company asset as at today — name, tag, category, serial "
        "number, who holds it, when it went out, when it came back, its "
        "condition and what it cost. ALPHABETICAL BY ASSET; nothing is "
        "ordered by value and there is no rank of holders — this is a "
        "recovery sheet, not a judgement about anybody. Assets nobody holds "
        "are included, because a "
        "register that lists only issued items understates what the firm "
        "owns. 'Held by' answers who has it NOW: a returned asset shows "
        "Returned, not its last holder, and an unissued one shows In store. "
        "The note row states how many are out and unreturned and what they "
        "cost. LIMITATIONS: purchase cost is what was paid — no depreciation "
        "is recorded anywhere, so the total is original cost and not a "
        "valuation; there is no condition history, only the condition as it "
        "stands; and nothing links an unreturned asset to its holder's exit, "
        "so recovery has to be read against the employee master by hand."
    ),
)
async def asset_register(pool, org_id: str, window=None) -> list:
    """`window` is None by contract (grain='stock'): what is out is out."""
    rows = await pool.fetch(ASSET_SQL, str(org_id), ROW_CAP + 1)
    assets, dropped = capped([dict(r) for r in rows])
    return build_asset_rows(assets, dropped)


# ══════════════════════════════════════════════════════════════════════════
# F · manav.recruitment_pipeline
# ══════════════════════════════════════════════════════════════════════════

HIRING_LABEL_COLUMN = "Candidate"

#: Pipeline order for the `stage` column — a SERVER-SIDE allowlist, exactly
#: as the sort-key allowlists in the routers are, so no caller-supplied string
#: ever reaches an ORDER BY. This is the order of the FUNNEL, not a ranking of
#: candidates: rows within a stage are alphabetical.
#:
#: An unlisted stage sorts last rather than being dropped — the CHECK on this
#: column may admit values the live data has not used yet, and a candidate who
#: vanishes from the pipeline report because somebody added a stage is the
#: failure this ordering exists to avoid.
STAGE_ORDER = ("applied", "screening", "interview", "offer", "hired",
               "rejected")

_STAGE_RANK = (
    "CASE c.stage " +
    " ".join(f"WHEN '{s}' THEN {i}" for i, s in enumerate(STAGE_ORDER)) +
    f" ELSE {len(STAGE_ORDER)} END"
)

#: One row per candidate.
HIRING_SQL = (
    "SELECT c.full_name AS candidate, "
    "       j.title AS role, "
    "       c.stage AS stage, "
    "       c.created_at::date AS received, "
    "       c.rejection_reason AS rejection_reason "
    "  FROM staging.manav_candidates c "
    # LEFT and org-scoped on both sides. 101 of 101 join today; a candidate
    # whose opening was closed and removed is still a candidate.
    "  LEFT JOIN staging.manav_job_openings j "
    "    ON j.id = c.job_opening_id AND j.org_id = c.org_id "
    " WHERE c.org_id = $1::uuid "
    "   AND c.created_at::date BETWEEN $2::date AND $3::date "
    f" ORDER BY {_STAGE_RANK}, c.full_name "
    " LIMIT $4::int"
)


def build_hiring_rows(candidates: list, dropped: int = 0) -> list:
    """The table plus its stage tally. Pure."""
    rows = [{
        HIRING_LABEL_COLUMN: str(c.get("candidate") or UNNAMED),
        "Role": str(c.get("role") or "").strip(),
        # As recorded, never mapped: see STAGE_ORDER.
        "Stage": str(c.get("stage") or "").strip(),
        "Received": c.get("received"),
        # Free text, and only ever filled on a rejection. It is the one field
        # here a person may have written a sentence in, and it is printed as
        # written.
        "Reason if rejected": str(c.get("rejection_reason") or "").strip(),
    } for c in candidates]
    if not rows:
        return []

    tally: dict = {}
    for row in rows:
        stage = row["Stage"] or "(no stage)"
        tally[stage] = tally.get(stage, 0) + 1
    ordered = [s for s in STAGE_ORDER if s in tally]
    ordered += sorted(s for s in tally if s not in STAGE_ORDER)
    counted = ", ".join(f"{s} {tally[s]:,}" for s in ordered)

    out = [*rows]
    if dropped:
        out.append(overflow_row(out, HIRING_LABEL_COLUMN, dropped))
    out.append(_note_row(out, HIRING_LABEL_COLUMN, (
        f"{len(rows):,} candidates received in this period — {counted}. "
        f"Rows are grouped in FUNNEL order and are alphabetical inside each "
        f"stage; a candidate is never ranked against another. Stage is the "
        f"CURRENT stage, not a history: nothing records when a candidate "
        f"moved, so this page cannot say how long anyone has sat where they "
        f"are. TIME TO HIRE IS NOT COMPUTABLE AT ALL — a hired candidate "
        f"carries no link to the employee record they became, so there is no "
        f"end date to measure to.")))
    return out


@report_def(
    key=HIRING_KEY,
    module="manav",
    reads=frozenset({"manav"}),
    label="Recruitment pipeline",
    grain="flow",
    sensitivity=PERSONAL,
    description=(
        "Every candidate received in the period, one row each, grouped in "
        "funnel order — applied, screening, interview, offer, hired, "
        "rejected — and ALPHABETICAL WITHIN EACH STAGE. Candidates are never "
        "ranked against one another and no score is shown. The note row "
        "carries the stage tally. Stage is where the candidate stands NOW, "
        "not a history: nothing records when anyone moved between stages, so "
        "this page cannot say how long a candidate has waited. TIME TO HIRE "
        "IS NOT COMPUTABLE — the link from a hired candidate back to the "
        "employee record they became is empty on every row in the database, "
        "so there is no end date to measure to, and no approximation of it "
        "is offered here. A candidate whose job opening no longer exists is "
        "still listed, with a blank role. Carries no resume, no contact "
        "detail and no interviewer note."
    ),
)
async def recruitment_pipeline(pool, org_id: str, window=None) -> list:
    win = window_or_raise(window, HIRING_KEY)
    rows = await pool.fetch(HIRING_SQL, str(org_id), win.start, win.end,
                            ROW_CAP + 1)
    candidates, dropped = capped([dict(r) for r in rows])
    return build_hiring_rows(candidates, dropped)
