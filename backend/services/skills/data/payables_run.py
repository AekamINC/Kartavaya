"""
payables_run — the week's proposed vendor payments, with ageing.

A PROPOSAL. It reads `staging.ganit_vendor_bills` and nothing else, and it never
touches `record_vendor_payment` — that route is approver-gated and Ganit is a
separated-duty module (`middleware/role_tiers.py`), so the authority to decide a
payment and the authority to record one are deliberately held by different
people. A skill that could do both would collapse that separation into whoever
happened to press Run.

── Three deliberate departures from the router it copies ─────────────────────

The query shape is `routers/ganit.py:1871-1884` (the vendors join) and
`:1903-1915` (the 30/60/90 ladder), with three changes, each of which matters:

  LEFT JOIN, not the router's inner join at ganit.py:1874. A payable must never
  vanish from a payment run because its vendor row was soft-deleted — the money
  is still owed. Both orgs resolve every vendor name today, so this changes no
  current row; it changes what happens the day one is deleted.

  The join carries `AND v.org_id = b.org_id`, which the router omits. Cheap, and
  it closes a cross-tenant name read if `vendor_id` is ever wrong.

  `as_of` is passed in from `utc_now().date()` rather than using CURRENT_DATE
  (ganit.py:1905-1908). CURRENT_DATE follows the database session's timezone, so
  the ageing bucket a bill lands in would depend on where the query ran. Passing
  the date makes the boundary deterministic and testable.

── Everything overdue is included, whatever the horizon ─────────────────────

The filter is `due_date <= as_of + horizon`, so anything already past due is
necessarily inside it. A horizon of 7 does not mean "only bills due this week";
it means "this week's, plus everything already late" — which is what a payment
run is.
"""
import logging

from services.skills.timeutil import utc_now

log = logging.getLogger(__name__)


async def propose_payment_run(
    pool, org_id: str, horizon_days: int = 7, limit: int = 200
) -> dict:
    """Vendor bills falling due within *horizon_days*, plus everything overdue.

    Returns {as_of, horizon_days, total_due, by_bucket, bills: [...]}.
    """
    as_of = utc_now().date()

    rows = await pool.fetch(
        """
        SELECT b.bill_number,
               b.internal_ref,
               v.name  AS vendor_name,
               v.gstin AS vendor_gstin,
               b.bill_date,
               b.due_date,
               b.total,
               COALESCE(b.amount_paid, 0)            AS amount_paid,
               b.total - COALESCE(b.amount_paid, 0)  AS balance_due,
               b.currency,
               b.status,
               CASE WHEN b.due_date IS NULL OR b.due_date >= $2::date THEN 'current'
                    WHEN $2::date - b.due_date <= 30 THEN '1-30'
                    WHEN $2::date - b.due_date <= 60 THEN '31-60'
                    WHEN $2::date - b.due_date <= 90 THEN '61-90'
                    ELSE '90+' END                   AS ageing_bucket,
               CASE WHEN b.due_date IS NULL THEN NULL
                    ELSE ($2::date - b.due_date) END AS days_past_due
        FROM staging.ganit_vendor_bills b
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status NOT IN ('paid', 'cancelled')
          AND b.total - COALESCE(b.amount_paid, 0) > 0
          AND (b.due_date IS NULL OR b.due_date <= $2::date + $3::int)
        ORDER BY b.due_date NULLS FIRST, balance_due DESC
        LIMIT $4
        """,
        org_id, as_of, horizon_days, limit,
    )

    bills = []
    by_bucket: dict[str, dict] = {}
    total_due = 0.0

    for r in rows:
        balance = float(r["balance_due"] or 0)
        total_due += balance
        bucket = r["ageing_bucket"]
        slot = by_bucket.setdefault(bucket, {"count": 0, "amount": 0.0})
        slot["count"] += 1
        slot["amount"] = round(slot["amount"] + balance, 2)

        bills.append({
            "bill": r["bill_number"] or r["internal_ref"],
            # A soft-deleted vendor still owes; say so rather than showing null.
            "vendor": r["vendor_name"] or "(vendor record unavailable)",
            "vendor_gstin": r["vendor_gstin"],
            "bill_date": r["bill_date"].isoformat() if r["bill_date"] else None,
            "due_date": r["due_date"].isoformat() if r["due_date"] else None,
            "total": float(r["total"] or 0),
            "already_paid": float(r["amount_paid"] or 0),
            "balance_due": balance,
            "currency": r["currency"],
            "status": r["status"],
            "ageing": bucket,
            "days_past_due": r["days_past_due"],
        })

    out = {
        "as_of": as_of.isoformat(),
        "horizon_days": horizon_days,
        "total_due": round(total_due, 2),
        "by_bucket": by_bucket,
        "bills": bills,
        "note": (
            "A proposal only. Nothing here has been paid or scheduled, and this "
            "skill cannot record a payment — that is a separate, approver-gated "
            "action in Ganit."
        ),
    }
    if len(rows) == limit:
        out["caveat"] = (
            f"Capped at {limit} bills. The total shown is therefore a floor, not "
            f"the full payables position."
        )
    return out
