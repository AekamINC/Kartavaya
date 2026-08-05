"""Generate invoices from recurring definitions that have fallen due.

── THIS FUNCTION HAD NEVER RUN SUCCESSFULLY ─────────────────────────────────

Its opening SELECT named EIGHT columns that do not exist on
`staging.ganit_recurring`: `line_items` (the column is `template_items`),
`cgst`, `sgst`, `igst`, `cess` (there is one `gst_rate`), and `discount`,
`total`, `place_of_supply` (which are not on the template at all). asyncpg
raises UndefinedColumnError on the fetch — BEFORE the loop — so the per-row
`except` never saw it and the function returned nothing but an exception. The
UPDATE that advances the schedule then set `updated_at`, which
`ganit_recurring` also does not have, so even a corrected SELECT would have
raised on the way out.

It was reachable only through `/cron/invoices`, which imported a module that
did not exist and answered HTTP 200. So nothing ever called it, and when the
wire was repaired the first thing it would have done is raise.

── THE TEMPLATE IS SIMPLER THAN THE INVOICE, DELIBERATELY ───────────────────

`ganit_recurring` carries `subtotal`, `gst_rate` and `is_igst`.
`ganit_invoices` carries the full split — `cgst`, `sgst`, `igst`, `cess`,
`discount`, `total`. That is not a mismatch to paper over: a template stores
the AGREEMENT ("18% GST, inter-State") and an invoice stores the COMPUTED
DOCUMENT. So the split is derived here, and it must satisfy the invariant
`services/doc_validation.py:256-266` enforces on every invoice:

    IGST **or** CGST+SGST as separate heads. Never both, never a merged "GST".

`_split_tax` below is the only place that rule is implemented for generated
invoices, and `test_recurring_invoice_generator.py` asserts it against the same
predicate doc_validation uses, so the two cannot drift into disagreement.

── WHAT IS DELIBERATELY NOT DONE HERE ───────────────────────────────────────

`auto_send` is a real column on the template and this function does NOT act on
it. Generating an invoice is idempotent-ish and reversible; EMAILING one to a
customer is neither, and `OUTBOUND_MODE` is unset on production, which
`outbound.py:148` reads as "live". Wiring a send into a job that is about to be
put on a cron for the first time would mean its first tick mails real
customers. The flag is surfaced in the return value so a caller can decide;
the decision is not this function's to make.

`place_of_supply` is not on the template and cannot be derived from it, so
generated invoices take the column's own `''` default. That leaves the document
incomplete for e-invoicing, and `doc_validation` says so at the point somebody
tries to produce the PDF — which is the right place for it to surface, rather
than this job guessing a State.
"""
import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

log = logging.getLogger(__name__)

#: How far `frequency` advances the schedule. Calendar-naive by design: the
#: column is a date and the business rule is "every N days", not "same day next
#: month", which would have to answer what the 31st means in February.
_STEP = {
    "weekly":    timedelta(days=7),
    "monthly":   timedelta(days=30),
    "quarterly": timedelta(days=90),
    "yearly":    timedelta(days=365),
}

_PAISA = Decimal("0.01")


def _money(value) -> Decimal:
    """A currency amount, to the paisa. asyncpg hands numerics back as Decimal."""
    return (Decimal(value or 0)).quantize(_PAISA, rounding=ROUND_HALF_UP)


def _split_tax(subtotal, gst_rate, is_igst) -> dict:
    """The GST heads for one invoice, from the template's single rate.

    The halving is not `tax / 2` twice. At an odd number of paise that loses
    (or invents) one: 18% of 1000.05 is 180.009, and two independently rounded
    halves come to 180.00 or 180.02 against a total of 180.01. So CGST is
    rounded and SGST is the REMAINDER, which makes `cgst + sgst == tax` true by
    construction at every input rather than at most of them. A one-paisa
    disagreement between the heads and the total is exactly the kind of thing
    that fails a GSTR-1 reconciliation months later.
    """
    sub = _money(subtotal)
    tax = _money(sub * Decimal(gst_rate or 0) / Decimal(100))

    if is_igst:
        igst, cgst, sgst = tax, Decimal("0.00"), Decimal("0.00")
    else:
        cgst = _money(tax / 2)
        sgst = tax - cgst
        igst = Decimal("0.00")

    return {
        "cgst": cgst, "sgst": sgst, "igst": igst,
        "cess": Decimal("0.00"), "discount": Decimal("0.00"),
        "subtotal": sub, "total": sub + tax,
    }


async def _next_invoice_number(pool, org_id: str) -> str:
    """The next INV-nnnnn for this org.

    NOT `COUNT(*) + 1`, which was what this did. There is a UNIQUE index on
    (org_id, invoice_number), and a count is wrong the moment any invoice is
    deactivated or deleted — it hands back a number that is already taken and
    the INSERT raises. Taking the maximum existing suffix is correct under
    deletion.

    Two concurrent runs can still choose the same number. That is left to the
    unique index rather than a lock: the insert raises, the row is counted as
    skipped and logged, and the next tick picks it up. A duplicate invoice
    number is a GST problem; a skipped one is a retry.
    """
    row = await pool.fetchrow(
        """
        SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '\\D', '', 'g'), '')::bigint), 0) AS n
          FROM staging.ganit_invoices
         WHERE org_id = $1::uuid AND invoice_type = 'tax_invoice'
        """,
        org_id,
    )
    return f"INV-{(row['n'] or 0) + 1:05d}"


async def generate_due_invoices(pool, org_id: str) -> dict:
    """Raise an invoice for every recurring definition that is due.

    Returns {generated, skipped, awaiting_send} — `awaiting_send` counts rows
    whose template asks for auto-send, which this function deliberately does
    not perform. See the module docstring.
    """
    today = date.today()

    # `end_date` is honoured here and was not honoured at all before: a schedule
    # past its agreed end kept generating invoices forever, because nothing in
    # the query or the loop ever looked at the column.
    recurrings = await pool.fetch(
        """
        SELECT id, contact_id, template_items, subtotal, gst_rate, is_igst,
               frequency, next_date, end_date, auto_send, notes, terms, created_by
          FROM staging.ganit_recurring
         WHERE org_id = $1::uuid
           AND is_active = TRUE
           AND next_date <= $2
           AND (end_date IS NULL OR next_date <= end_date)
        """,
        org_id, today,
    )

    generated = skipped = awaiting_send = 0

    for rec in recurrings:
        try:
            amounts = _split_tax(rec["subtotal"], rec["gst_rate"], rec["is_igst"])
            inv_number = await _next_invoice_number(pool, org_id)

            await pool.execute(
                """
                INSERT INTO staging.ganit_invoices
                    (id, org_id, contact_id, invoice_number, invoice_type, invoice_date,
                     due_date, is_igst, line_items, subtotal,
                     cgst, sgst, igst, cess, discount, total,
                     amount_paid, balance_due, payment_status,
                     notes, terms, created_by, recurring_id, is_active)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'tax_invoice', $5,
                        $6, $7, $8, $9,
                        $10, $11, $12, $13, $14, $15,
                        0, $15, 'unpaid',
                        $16, $17, $18, $19::uuid, TRUE)
                """,
                uuid.uuid4(), org_id, rec["contact_id"], inv_number, today,
                today + timedelta(days=30), rec["is_igst"], rec["template_items"],
                amounts["subtotal"],
                amounts["cgst"], amounts["sgst"], amounts["igst"],
                amounts["cess"], amounts["discount"], amounts["total"],
                rec["notes"], rec["terms"], rec["created_by"], rec["id"],
            )

            # No `updated_at` — the column does not exist on this table, and
            # setting it is what would have raised on the way out even after the
            # SELECT was corrected.
            await pool.execute(
                "UPDATE staging.ganit_recurring SET next_date = $2 WHERE id = $1::uuid",
                rec["id"],
                rec["next_date"] + _STEP.get(rec["frequency"] or "monthly", _STEP["monthly"]),
            )
            generated += 1
            if rec["auto_send"]:
                awaiting_send += 1

        except Exception:
            # Per row, so one malformed template does not cost an org the rest
            # of its billing run. The SELECT above is outside this block, which
            # is why a wrong column there was fatal rather than merely noisy.
            log.exception("Failed to generate invoice for recurring %s", rec["id"])
            skipped += 1

    return {"generated": generated, "skipped": skipped, "awaiting_send": awaiting_send}
