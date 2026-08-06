"""
The attendance half of the seat model — `services/seat_model.py`.

An organisation buys TWO kinds of seat and they are counted separately: org
seats (`org_invites.count_seats`, already built and tested in
`test_seat_limit_and_console_guards.py` and `test_seat_hold_at_acceptance.py`)
and attendance seats (here). The owner's rule: a firm with 8 office staff and
200 site workers pays for 8 org seats and 200 attendance seats, not 208 of one
kind, and somebody who is BOTH an employee and a user is one org seat rather
than one of each.

── Why the arithmetic is tested as a function and not only over HTTP ─────────

The pool is a `MagicMock` in this suite and resolves any table name it is handed,
so an HTTP test can prove the handler asks and honours the answer — it cannot
prove the rule, because the mock would answer the same for a roster query, an
exemption query and a module query. `PahchanSeatCount` carries the whole decision
(`used`, `is_full`) and is pure, so it is exercised directly with values the
handler could never be made to produce through one mock.

── The tripwires are written out literally ──────────────────────────────────

`ORG_SEAT_ROLES` is asserted against the three role codes spelled out, NOT
against `role_tiers.ORG_ROLES`, which is where the module gets them. Asserting
`ORG_SEAT_ROLES == ORG_ROLES` is a tautology that passes no matter what either
becomes. The failure this is aimed at is real and is the likely next change to
this area: an attendance-only role added to `ORG_ROLES` would make every site
worker an org member, exempt every one of them from the attendance count, and
bill the 8+200 firm for nothing at all. That must turn this file red.
"""

import pytest

from services.seat_model import (
    ORG_SEAT_ROLES,
    PAHCHAN_SEAT_LIMIT_STATUS,
    PahchanSeatCount,
    count_pahchan_seats,
    pahchan_seat_detail,
)

ORG = "00000000-0000-0000-0000-0000000000aa"


def _seats(**over):
    """An org running attendance with an uncapped allowance."""
    row = {"limit": None, "roster": 0, "exempt": 0, "module_active": True}
    row.update(over)
    return PahchanSeatCount(**row)


# ── The tripwires ────────────────────────────────────────────────────────────

def test_the_exempting_roles_are_exactly_the_seat_consuming_org_roles():
    """Spelled out, not compared to the tuple this is built from — see the module
    docstring. Widening the org roles to carry an attendance-only role would
    exempt every site worker from the count they are the entire point of.

    `hr_admin` joined the list in Wave 3 and belongs there: the exemption's
    premise is "this person is ALREADY billed as an org seat", and an HR
    administrator is. The two PROJECT-ONLY roles are the case this test is
    really guarding — `org_client` and `aekam_team` cost NO org seat, so a
    roster worker holding one would be exempt from the attendance seat while
    being billed for nothing at all, and the whole roster would go free. They
    must never appear below."""
    assert tuple(ORG_SEAT_ROLES) == (
        "org_owner", "org_admin", "org_member", "hr_admin",
    )
    for free_role in ("org_client", "aekam_team"):
        assert free_role not in ORG_SEAT_ROLES


def test_both_seat_limits_answer_the_same_status_code():
    """409, and the same 409 the org-seat refusal uses. Two seat caps that answer
    differently is how a frontend ends up with two error paths for one
    condition. Asserted against the literal AND against the other counter, so
    neither can move alone."""
    from routers.org_invites import SEAT_LIMIT_STATUS

    assert PAHCHAN_SEAT_LIMIT_STATUS == 409
    assert PAHCHAN_SEAT_LIMIT_STATUS == SEAT_LIMIT_STATUS


# ── used — roster minus the people already paid for ──────────────────────────

def test_used_is_the_roster_when_nobody_is_exempt():
    assert _seats(roster=200).used == 200


def test_the_owners_example_bills_200_and_not_208():
    """8 office staff and 200 site workers. The office staff are employees too and
    are linked to their own logins, so the roster is 208 and eight of them are
    already paid for as org seats."""
    assert _seats(roster=208, exempt=8).used == 200


def test_used_never_goes_negative():
    """`exempt` is counted over the same is_active population as `roster` so it
    cannot exceed it — but a negative seat count is the kind of number that
    reaches an invoice as a credit."""
    assert _seats(roster=3, exempt=9).used == 0


def test_an_org_that_does_not_run_attendance_uses_no_attendance_seats():
    """A firm running Manav for payroll and not running Pahchan has a roster and
    no attendance seats. Billing its headcount for a module it never switched on
    is the single most expensive way this count could be wrong."""
    assert _seats(roster=500, module_active=False).used == 0


# ── is_full — when one more person is refused ────────────────────────────────

def test_no_cap_set_is_never_full():
    """NULL means unlimited, matching max_users. This is the state EVERY live
    organisation is in — no org has max_pahchan_seats set and the column does not
    exist until migration 109 is applied — so this is the assertion that shipping
    the cap refuses nobody today."""
    assert _seats(limit=None, roster=10_000).is_full is False


def test_full_at_exactly_the_allowance():
    """`>=`, not `>`. `used` is what is already standing in the allowance, so an
    org with 15 of 15 has no room for a sixteenth."""
    assert _seats(limit=15, roster=15).is_full is True


def test_not_full_one_below_the_allowance():
    assert _seats(limit=15, roster=14).is_full is False


def test_over_the_allowance_is_still_full():
    """An org CAN go past its cap — unlinking an employee removes an exemption and
    is deliberately not refused, so `used` may exceed `limit`. The next hire must
    still be refused rather than the comparison reading as a miss."""
    assert _seats(limit=15, roster=20).is_full is True


def test_an_exemption_can_take_an_org_back_under_its_cap():
    """The whole reason the exemption exists, as a number: the same roster is full
    without it and has room with it."""
    assert _seats(limit=15, roster=15).is_full is True
    assert _seats(limit=15, roster=15, exempt=1).is_full is False


def test_a_zero_cap_refuses_everybody():
    """0 is a legitimate allowance meaning "this org may not put anyone on the
    attendance roster", and must not be read as falsy-therefore-unlimited. That
    confusion is exactly what `limit is None` rather than `not limit` prevents."""
    assert _seats(limit=0, roster=0).is_full is True


def test_a_capped_org_that_does_not_run_attendance_is_never_full():
    assert _seats(limit=5, roster=99, module_active=False).is_full is False


# ── The refusal sentence ─────────────────────────────────────────────────────

def test_the_refusal_names_the_cap_the_usage_and_the_remedy():
    msg = pahchan_seat_detail(_seats(limit=200, roster=200))
    assert "200" in msg
    assert "max_pahchan_seats" in msg
    assert "offboarding" in msg


def test_the_refusal_explains_the_gap_between_roster_and_seats():
    """An org whose roster is 208 and whose seats used are 200 will ring up asking
    why 200 is "all of them". The exempt figure is the answer and has to be in the
    sentence."""
    msg = pahchan_seat_detail(_seats(limit=200, roster=208, exempt=8))
    assert "200 of 208" in msg
    assert "8 more" in msg
    assert "org users" in msg


def test_the_refusal_says_nothing_about_exemptions_when_there_are_none():
    """Which is every organisation today — manav_employees.user_id is NULL on all
    81 live rows. A sentence ending "and 0 more are org users" is noise on the
    only path anyone will actually hit."""
    msg = pahchan_seat_detail(_seats(limit=7, roster=7))
    assert "0 more" not in msg
    assert "org users" not in msg


# ── count_pahchan_seats — that the row is read into the right fields ─────────

async def test_the_counter_reads_each_field_off_the_row(mock_pool):
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = {
        "seat_limit": 15, "roster": 7, "exempt": 2, "module_active": True,
    }
    seats = await count_pahchan_seats(mock_pool, ORG)
    assert (seats.limit, seats.roster, seats.exempt) == (15, 7, 2)
    assert seats.used == 5


async def test_the_counter_asks_only_for_the_org_it_was_given(mock_pool):
    """One statement, so the four figures cannot be read at four instants and
    disagree. And the exempting roles are bound as a parameter rather than
    interpolated."""
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = {
        "seat_limit": None, "roster": 0, "exempt": 0, "module_active": True,
    }
    await count_pahchan_seats(mock_pool, ORG)
    assert mock_pool.fetchrow.await_count == 1
    args = mock_pool.fetchrow.await_args.args
    assert args[1] == ORG
    assert args[2] == ["org_owner", "org_admin", "org_member", "hr_admin"]


async def test_a_missing_org_is_uncapped_and_empty(mock_pool):
    """Every caller has already resolved the org through `get_org_id`, so a miss
    means it was deleted mid-request. A seat counter is the wrong place to be the
    one reporting that, and it must not fail closed and refuse a hire."""
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = None
    seats = await count_pahchan_seats(mock_pool, ORG)
    assert seats.is_full is False
    assert seats.used == 0


async def test_a_null_count_from_the_database_reads_as_zero(mock_pool):
    mock_pool.fetchrow.side_effect = None
    mock_pool.fetchrow.return_value = {
        "seat_limit": None, "roster": None, "exempt": None, "module_active": None,
    }
    seats = await count_pahchan_seats(mock_pool, ORG)
    assert (seats.roster, seats.exempt, seats.module_active) == (0, 0, False)


# ══════════════════════════════════════════════════════════════════════════════
# Over HTTP — that creating an employee is gated, and gated BEFORE the write
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def hr_admin(app):
    """`_gate` is `require_module_or_self("manav")` and its VALUE is the caller's
    Tier-4 level set. Creating a personnel file is admin-gated."""
    from routers.manav import _gate
    app.dependency_overrides[_gate] = lambda: frozenset({"admin"})
    yield
    app.dependency_overrides.pop(_gate, None)


def _wire(mock_pool, *, limit, roster, exempt=0, module_active=True):
    """Dispatch on query text, not on call order — the create handler issues the
    seat read and then the INSERT, and asserting on order breaks the moment a
    query is added between them."""
    async def fetchrow(query, *args):
        if "max_pahchan_seats" in query:
            return {"seat_limit": limit, "roster": roster, "exempt": exempt,
                    "module_active": module_active}
        if "INSERT INTO staging.manav_employees" in query:
            return {"id": "e0000000-0000-0000-0000-000000000001",
                    "name": "Ramesh Kumar", "employee_code": "EMP900"}
        return None

    mock_pool.fetchrow.side_effect = fetchrow
    return mock_pool


def _inserted(mock_pool) -> bool:
    """Whether a personnel file was written. Reads the SQL the mock was handed;
    these strings carry no comments, which is what keeps this from asserting
    against somebody's explanation of an INSERT rather than an INSERT."""
    return any(
        "INSERT INTO staging.manav_employees" in c.args[0]
        for c in mock_pool.fetchrow.await_args_list if c.args
    )


_BODY = {"name": "Ramesh Kumar", "employment_type": "full_time"}


async def test_a_hire_is_admitted_when_no_cap_is_set(
    api_client, mock_pool, as_admin, with_org_id,
):
    """The state every live organisation is in."""
    _wire(mock_pool, limit=None, roster=5_000)
    resp = await api_client.post("/api/v1/manav/employees", json=_BODY)
    assert resp.status_code == 200, resp.text
    assert _inserted(mock_pool)


async def test_a_hire_is_refused_once_the_attendance_seats_are_full(
    api_client, mock_pool, as_admin, with_org_id,
):
    _wire(mock_pool, limit=7, roster=7)
    resp = await api_client.post("/api/v1/manav/employees", json=_BODY)
    assert resp.status_code == 409
    assert "attendance seats" in resp.json()["detail"]


async def test_a_refused_hire_writes_no_personnel_file(
    api_client, mock_pool, as_admin, with_org_id,
):
    """THE ORDERING, AS A TEST. A personnel file carries an Aadhaar, a PAN and
    bank details. A guard that runs after the INSERT leaves the org over its cap
    AND holding the row that put it there, and the caller is told the hire did
    not happen."""
    _wire(mock_pool, limit=7, roster=7)
    resp = await api_client.post("/api/v1/manav/employees", json=_BODY)
    assert resp.status_code == 409
    assert not _inserted(mock_pool)


async def test_an_exempt_employee_leaves_room_for_the_hire(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Same roster, same cap, one linked org user — and the hire goes through.
    This is the owner's rule reaching an actual request."""
    _wire(mock_pool, limit=7, roster=7, exempt=1)
    resp = await api_client.post("/api/v1/manav/employees", json=_BODY)
    assert resp.status_code == 200, resp.text
    assert _inserted(mock_pool)


async def test_a_payroll_only_org_is_never_refused_a_hire(
    api_client, mock_pool, as_admin, with_org_id,
):
    """Pahchan inactive. Manav is a payroll product for firms that do not run
    attendance at all, and an attendance cap must not reach them."""
    _wire(mock_pool, limit=1, roster=900, module_active=False)
    resp = await api_client.post("/api/v1/manav/employees", json=_BODY)
    assert resp.status_code == 200, resp.text
    assert _inserted(mock_pool)
