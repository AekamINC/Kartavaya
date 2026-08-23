"""
Purchase orders — proposal 77.

The four things worth testing in this module, in the order they cost money if
they are wrong:

  1. THE MONEY. `compute_po_totals` must round IDENTICALLY to
     `ganit._compute_invoice`, or every matched order reports a tax discrepancy
     and the exception list — the part of the module worth real money — becomes
     noise the firm switches off. That parity is asserted directly against the
     invoice function rather than against a copied expected value, so the two
     cannot drift apart without a red test.
  2. THE APPROVAL PATH. First-match-wins, self-approval, sequential order,
     two-approver rules, re-approval on a material revision, and every refusal
     by name.
  3. THE TENANCY. Another organisation's purchase order is a 404, not a 403 —
     a 403 confirms the id is real.
  4. THE REFUSALS. Every one of them, because a module that only works when
     used correctly is a module that has not been tested.

The router is mounted on a test app built here rather than on `server.app`: it
is not registered in `server.py` yet (that is one line for the owner to add),
and a test that depended on registration would fail for a reason that has
nothing to do with the code it is testing.
"""
import json
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import procurement
from routers.ganit import LineItem, _compute_invoice
from services.purchase_orders import (
    DEFAULT_CLOSE_REASONS,
    TDS_194Q_THRESHOLD,
    approval_satisfied,
    bill_qty_by_line,
    budget_state,
    build_diff,
    clean_prefix,
    compute_po_totals,
    derive_is_igst,
    match_rule,
    may_approve,
    needs_reapproval,
    next_po_number,
    po_status_after_receipts,
    receipt_allowed,
    sanitise_settings,
    tds_194q_row,
    three_way_match,
)

ORG = "00000000-0000-0000-0000-0000000000aa"
OTHER_ORG = "00000000-0000-0000-0000-0000000000bb"
PO_ID = "11111111-1111-1111-1111-111111111111"
LINE_ID = "22222222-2222-2222-2222-222222222222"
VENDOR_ID = "33333333-3333-3333-3333-333333333333"
BILL_ID = "44444444-4444-4444-4444-444444444444"


# ══════════════════════════════════════════════════════════════════════════════
# 1 · The money
# ══════════════════════════════════════════════════════════════════════════════

def _po_line(**kw):
    line = {"description": "Item", "qty_ordered": 1, "rate": 0, "gst_rate": 0,
            "discount_pct": 0, "unit": "NOS"}
    line.update(kw)
    return line


def test_intrastate_splits_cgst_and_sgst():
    out = compute_po_totals([_po_line(qty_ordered=2, rate=1000, gst_rate=18)], False)
    assert out["subtotal"] == 2000
    assert out["cgst"] == 180
    assert out["sgst"] == 180
    assert out["igst"] == 0
    assert out["total"] == 2360


def test_interstate_is_igst_only():
    out = compute_po_totals([_po_line(qty_ordered=1, rate=1000, gst_rate=18)], True)
    assert (out["cgst"], out["sgst"], out["igst"]) == (0, 0, 180)
    assert out["total"] == 1180


def test_line_discount_applies_before_gst():
    out = compute_po_totals(
        [_po_line(qty_ordered=1, rate=1000, gst_rate=18, discount_pct=10)], False)
    assert out["subtotal"] == 900
    assert out["cgst"] == 81
    assert out["sgst"] == 81


@pytest.mark.parametrize("qty,rate,gst,disc", [
    (1, 1000, 18, 0), (3, 333.33, 12, 0), (7, 1499.99, 5, 7.5),
    (2, 0.01, 28, 0), (10, 4567.89, 18, 33.33), (1, 999999.99, 18, 0),
])
@pytest.mark.parametrize("is_igst", [True, False])
def test_po_rounds_exactly_as_the_invoice_does(qty, rate, gst, disc, is_igst):
    """THE ONE THAT KEEPS THE THREE-WAY MATCH HONEST.

    A PO and the vendor bill raised against it are compared rupee for rupee. If
    the PO rounds even one line differently from the way `ganit._compute_invoice`
    rounds the bill, EVERY matched order reports a discrepancy. Asserted against
    the invoice function itself, so the two cannot drift.
    """
    invoice = _compute_invoice(
        [LineItem(description="x", quantity=qty, rate=rate, gst_rate=gst,
                  discount_pct=disc)],
        is_igst=is_igst)
    po = compute_po_totals(
        [_po_line(qty_ordered=qty, rate=rate, gst_rate=gst, discount_pct=disc)],
        is_igst)
    for key in ("subtotal", "cgst", "sgst", "igst"):
        assert po[key] == invoice[key], key
    assert po["total"] == invoice["total"]


def test_totals_of_an_empty_order_are_zero_not_an_error():
    """A draft with no lines is the first thing every form posts."""
    out = compute_po_totals([], False)
    assert out["total"] == 0 and out["lines"] == []


def test_a_line_with_junk_numbers_does_not_explode():
    """A number field arriving as an empty string is a form, not an attack."""
    out = compute_po_totals([_po_line(qty_ordered="", rate=None, gst_rate="abc")], False)
    assert out["total"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# 2 · Place of supply — and the rule that keeps regressing
# ══════════════════════════════════════════════════════════════════════════════

def test_same_state_is_cgst_sgst():
    assert derive_is_igst("27", "27AAAAA0000A1Z5") == (False, "27")


def test_different_state_is_igst():
    assert derive_is_igst("27", "24AAAAA0000A1Z5") == (True, "24")


def test_a_vendor_without_a_gstin_blocks_nothing():
    """GSTIN IS NOT MANDATORY AND MUST BLOCK NOTHING.

    This has drifted back more than once. An unregistered supplier is legal,
    common and must be orderable: the caller's answer is returned unchanged and
    no place of supply is claimed. It must never raise.
    """
    assert derive_is_igst("27", None, fallback=True) == (True, None)
    assert derive_is_igst("27", "", fallback=False) == (False, None)
    assert derive_is_igst("27", "not-a-gstin") == (False, None)


def test_an_org_without_a_state_code_still_reports_the_place_of_supply():
    """Half an answer beats none: we know where they are, not what the split is."""
    assert derive_is_igst(None, "24AAAAA0000A1Z5") == (False, "24")


# ══════════════════════════════════════════════════════════════════════════════
# 3 · Settings
# ══════════════════════════════════════════════════════════════════════════════

def test_no_settings_at_all_means_no_approval():
    """An org that configures nothing gets a module that never asks permission."""
    s = sanitise_settings(None)
    assert s["approval_required"] is False
    assert s["rules"] == []
    assert match_rule(s, 10_000_000) is None


@pytest.mark.parametrize("junk", ["", "not json", "[]", 7, {"rules": "nope"},
                                  {"approval_required": "yes please"}])
def test_malformed_settings_never_raise(junk):
    """This runs on the read path of every write. It must not be able to stop a
    firm raising a purchase order."""
    out = sanitise_settings(junk)
    assert isinstance(out, dict) and "rules" in out


def test_a_rule_naming_nobody_is_dropped():
    """It could never be satisfied, so an order matching it would freeze at
    awaiting_approval for ever."""
    s = sanitise_settings({"approval_required": True,
                           "rules": [{"min_amount": 1, "approver_ids": []}]})
    assert s["rules"] == []


def test_approvers_required_cannot_exceed_the_people_named():
    s = sanitise_settings({"approval_required": True, "rules": [
        {"min_amount": 0, "approver_ids": ["a"], "approvers_required": 3}]})
    assert s["rules"][0]["approvers_required"] == 1


def test_close_reasons_fall_back_to_the_starter_list():
    assert sanitise_settings({})["close_reasons"] == list(DEFAULT_CLOSE_REASONS)


@pytest.mark.parametrize("raw,expected", [
    ("po", "PO"), ("  aekam ", "AEKAM"), ("PO-1", "PO"), ("P", "PO"),
    ("ABCDEFGHI", "PO"), (None, "PO"), ("", "PO"),
])
def test_prefix_is_letters_only_two_to_eight(raw, expected):
    """THE VALUE REACHES A DOCUMENT SERIAL. A hyphen or a digit makes
    PREFIX-YYYY-NNNN unreadable by its own reader."""
    assert clean_prefix(raw) == expected


# ══════════════════════════════════════════════════════════════════════════════
# 4 · The approval rules
# ══════════════════════════════════════════════════════════════════════════════

def _settings(**kw):
    base = {"approval_required": True, "rules": [], "self_approval": False}
    base.update(kw)
    return sanitise_settings(base)


def _rule(**kw):
    r = {"name": "R", "min_amount": 0, "department": "", "category": "",
         "approver_ids": ["u1"], "approvers_required": 1, "sequential": False}
    r.update(kw)
    return r


def test_approval_off_means_no_rule_ever_matches():
    s = sanitise_settings({"approval_required": False,
                           "rules": [_rule(min_amount=0)]})
    assert match_rule(s, 10_000_000) is None


def test_first_match_wins():
    s = _settings(rules=[
        _rule(name="Audit big", min_amount=200000, department="Audit",
              approver_ids=["p1", "p2"], approvers_required=2),
        _rule(name="Anything big", min_amount=100000, approver_ids=["p3"]),
    ])
    assert match_rule(s, 300000, department="Audit")["name"] == "Audit big"
    # Same amount, different department — the first rule's department does not
    # match, so the second decides.
    assert match_rule(s, 300000, department="Tax")["name"] == "Anything big"


def test_a_blank_department_on_a_rule_matches_every_department():
    s = _settings(rules=[_rule(min_amount=1000)])
    assert match_rule(s, 5000, department="anything") is not None


def test_department_matching_ignores_case_and_whitespace():
    """Departments are free text on the employee record. Recovering the common
    near-misses is the whole reason this is not an exact compare."""
    s = _settings(rules=[_rule(department="Audit")])
    assert match_rule(s, 1, department="  audit ") is not None


def test_below_the_threshold_no_rule_matches_and_that_means_no_approval():
    s = _settings(rules=[_rule(min_amount=100000)])
    assert match_rule(s, 99999) is None


def test_category_narrows_a_rule():
    s = _settings(rules=[_rule(category="Capex", approver_ids=["p1"])])
    assert match_rule(s, 1, category="Capex") is not None
    assert match_rule(s, 1, category="Opex") is None


# ── Who may press the button ─────────────────────────────────────────────────

def test_someone_not_named_may_not_approve():
    ok, why = may_approve(_settings(), _rule(approver_ids=["u1"]), "u9", "u5")
    assert ok is False and "not named" in why


def test_self_approval_is_refused_by_default():
    ok, why = may_approve(_settings(), _rule(approver_ids=["u1"]), "u1", "u1")
    assert ok is False and "self-approval" in why


def test_self_approval_is_allowed_when_the_org_says_so():
    ok, _ = may_approve(_settings(self_approval=True),
                        _rule(approver_ids=["u1"]), "u1", "u1")
    assert ok is True


def test_a_second_click_is_not_a_second_approver():
    ok, why = may_approve(_settings(), _rule(approver_ids=["u1", "u2"]),
                          "u1", "u9", already_decided=["u1"])
    assert ok is False and "already recorded" in why


def test_a_sequential_rule_refuses_the_wrong_turn():
    rule = _rule(approver_ids=["u1", "u2"], approvers_required=2, sequential=True)
    ok, why = may_approve(_settings(), rule, "u2", "u9")
    assert ok is False and "not your turn" in why
    ok, _ = may_approve(_settings(), rule, "u1", "u9")
    assert ok is True
    # u1 has decided; now it is u2's turn.
    ok, _ = may_approve(_settings(), rule, "u2", "u9", already_decided=["u1"])
    assert ok is True


def test_nobody_may_approve_an_order_that_needs_no_approval():
    ok, why = may_approve(_settings(), None, "u1", "u9")
    assert ok is False and "does not need approval" in why


def test_two_approver_rule_is_not_satisfied_by_one():
    rule = _rule(approver_ids=["u1", "u2"], approvers_required=2)
    assert approval_satisfied(rule, [{"approver_id": "u1", "decision": "approved"}]) is False
    assert approval_satisfied(rule, [
        {"approver_id": "u1", "decision": "approved"},
        {"approver_id": "u2", "decision": "approved"}]) is True


def test_an_approval_from_someone_outside_the_rule_does_not_count():
    """Otherwise a rule could be satisfied by a person it never named — and the
    settings screen would be describing an authorisation the product ignores."""
    rule = _rule(approver_ids=["u1"], approvers_required=1)
    assert approval_satisfied(rule, [{"approver_id": "stranger",
                                      "decision": "approved"}]) is False


def test_no_rule_is_satisfied_trivially():
    assert approval_satisfied(None, []) is True


# ── Re-approval on revision ──────────────────────────────────────────────────

def test_a_small_rise_flows_through():
    s = sanitise_settings({"reapproval_pct": 10, "reapproval_amount": 10000})
    assert needs_reapproval(s, 100000, 102000)[0] is False


def test_a_rise_past_the_percentage_goes_back():
    s = sanitise_settings({"reapproval_pct": 10, "reapproval_amount": 1000000})
    yes, why = needs_reapproval(s, 100000, 115000)
    assert yes is True and "%" in why


def test_a_rise_past_the_flat_amount_goes_back_even_when_the_percentage_is_small():
    """A 5% rise on a ₹50 lakh order is ₹2.5 lakh. Either test fires; that is
    why there are two."""
    s = sanitise_settings({"reapproval_pct": 10, "reapproval_amount": 10000})
    yes, why = needs_reapproval(s, 5000000, 5250000)
    assert yes is True and "₹" in why


def test_reducing_an_order_never_needs_fresh_approval():
    """Nobody has ever needed a second signature to spend less."""
    s = sanitise_settings({})
    assert needs_reapproval(s, 100000, 1)[0] is False
    assert needs_reapproval(s, 100000, 0)[0] is False


def test_an_order_that_had_no_value_and_now_does_goes_back():
    """The percentage test cannot express it — it is a division by zero — so it
    is stated separately rather than falling through as immaterial."""
    yes, why = needs_reapproval(sanitise_settings({}), 0, 500)
    assert yes is True and "no value" in why


# ══════════════════════════════════════════════════════════════════════════════
# 5 · Receiving
# ══════════════════════════════════════════════════════════════════════════════

def test_receiving_the_ordered_quantity_is_fine():
    assert receipt_allowed(sanitise_settings({}), 100, 40, 60)[0] is True


def test_over_receipt_is_refused_by_default():
    ok, why = receipt_allowed(sanitise_settings({}), 100, 100, 1)
    assert ok is False and "does not accept over-receipt" in why


def test_over_receipt_inside_a_tolerance_is_allowed_when_configured():
    s = sanitise_settings({"over_receipt": "allow", "over_receipt_tolerance_pct": 5})
    assert receipt_allowed(s, 100, 100, 5)[0] is True
    ok, why = receipt_allowed(s, 100, 100, 6)
    assert ok is False and "tolerance" in why


def test_a_return_is_a_negative_receipt_and_is_always_allowed():
    assert receipt_allowed(sanitise_settings({}), 100, 40, -10)[0] is True


def test_a_return_cannot_take_the_received_quantity_below_zero():
    ok, why = receipt_allowed(sanitise_settings({}), 100, 5, -10)
    assert ok is False and "Only 5" in why


def test_a_receipt_of_nothing_is_refused():
    ok, why = receipt_allowed(sanitise_settings({}), 100, 0, 0)
    assert ok is False and "must record a quantity" in why


@pytest.mark.parametrize("status", ["closed", "cancelled"])
def test_a_receipt_does_not_reopen_a_terminal_order(status):
    """A late delivery against an order the firm already decided not to wait for
    must not silently re-open the commitment it just discharged."""
    lines = [{"qty_ordered": 10, "qty_received": 10}]
    assert po_status_after_receipts(status, lines) == status


def test_partial_receipt_is_part_received():
    assert po_status_after_receipts(
        "issued", [{"qty_ordered": 10, "qty_received": 4}]) == "part_received"


def test_every_line_full_is_received():
    assert po_status_after_receipts("part_received", [
        {"qty_ordered": 10, "qty_received": 10},
        {"qty_ordered": 5, "qty_received": 5}]) == "received"


def test_one_short_line_keeps_the_order_part_received():
    assert po_status_after_receipts("issued", [
        {"qty_ordered": 10, "qty_received": 10},
        {"qty_ordered": 5, "qty_received": 4}]) == "part_received"


def test_over_delivery_on_every_line_is_still_fully_received():
    """`>=`, not `==`. With over-receipt allowed a line can land above its
    ordered quantity, and such an order is not "partly" received."""
    assert po_status_after_receipts(
        "issued", [{"qty_ordered": 10, "qty_received": 11}]) == "received"


# ══════════════════════════════════════════════════════════════════════════════
# 6 · The revision diff
# ══════════════════════════════════════════════════════════════════════════════

def test_an_unchanged_order_produces_an_empty_diff():
    """A PATCH that changes nothing must not mint a revision, or the history
    stops meaning anything."""
    before = {"notes": "a", "expected_date": date(2026, 1, 1)}
    lines = [{"line_no": 1, "description": "x", "qty_ordered": 1, "rate": 10}]
    assert build_diff(before, dict(before), lines, list(lines)) == {}


def test_a_header_change_is_recorded_from_and_to():
    diff = build_diff({"notes": "a"}, {"notes": "b"}, [], [])
    assert diff["notes"] == {"from": "a", "to": "b"}


def test_a_field_the_patch_did_not_send_is_not_a_change():
    diff = build_diff({"notes": "a", "terms": "t"}, {"notes": "a"}, [], [])
    assert diff == {}


def test_line_changes_are_reported_by_position():
    before = [{"line_no": 1, "description": "x", "qty_ordered": 10, "rate": 5}]
    after = [{"line_no": 1, "description": "x", "qty_ordered": 12, "rate": 5}]
    diff = build_diff({}, {}, before, after)
    assert diff["lines"][0]["change"] == "changed"
    assert diff["lines"][0]["fields"]["qty_ordered"] == {"from": 10, "to": 12}


def test_added_and_removed_lines_are_named_as_such():
    before = [{"line_no": 1, "description": "x"}, {"line_no": 2, "description": "y"}]
    after = [{"line_no": 1, "description": "x"}, {"line_no": 3, "description": "z"}]
    changes = {c["line_no"]: c["change"] for c in build_diff({}, {}, before, after)["lines"]}
    assert changes == {2: "removed", 3: "added"}


# ══════════════════════════════════════════════════════════════════════════════
# 7 · The three-way match
# ══════════════════════════════════════════════════════════════════════════════

def _line(no, **kw):
    base = {"line_no": no, "description": f"line{no}", "unit": "NOS",
            "qty_ordered": 10, "qty_received": 10, "qty_billed": 10, "rate": 100}
    base.update(kw)
    return base


def test_a_clean_order_matches():
    out = three_way_match({"total": 1000}, [_line(1)], [{"total": 1000}])
    assert out["matched"] is True and out["exceptions"] == []


def test_billed_more_than_received_is_the_high_severity_exception():
    """The one worth real money — a vendor charging for goods that never came."""
    out = three_way_match({"total": 1000}, [_line(1, qty_received=6, qty_billed=10)],
                          [{"total": 1000}])
    kinds = [e["kind"] for e in out["exceptions"]]
    assert "billed_not_received" in kinds
    assert out["exceptions"][0]["severity"] == "high"


def test_received_more_than_billed_is_an_accrual_not_a_fault():
    out = three_way_match({"total": 1000}, [_line(1, qty_received=10, qty_billed=4)],
                          [{"total": 1000}])
    e = out["exceptions"][0]
    assert e["kind"] == "received_not_invoiced" and e["severity"] == "info"


def test_bills_totalling_more_than_the_order_is_flagged():
    out = three_way_match({"total": 1000}, [_line(1)], [{"total": 1500}])
    assert any(e["kind"] == "billed_over_ordered" for e in out["exceptions"])


def test_a_rupee_of_rounding_is_not_a_discrepancy():
    """Flagging the half-paisa that round(gst/2, 2) introduces is how an
    exception list gets ignored."""
    out = three_way_match({"total": 1000}, [_line(1)], [{"total": 1000.5}])
    assert not any(e["kind"] == "billed_over_ordered" for e in out["exceptions"])


def test_nothing_is_ever_auto_approved():
    """Automatically approving a bill because it matches is a decision to make
    after somebody has watched the match be right for months."""
    out = three_way_match({"total": 1000}, [_line(1)], [{"total": 1000}])
    assert "approved" not in json.dumps(out)


def test_bill_lines_match_po_lines_by_product_then_description():
    po_lines = [{"line_no": 1, "product_id": "p-1", "description": "Widget"},
                {"line_no": 2, "product_id": "", "description": "Freight"}]
    billed = bill_qty_by_line(po_lines, [
        {"product_id": "p-1", "quantity": 4},
        {"product_id": "", "description": "  freight ", "quantity": 1},
        {"product_id": "", "description": "Something else", "quantity": 99},
    ])
    assert billed == {1: 4.0, 2: 1.0}


def test_the_match_states_how_much_to_trust_its_line_half():
    out = three_way_match({"total": 0}, [], [])
    assert "matched to bill lines by product" in out["basis"]


# ══════════════════════════════════════════════════════════════════════════════
# 8 · Budgets and 194Q
# ══════════════════════════════════════════════════════════════════════════════

def test_budgets_are_off_by_default_and_report_nothing():
    assert budget_state(sanitise_settings({}), {"Audit": 100}) == []


def test_a_budget_reports_alert_and_over():
    s = sanitise_settings({"budgets_enabled": True, "budgets": [
        {"department": "Audit", "limit": 100000, "alert_pct": 80},
        {"department": "Tax", "limit": 100000, "alert_pct": 80}]})
    state = {b["department"]: b for b in budget_state(s, {"Audit": 85000, "Tax": 120000})}
    assert state["Audit"]["state"] == "alert"
    assert state["Tax"]["state"] == "over"
    assert state["Tax"]["remaining"] == -20000


def test_a_budget_matches_a_department_that_differs_only_in_case_or_spacing():
    s = sanitise_settings({"budgets_enabled": True,
                           "budgets": [{"department": "Audit", "limit": 100}]})
    assert budget_state(s, {"  audit ": 50})[0]["committed"] == 50


def test_194q_warns_before_the_threshold_is_crossed():
    """The whole point: a firm that has ordered ₹20 lakh from a vendor it has
    already paid ₹40 lakh has crossed the line and will not find out from its
    bills for another month."""
    row = tds_194q_row("Acme", 4_000_000, 2_000_000)
    assert row["crossed"] is False
    assert row["will_cross_on_current_orders"] is True
    assert row["projected"] == 6_000_000


def test_194q_is_computed_on_the_gross_and_says_so():
    row = tds_194q_row("Acme", 6_000_000, 0)
    assert row["indicative_tds"] == round((6_000_000 - TDS_194Q_THRESHOLD) * 0.001, 2)
    assert "INCLUDING GST" in row["basis"]


def test_194q_below_the_threshold_deducts_nothing():
    assert tds_194q_row("Acme", 100, 0)["indicative_tds"] == 0


# ══════════════════════════════════════════════════════════════════════════════
# 9 · The allocator
# ══════════════════════════════════════════════════════════════════════════════

def _numbering_pool(numbers):
    pool = MagicMock()
    conn = MagicMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=conn)
    conn.execute = AsyncMock()
    conn.fetch = AsyncMock(return_value=[{"po_number": n} for n in numbers])
    pool.acquire = MagicMock(return_value=conn)
    return pool, conn


@pytest.mark.anyio
async def test_the_first_order_of_the_year_is_0001():
    pool, _ = _numbering_pool([])
    assert (await next_po_number(pool, ORG, "PO")).endswith("-0001")


@pytest.mark.anyio
async def test_the_series_continues_from_the_highest_number_not_the_newest_row():
    """`utils.next_doc_number` reads the newest row, which is right for a table
    where the number is assigned at insert. Here it is assigned at ISSUE, so the
    newest row and the highest number are routinely different rows."""
    year = date.today().year
    pool, _ = _numbering_pool([f"PO-{year}-0007", f"PO-{year}-0003"])
    assert await next_po_number(pool, ORG, "PO") == f"PO-{year}-0008"


@pytest.mark.anyio
async def test_a_draft_carrying_no_number_cannot_restart_the_series():
    """THE REASON THIS IS NOT `next_doc_number`. Every draft carries NULL, so
    the newest row is very often a draft — and the series would restart at 0001
    and collide with an order issued last week."""
    year = date.today().year
    pool, conn = _numbering_pool([f"PO-{year}-0009"])
    # The query itself excludes NULLs; assert that it does, rather than only
    # asserting the answer.
    await next_po_number(pool, ORG, "PO")
    assert "po_number IS NOT NULL" in conn.fetch.call_args[0][0]


@pytest.mark.anyio
async def test_last_years_numbers_do_not_raise_this_years_counter():
    pool, _ = _numbering_pool(["PO-2019-0099"])
    assert (await next_po_number(pool, ORG, "PO")).endswith("-0001")


@pytest.mark.anyio
async def test_the_advisory_lock_is_taken_inside_the_transaction():
    """It is released at the end of the transaction that took it. In autocommit
    a bare execute is its own transaction, so the lock would be gone before the
    SELECT it exists to protect ever ran."""
    pool, conn = _numbering_pool([])
    await next_po_number(pool, ORG, "PO")
    conn.transaction.assert_called()
    assert "pg_advisory_xact_lock" in conn.execute.call_args[0][0]


# ══════════════════════════════════════════════════════════════════════════════
# 10 · The routes
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def po_app():
    """The router on its own app.

    It is not registered in `server.py` yet — that is one line for the owner —
    and a test that depended on registration would fail for a reason that has
    nothing to do with the code it tests.
    """
    app = FastAPI()
    app.include_router(procurement.router)
    return app


@pytest.fixture
def caller():
    return {"user_id": "user_admin001", "email": "admin@test.com",
            "name": "Test Admin", "full_name": "Test Admin", "role": "admin"}


@pytest.fixture
def wired(po_app, caller, mock_pool):
    from auth_router import require_user
    from middleware.org_resolver import get_org_id
    po_app.dependency_overrides[require_user] = lambda: caller
    po_app.dependency_overrides[get_org_id] = lambda: ORG
    po_app.dependency_overrides[procurement._gate] = lambda: None

    # `require_org_role` is not a dependency object this test can name — it is
    # built inline in the route signature — so it is satisfied the way it is in
    # production: by answering its two queries. Routed on SQL TEXT, which is
    # what tells the org-scoped question apart from the platform one.
    async def _fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return None
        if "staging.user_roles" in query and "org_id=$2::uuid" in query:
            return "org_owner"
        if "settings->'purchase_orders'" in query:
            return None
        if "doc_prefixes" in query:
            return None
        if "state_code" in query:
            return "27"
        return None

    mock_pool.fetchval.side_effect = _fetchval
    return mock_pool


@pytest.fixture
async def po_client(po_app, wired):
    async with AsyncClient(transport=ASGITransport(app=po_app),
                           base_url="http://test") as client:
        yield client


def _po_row(**kw):
    row = {
        "id": PO_ID, "org_id": ORG, "vendor_id": VENDOR_ID, "po_number": None,
        "revision": 0, "status": "draft", "po_date": date(2026, 8, 1),
        "expected_date": None, "department": None, "category": None,
        "currency": "INR", "place_of_supply": None, "is_igst": False,
        "subtotal": 1000, "cgst": 90, "sgst": 90, "igst": 0, "total": 1180,
        "terms": None, "delivery_address": {}, "notes": None,
        "approval_required": False, "approvers_required": 0,
        "approval_rule": None, "created_by": "user_admin001",
        "issued_at": None, "closed_at": None, "closed_by": None,
        "closed_reason": None, "is_active": True,
        "vendor_name": "Acme Supplies", "vendor_gstin": "27AAAAA0000A1Z5",
        "vendor_email": None, "vendor_phone": None,
    }
    row.update(kw)
    return row


@pytest.mark.anyio
async def test_a_purchase_order_in_another_org_is_a_404_not_a_403(po_client, wired):
    """A 403 confirms the id is real. org_id is in the WHERE clause, so "not
    yours" and "not there" are indistinguishable."""
    wired.fetchrow.return_value = None
    r = await po_client.get(f"/api/v1/procurement/purchase-orders/{PO_ID}")
    assert r.status_code == 404


@pytest.mark.anyio
async def test_every_list_query_is_scoped_to_the_caller_org(po_client, wired):
    r = await po_client.get("/api/v1/procurement/purchase-orders")
    assert r.status_code == 200
    sql, *params = wired.fetch.call_args[0]
    assert "po.org_id = $1::uuid" in sql
    assert params[0] == ORG


@pytest.mark.anyio
async def test_an_unknown_sort_key_falls_back_and_never_reaches_the_sql(po_client, wired):
    """`sort` is concatenated into ORDER BY because a bind parameter cannot
    carry an identifier. The allowlist is the whole defence."""
    r = await po_client.get(
        "/api/v1/procurement/purchase-orders?sort=total;DROP TABLE x&direction=--")
    assert r.status_code == 200
    sql = wired.fetch.call_args[0][0]
    assert "DROP TABLE" not in sql
    assert "ORDER BY po.created_at DESC" in sql


@pytest.mark.anyio
async def test_creating_an_order_refuses_an_unknown_vendor(po_client, wired):
    wired.fetchrow.return_value = None
    r = await po_client.post("/api/v1/procurement/purchase-orders",
                             json={"vendor_id": VENDOR_ID, "line_items": []})
    assert r.status_code == 404
    assert "Vendor" in r.json()["detail"]


@pytest.mark.anyio
async def test_a_bad_date_is_a_400_about_the_request(po_client, wired):
    wired.fetchrow.return_value = {"id": VENDOR_ID, "name": "Acme", "gstin": None}
    r = await po_client.post(
        "/api/v1/procurement/purchase-orders",
        json={"vendor_id": VENDOR_ID, "po_date": "01-08-2026", "line_items": []})
    assert r.status_code == 400
    assert "not a date" in r.json()["detail"]


@pytest.mark.anyio
async def test_a_product_from_another_org_cannot_be_put_on_a_line(po_client, wired):
    """ONE CATALOGUE. A product id from a request body is user input, and a
    foreign key alone would let one org put another's catalogue row on its
    order."""
    wired.fetchrow.return_value = {"id": VENDOR_ID, "name": "Acme", "gstin": None}
    wired.fetch.return_value = []          # the catalogue lookup finds nothing
    r = await po_client.post("/api/v1/procurement/purchase-orders", json={
        "vendor_id": VENDOR_ID,
        "line_items": [{"product_id": "55555555-5555-5555-5555-555555555555",
                        "description": "x", "qty_ordered": 1, "rate": 10}]})
    assert r.status_code == 400
    assert "catalogue" in r.json()["detail"]


@pytest.mark.anyio
async def test_a_draft_cannot_be_received_against(po_client, wired):
    wired.fetchrow.return_value = _po_row(status="draft")
    r = await po_client.post(
        f"/api/v1/procurement/purchase-orders/{PO_ID}/receipts",
        json={"po_line_id": LINE_ID, "qty": 1})
    assert r.status_code == 409
    assert "issued first" in r.json()["detail"]


@pytest.mark.anyio
async def test_an_issued_order_cannot_be_discarded(po_client, wired):
    """It has been sent to a supplier. That is not a mistake deleting the record
    un-makes."""
    wired.fetchrow.return_value = _po_row(status="issued", po_number="PO-2026-0001")
    r = await po_client.delete(f"/api/v1/procurement/purchase-orders/{PO_ID}")
    assert r.status_code == 409


@pytest.mark.anyio
async def test_a_draft_cannot_be_closed_short(po_client, wired):
    wired.fetchrow.return_value = _po_row(status="draft")
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/close",
                             json={"reason": DEFAULT_CLOSE_REASONS[0]})
    assert r.status_code == 409
    assert "Discard it instead" in r.json()["detail"]


@pytest.mark.anyio
async def test_closing_short_refuses_a_reason_outside_the_firms_list(po_client, wired):
    """The list is what makes the reason something a report can group by."""
    wired.fetchrow.return_value = _po_row(status="part_received",
                                          po_number="PO-2026-0001")
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/close",
                             json={"reason": "because I said so"})
    assert r.status_code == 400
    assert "list" in r.json()["detail"]


@pytest.mark.anyio
async def test_a_closed_order_cannot_be_edited(po_client, wired):
    wired.fetchrow.return_value = _po_row(status="closed")
    r = await po_client.patch(f"/api/v1/procurement/purchase-orders/{PO_ID}",
                              json={"notes": "changed"})
    assert r.status_code == 409


@pytest.mark.anyio
async def test_approving_something_not_awaiting_approval_is_refused(po_client, wired):
    wired.fetchrow.return_value = _po_row(status="issued", po_number="PO-2026-0001")
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/approve",
                             json={"note": ""})
    assert r.status_code == 409
    assert "not awaiting a decision" in r.json()["detail"]


@pytest.mark.anyio
async def test_someone_not_named_by_the_rule_is_refused_with_403(po_client, wired):
    wired.fetchrow.return_value = _po_row(
        status="awaiting_approval", approval_required=True, approvers_required=1,
        approval_rule=json.dumps(_rule(approver_ids=["someone_else"])),
        created_by="another_person")
    wired.fetch.return_value = []
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/approve",
                             json={"note": ""})
    assert r.status_code == 403
    assert "not named" in r.json()["detail"]


@pytest.mark.anyio
async def test_the_author_cannot_approve_their_own_order(po_client, wired):
    wired.fetchrow.return_value = _po_row(
        status="awaiting_approval", approval_required=True, approvers_required=1,
        approval_rule=json.dumps(_rule(approver_ids=["user_admin001"])),
        created_by="user_admin001")
    wired.fetch.return_value = []
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/approve",
                             json={"note": ""})
    assert r.status_code == 403
    assert "self-approval" in r.json()["detail"]


@pytest.mark.anyio
async def test_an_order_awaiting_approval_cannot_be_issued_early(po_client, wired):
    wired.fetchrow.return_value = _po_row(
        status="awaiting_approval", approval_required=True, approvers_required=2,
        approval_rule=json.dumps(_rule(approver_ids=["u1", "u2"],
                                       approvers_required=2)))
    wired.fetch.return_value = [{"approver_id": "u1", "decision": "approved"}]
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/issue")
    assert r.status_code == 409
    assert "1 of 2" in r.json()["detail"]


@pytest.mark.anyio
async def test_submitting_an_order_with_no_lines_is_refused(po_client, wired):
    wired.fetchrow.return_value = _po_row(status="draft")
    wired.fetch.return_value = []
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/submit")
    assert r.status_code == 400
    assert "at least one line" in r.json()["detail"]


@pytest.mark.anyio
async def test_a_bill_cannot_be_linked_to_another_suppliers_order(po_client, wired):
    """It would make the three-way match wrong on both documents."""
    rows = [
        {"id": BILL_ID, "vendor_id": "99999999-9999-9999-9999-999999999999",
         "po_id": None},
        _po_row(status="issued", po_number="PO-2026-0001"),
    ]
    wired.fetchrow.side_effect = rows
    r = await po_client.post(f"/api/v1/procurement/vendor-bills/{BILL_ID}/link",
                             json={"po_id": PO_ID})
    assert r.status_code == 400
    assert "different supplier" in r.json()["detail"]


@pytest.mark.anyio
async def test_a_bill_can_always_be_unlinked(po_client, wired):
    """A bill without a PO stays legal, so unlinking is a first-class operation
    rather than an undo."""
    wired.fetchrow.return_value = {"id": BILL_ID, "vendor_id": VENDOR_ID,
                                   "po_id": PO_ID}
    r = await po_client.post(f"/api/v1/procurement/vendor-bills/{BILL_ID}/link",
                             json={"po_id": None})
    assert r.status_code == 200 and r.json()["status"] == "unlinked"


@pytest.mark.anyio
async def test_a_bill_cannot_be_linked_to_a_draft(po_client, wired):
    wired.fetchrow.side_effect = [
        {"id": BILL_ID, "vendor_id": VENDOR_ID, "po_id": None},
        _po_row(status="draft"),
    ]
    r = await po_client.post(f"/api/v1/procurement/vendor-bills/{BILL_ID}/link",
                             json={"po_id": PO_ID})
    assert r.status_code == 400
    assert "not been issued" in r.json()["detail"]


@pytest.mark.anyio
async def test_settings_refuse_a_rule_naming_a_non_member(po_client, wired):
    wired.fetch.return_value = [{"user_id": "user_admin001"}]
    r = await po_client.put("/api/v1/procurement/settings", json={
        "approval_required": True,
        "rules": [{"min_amount": 0, "approver_ids": ["a_stranger"]}]})
    assert r.status_code == 400
    assert "not members" in r.json()["detail"]


@pytest.mark.anyio
async def test_settings_refuse_a_rule_naming_nobody(po_client, wired):
    wired.fetch.return_value = [{"user_id": "user_admin001"}]
    r = await po_client.put("/api/v1/procurement/settings", json={
        "approval_required": True, "rules": [{"min_amount": 0, "approver_ids": []}]})
    assert r.status_code == 400
    assert "could never be approved" in r.json()["detail"]


@pytest.mark.anyio
async def test_settings_refuse_a_prefix_that_would_break_the_serial(po_client, wired):
    r = await po_client.put("/api/v1/procurement/settings", json={"prefix": "PO-1"})
    assert r.status_code == 400
    assert "PREFIX-YYYY-NNNN" in r.json()["detail"]


@pytest.mark.anyio
async def test_settings_refuse_an_unknown_receiving_mode(po_client, wired):
    r = await po_client.put("/api/v1/procurement/settings",
                            json={"over_receipt": "whatever"})
    assert r.status_code == 400


@pytest.mark.anyio
async def test_settings_read_survives_a_malformed_blob(po_client, wired):
    """A settings column that is not an object must not 500 the whole module."""
    async def _fetchval(query, *args):
        if "settings->'purchase_orders'" in query:
            return "not json at all"
        return None
    wired.fetchval.side_effect = _fetchval
    r = await po_client.get("/api/v1/procurement/settings")
    assert r.status_code == 200
    assert r.json()["data"]["approval_required"] is False


@pytest.mark.anyio
async def test_the_approver_picker_never_returns_an_email_address(po_client, wired):
    """Aekam must not see a customer's member emails, and a picker does not
    need one."""
    wired.fetch.return_value = [
        {"user_id": "u1", "full_name": "Asha Rao", "role_code": "org_admin"}]
    r = await po_client.get("/api/v1/procurement/approver-candidates")
    assert r.status_code == 200
    assert "email" not in json.dumps(r.json())


@pytest.mark.anyio
async def test_committed_spend_excludes_closed_orders(po_client, wired):
    """Closed short or fully billed, the commitment is discharged. Leaving them
    in is exactly how the figure becomes permanently wrong."""
    wired.fetch.return_value = []
    r = await po_client.get("/api/v1/procurement/reports/committed-spend")
    assert r.status_code == 200
    statuses = wired.fetch.call_args[0][2]
    assert "closed" not in statuses and "issued" in statuses


@pytest.mark.anyio
async def test_late_suppliers_carries_a_phone_number(po_client, wired):
    """The point of knowing a supplier is nine days late is being able to ring
    them."""
    wired.fetch.return_value = []
    r = await po_client.get("/api/v1/procurement/reports/late-suppliers")
    assert r.status_code == 200
    assert "vendor_phone" in wired.fetch.call_args[0][0]


@pytest.mark.anyio
async def test_an_order_with_no_expected_date_is_not_late(po_client, wired):
    """Undated is a different thing from late, and reporting it as late trains
    the firm to ignore the list."""
    wired.fetch.return_value = []
    await po_client.get("/api/v1/procurement/reports/late-suppliers")
    assert "expected_date IS NOT NULL" in wired.fetch.call_args[0][0]


@pytest.mark.anyio
async def test_194q_never_asserts_that_the_deduction_applies(po_client, wired):
    """Whether a firm deducts at all turns on its own turnover excluding GST —
    a figure this product does not hold."""
    wired.fetch.return_value = []
    r = await po_client.get("/api/v1/procurement/reports/tds-194q")
    assert r.status_code == 200
    assert "does not hold" in r.json()["note"]


@pytest.mark.anyio
async def test_the_budget_report_ships_its_caveat(po_client, wired):
    wired.fetch.return_value = []
    r = await po_client.get("/api/v1/procurement/reports/budget")
    assert r.status_code == 200
    assert "free text" in r.json()["caveat"]


# ── The happy paths ──────────────────────────────────────────────────────────
#
# The refusals above prove the guards. These prove the WRITES, which the
# refusals never reach: every INSERT and UPDATE in this module is assembled by
# hand from a request body, and a mis-cast parameter or a stale column name is
# an instant 500 no refusal test can see. The statements were also PREPAREd
# against the live catalog before this landed — a mock pool hides bad SQL, and
# these tests would pass over a query the database rejects.


@pytest.mark.anyio
async def test_creating_an_order_writes_a_draft_with_no_number(po_client, wired):
    """A serial spent on a draft is a gap in the series."""
    created = _po_row(status="draft", po_number=None)
    wired.fetchrow.side_effect = [
        {"id": VENDOR_ID, "name": "Acme", "gstin": "24AAAAA0000A1Z5"},  # vendor
        created,                                                        # INSERT
    ]
    wired.fetch.return_value = []
    r = await po_client.post("/api/v1/procurement/purchase-orders", json={
        "vendor_id": VENDOR_ID, "expected_date": "2026-09-01",
        "line_items": [{"description": "A4 paper", "qty_ordered": 10,
                        "rate": 250, "gst_rate": 12}]})
    assert r.status_code == 200
    assert r.json()["data"]["po_number"] is None


@pytest.mark.anyio
async def test_the_tax_split_is_derived_from_the_suppliers_state(po_client, wired):
    """Vendor GSTIN starts 24, the org is 27 — inter-state, so IGST.

    If the PO decides this differently from the way the invoice decides it, the
    three-way match fails on tax alone, before a single quantity is compared.
    """
    wired.fetchrow.side_effect = [
        {"id": VENDOR_ID, "name": "Acme", "gstin": "24AAAAA0000A1Z5"},
        _po_row(),
    ]
    wired.fetch.return_value = []
    await po_client.post("/api/v1/procurement/purchase-orders", json={
        "vendor_id": VENDOR_ID, "is_igst": False,
        "line_items": [{"description": "x", "qty_ordered": 1, "rate": 100,
                        "gst_rate": 18}]})
    insert = next(c for c in wired.acquire().fetchrow.call_args_list
                  if "INSERT INTO staging.ganit_purchase_orders" in c[0][0])
    args = insert[0]
    assert args[9] is True                      # is_igst, derived not taken
    assert args[8] == "24"                      # place of supply
    assert args[13] == 18.0 and args[11] == 0   # igst carried it, cgst did not


@pytest.mark.anyio
async def test_submitting_with_no_matching_rule_issues_immediately(po_client, wired):
    """The approval step is SKIPPED, not auto-approved: an approval record
    naming nobody is a lie about who agreed to the spend."""
    wired.fetchrow.side_effect = [
        _po_row(status="draft"),
        _po_row(status="issued", po_number="PO-2026-0001"),
    ]
    wired.fetch.return_value = [{"id": LINE_ID, "line_no": 1, "qty_ordered": 10,
                                 "qty_received": 0, "rate": 100, "unit": "NOS",
                                 "description": "x"}]
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/submit")
    assert r.status_code == 200
    assert r.json()["status"] == "issued"
    assert r.json()["po_number"] == "PO-2026-0001"


@pytest.mark.anyio
async def test_submitting_a_matching_order_waits_for_approval(po_client, wired):
    async def _fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            return None
        if "settings->'purchase_orders'" in query:
            return {"approval_required": True, "rules": [
                {"name": "Anything at all", "min_amount": 0,
                 "approver_ids": ["u1"], "approvers_required": 1}]}
        return None
    wired.fetchval.side_effect = _fetchval
    wired.fetchrow.side_effect = [_po_row(status="draft"),
                                  _po_row(status="awaiting_approval")]
    wired.fetch.return_value = [{"id": LINE_ID, "line_no": 1, "qty_ordered": 1,
                                 "qty_received": 0, "rate": 100, "unit": "NOS",
                                 "description": "x"}]
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/submit")
    assert r.status_code == 200
    assert r.json()["status"] == "awaiting_approval"
    assert r.json()["rule"] == "Anything at all"


@pytest.mark.anyio
async def test_a_receipt_writes_the_acceptance_date_on_the_linked_bill(po_client, wired):
    """`ganit_vendor_bills.acceptance_date` feeds a STATUTORY deadline.

    The PO writes that column rather than keeping a second idea of "received
    on" beside it — and only where it is empty, because a date entered by hand
    is somebody's considered answer that a delivery note may not overwrite.
    """
    wired.fetchrow.side_effect = [
        _po_row(status="issued", po_number="PO-2026-0001"),
        {"id": "rc-1", "po_line_id": LINE_ID, "qty": 4},
    ]
    wired.fetch.return_value = [{"id": LINE_ID, "line_no": 1, "qty_ordered": 10,
                                 "qty_received": 0, "rate": 100, "unit": "NOS",
                                 "description": "x"}]
    conn = wired.acquire()
    conn.fetchval.side_effect = [date(2026, 8, 20), 1]
    r = await po_client.post(
        f"/api/v1/procurement/purchase-orders/{PO_ID}/receipts",
        json={"po_line_id": LINE_ID, "qty": 4})
    assert r.status_code == 200
    assert r.json()["status"] == "part_received"
    assert r.json()["acceptance_dates_written"] == 1
    stamp = next(c for c in conn.fetchval.call_args_list
                 if "acceptance_date" in c[0][0])
    assert "acceptance_date IS NULL" in stamp[0][0]


@pytest.mark.anyio
async def test_closing_short_records_the_reason_from_the_list(po_client, wired):
    wired.fetchrow.side_effect = [
        _po_row(status="part_received", po_number="PO-2026-0001"),
        _po_row(status="closed", po_number="PO-2026-0001",
                closed_reason=DEFAULT_CLOSE_REASONS[0]),
    ]
    r = await po_client.post(f"/api/v1/procurement/purchase-orders/{PO_ID}/close",
                             json={"reason": DEFAULT_CLOSE_REASONS[0]})
    assert r.status_code == 200
    assert r.json()["data"]["closed_reason"] == DEFAULT_CLOSE_REASONS[0]


@pytest.mark.anyio
async def test_a_patch_that_changes_nothing_mints_no_revision(po_client, wired):
    """Every accidental save would otherwise inflate the revision number until
    the history stopped meaning anything."""
    wired.fetchrow.return_value = _po_row(status="issued",
                                          po_number="PO-2026-0001", notes=None)
    wired.fetch.return_value = []
    r = await po_client.patch(f"/api/v1/procurement/purchase-orders/{PO_ID}",
                              json={"notes": ""})
    assert r.status_code == 200
    assert r.json()["changed"] is False
    conn = wired.acquire()
    assert not any("ganit_po_revisions" in c[0][0]
                   for c in conn.execute.call_args_list)


@pytest.mark.anyio
async def test_editing_an_issued_order_mints_a_revision_and_keeps_the_original(
        po_client, wired):
    """"Can I edit a PO after it has been approved?" — yes, AS A REVISION. The
    previous state is snapshotted whole; the original is never destroyed."""
    before = _po_row(status="issued", po_number="PO-2026-0001", notes="original")
    wired.fetchrow.side_effect = [before, {**before, "notes": "changed"}]
    wired.fetch.return_value = []
    r = await po_client.patch(f"/api/v1/procurement/purchase-orders/{PO_ID}",
                              json={"notes": "changed", "reason": "supplier asked"})
    assert r.status_code == 200
    assert r.json()["changed"] is True
    assert r.json()["revision"] == 1
    assert r.json()["diff"]["notes"] == {"from": "original", "to": "changed"}
    conn = wired.acquire()
    rev = next(c for c in conn.execute.call_args_list
               if "ganit_po_revisions" in c[0][0])
    snapshot = json.loads(rev[0][6])
    assert snapshot["header"]["notes"] == "original"
    # The joined vendor columns are NOT snapshotted — a renamed vendor is not
    # the order changing.
    assert "vendor_name" not in snapshot["header"]


@pytest.mark.anyio
async def test_a_draft_is_edited_in_place_with_no_revision(po_client, wired):
    draft = _po_row(status="draft", notes="a")
    wired.fetchrow.side_effect = [draft, {**draft, "notes": "b"}]
    wired.fetch.return_value = []
    r = await po_client.patch(f"/api/v1/procurement/purchase-orders/{PO_ID}",
                              json={"notes": "b"})
    assert r.status_code == 200
    assert r.json()["revision"] is None
    conn = wired.acquire()
    assert not any("ganit_po_revisions" in c[0][0]
                   for c in conn.execute.call_args_list)


@pytest.mark.anyio
async def test_a_line_that_has_received_stock_cannot_be_revised_away(po_client, wired):
    """Otherwise the receipt hangs off a line the order no longer has, and every
    quantity derived from it goes quietly wrong."""
    wired.fetchrow.return_value = _po_row(status="issued", po_number="PO-2026-0001")
    wired.fetch.return_value = [{"id": LINE_ID, "line_no": 1, "qty_ordered": 10,
                                 "qty_received": 4, "rate": 100, "unit": "NOS",
                                 "description": "x", "product_id": None}]
    r = await po_client.patch(f"/api/v1/procurement/purchase-orders/{PO_ID}",
                              json={"line_items": []})
    assert r.status_code == 409
    assert "Close the order short instead" in r.json()["detail"]


@pytest.mark.anyio
async def test_the_detail_view_never_returns_an_approver_id(po_client, wired):
    """The id is a key for the approval check and has no business in a payload a
    screen renders a list from."""
    wired.fetchrow.return_value = _po_row(status="issued", po_number="PO-2026-0001")
    wired.fetch.return_value = []
    r = await po_client.get(f"/api/v1/procurement/purchase-orders/{PO_ID}")
    assert r.status_code == 200
    assert "approver_id" not in json.dumps(r.json()["approvals"])


# ══════════════════════════════════════════════════════════════════════════════
# 11 · The three skills
# ══════════════════════════════════════════════════════════════════════════════
#
# They are NOT registered in `skill_dispatcher.py` or `skills/modules.py` — both
# files belong to other work this week, so the six lines are reported to the
# owner rather than written. These tests exercise the handlers directly, which
# is what registration would do anyway.

from services.skills.data import procurement_ops  # noqa: E402


class _SkillPool:
    """A pool that answers on SQL TEXT, which is what tells the handlers'
    several queries apart. A mock that answers everything the same way is a
    mock that proves the handler ran, not that it asked the right question."""

    def __init__(self, routes, row=None):
        self._routes = routes
        self._row = row or {}

    async def fetch(self, query, *args):
        for needle, answer in self._routes.items():
            if needle in query:
                return answer
        return []

    async def fetchrow(self, query, *args):
        return self._row


@pytest.mark.anyio
async def test_no_orders_is_could_not_check_never_a_clean_result():
    """An org with no purchase orders is not an org with no late suppliers.

    On a module whose whole value is exception-finding, a false all-clear is
    the worst output available — and on the day this shipped every live org had
    exactly zero orders.
    """
    pool = _SkillPool({}, row={"orders_total": 0, "orders_open": 0, "open_undated": 0})
    out = await procurement_ops.check_late_suppliers(pool, ORG)
    assert out["verdict"] == "could_not_check"
    assert out["counts"]["could_not_check"] == 0
    assert any("no purchase orders" in l for l in out["limitations"])


@pytest.mark.anyio
async def test_late_suppliers_reports_days_late_and_a_way_to_ring_them():
    """The point of knowing a supplier is nine days late is being able to ring
    them. The vendor id goes in the href and nowhere else."""
    expected = date.today() - timedelta(days=9)
    pool = _SkillPool(
        {"FROM staging.ganit_purchase_orders po": [{
            "id": PO_ID, "po_number": "PO-2026-0001", "expected_date": expected,
            "total": 5000, "currency": "INR", "vendor_id": VENDOR_ID,
            "vendor": "Acme Supplies", "vendor_email": "sales@acme.example",
            "vendor_phone": "+91 98200 00000",
            "qty_ordered": 10, "qty_received": 4,
        }]},
        row={"orders_total": 1, "orders_open": 1, "open_undated": 0})
    out = await procurement_ops.check_late_suppliers(pool, ORG)
    assert out["verdict"] == "checked"
    late = out["late"][0]
    assert late["days_late"] == 9
    assert late["qty_outstanding"] == 6
    assert late["phone"] == "+91 98200 00000"
    assert late["link"].endswith(VENDOR_ID)
    # The id is IN the href and is not a field of its own.
    assert "vendor_id" not in late


@pytest.mark.anyio
async def test_a_fully_received_order_past_its_date_is_not_a_late_supplier():
    """Every line arrived; the order simply has not been closed yet. That is
    bookkeeping tidiness, and reporting it trains the firm to ignore the list."""
    pool = _SkillPool(
        {"FROM staging.ganit_purchase_orders po": [{
            "id": PO_ID, "po_number": "PO-2026-0002",
            "expected_date": date.today() - timedelta(days=30),
            "total": 5000, "currency": "INR", "vendor_id": VENDOR_ID,
            "vendor": "Acme", "vendor_email": None, "vendor_phone": None,
            "qty_ordered": 10, "qty_received": 10,
        }]},
        row={"orders_total": 1, "orders_open": 1, "open_undated": 0})
    out = await procurement_ops.check_late_suppliers(pool, ORG)
    assert out["late"] == []
    assert out["counts"]["orders_late"] == 0


@pytest.mark.anyio
async def test_undated_orders_are_counted_apart_from_late_ones():
    pool = _SkillPool({}, row={"orders_total": 5, "orders_open": 5, "open_undated": 3})
    out = await procurement_ops.check_late_suppliers(pool, ORG)
    assert out["counts"]["open_without_an_expected_date"] == 3
    assert any("undated order is not a late one" in l for l in out["limitations"])


@pytest.mark.anyio
async def test_the_accrual_states_the_rate_it_was_valued_at():
    """An accrual is a number that goes into a set of accounts, and its basis is
    part of it. The bill carrying the agreed rate is what has not arrived."""
    pool = _SkillPool({})
    out = await procurement_ops.check_received_not_invoiced(pool, ORG)
    assert out["basis"].startswith("ordered rate")
    assert any("ORDERED rate" in l for l in out["limitations"])
    assert any("LINKED to a purchase order" in l for l in out["limitations"])


@pytest.mark.anyio
async def test_194q_can_never_report_checked():
    """Whether the section applies at all turns on the firm's own turnover
    EXCLUDING GST — a figure this product does not hold. The honest verdict on
    applicability is permanently that it could not be checked."""
    pool = _SkillPool({"FROM staging.ganit_vendors v": []})
    out = await procurement_ops.check_194q_approaching(pool, ORG)
    assert out["verdict"] == "could_not_check"
    assert out["basis"] == "purchase value INCLUDING GST"
    assert any("EXCLUDING" in l and "turnover" in l for l in out["limitations"])


@pytest.mark.anyio
async def test_194q_separates_crossed_from_approaching_and_counts_orders_in():
    """Advances count and 194Q bites at payment or credit, whichever is
    earlier — which is why a PO already placed belongs in the projection."""
    pool = _SkillPool({"FROM staging.ganit_vendors v": [
        {"id": VENDOR_ID, "name": "Acme", "tds_section": None,
         "vendor_email": None, "vendor_phone": None,
         "purchased_ytd": 5_500_000, "on_order": 0},
        {"id": "99999999-9999-9999-9999-999999999999", "name": "Bharat",
         "tds_section": None, "vendor_email": None, "vendor_phone": None,
         "purchased_ytd": 4_000_000, "on_order": 2_000_000},
        {"id": "88888888-8888-8888-8888-888888888888", "name": "Small Co",
         "tds_section": None, "vendor_email": None, "vendor_phone": None,
         "purchased_ytd": 100, "on_order": 0},
    ]})
    out = await procurement_ops.check_194q_approaching(pool, ORG)
    assert [v["vendor"] for v in out["past_the_threshold"]] == ["Acme"]
    assert [v["vendor"] for v in out["approaching"]] == ["Bharat"]
    # Well below the warning line, so it is not raised at all.
    assert out["counts"]["vendors_total"] == 3
    assert out["approaching"][0]["will_cross_on_current_orders"] is True
