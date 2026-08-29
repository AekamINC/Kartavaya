"""
The employee record ↔ login link — Manav.

`manav_employees.user_id` is the only column joining a personnel file to an
account that can sign in, and nothing in the product could set it on an existing
record. Measured read-only against the shared staging/production database before
this shipped: **81 employee rows across 3 organisations, 0 with a user_id**, and
not one employee email matching any row in `users` — so there was no
backfill-by-email available either. Every self-service path in the product
dead-ends on that NULL: `pahchan.create_punch` refuses with 409, `vetana`
compares `e.user_id` against the caller to decide whether a payslip is theirs,
and `manav._own_employee_id` scopes every own-record read here.

── Why the rules are tested as functions and not only over HTTP ──────────────

The pool is a `MagicMock` in this suite. `routers/messaging.py:30-41` records
what that is worth: every read endpoint in that router once answered 500 against
a real database with the whole suite green, because a mocked cursor resolves any
table name it is handed and returns whatever the test set. An HTTP test here can
prove the handler asks and honours the answer; it CANNOT prove the rule, because
the same mock answers the employee lookup, the member lookup and the holder
lookup. So `link_refusal`, `link_candidates` and `linked_filter_sql` are pure and
are exercised directly, and the HTTP tests below drive `side_effect` sequences so
the three lookups can differ.
"""

import pytest

from routers.manav import link_candidates, link_refusal, linked_filter_sql

EMP_ID = "e0000000-0000-0000-0000-000000000001"
OTHER_EMP_ID = "e0000000-0000-0000-0000-000000000002"


def _emp(**over):
    row = {"id": EMP_ID, "name": "Priya Sharma", "user_id": None, "is_active": True}
    row.update(over)
    return row


def _member(**over):
    row = {"user_id": "user_priya01", "email": "priya@example.com", "full_name": "Priya Sharma"}
    row.update(over)
    return row


# ── linked_filter_sql — the directory's link filter ──────────────────────────

def test_linked_filter_accepts_the_three_states():
    assert linked_filter_sql(None) == ""
    assert linked_filter_sql("") == ""
    assert "user_id IS NOT NULL" in linked_filter_sql("yes")
    assert "user_id IS NULL" in linked_filter_sql("no")


def test_linked_filter_is_case_and_space_insensitive():
    assert "user_id IS NULL" in linked_filter_sql("  NO ")
    assert "user_id IS NOT NULL" in linked_filter_sql("Yes")


def test_linked_filter_refuses_anything_else():
    """None means REFUSE, and `""` means no filter — the caller tells them apart
    with `is None`. A value this does not understand must NOT fall through to the
    unfiltered directory: that renders a screen claiming every employee has a
    login, which is the false statement the whole feature exists to end."""
    for bad in ("false", "true", "1", "linked", "no'; DROP TABLE", "unlinked"):
        assert linked_filter_sql(bad) is None, bad


def test_linked_filter_never_returns_caller_text():
    """The fragment is concatenated into SQL, so it must come from the table and
    never from the request. Nothing a caller sends can appear in the output."""
    assert linked_filter_sql("no") == "AND user_id IS NULL "
    assert linked_filter_sql("yes") == "AND user_id IS NOT NULL "


# ── link_refusal — every way a link must not be made ─────────────────────────

def test_link_allowed_when_both_sides_are_free():
    assert link_refusal(_emp(), _member(), None) is None


def test_link_refused_when_the_employee_does_not_exist():
    code, msg = link_refusal(None, _member(), None)
    assert code == 404
    assert "not found" in msg.lower()


def test_link_refused_on_an_inactive_record():
    """`_own_employee_id` and `pahchan._employee_for` both require is_active, so
    a link to a terminated record would look like it worked and change nothing."""
    code, msg = link_refusal(_emp(is_active=False), _member(), None)
    assert code == 409
    assert "Reinstate" in msg


def test_inactive_is_checked_before_the_account():
    """True regardless of which account was named, so it is answered first."""
    code, msg = link_refusal(_emp(is_active=False), None, None)
    assert code == 409
    assert "Reinstate" in msg


def test_link_refused_when_the_account_is_not_in_this_org():
    code, msg = link_refusal(_emp(), None, None)
    assert code == 404
    # The remedy has to be in the sentence: the account may not exist at all, and
    # the fix for that is the invitation flow that already exists.
    assert "Invite" in msg
    assert "Members" in msg


def test_relinking_the_same_account_is_a_no_op_not_an_error():
    """Two HR admins doing the same obvious thing must not produce a failure."""
    assert link_refusal(_emp(user_id="user_priya01"), _member(), None) is None


def test_link_refused_when_the_employee_already_holds_another_login():
    code, msg = link_refusal(_emp(user_id="user_someoneelse"), _member(), None)
    assert code == 409
    assert "Unlink" in msg


def test_link_refused_when_the_account_is_held_by_another_employee():
    """One login, one employee record. Two rows pointing at one account make
    `_own_employee_id` return whichever the planner reached first, so the same
    person's payslip changes between requests with nothing looking wrong."""
    code, msg = link_refusal(
        _emp(), _member(), {"id": OTHER_EMP_ID, "name": "Rahul Verma"},
    )
    assert code == 409
    assert "Rahul Verma" in msg


def test_the_employees_own_state_is_reported_before_the_accounts():
    """When both sides are already spoken for, the actionable half is the record
    the admin has open — not the account they happened to pick."""
    code, msg = link_refusal(
        _emp(user_id="user_someoneelse"),
        _member(),
        {"id": OTHER_EMP_ID, "name": "Rahul Verma"},
    )
    assert code == 409
    assert "Unlink" in msg
    assert "Rahul Verma" not in msg


def test_refusal_messages_name_the_employee():
    _, msg = link_refusal(_emp(user_id="user_x"), _member(), None)
    assert "Priya Sharma" in msg


def test_refusal_survives_a_nameless_row():
    _, msg = link_refusal(_emp(name=None, user_id="user_x"), _member(), None)
    assert "This employee" in msg


# ── link_candidates — who can be picked, and who already holds an account ────

def test_candidates_mark_the_account_that_is_already_taken():
    out = link_candidates(
        [_member(), _member(user_id="user_rahul01", email="rahul@example.com", full_name="Rahul Verma")],
        [{"id": OTHER_EMP_ID, "name": "Rahul Verma", "user_id": "user_rahul01"}],
    )
    taken = [c for c in out if c["user_id"] == "user_rahul01"][0]
    assert taken["linked_employee_id"] == OTHER_EMP_ID
    assert taken["linked_employee_name"] == "Rahul Verma"
    free = [c for c in out if c["user_id"] == "user_priya01"][0]
    assert free["linked_employee_id"] is None
    assert free["linked_employee_name"] is None


def test_taken_accounts_are_returned_not_filtered_out():
    """An HR admin who cannot find a colleague has no way to tell "no account"
    from "already on somebody else's record", and those have opposite remedies."""
    out = link_candidates(
        [_member()],
        [{"id": OTHER_EMP_ID, "name": "Rahul Verma", "user_id": "user_priya01"}],
    )
    assert len(out) == 1
    assert out[0]["linked_employee_name"] == "Rahul Verma"


def test_free_accounts_sort_first_then_by_name():
    out = link_candidates(
        [
            _member(user_id="u_taken", email="t@x.com", full_name="Aaron Taken"),
            _member(user_id="u_zoe", email="z@x.com", full_name="Zoe Free"),
            _member(user_id="u_amy", email="a@x.com", full_name="Amy Free"),
        ],
        [{"id": OTHER_EMP_ID, "name": "Someone", "user_id": "u_taken"}],
    )
    assert [c["user_id"] for c in out] == ["u_amy", "u_zoe", "u_taken"]


def test_candidates_never_carry_a_password_column():
    """`users` holds `password_hash` and `salt`. The shape is built key by key so
    a widened SELECT upstream cannot widen the response with it."""
    out = link_candidates(
        [{**_member(), "password_hash": "pbkdf2$leak", "salt": "s3cr3t"}], [],
    )
    assert set(out[0]) == {
        "user_id", "email", "full_name", "linked_employee_id", "linked_employee_name",
    }


def test_candidate_nulls_become_empty_strings():
    out = link_candidates([{"user_id": "u1", "email": None, "full_name": None}], [])
    assert out[0]["email"] == ""
    assert out[0]["full_name"] == ""


def test_a_link_row_with_no_user_id_is_ignored():
    """Every employee row in the database today is in exactly this state."""
    out = link_candidates(
        [_member()], [{"id": OTHER_EMP_ID, "name": "Unlinked", "user_id": None}],
    )
    assert out[0]["linked_employee_id"] is None


# ══════════════════════════════════════════════════════════════════════════════
# Over HTTP — that the handler asks the right questions and honours the answer
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def hr_admin(app):
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set. Linking is admin-gated, so that is the default here; the
    refusal test below lowers it."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def levels(app):
    from routers.manav import _gate

    def _set(*held):
        app.dependency_overrides[_gate] = lambda: frozenset(held)

    return _set


def _queries(mock):
    """Every SQL string a mock was called with, comments already gone — asserting
    on source that still carries its own commentary is how this repo shipped four
    checks that asserted against their own explanation. There are no comments in
    these strings, and this helper is where that stays true."""
    return [c.args[0] for c in mock.await_args_list if c.args]


async def test_directory_returns_the_link_column(api_client, mock_pool, as_admin, with_org_id):
    """Without `user_id` in the response an unlinked employee renders identically
    to a linked one, which is why nobody noticed that none of them were."""
    mock_pool.fetch.return_value = [{
        "id": EMP_ID, "name": "Priya Sharma", "employee_code": "EMP001",
        "user_id": None, "status": "active", "_total": 1,
    }]
    resp = await api_client.get("/api/v1/manav/employees")
    assert resp.status_code == 200
    assert "user_id" in resp.json()["data"][0]
    assert "user_id" in _queries(mock_pool.fetch)[0]


async def test_directory_filters_to_the_unlinked(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/manav/employees?linked=no")
    assert resp.status_code == 200
    assert "user_id IS NULL" in _queries(mock_pool.fetch)[0]


async def test_directory_filters_to_the_linked(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/manav/employees?linked=yes")
    assert resp.status_code == 200
    assert "user_id IS NOT NULL" in _queries(mock_pool.fetch)[0]


async def test_directory_refuses_an_unknown_link_filter(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.get("/api/v1/manav/employees?linked=false")
    assert resp.status_code == 400
    # And it must not have run the query anyway.
    assert mock_pool.fetch.await_count == 0


async def test_link_candidates_is_not_swallowed_by_the_uuid_route(
    api_client, mock_pool, as_admin, with_org_id,
):
    """FastAPI matches in declaration order. Declared after
    `/employees/{employee_id}` this literal path is captured by the UUID
    parameter and answered 422 — a routing bug that reads as a client bug."""
    mock_pool.fetch.return_value = []
    resp = await api_client.get("/api/v1/manav/employees/link-candidates")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


async def test_link_candidates_asks_for_org_members_and_existing_links(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [
        [_member()],
        [{"id": OTHER_EMP_ID, "name": "Rahul Verma", "user_id": "user_rahul01"}],
    ]
    resp = await api_client.get("/api/v1/manav/employees/link-candidates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["unlinked_accounts"] == 1
    asked = _queries(mock_pool.fetch)
    assert "public.user_roles" in asked[0]
    assert "manav_employees" in asked[1] and "user_id IS NOT NULL" in asked[1]


async def test_link_candidates_needs_admin(api_client, mock_pool, as_admin, with_org_id, levels):
    """It lists the email address of every member of the organisation."""
    levels()  # holds nothing
    resp = await api_client.get("/api/v1/manav/employees/link-candidates")
    assert resp.status_code == 403


async def test_link_needs_an_identifier(api_client, mock_pool, as_admin, with_org_id):
    resp = await api_client.post(f"/api/v1/manav/employees/{EMP_ID}/link", json={})
    assert resp.status_code == 400
    assert mock_pool.execute.await_count == 0


async def test_link_writes_the_user_id_it_was_given(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.side_effect = [_emp(), _member(), None]
    resp = await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"user_id": "user_priya01"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "linked"
    assert resp.json()["user_id"] == "user_priya01"

    writes = [c for c in mock_pool.execute.await_args_list
              if c.args and "manav_employees" in c.args[0]]
    assert len(writes) == 1
    assert "SET user_id=$1" in writes[0].args[0]
    assert writes[0].args[1] == "user_priya01"


async def test_link_by_email_resolves_through_the_member_list(
    api_client, mock_pool, as_admin, with_org_id,
):
    """An HR admin knows the address, not the opaque `user_549c9cac35aa`. The
    lookup still goes through org membership — an address that belongs to nobody
    in this org must not resolve."""
    mock_pool.fetchrow.side_effect = [_emp(), _member(), None]
    resp = await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"email": "PRIYA@example.com"},
    )
    assert resp.status_code == 200
    member_query = _queries(mock_pool.fetchrow)[1]
    assert "public.user_roles" in member_query
    assert "LOWER(u.email)=LOWER($3)" in member_query


async def test_link_refuses_an_account_outside_the_org(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.side_effect = [_emp(), None, None]
    resp = await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"email": "stranger@elsewhere.com"},
    )
    assert resp.status_code == 404
    assert "Invite" in resp.json()["detail"]
    assert mock_pool.execute.await_count == 0


async def test_link_refuses_an_account_another_employee_holds(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchrow.side_effect = [
        _emp(), _member(), {"id": OTHER_EMP_ID, "name": "Rahul Verma"},
    ]
    resp = await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"user_id": "user_priya01"},
    )
    assert resp.status_code == 409
    assert "Rahul Verma" in resp.json()["detail"]
    assert mock_pool.execute.await_count == 0


async def test_link_looks_for_a_holder_excluding_this_record(
    api_client, mock_pool, as_admin, with_org_id,
):
    """`id <> $3` — without it, re-linking a record to the account it already
    holds finds itself and refuses on its own name."""
    mock_pool.fetchrow.side_effect = [_emp(), _member(), None]
    await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"user_id": "user_priya01"},
    )
    holder_query = _queries(mock_pool.fetchrow)[2]
    assert "id <> $3::uuid" in holder_query


async def test_link_needs_admin(api_client, mock_pool, as_admin, with_org_id, levels):
    """It decides whose payslip a person can open."""
    levels("editor")
    resp = await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"user_id": "user_priya01"},
    )
    assert resp.status_code == 403
    assert mock_pool.execute.await_count == 0


async def test_the_ordinary_patch_cannot_move_the_link(api_client, mock_pool, as_admin, with_org_id):
    """`EmployeeUpdate` has no `user_id` field, deliberately. A field there would
    put an authority change — whose payslip a person can open — inside the same
    request that edits a designation, with no holder check and no audit row."""
    resp = await api_client.patch(
        f"/api/v1/manav/employees/{EMP_ID}",
        json={"designation": "Senior Developer", "user_id": "user_someoneelse"},
    )
    assert resp.status_code == 200
    writes = [c.args[0] for c in mock_pool.execute.await_args_list
              if c.args and "UPDATE public.manav_employees" in c.args[0]]
    assert writes, "the patch wrote nothing at all"
    assert all("user_id=" not in w for w in writes)


async def test_unlink_clears_the_column(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = _emp(user_id="user_priya01")
    resp = await api_client.delete(f"/api/v1/manav/employees/{EMP_ID}/link")
    assert resp.status_code == 200
    assert resp.json()["status"] == "unlinked"
    writes = [c for c in mock_pool.execute.await_args_list
              if c.args and "manav_employees" in c.args[0]]
    assert "SET user_id=NULL" in writes[0].args[0]


async def test_unlink_on_an_already_unlinked_record_is_not_an_error(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchrow.return_value = _emp()
    resp = await api_client.delete(f"/api/v1/manav/employees/{EMP_ID}/link")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_linked"
    assert mock_pool.execute.await_count == 0


async def test_unlink_404s_on_a_record_from_another_org(api_client, mock_pool, as_admin, with_org_id):
    mock_pool.fetchrow.return_value = None
    resp = await api_client.delete(f"/api/v1/manav/employees/{EMP_ID}/link")
    assert resp.status_code == 404
    assert mock_pool.execute.await_count == 0


async def test_detail_names_the_linked_account(api_client, mock_pool, as_admin, with_org_id):
    """`user_549c9cac35aa` is not an answer to "who is this linked to"."""
    mock_pool.fetchrow.side_effect = [
        {"id": EMP_ID, "name": "Priya Sharma", "user_id": "user_priya01",
         "is_active": True, "aadhaar": None, "pan": None, "bank_details": {}},
        {"user_id": "user_priya01", "email": "priya@example.com", "full_name": "Priya Sharma"},
    ]
    mock_pool.fetch.return_value = []
    resp = await api_client.get(f"/api/v1/manav/employees/{EMP_ID}")
    assert resp.status_code == 200
    assert resp.json()["login"]["email"] == "priya@example.com"
    assert resp.json()["login"]["missing"] is False


async def test_detail_reports_a_link_to_a_deleted_account_as_broken(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetchrow.side_effect = [
        {"id": EMP_ID, "name": "Priya Sharma", "user_id": "user_gone",
         "is_active": True, "aadhaar": None, "pan": None, "bank_details": {}},
        None,
    ]
    mock_pool.fetch.return_value = []
    resp = await api_client.get(f"/api/v1/manav/employees/{EMP_ID}")
    assert resp.status_code == 200
    assert resp.json()["login"]["missing"] is True


async def test_detail_of_an_unlinked_record_costs_no_extra_query(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Currently every record in the database. The lookup must not run at all."""
    mock_pool.fetchrow.return_value = {
        "id": EMP_ID, "name": "Priya Sharma", "user_id": None,
        "is_active": True, "aadhaar": None, "pan": None, "bank_details": {},
    }
    mock_pool.fetch.return_value = []
    resp = await api_client.get(f"/api/v1/manav/employees/{EMP_ID}")
    assert resp.status_code == 200
    assert resp.json()["login"] is None
    assert not [q for q in _queries(mock_pool.fetchrow) if q.startswith("SELECT user_id, email")]
