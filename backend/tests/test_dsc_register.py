"""test_dsc_register.py — the DSC custody register, and the two tests that matter.

THE DELIVERABLES are `test_the_expiry_window_is_inclusive_at_both_ends` and
`test_a_certificate_belonging_to_another_org_is_never_returned`. Everything else
here supports them.

── HOW THESE TESTS AVOID BEING WORTHLESS ───────────────────────────────────
This suite has no database: tests/conftest.py swaps a MagicMock in for the pool.
A mock pool hides bad SQL, so the obvious version of both deliverables —
hand-stub the pool with the rows you want back, assert you got them — passes
green against a service whose WHERE clause has been deleted. It would assert the
fixture, not the product.

So the fake pool here does not invent answers. It DISPATCHES ON THE STATEMENT
(identity against the module's own query constants, so a new statement without a
fake is a KeyError and not a silent empty list) and then executes the predicate
IT PARSES OUT OF THAT STATEMENT'S TEXT. `_op_after` lifts the actual comparison
operator from the SQL, so changing `d.valid_to >= $2::date` to `>` changes what
the fake returns and the inclusive-boundary test goes red. That is the coupling:
the test is pinned to the SQL, not to a copy of what the SQL was supposed to say.

For tenancy the fake goes the other way. `FakePool(honour_org=False)` deliberately
IGNORES the org predicate and hands back a foreign row — simulating exactly the
bug a WHERE-clause deletion would cause — and the test asserts the service raises
rather than returning it. The org check lives in services/custody/dsc.py`._shape`
for this reason and no other; without it, that test could not exist here.

The migration itself is asserted by shape in `TestTheMigration`, against the file
on disk. It is not applied by this suite and must not be — staging and production
share one database.
"""
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from services.custody import dsc
from services.custody.dsc import CrossOrgLeak, CustodyError

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "160_dsc_register.sql"
)

ORG = "64e7bea6-0000-4000-8000-000000000001"
OTHER_ORG = "11111111-0000-4000-8000-0000000000ff"
CLIENT_A = "aaaaaaaa-0000-4000-8000-00000000000a"
CLIENT_B = "bbbbbbbb-0000-4000-8000-00000000000b"

TODAY = date(2026, 8, 19)


# ── row factory ──────────────────────────────────────────────────────────────

def make_row(**over):
    """A record shaped exactly like the SELECT in services/custody/dsc.py.

    Every key the service reads is present, including the two it pops. Building
    rows from one factory means a column added to `_PUBLIC` without a value here
    fails loudly in `_shape` rather than arriving as a missing key inside one
    test.
    """
    row = {
        "org_id": ORG,
        "client_id": CLIENT_A,
        "id": "dddddddd-0000-4000-8000-000000000001",
        "client_name": "Mehta Trading Co LLP",
        "holder_name": "Rakesh Mehta",
        "holder_kind": "individual",
        "holder_designation": "Partner",
        "holder_pan": None,
        "holder_din": None,
        "certificate_class": "class_3",
        "certificate_type": "signature",
        "issuing_authority": "eMudhra",
        "serial_number": "4a9f22",
        "valid_from": date(2024, 8, 19),
        "valid_to": date(2027, 8, 18),
        "revoked_on": None,
        "custody_status": "with_firm",
        "custody_location": "Safe, cabin 2",
        "custody_holder_name": None,
        "custody_changed_on": None,
        "token_kind": "usb_token",
        "token_serial": "EP2003-77120",
        "registered_portals": ["incometax"],
        "notes": None,
        "is_active": True,
        "created_at": datetime(2024, 8, 19, 10, 0, 0),
        "updated_at": datetime(2024, 8, 19, 10, 0, 0),
    }
    row.update(over)
    return row


# ── the fake pool: predicates lifted out of the real SQL ─────────────────────

_OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
}


def _op_after(query: str, column: str, rhs: str):
    """Lift the comparison operator the SQL actually uses for `column ? rhs`.

    This is what pins the boundary tests to the statement. If someone edits
    `d.valid_to >= $2::date` down to `>`, this returns the strict operator, the
    fake stops returning the certificate that dies today, and
    `test_the_expiry_window_is_inclusive_at_both_ends` fails — which is the
    whole point, because that off-by-one is invisible in production until the
    day somebody's filing stops.
    """
    pattern = re.escape(column) + r"\s*(>=|<=|>|<)\s*" + re.escape(rhs)
    found = re.search(pattern, query)
    assert found, f"no comparison of {column!r} against {rhs!r} in the statement"
    return _OPS[found.group(1)]


class FakePool:
    """Executes the statements in dsc.py against in-memory rows.

    `honour_org=False` makes it ignore the org predicate — the simulation of a
    deleted WHERE clause that the tenancy test needs.
    """

    def __init__(self, rows, *, honour_org=True):
        self.rows = list(rows)
        self.honour_org = honour_org
        self.calls = []

    async def fetch(self, query, *args):
        self.calls.append((query, args))
        return _HANDLERS[query](self, query, args)

    def _scoped(self, org):
        if not self.honour_org:
            return list(self.rows)
        return [r for r in self.rows if str(r["org_id"]).lower() == str(org).lower()]


def _sorted(rows, *, descending=False):
    rows = sorted(rows, key=lambda r: (r["valid_to"], r["holder_name"], r["id"]))
    if descending:
        # Only the date reverses in _ORDER_LATEST; name and id stay ascending.
        rows = sorted(rows, key=lambda r: r["valid_to"], reverse=True)
    return rows


def _h_expiring(pool, query, args):
    org, as_of, days = args
    lo = _op_after(query, "d.valid_to", "$2::date")
    hi = _op_after(query, "d.valid_to", "($2::date + $3::int)")
    end = as_of + timedelta(days=days)
    out = [
        r for r in pool._scoped(org)
        if r["is_active"]
        and lo(r["valid_to"], as_of)
        and hi(r["valid_to"], end)
        and (r["revoked_on"] is None or r["revoked_on"] > as_of)
    ]
    return _sorted(out)


def _h_expired(pool, query, args):
    org, as_of = args
    op = _op_after(query, "d.valid_to", "$2::date")
    out = [
        r for r in pool._scoped(org)
        if r["is_active"] and op(r["valid_to"], as_of)
    ]
    return _sorted(out, descending=True)


def _h_unusable(pool, query, args):
    org, as_of, custody_ok = args
    out = [
        r for r in pool._scoped(org)
        if r["is_active"] and (
            r["valid_to"] < as_of
            or r["valid_from"] > as_of
            or (r["revoked_on"] is not None and r["revoked_on"] <= as_of)
            or r["custody_status"] not in custody_ok
        )
    ]
    return _sorted(out)


def _h_not_in_possession(pool, query, args):
    org, _as_of, custody_ok = args
    out = [
        r for r in pool._scoped(org)
        if r["is_active"] and r["custody_status"] not in custody_ok
    ]
    return _sorted(out)


def _h_for_client(pool, query, args):
    org, _as_of, client_id, include_inactive = args
    out = [
        r for r in pool._scoped(org)
        # IS NOT DISTINCT FROM — NULL matches NULL, which is the whole reason
        # the SQL does not say `= $3`.
        if r["client_id"] == client_id
        and (include_inactive or r["is_active"])
    ]
    return _sorted(out)


def _h_register(pool, query, args):
    org, _as_of, include_inactive = args
    out = [
        r for r in pool._scoped(org)
        if include_inactive or r["is_active"]
    ]
    return _sorted(out)


_HANDLERS = {
    dsc._Q_EXPIRING: _h_expiring,
    dsc._Q_EXPIRED: _h_expired,
    dsc._Q_UNUSABLE: _h_unusable,
    dsc._Q_NOT_IN_POSSESSION: _h_not_in_possession,
    dsc._Q_FOR_CLIENT: _h_for_client,
    dsc._Q_REGISTER: _h_register,
}


def names(rows):
    return [r["holder_name"] for r in rows]


# ── THE DELIVERABLE: the window is inclusive at both ends ────────────────────

class TestTheExpiryWindow:

    @pytest.mark.asyncio
    async def test_the_expiry_window_is_inclusive_at_both_ends(self):
        """[as_of, as_of + N] — both boundary days are IN.

        A certificate is valid THROUGH valid_to (X.509 notAfter is an inclusive
        bound and the CA prints "valid till" that date), so one dying on `as_of`
        is still usable today and is exactly the one a 30-day report must shout
        about. And a 30-day window that stopped at day 29 would let the last day
        of the month fall through it every month.
        """
        pool = FakePool([
            make_row(holder_name="Yesterday", valid_to=TODAY - timedelta(days=1),
                     id="row-1"),
            make_row(holder_name="Today", valid_to=TODAY, id="row-2"),
            make_row(holder_name="Midwindow", valid_to=TODAY + timedelta(days=15),
                     id="row-3"),
            make_row(holder_name="LastDay", valid_to=TODAY + timedelta(days=30),
                     id="row-4"),
            make_row(holder_name="OneDayLate", valid_to=TODAY + timedelta(days=31),
                     id="row-5"),
        ])

        rows = await dsc.expiring_within(pool, ORG, days=30, as_of=TODAY)

        assert names(rows) == ["Today", "Midwindow", "LastDay"], (
            "the window must include BOTH the day it starts and the day it ends"
        )

    @pytest.mark.asyncio
    async def test_days_zero_is_exactly_the_certificates_dying_today(self):
        """A zero-length window is a legal question, not an empty one."""
        pool = FakePool([
            make_row(holder_name="Today", valid_to=TODAY, id="row-1"),
            make_row(holder_name="Tomorrow", valid_to=TODAY + timedelta(days=1),
                     id="row-2"),
            make_row(holder_name="Yesterday", valid_to=TODAY - timedelta(days=1),
                     id="row-3"),
        ])

        rows = await dsc.expiring_within(pool, ORG, days=0, as_of=TODAY)

        assert names(rows) == ["Today"]
        assert rows[0]["days_to_expiry"] == 0
        assert rows[0]["status"] == dsc.USABLE, (
            "a certificate expiring today still works today"
        )

    @pytest.mark.asyncio
    async def test_expiring_and_expired_are_disjoint_and_cover_everything(self):
        """No certificate may be in both buckets, and none may be in neither.

        This is the property the inclusive/strict pairing exists to give. If
        `expired` used `<=` or `expiring_within` used `>`, the certificate on the
        boundary would be double-counted or would vanish — and "vanish" is the
        one that silently loses a filing.
        """
        rows = [
            make_row(holder_name=f"H{i}", id=f"row-{i}",
                     valid_from=TODAY - timedelta(days=900),
                     valid_to=TODAY + timedelta(days=offset))
            for i, offset in enumerate((-400, -1, 0, 1, 30, 31))
        ]
        pool = FakePool(rows)

        soon = await dsc.expiring_within(pool, ORG, days=10_000, as_of=TODAY)
        gone = await dsc.expired(pool, ORG, as_of=TODAY)

        assert set(names(soon)) & set(names(gone)) == set(), "double-counted"
        assert set(names(soon)) | set(names(gone)) == {f"H{i}" for i in range(6)}

    @pytest.mark.asyncio
    async def test_expired_reports_how_long_ago(self):
        pool = FakePool([
            make_row(holder_name="Old", valid_to=TODAY - timedelta(days=4),
                     id="row-1"),
        ])
        rows = await dsc.expired(pool, ORG, as_of=TODAY)
        assert rows[0]["days_to_expiry"] == -4, (
            "negative and unclamped: 'expired 4 days ago' is the sentence a "
            "human needs to read"
        )
        assert rows[0]["status"] == dsc.EXPIRED

    @pytest.mark.asyncio
    async def test_a_revoked_certificate_is_not_in_the_renewal_list(self):
        """Revoked is gone, not expiring. Telling a firm to renew it is noise."""
        pool = FakePool([
            make_row(holder_name="Killed", valid_to=TODAY + timedelta(days=10),
                     revoked_on=TODAY - timedelta(days=2), id="row-1"),
            make_row(holder_name="Alive", valid_to=TODAY + timedelta(days=10),
                     id="row-2"),
        ])
        rows = await dsc.expiring_within(pool, ORG, days=30, as_of=TODAY)
        assert names(rows) == ["Alive"]


# ── THE DELIVERABLE: tenancy ────────────────────────────────────────────────

class TestOrgScoping:

    @pytest.mark.asyncio
    async def test_a_certificate_belonging_to_another_org_is_never_returned(self):
        """Two ways, because one of them would pass against a broken service.

        First with a pool that honours the org predicate: the foreign row is not
        in the answer. That much a MagicMock could fake.

        Then with `honour_org=False` — the pool behaving exactly as it would if
        the `d.org_id = $1::uuid` clause had been deleted from the statement. A
        service that trusts its SQL returns another firm's client name here. This
        one raises, and that is what the Python-side check in `_shape` is for.
        """
        mine = make_row(holder_name="Ours", id="row-1")
        theirs = make_row(
            holder_name="Theirs", id="row-2",
            org_id=OTHER_ORG, client_id=CLIENT_B,
            client_name="Some Other Firm's Client Pvt Ltd",
        )

        honest = FakePool([mine, theirs])
        rows = await dsc.register(honest, ORG, as_of=TODAY)
        assert names(rows) == ["Ours"]

        leaky = FakePool([mine, theirs], honour_org=False)
        with pytest.raises(CrossOrgLeak):
            await dsc.register(leaky, ORG, as_of=TODAY)

    @pytest.mark.asyncio
    async def test_the_leak_is_refused_on_every_entry_point(self):
        """Not just the listing. Each function is a separate statement, and a
        WHERE clause is deleted from one statement at a time."""
        theirs = make_row(org_id=OTHER_ORG, holder_name="Theirs", id="row-2",
                          custody_status="with_client",
                          valid_to=TODAY - timedelta(days=1))
        leaky = FakePool([theirs], honour_org=False)

        for call in (
            lambda: dsc.register(leaky, ORG, as_of=TODAY),
            lambda: dsc.expired(leaky, ORG, as_of=TODAY),
            lambda: dsc.unusable(leaky, ORG, as_of=TODAY),
            lambda: dsc.not_in_possession(leaky, ORG, as_of=TODAY),
            lambda: dsc.for_client(leaky, ORG, CLIENT_A, as_of=TODAY),
        ):
            with pytest.raises(CrossOrgLeak):
                await call()

        # expiring_within needs a row inside its window to reach _shape at all.
        leaky.rows = [make_row(org_id=OTHER_ORG, holder_name="Theirs",
                               id="row-3", valid_to=TODAY)]
        with pytest.raises(CrossOrgLeak):
            await dsc.expiring_within(leaky, ORG, days=30, as_of=TODAY)

    def test_every_statement_narrows_by_org_in_sql_too(self):
        """The Python check is the second line of defence, not the first.

        Without the SQL predicate the database would ship every org's rows over
        the wire before Python threw them away — a tenancy leak in the query log,
        in memory, and in the query plan, even if no user ever saw it.
        """
        for name, query in _statements():
            assert "d.org_id = $1::uuid" in query, f"{name} is not org-scoped"

    def test_the_client_name_join_is_org_scoped(self):
        """A client_id pointing at another tenant must not fetch that tenant's
        company NAME. No WHERE clause on `d` can catch that: the leaking value
        is on the joined table."""
        assert "ON c.id = d.client_id AND c.org_id = d.org_id" in dsc._FROM

    @pytest.mark.asyncio
    async def test_org_id_case_does_not_fake_a_leak(self):
        """asyncpg hands back lower-case uuids; a JWT claim may be upper-case.
        Folding both is the difference between a working query and a 500 that
        reads like a security incident."""
        row = make_row(org_id=ORG.upper())
        pool = FakePool([row])
        rows = await dsc.register(pool, ORG.lower(), as_of=TODAY)
        assert names(rows) == ["Rakesh Mehta"]


# ── custody: "we do not have it" ────────────────────────────────────────────

class TestCustody:

    @pytest.mark.asyncio
    async def test_a_live_certificate_we_handed_back_still_blocks_the_filing(self):
        """The reason this register is not just a date column.

        Nothing is wrong with this certificate. It is in date, unrevoked, and
        unusable, because the token is in the client's drawer.
        """
        pool = FakePool([
            make_row(holder_name="Handed Back", id="row-1",
                     valid_to=TODAY + timedelta(days=300),
                     custody_status="with_client",
                     custody_changed_on=date(2026, 3, 4)),
        ])

        rows = await dsc.not_in_possession(pool, ORG, as_of=TODAY)
        assert names(rows) == ["Handed Back"]
        assert rows[0]["status"] == dsc.NOT_IN_POSSESSION
        assert rows[0]["days_to_expiry"] == 300, (
            "the expiry is still reported — 'we do not have it' does not erase "
            "the date, it adds a second reason"
        )

    @pytest.mark.asyncio
    async def test_unusable_is_the_union_a_filing_day_check_needs(self):
        pool = FakePool([
            make_row(holder_name="Fine", id="row-1",
                     valid_to=TODAY + timedelta(days=100)),
            make_row(holder_name="Dead", id="row-2",
                     valid_to=TODAY - timedelta(days=1)),
            make_row(holder_name="Elsewhere", id="row-3",
                     valid_to=TODAY + timedelta(days=100),
                     custody_status="with_client"),
            make_row(holder_name="Killed", id="row-4",
                     valid_to=TODAY + timedelta(days=100),
                     revoked_on=TODAY),
            make_row(holder_name="Early", id="row-5",
                     valid_from=TODAY + timedelta(days=5),
                     valid_to=TODAY + timedelta(days=400)),
        ])

        rows = await dsc.unusable(pool, ORG, as_of=TODAY)
        assert set(names(rows)) == {"Dead", "Elsewhere", "Killed", "Early"}
        by_name = {r["holder_name"]: r["status"] for r in rows}
        assert by_name == {
            "Dead": dsc.EXPIRED,
            "Elsewhere": dsc.NOT_IN_POSSESSION,
            "Killed": dsc.REVOKED,
            "Early": dsc.NOT_YET_VALID,
        }

    def test_never_held_and_with_client_are_different_facts(self):
        """Both block a filing; only one of them is a token we ever had. A
        boolean would have thrown that away, and "please return our token" to a
        client who never received one is the email that follows."""
        allowed = _migration_check_values("custody_status")
        assert {"with_client", "never_held", "lost", "destroyed",
                "surrendered", "in_transit", "with_firm"} <= allowed

    def test_only_with_firm_counts_as_possession(self):
        """A whitelist, so a custody state added to 160 later defaults to
        'we cannot use it' — the safe direction to be wrong in."""
        assert dsc._CUSTODY_USABLE == frozenset({"with_firm"})
        for state in _migration_check_values("custody_status") - {"with_firm"}:
            row = make_row(custody_status=state,
                           valid_to=TODAY + timedelta(days=100))
            assert dsc.status_of(row, TODAY) == dsc.NOT_IN_POSSESSION, state


# ── status precedence ───────────────────────────────────────────────────────

class TestStatus:

    def test_revocation_takes_effect_on_the_day_not_the_day_after(self):
        """X.509 revocationDate is the instant the certificate stops being
        trusted. Off by one here and a compromised key is reported as usable for
        the whole of the day it was revoked."""
        row = make_row(valid_to=TODAY + timedelta(days=100), revoked_on=TODAY)
        assert dsc.status_of(row, TODAY) == dsc.REVOKED
        assert dsc.status_of(row, TODAY - timedelta(days=1)) == dsc.USABLE

    def test_revoked_outranks_expired_which_outranks_custody(self):
        """Order of deadness. Sending someone to fetch a token whose
        certificate expired in March wastes the trip."""
        both = make_row(valid_to=TODAY - timedelta(days=10),
                        revoked_on=TODAY - timedelta(days=20),
                        custody_status="with_client")
        assert dsc.status_of(both, TODAY) == dsc.REVOKED

        expired_and_gone = make_row(valid_to=TODAY - timedelta(days=10),
                                    custody_status="with_client")
        assert dsc.status_of(expired_and_gone, TODAY) == dsc.EXPIRED

    def test_a_renewal_bought_early_is_not_usable_and_is_not_an_error(self):
        row = make_row(valid_from=TODAY + timedelta(days=3),
                       valid_to=TODAY + timedelta(days=1000))
        assert dsc.status_of(row, TODAY) == dsc.NOT_YET_VALID


# ── names, not ids ──────────────────────────────────────────────────────────

class TestRowsCarryNames:

    @pytest.mark.asyncio
    async def test_no_org_or_client_uuid_leaves_this_module(self):
        pool = FakePool([make_row()])
        row = (await dsc.register(pool, ORG, as_of=TODAY))[0]

        assert "org_id" not in row
        assert "client_id" not in row
        assert row["client_name"] == "Mehta Trading Co LLP"
        assert row["holder_name"] == "Rakesh Mehta"
        # Removed, not merely unrendered: a router that serialises the dict
        # wholesale cannot put a uuid on a screen if the key is not there.
        assert ORG not in repr(row)
        assert CLIENT_A not in repr(row)

    @pytest.mark.asyncio
    async def test_the_firms_own_certificate_is_labelled_as_such(self):
        """`client_id IS NULL` means the practice's own partner DSC, not a row
        with a missing client."""
        pool = FakePool([
            make_row(holder_name="Senior Partner", client_id=None,
                     client_name=None, id="row-1"),
            make_row(holder_name="Rakesh Mehta", id="row-2"),
        ])
        rows = await dsc.register(pool, ORG, as_of=TODAY)
        by_name = {r["holder_name"]: r["belongs_to_firm"] for r in rows}
        assert by_name == {"Senior Partner": True, "Rakesh Mehta": False}

    @pytest.mark.asyncio
    async def test_belongs_to_firm_is_not_inferred_from_a_missing_name(self):
        """A client_id whose org-scoped join found nothing must stay visibly
        nameless, not be relabelled as one of the firm's own certificates."""
        pool = FakePool([make_row(client_id=CLIENT_B, client_name=None)])
        row = (await dsc.register(pool, ORG, as_of=TODAY))[0]
        assert row["client_name"] is None
        assert row["belongs_to_firm"] is False


# ── the per-client view ─────────────────────────────────────────────────────

class TestPerClient:

    @pytest.mark.asyncio
    async def test_for_client_returns_only_that_company(self):
        pool = FakePool([
            make_row(holder_name="Mehta A", client_id=CLIENT_A, id="row-1"),
            make_row(holder_name="Mehta B", client_id=CLIENT_A, id="row-2",
                     certificate_type="encryption",
                     valid_to=TODAY + timedelta(days=5)),
            make_row(holder_name="Patel", client_id=CLIENT_B, id="row-3",
                     client_name="Patel Exports & Sons"),
        ])
        rows = await dsc.for_client(pool, ORG, CLIENT_A, as_of=TODAY)
        assert names(rows) == ["Mehta B", "Mehta A"], "soonest expiry first"

    @pytest.mark.asyncio
    async def test_client_id_none_means_the_firms_own_not_everybodys(self):
        """The natural misreading, and the one that returns nothing at all in
        SQL because `client_id = NULL` is never true. Hence IS NOT DISTINCT
        FROM in the statement, asserted here and below."""
        pool = FakePool([
            make_row(holder_name="Own", client_id=None, client_name=None,
                     id="row-1"),
            make_row(holder_name="Client", client_id=CLIENT_A, id="row-2"),
        ])
        rows = await dsc.for_client(pool, ORG, None, as_of=TODAY)
        assert names(rows) == ["Own"]

    def test_the_statement_uses_is_not_distinct_from(self):
        assert "d.client_id IS NOT DISTINCT FROM $3::uuid" in dsc._Q_FOR_CLIENT

    @pytest.mark.asyncio
    async def test_retired_rows_appear_only_when_asked_for(self):
        pool = FakePool([
            make_row(holder_name="Current", id="row-1"),
            make_row(holder_name="Retired", id="row-2", is_active=False,
                     valid_to=TODAY + timedelta(days=1)),
        ])
        assert names(await dsc.for_client(pool, ORG, CLIENT_A, as_of=TODAY)) == [
            "Current"
        ]
        assert set(names(await dsc.for_client(
            pool, ORG, CLIENT_A, as_of=TODAY, include_inactive=True
        ))) == {"Current", "Retired"}


# ── arguments ───────────────────────────────────────────────────────────────

class TestArguments:

    @pytest.mark.asyncio
    async def test_as_of_has_no_default(self):
        """A cron at 23:55 IST in a UTC container defaults to yesterday and
        sends every alert a day late, which is to say after it was any use."""
        pool = FakePool([])
        with pytest.raises(TypeError):
            await dsc.expiring_within(pool, ORG, days=30)

    @pytest.mark.asyncio
    async def test_as_of_must_be_a_date(self):
        pool = FakePool([])
        with pytest.raises(CustodyError):
            await dsc.expiring_within(pool, ORG, days=30, as_of="2026-08-19")

    @pytest.mark.asyncio
    async def test_a_datetime_is_narrowed_not_rejected(self):
        """datetime is a subclass of date, so the naive isinstance check accepts
        one and then subtracts a date from it three frames away."""
        pool = FakePool([make_row(valid_to=TODAY, id="row-1")])
        rows = await dsc.expiring_within(
            pool, ORG, days=0, as_of=datetime(2026, 8, 19, 23, 55)
        )
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_a_negative_window_is_refused_not_clamped(self):
        """`expiring_within(-30)` is somebody reaching for 'expired in the last
        30 days'. Clamped to 0 it answers a different question, plausibly."""
        pool = FakePool([])
        with pytest.raises(CustodyError):
            await dsc.expiring_within(pool, ORG, days=-30, as_of=TODAY)

    @pytest.mark.asyncio
    async def test_a_missing_org_is_refused(self):
        pool = FakePool([])
        with pytest.raises(CustodyError):
            await dsc.register(pool, None, as_of=TODAY)

    @pytest.mark.asyncio
    async def test_days_must_be_a_whole_number(self):
        pool = FakePool([])
        for bad in (30.0, "30", True):
            with pytest.raises(CustodyError):
                await dsc.expiring_within(pool, ORG, days=bad, as_of=TODAY)


# ── advisory only: nothing here blocks ──────────────────────────────────────

class TestWarningsNeverBlock:

    @pytest.mark.asyncio
    async def test_an_implausible_validity_span_warns_and_still_returns(self):
        """2027 typed as 2037. The CCA sells at most three years, but this house
        does not block data entry on a statutory nicety — a rejection just gets
        worked around by typing a date that is wrong in a way nothing notices.
        """
        pool = FakePool([
            make_row(valid_from=date(2024, 8, 19), valid_to=date(2037, 8, 18),
                     id="row-1"),
        ])
        row = (await dsc.register(pool, ORG, as_of=TODAY))[0]
        assert any("three years" in w for w in row["warnings"])
        assert row["status"] == dsc.USABLE, "warned about, not withheld"

    @pytest.mark.asyncio
    async def test_a_missing_pan_is_not_a_warning_and_not_an_error(self):
        """GSTIN / PAN / TAN are non-mandatory in this product and block
        nothing. This has been reintroduced as a 'fix' more than once."""
        pool = FakePool([make_row(holder_pan=None, holder_din=None)])
        row = (await dsc.register(pool, ORG, as_of=TODAY))[0]
        assert not any("pan" in w.lower() for w in row["warnings"])

    def test_a_lost_token_with_a_live_certificate_is_flagged(self):
        """Not a filing problem — a security one. A lost token whose certificate
        is still live can sign, and not by us."""
        row = make_row(custody_status="lost",
                       valid_to=TODAY + timedelta(days=200))
        assert any("lost" in w for w in dsc.warnings_for(row, TODAY))


# ── certifying authorities ──────────────────────────────────────────────────

class TestAuthorities:

    def test_the_spelling_is_canonicalised(self):
        """One CA, sorted into four groups, is a register nobody trusts."""
        for typed in ("emudhra", "e-Mudhra", "E MUDHRA", "eMudhra Limited"):
            assert dsc.canonical_authority(typed) == "e-Mudhra", typed
        assert dsc.canonical_authority("(n)Code Solutions") == "(n)Code Solutions"
        assert dsc.canonical_authority("nCode") == "(n)Code Solutions"
        assert dsc.canonical_authority("NSDL e-Gov") == "Protean"

    def test_an_unknown_authority_is_kept_exactly_as_typed(self):
        """A CA whose licence lapses does not un-issue the certificates in the
        drawer, and a register that refuses to record them is worse than one
        that spells a name oddly."""
        assert dsc.canonical_authority("Some Regional CA") == "Some Regional CA"
        assert dsc.canonical_authority("   ") is None
        assert dsc.canonical_authority(None) is None

    def test_the_migration_puts_no_check_on_the_authority(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "CHECK (issuing_authority" not in sql
        assert "issuing_authority IN (" not in sql


# ── summarising ─────────────────────────────────────────────────────────────

class TestSummarise:

    def test_every_status_key_is_present_even_at_zero(self):
        """A dashboard that renders only the keys it was given shows nothing
        where '0 expired' is the reassuring thing the reader came for — and an
        absent key is indistinguishable from a query that failed."""
        out = dsc.summarise([])
        assert out == {
            dsc.USABLE: 0, dsc.NOT_IN_POSSESSION: 0, dsc.NOT_YET_VALID: 0,
            dsc.EXPIRED: 0, dsc.REVOKED: 0, "total": 0,
        }

    @pytest.mark.asyncio
    async def test_it_counts_shaped_rows(self):
        pool = FakePool([
            make_row(holder_name="A", id="row-1"),
            make_row(holder_name="B", id="row-2",
                     valid_to=TODAY - timedelta(days=1)),
            make_row(holder_name="C", id="row-3", custody_status="never_held"),
        ])
        out = dsc.summarise(await dsc.register(pool, ORG, as_of=TODAY))
        assert out[dsc.USABLE] == 1
        assert out[dsc.EXPIRED] == 1
        assert out[dsc.NOT_IN_POSSESSION] == 1
        assert out["total"] == 3


# ── the migration, by shape ─────────────────────────────────────────────────

def _statements():
    return [
        (name, getattr(dsc, name))
        for name in dir(dsc)
        if name.startswith("_Q_")
    ]


def _migration_check_values(column: str) -> set[str]:
    """The literal values a CHECK on `column` allows, read off the migration.

    Read from the file rather than restated here: a test that carried its own
    copy of the list would agree with itself while the migration drifted.
    """
    sql = MIGRATION.read_text(encoding="utf-8")
    found = re.search(
        re.escape(column) + r".*?CHECK\s*\(\s*" + re.escape(column)
        + r"\s+IN\s*\((.*?)\)\s*\)",
        sql,
        re.S,
    )
    assert found, f"no CHECK ... IN (...) for {column!r} in the migration"
    return set(re.findall(r"'([a-z0-9_]+)'", found.group(1)))


class TestTheMigration:

    def test_it_creates_exactly_one_table_and_alters_nothing(self):
        """The header claims this. A migration whose header lies about what it
        touches is how a shared database gets damaged."""
        sql = MIGRATION.read_text(encoding="utf-8")
        body = "\n".join(
            line for line in sql.splitlines() if not line.strip().startswith("--")
        )
        assert body.count("CREATE TABLE") == 1
        assert "ALTER TABLE" not in body
        assert "DROP TABLE" not in body
        assert "DELETE FROM" not in body
        # `UPDATE staging.` and not a bare `UPDATE `: the trigger is declared
        # BEFORE UPDATE ON, and a naive substring check flags that as a write.
        assert "UPDATE staging." not in body
        # No seed. A DSC register with invented rows would be trusted.
        assert "INSERT INTO" not in body

    def test_it_is_idempotent(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "CREATE TABLE IF NOT EXISTS staging.dsc_register" in sql
        for idx in ("dsc_register_org_expiry_idx", "dsc_register_org_client_idx",
                    "dsc_register_org_custody_idx", "dsc_register_serial_uniq"):
            assert f"IF NOT EXISTS {idx}" in sql, idx
        assert "DROP TRIGGER IF EXISTS trg_touch_dsc_register" in sql

    def test_every_relation_is_schema_qualified(self):
        """A shadow table in `public` has bitten this repo before (142), and
        search_path on this database does not include `staging`."""
        # Comment lines are stripped first: the header states in words that
        # `public.dsc_register` was checked and found absent, and a check run
        # over the prose would read that sentence as a reference to a table in
        # the wrong schema.
        sql = "\n".join(
            line for line in MIGRATION.read_text(encoding="utf-8").splitlines()
            if not line.strip().startswith("--")
        )
        for ref in ("dsc_register", "graha_clients", "organisations",
                    "touch_updated_at"):
            # The lookbehind is what keeps this from firing on `trg_touch_
            # dsc_register` and on the index and constraint names, which embed
            # the table name and are not references to it.
            for hit in re.finditer(r"(?<![\w.])(\w+\.)?" + ref + r"\b", sql):
                prefix = hit.group(1)
                assert prefix == "staging.", (
                    f"{ref} referenced as {(prefix or '') + ref!r} — "
                    "unqualified resolves to nothing (search_path has no "
                    "`staging`) and a shadow table in `public` has bitten this "
                    "repo before (142)"
                )

    def test_class_2_is_allowed(self):
        """CCA guidelines of 26 Nov 2020 withdrew Class 2 ISSUANCE from
        1 Jan 2021; certificates issued before then stayed valid to their own
        expiry. A legacy register entry for one is real data, and rejecting it
        would make the product wrong about history in the name of being
        current — the same mistake as 'cleaning' users.role."""
        allowed = _migration_check_values("certificate_class")
        assert "class_2" in allowed
        assert "class_3" in allowed
        assert "unknown" in allowed, (
            "a firm entering forty tokens will not know the class of all forty; "
            "forcing a guess puts a fabricated fact in a compliance record"
        )

    def test_signature_and_encryption_are_separate_types(self):
        """The CCA requires them to be separate certificates for an individual
        (cca.gov.in/faq.html). A firm that recorded 'one DSC' and needs the
        encryption certificate on filing day has the same bad morning."""
        allowed = _migration_check_values("certificate_type")
        assert {"signature", "encryption"} <= allowed

    def test_there_is_no_pin_column_and_never_may_be(self):
        """A DSC token PIN is the whole of the security of the private key it
        guards. A column for it turns one compromised database read into the
        ability to sign as forty taxpayers. A 'hint' field is a password with a
        worse threat model, because it gets typed by people who believe it is
        not one."""
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        body = "\n".join(
            line for line in sql.splitlines() if not line.strip().startswith("--")
        )
        # THE TOKEN IS MATCHED ANYWHERE IN THE COLUMN NAME, not only at its
        # start. The earlier form anchored it with `^\s*{forbidden}\w*`, which
        # caught a column called `pin` and let `token_pin TEXT`,
        # `dsc_password TEXT` and `holder_secret TEXT` straight through —
        # verified by adding all three and watching this test stay green. That
        # was the whole guard failing open against the only names anyone would
        # realistically choose: this table already has `token_kind` and
        # `token_serial`, so `token_pin` is the name the next person types.
        #
        # `(\w+_)?x(_\w+)?` matches the token as a whole snake_case segment, so
        # `token_pin`, `pin_hint` and `signing_passphrase` all trip it while an
        # innocent column that merely contains the letters (a hypothetical
        # `shipping_address`) does not. bytea is in the type list because an
        # "encrypted" PIN is still a PIN — storing the ciphertext beside the
        # register that says which client it belongs to is the same disaster
        # with an extra step.
        for forbidden in ("pin", "password", "passphrase", "secret"):
            assert not re.search(
                rf"^\s*(\w+_)?{forbidden}(_\w+)?\s+(text|varchar|char|bytea)",
                body, re.M), forbidden

    def test_pan_and_din_are_nullable_and_unconstrained(self):
        """GSTIN / PAN / TAN are non-mandatory and must block nothing. This has
        drifted back more than once; do not 'fix' it."""
        sql = MIGRATION.read_text(encoding="utf-8")
        assert re.search(r"^\s*holder_pan TEXT,\s*$", sql, re.M)
        assert re.search(r"^\s*holder_din TEXT,\s*$", sql, re.M)
        assert "holder_pan TEXT NOT NULL" not in sql
        assert "CHECK (holder_pan" not in sql

    def test_there_is_no_ceiling_on_the_validity_span(self):
        """Three years is what a CA will sell, not a rule about what a register
        may record. The service warns; the database does not refuse."""
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "valid_from + INTERVAL" not in sql
        assert re.search(r"CHECK \(valid_to >= valid_from\)", sql)

    def test_the_expiry_index_exists_and_is_org_first(self):
        """Every query narrows by org before anything else; an index that led
        with the date would be scanned across tenants."""
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "ON staging.dsc_register (org_id, valid_to)" in sql

    def test_the_serial_uniqueness_treats_nulls_as_equal(self):
        """Under the default NULLS DISTINCT, two rows with the same serial and
        no CA name would both be allowed — which is exactly what a firm typing
        serials without CA names produces."""
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "NULLS NOT DISTINCT" in sql

    def test_the_client_fk_points_at_the_company_record(self):
        """graha_clients is THE company (136). A DSC outlives the contact who
        emailed about it."""
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "REFERENCES staging.graha_clients(id)" in sql
        assert "REFERENCES staging.graha_contacts" not in sql
