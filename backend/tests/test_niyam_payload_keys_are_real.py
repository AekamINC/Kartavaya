"""Every payload key must be able to hold a value.

WHY THIS EXISTS
---------------
`subjects.py` builds each event's payload by reading named columns off a
`RETURNING *` row. A key that reads a column name which does not exist is the
worst-behaved bug this design can produce, because NOTHING about it looks wrong:

  * `_clean` preserves None (`emit.py`: `or v is None`), so the key is PRESENT
    AND NULL in every event, not absent.
  * present-and-null is exactly what a task with no deadline looks like, so the
    payload reads as valid data.
  * the condition builder offers the field, because the field is there.
  * a rule using it evaluates cleanly and matches nothing, for ever, while
    displaying as Active.

That is the precise failure the whole Niyam design exists to end, and N3 shipped
with two instances of it:

  * `due_date` — there is no such column. It is `due_at`. Every "due within two
    days" rule would have matched nothing. `deadline_agent.py` records losing a
    whole agent to the same two-letter difference.
  * `created_by` read `tasks.user_id`, which is the owner of a PERSONAL task and
    is NULL for every project task — and personal tasks carry no team_id, so
    they resolve to no org and emit nothing at all. The key was null in 100% of
    emitted events.

Both were found by an adversarial survey, not by the suite, which is why the
suite now carries this.

HOW IT WORKS
------------
`TASK_ROW` below is a row using the REAL column names of `public.tasks`, every
value deliberately non-null and distinctive. Feed it to `_task_fields` and every
payload key must come back populated. A key that reads a misspelled or
nonexistent column returns None and fails here, naming itself.

This is stronger than comparing against a list of column names, because it also
catches a key that reads a REAL column holding the wrong thing — the
`user_id` / `created_by_user_id` case, where both columns exist.

The column names were verified against the live catalog on 2026-08-16
(`information_schema.columns` for `public.tasks`). If `tasks` gains or renames a
column, this fixture is the place that has to learn about it — deliberately, so
that a rename is noticed rather than absorbed.
"""
from __future__ import annotations

import datetime as _dt

import pytest

from services.niyam import subjects as S

#: A task row as `RETURNING *` actually hands it back. REAL column names only.
TASK_ROW = {
    "task_id":             "task_deadbeef01",
    "team_id":             "team_001",
    "column_id":           "col_todo",
    "category_id":         "cat_ops",
    "status":              "in_progress",
    "priority":            "high",
    "title":               "Reconcile the August ledger",
    "due_at":              _dt.datetime(2026, 8, 20, 9, 30, tzinfo=_dt.timezone.utc),
    "assignee_user_ids":   ["user_aaa111", "user_bbb222"],
    "approval_status":     "pending",
    "created_by_user_id":  "user_ccc333",
    # Present and deliberately DIFFERENT from created_by_user_id: this is the
    # personal-task owner, and reading it for "who created this" is the bug.
    "user_id":             None,
}


def test_no_task_payload_key_is_unfillable():
    """The whole point of the file. Every key must be able to hold a value."""
    payload = S._task_fields(TASK_ROW)
    empty = sorted(k for k, v in payload.items() if v is None)
    assert not empty, (
        "These payload keys came back null from a FULLY POPULATED task row, "
        "which means each reads a column that does not exist or does not hold "
        "what the key claims. A rule conditioned on one of these can never "
        "fire, and the builder will offer it anyway: " + ", ".join(empty)
    )


def test_due_at_is_the_column_and_the_key():
    """`due_date` is not a column on `tasks`, and was not one when it shipped."""
    payload = S._task_fields(TASK_ROW)
    assert "due_date" not in payload, (
        "`due_date` is not a column on `tasks` — reading it yields a key that "
        "is present and permanently null. The column is `due_at`."
    )
    assert payload["due_at"] == "2026-08-20T09:30:00+00:00", (
        "a datetime must be rendered, not handed to _clean — _clean DROPS "
        "values it cannot serialise, silently and with no log line"
    )


def test_created_by_is_the_creator_not_the_personal_task_owner():
    """Both columns exist, which is why reading the wrong one looked correct."""
    payload = S._task_fields(TASK_ROW)
    assert payload["created_by"] == "user_ccc333"
    assert payload["created_by"] != TASK_ROW["user_id"]


def test_the_detector_would_have_caught_the_bug_it_was_written_for():
    """Prove this test fails against the shape that shipped.

    A regression test that has never been shown to fail against the original
    defect is a test whose authors are guessing.
    """
    def _old_shape(row):
        return {
            "due_date": row.get("due_date"),        # the column does not exist
            "created_by": row.get("user_id"),       # the personal-task owner
        }

    broken = _old_shape(TASK_ROW)
    assert sorted(k for k, v in broken.items() if v is None) == ["created_by", "due_date"]


def test_an_empty_row_yields_an_empty_payload_not_a_row_of_nulls():
    """`{}` says "no data". A dict of nulls says "data, all of it missing" —
    and a condition would evaluate against the second."""
    assert S._task_fields(None) == {}
    assert S._task_fields({}) == {}


def test_assignees_are_a_list_and_never_null():
    """`is_empty` is the operator for "unassigned", not a null check — so the
    key must be a list on every event, including when nobody is assigned."""
    payload = S._task_fields({**TASK_ROW, "assignee_user_ids": None})
    assert payload["assignee_user_ids"] == []
    assert payload["assignee_count"] == 0


# ── uuid entity ids ──────────────────────────────────────────────────────────

class _Conn:
    def __init__(self):
        self.args = None

    def transaction(self):
        class _T:
            async def __aenter__(_s): return _s
            async def __aexit__(_s, *a): return False
        return _T()

    async def fetchval(self, sql, *args):
        self.args = args
        return 1


@pytest.mark.parametrize("emitter,kwargs,entity_key", [
    (S.contact_created, {"contact_id": None, "row": {}}, "contact_id"),
    (S.deal_stage_changed,
     {"deal_id": None, "old_stage": "New", "new_stage": "Won"}, "deal_id"),
])
async def test_a_uuid_entity_id_is_stringified(emitter, kwargs, entity_key):
    """`graha_contacts.id` and `graha_deals.id` are UUID columns; `entity_id`
    binds `$4::text`. asyncpg refuses to coerce a uuid.UUID into a text
    parameter and raises at BIND time — which `emit_event`'s savepoint contains,
    so the event would simply never appear."""
    import uuid as _uuid
    ident = _uuid.uuid4()
    conn = _Conn()
    await emitter(conn, org_id="1" * 8 + "-1111-1111-1111-111111111111",
                  actor_id="user_a", **{**kwargs, entity_key: ident})
    assert conn.args[3] == str(ident)
    assert isinstance(conn.args[3], str)
