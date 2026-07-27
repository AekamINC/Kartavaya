"""tally_xml.py — Tally voucher XML for Ganit invoices and vendor bills.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
This produces an **import file for the firm's own accounting software**. It is
not a return, not a filing, and not a statement of tax liability. Kartavaya is
not a GSP and this module never talks to the GSTN, the IRP or anything else —
it turns rows this product already holds into the shape Tally can read, and the
firm's accountant does the rest inside Tally.

Every file carries that statement in a comment at its head (`_manifest_comment`)
so the artefact says what it is even after it has been detached from the screen
that produced it.

WHY XML AND NOT JSON
--------------------
Tally Prime accepts JSON; every Tally release in the field — including the
ERP 9 installs that Indian practices still run — accepts XML. One format that
works for both beats two formats that each work for one.

THE SHAPE
---------
    <ENVELOPE>
      <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
      <BODY>
        <IMPORTDATA>
          <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>…</REQUESTDESC>
          <REQUESTDATA>
            <TALLYMESSAGE><VOUCHER>…</VOUCHER></TALLYMESSAGE>   ← one per voucher
          </REQUESTDATA>
        </IMPORTDATA>
      </BODY>
    </ENVELOPE>

SIGNS, AND WHY THE FILE FAILS IF THEY ARE WRONG
-----------------------------------------------
Tally's XML convention is not "debit is positive". It is:

    DEBIT   → <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>, AMOUNT **negative**
    CREDIT  → <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>,  AMOUNT **positive**

and the AMOUNTs of one voucher must sum to **exactly zero**. Tally does not
skip an unbalanced voucher — it rejects the whole import, so one half-paisa in
one voucher costs the firm the entire file. That is the single most common way
a Tally import fails, so this module does two things about it:

  1. Every amount is a `Decimal`, quantized to 2dp **once**, at the point the
     ledger leg is built. No float arithmetic touches a rupee figure; no value
     is rounded twice.
  2. After the legs are built the residue is measured and, if non-zero, booked
     to a `Round Off` leg — which is what Tally itself does, and what makes the
     zero-sum a property of the file rather than a hope about the data.

`_assert_balanced` then re-checks every voucher before it is serialised. A
voucher that still does not balance is HELD BACK and named in the manifest, not
shipped in the hope that Tally is lenient.

WHAT IS DELIBERATELY NOT EMITTED
--------------------------------
  * **Quotations and proformas.** They are offers, not accounting transactions.
    Booking one as a sale puts revenue in the ledger that was never invoiced.
  * **Drafts.** `doc_status='draft'` means the document has not been issued.
  * **Cancelled documents.**
  * **Inventory / stock items.** `INVENTORYENTRIES.LIST` requires the stock
    masters to already exist in the target company; when they do not, Tally
    fails the import. Line detail rides in `<NARRATION>` instead, where it is
    readable and cannot break the file.

LEDGER NAMES
------------
The ledgers below must exist in the target Tally company, or be created on
import. They are constants rather than settings because there is no store for a
per-org ledger map; a firm whose chart of accounts differs edits them here (or
renames on the Tally side) and the report says so.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from xml.sax.saxutils import escape, quoteattr

log = logging.getLogger(__name__)

ZERO = Decimal("0.00")
_CENT = Decimal("0.01")

# ── Ledger names ─────────────────────────────────────────────────────────────
# Kept together so a firm mapping Kartavaya onto its own chart of accounts has
# one place to look. These are the conventional Tally names.
LEDGER_SALES = "Sales"
LEDGER_PURCHASE = "Purchase"
LEDGER_DISCOUNT_ALLOWED = "Discount Allowed"
LEDGER_ROUND_OFF = "Round Off"

OUTPUT_TAX_LEDGERS = {"cgst": "Output CGST", "sgst": "Output SGST",
                      "igst": "Output IGST", "cess": "Output Cess"}
INPUT_TAX_LEDGERS = {"cgst": "Input CGST", "sgst": "Input SGST",
                     "igst": "Input IGST", "cess": "Input Cess"}

#: Kartavaya document type → Tally voucher type. Types absent from this map are
#: not accounting transactions and are never emitted.
VOUCHER_TYPES = {
    "tax_invoice": "Sales",
    "credit_note": "Credit Note",
    "debit_note": "Debit Note",
}

#: Document types excluded by design rather than by a data gap — an offer is not
#: a transaction. Counted in the manifest so a user can reconcile "I have 12
#: invoices, why nine vouchers?".
NON_ACCOUNTING_TYPES = frozenset({"quotation", "proforma"})


# ══════════════════════════════════════════════════════════════════════════════
# Money
# ══════════════════════════════════════════════════════════════════════════════

def dec2(value) -> Decimal:
    """A rupee figure as a 2dp `Decimal`, rounded ONCE.

    asyncpg hands `numeric` back as `Decimal` already, which is exact. A float
    is converted through `str` first: `Decimal(0.1)` is
    0.1000000000000000055511151231257827, and rounding that at the end of a sum
    of twelve line totals is how a voucher ends up a paisa out.
    """
    if value is None or value == "":
        return ZERO
    if isinstance(value, Decimal):
        d = value
    elif isinstance(value, (int, str)):
        try:
            d = Decimal(str(value).strip())
        except InvalidOperation:
            return ZERO
    elif isinstance(value, float):
        d = Decimal(repr(value))
    else:
        try:
            d = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError):
            return ZERO
    if not d.is_finite():
        return ZERO
    # ROUND_HALF_UP is the Indian commercial convention and the one every other
    # rupee figure in this codebase already uses.
    return d.quantize(_CENT, rounding="ROUND_HALF_UP")


def money(d: Decimal) -> str:
    """The plain decimal Tally wants: `-11800.00`, never `₹11,800` or `1.18E+4`."""
    return f"{d:.2f}"


# ══════════════════════════════════════════════════════════════════════════════
# Small helpers
# ══════════════════════════════════════════════════════════════════════════════

def _esc(value) -> str:
    return escape("" if value is None else str(value))


def tally_date(value) -> str:
    """`YYYYMMDD`, which is the only date form Tally's importer accepts.

    Returns "" for anything unparseable rather than a today's-date guess: a
    voucher dated by accident is worse than one held back.
    """
    if isinstance(value, datetime):
        return value.strftime("%Y%m%d")
    if isinstance(value, date):
        return value.strftime("%Y%m%d")
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10], fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    return ""


def load_line_items(raw) -> list[dict]:
    """The line items as a list, whatever layer double-encoded them.

    `staging.ganit_invoices.line_items` is `jsonb`, and on the live database
    **every row holds a jsonb STRING containing JSON** rather than a jsonb
    array — verified against the catalog, 10/10 rows. `db.py` installs a jsonb
    codec that runs `json.loads` once, so a single further `json.loads` in the
    caller happens to land on a list today; if the codec is ever skipped (it is,
    on PgBouncer — see `db._init_conn`) the same code yields a STRING and
    iterating it walks characters, silently producing a voucher with one leg per
    letter.

    So this decodes until it reaches a container, with a cap. Cheap insurance
    against a failure whose symptom is a plausible-looking wrong file.
    """
    value = raw
    for _ in range(3):
        if isinstance(value, (bytes, bytearray)):
            value = value.decode("utf-8", "replace")
        if isinstance(value, str):
            try:
                value = json.loads(value or "[]")
            except (json.JSONDecodeError, ValueError):
                return []
        else:
            break
    if isinstance(value, dict):
        return [value]
    return [li for li in value if isinstance(li, dict)] if isinstance(value, list) else []


# ══════════════════════════════════════════════════════════════════════════════
# Vouchers
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Leg:
    """One `ALLLEDGERENTRIES.LIST` entry.

    `amount` already carries Tally's sign: negative for a debit, positive for a
    credit. Storing the signed figure rather than a magnitude plus a flag means
    the balance check is a plain `sum`, and there is no second place for the
    convention to be applied inconsistently.
    """
    ledger: str
    amount: Decimal

    @property
    def is_debit(self) -> bool:
        return self.amount < 0

    def to_xml(self, indent: str) -> str:
        return (
            f"{indent}<ALLLEDGERENTRIES.LIST>\n"
            f"{indent}  <LEDGERNAME>{_esc(self.ledger)}</LEDGERNAME>\n"
            f"{indent}  <ISDEEMEDPOSITIVE>{'Yes' if self.is_debit else 'No'}</ISDEEMEDPOSITIVE>\n"
            f"{indent}  <AMOUNT>{money(self.amount)}</AMOUNT>\n"
            f"{indent}</ALLLEDGERENTRIES.LIST>\n"
        )


@dataclass
class Voucher:
    vtype: str
    number: str
    vdate: str
    party: str
    narration: str = ""
    party_gstin: str = ""
    reference: str = ""
    legs: list[Leg] = field(default_factory=list)

    def residue(self) -> Decimal:
        return sum((leg.amount for leg in self.legs), ZERO)

    def to_xml(self) -> str:
        head = (
            f"      <VOUCHER VCHTYPE={quoteattr(self.vtype)} ACTION=\"Create\" "
            f"OBJVIEW=\"Accounting Voucher View\">\n"
            f"        <DATE>{_esc(self.vdate)}</DATE>\n"
            f"        <VOUCHERTYPENAME>{_esc(self.vtype)}</VOUCHERTYPENAME>\n"
            f"        <VOUCHERNUMBER>{_esc(self.number)}</VOUCHERNUMBER>\n"
            f"        <PARTYLEDGERNAME>{_esc(self.party)}</PARTYLEDGERNAME>\n"
        )
        if self.reference:
            head += f"        <REFERENCE>{_esc(self.reference)}</REFERENCE>\n"
        if self.party_gstin:
            head += f"        <PARTYGSTIN>{_esc(self.party_gstin)}</PARTYGSTIN>\n"
        if self.narration:
            head += f"        <NARRATION>{_esc(self.narration)}</NARRATION>\n"
        body = "".join(leg.to_xml("        ") for leg in self.legs)
        return (
            "    <TALLYMESSAGE xmlns:UDF=\"TallyUDF\">\n"
            + head + body
            + "      </VOUCHER>\n"
            + "    </TALLYMESSAGE>\n"
        )


def _balance(legs: list[Leg]) -> list[Leg]:
    """Append a `Round Off` leg for whatever the legs do not already cancel.

    The residue is a real accounting figure — GST rounded per line and totalled
    at the header will not always agree to the paisa with the header's own
    rounded total — and Tally's own convention is to book it, not to hide it.
    Booking it here is also what makes the zero-sum a PROPERTY of every file
    rather than a claim about how tidy the source data happened to be.
    """
    residue = sum((leg.amount for leg in legs), ZERO)
    if residue != ZERO:
        legs = legs + [Leg(LEDGER_ROUND_OFF, -residue)]
    return legs


def _narration(lines: list[dict], limit: int = 12) -> str:
    """The line items, flattened into the one field that cannot break an import.

    Deliberately NOT `INVENTORYENTRIES.LIST`: that requires a matching stock
    item to exist in the target company, and when it does not, Tally fails the
    whole file. Line detail is worth carrying; it is not worth carrying at the
    price of the import.
    """
    bits = []
    for li in lines[:limit]:
        desc = str(li.get("description") or "").strip() or "Item"
        code = str(li.get("hsn_code") or li.get("sac_code") or "").strip()
        qty = li.get("quantity")
        unit = str(li.get("unit") or "").strip()
        amount = dec2(li.get("line_total"))
        piece = desc
        if code:
            piece += f" [{code}]"
        if qty not in (None, ""):
            piece += f" {qty}{(' ' + unit) if unit else ''}"
        piece += f" = {money(amount)}"
        bits.append(piece)
    if len(lines) > limit:
        bits.append(f"…and {len(lines) - limit} more line(s)")
    return "; ".join(bits)


def _tax_legs(row: dict, ledgers: dict[str, str], sign: int) -> tuple[list[Leg], str | None]:
    """The GST legs, with the CGST/SGST-vs-IGST pair chosen by the stored flag.

    The flag is READ, never re-derived. Re-deriving it from a place-of-supply
    string would silently re-classify supplies whose recorded flag disagrees
    with their address, and that reclassification is the accountant's call, not
    an exporter's.

    The flag decides the LEDGER NAMES; the amounts still come from the columns.
    Where a column outside the pair the flag selects carries tax — an IGST
    invoice with a CGST figure on it — the row is internally inconsistent and
    the caller is told to hold it back, because the alternatives are to drop
    real tax or to book it under a head the invoice does not claim.
    """
    is_igst = bool(row.get("is_igst"))
    pair = ("igst",) if is_igst else ("cgst", "sgst")
    stray = [
        head for head in ("cgst", "sgst", "igst")
        if head not in pair and dec2(row.get(head)) != ZERO
    ]
    if stray:
        return [], (
            f"is_igst={is_igst} but {', '.join(h.upper() for h in stray)} "
            f"carries tax — the row disagrees with itself"
        )
    return _legs_for_heads(row, ledgers, sign, pair), None


def _tax_legs_from_amounts(
    row: dict, ledgers: dict[str, str], sign: int
) -> tuple[list[Leg], str | None]:
    """The GST legs for a row that has NO stored inter-state flag.

    **`staging.ganit_vendor_bills` has no `is_igst` column.** `VendorBillCreate`
    takes an `is_igst` field, but it is only an input to `_compute_invoice` —
    it decides how the tax is SPLIT and is then thrown away; the bill row keeps
    the resulting `cgst`/`sgst`/`igst` figures and nothing else. Verified
    against `information_schema`, not inferred from the Pydantic model, which is
    exactly where the wrong assumption comes from.

    So for a bill the heads that carry tax ARE the classification — that is what
    the row records, and reading it is not re-deriving anything. A bill carrying
    tax under BOTH an integrated and a state head contradicts itself and is held
    back, the same treatment an invoice gets.
    """
    has_igst = dec2(row.get("igst")) != ZERO
    has_intra = dec2(row.get("cgst")) != ZERO or dec2(row.get("sgst")) != ZERO
    if has_igst and has_intra:
        return [], ("the bill carries both IGST and CGST/SGST — it cannot be both "
                    "inter-state and intra-state, and no flag on the row settles it")
    pair = ("igst",) if has_igst else ("cgst", "sgst")
    return _legs_for_heads(row, ledgers, sign, pair), None


def _legs_for_heads(
    row: dict, ledgers: dict[str, str], sign: int, pair: tuple[str, ...]
) -> list[Leg]:
    legs = []
    for head in (*pair, "cess"):
        amount = dec2(row.get(head))
        if amount != ZERO:
            legs.append(Leg(ledgers[head], sign * amount))
    return legs


def _reject_foreign_currency(row: dict) -> str | None:
    """A voucher's amounts are in the Tally company's base currency.

    Ganit stores a `currency` and an `exchange_rate`, but the rate is nullable
    and nothing enforces that it was the rate on the invoice date. Booking a
    foreign-currency document at its face value into a rupee company overstates
    or understates it by the whole exchange rate, silently and in the ledger.
    Held back and named instead — converting it is the accountant's decision,
    made against a rate they can defend.
    """
    currency = str(row.get("currency") or "INR").upper()
    if currency != "INR":
        return (f"raised in {currency}; a Tally company keeping rupee books cannot "
                f"take it at face value and no reliable conversion is recorded")
    return None


def sales_voucher(row: dict, party: str) -> tuple[Voucher | None, str | None]:
    """One Sales / Credit Note / Debit Note voucher from a `ganit_invoices` row.

    A credit note reverses a sale, so every leg flips: the party is credited and
    the revenue and tax are debited. It is a separate VOUCHER TYPE in Tally
    rather than a negative sales voucher, which is what a Tally user expects to
    see in the day book.
    """
    inv_type = str(row.get("invoice_type") or "")
    vtype = VOUCHER_TYPES.get(inv_type)
    if not vtype:
        return None, f"{inv_type or 'untyped'} is not an accounting document"

    problem = _reject_foreign_currency(row)
    if problem:
        return None, problem

    vdate = tally_date(row.get("invoice_date"))
    if not vdate:
        return None, "invoice date is missing or unreadable"

    number = str(row.get("invoice_number") or "").strip()
    if not number:
        return None, "invoice number is missing"

    # A credit note reverses the direction of every leg.
    reverse = inv_type == "credit_note"
    party_sign = 1 if reverse else -1     # party debited on a sale, credited on a note
    income_sign = -party_sign             # …and the mirror on revenue and tax

    subtotal = dec2(row.get("subtotal"))
    discount = dec2(row.get("discount"))
    total = dec2(row.get("total"))

    tax, problem = _tax_legs(row, OUTPUT_TAX_LEDGERS, income_sign)
    if problem:
        return None, problem

    legs = [Leg(party, party_sign * total), Leg(LEDGER_SALES, income_sign * subtotal)]
    legs += tax
    if discount != ZERO:
        # A discount allowed reduces what the customer owes, so it sits on the
        # same side as the party leg.
        legs.append(Leg(LEDGER_DISCOUNT_ALLOWED, party_sign * discount))

    return Voucher(
        vtype=vtype, number=number, vdate=vdate, party=party,
        party_gstin=str(row.get("contact_gstin") or "").strip(),
        reference=number,
        narration=_narration(load_line_items(row.get("line_items"))),
        legs=_balance(legs),
    ), None


def purchase_voucher(row: dict, party: str) -> tuple[Voucher | None, str | None]:
    """One Purchase voucher from a `ganit_vendor_bills` row.

    Mirror of a sale: the vendor is credited with the bill total, the expense
    and the input tax are debited.

    `is_reverse_charge` is READ and recorded on the voucher's narration, and
    nothing more is done with it. Under reverse charge the recipient's liability
    and its credit are both entries this product has no ledger for, and inventing
    them here would be exactly the filing logic Kartavaya has decided not to
    carry. The narration makes the flag visible to the accountant, who has one.

    Note the tax path differs from a sale's: a bill row has no `is_igst` column
    to read. See `_tax_legs_from_amounts`.
    """
    problem = _reject_foreign_currency(row)
    if problem:
        return None, problem

    vdate = tally_date(row.get("bill_date"))
    if not vdate:
        return None, "bill date is missing or unreadable"

    # A vendor's own bill number is the reference an accountant reconciles
    # against; `internal_ref` is Kartavaya's and is the fallback so the voucher
    # is never unnumbered.
    number = str(row.get("bill_number") or "").strip() \
        or str(row.get("internal_ref") or "").strip()
    if not number:
        return None, "bill has neither a supplier bill number nor an internal reference"

    subtotal = dec2(row.get("subtotal"))
    total = dec2(row.get("total"))

    tax, problem = _tax_legs_from_amounts(row, INPUT_TAX_LEDGERS, -1)
    if problem:
        return None, problem

    legs = [Leg(party, total), Leg(LEDGER_PURCHASE, -subtotal)] + tax

    narration = _narration(load_line_items(row.get("line_items")))
    if row.get("is_reverse_charge"):
        narration = ("Reverse charge flagged on this bill in Kartavaya — the "
                     "liability and credit entries it implies are NOT in this "
                     "voucher. " + narration).strip()

    return Voucher(
        vtype="Purchase", number=number, vdate=vdate, party=party,
        party_gstin=str(row.get("vendor_gstin") or "").strip(),
        reference=str(row.get("internal_ref") or "").strip(),
        narration=narration,
        legs=_balance(legs),
    ), None


# ══════════════════════════════════════════════════════════════════════════════
# The file
# ══════════════════════════════════════════════════════════════════════════════

def _manifest_comment(manifest: dict, org_name: str) -> str:
    """What this file is, on the face of the file.

    A `--` inside an XML comment is not well-formed, so anything that reaches
    here is defanged first; a comment that breaks the parse would take the
    import down with it.
    """
    held = manifest.get("held_back") or []
    lines = [
        "Kartavaya export — Tally voucher import file",
        "",
        "This is DATA EXPORTED FOR YOUR OWN ACCOUNTING SOFTWARE, prepared from",
        "Kartavaya records. It is not a return, not a filing, and not a",
        "statement of tax liability. Kartavaya is not a GSP; nothing here has",
        "been sent to, or checked against, the GST portal.",
        "",
        f"Company        : {org_name or '(not set)'}",
        f"Period         : {manifest.get('period_from') or '?'} to {manifest.get('period_to') or '?'}",
        f"Generated (UTC): {manifest.get('generated_at') or ''}",
        "",
        f"Sales vouchers    : {manifest.get('sales_count', 0)}",
        f"Credit notes      : {manifest.get('credit_note_count', 0)}",
        f"Debit notes       : {manifest.get('debit_note_count', 0)}",
        f"Purchase vouchers : {manifest.get('purchase_count', 0)}",
        "",
        "Ledgers this file expects to exist in the target company:",
        f"  {LEDGER_SALES}, {LEDGER_PURCHASE}, {LEDGER_DISCOUNT_ALLOWED}, {LEDGER_ROUND_OFF},",
        f"  {', '.join(OUTPUT_TAX_LEDGERS.values())},",
        f"  {', '.join(INPUT_TAX_LEDGERS.values())},",
        "  plus one ledger per party, named as below.",
        "",
        "Not in this file, by design: quotations and proformas (offers, not",
        "transactions), drafts, cancelled documents, and stock/inventory",
        "entries (they need stock masters that may not exist in your company).",
    ]
    if held:
        lines += ["", f"HELD BACK — {len(held)} document(s) were NOT exported:"]
        lines += [f"  · {h['document']} — {h['reason']}" for h in held]
        lines += ["", "Those documents are missing from the figures above. Fix them in",
                  "Kartavaya and export again, or enter them by hand."]
    else:
        lines += ["", "No document was held back."]

    text = "\n".join(lines).replace("--", "––")
    return f"<!--\n{text}\n-->\n"


def build_tally_xml(
    invoices: list[dict],
    bills: list[dict],
    org: dict,
    period_from: str = "",
    period_to: str = "",
    generated_at: str = "",
) -> tuple[str, dict]:
    """Return `(xml_text, manifest)`.

    The manifest is the same information the header comment carries, in a form
    the API can answer with, so the screen and the file can never disagree about
    how many vouchers were produced or what was left out.

    `invoices` and `bills` are rows the ROUTER has already filtered for org,
    activity, date and document type — this function does not reach the database
    and does not re-apply tenancy. It refuses nothing on entitlement grounds
    because it is not the thing that knows.
    """
    org = org or {}
    vouchers: list[Voucher] = []
    held_back: list[dict] = []
    counts = {"Sales": 0, "Credit Note": 0, "Debit Note": 0, "Purchase": 0}

    def _party_name(row: dict, *keys: str) -> str:
        for key in keys:
            name = str(row.get(key) or "").strip()
            if name:
                return name
        return ""

    for row in invoices or []:
        label = str(row.get("invoice_number") or "").strip() or "an unnumbered invoice"
        # The company is the ledger an accountant expects; the person is the
        # fallback. A voucher with no party ledger cannot be imported at all,
        # so it is held back rather than booked to an invented "Sundry" name
        # that would quietly mis-state the debtor.
        party = _party_name(row, "contact_company", "contact_name")
        if not party:
            held_back.append({"document": label,
                              "reason": "no customer name — Tally needs a party ledger"})
            continue
        voucher, problem = sales_voucher(row, party)
        if problem or voucher is None:
            held_back.append({"document": label, "reason": problem or "could not be built"})
            continue
        vouchers.append(voucher)
        counts[voucher.vtype] = counts.get(voucher.vtype, 0) + 1

    for row in bills or []:
        label = (str(row.get("bill_number") or "").strip()
                 or str(row.get("internal_ref") or "").strip()
                 or "an unnumbered vendor bill")
        party = _party_name(row, "vendor_name")
        if not party:
            held_back.append({"document": label,
                              "reason": "no vendor name — Tally needs a party ledger"})
            continue
        voucher, problem = purchase_voucher(row, party)
        if problem or voucher is None:
            held_back.append({"document": label, "reason": problem or "could not be built"})
            continue
        vouchers.append(voucher)
        counts["Purchase"] += 1

    # The last gate before serialisation. `_balance` should already have made
    # this impossible; if it has not, the bug is here rather than in the firm's
    # Tally, and one rejected voucher must not cost them the other ninety.
    balanced: list[Voucher] = []
    for voucher in vouchers:
        residue = voucher.residue()
        if residue != ZERO:
            log.error("tally: voucher %s did not balance, residue=%s", voucher.number, residue)
            held_back.append({
                "document": voucher.number,
                "reason": f"ledger entries did not balance (out by {money(residue)}) "
                          f"— held back so it cannot fail the whole import",
            })
            counts[voucher.vtype] = max(0, counts.get(voucher.vtype, 0) - 1)
            continue
        balanced.append(voucher)

    manifest = {
        "sales_count": counts.get("Sales", 0),
        "credit_note_count": counts.get("Credit Note", 0),
        "debit_note_count": counts.get("Debit Note", 0),
        "purchase_count": counts.get("Purchase", 0),
        "voucher_count": len(balanced),
        "held_back": held_back,
        "period_from": period_from,
        "period_to": period_to,
        "generated_at": generated_at,
    }

    company = str(org.get("name") or "").strip()
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>\n',
        _manifest_comment(manifest, company),
        "<ENVELOPE>\n",
        "  <HEADER>\n",
        "    <TALLYREQUEST>Import Data</TALLYREQUEST>\n",
        "  </HEADER>\n",
        "  <BODY>\n",
        "    <IMPORTDATA>\n",
        "      <REQUESTDESC>\n",
        "        <REPORTNAME>Vouchers</REPORTNAME>\n",
        "        <STATICVARIABLES>\n",
        f"          <SVCURRENTCOMPANY>{_esc(company)}</SVCURRENTCOMPANY>\n",
        "        </STATICVARIABLES>\n",
        "      </REQUESTDESC>\n",
        "      <REQUESTDATA>\n",
    ]
    parts += [voucher.to_xml() for voucher in balanced]
    parts += [
        "      </REQUESTDATA>\n",
        "    </IMPORTDATA>\n",
        "  </BODY>\n",
        "</ENVELOPE>\n",
    ]
    return "".join(parts), manifest
