"""
check_retainers_that_stopped_billing — two populations with no keys at all, and
a count that resets every month.

Neither half can be closed from here. The handler "reports what the recurring
generator WILL do, read off its code — not what it did", and there is no history
to consult: `ganit_recurring` has no last-run column and no error column. A firm
that has looked at a stalled schedule and decided to leave it stalled — the
client is on a break, the work is paused — reads it again every run for ever.

The identity problem was the sharpest so far. A recurring schedule has no number
and no title AT ALL; a contract's title repeats across customers; and `bill_to`
on both is a name the handler itself sometimes cannot resolve, rendering "(no
customer named on the schedule)" — the placeholder trap that would collapse every
nameless schedule into one key.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_retainers_that_stopped_billing"
W = ACK_WIRING[SKILL]

NO_NAME = "(no customer named on the schedule)"


def _s(ref="ref-s1", bill_to="Sharma Traders", amount=20000.0,
       faults=("next due more than one cycle in the past",), **kw) -> dict:
    row = {
        "schedule_ref": ref,
        "bill_to": bill_to,
        "next_due": "2026-05-01",
        "frequency": "monthly",
        "amount_before_tax": amount,
        "gst_rate_percent": 18.0,
        "schedule_ends": None,
        "last_invoice_from_this_schedule": "2026-04-05",
        "faults": [{"fault": f, "blocks": True, "detail": "…"} for f in faults],
    }
    row.update(kw)
    return row


def _k(ref="ref-k1", contract="Annual audit", bill_to="Sharma Traders",
       value=240000.0, billed=0.0, in_period=0, **kw) -> dict:
    row = {
        "contract_ref": ref,
        "contract": contract,
        "bill_to": bill_to,
        "contract_value": value,
        "invoiced_since_start": billed,
        "invoices_in_period": in_period,
        "runs": {"from": "2025-04-01", "to": "2026-03-31"},
        "findings": [{"fault": "nothing billed this period", "blocks": False,
                      "detail": "…"}],
    }
    row.update(kw)
    return row


def _out(due_soon=(), contracts=(), schedules_examined=7, contracts_examined=30) -> dict:
    due_soon, contracts = list(due_soon), list(contracts)
    return {
        "as_at": "2026-08-23",
        "horizon_days": 7,
        "month": "2026-08",
        "period_examined": {"from": "2026-08-01", "to": "2026-08-31"},
        "due_soon": due_soon,
        "contracts": contracts,
        "counts": {
            # POPULATIONS — the denominators the handler reports because
            # "healthy definitions are not listed".
            "schedules_due_within_horizon": schedules_examined,
            "live_contracts_examined": contracts_examined,
            "contracts_with_no_customer_to_check": 0,
            # Lengths of the two lists.
            "schedules_with_a_fault": len(due_soon),
            "contracts_with_a_finding": len(contracts),
        },
        "limitations": ["No column links an invoice to a contract."],
        "caveats": [],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_schedule_stops_being_reported():
    f = _s()
    out = apply_wiring(SKILL, _out(due_soon=[f]), _ack("due_soon", f))
    assert out["due_soon"] == []
    assert out["acknowledged"]["items"][0]["label"] == "recurring schedule — Sharma Traders"


def test_an_acknowledged_contract_stops_being_reported():
    f = _k()
    out = apply_wiring(SKILL, _out(contracts=[f]), _ack("contracts", f))
    assert out["contracts"] == []
    assert out["acknowledged"]["items"][0]["label"] == "Annual audit — Sharma Traders"


def test_two_nameless_schedules_are_two_findings():
    """THE PLACEHOLDER TRAP. `bill_to` renders as "(no customer named on the
    schedule)" whenever the handler cannot resolve one — identical on every
    such row. Keyed on it, the first acknowledgement would hide them all."""
    one = _s(ref="ref-s1", bill_to=NO_NAME)
    two = _s(ref="ref-s2", bill_to=NO_NAME)
    out = apply_wiring(SKILL, _out(due_soon=[one, two]), _ack("due_soon", one))
    assert [f["schedule_ref"] for f in out["due_soon"]] == ["ref-s2"]


def test_retitling_a_contract_does_not_orphan_the_acknowledgement():
    acks = _ack("contracts", _k(contract="Annual audit"))
    out = apply_wiring(SKILL, _out(contracts=[_k(contract="Annual audit 2026-27",
                                                 bill_to="Sharma Traders Pvt")]), acks)
    assert out["contracts"] == []


def test_a_schedule_and_a_contract_cannot_share_a_key():
    s_key = skill_ack.finding_key(_identity_for(W, "due_soon")(_s(ref="ref-x")))
    k_key = skill_ack.finding_key(_identity_for(W, "contracts")(_k(ref="ref-x")))
    assert s_key != k_key


def test_repricing_a_schedule_brings_it_back():
    acks = _ack("due_soon", _s(amount=20000.0))
    out = apply_wiring(SKILL, _out(due_soon=[_s(amount=26000.0)]), acks)
    assert len(out["due_soon"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_both_contract_numbers_are_material():
    """Neither implies the other: `contract_value` is what was agreed and
    `invoiced_since_start` is what has gone out, and the finding IS the gap."""
    acks = _ack("contracts", _k(value=240000.0, billed=0.0))
    assert len(apply_wiring(SKILL, _out(contracts=[_k(value=300000.0)]),
                            acks)["contracts"]) == 1
    assert len(apply_wiring(SKILL, _out(contracts=[_k(billed=60000.0)]),
                            acks)["contracts"]) == 1


def test_the_monthly_invoice_count_is_not_hashed():
    """`invoices_in_period` counts invoices in THIS month, so it resets every
    month — a calendar-driven field wearing a count, and the second-worst thing
    to put in this bucket after a day counter."""
    assert set(W.material_of(_k())) == {"amount_before_tax", "contract_value",
                                        "invoiced_since_start"}
    acks = _ack("contracts", _k(in_period=0))
    out = apply_wiring(SKILL, _out(contracts=[_k(in_period=3)]), acks)
    assert out["contracts"] == []


def test_a_new_fault_from_the_passage_of_time_does_not_void_the_acknowledgement():
    """A schedule gains "next due more than one cycle in the past" purely
    because time passed. Hashing `faults` would be `days_past` reaching the
    material bucket through a list of strings."""
    acks = _ack("due_soon", _s(faults=("next due more than one cycle in the past",)))
    out = apply_wiring(SKILL, _out(due_soon=[_s(faults=(
        "next due more than one cycle in the past",
        "the schedule has ended but still has a next date"))]), acks)
    assert out["due_soon"] == []


# ── the counts ──────────────────────────────────────────────────────────────

def test_the_two_finding_counts_are_rebuilt():
    keep, hide = _k(ref="ref-k1"), _k(ref="ref-k2")
    out = apply_wiring(SKILL, _out(due_soon=[_s()], contracts=[keep, hide]),
                       _ack("contracts", hide))
    assert out["counts"]["contracts_with_a_finding"] == 1
    assert out["counts"]["schedules_with_a_fault"] == 1


def test_the_populations_are_left_alone():
    """"Healthy definitions are not listed", so the denominator is the only
    thing that stops an empty list reading as a clean generator."""
    f = _s()
    out = apply_wiring(SKILL, _out(due_soon=[f], schedules_examined=7,
                                   contracts_examined=30), _ack("due_soon", f))
    assert out["counts"]["schedules_due_within_horizon"] == 7
    assert out["counts"]["live_contracts_examined"] == 30
    assert out["counts"]["contracts_with_no_customer_to_check"] == 0


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_no_ref_does_not_raise():
    out = apply_wiring(SKILL, _out(due_soon=[_s(schedule_ref=None)]),
                       _ack("due_soon", _s()))
    assert len(out["due_soon"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _s()
    data = {"due_soon": [f], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("due_soon", f))
    assert len(out["due_soon"]) == 1
    assert "acknowledged" not in out


def test_the_retainer_keys_round_trip():
    first = apply_wiring(SKILL, _out(due_soon=[_s()], contracts=[_k()]),
                         {"x": skill_ack.Ack("x")})
    for bucket in ("due_soon", "contracts"):
        f = first[bucket][0]
        acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                             state_hash=f["_ack_state"],
                                             acknowledged_by="u1")}
        again = apply_wiring(SKILL, _out(due_soon=[_s()], contracts=[_k()]), acks)
        assert again[bucket] == []


def test_the_handler_emits_both_opaque_refs():
    from pathlib import Path
    src = Path("services/skills/data/ganit_ops.py").read_text(encoding="utf-8")
    assert '"schedule_ref": opaque_ref(row["id"])' in src
    assert '"contract_ref": opaque_ref(row["id"])' in src
