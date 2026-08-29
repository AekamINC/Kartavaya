"""
procurement_ops — the three purchase-order skills of proposal 77.

    check_late_suppliers          expected date passed, quantity outstanding
    check_received_not_invoiced   the period-end accrual, goods in and unbilled
    check_194q_approaching        a vendor nearing the Rs 50 lakh threshold

── THESE ARE NOT REGISTERED YET, AND THAT IS DELIBERATE ─────────────────────

A skill becomes reachable through TWO files this workstream does not own:
`services/skill_dispatcher.py` (the name → module.function map) and
`services/skills/modules.py` (the module code each skill needs). Both already
exist and both are being edited by other people this week, so the six lines are
REPORTED to the owner rather than written here. Nothing below is a stub: each
handler is complete, each is exercised by the same queries the procurement
router serves live, and registering them is the two-file edit and nothing else.

── THE DENOMINATOR RULE, INHERITED FROM `vendor_compliance` ─────────────────

Every handler reports what it COULD NOT check beside what it found, and never
lets the two collapse into one number. An org with no purchase orders is not an
org with no late suppliers — it is an org this check cannot speak about, and on
a module whose whole value is exception-finding, a false all-clear is the worst
output available.

That matters more here than almost anywhere, because on the day this ships
there are ZERO purchase orders in the live database (migration 197 creates the
tables empty and seeds nothing). Every one of these handlers therefore returns
`could_not_check` equal to its whole population until a firm raises its first
order, and says so in `limitations` rather than reporting a clean result.
"""
from datetime import date

from services.purchase_orders import (
    OPEN_STATUSES,
    TDS_194Q_BASIS,
    TDS_194Q_RATE,
    TDS_194Q_THRESHOLD,
    TDS_194Q_WARN_AT,
    resolve_194q,
    tds_194q_row,
)
from services.skills.reachable import reachable
from services.skills.timeutil import days_between


def _as_date(raw, fallback):
    if not raw:
        return fallback
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return fallback


def _f(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _fy_start(today: date) -> date:
    """The Indian financial year runs 1 April to 31 March."""
    return date(today.year if today.month >= 4 else today.year - 1, 4, 1)


# ══════════════════════════════════════════════════════════════════════════
# check_late_suppliers
# ══════════════════════════════════════════════════════════════════════════

async def check_late_suppliers(pool, org_id: str, as_at: str | None = None,
                               limit: int = 200) -> dict:
    """Orders whose expected date has passed with quantity still outstanding.

    Proposal 77 calls this out as fitting the skill shelf's shape exactly:
    vendor name, phone number, days late. The point of knowing a supplier is
    nine days late is being able to ring them, so the contact rides along
    through `reachable` — and the vendor id goes into the href and nowhere
    else, which is the rule that file exists to keep.

    ── AN UNDATED ORDER IS NOT A LATE ONE ──────────────────────────────────

    `expected_date` is nullable and a firm that never fills it in has not
    thereby made every order late. Undated orders are COUNTED, separately, so
    the reader can see how much of their book this check could not speak
    about — reporting them as late would train the firm to ignore the list,
    which costs more than the check is worth.
    """
    today = _as_date(as_at, date.today())
    cap = max(1, min(int(limit or 200), 500))

    facts = await pool.fetchrow(
        """
        SELECT count(*)                                          AS orders_total,
               count(*) FILTER (WHERE status = ANY($2::text[]))   AS orders_open,
               count(*) FILTER (WHERE status = ANY($2::text[])
                                  AND expected_date IS NULL)      AS open_undated
        FROM public.ganit_purchase_orders
        WHERE org_id = $1::uuid AND is_active
        """,
        org_id, list(OPEN_STATUSES),
    )

    rows = await pool.fetch(
        """
        SELECT po.id, po.po_number, po.expected_date, po.total, po.currency,
               v.id AS vendor_id, v.name AS vendor,
               NULLIF(btrim(v.email), '') AS vendor_email,
               NULLIF(btrim(v.phone), '') AS vendor_phone,
               COALESCE((SELECT SUM(l.qty_ordered) FROM public.ganit_po_lines l
                          WHERE l.po_id = po.id AND l.org_id = po.org_id
                            AND l.is_active), 0)                       AS qty_ordered,
               COALESCE((SELECT SUM(r.qty) FROM public.ganit_po_receipts r
                          WHERE r.po_id = po.id AND r.org_id = po.org_id), 0)
                                                                        AS qty_received
        FROM public.ganit_purchase_orders po
        JOIN public.ganit_vendors v ON v.id = po.vendor_id
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = ANY($2::text[])
          AND po.expected_date IS NOT NULL
          AND po.expected_date < $3::date
        ORDER BY po.expected_date
        LIMIT $4::int
        """,
        org_id, list(OPEN_STATUSES), today, cap,
    )

    late = []
    for r in rows:
        outstanding = _f(r["qty_ordered"]) - _f(r["qty_received"])
        if outstanding <= 0:
            # Every line arrived; the order simply has not been closed yet.
            # That is bookkeeping tidiness, not a late supplier.
            continue
        late.append(reachable(
            {
                "purchase_order": r["po_number"],
                "vendor": r["vendor"],
                "expected_on": r["expected_date"].isoformat(),
                # days_between(), not a hand-rolled subtraction: it normalises a
                # DATE, an aware datetime and a naive one to the same thing,
                # which is what stops the TypeError a psycopg/asyncpg type
                # change would otherwise introduce here silently.
                "days_late": days_between(today, r["expected_date"]),
                "qty_outstanding": round(outstanding, 3),
                "order_value": round(_f(r["total"]), 2),
                "currency": r["currency"],
            },
            kind="vendor", entity_id=r["vendor_id"],
            email=r["vendor_email"], phone=r["vendor_phone"],
        ))
    late.sort(key=lambda e: e["days_late"], reverse=True)

    orders_total = int(facts["orders_total"] or 0) if facts else 0
    orders_open = int(facts["orders_open"] or 0) if facts else 0
    undated = int(facts["open_undated"] or 0) if facts else 0

    limitations = []
    if orders_total == 0:
        limitations.append(
            "This organisation has no purchase orders, so nothing was checked. "
            "That is not the same as having no late suppliers — an order placed "
            "by email is invisible to this check.")
    if undated:
        limitations.append(
            f"{undated} open order(s) carry no expected date and could not be "
            f"tested. An undated order is not a late one.")
    limitations.append(
        "Lateness is measured against the order's own expected date, which is "
        "what the firm typed. It is not a contractual lead time.")

    return {
        "as_at": today.isoformat(),
        "verdict": "checked" if orders_open else "could_not_check",
        "counts": {
            "orders_total": orders_total,
            "orders_open": orders_open,
            "orders_late": len(late),
            "open_without_an_expected_date": undated,
            # The number that stops an empty module reading as a clean result.
            "could_not_check": undated if orders_open else orders_total,
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "late": late,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# check_received_not_invoiced
# ══════════════════════════════════════════════════════════════════════════

async def check_received_not_invoiced(pool, org_id: str, as_at: str | None = None,
                                      limit: int = 200) -> dict:
    """Goods received and not yet billed — the period-end accrual.

    Currently assembled by hand or not at all, which is exactly why a CA wants
    it: it is the entry nobody remembers until the audit asks for it.

    ── VALUED AT THE ORDERED RATE, AND THE ANSWER SAYS SO ──────────────────

    The only rate anyone has is the one on the order, because the bill that
    would carry the real one is precisely what has not arrived. That is stated
    in `basis` rather than left for the reader to assume, since an accrual is a
    number that goes into a set of accounts and its basis is part of it.

    ── HOW A BILL IS MATCHED TO A LINE, HONESTLY ───────────────────────────

    `ganit_vendor_bills.line_items` is jsonb and carries no `po_line_id`, so a
    bill line is matched to an order line by product where both name one and by
    description otherwise. That is right for the overwhelming majority and
    wrong for two lines naming the same product twice at different rates, which
    collapse into one. The limitation is returned, not hidden.
    """
    from services.purchase_orders import bill_qty_by_line   # local: see note below
    # Imported inside the function, not at module scope, purely so this module
    # stays importable by the dispatcher's registry scan without pulling the
    # router's dependency graph in behind it.

    today = _as_date(as_at, date.today())
    cap = max(1, min(int(limit or 200), 500))

    orders = await pool.fetch(
        """
        SELECT po.id, po.po_number, po.po_date, po.currency,
               v.id AS vendor_id, v.name AS vendor,
               NULLIF(btrim(v.email), '') AS vendor_email,
               NULLIF(btrim(v.phone), '') AS vendor_phone
        FROM public.ganit_purchase_orders po
        JOIN public.ganit_vendors v ON v.id = po.vendor_id
        WHERE po.org_id = $1::uuid AND po.is_active
          AND po.status = ANY($2::text[])
        ORDER BY po.po_date
        LIMIT $3::int
        """,
        org_id, list(OPEN_STATUSES), cap,
    )

    findings = []
    total_accrual = 0.0
    orders_with_receipts = 0

    for o in orders:
        lines = await pool.fetch(
            """
            SELECT l.id, l.line_no, l.product_id::text AS product_id,
                   l.description, l.unit, l.rate, l.qty_ordered,
                   COALESCE((SELECT SUM(r.qty) FROM public.ganit_po_receipts r
                              WHERE r.po_line_id = l.id AND r.org_id = l.org_id), 0)
                       AS qty_received
            FROM public.ganit_po_lines l
            WHERE l.po_id = $1::uuid AND l.org_id = $2::uuid AND l.is_active
            ORDER BY l.line_no
            """,
            str(o["id"]), org_id,
        )
        line_dicts = [dict(l) for l in lines]
        if not any(_f(l["qty_received"]) for l in line_dicts):
            continue
        orders_with_receipts += 1

        bills = await pool.fetch(
            "SELECT line_items FROM public.ganit_vendor_bills "
            "WHERE po_id = $1::uuid AND org_id = $2::uuid AND is_active",
            str(o["id"]), org_id,
        )
        billed: dict[int, float] = {}
        for b in bills:
            items = b["line_items"]
            if isinstance(items, str):
                import json as _json
                try:
                    items = _json.loads(items)
                except Exception:
                    items = []
            for no, qty in bill_qty_by_line(line_dicts, items or []).items():
                billed[no] = billed.get(no, 0.0) + qty

        accrual = 0.0
        for l in line_dicts:
            gap = _f(l["qty_received"]) - billed.get(int(l["line_no"] or 0), 0.0)
            if gap > 0:
                accrual += gap * _f(l["rate"])
        if accrual <= 0:
            continue
        total_accrual += accrual
        findings.append(reachable(
            {
                "purchase_order": o["po_number"],
                "vendor": o["vendor"],
                "ordered_on": o["po_date"].isoformat() if o["po_date"] else None,
                "accrual": round(accrual, 2),
                "currency": o["currency"],
            },
            kind="vendor", entity_id=o["vendor_id"],
            email=o["vendor_email"], phone=o["vendor_phone"],
        ))

    findings.sort(key=lambda e: e["accrual"], reverse=True)

    limitations = [
        "Valued at the ORDERED rate. The bill that would carry the agreed rate "
        "is exactly what has not arrived.",
        "A bill is matched to an order line by product where both name one, and "
        "by description otherwise — two lines naming the same product at "
        "different rates collapse into one.",
        "Only bills LINKED to a purchase order count as billing it. A bill "
        "entered without a link leaves its order looking unbilled.",
    ]
    if not orders:
        limitations.insert(0, (
            "This organisation has no open purchase orders, so no accrual could "
            "be computed. That is not the same as an accrual of nil."))

    return {
        "as_at": today.isoformat(),
        "verdict": "checked" if orders_with_receipts else "could_not_check",
        "counts": {
            "open_orders": len(orders),
            "orders_with_a_receipt": orders_with_receipts,
            "orders_with_an_accrual": len(findings),
            "could_not_check": len(orders) - orders_with_receipts,
            "capped_at": cap,
            "was_capped": len(orders) >= cap,
        },
        "accrual_total": round(total_accrual, 2),
        "basis": "ordered rate, goods received less quantities billed",
        "orders": findings,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# check_194q_approaching
# ══════════════════════════════════════════════════════════════════════════

async def check_194q_approaching(pool, org_id: str, fy_start: str | None = None,
                                 limit: int = 200) -> dict:
    """Vendors nearing the Rs 50 lakh Section 194Q threshold — AT PO TIME.

    194Q bites at payment OR CREDIT, whichever is earlier, and advances count.
    A purchase order is where a firm first sees it coming; by the time the bill
    arrives the decision has already been made. That timing is the whole reason
    this check lives beside purchase orders rather than beside bills.

    ── TWO BASES, AND GETTING THEM THE WRONG WAY ROUND IS A FILING ERROR ────

      · the Rs 10 crore TURNOVER test that decides whether the firm deducts at
        all EXCLUDES GST
      · the TDS itself is computed on the purchase value INCLUDING GST

    THIS PRODUCT DOES NOT HOLD THE FIRM'S TURNOVER, so nothing here asserts
    that the deduction applies. The verdict is `could_not_check` on the
    applicability question in every org, permanently, and the finding is a
    vendor position rather than a liability. `indicative_tds` is named
    "indicative" for that reason and is not a figure to file.
    """
    today = date.today()
    start = _as_date(fy_start, _fy_start(today))
    cap = max(1, min(int(limit or 200), 500))

    rows = await pool.fetch(
        """
        SELECT v.id, v.name, v.tds_section,
               NULLIF(btrim(v.email), '') AS vendor_email,
               NULLIF(btrim(v.phone), '') AS vendor_phone,
               COALESCE((SELECT SUM(b.total) FROM public.ganit_vendor_bills b
                          WHERE b.vendor_id = v.id AND b.org_id = v.org_id
                            AND b.is_active AND b.bill_date >= $2::date), 0)
                   AS purchased_ytd,
               COALESCE((SELECT SUM(po.total)
                           FROM public.ganit_purchase_orders po
                          WHERE po.vendor_id = v.id AND po.org_id = v.org_id
                            AND po.is_active
                            AND po.status = ANY($3::text[])), 0)
                   AS on_order
        FROM public.ganit_vendors v
        WHERE v.org_id = $1::uuid AND v.is_active
        ORDER BY v.name
        LIMIT $4::int
        """,
        org_id, start, list(OPEN_STATUSES), cap,
    )

    # The threshold and the rate, read from the dated calendar AS OF THE FIRST
    # DAY OF THE FINANCIAL YEAR this running total accumulates in — not today.
    # `resolve_194q` degrades to the module constants when no row is recorded,
    # so a missing row leaves this watch behaving exactly as it always has.
    law = await resolve_194q(pool, start)
    warn_at = law["threshold"] * TDS_194Q_WARN_AT
    approaching, crossed = [], []
    for r in rows:
        entry = tds_194q_row(r["name"], _f(r["purchased_ytd"]), _f(r["on_order"]),
                             threshold=law["threshold"], rate=law["rate"])
        if entry["projected"] < warn_at:
            continue
        # The two fields `services/skill_ack_wiring.py` files an acknowledgement
        # under, and neither could be derived from what `tds_194q_row` returns.
        #
        #   vendor_id  because the vendor NAME is not unique. Measured live
        #              2026-08-23: 80 active vendors and TWO groups sharing a
        #              name — the same blind spot `check_duplicate_vendor_bills`
        #              reports rather than papering over. Keyed on the name, one
        #              acknowledgement would silence a second vendor's 194Q
        #              position. `check_tds_thresholds` and
        #              `check_msme_payment_clock` next door already return
        #              `vendor_id` and `bill_id` the same way.
        #   financial_year_from  because 194Q is a per-year threshold and every
        #              vendor's running total starts again on 1 April. Without
        #              it an acknowledgement made in March would silence the
        #              vendor for the whole of the next year, in which they may
        #              cross the line again.
        entry["vendor_id"] = str(r["id"])
        entry["financial_year_from"] = start.isoformat()
        entry = reachable(entry, kind="vendor", entity_id=r["id"],
                          email=r["vendor_email"], phone=r["vendor_phone"])
        (crossed if entry["crossed"] else approaching).append(entry)

    approaching.sort(key=lambda e: e["projected"], reverse=True)
    crossed.sort(key=lambda e: e["projected"], reverse=True)

    return {
        "as_at": today.isoformat(),
        "financial_year_from": start.isoformat(),
        # Never "checked". Whether the section applies at all turns on the
        # firm's own turnover, which this product does not hold, so the honest
        # verdict on applicability is permanently that it could not be checked.
        "verdict": "could_not_check",
        "threshold": law["threshold"],
        "rate": law["rate"],
        "basis": TDS_194Q_BASIS,
        # Where the two figures above came from, and the date they were read as
        # of. A statutory figure printed with no date attached is the defect
        # `services/statute.py` exists to remove, and this handler prints two.
        "statute": law["source"],
        "statute_as_of": law["as_of"],
        "buyer_turnover_test": law["buyer_turnover_test"],
        "warn_from": round(warn_at, 2),
        "counts": {
            "vendors_total": len(rows),
            "vendors_past_the_threshold": len(crossed),
            "vendors_approaching": len(approaching),
            "could_not_check": len(rows),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "past_the_threshold": crossed,
        "approaching": approaching,
        "limitations": [
            "Whether this firm deducts under 194Q AT ALL depends on its own "
            "turnover exceeding Rs 10 crore in the preceding year EXCLUDING "
            "GST. This product does not hold that figure, so nothing here says "
            "the section applies.",
            "The threshold is per vendor per financial year and is measured on "
            "the purchase value INCLUDING GST. The turnover test above uses a "
            "different base; the two are not interchangeable.",
            "194Q bites at payment or credit, whichever is earlier, and "
            "advances count. Orders placed and not yet billed are included for "
            "that reason and are labelled `on_order` rather than purchased.",
            "Nothing has been deducted. `indicative_tds` is a projection.",
        ],
    }
