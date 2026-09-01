"""Per-client and per-employee overrides of a compliance setting.

── THE REQUIREMENT ──────────────────────────────────────────────────────────

The owner's words: "by default settings default will apply on all but if org,
client asked to or remove gst, or employee negotiation on leave and commission
then it override default setting."

Migration 253 puts `scope_type` / `scope_id` on `module_compliance_settings`.
Everything written before it is `scope_type='org'` and keeps meaning exactly
what it meant.

── THE TWO WAYS THIS GOES WRONG SILENTLY ───────────────────────────────────

 1. **An override read as a default.** `resolve` and `resolve_all` select from
    the same table the overrides now live in. Without `scope_type='org'` in
    their predicates, one client's exception becomes the firm-wide answer — and
    with several overrides, whichever row the planner returned first. Nothing
    errors; the settings screen simply shows the wrong thing to everybody.

 2. **`ON CONFLICT` matching no constraint.** 253 replaced the plain unique
    constraint with two PARTIAL unique indexes, and an inference clause must
    match a partial index including its predicate. The old spelling matches
    nothing, and every save 500s. That is precisely the failure CLAUDE.md names
    — "never ship a router without one test that executes its SQL against the
    real schema" — and it was live for the minutes between the migration and
    the fix. `test_live_*` below is that test.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import compliance_settings as cs


# ── the scope contract ───────────────────────────────────────────────────────

def test_the_scopes_are_the_three_the_check_constraint_allows():
    assert cs.SCOPES == ("org", "client", "employee")


@pytest.mark.asyncio
async def test_an_org_default_may_not_name_a_client():
    pool = MagicMock()
    with pytest.raises(ValueError, match="not about one client"):
        await cs.set_rule(pool, "o", "ganit", "hsn_required", "applicable",
                          "u", scope_type="org", scope_id="c1")


@pytest.mark.asyncio
async def test_an_override_must_say_who_it_is_for():
    pool = MagicMock()
    with pytest.raises(ValueError, match="which client"):
        await cs.set_rule(pool, "o", "ganit", "hsn_required", "applicable",
                          "u", scope_type="client", scope_id=None)


@pytest.mark.asyncio
async def test_an_unknown_scope_is_refused():
    pool = MagicMock()
    with pytest.raises(ValueError, match="not a scope"):
        await cs.set_rule(pool, "o", "ganit", "hsn_required", "applicable",
                          "u", scope_type="vendor", scope_id="v1")


@pytest.mark.asyncio
async def test_the_firm_default_cannot_be_cleared_only_changed():
    """A DELETE here would reset the setting for every client at once.

    Clearing an override means "go back to the firm's default". There is no
    corresponding meaning for the default itself, and letting `scope_type='org'`
    fall through to the DELETE would give the same button two very different
    consequences depending on which page it was pressed from.
    """
    pool = MagicMock()
    with pytest.raises(ValueError, match="cannot be cleared"):
        await cs.clear_rule(pool, "o", "ganit", "hsn_required", "org", "x")


# ── resolve_effective ────────────────────────────────────────────────────────

def _pool_returning(default_rows, override_rows):
    """A pool whose two fetches answer the default read then the override read."""
    pool = MagicMock()
    pool.fetch = AsyncMock(side_effect=[default_rows, override_rows])
    return pool


@pytest.mark.asyncio
async def test_with_no_override_the_default_applies_and_says_so():
    pool = _pool_returning([], [])
    out = await cs.resolve_effective(pool, "org-1", "ganit",
                                     scope_type="client", scope_id="c-1")
    rule = next(iter(out.values()))
    assert rule["source"] == "default"
    assert rule["override"] is None
    assert rule["state"] == rule["default"]["state"]


@pytest.mark.asyncio
async def test_an_override_wins_and_the_default_is_still_visible():
    key = next(iter(cs.RULES["ganit"]))
    pool = _pool_returning(
        [{"rule_key": key, "state": "applicable", "set_by": "u1",
          "set_at": None, "reason": "firm default"}],
        [{"rule_key": key, "state": "not_applicable", "set_by": "u2",
          "set_at": None, "reason": "this client is unregistered"}],
    )
    out = await cs.resolve_effective(pool, "org-1", "ganit",
                                     scope_type="client", scope_id="c-1")
    assert out[key]["state"] == "not_applicable"
    assert out[key]["source"] == "override"
    # The firm's own position is still on the payload — the screen has to be
    # able to say what changing this would revert to.
    assert out[key]["default"]["state"] == "applicable"
    assert out[key]["override"]["reason"] == "this client is unregistered"


@pytest.mark.asyncio
async def test_an_override_that_matches_the_default_is_still_an_override():
    """THE ONE A VALUE COMPARISON CANNOT GET RIGHT.

    Somebody decided this client's setting deliberately. If `source` were
    derived by comparing the effective state to the default, this row would read
    as "no override", and the next person to change the firm-wide default would
    silently change this client too — reversing a decision that was made on
    purpose, with no sign anywhere that it had been made.
    """
    key = next(iter(cs.RULES["ganit"]))
    pool = _pool_returning(
        [{"rule_key": key, "state": "applicable", "set_by": "u1",
          "set_at": None, "reason": None}],
        [{"rule_key": key, "state": "applicable", "set_by": "u2",
          "set_at": None, "reason": "confirmed with the client"}],
    )
    out = await cs.resolve_effective(pool, "org-1", "ganit",
                                     scope_type="client", scope_id="c-1")
    assert out[key]["state"] == out[key]["default"]["state"] == "applicable"
    assert out[key]["source"] == "override"


@pytest.mark.asyncio
async def test_asking_for_the_org_scope_takes_one_query_and_no_overrides():
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    out = await cs.resolve_effective(pool, "org-1", "ganit")
    assert pool.fetch.await_count == 1, "the org scope must not read overrides"
    assert all(r["source"] == "default" for r in out.values())
    assert all(r["override"] is None for r in out.values())


@pytest.mark.asyncio
async def test_the_override_read_is_scoped_to_the_org():
    """A client id is unique table-wide, so `scope_id` alone reads other orgs.

    Same leak PHASE-7 §7.1a closed in three other places.
    """
    pool = _pool_returning([], [])
    await cs.resolve_effective(pool, "org-1", "ganit",
                               scope_type="client", scope_id="c-1")
    sql, *args = pool.fetch.await_args_list[1].args
    assert "org_id=$1::uuid" in sql
    assert args[0] == "org-1"


# ── the reads that must not see an override ──────────────────────────────────

@pytest.mark.asyncio
async def test_resolve_reads_only_the_firm_default():
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    await cs.resolve(pool, "org-1", "ganit")
    sql = pool.fetch.await_args.args[0]
    assert "scope_type='org'" in sql, (
        "without this, one client's override becomes the firm-wide answer"
    )


@pytest.mark.asyncio
async def test_resolve_all_reads_only_firm_defaults():
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    await cs.resolve_all(pool, "org-1")
    assert "scope_type='org'" in pool.fetch.await_args.args[0]


@pytest.mark.asyncio
async def test_resolve_states_inherits_the_same_scoping():
    """`resolve_states` feeds the invoice compliance snapshot in vikray.py.

    An override leaking in here would not just misdraw a screen — it would be
    stamped onto a statutory document.
    """
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    await cs.resolve_states(pool, "org-1", "ganit")
    assert "scope_type='org'" in pool.fetch.await_args.args[0]


# ── against the real schema ──────────────────────────────────────────────────

_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = (
    "No live DATABASE_URL. Run: cd backend && railway run --service Kartavaya "
    "-- python -m pytest tests/test_compliance_settings_scopes.py -q"
)


def live_dsn():
    import os
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def run_live(factory):
    """Run against the real database, or skip if there is not one here."""
    import asyncio
    import asyncpg

    if live_dsn() is None:
        pytest.skip(DB_SKIP)

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except (asyncpg.exceptions.InvalidPasswordError,
                asyncpg.exceptions.InvalidCatalogNameError, OSError) as exc:
            return ("__unreachable__", str(exc))
        try:
            return ("__ok__", await factory(conn))
        finally:
            await conn.close()

    kind, value = asyncio.run(run())
    if kind == "__unreachable__":
        pytest.skip(f"{DB_SKIP} ({value[:60]})")
    return value


def test_live_both_upserts_match_a_real_index():
    """THE TEST THAT CATCHES THE BREAK — and its first version did not.

    Migration 253 dropped `UNIQUE (org_id, module, rule_key)` for two PARTIAL
    unique indexes. `set_rule`'s `ON CONFLICT` still named the old constraint,
    which matches nothing, so every settings save answered 500 with "there is no
    unique or exclusion constraint matching the ON CONFLICT specification".

    ⚠ THE FIRST VERSION OF THIS TEST USED `conn.prepare()` AND PASSED OVER THE
    BUG. Postgres resolves an ON CONFLICT arbiter at PLANNING time, not at
    parse, so PREPARE accepts a statement the planner will refuse. Restoring the
    old spelling left the test green — an assertion satisfied by the shape of
    what it happened to exercise, over exactly the defect it was named for.
    Verified by hand afterwards: the old spelling is refused at EXECUTE with
    precisely that message.

    So this EXECUTES both statements, inside a transaction that is always rolled
    back. A MagicMock accepts either spelling happily; only the real planner
    tells them apart.
    """
    async def execute_both(conn):
        tx = conn.transaction()
        await tx.start()
        try:
            # An org that HAS a client — `LIMIT 1` over organisations picks
            # whichever row comes first, and that was one with none, so the
            # override half of this test skipped itself instead of running.
            pair = await conn.fetchrow(
                "SELECT c.org_id, c.id AS client_id "
                "  FROM public.graha_clients c LIMIT 1")
            if pair is None:
                return "org-only"
            org, client = pair["org_id"], pair["client_id"]
            key = next(iter(cs.RULES["ganit"]))

            await conn.execute(
                "INSERT INTO public.module_compliance_settings "
                "  (org_id, module, rule_key, state, set_by, set_at, reason, "
                "   scope_type, scope_id) "
                "VALUES ($1::uuid, 'ganit', $2, 'applicable', 'probe', NOW(), "
                "        NULL, 'org', NULL) "
                "ON CONFLICT (org_id, module, rule_key) WHERE scope_type='org' "
                "DO UPDATE SET state=EXCLUDED.state",
                str(org), key)

            await conn.execute(
                "INSERT INTO public.module_compliance_settings "
                "  (org_id, module, rule_key, state, set_by, set_at, reason, "
                "   scope_type, scope_id) "
                "VALUES ($1::uuid, 'ganit', $2, 'not_applicable', 'probe', "
                "        NOW(), NULL, 'client', $3::uuid) "
                "ON CONFLICT (org_id, module, rule_key, scope_type, scope_id) "
                "  WHERE scope_type <> 'org' "
                "DO UPDATE SET state=EXCLUDED.state",
                str(org), key, str(client))

            # And the override really is separate from the default.
            defaults = await conn.fetchval(
                "SELECT count(*) FROM public.module_compliance_settings "
                " WHERE org_id=$1::uuid AND module='ganit' AND rule_key=$2 "
                "   AND scope_type='org'", str(org), key)
            overrides = await conn.fetchval(
                "SELECT count(*) FROM public.module_compliance_settings "
                " WHERE org_id=$1::uuid AND module='ganit' AND rule_key=$2 "
                "   AND scope_type='client'", str(org), key)
            return f"both:{defaults}:{overrides}"
        finally:
            await tx.rollback()

    outcome = run_live(execute_both)
    if outcome == "org-only":
        pytest.skip("no client in this database to hang an override on")
    assert outcome == "both:1:1", (
        "the default and the override must coexist as separate rows"
    )


def test_live_the_old_on_conflict_spelling_is_actually_refused():
    """The anti-vacuity floor for the test above.

    If the pre-253 spelling still worked, everything above would pass over a
    schema where nothing had changed, and the "fix" would be unfalsifiable.
    This requires the database to REFUSE it.
    """
    import asyncpg

    async def probe(conn):
        tx = conn.transaction()
        await tx.start()
        try:
            org = await conn.fetchval(
                "SELECT id FROM public.organisations LIMIT 1")
            key = next(iter(cs.RULES["ganit"]))
            try:
                await conn.execute(
                    "INSERT INTO public.module_compliance_settings "
                    "  (org_id, module, rule_key, state, set_by, set_at, "
                    "   reason, scope_type, scope_id) "
                    "VALUES ($1::uuid, 'ganit', $2, 'applicable', 'probe', "
                    "        NOW(), NULL, 'org', NULL) "
                    "ON CONFLICT (org_id, module, rule_key) "
                    "DO UPDATE SET state=EXCLUDED.state",
                    str(org), key)
                return "ACCEPTED"
            except asyncpg.exceptions.PostgresError as exc:
                return f"refused: {exc}"
        finally:
            await tx.rollback()

    outcome = run_live(probe)
    assert outcome.startswith("refused:"), (
        "the pre-253 ON CONFLICT still matches an index — the partial indexes "
        "did not replace the old constraint as intended"
    )
    assert "no unique or exclusion constraint" in outcome


def test_live_the_scope_columns_and_indexes_are_there():
    async def describe(conn):
        cols = await conn.fetch(
            "SELECT column_name FROM information_schema.columns "
            " WHERE table_schema='public' "
            "   AND table_name='module_compliance_settings' "
            "   AND column_name IN ('scope_type','scope_id')")
        idx = await conn.fetch(
            "SELECT indexname FROM pg_indexes "
            " WHERE tablename='module_compliance_settings' "
            "   AND indexname LIKE '%_uq'")
        return ({r["column_name"] for r in cols}, {r["indexname"] for r in idx})

    columns, indexes = run_live(describe)
    assert columns == {"scope_type", "scope_id"}
    assert len(indexes) == 2, "the default index and the override index"


def test_live_every_existing_row_is_a_firm_default():
    """253's default. Nothing written before it becomes an override by accident."""
    async def count(conn):
        return await conn.fetchval(
            "SELECT count(*) FROM public.module_compliance_settings "
            " WHERE scope_type <> 'org' AND scope_id IS NULL")

    assert run_live(count) == 0


def test_live_the_shape_check_refuses_an_impossible_row():
    """An override with no subject, and a default that names one, are both
    nonsense. Proven inside a transaction that is always rolled back."""
    import asyncpg

    async def probe(conn):
        tx = conn.transaction()
        await tx.start()
        try:
            org = await conn.fetchval(
                "SELECT id FROM public.organisations LIMIT 1")
            outcomes = []
            for scope_type, scope_id in (("client", None), ("org", org)):
                try:
                    await conn.execute(
                        "INSERT INTO public.module_compliance_settings "
                        "  (org_id, module, rule_key, state, set_by, "
                        "   scope_type, scope_id) "
                        "VALUES ($1::uuid,'ganit','probe','applicable','t',"
                        "        $2, $3::uuid)",
                        str(org), scope_type, str(scope_id) if scope_id else None)
                    outcomes.append("ACCEPTED")
                except asyncpg.exceptions.PostgresError:
                    outcomes.append("refused")
            return outcomes
        finally:
            await tx.rollback()

    assert run_live(probe) == ["refused", "refused"]
