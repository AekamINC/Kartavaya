"""THE ONE THING A MOCK POOL CANNOT PROVE.

`find_coverage_gaps` shipped in the first batch of skills and selected
`sd.min_staff` from `staging.manav_shift_definitions`. That column has never
existed: migration 027 created the table with a name, two times, a break, a
colour and an is_active flag, and no staffing requirement at all. The handler
raised `UndefinedColumnError` on the first live run and had done so, silently,
for as long as it had been registered.

Nothing in the suite could have caught it. `tests/conftest.py` hands every
module a MagicMock pool, and a MagicMock answers `[]` to any statement it is
given — valid SQL, invalid SQL, a shopping list. A test that calls a handler
with that pool and gets a list back has proved that the mock returned what the
test told it to return, and nothing whatsoever about the query.

So this file does the only honest thing available: it PARSES every statement
every skill would run, against the real catalogue, and executes none of them.

── HOW, EXACTLY ─────────────────────────────────────────────────────────────

Two steps, and the separation is the safety story.

  1. CAPTURE, offline. Each read handler is called with a pool that records the
     statement and answers nothing. No database is involved, no write skill is
     called, and the handler's own Python — the f-strings, the branches, the
     per-module specs in `overdue_finder` — builds the SQL exactly as it would
     at run time. THREE passes: one answering `None` to every `fetchrow`, one
     answering a permissive empty row, and one where `fetch` returns a single
     row — so a handler that returns early on a missing row still yields the
     statements on its other branch, and a statement issued INSIDE a loop over
     results is reached at all. That third pass is not decoration: four
     statements across three handlers exist only inside such a loop and were
     invisible to the first two.

  2. PARSE, live. `asyncpg.Connection.prepare()` sends Parse and Describe and
     STOPS. The server plans the statement, resolves every relation, column and
     parameter type, and returns the shapes — it does not execute, does not
     read a row, and does not write one. Staging and production share this
     database, so that distinction is not a nicety.

── WHAT A FAILURE HERE MEANS ────────────────────────────────────────────────

    UndefinedColumn / UndefinedTable   the handler names something that is not
                                       there. It has never worked.
    IndeterminateDatatype              `$1 + $2` with no cast. PgBouncer turns
                                       that into an instant 500 — see
                                       CLAUDE.md, and the credits incident that
                                       taught it.
    SyntaxError                        a statement that was assembled wrong.

Every one of those is a skill that raises the moment a customer presses Run.

── WHEN THERE IS NO DATABASE ────────────────────────────────────────────────

It skips, loudly and with the command in the message. The offline suite stays
green and stays honest: the capture half still runs and still guards itself, so
a change that stops the harness seeing the shelf fails on a laptop with no
credentials, where it is cheap to fix.

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_skill_sql_is_valid.py -q
"""
import asyncio
import inspect
import os
import re

import pytest

from services.skill_dispatcher import SKILL_REGISTRY, WRITE_SKILL_FUNCTIONS

#: The DSN `tests/conftest.py` sets so that importing the app does not explode.
#: It points at nothing. Recognising it BY VALUE is the only way to tell "no
#: database" from "a database": conftest uses `setdefault`, so `DATABASE_URL`
#: is never absent and a bare presence check would try to connect to a host
#: that does not exist and report the timeout as a failure.
_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: What the app's own pool does on every connection (`db.py`). Matched here so
#: a statement is planned the way it will actually be planned.
_SEARCH_PATH = "SET search_path TO public"

#: An org id that exists nowhere. Only ever bound as a value in a capture; no
#: statement built with it is ever executed.
ORG = "00000000-0000-0000-0000-0000000000aa"

#: Subjects for the handlers that need one. Values, never sources — the same
#: rule `RUNTIME_FORBIDDEN_PARAMS` encodes: a runtime value may select which
#: ROW, never which TABLE. `module` is therefore never supplied from here; it
#: comes from the registry's own defaults, which is why `find_overdue` is
#: captured five times, once per module spec, rather than once.
SUBJECTS = {
    "dept": "Audit",
    "start_date": "2026-08-01",
    "end_date": "2026-08-31",
    "expense": {"id": "e1", "amount": 1000, "category": "travel",
                "description": "cab", "expense_date": "2026-08-01"},
    "metric": "revenue",
    "contact_id": "00000000-0000-0000-0000-0000000000bb",
    "bank_txns": [],
    "candidate": {"id": "c1", "name": "A Candidate", "skills": [],
                  "experience_years": 3},
    "user_id": "user_admin001",
}


# ══════════════════════════════════════════════════════════════════════════════
#  Capture — no database, no writes, no sends
# ══════════════════════════════════════════════════════════════════════════════

class _Nothing:
    """An empty answer that does not stop the handler in its tracks.

    A real query against an org with no rows returns `[]` from `fetch` and a
    ROW from `SELECT count(*)`. A capture pool that answers `None` to every
    `fetchrow` is therefore harsher than an empty database, and eight handlers
    stopped at their first aggregate with `'NoneType' object is not
    subscriptable` — taking the rest of their statements with them, unseen.

    This stands in for that row. It is not trying to be right; it is trying to
    let the handler keep building statements so that all of them get parsed.
    Anything it is asked for, it is.
    """

    def __getitem__(self, key):
        return self

    def get(self, key, default=None):
        return self

    def keys(self):
        return ()

    def __iter__(self):
        return iter(())

    def __len__(self):
        return 0

    def __bool__(self):
        return False

    def __int__(self):
        return 0

    def __float__(self):
        return 0.0

    def __str__(self):
        return ""

    def __format__(self, spec):
        return ""

    def __round__(self, n=0):
        return 0

    def __abs__(self):
        return 0

    def __neg__(self):
        return self

    def __add__(self, other):
        return self

    __radd__ = __sub__ = __rsub__ = __mul__ = __rmul__ = __add__
    __truediv__ = __rtruediv__ = __floordiv__ = __mod__ = __add__

    def __lt__(self, other):
        return False

    __gt__ = __le__ = __ge__ = __lt__

    def __eq__(self, other):
        return other is self

    def __hash__(self):
        return hash(id(type(self)))


NOTHING = _Nothing()


class CapturePool:
    """Records every statement and answers with emptiness.

    THE ONLY THING IT IS ALLOWED TO DO. It holds no connection, so a handler
    that reached the database through it could not, and a write skill run
    against it would write nothing — which is a safety net and not a licence:
    `WRITE_SKILL_FUNCTIONS` is read from the dispatcher and those handlers are
    never called here at all.
    """

    def __init__(self, permissive: bool, rows: bool = False):
        self.statements: list[str] = []
        self._row = NOTHING if permissive else None
        # Whether `fetch` yields a row. A handler that loops over its results
        # and queries per row issues nothing at all against an empty answer.
        self._rows = rows

    def _record(self, sql):
        if isinstance(sql, str) and sql.strip():
            self.statements.append(sql)

    async def fetch(self, sql, *args, **kwargs):
        self._record(sql)
        return [NOTHING] if self._rows else []

    async def fetchrow(self, sql, *args, **kwargs):
        self._record(sql)
        return self._row

    async def fetchval(self, sql, *args, **kwargs):
        self._record(sql)
        return self._row

    async def execute(self, sql, *args, **kwargs):
        self._record(sql)
        return "SELECT 0"

    async def executemany(self, sql, args, **kwargs):
        self._record(sql)
        return "SELECT 0"

    def acquire(self):
        pool = self

        class _Acquired:
            async def __aenter__(self):
                return pool

            async def __aexit__(self, *exc):
                return False

        return _Acquired()

    def transaction(self, **kwargs):
        return self.acquire()


def _readable_skills() -> list[str]:
    """Every skill this file may run. The write handlers are read OUT of the
    dispatcher's own frozenset rather than named here, so that a handler
    promoted to a write cannot stay in this list by being spelled the same."""
    return sorted(set(SKILL_REGISTRY) - set(WRITE_SKILL_FUNCTIONS))


def _call_arguments(handler, defaults: dict) -> dict:
    """What to hand this handler: its defaults, the org, and a subject if it
    needs one. Matched to the signature the way `_run_function_step` does it,
    so a handler is never given a keyword it does not declare."""
    params = inspect.signature(handler).parameters
    supplied = dict(defaults or {})
    supplied["org_id"] = ORG
    for name, spec in params.items():
        if name in ("pool", "org_id") or name in supplied:
            continue
        if spec.default is inspect.Parameter.empty and name in SUBJECTS:
            supplied[name] = SUBJECTS[name]
    if "user_id" in params:
        supplied.setdefault("user_id", SUBJECTS["user_id"])

    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return {k: v for k, v in supplied.items() if k != "pool"}
    return {k: v for k, v in supplied.items() if k in params and k != "pool"}


async def _capture_one(skill_function: str) -> tuple[list[str], list[str]]:
    """Every statement this skill would run, and every exception on the way."""
    from services.skill_dispatcher import _resolve_handler

    module_path, fn_name, defaults = SKILL_REGISTRY[skill_function]
    handler = await _resolve_handler(skill_function)

    seen: list[str] = []
    errors: list[str] = []
    for permissive, rows in ((False, False), (True, False), (True, True)):
        pool = CapturePool(permissive=permissive, rows=rows)
        try:
            await handler(pool=pool, **_call_arguments(handler, defaults))
        except Exception as exc:                              # noqa: BLE001
            # NOT a failure of this file. A handler that trips over an empty
            # answer is a different defect from a handler whose SQL is wrong,
            # and conflating them would let a real parse error hide behind a
            # TypeError from the fixture. The statements it managed to issue
            # are kept and parsed.
            errors.append(f"{type(exc).__name__}: {exc}")
        for statement in pool.statements:
            if statement not in seen:
                seen.append(statement)
    return seen, errors


def _capture_everything() -> dict[str, list[str]]:
    async def run():
        return {name: (await _capture_one(name))[0] for name in _readable_skills()}

    return asyncio.run(run())


# ══════════════════════════════════════════════════════════════════════════════
#  Live parse
# ══════════════════════════════════════════════════════════════════════════════

def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


SKIP_REASON = (
    "no live database. This check parses every skill's SQL against the real "
    "catalogue and cannot be done offline — a MagicMock pool answers [] to "
    "invalid SQL, which is exactly how `sd.min_staff` survived. Run it with:\n"
    "    railway run -e staging -s Kartavya -- python -m pytest "
    "tests/test_skill_sql_is_valid.py -q"
)


def _prepare_all(statements: dict[str, list[str]]) -> dict[str, list[tuple[str, str]]]:
    """Parse and Describe every statement. NOTHING IS EXECUTED.

    `prepare()` is the whole mechanism: it sends the statement to the server to
    be planned and described, and returns a handle. No `fetch`, no `execute`,
    no `fetchval` is ever called on that handle here, so no row is read and
    none is written.

    `statement_cache_size=0` because the connection goes through PgBouncer in
    transaction mode, where a cached server-side statement belongs to a session
    that will not be there next time.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures: dict[str, list[tuple[str, str]]] = {}
            for skill, sqls in statements.items():
                for sql in sqls:
                    try:
                        await conn.prepare(sql)
                    except Exception as exc:                  # noqa: BLE001
                        failures.setdefault(skill, []).append(
                            (sql, f"{type(exc).__name__}: {exc}")
                        )
            return failures
        finally:
            await conn.close()

    return asyncio.run(run())


@pytest.fixture(scope="module")
def captured():
    """The statements, captured once for the whole file."""
    return _capture_everything()


@pytest.fixture(scope="module")
def parse_failures(captured):
    """Which of them the server refuses to plan. Connects ONCE.

    A synchronous fixture running its own loop, deliberately: the suite pins
    `asyncio_default_fixture_loop_scope = function`, so a module-scoped async
    fixture would be sharing a loop it does not own.
    """
    if live_dsn() is None:
        pytest.skip(SKIP_REASON)
    try:
        return _prepare_all(captured)
    except Exception as exc:                                  # noqa: BLE001
        pytest.skip(f"could not reach the database: {exc}\n\n{SKIP_REASON}")


# ══════════════════════════════════════════════════════════════════════════════
#  The capture half — runs everywhere, including with no database
# ══════════════════════════════════════════════════════════════════════════════

def test_the_capture_sees_the_whole_shelf(captured):
    """Guard on the harness itself, and it runs offline.

    If capture silently stopped working, every parse test below would pass by
    parsing nothing — the exact failure this file exists to end, reproduced
    inside the file that ends it. Measured 2026-08-21: 202 distinct statements
    from 82 of the 85 readable skills.
    """
    with_sql = {name for name, sqls in captured.items() if sqls}
    total = sum(len(sqls) for sqls in captured.values())

    assert len(with_sql) >= 75, (
        f"only {len(with_sql)} skills yielded any SQL, out of "
        f"{len(captured)}. The capture pool has stopped being called — check "
        f"whether handlers now take their connection some other way."
    )
    assert total >= 180, (
        f"only {total} statements captured; expected at least 180"
    )


def test_the_handlers_that_run_no_sql_are_the_ones_that_never_did(captured):
    """Three skills are pure judgement — they are handed the thing to judge and
    query nothing. Pinned so that a handler which QUIETLY STOPS querying (an
    early return, a swallowed exception) shows up as a change rather than as a
    silently smaller capture."""
    silent = sorted(name for name, sqls in captured.items() if not sqls)
    assert silent == ["check_expense_policy", "match_bank_transactions",
                      "score_candidate"], (
        f"the skills issuing no SQL are now {silent}. Every other handler on "
        f"the shelf reads the org's own records; one that has stopped is "
        f"either broken or has become a pure function, and either way it is "
        f"not something to discover from a smaller number."
    )


def test_no_write_skill_is_ever_captured(captured):
    """Read from the frozenset, never from the names. `send_campaign` sends
    real mail and OUTBOUND_MODE is live on staging."""
    assert WRITE_SKILL_FUNCTIONS, "the write ledger is empty"
    ran = set(captured) & set(WRITE_SKILL_FUNCTIONS)
    assert not ran, f"a write skill was called: {sorted(ran)}"


def test_the_capture_pool_cannot_reach_a_database():
    """It has no DSN, no connection and no way to get one. Stated as a test
    because the alternative — a capture harness that quietly used the real pool
    — would run 216 statements against production."""
    pool = CapturePool(permissive=True)
    assert not hasattr(pool, "_con")
    assert not hasattr(pool, "connect")
    source = inspect.getsource(CapturePool)
    assert "asyncpg" not in source
    assert "get_pool" not in source


def test_nothing_in_this_file_executes_a_captured_statement():
    """The live half may only Parse and Describe.

    Pinned by source: the connection is used for `prepare` and for the session
    `search_path`, and for nothing else. A `fetch` on a captured statement
    would run a skill's query against the shared database, which is the one
    thing this file must never do.
    """
    body = inspect.getsource(_prepare_all)
    assert "conn.prepare(sql)" in body
    for forbidden in ("fetch(", "fetchrow(", "fetchval(", "executemany(",
                      "cursor("):
        assert "conn." + forbidden not in body, (
            f"conn.{forbidden} appears in the live half. Captured statements "
            f"are planned, never run."
        )
    executes = re.findall(r"conn\.execute\(([^)]*)\)", body)
    assert executes == ["_SEARCH_PATH"], (
        f"the only statement this file may execute is the session search_path; "
        f"found {executes}"
    )


# ══════════════════════════════════════════════════════════════════════════════
#  The live half
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("skill_function", _readable_skills())
def test_every_statement_a_skill_would_run_can_be_planned(
        skill_function, parse_failures):
    """Parse and Describe against the live catalogue. Nothing is executed."""
    failures = parse_failures.get(skill_function, [])
    assert not failures, (
        f"{skill_function} would raise on the first run:\n\n"
        + "\n\n".join(
            f"  {error}\n  ---\n{sql.strip()[:1200]}" for sql, error in failures
        )
        + "\n\nThe handler names something the database does not have, or "
          "leaves a parameter's type for the server to guess. Fix the handler: "
          "a column that is missing here is a column the schema never had, and "
          "an untyped parameter expression is an instant 500 behind PgBouncer."
    )


def test_the_parser_would_have_caught_the_bug_that_prompted_this_file(
        parse_failures):
    """Ship a failing check and prove it fails.

    `find_coverage_gaps` selected `sd.min_staff` from a table that has never
    had that column. This asserts the mechanism actually rejects it — a
    `prepare()` that accepted anything would make every test above vacuous, and
    the way this file would go quietly wrong is by connecting to something that
    plans nothing.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            with pytest.raises(asyncpg.exceptions.UndefinedColumnError):
                await conn.prepare(
                    "SELECT sd.min_staff FROM public.manav_shift_definitions sd"
                )
            # And the other half of the promise: a statement that IS valid
            # plans without touching a row.
            stmt = await conn.prepare(
                "SELECT id FROM public.manav_shift_definitions "
                "WHERE org_id = $1::uuid"
            )
            assert stmt is not None
        finally:
            await conn.close()

    asyncio.run(run())


def test_the_skip_message_names_the_command():
    """A check that skips without saying how to run it is a check nobody
    runs."""
    assert "railway run" in SKIP_REASON
    assert "min_staff" in inspect.getsource(
        test_the_parser_would_have_caught_the_bug_that_prompted_this_file)
