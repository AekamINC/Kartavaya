"""
gst_readiness — which invoices cannot be filed, and why.

GSTR-1 is filed monthly and rejected wholesale for defects in individual
invoices. Finding them the day before the deadline is the difference between an
afternoon of corrections and a late-filing penalty, and the defects are exactly
the kind a person does not notice: a place of supply nobody filled in, a
counterparty GSTIN with a typo that still looks like a GSTIN, a line item
missing its HSN code.

── It returns the MANIFEST, never the filing payload ─────────────────────────

`routers/documents.py:_build_gstr1` builds the actual return — the JSON that
gets filed. This skill deliberately does NOT call it and does not reproduce it.
A skill hands its output to a language model, and a model given a filing payload
will summarise it, reformat it, and eventually be asked to "fix" it. The filing
path has one implementation and it is not this one.

What comes back is a list of broken invoices and the specific edit each needs.

── The GSTIN check is borrowed, never reimplemented ──────────────────────────

`services/gstin.py:is_valid` computes the check digit. Verified live that it
discriminates rather than rubber-stamping: 24AAACM1234C1ZP and 24AAACQ1234F1Z5
are rejected, 27AAQCR5055K1ZR is accepted. A second implementation of a check
digit is a second implementation that drifts.
"""
import logging

from services.gstin import is_valid as gstin_is_valid
from services.skills.timeutil import month_window, return_period

log = logging.getLogger(__name__)

#: Only these participate in GSTR-1. A proforma or a quotation is not a supply.
_FILEABLE = ("tax_invoice", "credit_note", "debit_note")


#: THE MONTH IS `services.skills.timeutil.month_window` AND IS IMPORTED, NOT
#: RESTATED. HALF-OPEN — pair the second bound with `<`, never `<=`. Ten modules
#: declared their own until 2026-09-04 under one name and two contracts; the
#: name now carries which one this is.
_period_bounds = month_window


async def check_gstr1_readiness(
    pool, org_id: str, period: str | None = None, limit: int = 200
) -> dict:
    """Every invoice in *period* that would block or corrupt a GSTR-1 filing.

    *period* is 'YYYY-MM', and defaults to the period a firm is actually working
    on — the previous month, because GSTR-1 for August is due on 11 September.

    Without that default this handler could not complete a run at all: the
    dispatcher refuses any skill whose signature declares a parameter with no
    default that nobody supplied, so a scheduled or one-click run of the most
    valuable skill in the catalogue died before it reached a query. The fix is
    the one already used by `check_payroll_readiness` — a sensible default beats
    an argument nobody is there to pass.

    Returns {period, examined, blocked, invoices: [...]}.
    """
    period = period or return_period()
    try:
        start, end = _period_bounds(period)
    except (ValueError, AttributeError):
        return {"error": f"'{period}' is not a period. Expected YYYY-MM, e.g. 2026-07."}

    rows = await pool.fetch(
        """
        SELECT i.invoice_number, i.invoice_date, i.invoice_type,
               COALESCE(btrim(i.place_of_supply), '')            AS place_of_supply,
               COALESCE(NULLIF(btrim(c.company), ''),
                        NULLIF(btrim(c.name), ''), '')           AS counterparty,
               COALESCE(btrim(c.gstin), '')                      AS counterparty_gstin,
               (jsonb_typeof(i.line_items) IS DISTINCT FROM 'array'
                OR jsonb_array_length(i.line_items) = 0
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(i.line_items) li
                           WHERE COALESCE(NULLIF(btrim(li->>'hsn_code'), ''),
                                          NULLIF(btrim(li->>'sac_code'), '')) IS NULL))
                                                                 AS hsn_missing,
               COALESCE(i.total, 0)                              AS total
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_contacts c
               ON c.id = i.contact_id AND c.org_id = i.org_id
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.cancelled_at IS NULL
          AND COALESCE(i.doc_status, '') <> 'draft'
          AND COALESCE(i.payment_status, '') <> 'cancelled'
          AND i.invoice_type = ANY($4::text[])
          AND i.invoice_date >= $2 AND i.invoice_date < $3
        ORDER BY i.invoice_date, i.invoice_number
        LIMIT $5
        """,
        org_id, start, end, list(_FILEABLE), limit,
    )

    blocked = []
    for r in rows:
        defects = []
        if r["hsn_missing"]:
            defects.append("no HSN or SAC code on at least one line item")
        if not r["place_of_supply"]:
            defects.append("no place of supply")

        gstin = r["counterparty_gstin"]
        if gstin and not gstin_is_valid(gstin):
            # A GSTIN that is present and wrong is worse than one that is
            # absent: it looks filled in, so nobody checks it again.
            defects.append(f"counterparty GSTIN '{gstin}' fails its check digit")

        if defects:
            blocked.append({
                "invoice": r["invoice_number"],
                "date": r["invoice_date"].isoformat() if r["invoice_date"] else None,
                "type": r["invoice_type"],
                "counterparty": r["counterparty"] or "(no counterparty on record)",
                "total": float(r["total"] or 0),
                "defects": defects,
            })

    out = {
        "period": period,
        "examined": len(rows),
        "blocked": len(blocked),
        "invoices": blocked,
    }
    if len(rows) == limit:
        out["caveat"] = (
            f"Only the first {limit} invoices in the period were examined. There "
            f"may be more defects beyond them."
        )
    return out
