"""What a platform account may see and do across an organisation boundary.

The owner stated the rule directly. It is not inferred from a threat model and
it is narrower than the console was built on:

    "no one should be able to see any other org data even god mode users — such
     as org members list or what their cap is. God mode can only switch between
     orgs if they are part of it. I as god mode can see all the tasks of all orgs
     which I shouldn't at all. God mode can only see the NUMBER OF USERS count
     under an org, can INVITE AN ORG ADMIN if needed, and can CHANGE THE ORG
     EMAIL ADDRESS — so that if someone leaves that org there is a new point of
     contact."

So the entire cross-org surface of `routers/admin_orgs.py` is three things:

    1. the COUNT of users under an org — a number, not a list
    2. inviting an org admin
    3. changing the org's point-of-contact email address

Three defects, one per capability, and the third is an absence rather than a
leak:

  1. `GET /api/v1/admin/orgs/{org_id}` returned, for ANY org and on a platform
     ROLE TIER alone: every member's user_id, email, full name, org roles and
     grant date; every per-member module grant; the seat cap; the plan; the
     monthly credit allowance; the markup; the monthly price; and the UPI payee
     columns. Ten of the ten live platform accounts could read all of it for
     Unicode Group, a paying customer. (The two payee columns are NULL for all
     three organisations today, so the code path leaked them and there was no
     live payee data to leak.)

  2. `POST /api/v1/admin/orgs/{org_id}/members` let `platform_staff` — four live
     holders, whose remit is the operating set — make any account an `org_admin`
     of any customer organisation, and hand it `vetana` and `manav` in the same
     request. The capability itself is PERMITTED and is kept; who may use it and
     what it may hand out are what changed.

  3. There was NO ENDPOINT ANYWHERE that changed an organisation's contact
     address from the platform side. `staging.organisations.email` had exactly
     one writer in the tree, `org_profile.update_profile`, and that one is
     `require_org_role` behind `get_org_id` — the organisation's own admin,
     which is exactly the person the owner describes as gone.

── How these are tested ─────────────────────────────────────────────────────

The pool is conftest's MagicMock and a mocked cursor answers any query with
whatever the test hands it, so an HTTP assertion that "the response has no
`members` key" proves the mock returned none, not that the rule exists. The
rules therefore live in pure functions — `_public_org_view`,
`_assert_invite_is_only_an_org_admin` — and those are tested directly. The HTTP
tests are here to prove the handler ASKS for the right thing and refuses the
right callers, which is the one thing a mocked pool can honestly show.
"""

import ast
import inspect
import textwrap
from datetime import datetime, timezone

import pytest

from middleware.role_tiers import GOD_MODE_ROLES, STAFF_ROLES
from routers.admin_orgs import (
    INVITABLE_ORG_ROLE, ORG_PUBLIC_FIELDS, _assert_invite_is_only_an_org_admin,
    _public_org_view,
)

GOD = GOD_MODE_ROLES[0]
STAFF = STAFF_ROLES[0]
ORG = "00000000-0000-0000-0000-0000000000dd"


def _executable_source(fn) -> str:
    """A function's source with comments and docstrings removed.

    Every source-level assertion below matches on a column name — `max_users`,
    `upi_vpa`, `org_member_modules` — and every one of those names also appears
    in the prose explaining WHY it is not returned. A tripwire matched against
    raw `inspect.getsource` is satisfied by its own explanation and stays green
    when the code it guards is deleted; four checks have shipped in this repo
    with exactly that hole. Same shape as `_code_only` in
    `test_scraper_credits.py`.
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


#: Every column the old detail SELECT returned, with a value that is
#: recognisable if it ever appears in a response. This is the leak, written out.
FULL_ORG_ROW = {
    "id": ORG,
    "team_id": "team_leak",
    "name": "Unicode Group",
    "email": "info@unicodegroup.com",
    "owner_user_id": "user_owner_leak",
    "owner_email": "owner@unicodegroup.com",
    "is_active": True,
    "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    "updated_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
    "r2_account_id": "r2acct_leak",
    "r2_bucket_name": "bucket_leak",
    "storage_limit_bytes": 26843545600,
    "storage_used_bytes": 1234567,
    "markup_pct": 0.5,
    "monthly_credits": 1000,
    "monthly_price": 12000.00,
    "max_users": 15,
    "is_platform_org": False,
    "upi_vpa": "unicode@okhdfcbank",
    "upi_payee_name": "Unicode Group Pvt Ltd",
    "plan_code": "growth",
    "plan_name": "Growth",
    "gstin": "24AAAAA0000A1Z5",
}

#: What must never come out of the detail read, whatever is in the row.
#:
#: WRITTEN OUT, not derived as `FULL_ORG_ROW - ORG_PUBLIC_FIELDS`. It was
#: derived at first, and the mutation run caught it: adding `max_users` to
#: `ORG_PUBLIC_FIELDS` also removed it from the forbidden set, so the check
#: passed while the seat cap went back on the wire. A tripwire computed from the
#: thing it is watching cannot see that thing change.
FORBIDDEN_ORG_FIELDS: tuple[str, ...] = (
    "team_id", "owner_user_id", "owner_email",
    "r2_account_id", "r2_bucket_name", "storage_limit_bytes", "storage_used_bytes",
    "markup_pct", "monthly_credits", "monthly_price", "max_users",
    "is_platform_org", "upi_vpa", "upi_payee_name",
    "plan_code", "plan_name", "gstin",
)

#: The allow-list, transcribed. Widening `ORG_PUBLIC_FIELDS` must be a DECISION
#: with a test change beside it, not something that happens while satisfying
#: another check. This is the line that makes it one.
EXPECTED_PUBLIC_FIELDS = {
    "id", "name", "email", "is_active", "created_at", "updated_at",
}


# ── 1. The count is a number, and nothing rides along with it ────────────────


def test_the_org_view_is_an_allow_list_not_a_strip_list():
    """Hand it the whole leak and take back six fields.

    A deny-list is correct the day it is written and leaks every column added
    afterwards — `staging.organisations` has grown to 41 columns and the two UPI
    ones arrived in migration 096 and reached this response by being added to a
    SELECT nobody re-read.
    """
    assert set(ORG_PUBLIC_FIELDS) == EXPECTED_PUBLIC_FIELDS, (
        "ORG_PUBLIC_FIELDS was widened. That is a decision about what may cross "
        "an organisation boundary — make it here, deliberately, in the same "
        "commit."
    )

    view = _public_org_view(FULL_ORG_ROW)

    assert set(view) == EXPECTED_PUBLIC_FIELDS
    for field in FORBIDDEN_ORG_FIELDS:
        assert field not in view, f"{field} still crosses the org boundary"


def test_no_forbidden_VALUE_survives_the_view():
    """Names, not values, is half a fix.

    Renaming `max_users` to `seats` in the response would satisfy a key-only
    assertion while shipping the same integer. This looks for the values
    themselves.
    """
    view = _public_org_view(FULL_ORG_ROW)
    permitted = {FULL_ORG_ROW[k] for k in EXPECTED_PUBLIC_FIELDS}
    leaked = {FULL_ORG_ROW[f] for f in FORBIDDEN_ORG_FIELDS} - permitted
    for value in view.values():
        assert value not in leaked, \
            f"{value!r} came from a field that may not cross the boundary"


def test_a_column_missing_from_the_database_is_null_not_a_crash():
    """`.get`, not `[...]`. A deploy whose database has not got a column yet must
    answer null for it rather than raising KeyError out of a GET."""
    view = _public_org_view({"id": ORG, "name": "Half-migrated Co"})
    assert view["email"] is None
    assert set(view) == EXPECTED_PUBLIC_FIELDS


def test_the_detail_read_names_no_commercial_or_member_column():
    """The serializer is the rule; the SELECT must agree with it.

    A column that is never read cannot be logged, cannot appear in a traceback
    and cannot be returned by a future edit that forgets `_public_org_view`.
    """
    import routers.admin_orgs as ao

    src = _executable_source(ao.get_org)
    for banned in (
        "max_users", "monthly_price", "monthly_credits", "markup_pct",
        "upi_vpa", "upi_payee_name", "is_platform_org",
        "org_member_modules", "user_roles", "plan_name", "owner_email",
        "storage_used_bytes", "r2_account_id",
    ):
        assert banned not in src, (
            f"GET /admin/orgs/{{id}} reads {banned} for an organisation the "
            "caller may not be a member of"
        )


def _wire(mock_pool, *, role=GOD, joined=5, org_row=None):
    """Wire a platform-console request for the detail read.

    Dispatch on query text: `count_seats` issues three fetchvals in a fixed
    order and asserting on order breaks the moment a query is added.
    """
    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return role if role in allowed else None
        if "COALESCE(o.max_users, p.max_users)" in query:
            return 15
        if "COUNT(DISTINCT user_id)" in query:
            return joined
        if "FROM invites" in query:
            return 7
        return None

    async def fetchrow(query, *args):
        if "FROM staging.organisations" in query:
            return dict(org_row if org_row is not None else FULL_ORG_ROW)
        if "FROM users" in query:
            return {"user_id": "user_target", "email": "new.admin@unicodegroup.com"}
        return None

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = [
        {"module_code": "graha", "is_active": True, "activated_at": None},
    ]
    return mock_pool


@pytest.fixture
def as_platform(app, member_user):
    from auth_router import require_user
    app.dependency_overrides[require_user] = lambda: member_user
    yield member_user
    app.dependency_overrides.pop(require_user, None)


async def test_the_detail_response_carries_a_count_and_no_roster(
    api_client, as_platform, mock_pool
):
    """The whole finding, end to end.

    The mock is deliberately handed the FULL row — every column the old SELECT
    returned — so this fails if the handler starts passing the row through
    rather than the view.
    """
    _wire(mock_pool, joined=5)
    r = await api_client.get(f"/api/v1/admin/orgs/{ORG}")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["member_count"] == 5
    assert isinstance(body["member_count"], int)
    assert "members" not in body, "the roster is still on the wire"
    assert "member_modules" not in body

    for field in FORBIDDEN_ORG_FIELDS:
        assert field not in body["org"], f"{field} still crosses the org boundary"


async def test_the_count_carries_neither_the_cap_nor_the_pending_invites(
    api_client, as_platform, mock_pool
):
    """`SeatCount` also holds `limit` and `pending`, and both are dropped.

    `limit` is the seat cap, which the owner names in as many words. `pending`
    would let the number be read as "5 of 12", which reconstructs part of the
    cap from a figure that is supposed to carry none. The mock returns 15 and 7
    for those two, so either appearing anywhere in the response is this test
    failing.
    """
    _wire(mock_pool, joined=5)
    r = await api_client.get(f"/api/v1/admin/orgs/{ORG}")
    assert r.status_code == 200, r.text
    assert 15 not in r.json().values()
    assert "max_users" not in r.text
    assert "pending" not in r.text


async def test_a_missing_org_is_still_a_404(api_client, as_platform, mock_pool):
    _wire(mock_pool)
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = None
    r = await api_client.get(f"/api/v1/admin/orgs/{ORG}")
    assert r.status_code == 404


# ── 2. Inviting an org admin: who, and what ─────────────────────────────────


def test_the_only_role_this_console_hands_out_is_org_admin():
    assert INVITABLE_ORG_ROLE == "org_admin"
    _assert_invite_is_only_an_org_admin(
        roles=["org_admin"], module_grants=[], mobile_number="",
    )


@pytest.mark.parametrize("roles", [["org_member"], ["org_owner"], ["org_admin", "org_member"], []])
def test_anything_other_than_one_org_admin_is_refused(roles):
    """Adding staff to a customer's organisation is that organisation's own
    business — `POST /api/v1/org/members` — and is not on the owner's list."""
    with pytest.raises(Exception) as exc:
        _assert_invite_is_only_an_org_admin(
            roles=roles, module_grants=[], mobile_number="",
        )
    assert exc.value.status_code == 400


def test_module_grants_are_refused_and_the_refusal_names_them():
    """This is the half of the finding that reached payroll. `SENSITIVE_MODULES`
    is withheld from the auto-grant path; the explicit list walked around it."""
    with pytest.raises(Exception) as exc:
        _assert_invite_is_only_an_org_admin(
            roles=["org_admin"], module_grants=["vetana", "manav"], mobile_number="",
        )
    assert exc.value.status_code == 400
    assert "vetana" in str(exc.value.detail)


def test_a_mobile_number_is_refused():
    """It is a field on somebody else's staff record."""
    with pytest.raises(Exception) as exc:
        _assert_invite_is_only_an_org_admin(
            roles=["org_admin"], module_grants=[], mobile_number=" 9876543210 ",
        )
    assert exc.value.status_code == 400


async def test_platform_staff_may_no_longer_invite_an_org_admin(
    api_client, as_platform, mock_pool
):
    """Four live holders. `role_tiers.py:20-22` defines the role as the
    operating set — CRM, sales, marketing, Sahayak, analytics, messaging, core
    PM. Administrative control of a customer's organisation is not in it."""
    _wire(mock_pool, role=STAFF)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "new.admin@unicodegroup.com", "roles": ["org_admin"]},
    )
    assert r.status_code == 403


async def test_god_mode_may_still_invite_an_org_admin(
    api_client, as_platform, mock_pool
):
    """The capability is in the spec and is KEPT. A narrowing that takes the
    permitted capability with it is not a fix."""
    _wire(mock_pool, role=GOD)
    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "new.admin@unicodegroup.com", "roles": ["org_admin"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["roles"] == ["org_admin"]


async def test_the_invitation_writes_no_module_grant_row(
    api_client, as_platform, mock_pool
):
    """The route, not just the rule. An `org_member_modules` INSERT from this
    handler is the leak reaching payroll, whatever the body said."""
    _wire(mock_pool, role=GOD)
    statements = []

    async def execute(query, *args):
        statements.append(query)
        return "INSERT 1"

    mock_pool.execute.side_effect = execute

    r = await api_client.post(
        f"/api/v1/admin/orgs/{ORG}/members",
        json={"email": "new.admin@unicodegroup.com", "roles": ["org_admin"]},
    )
    assert r.status_code == 200, r.text
    assert not any("org_member_modules" in q for q in statements)
    assert not any("UPDATE users" in q for q in statements), \
        "the console wrote to another organisation's staff record"


async def test_assign_role_is_the_second_door_and_is_shut(
    api_client, as_platform, mock_pool
):
    """`POST /roles/assign` writes the identical `staging.user_roles` row. While
    `org_member` was legal there, the narrowing above was cosmetic for god mode
    — the only role that reaches this route."""
    _wire(mock_pool, role=GOD)
    r = await api_client.post(
        "/api/v1/admin/orgs/roles/assign",
        json={"user_id": "user_target", "role_code": "org_member", "org_id": ORG},
    )
    assert r.status_code == 400
    assert "org_admin" in r.json()["detail"]


# ── 3. The point-of-contact address: the capability that did not exist ───────


def _wire_contact(mock_pool, *, role=GOD, current="info@unicodegroup.com", exists=True):
    """Wire the contact-email route. The handler works on an acquired connection,
    so the org read and both writes are on the CONNECTION mock, not the pool."""
    async def fetchval(query, *args):
        if "staging.user_roles" in query and "org_id IS NULL" in query:
            allowed = args[1] if len(args) > 1 else []
            return role if role in allowed else None
        return None

    mock_pool.fetchval.side_effect = fetchval

    conn = mock_pool.acquire.return_value
    statements = []

    async def conn_fetchrow(query, *args):
        if not exists:
            return None
        return {"name": "Unicode Group", "email": current}

    async def conn_execute(query, *args):
        statements.append((query, args))
        return "UPDATE 1"

    conn.fetchrow.side_effect = conn_fetchrow
    conn.execute.side_effect = conn_execute
    return statements


async def test_the_contact_email_endpoint_exists_at_all(
    api_client, as_platform, mock_pool
):
    """The finding was an ABSENCE. Before this, `staging.organisations.email`
    had one writer in the tree and it was the organisation's own admin — the
    person the owner is describing as having left."""
    _wire_contact(mock_pool, role=GOD)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/contact-email",
        json={"email": "accounts@unicodegroup.com"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "org_id": ORG,
        "email": "accounts@unicodegroup.com",
        "previous_email": "info@unicodegroup.com",
        "changed": True,
    }


async def test_the_change_is_written_with_an_audit_row(
    api_client, as_platform, mock_pool
):
    """Who, from what, to what, when. The first three are in the event metadata;
    the fourth is `subscription_events.created_at`.

    Both statements are asserted together because they are one transaction: a
    change with no trail and a trail with no change are both failures.
    """
    statements = _wire_contact(mock_pool, role=GOD)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/contact-email",
        json={"email": "accounts@unicodegroup.com"},
    )
    assert r.status_code == 200, r.text

    updates = [s for s in statements if "UPDATE staging.organisations" in s[0]]
    events = [s for s in statements if "subscription_events" in s[0]]
    assert len(updates) == 1, "the address was not written exactly once"
    assert "accounts@unicodegroup.com" in updates[0][1]

    assert len(events) == 1, "the change left no audit row"
    _query, args = events[0]
    assert "org_contact_email_changed" in args
    metadata = args[-1]
    for expected in ("info@unicodegroup.com", "accounts@unicodegroup.com",
                     "user_mem001"):
        assert expected in metadata, f"the audit row does not record {expected}"


async def test_resending_the_same_address_changes_nothing_and_logs_nothing(
    api_client, as_platform, mock_pool
):
    """A trail padded with rows that changed nothing is a trail nobody reads.
    Case-blind, because `Info@` and `info@` are the same mailbox."""
    statements = _wire_contact(mock_pool, role=GOD, current="info@unicodegroup.com")
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/contact-email",
        json={"email": "INFO@unicodegroup.com"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["changed"] is False
    assert statements == [], "a no-op wrote to the database"


async def test_the_old_value_is_read_under_a_lock(api_client, as_platform, mock_pool):
    """Two operators changing the address at once must not both write an audit
    row claiming they replaced the same address — one of them did not, and a
    trail that can be wrong about what it replaced is worse than none because it
    is believed."""
    import routers.admin_orgs as ao

    src = _executable_source(ao.set_org_contact_email)
    assert "FOR UPDATE" in src


async def test_platform_staff_cannot_change_a_customers_point_of_contact(
    api_client, as_platform, mock_pool
):
    """The owner's sentence gives this to god mode. Redirecting where a
    customer's mail goes is as consequential as any role grant."""
    _wire_contact(mock_pool, role=STAFF)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/contact-email",
        json={"email": "attacker@example.com"},
    )
    assert r.status_code == 403


async def test_a_missing_org_cannot_have_its_contact_changed(
    api_client, as_platform, mock_pool
):
    _wire_contact(mock_pool, role=GOD, exists=False)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/contact-email",
        json={"email": "accounts@unicodegroup.com"},
    )
    assert r.status_code == 404


@pytest.mark.parametrize("value", ["", None, "not-an-address", "  "])
async def test_the_address_cannot_be_cleared_or_malformed(
    api_client, as_platform, mock_pool, value
):
    """This capability exists so that an organisation always HAS a point of
    contact. `EmailStr` refuses all four before the handler body runs."""
    _wire_contact(mock_pool, role=GOD)
    r = await api_client.patch(
        f"/api/v1/admin/orgs/{ORG}/contact-email", json={"email": value},
    )
    assert r.status_code == 422
