"""
check_stale_retainer_rates — two populations, and two ids the handler did not
have.

The handler's first limitation is the whole case: "There is no rate history
anywhere in this system", so "the fee has not been revised" can only mean "the
contract row has not been edited". A firm that has DECIDED to hold a fee flat
cannot say so, and reads the same engagements every run until somebody edits a
row for an unrelated reason.

The identity problem was real. An engagement has a TITLE that repeats across
clients and can be retitled; a recurring profile has no title and no number at
all, and its only other candidate key — client plus amount — changes on the
first fee revision, which is the very event this skill exists to notice.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_stale_retainer_rates"
W = ACK_WIRING[SKILL]


def _c(eid="ref-e1", engagement="Annual audit", client="Sharma Traders",
       value=240000.0, status="active", reasons=("unchanged_too_long",), **kw) -> dict:
    row = {
        "engagement_ref": eid,
        "engagement": engagement,
        "client": client,
        "status": status,
        "start_date": "2025-04-01",
        "end_date": "2026-03-31",
        "days_to_end": -145,
        "contract_value": value,
        "reminder_days_on_the_record": 30,
        "last_changed": "2025-04-01",
        "created_on": "2025-04-01",
        "reasons": list(reasons),
        "contradiction": None,
        "link": "/sign/documents/e-1",
    }
    row.update(kw)
    return row


def _p(pid="ref-p1", client="Sharma Traders", amount=20000.0, distinct=1, **kw) -> dict:
    row = {
        "profile_ref": pid,
        "client": client,
        "frequency": "monthly",
        "amount_before_gst": amount,
        "gst_rate": 18.0,
        "next_invoice_on": "2026-09-01",
        "profile_ends": None,
        "created_on": "2023-04-01",
        "invoices_raised": 29,
        "distinct_amounts_billed": distinct,
        "first_billed": "2023-04-05",
        "detail": "Recurring monthly billing at 20,000.00 before GST",
    }
    row.update(kw)
    return row


REASONS = ("expiring_soon", "in_the_firms_reminder_window",
           "unchanged_too_long", "status_contradicts_dates")


def _out(contracts=(), profiles=()) -> dict:
    contracts, profiles = list(contracts), list(profiles)
    return {
        "what_this_is": "Engagements coming up for renewal …",
        "windows": {"horizon_days": 60, "stale_months": 12},
        "counts": {
            **{r: sum(1 for c in contracts if r in c["reasons"]) for r in REASONS},
            "engagements_flagged": len(contracts),
            "recurring_profiles_flagged": len(profiles),
        },
        "contracts": contracts,
        "recurring_profiles": profiles,
        "reminder_window_is_configured": {
            "distribution": {30: 63},
            "the_firm_has_set_this": False,
            "note": "Every row here reads 30, so that is the PRODUCT's default.",
        },
        "limitations": ["There is no rate history anywhere in this system."],
        "caveats": [],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_engagement_stops_being_reported():
    f = _c()
    out = apply_wiring(SKILL, _out(contracts=[f]), _ack("contracts", f))
    assert out["contracts"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Annual audit — Sharma Traders"


def test_an_acknowledged_recurring_profile_stops_being_reported():
    f = _p()
    out = apply_wiring(SKILL, _out(profiles=[f]), _ack("recurring_profiles", f))
    assert out["recurring_profiles"] == []
    assert out["acknowledged"]["items"][0]["label"] == "recurring billing — Sharma Traders"


def test_two_engagements_of_the_same_name_are_two_findings():
    """"Annual audit" is the same title for every client a firm has."""
    one = _c(eid="ref-e1", client="Sharma Traders")
    two = _c(eid="ref-e2", client="Mehta & Co")
    out = apply_wiring(SKILL, _out(contracts=[one, two]), _ack("contracts", one))
    assert [f["engagement_ref"] for f in out["contracts"]] == ["ref-e2"]


def test_retitling_an_engagement_does_not_orphan_the_acknowledgement():
    acks = _ack("contracts", _c(engagement="Annual audit"))
    out = apply_wiring(SKILL, _out(contracts=[
        _c(engagement="Annual audit 2026-27", client="Sharma Traders Pvt Ltd")]), acks)
    assert out["contracts"] == []


def test_a_contract_and_a_profile_cannot_share_a_key():
    """Two different populations in two tables. Folding is left ON because it
    costs nothing here and guarantees the separation regardless of id scheme."""
    c_key = skill_ack.finding_key(_identity_for(W, "contracts")(_c(eid="ref-x")))
    p_key = skill_ack.finding_key(_identity_for(W, "recurring_profiles")(_p(pid="ref-x")))
    assert c_key != p_key


def test_revising_the_fee_brings_the_engagement_back():
    """The revision is the thing the firm was being nagged to make. The
    acknowledgement should void and the finding return once, showing it
    happened."""
    acks = _ack("contracts", _c(value=240000.0))
    out = apply_wiring(SKILL, _out(contracts=[_c(value=300000.0)]), acks)
    assert len(out["contracts"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_revising_a_profile_amount_brings_it_back():
    acks = _ack("recurring_profiles", _p(amount=20000.0))
    out = apply_wiring(SKILL, _out(profiles=[_p(amount=24000.0, distinct=2)]), acks)
    assert len(out["recurring_profiles"]) == 1


def test_an_engagement_expiring_in_status_brings_it_back():
    acks = _ack("contracts", _c(status="active"))
    out = apply_wiring(SKILL, _out(contracts=[_c(status="expired")]), acks)
    assert len(out["contracts"]) == 1


def test_the_clock_alone_does_not_void_the_acknowledgement():
    """`days_to_end` is a clock; `last_changed` and `created_on` exist only to
    be compared with today; and `reasons` / `contradiction` are derived — an
    engagement gains `status_contradicts_dates` because the calendar passed its
    end date, with nothing about the engagement having changed."""
    acks = _ack("contracts", _c(days_to_end=-145, reasons=("unchanged_too_long",)))
    later = _c(days_to_end=-300,
               reasons=("unchanged_too_long", "status_contradicts_dates"),
               contradiction="status is active but the end date has passed")
    assert apply_wiring(SKILL, _out(contracts=[later]), acks)["contracts"] == []


def test_the_distinct_amount_counter_is_not_hashed():
    """The handler calls it "evidence, not proof": it moves on the FIRST
    revision and then never again, so hashing it alongside the amount would
    count one event twice."""
    assert set(W.material_of(_p())) == {"contract_value", "amount_before_gst", "status"}
    acks = _ack("recurring_profiles", _p(distinct=1))
    out = apply_wiring(SKILL, _out(profiles=[_p(distinct=1, invoices_raised=30)]), acks)
    assert out["recurring_profiles"] == []


# ── the aggregates ──────────────────────────────────────────────────────────

def test_both_list_counts_and_the_reason_tallies_are_rebuilt():
    keep = _c(eid="ref-e1", reasons=("expiring_soon",))
    hide = _c(eid="ref-e2", reasons=("unchanged_too_long", "status_contradicts_dates"))
    out = apply_wiring(SKILL, _out(contracts=[keep, hide], profiles=[_p()]),
                       _ack("contracts", hide))
    c = out["counts"]
    assert c["engagements_flagged"] == 1
    assert c["recurring_profiles_flagged"] == 1
    assert c["expiring_soon"] == 1
    assert c["unchanged_too_long"] == 0
    assert c["status_contradicts_dates"] == 0


def test_the_reminder_distribution_is_left_alone():
    """It is a distribution over EVERY engagement in the org, and the note
    attached to it is a statement about the product's defaults rather than
    about these findings."""
    f = _c()
    out = apply_wiring(SKILL, _out(contracts=[f]), _ack("contracts", f))
    assert out["reminder_window_is_configured"]["distribution"] == {30: 63}
    assert out["reminder_window_is_configured"]["the_firm_has_set_this"] is False


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_no_id_does_not_raise():
    out = apply_wiring(SKILL, _out(contracts=[_c(engagement_ref=None)]),
                       _ack("contracts", _c()))
    assert len(out["contracts"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _c()
    data = {"contracts": [f], "counts": {"engagements_flagged": 1}}
    out = apply_wiring(SKILL, data, _ack("contracts", f))
    assert len(out["contracts"]) == 1
    assert "acknowledged" not in out


def test_the_retainer_keys_round_trip():
    first = apply_wiring(SKILL, _out(contracts=[_c()], profiles=[_p()]),
                         {"x": skill_ack.Ack("x")})
    for bucket in ("contracts", "recurring_profiles"):
        f = first[bucket][0]
        acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                             state_hash=f["_ack_state"],
                                             acknowledged_by="u1")}
        again = apply_wiring(SKILL, _out(contracts=[_c()], profiles=[_p()]), acks)
        assert again[bucket] == []


def test_the_handler_emits_both_opaque_refs():
    from pathlib import Path
    src = Path("services/skills/data/stock_and_crm.py").read_text(encoding="utf-8")
    assert '"profile_ref": opaque_ref(p["id"])' in src
    assert '"engagement_ref": opaque_ref(r["id"])' in src
