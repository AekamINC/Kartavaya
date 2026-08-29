"""
gst_year — the year-end and threshold skills: catalogue #18, #19, #20, #21, #22.

Five things a firm has to think about on a calendar rather than on a ledger:
what it amended after it filed, whether its LUT is about to lapse, the books
side of the annual return, the thresholds it is drifting towards, and what to
set aside for advance tax.

    check_amendments_before_filing   documents that now go through GSTR-1A
    brief_lut_expiry                 the RFD-11 that stops covering you 1 April
    brief_annual_return_books        the books column of GSTR-9, in form order
    check_thresholds_approaching     rolling turnover against what it changes
    brief_advance_tax_reserve        cash to reserve, and what it is not

── EVERY STATUTORY FACT COMES FROM services/statute.py ──────────────────────

Not one due date, form number, section or threshold below is a literal. They are
read from `staging.statute_calendar` as of a date, because a statutory fact is
never a constant — Form 24Q became 138 on 1 April 2026 and the 12% and 28% slabs
stopped existing on 22 September 2025. Migration 170 seeded the thirteen facts
these five need; if a key is missing the handler SAYS the catalogue records no
rule rather than printing one from memory. That last behaviour is the whole
point and it is tested.

The advance-tax rows deliberately have no Income-tax Act 2025 successor: the
renumbering is real and the new section numbers were not verified, so a lookup
as of a 2026-27 date returns nothing and `brief_advance_tax_reserve` reports the
gap. A stated gap beats a plausible wrong section in front of a CA.

── AGGREGATE TURNOVER IS PAN-LEVEL, AND THIS PRODUCT IS NOT ─────────────────

Three of these five compare a turnover figure to a statutory threshold, and
every one of those comparisons is wrong in the same direction. GST aggregate
turnover is computed across every registration on one PAN, including exempt and
export supplies and stock transfers. This product sees ONE organisation's
invoices. So every turnover figure here is a FLOOR: an org that looks near a
threshold is probably already over it, and an org that looks clear may not be.

That is on `limitations` in every one of the three, not only in this docstring —
a caveat a language model never sees is a caveat the reader never sees.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

  · 787 invoices across three orgs; 765 tax invoices and 22 credit notes.
    doc_status: final 530, viewed 154, draft 102, sent 1.
  · 44 invoices in one org carry a `created_at` more than 40 days after their
    `invoice_date` — real signal for #18.
  · `is_export` exists and `organisations.gst_filing_scheme` exists.
  · There is NO `taxable_value` column on `ganit_invoices` and no
    `ganit_credit_notes` table — credit notes are `invoice_type='credit_note'`
    rows in the same table. #20 is built on that and says so.
"""
import logging
from datetime import date, timedelta

from services.statute import obligation, obligation_for_fy, fy_bounds
from services.skills.timeutil import as_date, utc_now

log = logging.getLogger(__name__)

#: Warn when rolling turnover reaches this share of a threshold. 80% because a
#: firm needs a quarter's notice to change its filing scheme or wire up
#: e-invoicing, not a week's.
APPROACH_RATIO = 0.80

#: The month from which the LUT skill has anything useful to say. Catalogue #19
#: says "arms 1 February": earlier than that and the answer is "renew it in two
#: months", which nobody acts on and everybody learns to ignore.
LUT_ARMS_MONTH = 2


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and this output is handed to a reader that way."""
    return default if value is None else float(value)


def _fy_of(day: date) -> str:
    """The Indian financial year containing *day*, as '2026-27'.

    April to March. `fy_bounds` is the inverse and the two are tested against
    each other, because an off-by-one here silently reports the wrong year's
    turnover against this year's threshold.
    """
    start_year = day.year if day.month >= 4 else day.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def _return_period(day: date) -> str:
    """The GST period a firm is working on: the PREVIOUS month.

    GSTR-1 for August is filed in September, so somebody opening any of these in
    September wants August. Same rule as `timeutil.return_period`, restated on a
    date rather than a datetime because these handlers work in calendar terms.
    """
    first = day.replace(day=1)
    prev = first - timedelta(days=1)
    return f"{prev.year:04d}-{prev.month:02d}"


def _period_bounds(period: str) -> tuple[date, date]:
    """'2026-08' -> (2026-08-01, 2026-08-31)."""
    year, month = (int(x) for x in period.split("-"))
    start = date(year, month, 1)
    end = (date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)) - timedelta(days=1)
    return start, end


def _due_date_from(row: dict | None, period_end: date) -> date | None:
    """The statutory due date for a period, from a calendar row, or None.

    THE CALENDAR EXPRESSES A DUE DATE TWO DIFFERENT WAYS and reading only one of
    them silently produces a plausible wrong date — which it did: GSTR-9 for FY
    2025-26 came out as 31 March 2026, nine months early, because the offset
    branch ran and `due_month` was never looked at.

      `due_month_offset`  months AFTER the period end. This is how the MONTHLY
                          returns are held: GSTR-1 is due_day 11, offset 1, so
                          August's is 11 September.
      `due_month`         an absolute month, for an obligation whose date is
                          fixed in the calendar rather than relative to a
                          period: GSTR-9 is due_day 31, due_month 12.

    When `due_month` is absolute, the YEAR is the one in which that month next
    falls on or after the period end. For a financial year ending 31 March 2026
    a due_month of 12 resolves to December 2026 and of 11 to November 2026 —
    both correct, and both "following the year", which is what s.44 and s.16(4)
    actually say.

    Returns None — never a guess — when the catalogue carries no day at all,
    which is the case for every quarterly TDS statement and is why each caller
    has a "the catalogue records no due date" branch.
    """
    if not row or not row.get("due_day"):
        return None
    day = int(row["due_day"])
    offset = row.get("due_month_offset")
    due_month = row.get("due_month")

    if offset is not None:
        month = period_end.month + int(offset)
        year = period_end.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
    elif due_month is not None:
        month = int(due_month)
        year = period_end.year if month >= period_end.month else period_end.year + 1
    else:
        month, year = period_end.month, period_end.year
    # Clamp rather than raise: a due_day of 31 in a 30-day month is the
    # catalogue saying "the last day", not a data error.
    for candidate in range(day, 27, -1):
        try:
            return date(year, month, candidate)
        except ValueError:
            continue
    return date(year, month, day)


def _statute_note(row: dict | None, what: str) -> str:
    """One sentence naming the authority for a printed date or figure.

    Every number these skills print is attributable, or it is not printed. A
    figure with no provenance in front of a CA is a figure they have to go and
    check, which costs more than not showing it.
    """
    if not row:
        return f"The statute calendar records no {what}, so none is shown."
    bits = [b for b in (row.get("form_number"), row.get("section_ref")) if b]
    cite = " · ".join(bits) if bits else (row.get("statute") or "")
    return f"{row.get('title') or what}{f' ({cite})' if cite else ''}"


# ══════════════════════════════════════════════════════════════════════════
# 18 · check_amendments_before_filing
# ══════════════════════════════════════════════════════════════════════════

async def check_amendments_before_filing(
    pool, org_id: str, period: str | None = None, limit: int = 200,
) -> dict:
    """Documents created or edited after their GSTR-1 due date had passed.

    Those documents did not make the return they belong to, so they go through
    GSTR-1A rather than being quietly included next month.

    *period* is 'YYYY-MM' and defaults to the period being filed — the PREVIOUS
    month — because August's GSTR-1 is filed in September. It has to default or
    the dispatcher refuses every scheduled run.

    ── THE INFERENCE, PRINTED ────────────────────────────────────────────────

    NOTHING IN THIS PRODUCT RECORDS THAT A PERIOD WAS FILED. There is no
    `filed_at`, no return log, no acknowledgement number. So "the return has
    gone" is INFERRED from the statutory due date having passed, and that
    inference is stated on the output rather than assumed by it. A firm that
    filed early sees documents listed that it did include; a firm that filed
    late sees documents it could still have caught.

    One small `gst_filings(org_id, period, filed_at, arn)` table upgrades this
    from an inference to a fact and unblocks two rejected candidates with it.
    That is named here because it is the single highest-value migration for the
    GST half of this catalogue.
    """
    today = utc_now().date()
    period = period or _return_period(today)
    start, end = _period_bounds(period)
    cap = max(1, int(limit))

    gstr1 = await obligation(pool, "gst.return.gstr1", as_of=end)
    due = _due_date_from(gstr1, end)

    rows = await pool.fetch(
        """
        SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date,
               i.total, i.doc_status, i.created_at, i.updated_at,
               COALESCE(NULLIF(btrim(cl.name), ''),
                        NULLIF(btrim(ct.company), ''),
                        NULLIF(btrim(ct.name), ''),
                        '(customer not recorded)') AS customer
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_clients cl
               ON cl.id = i.client_id AND cl.org_id = i.org_id
        LEFT JOIN public.graha_contacts ct
               ON ct.id = i.contact_id AND ct.org_id = i.org_id
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.invoice_date >= $2::date
          AND i.invoice_date <= $3::date
        ORDER BY i.invoice_date, i.invoice_number
        LIMIT $4::int
        """,
        org_id, start, end, cap,
    )

    late_created, late_edited = [], []
    if due is not None:
        for r in rows:
            created = as_date(r["created_at"])
            updated = as_date(r["updated_at"])
            entry = {
                "invoice_id": str(r["id"]),
                "document": r["invoice_number"],
                "kind": r["invoice_type"],
                "customer": r["customer"],
                "invoice_date": as_date(r["invoice_date"]),
                "amount": _f(r["total"]),
                "doc_status": r["doc_status"],
                "created_on": created,
                "last_edited": updated,
            }
            if created and created > due:
                late_created.append({**entry, "why": "created after the due date"})
            elif updated and updated > due and created and created <= due:
                late_edited.append({**entry, "why": "edited after the due date"})

    limitations = [
        "NOTHING RECORDS THAT A PERIOD WAS FILED. There is no filed_at, no ARN "
        "and no return log anywhere in this product, so 'the return has gone' "
        "is inferred from the statutory due date having passed. A firm that "
        "filed early will see documents here that it did include.",
        "Only the org's own invoices are read. A document raised outside this "
        "product and filed from elsewhere is invisible to this check.",
    ]
    if due is None:
        limitations.insert(0,
            "The statute calendar records no due day for GSTR-1 as of "
            f"{end}, so no cutoff could be computed and NOTHING was classified. "
            "This is a gap in the calendar, not a clean period.")

    return {
        "as_at": today,
        "period": period,
        "period_from": start,
        "period_to": end,
        "gstr1_due_on": due,
        "due_date_is_inferred_cutoff": True,
        "statute": _statute_note(gstr1, "GSTR-1 due date"),
        "amendment_route": "GSTR-1A" if due else None,
        "counts": {
            "documents_in_period": len(rows),
            "created_after_the_due_date": len(late_created),
            "edited_after_the_due_date": len(late_edited),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "created_after_the_due_date": late_created,
        "edited_after_the_due_date": late_edited,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 19 · brief_lut_expiry
# ══════════════════════════════════════════════════════════════════════════

async def brief_lut_expiry(
    pool, org_id: str, as_at: str | None = None, limit: int = 200,
) -> dict:
    """From February: if you exported this year, the RFD-11 lapses on 1 April.

    An LUT is furnished FOR a financial year and does not carry across, so cover
    stops on 1 April whatever the outgoing one said.

    ── IT CANNOT SAY YOU ARE COVERED ─────────────────────────────────────────

    Nothing in this product records that an LUT was filed. So this says "you
    export, and it expires" and never "you are covered until X" — and it never
    says "you have no LUT", which would be an accusation built on an absence.

    ── AND IT HAS NO DONE-STATE ──────────────────────────────────────────────

    Catalogue #19 names this itself: with no record of the filing, a schedule
    would nag daily from 1 February about a thing already done. So the output
    carries `no_done_state: True` and the reason, and the recommended cadence is
    monthly rather than daily. That is the general defect in this whole tier and
    the honest fix is the same `gst_filings` table #18 asks for.
    """
    today = as_date(as_at) or utc_now().date()
    fy = _fy_of(today)
    fy_start, fy_end = fy_bounds(fy)
    cap = max(1, int(limit))

    lut = await obligation(pool, "gst.lut.rfd11", as_of=today)

    exports = await pool.fetch(
        """
        SELECT i.id, i.invoice_number, i.invoice_date, i.total, i.currency
        FROM public.ganit_invoices i
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND COALESCE(i.is_export, FALSE)
          AND i.invoice_date >= $2::date
          AND i.invoice_date <= $3::date
        ORDER BY i.invoice_date DESC
        LIMIT $4::int
        """,
        org_id, fy_start, fy_end, cap,
    )

    # The outgoing LUT covers the year that is ending; the new one is needed
    # from the first day of the next.
    expires_on = date(fy_end.year, 3, 31) if lut else None
    renew_before = date(fy_end.year, 4, 1) if lut else None
    armed = today.month >= LUT_ARMS_MONTH and today.month <= 3

    limitations = [
        "Nothing in this product records that an LUT was filed, so this can say "
        "that you export and that cover lapses — never that you are covered "
        "until a date, and never that you have no LUT.",
        "It has no done-state for the same reason: filing the new RFD-11 does "
        "not silence it. Run it monthly, not daily.",
        "Export status is read from `is_export` on the invoice. A zero-rated "
        "supply to an SEZ that was not flagged is not counted here.",
    ]
    if not lut:
        limitations.insert(0,
            "The statute calendar records no LUT obligation as of "
            f"{today}, so no expiry date is shown.")

    return {
        "as_at": today,
        "financial_year": fy,
        "applies_now": armed,
        "why_not_yet": None if armed else (
            f"This arms in February. It is {today:%B}, and a renewal notice "
            f"two months early is one nobody acts on."),
        "form": (lut or {}).get("form_number"),
        "statute": _statute_note(lut, "LUT rule"),
        "cover_expires_on": expires_on,
        "fresh_lut_needed_before": renew_before,
        "no_done_state": True,
        "counts": {
            "export_invoices_this_year": len(exports),
            "export_value_this_year": round(sum(_f(r["total"]) for r in exports), 2),
            "capped_at": cap,
            "was_capped": len(exports) >= cap,
        },
        "export_invoices": [
            {
                "invoice_id": str(r["id"]),
                "document": r["invoice_number"],
                "invoice_date": as_date(r["invoice_date"]),
                "amount": _f(r["total"]),
                "currency": r["currency"],
            }
            for r in exports
        ],
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 20 · brief_annual_return_books
# ══════════════════════════════════════════════════════════════════════════

async def brief_annual_return_books(
    pool, org_id: str, financial_year: str | None = None, limit: int = 200,
) -> dict:
    """The BOOKS column of GSTR-9, in the form's own order, plus applicability.

    *financial_year* is '2025-26' and defaults to the most recently ENDED year —
    the one with a live deadline. GSTR-9 for a year is due on 31 December
    following it, so from April onwards the year a preparer means is the one
    that just closed.

    ── IT IS THE BOOKS COLUMN, NOT A RECONCILIATION ──────────────────────────

    Catalogue #20 is explicit and it is right: "books against the twelve
    GSTR-1s" is tautological in this product. Both figures would come from the
    same builder over the same rows, so a reconciliation between them can only
    ever return zero and would teach a preparer to trust a check that checks
    nothing. This returns ONE column — what the books say — and names the other
    column as the preparer's to fill from the portal.
    """
    today = utc_now().date()
    if not financial_year:
        this_fy = _fy_of(today)
        start_year = int(this_fy.split("-")[0])
        financial_year = f"{start_year - 1}-{str(start_year)[-2:]}"
    fy_start, fy_end = fy_bounds(financial_year)
    cap = max(1, int(limit))

    gstr9 = await obligation_for_fy(pool, "gst.return.gstr9", financial_year)
    gstr9c = await obligation_for_fy(pool, "gst.return.gstr9c", financial_year)

    totals = await pool.fetchrow(
        """
        SELECT
          count(*) FILTER (WHERE invoice_type = 'tax_invoice')                AS n_invoices,
          COALESCE(SUM(total) FILTER (WHERE invoice_type = 'tax_invoice'), 0) AS invoice_value,
          count(*) FILTER (WHERE invoice_type = 'credit_note')                AS n_credit_notes,
          COALESCE(SUM(total) FILTER (WHERE invoice_type = 'credit_note'), 0) AS credit_note_value,
          count(*) FILTER (WHERE invoice_type = 'tax_invoice'
                             AND COALESCE(is_export, FALSE))                  AS n_exports,
          COALESCE(SUM(total) FILTER (WHERE invoice_type = 'tax_invoice'
                             AND COALESCE(is_export, FALSE)), 0)              AS export_value,
          count(*) FILTER (WHERE doc_status = 'draft')                        AS n_draft
        FROM public.ganit_invoices
        WHERE org_id = $1::uuid
          AND is_active
          AND invoice_date >= $2::date
          AND invoice_date <= $3::date
        """,
        org_id, fy_start, fy_end,
    )

    gross = _f(totals["invoice_value"])
    credits = _f(totals["credit_note_value"])
    net = round(gross - credits, 2)

    thr9 = _f((gstr9 or {}).get("threshold_amount")) or None
    thr9c = _f((gstr9c or {}).get("threshold_amount")) or None

    # ONE row per figure, in the order GSTR-9 asks for them, so a preparer can
    # read down the form and down this list together.
    books = [
        {"table": "4/5", "line": "Outward supplies — invoices raised",
         "count": totals["n_invoices"], "value": gross},
        {"table": "4I/4J", "line": "Credit notes issued",
         "count": totals["n_credit_notes"], "value": credits},
        {"table": "5",     "line": "Of which zero-rated / export",
         "count": totals["n_exports"], "value": _f(totals["export_value"])},
        {"table": "—",     "line": "Net of credit notes",
         "count": None, "value": net},
    ]

    applicability = []
    if thr9 is not None:
        below = net <= thr9
        applicability.append({
            # The form number comes from the calendar row or it is not printed.
            # `or "GSTR-9"` was here and it is exactly the defect this module
            # is built to avoid: a hardcoded form number that survives the day
            # the form is renumbered, which is not hypothetical — 24Q became
            # 138 on 1 April 2026.
            "return": (gstr9 or {}).get("form_number"),
            "threshold": thr9,
            "books_figure": net,
            "verdict": ("optional on this figure — but see the PAN-level caveat"
                        if below else "required on this figure"),
            "due_on": _due_date_from(gstr9, fy_end),
            "statute": _statute_note(gstr9, "annual return"),
        })
    if thr9c is not None:
        applicability.append({
            "return": (gstr9c or {}).get("form_number"),
            "threshold": thr9c,
            "books_figure": net,
            "verdict": ("not required on this figure" if net <= thr9c
                        else "required on this figure"),
            "due_on": _due_date_from(gstr9c, fy_end),
            "statute": _statute_note(gstr9c, "reconciliation statement"),
        })

    limitations = [
        "THIS IS THE BOOKS COLUMN ONLY. The portal column is the preparer's to "
        "fill: comparing these figures to the twelve GSTR-1s this product built "
        "from the same rows would return zero by construction and would teach "
        "you to trust a check that checks nothing.",
        "AGGREGATE TURNOVER IS PAN-LEVEL across every registration, and includes "
        "exempt supplies and stock transfers. This figure is one organisation's "
        "invoices, so it is a FLOOR — an applicability verdict of 'optional' "
        "here can still be 'required' on the real aggregate.",
        "There is no taxable_value column on an invoice, so the values above are "
        "document totals INCLUDING tax, not taxable value. GSTR-9 asks for "
        "taxable value and tax separately; this cannot split them.",
    ]
    if totals["n_draft"]:
        limitations.append(
            f"{totals['n_draft']} document(s) in the year are still in draft and "
            f"ARE included in these totals. Whether a draft belongs in the annual "
            f"return is a decision, not a fact, so nothing is dropped silently.")
    if not gstr9 and not gstr9c:
        limitations.insert(0,
            "The statute calendar records no annual-return obligation for "
            f"{financial_year}, so no applicability test was run.")

    return {
        "as_at": today,
        "financial_year": financial_year,
        "year_from": fy_start,
        "year_to": fy_end,
        "books": books,
        "applicability": applicability,
        "counts": {
            "documents_read": (totals["n_invoices"] or 0) + (totals["n_credit_notes"] or 0),
            "drafts_included": totals["n_draft"],
            "capped_at": cap,
        },
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 21 · check_thresholds_approaching
# ══════════════════════════════════════════════════════════════════════════

#: The thresholds worth watching, and what CROSSING each one changes. Keys are
#: statute_calendar keys — nothing here carries a rupee figure of its own.
_WATCHED = (
    ("gst.registration.threshold.services", "you must register for GST"),
    ("gst.registration.threshold.goods",
     "you must register for GST (exclusive supply of goods)"),
    ("gst.composition.threshold",
     "you become ineligible for the composition levy"),
    ("gst.qrmp.threshold",
     "you lose the quarterly option and move to monthly returns — which changes "
     "every GSTR-1 due date this product prints for you"),
    ("gst.einvoice.threshold",
     "e-invoicing becomes compulsory for your B2B and export documents"),
)


async def check_thresholds_approaching(
    pool, org_id: str, approach_ratio: float = APPROACH_RATIO, limit: int = 200,
) -> dict:
    """Rolling twelve-month turnover against the thresholds that change duties.

    ── THE LIMITATION IS THE FEATURE, AND #21 SAYS SO ────────────────────────

    "Print the limitation or this actively misleads." GST aggregate turnover is
    PAN-level across every registration and includes exempt supplies, exports
    and stock transfers. This product sees one org's invoices. The figure is
    therefore a FLOOR and an org that looks near a threshold is probably already
    over it — which is the opposite of the reassuring reading somebody takes
    from a bar that is 70% full.

    ── AND SO IS THE FIRING RULE ─────────────────────────────────────────────

    #21 also notes a business crosses a threshold once in its life, "so this
    fires never, or it fires wrong". So this reports a STATE, not an event: it
    says where you are against each line and never claims to have detected a
    crossing. A skill that announces "you have crossed" needs a record of having
    said so, and there is none.
    """
    today = utc_now().date()
    window_start = today - timedelta(days=365)
    ratio = min(1.0, max(0.1, float(approach_ratio)))

    row = await pool.fetchrow(
        """
        SELECT
          COALESCE(SUM(total) FILTER (WHERE invoice_type = 'tax_invoice'), 0)  AS gross,
          COALESCE(SUM(total) FILTER (WHERE invoice_type = 'credit_note'), 0)  AS credits,
          count(*) FILTER (WHERE invoice_type = 'tax_invoice')                 AS n,
          min(invoice_date) AS first_seen
        FROM public.ganit_invoices
        WHERE org_id = $1::uuid
          AND is_active
          AND invoice_date > $2::date
        """,
        org_id, window_start,
    )
    turnover = round(_f(row["gross"]) - _f(row["credits"]), 2)

    lines = []
    for key, consequence in _WATCHED:
        fact = await obligation(pool, key, as_of=today)
        if not fact or fact.get("threshold_amount") is None:
            lines.append({
                "key": key,
                "threshold": None,
                "state": "no rule recorded",
                "note": f"The statute calendar records no threshold for {key} "
                        f"as of {today}, so nothing is compared.",
            })
            continue
        limit_rs = _f(fact["threshold_amount"])
        share = (turnover / limit_rs) if limit_rs else 0.0
        if share >= 1.0:
            state = "already over on this figure"
        elif share >= ratio:
            state = "approaching"
        else:
            state = "clear on this figure"
        lines.append({
            "key": key,
            "title": fact.get("title"),
            "threshold": limit_rs,
            "rolling_turnover": turnover,
            "share_of_threshold": round(share, 3),
            "state": state,
            "what_changes": consequence,
            "statute": _statute_note(fact, "threshold"),
        })

    return {
        "as_at": today,
        "window_from": window_start,
        "rolling_twelve_month_turnover": turnover,
        "is_a_floor_not_the_aggregate": True,
        "counts": {
            "documents_in_window": row["n"],
            "thresholds_compared": sum(1 for l in lines if l.get("threshold")),
            "approaching_or_over": sum(
                1 for l in lines if l.get("state") in
                ("approaching", "already over on this figure")),
            "first_document_seen": as_date(row["first_seen"]),
        },
        "thresholds": lines,
        "limitations": [
            "THIS FIGURE IS A FLOOR, NOT YOUR AGGREGATE TURNOVER. GST aggregate "
            "turnover is PAN-level across every registration and includes exempt "
            "supplies, exports and stock transfers. This is one organisation's "
            "invoices in this product, so if it looks close to a line you are "
            "probably already past it.",
            "It reports a STATE, not a crossing. Nothing records that you were "
            "told before, so this cannot say 'you have just crossed' — it can "
            "only say where you stand today.",
            "Special-category states have lower registration and composition "
            "thresholds and those are NOT carried in the calendar. The figures "
            "compared here are the normal-category ones.",
            "Turnover is measured over a rolling 365 days. Several of these "
            "thresholds are tested on a FINANCIAL YEAR or on any year since "
            "2017-18, which is a different question — treat this as a warning "
            "light, not as the applicability test.",
        ],
    }


# ══════════════════════════════════════════════════════════════════════════
# 22 · brief_advance_tax_reserve
# ══════════════════════════════════════════════════════════════════════════

_INSTALMENTS = (
    "incometax.advance_tax.q1",
    "incometax.advance_tax.q2",
    "incometax.advance_tax.q3",
    "incometax.advance_tax.q4",
)


async def brief_advance_tax_reserve(
    pool, org_id: str, financial_year: str | None = None, limit: int = 200,
) -> dict:
    """Receipts less expenses to date, the cumulative instalment due, the cash.

    ── THIS IS NOT TAX ADVICE AND IT LEADS WITH THAT ─────────────────────────

    Catalogue #22 is blunt: "The risk is not technical — a number this rough
    will be read as tax advice. Ship only if it leads with what it is not."

    So `what_this_is_not` is the FIRST key of the output and not a footnote. The
    surplus below is receipts minus expenses recorded in this product. It is not
    profit, it is not taxable income, and no tax is computed from it: there is no
    depreciation, no disallowance, no add-back, no other head of income, no
    set-off of losses, and no regime choice. The reserve shown is a share of a
    SURPLUS, never a share of a liability, because the liability is not knowable
    from here.

    ── AND IT MAY NOT HAVE FOUR DATES ────────────────────────────────────────

    An assessee under the presumptive scheme pays the whole amount by 15 March
    in ONE instalment. Nothing in this product records which scheme an org is
    on, so both are presented and the reader picks — rather than the skill
    quietly showing three deadlines that do not exist for them.
    """
    today = utc_now().date()
    financial_year = financial_year or _fy_of(today)
    fy_start, fy_end = fy_bounds(financial_year)
    upto = min(today, fy_end)

    receipts = await pool.fetchval(
        """
        SELECT COALESCE(SUM(p.amount), 0)
        FROM public.ganit_payments p
        WHERE p.org_id = $1::uuid
          AND p.payment_date >= $2::date
          AND p.payment_date <= $3::date
        """,
        org_id, fy_start, upto,
    )
    spend = await pool.fetchval(
        """
        SELECT COALESCE(SUM(COALESCE(e.total, e.amount)), 0)
        FROM public.ganit_expenses e
        WHERE e.org_id = $1::uuid
          AND e.is_active
          AND e.expense_date >= $2::date
          AND e.expense_date <= $3::date
        """,
        org_id, fy_start, upto,
    )
    surplus = round(_f(receipts) - _f(spend), 2)

    schedule, missing = [], []
    for key in _INSTALMENTS:
        fact = await obligation(pool, key, as_of=upto)
        if not fact:
            missing.append(key)
            continue
        due_month, due_day = fact.get("due_month"), fact.get("due_day")
        if not (due_month and due_day):
            continue
        year = fy_start.year if int(due_month) >= 4 else fy_start.year + 1
        due_on = date(year, int(due_month), int(due_day))
        pct = _f(fact.get("rate_percent"))
        schedule.append({
            "instalment": fact.get("title"),
            "due_on": due_on,
            "cumulative_percent": pct,
            "passed": due_on < today,
            # A SHARE OF THE SURPLUS. Never called tax, never called a liability.
            "share_of_surplus_to_date": round(max(0.0, surplus) * pct / 100.0, 2),
            "statute": _statute_note(fact, "advance tax instalment"),
        })

    presumptive = await obligation(pool, "incometax.advance_tax.presumptive", as_of=upto)

    limitations = [
        "Receipts are payments RECORDED IN THIS PRODUCT against invoices. Money "
        "received outside it, and any other head of income, is not here.",
        "Expenses are what has been entered. There is no depreciation, no "
        "disallowance, no add-back and no set-off of brought-forward losses.",
        "No regime is assumed and none is applied. Nothing here chooses between "
        "the old and new regimes or applies a slab, a surcharge or cess.",
    ]
    if missing:
        limitations.insert(0,
            "The statute calendar records no advance-tax rule in force on "
            f"{upto} for: {', '.join(missing)}. The Income-tax Act 2025 "
            "renumbered these sections on 1 April 2026 and the new numbers were "
            "not verified, so the calendar deliberately carries no successor "
            "row. NO SCHEDULE IS SHOWN for those instalments rather than a "
            "guessed one.")
    if presumptive:
        limitations.append(
            "If this business is under the presumptive scheme the whole amount "
            "is payable by 15 March in ONE instalment and three of the dates "
            "above do not apply to you. Nothing in this product records which "
            "scheme you are on.")

    return {
        # FIRST key, deliberately. See the docstring.
        "what_this_is_not": (
            "This is NOT tax advice and NOT a computation of tax. It is receipts "
            "less expenses recorded in this product, and a percentage of that "
            "surplus set beside the statutory instalment dates. It is not "
            "profit, not taxable income, and no liability is computed."
        ),
        "as_at": today,
        "financial_year": financial_year,
        "measured_to": upto,
        "receipts_to_date": _f(receipts),
        "expenses_to_date": _f(spend),
        "surplus_to_date": surplus,
        "schedule": schedule,
        "presumptive_alternative": (
            {
                "due_on": date(fy_start.year + 1, 3, 15),
                "cumulative_percent": _f(presumptive.get("rate_percent")),
                "statute": _statute_note(presumptive, "presumptive instalment"),
            } if presumptive else None
        ),
        "counts": {
            "instalments_with_a_recorded_rule": len(schedule),
            "instalments_with_no_recorded_rule": len(missing),
            "capped_at": int(limit),
        },
        "limitations": limitations,
    }
