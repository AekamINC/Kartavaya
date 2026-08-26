"""The compliance settings SCREEN — its SQL, and the two lies it must not tell.

── WHY A SECOND FILE ────────────────────────────────────────────────────────

`test_compliance_settings.py` covers the resolver's defaults and
`doc_validation`'s three-state behaviour, and it also covers Pahchan's consent
path, which is a different workstream. This file is about the settings surface
PHASE-4 §4.1 asked for: `routers/compliance_settings.py`, the registry that
decides what appears on it, and the two properties that make the screen safe
to put in front of a customer.

── PROPERTY 1: NO STATEMENT IS FICTION ──────────────────────────────────────

The rule from CLAUDE.md and PHASE-6: a router does not ship without one test
that executes its SQL against the real schema. `routers/client_billing.py`
shipped with none and both of its INSERTs named a column that has never
existed — a MagicMock pool answers happily to that, so the offline suite was
green while every call had always 500'd.

So the live half here does what `test_client_billing_invoices.py` does:

  · CAPTURE, offline. All three handlers are driven with a pool that records
    every statement and answers from a small script. Nothing touches a
    database. This half runs anywhere.

  · CHECK, live. `asyncpg.Connection.prepare()` sends Parse and Describe and
    STOPS — the server plans the statement, resolves every relation, column
    and parameter type, and returns the shapes. It does not execute, does not
    read a row and does not write one. Staging and production share ONE
    Supabase database (CLAUDE.md), so that distinction is the whole safety
    story of this file: `module_compliance_settings` holds 0 rows and this
    test leaves it holding 0 rows.

  Plus the catalogue, read directly, because `prepare()` plans a statement
  that omits a NOT NULL column perfectly happily.

── PROPERTY 2: THE SCREEN MAKES NO COMPLIANCE CLAIM ─────────────────────────

PHASE-4 §4.1, in its own words: "this org chose X retention" is a fact; "we
are compliant with X" is a lie the customer repeats to their regulator. Every
string in the registry reaches a customer's screen, so the banned-phrase check
below is on the registry itself rather than on the JSX — the JSX renders
whatever this dict says.

And the structural half of the same property: a rule nothing reads may not be
`enforced`. Offering a guardrail that cannot stop anything is the same lie
wearing a control.

Live half:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_compliance_settings_screen.py -q
"""
import asyncio
import inspect
import os
import pathlib
import re
from datetime import datetime, timezone

import pytest

import routers.compliance_settings as router_mod
from services import compliance_settings as svc


# ── identities ───────────────────────────────────────────────
# Values, never sources. No statement built with them is ever executed.

ORG = "11111111-1111-1111-1111-111111111111"
SETTER = "user_admin001"
SET_AT = datetime(2026, 8, 26, 9, 30, tzinfo=timezone.utc)

BACKEND = pathlib.Path(router_mod.__file__).resolve().parent.parent


class _FakeRequest:
    """Just enough for `services.audit.emit`, which the PATCH handler calls."""
    headers: dict = {}
    client = None


# ══════════════════════════════════════════════════════════════════════════
#  The registry — what may appear on the screen at all
# ══════════════════════════════════════════════════════════════════════════

#: Phrases that assert a compliance STATUS rather than describe a consequence.
#: Deliberately short and literal. A longer list of near-synonyms would start
#: matching legitimate sentences — "the recipient's input tax credit" has to
#: be sayable — and a check with false positives is a check somebody deletes.
_CLAIMS = (
    "compliant", "compliance with", "fully compliant", "certified",
    "guarantee", "guarantees", "we ensure", "ensures that you",
    "meets the requirement", "keeps you legal", "legally safe",
)


def test_no_rule_claims_the_firm_is_compliant():
    """The rule PHASE-4 §4.1 puts in capitals.

    A settings screen that says "you are GST compliant" hands the customer a
    sentence they will repeat to their own regulator on our word, and this
    product does not have that word to give. It can say what FOLLOWS from a
    gap — that is a fact — and nothing beyond it.
    """
    offenders = []
    for module, rules in svc.RULES.items():
        for key, rule in rules.items():
            text = f"{rule.label} {rule.consequence}".lower()
            for phrase in _CLAIMS:
                if phrase in text:
                    offenders.append(f"{module}.{key}: {phrase!r}")
    assert not offenders, (
        "these strings assert a compliance status rather than state a "
        "consequence:\n  " + "\n  ".join(offenders))


def test_every_wired_rule_names_code_that_actually_exists():
    """`enforced_at` is a load-bearing claim, so it is checked like one.

    The registry's whole job is to stop a setting becoming a control nothing
    enforces. It does that by naming, per rule, the code that reads the
    resolved state — and a `file.py:symbol` nobody verifies rots into
    decoration the first time that function is renamed. Both halves are
    asserted: the file is on disk, and the symbol is in it.
    """
    missing = []
    for module, rules in svc.RULES.items():
        for key, rule in rules.items():
            if not rule.enforced_at:
                continue
            path, _, symbol = rule.enforced_at.partition(":")
            target = BACKEND / path
            if not target.exists():
                missing.append(f"{module}.{key}: no such file {path}")
                continue
            if symbol and not re.search(rf"\b{re.escape(symbol)}\b", target.read_text(encoding="utf-8")):
                missing.append(f"{module}.{key}: {path} has no {symbol}")
    assert not missing, "\n  ".join(["enforced_at points at code that is not there:"] + missing)


def test_a_wired_rule_offers_three_states_and_an_unwired_one_offers_two():
    ganit = svc.rules_for("ganit")
    assert ganit["hsn_required"].wired
    assert tuple(ganit["hsn_required"].states) == svc.STATES

    vetana = svc.rules_for("vetana")
    assert vetana["pf_applicable"].wired is False
    assert tuple(vetana["pf_applicable"].states) == svc.DECLARED_STATES
    assert "enforced" not in vetana["pf_applicable"].states


class _ScriptPool:
    """Records every statement; answers from `{substring: value}`."""

    def __init__(self, script=None):
        self.script = script or {}
        self.calls: list[tuple[str, tuple]] = []

    def _answer(self, sql, args, default):
        self.calls.append((sql, args))
        for needle, value in self.script.items():
            if needle in sql:
                return value
        return default

    async def fetch(self, sql, *args):
        return self._answer(sql, args, [])

    async def fetchrow(self, sql, *args):
        return self._answer(sql, args, None)

    async def fetchval(self, sql, *args):
        return self._answer(sql, args, None)

    async def execute(self, sql, *args):
        return self._answer(sql, args, "INSERT 0 1")


async def test_set_rule_refuses_to_enforce_something_nothing_reads():
    """The structural half of "never a control that makes a claim".

    `enforced` means the firm asked to be STOPPED. Storing that for a rule no
    code reads records a guardrail that is not there, agreed to in writing by
    the customer — which is worse than not offering the setting at all. The
    screen does not offer the state; this refuses it anyway, because the
    screen is not the only caller.
    """
    pool = _ScriptPool()
    with pytest.raises(ValueError, match="cannot be enforced"):
        await svc.set_rule(pool, ORG, "vetana", "pf_applicable", "enforced", set_by=SETTER)
    # And nothing was written on the way to the refusal.
    assert pool.calls == []


async def test_set_rule_still_accepts_the_two_declared_states():
    pool = _ScriptPool({
        "INSERT INTO staging.module_compliance_settings": {
            "rule_key": "pf_applicable", "state": "not_applicable",
            "set_by": SETTER, "set_at": SET_AT, "reason": "no employees under EPF",
        },
    })
    row = await svc.set_rule(
        pool, ORG, "vetana", "pf_applicable", "not_applicable",
        set_by=SETTER, reason="no employees under EPF")
    assert row["state"] == "not_applicable"


async def test_resolve_all_returns_every_module_in_display_order():
    pool = _ScriptPool({
        "FROM staging.module_compliance_settings": [
            {"module": "vetana", "rule_key": "esi_applicable", "state": "not_applicable",
             "set_by": SETTER, "set_at": SET_AT, "reason": "never ten at one location"},
            # A row for a rule the registry does not know. It must be ignored
            # exactly as an unknown rule_key already is — the registry, not
            # the table, defines what a module's settings ARE.
            {"module": "vetana", "rule_key": "retired_rule", "state": "enforced",
             "set_by": SETTER, "set_at": SET_AT, "reason": None},
        ],
    })
    out = await svc.resolve_all(pool, ORG)
    assert [m["module"] for m in out] == svc.modules()
    # ONE query for the whole screen, not one per module.
    assert len(pool.calls) == 1

    vetana = next(m for m in out if m["module"] == "vetana")
    assert vetana["rules"]["esi_applicable"]["state"] == "not_applicable"
    assert vetana["rules"]["esi_applicable"]["reason"] == "never ten at one location"
    assert vetana["rules"]["pf_applicable"]["state"] == svc.DEFAULT_STATE
    assert "retired_rule" not in vetana["rules"]


# ══════════════════════════════════════════════════════════════════════════
#  The router — names, not ids
# ══════════════════════════════════════════════════════════════════════════

def _driven():
    """(handler, sql, args) for every statement the three handlers issue.

    Driven directly rather than through the HTTP stack: `require_org_role`,
    `get_org_id` and the organisation-exists check are three pre-existing
    gates with their own tests, and re-deriving them query by query here
    would only move the capture further from the statements under test.
    Calling the handler supplies `user`/`org_id` the way `Depends` would.
    """
    stored_row = {
        "module": "ganit", "rule_key": "hsn_required", "state": "enforced",
        "set_by": SETTER, "set_at": SET_AT, "reason": "we always need HSN",
    }

    async def run():
        import db
        out = []
        for name, script, drive in (
            ("get_all", {
                # A row WITH a set_by, so the name lookup actually fires and
                # its statement is captured. With no rows there is nobody to
                # name and the query the privacy rule depends on is never
                # issued — the one this file most needs to describe.
                "FROM staging.module_compliance_settings": [stored_row],
                "FROM public.users": [{"user_id": SETTER, "setter_name": "Keval Shah"}],
                "FROM staging.module_subscriptions": [{"module_code": "ganit"}],
             },
             lambda: router_mod.get_all_settings(user={"user_id": SETTER}, org_id=ORG)),
            ("get_module", {
                "FROM staging.module_compliance_settings": [stored_row],
                "FROM public.users": [{"user_id": SETTER, "setter_name": "Keval Shah"}],
             },
             lambda: router_mod.get_module_settings("ganit", user={"user_id": SETTER}, org_id=ORG)),
            ("patch", {
                "FROM staging.module_compliance_settings": [stored_row],
                "FROM public.users": [{"user_id": SETTER, "setter_name": "Keval Shah"}],
                "INSERT INTO staging.module_compliance_settings": dict(stored_row),
             },
             lambda: router_mod.patch_module_setting(
                 "ganit",
                 router_mod.RulePatch(rule_key="hsn_required", state="enforced", reason="strict shop"),
                 _FakeRequest(), user={"user_id": SETTER}, org_id=ORG)),
        ):
            pool = _ScriptPool(script)
            original, db._pool = db._pool, pool
            try:
                await drive()
                # Drain `audit.emit`'s fire-and-forget write onto the capture
                # pool, so the audit INSERT is described with the rest.
                await asyncio.sleep(0.05)
            finally:
                db._pool = original
            out.extend((name, sql, args) for sql, args in pool.calls)
        return out

    return asyncio.run(run())


async def _payload(handler, script):
    import db
    pool = _ScriptPool(script)
    original, db._pool = db._pool, pool
    try:
        return await handler()
    finally:
        db._pool = original


_SEEDED = {
    "FROM staging.module_compliance_settings": [{
        "module": "ganit", "rule_key": "hsn_required", "state": "enforced",
        "set_by": SETTER, "set_at": SET_AT, "reason": "we always need HSN",
    }],
    "FROM public.users": [{"user_id": SETTER, "setter_name": "Keval Shah"}],
    "FROM staging.module_subscriptions": [{"module_code": "ganit"}],
}


async def test_the_index_names_the_person_and_never_ships_their_id():
    """The owner's rule: a user, member or org id is never rendered.

    The table stores `public.users.user_id`, and the resolver hands it back
    because the router needs something to look a name up BY. It must not
    leave the process: `check-rendered-ids.mjs` is positional and would not
    catch `{rule.set_by}` inside a template string, so the field is REMOVED
    rather than left present-but-unused. A field a payload carries is a field
    a screen can draw.
    """
    data = await _payload(
        lambda: router_mod.get_all_settings(user={"user_id": SETTER}, org_id=ORG),
        _SEEDED)
    ganit = next(m for m in data["modules"] if m["module"] == "ganit")
    rule = ganit["rules"]["hsn_required"]
    assert rule["set_by_name"] == "Keval Shah"
    assert rule["has_setter"] is True
    assert "set_by" not in rule
    # Nothing anywhere in the payload is the raw id.
    assert SETTER not in repr(data)


async def test_an_untouched_rule_is_not_reported_as_set_by_nobody():
    """Two absences, told apart. `has_setter` false means nobody has decided
    this; a null name WITH `has_setter` true means the account that decided it
    is gone. Collapsing them loses the distinction an audit column exists for.
    """
    data = await _payload(
        lambda: router_mod.get_all_settings(user={"user_id": SETTER}, org_id=ORG),
        _SEEDED)
    ganit = next(m for m in data["modules"] if m["module"] == "ganit")
    untouched = ganit["rules"]["gstin_required"]
    assert untouched["has_setter"] is False
    assert untouched["set_by_name"] is None
    assert untouched["state"] == svc.DEFAULT_STATE


async def test_a_deleted_account_leaves_the_setting_readable():
    """No `public.users` row behind the id. The rule must still render, with
    the decision and its date intact — an org that cannot see a setting
    because the person who made it left is an org that cannot correct it."""
    data = await _payload(
        lambda: router_mod.get_all_settings(user={"user_id": SETTER}, org_id=ORG),
        {**_SEEDED, "FROM public.users": []})
    ganit = next(m for m in data["modules"] if m["module"] == "ganit")
    rule = ganit["rules"]["hsn_required"]
    assert rule["has_setter"] is True
    assert rule["set_by_name"] is None
    assert rule["state"] == "enforced"
    assert rule["set_at"] == SET_AT.isoformat()


async def test_the_index_says_which_modules_the_org_actually_subscribes_to():
    data = await _payload(
        lambda: router_mod.get_all_settings(user={"user_id": SETTER}, org_id=ORG),
        _SEEDED)
    by_code = {m["module"]: m for m in data["modules"]}
    assert by_code["ganit"]["active"] is True
    # Annotated, never filtered: a recorded position on a switched-off module
    # must stay reachable or it becomes a stored decision nobody can correct.
    assert by_code["vetana"]["active"] is False
    assert set(by_code) == set(svc.modules())
    assert data["default_state"] == svc.DEFAULT_STATE


async def test_the_patch_audit_row_says_what_it_changed_from(monkeypatch):
    """`previous_state` is most of the value of auditing a compliance setting.

    Without it the trail reads "hsn_required is now not_applicable" and cannot
    distinguish a firm's first decision from somebody reversing one — which is
    exactly the distinction proposal 80's rule 1 exists to preserve.
    """
    seen = {}
    monkeypatch.setattr(router_mod, "audit",
                        lambda action, request, **kw: seen.update(action=action, **kw))
    out = await _payload(
        lambda: router_mod.patch_module_setting(
            "ganit",
            router_mod.RulePatch(rule_key="hsn_required", state="not_applicable",
                                 reason="composition dealer"),
            _FakeRequest(), user={"user_id": SETTER}, org_id=ORG),
        {**_SEEDED, "INSERT INTO staging.module_compliance_settings": {
            "rule_key": "hsn_required", "state": "not_applicable",
            "set_by": SETTER, "set_at": SET_AT, "reason": "composition dealer",
        }})
    assert seen["action"] == "compliance.setting_updated"
    assert seen["severity"] == "warn"
    assert seen["detail"]["previous_state"] == "enforced"
    assert seen["detail"]["state"] == "not_applicable"
    assert seen["detail"]["reason"] == "composition dealer"
    assert out["previous_state"] == "enforced"
    assert "set_by" not in out


# ══════════════════════════════════════════════════════════════════════════
#  The live half — Parse and Describe. NOTHING IS EXECUTED.
# ══════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO staging, public"

SKIP_REASON = (
    "no live database. This half parses the router's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers happily "
    "to a SELECT naming a column that does not exist. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_compliance_settings_screen.py -q"
)

TABLE = "module_compliance_settings"


def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


def _column_list(sql: str) -> list[str]:
    """The column list of an INSERT, as written."""
    m = re.search(r"INSERT INTO\s+staging\.\w+\s*\(([^)]*)\)", sql, re.I | re.S)
    return [c.strip() for c in m.group(1).split(",")] if m else []


def _describe(calls):
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures, params = [], []
            for path, sql, args in calls:
                try:
                    stmt = await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((path, sql, f"{type(exc).__name__}: {exc}"))
                    continue
                params.append((path, sql, len(stmt.get_parameters()), len(args)))
            catalogue = await conn.fetch(
                "SELECT column_name, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = 'staging' AND table_name = $1",
                TABLE,
            )
            return failures, params, [dict(r) for r in catalogue]
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def live():
    """Captured statements, described once for the whole file. Connects ONCE."""
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    calls = _driven()
    try:
        return _describe(calls)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


def test_every_statement_the_router_issues_plans_on_the_real_schema(live):
    """UndefinedColumn / UndefinedTable means the statement has never worked.
    IndeterminateDatatype means an untyped parameter expression, which
    PgBouncer turns into an instant 500."""
    failures, _, _ = live
    assert not failures, "\n\n".join(
        f"[{path}] {err}\n{sql}" for path, sql, err in failures)


def test_every_statement_binds_as_many_arguments_as_it_declares(live):
    _, params, _ = live
    wrong = [(p, sql, declared, bound)
             for p, sql, declared, bound in params if declared != bound]
    assert not wrong, "\n\n".join(
        f"[{p}] declares ${declared} but binds {bound} arguments\n{sql}"
        for p, sql, declared, bound in wrong)


def test_the_upsert_names_real_columns_and_omits_no_required_one(live):
    """The half `prepare()` cannot do: a statement that omits a NOT NULL
    column with no default plans perfectly — the violation is a runtime
    constraint. Read from the catalogue, never from the migration file:
    migration 210's `CREATE TABLE IF NOT EXISTS` is not evidence of the
    columns that are actually there."""
    _, params, catalogue = live
    assert catalogue, f"staging.{TABLE} is not on the database"
    known = {c["column_name"] for c in catalogue}
    required = {c["column_name"] for c in catalogue
                if c["is_nullable"] == "NO" and c["column_default"] is None}
    assert {"org_id", "module", "rule_key"} <= required, (
        "the premise changed: org_id/module/rule_key are no longer NOT NULL "
        f"without a default on staging.{TABLE}")

    seen = 0
    for path, sql, _, _ in params:
        if f"INSERT INTO staging.{TABLE}" not in sql:
            continue
        seen += 1
        cols = set(_column_list(sql))
        assert not (cols - known), (
            f"[{path}] names columns staging.{TABLE} does not have: "
            f"{sorted(cols - known)}")
        assert not (required - cols), (
            f"[{path}] omits NOT NULL columns with no default: "
            f"{sorted(required - cols)}")
    assert seen == 1, f"expected the upsert, described {seen}"


def test_the_three_statements_the_screen_depends_on_were_all_described(live):
    """A guard on the guard. Each of these is a query a green offline suite
    cannot vouch for, and an empty capture would make every test above pass
    by describing nothing."""
    _, params, _ = live
    described = " ".join(sql for _, sql, _, _ in params)
    for needle in (
        f"FROM staging.{TABLE}",          # resolve / resolve_all
        "FROM staging.module_subscriptions",  # which modules are on
        "FROM public.users",              # names, not ids
        f"INSERT INTO staging.{TABLE}",   # the upsert
    ):
        assert needle in described, f"never captured a statement with {needle!r}"
    assert pathlib.Path(router_mod.__file__).name == "compliance_settings.py"


def test_the_state_check_constraint_still_matches_the_python_vocabulary(live):
    """Migration 210 puts the three states in a CHECK. If the two ever part
    company, a state Python calls valid becomes a 500 at the database. Read
    from `pg_constraint`, never from the migration file — an inline CHECK on
    `ADD COLUMN IF NOT EXISTS` is skipped whole when the column already
    exists, so the file is not evidence the constraint is there."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            return await conn.fetchval(
                "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "JOIN pg_namespace n ON n.oid = t.relnamespace "
                "WHERE n.nspname='staging' AND t.relname=$1 AND c.contype='c' "
                "AND pg_get_constraintdef(c.oid) ILIKE '%state%'",
                TABLE,
            )
        finally:
            await conn.close()

    definition = asyncio.run(run())
    assert definition, (
        f"staging.{TABLE} has no CHECK on `state` — the three-state "
        "vocabulary is enforced only in Python")
    for state in svc.STATES:
        assert state in definition, (
            f"'{state}' is a valid state in Python but not in the CHECK: "
            f"{definition}")


def test_the_handlers_under_test_are_the_ones_the_app_mounts():
    """The capture drives functions by name; a rename would leave this file
    describing statements nothing serves."""
    for fn in ("get_all_settings", "get_module_settings", "patch_module_setting"):
        assert inspect.iscoroutinefunction(getattr(router_mod, fn))

    # Identity, not `app.routes`. This FastAPI version keeps an included
    # router as an opaque `_IncludedRouter` with no `path` until it is
    # resolved, so scanning the app's route list for the prefix finds
    # nothing and would fail for every router in the product equally —
    # a test that says "the route is missing" when it is mounted is worse
    # than no test. The object `server.py` includes IS this module's.
    import server
    assert server.compliance_settings_router is router_mod.router
    assert router_mod.router.prefix == "/api/v1/org/compliance"
    paths = {r.path for r in router_mod.router.routes}
    assert paths == {
        "/api/v1/org/compliance",
        "/api/v1/org/compliance/{module}",
    }, paths
