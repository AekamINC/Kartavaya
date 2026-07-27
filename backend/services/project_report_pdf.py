"""project_report_pdf.py — the project status report.

Specification: `design-reference/Kartavaya Redesign/docs/Project Report.html`.
Pipeline, fonts and refusal semantics as `invoice_pdf.py`.

The only document in the set with no statutory content. It still refuses on one
thing, in `validate_project_report`: a variance column that does not equal
actual less plan. A client acts on the variance, and cannot check it — a wrong
one misleads more efficiently than no report at all.

What the schema supplies, and what it does not
----------------------------------------------
Verified against the live catalog, not the migration ledger:

  derivable    `public.boards` (the project), `public.tasks` (open/closed work,
               due dates), `staging.time_entries.minutes` (hours consumed),
               `staging.ganit_invoices` (fee invoiced to date),
               `staging.ganit_contracts` (the linked agreement).

  NOT present  There is no `projects` table — `services/skills/data/
               kpi_aggregator.py` and `workload_calculator.py` both join
               `staging.projects`, which does not exist. There is no milestone
               store, no risk register, no plan/baseline for any measure, and no
               change-request record. The design's three central tables —
               "Position at a glance", "Milestones" and "Risks and what is being
               done" — have no backing columns.

Nothing is invented to cover that. A report built from tasks and time entries
alone renders with the measures it can compute; the milestone and risk tables
render an explicit empty state, the validator raises an advisory naming each,
and `backend/migrations/PROPOSED_documents.sql` §7 proposes the tables. A report that quietly
showed an empty risk table would read as "no risks".
"""

from __future__ import annotations

from datetime import date, datetime

from services import doc_render as R
from services.doc_validation import DocumentCheck, validate_project_report

#: Severity -> chip kind. The design's own mapping.
_SEVERITY_CHIP = {"high": "over", "med": "due", "medium": "due", "low": ""}

#: Milestone / measure state -> chip kind.
_STATE_CHIP = {
    "signed": "ok", "done": "ok", "complete": "ok", "on plan": "ok", "priced": "ok",
    "slipping": "due", "at risk": "due", "over": "due", "watch": "due",
    "blocked": "over", "late": "over",
    "not started": "",
}


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


def _state_chip(state: str) -> str:
    if not state:
        return ""
    return R.chip(state, _STATE_CHIP.get(str(state).strip().lower(), ""))


def _fmt_measure(value, numeric: bool) -> str:
    """A measure cell is a figure or a date, and the design prints both in the
    monospace numeric column. A figure groups 2,2,3; anything else is text."""
    if value in (None, ""):
        return "&mdash;"
    if numeric:
        return R.esc(R.group_indian(value, 0))
    return R.esc(value)


def _variance(m: dict) -> str:
    """The variance cell, signed. `+22` reads as over, `-3` as under, `0` as on
    plan — which is what the design prints and what a reader scans for."""
    if not m.get("numeric"):
        return R.esc(m.get("variance") or "—")
    v = _num(m.get("variance"))
    if v == 0:
        return "0"
    unit = R.esc(m.get("unit") or "")
    return f"{'+' if v > 0 else '−'}{R.group_indian(abs(v), 0)}{f' {unit}' if unit else ''}"


def _build_html(report: dict, org: dict, client: dict, check: DocumentCheck | None = None) -> str:
    report, org, client = report or {}, org or {}, client or {}
    check = check or DocumentCheck(document="project report")

    head = R.letterhead(
        org,
        kind_en="Project report",
        kind_hi="परियोजना रिपोर्ट",
        doc_no=R.esc(report.get("report_number") or ""),
        chip_html=_state_chip(report.get("overall_state") or ""),
    )

    period = (
        f"{_date_label(report.get('period_start'), '%-d %b')} – "
        f"{_date_label(report.get('period_end'))}"
    ) if report.get("period_start") else ""
    # `%-d` is not portable to every libc; fall back to the zero-padded form
    # rather than emitting a literal '%-d' into a client-facing document.
    if "%-d" in period:
        period = (
            f"{_date_label(report.get('period_start'), '%d %b')} – "
            f"{_date_label(report.get('period_end'))}"
        )

    meta = R.meta_strip([
        ("Project", R.esc(report.get("project_name")) or R.unset("Project")),
        ("Reporting period", R.esc(period) or R.unset("Reporting period")),
        ("Prepared by", R.esc(report.get("prepared_by") or "") or R.unset("Prepared by")),
        ("Board reference", R.esc(report.get("board_ref") or "—")),
    ], mono_labels=("Board reference",))

    party_block = R.parties(
        R.party(
            "Prepared for",
            name=R.esc(client.get("company") or client.get("name")) or (
                '<span class="lines__mute">Internal report</span>'
            ),
            addr_html=(
                f"Attn {R.esc(client['name'])}"
                + (f", {R.esc(client['designation'])}" if client.get("designation") else "")
                if client.get("name") and client.get("company") else ""
            ),
            id_html=R.esc(report.get("agreement_ref") or ""),
        ),
        R.party(
            "Headline",
            body_html=R.esc(report.get("headline") or "") or (
                '<span class="lines__mute">No headline recorded.</span>'
            ),
        ),
    )

    # ── position at a glance ─────────────────────────────────────────────────
    measures = report.get("measures") or []
    rows = []
    for m in measures:
        numeric = bool(m.get("numeric"))
        rows.append(
            f'<tr><td>{R.cell_desc(m.get("label") or "", m.get("sub") or "")}</td>'
            f'<td class="num">{_fmt_measure(m.get("plan"), numeric)}</td>'
            f'<td class="num">{_fmt_measure(m.get("actual"), numeric)}</td>'
            f'<td class="num">{_variance(m)}</td>'
            f'<td>{_state_chip(m.get("state") or "")}</td></tr>'
        )
    if not rows:
        rows.append(
            '<tr><td colspan="5" class="lines__mute">'
            "No measures are recorded for this period.</td></tr>"
        )
    measures_table = R.table(
        [("Measure", "", ""), ("Plan", "num", "96px"), ("Actual", "num", "96px"),
         ("Variance", "num", "96px"), ("Status", "", "78px")],
        rows,
    )

    # ── milestones ───────────────────────────────────────────────────────────
    milestones = report.get("milestones") or []
    mrows = []
    for i, m in enumerate(milestones, 1):
        mrows.append(
            f'<tr><td class="num num--left">{i}</td>'
            f'<td>{R.cell_desc(m.get("title") or "", m.get("note") or "")}</td>'
            f'<td>{R.esc(_date_label(m.get("target"), "%d %b"))}</td>'
            f'<td>{R.esc(_date_label(m.get("forecast"), "%d %b"))}</td>'
            f'<td>{_state_chip(m.get("state") or "")}</td></tr>'
        )
    if not mrows:
        # Explicit, not blank. See the module docstring: an empty milestone table
        # reads as "no milestones", which is a different claim from "none are
        # recorded anywhere".
        mrows.append(
            '<tr><td colspan="5" class="lines__mute">'
            "No milestone schedule is recorded. Kartavaya has no milestone store today; "
            "nothing has been inferred from task due dates.</td></tr>"
        )
    milestones_table = R.table(
        [("#", "", "26px"), ("Milestone", "", ""), ("Target", "", "78px"),
         ("Forecast", "", "78px"), ("State", "", "84px")],
        mrows,
    )
    milestone_note = (
        f'<p class="terms" style="margin-top:7px">{R.esc(report["milestone_note"])}</p>'
        if report.get("milestone_note") else ""
    )

    # ── risks ────────────────────────────────────────────────────────────────
    risks = report.get("risks") or []
    rrows = []
    for r in risks:
        sev = str(r.get("severity") or "").strip()
        rrows.append(
            f"<tr><td>{R.chip(sev, _SEVERITY_CHIP.get(sev.lower(), '')) if sev else ''}</td>"
            f'<td>{R.cell_desc(r.get("risk") or "", r.get("detail") or "")}</td>'
            f'<td class="lines__sub" style="color:{R.INK2}">{R.esc(r.get("mitigation") or "")}</td>'
            f'<td>{R.esc(r.get("owner") or "")}</td></tr>'
        )
    if not rrows:
        rrows.append(
            '<tr><td colspan="4" class="lines__mute">'
            "No risk register is recorded. Read this as 'none captured', not 'none exist'."
            "</td></tr>"
        )
    risks_table = R.table(
        [("Sev", "", "56px"), ("Risk", "", ""), ("Mitigation", "", ""), ("Owner", "", "88px")],
        rrows,
    )

    # ── decisions ────────────────────────────────────────────────────────────
    decisions = report.get("decisions") or []
    decisions_html = R.terms_list([
        (f"<b>By {R.esc(_date_label(d['by'], '%d %b'))} —</b> " if d.get("by")
         else "<b>No action —</b> ") + R.esc(d.get("text") or "")
        for d in decisions
    ]) if decisions else (
        '<div class="terms lines__mute">No decisions are outstanding from the client.</div>'
    )

    sign = R.sign_block(
        "Prepared by",
        report.get("prepared_by") or "",
        _date_label(report.get("prepared_on")) if report.get("prepared_on") else "",
    )

    as_at = report.get("as_at") or report.get("period_end")
    page = "".join([
        head, meta, party_block,
        R.block("Position at a glance", measures_table),
        R.block("Milestones", milestones_table + milestone_note),
        R.block("Risks and what is being done", risks_table),
        R.parties(R.block("Decisions needed from the Client", decisions_html, top="0"),
                  sign, flush=True),
        R.gap_note(check),
        R.foot(
            f"Generated from {R.deva_span('कर्तव्य', 'Kartavya')} Kartavya"
            + (f" &middot; figures are live at {R.esc(_date_label(as_at))}" if as_at else "")
        ),
    ])
    return R.document([page], org, title="Project Report — Kartavaya")


def generate_project_report_pdf(report: dict, org: dict, client: dict = None) -> bytes:
    """Render a project status report to PDF bytes.

    Raises `DocumentIncomplete` when the project or period is unnamed, or when a
    numeric measure's variance does not equal actual less plan.
    """
    report, org, client = report or {}, org or {}, client or {}
    check = validate_project_report(report, org, client)
    check.raise_if_incomplete()
    return R.render_pdf(_build_html(report, org, client, check))
