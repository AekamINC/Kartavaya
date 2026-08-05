"""An org's commercial terms must be amendable, clearable, and set by one role set.

Five columns on `staging.organisations` are commercial terms Aekam negotiates by
hand: `markup_pct`, `monthly_credits`, `monthly_price`, `max_users`, and (after
migration 095) `is_platform_org`. Four separate defects meant that between them
they could be set once and never corrected.

  1. **`int(None)` / `float(None)` → 500.** `update_org_settings` tested
     `if "markup_pct" in body` and then called `float(body["markup_pct"])`. A
     CLEARED field does not arrive absent — it arrives present and null, which is
     what any form that renders every field posts for the ones it did not touch.
     So a request that touched one field 500'd on the others. A negotiated fee
     could not be un-set, and the operator got a stack trace rather than an
     answer.

     Null now means different things for different columns, and it has to,
     because the columns differ: `max_users` is NULLABLE and null there is
     meaningful ("fall back to the plan's seat count"), while the other three are
     NOT NULL and have no value null could be written as, so null is "no change".

  2. **`max_users` had no writer anywhere in the product and was returned by no
     endpoint.** The seat refusal literally told the operator to raise it. There
     was no request that could.

  3. **The markup role gate was split.** `create_org` is CONSOLE_ROLES, which
     includes `platform_staff`; `PATCH /settings` is BILLING_CONSOLE_ROLES, which
     excludes it. So the least-privileged console role set a customer's MARKUP
     once, at creation, could never amend it, and was shown a Save button that
     403s. role_tiers.py:193-203: a role that must not SEE the margin must not be
     able to set it.

  4. **`is_platform_org` skips the org balance check.** Whoever can set it can
     give an organisation free everything, so it is god mode even among the
     billing roles — narrower than the four beside it, deliberately.

Nothing here touches a database; the pool is conftest's MagicMock.
"""

import ast
import inspect
import textwrap

import pytest

from middleware.role_tiers import (
    BILLING_CONSOLE_ROLES, GOD_MODE_ROLES, STAFF_ROLES,
)


def _executable_source(fn) -> str:
    """A function's source with comments and docstrings removed.

    Same shape, and for the same reason, as `_code_only` in
    `test_scraper_credits.py`: the strings these assertions match on —
    `o.max_users`, `o.is_platform_org` — also appear in the prose explaining what
    they are for, so a check run against raw `inspect.getsource` is satisfied by
    its own commentary and stays green when the code it guards is deleted. Four
    checks have shipped in this repo with exactly that hole.

    `ast.unparse` drops comments; the walk drops docstrings.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list) or not body:
            continue
        first = body[0]
        if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)

GOD = GOD_MODE_ROLES[0]
STAFF = STAFF_ROLES[0]
BILLING = "account_manager"      # in BILLING_CONSOLE_ROLES, not god mode
ORG = "00000000-0000-0000-0000-0000000000cc"


@pytest.fixture
def as_platform(app, member_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


@pytest.fixture
def wired(mock_pool):
    """Wire the console, and record the UPDATE this endpoint builds.

    The assertions are on the statement rather than on a return value, because
    the defect being pinned is which columns get written — a read-back cannot
    tell "wrote 0" from "did not write".
    """
    state = {"role": GOD, "updates": [], "row": None}

    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return state["role"] if state["role"] in allowed else None
        return None

    async def fetchrow(query, *args):
        if "markup_pct" in query and "FROM staging.organisations" in query:
            return state["row"] or {
                "markup_pct": 0.3, "monthly_credits": 500, "monthly_price": 9999,
                "max_users": 5, "is_platform_org": False,
            }
        return None

    async def execute(query, *args):
        if query.strip().upper().startswith("UPDATE STAGING.ORGANISATIONS"):
            state["updates"].append((query, args))
        return "UPDATE 1"

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.execute.side_effect = execute
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []
    return state


async def _patch(api_client, body):
    return await api_client.patch(f"/api/v1/admin/orgs/{ORG}/settings", json=body)


# ── 1. A cleared field is not a 500 ──────────────────────────────────────────

@pytest.mark.parametrize("field", [
    "markup_pct", "monthly_credits", "monthly_price", "max_users",
    "is_platform_org",
])
async def test_a_null_on_any_commercial_field_is_never_a_500(
    api_client, as_platform, wired, field
):
    """One case per field, not one aggregate: the old code had a separate
    `int(None)` for each, and an aggregate failure hides which ones are left."""
    resp = await _patch(api_client, {field: None, "markup_pct": 0.25})
    assert resp.status_code != 500, (
        f"a cleared {field} still crashes the handler — this is the request "
        "every settings form sends for the fields it did not touch"
    )


async def test_a_null_on_a_not_null_column_leaves_it_alone(api_client, as_platform, wired):
    """`monthly_price` is NOT NULL. There is no value a null could be written
    as, so the only honest reading is "no change" — and it must certainly not be
    read as zero, which would silently waive a customer's monthly fee."""
    resp = await _patch(api_client, {"markup_pct": 0.4, "monthly_price": None})
    assert resp.status_code == 200, resp.text

    query, _args = wired["updates"][0]
    assert "markup_pct=" in query
    assert "monthly_price=" not in query, \
        "a null monthly_price was written to a NOT NULL column"


async def test_a_null_max_users_clears_it_back_to_the_plan(api_client, as_platform, wired):
    """`max_users` IS nullable, and null there is the real answer "this org has
    no seat count of its own — use the plan's". Treating it as "no change" would
    make a negotiated seat count unrevertible."""
    resp = await _patch(api_client, {"max_users": None})
    assert resp.status_code == 200, resp.text

    query, args = wired["updates"][0]
    assert "max_users=" in query, "a cleared seat count was ignored"
    assert None in args, "max_users was not written as NULL"


# ── 2. max_users is writable and readable ────────────────────────────────────

async def test_max_users_can_be_raised(api_client, as_platform, wired):
    """The seat refusal tells the operator to raise this. Until now nothing
    could: it appeared in no UPDATE and in no SELECT in the console."""
    resp = await _patch(api_client, {"max_users": 12})
    assert resp.status_code == 200, resp.text

    query, args = wired["updates"][0]
    assert "max_users=" in query
    assert 12 in args


async def test_max_users_is_returned_by_the_patch(api_client, as_platform, wired):
    resp = await _patch(api_client, {"max_users": 12})
    body = resp.json()
    assert "max_users" in body, "the console cannot read back what it just set"
    assert "is_platform_org" in body


async def test_zero_seats_is_refused(api_client, as_platform, wired):
    """Null means "use the plan". Zero would mean an org nobody may belong to,
    including its own owner, and there is no reason to sell one."""
    resp = await _patch(api_client, {"max_users": 0})
    assert resp.status_code == 400


async def test_a_non_numeric_value_is_a_400_not_a_500(api_client, as_platform, wired):
    resp = await _patch(api_client, {"monthly_credits": "lots"})
    assert resp.status_code == 400


async def test_the_org_list_returns_the_seat_count(api_client):
    """`GET /admin/orgs` names `max_users`, which for a long time nothing did
    while the seat refusal told the operator to raise it.

    This used to assert the same of `GET /admin/orgs/{id}`, and that half has
    MOVED — inverted, with the owner's reason — to
    `test_cross_org_console_surface.py`. The detail read must not carry another
    organisation's seat cap: "no one should be able to see any other org data
    even god mode users — such as org members list or what their cap is."

    The two reads are no longer symmetrical and that is the point. The LIST is
    Aekam's own book of who its customers are and what it agreed with them; the
    DETAIL is a window into one customer, which is the thing the rule is about.
    Whether the list should be narrowed too is a live question and is recorded
    as one — it is not settled by silence here.
    """
    import routers.admin_orgs as ao

    src = _executable_source(ao.list_orgs)
    assert "o.max_users" in src, "list_orgs does not return the seat count"
    assert "o.is_platform_org" in src, "list_orgs does not return the platform flag"


# ── 3. The commercial fields sit behind ONE role set, at creation and after ──

async def test_platform_staff_cannot_set_markup_at_creation(
    api_client, as_platform, wired
):
    """This is the whole asymmetry: `create_org` admitted platform_staff and let
    it write a markup that `PATCH /settings` would then refuse to let it change.
    A term you can set once and never correct is worse than one you cannot set."""
    assert STAFF not in BILLING_CONSOLE_ROLES
    wired["role"] = STAFF

    resp = await api_client.post("/api/v1/admin/orgs", json={
        "name": "New Co", "owner_email": "owner@test.com", "markup_pct": 0.45,
    })
    assert resp.status_code == 403
    assert "markup_pct" in resp.json()["detail"], \
        "the refusal does not name the field, so the operator cannot act on it"


async def test_platform_staff_may_still_create_an_org(api_client, as_platform, wired):
    """The narrowing is on the FIELDS, not on org creation. Creating an
    organisation is provisioning; setting what it is charged is not.

    Reaching the owner lookup — a 404 for an address with no account — is the
    proof it got past the gate.
    """
    wired["role"] = STAFF
    resp = await api_client.post("/api/v1/admin/orgs", json={
        "name": "New Co", "owner_email": "nobody@test.com",
    })
    assert resp.status_code == 404, resp.text


async def test_a_billing_role_may_set_markup_at_creation(api_client, as_platform, wired):
    assert BILLING in BILLING_CONSOLE_ROLES
    wired["role"] = BILLING
    resp = await api_client.post("/api/v1/admin/orgs", json={
        "name": "New Co", "owner_email": "nobody@test.com", "markup_pct": 0.45,
    })
    assert resp.status_code == 404, resp.text     # past the gate, no such owner


async def test_a_billing_role_may_amend_what_it_could_set(api_client, as_platform, wired):
    """The acceptance criterion in as many words: a commercial term set at
    creation can be amended later by the same role set that could set it."""
    wired["role"] = BILLING
    resp = await _patch(api_client, {"markup_pct": 0.45, "max_users": 20})
    assert resp.status_code == 200, resp.text


# ── 4. is_platform_org is god mode alone ─────────────────────────────────────

async def test_a_billing_role_cannot_flag_an_org_as_platform(
    api_client, as_platform, wired
):
    """It skips the org balance check. The role that can set it can hand an
    organisation unlimited spend, which is not a billing decision."""
    wired["role"] = BILLING
    resp = await _patch(api_client, {"is_platform_org": True})
    assert resp.status_code == 403
    assert "is_platform_org" in resp.json()["detail"]


async def test_god_mode_can_flag_an_org_as_platform(api_client, as_platform, wired):
    wired["role"] = GOD
    resp = await _patch(api_client, {"is_platform_org": True})
    assert resp.status_code == 200, resp.text
    query, args = wired["updates"][0]
    assert "is_platform_org=" in query
    assert True in args


async def test_a_billing_role_cannot_set_the_platform_flag_at_creation(
    api_client, as_platform, wired
):
    """The same gate on the same field on the other endpoint. Migration 095
    deliberately does NOT hardcode which org is Aekam's — a migration that names
    an org_id flags the wrong org on the next environment — so this endpoint is
    how the flag is ever set, and it must not be reachable one tier down."""
    wired["role"] = BILLING
    resp = await api_client.post("/api/v1/admin/orgs", json={
        "name": "Aekam", "owner_email": "nobody@test.com", "is_platform_org": True,
    })
    assert resp.status_code == 403
    assert "is_platform_org" in resp.json()["detail"]
