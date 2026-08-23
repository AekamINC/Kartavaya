"""
check_invoice_series_and_splits — the second dotted path, and three gap totals
that are deliberately NULL.

A gap in a numbered series is "the thing an auditor asks about", and the
commonest answer is one this product cannot hold: the missing numbers were
raised on the old system, or spoiled and destroyed, or belong to a book the firm
stopped using. On the other side, the handler says a head defect is "a
disagreement INSIDE the record rather than a determination of law" — so a firm
that checked one against the actual place of supply and found it correct has
nowhere to record that either.

The recompute is the careful part. `missing_numbers` and its two explanations
are set to NULL when the run was truncated, because "a capped series scan
INVENTS holes". A rebuild that summed them from the surviving books would
replace that refusal with a number.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_invoice_series_and_splits"
W = ACK_WIRING[SKILL]


def _book(book="INV/26-27/", year="2026-27", present=140, missing=3, **kw) -> dict:
    row = {
        "book": book,
        "financial_year": year,
        "numbers_present": present,
        "lowest_in_year": "000001",
        "highest_in_year": "000143",
        "first_document_dated": "2026-04-02",
        "last_document_dated": "2026-08-19",
        "continues_from_an_earlier_year": False,
        "duplicates": [],
        "gaps": ["000041-000043"],
        "missing_count": missing,
    }
    row.update(kw)
    return row


def _defect(number="INV-1042", defect="cgst_sgst_on_an_interstate_supply",
            total=42000.0, cgst=3780.0, sgst=3780.0, igst=0.0, **kw) -> dict:
    row = {
        "invoice_number": number,
        "invoice_date": "2026-07-14",
        "type": "tax_invoice",
        "defect": defect,
        "detail": "place of supply is 29, supplier is 27",
        "place_of_supply_as_recorded": "29-Karnataka",
        "place_of_supply_state_code": "29",
        "supplier_state_code": "27",
        "cgst": cgst, "sgst": sgst, "igst": igst,
        "invoice_total": total,
    }
    row.update(kw)
    return row


def _out(series=(), defects=(), truncated=False) -> dict:
    series, defects = list(series), list(defects)
    return {
        "financial_year": "2026-27",
        "year_runs": {"from": "2026-04-01", "to": "2027-03-31"},
        "as_at": "2026-08-23",
        "documents_examined": 787,
        "series": series,
        "tax_heads": {
            "supplier_state_code": "27",
            "defects": defects,
            "defect_count": len(defects),
            # Denominators that say how much of the book could be judged at all.
            "documents_judged": 640,
            "place_of_supply_unreadable": 120,
            "exports_excluded": 27,
            "tax_on_the_wrong_head": 41200.0,
        },
        "counts": {
            "books": len(series),
            # DELIBERATELY NULL on a truncated run — "a capped series scan
            # INVENTS holes".
            "missing_numbers": None if truncated else 3,
            "numbers_explained_by_a_shared_counter": None if truncated else 1,
            "numbers_explained_by_an_adjacent_year": None if truncated else 0,
            "duplicate_numbers": 0,
            "unparseable_numbers": 2,
            "documents_read_including_adjacent_years": 940,
        },
        "limitations": ["A capped series scan invents holes."],
        "caveats": [],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_series_stops_being_reported():
    f = _book()
    out = apply_wiring(SKILL, _out(series=[f]), _ack("series", f))
    assert out["series"] == []
    assert out["acknowledged"]["items"][0]["label"] == "series INV/26-27/ — 2026-27"


def test_an_acknowledged_head_defect_stops_being_reported():
    """Read through the DOTTED PATH, and the denominators beside it survive."""
    f = _defect()
    out = apply_wiring(SKILL, _out(defects=[f]), _ack("tax_heads.defects", f))
    assert out["tax_heads"]["defects"] == []
    assert out["tax_heads"]["documents_judged"] == 640
    assert out["tax_heads"]["place_of_supply_unreadable"] == 120
    assert out["acknowledged"]["items"][0]["label"] == (
        "INV-1042 — cgst_sgst_on_an_interstate_supply")


def test_the_next_financial_year_asks_about_the_book_again():
    """The same book in FY27 holds different numbers, so "this gap is
    explained" about FY26 must not cover it."""
    acks = _ack("series", _book(year="2026-27"))
    out = apply_wiring(SKILL, _out(series=[_book(year="2027-28")]), acks)
    assert len(out["series"]) == 1


def test_two_defects_on_one_document_are_two_findings():
    """One document can be wrong in more than one way and each is a separate
    judgement."""
    one = _defect(defect="cgst_sgst_on_an_interstate_supply")
    two = _defect(defect="igst_on_an_intrastate_supply")
    out = apply_wiring(SKILL, _out(defects=[one, two]), _ack("tax_heads.defects", one))
    assert [d["defect"] for d in out["tax_heads"]["defects"]] == [
        "igst_on_an_intrastate_supply"]


def test_a_book_and_a_defect_cannot_share_a_key():
    b = skill_ack.finding_key(_identity_for(W, "series")(_book()))
    d = skill_ack.finding_key(_identity_for(W, "tax_heads.defects")(_defect()))
    assert b != d


def test_more_missing_numbers_bring_the_series_back():
    """A book acknowledged with three gaps must resurface at thirty."""
    acks = _ack("series", _book(missing=3))
    out = apply_wiring(SKILL, _out(series=[_book(missing=30)]), acks)
    assert len(out["series"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_resplitting_the_gap_ranges_does_not_void_the_acknowledgement():
    """`gaps` is the same information as a list of RANGES: one invoice raised
    in the middle of a gap re-splits every range around it. `missing_count`
    already reports that change honestly."""
    acks = _ack("series", _book(missing=3, gaps=["000041-000043"]))
    out = apply_wiring(SKILL, _out(series=[
        _book(missing=3, gaps=["000041", "000043", "000090"])]), acks)
    assert out["series"] == []


def test_retaxing_a_document_brings_the_defect_back():
    """The defect IS the split: a document re-taxed onto the right head stops
    being a defect, and one re-taxed onto a different wrong head is new."""
    acks = _ack("tax_heads.defects", _defect(cgst=3780.0, sgst=3780.0, igst=0.0))
    out = apply_wiring(SKILL, _out(defects=[
        _defect(cgst=0.0, sgst=0.0, igst=7560.0)]), acks)
    assert len(out["tax_heads"]["defects"]) == 1


def test_the_explanations_of_a_gap_are_not_hashed():
    assert set(W.material_of(_book())) <= {
        "numbers_present", "missing_count", "invoice_total", "cgst", "sgst", "igst"}
    acks = _ack("series", _book())
    out = apply_wiring(SKILL, _out(series=[_book(
        numbers_taken_by_another_book=["000041"],
        numbers_used_in_an_adjacent_year=["000042"],
        inconsistent_width="two widths in one book",
        last_document_dated="2026-08-22")]), acks)
    assert out["series"] == []


# ── the totals the handler refuses to compute ───────────────────────────────

def test_the_two_list_lengths_are_rebuilt():
    keep, hide = _book(book="A"), _book(book="B")
    d = _defect()
    out = apply_wiring(SKILL, _out(series=[keep, hide], defects=[d]),
                       _ack("series", hide))
    assert out["counts"]["books"] == 1
    assert out["tax_heads"]["defect_count"] == 1


def test_the_gap_totals_are_never_rebuilt():
    """`missing_numbers` and its two explanations are set to NULL when the run
    was truncated, because "a capped series scan INVENTS holes". A rebuild that
    summed them from the surviving books would replace that refusal with a
    number — the one thing this handler was written not to do."""
    f = _book()
    out = apply_wiring(SKILL, _out(series=[f], truncated=True), _ack("series", f))
    assert out["series"] == []
    assert out["counts"]["missing_numbers"] is None
    assert out["counts"]["numbers_explained_by_a_shared_counter"] is None
    assert out["counts"]["numbers_explained_by_an_adjacent_year"] is None


def test_the_untruncated_gap_totals_are_left_alone_too():
    f = _book()
    out = apply_wiring(SKILL, _out(series=[f]), _ack("series", f))
    assert out["counts"]["missing_numbers"] == 3
    assert out["counts"]["duplicate_numbers"] == 0
    assert out["counts"]["unparseable_numbers"] == 2
    assert out["documents_examined"] == 787


def test_the_money_at_stake_is_left_whole():
    """A departure from the usual rule, and recorded as owed in the wiring:
    `tax_on_the_wrong_head` sits beside denominators that describe the whole
    population, and a money figure rebuilt from a filtered list next to
    unfiltered denominators is worse than one that is honestly whole."""
    f = _defect()
    out = apply_wiring(SKILL, _out(defects=[f]), _ack("tax_heads.defects", f))
    assert out["tax_heads"]["tax_on_the_wrong_head"] == 41200.0


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_no_key_fields_does_not_raise():
    bare = {"numbers_present": 1}
    out = apply_wiring(SKILL, _out(series=[bare]), _ack("series", _book()))
    assert len(out["series"]) == 1


def test_a_missing_nesting_fails_open():
    f = _book()
    data = {"series": [f], "counts": {"books": 1}}
    out = apply_wiring(SKILL, data, _ack("series", f))
    assert len(out["series"]) == 1
    assert "acknowledged" not in out


def test_the_series_keys_round_trip():
    first = apply_wiring(SKILL, _out(series=[_book()], defects=[_defect()]),
                         {"x": skill_ack.Ack("x")})
    for holder, bucket in ((first["series"], "series"),
                           (first["tax_heads"]["defects"], "tax_heads.defects")):
        f = holder[0]
        acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                             state_hash=f["_ack_state"],
                                             acknowledged_by="u1")}
        again = apply_wiring(SKILL, _out(series=[_book()], defects=[_defect()]), acks)
        target = (again["series"] if bucket == "series"
                  else again["tax_heads"]["defects"])
        assert target == []


def test_the_handler_emits_the_year_on_every_series_entry():
    from pathlib import Path
    src = Path("services/skills/data/ganit_ops.py").read_text(encoding="utf-8")
    assert '"financial_year": financial_year,' in src
