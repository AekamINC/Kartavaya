"""statement_pdf.py — the statement of account.

Specification: `design-reference/Kartavaya Redesign/docs/Statement of Account.html`.
Pipeline, fonts and refusal semantics as `invoice_pdf.py`.

Not a statutory document — no rule prescribes its form. It is nevertheless the
document a client disputes a balance against, so `validate_statement` blocks on
the two things a reader checks: the running balance must tie (opening + debits −
credits = closing) and the ageing buckets must sum to the amount outstanding.

The MSME notice
---------------
The specification prints a notice under **section 43B(h) of the Income-tax Act
1961**, inserted by the Finance Act 2023 with effect from AY 2024-25: a buyer's
deduction for a payment to a registered micro or small enterprise is allowed
only in the year of actual payment unless it is paid within the time limit in
section 15 of the MSMED Act 2006 — 45 days where there is a written agreement,
15 days where there is not.

Two consequences for this renderer, both deliberate:

1. The notice renders only when the issuer is **recorded** as a registered micro
   or small enterprise. It is a statement about the issuer's own registration,
   and asserting it on a document that goes to a buyer's tax file when it is not
   true would be a misrepresentation. `staging.organisations` has no MSME
   registration column, so the caller supplies it and nothing is assumed.
2. The threshold is 45 or 15 days depending on whether a written agreement
   exists, and the schema records neither the registration nor the agreement.
   The default is the 45-day limit — the figure the specification prints — and
   `msme_threshold_days` overrides it.

`19-msme.md` does not exist; the section is quoted from the Act, and the build
report says so.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from services import doc_render as R
from services.doc_validation import DocumentCheck, validate_statement

#: The ageing buckets the specification prints, in its order. `None` is the
#: open-ended final bucket.
AGEING_BUCKETS = (
    ("current", "Current", None, 0),
    ("d1_30", "1–30 days", 1, 30),
    ("d31_60", "31–60", 31, 60),
    ("d61_90", "61–90", 61, 90),
    ("d90_plus", "90+", 91, None),
)

#: MSMED Act 2006 section 15 — the outer limit where a written agreement exists.
MSME_DEFAULT_DAYS = 45


def _date_label(value, fmt: str = "%d %b %Y") -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime(fmt)
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").strftime(fmt)
    except (ValueError, TypeError):
        return str(value or "")


def _as_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def age_receivables(open_items: list[dict], as_at) -> dict[str, float]:
    """Bucket outstanding amounts by days past due.

    Ages from the DUE date, not the invoice date. An invoice on 30-day terms
    issued 40 days ago is 10 days overdue, not 40, and an ageing that says
    otherwise turns every current account into an overdue one.
    """
    as_at = _as_date(as_at) or date.today()
    buckets = {key: 0.0 for key, _, _, _ in AGEING_BUCKETS}
    for item in open_items or []:
        outstanding = _num(item.get("balance_due"))
        if outstanding <= 0:
            continue
        due = _as_date(item.get("due_date")) or _as_date(item.get("date"))
        days_overdue = (as_at - due).days if due else 0
        if days_overdue <= 0:
            buckets["current"] += outstanding
            continue
        for key, _label, lo, hi in AGEING_BUCKETS:
            if lo is None:
                continue
            if days_overdue >= lo and (hi is None or days_overdue <= hi):
                buckets[key] += outstanding
                break
    return buckets


def compute(statement: dict) -> dict:
    """Running balance down the ledger, plus the totals row.

    The balance is recomputed here rather than trusted from the caller, so the
    Balance column and the closing figure in the meta strip can never disagree.
    """
    statement = statement or {}
    running = _num(statement.get("opening_balance"))
    rows: list[dict] = []
    total_debit = total_credit = 0.0
    for entry in statement.get("entries") or []:
        debit, credit = _num(entry.get("debit")), _num(entry.get("credit"))
        running += debit - credit
        total_debit += debit
        total_credit += credit
        rows.append({**entry, "balance": running})
    return {
        "rows": rows,
        "opening": _num(statement.get("opening_balance")),
        "total_debit": total_debit,
        "total_credit": total_credit,
        "closing": running,
    }


def _build_html(statement: dict, org: dict, contact: dict, check: DocumentCheck | None = None) -> str:
    statement, org, contact = statement or {}, org or {}, contact or {}
    check = check or DocumentCheck(document="statement of account")
    c = compute(statement)

    currency = statement.get("currency") or "INR"
    symbol = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(currency, currency + " ")

    ageing = statement.get("ageing") or {}
    overdue = sum(_num(v) for k, v in ageing.items() if k != "current")

    account_name = contact.get("company") or contact.get("name") or ""

    head = R.letterhead(
        org,
        kind_en="Statement of Account",
        kind_hi="लेखा विवरण",
        doc_no=R.esc(statement.get("statement_number") or ""),
        chip_html=(
            R.chip(f"{R.money(overdue, symbol)} overdue".replace("&", "&amp;"), "over")
            if overdue > 0 else R.chip("Nothing overdue", "ok")
        ),
    )

    period = (
        f"{_date_label(statement.get('period_start'), '%d %b')} – "
        f"{_date_label(statement.get('period_end'))}"
    ) if statement.get("period_start") else ""

    closing_html = (
        f'<span style="color:{R.accent(org)[0]};font-weight:700">'
        f"{R.money(c['closing'], symbol)}</span>"
    )
    meta = R.meta_strip([
        ("Period", R.esc(period) or R.unset("Statement period")),
        ("Account", R.esc(account_name) or R.unset("Account holder")),
        ("Currency", f"{R.esc(currency)} ({symbol})"),
        ("Closing balance", closing_html),
    ])

    # ── the ledger ───────────────────────────────────────────────────────────
    rows = [
        f'<tr><td>{R.esc(_date_label(statement.get("period_start"), "%d %b"))}</td>'
        f'<td class="num num--left">&mdash;</td><td>Opening balance</td>'
        f'<td class="num">&mdash;</td><td class="num">&mdash;</td>'
        f'<td class="num">{R.esc(R.group_indian(c["opening"], 0))}</td></tr>'
    ]
    for r in c["rows"]:
        rows.append(
            f'<tr><td>{R.esc(_date_label(r.get("date"), "%d %b"))}</td>'
            f'<td class="num num--left">{R.esc(r.get("document") or "—")}</td>'
            f'<td>{R.esc(r.get("particulars") or "")}</td>'
            f'<td class="num">{R.num0(r.get("debit"))}</td>'
            f'<td class="num">{R.num0(r.get("credit"))}</td>'
            f'<td class="num">{R.esc(R.group_indian(r["balance"], 0))}</td></tr>'
        )
    rows.append(
        '<tr class="lines__foot"><td colspan="3">Closing balance</td>'
        f'<td class="num">{R.esc(R.group_indian(c["total_debit"], 0))}</td>'
        f'<td class="num">{R.esc(R.group_indian(c["total_credit"], 0))}</td>'
        f'<td class="num">{R.esc(R.group_indian(c["closing"], 0))}</td></tr>'
    )
    ledger = R.table(
        [("Date", "", "62px"), ("Document", "", "78px"), ("Particulars", "", ""),
         ("Debit", "num", "82px"), ("Credit", "num", "82px"), ("Balance", "num", "88px")],
        rows,
    )

    # ── ageing ───────────────────────────────────────────────────────────────
    tiles = []
    for key, label, _lo, _hi in AGEING_BUCKETS:
        value = _num(ageing.get(key))
        overdue_tile = key != "current" and value > 0
        style = ' style="background:#FBE6C8"' if overdue_tile else ""
        lstyle = ' style="color:#8A5300"' if overdue_tile else ""
        vclass = "tile__v" if value else "tile__v lines__mute"
        tiles.append(
            f'<div class="tile"{style}><div class="tile__l"{lstyle}>{R.esc(label)}</div>'
            f'<div class="{vclass}"{lstyle}>{R.num0(value)}</div></div>'
        )
    ageing_block = R.block("Ageing", f'<div class="row">{"".join(tiles)}</div>')

    # ── MSME notice + UPI ────────────────────────────────────────────────────
    left_parts = []
    if statement.get("msme_registered"):
        days = int(statement.get("msme_threshold_days") or MSME_DEFAULT_DAYS)
        breach = ""
        oldest = statement.get("msme_reference")
        if oldest and oldest.get("document") and oldest.get("accepted_on"):
            accepted = _as_date(oldest["accepted_on"])
            if accepted:
                breach = (
                    f" {R.esc(oldest['document'])} crosses that threshold on "
                    f"<b>{R.esc(_date_label(accepted + timedelta(days=days)))}</b>."
                )
        left_parts.append(
            '<div class="block__l">MSME notice</div>'
            f'<div class="terms">{R.esc(org.get("name") or "The issuer")} is a registered '
            "micro or small enterprise. Under section 43B(h) of the Income-tax Act 1961, "
            f"payment beyond {days} days from acceptance may be disallowed as a deduction "
            f"to the buyer.{breach}</div>"
        )
    bank = org.get("bank_details") or {}
    upi = bank.get("upi_id") if isinstance(bank, dict) else ""
    if upi:
        left_parts.append(
            '<div class="block__l" style="margin-top:11px">Pay by UPI</div>'
            '<div style="font-size:8pt">Scan the code, or transfer to '
            f'<span style="font-family:{R.FONT_MONO}">{R.esc(upi)}</span></div>'
        )

    # The specification draws a QR placeholder rather than a real code: nothing
    # in the schema produces a signed UPI intent string, and a QR that resolves
    # to the wrong VPA moves a client's money to the wrong account.
    qr = (
        '<div style="text-align:center;flex:0 0 auto">'
        f'<div style="width:74px;height:74px;border:1px solid {R.RULE};border-radius:6px;'
        f'text-align:center;line-height:74px;font-size:26px;color:{R.accent(org)[0]}">₹</div>'
        f'<div style="font-size:6.5pt;color:{R.INK3};margin-top:3px">UPI QR</div></div>'
    ) if upi else ""

    pay_block = (
        f'<div style="display:flex;gap:24px;margin-top:16px;padding-top:14px;'
        f'border-top:1px solid {R.RULE_SOFT};align-items:flex-start">'
        f'<div class="block" style="flex:1 1 auto">{"".join(left_parts)}</div>{qr}</div>'
    ) if left_parts else ""

    page = "".join([
        head, meta, ledger, ageing_block, pay_block,
        R.gap_note(check),
        R.foot(
            "Statement issued without prejudice. Please report discrepancies within "
            "7 days of receipt."
        ),
    ])
    return R.document(
        [page], org, title="Statement of Account — Kartavaya",
        running=R.running_id("Statement of Account", org, statement.get("statement_number") or ""),
    )


def generate_statement_pdf(statement: dict, org: dict, contact: dict = None) -> bytes:
    """Render a statement of account to PDF bytes.

    Raises `DocumentIncomplete` when the ledger does not tie or the ageing does
    not sum to the outstanding balance.
    """
    statement, org, contact = statement or {}, org or {}, contact or {}
    computed = compute(statement)
    # The closing balance the validator checks is the one that will be PRINTED,
    # not whatever the caller passed — otherwise a caller could satisfy the
    # reconciliation with a figure the document never shows.
    statement = {**statement, "closing_balance": computed["closing"]}
    check = validate_statement(statement, org, contact)
    check.raise_if_incomplete()
    return R.render_pdf(_build_html(statement, org, contact, check))
