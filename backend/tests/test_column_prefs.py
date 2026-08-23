"""Per-user column arrangements (inbox item 3): grammar on save, resolution on
read, one conflict target per row shape, and the router mounted on its own app.

Same method as test_tab_prefs.py — a recording pool proves WIRING (what was
refused before any SQL ran, what got bound, which conflict target the upsert
names). Migration 198 owns the table, and the LIVE SQL PROBE IS OWED TO THE
MAIN SESSION: a mock pool hides bad SQL (the credits `$1+$2` untyped parse
error 500'd every spend and no suite noticed).

The assertions that matter most:

  · every malformed body is refused with a 422 NAMING the offence, and the
    pool is never touched by a refused request;
  · resolution is personal > org, applied server-side in GET, insensitive to
    the order the rows arrive in;
  · the personal upsert names the PARTIAL index's predicate in its conflict
    target — ON CONFLICT (user_id, table_key) WHERE user_id IS NOT NULL — and
    names the SAME target every time (a drifted spelling is an
    InvalidColumnReferenceError live, invisible to a mock);
  · every jsonb parameter is CAST (PgBouncer turns an untyped parse error into
    an instant 500);
  · the org PUT is 403 without admin_org_id and writes nothing;
  · every statement is schema-qualified (the shadow-tables lesson);
  · THERE IS NO TABLE CATALOGUE — a table key nobody has heard of saves fine,
    which is the compatibility promise this whole design rests on.

The last block MOUNTS the router on a bare FastAPI app rather than importing
`server`, because registering it in server.py is the main session's one line.
These tests pass whether or not that line has landed.
"""
import asyncio
import datetime
import json

import pytest
from fastapi import HTTPException

from routers import column_prefs as cp

USER = {"user_id": "user_aaa111"}
OTHER = {"user_id": "user_bbb222"}
ORG = "22222222-2222-2222-2222-222222222222"
WHEN = datetime.datetime(2026, 8, 22, tzinfo=datetime.timezone.utc)


def run(coro):
    return asyncio.run(coro)


class RecordingPool:
    def __init__(self):
        self.calls = []
        self._rows = []
        self._row = None
        self._status = "DELETE 1"

    async def fetch(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._rows

    async def fetchrow(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._row

    async def execute(self, sql, *args):
        self.calls.append((" ".join(sql.split()), list(args)))
        return self._status


@pytest.fixture
def pool(monkeypatch):
    p = RecordingPool()

    async def _get_pool():
        return p

    monkeypatch.setattr(cp, "get_pool", _get_pool)
    return p


@pytest.fixture
def as_admin(monkeypatch):
    import middleware.roles as roles

    async def _yes(user_id, org_id=None):
        return org_id

    monkeypatch.setattr(roles, "admin_org_id", _yes)


@pytest.fixture
def not_admin(monkeypatch):
    import middleware.roles as roles

    async def _no(user_id, org_id=None):
        return None

    monkeypatch.setattr(roles, "admin_org_id", _no)


def _cols(*specs):
    """('name',), ('email', True), ('phone', False, 220) → ColumnPref list."""
    out = []
    for s in specs:
        cid = s[0]
        hidden = s[1] if len(s) > 1 else False
        width = s[2] if len(s) > 2 else None
        out.append(cp.ColumnPref(id=cid, hidden=hidden, width=width))
    return cp.ColumnPrefPut(columns=out)


def _row(table_key, columns, user_id=None):
    return {"table_key": table_key, "columns": columns, "user_id": user_id}


# ── the grammar, and the catalogue that deliberately does not exist ──────────

def test_there_is_no_table_catalogue():
    """The one deliberate deviation from tab_prefs.py, pinned so nobody
    'fixes' it into an allowlist. ~100 tables, moving weekly: a list here would
    422 a table added on Tuesday when somebody arranged it on Wednesday, and
    the failure would look like a bug in the table."""
    assert not hasattr(cp, "TABLE_KEYS")
    assert not hasattr(cp, "MODULE_TABLES")
    # A key this server has never seen passes the grammar and is accepted.
    cp._checked("nowhere.invented_last_night", _cols(("a",)))


def test_the_table_keys_the_build_uses_satisfy_the_grammar():
    for key in ("graha.contacts", "graha.clients", "ganit.invoices",
                "manav.dsc", "vikray.stock", "catalogue.products",
                "ganit.bank_lines", "graha.documents"):
        assert cp.TABLE_KEY.match(key), key


@pytest.mark.parametrize("key", [
    "", "Graha.contacts", "graha", "graha.", ".contacts",
    "graha contacts", "graha.a.b.c.d", "graha.contacts;drop",
])
def test_a_malformed_table_key_is_422(key):
    with pytest.raises(HTTPException) as e:
        cp._checked(key, _cols(("name",)))
    assert e.value.status_code == 422
    assert "table key" in e.value.detail


def test_the_column_ids_the_build_uses_satisfy_the_grammar():
    for cid in ("name", "contact_type", "created_at", "lead_score",
                "client-report", "gstin", "a" * 60):
        assert cp.COLUMN_ID.match(cid), cid


def test_an_empty_arrangement_is_refused():
    with pytest.raises(HTTPException) as e:
        cp._checked("graha.contacts", cp.ColumnPrefPut(columns=[]))
    assert e.value.status_code == 422
    assert "at least one column" in e.value.detail


def test_too_many_columns_is_refused():
    body = _cols(*[(f"c{i}",) for i in range(cp.MAX_COLUMNS + 1)])
    with pytest.raises(HTTPException) as e:
        cp._checked("graha.contacts", body)
    assert e.value.status_code == 422
    assert str(cp.MAX_COLUMNS) in e.value.detail


def test_a_duplicate_column_id_is_refused():
    with pytest.raises(HTTPException) as e:
        cp._checked("graha.contacts", _cols(("name",), ("email",), ("name",)))
    assert e.value.status_code == 422
    assert "appears twice" in e.value.detail


@pytest.mark.parametrize("cid", ["", "Name", "na me", "_name", "n" * 61, "na;me"])
def test_a_malformed_column_id_is_refused(cid):
    with pytest.raises(HTTPException) as e:
        cp._checked("graha.contacts", _cols((cid,)))
    assert e.value.status_code == 422
    assert "column id" in e.value.detail


@pytest.mark.parametrize("w", [0, 1, cp.MIN_WIDTH - 1, cp.MAX_WIDTH + 1, -20])
def test_a_width_outside_the_bounds_is_refused(w):
    with pytest.raises(HTTPException) as e:
        cp._checked("graha.contacts", _cols(("name", False, w)))
    assert e.value.status_code == 422
    assert "width" in e.value.detail


def test_the_bounds_themselves_are_accepted():
    cp._checked("graha.contacts", _cols(("a", False, cp.MIN_WIDTH),
                                        ("b", False, cp.MAX_WIDTH),
                                        ("c", False, None)))


def test_hiding_every_column_is_refused():
    """The one SEMANTIC rule. An arrangement that hides everything renders a
    table whose own customise control is unreachable — a preference that locks
    its owner out of the screen it applies to."""
    with pytest.raises(HTTPException) as e:
        cp._checked("graha.contacts", _cols(("a", True), ("b", True)))
    assert e.value.status_code == 422
    assert "at least one column visible" in e.value.detail
    # …and hiding all but one is fine.
    cp._checked("graha.contacts", _cols(("a", True), ("b", False)))


def test_a_refused_body_never_reaches_the_pool(pool):
    with pytest.raises(HTTPException):
        run(cp.put_my_column_prefs("graha.contacts",
                                   cp.ColumnPrefPut(columns=[]), user=USER))
    with pytest.raises(HTTPException):
        run(cp.put_my_column_prefs("NOT A KEY", _cols(("a",)), user=USER))
    assert pool.calls == []


# ── resolution: personal > org > the page's own columns ─────────────────────

def test_get_resolves_personal_over_org(pool):
    pool._rows = [
        _row("graha.contacts", [{"id": "email", "hidden": False, "width": None}]),
        _row("graha.contacts", [{"id": "name", "hidden": False, "width": 200}],
             user_id=USER["user_id"]),
    ]
    out = run(cp.get_column_prefs(user=USER, org_id=ORG))
    assert out["graha.contacts"]["source"] == "personal"
    assert out["graha.contacts"]["columns"] == [
        {"id": "name", "hidden": False, "width": 200}]


def test_resolution_does_not_depend_on_row_order(pool):
    """asyncpg gives no ordering guarantee, so the fold must not need one."""
    org = _row("graha.contacts", [{"id": "email"}])
    mine = _row("graha.contacts", [{"id": "name"}], user_id=USER["user_id"])
    for rows in ([org, mine], [mine, org]):
        pool._rows = rows
        out = run(cp.get_column_prefs(user=USER, org_id=ORG))
        assert out["graha.contacts"]["source"] == "personal"
        assert [c["id"] for c in out["graha.contacts"]["columns"]] == ["name"]


def test_an_org_row_alone_resolves_as_org(pool):
    pool._rows = [_row("ganit.invoices", [{"id": "number"}])]
    out = run(cp.get_column_prefs(user=USER, org_id=ORG))
    assert out["ganit.invoices"]["source"] == "org"


def test_nothing_saved_anywhere_is_an_empty_object(pool):
    """The floor is the page's declared columns, which are frontend CODE and
    never a row — so the server has nothing to say."""
    pool._rows = []
    assert run(cp.get_column_prefs(user=USER, org_id=ORG)) == {}


def test_get_scopes_on_the_token_and_the_current_org(pool):
    run(cp.get_column_prefs(user=USER, org_id=ORG))
    sql, args = pool.calls[0]
    assert args == [USER["user_id"], ORG]
    assert "staging.user_column_prefs" in sql
    assert "$1::text" in sql and "$2::uuid" in sql


def test_jsonb_arrives_as_a_string_and_still_reads(pool):
    """asyncpg hands jsonb back as str unless a codec is registered, and this
    router does not get to assume the pool's registration."""
    pool._rows = [_row("graha.contacts",
                       json.dumps([{"id": "name", "hidden": True, "width": 90}]))]
    out = run(cp.get_column_prefs(user=USER, org_id=ORG))
    assert out["graha.contacts"]["columns"] == [
        {"id": "name", "hidden": True, "width": 90}]


@pytest.mark.parametrize("payload", ["not json", '{"id":"name"}', None, 7,
                                     '[{"nope": 1}, "bare", {"id": 3}]'])
def test_a_corrupt_payload_reads_as_no_arrangement_not_a_500(pool, payload):
    """A 500 on read would take the whole table down over a preference."""
    pool._rows = [_row("graha.contacts", payload)]
    out = run(cp.get_column_prefs(user=USER, org_id=ORG))
    assert out["graha.contacts"]["columns"] == []


def test_a_bool_width_is_not_an_int_width(pool):
    """`True` is an int in Python and would sail through a naive isinstance."""
    pool._rows = [_row("graha.contacts", [{"id": "name", "width": True}])]
    out = run(cp.get_column_prefs(user=USER, org_id=ORG))
    assert out["graha.contacts"]["columns"][0]["width"] is None


# ── the personal write ──────────────────────────────────────────────────────

def test_the_personal_upsert_names_the_partial_index_predicate(pool):
    pool._row = {"updated_at": WHEN}
    out = run(cp.put_my_column_prefs(
        "graha.contacts", _cols(("name", False, 200), ("email", True)), user=USER))
    sql, args = pool.calls[0]
    assert "ON CONFLICT (user_id, table_key) WHERE user_id IS NOT NULL" in sql
    assert "staging.user_column_prefs" in sql
    assert args[0] == USER["user_id"]
    assert args[1] == "graha.contacts"
    assert json.loads(args[2]) == [
        {"id": "name", "hidden": False, "width": 200},
        {"id": "email", "hidden": True, "width": None},
    ]
    assert out["source"] == "personal"
    assert out["updated_at"] == WHEN.isoformat()


def test_every_parameter_in_every_write_is_cast(pool):
    """PgBouncer turns an untyped parse error into an instant 500 — the credits
    incident. `$3::jsonb` fed from a Python string is exactly that shape."""
    pool._row = {"updated_at": WHEN}
    run(cp.put_my_column_prefs("graha.contacts", _cols(("name",)), user=USER))
    sql, _ = pool.calls[0]
    assert "$1::text" in sql and "$2::text" in sql and "$3::jsonb" in sql


def test_the_write_keys_on_the_token_never_on_the_path(pool):
    """The me.py rule: no handler takes a user id from a path, query or body,
    so USER cannot write OTHER's row however the request is shaped."""
    pool._row = {"updated_at": WHEN}
    run(cp.put_my_column_prefs("graha.contacts", _cols(("name",)), user=USER))
    assert OTHER["user_id"] not in pool.calls[0][1]
    assert pool.calls[0][1][0] == USER["user_id"]


def test_the_delete_is_scoped_by_the_callers_own_id(pool):
    out = run(cp.delete_my_column_prefs("graha.contacts", user=USER))
    sql, args = pool.calls[0]
    assert "user_id = $1::text AND table_key = $2::text" in sql
    assert args == [USER["user_id"], "graha.contacts"]
    assert out == {"removed": True, "table_key": "graha.contacts"}


def test_deleting_nothing_says_so(pool):
    pool._status = "DELETE 0"
    assert run(cp.delete_my_column_prefs("graha.contacts", user=USER))["removed"] is False


def test_the_delete_still_checks_the_key_shape(pool):
    with pytest.raises(HTTPException) as e:
        run(cp.delete_my_column_prefs("NOT A KEY", user=USER))
    assert e.value.status_code == 422
    assert pool.calls == []


# ── the org default ─────────────────────────────────────────────────────────

def test_the_org_put_is_403_without_admin_and_writes_nothing(pool, not_admin):
    with pytest.raises(HTTPException) as e:
        run(cp.put_org_column_prefs("graha.contacts", _cols(("name",)),
                                    user=USER, org_id=ORG))
    assert e.value.status_code == 403
    assert pool.calls == []


def test_the_org_upsert_names_its_own_partial_index_predicate(pool, as_admin):
    pool._row = {"updated_at": WHEN}
    out = run(cp.put_org_column_prefs("graha.contacts", _cols(("name",)),
                                      user=USER, org_id=ORG))
    sql, args = pool.calls[0]
    assert "ON CONFLICT (org_id, table_key) WHERE user_id IS NULL" in sql
    assert "$1::uuid" in sql and "$3::jsonb" in sql
    assert args[0] == ORG
    assert out["source"] == "org"


def test_the_org_put_checks_the_grammar_before_the_admin_gate(pool, not_admin):
    """A malformed body is malformed whoever sent it — and a 403 on a body that
    was never valid tells the caller the wrong thing to fix."""
    with pytest.raises(HTTPException) as e:
        run(cp.put_org_column_prefs("graha.contacts",
                                    cp.ColumnPrefPut(columns=[]),
                                    user=USER, org_id=ORG))
    assert e.value.status_code == 422


def test_every_statement_is_schema_qualified(pool, as_admin):
    """The shadow-tables lesson: an unqualified name resolves by search_path,
    and PgBouncer will not honour a SET LOCAL."""
    pool._row = {"updated_at": WHEN}
    pool._rows = []
    run(cp.get_column_prefs(user=USER, org_id=ORG))
    run(cp.put_my_column_prefs("graha.contacts", _cols(("a",)), user=USER))
    run(cp.delete_my_column_prefs("graha.contacts", user=USER))
    run(cp.put_org_column_prefs("graha.contacts", _cols(("a",)),
                                user=USER, org_id=ORG))
    for sql, _ in pool.calls:
        assert "staging.user_column_prefs" in sql
        assert "user_column_prefs" not in sql.replace("staging.user_column_prefs", "")


# ── the ladder helper, shared with tab_prefs ────────────────────────────────

def test_the_ladder_helper_is_the_one_tab_prefs_uses():
    from routers import _pref_ladder, tab_prefs
    assert tab_prefs.fold_ladder is _pref_ladder.fold_ladder
    assert cp.fold_ladder is _pref_ladder.fold_ladder
    assert tab_prefs.removed is _pref_ladder.removed


def test_the_ladder_helper_folds_org_under_personal():
    from routers._pref_ladder import fold_ladder
    rows = [
        {"k": "a", "user_id": None, "v": "org"},
        {"k": "a", "user_id": "u", "v": "mine"},
        {"k": "b", "user_id": None, "v": "org"},
    ]
    out = fold_ladder(rows, "k", lambda r, p: (r["v"], p))
    assert out == {"a": ("mine", True), "b": ("org", False)}


def test_the_command_tag_parse_treats_an_empty_tag_as_nothing():
    from routers._pref_ladder import removed
    assert removed("DELETE 1") is True
    assert removed("DELETE 0") is False
    assert removed("") is False
    assert removed(None) is False


# ── mounted on its own app: the routes exist at the paths the frontend calls ─

def test_the_router_mounts_and_answers_at_the_documented_paths(monkeypatch):
    """server.py's registration is the main session's one line, so this test
    mounts the router itself. It is the only place the wire paths are pinned —
    `/api/v1/me/column-prefs` and friends — because the frontend hook hardcodes
    them and a prefix typo is a 404 that looks like an empty answer."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import auth_router
    import middleware.org_resolver as org_resolver

    p = RecordingPool()
    p._rows = []
    p._row = {"updated_at": WHEN}

    async def _get_pool():
        return p

    monkeypatch.setattr(cp, "get_pool", _get_pool)

    app = FastAPI()
    app.include_router(cp.router)
    app.dependency_overrides[auth_router.require_user] = lambda: USER
    app.dependency_overrides[org_resolver.get_org_id] = lambda: ORG

    client = TestClient(app)

    assert client.get("/api/v1/me/column-prefs").json() == {}

    r = client.put("/api/v1/me/column-prefs/graha.contacts",
                   json={"columns": [{"id": "name", "hidden": False, "width": 200}]})
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "personal"

    # The grammar answers on the wire too, not only in _checked.
    bad = client.put("/api/v1/me/column-prefs/graha.contacts",
                     json={"columns": [{"id": "name", "hidden": True}]})
    assert bad.status_code == 422
    assert "at least one column visible" in bad.text

    assert client.request(
        "DELETE", "/api/v1/me/column-prefs/graha.contacts").json()["removed"] is True


def test_a_saved_arrangement_survives_a_column_shipping_later(pool):
    """The compatibility promise, from the server's side: an arrangement saved
    before a column existed is stored and returned untouched, and the id the
    page no longer ships comes back as-is for the client to drop. The server
    never adjudicates which columns exist — that is what having no catalogue
    BUYS, and it is the whole reason the grammar is all that is pinned."""
    pool._rows = [_row("graha.contacts",
                       [{"id": "name"}, {"id": "a_column_we_deleted"}],
                       user_id=USER["user_id"])]
    out = run(cp.get_column_prefs(user=USER, org_id=ORG))
    assert [c["id"] for c in out["graha.contacts"]["columns"]] == [
        "name", "a_column_we_deleted"]
