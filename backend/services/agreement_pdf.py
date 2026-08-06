"""agreement_pdf.py — the service agreement.

Specification: `design-reference/Kartavaya Redesign/docs/Service Agreement.html`.
Pipeline, fonts and refusal semantics as `invoice_pdf.py`.

Two pages, explicitly paginated
-------------------------------
This is the only document in the set the design paginates itself: two
`<section class="page">` children, clause 1–4 and the milestone table on page 1,
clauses 5–10 and the execution block on page 2, with the page number in each
footer. `doc-page.js` is explicit that a pre-paginated document is a fixed set
of pages and that "content that misses the box is CLIPPED", so the split is
honoured here rather than left to the print engine to find.

The clause text
---------------
The specification's own words, verbatim, with the party names, dates, fee and
milestone figures substituted. Nothing is paraphrased and no clause is added:
the design labels this "Placeholder execution copy — legal review pending before
signature", and a generator that improvised contract language would be drafting.
Where a clause needs a value the schema does not carry — the governing seat, the
notice periods, the liability cap basis — the caller supplies it and the
validator marks the gap rather than the renderer choosing a default that ends up
in a signed agreement.

The one exception is the clause skeleton itself: clause numbers, headings and
the standard sentences are the design's fixed text and are constants here, so a
change to them is a diff against the approved specification rather than a silent
drift in generated contracts.
"""

from __future__ import annotations

from datetime import date, datetime

from services import doc_render as R
from services.doc_validation import DocumentCheck, validate_service_agreement
from services.invoice_pdf import amount_in_words_inr


def _date_label(value, fmt: str = "%d %b %Y") -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime(fmt)
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").strftime(fmt)
    except (ValueError, TypeError):
        return str(value or "")


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _clauses(agreement: dict, org: dict, contact: dict) -> dict[str, list[str]]:
    """The specification's clause text, with this agreement's values in it."""
    a = agreement
    provider = R.esc(org.get("name") or "the Provider")
    fee = R.money0(_num(a.get("fee")))
    gst_rate = a.get("gst_rate", 18)
    pos = R.esc(a.get("place_of_supply") or "")
    tax_heads = "IGST applies" if a.get("is_igst") else "CGST and SGST apply"
    payment_days = int(a.get("payment_days") or 30)
    tds_section = R.esc(a.get("tds_section") or "")
    tds_rate = a.get("tds_rate")

    fees: list[str] = [
        f"Total professional fee of <b>{fee}</b> exclusive of GST, invoiced against "
        "milestone completion per clause 3.",
        f"GST at {R.esc(gst_rate)}% is charged in addition."
        + (f" Place of supply is {pos}; {tax_heads}." if pos else f" {tax_heads}."),
        f"Invoices are payable within <b>{payment_days} days</b>.",
    ]
    if a.get("provider_is_msme"):
        # Section 15 of the MSMED Act 2006 and the interest rate in section 16 —
        # three times the RBI bank rate, compounded monthly. Stated only when the
        # provider is recorded as an MSME, because it is a claim about the
        # provider's own registration. See `statement_pdf` for the same rule.
        fees[-1] = (
            f"Invoices are payable within <b>{payment_days} days</b>. The Provider is "
            "a registered micro or small enterprise; section 15 of the MSMED Act 2006 "
            "applies and interest under section 16 accrues at three times the RBI bank "
            "rate on amounts outstanding beyond 45 days."
        )
    if tds_section:
        rate_txt = f" at {tds_rate}%" if tds_rate else ""
        fees.append(
            f"TDS under section {tds_section} is to be deducted{rate_txt} and the "
            "certificate issued within the statutory period."
        )

    return {
        "scope": [R.esc(s) for s in (a.get("scope") or [])],
        "fees": fees,
        "client_obligations": [R.esc(s) for s in (a.get("client_obligations") or [
            "Site access during agreed working hours, and third-party approvals "
            "obtained by the Client.",
            "A single named approver empowered to sign off milestones.",
            "Timely provision of existing documents, layouts and statutory permissions.",
        ])],
        "confidentiality": [
            "Each party keeps the other's non-public information confidential for the "
            f"term and for {R.esc(a.get('confidentiality_years') or 3)} years afterwards.",
            "The obligation does not extend to information that is public, "
            "independently developed, or required to be disclosed by law or a regulator.",
            f"{provider} may name the Client as a reference only with prior written consent.",
        ],
        "ip": [
            "Deliverables prepared for this engagement vest in the Client on full "
            "payment of the fee for the relevant milestone.",
            f"{provider} retains ownership of its templates, methods and pre-existing "
            "materials, and grants the Client a perpetual licence to use them as "
            "embodied in the deliverables.",
        ],
        "liability": [
            f"{provider}'s aggregate liability is capped at the total fees paid under "
            "this agreement in the twelve months preceding the claim.",
            "Neither party is liable for indirect or consequential loss, including loss "
            "of profit or business interruption.",
            "The cap does not apply to fraud, wilful misconduct, death or personal "
            "injury, or breach of confidentiality.",
        ],
        "change": [
            "Any variation to scope, milestone dates or fees is effective only when "
            "recorded in writing and countersigned by both named approvers.",
            "A change request states its own fee and date impact. Work does not begin "
            "on a change until it is countersigned.",
        ],
        "term": [
            f"Initial term of {R.esc(a.get('term_months') or 12)} months from the "
            "effective date, extending only by written agreement.",
            f"Either party may terminate for convenience on "
            f"{int(a.get('notice_days') or 30)} days' written notice. Work completed to "
            "the termination date is invoiceable pro rata.",
            f"Either party may terminate immediately for material breach not cured "
            f"within {int(a.get('cure_days') or 15)} days of written notice.",
        ],
    }


def _dispute_clause(agreement: dict) -> list[str]:
    """Clause 10. The seat is never defaulted — an arbitration clause with a
    guessed seat is a clause that sends a dispute to the wrong forum."""
    seat = R.esc(agreement.get("governing_seat") or "")
    if not seat:
        return [
            "The parties will attempt good-faith resolution between the named "
            "approvers within 15 days of a dispute arising.",
            # No seat on file: the clause stops at what IS agreed. It does not
            # name a forum, which is the thing that must never be guessed — a
            # guessed seat sends a dispute to the wrong court.
            #
            # It also carries no marker. Owner's ruling 2026-08-03 that every
            # generated document reads clean, and unlike a meta cell this is
            # running prose, where an em-dash or a red flag would land mid
            # sentence. The gap is reported by `validate_service_agreement`
            # instead, which is where the firm can act on it.
            "Failing that, disputes are referred to arbitration by a sole arbitrator "
            "under the Arbitration and Conciliation Act 1996.",
        ]
    return [
        "The parties will attempt good-faith resolution between the named approvers "
        "within 15 days of a dispute arising.",
        "Failing that, disputes are referred to arbitration by a sole arbitrator under "
        f"the Arbitration and Conciliation Act 1996. Seat and venue: {seat}. "
        f"Language: {R.esc(agreement.get('language') or 'English')}.",
        f"Courts at {seat} have exclusive jurisdiction for interim relief.",
    ]


def _build_html(agreement: dict, org: dict, contact: dict, check: DocumentCheck | None = None) -> str:
    agreement, org, contact = agreement or {}, org or {}, contact or {}
    check = check or DocumentCheck(document="service agreement")
    cl = _clauses(agreement, org, contact)

    number = R.esc(agreement.get("agreement_number") or "")
    effective = agreement.get("effective_date")

    head = R.letterhead(
        org, kind_en="Service agreement", kind_hi="सेवा अनुबंध", doc_no=number,
    )

    meta = R.meta_strip([
        ("Effective date",
         R.esc(_date_label(effective)) if effective else R.unset("Effective date")),
        ("Initial term", R.esc(f"{agreement.get('term_months') or 12} months")),
        ("Governing law",
         R.esc(agreement.get("governing_law") or "") or R.unset("Governing law")),
        ("Linked project", R.esc(agreement.get("project_ref") or "—")),
    ], mono_labels=("Linked project",))

    party_block = R.parties(
        R.party(
            "Service provider",
            name=R.esc(org.get("name")) if org.get("name") else R.unset("Organisation name"),
            addr_html=R.fmt_addr(org.get("billing_address") or {}) or R.unset("Billing address"),
            id_html=" &middot; ".join([
                f'GSTIN <span>{R.esc(org["gstin"])}</span>' if org.get("gstin") else f"GSTIN {R.unset('GSTIN')}",
                f'PAN <span>{R.esc(org["pan"])}</span>' if org.get("pan") else f"PAN {R.unset('PAN')}",
            ]),
        ),
        R.party(
            "Client",
            name=R.esc(contact.get("company") or contact.get("name")) or R.unset("Client"),
            addr_html=R.fmt_addr(contact.get("billing_address") or {}),
            id_html=" &middot; ".join(filter(None, [
                f"GSTIN {R.esc(contact['gstin'])}" if contact.get("gstin") else "",
                f"Attn {R.esc(contact['name'])}"
                + (f", {R.esc(contact['designation'])}" if contact.get("designation") else "")
                if contact.get("name") and contact.get("company") else "",
            ])),
        ),
    )

    preamble = (
        '<div class="block" style="margin-top:15px"><p class="terms" style="font-size:8.5pt">'
        "This agreement is made on "
        + (f"<b>{R.esc(_date_label(effective, '%d %B %Y'))}</b>" if effective else R.unset("Effective date"))
        + " between the parties named above."
        # No default status note, and this is the one place the design file is
        # deliberately NOT followed. `Service Agreement.html` labels ITSELF
        # "Placeholder execution copy — legal review pending before signature",
        # which is true of a mockup and false of the document this generator
        # produces. It was adopted as the fallback for `status_note`, and
        # `POST /contracts/{id}/agreement/pdf` defaults that field to `""` — so
        # the fallback was not an edge case, it was the behaviour every caller
        # got unless it knew about an undocumented parameter. A firm sending a
        # client its service agreement was sending one that said on its face it
        # was not the real one.
        #
        # A caller that HAS something to say still says it; the field is
        # untouched. Silence now prints nothing, which is what a signable
        # agreement looks like.
        + (f" {R.esc(agreement['status_note'])}" if agreement.get("status_note") else "")
        + "</p></div>"
    )

    # ── clause 3, the milestone table ────────────────────────────────────────
    milestones = agreement.get("milestones") or []
    rows = []
    for i, m in enumerate(milestones, 1):
        rows.append(
            f'<tr><td class="num num--left">{i}</td>'
            f'<td>{R.cell_desc(m.get("title") or "", m.get("note") or "")}</td>'
            f'<td>{R.esc(_date_label(m.get("target")))}</td>'
            f'<td class="num">{R.esc(m.get("share_pct"))}%</td>'
            f'<td class="num">{R.esc(R.group_indian(m.get("fee"), 0))}</td></tr>'
        )
    if not rows:
        rows.append(
            '<tr><td colspan="5" class="lines__mute">'
            "No milestone schedule is recorded for this agreement.</td></tr>"
        )
    milestone_table = R.table(
        [("#", "", "26px"), ("Milestone", "", ""), ("Target", "", "88px"),
         ("Share", "num", "52px"), ("Fee", "num", "96px")],
        rows,
    )
    trigger = (
        '<p class="terms" style="margin-top:7px"><b>Invoicing trigger.</b> A milestone '
        "is invoiceable on <b>completion of the works</b>, not on Client sign-off. "
        f"Sign-off that is not withheld in writing within "
        f"{int(agreement.get('deemed_signoff_days') or 7)} working days is deemed given.</p>"
    )

    fee_words = ""
    if _num(agreement.get("fee")) > 0:
        fee_words = R.words_line(
            f"Professional fee in words — <b>{R.esc(amount_in_words_inr(_num(agreement['fee'])))}</b>, "
            "exclusive of GST."
        )

    page1 = "".join([
        head, meta, party_block, preamble,
        R.block("1 · Scope of services",
                R.terms_list(cl["scope"]) if cl["scope"] else
                f'<div class="terms">{R.unset("Scope of services")}</div>', top="12px"),
        R.block("2 · Fees and taxes", R.terms_list(cl["fees"]), top="12px"),
        R.block("3 · Milestones and payment schedule", milestone_table + trigger, top="12px"),
        fee_words,
        R.block("4 · Client obligations", R.terms_list(cl["client_obligations"]), top="12px"),
        # The colophon no longer counts the pages. It used to say "Page 1 of 2",
        # which was true only while the agreement fitted its two AUTHORED pages:
        # sixteen milestones spill clause 4 onto a third sheet and the assertion
        # printed on the paper becomes false. `doc_render` now prints
        # `Page N of M` from the real page counters in the reserved tail strip,
        # so the count is taken from the rendered document instead of predicted.
        R.foot(f"{number} &middot; execution copy"),
    ])

    page2 = "".join([
        R.block("5 · Confidentiality", R.terms_list(cl["confidentiality"]), top="0"),
        R.block("6 · Intellectual property", R.terms_list(cl["ip"]), top="12px"),
        R.block("7 · Liability", R.terms_list(cl["liability"]), top="12px"),
        R.block("8 · Change requests", R.terms_list(cl["change"]), top="12px"),
        R.block("9 · Term and termination", R.terms_list(cl["term"]), top="12px"),
        R.block("10 · Dispute resolution", R.terms_list(_dispute_clause(agreement)), top="12px"),
        R.block(
            "Execution",
            '<p class="terms" style="margin:0 0 6px">Signed by the duly authorised '
            "representatives of each party on the dates written below.</p>"
            + R.parties(
                R.sign_block(
                    f"For {R.esc(org.get('name') or 'the Provider')}",
                    org.get("authorized_signatory_name") or "",
                    (org.get("authorized_signatory_designation") or "") + " · Date"
                    if org.get("authorized_signatory_designation") else "Date",
                    align="left",
                ),
                R.sign_block(
                    f"For {R.esc(contact.get('company') or contact.get('name') or 'the Client')}",
                    contact.get("name") or "",
                    (contact.get("designation") or "") + " · Date"
                    if contact.get("designation") else "Date",
                    align="left",
                ),
                flush=True,
            ),
            top="16px",
        ),
        R.gap_note(check),
        R.foot(
            f"{number} &middot; e-signature via "
            f"{R.deva_span('हस्ताक्षर', 'eSign')} eSign &middot; audit trail retained"
        ),
    ])

    return R.document(
        [page1, page2], org, title="Service Agreement — Kartavaya",
        running=R.running_id("Service agreement", org, agreement.get("agreement_number") or ""),
    )


def generate_agreement_pdf(agreement: dict, org: dict, contact: dict = None) -> bytes:
    """Render a two-page service agreement to PDF bytes.

    Raises `DocumentIncomplete` when the document is not a contract — an
    unidentified party, no effective date, no scope, no fee, or a milestone
    schedule that does not apportion the whole fee.
    """
    agreement, org, contact = agreement or {}, org or {}, contact or {}
    check = validate_service_agreement(agreement, org, contact)
    check.raise_if_incomplete()
    return R.render_pdf(_build_html(agreement, org, contact, check))
