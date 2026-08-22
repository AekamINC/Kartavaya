"""
The employee who needs a login gets invited when the record is made.

── WHY THIS EXISTS ──────────────────────────────────────────────────────────

`staging.manav_employees.user_id` is the only column joining a personnel file to
an account that can sign in. Measured read-only against the shared
staging/production database on 2026-08-21: **98 employee rows across 3
organisations, 0 carrying a user_id**, and 34 invitations of which none was
pending.

A screen that links the two by hand shipped the day before, and it surfaced the
real problem rather than solving it: the largest organisation has 71 employees
and 7 accounts, so most of those links are IMPOSSIBLE — there is no account on
the other end to point at.

The owner's correction inverts the fix:

    "Not all employee will be sales user or will need full login they will be
     only pachand [Pahchan] users. If users need to login for all this then when
     creating employee the forms need check box to check and it create login
     invite as well. so that it can link perfectly."

So: MOST employees never get an account, the ones who do are invited at the
moment the employee record is created, and the account links itself on
acceptance. Linking by hand becomes a repair tool.

── WHAT IS PINNED HERE, AND WHY EACH ONE ────────────────────────────────────

  1. UNTICKED CHANGES NOTHING. Not "changes little" — nothing. No invitation, no
     org seat counted, no mail. The overwhelming majority of the 98 employees
     are in this case and it must stay the cheapest path through the handler.

  2. EVERY REFUSAL HAPPENS BEFORE THE PERSONNEL FILE IS WRITTEN. That row
     carries an Aadhaar, a PAN and a bank account. Telling an admin the hire
     failed after committing one is worse than any refusal, and it is how the
     same person gets added twice.

  3. A MANAV GRANT IS NOT ORG AUTHORITY. `create_employee` needs `admin` on
     Manav, which is a MODULE grant. Inviting somebody into the organisation
     creates an account, seats it and hands it an org role. If a Manav admin
     could do that, "administer HR records" would silently become "add members
     to this company".

  4. ACCEPTANCE LINKS THE EMPLOYEE, AND CANNOT BE FAILED BY THE ATTEMPT. The
     person has just chosen a password and must end up signed in. A deleted
     employee record, an already-linked one, a row in another organisation, and
     `uq_manav_employee_login` (migration 101) refusing outright are all
     ordinary outcomes: log it, leave the employee unlinked for the repair
     screen, and return the session.

  5. MIGRATION 187 IS NOT APPLIED. `public.invites.employee_id` does not exist
     on the live database, so the checkbox refuses with a 503 that names the
     file — and, critically, an ORDINARY invitation still works, because naming
     a column that is not there would break every invitation this product sends.

Nothing here touches a database; the pool is conftest's MagicMock. That is
worth stating because it bounds what these tests prove: they prove the handler
asks the right questions and honours the answers, not that the SQL is valid.
The SQL shapes are argued in `migrations/187_invite_carries_the_employee.sql`
and were checked against the live catalogue read-only.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

import asyncpg

from conftest import TEST_ORG_ID

EMP_ID = "e0000000-0000-0000-0000-0000000000a1"
EMAIL = "newjoiner@test.com"
TOKEN = "invite-token-employee-link"


# ══════════════════════════════════════════════════════════════════════════════
# Part 1 · Creating the employee
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def bypass_module_gate(app):
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set. `admin` is what creating a personnel file needs; the org
    authority the checkbox needs is a SEPARATE question and is asked separately.
    """
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture
def hiring(mock_pool):
    """Answer every query `create_employee` issues, and record every write.

    `state` steers the answers a test cares about: whether migration 187 is
    applied, what org role the caller holds, and where the org's seat ceiling is.
    """
    state = {
        # THE LIVE VALUE IS FALSE. 187 is written and not applied, so the
        # default here is the state of the real database, and the tests that
        # want the feature to work say so out loud.
        "migration_187": True,
        "caller_org_role": "org_owner",
        "seat_limit": None,
        "seats_joined": 0,
        "seats_pending": 0,
        "email_has_account": None,
        "executed": [],          # every (query, args) that went through execute
        "employees_inserted": 0,
    }

    async def fetchval(query, *args):
        if "table_name='invites'" in query and "employee_id" in query:
            return 1 if state["migration_187"] else None
        if "role_code FROM staging.user_roles" in query:
            return state["caller_org_role"]
        if "COALESCE(o.max_users" in query:
            return state["seat_limit"]
        if "COUNT(DISTINCT user_id)" in query:
            return state["seats_joined"]
        if "COUNT(*) FROM public.invites" in query:
            return state["seats_pending"]
        if "SELECT name FROM staging.organisations" in query:
            return "Test Org"
        return None

    async def fetchrow(query, *args):
        if "FROM users WHERE LOWER(email)" in query:
            return state["email_has_account"]
        if "max_pahchan_seats" in query:
            # No organisation has this column set; a NULL allowance is unlimited.
            return {"seat_limit": None, "roster": 0, "exempt": 0,
                    "module_active": True}
        if "INSERT INTO staging.manav_employees" in query:
            state["employees_inserted"] += 1
            return {
                "id": EMP_ID, "name": "Rahul Mehta", "employee_code": "EMP002",
                "org_id": TEST_ORG_ID, "user_id": None, "email": EMAIL,
                "department": "Audit", "designation": "Article",
            }
        return None

    async def execute(query, *args):
        state["executed"].append((query, args))
        return "INSERT 0 1"

    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []
    mock_pool.execute.side_effect = execute
    return state


def _invite_inserts(state):
    return [q for q, _ in state["executed"] if "INSERT INTO public.invites" in q]


def _invite_insert_args(state):
    for q, a in state["executed"]:
        if "INSERT INTO public.invites" in q:
            return q, a
    return None, None


async def _hire(api_client, **over):
    body = {"name": "Rahul Mehta", "email": EMAIL, "employee_code": "EMP002"}
    body.update(over)
    return await api_client.post("/api/v1/manav/employees", json=body)


# ── Property 1: unticked changes nothing at all ──────────────────────────────

async def test_the_box_is_off_by_default(api_client, hiring, as_admin, with_org_id):
    """The ordinary hire, with no mention of a login anywhere in the body.

    This is the case for most of the 98 live employee rows: a Pahchan
    attendance-only worker who punches in on a shared device and never signs in
    to anything. It must behave exactly as it did before the checkbox existed.
    """
    resp = await _hire(api_client)

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "created"
    assert _invite_inserts(hiring) == [], "an unasked-for invitation was sent"
    assert "invite" not in resp.json(), (
        "the response carries an `invite` key for an employee nobody asked to "
        "invite — a key that is always there and usually says nothing reads as "
        "a feature every employee has"
    )


async def test_unticked_asks_nothing_about_seats_or_migrations(
    api_client, hiring, mock_pool, as_admin, with_org_id,
):
    """Not merely "sends no mail" — asks no QUESTION.

    An org seat count and a catalogue probe on every hire would be a cost paid
    by the majority case to serve the minority one, and 98 of 98 live employee
    rows are the majority case.
    """
    await _hire(api_client)

    queries = [c.args[0] for c in mock_pool.fetchval.await_args_list if c.args]

    assert not any("COALESCE(o.max_users" in q for q in queries), (
        "the ORG seat ceiling was read for a hire that asked for no login. "
        "That count is about accounts; employment is limited by the ATTENDANCE "
        "seat, which is a different question with a different answer."
    )
    assert not any("table_name='invites'" in q for q in queries), (
        "the migration-187 probe ran for a hire that asked for no login"
    )


async def test_ticking_it_sends_one_invitation_carrying_the_employee(
    api_client, hiring, as_admin, with_org_id,
):
    resp = await _hire(api_client, create_login=True)

    assert resp.status_code == 200, resp.text
    assert resp.json()["invite"] == {"sent": True, "email": EMAIL}

    query, args = _invite_insert_args(hiring)
    assert query is not None, "no invitation was written"
    assert "employee_id" in query, (
        "the invitation does not carry the employee id, so acceptance would "
        "have nothing to link — which is the entire point of the change"
    )
    assert EMP_ID in [str(a) for a in args], (
        "the invitation carries some employee id, but not the one just created"
    )


async def test_the_employee_id_is_bound_through_nullif_not_a_bare_cast(
    api_client, hiring, as_admin, with_org_id,
):
    """`NULLIF($n::text,'')::uuid`, never `$n::uuid`.

    An empty string reaching a uuid cast is an instant 500 through PgBouncer,
    and "" is what a form sends for an untouched field. The untyped-parameter
    form of NULLIF is the same shape that killed every credit spend once.
    """
    await _hire(api_client, create_login=True)
    query, _ = _invite_insert_args(hiring)
    assert "NULLIF($11::text,'')::uuid" in query, query


# ── Property 2: nothing is written until every refusal has been asked ────────

async def test_ticking_it_without_an_email_refuses_and_writes_no_personnel_file(
    api_client, hiring, as_admin, with_org_id,
):
    resp = await _hire(api_client, email="", create_login=True)

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "email" in detail.lower()
    # The refusal has to say what the alternative is, or the admin's only route
    # out of it is to guess.
    assert "Pahchan" in detail
    assert hiring["employees_inserted"] == 0, (
        "a personnel file carrying an Aadhaar, a PAN and a bank account was "
        "committed and then the request was refused"
    )


async def test_an_employee_with_no_email_is_perfectly_ordinary_unticked(
    api_client, hiring, as_admin, with_org_id,
):
    """The mirror of the test above, and the one that stops it over-reaching.

    An address is required to SEND an invitation. It is not required to be an
    employee, and a great many of the 98 live rows have none.
    """
    resp = await _hire(api_client, email="")
    assert resp.status_code == 200, resp.text


async def test_a_full_organisation_refuses_the_hire_before_writing_it(
    api_client, hiring, as_admin, with_org_id,
):
    """A pending invitation holds a seat, so the ceiling can be hit here.

    Refused BEFORE the INSERT, deliberately: the admin's remedy is to untick the
    box and add the employee anyway, and they cannot do that if the employee has
    already been created.
    """
    hiring["seat_limit"] = 5
    hiring["seats_joined"] = 5

    resp = await _hire(api_client, create_login=True)

    assert resp.status_code == 409, resp.text
    assert "seats" in resp.json()["detail"]
    assert hiring["employees_inserted"] == 0
    assert _invite_inserts(hiring) == []


async def test_a_full_organisation_does_not_block_a_hire_with_no_login(
    api_client, hiring, as_admin, with_org_id,
):
    """The seat ceiling is a limit on ACCOUNTS, not on employment.

    Getting this wrong would mean a firm at its plan limit could not record a
    new cleaner on the attendance roster.
    """
    hiring["seat_limit"] = 5
    hiring["seats_joined"] = 5

    resp = await _hire(api_client)
    assert resp.status_code == 200, resp.text


async def test_an_address_that_already_has_an_account_is_refused(
    api_client, hiring, as_admin, with_org_id,
):
    hiring["email_has_account"] = {"user_id": "user_existing1"}

    resp = await _hire(api_client, create_login=True)

    assert resp.status_code == 409
    assert "already has an account" in resp.json()["detail"]
    assert hiring["employees_inserted"] == 0


# ── Property 3: a Manav grant is not authority over the organisation ─────────

async def test_a_manav_admin_who_is_not_an_org_admin_cannot_mint_a_login(
    api_client, hiring, as_member, with_org_id,
):
    """The caller holds `admin` on Manav — the module gate above says so — and
    is an ordinary member of the organisation.

    Creating the employee is theirs to do. Creating an ACCOUNT is not: it seats
    somebody in the company and hands them an org role. If a module grant
    reached that, `role_tiers.SEPARATED_DUTY` would be one tick away from being
    routed around.

    `as_member` and NOT `as_admin`, and the distinction is the test. The admin
    fixture holds `platform_admin` as well as an org row, and `is_org_admin`
    admits platform staff — correctly, they are Aekam. A test that used it would
    pass for a reason that has nothing to do with the rule.
    """
    hiring["caller_org_role"] = "org_member"

    resp = await _hire(api_client, create_login=True)

    assert resp.status_code == 403, resp.text
    assert "owner or admin" in resp.json()["detail"]
    assert hiring["employees_inserted"] == 0


async def test_that_same_caller_can_still_add_an_employee(
    api_client, hiring, as_member, with_org_id,
):
    """The refusal above is about the LOGIN, not about the hire."""
    hiring["caller_org_role"] = "org_member"

    resp = await _hire(api_client)
    assert resp.status_code == 200, resp.text
    assert hiring["employees_inserted"] == 1


async def test_an_org_admin_cannot_mint_an_owner_from_a_personnel_form(
    api_client, hiring, as_admin, with_org_id,
):
    """`org_invites._assert_may_grant_role`, reached rather than reimplemented.

    The form does not offer `org_owner`, but a form is not a permission check.
    """
    hiring["caller_org_role"] = "org_admin"

    resp = await _hire(api_client, create_login=True, login_role="org_owner")

    assert resp.status_code == 403, resp.text
    assert hiring["employees_inserted"] == 0


async def test_a_role_the_product_does_not_have_is_refused(
    api_client, hiring, as_admin, with_org_id,
):
    resp = await _hire(api_client, create_login=True, login_role="superuser")
    assert resp.status_code == 400
    assert "Invalid role" in resp.json()["detail"]
    assert hiring["employees_inserted"] == 0


async def test_the_org_role_reaches_the_invitation(
    api_client, hiring, as_admin, with_org_id,
):
    await _hire(api_client, create_login=True, login_role="org_admin")
    _, args = _invite_insert_args(hiring)
    assert "org_admin" in [str(a) for a in args]


async def test_the_form_grants_no_modules(api_client, hiring, as_admin, with_org_id):
    """A personnel form is not an authority editor.

    The invitation seats the person and nothing more; grants are given
    afterwards, on the screen that exists for giving them, where the
    separated-duty rule is visible.
    """
    await _hire(api_client, create_login=True)
    _, args = _invite_insert_args(hiring)
    assert json.dumps([]) in [str(a) for a in args], (
        f"the invitation carried module grants: {args!r}"
    )


# ── Property 5: migration 187 is not applied, and both halves must hold ──────

async def test_the_checkbox_refuses_with_the_migration_named(
    api_client, hiring, as_admin, with_org_id,
):
    hiring["migration_187"] = False

    resp = await _hire(api_client, create_login=True)

    assert resp.status_code == 503, resp.text
    detail = resp.json()["detail"]
    assert "187_invite_carries_the_employee.sql" in detail, (
        "the refusal does not name the file somebody has to apply, so the "
        "person reading it has no next step"
    )
    assert hiring["employees_inserted"] == 0


async def test_an_ordinary_invitation_still_works_without_the_migration(
    api_client, hiring, as_admin, with_org_id,
):
    """THE REGRESSION THIS CHANGE MOST EASILY CAUSES.

    Naming `employee_id` unconditionally in the INSERT would raise
    UndefinedColumnError on EVERY invitation this product sends — a feature
    nobody has switched on breaking the feature everybody uses. So the ordinary
    statement must not mention the column at all.
    """
    hiring["migration_187"] = False

    resp = await api_client.post("/api/v1/org/invites", json={
        "email": "someone.else@test.com", "org_role": "org_member",
    })

    assert resp.status_code == 200, resp.text
    query, _ = _invite_insert_args(hiring)
    assert query is not None
    assert "employee_id" not in query, (
        "the ordinary invite path names a column that does not exist on the "
        "live database"
    )


# ── The hire survives an invitation that does not ───────────────────────────

async def test_a_failed_invitation_does_not_undo_the_hire(
    api_client, hiring, as_admin, with_org_id, monkeypatch,
):
    """The personnel file is committed first and stays committed.

    `issue_invite` already takes this position one level down — the invite row
    is committed and the link returned, so a mail failure costs delivery rather
    than the invitation. Same reasoning here: reporting failure after the
    employee exists sends the admin back to add the same person twice.
    """
    async def boom(*a, **kw):
        raise RuntimeError("the invite table is on fire")

    monkeypatch.setattr("routers.manav.issue_invite", boom)

    resp = await _hire(api_client, create_login=True)

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "created"
    assert hiring["employees_inserted"] == 1
    invite = resp.json()["invite"]
    assert invite["sent"] is False
    assert "Settings" in invite["error"], (
        "the admin is told the invitation failed but not what to do instead"
    )


# ══════════════════════════════════════════════════════════════════════════════
# Part 2 · Accepting the invitation
# ══════════════════════════════════════════════════════════════════════════════

def _invite_row(**over):
    row = {
        "invite_id": "inv_abc123456789",
        "token": TOKEN,
        "email": EMAIL,
        "role": "member",
        "full_name": "Rahul Mehta",
        "member_role": "org_member",
        "receives_approval_emails": True,
        "accepted_at": None,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "invited_by": "user_admin001",
        "org_id": TEST_ORG_ID,
        "module_grants": "[]",
        "employee_id": EMP_ID,
    }
    row.update(over)
    return row


@pytest.fixture
def accepting(mock_pool):
    """Answer every query `accept_invite` issues, and record the link attempt."""
    state = {
        "invite": _invite_row(),
        # What the linking UPDATE returns: the id on success, None when it
        # matched no row. `raises` makes it raise instead.
        "link_result": EMP_ID,
        "raises": None,
        "link_calls": [],
        "executed": [],
    }

    async def fetchrow(query, *args):
        if "invites WHERE token" in query:
            return state["invite"]
        if "users WHERE email" in query:
            return None
        if "users WHERE user_id" in query:
            return {
                "user_id": "user_newjoiner", "email": EMAIL,
                "name": "Rahul Mehta", "full_name": "Rahul Mehta",
                "role": "member", "avatar": None,
            }
        return None

    async def fetchval(query, *args):
        if "UPDATE staging.manav_employees" in query:
            state["link_calls"].append((query, args))
            if state["raises"] is not None:
                raise state["raises"]
            return state["link_result"]
        if "COALESCE(o.max_users" in query:
            return None
        return None

    async def execute(query, *args):
        state["executed"].append((query, args))
        return "INSERT 0 1"

    mock_pool.fetchrow.side_effect = fetchrow
    mock_pool.fetchval.side_effect = fetchval
    mock_pool.fetch.side_effect = None
    mock_pool.fetch.return_value = []
    mock_pool.execute.side_effect = execute
    return state


async def _accept(api_client):
    return await api_client.post("/api/auth/accept-invite", json={
        "token": TOKEN, "name": "Rahul Mehta", "password": "NewPass123!",
    })


async def test_acceptance_links_the_employee(api_client, accepting):
    resp = await _accept(api_client)

    assert resp.status_code == 200, resp.text
    assert resp.json()["token"], "the person did not end up signed in"
    assert len(accepting["link_calls"]) == 1, (
        "the account was created and the employee record was left unlinked — "
        "which is the state all 98 live rows are already in"
    )


async def test_the_link_is_scoped_by_organisation_as_well_as_by_employee(
    api_client, accepting,
):
    """`WHERE id=$2 AND org_id=$3`.

    Without the org predicate an invitation could name any employee id in the
    database and claim a personnel record in another firm — and that record
    decides whose payslip the account may open.
    """
    await _accept(api_client)
    query, args = accepting["link_calls"][0]

    assert "org_id=$3::uuid" in query.replace(" ", "").replace("\n", "") or \
           "org_id=$3::uuid" in query, query
    assert TEST_ORG_ID in [str(a) for a in args]
    assert EMP_ID in [str(a) for a in args]


async def test_the_link_can_only_fill_an_empty_one_never_overwrite(
    api_client, accepting,
):
    """`AND user_id IS NULL`.

    An acceptance must not be able to take an employee record away from an
    account that already holds it.
    """
    await _accept(api_client)
    query, _ = accepting["link_calls"][0]
    assert "user_id IS NULL" in query, query


async def test_an_invitation_with_no_employee_links_nothing(api_client, accepting):
    """Every invitation sent from Settings, and every platform-console one."""
    accepting["invite"] = _invite_row(employee_id=None)

    resp = await _accept(api_client)

    assert resp.status_code == 200, resp.text
    assert accepting["link_calls"] == []


async def test_an_invite_row_without_the_column_links_nothing(api_client, accepting):
    """Migration 187 unapplied: the row simply has no such key.

    Read through `invite.keys()` rather than by catching an exception, so the
    pre-migration state costs nothing and raises nothing.
    """
    row = _invite_row()
    del row["employee_id"]
    accepting["invite"] = row

    resp = await _accept(api_client)

    assert resp.status_code == 200, resp.text
    assert accepting["link_calls"] == []


# ── The three ways the link may fail, none of which may fail the acceptance ──

async def test_a_deleted_employee_record_is_not_an_error(api_client, accepting):
    """Seven days is long enough for HR to delete the record.

    Nought rows updated, and the person still gets their account.
    """
    accepting["link_result"] = None

    resp = await _accept(api_client)

    assert resp.status_code == 200, resp.text
    assert resp.json()["token"]


async def test_the_unique_index_refusing_does_not_fail_the_acceptance(
    api_client, accepting,
):
    """`uq_manav_employee_login` (migration 101) is a partial UNIQUE index on
    `(org_id, user_id) WHERE user_id IS NOT NULL` — CONFIRMED live on
    2026-08-21.

    When it refuses, the correct answer is to leave the employee unlinked for
    the repair screen. Somebody who has just chosen a password must not be
    turned away over a bookkeeping collision they cannot see, and turning them
    away would ALSO spend the invitation: `accepted_at` is already stamped, so
    the link would be dead and the account would not exist.
    """
    accepting["raises"] = asyncpg.exceptions.UniqueViolationError(
        "duplicate key value violates unique constraint "
        '"uq_manav_employee_login"'
    )

    resp = await _accept(api_client)

    assert resp.status_code == 200, resp.text
    assert resp.json()["token"], (
        "a unique-index collision on the HR table signed the new user out of "
        "an account that had already been created"
    )


async def test_any_other_database_failure_is_also_survivable(api_client, accepting):
    accepting["raises"] = RuntimeError("connection reset")

    resp = await _accept(api_client)

    assert resp.status_code == 200, resp.text
    assert resp.json()["token"]


async def test_the_account_and_its_org_role_are_written_before_the_link(
    api_client, accepting,
):
    """Order matters: the link needs the account, and the account must survive
    the link failing."""
    accepting["link_result"] = None
    resp = await _accept(api_client)

    assert resp.status_code == 200
    written = [q for q, _ in accepting["executed"]]
    assert any("INSERT INTO users" in q for q in written)
    assert any("staging.user_roles" in q for q in written)
