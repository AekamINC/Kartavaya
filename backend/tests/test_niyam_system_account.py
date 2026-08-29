"""The Niyam system account: unloginable, unlisted, unbilled — and an author.

Migration 148 gave every organisation one `public.users` row
(`niyam_<32-hex org id>`, `is_system=TRUE`) so the engine's `task.add_comment`
verb has a real author — the comment read path INNER JOINs `users`, so a
comment from a non-existent author is invisible to everyone.

A users row is not inert in this product. These tests pin the four properties
that make this one safe to exist:

  1. LOGIN refuses it through the DECOY branch — even with somehow-valid
     credentials — with no timing oracle and no reset-token path around it.
  2. Every list that reads public.users WITHOUT going through user_roles
     filters on `is_system` (the org-scoped lists already miss it by
     construction: it holds no user_roles row and no team_members row).
  3. No add-member flow can grant it a user_roles row — which would surface it
     everywhere and charge the org a seat.
  4. The comment verb works: computed actor id, healing seed, honest outcomes.
"""
from __future__ import annotations

import inspect

import pytest

from helpers import TEST_PASSWORD

ORG = "11111111-2222-3333-4444-555555555555"
ACTOR = "niyam_" + ORG.replace("-", "")


def _code(fn) -> str:
    return "\n".join(
        line for line in inspect.getsource(fn).splitlines()
        if not line.strip().startswith("#")
    )


# ── 1 · login ────────────────────────────────────────────────────────────────

async def test_login_refuses_a_system_row_even_with_valid_credentials(
        api_client, mock_pool, admin_user):
    """The strongest form of the refusal: give the system row credentials that
    WOULD verify (a hijacked row), and the password being right must not
    matter — `is_system` sends it down the decoy branch unconditionally."""
    # A plausible address, not the real niyam+...@...invalid one: EmailStr
    # 422s the .invalid special-use domain before the route even runs (a
    # bonus moat), and this test is about the column, not the address.
    system_row = dict(admin_user, is_system=True)
    mock_pool.fetchrow.return_value = system_row
    resp = await api_client.post("/api/auth/login", json={
        "email": system_row["email"],
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 401


async def test_system_row_takes_the_decoy_branch_not_an_early_raise(
        api_client, mock_pool, admin_user, monkeypatch):
    """Refusal must cost the same PBKDF2 work as any other miss. An early
    raise would be a timing oracle naming exactly which addresses are system
    rows — the class of bug 208e125b removed."""
    import auth_router

    calls = []
    real = auth_router._verify_password

    def spy(password, salt, stored):
        calls.append((salt, stored))
        return real(password, salt, stored)

    monkeypatch.setattr(auth_router, "_verify_password", spy)
    system_row = dict(admin_user, is_system=True,
                      salt="!none",
                      password_hash="!system-account-cannot-log-in")
    mock_pool.fetchrow.return_value = system_row
    resp = await api_client.post("/api/auth/login", json={
        "email": system_row["email"],
        "password": TEST_PASSWORD,
    })
    assert resp.status_code == 401
    assert calls == [(auth_router._DECOY_SALT, auth_router._DECOY_HASH)], \
        "the system row did not burn the decoy hash — either it verified " \
        "against its own sentinels or it raised before hashing"


def test_no_reset_path_around_the_login_refusal():
    """Both password-reset queries must filter is_system in the WHERE, so a
    system email answers like an unknown one (200, nothing written) and a
    system row with a planted token reads as an invalid link."""
    import auth_router
    for fn in (auth_router.forgot_password, auth_router.reset_password):
        assert "NOT COALESCE(is_system, FALSE)" in _code(fn), \
            f"{fn.__name__} can reach a system row"


# ── 2 · the lists that would show it ─────────────────────────────────────────

def test_platform_directory_excludes_system_rows():
    """GET /api/users, platform-staff branch: the ONE list in the product that
    LEFT JOINs over all of public.users instead of resolving through
    user_roles. Without the filter, every platform role sees 'Niyam' rows."""
    import server
    assert "NOT COALESCE(u.is_system, FALSE)" in _code(server.list_users)


def test_email_searches_answer_like_a_nonexistent_account():
    """Both by-email search endpoints fetch from public.users directly; the
    filter makes a system address 404 exactly like a made-up one."""
    import routers.org_members as om
    import routers.admin_orgs as ao
    assert "NOT COALESCE(is_system, FALSE)" in _code(om.search_user)
    assert "NOT COALESCE(is_system, FALSE)" in _code(ao.search_user_by_email)


def test_startup_platform_admin_grant_skips_system_rows():
    """Belt-and-braces: the accounts are seeded role='member', but the startup
    sweep that promotes role='admin' rows to platform_admin must never be one
    UPDATE away from promoting a robot."""
    import server
    src = inspect.getsource(server._run_startup_migrations)
    assert "AND NOT COALESCE(is_system, FALSE)" in src


# ── 3 · no flow can give it a seat ───────────────────────────────────────────

def test_org_add_member_refuses_a_system_target():
    """A user_roles row is the one write that would surface the account in
    every member list AND charge a seat. Refused outright, and BEFORE the
    invite fallback — filtering the row out instead would mail an invitation
    to an unroutable .invalid address and report 'invited'.

    Source-inspected like the rest of this route's tests (the mock pool does
    not wire org resolution): the refusal must read is_system, raise, and sit
    above both the `if not target:` fallback and the user_roles INSERT."""
    import routers.org_members as om
    code = _code(om.add_member)
    assert 'target.get("is_system")' in code
    # Split on the READ, not on the whole `if` line. This test's sibling below
    # pinned `if target.get("is_system"):` exactly and died on an IndexError the
    # day somebody made the condition null-safe — `if target and
    # target.get(...)` — while the guard itself was correct and in place. A
    # source test that breaks when the code it approves of is IMPROVED teaches
    # people to delete source tests.
    refusal = code.split('target.get("is_system")')[1]
    assert "HTTPException" in refusal.split("if not target:")[0],         "the refusal does not precede the invite fallback"
    assert "system account" in refusal.split("if not target:")[0]


def test_admin_console_add_member_refuses_a_system_target():
    """Same rule for god mode: the platform console's add_member must carry an
    explicit is_system refusal before any user_roles write."""
    import routers.admin_orgs as ao
    code = _code(ao.add_member)
    assert 'target.get("is_system")' in code
    # The same semantic anchor as above, and for the same reason: this line read
    # `if target.get("is_system"):` and `af74d321` made the condition null-safe,
    # so the split found nothing and the test failed with `IndexError: list
    # index out of range` — a message that says nothing about system accounts.
    # The guard was intact the whole time: `admin_orgs.py:1984` reads
    # `if target and target.get("is_system"): raise HTTPException(400, ...)`,
    # above every write. What is asserted below — refusal before the INSERT — is
    # the rule, and it does not depend on how the condition is spelled.
    refusal = code.split('target.get("is_system")')[1]
    write = refusal.find("INSERT INTO public.user_roles")
    raised = refusal.find("HTTPException")
    assert raised != -1 and (write == -1 or raised < write), \
        "the refusal does not precede the user_roles write"


def test_every_org_creation_path_seeds_the_account():
    """Two writers create organisations (the admin console and the dev seed);
    both must write the Niyam row in the same shape as migration 148, or a new
    org's comment verb fails until the healing path fires."""
    import routers.admin_orgs as ao
    import pathlib
    create = _code(ao.create_org)
    assert "'niyam_' || replace($1::text, '-', '')" in create
    assert "is_system" in create
    seed = pathlib.Path(__file__).parent.parent / "scripts" / "setup_local_db.py"
    assert "'niyam_' || replace($1::text, '-', '')" in seed.read_text(encoding="utf-8")


# ── 4 · the comment verb ─────────────────────────────────────────────────────

class _Conn:
    """public.users + public.tasks + public.task_comments, just enough."""

    def __init__(self, tasks=(), users=()):
        self.tasks = set(tasks)
        self.users = set(users)
        self.comments: list = []
        self.executed: list = []

    async def fetchrow(self, sql, *a):
        if "FROM public.tasks" in sql:
            return {"task_id": a[0]} if a[0] in self.tasks else None
        raise AssertionError(f"unexpected fetchrow: {sql}")

    async def fetchval(self, sql, *a):
        if "FROM public.users" in sql:
            return 1 if a[0] in self.users else None
        raise AssertionError(f"unexpected fetchval: {sql}")

    async def execute(self, sql, *a):
        self.executed.append((sql, a))
        if "INSERT INTO public.task_comments" in sql:
            self.comments.append(a)
        if "INSERT INTO public.users" in sql:
            self.users.add(a[0])


def _event(**over):
    e = {"entity_id": "task_1", "org_id": ORG, "payload": {"after": {}}}
    e.update(over)
    return e


async def test_the_comment_lands_with_the_computed_actor():
    from services.niyam.actions import ACTIONS
    conn = _Conn(tasks={"task_1"}, users={ACTOR})
    r = await ACTIONS["task.add_comment"].run(
        conn, config={"body": "the rule fired"}, event=_event())
    assert r.outcome == "ok"
    assert len(conn.comments) == 1
    _cid, task_id, actor, body, _org = conn.comments[0]
    assert (task_id, actor, body) == ("task_1", ACTOR, "the rule fired")


async def test_a_missing_actor_row_is_seeded_not_fatal():
    """The balance_of pattern: an org outside the backfill gets its account
    the first time a rule speaks, instead of failing for ever."""
    from services.niyam.actions import ACTIONS
    conn = _Conn(tasks={"task_1"}, users=set())
    r = await ACTIONS["task.add_comment"].run(
        conn, config={"body": "healed"}, event=_event())
    assert r.outcome == "ok"
    seeds = [(s, a) for s, a in conn.executed if "INSERT INTO public.users" in s]
    assert len(seeds) == 1
    assert seeds[0][1][0] == ACTOR
    assert "is_system" in seeds[0][0]
    assert ".invalid" in seeds[0][0], "the healed row must be unroutable too"


async def test_honest_outcomes_for_the_three_ways_it_cannot_run():
    from services.niyam.actions import ACTIONS
    verb = ACTIONS["task.add_comment"]
    conn = _Conn(tasks=set(), users={ACTOR})
    assert (await verb.run(conn, config={"body": ""},
                           event=_event())).outcome == "failed"
    assert (await verb.run(conn, config={"body": "x"},
                           event=_event(entity_id=None))).outcome == "failed"
    assert (await verb.run(conn, config={"body": "x"},
                           event=_event(org_id=None))).outcome == "failed"
    # And a task deleted between event and run is a refusal, not a fault.
    assert (await verb.run(conn, config={"body": "x"},
                           event=_event())).outcome == "refused"
    assert conn.comments == []


def test_the_robot_does_not_impersonate_a_person():
    """No notification fan-out, no push, no mention rows: a rule that should
    tell somebody pairs the comment with notify.send, which runs recipients
    through prefs_verdict — the comment verb must not bypass quiet hours."""
    from services.niyam.actions import TaskAddComment
    code = _code(TaskAddComment.run)
    for forbidden in ("create_notification", "fan_out_push", "process_mentions"):
        assert forbidden not in code


def test_validation_refuses_the_unfinished_and_the_oversized():
    from services.niyam.validate import validate_steps, RuleInvalid
    from services.niyam.subjects import TASK_STATUS_CHANGED

    step = lambda body: [{"kind": "action",
                          "config": {"verb": "task.add_comment", "body": body}}]
    out = validate_steps(TASK_STATUS_CHANGED, step("looks fine"))
    assert out[0]["config"]["verb"] == "task.add_comment"
    with pytest.raises(RuleInvalid):
        validate_steps(TASK_STATUS_CHANGED, step("   "))
    with pytest.raises(RuleInvalid):
        # The same 4,000-character ceiling the human route enforces
        # (CommentCreate.body): a rule must not write what a person could not.
        validate_steps(TASK_STATUS_CHANGED, step("x" * 4001))
