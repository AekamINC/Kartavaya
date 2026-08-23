"""Marking a task done tells the admins and the assignees, not the whole project.

A task titled "Bluvian Group - onboarding" sat in a project called "Keval To
Do". One person completed it. Five people were emailed: two Playwright test
accounts, the owner of the list, and two others. None of them were assigned to
it and none had touched it.

The fan-out was written literally, under a comment reading "notify ALL project
members":

    SELECT ... FROM team_members
    WHERE team_id=$1 AND status='active' AND user_id != $2

Membership of a project was treated as a subscription to every completion in
it. Two things were wrong, and this file holds both.

  1. The done mail went to every member. It now goes to the project's admins
     (role IN ('owner','admin')) and to the task's assignees.

  2. A move to done ALSO fired the generic status-changed mail, whose targets
     are the assignees plus the creator. An assignee therefore received two
     emails for one click. That path is now suppressed for a project task
     moving to done, and the done block speaks for the event alone.

Personal tasks carry no team_id and never reach the done block, so they keep
the status-changed path. That path is now narrowed too, and it is the third
thing this file holds:

  3. A task with no project is somebody's OWN list — that is what the New Task
     dropdown means by "Personal" and what `team_id IS NULL` means in the
     schema. It has no admins and no audience, so the only person entitled to
     hear about it is the person whose list it is. The old rule, assignees plus
     creator, is right for a project task and would have mailed a stranger
     about a private list the first time anybody assigned one.

The last three tests pin all of that, because narrowing a fan-out is exactly
the kind of change that takes a quiet path down with it.
"""
import asyncio

import pytest

import email_service
import server

ACTOR     = "user_kasti"          # completed it
OWNER     = "user_keval"          # owns the project, not assigned
ADMIN     = "user_qaadmin"        # admin of the project, not assigned
ASSIGNEE  = "user_kasti_org"      # the person it was assigned to
BYSTANDER = "user_keval_uk"       # plain member, not assigned, not involved

TEAM = "team_ea27e54c6dcb"
TASK = "task_1917d5478122"

ROSTER = [
    {"user_id": OWNER,     "name": "Keval",     "email": "keval@example.com",    "role": "owner"},
    {"user_id": ADMIN,     "name": "QA Admin",  "email": "qaadmin@example.com",  "role": "admin"},
    {"user_id": ASSIGNEE,  "name": "Kasti ORG", "email": "kastiorg@example.com", "role": "member"},
    {"user_id": BYSTANDER, "name": "Keval UK",  "email": "kevaluk@example.com",  "role": "member"},
]


#: `project_assignments` is the authority the approval gate uses, and the two
#: copies of the rule disagree: `team_members` calls ADMIN an admin of this
#: project, `project_assignments` does not. Modelling both is the point — a
#: fan-out reading the wrong table mails a person this one must not.
PROJECT_ADMINS = {OWNER}


class RecordingPool:
    """Captures every query, and answers the ones the handler depends on.

    The roster reply applies the predicate the SQL actually asked for. A query
    that forgets to narrow therefore gets the whole project back, which is what
    production did — the mock cannot flatter a fan-out that never restricted.
    """

    def __init__(self):
        self.queries = []

    async def fetch(self, sql, *args):
        self.queries.append((sql, args))
        if "FROM team_members" in sql:
            # The old, wrong source. Answer it faithfully so a fan-out that goes
            # back to it fails here rather than passing on a friendlier fixture.
            rows = [r for r in ROSTER if r["user_id"] != args[1]]
            if "role IN" in sql:
                assigned = set(args[2]) if len(args) > 2 else set()
                rows = [r for r in rows
                        if r["role"] in ("owner", "admin") or r["user_id"] in assigned]
            return rows
        if "project_assignments" in sql:
            assigned = set(args[2]) if len(args) > 2 else set()
            return [r for r in ROSTER
                    if r["user_id"] != args[1]
                    and (r["user_id"] in assigned or r["user_id"] in PROJECT_ADMINS)]
        if "FROM users" in sql:
            wanted = set(args[0] if args else [])
            return [r for r in ROSTER if r["user_id"] in wanted]
        return []

    async def fetchrow(self, sql, *args):
        self.queries.append((sql, args))
        if "FROM teams" in sql:
            return {"name": "Keval To Do"}
        return None

    async def execute(self, sql, *args):
        self.queries.append((sql, args))
        return "INSERT 0 1"


async def _no_notification(*args, **kwargs):
    return None


@pytest.fixture
def outbox(monkeypatch):
    """Every address the handler mails, tagged by which template sent it."""
    box = {"done": [], "status": []}
    monkeypatch.setattr(email_service, "send_task_done_email",
                        lambda to, *a, **k: box["done"].append(to))
    monkeypatch.setattr(email_service, "send_status_changed_email",
                        lambda to, *a, **k: box["status"].append(to))
    monkeypatch.setattr(server, "create_notification", _no_notification)
    return box


def _mark_done(pool, *, team_id):
    row = {"title": "Bluvian Group - onboarding", "assignee_user_ids": [ASSIGNEE]}
    existing = {"created_by_user_id": ADMIN, "team_id": team_id}
    actor = {"user_id": ACTOR, "full_name": "Kasti Pranami"}
    asyncio.run(server._notify_status_changed(
        pool, row, existing, "in_progress", "done", actor, TASK))


def test_done_reaches_admins_and_assignees(outbox):
    _mark_done(RecordingPool(), team_id=TEAM)
    got = set(outbox["done"])
    assert "keval@example.com" in got, "the project owner is an admin and is told"
    assert "kastiorg@example.com" in got, "the assignee is told"


def test_an_uninvolved_project_member_is_not_emailed(outbox):
    """The regression that started this: membership was treated as subscription."""
    _mark_done(RecordingPool(), team_id=TEAM)
    assert "kevaluk@example.com" not in outbox["done"], (
        "a plain project member who was not assigned and is not an admin was "
        "emailed: %r" % (outbox["done"],))


def test_admin_is_read_from_the_same_table_as_the_approval_gate(outbox):
    """`team_members` calls ADMIN an admin of this project. It is not the authority.

    The approval gate resolves owner/admin from `project_assignments`
    (server.py:2409). Two fan-outs answering "who runs this project"
    differently is how one list gains a person the other never had — which is
    literally the case here: this account is an admin in `team_members` and
    absent from `project_assignments`.
    """
    _mark_done(RecordingPool(), team_id=TEAM)
    assert "qaadmin@example.com" not in outbox["done"], (
        "the done fan-out resolved admins from team_members, which disagrees "
        "with the approval gate: %r" % (outbox["done"],))


def test_done_does_not_also_send_the_status_changed_mail(outbox):
    """One click, one email. The assignee used to get two."""
    _mark_done(RecordingPool(), team_id=TEAM)
    assert outbox["status"] == [], (
        "moving a project task to done fired the generic status-changed mail as "
        "well, double-mailing the assignee: %r" % (outbox["status"],))


def test_a_personal_task_keeps_the_status_changed_path(outbox):
    """No project means no done block; the quiet path must not be collateral."""
    _mark_done(RecordingPool(), team_id=None)
    assert outbox["done"] == [], "a task with no project has no project members"
    assert outbox["status"], (
        "the owner still hears about a task with no project")


def test_a_personal_task_reaches_its_OWNER_and_nobody_else(outbox):
    """The other half of the routing fix.

    A task with no project is somebody's own list — that is what the New Task
    dropdown means by "Personal" and what `team_id IS NULL` means in the schema.
    It has no admins and no audience, so the only person entitled to hear about
    it is the person whose list it is.

    The old rule was assignees + creator, which is right for a project task and
    wrong here: it would mail a stranger about a private list the first time
    anybody assigned one. Measured on the live database 2026-08-23, all 24
    personal tasks carry ZERO assignees, so this changes nobody's mail today —
    it changes what happens the first time somebody does.
    """
    _mark_done(RecordingPool(), team_id=None)
    # ADMIN is `created_by_user_id` in `_mark_done` — the owner of the list.
    assert outbox["status"] == ["qaadmin@example.com"], (
        "a personal task mailed somebody other than its owner: %r"
        % (outbox["status"],))
    assert "kastiorg@example.com" not in outbox["status"], (
        "the assignee of a PERSONAL task was mailed — a personal task has no "
        "audience to assign to")


def test_a_personal_task_does_not_email_the_person_who_ticked_it_off(outbox):
    """The common case, and the whole point of the exclusion: you do not get an
    email because you completed your own task."""
    row = {"title": "Ring the accountant", "assignee_user_ids": []}
    existing = {"created_by_user_id": ACTOR, "team_id": None}
    actor = {"user_id": ACTOR, "full_name": "Kasti Pranami"}
    asyncio.run(server._notify_status_changed(
        RecordingPool(), row, existing, "in_progress", "done", actor, TASK))

    assert outbox["status"] == []
    assert outbox["done"] == []


def test_the_roster_is_narrowed_in_sql_not_in_python(outbox):
    """The predicate belongs in the query, so the rest never leaves the database."""
    pool = RecordingPool()
    _mark_done(pool, team_id=TEAM)

    roster = [(q, a) for q, a in pool.queries if "project_assignments" in q]
    assert roster, (
        "the done fan-out did not resolve admins from project_assignments, the "
        "table the approval gate uses")
    sql, args = roster[0]
    assert "role IN" in sql, (
        "the roster query does not restrict by role, so it selects every member "
        "of the project: %s" % sql)
    assert len(args) == 3 and list(args[2]) == [ASSIGNEE], (
        "the assignee list must be bound as a parameter, not interpolated: %r"
        % (args,))
    assert not [q for q, _ in pool.queries if "FROM team_members" in q], (
        "the done fan-out still reads team_members, the copy of the rule that "
        "disagrees with the approval gate")
