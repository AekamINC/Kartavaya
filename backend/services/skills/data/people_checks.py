"""
people_checks — the four payroll and HR skills that sit either side of the run.

`payroll_readiness.check_payroll_readiness` already answers "would this month's
run be WRONG". These four answer the questions on either side of it:

  check_statutory_records_gate  would the FILING that follows the run bounce
  brief_statutory_dues          what the run that already happened now owes
  check_attendance_exceptions   what the attendance record cannot support
  brief_unpaid_reimbursements   what was approved and never actually paid

Each is deliberately narrow, and each stops where the data stops. Every figure
below is drawn from a column that exists and is populated; where a column exists
and is EMPTY, that is reported as a finding rather than hidden, and where the
question cannot be answered at all the output says which question was not asked.

── The posture: report, never refuse ────────────────────────────────────────

Nothing here blocks a payroll run. A missing UAN is a real problem — the ECR
upload bounces at the EPFO portal and somebody walks back through ninety records
by hand — but it is not a reason for this software to refuse to pay people. This
is the same posture GSTIN/PAN/TAN take everywhere else in the product: they are
NON-MANDATORY and block nothing. The value of these skills is that the ninety
records are walked back BEFORE the upload, not that the upload is prevented.

── Measured on the seeded org (64e7bea6…), read-only, 2026-08-20 ────────────

  · 71 active employees, 60 with an active salary structure, 9 departments —
    and 11 of the 71 carry `department = ''` (an empty string, not NULL), which
    is why every grouping here uses NULLIF(btrim(...), '').
  · PF is enabled on all 60 structures and NOT ONE of the 71 employees carries
    a UAN. That is the whole payroll population, so `check_statutory_records_gate`
    returns 60 findings across 8 departments on its first run.
  · ESI is enabled on zero structures, so `total_esi` is 0.00 on every run in
    the register and the ESI leg of both skills is genuinely nil.
  · 59 employees had TDS deducted on their latest payslip and every one of them
    has a PAN. The PAN check returns nothing — which is why it reports its
    denominator: "0 of 59 checked" and "check skipped" must not look alike.
  · manav_attendance holds 284 rows over 4 days, ALL of them 'weekend' or
    'holiday', and `check_in` is NULL on every single one. There is no punch
    data in this org at all. See `check_attendance_exceptions`, which detects
    that and says so instead of emitting a wall of false findings.
  · The 2026-07 run has status 'processed' with `approved_at` set and
    `processed_at` an hour LATER — a run that was approved, reopened and
    reprocessed. The status is authoritative and the timestamp is stale, which
    is exactly the error the processed-but-never-approved flag is for.

── No images, ever ──────────────────────────────────────────────────────────

Two of these are statutory briefs. A template that schedules any of them must
leave `generate_image` off: an image costs $0.036–0.040 a call and is 79% of all
AI spend to date, and a picture on a compliance page adds nothing a preparer can
file.
"""
import logging
from datetime import date, timedelta

from services.on_the_rolls import still_on_the_rolls
from services.statute import obligation
from services.skills.reachable import reachable
from services.skills.timeutil import as_date, utc_now

log = logging.getLogger(__name__)

#: The obligation keys in `staging.statute_calendar` these skills read. Named
#: here rather than inline so the gaps below are visible in one place.
#:
#: WHAT THE CATALOGUE DOES NOT CARRY, measured 2026-08-20 against the live 28
#: rows, and therefore what this module refuses to print:
#:
#:   · There is NO key for the monthly TDS deposit (the challan, ordinarily due
#:     on the 7th). `tds.statement.salary` is the QUARTERLY STATEMENT and its
#:     `due_day` is NULL. So the TDS line below names its form and section and
#:     says the catalogue records no due date — it does not print the 7th from
#:     memory. Hardcoding a due day here is precisely the defect
#:     `services/statute.py` exists to remove.
#:   · There is NO key for professional tax at all. PT is a STATE levy — the
#:     due day differs by state and by slab, and `statute_calendar` supports a
#:     `state_code` tier for exactly this — so the PT line carries its amount
#:     and no date.
#:   · `tds.higher_rate_no_pan` carries a section (s.206AA before 1 April 2026,
#:     s.397(2) from that date) and `rate_percent` IS NULL on both versions. The
#:     rate is therefore not printed either. See `_no_pan_consequence`.
PF_KEY = "epf.remittance"
ESI_KEY = "esi.remittance"
TDS_STATEMENT_KEY = "tds.statement.salary"
NO_PAN_KEY = "tds.higher_rate_no_pan"

#: A payroll run whose figures are settled. `process_payroll` writes 'processed'
#: and `approve_payroll` moves it to 'approved'; disbursement moves it on again
#: to 'disbursed', which is downstream of approval and therefore also approved.
#:
#: STATUS IS THE AUTHORITY, NOT `approved_at`. The seeded org's 2026-07 run
#: carries an `approved_at` of 2026-08-03 20:24 and a `processed_at` of 21:15 —
#: approved, then reopened and reprocessed, with the approval timestamp left
#: behind. Reading `approved_at IS NOT NULL` would call that run approved and
#: report an unapproved month's PF as a settled liability.
APPROVED_STATUSES = ("approved", "disbursed")

#: Ageing buckets for approved-but-unpaid claims. The brief for this handler
#: said "0-15 / 16-30 / 30+", and 30 falls in two of those. Resolved to 31+ for
#: the last bucket and stated on the output, because a claim that lands in two
#: buckets makes the bucket totals add up to more than the headline.
AGE_BUCKETS = ("0-15 days", "16-30 days", "31+ days")


# ── small calendar helpers ───────────────────────────────────────────────────

def _month_bounds(month: str) -> tuple[date, date]:
    """'YYYY-MM' -> (first day, last day). Raises ValueError on anything else.

    The month range is checked HERE rather than left to `date()`, because month
    0 is the one bad value `date()` accepts by accident: `date(y, 0 + 1, 1)` is
    a valid 1 January, so '2026-00' would sail through and come back as a window
    in the wrong YEAR. A zero is exactly what a caller building the string from
    an off-by-one month index produces.
    """
    year, mon = (int(p) for p in month.split("-", 1))
    if not 1 <= mon <= 12:
        raise ValueError(month)
    first = date(year, mon, 1)
    nxt = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    return first, date.fromordinal(nxt.toordinal() - 1)


def _previous_month(month: str) -> str:
    year, mon = (int(p) for p in month.split("-", 1))
    return f"{year - 1}-12" if mon == 1 else f"{year}-{mon - 1:02d}"


def _add_months(day: date, months: int) -> date:
    """Shift a date by whole months, clamped to the end of the target month.

    31 January + 1 month is 28 February, not an exception. Without the clamp a
    due day of 31 in a 30-day month raises and takes the whole brief down over a
    calendar detail nobody was asking about.
    """
    total = (day.year * 12 + day.month - 1) + months
    year, mon = divmod(total, 12)
    mon += 1
    nxt = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    last = date.fromordinal(nxt.toordinal() - 1).day
    return date(year, mon, min(day.day, last))


def _statutory_due_date(period_end: date, row: dict | None) -> date | None:
    """The date the statute names, from the catalogue row. None when it doesn't.

    `due_month_offset` is how many months after the period the obligation falls
    due — 1 for both PF and ESI, which are due on the 15th of the month AFTER
    the wage month. `due_day` NULL means the catalogue records no day, and the
    honest answer is then no date at all rather than a guess.
    """
    if not row or row.get("due_day") is None:
        return None
    target = _add_months(period_end.replace(day=1), int(row.get("due_month_offset") or 0))
    nxt = _add_months(target, 1)
    last = date.fromordinal(nxt.toordinal() - 1).day
    return target.replace(day=min(int(row["due_day"]), last))


def _work_by(due: date | None, closed: set[date]) -> date | None:
    """The last working day ON OR BEFORE the statutory date.

    BACKWARDS, never forwards, and that direction is the whole point. A statutory
    deadline does not move because the office is shut: PF for a wage month is due
    on the 15th whether or not the 15th is Independence Day, and the interest and
    the damages run from the 16th regardless. So the TASK is pulled earlier to
    the last day somebody can actually act, and the statutory date is printed
    beside it, unshifted and labelled, on every line this touches.

    A holiday run that walks off the end (a fortnight of consecutive closures,
    which no calendar has) stops after 14 hops and returns the statutory date
    itself rather than looping.
    """
    if due is None:
        return None
    day = due
    for _ in range(14):
        if day.weekday() < 5 and day not in closed:
            return day
        day -= timedelta(days=1)
    return due


def _no_pan_consequence(row: dict | None) -> str:
    """The sentence about deducting without a PAN, built from the catalogue.

    The section is READ, never written into this file. It was s.206AA until
    31 March 2026 and is s.397(2) from 1 April 2026 under the Income-tax Act
    2025, and a skill that printed either one from memory would be wrong for
    half of every year the renumbering straddles.

    The RATE is not printed. `rate_percent` is NULL on both versions of this row
    in the live catalogue, and the higher rate under this section is not a single
    number anyway — it is the higher of several rates — so putting one figure on
    a compliance page would be inventing law the catalogue deliberately does not
    assert. If a rate is ever seeded onto the row, this prints it.
    """
    if not row:
        return (
            "Deducting tax for an employee with no PAN on record attracts a "
            "higher rate of deduction. The statute catalogue records no version "
            "of that obligation, so no section is cited here — a citation this "
            "skill made up would be worse than none."
        )
    section = row.get("section_ref") or "the higher-rate provision"
    rate = row.get("rate_percent")
    rate_txt = (
        f" The catalogue puts the rate at {float(rate):g}%."
        if rate is not None else
        " The catalogue records no rate for it, so none is stated here."
    )
    return (
        f"Where tax is deducted and the payee has no operative PAN, deduction is "
        f"at the higher rate under {section} "
        f"({row.get('title') or 'higher rate of deduction'})."
        f"{rate_txt} The deductor bears the shortfall, and the defect travels "
        f"into the TDS statement."
    )


async def _closed_days(pool, org_id: str, start: date, end: date) -> set[date]:
    """Non-optional org holidays in a window, as dates.

    OPTIONAL holidays are excluded on purpose: an optional holiday is a day the
    office is open and an individual may take off, so pulling a statutory task
    earlier for one would move real work for no reason. `hr_holidays` is not
    read — it exists in the schema and holds zero rows in every org, while
    `manav_holidays` holds all 38 that exist.
    """
    rows = await pool.fetch(
        """
        SELECT h.date
        FROM public.manav_holidays h
        WHERE h.org_id = $1::uuid
          AND h.date >= $2::date AND h.date <= $3::date
          AND COALESCE(h.is_optional, FALSE) = FALSE
        """,
        org_id, start, end,
    )
    return {d for d in (as_date(r["date"]) for r in rows) if d is not None}


# ── 1 · check_statutory_records_gate ─────────────────────────────────────────

async def check_statutory_records_gate(pool, org_id: str, limit: int = 200) -> dict:
    """Employees whose statutory identifiers are missing for a deduction the
    payroll run will make anyway.

    Three findings, and each one is a JOIN nothing in the product performs:

      pf_enabled_no_uan     the salary structure has `pf_enabled`, the employee
                            has no UAN. The ECR file names a member account that
                            does not exist and the upload bounces at the EPFO
                            portal — after the run, after the money moved.
      esi_enabled_no_number the structure has `esi_enabled`, the employee has no
                            insurance number, so the contribution cannot be
                            credited to their ESIC record.
      tds_deducted_no_pan   tax was deducted on the latest payslip and there is
                            no PAN. This is the one that carries money: the
                            higher-rate provision (read from the statute
                            catalogue, never hardcoded) makes the deductor bear
                            the shortfall.

    Both columns of every pair already exist and are populated for some rows. The
    gap this closes is that nothing has ever read them TOGETHER — a UAN is
    missing in Manav and PF is enabled in Vetana, and no screen shows both.

    REPORTS, NEVER BLOCKS. Same posture as GSTIN/PAN/TAN everywhere else: these
    are non-mandatory fields and this handler is a list to work through, not a
    gate on paying people.

    Returns {as_at, findings, by_department, counts, coverage, caveats}.
    """
    as_at = utc_now().date()

    # The higher-rate section is resolved as at TODAY, not as at a payslip month,
    # because this check is about a deduction somebody is about to make on the
    # next run. `obligation` takes `as_of` keyword-only with no default,
    # deliberately, so the anchor has to be stated rather than assumed.
    no_pan_row = await obligation(pool, NO_PAN_KEY, as_of=as_at)

    rows = await pool.fetch(
        f"""
        WITH structure AS (
            -- The structure the run would actually use: the latest active one.
            -- `updated_at DESC, id` breaks a tie on effective_from, which two
            -- structures created the same day would otherwise resolve at random,
            -- making this handler report a different answer on each run.
            SELECT DISTINCT ON (s.employee_id)
                   s.employee_id, s.pf_enabled, s.esi_enabled, s.effective_from
            FROM public.vetana_salary_structures s
            WHERE s.org_id = $1::uuid AND s.is_active = TRUE
            ORDER BY s.employee_id, s.effective_from DESC, s.updated_at DESC, s.id
        ),
        payslip AS (
            -- `month` is text 'YYYY-MM', which sorts correctly as text. Ordering
            -- on created_at instead would pick whichever row was WRITTEN last,
            -- and a back-dated correction run writes an older month after a
            -- newer one.
            SELECT DISTINCT ON (p.employee_id) p.employee_id, p.month, p.tds
            FROM public.vetana_payslips p
            WHERE p.org_id = $1::uuid AND p.is_active = TRUE
            ORDER BY p.employee_id, p.month DESC, p.created_at DESC
        ),
        emp AS (
            SELECT e.id, e.name, e.employee_code, e.email, e.phone,
                   COALESCE(NULLIF(btrim(e.department), ''), '(no department)') AS department,
                   NULLIF(btrim(e.uan), '')        AS uan,
                   NULLIF(btrim(e.esi_number), '') AS esi_number,
                   NULLIF(btrim(e.pan), '')        AS pan
            FROM public.manav_employees e
            -- STOCK. `as_at` above is TODAY and the whole handler is about a
            -- deduction somebody is ABOUT TO MAKE on the next run, so the
            -- population is who is on the rolls now. `is_active` alone does not
            -- say that: a leaver keeps the flag on purpose until their exit is
            -- settled (`services/on_the_rolls.py`), and E2E's roster read 83 on
            -- the flag against 73 on the fact on 2026-08-26.
            WHERE e.org_id = $1::uuid AND e.is_active = TRUE
              {still_on_the_rolls("e")}
        )
        SELECT 'pf_enabled_no_uan'::text AS check_code, e.name AS employee_name,
               e.employee_code, e.department, e.id AS employee_id,
               e.email AS employee_email, e.phone AS employee_phone,
               'provident fund is enabled on the salary structure effective '
                 || st.effective_from::text
                 || ' and no UAN is on record'::text AS detail,
               NULL::text AS payslip_month
        FROM emp e JOIN structure st ON st.employee_id = e.id
        WHERE st.pf_enabled AND e.uan IS NULL
        UNION ALL
        SELECT 'esi_enabled_no_number', e.name, e.employee_code, e.department,
               e.id, e.email, e.phone,
               'ESI is enabled on the salary structure effective '
                 || st.effective_from::text
                 || ' and no insurance number is on record',
               NULL
        FROM emp e JOIN structure st ON st.employee_id = e.id
        WHERE st.esi_enabled AND e.esi_number IS NULL
        UNION ALL
        -- Evidence, not estimate: tax that WAS deducted on the most recent
        -- payslip. Re-deriving what TDS "should" be from the salary structure
        -- would mean copying the slab table out of routers/vetana.py into a
        -- skill, and a second copy of the slabs is a second thing to get wrong
        -- every Budget.
        SELECT 'tds_deducted_no_pan', e.name, e.employee_code, e.department,
               e.id, e.email, e.phone,
               'tax of ' || ps.tds::text || ' was deducted on the '
                 || ps.month || ' payslip and no PAN is on record',
               ps.month
        FROM emp e JOIN payslip ps ON ps.employee_id = e.id
        WHERE ps.tds > 0 AND e.pan IS NULL
        ORDER BY check_code, department, employee_name
        LIMIT $2
        """,
        org_id, limit,
    )

    # The denominators. A check that found nothing and a check that never ran
    # look identical on an empty list, and on a compliance page they must not:
    # the seeded org returns zero PAN findings out of 59 employees who had tax
    # deducted, and "0 of 59" is a result while "0" alone reads as a skip.
    cov = await pool.fetchrow(
        f"""
        WITH structure AS (
            SELECT DISTINCT ON (s.employee_id) s.employee_id, s.pf_enabled, s.esi_enabled
            FROM public.vetana_salary_structures s
            WHERE s.org_id = $1::uuid AND s.is_active = TRUE
            ORDER BY s.employee_id, s.effective_from DESC, s.updated_at DESC, s.id
        ),
        payslip AS (
            SELECT DISTINCT ON (p.employee_id) p.employee_id, p.tds
            FROM public.vetana_payslips p
            WHERE p.org_id = $1::uuid AND p.is_active = TRUE
            ORDER BY p.employee_id, p.month DESC, p.created_at DESC
        ),
        emp AS (
            -- The SAME population as the findings query above, guard included.
            -- These two numbers are printed against each other — "0 of 59" —
            -- and a numerator drawn from one roster over a denominator drawn
            -- from another is a worse answer than either number on its own.
            SELECT e.id FROM public.manav_employees e
            WHERE e.org_id = $1::uuid AND e.is_active = TRUE
              {still_on_the_rolls("e")}
        )
        SELECT (SELECT count(*) FROM emp) AS active_employees,
               (SELECT count(*) FROM emp e JOIN structure s ON s.employee_id = e.id
                 WHERE s.pf_enabled)  AS pf_enabled,
               (SELECT count(*) FROM emp e JOIN structure s ON s.employee_id = e.id
                 WHERE s.esi_enabled) AS esi_enabled,
               (SELECT count(*) FROM emp e JOIN payslip p ON p.employee_id = e.id
                 WHERE p.tds > 0)     AS tds_deducted,
               (SELECT count(*) FROM emp e LEFT JOIN structure s ON s.employee_id = e.id
                 WHERE s.employee_id IS NULL) AS no_structure
        """,
        org_id,
    )
    cov = dict(cov) if cov else {
        "active_employees": 0, "pf_enabled": 0, "esi_enabled": 0,
        "tds_deducted": 0, "no_structure": 0,
    }

    findings: list[dict] = []
    by_dept: dict[str, dict] = {}
    for r in rows:
        item = reachable({
            "check": r["check_code"],
            "employee": r["employee_name"],
            "employee_code": r["employee_code"],
            "department": r["department"],
            "detail": r["detail"],
        }, kind="employee", entity_id=r["employee_id"],
            email=r["employee_email"], phone=r["employee_phone"])
        if r["payslip_month"]:
            item["payslip_month"] = r["payslip_month"]
        findings.append(item)

        # Grouped by DEPARTMENT and not by reporting manager, and that is not a
        # preference. `manav_employees.reporting_to` is TEXT holding nothing at
        # all — 0 of 71 rows in the seeded org carry a value — and it is declared
        # TEXT against a uuid `id`, so even populated it would need a cast that
        # throws on the first free-text name somebody typed into it.
        slot = by_dept.setdefault(
            r["department"], {"department": r["department"], "findings": 0})
        slot["findings"] += 1
        slot[r["check_code"]] = slot.get(r["check_code"], 0) + 1

    counts = {c: sum(1 for f in findings if f["check"] == c) for c in (
        "pf_enabled_no_uan", "esi_enabled_no_number", "tds_deducted_no_pan")}

    out = {
        "as_at": as_at.isoformat(),
        "what_this_is": (
            "Statutory identifiers missing for a deduction the payroll run makes "
            "anyway. It REPORTS and does not block: UAN, ESI number and PAN are "
            "non-mandatory fields here and always will be. The cost of a gap is "
            "paid later, at the portal."
        ),
        "findings": findings,
        "by_department": sorted(
            by_dept.values(), key=lambda d: (-d["findings"], d["department"])),
        "counts": counts,
        "coverage": {
            "active_employees": cov["active_employees"],
            "pf_enabled_checked": cov["pf_enabled"],
            "esi_enabled_checked": cov["esi_enabled"],
            "tds_deducted_checked": cov["tds_deducted"],
        },
        "why_the_pan_one_matters": _no_pan_consequence(no_pan_row),
        "caveats": [],
    }

    if cov["no_structure"]:
        out["caveats"].append(
            f"{cov['no_structure']} active employee(s) have no active salary "
            f"structure, so no PF or ESI flag exists for them and they are not "
            f"checked here at all. They are a finding of a different skill — "
            f"`check_payroll_readiness` reports them as `no_salary_structure`, "
            f"where the consequence is that the run omits them entirely."
        )
    for code, denom, label in (
        ("pf_enabled_no_uan", cov["pf_enabled"], "have provident fund enabled"),
        ("esi_enabled_no_number", cov["esi_enabled"], "have ESI enabled"),
        ("tds_deducted_no_pan", cov["tds_deducted"],
         "had tax deducted on their latest payslip"),
    ):
        if not counts[code]:
            out["caveats"].append(
                f"{code}: nothing found, out of {denom} employee(s) who {label}. "
                f"That is a result, not a check that was skipped."
                + ("" if denom else " Nobody is in scope for it at all.")
            )
    if len(rows) == limit:
        out["caveats"].append(
            f"TRUNCATED at {limit} findings, ordered by check then department. "
            f"The counts above are a floor, not the total — there are more "
            f"records with a missing identifier than are listed here."
        )
    return out


# ── 2 · brief_statutory_dues ─────────────────────────────────────────────────

async def brief_statutory_dues(pool, org_id: str, month: str | None = None,
                               limit: int = 12) -> dict:
    """What the last approved payroll run owes, when, and last month beside it.

    *month* is the WAGE month ('YYYY-MM') and defaults to the latest run that is
    actually approved — never the wall clock, and never simply the latest row. A
    default of "this month" would report an empty liability for a month nobody
    has run yet; a default of "the latest row" would report figures off a run
    that is still being edited.

    It must have a default at all because the dispatcher refuses any handler
    declaring a parameter nobody supplied, so a required `month` would make this
    unschedulable — and a statutory-dues brief nobody can schedule is a brief
    nobody reads. `tests/test_a_skill_can_run_unattended.py` pins that.

    Returns {month, run_status, dues, comparison, unapproved_runs,
             not_in_the_statute_catalogue, caveats}.
    """
    subject = await pool.fetchrow(
        """
        SELECT r.month, r.status, r.employee_count,
               COALESCE(r.total_pf, 0)    AS total_pf,
               COALESCE(r.total_esi, 0)   AS total_esi,
               COALESCE(r.total_pt, 0)    AS total_pt,
               COALESCE(r.total_tds, 0)   AS total_tds,
               COALESCE(r.total_gross, 0) AS total_gross
        FROM public.vetana_payroll_runs r
        WHERE r.org_id = $1::uuid
          -- $2 NULL means "the latest approved one". Written as an OR over one
          -- cast parameter rather than as two queries, so there is a single
          -- definition of what an approved run is.
          AND ($2::text IS NULL OR r.month = $2::text)
          AND ($2::text IS NOT NULL OR r.status = ANY($3::text[]))
        ORDER BY r.month DESC
        LIMIT 1
        """,
        org_id, month, list(APPROVED_STATUSES),
    )

    if subject is None:
        return {
            "month": month,
            "dues": [],
            "caveats": [
                (f"No payroll run exists for {month}." if month else
                 "No approved payroll run exists for this organisation at all."),
                "That is a finding, not a skipped check: nothing has been "
                "processed and approved, so no statutory liability has been "
                "created by a payroll run.",
            ],
        }

    subject_month = subject["month"]
    prior_month = _previous_month(subject_month)
    prior = await pool.fetchrow(
        """
        SELECT r.month, r.status,
               COALESCE(r.total_pf, 0)  AS total_pf,
               COALESCE(r.total_esi, 0) AS total_esi,
               COALESCE(r.total_pt, 0)  AS total_pt,
               COALESCE(r.total_tds, 0) AS total_tds
        FROM public.vetana_payroll_runs r
        WHERE r.org_id = $1::uuid AND r.month = $2::text
        """,
        org_id, prior_month,
    )

    # Runs that were PROCESSED and never APPROVED. `vetana_payroll_runs.status`
    # makes this free, and it catches a real error: a month whose payslips exist,
    # whose figures look settled on every dashboard that sums payslips, and whose
    # approval nobody ever pressed. The liability is real and the month is
    # invisible. The seeded org has exactly one — 2026-07 — and it carries a
    # STALE `approved_at`, which is why the predicate is on status alone.
    stranded = await pool.fetch(
        """
        SELECT r.month, r.employee_count,
               COALESCE(r.total_pf, 0) + COALESCE(r.total_esi, 0)
                 + COALESCE(r.total_pt, 0) + COALESCE(r.total_tds, 0)
                                                    AS statutory_total,
               r.approved_at IS NOT NULL            AS carries_stale_approval
        FROM public.vetana_payroll_runs r
        WHERE r.org_id = $1::uuid AND r.status = 'processed'
        ORDER BY r.month DESC
        LIMIT $2
        """,
        org_id, limit,
    )

    _, period_end = _month_bounds(subject_month)

    # Every statutory fact below is resolved AS AT THE END OF THE WAGE MONTH, not
    # as at today. The wage month is when the obligation arose, and the
    # Income-tax Act 2025 renumbering on 1 April 2026 means a run for March 2026
    # prepared in May 2026 must cite the OLD form. Passing today's date here is
    # the exact bug `services/statute.py` refuses to let a default introduce.
    pf_row = await obligation(pool, PF_KEY, as_of=period_end)
    esi_row = await obligation(pool, ESI_KEY, as_of=period_end)
    tds_row = await obligation(pool, TDS_STATEMENT_KEY, as_of=period_end)

    pf_due = _statutory_due_date(period_end, pf_row)
    esi_due = _statutory_due_date(period_end, esi_row)
    tds_due = _statutory_due_date(period_end, tds_row)

    horizon = [d for d in (pf_due, esi_due, tds_due) if d]
    closed: set[date] = set()
    if horizon:
        closed = await _closed_days(
            pool, org_id, min(horizon) - timedelta(days=14), max(horizon))

    def _piece(code, label, amount, row, due, note):
        prior_amount = float(prior[code] or 0) if prior else None
        entry = {
            "code": code,
            "liability": label,
            "amount": round(float(amount or 0), 2),
            "last_month": {
                "month": prior_month,
                "amount": round(prior_amount, 2) if prior_amount is not None else None,
                "run_status": prior["status"] if prior else None,
                "change": (round(float(amount or 0) - prior_amount, 2)
                           if prior_amount is not None else None),
            },
            "authority": (row or {}).get("authority"),
            "form": (row or {}).get("form_number"),
            "section": (row or {}).get("section_ref"),
            # UNSHIFTED, and labelled as such on every line. A deadline does not
            # move because the office is shut.
            "statutory_due_date": due.isoformat() if due else None,
            "note": note,
        }
        if due is None:
            entry["statutory_due_date_note"] = (
                "The statute catalogue records no due day for this obligation, "
                "so none is printed. A date invented here would look statutory "
                "and would not be."
            )
        else:
            work_by = _work_by(due, closed)
            entry["work_by_date"] = work_by.isoformat() if work_by else None
            if work_by and work_by != due:
                entry["work_by_note"] = (
                    f"The statutory date {due.isoformat()} falls on a weekend or "
                    f"an organisation holiday. The TASK has been pulled back to "
                    f"{work_by.isoformat()}; THE DEADLINE HAS NOT MOVED and any "
                    f"interest runs from the day after {due.isoformat()}."
                )
        return entry

    dues = [
        _piece("total_pf", "Provident fund contribution (ECR)",
               subject["total_pf"], pf_row, pf_due,
               "EMPLOYEE AND EMPLOYER COMBINED. `process_payroll` writes "
               "`total_pf` as pf_employee + pf_employer, which is the figure "
               "remitted — but it is not the employee-side deduction, and a "
               "reader reconciling against payslips must split it there."),
        _piece("total_esi", "Employees' State Insurance contribution",
               subject["total_esi"], esi_row, esi_due,
               "EMPLOYEE AND EMPLOYER COMBINED, same as PF."),
        _piece("total_pt", "Professional tax",
               subject["total_pt"], None, None,
               "Professional tax is a STATE levy and the statute catalogue holds "
               "no row for it — the due day and the slab differ by state. The "
               "amount is the run's; the date must come from the state's own "
               "schedule."),
        _piece("total_tds", "Tax deducted at source on salary",
               subject["total_tds"], tds_row, tds_due,
               "The amount is the tax deducted in the wage month. The catalogue "
               "row named here is the QUARTERLY STATEMENT, not the monthly "
               "deposit challan: no monthly-deposit obligation is catalogued, so "
               "no deposit date is printed."),
    ]

    total = round(sum(d["amount"] for d in dues), 2)

    out = {
        "month": subject_month,
        "run_status": subject["status"],
        "employees_in_run": subject["employee_count"],
        "gross_payroll": round(float(subject["total_gross"] or 0), 2),
        "statutory_total": total,
        "dues": dues,
        "comparison": {
            "against_month": prior_month,
            "run_found": prior is not None,
            "run_status": prior["status"] if prior else None,
        },
        "deadlines_do_not_move": (
            "Every `statutory_due_date` above is the date the statute names, "
            "unshifted. Where a `work_by_date` is also given it is EARLIER — the "
            "last working day on or before the deadline — because the office "
            "being shut is a reason to act sooner, never a reason to file later."
        ),
        "unapproved_runs": [
            {
                "month": r["month"],
                "employees": r["employee_count"],
                "statutory_total": round(float(r["statutory_total"] or 0), 2),
                "carries_stale_approval_timestamp": r["carries_stale_approval"],
            }
            for r in stranded
        ],
        "not_in_the_statute_catalogue": [
            "The monthly TDS deposit challan — there is no catalogued obligation "
            "for it, so no deposit date appears above.",
            "Professional tax — a state levy with no row in the catalogue.",
        ],
        "caveats": [],
    }

    if prior is None:
        out["caveats"].append(
            f"No payroll run exists for {prior_month}, so every `last_month` "
            f"figure above is null. The month-on-month comparison was not made — "
            f"it is absent, not zero."
        )
    elif prior["status"] not in APPROVED_STATUSES:
        out["caveats"].append(
            f"The {prior_month} run has status '{prior['status']}' and is not "
            f"approved. Its figures are shown for comparison and may still change."
        )
    if subject["status"] not in APPROVED_STATUSES:
        out["caveats"].append(
            f"The {subject_month} run was requested explicitly and has status "
            f"'{subject['status']}' — it is NOT approved, so these figures are "
            f"not yet a settled liability."
        )
    for r in stranded:
        if r["month"] == subject_month:
            continue
        note = (
            f"The {r['month']} run is 'processed' and was never approved. It "
            f"carries {round(float(r['statutory_total'] or 0), 2)} of statutory "
            f"liability that no approval has ever been pressed on."
        )
        if r["carries_stale_approval"]:
            note += (
                " It also carries an `approved_at` timestamp, left behind by an "
                "approval that was later reopened — the STATUS is authoritative, "
                "the timestamp is stale."
            )
        out["caveats"].append(note)
    if len(stranded) == limit:
        out["caveats"].append(
            f"TRUNCATED: only the {limit} most recent unapproved runs are listed. "
            f"There are more."
        )
    if not total:
        out["caveats"].append(
            f"The {subject_month} run created no statutory liability at all — "
            f"PF, ESI, PT and TDS are all nil on it. That is a finding, not a "
            f"skipped check."
        )
    elif not float(subject["total_esi"] or 0):
        out["caveats"].append(
            "ESI is nil on this run. Where ESI is enabled on no salary structure "
            "that is correct — but a nil ESI line in an organisation whose "
            "employees earn under the wage ceiling is worth a second look."
        )
    return out


# ── 3 · check_attendance_exceptions ──────────────────────────────────────────

async def check_attendance_exceptions(pool, org_id: str, month: str | None = None,
                                      limit: int = 200) -> dict:
    """What the attendance record cannot support, before the payroll cutoff.

    Run three days before cutoff: every finding here is still fixable then and
    none of it is fixable after the run.

    ── THIS OVERLAPS `check_payroll_readiness` AND SAYS WHERE ────────────────

    That handler already reports `no_attendance_recorded` — an employee with no
    attendance row ANYWHERE in the month, which makes the run pay a full working
    month unverified — and `unapproved_leave`, a leave request still pending. The
    two genuinely new facts are `unclosed_punch` and `leave_beyond_balance`. The
    two that only LOOK like duplicates:

      no_attendance_on_working_day   DAY-level, not month-level. An employee with
                                     one row in the month passes the readiness
                                     check and can still be missing nineteen days.
      absent_without_approved_leave  a row that says 'absent' with no approved
                                     leave behind it. `unapproved_leave` is about
                                     a PENDING REQUEST; this is about an absence
                                     with no request at all, which is the more
                                     common case and is detected nowhere else.

    Grouped by DEPARTMENT and never by reporting manager: `reporting_to` is
    unwritten on all 98 employee rows and is declared TEXT against a uuid id.

    Returns {month, window, findings, by_department, counts, punch_data, caveats}.
    """
    today = utc_now().date()
    month = month or today.strftime("%Y-%m")
    try:
        month_start, month_end = _month_bounds(month)
    except (ValueError, AttributeError, TypeError):
        return {"error": f"'{month}' is not a month. Expected YYYY-MM, e.g. 2026-08."}

    # Never look past today. A working day in the future has no attendance yet
    # and is not an exception; counting it would put every employee at the top of
    # the list for days that have not happened.
    window_end = min(month_end, today)
    if window_end < month_start:
        return {
            "month": month,
            "window": {"from": month_start.isoformat(), "to": None},
            "findings": [],
            "counts": {},
            "caveats": [
                f"{month} has not started yet, so there is nothing to check. "
                f"That is a finding, not a skipped check."
            ],
        }

    findings: list[dict] = []
    truncated: list[str] = []

    # (a) An open punch: checked in, never checked out. STRICTLY BEFORE TODAY —
    # an open punch today is somebody still at their desk, and flagging it would
    # make this skill cry wolf every single morning.
    open_punches = await pool.fetch(
        """
        SELECT e.name AS employee_name, e.id AS employee_id,
               -- The key `services/skill_ack_wiring.py` files an acknowledgement
               -- under. The NAME is not one: ten names in the largest org are
               -- carried by three active people each, so an ack keyed on it
               -- would silence two colleagues' exceptions along with the one
               -- somebody actually read.
               e.employee_code,
               e.email AS employee_email, e.phone AS employee_phone,
               COALESCE(NULLIF(btrim(e.department), ''), '(no department)') AS department,
               a.date, a.status
        FROM public.manav_attendance a
        JOIN public.manav_employees e ON e.id = a.employee_id AND e.org_id = a.org_id
        WHERE a.org_id = $1::uuid
          AND a.date >= $2::date AND a.date <= $3::date
          AND a.date < $4::date
          AND a.check_in IS NOT NULL AND a.check_out IS NULL
        ORDER BY a.date, e.name
        LIMIT $5
        """,
        org_id, month_start, window_end, today, limit,
    )
    if len(open_punches) == limit:
        truncated.append("unclosed_punch")
    for r in open_punches:
        findings.append(reachable({
            "check": "unclosed_punch",
            "month": month,
            "employee": r["employee_name"],
            "employee_code": r["employee_code"],
            "department": r["department"],
            "date": r["date"].isoformat() if r["date"] else None,
            "detail": (
                f"checked in and never checked out (status '{r['status']}'); "
                f"work_hours cannot be derived and any overtime on the day is lost"
            ),
        }, kind="employee", entity_id=r["employee_id"],
            email=r["employee_email"], phone=r["employee_phone"]))

    # (b) Marked absent with no approved leave covering the day. NOT the same as
    # `check_payroll_readiness.unapproved_leave`, which is a pending request.
    absences = await pool.fetch(
        """
        SELECT e.name AS employee_name, e.id AS employee_id,
               -- The key `services/skill_ack_wiring.py` files an acknowledgement
               -- under. The NAME is not one: ten names in the largest org are
               -- carried by three active people each, so an ack keyed on it
               -- would silence two colleagues' exceptions along with the one
               -- somebody actually read.
               e.employee_code,
               e.email AS employee_email, e.phone AS employee_phone,
               COALESCE(NULLIF(btrim(e.department), ''), '(no department)') AS department,
               a.date
        FROM public.manav_attendance a
        JOIN public.manav_employees e ON e.id = a.employee_id AND e.org_id = a.org_id
        WHERE a.org_id = $1::uuid
          AND a.date >= $2::date AND a.date <= $3::date
          AND a.status = 'absent'
          AND NOT EXISTS (
              SELECT 1 FROM public.manav_leave_requests lr
              WHERE lr.org_id = a.org_id AND lr.employee_id = a.employee_id
                AND lr.status = 'approved'
                AND lr.start_date <= a.date AND lr.end_date >= a.date)
        ORDER BY a.date, e.name
        LIMIT $4
        """,
        org_id, month_start, window_end, limit,
    )
    if len(absences) == limit:
        truncated.append("absent_without_approved_leave")
    for r in absences:
        findings.append(reachable({
            "check": "absent_without_approved_leave",
            "month": month,
            "employee": r["employee_name"],
            "employee_code": r["employee_code"],
            "department": r["department"],
            "date": r["date"].isoformat() if r["date"] else None,
            "detail": ("marked absent with no approved leave request covering the "
                       "day; the run treats it as loss of pay"),
        }, kind="employee", entity_id=r["employee_id"],
            email=r["employee_email"], phone=r["employee_phone"]))

    # Is there any punch data in this org AT ALL in the window? The seeded org
    # holds 284 attendance rows and `check_in` is NULL on every one — the punch
    # feature is simply not in use. Without this probe the next check reports
    # every active employee on every working day, and reads as a catastrophe
    # rather than as a firm that records attendance some other way.
    punch_stats = await pool.fetchrow(
        """
        SELECT count(*) AS rows_in_window,
               count(*) FILTER (WHERE a.check_in IS NOT NULL) AS rows_with_a_punch
        FROM public.manav_attendance a
        WHERE a.org_id = $1::uuid AND a.date >= $2::date AND a.date <= $3::date
        """,
        org_id, month_start, window_end,
    )
    punch_stats = dict(punch_stats) if punch_stats else {
        "rows_in_window": 0, "rows_with_a_punch": 0}

    # (c) Working days with no attendance row at all, AGGREGATED PER EMPLOYEE.
    # One row per employee per missing day would be thousands of findings for a
    # firm that has not started using attendance, and the LIMIT would then spend
    # itself entirely on one person's month.
    missing = await pool.fetch(
        f"""
        WITH days AS (
            SELECT gs::date AS d
            FROM generate_series($2::date, $3::date, INTERVAL '1 day') gs
            -- ISODOW 6 and 7 are Saturday and Sunday. EXTRACT(DOW) puts Sunday
            -- at 0, and this predicate would then keep every Sunday.
            WHERE EXTRACT(ISODOW FROM gs) < 6
              AND NOT EXISTS (
                  SELECT 1 FROM public.manav_holidays h
                  WHERE h.org_id = $1::uuid AND h.date = gs::date
                    AND COALESCE(h.is_optional, FALSE) = FALSE)
        ),
        emp AS (
            -- `e.org_id` is carried out of the CTE only so the leaver guard
            -- below has something to qualify; nothing selects it.
            SELECT e.id, e.org_id, e.name, e.employee_code, e.email, e.phone,
                   COALESCE(NULLIF(btrim(e.department), ''), '(no department)') AS department,
                   e.date_of_joining
            FROM public.manav_employees e
            WHERE e.org_id = $1::uuid AND e.is_active = TRUE
        )
        SELECT e.name AS employee_name, e.employee_code, e.department,
               e.id AS employee_id, e.email AS employee_email,
               e.phone AS employee_phone,
               count(*) AS missing_days,
               min(d.d) AS first_missing, max(d.d) AS last_missing
        FROM emp e CROSS JOIN days d
        -- Somebody who joined mid-month is not absent for the days before they
        -- joined. A NULL joining date cannot exclude anything, so it does not.
        WHERE (e.date_of_joining IS NULL OR d.d >= e.date_of_joining)
          -- And the same sentence backwards: somebody who left mid-month is not
          -- absent for the days AFTER their last working day.
          --
          -- THE ANCHOR IS `d.d`, THE DAY UNDER TEST, AND NOT `CURRENT_DATE`.
          -- This is a FLOW — what happened across a window — and the roster is
          -- only how it is addressed, so a stock guard here would drop the
          -- leaver whole and take their real exceptions with them. Measured
          -- read-only over August 2026 in E2E Test & Associates: ten people who
          -- had left produced 180 missing-day rows on the unguarded query. Bound
          -- per day it is 1 — a working day one of them genuinely had no
          -- attendance row for BEFORE they left, which is a finding. At
          -- CURRENT_DATE it would be 0, and that surviving day is exactly the
          -- history the module docstring warns about rewriting.
          --
          -- A NULL `last_working_day` still excludes nothing, on both sides.
          {still_on_the_rolls("e", "d.d")}
          AND NOT EXISTS (
              SELECT 1 FROM public.manav_attendance a
              WHERE a.org_id = $1::uuid AND a.employee_id = e.id AND a.date = d.d)
        -- GROUP BY e.id, NOT by e.name. This was written as a name grouping and
        -- the live data caught it inside a minute: the seeded org has two
        -- distinct employees called "Aadhya Nair" (EMP-013 and EMP-053), so a
        -- 14-working-day window came back reporting 28 missing days for a single
        -- person — a count that cannot exist, against a window the same output
        -- prints two lines above. Grouping people by their name invents a person
        -- and doubles their exceptions. `employee_code` is emitted so the two
        -- are distinguishable on the page; the id never leaves this query.
        GROUP BY e.id, e.name, e.employee_code, e.department, e.email, e.phone
        ORDER BY count(*) DESC, e.name, e.employee_code
        LIMIT $4
        """,
        org_id, month_start, window_end, limit,
    )
    if len(missing) == limit:
        truncated.append("no_attendance_on_working_day")
    for r in missing:
        findings.append(reachable({
            "check": "no_attendance_on_working_day",
            "month": month,
            "employee": r["employee_name"],
            "employee_code": r["employee_code"],
            "department": r["department"],
            "missing_days": r["missing_days"],
            "first_missing": r["first_missing"].isoformat() if r["first_missing"] else None,
            "last_missing": r["last_missing"].isoformat() if r["last_missing"] else None,
            "detail": (
                f"{r['missing_days']} working day(s) in the window with no "
                f"attendance row of any kind; the run pays them as present"
            ),
        }, kind="employee", entity_id=r["employee_id"],
            email=r["employee_email"], phone=r["employee_phone"]))

    # (d) Approved leave beyond the balance on record, for the calendar year the
    # window sits in. `manav_leave_balances` has one row per (employee, leave
    # type, year) and NO is_active column, so there is nothing to filter on.
    #
    # NO LEAVER GUARD HERE, DELIBERATELY, AND THIS IS THE ONE EMPLOYEE READ IN
    # THIS FILE THAT KEEPS `is_active` ALONE. It is a FLOW: days taken in the
    # months somebody worked, which do not un-happen on their last working day.
    # More than that, an overdraw is money owed BACK to the employer and is
    # recovered at full-and-final — the same class of money as the salary advance
    # whose loss (`routers/manav.py:1958`) is the whole reason a leaver keeps the
    # flag until settlement. Guarding this would hide the overdraw from the one
    # person who can still act on it. Five of E2E's ten departed-but-flagged
    # employees have exits still open ('initiated', 'in_clearance') as at
    # 2026-08-26; nought of the ten had an overdraw, so this is a decision about
    # the next one, not about a row on the page today.
    #
    # The bound that makes it safe is already in the SQL: `start_date` inside the
    # calendar year, and no leave request in E2E extends past its owner's last
    # working day. `tests/test_seat_and_skill_rosters_exclude_leavers.py` asserts
    # this query stays bare, so "finishing the job" here turns the suite red.
    over_leave = await pool.fetch(
        """
        WITH taken AS (
            SELECT lr.employee_id, lr.leave_type_id, SUM(lr.days) AS days_taken
            FROM public.manav_leave_requests lr
            WHERE lr.org_id = $1::uuid AND lr.status = 'approved'
              AND EXTRACT(YEAR FROM lr.start_date)::int = $2::int
            GROUP BY lr.employee_id, lr.leave_type_id
        )
        SELECT e.name AS employee_name, e.id AS employee_id,
               -- The key `services/skill_ack_wiring.py` files an acknowledgement
               -- under. The NAME is not one: ten names in the largest org are
               -- carried by three active people each, so an ack keyed on it
               -- would silence two colleagues' exceptions along with the one
               -- somebody actually read.
               e.employee_code,
               e.email AS employee_email, e.phone AS employee_phone,
               COALESCE(NULLIF(btrim(e.department), ''), '(no department)') AS department,
               COALESCE(lt.name, '(leave type unavailable)') AS leave_type,
               t.days_taken,
               -- CAST both sides. `allocated` and `carried_forward` are integer
               -- and `days` is numeric; an untyped mixed-type expression is what
               -- PgBouncer turns into an instant 500 on a parse error, and this
               -- repo has been bitten by that twice.
               (b.allocated::numeric + b.carried_forward::numeric) AS entitlement
        FROM taken t
        JOIN public.manav_employees e
          ON e.id = t.employee_id AND e.org_id = $1::uuid AND e.is_active = TRUE
        JOIN public.manav_leave_balances b
          ON b.org_id = $1::uuid AND b.employee_id = t.employee_id
         AND b.leave_type_id = t.leave_type_id AND b.year = $2::int
        LEFT JOIN public.manav_leave_types lt
          ON lt.id = t.leave_type_id AND lt.org_id = $1::uuid
        WHERE t.days_taken > (b.allocated::numeric + b.carried_forward::numeric)
        ORDER BY (t.days_taken - (b.allocated::numeric + b.carried_forward::numeric)) DESC,
                 e.name
        LIMIT $3
        """,
        org_id, window_end.year, limit,
    )
    if len(over_leave) == limit:
        truncated.append("leave_beyond_balance")
    for r in over_leave:
        taken = float(r["days_taken"] or 0)
        entitlement = float(r["entitlement"] or 0)
        findings.append(reachable({
            "check": "leave_beyond_balance",
            "month": month,
            "employee": r["employee_name"],
            "employee_code": r["employee_code"],
            "department": r["department"],
            "leave_type": r["leave_type"],
            "days_taken": round(taken, 2),
            "entitlement": round(entitlement, 2),
            "days_over": round(taken - entitlement, 2),
            "detail": (
                f"{round(taken, 2)} day(s) of approved {r['leave_type']} in "
                f"{window_end.year} against an entitlement of "
                f"{round(entitlement, 2)}"
            ),
        }, kind="employee", entity_id=r["employee_id"],
            email=r["employee_email"], phone=r["employee_phone"]))

    # How much of the leave question could NOT be asked. A pair with no balance
    # row is invisible to the check above — 27 of the seeded org's 34 (employee,
    # leave type) pairs are in exactly that state — and silence there would read
    # as "everyone is within balance".
    no_balance = await pool.fetchval(
        """
        WITH taken AS (
            SELECT lr.employee_id, lr.leave_type_id
            FROM public.manav_leave_requests lr
            WHERE lr.org_id = $1::uuid AND lr.status = 'approved'
              AND EXTRACT(YEAR FROM lr.start_date)::int = $2::int
            GROUP BY lr.employee_id, lr.leave_type_id
        )
        SELECT count(*) FROM taken t
        WHERE NOT EXISTS (
            SELECT 1 FROM public.manav_leave_balances b
            WHERE b.org_id = $1::uuid AND b.employee_id = t.employee_id
              AND b.leave_type_id = t.leave_type_id AND b.year = $2::int)
        """,
        org_id, window_end.year,
    ) or 0

    by_dept: dict[str, dict] = {}
    for f in findings:
        slot = by_dept.setdefault(
            f["department"], {"department": f["department"], "findings": 0})
        slot["findings"] += 1
        slot[f["check"]] = slot.get(f["check"], 0) + 1

    counts = {c: sum(1 for f in findings if f["check"] == c) for c in (
        "unclosed_punch", "absent_without_approved_leave",
        "no_attendance_on_working_day", "leave_beyond_balance")}

    out = {
        "month": month,
        "window": {"from": month_start.isoformat(), "to": window_end.isoformat()},
        "findings": findings,
        "by_department": sorted(
            by_dept.values(), key=lambda d: (-d["findings"], d["department"])),
        "counts": counts,
        "punch_data": {
            "attendance_rows_in_window": punch_stats["rows_in_window"],
            "rows_carrying_a_punch": punch_stats["rows_with_a_punch"],
        },
        "overlap_with_payroll_readiness": (
            "`check_payroll_readiness` already reports an employee with NO "
            "attendance row anywhere in the month, and a leave request still "
            "pending. This handler is day-level rather than month-level, and "
            "adds the unclosed punch, the absence with no request at all, and "
            "leave taken beyond the balance on record."
        ),
        "caveats": [],
    }

    if not punch_stats["rows_with_a_punch"]:
        out["caveats"].append(
            f"NOT ONE of the {punch_stats['rows_in_window']} attendance row(s) in "
            f"this window carries a check-in time. The punch feature is not in "
            f"use here, so `unclosed_punch` cannot find anything and "
            f"`no_attendance_on_working_day` is measuring missing ROWS, not "
            f"missing punches. Read the missing-day counts as a data-entry "
            f"backlog, not as absenteeism."
        )
    if no_balance:
        out["caveats"].append(
            f"{no_balance} (employee, leave type) pair(s) have approved leave in "
            f"{window_end.year} and NO balance row for that year, so the "
            f"entitlement is unknown and they were NOT checked. They cannot "
            f"appear above however much leave was taken."
        )
    if window_end < month_end:
        out["caveats"].append(
            f"The window stops at {window_end.isoformat()}, today, not at the "
            f"month end. Days that have not happened are not exceptions."
        )
    for code in truncated:
        out["caveats"].append(
            f"TRUNCATED: {code} hit the cap of {limit} rows. Its count above is "
            f"a floor, not the total."
        )
    if not findings:
        out["caveats"].append(
            "No attendance exception found in this window. That is a finding, "
            "not a skipped check — all four checks ran."
        )
    return out


# ── 4 · brief_unpaid_reimbursements ──────────────────────────────────────────

async def brief_unpaid_reimbursements(pool, org_id: str, limit: int = 200) -> dict:
    """Expense claims approved and not yet reimbursed, aged, by person and team.

    `payslip_id IS NULL` is what unpaid means here and it is not a guess:
    `process_payroll` stamps the claim with the payslip it was reimbursed on
    (`routers/vetana.py`), so a NULL is a claim no payroll run has ever picked
    up. `status = 'approved'` is the other half — a pending claim is somebody's
    decision to make, not money owed, and `check_payroll_readiness` already
    warns about those.

    Ageing runs from the APPROVAL date, not the expense date, because approval is
    when the firm accepted the debt. Where `approved_at` is NULL the expense date
    is used and the row says which basis it used, so nobody reconciles two
    differently-aged rows against each other without seeing why.

    Returns {as_at, totals, by_age, by_employee, by_department, oldest, caveats}.
    """
    as_at = utc_now().date()

    rows = await pool.fetch(
        """
        SELECT e.id AS employee_id,
               e.name AS employee_name,
               e.employee_code,
               COALESCE(NULLIF(btrim(e.department), ''), '(no department)') AS department,
               c.category,
               c.amount,
               c.expense_date,
               c.approved_at::date AS approved_on,
               -- COALESCE INSIDE the subtraction, not around it: an approved_at
               -- of NULL would otherwise make the whole expression NULL, the row
               -- would age as 0 days and land in the freshest bucket — the one
               -- place an unpaid claim must never be able to hide.
               ($2::date - COALESCE(c.approved_at::date, c.expense_date)) AS age_days,
               (c.approved_at IS NULL) AS aged_from_expense_date
        FROM public.manav_expense_claims c
        -- `AND e.org_id = c.org_id` is not decoration. The FK is on id alone, so
        -- a join on id can surface another organisation's employee NAME against
        -- this org's claim.
        JOIN public.manav_employees e ON e.id = c.employee_id AND e.org_id = c.org_id
        WHERE c.org_id = $1::uuid
          AND c.is_active = TRUE
          AND c.status = 'approved'
          AND c.payslip_id IS NULL
        ORDER BY COALESCE(c.approved_at::date, c.expense_date), c.amount DESC
        LIMIT $3
        """,
        org_id, as_at, limit,
    )

    def _bucket(age: int) -> str:
        if age <= 15:
            return AGE_BUCKETS[0]
        if age <= 30:
            return AGE_BUCKETS[1]
        return AGE_BUCKETS[2]

    by_age = {b: {"bucket": b, "claims": 0, "amount": 0.0} for b in AGE_BUCKETS}
    by_employee: dict[str, dict] = {}
    by_department: dict[str, dict] = {}
    total_amount = 0.0
    aged_from_expense = 0
    oldest: dict | None = None

    for r in rows:
        amount = float(r["amount"] or 0)
        age = int(r["age_days"] or 0)
        total_amount += amount

        slot = by_age[_bucket(age)]
        slot["claims"] += 1
        slot["amount"] = round(slot["amount"] + amount, 2)

        # Grouped on the employee ROW, never on the name. The seeded org has two
        # distinct people called "Aadhya Nair" and two called "Kabir Malhotra",
        # and a name grouping merges them — it invents one employee owed the sum
        # of two people's claims, which is a figure nobody can reconcile and a
        # privacy defect besides. The id is the grouping key ONLY; it is never
        # emitted, because a member UUID must not appear in any output. The
        # employee_code is what a reader uses to tell the two apart.
        emp = by_employee.setdefault(str(r["employee_id"]), {
            "employee": r["employee_name"],
            "employee_code": r["employee_code"],
            "department": r["department"],
            "claims": 0, "amount": 0.0, "oldest_days": 0,
        })
        emp["claims"] += 1
        emp["amount"] = round(emp["amount"] + amount, 2)
        emp["oldest_days"] = max(emp["oldest_days"], age)

        dept = by_department.setdefault(r["department"], {
            "department": r["department"], "claims": 0, "amount": 0.0,
            "_people": set(),
        })
        dept["claims"] += 1
        dept["amount"] = round(dept["amount"] + amount, 2)
        # The id again, for the same reason: a department's headcount counted by
        # name would under-report wherever two colleagues share one.
        dept["_people"].add(str(r["employee_id"]))

        if r["aged_from_expense_date"]:
            aged_from_expense += 1

        if oldest is None or age > oldest["age_days"]:
            oldest = {
                "employee": r["employee_name"],
                "employee_code": r["employee_code"],
                "department": r["department"],
                "category": r["category"],
                "amount": round(amount, 2),
                "expense_date": r["expense_date"].isoformat() if r["expense_date"] else None,
                "approved_on": r["approved_on"].isoformat() if r["approved_on"] else None,
                "age_days": age,
                "aged_from": "expense date" if r["aged_from_expense_date"] else "approval date",
            }

    departments = []
    for d in sorted(by_department.values(), key=lambda d: -d["amount"]):
        people = d.pop("_people")
        departments.append({**d, "employees": len(people)})

    out = {
        "as_at": as_at.isoformat(),
        "what_this_is": (
            "Expense claims the organisation has APPROVED and not yet reimbursed "
            "— `payslip_id IS NULL`, meaning no payroll run has picked them up. "
            "Money owed to employees, not a decision anybody still has to make."
        ),
        "totals": {
            "claims": len(rows),
            "amount": round(total_amount, 2),
            "employees": len(by_employee),
            "departments": len(departments),
        },
        "by_age": list(by_age.values()),
        "by_employee": sorted(by_employee.values(), key=lambda e: -e["amount"]),
        "by_department": departments,
        "oldest": oldest,
        "how_ageing_works": (
            "Age runs from the approval date where there is one and from the "
            "expense date otherwise; every row says which. The buckets are 0-15, "
            "16-30 and 31+ days — 31 and not 30, so that no claim falls in two "
            "buckets and the bucket totals add up to the headline."
        ),
        "caveats": [],
    }

    if aged_from_expense:
        out["caveats"].append(
            f"{aged_from_expense} claim(s) carry no approval timestamp and are "
            f"aged from the expense date instead, which makes them look OLDER "
            f"than the debt actually is."
        )
    if len(rows) == limit:
        out["caveats"].append(
            f"TRUNCATED at {limit} claims, oldest first. Every total above is a "
            f"floor: there is more approved and unpaid than is shown here."
        )
    if not rows:
        out["caveats"].append(
            "No approved claim is awaiting reimbursement. That is a finding, "
            "not a skipped check."
        )
    return out
