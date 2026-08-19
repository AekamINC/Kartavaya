"""
itc_reversal — the pre-3B pack: vendor bills unpaid 180 days, and the input tax
credit that Rule 37 puts at risk of reversal because of them.

Run before GSTR-3B. Rule 37 of the CGST Rules, which implements the second
proviso to s.16(2), says that where a recipient has not paid a supplier within
180 days of the date of issue of the invoice, an amount equal to the input tax
credit availed on that supply must be paid back — reported in GSTR-3B Table
4B(2) — in the return for the tax period immediately following the one in which
the 180 days expired. The credit comes back under Table 4A(5) when the supplier
is finally paid, with no time limit on the re-availment; s.16(4) does not bite
on it. That is the whole shape of the fact, and both halves are on the output.

── The wording is the feature ────────────────────────────────────────────────

Every figure here is called CREDIT AT RISK OF REVERSAL. It is never called the
tax you must reverse, and the difference is not politeness — the number cannot
be tied out, for three reasons this system cannot engineer away:

  1. Nothing records whether the credit was ever availed. There is no
     ITC-availed flag on `ganit_vendor_bills`, no link from a bill to the 3B in
     which its credit was claimed, and no reversal ledger. Rule 37 reverses
     credit that was TAKEN; this handler can only see tax that was CHARGED. If
     the credit was never claimed there is nothing to reverse and this figure
     overstates by the whole amount of that bill.
  2. Schedule I deemed supplies — a supply made without consideration between
     related or distinct persons — are outside Rule 37 by its own proviso,
     because the value is deemed paid. Nothing in this system marks a bill as a
     Schedule I supply, so if one is present it is counted here and should not
     be. (Reverse charge, the other statutory exclusion, IS recorded — see
     below — and is excluded rather than merely disclaimed.)
  3. Interest under s.50(3) runs from the date the credit was availed, and that
     date is exactly what is not recorded. So no interest is computed and none
     is implied by the totals.

Those three sit in `limitations` on the returned dict, not in this docstring
alone, because a caveat a language model never sees is a caveat the reader never
sees. A CA will try to tie this number out against their own working; a figure
that cannot be tied out and does not say so poisons every other skill in the
catalogue.

── Reverse charge is excluded, not disclaimed ────────────────────────────────

The spec for this handler assumed the product could not see reverse-charge
supplies. It can: `staging.ganit_vendor_bills.is_reverse_charge` exists live
(added by the documents migration, read by `routers/documents.py:935` and
`services/tally_xml.py:505`). Rule 37's second proviso puts supplies on which
tax is payable under reverse charge outside the 180-day rule entirely — the
recipient pays the tax itself, so non-payment of the supplier cannot claw back
a credit the supplier never charged. Including them would be a straightforward
overstatement, so they are filtered out and the count of what was filtered is
reported under `excluded`, because a row that silently vanishes is worse than a
row that is wrong out loud.

── The 180 days run from the INVOICE date, not the due date ─────────────────

`propose_payment_run` ages bills off `due_date`, and that is right for a
payment run. It is wrong here. Rule 37 counts from the date of issue of the
invoice, so a bill on 90-day terms is 180 days into its Rule 37 clock 90 days
after it first went overdue, and a bill with no due date at all still has a
deadline. This handler uses `bill_date` and nothing else, and never touches
`due_date`, deliberately.

── Which return each bill belongs in ─────────────────────────────────────────

The reversal is not due the day the 180 days expire; it is due in the return for
the tax period immediately AFTER the expiry. So each bill carries the period its
reversal belongs in, and the summary splits three ways:

  this_return      the 180 days expired in the month before *period* — this is
                   the new work, and the reason to run the pack.
  earlier_return   expired before that and the bill is still unpaid, so the
                   reversal was due in a return already filed. Arrears.
  next_return      expired during *period* itself. Forewarning, not yet due.

Presenting one undifferentiated list would have a preparer reverse next month's
items this month, which is its own defect.

── Read-only, and it is not a return ────────────────────────────────────────

This produces a working paper. It files nothing, computes no 3B box, and writes
nothing. It also sets no image: a statutory brief must never carry a generated
picture — the template that schedules this must leave `generate_image` off.

Verified read-only against the live database on 2026-08-19: the seeded org
returns 41 bills across 34 vendors, none of them reverse-charge, nine of them
part-paid.
"""
import logging
from datetime import date

from services.skills.timeutil import return_period

log = logging.getLogger(__name__)

#: The statutory window, in days, from the date of issue of the invoice. Second
#: proviso to s.16(2) read with Rule 37(1). Not a parameter and not tunable: a
#: caller who could pass 90 or 365 would produce a document that looks statutory
#: and is not.
RULE_37_DAYS = 180

#: Where the two halves of the fact go on the return. Named on the output so the
#: preparer does not have to remember which box, and so the re-availment is
#: impossible to miss.
REVERSAL_BOX = "GSTR-3B Table 4B(2)"
REAVAILMENT_BOX = "GSTR-3B Table 4A(5)"

#: The tax heads carried on a vendor bill. `cess` was added by the documents
#: migration alongside `is_reverse_charge`; omitting it would understate every
#: bill that carries compensation cess.
TAX_HEADS = ("cgst", "sgst", "igst", "cess")


def _period_end(period: str) -> date:
    """'YYYY-MM' -> the last day of that month.

    Written out here rather than imported from `gst_readiness._period_bounds`:
    that one is a private helper of another handler and returns a half-open
    range, and the honest place for a shared version is `timeutil`, which is not
    this change's to edit. Duplicating four lines of calendar arithmetic beats
    reaching into another module's underscore.
    """
    year, month = (int(p) for p in period.split("-", 1))
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return date.fromordinal(nxt.toordinal() - 1)


def _month_after(day: date) -> str:
    """The 'YYYY-MM' of the month after the one *day* falls in.

    This is the period whose GSTR-3B carries the reversal: Rule 37(1) makes it
    due in the return for the tax period immediately following the expiry of the
    180 days, not in the period the expiry itself falls in.
    """
    return f"{day.year + 1}-01" if day.month == 12 else f"{day.year}-{day.month + 1:02d}"


async def brief_itc_reversal_risk(
    pool, org_id: str, period: str | None = None, limit: int = 200
) -> dict:
    """Vendor bills unpaid 180 days as at the end of *period*, by vendor.

    *period* is 'YYYY-MM' and defaults to the period a firm is actually working
    on — the previous month, because GSTR-3B for August is due on 20 September.
    It must have a default: the dispatcher refuses any handler declaring a
    parameter with no default that nobody supplied, so without one this skill
    could never run on a schedule, which is the only way a pre-filing pack is
    any use. `tests/test_a_skill_can_run_unattended.py` pins that.

    Returns {period, as_at, totals, by_when_due, vendors, excluded,
             limitations, what_comes_back, caveats}.
    """
    period = period or return_period()
    try:
        if len(period) != 7 or period[4] != "-":
            raise ValueError(period)
        period_end = _period_end(period)
    except (ValueError, AttributeError, TypeError):
        return {"error": f"'{period}' is not a period. Expected YYYY-MM, e.g. 2026-07."}

    heads_sql = ", ".join(f"COALESCE(b.{h}, 0) AS {h}" for h in TAX_HEADS)

    rows = await pool.fetch(
        f"""
        SELECT b.vendor_id,
               COALESCE(NULLIF(btrim(v.name), ''), '(vendor record unavailable)')
                                                     AS vendor_name,
               NULLIF(btrim(v.gstin), '')            AS vendor_gstin,
               b.bill_number,
               b.internal_ref,
               b.bill_date,
               (b.bill_date + {RULE_37_DAYS})        AS deadline_date,
               ($2::date - b.bill_date)              AS days_since_invoice,
               b.total,
               COALESCE(b.amount_paid, 0)            AS amount_paid,
               b.total - COALESCE(b.amount_paid, 0)  AS unpaid,
               {heads_sql},
               COALESCE(NULLIF(btrim(b.currency), ''), 'INR') AS currency,
               b.status
        FROM staging.ganit_vendor_bills b
        -- LEFT, not the inner join `routers/ganit.py` uses: a bill whose vendor
        -- row was soft-deleted still carries the credit, and dropping it here
        -- would understate a statutory figure. Carrying `AND v.org_id = b.org_id`
        -- closes a cross-tenant name read if `vendor_id` is ever wrong.
        LEFT JOIN staging.ganit_vendors v
               ON v.id = b.vendor_id AND v.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status <> 'cancelled'
          -- Reverse charge is outside Rule 37 by the proviso — the recipient
          -- paid the tax, so not paying the supplier claws nothing back.
          AND COALESCE(b.is_reverse_charge, FALSE) = FALSE
          AND b.total - COALESCE(b.amount_paid, 0) > 0
          -- The invoice date, never the due date. Rule 37 counts from issue.
          AND b.bill_date + {RULE_37_DAYS} <= $2::date
        ORDER BY b.total - COALESCE(b.amount_paid, 0) DESC, b.bill_date
        LIMIT $3
        """,
        org_id, period_end, limit,
    )

    # A separate read rather than a filter relaxed in the query above: excluding
    # reverse-charge rows inside the WHERE keeps the LIMIT spending itself on
    # rows that are actually at risk, and the count still has to be disclosed.
    reverse_charge_excluded = await pool.fetchval(
        f"""
        SELECT count(*)
        FROM staging.ganit_vendor_bills b
        WHERE b.org_id = $1::uuid
          AND b.is_active = TRUE
          AND b.status <> 'cancelled'
          AND COALESCE(b.is_reverse_charge, FALSE) = TRUE
          AND b.total - COALESCE(b.amount_paid, 0) > 0
          AND b.bill_date + {RULE_37_DAYS} <= $2::date
        """,
        org_id, period_end,
    ) or 0

    vendors: dict[str, dict] = {}
    totals = {h: 0.0 for h in TAX_HEADS}
    totals_unpaid = 0.0
    total_bills = 0
    by_when_due: dict[str, dict] = {}
    no_tax_on_record = 0
    foreign_currency: list[str] = []

    for r in rows:
        bill_total = float(r["total"] or 0)
        unpaid = float(r["unpaid"] or 0)
        charged = {h: float(r[h] or 0) for h in TAX_HEADS}
        charged_total = sum(charged.values())

        label = r["bill_number"] or r["internal_ref"] or "(unnumbered bill)"

        if charged_total <= 0:
            # No tax on the bill means no credit to reverse. Counted rather than
            # listed: putting a zero on a page headed "credit at risk" invites
            # somebody to reverse zero and tick it off as handled.
            no_tax_on_record += 1
            continue

        currency = r["currency"] or "INR"
        if currency != "INR":
            # GST is levied in rupees; the tax columns on a foreign-currency bill
            # carry no statement of which unit they are in, and `exchange_rate`
            # is the invoice rate, not the rate the credit was availed at. The
            # bill is listed so nobody loses it, and kept out of the totals so
            # the totals stay one currency. There are none today; the column
            # exists, so the day there is one this must not silently add it.
            foreign_currency.append(label)

        # Rule 37(1) reverses PROPORTIONATELY to the amount left unpaid. Nine of
        # the seeded org's bills are part-paid, so taking the whole tax on a bill
        # that is 60% settled would overstate it by 60%. Guarded against a bill
        # whose total is zero or negative, which would otherwise divide by zero
        # and take the whole run down.
        ratio = 1.0 if bill_total <= 0 else min(1.0, max(0.0, unpaid / bill_total))
        at_risk = {h: round(charged[h] * ratio, 2) for h in TAX_HEADS}
        at_risk_total = round(sum(at_risk.values()), 2)

        deadline = r["deadline_date"]
        due_in = _month_after(deadline)
        when = ("this_return" if due_in == period
                else "earlier_return" if due_in < period
                else "next_return")

        slot = by_when_due.setdefault(
            when, {"bills": 0, "unpaid_amount": 0.0, "credit_at_risk": 0.0})
        slot["bills"] += 1
        slot["unpaid_amount"] = round(slot["unpaid_amount"] + unpaid, 2)
        slot["credit_at_risk"] = round(slot["credit_at_risk"] + at_risk_total, 2)

        # Grouped on the vendor ROW, not on the name. Two distinct vendors can
        # carry the same name — the live data has four `ganit_vendors` rows named
        # identically in one org — and merging them would invent a counterparty.
        # The id is the grouping key only; it is never emitted.
        key = str(r["vendor_id"])
        group = vendors.setdefault(key, {
            "vendor": r["vendor_name"],
            "vendor_gstin": r["vendor_gstin"],
            "bills": 0,
            "unpaid_amount": 0.0,
            "credit_at_risk": 0.0,
            "credit_at_risk_by_head": {h: 0.0 for h in TAX_HEADS},
            "oldest_invoice_date": None,
            "bill_detail": [],
        })
        group["bills"] += 1
        group["unpaid_amount"] = round(group["unpaid_amount"] + unpaid, 2)
        group["credit_at_risk"] = round(group["credit_at_risk"] + at_risk_total, 2)
        for h in TAX_HEADS:
            group["credit_at_risk_by_head"][h] = round(
                group["credit_at_risk_by_head"][h] + at_risk[h], 2)
        bill_day = r["bill_date"].isoformat() if r["bill_date"] else None
        if bill_day and (group["oldest_invoice_date"] is None
                         or bill_day < group["oldest_invoice_date"]):
            group["oldest_invoice_date"] = bill_day

        group["bill_detail"].append({
            "bill": label,
            "invoice_date": bill_day,
            "days_since_invoice": r["days_since_invoice"],
            "rule_37_deadline": deadline.isoformat() if deadline else None,
            "reversal_due_in_return": due_in,
            "falls_in": when,
            "bill_total": round(bill_total, 2),
            "already_paid": round(float(r["amount_paid"] or 0), 2),
            "unpaid": round(unpaid, 2),
            "currency": currency,
            "status": r["status"],
            "tax_charged_on_bill": {h: round(charged[h], 2) for h in TAX_HEADS},
            "unpaid_proportion": round(ratio, 4),
            "credit_at_risk": at_risk_total,
            "credit_at_risk_by_head": at_risk,
        })

        if currency == "INR":
            total_bills += 1
            totals_unpaid += unpaid
            for h in TAX_HEADS:
                totals[h] += at_risk[h]

    ranked = sorted(vendors.values(),
                    key=lambda g: (-g["credit_at_risk"], g["vendor"]))
    for g in ranked:
        g["bill_detail"].sort(key=lambda b: (b["invoice_date"] or ""))

    out = {
        "period": period,
        "as_at": period_end.isoformat(),
        "basis": (
            f"Vendor bills still unpaid {RULE_37_DAYS} days after the date of "
            f"issue of the invoice, measured as at {period_end.isoformat()}. The "
            f"clock runs from the invoice date, not the due date."
        ),
        "totals": {
            "vendors": len(ranked),
            "bills": total_bills,
            "unpaid_amount": round(totals_unpaid, 2),
            "credit_at_risk": round(sum(totals.values()), 2),
            "credit_at_risk_by_head": {h: round(totals[h], 2) for h in TAX_HEADS},
        },
        "by_when_due": by_when_due,
        "vendors": ranked,
        "excluded": {
            "reverse_charge_bills": reverse_charge_excluded,
            "bills_with_no_tax_on_record": no_tax_on_record,
        },
        "where_it_goes": (
            f"A reversal under Rule 37 is reported in {REVERSAL_BOX}. It is due "
            f"in the return for the tax period immediately after the one in "
            f"which the 180 days expired, which is why each bill above names its "
            f"own return."
        ),
        "what_comes_back": (
            f"This is not a penalty. The credit is re-availed in full in "
            f"{REAVAILMENT_BOX} in the period the supplier is actually paid, "
            f"with no time limit on the re-availment — the s.16(4) cut-off does "
            f"not apply to credit re-availed under Rule 37. Paying a vendor on "
            f"this list before the return is filed removes the reversal entirely."
        ),
        # The headline sentence. It is a field rather than a comment because the
        # output is handed to a language model, and the only wording guaranteed
        # to survive into what the reader sees is wording that is in the data.
        "what_this_figure_is": (
            "CREDIT AT RISK OF REVERSAL — the tax charged on bills that meet the "
            "Rule 37 test, apportioned to the unpaid part. It is NOT the exact "
            "amount to reverse, and it cannot be: see `limitations`."
        ),
        "limitations": [
            "This system records no ITC-availed flag. Rule 37 reverses credit "
            "that was TAKEN; this figure is tax that was CHARGED. Where the "
            "credit was never claimed there is nothing to reverse and this "
            "overstates by the whole of that bill.",
            "Schedule I deemed supplies — made without consideration between "
            "related or distinct persons — are outside Rule 37 because the value "
            "is deemed paid, and nothing here marks a bill as one. Any such bill "
            "is counted above and should not be. (Reverse-charge supplies, the "
            "other statutory exclusion, ARE recorded and have been excluded — "
            f"{reverse_charge_excluded} bill(s).)",
            "No interest is computed. Interest under s.50(3) runs from the date "
            "the credit was availed, and that date is not recorded anywhere in "
            "this system, so none of the figures above carry any interest.",
        ],
        "caveats": [],
    }

    if no_tax_on_record:
        out["caveats"].append(
            f"{no_tax_on_record} unpaid bill(s) past {RULE_37_DAYS} days carry no "
            f"GST on record and are not listed — there is no credit on them to "
            f"reverse. They are still money owed; `propose_payment_run` is where "
            f"they show up."
        )
    if foreign_currency:
        out["caveats"].append(
            f"{len(foreign_currency)} bill(s) are not in INR ("
            + ", ".join(sorted(foreign_currency)[:10])
            + "). They are listed but EXCLUDED from the totals: GST is charged "
            "in rupees and nothing records which unit these tax columns are in."
        )
    if len(rows) == limit:
        out["caveats"].append(
            f"Capped at {limit} bills, taken largest-unpaid first. The totals are "
            f"therefore a floor, not the full exposure."
        )
    if not ranked and not reverse_charge_excluded and not no_tax_on_record:
        out["caveats"].append(
            f"No vendor bill is unpaid {RULE_37_DAYS} days as at "
            f"{period_end.isoformat()}. That is a finding, not a skipped check."
        )
    return out
