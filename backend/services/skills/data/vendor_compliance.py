"""
vendor_compliance — catalogue #49, #50, #51.

Three statutory clocks that all run on the same side of the ledger: what the
firm owes, who it owes it to, and what it has told a portal about it.

    check_msme_payment_clock   #49  unpaid bills of micro and small suppliers
    check_tds_thresholds       #50  year-to-date credited per vendor by section
    check_einvoice_window      #51  B2B documents with no IRN, against the clock

── THE ONE FACT THAT SHAPES ALL THREE ───────────────────────────────────────

Migration 175 landed the columns these need on 2026-08-20 and BACKFILLED
NOTHING. Measured read-only against the live database the same day:

    staging.ganit_vendors          80 rows across three orgs
                                   is_msme            recorded on 0
                                   enterprise_class   recorded on 0
                                   vendor_kind        recorded on 0
                                   payment_terms_days recorded on 0
                                   udyam_number       recorded on 0
                                   tds_section        recorded on 0
    staging.ganit_vendor_bills    189 rows, 95 of them open (78 unpaid,
                                   17 partially paid), Rs 44,08,192 outstanding
                                   acceptance_date    recorded on 0
    staging.ganit_expenses        378 rows
                                   vendor_id          recorded on 0
                                   tds_amount         recorded on 0
    staging.ganit_invoices        787 rows
                                   irn                recorded on 0
    staging.ganit_vendor_payments   1 row in the entire database

There is also NO WRITE PATH for any of them. No screen in this product sets an
enterprise class, an acceptance date, a nature-of-payment section or an IRN, so
these columns do not fill in over time — they stay empty until somebody builds
the form.

So every handler here reports its DENOMINATOR and refuses to present an empty
column as a clean result. `check_msme_payment_clock` against the live data today
returns `bills_in_scope: 0` next to `vendors_total: 80` and
`enterprise_class_recorded: 0`, and its first limitation says the check could not
be run. It does NOT return "no MSME exposure", because an org with no MSME vendor
RECORDED is not an org with no MSME exposure, and on a statutory matter a false
all-clear is the worst output in the catalogue.

`counts` therefore always carries a `could_not_check` alongside the finding
counts, and the two are never allowed to collapse into one number.

── AND THE STATUTE CALENDAR IS SHORT TOO ────────────────────────────────────

Not one day-count, section number or threshold below is a literal. Verified live
2026-08-20:

    msme.payment_disallowance        SEEDED, both versions — s.43B(h) until
                                     1 Apr 2026 and s.37(2)(g) from it. The row
                                     itself says window_days is deliberately
                                     NULL: "the MSME payment window itself (45
                                     days with an agreement, 15 without) is NOT
                                     seeded — it was not verified tonight, so
                                     window_days is NULL rather than a plausible
                                     number."
    msme.payment_window.no_agreement MISSING — the shorter leg.
    msme.payment_window.agreed_max   MISSING — the ceiling on an agreed term.
    gst.einvoice.threshold           SEEDED — Rs 5,00,00,000, rule 48(4).
    gst.einvoice.reporting_window    MISSING — the window that makes the two
                                     alert days what they are.
    tds.threshold.<section>          MISSING for every section. Nothing in the
                                     calendar carries a nature-of-payment
                                     threshold at all.

Where a fact is missing the handler says so on the output and computes nothing
downstream of it. `check_msme_payment_clock` lists the eligible open bills with a
plain age in days and REFUSES to call any of them a breach; it does not reach for
15 and 45 from memory. That is the whole reason services/statute.py exists, and
printing a day-count from memory is exactly what `services/statement_pdf.py:54`
does today (`MSME_DEFAULT_DAYS = 45`, next to a hardcoded "section 43B(h)" with
no date behind it).

── LIVE FIGURES, ALL THREE ORGS, READ-ONLY 2026-08-20 ───────────────────────

Every figure below came out of the handlers themselves, run against the live
database, and every one of the nine runs survived `json.dumps(out, default=str)`.

  #49  verdict `could_not_check` in ALL THREE orgs.
       Aekam Inc      0 of  2 vendors classed ·  3 open bills, Rs    59,644
       E2E Test       0 of 63 vendors classed · 80 open bills, Rs 36,17,758
       Unicode Group  0 of 15 vendors classed · 12 open bills, Rs  7,30,790
       `bills_in_scope` 0 everywhere, `could_not_check` 2 / 63 / 15 — the
       denominator sitting beside the zero so they cannot be confused.
       `clock_could_be_run` FALSE in all three: neither window key is seeded.
       Section resolved as of 2026-08-20 is s.37(2)(g), NOT s.43B(h).

  #50  FY 2026-27. `tds_section` recorded on 0 of 80 vendors, `vendor_id` on 0
       of 144 expenses in the year, `tds_amount` on 0 of them.
       Aekam Inc       2 vendors with activity, all 2 unattributed
       E2E Test       56 vendors with activity, all 56 unattributed
       Unicode Group   9 vendors with activity, all  9 unattributed
       `crossed` 0 everywhere, and `could_not_check` equals the entire
       population that had any activity at all.

  #51  Aekam Inc      not_established — Rs 2,64,130 visible against Rs 5 crore
                      1 B2B document examined, 5 with no recipient GSTIN
       E2E Test       INSIDE — Rs 7,04,38,000 in FY 2025-26 clears the
                      threshold. 692 documents, 0 with an IRN, 97 drafts
                      excluded, 144 with no recipient GSTIN, 200 examined and
                      `was_capped` TRUE
       Unicode Group  not_established — Rs 30,10,900 visible. 44 examined,
                      13 future-dated excluded, 5 drafts excluded
       `clock_could_be_run` FALSE in all three: the window key is not seeded,
       so nothing is aged and `not_aged` carries the whole examined set.

── WHAT EACH ONE WILL DO ON THE DAY THE DATA ARRIVES ────────────────────────

Nothing here is a stub. Every code path that classifies a bill, attributes a
section or ages a document is written and tested against fixture rows that carry
the facts. The day a vendor screen writes `enterprise_class` and the CTO seeds
the two window keys, #49 starts returning breaches without a line changing.
"""
import logging
import re
from datetime import date, datetime, timedelta

from services.statute import obligation, fy_bounds, statute_note, fy_of
from services.skills.reachable import reachable
from services.skills.timeutil import as_date, days_between, utc_now

log = logging.getLogger(__name__)

#: The enterprise classes the disallowance covers. MEDIUM IS DELIBERATELY NOT
#: HERE. A medium enterprise is Udyam-registered and `is_msme` is true of it,
#: which is exactly why a skill must test the CLASS and not the flag — testing
#: `is_msme` would sweep every medium supplier into a tax finding that does not
#: apply to them.
COVERED_CLASSES = ("micro", "small")

#: The kind the section does not reach. NULL is NOT this: "nobody has said" is
#: not "trader", so a vendor with no recorded kind stays in scope and is counted
#: separately so the reader knows which rows rest on an assumption.
EXCLUDED_KIND = "trader"

#: How much notice an e-invoice alert gives before the portal shuts. Seven days,
#: which is what turns a 30-day window into the folio's "day 23 and day 30" —
#: DERIVED, so that a window seeded as anything other than 30 moves the first
#: alert with it instead of leaving a stale 23 behind.
ALERT_LEAD_DAYS = 7

#: Bill statuses that mean money is still owed. `paid` is the only other value
#: in the live table (94 paid, 78 unpaid, 17 partially_paid on 2026-08-20).
OPEN_BILL_STATUSES = ("unpaid", "partially_paid")

#: Warn when a vendor's year-to-date credit reaches this share of a section
#: threshold. #50 is named for the run BEFORE the crossing: once the threshold
#: is passed, tax is due on the whole year's payments and not on the excess, so
#: the useful alert is the one that arrives while there is still a payment left
#: to deduct from.
NEAR_THRESHOLD_RATIO = 0.90

#: The obligation whose SECTION NUMBER this prints. Two versions are seeded and
#: the handler resolves by date: s.43B(h) of the Income-tax Act 1961 until
#: 1 April 2026, s.37(2)(g) of the Income-tax Act 2025 from it. Never a literal.
MSME_SECTION_KEY = "msme.payment_disallowance"

#: The two day-counts the split needs. NEITHER IS SEEDED. Two keys and not one
#: because they are two different facts — the statutory default where nothing
#: was agreed, and the ceiling on what may be agreed — and one calendar row
#: carries one `window_days`.
MSME_WINDOW_NO_AGREEMENT_KEY = "msme.payment_window.no_agreement"
MSME_WINDOW_AGREED_MAX_KEY = "msme.payment_window.agreed_max"

#: Applicability, seeded. The reporting window, not seeded.
EINVOICE_THRESHOLD_KEY = "gst.einvoice.threshold"
EINVOICE_WINDOW_KEY = "gst.einvoice.reporting_window"

#: Prefix for a nature-of-payment threshold. No key of this shape exists for any
#: section, so the handler builds the key it WOULD ask for and reports the miss
#: BY NAME, which is what lets the CTO seed exactly the rows the live data needs
#: rather than guessing at a list.
TDS_THRESHOLD_PREFIX = "tds.threshold."


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg hands back Decimal for numeric and this
    output goes through json.dumps."""
    return default if value is None else float(value)


def _i(value):
    """int | None, without turning a missing statutory day-count into a zero.

    A zero window would silently make every open bill a breach on the day it was
    raised, which is the loudest possible way to be wrong.
    """
    return None if value is None else int(value)


def _n(row, key, default=0) -> int:
    """An integer out of an asyncpg Record or a dict that may be None.

    `fetchrow` returns None for a query that matched nothing — which happens for
    an org with no vendors — and a count that silently became None would render
    as an empty cell next to a finding count of 0, i.e. exactly the collapse of
    "nothing" into "nothing wrong" that this module exists to avoid.
    """
    if row is None:
        return default
    try:
        value = row[key]
    except (KeyError, IndexError):
        return default
    return default if value is None else int(value)


def _as_of(value, fallback: date) -> date:
    """A caller's *as_at* as a real date, whatever shape it arrived in.

    ── WHY THIS IS NOT JUST `as_date(value) or today` ───────────────────────

    `timeutil.as_date` handles a date and a datetime and returns None for
    EVERYTHING ELSE, strings included — which is right for a NULL database
    column and silently wrong for a caller's parameter. `as_at` reaches a
    scheduled handler as a STRING, so `as_date(as_at) or utc_now().date()`
    parses nothing, discards the caller's date and answers as of today without
    saying so. Written that way here first, and caught only because the test
    asked for 31 March and got the section that came in on 1 April.

    That is the exact failure services/statute.py exists to prevent, arriving
    through the front door: the handler would have printed a correctly resolved
    section for the WRONG DATE, which is indistinguishable from a right answer.

    An unparseable string falls back rather than raising — a scheduled run must
    not die on a bad parameter — but a parseable one is honoured.
    """
    parsed = as_date(value)
    if parsed is not None:
        return parsed
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.strip()).date()
        except ValueError:
            log.warning("vendor_compliance: unparseable as_at %r, using %s",
                        value, fallback)
    return fallback


#: THE FINANCIAL YEAR IS `services.statute.fy_of`, THE INVERSE OF `fy_bounds`,
#: WHICH THIS FILE ALREADY IMPORTS. Three modules restated it; an off-by-one in
#: any one of them reports the wrong year's turnover against a threshold and
#: raises nothing.
_fy_of = fy_of


#: THE CITATION LIVES IN `services.statute` AND IS IMPORTED, NOT RESTATED.
#: This file held one of FIVE copies of it until 2026-09-03, and they had
#: already drifted: `firm_flow`'s appended `or row.get("authority")`, which
#: prints the routing slug `income_tax` where a section reference belongs. The
#: module that owns the table owns how a row from it is cited.
_statute_note = statute_note


#: A leading section marker, dropped before the number. `s`, `sec` and `section`
#: only, and only immediately before a DIGIT — so 's.194C' and 'section 194C'
#: both reduce to '194c' while a section that genuinely begins with a letter is
#: left alone.
_SECTION_PREFIX_RE = re.compile(r"^(?:section|sec|s)(?=\d)")


def _section_key(section: str) -> str:
    """'194C' / 's.194C' / '194 C' / 'Section 194C' -> 'tds.threshold.194c'.

    Free text in, because `ganit_vendors.tds_section` is free text by design —
    migration 175 says so explicitly, since the Income-tax Act 2025 renumbered
    the sections and the numbers belong in the calendar rather than in a CHECK
    on the vendor table.

    Normalising matters more than it looks. Two spellings of ONE section would
    otherwise become two different keys: one of them might resolve to a seeded
    threshold and the other silently would not, so the same vendor population
    would split across `crossed` and `section_recorded_but_no_threshold` on
    nothing but a typist's habit. Dropping the `s.` was missed on the first
    pass, and the test that caught it is the one asserting three spellings
    resolve to one key.
    """
    cleaned = "".join(ch for ch in (section or "").lower() if ch.isalnum())
    return TDS_THRESHOLD_PREFIX + _SECTION_PREFIX_RE.sub("", cleaned)


#: The customer name, joined the only way this database permits. `AND
#: x.org_id = i.org_id` on BOTH joins: the foreign keys are on the id alone, and
#: an id-only join has been proved live to print another practice's customer.
_CUSTOMER_NAME = """
               COALESCE(NULLIF(btrim(cl.name), ''),
                        NULLIF(btrim(ct.company), ''),
                        NULLIF(btrim(ct.name), ''),
                        '(customer not recorded)') AS customer"""

_CUSTOMER_JOIN = """
        LEFT JOIN public.graha_clients cl
               ON cl.id = i.client_id AND cl.org_id = i.org_id
        LEFT JOIN public.graha_contacts ct
               ON ct.id = i.contact_id AND ct.org_id = i.org_id"""

_RECIPIENT_GSTIN = (
    "COALESCE(NULLIF(btrim(cl.gstin), ''), NULLIF(btrim(ct.gstin), ''))"
)


# ══════════════════════════════════════════════════════════════════════════
# 49 · check_msme_payment_clock
# ══════════════════════════════════════════════════════════════════════════

async def check_msme_payment_clock(
    pool, org_id: str, as_at: str | None = None, limit: int = 200,
) -> dict:
    """Unpaid bills of micro and small suppliers against the statutory clock.

    *as_at* is 'YYYY-MM-DD' and defaults to today, because the clock this runs is
    the calendar's and not a period's. It has to default or the dispatcher
    refuses every scheduled run.

    ── THE FOUR TESTS, AND WHY NONE OF THEM IS `is_msme` ────────────────────

    (a) CLASS, NOT THE FLAG. The disallowance reaches micro and small
        enterprises. A MEDIUM enterprise is Udyam-registered, `is_msme` is true
        of it, and it is OUTSIDE the section. So the gate is
        `enterprise_class IN ('micro','small')`, and `is_msme = FALSE` only ever
        excludes — it never admits. A skill that tested the flag would put every
        medium supplier into a tax finding that does not apply to them.

    (b) NOT TRADERS. `vendor_kind = 'trader'` is out. NULL is not out: "nobody
        has said" is not "trader", so an unrecorded kind stays in scope and is
        counted as `kind_not_recorded` so the reader knows which of the listed
        bills rest on an assumption.

    (c) THE CLOCK STARTS AT ACCEPTANCE. `acceptance_date` where present, the
        bill date only as a fallback, and WHICH ONE WAS USED IS ON EVERY ROW.
        Acceptance is on or after the bill date, so using the bill date makes
        the deadline earlier and reports a breach that has not happened yet. On
        the live data `acceptance_date` is recorded on 0 of 189 bills, so every
        row today says `clock_started_from: "bill_date (fallback)"`.

    (d) THE SECTION HAS A DATE ON IT. s.43B(h) of the Income-tax Act 1961 became
        s.37(2)(g) of the Income-tax Act 2025 on 1 April 2026. Both versions are
        seeded; this resolves against *as_at* and prints neither from memory.

    ── WHY IT WILL NOT CLASSIFY A BREACH TODAY ──────────────────────────────

    The two legs of the split are NOT in the statute calendar — the seeded
    disallowance row says so in its own note. Without them this handler ages the
    eligible bills in plain days and stops: no deadline, no breach, no add-back.
    `clock_could_be_run` is False and the reason is the first limitation.

    Ageing a bill is arithmetic. Calling it a breach is a statement about the
    law, and there is no law in the table to make it with.

    Note the asymmetry that makes an agreed term unusable on its own: without
    the statutory ceiling, a vendor whose recorded terms say 90 days would come
    back INSIDE the window on day 60. That is a false all-clear on a tax matter,
    so both keys are required rather than either.

    ── THE ADD-BACK IS TWO NUMBERS, NOT ONE ─────────────────────────────────

    What is disallowed is the DEDUCTION — the expenditure claimed — and GST the
    firm took credit for was never a deduction. So the taxable value (`subtotal`)
    is the closer figure and the outstanding balance (which carries the tax) is
    the larger, and both are reported under their own names. This cannot see
    which bills were claimed as revenue expenditure and which were capitalised,
    so both are ceilings and say so.
    """
    today = _as_of(as_at, utc_now().date())
    cap = max(1, int(limit))

    section = await obligation(pool, MSME_SECTION_KEY, as_of=today)
    no_agreement = await obligation(pool, MSME_WINDOW_NO_AGREEMENT_KEY, as_of=today)
    agreed_max = await obligation(pool, MSME_WINDOW_AGREED_MAX_KEY, as_of=today)

    # A window may also arrive on the disallowance row itself. Read it rather
    # than ignore it: seeding one existing row is a likelier fix than three.
    default_days = _i((no_agreement or {}).get("window_days"))
    if default_days is None:
        default_days = _i((section or {}).get("window_days"))
    ceiling_days = _i((agreed_max or {}).get("window_days"))
    clock_could_be_run = default_days is not None and ceiling_days is not None

    facts = await pool.fetchrow(
        """
        SELECT count(*)                                              AS vendors_total,
               count(*) FILTER (WHERE is_active)                     AS vendors_active,
               count(*) FILTER (WHERE is_msme IS NOT NULL)           AS is_msme_recorded,
               count(*) FILTER (WHERE enterprise_class IS NOT NULL)  AS class_recorded,
               count(*) FILTER (WHERE enterprise_class = ANY($2::text[]))
                                                                     AS micro_or_small,
               count(*) FILTER (WHERE enterprise_class = 'medium')   AS medium_out_of_scope,
               count(*) FILTER (WHERE vendor_kind IS NOT NULL)       AS kind_recorded,
               count(*) FILTER (WHERE vendor_kind = $3::text)        AS traders_out_of_scope,
               count(*) FILTER (WHERE payment_terms_days IS NOT NULL) AS terms_recorded,
               count(*) FILTER (WHERE udyam_number IS NOT NULL
                                  AND btrim(udyam_number) <> '')     AS udyam_recorded
        FROM public.ganit_vendors
        WHERE org_id = $1::uuid
        """,
        org_id, list(COVERED_CLASSES), EXCLUDED_KIND,
    )

    bills = await pool.fetchrow(
        """
        SELECT count(*)                                              AS open_bills,
               COALESCE(SUM(b.total - COALESCE(b.amount_paid, 0)), 0) AS open_balance,
               count(*) FILTER (WHERE b.vendor_id IS NULL)           AS no_vendor,
               count(*) FILTER (WHERE b.acceptance_date IS NOT NULL) AS acceptance_recorded
        FROM public.ganit_vendor_bills b
        WHERE b.org_id = $1::uuid
          AND b.is_active
          AND b.status = ANY($2::text[])
        """,
        org_id, list(OPEN_BILL_STATUSES),
    )

    rows = await pool.fetch(
        """
        SELECT b.id, b.bill_number, b.bill_date, b.acceptance_date, b.due_date,
               b.subtotal, b.total, b.amount_paid, b.status,
               v.name AS vendor, v.enterprise_class, v.vendor_kind,
               v.id AS vendor_id, NULLIF(btrim(v.email), '') AS vendor_email,
               NULLIF(btrim(v.phone), '') AS vendor_phone,
               v.payment_terms_days, v.udyam_number, v.is_msme
        FROM public.ganit_vendor_bills b
        JOIN public.ganit_vendors v
          ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active
          AND b.status = ANY($2::text[])
          AND v.enterprise_class = ANY($3::text[])
          AND COALESCE(v.is_msme, TRUE)
          AND v.vendor_kind IS DISTINCT FROM $4::text
        ORDER BY COALESCE(b.acceptance_date, b.bill_date), b.bill_number
        LIMIT $5::int
        """,
        org_id, list(OPEN_BILL_STATUSES), list(COVERED_CLASSES), EXCLUDED_KIND, cap,
    )

    breached, within, unclassified = [], [], []
    kind_unknown = 0
    for r in rows:
        started_at = as_date(r["acceptance_date"]) or as_date(r["bill_date"])
        terms = _i(r["payment_terms_days"])
        if r["vendor_kind"] is None:
            kind_unknown += 1

        # NULL terms is the shorter leg — migration 175's own words: "NULL means
        # no agreement recorded, i.e. the 15-day leg". An agreed term is capped
        # by the statutory ceiling, and without the ceiling nothing is computed.
        if clock_could_be_run and started_at is not None:
            window = default_days if terms is None else min(terms, ceiling_days)
            deadline = started_at + timedelta(days=window)
            over = days_between(today, deadline)
        else:
            window, deadline, over = None, None, None

        entry = reachable({
            "bill_id": str(r["id"]),
            "bill": r["bill_number"],
            "vendor": r["vendor"],
            "enterprise_class": r["enterprise_class"],
            "vendor_kind": r["vendor_kind"] or "(not recorded)",
            "udyam_number": r["udyam_number"],
            "bill_date": as_date(r["bill_date"]),
            "acceptance_date": as_date(r["acceptance_date"]),
            "clock_started_from": (
                "acceptance_date" if r["acceptance_date"] else "bill_date (fallback)"),
            "clock_started_on": started_at,
            "age_in_days": days_between(today, started_at) if started_at else None,
            "agreed_terms_days": terms,
            "window_applied_days": window,
            "leg": None if window is None else (
                "no written agreement recorded"
                if terms is None else
                "written agreement, capped at the statutory ceiling"),
            "pay_by": deadline,
            "days_past_the_window": over,
            "outstanding_including_tax": round(_f(r["total"]) - _f(r["amount_paid"]), 2),
            "taxable_value": _f(r["subtotal"]),
            "status": r["status"],
        }, kind="vendor", entity_id=r["vendor_id"],
            email=r["vendor_email"], phone=r["vendor_phone"])

        if over is None:
            entry["not_classified_because"] = (
                "the statutory window is not in the calendar"
                if not clock_could_be_run else
                "this bill carries neither an acceptance date nor a bill date")
            unclassified.append(entry)
        elif over > 0:
            breached.append(entry)
        else:
            within.append(entry)

    in_scope = len(rows)
    vendors_total = _n(facts, "vendors_total")
    class_recorded = _n(facts, "class_recorded")
    acceptance_recorded = _n(bills, "acceptance_recorded")
    missing_keys = [
        key for key, value in ((MSME_WINDOW_NO_AGREEMENT_KEY, default_days),
                               (MSME_WINDOW_AGREED_MAX_KEY, ceiling_days))
        if value is None
    ]

    limitations: list[str] = []
    if not clock_could_be_run:
        limitations.append(
            "THE CLOCK WAS NOT RUN. The statute calendar carries no day-count "
            f"for {' and '.join(missing_keys)} as of {today}, so no deadline and "
            "no breach could be computed and every bill below is UNCLASSIFIED, "
            "aged in plain days only. This is a gap in the calendar, NOT a clean "
            "payables ledger.")
    if not section:
        limitations.append(
            f"The statute calendar records no {MSME_SECTION_KEY} as of {today}, "
            "so no section reference is shown. None is printed from memory.")
    if class_recorded == 0:
        limitations.append(
            f"NO VENDOR HAS AN ENTERPRISE CLASS RECORDED — 0 of {vendors_total}. "
            "Nothing in this product writes `ganit_vendors.enterprise_class`, so "
            "the column is empty on every row and no vendor can enter scope. AN "
            "ORG WITH NO MSME VENDOR RECORDED IS NOT AN ORG WITH NO MSME "
            "EXPOSURE. A vendor screen capturing Udyam number, enterprise class "
            "and trader/manufacturer/service is what turns this from a skipped "
            "check into an answer.")
    elif in_scope == 0:
        limitations.append(
            f"{class_recorded} of {vendors_total} vendors carry an enterprise "
            "class and none of the micro or small ones has an open bill. That is "
            "a real result for the vendors that ARE recorded and says nothing "
            "about the ones that are not.")
    if acceptance_recorded == 0:
        limitations.append(
            "NO BILL CARRIES AN ACCEPTANCE DATE, so every clock above starts at "
            "the bill date. Acceptance is on or after the bill date, so this "
            "errs EARLY: a deadline shown here is the earliest it could be, "
            "never the latest, and a breach shown here may not have happened.")
    if kind_unknown:
        limitations.append(
            f"{kind_unknown} of the listed bills belong to a vendor with no "
            "recorded trader/manufacturer/service kind. The section does not "
            "reach traders, so those rows are provisional — an unrecorded kind "
            "is not a trader, and it is not a manufacturer either.")
    limitations.extend([
        "The add-back figures are CEILINGS. What is disallowed is the deduction "
        "claimed, and this cannot see which bills were claimed as revenue "
        "expenditure and which were capitalised, nor whether the tax on them was "
        "taken as input credit rather than expensed.",
        f"{_n(bills, 'no_vendor')} of {_n(bills, 'open_bills')} open bills carry "
        "no vendor link at all and could not be tested against anything.",
        "Only bills raised in this product are read. A payable entered in "
        "somebody's spreadsheet or accounting package is invisible here.",
        "A bill's status is the authority for 'unpaid'. `ganit_vendor_payments` "
        "holds ONE row in the whole database, so the date money left cannot be "
        "read for almost any bill and no bill is aged from a payment.",
    ])

    return {
        "as_at": today,
        # `checked` only when the law and the facts were both present. Anything
        # else is `could_not_check`, and it is the FIRST thing after the date so
        # that a reader who stops there cannot mistake an empty finding list for
        # a clean payables ledger.
        "verdict": "checked" if (clock_could_be_run and class_recorded)
                   else "could_not_check",
        "section": (section or {}).get("section_ref"),
        "statute": _statute_note(section, "MSME payment disallowance"),
        "section_resolved_as_of": today,
        "clock_could_be_run": clock_could_be_run,
        "window_no_agreement_days": default_days,
        "window_agreed_ceiling_days": ceiling_days,
        "statute_keys_missing": missing_keys,
        "counts": {
            "vendors_total": vendors_total,
            "vendors_active": _n(facts, "vendors_active"),
            "enterprise_class_recorded": class_recorded,
            "is_msme_recorded": _n(facts, "is_msme_recorded"),
            "udyam_number_recorded": _n(facts, "udyam_recorded"),
            "vendor_kind_recorded": _n(facts, "kind_recorded"),
            "payment_terms_recorded": _n(facts, "terms_recorded"),
            "micro_or_small": _n(facts, "micro_or_small"),
            "medium_out_of_scope": _n(facts, "medium_out_of_scope"),
            "traders_out_of_scope": _n(facts, "traders_out_of_scope"),
            "open_bills_total": _n(bills, "open_bills"),
            "open_balance_total": round(_f(bills["open_balance"] if bills else None), 2),
            "open_bills_with_no_vendor_link": _n(bills, "no_vendor"),
            "acceptance_date_recorded": acceptance_recorded,
            "bills_in_scope": in_scope,
            "bills_past_the_window": len(breached),
            "bills_inside_the_window": len(within),
            "bills_not_classified": len(unclassified),
            "kind_not_recorded": kind_unknown,
            # THE NUMBER THAT STOPS AN EMPTY COLUMN READING AS A CLEAN RESULT.
            # Vendors whose MSME status nobody has recorded: they were not found
            # to be outside the section, they were never tested against it. On
            # the live data this equals `vendors_total` in every org, sitting
            # next to `bills_past_the_window: 0`, so the two cannot be confused.
            "could_not_check": vendors_total - class_recorded,
            "capped_at": cap,
            "was_capped": in_scope >= cap,
        },
        "amount_at_risk": {
            "outstanding_including_tax": round(
                sum(e["outstanding_including_tax"] for e in breached), 2),
            "taxable_value_of_breached_bills": round(
                sum(e["taxable_value"] for e in breached), 2),
            "basis": "a ceiling, not a computed add-back — see limitations",
        },
        "past_the_window": breached,
        "inside_the_window": within,
        "not_classified": unclassified,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 50 · check_tds_thresholds
# ══════════════════════════════════════════════════════════════════════════

async def check_tds_thresholds(
    pool, org_id: str, financial_year: str | None = None, limit: int = 200,
) -> dict:
    """Year-to-date credited per vendor, against the section threshold — where a
    section is recorded and where the calendar carries a threshold for it.

    *financial_year* is '2026-27' and defaults to the year containing today,
    because a threshold is a running total and the year in progress is the one
    that can still be acted on.

    ── CREDITED, NOT PAID: THE LAW AND THE DATA AGREEING ────────────────────

    The sections bite on the amount PAID OR CREDITED, whichever is earlier, so
    the bill is the earlier event and the right one to accumulate. It is also the
    only one this database can date: `ganit_vendor_bills.amount_paid` says how
    much of a bill was settled but not WHEN, and `ganit_vendor_payments` — the
    one table carrying a payment date — holds a single row across all three orgs.
    So the running total is what was CREDITED in the year, `paid_in_year` sits
    beside it, and the gap between them is stated rather than smoothed over.

    The base is the TAXABLE VALUE, not the document total: where GST is shown
    separately it does not enter the threshold. Both are returned.

    ── WHICH SECTION IT TRIPS IS THE PART THAT IS BLOCKED ───────────────────

    A section is attributed ONLY from `ganit_vendors.tds_section`, which is NULL
    on all 80 live vendors. There is no inference from expense category, vendor
    name or amount — guessing a contract section because a vendor is called
    "Printers" would put a wrong section on a compliance report, and a wrong
    section is worse than none. Every vendor with no recorded section is counted
    in `vendors_with_no_section` and listed under `unattributed`, loudly, because
    an unattributed vendor is NOT a vendor below the threshold.

    And even a recorded section resolves to nothing today: the calendar carries
    NO key of the form `tds.threshold.<section>` for any section at all. Those
    vendors come back under `section_recorded_but_no_threshold` with their
    running total and no verdict.
    """
    today = utc_now().date()
    fy = financial_year or _fy_of(today)
    fy_start, fy_end = fy_bounds(fy)
    cap = max(1, int(limit))

    facts = await pool.fetchrow(
        """
        SELECT count(*) AS vendors_total,
               count(*) FILTER (WHERE tds_section IS NOT NULL
                                  AND btrim(tds_section) <> '') AS section_recorded
        FROM public.ganit_vendors
        WHERE org_id = $1::uuid
        """,
        org_id,
    )

    expense_facts = await pool.fetchrow(
        """
        SELECT count(*)                                       AS expenses_in_year,
               count(*) FILTER (WHERE vendor_id IS NOT NULL)  AS linked_to_a_vendor,
               count(*) FILTER (WHERE tds_amount IS NOT NULL) AS tds_amount_recorded,
               COALESCE(SUM(tds_amount), 0)                   AS tds_recorded_total
        FROM public.ganit_expenses
        WHERE org_id = $1::uuid
          AND is_active
          AND expense_date >= $2::date
          AND expense_date <= $3::date
        """,
        org_id, fy_start, fy_end,
    )

    rows = await pool.fetch(
        """
        WITH billed AS (
            SELECT b.vendor_id,
                   COALESCE(SUM(b.subtotal), 0) AS taxable,
                   COALESCE(SUM(b.total), 0)    AS gross,
                   count(*)                     AS documents
            FROM public.ganit_vendor_bills b
            WHERE b.org_id = $1::uuid
              AND b.is_active
              AND b.vendor_id IS NOT NULL
              AND b.bill_date >= $2::date
              AND b.bill_date <= $3::date
            GROUP BY b.vendor_id
        ),
        spent AS (
            SELECT e.vendor_id,
                   COALESCE(SUM(e.amount), 0)     AS taxable,
                   COALESCE(SUM(e.total), 0)      AS gross,
                   COALESCE(SUM(e.tds_amount), 0) AS tds,
                   count(*)                       AS documents,
                   count(*) FILTER (WHERE e.tds_amount IS NULL) AS tds_not_recorded
            FROM public.ganit_expenses e
            WHERE e.org_id = $1::uuid
              AND e.is_active
              AND e.vendor_id IS NOT NULL
              AND e.expense_date >= $2::date
              AND e.expense_date <= $3::date
            GROUP BY e.vendor_id
        ),
        settled AS (
            SELECT b.vendor_id, COALESCE(SUM(p.amount), 0) AS amount
            FROM public.ganit_vendor_payments p
            JOIN public.ganit_vendor_bills b
              ON b.id = p.bill_id AND b.org_id = p.org_id
            WHERE p.org_id = $1::uuid
              AND b.vendor_id IS NOT NULL
              AND p.payment_date >= $2::date
              AND p.payment_date <= $3::date
            GROUP BY b.vendor_id
        )
        SELECT v.id, v.name, v.tds_section,
               NULLIF(btrim(v.email), '') AS vendor_email,
               NULLIF(btrim(v.phone), '') AS vendor_phone,
               COALESCE(billed.taxable, 0)   + COALESCE(spent.taxable, 0)   AS taxable,
               COALESCE(billed.gross, 0)     + COALESCE(spent.gross, 0)     AS gross,
               COALESCE(billed.documents, 0) + COALESCE(spent.documents, 0) AS documents,
               COALESCE(spent.tds, 0)              AS tds_deducted,
               COALESCE(spent.tds_not_recorded, 0) AS tds_not_recorded,
               COALESCE(settled.amount, 0)         AS paid_in_year
        FROM public.ganit_vendors v
        LEFT JOIN billed  ON billed.vendor_id  = v.id
        LEFT JOIN spent   ON spent.vendor_id   = v.id
        LEFT JOIN settled ON settled.vendor_id = v.id
        WHERE v.org_id = $1::uuid
          AND (billed.vendor_id IS NOT NULL OR spent.vendor_id IS NOT NULL)
        ORDER BY (COALESCE(billed.taxable, 0) + COALESCE(spent.taxable, 0)) DESC,
                 v.name
        LIMIT $4::int
        """,
        org_id, fy_start, fy_end, cap,
    )

    # One calendar lookup per DISTINCT recorded section, resolved as of the YEAR
    # END — the date the obligation for this year finally arises. Not as of
    # today: a section renumbered on 1 April must not be read off the run date.
    sections = sorted({
        (r["tds_section"] or "").strip()
        for r in rows if (r["tds_section"] or "").strip()
    })
    thresholds: dict[str, dict | None] = {}
    for name in sections:
        thresholds[name] = await obligation(pool, _section_key(name), as_of=fy_end)

    crossed, approaching, below, no_threshold, unattributed = [], [], [], [], []
    for r in rows:
        section = (r["tds_section"] or "").strip()
        taxable = _f(r["taxable"])
        entry = reachable({
            "vendor_id": str(r["id"]),
            # The year an acknowledgement is filed against. Every running total
            # below restarts on 1 April, so without it a finding acknowledged in
            # March would stay silenced through the whole of the next year — see
            # `services/skill_ack_wiring.py`.
            "financial_year": fy,
            "vendor": r["name"],
            "section": section or None,
            "credited_taxable_value": round(taxable, 2),
            "credited_including_tax": round(_f(r["gross"]), 2),
            "paid_in_year": round(_f(r["paid_in_year"]), 2),
            "documents": int(r["documents"]),
            "tds_recorded": round(_f(r["tds_deducted"]), 2),
            "documents_with_no_tds_recorded": int(r["tds_not_recorded"]),
        }, kind="vendor", entity_id=r["id"],
            email=r["vendor_email"], phone=r["vendor_phone"])
        if not section:
            entry["why"] = (
                "no nature-of-payment section is recorded against this vendor, "
                "so no threshold applies to it and NOTHING was checked")
            unattributed.append(entry)
            continue

        rule = thresholds.get(section)
        limit_amount = None if not rule else rule.get("threshold_amount")
        if limit_amount is None:
            entry["statute_key_asked_for"] = _section_key(section)
            entry["why"] = (
                "the statute calendar carries no threshold for this section, so "
                "the running total is reported without a verdict")
            no_threshold.append(entry)
            continue

        ceiling = float(limit_amount)
        entry["threshold"] = round(ceiling, 2)
        entry["statute"] = _statute_note(rule, f"threshold for {section}")
        entry["headroom"] = round(ceiling - taxable, 2)
        if taxable >= ceiling:
            crossed.append(entry)
        elif ceiling > 0 and taxable >= ceiling * NEAR_THRESHOLD_RATIO:
            approaching.append(entry)
        else:
            below.append(entry)

    vendors_total = _n(facts, "vendors_total")
    section_recorded = _n(facts, "section_recorded")
    missing_keys = sorted({
        _section_key(s) for s in sections
        if not (thresholds.get(s) or {}).get("threshold_amount")
    })

    limitations: list[str] = []
    if section_recorded == 0:
        limitations.append(
            "NO VENDOR HAS A NATURE-OF-PAYMENT SECTION RECORDED — 0 of "
            f"{vendors_total}. Nothing in this product writes "
            "`ganit_vendors.tds_section`, so NOT ONE running total below could "
            "be attributed to a section and NOTHING was tested against any "
            "threshold. Unattributed is not below-the-threshold: these vendors "
            "were listed, not checked.")
    if missing_keys:
        limitations.append(
            "The statute calendar carries no threshold for "
            f"{', '.join(missing_keys)}. Those vendors are listed with their "
            "running total and NO verdict. Ask for the keys to be seeded rather "
            "than reading a threshold from memory.")
    if not sections:
        limitations.append(
            "No section was attributable in this run, so no `tds.threshold.*` "
            "key was even looked up. As of 2026-08-20 the calendar carries no "
            "key of that shape for any section, so a recorded section would "
            "have resolved to nothing anyway.")
    limitations.extend([
        "The running total is what was CREDITED in the year — bills raised and "
        "expenses booked. That is the correct base (paid or credited, whichever "
        "is earlier) and it is also the only one this database can date: "
        "`ganit_vendor_bills.amount_paid` carries no date, and "
        "`ganit_vendor_payments` holds one row in the entire database, so "
        "`paid_in_year` is near-empty BY CONSTRUCTION and must never be read as "
        "'this vendor was not paid'.",
        "The threshold base is the taxable value, excluding GST shown "
        "separately. `credited_including_tax` sits beside it for reconciliation "
        "and is NOT the figure a threshold is tested on.",
        f"Expenses in {fy}: {_n(expense_facts, 'linked_to_a_vendor')} of "
        f"{_n(expense_facts, 'expenses_in_year')} carry a vendor link, so "
        "unlinked expense spend is in NO vendor's total below. "
        "`ganit_expenses.vendor` is free text and is deliberately not matched by "
        "name — a name match would merge two vendors or split one.",
        "`tds_amount` is NULL on an expense nobody has told, which is different "
        "from 0.00 meaning nothing was deducted. `tds_recorded` counts only what "
        "was actually entered, so a zero there is not evidence of a failure to "
        "deduct.",
        "One section per vendor is an approximation. A vendor supplying both a "
        "works contract and professional services falls under two sections with "
        "two thresholds, and this product records one.",
        "Aggregate and single-payment limits differ by section. Nothing here "
        "distinguishes them, and it cannot until the calendar carries both.",
        "Only this org's own bills and expenses are read. Payments made outside "
        "this product do not appear in any running total.",
    ])

    return {
        "as_at": today,
        # `checked` requires BOTH halves: a section on the vendor and a
        # threshold in the calendar. Neither exists today, so this reads
        # `could_not_check` in every live org — beside a `crossed` count of 0
        # that would otherwise read as an all-clear.
        "verdict": "checked" if not (unattributed or no_threshold)
                   else "could_not_check",
        "financial_year": fy,
        "year_from": fy_start,
        "year_to": fy_end,
        "near_threshold_at": NEAR_THRESHOLD_RATIO,
        "thresholds_resolved_as_of": fy_end,
        "statute_keys_missing": missing_keys,
        "counts": {
            "vendors_total": vendors_total,
            "vendors_with_a_recorded_section": section_recorded,
            "vendors_with_activity_this_year": len(rows),
            "vendors_with_no_section": len(unattributed),
            "crossed": len(crossed),
            "within_the_last_10_percent": len(approaching),
            "below": len(below),
            "section_recorded_but_no_threshold": len(no_threshold),
            "expenses_in_year": _n(expense_facts, "expenses_in_year"),
            "expenses_linked_to_a_vendor": _n(expense_facts, "linked_to_a_vendor"),
            "expenses_with_tds_recorded": _n(expense_facts, "tds_amount_recorded"),
            "tds_recorded_total": round(
                _f(expense_facts["tds_recorded_total"] if expense_facts else None), 2),
            "could_not_check": len(unattributed) + len(no_threshold),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "crossed": crossed,
        "within_the_last_10_percent": approaching,
        "below_the_threshold": below,
        "section_recorded_but_no_threshold": no_threshold,
        "unattributed": unattributed,
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 51 · check_einvoice_window
# ══════════════════════════════════════════════════════════════════════════

async def check_einvoice_window(
    pool, org_id: str, as_at: str | None = None, limit: int = 200,
) -> dict:
    """B2B documents with no IRN, against the window that closes on them.

    *as_at* is 'YYYY-MM-DD' and defaults to today.

    ── THE WINDOW RUNS FROM THE DOCUMENT DATE ───────────────────────────────

    So the two moments worth an alert are the last week of it and its last day —
    day 23 and day 30 on a 30-day window, NOT day 28. Neither number is written
    down here: the window comes from the calendar and the first alert is
    `window - ALERT_LEAD_DAYS`, so a different seeded window moves both together
    instead of leaving a stale 23 behind.

    THE WINDOW IS NOT SEEDED TODAY. `gst.einvoice.reporting_window` does not
    exist, so this reports the documents with no IRN and their plain age and
    refuses to name a deadline. `clock_could_be_run` is False.

    ── APPLICABILITY IS TESTED FIRST, AND CANNOT BE SETTLED ─────────────────

    A NULL `irn` is only a finding for a taxpayer inside the e-invoicing
    threshold, and that turnover is an AGGREGATE PAN-LEVEL figure across every
    registration, exempt supplies included — which this product cannot see. It
    sees one org's invoices, from 1 April 2025 at the earliest.

    So the verdict has THREE values and never two:

      `inside`          the visible turnover ALREADY exceeds the threshold. Safe
                        in one direction only: over is over.
      `not_established` the visible turnover is below it. This is NOT "does not
                        apply". The PAN-level figure is higher by construction,
                        the seeded rule says crossing the threshold in ANY year
                        from 2017-18 keeps you in, and this product holds no
                        year before 2025-26.
      `unknown`         the calendar carries no threshold at all.

    When applicability is not `inside` the documents are STILL LISTED and every
    one is marked `conditional`. Listing nothing would read as a clean result,
    and a firm that crossed the threshold three years ago on a registration this
    product never saw would be told it had no exposure.
    """
    today = _as_of(as_at, utc_now().date())
    cap = max(1, int(limit))

    rule = await obligation(pool, EINVOICE_THRESHOLD_KEY, as_of=today)
    window_rule = await obligation(pool, EINVOICE_WINDOW_KEY, as_of=today)
    window_days = _i((window_rule or {}).get("window_days"))
    if window_days is None:
        window_days = _i((rule or {}).get("window_days"))
    clock_could_be_run = window_days is not None
    first_alert_day = None if window_days is None else max(1, window_days - ALERT_LEAD_DAYS)

    # Turnover per financial year, on the taxable value and net of credit notes.
    # Aggregate turnover excludes the tax, so `subtotal` is the base; `total`
    # would overstate it by the GST on every line and could put an org over a
    # threshold it has not reached.
    years = await pool.fetch(
        """
        SELECT (EXTRACT(YEAR FROM i.invoice_date)::int
                  - CASE WHEN EXTRACT(MONTH FROM i.invoice_date) < 4 THEN 1 ELSE 0 END)
                 AS fy_start,
               SUM(CASE WHEN i.invoice_type = 'credit_note'
                        THEN -COALESCE(i.subtotal, 0)
                        ELSE  COALESCE(i.subtotal, 0) END) AS taxable_value,
               count(*) AS documents
        FROM public.ganit_invoices i
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.invoice_type IN ('tax_invoice', 'credit_note')
        GROUP BY 1
        ORDER BY 1
        """,
        org_id,
    )
    by_year = [
        {
            "financial_year": f"{int(r['fy_start'])}-{str(int(r['fy_start']) + 1)[-2:]}",
            "taxable_value": round(_f(r["taxable_value"]), 2),
            "documents": int(r["documents"]),
        }
        for r in years
    ]
    highest = max((y["taxable_value"] for y in by_year), default=0.0)
    threshold = None if not rule else rule.get("threshold_amount")

    if threshold is None:
        applicability = "unknown"
    elif highest >= float(threshold):
        applicability = "inside"
    else:
        applicability = "not_established"

    counts_row = await pool.fetchrow(
        f"""
        SELECT count(*)                                             AS documents,
               count(*) FILTER (WHERE i.irn IS NOT NULL)            AS with_irn,
               count(*) FILTER (WHERE i.doc_status = 'draft')       AS drafts,
               count(*) FILTER (WHERE i.invoice_date > $2::date)    AS not_yet_dated,
               count(*) FILTER (WHERE COALESCE(i.is_export, FALSE)) AS exports,
               count(*) FILTER (WHERE {_RECIPIENT_GSTIN} IS NULL
                                  AND NOT COALESCE(i.is_export, FALSE)) AS no_recipient_gstin
        FROM public.ganit_invoices i
        {_CUSTOMER_JOIN}
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.invoice_type IN ('tax_invoice', 'credit_note')
        """,
        org_id, today,
    )

    rows = await pool.fetch(
        f"""
        SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.total,
               i.subtotal, i.doc_status, i.is_export, i.irn,
               {_RECIPIENT_GSTIN} AS recipient_gstin,
        {_CUSTOMER_NAME}
        FROM public.ganit_invoices i
        {_CUSTOMER_JOIN}
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.invoice_type IN ('tax_invoice', 'credit_note')
          AND i.irn IS NULL
          AND i.doc_status IS DISTINCT FROM 'draft'
          AND i.invoice_date <= $2::date
          AND ({_RECIPIENT_GSTIN} IS NOT NULL OR COALESCE(i.is_export, FALSE))
        ORDER BY i.invoice_date, i.invoice_number
        LIMIT $3::int
        """,
        org_id, today, cap,
    )

    closed, final_day, closing, still_open, unaged = [], [], [], [], []
    for r in rows:
        raised = as_date(r["invoice_date"])
        deadline = (raised + timedelta(days=window_days)
                    if clock_could_be_run and raised is not None else None)
        days_left = None if deadline is None else days_between(deadline, today)
        entry = {
            "invoice_id": str(r["id"]),
            "document": r["invoice_number"],
            "kind": r["invoice_type"],
            "customer": r["customer"],
            "why_b2b": "export" if r["is_export"] else "recipient GSTIN recorded",
            "invoice_date": raised,
            "age_in_days": days_between(today, raised) if raised else None,
            "report_by": deadline,
            "days_left": days_left,
            "amount": _f(r["total"]),
            "taxable_value": _f(r["subtotal"]),
            "doc_status": r["doc_status"],
            "conditional": applicability != "inside",
        }
        if days_left is None:
            entry["not_aged_because"] = (
                "the reporting window is not in the calendar"
                if not clock_could_be_run else "this document carries no date")
            unaged.append(entry)
        elif days_left < 0:
            closed.append(entry)
        elif days_left == 0:
            final_day.append(entry)
        elif days_left <= ALERT_LEAD_DAYS:
            closing.append(entry)
        else:
            still_open.append(entry)

    documents = _n(counts_row, "documents")
    with_irn = _n(counts_row, "with_irn")

    limitations: list[str] = []
    if not clock_could_be_run:
        limitations.append(
            "THE CLOCK WAS NOT RUN. The statute calendar carries no window for "
            f"{EINVOICE_WINDOW_KEY} as of {today}, so no reporting deadline, no "
            "first-alert day and no permanently-closed list could be computed. "
            "Every document below carries a plain age only. This is a gap in the "
            "calendar, not a clean ledger.")
    if applicability == "not_established":
        limitations.append(
            "APPLICABILITY IS NOT ESTABLISHED, WHICH IS NOT THE SAME AS NOT "
            "APPLICABLE. The highest turnover visible here is "
            f"{highest:,.2f} against a threshold of {float(threshold):,.2f}, but "
            "aggregate turnover is a PAN-LEVEL figure across every registration "
            "including exempt supplies, and the seeded rule says crossing it in "
            "ANY year from 2017-18 keeps you in for good. This product holds no "
            f"invoice before {by_year[0]['financial_year'] if by_year else 'any year'}"
            ". Every document below is therefore marked conditional rather than "
            "hidden.")
    elif applicability == "unknown":
        limitations.append(
            f"The statute calendar records no {EINVOICE_THRESHOLD_KEY} as of "
            f"{today}, so applicability could not be tested at all and the "
            "documents below are listed without a verdict.")
    else:
        limitations.append(
            "Turnover here is a FLOOR. It is built from this org's own invoices "
            "only, while aggregate turnover is PAN-level across every "
            "registration and includes exempt and export supplies. An org that "
            "looks clear may not be; an org that looks over certainly is.")
    limitations.extend([
        f"{with_irn} of {documents} documents carry an IRN. Nothing in this "
        "product writes `ganit_invoices.irn` — there is no IRP integration and "
        "no field on any screen — so a NULL means UNRECORDED, not unreported. A "
        "firm reporting through the portal or through its e-way bill software "
        "will see every document listed here and none of them is proof of a "
        "missed filing.",
        "B2B is inferred from a recipient GSTIN on the client or the contact, "
        f"plus the export flag. {_n(counts_row, 'no_recipient_gstin')} document(s) "
        "have neither and were NOT examined — a genuine B2B sale to a customer "
        "whose GSTIN was never entered is among them. GSTIN is non-mandatory in "
        "this product and blocks nothing, which is correct, and is also why this "
        "inference is soft in exactly one direction.",
        f"{_n(counts_row, 'drafts')} document(s) recorded as draft are excluded — "
        "an unissued document has nothing to report. Note that `doc_status` "
        "defaults to 'final', so a draft nobody marked as one is assessed here "
        "as issued.",
        f"{_n(counts_row, 'not_yet_dated')} document(s) dated after {today} are "
        "excluded; a window cannot have opened on a document not yet raised.",
        "Credit and debit notes are read from `invoice_type` on the same table. "
        "There is no separate credit-note table in this product.",
        "A document past the window is reported as past the window, never as "
        "unreportable: whether a particular IRP still accepts it is the portal's "
        "answer and not this product's.",
    ])

    return {
        "as_at": today,
        # `checked` needs applicability SETTLED and the window present. A below-
        # threshold turnover does not settle applicability — it is a floor — so
        # only `inside` plus a seeded window earns `checked`.
        "verdict": "checked" if (clock_could_be_run and applicability == "inside")
                   else "could_not_check",
        "applicability": applicability,
        "threshold": None if threshold is None else round(float(threshold), 2),
        "highest_visible_turnover": round(highest, 2),
        "turnover_is_a_floor": True,
        "statute": _statute_note(rule, "e-invoicing applicability"),
        "clock_could_be_run": clock_could_be_run,
        "window_days": window_days,
        "first_alert_on_day": first_alert_day,
        "alert_lead_days": ALERT_LEAD_DAYS,
        "statute_keys_missing": [] if clock_could_be_run else [EINVOICE_WINDOW_KEY],
        "turnover_by_year": by_year,
        "counts": {
            "documents_total": documents,
            "with_an_irn": with_irn,
            "without_an_irn": documents - with_irn,
            "b2b_documents_examined": len(rows),
            "no_recipient_gstin_not_examined": _n(counts_row, "no_recipient_gstin"),
            "window_closed_permanently": len(closed),
            "final_day": len(final_day),
            "closing_within_the_alert_window": len(closing),
            "still_open": len(still_open),
            "not_aged": len(unaged),
            "drafts_excluded": _n(counts_row, "drafts"),
            "future_dated_excluded": _n(counts_row, "not_yet_dated"),
            "exports": _n(counts_row, "exports"),
            "could_not_check": (
                len(rows) if (not clock_could_be_run or applicability != "inside") else 0),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "window_closed_permanently": closed,
        "final_day": final_day,
        "closing": closing,
        "still_open": still_open,
        "not_aged": unaged,
        "limitations": limitations,
    }
