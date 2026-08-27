"""
Cross-tenant isolation and platform-role scope.

Two families of bug, both found by walking every route in backend/routers and
asking "does this query filter on org_id, and is the guard as strong as the
data?".

1. Routes keyed on a child id — client_id, seq_id, contract_id, report_id —
   where the child table has no org_id of its own and the parent was never
   checked. The caller supplies the id; nothing has to be forged.

2. `account_manager`, a commercial role, reaching operational data. It bypassed
   `require_module` for every module in every org, so whoever ran the
   commercial side could read any customer's payroll, HR file and attendance
   without leaving a trace.
"""

import pytest

from middleware.role_tiers import SUPPORT_ROLES

ORG_A = "00000000-0000-0000-0000-00000000000a"
FOREIGN_CLIENT = "c0000000-0000-0000-0000-0000000000ff"
FOREIGN_SEQ = "50000000-0000-0000-0000-0000000000ff"


@pytest.fixture
def org_a(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: ORG_A
    yield ORG_A
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def may_send(app):
    """Grant the caller the EDITOR rung on publishing, and nothing else.

    `bulk_schedule` and `schedule_post` used to carry no authority check at all,
    so a plain member reached `_require_client_in_org` and the isolation tests
    below read 404. They now carry `_require_send_authority`, which refuses a
    member at 403 before any client is looked at — earlier and stronger, and no
    existence oracle, because that 403 is computed from the caller's own module
    level and is identical for a client id that does not exist.

    The isolation property those tests exist to prove is "a foreign client's
    post is not queued", and proving it needs a caller who has cleared
    authority — otherwise the test passes for the wrong reason and would keep
    passing if the ownership check were deleted. This fixture supplies exactly
    that caller. `test_a_member_without_the_editor_rung_...` below pins the new
    403 separately, so both facts are asserted rather than one masking the other.
    """
    from routers.hub_publish import _require_send_authority
    app.dependency_overrides[_require_send_authority] = lambda: None
    yield
    app.dependency_overrides.pop(_require_send_authority, None)


@pytest.fixture
def bypass_sahayak_gate(app):
    from routers.hub_publish import _hub_gate as pub_gate
    from routers.hub_chat import _hub_gate as chat_gate
    app.dependency_overrides[pub_gate] = lambda: None
    app.dependency_overrides[chat_gate] = lambda: None
    yield
    app.dependency_overrides.pop(pub_gate, None)
    app.dependency_overrides.pop(chat_gate, None)


@pytest.fixture
def bypass_prachar_gate(app):
    from routers.prachar import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


# ── Sahayak publishing: routes keyed on client_id ──────────────────

@pytest.mark.parametrize("method,path,body", [
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/social-accounts", None),
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/publish/queue", None),
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/calendar", None),
    ("get", f"/api/v1/hub/clients/{FOREIGN_CLIENT}/platforms", None),
])
async def test_publishing_reads_reject_a_client_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_sahayak_gate, method, path, body,
):
    mock_pool.fetchval.return_value = None  # client not in this org
    resp = await getattr(api_client, method)(path)
    assert resp.status_code == 404, path


async def test_a_member_without_the_editor_rung_cannot_schedule_at_all(
    api_client, mock_pool, as_member, org_a, bypass_sahayak_gate,
):
    """Scheduling is sending, and sending needs editor.

    Note there is no `may_send` here. A plain org member is refused at 403
    BEFORE the client is looked at — `mock_pool.fetchval` is never consulted, so
    the refusal cannot depend on whether the client exists and cannot be used to
    probe for one.

    This closes a gap rather than adding ceremony: `publish_now` carried an
    authority check and `bulk_schedule` carried none, while the two end in the
    same place, because the cron does not ask who queued the row. A viewer could
    put a post in front of a client's audience by scheduling it a minute out.
    """
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/hub/clients/{FOREIGN_CLIENT}/publish/bulk-schedule",
        json={
            "content_id": "d0000000-0000-0000-0000-000000000001",
            "account_ids": ["a0000000-0000-0000-0000-000000000001"],
            "scheduled_for": "2026-08-01T10:00:00Z",
        },
    )
    assert resp.status_code == 403

    # NOT a call COUNT. `held_level` reads the role and grant tables to decide
    # the level, so several fetchvals are expected and counting them measures
    # the wrong thing. What must not have happened is a look at the CLIENT: if
    # ownership were resolved before authority, the refusal would differ for a
    # client that exists and one that does not, and that difference is an
    # existence oracle.
    looked_at_the_client = [
        c for c in mock_pool.fetchval.await_args_list
        if c.args and "hub_clients" in str(c.args[0])
    ]
    assert not looked_at_the_client, (
        "the client was looked up before authority was decided — that ordering "
        "turns the refusal into an existence oracle"
    )


async def test_bulk_schedule_rejects_a_client_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_sahayak_gate, may_send,
):
    """The worst of the set: this route validated nothing at all, so a content
    id and an account id from another org would queue a post to their real
    social account."""
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/hub/clients/{FOREIGN_CLIENT}/publish/bulk-schedule",
        json={
            "content_id": "d0000000-0000-0000-0000-000000000001",
            "account_ids": ["a0000000-0000-0000-0000-000000000001"],
            "scheduled_for": "2026-08-01T10:00:00Z",
        },
    )
    assert resp.status_code == 404


async def test_bulk_schedule_skips_accounts_not_owned_by_the_client(
    api_client, mock_pool, as_member, org_a, bypass_sahayak_gate, may_send,
):
    """Client belongs to the org and the content does, but one of the account
    ids does not — it must be refused rather than inserted."""
    calls = {"n": 0}

    async def _fetchval(sql, *args):
        calls["n"] += 1
        if "hub_clients" in sql:
            return 1
        if "hub_content_items" in sql:
            return "d0000000-0000-0000-0000-000000000001"
        if "hub_social_accounts" in sql:
            return None  # account belongs elsewhere
        return None

    mock_pool.fetchval.side_effect = _fetchval
    resp = await api_client.post(
        "/api/v1/hub/clients/c0000000-0000-0000-0000-000000000001/publish/bulk-schedule",
        json={
            "content_id": "d0000000-0000-0000-0000-000000000001",
            "account_ids": ["a0000000-0000-0000-0000-0000000000ff"],
            "scheduled_for": "2026-08-01T10:00:00Z",
        },
    )
    assert resp.status_code == 200
    result = resp.json()["results"][0]
    assert result["status"] == "failed"
    assert "not found" in result["error"].lower()
    mock_pool.fetchrow.assert_not_called()


# ── Sahayak chat: the RAG path ─────────────────────────────────────

async def test_chat_session_rejects_a_client_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_sahayak_gate,
):
    """A session pointed at another org's client made `send_chat_message` hand
    that client_id to the retriever, so the assistant read and summarised their
    knowledge base. The org check has to happen where the link is created."""
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/hub/clients/{FOREIGN_CLIENT}/chat/sessions",
        json={"title": "hello", "session_type": "general"},
    )
    assert resp.status_code == 404
    mock_pool.fetchrow.assert_not_called()


# ── Prachar sequences: outbound email content ─────────────────────

async def test_add_sequence_step_rejects_a_sequence_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    """Writing a step is writing the subject and body of mail another company
    sends over its own name."""
    mock_pool.fetchval.return_value = None
    resp = await api_client.post(
        f"/api/v1/prachar/sequences/{FOREIGN_SEQ}/steps",
        json={"step_order": 1, "channel": "email", "subject": "hi", "body_html": "<p>hi</p>"},
    )
    assert resp.status_code == 404
    mock_pool.fetchrow.assert_not_called()


async def test_delete_sequence_step_rejects_a_sequence_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.delete(f"/api/v1/prachar/sequences/{FOREIGN_SEQ}/steps/1")
    assert resp.status_code == 404
    mock_pool.execute.assert_not_called()


async def test_sequence_stats_reject_a_sequence_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.get(f"/api/v1/prachar/sequences/{FOREIGN_SEQ}/stats")
    assert resp.status_code == 404


async def test_campaign_stats_reject_a_campaign_from_another_org(
    api_client, mock_pool, as_member, org_a, bypass_prachar_gate,
):
    mock_pool.fetchval.return_value = None
    resp = await api_client.get(
        "/api/v1/prachar/campaigns/c0000000-0000-0000-0000-0000000000ff/stats"
    )
    assert resp.status_code == 404


# ── require_module: platform-role scope ───────────────────────────

def _pool_with_platform_role(mock_pool, role):
    """Answer the platform-role probe in require_module with `role`."""
    async def _fetchval(sql, *args):
        if "staging.user_roles" in sql and "org_id IS NULL" in sql:
            return role
        return None
    mock_pool.fetchval.side_effect = _fetchval


async def _run_gate(module_code, user_id="user_x"):
    """Invoke the require_module dependency directly."""
    from unittest.mock import MagicMock
    from middleware.subscription import require_module

    request = MagicMock()
    request.state._auth_user = {"user_id": user_id}
    request.url.path = f"/api/v1/{module_code}/anything"
    request.method = "GET"
    request.headers = {}
    request.client = None

    def _getattr(name, default=None):
        return {"user_id": user_id}

    check = require_module(module_code)
    return await check(request=request, org_id=ORG_A)


@pytest.mark.parametrize("module_code", ["vetana", "ganit", "manav", "pahchan"])
async def test_account_manager_cannot_reach_a_sensitive_module(
    mock_pool, module_code,
):
    """account_manager is a commercial role. PLAN_ROLES §2.1 gives it org
    creation, module toggles and storage — no customer data at all. It was
    reaching payroll, accounting, HR files and biometric attendance in every
    org."""
    from fastapi import HTTPException

    _pool_with_platform_role(mock_pool, "account_manager")
    with pytest.raises(HTTPException) as exc:
        await _run_gate(module_code)
    assert exc.value.status_code == 403
    assert module_code in exc.value.detail


@pytest.mark.parametrize("module_code", ["vetana", "ganit", "manav", "pahchan"])
async def test_platform_admin_reaches_a_sensitive_module_but_is_audited(
    mock_pool, monkeypatch, module_code,
):
    """Support access is never silent — the standing rule. The volume argument
    that keeps the non-sensitive bypass unaudited does not apply here: these
    are a small minority of requests made rarely by three people."""
    emitted = []
    monkeypatch.setattr(
        "middleware.subscription.audit",
        lambda action, request=None, **kw: emitted.append((action, kw)),
    )
    _pool_with_platform_role(mock_pool, "platform_admin")

    await _run_gate(module_code)

    assert len(emitted) == 1
    action, kw = emitted[0]
    assert action == "platform.sensitive_module_access"
    assert kw["severity"] == "warn"
    assert kw["resource_id"] == module_code
    assert kw["detail"]["role"] == "platform_admin"
    assert kw["detail"]["via"] == "platform_bypass"


async def test_non_sensitive_module_bypass_stays_silent(mock_pool, monkeypatch):
    """Deliberate: this gate gates ~400 endpoints and a row per request is a
    product decision, not a middleware one. Asserted so that changing it is a
    choice rather than an accident.

    Uses platform_staff rather than account_manager. account_manager was the
    example when this was written; the owner has since superseded it with
    platform_manager / platform_staff, and it now reaches nothing at all — see
    test_account_manager_reaches_nothing below."""
    emitted = []
    monkeypatch.setattr(
        "middleware.subscription.audit",
        lambda action, request=None, **kw: emitted.append(action),
    )
    _pool_with_platform_role(mock_pool, "platform_staff")

    await _run_gate("graha")

    assert emitted == []


async def test_pahchan_is_treated_as_sensitive():
    """Biometric-adjacent: face-match scores and selfies against a named
    employee."""
    from middleware.subscription import SENSITIVE_MODULES
    assert "pahchan" in SENSITIVE_MODULES


async def test_account_manager_is_not_an_operational_platform_role():
    """account_manager is superseded by platform_manager and now reaches NOTHING.

    It is kept in the enum only so existing rows stay readable while the data
    migrates. A commercial role — create orgs, toggle modules, chase invoices —
    has no business in a customer's salary register."""
    from middleware.role_tiers import modules_for, is_god_mode
    assert modules_for("account_manager") == frozenset()
    assert not is_god_mode("account_manager")
    # God mode reaches everything, under either spelling.
    assert is_god_mode("platform_admin") and is_god_mode("platform_owner")
    # THIRTEEN since `7770045b` (23 Aug) made procurement its own module.
    # A count rather than a set here on purpose — this test is about
    # account_manager reaching NOTHING, and god mode reaching everything is
    # the contrast. `test_platform_module_gate.py` is where the membership
    # itself is pinned name by name.
    assert len(modules_for("platform_owner")) == 13


# ── require_org_role: the unconditional platform pass ─────────────

async def test_require_org_role_no_longer_waves_account_manager_through(
    mock_pool,
):
    """It guards org member management, org profile, the Manav PII reveal and
    Pahchan review. None of those are commercial actions."""
    from fastapi import HTTPException
    from middleware.roles import require_org_role

    seen = {}

    async def _fetchval(sql, *args):
        # The platform probe is the one scoped to org_id IS NULL. It used to
        # spell the role as a literal; it now passes GOD_MODE_ROLES as a
        # parameter, so the assertion reads the parameter rather than the SQL.
        if "org_id IS NULL" in sql:
            seen["probe_sql"] = sql
            seen["probe_roles"] = args[1] if len(args) > 1 else []
            return None  # not god mode
        return None  # and no org role either

    mock_pool.fetchval.side_effect = _fetchval

    check = require_org_role("org_owner", "org_admin")
    with pytest.raises(HTTPException) as exc:
        await check(user={"user_id": "user_am"}, org_id=ORG_A)
    assert exc.value.status_code == 403
    # The probe must ask only about god mode, never account_manager.
    assert "account_manager" not in seen["probe_roles"]
    assert "account_manager" not in seen["probe_sql"]


async def test_require_org_role_no_longer_passes_platform_admin_from_outside(
    mock_pool,
):
    """A platform row is not a membership, and this used to be the whole bug.

    The god-mode probe returned the user BEFORE the org-scoped lookup ran, so a
    single `org_id IS NULL` row satisfied every org-role gate in every
    organisation in the database — member removal, role changes, module grants,
    the Manav PII reveal. This is the same fixture as before with the same
    answers; only the verdict changed. See `tests/test_roles_org_scope.py` for
    the decision table and `middleware/roles.may_act_in_org` for the rule.
    """
    from fastapi import HTTPException
    from middleware.roles import require_org_role

    async def _fetchval(sql, *args):
        # god mode, and no row of any kind in ORG_A
        return 1 if "org_id IS NULL" in sql else None

    mock_pool.fetchval.side_effect = _fetchval

    check = require_org_role("org_owner", "org_admin")
    with pytest.raises(HTTPException) as exc:
        await check(user={"user_id": "user_pa"}, org_id=ORG_A)
    assert exc.value.status_code == 403


async def test_require_org_role_passes_platform_admin_inside_its_own_org(mock_pool):
    """The other half. Aekam's own staff keep Aekam.

    A god-mode holder whose org row is weaker than the gate asks for still
    passes — that is what stops this from locking the vendor out of owner-only
    surfaces in an org whose owner seat is empty, which is the live state of
    Unicode Group.
    """
    from middleware.roles import require_org_role

    async def _fetchval(sql, *args):
        if "org_id IS NULL" in sql:
            return 1                      # god mode
        if "SELECT 1 FROM staging.user_roles" in sql:
            return 1                      # …and a member of THIS org
        return None                       # but not org_owner/org_admin here

    mock_pool.fetchval.side_effect = _fetchval

    check = require_org_role("org_owner", "org_admin")
    user = await check(user={"user_id": "user_pa"}, org_id=ORG_A)
    assert user["user_id"] == "user_pa"


async def test_require_org_role_probes_for_platform_owner_too(mock_pool):
    """The god-mode probe was the bare string `'platform_admin'`, which omits
    `platform_owner` — the exact lockout role_tiers.py warns about.

    It is invisible today because every god-mode account still holds a legacy
    `platform_admin` row. It becomes a simultaneous lockout of all of them on the
    day the data migration renames those rows, which is the migration the tier
    model exists for. This pins the probe to the named set.
    """
    from fastapi import HTTPException

    from middleware.role_tiers import GOD_MODE_ROLES
    from middleware.roles import require_org_role

    seen = {}

    async def _fetchval(sql, *args):
        if "org_id IS NULL" in sql:
            seen["roles"] = args[1] if len(args) > 1 else []
        return None

    mock_pool.fetchval.side_effect = _fetchval

    check = require_org_role("org_owner", "org_admin")
    with pytest.raises(HTTPException):
        await check(user={"user_id": "user_po"}, org_id=ORG_A)

    assert "platform_owner" in seen["roles"], (
        "god-mode probe must admit platform_owner, not only the legacy spelling"
    )
    assert "platform_admin" in seen["roles"], "legacy rows must keep working"
    assert set(seen["roles"]) == set(GOD_MODE_ROLES)


# ── platform_support: the approval gate that had no code behind it ──


class _Req:
    """Stand-in for a Request carrying an X-Org-Id header AND a path.

    The path is not decoration. `get_org_id` used to ask only WHO was sending
    the header; it now also asks WHERE, because the role answer was being
    applied to every route in the product — including
    `POST /api/v1/vikray/orders`, `DELETE /api/tasks/bulk` and
    `GET /api/v1/search`, none of which are consoles.

    Defaults to a billing path so the existing cases keep asserting what they
    were written to assert: that the narrowing is support-only and does not
    break the console.
    """

    def __init__(self, org_id, path="/api/v1/subscription/admin/invoices"):
        self.headers = {"x-org-id": org_id}

        class _S:
            pass

        self.state = _S()

        class _U:
            pass

        self.url = _U()
        self.url.path = path


@pytest.mark.parametrize("role", list(SUPPORT_ROLES))
async def test_platform_support_cannot_resolve_an_arbitrary_org(mock_pool, role):
    """RBAC-SPEC.md:19 — support is "Zero by default. Needs org-admin approval…
    Full audit trail in platform_support_sessions". That table does not exist,
    so there is no approval to consult and the honest answer is no org.

    Before this, `get_org_id` tested membership against ALL_PLATFORM_ROLES, which
    includes platform_support — so support put any org's UUID in a header and
    received that org's context. It is upstream of every route guard, so it
    reached every route that takes get_org_id without a module gate.
    """
    from fastapi import HTTPException

    from middleware.org_resolver import get_org_id

    async def _fetchval(sql, *args):
        if "org_id=$2::uuid" in sql:
            return None                      # not a member of the org
        if "org_id IS NULL" in sql:
            allowed = list(args[1]) if len(args) > 1 else []
            return role if role in allowed else None
        return None

    mock_pool.fetchval.side_effect = _fetchval

    with pytest.raises(HTTPException) as exc:
        await get_org_id(_Req(ORG_A), user={"user_id": "user_support"})
    assert exc.value.status_code == 403


def _platform_pool(mock_pool, role):
    """A caller who holds `role` platform-wide and belongs to no org."""
    async def _fetchval(sql, *args):
        if "org_id=$2::uuid" in sql:
            return None                      # not a member of the target org
        if "org_id IS NULL" in sql:
            allowed = list(args[1]) if len(args) > 1 else []
            return role if role in allowed else None
        return None

    async def _fetchrow(sql, *args):
        return {"id": ORG_A}

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow


@pytest.mark.parametrize("role", ["account_finance", "account_manager", "sahayak_admin"])
async def test_the_other_cross_org_roles_still_resolve_on_a_console(mock_pool, role):
    """The narrowing must be support-only ON THE CONSOLE. account_finance and
    account_manager run cross-org billing through this very header —
    `/v1/subscription/admin/*` resolves the org this way — and sahayak_admin
    configures AI per org through `/v1/hub/*`. Blocking them there would break
    billing, which is not what the spec asks for."""
    from middleware.org_resolver import get_org_id

    _platform_pool(mock_pool, role)
    req = _Req(ORG_A, "/api/v1/subscription/admin/invoices")
    assert await get_org_id(req, user={"user_id": "user_x"}) == ORG_A


@pytest.mark.parametrize("role", ["account_finance", "account_manager", "sahayak_admin",
                                  "platform_admin", "platform_staff", "platform_manager"])
@pytest.mark.parametrize("path", ["/api/v1/vikray/orders",
                                  "/api/tasks/bulk",
                                  "/api/v1/search",
                                  "/api/v1/ganit/invoices",
                                  "/api/v1/vetana/payslips"])
async def test_no_platform_role_may_name_another_org_outside_the_console(mock_pool, role, path):
    """
    THE HOLE. The role check answered "may this person ever act cross-org" and
    the resolver applied that answer to EVERY ROUTE. Measured chains that all
    worked: a platform_staff could INSERT a vikray order carrying another org's
    org_id (unaudited, because require_module returns early for a platform role
    on a non-sensitive module); DELETE /api/tasks/bulk had no module gate at all
    and is_org_admin answers True for these codes in ANY org, so the per-id
    check was skipped; and /api/v1/search was scoped entirely by the header.

    Nine of the ten live platform accounts belong to Aekam Inc only and one
    belongs to no org at all. Every one of them could name either of the other
    two organisations and be obeyed.
    """
    from fastapi import HTTPException
    from middleware.org_resolver import get_org_id

    _platform_pool(mock_pool, role)
    with pytest.raises(HTTPException) as exc:
        await get_org_id(_Req(ORG_A, path), user={"user_id": "user_x"})
    assert exc.value.status_code == 403


async def test_the_refusal_does_not_name_the_routes_that_still_accept_it(mock_pool):
    """
    A distinct message for "wrong route" hands a platform account a MAP of the
    remaining escape hatch: try each route, read which one changes its answer.
    The refusal must be indistinguishable from an ordinary non-member's; the
    distinction belongs in the log line, not the response.

    THE TWO CALLS DELIBERATELY TAKE DIFFERENT BRANCHES, and the first version of
    this test did not — it compared a platform account and a stranger on the SAME
    blocked route, and the path check fires BEFORE the role query, so both hit
    one raise and the assertion was true no matter what either said. A mutation
    that gave the path refusal its own wording stayed GREEN.

    So: the platform account is refused by the PATH gate, the stranger is refused
    by the MEMBERSHIP gate on a route the path gate allows. Two branches, and
    they must be word for word identical.
    """
    from fastapi import HTTPException
    from middleware.org_resolver import get_org_id

    # Platform role, blocked ROUTE -> refused by the path gate.
    _platform_pool(mock_pool, "platform_staff")
    with pytest.raises(HTTPException) as by_path:
        await get_org_id(_Req(ORG_A, "/api/v1/search"), user={"user_id": "user_x"})

    # No platform role, ALLOWED route -> refused by the membership gate.
    async def _none(sql, *args):
        return None
    mock_pool.fetchval.side_effect = _none
    with pytest.raises(HTTPException) as by_membership:
        await get_org_id(_Req(ORG_A, "/api/v1/subscription/admin/invoices"),
                         user={"user_id": "user_y"})

    assert by_path.value.status_code == by_membership.value.status_code
    assert by_path.value.detail == by_membership.value.detail, (
        "the path refusal is worded differently from the membership refusal — a "
        "platform account can probe route by route to find which ones still accept "
        "the header"
    )


async def test_a_member_still_switches_orgs_on_every_route(mock_pool):
    """
    The narrowing must not touch ordinary multi-org members. The membership
    branch runs first and is unchanged — `lib/api.js` attaches this header on
    EVERY request from the org switcher, so breaking it would break the product
    for anyone who belongs to two organisations.
    """
    from middleware.org_resolver import get_org_id

    async def _fetchval(sql, *args):
        return 1 if "org_id=$2::uuid" in sql else None   # IS a member

    async def _fetchrow(sql, *args):
        return {"id": ORG_A}

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow

    for path in ("/api/v1/search", "/api/tasks/bulk", "/api/v1/vikray/orders"):
        assert await get_org_id(_Req(ORG_A, path), user={"user_id": "user_m"}) == ORG_A
