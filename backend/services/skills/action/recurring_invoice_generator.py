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

── THE COMPANY IS INHERITED, NOT INVENTED ───────────────────────────────────

`ganit_invoices.client_id` is what files a receivable under the company that
owes it — Client 360, receivables ageing and every Niyam rule keyed on the
customer read that column and nothing else. `ganit_recurring` carries no
company of its own, and this INSERT named no `client_id` at all, so every
invoice a retainer raised landed under "Unlinked client". A retainer is the
LONGEST-lived billing relationship a firm has, which made the recurring revenue
the revenue least visible per customer.

The company is the employer of the person the profile bills, resolved through
`vikray.resolve_order_company` — the same helper, called the same way, as
`ganit.generate_recurring_invoice`, which is the Generate-now button this job
is the cron twin of. Two copies of one billing path must not disagree about
whose invoice it is. The lookup is scoped `org_id=$2::uuid`: the foreign key on
that column is not composite with `org_id`, so a join on the id alone would
happily file one organisation's money under another's company.

A profile whose contact has no employer still generates its invoice, with no
company — the same outcome the button gives, and a billing job is the last
place to start refusing work over a missing link.

Measured on the live database on 2026-08-21, SELECT-only: 34 invoices carry a
`recurring_id`, every one of them has a NULL `client_id`, and 21 of those hang
off a contact who DOES have an employer — a company the write path was holding
and dropped. None of the 34 came from here (this job had never completed a run);
they came from the button. They are what this INSERT would have gone on
producing, monthly, from the tick the cron was armed. Nothing is backfilled:
those rows stay as they are.

`place_of_supply` is not on the template and cannot be derived from it, so
generated invoices take the column's own `''` default. That leaves the document
incomplete for e-invoicing, and `doc_validation` says so at the point somebody
tries to produce the PDF — which is the right place for it to surface, rather
than this job guessing a State.
"""
import calendar
import logging
import uuid
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

log = logging.getLogger(__name__)

#: How far `frequency` advances the schedule, in CALENDAR months where the word
#: is a calendar word.
#:
#: This was `timedelta(days=30)` for "monthly", with a header defending it as
#: "calendar-naive by design … the business rule is every N days". It is not:
#: the Generate-now button on the same schedule advances by a real month, so a
#: firm billing on the 1st got the 1st from the button and the 1st, 31st, 2nd,
#: 1st… from the cron — and THIRTEEN invoices in a year instead of twelve.
#: Quarterly drifted by 5 days a year, yearly by 1 in 4. A recurring invoice is
#: a contract term; "every 30 days" is a different contract from "monthly".
#:
#: The question the old comment asked — what the 31st means in February — has
#: one accepted answer and `_add_months` gives it: the last day of the shorter
#: month. It does NOT then anchor to the 28th, because it advances from the
#: schedule's own `next_date` each tick, which is what the button does too.
_STEP_DAYS = {"weekly": 7}
_STEP_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}


def _add_months(d: date, months: int) -> date:
    """`d` advanced by whole calendar months, clamped to the month's length.

    31 Jan + 1 month is 28 Feb (29 in a leap year), which is the convention
    every billing system and every accountant uses. `calendar.monthrange`
    supplies the length so leap years need no special case.
    """
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _advance(d: date, frequency: str | None) -> date:
    """The schedule's next due date. Unknown frequencies read as monthly."""
    freq = (frequency or "monthly").lower()
    if freq in _STEP_DAYS:
        return d + timedelta(days=_STEP_DAYS[freq])
    return _add_months(d, _STEP_MONTHS.get(freq, 1))

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
    """The next invoice number for this org — from the SAME allocator as the UI.

    ── WHY THIS IS ONE LINE AND NOT AN ALLOCATOR ───────────────────────────────

    It used to be an allocator, and having two of them was not a duplication
    problem, it was a corruption problem. This file minted `INV-{n:05d}` from
    `MAX(digits stripped from invoice_number)`. Every other invoice in the
    product comes from `utils.next_doc_number`, which mints `INV-YYYY-nnnn` and
    reads the LAST row by `created_at`, taking the segment after the final `-`.

    Run one against the other and the series does not collide, it DIVERGES —
    which the unique index cannot catch, because every number is genuinely new:

        existing        INV-2026-0149      (the live series)
        this file       MAX -> 20260149    (the hyphens stripped)
                        mints INV-20260150 ({:05d} is a minimum width, not a
                                            truncation)
        next_doc_number sees INV-20260150 as the newest row by created_at,
                        rsplits on '-' -> 20260150, mints INV-2026-20260151
        this file       strips that -> 202620260151, and escalates again

    Measured against the live database on 2026-08-06, all three orgs were one
    tick away from it: 64e7bea6 at INV-2026-0149, fae87907 at INV-2026-0048,
    045b76ad at INV-2026-0007. 712 tax invoices sit in the format that breaks.

    Rule 46(b) requires a consecutive serial number unique for the financial
    year. After one run the ledger reads INV-2026-0149, INV-20260150,
    INV-2026-20260151 — not a series, not self-correcting, and already filed in
    GSTR-1. The old docstring's argument for tolerating a race ("a duplicate is
    a GST problem; a skipped one is a retry") was sound and answered the wrong
    question: the number was wrong before any two runs met.

    `next_doc_number` also takes an advisory lock, so the race the old comment
    conceded is closed rather than merely argued about.
    """
    from utils import next_doc_number

    return await next_doc_number(pool, org_id, "ganit_invoices", "invoice_number", "INV")


async def _doc_status_for(pool, org_id: str, rec, amounts: dict,
                          inv_number: str, inv_date) -> tuple[str, list]:
    """`final` if the invoice would satisfy Rule 46, otherwise `draft`.

    ── WHY THIS EXISTS, AND WHY IT DOES NOT RAISE ──────────────────────────────

    `create_invoice` runs `_refuse_final_if_incomplete` (routers/ganit.py:278)
    and 422s a tax invoice that is not legally complete — no customer, no HSN,
    no place of supply. This job wrote the same document with no check of any
    kind, and `ganit_invoices.doc_status` DEFAULTS TO 'final', so the cron
    minted final tax invoices the product's own form would have refused and its
    own PDF endpoint then refuses at download time.

    The gate is the same validator so the two paths cannot drift. The RESPONSE
    is different, and deliberately: a form can show a gap list to the person who
    is standing there, and a 3am cron cannot. Refusing outright would silently
    stop a firm's billing; writing it `final` anyway files an illegal document.
    So the invoice is written as a DRAFT with its gaps logged — the work is not
    lost, it appears in the drafts the firm already reviews, and nothing
    incomplete is ever born final.
    """
    from services.doc_validation import validate_tax_invoice

    org = await pool.fetchrow(
        "SELECT name, gstin, pan, billing_address FROM staging.organisations "
        "WHERE id=$1::uuid",
        org_id,
    )
    contact = None
    if rec["contact_id"]:
        contact = await pool.fetchrow(
            "SELECT name, company, gstin FROM staging.graha_contacts "
            "WHERE id=$1::uuid AND org_id=$2::uuid",
            str(rec["contact_id"]), org_id,
        )

    # `template_items` is jsonb and asyncpg hands it back as TEXT. The validator
    # iterates line items and calls `.get` on each, so an unparsed string is
    # iterated character by character and raises — which the per-row `except`
    # would have swallowed into a `skipped`, turning a completeness check into a
    # silent billing outage.
    items = rec["template_items"]
    if isinstance(items, str):
        import json
        try:
            items = json.loads(items)
        except (TypeError, ValueError):
            items = []
    if not isinstance(items, list):
        items = []

    # The number and the date are part of what Rule 46 checks — 46(b) is the
    # serial and the date of issue — so the document handed to the validator is
    # the document about to be INSERTed, not a subset of it.
    invoice = {
        "invoice_type": "tax_invoice",
        "invoice_number": inv_number,
        "invoice_date": inv_date,
        "contact_id": rec["contact_id"],
        "line_items": items,
        "subtotal": amounts["subtotal"],
        "total": amounts["total"],
        "is_igst": rec["is_igst"],
    }
    check = validate_tax_invoice(invoice, dict(org) if org else {},
                                 dict(contact) if contact else None)
    if check.ok:
        return "final", []
    # `blocking` only. The advisory gaps are the ones `doc_validation` says do
    # not invalidate the recipient's credit, and holding an invoice back for one
    # would stop billing over a missing billing address.
    return "draft", [g.label for g in check.blocking]


async def generate_due_invoices(pool, org_id: str) -> dict:
    """Raise an invoice for every recurring definition that is due.

    Returns {generated, skipped, awaiting_send, held_as_draft} — `awaiting_send`
    counts rows whose template asks for auto-send, which this function
    deliberately does not perform (see the module docstring), and
    `held_as_draft` counts invoices written but not made final because they
    would not satisfy Rule 46.
    """
    today = date.today()

    # Imported here rather than at module scope for the same reason
    # `next_doc_number` and `validate_tax_invoice` are: this module is loaded by
    # the skill registry at import time, and a skill handler that drags a
    # FastAPI router in with it turns a registry walk into an application
    # bootstrap. `campaign_sender` reaches into `routers.prachar` the same way.
    from routers.vikray import resolve_order_company

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

    generated = skipped = awaiting_send = held_as_draft = 0

    for rec in recurrings:
        try:
            amounts = _split_tax(rec["subtotal"], rec["gst_rate"], rec["is_igst"])
            inv_number = await _next_invoice_number(pool, org_id)
            doc_status, gaps = await _doc_status_for(
                pool, org_id, rec, amounts, inv_number, today)

            # The company, inherited from the person the profile bills. See the
            # module docstring: the template holds no company, so the contact's
            # employer is the answer, and the helper scopes that lookup to this
            # org. `""` for the named-company argument — nothing here comes from
            # a request body, so there is no user input to validate, only a link
            # to follow.
            client_id = await resolve_order_company(
                pool, org_id, "",
                str(rec["contact_id"]) if rec["contact_id"] else "")

            await pool.execute(
                """
                INSERT INTO staging.ganit_invoices
                    (id, org_id, contact_id, invoice_number, invoice_type, invoice_date,
                     due_date, is_igst, line_items, subtotal,
                     cgst, sgst, igst, cess, discount, total,
                     amount_paid, balance_due, payment_status, doc_status,
                     notes, terms, created_by, recurring_id, client_id, is_active)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'tax_invoice', $5,
                        $6, $7, $8, $9,
                        $10, $11, $12, $13, $14, $15,
                        0, $15, 'unpaid', $20,
                        $16, $17, $18, $19::uuid, NULLIF($21,'')::uuid, TRUE)
                """,
                uuid.uuid4(), org_id, rec["contact_id"], inv_number, today,
                today + timedelta(days=30), rec["is_igst"], rec["template_items"],
                amounts["subtotal"],
                amounts["cgst"], amounts["sgst"], amounts["igst"],
                amounts["cess"], amounts["discount"], amounts["total"],
                rec["notes"], rec["terms"], rec["created_by"], rec["id"],
                doc_status,
                # `or ""`: an untyped NULL through PgBouncer is the parse error
                # that reads as an instant 500, which is why the bind is a
                # NULLIF and never a bare `$21::uuid`.
                client_id or "",
            )
            if doc_status != "final":
                held_as_draft += 1
                log.warning(
                    "Recurring %s: invoice %s written as a draft — %s",
                    rec["id"], inv_number, ", ".join(str(g) for g in gaps) or "incomplete",
                )

            # No `updated_at` — the column does not exist on this table, and
            # setting it is what would have raised on the way out even after the
            # SELECT was corrected.
            await pool.execute(
                "UPDATE staging.ganit_recurring SET next_date = $2 WHERE id = $1::uuid",
                rec["id"],
                _advance(rec["next_date"], rec["frequency"]),
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

    return {
        "generated": generated,
        "skipped": skipped,
        "awaiting_send": awaiting_send,
        "held_as_draft": held_as_draft,
    }
