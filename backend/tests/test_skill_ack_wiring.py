"""
The first skill wiring, and the four ways it could be silently wrong.

`services/skill_ack.py` has its own tests for the mechanism — hashing, snooze
expiry, the naive/aware datetime trap. This file tests the JUDGEMENT in
`services/skill_ack_wiring.py`: which of `propose_payment_run`'s fields are
identity, which are material, and what happens to the totals when rows vanish.

Every failure mode here is silent in production, which is why each one is
pinned by name rather than covered incidentally.
"""
from __future__ import annotations

import ast
import inspect
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, apply_wiring

NOW = datetime(2026, 8, 21, 9, 0, tzinfo=timezone.utc)
WIRING = ACK_WIRING["propose_payment_run"]


def _bill(**kw) -> dict:
    """One bill in exactly the shape `propose_payment_run` emits."""
    row = {
        "bill": "INV-2291",
        "vendor": "Sharma Traders",
        "vendor_gstin": "27AAAAA0000A1Z5",
        "bill_date": "2026-05-01",
        "due_date": "2026-06-01",
        "total": 42000.0,
        "already_paid": 0.0,
        "balance_due": 42000.0,
        "currency": "INR",
        "status": "approved",
        "ageing": "61-90",
        "days_past_due": 81,
    }
    row.update(kw)
    return row


def _out(bills) -> dict:
    """The handler's return shape, with the aggregates it really computes."""
    total = round(sum(float(b["balance_due"]) for b in bills), 2)
    buckets: dict[str, dict] = {}
    for b in bills:
        slot = buckets.setdefault(b["ageing"], {"count": 0, "amount": 0.0})
        slot["count"] += 1
        slot["amount"] = round(slot["amount"] + float(b["balance_due"]), 2)
    return {
        "as_of": "2026-08-21",
        "horizon_days": 7,
        "total_due": total,
        "by_bucket": buckets,
        "bills": list(bills),
        "note": "A proposal only.",
    }


def _ack_for(bill: dict, **kw) -> dict[str, skill_ack.Ack]:
    """An ack recorded against *bill* exactly as the endpoint would record it."""
    key = skill_ack.finding_key(WIRING.identity_of(bill))
    state = skill_ack.state_hash(WIRING.material_of(bill))
    return {key: skill_ack.Ack(finding_key=key, state_hash=state,
                               acknowledged_by="u1", acknowledged_at=NOW, **kw)}


# ── 1 · it works at all ─────────────────────────────────────────────────────

def test_an_acknowledged_bill_stops_being_reported():
    b = _bill()
    out = apply_wiring("propose_payment_run", _out([b]), _ack_for(b))
    assert out["bills"] == []
    assert out["acknowledged"]["count"] == 1
    assert out["acknowledged"]["items"][0]["label"] == "INV-2291 — Sharma Traders"


def test_an_unacknowledged_bill_is_untouched():
    out = apply_wiring("propose_payment_run", _out([_bill()]), {})
    assert len(out["bills"]) == 1
    # No ack set means no filtering ran at all — and in particular no
    # `acknowledged` key inviting a UI to render "0 acknowledged" on every run.
    assert "acknowledged" not in out


# ── 2 · THE ONE THAT DECIDES WHETHER ANYONE USES THIS ───────────────────────

def test_the_day_counter_ticking_does_not_void_the_acknowledgement():
    """`days_past_due` and `ageing` move with the calendar and nothing else.

    If either were in IDENTITY every bill would get a fresh key at midnight and
    the ack would be orphaned; if either were in MATERIAL the stored state would
    stop matching at midnight and the ack would stop suppressing. Both look
    identical to a user: they ack forty bills, come back tomorrow, find forty
    bills, and never ack anything again.
    """
    yesterday = _bill(days_past_due=81, ageing="61-90")
    acks = _ack_for(yesterday)

    # A month later. Same debt, same balance — only the clock moved.
    today = _bill(days_past_due=112, ageing="90+")
    out = apply_wiring("propose_payment_run", _out([today]), acks)

    assert out["bills"] == [], (
        "the acknowledgement died because the day count ticked — check that "
        "days_past_due and ageing are in NEITHER identity_of nor material_of"
    )


# ── 3 · THE ONE THAT MAKES IT TRUSTWORTHY ───────────────────────────────────

def test_a_bill_that_grows_comes_back():
    """42,000 was acknowledged. 84,000 is a new situation wearing an old name."""
    acked = _bill(balance_due=42000.0)
    acks = _ack_for(acked)

    grown = _bill(balance_due=84000.0, total=84000.0)
    out = apply_wiring("propose_payment_run", _out([grown]), acks)

    assert len(out["bills"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_a_status_change_brings_it_back():
    acks = _ack_for(_bill(status="approved"))
    out = apply_wiring("propose_payment_run",
                       _out([_bill(status="on_hold")]), acks)
    assert len(out["bills"]) == 1


def test_a_part_payment_brings_it_back():
    """`total` and `already_paid` are not in MATERIAL — balance is their
    difference, so a part payment must still surface through it."""
    acks = _ack_for(_bill(already_paid=0.0, balance_due=42000.0))
    out = apply_wiring("propose_payment_run",
                       _out([_bill(already_paid=20000.0, balance_due=22000.0)]),
                       acks)
    assert len(out["bills"]) == 1


# ── 4 · the vendor trap ─────────────────────────────────────────────────────

def test_a_soft_deleted_vendor_does_not_orphan_the_acknowledgement():
    """The handler renders a soft-deleted vendor as "(vendor record
    unavailable)". Had the vendor been part of IDENTITY, deleting a vendor
    record would silently re-key every one of its bills."""
    acks = _ack_for(_bill(vendor="Sharma Traders"))
    out = apply_wiring("propose_payment_run",
                       _out([_bill(vendor="(vendor record unavailable)")]), acks)
    assert out["bills"] == []


# ── 5 · THE TOTAL MUST NOT LIE ──────────────────────────────────────────────

def test_the_total_matches_the_bills_actually_shown():
    """Suppress a bill and leave `total_due` alone and the skill reports a
    total for rows it is not showing — the reports-page defect, reintroduced."""
    keep, hide = _bill(bill="A", balance_due=1000.0), _bill(bill="B", balance_due=9000.0)
    out = apply_wiring("propose_payment_run", _out([keep, hide]), _ack_for(hide))

    assert [b["bill"] for b in out["bills"]] == ["A"]
    assert out["total_due"] == 1000.0
    assert sum(v["amount"] for v in out["by_bucket"].values()) == out["total_due"]
    assert sum(v["count"] for v in out["by_bucket"].values()) == len(out["bills"])


def test_acknowledging_everything_leaves_a_zero_total_not_a_stale_one():
    b = _bill(balance_due=42000.0)
    out = apply_wiring("propose_payment_run", _out([b]), _ack_for(b))
    assert out["total_due"] == 0.0
    assert out["by_bucket"] == {}


# ── 6 · the annotation the UI hands back ────────────────────────────────────

def test_every_surviving_finding_carries_the_key_to_acknowledge_it():
    """Without these the UI would have to recompute the identity/material split
    in JavaScript, and a drifted copy files acks under a key the filter never
    looks up."""
    out = apply_wiring("propose_payment_run", _out([_bill()]), _ack_for(_bill(bill="other")))
    f = out["bills"][0]
    assert f["_ack_key"] == skill_ack.finding_key(WIRING.identity_of(f))
    assert f["_ack_state"] == skill_ack.state_hash(WIRING.material_of(f))


def test_the_handed_back_key_round_trips_into_a_working_acknowledgement():
    """The end-to-end property: run, take `_ack_key`/`_ack_state` off a finding,
    store them the way the endpoint does, run again, finding is gone."""
    first = apply_wiring("propose_payment_run", _out([_bill()]), {"x": skill_ack.Ack("x")})
    f = first["bills"][0]

    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    second = apply_wiring("propose_payment_run", _out([_bill()]), acks)
    assert second["bills"] == []


# ── 7 · a snooze is not a delete ────────────────────────────────────────────

def test_an_expired_snooze_lets_the_bill_back_through():
    b = _bill()
    acks = _ack_for(b, snooze_until=NOW - timedelta(days=1))
    out = apply_wiring("propose_payment_run", _out([b]), acks)
    assert len(out["bills"]) == 1


# ── 8 · nothing else got wired by accident ──────────────────────────────────

#: Every skill wired so far, in the order the list is asserted. ONE SKILL PER
#: COMMIT: this literal grows by exactly one name per commit, and the commit
#: that adds the name is the commit that argues that skill's three-way split.
WIRED = [
    "check_duplicate_vendor_bills",
    "check_received_not_invoiced",
    "check_late_suppliers",
    "find_overdue_followups",
    "find_overdue_invoices",
    "find_overdue_tasks",
    "find_overdue_vendor_bills",
    "find_stalled_agreements",
    "propose_payment_run",
]


def test_only_the_reviewed_skills_are_wired():
    """ONE SKILL PER COMMIT. A bulk wiring is N unreviewed judgements arriving
    as one green build, and every way of getting one wrong is silent. When this
    list changes, the diff should be a single entry and the commit message
    should argue that skill's three-way split."""
    assert sorted(ACK_WIRING) == sorted(WIRED)


def test_an_unwired_skill_is_returned_untouched():
    data = {"bills": [_bill()], "total_due": 42000.0}
    assert apply_wiring("check_payroll_readiness", data, _ack_for(_bill())) is data


def test_a_handler_that_changed_shape_fails_open_not_closed():
    """If the wiring names a key the handler no longer returns, show the
    findings unfiltered. Showing an acknowledged bill is a nuisance; hiding an
    unacknowledged one is a missed payment."""
    data = {"vendor_bills": [_bill()], "total_due": 42000.0}
    out = apply_wiring("propose_payment_run", data, _ack_for(_bill()))
    assert out["vendor_bills"] == [_bill()]
    assert "acknowledged" not in out


# ── 9 · the wiring cannot silently lose its aggregates ──────────────────────

def test_every_wiring_that_has_aggregates_declares_a_recompute():
    """`recompute=None` is an assertion that the return dict carries nothing
    that can go stale. It is only ever safe to write it deliberately, so this
    fails on the entry rather than waiting for a total to drift in production.
    """
    for name, w in ACK_WIRING.items():
        assert w.findings_at, f"{name} does not say where its findings live"
        assert callable(w.identity_of), f"{name} has no identity_of"
        assert callable(w.label_of), f"{name} has no label_of"
        if name == "propose_payment_run":
            assert w.recompute is not None, (
                "propose_payment_run returns total_due and by_bucket; without a "
                "recompute they would describe bills the run is not showing"
            )


def test_no_wiring_puts_a_drifting_field_in_either_hash():
    """The static form of test 2, over every wiring rather than just the first.

    `skill_ack._DRIFT_FIELDS` is the module's own list of names that move with
    the clock. Reading the lambdas' source is crude, and it is the only way to
    catch this at the moment a second wiring is added rather than at the moment
    somebody happens to write a behavioural test for it.
    """
    for name, w in ACK_WIRING.items():
        for role, fn in (("identity_of", w.identity_of), ("material_of", w.material_of)):
            if fn is None:
                continue
            src = inspect.getsource(fn)
            for bad in skill_ack._DRIFT_FIELDS:
                assert f'"{bad}"' not in src and f"'{bad}'" not in src, (
                    f"{name}.{role} reads '{bad}', which changes with the "
                    f"calendar. Every acknowledgement for this skill would die "
                    f"at the next midnight. See THE THREE-WAY SPLIT."
                )


# ── 10 · the dispatcher must never let this break a run ─────────────────────

def test_the_dispatcher_treats_an_ack_failure_as_non_fatal():
    """Source-read rather than executed: the alternative is a test that mocks a
    pool, and a MagicMock pool echoes fixtures back and would pass against SQL
    that does not run. What matters is the SHAPE of the call site — that the
    ack layer sits inside a try/except that returns the unfiltered result."""
    src = Path("services/skill_dispatcher.py").read_text(encoding="utf-8")
    tree = ast.parse(src)

    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.AsyncFunctionDef) and n.name == "_run_function_step")
    tries = [n for n in ast.walk(fn) if isinstance(n, ast.Try)]
    guarded = [
        t for t in tries
        if "fetch_ack_set" in ast.unparse(t) or "apply_wiring" in ast.unparse(t)
    ]
    assert guarded, (
        "the acknowledgement layer is not inside a try/except in "
        "_run_function_step — a failure there would turn a working skill into a "
        "failed run, and losing a finding entirely is a missed payment"
    )
    assert not any(isinstance(s, ast.Raise) for t in guarded for h in t.handlers
                   for s in ast.walk(h)), "the handler re-raises; it must fall through"
