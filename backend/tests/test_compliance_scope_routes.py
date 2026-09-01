"""The override surface: a uuid in a request body is a PARAMETER, not a secret.

`routers/compliance_settings.py` grew four handlers and five helpers when
migration 253 made a compliance rule overridable for ONE client or ONE
employee. Two of them carry security properties the module docstring is built
around, and neither had a test:

  · `_scope_name` — the org-ownership check. `graha_clients.id` and
    `manav_employees.id` are unique TABLE-WIDE, so a statement that filters on
    the id alone reads and writes across organisations, silently, with no error
    and no log line. The id arrives from a query string or a request body,
    where it is guessable and quotable from another tenant's URL.

  · `_named_effective` — the id scrub. `resolve_effective` hands back a
    `set_by` at THREE levels (the effective rule, its `default` and its
    `override`) plus the `scope_id`, and none of those four may reach a
    browser: the product's rule is that a user, member or org id is never
    rendered, and `frontend/scripts/check-rendered-ids.mjs` is positional so it
    would not catch `{rule.set_by}` inside a template string.

── WHY THE FAKE DATABASE EVALUATES THE `WHERE` CLAUSE ───────────────────────

A tenancy test written against a scripted pool — "when the pool returns None,
raise 404" — proves nothing. It is green over an implementation with the
`org_id` predicate deleted, because a script that was told to answer None
answers None either way. That is the exact fault this repo has found five
times: an assertion satisfied by its own shape.

So `_Db` below is a small row store that READS THE PREDICATE THE ROUTER WROTE:
it pulls `col = $n`, `col = 'literal'`, `col = TRUE` and `col = ANY($n)` out of
the statement's own `WHERE` clause and applies them to its rows. Delete
`AND org_id=$2::uuid` from `_SCOPE_ROW` and the store stops filtering by
organisation, exactly as Postgres would — and every tenancy test here goes red.
It is a fake, not a mock: the statement decides the answer.

What it cannot do is prove a column exists. That is the live half of
`test_compliance_settings_screen.py` (Parse + Describe against the real
catalogue), and this file leaves it there rather than restating it.
"""
import copy
import re
import uuid as uuidlib
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import routers.compliance_settings as router_mod
from services import compliance_settings as svc

# ── identities ───────────────────────────────────────────────────────────
# Values, never sources. Nothing built from them is executed anywhere.

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"

CLIENT = "aaaaaaa1-1111-4111-8111-aaaaaaaaaaa1"
OTHER_CLIENT = "bbbbbbb2-2222-4222-8222-bbbbbbbbbbb2"   # belongs to OTHER_ORG
ARCHIVED_CLIENT = "ccccccc3-3333-4333-8333-ccccccccccc3"
BLANK_CLIENT = "ddddddd4-4444-4444-8444-ddddddddddd4"
EMPLOYEE = "eeeeeee5-5555-4555-8555-eeeeeeeeeee5"
OTHER_EMPLOYEE = "fffffff6-6666-4666-8666-fffffffffff6"  # belongs to OTHER_ORG
NO_SUCH_ID = "09999999-9999-4999-8999-999999999999"

FIRM_SETTER = "user_firm0001"
CLIENT_SETTER = "user_over0002"
CALLER = "user_caller003"

SET_AT = datetime(2026, 8, 26, 9, 30, tzinfo=timezone.utc)
WROTE_AT = datetime(2026, 8, 31, 12, 0, tzinfo=timezone.utc)


class _FakeRequest:
    """Just enough for `services.audit.emit`."""
    headers: dict = {}
    client = None


# ══════════════════════════════════════════════════════════════════════════
#  A fake database that obeys the statement it is given
# ══════════════════════════════════════════════════════════════════════════

_TABLE = re.compile(r"(?:INSERT\s+INTO|FROM)\s+public\.(\w+)", re.I)
_EQ_PARAM = re.compile(r"(?:\w+\.)?(\w+)\s*=\s*\$(\d+)(?:::\w+)?")
_EQ_ANY = re.compile(r"(?:\w+\.)?(\w+)\s*=\s*ANY\(\$(\d+)")
_EQ_LIT = re.compile(r"(?:\w+\.)?(\w+)\s*=\s*'([^']*)'")
_EQ_TRUE = re.compile(r"(?:\w+\.)?(\w+)\s*=\s*TRUE\b", re.I)
_LIMIT = re.compile(r"\bLIMIT\s+\$(\d+)", re.I)
_ILIKE = re.compile(r"\$(\d+)::text\s+IS\s+NULL\s+OR\s+(\w+)\s+ILIKE", re.I)
_UNNAMED = re.compile(r"COALESCE\(NULLIF\(btrim\((\w+)\),\s*''\),\s*'([^']*)'\)")
_RETURNING = re.compile(r"\bRETURNING\b(.*)$", re.I | re.S)


def _norm(value):
    return None if value is None else str(value)


def _where(sql: str) -> str:
    parts = re.split(r"\bWHERE\b", sql, maxsplit=1, flags=re.I)
    return parts[1] if len(parts) > 1 else ""


def _matches(row: dict, where: str, args: tuple) -> bool:
    """Apply the predicate AS WRITTEN. A conjunct that is not in the SQL is
    not applied — which is the whole point: deleting `AND org_id=$2` from the
    router stops this filtering by organisation, exactly like the database."""
    for col, n in _EQ_PARAM.findall(where):
        if _norm(row.get(col)) != _norm(args[int(n) - 1]):
            return False
    for col, n in _EQ_ANY.findall(where):
        if row.get(col) not in (args[int(n) - 1] or []):
            return False
    for col, literal in _EQ_LIT.findall(where):
        if _norm(row.get(col)) != literal:
            return False
    for col in _EQ_TRUE.findall(where):
        if not row.get(col):
            return False
    return True


def _values(sql: str) -> list[str]:
    """The VALUES tuple, split at depth 0 — `NOW()` carries its own parens."""
    start = re.search(r"\bVALUES\s*\(", sql, re.I).end()
    depth, i = 1, start
    while depth:
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
        i += 1
    inner, out, buf, depth = sql[start:i - 1], [], "", 0
    for ch in inner:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(buf.strip())
            buf = ""
        else:
            buf += ch
    out.append(buf.strip())
    return out


class _Db:
    """Rows in, statements evaluated, every call recorded."""

    def __init__(self, tables: dict):
        self.tables = copy.deepcopy(tables)
        self.calls: list[tuple[str, tuple]] = []

    # ── recording ────────────────────────────────────────────────────
    def sql_for(self, needle: str) -> list[tuple[str, tuple]]:
        return [(s, a) for s, a in self.calls if needle in s]

    def none_touched(self, needle: str) -> bool:
        return not self.sql_for(needle)

    # ── the reader ───────────────────────────────────────────────────
    def _select(self, sql: str, args: tuple) -> list[dict]:
        table = _TABLE.search(sql).group(1)
        where = _where(sql)
        rows = [r for r in self.tables.get(table, []) if _matches(r, where, args)]

        ilike = _ILIKE.search(sql)
        if ilike:
            needle = args[int(ilike.group(1)) - 1]
            if needle is not None:
                col = ilike.group(2)
                rows = [r for r in rows
                        if needle.lower() in str(r.get(col) or "").lower()]

        unnamed = _UNNAMED.search(sql)
        if unnamed:
            col, fallback = unnamed.group(1), unnamed.group(2)
            rows = [dict(r, **{col: (str(r.get(col) or "").strip() or fallback)})
                    for r in rows]

        if re.search(r"\bORDER BY\b", sql, re.I):
            rows = sorted(rows, key=lambda r: str(r.get("name") or ""))

        limit = _LIMIT.search(sql)
        if limit:
            rows = rows[: args[int(limit.group(1)) - 1]]
        return [dict(r) for r in rows]

    def _insert(self, sql: str, args: tuple):
        table = _TABLE.search(sql).group(1)
        cols = [c.strip() for c in
                re.search(r"INSERT INTO\s+public\.\w+\s*\(([^)]*)\)", sql, re.I | re.S)
                .group(1).split(",")]
        record = {}
        for col, token in zip(cols, _values(sql)):
            if token.upper().startswith("NOW("):
                record[col] = WROTE_AT
            elif token.upper() == "NULL":
                record[col] = None
            elif token.startswith("'"):
                record[col] = token.strip("'")
            else:
                record[col] = args[int(re.match(r"\$(\d+)", token).group(1)) - 1]

        store = self.tables.setdefault(table, [])
        key = ("org_id", "module", "rule_key", "scope_type", "scope_id")
        if table == "module_compliance_settings":
            for existing in store:
                if all(_norm(existing.get(k)) == _norm(record.get(k)) for k in key):
                    existing.update(record)
                    record = existing
                    break
            else:
                store.append(record)
        else:
            store.append(record)

        returning = _RETURNING.search(sql)
        if not returning:
            return None
        wanted = [c.strip() for c in returning.group(1).split(",")]
        return {c: record.get(c) for c in wanted}

    def _delete(self, sql: str, args: tuple) -> str:
        table = _TABLE.search(sql).group(1)
        where = _where(sql)
        store = self.tables.get(table, [])
        keep = [r for r in store if not _matches(r, where, args)]
        removed = len(store) - len(keep)
        self.tables[table] = keep
        return f"DELETE {removed}"

    # ── the pool surface the router uses ─────────────────────────────
    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return self._select(sql, args)

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        if re.match(r"\s*INSERT", sql, re.I):
            return self._insert(sql, args)
        rows = self._select(sql, args)
        return rows[0] if rows else None

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        return None

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        if re.match(r"\s*DELETE", sql, re.I):
            return self._delete(sql, args)
        if re.match(r"\s*INSERT", sql, re.I):
            self._insert(sql, args)
            return "INSERT 0 1"
        return "OK"


def _setting(*, org=ORG, module="ganit", rule_key="hsn_required",
             state="enforced", set_by=FIRM_SETTER, reason="firm policy",
             scope_type="org", scope_id=None) -> dict:
    return {
        "org_id": org, "module": module, "rule_key": rule_key, "state": state,
        "set_by": set_by, "set_at": SET_AT, "reason": reason,
        "scope_type": scope_type, "scope_id": scope_id,
    }


def _db(settings=None) -> _Db:
    """Two organisations that own similar-looking rows.

    OTHER_ORG exists in every table on purpose: a tenancy test whose store
    holds only one firm's rows cannot fail, because there is nothing to leak.
    """
    return _Db({
        "graha_clients": [
            {"id": CLIENT, "org_id": ORG, "name": "Acme Traders", "is_active": True},
            {"id": OTHER_CLIENT, "org_id": OTHER_ORG, "name": "Rival Exports",
             "is_active": True},
            {"id": ARCHIVED_CLIENT, "org_id": ORG, "name": "Dormant Mills",
             "is_active": False},
            {"id": BLANK_CLIENT, "org_id": ORG, "name": "   ", "is_active": True},
        ],
        "manav_employees": [
            {"id": EMPLOYEE, "org_id": ORG, "name": "Priya Nair", "is_active": True},
            {"id": OTHER_EMPLOYEE, "org_id": OTHER_ORG, "name": "Rival Staffer",
             "is_active": True},
        ],
        "users": [
            {"user_id": FIRM_SETTER, "setter_name": "Keval Shah"},
            {"user_id": CLIENT_SETTER, "setter_name": "Anita Desai"},
            {"user_id": CALLER, "setter_name": "Ravi Menon"},
        ],
        "module_subscriptions": [
            {"org_id": ORG, "module_code": "ganit", "is_active": True},
        ],
        "module_compliance_settings": list(settings or []),
        "audit_log": [],
    })


async def _drive(db, handler):
    import db as db_mod
    original, db_mod._pool = db_mod._pool, db
    try:
        return await handler()
    finally:
        db_mod._pool = original


@pytest.fixture
def no_audit(monkeypatch):
    """Capture `emit` instead of letting it fire-and-forget onto the store.

    Returned as a LIST so a test can assert an audit row was NOT written —
    `clear_scoped_setting` deliberately writes none when there was nothing to
    clear, and an event saying a decision was reversed when none existed is a
    false entry in the one record that may not carry any.
    """
    seen: list[dict] = []
    monkeypatch.setattr(
        router_mod, "audit",
        lambda action, request, **kw: seen.append({"action": action, **kw}))
    return seen


# ══════════════════════════════════════════════════════════════════════════
#  The fake itself — a guard on the guard
# ══════════════════════════════════════════════════════════════════════════

def test_the_fake_applies_the_predicate_the_statement_writes():
    """If this fake ignored `org_id`, every tenancy test below would be green
    over a router with the check deleted. So the fake's own behaviour is
    pinned first: the same rows, read with and without the org conjunct.
    """
    rows = _db().tables["graha_clients"]
    with_org = "WHERE id=$1::uuid AND org_id=$2::uuid"
    without = "WHERE id=$1::uuid"
    args = (OTHER_CLIENT, ORG)
    assert [r for r in rows if _matches(r, _where(with_org), args)] == []
    assert len([r for r in rows if _matches(r, _where(without), args)]) == 1


# ══════════════════════════════════════════════════════════════════════════
#  1. `_scope_name` — the tenancy check
# ══════════════════════════════════════════════════════════════════════════

async def test_scope_name_returns_the_subjects_name_for_this_org():
    """The presence half. Without it every refusal test below would pass over
    a `_scope_name` that refuses everything, including this firm's own rows."""
    db = _db()
    assert await router_mod._scope_name(db, ORG, "client", CLIENT) == "Acme Traders"
    assert await router_mod._scope_name(db, ORG, "employee", EMPLOYEE) == "Priya Nair"


async def test_scope_name_refuses_a_client_that_belongs_to_another_org():
    """THE TENANCY PROPERTY. `graha_clients.id` is unique table-wide, so the
    id alone resolves — the row IS in the store and the store WILL return it
    for a statement that does not bind `org_id`. The refusal has to come from
    the predicate, and this is what proves the predicate is there."""
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await router_mod._scope_name(db, ORG, "client", OTHER_CLIENT)
    assert exc.value.status_code == 404
    # And the row really was reachable — the refusal is the org check, not an
    # empty table.
    assert await router_mod._scope_name(db, OTHER_ORG, "client", OTHER_CLIENT) \
        == "Rival Exports"


async def test_scope_name_refuses_an_employee_that_belongs_to_another_org():
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await router_mod._scope_name(db, ORG, "employee", OTHER_EMPLOYEE)
    assert exc.value.status_code == 404
    assert await router_mod._scope_name(db, OTHER_ORG, "employee", OTHER_EMPLOYEE) \
        == "Rival Staffer"


async def test_the_refusal_does_not_say_whether_the_id_exists():
    """Telling "no such id" apart from "that id is another firm's" out loud
    confirms the existence of another tenant's record to anyone who can guess
    a uuid — the same leak in a politer wrapper. One sentence for both."""
    db = _db()
    messages = []
    for scope_id in (OTHER_CLIENT, NO_SUCH_ID):
        with pytest.raises(HTTPException) as exc:
            await router_mod._scope_name(db, ORG, "client", scope_id)
        messages.append((exc.value.status_code, exc.value.detail))
    assert messages[0] == messages[1], messages
    assert "another" not in messages[0][1].lower()


async def test_a_subject_with_no_name_still_resolves_to_something_clickable():
    """A nameless row is still a real client with a real override. Rendering
    "" draws a sentence with a hole in it."""
    db = _db()
    assert await router_mod._scope_name(db, ORG, "client", BLANK_CLIENT) \
        == "Unnamed company"


async def test_an_archived_client_is_still_reachable_by_id():
    """`is_active` is deliberately NOT in `_SCOPE_ROW`, though it IS in
    `_SCOPE_LIST`. An override written against a client who has since been
    archived must stay readable and, above all, CLEARABLE — filtering here
    would strand exactly the rows somebody most needs to tidy up, as a 404
    that reads like the id was wrong."""
    db = _db()
    assert await router_mod._scope_name(db, ORG, "client", ARCHIVED_CLIENT) \
        == "Dormant Mills"


# ── the same property, through the three handlers that take an id ────────

async def test_get_scoped_settings_refuses_another_orgs_client_before_reading():
    """"Nothing further happens until it has" — the org check runs BEFORE any
    per-module read, so a probe cannot even learn which modules a firm has."""
    db = _db([_setting()])
    with pytest.raises(HTTPException) as exc:
        await _drive(db, lambda: router_mod.get_scoped_settings(
            "client", OTHER_CLIENT, user={"user_id": CALLER}, org_id=ORG))
    assert exc.value.status_code == 404
    assert db.none_touched("FROM public.module_compliance_settings")


async def test_patch_scoped_setting_writes_nothing_for_another_orgs_client(no_audit):
    """The write half of the tenancy property. A silent cross-tenant WRITE has
    no error and no log line; the only evidence is that the statement never
    ran."""
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await _drive(db, lambda: router_mod.patch_scoped_setting(
            "ganit",
            router_mod.OverridePatch(
                rule_key="hsn_required", state="not_applicable",
                scope_type="client", scope_id=OTHER_CLIENT, reason="probe"),
            _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))
    assert exc.value.status_code == 404
    assert db.none_touched("INSERT INTO public.module_compliance_settings")
    assert db.tables["module_compliance_settings"] == []
    assert no_audit == []


async def test_clear_scoped_setting_deletes_nothing_for_another_orgs_client(no_audit):
    """The DELETE half. The victim row is seeded under OTHER_ORG so there is
    something real to destroy: a green test over an empty table proves
    nothing."""
    victim = _setting(org=OTHER_ORG, scope_type="client", scope_id=OTHER_CLIENT,
                      set_by=CLIENT_SETTER)
    db = _db([victim])
    with pytest.raises(HTTPException) as exc:
        await _drive(db, lambda: router_mod.clear_scoped_setting(
            "ganit", _FakeRequest(), rule_key="hsn_required",
            scope_type="client", scope_id=OTHER_CLIENT, reason=None,
            user={"user_id": CALLER}, org_id=ORG))
    assert exc.value.status_code == 404
    assert db.none_touched("DELETE FROM public.module_compliance_settings")
    assert db.tables["module_compliance_settings"] == [victim]
    assert no_audit == []


async def test_the_picker_lists_only_this_orgs_subjects():
    """`_SCOPE_LIST` carries `org_id` too. A picker that offers another firm's
    clients is the same leak with a UI on it."""
    db = _db()
    out = await _drive(db, lambda: router_mod.list_scope_targets(
        "client", q=None, user={"user_id": CALLER}, org_id=ORG))
    names = {t["name"] for t in out["targets"]}
    assert "Acme Traders" in names                     # presence
    assert "Rival Exports" not in names                # tenancy
    assert "Dormant Mills" not in names                # is_active
    assert "Unnamed company" in names                  # the COALESCEd label
    assert out["truncated"] is False
    assert out["page_size"] == router_mod._TARGET_PAGE


async def test_the_picker_says_when_it_dropped_somebody():
    """A picker that silently drops the 201st is how a user concludes a client
    does not exist and creates a second copy of a company."""
    extra = [{"id": str(uuidlib.uuid4()), "org_id": ORG,
              "name": f"Bulk Client {i:04d}", "is_active": True}
             for i in range(router_mod._TARGET_PAGE)]
    db = _db()
    db.tables["graha_clients"].extend(extra)
    out = await _drive(db, lambda: router_mod.list_scope_targets(
        "client", q=None, user={"user_id": CALLER}, org_id=ORG))
    assert len(out["targets"]) == router_mod._TARGET_PAGE
    assert out["truncated"] is True

    narrowed = await _drive(db, lambda: router_mod.list_scope_targets(
        "client", q="Acme", user={"user_id": CALLER}, org_id=ORG))
    assert [t["name"] for t in narrowed["targets"]] == ["Acme Traders"]
    assert narrowed["truncated"] is False


# ══════════════════════════════════════════════════════════════════════════
#  2. `_named_effective` — three levels of id, all of them removed
# ══════════════════════════════════════════════════════════════════════════

def _ids_anywhere(obj) -> list:
    """Every `set_by`/`scope_id` value at any depth."""
    found = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in ("set_by", "scope_id"):
                found.append((key, value))
            found.extend(_ids_anywhere(value))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_ids_anywhere(item))
    return found


async def _effective_fixture():
    """A real `resolve_effective` payload: a firm default set by one person,
    a client override set by another."""
    db = _db([
        _setting(set_by=FIRM_SETTER, state="enforced", reason="firm policy"),
        _setting(scope_type="client", scope_id=CLIENT, set_by=CLIENT_SETTER,
                 state="not_applicable", reason="composition dealer"),
    ])
    rules = await svc.resolve_effective(db, ORG, "ganit", "client", CLIENT)
    names = await router_mod._setter_names(db, router_mod._setter_maps(rules))
    return rules, names


async def test_named_effective_names_the_setter_at_all_three_levels():
    rules, names = await _effective_fixture()
    out = router_mod._named_effective(rules, names)
    hsn = out["hsn_required"]

    # Presence, first: the payload is really the override's, with the firm's
    # default beside it and `source` saying which is in force.
    assert hsn["state"] == "not_applicable"
    assert hsn["source"] == "override"
    assert hsn["default"]["state"] == "enforced"
    assert hsn["override"]["state"] == "not_applicable"

    # Three levels, three names — and the two setters are different people, so
    # naming only the top level cannot pass.
    assert hsn["set_by_name"] == "Anita Desai"
    assert hsn["override"]["set_by_name"] == "Anita Desai"
    assert hsn["default"]["set_by_name"] == "Keval Shah"
    assert hsn["has_setter"] is True
    assert hsn["default"]["has_setter"] is True
    assert hsn["override"]["has_setter"] is True


async def test_named_effective_strips_every_id_at_every_level():
    rules, names = await _effective_fixture()
    out = router_mod._named_effective(rules, names)

    assert _ids_anywhere(out) == [], _ids_anywhere(out)
    blob = repr(out)
    for secret in (FIRM_SETTER, CLIENT_SETTER, CLIENT):
        assert secret not in blob, f"{secret} reached the payload"

    # The absence assertion above is paired with this: the source really did
    # carry all four ids, so an empty result is not what made it pass.
    carried = _ids_anywhere(rules)
    assert len(carried) >= 4, carried
    assert {v for _, v in carried} >= {FIRM_SETTER, CLIENT_SETTER, CLIENT}


async def test_named_effective_does_not_mutate_the_dicts_it_was_given():
    """`resolve_effective` shares rule dicts between the top level and the
    nested keys. Popping `set_by` in place would name one and leave the other
    holding a raw id — and would corrupt a caller that reads the payload
    twice."""
    rules, names = await _effective_fixture()
    before = copy.deepcopy(rules)
    router_mod._named_effective(rules, names)
    assert rules == before


async def test_named_effective_leaves_an_unoverridden_rule_legible():
    """Absence paired with presence: no override still returns the default,
    named, with `source` saying so — not a hole."""
    db = _db([_setting(set_by=FIRM_SETTER)])
    rules = await svc.resolve_effective(db, ORG, "ganit", "client", CLIENT)
    names = await router_mod._setter_names(db, router_mod._setter_maps(rules))
    out = router_mod._named_effective(rules, names)["hsn_required"]
    assert out["override"] is None
    assert out["source"] == "default"
    assert out["state"] == "enforced"
    assert out["set_by_name"] == "Keval Shah"
    assert out["default"]["set_by_name"] == "Keval Shah"
    assert _ids_anywhere(out) == []


def test_setter_maps_reaches_the_nested_levels_the_walk_cannot_see():
    """`_setter_names` walks `rules.values()` and reads ONE `set_by` per entry.
    An effective rule hides three. This is the helper that surfaces the other
    two, and the bug it exists to prevent is an override written by a colleague
    coming back as "nobody has set this".

    Hand-built with three DISTINCT setters on purpose: `resolve_effective`
    always copies the override into the top level, so through that shape the
    third map is redundant with the first and a mutation dropping it would be
    invisible. Here it is not.
    """
    rules = {
        "hsn_required": {
            "set_by": "user_top",
            "default": {"set_by": "user_default"},
            "override": {"set_by": "user_override"},
        },
    }
    found = {rule["set_by"]
             for level in router_mod._setter_maps(rules)
             for rule in level.values() if rule.get("set_by")}
    assert found == {"user_top", "user_default", "user_override"}


async def test_the_scope_screen_ships_names_and_no_ids_at_all():
    """`_named_effective` end to end through the handler the screen calls."""
    db = _db([
        _setting(set_by=FIRM_SETTER),
        _setting(scope_type="client", scope_id=CLIENT, set_by=CLIENT_SETTER,
                 state="not_applicable", reason="composition dealer"),
    ])
    data = await _drive(db, lambda: router_mod.get_scoped_settings(
        "client", CLIENT, user={"user_id": CALLER}, org_id=ORG))

    assert data["scope_name"] == "Acme Traders"
    assert data["scope_type"] == "client"
    assert data["default_state"] == svc.DEFAULT_STATE
    by_module = {m["module"]: m for m in data["modules"]}
    assert set(by_module) == set(svc.modules())
    assert by_module["ganit"]["active"] is True
    assert by_module["vetana"]["active"] is False

    hsn = by_module["ganit"]["rules"]["hsn_required"]
    assert hsn["source"] == "override"
    assert hsn["set_by_name"] == "Anita Desai"
    assert hsn["default"]["set_by_name"] == "Keval Shah"

    blob = repr(data)
    for secret in (CLIENT, FIRM_SETTER, CLIENT_SETTER, ORG):
        assert secret not in blob, f"{secret} reached the screen payload"


# ══════════════════════════════════════════════════════════════════════════
#  3. `_scope_uuid`
# ══════════════════════════════════════════════════════════════════════════

def test_scope_uuid_accepts_a_uuid_and_returns_it_canonically():
    assert router_mod._scope_uuid(CLIENT) == CLIENT
    assert router_mod._scope_uuid(CLIENT.upper()) == CLIENT
    assert router_mod._scope_uuid("{" + CLIENT + "}") == CLIENT
    assert router_mod._scope_uuid(CLIENT.replace("-", "")) == CLIENT


@pytest.mark.parametrize("bad", [
    None,
    "",
    "   ",
    "not-a-uuid",
    "12345",
    CLIENT[:-1],                                  # one character short
    CLIENT + "x",
    "' OR 1=1 --",
    f"{CLIENT}'; DROP TABLE public.graha_clients; --",
    f"{CLIENT} UNION SELECT name FROM public.graha_clients",
    ["a", "list"],
    {"a": "dict"},
])
def test_scope_uuid_refuses_anything_that_is_not_one(bad):
    """asyncpg answers `invalid input syntax for type uuid` for all of these
    and it surfaces as a 500 — the caller is told the server broke when what
    actually happened is that they sent a malformed parameter."""
    with pytest.raises(HTTPException) as exc:
        router_mod._scope_uuid(bad)
    assert exc.value.status_code == 400
    assert "client or employee" in exc.value.detail


async def test_a_malformed_scope_id_never_reaches_the_database(no_audit):
    db = _db()
    with pytest.raises(HTTPException) as exc:
        await _drive(db, lambda: router_mod.patch_scoped_setting(
            "ganit",
            router_mod.OverridePatch(
                rule_key="hsn_required", state="not_applicable",
                scope_type="client", scope_id="'; DROP TABLE x; --"),
            _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))
    assert exc.value.status_code == 400
    assert db.calls == []
    assert no_audit == []


# ══════════════════════════════════════════════════════════════════════════
#  4. `_override_scope`
# ══════════════════════════════════════════════════════════════════════════

def test_override_scope_accepts_the_two_real_scopes():
    assert router_mod._override_scope("client") == "client"
    assert router_mod._override_scope("employee") == "employee"


def test_override_scope_refuses_org_and_says_where_the_default_lives():
    """`org` is refused HERE rather than left to the service so the message can
    say what to do instead. The failure mode it prevents is somebody editing
    what looks like one client's exception and silently rewriting the default
    for every client at once."""
    with pytest.raises(HTTPException) as exc:
        router_mod._override_scope("org")
    assert exc.value.status_code == 400
    assert "PATCH /api/v1/org/compliance/{module}" in exc.value.detail
    # `org` IS a valid scope to the service — the refusal is this router's.
    assert "org" in svc.SCOPES


@pytest.mark.parametrize("bad", [
    "", "  ", "ORG", "Org", "clients", "client ", "user", "project", "team",
    "vendor", "'; DROP TABLE x; --", "graha_clients", None, 0, 1,
])
def test_override_scope_refuses_everything_else(bad):
    """`scope_type` chooses a TABLE. Nothing but an exact allowlist key may
    survive this, and the message names the valid ones."""
    with pytest.raises(HTTPException) as exc:
        router_mod._override_scope(bad)
    assert exc.value.status_code == 400
    assert exc.value.detail
    assert set(router_mod._SCOPE_ROW) == {"client", "employee"}


async def test_org_is_refused_by_every_route_that_writes(no_audit):
    db = _db([_setting()])
    for handler in (
        lambda: router_mod.patch_scoped_setting(
            "ganit",
            router_mod.OverridePatch(rule_key="hsn_required", state="applicable",
                                     scope_type="org", scope_id=CLIENT),
            _FakeRequest(), user={"user_id": CALLER}, org_id=ORG),
        lambda: router_mod.clear_scoped_setting(
            "ganit", _FakeRequest(), rule_key="hsn_required", scope_type="org",
            scope_id=CLIENT, reason=None, user={"user_id": CALLER}, org_id=ORG),
        lambda: router_mod.get_scoped_settings(
            "org", CLIENT, user={"user_id": CALLER}, org_id=ORG),
        lambda: router_mod.list_scope_targets(
            "org", q=None, user={"user_id": CALLER}, org_id=ORG),
    ):
        with pytest.raises(HTTPException) as exc:
            await _drive(db, handler)
        assert exc.value.status_code == 400

    assert db.calls == []
    assert no_audit == []
    # The firm default is untouched — which is the whole point of refusing.
    assert db.tables["module_compliance_settings"] == [_setting()]


# ══════════════════════════════════════════════════════════════════════════
#  5. The scope the caller gave is the scope the service is asked for
# ══════════════════════════════════════════════════════════════════════════

async def test_patch_writes_an_override_for_exactly_the_subject_it_was_given(no_audit):
    db = _db([_setting(set_by=FIRM_SETTER, state="enforced")])
    out = await _drive(db, lambda: router_mod.patch_scoped_setting(
        "ganit",
        router_mod.OverridePatch(
            rule_key="hsn_required", state="not_applicable",
            scope_type="client", scope_id=CLIENT.upper(),
            reason="composition dealer"),
        _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))

    writes = db.sql_for("INSERT INTO public.module_compliance_settings")
    assert len(writes) == 1, writes
    sql, args = writes[0]
    # The scope, as bound. Uppercase in, canonical uuid out — the handler uses
    # `_scope_uuid`'s answer and not the raw body value.
    assert args[6] == "client"
    assert args[7] == CLIENT
    assert (args[0], args[1], args[2], args[3]) == (
        ORG, "ganit", "hsn_required", "not_applicable")
    assert args[4] == CALLER

    # The OVERRIDE index, not the firm-default one. Migration 253 made these
    # two different partial indexes and the wrong inference clause 500s.
    assert "WHERE scope_type <> 'org'" in sql

    # The firm's own row is exactly as it was.
    stored = db.tables["module_compliance_settings"]
    firm = [r for r in stored if r["scope_type"] == "org"]
    assert firm == [_setting(set_by=FIRM_SETTER, state="enforced")]
    override = [r for r in stored if r["scope_type"] == "client"]
    assert len(override) == 1
    assert override[0]["scope_id"] == CLIENT
    assert override[0]["state"] == "not_applicable"

    # The payload the screen renders.
    assert out["status"] == "updated"
    assert out["scope_name"] == "Acme Traders"
    assert out["previous_state"] == "enforced"
    assert out["previous_source"] == "default"
    assert out["rule"]["source"] == "override"
    assert out["rule"]["state"] == "not_applicable"
    assert CLIENT not in repr(out)


async def test_patch_for_an_employee_reaches_the_employee_table(no_audit):
    """The scope is not hardcoded anywhere: the same handler with `employee`
    proves the id against `manav_employees` and writes `scope_type='employee'`."""
    db = _db()
    await _drive(db, lambda: router_mod.patch_scoped_setting(
        "vetana",
        router_mod.OverridePatch(
            rule_key="pf_applicable", state="not_applicable",
            scope_type="employee", scope_id=EMPLOYEE, reason="negotiated"),
        _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))

    assert db.sql_for("FROM public.manav_employees")
    assert db.none_touched("FROM public.graha_clients")
    _, args = db.sql_for("INSERT INTO public.module_compliance_settings")[0]
    assert (args[6], args[7]) == ("employee", EMPLOYEE)


async def test_the_audit_row_carries_the_name_and_keeps_the_id_out_of_detail(no_audit):
    """The id is in the RESOURCE key, which is what an auditor queries by and
    what nothing renders — never in `detail`, which this screen draws from."""
    db = _db([_setting(set_by=FIRM_SETTER, state="enforced")])
    await _drive(db, lambda: router_mod.patch_scoped_setting(
        "ganit",
        router_mod.OverridePatch(
            rule_key="hsn_required", state="not_applicable",
            scope_type="client", scope_id=CLIENT, reason="composition dealer"),
        _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))

    assert len(no_audit) == 1
    event = no_audit[0]
    # The SAME action as the firm-level write, on purpose: `/v1/audit/events`
    # filters on one action string and an override is a compliance decision.
    assert event["action"] == "compliance.setting_updated"
    assert event["severity"] == "warn"
    assert event["resource_id"] == f"ganit.hsn_required@client:{CLIENT}"
    detail = event["detail"]
    assert detail["scope_type"] == "client"
    assert detail["scope_name"] == "Acme Traders"
    assert detail["previous_state"] == "enforced"
    assert detail["previous_source"] == "default"
    assert detail["state"] == "not_applicable"
    assert detail["reason"] == "composition dealer"
    assert CLIENT not in repr(detail)


async def test_a_second_edit_is_recorded_as_a_revision_of_an_override(no_audit):
    """`previous_source` is what tells a first exception from a revision of
    one, and no amount of reading `previous_state` afterwards recovers it."""
    db = _db([
        _setting(set_by=FIRM_SETTER, state="enforced"),
        _setting(scope_type="client", scope_id=CLIENT, set_by=CLIENT_SETTER,
                 state="not_applicable"),
    ])
    out = await _drive(db, lambda: router_mod.patch_scoped_setting(
        "ganit",
        router_mod.OverridePatch(
            rule_key="hsn_required", state="applicable",
            scope_type="client", scope_id=CLIENT, reason="changed our mind"),
        _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))
    assert out["previous_source"] == "override"
    assert out["previous_state"] == "not_applicable"
    assert no_audit[0]["detail"]["previous_source"] == "override"
    # Upserted, not duplicated.
    overrides = [r for r in db.tables["module_compliance_settings"]
                 if r["scope_type"] == "client"]
    assert len(overrides) == 1
    assert overrides[0]["state"] == "applicable"


async def test_clear_deletes_exactly_the_override_it_was_given(no_audit):
    db = _db([
        _setting(set_by=FIRM_SETTER, state="enforced"),
        _setting(scope_type="client", scope_id=CLIENT, set_by=CLIENT_SETTER,
                 state="not_applicable"),
        # A second firm's override on the same rule and the same client id
        # shape — it must survive.
        _setting(org=OTHER_ORG, scope_type="client", scope_id=OTHER_CLIENT,
                 set_by=CLIENT_SETTER, state="not_applicable"),
    ])
    out = await _drive(db, lambda: router_mod.clear_scoped_setting(
        "ganit", _FakeRequest(), rule_key="hsn_required", scope_type="client",
        scope_id=CLIENT.upper(), reason="back to the firm default",
        user={"user_id": CALLER}, org_id=ORG))

    deletes = db.sql_for("DELETE FROM public.module_compliance_settings")
    assert len(deletes) == 1
    _, args = deletes[0]
    assert args == (ORG, "ganit", "hsn_required", "client", CLIENT)

    assert out["status"] == "cleared"
    assert out["scope_name"] == "Acme Traders"
    assert out["previous_state"] == "not_applicable"
    # Fell back to the firm's default, which is what the screen now shows.
    assert out["rule"]["source"] == "default"
    assert out["rule"]["state"] == "enforced"
    assert CLIENT not in repr(out)

    remaining = db.tables["module_compliance_settings"]
    assert {(r["org_id"], r["scope_type"]) for r in remaining} == {
        (ORG, "org"), (OTHER_ORG, "client")}

    assert len(no_audit) == 1
    assert no_audit[0]["detail"]["cleared"] is True
    assert no_audit[0]["detail"]["previous_source"] == "override"
    assert no_audit[0]["detail"]["state"] == "enforced"
    assert no_audit[0]["detail"]["reason"] == "back to the firm default"


async def test_clearing_nothing_is_reported_as_nothing_and_audits_nothing(no_audit):
    """The absence half of the test above. An event saying a decision was
    reversed, when no decision existed, is a false entry in the one record
    that may not carry any."""
    db = _db([_setting(set_by=FIRM_SETTER, state="enforced")])
    out = await _drive(db, lambda: router_mod.clear_scoped_setting(
        "ganit", _FakeRequest(), rule_key="hsn_required", scope_type="client",
        scope_id=CLIENT, reason=None, user={"user_id": CALLER}, org_id=ORG))
    assert out["status"] == "nothing_to_clear"
    assert out["rule"]["source"] == "default"
    assert no_audit == []
    # The DELETE did run — "nothing to clear" is the database's answer, not a
    # skipped statement.
    assert len(db.sql_for("DELETE FROM public.module_compliance_settings")) == 1


async def test_an_archived_subjects_override_can_still_be_cleared(no_audit):
    """The asymmetry `_SCOPE_ROW` documents, proved from the end that matters:
    the picker will not offer this client, and the override left behind must
    still be removable."""
    db = _db([_setting(scope_type="client", scope_id=ARCHIVED_CLIENT,
                       set_by=CLIENT_SETTER, state="not_applicable")])
    listed = await _drive(db, lambda: router_mod.list_scope_targets(
        "client", q=None, user={"user_id": CALLER}, org_id=ORG))
    assert "Dormant Mills" not in {t["name"] for t in listed["targets"]}

    out = await _drive(db, lambda: router_mod.clear_scoped_setting(
        "ganit", _FakeRequest(), rule_key="hsn_required", scope_type="client",
        scope_id=ARCHIVED_CLIENT, reason=None,
        user={"user_id": CALLER}, org_id=ORG))
    assert out["status"] == "cleared"
    assert out["scope_name"] == "Dormant Mills"
    assert db.tables["module_compliance_settings"] == []


async def test_an_unknown_module_is_refused_before_any_scope_work(no_audit):
    db = _db()
    for handler in (
        lambda: router_mod.patch_scoped_setting(
            "no_such_module",
            router_mod.OverridePatch(rule_key="x", state="applicable",
                                     scope_type="client", scope_id=CLIENT),
            _FakeRequest(), user={"user_id": CALLER}, org_id=ORG),
        lambda: router_mod.clear_scoped_setting(
            "no_such_module", _FakeRequest(), rule_key="x", scope_type="client",
            scope_id=CLIENT, reason=None, user={"user_id": CALLER}, org_id=ORG),
    ):
        with pytest.raises(HTTPException) as exc:
            await _drive(db, handler)
        assert exc.value.status_code == 404
    assert db.calls == []
    assert no_audit == []
    # Presence: a module that DOES have settings is not refused.
    assert svc.rules_for("ganit")


async def test_the_service_refusals_surface_as_400_not_500(no_audit):
    """`svc.set_rule` raises ValueError for an unknown rule_key, a bad state,
    and for `enforced` on a rule nothing reads. An uncaught ValueError out of a
    handler is a 500 that tells the caller the server broke."""
    db = _db()
    for body in (
        router_mod.OverridePatch(rule_key="no_such_rule", state="applicable",
                                 scope_type="client", scope_id=CLIENT),
        router_mod.OverridePatch(rule_key="hsn_required", state="banana",
                                 scope_type="client", scope_id=CLIENT),
    ):
        with pytest.raises(HTTPException) as exc:
            await _drive(db, lambda body=body: router_mod.patch_scoped_setting(
                "ganit", body, _FakeRequest(),
                user={"user_id": CALLER}, org_id=ORG))
        assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        await _drive(db, lambda: router_mod.patch_scoped_setting(
            "vetana",
            router_mod.OverridePatch(rule_key="pf_applicable", state="enforced",
                                     scope_type="employee", scope_id=EMPLOYEE),
            _FakeRequest(), user={"user_id": CALLER}, org_id=ORG))
    assert exc.value.status_code == 400
    assert "cannot be enforced" in exc.value.detail

    assert db.none_touched("INSERT INTO public.module_compliance_settings")
    assert no_audit == []
