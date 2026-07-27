"""gstr3b_pdf.py — the GSTR-3B working paper.

Specification: `design-reference/Kartavaya Redesign/docs/GSTR-3B Summary.html`.
Rendering pipeline, font handling and refusal semantics are the ones
`invoice_pdf.py` and `payslip_pdf.py` already use.

What this document IS
---------------------
A **working paper**, not a return. The specification's own footer says so —
"Working paper generated from गणित Ganit · not a filed return · retain with
books under section 35" — and the meta strip carries "Filing status: Working —
not filed" with "ARN: Not generated". Nothing here files anything, and the
document must never be mistaken for the summary the portal generates.

That framing is load-bearing, because the specification's Table 4 is a SUBSET
of the notified form. See `_TABLE_4_DIVERGENCE` below; it is reproduced in
`swarm-reports/documents-build.md` rather than buried here.

The set-off is computed, never accepted
---------------------------------------
Table 6.1 is the part a CA firm will check first, and it is the part that is
easiest to get quietly wrong. Two statutory rules govern it, and both are
implemented in `compute_set_off` rather than left to the caller:

1. **Order of utilisation** — section 49(5) with sections 49A/49B and rule 88A.
   IGST credit must be exhausted first; it may then pay CGST and SGST. CGST
   credit pays CGST then IGST. SGST credit pays SGST then IGST. CGST credit can
   never pay SGST and SGST credit can never pay CGST (section 49(5)(c) and (d)).
   Cess pays only cess.

2. **Reverse charge is cash-only** — section 49(4) read with rule 85(4): a
   liability under reverse charge cannot be discharged from the electronic
   credit ledger. So the 3.1(d) tax is carved out of the ITC-payable base and
   added straight to the cash column.

Feeding the specification's own Table 3.1 and Table 4 figures through
`compute_set_off` reproduces its printed Table 6.1 and its four totals exactly,
to the rupee. `tests/test_document_statutory.py` asserts precisely that, so a
change to the set-off logic fails against the approved design rather than
against nothing.

Rounding
--------
Every figure the specification prints is a whole rupee, which is what the form
requires. Figures are rounded once, on the way in, so the printed columns add
up to the printed totals — a document whose columns do not sum is the defect the
totals exist to catch.
"""

from __future__ import annotations

from datetime import date, datetime

from services import doc_render as R
from services.doc_validation import DocumentCheck, validate_gstr3b
from services.invoice_pdf import amount_in_words_inr

#: The heads, in the order every table in the form prints them.
HEADS = ("igst", "cgst", "sgst", "cess")

#: Table 4 of the specification is a subset of the notified form. Recorded here
#: and in the build report; NOT silently "corrected", because the specification
#: is the approved design and improvising field names on a statutory document is
#: the worse failure. A firm filing from this paper reads the portal's own form.
_TABLE_4_DIVERGENCE = (
    "Specification Table 4 omits (A)(2) import of services, (A)(4) inward "
    "supplies from an ISD, and (D)(1) ITC reclaimed. Its (D) row is labelled "
    "'Ineligible ITC — section 17(5)'; on the form notified from July 2022 "
    "section 17(5) ineligible credit is reported as a reversal under 4(B)(1) "
    "and 4(D)(2) covers section 16(4) and place-of-supply restrictions instead."
)

#: 3.1 row labels — the specification's wording, which is the form's wording.
_ROW_31 = (
    ("outward_taxable", "(a) Outward taxable (other than zero-rated, nil, exempt)", ""),
    ("outward_zero_rated", "(b) Outward taxable — zero-rated", "Export of services, LUT furnished"),
    ("outward_nil_exempt", "(c) Other outward — nil rated, exempted", ""),
    ("inward_reverse_charge", "(d) Inward supplies liable to reverse charge", ""),
    ("outward_non_gst", "(e) Non-GST outward supplies", ""),
)

#: 4 row labels — see `_TABLE_4_DIVERGENCE`.
_ROW_4_AVAILABLE = (
    ("itc_import_goods", "(A) ITC available — import of goods", ""),
    ("itc_reverse_charge", "(A) ITC available — inward reverse charge", ""),
    ("itc_all_other", "(A) ITC available — all other ITC", ""),
)


def _r(value) -> int:
    """One rounding, on the way in. See module docstring."""
    try:
        return int(round(float(value or 0)))
    except (TypeError, ValueError):
        return 0


def _heads(block) -> dict[str, int]:
    block = block if isinstance(block, dict) else {}
    return {h: _r(block.get(h)) for h in HEADS}


def _taxable(block) -> int:
    block = block if isinstance(block, dict) else {}
    return _r(block.get("taxable"))


def compute_set_off(
    payable: dict[str, int],
    credit: dict[str, int],
    cash_only: dict[str, int] | None = None,
) -> dict[str, dict[str, int]]:
    """Discharge `payable` from `credit` in the statutory order.

    `cash_only` is the slice of `payable` that may not touch the credit ledger —
    in practice the reverse-charge tax from 3.1(d). It is excluded from the
    ITC-payable base and re-added to the cash column.

    Returns, per head: `payable`, `via_itc`, `in_cash`, and `credit_left`.
    """
    payable = {h: _r(payable.get(h)) for h in HEADS}
    credit = {h: _r(credit.get(h)) for h in HEADS}
    cash_only = {h: _r((cash_only or {}).get(h)) for h in HEADS}

    # Reverse-charge liability never reaches the credit ledger.
    remaining = {h: max(0, payable[h] - cash_only[h]) for h in HEADS}
    left = dict(credit)
    used = {h: 0 for h in HEADS}

    def _apply(credit_head: str, liability_head: str) -> None:
        take = min(left[credit_head], remaining[liability_head])
        if take <= 0:
            return
        left[credit_head] -= take
        remaining[liability_head] -= take
        used[liability_head] += take

    # Section 49A / rule 88A: IGST credit first, and fully, before any other.
    for target in ("igst", "cgst", "sgst"):
        _apply("igst", target)
    # CGST credit: own head, then IGST. Never SGST — section 49(5)(c).
    for target in ("cgst", "igst"):
        _apply("cgst", target)
    # SGST credit: own head, then IGST. Never CGST — section 49(5)(d).
    for target in ("sgst", "igst"):
        _apply("sgst", target)
    # Cess pays cess alone.
    _apply("cess", "cess")

    return {
        h: {
            "payable": payable[h],
            "via_itc": used[h],
            "in_cash": remaining[h] + cash_only[h],
            "credit_left": left[h],
        }
        for h in HEADS
    }


def compute(gstr: dict) -> dict:
    """Derive Table 4(C), Table 6.1 and the four totals from Tables 3.1 and 4.

    Everything downstream of 3.1 and 4 is computed here, so the renderer prints
    one arithmetic rather than trusting a caller's.
    """
    gstr = gstr or {}

    outward_tax = _heads(gstr.get("outward_taxable"))
    rcm_tax = _heads(gstr.get("inward_reverse_charge"))

    # 6.1 liability = tax on outward taxable supplies + tax on inward supplies
    # liable to reverse charge. Zero-rated, nil/exempt and non-GST rows carry no
    # output tax by definition and are not added.
    payable = {h: outward_tax[h] + rcm_tax[h] for h in HEADS}

    available = {h: 0 for h in HEADS}
    for key, _label, _sub in _ROW_4_AVAILABLE:
        row = _heads(gstr.get(key))
        for h in HEADS:
            available[h] += row[h]
    reversed_itc = _heads(gstr.get("itc_reversed"))
    net_itc = {h: available[h] - reversed_itc[h] for h in HEADS}

    set_off = compute_set_off(payable, net_itc, cash_only=rcm_tax)

    interest = _r(gstr.get("interest")) + _r(gstr.get("late_fee"))
    total_payable = sum(set_off[h]["payable"] for h in HEADS)
    total_itc = sum(set_off[h]["via_itc"] for h in HEADS)
    total_cash = sum(set_off[h]["in_cash"] for h in HEADS) + interest

    return {
        "payable": payable,
        "itc_available": available,
        "itc_reversed": reversed_itc,
        "net_itc": net_itc,
        "set_off": set_off,
        "interest": interest,
        "total_payable": total_payable,
        "total_itc": total_itc,
        "total_cash": total_cash,
    }


def _period_label(period: str) -> str:
    """'2026-07' -> 'July 2026'. Same tolerance as `payslip_pdf._month_label`."""
    try:
        return datetime.strptime(str(period), "%Y-%m").strftime("%B %Y")
    except (ValueError, TypeError):
        return str(period or "")


def _period_short(period: str) -> str:
    """'2026-07' -> 'JUL 2026', which is what `.lh__no` prints."""
    try:
        return datetime.strptime(str(period), "%Y-%m").strftime("%b %Y").upper()
    except (ValueError, TypeError):
        return str(period or "").upper()


def _date_label(value) -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime("%d %b %Y")
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").strftime("%d %b %Y")
    except (ValueError, TypeError):
        return str(value or "")


def statutory_due_date(period: str) -> str:
    """The 20th of the month following the tax period — section 39(7) read with
    rule 61(1)(i), the monthly filer's date. A quarterly QRMP filer's date is the
    22nd or 24th depending on the State group, and NOTHING in the schema records
    which scheme an organisation is on, so this returns the monthly date and the
    validator flags the assumption rather than the renderer hiding it."""
    try:
        dt = datetime.strptime(str(period), "%Y-%m")
    except (ValueError, TypeError):
        return ""
    year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return date(year, month, 20).isoformat()


def _tax_row(label: str, sub: str, taxable: int | None, heads: dict[str, int]) -> str:
    cells = "".join(f'<td class="num">{R.num0(heads[h])}</td>' for h in HEADS)
    taxable_cell = f'<td class="num">{R.num0(taxable)}</td>' if taxable is not None else ""
    return f"<tr><td>{R.cell_desc(label, sub)}</td>{taxable_cell}{cells}</tr>"


def _build_html(gstr: dict, org: dict, check: DocumentCheck | None = None) -> str:
    gstr, org = gstr or {}, org or {}
    check = check or DocumentCheck(document="GSTR-3B working paper")
    c = compute(gstr)

    period = str(gstr.get("period") or "")
    due = gstr.get("due_date") or statutory_due_date(period)

    # ── header ───────────────────────────────────────────────────────────────
    head = R.letterhead(
        org,
        kind_en="GSTR-3B summary",
        kind_hi="मासिक विवरणी",
        doc_no=_period_short(period),
        chip_html=R.chip(f"Due {_date_label(due)}", "due") if due else "",
    )

    meta = R.meta_strip(
        [
            ("Return period", R.esc(_period_label(period)) or R.unset("Return period")),
            ("Due date", R.esc(_date_label(due)) or R.unset("Due date")),
            ("Filing status", R.esc(gstr.get("filing_status") or "Working — not filed")),
            ("ARN", R.esc(gstr.get("arn") or "Not generated")),
        ],
        mono_labels=("ARN",),
    )

    state = R.esc(gstr.get("state_label") or "")
    gstin_line = (
        f'GSTIN <span>{R.esc(org["gstin"])}</span>' if org.get("gstin") else f"GSTIN {R.unset('GSTIN')}"
    ) + (f" &middot; {state}" if state else "")

    # The preparation narrative names what was counted AND what was held back.
    # The specification puts the held-back invoices in bold on the face of the
    # document; excluding them quietly is the exact defect the paper exists to
    # surface.
    held = gstr.get("held_back") or []
    held_sentence = ""
    if held:
        names = ", ".join(R.esc(h.get("party") or "unnamed party") for h in held)
        reasons = sorted({R.esc(h.get("reason") or "reason not recorded") for h in held})
        held_sentence = (
            f" <b>{len(held)} record{'' if len(held) == 1 else 's'} excluded — "
            f"{'; '.join(reasons)}: {names}.</b>"
        )

    prep_bits = []
    if gstr.get("prepared_by"):
        prep_bits.append(R.esc(gstr["prepared_by"]))
    if gstr.get("prepared_on"):
        prep_bits.append(f"on {R.esc(_date_label(gstr['prepared_on']))}")
    prep_lead = " ".join(prep_bits) or "Kartavaya"
    counts = (
        f"Figures are computed from {int(gstr.get('outward_count') or 0)} outward "
        f"invoices and {int(gstr.get('inward_count') or 0)} inward records"
    )
    recon = (
        f", reconciled against GSTR-2B dated {R.esc(_date_label(gstr['gstr2b_date']))}"
        if gstr.get("gstr2b_date") else ""
    )

    party_block = R.parties(
        R.party(
            "Registered person",
            name=R.esc(org.get("name")) if org.get("name") else R.unset("Organisation name"),
            addr_html=R.fmt_addr(org.get("billing_address") or {}) or R.unset("Billing address"),
            id_html=gstin_line,
        ),
        R.party("Prepared by", body_html=f"{prep_lead} from Ganit. {counts}{recon}.{held_sentence}"),
    )

    # ── 3.1 ──────────────────────────────────────────────────────────────────
    rows_31 = [
        _tax_row(label, sub, _taxable(gstr.get(key)), _heads(gstr.get(key)))
        for key, label, sub in _ROW_31
    ]
    table_31 = R.table(
        [("Nature of supply", "", ""), ("Taxable value", "num", "96px"),
         ("IGST", "num", "74px"), ("CGST", "num", "74px"),
         ("SGST", "num", "74px"), ("Cess", "num", "64px")],
        rows_31,
    )

    # ── 4 ────────────────────────────────────────────────────────────────────
    rows_4 = [
        _tax_row(label, sub, None, _heads(gstr.get(key)))
        for key, label, sub in _ROW_4_AVAILABLE
    ]
    rows_4.append(_tax_row("(B) ITC reversed — rule 42 / 43", "", None, c["itc_reversed"]))
    rows_4.append(_tax_row("(C) Net ITC available (A − B)", "", None, c["net_itc"]))
    rows_4.append(
        _tax_row("(D) Ineligible ITC — section 17(5)", "", None, _heads(gstr.get("itc_ineligible")))
    )
    table_4 = R.table(
        [("Details", "", ""), ("IGST", "num", "74px"), ("CGST", "num", "74px"),
         ("SGST", "num", "74px"), ("Cess", "num", "64px")],
        rows_4,
    )

    # ── 6.1 ──────────────────────────────────────────────────────────────────
    head_labels = {"igst": "IGST", "cgst": "CGST", "sgst": "SGST / UTGST", "cess": "Cess"}
    rows_61 = []
    for h in HEADS:
        s = c["set_off"][h]
        rows_61.append(
            f'<tr><td>{R.cell_desc(head_labels[h])}</td>'
            f'<td class="num">{R.num0(s["payable"])}</td>'
            f'<td class="num">{R.num0(s["via_itc"])}</td>'
            f'<td class="num">{R.num0(s["in_cash"])}</td>'
            f'<td class="num">{R.num0(c["interest"] if h == "igst" and c["interest"] else 0)}</td></tr>'
        )
    table_61 = R.table(
        [("Head", "", ""), ("Tax payable", "num", "86px"), ("Paid via ITC", "num", "86px"),
         ("Paid in cash", "num", "86px"), ("Interest", "num", "70px")],
        rows_61,
    )

    totals_html = R.totals(
        [
            ("Total tax payable", R.money0(c["total_payable"])),
            ("Utilised from credit ledger", f"&minus;{R.money0(c['total_itc'])}"),
            ("Interest and late fee", R.money0(c["interest"])),
        ],
        grand=("Payable in cash", R.money0(c["total_cash"])),
    )

    words = R.words_line(
        f"{R.esc(amount_in_words_inr(c['total_cash']))}, to be deposited by challan before filing."
    )

    # ── before you file ──────────────────────────────────────────────────────
    notes: list[str] = []
    for h in held:
        itc = h.get("itc")
        itc_txt = f" ITC of {R.money0(itc)} is not claimed in this working." if itc else ""
        notes.append(
            f"{R.esc(h.get('party') or 'An unnamed party')} is held back — "
            f"{R.esc(h.get('reason') or 'reason not recorded')}.{itc_txt}"
        )
    for n in gstr.get("notes") or []:
        notes.append(R.esc(n))
    notes.append(
        "Figures are a working, not a filed return. No ARN exists until submission "
        "on the GST portal."
    )
    before_you_file = R.block("Before you file", R.terms_list(notes), top="0")

    sign = R.sign_block(
        "Authorised signatory",
        org.get("authorized_signatory_name") or "",
        org.get("authorized_signatory_designation") or "",
    )

    page = "".join([
        head, meta, party_block,
        R.block("3.1 · Outward supplies and inward reverse-charge supplies", table_31),
        R.block("4 · Eligible input tax credit", table_4),
        R.block("6.1 · Payment of tax", table_61),
        totals_html, words,
        R.parties(before_you_file, sign, flush=True),
        R.gap_note(check),
        R.foot(
            f"Working paper generated from {R.deva_span('गणित', 'Ganit')} Ganit &middot; "
            "not a filed return &middot; retain with books under section 35"
        ),
    ])
    return R.document([page], org, title="GSTR-3B — Kartavaya")


def generate_gstr3b_pdf(gstr: dict, org: dict) -> bytes:
    """Render the GSTR-3B working paper to PDF bytes.

    Raises `services.doc_validation.DocumentIncomplete` before WeasyPrint is
    imported when a mandatory particular is missing or the arithmetic does not
    reconcile. Checked here rather than in the router, so every caller is
    covered — the same placement `generate_invoice_pdf` uses.
    """
    gstr, org = gstr or {}, org or {}
    check = validate_gstr3b(gstr, org, computed=compute(gstr))
    check.raise_if_incomplete()
    return R.render_pdf(_build_html(gstr, org, check))
