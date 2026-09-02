"""
check_dead_gst_slabs — three lists, three populations, and a finding that never
expires on its own.

Almost every skill left out of `ACK_WIRING` was left out correctly: its findings
are period-scoped, or it returns a narrative, or a work list, and the question
answers itself when the period closes. This one is the exception measured on
2026-09-02. A product carrying a rate the Council abolished carries it until
somebody edits the master — there is no close, no due date and no expiry — and
the handler says so itself: "it is wrong TODAY regardless of when it was right".
A firm that has decided a historical invoice will not be reissued reads the same
line every quarter for ever without an acknowledgement.

Two things here are easy to get wrong and both are silent:

  * `rate` is MATERIAL, not identity. "I know that product is on 12%" must not
    silently cover its being moved to 28%, which is a different exposure.

  * the three lists are three POPULATIONS, not one, so the list name is folded
    into the key. One invoice line can legitimately be in `document_lines` (its
    own rate is dead) AND in `rate_disagrees_with_product_master` (it also
    disagrees with the master). Those are two facts about it and a person may
    answer one and not the other.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_dead_gst_slabs"
W = ACK_WIRING[SKILL]

PRODUCTS = "findings.product_master"
LINES = "findings.document_lines"
MISMATCH = "findings.rate_disagrees_with_product_master"


def _product(name="Consultancy retainer", rate=12.0, **kw) -> dict:
    row = {
        "product": name,
        "rate": rate,
        "hsn_or_sac": "998311",
        "is_active": True,
        "why": "A product carries no date.",
    }
    row.update(kw)
    return row


def _line(document="INV-1042", description="Advisory — August", rate=12.0, **kw) -> dict:
    row = {
        "where": "ganit_invoices",
        "document": document,
        "document_date": "2026-07-14",
        "description": description,
        "rate": rate,
        "hsn_or_sac": "998311",
        "status": "final",
        "rate_abolished_on": "2026-04-01",
    }
    row.update(kw)
    return row


def _mismatch(document="INV-1042", item="Advisory — August",
              line_rate=12.0, master_rate=18.0, **kw) -> dict:
    row = {
        "document": document,
        "document_date": "2026-07-14",
        "item": item,
        "invoice_line_rate": line_rate,
        "product_master_rate": master_rate,
        "linked_by": "product name (exact, case-folded)",
        "which_side_is_stale": "The INVOICE LINE carries a rate that no longer exists.",
    }
    row.update(kw)
    return row


def _out(products=(), lines=(), mismatches=()) -> dict:
    products, lines, mismatches = list(products), list(lines), list(mismatches)
    return {
        "as_at": "2026-09-02",
        "live_slabs": [0.0, 5.0, 18.0, 40.0],
        "live_slabs_source": "public.statute_calendar via services/statute.py",
        "findings": {
            "product_master": products,
            "document_lines": lines,
            "rate_disagrees_with_product_master": mismatches,
        },
        "counts": {
            # A population total measured with a window function BEFORE the row
            # cap, so it is deliberately larger than the list beside it.
            "products_on_a_dead_slab": 9,
            "products_listed": len(products),
            "document_lines_on_a_dead_slab": len(lines),
            "document_lines_correct_when_issued": 31,
            "rate_mismatches": 14,
            "rate_mismatches_listed": len(mismatches),
        },
        "coverage": {
            "invoice_lines": 812,
            "compared_against_the_master": 640,
            "not_linkable_to_a_product": 172,
        },
        "limitations": ["Rates come from the dated statute table."],
        "caveats": [],
    }


def _bare(rows) -> list[dict]:
    """A surviving finding minus the annotation this layer adds to it.

    `apply_wiring` stamps `_ack_key` and `_ack_state` onto every survivor so the
    UI can acknowledge one without recomputing the identity/material split in
    JavaScript - a duplicate judgement that would drift and then file acks under
    a key the filter never looks up. They are underscore-prefixed by the same
    convention `_ack` uses, and a renderer skips them; a test comparing whole
    dicts has to as well, or it asserts against the mechanism rather than the
    wiring.
    """
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


# ══════════════════════════════════════════════════════════════════════════════
#  The wiring is present and has the shape the rest of this file assumes
# ══════════════════════════════════════════════════════════════════════════════

def test_all_three_lists_are_wired():
    """Anti-vacuity floor.

    Every test below acknowledges into one named bucket. If `findings_at` ever
    narrows to a subset, those tests keep passing over the lists that remain
    while the dropped one repeats for ever under a feature that looks finished —
    which the module docstring calls out as worse than not wiring at all.
    """
    assert tuple(W.findings_at) == (PRODUCTS, LINES, MISMATCH)
    assert W.recompute is not None, "counts would go stale on every acknowledgement"


# ══════════════════════════════════════════════════════════════════════════════
#  Each list can be acknowledged, through its dotted path
# ══════════════════════════════════════════════════════════════════════════════

def test_an_acknowledged_product_stops_being_reported():
    f = _product()
    out = apply_wiring(SKILL, _out(products=[f]), _ack(PRODUCTS, f))
    assert out["findings"]["product_master"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Consultancy retainer @ 12.0%"


def test_an_acknowledged_document_line_stops_being_reported():
    f = _line()
    out = apply_wiring(SKILL, _out(lines=[f]), _ack(LINES, f))
    assert out["findings"]["document_lines"] == []
    assert out["acknowledged"]["items"][0]["label"] == "INV-1042 — Advisory — August"


def test_an_acknowledged_mismatch_stops_being_reported():
    f = _mismatch()
    out = apply_wiring(SKILL, _out(mismatches=[f]), _ack(MISMATCH, f))
    assert out["findings"]["rate_disagrees_with_product_master"] == []


# ══════════════════════════════════════════════════════════════════════════════
#  MATERIAL — the rate moving brings the finding back
# ══════════════════════════════════════════════════════════════════════════════

def test_a_changed_rate_voids_the_acknowledgement():
    """The case that makes the mechanism trustworthy rather than a way to hide.

    12% abolished and 28% abolished are the same product under the same name and
    a different exposure. If `rate` were identity instead, the ack would simply
    be orphaned and the row would return anyway — but silently, with a dead ack
    row left behind; if it were incidental, the row would stay hidden at the new
    rate, which is the one outcome nobody could detect.
    """
    acked = _product(rate=12.0)
    moved = _product(rate=28.0)
    out = apply_wiring(SKILL, _out(products=[moved]), _ack(PRODUCTS, acked))
    assert _bare(out["findings"]["product_master"]) == [moved], \
        "the product moved to a different dead slab and must resurface"
    assert out["acknowledged"]["count"] == 0


def test_a_draft_becoming_final_voids_the_acknowledgement():
    """A dead rate on a FINAL invoice is a worse situation than on a draft."""
    acked = _line(status="draft")
    issued = _line(status="final")
    out = apply_wiring(SKILL, _out(lines=[issued]), _ack(LINES, acked))
    assert _bare(out["findings"]["document_lines"]) == [issued]


def test_either_side_of_a_mismatch_moving_voids_it():
    for moved in (_mismatch(line_rate=5.0), _mismatch(master_rate=5.0)):
        out = apply_wiring(SKILL, _out(mismatches=[moved]), _ack(MISMATCH, _mismatch()))
        assert _bare(out["findings"]["rate_disagrees_with_product_master"]) == [moved]


# ══════════════════════════════════════════════════════════════════════════════
#  INCIDENTAL — correcting something else must not undo the answer
# ══════════════════════════════════════════════════════════════════════════════

def test_correcting_the_hsn_keeps_the_acknowledgement():
    """An HSN correction is not a rate change, and this finding is about rates.

    Voiding here would mean a firm tidying its master data silently loses every
    answer it has already given — the slow version of the midnight failure.
    """
    acked = _product()
    tidied = _product(hsn_or_sac="998312")
    out = apply_wiring(SKILL, _out(products=[tidied]), _ack(PRODUCTS, acked))
    assert out["findings"]["product_master"] == []


def test_rewording_the_explanation_keeps_the_acknowledgement():
    """`which_side_is_stale` is derived from the two rates already hashed."""
    acked = _mismatch()
    reworded = _mismatch(which_side_is_stale="Reworded by a later commit.")
    out = apply_wiring(SKILL, _out(mismatches=[reworded]), _ack(MISMATCH, acked))
    assert out["findings"]["rate_disagrees_with_product_master"] == []


# ══════════════════════════════════════════════════════════════════════════════
#  THREE POPULATIONS — the list name is folded into the key
# ══════════════════════════════════════════════════════════════════════════════

def test_acknowledging_a_line_does_not_silence_its_mismatch():
    """One invoice line, two different facts about it.

    `document_lines` says its own rate is dead; `rate_disagrees_with_product_master`
    says it also disagrees with the master. Answering the first must not answer
    the second — the second may be the one that means the customer was invoiced
    the wrong amount.
    """
    line, mismatch = _line(), _mismatch()
    out = apply_wiring(SKILL, _out(lines=[line], mismatches=[mismatch]),
                       _ack(LINES, line))
    assert out["findings"]["document_lines"] == []
    assert _bare(out["findings"]["rate_disagrees_with_product_master"]) == [mismatch]


def test_the_two_line_lists_cannot_collide_even_without_the_folding():
    """WHY the test above passes — and it is NOT the list-name folding.

    Written after mutating `lists_are_one_population=True` and finding that
    nothing went red. The default folding is real and it is belt-and-braces
    here, not load-bearing: the two lists name their columns differently, so a
    `document_lines` row carries `where` + `description` while a mismatch row
    carries `item`, and one `identity_of` serving both means those fields are
    present-and-None on the other side. The keys are therefore disjoint before
    `_list` is added at all.

    Stating it explicitly because the test above would otherwise be an assertion
    satisfied by its own shape — green for a reason nobody had checked, and
    still green if somebody later claimed these lists were one population.
    """
    line_id = _identity_for(W, LINES)(_line())
    mismatch_id = _identity_for(W, MISMATCH)(_mismatch())

    # Disjoint on the handler's own field names, before the list name is folded.
    unfolded_line = {k: v for k, v in line_id.items() if k != "_list"}
    unfolded_mismatch = {k: v for k, v in mismatch_id.items() if k != "_list"}
    assert unfolded_line != unfolded_mismatch, (
        "the two lists no longer distinguish themselves by field name, so the "
        "folding in `_identity_for` has become the only thing keeping a line "
        "and its mismatch apart — check `lists_are_one_population` is still "
        "False and make this test assert the folding instead"
    )
    assert skill_ack.finding_key(line_id) != skill_ack.finding_key(mismatch_id)


def test_two_lines_on_one_document_are_separate_findings():
    a, b = _line(description="Advisory — August"), _line(description="Advisory — July")
    out = apply_wiring(SKILL, _out(lines=[a, b]), _ack(LINES, a))
    assert _bare(out["findings"]["document_lines"]) == [b]


# ══════════════════════════════════════════════════════════════════════════════
#  RECOMPUTE — list lengths follow, censuses do not
# ══════════════════════════════════════════════════════════════════════════════

def test_the_listed_counts_follow_the_surviving_rows():
    p, l, m = _product(), _line(), _mismatch()
    out = apply_wiring(SKILL, _out(products=[p, _product(name="Other")],
                                   lines=[l], mismatches=[m]),
                       _ack(PRODUCTS, p))
    assert out["counts"]["products_listed"] == 1
    assert out["counts"]["document_lines_on_a_dead_slab"] == 1
    assert out["counts"]["rate_mismatches_listed"] == 1


def test_the_population_totals_do_not_move():
    """The same rule `_series_recompute` follows, for the same reason.

    `products_on_a_dead_slab` and `rate_mismatches` are measured with a window
    function BEFORE the handler's row cap, so they describe the population and
    not the list. Moving them on an acknowledgement would make the skill report
    a total that quietly disagrees with the database — the reports-page defect,
    which was a lifetime figure under a weekly heading.
    """
    p = _product()
    out = apply_wiring(SKILL, _out(products=[p]), _ack(PRODUCTS, p))
    assert out["counts"]["products_on_a_dead_slab"] == 9
    assert out["counts"]["rate_mismatches"] == 14
    assert out["counts"]["document_lines_correct_when_issued"] == 31


def test_coverage_is_a_census_of_the_data_and_is_untouched():
    """How many invoice lines exist does not change because one was answered."""
    p = _product()
    out = apply_wiring(SKILL, _out(products=[p]), _ack(PRODUCTS, p))
    assert out["coverage"] == {
        "invoice_lines": 812,
        "compared_against_the_master": 640,
        "not_linkable_to_a_product": 172,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Degrading
# ══════════════════════════════════════════════════════════════════════════════

def test_a_shape_change_fails_open():
    """All-or-nothing: filtering some lists while recomputing across a shape the
    handler no longer has is the one outcome worse than not filtering."""
    p = _product()
    broken = _out(products=[p])
    del broken["findings"]["document_lines"]
    out = apply_wiring(SKILL, broken, _ack(PRODUCTS, p))
    assert _bare(out["findings"]["product_master"]) == [p], "data must come back untouched"


def test_no_acknowledgements_leaves_everything_alone():
    p, l, m = _product(), _line(), _mismatch()
    out = apply_wiring(SKILL, _out(products=[p], lines=[l], mismatches=[m]), {})
    assert _bare(out["findings"]["product_master"]) == [p]
    assert _bare(out["findings"]["document_lines"]) == [l]
    assert _bare(out["findings"]["rate_disagrees_with_product_master"]) == [m]
