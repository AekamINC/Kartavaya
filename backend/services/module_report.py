"""One module page as data — the resolution and rendering the module report
(routers/analytics.module_report) and Niyam's report.send verb SHARE.

Extracted from the router the day both callers existed (proposal 65 S2 → S4):
the action must not import a router (services/gst_period.py's dependency
rule), and duplicating the resolution would let the emailed report disagree
with the downloaded one — the exact drift A6 exists to prevent.

The one seam the two callers differ on is the GATE for foreign-module
widgets a saved view may carry. The router passes a closure over
require_module(request, org_id); the engine has no request, passes None, and
every foreign widget is WITHHELD — fail-closed, stated in words.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from datetime import date, timedelta

from analytics.presets import PRESETS
from analytics.registry import REGISTRY, MetricRequest
from services.analytics_window import MAX_SPAN_DAYS, Window

#: The derived default stops at nine widgets — AnalyticsTab.jsx's autoLayout
#: cap, mirrored: nine widgets is a page a person reads; past it is a dump.
DERIVED_WIDGET_CAP = 9

#: Human names for the identity line and the letterhead — a module code means
#: nothing on a page the firm hands to anyone. The same names
#: services/skills/context.MODULE_LABELS carries (not imported: that module
#: is the skills runtime), plus `core`, which a grant map has no reason to
#: hold.
MODULE_TITLES: dict[str, str] = {
    "core": "Projects & tasks",
    "ganit": "Finance", "graha": "CRM", "vikray": "Sales", "manav": "HR",
    "vetana": "Payroll", "pahchan": "Attendance", "prachar": "Marketing",
    "sahayak": "Sahayak", "dristi": "Analytics", "sanvaad": "Messages",
    "varta": "WhatsApp", "esign": "E-Sign",
}

#: `dristi_scheduled_reports.report_type` (027's CHECK) → the module whose
#: arrangement a scheduled delivery renders. ONE map for BOTH delivery doors —
#: Niyam's `report.send` verb and dristi's person-pressed run-now — because
#: two copies is how "revenue" comes to mean Finance on one path and something
#: else on the other. 'custom' is deliberately absent: it is the
#: dashboard-backed kind, and it has no module arrangement to render.
REPORT_TYPE_MODULES: dict[str, str] = {
    "overview": "core", "revenue": "ganit", "pipeline": "graha",
    "hr": "manav", "sales": "vikray",
}

#: Which module(s) each report type READS — and therefore whose entitlement a
#: delivery must hold. One copy for all three doors (run-now, the dristi
#: sweep, Niyam's report.send): routers/dristi.py aliases this map, because
#: two copies is how "hr" comes to need manav on one path and nothing on
#: another — the exact bypass this map was first written to close ("exporting
#: 'hr' returned the employee register behind dristi alone"). ALL named
#: modules are required: a partial export of the books is still an export of
#: the books.
REPORT_SOURCE_MODULES: dict[str, set] = {
    "overview": {"graha", "ganit"},   # task counts, contact count, paid revenue
    "revenue": {"ganit"},
    "pipeline": {"graha"},
    "hr": {"manav"},
    "sales": {"vikray"},
}


async def schedule_blocked_reason(pool, schedule) -> str:
    """Why this schedule must NOT be delivered right now, or '' if it may be.

    The check every door owes before rendering: the schedule OWNER
    (`created_by`) must still reach every module the report type reads,
    re-evaluated at delivery time rather than trusted from creation — an
    employee who moves off the finance team must stop receiving the books,
    and the schedule they left behind is exactly how they otherwise would
    not. `held_level` is the Tier-4 resolver and honours subscription state,
    so an org whose module lapsed stops mailing that module's data too.
    """
    from middleware.module_levels import held_level
    from services.report_schedule_window import blocked_reason

    required = REPORT_SOURCE_MODULES.get(schedule["report_type"], set())
    created_by = schedule.get("created_by") if hasattr(schedule, "get") \
        else schedule["created_by"]
    reachable = set()
    if created_by and required:
        for code in required:
            if await held_level(pool, created_by, str(schedule["org_id"]), code) is not None:
                reachable.add(code)
    return blocked_reason(schedule["report_type"], created_by,
                          required, reachable) or ""


#: The window of a schedule's FIRST send, per frequency. Thereafter the window
#: runs from `last_sent_at` to today — "what happened since the last one",
#: the only honest reading of a recurring report.
FIRST_SPAN_DAYS: dict[str, int] = {"daily": 1, "weekly": 7, "monthly": 30}


def schedule_window(frequency: str, last_sent_at) -> Window:
    """The [start, today] range a scheduled send reports over."""
    end = date.today()
    if last_sent_at is not None:
        start = last_sent_at.date() if hasattr(last_sent_at, "date") else last_sent_at
    else:
        start = end - timedelta(days=FIRST_SPAN_DAYS.get(frequency, 7))
    if start > end:
        start = end
    if (end - start).days + 1 > MAX_SPAN_DAYS:
        # A schedule resumed after years must not build a five-year query.
        start = end - timedelta(days=MAX_SPAN_DAYS - 1)
    return Window(start, end)


async def member_recipients(pool, org_id: str, addresses) -> tuple[list, int]:
    """(member addresses, skipped count) — the schedule's recipient list cut
    to the FIRM'S STAFF in this org. Recipients are free text; the delivery
    contract (both doors) is that nothing leaves the firm, so an address is
    mailable exactly when it belongs to staff. `REPORT_RECIPIENT_ROLES`, not
    the tenant set: the tenant set includes `org_client` (the customer's
    person on a portal) and `aekam_team` — roles the module map refuses
    EVERYTHING, and a Finance report mailed to a portal client is the module
    map bypassed by typing an address into a form. The skipped count is
    returned so the caller can SAY it — a recipient silently dropped reads
    as a send that failed."""
    from middleware.role_tiers import REPORT_RECIPIENT_ROLES

    wanted = []
    for a in (addresses or []):
        a = (a or "").strip().lower()
        if a and "@" in a and a not in wanted:
            wanted.append(a)
    if not wanted:
        return [], 0
    rows = await pool.fetch(
        "SELECT DISTINCT LOWER(u.email) AS email "
        "  FROM public.users u "
        "  JOIN staging.user_roles ur "
        "    ON ur.user_id = u.user_id AND ur.org_id = $1::uuid "
        " WHERE LOWER(u.email) = ANY($2::text[]) "
        "   AND ur.role_code = ANY($3::text[])",
        str(org_id), wanted, list(REPORT_RECIPIENT_ROLES))
    members = [r["email"] for r in rows]
    return members, len(wanted) - len(members)


async def module_arrangement(pool, user_id, org_id: str, module: str) -> tuple[list, str]:
    """The arrangement the module page shows, resolved server-side.

    The /views resolution order verbatim — personal default > org default >
    first applicable preset (cut to this module's widgets) — finished with
    the frontend's own fallback (autoLayout): the module's non-absent
    registry metrics in registry order, capped at DERIVED_WIDGET_CAP, a flow
    drawn as a trend, a stock as a figure. The report and the screen must
    resolve the SAME arrangement, or "download exactly what I am looking at"
    is approximately true — that is, false. `user_id` may be None (the
    engine's scheduled sends have no person): personal defaults simply never
    match.
    """
    rows = await pool.fetch(
        "SELECT user_id, name, layout "
        "  FROM staging.analytics_views "
        " WHERE org_id = $1::uuid AND module = $2::text AND is_active "
        "   AND is_default AND (user_id IS NULL OR user_id = $3::text) "
        " ORDER BY updated_at DESC",
        org_id, module, user_id or "")

    def _layout(r) -> list:
        lay = r["layout"]
        return json.loads(lay) if isinstance(lay, str) else lay

    personal = next((r for r in rows if r["user_id"] is not None), None)
    if personal is not None:
        return _layout(personal), "personal"
    org_default = next((r for r in rows if r["user_id"] is None), None)
    if org_default is not None:
        return _layout(org_default), "org"

    for key, p in PRESETS.items():
        if module not in p.get("modules", ()):
            continue
        layout = [w for w in p["layout"]
                  if w["metric"] in REGISTRY
                  and REGISTRY[w["metric"]].module == module]
        if layout:
            # A preset with nothing left after the cut is skipped, not
            # served as a husk.
            return layout, f"preset:{key}"

    derived = []
    for m in REGISTRY.values():
        if m.module != module or m.absent:
            continue
        derived.append({"metric": m.key, "viz": "trend", "w": 2}
                       if m.grain == "flow"
                       else {"metric": m.key, "viz": "kpi", "w": 1})
        if len(derived) >= DERIVED_WIDGET_CAP:
            break
    return derived, "derived"


async def report_widget(pool, org_id: str, module: str, win,
                        widget: dict, gate, gate_cache: dict) -> dict:
    """One widget of the arrangement, run exactly as /run runs it — or a
    STATED absence. A retired key, a declared-absent metric and a module the
    caller may not read all say so in words; none renders as a zero and none
    is dropped silently (proposal 62 §10).

    `gate` is `async (module_code) -> bool` or None. None means NO gate is
    available (the engine's scheduled send), and every foreign-module widget
    is withheld — a robot must not hand out numbers nobody's entitlement was
    checked for.
    """
    key = widget.get("metric")
    m = REGISTRY.get(key)
    base = {
        "metric": key,
        "label": m.label if m else str(key),
        "viz": widget.get("viz", "kpi"),
        "unit": m.unit if m else None,
        "grain": m.grain if m else None,
    }
    if m is None:
        return {**base, "absent": "This metric is no longer measured — the "
                                  "view names a key the registry has retired."}
    if m.absent:
        return {**base, "absent": m.absent}

    if m.module != module:
        allowed = gate_cache.get(m.module)
        if allowed is None:
            allowed = bool(gate) and await gate(m.module)
            gate_cache[m.module] = allowed
        if not allowed:
            return {**base, "absent": f"Withheld — this widget needs the "
                                      f"{m.module} module."}

    group_by = widget.get("group_by")
    if group_by and group_by not in m.dimensions:
        # A dimension can be retired after a view named it; the widget still
        # answers, ungrouped, rather than failing the whole file.
        group_by = None
    req = MetricRequest(org_id=org_id,
                        window=win if m.grain == "flow" else None,
                        bucket="month", group_by=group_by or None)
    sql, params = m.sql(req)
    rows = [dict(r) for r in await pool.fetch(sql, *params)]
    return {**base, "data": rows}


async def report_section(pool, org_id: str, module: str, win,
                         section: dict, gate, gate_cache: dict) -> dict:
    """One ROW-LEVEL section of the arrangement — `report_widget`'s sibling.

    Returns the SAME `{label, data: rows}` shape a widget returns, or the
    same stated absence, because `render_report_html` (and the csv/xlsx
    branches in routers/analytics.py) discriminate on those two keys and
    nothing else. That is the whole design: a row-level report needed no new
    renderer, no new PDF engine and no new export code — only a second
    producer of the widget shape.

    THE CAVEAT THIS DOCSTRING USED TO GET WRONG, NOW FIXED AT THE ROUTER.
    A section carries no `metric` key, and routers/analytics.py used to build
    `window.windowed` / `window.as_at` with `w["metric"]` over every entry
    carrying `"data"` — so a section in a layout raised KeyError there. This
    docstring claimed only `?format=json` was affected. IT WAS NOT: that
    payload is built BEFORE the format branches, so the csv, xlsx and pdf
    downloads 500'd on it too. The router now reads the entry's identity
    through `_entry_key` (`w.get("metric") or w.get("report")`) and drops the
    Nones, so all four formats take a section.

    A section still deliberately does NOT fake a `metric` key: `metric: None`
    would land a null in a list of metric keys and move the fault somewhere
    quieter. Any NEW consumer of this shape must discriminate the same way —
    on `label` + `data`/`absent` for rendering, on `_entry_key` for identity.

    Why this exists at all rather than being a metric: `MetricRequest`
    (analytics/registry.py) carries org_id, window, bucket and group_by —
    there is no row mode and no entity filter — and every metric builder is
    an aggregate by construction. See services/report_defs/__init__.py.

    `section` mirrors a widget item: `{"report": "<key>"}`. `gate` is
    `async (module_code) -> bool` or None, with None meaning NO gate is
    available (the engine's scheduled send) — and then every FOREIGN module
    a section reads is refused, so the section is withheld. Fail-closed, in
    words, exactly as report_widget's foreign-widget rule: a robot must not
    hand out rows nobody's entitlement was checked for. The check is on
    `reads`, not on `module` alone: a section that joins a second module's
    table declared it, and the join must not be the way past the grant.
    """
    from services.report_defs import REPORT_DEFS, load_all

    load_all()
    key = section.get("report")
    d = REPORT_DEFS.get(key)
    base = {"report": key, "label": d.label if d else str(key),
            "grain": d.grain if d else None}
    if d is None:
        return {**base, "absent": "This report is no longer produced — the "
                                  "view names a section that has been retired."}

    for code in sorted(d.reads):
        if code == module:
            # The page's own module: /module-report already ran THE gate on
            # it before resolving the arrangement, and asking again here
            # would double-count the sensitive-module audit row.
            continue
        allowed = gate_cache.get(code)
        if allowed is None:
            allowed = bool(gate) and await gate(code)
            gate_cache[code] = allowed
        if not allowed:
            return {**base, "absent": f"Withheld — this report needs the "
                                      f"{code} module."}

    # A stock section is handed None, the same contract MetricRequest holds,
    # so it cannot silently read a window it does not honour (this one ages
    # as at TODAY — a balance is what is unpaid now, not at a period end).
    rows = await d.run(pool, org_id, win if d.grain == "flow" else None)
    return {**base, "data": [dict(r) for r in rows]}


def is_section(item) -> bool:
    """Is this layout entry a ROW-LEVEL section rather than a metric widget?

    THE one test, in the one place both the validator and every renderer can
    reach it. `routers/analytics.py` imports it to decide what a saved layout
    may CONTAIN and `report_entry` uses it to decide what a saved layout MEANS,
    so a layout cannot save as one thing and render as another. A section names
    `report`; a widget names `metric`; an entry naming both is refused at save
    time, so this is never ambiguous by the time a layout is read back.
    """
    return isinstance(item, dict) and item.get("report") is not None


async def report_entry(pool, org_id: str, module: str, win,
                       entry: dict, gate, gate_cache: dict) -> dict:
    """ONE layout entry, whichever kind it is — the dispatcher every door owes.

    `report_widget` and `report_section` return the same shape, but they are
    two functions and a caller that knows only one of them mishandles the
    other. That is not hypothetical: handing `{"report": …}` to `report_widget`
    reads `metric` off it, gets None, misses the registry and renders the entry
    as **"This metric is no longer measured"** under the label "None" — a
    register silently replaced by a wrong sentence, on a document that is
    EMAILED. Every door that walks a saved layout should come through here.

    Doors as of this commit:
      · routers/analytics.py `/module-report`   — uses this.
      · routers/dristi.py (scheduled run-now)   — still calls report_widget
        directly; one-line change, owned by that router.
      · services/niyam/actions.py `report.send` — likewise.

    The two that have not switched are safe TODAY only because no saved layout
    holds a section yet, and they stop being safe the moment one does.
    """
    producer = report_section if is_section(entry) else report_widget
    return await producer(pool, org_id, module, win, entry, gate, gate_cache)


def render_report_html(org, label: str, period_line: str, widgets: list) -> str:
    """The letterhead DOCUMENT for a module report — the pdf branch renders
    this to bytes; report.send mails it as the body (the gated transport has
    no attachment support yet, and the HTML **is** the report — same
    letterhead, same tables, same absences)."""
    from services import doc_render as R
    from services.report_render import analytics_letterhead, pdf_table

    head = analytics_letterhead(
        org, title_en=f"{label} report", title_hi="मॉड्यूल विवरण",
        period_line=period_line)
    parts = [head]
    for wd in widgets:
        if "absent" in wd:
            parts.append(R.block(
                str(wd["label"]),
                f"<p>Not yet measurable — {R.esc(str(wd['absent']))}</p>"))
        elif wd.get("data"):
            parts.append(pdf_table(wd["label"], wd["data"]))
        else:
            parts.append(R.block(str(wd["label"]),
                                 "<p>No rows for this period.</p>"))
    generated = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    parts.append(R.foot(f"Generated {R.esc(generated)} &middot; Prepared in Kartavya"))
    return R.document(
        ["".join(parts)], org, title=f"{label} report — Kartavaya",
        running=R.running_id(f"{label} report", org, period_line))
