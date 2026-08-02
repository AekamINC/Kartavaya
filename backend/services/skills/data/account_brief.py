"""
account_brief — everything known about one customer, assembled for a call.

── This skill needs THREE grants, and that is the honest cost ─────────────────

It reads `graha` (contact, deals, activity), `ganit` (invoices) and `vikray`
(orders). `services/skills/modules.py` requires the caller to hold every module
a skill names, so a sales user holding only `graha` is refused the WHOLE brief,
header included — in practice this is an org_owner / org_admin skill.

That is the right trade for a full account brief: the value is precisely that
one page carries the relationship AND the money, and a version that silently
omitted the invoices would be a call brief that lets a partner walk into a
meeting not knowing the client is 74,000 in arrears. If a narrower version is
wanted later, the invoices and orders sections split into their own handlers and
compose in the template — they do not get quietly dropped from this one.

── Every statement carries org_id ────────────────────────────────────────────

`graha.py:560-575` filters its child queries on `contact_id` alone and relies on
the parent lookup 404ing first. That is safe in a router where the id came from
a URL the caller was already authorised for. It is NOT safe here: a skill's
`contact_id` arrives from a template's params, so an unfiltered child query is a
cross-tenant read. Each of the five statements filters on org_id independently.

── Invoices are returned with a flag, not filtered ───────────────────────────

Open-only would have returned nothing for the one contact that exercises every
section — her single invoice is paid. "They paid 88,500 on time" is exactly what
you want to know walking into a call, so history is kept and `is_open` marks
what still needs chasing.
"""
import logging

log = logging.getLogger(__name__)


async def get_account_brief(
    pool, org_id: str, contact_id: str, activity_limit: int = 50
) -> dict:
    """One customer, across CRM, finance and sales.

    Returns {contact, open_deals, recent_activity, invoices, recent_orders}.
    A contact that does not belong to this org returns {"contact": None} rather
    than raising — the caller asked about somebody who is not theirs, and that
    is an empty answer, not an error.
    """
    header = await pool.fetchrow(
        """
        SELECT c.id, c.name, c.email, c.phone, c.company, c.designation,
               c.contact_type, c.source, c.lead_score, c.assigned_to,
               c.last_contacted_at, c.converted_at, c.tags, c.notes,
               c.gstin, c.created_at, c.client_id, cl.name AS client_name
        FROM staging.graha_contacts c
        LEFT JOIN staging.graha_clients cl
               ON cl.id = c.client_id AND cl.org_id = c.org_id
        WHERE c.id = $2::uuid AND c.org_id = $1::uuid AND c.is_active = TRUE
        """,
        org_id, contact_id,
    )
    if not header:
        return {"contact": None, "note": "No such contact in this organisation."}

    deals = await pool.fetch(
        """
        SELECT d.id, d.title, d.value, d.currency, d.stage, d.probability,
               d.expected_close_date, d.assigned_to, d.created_at, d.updated_at
        FROM staging.graha_deals d
        WHERE d.org_id = $1::uuid AND d.contact_id = $2::uuid
          AND d.is_active = TRUE AND d.won_at IS NULL AND d.lost_at IS NULL
        ORDER BY COALESCE(d.value, 0) DESC, d.created_at DESC
        LIMIT 200
        """,
        org_id, contact_id,
    )

    activity = await pool.fetch(
        """
        (SELECT 'activity' AS kind, a.id, a.activity_type AS subtype, a.title,
                a.is_completed, a.created_at AS at, a.scheduled_at AS due
         FROM staging.graha_activities a
         WHERE a.org_id = $1::uuid AND a.contact_id = $2::uuid)
        UNION ALL
        (SELECT 'follow_up', f.id, NULL, f.title,
                f.is_completed, f.created_at, f.due_at
         FROM staging.graha_follow_ups f
         WHERE f.org_id = $1::uuid AND f.contact_id = $2::uuid)
        ORDER BY at DESC
        LIMIT $3
        """,
        org_id, contact_id, activity_limit,
    )

    invoices = await pool.fetch(
        """
        SELECT i.id, i.invoice_number, i.invoice_date, i.due_date,
               i.total, i.amount_paid, i.balance_due, i.payment_status,
               (COALESCE(i.payment_status,'unpaid') IN ('unpaid','partial','overdue')) AS is_open
        FROM staging.ganit_invoices i
        WHERE i.org_id = $1::uuid AND i.contact_id = $2::uuid
          AND i.is_active = TRUE AND i.invoice_type = 'tax_invoice'
        ORDER BY is_open DESC, i.invoice_date DESC
        LIMIT 200
        """,
        org_id, contact_id,
    )

    orders = await pool.fetch(
        """
        SELECT o.id, o.order_number, o.order_date, o.expected_delivery,
               o.total, o.status, o.invoice_id
        FROM staging.vikray_orders o
        WHERE o.org_id = $1::uuid AND o.contact_id = $2::uuid AND o.is_active = TRUE
        ORDER BY o.order_date DESC
        LIMIT 200
        """,
        org_id, contact_id,
    )

    def _money(v):
        return float(v) if v is not None else None

    def _iso(v):
        return v.isoformat() if v is not None else None

    return {
        "contact": {
            "id": str(header["id"]),
            "name": header["name"],
            "company": header["company"] or header["client_name"],
            "designation": header["designation"],
            "email": header["email"],
            "phone": header["phone"],
            "type": header["contact_type"],
            "source": header["source"],
            "gstin": header["gstin"],
            "owner": header["assigned_to"],
            "last_contacted": _iso(header["last_contacted_at"]),
            "notes": header["notes"],
        },
        "open_deals": [
            {
                "title": d["title"], "value": _money(d["value"]),
                "stage": d["stage"], "probability": d["probability"],
                "expected_close": _iso(d["expected_close_date"]),
            }
            for d in deals
        ],
        "recent_activity": [
            {
                "kind": a["kind"], "type": a["subtype"], "title": a["title"],
                "done": a["is_completed"], "at": _iso(a["at"]), "due": _iso(a["due"]),
            }
            for a in activity
        ],
        "invoices": [
            {
                "number": i["invoice_number"], "date": _iso(i["invoice_date"]),
                "due": _iso(i["due_date"]), "total": _money(i["total"]),
                "paid": _money(i["amount_paid"]), "outstanding": _money(i["balance_due"]),
                "status": i["payment_status"], "is_open": i["is_open"],
            }
            for i in invoices
        ],
        "recent_orders": [
            {
                "number": o["order_number"], "date": _iso(o["order_date"]),
                "expected_delivery": _iso(o["expected_delivery"]),
                "total": _money(o["total"]), "status": o["status"],
                "invoiced": o["invoice_id"] is not None,
            }
            for o in orders
        ],
    }
