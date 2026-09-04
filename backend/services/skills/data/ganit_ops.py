"""
ganit_ops — the four operational checks that sit around the billing month:
what will fail to bill, what is about to be paid twice, what to say to the
people who have not paid, and whether the outward series and the tax split will
survive a GSTR-1.

Everything here is READ-ONLY. Nothing in this module writes a row, sends a
message, or produces an image. A statutory brief must never carry a generated
picture — images are the single largest line in this product's AI spend and a
compliance working paper needs none — so a template scheduling any of these
must leave `generate_image` off.

── The four, and why they are four and not one ──────────────────────────────

  check_retainers_that_stopped_billing   revenue that will not be raised
  check_duplicate_vendor_bills           money about to go out twice
  pack_collection_messages               money already earned and not collected
  check_invoice_series_and_splits        the two defects a GSTR-1 dies on

They share a month and nothing else. Fusing any two would force a caller to
hold both modules and would put an unrelated finding in front of somebody who
came for one answer.

── WHAT TRUNCATION MEANS HERE, AND WHY ONE OF THEM REFUSES ─────────────────

Three of these four under-report when they hit their row cap: a missed
duplicate, a missed retainer, a missed message. Those say so on the output and
carry on, because a partial list of real findings is still useful.

`check_invoice_series_and_splits` is the exception and it MATTERS. A gap check
computes "which numbers are missing" from the numbers it can see, so a capped
read does not under-report gaps — it INVENTS them. Every invoice past the cap
becomes a hole in the series, and the report would tell a firm it has lost
documents it is holding. So that handler REFUSES to report gaps at all when its
cap is hit, reports the duplicates (which truncation can only under-report), and
says in words which half of it did not run. See `_SERIES_ROW_CAP`.

── Names, never ids ─────────────────────────────────────────────────────────

No user, member, org, client, contact or vendor UUID appears in any value
returned from this module. Ids are used as JOIN and GROUP BY keys inside the
queries and are dropped before anything is emitted. Where a name is genuinely
absent the output says so in words rather than falling back to an id.

── Every join to a counterparty carries org_id ─────────────────────────────

The foreign key on `graha_contacts.client_id` is on `id` alone, so a join on id
alone can surface another practice's client name onto this practice's report.
Every join to `staging.graha_clients` in this file carries
`cl.org_id = ct.org_id`, and so does every join to `graha_contacts` and
`ganit_vendors`. That is not belt-and-braces; it is the only thing standing
between a stale `client_id` and a cross-tenant name.
"""
import logging
import re
from datetime import date, timedelta

from services.skill_ack import opaque_ref
from services.skills.reachable import reachable
from services.skills.timeutil import month_days, utc_now

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# shared helpers
# ═══════════════════════════════════════════════════════════════════════════

def _money(value) -> float:
    """asyncpg Decimal -> float, to the paisa, never None.

    Every amount on every output goes through here so a NULL column becomes 0.0
    rather than a `None` that a caller formats as the string "None" beside a
    rupee sign.
    """
    return round(float(value or 0), 2)


#: THE MONTH IS `services.skills.timeutil.month_days` AND IS IMPORTED, NOT
#: RESTATED. Ten modules in this package declared their own until 2026-09-04,
#: under ONE NAME OVER TWO CONTRACTS — six returning the last day and four the
#: first of the next month — so reading one handler to learn another's bound
#: gave the wrong answer. The name now carries the convention: `month_days`
#: pairs with `<=`, `month_window` with `<`.
_month_bounds = month_days


# ═══════════════════════════════════════════════════════════════════════════
# 1 · check_retainers_that_stopped_billing
# ═══════════════════════════════════════════════════════════════════════════
#
# TWO QUESTIONS IN ONE SKILL, AND THEY ARE NOT THE SAME QUESTION.
#
#   A. A few days out: of the recurring definitions about to fire, which will
#      produce something nobody can send — and why, named per definition.
#   B. Over the period: which LIVE CONTRACTS produced no invoice at all, and
#      which have been billed past the value they were signed for.
#
# They are one skill because they are one worry ("did we bill everything this
# month?") and because splitting them puts half the answer behind a second
# schedule somebody will forget to arm. They are two SECTIONS because a
# recurring definition and a contract are different records with different
# failure modes, and merging the lists would produce rows a reader cannot act on
# without first working out which kind of thing they are looking at.
#
# EVERY PREDICATE BELOW IS READ OFF WHAT THE GENERATOR ACTUALLY DOES.
# `services/skills/action/recurring_invoice_generator.py` is the job that runs;
# these are its behaviours, not a list of things that sound risky:
#
#   next_date > end_date        its WHERE clause excludes the row. NO INVOICE IS
#                               RAISED and nothing anywhere says so. This is the
#                               silent one, and it is why this skill exists.
#   contact_id IS NULL          `_doc_status_for` fails Rule 46(e) (recipient
#                               name), so the invoice is written as a DRAFT.
#                               Revenue is not lost, but nothing is sent, and a
#                               draft among drafts is invisible.
#   empty template_items        same — Rule 46(f)-(j), written as a draft.
#   subtotal <= 0               a document for nil. It generates, it is final,
#                               and it collects nothing.
#   no contact email            `auto_send` is deliberately NOT acted on by the
#                               generator, so this never stops generation — it
#                               stops DELIVERY, by the job or by a person.
#   frequency unrecognised      `_advance` treats anything it does not know as
#                               monthly, so a definition saying 'fortnightly'
#                               bills twelve times a year, not twenty-six.
#
#: Cycle length in days per frequency, for the "has this schedule stopped
#: advancing" test. 31 for a month rather than 30: a schedule due on the 31st
#: that advanced to the 28th of February must not read as stalled.
_FREQUENCY_DAYS = {"weekly": 7, "monthly": 31, "quarterly": 92, "yearly": 365}

#: The frequencies `recurring_invoice_generator._advance` actually understands.
#: Anything else is silently treated as monthly, which is a billing term nobody
#: agreed to — so it is a finding rather than a shrug.
_KNOWN_FREQUENCIES = ("weekly", "monthly", "quarterly", "yearly")


async def check_retainers_that_stopped_billing(
    pool,
    org_id: str,
    horizon_days: int = 7,
    month: str | None = None,
    limit: int = 200,
) -> dict:
    """Retainers about to fail, and live contracts that billed nothing.

    *horizon_days* is how far ahead section A looks — the "few days out" that
    leaves time to fix a definition before it fires.

    *month* is 'YYYY-MM' for section B and defaults to the CURRENT month, not
    the previous one. That is the opposite of the GST handlers and it is
    deliberate: a return is filed for the month you have LEFT, but a retainer is
    raised for the month you are IN, so on the 20th of August the question
    "which live contracts have billed nothing" is a question about August.
    `check_payroll_readiness` defaults the same way for the same reason.

    Every parameter has a default because the dispatcher refuses to run a
    handler that declares one without, so a skill that made somebody type a
    horizon could never be scheduled — and an unscheduled billing check is a
    check nobody runs. `tests/test_a_skill_can_run_unattended.py` pins that.

    Returns {as_at, horizon_days, month, due_soon, contracts, counts,
             limitations, caveats}.
    """
    today = utc_now().date()
    month = month or today.strftime("%Y-%m")
    try:
        month_start, month_end = _month_bounds(month)
    except (ValueError, AttributeError, TypeError):
        return {"error": f"'{month}' is not a month. Expected YYYY-MM, e.g. 2026-08."}

    horizon_days = max(0, int(horizon_days or 0))

    # ── A · definitions about to fire ───────────────────────────────────────
    #
    # The cycle length is computed once in SQL rather than per row in Python so
    # that the "already invoiced this cycle" sub-select and the "schedule has
    # stalled" test use ONE definition of a cycle. Two definitions of a month is
    # how a quarterly retainer gets flagged as stalled every quarter.
    #
    # `$3::int` is cast. An untyped `next_date <= $2 + $3` is an ambiguous
    # parameter expression, and PgBouncer turns an untyped parse error into an
    # instant 500 rather than a readable failure — twice now in this codebase.
    due_rows = await pool.fetch(
        """
        WITH r AS (
            SELECT rec.*,
                   CASE lower(COALESCE(rec.frequency, 'monthly'))
                        WHEN 'weekly'    THEN 7
                        WHEN 'quarterly' THEN 92
                        WHEN 'yearly'    THEN 365
                        ELSE 31
                   END AS cycle_days
            FROM public.ganit_recurring rec
            WHERE rec.org_id = $1::uuid
              AND rec.is_active = TRUE
        )
        SELECT r.frequency,
               r.cycle_days,
               r.next_date,
               r.end_date,
               r.auto_send,
               COALESCE(r.subtotal, 0)                          AS subtotal,
               COALESCE(r.gst_rate, 0)                          AS gst_rate,
               (r.contact_id IS NULL)                           AS no_contact_on_template,
               (r.contact_id IS NOT NULL AND ct.id IS NULL)     AS contact_record_missing,
               COALESCE(ct.is_active, TRUE)                     AS contact_active,
               COALESCE(NULLIF(btrim(ct.email), ''), '')        AS contact_email,
               -- The CRM client is the COMPANY. The contact is a person who may
               -- come and go, so the company name is preferred wherever one
               -- exists and the person's own name is the last resort.
               COALESCE(NULLIF(btrim(cl.name), ''),
                        NULLIF(btrim(ct.company), ''),
                        NULLIF(btrim(ct.name), ''), '')         AS bill_to,
               -- The company is who is billed; the CONTACT is who is rung.
               -- `graha_clients` carries no contact column at all, so the
               -- email and phone can only come from the contact row.
               NULLIF(btrim(ct.email), '')                     AS bill_to_email,
               NULLIF(btrim(ct.phone), '')                     AS bill_to_phone,
               (jsonb_typeof(r.template_items) IS DISTINCT FROM 'array'
                OR jsonb_array_length(r.template_items) = 0)    AS no_line_items,
               (SELECT count(*)
                  FROM public.ganit_invoices i
                 WHERE i.org_id = r.org_id
                   AND i.recurring_id = r.id
                   AND i.is_active
                   AND i.cancelled_at IS NULL
                   AND i.invoice_date >= (r.next_date - r.cycle_days)
                   AND i.invoice_date <= $2::date)              AS invoiced_this_cycle,
               (SELECT max(i.invoice_date)
                  FROM public.ganit_invoices i
                 WHERE i.org_id = r.org_id
                   AND i.recurring_id = r.id
                   AND i.is_active)                             AS last_invoice_date
        FROM r
        -- org_id on BOTH joins. The FK is on id alone, so without it a stale
        -- contact_id can surface another practice's contact and, through it,
        -- another practice's client name.
        LEFT JOIN public.graha_contacts ct
               ON ct.id = r.contact_id AND ct.org_id = r.org_id
        LEFT JOIN public.graha_clients cl
               ON cl.id = ct.client_id AND cl.org_id = ct.org_id
        WHERE r.next_date <= ($2::date + $3::int)
        ORDER BY r.next_date, bill_to
        LIMIT $4
        """,
        org_id, today, horizon_days, limit,
    )

    due_soon = []
    for row in due_rows:
        cycle = int(row["cycle_days"] or 31)
        freq = (row["frequency"] or "").strip().lower()
        faults: list[dict] = []

        # THE SILENT ONE, FIRST. The generator's WHERE clause carries
        # `(end_date IS NULL OR next_date <= end_date)`, so this definition is
        # simply not selected. No invoice, no error, no log line, no draft.
        if row["end_date"] and row["next_date"] and row["next_date"] > row["end_date"]:
            faults.append({
                "fault": "schedule_ran_past_its_end_date",
                "blocks": "no invoice at all",
                "detail": (
                    f"next due {row['next_date']}, but the schedule ends "
                    f"{row['end_date']}. The generator skips it silently — "
                    f"nothing is raised and nothing reports a failure."
                ),
            })
        elif row["end_date"] and row["end_date"] < today:
            # Reachable when next_date is also in the past: the definition is
            # inside its window by the generator's test but the agreement has
            # expired. Said separately because the fix is a renewal rather than
            # a date correction.
            faults.append({
                "fault": "agreement_already_expired",
                "blocks": "nothing yet",
                "detail": f"the schedule's end date {row['end_date']} has passed.",
            })

        if row["no_contact_on_template"]:
            faults.append({
                "fault": "no_customer_on_the_template",
                "blocks": "the invoice is written as a DRAFT",
                "detail": (
                    "the recurring definition names no contact, so Rule 46(e) "
                    "(recipient) cannot be satisfied and the generator holds the "
                    "invoice as a draft. It will not be sent and will not be "
                    "chased."
                ),
            })
        elif row["contact_record_missing"]:
            faults.append({
                "fault": "customer_record_no_longer_exists",
                "blocks": "the invoice is written as a DRAFT",
                "detail": (
                    "the contact this schedule points at is not in this "
                    "organisation's contacts any more."
                ),
            })
        elif not row["contact_active"]:
            faults.append({
                "fault": "customer_is_archived",
                "blocks": "delivery, and probably the intent",
                "detail": (
                    f"{row['bill_to'] or 'the customer'} is archived in the CRM "
                    f"but the retainer is still live."
                ),
            })

        if not row["contact_email"] and not row["no_contact_on_template"]:
            faults.append({
                "fault": "no_email_address_for_the_customer",
                "blocks": "delivery, never generation",
                "detail": (
                    "the invoice will exist and cannot be emailed — by the job "
                    "or by a person afterwards. Note the generator does not act "
                    "on auto_send at all, so nothing was ever going to send this "
                    "automatically."
                ),
            })

        if _money(row["subtotal"]) <= 0:
            faults.append({
                "fault": "zero_amount_on_the_template",
                "blocks": "nothing — it bills nil",
                "detail": (
                    "subtotal is zero, so this raises a tax invoice for ₹0.00 "
                    "every cycle and collects nothing."
                ),
            })

        if row["no_line_items"]:
            faults.append({
                "fault": "no_line_items_on_the_template",
                "blocks": "the invoice is written as a DRAFT",
                "detail": (
                    "an invoice with no lines states no supply; Rule 46(f)-(j) "
                    "describe the particulars of each line."
                ),
            })

        if int(row["invoiced_this_cycle"] or 0) > 0:
            faults.append({
                "fault": "already_invoiced_this_cycle",
                "blocks": "nothing — it bills TWICE",
                "detail": (
                    f"{row['invoiced_this_cycle']} invoice(s) already carry this "
                    f"schedule inside the last {cycle} days. Running the "
                    f"generator now bills the customer again for the same period."
                ),
            })

        stall_after = _FREQUENCY_DAYS.get(freq or "monthly", 31)
        if row["next_date"] and row["next_date"] < today - timedelta(days=stall_after):
            faults.append({
                "fault": "schedule_stopped_advancing",
                "blocks": "no invoice at all, repeatedly",
                "detail": (
                    f"next due {row['next_date']}, more than one "
                    f"{freq or 'monthly'} cycle ago, and the schedule has not "
                    f"moved. The generator advances next_date only after a "
                    f"successful insert, so a date stuck in the past means the "
                    f"last run raised nothing."
                ),
            })

        if freq and freq not in _KNOWN_FREQUENCIES:
            faults.append({
                "fault": "frequency_not_recognised",
                "blocks": "nothing — it bills on the WRONG cadence",
                "detail": (
                    f"'{row['frequency']}' is not one of "
                    f"{', '.join(_KNOWN_FREQUENCIES)}; the generator treats "
                    f"anything it does not know as monthly."
                ),
            })

        if not faults:
            # Healthy definitions are not listed. A page headed "what will fail"
            # that lists everything makes the reader do the filtering; the
            # denominator is on `counts` for anyone who wants it.
            continue

        due_soon.append(reachable({
            # The key an acknowledgement is filed under — see
            # `services/skill_ack_wiring.py`. A recurring schedule has no
            # number and no title, and its customer name is not unique, so the
            # row id is the only stable handle. OPAQUE, because this output
            # carries no link and a bare uuid beside a customer name is what
            # `check-rendered-ids` exists to stop.
            "schedule_ref": opaque_ref(row["id"]),
            "bill_to": row["bill_to"] or "(no customer named on the schedule)",
            "next_due": row["next_date"].isoformat() if row["next_date"] else None,
            "frequency": row["frequency"],
            "amount_before_tax": _money(row["subtotal"]),
            "gst_rate_percent": _money(row["gst_rate"]),
            "schedule_ends": row["end_date"].isoformat() if row["end_date"] else None,
            "last_invoice_from_this_schedule": (
                row["last_invoice_date"].isoformat()
                if row["last_invoice_date"] else None
            ),
            "faults": faults,
        }, kind="client", email=row["bill_to_email"],
            phone=row["bill_to_phone"]))

    # ── B · live contracts that billed nothing this period ──────────────────
    #
    # THE HONEST LIMITATION, STATED HERE AND ON THE OUTPUT. `ganit_invoices`
    # carries NO contract_id. There is no column anywhere tying an invoice to
    # the contract it was raised under, so "did this contract bill" can only be
    # answered through the CONTACT the contract names. Two consequences, both
    # disclosed in `limitations`:
    #
    #   · a contact holding two contracts has one invoice counted against both,
    #     so an over-billing finding can be an artefact of the second contract;
    #   · an invoice raised for entirely unrelated work counts as contract
    #     billing, so a contract can look billed when it is not.
    #
    # Measured read-only on 2026-08-20: no contact in either seeded org holds
    # more than one active contract, so the approximation is exact there today.
    # It will not stay exact, which is why it is a caveat and not a comment.
    contract_rows = await pool.fetch(
        """
        SELECT k.id,
               k.title,
               k.contract_value,
               k.start_date,
               k.end_date,
               (k.contact_id IS NULL)                           AS no_contact,
               COALESCE(NULLIF(btrim(cl.name), ''),
                        NULLIF(btrim(ct.company), ''),
                        NULLIF(btrim(ct.name), ''), '')         AS bill_to,
               -- The company is who is billed; the CONTACT is who is rung.
               -- `graha_clients` carries no contact column at all, so the
               -- email and phone can only come from the contact row.
               NULLIF(btrim(ct.email), '')                     AS bill_to_email,
               NULLIF(btrim(ct.phone), '')                     AS bill_to_phone,
               (SELECT count(*)
                  FROM public.ganit_invoices i
                 WHERE i.org_id = k.org_id
                   AND i.contact_id = k.contact_id
                   AND i.is_active
                   AND i.cancelled_at IS NULL
                   AND i.invoice_type = 'tax_invoice'
                   AND i.invoice_date >= $2::date
                   AND i.invoice_date <= $3::date)              AS invoices_in_period,
               (SELECT COALESCE(sum(i.total), 0)
                  FROM public.ganit_invoices i
                 WHERE i.org_id = k.org_id
                   AND i.contact_id = k.contact_id
                   AND i.is_active
                   AND i.cancelled_at IS NULL
                   AND i.invoice_type = 'tax_invoice'
                   AND (k.start_date IS NULL OR i.invoice_date >= k.start_date))
                                                                AS billed_since_start
        FROM public.ganit_contracts k
        LEFT JOIN public.graha_contacts ct
               ON ct.id = k.contact_id AND ct.org_id = k.org_id
        LEFT JOIN public.graha_clients cl
               ON cl.id = ct.client_id AND cl.org_id = ct.org_id
        WHERE k.org_id = $1::uuid
          AND k.is_active = TRUE
          AND k.status = 'active'
          -- Live DURING the period being asked about: started on or before its
          -- last day, and not ended before its first. A contract that ended in
          -- July is not a July-billing failure discovered in August.
          AND (k.start_date IS NULL OR k.start_date <= $3::date)
          AND (k.end_date   IS NULL OR k.end_date   >= $2::date)
        ORDER BY k.title
        LIMIT $4
        """,
        org_id, month_start, month_end, limit,
    )

    contracts = []
    contracts_without_a_customer = 0
    for row in contract_rows:
        if row["no_contact"]:
            # Cannot be judged at all: with no contact there is no path from the
            # contract to any invoice. Counted and disclosed rather than listed
            # as "billed nothing", which would be an accusation this data cannot
            # support.
            contracts_without_a_customer += 1
            continue

        value = _money(row["contract_value"])
        billed = _money(row["billed_since_start"])
        findings = []

        if int(row["invoices_in_period"] or 0) == 0:
            findings.append({
                "fault": "no_invoice_in_the_period",
                "detail": (
                    f"no tax invoice to {row['bill_to'] or 'this customer'} dated "
                    f"in {month}. The contract is live and nothing was raised."
                ),
            })
        if value > 0 and billed > value:
            findings.append({
                "fault": "billed_past_the_contract_value",
                "detail": (
                    f"₹{billed:,.2f} invoiced since {row['start_date']} against a "
                    f"contract value of ₹{value:,.2f} — over by "
                    f"₹{billed - value:,.2f}. See `limitations`: invoices are "
                    f"matched by CUSTOMER, not by contract, because no column "
                    f"links them."
                ),
            })

        if not findings:
            continue

        contracts.append(reachable({
            # Same reason as `schedule_ref` above: a contract TITLE repeats
            # across customers and can be retitled.
            "contract_ref": opaque_ref(row["id"]),
            "contract": row["title"],
            "bill_to": row["bill_to"] or "(customer name unavailable)",
            "contract_value": value,
            "invoiced_since_start": billed,
            "invoices_in_period": int(row["invoices_in_period"] or 0),
            "runs": {
                "from": row["start_date"].isoformat() if row["start_date"] else None,
                "to": row["end_date"].isoformat() if row["end_date"] else None,
            },
            "findings": findings,
        }, kind="client", email=row["bill_to_email"],
            phone=row["bill_to_phone"]))

    out = {
        "as_at": today.isoformat(),
        "horizon_days": horizon_days,
        "month": month,
        "period_examined": {"from": month_start.isoformat(),
                            "to": month_end.isoformat()},
        "due_soon": due_soon,
        "contracts": contracts,
        "counts": {
            "schedules_due_within_horizon": len(due_rows),
            "schedules_with_a_fault": len(due_soon),
            "live_contracts_examined": len(contract_rows),
            "contracts_with_a_finding": len(contracts),
            "contracts_with_no_customer_to_check": contracts_without_a_customer,
        },
        "limitations": [
            "No column links an invoice to a contract. `ganit_invoices` has "
            "contact_id, client_id and recurring_id and nothing else — so the "
            "contract section matches invoices by CUSTOMER. A customer holding "
            "two contracts has the same invoice counted against both, and an "
            "invoice for unrelated work counts as contract billing.",
            "Section A reports what the recurring generator WILL do, read off "
            "its code — not what it did. There is no history of past runs to "
            "report: `ganit_recurring` has no last-run column and no error "
            "column, so a schedule stuck in the past is the only evidence that a "
            "run ever failed.",
            "`auto_send` is a real column and the generator deliberately does "
            "not act on it. A missing email address therefore stops a PERSON "
            "sending the invoice; it never stopped a machine, because no machine "
            "was going to.",
        ],
        "caveats": [],
    }

    if len(due_rows) == limit:
        out["caveats"].append(
            f"Section A stopped at {limit} schedules, taken earliest-due first. "
            f"There may be more faults past the cap — this is a floor."
        )
    if len(contract_rows) == limit:
        out["caveats"].append(
            f"Section B stopped at {limit} contracts, in title order. There may "
            f"be more past the cap — this is a floor."
        )
    if contracts_without_a_customer:
        out["caveats"].append(
            f"{contracts_without_a_customer} live contract(s) name no customer, "
            f"so there is no path from them to any invoice and they could not be "
            f"checked either way. They are counted as neither billed nor unbilled."
        )
    if not due_soon and not contracts:
        out["caveats"].append(
            f"Nothing found. {len(due_rows)} schedule(s) fire within "
            f"{horizon_days} day(s) and {len(contract_rows)} live contract(s) "
            f"were examined for {month}; none carries a fault. That is a finding, "
            f"not a skipped check."
        )
    return out


# ═══════════════════════════════════════════════════════════════════════════
# 2 · check_duplicate_vendor_bills
# ═══════════════════════════════════════════════════════════════════════════
#
# THE ONE THING THIS MUST NOT DO IS CRY WOLF. A firm that pays a supplier the
# same retainer every month has twelve bills at an identical total from one
# vendor, and a matcher that calls those duplicates is a matcher that gets
# switched off in month two. So the three matchers are RANKED, each carries its
# own confidence in words, and the weakest is bounded by a date window rather
# than left open.
#
#   1 same_supplier_invoice_number   near-certain. The supplier's own number is
#                                    unique to the supplier's own document; the
#                                    same one on two rows is the same bill.
#                                    Compared on alphanumerics only, so
#                                    `INV/2026/117` and `inv-2026-117` match.
#   2 same_amount_days_apart         likely. Re-entry with the bill number
#                                    mistyped or left blank. Bounded to a few
#                                    days, because a monthly retainer is not a
#                                    duplicate.
#   3 same_amount_different_numbers  worth a look, no more. Same supplier, same
#                                    total, further apart, and the two supplier
#                                    numbers DISAGREE — so either one of them is
#                                    wrong or these are two genuine bills that
#                                    happen to match.
#
# ── THE BRIEF'S THIRD MATCHER DOES NOT WORK, AND HERE IS WHY ────────────────
#
# It was specified as "the same total against two internal references".
# `ganit_vendor_bills.internal_ref` is assigned per ROW, one per bill. Measured
# read-only on 2026-08-20 it is populated on 166 of 166 bills in the seeded org
# and 20 of 20 in the other, with ZERO duplicate values in either. So "two
# different internal references" is true of EVERY pair of rows in the table and
# discriminates nothing: run literally it returned 120 pairs in the seeded org —
# every pair of bills anywhere in the ledger that happened to share a total,
# across unrelated vendors.
#
# What the matcher is reaching for is real: the same bill captured twice through
# two routes. So it is implemented as same VENDOR + same TOTAL + both supplier
# numbers present and DIFFERENT, inside a bounded window. The internal reference
# is still reported on every row — it is how a person finds the two records in
# the UI — but it is never used as evidence.
#
# ── THE BLIND SPOT IS ON THE OUTPUT ─────────────────────────────────────────
#
# All three matchers group on the vendor RECORD. A bill entered twice against
# two DIFFERENT vendor rows carrying the same name is invisible to every one of
# them. That is not hypothetical: one seeded org has 2 vendor names held by more
# than one active vendor record. Rather than widen the matchers — which would
# merge two genuinely distinct suppliers who happen to share a name — the
# duplicated vendor NAMES are counted and named under `blind_spots`.

#: Matcher 2's window, in days. Short on purpose: a fortnight would swallow a
#: semi-monthly supplier and a month would swallow every retainer in the ledger.
_NEAR_DAYS_DEFAULT = 5

#: Matcher 3's window. Wide enough to catch a bill re-keyed a quarter later,
#: narrow enough that an annual subscription is not paired with next year's.
_WIDE_DAYS_DEFAULT = 120

#: How far back the candidate population reaches. A year beyond the widest
#: window, so a pair whose earlier half sits just outside the window is still
#: available to be paired rather than silently unpairable.
_LOOKBACK_MARGIN_DAYS = 366

_CONFIDENCE = {
    "same_supplier_invoice_number": (
        "near-certain — the supplier's own invoice number appears on both rows, "
        "and a supplier does not issue two documents under one number."
    ),
    "same_amount_days_apart": (
        "likely — same supplier, same amount, a few days apart, and the "
        "supplier's numbers either disagree or are missing. This is what "
        "re-entry looks like."
    ),
    "same_amount_different_numbers": (
        "worth a look, no more — same supplier and the same amount, but the two "
        "supplier invoice numbers genuinely differ, so these may be two real "
        "bills that happen to match."
    ),
}


async def check_duplicate_vendor_bills(
    pool,
    org_id: str,
    near_days: int = _NEAR_DAYS_DEFAULT,
    wide_days: int = _WIDE_DAYS_DEFAULT,
    limit: int = 200,
) -> dict:
    """Vendor bills that are probably one bill entered twice.

    Run BEFORE the payment run. `propose_payment_run` proposes what to pay and
    has no notion of a duplicate, so a bill entered twice is proposed twice and
    paid twice — and recovering it afterwards is a conversation, not an edit.

    All parameters default, so this can be scheduled. Returns
    {as_at, windows, pairs, counts, blind_spots, limitations, caveats}.
    """
    today = utc_now().date()
    near_days = max(0, int(near_days or 0))
    wide_days = max(near_days, int(wide_days or 0))
    since = today - timedelta(days=wide_days + _LOOKBACK_MARGIN_DAYS)

    # One query, three matchers, UNION ALL — rather than three round trips whose
    # results would then have to be de-duplicated against each other in Python.
    # A pair is reported ONCE, at its strongest matcher: matcher 2 excludes pairs
    # whose supplier numbers are present and identical (those are matcher 1), and
    # matcher 3 takes only the strictly-wider date band. So the reader is never
    # shown the same two rows twice under two headings.
    #
    # THE PAIR IS ORDERED BY DATE, NOT BY ID. `b.id > a.id` also removes the
    # self-join's mirror image and was the obvious way to write it — but these
    # ids are random UUIDs, so it made `first` and `second` mean nothing at all:
    # the row labelled "first" was as often the later bill as the earlier one, on
    # a report whose whole purpose is "this one is the copy". `(a.bill_date,
    # a.id) < (b.bill_date, b.id)` is a row comparison, so it still yields
    # exactly one row per unordered pair, and `a` is always the earlier bill.
    rows = await pool.fetch(
        """
        WITH bills AS (
            SELECT vb.id,
                   vb.vendor_id,
                   vb.bill_number,
                   vb.internal_ref,
                   vb.bill_date,
                   COALESCE(vb.total, 0)          AS total,
                   COALESCE(vb.amount_paid, 0)    AS amount_paid,
                   vb.status,
                   COALESCE(NULLIF(btrim(vb.currency), ''), 'INR') AS currency,
                   COALESCE(NULLIF(btrim(v.name), ''),
                            '(vendor record unavailable)')          AS vendor_name,
                   -- alphanumerics only: INV/2026/117 == inv-2026-117
                   regexp_replace(lower(COALESCE(vb.bill_number, '')),
                                  '[^a-z0-9]', '', 'g')             AS number_key
            FROM public.ganit_vendor_bills vb
            -- LEFT and org-scoped: a bill whose vendor row was archived is still
            -- a bill that can be paid twice, and the org_id on the join stops a
            -- stale vendor_id naming another practice's supplier.
            LEFT JOIN public.ganit_vendors v
                   ON v.id = vb.vendor_id AND v.org_id = vb.org_id
            WHERE vb.org_id = $1::uuid
              AND vb.is_active = TRUE
              AND COALESCE(vb.status, '') <> 'cancelled'
              AND COALESCE(vb.total, 0) > 0
              AND vb.bill_date IS NOT NULL
              AND vb.bill_date >= $2::date
        )
        SELECT 1 AS match_rank, 'same_supplier_invoice_number' AS matcher, a.*,
               b.bill_number AS b_bill_number, b.internal_ref AS b_internal_ref,
               b.bill_date AS b_bill_date, b.total AS b_total,
               b.amount_paid AS b_amount_paid, b.status AS b_status,
               (b.bill_date - a.bill_date) AS days_apart
        FROM bills a JOIN bills b
          ON (a.bill_date, a.id) < (b.bill_date, b.id)
         AND b.vendor_id IS NOT DISTINCT FROM a.vendor_id
         AND b.number_key = a.number_key
        WHERE a.number_key <> ''

        UNION ALL

        SELECT 2, 'same_amount_days_apart', a.*,
               b.bill_number, b.internal_ref, b.bill_date, b.total,
               b.amount_paid, b.status, (b.bill_date - a.bill_date)
        FROM bills a JOIN bills b
          ON (a.bill_date, a.id) < (b.bill_date, b.id)
         AND b.vendor_id IS NOT DISTINCT FROM a.vendor_id
         AND b.total = a.total
         AND b.currency = a.currency
         AND (b.bill_date - a.bill_date) <= $3::int
         -- Not already matcher 1. Written as a negated conjunction rather than
         -- `b.number_key IS DISTINCT FROM a.number_key`, which would have
         -- excluded the pair where BOTH numbers are blank — same vendor, same
         -- amount, two days apart, no supplier number on either. That is the
         -- classic re-entry and it would have been the one pair this matcher
         -- silently dropped.
         AND NOT (a.number_key <> '' AND b.number_key = a.number_key)

        UNION ALL

        SELECT 3, 'same_amount_different_numbers', a.*,
               b.bill_number, b.internal_ref, b.bill_date, b.total,
               b.amount_paid, b.status, (b.bill_date - a.bill_date)
        FROM bills a JOIN bills b
          ON (a.bill_date, a.id) < (b.bill_date, b.id)
         AND b.vendor_id IS NOT DISTINCT FROM a.vendor_id
         AND b.total = a.total
         AND b.currency = a.currency
         AND (b.bill_date - a.bill_date) >  $3::int
         AND (b.bill_date - a.bill_date) <= $4::int
         -- BOTH supplier numbers present and disagreeing. NOT "different
         -- internal refs" — those are assigned one per row and differ on every
         -- pair in the table, so they discriminate nothing. See the header.
         AND a.number_key <> '' AND b.number_key <> ''
         AND b.number_key <> a.number_key

        ORDER BY match_rank, days_apart, vendor_name
        LIMIT $5
        """,
        org_id, since, near_days, wide_days, limit,
    )

    pairs = []
    at_risk = 0.0
    by_matcher: dict[str, int] = {}
    for r in rows:
        matcher = r["matcher"]
        by_matcher[matcher] = by_matcher.get(matcher, 0) + 1
        # The exposure is ONE of the two, not both: if a pair really is one bill
        # entered twice, one of them is legitimately owed and only the other is
        # money leaving for nothing. Which one is the larger UNPAID side, and
        # taking that rather than "the second" is not fussiness —
        #
        #   bill A settled in full, bill B unpaid 69,030  -> exposure 69,030
        #   both unpaid at 69,030                         -> exposure 69,030
        #   A part-paid (30,000 left), B unpaid 69,030    -> exposure 69,030
        #
        # In every case the overpayment is max(unpaid), and taking "the second"
        # returned 0.00 on the first shape — which is exactly the shape the live
        # data had: a paid bill and its unpaid twin, reported as nothing at risk.
        at_risk += max(
            0.0,
            _money(r["total"]) - _money(r["amount_paid"]),
            _money(r["b_total"]) - _money(r["b_amount_paid"]),
        )
        pairs.append({
            "matcher": matcher,
            "confidence": _CONFIDENCE[matcher],
            "vendor": r["vendor_name"],
            "days_apart": int(r["days_apart"] or 0),
            "amount": _money(r["total"]),
            "currency": r["currency"],
            # `first` is the EARLIER bill by date and `second` the later one —
            # the later is usually the re-entry, and a reader deciding which row
            # to void needs that to be reliable.
            "first": {
                "bill_number": r["bill_number"] or "(no supplier number recorded)",
                "internal_ref": r["internal_ref"] or "",
                "bill_date": r["bill_date"].isoformat() if r["bill_date"] else None,
                "total": _money(r["total"]),
                "already_paid": _money(r["amount_paid"]),
                "status": r["status"],
            },
            "second": {
                "bill_number": r["b_bill_number"] or "(no supplier number recorded)",
                "internal_ref": r["b_internal_ref"] or "",
                "bill_date": r["b_bill_date"].isoformat() if r["b_bill_date"] else None,
                "total": _money(r["b_total"]),
                "already_paid": _money(r["b_amount_paid"]),
                "status": r["b_status"],
            },
        })

    # The blind spot, measured rather than asserted. All three matchers group on
    # the vendor RECORD, so a bill entered against two vendor rows sharing one
    # name is invisible to them. Widening the matchers to group on the NAME would
    # merge two genuinely distinct suppliers who happen to share one, so the
    # names are reported instead and a person decides.
    dup_vendor_names = await pool.fetch(
        """
        SELECT COALESCE(NULLIF(btrim(v.name), ''), '(unnamed)') AS name,
               count(*) AS records
        FROM public.ganit_vendors v
        WHERE v.org_id = $1::uuid AND v.is_active = TRUE
        GROUP BY 1
        HAVING count(*) > 1
        ORDER BY count(*) DESC, 1
        LIMIT 25
        """,
        org_id,
    )

    out = {
        "as_at": today.isoformat(),
        "windows": {
            "same_amount_days_apart": near_days,
            "same_amount_different_numbers": wide_days,
            "bills_considered_from": since.isoformat(),
        },
        "pairs": pairs,
        "counts": {
            "pairs": len(pairs),
            "by_matcher": by_matcher,
            "amount_at_risk_if_every_pair_is_a_duplicate": round(at_risk, 2),
        },
        "what_the_amount_means": (
            "`amount_at_risk_if_every_pair_is_a_duplicate` adds the LARGER "
            "still-unpaid side of each pair, never both sides. If a pair really "
            "is one bill entered twice, one of the two is genuinely owed and "
            "only the other is money leaving for nothing — and where one of them "
            "is already settled, the whole of the unpaid twin is at risk. It is "
            "an upper bound over unconfirmed candidates, and a bill entered "
            "THREE times appears in more than one pair and is counted more than "
            "once."
        ),
        "blind_spots": {
            "vendor_names_on_more_than_one_record": [
                {"vendor": r["name"], "records": int(r["records"])}
                for r in dup_vendor_names
            ],
            "why": (
                "Every matcher groups on the vendor RECORD. A bill entered twice "
                "against two records that share a name is invisible to all three. "
                "Merging the records, or checking those suppliers by hand, is the "
                "only way to see it."
            ),
        },
        "limitations": [
            "Nothing here confirms a duplicate. These are candidates, ranked, "
            "with the reason each was raised. The two documents decide it.",
            "`internal_ref` is assigned one per bill row and differs on every "
            "pair in the ledger, so it carries no duplicate signal at all. It is "
            "reported on each row only so a person can find the two records; it "
            "is never used as evidence.",
            "Pairs only, never groups. A bill entered three times appears as "
            "three pairs rather than one group of three, so the pair count "
            "exceeds the number of distinct bills involved.",
            "Cancelled bills, inactive bills and bills at or below zero are out "
            "of scope entirely — a cancelled duplicate is already handled.",
            "Amounts are compared exactly and within one currency. A duplicate "
            "re-keyed with a rounding difference, or the same bill entered once "
            "in INR and once in another currency, is not matched.",
        ],
        "caveats": [],
    }

    if len(rows) == limit:
        out["caveats"].append(
            f"Capped at {limit} pairs, strongest matcher first. There may be more "
            f"below the cap — this is a floor, not the whole ledger."
        )
    if not pairs:
        out["caveats"].append(
            f"No candidate duplicate found within the windows checked "
            f"({near_days} days for an amount match, {wide_days} days where the "
            f"supplier numbers disagree). That is a finding, not a skipped check."
        )
    return out


# ═══════════════════════════════════════════════════════════════════════════
# 3 · pack_collection_messages
# ═══════════════════════════════════════════════════════════════════════════
#
# A ready-to-send message per overdue invoice, with a real `upi://pay` link and
# the payload for a QR that encodes the same string.
#
# ── WHICH APP THE CUSTOMER PAYS ON IS NOT KNOWABLE ─────────────────────────
#
# The obvious design — "pick the customer's UPI app" — cannot be built, because
# the product records the ORG's RECEIVING addresses and nothing about the
# customer's wallet. No column anywhere holds a customer VPA or a preference. So
# each message carries the org's DEFAULT receiving address first and every other
# one after it, and the customer pays from whatever app they have. UPI is
# interoperable: any of these addresses is payable from any app.
#
# `staging.org_upi_accounts` is one row PER PLATFORM (PhonePe / Google Pay /
# Paytm / BHIM / Amazon Pay / other), because a firm holding accounts at three
# platforms has three that settle and reconcile separately. It is not one VPA
# field; `organisations.upi_vpa` is only the fallback for an org recorded before
# migration 129.
#
# ── THE QR PAYLOAD IS A STRING, AND STAYS A STRING ─────────────────────────
#
# `qr_payload` is the exact `upi://pay?…` text a QR encoder should encode, and it
# is byte-identical to `pay_uri` on the same row — one string, two ways to hand
# it over, so a code that pays the wrong account and a button that pays the right
# one cannot appear on the same message. NO IMAGE IS GENERATED: images cost
# $0.036-0.040 a call and are 79% of this product's AI spend to date, and a
# collection pack needs none. `phonepe://` and `paytmmp://` deep links are NOT
# UPI QR codes and are never emitted — bank scanners reject them.
#
# ── DELIVERY IS EMAIL. FULL STOP. ──────────────────────────────────────────
#
# WhatsApp is not a Niyam channel and no organisation on this system holds a
# WABA, so a pack that produced WhatsApp text would be producing something with
# no way to send it. Each message carries `to_email`, or says on the row that
# there is none rather than quietly dropping it.
#
# ── THERE IS NO GATEWAY, SO NOTHING HERE CONFIRMS A PAYMENT ────────────────
#
# `payment_status` only ever changes from bank reconciliation. Every message says
# so in one line, which is cheaper than the "I paid, why does it still say
# unpaid" exchange it prevents.

#: The common per-transaction ceiling on a UPI collect, in rupees.
#:
#: A HINT, not a rule, and marked as one on every row it touches. The real limit
#: is set by the PAYER's bank and app and ranges from ₹25,000 to ₹5,00,000
#: depending on the category; NPCI publishes no single number binding every
#: participant. It is here because the seeded org's overdue invoices average
#: about ₹1.46 lakh, so a link built without a word of warning would be declined
#: at the app for a large share of them and the firm would blame the link.
UPI_TXN_CEILING = 100000.0


async def pack_collection_messages(
    pool,
    org_id: str,
    min_days_overdue: int = 1,
    limit: int = 100,
) -> dict:
    """One ready-to-send collection email per overdue invoice.

    *min_days_overdue* is the age at which an invoice earns a message. It
    defaults to 1 rather than 0 so an invoice due today is not chased today.

    Returns {as_at, receiving_addresses, messages, counts, how_to_send,
             limitations, caveats}.
    """
    today = utc_now().date()
    min_days_overdue = max(0, int(min_days_overdue or 0))

    org = await pool.fetchrow(
        "SELECT name, upi_vpa, upi_payee_name "
        "  FROM public.organisations WHERE id = $1::uuid",
        org_id,
    )
    org_name = (org["name"] if org else None) or "your supplier"

    # `org_upi_accounts` arrived with migration 129 and may not exist on a
    # database that has not had it. `routers/pay.py` probes the same way and
    # falls back to the single column, so a payment page and this pack offer the
    # same thing against the older schema. Probed each run rather than cached:
    # a cached FALSE would keep every pack on the fallback until a redeploy.
    upi_rows = []
    has_table = await pool.fetchval(
        "SELECT to_regclass('org_upi_accounts') IS NOT NULL"
    )
    if has_table:
        upi_rows = await pool.fetch(
            "SELECT platform, vpa, payee_name, is_default "
            "  FROM public.org_upi_accounts "
            " WHERE org_id = $1::uuid AND is_active = TRUE "
            " ORDER BY is_default DESC, sort_order, platform",
            org_id,
        )

    from services import upi as upi_service

    addresses: list[dict] = []
    address_source = "org_upi_accounts"
    for r in upi_rows:
        addresses.append({
            "platform": r["platform"],
            "label": upi_service.label(r["platform"]),
            "vpa": r["vpa"],
            "payee_name": (r["payee_name"] or "").strip() or org_name,
            "is_default": bool(r["is_default"]),
        })
    if not addresses:
        fallback = ((org["upi_vpa"] if org else None) or "").strip()
        if fallback:
            address_source = "organisations.upi_vpa (pre-migration-129 fallback)"
            addresses.append({
                "platform": "other",
                "label": upi_service.label("other"),
                "vpa": fallback,
                "payee_name": ((org["upi_payee_name"] if org else None) or "").strip()
                              or org_name,
                "is_default": True,
            })
        else:
            address_source = "none recorded"

    rows = await pool.fetch(
        """
        SELECT i.invoice_number,
               i.invoice_date,
               i.due_date,
               ($2::date - i.due_date)                          AS days_overdue,
               COALESCE(i.total, 0)                             AS total,
               COALESCE(i.balance_due, 0)                       AS balance_due,
               COALESCE(i.amount_paid, 0)                       AS amount_paid,
               COALESCE(NULLIF(btrim(i.currency), ''), 'INR')   AS currency,
               i.payment_status,
               COALESCE(i.doc_status, '')                       AS doc_status,
               COALESCE(i.pay_token, '')                        AS pay_token,
               COALESCE(NULLIF(btrim(ct.email), ''), '')        AS to_email,
               COALESCE(NULLIF(btrim(ct.name), ''), '')         AS contact_name,
               COALESCE(NULLIF(btrim(cl.name), ''),
                        NULLIF(btrim(ct.company), ''),
                        NULLIF(btrim(ct.name), ''), '')         AS bill_to
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_contacts ct
               ON ct.id = i.contact_id AND ct.org_id = i.org_id
        LEFT JOIN public.graha_clients cl
               ON cl.id = ct.client_id AND cl.org_id = ct.org_id
        WHERE i.org_id = $1::uuid
          AND i.is_active = TRUE
          AND i.cancelled_at IS NULL
          -- A credit note REDUCES what is owed. Chasing one would ask a customer
          -- to pay money the firm owes THEM.
          AND i.invoice_type = 'tax_invoice'
          AND COALESCE(i.doc_status, '') <> 'draft'
          AND i.payment_status IN ('unpaid', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
          AND i.due_date IS NOT NULL
          AND i.due_date <= ($2::date - $3::int)
        ORDER BY i.due_date, COALESCE(i.balance_due, 0) DESC
        LIMIT $4
        """,
        org_id, today, min_days_overdue, limit,
    )

    # Deferred import: `services.invoice_email` pulls in the whole mail stack at
    # module scope, and a skill module that imports it at module scope cannot be
    # imported without it. The shareability rule lives THERE and is not
    # reimplemented here — `routers/pay.py` refuses anything not final/sent/
    # viewed and anything already settled, and a fourth copy of that rule is
    # exactly the duplication `invoice_email`'s own docstring warns about.
    from services.invoice_email import pay_link as _pay_link

    messages = []
    total_owed = 0.0
    no_email = 0
    no_link = 0
    over_ceiling = 0

    for r in rows:
        due = _money(r["balance_due"])
        total_owed += due
        days = int(r["days_overdue"] or 0)
        number = r["invoice_number"] or "(unnumbered)"
        currency = r["currency"]

        link = _pay_link({
            "pay_token": r["pay_token"],
            "doc_status": r["doc_status"],
            "payment_status": r["payment_status"],
        })
        if not link:
            no_link += 1

        faults = []
        if not r["to_email"]:
            no_email += 1
            faults.append(
                "no email address on the customer record — this message has "
                "nowhere to go. Email is the only channel: WhatsApp is not a "
                "Niyam channel and no organisation here holds a WABA."
            )
        if currency != "INR":
            faults.append(
                f"the invoice is in {currency}. UPI settles in rupees only, so "
                f"no pay link or QR payload is offered for this one."
            )
        if not addresses:
            faults.append(
                "this organisation has recorded no UPI receiving address, so the "
                "message carries no way to pay."
            )
        if due > UPI_TXN_CEILING:
            over_ceiling += 1
            faults.append(
                f"₹{due:,.2f} is above the ₹{UPI_TXN_CEILING:,.0f} a UPI collect "
                f"is commonly capped at. The exact limit is the PAYER's bank and "
                f"app, not ours — the link may simply be declined at the app, so "
                f"offer a bank transfer alongside it."
            )

        # The note is what the customer sees on the payment screen and, more
        # usefully, what lands beside the credit on the firm's own statement.
        # There is no gateway, so that string is the ONLY thing attribution has.
        note = f"{number} {org_name}"[:60]

        pay_options = []
        if currency == "INR":
            for a in addresses:
                uri = upi_service.pay_uri(a["vpa"], a["payee_name"], due, note)
                pay_options.append({
                    "platform": a["platform"],
                    "label": a["label"],
                    "account_shown_as": a["payee_name"],
                    "vpa": a["vpa"],
                    "is_default": a["is_default"],
                    "pay_uri": uri,
                    # Byte-identical to `pay_uri` on purpose. One string, handed
                    # over two ways — see the section header.
                    "qr_payload": uri,
                })

        greeting = r["contact_name"] or r["bill_to"] or "there"
        lines = [
            f"Hi {greeting},",
            "",
            f"Invoice {number} from {org_name} was due on {r['due_date']} and is "
            f"now {days} day{'s' if days != 1 else ''} overdue.",
            f"Amount outstanding: {currency} {due:,.2f}"
            + (f" (of {currency} {_money(r['total']):,.2f} invoiced)."
               if _money(r["amount_paid"]) > 0 else "."),
        ]
        if link:
            lines += ["", f"View and pay online: {link}"]
        if pay_options:
            head = pay_options[0]
            lines += [
                "",
                f"Or pay by UPI to {head['account_shown_as']} at {head['vpa']}"
                + (f" ({head['label']})" if len(pay_options) > 1 else "")
                + ".",
            ]
            if len(pay_options) > 1:
                lines.append(
                    "Other UPI addresses: "
                    + ", ".join(f"{o['vpa']} ({o['label']})" for o in pay_options[1:])
                    + ". Any of them is payable from any UPI app."
                )
        lines += [
            "",
            "Payments are confirmed against our bank statement, so the status may "
            "take a day to update after you pay.",
            "",
            f"Thank you,\n{org_name}",
        ]

        messages.append({
            "bill_to": r["bill_to"] or "(customer name unavailable)",
            "to_email": r["to_email"] or None,
            "channel": "email",
            "invoice_number": number,
            "invoice_date": r["invoice_date"].isoformat() if r["invoice_date"] else None,
            "due_date": r["due_date"].isoformat() if r["due_date"] else None,
            "days_overdue": days,
            "currency": currency,
            "amount_due": due,
            "subject": f"Invoice {number} from {org_name} — {currency} {due:,.2f} overdue",
            "body": "\n".join(lines),
            "pay_link": link,
            "pay_options": pay_options,
            "faults": faults,
        })

    out = {
        "as_at": today.isoformat(),
        "receiving_addresses": {
            "source": address_source,
            "addresses": addresses,
            "note": (
                "These are the ORGANISATION's receiving addresses, one per "
                "platform. Which app a customer pays FROM is not recorded "
                "anywhere in this product and cannot be — so every message "
                "offers the default first and the rest after it, and any of them "
                "is payable from any UPI app."
            ),
        },
        "messages": messages,
        "counts": {
            "messages": len(messages),
            "total_outstanding_on_the_messages_listed": round(total_owed, 2),
            "without_an_email_address": no_email,
            "without_a_pay_link": no_link,
            "above_the_upi_ceiling": over_ceiling,
        },
        "how_to_send": (
            "EMAIL ONLY. `subject` and `body` are plain text; the escaping choke "
            "points in `email_service.py` (`_safe_subject`, `html.escape`) apply "
            "at send time, so nothing here should be pasted into an HTML template "
            "by hand. This handler SENDS NOTHING — it writes no row and hands off "
            "no message."
        ),
        "limitations": [
            "There is no payment gateway and there will not be one. Nothing here "
            "can confirm a payment, and `payment_status` changes only when a bank "
            "statement is reconciled — every message says so.",
            "`qr_payload` is a string for an encoder, not an image. It is the same "
            "`upi://pay` text as `pay_uri` on the same row.",
            "A pay link is a bearer capability in a URL. Each message's link "
            "belongs to that message's recipient and to nobody else; forwarding "
            "the pack forwards every customer's link.",
            "`total_outstanding_on_the_messages_listed` covers only the invoices "
            "in this pack. It is NOT the ledger's receivables balance.",
        ],
        "caveats": [],
    }

    if not addresses:
        # The loudest line on the output when it applies. A pack of beautifully
        # worded messages that offers no way to pay is worse than no pack.
        out["caveats"].insert(0, (
            f"THIS ORGANISATION HAS RECORDED NO UPI RECEIVING ADDRESS. All "
            f"{len(messages)} message(s) carry a pay link but no UPI ID and no QR "
            f"payload. Settings → Organisation → UPI IDs is where that is fixed; "
            f"until it is, every message asks for money without saying where to "
            f"send it."
        ))
    if no_email:
        out["caveats"].append(
            f"{no_email} message(s) have no email address on the customer record "
            f"and cannot be sent. They are listed with the fault named on the row "
            f"rather than dropped."
        )
    if no_link:
        out["caveats"].append(
            f"{no_link} invoice(s) carry no shareable pay link — either no token "
            f"was minted (rows created before migration 128) or the document is in "
            f"a state `routers/pay.py` refuses to serve. Those messages still "
            f"carry the UPI details."
        )
    if len(rows) == limit:
        out["caveats"].append(
            f"Capped at {limit} invoices, oldest-due first. There are more overdue "
            f"invoices than are listed here, and the outstanding total above "
            f"covers ONLY the ones listed."
        )
    if not messages:
        out["caveats"].append(
            f"No invoice is more than {min_days_overdue} day(s) overdue as at "
            f"{today.isoformat()}. That is a finding, not a skipped check."
        )
    return out


# ═══════════════════════════════════════════════════════════════════════════
# 4 · check_invoice_series_and_splits
# ═══════════════════════════════════════════════════════════════════════════
#
# TWO DEFECTS THAT KILL A GSTR-1, AND ONE TRAP THAT KILLS THE SKILL.
#
# The defects: a break in the outward serial (Rule 46(b) requires a consecutive
# serial number unique for the financial year), and tax charged under the wrong
# heads (CGST+SGST on an inter-State supply, or IGST on an intra-State one).
#
# ── THE TRAP: A GAP CHECK THAT DOES NOT UNDERSTAND THE SERIES CRIES WOLF ────
#
# A naive check asks "are all numbers from 1 to the highest present?" and every
# firm fails it every April, because the series is expected to restart. A skill
# that cries wolf in April is a skill nobody runs in May.
#
# The brief for this handler said the series RESETS ON 1 APRIL. Measured
# read-only against the live database on 2026-08-20, IT DOES NOT — not in this
# product. `utils.next_doc_number` mints `PREFIX-{calendar year}-{n+1}`, where n
# is read off the newest row by `created_at`: it stamps the CALENDAR year and it
# never restarts the counter, at April or at any other time. Live proof — the
# seeded org's FY 2026-27 opens at `INV-2026-0002`, and the other org's series
# runs `INV-2026-0001` .. `INV-2026-0089` straight through 1 April 2026 with no
# break at all. So a check that ASSUMED an April reset would have been wrong in
# the OTHER direction: it would have reported numbers 1..149 "missing" from the
# new year at a firm whose series simply carried on.
#
# Worse, one org holds several DIFFERENT series shapes at once: 18 monthly books
# (`INV-2504-001`..`INV-2504-030`, then `INV-2505-…`, through `INV-2608-…`), a
# calendar-year book (`INV-2026-nnnn`) from the allocator, and a separate credit
# note book (`CN-2026-nnnn`). Any single assumption about the shape is wrong for
# most of that org.
#
# ── SO THE UNIT IS THE BOOK, AND THE FLOOR IS WHAT IS THERE ────────────────
#
#   1. A number is split into a BOOK (everything before its trailing digits) and
#      a SEQUENCE (those digits). `INV-2504-007` -> book `INV-2504-`, seq 7.
#      That handles a monthly book, a calendar-year book, an FY book like
#      `INV-2026-27-`, and a bare number, with no rule about any of them written
#      down anywhere.
#   2. Gaps are looked for ONLY between the lowest and the highest sequence
#      ACTUALLY PRESENT in that book inside the financial year. NEVER FROM 1.
#      That is the whole April fix: a book carrying on across 1 April opens the
#      year at 150, and 1..149 are not missing — they are last year's.
#   3. Each book reports `continues_from_an_earlier_year`, so a reader is SHOWN
#      which of the two behaviours their series has rather than told which one
#      it ought to have.
#
# ── OCCUPANCY IS WIDER THAN VALIDITY, DELIBERATELY ─────────────────────────
#
# Cancelled invoices, soft-deleted invoices and drafts all HOLD their number.
# Rule 46(b) asks for the serial to be accounted for, not used, so a cancelled
# number is not a gap — and counting it as one would send a firm hunting for a
# document it correctly voided. They are read for occupancy and flagged, and the
# defect sections exclude them.
#
# ── AND IT REFUSES RATHER THAN TRUNCATES ───────────────────────────────────
#
# A capped read does not under-report gaps, it INVENTS them: every row past the
# cap becomes a hole. So when the cap is hit the gap section does not run at all
# and says which half did not run. Duplicates are still reported, because
# truncation can only under-report those.
#
# ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
#
# Blank place of supply and missing HSN already ship inside
# `check_gstr1_readiness` and are NOT re-implemented. An invoice whose place of
# supply cannot be read is counted here as unjudgeable and pointed at that skill;
# it is never listed as a defect twice under two names, because a preparer who
# fixes one list and finds the same rows waiting in another stops trusting both.

#: The row cap for the series scan. Deliberately far larger than the 200 the
#: other handlers use, and NOT a truncation point: see the section header. One
#: seeded org has 311 tax invoices in the current financial year, so a cap of 200
#: would have manufactured gaps on the very first run.
_SERIES_ROW_CAP = 5000

#: Only tax documents. Rule 46(b) is about the tax invoice series; a quotation or
#: a proforma is not a supply and a break in its numbering is not a statutory
#: defect. `invoice_type` on this table is only ever tax_invoice or credit_note,
#: and each carries its own book, so nothing further needs filtering by type.
_TAX_DOCUMENTS = ("tax_invoice", "credit_note")

#: Trailing digit run: `INV-2504-007` -> ('INV-2504-', '007').
#:
#: Split on the trailing digits rather than on the last hyphen, so a number with
#: no separator, one with two, or one whose book itself contains digits
#: (`INV-2026-27-0001`) all resolve the same way and no format has to be declared
#: anywhere. The lazy prefix means the match lands on the LAST digit run, which
#: is the sequence.
_TAIL = re.compile(r"^(.*?)(\d+)\s*$")


def _split_number(number: str) -> tuple[str, int, int] | None:
    """('INV-2504-', 7, 3) — book, sequence, printed width. None if unparseable."""
    m = _TAIL.match((number or "").strip())
    if not m:
        return None
    return m.group(1), int(m.group(2)), len(m.group(2))


def _range_label(lo: int, hi: int, width: int) -> str:
    if lo == hi:
        return f"{lo:0{width}d}"
    return f"{lo:0{width}d}–{hi:0{width}d} ({hi - lo + 1} numbers)"


def _as_ranges(missing: list[int], width: int) -> list[str]:
    """[7,8,9,14] -> ['007–009 (3 numbers)', '014'].

    Ranges rather than a flat list, because a firm that changed its numbering
    mid-year can be missing hundreds of consecutive slots and a report that
    prints them one per line buries the single real gap two screens down.
    """
    out: list[str] = []
    start = prev = None
    for n in missing:
        if start is None:
            start = prev = n
            continue
        if n == prev + 1:
            prev = n
            continue
        out.append(_range_label(start, prev, width))
        start = prev = n
    if start is not None:
        out.append(_range_label(start, prev, width))
    return out


def _counter_mates(books: dict) -> dict[str, set[str]]:
    """Books that are sharing ONE counter, printed under two prefixes.

    ── THE FALSE ALARM THIS EXISTS TO KILL ─────────────────────────────────

    `utils.next_doc_number` reads the newest row in `ganit_invoices` by
    `created_at` with NO prefix filter and adds one. So a credit note minted
    after an invoice takes the invoice series' next number and prints it as
    `CN-2026-0032`; the invoice book then never issues 0032 at all. Both books
    are complete and neither has lost a document.

    Measured read-only on 2026-08-20 before this function existed, the seeded
    org reported 117 MISSING NUMBERS across its `INV-2026-` and `CN-2026-`
    books — 21 in one and 96 in the other — and every single one of them was
    sitting in the other book. A report that hands a CA 117 lost tax invoices
    on its first run is a report that gets the whole marketplace switched off.

    ── THE TEST, AND WHY IT IS NOT "SAME YEAR IN THE PREFIX" ───────────────

    Two books are counter-mates when their sequence sets are DISJOINT and their
    ranges OVERLAP. Disjoint because one counter cannot issue the same number to
    two documents; overlapping because two unrelated books that merely happen to
    sit at different heights are not sharing anything.

    String-matching the prefixes would have been easier and wrong: the same org
    also holds eighteen monthly books (`INV-2604-`, `INV-2605-`, …) that each run
    001–030 independently. Those overlap perfectly and their sets are IDENTICAL,
    not disjoint, so this test correctly leaves them alone while a prefix rule
    would have paired them and suppressed real gaps.
    """
    keys = list(books)
    mates: dict[str, set[str]] = {k: set() for k in keys}
    for i, a in enumerate(keys):
        sa = set(books[a]["seen"])
        for b in keys[i + 1:]:
            sb = set(books[b]["seen"])
            if sa & sb:
                continue
            if max(min(sa), min(sb)) <= min(max(sa), max(sb)):
                mates[a].add(b)
                mates[b].add(a)
    return mates


async def check_invoice_series_and_splits(
    pool,
    org_id: str,
    financial_year: str | None = None,
    limit: int = 200,
) -> dict:
    """Serial gaps and duplicates in a financial year, and wrong tax heads.

    *financial_year* is '2026-27' and defaults to the year containing the period
    currently being filed — August's GSTR-1 is filed in September, so the default
    follows the return calendar rather than the wall clock. It must have a
    default or the dispatcher refuses every scheduled run.

    *limit* caps the DEFECT LIST for the tax-head section only, and the count
    beside it is never capped. The series scan has its own, much larger cap and
    refuses to report gaps at all if it is reached — see `_SERIES_ROW_CAP`.

    Returns {financial_year, series, tax_heads, counts, limitations, caveats}.
    """
    from services import statute
    from services.gstr1_json import parse_state_code, supplier_state_code
    from services.skills.timeutil import return_period

    today = utc_now().date()

    if not financial_year:
        # The month being FILED, not the month we are in. GSTR-1 for August is
        # due on 11 September, so somebody opening this in September is working
        # on August — and August belongs to FY 2026-27. Derived from the period
        # rather than from `today` so the answer does not flip on 1 April for a
        # preparer who is still finishing March.
        year, month_no = (int(p) for p in return_period().split("-", 1))
        start_year = year if month_no >= 4 else year - 1
        financial_year = f"{start_year}-{(start_year + 1) % 100:02d}"

    try:
        fy_start, fy_end = statute.fy_bounds(financial_year)
    except statute.StatuteError as exc:
        return {"error": str(exc)}

    org = await pool.fetchrow(
        "SELECT name, gstin, state_code, billing_address "
        "  FROM public.organisations WHERE id = $1::uuid",
        org_id,
    )
    # GSTIN first — the first two characters of a registration ARE the state
    # code, so it needs no name lookup and cannot disagree with itself. Then the
    # declared column, then the billing address. `supplier_state_code` already
    # implements exactly that order; a second implementation here would drift.
    supplier_state = supplier_state_code(dict(org) if org else {})

    # THE WINDOW IS THREE FINANCIAL YEARS, AND ONLY THE MIDDLE ONE IS REPORTED.
    #
    # The adjacent years are read for OCCUPANCY alone. Without them, a book that
    # carries on across 1 April — which is exactly what this product's allocator
    # produces — reports every number it used in the neighbouring year as a hole
    # in this one. Measured before this window existed: the second seeded org's
    # `INV-2026-` book reported 23 numbers "missing" from FY 2026-27, and all 23
    # are sitting in the ledger dated in FY 2025-26. That is the April false
    # alarm arriving in August, and it is the failure this whole handler is
    # shaped around.
    scan_from = date(fy_start.year - 1, 4, 1)
    scan_to = date(fy_end.year + 1, 3, 31)

    scanned = await pool.fetch(
        """
        SELECT i.invoice_number,
               i.invoice_date,
               i.invoice_type,
               i.is_igst,
               COALESCE(i.is_export, FALSE)                     AS is_export,
               COALESCE(btrim(i.place_of_supply), '')           AS place_of_supply,
               COALESCE(i.doc_status, '')                       AS doc_status,
               (i.cancelled_at IS NOT NULL)                     AS cancelled,
               COALESCE(i.is_active, TRUE)                      AS is_active,
               COALESCE(i.cgst, 0)                              AS cgst,
               COALESCE(i.sgst, 0)                              AS sgst,
               COALESCE(i.igst, 0)                              AS igst,
               COALESCE(i.total, 0)                             AS total,
               (i.invoice_date >= $2::date
                AND i.invoice_date <= $3::date)                 AS in_year
        FROM public.ganit_invoices i
        WHERE i.org_id = $1::uuid
          AND i.invoice_type = ANY($6::text[])
          AND i.invoice_date >= $4::date
          AND i.invoice_date <= $5::date
        -- NO is_active or cancelled_at filter, deliberately. A cancelled or
        -- withdrawn row still HOLDS its serial, and treating its number as
        -- missing would send a firm hunting for a document it correctly voided.
        -- Both flags come back on the row so the defect sections can exclude
        -- what they must.
        ORDER BY i.invoice_number
        LIMIT $7
        """,
        org_id, fy_start, fy_end, scan_from, scan_to,
        list(_TAX_DOCUMENTS), _SERIES_ROW_CAP,
    )

    truncated = len(scanned) == _SERIES_ROW_CAP
    rows = [r for r in scanned if r["in_year"]]

    # ── A · the series, book by book ────────────────────────────────────────
    books: dict[str, dict] = {}
    neighbouring: dict[str, set[int]] = {}
    unparseable: list[str] = []
    for r in scanned:
        parsed = _split_number(r["invoice_number"] or "")
        if not parsed:
            if r["in_year"]:
                unparseable.append(r["invoice_number"] or "(blank)")
            continue
        book, seq, width = parsed
        if not r["in_year"]:
            neighbouring.setdefault(book, set()).add(seq)
            continue
        slot = books.setdefault(book, {
            "seen": {},
            "widths": set(),
            "first_date": None,
            "last_date": None,
        })
        slot["seen"].setdefault(seq, []).append(r)
        slot["widths"].add(width)
        day = r["invoice_date"]
        if day:
            if slot["first_date"] is None or day < slot["first_date"]:
                slot["first_date"] = day
            if slot["last_date"] is None or day > slot["last_date"]:
                slot["last_date"] = day

    mates = _counter_mates(books)

    series = []
    total_missing = 0
    total_shared = 0
    total_adjacent = 0
    total_duplicates = 0
    for book, slot in sorted(books.items()):
        seqs = sorted(slot["seen"])
        lo, hi = seqs[0], seqs[-1]
        width = max(slot["widths"])

        duplicates = []
        for seq in seqs:
            if len(slot["seen"][seq]) > 1:
                total_duplicates += 1
                duplicates.append({
                    "number": f"{book}{seq:0{width}d}",
                    "rows": [
                        {
                            "invoice_number": d["invoice_number"],
                            "invoice_date": (d["invoice_date"].isoformat()
                                             if d["invoice_date"] else None),
                            "type": d["invoice_type"],
                            "cancelled": bool(d["cancelled"]),
                            "withdrawn": not bool(d["is_active"]),
                            "doc_status": d["doc_status"],
                        }
                        for d in slot["seen"][seq]
                    ],
                })

        entry = {
            "book": book or "(no prefix)",
            # The year rides on the finding as well as the envelope, because an
            # acknowledgement is filed against the finding alone: without it,
            # "this book's gap is explained" said about FY26 would silence the
            # same book's gaps in FY27. See `services/skill_ack_wiring.py`.
            "financial_year": financial_year,
            "numbers_present": len(seqs),
            "lowest_in_year": f"{lo:0{width}d}",
            "highest_in_year": f"{hi:0{width}d}",
            "first_document_dated": (slot["first_date"].isoformat()
                                     if slot["first_date"] else None),
            "last_document_dated": (slot["last_date"].isoformat()
                                    if slot["last_date"] else None),
            # The reader is SHOWN which behaviour their series has rather than
            # told which one it ought to have. A book opening at 1 restarted; a
            # book opening at 150 carried on from the previous year, which is
            # what this product's allocator actually does.
            "continues_from_an_earlier_year": lo > 1,
            "duplicates": duplicates,
            "cancelled_numbers_held": sum(
                1 for s in seqs for d in slot["seen"][s] if d["cancelled"]),
            "drafts_holding_a_number": sum(
                1 for s in seqs for d in slot["seen"][s]
                if d["doc_status"] == "draft"),
        }

        if truncated:
            entry["gaps"] = None
            entry["gaps_not_computed_because"] = (
                "the read hit its row cap, and a capped population invents gaps "
                "rather than missing them. Narrow the financial year and run "
                "again."
            )
        else:
            # EVERY ABSENT NUMBER IS CLASSIFIED, AND ONLY THE UNEXPLAINED ONES
            # ARE CALLED GAPS. The two explanations are not excuses; each is a
            # measured behaviour of this product, and both were producing
            # hundreds of false alarms before they were handled.
            mate_seqs: set[int] = set()
            for other in mates[book]:
                # `books[other]["seen"]`, never `books[other]` — the slot is a
                # dict of metadata whose KEYS are the strings 'seen', 'widths',
                # 'first_date', 'last_date'. Iterating it built a set of those
                # four words, which no integer ever matches, so every explained
                # number silently fell through to `missing` and the whole
                # shared-counter suppression did nothing at all. It looked
                # correct and reported 117 phantom gaps.
                mate_seqs |= set(books[other]["seen"])
            neighbour_seqs = neighbouring.get(book, set())

            missing, shared, adjacent = [], [], []
            for n in range(lo, hi + 1):
                if n in slot["seen"]:
                    continue
                if n in mate_seqs:
                    shared.append(n)
                elif n in neighbour_seqs:
                    adjacent.append(n)
                else:
                    missing.append(n)

            total_missing += len(missing)
            total_shared += len(shared)
            total_adjacent += len(adjacent)
            entry["gaps"] = _as_ranges(missing, width)
            entry["missing_count"] = len(missing)
            if shared:
                entry["numbers_taken_by_another_book"] = _as_ranges(shared, width)
                entry["numbers_taken_by_another_book_note"] = (
                    f"{len(shared)} number(s) absent from this book are in use by "
                    f"{', '.join(sorted(b or '(no prefix)' for b in mates[book]))} "
                    f"in the same year. `utils.next_doc_number` reads the newest "
                    f"row in `ganit_invoices` by created_at with NO prefix "
                    f"filter, so every document type in one organisation draws "
                    f"from ONE counter and prints it under its own prefix. These "
                    f"are not missing documents and are not counted as gaps."
                )
            if adjacent:
                entry["numbers_used_in_an_adjacent_year"] = _as_ranges(adjacent, width)
                entry["numbers_used_in_an_adjacent_year_note"] = (
                    f"{len(adjacent)} number(s) absent from this financial year "
                    f"exist in this same book dated in the year before or after. "
                    f"The book spans 1 April; the documents are in the ledger and "
                    f"are not counted as gaps."
                )
            if len(slot["widths"]) > 1:
                entry["inconsistent_width"] = (
                    "this book mixes numbers of different printed widths ("
                    + ", ".join(str(w) for w in sorted(slot["widths"]))
                    + " digits), which is a Rule 46(b) presentation smell rather "
                    "than a gap — the sequence itself is intact."
                )
        series.append(entry)

    # ── B · CGST/SGST vs IGST against the place of supply ───────────────────
    #
    # This compares the DECLARED flag against the DECLARED place of supply. It
    # does not know the true place of supply, which for services turns on s.12
    # and on whether the recipient is registered — so a row this calls correct
    # can still be wrong, and a row it flags is a disagreement INSIDE the record
    # rather than a determination of law. Both halves are on `limitations`.
    #
    # The COUNT and the LIST are produced in one pass. An earlier shape computed
    # the count with a second comprehension repeating the predicate, which is two
    # implementations of one rule sitting six lines apart — and the second one
    # had already lost the flag-versus-amounts case.
    head_defects = []
    head_defect_total = 0
    unjudgeable_pos = 0
    exports_skipped = 0
    judged = 0
    tax_at_stake = 0.0

    if supplier_state:
        for r in rows:
            if r["cancelled"] or not r["is_active"] or r["doc_status"] == "draft":
                continue
            if r["is_export"]:
                # Zero-rated, outside the intra/inter test entirely.
                exports_skipped += 1
                continue

            pos = parse_state_code(r["place_of_supply"])
            if not pos:
                # Blank or unreadable. Counted, never listed — that defect
                # already ships in `check_gstr1_readiness`.
                unjudgeable_pos += 1
                continue

            judged += 1
            inter_state = pos != supplier_state
            is_igst = bool(r["is_igst"])
            cgst, sgst, igst = _money(r["cgst"]), _money(r["sgst"]), _money(r["igst"])

            defect = detail = None
            if inter_state and not is_igst:
                defect = "igst_was_due_cgst_sgst_charged"
                detail = (
                    f"place of supply {pos} is outside state {supplier_state}, so "
                    f"this is an inter-State supply and IGST was due. The document "
                    f"carries CGST ₹{cgst:,.2f} + SGST ₹{sgst:,.2f}."
                )
                tax_at_stake += cgst + sgst
            elif not inter_state and is_igst:
                defect = "cgst_sgst_were_due_igst_charged"
                detail = (
                    f"place of supply {pos} is the supplier's own state, so this "
                    f"is an intra-State supply and CGST+SGST were due. The "
                    f"document carries IGST ₹{igst:,.2f}."
                )
                tax_at_stake += igst
            elif is_igst and igst <= 0 and (cgst > 0 or sgst > 0):
                defect = "flag_and_amounts_disagree"
                detail = (
                    f"is_igst is set but the row carries no IGST and does carry "
                    f"CGST ₹{cgst:,.2f} + SGST ₹{sgst:,.2f}. The flag and the "
                    f"amounts describe two different supplies."
                )
            elif not is_igst and igst > 0 and cgst <= 0 and sgst <= 0:
                defect = "flag_and_amounts_disagree"
                detail = (
                    f"is_igst is clear but the row carries IGST ₹{igst:,.2f} and "
                    f"no CGST or SGST."
                )

            if not defect:
                continue

            head_defect_total += 1
            if len(head_defects) >= limit:
                # The COUNT keeps rising; only the list stops. A headline that
                # matched the truncated list would read as the whole population.
                continue
            head_defects.append({
                "invoice_number": r["invoice_number"],
                "invoice_date": (r["invoice_date"].isoformat()
                                 if r["invoice_date"] else None),
                "type": r["invoice_type"],
                "defect": defect,
                "detail": detail,
                "place_of_supply_as_recorded": r["place_of_supply"],
                "place_of_supply_state_code": pos,
                "supplier_state_code": supplier_state,
                "cgst": cgst, "sgst": sgst, "igst": igst,
                "invoice_total": _money(r["total"]),
            })

    # The form number and the due day come from the dated statute table, never
    # from a literal here. `as_of` is the last day of the year being reported on
    # — the date the obligation arises — not the date this is being run.
    gstr1 = await statute.obligation(pool, "gst.return.gstr1", as_of=fy_end) or {}

    out = {
        "financial_year": financial_year,
        "year_runs": {"from": fy_start.isoformat(), "to": fy_end.isoformat()},
        "as_at": today.isoformat(),
        "documents_examined": len(rows),
        "series": series,
        "tax_heads": {
            "supplier_state_code": supplier_state or None,
            "defects": head_defects,
            "defect_count": head_defect_total,
            "documents_judged": judged,
            "place_of_supply_unreadable": unjudgeable_pos,
            "exports_excluded": exports_skipped,
            "tax_on_the_wrong_head": round(tax_at_stake, 2),
        },
        "counts": {
            "books": len(series),
            "missing_numbers": None if truncated else total_missing,
            "numbers_explained_by_a_shared_counter": None if truncated else total_shared,
            "numbers_explained_by_an_adjacent_year": (
                None if truncated else total_adjacent),
            "duplicate_numbers": total_duplicates,
            "unparseable_numbers": len(unparseable),
            "documents_read_including_adjacent_years": len(scanned),
        },
        "where_it_goes": (
            (gstr1.get("title") or "GSTR-1 — outward supplies")
            + (f", {gstr1['section_ref']}" if gstr1.get("section_ref") else "")
            + (f", due on the {gstr1['due_day']}th of the month following the tax "
               f"period." if gstr1.get("due_day") else ".")
            + " The serial requirement itself is Rule 46(b): a consecutive serial "
              "number, unique for the financial year."
        ),
        "how_gaps_are_measured": (
            "Per BOOK — everything before a number's trailing digits — and only "
            "between the lowest and highest number actually present in that book "
            "inside this financial year. NEVER from 1: a series that carries on "
            "across 1 April (which is what this product's allocator does) opens "
            "the year at whatever it had reached, and those earlier numbers "
            "belong to the previous year, not to a gap. "
            "`continues_from_an_earlier_year` on each book says which behaviour "
            "that book has. An absent number is then only called a GAP once two "
            "explanations are ruled out: it is not in use by another book drawing "
            "on the same counter, and it does not exist in this same book dated "
            "in the adjacent financial year. Both are counted separately and "
            "shown per book."
        ),
        "limitations": [
            "A cancelled, withdrawn or draft invoice HOLDS its number and is "
            "never counted as a gap. Rule 46(b) asks for the serial to be "
            "accounted for, not used.",
            "Blank place of supply and missing HSN are NOT reported here. They "
            "already ship in `check_gstr1_readiness`, and listing them twice "
            "under two names is how a preparer fixes one list and finds the same "
            "rows waiting in another.",
            "The tax-head test compares the flag on the row against the place of "
            "supply on the row. It does not determine the place of supply in law "
            "— for services that turns on s.12 and on whether the recipient is "
            "registered — so a row it calls correct can still be wrong.",
            "Only tax invoices and credit notes are examined. A quotation or a "
            "proforma is not a supply and a break in its numbering is not a "
            "statutory defect.",
            "A gap is evidence that a number is unaccounted for in THIS ledger. "
            "It is not proof a document is missing: a number issued outside the "
            "system, or a book started and abandoned, looks identical from here.",
            "Adjacent-year occupancy is checked one financial year either side, "
            "no further. A number reissued three years later still reads as a "
            "gap in the year it is absent from — which is the safe direction, "
            "because the alternative is silence about a real hole.",
        ],
        "caveats": [],
    }

    if not supplier_state:
        out["caveats"].append(
            "The tax-head check DID NOT RUN. This organisation's own state could "
            "not be determined from its GSTIN, its state_code column or its "
            "billing address, and without it inter-State cannot be told from "
            "intra-State. Nothing is asserted about any document's tax split. "
            "A GSTIN is not mandatory and its absence blocks nothing else here — "
            "the series check above ran in full."
        )
    if truncated:
        out["caveats"].insert(0, (
            f"THE GAP CHECK DID NOT RUN. The read stopped at {_SERIES_ROW_CAP} "
            f"documents for {financial_year}, and a capped population does not "
            f"miss gaps — it INVENTS them, because every document past the cap "
            f"reads as a hole. The duplicates below are still valid (truncation "
            f"can only under-report those). Narrow the financial year and run "
            f"again."
        ))
    if unparseable:
        out["caveats"].append(
            f"{len(unparseable)} document number(s) end in no digits and could not "
            f"be placed in any series: "
            + ", ".join(sorted(set(unparseable))[:10])
            + ". They are excluded from every figure above."
        )
    if head_defect_total > len(head_defects):
        out["caveats"].append(
            f"{head_defect_total} document(s) carry the wrong tax heads; only the "
            f"first {len(head_defects)} are listed. The COUNT is complete, the "
            f"LIST is not."
        )
    if unjudgeable_pos:
        out["caveats"].append(
            f"{unjudgeable_pos} document(s) have no readable place of supply, so "
            f"their tax split could not be judged either way. That defect belongs "
            f"to `check_gstr1_readiness` and is not repeated here."
        )
    if not truncated and (total_shared or total_adjacent):
        # Said out loud, not silently absorbed. A reader who counts the numbers
        # in a book and finds fewer than the range implies must be able to see
        # where the difference went without opening the code.
        parts = []
        if total_shared:
            parts.append(
                f"{total_shared} "
                + ("is" if total_shared == 1 else "are")
                + " in use by another book drawing on the same counter "
                  "(`utils.next_doc_number` has no prefix filter)"
            )
        if total_adjacent:
            parts.append(
                f"{total_adjacent} "
                + ("exists" if total_adjacent == 1 else "exist")
                + " in the same book dated in the adjacent financial year"
            )
        out["caveats"].append(
            f"{total_shared + total_adjacent} number(s) are absent from their "
            f"book's range in {financial_year} and are NOT gaps: "
            + "; ".join(parts)
            + ". They are listed per book so the arithmetic can be checked."
        )
    if not truncated and not total_missing and not total_duplicates \
            and not head_defect_total and supplier_state:
        out["caveats"].append(
            f"No gap, no duplicate and no wrong tax head across {len(rows)} "
            f"document(s) in {financial_year}. That is a finding, not a skipped "
            f"check."
        )
    return out
