"""A MISSING SCHEMA IS NOT `42P01`, AND THAT IS THE WHOLE TEST.

When a relation is gone Postgres raises `42P01` / `undefined_table`
(`asyncpg.UndefinedTableError`). When the SCHEMA is gone it never gets as far as
looking for the relation: it raises `3F000` / `invalid_schema_name`
(`asyncpg.InvalidSchemaNameError`), which is a SIBLING class, not a subclass. So

    except asyncpg.UndefinedTableError:      # does NOT catch a dropped schema
    sqlstate in ("42P01", "42703")           # does NOT contain 3F000

and every handler written to mean "this optional table has not been migrated
yet" quietly stops meaning it the moment a schema is dropped — which is exactly
what the `staging` → `public` consolidation does. The failure is a 500 on
`middleware/org_resolver.py`, which runs on EVERY request, and a 500 over the
Pahchan notice gate, which sits above the camera and would stop a clock-in.

WHAT THIS FILE CAN AND CANNOT PROVE. CI has no `DATABASE_URL` (`ci.yml:174`), so
a test that needs a live DSN is a test that gets skipped, and a skipped test
proves nothing. Everything here therefore runs with fabricated asyncpg errors
and with the source itself:

  · behaviour  — the three classifier predicates and the real read/write paths,
                 driven with a pool that raises `InvalidSchemaNameError`;
  · source     — every `except` clause that reaches `UndefinedTableError` also
                 reaches `InvalidSchemaNameError`, and every sqlstate tuple that
                 lists `42P01` also lists `3F000`.

THE SOURCE SCANS CARRY FLOORS. A scan that finds nothing passes vacuously, and a
vacuous ratchet is the failure mode this repo has already been bitten by twice
(`static_ratchets_are_not_coverage`). Each scan asserts a minimum count per
file, so a rename, a refactor or a broken walker fails RED instead of green.
"""

import ast
import pathlib

import asyncpg
import pytest

import middleware.org_resolver as ORG
import routers.me as ME
import routers.pahchan as PAHCHAN
import services.support_session as SUPPORT

_BACKEND = pathlib.Path(__file__).resolve().parent.parent

#: The five files this test owns, and the MINIMUM number of table-absent
#: handlers each must carry. The numbers are the count measured when this file
#: was written; they are a floor, not an equality, so adding a handler is not a
#: failure but losing one — or breaking the walker that finds them — is.
_OWNED: dict[str, int] = {
    "middleware/org_resolver.py": 1,
    "routers/hub.py": 3,
    "routers/me.py": 0,          # classifier is a predicate, covered behaviourally
    "routers/pahchan.py": 0,     # classifier is an sqlstate tuple, see below
    "services/support_session.py": 8,
}

#: Total across the five. Independently stated so that a per-file floor dropping
#: to zero cannot be compensated for by another file growing.
_MIN_HANDLERS_TOTAL = 12


class _FakePgError(Exception):
    """asyncpg errors carry `sqlstate`; the sqlstate classifiers read nothing
    else, so this is a faithful stand-in for one."""

    def __init__(self, sqlstate: str):
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


def _schema_gone() -> asyncpg.InvalidSchemaNameError:
    """The real exception class, constructed exactly as asyncpg would raise it.

    Not a fake: the point of half these assertions is that the CLASS is not a
    subclass of `UndefinedTableError`, and a stand-in cannot demonstrate that.
    """
    return asyncpg.InvalidSchemaNameError('schema "staging" does not exist')


# ═════════════════════════════════════════════════════════════════════════════
# 0 · THE PREMISE
# ═════════════════════════════════════════════════════════════════════════════

def test_the_two_errors_are_siblings_and_not_parent_and_child():
    """If this ever fails, every other test in this file is unnecessary."""
    assert asyncpg.InvalidSchemaNameError.sqlstate == "3F000"
    assert asyncpg.UndefinedTableError.sqlstate == "42P01"
    assert not issubclass(
        asyncpg.InvalidSchemaNameError, asyncpg.UndefinedTableError
    ), "a dropped schema would already be caught and none of this would be needed"
    assert not isinstance(_schema_gone(), asyncpg.UndefinedTableError)


# ═════════════════════════════════════════════════════════════════════════════
# 1 · THE THREE CLASSIFIERS, BY BEHAVIOUR
# ═════════════════════════════════════════════════════════════════════════════

def test_me_missing_table_treats_a_dropped_schema_as_nowhere_to_write():
    # 503 "your request was NOT recorded", not a 500 the caller reads as
    # "try again" while their deletion request quietly never existed.
    assert ME._missing_table(_schema_gone()) is True
    assert ME._missing_table(asyncpg.UndefinedTableError("relation")) is True


def test_me_missing_table_still_refuses_to_swallow_anything_else():
    assert ME._missing_table(asyncpg.UniqueViolationError("dupe")) is False
    assert ME._missing_table(asyncpg.PostgresConnectionError("closed")) is False
    assert ME._missing_table(ValueError("not a database error at all")) is False


@pytest.mark.parametrize("state", ["42P01", "42703", "3F000"])
def test_pahchan_notice_store_absent_covers_the_schema_too(state):
    # routers/pahchan.py's own rule: NOTHING BLOCKS A PUNCH. This acknowledgement
    # sits above the camera, so an uncaught 3F000 here is a person who cannot
    # clock in.
    assert PAHCHAN._notice_store_absent(_FakePgError(state)) is True
    assert PAHCHAN._notice_store_absent(_schema_gone()) is True


@pytest.mark.parametrize("state", ["23505", "23503", "22001", "40001", "08006"])
def test_pahchan_notice_store_absent_is_still_narrow(state):
    assert PAHCHAN._notice_store_absent(_FakePgError(state)) is False


def test_support_session_absent_covers_both_shapes():
    assert SUPPORT._absent(_schema_gone()) is True
    assert SUPPORT._absent(asyncpg.UndefinedTableError("relation")) is True
    assert SUPPORT._absent(asyncpg.PostgresConnectionError("closed")) is False


# ═════════════════════════════════════════════════════════════════════════════
# 2 · THE PATHS THEMSELVES, DRIVEN WITH A POOL THAT HAS NO SCHEMA
# ═════════════════════════════════════════════════════════════════════════════

class _SchemaGonePool:
    """Every query raises 3F000, which is what a dropped schema looks like."""

    async def fetch(self, sql, *args):
        raise _schema_gone()

    async def fetchrow(self, sql, *args):
        raise _schema_gone()

    async def fetchval(self, sql, *args):
        raise _schema_gone()


_ORG_ID = "11111111-1111-1111-1111-111111111111"
_USER_ID = "usr_agent"
_SESSION_ID = "22222222-2222-2222-2222-222222222222"


async def test_org_resolver_answers_no_session_instead_of_500ing_every_request():
    """The highest blast radius in the change: this runs on every request."""
    row = await ORG.active_support_session(
        _SchemaGonePool(), user_id=_USER_ID, org_id=_ORG_ID
    )
    assert row is None, (
        "middleware/org_resolver.py let 3F000 escape — that is a 500 on EVERY "
        "request, not a degraded page"
    )


async def test_org_resolver_still_fails_closed_on_a_real_database_fault():
    """The widening must not become "any error means no session". A connection
    fault has to raise: refusing is safe, guessing is not."""

    class _Broken(_SchemaGonePool):
        async def fetchrow(self, sql, *args):
            raise asyncpg.PostgresConnectionError("server closed the connection")

    with pytest.raises(asyncpg.PostgresConnectionError):
        await ORG.active_support_session(
            _Broken(), user_id=_USER_ID, org_id=_ORG_ID
        )


async def test_every_support_session_read_answers_empty_when_the_schema_is_gone():
    pool = _SchemaGonePool()
    assert await SUPPORT.list_for_org(pool, _ORG_ID) == []
    assert await SUPPORT.list_for_agent(pool, _USER_ID) == []
    assert await SUPPORT.list_all(pool) == []
    assert await SUPPORT.get_session(pool, _SESSION_ID) is None
    assert await SUPPORT.list_help_requests(pool, org_ids=None) == []


async def test_a_support_write_against_a_gone_schema_says_503_not_500():
    """"Your approval silently did nothing" is the worst possible answer to a
    customer pressing Approve — and so is a 500 with no explanation."""

    class _OrgExistsButNothingElseDoes(_SchemaGonePool):
        async def fetchrow(self, sql, *args):
            if "organisations" in sql:
                return {"id": _ORG_ID, "name": "Unicode Group"}
            raise _schema_gone()

    with pytest.raises(SUPPORT.SupportSessionError) as exc:
        await SUPPORT.request_session(
            _OrgExistsButNothingElseDoes(),
            requested_by=_USER_ID,
            org_id=_ORG_ID,
            reason="customer reported a locked invoice run",
            modules=["ganit"],
            access_level="viewer",
            ttl_hours=2,
            requestable=ORG.SUPPORT_REQUESTABLE_MODULES,
        )
    assert exc.value.status == 503
    assert "111" in exc.value.detail


async def test_an_org_asking_aekam_for_help_gets_503_not_500_when_the_schema_is_gone():
    """`raise_help_request` writes migration 182's table, which genuinely is
    unapplied — so its 503 is the answer a real customer sees today. The INSERT
    is inside a transaction, so this needs a pool with a real-shaped `acquire`
    and `transaction` rather than the flat one above.
    """

    class _AskPool:
        def acquire(self):
            pool = self

            class _C:
                async def __aenter__(self):
                    return pool

                async def __aexit__(self, *e):
                    return False

            return _C()

        def transaction(self):
            class _T:
                async def __aenter__(self):
                    return None

                async def __aexit__(self, *e):
                    return False

            return _T()

        async def fetch(self, sql, *args):
            # `_aekam_recipients` — an ask with nobody to send it to is refused
            # for a different reason, which would not exercise the handler.
            return [{"user_id": "usr_sid", "display_name": "Sid (Aekam)"}]

        async def fetchrow(self, sql, *args):
            if "organisations" in sql:
                return {"id": _ORG_ID, "name": "Unicode Group"}
            if "FROM users" in sql:
                return {"display_name": "Rohit (Unicode Group)"}
            raise _schema_gone()

    with pytest.raises(SUPPORT.SupportSessionError) as exc:
        await SUPPORT.raise_help_request(
            _AskPool(),
            org_id=_ORG_ID,
            raised_by="usr_rohit",
            reason="the invoice run will not close and month end is tomorrow",
            modules=["ganit"],
            requestable=ORG.SUPPORT_REQUESTABLE_MODULES,
            aekam_roles=("platform_admin",),
        )
    assert exc.value.status == 503
    assert "182" in exc.value.detail


async def test_the_pahchan_notice_gate_still_opens_when_the_schema_is_gone():
    """`_notice_ack` returns None rather than raising, so the client shows the
    notice again — a nuisance — instead of the camera never unlocking."""
    got = await PAHCHAN._notice_ack(
        _SchemaGonePool(), _ORG_ID, _USER_ID, PAHCHAN.PAHCHAN_NOTICE_VERSION
    )
    assert got is None


# ═════════════════════════════════════════════════════════════════════════════
# 3 · THE SOURCE SCANS
#
# Behaviour above covers the paths a fake pool can reach. These cover the ones
# it cannot — a handler buried in a router that needs a request, a session and
# a platform role to reach — by reading the code instead of running it.
# ═════════════════════════════════════════════════════════════════════════════

def _leaf(expr) -> str | None:
    """`asyncpg.exceptions.UndefinedTableError` → `UndefinedTableError`."""
    if isinstance(expr, ast.Attribute):
        return expr.attr
    if isinstance(expr, ast.Name):
        return expr.id
    return None


def _tuple_aliases(tree: ast.Module) -> dict[str, set[str]]:
    """Module-level names bound to a tuple of exception classes.

    `services/support_session.py` widens eight handlers through one
    `_STORE_ABSENT` tuple rather than repeating itself eight times. Without
    resolving that here the scan below would see eight handlers naming nothing
    it recognises, find four sites instead of twelve, and pass while proving a
    third of what it claims.
    """
    aliases: dict[str, set[str]] = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Tuple):
            continue
        members = {n for n in (_leaf(e) for e in node.value.elts) if n}
        if not members:
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                aliases[target.id] = members
    return aliases


def _handler_catches(handler: ast.ExceptHandler, aliases) -> set[str]:
    """The exception class names one `except` clause reaches, aliases expanded."""
    if handler.type is None:
        return set()
    parts = (
        handler.type.elts
        if isinstance(handler.type, ast.Tuple)
        else [handler.type]
    )
    caught: set[str] = set()
    for part in parts:
        name = _leaf(part)
        if name is None:
            continue
        caught |= aliases.get(name, {name})
    return caught


def _scan(rel: str):
    """(lineno, caught-names) for every `except` clause in one owned file."""
    tree = ast.parse((_BACKEND / rel).read_text(encoding="utf-8"))
    aliases = _tuple_aliases(tree)
    return [
        (node.lineno, _handler_catches(node, aliases))
        for node in ast.walk(tree)
        if isinstance(node, ast.ExceptHandler)
    ]


@pytest.mark.parametrize("rel", sorted(_OWNED))
def test_every_undefined_table_handler_also_catches_a_missing_schema(rel):
    found = 0
    for lineno, caught in _scan(rel):
        if "UndefinedTableError" not in caught:
            continue
        found += 1
        assert "InvalidSchemaNameError" in caught, (
            f"{rel}:{lineno} catches UndefinedTableError (42P01) but not "
            f"InvalidSchemaNameError (3F000). A MISSING SCHEMA IS NOT 42P01 — "
            f"Postgres raises invalid_schema_name before it looks for the "
            f"relation, so this handler stops degrading and starts 500ing the "
            f"moment a schema is dropped. Caught here: {sorted(caught)}"
        )

    assert found >= _OWNED[rel], (
        f"{rel}: expected at least {_OWNED[rel]} table-absent handler(s), found "
        f"{found}. Either a handler was deleted or this scan stopped finding "
        f"them — and a scan that finds nothing passes without proving anything."
    )


def test_the_handler_scan_is_not_vacuous_across_the_five_files():
    total = sum(
        1
        for rel in _OWNED
        for _lineno, caught in _scan(rel)
        if "UndefinedTableError" in caught
    )
    assert total >= _MIN_HANDLERS_TOTAL, (
        f"found {total} table-absent handlers across the five owned files, "
        f"expected at least {_MIN_HANDLERS_TOTAL}. This floor exists because "
        f"the per-file assertions are all satisfied by a scan that returns "
        f"nothing."
    )


def _sqlstate_tuples(rel: str):
    """(lineno, values) for every literal tuple of plain strings in one file."""
    tree = ast.parse((_BACKEND / rel).read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Tuple) or not node.elts:
            continue
        values = [
            e.value
            for e in node.elts
            if isinstance(e, ast.Constant) and isinstance(e.value, str)
        ]
        if len(values) == len(node.elts):
            out.append((node.lineno, values))
    return out


def test_every_sqlstate_set_listing_42P01_also_lists_3F000():
    found = 0
    for rel in _OWNED:
        for lineno, values in _sqlstate_tuples(rel):
            if "42P01" not in values:
                continue
            found += 1
            assert "3F000" in values, (
                f"{rel}:{lineno} classifies by sqlstate and lists 42P01 without "
                f"3F000. A MISSING SCHEMA IS NOT 42P01 — it is 3F000, "
                f"invalid_schema_name — so this set stops recognising 'the "
                f"store is not there' the moment a schema is dropped. "
                f"Listed here: {values}"
            )

    assert found >= 1, (
        "no sqlstate tuple containing 42P01 was found in any owned file. "
        "routers/pahchan.py carries one; if this scan cannot see it, it is "
        "not checking anything."
    )


# ═════════════════════════════════════════════════════════════════════════════
# 4 · THE HANDLERS THAT WERE DELIBERATELY LEFT ALONE
# ═════════════════════════════════════════════════════════════════════════════

def test_the_undefined_column_fallbacks_in_hub_are_not_widened():
    """`routers/hub.py` catches `UndefinedColumnError` (42703) in three places to
    retry the SAME query against the SAME table with migration 119's columns
    dropped. Those are not table-absent handlers and must not be widened:

    if the schema were gone, the fallback query would raise 3F000 as well, so
    catching it would buy an identical second failure and a misleading `except`
    clause. This test exists so a future 3F000 sweep does not "finish the job".
    """
    fallbacks = [
        (lineno, caught)
        for lineno, caught in _scan("routers/hub.py")
        if "UndefinedColumnError" in caught
    ]
    assert len(fallbacks) >= 3, (
        f"expected at least 3 UndefinedColumnError fallbacks in routers/hub.py, "
        f"found {len(fallbacks)} — this test is asserting nothing"
    )
    for lineno, caught in fallbacks:
        assert "InvalidSchemaNameError" not in caught, (
            f"routers/hub.py:{lineno} widened a missing-COLUMN fallback to catch "
            f"3F000. The fallback re-queries the same table in the same schema, "
            f"so on a missing schema it raises 3F000 again — this hides the real "
            f"error behind an identical one instead of degrading."
        )
