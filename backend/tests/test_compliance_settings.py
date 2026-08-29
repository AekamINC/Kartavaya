"""
Unit tests for workstream H (proposal 80) — "compliance is a setting."

Coverage:
  services/compliance_settings.py — resolve/resolve_states default to
    'applicable', set_rule validates the registry and the state vocabulary
  services/doc_validation.validate_tax_invoice — GSTIN/HSN gaps move between
    hidden / advisory / blocking as the resolved state changes
  GET/PATCH /api/v1/org/compliance/{module}
  routers/pahchan.py — /consent recording, and the opt-out enrollment guard
"""
import pytest
from fastapi import HTTPException

from services import compliance_settings as svc
from services.doc_validation import validate_tax_invoice


# ── services/compliance_settings.py ───────────────────────────────────────────

class _Pool:
    """Bare-minimum async pool double — fetch/fetchval/fetchrow over a list
    the test seeds directly, no query-text routing needed here."""
    def __init__(self, rows=None):
        self.rows = rows or []
        self.last_insert = None

    async def fetch(self, query, *args):
        return self.rows

    async def fetchrow(self, query, *args):
        # set_rule's upsert — return a plausible row reflecting the call.
        self.last_insert = args
        org_id, module, rule_key, state, set_by, reason = args
        return {
            "rule_key": rule_key, "state": state, "set_by": set_by,
            "set_at": None, "reason": reason,
        }


async def test_resolve_defaults_to_applicable_with_no_rows():
    pool = _Pool(rows=[])
    out = await svc.resolve(pool, "org1", "ganit")
    assert out["hsn_required"]["state"] == "applicable"
    assert out["gstin_required"]["state"] == "applicable"
    assert out["hsn_required"]["set_by"] is None


async def test_resolve_reflects_a_saved_row():
    pool = _Pool(rows=[{"rule_key": "hsn_required", "state": "enforced", "set_by": "user_x", "set_at": None, "reason": "we always need HSN"}])
    out = await svc.resolve(pool, "org1", "ganit")
    assert out["hsn_required"]["state"] == "enforced"
    assert out["hsn_required"]["reason"] == "we always need HSN"
    # A row for a key not in the registry is silently ignored — the
    # registry defines what a module's settings ARE, not the table.
    assert "unknown_key" not in out


async def test_resolve_states_is_the_bare_dict():
    """Values only — no label, no consequence, no actor.

    Asserted per key rather than against the whole dict. It WAS the whole
    dict, and that made the registry growing by one rule a failure here:
    Ganit gained four recorded-only applicability settings and this test
    broke, in a file about the resolver, naming nothing that had gone wrong.
    The claim is the SHAPE — one bare state per known key, the stored value
    where there is a row and the default where there is not.
    """
    pool = _Pool(rows=[{"rule_key": "gstin_required", "state": "not_applicable", "set_by": None, "set_at": None, "reason": None}])
    states = await svc.resolve_states(pool, "org1", "ganit")
    assert states["gstin_required"] == "not_applicable"
    assert states["hsn_required"] == "applicable"
    assert set(states) == set(svc.rules_for("ganit"))
    assert all(isinstance(v, str) for v in states.values())


async def test_set_rule_rejects_unknown_module_rule():
    pool = _Pool()
    with pytest.raises(ValueError, match="not a compliance setting"):
        await svc.set_rule(pool, "org1", "ganit", "not_a_real_rule", "enforced", set_by="user_x")


async def test_set_rule_rejects_bad_state():
    pool = _Pool()
    with pytest.raises(ValueError, match="not a valid state"):
        await svc.set_rule(pool, "org1", "ganit", "hsn_required", "sort_of", set_by="user_x")


async def test_set_rule_accepts_a_valid_write():
    pool = _Pool()
    row = await svc.set_rule(pool, "org1", "ganit", "hsn_required", "enforced", set_by="user_x", reason="strict shop")
    assert row["state"] == "enforced"
    assert row["reason"] == "strict shop"


# ── services/doc_validation.validate_tax_invoice ──────────────────────────────

_ORG = {"name": "Test Firm", "gstin": None}
_CONTACT = {"name": "A Customer"}
_INVOICE_NO_HSN = {
    "invoice_type": "tax_invoice", "invoice_number": "INV-1", "invoice_date": "2026-08-23",
    "line_items": [{"description": "Widget", "hsn_code": "", "sac_code": ""}],
}


def test_hsn_gap_is_advisory_by_default_unchanged_behaviour():
    """No compliance_states argument at all — every existing caller that has
    not been touched must see EXACTLY today's behaviour: advisory, not
    blocking."""
    chk = validate_tax_invoice(_INVOICE_NO_HSN, _ORG, _CONTACT)
    assert chk.ok  # not blocking
    assert any(g.field == "invoice.line_items.hsn_code" for g in chk.advisory)


def test_hsn_gap_disappears_when_not_applicable():
    chk = validate_tax_invoice(
        _INVOICE_NO_HSN, _ORG, _CONTACT,
        compliance_states={"hsn_required": "not_applicable"},
    )
    assert chk.ok
    assert not any(g.field == "invoice.line_items.hsn_code" for g in chk.advisory)
    assert not any(g.field == "invoice.line_items.hsn_code" for g in chk.blocking)


def test_hsn_gap_blocks_when_enforced():
    chk = validate_tax_invoice(
        _INVOICE_NO_HSN, _ORG, _CONTACT,
        compliance_states={"hsn_required": "enforced"},
    )
    assert not chk.ok
    assert any(g.field == "invoice.line_items.hsn_code" for g in chk.blocking)
    assert not any(g.field == "invoice.line_items.hsn_code" for g in chk.advisory)


def test_gstin_gap_moves_the_same_way():
    invoice = {**_INVOICE_NO_HSN, "line_items": [{"description": "Widget", "hsn_code": "1234"}]}
    default = validate_tax_invoice(invoice, _ORG, _CONTACT)
    assert default.ok and any(g.field == "org.gstin" for g in default.advisory)

    enforced = validate_tax_invoice(invoice, _ORG, _CONTACT, compliance_states={"gstin_required": "enforced"})
    assert not enforced.ok and any(g.field == "org.gstin" for g in enforced.blocking)

    na = validate_tax_invoice(invoice, _ORG, _CONTACT, compliance_states={"gstin_required": "not_applicable"})
    assert na.ok and not any(g.field == "org.gstin" for g in na.advisory)


def test_mandatory_fields_still_block_regardless_of_compliance_settings():
    """Invoice number/date are the two things proposal 80 says should NOT be
    a setting at all — confirm compliance_states cannot touch them."""
    invoice = {**_INVOICE_NO_HSN, "invoice_number": ""}
    chk = validate_tax_invoice(
        invoice, _ORG, _CONTACT, compliance_states={"hsn_required": "not_applicable", "gstin_required": "not_applicable"},
    )
    assert not chk.ok
    assert any(g.field == "invoice.invoice_number" for g in chk.blocking)


# ── GET/PATCH /api/v1/org/compliance/{module} ─────────────────────────────────

#: `as_admin` wires the ROLE check but does not touch `get_org_id` fully —
#: with no `X-Org-Id` header it falls through to "resolve my earliest org"
#: (403), and even WITH a header, `get_org_id` makes its own `fetchrow` call
#: confirming `staging.organisations` has an active row for it — a query
#: `as_admin` does not know about, since it only wraps `fetchval`. Every
#: test below supplies both the header and that row.
_ORG_ID = "11111111-1111-1111-1111-111111111111"
_ORG_HEADER = {"X-Org-Id": _ORG_ID}


def _route_fetchrow(rules):
    """`{query substring: value}` -> an asyncpg-shaped fetchrow side_effect.
    Always answers the `get_org_id` organisation-exists check, since every
    org-scoped route in this file needs it and forgetting it is a 404 that
    reads exactly like the test's OWN 404 assertion — see the incident this
    comment exists because of, two commits up."""
    base = {"SELECT id FROM public.organisations WHERE id=$1::uuid AND is_active=TRUE": {"id": _ORG_ID}}
    merged = {**base, **rules}

    async def _side_effect(query, *args):
        for needle, value in merged.items():
            if needle in query:
                return value(*args) if callable(value) else value
        return None
    return _side_effect


async def test_get_compliance_settings(api_client, mock_pool, as_admin):
    mock_pool.fetch.return_value = []
    mock_pool.fetchrow.side_effect = _route_fetchrow({})
    resp = await api_client.get("/api/v1/org/compliance/ganit", headers=_ORG_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["module"] == "ganit"
    assert data["rules"]["hsn_required"]["state"] == "applicable"


async def test_get_compliance_settings_unknown_module(api_client, mock_pool, as_admin):
    mock_pool.fetchrow.side_effect = _route_fetchrow({})
    resp = await api_client.get("/api/v1/org/compliance/not_a_module", headers=_ORG_HEADER)
    assert resp.status_code == 404
    assert "compliance settings" in resp.json()["detail"]


async def test_patch_compliance_setting(api_client, mock_pool, as_admin):
    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "INSERT INTO public.module_compliance_settings":
            {"rule_key": "hsn_required", "state": "enforced", "set_by": "user_admin001", "set_at": None, "reason": "strict"},
    })
    resp = await api_client.patch("/api/v1/org/compliance/ganit", headers=_ORG_HEADER, json={
        "rule_key": "hsn_required", "state": "enforced", "reason": "strict",
    })
    assert resp.status_code == 200
    assert resp.json()["state"] == "enforced"


async def test_patch_compliance_setting_rejects_unknown_rule(api_client, mock_pool, as_admin):
    mock_pool.fetchrow.side_effect = _route_fetchrow({})
    resp = await api_client.patch("/api/v1/org/compliance/ganit", headers=_ORG_HEADER, json={
        "rule_key": "not_a_real_rule", "state": "enforced",
    })
    assert resp.status_code == 400


def _route_fetchval(rules):
    async def _side_effect(query, *args):
        for needle, value in rules.items():
            if needle in query:
                return value(*args) if callable(value) else value
        return 0
    return _side_effect


async def test_record_employee_consent_requires_admin(api_client, mock_pool, admin_user, app):
    """A member without org_admin/org_owner must not be able to record
    consent for someone else — same gate as viewing biometrics. The one
    pahchan test kept at the full HTTP layer, because the thing under test
    IS a gate (`_may_view_others_biometrics`) rather than the guard logic
    the direct-call tests below exercise — a real 403 through the whole
    stack is the stronger claim for a refusal."""
    from auth_router import require_user
    member = {**admin_user, "user_id": "user_member001", "role": "member"}
    app.dependency_overrides[require_user] = lambda: member
    mock_pool.fetchval.side_effect = _route_fetchval({
        "org_id IS NULL": None,
        "org_id=$2::uuid": None,
    })
    resp = await api_client.post("/api/v1/pahchan/consent", headers=_ORG_HEADER, json={
        "employee_id": "11111111-1111-1111-1111-111111111111",
        "method": "paper", "consented": True,
    })
    assert resp.status_code == 403
    app.dependency_overrides.pop(require_user, None)


# ── Direct handler calls ───────────────────────────────────────────────────────
#
# `enroll_photo` and `record_employee_consent` sit behind `require_module`,
# `get_org_id` and a live-subscription check — three pre-existing gates that
# are none of workstream H's business and are already covered by their own
# test suites elsewhere. Driving them through the full HTTP stack here would
# mean re-deriving `require_module`'s platform/Gate-2/subscription branches
# query-by-query just to reach code these tests do not actually examine.
# Calling the handler directly supplies `user`/`org_id` the way FastAPI's
# `Depends` would have resolved them, and exercises exactly the two things
# this file is about: the consent write, and the opt-out guard reading it.

class _FakeRequest:
    """Just enough for `services.audit.emit`, which the handlers call."""
    headers: dict = {}
    client = None


_OWNER = {"user_id": "user_owner001"}
_EMPLOYEE_UUID = "11111111-1111-1111-1111-111111111111"


async def test_record_employee_consent_opt_out(mock_pool):
    from routers.pahchan import EmployeeConsentBody, record_employee_consent

    mock_pool.fetchval.side_effect = _route_fetchval({
        # `_may_view_others_biometrics` — the org_owner admitted by row.
        "public.user_roles": 1,
    })
    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT id FROM public.manav_employees": {"id": "emp_1"},
        "INSERT INTO public.pahchan_employee_consents": {
            "id": "c1", "employee_id": "emp_1", "notice_version": "2026-08-06.1",
            "method": "paper", "consented": False, "recorded_by": "user_owner001",
            "recorded_at": None, "note": "declined, prefers badge",
        },
    })

    body = EmployeeConsentBody(
        employee_id=_EMPLOYEE_UUID, method="paper", consented=False,
        note="declined, prefers badge",
    )
    result = await record_employee_consent(
        body, _FakeRequest(), user=_OWNER, org_id=_ORG_ID, _g=None,
    )
    assert result["consented"] is False


async def test_enrollment_refused_for_opted_out_employee(mock_pool):
    from routers.pahchan import EnrollBody, enroll_photo

    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT user_id FROM public.manav_employees": {"user_id": None},
    })
    mock_pool.fetchval.side_effect = _route_fetchval({
        "public.user_roles": 1,  # _may_view_others_biometrics — admitted
        "SELECT consented FROM public.pahchan_employee_consents": False,
    })

    body = EnrollBody(
        employee_id=_EMPLOYEE_UUID, slot=1,
        object_key="pahchan/ref/x.jpg", source="hr_upload",
    )
    with pytest.raises(HTTPException) as exc:
        await enroll_photo(body, _FakeRequest(), user=_OWNER, org_id=_ORG_ID, _g=None)
    assert exc.value.status_code == 409
    assert "declined" in exc.value.detail


async def test_enrollment_proceeds_when_no_optout_recorded(mock_pool):
    """The opt-out guard must not fire on ordinary enrolment — no consent
    row at all is not an opt-out."""
    from routers.pahchan import EnrollBody, enroll_photo

    mock_pool.fetchrow.side_effect = _route_fetchrow({
        "SELECT user_id FROM public.manav_employees": {"user_id": None},
        "INSERT INTO public.pahchan_enrollment_photos":
            {"id": "photo_1", "slot": 1, "source": "hr_upload", "approved_at": None},
    })
    mock_pool.fetchval.side_effect = _route_fetchval({
        "public.user_roles": 1,  # _may_view_others_biometrics — admitted
        # No override for the consent query — default 0 -> not opted out.
    })

    body = EnrollBody(
        employee_id=_EMPLOYEE_UUID, slot=1,
        object_key="pahchan/ref/x.jpg", source="hr_upload",
    )
    result = await enroll_photo(body, _FakeRequest(), user=_OWNER, org_id=_ORG_ID, _g=None)
    assert result["id"] == "photo_1"
