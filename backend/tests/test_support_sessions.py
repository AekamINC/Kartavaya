"""Platform support sessions — one test per impossibility, plus the dormant path.

`middleware/org_resolver.py` was NARROWED on 2026-08-06 because of a real,
measured leak: ten platform accounts could set `X-Org-Id` on any route and
resolve into any organisation, and 7 of 10 saw all 29 teams and 557 tasks on an
ordinary page load. `CROSS_ORG_HEADER_PREFIXES` is that patch. This feature adds
ONE more way through it, so every guard below gets a test that fails when the
guard is deleted.

SIX THINGS MUST BE IMPOSSIBLE:

  1. a session for org A grants org A and NOTHING else
  2. an EXPIRED session grants nothing
  3. an UNAPPROVED session grants nothing
  4. a REVOKED session grants nothing
  5. SELF-APPROVAL — the requester cannot be the approver
  6. the audit row and the owner email are NOT best-effort: if either fails, the
     session does not open

── HOW 2, 3 AND 4 ARE ACTUALLY PROVEN, since it matters ─────────────────────

The live-ness predicate is written ONCE, in `staging.v_active_support_sessions`
(migration 111), and the resolver reads the view rather than re-deriving it. So
those three impossibilities are proven in TWO places and neither alone would be
honest:

  · `_Pool._view_rows` below applies the four clauses, and the behavioural tests
    prove the RESOLVER honours the view's answer and passes the right two
    parameters. On its own this would be testing the fixture.
  · `test_the_view_carries_every_liveness_clause` reads the real SQL out of
    `migrations/111_platform_support_sessions.sql` and asserts all four clauses
    are there, and `test_the_guard_reads_the_view_and_not_the_table` asserts the
    resolver has not quietly switched to the raw table. On its own this would be
    testing a string.

Together, deleting `AND revoked_at IS NULL` from the view fails the second, and
re-deriving the predicate in Python fails the third. That is the pair the brief
asked for.

The fixture dispatches ON THE QUERY, never on call order —
`tests/test_recurring_invoice_generator.py`'s docstring explains why the
alternative cost eight unrelated red tests.
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import asyncpg
import pytest

from middleware import org_resolver as R
from services import support_session as S

#: `pytest.ini` sets `asyncio_mode = auto`, so async tests need no mark.

ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
AGENT = "user_support_agent"
OWNER = "user_org_owner"
SESSION_ID = "11111111-2222-3333-4444-555555555555"

NOW = datetime.now(timezone.utc)
MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations" / "111_platform_support_sessions.sql"
)


# ═════════════════════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════════════════════

def _session(**kw):
    """A row as `staging.platform_support_sessions` holds it. LIVE by default,
    so every test below states the ONE thing it is changing."""
    row = {
        "id": SESSION_ID,
        "ref": "SUP-A1B2C3",
        "org_id": ORG_A,
        "requested_by": AGENT,
        "reason": "customer reported a locked invoice run",
        "modules": ["ganit"],
        "access_level": "viewer",
        "requested_ttl_hours": 2,
        "requested_at": NOW - timedelta(minutes=10),
        "approved_by": OWNER,
        "approved_at": NOW - timedelta(minutes=5),
        "granted_ttl_hours": 2,
        "expires_at": NOW + timedelta(hours=2),
        "owner_emailed_at": NOW - timedelta(minutes=5),
        "denied_by": None, "denied_at": None, "denial_reason": None,
        "revoked_by": None, "revoked_at": None, "revoked_by_party": None,
    }
    row.update(kw)
    return row


class _Request:
    def __init__(self, path, org_header=None, method="GET"):
        self.url = type("U", (), {"path": path})()
        self.method = method
        self.headers = {"x-org-id": org_header} if org_header else {}
        self.state = type("S", (), {})()
        self.client = None

    # `headers` is a plain dict here; starlette's is case-insensitive and the
    # resolver only ever asks for the lowercase key.


class _Pool:
    """Dispatches on the QUERY. Never on call order.

    `raise_on` makes ONE query family fail, which is how the dormant path
    (42P01) and the fail-closed path (a connection error) are driven.
    """

    def __init__(self, sessions=(), is_member=False, is_platform=False,
                 org_active=True, raise_on=None, raises=None):
        self.sessions = list(sessions)
        self.is_member = is_member
        self.is_platform = is_platform
        self.org_active = org_active
        self.raise_on = raise_on
        self.raises = raises
        self.queries = []

    def _view_rows(self, q, org_id, user_id):
        """`staging.v_active_support_sessions`, as migration 111 defines it.

        THE TWO SCOPING CLAUSES ARE APPLIED ONLY IF THE QUERY ACTUALLY CONTAINS
        THEM. Postgres would behave that way and a fixture that filtered on the
        parameters regardless would pass with `AND s.org_id = $1::uuid` deleted
        — which is the single most important line in this feature. So the
        mutation "remove the org clause" fails `test_a_session_for_org_a_does_
        not_admit_org_b`, as it must.

        The FOUR live-ness clauses live in the view, in another file, so a
        deletion there cannot be caught here — it is caught by
        `test_the_view_carries_every_liveness_clause`. See the module docstring.
        """
        rows = self.sessions
        if "s.org_id = $1::uuid" in q:
            rows = [s for s in rows if s["org_id"] == org_id]
        if "s.requested_by = $2" in q:
            rows = [s for s in rows if s["requested_by"] == user_id]
        return [
            s for s in rows
            if s["approved_at"] is not None
            and s["denied_at"] is None
            and s["revoked_at"] is None
            and (s["expires_at"] is None or s["expires_at"] > datetime.now(timezone.utc))
        ]

    def _maybe_raise(self, q):
        if self.raise_on and self.raise_on in q:
            raise self.raises

    async def fetchval(self, sql, *a):
        q = " ".join(sql.split())
        self.queries.append(q)
        if "org_id IS NULL" in q:
            return 1 if self.is_platform else None
        if "staging.user_roles" in q:
            return 1 if self.is_member else None
        return None

    async def fetchrow(self, sql, *a):
        q = " ".join(sql.split())
        self.queries.append(q)
        self._maybe_raise(q)
        if "v_active_support_sessions" in q:
            rows = self._view_rows(q, a[0], a[1])
            return rows[0] if rows else None
        if "staging.user_roles" in q and "role_code IN" in q:
            return {"org_id": ORG_A} if self.is_member else None
        if "staging.organisations" in q:
            return {"id": a[0]} if self.org_active else None
        return None

    async def fetch(self, sql, *a):
        self.queries.append(" ".join(sql.split()))
        return []


def _wire(monkeypatch, pool):
    async def _get_pool():
        return pool
    monkeypatch.setattr(R, "get_pool", _get_pool)
    emitted = []
    monkeypatch.setattr(R, "audit", lambda *a, **k: emitted.append((a, k)))
    return emitted


async def _resolve(monkeypatch, pool, path, org_header):
    return await R.get_org_id(
        _Request(path, org_header), user={"user_id": AGENT}
    ), pool


# ═════════════════════════════════════════════════════════════════════════════
# IMPOSSIBILITY 1 · a session for org A grants org A and NOTHING else
# ═════════════════════════════════════════════════════════════════════════════

async def test_a_live_session_admits_the_org_it_was_granted_for(monkeypatch):
    pool = _Pool(sessions=[_session()])
    emitted = _wire(monkeypatch, pool)
    org_id = await R.get_org_id(
        _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
    )
    assert org_id == ORG_A
    # NEVER SILENT: one row per request a session admits.
    assert [k["detail"]["path"] for _, k in emitted] == ["/api/v1/ganit/invoices"]
    assert emitted[0][0][0] == "platform.support_session_access"
    assert emitted[0][1]["severity"] == "warn"
    assert emitted[0][1]["resource_id"] == "SUP-A1B2C3", "the ref joins the trails"


async def test_a_deactivated_organisation_closes_every_session_in_it(monkeypatch):
    """No sweeper and no revocation needed: `get_org_id` already checks
    `is_active = TRUE` after the branch, and 111's `ON DELETE CASCADE` takes the
    rows away entirely if the org is deleted."""
    pool = _Pool(sessions=[_session()], org_active=False)
    emitted = _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(
            _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
        )
    assert exc.value.status_code == 404
    assert emitted == [], (
        "an audit row saying access happened on a request that 404s is a trail "
        "that disagrees with what occurred"
    )


async def test_a_session_for_org_a_does_not_admit_org_b(monkeypatch):
    """THE LEAK THIS FEATURE MUST NOT REOPEN. Deleting `s.org_id = $1::uuid`
    from `_SUPPORT_SESSION_SQL` turns one approved session into a key to every
    organisation on the platform, which is the shape of the bug that narrowed
    this file in the first place."""
    pool = _Pool(sessions=[_session(org_id=ORG_A)])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(
            _Request("/api/v1/ganit/invoices", ORG_B), user={"user_id": AGENT}
        )
    assert exc.value.status_code == 403


async def test_another_agents_session_is_not_mine(monkeypatch):
    """`s.requested_by = $2`. A session is granted to a PERSON, not to Aekam."""
    pool = _Pool(sessions=[_session(requested_by="user_somebody_else")])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(
            _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
        )
    assert exc.value.status_code == 403


# ═════════════════════════════════════════════════════════════════════════════
# IMPOSSIBILITIES 2, 3, 4 · expired / unapproved / revoked grant nothing
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("why,overrides", [
    ("expired",    {"expires_at": NOW - timedelta(minutes=1)}),
    ("unapproved", {"approved_at": None, "approved_by": None,
                    "expires_at": None, "granted_ttl_hours": None}),
    ("revoked",    {"revoked_at": NOW - timedelta(minutes=1),
                    "revoked_by": OWNER, "revoked_by_party": "customer"}),
    ("denied",     {"denied_at": NOW, "denied_by": OWNER,
                    "denial_reason": "not now"}),
])
async def test_a_session_that_is_not_live_grants_nothing(monkeypatch, why, overrides):
    pool = _Pool(sessions=[_session(**overrides)])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(
            _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
        )
    assert exc.value.status_code == 403, why


async def test_an_until_revoked_session_is_live_not_expired(monkeypatch):
    """`granted_ttl_hours = 0` is the ONLY value that leaves an approved row with
    a NULL expiry, and a bare `expires_at > NOW()` drops exactly those. The most
    permissive session there is must not be the one a reader silently ignores."""
    pool = _Pool(sessions=[_session(granted_ttl_hours=0, expires_at=None)])
    _wire(monkeypatch, pool)
    assert await R.get_org_id(
        _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
    ) == ORG_A


async def test_the_clock_is_read_from_the_database_not_from_python():
    """A worker up for six hours must not still believe a two-hour session is
    open. Nothing on this path reads a timestamp into Python and compares it —
    `NOW()` is evaluated by Postgres inside the view, on every request."""
    sql = R._SUPPORT_SESSION_SQL
    assert "expires_at" not in sql.split("WHERE")[1], (
        "the guard is comparing an expiry itself instead of letting the view do it"
    )
    view = MIGRATION.read_text(encoding="utf-8")
    assert "s.expires_at > NOW()" in view


# ═════════════════════════════════════════════════════════════════════════════
# THE PREDICATE, AND WHERE IT IS ALLOWED TO LIVE
# ═════════════════════════════════════════════════════════════════════════════

def test_the_view_carries_every_liveness_clause():
    """Four clauses. Delete any one and this fails LOUDLY, which is the whole
    point of writing the predicate down in exactly one place."""
    body = MIGRATION.read_text(encoding="utf-8")
    view = body[body.index("CREATE OR REPLACE VIEW"):]
    where = view[view.index(" WHERE "):view.index(";", view.index(" WHERE "))]
    clauses = {" ".join(c.split()) for c in where.replace("WHERE", "").split("AND")}
    assert "s.approved_at IS NOT NULL" in clauses, "a request is not a grant"
    assert "s.denied_at IS NULL" in clauses, "an approved-then-denied row"
    assert "s.revoked_at IS NULL" in clauses, "the customer pulling the grant"
    assert any("expires_at IS NULL OR s.expires_at > NOW()" in c for c in clauses), (
        "NULL is until-revoked and must not be dropped"
    )
    # Exactly four. A fifth would be a rule nobody wrote down; a third is a
    # deletion.
    assert len(clauses) == 4, clauses


def test_the_guard_reads_the_view_and_not_the_table():
    """Re-deriving the predicate at a call site drifts, and the drift is ALWAYS
    permissive: the clause a reader forgets is one that EXCLUDES rows."""
    sql = R._SUPPORT_SESSION_SQL
    assert "v_active_support_sessions" in sql
    assert "FROM staging.platform_support_sessions" not in sql
    for forbidden in ("approved_at IS NOT NULL", "revoked_at IS NULL",
                      "denied_at IS NULL"):
        assert forbidden not in sql, (
            f"{forbidden!r} is re-derived in Python; it belongs only in the view"
        )


def test_the_guard_asks_for_this_org_and_this_user():
    sql = " ".join(R._SUPPORT_SESSION_SQL.split())
    assert "s.org_id = $1::uuid" in sql
    assert "s.requested_by = $2" in sql


# ═════════════════════════════════════════════════════════════════════════════
# A SESSION GRANTS AN ORG, NOT A ROUTE
# ═════════════════════════════════════════════════════════════════════════════

def test_the_console_allow_list_was_not_widened():
    """`CROSS_ORG_HEADER_PREFIXES` is unlocked by a ROLE. Adding a module prefix
    to it would hand every one of the seven roles in CROSS_ORG_HEADER_ROLES
    cross-org reach into the product on the header alone — which is
    `POST /api/v1/vikray/orders`, the first measured chain this file closed."""
    assert R.CROSS_ORG_HEADER_PREFIXES == (
        "/api/v1/subscription/", "/api/v1/billing/", "/api/v1/admin/", "/api/v1/hub/",
    )
    assert "platform_support" not in R.CROSS_ORG_HEADER_ROLES


@pytest.mark.parametrize("path", [
    "/api/tasks/bulk",          # no module gate at all — a measured chain
    "/api/v1/search",           # cross-module record search — a measured chain
    "/api/v1/tasks",
    "/api/v1/teams",
    "/api/v1/projects",
    "/api/v1/vetana/payruns",   # payroll is never in scope
    "/api/v1/manav/employees",
    "/api/v1/pahchan/logs",
    "/api/v1/support-sessions",  # a session cannot manage sessions
])
async def test_a_session_cannot_reach_a_path_outside_its_scope(monkeypatch, path):
    pool = _Pool(sessions=[_session(modules=list(R.SUPPORT_REQUESTABLE_MODULES))])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(_Request(path, ORG_A), user={"user_id": AGENT})
    assert exc.value.status_code == 403, path


async def test_a_session_cannot_reach_a_module_the_customer_did_not_approve(monkeypatch):
    pool = _Pool(sessions=[_session(modules=["ganit"])])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(
            _Request("/api/v1/graha/contacts", ORG_A), user={"user_id": AGENT}
        )
    assert exc.value.status_code == 403


def _org_bearing_routes():
    """Every APIRoute in the REAL app that resolves an org, with its path.

    A string-equality test on the prefix tuple would not have caught the
    collision this file exists to close — `("/api/v1/me", "/api/v1/org/profile")`
    is a perfectly sensible-looking pair, and the damage was in what the ROUTE
    TABLE happened to contain next to it. So this walks the routers.

    FastAPI wraps each `include_router` in an `_IncludedRouter` that keeps the
    real router on `.original_router`, so a flat scan of `app.routes` sees one.
    """
    from fastapi.routing import APIRoute

    import server
    from middleware.org_resolver import get_org_id

    def walk(router, out, seen):
        if id(router) in seen:
            return out
        seen.add(id(router))
        for r in getattr(router, "routes", []):
            if isinstance(r, APIRoute):
                out.append(r)
            inner = getattr(r, "original_router", None)
            if inner is not None:
                walk(inner, out, seen)
            elif hasattr(r, "routes"):
                walk(r, out, seen)
        return out

    def deps(route):
        found = set()

        def down(d):
            if d.call is not None:
                found.add(d.call)
            for sub in d.dependencies:
                down(sub)

        down(route.dependant)
        return found

    routes = walk(server.app, [], set())
    return sorted({
        (r.path, m)
        for r in routes
        for m in r.methods
        if get_org_id in deps(r)
    })


def test_a_session_with_no_modules_reaches_no_route_in_the_real_app():
    """THE MEASUREMENT THAT CAUGHT IT. Before the fix this admitted 32 routes —
    27 of Sanvaad and 5 of `/api/v1/org/profile` — for a session the customer had
    approved for nothing."""
    admitted = [
        f"{m} {p}" for p, m in _org_bearing_routes()
        if R._support_path_allowed(p, (), m)
    ]
    assert admitted == [], admitted


def test_every_route_a_session_reaches_belongs_to_a_module_it_named():
    """For each module a session can hold, the routes it admits must live under
    that module's own prefixes and nowhere else. This is what fails when somebody
    adds a prefix that collides with a router they were not thinking about."""
    routes = _org_bearing_routes()
    for module, prefixes in R.SUPPORT_MODULE_PREFIXES.items():
        allowed = prefixes + R.SUPPORT_UNGATED_READ_PREFIXES.get(module, ())
        for path, method in routes:
            if not R._support_path_allowed(path, (module,), method):
                continue
            assert any(R._path_in(path, p) for p in allowed), (
                f"a {module!r} session reaches {method} {path}, which is not "
                f"under any of {allowed}"
            )
    # And the specific escape, named: no module reaches messaging except sanvaad.
    for module in R.SUPPORT_REQUESTABLE_MODULES - {"sanvaad"}:
        for path, method in routes:
            if path.startswith("/api/v1/messaging"):
                assert not R._support_path_allowed(path, (module,), method), (
                    f"{module} reaches {method} {path}"
                )


def test_the_module_prefixes_never_include_the_sensitive_three():
    """Payroll, personnel files and face photographs. There is no ticket that is
    answered by an Aekam account reading a salary register."""
    for never in ("vetana", "manav", "pahchan"):
        assert never not in R.SUPPORT_MODULE_PREFIXES
        assert never not in R.SUPPORT_REQUESTABLE_MODULES
    joined = "".join(p for ps in R.SUPPORT_MODULE_PREFIXES.values() for p in ps)
    for never in ("vetana", "manav", "pahchan"):
        assert never not in joined


def test_a_hand_written_row_cannot_smuggle_a_forbidden_module():
    """`session_modules` re-filters the row on the way OUT. The request endpoint
    validates on the way in; this is what holds when that is bypassed — a row
    typed straight into psql, or a module dropped from the list later."""
    row = _session(modules=["ganit", "vetana", "manav", "pahchan", "nonsense"])
    assert R.session_modules(row) == ("ganit",)


def test_a_row_that_does_not_look_like_a_session_reaches_nothing():
    """FAIL CLOSED, and do not 500. A row with no `modules` field cannot be a
    session, so it grants no path — an empty tuple makes `_support_path_allowed`
    False everywhere. Letting the KeyError out instead would turn a malformed row
    into a 500 on an ordinary page load, and a 500 is not a safer refusal than a
    refusal."""
    assert R.session_modules({"id": "x"}) == ()
    assert R.session_modules(None) == ()
    assert R.session_modules({"modules": None}) == ()
    # A bare string is not a module list. `"ganit"` must not be read as
    # ('g','a','n','i','t') and must not be read as ('ganit',) either.
    assert R.session_modules({"modules": "ganit"}) == ()
    for path in ("/api/v1/ganit/invoices", "/api/v1/me", "/api/tasks/bulk",
                 "/api/v1/org/profile", "/api/v1/messaging/search"):
        assert R._support_path_allowed(path, R.session_modules({"id": "x"})) is False, path


def test_the_shell_prefixes_are_empty_and_must_stay_empty():
    """Both entries this tuple held were wrong, in two different ways.

    `/api/v1/me` was a STRING PREFIX rather than a path segment, and the shell
    branch returned True BEFORE consulting `modules` — so
    `"/api/v1/messaging/channels".startswith("/api/v1/me")` put the customer's
    entire Sanvaad inside a scope meant for the caller's own profile, for a
    session with ZERO approved modules. And it bought nothing: not one of the six
    routes under `/api/v1/me/` depends on `get_org_id`.

    `/api/v1/org/profile` served bank_details, gstin, pan and tan with no module
    gate at all. It moved under `ganit`, read-only."""
    assert R.SUPPORT_SHELL_PREFIXES == ()
    assert R.SUPPORT_UNGATED_READ_PREFIXES == {"ganit": ("/api/v1/org/profile",)}


def test_a_prefix_matches_on_a_segment_boundary_and_not_on_characters():
    """THE BUG, as a unit. `str.startswith` is not a path test."""
    assert R._path_in("/api/v1/me", "/api/v1/me") is True
    assert R._path_in("/api/v1/me/sessions", "/api/v1/me") is True
    assert R._path_in("/api/v1/messaging/channels", "/api/v1/me") is False
    assert R._path_in("/api/v1/ganit", "/api/v1/ganit/") is True
    assert R._path_in("/api/v1/ganit/invoices", "/api/v1/ganit/") is True
    assert R._path_in("/api/v1/ganitx/oops", "/api/v1/ganit/") is False


@pytest.mark.parametrize("path", [
    "/api/v1/messaging/channels",
    "/api/v1/messaging/search",
    "/api/v1/messaging/dm",
    "/api/v1/messaging/directory",
    "/api/v1/messaging/messages/m1/thread",
])
async def test_a_session_that_approved_ganit_does_not_reach_sanvaad(monkeypatch, path):
    """THE REPRODUCTION. A `modules=['ganit']` session resolved the customer's
    org on all 27 messaging routes because of the prefix collision above."""
    assert R._support_path_allowed(path, ("ganit",)) is False
    pool = _Pool(sessions=[_session(modules=["ganit"])])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(_Request(path, ORG_A), user={"user_id": AGENT})
    assert exc.value.status_code == 403


async def test_a_session_with_no_modules_reaches_nothing_at_all(monkeypatch):
    """It used to reach 32 org-bearing routes — 27 of Sanvaad plus the whole of
    `/api/v1/org/profile`, including the customer's bank details."""
    pool = _Pool(sessions=[_session(modules=[])])
    _wire(monkeypatch, pool)
    for path in ("/api/v1/messaging/channels", "/api/v1/org/profile",
                 "/api/v1/org/profile/senders", "/api/v1/me/sessions",
                 "/api/v1/ganit/invoices"):
        with pytest.raises(Exception) as exc:
            await R.get_org_id(_Request(path, ORG_A), user={"user_id": AGENT})
        assert exc.value.status_code == 403, path


async def test_the_org_profile_is_behind_ganit_and_is_read_only(monkeypatch):
    """`GET /api/v1/org/profile` returns gstin, pan, tan, billing_address and
    **bank_details**; `/senders` returns every configured from-address. Neither
    carries `require_module`, so no module audit row and no level check applies
    to them — which is why a session may READ them only, and only when the
    customer approved the module that holds their books."""
    for path in ("/api/v1/org/profile", "/api/v1/org/profile/senders"):
        assert R._support_path_allowed(path, ("ganit",), "GET") is True, path
        assert R._support_path_allowed(path, ("graha",), "GET") is False, path
        # A write with no module gate would change a customer's record with the
        # access_level check skipped entirely.
        for method in ("PATCH", "PUT", "POST", "DELETE"):
            assert R._support_path_allowed(path, ("ganit",), method) is False, method

    pool = _Pool(sessions=[_session(modules=["ganit"])])
    _wire(monkeypatch, pool)
    assert await R.get_org_id(
        _Request("/api/v1/org/profile", ORG_A), user={"user_id": AGENT}
    ) == ORG_A

    pool = _Pool(sessions=[_session(modules=["ganit"])])
    _wire(monkeypatch, pool)
    with pytest.raises(Exception) as exc:
        await R.get_org_id(
            _Request("/api/v1/org/profile", ORG_A, method="PATCH"),
            user={"user_id": AGENT},
        )
    assert exc.value.status_code == 403


# ═════════════════════════════════════════════════════════════════════════════
# DORMANCY · the table being absent must never be a 500.
#
# 111 IS APPLIED — measured against the live catalogue on 2026-08-21: the
# table and the view are present with zero rows, all six indexes and all ten
# named CHECKs in place. Its own header still says NOT APPLIED AS OF 6 August
# 2026, which was true when it was written.
#
# These tests stay, and are not vestigial: migration 182 (the customer's ASK)
# is applied separately and is NOT applied today, so a deployment where one
# exists and the other does not is the normal state during any rollout.
# ═════════════════════════════════════════════════════════════════════════════

async def test_the_table_being_absent_means_no_sessions_not_a_500(monkeypatch, caplog):
    """A 500 on the org switcher because a migration has not run is not
    acceptable. 42P01 is the TRUE answer "no sessions", logged once."""
    R._SUPPORT_TABLE_ABSENT_LOGGED = False
    pool = _Pool(
        sessions=[_session()],
        raise_on="v_active_support_sessions",
        raises=asyncpg.UndefinedTableError("relation does not exist"),
    )
    _wire(monkeypatch, pool)
    with caplog.at_level("WARNING"):
        for _ in range(3):
            with pytest.raises(Exception) as exc:
                await R.get_org_id(
                    _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
                )
            assert exc.value.status_code == 403
    absent = [r for r in caplog.records if "migration 111 is unapplied" in r.message]
    assert len(absent) == 1, "one warning, then silence"


async def test_a_connection_failure_is_not_read_as_no_session(monkeypatch):
    """FAIL CLOSED, and fail LOUDLY. Catching `Exception` here would turn a
    database blip into a silent 403 that nobody investigates — and, far worse,
    the same `except` written one refactor later around a permissive default
    would turn it into a silent grant."""
    pool = _Pool(
        sessions=[_session()],
        raise_on="v_active_support_sessions",
        raises=asyncpg.PostgresConnectionError("server closed the connection"),
    )
    _wire(monkeypatch, pool)
    with pytest.raises(asyncpg.PostgresConnectionError):
        await R.get_org_id(
            _Request("/api/v1/ganit/invoices", ORG_A), user={"user_id": AGENT}
        )


async def test_the_switcher_renders_nothing_when_the_table_is_absent():
    """`org_switch._support_sessions` guards on `to_regclass` and answers `[]`,
    so `OrgSwitcher.jsx` omits the whole support section. The before state and
    the after state of applying 111 are indistinguishable to every user."""
    from routers.org_switch import _support_sessions

    class _P:
        async def fetchval(self, sql, *a):
            assert "to_regclass" in sql
            return None
        async def fetch(self, sql, *a):  # pragma: no cover - must not be reached
            raise AssertionError("queried the table without checking it exists")

    assert await _support_sessions(_P(), AGENT) == []


async def test_every_service_read_answers_empty_when_the_table_is_absent():
    class _P:
        async def fetch(self, sql, *a):
            raise asyncpg.UndefinedTableError("relation does not exist")
        async def fetchrow(self, sql, *a):
            raise asyncpg.UndefinedTableError("relation does not exist")

    assert await S.list_for_org(_P(), ORG_A) == []
    assert await S.list_for_agent(_P(), AGENT) == []
    assert await S.get_session(_P(), SESSION_ID) is None


async def test_a_write_against_an_absent_table_says_so_rather_than_doing_nothing():
    """"Your approval silently did nothing" is the worst possible answer to a
    customer pressing Approve."""
    class _P:
        async def fetchrow(self, sql, *a):
            if "staging.organisations" in sql:
                return {"id": ORG_A, "name": "Unicode Group"}
            raise asyncpg.UndefinedTableError("relation does not exist")

    with pytest.raises(S.SupportSessionError) as exc:
        await S.request_session(
            _P(), requested_by=AGENT, org_id=ORG_A,
            reason="customer reported a locked invoice run",
            modules=["ganit"], access_level="viewer", ttl_hours=2,
            requestable=R.SUPPORT_REQUESTABLE_MODULES,
        )
    assert exc.value.status == 503
    assert "111" in exc.value.detail


# ═════════════════════════════════════════════════════════════════════════════
# THE APPROVAL · impossibility 5, and impossibility 6
# ═════════════════════════════════════════════════════════════════════════════

class _TxPool:
    """A pool with a real-shaped transaction, so a raise can be observed to roll
    back. Dispatches on the query."""

    def __init__(self, row=None, owner=None, org=None,
                 audit_raises=None, update_returns="ok"):
        self.row = row if row is not None else _session(
            approved_at=None, approved_by=None, granted_ttl_hours=None,
            expires_at=None, owner_emailed_at=None,
        )
        self.owner = owner
        self.org = org if org is not None else {"name": "Unicode Group",
                                                "email": "info@unicodegroup.com"}
        self.audit_raises = audit_raises
        self.update_returns = update_returns
        self.audited = []
        self.updated = []
        self.rolled_back = False

    def acquire(self):
        pool = self

        class _C:
            async def __aenter__(self): return pool
            async def __aexit__(self, *e): return False
        return _C()

    def transaction(self):
        pool = self

        class _T:
            async def __aenter__(self): return None
            async def __aexit__(self, exc_type, *e):
                if exc_type is not None:
                    pool.rolled_back = True
                return False
        return _T()

    async def fetchrow(self, sql, *a):
        q = " ".join(sql.split())
        if "FOR UPDATE" in q:
            return self.row
        if "role_code = 'org_owner'" in q:
            return self.owner
        if "UPDATE staging.platform_support_sessions" in q:
            self.updated.append(a)
            if self.update_returns is None:
                return None
            ttl = a[2]
            return {
                "ref": self.row["ref"],
                "approved_at": NOW,
                "expires_at": NOW + timedelta(hours=ttl) if ttl > 0 else None,
            }
        if "SELECT name, email FROM staging.organisations" in q:
            return self.org
        if "SELECT name FROM staging.organisations" in q:
            return self.org
        if "FROM users WHERE user_id" in q:
            return {"name": "Priya (Aekam)", "email": "priya@aekaminc.com"}
        return None

    async def execute(self, sql, *a):
        if "audit_log" in sql:
            if self.audit_raises:
                raise self.audit_raises
            self.audited.append(a)
        return "OK"


@pytest.fixture
def sent(monkeypatch):
    import email_service
    box = []
    monkeypatch.setattr(
        email_service, "send_email",
        lambda to, subj, html, **kw: (box.append((to, subj, kw)), True)[1],
    )
    return box


async def test_the_requester_cannot_approve_their_own_request(sent):
    """IMPOSSIBILITY 5. Approving yourself creates access; that is the escalation
    the whole feature exists to prevent. Note that self-DENIAL is permitted a few
    tests down — denying yourself removes access."""
    pool = _TxPool()
    with pytest.raises(S.SupportSessionError) as exc:
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=AGENT
        )
    assert exc.value.status == 403
    assert pool.updated == [], "a self-approval must not touch the row"
    assert sent == [], "and must not mail anybody"


async def test_an_approval_by_the_customer_opens_the_session(sent):
    pool = _TxPool(owner={"email": "owner@unicodegroup.com", "name": "Rohit"})
    out = await S.open_session(
        pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
    )
    assert out["ref"] == "SUP-A1B2C3"
    assert out["owner_notified"] == "owner@unicodegroup.com"
    assert out["no_owner_fallback"] is False
    assert len(sent) == 1 and "SUP-A1B2C3" in sent[0][1]
    assert len(pool.audited) == 1
    # `_AUDIT_SQL` binds (org_id, user_id, action, resource_type, ref, detail,
    # severity) in that order. The positions are asserted here and in four other
    # tests below, so a change to that tuple has to come past all of them.
    assert pool.audited[0][2] == "platform.support_session_opened"
    assert pool.audited[0][3] == "support_session", (
        "a GRANT and an ASK must be filterable apart in the audit log"
    )
    # THE CUSTOMER'S OWN AUDIT LOG, not Aekam's.
    assert pool.audited[0][0] == ORG_A


async def test_a_failed_owner_email_aborts_the_open(monkeypatch):
    """IMPOSSIBILITY 6, first half. `pss_approval_and_owner_email_are_one_act` is
    the constraint; this is the same invariant on the side the database cannot
    see. A `try/except` around the send here is the exact shape that is
    forbidden."""
    import email_service
    monkeypatch.setattr(
        email_service, "send_email",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("SES is down")),
    )
    pool = _TxPool(owner={"email": "owner@unicodegroup.com", "name": "Rohit"})
    with pytest.raises(RuntimeError):
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    assert pool.rolled_back, "the grant must not survive a failed notification"
    assert pool.audited == []


async def test_a_send_that_reports_failure_aborts_the_open(monkeypatch):
    import email_service
    monkeypatch.setattr(email_service, "send_email", lambda *a, **k: False)
    pool = _TxPool(owner={"email": "owner@unicodegroup.com", "name": "Rohit"})
    with pytest.raises(S.SupportSessionError) as exc:
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    assert exc.value.status == 502
    assert pool.rolled_back


async def test_a_failed_audit_row_aborts_the_open(sent):
    """IMPOSSIBILITY 6, second half. This is why this module does not import
    `services.audit`: `audit.emit` is fire-and-forget over a `_write` that ends
    in `except Exception: log.warning(...)`, and a best-effort INSERT cannot be
    inside a transaction it is supposed to be able to roll back."""
    pool = _TxPool(
        owner={"email": "owner@unicodegroup.com", "name": "Rohit"},
        audit_raises=asyncpg.PostgresError("audit_log is unavailable"),
    )
    with pytest.raises(asyncpg.PostgresError):
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    assert pool.rolled_back, "an unrecorded support session must not exist"


async def test_a_provider_refusal_actually_rolls_the_grant_back(monkeypatch):
    """IMPOSSIBILITY 6, and it was NOT TRUE before this. `send_email` hands the
    message to a `threading.Thread` and returns True before that thread runs a
    line — measured, a Resend 422 produced `send_email -> True` while the thread
    reported `failed`, so the transaction committed, the row asserted
    `owner_emailed_at = NOW()` and the API answered `owner_notified`.

    The provider now answers on this thread, and its answer decides."""
    import email_service
    import outbound

    class _Refuses:
        class Emails:
            @staticmethod
            def send(params):
                raise RuntimeError("Resend 422: recipient domain does not exist")

    monkeypatch.setattr(email_service, "_resend_client", _Refuses())
    monkeypatch.setattr(email_service, "ses_client", None)
    # The suite runs under `OUTBOUND_MODE=dry`, where the kill switch suppresses
    # the message before any provider is asked and the send reports success —
    # that carve-out is deliberate and has its own test below. This one is about
    # a provider that was asked and said no.
    monkeypatch.setattr(outbound, "DRY_RUN", False)

    pool = _TxPool(owner={"email": "owner@customer.test", "name": "Rohit"})
    with pytest.raises(S.SupportSessionError) as exc:
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    assert exc.value.status == 502
    assert pool.rolled_back, "the grant survived a refused notification"
    assert pool.audited == []


async def test_the_kill_switch_suppressing_the_mail_is_not_a_provider_refusal():
    """THE ONE HONEST GAP, said out loud. `OUTBOUND_MODE=dry` is the deployment
    asking for nothing to leave the building; a session may still open, and the
    `suppressed` row in `staging.outbound_log` carries `mode='dry'` and says so.
    If this ever fails, staging can no longer approve a support session at all."""
    import outbound
    assert outbound.DRY_RUN, "the suite is expected to run with the switch on"

    pool = _TxPool(owner={"email": "o@x.com", "name": "R"})
    out = await S.open_session(
        pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
    )
    assert out["owner_notified"] == "o@x.com"
    assert len(pool.audited) == 1


def test_the_owner_mail_waits_for_the_provider():
    """A tripwire on the one keyword the guarantee rests on. Drop `blocking=True`
    and the send is fire-and-forget again, silently."""
    import inspect
    src = inspect.getsource(S.open_session)
    call = src[src.index("send_email("):]
    call = call[:call.index(")\n")]
    assert "blocking=True" in call, (
        "the owner notification is fire-and-forget again; 'a failure to send "
        "un-does the grant' becomes false for every real delivery failure"
    )


async def test_the_owner_notification_is_filed_under_the_customers_org(sent):
    """`outbound_log` is read `WHERE org_id = $1::uuid` in three places, so a
    NULL org is a row no customer screen will ever return — and the failed-send
    row is the ONE artefact that would say the owner was not told.

    These routes deliberately do not use `get_org_id` (the requester is not a
    member), so nothing sets the ContextVar `outbound.begin()` reads. The org has
    to be scoped explicitly."""
    import outbound

    seen = []
    real = outbound.begin

    def _spy(channel, target="", detail="", **kw):
        seen.append((outbound.current_org(), outbound.current_user()))
        return real(channel, target, detail, **kw)

    import email_service
    orig = email_service.send_email

    def _send(to, subj, html, **kw):
        att = _spy("email", to, subj)
        att.failed("not really sent, this is the probe")
        return True

    try:
        email_service.send_email = _send
        pool = _TxPool(owner={"email": "o@x.com", "name": "R"})
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    finally:
        email_service.send_email = orig

    assert seen == [(ORG_A, OWNER)], (
        "the send was attributed to no tenant; the customer can never see it"
    )
    # And the scope PUT BACK what it found — a request path with no task
    # boundary must not leave org A in place for whatever runs next.
    assert outbound.current_org() is None


def test_the_approval_path_wraps_neither_the_mail_nor_the_audit():
    """A tripwire, because the failure this guards against is a well-meant
    refactor: somebody sees an approval 500 in the logs and 'fixes' it with a
    try/except. The two awaits below must stay bare."""
    import inspect
    src = inspect.getsource(S.open_session)
    body = src[src.index("send_email("):]
    assert "except" not in body, (
        "the owner mail or the audit row has been wrapped in an except; "
        "support access would then be able to open silently"
    )
    assert "except Exception" not in inspect.getsource(S._audit)


async def test_an_org_with_no_owner_falls_back_to_its_own_address_and_says_so(sent):
    """MEASURED, 2026-08-06: Unicode Group holds FOUR org_admin rows, one
    org_member and ZERO org_owner, and nothing in this backend can write an
    org_owner row into an existing org (`role_tiers.refuse_grant`). 111's closing
    note resolves the recipient as org_owner ONLY, which would make every
    support session for the platform's one paying customer impossible to
    approve. A refusal whose remedy does not exist is an outage."""
    pool = _TxPool(owner=None)
    out = await S.open_session(
        pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
    )
    assert out["owner_notified"] == "info@unicodegroup.com"
    assert out["no_owner_fallback"] is True
    # NOT SILENT — the same key `org_members._audit_grants` already uses.
    import json
    assert json.loads(pool.audited[0][5])["no_owner_fallback"] is True


async def test_no_owner_and_no_address_refuses_rather_than_opening_quietly(sent):
    pool = _TxPool(owner=None, org={"name": "Ghost Ltd", "email": ""})
    with pytest.raises(S.SupportSessionError) as exc:
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    assert exc.value.status == 409
    assert sent == []
    assert pool.updated == []


async def test_two_approvers_pressing_at_once_produce_one_session(sent):
    """The UPDATE is guarded `WHERE approved_at IS NULL AND denied_at IS NULL`,
    so the loser matches no row. No second mail and no second audit row."""
    pool = _TxPool(owner={"email": "o@x.com", "name": "R"}, update_returns=None)
    with pytest.raises(S.SupportSessionError) as exc:
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER
        )
    assert exc.value.status == 409
    assert sent == []
    assert pool.audited == []


async def test_the_clock_is_computed_by_postgres_in_the_approving_statement(sent):
    """No `started_at`, no dormant grant, and no Python timestamp. `expires_at`
    is `NOW() + make_interval(...)` in the SAME statement that writes
    `approved_at` — 111's `pss_expiry_matches_granted_ttl` refuses anything
    else."""
    import inspect
    src = inspect.getsource(S.open_session)
    update = src[src.index("UPDATE staging.platform_support_sessions"):]
    update = update[:update.index('"""') if '"""' in update else len(update)]
    assert "approved_at = NOW()" in update
    assert "NOW() + make_interval(hours => $3)" in update
    assert "owner_emailed_at = NOW()" in update
    assert "datetime" not in update


@pytest.mark.parametrize("granted,why", [
    (0,   "until-revoked against a two-hour ask is the biggest lengthening there is"),
    (24,  "a longer window than the agent asked for"),
    (168, "a week against a two-hour ask"),
])
async def test_an_approval_may_never_lengthen_a_request(sent, granted, why):
    pool = _TxPool(owner={"email": "o@x.com", "name": "R"})
    with pytest.raises(S.SupportSessionError) as exc:
        await S.open_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER,
            granted_ttl_hours=granted,
        )
    assert exc.value.status == 400, why
    assert sent == []


async def test_an_approval_may_shorten_a_request_and_both_numbers_survive(sent):
    """111 keeps `requested_ttl_hours` AND `granted_ttl_hours` precisely so that
    a customer who SHORTENED a request can be seen to have done so. That is also
    the reason there is no extension: an extension overwrites the granted
    duration and erases the evidence that the customer ever narrowed anything."""
    import json
    pool = _TxPool(
        row=_session(approved_at=None, approved_by=None, granted_ttl_hours=None,
                     expires_at=None, owner_emailed_at=None,
                     requested_ttl_hours=168),
        owner={"email": "o@x.com", "name": "R"},
    )
    out = await S.open_session(
        pool, session_id=SESSION_ID, org_id=ORG_A, approver_id=OWNER,
        granted_ttl_hours=2,
    )
    assert out["granted_ttl_hours"] == 2
    detail = json.loads(pool.audited[0][5])
    assert detail["requested_ttl_hours"] == 168 and detail["granted_ttl_hours"] == 2


def test_there_is_no_way_to_extend_a_session():
    """No `extended_at`, no `extended_by`, and after approval the ONLY UPDATE the
    row ever takes is the revocation triple. A second request is a new ref, a new
    reason, a new decision, a new audit row and a new email — a fresh consent
    rather than a silently lengthened old one, and
    `idx_pss_one_pending_per_agent_per_org` is partial on the UNDECIDED state so
    one can be raised while the first is still live."""
    import inspect
    for name in ("extend_session", "extend", "extended_at", "extended_by"):
        assert not hasattr(S, name), name
    migration = MIGRATION.read_text(encoding="utf-8")
    for column in ("extended_at", "extended_by"):
        assert column not in migration, column
    # The only UPDATE an APPROVED row ever takes is the revocation triple.
    src = inspect.getsource(S)
    starts = [m.start() for m in
              re.finditer(r"UPDATE staging\.platform_support_sessions", src)]
    assert len(starts) == 3, "approve, deny, revoke — and nothing else"
    for start in starts:
        stmt = " ".join(src[start:start + 700].split())
        if "revoked_by_party" in stmt:
            continue  # the revocation triple, the one post-approval write
        assert "approved_at IS NULL" in stmt, (
            f"an UPDATE that can touch an already-approved row: {stmt[:160]}"
        )


# ═════════════════════════════════════════════════════════════════════════════
# DENY AND REVOKE
# ═════════════════════════════════════════════════════════════════════════════

async def test_the_requester_may_withdraw_their_own_request():
    """Self-DENIAL is permitted while self-APPROVAL is not. Denying yourself
    removes access; approving yourself creates it. Only one is an escalation."""
    pool = _TxPool()
    out = await S.deny_session(
        pool, session_id=SESSION_ID, org_id=ORG_A, decided_by=AGENT,
        reason="raised against the wrong org", is_requester=True,
    )
    assert out["denied"] is True
    import json
    assert json.loads(pool.audited[0][5])["withdrawal"] is True


async def test_a_denial_needs_a_reason():
    with pytest.raises(S.SupportSessionError) as exc:
        await S.deny_session(
            _TxPool(), session_id=SESSION_ID, org_id=ORG_A,
            decided_by=OWNER, reason="   ",
        )
    assert exc.value.status == 400


async def test_an_approved_session_is_revoked_not_denied():
    pool = _TxPool(row=_session())
    with pytest.raises(S.SupportSessionError) as exc:
        await S.deny_session(
            pool, session_id=SESSION_ID, org_id=ORG_A, decided_by=OWNER,
            reason="changed my mind",
        )
    assert exc.value.status == 409
    assert "Revoke" in exc.value.detail


async def test_revoking_something_never_approved_has_no_meaning():
    """111's `pss_revocation_needs_an_approval`. The withdrawal of a REQUEST is a
    denial, and it has its own columns."""
    pool = _TxPool()
    with pytest.raises(S.SupportSessionError) as exc:
        await S.revoke_session(
            pool, session_id=SESSION_ID, org_id=ORG_A,
            revoked_by=OWNER, party="customer",
        )
    assert exc.value.status == 409


async def test_a_revocation_records_which_of_the_three_parties_did_it():
    """`revoked_by_party` is separate from `revoked_by` because an Aekam platform
    admin can also be the person who requested it — the identity does not say
    which of the three happened."""
    import json
    for party in ("customer", "aekam", "self"):
        pool = _TxPool(row=_session())
        out = await S.revoke_session(
            pool, session_id=SESSION_ID, org_id=ORG_A,
            revoked_by=OWNER, party=party,
        )
        assert out["revoked"] is True
        assert json.loads(pool.audited[0][5])["revoked_by_party"] == party


async def test_an_unknown_revocation_party_is_refused():
    with pytest.raises(S.SupportSessionError):
        await S.revoke_session(
            _TxPool(), session_id=SESSION_ID, org_id=ORG_A,
            revoked_by=OWNER, party="whoever",
        )


# ═════════════════════════════════════════════════════════════════════════════
# THE REQUEST · what may be asked for at all
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("kw,why", [
    ({"reason": "too short"}, "a reason nobody can decide on"),
    ({"modules": []}, "a session that reaches nothing"),
    ({"modules": ["vetana"]}, "payroll"),
    ({"modules": ["manav"]}, "personnel files"),
    ({"modules": ["pahchan"]}, "face photographs"),
    ({"modules": ["ganit", "ganit"]}, "the same module twice"),
    ({"access_level": "admin"}, "a session is capped BELOW admin"),
    ({"ttl_hours": 9999}, "a duration nobody chose from a list"),
])
def test_a_request_that_could_not_mean_anything_is_refused(kw, why):
    args = dict(
        reason="customer reported a locked invoice run",
        modules=["ganit"], access_level="viewer", ttl_hours=2,
        requestable=R.SUPPORT_REQUESTABLE_MODULES,
    )
    args.update(kw)
    with pytest.raises(S.SupportSessionError) as exc:
        S.validate_request(**args)
    assert exc.value.status == 400, why


def test_the_four_durations_and_nothing_else():
    assert S.TTL_CHOICES == (0, 2, 24, 168)
    assert S.ACCESS_LEVELS == ("viewer", "editor")


def test_a_reference_can_be_read_down_a_phone_line():
    """No I and no O: SUP-I0OI is not a thing anybody can dictate correctly, and
    the ref is what the approval mail, the switcher row and the audit entry all
    name. Must match 111's CHECK or every insert fails at the constraint."""
    for _ in range(200):
        assert re.fullmatch(r"SUP-[0-9A-HJ-NP-Z]{6}", S.new_ref())


def test_state_is_derived_and_never_stored():
    """111 refuses a `status` column: a stored status is a cache of a clock, and
    a stale AUTHORISATION cache means somebody has access they should not have
    and nothing on screen looks wrong."""
    assert S.derive_state(_session()) == "active"
    assert S.derive_state(_session(expires_at=None)) == "active"
    assert S.derive_state(_session(expires_at=NOW - timedelta(minutes=1))) == "expired"
    assert S.derive_state(_session(revoked_at=NOW)) == "revoked"
    assert S.derive_state(_session(denied_at=NOW)) == "denied"
    assert S.derive_state(
        _session(approved_at=None, expires_at=None)
    ) == "requested"

    body = MIGRATION.read_text(encoding="utf-8")
    table = body[body.index("CREATE TABLE"):body.index("COMMENT ON TABLE")]
    # Column DECLARATIONS only. The prose above and inside the DDL argues about
    # `status` at length and must not trip this.
    declared = re.findall(r"^\s{4}([a-z_]+)\s+[A-Z]", table, re.M)
    for cached in ("status", "state", "is_active", "active", "started_at",
                   "extended_at", "extended_by"):
        assert cached not in declared, f"somebody added {cached!r}"


# ═════════════════════════════════════════════════════════════════════════════
# THE MODULE GATE · without this the feature is a 403 wall
# ═════════════════════════════════════════════════════════════════════════════

def test_no_session_leaves_the_platform_refusal_exactly_as_it_was():
    """With no session in hand — which is every request on the platform today,
    because `platform_support` has zero holders and
    `staging.platform_support_sessions` holds zero rows (measured
    2026-08-21) — this function changes nothing for anybody."""
    from middleware.subscription import support_refusal
    assert support_refusal(
        "ganit", None, is_write=False, otherwise="the original refusal"
    ) == "the original refusal"


def test_a_session_lifts_the_refusal_only_for_the_modules_it_names():
    from middleware.subscription import support_refusal
    row = _session(modules=["ganit"], access_level="viewer")
    assert support_refusal("ganit", row, is_write=False, otherwise="no") is None
    assert support_refusal("graha", row, is_write=False, otherwise="no") is not None
    # Not liftable at all, even from a row that names it.
    assert support_refusal(
        "vetana", _session(modules=["vetana"]), is_write=False, otherwise="no"
    ) is not None


def test_a_session_CAPS_a_role_that_would_have_reached_the_module_anyway():
    """THE SECOND BLOCKER. `support_refusal` used to `return otherwise` for a
    module the session did not name — and `otherwise` is None whenever the
    operator's platform ROLE already reaches it. Measured before the fix:
    `platform_refusal` answers ALLOW for platform_staff, platform_manager,
    platform_admin and platform_owner on graha, sanvaad and prachar, so a
    customer approving "graha, view only" granted admin write on six modules.

    A session is now the WHOLE of the authority inside the org it names: a
    module the customer did not name is refused even when the role would have
    had it."""
    from middleware.subscription import support_refusal
    row = _session(modules=["graha"], access_level="viewer")
    for module in ("sanvaad", "prachar", "vikray", "dristi", "sahayak"):
        for is_write in (False, True):
            assert support_refusal(
                module, row, is_write=is_write, otherwise=None
            ) is not None, f"{module} write={is_write} — the role's reach, uncapped"
    # And the module the customer DID name is still capped at what they chose.
    assert support_refusal("graha", row, is_write=False, otherwise=None) is None
    assert support_refusal("graha", row, is_write=True, otherwise=None) is not None


def test_the_effective_level_is_one_expression_used_by_both_readers():
    """The audit row said `level: 'admin'` for a session the customer had capped
    at `viewer`, because the enforcement and the report were two expressions."""
    from middleware.subscription import support_level
    editor = _session(modules=["ganit", "prachar"], access_level="editor")
    assert support_level("ganit", editor) == "editor"
    assert support_level("prachar", editor) == "viewer", "sending is read-only"
    assert support_level("ganit", _session(access_level="viewer")) == "viewer"
    # No session at all: unchanged, the platform tier.
    from middleware.subscription import PLATFORM_MODULE_LEVEL
    assert support_level("ganit", None) == PLATFORM_MODULE_LEVEL


def test_the_module_gate_reads_the_session_even_when_the_role_needs_no_lift():
    """The call site, not the policy. `support_refusal` was consulted only inside
    `if refusal:`, so for the four roles above it never ran at all."""
    import inspect

    from middleware import subscription

    # EXECUTABLE LINES ONLY. The comment explaining this bug quotes `if refusal:`
    # verbatim, and a naive slice stops there instead of at the real statement.
    src = "\n".join(
        line for line in
        inspect.getsource(subscription.require_module).splitlines()
        if not line.strip().startswith("#")
    )
    lookup = src.index("active_support_session(")
    refusal_test = src.index("if refusal:")
    assert lookup < refusal_test, (
        "the support session is looked up behind a refusal test again — the "
        "customer's access_level and module list would stop applying to every "
        "platform role that already reaches the module by role, which is 4 of 8"
    )
    assert src.index("support_refusal(") < refusal_test
    # And it is the MEMBERSHIP answer that decides whether to look, not a refusal.
    guard = src[src.index("is_member ="):lookup]
    assert "if not is_member" in guard


def test_a_viewer_session_cannot_write():
    from middleware.subscription import support_refusal
    row = _session(modules=["ganit"], access_level="viewer")
    assert support_refusal("ganit", row, is_write=True, otherwise="no") is not None


class _GatePool:
    """Enough of a pool to drive the REAL `require_module` dependency."""

    def __init__(self, platform_role, session=None, is_member=False):
        self.platform_role = platform_role
        self.session = session
        self.is_member = is_member

    async def fetchval(self, sql, *a):
        q = " ".join(sql.split())
        if "org_id IS NULL" in q:
            return self.platform_role
        if "org_id=$2::uuid" in q:
            return 1 if self.is_member else None
        return None

    async def fetchrow(self, sql, *a):
        if "v_active_support_sessions" in " ".join(sql.split()):
            return self.session
        return None


async def _gate(monkeypatch, module, pool, path, method="GET"):
    """Run the real `require_module(module)` over `pool`. Returns audit rows."""
    from middleware import subscription as SUB

    async def _gp():
        return pool
    monkeypatch.setattr(SUB, "get_pool", _gp)
    rows = []
    monkeypatch.setattr(SUB, "audit", lambda *a, **k: rows.append((a, k)))

    req = _Request(path, method=method)
    req.state._auth_user = {"user_id": AGENT}
    await SUB.require_module(module)(req, org_id=ORG_A)
    return rows


async def test_a_graha_session_no_longer_opens_sanvaad_for_platform_staff(monkeypatch):
    """END TO END, through the real gate. Before the fix this was ADMITTED with
    the module audit row recording `level: 'admin'` and no session ref."""
    row = _session(modules=["graha"], access_level="viewer")
    for method, path in (("GET", "/api/v1/messaging/search"),
                         ("POST", "/api/v1/messaging/dm"),
                         ("POST", "/api/v1/messaging/channels/c1/messages")):
        pool = _GatePool("platform_staff", session=row)
        with pytest.raises(Exception) as exc:
            await _gate(monkeypatch, "sanvaad", pool, path, method)
        assert exc.value.status_code == 403, f"{method} {path}"


async def test_the_module_the_customer_named_is_reached_at_the_level_they_chose(
    monkeypatch,
):
    pool = _GatePool(
        "platform_support",
        session=_session(modules=["graha"], access_level="viewer"),
    )
    rows = await _gate(monkeypatch, "graha", pool, "/api/v1/graha/contacts")
    assert rows == [], "a non-sensitive read by a platform role stays silent"

    # A write at viewer is refused, whatever the role would have held.
    pool = _GatePool(
        "platform_staff",
        session=_session(modules=["graha"], access_level="viewer"),
    )
    with pytest.raises(Exception) as exc:
        await _gate(monkeypatch, "graha", pool, "/api/v1/graha/contacts", "POST")
    assert exc.value.status_code == 403


async def test_the_write_a_session_does_permit_is_audited_with_its_real_level(
    monkeypatch,
):
    """The two trails have to JOIN — the ref is what the customer's approval mail
    and their own audit log both name."""
    pool = _GatePool(
        "platform_staff",
        session=_session(modules=["graha"], access_level="editor"),
    )
    rows = await _gate(monkeypatch, "graha", pool, "/api/v1/graha/contacts", "POST")
    assert len(rows) == 1
    detail = rows[0][1]["detail"]
    assert detail["level"] == "editor", "not the platform tier's admin"
    assert detail["support_session"] == "SUP-A1B2C3"
    assert detail["member"] is False
    assert rows[0][1]["severity"] == "warn"


async def test_a_member_of_the_org_is_not_capped_by_somebody_elses_session(
    monkeypatch,
):
    """The cap is about an Aekam account inside an org it does NOT belong to.
    Nine of the ten live platform accounts are members of Aekam Inc and nothing
    else, and their own org must behave exactly as before — which is also why the
    session query is not made for them at all."""
    class _NoSessionQuery(_GatePool):
        async def fetchrow(self, sql, *a):
            raise AssertionError(
                "a member's request paid for a support-session lookup"
            )

    pool = _NoSessionQuery("platform_staff", is_member=True)
    rows = await _gate(monkeypatch, "graha", pool, "/api/v1/graha/contacts", "POST")
    assert rows[0][1]["detail"]["level"] == "admin"
    assert rows[0][1]["detail"]["member"] is True
    assert rows[0][1]["severity"] == "info"


async def test_with_the_table_absent_the_gate_behaves_exactly_as_before(monkeypatch):
    """Production's state today. 42P01 is "no sessions", and the platform branch
    must be indistinguishable from what it was."""
    R._SUPPORT_TABLE_ABSENT_LOGGED = True

    class _Absent(_GatePool):
        async def fetchrow(self, sql, *a):
            raise asyncpg.UndefinedTableError("relation does not exist")

    rows = await _gate(
        monkeypatch, "graha", _Absent("platform_staff"),
        "/api/v1/graha/contacts", "POST",
    )
    assert rows[0][1]["detail"]["level"] == "admin"
    assert "support_session" not in rows[0][1]["detail"]

    with pytest.raises(Exception) as exc:
        await _gate(
            monkeypatch, "vetana", _Absent("platform_staff"),
            "/api/v1/vetana/payruns",
        )
    assert exc.value.status_code == 403


def test_an_editor_session_may_write_except_on_the_sending_modules():
    """An `editor` on prachar, varta or sanvaad does not change a record — it
    SENDS, in the customer's name, to the customer's contacts."""
    from middleware.subscription import support_refusal
    editor = _session(
        modules=["ganit", "prachar", "varta", "sanvaad"], access_level="editor"
    )
    assert support_refusal("ganit", editor, is_write=True, otherwise="no") is None
    for sending in ("prachar", "varta", "sanvaad"):
        assert support_refusal(
            sending, editor, is_write=True, otherwise="no"
        ) is not None, sending
        assert support_refusal(
            sending, editor, is_write=False, otherwise="no"
        ) is None, sending


# ═════════════════════════════════════════════════════════════════════════════
# THE LIST · what the two screens are told
# ═════════════════════════════════════════════════════════════════════════════

class _ListPool:
    def __init__(self, rows):
        self.rows = rows
        self.sql = None

    async def fetch(self, sql, *a):
        self.sql = " ".join(sql.split())
        return self.rows


def _listed_row(**kw):
    row = _session(approved_at=None, approved_by=None, granted_ttl_hours=None,
                   expires_at=None, owner_emailed_at=None)
    row.update({"org_name": "Unicode Group",
                "requested_by_name": "Priya (Aekam)",
                "approved_by_name": None})
    row.update(kw)
    return row


async def test_the_customer_list_offers_approve_only_to_somebody_else():
    """The button is not the authority — `open_session` refuses a self-approval
    under the row lock whatever this says — but a screen that offers a control
    which is then refused teaches the operator the wrong model."""
    pool = _ListPool([_listed_row()])
    rows = await S.list_for_org(pool, ORG_A, viewer_id=OWNER)
    assert rows[0]["can_approve"] is True
    assert rows[0]["state"] == "requested"

    same = await S.list_for_org(_ListPool([_listed_row()]), ORG_A, viewer_id=AGENT)
    assert same[0]["can_approve"] is False, "the requester is never the approver"


async def test_the_operators_own_list_never_offers_approve():
    rows = await S.list_for_agent(_ListPool([_listed_row()]), AGENT)
    assert rows[0]["can_approve"] is False
    rows = await S.list_all(_ListPool([_listed_row()]), viewer_id="user_god")
    assert rows[0]["can_approve"] is False, (
        "an Aekam account approving an Aekam account is the feature inverted"
    )


async def test_the_list_names_the_people_rather_than_their_ids():
    """`user_549c9cac35aa` is not something an org owner can act on. The person
    deciding whether to let somebody into their books needs to be told WHO."""
    rows = await S.list_for_org(_ListPool([_listed_row()]), ORG_A, viewer_id=OWNER)
    assert rows[0]["requested_by_name"] == "Priya (Aekam)"
    assert rows[0]["org_name"] == "Unicode Group"


async def test_an_until_revoked_row_reads_as_active_in_the_list():
    rows = await S.list_for_org(
        _ListPool([_listed_row(approved_at=NOW, approved_by=OWNER,
                               granted_ttl_hours=0, expires_at=None,
                               approved_by_name="Rohit")]),
        ORG_A, viewer_id=OWNER,
    )
    assert rows[0]["state"] == "active"
    assert rows[0]["expires_at"] is None


# ═════════════════════════════════════════════════════════════════════════════
# THE ROUTER · scope is an INTENT, and `party` is DERIVED
# ═════════════════════════════════════════════════════════════════════════════

class _RouterPool:
    def __init__(self, platform_role=None, manages=()):
        self.platform_role = platform_role
        self.manages = set(manages)

    async def fetchval(self, sql, *a):
        if "org_id IS NULL" in sql:
            # HONOURS THE ROLE LIST THE CALLER PASSED. `_platform_role` asks for
            # ALL_PLATFORM_ROLES and `_may_request` asks for SUPPORT_ROLES; a
            # fixture that answered the same role to both would pass with the
            # narrowing deleted, which is the one thing it is here to catch.
            wanted = a[1] if len(a) > 1 else ()
            return self.platform_role if self.platform_role in (wanted or ()) else None
        if "org_id=$2::uuid" in sql:
            return 1 if a[1] in self.manages else None
        return None

    async def fetch(self, sql, *a):
        if "DISTINCT org_id" in sql:
            return [{"org_id": o} for o in sorted(self.manages)]
        return []

    async def fetchrow(self, sql, *a):
        return None


def _router_pool(monkeypatch, pool):
    import routers.support_sessions as RT

    async def _gp():
        return pool
    monkeypatch.setattr(RT, "get_pool", _gp)
    return RT


async def test_asking_for_every_session_on_the_platform_needs_god_mode(monkeypatch):
    RT = _router_pool(monkeypatch, _RouterPool(platform_role="platform_support"))
    with pytest.raises(Exception) as exc:
        await RT.list_sessions(scope="all", user={"user_id": AGENT})
    assert exc.value.status_code == 403


async def test_an_unknown_scope_is_refused_rather_than_defaulted(monkeypatch):
    """Defaulting an unrecognised scope to `mine` would make a typo answer
    silently and wrongly. It is a 400."""
    RT = _router_pool(monkeypatch, _RouterPool(platform_role="platform_owner"))
    with pytest.raises(Exception) as exc:
        await RT.list_sessions(scope="everything", user={"user_id": AGENT})
    assert exc.value.status_code == 400


async def test_the_customer_scope_answers_only_the_orgs_you_manage(monkeypatch):
    """`scope` names an AUDIENCE and never an authority. A platform operator
    asking for `customer` gets the orgs they personally manage — for nine of the
    ten live platform accounts that is Aekam Inc alone."""
    RT = _router_pool(monkeypatch, _RouterPool(
        platform_role="platform_owner", manages={ORG_A},
    ))
    asked = []

    async def _list_for_org(pool, oid, viewer_id=None):
        asked.append(oid)
        return []
    monkeypatch.setattr(RT.svc, "list_for_org", _list_for_org)

    await RT.list_sessions(scope="customer", user={"user_id": AGENT})
    assert asked == [ORG_A]

    with pytest.raises(Exception) as exc:
        await RT.list_sessions(
            scope="customer", org_id=ORG_B, user={"user_id": AGENT}
        )
    assert exc.value.status_code == 403


@pytest.mark.parametrize("caller,manages,role,expected", [
    (AGENT, set(),    None,             "self"),
    (OWNER, {ORG_A},  None,             "customer"),
    ("user_god", set(), "platform_owner", "aekam"),
])
async def test_the_revocation_party_is_derived_and_the_body_is_ignored(
    monkeypatch, caller, manages, role, expected
):
    """`revoked_by_party` exists to tell three otherwise-identical revocations
    apart. A client that could name its own would be able to write `customer` on
    an Aekam revocation, which erases exactly the distinction the column was
    added to preserve."""
    RT = _router_pool(monkeypatch, _RouterPool(platform_role=role, manages=manages))
    monkeypatch.setattr(
        RT.svc, "get_session",
        lambda pool, sid: _async({"id": sid, "ref": "SUP-A1B2C3",
                                  "org_id": ORG_A, "requested_by": AGENT}),
    )
    seen = {}

    async def _revoke(pool, **kw):
        seen.update(kw)
        return {"revoked": True}
    monkeypatch.setattr(RT.svc, "revoke_session", _revoke)

    await RT.revoke(
        SESSION_ID,
        body=RT.Revocation(party="customer"),   # a lie, in every case but one
        user={"user_id": caller},
    )
    assert seen["party"] == expected
    assert seen["revoked_by"] == caller


async def test_a_stranger_cannot_revoke(monkeypatch):
    RT = _router_pool(monkeypatch, _RouterPool())
    monkeypatch.setattr(
        RT.svc, "get_session",
        lambda pool, sid: _async({"id": sid, "ref": "SUP-A1B2C3",
                                  "org_id": ORG_A, "requested_by": AGENT}),
    )
    with pytest.raises(Exception) as exc:
        await RT.revoke(SESSION_ID, body=RT.Revocation(), user={"user_id": "user_nobody"})
    assert exc.value.status_code == 403


async def test_only_aekam_staff_can_see_the_organisation_picker(monkeypatch):
    """403 and not an empty list: an empty list reads as "there are no
    organisations", which is a different and false fact."""
    RT = _router_pool(monkeypatch, _RouterPool(platform_role=None))
    with pytest.raises(Exception) as exc:
        await RT.requestable_organisations(user={"user_id": "user_customer"})
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", [
    "platform_owner", "platform_admin", "platform_manager", "platform_staff",
    "account_manager", "account_finance", "sahayak_admin", None,
])
async def test_only_platform_support_may_raise_a_request(monkeypatch, role):
    """THE OTHER HALF OF THE CAP. `_platform_role` gated this on
    ALL_PLATFORM_ROLES, and 4 of those 8 already reach graha, vikray, prachar,
    sahayak, dristi and sanvaad BY ROLE — so a session in their hands could only
    ever ADD authority. The only holder of a session is now the role that gets
    nothing without one, which is what makes "the customer decides" true."""
    RT = _router_pool(monkeypatch, _RouterPool(platform_role=role))
    body = RT.SessionRequest(
        org_id=ORG_A, reason="customer reported a locked invoice run",
        modules=["ganit"], access_level="viewer", requested_ttl_hours=2,
    )
    with pytest.raises(Exception) as exc:
        await RT.request_access(body, user={"user_id": AGENT})
    assert exc.value.status_code == 403, role
    with pytest.raises(Exception) as exc:
        await RT.requestable_organisations(user={"user_id": AGENT})
    assert exc.value.status_code == 403, role


async def test_platform_support_may_raise_a_request(monkeypatch):
    RT = _router_pool(monkeypatch, _RouterPool(platform_role="platform_support"))
    seen = {}

    async def _request(pool, **kw):
        seen.update(kw)
        return {"ref": "SUP-A1B2C3"}
    monkeypatch.setattr(RT.svc, "request_session", _request)

    await RT.request_access(
        RT.SessionRequest(
            org_id=ORG_A, reason="customer reported a locked invoice run",
            modules=["ganit"],
        ),
        user={"user_id": AGENT},
    )
    assert seen["requested_by"] == AGENT, "never read from the body"
    assert seen["org_id"] == ORG_A


async def test_the_form_is_built_from_the_guards_own_constants(monkeypatch):
    """A picker offering `vetana` would produce requests that can be approved
    and then reach nothing."""
    RT = _router_pool(monkeypatch, _RouterPool(platform_role="platform_support"))
    monkeypatch.setattr(RT.svc, "requestable_organisations", lambda pool: _async([]))
    out = await RT.requestable_organisations(user={"user_id": AGENT})
    assert out["modules"] == sorted(R.SUPPORT_REQUESTABLE_MODULES)
    assert out["read_only_modules"] == ["prachar", "sanvaad", "varta"]
    assert out["ttl_choices"] == [0, 2, 24, 168]
    for never in ("vetana", "manav", "pahchan"):
        assert never not in out["modules"]


def _async(value):
    async def _c():
        return value
    return _c()


def test_the_role_itself_still_reaches_nothing():
    """Reach comes from the SESSION, never from the role. If this ever passes
    with a non-empty set, the widening has been done in the wrong place."""
    from middleware.role_tiers import modules_for
    assert modules_for("platform_support") == frozenset()
