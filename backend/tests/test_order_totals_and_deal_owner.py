"""Two defects Suite 10 (proposal 93) found in Vikray and Graha, held closed.

── 1 · THE DISCOUNT WAS DEDUCTED ONCE AND SHOWN TWICE ───────────────────────

`vikray._compute_order_totals` stored `subtotal` ALREADY NET of the flat order
discount and then returned `subtotal + tax`, so

    subtotal + tax − discount = total

did not hold on any discounted order. `OrderDetail`'s totals block prints
Subtotal, CGST, SGST, Discount and Total one under the other, so the five
figures a customer reads did not add up on screen.

Ganit's `_compute_invoice` keeps `subtotal` GROSS and takes the discount off
the total, and so does Vikray's own client-side preview
(`pages/vikray/_shared.jsx`). The server was the only one of the three
disagreeing — and `generate_invoice_from_order` copies the ORDER's subtotal
into `ganit_invoices.subtotal`, a column every Ganit reader treats as gross, so
a discounted order minted a tax invoice with an understated taxable value.

The tests below are arithmetic, not schema: `_compute_order_totals` is a pure
function and is called directly. That is deliberate — this is a rounding and
identity contract, and a test that needed a database to state it would not be
run often enough to matter.

── 2 · A DEAL COULD BE ASSIGNED TO ANOTHER ORGANISATION'S MEMBER ────────────

`graha_deals.assigned_to` is a bare `text` column holding a `users.user_id`
with NO foreign key of any kind, and `create_deal` / `update_deal` wrote
whatever the request body said. It was latent only because no screen in the
product could write the column — three readers, no writer, measured across
`frontend/src` and `mobile/` on 2026-08-29, and 0 of 30 live deals carrying a
value on the reference org.

Graha's deal form and deal record now offer an owner, so the door is open and
the guard has to be in the same change. `resolve_deal_owner` checks
`staging.user_roles`, which is the sole tenant path and the same table
`GET /v1/org/members` lists the picker's options from.

Asserted at SOURCE level, the way `test_one_company_record.py` asserts the
same class of thing about this router: the point is that the write paths CALL
the resolver, and a database round trip cannot state "and no other code path
skips it".
"""
import inspect
import re

from routers import graha, vikray


def _code(fn):
    return inspect.getsource(fn)


# ── 1 · order totals ────────────────────────────────────────────────────────

LINES = [
    {"quantity": 2, "rate": 1000.0, "gst_rate": 18.0, "discount_pct": 0},
    {"quantity": 1, "rate": 500.0, "gst_rate": 12.0, "discount_pct": 10},
]
#: 2×1000 = 2000.00 and 1×500 less 10% = 450.00 → gross 2450.00
GROSS = 2450.0
#: 18% of 2000 = 360.00, 12% of 450 = 54.00 → 414.00
TAX = 414.0


def test_the_five_figures_on_a_discounted_order_add_up():
    """The identity every money document obeys, on the case that broke it."""
    subtotal, cgst, sgst, igst, total = vikray._compute_order_totals(LINES, 200.0, False)
    assert round(subtotal + cgst + sgst + igst - 200.0, 2) == round(total, 2), (
        f"subtotal {subtotal} + tax {cgst + sgst + igst} - discount 200.0 = "
        f"{round(subtotal + cgst + sgst + igst - 200.0, 2)}, and the order's total is {total}"
    )


def test_the_subtotal_is_the_taxable_value_and_not_a_net_figure():
    """GROSS, because `generate_invoice_from_order` copies this straight into
    `ganit_invoices.subtotal` — the taxable value on a tax invoice."""
    subtotal, *_ = vikray._compute_order_totals(LINES, 200.0, False)
    assert subtotal == GROSS, (
        "the order's subtotal is already net of the flat discount, so the invoice it "
        "becomes understates its taxable value by exactly that discount"
    )


def test_the_money_a_customer_pays_did_not_move():
    """`(gross − discount) + tax` and `gross + tax − discount` are the same
    money. The repair restates the taxable value; it must not reprice
    anything."""
    *_, total = vikray._compute_order_totals(LINES, 200.0, False)
    assert total == round(GROSS - 200.0 + TAX, 2) == 2664.0


def test_igst_and_cgst_sgst_reach_the_same_total():
    """The split is a presentation of one tax, so the payable cannot depend on
    it. `s.7`/`s.8` IGST Act — the rate is the rate either way."""
    _, c, s_, _i, intra = vikray._compute_order_totals(LINES, 200.0, False)
    _, _, _, igst, inter = vikray._compute_order_totals(LINES, 200.0, True)
    assert round(c + s_, 2) == round(igst, 2) == TAX
    assert intra == inter


def test_the_halves_of_cgst_sgst_are_exact_on_an_odd_paisa():
    """A tax of 0.01 cannot be halved evenly, and the pair must still sum to
    it. Ganit rounds each half; this keeps the remainder on SGST so nothing is
    lost — a paisa dropped here is a paisa the tax figures do not reconcile."""
    odd = [{"quantity": 1, "rate": 0.1, "gst_rate": 10.0, "discount_pct": 0}]
    _, c, s_, _, _ = vikray._compute_order_totals(odd, 0, False)
    assert round(c + s_, 2) == round(vikray._compute_order_totals(odd, 0, True)[3], 2)


def test_a_zero_discount_order_is_unchanged():
    """The overwhelming majority of live rows. Nothing here may move them."""
    subtotal, c, s_, _, total = vikray._compute_order_totals(LINES, 0, False)
    assert subtotal == GROSS
    assert round(c + s_, 2) == TAX
    assert total == round(GROSS + TAX, 2)


def test_the_order_and_the_invoice_agree_on_the_taxable_value():
    """The two modules compute ONE document. `generate_invoice_from_order`
    copies the order's figures verbatim, so a disagreement here is an invoice
    that disagrees with the order it was raised from."""
    from routers.ganit import LineItem, _compute_invoice

    items = [LineItem(description="a", quantity=2, rate=1000.0, gst_rate=18.0),
             LineItem(description="b", quantity=1, rate=500.0, gst_rate=12.0,
                      discount_pct=10)]
    inv = _compute_invoice(items, False, 200.0)
    subtotal, cgst, sgst, _, total = vikray._compute_order_totals(LINES, 200.0, False)

    assert subtotal == inv["subtotal"], (
        "the order and the invoice it becomes disagree about the taxable value"
    )
    assert (round(cgst, 2), round(sgst, 2)) == (inv["cgst"], inv["sgst"])
    assert total == inv["total"]


# ── 2 · the deal's owner ────────────────────────────────────────────────────


def test_the_owner_resolver_checks_org_membership():
    code = _code(graha.resolve_deal_owner)
    assert "public.user_roles" in code, (
        "membership is `user_roles` and nothing else — it is the sole tenant path"
    )
    assert "org_id=$2::uuid" in code
    # "" is the deliberate clear value and must pass straight through rather
    # than being looked up and refused.
    assert re.search(r"if not user_id:\s*\n\s*return \"\"", code)


def test_create_deal_resolves_the_owner_before_it_writes_it():
    code = _code(graha.create_deal)
    assert "resolve_deal_owner(pool, org_id, body.assigned_to)" in code
    assert "body.assigned_to," not in code, (
        "the INSERT still binds the UNCHECKED body value — a guard has to hold at "
        "every USE of the value, not only where it was added"
    )


def test_update_deal_resolves_the_owner_too():
    code = _code(graha.update_deal)
    assert '"assigned_to" in updates' in code
    assert "resolve_deal_owner(" in code, (
        "a PATCH is the easier attack than a create: the deal is already the "
        "caller's, so only the one field being re-filed has to be guessed"
    )


def test_assigned_to_is_still_bound_through_nullif_and_never_cast_to_uuid():
    """`users.user_id` is TEXT on both sides of the attainment join. A cast
    added here would be the fingerprint of the wrong column — `vikray_targets`
    .salesperson_id was a uuid column fed exactly this kind of value and is one
    of the four shipped instances of that fault."""
    code = _code(graha.update_deal)
    assert 'elif k == "assigned_to":' in code
    assert 'sets.append(f"{k}=NULLIF(${idx},\'\')")' in code

    # And in the INSERT. `assigned_to` is the TENTH column in `create_deal`'s
    # list, so it is bound `$10` — and `$10` must carry NO cast. Located by
    # POSITION rather than by grepping the whole statement for "::uuid", which
    # would trip over the four genuine uuid columns beside it.
    insert = _code(graha.create_deal)
    cols = re.search(r"\"INSERT INTO public\.graha_deals \"\s*\n\s*\"\((.*?)\)\s*\"",
                     insert, re.S)
    assert cols, "the deal INSERT's column list could not be read"
    names = [c.strip() for c in cols.group(1).replace('"', " ").split(",")]
    assert names.index("assigned_to") == 9, (
        f"the owner is no longer the tenth column ({names}) — the $10 check below "
        "is now pointing at something else and must be re-derived"
    )
    assert "NULLIF($10,'')," in insert.replace('" "', "").replace('"\n', ""), (
        "the owner column is TEXT holding a `users.user_id`. A cast here would be "
        "the fingerprint of the wrong column — `vikray_targets.salesperson_id` was "
        "a uuid column fed exactly this value and is one of the four shipped "
        "instances of that fault."
    )
    assert "NULLIF($10,'')::" not in insert, (
        "`$10` is the owner and it has acquired a cast"
    )


# ── 3 · a B2B order could never be invoiced ─────────────────────────────────
#
# `generate_invoice_from_order` handed the Rule 46 gate `order["contact_id"]`
# and nothing else. An order raised against a COMPANY with no individual named
# — the ordinary B2B case, and the one this product's own rule describes ("a
# CRM client is the company; contacts are people who come and go, the customer
# stays") — therefore reached `validate_tax_invoice` with no recipient at all,
# raised the BLOCKING Rule 46(e) "Recipient name" gap, and 422'd.
#
# Measured 2026-08-29 by Suite 10 (10.08), against staging: all thirty-five
# orders raised through the real form name a company and no person, and the
# first `Generate invoice` answered
#   422 {"error":"document_incomplete", "blocking":[{"field":"contact.name",
#        "reason":"Rule 46(e) — the document must name the recipient."}]}
# An order could be confirmed, dispatched and delivered and then never billed,
# with the customer's name sitting on the row the whole time.
#
# `_refuse_final_if_incomplete` ALREADY carries the company fallback —
# `create_invoice` and `client_billing.generate_usage_invoice` both pass
# `client_id` and both work. This route was the one caller that did not.


def test_the_rule_46_gate_is_told_which_company_the_order_is_for():
    code = _code(vikray.generate_invoice_from_order)
    gate = code[code.index("_refuse_final_if_incomplete(pool"):]
    gate = gate[: gate.index("}, order[\"contact_id\"])")]
    assert '"client_id": client_id' in gate, (
        "the Rule 46 gate is not told the company, so an order raised against a firm "
        "with no named individual raises a BLOCKING 'Recipient name' gap and can never "
        "be invoiced"
    )


def test_the_company_is_resolved_before_the_gate_and_not_after():
    """Ordering, not decoration. The resolution used to sit BETWEEN the gate and
    the INSERT, which is the whole reason the gate could not see it."""
    code = _code(vikray.generate_invoice_from_order)
    assert code.index("client_id = (") < code.index("_refuse_final_if_incomplete(pool"), (
        "the company is resolved after the gate runs, so the gate cannot use it"
    )


def test_the_validator_still_accepts_a_company_as_the_recipient():
    """The fallback this route now reaches. Rule 46(e) asks for the name of the
    RECIPIENT, and a company is a recipient — so the gate resolves
    `graha_clients` and hands the firm's name in as `company`."""
    from routers import ganit
    code = _code(ganit._refuse_final_if_incomplete)
    assert 'if not contact and invoice.get("client_id")' in code
    assert "public.graha_clients" in code
    assert '"company": client["name"]' in code
