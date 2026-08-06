"""The /approvals surface answers for the ACTIVE org, not every org at once.

`GET /approvals/pending`, `/approvals/history` and `/approvals/stats` carried
only `Depends(get_db)` and `Depends(require_user)`, and every predicate in them
is a user-only EXISTS:

    EXISTS (SELECT 1 FROM project_assignments pa
             WHERE pa.team_id=t.team_id AND pa.user_id=$1 AND pa.role IN ('owner','admin'))
    OR EXISTS (SELECT 1 FROM team_members tm …)

There is no org bind parameter anywhere in the three. An owner who is project
owner/admin in three organisations saw all three orgs' pending approvals, their
history and today's counts on one screen, whatever the switcher said. It is not
arbitrary-tenant enumeration — a real project role is required — but it is
exactly the user shape this package exists for.

`POST /approvals/{id}/review` is worse in kind, because it WRITES: both of its
escape hatches called the unscoped `is_org_admin(user["user_id"])`
(`server.py:2179` and `:2198`), which is True for an `org_owner`/`org_admin` row
in ANY organisation. An org_admin of one small org could approve or reject
another tenant's task approvals — and approving one marks the task done and
mails the requester.

These tests drive the handlers directly and assert on the SQL, because the
defect is the absence of a bind parameter rather than a wrong answer from a
present one: a fix that only reshapes Python and leaves the statement
unconstrained has not fixed anything.
"""
import pytest

import server

ORG_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"   # Aekam Inc — the other tenant
ORG_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"   # E2E Test  — the active org

CALLER = "user_multi"          # project owner/admin in BOTH


class Pool:
    """Records every statement and its bind parameters."""

    def __init__(self, rows=None, row=None):
        self.rows = rows or []
        self.row = row
        self.queries = []
        self.executed = []

    async def fetch(self, sql, *args):
        self.queries.append((" ".join(sql.split()), args))
        return list(self.rows)

    async def fetchrow(self, sql, *args):
        flat = " ".join(sql.split())
        self.queries.append((flat, args))
        if "COUNT(*)" in flat:
            return {"approved_today": 0, "rejected_today": 0}
        if "FROM approvals" in flat:
            return self.row
        if "FROM tasks" in flat:
            return self.row
        # No project_assignments / team_members row anywhere: the escape hatch
        # is the only thing that can let this caller through.
        return None

    async def execute(self, sql, *args):
        self.executed.append((" ".join(sql.split()), args))
        return "UPDATE 1"

    def bound(self):
        """Every value bound to any statement this call issued."""
        return {str(a) for _, args in self.queries for a in args}

    def team_predicates(self):
        return [q for q, _ in self.queries
                if "project_assignments" in q or "team_members" in q or "FROM tasks" in q]


@pytest.fixture
def admin_of_b(monkeypatch):
    async def _is_org_admin(uid, org_id=None):
        if org_id is None:
            return uid == CALLER            # admin SOMEWHERE
        return uid == CALLER and str(org_id) == ORG_B
    monkeypatch.setattr(server, "is_org_admin", _is_org_admin)


# ── the three reads ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("handler", [
    "list_pending_approvals",
    "approval_history",
    "approval_stats",
])
async def test_the_approvals_reads_bind_the_active_org(handler):
    """The org has to reach the STATEMENT, not just the signature.

    Asserting on the bind parameters rather than on the returned rows is
    deliberate: the pool here answers whatever it is given, so the only honest
    evidence that the query is scoped is that the org is in it.
    """
    pool = Pool(rows=[])
    fn = getattr(server, handler)
    await fn(pool=pool, user={"user_id": CALLER}, org=ORG_B)

    predicates = pool.team_predicates()
    assert predicates, f"{handler} issued no visibility query at all"
    for q, args in pool.queries:
        if q in predicates:
            assert ORG_B in {str(a) for a in args}, (
                f"{handler} asked its visibility question with no org bound:\n{q}"
            )
            assert "teams" in q, (
                f"{handler} binds the org but never joins `teams`, so the "
                f"predicate cannot be about a tenant:\n{q}"
            )


async def test_no_active_org_leaves_the_reads_answering(admin_of_b):
    """A portal client or an org-less account resolves no org.

    `active_org_id` returns None for them and the page must not become a 403 or
    a 500 — it degrades to exactly the answer it gave before.
    """
    pool = Pool(rows=[])
    out = await server.list_pending_approvals(
        pool=pool, user={"user_id": CALLER}, org=None)
    assert out == []
    assert ORG_B not in pool.bound()


# ── the write ────────────────────────────────────────────────────────────────

APPROVAL_ROW = {
    "approval_id": "apr_aekam_1",
    "team_id": "team_aekam_1",
    "request_type": "create",
    "request_data": "{}",
    "requested_by": "user_a_staff",
    "status": "pending",
}


async def test_org_admin_cannot_review_another_orgs_approval(admin_of_b, monkeypatch):
    """`server.py:2198` — the unscoped `is_org_admin` on a WRITE path.

    The caller holds no `project_assignments` row and no `team_members` row on
    that team. The only thing they have is an org_admin row in a different
    organisation, and the switcher is on that different organisation.
    """
    async def _in_org(pool, org, *, team_id=None, owner_ids=()):
        return False          # team_aekam_1 is not in ORG_B

    monkeypatch.setattr(server, "task_is_in_org", _in_org)
    pool = Pool(row=APPROVAL_ROW)

    with pytest.raises(server.HTTPException) as exc:
        await server._review_approval_inner(
            "apr_aekam_1", {"status": "approved"}, pool, {"user_id": CALLER},
            org=ORG_B)
    assert exc.value.status_code == 403
    assert not pool.executed, (
        f"another tenant's approval was decided: {pool.executed}"
    )


async def test_org_admin_cannot_review_another_orgs_task_approval(admin_of_b, monkeypatch):
    """`server.py:2179` — the same hatch on the `task_approval--` branch."""
    async def _in_org(pool, org, *, team_id=None, owner_ids=()):
        return False

    monkeypatch.setattr(server, "task_is_in_org", _in_org)
    pool = Pool(row={"task_id": "task_aekam_secret", "team_id": "team_aekam_1",
                     "user_id": "user_a_staff",
                     "created_by_user_id": "user_a_staff", "title": "x"})

    with pytest.raises(server.HTTPException) as exc:
        await server._review_approval_inner(
            "task_approval--task_aekam_secret", {"status": "rejected", "notes": "no"},
            pool, {"user_id": CALLER}, org=ORG_B)
    assert exc.value.status_code == 403
    assert not pool.executed


async def test_org_admin_still_reviews_inside_their_own_org(admin_of_b, monkeypatch):
    """The hatch has to keep working where it is legitimate.

    An org_admin reviewing their OWN org's approval holds no project row either
    — that is the whole reason the hatch exists.
    """
    async def _in_org(pool, org, *, team_id=None, owner_ids=()):
        return True

    monkeypatch.setattr(server, "task_is_in_org", _in_org)
    pool = Pool(row={**APPROVAL_ROW, "team_id": "team_e2e_1",
                     "request_type": "create", "request_data": "{}"})

    out = await server._review_approval_inner(
        "apr_1", {"status": "rejected", "notes": "not now"}, pool,
        {"user_id": CALLER}, org=ORG_B)
    assert out["status"] == "rejected"
    assert any("UPDATE approvals" in q for q, _ in pool.executed)
