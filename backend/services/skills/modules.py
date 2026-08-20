"""
modules.py — which module's data every skill source and handler actually reads.

The gap this closes, stated plainly: the whole skill path is gated on
`require_module("sahayak")` and nothing else, while the handlers behind it read
`ganit_invoices`, `manav_employees`, `vetana_salary_structures` and
`manav_attendance`. So Sahayak was a way around `SENSITIVE_MODULES` — a user with
a Sahayak grant and nothing else could read the books, the payroll register and
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

#: No module grant needed. Core PM and the Sahayak knowledge base — the caller
#: already holds `sahayak` or they could not have reached a skill at all.
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
    # The org's own knowledge base, inside Sahayak.
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
    # Core PM is not a gated module, so these two are open to anyone with Sahayak.
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
    # ganit alone: ganit_vendor_bills JOIN ganit_vendors for the name and GSTIN.
    # The vendor is a Ganit record, not a CRM contact, so graha would be a grant
    # demanded for a join that does not exist.
    "brief_itc_reversal_risk":    frozenset({"ganit"}),
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

    # ── READ · the first-tier operational fourteen ──────────────────────────
    #
    # `staging.statute_calendar`, `staging.organisations` and
    # `staging.org_upi_accounts` appear in several of these queries and
    # contribute NO module to any line below. The first is the law — org-
    # independent reference data, the same rows for every tenant — and the other
    # two are the org's own identity and its own payee addresses. None of them
    # belongs to a gated module, and demanding a grant for reading the statute
    # book would gate the one thing in the product that is public record.

    # Ganit alone. Vendor bills, vendors, invoices and the product master, all
    # of which are Ganit's; the vendor is a `ganit_vendors` record and not a CRM
    # contact, so graha would be a grant demanded for a join that does not
    # exist. `tests/test_gst_cliffs.py` pins all three at exactly {"ganit"}.
    "brief_ims_expectations":     frozenset({"ganit"}),
    "brief_itc_at_risk_of_lapse": frozenset({"ganit"}),
    "check_dead_gst_slabs":       frozenset({"ganit"}),

    # ganit_vendor_bills JOIN ganit_vendors, same as `brief_itc_reversal_risk`
    # above and for the same reason. Ganit alone.
    "check_duplicate_vendor_bills": frozenset({"ganit"}),
    # ganit_invoices, and `organisations` for the series prefix. No CRM leg at
    # all — a gap in a number book is a fact about the book.
    "check_invoice_series_and_splits": frozenset({"ganit"}),

    # BOTH, and the graha leg is not decorative. Each of these resolves the
    # customer through `graha_clients` / `graha_contacts`, so the output carries
    # the client COMPANY and, for the pack, the person's email and phone. That
    # is CRM data arriving through a Ganit skill, which is the shape of the leak
    # this file exists to close — the same reasoning that makes `find_low_stock`
    # require {"vikray", "ganit"} rather than vikray alone.
    "check_retainers_that_stopped_billing": frozenset({"ganit", "graha"}),
    "pack_collection_messages":   frozenset({"ganit", "graha"}),
    "check_stale_retainer_rates": frozenset({"ganit", "graha"}),

    # Manav + Vetana, exactly as `check_payroll_readiness`. Without vetana a
    # reader still learns each named person's PAN and UAN; without manav, the
    # roster. The gate reading a payslip register is both grants or neither.
    "check_statutory_records_gate": frozenset({"manav", "vetana"}),
    # vetana_payroll_runs for every figure, manav_holidays for `_closed_days` —
    # which is what moves a statutory due date off a public holiday. The holiday
    # calendar is a Manav table, so this is both and not vetana alone.
    "brief_statutory_dues":       frozenset({"manav", "vetana"}),
    # manav only: attendance, employees, holidays, leave requests, balances and
    # types. Nothing here reads pay.
    "check_attendance_exceptions": frozenset({"manav"}),
    # manav_expense_claims JOIN manav_employees. A reimbursement is an HR claim,
    # not a payslip line — vetana is not read and is not demanded.
    "brief_unpaid_reimbursements": frozenset({"manav"}),

    # vikray_stock / vikray_stock_moves JOIN ganit_products. Both, for the same
    # reason `find_low_stock` needs both: the join returns COST PRICES, which
    # are the product master's and therefore Ganit's.
    "check_impossible_stock":     frozenset({"vikray", "ganit"}),
    # …and the customer on top of that, through graha_clients / graha_contacts.
    # All three, so in practice org_owner/org_admin — which is right for a page
    # that names which customer's order cannot be filled.
    "check_unfillable_orders":    frozenset({"vikray", "ganit", "graha"}),

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
    # manav_employees + vetana_salary_structures — the only handler that reaches
    # payroll structures.
    "execute_onboarding":         frozenset({"manav", "vetana"}),
    "send_campaign":              frozenset({"prachar"}),
    "execute_sequence_step":      frozenset({"prachar"}),
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
    user_id: str | None,
    org_id: str | None,
    needed: frozenset[str],
    *,
    request=None,
) -> frozenset[str]:
    """Of the modules this step needs, which can the caller NOT reach.

    TWO questions, and the second one is not optional.

    WHAT the caller holds. `held_module_levels` is the same resolution
    `require_module` performs — a platform role's reach through `modules_for`,
    org_owner/org_admin's blanket grant, and any `org_member_modules` row — so a
    module refused there cannot be acquired here, and the answer cannot differ
    between this gate and the one on every other route.

    An empty level set means no grant. VIEWER is enough: a skill READS, and the
    weakest rung on the ladder is the right bar for reading. Anything that
    writes is already behind `allow_writes` and its own route guard.

    WHOSE records they are holding it over. `held_module_levels` answers the
    first question with no notion of which organisation the request names, which
    is correct everywhere the resolver has already refused the X-Org-Id header
    and wrong on the four prefixes where it has not. See
    `cross_tenant_withheld` — it runs on what the first question ADMITTED, so it
    can only ever remove reach, never add it.

    `request` is used for the audit row's IP and user agent and for the support
    session's per-request cache. Omitting it costs those two things and changes
    no decision: every fact the gate reads comes out of the pool.
    """
    if not needed:
        return frozenset()

    withheld: set[str] = set()
    for module_code in sorted(needed):
        levels = await held_module_levels(user_id, org_id, module_code)
        if not levels:
            withheld.add(module_code)

    withheld |= await cross_tenant_withheld(
        user_id, org_id, frozenset(set(needed) - withheld), request=request,
    )
    return frozenset(withheld)


# ═══════════════════════════════════════════════════════════════════════════
# THE SECOND GATE — the organisation the reach is being used IN
#
# `middleware/org_resolver.CROSS_ORG_HEADER_PREFIXES` scopes the platform
# escape hatch BY PATH, on purpose: "the resolver already has the request, so it
# can ask WHERE the header is being used, not only BY WHOM." `/api/v1/ganit/`,
# `/api/v1/graha/` and `/api/v1/vikray/` are deliberately absent from it.
#
# A skill or an answer defeats that scoping from the inside. It arrives on
# `/api/v1/hub/` — which IS widened, because Aekam runs the agency service for
# client orgs — and then reads whatever module its plan named. Measured:
# `can_reach_module("platform_manager", "ganit")` is True, so a platform account
# sending `X-Org-Id: <a customer>` to `POST /api/v1/hub/chat` and asking "what do
# customers owe us" read that customer's receivables through a gate that says
# `sahayak`, having been refused the same rows on `/api/v1/ganit/`.
#
# THE RULE. A caller who is not a member of the organisation being read reaches
# only what the org itself put within reach:
#
#   · a module whose OWN routes are on the console tuple — measured, `sahayak`
#     alone, derived here rather than written down so the two cannot drift; and
#   · a module the CUSTOMER named on a live, approved, unexpired support
#     session, which is the second and independent path through the header.
#
# WHAT THIS DOES NOT TOUCH. Ordinary members: the platform-role probe answers
# None and the function returns on the next line. A platform account inside its
# own organisation — nine of the ten live ones — is a member, so no boundary is
# crossed and nothing is narrowed. This removes exactly one thing: reading
# another tenant's ledgers through a surface gated on a different module.
# ═══════════════════════════════════════════════════════════════════════════


def console_reachable_modules() -> frozenset[str]:
    """Modules a platform role may already name another org on, by path.

    DERIVED from the two live constants, never listed. `SUPPORT_MODULE_PREFIXES`
    is the product's module → route-prefix map (its own comment records that it
    was built by grepping `require_module("` against the router prefixes), and
    `_cross_org_path_allowed` is the predicate `get_org_id` itself applies. If
    somebody widens the console tuple this set widens with it, which is right:
    the two would otherwise disagree silently, and a gate that disagrees with
    the resolver is the shape of the bug this closes.
    """
    from middleware.org_resolver import (
        SUPPORT_MODULE_PREFIXES, _cross_org_path_allowed,
    )
    return frozenset(
        code for code, prefixes in SUPPORT_MODULE_PREFIXES.items()
        if any(_cross_org_path_allowed(prefix) for prefix in prefixes)
    )


async def cross_tenant_withheld(
    user_id: str | None,
    org_id: str | None,
    admitted: frozenset[str],
    *,
    request=None,
) -> frozenset[str]:
    """Of the modules already admitted, which this caller may not use HERE.

    Takes the ADMITTED set rather than the needed set so it cannot grant
    anything: it is a second refusal layered on the first, and a module the
    first gate withheld is never reconsidered.

    Fails closed on the ordinary axis — a pool error raises rather than reading
    as "no platform role" — and fails OPEN on nothing.
    """
    if not admitted or not user_id or not org_id:
        return frozenset()

    from db import get_pool
    from middleware.role_tiers import ORG_ROLES, PLATFORM_ROLE_PRECEDENCE

    pool = await get_pool()

    # The same probe, verbatim, that `require_module` and `held_module_levels`
    # both make. Three call sites asking the same question three ways is how
    # they drift apart; ordered by precedence so a user holding several rows
    # resolves to the strongest rather than to whichever row came back first.
    platform_role = await pool.fetchval(
        "SELECT role_code FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id IS NULL "
        "AND role_code = ANY($2::text[]) "
        "ORDER BY array_position($2::text[], role_code) LIMIT 1",
        user_id, list(PLATFORM_ROLE_PRECEDENCE),
    )
    if not platform_role:
        # Not an Aekam account. Nothing below applies and no further query is
        # made — this is the path essentially every request takes.
        return frozenset()

    # `ORG_ROLES` and not three literals, and the same predicate `org_resolver`
    # and `require_module` use, so "is a member" means one thing product-wide.
    is_member = bool(await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid AND role_code = ANY($3::text[])",
        user_id, org_id, list(ORG_ROLES),
    ))

    withheld: set[str] = set()
    if not is_member:
        from middleware.org_resolver import active_support_session, session_modules

        session = await active_support_session(pool, user_id, org_id, request)
        allowed = console_reachable_modules() | set(session_modules(session))
        withheld = {code for code in admitted if code not in allowed}

    _audit_module_crossings(
        sorted(set(admitted) - withheld),
        platform_role=platform_role, user_id=user_id, org_id=org_id,
        is_member=is_member, request=request,
    )
    return frozenset(withheld)


def _audit_module_crossings(
    modules: list[str], *, platform_role: str, user_id: str, org_id: str,
    is_member: bool, request=None,
) -> None:
    """One row per sensitive module this request is about to read.

    THE GAP THIS FILLS. `require_module` is instantiated once per router —
    `_hub_gate = require_module("sahayak")` — so `platform_audit_row` was only
    ever asked about `sahayak`, which is not in `SENSITIVE_MODULES` and which
    `platform_audit_needed` therefore answers False for on a read. The `ganit`
    read happened afterwards, inside `held_module_levels`, which writes nothing.
    `held_module_levels`' own comment claims "that crossing has already written
    an audit row by the time this runs"; on this path it measurably had not,
    because `require_module("ganit")` never executed anywhere in the request.

    Written only for modules that were ADMITTED. A row saying an account read
    the books, emitted on the request where it was refused them, manufactures
    the event it is supposed to record.

    `platform_audit_needed`'s standing volume decision is not reversed here: a
    non-sensitive read by a platform role stays silent, because a row per read
    would bury the warn-severity rows that carry the signal. Reversing it is the
    owner's call and would be a change to a tripwire test that asserts the
    silence deliberately.
    """
    if not modules:
        return

    from middleware.subscription import platform_audit_row
    from services import audit as audit_service

    for module_code in modules:
        plan = platform_audit_row(module_code, is_write=False, is_member=is_member)
        if not plan:
            continue
        action, severity = plan
        audit_service.emit(
            action,
            request,
            org_id=org_id,
            user_id=user_id,
            resource_type="module",
            resource_id=module_code,
            detail={
                "role": platform_role,
                "member": is_member,
                # WHICH gate the request actually passed, so a reader can tell
                # this row apart from one written by `require_module` itself.
                "via": "skill_module_access",
                "reason": "read as part of a skill run or a Sahayak answer",
            },
            severity=severity,
        )
