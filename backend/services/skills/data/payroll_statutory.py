"""
payroll_statutory — catalogue #23, #24, #25, #26, #27.

The five things that happen to a payroll run AFTER it is approved: the money
has to leave, the certificates have to be built, the return has to be filed,
the ESI ceiling has to be watched, and the state has to be paid.

    check_pf_esi_debit_missing    no PF/ESI debit is visible this month
    pack_form130_annexure         the year's payslips in Part B heads
    pack_quarterly_deductees      the deductee list the RPU wants
    check_esi_ceiling_crossings   who crossed ₹21,000, and who must keep paying
    brief_professional_tax        PT deducted, and which state it cannot date

── THREE OF THESE ARE ABSENCE CLAIMS, AND THAT IS THE HONEST SHAPE ──────────

The product does not record a challan and does not parse a bank narration into
a head. So #23 does not say "your PF was not paid" — it says WE CANNOT SEE a PF
debit, which is a different sentence and the only one the data supports. #27
does not print a due date for a state whose slab table is absent. #24 does not
call its output a Form.

An absence claim is weaker than a match and it still catches the failure it is
for. A confident claim built on an absence is how a compliance skill loses a
firm's trust in one run.

AND AN ABSENCE CLAIM MUST BE RE-MEASURED, NOT INHERITED. The third one used to
be "does not know which state an employee works in". Migration 220 gave it the
column, the sentence stayed, and #27 spent a phase telling two organisations
that data they had entered did not exist — which costs the same trust, from the
other direction. Every absence above is now counted at read time.

── NAME THE FORM FOR THE YEAR, NEVER FROM MEMORY ────────────────────────────

Form 16 became Form 130 and Form 24Q became Form 138 on 1 April 2026. Every
form number below is read from `staging.statute_calendar` as of the date the
OBLIGATION arises — the year the certificate covers, the quarter the payments
fell in — never as of today and never as a literal. `services/statute.py` says
this at length and it is the single most likely thing to be got wrong here: a
Form 16 issued for FY 2026-27 is a form that does not exist.

── Measured live, read-only, 2026-08-20 ─────────────────────────────────────

  · 1,095 payslips and 27 runs across three orgs. Runs carry `total_pf`,
    `total_esi`, `total_pt`, `total_tds`; payslips carry the per-employee split
    (`pf_employee`/`pf_employer`, `esi_employee`/`esi_employer`,
    `professional_tax`, `tds`). `run_id` on the payslip, not `payroll_run_id`.
  · ESI: org fae87907 has 12 payslips at or below ₹21,000 WITH an ESI
    deduction and 88 above — live signal for #26. The seeded org has 960
    payslips all above the ceiling and ESI of zero throughout.
  · PAN/UAN: org fae87907 has 24 of 24 employees with both. The seeded org has
    60 of 71 with a PAN and NOT ONE with a UAN.
  · `staging.pay_professional_tax` holds NINE rows covering three states —
    Maharashtra 3, Gujarat 4, Karnataka 2. Re-measured 2026-08-26: every one of
    those rows now carries a NULL `org_id`, i.e. it is a SHARED ladder read by
    every org, and NO org has seeded its own. (This bullet said the opposite —
    "per-org seed data, so two of three live orgs have no slabs" — and the read
    below was scoped to match, which is how it returned no slabs for anybody.)
    There is still no due-date and no penalty column. #27 is built on that and
    says so.
"""
import logging
from datetime import date, timedelta

from services.statute import obligation, obligation_for_fy, fy_bounds
from services.skills.reachable import reachable
from services.skills.timeutil import as_date, utc_now
# The one canonical Indian state codelist in this backend. #27 joins the
# employee's work state to a professional-tax slab, and both ends of that join
# are spelled by different hands — see `_state_keys` below.
from services.gst_states import norm_state, state_view

log = logging.getLogger(__name__)

#: A payroll run whose figures are settled. Same tuple, same reasoning, as
#: `people_checks.APPROVED_STATUSES`: STATUS IS THE AUTHORITY, not `approved_at`
#: — the seeded org's 2026-07 run carries an approval timestamp and a LATER
#: processing timestamp, i.e. approved, reopened and reprocessed.
APPROVED_STATUSES = ("approved", "disbursed")

#: How far either side of the statutory deposit date to look for the debit.
#: Wide on purpose: a firm that pays on the 10th and a firm that pays on the
#: 20th have both paid, and a window tight enough to be "correct" would report
#: the second one as a failure every single month.
DEBIT_WINDOW_DAYS = 12

#: Agreement between a challan and a bank debit, as a share. Loose because the
#: debit routinely bundles employer and employee shares, admin charges and EDLI,
#: none of which the run's total carries. This is a SIGHTING, not a match.
DEBIT_TOLERANCE = 0.25

#: The wage month for which the TDS deposit is NOT due on the 7th. March's
#: deduction is due 30 April, and `statute_calendar` cannot hold two due days on
#: one row — 172's own note says so. Named here so the special case is greppable
#: rather than an unexplained `== 3`.
TDS_MARCH_EXCEPTION_MONTH = 3


def _f(value, default=0.0) -> float:
    """Decimal | None -> float; asyncpg returns Decimal and it is not JSON."""
    return default if value is None else float(value)


def _month_bounds(month: str) -> tuple[date, date]:
    """'2026-07' -> (2026-07-01, 2026-07-31)."""
    year, mon = (int(x) for x in month.split("-"))
    start = date(year, mon, 1)
    end = (date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)) - timedelta(days=1)
    return start, end


def _fy_of(day: date) -> str:
    start = day.year if day.month >= 4 else day.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _quarter_of(day: date) -> tuple[int, date, date]:
    """The Indian tax quarter containing *day*: Q1 is April-June."""
    idx = ((day.month - 4) % 12) // 3          # 0..3 with April -> 0
    start_month = 4 + idx * 3
    year = day.year if day.month >= 4 else day.year - 1
    start = date(year + (1 if start_month > 12 else 0), (start_month - 1) % 12 + 1, 1)
    end_month = start.month + 2
    end_year = start.year + (1 if end_month > 12 else 0)
    end_month = (end_month - 1) % 12 + 1
    nxt = (date(end_year + 1, 1, 1) if end_month == 12
           else date(end_year, end_month + 1, 1))
    return idx + 1, start, nxt - timedelta(days=1)


def _state_keys(*values) -> set:
    """Every spelling of a state these values could match on.

    Both ends of #27's join go through this because the database holds two
    conventions and `manav_employees_state_ck` (migration 220, read from
    pg_constraint) admits BOTH — `state ~ '^[0-9]{1,2}$' OR state ~
    '^[A-Z]{2,3}$'` — while `pay_professional_tax.state_code` is numeric. So an
    employee stored 'MH' and a slab stored '27' are one state, and comparing the
    raw strings would silently never meet: the brief would report Maharashtra as
    a state with no ladder while the payroll deducted against one.

    The raw lower-cased text is kept alongside the canonical code so a state the
    GST codelist has never heard of still matches a slab spelled the same way
    rather than matching nothing.

    Mirrors `routers/vetana.py::_state_keys`, which decides the figure this
    brief explains, and is copied rather than imported for one reason: that is a
    router and this is a service. The codelist underneath both lives in
    `services/gst_states.py`, which is where a change to the convention belongs.
    """
    keys = set()
    for value in values:
        text = str(value if value is not None else "").strip().lower()
        if not text:
            continue
        keys.add(text)
        canonical = norm_state(value)
        if canonical:
            keys.add(canonical)
    return keys


def _state_label(value) -> tuple[str | None, str | None]:
    """(canonical GST code or None, a name a reader can read).

    A state the codelist does not know keeps its own text rather than becoming
    "unknown": somebody typed it, and it is still the answer to "where does this
    person work". A bare '27' never leaves this module — the same reason a UUID
    never does.
    """
    text = str(value if value is not None else "").strip()
    if not text:
        return None, None
    code = norm_state(text)
    return (code, state_view(code)["state_name"]) if code else (None, text)


def _statute_note(row: dict | None, what: str) -> str:
    if not row:
        return f"The statute calendar records no {what}, so none is shown."
    bits = [b for b in (row.get("form_number"), row.get("section_ref")) if b]
    cite = " · ".join(bits) if bits else (row.get("statute") or "")
    return f"{row.get('title') or what}{f' ({cite})' if cite else ''}"


async def _latest_approved_run(pool, org_id: str, month: str | None):
    """The run whose figures are settled, or None. Never the latest ROW."""
    if month:
        return await pool.fetchrow(
            """
            SELECT id, month, status, total_gross, total_pf, total_esi,
                   total_pt, total_tds, employee_count, approved_at, processed_at
            FROM staging.vetana_payroll_runs
            WHERE org_id = $1::uuid AND month = $2::text
              AND status = ANY($3::text[])
            ORDER BY month DESC LIMIT 1
            """,
            org_id, month, list(APPROVED_STATUSES),
        )
    return await pool.fetchrow(
        """
        SELECT id, month, status, total_gross, total_pf, total_esi,
               total_pt, total_tds, employee_count, approved_at, processed_at
        FROM staging.vetana_payroll_runs
        WHERE org_id = $1::uuid AND status = ANY($2::text[])
        ORDER BY month DESC LIMIT 1
        """,
        org_id, list(APPROVED_STATUSES),
    )


# ══════════════════════════════════════════════════════════════════════════
# 23 · check_pf_esi_debit_missing
# ══════════════════════════════════════════════════════════════════════════

async def check_pf_esi_debit_missing(
    pool, org_id: str, month: str | None = None, limit: int = 200,
) -> dict:
    """No bank debit is visible for the PF and ESI this run owes.

    *month* is the WAGE month and defaults to the latest APPROVED run — never
    the wall clock, and never simply the latest row.

    ── AN ABSENCE CLAIM, NOT A MATCH — #23 SAYS SO AND IT IS RIGHT ───────────

    There is no challan record in this product and nothing parses a bank
    narration into a statutory head. So this cannot say "your PF was not paid".
    It says WE CANNOT SEE a debit that looks like the PF, which is weaker,
    honest, and still catches the failure it exists for: the month somebody
    forgot.

    A sighting is not a reconciliation either. The real debit bundles the
    employer share, admin charges and EDLI, none of which `total_pf` carries, so
    the tolerance is deliberately loose and the output calls what it finds a
    CANDIDATE.
    """
    today = utc_now().date()
    run = await _latest_approved_run(pool, org_id, month)
    if not run:
        return {
            "as_at": today,
            "month": month,
            "run_found": False,
            "counts": {"heads_checked": 0, "heads_not_visible": 0},
            "heads": [],
            "limitations": [
                "No APPROVED payroll run was found"
                + (f" for {month}." if month else ".")
                + " Nothing is owed until a run is approved, so this is not a "
                  "finding — it is the absence of a question."],
        }

    wage_month = run["month"]
    m_start, m_end = _month_bounds(wage_month)

    epf = await obligation(pool, "epf.remittance", as_of=m_end)
    esi = await obligation(pool, "esi.remittance", as_of=m_end)

    heads, missing = [], 0
    for label, key, fact, owed in (
        ("Provident fund", "epf.remittance", epf, _f(run["total_pf"])),
        ("ESI", "esi.remittance", esi, _f(run["total_esi"])),
    ):
        if owed <= 0:
            heads.append({
                "head": label, "owed": owed, "state": "nothing owed",
                "why": "the run records no liability under this head, so there "
                       "is nothing to look for",
                "statute": _statute_note(fact, f"{label} due date"),
            })
            continue

        due_on = None
        if fact and fact.get("due_day"):
            offset = fact.get("due_month_offset") or 0
            mo = m_end.month + offset
            yr = m_end.year + (mo - 1) // 12
            mo = (mo - 1) % 12 + 1
            try:
                due_on = date(yr, mo, int(fact["due_day"]))
            except ValueError:
                due_on = None

        anchor = due_on or m_end
        window_from = anchor - timedelta(days=DEBIT_WINDOW_DAYS)
        window_to = anchor + timedelta(days=DEBIT_WINDOW_DAYS)

        # A DEBIT is amount < 0: the column is signed and there is no
        # credit/debit pair. Magnitude is compared, not the signed value.
        candidates = await pool.fetch(
            """
            SELECT id, statement_date, description, reference, amount
            FROM staging.ganit_bank_statement_lines
            WHERE org_id = $1::uuid
              AND amount < 0
              AND statement_date >= $2::date
              AND statement_date <= $3::date
              AND abs(amount) >= $4::numeric
              AND abs(amount) <= $5::numeric
            ORDER BY statement_date
            LIMIT $6::int
            """,
            org_id, window_from, window_to,
            owed * (1 - DEBIT_TOLERANCE), owed * (1 + DEBIT_TOLERANCE),
            max(1, int(limit)),
        )
        if not candidates:
            missing += 1
        heads.append({
            "head": label,
            "owed": owed,
            "due_on": due_on,
            "looked_between": [window_from, window_to],
            "state": "no debit visible" if not candidates else "a candidate debit was seen",
            "candidates": [
                {
                    "line_id": str(c["id"]),
                    "statement_date": c["statement_date"],
                    "amount": abs(_f(c["amount"])),
                    "description": c["description"] or "",
                    "reference": c["reference"] or "",
                }
                for c in candidates
            ],
            "statute": _statute_note(fact, f"{label} due date"),
        })

    return {
        "as_at": today,
        "month": wage_month,
        "run_found": True,
        "run_status": run["status"],
        "employees_in_run": run["employee_count"],
        "counts": {
            "heads_checked": len(heads),
            "heads_not_visible": missing,
        },
        "heads": heads,
        "limitations": [
            "THIS IS AN ABSENCE CLAIM, NOT A RECONCILIATION. Nothing in this "
            "product records a challan and nothing parses a bank narration into "
            "a statutory head, so it can say a debit is not VISIBLE — never "
            "that a payment was not made.",
            "A candidate is a sighting, not a match: the real remittance bundles "
            "the employer share, administration charges and EDLI, none of which "
            "the run's total carries, so the amounts are compared loosely.",
            "If no bank statement has been imported for the window, every head "
            "reads as 'no debit visible'. That is the same output as a genuinely "
            "missed payment and this cannot tell them apart.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 24 · pack_form130_annexure
# ══════════════════════════════════════════════════════════════════════════

async def pack_form130_annexure(
    pool, org_id: str, financial_year: str | None = None, limit: int = 200,
) -> dict:
    """The year's payslips rolled into the salary-certificate heads.

    *financial_year* defaults to the most recently ENDED year — the certificate
    for a year is issued after it closes.

    ── IT IS AN ANNEXURE. IT IS NOT THE FORM. ───────────────────────────────

    Catalogue #24 is explicit and it is correct: the certificate is generated on
    TRACES after the quarterly statement is processed, and Part A comes from
    there. It CANNOT be produced here. So every label on this output says
    working or annexure, the form number is printed only to say WHICH
    certificate this feeds, and `is_the_form` is False on the output.

    ── AND THE FORM NUMBER IS FOR THE YEAR THE SKILL RUNS FOR ───────────────

    Form 16 became Form 130 from FY 2026-27. The number is resolved AS OF THE
    END OF THE YEAR THE CERTIFICATE COVERS, not as of today, so a certificate
    prepared in 2026 for FY 2025-26 still says Form 16.
    """
    today = utc_now().date()
    if not financial_year:
        this_fy = _fy_of(today)
        start_year = int(this_fy.split("-")[0])
        financial_year = f"{start_year - 1}-{str(start_year)[-2:]}"
    fy_start, fy_end = fy_bounds(financial_year)
    cap = max(1, int(limit))

    cert = await obligation_for_fy(pool, "tds.certificate.salary", financial_year)

    rows = await pool.fetch(
        """
        SELECT e.id AS employee_id, e.name, e.employee_code, e.pan,
               e.email, e.phone,
               count(p.id)                                   AS months,
               COALESCE(SUM(p.gross), 0)                     AS gross,
               COALESCE(SUM(p.basic), 0)                     AS basic,
               COALESCE(SUM(p.hra), 0)                       AS hra,
               COALESCE(SUM(p.conveyance), 0)                AS conveyance,
               COALESCE(SUM(p.medical), 0)                   AS medical,
               COALESCE(SUM(p.special_allowance), 0)         AS special_allowance,
               COALESCE(SUM(p.da), 0)                        AS da,
               -- `other_earnings` is a jsonb ARRAY of {label, amount}, not a
               -- numeric — SUM() over it raises `function sum(jsonb) does not
               -- exist`, which is what the live probe caught and what a mock
               -- pool would have hidden entirely.
               --
               -- It is summed rather than skipped because of WHAT IT HOLDS:
               -- measured live, every non-empty value is an arrears line
               -- ("Arrears — revision effective 01-Jun-2026"). Arrears are
               -- salary, `gross` already includes them, and a salary
               -- certificate annexure that silently drops them understates the
               -- year for exactly the people whose pay was revised.
               COALESCE(SUM(oe.amount), 0)                   AS other_earnings,
               COALESCE(SUM(p.pf_employee), 0)               AS pf_employee,
               COALESCE(SUM(p.professional_tax), 0)          AS professional_tax,
               COALESCE(SUM(p.tds), 0)                       AS tds
        FROM staging.vetana_payslips p
        JOIN staging.manav_employees e
          ON e.id = p.employee_id AND e.org_id = p.org_id
        -- LEFT LATERAL, and both halves matter. LEFT so a payslip with an empty
        -- array (which is 1,092 of the 1,095 live rows) still contributes its
        -- named heads instead of vanishing from the certificate; the inner
        -- aggregate so a payslip carrying THREE arrears lines still counts as
        -- one payslip in `months`, which a bare join would have inflated.
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM((elem->>'amount')::numeric), 0) AS amount
            FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(p.other_earnings) = 'array'
                          THEN p.other_earnings ELSE '[]'::jsonb END) elem
        ) oe ON TRUE
        WHERE p.org_id = $1::uuid
          AND p.is_active
          AND p.month >= $2::text
          AND p.month <= $3::text
        GROUP BY e.id, e.name, e.employee_code, e.pan, e.email, e.phone
        ORDER BY e.name
        LIMIT $4::int
        """,
        org_id, f"{fy_start.year:04d}-{fy_start.month:02d}",
        f"{fy_end.year:04d}-{fy_end.month:02d}", cap,
    )

    people, exceptions = [], []
    for r in rows:
        months = r["months"] or 0
        entry = reachable({
            "employee": r["name"],
            "employee_code": r["employee_code"],
            "pan": r["pan"] or None,
            "months_on_record": months,
            "heads": {
                "Salary as per section 17(1)": round(
                    _f(r["basic"]) + _f(r["da"]) + _f(r["special_allowance"])
                    + _f(r["other_earnings"]), 2),
                "House rent allowance": _f(r["hra"]),
                "Conveyance": _f(r["conveyance"]),
                "Medical": _f(r["medical"]),
                "Gross as recorded": _f(r["gross"]),
            },
            "deductions": {
                "Provident fund (employee)": _f(r["pf_employee"]),
                "Professional tax": _f(r["professional_tax"]),
            },
            "tax_deducted": _f(r["tds"]),
        }, kind="employee", entity_id=r["employee_id"],
            email=r["email"], phone=r["phone"])
        people.append(entry)

        # The exceptions that stop a certificate issuing, named per person.
        if not (r["pan"] or "").strip():
            exceptions.append(reachable({
                "employee": r["name"], "issue": "no PAN on record",
                "consequence": "the certificate cannot be generated on TRACES "
                               "and the deduction attracts the higher rate"},
                kind="employee", entity_id=r["employee_id"],
                email=r["email"], phone=r["phone"]))
        if months < 12:
            exceptions.append(reachable({
                "employee": r["name"],
                "issue": f"only {months} month(s) of payslips in the year",
                "consequence": "a part-year record is not necessarily wrong — a "
                               "joiner or leaver looks identical to a gap — but "
                               "the certificate must be reconciled before issue"},
                kind="employee", entity_id=r["employee_id"],
                email=r["email"], phone=r["phone"]))
        if _f(r["tds"]) > 0 and not (r["pan"] or "").strip():
            exceptions.append(reachable({
                "employee": r["name"], "issue": "tax deducted with no PAN",
                "consequence": "the deductee cannot be reported and the credit "
                               "cannot reach them"},
                kind="employee", entity_id=r["employee_id"],
                email=r["email"], phone=r["phone"]))

    return {
        "as_at": today,
        "financial_year": financial_year,
        "is_the_form": False,
        "what_this_is": (
            "A WORKING, not a certificate. The salary certificate is generated "
            "on TRACES after the quarterly statement is processed and its Part A "
            "comes from there — it cannot be produced by this product. This is "
            "the annexure you reconcile against before you issue it."),
        "feeds_certificate": (cert or {}).get("form_number"),
        "statute": _statute_note(cert, "salary certificate"),
        "counts": {
            "employees": len(people),
            "exceptions": len(exceptions),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "employees": people,
        "exceptions": exceptions,
        "limitations": [
            "Every figure is from payslips recorded in this product. Perquisites, "
            "any other income declared by the employee, exemptions actually "
            "claimed and deductions under Chapter VI-A are NOT here.",
            "The exemption on house rent allowance is not computed — the gross "
            "allowance is shown, not the exempt portion.",
            "Part A of the certificate comes from TRACES and is not reproduced. "
            "The tax deducted shown here is what the payslips record, which is "
            "not the same as what was deposited and matched.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 25 · pack_quarterly_deductees
# ══════════════════════════════════════════════════════════════════════════

async def pack_quarterly_deductees(
    pool, org_id: str, quarter_of: str | None = None, limit: int = 400,
) -> dict:
    """The salary-TDS deductee list for a quarter, ready for the RPU.

    *quarter_of* is any date inside the quarter, 'YYYY-MM-DD', and defaults to
    the quarter just ended — the one being prepared.

    ── THE DEDUCTEE LIST, AND NOT ONE WORD ABOUT CHALLANS ───────────────────

    Catalogue #25: "Ship the deductee list; delete the challan sentence."
    `total_tds` is a computed liability, not a deposited challan. This product
    has no challan record at all, so the deductee list is everything it can
    honestly produce and the challan columns of the return are the preparer's.
    """
    today = utc_now().date()
    anchor = as_date(quarter_of) or (today.replace(day=1) - timedelta(days=1))
    qno, q_start, q_end = _quarter_of(anchor)
    fy = _fy_of(q_start)
    cap = max(1, int(limit))

    stmt = await obligation_for_fy(pool, "tds.statement.salary", fy)

    rows = await pool.fetch(
        """
        SELECT e.id AS employee_id, e.name, e.employee_code, e.pan,
               e.email, e.phone,
               p.month, p.gross, p.tds
        FROM staging.vetana_payslips p
        JOIN staging.manav_employees e
          ON e.id = p.employee_id AND e.org_id = p.org_id
        WHERE p.org_id = $1::uuid
          AND p.is_active
          AND p.month >= $2::text
          AND p.month <= $3::text
        ORDER BY e.name, p.month
        LIMIT $4::int
        """,
        org_id, f"{q_start.year:04d}-{q_start.month:02d}",
        f"{q_end.year:04d}-{q_end.month:02d}", cap,
    )

    deductees, no_pan = [], []
    for r in rows:
        line = reachable({
            "employee": r["name"],
            "employee_code": r["employee_code"],
            "pan": r["pan"] or None,
            "month": r["month"],
            "amount_paid": _f(r["gross"]),
            "tax_deducted": _f(r["tds"]),
        }, kind="employee", entity_id=r["employee_id"],
            email=r["email"], phone=r["phone"])
        deductees.append(line)
        if _f(r["tds"]) > 0 and not (r["pan"] or "").strip():
            no_pan.append(line)

    with_tds = [d for d in deductees if d["tax_deducted"] > 0]

    return {
        "as_at": today,
        "financial_year": fy,
        "quarter": f"Q{qno}",
        "quarter_from": q_start,
        "quarter_to": q_end,
        "form": (stmt or {}).get("form_number"),
        "statute": _statute_note(stmt, "quarterly salary TDS statement"),
        "due_on": None,
        "why_no_due_date": (
            "The quarterly statement is not due on a uniform day of the month — "
            "the fourth quarter differs from the other three — so the statute "
            "calendar carries no due day for it and none is printed here."),
        "counts": {
            "rows": len(deductees),
            "rows_with_tax_deducted": len(with_tds),
            "rows_with_tax_and_no_pan": len(no_pan),
            "employees": len({d["employee_code"] for d in deductees}),
            "total_deducted": round(sum(d["tax_deducted"] for d in deductees), 2),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "deductees": deductees,
        "deducted_but_no_pan": no_pan,
        "limitations": [
            "NO CHALLAN INFORMATION IS PRODUCED, and none can be. The tax shown "
            "is a computed liability on the payslip, not a deposited challan — "
            "this product records no challan at all — so the challan columns of "
            "the return remain the preparer's to fill and to map.",
            "Salary only. Deductions under any other head are not in the payroll "
            "register and are not here.",
            "The amount paid is the gross on the payslip. The return asks for "
            "the amount paid or credited, which can differ where salary was "
            "accrued and not disbursed.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 26 · check_esi_ceiling_crossings
# ══════════════════════════════════════════════════════════════════════════

async def check_esi_ceiling_crossings(
    pool, org_id: str, month: str | None = None, limit: int = 200,
) -> dict:
    """Who crossed the ESI wage ceiling, and who must keep contributing anyway.

    *month* is the wage month and defaults to the latest month with payslips.

    ── THE RULE IS THE JOIN, NOT THE CEILING ────────────────────────────────

    Crossing ₹21,000 does not stop the contribution. An employee whose wages
    rise above the ceiling PART WAY THROUGH a contribution period keeps
    contributing to the END of that period — April–September or October–March.
    So the finding that matters is not "who is over the line" but "who is over
    the line AND still owes", and stopping their contribution the month the
    raise landed is an inspection finding waiting to happen.

    Both the ceiling and the two period ends come from the statute calendar
    (migration 172). Neither is a literal here.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    if not month:
        month = await pool.fetchval(
            """
            SELECT max(month) FROM staging.vetana_payslips
            WHERE org_id = $1::uuid AND is_active
            """,
            org_id,
        )
    if not month:
        return {
            "as_at": today, "month": None, "ceiling": None,
            "counts": {"examined": 0, "crossed_and_still_owed": 0, "newly_under": 0},
            "crossed_and_still_owed": [], "newly_under": [],
            "limitations": ["No payslips exist for this organisation, so there is "
                            "nothing to test against the ceiling."],
        }

    m_start, m_end = _month_bounds(month)
    ceiling_row = await obligation(pool, "esi.wage_ceiling", as_of=m_end)
    first = await obligation(pool, "esi.contribution_period.first", as_of=m_end)
    second = await obligation(pool, "esi.contribution_period.second", as_of=m_end)

    if not ceiling_row or ceiling_row.get("threshold_amount") is None:
        return {
            "as_at": today, "month": month, "ceiling": None,
            "counts": {"examined": 0, "crossed_and_still_owed": 0, "newly_under": 0},
            "crossed_and_still_owed": [], "newly_under": [],
            "limitations": [
                f"The statute calendar records no ESI wage ceiling as of {m_end}, "
                f"so nothing was compared. This is a gap in the calendar, not a "
                f"clean month."],
        }

    ceiling = _f(ceiling_row["threshold_amount"])

    # Which contribution period this wage month falls in, and when it ends.
    # April-September is the first; everything else the second.
    in_first = 4 <= m_end.month <= 9
    period_row = first if in_first else second
    period_end = None
    if period_row and period_row.get("due_day") and period_row.get("due_month"):
        pm, pd = int(period_row["due_month"]), int(period_row["due_day"])
        py = m_end.year if pm >= m_end.month else m_end.year + 1
        try:
            period_end = date(py, pm, pd)
        except ValueError:
            period_end = None

    rows = await pool.fetch(
        """
        SELECT e.id AS employee_id, e.name, e.employee_code, e.esi_number,
               e.email, e.phone,
               p.month, p.gross, p.esi_employee, p.esi_employer
        FROM staging.vetana_payslips p
        JOIN staging.manav_employees e
          ON e.id = p.employee_id AND e.org_id = p.org_id
        WHERE p.org_id = $1::uuid
          AND p.is_active
          AND p.month = $2::text
        ORDER BY e.name
        LIMIT $3::int
        """,
        org_id, month, cap,
    )

    crossed, newly_under = [], []
    for r in rows:
        gross = _f(r["gross"])
        contributing = _f(r["esi_employee"]) > 0 or _f(r["esi_employer"]) > 0
        entry = reachable({
            "employee": r["name"],
            "employee_code": r["employee_code"],
            "esi_number": r["esi_number"] or None,
            "month": r["month"],
            "gross": gross,
            "ceiling": ceiling,
            "contributing_this_month": contributing,
        }, kind="employee", entity_id=r["employee_id"],
            email=r["email"], phone=r["phone"])
        if gross > ceiling and not contributing:
            crossed.append({
                **entry,
                "must_continue_until": period_end,
                "why": ("Wages are above the ceiling and no contribution was "
                        "deducted this month. If the crossing happened INSIDE "
                        "the current contribution period the contribution must "
                        "continue to the end of it — stopping the month the "
                        "raise landed is the inspection finding this check is "
                        "for."),
            })
        elif gross <= ceiling and not contributing:
            newly_under.append({
                **entry,
                "why": ("Wages are at or below the ceiling and nothing is being "
                        "deducted. If this person was previously covered, check "
                        "whether coverage should have continued to the period "
                        "end."),
            })

    return {
        "as_at": today,
        "month": month,
        "ceiling": ceiling,
        "contribution_period_ends": period_end,
        "statute": _statute_note(ceiling_row, "ESI wage ceiling"),
        "counts": {
            "examined": len(rows),
            "crossed_and_still_owed": len(crossed),
            "newly_under": len(newly_under),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "crossed_and_still_owed": crossed,
        "newly_under": newly_under,
        "limitations": [
            "THIS READS ONE MONTH. Whether a crossing happened INSIDE the current "
            "contribution period, which is what decides whether the contribution "
            "must continue, needs the earlier months of that period — so every "
            "row here is a question to check, not a confirmed breach.",
            "The ceiling is higher for an employee with a disability and that "
            "variation is not carried in the statute calendar, so such an "
            "employee may appear here wrongly.",
            "Coverage also depends on the establishment being covered at all and "
            "on the employee count, neither of which is tested here.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 27 · brief_professional_tax
# ══════════════════════════════════════════════════════════════════════════

async def brief_professional_tax(
    pool, org_id: str, month: str | None = None, limit: int = 200,
) -> dict:
    """Professional tax deducted this month, and what cannot be said about it.

    ── PT IS A STATE LEVY, AND THE PRODUCT KNOWS THE STATE NOW ──────────────

    It did not when this was written, and the limitation that said so was
    printed unconditionally. Migration 220 added `manav_employees.state` and is
    APPLIED, so that sentence became a false claim about the customer's own
    data — live 2026-08-26, 60 of 60 employees on one org's brief and 24 of 24
    on the other carry a state. The count is measured here instead, and the
    limitation appears only for the people genuinely missing one.

    What has NOT changed is that the amounts are what the run deducted. This
    brief joins the state to a slab to say whether a ladder EXISTS where these
    people work; it does not recompute anybody's tax. `routers/vetana.py`
    computes it, at run time, against the ladder in force then.

    ── WHAT STILL CANNOT BE SAID ────────────────────────────────────────────

    Catalogue #27 measured it and the live database agrees: the slab table
    covers three states of roughly twenty, has NO due-date and NO penalty
    column, and — the part the folio did not say — every row in
    `staging.pay_professional_tax` carries a NULLABLE `org_id`. A row that names
    an org is that org's own ladder; a row with NULL is a SHARED one, read by
    everybody. An org with neither has no slabs at all. Read the same way as
    `routers/vetana.py::_pt_slabs`, which computes the figure this reports.

    So for most orgs this prints a plain total and says, in the output, exactly
    which questions it did not answer. That is the whole design: a PT brief that
    invented a due date would be wrong in a different state every month.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    run = await _latest_approved_run(pool, org_id, month)
    wage_month = run["month"] if run else (month or f"{today.year:04d}-{today.month:02d}")

    rows = await pool.fetch(
        """
        SELECT e.id AS employee_id, e.name, e.employee_code, e.department,
               e.email, e.phone, p.professional_tax,
               -- The state the levy is actually owed to. `manav_employees.state`
               -- is migration 220 and it is APPLIED — read directly rather than
               -- through a catalogue probe like `routers/vetana.py::
               -- _employee_state_column`, because that probe exists for code
               -- that deploys BEFORE its migration and this code deploys after.
               NULLIF(btrim(COALESCE(e.state::text, '')), '') AS state
        FROM staging.vetana_payslips p
        JOIN staging.manav_employees e
          ON e.id = p.employee_id AND e.org_id = p.org_id
        WHERE p.org_id = $1::uuid
          AND p.is_active
          AND p.month = $2::text
          AND COALESCE(p.professional_tax, 0) > 0
        ORDER BY e.name
        LIMIT $3::int
        """,
        org_id, wage_month, cap,
    )

    # This org's own slab rows PLUS any shared ladder. A NULL `org_id` is a
    # ladder seeded for everybody, not a row to skip: the column is nullable and
    # a professional-tax ladder is national reference data. Scoping strictly to
    # `org_id = $1` — which this read did until 2026-08-26 — meant an org that
    # had not seeded its own saw no slabs at all, and it must match
    # `routers/vetana.py::_pt_slabs`, which decides the figure this brief
    # reports. Two different answers to "which ladder applies" is how a brief
    # ends up explaining a number the payroll did not compute.
    slabs = await pool.fetch(
        """
        SELECT state_code, state_name, slab_from, slab_to, monthly_tax, effective_from
        FROM staging.pay_professional_tax
        WHERE org_id = $1::uuid OR org_id IS NULL
        ORDER BY state_name, slab_from
        """,
        org_id,
    )
    states = sorted({s["state_name"] for s in slabs})
    total = round(sum(_f(r["professional_tax"]) for r in rows), 2)

    # WHERE THE PEOPLE ON THIS BRIEF WORK, which the product records now.
    #
    # Until migration 220 it did not, and this function said so in a limitation
    # printed on every brief. 220 is applied, so that sentence became a claim
    # about the customer's own data being absent when it is not — measured
    # read-only 2026-08-26, 60 of 60 employees on one live brief and 24 of 24 on
    # the other carry a state. The count is therefore MEASURED here and the
    # limitation only appears when somebody is genuinely missing one.
    slab_keys = set()
    for s in slabs:
        slab_keys |= _state_keys(s["state_code"], s["state_name"])

    by_state: dict = {}
    without_state = 0
    for r in rows:
        code, name = _state_label(r["state"])
        if not name:
            without_state += 1
            continue
        # Keyed on the canonical code so 'MH' and '27' are one row, not two.
        entry = by_state.setdefault(code or name.lower(), {
            "state_code": code, "state_name": name, "employees": 0,
            "professional_tax": 0.0,
            "slabs_recorded": bool(slab_keys & _state_keys(code, name)),
        })
        entry["employees"] += 1
        entry["professional_tax"] += _f(r["professional_tax"])
    employee_states = sorted(by_state.values(), key=lambda e: e["state_name"])
    for entry in employee_states:
        entry["professional_tax"] = round(entry["professional_tax"], 2)
    uncovered = [e["state_name"] for e in employee_states
                 if not e["slabs_recorded"]]

    limitations = [
        "NO DUE DATE AND NO PENALTY ARE SHOWN. Professional tax is a STATE levy: "
        "the due date and the penalty differ by state and by slab, and the slab "
        "table in this product carries neither column. Printing a date from "
        "memory would be wrong in a different state every month.",
        "The slab table is read as this organisation's own rows PLUS any shared "
        "ladder (a row with no org_id). An organisation with neither has no "
        "slabs at all rather than a national default, and covers three states "
        "of roughly twenty either way.",
    ]
    if without_state:
        limitations.append(
            f"{without_state} of {len(rows)} employees below have NO work state "
            "recorded, so for those the amount is only what the payroll run "
            "deducted and cannot be attributed to any state's ladder. It is "
            "entered on the employee, and it is what decides the rate.")
    if uncovered:
        stranded = sum(e["employees"] for e in employee_states
                       if not e["slabs_recorded"])
        limitations.append(
            f"NO SLAB IS RECORDED FOR {', '.join(uncovered)}, where "
            f"{stranded} of the {len(rows)} employees below are employed. The "
            "deduction still happened and is shown; nothing here can say "
            "whether it was the right one.")
    limitations += [
        "Every amount below is what the payroll run DEDUCTED, not a figure "
        "re-derived from the slabs shown here — and it should not be. A run "
        "computed under an earlier ladder must keep the figure it was computed "
        "with; re-deriving it today would silently restate a settled run.",
        "The annual PTEC — the employer's own enrolment certificate — is a "
        "separate liability from the PTRC deducted here and is not tracked "
        "anywhere in this product.",
    ]
    if not slabs:
        limitations.insert(0,
            "This organisation has NO professional tax slabs recorded, so only "
            "the amount actually deducted is shown. Seeding the slabs for the "
            "states you employ in is a data job, not a code change.")

    return {
        "as_at": today,
        "month": wage_month,
        "run_status": run["status"] if run else None,
        "total_deducted": total,
        "run_total_pt": _f(run["total_pt"]) if run else None,
        "employees_deducted": len(rows),
        "states_with_slabs_recorded": states,
        "employee_states": employee_states,
        "due_date": None,
        "penalty": None,
        "counts": {
            "employees_with_pt": len(rows),
            "employees_without_state": without_state,
            "slab_rows_for_this_org": len(slabs),
            "states_covered": len(states),
            "states_on_this_brief": len(employee_states),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "employees": [
            reachable({
                "employee": r["name"],
                "employee_code": r["employee_code"],
                "department": r["department"] or None,
                # The name, never the code — a reader who is told '27' has been
                # told nothing, and this brief is read by the person who has to
                # answer for the deduction.
                "state": _state_label(r["state"])[1],
                "professional_tax": _f(r["professional_tax"]),
            }, kind="employee", entity_id=r["employee_id"],
                email=r["email"], phone=r["phone"])
            for r in rows
        ],
        "limitations": limitations,
    }
