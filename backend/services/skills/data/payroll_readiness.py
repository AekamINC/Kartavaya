"""
payroll_readiness — everything that would make this month's payroll run wrong,
before it is run.

Payroll is the one process here that is hard to undo. A missed employee is a
person not paid; an unverified month is money out against attendance nobody
checked. Each condition below is read straight off what `process_payroll`
(`routers/vetana.py`) actually does, so this is not a list of things that sound
risky — it is a list of things that change the result:

  no_salary_structure        `vetana.py:1268-1288` SKIPS the employee entirely.
                             They are simply not paid, and nothing says so.
  no_attendance_recorded     `vetana.py:1382` falls back to paying the whole
                             employed window, unverified.
  unapproved_leave           `vetana.py:1419` counts `status='approved'` only,
                             so a pending request is treated as neither paid nor
                             unpaid leave.
  run_already_locked         `vetana.py:1191-1196` refuses anything but a draft
                             run — so the month cannot be reprocessed at all.

Verified live: Aekam Inc has 2 findings for the current month, and both are real
— one employee would be silently omitted, another paid a full month against no
attendance at all.

── WHO IS IN SCOPE IS ITSELF ONE OF THE ANSWERS ─────────────────────────────

Every finding above is a claim about a person the run will pay, so the roster
this handler starts from has to be the run's roster and not a near-miss. It was
a near-miss: `is_active = TRUE` and nothing else, while `process_payroll` also
drops anyone whose recorded last working day predates the month. Measured
read-only 2026-08-26, E2E Test & Associates: 10 employees are `is_active` while
holding a non-cancelled exit dated in the past, 9 of them before 1 August. Those
nine were being checked for bank details and attendance for a month in which
they are not paid at all — noise on a screen whose entire value is that every
line on it is real.

── Blockers and warnings are different things ────────────────────────────────

A blocker changes who gets paid or whether the run can happen. A warning changes
an amount in a way somebody should have decided deliberately — a structure that
came into effect mid-month, an advance whose recovery will be capped. Both are
returned; conflating them would bury the four that stop the run.

── This handler reads salary ────────────────────────────────────────────────

It needs `vetana` AND `manav`, and the declaration is exact. Without `vetana` a
reader would learn each named person's basic pay and the size of every
outstanding salary advance — a personal debt disclosure, not a payroll figure.
Without `manav` they would learn the roster and its bank details. Neither may be
dropped to widen the audience.
"""
import logging

from services.skills.reachable import reachable
from services.skills.timeutil import utc_now

log = logging.getLogger(__name__)


async def check_payroll_readiness(
    pool, org_id: str, month: str | None = None, limit: int = 200
) -> dict:
    """Findings that would corrupt the payroll run for *month* ('YYYY-MM').

    Defaults to the current month, which is the month somebody is about to run.

    Returns {month, blockers: [...], warnings: [...], counts}. Every finding
    carries `month` and `employee_code` so an acknowledgement can be filed
    against it — see `services/skill_ack_wiring.py`.
    """
    month = month or utc_now().strftime("%Y-%m")

    rows = await pool.fetch(
        """
        WITH bounds AS (
            SELECT to_date($2 || '-01', 'YYYY-MM-DD') AS month_start,
                   (to_date($2 || '-01','YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date AS month_end
        ),
        -- The run's roster, not an approximation of it: `is_active` AND no
        -- live exit dated before the month began, which is the whole of
        -- routers/vetana.py:1276-1287's employee predicate. `<`, not `<=`,
        -- so somebody whose last day is the 1st is still paid for it; a NULL
        -- last_working_day keeps them (nullable in migration 083, `NULL <
        -- date` is NULL, NOT EXISTS admits them) because an exit started and
        -- never dated is not evidence anyone has gone; `status <> 'cancelled'`
        -- is 083's own vocabulary, so a mistaken exit that was cancelled and
        -- redone still counts as staff. `x.org_id = e.org_id` is not
        -- decoration — manav_offboarding has no composite FK, and it is the
        -- only thing stopping another org's exit row silencing this org's
        -- blocker.
        emp AS (
            SELECT e.id, e.name, e.employee_code, e.bank_details,
                   e.email, e.phone
            FROM staging.manav_employees e, bounds b
            WHERE e.org_id = $1::uuid AND e.is_active = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM staging.manav_offboarding x
                  WHERE x.org_id = e.org_id AND x.employee_id = e.id
                    AND x.status <> 'cancelled'
                    AND x.last_working_day < b.month_start)
        ),
        -- Together with `emp` above, exactly the rows
        -- routers/vetana.py:1268-1288 would pick up. That parity is the point
        -- of this handler and it has to be kept in BOTH halves: it was true of
        -- the structure half alone and false of the roster half for as long as
        -- the roster was is_active-only, which is how nine leavers went on
        -- being audited for a run that does not pay them.
        struct_in_scope AS (
            SELECT s.employee_id, s.effective_from, s.updated_at, s.basic,
                   ROW_NUMBER() OVER (PARTITION BY s.employee_id ORDER BY s.effective_from DESC) AS rn,
                   COUNT(*)     OVER (PARTITION BY s.employee_id) AS n_candidates
            FROM staging.vetana_salary_structures s, bounds b
            WHERE s.org_id = $1::uuid AND s.is_active = TRUE AND s.effective_from <= b.month_end
        ),
        -- The nine branches, wrapped so the EMPLOYEE CODE can be joined on once
        -- rather than added to each of them. `employee_code` is what
        -- `services/skill_ack_wiring.py` keys an acknowledgement on: measured
        -- live, the largest org has ten NAMES carried by three active people
        -- each, so keying on `employee_name` would let one acknowledgement of
        -- one person's blocker silence two colleagues' — and a blocker here
        -- means somebody is not paid at all.
        findings AS (
        SELECT 'blocker'::text AS severity, 'no_salary_structure'::text AS check_code,
               e.name AS employee_name, e.id AS employee_id,
               e.email AS employee_email, e.phone AS employee_phone,
               'no active salary structure effective on or before month end; the run omits them entirely'::text AS detail,
               NULL::numeric AS amount
        FROM emp e WHERE NOT EXISTS (SELECT 1 FROM struct_in_scope s WHERE s.employee_id = e.id)
        UNION ALL
        SELECT 'blocker','missing_bank_details', e.name, e.id, e.email, e.phone,
               'bank_details has no account_number; salary cannot be disbursed', NULL
        FROM emp e WHERE COALESCE(NULLIF(e.bank_details->>'account_number',''),'') = ''
          AND EXISTS (SELECT 1 FROM struct_in_scope s WHERE s.employee_id = e.id)
        UNION ALL
        SELECT 'blocker','no_attendance_recorded', e.name, e.id, e.email, e.phone,
               'no attendance row in the month; the run pays every day they were on the rolls without verification — the whole month for anyone employed throughout', NULL
        FROM emp e, bounds b
        WHERE EXISTS (SELECT 1 FROM struct_in_scope s WHERE s.employee_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM staging.manav_attendance a
              WHERE a.org_id = $1::uuid AND a.employee_id = e.id
                AND a.date >= b.month_start AND a.date <= b.month_end
                AND a.status IN ('present','late','half_day','absent'))
        UNION ALL
        SELECT 'blocker','unapproved_leave', e.name, e.id, e.email, e.phone,
               'leave request still pending for '||lr.start_date::text||' to '||lr.end_date::text
                 ||'; the run treats it as neither paid nor unpaid leave', lr.days
        FROM emp e
        JOIN staging.manav_leave_requests lr ON lr.employee_id = e.id AND lr.org_id = $1::uuid
        CROSS JOIN bounds b
        WHERE lr.status = 'pending' AND lr.start_date <= b.month_end AND lr.end_date >= b.month_start
        UNION ALL
        SELECT 'blocker','run_already_locked', NULL, NULL::uuid, NULL, NULL,
               'payroll run for '||$2||' already exists with status '''||r.status
                 ||'''; process_payroll refuses anything other than draft', r.total_net
        FROM staging.vetana_payroll_runs r
        WHERE r.org_id = $1::uuid AND r.month = $2 AND r.status <> 'draft'
        UNION ALL
        SELECT 'warning','structure_effective_mid_month', e.name, e.id, e.email, e.phone,
               'salary structure effective from '||s.effective_from::text
                 ||' (inside the month); the run prorates the whole month at the new figures', s.basic
        FROM emp e JOIN struct_in_scope s ON s.employee_id = e.id AND s.rn = 1 CROSS JOIN bounds b
        WHERE s.effective_from > b.month_start AND s.effective_from <= b.month_end
        UNION ALL
        SELECT 'warning','structure_edited_during_month', e.name, e.id, e.email, e.phone,
               'salary structure last edited '||s.updated_at::date::text||' with effective_from '
                 ||s.effective_from::text||' (edited in place, not a new structure)', s.basic
        FROM emp e JOIN struct_in_scope s ON s.employee_id = e.id AND s.rn = 1 CROSS JOIN bounds b
        WHERE s.updated_at::date >= b.month_start AND s.updated_at::date <= b.month_end
          AND s.effective_from < b.month_start
        UNION ALL
        SELECT 'warning','multiple_active_structures', e.name, e.id, e.email, e.phone,
               s.n_candidates::text||' active structures effective on or before month end; the run uses the one from '
                 ||s.effective_from::text||' and ignores the rest', NULL
        FROM emp e JOIN struct_in_scope s ON s.employee_id = e.id AND s.rn = 1 WHERE s.n_candidates > 1
        UNION ALL
        SELECT 'warning','outstanding_advance', e.name, e.id, e.email, e.phone,
               'active advance, EMI '||l.emi_amount::text||' against balance '||l.balance_remaining::text
                 ||'; recovery stops at 50% of gross and the remainder carries forward',
               LEAST(l.emi_amount, l.balance_remaining)
        FROM emp e JOIN staging.vetana_loans l ON l.employee_id = e.id AND l.org_id = $1::uuid
        WHERE l.status = 'active' AND l.balance_remaining > 0
        UNION ALL
        SELECT 'warning','unapproved_expense_claim', e.name, e.id, e.email, e.phone,
               'expense claim of '||c.amount::text||' dated '||c.expense_date::text
                 ||' still pending; it will not be reimbursed in this run', c.amount
        FROM emp e JOIN staging.manav_expense_claims c ON c.employee_id = e.id AND c.org_id = $1::uuid
        CROSS JOIN bounds b
        WHERE c.status = 'pending' AND c.payslip_id IS NULL AND c.expense_date <= b.month_end
        )
        -- LEFT JOIN, and org-scoped on both sides. `run_already_locked` carries
        -- no employee at all and must keep its row; a finding that lost its
        -- place in the list because nobody owns it would be the one blocker
        -- that stops the whole run.
        SELECT f.*, e2.employee_code
        FROM findings f
        LEFT JOIN staging.manav_employees e2
               ON e2.id = f.employee_id AND e2.org_id = $1::uuid
        ORDER BY f.severity, f.check_code, f.employee_name
        LIMIT $3
        """,
        org_id, month, limit,
    )

    def _finding(r):
        out = {
            # `month` rides on every finding, not only on the envelope, because
            # an acknowledgement is filed against the finding alone. Without it
            # "Priya has no salary structure" acknowledged in August would stay
            # silenced in September — and in September the run will omit her
            # again, which is a person not paid for a second month.
            "month": month,
            "check": r["check_code"],
            "employee": r["employee_name"],
            # NOT for printing — the printable name is `employee`. This is the
            # stable business key an acknowledgement is filed under; see the
            # note on the `findings` CTE above.
            "employee_code": r["employee_code"],
            "detail": r["detail"],
        }
        if r["amount"] is not None:
            out["amount"] = float(r["amount"])
        # Who to contact, and where the record is. `run_already_locked` is
        # about the run rather than a person, so it passes None and comes back
        # with no contact keys at all.
        return reachable(out, kind="employee", entity_id=r["employee_id"],
                         email=r["employee_email"], phone=r["employee_phone"])

    blockers = [_finding(r) for r in rows if r["severity"] == "blocker"]
    warnings = [_finding(r) for r in rows if r["severity"] == "warning"]

    return {
        "month": month,
        "blockers": blockers,
        "warnings": warnings,
        "counts": {"blockers": len(blockers), "warnings": len(warnings)},
        "note": (
            "Blockers change who gets paid or stop the run. Warnings change an "
            "amount in a way somebody should decide deliberately. An empty list "
            "means no finding, not that a check was skipped."
        ),
    }
