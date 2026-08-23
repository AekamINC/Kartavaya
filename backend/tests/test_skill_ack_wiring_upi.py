"""
check_upi_reference_threading — the wiring where `why` belongs in MATERIAL and
`recompute` is genuinely None.

Both halves persist by construction. An invoice's number is threaded into its
UPI reference or it is not, and the fix is a change to how codes are RENDERED —
nothing a person can do to one invoice removes it from the list. A firm that has
read the finding, understood it and decided to live with it reads it again every
run.

Two judgements pinned here:
  · `why` is normally the last thing to hash, and is MATERIAL on this skill
    because it is the VERDICT — four different findings about one invoice;
  · `recompute=None` is real. Both lists are truncated to the cap while every
    count around them is measured over the full population.
"""
from __future__ import annotations

from services import skill_ack
from services.skill_ack_wiring import ACK_WIRING, _identity_for, apply_wiring

SKILL = "check_upi_reference_threading"
W = ACK_WIRING[SKILL]

NO_TOKEN = "this invoice carries no payment token, so it has no link and no QR at all"
NO_VPA = ("this organisation has recorded no UPI receiving address, so no QR and "
          "no UPI link is rendered for this invoice")


def _inv(invoice_id="i-1", balance=42000.0, why=NO_TOKEN, **kw) -> dict:
    row = {
        "invoice_id": invoice_id,
        "invoice_number": "INV-1042",
        "customer": "Sharma Traders",
        "invoice_date": "2026-07-01",
        "balance_due": balance,
        "why": why,
        "link": "/vikray/invoices/i-1",
    }
    row.update(kw)
    return row


def _credit(line_id="l-1", amount=42000.0, **kw) -> dict:
    row = {
        "line_id": line_id,
        "statement_date": "2026-08-04",
        "amount": amount,
        "reference": "NEFT/000112",
        "description": "SHARMA TRADERS",
        "why": "nothing in this narration names an invoice",
    }
    row.update(kw)
    return row


def _out(not_threaded=(), credits=()) -> dict:
    return {
        "as_at": "2026-08-23",
        "window_from": "2026-02-24",
        "window_days": 180,
        "builder": "…",
        "payable_states": ["unpaid", "partial"],
        "upi_addresses": {"accounts_table_present": True, "active_accounts": 0,
                          "falls_back_to_org_vpa": False,
                          "can_render_a_upi_code": False},
        "counts": {
            # Every one of these is measured over the FULL population, before
            # the lists below are sliced to the cap.
            "invoices_with_a_live_link": 412,
            "invoices_examined": 200,
            "reference_threaded": 0,
            "reference_not_threaded": 200,
            "credits_examined": 214,
            "credits_naming_an_invoice": 3,
            "credits_naming_nothing": 211,
            "credits_naming_nothing_and_still_open": 180,
            "capped_at": 200,
            "invoices_not_shown": 212,
            "was_capped": True,
        },
        "not_threaded": list(not_threaded),
        "credits_that_name_nothing": list(credits),
        "limitations": ["UPI settles in rupees only."],
    }


def _ack(bucket: str, f: dict, **kw) -> dict[str, skill_ack.Ack]:
    key = skill_ack.finding_key(_identity_for(W, bucket)(f))
    return {key: skill_ack.Ack(finding_key=key,
                               state_hash=skill_ack.state_hash(W.material_of(f)),
                               acknowledged_by="u1", **kw)}


def test_an_acknowledged_invoice_stops_being_reported():
    f = _inv()
    out = apply_wiring(SKILL, _out(not_threaded=[f]), _ack("not_threaded", f))
    assert out["not_threaded"] == []
    assert out["acknowledged"]["items"][0]["label"] == "INV-1042 — Sharma Traders"


def test_an_acknowledged_credit_stops_being_reported():
    f = _credit()
    out = apply_wiring(SKILL, _out(credits=[f]), _ack("credits_that_name_nothing", f))
    assert out["credits_that_name_nothing"] == []


def test_an_invoice_and_a_credit_cannot_share_a_key():
    i = skill_ack.finding_key(_identity_for(W, "not_threaded")(_inv(invoice_id="x")))
    c = skill_ack.finding_key(
        _identity_for(W, "credits_that_name_nothing")(_credit(line_id="x")))
    assert i != c


def test_correcting_the_invoice_number_does_not_orphan_the_acknowledgement():
    """The invoice NUMBER is precisely the string this skill is about, and a
    firm may change it to fix the finding. Keying on it would orphan the ack on
    the very edit that resolves the problem — and the finding would then vanish
    anyway."""
    acks = _ack("not_threaded", _inv(invoice_number="INV-1042"))
    out = apply_wiring(SKILL, _out(not_threaded=[_inv(invoice_number="1042")]), acks)
    assert out["not_threaded"] == []


# ── `why` is the verdict, not decoration ────────────────────────────────────

def test_a_different_reason_is_a_different_finding():
    """"carries no payment token", "no UPI receiving address recorded", "the
    invoice is in USD" and the threading verdict itself are four different
    findings about one invoice. An acknowledgement of one must not cover
    another, which is why `why` is in MATERIAL on this skill and nowhere
    else."""
    acks = _ack("not_threaded", _inv(why=NO_TOKEN))
    out = apply_wiring(SKILL, _out(not_threaded=[_inv(why=NO_VPA)]), acks)
    assert len(out["not_threaded"]) == 1
    assert out["acknowledged"]["count"] == 0


def test_the_same_reason_keeps_the_acknowledgement():
    acks = _ack("not_threaded", _inv(why=NO_TOKEN))
    out = apply_wiring(SKILL, _out(not_threaded=[_inv(why=NO_TOKEN)]), acks)
    assert out["not_threaded"] == []


def test_a_balance_that_moves_brings_the_invoice_back():
    acks = _ack("not_threaded", _inv(balance=42000.0))
    out = apply_wiring(SKILL, _out(not_threaded=[_inv(balance=21000.0)]), acks)
    assert len(out["not_threaded"]) == 1


def test_the_bank_text_and_the_dates_are_not_hashed():
    assert set(W.identity_of(_inv())) == {"invoice_id", "line_id"}
    assert set(W.material_of(_inv())) == {"balance_due", "amount", "why"}
    acks = _ack("credits_that_name_nothing", _credit(reference="NEFT/000112"))
    out = apply_wiring(SKILL, _out(credits=[
        _credit(reference="NEFT/000112/X", description="SHARMA PVT",
                statement_date="2026-08-05")]), acks)
    assert out["credits_that_name_nothing"] == []


# ── recompute is genuinely None ─────────────────────────────────────────────

def test_no_count_is_touched():
    """`recompute=None` is the answer, not an omission. Both lists are sliced
    to the cap while every count around them is measured over the full
    population: `reference_not_threaded` is the length BEFORE the slice,
    `credits_naming_nothing` counts reconciled credits that never reach a list,
    and `invoices_not_shown` exists specifically to say the list is short."""
    assert W.recompute is None
    f = _inv()
    before = _out(not_threaded=[f])
    counts_before = dict(before["counts"])
    out = apply_wiring(SKILL, before, _ack("not_threaded", f))
    assert out["not_threaded"] == []
    assert out["counts"] == counts_before


# ── degenerate shapes ───────────────────────────────────────────────────────

def test_a_finding_with_neither_id_does_not_raise():
    bare = {"why": NO_TOKEN, "balance_due": 1.0}
    out = apply_wiring(SKILL, _out(not_threaded=[bare]), _ack("not_threaded", _inv()))
    assert len(out["not_threaded"]) == 1


def test_one_missing_list_leaves_everything_unfiltered():
    f = _inv()
    data = {"not_threaded": [f], "counts": {}}
    out = apply_wiring(SKILL, data, _ack("not_threaded", f))
    assert len(out["not_threaded"]) == 1
    assert "acknowledged" not in out


def test_the_upi_key_round_trips():
    first = apply_wiring(SKILL, _out(not_threaded=[_inv()]), {"x": skill_ack.Ack("x")})
    f = first["not_threaded"][0]
    acks = {f["_ack_key"]: skill_ack.Ack(finding_key=f["_ack_key"],
                                         state_hash=f["_ack_state"],
                                         acknowledged_by="u1")}
    assert apply_wiring(SKILL, _out(not_threaded=[_inv()]), acks)["not_threaded"] == []
