"""PIN -> territory -> rep: the two rules, and the five statements.

`services/territory_routing.py` is the first consumer `rules->'pincodes'` has
ever had. Before it, `grep -rn "pincodes" --include=*.py backend/` returned one
line and it was a `print` inside a script — **territories routed nothing**, and
`POST /territories/{id}/assign-next` had zero callers anywhere in the repo.

Three halves, and the separation is deliberate.

  1. THE RULES, offline and pure. `normalise_pin`, `_pincodes_of` and
     `territories_for_pin` touch nothing, so they are testable exactly and are
     where every routing decision actually gets made.

  2. THE BEHAVIOUR, against a recording connection. Not a MagicMock: this one
     records every statement and its bound arguments and answers from a script,
     so a test can assert what was NOT asked as well as what was — which is the
     only way to prove the round-robin's turn is not burned on a contact that
     already has an owner.

  3. THE SCHEMA, live. `asyncpg.Connection.prepare()` sends Parse and Describe
     and STOPS: the server plans the statement, resolves every relation, column
     and parameter type and returns the shapes. It does not execute, does not
     read a row and does not write one. That distinction is the whole safety
     story, because staging shares its database with production (CLAUDE.md).

── WHY THIS FILE DOES NOT MENTION THE CRM ROUTER BY ITS IMPORT PATH ─────────

`tests/test_every_writer_has_a_live_sql_test.py` marks a router "covered" when
ANY test file both PREPAREs a statement and names that router. This file
prepares statements, and the CRM router is baselined in that file's `UNCOVERED`
list with thirty-odd write paths this file proves nothing about. Importing it
here would delete it from the baseline on a technicality and quietly retire a
guarantee over `create_deal`, `update_deal`, the merge paths and the rest.

So the router-side assertions for Phase 7.1 — the hook position, the backfill
route, the three cross-tenant joins — live in `tests/test_territories.py`
instead, which names the router and prepares nothing. The SQL under test here
is defined in the SERVICE, on purpose, and that is what is prepared.
"""
import asyncio
import os

import pytest

from services import territory_routing as tr
from services.territory_routing import (
    NO_MEMBERS,
    NO_TERRITORY,
    Territory,
    normalise_pin,
    pin_for_row,
    territories_for_pin,
)


ORG = "11111111-1111-1111-1111-111111111111"
CONTACT = "22222222-2222-2222-2222-222222222222"
TERRITORY = "33333333-3333-3333-3333-333333333333"
OTHER_TERRITORY = "44444444-4444-4444-4444-444444444444"

# Values, never sources. No statement built with them is ever executed.
SURAT = "395002"
MUMBAI = "400001"


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The rules — pure, and where every decision is made
# ══════════════════════════════════════════════════════════════════════════════

def test_a_pin_never_starts_with_zero():
    """The first digit is the postal REGION, numbered 1-8 (9 is Army Post
    Office). `012345` is not a PIN that exists — it is a truncated something
    else, and accepting it would route a contact into a real territory on the
    strength of a typo."""
    assert normalise_pin("012345") == ""
    assert normalise_pin("000000") == ""
    for first in "12345678":
        assert normalise_pin(first + "00001") == first + "00001"


def test_only_six_digits_is_a_pin():
    assert normalise_pin("40001") == ""       # five
    assert normalise_pin("4000012") == ""     # seven
    assert normalise_pin("40000a") == ""
    assert normalise_pin("400 001") == ""


def test_it_answers_for_everything_an_address_field_can_hold():
    """Total by design — everything upstream of it is user-typed address text,
    and the standing rule is that a bad PIN blocks nothing."""
    assert normalise_pin(None) == ""
    assert normalise_pin("") == ""
    assert normalise_pin("   ") == ""
    assert normalise_pin({}) == ""
    # A PIN typed into a numeric field arrives as an int.
    assert normalise_pin(400001) == "400001"
    # Surrounding whitespace from a pasted address line, trailing newline and all.
    assert normalise_pin("  395002  ") == "395002"
    assert normalise_pin("400001\n") == "400001"
    # But not a newline INSIDE it — `$` in Python matches before a trailing
    # newline, so `match()` would have let this through.
    assert normalise_pin("4000\n01") == ""


def test_a_uk_postcode_is_not_a_pin():
    """Unicode Group's client `INC UK` really does carry
    `address->>'pincode' = 'NW1 245'`. It is a legitimate thing for a customer
    to have, and it must route nowhere rather than raise."""
    assert normalise_pin("NW1 245") == ""


def test_a_pincodes_list_saved_as_a_string_does_not_take_the_org_down():
    """THE TRAP THIS MODULE EXISTS TO SIDESTEP, verified against the live
    database on 2026-08-27:

        SELECT p FROM jsonb_array_elements_text(('{"pincodes": "400001"}')->'pincodes')
        -> InvalidParameterValueError: cannot extract elements from a scalar

    `TerritoryCreate.rules` is a bare `dict`, so the product accepts any JSON
    under `pincodes` — and a string is exactly what somebody types when a
    territory has one PIN. Matching in SQL is the obvious shape and one such
    territory would have 500'd the routing of every contact in the org.
    """
    assert tr._pincodes_of({"pincodes": "400001"}) == frozenset()
    assert tr._pincodes_of({"pincodes": {"a": 1}}) == frozenset()
    assert tr._pincodes_of({}) == frozenset()
    assert tr._pincodes_of(None) == frozenset()
    # 15 of the 18 live territories have no `pincodes` key at all; three have
    # an empty array. Both answer the empty set.
    assert tr._pincodes_of({"pincodes": []}) == frozenset()


def test_pins_saved_as_json_numbers_still_match():
    """`{"pincodes": [400001]}` is a shape the product will store — confirmed
    live. Every element goes through `normalise_pin`, which stringifies."""
    assert tr._pincodes_of({"pincodes": [400001, "395002"]}) == {"400001", "395002"}


def test_junk_in_the_pin_list_is_dropped_not_raised():
    assert tr._pincodes_of({"pincodes": ["400001", "", None, "NW1 245", "012345"]}) \
        == {"400001"}


def test_rules_are_read_whether_the_connection_decodes_jsonb_or_not():
    """`db.py` registers a jsonb codec so a pooled connection decodes to a
    dict; a bare `asyncpg.connect()` — the live test below, and every
    `railway run` script — hands back the raw str."""
    assert tr._pincodes_of('{"pincodes": ["400001"]}') == {"400001"}
    assert tr._pincodes_of("not json at all") == frozenset()


def test_priority_is_an_integer_or_it_is_absent():
    assert tr._priority_of({"priority": 1}) == 1
    assert tr._priority_of({"priority": "2"}) == 2
    assert tr._priority_of({}) is None
    assert tr._priority_of({"priority": "high"}) is None
    # bool is an int subclass in Python and is not a priority.
    assert tr._priority_of({"priority": True}) is None


def _t(name, pins, priority=None, tid=None):
    return Territory(id=tid or TERRITORY, name=name, priority=priority,
                     pincodes=frozenset(pins))


def test_a_pin_no_territory_claims_matches_nothing_and_raises_nothing():
    """The standing rule, at the lowest level it can be asserted: same as
    GSTIN/PAN/TAN, an unmatched PIN blocks nothing."""
    assert territories_for_pin([_t("Gujarat", [SURAT])], MUMBAI) == []
    assert territories_for_pin([], SURAT) == []
    assert territories_for_pin([_t("Gujarat", [SURAT])], "NW1 245") == []


def test_an_overlap_is_resolved_by_priority_lowest_first():
    """Open question 1 in PHASE-7 is the OWNER's and is unanswered; zero
    overlaps exist today. What this must not be is arbitrary — two runs over
    the same data have to route a contact the same way, or the first support
    ticket is unanswerable."""
    hits = territories_for_pin([
        _t("West India", [MUMBAI], priority=5, tid=OTHER_TERRITORY),
        _t("Mumbai Metro", [MUMBAI], priority=1),
    ], MUMBAI)
    assert [h.name for h in hits] == ["Mumbai Metro", "West India"]


def test_a_territory_that_asked_for_no_priority_loses_to_one_that_did():
    hits = territories_for_pin([
        _t("Everything Else", [MUMBAI], tid=OTHER_TERRITORY),
        _t("Mumbai Metro", [MUMBAI], priority=9),
    ], MUMBAI)
    assert [h.name for h in hits] == ["Mumbai Metro", "Everything Else"]


def test_two_unprioritised_territories_are_ordered_by_name_not_by_luck():
    hits = territories_for_pin([
        _t("Zone B", [MUMBAI], tid=OTHER_TERRITORY),
        _t("Zone A", [MUMBAI]),
    ], MUMBAI)
    assert [h.name for h in hits] == ["Zone A", "Zone B"]


def test_the_ladder_is_billing_then_shipping_then_the_client():
    row = {"billing": SURAT, "shipping": MUMBAI, "client": "110001"}
    assert pin_for_row(row) == (SURAT, "billing")
    assert pin_for_row({**row, "billing": None}) == (MUMBAI, "shipping")
    assert pin_for_row({**row, "billing": None, "shipping": ""}) == ("110001", "client")
    assert pin_for_row({"billing": None, "shipping": None, "client": None}) == ("", "")


def test_the_ladder_falls_through_a_rung_that_is_present_but_not_a_pin():
    """`INC UK`'s `NW1 245` is one join away in the live database. Treating a
    rung as "answered" because it is non-empty would stop the ladder dead on a
    value that can never match a territory."""
    assert pin_for_row({"billing": "NW1 245", "shipping": SURAT, "client": None}) \
        == (SURAT, "shipping")


# ══════════════════════════════════════════════════════════════════════════════
#  2 · The behaviour — a recording connection, not a mock
# ══════════════════════════════════════════════════════════════════════════════

class RecordingConn:
    """Records every statement and its bound arguments; answers from a script.

    A MagicMock would let a test assert what WAS asked. The interesting
    guarantees here are about what is NOT asked — the round-robin must not be
    consulted for a contact that already has an owner, because consulting it
    ADVANCES the counter and quietly skews the fairness it exists to provide.
    """

    def __init__(self, script: dict, fail_on: str = ""):
        self.script = script
        self.fail_on = fail_on
        self.calls: list[tuple[str, tuple]] = []

    def _answer(self, sql, args):
        self.calls.append((sql, args))
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError("the database said no")
        for key, value in self.script.items():
            if key in sql:
                return value
        return None

    async def fetchrow(self, sql, *args):
        return self._answer(sql, args)

    async def fetch(self, sql, *args):
        return self._answer(sql, args) or []

    async def execute(self, sql, *args):
        self._answer(sql, args)
        return "UPDATE 1"

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return _Tx()

    def issued(self, fragment: str) -> int:
        return sum(1 for sql, _ in self.calls if fragment in sql)


def _ladder_row(**over):
    row = {"contact_id": CONTACT, "territory_id": None, "assigned_to": None,
           "billing": SURAT, "shipping": None, "client": None}
    row.update(over)
    return row


def _gujarat(pins=(SURAT,), rules=None):
    return [{"id": TERRITORY, "name": "Gujarat",
             "rules": rules if rules is not None else {"pincodes": list(pins)}}]


async def test_a_contact_is_filed_and_the_next_rep_takes_it():
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(),
        "FROM staging.graha_territories t": _gujarat(),
        "SELECT assigned_users": {"assigned_users": ["user_a", "user_b"],
                                  "round_robin_index": 0},
        "UPDATE staging.graha_contacts": {"id": CONTACT},
    })
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out["routed"] is True
    assert out["pin"] == SURAT and out["pin_source"] == "billing"
    assert out["territory_name"] == "Gujarat"
    assert out["assigned_to"] == "user_a"
    assert out["error"] == ""
    # The counter moved on, once.
    assert conn.issued("SET round_robin_index") == 1


async def test_the_round_robin_turn_is_not_burned_on_a_contact_that_has_an_owner():
    """Asking whose turn it is ADVANCES the counter. Doing that for somebody
    who already has a rep would hand the NEXT lead to the person after them —
    the fairness the round-robin exists to provide, skewed by contacts it never
    touched. Open question 2 in PHASE-7 is the owner's; "rep only when
    unassigned" is the half that cannot destroy work."""
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(assigned_to="user_z"),
        "FROM staging.graha_territories t": _gujarat(),
        "UPDATE staging.graha_contacts": {"id": CONTACT},
    })
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out["routed"] is True
    assert out["territory_name"] == "Gujarat"
    assert out["assigned_to"] == ""
    assert conn.issued("SELECT assigned_users") == 0
    assert conn.issued("SET round_robin_index") == 0


async def test_the_write_itself_refuses_to_overwrite_an_owner():
    """Belt and braces, and they guard different things: the Python decides
    whether to CONSUME a turn, the SQL decides whether to overwrite an owner.
    Without the second, an edit landing between the read and the write loses
    the owner it just set."""
    assert "COALESCE(NULLIF(assigned_to, ''), NULLIF($4,''))" in tr._ROUTE_WRITE


async def test_a_territory_a_person_already_chose_is_never_overwritten():
    """7.0 put a territory picker on the create form, and the backfill runs
    over rows a person may have filed by hand months ago. Routing fills a
    blank; it never argues with an answer."""
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(territory_id=OTHER_TERRITORY),
    })
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out["kept"] is True and out["routed"] is False
    assert conn.issued("UPDATE staging.graha_contacts") == 0
    assert conn.issued("FROM staging.graha_territories t") == 0


async def test_a_pin_in_no_territory_assigns_nothing_and_refuses_nothing():
    """THE RULE THAT KEEPS REGRESSING. On the day 7.1 shipped this was the
    outcome for all 41 routable contacts in Unicode Group, because no live
    territory carried a single PIN."""
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(billing=MUMBAI),
        "FROM staging.graha_territories t": _gujarat(),
    })
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out["routed"] is False and out["error"] == ""
    assert out["pin"] == MUMBAI          # it was READ, and simply matched nothing
    assert out["territory_name"] == ""
    assert conn.issued("UPDATE staging.graha_contacts") == 0


async def test_a_contact_with_no_pin_anywhere_is_left_alone():
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(billing=None),
    })
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out == {**out, "routed": False, "pin": "", "pin_source": ""}
    assert conn.issued("FROM staging.graha_territories t") == 0
    assert conn.issued("UPDATE staging.graha_contacts") == 0


async def test_a_territory_whose_pin_list_is_a_string_does_not_stop_the_others():
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(),
        "FROM staging.graha_territories t": [
            {"id": OTHER_TERRITORY, "name": "Broken", "rules": {"pincodes": SURAT}},
            {"id": TERRITORY, "name": "Gujarat", "rules": {"pincodes": [SURAT]}},
        ],
        "SELECT assigned_users": {"assigned_users": [], "round_robin_index": 0},
        "UPDATE staging.graha_contacts": {"id": CONTACT},
    })
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out["territory_name"] == "Gujarat"
    assert out["error"] == ""


async def test_routing_can_never_cost_the_caller_its_contact():
    """The hook sits INSIDE `create_contact`'s transaction, between the INSERT
    and the event. A routing bug that propagates rolls back a contact the
    customer typed — so it does not propagate. `conn.transaction()` nested
    inside an open one is a SAVEPOINT, which is the only thing that makes
    swallowing a database error honest: Postgres aborts the whole transaction
    on the first error, so without the savepoint the swallow would take the
    event down with it."""
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(),
    }, fail_on="FROM staging.graha_territories t")
    out = await tr.route_contact(conn, ORG, CONTACT)
    assert out["routed"] is False
    assert out["error"] == "RuntimeError"


async def test_the_savepoint_is_what_makes_that_swallow_honest():
    import inspect
    code = inspect.getsource(tr.route_contact)
    assert "conn.transaction()" in code, (
        "route_contact swallows database errors without a savepoint — the "
        "caller's transaction is already aborted by then and contact_created "
        "will fail with InFailedSQLTransaction"
    )


async def test_the_round_robin_walks_and_wraps():
    for index, expected in ((0, "user_a"), (1, "user_b"), (2, "user_a"), (7, "user_b")):
        conn = RecordingConn({
            "SELECT assigned_users": {"assigned_users": ["user_a", "user_b"],
                                      "round_robin_index": index},
        })
        turn = await tr.assign_next_user(conn, ORG, TERRITORY)
        assert turn["user"] == expected and turn["reason"] == ""


async def test_the_round_robin_names_its_two_failures_rather_than_raising():
    """The manual button turns these into a 404 and a 400; routing must do
    neither. One implementation, two callers, opposite needs."""
    conn = RecordingConn({})
    assert (await tr.assign_next_user(conn, ORG, TERRITORY))["reason"] == NO_TERRITORY
    conn = RecordingConn({"SELECT assigned_users": {"assigned_users": [],
                                                    "round_robin_index": 0}})
    assert (await tr.assign_next_user(conn, ORG, TERRITORY))["reason"] == NO_MEMBERS


async def test_the_round_robin_read_and_its_write_are_both_org_scoped():
    """`graha_territories.id` is unique table-wide. A counter advanced on `id`
    alone is a write into another organisation's row."""
    for sql in (tr._ROUND_ROBIN_READ, tr._ROUND_ROBIN_ADVANCE):
        assert "org_id" in sql
    assert "is_active = TRUE" in tr._ROUND_ROBIN_READ, (
        "DELETE /territories/{id} is a SOFT delete — without this a deleted "
        "territory keeps handing out leads"
    )


def test_every_statement_this_module_issues_is_org_scoped():
    """Not one of them may be reachable without an org predicate. This is the
    module that puts a value in `graha_contacts.territory_id`, and every
    downstream join reads it back to render a territory NAME."""
    for name, sql in _sql_constants().items():
        assert "org_id" in sql, f"{name} has no org predicate"


def test_the_client_rung_joins_on_the_org_as_well_as_the_id():
    """`graha_clients` has no composite (id, org_id) constraint — the
    `graha_clients` join leak, again. Without `cl.org_id = c.org_id` the ladder
    reads another organisation's address and routes this org's contact on it."""
    assert "ON cl.id = c.client_id AND cl.org_id = c.org_id" in tr.PIN_LADDER_SELECT


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The live half — the only thing a mock connection cannot prove
# ══════════════════════════════════════════════════════════════════════════════

#: The DSN `tests/conftest.py` sets so importing the app does not explode. It
#: points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL`
#: is never absent.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What `db.py` sets on every connection, matched so a statement is planned the
#: way it will actually be planned.
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the routing SQL against the real "
    "catalogue and cannot be done offline — a mock connection answers happily "
    "to a statement naming a column that does not exist, which is exactly how "
    "`gst_rate` survived in the billing router until it had never once "
    "succeeded. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_territory_routing.py -q"
)


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _sql_constants() -> dict:
    """Every module-level statement in the service, found by reading the module.

    Enumerated rather than listed, so a statement added later cannot skip the
    live check by not being written down here — which is precisely how an
    untested writer gets in.
    """
    return {name: value for name, value in vars(tr).items()
            if isinstance(value, str) and "staging." in value}


def _captured_calls() -> list[tuple[str, tuple]]:
    """(sql, args) for every statement a full route issues, driven offline.

    The bind COUNT is the point. A statement whose placeholders were renumbered
    by hand is exactly where an off-by-one lands, and Postgres is the only
    honest witness to how many it declares.
    """
    conn = RecordingConn({
        "c.billing_address->>'pincode'": _ladder_row(),
        "FROM staging.graha_territories t": _gujarat(),
        "SELECT assigned_users": {"assigned_users": ["user_a"],
                                  "round_robin_index": 0},
        "UPDATE staging.graha_contacts": {"id": CONTACT},
    })
    asyncio.run(tr.route_contact(conn, ORG, CONTACT))
    return conn.calls


def _describe():
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` returns a handle; no `fetch`, `execute` or `fetchval` is ever
    called on it, so no row is read and none is written.
    `statement_cache_size=0` because the connection goes through PgBouncer in
    transaction mode, where a cached server-side statement belongs to a session
    that will not be there next time.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for name, sql in sorted(_sql_constants().items()):
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((name, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((name, sql, len(stmt.get_parameters())))
            catalogue = await conn.fetch(
                "SELECT table_schema, table_name, column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_name IN ('graha_contacts', 'graha_territories', "
                "                     'graha_clients')"
            )
            return failures, params, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Described once for the whole file. Connects ONCE.

    A synchronous fixture running its own loop, deliberately: the suite pins
    `asyncio_default_fixture_loop_scope = function`, so a module-scoped async
    fixture would be sharing a loop it does not own.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    try:
        return _describe()
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked
    and never could — the failure mode a mock connection is blind to."""
    failures, _, _ = live
    assert not failures, "\n".join(f"{n}: {why}" for n, why in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    _, params, _ = live
    declared = {name: n for name, _sql, n in params}
    bound = {}
    for sql, args in _captured_calls():
        for name, value in _sql_constants().items():
            if value == sql:
                bound[name] = len(args)
    for name, count in bound.items():
        assert declared[name] == count, (
            f"{name} declares ${declared[name]} but {count} arguments are bound"
        )
    # The route's own statement is not driven by `route_contact`; assert its
    # arity directly so it cannot drift unnoticed.
    assert declared["PIN_LADDER_ALL"] == 1
    assert declared["PIN_LADDER_ONE"] == 2


def test_the_table_is_in_staging_and_only_staging(live):
    """A 42P01 from a schema-qualified query is a fact about THAT SCHEMA only.
    Phase 6.4 was closed on one — `public.report_schedules` was real, with a
    CRUD and an armed hourly cron. So this checks BOTH schemas rather than
    assuming, and records the answer: `graha_territories` exists in `staging`
    and nowhere else."""
    _, _, catalogue = live
    schemas = {c["table_schema"] for c in catalogue
               if c["table_name"] == "graha_territories"}
    assert schemas == {"staging"}, (
        f"graha_territories now exists in {sorted(schemas)} — every statement "
        f"in this module is schema-qualified to `staging` and a second copy is "
        f"a shadow table (see `shadow-tables-and-search-path`)"
    )


def test_the_columns_routing_writes_are_the_types_it_binds_them_as(live):
    """`prepare()` proves a column exists. It does not prove it is the type the
    binding assumes, and `assigned_users` has already changed type once —
    migration 134 took it from `uuid[]` to `text[]` because `users.user_id` is
    TEXT and assigning a real person raised invalid-input-syntax."""
    _, _, catalogue = live
    types = {(c["table_schema"], c["table_name"], c["column_name"]): c["data_type"]
             for c in catalogue}
    assert types[("staging", "graha_contacts", "territory_id")] == "uuid", (
        "bound as NULLIF($3,'')::uuid")
    assert types[("staging", "graha_contacts", "assigned_to")] == "text", (
        "bound as NULLIF($4,'') with no cast")
    assert types[("staging", "graha_contacts", "updated_at")].startswith("timestamp")
    assert types[("staging", "graha_territories", "rules")] == "jsonb"
    assert types[("staging", "graha_territories", "round_robin_index")] == "integer"
    assert types[("staging", "graha_territories", "assigned_users")] == "ARRAY"
    # The three rungs of the ladder, in the order the ladder reads them.
    assert types[("staging", "graha_contacts", "billing_address")] == "jsonb"
    assert types[("staging", "graha_contacts", "shipping_address")] == "jsonb"
    assert types[("staging", "graha_clients", "address")] == "jsonb"
