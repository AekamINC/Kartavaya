"""FOUR FINISHED REGISTERS, REACHABLE BY NOTHING.

`services/custody/` holds `dsc.py`, `udin.py`, `notices.py` and
`offboarding.py` — four modules, ~2,800 lines, all four tested, all four over
tables that are applied and live. `ls backend/routers/ | grep custody` returned
nothing.

Measured against the live database on 2026-08-21, SELECT only:

    staging.dsc_register                 0 rows
    staging.udin_register                0 rows
    staging.notice_register              0 rows
    staging.manav_offboarding_custody    0 rows
    staging.notice_type                  7 rows
    staging.udin_window                  2 rows
    staging.manav_offboarding           11 rows

Zero is what a register with no reader and no writer contains. This file pins
the reader, and it pins the four judgements the router had to make that no
service module makes for it:

  1. Self scope is REFUSED. Manav admits a caller with no grant at all to their
     own row; none of these registers is anybody's own row.
  2. The notice register is gated higher than the module — `notices.py`
     declined to specify an access rule and warned against mounting it without
     one.
  3. A `CrossOrgLeak` is NOT a 422. It means the SQL is wrong.
  4. No login id leaves the ledger, even though the service returns three.

── WHAT THIS FILE DELIBERATELY DOES NOT ASSERT ──────────────────────────────

That `server.py` includes the router. It does not yet — registration is the
owner's line to add, and a test asserting it would be red for a reason that is
not a defect. `routers/support_sessions.py` is the standing example of what
happens when nobody adds it: 401 complete lines, unreachable for weeks. Add
this assertion the moment the two lines land:

    import server
    assert "app.include_router(custody_router)" in inspect.getsource(server)
"""
from __future__ import annotations

import inspect
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from routers import custody as custody_mod

ORG = "00000000-0000-0000-0000-000000000001"
OTHER_ORG = "00000000-0000-0000-0000-0000000000ff"
TODAY = date(2026, 8, 21)

CALLER = {
    "user_id": "user_admin001",
    "email": "admin@test.com",
    "name": "Test Admin",
    "full_name": "Test Admin",
    "role": "admin",
}


def dsc_row(**over):
    """One `staging.dsc_register` record as `dsc._SELECT` returns it.

    `org_id` is present because `dsc._shape` reads it for the tenancy guard and
    RAISES when it disagrees — that guard is what makes a cross-org assertion
    mean anything against a mock pool, and a fixture row without it would turn
    every test in this file into a CrossOrgLeak.
    """
    row = {
        "org_id": ORG,
        "client_id": "c0000000-0000-0000-0000-000000000001",
        "id": "d0000000-0000-0000-0000-000000000001",
        "client_name": "Sharma Textiles Pvt Ltd",
        "holder_name": "Anil Sharma",
        "holder_kind": "individual",
        "holder_designation": "Director",
        "holder_pan": "", "holder_din": "",
        "certificate_class": "class_3",
        "certificate_type": "signature",
        "issuing_authority": "emudhra",
        "serial_number": "7F 21 AA",
        "valid_from": date(2025, 3, 1),
        "valid_to": date(2027, 2, 28),
        "revoked_on": None,
        "custody_status": "with_firm",
        "custody_location": "Cabinet 2",
        "custody_holder_name": "Front desk",
        "custody_changed_on": None,
        "token_kind": "usb_token",
        "token_serial": "TK-9",
        "registered_portals": ["mca"],
        "notes": "", "is_active": True,
        "created_at": None, "updated_at": None,
    }
    row.update(over)
    return row


def notice_row(**over):
    row = {
        "org_id": ORG,
        "reference_no": "ZA2708260001",
        "received_on": date(2026, 8, 1),
        "due_on": date(2026, 8, 31),
        "due_date_from_notice": False,
        "window_in_working_days": False,
        "status": "open",
        "replied_on": None,
        "notes": "",
        "client_name": "Sharma Textiles Pvt Ltd",
        "notice_type": "gst_asmt_10",
        "notice_type_label": "Scrutiny of returns",
        "authority": "gst",
        "form_no": "ASMT-10",
        "reply_form_no": "ASMT-11",
        "statute_ref": "", "statute_key": "",
        "window_basis": "statutory_max",
        "consequence": "s.73/74 determination",
        "source_url": "",
        "owner_name": "Priya Sharma",
    }
    row.update(over)
    return row


def udin_row(**over):
    row = {
        "id": "u0000000-0000-0000-0000-000000000001",
        "client_name": "Sharma Textiles Pvt Ltd",
        "document_kind": "certificate",
        "document_title": "Net worth certificate",
        "document_ref": "NW/26/11",
        "financial_year": "2026-27",
        "signed_on": date(2026, 8, 1),
        "signed_by_member": "CA Anil Sharma",
        "signed_by_membership_no": "304576",
        "source_module": "ganit",
        "notes": "",
    }
    row.update(over)
    return row


# ── the app under test ───────────────────────────────────────────────────────
#
# A LOCAL app rather than `server.app`, because the router is not registered on
# `server.app` yet (see the module docstring). Everything else is identical to
# how the app wires a router: the same limiter singleton, so the rate limits on
# two of these routes are the real ones and the autouse `reset_rate_limits`
# fixture in conftest still empties them between tests.

@pytest.fixture
def custody_app():
    from fastapi import FastAPI
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

    from auth_router import require_user
    from limiter import limiter
    from middleware.org_resolver import get_org_id

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(custody_mod.router)

    app.dependency_overrides[custody_mod._gate] = lambda: frozenset({"admin"})
    app.dependency_overrides[custody_mod._notice_gate] = lambda: CALLER
    app.dependency_overrides[get_org_id] = lambda: ORG
    app.dependency_overrides[require_user] = lambda: CALLER
    return app


@pytest.fixture
async def cc(custody_app):
    async with AsyncClient(
        transport=ASGITransport(app=custody_app), base_url="http://test"
    ) as client:
        yield client


@pytest.fixture
def levels(custody_app):
    """Say what the caller holds on Manav for one test."""
    def _set(*held):
        custody_app.dependency_overrides[custody_mod._gate] = (
            lambda: frozenset(held)
        )
    return _set


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The router exists at all
# ══════════════════════════════════════════════════════════════════════════════

def test_every_service_function_has_a_route():
    """The defect. Four modules, four applied tables, and no HTTP surface.

    Listed one by one rather than counted: a count passes when a route is
    renamed and its screen 404s.
    """
    paths = {r.path for r in custody_mod.router.routes}
    for expected in (
        "/api/v1/custody/dsc",
        "/api/v1/custody/dsc/expiring",
        "/api/v1/custody/dsc/expired",
        "/api/v1/custody/dsc/unusable",
        "/api/v1/custody/dsc/not-in-possession",
        "/api/v1/custody/dsc/by-client/{client_id}",
        "/api/v1/custody/dsc/firm-own",
        "/api/v1/custody/udin/windows",
        "/api/v1/custody/udin/at-risk",
        "/api/v1/custody/udin/revocable",
        "/api/v1/custody/udin/summary",
        "/api/v1/custody/udin/syntax",
        "/api/v1/custody/notices",
        "/api/v1/custody/notices/overdue",
        "/api/v1/custody/notices/types",
        "/api/v1/custody/notices/by-client/{client_id}",
        "/api/v1/custody/offboarding/{employee_id}",
        "/api/v1/custody/offboarding/{employee_id}/ledger",
        "/api/v1/custody/offboarding/inherited/me",
        "/api/v1/custody/offboarding/{employee_id}/lines",
    ):
        assert expected in paths, f"{expected} is missing; have {sorted(paths)}"


def test_the_router_contains_no_sql():
    """Every statement lives in a service module, schema-qualified and bound.

    A second implementation of a window or a tenancy predicate written into a
    router is one no test looks at — which is how `staging.` gets forgotten and
    a shadow table in `public` answers instead (migration 142).
    """
    src = inspect.getsource(custody_mod)
    tree = __import__("ast").parse(src)
    ast = __import__("ast")
    for node in ast.walk(tree):
        if (isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                              ast.AsyncFunctionDef))
                and ast.get_docstring(node) is not None):
            node.body = node.body[1:]
    code = ast.unparse(tree)
    for word in ("SELECT ", "INSERT ", "UPDATE ", "DELETE FROM"):
        assert word not in code, f"{word.strip()} is written into the router"


# ══════════════════════════════════════════════════════════════════════════════
#  2 · as_of — defaulted when absent, refused when malformed
# ══════════════════════════════════════════════════════════════════════════════

def test_an_absent_as_of_means_today():
    assert custody_mod._parse_as_of(None) == datetime.now(timezone.utc).date()
    assert custody_mod._parse_as_of("") == datetime.now(timezone.utc).date()


def test_a_malformed_as_of_is_refused_not_guessed():
    """`31-03-2026` is what a person types. Answering it with today's position
    tells them something false about a deadline, and every register in this
    file is a deadline."""
    with pytest.raises(Exception) as exc:
        custody_mod._parse_as_of("31-03-2026")
    assert "as_of" in str(exc.value)


def test_a_good_as_of_survives_intact():
    assert custody_mod._parse_as_of("2026-04-01") == date(2026, 4, 1)


def test_limit_is_capped_server_side():
    assert custody_mod._parse_limit(10_000, 200) == custody_mod.MAX_LIMIT
    assert custody_mod._parse_limit(None, 200) == 200
    with pytest.raises(Exception):
        custody_mod._parse_limit(0, 200)


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The access rule
# ══════════════════════════════════════════════════════════════════════════════

async def test_self_scope_is_refused_on_every_register(cc, levels, mock_pool):
    """Manav admits a caller with NO grant, self-scoped to their own row.

    A client's DSC register, a UDIN backlog, a notice register and another
    person's exit are none of them the caller's own row. The empty level set
    must stop at this router's door — and it is the level set every employee in
    the organisation has by default.
    """
    levels()  # holds nothing
    mock_pool.fetch.return_value = []
    for path in ("/api/v1/custody/dsc",
                 "/api/v1/custody/udin/at-risk",
                 "/api/v1/custody/notices",
                 "/api/v1/custody/offboarding/e0000000-0000-0000-0000-000000000001"):
        resp = await cc.get(path)
        assert resp.status_code == 403, (path, resp.status_code, resp.text)


async def test_a_viewer_reads_but_cannot_record(cc, levels, mock_pool):
    levels("viewer")
    mock_pool.fetch.return_value = []
    assert (await cc.get("/api/v1/custody/dsc")).status_code == 200
    resp = await cc.post(
        "/api/v1/custody/offboarding/e0000000-0000-0000-0000-000000000001/lines",
        json={"action": "revoke", "subject_type": "role_grant",
              "subject_label": "org_member"},
    )
    assert resp.status_code == 403


def test_the_notice_register_is_gated_above_the_module():
    """`services/custody/notices.py`: "This module answers 'which of our clients
    are under assessment'. That is the most commercially sensitive question the
    product can answer … DO NOT mount these functions behind a router" until an
    access rule exists.

    The rule is org_owner / org_admin — the same bar `routers/manav.py` puts on
    reading an employee's Aadhaar. Deliberately NOT `hr_admin`, which reaches
    every Manav route through the module gate alone and has no business in a
    client's assessment list.
    """
    from middleware.role_tiers import HR_ADMIN_ROLES, ORG_MANAGEMENT_ROLES

    assert custody_mod._notice_gate is not None
    for name in ("notice_register", "notice_overdue", "notice_types",
                 "notice_client_history"):
        handler = getattr(custody_mod, name)
        params = inspect.signature(handler).parameters
        assert "_admin" in params, f"{name} is not behind the notice gate"
    assert set(ORG_MANAGEMENT_ROLES).isdisjoint(HR_ADMIN_ROLES)


async def test_the_notice_gate_refusal_is_a_403_not_an_empty_list(
    custody_app, cc, mock_pool,
):
    """A refused caller must not be told the register is empty. Every register
    in this product has been empty for real, so "no rows" is a sentence a
    reader believes."""
    from fastapi import HTTPException

    def _refuse():
        raise HTTPException(403, "nope")

    custody_app.dependency_overrides[custody_mod._notice_gate] = _refuse
    resp = await cc.get("/api/v1/custody/notices")
    assert resp.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
#  4 · DSC
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_dsc_register_carries_every_status_key_at_zero(cc, mock_pool):
    """An empty register is the live state of all three client registers today.

    `summarise` zero-fills on purpose: a dashboard that renders only the keys it
    was given shows nothing at all where "0 expired" is the reassuring thing the
    reader came for, and an absent key is indistinguishable from a query that
    failed.
    """
    mock_pool.fetch.return_value = []
    resp = await cc.get("/api/v1/custody/dsc?as_of=2026-08-21")
    assert resp.status_code == 200
    body = resp.json()
    assert body["as_of"] == "2026-08-21"
    assert body["count"] == 0
    assert body["summary"] == {
        "usable": 0, "not_in_possession": 0, "not_yet_valid": 0,
        "expired": 0, "revoked": 0, "total": 0,
    }


async def test_a_dsc_row_comes_back_as_a_verdict_not_a_date(cc, mock_pool):
    """`status` folds expiry, revocation, a not-yet-live certificate AND custody
    into one answer. A token handed back to the client in March stops a filing
    exactly as dead as one that expired in March."""
    mock_pool.fetch.return_value = [dsc_row(custody_status="with_client")]
    body = (await cc.get("/api/v1/custody/dsc?as_of=2026-08-21")).json()
    row = body["data"][0]
    assert row["status"] == "not_in_possession"
    assert row["client_name"] == "Sharma Textiles Pvt Ltd"
    assert row["issuing_authority_canonical"] == "e-Mudhra"
    assert body["summary"]["not_in_possession"] == 1


async def test_no_org_or_client_uuid_reaches_the_wire(cc, mock_pool):
    """The service drops both before returning. Asserted at the HTTP boundary
    too, because that is where a rendered id would actually be served from."""
    mock_pool.fetch.return_value = [dsc_row()]
    row = (await cc.get("/api/v1/custody/dsc")).json()["data"][0]
    assert "org_id" not in row
    assert "client_id" not in row


async def test_the_expiry_window_is_inclusive_at_both_ends(cc, mock_pool):
    """`days=0` is "dies today, still works today" — not "already expired".

    The bound values are asserted rather than the returned rows, because the
    suite runs against a MagicMock pool and a mock pool hides bad SQL: the
    window is a predicate the database applies, so the only thing a unit test
    can honestly prove is what was bound.
    """
    mock_pool.fetch.return_value = []
    await cc.get("/api/v1/custody/dsc/expiring?days=0&as_of=2026-08-21")
    args = mock_pool.fetch.call_args[0]
    assert args[1] == ORG
    assert args[2] == TODAY
    assert args[3] == 0
    assert ">= $2::date" in args[0] and "<= ($2::date + $3::int)" in args[0]


async def test_firm_own_and_by_client_are_two_routes_on_purpose(cc, mock_pool):
    """`dsc.for_client(client_id=None)` means THE PRACTICE'S OWN certificates —
    the partners' DSCs a firm holds for its own signing — and NOT "all clients".

    One route with an optional `client_id` would turn an omitted query parameter
    into that meaning by accident, which is the misreading the service docstring
    warns about three separate times.
    """
    mock_pool.fetch.return_value = []
    await cc.get("/api/v1/custody/dsc/firm-own")
    assert mock_pool.fetch.call_args[0][3] is None

    await cc.get("/api/v1/custody/dsc/by-client/c0000000-0000-0000-0000-000000000001")
    assert mock_pool.fetch.call_args[0][3] == "c0000000-0000-0000-0000-000000000001"


async def test_a_cross_org_row_is_not_served_as_a_422(cc, mock_pool):
    """`CrossOrgLeak` means the WHERE clause is wrong and another practice's
    client name nearly reached this screen. It must NOT be dressed up as a
    client error — a 422 is a thing the caller did, and this is not."""
    mock_pool.fetch.return_value = [dsc_row(org_id=OTHER_ORG)]
    with pytest.raises(Exception) as exc:
        await cc.get("/api/v1/custody/dsc")
    assert "CrossOrgLeak" in type(exc.value).__name__ or "different org" in str(exc.value)


# ══════════════════════════════════════════════════════════════════════════════
#  5 · UDIN
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_udin_window_says_where_its_number_came_from(cc, mock_pool):
    """'table' when `staging.udin_window` answered (2 rows live), 'icai-default'
    when a constant compiled into the build did. The generation window has
    already moved once — 15 days to 60, Council's 405th meeting, 17 Sep 2021 —
    so a firm reading a deadline is entitled to know which number it is."""
    mock_pool.fetch.return_value = []
    body = (await cc.get("/api/v1/custody/udin/windows?as_of=2026-08-21")).json()
    assert body["generate_days"] == 60
    assert body["revoke_hours"] == 48
    assert body["sources"] == {"generate": "icai-default", "revoke": "icai-default"}


async def test_a_table_row_overrides_the_compiled_default(cc, mock_pool):
    mock_pool.fetch.return_value = [{
        "window_key": "generate", "window_amount": 45, "window_unit": "days",
        "effective_from": date(2026, 1, 1), "effective_to": None,
    }]
    body = (await cc.get("/api/v1/custody/udin/windows?as_of=2026-08-21")).json()
    assert body["generate_days"] == 45
    assert body["sources"]["generate"] == "table"


async def test_the_last_day_of_the_udin_window_is_not_lapsed(cc, mock_pool):
    """Both end dates count (ICAI FAQ Q19), so a 60-day window from the 1st ends
    on `signed_on + 59` and `days_left == 0` means TODAY IS THE LAST DAY.

    Writing the obvious `+ 60` hands a firm a day it does not have, and the day
    it hands them is the last one — when somebody is finally looking.
    """
    signed = TODAY - timedelta(days=59)
    mock_pool.fetch.side_effect = [[], [udin_row(signed_on=signed)]]
    body = (await cc.get("/api/v1/custody/udin/at-risk?as_of=2026-08-21")).json()
    row = body["data"][0]
    assert row["days_left"] == 0
    assert row["is_lapsed"] is False
    assert row["urgency"] == "last_day"
    assert row["generate_by"] == TODAY.isoformat()


async def test_the_udin_summary_reports_lapsed_which_is_not_a_status(cc, mock_pool):
    """`lapsed` is the only figure here that represents something already
    unfixable, and it cannot be a stored status: whether the window has closed
    is a fact about today, and a stored copy is wrong between midnight and
    whenever a job gets round to flipping it."""
    lapsed_signing = TODAY - timedelta(days=200)
    mock_pool.fetch.side_effect = [
        [],                                              # udin_window
        [{"status": "signed", "n": 1}],                  # status counts
        [{"signed_on": lapsed_signing}],                 # open dates
    ]
    body = (await cc.get("/api/v1/custody/udin/summary?as_of=2026-08-21")).json()
    assert body["lapsed"] == 1
    assert body["open_by_urgency"]["lapsed"] == 1
    assert "lapsed" not in body["by_status"]


async def test_revocable_uses_the_server_clock_not_the_callers(cc, mock_pool):
    """The 48 hours run from an INSTANT. A caller-supplied "now" would let a
    browser with a wrong clock be told it can still revoke something it cannot —
    and a revocation is not an undo: past the window the member must generate a
    fresh UDIN inside whatever is left of the sixty days."""
    params = inspect.signature(custody_mod.udin_revocable).parameters
    assert "now" not in params
    mock_pool.fetch.side_effect = [[], []]
    body = (await cc.get("/api/v1/custody/udin/revocable")).json()
    assert body["count"] == 0
    assert body["now"]


async def test_a_udin_is_described_never_rejected(cc):
    """ADVISORY ONLY, exactly like GSTIN, PAN and TAN. A validator that encoded
    the published syntax would refuse to record a REAL UDIN the day ICAI changes
    its generator, and a register that cannot record the truth is worse than one
    that records it with a note attached."""
    resp = await cc.get("/api/v1/custody/udin/syntax?udin=NOT-A-UDIN")
    assert resp.status_code == 200
    body = resp.json()
    assert body["matches_published_syntax"] is False
    assert body["notes"]


async def test_a_udin_from_the_wrong_partner_is_flagged(cc):
    """Digits 3-8 of a UDIN ARE the generating member's ICAI membership number,
    so this catches a UDIN pasted from another partner's portal session — the
    realistic error in a firm with four partners, and one that nothing else in
    the world would catch. Only the member who generated a UDIN can revoke it."""
    body = (await cc.get(
        "/api/v1/custody/udin/syntax?udin=19304576AKTSBN1359&membership_no=123456"
    )).json()
    assert body["matches_published_syntax"] is True
    assert any("304576" in n for n in body["notes"])


# ══════════════════════════════════════════════════════════════════════════════
#  6 · Notices
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_notice_due_today_is_not_overdue(cc, mock_pool):
    """0 days remaining, band `critical`, not `overdue`. The reply is filed on
    the due date all the time; a register that calls that late trains people to
    ignore it, and a compliance list nobody reads is the failure mode."""
    mock_pool.fetch.return_value = [notice_row(due_on=TODAY)]
    body = (await cc.get("/api/v1/custody/notices?as_of=2026-08-21")).json()
    row = body["data"][0]
    assert row["urgency"]["days_remaining"] == 0
    assert row["urgency"]["band"] == "critical"
    assert row["urgency_note"] == "Due today."


async def test_the_urgency_dataclass_is_flattened_to_a_dict(cc, mock_pool):
    """The wire shape is ours, not whatever a frozen dataclass happens to
    serialise as. A renderer reads `urgency.band`."""
    mock_pool.fetch.return_value = [notice_row()]
    row = (await cc.get("/api/v1/custody/notices")).json()["data"][0]
    assert isinstance(row["urgency"], dict)
    assert set(row["urgency"]) == {
        "band", "days_remaining", "due_on", "conservative"
    }


async def test_escalated_outranks_merely_overdue(cc, mock_pool):
    """The deadline passed AND the consequence landed. It must sort above a row
    that is 90 days past due, and no ORDER BY on `due_on` can express that."""
    mock_pool.fetch.return_value = [
        notice_row(reference_no="OLD", due_on=TODAY - timedelta(days=90)),
        notice_row(reference_no="ESC", status="escalated",
                   due_on=TODAY - timedelta(days=1)),
    ]
    body = (await cc.get("/api/v1/custody/notices?as_of=2026-08-21")).json()
    assert [r["reference_no"] for r in body["data"]] == ["ESC", "OLD"]


async def test_a_foreign_notice_type_is_a_leak_not_a_filtered_row(cc, mock_pool):
    """The LABEL is the exposure — "Sales-tax dept, Nashik — spot verification"
    names a department, a city and somebody else's problem. `org_id IS NULL` is
    a system type and belongs to everybody; anything else that is not this org
    is another practice's private type."""
    mock_pool.fetch.return_value = [{
        "org_id": OTHER_ORG, "code": "spot_check", "label": "Spot verification",
        "authority": "vat", "form_no": "", "reply_form_no": "",
        "statute_ref": "", "statute_key": "", "reply_window_days": 7,
        "reply_window_months": 0, "window_basis": "statutory_fixed",
        "window_in_working_days": False, "consequence": "x", "source_url": "",
        "is_system": False,
    }]
    with pytest.raises(Exception) as exc:
        await cc.get("/api/v1/custody/notices/types")
    assert "another practice" in str(exc.value) or "CrossOrgLeak" in type(exc.value).__name__


async def test_client_history_is_not_filtered_by_status(cc, mock_pool):
    """The value of a client history is the CLOSED rows. "This is the fourth
    ASMT-10 on the same mismatch" is the sentence that changes how an engagement
    is run, and it is invisible in a list of open items."""
    mock_pool.fetch.return_value = []
    await cc.get("/api/v1/custody/notices/by-client/c0000000-0000-0000-0000-000000000001")
    sql = mock_pool.fetch.call_args[0][0]
    assert "r.client_id = $2::uuid" in sql
    assert "status" not in sql.split("WHERE")[-1].split("ORDER BY")[0]


# ══════════════════════════════════════════════════════════════════════════════
#  7 · Offboarding custody — the one register with a writer
# ══════════════════════════════════════════════════════════════════════════════

EMP = "e0000000-0000-0000-0000-000000000001"
EXIT = "o0000000-0000-0000-0000-000000000001"


def leaver_record(**over):
    row = {
        "employee_ref": EMP,
        "employee_name": "Priya Sharma",
        "employee_code": "EMP001",
        "designation": "Manager",
        "department": "Audit",
        "email": "priya@example.com",
        "linked_user_id": None,
        "employment_status": "on_notice",
        "is_active": True,
        "offboarding_ref": EXIT,
        "offboarding_status": "in_clearance",
        "exit_type": "resignation",
        "last_working_day": date(2026, 9, 30),
        "handover_completed_at": None,
        "access_revoked_at": None,
        "custody_scanned_at": None,
    }
    row.update(over)
    return row


def leaver_lookups(*then, **over):
    """`resolve_leaver` issues TWO fetchrow calls on a live-shaped row.

    The employee itself, and then — because `manav_employees.user_id` is NULL on
    all 98 live rows — the `public.users` lookup by email, which finds nothing
    on all 98 of them either. A fixture that answers the second call with the
    employee row again is not modelling the database, it is modelling a mock,
    and the service dies on it. Anything after the None is the caller's own.
    """
    return [leaver_record(**over), None, *then]


async def test_an_unknown_employee_is_a_404(cc, mock_pool):
    """Which is also how a leaver from ANOTHER practice is refused. It is the
    whole tenancy guard for this surface: every list below takes the login id
    resolved by `resolve_leaver`, so an employee id belonging to another firm
    never gets past that line."""
    mock_pool.fetchrow.return_value = None
    resp = await cc.get(f"/api/v1/custody/offboarding/{EMP}")
    assert resp.status_code == 404


async def test_unresolved_is_reported_as_unknown_and_never_as_clear(cc, mock_pool):
    """`manav_employees.user_id` is NULL on all 98 live rows and not one of the
    98 employee emails matches a row in `public.users`. So today every real
    employee resolves to `login_link: 'unresolved'` and the four lists come back
    empty BECAUSE NOBODY COULD BE LOOKED UP — not because the desk is empty.

    "This person has no outstanding access" and "we could not work out who this
    person logs in as" are opposite answers and they look identical in any
    report that omits the field.
    """
    mock_pool.fetchrow.side_effect = leaver_lookups()
    mock_pool.fetch.return_value = []
    body = (await cc.get(f"/api/v1/custody/offboarding/{EMP}")).json()
    assert body["leaver"]["login_link"] == "unresolved"
    assert body["unknown"] is True
    assert body["clear"] is False


async def test_no_machine_handle_for_a_person_leaves_the_leaver_block(cc, mock_pool):
    """`employee_ref`, `offboarding_ref` and `login_user_ref` are handles the
    browser has no use for — the exit is resolved server-side on every call. The
    fewer ids that cross the wire, the fewer there are to render by accident."""
    mock_pool.fetchrow.side_effect = leaver_lookups()
    mock_pool.fetch.return_value = []
    leaver = (await cc.get(f"/api/v1/custody/offboarding/{EMP}")).json()["leaver"]
    for key in ("employee_ref", "offboarding_ref", "login_user_ref"):
        assert key not in leaver
    assert leaver["employee_name"] == "Priya Sharma"
    assert leaver["has_exit_record"] is True


async def test_the_ledger_never_returns_a_login_id(cc, mock_pool):
    """`custody_ledger` selects `recorded_by`, `revoked_by` and
    `reassigned_to_user_ref`. The first two are login ids wearing display names,
    which is exactly how an id ends up on a screen. `reassigned_to_name` is the
    one to show and it survives."""
    mock_pool.fetchrow.side_effect = leaver_lookups()
    mock_pool.fetch.return_value = [{
        "action": "reassign", "subject_type": "task", "subject_ref": "t1",
        "subject_label": "File GSTR-3B for August",
        "reassigned_to_user_ref": "user_zzz",
        "reassigned_to_name": "Rahul Verma",
        "revoked_at": None, "revoked_by": "user_admin001",
        "status": "done", "waived_reason": None, "note": None,
        "recorded_by": "user_admin001",
        "created_at": None, "updated_at": None,
    }]
    body = (await cc.get(f"/api/v1/custody/offboarding/{EMP}/ledger")).json()
    row = body["data"][0]
    for key in ("recorded_by", "revoked_by", "reassigned_to_user_ref"):
        assert key not in row, key
    assert row["reassigned_to_name"] == "Rahul Verma"
    assert row["subject_label"] == "File GSTR-3B for August"


async def test_an_employee_with_no_exit_record_gets_an_empty_ledger_not_a_404(
    cc, mock_pool,
):
    """The employee is real. The honest answer is an empty ledger with the
    reason attached, not a 404 that reads as "no such person"."""
    mock_pool.fetchrow.side_effect = leaver_lookups(offboarding_ref=None)
    body = (await cc.get(f"/api/v1/custody/offboarding/{EMP}/ledger")).json()
    assert body == {"data": [], "count": 0, "has_exit_record": False}


# ── the write ────────────────────────────────────────────────────────────────

def _line(**over):
    body = {
        "action": "revoke",
        "subject_type": "role_grant",
        "subject_label": "org_member",
        "subject_ref": "org_member",
        "status": "outstanding",
    }
    body.update(over)
    return body


async def test_a_line_is_recorded_and_the_exit_is_resolved_server_side(
    cc, mock_pool,
):
    """The browser never holds the exit id. `record_custody` is an INSERT …
    SELECT whose WHERE proves (org, exit, employee) agree before any row exists
    to insert, and handing the browser an exit id to post back would be the
    transposed-argument failure that guard exists to catch, wearing a user's
    clothes."""
    mock_pool.fetchrow.side_effect = leaver_lookups(
        {"id": "l1", "action": "revoke", "subject_type": "role_grant",
         "subject_label": "org_member", "status": "outstanding"},
    )
    resp = await cc.post(f"/api/v1/custody/offboarding/{EMP}/lines", json=_line())
    assert resp.status_code == 201, resp.text
    assert resp.json()["subject_label"] == "org_member"
    # The exit id bound into the INSERT came from the resolved leaver, not the
    # request.
    args = mock_pool.fetchrow.call_args[0]
    assert args[1] == ORG and args[2] == EXIT and args[3] == EMP


async def test_recording_twice_is_the_same_row(cc, mock_pool):
    """THE UPSERT IS WHAT MAKES A REPEATED SCAN SAFE. Without it, opening the
    exit screen twice writes the leaver's whole desk into the register twice,
    and by the fourth visit the count of outstanding items is four times the
    truth."""
    mock_pool.fetchrow.side_effect = leaver_lookups(
        {"id": "l1", "action": "revoke", "subject_type": "role_grant",
         "subject_label": "org_member", "status": "outstanding"},
    )
    await cc.post(f"/api/v1/custody/offboarding/{EMP}/lines", json=_line())
    sql = mock_pool.fetchrow.call_args[0][0]
    assert "ON CONFLICT" in sql and "DO UPDATE" in sql


async def test_a_waived_line_needs_a_reason(cc, mock_pool):
    """A firm that has written down WHY a line will not be actioned has dealt
    with it, and a waiver with no reason settles nothing. Refused here rather
    than left to `manav_offboarding_custody_waived_ck`, whose violation arrives
    as a 500 with no useful message."""
    mock_pool.fetchrow.side_effect = leaver_lookups()
    resp = await cc.post(
        f"/api/v1/custody/offboarding/{EMP}/lines",
        json=_line(status="waived"),
    )
    assert resp.status_code == 422
    assert "reason" in resp.text


async def test_a_completed_reassignment_needs_a_destination(cc, mock_pool):
    mock_pool.fetchrow.side_effect = leaver_lookups()
    resp = await cc.post(
        f"/api/v1/custody/offboarding/{EMP}/lines",
        json=_line(action="reassign", subject_type="task",
                   subject_label="File GSTR-3B", status="done"),
    )
    assert resp.status_code == 422
    assert "handed to" in resp.text


async def test_a_completed_revocation_is_stamped_rather_than_refused(cc, mock_pool):
    """`…_revoked_at_ck` requires a timestamp on a done revocation. The moment
    the button was pressed IS the revocation being recorded, so it is stamped
    with the server clock instead of bounced back at a person who has nothing
    else to give."""
    mock_pool.fetchrow.side_effect = leaver_lookups(
        {"id": "l1", "action": "revoke", "subject_type": "role_grant",
         "subject_label": "org_member", "status": "done"},
    )
    resp = await cc.post(
        f"/api/v1/custody/offboarding/{EMP}/lines", json=_line(status="done"),
    )
    assert resp.status_code == 201, resp.text
    args = mock_pool.fetchrow.call_args[0]
    assert isinstance(args[10], datetime)      # revoked_at
    assert args[11] == CALLER["user_id"]       # revoked_by, from the token


async def test_recorded_by_comes_from_the_token_and_never_from_the_body(
    cc, mock_pool,
):
    mock_pool.fetchrow.side_effect = leaver_lookups(
        {"id": "l1", "action": "revoke", "subject_type": "role_grant",
         "subject_label": "org_member", "status": "outstanding"},
    )
    await cc.post(
        f"/api/v1/custody/offboarding/{EMP}/lines",
        json=_line(recorded_by="somebody_else"),
    )
    assert mock_pool.fetchrow.call_args[0][15] == CALLER["user_id"]


async def test_an_unknown_subject_type_is_a_422_not_a_500(cc, mock_pool):
    """A near-miss that IS in the vocabulary ('module' for 'module_grant') would
    be a valid-looking line that never settles the grant it names, and a real
    CheckViolation arrives as an asyncpg error a router turns into a 500."""
    mock_pool.fetchrow.side_effect = leaver_lookups()
    resp = await cc.post(
        f"/api/v1/custody/offboarding/{EMP}/lines",
        json=_line(subject_type="module"),
    )
    assert resp.status_code == 422


def test_the_subject_vocabulary_is_read_off_the_service_not_restated():
    """Restating it here is how the router and migration 164's CHECK drift, and
    the drift is silent in the safe-looking direction: a subject type the
    service accepts and the router refuses."""
    from services.custody import offboarding as svc
    src = inspect.getsource(custody_mod.record_custody_line)
    assert "offboarding._SUBJECT_TYPES" in src
    assert "dsc_token" in svc._SUBJECT_TYPES
    assert "portal_credential" in svc._SUBJECT_TYPES


async def test_a_person_with_no_exit_record_cannot_be_written_against(
    cc, mock_pool,
):
    """A custody line hangs off the exit, not off the employee. 409 with the
    next step in it, not a 500 from an INSERT that matched nothing."""
    mock_pool.fetchrow.side_effect = leaver_lookups(offboarding_ref=None)
    resp = await cc.post(f"/api/v1/custody/offboarding/{EMP}/lines", json=_line())
    assert resp.status_code == 409
    assert "Exits tab" in resp.text


async def test_none_from_record_custody_is_a_refusal_not_success(cc, mock_pool):
    """`record_custody` returns None when (org, exit, employee) do not describe
    one real exit — the INSERT … SELECT matched no row. The service docstring is
    emphatic that a caller must not read None as "already recorded"."""
    mock_pool.fetchrow.side_effect = leaver_lookups(None)
    resp = await cc.post(f"/api/v1/custody/offboarding/{EMP}/lines", json=_line())
    assert resp.status_code == 409
    assert "Nothing was recorded" in resp.text


async def test_the_write_and_the_access_scan_are_rate_limited():
    """The scan is the one read in the product that enumerates a person's live
    grants across three tables; an unthrottled enumerator over a path parameter
    is a map of who can reach what. slowapi resolves the client address off
    `request`, and raises at import time for a decorated handler that omits it —
    so the presence of the parameter is part of the assertion."""
    for name in ("offboarding_custody", "record_custody_line"):
        handler = getattr(custody_mod, name)
        assert "request" in inspect.signature(handler).parameters, name
    src = inspect.getsource(custody_mod)
    assert src.count("@limiter.limit(") == 2


async def test_inherited_is_self_scoped_and_takes_no_user_id(cc, mock_pool):
    """`inherited_by` keys on a login id. Taking one from a path would be an
    enumeration over user ids in a product whose standing rule is that a user id
    never reaches a screen."""
    params = inspect.signature(custody_mod.inherited_by_me).parameters
    assert not any(p in params for p in ("user_id", "employee_id"))
    mock_pool.fetch.return_value = []
    resp = await cc.get("/api/v1/custody/offboarding/inherited/me")
    assert resp.status_code == 200
    assert mock_pool.fetch.call_args[0][2] == CALLER["user_id"]
