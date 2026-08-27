"""Per-user module tabs (proposal 67, demo 2): grammar on save, resolution
on read, one conflict target per row shape.

Same method as test_analytics_views.py — a recording pool proves WIRING (what
was refused before any SQL ran, what got bound, which conflict target the
upsert names); migration 154 owns the table, and the LIVE SQL PROBE IS OWED
TO THE MAIN SESSION: a mock pool hides bad SQL (the credits `$1+$2` untyped
parse error 500'd every spend and no suite noticed). The assertions that
matter most:

  · every malformed body is refused with a 422 NAMING the offence, and the
    pool is never touched by a refused request;
  · resolution is personal > org, applied server-side in GET, insensitive to
    the order rows arrive in;
  · the personal upsert names the PARTIAL index's predicate in its conflict
    target — ON CONFLICT (user_id, module) WHERE user_id IS NOT NULL — and
    names the SAME target every time it runs (a drifted spelling is an
    InvalidColumnReferenceError live, invisible to a mock);
  · the org PUT is 403 without admin_org_id and writes nothing;
  · every statement is schema-qualified (the shadow-tables lesson).
"""
import asyncio
import datetime
import pathlib
import re

import pytest
from fastapi import HTTPException

from routers import tab_prefs as tp

USER = {"user_id": "user_aaa111"}
ORG = "22222222-2222-2222-2222-222222222222"
WHEN = datetime.datetime(2026, 8, 18, tzinfo=datetime.timezone.utc)


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

    monkeypatch.setattr(tp, "get_pool", _get_pool)
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


def _body(order, default=None):
    return tp.TabPrefPut(order=order, default_tab=default)


def _pref_row(module, order, default=None, user_id=None):
    return {"module": module, "tab_order": order,
            "default_tab": default, "user_id": user_id}


# ── the allowlist is a declaration worth pinning ─────────────────────────────

def test_module_tabs_is_exactly_the_ten_module_strips():
    """The ten pages that render <ModuleTabs> as a customer module's strip.
    Hub* is the internal agency console; OrgSahayak's ids carry spaces and
    join when they meet the grammar. A key added here without a strip stores
    arrangements nothing reads — change both sides or neither.

    NINE UNTIL 2026-08-27, and the missing tenth was a live defect rather than
    a stale number: `KrayPage.jsx` shipped on 23 Aug (`7770045b`) rendering a
    strip and saving under `kray`, the router refused the key, and a Kray user
    could rearrange their tabs, watch it work, and find the arrangement gone on
    the next load with nothing said. Its sibling test —
    `test_the_page_module_keys_are_exactly_module_tabs`, which discovers the
    keys from the PAGES rather than from a list written here — had been naming
    `kray` for four days. That is the one that found it; this one only records
    the answer, which is why both are kept.
    """
    assert tp.MODULE_TABS == frozenset({
        "dristi", "esign", "ganit", "graha", "kray", "manav",
        "pahchan", "prachar", "vetana", "vikray",
    })


def test_the_shipped_strips_already_satisfy_the_grammar():
    """The awkward real ids — hyphens included — must pass, or saving the
    order a page shipped with would 422."""
    for tab in ("e-sign", "follow-ups", "web-forms", "client-report",
                "dashboard", "analytics", "x" * 40):
        assert tp.TAB_ID.match(tab), tab


# ── every 422 branch, and none of them touches the pool ──────────────────────

def test_an_unknown_module_is_422_and_named(pool):
    with pytest.raises(HTTPException) as e:
        run(tp.put_my_tab_prefs("astrology", _body(["overview"]), user=USER))
    assert e.value.status_code == 422
    assert "astrology" in str(e.value.detail)
    assert pool.calls == []


def test_an_unknown_module_on_delete_is_422(pool):
    with pytest.raises(HTTPException) as e:
        run(tp.delete_my_tab_prefs("hub", user=USER))
    assert e.value.status_code == 422
    assert pool.calls == []


def test_an_unknown_module_on_the_org_put_is_422_before_the_role_check(
        pool, not_admin):
    """Grammar precedes the gate: a non-admin sending junk hears about the
    junk, and neither path reaches the pool."""
    with pytest.raises(HTTPException) as e:
        run(tp.put_org_tab_prefs("astrology", _body(["overview"]),
                                 user=USER, org_id=ORG))
    assert e.value.status_code == 422
    assert pool.calls == []


@pytest.mark.parametrize("order,default,expect", [
    ([], None, "at least one"),
    (["invoices", "invoices"], None, "appears twice"),
    (["Invoices"], None, "Invoices"),                  # uppercase
    (["data catalog"], None, "data catalog"),          # the OrgSahayak space
    (["x" * 41], None, "tab id"),                      # over 40 chars
    ([""], None, "tab id"),                            # empty id
    ([f"t{i}" for i in range(31)], None, "at most 30"),
    (["invoices"], "banking", "banking"),              # star outside order
])
def test_malformed_bodies_are_refused_with_the_offence(pool, order, default, expect):
    with pytest.raises(HTTPException) as e:
        run(tp.put_my_tab_prefs("ganit", _body(order, default), user=USER))
    assert e.value.status_code == 422
    assert expect in str(e.value.detail)
    assert pool.calls == [], "a refused request must never reach the pool"


def test_the_boundaries_are_writable(pool):
    """30 tabs, a 40-char id, a starred default — the edges of the grammar
    are inside it."""
    pool._row = {"updated_at": WHEN}
    order = ["x" * 40] + [f"t{i}" for i in range(29)]
    out = run(tp.put_my_tab_prefs("ganit", _body(order, "t0"), user=USER))
    assert out["source"] == "personal"
    assert out["order"] == order
    assert out["default_tab"] == "t0"
    assert out["updated_at"] == WHEN.isoformat()


def test_no_default_tab_is_a_valid_choice(pool):
    """None means "open on whatever the ladder below says" — it is not an
    error and it is bound as NULL, not skipped."""
    pool._row = {"updated_at": None}
    out = run(tp.put_my_tab_prefs("ganit", _body(["invoices"]), user=USER))
    assert out["default_tab"] is None
    assert pool.calls[0][1][3] is None


# ── resolution: personal > org, server-side ──────────────────────────────────

def test_personal_beats_org(pool):
    pool._rows = [
        _pref_row("ganit", ["invoices", "bank"], "bank",
                  user_id=USER["user_id"]),
        _pref_row("ganit", ["stats", "invoices"], "stats", user_id=None),
    ]
    out = run(tp.get_tab_prefs(user=USER, org_id=ORG))
    assert out["ganit"]["source"] == "personal"
    assert out["ganit"]["order"] == ["invoices", "bank"]
    assert out["ganit"]["default_tab"] == "bank"


def test_the_read_is_a_disjunction_and_the_personal_side_wins(pool):
    """Two pins on one statement. Textual: the WHERE is personal OR org —
    OR→AND would demand a row that is at once the caller's own AND org-less,
    i.e. no row ever, and a mock pool returns rows regardless of the SQL, so
    the disjunction's shape is the only honest kill here. Behavioral: handed
    both row shapes for one module, the personal one is what resolves."""
    pool._rows = [
        _pref_row("ganit", ["stats", "invoices"], "stats", user_id=None),
        _pref_row("ganit", ["invoices", "bank"], "bank",
                  user_id=USER["user_id"]),
    ]
    out = run(tp.get_tab_prefs(user=USER, org_id=ORG))
    sql, _ = pool.calls[0]
    assert "OR (user_id IS NULL AND org_id" in sql
    assert out["ganit"] == {"order": ["invoices", "bank"],
                            "default_tab": "bank", "source": "personal"}


def test_personal_wins_whatever_order_the_rows_arrive_in(pool):
    """The DB gives no ORDER BY promise here; the resolution must not lean
    on one."""
    pool._rows = [
        _pref_row("ganit", ["stats"], None, user_id=None),
        _pref_row("ganit", ["invoices"], None, user_id=USER["user_id"]),
    ]
    assert run(tp.get_tab_prefs(user=USER, org_id=ORG))["ganit"]["source"] == "personal"
    pool._rows = list(reversed(pool._rows))
    assert run(tp.get_tab_prefs(user=USER, org_id=ORG))["ganit"]["source"] == "personal"


def test_an_org_default_resolves_alone(pool):
    pool._rows = [_pref_row("vetana", ["payroll", "dashboard"], "payroll",
                            user_id=None)]
    out = run(tp.get_tab_prefs(user=USER, org_id=ORG))
    assert out["vetana"] == {"order": ["payroll", "dashboard"],
                             "default_tab": "payroll", "source": "org"}


def test_modules_resolve_independently(pool):
    pool._rows = [
        _pref_row("ganit", ["invoices"], None, user_id=USER["user_id"]),
        _pref_row("graha", ["deals"], "deals", user_id=None),
    ]
    out = run(tp.get_tab_prefs(user=USER, org_id=ORG))
    assert out["ganit"]["source"] == "personal"
    assert out["graha"]["source"] == "org"


def test_no_rows_is_an_empty_object(pool):
    assert run(tp.get_tab_prefs(user=USER, org_id=ORG)) == {}


def test_the_read_is_scoped_to_the_caller_and_the_current_org(pool):
    run(tp.get_tab_prefs(user=USER, org_id=ORG))
    sql, args = pool.calls[0]
    assert args == [USER["user_id"], ORG]
    assert "user_id = $1::text" in sql
    assert "org_id = $2::uuid" in sql


# ── the upsert SQL shape ─────────────────────────────────────────────────────

def _put(pool, module="ganit", order=("invoices", "bank"), default="bank"):
    pool._row = {"updated_at": WHEN}
    return run(tp.put_my_tab_prefs(module, _body(list(order), default), user=USER))


def test_the_personal_upsert_names_the_partial_index_and_names_it_twice(pool):
    """Recorded twice on purpose: one drifted spelling of the conflict
    target is a live InvalidColumnReferenceError a mock cannot raise, so the
    least this suite can do is prove both runs speak identically."""
    _put(pool)
    _put(pool)
    inserts = [c for c in pool.calls if c[0].startswith("INSERT")]
    assert len(inserts) == 2
    for sql, args in inserts:
        assert "INSERT INTO staging.user_tab_prefs" in sql
        assert "ON CONFLICT (user_id, module) WHERE user_id IS NOT NULL" in sql
        # PgBouncer turns an untyped array parse into an instant 500 — the
        # credits incident. The cast is part of the contract.
        assert "$3::text[]" in sql
        assert args[0] == USER["user_id"], "the owner comes from the TOKEN"
    assert inserts[0][0] == inserts[1][0], "same conflict target, verbatim"


def test_the_personal_row_is_orgless(pool):
    """The personal key is (user_id, module): the arrangement follows its
    owner across orgs, so the INSERT must not pin one."""
    _put(pool)
    sql, args = pool.calls[0]
    assert "org_id" not in sql
    assert args == [USER["user_id"], "ganit", ["invoices", "bank"], "bank"]


def test_the_personal_put_echoes_what_it_saved(pool):
    out = _put(pool)
    assert out == {
        "module": "ganit",
        "order": ["invoices", "bank"],
        "default_tab": "bank",
        "source": "personal",
        "updated_at": WHEN.isoformat(),
    }


# ── the org default ──────────────────────────────────────────────────────────

def test_the_org_put_is_403_for_a_non_admin_and_writes_nothing(pool, not_admin):
    with pytest.raises(HTTPException) as e:
        run(tp.put_org_tab_prefs("ganit", _body(["invoices"]),
                                 user=USER, org_id=ORG))
    assert e.value.status_code == 403
    assert pool.calls == []


def test_an_org_admin_writes_the_org_row(pool, as_admin):
    pool._row = {"updated_at": WHEN}
    out = run(tp.put_org_tab_prefs("ganit", _body(["invoices", "stats"], "stats"),
                                   user=USER, org_id=ORG))
    assert out["source"] == "org"
    sql, args = pool.calls[0]
    assert "INSERT INTO staging.user_tab_prefs" in sql
    assert "ON CONFLICT (org_id, module) WHERE user_id IS NULL" in sql
    assert "$3::text[]" in sql
    assert args == [ORG, "ganit", ["invoices", "stats"], "stats"]
    # The column list writes no user_id: the row IS the org default, and the
    # index predicate above only matches when user_id stays NULL.
    assert "user_id" not in sql.split("ON CONFLICT")[0]


def test_the_two_row_shapes_use_different_conflict_targets(pool, as_admin):
    pool._row = {"updated_at": WHEN}
    _put(pool)
    run(tp.put_org_tab_prefs("ganit", _body(["invoices"]), user=USER, org_id=ORG))
    personal_sql = pool.calls[0][0]
    org_sql = pool.calls[1][0]
    assert "(user_id, module) WHERE user_id IS NOT NULL" in personal_sql
    assert "(org_id, module) WHERE user_id IS NULL" in org_sql


# ── delete resets ────────────────────────────────────────────────────────────

def test_delete_drops_only_the_callers_own_row(pool):
    out = run(tp.delete_my_tab_prefs("ganit", user=USER))
    assert out == {"removed": True, "module": "ganit"}
    sql, args = pool.calls[0]
    assert sql.startswith("DELETE FROM staging.user_tab_prefs")
    assert "user_id = $1::text AND module = $2::text" in sql
    assert args == [USER["user_id"], "ganit"]


def test_delete_of_nothing_reports_removed_false(pool):
    pool._status = "DELETE 0"
    out = run(tp.delete_my_tab_prefs("ganit", user=USER))
    assert out["removed"] is False


def test_after_a_delete_the_org_default_is_what_resolves(pool):
    """The reset story end to end: the DELETE touches only the personal row,
    so the next GET falls through to the org default."""
    run(tp.delete_my_tab_prefs("ganit", user=USER))
    pool._rows = [_pref_row("ganit", ["stats"], None, user_id=None)]
    out = run(tp.get_tab_prefs(user=USER, org_id=ORG))
    assert out["ganit"]["source"] == "org"
    assert out["ganit"]["order"] == ["stats"]


# ── the cross-tree ratchet: page keys and MODULE_TABS are ONE set ────────────

def test_the_page_module_keys_are_exactly_module_tabs():
    """Nothing else ties the nine pages' moduleKey literals to MODULE_TABS.
    A key typo'd in the pages saves under a name this router 422s; a key
    typo'd here refuses a page's own saves — so the two sets are read off the
    page source and asserted equal, BOTH directions. The moduleKey is a
    string literal in every caller; that literalness is part of the
    contract this ratchet enforces."""
    pages = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages"
    found: dict[str, str] = {}
    for page in sorted(pages.glob("*.jsx")):
        for key in re.findall(r"useTabPrefs\(\s*['\"]([^'\"]+)['\"]",
                              page.read_text(encoding="utf-8")):
            found[key] = page.name
    assert found, f"no useTabPrefs caller under {pages} — the ratchet went blind"
    missing = tp.MODULE_TABS - set(found)
    extra = {k: found[k] for k in set(found) - tp.MODULE_TABS}
    assert set(found) == tp.MODULE_TABS, (
        f"MODULE_TABS keys no page saves under: {sorted(missing)}; "
        f"page keys the router would refuse: {extra}")


# ── the shadow-tables lesson, swept across every statement ────────────────────

def test_every_statement_is_schema_qualified(pool, as_admin):
    pool._row = {"updated_at": None}
    run(tp.get_tab_prefs(user=USER, org_id=ORG))
    run(tp.put_my_tab_prefs("ganit", _body(["a"]), user=USER))
    run(tp.put_org_tab_prefs("ganit", _body(["a"]), user=USER, org_id=ORG))
    run(tp.delete_my_tab_prefs("ganit", user=USER))
    assert pool.calls, "the sweep must have swept something"
    for sql, _ in pool.calls:
        assert "staging.user_tab_prefs" in sql
