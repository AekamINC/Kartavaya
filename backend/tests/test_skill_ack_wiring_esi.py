"""
check_esi_ceiling_crossings — a question, not a breach.

The handler says so itself: "THIS READS ONE MONTH. Whether a crossing happened
INSIDE the current contribution period ... needs the earlier months of that
period — so every row here is a question to check, not a confirmed breach."

A question somebody has checked and answered — "the crossing was before this
period began, coverage correctly stopped" — has nowhere to be recorded, so the
same names return every month. That is precisely what an acknowledgement is for,
and precisely why the MONTH has to be in the key.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_esi_ceiling_crossings"
W = ACK_WIRING[SKILL]
CEILING = 21000.0


def _e(code="EMP-013", employee="Myra Bansal", month="2026-07", gross=24000.0,
       contributing=False, **kw) -> dict:
    row = {
        "employee": employee,
        "employee_code": code,
        "esi_number": None,
        "month": month,
        "gross": gross,
        "ceiling": CEILING,
        "contributing_this_month": contributing,
        "email": "myra@example.com",
        "link": "/manav/employees/abc",
    }
    row.update(kw)
    return row


def _out(crossed=(), under=(), examined=71) -> dict:
    crossed, under = list(crossed), list(under)
    return {
        "as_at": "2026-08-23",
        "month": "2026-07",
        "ceiling": CEILING,
        "contribution_period_ends": "2026-09-30",
        "statute": "ESI wage ceiling",
        "counts": {
            # Every employee the query looked at, including everyone correctly
            # contributing. NOT a sum over the two lists.
            "examined": examined,
            "crossed_and_still_owed": len(crossed),
            "newly_under": len(under),
            "capped_at": 200,
            "was_capped": False,
        },
        "crossed_and_still_owed": crossed,
        "newly_under": under,
        "limitations": ["THIS READS ONE MONTH."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_crossing_stops_being_reported():
    f = _e(must_continue_until="2026-09-30", why="Wages are above the ceiling")
    out = apply_wiring(SKILL, _out(crossed=[f]), _ack("crossed_and_still_owed", f))
    assert out["crossed_and_still_owed"] == []
    assert out["acknowledged"]["items"][0]["label"] == "ESI — Myra Bansal (2026-07)"


def test_next_month_asks_the_question_again():
    """An answer about July's wages is not an answer about August's, and a
    person whose pay crosses the ceiling in August has a new obligation."""
    acks = _ack("crossed_and_still_owed", _e(month="2026-07"))
    out = apply_wiring(SKILL, _out(crossed=[_e(month="2026-08")]), acks)
    assert len(out["crossed_and_still_owed"]) == 1


def test_running_twice_in_one_month_resurrects_nothing():
    acks = _ack("crossed_and_still_owed", _e(month="2026-07"))
    out = apply_wiring(SKILL, _out(crossed=[_e(month="2026-07")]), acks)
    assert out["crossed_and_still_owed"] == []


def test_two_colleagues_of_the_same_name_are_two_findings():
    one, two = _e(code="EMP-013"), _e(code="EMP-088")
    out = apply_wiring(SKILL, _out(crossed=[one, two]),
                       _ack("crossed_and_still_owed", one))
    assert [f["employee_code"] for f in out["crossed_and_still_owed"]] == ["EMP-088"]


def test_a_missing_esi_number_is_not_part_of_the_key():
    """`esi_number` is nullable and is frequently the very thing that is
    missing — filling it in must not resurrect the finding."""
    acks = _ack("crossed_and_still_owed", _e(esi_number=None))
    out = apply_wiring(SKILL, _out(crossed=[_e(esi_number="3100000000")]), acks)
    assert out["crossed_and_still_owed"] == []


def test_the_two_lists_ask_different_questions():
    """An employee whose gross falls back under the ceiling has moved from "you
    may still owe a contribution" to "check whether coverage should have
    continued". An acknowledgement of one must not answer the other, so the
    default folding stays ON here."""
    f = _e(code="EMP-013", month="2026-07")
    crossed_key = skill_ack.finding_key(_identity_for(W, "crossed_and_still_owed")(f))
    under_key = skill_ack.finding_key(_identity_for(W, "newly_under")(f))
    assert crossed_key != under_key


def test_a_raise_brings_the_crossing_back():
    acks = _ack("crossed_and_still_owed", _e(gross=24000.0))
    out = apply_wiring(SKILL, _out(crossed=[_e(gross=31000.0)]), acks)
    assert len(out["crossed_and_still_owed"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_starting_to_deduct_brings_it_back_once():
    """`contributing_this_month` is the ANSWER. A firm that acknowledges a
    crossing and then starts deducting has resolved it, and the finding should
    return once so the reader sees that it did."""
    acks = _ack("crossed_and_still_owed", _e(contributing=False))
    out = apply_wiring(SKILL, _out(crossed=[_e(contributing=True)]), acks)
    assert len(out["crossed_and_still_owed"]) == 1


def test_the_contributing_flag_is_a_boolean_not_a_number():
    """`_canon` tags booleans separately from the integers 0 and 1, so
    `contributing_this_month: False` cannot collide with a 0."""
    as_bool = skill_ack.state_hash(W.material_of(_e(contributing=False)))
    as_zero = skill_ack.state_hash(W.material_of(_e(contributing=0)))
    assert as_bool != as_zero


def test_the_ceiling_is_not_hashed():
    """It comes from the statute calendar and is the same for every row in a
    run. A genuine change to it arrives as a change in `gross > ceiling`, which
    moves the finding between the lists."""
    assert set(W.material_of(_e())) == {"gross", "contributing_this_month"}
    acks = _ack("crossed_and_still_owed", _e(ceiling=21000.0))
    out = apply_wiring(SKILL, _out(crossed=[_e(ceiling=25000.0)]), acks)
    assert out["crossed_and_still_owed"] == []


def test_the_two_counts_are_rebuilt_and_examined_is_not():
    """`examined` is every employee the query looked at, including everyone
    correctly contributing. Rebuilding it from the survivors would turn the
    denominator into a filtered number."""
    c, u = _e(code="EMP-1"), _e(code="EMP-2", gross=19000.0)
    out = apply_wiring(SKILL, _out(crossed=[c], under=[u], examined=71),
                       _ack("crossed_and_still_owed", c))
    assert out["counts"]["crossed_and_still_owed"] == 0
    assert out["counts"]["newly_under"] == 1
    assert out["counts"]["examined"] == 71


def test_a_finding_with_no_employee_code_does_not_raise():
    out = apply_wiring(SKILL, _out(crossed=[_e(employee_code=None)]),
                       _ack("crossed_and_still_owed", _e()))
    assert len(out["crossed_and_still_owed"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _e()
    data = {"crossed_and_still_owed": [f], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("crossed_and_still_owed", f))
    assert len(out["crossed_and_still_owed"]) == 1
    assert "acknowledged" not in out


def test_the_esi_key_round_trips():
    first = apply_wiring(SKILL, _out(crossed=[_e()]), {"x": skill_ack.Ack("x")})
    f = first["crossed_and_still_owed"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(crossed=[_e()]), acks)["crossed_and_still_owed"] == []
