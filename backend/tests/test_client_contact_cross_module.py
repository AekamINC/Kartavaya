"""The company record is not the CRM's private property.

`staging.graha_clients` is THE company for the whole product: Ganit bills it,
`vikray_orders.client_id` points at it, and `graha_contacts.client_id` is how a
person is attached to it. The endpoints happen to live in `routers/graha.py`,
and until now every one of them was gated `require_module("graha")` — so a firm
that bought Finance and not the CRM got a 403 on its own customer list and had
no way to add a customer at all.

Two things are tested here, and the second matters as much as the first:

  1. a ganit-only holder can LIST and CREATE both a client and a contact;
  2. that same holder is still refused `/v1/graha/deals`.

A widening is only defensible if you can state its edge. The deals test is that
edge: it fails the moment somebody re-gates the rest of the router "while they
are in there".

── WHY THE GATE IS NOT STUBBED OUT ─────────────────────────────────────────
Every other Graha test file overrides the module dependency away, because its
subject is the handler. This file's subject IS the dependency, so the pool is
routed query-by-query instead and the real `require_any_module` runs.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException

from middleware.subscription import (
    ModuleRefusal, REFUSAL_STAGES, _nearest_refusal, clear_module_cache,
    require_any_module,
)

ORG = "00000000-0000-0000-0000-0000000000c1"
CLIENT_ID = "c1000000-0000-0000-0000-000000000001"
CONTACT_ID = "c2000000-0000-0000-0000-000000000001"

GANIT_ONLY = {"user_id": "u_ganit_only", "email": "books@firm.test", "role": "member"}

CLIENT_ROW = {
    "id": CLIENT_ID, "name": "Acme Ltd", "ref_no": "A-1", "gstin": None,
    "address": {}, "website": None, "notes": None, "tags": [],
    "created_by": GANIT_ONLY["user_id"], "contact_count": 0, "deal_count": 0,
}
CONTACT_ROW = {
    "id": CONTACT_ID, "name": "Priya Sharma", "contact_type": "customer",
    "source": "referral", "company": "Acme Ltd", "client_id": CLIENT_ID,
    "assigned_to": None, "email": "priya@acme.test", "phone": None,
}


# ══════════════════════════════════════════════════════════════════════════════
# The harness: one org, one member, one module.
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _clean_module_cache():
    """`_cache` is module-level and lives five minutes. Two tests in the same
    process that disagree about which modules an org holds would otherwise
    depend on which ran first."""
    clear_module_cache()
    yield
    clear_module_cache()


@pytest.fixture
def ganit_only(app, mock_pool):
    """A member of an org that has activated `ganit` and nothing else, holding
    an `editor` grant on `ganit` and no grant on `graha` or `vikray`.

    This is the customer in the brief: a CA firm that bought the books and not
    the CRM. Nothing here is a bypass — the real dependency runs and reads
    these answers as if they came from Postgres.
    """
    from auth_router import require_user
    from middleware.org_resolver import get_org_id

    app.dependency_overrides[require_user] = lambda: GANIT_ONLY
    app.dependency_overrides[get_org_id] = lambda: ORG

    grants = {"ganit": "editor"}
    active = {"ganit"}

    async def _fetchval(sql, *a):
        s = " ".join(sql.split())
        if "org_id IS NULL" in s:
            return None                       # no platform role
        if "org_member_modules" in s:
            return grants.get(a[2])           # $3 is module_code
        if "module_subscriptions" in s:
            return 1 if a[1] in active else None
        if "graha_clients" in s:              # resolve_contact_company
            return 1
        return None

    async def _fetch(sql, *a):
        s = " ".join(sql.split())
        if "public.user_roles" in s:
            return []                         # not org_owner / org_admin
        # Both list queries NAME BOTH TABLES — the client list counts contacts
        # in a subselect, the contact list joins clients for the company name —
        # so a bare table-name test answers the wrong rows. Routed on a column
        # only one of them projects.
        if "AS contact_count" in s:
            return [dict(CLIENT_ROW, _total=1)]
        if "c.lead_score" in s:
            return [dict(CONTACT_ROW, _total=1)]
        return []

    async def _fetchrow(sql, *a):
        s = " ".join(sql.split())
        if "public.subscriptions" in s:
            return {"status": "active", "features": {}}
        if "graha_contacts" in s:
            return dict(CONTACT_ROW)
        if "graha_clients" in s:
            return dict(CLIENT_ROW)
        return None

    mock_pool.fetchval.side_effect = _fetchval
    mock_pool.fetch.side_effect = _fetch
    mock_pool.fetchrow.side_effect = _fetchrow
    yield
    app.dependency_overrides.pop(require_user, None)
    app.dependency_overrides.pop(get_org_id, None)


# ══════════════════════════════════════════════════════════════════════════════
# 1. The brief: a firm on Finance alone reaches its own customers
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_ganit_only_holder_can_list_clients(api_client, ganit_only):
    resp = await api_client.get("/api/v1/graha/clients")
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["name"] == "Acme Ltd"


async def test_a_ganit_only_holder_can_create_a_client(api_client, ganit_only):
    resp = await api_client.post("/api/v1/graha/clients", json={"name": "Acme Ltd"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "created"


async def test_a_ganit_only_holder_can_list_contacts(api_client, ganit_only):
    resp = await api_client.get("/api/v1/graha/contacts")
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"][0]["name"] == "Priya Sharma"


async def test_a_ganit_only_holder_can_create_a_contact(api_client, ganit_only):
    """And the created person keeps a `client_id`.

    Not decoration: `services/prachar_compliance` adds `AND client_id IS NOT
    NULL` to every marketing audience, because a CA firm soliciting a
    non-client is misconduct under the ICAI code. A contact written from the
    Finance module with a NULL company would be permanently unemailable.
    """
    resp = await api_client.post("/api/v1/graha/contacts", json={
        "name": "Priya Sharma",
        "email": "priya@acme.test",
        "contact_type": "customer",
        "client_id": CLIENT_ID,
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "created"


async def test_the_client_detail_route_is_reachable_too(api_client, ganit_only):
    """The list is useless if opening a row 403s."""
    resp = await api_client.get(f"/api/v1/graha/clients/{CLIENT_ID}")
    assert resp.status_code == 200, resp.text


# ══════════════════════════════════════════════════════════════════════════════
# 2. THE EDGE. Everything else in the router is still CRM-only.
# ══════════════════════════════════════════════════════════════════════════════

async def test_a_ganit_only_holder_is_still_refused_deals(api_client, ganit_only):
    """The widening is clients and contacts. It is not the CRM."""
    resp = await api_client.get("/api/v1/graha/deals")
    assert resp.status_code == 403, resp.text


@pytest.mark.parametrize("path", [
    "/api/v1/graha/pipelines",
    "/api/v1/graha/deals/kanban",
    "/api/v1/graha/follow-ups",
    "/api/v1/graha/activities",
    "/api/v1/graha/labels",
    "/api/v1/graha/territories",
    "/api/v1/graha/custom-fields",
    "/api/v1/graha/web-forms",
    "/api/v1/graha/approval-rules",
    "/api/v1/graha/documents",
    "/api/v1/graha/contacts/duplicates",
    "/api/v1/graha/reports/conversion",
])
async def test_the_rest_of_the_crm_is_untouched(api_client, ganit_only, path):
    """A permission widening has to be the smallest one that does the job, and
    the only way to say that is to name what stayed shut."""
    resp = await api_client.get(path)
    assert resp.status_code == 403, f"{path} answered {resp.status_code}"


def test_exactly_the_named_routes_carry_the_wider_gate():
    """A structural check, so a future bulk edit cannot quietly move the whole
    router onto the wider gate without this file noticing.

    Read off the endpoint SIGNATURES rather than the router table, because that
    is where the change was made — `_g=Depends(...)` — and a check that reads
    the same place a reviewer does cannot be satisfied by a different mechanism
    that happens to produce the same routing.
    """
    import inspect
    import routers.graha as g

    # ⚠ FOURTEEN, NOT TEN. The four coordinate routes joined in Phase 7.1a
    # (migration 237) and this ratchet went red on them — correctly: it is a
    # list of NAMES and four names had been added without anyone updating it.
    #
    # They belong on the wider gate for the same reason the other ten do: the
    # subject is a client or a contact, which a Ganit-only org owns as much as
    # a Graha org does. A firm that bought Finance and not CRM still has
    # customers, and still has a business address to drop a pin on.
    #
    # Widening this set has to be a decision somebody writes down — which is
    # exactly what going red forced here, and why the check is a list of names
    # rather than a count.
    widened = {
        "list_clients", "create_client", "get_client", "update_client",
        "delete_client", "list_contacts", "create_contact", "get_contact",
        "update_contact", "delete_contact",
        "set_client_coordinate", "clear_client_coordinate",
        "set_contact_coordinate", "clear_contact_coordinate",
    }
    on_wide, on_narrow = set(), set()
    for name, fn in vars(g).items():
        if not inspect.isfunction(fn):
            continue
        param = inspect.signature(fn).parameters.get("_g")
        dep = getattr(getattr(param, "default", None), "dependency", None)
        if dep is g._crm_entity_gate:
            on_wide.add(name)
        elif dep is g._gate:
            on_narrow.add(name)

    assert on_wide == widened, (
        "exactly the client and contact routes may carry the wider gate; "
        f"unexpected: {sorted(on_wide - widened)}, "
        f"missing: {sorted(widened - on_wide)}"
    )
    # And the rest of the router did not lose its gate along the way.
    assert len(on_narrow) > 50, f"only {len(on_narrow)} routes left on graha"


# ══════════════════════════════════════════════════════════════════════════════
# 3. What the refusal SAYS
# ══════════════════════════════════════════════════════════════════════════════

class TestTheRefusalIsUsable:
    """`require_any_module` produces several 403s and must show exactly one.

    The temptation is to concatenate them, which reads as a price list — "buy
    CRM, Finance or Sales" — and is usually not even the caller's problem.
    """

    @staticmethod
    def _r(stage, detail, code="graha"):
        return ModuleRefusal(detail, stage=stage, module_code=code)

    def test_every_stage_the_gate_can_raise_is_ranked(self):
        """An unranked stage sorts below everything and would silently never be
        chosen. This is the tripwire for adding a new refusal."""
        import inspect
        import middleware.subscription as sub

        src = inspect.getsource(sub.require_module)
        raised = set(
            line.split('stage="')[1].split('"')[0]
            for line in src.splitlines() if 'stage="' in line
        )
        assert raised, "no stages found — did the raise sites change shape?"
        assert raised <= set(REFUSAL_STAGES), (
            f"unranked refusal stage(s): {raised - set(REFUSAL_STAGES)}"
        )

    def test_one_shared_reason_is_passed_through_verbatim(self):
        """"Subscription is not active" is a fact about the ORG, so all three
        modules answer it identically and there is nothing to choose."""
        out = _nearest_refusal(
            [self._r("subscription", "Subscription is not active", c)
             for c in ("graha", "ganit", "vikray")],
            subject="clients and contacts",
        )
        assert out.detail == "Subscription is not active"

    def test_the_nearest_door_wins_over_the_first_one(self):
        """The case that decides whether this is worth the machinery.

        A person who is Viewer on Finance, inside a firm that never bought the
        CRM, must be told to ask for Editor on Finance — not to go and buy a
        CRM, which is what naming the first code would do.
        """
        out = _nearest_refusal(
            [
                self._r("no_grant", "You don't have access to the graha module. "
                                    "Ask your org admin to grant it.", "graha"),
                self._r("level", "Your ganit access is Viewer: you can read it, "
                                 "but not change it. Ask an org admin for Editor.",
                        "ganit"),
                self._r("no_grant", "You don't have access to the vikray module. "
                                    "Ask your org admin to grant it.", "vikray"),
            ],
            subject="clients and contacts",
        )
        assert "ganit" in out.detail and "Editor" in out.detail
        assert "graha" not in out.detail and "vikray" not in out.detail

    def test_a_caller_holding_none_of_them_is_told_about_the_DATA(self):
        """The tie. Every module is equally far away, so naming any one of them
        is a guess — and naming all three is a price list."""
        out = _nearest_refusal(
            [self._r("no_grant",
                     f"You don't have access to the {c} module. "
                     "Ask your org admin to grant it.", c)
             for c in ("graha", "ganit", "vikray")],
            subject="clients and contacts",
        )
        assert out.detail == (
            "You don't have access to clients and contacts. Ask your org admin "
            "to grant you a module that includes clients and contacts."
        )
        for code in ("graha", "ganit", "vikray"):
            assert code not in out.detail

    def test_without_a_subject_it_falls_back_to_naming_a_module(self):
        """`subject` is optional and its absence must not produce a sentence
        with a hole in it."""
        out = _nearest_refusal(
            [self._r("no_grant", f"You don't have access to the {c} module.", c)
             for c in ("graha", "ganit")],
            subject=None,
        )
        assert out.detail == "You don't have access to the graha module."


class TestTheGateComposes:
    """`require_any_module` runs the real `require_module`, in order, and stops
    at the first pass."""

    ORG = ORG

    @staticmethod
    def _req(method="GET", path="/api/v1/graha/clients"):
        r = MagicMock()
        r.method = method
        r.url = MagicMock()
        r.url.path = path
        r.state = MagicMock()
        r.state._auth_user = {"user_id": "u_member"}
        return r

    @staticmethod
    def _pool(grants: dict, active: set):
        pool = MagicMock()

        async def _fetchval(sql, *a):
            s = " ".join(sql.split())
            if "org_id IS NULL" in s:
                return None
            if "org_member_modules" in s:
                return grants.get(a[2])
            if "module_subscriptions" in s:
                return 1 if a[1] in active else None
            return None

        pool.fetchval = AsyncMock(side_effect=_fetchval)
        pool.fetch = AsyncMock(return_value=[])
        pool.fetchrow = AsyncMock(
            return_value={"status": "active", "features": {}})
        pool.execute = AsyncMock()
        return pool

    async def _run(self, gate, pool, req=None):
        import middleware.subscription as sub

        async def _get_pool():
            return pool

        saved = sub.get_pool
        sub.get_pool = _get_pool
        try:
            return await gate(req or self._req(), org_id=self.ORG)
        except HTTPException as e:
            return e
        finally:
            sub.get_pool = saved

    async def test_it_needs_at_least_one_code(self):
        with pytest.raises(ValueError):
            require_any_module()

    async def test_the_second_code_admits_when_the_first_refuses(self):
        gate = require_any_module("graha", "ganit", subject="clients")
        out = await self._run(gate, self._pool({"ganit": "editor"}, {"ganit"}))
        assert out == "ganit", "the module that admitted the caller is returned"

    async def test_the_first_code_short_circuits_the_rest(self):
        """Cost control, and it is also what keeps the audit row single: only
        the code that passes ever reaches the audit write."""
        gate = require_any_module("graha", "ganit", subject="clients")
        pool = self._pool({"graha": "editor", "ganit": "editor"},
                          {"graha", "ganit"})
        out = await self._run(gate, pool)
        assert out == "graha"
        # args = (sql, user_id, org_id, module_code)
        asked = [c.args[3] for c in pool.fetchval.call_args_list
                 if "org_member_modules" in c.args[0]]
        assert asked == ["graha"], f"it kept going after a pass: {asked}"

    async def test_a_write_still_needs_editor_on_the_module_that_admits(self):
        """The widening must not become a way around the write rung: a Viewer
        on Finance may READ the client list and may not add to it."""
        gate = require_any_module("graha", "ganit", subject="clients")
        pool = self._pool({"ganit": "viewer"}, {"ganit"})

        read = await self._run(gate, pool)
        assert read == "ganit"

        clear_module_cache()
        write = await self._run(
            gate, pool, self._req("POST", "/api/v1/graha/clients"))
        assert isinstance(write, HTTPException) and write.status_code == 403
        assert "Editor" in write.detail

    async def test_holding_none_of_them_is_a_403(self):
        gate = require_any_module("graha", "ganit", "vikray",
                                  subject="clients and contacts")
        out = await self._run(gate, self._pool({}, set()))
        assert isinstance(out, HTTPException) and out.status_code == 403
        assert "clients and contacts" in out.detail
