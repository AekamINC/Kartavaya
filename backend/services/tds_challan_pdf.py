"""tds_challan_pdf.py — the ITNS-281 TDS challan counterfoil.

Specification: `design-reference/Kartavaya Redesign/docs/TDS Challan.html`.
Pipeline, fonts and refusal semantics as `invoice_pdf.py`.

What this document IS
---------------------
A **counterfoil**, not the challan. The specification's footer is explicit —
"Counterfoil generated from गणित Ganit · verify against the bank challan before
filing 26Q". The bank's own challan and the CIN it stamps are the primary
record; this restates them alongside the deduction detail the bank never sees,
so the 26Q preparer has both in one place.

That distinction is why `validate_tds_challan` blocks on the CIN triple rather
than rendering a plausible-looking counterfoil with a blank BSR code. A
counterfoil that cannot be tied back to a real bank challan evidences nothing,
and an invented CIN is worse than a missing one — the same reservation
`invoice_pdf._org_gstin_line` records for the supplier GSTIN.

Statutory particulars and where each comes from
-----------------------------------------------
* **TAN** — section 203A. The deductor's identifier on ITNS-281; the PAN does
  not substitute for it. Format 4 letters, 5 digits, 1 letter.
* **Major head** — 0020 where the deductee is a company, 0021 otherwise. This
  is a property of the DEDUCTEE, not of the deductor, so it is never inferred
  from the org; the caller states it and the validator confirms it is one of the
  two. The specification prints 0021.
* **Type of payment** — 200 (TDS payable by taxpayer) or 400 (TDS on regular
  assessment, raised by the department). Same treatment: stated, then checked.
* **CIN** — the Challan Identification Number is the triple (BSR code of the
  collecting branch, date of tender, challan serial). 7 digits, DDMMYYYY,
  5 digits. All three are validated for shape, because a CIN that fails the
  portal's format check fails the 26Q it was quoted on.
* **Amount breakdown** — the six heads ITNS-281 splits a deposit into: income
  tax, surcharge, education cess, interest under section 201(1A), penalty, and
  the late-filing fee under section 234E. Their sum must equal the amount
  deposited; `validate_tds_challan` refuses when it does not.

What the schema cannot supply today
-----------------------------------
`staging.organisations` has NO `tan` column, and there is no challan table at
all — BSR code, challan serial, tender date, deposit date, bank, major head and
type of payment have nowhere to live. Non-salary deductions (194C, 194J, 194I,
194H) have no columns either: `ganit_vendor_bills` records no section, rate or
TDS amount. Only 192B salary TDS is derivable, from `staging.vetana_payslips`
and `staging.pay_tds_records`.

Nothing is invented to cover that. `backend/migrations/PROPOSED_documents.sql` §1–2 proposes
the columns; until they exist the endpoint refuses rather than emitting a
counterfoil with a fabricated CIN. See `swarm-reports/documents-build.md`.
"""

from __future__ import annotations

import re
from datetime import date, datetime

from services import doc_render as R
from services.doc_validation import DocumentCheck, validate_tds_challan
from services.invoice_pdf import amount_in_words_inr

#: ITNS-281 major heads. A property of the deductee, never of the deductor.
MAJOR_HEADS = {
    "0020": "Income tax on companies (corporation tax)",
    "0021": "Income tax other than companies",
}

#: ITNS-281 type of payment.
PAYMENT_TYPES = {
    "200": "(200) TDS payable by taxpayer",
    "400": "(400) TDS on regular assessment",
}

#: The six heads ITNS-281 splits a deposit into, in the form's own order and
#: wording. The specification prints them as a two-column block.
AMOUNT_HEADS = (
    ("income_tax", "Income tax"),
    ("surcharge", "Surcharge"),
    ("education_cess", "Education cess"),
    ("interest_201_1a", "Interest — section 201(1A)"),
    ("penalty", "Penalty"),
    ("fee_234e", "Fee — section 234E"),
)

TAN_RE = re.compile(r"^[A-Z]{4}[0-9]{5}[A-Z]$")
BSR_RE = re.compile(r"^[0-9]{7}$")
SERIAL_RE = re.compile(r"^[0-9]{5}$")
TENDER_RE = re.compile(r"^[0-9]{8}$")


def _r(value) -> int:
    try:
        return int(round(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def assessment_year(period: str) -> str:
    """The AY for a deduction period, as ITNS-281 asks for it.

    The Indian previous year runs 1 April to 31 March; the assessment year is
    the one that follows it. July 2026 falls in PY 2026-27, so AY 2027-28 —
    which is what the specification prints for its July 2026 challan.
    """
    try:
        dt = datetime.strptime(str(period), "%Y-%m")
    except (ValueError, TypeError):
        return ""
    fy_start = dt.year if dt.month >= 4 else dt.year - 1
    return f"{fy_start + 1}–{str(fy_start + 2)[-2:]}"


def statutory_due_date(period: str) -> str:
    """Rule 30(2): tax deducted in a month is payable by the 7th of the next.

    March is the exception — deductions for March are payable by 30 April
    (rule 30(2) proviso). The exception is implemented rather than glossed,
    because a challan that claims a March deposit was late when it was not is a
    document that invites a notice.
    """
    try:
        dt = datetime.strptime(str(period), "%Y-%m")
    except (ValueError, TypeError):
        return ""
    if dt.month == 3:
        return date(dt.year, 4, 30).isoformat()
    year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return date(year, month, 7).isoformat()


def _date_label(value) -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime("%d %b %Y")
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").strftime("%d %b %Y")
    except (ValueError, TypeError):
        return str(value or "")


def _period_label(period: str) -> str:
    try:
        return datetime.strptime(str(period), "%Y-%m").strftime("%B %Y")
    except (ValueError, TypeError):
        return str(period or "")


def tender_date_ddmmyyyy(value) -> str:
    """The CIN's middle element. The portal wants DDMMYYYY with no separator —
    the specification prints `07082026` for a 07 Aug 2026 tender."""
    if isinstance(value, (date, datetime)):
        return value.strftime("%d%m%Y")
    raw = str(value or "").strip()
    if TENDER_RE.match(raw):
        return raw
    try:
        return datetime.strptime(raw, "%Y-%m-%d").strftime("%d%m%Y")
    except (ValueError, TypeError):
        return ""


def compute(challan: dict) -> dict:
    """Totals, derived from the deduction lines and the amount breakdown.

    `total_tds` is the sum of the deduction lines — what was withheld.
    `total_deposited` is the sum of the six ITNS-281 heads — what reached the
    government. They are computed separately and on purpose: the validator
    compares them, and a mismatch is the single most useful thing this document
    can tell a preparer before the 26Q goes out.
    """
    challan = challan or {}
    lines = challan.get("deductions") or []
    total_tds = sum(_r(li.get("tds")) for li in lines)
    total_paid_base = sum(_r(li.get("amount_paid")) for li in lines)

    breakdown = {key: _r((challan.get("amounts") or {}).get(key)) for key, _ in AMOUNT_HEADS}
    interest_and_fee = breakdown["interest_201_1a"] + breakdown["penalty"] + breakdown["fee_234e"]
    tax_component = breakdown["income_tax"] + breakdown["surcharge"] + breakdown["education_cess"]
    total_deposited = tax_component + interest_and_fee

    return {
        "lines": lines,
        "total_tds": total_tds,
        "total_amount_paid": total_paid_base,
        "breakdown": breakdown,
        "tax_component": tax_component,
        "interest_and_fee": interest_and_fee,
        "total_deposited": total_deposited,
    }


def _build_html(challan: dict, org: dict, check: DocumentCheck | None = None) -> str:
    challan, org = challan or {}, org or {}
    check = check or DocumentCheck(document="TDS challan")
    c = compute(challan)

    period = str(challan.get("period") or "")
    deposit_date = challan.get("deposit_date") or ""
    due = challan.get("due_date") or statutory_due_date(period)
    on_time = bool(deposit_date and due and str(deposit_date) <= str(due))

    head = R.letterhead(
        org,
        kind_en="TDS challan · ITNS-281",
        kind_hi="कर चालान",
        doc_no=R.esc(challan.get("challan_number") or ""),
        chip_html=R.chip("Paid", "ok") if deposit_date else R.chip("Not deposited", "over"),
        show_tan=True,
    )

    ay = challan.get("assessment_year") or assessment_year(period)
    pay_type = str(challan.get("payment_type") or "").strip()
    meta = R.meta_strip([
        ("Assessment year", R.esc(ay) or R.unset("Assessment year")),
        ("Period", R.esc(_period_label(period)) or R.unset("Period")),
        ("Deposit date", R.esc(_date_label(deposit_date)) if deposit_date else R.unset("Deposit date")),
        ("Type of payment",
         R.esc(PAYMENT_TYPES.get(pay_type, "")) or R.unset("Type of payment")),
    ])

    major = str(challan.get("major_head") or "").strip()
    major_line = (
        f"Major head {R.esc(major)} — {R.esc(MAJOR_HEADS[major])}"
        if major in MAJOR_HEADS else R.unset("Major head")
    )
    bsr = str(challan.get("bsr_code") or "").strip()
    serial = str(challan.get("challan_serial") or "").strip()
    deposit_ids = " &middot; ".join(filter(None, [
        f"BSR code {R.esc(bsr)}" if bsr else R.unset("BSR code"),
        f"Challan serial {R.esc(serial)}" if serial else R.unset("Challan serial"),
    ]))

    party_block = R.parties(
        R.party(
            "Deductor",
            name=R.esc(org.get("name")) if org.get("name") else R.unset("Organisation name"),
            addr_html=R.fmt_addr(org.get("billing_address") or {}) or R.unset("Billing address"),
            id_html=(
                f'TAN <span>{R.esc(org["tan"])}</span>' if org.get("tan") else f"TAN {R.unset('TAN')}"
            ) + " &middot; " + (
                f'PAN <span>{R.esc(org["pan"])}</span>' if org.get("pan") else f"PAN {R.unset('PAN')}"
            ),
        ),
        R.party(
            "Deposited to",
            name=R.esc(challan.get("bank_name")) if challan.get("bank_name") else R.unset("Collecting bank"),
            addr_html=f"Government of India &middot; Income Tax Department<br>{major_line}",
            id_html=deposit_ids,
        ),
    )

    # ── deduction lines ──────────────────────────────────────────────────────
    rows = []
    for li in c["lines"]:
        rate = li.get("rate")
        # A blank rate is correct for 192B: salary TDS is deducted at the
        # employee's own average rate under section 192(1), not at a section
        # rate, so the column shows an em-dash rather than a number that would
        # be wrong for every employee.
        rate_cell = f"{R.esc(rate)}%" if rate not in (None, "", 0) else "&mdash;"
        rows.append(
            f'<tr><td class="num num--left">{R.esc(li.get("section"))}</td>'
            f'<td>{R.cell_desc(li.get("nature") or "", li.get("note") or "")}</td>'
            f'<td class="num">{R.esc(li.get("count") or "")}</td>'
            f'<td class="num">{R.num0(li.get("amount_paid"))}</td>'
            f'<td class="num">{rate_cell}</td>'
            f'<td class="num">{R.num0(li.get("tds"))}</td></tr>'
        )
    if not rows:
        rows.append(
            '<tr><td colspan="6" class="lines__mute">'
            "No deduction detail is recorded for this challan.</td></tr>"
        )
    deductions_table = R.table(
        [("Section", "", "62px"), ("Nature of payment", "", ""), ("Cnt", "num", "44px"),
         ("Amount paid", "num", "96px"), ("Rate", "num", "46px"), ("TDS", "num", "88px")],
        rows,
    )

    # ── amount breakdown, two heads per row as the specification prints it ───
    b = c["breakdown"]
    pairs = [(AMOUNT_HEADS[i], AMOUNT_HEADS[i + 3]) for i in range(3)]
    breakdown_rows = "".join(
        f'<tr><td>{R.esc(l_label)}</td><td class="num">{R.num0(b[l_key])}</td>'
        f'<td>{R.esc(r_label)}</td><td class="num">{R.num0(b[r_key])}</td></tr>'
        for (l_key, l_label), (r_key, r_label) in pairs
    )
    breakdown_table = R.table(
        [("Head", "", ""), ("Amount", "num", "110px"), ("Head", "", ""), ("Amount", "num", "110px")],
        [breakdown_rows],
    )

    totals_html = R.totals(
        [
            ("Total TDS deducted", R.money0(c["total_tds"])),
            ("Interest and fee", R.money0(c["interest_and_fee"])),
        ],
        grand=("Total deposited", R.money0(c["total_deposited"])),
    )

    method = R.esc(challan.get("payment_method") or "")
    words = R.words_line(
        f"{R.esc(amount_in_words_inr(c['total_deposited']))}"
        + (f", deposited by {method}" if method else ", deposited")
        + (f" on {R.esc(_date_label(deposit_date))}." if deposit_date else ".")
    )

    # ── CIN ──────────────────────────────────────────────────────────────────
    tender = tender_date_ddmmyyyy(challan.get("tender_date") or deposit_date)
    cin_meta = R.meta_strip(
        [
            ("BSR code", R.esc(bsr) if bsr else R.unset("BSR code")),
            ("Tender date", R.esc(tender) if tender else R.unset("Tender date")),
            ("Serial", R.esc(serial) if serial else R.unset("Challan serial")),
        ],
        mono_labels=("BSR code", "Tender date", "Serial"),
        columns=3,
    ).replace('class="meta meta--3"', 'class="meta meta--3 meta--flush"')

    notes: list[str] = []
    if due:
        notes.append(
            f"Due date for {R.esc(_period_label(period))} deductions was "
            f"{R.esc(_date_label(due))} (rule 30(2))."
            + (" Deposited on time; no interest under 201(1A)." if on_time else
               " Verify interest under section 201(1A) if deposited late.")
        )
    for n in challan.get("notes") or []:
        notes.append(R.esc(n))
    notes.append(
        "Verify the BSR code, tender date and serial against the bank's own "
        "challan before this CIN is quoted on a quarterly return."
    )

    cin_block = (
        '<div class="block" style="margin-top:0">'
        '<div class="block__l">Challan identification number (CIN)</div>'
        f"{cin_meta}{R.terms_list(notes)}</div>"
    )

    sign = R.sign_block(
        "Authorised signatory",
        org.get("authorized_signatory_name") or "",
        org.get("authorized_signatory_designation") or "",
    )

    page = "".join([
        head, meta, party_block,
        R.block("Deductions covered by this challan", deductions_table),
        R.block("Amount breakdown as deposited", breakdown_table),
        totals_html, words,
        R.parties(cin_block, sign, flush=True),
        R.gap_note(check),
        R.foot(
            f"Counterfoil generated from {R.deva_span('गणित', 'Ganit')} Ganit &middot; "
            "verify against the bank challan before filing 26Q"
        ),
    ])
    return R.document([page], org, title="TDS Challan — Kartavaya")


def generate_tds_challan_pdf(challan: dict, org: dict) -> bytes:
    """Render the ITNS-281 counterfoil to PDF bytes.

    Raises `DocumentIncomplete` before WeasyPrint is imported when the TAN, the
    CIN triple, the major head or the type of payment is missing, or when the
    amount breakdown does not equal the tax deducted.
    """
    challan, org = challan or {}, org or {}
    check = validate_tds_challan(challan, org, computed=compute(challan))
    check.raise_if_incomplete()
    return R.render_pdf(_build_html(challan, org, check))
