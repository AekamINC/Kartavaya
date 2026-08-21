"""
payroll_variance — whose pay moved, and by how much.

── The default is the whole story ────────────────────────────────────────────

This handler was specced defaulting `month` to the wall clock, and it was
verified at a hand-picked month rather than that default. At the real default it
would have shipped a confident false alarm on payroll.

Aekam Inc has exactly one payslip row, for 2026-07. Run today, a wall-clock
default asks for 2026-08, finds nothing, and the FULL OUTER JOIN reports the
org's only employee as `dropped_out_of_run` — the highest-severity value this
handler can emit — when nothing has happened except that August has not been run
yet. Not an empty result: a maximally alarming claim about somebody's pay,
derived entirely from a calendar.

So the default is **the latest month that actually has payslips**, and if there
are none the answer is an empty comparison rather than an invented one. And
`dropped_out_of_run` is suppressed entirely when the compared month has no
payslips org-wide, because "the run has not been made" and "this person was
dropped from the run" are different facts that the join cannot tell apart.

── Read the payslips, never the run header ───────────────────────────────────

`vetana_payroll_runs.total_net` disagrees with the sum of its own payslips on 4
of QA Test Corp's 9 runs — one header carries an impossible negative net. The
payslips are the register; the header is a cached total that has drifted. Every
figure here comes from `vetana_payslips`.

── Percentages are not always available ──────────────────────────────────────

`net_delta_pct` is NULL wherever the prior month's net was zero, which is every
QA row at its own default. The absolute-rupee threshold is what catches those,
which is why both thresholds exist and why neither is optional.
"""
import logging

from services.skills.reachable import reachable

log = logging.getLogger(__name__)


async def compare_payroll_months(
    pool,
    org_id: str,
    month: str | None = None,
    threshold_pct: float = 10.0,
    threshold_amount: float = 1000.0,
    limit: int = 200,
) -> dict:
    """Employees whose pay moved materially between *month* and the month before.

    *month* defaults to the latest month with payslips — NOT to today. See the
    module docstring; a wall-clock default turns "not run yet" into "dropped
    from the run".

    Returns {month, prior_month, changes: [...], counts, note?}.
    """
    if not month:
        month = await pool.fetchval(
            """
            SELECT max(month) FROM staging.vetana_payslips
            WHERE org_id = $1::uuid AND is_active = TRUE
            """,
            org_id,
        )
    if not month:
        return {
            "month": None,
            "changes": [],
            "counts": {"changes": 0},
            "note": "No payroll has been run for this organisation, so there is "
                    "nothing to compare. This is not a finding about anybody's pay.",
        }

    # Whether the compared month has any payslips at all decides whether
    # "dropped out of the run" is a claim we are entitled to make.
    current_count = await pool.fetchval(
        """
        SELECT count(*) FROM staging.vetana_payslips
        WHERE org_id = $1::uuid AND is_active = TRUE AND month = $2
        """,
        org_id, month,
    )

    rows = await pool.fetch(
        """
        WITH prev AS (
            SELECT to_char(to_date($2 || '-01','YYYY-MM-DD') - INTERVAL '1 month', 'YYYY-MM') AS pm
        ),
        -- Join shape copied verbatim from routers/vetana.py:980-993, including
        -- `AND e.org_id = p2.org_id` — the cross-tenant tightening that file
        -- documents at :985-989.
        cur AS (
            SELECT p2.employee_id, e.name AS employee_name, e.employee_code,
                   e.email AS employee_email, e.phone AS employee_phone,
                   p2.gross, p2.net_pay, p2.total_deductions, p2.loan_deduction,
                   p2.reimbursements, p2.overtime_pay,
                   p2.present_days, p2.leaves_unpaid
            FROM staging.vetana_payslips p2
            JOIN staging.manav_employees e ON e.id = p2.employee_id AND e.org_id = p2.org_id
            WHERE p2.org_id = $1::uuid AND p2.is_active = TRUE AND p2.month = $2
        ),
        pri AS (
            SELECT p3.employee_id, e.name AS employee_name,
                   e.email AS employee_email, e.phone AS employee_phone,
                   p3.gross, p3.net_pay, p3.total_deductions, p3.loan_deduction,
                   p3.reimbursements, p3.overtime_pay, p3.present_days, p3.leaves_unpaid
            FROM staging.vetana_payslips p3
            JOIN staging.manav_employees e ON e.id = p3.employee_id AND e.org_id = p3.org_id
            WHERE p3.org_id = $1::uuid AND p3.is_active = TRUE AND p3.month = (SELECT pm FROM prev)
        )
        SELECT
          COALESCE(c.employee_name, r.employee_name)   AS employee_name,
          COALESCE(c.employee_id,   r.employee_id)     AS person_id,
          COALESCE(c.employee_email, r.employee_email) AS employee_email,
          COALESCE(c.employee_phone, r.employee_phone) AS employee_phone,
          (SELECT pm FROM prev)                      AS prior_month,
          CASE WHEN r.employee_id IS NULL THEN 'new_this_month'
               WHEN c.employee_id IS NULL THEN 'dropped_out_of_run'
               ELSE 'compared' END                   AS movement,
          c.net_pay AS net_now, r.net_pay AS net_prior,
          COALESCE(c.net_pay,0) - COALESCE(r.net_pay,0) AS net_delta,
          CASE WHEN COALESCE(r.net_pay,0) = 0 THEN NULL
               ELSE round((COALESCE(c.net_pay,0)-r.net_pay)/r.net_pay*100, 2) END AS net_delta_pct,
          COALESCE(c.total_deductions,0)-COALESCE(r.total_deductions,0) AS deductions_delta,
          COALESCE(c.loan_deduction,0)-COALESCE(r.loan_deduction,0)     AS loan_delta,
          COALESCE(c.overtime_pay,0)-COALESCE(r.overtime_pay,0)         AS overtime_delta,
          COALESCE(c.present_days,0)-COALESCE(r.present_days,0)         AS present_days_delta,
          COALESCE(c.leaves_unpaid,0)-COALESCE(r.leaves_unpaid,0)       AS unpaid_leave_delta
        FROM cur c
        FULL OUTER JOIN pri r ON r.employee_id = c.employee_id
        WHERE c.employee_id IS NULL OR r.employee_id IS NULL
           OR abs(COALESCE(c.net_pay,0)-COALESCE(r.net_pay,0)) >= $4
           OR (r.net_pay <> 0 AND abs((COALESCE(c.net_pay,0)-r.net_pay)/r.net_pay*100) >= $3)
        ORDER BY abs(COALESCE(c.net_pay,0)-COALESCE(r.net_pay,0)) DESC
        LIMIT $5
        """,
        org_id, month, threshold_pct, threshold_amount, limit,
    )

    def _num(v):
        return float(v) if v is not None else None

    changes = []
    for r in rows:
        movement = r["movement"]
        # The suppression. With no payslips in the compared month, EVERY prior
        # employee falls out of the join, and calling that "dropped from the
        # run" is a claim about payroll derived from a calendar.
        if movement == "dropped_out_of_run" and not current_count:
            continue
        changes.append(reachable({
            "employee": r["employee_name"],
            "movement": movement,
            "net_now": _num(r["net_now"]),
            "net_prior": _num(r["net_prior"]),
            "net_delta": _num(r["net_delta"]),
            "net_delta_pct": _num(r["net_delta_pct"]),
            "deductions_delta": _num(r["deductions_delta"]),
            "loan_delta": _num(r["loan_delta"]),
            "overtime_delta": _num(r["overtime_delta"]),
            "present_days_delta": r["present_days_delta"],
            "unpaid_leave_delta": r["unpaid_leave_delta"],
        }, kind="employee", entity_id=r["person_id"],
            email=r["employee_email"], phone=r["employee_phone"]))

    out = {
        "month": month,
        "prior_month": rows[0]["prior_month"] if rows else None,
        "changes": changes,
        "counts": {"changes": len(changes)},
        "thresholds": {"pct": threshold_pct, "amount": threshold_amount},
    }
    if not current_count:
        out["note"] = (
            f"No payroll has been run for {month} yet, so nothing is compared "
            f"against it. Nobody has been dropped from a run — the run has not "
            f"happened."
        )
    elif changes and all(c["net_delta_pct"] is None for c in changes):
        out["note"] = (
            "Percentage change is unavailable for every employee here because "
            "their prior month's net pay was zero. These were caught by the "
            f"rupee threshold of {threshold_amount:.0f} alone."
        )
    return out
