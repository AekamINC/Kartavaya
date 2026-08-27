"""gstr1_json.py — GSTR-1 **outward supply data** in the GSTN offline-utility shape.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
This produces a JSON file for the firm to load into **its own** GSTR-1
preparation software — the GSTN offline utility, or whatever their practice
uses. It is not a return. Nothing here files, uploads, signs or validates
against the portal. Kartavaya is not a GSP and does not become one by writing a
file the portal's own tool can read.

Why GSTR-1 is safe ground where GSTR-3B is not: GSTR-1 is **outward** data —
the firm's own invoices, its own numbers. It touches no input tax credit, no
GSTR-2B, no IMS, and no electronic ledger. Every figure in this file already
exists on a document the firm issued. Nothing is computed that the firm would
have to rely on as a liability.

THE ONE RULE THIS MODULE IS BUILT AROUND
----------------------------------------
**A section is emitted only when it can be filled truthfully.** An empty or
half-filled section that LOOKS complete is worse than an absent one: a preparer
who sees `"cdnr": []` reads "there were no credit notes", and files on that
basis. So a section with nothing honest to say is left out of the file
altogether, and the manifest names it and says why — see `OMITTED_SECTIONS`.

The same rule applies row by row. An invoice this module cannot place — no
resolvable place of supply, a counterparty GSTIN that fails its own check digit,
a line with no HSN — is HELD BACK and named, never quietly folded into a
neighbouring bucket where it would look like a smaller number rather than a
missing one.

SECTIONS EMITTED
----------------
    b2b        supplies to a registered person (recipient holds a valid GSTIN)
    b2cl       inter-state, unregistered, above the B2CL threshold
    b2cs       everything else unregistered, aggregated
    hsn        HSN/SAC summary over the invoices actually included above
    doc_issue  document series issued in the period

Each is present only when it has rows.

SECTIONS DELIBERATELY OMITTED — see `OMITTED_SECTIONS` for the reasons the API
and the UI repeat verbatim. The short version: `cdnr`/`cdnur` because Kartavaya
stores no link from a credit note to the document it amends and no reason code;
`exp` because there is no shipping-bill store; `nil` because the nil/exempt/
non-GST split has a column but nothing that writes it; and every advance,
amendment and inward section because no store exists at all.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from datetime import date, datetime
from decimal import Decimal

from services.gstin import is_valid as gstin_is_valid
from services.gstin import normalise as gstin_normalise
from services.gstin import state_code as gstin_state_code

# `dec2` (round a rupee figure exactly once) and `load_line_items` (decode the
# double-encoded `line_items` column) are shared with the Tally exporter rather
# than reimplemented here. Both are answers to properties of the DATA, not of
# either output format, and two copies would be two places for the paisa
# convention and the decode depth to drift apart. They live in `tally_xml`
# because that is where they were first needed; nothing else about that module
# is used here.
from services.tally_xml import ZERO, dec2, load_line_items

log = logging.getLogger(__name__)

#: The invoice value above which an inter-state supply to an unregistered person
#: is reported invoice-wise (B2CL) rather than in the B2CS aggregate.
#:
#: A RULE, not a fact about the data — and a rule that has moved before and can
#: move again on a GSTN advisory. Kartavaya does not track GSTN advisories; the
#: firm's own software is the authority on the threshold in force for the period
#: being filed.
#:
#: THIS IS NOW THE FALLBACK, NOT THE SOURCE. Phase 5.3 moved the figure into
#: `staging.statute_calendar` under `B2CL_THRESHOLD_KEY`, where it carries an
#: effective window and can be superseded by a dated successor without a code
#: change. This constant is what `build_gstr1` uses when the calendar records no
#: row — see `resolve_b2cl_threshold` for why that direction is deliberate.
B2CL_THRESHOLD = Decimal("250000.00")

#: The `statute_calendar` key that supersedes the constant above. Seeded by
#: migration 229 with exactly the value of that constant, so the move changed no
#: figure — only where the figure is allowed to change next.
B2CL_THRESHOLD_KEY = "gst.b2cl.threshold"


def period_last_day(period: str) -> date:
    """`2026-07` → 2026-07-31. The date a statutory fact is read AS OF.

    THE ANCHOR IS THE PERIOD THE DOCUMENT COVERS, NEVER THE DATE YOU ARE FILING
    ON — `services/statute.py` says so in its own docstring and gives the reason:
    a July return prepared in September must be built on July's law. Using
    `date.today()` here would mean a threshold that changed on 1 August silently
    re-bucketed every July invoice the next time somebody re-exported the month.

    Raises nothing on a malformed period. `_period_bounds` in the router has
    already refused those with a 400 by the time this is reached, and a second
    refusal here would be a second place for that 400 to drift.
    """
    year, month = int(period[:4]), int(period[5:7])
    first_of_next = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return date.fromordinal(first_of_next.toordinal() - 1)


async def resolve_b2cl_threshold(pool, as_of: date) -> tuple[Decimal, str]:
    """The B2CL threshold in force on `as_of`, and a sentence saying where it
    came from.

    ── WHICH WAY THIS FAILS, AND WHY THAT DIRECTION ─────────────────────────

    An absent row DEGRADES to `B2CL_THRESHOLD` and says so. It does not refuse,
    and it does not return zero.

    That is the opposite of the choice Phase 5.2b made for the income-tax ladder,
    where an absent ladder must deduct ₹0 rather than fall back to a literal —
    and the two are not inconsistent, because the failures are not alike. A
    missing payroll ladder that fell back to a literal would deduct MONEY under
    last year's law and look correct. A missing B2CL row changes no tax at all:
    it decides only whether a supply is listed invoice-wise in Table 5 or
    aggregated into Table 7 of the same return. The totals tie out either way.

    So the worst case here is a file bucketed on a stale-but-correct-yesterday
    rule, against the alternative of an export that refuses and leaves a preparer
    with no file at all on the 10th of the month. An export that stops because a
    reference row is missing is worse than one that carries on with the behaviour
    it has always had, so it carries on — and the manifest names which of the two
    it used, so nobody has to guess.

    A database error is caught for the same reason: `statute_calendar` is
    reference data on the read path of a filing export, and a transient failure
    reading it must not take the export down.
    """
    try:
        from services.statute import obligation

        row = await obligation(pool, B2CL_THRESHOLD_KEY, as_of=as_of)
    except Exception:                                    # noqa: BLE001
        log.warning("B2CL threshold lookup failed; using the built-in default",
                    exc_info=True)
        row = None

    if row and row.get("threshold_amount") is not None:
        cite = " · ".join(
            str(bit) for bit in (row.get("statute"), row.get("section_ref")) if bit
        )
        return (
            Decimal(str(row["threshold_amount"])),
            f"statute_calendar · {B2CL_THRESHOLD_KEY} as of {as_of.isoformat()}"
            + (f" · {cite}" if cite else ""),
        )

    return (
        B2CL_THRESHOLD,
        f"built-in default — the statute calendar records no "
        f"{B2CL_THRESHOLD_KEY} as of {as_of.isoformat()}",
    )

#: Per-invoice tolerance between the tax the LINES add up to and the tax the
#: invoice HEADER records. Half-paisa GST rounding on a dozen lines legitimately
#: lands a rupee away; anything further apart is a disagreement in the data, not
#: rounding, and the invoice is held back rather than reported at whichever of
#: the two figures this module happened to pick.
TAX_RECONCILIATION_TOLERANCE = Decimal("1.00")

#: Kartavaya's document type → the GSTR-1 "documents issued" category number.
DOC_ISSUE_CATEGORIES = [
    (1, "Invoices for outward supply", ("tax_invoice",)),
    (4, "Debit Note", ("debit_note",)),
    (5, "Credit Note", ("credit_note",)),
]

#: Every section this module could have emitted and does not, with the reason
#: stated once so the report, the API and the screen cannot drift apart.
OMITTED_SECTIONS: "OrderedDict[str, str]" = OrderedDict([
    ("cdnr",
     "Credit and debit notes to registered persons. Kartavaya records a credit "
     "note as an ordinary invoice row with invoice_type='credit_note'. It stores "
     "NO link to the document the note amends and NO reason code — there is no "
     "column for either. A cdnr entry identifies a note against its original "
     "document; one emitted without that link is a different statement from the "
     "one the section is for. The notes in this period are listed in the "
     "manifest so they can be entered deliberately rather than assumed absent."),
    ("cdnur",
     "Credit and debit notes to unregistered persons — same missing link and "
     "missing reason code as cdnr."),
    ("exp",
     "Exports. ganit_invoices.is_export exists, but the section needs a shipping "
     "bill number, its date and the port code, and no column holds any of the "
     "three. Export invoices are excluded from b2b/b2cs as well — they are "
     "zero-rated, not domestic supplies — and are named in the manifest."),
    ("nil",
     "Nil-rated, exempt and non-GST supplies. ganit_invoices.supply_nature has "
     "the right domain, but nothing in the product writes anything other than "
     "'taxable' to it, so a nil section built from it would assert a split "
     "nobody recorded."),
    ("at / atadj",
     "Advances received and adjusted. Kartavaya records payments against an "
     "invoice, never an advance against a future supply, so there is no row that "
     "means 'advance' to read."),
    ("b2ba / b2cla / b2csa / cdnra / hsnsum amendments",
     "Amendments to an earlier period. Kartavaya keeps no revision history that "
     "distinguishes 'corrected after filing' from 'edited before issue', which "
     "is the entire distinction an amendment section reports."),
    ("txpd / supeco / ecom",
     "Deemed exports, e-commerce operator supplies and TCS. No store, and no "
     "field on any Ganit row that identifies a supply as one of these."),
])


# ══════════════════════════════════════════════════════════════════════════════
# Place of supply
# ══════════════════════════════════════════════════════════════════════════════

#: GST state codes 01–38, plus 97 (Other Territory) and 99 (Centre
#: Jurisdiction). `services/gstin.py` validates the code range; this maps the
#: NAMES, because `ganit_invoices.place_of_supply` is free text — on the live
#: database it holds things like "Gujarat", and the render fixtures use
#: "Maharashtra (27)". Aliases are the spellings people actually type.
STATE_CODES: dict[str, str] = {}


def _register(code: str, *names: str) -> None:
    for name in names:
        STATE_CODES[_norm_state(name)] = code


def _norm_state(text: str) -> str:
    return "".join(ch for ch in str(text or "").lower() if ch.isalnum())


_register("01", "Jammu and Kashmir", "Jammu & Kashmir", "J&K")
_register("02", "Himachal Pradesh")
_register("03", "Punjab")
_register("04", "Chandigarh")
_register("05", "Uttarakhand", "Uttaranchal")
_register("06", "Haryana")
_register("07", "Delhi", "New Delhi", "NCT of Delhi")
_register("08", "Rajasthan")
_register("09", "Uttar Pradesh")
_register("10", "Bihar")
_register("11", "Sikkim")
_register("12", "Arunachal Pradesh")
_register("13", "Nagaland")
_register("14", "Manipur")
_register("15", "Mizoram")
_register("16", "Tripura")
_register("17", "Meghalaya")
_register("18", "Assam")
_register("19", "West Bengal")
_register("20", "Jharkhand")
_register("21", "Odisha", "Orissa")
_register("22", "Chhattisgarh", "Chattisgarh")
_register("23", "Madhya Pradesh")
_register("24", "Gujarat")
_register("25", "Daman and Diu")
_register("26", "Dadra and Nagar Haveli and Daman and Diu", "Dadra and Nagar Haveli")
_register("27", "Maharashtra")
_register("29", "Karnataka")
_register("30", "Goa")
_register("31", "Lakshadweep")
_register("32", "Kerala")
_register("33", "Tamil Nadu", "Tamilnadu")
_register("34", "Puducherry", "Pondicherry")
_register("35", "Andaman and Nicobar Islands", "Andaman & Nicobar")
_register("36", "Telangana", "Telengana")
_register("37", "Andhra Pradesh")
_register("38", "Ladakh")
_register("97", "Other Territory")
_register("99", "Centre Jurisdiction")

#: 28 is the pre-bifurcation Andhra Pradesh code. It is still accepted on input
#: — historical documents carry it — but the NAME "Andhra Pradesh" maps to 37,
#: which is the live code.
_VALID_CODES = frozenset([f"{n:02d}" for n in range(1, 39)] + ["97", "99"])


def parse_state_code(raw) -> str:
    """A two-digit GST state code out of whatever `place_of_supply` holds.

    Handles the three forms this column is known to contain: a bare code
    ("27"), a name ("Gujarat"), and a name carrying its code
    ("Maharashtra (27)", "27-Maharashtra"). Returns "" when it cannot tell —
    never a guess, because a wrong place of supply moves tax between states.
    """
    text = str(raw or "").strip()
    if not text:
        return ""

    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 2 and digits in _VALID_CODES:
        return digits

    normalised = _norm_state(text)
    if normalised in STATE_CODES:
        return STATE_CODES[normalised]

    # "Maharashtra (27)" — strip the digits and try the name that remains.
    without_digits = _norm_state("".join(ch for ch in text if not ch.isdigit()))
    if without_digits in STATE_CODES:
        return STATE_CODES[without_digits]
    return ""


def supplier_state_code(org: dict) -> str:
    """The supplier's own state, from the GSTIN first.

    The first two characters of a GSTIN ARE the state code, so a registration
    is the most reliable source and needs no name lookup. `state_code` and the
    billing address are fallbacks for an org recorded before the column existed.
    """
    org = org or {}
    gstin = gstin_normalise(str(org.get("gstin") or ""))
    if gstin_is_valid(gstin):
        return gstin_state_code(gstin)

    declared = str(org.get("state_code") or "").strip()
    if declared in _VALID_CODES:
        return declared
    from_name = parse_state_code(declared)
    if from_name:
        return from_name

    address = org.get("billing_address")
    if isinstance(address, dict):
        return parse_state_code(address.get("state"))
    return ""


# ══════════════════════════════════════════════════════════════════════════════
# Units
# ══════════════════════════════════════════════════════════════════════════════

#: GSTN publishes a closed list of Unit Quantity Codes. `ganit_invoices`
#: line items carry a free-text `unit` that defaults to "NOS", so anything not
#: recognised becomes OTH — which is GSTN's own code for "others" and is
#: therefore an honest answer rather than a substituted one.
UQC_MAP = {
    "nos": "NOS", "no": "NOS", "nO": "NOS", "number": "NOS", "numbers": "NOS",
    "pcs": "PCS", "pc": "PCS", "piece": "PCS", "pieces": "PCS",
    "kg": "KGS", "kgs": "KGS", "kilogram": "KGS", "kilograms": "KGS",
    "gm": "GMS", "gms": "GMS", "gram": "GMS", "grams": "GMS",
    "ltr": "LTR", "l": "LTR", "litre": "LTR", "litres": "LTR", "liter": "LTR",
    "mtr": "MTR", "m": "MTR", "metre": "MTR", "metres": "MTR", "meter": "MTR",
    "box": "BOX", "boxes": "BOX",
    "bag": "BAG", "bags": "BAG",
    "set": "SET", "sets": "SET",
    "pair": "PRS", "pairs": "PRS", "prs": "PRS",
    "unit": "UNT", "units": "UNT", "unt": "UNT",
    "sqm": "SQM", "sqf": "SQF", "sqft": "SQF",
    "ton": "TON", "tons": "TON", "tonne": "TON", "mt": "TON",
    "dozen": "DOZ", "doz": "DOZ",
    "hr": "OTH", "hrs": "OTH", "hour": "OTH", "hours": "OTH",
    "day": "OTH", "days": "OTH", "month": "OTH", "months": "OTH", "mo": "OTH",
}
UQC_FALLBACK = "OTH"


def uqc(unit) -> str:
    return UQC_MAP.get(str(unit or "").strip().lower(), UQC_FALLBACK)


# ══════════════════════════════════════════════════════════════════════════════
# Formatting
# ══════════════════════════════════════════════════════════════════════════════

def gst_date(value) -> str:
    """`DD-MM-YYYY`, the only date form the GSTR-1 schema takes."""
    if isinstance(value, datetime):
        return value.strftime("%d-%m-%Y")
    if isinstance(value, date):
        return value.strftime("%d-%m-%Y")
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).strftime("%d-%m-%Y")
        except ValueError:
            continue
    return ""


def fp(period: str) -> str:
    """`2026-07` → `072026`, the return period the schema calls `fp`."""
    year, month = period.split("-")[:2]
    return f"{int(month):02d}{year}"


def _num(d: Decimal) -> float:
    """A Decimal as the JSON number the schema expects.

    Serialised as a float because the GSTR-1 schema's amounts are JSON numbers,
    not strings. The value has already been rounded to 2dp as a Decimal, so this
    conversion is the LAST operation on it — nothing is summed after it, and the
    binary representation never gets a chance to accumulate.
    """
    return float(d)


def _rate(value) -> float:
    """A GST rate as the schema wants it: 18, 12, 0.25 — not "18%" and not 18.00."""
    d = dec2(value)
    return int(d) if d == d.to_integral_value() else float(d)


# ══════════════════════════════════════════════════════════════════════════════
# Per-invoice item breakdown
# ══════════════════════════════════════════════════════════════════════════════

def _rate_buckets(row: dict) -> tuple[list[dict], str | None]:
    """The invoice's lines collapsed to one entry per GST rate.

    GSTR-1 reports `itms` per rate, not per line, so lines sharing a rate are
    summed. Which tax head the amount lands in follows the invoice's stored
    `is_igst` flag — the flag is READ, never re-derived from an address, for the
    same reason the Tally exporter does not re-derive it.

    Returns `(buckets, problem)`. `problem` is set when the invoice cannot be
    reported honestly, and the caller holds the row back rather than shipping a
    bucket list that does not add up to the invoice.
    """
    lines = load_line_items(row.get("line_items"))
    if not lines:
        return [], "the invoice has no line items"

    is_igst = bool(row.get("is_igst"))
    buckets: "OrderedDict[str, dict]" = OrderedDict()

    for line in lines:
        # Rule 46(g) — every line needs an HSN or SAC. The same rule
        # `_assemble_gstr3b` holds an invoice back for, applied here for the
        # same reason: a supply reported without its code is not reportable.
        code = str(line.get("hsn_code") or "").strip() or str(line.get("sac_code") or "").strip()
        if not code:
            return [], "a line has no HSN or SAC code (rule 46(g))"

        rate = dec2(line.get("gst_rate"))
        taxable = dec2(line.get("line_total"))
        tax = dec2(line.get("gst_amount"))
        key = str(rate)
        bucket = buckets.setdefault(key, {"rate": rate, "txval": ZERO, "tax": ZERO})
        bucket["txval"] += taxable
        bucket["tax"] += tax

    # Reconcile what the lines say against what the header records. These are
    # two independent figures in this schema — the header columns are what the
    # PDF prints and what GSTR-3B totals — and a disagreement beyond rounding
    # means one of them is wrong. Reporting either without saying so would put a
    # number in a tax file that no document supports.
    line_tax = sum((b["tax"] for b in buckets.values()), ZERO)
    header_tax = dec2(row.get("cgst")) + dec2(row.get("sgst")) + dec2(row.get("igst"))
    drift = abs(line_tax - header_tax)
    if drift > TAX_RECONCILIATION_TOLERANCE:
        return [], (
            f"the lines total {line_tax} of GST but the invoice header records "
            f"{header_tax} — a difference of {drift}, which is more than rounding"
        )

    # Cess is a HEADER column on `ganit_invoices` — there is no per-line cess
    # figure and no cess rate anywhere on a line. With one rate bucket the
    # header figure belongs to that bucket unambiguously. With several there is
    # nothing that says how it splits, and apportioning it by taxable value
    # would be an invention, so the invoice is held back and named.
    cess = dec2(row.get("cess"))
    if cess != ZERO and len(buckets) > 1:
        return [], (
            f"the invoice carries {cess} of cess across {len(buckets)} different "
            f"GST rates, and nothing on the lines records how it divides between them"
        )

    items = []
    for index, bucket in enumerate(buckets.values(), 1):
        tax = bucket["tax"]
        detail: dict = {"rt": _rate(bucket["rate"]), "txval": _num(bucket["txval"])}
        if is_igst:
            detail["iamt"] = _num(tax)
        else:
            # The half is rounded once, and the second half is the REMAINDER
            # rather than a second rounding — so camt + samt is always exactly
            # the line's tax, and a rate whose half ends in a half-paisa cannot
            # drift a paisa away from the invoice.
            half = (tax / 2).quantize(Decimal("0.01"), rounding="ROUND_HALF_UP")
            detail["camt"] = _num(half)
            detail["samt"] = _num(tax - half)
        detail["csamt"] = _num(cess if len(buckets) == 1 else ZERO)
        items.append({"num": index, "itm_det": detail})
    return items, None


# ══════════════════════════════════════════════════════════════════════════════
# The build
# ══════════════════════════════════════════════════════════════════════════════

def build_gstr1(
    rows: list[dict],
    org: dict,
    period: str,
    *,
    b2cl_threshold: Decimal | None = None,
    b2cl_threshold_source: str | None = None,
) -> tuple[dict, dict]:
    """Return `(payload, manifest)` for one tax period.

    `rows` are invoices the ROUTER has already scoped to the org, the period and
    `is_active` — this function neither reaches the database nor re-applies
    tenancy. It receives EVERY document type in the period, because the supply
    sections and `doc_issue` need different subsets of the same rows.

    `payload` carries only sections that have rows. `manifest` carries the
    counts, the reconciliation totals, everything held back with its reason, and
    the omitted-section list — so a caller can state what is in the file and
    what is missing from it without re-deriving either.

    `b2cl_threshold` is the dated statutory figure, resolved by the CALLER
    through `resolve_b2cl_threshold` at the period end. It is a parameter rather
    than a lookup inside this function for the reason the module docstring gives
    about `load_line_items`: this builder stays pure and synchronous, so the
    suite can drive it with no database and the tenancy-scoped fetch stays in
    exactly one place. Omitted, it falls back to `B2CL_THRESHOLD` — which is what
    every existing caller and test gets, unchanged.
    """
    org = org or {}
    rows = list(rows or [])

    if b2cl_threshold is None:
        b2cl_threshold = B2CL_THRESHOLD
        b2cl_threshold_source = b2cl_threshold_source or (
            "built-in default — no dated threshold was supplied by the caller")

    supplier_gstin = gstin_normalise(str(org.get("gstin") or ""))
    home_state = supplier_state_code(org)

    held_back: list[dict] = []
    excluded: list[dict] = []
    notes_present: list[str] = []

    b2b_by_ctin: "OrderedDict[str, list]" = OrderedDict()
    b2cl_by_pos: "OrderedDict[str, list]" = OrderedDict()
    b2cs_agg: "OrderedDict[tuple, dict]" = OrderedDict()
    hsn_agg: "OrderedDict[tuple, dict]" = OrderedDict()

    reported_taxable = ZERO
    reported_tax = ZERO
    source_taxable = ZERO
    source_tax = ZERO
    included_invoices = 0

    def _label(row: dict) -> str:
        return str(row.get("invoice_number") or "").strip() or "an unnumbered document"

    def _hold(row: dict, reason: str) -> None:
        held_back.append({"document": _label(row), "reason": reason})

    def _exclude(row: dict, reason: str) -> None:
        excluded.append({"document": _label(row), "reason": reason})

    for row in rows:
        inv_type = str(row.get("invoice_type") or "")
        label = _label(row)

        # ── what is not a supply at all ──────────────────────────────────────
        if inv_type in ("quotation", "proforma"):
            continue                     # an offer; not reportable, not worth naming
        if row.get("cancelled_at") or str(row.get("payment_status") or "") == "cancelled":
            _exclude(row, "cancelled")
            continue
        if str(row.get("doc_status") or "") == "draft":
            _exclude(row, "still a draft — not issued")
            continue

        # Credit and debit notes belong in cdnr/cdnur, which this module does
        # not emit. They must NOT fall through into b2b, where they would be
        # reported as positive supplies and overstate outward tax.
        if inv_type in ("credit_note", "debit_note"):
            notes_present.append(f"{label} ({inv_type.replace('_', ' ')})")
            continue
        if inv_type != "tax_invoice":
            _exclude(row, f"{inv_type or 'untyped'} is not a tax invoice")
            continue

        currency = str(row.get("currency") or "INR").upper()
        if currency != "INR":
            _hold(row, f"raised in {currency}; GSTR-1 reports rupees and no "
                       f"conversion is recorded on the row")
            continue
        if row.get("is_export"):
            _exclude(row, "export (zero-rated) — belongs in the exp section, "
                          "which needs shipping-bill data Kartavaya has no column for")
            continue
        nature = str(row.get("supply_nature") or "taxable")
        if nature != "taxable":
            _exclude(row, f"supply_nature is '{nature}' — belongs in a nil/exempt "
                          f"or export section this file does not carry")
            continue

        items, problem = _rate_buckets(row)
        if problem:
            _hold(row, problem)
            continue

        idt = gst_date(row.get("invoice_date"))
        if not idt:
            _hold(row, "invoice date is missing or unreadable")
            continue

        total = dec2(row.get("total"))
        is_igst = bool(row.get("is_igst"))

        # ── place of supply ──────────────────────────────────────────────────
        pos = parse_state_code(row.get("place_of_supply"))
        if not pos and not is_igst:
            # An INTRA-state supply is, by the definition of the flag the
            # invoice already records, supplied in the supplier's own state.
            # This is not a new classifier — it is what `is_igst = false`
            # MEANS. Inter-state is the opposite case: the flag says the
            # destination is elsewhere and says nothing about where, so there
            # is nothing to fall back on and the row is held back.
            pos = home_state
        if not pos:
            _hold(row, "no place of supply recorded, and it cannot be inferred "
                       "for an inter-state supply")
            continue

        ctin = gstin_normalise(str(row.get("contact_gstin") or ""))
        if ctin and not gstin_is_valid(ctin):
            # A GSTIN carries its own check digit. Shipping a bad one produces
            # a rejection at the portal, or worse, a credit the recipient never
            # receives — months later.
            _hold(row, f"the customer's GSTIN ({ctin}) fails its own check digit")
            continue

        # ── running reconciliation ───────────────────────────────────────────
        included_invoices += 1
        for item in items:
            detail = item["itm_det"]
            reported_taxable += dec2(detail["txval"])
            reported_tax += (dec2(detail.get("iamt")) + dec2(detail.get("camt"))
                             + dec2(detail.get("samt")))
        source_taxable += dec2(row.get("subtotal"))
        source_tax += dec2(row.get("cgst")) + dec2(row.get("sgst")) + dec2(row.get("igst"))

        inum = str(row.get("invoice_number") or "").strip()

        # ── b2b: the recipient is registered ─────────────────────────────────
        if ctin:
            b2b_by_ctin.setdefault(ctin, []).append({
                "inum": inum, "idt": idt, "val": _num(total), "pos": pos,
                # Reverse charge on an OUTWARD supply is a property of the
                # supply that Kartavaya records nowhere on an invoice — the
                # only reverse-charge flag in the schema is on a vendor BILL.
                # "N" is what the absence of the flag means for a normal
                # outward supply, and it is stated in the manifest.
                "rchrg": "N",
                "inv_typ": "R",
                "itms": items,
            })
        # ── b2cl: inter-state, unregistered, above the threshold ─────────────
        elif is_igst and total > b2cl_threshold:
            b2cl_by_pos.setdefault(pos, []).append({
                "inum": inum, "idt": idt, "val": _num(total), "itms": items,
            })
        # ── b2cs: everything else unregistered, aggregated ───────────────────
        else:
            for item in items:
                detail = item["itm_det"]
                key = ("INTER" if is_igst else "INTRA", pos, detail["rt"])
                agg = b2cs_agg.setdefault(key, {
                    "sply_ty": key[0], "pos": pos, "typ": "OE", "rt": detail["rt"],
                    "txval": ZERO, "iamt": ZERO, "camt": ZERO, "samt": ZERO, "csamt": ZERO,
                })
                agg["txval"] += dec2(detail["txval"])
                for head in ("iamt", "camt", "samt", "csamt"):
                    if head in detail:
                        agg[head] += dec2(detail[head])

        # ── hsn: over the invoices actually included above ───────────────────
        for line in load_line_items(row.get("line_items")):
            code = str(line.get("hsn_code") or "").strip() or str(line.get("sac_code") or "").strip()
            rate = dec2(line.get("gst_rate"))
            unit = uqc(line.get("unit"))
            key = (code, str(rate), unit)
            entry = hsn_agg.setdefault(key, {
                "hsn_sc": code, "rt": rate, "uqc": unit,
                "desc": str(line.get("description") or "").strip()[:30],
                "qty": ZERO, "txval": ZERO,
                "iamt": ZERO, "camt": ZERO, "samt": ZERO, "csamt": ZERO,
            })
            entry["qty"] += dec2(line.get("quantity"))
            entry["txval"] += dec2(line.get("line_total"))
            tax = dec2(line.get("gst_amount"))
            if is_igst:
                entry["iamt"] += tax
            else:
                half = (tax / 2).quantize(Decimal("0.01"), rounding="ROUND_HALF_UP")
                entry["camt"] += half
                entry["samt"] += tax - half

    # ── assemble ─────────────────────────────────────────────────────────────
    payload: dict = {"gstin": supplier_gstin, "fp": fp(period)}

    if b2b_by_ctin:
        payload["b2b"] = [
            {"ctin": ctin, "inv": invoices} for ctin, invoices in b2b_by_ctin.items()
        ]
    if b2cl_by_pos:
        payload["b2cl"] = [
            {"pos": pos, "inv": invoices} for pos, invoices in b2cl_by_pos.items()
        ]
    if b2cs_agg:
        payload["b2cs"] = [
            {**{k: v for k, v in agg.items() if k in ("sply_ty", "pos", "typ", "rt")},
             **{k: _num(agg[k]) for k in ("txval", "iamt", "camt", "samt", "csamt")}}
            for agg in b2cs_agg.values()
        ]
    if hsn_agg:
        payload["hsn"] = {"data": [
            {"num": index, "hsn_sc": e["hsn_sc"], "desc": e["desc"], "uqc": e["uqc"],
             "qty": _num(e["qty"]), "rt": _rate(e["rt"]), "txval": _num(e["txval"]),
             "iamt": _num(e["iamt"]), "camt": _num(e["camt"]),
             "samt": _num(e["samt"]), "csamt": _num(e["csamt"])}
            for index, e in enumerate(hsn_agg.values(), 1)
        ]}

    doc_issue, doc_held = _doc_issue(rows)
    if doc_issue:
        payload["doc_issue"] = {"doc_det": doc_issue}
    held_back.extend(doc_held)

    manifest = {
        "period": period,
        "fp": payload["fp"],
        "gstin": supplier_gstin,
        "supplier_state_code": home_state,
        "sections_emitted": [k for k in payload if k not in ("gstin", "fp")],
        "sections_omitted": [{"section": k, "reason": v} for k, v in OMITTED_SECTIONS.items()],
        "invoice_count": included_invoices,
        "b2b_count": sum(len(v) for v in b2b_by_ctin.values()),
        "b2cl_count": sum(len(v) for v in b2cl_by_pos.values()),
        # The rule that decided the b2cl/b2cs split, and where it was read from.
        # Stated because the two sections tie out to the same totals either way:
        # a preparer comparing this month's file with last month's needs to be
        # able to see that the BUCKETING rule moved, and there is no other
        # figure in the manifest from which that could be inferred.
        "b2cl_threshold": _num(b2cl_threshold),
        "b2cl_threshold_source": b2cl_threshold_source,
        "b2cs_rows": len(b2cs_agg),
        "hsn_rows": len(hsn_agg),
        "held_back": held_back,
        "excluded": excluded,
        "credit_debit_notes_not_in_file": notes_present,
        # The numbers a preparer needs in order to believe the file. `reported`
        # is what this JSON says; `source` is what the invoice headers say.
        "reconciliation": {
            "reported_taxable_value": _num(reported_taxable),
            "source_taxable_value": _num(source_taxable),
            "taxable_value_difference": _num(reported_taxable - source_taxable),
            "reported_tax": _num(reported_tax),
            "source_tax": _num(source_tax),
            "tax_difference": _num(reported_tax - source_tax),
        },
    }
    return payload, manifest


def _doc_issue(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """The `doc_issue` section — which document numbers were issued this period.

    Kartavaya numbers documents `PREFIX-YYYY-NNNN` (`utils.next_doc_number`), so
    a series is everything before the final hyphen and the serial is what
    follows it. A series is reported ONLY when the serials present in the period
    are CONTIGUOUS from the lowest to the highest: `totnum` in this section means
    "how many numbers this range covers", and if a number in the middle belongs
    to another period or was deleted outright, the arithmetic range overstates
    what was issued. Reporting the count instead would make `totnum` disagree
    with `from`/`to`, which is its own kind of wrong — so a broken series is held
    back and named rather than approximated.

    Drafts ARE counted. `next_doc_number` allocates the number at creation, so a
    draft has consumed one; a series that skipped its drafts would read as full
    of holes. Cancelled documents are counted too, in `cancel`, which is what the
    column is for.
    """
    held: list[dict] = []
    out: list[dict] = []

    for doc_num, doc_typ, types in DOC_ISSUE_CATEGORIES:
        series: "OrderedDict[str, dict]" = OrderedDict()
        for row in rows:
            if str(row.get("invoice_type") or "") not in types:
                continue
            if not row.get("is_active", True):
                continue
            number = str(row.get("invoice_number") or "").strip()
            if "-" not in number:
                continue
            prefix, _, tail = number.rpartition("-")
            if not tail.isdigit():
                continue
            entry = series.setdefault(prefix, {"width": len(tail), "serials": {}})
            cancelled = bool(row.get("cancelled_at")) or \
                str(row.get("payment_status") or "") == "cancelled"
            entry["serials"][int(tail)] = cancelled

        docs = []
        for prefix, entry in series.items():
            serials = entry["serials"]
            low, high = min(serials), max(serials)
            span = high - low + 1
            if span != len(serials):
                held.append({
                    "document": f"{prefix} series",
                    "reason": f"documents issued {prefix}-{low:0{entry['width']}d} to "
                              f"{prefix}-{high:0{entry['width']}d} but only {len(serials)} "
                              f"of those {span} numbers are present — the series has gaps, "
                              f"so it is not reported in doc_issue rather than guessed at",
                })
                continue
            cancelled = sum(1 for is_cancelled in serials.values() if is_cancelled)
            docs.append({
                "num": len(docs) + 1,
                "from": f"{prefix}-{low:0{entry['width']}d}",
                "to": f"{prefix}-{high:0{entry['width']}d}",
                "totnum": span,
                "cancel": cancelled,
                "net_issue": span - cancelled,
            })
        if docs:
            out.append({"doc_num": doc_num, "doc_typ": doc_typ, "docs": docs})

    return out, held
