"""
The employee ↔ account link, from the review screen's side.

── The measurement this exists for ──────────────────────────────────────────

Read-only against the shared staging/production database on 2026-08-21:

    staging.manav_employees   98 rows,  0 with a user_id
    public.users              32 rows
    employee email = user email                     0 matches

No edge, and none that can be inferred.

── The commission side, as the catalogue actually has it ────────────────────

Measured in the same probe, because the brief this was built from named tables
that do not exist. There is no `manav_commission_schemes`, and neither
`vikray_orders` nor `ganit_invoices` has a `salesperson_id`. What is really
there:

    staging.sales_commission_slabs         0 rows
    staging.sales_commission_assignments   0 rows   user_id  uuid
    staging.sales_commissions              0 rows   user_id  uuid
    staging.vikray_targets                34 rows   salesperson_id  text
    staging.vikray_orders                          created_by only, no salesperson
    staging.ganit_invoices                         created_by only, no salesperson

Which does not weaken the case, it relocates it. The whole commission and
revenue side is keyed on an ACCOUNT (`user_id` / `salesperson_id`); every
personnel-side table in the product — `vetana_payslips`, `manav_attendance`,
`manav_leave_requests`, twenty more — is keyed on an EMPLOYEE (`employee_id`).
`manav_employees.user_id` is the ONLY column joining those two halves and it is
NULL on all 98 rows, so nothing an account earns can reach the personnel file it
belongs to: not onto a payslip, not onto an HR record, not into a report by
person. Every such figure is unattributable until a human makes the link.

(Two neighbouring defects the probe turned up, neither of them this file's to
fix: `sales_commissions.user_id` and `sales_commission_assignments.user_id` are
UUID while `public.users.user_id` and `vikray_targets.salesperson_id` are TEXT —
those columns cannot hold a user id of the shape this product mints; and all
three commission tables are empty, so nothing has ever been calculated.)

── Why nothing here matches ─────────────────────────────────────────────────

A wrong link pays the wrong person. Neither available signal is safe: six
accounts in this database already share two display labels between them, so a
name match on those is a coin toss, and the email columns have zero overlap so
there is nothing to match on at all. A human says "this employee is that
account", one at a time, and owns it.

That promise is testable rather than asserted, and it is tested below in the
strongest form available: `account_options` HAS NO PARAMETER FOR THE EMPLOYEE.
A function that cannot see the name being linked cannot order by resemblance to
it.

── Why the rules are proven as functions and not only over HTTP ─────────────

The pool is a `MagicMock` in this suite. `routers/messaging.py:30-41` records
what that is worth: every read endpoint in that router once answered 500
against a real database with the whole suite green, because a mocked cursor
resolves any table name it is handed. So the shaping rules are pure functions
exercised directly, and the HTTP tests prove only that the handler asks the
right questions, in the right order, scoped to the right org, and honours the
answers.

Companion file: `test_manav_employee_login_link.py` covers `link_refusal`,
`link_candidates` and the write path itself. This one covers the review screen
that makes those usable at 98 records rather than one at a time, and re-proves
the two refusals that decide whether a commission figure lands on the right
person.
"""

import inspect
from datetime import date, datetime, timezone

import pytest

from routers.manav import (
    account_options,
    link_worklist,
    shared_labels,
)

EMP_ID = "e0000000-0000-0000-0000-000000000001"
OTHER_EMP_ID = "e0000000-0000-0000-0000-000000000002"


def _emp(**over):
    row = {
        "id": EMP_ID,
        "employee_code": "EMP014",
        "name": "Amit Shah",
        "email": "amit.shah@firm.example",
        "department": "Audit",
        "designation": "Senior Associate",
        "date_of_joining": date(2024, 2, 3),
        "status": "active",
    }
    row.update(over)
    return row


def _account(**over):
    row = {
        "user_id": "user_amit01",
        "email": "amit@firm.example",
        "full_name": "Amit Shah",
        "mobile_number": "9876543210",
        "member_since": datetime(2024, 1, 12, 9, 30, tzinfo=timezone.utc),
        "role_codes": ["org_member"],
    }
    row.update(over)
    return row


# ══════════════════════════════════════════════════════════════════════════════
# shared_labels — the ambiguity the screen has to say out loud
# ══════════════════════════════════════════════════════════════════════════════

def test_a_label_two_rows_carry_is_shared():
    out = shared_labels([{"name": "Amit Shah"}, {"name": "Amit Shah"}, {"name": "Priya"}])
    assert out == {"amit shah"}


def test_sharing_is_judged_on_the_label_not_on_the_row():
    """Two rows are the same person to a reader when the TEXT is the same. Case
    and surrounding space are not a distinction anybody can see on a screen."""
    assert shared_labels([{"name": "  amit shah"}, {"name": "Amit SHAH"}]) == {"amit shah"}


def test_a_blank_label_is_shared_with_nothing():
    """Rows with no name fall back to the address, which is unique by
    construction. Calling three blanks "ambiguous" would put a warning on three
    rows that a human can already tell apart perfectly."""
    assert shared_labels([{"name": ""}, {"name": None}, {}]) == set()


def test_shared_labels_reads_the_key_it_is_given():
    rows = [{"full_name": "Zoe"}, {"full_name": "Zoe"}]
    assert shared_labels(rows, "full_name") == {"zoe"}
    assert shared_labels(rows, "name") == set()


# ══════════════════════════════════════════════════════════════════════════════
# link_worklist — the personnel records still waiting
# ══════════════════════════════════════════════════════════════════════════════

def test_worklist_carries_what_identifies_a_record():
    out = link_worklist([_emp()])
    assert out[0]["employee_code"] == "EMP014"
    assert out[0]["department"] == "Audit"
    assert out[0]["designation"] == "Senior Associate"
    assert out[0]["date_of_joining"] == "2024-02-03"


def test_worklist_never_carries_the_identity_kit():
    """`manav_employees` holds `aadhaar`, `pan` and `bank_details`. The response
    is built key by key precisely so a widened SELECT upstream cannot carry them
    out — the same rule `_EMP_SAFE_COLS` states for the detail endpoint."""
    out = link_worklist([{**_emp(), "aadhaar": "1234", "pan": "ABCDE1234F",
                          "bank_details": {"account_number": "0001"}}])
    assert set(out[0]) == {
        "id", "employee_code", "name", "email", "department", "designation",
        "date_of_joining", "status", "name_is_shared",
    }


def test_worklist_flags_both_rows_that_share_a_name():
    """Not one of them. Whichever a human is looking at is the ambiguous one."""
    out = link_worklist([_emp(), _emp(id=OTHER_EMP_ID, employee_code="EMP077")])
    assert [r["name_is_shared"] for r in out] == [True, True]


def test_a_unique_name_is_not_flagged():
    out = link_worklist([_emp(), _emp(id=OTHER_EMP_ID, name="Priya Sharma")])
    assert {r["name"]: r["name_is_shared"] for r in out} == {
        "Amit Shah": False, "Priya Sharma": False,
    }


def test_worklist_ids_are_strings_and_are_keys_not_text():
    """The screen posts this back and never draws it — no user, member or org id
    is ever rendered (`frontend/scripts/check-rendered-ids.mjs`). It is a string
    because a UUID object does not survive JSON."""
    from uuid import UUID
    out = link_worklist([_emp(id=UUID(EMP_ID))])
    assert out[0]["id"] == EMP_ID
    assert isinstance(out[0]["id"], str)


def test_worklist_sorts_by_name_then_code():
    out = link_worklist([
        _emp(name="Zoe", employee_code="EMP003"),
        _emp(name="Amit Shah", employee_code="EMP009"),
        _emp(name="Amit Shah", employee_code="EMP002"),
    ])
    assert [(r["name"], r["employee_code"]) for r in out] == [
        ("Amit Shah", "EMP002"), ("Amit Shah", "EMP009"), ("Zoe", "EMP003"),
    ]


def test_worklist_nulls_become_empty_strings():
    """A record with no department must render an em dash, not "None"."""
    out = link_worklist([{"id": EMP_ID, "name": "Solo"}])
    assert out[0]["department"] == ""
    assert out[0]["designation"] == ""
    assert out[0]["date_of_joining"] == ""
    assert out[0]["employee_code"] == ""


def test_worklist_accepts_a_date_a_datetime_or_a_string():
    for given, expected in [
        (date(2024, 2, 3), "2024-02-03"),
        (datetime(2024, 2, 3, 6, 0), "2024-02-03"),
        ("2024-02-03", "2024-02-03"),
        ("2024-02-03T00:00:00+00:00", "2024-02-03"),
        (None, ""),
    ]:
        assert link_worklist([_emp(date_of_joining=given)])[0]["date_of_joining"] == expected


# ══════════════════════════════════════════════════════════════════════════════
# account_options — telling two same-named people apart, with no id
# ══════════════════════════════════════════════════════════════════════════════

def test_it_is_never_told_which_employee_is_being_linked():
    """THE ANTI-MATCHING GUARANTEE, and the reason it is a signature test rather
    than a comment: a function with no access to the employee's name cannot rank
    accounts by resemblance to it, cannot preselect one, and cannot grow a
    "probably this one" flag without this test failing first.

    Six accounts in this database already share two display labels. A ranked
    list would be read as an answer, and on those six it would be a coin toss
    that pays the wrong person their colleague's commission."""
    params = list(inspect.signature(account_options).parameters)
    assert params == ["accounts", "links", "module_grants"]
    for forbidden in ("employee", "employee_id", "name", "query", "search", "suggest"):
        assert forbidden not in params


def test_two_accounts_with_one_name_are_separated_by_four_facts():
    """The case this whole screen exists for. Neither row may be marked as the
    likely one; both must carry enough for a human to decide."""
    out = account_options([
        _account(user_id="u_a", email="amit@firm.example",
                 member_since=datetime(2024, 1, 12, tzinfo=timezone.utc),
                 mobile_number="9876543210", role_codes=["org_admin"]),
        _account(user_id="u_b", email="amit.s@firm.example",
                 member_since=datetime(2025, 7, 1, tzinfo=timezone.utc),
                 mobile_number="9000011111", role_codes=["org_member"]),
    ], [], [{"user_id": "u_a", "module_code": "ganit"}])
    # Picked by key, never by position: the order is the screen's business and
    # this test is about what a human can tell apart, not about who sorts first.
    by_account = {r["user_id"]: r for r in out}
    a, b = by_account["u_a"], by_account["u_b"]
    assert a["name_is_shared"] and b["name_is_shared"]
    assert a["email"] != b["email"]
    assert a["org_roles"] != b["org_roles"]
    assert a["member_since"] != b["member_since"]
    assert a["mobile_tail"] != b["mobile_tail"]
    assert a["modules"] == ["ganit"] and b["modules"] == []
    # And nothing anywhere says which one it is.
    assert not any("suggest" in k or "score" in k or "match" in k for k in a)


def test_the_mobile_number_is_four_digits_not_a_number():
    """HR already holds the full number on the personnel file. Four digits
    separates two identical names; the rest would make a linking screen into a
    contact export."""
    out = account_options([_account(mobile_number="9876543210")], [])
    assert out[0]["mobile_tail"].endswith("3210")
    assert "9876543210" not in out[0]["mobile_tail"]
    assert "mobile_number" not in out[0]


def test_the_response_never_carries_a_password_column():
    """`users` holds `password_hash` and `salt`. Built key by key so a widened
    SELECT upstream cannot widen the response with them."""
    out = account_options(
        [{**_account(), "password_hash": "pbkdf2$leak", "salt": "s3cr3t"}], [],
    )
    assert set(out[0]) == {
        "user_id", "full_name", "email", "org_roles", "member_since",
        "mobile_tail", "modules", "linked_employee_id", "linked_employee_name",
        "name_is_shared",
    }


def test_member_since_is_the_day_they_joined_this_org():
    out = account_options(
        [_account(member_since=datetime(2024, 1, 12, 9, 30, tzinfo=timezone.utc))], [],
    )
    assert out[0]["member_since"] == "2024-01-12"


def test_roles_and_modules_are_sorted_so_two_rows_compare():
    """Unsorted, the same account renders in a different order between two reads
    and two accounts cannot be read side by side."""
    out = account_options(
        [_account(role_codes=["org_member", "org_admin"])], [],
        [{"user_id": "user_amit01", "module_code": "manav"},
         {"user_id": "user_amit01", "module_code": "ganit"},
         {"user_id": "user_amit01", "module_code": "ganit"}],
    )
    assert out[0]["org_roles"] == ["org_admin", "org_member"]
    assert out[0]["modules"] == ["ganit", "manav"]


def test_a_grant_for_somebody_else_does_not_land_on_this_account():
    out = account_options(
        [_account(user_id="u_a"), _account(user_id="u_b", email="b@x.example")],
        [],
        [{"user_id": "u_b", "module_code": "vetana"}],
    )
    assert {r["user_id"]: r["modules"] for r in out} == {"u_a": [], "u_b": ["vetana"]}


def test_a_taken_account_is_returned_carrying_who_holds_it():
    """Filtering it out leaves an HR admin unable to tell "they have no account"
    from "their account is on somebody else's record", and those have opposite
    remedies: invite them, versus unlink the record that is wrong."""
    out = account_options(
        [_account(user_id="u_taken")],
        [{"id": OTHER_EMP_ID, "name": "Priya Sharma", "user_id": "u_taken"}],
    )
    assert len(out) == 1
    assert out[0]["linked_employee_name"] == "Priya Sharma"
    assert out[0]["linked_employee_id"] == OTHER_EMP_ID


def test_free_accounts_sort_first_then_by_name_then_by_address():
    """Choosing a free one is what the list is for. The address breaks the tie so
    two same-named accounts hold a stable, readable order rather than swapping
    between reads."""
    out = account_options([
        _account(user_id="u_taken", full_name="Aaron Taken", email="aaron@x.example"),
        _account(user_id="u_z", full_name="Zoe", email="zoe@x.example"),
        _account(user_id="u_amit_b", full_name="Amit Shah", email="b@x.example"),
        _account(user_id="u_amit_a", full_name="Amit Shah", email="a@x.example"),
    ], [{"id": OTHER_EMP_ID, "name": "Held", "user_id": "u_taken"}])
    assert [r["user_id"] for r in out] == ["u_amit_a", "u_amit_b", "u_z", "u_taken"]


def test_same_named_accounts_stay_adjacent():
    """So they are read together. Two rows a page apart are two rows nobody
    compares."""
    out = account_options([
        _account(user_id="u1", full_name="Amit Shah", email="a@x.example"),
        _account(user_id="u2", full_name="Bela Rao", email="b@x.example"),
        _account(user_id="u3", full_name="Amit Shah", email="c@x.example"),
    ], [])
    names = [r["full_name"] for r in out]
    assert names == ["Amit Shah", "Amit Shah", "Bela Rao"]


def test_a_nameless_account_falls_back_to_its_address_and_is_not_ambiguous():
    out = account_options([
        _account(user_id="u1", full_name=None, email="one@x.example"),
        _account(user_id="u2", full_name=None, email="two@x.example"),
    ], [])
    assert [r["full_name"] for r in out] == ["", ""]
    assert not any(r["name_is_shared"] for r in out)
    assert [r["email"] for r in out] == ["one@x.example", "two@x.example"]


def test_a_link_row_with_no_user_id_is_ignored():
    """The state of all 98 employee rows measured today."""
    out = account_options(
        [_account()], [{"id": OTHER_EMP_ID, "name": "Unlinked", "user_id": None}],
    )
    assert out[0]["linked_employee_id"] is None


def test_missing_role_and_module_data_is_empty_not_absent():
    out = account_options([{"user_id": "u1"}], [], None)
    assert out[0]["org_roles"] == []
    assert out[0]["modules"] == []
    assert out[0]["member_since"] == ""
    assert out[0]["mobile_tail"] == ""


# ══════════════════════════════════════════════════════════════════════════════
# Over HTTP — the right questions, scoped to the right org
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def hr_admin(app):
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set. This screen is admin-gated; the refusal tests lower it."""
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
    return [c.args[0] for c in mock.await_args_list if c.args]


def _params(mock):
    return [c.args[1:] for c in mock.await_args_list if c.args]


# ── /employees/awaiting-link ──────────────────────────────────────────────────

async def test_awaiting_link_is_not_swallowed_by_the_uuid_route(
    api_client, mock_pool, as_admin, with_org_id,
):
    """FastAPI matches in declaration order. Below `/employees/{employee_id}`
    this literal path is captured by the UUID parameter and answered 422 — a
    routing bug that reads in the browser as a malformed request."""
    mock_pool.fetch.side_effect = [[], []]
    resp = await api_client.get("/api/v1/manav/employees/awaiting-link")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


async def test_awaiting_link_asks_only_for_records_with_no_login(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [[], []]
    await api_client.get("/api/v1/manav/employees/awaiting-link")
    asked = _queries(mock_pool.fetch)
    assert "user_id IS NULL" in asked[0]
    assert "user_id IS NOT NULL" in asked[1]


async def test_both_halves_are_scoped_to_the_caller_org(
    api_client, mock_pool, as_admin, with_org_id,
):
    """One org must never see another's people. Both queries carry org_id and
    nothing else identifies the tenant."""
    mock_pool.fetch.side_effect = [[], []]
    await api_client.get("/api/v1/manav/employees/awaiting-link")
    for sql in _queries(mock_pool.fetch):
        assert "org_id=$1::uuid" in sql
    for args in _params(mock_pool.fetch):
        assert args[0] == with_org_id


async def test_the_linked_half_left_joins_so_a_dead_account_still_shows(
    api_client, mock_pool, as_admin, with_org_id,
):
    """An INNER JOIN drops the record whose account was deleted, and the queue
    then claims that record is done — the same class of lie as an unlinked
    employee rendering identically to a linked one."""
    mock_pool.fetch.side_effect = [[], []]
    await api_client.get("/api/v1/manav/employees/awaiting-link")
    assert "LEFT JOIN users" in _queries(mock_pool.fetch)[1]


async def test_a_link_to_a_deleted_account_reports_as_broken_not_linked(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [
        [],
        [{"id": EMP_ID, "employee_code": "EMP001", "name": "Priya Sharma",
          "department": "Audit", "designation": "Associate",
          "account_email": None, "account_name": None}],
    ]
    resp = await api_client.get("/api/v1/manav/employees/awaiting-link")
    assert resp.json()["linked"][0]["account_missing"] is True


async def test_a_live_link_names_the_account_and_is_not_broken(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [
        [],
        [{"id": EMP_ID, "employee_code": "EMP001", "name": "Priya Sharma",
          "department": "Audit", "designation": "Associate",
          "account_email": "priya@firm.example", "account_name": "Priya Sharma"}],
    ]
    row = (await api_client.get("/api/v1/manav/employees/awaiting-link")).json()["linked"][0]
    assert row["account_email"] == "priya@firm.example"
    assert row["account_missing"] is False


async def test_the_counts_are_one_number_from_one_read(
    api_client, mock_pool, as_admin, with_org_id,
):
    """"12 of 98 done" is the only honest way to render a queue, and a second
    request for the denominator is a second chance for the halves to disagree."""
    mock_pool.fetch.side_effect = [
        [_emp(), _emp(id=OTHER_EMP_ID, name="Bela")],
        [{"id": "e3", "name": "Priya", "employee_code": "E3",
          "department": "", "designation": "",
          "account_email": "p@x.example", "account_name": "Priya"}],
    ]
    body = (await api_client.get("/api/v1/manav/employees/awaiting-link")).json()
    assert body["counts"] == {"employees": 3, "awaiting_link": 2, "linked": 1}
    assert body["total"] == 2


async def test_awaiting_link_needs_admin(api_client, mock_pool, as_admin, with_org_id, levels):
    """It lists every colleague's personnel row, and it feeds a write that
    decides whose payslip and whose commission a person can reach."""
    levels()  # holds nothing — self scope
    resp = await api_client.get("/api/v1/manav/employees/awaiting-link")
    assert resp.status_code == 403
    assert mock_pool.fetch.await_count == 0


# ── /employees/link-options ───────────────────────────────────────────────────

async def test_link_options_is_not_swallowed_by_the_uuid_route(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [[], [], []]
    resp = await api_client.get("/api/v1/manav/employees/link-options")
    assert resp.status_code == 200
    assert resp.json()["data"] == []


async def test_link_options_asks_for_members_links_and_module_grants(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [[_account()], [], []]
    resp = await api_client.get("/api/v1/manav/employees/link-options")
    assert resp.status_code == 200
    asked = _queries(mock_pool.fetch)
    assert "public.user_roles" in asked[0]
    assert "manav_employees" in asked[1] and "user_id IS NOT NULL" in asked[1]
    assert "public.org_member_modules" in asked[2]


async def test_one_account_holding_two_roles_is_one_row(
    api_client, mock_pool, as_admin, with_org_id,
):
    """`_ORG_MEMBER_SQL` is a plain SELECT DISTINCT; widening it with role_code
    would render an org_admin who is also an org_member as TWO identical people
    to choose between, on the one screen whose job is to stop somebody choosing
    the wrong person. This query groups instead."""
    mock_pool.fetch.side_effect = [[], [], []]
    await api_client.get("/api/v1/manav/employees/link-options")
    sql = _queries(mock_pool.fetch)[0]
    assert "GROUP BY" in sql
    assert "ARRAY_AGG(DISTINCT ur.role_code)" in sql
    assert "MIN(ur.granted_at)" in sql


async def test_every_link_options_query_is_scoped_to_the_caller_org(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [[], [], []]
    await api_client.get("/api/v1/manav/employees/link-options")
    for sql in _queries(mock_pool.fetch):
        assert "org_id=$1::uuid" in sql
    for args in _params(mock_pool.fetch):
        assert args[0] == with_org_id


async def test_link_options_selects_columns_never_a_star(
    api_client, mock_pool, as_admin, with_org_id,
):
    """`users` carries `password_hash` and `salt`; a `SELECT *` here starts
    leaking them the day somebody adds a column, with no code change to review."""
    mock_pool.fetch.side_effect = [[], [], []]
    await api_client.get("/api/v1/manav/employees/link-options")
    assert "SELECT *" not in _queries(mock_pool.fetch)[0]


async def test_link_options_counts_free_taken_and_shared_names(
    api_client, mock_pool, as_admin, with_org_id,
):
    mock_pool.fetch.side_effect = [
        [_account(user_id="u1", full_name="Amit Shah", email="a@x.example"),
         _account(user_id="u2", full_name="Amit Shah", email="b@x.example"),
         _account(user_id="u3", full_name="Zoe", email="z@x.example")],
        [{"id": OTHER_EMP_ID, "name": "Priya", "user_id": "u3"}],
        [],
    ]
    body = (await api_client.get("/api/v1/manav/employees/link-options")).json()
    assert body["total"] == 3
    assert body["free"] == 2
    assert body["taken"] == 1
    # One LABEL repeats, carried by two accounts. The screen warns once.
    assert body["shared_names"] == 1


async def test_link_options_takes_no_employee_and_returns_no_suggestion(
    api_client, mock_pool, as_admin, with_org_id,
):
    """A query string naming an employee must change nothing. There is no
    parameter to smuggle a match through, and the response carries no ranking."""
    mock_pool.fetch.side_effect = [[_account()], [], []]
    resp = await api_client.get(
        f"/api/v1/manav/employees/link-options?employee_id={EMP_ID}&name=Amit"
    )
    assert resp.status_code == 200
    row = resp.json()["data"][0]
    assert not any(k in row for k in ("score", "match", "suggested", "confidence"))
    for sql in _queries(mock_pool.fetch):
        assert "Amit" not in sql and EMP_ID not in sql


async def test_link_options_needs_admin(api_client, mock_pool, as_admin, with_org_id, levels):
    """It discloses the address, joining date and mobile tail of every member of
    the organisation."""
    levels()
    resp = await api_client.get("/api/v1/manav/employees/link-options")
    assert resp.status_code == 403
    assert mock_pool.fetch.await_count == 0


async def test_link_options_is_audited(api_client, mock_pool, as_admin, with_org_id, monkeypatch):
    """A small export of every colleague's contact details is worth a row saying
    who took it."""
    seen = []
    monkeypatch.setattr("routers.manav.audit", lambda *a, **k: seen.append((a, k)))
    mock_pool.fetch.side_effect = [[_account()], [], []]
    await api_client.get("/api/v1/manav/employees/link-options")
    assert seen and seen[0][0][0] == "manav.link_options_read"
    assert seen[0][1]["org_id"] == with_org_id


# ── The two refusals a commission figure depends on ───────────────────────────

async def test_the_link_refuses_an_account_another_employee_already_holds(
    api_client, mock_pool, as_admin, with_org_id,
):
    """One person is one employee record. Two personnel files pointing at one
    account make `_own_employee_id` and `pahchan._employee_for` return whichever
    row the planner reached first — so the same person's payslip, attendance and
    commission change between requests with nothing in the data looking wrong."""
    mock_pool.fetchrow.side_effect = [
        {"id": EMP_ID, "name": "Amit Shah", "user_id": None, "is_active": True},
        {"user_id": "u_amit", "email": "amit@x.example", "full_name": "Amit Shah"},
        {"id": OTHER_EMP_ID, "name": "Priya Sharma"},
    ]
    resp = await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"user_id": "u_amit"},
    )
    assert resp.status_code == 409
    assert "Priya Sharma" in resp.json()["detail"]
    assert mock_pool.execute.await_count == 0


async def test_the_holder_check_is_org_scoped_and_excludes_this_record(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Scoped, or an account held in ANOTHER organisation blocks a legitimate
    link here and leaks that the account exists there. Excluding this record, or
    re-confirming an existing link answers 409 on a no-op."""
    mock_pool.fetchrow.side_effect = [
        {"id": EMP_ID, "name": "Amit Shah", "user_id": None, "is_active": True},
        {"user_id": "u_amit", "email": "amit@x.example", "full_name": "Amit Shah"},
        None,
    ]
    await api_client.post(
        f"/api/v1/manav/employees/{EMP_ID}/link", json={"user_id": "u_amit"},
    )
    holder_sql = _queries(mock_pool.fetchrow)[2]
    assert "org_id=$1::uuid" in holder_sql
    assert "id <> $3::uuid" in holder_sql


async def test_the_link_is_reversible_and_says_so_in_its_answer(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The screen promises a human that a wrong choice is undoable. Unlink
    removes SELF-SERVICE, not the account: the person keeps their login, their
    membership and every module grant."""
    mock_pool.fetchrow.return_value = {
        "id": EMP_ID, "name": "Amit Shah", "user_id": "u_amit",
    }
    resp = await api_client.delete(f"/api/v1/manav/employees/{EMP_ID}/link")
    assert resp.status_code == 200
    assert resp.json()["status"] == "unlinked"
    sql = _queries(mock_pool.execute)[0]
    assert "user_id=NULL" in sql
    assert "org_id=$2::uuid" in sql
