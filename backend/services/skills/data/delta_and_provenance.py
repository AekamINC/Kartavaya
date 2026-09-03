"""
delta_and_provenance — the honest half of three REJECTED catalogue entries.

Folio 70 killed #58, #59 and #61 as written. It did not kill the work under
them; in every case it named the half that survives and the claim that has to
go. This module is that half, and nothing more:

    check_books_moved_since_due   #58 — the VALUE that moved after the return
                                  was due. It predicts no notice.
    brief_gstr9c_books_side       #59 — the 9C applicability test, the figures
                                  this product holds, and an explicit list of
                                  every table it cannot fill.
    brief_content_provenance      #61 — what produced each piece of content,
                                  when, and what the models cost.

Each one is built against a verdict, quoted:

  #58  "Reporting the delta is honest and already lives inside #18. Claiming to
        predict an automated intimation the product cannot see is not."
  #59  "Rejected as a reconciliation, because the other side does not exist in
        this product. A skill that calls itself a reconciliation and compares a
        number to itself will be caught by the first CA who runs it."
  #61  "Rejected from the marketplace, not the roadmap... given images are 79%
        of AI spend, the provenance record doubles as cost attribution."

── #58 IS NOT #18, AND THE DIFFERENCE IS THE POINT ──────────────────────────

`gst_year.check_amendments_before_filing` is #18 and it already lists the
DOCUMENTS that moved after the GSTR-1 due date. This reports the RUPEES, and
the two figures it can honestly report are not the three a reader expects:

  ADDED       knowable. A document that did not exist on the due date and does
              now is worth exactly its total. Credit notes carry a minus.
  CANCELLED   knowable, same way, and worth zero live — see the denominators.
  EDITED      NOT KNOWABLE. Nothing in this product keeps a document's previous
              value. `staging.audit_log` holds 1,308 rows and NOT ONE of them
              has a resource_type touching an invoice, so the change made by an
              edit cannot be recovered from anywhere. The edited figure below is
              the document's CURRENT total, labelled a CEILING on the exposure —
              the real change could be zero (somebody fixed a spelling) or the
              whole amount (somebody rewrote the line items).

Reporting an edited document's total as though it were a delta is the single
confident wrong number this skill could produce, so it is never added into the
net. That separation is the skill.

── AND IT NEVER PREDICTS A NOTICE ───────────────────────────────────────────

There is no departmental integration in this product: no GSTN connection, no
portal scrape, no intimation feed, no ARN, no `filed_at`. Anything shaped like
"this will attract an ASMT-10" would be invention. `predicts_a_departmental_
notice` is on the output as an explicit False so a reader — or a language model
summarising it — cannot borrow the authority the skill does not have.

── #59 PRODUCES ONE COLUMN AND SAYS SO ──────────────────────────────────────

GSTR-9C sets audited financial statements against the annual return. This
product holds neither: no trial balance, no ledger, no financial statements, no
ITC register, and no record of what was filed. So this returns the BOOKS column
only, plus the applicability test and — the deliverable that makes it worth
running — an itemised list of every 9C table it CANNOT fill and why. A preparer
learns in one screen which ten table groups are their own work.

Two things it can do that `brief_annual_return_books` (#20) cannot, and which
are the reason it is a separate skill rather than a rename:

  · TAXABLE VALUE SEPARATED FROM TAX. #20's limitations say there is no
    taxable_value column, which is literally true — but `subtotal` IS the
    taxable value, and on all 787 live documents
    `subtotal + cgst + sgst + igst + cess - discount = total` to the paisa,
    with zero mismatches. 9C asks for the two separately and this splits them.
  · RATE-WISE TAXABLE VALUE, which 9C Table 9 is built on. The rate is not a
    column; it lives on `gst_rate` inside the `line_items` jsonb, present on
    all 1,341 live line items. The line AMOUNT is the messy half — three
    different key shapes across the estate (`amount` 1,027, `line_total` 269,
    and `rate` x `quantity`/`qty` for the rest) — so the rebuild reports its own
    denominator: lines seen, lines valued, and whether the rate split adds back
    to the ledger column. Live it adds back exactly on both orgs that have
    documents. If it ever stops, the output says so rather than printing a
    split that is quietly short.

The statute's own word for what 9C does is absent from every key and every
figure this handler chose for itself. It survives in exactly three places, each
enumerated in the test that enforces it: `what_this_is_not`, which is the
denial; `limitations`, which repeats it; and the `cannot_fill` headings, which
quote the FORM. Table 6 is literally "Reasons for the un-reconciled difference
in annual gross turnover", and paraphrasing that to dodge a string check would
make the list useless to the preparer it exists for.

── #61 IS A COST REPORT WEARING A PROVENANCE COAT ───────────────────────────

The folio is right that provenance removes no manual work and cannot rank as a
marketplace card. What it does is answer a question nobody in this product can
answer today: which model made this, under which template, and what did it
cost. Measured read-only 2026-08-20:

  · `staging.hub_ai_logs.content_item_id` is populated on 0 of 306 rows. The
    column exists, nothing writes it. So a per-ITEM cost does not exist and this
    reports cost per MONTH and per MODEL beside content per TEMPLATE — two
    series that cannot be joined, said out loud rather than multiplied together
    into an invented per-item figure.
  · `hub_ai_logs.org_id` is null on 121 of 306 rows carrying $0.2427 of the
    $2.2058 total spend. Every figure here is therefore a FLOOR for the org.
  · Provenance coverage is uneven and the denominator matters: Unicode Group
    has a model recorded on 102 of 102 items, Aekam Inc on 4 of 4, and the
    seeded org on 0 of 100.

── THE COST TRAP, VERIFIED RATHER THAN REPEATED ─────────────────────────────

The folio's figure is $0.036-$0.040 an image and 79% of all AI spend. Both are
close and one has drifted. Measured 2026-08-20 over `hub_ai_logs`:

    google/gemini-3.1-flash-lite-image   37 calls   $1.3255665   $0.03583 each
    bytedance-seed/seedream-4.5          10 calls   $0.4000000   $0.04000 each
    ─────────────────────────────────────────────────────────────────────────
    images                               47 calls   $1.7255665
    everything else                     259 calls   $0.4802384
    all spend                           306 calls   $2.2058049   images = 78.2%

So the per-image prices hold exactly and the share is 78.2%, not 79% — the text
spend has grown since the 2026-08-19 measurement in `services/image_brief.py`.
Every image call in the log belongs to ONE org and ONE month: Unicode Group,
July 2026, where images are 88.8% of that org's spend.

The armed half of the trap is real and is reported as an EXPOSURE, not as a
charge already incurred:

  · 0 of 46 template rows set `generate_image` on any step, and none carries
    `{image_brief}` in a prompt. Confirmed live. Nothing draws a picture today.
  · `routers/hub.py` (`execute_org_skill`) fires on
    `step.get("generate_image") or generate_images` — and `generate_images` is
    a field on the `SkillRun` request body of `POST /api/hub/org/skills/{id}/run`.
    So a per-RUN override can force a picture onto any assigned skill without
    touching a template row.
  · `services/image_brief.py` already carries template-keyed art direction for
    four statutory skills — `gstr-1-filing-readiness`, `payables-payment-run`,
    `pre-run-payroll-readiness` and `receivables-chase-pack`. One of those,
    Receivables chase pack, is assigned and active on Aekam Inc today.

The handler does not restate that list. It calls `image_brief.art_direction_for`
for each of the org's own assigned skills and reports which ones would resolve
to their OWN art direction rather than to a category or the house default — so
the finding cannot rot when the table in that file changes.

── Measured live, read-only, across all three orgs, 2026-08-20 ──────────────

  #58  Unicode Group, period 2026-06 (GSTR-1 due 11 Jul 2026): 7 of 7 documents
       created after the due date, Rs4,15,360 added net, nothing edited and
       nothing withdrawn. Period 2026-07: 20 documents, nothing moved at all.
       Aekam Inc, 2026-07: 6 documents, nothing moved.
       Seeded org, 2026-07: 29 edited, ceiling Rs68,77,455.36, all 29 stamped
       2026-08-18 — bulk-touch fires at 29 of 29. Same org 2026-06: 30 edited,
       ceiling Rs69,10,847.00, 29 of 30 stamped 2026-08-02, fires again. Both
       are backfills and the output says so before it says anything else.
       Nothing anywhere has ever been added or withdrawn after a due date
       except those seven Unicode Group documents.
  #59  FY 2025-26 taxable value: seeded org Rs7,04,38,000 (GSTR-9C required on
       this figure against a Rs5,00,00,000 threshold, 36 drafts included and
       declared), Unicode Group Rs9,28,700 (not required on this figure),
       Aekam Inc no documents in the year at all. The rate split agreed with
       the ledger column to the paisa on both orgs that have documents — 720
       lines at 18% and 26 lines at 12%/18%. Ten table groups reported
       unfillable in every case.
  #61  Twelve months to 2026-08:
       Unicode Group  102 items, 102 with a model, 30 with a template, 40 with
                      an image. $1.942465 spend, 88.8% of it images, measured
                      at $0.036714 each. One assigned skill and it is content,
                      so nothing is flagged at risk.
       Aekam Inc      4 items, all four with a model AND a template. $0.012349
                      spend, no image ever generated. TEN assigned skills, and
                      FOUR of them are a brief or a pack with their own art
                      direction already written — Monday Morning Brief, Overdue
                      follow-up chase, Pipeline risk review and Receivables
                      chase pack. That is the live exposure.
       Seeded org     100 items with NO model recorded on any of them, no
                      assigned skills at all, $0.008268 spend of which 4 of 8
                      calls failed.

`cancelled_at` is NULL on all 787 live documents and `doc_status` is never
'cancelled', so the cancellation arm of #58 has run against zero rows. It is
reported as "0 of N checked", never as "no cancellations".
"""
import logging
from datetime import date

from services.statute import obligation, obligation_for_fy, fy_bounds, fy_of
from services.skills.timeutil import as_date, utc_now

#: The calendar helpers #18 and #20 already got right, imported rather than
#: copied. `_due_date_from` in particular carries a bug that HAPPENED — it read
#: `due_month_offset` and never `due_month`, and printed GSTR-9 for FY 2025-26
#: as 31 March 2026, nine months early, next to a statute citation. A second
#: implementation of that rule in this file would be a second chance to make it.
from services.skills.data.gst_year import (
    _due_date_from, _period_bounds, _return_period,
)

log = logging.getLogger(__name__)

#: A run of documents all carrying the SAME `updated_at` is a backfill, not a
#: month of amendments. The seeded org has 29 of 30 July documents stamped
#: 2026-08-18 and 29 of 30 June documents stamped 2026-08-02 — one UPDATE each
#: time, not fifty-eight decisions. Below this share the flag stays off, because
#: two documents edited in the same minute is a person working, not a script.
BULK_TOUCH_SHARE = 0.80
BULK_TOUCH_FLOOR = 3

#: How a log row is recognised as an image. `staging.hub_ai_logs` has no
#: modality column — provider and model are all there is — so this is a
#: classification, not a fact, and `image_classified_by_model_name` says so on
#: the output. Every marker below matches a model this product has actually
#: routed to: `_IMAGE_LADDER` in services/ai_router.py is fal FLUX.1 dev/schnell,
#: Recraft V4, FLUX.2 pro and gemini-3.1-flash-lite-image, plus the historic
#: seedream rows in the log.
IMAGE_MODEL_MARKERS = (
    "image", "imagen", "seedream", "recraft", "flux", "dall-e", "stable-diffusion",
)

#: Every GSTR-9C table group this product cannot fill, and the reason. This is
#: the deliverable of #59 — a preparer needs to know which ten groups are their
#: own work before they start, not after.
#:
#: The reasons are structural, not "not built yet": each names the artefact that
#: does not exist anywhere in this product. If one of them ever arrives, the
#: entry comes out of this tuple and the skill grows a column.
CANNOT_FILL = (
    ("5A", "Turnover as declared in the audited annual financial statement",
     "This product holds no financial statements, no trial balance and no "
     "ledger. Nothing in it has been audited."),
    ("5B-5O", "Unbilled revenue, unadjusted advances, deemed supply under "
              "Schedule I, credit notes issued after the year end, trade "
              "discounts, foreign-exchange adjustments and the rest",
     "Every one of these is an adjustment BETWEEN audited accounts and the "
     "return. Neither side of that pair exists here."),
    ("6", "Reasons for the un-reconciled difference in annual gross turnover",
     "A difference needs two figures. Only the books figure exists."),
    ("7A-7D", "The split of turnover into exempted, nil-rated, non-GST and "
              "zero-rated supply",
     "`ganit_invoices.supply_nature` carries the single value 'taxable' on "
     "every live document and `is_export` is false on every one, so no split "
     "can be evidenced. An absent split is reported rather than a zero."),
    ("8", "Reasons for the un-reconciled difference in taxable turnover",
     "Both sides absent, as with table 6."),
    ("9P-9Q, 10, 11", "Tax payable as declared in the annual return, the "
                      "un-reconciled difference, and the amount payable but "
                      "not paid",
     "Nothing in this product records what was filed or what was paid: there "
     "is no ARN, no filed_at, no return log and no challan."),
    ("12", "Input tax credit availed as per the audited annual financial "
           "statement, and as declared in the annual return",
     "There is no ITC ledger and no purchase register carrying an eligibility "
     "flag. `ganit_expenses.tax_amount` is the tax on a bill, which is not the "
     "credit availed on it."),
    ("13, 15, 16", "Reasons for the un-reconciled input tax credit and the tax "
                   "payable on it",
     "Follows table 12 — the credit figure it would explain does not exist."),
    ("14", "Expense-head-wise input tax credit",
     "The heads listed under `expense_heads` below are the organisation's own "
     "free-text categories, not the form's prescribed heads, and the credit "
     "column is absent for the same reason as table 12."),
    ("Part B", "Certification",
     "A person signs this. GSTR-9C has been self-certified rather than "
     "auditor-certified since the date recorded on the calendar row below."),
)


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and every one of these outputs is handed to a reader
    through `json.dumps`."""
    return default if value is None else float(value)


def _r2(value) -> float:
    """Rupees, to the paisa. Two decimals everywhere so a reader never has to
    wonder whether a trailing 0.30000000000000004 is a real fraction."""
    return round(_f(value), 2)


def _statute_cite(row: dict | None, what: str) -> str:
    """One sentence naming the authority for a printed date or figure.

    Deliberately built from `form_number` and `section_ref` and NOT from
    `title`. Two reasons, and the second is specific to #59: a citation is what
    a preparer needs to go and check, and the calendar's title for the 9C row
    is the statute's own name for the form — which contains the one word this
    handler must never apply to its own output. Naming the form by its number
    keeps the citation honest without borrowing the claim.
    """
    if not row:
        return f"The statute calendar records no {what}, so none is shown."
    bits = [b for b in (row.get("form_number"), row.get("section_ref")) if b]
    cite = " · ".join(bits) if bits else (row.get("statute") or "")
    return f"{what}{f' — {cite}' if cite else ''}"


def _month_window_start(today: date, months: int) -> date:
    """The first day of the month `months - 1` months back from `today`.

    Month-aligned rather than `today - 365 days`, because every figure this
    window feeds is grouped BY MONTH. A window that starts on the 20th makes the
    oldest month a two-thirds month, and a two-thirds month next to eleven whole
    ones reads as a fall in spend that never happened.
    """
    total = today.year * 12 + (today.month - 1) - (max(1, months) - 1)
    return date(total // 12, total % 12 + 1, 1)


def _is_image_model(model: str | None) -> bool:
    """Whether a log row is a picture, judged on the model name alone.

    See `IMAGE_MODEL_MARKERS`: the log has no modality column, so this is the
    only evidence there is. It is stated as a classification on every output
    that depends on it.
    """
    name = (model or "").lower()
    return any(marker in name for marker in IMAGE_MODEL_MARKERS)


# ══════════════════════════════════════════════════════════════════════════
# 58 · check_books_moved_since_due
# ══════════════════════════════════════════════════════════════════════════

_MOVED_SQL = """
    SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.total,
           i.doc_status, i.is_active, i.created_at, i.updated_at, i.cancelled_at,
           COALESCE(NULLIF(btrim(cl.name), ''),
                    NULLIF(btrim(ct.company), ''),
                    NULLIF(btrim(ct.name), ''),
                    '(customer not recorded)') AS customer
    FROM public.ganit_invoices i
    LEFT JOIN public.graha_clients  cl
           ON cl.id = i.client_id  AND cl.org_id = i.org_id
    LEFT JOIN public.graha_contacts ct
           ON ct.id = i.contact_id AND ct.org_id = i.org_id
    WHERE i.org_id = $1::uuid
      AND i.invoice_date >= $2::date
      AND i.invoice_date <= $3::date
    ORDER BY i.invoice_date, i.invoice_number
    LIMIT $4::int
"""


async def check_books_moved_since_due(
    pool, org_id: str, period: str | None = None, limit: int = 200,
) -> dict:
    """What the books are worth NOW against what they were worth when due.

    *period* is 'YYYY-MM' and defaults to the period being filed — the PREVIOUS
    month — because August's GSTR-1 is filed in September. It defaults or the
    dispatcher refuses every scheduled run.

    Three movements, and only two of them carry a knowable rupee figure:

      ADDED      a document that did not exist on the due date. Worth its total,
                 negative for a credit note.
      CANCELLED  a document withdrawn after the due date, by `cancelled_at` or
                 by `is_active` going false. Worth minus its total.
      EDITED     a document that existed and changed. WORTH AN UNKNOWN AMOUNT.

    ── WHY THE EDITED FIGURE IS A CEILING AND NOT A DELTA ────────────────────

    No prior value is kept anywhere. `staging.audit_log` carries 1,308 rows and
    not one has a resource_type touching an invoice, so an edit's size cannot be
    recovered. What is shown for the edited bucket is the sum of those
    documents' CURRENT totals — the most the change could possibly have been —
    and it is excluded from `net_known_delta` for exactly that reason.

    ── AND THE BULK-TOUCH FLAG, WHICH IS WHY THIS IS NOT ALARMING ────────────

    An org whose thirty documents all carry one `updated_at` was backfilled, not
    amended thirty times. The flag names the date and the share so a reader does
    not take a migration for a month of corrections. It fires on the seeded org
    and on nothing else.

    ── IT PREDICTS NOTHING ───────────────────────────────────────────────────

    Catalogue #58 was rejected for claiming to foresee an automated intimation.
    There is no GSTN connection in this product and no notice feed of any kind,
    so `predicts_a_departmental_notice` is a hard False on the output and the
    word notice appears nowhere else in it.
    """
    today = utc_now().date()
    period = period or _return_period(today)
    start, end = _period_bounds(period)
    cap = max(1, int(limit))

    gstr1 = await obligation(pool, "gst.return.gstr1", as_of=end)
    due = _due_date_from(gstr1, end)

    rows = await pool.fetch(_MOVED_SQL, org_id, start, end, cap)

    added, edited, withdrawn = [], [], []
    if due is not None:
        for r in rows:
            created = as_date(r["created_at"])
            updated = as_date(r["updated_at"])
            cancelled = as_date(r["cancelled_at"])
            # A credit note reduces outward supply, so it carries a minus into
            # every value below. Summing a credit note as a positive would
            # report a firm's own reversal as fresh turnover that appeared after
            # the return went — the wrong sign on the one number a reader acts on.
            sign = -1.0 if r["invoice_type"] == "credit_note" else 1.0
            supply = _r2(sign * _f(r["total"]))
            entry = {
                "invoice_id": str(r["id"]),
                "document": r["invoice_number"],
                "kind": r["invoice_type"],
                "customer": r["customer"],
                "invoice_date": as_date(r["invoice_date"]),
                "value_now": _r2(r["total"]),
                # The supply this document represents, signed. It is NOT the
                # effect on the return — a withdrawal of a positive invoice is a
                # negative effect — so each bucket sets `effect_on_the_return`
                # itself, and every total below is summed from THAT field. The
                # first cut summed this one and reported a cancelled invoice as
                # value appearing after the filing, with the sign inverted.
                "supply_value": supply,
                "doc_status": r["doc_status"],
                "created_on": created,
                "last_edited": updated,
            }
            # ORDER IS LOAD-BEARING. Withdrawal is tested before editing,
            # because a soft-deleted document also carries a fresh `updated_at`
            # — the deactivation IS the update. Test editing first and every
            # withdrawal lands in the edited bucket, where its value becomes an
            # unknown ceiling instead of the known minus it actually is.
            if cancelled is not None and cancelled > due:
                withdrawn.append({**entry, "why": "cancelled after the due date",
                                  "withdrawn_on": cancelled,
                                  "effect_on_the_return": _r2(-supply)})
            elif (not r["is_active"]) and updated is not None and updated > due:
                # Deactivated rather than formally cancelled. Live this arm has
                # matched nothing — every one of the 787 documents in the
                # product is is_active — which is why the denominator is on the
                # output rather than a bare "no cancellations".
                withdrawn.append({**entry,
                                  "why": "deactivated after the due date",
                                  "withdrawn_on": updated,
                                  "effect_on_the_return": _r2(-supply)})
            elif created is not None and created > due:
                added.append({**entry, "why": "created after the due date",
                              "effect_on_the_return": supply})
            elif (updated is not None and updated > due
                  and created is not None and created <= due):
                edited.append({**entry,
                               "why": "edited after the due date",
                               # Not zero and not the total. There is no prior
                               # value to subtract from, so the honest answer is
                               # that there is no answer.
                               "effect_on_the_return": None,
                               "delta_unknown": True})

    added_net = round(sum(e["effect_on_the_return"] for e in added), 2)
    withdrawn_net = round(sum(e["effect_on_the_return"] for e in withdrawn), 2)
    touched_ceiling = round(sum(abs(e["supply_value"]) for e in edited), 2)

    # The bulk-touch flag. Grouped on the DATE rather than the timestamp: a
    # backfill run in two batches an hour apart is still one backfill, and a
    # reader who has to compare microseconds has not been told anything.
    bulk = None
    if edited:
        by_day: dict[object, int] = {}
        for e in edited:
            by_day[e["last_edited"]] = by_day.get(e["last_edited"], 0) + 1
        day, count = max(by_day.items(), key=lambda kv: kv[1])
        share = count / len(edited)
        if count >= BULK_TOUCH_FLOOR and share >= BULK_TOUCH_SHARE:
            bulk = {
                "date": day,
                "documents": count,
                "share_of_edited": round(share, 3),
                "why": (f"{count} of {len(edited)} edited documents carry the "
                        f"same last-edited date. That is one operation — a "
                        f"backfill or a bulk update — not {count} amendments. "
                        f"The ceiling below is almost certainly meaningless "
                        f"for this period."),
            }

    limitations = [
        "THE RUPEE CHANGE MADE BY AN EDIT IS NOT KNOWABLE HERE. Nothing in this "
        "product keeps a document's previous value — public.audit_log holds no "
        "row of any kind against an invoice — so the edited figure is the sum "
        "of those documents' CURRENT totals. It is a CEILING on the exposure, "
        "it is not a delta, and it is deliberately excluded from the net.",
        "NOTHING RECORDS THAT A PERIOD WAS FILED. There is no filed_at, no ARN "
        "and no return log, so 'the return has gone' is inferred from the "
        "statutory due date having passed. A firm that filed early will see "
        "documents here that it did include.",
        "THIS PREDICTS NO DEPARTMENTAL NOTICE AND NO AUTOMATED INTIMATION. "
        "There is no GSTN connection, no portal reader and no notice feed in "
        "this product, so nothing here can say what a department will do.",
        "Values are document totals INCLUDING tax, not taxable value. "
        "brief_gstr9c_books_side splits the two if that is what you need.",
        "Only this organisation's own documents are read. Anything raised "
        "outside this product is invisible to the check.",
    ]
    if due is None:
        limitations.insert(0,
            "The statute calendar records no due day for GSTR-1 as of "
            f"{end}, so no cutoff could be computed and NOTHING was classified. "
            "This is a gap in the calendar, not a period that did not move.")
    if bulk:
        limitations.insert(0, bulk["why"])

    return {
        "as_at": today,
        "period": period,
        "period_from": start,
        "period_to": end,
        "gstr1_due_on": due,
        "due_date_is_an_inferred_cutoff": True,
        "statute": _statute_cite(gstr1, "GSTR-1 due date"),
        # Hard False, on the output, first-class. #58 was rejected for claiming
        # this and a summariser must not be able to infer it back.
        "predicts_a_departmental_notice": False,
        "value_delta": {
            "added_net": added_net,
            "withdrawn_net": withdrawn_net,
            "net_known_delta": round(added_net + withdrawn_net, 2),
            "edited_value_ceiling": touched_ceiling,
            "edited_value_is_a_ceiling_not_a_delta": True,
            "credit_notes_carry_a_minus": True,
        },
        "added_after_the_due_date": added,
        "edited_after_the_due_date": edited,
        "withdrawn_after_the_due_date": withdrawn,
        "bulk_touch": bulk,
        "neighbouring_skill": (
            "check_amendments_before_filing (#18) lists the DOCUMENTS that "
            "moved and routes them to GSTR-1A. This reports what they are "
            "WORTH. Run that one to act; run this one to size it."),
        "counts": {
            "documents_in_period": len(rows),
            "added": len(added),
            "edited": len(edited),
            "withdrawn": len(withdrawn),
            "documents_checked_for_withdrawal": len(rows) if due is not None else 0,
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
            "classified": due is not None,
        },
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 59 · brief_gstr9c_books_side
# ══════════════════════════════════════════════════════════════════════════

_YEAR_TOTALS_SQL = """
    SELECT
      count(*) FILTER (WHERE invoice_type = 'tax_invoice')                        AS n_invoices,
      count(*) FILTER (WHERE invoice_type = 'credit_note')                        AS n_credit_notes,
      COALESCE(SUM(COALESCE(subtotal, 0))
               FILTER (WHERE invoice_type = 'tax_invoice'), 0)                    AS inv_taxable,
      COALESCE(SUM(COALESCE(subtotal, 0))
               FILTER (WHERE invoice_type = 'credit_note'), 0)                    AS cn_taxable,
      COALESCE(SUM(COALESCE(cgst, 0))
               FILTER (WHERE invoice_type = 'tax_invoice'), 0)                    AS inv_cgst,
      COALESCE(SUM(COALESCE(sgst, 0))
               FILTER (WHERE invoice_type = 'tax_invoice'), 0)                    AS inv_sgst,
      COALESCE(SUM(COALESCE(igst, 0))
               FILTER (WHERE invoice_type = 'tax_invoice'), 0)                    AS inv_igst,
      COALESCE(SUM(COALESCE(cess, 0))
               FILTER (WHERE invoice_type = 'tax_invoice'), 0)                    AS inv_cess,
      COALESCE(SUM(COALESCE(cgst, 0) + COALESCE(sgst, 0)
                 + COALESCE(igst, 0) + COALESCE(cess, 0))
               FILTER (WHERE invoice_type = 'credit_note'), 0)                    AS cn_tax,
      COALESCE(SUM(COALESCE(discount, 0)), 0)                                     AS discount,
      COALESCE(SUM(COALESCE(total, 0))
               FILTER (WHERE invoice_type = 'tax_invoice'), 0)                    AS inv_total,
      COALESCE(SUM(COALESCE(total, 0))
               FILTER (WHERE invoice_type = 'credit_note'), 0)                    AS cn_total,
      count(*) FILTER (WHERE doc_status = 'draft')                                AS n_draft,
      count(*) FILTER (WHERE COALESCE(is_export, FALSE))                          AS n_export,
      count(*) FILTER (WHERE line_items IS NULL
                          OR jsonb_typeof(line_items) <> 'array')                 AS n_without_lines
    FROM public.ganit_invoices
    WHERE org_id = $1::uuid
      AND is_active
      AND invoice_date >= $2::date
      AND invoice_date <= $3::date
"""

#: Rate-wise taxable value, rebuilt from the line_items jsonb.
#:
#: Every value is regex-guarded before it is cast. A single '' or 'N/A' in one
#: line of one document would otherwise take the whole run down with
#: `invalid input syntax for type numeric` — and the failure would be in an org
#: nobody was looking at. `count(amount)` next to `count(*)` is the denominator:
#: a line with no usable amount is COUNTED and then excluded from the sum, so
#: the caller can see the split is short rather than believing a low figure.
_RATEWISE_SQL = """
    WITH lines AS (
      SELECT i.invoice_type,
             CASE WHEN (e->>'gst_rate') ~ '^-?[0-9]+([.][0-9]+)?$'
                  THEN round((e->>'gst_rate')::numeric, 2) END AS rate,
             COALESCE(
               CASE WHEN (e->>'amount') ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (e->>'amount')::numeric END,
               CASE WHEN (e->>'line_total') ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (e->>'line_total')::numeric END,
               CASE WHEN (e->>'rate') ~ '^-?[0-9]+([.][0-9]+)?$'
                     AND COALESCE(NULLIF(e->>'quantity', ''),
                                  NULLIF(e->>'qty', ''), '1')
                           ~ '^-?[0-9]+([.][0-9]+)?$'
                    THEN (e->>'rate')::numeric
                         * COALESCE(NULLIF(e->>'quantity', ''),
                                    NULLIF(e->>'qty', ''), '1')::numeric END
             ) AS amount
      FROM public.ganit_invoices i,
           LATERAL jsonb_array_elements(i.line_items) e
      WHERE i.org_id = $1::uuid
        AND i.is_active
        AND i.invoice_date >= $2::date
        AND i.invoice_date <= $3::date
        AND jsonb_typeof(i.line_items) = 'array'
    )
    SELECT rate, invoice_type,
           count(*)          AS lines_seen,
           count(amount)     AS lines_valued,
           COALESCE(SUM(amount), 0) AS taxable_value
    FROM lines
    GROUP BY 1, 2
    ORDER BY 1 NULLS LAST, 2
    LIMIT $4::int
"""

_EXPENSE_HEADS_SQL = """
    SELECT COALESCE(NULLIF(btrim(e.category), ''), '(no head recorded)') AS head,
           count(*)                                     AS entries,
           COALESCE(SUM(COALESCE(e.amount, 0)), 0)      AS net_of_tax,
           COALESCE(SUM(COALESCE(e.tax_amount, 0)), 0)  AS tax_on_the_bill
    FROM public.ganit_expenses e
    WHERE e.org_id = $1::uuid
      AND e.is_active
      AND e.expense_date >= $2::date
      AND e.expense_date <= $3::date
    GROUP BY 1
    ORDER BY 3 DESC
    LIMIT $4::int
"""


async def brief_gstr9c_books_side(
    pool, org_id: str, financial_year: str | None = None, limit: int = 200,
) -> dict:
    """The GSTR-9C applicability test, the books figures, and the ten gaps.

    *financial_year* is '2025-26' and defaults to the most recently ENDED year,
    which is the one with a live deadline: 9C for a year is due on the same day
    as the annual return following it, so from April onwards the year a preparer
    means is the one that just closed.

    ── WHAT THIS IS, IN ONE LINE ─────────────────────────────────────────────

    One column, plus a map of the ten table groups that are the preparer's own
    work. GSTR-9C sets audited financial statements against the annual return;
    this product holds neither, and a skill that pretended otherwise would
    compare a number to itself and be caught by the first CA who ran it.

    ── WHAT IT ADDS OVER #20 ─────────────────────────────────────────────────

    `brief_annual_return_books` reports document totals including tax. 9C is
    built on taxable value and tax SEPARATELY, and on taxable value BY RATE:

      · `subtotal` is the taxable value, and on all 787 live documents
        subtotal + cgst + sgst + igst + cess - discount equals total exactly.
      · the rate lives on `gst_rate` inside `line_items`, and the split rebuilt
        from it adds back to the ledger column exactly on live data. When it
        does not, `rate_split.agrees_with_the_ledger_column` goes false and the
        shortfall is printed rather than swallowed.

    ── THE APPLICABILITY VERDICT IS STILL A FLOOR ────────────────────────────

    GST aggregate turnover is PAN-level across every registration and includes
    exempt supplies, exports and stock transfers. This is one organisation's
    invoices in one product, so an org that reads "not required on this figure"
    can still be required on its real aggregate. That is on `limitations`, not
    only in this docstring.
    """
    today = utc_now().date()
    if not financial_year:
        this_fy = fy_of(today)
        start_year = int(this_fy.split("-")[0])
        financial_year = f"{start_year - 1}-{str(start_year)[-2:]}"
    fy_start, fy_end = fy_bounds(financial_year)
    cap = max(1, int(limit))

    gstr9c = await obligation_for_fy(pool, "gst.return.gstr9c", financial_year)
    gstr9 = await obligation_for_fy(pool, "gst.return.gstr9", financial_year)

    totals = await pool.fetchrow(_YEAR_TOTALS_SQL, org_id, fy_start, fy_end)
    rate_rows = await pool.fetch(_RATEWISE_SQL, org_id, fy_start, fy_end, cap)
    heads = await pool.fetch(_EXPENSE_HEADS_SQL, org_id, fy_start, fy_end, cap)

    totals = dict(totals) if totals else {}
    inv_taxable = _f(totals.get("inv_taxable"))
    cn_taxable = _f(totals.get("cn_taxable"))
    net_taxable = round(inv_taxable - cn_taxable, 2)
    inv_tax = sum(_f(totals.get(k)) for k in
                  ("inv_cgst", "inv_sgst", "inv_igst", "inv_cess"))
    net_tax = round(inv_tax - _f(totals.get("cn_tax")), 2)

    # ONE row per figure, named by the 9C table that wants it, so a preparer can
    # read down the form and down this list at the same time.
    books = [
        {"table": "5N / 7E", "line": "Taxable value of outward supply, per books",
         "value": _r2(inv_taxable), "documents": totals.get("n_invoices", 0),
         "basis": "ganit_invoices.subtotal, tax invoices"},
        {"table": "5J", "line": "Taxable value of credit notes issued",
         "value": _r2(cn_taxable), "documents": totals.get("n_credit_notes", 0),
         "basis": "ganit_invoices.subtotal, credit notes"},
        {"table": "7E", "line": "Taxable value net of credit notes",
         "value": net_taxable, "documents": None,
         "basis": "the two lines above"},
        {"table": "9 (CGST)", "line": "Central tax charged, per books",
         "value": _r2(totals.get("inv_cgst")), "documents": None,
         "basis": "ganit_invoices.cgst"},
        {"table": "9 (SGST)", "line": "State tax charged, per books",
         "value": _r2(totals.get("inv_sgst")), "documents": None,
         "basis": "ganit_invoices.sgst"},
        {"table": "9 (IGST)", "line": "Integrated tax charged, per books",
         "value": _r2(totals.get("inv_igst")), "documents": None,
         "basis": "ganit_invoices.igst"},
        {"table": "9 (Cess)", "line": "Cess charged, per books",
         "value": _r2(totals.get("inv_cess")), "documents": None,
         "basis": "ganit_invoices.cess"},
        {"table": "9", "line": "Tax net of credit notes",
         "value": net_tax, "documents": None,
         "basis": "the four lines above, less credit-note tax"},
    ]

    # The rate split, and its own denominator beside it.
    split, lines_seen, lines_valued = [], 0, 0
    for r in rate_rows:
        lines_seen += int(r["lines_seen"] or 0)
        lines_valued += int(r["lines_valued"] or 0)
        sign = -1.0 if r["invoice_type"] == "credit_note" else 1.0
        split.append({
            "rate_percent": None if r["rate"] is None else _f(r["rate"]),
            "kind": r["invoice_type"],
            "taxable_value": _r2(sign * _f(r["taxable_value"])),
            "lines_seen": int(r["lines_seen"] or 0),
            "lines_valued": int(r["lines_valued"] or 0),
        })
    split_total = round(sum(s["taxable_value"] for s in split), 2)
    # Half a rupee, not zero: two numeric columns summed by different routes in
    # Postgres can differ in the last paisa without either being wrong.
    agrees = abs(split_total - net_taxable) < 0.5

    thr9c = _f((gstr9c or {}).get("threshold_amount")) or None
    thr9 = _f((gstr9 or {}).get("threshold_amount")) or None

    applicability = {
        "form": (gstr9c or {}).get("form_number"),
        "threshold": thr9c,
        "books_taxable_value": net_taxable,
        "verdict": (
            "the statute calendar records no threshold, so no verdict is given"
            if thr9c is None else
            ("required on this figure" if net_taxable > thr9c
             else "not required on this figure — but see the PAN-level caveat")),
        "due_on": _due_date_from(gstr9c, fy_end),
        "self_certified_since": (gstr9c or {}).get("effective_from"),
        "statute": _statute_cite(gstr9c, "applicability rule"),
        "stable_across_the_year": (gstr9c or {}).get("stable_across_year"),
        "annual_return_first": {
            "form": (gstr9 or {}).get("form_number"),
            "threshold": thr9,
            "verdict": (
                "the statute calendar records no threshold, so no verdict is given"
                if thr9 is None else
                ("required on this figure" if net_taxable > thr9
                 else "optional on this figure")),
            "why_it_matters": (
                "GSTR-9C accompanies the annual return. If the annual return is "
                "not required, the question below it does not arise."),
        },
    }

    limitations = [
        "THIS IS THE BOOKS COLUMN AND NOTHING ELSE. The other side of GSTR-9C "
        "is the audited annual financial statement, which does not exist "
        "anywhere in this product — no ledger, no trial balance, no statements. "
        "A skill that produced both columns from these same rows would be "
        "comparing a number to itself.",
        "AGGREGATE TURNOVER IS PAN-LEVEL across every registration on one PAN "
        "and includes exempt supplies, exports and stock transfers. The figure "
        "above is one organisation's invoices in one product, so it is a FLOOR: "
        "'not required on this figure' can still be 'required' on the real "
        "aggregate.",
        "Turnover here is measured on INVOICE DATE within the financial year. "
        "9C is answered on the same year, but a document dated in the year and "
        "entered later still counts — check_books_moved_since_due sizes that.",
        f"{len(CANNOT_FILL)} table groups cannot be filled at all and are "
        f"listed under `cannot_fill` with the reason for each. Read that list "
        f"before you start: it is most of the form.",
    ]
    if totals.get("n_draft"):
        limitations.append(
            f"{totals['n_draft']} document(s) in the year are still in draft and "
            f"ARE included in these totals. Whether a draft belongs in an annual "
            f"figure is a decision, not a fact, so nothing is dropped silently.")
    if totals.get("n_without_lines"):
        limitations.append(
            f"{totals['n_without_lines']} document(s) carry no line-item array, "
            f"so they contribute to the ledger totals and NOT to the rate split.")
    if not agrees:
        limitations.insert(0,
            f"THE RATE SPLIT IS SHORT. It adds to {split_total} against a ledger "
            f"taxable value of {net_taxable} — a difference of "
            f"{round(net_taxable - split_total, 2)}. {lines_valued} of "
            f"{lines_seen} line items carried a usable amount. Use the ledger "
            f"figure, not the split, until this is explained.")
    if not gstr9c:
        limitations.insert(0,
            f"The statute calendar records no GSTR-9C obligation for "
            f"{financial_year}, so no applicability test was run and no due "
            f"date is shown.")
    if not totals.get("n_invoices") and not totals.get("n_credit_notes"):
        limitations.insert(0,
            f"NO DOCUMENTS AT ALL were found for {financial_year}. Every figure "
            f"below is zero because nothing was read, which is not the same as "
            f"a year of nil supply.")

    return {
        # FIRST key, deliberately, and the only place outside `limitations`
        # where the statute's own word for this form is used at all.
        "what_this_is_not": (
            "This is NOT a reconciliation. GSTR-9C sets audited financial "
            "statements against the annual return, and this product holds "
            "neither — no ledger, no trial balance, no financial statements, no "
            "ITC register and no record of what was filed. What follows is the "
            "books column, the applicability test, and a list of the tables "
            "that cannot be filled from here."),
        "as_at": today,
        "financial_year": financial_year,
        "year_from": fy_start,
        "year_to": fy_end,
        "applicability": applicability,
        "books_figures": books,
        "rate_split": {
            "rows": split,
            "total_taxable_value": split_total,
            "ledger_taxable_value": net_taxable,
            "difference": round(net_taxable - split_total, 2),
            "agrees_with_the_ledger_column": agrees,
            "lines_seen": lines_seen,
            "lines_valued": lines_valued,
            "basis": ("rebuilt from gst_rate inside ganit_invoices.line_items; "
                      "there is no rate column"),
        },
        "expense_heads": [
            {
                "head": h["head"],
                "entries": h["entries"],
                "net_of_tax": _r2(h["net_of_tax"]),
                "tax_on_the_bill": _r2(h["tax_on_the_bill"]),
                "credit_availed": None,
            }
            for h in heads
        ],
        "cannot_fill": [
            {"table": t, "the_form_asks_for": asks, "why_not_here": why}
            for t, asks, why in CANNOT_FILL
        ],
        "counts": {
            "documents_read": (totals.get("n_invoices", 0) or 0)
                              + (totals.get("n_credit_notes", 0) or 0),
            "drafts_included": totals.get("n_draft", 0),
            "documents_without_line_items": totals.get("n_without_lines", 0),
            "export_documents": totals.get("n_export", 0),
            "rate_bands": len(split),
            "expense_heads": len(heads),
            "tables_that_cannot_be_filled": len(CANNOT_FILL),
            "capped_at": cap,
            "was_capped": len(heads) >= cap or len(rate_rows) >= cap,
        },
        "limitations": limitations,
    }


# ══════════════════════════════════════════════════════════════════════════
# 61 · brief_content_provenance
# ══════════════════════════════════════════════════════════════════════════

#: The join from a content item to the template that produced it.
#:
#: `hub_skill_templates` has no org_id — it is the shared catalogue — so the
#: tenant boundary is carried by `hub_org_skill_runs` and `hub_org_skills`,
#: both of which are matched on org_id as well as on the key.
#:
#: The uuid cast is regex-guarded. `metadata->>'skill_run_id'` is free-form
#: jsonb written by the run loop; one malformed value would raise
#: `invalid input syntax for type uuid` and take down a report about spend.
_CONTENT_SQL = """
    SELECT c.id, c.title, c.agent_type, c.created_at, c.credits_used,
           (COALESCE(c.image_url, '') <> '') AS has_image,
           c.metadata->>'model'    AS model,
           c.metadata->>'provider' AS provider,
           c.metadata->>'skill'    AS content_skill,
           t.name     AS template_name,
           t.module   AS template_module,
           t.category AS template_category
    FROM public.hub_content_items c
    LEFT JOIN public.hub_org_skill_runs r
           ON r.id = CASE
                WHEN c.metadata->>'skill_run_id' ~
                     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN (c.metadata->>'skill_run_id')::uuid END
          AND r.org_id = c.org_id
    LEFT JOIN public.hub_org_skills s
           ON s.id = r.org_skill_id AND s.org_id = r.org_id
    LEFT JOIN public.hub_skill_templates t
           ON t.id = s.template_id
    WHERE c.org_id = $1::uuid
      AND c.created_at >= $2::date
    ORDER BY c.created_at DESC
    LIMIT $3::int
"""

_SPEND_SQL = """
    SELECT to_char(l.created_at, 'YYYY-MM') AS month,
           l.provider, l.model, l.status,
           count(*)                        AS calls,
           COALESCE(SUM(l.cost_usd), 0)    AS cost_usd
    FROM public.hub_ai_logs l
    WHERE l.org_id = $1::uuid
      AND l.created_at >= $2::date
    GROUP BY 1, 2, 3, 4
    ORDER BY 1, 6 DESC
"""

_ASSIGNED_SQL = """
    SELECT t.name, t.category, t.module, t.skill_type, s.is_active,
           jsonb_array_length(t.steps) AS steps,
           (SELECT count(*) FROM jsonb_array_elements(t.steps) st
             WHERE lower(COALESCE(st->>'generate_image', '')) IN ('true', 't', '1'))
             AS steps_asking_for_an_image
    FROM public.hub_org_skills s
    JOIN public.hub_skill_templates t ON t.id = s.template_id
    WHERE s.org_id = $1::uuid
      AND jsonb_typeof(t.steps) = 'array'
    ORDER BY t.name
    LIMIT $2::int
"""

_IMAGE_PRICE_SQL = """
    SELECT credits FROM public.credit_prices
    WHERE kind = 'image' AND is_active
    LIMIT 1
"""


def _art_direction_state(name: str | None, category: str | None) -> str:
    """Which art direction a picture for this template would resolve to.

    Read from `services.image_brief.art_direction_for`, never restated. The four
    statutory templates the folio names carry their OWN direction in that file
    today, and a hardcoded list of them here would be wrong the first time
    somebody edits it — which is exactly the drift this reports.

    Returns 'own' when the template has direction written for it by name,
    'inherited' when it falls back to a category or the house default, and
    'unknown' when the module could not be read at all. The last is a real
    answer and is never silently folded into 'inherited'.
    """
    try:
        from services.image_brief import art_direction_for, slug
    except Exception:                                        # pragma: no cover
        log.warning("image_brief unavailable; art direction not resolved")
        return "unknown"
    try:
        key, _direction = art_direction_for(template_name=name, category=category)
    except Exception:                                        # pragma: no cover
        return "unknown"
    return "own" if key and key == slug(name) else "inherited"


async def brief_content_provenance(
    pool, org_id: str, months: int = 12, limit: int = 200,
) -> dict:
    """Every generated item, what made it, and what the models cost.

    *months* is the window and defaults to twelve, month-aligned so the oldest
    bucket is a whole month rather than a stub that reads as a fall in spend.

    ── THE TWO SERIES DO NOT JOIN, AND THAT IS THE HEADLINE ──────────────────

    `staging.hub_ai_logs.content_item_id` is populated on 0 of 306 rows across
    the whole product. The column exists; nothing writes it. So there is no
    per-item cost anywhere, and this returns two series side by side — content
    by TEMPLATE, spend by MONTH and MODEL — with `cost_attribution` saying
    plainly that they cannot be multiplied together. Dividing a month's dollars
    by a month's items would produce a number that looks like a unit cost and
    is not one.

    ── IMAGES ARE THE MONEY ──────────────────────────────────────────────────

    Measured across the product on 2026-08-20: 47 image calls cost $1.7256 of
    $2.2058 total, 78.2%, at $0.0358 and $0.0400 each. That is why the image
    columns are broken out of every bucket here rather than left inside a
    provider total.

    ── AND THE EXPOSURE IS NOT THE SAME AS THE CHARGE ────────────────────────

    No template row asks for a picture today — 0 of 46, confirmed live. But the
    run endpoint takes a per-request `generate_images` flag that ORs with the
    step flag, and `services/image_brief.py` already carries art direction keyed
    by template name. `image_cost_exposure` reports which of THIS org's assigned
    skills would resolve to their OWN direction if that flag were ever set, and
    prices it from the org's own measured spend rather than from a number in a
    comment.

    The sharp half of that list is `operational_skills_at_risk`. Every template
    in the catalogue has bespoke art direction — that is by design and it is
    right for a festival greeting. It is not right for a check, a brief or a
    pack, which nobody posts and nobody sees outside the firm: a decorative
    cover on a monthly compliance brief costs the measured price of an image
    and buys nothing at all. Those are separated out by `skill_type`.
    """
    today = utc_now().date()
    window = max(1, min(60, int(months)))
    window_start = _month_window_start(today, window)
    cap = max(1, int(limit))

    items = await pool.fetch(_CONTENT_SQL, org_id, window_start, cap)
    spend_rows = await pool.fetch(_SPEND_SQL, org_id, window_start)
    assigned = await pool.fetch(_ASSIGNED_SQL, org_id, cap)
    image_credits = await pool.fetchval(_IMAGE_PRICE_SQL)

    # ── content, by template and by month ────────────────────────────────────
    by_template: dict[str, dict] = {}
    by_month: dict[str, dict] = {}
    with_model = with_template = with_image = 0
    listed = []

    for r in items:
        month = f"{as_date(r['created_at']):%Y-%m}" if r["created_at"] else "unknown"
        model = r["model"]
        template = r["template_name"]
        if model:
            with_model += 1
        if template:
            with_template += 1
        if r["has_image"]:
            with_image += 1

        # "(no template recorded)" rather than the agent_type, which would read
        # as a template that does not exist. 100 of the seeded org's items have
        # no run id at all and must not be silently attributed to anything.
        key = template or "(no template recorded)"
        bucket = by_template.setdefault(key, {
            "template": key,
            "module": r["template_module"],
            "category": r["template_category"],
            "items": 0, "credits": 0, "images": 0,
            "models": [], "items_with_no_model": 0,
        })
        bucket["items"] += 1
        bucket["credits"] += int(r["credits_used"] or 0)
        bucket["images"] += 1 if r["has_image"] else 0
        if model and model not in bucket["models"]:
            bucket["models"].append(model)
        if not model:
            bucket["items_with_no_model"] += 1

        m = by_month.setdefault(month, {
            "month": month, "items": 0, "credits": 0, "images": 0,
            "calls": 0, "failed_calls": 0,
            "spend_usd": 0.0, "image_spend_usd": 0.0,
        })
        m["items"] += 1
        m["credits"] += int(r["credits_used"] or 0)
        m["images"] += 1 if r["has_image"] else 0

        listed.append({
            "content_id": str(r["id"]),
            "title": r["title"],
            "made_on": as_date(r["created_at"]),
            "agent_type": r["agent_type"],
            "template": template,
            "model": model,
            "provider": r["provider"],
            "credits_charged": int(r["credits_used"] or 0),
            "has_image": bool(r["has_image"]),
            "provenance_recorded": bool(model),
        })

    # ── spend, by month and by model ─────────────────────────────────────────
    by_model: dict[str, dict] = {}
    total_usd = image_usd = 0.0
    calls = failed = image_calls = 0

    for r in spend_rows:
        month = r["month"] or "unknown"
        cost = _f(r["cost_usd"])
        n = int(r["calls"] or 0)
        is_image = _is_image_model(r["model"])
        ok = (r["status"] == "success")

        total_usd += cost
        calls += n
        if not ok:
            failed += n
        if is_image:
            image_usd += cost
            image_calls += n

        m = by_month.setdefault(month, {
            "month": month, "items": 0, "credits": 0, "images": 0,
            "calls": 0, "failed_calls": 0,
            "spend_usd": 0.0, "image_spend_usd": 0.0,
        })
        m["calls"] += n
        m["spend_usd"] = round(m["spend_usd"] + cost, 6)
        if not ok:
            m["failed_calls"] += n
        if is_image:
            m["image_spend_usd"] = round(m["image_spend_usd"] + cost, 6)

        key = r["model"] or "(model not recorded)"
        b = by_model.setdefault(key, {
            "model": key, "provider": r["provider"], "is_image": is_image,
            "calls": 0, "failed_calls": 0, "cost_usd": 0.0, "cost_each_usd": None,
        })
        b["calls"] += n
        b["cost_usd"] = round(b["cost_usd"] + cost, 6)
        if not ok:
            b["failed_calls"] += n

    for b in by_model.values():
        billed = b["calls"] - b["failed_calls"]
        # Averaged over the calls that were CHARGED. A failed rung that cost
        # nothing would otherwise drag a real unit price down and make the next
        # picture look cheaper than it is.
        b["cost_each_usd"] = round(b["cost_usd"] / billed, 6) if billed else None

    measured_image_each = None
    billed_images = [b for b in by_model.values()
                     if b["is_image"] and b["cost_each_usd"]]
    if billed_images:
        measured_image_each = round(
            sum(b["cost_usd"] for b in billed_images)
            / sum(b["calls"] - b["failed_calls"] for b in billed_images), 6)

    # ── the image exposure on this org's own assigned skills ─────────────────
    exposure, asking_now = [], 0
    for a in assigned:
        state = _art_direction_state(a["name"], a["category"])
        asking = int(a["steps_asking_for_an_image"] or 0)
        asking_now += asking
        exposure.append({
            "skill": a["name"],
            "module": a["module"],
            "category": a["category"],
            "type": a["skill_type"],
            "assigned_and_active": bool(a["is_active"]),
            "steps": a["steps"],
            "steps_asking_for_an_image": asking,
            "art_direction": state,
        })
    own_direction = [e["skill"] for e in exposure if e["art_direction"] == "own"]
    # A check, a brief or a pack is internal reading. Nobody posts it and nobody
    # outside the firm sees it, so a picture on one is pure cost. `content` is
    # the only skill_type where a picture is the point. Live, every one of the
    # 46 templates resolves to its own direction, so the undifferentiated list
    # above says almost nothing — this one is the finding.
    at_risk = [e["skill"] for e in exposure
               if e["art_direction"] == "own" and e["type"] != "content"]

    limitations = [
        "COST CANNOT BE ATTRIBUTED TO A SINGLE ITEM. "
        "public.hub_ai_logs.content_item_id is written on NO row anywhere in "
        "this product, so the content series and the spend series below share "
        "only a month. Dividing one by the other produces a figure that looks "
        "like a unit cost and is not one.",
        "SPEND IS A FLOOR. Rows in hub_ai_logs with no org_id exist and carry "
        "real dollars; they are outside this organisation's boundary and are "
        "not read here, so the true figure for this org is at least this much.",
        "A call is called an image on the strength of its MODEL NAME. There is "
        "no modality column on the log. A future image model whose name carries "
        "none of the usual markers would be counted as text.",
        f"Provenance is recorded on {with_model} of {len(items)} items and a "
        f"template is named on {with_template}. Items written before the run "
        f"loop stored metadata carry neither, and they are shown as "
        f"'(no template recorded)' rather than guessed at.",
        "Credits and dollars are different currencies and are never added. "
        "Credits are what the organisation was charged; dollars are what Aekam "
        "paid a provider.",
    ]
    if asking_now == 0 and at_risk:
        priced = (f"about ${measured_image_each:.4f} on this org's own measured "
                  f"spend" if measured_image_each
                  else "$0.0358-$0.0400 on the product's measured spend")
        limitations.append(
            f"No assigned skill asks for a picture today, and that is the "
            f"TEMPLATE state ONLY. POST /api/hub/org/skills/{{id}}/run accepts a "
            f"generate_images flag which is OR'd with the step flag, so one "
            f"request can force a picture onto any of them. "
            f"{len(at_risk)} assigned skill(s) here are a check, a brief or a "
            f"pack — internal reading nobody posts — and every one already has "
            f"art direction written for it by name in services/image_brief.py: "
            f"{', '.join(at_risk)}. A cover on one of those costs {priced} and "
            f"buys nothing.")
    elif asking_now:
        limitations.append(
            f"{asking_now} step(s) across this org's assigned skills DO set "
            f"generate_image. Check whether any of them is a check, a brief or "
            f"a pack before the next scheduled run.")
    if len(items) >= cap:
        limitations.append(
            f"The item list was capped at {cap}. The totals above cover only "
            f"the {len(items)} items shown, not everything in the window.")

    return {
        "as_at": today,
        "window_from": window_start,
        "months": window,
        "provenance": {
            "items_seen": len(items),
            "items_with_a_recorded_model": with_model,
            "items_with_a_named_template": with_template,
            "items_with_an_image": with_image,
        },
        "by_template": sorted(by_template.values(),
                              key=lambda b: (-b["items"], b["template"])),
        "by_month": [by_month[k] for k in sorted(by_month)],
        "by_model": sorted(by_model.values(), key=lambda b: -b["cost_usd"]),
        "spend": {
            "total_usd": round(total_usd, 6),
            "image_usd": round(image_usd, 6),
            "text_usd": round(total_usd - image_usd, 6),
            "image_share": round(image_usd / total_usd, 4) if total_usd else None,
            "calls": calls,
            "failed_calls": failed,
            "image_calls": image_calls,
            "image_classified_by_model_name": True,
            "is_a_floor": True,
        },
        "cost_attribution": {
            "content_items_with_a_cost_record": 0,
            "why": ("public.hub_ai_logs.content_item_id exists and is written "
                    "by nothing. Until the generation path sets it, cost can be "
                    "attributed to a month and a model but never to an item, a "
                    "template or a person."),
        },
        "image_cost_exposure": {
            "assigned_skills": len(exposure),
            "steps_asking_for_an_image_today": asking_now,
            "skills_with_their_own_art_direction": own_direction,
            # The list that actually means something. See the docstring: every
            # template has bespoke direction, so the line above does not
            # discriminate. This one is the checks, briefs and packs.
            "operational_skills_at_risk": at_risk,
            "a_run_can_force_an_image": True,
            "how": ("routers/hub.py fires on `step.get('generate_image') or "
                    "generate_images`, and generate_images is a field on the "
                    "SkillRun body of POST /api/hub/org/skills/{id}/run."),
            "measured_cost_per_image_usd": measured_image_each,
            "credits_charged_per_image": (
                None if image_credits is None else int(image_credits)),
            "skills": exposure,
        },
        "items": listed,
        "counts": {
            "items_seen": len(items),
            "items_with_a_recorded_model": with_model,
            "items_with_a_named_template": with_template,
            "templates_named": len([b for b in by_template
                                    if b != "(no template recorded)"]),
            "months_with_activity": len(by_month),
            "models_seen": len(by_model),
            "assigned_skills": len(exposure),
            "operational_skills_at_risk_of_a_paid_cover": len(at_risk),
            "capped_at": cap,
            "was_capped": len(items) >= cap,
        },
        "limitations": limitations,
    }
