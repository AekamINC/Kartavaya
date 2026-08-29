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

ORPHAN-MODULE PRESETS (owner decision, 2026-08-18). Sanvaad, Niyam and Pay get
NO analytics tab of their own — their figures live on Dristi's cross-module
surface as the three presets at the foot of this dict (communication /
automation / payments), and each module's chrome carries an "Analytics ↗" door
deep-linking here (`/dristi?tab=analytics&preset=<key>`). Notes the layouts
stand on:

· Sanvaad alone has three live metrics (read_rate is declared absent — the
  aggregate-only privacy rule), so "communication" spans sanvaad AND varta:
  both live in the same Messages page, and the entitlement cut already
  degrades the preset to its sanvaad half for an org without WhatsApp.
· Niyam is not a module code — its metrics are `core.niyam_*` (see
  metrics/niyam.py) — so "automation" declares `("core",)` and survives for
  every org, which is right: automation ships with every org.
· Pay is a Ganit capability (`ganit.pay_*`, see metrics/pay.py), so
  "payments" is ganit-gated like the finance preset. `pay_links_sent` is
  declared absent and deliberately not listed here.
· Order matters: the resolver's floor is the FIRST surviving preset, so these
  three are appended after the role presets and never become anyone's
  unasked-for default.
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
            # WHO EARNED IT, not just how much. The owner, 2026-08-29:
            # "finance, crm report needs members name who did what this weeks
            # and how much total gp, deal etc etc."
            #
            # ⚠ IT IS IN `founder` AND NOT ONLY IN `finance` BECAUSE OF THE
            # RESOLUTION ORDER, which is easy to get wrong and produces a
            # feature that exists and never appears. `module_arrangement` walks
            # `PRESETS` in insertion order and returns the FIRST preset naming
            # the module — and `founder` names `ganit` and comes first. So a
            # `ganit` page (and the emailed 'revenue' report, which resolves the
            # same arrangement) lands on `founder`, never on `finance`, for any
            # org that has not saved a default of its own. Adding it to
            # `finance` alone would have shipped it invisible.
            {"report": "ganit.member_activity"},
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
            # Beside `founder`'s copy: a finance desk that has chosen this
            # preset explicitly must not lose the attribution the default
            # arrangement carries.
            {"report": "ganit.member_activity"},
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
            # The CRM half of the owner's ask. This is the preset a `graha`
            # page resolves to — `founder` and `finance` do not name graha, so
            # `sales_head` is genuinely first here — and therefore the one the
            # emailed 'pipeline' report renders.
            #
            # ⚠ Most of the rows it prints will say "Unassigned", and that is
            # the truth rather than a defect in the section: `assigned_to` only
            # became settable from a screen on 2026-08-29, so 28 of Unicode's
            # 33 deals carry no owner. The section says so on the page.
            {"report": "graha.member_activity"},
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
    # ── Orphan-module presets — see the module docstring ─────────────────────
    "communication": {
        "label": "Communication",
        "hi": "संवाद",
        "why": ("Is the firm talking, and is anyone answering? Internal "
                "channel volume and cadence beside WhatsApp delivery — the "
                "message you sent is worthless until it is read."),
        "modules": ("sanvaad", "varta"),
        "layout": [
            {"metric": "sanvaad.message_volume", "viz": "trend", "w": 2},
            {"metric": "sanvaad.active_participants", "viz": "trend", "w": 1},
            {"metric": "sanvaad.response_time", "viz": "kpi", "w": 1},
            {"metric": "varta.sends", "viz": "trend", "w": 2},
            {"metric": "varta.delivery_rate", "viz": "kpi", "w": 1},
            {"metric": "varta.read_rate", "viz": "kpi", "w": 1},
            {"metric": "varta.reply_rate", "viz": "kpi", "w": 1},
        ],
    },
    "automation": {
        "label": "Automation",
        "hi": "स्वचालन",
        "why": ("What the rules actually did: evaluations, actions executed "
                "against suppressed, the failure rate — and the rules that "
                "have never fired at all, which is where trust in automation "
                "quietly goes to die."),
        "modules": ("core",),
        "layout": [
            {"metric": "core.niyam_rules_fired", "viz": "trend", "w": 2},
            {"metric": "core.niyam_failure_rate", "viz": "kpi", "w": 1},
            {"metric": "core.niyam_actions", "viz": "trend", "w": 2},
            {"metric": "core.niyam_never_fired", "viz": "table", "w": 3},
        ],
    },
    "payments": {
        "label": "Payments",
        "hi": "भुगतान",
        "why": ("The pay-link funnel: opened, converted, and how long money "
                "takes to arrive and reconcile. Looking is not paying — "
                "'paid' only ever comes from bank reconciliation."),
        "modules": ("ganit",),
        "layout": [
            {"metric": "ganit.pay_links_opened", "viz": "trend", "w": 2},
            {"metric": "ganit.pay_link_conversion", "viz": "kpi", "w": 1},
            {"metric": "ganit.pay_time_to_payment", "viz": "kpi", "w": 1},
            {"metric": "ganit.pay_reconciliation_lag", "viz": "trend", "w": 2},
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
