"""Role presets — the dashboard an org sees before anyone has built one.

Proposal 62 D6: presets are chosen from the modules the org actually bought,
so the first login shows a populated dashboard instead of an empty builder.

PRESETS ARE CODE, NOT ROWS — the same argument `niyam/templates.py` makes for
starter rules. A preset stored as a row is frozen at the version the org
signed up under; one defined here improves for every org on deploy. They sit
at the BOTTOM of the resolution order (personal > org > preset), so the
moment anybody saves a view, the preset stops being what they see.

A preset may only name metric keys that exist in the registry —
`tests/test_analytics_views.py` walks every widget through `REGISTRY` — and
the resolver additionally drops widgets whose module the caller cannot reach,
so a finance preset shown to an org without Ganit is the preset minus the
Ganit widgets, not an error and not a sea of "absent".

The widget shape is the layout contract the builder edits:

    {"metric": "ganit.dso", "viz": "kpi",   "w": 1}
    {"metric": "ganit.invoiced_vs_collected", "viz": "trend", "w": 2}
    {"metric": "ganit.top_debtors", "viz": "table", "w": 3,
     "columns": ["label", "outstanding", "days_overdue"]}

`viz` ∈ VIZ_TYPES; `w` is grid columns 1–3 (fluid, never fixed px). `columns`
applies to tables only and is the column-chooser's output.
"""
from __future__ import annotations

VIZ_TYPES = ("kpi", "trend", "bars", "table")

#: role key -> preset. `modules` names every module the preset draws on; the
#: resolver uses it to say "this preset needs Ganit" rather than rendering a
#: husk when none of its widgets survive the entitlement cut.
PRESETS: dict[str, dict] = {
    "founder": {
        "label": "Founder",
        "hi": "संस्थापक",
        "why": ("Money in, money owed, work moving. The one-glance answer to "
                "'is the firm healthy' — receivables next to delivery."),
        "modules": ("ganit", "core"),
        "layout": [
            {"metric": "ganit.outstanding", "viz": "kpi", "w": 1},
            {"metric": "ganit.dso", "viz": "kpi", "w": 1},
            {"metric": "ganit.collection_rate", "viz": "kpi", "w": 1},
            {"metric": "ganit.invoiced", "viz": "trend", "w": 2},
            {"metric": "ganit.collected", "viz": "trend", "w": 1},
            {"metric": "core.tasks_by_status", "viz": "bars", "w": 1},
            {"metric": "core.overdue", "viz": "kpi", "w": 1},
            {"metric": "core.throughput", "viz": "trend", "w": 1},
            {"metric": "ganit.receivables_ageing", "viz": "bars", "w": 3},
        ],
    },
    "finance": {
        "label": "Finance",
        "hi": "वित्त",
        "why": ("Ageing, DSO and the gap between invoiced and collected — "
                "what an Indian SMB finance desk asks before anything else."),
        "modules": ("ganit",),
        "layout": [
            {"metric": "ganit.receivables_ageing", "viz": "bars", "w": 2},
            {"metric": "ganit.dso", "viz": "kpi", "w": 1},
            {"metric": "ganit.invoiced", "viz": "trend", "w": 2},
            {"metric": "ganit.collected", "viz": "trend", "w": 1},
            {"metric": "ganit.top_debtors", "viz": "table", "w": 3},
            {"metric": "ganit.collection_rate", "viz": "kpi", "w": 1},
            {"metric": "ganit.payment_lag", "viz": "kpi", "w": 1},
            {"metric": "ganit.gst_output", "viz": "bars", "w": 1},
        ],
    },
    "delivery_lead": {
        "label": "Delivery lead",
        "hi": "डिलीवरी प्रमुख",
        "why": ("Throughput, cycle time and who is carrying what — the "
                "questions a stand-up exists to answer, without the stand-up."),
        "modules": ("core",),
        "layout": [
            {"metric": "core.tasks_by_status", "viz": "bars", "w": 1},
            {"metric": "core.overdue", "viz": "kpi", "w": 1},
            {"metric": "core.lead_time", "viz": "kpi", "w": 1},
            {"metric": "core.throughput", "viz": "trend", "w": 2},
            {"metric": "core.workload", "viz": "table", "w": 3},
            {"metric": "core.utilisation", "viz": "kpi", "w": 1},
            {"metric": "core.billable_split", "viz": "bars", "w": 2},
        ],
    },
    "sales_head": {
        "label": "Sales head",
        "hi": "बिक्री प्रमुख",
        "why": ("Pipeline, win rate and the cycle: is enough coming in, is it "
                "closing, how long does it take — then orders against "
                "targets, which is where the quarter is actually decided."),
        "modules": ("graha", "vikray"),
        "layout": [
            {"metric": "graha.pipeline_by_stage", "viz": "bars", "w": 2},
            {"metric": "graha.win_rate", "viz": "kpi", "w": 1},
            {"metric": "graha.sales_cycle", "viz": "kpi", "w": 1},
            {"metric": "graha.avg_deal_size", "viz": "kpi", "w": 1},
            {"metric": "vikray.target_attainment", "viz": "bars", "w": 1},
            {"metric": "vikray.orders", "viz": "trend", "w": 3},
        ],
    },
    "hr": {
        "label": "HR",
        "hi": "मानव संसाधन",
        "why": ("Headcount, attrition and attendance — the three numbers every "
                "HR review opens with — and the leave liability that quietly "
                "grows while nobody takes a holiday. Attendance arrives as "
                "team aggregates only; who was absent stays behind Pahchan's "
                "own access rules."),
        "modules": ("manav", "pahchan", "vetana"),
        "layout": [
            {"metric": "manav.headcount", "viz": "kpi", "w": 1},
            {"metric": "manav.attrition", "viz": "kpi", "w": 1},
            {"metric": "manav.leave_liability_days", "viz": "kpi", "w": 1},
            {"metric": "manav.headcount_bridge", "viz": "trend", "w": 2},
            {"metric": "manav.department_mix", "viz": "bars", "w": 1},
            {"metric": "pahchan.attendance_rate", "viz": "trend", "w": 2},
            {"metric": "vetana.payroll_cost", "viz": "trend", "w": 1},
        ],
    },
}


def preset_catalogue() -> list[dict]:
    """The picker's list: key, labels, why, and the modules each needs."""
    return [
        {"key": k, "label": p["label"], "hi": p.get("hi", ""),
         "why": p["why"], "modules": list(p["modules"])}
        for k, p in PRESETS.items()
    ]
