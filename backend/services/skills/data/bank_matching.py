"""
bank_matching — catalogue #16, "Money In, Invoice Unpaid".

Every unreconciled bank CREDIT with the invoice it most likely settles, and the
mirror: unpaid invoices whose exact balance is already sitting in an unmatched
credit. It never writes. Recording a payment stays a human action, in the
reconciliation screen, for the reason the whole product is built around — there
is no payment gateway and "paid" only ever arrives from bank reconciliation.

── The wire the folio described, and the one thing it did not ────────────────

The folio calls this "the smallest wire with the biggest return": the matcher
`detect/reconciliation_matcher.fuzzy_match_transactions` already exists, takes
`bank_txns` as a REQUIRED parameter, and nothing ever feeds it the backlog. So
it is registered, subject-bound, and unrunnable on a schedule — the same shape
of failure as the two GST handlers that required `period`.

This module supplies the missing query. It deliberately does NOT delegate to
that matcher, and the reason is measured rather than stylistic:

    fuzzy_match_transactions keeps `best_match` under `if conf > best_conf`
    and returns ONE invoice per transaction.

On the live seeded org there are 42 unreconciled credits, 9 of which have an
exact-amount unpaid invoice, and those 9 produce **99 candidate pairs**. Ties
are not the edge case here, they are the ordinary case — several invoices of
the same round amount are exactly what a practice's ledger looks like. `>` (not
`>=`) means the FIRST row of a tie wins, so which invoice a payment is
attributed to is decided by whatever order Postgres returned the rows in. A
"one-click accept list" built on that would attribute real money to an
arbitrary invoice, and the click would make it true.

So the unit of the answer here is not "the best invoice for this credit". It is
**"can this credit be settled without a person choosing?"** — and the three
answers are yes, no because nothing matches, and no because several match.
Sections A, B and C below are exactly those three.

── Reference before amount ───────────────────────────────────────────────────

Catalogue #17 ("UPI Reference Threading") is the infrastructure half of this:
put the invoice number in the UPI `tn`/`tr` fields so the reference identifies
the invoice, and key the matcher on it before scoring on amount. The read half
costs nothing and is done here — if an invoice number appears in the line's
`reference` or `description`, that is a NAMED match and it settles ambiguity
that amount alone cannot.

That ordering is the whole reason #17 is worth doing: a named match is a fact,
an amount match is a coincidence that happens to be usually right. This handler
reports which kind each match is rather than blending them into one score,
because a person deciding whether to accept a suggestion needs to know which
one they are looking at.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

  · `staging.ganit_bank_statement_lines` holds 259 rows in ONE org, none in the
    other two. 128 are reconciled (all `matched_type = 'invoice_payment'`), 131
    are open, and 170 of the 259 are credits.
  · 42 open credits. 9 have at least one exact-amount unpaid invoice; those 9
    yield 99 pairs. 33 have none at all.
  · 11 unpaid invoices have their exact balance sitting in an open credit —
    section D, the mirror, which is the half a receivables chase gets wrong:
    chasing a client whose money is already in the bank.
  · `amount` is SIGNED — there is no `credit`/`debit` pair — so a credit is
    `amount > 0`. There is no `ganit_bank_transactions` table; the earlier name
    in the matcher's docstring refers to a shape passed in, not a table.

── What this cannot see, and says so ─────────────────────────────────────────

`ganit_bank_statement_lines` has no counterparty column. The payer is not
recorded anywhere — the only text is `description` and `reference`, both free
text from the bank's own file — so a credit from a client the product has never
heard of is indistinguishable from a credit from a client it knows. That is on
`limitations`, not only here: a caveat a language model never sees is a caveat
the reader never sees.
"""
import logging
import re
from datetime import date, timedelta

from services.skills.timeutil import as_date, today_ist, utc_now

log = logging.getLogger(__name__)

#: How far back an unreconciled credit is worth suggesting a match for. A credit
#: older than this is a reconciliation backlog problem rather than a "settle
#: this today" problem, and mixing the two makes the list unreadable. It is a
#: DEFAULT and not a rule — the parameter is there so a firm doing a year-end
#: clean-up can widen it.
DEFAULT_DAYS_BACK = 180

#: Amount agreement, in rupees, for a credit to be a candidate for an invoice.
#: ABSOLUTE, not the matcher's 2% relative band, and that is a deliberate
#: difference: 2% of a ₹5,00,000 invoice is ₹10,000, which is a different
#: payment, while 2% of ₹500 is ₹10, which no bank transfer will ever be out by.
#: A relative tolerance is the right shape for a measurement error and the wrong
#: shape for a bank transfer, which is exact or is not the same payment.
AMOUNT_TOLERANCE = 1.00

#: An invoice number must be at least this long before it is looked for inside
#: free text. Without it a number like "1" or "12" matches half the narrations
#: in the file — the reference field routinely carries dates, cheque numbers and
#: UTRs — and a false NAMED match is worse than no match, because named is the
#: kind a person trusts without checking.
MIN_REF_TOKEN = 4


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and this output is handed to a reader through
    `json.dumps`."""
    return default if value is None else float(value)


def _customer_sql(alias_client: str, alias_contact: str) -> str:
    """The customer's NAME, never an id, preferring the company.

    Same rule as `stock_and_crm._customer_sql`: a CRM client is the COMPANY, so
    the company name wins and the contact is the fallback. The last resort is a
    sentence rather than a blank, because an empty cell in a "who paid" column
    reads as a rendering fault and sends somebody looking for the wrong bug.
    """
    return (
        f"COALESCE(NULLIF(btrim({alias_client}.name), ''), "
        f"         NULLIF(btrim({alias_contact}.company), ''), "
        f"         NULLIF(btrim({alias_contact}.name), ''), "
        f"         '(customer not recorded on the invoice)')"
    )


def _norm(text: str | None) -> str:
    """Free text reduced to something an invoice number can be found inside.

    Bank narration arrives with the separators stripped or replaced at the
    bank's whim — `INV-2026-0042` shows up as `INV20260042`, `INV/2026/0042`
    and `inv 2026 0042` in the same statement file — so both sides are reduced
    to upper-case alphanumerics before either is looked for in the other.
    """
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def _names_the_invoice(line_text: str, invoice_number: str | None) -> bool:
    """Does this statement line NAME this invoice?

    Substring on the normalised forms, which is the right test here and not a
    fuzzy ratio: an invoice number is an identifier, so it either appears or it
    does not, and a 0.87 similarity between two identifiers means they are two
    different identifiers.
    """
    needle = _norm(invoice_number)
    if len(needle) < MIN_REF_TOKEN:
        return False
    return needle in line_text


async def check_unmatched_receipts(
    pool,
    org_id: str,
    days_back: int = DEFAULT_DAYS_BACK,
    limit: int = 200,
) -> dict:
    """Unreconciled money in, and which of it can be settled without a decision.

    *days_back* windows the statement lines by `statement_date`. It defaults
    rather than being required, because a handler that makes a person name a
    window is a handler no schedule can run — see
    `tests/test_a_skill_can_run_unattended.py`.

    Four sections, and the split IS the answer:

      A  settled by one invoice        — a credit with exactly one candidate
      B  needs somebody to choose      — a credit with several candidates
      C  money in, nothing it matches  — a credit with none
      D  the mirror                    — unpaid invoices whose exact balance is
                                         already sitting in an open credit

    Never writes. Every section is a suggestion; `staging.ganit_payments` is
    written by the reconciliation screen and by nothing here.
    """
    today = today_ist(utc_now())
    window_start = today - timedelta(days=max(1, int(days_back)))
    cap = max(1, int(limit))

    # ── the backlog: unreconciled CREDITS in the window ────────────────────
    #
    # `amount > 0` is what a credit is: the column is signed and there is no
    # credit/debit pair. `is_reconciled` is nullable with a FALSE default, so
    # COALESCE rather than `= FALSE` — a NULL here means the same thing as
    # false and a bare comparison would silently drop those rows.
    credits = await pool.fetch(
        """
        SELECT l.id, l.statement_date, l.description, l.reference,
               l.amount, l.matched_type
        FROM public.ganit_bank_statement_lines l
        WHERE l.org_id = $1::uuid
          AND l.amount > 0
          AND NOT COALESCE(l.is_reconciled, FALSE)
          AND l.statement_date >= $2::date
        ORDER BY l.statement_date DESC, l.amount DESC
        LIMIT $3::int
        """,
        org_id, window_start, cap,
    )

    # ── the candidates: every unpaid or partly paid invoice ────────────────
    #
    # Fetched once and matched in Python rather than joined per line. The join
    # is the obvious shape and it is the wrong one here: the NAMED test is a
    # substring over a normalised form, which no index can serve, so a LATERAL
    # join would run the same normalisation once per (line × invoice) pair
    # inside the database instead of once per invoice here.
    #
    # BOTH graha joins carry org_id. The FK on `graha_clients` is on the id
    # ALONE, so an id-only join can print another practice's client name
    # against this practice's invoice — measured live, see the note in
    # services/custody/lifecycle.py and migration 163.
    invoices = await pool.fetch(
        f"""
        SELECT i.id, i.invoice_number, i.invoice_date, i.due_date,
               i.total, i.balance_due, i.payment_status,
               {_customer_sql('cl', 'ct')} AS customer
        FROM public.ganit_invoices i
        LEFT JOIN public.graha_clients cl
               ON cl.id = i.client_id AND cl.org_id = i.org_id
        LEFT JOIN public.graha_contacts ct
               ON ct.id = i.contact_id AND ct.org_id = i.org_id
        WHERE i.org_id = $1::uuid
          AND i.is_active
          AND i.payment_status IN ('unpaid', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
        """,
        org_id,
    )

    inv_rows = [
        {
            "invoice_id": str(r["id"]),
            "invoice_number": r["invoice_number"],
            "customer": r["customer"],
            "invoice_date": as_date(r["invoice_date"]),
            "due_date": as_date(r["due_date"]),
            "total": _f(r["total"]),
            "balance_due": _f(r["balance_due"]),
            "payment_status": r["payment_status"],
        }
        for r in invoices
    ]

    settled: list[dict] = []
    ambiguous: list[dict] = []
    unexplained: list[dict] = []
    matched_invoice_ids: set[str] = set()

    for line in credits:
        amount = _f(line["amount"])
        haystack = _norm(f"{line['reference'] or ''} {line['description'] or ''}")

        named = [i for i in inv_rows if _names_the_invoice(haystack, i["invoice_number"])]
        by_amount = [
            i for i in inv_rows
            if abs(i["balance_due"] - amount) <= AMOUNT_TOLERANCE
        ]

        # REFERENCE BEFORE AMOUNT — catalogue #17's whole argument. A line that
        # names an invoice has identified it; the amount is then a check on
        # that identification and not a competing opinion. Only when nothing is
        # named does the amount get to choose.
        if named:
            candidates, basis = named, "reference"
        else:
            candidates, basis = by_amount, "amount"

        entry = {
            "line_id": str(line["id"]),
            "statement_date": line["statement_date"],
            "amount": amount,
            "reference": line["reference"] or "",
            "description": line["description"] or "",
            "matched_on": basis,
        }

        if not candidates:
            unexplained.append({
                **entry,
                "matched_on": None,
                "why": "no unpaid invoice carries this amount and no invoice "
                       "number appears in the narration",
            })
            continue

        # A NAMED match whose amount disagrees is still the right invoice — a
        # part payment against a named invoice is ordinary — but the difference
        # is stated rather than hidden, because "accept" on a part payment and
        # "accept" on a settlement are different decisions.
        for c in candidates:
            matched_invoice_ids.add(c["invoice_id"])

        if len(candidates) == 1:
            c = candidates[0]
            gap = round(c["balance_due"] - amount, 2)
            settled.append({
                **entry,
                "invoice": c,
                "settles_in_full": abs(gap) <= AMOUNT_TOLERANCE,
                "shortfall": gap if abs(gap) > AMOUNT_TOLERANCE else 0.0,
            })
        else:
            ambiguous.append({
                **entry,
                "candidate_count": len(candidates),
                # Capped for readability, and the cap is REPORTED — a truncated
                # list that does not say it was truncated is how a reader comes
                # to believe there were only five.
                "candidates": candidates[:5],
                "candidates_not_shown": max(0, len(candidates) - 5),
                "why": f"{len(candidates)} unpaid invoices carry this exact "
                       f"amount, so the money cannot be attributed without "
                       f"somebody choosing",
            })

    # ── D · the mirror ─────────────────────────────────────────────────────
    #
    # The half a receivables chase gets wrong. An invoice whose exact balance is
    # already sitting in an unreconciled credit is not an unpaid invoice, it is
    # an unreconciled one, and chasing that client is the single most damaging
    # thing a collection skill can do. `pack_collection_messages` cannot see
    # this and does not claim to; naming the overlap here is what lets a person
    # run the two together.
    mirror = [
        i for i in inv_rows
        if i["invoice_id"] in matched_invoice_ids
    ]
    mirror.sort(key=lambda i: i["balance_due"], reverse=True)

    limitations = [
        "This suggests; it never records a payment. 'Paid' arrives from bank "
        "reconciliation and from nothing else, so accepting a suggestion stays "
        "a human action on the reconciliation screen.",
        "There is no counterparty column on a statement line. The payer is not "
        "recorded anywhere — the only text is the bank's own description and "
        "reference — so a credit from a client the product has never heard of "
        "looks exactly like one from a client it knows.",
        f"An amount match is a coincidence, not an identification: it means only "
        f"that an unpaid invoice happens to carry this figure within "
        f"₹{AMOUNT_TOLERANCE:.2f}. Matches keyed on a reference are marked "
        f"'reference' and are the only ones that name an invoice.",
    ]
    if not credits:
        limitations.append(
            "No unreconciled credits were found in the window. That is either a "
            "clean ledger or a bank statement nobody has imported — this cannot "
            "tell the two apart, because an org that has never imported a "
            "statement and an org that has reconciled every line both hold zero "
            "open lines."
        )

    return {
        "as_at": today,
        "window_from": window_start,
        "window_days": int(days_back),
        "counts": {
            "open_credits_examined": len(credits),
            "settled_by_one_invoice": len(settled),
            "need_a_decision": len(ambiguous),
            "money_in_nothing_matches": len(unexplained),
            "invoices_whose_money_is_already_in": len(mirror),
            "capped_at": cap,
            "was_capped": len(credits) >= cap,
        },
        "settled_by_one_invoice": settled,
        "need_a_decision": ambiguous,
        "money_in_nothing_matches": unexplained[:cap],
        "invoices_whose_money_is_already_in": mirror[:cap],
        "limitations": limitations,
    }
