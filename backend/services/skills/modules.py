"""
modules.py — which module's data every skill source and handler actually reads.

The gap this closes, stated plainly: the whole skill path is gated on
`require_module("sahayak")` and nothing else, while the handlers behind it read
`ganit_invoices`, `manav_employees`, `vetana_salary_structures` and
`manav_attendance`. So Srijan was a way around `SENSITIVE_MODULES` — a user with
a Srijan grant and nothing else could read the books, the payroll register and
the attendance log, none of which they hold a grant for. Sixteen of the
twenty-three handlers touch a table belonging to another module.

The declaration lives here, apart from both the registry and the context layer,
because BOTH need it and neither should own it. It imports only
`middleware.role_tiers`, so it can be imported from anywhere without a cycle.

── Why a SET of modules, not one ───────────────────────────────────────────────

Several handlers straddle. `aggregate_kpis` reads Ganit payments AND Graha deals
AND Manav headcount; `execute_onboarding` touches Manav and Vetana. A single
"owning module" would have to pick one and would then leak the others. The
caller must hold EVERY module named, which is the only rule that composes
correctly when a general cross-module skill is assembled out of these.

── The empty set is a real answer ─────────────────────────────────────────────

Core PM — tasks, projects, boards — is not a gated module; it is not in
`ALL_MODULES` and there is no `require_module("kartavya")` anywhere. So sources
reading it require no grant, and that is expressed as an empty set rather than
omitted, so a source missing from these maps can be treated as an error rather
than as "free".
"""
from middleware.role_tiers import ALL_MODULES, SENSITIVE_MODULES, held_module_levels

#: No module grant needed. Core PM and the Srijan knowledge base — the caller
#: already holds `srijan` or they could not have reached a skill at all.
FREE: frozenset[str] = frozenset()


#: Context source key -> the modules whose data it returns.
#: Keys must stay in step with `services/skills/context.py:SOURCES`; the test
#: `test_every_context_source_declares_its_module` fails if they drift.
SOURCE_MODULES: dict[str, frozenset[str]] = {
    # `find_overdue` over ganit_invoices / ganit_vendor_bills / ganit_contracts.
    "receivables": frozenset({"ganit"}),
    "payables":    frozenset({"ganit"}),
    "agreements":  frozenset({"ganit"}),
    # graha_follow_ups, graha_deals.
    "followups":   frozenset({"graha"}),
    "deal_health": frozenset({"graha"}),
    # vikray_stock JOIN ganit_products — the product master is Ganit's, so this
    # needs both. It reads as over-strict until you notice the join returns
    # cost prices.
    "stock":       frozenset({"vikray", "ganit"}),
    # manav_attendance JOIN manav_employees — returns named employees with
    # absence and overtime counts.
    "attendance":  frozenset({"manav"}),
    # aggregate_kpis: ganit_payments + ganit_invoices + ganit_expenses +
    # graha_deals + graha_contacts + manav_employees. The widest of the lot, and
    # the one reachable with no data step at all.
    "kpis":        frozenset({"ganit", "graha", "manav"}),
    # public.tasks. Not a gated module.
    "tasks":       FREE,
    # The org's own knowledge base, inside Srijan.
    "knowledge":   FREE,
}


#: skill_function -> the modules whose data it reads or writes.
#: Every name in `SKILL_REGISTRY` must appear; the test
#: `test_every_registered_function_declares_its_modules` fails if one is added
#: without a declaration, which is the failure mode that produced this file.
FUNCTION_MODULES: dict[str, frozenset[str]] = {
    # ── READ ────────────────────────────────────────────────────────────────
    "find_overdue_invoices":      frozenset({"ganit"}),
    "find_overdue_vendor_bills":  frozenset({"ganit"}),
    "find_stalled_agreements":    frozenset({"ganit"}),
    "find_overdue_followups":     frozenset({"graha"}),
    "find_overdue_tasks":         FREE,
    "aggregate_kpis":             frozenset({"ganit", "graha", "manav"}),
    # Core PM is not a gated module, so these two are open to anyone with Srijan.
    "weekly_project_brief":       FREE,
    # Deliberately FREE and tasks-only: fusing the CRM follow-ups leg in would
    # force {"graha"} and refuse a core-PM user their own desk. The follow-ups
    # are `find_overdue_followups`, composed alongside in the template.
    "get_my_desk":                FREE,
    "triage_new_leads":           frozenset({"graha"}),
    # Contact + deals (graha), invoices (ganit), orders (vikray). All three, so
    # in practice org_owner/org_admin — the value is that one page carries the
    # relationship AND the money.
    "get_account_brief":          frozenset({"graha", "ganit", "vikray"}),
    "check_gstr1_readiness":      frozenset({"ganit"}),
    "brief_gstr3b_liability":     frozenset({"ganit"}),
    # BOTH, exactly. Without vetana a reader learns each named person's basic
    # pay and the size of every outstanding salary advance — a personal debt
    # disclosure. Without manav, the roster and its bank details.
    "check_payroll_readiness":    frozenset({"manav", "vetana"}),
    # vetana alone: every figure is from vetana_payslips. manav_employees is
    # joined for the NAME only, and a payroll register already implies the
    # roster — demanding manav too would take it from payroll staff who are
    # exactly the people it is for.
    "compare_payroll_months":     frozenset({"vetana"}),
    # ganit alone. The vendor is ganit_vendors, not a CRM contact — adding
    # graha here would be a grant demanded for a join that does not exist.
    "propose_payment_run":        frozenset({"ganit"}),
    "find_low_stock":             frozenset({"vikray", "ganit"}),
    "get_team_workload":          FREE,
    "scan_upcoming_deadlines":    FREE,
    "find_coverage_gaps":         frozenset({"manav"}),
    "check_dept_coverage":        frozenset({"manav"}),
    # ── DETECT ──────────────────────────────────────────────────────────────
    "score_deals":                frozenset({"graha"}),
    "detect_attendance_patterns": frozenset({"manav"}),
    # `metric` selects between ganit_payments and ganit_expenses.
    "detect_anomalies":           frozenset({"ganit"}),
    "check_expense_policy":       frozenset({"ganit"}),
    "match_bank_transactions":    frozenset({"ganit", "graha"}),
    "score_candidate":            frozenset({"manav"}),
    # ── ACT ─────────────────────────────────────────────────────────────────
    "generate_due_invoices":      frozenset({"ganit"}),
    "mark_holidays_weekends":     frozenset({"manav"}),
    # ganit_contracts + manav_assets JOIN manav_employees.
    "process_document_expiry":    frozenset({"ganit", "manav"}),
    "allocate_leave_yearly":      frozenset({"manav"}),
    "auto_schedule_week":         frozenset({"manav"}),
    # manav_employees + vetana_salary_structures — the only handler that reaches
    # payroll structures.
    "execute_onboarding":         frozenset({"manav", "vetana"}),
    "send_campaign":              frozenset({"prachar"}),
    "execute_sequence_step":      frozenset({"prachar"}),
    "escalate":                   frozenset({"ganit", "manav"}),
    "notify_multi":               FREE,
}


def modules_for_step(step: dict) -> frozenset[str]:
    """Every module a single step's data touches.

    A step can name both — a data step may also request context — so the two are
    unioned rather than one taking precedence.

    An UNDECLARED name contributes every sensitive module rather than nothing.
    That is deliberate and it is the whole safety posture of this file: a
    handler added to the registry without a line here becomes maximally
    restricted instead of silently free, so the failure is somebody being
    refused rather than somebody reading payroll.
    """
    needed: set[str] = set()

    fn = step.get("skill_function")
    if fn:
        needed |= set(FUNCTION_MODULES.get(fn, SENSITIVE_MODULES))

    for source in (step.get("context") or []):
        needed |= set(SOURCE_MODULES.get(source, SENSITIVE_MODULES))

    return frozenset(needed & ALL_MODULES)


async def withheld_modules(
    user_id: str | None, org_id: str | None, needed: frozenset[str]
) -> frozenset[str]:
    """Of the modules this step needs, which can the caller NOT reach.

    `held_module_levels` is the same resolution `require_module` performs — a
    platform role's reach through `modules_for`, org_owner/org_admin's blanket
    grant, and any `org_member_modules` row — so a module refused there cannot be
    acquired here, and the answer cannot differ between this gate and the one on
    every other route.

    An empty level set means no grant. VIEWER is enough: a skill READS, and the
    weakest rung on the ladder is the right bar for reading. Anything that
    writes is already behind `allow_writes` and its own route guard.
    """
    if not needed:
        return frozenset()

    withheld: set[str] = set()
    for module_code in sorted(needed):
        levels = await held_module_levels(user_id, org_id, module_code)
        if not levels:
            withheld.add(module_code)
    return frozenset(withheld)
