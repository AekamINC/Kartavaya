"""
gst_cliffs — the three GST deadlines that arrive as a cliff rather than a slope,
and the one that is not a deadline at all.

Three handlers, one module, because all three are read off the same two tables
(`staging.ganit_vendor_bills` and `staging.ganit_invoices`) against the same
dated statute catalogue, and splitting them would mean three copies of the
rate-resolution helper below.

  brief_ims_expectations       what the IMS dashboard should show for a period,
                               computed from your own books, before you open it.
  brief_itc_at_risk_of_lapse   last year's input tax credit measured against the
                               s.16(4) bar.
  check_dead_gst_slabs         records still carrying a rate the Council
                               abolished. NOT a monthly skill — see its docstring.

── Nothing here files, computes a return box, or writes ──────────────────────

Every one of these produces a working paper. None of them reconciles against the
portal, because none of them can: there is no GSTN integration in this product
and there is not going to be one in this change. A skill that says "matched" when
it has only ever seen one side of the match is the single most damaging thing a
compliance report can do, so the word is never used.

None of them sets an image either. A statutory brief must never carry a generated
picture — the templates that schedule these must leave `generate_image` off.

── Where the law comes from ─────────────────────────────────────────────────

`services/statute.py` over `staging.statute_calendar`, always, and asked AS OF A
DATE. Not one due day, form number, section reference or rate is written into
this file. That matters most in `check_dead_gst_slabs`: the 12% and 28% slabs
died on 22 September 2025, so an invoice dated May 2025 at 12% is correct
history and an invoice dated May 2026 at 12% is a defect — and the ONLY thing
that can tell those two apart is a lookup anchored to the document's own date. A
hardcoded list of live slabs gets that backwards for every historic document in
the org.

── Verified read-only against the live database, 2026-08-20 ────────────────

Against the seeded org (64e7bea6…, ~5,600 rows):

  brief_ims_expectations, period 2026-07 — 9 bills, 19,883.52 of tax, every one
    of them from a vendor carrying a GSTIN. The month after it is the
    interesting one: 2026-08 has 22 bills of which 16 are from vendors whose
    `gstin` is blank (the vendor row exists; the field is empty).
  brief_itc_at_risk_of_lapse, FY 2025-26 — 108 bills across 40 vendors,
    913,343.04 of tax, none reverse-charge, none with nil tax, all INR.
  check_dead_gst_slabs — 12 products still on 12% (of 81 in that org; 14 of 106
    across the whole database), ZERO invoice lines and ZERO vendor-bill lines on
    a dead slab, and 207 invoice lines whose rate disagrees with the product
    master — of which 205 are the line at 18% against a master still on the
    abolished 12%. In other words the lines are right and the master is wrong,
    which is exactly why this handler never phrases a mismatch as "the invoice
    is wrong". See `_MASTER_IS_THE_STALE_SIDE`.
"""
import logging
from decimal import Decimal
from datetime import date

from services.statute import StatuteError, fy_bounds, obligation, obligations
from services.skills.reachable import reachable
from services.skills.timeutil import days_between, return_period, utc_now

log = logging.getLogger(__name__)

#: The tax heads a document carries. `cess` arrived with the documents migration
#: alongside `is_reverse_charge`; leaving it out understates every bill carrying
#: compensation cess, which is precisely the sin-goods population the 40% slab
#: was created for.
TAX_HEADS = ("cgst", "sgst", "igst", "cess")

#: The catalogue prefix every GST rate lives under. One string, used by both the
#: live-set read and the as-at-a-date read, so the two cannot drift.
_RATE_PREFIX = "gst.rate."

#: The s.16(4) entry. Its own `notes` column on the live row says the outer limit
#: is only half the rule; `brief_itc_at_risk_of_lapse` reproduces the other half
#: on the face of its output rather than trusting a reader to open the table.
_ITC_BAR_KEY = "gst.itc.time_limit"

#: Said on the output of `check_dead_gst_slabs`, verbatim, whenever a mismatch is
#: found where the PRODUCT MASTER is the side carrying the abolished rate. On the
#: seeded org that is 205 of the 207 mismatches, and the naive phrasing — "this
#: invoice line disagrees with the master" — would send a preparer to re-issue
#: two hundred correct invoices at a rate that no longer exists in law.
_MASTER_IS_THE_STALE_SIDE = (
    "The PRODUCT MASTER is the side carrying a rate that no longer exists. The "
    "invoice line is the one that is right. Fix the master; do not touch the "
    "invoice."
)


# ── shared helpers ───────────────────────────────────────────────────────────

def _period_bounds(period: str) -> tuple[date, date]:
    """'YYYY-MM' -> [first day, first day of next month).

    Half-open, matching `gst_readiness._period_bounds`, so a bill dated the last
    of the month lands in that month and one dated the first of the next does
    not. The month is range-checked HERE rather than left to `date()` to raise,
    because `date(y, 0 + 1, 1)` is a perfectly valid 1 January: '2026-00' would
    otherwise sail through and be answered with January's bills under a period
    string that does not exist. Month 13 and up already raise; only the zero
    slipped, and a zero is exactly what an off-by-one month index produces.
    """
    year, month = (int(p) for p in period.split("-", 1))
    if not 1 <= month <= 12:
        raise ValueError(period)
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _last_ended_financial_year(today: date) -> str:
    """The most recent Indian FY that has actually finished, as '2025-26'.

    The default for `brief_itc_at_risk_of_lapse`, and it must be the ENDED year,
    not the running one: s.16(4) bars credit for a financial year on 30 November
    FOLLOWING that year, so the year with a live deadline in August 2026 is
    2025-26, whose bar falls on 30 November 2026. Defaulting to the running year
    would report a deadline fifteen months out and read as "nothing to do".
    """
    current_start = today.year if today.month >= 4 else today.year - 1
    start = current_start - 1
    return f"{start}-{(start + 1) % 100:02d}"


def _money(value) -> float:
    """asyncpg Decimal (or None) -> a JSON-safe float, rounded to paise."""
    return round(float(value or 0), 2)


def _gstin(value) -> str | None:
    """A GSTIN that is blank or whitespace is no GSTIN.

    The SQL already does this with `NULLIF(btrim(v.gstin), '')`, and doing it
    again here is not redundancy — it is the only version a unit test can reach.
    The suite runs against a fake pool (tests/conftest.py), so a mock pool hides
    bad SQL: if the trimming lived only in the query, the ONE thing that decides
    which half of `brief_ims_expectations` a bill lands in would be asserted by
    nothing at all. A vendor whose `gstin` is three spaces is unregistered as far
    as IMS is concerned, and a row that emitted "   " as a GSTIN would put the
    bill in the wrong list and print whitespace where an identifier should be.
    """
    text = (value or "").strip()
    return text or None


class _LiveRates:
    """The GST rates in force on a given day, memoised by day.

    Two reasons this is a class and not one `await` at the top of the handler:

      * `check_dead_gst_slabs` must ask the question once per DOCUMENT DATE, not
        once per run. A 12% line dated May 2025 was correct when it was issued
        and is not a defect; the identical line dated May 2026 is. Only a
        per-document-date lookup separates them, and getting that wrong turns a
        clean org's report into a list of every historic invoice it ever raised.
      * Asked naively that is one round-trip per line. Memoising on the date
        collapses it to one per DISTINCT date — across the whole live database
        the dead-slab lines fall on five distinct dates — and the row cap bounds
        it even in the pathological case.

    `obligations()` resolves one row per obligation_key as of the date given, so
    a rate whose `effective_to` has passed simply does not come back. That
    absence IS the abolition; nothing here has to know which rates died or when.
    """

    def __init__(self, pool):
        self._pool = pool
        self._by_day: dict[date, dict[float, dict]] = {}

    async def on(self, day: date) -> dict[float, dict]:
        """rate_percent -> the catalogue row, for every slab live on *day*."""
        if day not in self._by_day:
            rows = await obligations(self._pool, as_of=day, key_prefix=_RATE_PREFIX)
            self._by_day[day] = {
                # float, not Decimal: the rates coming off `line_items` are JSON
                # numbers cast in SQL and arrive as Decimal, but the ones going
                # into a Python `in` test come from `round(float(...), 3)`.
                # Normalising BOTH sides through the same call, once, is the only
                # way a 12 and a Decimal('12.00') compare equal — a mixed-type
                # membership test here fails silently and reports every rate in
                # the org as abolished.
                round(float(r["rate_percent"]), 3): r
                for r in rows
                if r["rate_percent"] is not None
            }
        return self._by_day[day]

    async def is_live_on(self, rate: float, day: date) -> bool:
        return round(float(rate), 3) in await self.on(day)

    def known_row(self, rate: float) -> dict | None:
        """A catalogue row for *rate* from any day already looked up, or None.

        Used only to name the date a rate was abolished. It fetches nothing: if
        no day this run asked about had the rate alive, the report simply does
        not state an abolition date rather than inventing one or paying for an
        extra round-trip to discover it.
        """
        key = round(float(rate), 3)
        for slabs in self._by_day.values():
            if key in slabs:
                return slabs[key]
        return None


# ── 1 · what the IMS dashboard should show ───────────────────────────────────

async def brief_ims_expectations(
    pool, org_id: str, period: str | None = None, limit: int = 200
) -> dict:
    """Every vendor bill in *period*, by tax value, split on whether the vendor
    has a GSTIN — what to expect on the IMS dashboard before opening it.

    *period* is 'YYYY-MM' and defaults to the period a firm is actually working
    on, which is the PREVIOUS month: GSTR-3B for August is due on 20 September,
    so a person opening this in September wants August. It must have a default
    or the dispatcher refuses every scheduled run outright
    (`tests/test_a_skill_can_run_unattended.py` pins that).

    ── This needs no IMS integration, and that is the design ─────────────────

    The Invoice Management System shows what your SUPPLIERS filed about you. This
    shows what YOUR BOOKS say about the same month. Telling somebody what to
    expect before they open the dashboard is the entire job — the value is that
    they walk in with a number and a list, so a supplier who has not filed shows
    up as an absence they notice instead of an absence they cannot see.

    Nothing here is reconciled, matched, accepted, rejected or kept pending. The
    words are avoided deliberately: this handler has only ever seen one side.

    ── The split is on the VENDOR's GSTIN, and it is not a validity check ─────

    A bill from a vendor with no GSTIN on record will never appear on IMS at all,
    because an unregistered supplier files no GSTR-1. So its tax is money that
    cannot be claimed as input credit however long anybody waits, and it gets its
    own running total.

    That is a REPORT, not a refusal. A missing GSTIN blocks nothing in this
    product and must not — plenty of legitimate purchases are from unregistered
    suppliers, and a blank field may equally be a vendor record nobody finished.
    Both readings are stated on the output; the handler does not choose between
    them, and it does not run the check digit either. A GSTIN that is present and
    malformed is `check_gstr1_readiness`'s finding, on outward supplies, and a
    second implementation of one check is a second implementation that drifts.

    ── No HSN predicate, deliberately ───────────────────────────────────────

    The brief for this handler warned that vendor-bill `line_items` carry no
    `hsn_code` key. Verified live 2026-08-20, that is half right and the half
    matters: `line_items` on that table has TWO shapes. The seeded shape is
    {qty, rate, amount, gst_rate, description} with no HSN at all; the shape the
    documents UI writes is {quantity, rate, unit, hsn_code, sac_code, gst_rate,
    gst_amount, line_total, product_id, discount_pct, description}. So an HSN
    predicate would not flag every row — it would flag every row of one shape and
    none of the other, which is worse, because the report would look
    discriminating while actually reporting which UI created the bill. Nothing
    here reads HSN.

    Returns {period, window, totals, with_vendor_gstin, without_vendor_gstin,
             what_this_is, what_this_is_not, caveats}.
    """
    period = period or return_period()
    try:
        if len(period) != 7 or period[4] != "-":
            raise ValueError(period)
        start, end = _period_bounds(period)
    except (ValueError, AttributeError, TypeError):
        return {"error": f"'{period}' is not a period. Expected YYYY-MM, e.g. 2026-07."}

    # ── The headline is read off the WHOLE period; only the listing is capped ──
    # Two queries rather than one, on purpose. If the totals were summed from the
    # capped rows, an org with 300 bills would be handed a headline covering 200
    # of them with nothing on the page saying which 200 — a covered fraction
    # reading as the whole, which is the one failure a compliance report must
    # never have. The aggregate carries no LIMIT and is therefore always the
    # complete month; `listed` and `bills` are separate keys on the output and a
    # caveat fires the moment they differ.
    tax_sum = " + ".join(f"COALESCE(b.{h}, 0)" for h in TAX_HEADS)
    summary = await pool.fetchrow(
        f"""
        SELECT count(*)                                      AS bills,
               COALESCE(sum(COALESCE(b.subtotal, 0)), 0)     AS taxable_value,
               COALESCE(sum({tax_sum}), 0)                   AS tax_value,
               count(*) FILTER (
                   WHERE COALESCE(NULLIF(btrim(v.gstin), ''), NULL) IS NULL
               )                                             AS bills_without_gstin,
               COALESCE(sum({tax_sum}) FILTER (
                   WHERE COALESCE(NULLIF(btrim(v.gstin), ''), NULL) IS NULL
               ), 0)                                         AS tax_without_gstin,
               count(*) FILTER (WHERE COALESCE(b.is_reverse_charge, FALSE))
                                                             AS reverse_charge_bills,
               count(*) FILTER (
                   WHERE COALESCE(NULLIF(btrim(b.currency), ''), 'INR') <> 'INR'
               )                                             AS non_inr_bills
        FROM staging.ganit_vendor_bills b
        -- LEFT, and carrying `v.org_id = b.org_id`. LEFT because a bill whose
        -- vendor row was soft-deleted still sat on the books that month and
        -- still has tax on it; an inner join would understate the headline. The
        -- org predicate because the FK is on id alone, so a join on id can
        -- surface another practice's vendor name and GSTIN if vendor_id is ever
        -- wrong — and the vendor's GSTIN is the exact field this handler splits
        -- on, so a cross-tenant read here would move a bill into the wrong half.
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status <> 'cancelled'
          AND b.bill_date >= $2::date AND b.bill_date < $3::date
        """,
        org_id, start, end,
    )

    rows = await pool.fetch(
        f"""
        SELECT COALESCE(NULLIF(btrim(v.name), ''), '(vendor record unavailable)')
                                                     AS vendor_name,
               v.id                                  AS vendor_id,
               NULLIF(btrim(v.email), '')            AS vendor_email,
               NULLIF(btrim(v.phone), '')            AS vendor_phone,
               NULLIF(btrim(v.gstin), '')            AS vendor_gstin,
               b.bill_number,
               b.internal_ref,
               b.bill_date,
               COALESCE(b.subtotal, 0)               AS taxable_value,
               COALESCE(b.cgst, 0) AS cgst, COALESCE(b.sgst, 0) AS sgst,
               COALESCE(b.igst, 0) AS igst, COALESCE(b.cess, 0) AS cess,
               ({tax_sum})                           AS tax_value,
               COALESCE(b.total, 0)                  AS total,
               COALESCE(b.is_reverse_charge, FALSE)  AS is_reverse_charge,
               COALESCE(NULLIF(btrim(b.currency), ''), 'INR') AS currency,
               b.status
        FROM staging.ganit_vendor_bills b
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status <> 'cancelled'
          AND b.bill_date >= $2::date AND b.bill_date < $3::date
        -- Ordered by TAX, not by total and not by date. IMS is worked
        -- largest-credit-first, so the cap below must spend itself on the bills
        -- carrying the most credit rather than the ones that happen to be
        -- biggest or newest.
        ORDER BY ({tax_sum}) DESC, b.bill_date, b.bill_number
        LIMIT $4
        """,
        org_id, start, end, limit,
    )

    with_gstin: list[dict] = []
    without_gstin: list[dict] = []
    running_unclaimable = 0.0

    for r in rows:
        entry = reachable({
            "vendor": r["vendor_name"],
            "vendor_gstin": _gstin(r["vendor_gstin"]),
            "bill": r["bill_number"] or r["internal_ref"] or "(unnumbered bill)",
            "bill_date": r["bill_date"].isoformat() if r["bill_date"] else None,
            "taxable_value": _money(r["taxable_value"]),
            "tax_value": _money(r["tax_value"]),
            "tax_by_head": {h: _money(r[h]) for h in TAX_HEADS},
            "bill_total": _money(r["total"]),
            "currency": r["currency"],
            "status": r["status"],
        }, kind="vendor", entity_id=r["vendor_id"],
            email=r["vendor_email"], phone=r["vendor_phone"])
        if r["is_reverse_charge"]:
            # Carried on the row rather than filtered out. A reverse-charge bill
            # DOES appear on IMS — the supplier reports it — but the recipient
            # pays the tax itself, so the credit does not arrive by the same
            # route and a preparer working this list needs to see which is which.
            entry["reverse_charge"] = True
        if entry["vendor_gstin"]:
            with_gstin.append(entry)
        else:
            running_unclaimable = round(running_unclaimable + entry["tax_value"], 2)
            # The running total travels ON the row, not only in a footer. This
            # list is read top-down and abandoned partway; a reader who stops at
            # the fifth row should still be able to see what those five cost.
            entry["running_tax_that_cannot_be_claimed"] = running_unclaimable
            without_gstin.append(entry)

    listed = len(rows)
    total_bills = int(summary["bills"] or 0) if summary else 0

    out = {
        "period": period,
        "window": {"from": start.isoformat(),
                   "to": date.fromordinal(end.toordinal() - 1).isoformat()},
        "totals": {
            "bills": total_bills,
            "listed": listed,
            "taxable_value": _money(summary["taxable_value"] if summary else 0),
            "tax_value": _money(summary["tax_value"] if summary else 0),
            "bills_from_vendors_without_gstin":
                int((summary["bills_without_gstin"] if summary else 0) or 0),
            "tax_that_cannot_be_claimed":
                _money(summary["tax_without_gstin"] if summary else 0),
            "reverse_charge_bills":
                int((summary["reverse_charge_bills"] if summary else 0) or 0),
        },
        "with_vendor_gstin": with_gstin,
        "without_vendor_gstin": without_gstin,
        # Fields, not comments. The output is handed to a language model, and the
        # only wording certain to reach the reader is wording that is in the data.
        "what_this_is": (
            f"What YOUR BOOKS say should be on the IMS dashboard for {period}. "
            f"Open IMS with this list beside you: a bill that is here and not "
            f"there is a supplier who has not filed."
        ),
        "what_this_is_not": (
            "This is NOT an IMS reconciliation. Nothing here has been matched "
            "against the portal, accepted, rejected or kept pending — this "
            "product has no GSTN connection and has seen only your side of the "
            "month. Every difference you find on the dashboard is a real "
            "difference to investigate, not an error in this list."
        ),
        "caveats": [],
    }

    if summary and summary["bills_without_gstin"]:
        out["caveats"].append(
            f"{int(summary['bills_without_gstin'])} bill(s) carrying "
            f"{_money(summary['tax_without_gstin'])} of tax are from vendors with "
            f"no GSTIN on record. None of them will appear on IMS — an "
            f"unregistered supplier files no GSTR-1 — so that tax is not "
            f"claimable as input credit. It is equally possible the supplier IS "
            f"registered and the vendor record was simply never completed; a "
            f"blank GSTIN blocks nothing in this product and this is a report, "
            f"not a refusal."
        )
    if summary and summary["reverse_charge_bills"]:
        out["caveats"].append(
            f"{int(summary['reverse_charge_bills'])} bill(s) are marked reverse "
            f"charge. They are listed, counted, and flagged on their own rows: "
            f"the supplier reports them so they do appear on IMS, but the tax is "
            f"paid by you rather than by them, so the credit does not arrive by "
            f"the same route as the rest of this list."
        )
    if summary and summary["non_inr_bills"]:
        out["caveats"].append(
            f"{int(summary['non_inr_bills'])} bill(s) are not in INR. They are "
            f"listed and counted at the figures recorded on them; nothing on "
            f"those rows states which unit the tax columns are in, so the "
            f"headline mixes currencies for them."
        )
    if listed < total_bills:
        out["caveats"].append(
            f"TRUNCATED: {listed} of {total_bills} bills are listed, taken "
            f"largest-tax first. The figures under `totals` cover the WHOLE "
            f"period and are complete; the two lists below them are not."
        )
    if not total_bills:
        out["caveats"].append(
            f"No vendor bill is recorded for {period} at all. Expect an empty IMS "
            f"dashboard — and if it is not empty, every line on it is a purchase "
            f"missing from your books. That is a finding, not a skipped check."
        )
    return out


# ── 2 · the credit that lapses on 30 November ────────────────────────────────

async def brief_itc_at_risk_of_lapse(
    pool, org_id: str, financial_year: str | None = None, limit: int = 200
) -> dict:
    """Prior-year vendor bills and their tax, measured against the s.16(4) bar.

    *financial_year* is '2025-26' and defaults to the most recently ENDED
    financial year — the one with a live deadline. It has to default, or the
    dispatcher refuses every scheduled run.

    ── The two sentences this output is not allowed to omit ──────────────────

    Both are on the face of the returned dict, not in this docstring alone,
    because a caveat a language model never sees is a caveat the reader never
    sees.

      1. This is credit AT RISK, not credit lost. Nothing in this product records
         whether ITC was availed — there is no availed flag on
         `ganit_vendor_bills`, no link from a bill to the return that claimed it,
         and no credit ledger. Every figure below is tax that was CHARGED. Where
         the credit was taken months ago, and for a firm filing monthly 3Bs most
         of it will have been, there is nothing here to lose and this figure
         overstates by the whole of that bill.
      2. The bar is the EARLIER of 30 November and the date the annual return was
         actually filed. `staging.statute_calendar`'s own note on the s.16(4) row
         says exactly that. This product records no GSTR-9 filing date anywhere —
         there is no filing table in the schema at all, verified 2026-08-20 — so
         the date reported here is the OUTER limit only. A firm that filed GSTR-9
         in October shut its own window in October, and being told it has until
         November is being told it has time it does not have.

    Both of those make the number generous, and that DIRECTION is stated too: a
    reader who knows which way a figure errs can work with it, while a reader who
    does not will tie it out against their own credit ledger, fail, and stop
    believing the rest of the catalogue as well.

    Returns {financial_year, window, as_at, deadline, totals, bills,
             what_this_figure_is, the_deadline_may_already_have_passed,
             limitations, caveats}.
    """
    financial_year = financial_year or _last_ended_financial_year(utc_now().date())
    try:
        fy_start, fy_end = fy_bounds(financial_year)
    except StatuteError as exc:
        return {"error": str(exc)}

    # as_of is the END of the year the credit belongs to, never today. The bar for
    # FY 2025-26 is the rule as it stood for that year; asking as of the day this
    # happens to run would answer with whichever version is current, which is the
    # entire failure `services/statute.py` refuses to have a default for.
    bar = await obligation(pool, _ITC_BAR_KEY, as_of=fy_end)

    deadline: date | None = None
    if bar and bar.get("due_day") and bar.get("due_month"):
        # "30 November FOLLOWING the financial year" — FY 2025-26 ends 31 March
        # 2026, so the bar is 30 November 2026. `fy_end.year` is that year, which
        # is why the deadline is built off the END of the window and not the
        # start: off the start it would land a full year early, every year.
        deadline = date(fy_end.year, int(bar["due_month"]), int(bar["due_day"]))

    tax_sum = " + ".join(f"COALESCE(b.{h}, 0)" for h in TAX_HEADS)

    # Complete-population aggregate, uncapped — same reason as in
    # `brief_ims_expectations`. The rupees at the top must be the whole year even
    # when the list below them is a slice of it.
    summary = await pool.fetchrow(
        f"""
        SELECT count(*)                                   AS bills,
               count(DISTINCT b.vendor_id)                AS vendors,
               COALESCE(sum({tax_sum}), 0)                AS tax_value,
               COALESCE(sum(COALESCE(b.subtotal, 0)), 0)  AS taxable_value,
               count(*) FILTER (WHERE ({tax_sum}) <= 0)   AS bills_with_no_tax,
               count(*) FILTER (WHERE COALESCE(b.is_reverse_charge, FALSE))
                                                          AS reverse_charge_bills,
               count(*) FILTER (
                   WHERE COALESCE(NULLIF(btrim(b.currency), ''), 'INR') <> 'INR'
               )                                          AS non_inr_bills,
               count(*) FILTER (
                   WHERE COALESCE(NULLIF(btrim(v.gstin), ''), NULL) IS NULL
               )                                          AS bills_without_vendor_gstin
        FROM staging.ganit_vendor_bills b
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status <> 'cancelled'
          AND b.bill_date >= $2::date AND b.bill_date <= $3::date
        """,
        org_id, fy_start, fy_end,
    )

    rows = await pool.fetch(
        f"""
        SELECT COALESCE(NULLIF(btrim(v.name), ''), '(vendor record unavailable)')
                                                    AS vendor_name,
               v.id                                 AS vendor_id,
               NULLIF(btrim(v.email), '')           AS vendor_email,
               NULLIF(btrim(v.phone), '')           AS vendor_phone,
               NULLIF(btrim(v.gstin), '')           AS vendor_gstin,
               b.bill_number,
               b.internal_ref,
               b.bill_date,
               COALESCE(b.subtotal, 0)              AS taxable_value,
               COALESCE(b.cgst, 0) AS cgst, COALESCE(b.sgst, 0) AS sgst,
               COALESCE(b.igst, 0) AS igst, COALESCE(b.cess, 0) AS cess,
               ({tax_sum})                          AS tax_value,
               COALESCE(b.total, 0)                 AS total,
               COALESCE(b.amount_paid, 0)           AS amount_paid,
               COALESCE(b.is_reverse_charge, FALSE) AS is_reverse_charge,
               COALESCE(NULLIF(btrim(b.currency), ''), 'INR') AS currency,
               b.status
        FROM staging.ganit_vendor_bills b
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status <> 'cancelled'
          AND b.bill_date >= $2::date AND b.bill_date <= $3::date
          -- A bill with no tax on it carries no credit to lose. Counted in the
          -- summary above and excluded from the listing: putting a zero on a
          -- page headed "at risk" invites somebody to tick it off as handled.
          AND ({tax_sum}) > 0
        -- Rupees at the top, which is the brief for this skill: largest exposure
        -- first, so the cap spends itself where the money is.
        ORDER BY ({tax_sum}) DESC, b.bill_date, b.bill_number
        LIMIT $4
        """,
        org_id, fy_start, fy_end, limit,
    )

    today = utc_now().date()
    bills = []
    for r in rows:
        entry = reachable({
            "vendor": r["vendor_name"],
            "vendor_gstin": _gstin(r["vendor_gstin"]),
            "bill": r["bill_number"] or r["internal_ref"] or "(unnumbered bill)",
            "bill_date": r["bill_date"].isoformat() if r["bill_date"] else None,
            "taxable_value": _money(r["taxable_value"]),
            "tax_at_risk": _money(r["tax_value"]),
            "tax_by_head": {h: _money(r[h]) for h in TAX_HEADS},
            "bill_total": _money(r["total"]),
            "amount_paid": _money(r["amount_paid"]),
            "currency": r["currency"],
            "status": r["status"],
        }, kind="vendor", entity_id=r["vendor_id"],
            email=r["vendor_email"], phone=r["vendor_phone"])
        notes = []
        if r["is_reverse_charge"]:
            # Flagged, never dropped. s.16(4) reaches reverse-charge credit too,
            # but the date it runs from is the self-invoice under s.31(3)(f), and
            # this product records no self-invoice date — so the anchor used here
            # is the vendor bill's own date and may be the wrong one for these.
            entry["reverse_charge"] = True
            notes.append(
                "Reverse charge. The s.16(4) clock for RCM credit runs from the "
                "self-invoice, which this product does not record; the date used "
                "here is the vendor bill's."
            )
        if not entry["vendor_gstin"]:
            notes.append(
                "No GSTIN on the vendor record. If the supplier is genuinely "
                "unregistered there was never any credit here to lapse."
            )
        if notes:
            # A list, not a string that the second condition overwrites. The
            # first cut assigned `entry["note"]` twice and a reverse-charge bill
            # from a vendor with no GSTIN silently lost the reverse-charge half —
            # the more important half — with nothing on the row saying so.
            entry["notes"] = notes
        bills.append(entry)

    listed = len(rows)
    total_bills = int((summary["bills"] if summary else 0) or 0)
    with_tax = total_bills - int((summary["bills_with_no_tax"] if summary else 0) or 0)

    out = {
        "financial_year": financial_year,
        "window": {"from": fy_start.isoformat(), "to": fy_end.isoformat()},
        "as_at": today.isoformat(),
        "totals": {
            # First key in the block, deliberately: rupees at the top is the
            # brief, and a reader who reads one number reads this one.
            "tax_at_risk": _money(summary["tax_value"] if summary else 0),
            "bills": with_tax,
            "bills_in_year": total_bills,
            "listed": listed,
            "vendors": int((summary["vendors"] if summary else 0) or 0),
            "taxable_value": _money(summary["taxable_value"] if summary else 0),
        },
        "bills": bills,
        "what_this_figure_is": (
            "CREDIT AT RISK OF LAPSE — tax CHARGED on bills dated in "
            f"{financial_year}. It is NOT credit that has been lost, and it is "
            "not even credit that is still outstanding: this product records no "
            "ITC-availed flag, so it cannot tell a bill whose credit was claimed "
            "in last year's 3B from one whose credit was never taken. Where the "
            "credit was already availed there is nothing here to lose and this "
            "figure overstates by the whole of that bill."
        ),
        "limitations": [
            "No ITC-availed flag exists on `ganit_vendor_bills`, no link from a "
            "bill to the return that claimed its credit, and no credit ledger. "
            "Every figure above is tax charged, not credit outstanding.",
            "The bar is the EARLIER of the date reported here and the date "
            f"GSTR-9 for {financial_year} was actually filed. Nothing in this "
            "product records that filing date, so the date here is the OUTER "
            "limit only — see `the_deadline_may_already_have_passed`.",
            "Credit-note adjustments, credit blocked by s.17(5) and supplies "
            "that were never eligible are not separated out. Every one of them "
            "makes this figure larger than the real exposure.",
        ],
        "caveats": [],
    }

    if deadline is not None:
        left = days_between(deadline, today)
        out["deadline"] = {
            "date": deadline.isoformat(),
            "section": (bar or {}).get("section_ref"),
            "days_remaining": left,
            "has_passed": left < 0,
            "source": (bar or {}).get("source_ref"),
            "is_the_outer_limit_only": True,
        }
        out["the_deadline_may_already_have_passed"] = (
            f"s.16(4) bars this credit after the EARLIER of "
            f"{deadline.isoformat()} or the date the annual return for "
            f"{financial_year} was filed. This product records no GSTR-9 filing "
            f"date, so it cannot apply the earlier of the two. A firm that filed "
            f"GSTR-9 in October has already shut its own window: the date above "
            f"is then wrong in your favour. Check when the annual return went in "
            f"before relying on any day of it."
        )
        if left < 0:
            out["caveats"].append(
                f"The outer limit passed {abs(left)} day(s) ago, on "
                f"{deadline.isoformat()}. Anything still unavailed from "
                f"{financial_year} is time-barred; this is now a record of what "
                f"was lost, not a list of work."
            )
        elif left <= 45:
            out["caveats"].append(
                f"{left} day(s) to the outer limit ({deadline.isoformat()}) — and "
                f"fewer than that if the annual return has already been filed."
            )
    else:
        # No date rather than a guessed one. The catalogue is the only source of
        # this bar in the codebase, and writing 30 November in here would be
        # exactly the hardcoded law `services/statute.py` exists to remove.
        out["deadline"] = None
        out["the_deadline_may_already_have_passed"] = (
            "No date is stated because the statute catalogue holds no version of "
            f"'{_ITC_BAR_KEY}' in force at {fy_end.isoformat()}. The rule still "
            "applies — s.16(4) bars the credit on the EARLIER of 30 November "
            "following the year or the date the annual return was filed — but "
            "the date has not been read from this system and must not be taken "
            "from this report."
        )
        out["caveats"].append(
            f"The statute catalogue returned no '{_ITC_BAR_KEY}' row in force at "
            f"{fy_end.isoformat()}, so no deadline is reported. That is a gap in "
            f"the reference data, not a finding about this org."
        )

    if summary and summary["bills_with_no_tax"]:
        out["caveats"].append(
            f"{int(summary['bills_with_no_tax'])} bill(s) dated in "
            f"{financial_year} carry no GST on record and are not listed — there "
            f"is no credit on them to lapse."
        )
    if summary and summary["bills_without_vendor_gstin"]:
        out["caveats"].append(
            f"{int(summary['bills_without_vendor_gstin'])} bill(s) are from "
            f"vendors with no GSTIN on record. Their tax is still counted in the "
            f"headline: this handler cannot tell an unregistered supplier — where "
            f"no credit ever existed — from a vendor record nobody finished."
        )
    if summary and summary["reverse_charge_bills"]:
        out["caveats"].append(
            f"{int(summary['reverse_charge_bills'])} bill(s) are reverse charge "
            f"and ARE counted. s.16(4) reaches that credit too, but its clock "
            f"runs from the self-invoice, which this product does not record."
        )
    if summary and summary["non_inr_bills"]:
        out["caveats"].append(
            f"{int(summary['non_inr_bills'])} bill(s) are not in INR and are "
            f"counted at the figures recorded on them, so the headline mixes "
            f"currencies. GST is charged in rupees, and nothing on those rows "
            f"says which unit their tax columns are in."
        )
    if listed < with_tax:
        out["caveats"].append(
            f"TRUNCATED: {listed} of {with_tax} bills carrying tax are listed, "
            f"taken largest-tax first. `totals.tax_at_risk` covers the WHOLE year "
            f"and is complete; the list below it is not."
        )
    if not with_tax:
        out["caveats"].append(
            f"No vendor bill dated in {financial_year} carries any GST. Nothing "
            f"is at risk of lapsing under s.16(4) for that year. That is a "
            f"finding, not a skipped check."
        )
    return out


# ── 3 · rates the Council abolished ──────────────────────────────────────────

async def check_dead_gst_slabs(
    pool, org_id: str, as_at: str | None = None, limit: int = 200
) -> dict:
    """Products and document lines still carrying a GST rate that no longer
    exists, plus invoice lines whose rate disagrees with the product master.

    ── THIS IS NOT A MONTHLY SKILL ───────────────────────────────────────────

    Put it on a monthly schedule and it will produce eleven empty reports a year
    and one that mattered. A dead slab is fixed ONCE — you edit the product
    master, correct the open documents, and it returns zero for ever, until the
    GST Council next moves a rate. Its correct cadence is ON DEMAND: run it the
    week after a rate change, run it when a firm is onboarded and its catalogue
    is imported from somewhere else, run it before an annual return. Everything
    here is therefore re-runnable and idempotent, and nothing about the output
    depends on when it last ran.

    *as_at* is an ISO date and defaults to today. It exists so "what is dead NOW"
    can be re-asked as of any date without editing anything — and because the
    dispatcher needs every parameter to carry a default.

    ── A rate is only wrong for the date the document carries ────────────────

    The 12% and 28% slabs existed for eight years. An invoice dated May 2025 at
    12% is correct history, and re-issuing it would BE the defect. So a document
    line is judged against the rates in force ON ITS OWN DATE, resolved through
    `services/statute.py`, and a line that was right when it was issued is
    counted and disclosed but is NOT a finding.

    The PRODUCT MASTER is judged differently, and that asymmetry is the heart of
    this handler. A product carries no date: it is a forward-looking price list,
    and every future document raised from it inherits its rate. A master still on
    12% today is wrong today, whatever it was worth in 2024.

    ── The mismatch check runs on invoice lines only, and names the stale side ─

    `staging.ganit_products` is a SALES catalogue. Verified live: not one of the
    166 vendor-bill lines on the seeded org matches a product name, because
    purchases are things like "Toner refill" that were never in anybody's price
    list. Running the comparison over them would produce noise and nothing else.

    Linking a line to its product is the weak point here and is disclosed as
    such. `line_items[].product_id` exists in the shape but is EMPTY on all 1,230
    invoice lines on the seeded org — zero coverage, so it is not usable as the
    link at all — and the fallback is an exact case-folded match on the product
    NAME, which covers 1,027 of those 1,230. A name whose products disagree among
    themselves is treated as unlinkable rather than guessed. `coverage` on the
    output states how many lines were compared and how many could not be linked,
    because a mismatch count drawn from 83% of the lines that reads as if it came
    from all of them is the covered-fraction failure this whole file is written
    against.

    And when a mismatch IS found, the report names WHICH SIDE is stale. On the
    seeded org 205 of the 207 mismatches are an 18% invoice line against a master
    still on the abolished 12% — the line is right and the master is wrong — and
    the obvious phrasing would send somebody to re-issue two hundred correct
    invoices at a rate that does not exist in law.

    The HSN digit-length check is deliberately absent: 4 vs 6 digits turns on
    turnover, and this product records no turnover anywhere.

    Returns {as_at, live_slabs, findings, counts, coverage, cadence, what_this_is,
             caveats}.
    """
    try:
        as_at_date = date.fromisoformat(as_at) if as_at else utc_now().date()
    except (ValueError, TypeError):
        return {"error": f"'{as_at}' is not a date. Expected YYYY-MM-DD."}

    live = _LiveRates(pool)
    live_today = await live.on(as_at_date)
    if not live_today:
        # Refusing to report beats reporting that every rate in the org is dead.
        # An empty catalogue is a deployment fault — migration 158 unapplied, or a
        # schema-qualification slip of the kind migration 142 fixed — and it fails
        # in the worst direction available: it would condemn every product and
        # every line the org has ever raised, in a document a CA acts on.
        return {
            "as_at": as_at_date.isoformat(),
            "error": (
                f"The statute catalogue lists no GST rate in force on "
                f"{as_at_date.isoformat()}. Nothing is reported, rather than "
                f"reporting every rate in this org as abolished, which is what "
                f"an empty catalogue would otherwise produce. This is a "
                f"reference-data fault, not a finding about this org."
            ),
        }

    # Decimal, not float, and this is not cosmetic: asyncpg encodes a `numeric[]`
    # parameter from Decimal/int and REFUSES a float outright, so passing the
    # rates straight out of the float-keyed map above raises at query time. The
    # cast on the placeholder is explicit for the other half of the same hazard —
    # PgBouncer turns an untyped parameter parse error into an instant 500 whose
    # log says nothing. Two separate incidents in this repo, same shape.
    live_set = sorted(live_today)
    live_nums = [Decimal(str(r)) for r in live_set]

    # ── the product master ────────────────────────────────────────────────────
    products = await pool.fetch(
        """
        SELECT p.name,
               p.gst_rate,
               NULLIF(btrim(p.hsn_code), '') AS hsn_code,
               NULLIF(btrim(p.sac_code), '') AS sac_code,
               p.is_active
        FROM staging.ganit_products p
        WHERE p.org_id = $1::uuid
          AND p.gst_rate IS NOT NULL
          AND NOT (p.gst_rate = ANY($2::numeric[]))
        ORDER BY p.gst_rate DESC, p.name
        LIMIT $3
        """,
        org_id, live_nums, limit,
    )
    product_total = await pool.fetchval(
        """
        SELECT count(*) FROM staging.ganit_products p
        WHERE p.org_id = $1::uuid
          AND p.gst_rate IS NOT NULL
          AND NOT (p.gst_rate = ANY($2::numeric[]))
        """,
        org_id, live_nums,
    ) or 0

    # ── document lines ────────────────────────────────────────────────────────
    # One query over both document tables. `jsonb_typeof(...) = 'array'` guards
    # the LATERAL: `jsonb_array_elements` on an object or a scalar raises and
    # takes the whole run down, and `line_items` is a bare jsonb column with no
    # constraint saying it holds an array.
    #
    # The rate is filtered in SQL only against the rates live AS AT the run date.
    # That is a PRE-filter and not the verdict: whether each surviving line was
    # right when it was ISSUED is settled per document date in Python below,
    # because SQL here has no access to the catalogue's validity windows.
    #
    # `~ '^[0-9]+(\.[0-9]+)?$'` before the cast. Live data on the seeded org has
    # no non-numeric rate, but `line_items` is unconstrained JSON — one line with
    # gst_rate "" or "18%" and an unguarded ::numeric takes down every run for
    # that org, permanently, with an error nobody reading the report can act on.
    lines = await pool.fetch(
        r"""
        WITH inv AS (
            SELECT 'invoice line'::text               AS source,
                   i.invoice_number                   AS document,
                   i.invoice_date                     AS document_date,
                   i.doc_status                       AS doc_status,
                   li->>'description'                 AS description,
                   (li->>'gst_rate')::numeric         AS rate,
                   NULLIF(btrim(li->>'hsn_code'), '') AS hsn_code
            FROM staging.ganit_invoices i
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(i.line_items) = 'array'
                     THEN i.line_items ELSE '[]'::jsonb END) li
            WHERE i.org_id = $1::uuid
              AND i.is_active = TRUE
              AND i.cancelled_at IS NULL
              AND li->>'gst_rate' ~ '^[0-9]+(\.[0-9]+)?$'
        ),
        vb AS (
            SELECT 'vendor bill line'::text,
                   COALESCE(b.bill_number, b.internal_ref),
                   b.bill_date,
                   b.status,
                   li->>'description',
                   (li->>'gst_rate')::numeric,
                   NULLIF(btrim(li->>'hsn_code'), '')
            FROM staging.ganit_vendor_bills b
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(b.line_items) = 'array'
                     THEN b.line_items ELSE '[]'::jsonb END) li
            WHERE b.org_id = $1::uuid
              AND b.is_active = TRUE
              AND b.status <> 'cancelled'
              AND li->>'gst_rate' ~ '^[0-9]+(\.[0-9]+)?$'
        ),
        all_lines AS (SELECT * FROM inv UNION ALL SELECT * FROM vb)
        SELECT * FROM all_lines
        WHERE NOT (rate = ANY($2::numeric[]))
        ORDER BY document_date DESC, document, description
        LIMIT $3
        """,
        org_id, live_nums, limit,
    )

    dead_lines: list[dict] = []
    correct_when_issued = 0

    for r in lines:
        rate = round(float(r["rate"]), 3)
        day = r["document_date"] or as_at_date
        # The verdict, one document date at a time. Memoised inside `_LiveRates`,
        # so this costs one round-trip per DISTINCT date rather than one per
        # line — across the whole live database the dead-slab lines fall on five
        # distinct dates — and the row cap bounds it in the pathological case.
        if await live.is_live_on(rate, day):
            correct_when_issued += 1
            continue

        entry = {
            "where": r["source"],
            "document": r["document"] or "(unnumbered)",
            "document_date": day.isoformat() if isinstance(day, date) else None,
            "description": r["description"] or "(no description on the line)",
            "rate": rate,
            "hsn_or_sac": r["hsn_code"],
            "status": r["doc_status"],
        }
        # The abolition date comes from a day this run has ALREADY asked the
        # catalogue about and on which the rate was alive. Nothing extra is
        # fetched for it, and where no such day was asked the field is simply
        # absent rather than guessed at.
        known = live.known_row(rate)
        if known is not None and known.get("effective_to"):
            entry["rate_abolished_on"] = known["effective_to"].isoformat()
        dead_lines.append(entry)

    # ── the master-vs-line comparison ────────────────────────────────────────
    mismatch_rows = await pool.fetch(
        r"""
        WITH master AS (
            -- One row per product NAME, and used only where every product
            -- carrying that name agrees on the rate. A name resolving to two
            -- different rates is genuinely ambiguous and is dropped rather than
            -- guessed: picking one would invent a verdict. `n_rates` travels out
            -- so the coverage figures can account for what was dropped this way.
            SELECT lower(btrim(p.name))       AS pname,
                   min(p.gst_rate)            AS master_rate,
                   count(DISTINCT p.gst_rate) AS n_rates
            FROM staging.ganit_products p
            WHERE p.org_id = $1::uuid
              AND p.is_active = TRUE
              AND p.gst_rate IS NOT NULL
            GROUP BY 1
        ),
        lines AS (
            SELECT i.invoice_number                   AS document,
                   i.invoice_date                     AS document_date,
                   li->>'description'                 AS description,
                   lower(btrim(li->>'description'))   AS lname,
                   (li->>'gst_rate')::numeric         AS line_rate
            FROM staging.ganit_invoices i
            CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(i.line_items) = 'array'
                     THEN i.line_items ELSE '[]'::jsonb END) li
            WHERE i.org_id = $1::uuid
              AND i.is_active = TRUE
              AND i.cancelled_at IS NULL
              AND li->>'gst_rate' ~ '^[0-9]+(\.[0-9]+)?$'
        )
        SELECT l.document, l.document_date, l.description,
               l.line_rate, m.master_rate,
               -- Window functions are evaluated before LIMIT, so this is the
               -- FULL mismatch count and not the count of what survived the cap.
               -- That is what makes the truncation caveat below able to say
               -- "N of M" honestly.
               count(*) OVER ()                                   AS n_mismatches,
               (SELECT count(*) FROM lines)                       AS n_lines,
               (SELECT count(*) FROM lines l2 JOIN master m2
                       ON m2.pname = l2.lname AND m2.n_rates = 1) AS n_compared
        FROM lines l
        JOIN master m ON m.pname = l.lname AND m.n_rates = 1
        WHERE l.line_rate <> m.master_rate
        ORDER BY l.document_date DESC, l.document
        LIMIT $2
        """,
        org_id, limit,
    )

    mismatches = []
    n_lines = n_compared = n_mismatches = 0
    for r in mismatch_rows:
        n_lines = int(r["n_lines"] or 0)
        n_compared = int(r["n_compared"] or 0)
        n_mismatches = int(r["n_mismatches"] or 0)
        line_rate = round(float(r["line_rate"]), 3)
        master_rate = round(float(r["master_rate"]), 3)
        entry = {
            "document": r["document"] or "(unnumbered)",
            "document_date": (r["document_date"].isoformat()
                              if r["document_date"] else None),
            "item": r["description"],
            "invoice_line_rate": line_rate,
            "product_master_rate": master_rate,
            "linked_by": "product name (exact, case-folded)",
        }
        master_dead = master_rate not in live_today
        line_dead = line_rate not in live_today
        if master_dead and not line_dead:
            entry["which_side_is_stale"] = _MASTER_IS_THE_STALE_SIDE
        elif line_dead and not master_dead:
            entry["which_side_is_stale"] = (
                "The INVOICE LINE carries a rate that no longer exists; the "
                "master is current. This document is the one that needs "
                "correcting."
            )
        else:
            entry["which_side_is_stale"] = (
                "Both rates are in force today, so this is a pricing "
                "disagreement rather than a dead slab — somebody overrode the "
                "master, or the master moved after the invoice was raised. "
                "Neither side is wrong on its face."
            )
        mismatches.append(entry)

    if not mismatch_rows:
        # `count(*) OVER ()` cannot report through an EMPTY result set, so the
        # coverage figures for a clean org have to be read separately. Without
        # this, a healthy org reports "0 invoice lines compared" — which is
        # indistinguishable from the comparison never having run, and that
        # ambiguity is exactly what makes a zero untrustworthy.
        cover = await pool.fetchrow(
            r"""
            WITH master AS (
                SELECT lower(btrim(p.name))       AS pname,
                       count(DISTINCT p.gst_rate) AS n_rates
                FROM staging.ganit_products p
                WHERE p.org_id = $1::uuid
                  AND p.is_active = TRUE
                  AND p.gst_rate IS NOT NULL
                GROUP BY 1
            ),
            lines AS (
                SELECT lower(btrim(li->>'description')) AS lname
                FROM staging.ganit_invoices i
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(i.line_items) = 'array'
                         THEN i.line_items ELSE '[]'::jsonb END) li
                WHERE i.org_id = $1::uuid
                  AND i.is_active = TRUE
                  AND i.cancelled_at IS NULL
                  AND li->>'gst_rate' ~ '^[0-9]+(\.[0-9]+)?$'
            )
            SELECT (SELECT count(*) FROM lines) AS n_lines,
                   (SELECT count(*) FROM lines l JOIN master m
                           ON m.pname = l.lname AND m.n_rates = 1) AS n_compared
            """,
            org_id,
        )
        if cover:
            n_lines = int(cover["n_lines"] or 0)
            n_compared = int(cover["n_compared"] or 0)

    findings = {
        "product_master": [
            {
                "product": p["name"],
                "rate": round(float(p["gst_rate"]), 3),
                "hsn_or_sac": p["hsn_code"] or p["sac_code"],
                "is_active": p["is_active"],
                "why": (
                    "A product carries no date. Every document raised from it "
                    "from now on inherits this rate, so it is wrong TODAY "
                    "regardless of when it was right."
                ),
            }
            for p in products
        ],
        "document_lines": dead_lines,
        "rate_disagrees_with_product_master": mismatches,
    }

    out = {
        "as_at": as_at_date.isoformat(),
        "live_slabs": live_set,
        "live_slabs_source": "staging.statute_calendar via services/statute.py",
        "findings": findings,
        "counts": {
            "products_on_a_dead_slab": int(product_total),
            "products_listed": len(products),
            "document_lines_on_a_dead_slab": len(dead_lines),
            "document_lines_correct_when_issued": correct_when_issued,
            "rate_mismatches": n_mismatches,
            "rate_mismatches_listed": len(mismatches),
        },
        "coverage": {
            "invoice_lines": n_lines,
            "compared_against_the_master": n_compared,
            "not_linkable_to_a_product": max(0, n_lines - n_compared),
            "how": (
                "`line_items[].product_id` is empty on every invoice line in "
                "this database, so lines are linked to the master by an exact "
                "case-folded product NAME. A name whose products disagree about "
                "the rate is treated as unlinkable, never guessed. The mismatch "
                "count is drawn from the compared lines ONLY and says nothing "
                "about the rest. Vendor-bill lines are not compared at all — the "
                "product master is a sales catalogue and purchases are not in it."
            ),
        },
        "cadence": (
            "ON DEMAND, not monthly. A dead slab is fixed once and then returns "
            "zero until the GST Council next moves a rate — a monthly schedule "
            "would guarantee eleven empty reports a year. Run this after a rate "
            "change, after importing a catalogue, and before an annual return."
        ),
        "what_this_is": (
            f"Records still carrying a GST rate that was not in force on "
            f"{as_at_date.isoformat()}. The live slabs are read from the statute "
            f"catalogue rather than written into this code: "
            + ", ".join(f"{r:g}%" for r in live_set) + "."
        ),
        "caveats": [],
    }

    if correct_when_issued:
        out["caveats"].append(
            f"{correct_when_issued} line(s) carry a rate that is not live today "
            f"but WAS in force on the date of their own document. They are "
            f"correct history and are NOT findings — re-issuing them at a "
            f"current rate would be the defect."
        )
    if len(products) < product_total:
        out["caveats"].append(
            f"TRUNCATED: {len(products)} of {int(product_total)} products on a "
            f"dead slab are listed, highest rate first."
        )
    if len(lines) == limit:
        out["caveats"].append(
            f"TRUNCATED: the document-line scan stopped at {limit} candidate "
            f"lines, newest first. There may be more beyond them, so "
            f"`document_lines_on_a_dead_slab` is a floor and not the total."
        )
    if len(mismatches) < n_mismatches:
        out["caveats"].append(
            f"TRUNCATED: {len(mismatches)} of {n_mismatches} rate mismatches are "
            f"listed, newest first."
        )
    if n_lines and n_compared < n_lines:
        out["caveats"].append(
            f"{n_lines - n_compared} of {n_lines} invoice lines could not be "
            f"linked to any product in the master and were NOT compared. The "
            f"mismatch count covers {n_compared} lines, not all of them."
        )
    if any(m.get("which_side_is_stale") == _MASTER_IS_THE_STALE_SIDE
           for m in mismatches):
        out["caveats"].append(
            "Some mismatches are the PRODUCT MASTER carrying the abolished rate "
            "while the invoice line carries a live one. Fix the master. Do NOT "
            "correct those invoices — they are already right, and re-issuing "
            "them at the master's rate would put an abolished slab on a live "
            "document."
        )
    if not (product_total or dead_lines or n_mismatches):
        out["caveats"].append(
            f"Nothing in this org carries a GST rate that was dead on "
            f"{as_at_date.isoformat()}, and no invoice line disagrees with the "
            f"product master. That is a finding, not a skipped check — and it is "
            f"the answer this skill should give every time until the Council "
            f"moves a rate again."
        )
    return out
