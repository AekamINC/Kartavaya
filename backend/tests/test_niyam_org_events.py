"""The org-shaped events: low stock and the attendance summary.

Both replace senders from the retired estate (the low-stock "skill" and the
attendance report cron that fails on wrong column names), rebuilt as sweep
predicates so the cadence, the dedupe and the dry-run discipline all come from
the one engine instead of being re-invented per sender.

Neither event has a creator or an assignee — there is nobody IN the payload to
tell — which is what the `@org_admins` token exists for.
"""
from __future__ import annotations

import re

import pytest

from services.niyam import predicates as P

ORG = "11111111-2222-3333-4444-555555555555"


# ── DPDP: the attendance event is counts, and nothing but counts ─────────────

def test_attendance_payload_cannot_name_a_person():
    """The aggregate-only shape is the design, not a current accident: no
    employee id, name, or per-person status may leave the query. Enforced on
    the SELECT list, because that is the only door."""
    sql = P.BY_NAME["attendance_summary"].sql
    for forbidden in ("employee_id", "check_in", "check_out", "notes",
                      "location", "manav_employees"):
        assert forbidden not in sql, (
            f"`{forbidden}` in the attendance summary — a person's attendance "
            f"is DPDP-sensitive and lives behind the module, not in an event log")
    # And structurally: every non-envelope column is an aggregate or the date.
    assert "GROUP BY a.org_id, a.date" in sql


def test_attendance_entity_id_hashes_the_org():
    """An org UUID must never be renderable; the entity id needs distinctness,
    not reversibility, so it carries a hash prefix instead of the id."""
    sql = P.BY_NAME["attendance_summary"].sql
    assert "md5(a.org_id::text)" in sql
    entity_expr = re.search(r"SELECT.*?AS entity_id", sql, re.S).group(0)
    assert "a.org_id::text                      AS entity_id" not in entity_expr


def test_attendance_reports_complete_days_only():
    """Today's numbers move until midnight; a summary that changes after it is
    sent is a wrong one. The window is `once` and the day is in the entity id,
    so 'once per entity' means once per org per day — with catch-up for days
    the sweep slept through."""
    pred = P.BY_NAME["attendance_summary"]
    assert "a.date < NOW()::date" in pred.sql
    assert pred.window == "once"
    assert "|| a.date::text" in pred.sql


# ── stock: the threshold is the opt-in ───────────────────────────────────────

def test_stock_low_cannot_fire_without_a_threshold():
    """`low_stock_threshold` defaults to 0 and `> 0` is in the WHERE: a firm
    that never touched the stock screen is never nagged about it."""
    sql = P.BY_NAME["stock_low"].sql
    assert "s.low_stock_threshold > 0" in sql
    assert "s.quantity_on_hand <= s.low_stock_threshold" in sql


def test_stock_low_skips_services():
    """Consulting hours have no shelf. An alert about 'low stock' of a service
    erodes trust in every alert after it."""
    assert "p.is_service IS NOT TRUE" in P.BY_NAME["stock_low"].sql


def test_stock_low_nags_weekly_not_once():
    """Stock stays low until somebody buys more; a one-off alert about a fact
    that stays true is missed once and never again."""
    assert P.BY_NAME["stock_low"].window == "weekly"


# ── @org_admins ──────────────────────────────────────────────────────────────

class _Conn:
    def __init__(self, admins=(), members=None):
        self.admins = list(admins)
        # membership defaults to "every admin is a member", the true state
        self.members = list(admins) if members is None else list(members)

    async def fetch(self, sql, *a):
        if "role_code IN ('org_admin', 'org_owner')" in sql:
            return [{"user_id": u} for u in self.admins]
        if "user_id = ANY($2::text[])" in sql:
            return [{"user_id": u} for u in a[1] if u in self.members]
        raise AssertionError(f"unexpected fetch: {sql}")


async def test_org_admins_token_expands_to_the_orgs_admins():
    from services.niyam.actions import NotifySend
    conn = _Conn(admins=["user_admin1", "user_admin2"])
    sends = []

    async def fake_deliver(c, **kw):
        from services.niyam.send import Delivery
        sends.append(kw["user_id"])
        return Delivery("ok", "test")

    import services.niyam.send as send_mod
    original = send_mod.deliver
    send_mod.deliver = fake_deliver
    try:
        r = await NotifySend().run(
            conn,
            config={"to": ["@org_admins"], "title": "t", "body": "b"},
            event={"org_id": ORG, "payload": {"after": {}}})
    finally:
        send_mod.deliver = original
    assert r.outcome == "ok"
    assert sends == ["user_admin1", "user_admin2"]


async def test_org_admins_mixed_with_a_named_person_dedupes():
    """An admin also named literally must not be notified twice — the same
    promise resolve_recipients makes for @creator + @assignees overlap."""
    from services.niyam.actions import NotifySend
    conn = _Conn(admins=["user_admin1"], members=["user_admin1", "user_x"])
    sends = []

    async def fake_deliver(c, **kw):
        from services.niyam.send import Delivery
        sends.append(kw["user_id"])
        return Delivery("ok", "test")

    import services.niyam.send as send_mod
    original = send_mod.deliver
    send_mod.deliver = fake_deliver
    try:
        r = await NotifySend().run(
            conn,
            config={"to": ["user_admin1", "@org_admins", "user_x"],
                    "title": "t", "body": "b"},
            event={"org_id": ORG, "payload": {"after": {}}})
    finally:
        send_mod.deliver = original
    assert r.outcome == "ok"
    assert sends == ["user_admin1", "user_x"]


async def test_an_org_with_no_admins_is_an_honest_refusal():
    """Resolving to nobody is a fact about the data, recorded as a refusal —
    the same outcome an unassigned task gives @assignees."""
    from services.niyam.actions import NotifySend
    conn = _Conn(admins=[])
    r = await NotifySend().run(
        conn,
        config={"to": ["@org_admins"], "title": "t", "body": "b"},
        event={"org_id": ORG, "payload": {"after": {}}})
    assert r.outcome == "refused"


# ── both templates survive the same validator a saved rule does ──────────────

@pytest.mark.parametrize("template_id", ["stock-low-tell-admins",
                                         "attendance-absences"])
def test_the_new_templates_validate(template_id):
    from services.niyam.templates import TEMPLATES
    from services.niyam.validate import validate_steps
    [t] = [t for t in TEMPLATES if t["id"] == template_id]
    assert validate_steps(t["event_type"], t["steps"])
    actions = [s["config"] for s in t["steps"] if s["kind"] == "action"]
    assert all(a["to"] == ["@org_admins"] for a in actions)
