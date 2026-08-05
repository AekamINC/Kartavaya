"""The reminder scan: block four, and the independence of all four.

WHY THIS FILE EXISTS. `staging.reminders` holds ZERO rows for the product's
entire life. There is no Railway cron on `/api/internal/cron/reminders` and
there never has been — the project's two cron services are `retention-cron` and
`task-reminder-cron`, and the second posts to `/api/task-reminders/dispatch`,
a different endpoint over a different table. The owner is about to create the
missing one. On its first tick, measured against the live database on
2026-08-05:

    200  overdue invoices          → block 1
     41  due-or-late follow-ups    → block 2
      0  stale approvals           → block 3
     13  (9 tasks × their assignees) → block 4

and `process_pending_reminders` then hands the first 100 to the mailer. Staging
and production share one database, so that is one event, not two.

Block four could not have written any of its 13. It joined `task_assignments`,
a relation in no schema — `SELECT count(*) FROM pg_class WHERE relname =
'task_assignments'` returns 0 — and then bound `tasks.task_id`, the TEXT
`task_<hex12>` form, into `reminders.entity_id`, which migration 049 declares
`UUID NOT NULL`. Either fault raises. The raise is the interesting part: the
caller in `routers/scheduler.py` is

    scanned = await scan_and_create_reminders()
    sent    = await process_pending_reminders()

— two awaits and no try, so a raise out of the first means the second is never
reached, on that tick and on every tick afterwards. Reminders would pile up and
none would be sent.

── HOW THESE TESTS ARE WRITTEN, AND WHY THAT IS NOT INCIDENTAL ─────────────

1. THE POOL IS A MOCK AND IT RESOLVES ANY TABLE NAME. `conftest.make_pool`
   returns a MagicMock whose `fetch` answers `[]` to `SELECT … FROM
   table_that_does_not_exist`. No test driven through it can discover a missing
   relation. So the SQL is asserted as TEXT and the row mappers are asserted as
   PURE FUNCTIONS, and the mock is used only for the one thing it can honestly
   show: that a block which blows up does not take the others with it.

2. COMMENTS ARE STRIPPED BEFORE ANYTHING IS ASSERTED ON SOURCE. This repo has
   shipped four checks satisfied by their own commentary. `reminder_service`
   discusses `task_assignments` at length — it has to, that is the record of
   what was wrong — so a naive `"task_assignments" not in source` would pass on
   a file that still contained the broken join, or fail on a correct one. The
   module is round-tripped through `ast` (which has no concept of a comment)
   with docstrings removed, leaving only code and string literals.

3. THE FORBIDDEN SET IS WRITTEN OUT LITERALLY. Not "everything except the
   allowed relations" — a set computed as ALL minus ALLOWED cannot notice
   ALLOWED widening, which is the exact mutation that would put a phantom table
   back. `task_assignments` is named, as a string, in the assertion.
"""

import ast
import inspect
import re
import uuid

import pytest

from services import reminder_service as rs


# ── source, with every comment and docstring removed ─────────────────────────

def _code_only(module) -> str:
    """The module's SOURCE with comments and docstrings gone.

    `ast.parse` drops comments outright — they are not nodes. Docstrings survive
    as `Expr(Constant(str))` and are removed here, because the module docstring
    and several function docstrings name `task_assignments` in prose.

    String literals that are NOT docstrings are kept, which is the whole point:
    the SQL lives in module-level constants and must remain assertable.
    """
    tree = ast.parse(inspect.getsource(module))
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list) or not body:
            continue
        if not isinstance(node, (ast.Module, ast.FunctionDef,
                                 ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        first = body[0]
        if (isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            body.pop(0)
            if not body:
                body.append(ast.Pass())
    return ast.unparse(tree)


ALL_SCAN_SQL = (rs._INVOICE_SCAN, rs._FOLLOW_UP_SCAN,
                rs._APPROVAL_SCAN, rs._TASK_SCAN, rs._INSERT_REMINDER)


def test_the_comment_stripper_actually_strips():
    """The tool the other tests rest on, checked before they rest on it.

    Without this, a stripper that silently returned the raw source would make
    every assertion below vacuous in the direction that matters — prose about
    the bug would keep satisfying a grep for the bug.
    """
    src = inspect.getsource(rs)
    assert "task_assignments" in src, (
        "the module is expected to DISCUSS the dead relation in its comments; "
        "if it no longer does, this test is checking nothing"
    )
    stripped = _code_only(rs)
    assert "THE SCAN" not in stripped, "a `#` comment survived the stripper"
    assert "NEVER RAISES, AND THAT IS THE POINT" not in stripped, (
        "a docstring survived the stripper"
    )
    # And a literal that is not a docstring must survive, or the SQL assertions
    # below would pass on an empty string.
    assert "staging.reminders" in stripped
    assert "assignee_user_ids" in stripped


# ════════════════════════════════════════════════════════════════════════════
# 1. THE PHANTOM RELATION IS GONE FROM THE CODE, NOT JUST FROM THE COMMENTS
# ════════════════════════════════════════════════════════════════════════════

def test_no_scan_reads_a_relation_that_exists_in_no_schema():
    """`task_assignments` — pg_class count 0, verified against the live DB.

    Named literally rather than derived. A check written as "the task scan
    joins only tables in this allowed list" passes the moment someone adds the
    phantom to the allowed list, which is precisely the edit that would
    reintroduce the bug.
    """
    for sql in ALL_SCAN_SQL:
        assert "task_assignments" not in sql, (
            "a scan query reads `task_assignments`, which exists in no schema — "
            "pg_class count 0 — and raises UndefinedTableError on the first tick"
        )
    assert "task_assignments" not in _code_only(rs), (
        "the module still references `task_assignments` somewhere in its CODE. "
        "Comments about it are fine and expected; a query is not."
    )


def test_the_task_scan_reads_the_column_that_is_actually_populated():
    """`tasks.assignee_user_ids` — 547 of 632 tasks, 661 of 661 entries real users.

    And NOT `project_assignments`, which is team membership at the wrong grain:
    (team_id, user_id, role), 68 rows in public and 0 in staging. Joining it
    would fan every task out to its whole team.
    """
    assert "assignee_user_ids" in rs._TASK_SCAN
    assert "unnest" in rs._TASK_SCAN, (
        "assignee_user_ids is text[]; without unnest the array itself would be "
        "bound into a text column"
    )
    assert "project_assignments" not in rs._TASK_SCAN, (
        "project_assignments is TEAM membership, not task assignment — it would "
        "send a task's reminder to everyone on the team"
    )
    assert "created_by_user_id" in rs._TASK_SCAN, (
        "public.tasks has no `created_by` column; the fallback must name "
        "`created_by_user_id` or the query raises UndefinedColumnError one line "
        "below the join that was deleted"
    )


def test_the_task_scan_dedupes_and_stores_on_the_uuid_not_the_text_id():
    """`entity_id` is UUID NOT NULL (049). `tasks.id` is uuid; `task_id` is text.

    Both halves matter. Storing `task_id` raises on the INSERT; deduping on
    `task_id` in the NOT EXISTS compares a text id against a uuid column, which
    raises on the SELECT — earlier, and before a single row is written.
    """
    assert "t.id AS entity_id" in rs._TASK_SCAN
    assert "r.entity_id = t.id" in rs._TASK_SCAN, (
        "the NOT EXISTS still compares reminders.entity_id (uuid) against a "
        "text task id"
    )
    assert "r.entity_id = t.task_id" not in rs._TASK_SCAN


def test_the_task_scan_refuses_a_team_with_no_org():
    """`teams.org_id` is nullable — 10 of 44 teams have none. `reminders.org_id`
    is NOT NULL with an FK to `staging.organisations`."""
    assert "tm.org_id IS NOT NULL" in rs._TASK_SCAN


def test_the_approval_scan_casts_its_uuid_approver_to_text():
    """`current_step_approver_id` is UUID; `recipient_user_id` is TEXT.

    asyncpg does not coerce — it raises `expected str, got UUID`. Zero stale
    approvals exist today, so this has never fired; that is luck, not
    correctness.
    """
    assert "current_step_approver_id::text" in rs._APPROVAL_SCAN


# ════════════════════════════════════════════════════════════════════════════
# 1b. EVERY COLUMN A SCAN READS IS A COLUMN THAT EXISTS
#
# THIS IS THE CHECK THAT WOULD HAVE CAUGHT BOTH FAULTS, and neither a mock pool
# nor a careful re-read of the code could have. `conftest.make_pool` answers
# `[]` to `SELECT f.nonsense FROM …`, so a test driven through it proves the
# code path and nothing about the schema. Two columns in this file were fiction
# for the product's entire life:
#
#     f.note        — graha_follow_ups has `title` and `description`
#     t.created_by  — public.tasks has `created_by_user_id`
#
# and one whole relation, `task_assignments`, was fiction as well.
#
# The maps below are the live schema, read from `information_schema.columns` on
# 2026-08-06 against toacecaewujfxjfrjwco (the one database staging and
# production share). They are WRITTEN OUT LITERALLY rather than derived from
# anything, which is the point: a set computed as "whatever the query happens to
# use" cannot fail, and a set computed as "everything except the forbidden
# names" cannot notice a new fiction. To add a column here you have to go and
# look at the database, which is the behaviour this check is buying.
# ════════════════════════════════════════════════════════════════════════════

_REMINDERS = set(
    "id org_id reminder_type entity_type entity_id remind_at channel "
    "recipient_user_id recipient_email recipient_phone status sent_at message "
    "created_at created_by".split()
)

_GANIT_INVOICES = set(
    "amount_paid approved_by balance_due cancel_reason cancelled_at cess cgst "
    "client_id contact_id converted_invoice_id created_at created_by currency "
    "deal_id discount doc_status due_date estimate_status exchange_rate id igst "
    "invoice_date invoice_number invoice_type is_active is_export is_igst "
    "line_items notes org_id payment_schedule payment_status pdf_url "
    "place_of_supply prepared_by quote_terms recurring_id scope_summary sent_at "
    "sgst subtotal supply_nature terms total updated_at viewed_at".split()
)

_GRAHA_FOLLOW_UPS = set(
    "id org_id contact_id deal_id title description due_at remind_at "
    "is_completed completed_at assigned_to created_by created_at".split()
)

_APPROVAL_REQUESTS = set(
    "id org_id title status current_step_approver_id created_at".split()
)

_TASKS = set(
    "id task_id user_id team_id created_by_user_id assigned_by_user_id "
    "completed_by_user_id title description status priority category_id tags "
    "assignee_user_ids assignee_emails due_at reminder_at reminder_sent_at "
    "recurrence_rule recurrence_interval estimated_minutes attachments "
    "custom_fields subtasks sort_order created_at updated_at completed_at "
    "board_id column_slug column_id requires_approval approval_status "
    "approved_by approval_notes approval_requested_at approval_decided_at "
    "approval_id created_by_name archived_at".split()
)

_TEAMS = set(
    "id team_id name created_by created_at updated_at deleted_at deleted_by "
    "color brand_settings org_id".split()
)

#: alias → the columns that alias really has, per scan. `a` means two different
#: things in two different queries, which is exactly why this is per-scan.
_ALIASES = {
    "_INVOICE_SCAN":   (rs._INVOICE_SCAN,   {"i": _GANIT_INVOICES, "r": _REMINDERS}),
    "_FOLLOW_UP_SCAN": (rs._FOLLOW_UP_SCAN, {"f": _GRAHA_FOLLOW_UPS, "r": _REMINDERS}),
    "_APPROVAL_SCAN":  (rs._APPROVAL_SCAN,  {"a": _APPROVAL_REQUESTS, "r": _REMINDERS}),
    # `a` here is the LATERAL unnest of tasks.assignee_user_ids, given the
    # column name `user_id` by `AS a(user_id)` — not approval_requests.
    "_TASK_SCAN":      (rs._TASK_SCAN,      {"t": _TASKS, "tm": _TEAMS,
                                             "a": {"user_id"}, "r": _REMINDERS}),
}

_QUALIFIED = re.compile(r"\b([a-z][a-z_]{0,4})\.([a-z_]+)\b")


@pytest.mark.parametrize("name", sorted(_ALIASES))
def test_every_column_a_scan_reads_exists_in_the_live_schema(name):
    sql, aliases = _ALIASES[name]
    seen = 0
    for alias, column in _QUALIFIED.findall(sql):
        if alias == "staging":          # schema.table, not alias.column
            continue
        assert alias in aliases, (
            f"{name} uses the alias {alias!r}, which this test does not know "
            f"the columns of — go and read information_schema, then add it"
        )
        seen += 1
        assert column in aliases[alias], (
            f"{name} reads {alias}.{column}, which does not exist. This is the "
            f"exact shape of the two faults this file was shipped with: "
            f"`f.note` (graha_follow_ups has title/description) and "
            f"`t.created_by` (public.tasks has created_by_user_id). Both raise "
            f"UndefinedColumnError on the first tick."
        )
    assert seen >= 4, f"{name}: the reference regex matched almost nothing"


def test_the_follow_up_scan_does_not_read_the_column_that_never_existed():
    """Named literally, because it is the one that cost block 2 its whole life.

    Block 2 was described everywhere as one of "the three that work". It was
    not: `f.note` raised at the FETCH, so the first tick would have written 200
    invoice rows, died on follow-ups, and never reached blocks 3, 4 or the send
    half at all. The widely quoted "241 rows on the first tick" was 200.
    """
    assert "f.note" not in rs._FOLLOW_UP_SCAN
    assert "f.title" in rs._FOLLOW_UP_SCAN


# ════════════════════════════════════════════════════════════════════════════
# 2. THE MAPPERS ARE PURE, SO THE TYPE CONTRACT IS TESTABLE WITHOUT A DATABASE
# ════════════════════════════════════════════════════════════════════════════

ORG = uuid.UUID("64e7bea6-6abe-490c-a2a4-27a60c6be916")
TASK_UUID = uuid.UUID("11073948-5e1f-435a-999a-a671069c2818")


def test_a_text_task_id_in_the_uuid_column_is_refused_by_name():
    """The defect, reproduced as a unit and caught before the driver sees it.

    'task_a873466d6bea' is a real id from the live table. asyncpg would also
    have refused it, but from inside the driver with a message about parameter
    $4 that names neither the block nor the column.
    """
    row = {"org_id": ORG, "entity_id": "task_a873466d6bea",
           "title": "Quarterly filing", "recipient": "user_f1a0a472b98f"}
    with pytest.raises(ValueError) as exc:
        rs._task_row(row)
    assert "entity_id" in str(exc.value)


def test_the_task_mapper_produces_the_insert_argument_types_049_declares():
    row = {"org_id": ORG, "entity_id": TASK_UUID, "task_ref": "task_a873466d6bea",
           "title": "Quarterly filing", "recipient": "user_f1a0a472b98f"}
    org_id, rtype, etype, entity_id, recipient, message = rs._task_row(row)

    assert isinstance(org_id, uuid.UUID)          # org_id UUID NOT NULL
    assert isinstance(entity_id, uuid.UUID)       # entity_id UUID NOT NULL
    assert entity_id == TASK_UUID
    assert isinstance(recipient, str)             # recipient_user_id TEXT
    assert (rtype, etype) == ("task_due", "tasks")
    assert "Quarterly filing" in message
    # The text id is useful and is not thrown away — but it is not a uuid and
    # does not go in the database as one.
    assert "task_a873466d6bea" not in str(entity_id)


def test_a_uuid_approver_reaches_the_text_column_as_a_string():
    """The belt to the `::text` cast's brace: even handed a raw UUID object,
    the mapper produces the `str` asyncpg requires for a text parameter."""
    approver = uuid.UUID("fae87907-2f99-4b35-a241-c94d9e1e4a17")
    row = {"org_id": ORG, "entity_id": TASK_UUID, "title": "Purchase order",
           "recipient": approver}
    _, _, _, _, recipient, _ = rs._approval_row(row)
    assert isinstance(recipient, str) and recipient == str(approver)


def test_a_missing_org_is_refused_rather_than_written_as_null():
    """`reminders.org_id` is NOT NULL and an FK. A row without one cannot land,
    so it should fail where the column can be named."""
    row = {"org_id": None, "entity_id": TASK_UUID, "title": "T", "recipient": "u"}
    with pytest.raises(ValueError) as exc:
        rs._task_row(row)
    assert "org_id" in str(exc.value)


# ════════════════════════════════════════════════════════════════════════════
# 3. INDEPENDENCE: BLOCK FOUR FAILING COSTS BLOCK FOUR
#
# The one property the mock pool CAN prove, because it does not depend on any
# table existing — only on where an exception is allowed to travel.
# ════════════════════════════════════════════════════════════════════════════

class _Pool:
    """A pool that answers each scan by its SQL and can be told to detonate."""

    def __init__(self, rows_by_key, fetch_raises=(), execute_raises_on=()):
        self._rows = rows_by_key
        self._fetch_raises = set(fetch_raises)
        self._execute_raises_on = set(execute_raises_on)
        self.inserted = []

    def _key(self, sql):
        for key, scan_sql, _ in rs._SCAN_BLOCKS:
            if scan_sql == sql:
                return key
        raise AssertionError(f"unrecognised scan SQL: {sql[:60]!r}")

    async def fetch(self, sql, *args):
        key = self._key(sql)
        if key in self._fetch_raises:
            # What `LEFT JOIN task_assignments` really produced, by name.
            raise RuntimeError('relation "task_assignments" does not exist')
        return list(self._rows.get(key, []))

    async def execute(self, sql, *args):
        assert sql == rs._INSERT_REMINDER
        if args[1] in self._execute_raises_on:
            raise RuntimeError("insert or update violates foreign key constraint")
        self.inserted.append(args)
        return "INSERT 0 1"


def _rows_for_all_four():
    """Two invoices, one follow-up, one approval, two task rows."""
    return {
        "invoices": [
            {"org_id": ORG, "entity_id": uuid.uuid4(),
             "invoice_number": "INV-0001", "balance_due": 12000,
             "recipient": "user_f1a0a472b98f"},
            {"org_id": ORG, "entity_id": uuid.uuid4(),
             "invoice_number": "INV-0002", "balance_due": 400,
             "recipient": "user_549c9cac35aa"},
        ],
        "follow_ups": [
            {"org_id": ORG, "entity_id": uuid.uuid4(), "subject": "Call back",
             "recipient": "user_f1a0a472b98f"},
        ],
        "approvals": [
            {"org_id": ORG, "entity_id": uuid.uuid4(), "title": "PO 44",
             "recipient": str(uuid.uuid4())},
        ],
        "tasks": [
            {"org_id": ORG, "entity_id": TASK_UUID, "task_ref": "task_a873466d6bea",
             "title": "Quarterly filing", "recipient": "user_f1a0a472b98f"},
            {"org_id": ORG, "entity_id": TASK_UUID, "task_ref": "task_a873466d6bea",
             "title": "Quarterly filing", "recipient": "user_549c9cac35aa"},
        ],
    }


async def test_all_four_blocks_write_when_nothing_is_wrong(monkeypatch):
    pool = _Pool(_rows_for_all_four())

    async def _get_pool():
        return pool
    monkeypatch.setattr(rs, "get_pool", _get_pool)

    result = await rs.scan_and_create_reminders()
    assert result == {"invoices": 2, "follow_ups": 1, "approvals": 1, "tasks": 2}
    assert "errors" not in result
    assert len(pool.inserted) == 6


async def test_block_four_exploding_does_not_cost_the_other_three(monkeypatch):
    """THE GUARANTEE. This is the state the file shipped in for its whole life.

    The 241 invoice and follow-up rows must still be written, the coroutine must
    still RETURN — because the caller's next line is `await
    process_pending_reminders()` with no try around it, and a raise here means
    nothing is ever sent — and the failure must still be reported.
    """
    pool = _Pool(_rows_for_all_four(), fetch_raises={"tasks"})

    async def _get_pool():
        return pool
    monkeypatch.setattr(rs, "get_pool", _get_pool)

    result = await rs.scan_and_create_reminders()

    assert result["invoices"] == 2, "block 1 was voided by block 4's failure"
    assert result["follow_ups"] == 1, "block 2 was voided by block 4's failure"
    assert result["approvals"] == 1, "block 3 was voided by block 4's failure"
    assert result["tasks"] == 0
    assert len(pool.inserted) == 4

    # Reported, not swallowed. A green cron over a dead block is the failure
    # mode routers/scheduler.py exists to end.
    assert "task_assignments" in result["errors"]["tasks"]
    assert set(result["errors"]) == {"tasks"}


async def test_the_first_block_exploding_does_not_cost_the_last_three(monkeypatch):
    """Independence is a property of the loop, not of block four's position.

    A test that only detonated the LAST block would pass on code that simply
    ran the blocks in order and returned early.
    """
    pool = _Pool(_rows_for_all_four(), fetch_raises={"invoices"})

    async def _get_pool():
        return pool
    monkeypatch.setattr(rs, "get_pool", _get_pool)

    result = await rs.scan_and_create_reminders()
    assert result["invoices"] == 0
    assert (result["follow_ups"], result["approvals"], result["tasks"]) == (1, 1, 2)
    assert len(pool.inserted) == 4


async def test_one_bad_row_costs_one_row(monkeypatch):
    """A foreign-key violation on one org's reminder is not the other 253's
    problem. There is no transaction here — `pool.execute` commits per
    statement — so stopping at the first bad row keeps the rows before it and
    discards the rows after it, which is the least defensible option available.
    """
    pool = _Pool(_rows_for_all_four(), execute_raises_on={"invoice_overdue"})

    async def _get_pool():
        return pool
    monkeypatch.setattr(rs, "get_pool", _get_pool)

    result = await rs.scan_and_create_reminders()
    assert result["invoices"] == 0
    assert (result["follow_ups"], result["approvals"], result["tasks"]) == (1, 1, 2)
    assert "2 row(s) failed" in result["errors"]["invoices"]


async def test_the_scan_returns_rows_written_not_rows_found(monkeypatch):
    """The old code returned `len(fetched)` and would have reported 241
    successes for 241 attempts whatever the database said about them."""
    pool = _Pool(_rows_for_all_four(), execute_raises_on={"task_due"})

    async def _get_pool():
        return pool
    monkeypatch.setattr(rs, "get_pool", _get_pool)

    result = await rs.scan_and_create_reminders()
    assert result["tasks"] == 0, (
        "two task rows were fetched and neither was written; reporting 2 would "
        "be reporting the fetch"
    )


# ════════════════════════════════════════════════════════════════════════════
# 4. THE SEND PATH HONOURS THE KILL SWITCH
#
# The first tick offers up to 100 emails. Staging sets OUTBOUND_MODE=dry;
# production does not set it at all and `outbound.py:148` defaults to "live".
# What is pinned here is that the reminder mailer consults the switch — not
# what the switch is set to, which is a Railway variable and not this repo's
# to assert.
# ════════════════════════════════════════════════════════════════════════════

async def test_a_reminder_email_goes_through_the_outbound_gate(monkeypatch):
    """`process_pending_reminders` → `email_service.send_email` → `outbound.begin`.

    conftest forces OUTBOUND_MODE=dry for the whole suite, so `begin` returns
    blocked and `send_email` returns at the gate before any provider call. The
    assertion is that the gate was CONSULTED: a sender that never called
    `begin` would send for real in production and leave no row behind.
    """
    import outbound
    assert outbound.DRY_RUN is True, "conftest sets OUTBOUND_MODE=dry"

    seen = []
    real_begin = outbound.begin

    def _spy(channel, target="", detail="", **kwargs):
        seen.append((channel, target))
        return real_begin(channel, target, detail, **kwargs)
    monkeypatch.setattr(outbound, "begin", _spy)

    class _SendPool:
        def __init__(self):
            self.updates = []

        async def fetch(self, sql, *args):
            return [{
                "id": uuid.uuid4(), "org_id": str(ORG), "channel": "email",
                "email": "overdue@client.example", "recipient_user_id": "user_x",
                "full_name": "Asha Mehta", "reminder_type": "invoice_overdue",
                "message": "Invoice INV-0001 is overdue.",
            }]

        async def execute(self, sql, *args):
            self.updates.append(sql)
            return "UPDATE 1"

    pool = _SendPool()

    async def _get_pool():
        return pool
    monkeypatch.setattr(rs, "get_pool", _get_pool)

    result = await rs.process_pending_reminders()
    assert result == {"processed": 1, "sent": 1}
    assert seen == [("email", "overdue@client.example")], (
        "the reminder mailer did not consult outbound.begin — with "
        "OUTBOUND_MODE unset (production) that is an unguarded real send"
    )
