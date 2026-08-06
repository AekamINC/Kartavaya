"""A platform role's console reach stops at the console's own module.

── THE CHAIN, MEASURED RATHER THAN READ ─────────────────────────────────────

`middleware/org_resolver.CROSS_ORG_HEADER_PREFIXES` deliberately scopes the
X-Org-Id escape hatch BY PATH: a platform role may name another organisation on
`/api/v1/subscription/`, `/api/v1/billing/`, `/api/v1/admin/` and `/api/v1/hub/`
and nowhere else. `/api/v1/ganit/` is absent ON PURPOSE — that file's own
comment calls the module prefixes "the first of the three measured chains this
file was narrowed to close".

Sahayak defeated that scoping from the inside. Measured with the real modules::

    _cross_org_path_allowed("/api/v1/hub/chat")        -> True
    can_reach_module("platform_manager", "ganit")      -> True
    plan_for("what do customers owe us")               -> ["receivables"]
    SOURCE_MODULES["receivables"]                      -> {"ganit"}

so `POST /api/v1/hub/chat` with `X-Org-Id: <a customer>` and the question "what
do customers owe us" resolved the customer's org on a widened prefix, passed
`require_module("sahayak")`, and then read `ganit` — a module whose OWN prefix
is not widened, and which the same account cannot reach through
`/api/v1/ganit/`. The route also OPENS A SESSION in the victim org and spends
the victim's credits, on a question shaped like a read.

`held_module_levels` is where the reach came from: it asks
`can_reach_module(platform_role, module_code)` and grants ADMIN on the answer,
with no notion of WHICH org the request is for or which prefix it arrived on.
Correct for `/api/v1/ganit/`, where the resolver has already refused the header;
wrong for `/api/v1/hub/`, where it has not.

── THE RULE THESE TESTS PIN ─────────────────────────────────────────────────

A caller who is NOT a member of the organisation being read may reach, through
a skill or an answer, only:

  · modules whose OWN routes are already on `CROSS_ORG_HEADER_PREFIXES`
    (measured: `sahayak` alone), and
  · modules the CUSTOMER named on a live support session.

Ordinary members are untouched; a platform account inside its own organisation
is untouched. This narrows one thing: reading another tenant's ledgers through
a surface whose gate says `sahayak`.

── AND THE CROSSING IS NAMED ────────────────────────────────────────────────

`require_module` is instantiated once per router as `require_module("sahayak")`,
so `platform_audit_row` was only ever asked about `sahayak` — a non-sensitive
code, which `platform_audit_needed` answers False for on a read. The ganit read
happened later, inside `held_module_levels`, which writes nothing. So a platform
account reading a customer's receivables through Sahayak was indistinguishable
in the audit log from one opening the Sahayak tab. The last test pins that the
row now names `ganit`.
"""
import pytest

from services.skills.modules import withheld_modules, console_reachable_modules
from services.skills import context as ctxmod

AEKAM_USER = "user_plat001"
VICTIM_ORG = "00000000-0000-0000-0000-0000000000ff"


@pytest.fixture
def platform_caller(mock_pool):
    """An Aekam account holding a platform role, outside the org being read.

    Every query on the path is routed on its own SQL. The pool is a MagicMock
    and answers anything, so a query left to the default would pass the test on
    a branch it never exercised.
    """
    state = {"role": "platform_manager", "member": False, "session": None}

    async def _fetchval(query, *args):
        q = " ".join(query.split())
        # The platform-role probe — `held_module_levels` and the new gate both
        # make it, and both must see the same answer or they cannot agree.
        if "staging.user_roles" in q and "org_id IS NULL" in q:
            return state["role"]
        # Two org-scoped probes share this shape: `held_module_levels`' owner/
        # admin lookup and the membership lookup. Both mean "does this person
        # belong to this organisation", so one answer is correct for both.
        if "staging.user_roles" in q and "org_id=$2::uuid" in q:
            return "org_admin" if state["member"] else None
        return None

    async def _fetchrow(query, *args):
        if "v_active_support_sessions" in query:
            return state["session"]
        return None

    async def _fetch(query, *args):
        # `held_module_levels` reads EVERY Tier-2 row this caller holds in the
        # org — a `fetch`, not the `fetchval` it used to be, because the Wave-3
        # ceiling needs the whole set and not the strongest one. It has to be
        # routed here or the org half of the resolution silently answers "no org
        # role", which is the same verdict as "not a member" and would make the
        # compatibility tests below pass on a branch they never exercised.
        q = " ".join(query.split())
        if "staging.user_roles" in q and "org_id=$2::uuid" in q:
            return [{"role_code": "org_admin"}] if state["member"] else []
        return []                       # no org_member_modules row anywhere

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.fetch.side_effect = _fetch
    return state


@pytest.fixture
def audited(monkeypatch):
    """Every audit row the gate emits, without touching the database."""
    rows = []
    monkeypatch.setattr(
        "services.audit.emit",
        lambda action, request=None, **kw: rows.append({"action": action, **kw}),
    )
    return rows


# ── The declaration itself ──────────────────────────────────────────────────

def test_only_sahayak_is_reachable_across_a_tenant_boundary():
    """Derived from the two live constants, never hand-listed.

    If somebody adds a module prefix to `CROSS_ORG_HEADER_PREFIXES` this set
    grows with it and this test says so, which is the point: the widening
    becomes a decision somebody has to write down rather than a side effect.
    """
    assert console_reachable_modules() == frozenset({"sahayak"})


# ── The leak ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_non_member_platform_role_cannot_read_the_books_through_sahayak(
    platform_caller,
):
    """The headline. `platform_manager` reaches `ganit` by role — measured — and
    the customer's receivables are still refused, because the request arrived on
    a prefix that widens `hub` and nothing else."""
    withheld = await withheld_modules(AEKAM_USER, VICTIM_ORG, frozenset({"ganit"}))

    assert withheld == frozenset({"ganit"})


@pytest.mark.asyncio
async def test_the_other_two_the_console_reached_are_refused_too(platform_caller):
    """`graha` and `vikray` are the same shape and were reachable the same way —
    `can_reach_module('platform_manager', ...)` is True for both."""
    withheld = await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"graha", "vikray", "sahayak"}),
    )

    assert withheld == frozenset({"graha", "vikray"})


@pytest.mark.asyncio
async def test_a_cross_module_plan_is_refused_whole_not_answered_around(
    platform_caller,
):
    """Holding one of three and answering over the other two is the failure the
    refusal exists to prevent — `aggregate_kpis`' three modules, cross-tenant."""
    withheld = await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"ganit", "graha", "manav"}),
    )

    assert withheld == frozenset({"ganit", "graha", "manav"})


# ── And what it must NOT narrow ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_console_s_own_module_is_still_reachable(platform_caller):
    """Aekam runs Sahayak FOR client orgs. That is what the `hub` prefix is for
    and narrowing it would break the product this widening exists to serve."""
    assert await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"sahayak"}),
    ) == frozenset()


@pytest.mark.asyncio
async def test_a_platform_account_inside_its_own_org_is_unchanged(platform_caller):
    """Nine of the ten live platform accounts are members of Aekam Inc and of
    nothing else. No tenant boundary is crossed, so nothing is narrowed."""
    platform_caller["member"] = True

    assert await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"ganit"}),
    ) == frozenset()


@pytest.mark.asyncio
async def test_an_ordinary_org_admin_is_unaffected(platform_caller):
    """The compatibility guarantee: a customer's own admin holds no platform row
    and must not pay one query of attention to any of this."""
    platform_caller["role"] = None
    platform_caller["member"] = True

    assert await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"ganit", "manav"}),
    ) == frozenset()


@pytest.mark.asyncio
async def test_a_support_session_the_customer_approved_restores_the_module(
    platform_caller,
):
    """The second, independent path through the header, and the one the customer
    actually consented to. `ganit` is the one sensitive module a session may
    lift — `SUPPORT_REQUESTABLE_MODULES` — so approving it must work."""
    platform_caller["session"] = {
        "id": "sess-1", "ref": "SS-1", "modules": ["ganit"],
        "access_level": "viewer", "expires_at": None, "approved_by": "user_owner",
    }

    assert await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"ganit", "sahayak"}),
    ) == frozenset()


@pytest.mark.asyncio
async def test_a_session_does_not_lift_a_module_it_does_not_name(platform_caller):
    """A grant is what the customer named and not one module more."""
    platform_caller["session"] = {
        "id": "sess-1", "ref": "SS-1", "modules": ["ganit"],
        "access_level": "viewer", "expires_at": None, "approved_by": "user_owner",
    }

    assert await withheld_modules(
        AEKAM_USER, VICTIM_ORG, frozenset({"ganit", "manav"}),
    ) == frozenset({"manav"})


# ── The skill path is the same path ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_skill_runner_refuses_the_same_crossing(platform_caller):
    """`POST /hub/org/skills/{id}/run` sits on the same widened prefix and had
    the same reach before this. It goes through `assert_step_access`, which goes
    through `withheld_modules`, so it is closed by the same edit — asserted
    rather than assumed."""
    with pytest.raises(ctxmod.SkillAccessDenied) as e:
        await ctxmod.assert_step_access(
            [{"skill_function": "find_overdue_invoices"}], AEKAM_USER, VICTIM_ORG,
        )

    assert e.value.withheld == frozenset({"ganit"})


# ── The audit row names what was read ───────────────────────────────────────

@pytest.mark.asyncio
async def test_a_sensitive_crossing_names_the_module_it_actually_read(
    platform_caller, audited,
):
    """`resource_id` was `sahayak` — the router's gate — for a request that read
    the books. It must name `ganit`, or the audit cannot distinguish reading a
    customer's receivables from opening the Sahayak tab."""
    platform_caller["member"] = True

    await withheld_modules(AEKAM_USER, VICTIM_ORG, frozenset({"ganit", "sahayak"}))

    named = [r["resource_id"] for r in audited]
    assert "ganit" in named, "the sensitive crossing left no row naming it"
    assert audited[named.index("ganit")]["action"] == "platform.sensitive_module_access"


@pytest.mark.asyncio
async def test_a_non_sensitive_read_stays_silent(platform_caller, audited):
    """The standing volume decision in `platform_audit_needed`, unreversed: a
    row per non-sensitive read would bury the ~330 warn rows that carry signal.
    Reversing it is the owner's call, not a side effect of this fix."""
    platform_caller["member"] = True

    await withheld_modules(AEKAM_USER, VICTIM_ORG, frozenset({"sahayak", "graha"}))

    assert [r["resource_id"] for r in audited] == []


@pytest.mark.asyncio
async def test_a_refused_module_is_not_recorded_as_read(platform_caller, audited):
    """A row saying an account read the books, written on the request where it
    was refused them, is worse than no row: it manufactures the event."""
    await withheld_modules(AEKAM_USER, VICTIM_ORG, frozenset({"ganit"}))

    assert [r["resource_id"] for r in audited] == []


@pytest.mark.asyncio
async def test_an_ordinary_member_leaves_no_platform_row(platform_caller, audited):
    """`platform_audit_row` is about platform accounts. A customer's own admin
    reading their own books is not that event."""
    platform_caller["role"] = None
    platform_caller["member"] = True

    await withheld_modules(AEKAM_USER, VICTIM_ORG, frozenset({"ganit"}))

    assert audited == []


# ═══════════════════════════════════════════════════════════════════════════
# THROUGH THE ROUTE — the statement about the product, not about the function
#
# Everything above proves the gate. This proves the gate is ON the path an Aekam
# account actually takes: `POST /api/v1/hub/chat`, resolved into the victim's
# org exactly the way `get_org_id` resolves it on a widened prefix, with
# `require_module("sahayak")` passing because `can_reach_module` says it does.
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture
def victim_org(app):
    from middleware.org_resolver import get_org_id
    app.dependency_overrides[get_org_id] = lambda: VICTIM_ORG
    yield VICTIM_ORG
    app.dependency_overrides.pop(get_org_id, None)


@pytest.fixture
def as_platform_manager(app):
    """`platform_manager` is the measured worst case: `can_reach_module` answers
    True for ganit, graha AND vikray, and it is not god mode."""
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: {
        "user_id": AEKAM_USER, "email": "ops@aekaminc.com", "name": "Aekam Ops",
        "full_name": "Aekam Ops", "role": "admin", "member_role": None,
    }
    yield
    app.dependency_overrides.pop(require_user, None)


@pytest.fixture
def sahayak_gate_open(app):
    """`require_module("sahayak")` genuinely passes for this role — measured,
    `can_reach_module('platform_manager', 'sahayak')` is True — so overriding it
    models the real request rather than excusing it."""
    from routers.hub import _hub_gate
    app.dependency_overrides[_hub_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_hub_gate, None)


@pytest.fixture
def hub_chat_wiring(mock_pool, platform_caller, monkeypatch):
    """Everything the route touches, recorded. The pool answers any query, so
    each read is routed on its own SQL and each WRITE is recorded by name."""
    import uuid as _uuid

    from routers import hub

    state = {
        "reads": [],            # every build_context call — must stay empty
        "writes": [],           # every INSERT the route attempts
        "spends": [],
        "client": _uuid.UUID("11111111-1111-1111-1111-111111111111"),
    }

    base_fetchval = mock_pool.fetchval.side_effect
    base_fetchrow = mock_pool.fetchrow.side_effect

    async def _fetchval(query, *args):
        q = " ".join(query.split())
        if "FROM staging.hub_clients" in q and "is_internal=TRUE" in q:
            return state["client"]
        if q.startswith("INSERT"):
            state["writes"].append(q)
            return _uuid.UUID("33333333-3333-3333-3333-333333333333")
        return await base_fetchval(query, *args)

    async def _fetchrow(query, *args):
        q = " ".join(query.split())
        if q.startswith("INSERT"):
            state["writes"].append(q)
            return {"id": _uuid.UUID("22222222-2222-2222-2222-222222222222")}
        return await base_fetchrow(query, *args)

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetchrow.side_effect = _fetchrow
    mock_pool.acquire.return_value.fetchval.side_effect = _fetchval

    async def _build(pool, org_id, sources, **kw):
        state["reads"].append((org_id, list(sources)))
        return {}

    async def _spend(conn, **kw):
        state["spends"].append(kw)
        raise AssertionError("a refused question must never reach the charge")

    monkeypatch.setattr("services.sahayak_answer.build_context", _build)
    monkeypatch.setattr("services.credits.spend", _spend)
    return state


@pytest.mark.asyncio
async def test_the_chat_route_refuses_a_cross_tenant_question(
    api_client, as_platform_manager, victim_org, sahayak_gate_open, hub_chat_wiring,
):
    """The whole chain, end to end. The account holds `platform_manager`, names
    the victim's org, and asks the receivables question."""
    resp = await api_client.post(
        "/api/v1/hub/chat", json={"message": "what do customers owe us"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["answered"] is False
    assert body["refusal"], "a refusal with no sentence is a blank block on screen"
    assert body["refusal_detail"]["kind"] == "access"
    assert body["refusal_detail"]["withheld_modules"] == ["ganit"]


@pytest.mark.asyncio
async def test_the_victims_ledger_was_never_read(
    api_client, as_platform_manager, victim_org, sahayak_gate_open, hub_chat_wiring,
):
    """Not filtered after the fact — never fetched. A filter applied after the
    read is a filter somebody removes, and the rows were in memory by then."""
    await api_client.post(
        "/api/v1/hub/chat", json={"message": "what do customers owe us"},
    )

    assert hub_chat_wiring["reads"] == [], \
        "build_context ran against the victim org on a refused question"


@pytest.mark.asyncio
async def test_nothing_was_written_into_the_victims_org(
    api_client, as_platform_manager, victim_org, sahayak_gate_open, hub_chat_wiring,
):
    """The route used to open `hub_chat_sessions` in the named org, stamped
    `created_by = <the Aekam account>`, BEFORE it asked whether that account
    could have the answer — a write into a tenant it was about to refuse."""
    await api_client.post(
        "/api/v1/hub/chat", json={"message": "what do customers owe us"},
    )

    assert hub_chat_wiring["writes"] == [], \
        f"wrote into the victim org while refusing: {hub_chat_wiring['writes']}"
    assert hub_chat_wiring["spends"] == [], "charged the victim for a refusal"
