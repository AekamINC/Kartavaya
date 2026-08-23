"""
test_skill_ack — the acknowledgement model's judgement, tested without a database.

Everything here exercises `partition_by_ack` / `apply_acks`, which take findings
and an ack set and touch nothing else. That is the whole point of the module's
shape: the bugs in an acknowledgement model are all in the judgement -- is this
the same fact, has it moved, is the snooze still live -- and none of them need a
connection to reproduce. No mock pool appears in this file on purpose
(`mock_pool_hides_bad_sql`): a faked pool would let the module's SQL pass while
being wrong against the real schema, so the SQL is verified by probing the live
catalogue instead, and the judgement is verified here.

The findings below are the real shapes, copied from the handlers:

    propose_payment_run     services/skills/data/payables_run.py
    check_payroll_readiness services/skills/data/payroll_readiness.py
    find_overdue            services/skills/data/overdue_finder.py
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from services.skill_ack import (
    Ack,
    DriftingKeyError,
    MissingMaterialError,
    apply_acks,
    finding_key,
    opaque_ref,
    partition_by_ack,
    sanitise_label,
    state_hash,
)

NOW = datetime(2026, 8, 19, 9, 30, tzinfo=timezone.utc)


# ── the real finding shapes ──────────────────────────────────────────────────

def a_bill(balance=42000.0, days_past_due=63, status="unpaid", bill="INV-2291"):
    """One row of `propose_payment_run`, with its ageing fields intact.

    `days_past_due` and `ageing` are carried deliberately: they are the fields
    that tick on their own, and every test here has to keep working while they
    move, because in production they move every single day.
    """
    return {
        "bill": bill,
        "vendor": "Sharma Traders",
        "vendor_gstin": "27AAAPL1234C1ZV",
        "bill_date": "2026-06-01",
        "due_date": "2026-06-17",
        "total": 42000.0,
        "already_paid": 0.0,
        "balance_due": balance,
        "currency": "INR",
        "status": status,
        "ageing": "61-90",
        "days_past_due": days_past_due,
    }


def a_payroll_blocker(employee="Priya Nair", check="no_salary_structure", amount=None):
    """One row of `check_payroll_readiness.blockers`. Has no id of any kind."""
    out = {"check": check, "employee": employee,
           "detail": "no salary structure effective in this month"}
    if amount is not None:
        out["amount"] = amount
    return out


# The identity/material split for a vendor bill, as a wiring would declare it.
# The bill number says WHICH bill; the balance and status are what movement
# means. `days_past_due` and `ageing` appear in neither -- see THE THREE-WAY
# SPLIT in services/skill_ack.py.
def bill_identity(f):
    return {"bill": f["bill"], "vendor": f["vendor"]}


def bill_material(f):
    return {"balance_due": f["balance_due"], "status": f["status"]}


def payroll_identity(f):
    return {"check": f["check"], "employee": f["employee"]}


def ack_for(finding, identity_of, material_of=None, **kw):
    """Build the Ack a user would have created by acknowledging *finding* now."""
    return Ack(
        finding_key=finding_key(identity_of(finding)),
        state_hash=state_hash(material_of(finding)) if material_of else None,
        acknowledged_by="user_549c9cac35aa",
        acknowledged_at=NOW - timedelta(days=1),
        **kw,
    )


# ═══ 1. an acknowledged finding disappears ══════════════════════════════════

def test_acknowledged_finding_disappears():
    bill = a_bill()
    acks = {a.finding_key: a for a in [ack_for(bill, bill_identity, bill_material)]}

    surviving = apply_acks([bill], acks,
                           identity_of=bill_identity, material_of=bill_material, now=NOW)

    assert surviving == [], "an acknowledged finding must not come back unchanged"


def test_only_the_acknowledged_one_disappears():
    """The ack is per finding, not per skill. Acking one bill must not mute the rest."""
    acked, other = a_bill(bill="INV-2291"), a_bill(bill="INV-3300")
    acks = {a.finding_key: a for a in [ack_for(acked, bill_identity, bill_material)]}

    surviving = apply_acks([acked, other], acks,
                           identity_of=bill_identity, material_of=bill_material, now=NOW)

    assert [f["bill"] for f in surviving] == ["INV-3300"]


def test_ack_survives_the_day_count_ticking():
    """The regression this whole module is built to prevent.

    `days_past_due` and `ageing` change on their own every night. If either
    reached a key, this acknowledgement would be dead by morning and the user
    would face the same 42 rows they cleared yesterday. That is precisely how an
    alert catalogue becomes wallpaper, so it gets its own test rather than being
    left implicit in the ones above.
    """
    yesterday = a_bill(days_past_due=63)
    acks = {a.finding_key: a for a in [ack_for(yesterday, bill_identity, bill_material)]}

    # Same bill, same money, one day later: the counter moved, nothing else did.
    today = a_bill(days_past_due=64)
    today["ageing"] = "61-90"
    much_later = a_bill(days_past_due=200)
    much_later["ageing"] = "90+"

    for later in (today, much_later):
        assert apply_acks([later], acks, identity_of=bill_identity,
                          material_of=bill_material, now=NOW + timedelta(days=137)) == [], \
            "a day counter moving must not resurrect an acknowledged finding"


def test_payroll_finding_with_no_id_is_still_ackable():
    """`check_payroll_readiness` returns a name and a check code and no id at all."""
    blocker = a_payroll_blocker()
    acks = {a.finding_key: a for a in [ack_for(blocker, payroll_identity)]}

    assert apply_acks([blocker], acks, identity_of=payroll_identity, now=NOW) == []

    # A different check against the same employee is a different finding.
    other = a_payroll_blocker(check="missing_bank_details")
    assert apply_acks([other], acks, identity_of=payroll_identity, now=NOW) == [other]


# ═══ 2. a snoozed finding comes BACK when the snooze expires ════════════════

def test_snoozed_finding_is_hidden_then_returns_on_expiry():
    bill = a_bill()
    ack = ack_for(bill, bill_identity, bill_material,
                  snooze_until=NOW + timedelta(days=7))
    acks = {ack.finding_key: ack}

    kw = dict(identity_of=bill_identity, material_of=bill_material)

    # Inside the snooze window: hidden.
    assert apply_acks([bill], acks, now=NOW, **kw) == []
    assert apply_acks([bill], acks, now=NOW + timedelta(days=6, hours=23), **kw) == []

    # The instant it expires, and after: back. Nothing swept the row, nothing
    # re-ran -- the same stored ack simply stops suppressing.
    assert apply_acks([bill], acks, now=NOW + timedelta(days=7), **kw) == [bill]
    assert apply_acks([bill], acks, now=NOW + timedelta(days=30), **kw) == [bill]


def test_expired_snooze_row_is_kept_not_deleted():
    """The row survives expiry so a caller can see this has been pushed back before.

    A list that quietly forgets it has been snoozed three times cannot show
    anyone that the finding is being avoided rather than handled.
    """
    bill = a_bill()
    ack = ack_for(bill, bill_identity, bill_material, snooze_until=NOW - timedelta(days=1))
    acks = {ack.finding_key: ack}

    surviving, suppressed = partition_by_ack(
        [bill], acks, identity_of=bill_identity, material_of=bill_material, now=NOW)

    assert surviving == [bill] and suppressed == []
    assert acks[ack.finding_key].snooze_until is not None, "the ack row must not be consumed"


def test_a_permanent_ack_has_no_snooze_and_never_expires():
    bill = a_bill()
    acks = {a.finding_key: a for a in [ack_for(bill, bill_identity, bill_material)]}
    assert apply_acks([bill], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW + timedelta(days=3650)) == []


# ═══ 3. THE SUBTLE ONE — a changed fact is NOT suppressed ═══════════════════

def test_ack_does_not_suppress_a_finding_whose_amount_moved():
    """Somebody acknowledged a bill of 42,000. It is now 84,000.

    Same vendor, same bill number, so the same `finding_key` -- which is what
    makes this dangerous: a naive `WHERE finding_key NOT IN (...)` hides it, and
    a doubled liability disappears because somebody once said "handled". The
    ack was against a STATE, and the state has moved, so it must resurface.
    """
    acked_at_42k = a_bill(balance=42000.0)
    acks = {a.finding_key: a for a in [ack_for(acked_at_42k, bill_identity, bill_material)]}

    now_84k = a_bill(balance=84000.0)
    assert finding_key(bill_identity(now_84k)) in acks, \
        "precondition: it must be the SAME finding, or this proves nothing"

    surviving = apply_acks([now_84k], acks,
                           identity_of=bill_identity, material_of=bill_material, now=NOW)

    assert surviving == [now_84k], "a moved amount must defeat the acknowledgement"


def test_ack_does_not_suppress_when_a_material_status_moved():
    """Movement is not only money. A status change is a new situation too."""
    acked = a_bill(status="unpaid")
    acks = {a.finding_key: a for a in [ack_for(acked, bill_identity, bill_material)]}

    disputed = a_bill(status="disputed")
    assert apply_acks([disputed], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW) == [disputed]


def test_a_part_payment_resurfaces_the_bill():
    """The realistic version: 42,000 acknowledged, 10,000 paid, 32,000 left.

    Still owed, still the same bill, and no longer the thing anyone agreed to.
    """
    acked = a_bill(balance=42000.0)
    acks = {a.finding_key: a for a in [ack_for(acked, bill_identity, bill_material)]}

    part_paid = a_bill(balance=32000.0)
    part_paid["already_paid"] = 10000.0
    assert apply_acks([part_paid], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW) == [part_paid]


def test_a_moved_amount_defeats_a_live_snooze_too():
    """A snooze is not a shield against the facts changing underneath it."""
    acked = a_bill(balance=42000.0)
    ack = ack_for(acked, bill_identity, bill_material, snooze_until=NOW + timedelta(days=30))
    acks = {ack.finding_key: ack}

    assert apply_acks([a_bill(balance=42000.0)], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW) == [], "unchanged: still snoozed"

    moved = a_bill(balance=84000.0)
    assert apply_acks([moved], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW) == [moved], \
        "changed: the snooze must not hide a doubled liability"


def test_unconditional_ack_survives_a_moved_amount():
    """`state_hash IS NULL` is the deliberate "regardless of movement" record.

    The director with no UAN who will still have no UAN next month. It must be
    reachable, and it must not be what you get by accident -- the tests above
    show the default resurfaces.
    """
    bill = a_bill(balance=42000.0)
    ack = Ack(finding_key=finding_key(bill_identity(bill)), state_hash=None,
              acknowledged_by="user_549c9cac35aa")
    acks = {ack.finding_key: ack}

    assert apply_acks([a_bill(balance=84000.0)], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW) == []


def test_the_state_is_reported_on_the_suppressed_side():
    """A caller must be able to say who acknowledged it, and until when."""
    bill = a_bill()
    ack = ack_for(bill, bill_identity, bill_material,
                  snooze_until=NOW + timedelta(days=3), note="vendor confirmed 30 Aug")
    acks = {ack.finding_key: ack}

    surviving, suppressed = partition_by_ack(
        [bill], acks, identity_of=bill_identity, material_of=bill_material, now=NOW)

    assert surviving == []
    assert suppressed[0]["_ack"]["by"] == "user_549c9cac35aa"
    assert suppressed[0]["_ack"]["note"] == "vendor confirmed 30 Aug"
    assert suppressed[0]["_ack"]["snooze_until"] == NOW + timedelta(days=3)


def test_surviving_findings_are_returned_unmodified():
    """Downstream renders and prompts on these; an extra key changes what it sees."""
    bill = a_bill()
    surviving = apply_acks([bill], {}, identity_of=bill_identity,
                           material_of=bill_material, now=NOW)
    assert surviving == [bill] and "_ack" not in surviving[0]


# ═══ canonicalisation: the same fact must hash the same ═════════════════════

@pytest.mark.parametrize("a, b", [
    (Decimal("42000.00"), 42000.0),   # asyncpg numeric vs the handler's float()
    (Decimal("42000.00"), 42000),
    (42000.0, 42000),
    (Decimal("32000.50"), 32000.50),
])
def test_equal_amounts_hash_equal_however_they_are_spelled(a, b):
    """`float(r["balance_due"])` and the raw `Decimal` are the same money.

    If they hashed differently, a state check would report movement that never
    happened and the finding would resurface for no reason -- wallpaper, reached
    from the other direction.
    """
    assert state_hash({"balance_due": a}) == state_hash({"balance_due": b})


def test_different_amounts_hash_differently():
    assert state_hash({"balance_due": 42000.0}) != state_hash({"balance_due": 42000.01})


def test_true_does_not_collide_with_one():
    """`bool` is a subclass of `int`; an int-first branch would encode True as 1."""
    assert state_hash({"flag": True}) != state_hash({"flag": 1})
    assert state_hash({"flag": False}) != state_hash({"flag": 0})
    assert state_hash({"flag": "1"}) != state_hash({"flag": 1})


def test_none_is_not_an_empty_string():
    assert state_hash({"x": None}) != state_hash({"x": ""})


def test_case_and_whitespace_do_not_split_one_vendor_in_two():
    """The `outbound_log` lesson: a mixed-case value once produced a false negative.

    Here the false negative reads "this was never acknowledged".
    """
    assert finding_key({"vendor": "Sharma Traders"}) == finding_key({"vendor": " sharma traders "})


def test_field_order_does_not_change_the_key():
    """Dict order is how the handler happened to build it, not part of the fact."""
    assert finding_key({"bill": "INV-2291", "vendor": "Sharma Traders"}) == \
           finding_key({"vendor": "Sharma Traders", "bill": "INV-2291"})


def test_a_uuid_may_be_an_input_but_never_the_output():
    """`find_overdue` returns `entity.id`, a raw UUID. Hashing keeps the stability
    and throws away the leak -- and migration 159's CHECK refuses a dashed UUID
    in the column, so this is enforced twice.
    """
    uuid = "9f1c3a2e-4b7d-4c11-9a55-0e2b7d6f8a31"
    key = finding_key({"entity_id": uuid})
    assert key != uuid and "-" not in key
    assert len(key) == 32 and all(c in "0123456789abcdef" for c in key)
    # Stable across calls -- otherwise no ack ever matches twice.
    assert key == finding_key({"entity_id": uuid})


def test_naive_and_aware_snooze_both_compare():
    """A hand-built Ack must not raise the naive/aware TypeError timeutil.py exists for."""
    bill = a_bill()
    naive = Ack(finding_key=finding_key(bill_identity(bill)),
                snooze_until=datetime(2026, 8, 26, 9, 30))     # no tzinfo
    acks = {naive.finding_key: naive}
    assert apply_acks([bill], acks, identity_of=bill_identity, now=NOW) == []
    assert apply_acks([bill], acks, identity_of=bill_identity,
                      now=NOW + timedelta(days=30)) == [bill]


# ═══ the guards ═════════════════════════════════════════════════════════════

@pytest.mark.parametrize("field", ["days_past_due", "days_past", "ageing", "as_of", "age_days"])
def test_time_derived_fields_are_refused_in_a_key(field):
    """Refused loudly at wiring time, because every runtime symptom looks like success.

    In identity these mint a new key daily so no ack matches again; in material
    they void every ack at midnight. The table looks healthy either way.
    """
    with pytest.raises(DriftingKeyError):
        finding_key({"bill": "INV-2291", field: 63})
    with pytest.raises(DriftingKeyError):
        state_hash({"balance_due": 42000.0, field: 63})


def test_the_drift_guard_is_not_case_sensitive():
    with pytest.raises(DriftingKeyError):
        finding_key({"bill": "INV-2291", "Days_Past_Due": 63})


def test_an_empty_identity_is_refused():
    """A key over no fields is one key for every finding: the first ack mutes the skill."""
    with pytest.raises(ValueError):
        finding_key({})


def test_label_strips_contact_details():
    """Aekam staff read this table across orgs; a client's address is not theirs to see."""
    cleaned = sanitise_label("Bill INV-2291 — Sharma Traders (accounts@sharmatraders.co.in)")
    assert "@" not in cleaned and "Sharma Traders" in cleaned

    assert "98765" not in sanitise_label("Priya Nair +91 98765 43210")


def test_label_is_capped():
    assert len(sanitise_label("x" * 5000)) <= 200


@pytest.mark.parametrize("nested", [
    # "all of it is material" -- the obvious wiring, and the one that used to
    # slip past a guard that only read the top level of the bucket.
    lambda f: {"row": f},
    lambda f: {"bill": f["bill"], "meta": {"days_past_due": f["days_past_due"]}},
    lambda f: {"bill": f["bill"], "history": [{"ageing": f["ageing"]}]},
])
def test_the_drift_guard_reaches_nested_fields(nested):
    """A day counter one level down mints a new key nightly just as surely.

    `_canon` recurses, so the guard has to. Before it did, `{"row": finding}`
    hashed `days_past_due` with no error and no log, and the acknowledgement
    was dead by morning -- the exact failure `_DRIFT_FIELDS` exists to stop,
    reached by the one wiring anybody would write first.
    """
    bill = a_bill()
    with pytest.raises(DriftingKeyError):
        finding_key(nested(bill))
    with pytest.raises(DriftingKeyError):
        state_hash(nested(bill))


def test_an_ack_with_a_state_is_not_silently_ignored_when_material_of_is_omitted():
    """Stored WITH a state, filtered WITHOUT one: never matches, hides nothing.

    `record_ack` recommends storing the current state, so this is the default
    ack meeting a caller that forgot `material_of`. The comparison is
    `stored == None`, which is false for every finding for ever -- so every
    acknowledgement this skill holds would suppress nothing and nothing would
    say so. It must raise rather than quietly do nothing.
    """
    bill = a_bill()
    acks = {a.finding_key: a for a in [ack_for(bill, bill_identity, bill_material)]}

    with pytest.raises(MissingMaterialError):
        apply_acks([bill], acks, identity_of=bill_identity, now=NOW)

    # The same ack set with the material_of it was recorded with still works,
    # so the guard is about the mismatch and not about state_hash being present.
    assert apply_acks([bill], acks, identity_of=bill_identity,
                      material_of=bill_material, now=NOW) == []


def test_an_unconditional_ack_still_needs_no_material_of():
    """`state_hash IS NULL` is the deliberate no-material case and must not raise."""
    bill = a_bill()
    ack = Ack(finding_key=finding_key(bill_identity(bill)), state_hash=None,
              acknowledged_by="user_549c9cac35aa")
    assert apply_acks([bill], {ack.finding_key: ack},
                      identity_of=bill_identity, now=NOW) == []


@pytest.mark.parametrize("label, kept", [
    ("Bill INV-2291 dated 2026-06-01 — Sharma Traders", "2026-06-01"),
    ("Bill INV-2291 due 2026-06-17", "2026-06-17"),
    ("Bill INV-2291-000123 — Sharma Traders", "INV-2291-000123"),
    ("GSTIN 27AAAPL1234C1ZV — Sharma Traders", "27AAAPL1234C1ZV"),
    ("Balance 42,000.00 outstanding", "42,000.00"),
])
def test_the_phone_strip_does_not_eat_dates_or_document_numbers(label, kept):
    """The label is the ONLY thing in the row a human can recognise.

    A blob-of-digits phone pattern redacted an ISO date (eight digits and two
    hyphens) and half of a hyphenated bill number, which destroys the field's
    entire purpose while looking like privacy hygiene. Contact details go;
    the fact the label names stays.
    """
    assert kept in sanitise_label(label)


@pytest.mark.parametrize("phone", [
    "Priya Nair +91 98765 43210",
    "Priya Nair 9876543210",
    "Sharma Traders 011-2345-6789",
])
def test_real_phone_numbers_are_still_stripped(phone):
    """Tightening the pattern must not have turned the redaction off."""
    cleaned = sanitise_label(phone)
    assert "[redacted]" in cleaned
    assert sum(c.isdigit() for c in cleaned) == 0


@pytest.mark.parametrize("label", ["", "   ", "accounts@sharmatraders.co.in", "+91 98765 43210"])
def test_a_label_that_redacts_to_nothing_never_costs_the_acknowledgement(label):
    """Migration 159 has CHECK (length(btrim(finding_label)) > 0).

    An empty label is therefore not a poor label, it is a constraint violation
    that throws away the acknowledgement the user just made -- the exact
    inversion of this module's rule that losing the wording beats losing the
    ack. So the empty case gets a placeholder and the INSERT survives.
    """
    out = sanitise_label(label)
    assert out.strip(), "an empty label would be rejected by the CHECK and lose the ack"


# ── opaque_ref · a key for a handler that may not print an id ───────────────

def test_opaque_ref_is_the_same_for_a_uuid_and_its_string():
    """asyncpg returns a `uuid.UUID` for a uuid column and a `str` the moment
    somebody adds `::text` to the SELECT. `_canon` encodes those two
    differently — the UUID falls through to the repr branch — so without the
    stringify, tidying a query would silently orphan every acknowledgement a
    skill holds."""
    import uuid as _uuid
    u = _uuid.uuid4()
    assert opaque_ref(u) == opaque_ref(str(u))
    assert opaque_ref(str(u).upper()) == opaque_ref(str(u))


def test_opaque_ref_separates_two_rows():
    import uuid as _uuid
    assert opaque_ref(_uuid.uuid4()) != opaque_ref(_uuid.uuid4())


def test_opaque_ref_leaks_no_uuid():
    """The whole point: `stock_and_crm` carries a test banning a UUID from
    every field of its output but `link`, and an engagement has no business key
    at all. The digest keeps the stability and renders nothing."""
    import re
    import uuid as _uuid
    ref = opaque_ref(_uuid.uuid4())
    assert re.fullmatch(r"[0-9a-f]{32}", ref)
    assert "-" not in ref


def test_opaque_ref_satisfies_the_finding_key_check_constraint():
    """Same shape as `finding_key`, so it passes migration 159's
    `^[0-9a-f]{16,128}$` if it ever reaches the table directly."""
    import re
    import uuid as _uuid
    assert re.fullmatch(r"[0-9a-f]{16,128}", opaque_ref(_uuid.uuid4()))
