"""Tests for services/custody/offboarding.py.

The pool here is a MagicMock (tests/conftest.py), which means A MOCK POOL HIDES
BAD SQL: nothing below proves a query parses. That was proven separately, by
PREPAREing every statement in the module against the live Supabase catalog on
2026-08-19 — read-only, nothing executed. Six of the seven statements against
existing tables prepared clean; the seventh (`_LEAVER_SQL`) failed only on the
three columns migration 164 adds, and prepared clean with those removed.

So these tests assert the things a mock CAN prove, and they are chosen to be the
things that would silently give a wrong answer in production:

  · An employee from another org is never returned, and no query is even reached
    with their id.
  · An employee with nothing outstanding returns EMPTY LISTS, not an error.
  · An unresolved login is never reported as clear.
  · A ledger entry suppresses the line it settles, and nothing else.
"""
import pytest

from services.custody import offboarding as oc


# ── helpers ───────────────────────────────────────────────────────────────────

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"
EMP = "33333333-3333-3333-3333-333333333333"
OFFB = "44444444-4444-4444-4444-444444444444"


def leaver_row(**over):
    """A `_LEAVER_SQL` row. Defaults to the live shape: user_id NULL, because
    manav_employees.user_id is unwritten on all 98 rows in the database."""
    row = {
        "employee_ref": EMP,
        "employee_name": "Priya Nair",
        "employee_code": "EMP-0042",
        "designation": "Audit Manager",
        "department": "Assurance",
        "email": "priya.nair@example.in",
        "linked_user_id": None,
        "employment_status": "terminated",
        "is_active": False,
        "offboarding_ref": OFFB,
        "offboarding_status": "in_clearance",
        "exit_type": "resignation",
        "last_working_day": None,
        "handover_completed_at": None,
        "access_revoked_at": None,
        "custody_scanned_at": None,
    }
    row.update(over)
    return row


def wire(pool, *, leaver, tasks=(), clients=(), follow_ups=(), access=(), ledger=(),
         user_by_email=None, reachable=False):
    """Route the mock pool's three verbs by the SQL each call carries.

    Keyed on a distinctive fragment of each statement rather than on call order:
    `open_custody` issues its queries in an order that is an implementation
    detail, and a side_effect list would turn any reordering into a test failure
    that reads like a product bug.
    """
    async def _fetchrow(sql, *args):
        if "FROM staging.manav_employees e" in sql:
            return leaver
        if "FROM public.users u" in sql:
            return user_by_email
        raise AssertionError(f"unexpected fetchrow: {sql[:80]}")

    async def _fetch(sql, *args):
        if "FROM public.tasks t" in sql:
            return list(tasks)
        if "FROM staging.graha_deals d" in sql:
            return list(clients)
        if "FROM staging.graha_follow_ups f" in sql:
            return list(follow_ups)
        if "FROM staging.user_roles r" in sql:
            return list(access)
        if "FROM staging.manav_offboarding_custody" in sql:
            return list(ledger)
        raise AssertionError(f"unexpected fetch: {sql[:80]}")

    async def _fetchval(sql, *args):
        if "SELECT EXISTS" in sql:
            return reachable
        raise AssertionError(f"unexpected fetchval: {sql[:80]}")

    pool.fetchrow.side_effect = _fetchrow
    pool.fetch.side_effect = _fetch
    pool.fetchval.side_effect = _fetchval
    return pool


@pytest.fixture
def pool():
    from conftest import make_pool
    return make_pool()


# ── tenancy ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_leaver_from_another_org_is_never_returned(pool):
    """The whole tenancy guard for this module.

    `_LEAVER_SQL` filters on org_id AND id, so a foreign employee id yields no
    row and `resolve_leaver` returns None. Everything else in the module takes
    its login id from that call, so nothing downstream can be reached with a
    foreign employee — which is why this is asserted at both levels.
    """
    wire(pool, leaver=None)

    assert await oc.resolve_leaver(pool, OTHER_ORG, EMP) is None
    assert await oc.open_custody(pool, OTHER_ORG, EMP) is None


@pytest.mark.asyncio
async def test_leaver_query_is_bound_with_the_callers_org(pool):
    """A missing org bind would return the employee to every tenant that asked.

    Asserted on the parameters rather than the result, because a query that
    ignored $1 would still return this test's mocked row and look correct.
    """
    wire(pool, leaver=leaver_row())
    await oc.resolve_leaver(pool, ORG, EMP)

    # call_args_list[0], not call_args: the default leaver row has no linked
    # user_id, so the email fallback fires and `call_args` is that second query.
    sql, *args = pool.fetchrow.call_args_list[0][0]
    assert "e.org_id = $1::uuid" in sql
    assert args == [ORG, EMP]


@pytest.mark.asyncio
async def test_email_match_is_refused_when_the_user_is_not_in_this_org(pool):
    """public.users.email is globally unique, so a match is unambiguous — and
    still cross-tenant. A namesake in another firm must not hand us their tasks."""
    wire(
        pool,
        leaver=leaver_row(),
        user_by_email={"user_id": "user_someone_else", "name": "Priya Nair"},
        reachable=False,
    )

    out = await oc.resolve_leaver(pool, ORG, EMP)
    assert out["login_link"] == "unresolved"
    assert out["login_user_ref"] is None


@pytest.mark.asyncio
async def test_email_match_is_accepted_when_the_user_is_reachable_in_this_org(pool):
    wire(
        pool,
        leaver=leaver_row(),
        user_by_email={"user_id": "user_priya", "name": "Priya Nair"},
        reachable=True,
    )

    out = await oc.resolve_leaver(pool, ORG, EMP)
    assert out["login_link"] == "matched_by_email"
    assert out["login_user_ref"] == "user_priya"
    assert out["login_name"] == "Priya Nair"


@pytest.mark.asyncio
async def test_a_linked_user_id_skips_the_email_lookup_entirely(pool):
    wire(pool, leaver=leaver_row(linked_user_id="user_priya"))

    out = await oc.resolve_leaver(pool, ORG, EMP)
    assert out["login_link"] == "linked"
    assert out["login_user_ref"] == "user_priya"
    # The email fallback must not run: it costs two round trips and, on a
    # database where a stale duplicate address exists, could resolve elsewhere.
    assert pool.fetchrow.call_count == 1
    assert pool.fetchval.call_count == 0


# ── nothing outstanding ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_employee_with_nothing_outstanding_returns_empty_lists_not_an_error(pool):
    """The answer this register must be able to give.

    A caller that has to catch an exception to learn "nothing to do" will stop
    calling, and the register then only ever gets consulted when somebody already
    suspects a problem.
    """
    wire(pool, leaver=leaver_row(linked_user_id="user_priya"))

    out = await oc.open_custody(pool, ORG, EMP)

    assert out is not None
    assert out["tasks"] == []
    assert out["clients"] == []
    assert out["follow_ups"] == []
    assert out["access"] == []
    assert out["ledger_outstanding"] == []
    assert out["counts"] == {
        "tasks": 0, "clients": 0, "follow_ups": 0, "access": 0,
        "ledger_outstanding": 0,
    }
    assert out["clear"] is True
    assert out["unknown"] is False


@pytest.mark.asyncio
async def test_an_unresolved_login_is_empty_but_is_never_reported_as_clear(pool):
    """The one wrong answer this module could give.

    Every one of the 98 live employee rows lands here today: user_id is NULL and
    no employee email matches a user. Four empty lists then mean "nobody could be
    looked up", not "the desk is empty", and reporting that as clear would sign
    off an exit that was never checked.
    """
    wire(pool, leaver=leaver_row(), user_by_email=None)

    out = await oc.open_custody(pool, ORG, EMP)

    assert out["counts"]["tasks"] == 0
    assert out["clear"] is False
    assert out["unknown"] is True
    assert out["leaver"]["login_link"] == "unresolved"


@pytest.mark.asyncio
async def test_no_work_query_runs_without_a_resolved_login(pool):
    """An empty user id must not reach the SQL.

    `$1::text = ANY(assignee_user_ids)` with an empty string is a legal query
    that matches nothing, so a missing login would look like a clean desk rather
    than a bug. Guarded in Python, and asserted here.
    """
    assert await oc.outstanding_tasks(pool, ORG, "") == []
    assert await oc.outstanding_clients(pool, ORG, None) == []
    assert await oc.outstanding_follow_ups(pool, ORG, "") == []
    assert await oc.live_access(pool, ORG, None) == []
    assert pool.fetch.call_count == 0


# ── outstanding work ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_open_custody_reports_work_access_and_names_never_ids(pool):
    wire(
        pool,
        leaver=leaver_row(linked_user_id="user_priya"),
        tasks=[{"task_ref": "task_1", "title": "File GSTR-3B for Agarwal Steel",
                "status": "todo", "priority": "high", "due_at": None,
                "team_name": "Indirect Tax"}],
        clients=[{"client_ref": "c-1", "client_name": "Agarwal Steel Works",
                  "open_deals": 4, "named_contacts": 0}],
        follow_ups=[{"follow_up_ref": "f-1", "title": "Chase signed engagement letter",
                     "due_at": None, "client_name": "Agarwal Steel Works",
                     "contact_name": "R. Agarwal"}],
        access=[{"access_kind": "module_grant", "label": "ganit",
                 "access_ref": "ganit", "granted_at": None}],
    )

    out = await oc.open_custody(pool, ORG, EMP)

    assert out["counts"] == {
        "tasks": 1, "clients": 1, "follow_ups": 1, "access": 1,
        "ledger_outstanding": 0,
    }
    assert out["clear"] is False
    # NAMES, NOT IDS: every list carries a human label to display.
    assert out["tasks"][0]["title"]
    assert out["clients"][0]["client_name"] == "Agarwal Steel Works"
    assert out["follow_ups"][0]["client_name"] == "Agarwal Steel Works"
    assert out["access"][0]["label"] == "ganit"
    assert out["leaver"]["employee_name"] == "Priya Nair"


@pytest.mark.asyncio
async def test_task_query_excludes_archived_and_closed_work(pool):
    """246 of 735 live task rows are archived and 379 are done. Including either
    buries the handful a successor actually has to pick up."""
    wire(pool, leaver=leaver_row(linked_user_id="user_priya"))
    await oc.outstanding_tasks(pool, ORG, "user_priya")

    sql = pool.fetch.call_args[0][0]
    assert "t.archived_at IS NULL" in sql
    # BOUND, not interpolated: a one-element tuple rendered into SQL text would
    # emit ('done',) and PgBouncer returns that trailing comma as a bare 500.
    assert "t.status <> ALL($3::text[])" in sql
    assert pool.fetch.call_args[0][3] == ["done", "cancelled"]
    # public.tasks has no org_id; the only path to a tenant is teams.org_id.
    assert "JOIN public.teams tm ON tm.team_id = t.team_id" in sql
    assert "tm.org_id = $1::uuid" in sql


@pytest.mark.asyncio
async def test_task_query_reads_both_assignment_columns(pool):
    """Assignment lives in assignee_user_ids (645 live rows) AND user_id (337).
    Reading one and not the other silently loses a leaver's open work."""
    wire(pool, leaver=leaver_row(linked_user_id="user_priya"))
    await oc.outstanding_tasks(pool, ORG, "user_priya")

    sql = pool.fetch.call_args[0][0]
    assert "$2::text = ANY(t.assignee_user_ids)" in sql
    assert "t.user_id = $2::text" in sql


@pytest.mark.asyncio
async def test_limit_is_capped(pool):
    wire(pool, leaver=leaver_row(linked_user_id="user_priya"))
    await oc.outstanding_tasks(pool, ORG, "user_priya", limit=10_000)

    assert pool.fetch.call_args[0][4] == oc.MAX_ROWS


# ── the ledger settles lines ──────────────────────────────────────────────────

def test_a_recorded_revocation_suppresses_that_grant_and_only_that_grant():
    access = [
        {"access_kind": "module_grant", "label": "ganit", "access_ref": "ganit"},
        {"access_kind": "module_grant", "label": "graha", "access_ref": "graha"},
        {"access_kind": "role_grant", "label": "org_member", "access_ref": "org_member"},
    ]
    ledger = [{"action": "revoke", "subject_type": "module_grant",
               "subject_ref": "ganit", "status": "done"}]

    kept = oc.unrevoked_access(access, ledger)

    assert [g["label"] for g in kept] == ["graha", "org_member"]


def test_a_revocation_still_outstanding_does_not_suppress_anything():
    """Writing down that a key needs pulling is not pulling it. Treating an
    'outstanding' line as settled would let an exit be signed off on its own
    to-do list."""
    access = [{"access_kind": "module_grant", "label": "ganit", "access_ref": "ganit"}]
    ledger = [{"action": "revoke", "subject_type": "module_grant",
               "subject_ref": "ganit", "status": "outstanding"}]

    assert oc.unrevoked_access(access, ledger) == access


def test_a_waived_line_counts_as_settled():
    """A waiver carries a reason (migration 164 refuses one without). Re-raising
    it every scan trains people to ignore the register."""
    access = [{"access_kind": "team_membership", "label": "Indirect Tax",
               "access_ref": "team_abc"}]
    ledger = [{"action": "revoke", "subject_type": "team_membership",
               "subject_ref": "team_abc", "status": "waived",
               "waived_reason": "team was dissolved"}]

    assert oc.unrevoked_access(access, ledger) == []


def test_a_reassignment_does_not_settle_a_revocation_of_the_same_thing():
    """Handing the work over and taking the key back are different verbs, and a
    firm that has done one has not done the other."""
    access = [{"access_kind": "team_membership", "label": "Indirect Tax",
               "access_ref": "team_abc"}]
    ledger = [{"action": "reassign", "subject_type": "team_membership",
               "subject_ref": "team_abc", "status": "done"}]

    assert oc.unrevoked_access(access, ledger) == access


def test_a_free_text_ledger_line_suppresses_nothing():
    """subject_ref is NULL for a physical item ('the DSC token in the drawer').
    Matching those on the label instead would let a human's retyping silently
    close a queried grant.

    The ledger line below deliberately carries the SAME subject_type AND the same
    label as the live grant. An earlier version of this test used a different
    subject_type, which meant the pair could never collide and the assertion held
    whether the code keyed on subject_ref or on subject_label — it passed for a
    reason unrelated to its own docstring. Verified 2026-08-19 by making _settled
    fall back to the label: this now fails, and did not before."""
    access = [{"access_kind": "module_grant", "label": "ganit", "access_ref": "ganit"}]
    ledger = [{"action": "revoke", "subject_type": "module_grant", "subject_ref": None,
               "subject_label": "ganit", "status": "done"}]

    assert oc.unrevoked_access(access, ledger) == access


def test_reassigned_tasks_drop_out_of_the_outstanding_list():
    tasks = [
        {"task_ref": "task_1", "title": "File GSTR-3B"},
        {"task_ref": "task_2", "title": "Draft audit memo"},
    ]
    ledger = [{"action": "reassign", "subject_type": "task",
               "subject_ref": "task_1", "status": "done"}]

    kept = oc.unreassigned(tasks, ledger, "task", "task_ref")

    assert [t["title"] for t in kept] == ["Draft audit memo"]


@pytest.mark.asyncio
async def test_open_custody_subtracts_the_ledger(pool):
    wire(
        pool,
        leaver=leaver_row(linked_user_id="user_priya"),
        tasks=[{"task_ref": "task_1", "title": "File GSTR-3B", "status": "todo",
                "priority": "high", "due_at": None, "team_name": "Indirect Tax"}],
        access=[{"access_kind": "module_grant", "label": "ganit",
                 "access_ref": "ganit", "granted_at": None}],
        ledger=[
            {"action": "reassign", "subject_type": "task", "subject_ref": "task_1",
             "subject_label": "File GSTR-3B", "status": "done"},
            {"action": "revoke", "subject_type": "module_grant", "subject_ref": "ganit",
             "subject_label": "ganit", "status": "done"},
        ],
    )

    out = await oc.open_custody(pool, ORG, EMP)

    assert out["counts"]["tasks"] == 0
    assert out["counts"]["access"] == 0
    assert out["clear"] is True


@pytest.mark.asyncio
async def test_an_outstanding_ledger_line_keeps_the_exit_unclear(pool):
    """A hand-written line — a laptop, a physical DSC token — has no query behind
    it, so it can only ever be closed by a human. It must still block `clear`."""
    wire(
        pool,
        leaver=leaver_row(linked_user_id="user_priya"),
        ledger=[{"action": "revoke", "subject_type": "dsc_token", "subject_ref": None,
                 "subject_label": "Class 3 DSC token — Agarwal Steel Works",
                 "status": "outstanding"}],
    )

    out = await oc.open_custody(pool, ORG, EMP)

    assert out["counts"]["ledger_outstanding"] == 1
    assert out["clear"] is False
    assert out["ledger_outstanding"][0]["subject_label"].startswith("Class 3 DSC")


@pytest.mark.asyncio
async def test_no_offboarding_record_means_no_ledger_query(pool):
    """An employee can be walked through this before an exit row exists. The
    ledger is keyed on offboarding_id, so with no exit there is nothing to read
    and the query must not run with a NULL bind."""
    wire(pool, leaver=leaver_row(linked_user_id="user_priya", offboarding_ref=None))

    out = await oc.open_custody(pool, ORG, EMP)

    assert out is not None
    assert out["ledger_outstanding"] == []
    for call in pool.fetch.call_args_list:
        assert "manav_offboarding_custody" not in call[0][0]


# ── the write ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_record_custody_refuses_a_row_with_no_label(pool):
    """subject_label is the only field this row is ever displayed by. Without it
    the register would have to render a raw uuid, which nothing in this product
    is allowed to do."""
    with pytest.raises(ValueError, match="subject_label"):
        await oc.record_custody(
            pool, ORG, OFFB, EMP,
            action="revoke", subject_type="dsc_token", subject_label="   ",
        )
    assert pool.fetchrow.call_count == 0


@pytest.mark.asyncio
async def test_record_custody_refuses_an_unknown_verb(pool):
    with pytest.raises(ValueError, match="reassign"):
        await oc.record_custody(
            pool, ORG, OFFB, EMP,
            action="delete", subject_type="task", subject_label="File GSTR-3B",
        )


@pytest.mark.asyncio
async def test_record_custody_upserts_so_a_repeated_scan_cannot_duplicate(pool):
    """Opening the exit screen twice must not write the leaver's desk twice. By
    the fourth visit the outstanding count would otherwise be four times the
    truth, and a register that inflates is a register nobody trusts."""
    pool.fetchrow.side_effect = None
    pool.fetchrow.return_value = {
        "id": "x", "action": "reassign", "subject_type": "task",
        "subject_label": "File GSTR-3B", "status": "done",
    }

    out = await oc.record_custody(
        pool, ORG, OFFB, EMP,
        action="reassign", subject_type="task", subject_ref="task_1",
        subject_label="File GSTR-3B", reassigned_to_user_id="user_iyer",
        reassigned_to_name="Meera Iyer", status="done",
    )

    sql = pool.fetchrow.call_args[0][0]
    assert "ON CONFLICT (org_id, offboarding_id, action, subject_type, subject_ref)" in sql
    assert "DO UPDATE SET" in sql
    # Every bind is cast. An untyped parameter reaching PgBouncer becomes a
    # parse error that surfaces as an instant 500 — a real incident here.
    assert "$1::uuid" in sql and "$15::text" in sql and "$10::timestamptz" in sql
    assert out["status"] == "done"


@pytest.mark.asyncio
async def test_record_custody_refuses_an_unknown_subject_type(pool):
    """A subject_type outside migration 164's CHECK must not reach the database.

    Two failures avoided, and the second is the quiet one. A wholly invalid value
    would arrive back as a CheckViolation that a router renders as a 500. A
    NEAR-MISS — 'module' where the vocabulary says 'module_grant' — would insert
    cleanly, look like a recorded revocation on screen, and never suppress the
    grant it names, because `_settled` keys on the subject_type the queries emit.
    The register would then show a key as taken back while `live_access` keeps
    reporting it as held.
    """
    with pytest.raises(ValueError, match="subject_type"):
        await oc.record_custody(
            pool, ORG, OFFB, EMP,
            action="revoke", subject_type="module", subject_label="ganit",
        )
    assert pool.fetchrow.call_count == 0


@pytest.mark.asyncio
async def test_record_custody_proves_the_exit_belongs_to_this_org(pool):
    """The only write in this module, and the only place org scoping is not
    already carried by a WHERE clause on a read.

    Migration 164 puts no foreign key on this table, so an INSERT ... VALUES
    would file whatever org_id it was handed against whatever offboarding_id it
    was handed. One transposed argument in a future router and one firm's
    register grows a line about another firm's exit — in a table whose whole
    purpose is answering an audit truthfully.

    Asserted on the SQL because a mock cannot execute the guard: the row is
    SELECTed from the exit record, and all three of (org, exit, employee) must
    agree before there is a row to insert.
    """
    pool.fetchrow.side_effect = None
    pool.fetchrow.return_value = None

    out = await oc.record_custody(
        pool, ORG, OFFB, EMP,
        action="revoke", subject_type="module_grant", subject_ref="ganit",
        subject_label="ganit", status="outstanding",
    )

    sql = pool.fetchrow.call_args[0][0]
    assert "FROM staging.manav_offboarding o" in sql
    assert "o.org_id = $1::uuid" in sql
    assert "o.id = $2::uuid" in sql
    assert "o.employee_id = $3::uuid" in sql
    # No row selected means no row written. A caller must read that as a refusal.
    assert out is None


def test_the_ledger_never_returns_a_login_id_under_a_displayable_name():
    """NAMES, NOT IDS, enforced at the only place this module could leak one.

    `reassigned_to_user_id` is a raw login handle. The contract stated at the top
    of this module is that a renderer shows every key EXCEPT those suffixed
    `_ref` — so returning that column under its own name would hand a template an
    id wearing a display field's name. It is aliased instead, and the name to
    show is `reassigned_to_name`.
    """
    assert "reassigned_to_user_id AS reassigned_to_user_ref" in oc._LEDGER_SQL
    # `subject_ref` is already suffixed; `subject_label` is the display field.
    for line in oc._LEDGER_SQL.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        assert "reassigned_to_user_id," not in stripped


def test_the_module_vocabularies_still_match_migration_164():
    """_SUBJECT_TYPES duplicates a CHECK constraint, so it can drift from it.

    The duplication is deliberate — validating in Python turns a 500 into a
    ValueError, and catches the near-miss the constraint would happily accept
    ('module' is not in the vocabulary; 'module_grant' is). But a duplicated
    list is a list that goes stale: add a subject_type to the migration alone
    and record_custody refuses the value the database would have taken; add it
    here alone and the ValueError is replaced by a CheckViolation 500. This
    reads the constraint out of the migration file and compares.
    """
    import pathlib
    import re

    sql = (pathlib.Path(__file__).resolve().parents[1]
           / "migrations" / "164_offboarding_custody.sql").read_text(encoding="utf-8")

    def vocabulary(constraint: str, column: str) -> tuple:
        m = re.search(rf"{constraint} CHECK \({column} IN \((.*?)\)\)", sql, re.S)
        assert m, f"{constraint} not found in migration 164"
        return tuple(re.findall(r"'([a-z_]+)'", m.group(1)))

    assert vocabulary("manav_offboarding_custody_subject_ck", "subject_type") == oc._SUBJECT_TYPES
    # action and status are validated against literals inline in record_custody;
    # assert the migration still agrees with those literals too.
    assert vocabulary("manav_offboarding_custody_action_ck", "action") == ("reassign", "revoke")
    assert vocabulary("manav_offboarding_custody_status_ck", "status") == (
        "outstanding", "done", "waived")
