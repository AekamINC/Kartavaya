"""
reminder_service.py — Background reminder processor.

Scans for due reminders and sends them via email/push.
Called periodically from a scheduler endpoint or cron.

── WHAT THIS FILE DOES ON ITS FIRST TICK ────────────────────────────────────

Nothing here has ever run. Measured against the live database on 2026-08-05:
`staging.reminders` holds ZERO rows for the product's entire life, while 200
invoices are past due and 41 CRM follow-ups are due or overdue. There is no
Railway cron pointing at `/api/internal/cron/reminders` — the project's two
cron services are `retention-cron` and `task-reminder-cron`, and the latter
posts to `/api/task-reminders/dispatch`, a different endpoint over a different
table. The moment that cron service exists this file writes ~254 rows and, in
an environment where `OUTBOUND_MODE` is not `dry`, hands 100 of them to SES.

Staging and production share one database, so "the first tick" is one event,
not two.
"""
import logging
import uuid as _uuid
from datetime import datetime, timezone, timedelta

import outbound
from db import get_pool
from services.push_service import prefs_verdict

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════
# THE SCAN
#
# ── WHY IT IS FOUR BLOCKS AND NOT ONE FUNCTION BODY ─────────────────────────
#
# It used to be four `await pool.fetch(...)` / `for row in …: await
# pool.execute(...)` pairs written out in sequence, with nothing between them.
# The fourth pair joined `task_assignments`, a relation that exists in NO
# SCHEMA — `SELECT count(*) FROM pg_class WHERE relname = 'task_assignments'`
# returns 0 — so on the first real tick block four raises `UndefinedTableError`
# and the coroutine dies there.
#
# The three blocks above it are not rolled back, because there is no
# transaction: `pool.execute` takes a connection, runs one statement and commits
# it. So the 241 invoice and follow-up rows do land. What does NOT happen is
# everything after the raise, and the caller is the reason that matters.
# `routers/scheduler.py:run_reminders` is:
#
#     scanned = await scan_and_create_reminders()
#     sent    = await process_pending_reminders()
#
# — two awaits, no try. A raise out of the first means the second never runs, on
# that tick and on every tick after it. Reminders would accumulate forever and
# not one would ever be sent. That is the shape of the risk: a broken fourth
# block silently voiding the three that work, not by undoing their writes but by
# stopping the send half from ever being reached.
#
# So the blocks are DATA, walked by a loop with its own `try` per block and a
# second `try` per row. A block that raises costs its own rows and nothing
# else; a row that raises — one org missing its `staging.organisations` parent,
# say — costs that row and nothing else. `scan_and_create_reminders` returns
# normally in every case, which is what lets `process_pending_reminders` run.
#
# IT DOES NOT SWALLOW. A failed block is `log.exception`'d and named in the
# returned dict under "errors". That dict is the caller's to act on; see the
# note on the return value at the bottom of `scan_and_create_reminders`.
#
# ── NO SQL COMMENTS IN THESE STRINGS, DELIBERATELY ──────────────────────────
#
# `tests/test_reminder_scan.py` asserts on these constants literally — that
# `task_assignments` appears in none of them, that the task block reads
# `t.assignee_user_ids`. A `--` comment inside the SQL would let a future
# version satisfy those greps with an explanation of itself rather than with
# the query. The prose lives out here, where the test's comment-stripper
# removes it before it can match anything.
# ════════════════════════════════════════════════════════════════════════════

#: One INSERT for all four blocks. Written once so the column list and the type
#: contract are stated in one place: $1 org_id UUID (NOT NULL, FK to
#: staging.organisations), $2 reminder_type TEXT, $3 entity_type TEXT,
#: $4 entity_id UUID (NOT NULL), $5 recipient_user_id TEXT (nullable),
#: $6 message TEXT. Migration 049 is the authority for every one of those.
_INSERT_REMINDER = """
INSERT INTO staging.reminders
    (org_id, reminder_type, entity_type, entity_id, remind_at, channel,
     recipient_user_id, message, created_by)
VALUES ($1, $2, $3, $4, NOW(), 'email', $5, $6, 'system')
"""

# ── THE DUNNING SELECTOR REACHED THREE DOCUMENTS NOBODY IS OWED MONEY ON ────
#
# Phase 2 closed "draft invoices are dunned and counted as revenue" across four
# surfaces. **This was not one of them, and it is the one that actually sends
# the email.** Found on 2026-08-26 by reading a live reminder rather than the
# code: 359 `invoice_overdue` rows had been created against documents these
# three guards exclude — 347 in the test org, where the outbound fence
# suppressed them, and 12 in Unicode Group, where it did not.
#
# The three shapes are the same family `record_payment` refuses, seen from the
# other side. A receipt against them is wrong because the money cannot be owed;
# a dunning letter is wrong for exactly the same reason.
#
#   · **draft** — nobody has been sent this document, so nobody can be late
#     paying it. `routers/dristi.py` states the same rule for the same reason.
#     Live: 52 overdue drafts across the two organisations, one for Rs 6,03,997.
#   · **credit_note** — money owed the OTHER way. Dunning one asks a customer to
#     pay you for a refund you owe them.
#   · **balance_due <= 0** — nothing is outstanding. This one is not theoretical
#     prose: on 2026-08-26 at 13:04 UTC the cron sent Unicode Group an email
#     reading *"Invoice INV-2026-0007 is overdue. Balance: Rs 0.00"*, and would
#     have repeated it every three days for ever.
#
# `balance_due > 0` also subsumes a case the status column misses: a row can sit
# at `payment_status='unpaid'` with a zero balance, which is precisely how
# INV-2026-0007 and INV-2026-0047 both read. Status is a label; the balance is
# the fact. Guard on the fact.
_INVOICE_SCAN = """
SELECT i.id AS entity_id, i.org_id, i.invoice_number, i.balance_due,
       i.created_by AS recipient
FROM staging.ganit_invoices i
WHERE i.payment_status NOT IN ('paid', 'void')
  AND i.due_date < NOW()
  AND i.is_active = TRUE
  AND COALESCE(i.doc_status, '') <> 'draft'
  AND COALESCE(i.invoice_type, '') <> 'credit_note'
  AND i.balance_due > 0
  AND NOT EXISTS (
      SELECT 1 FROM staging.reminders r
      WHERE r.entity_id = i.id
        AND r.reminder_type = 'invoice_overdue'
        AND r.created_at > NOW() - INTERVAL '3 days'
  )
"""

# ── BLOCK TWO WAS DEAD TOO, AND NOBODY HAD LOOKED ───────────────────────────
#
# It selected `f.note`. `staging.graha_follow_ups` has no such column — it has
# `title` and `description` — so this block raised `UndefinedColumnError` at its
# FETCH, before writing anything, and took blocks 3 and 4 down behind it.
#
# That matters beyond one more bad name, because it corrects the number everyone
# has been quoting. The first tick was never going to write 241 rows and stop at
# block 4: it was going to write 200 (invoices, the only block whose columns all
# exist), raise on block 2, and never reach the send half at all. Found by
# running these constants against the live database rather than by reading them
# — the mock pool in the test suite answers `[]` to any column name you like,
# and so does a careful re-read of the code.
#
# `title` and `description` are both populated on all 41 due follow-ups.
# `title` is the human summary and is what the CRM screen shows, so it leads;
# `description` is the fallback for a row saved without one.
_FOLLOW_UP_SCAN = """
SELECT f.id AS entity_id, f.org_id, f.assigned_to AS recipient,
       COALESCE(NULLIF(f.title, ''), NULLIF(f.description, '')) AS subject
FROM staging.graha_follow_ups f
WHERE f.is_completed = FALSE
  AND f.due_at <= NOW() + INTERVAL '1 hour'
  AND NOT EXISTS (
      SELECT 1 FROM staging.reminders r
      WHERE r.entity_id = f.id
        AND r.reminder_type = 'follow_up_due'
        AND r.created_at > NOW() - INTERVAL '1 day'
  )
"""

# `current_step_approver_id` is a UUID column but `reminders.recipient_user_id`
# is TEXT, and asyncpg will not coerce a `uuid.UUID` into a text parameter — it
# raises `DataError: expected str, got UUID`. Cast in the query rather than in
# Python so the row already carries the type the INSERT wants. It has never
# fired because there are zero stale approvals today; that is luck, not
# correctness, and `_as_text` below is the belt to this brace.
_APPROVAL_SCAN = """
SELECT a.id AS entity_id, a.org_id, a.title,
       a.current_step_approver_id::text AS recipient
FROM staging.approval_requests a
WHERE a.status = 'pending'
  AND a.created_at < NOW() - INTERVAL '24 hours'
  AND NOT EXISTS (
      SELECT 1 FROM staging.reminders r
      WHERE r.entity_id = a.id
        AND r.reminder_type = 'approval_pending'
        AND r.created_at > NOW() - INTERVAL '1 day'
  )
"""

# ── BLOCK FOUR, THE ONE THAT WAS BROKEN ─────────────────────────────────────
#
# WHAT IT SAID:  LEFT JOIN task_assignments ta ON ta.task_id = t.task_id
#                COALESCE(ta.user_id, t.created_by) AS assignee_id
#                ... r.entity_id = t.task_id ... VALUES (…, t["task_id"], …)
#
# Three separate faults, each fatal on its own:
#
#   1. `task_assignments` is in no schema. pg_class count 0, under any name,
#      anywhere. `UndefinedTableError` on the first tick.
#   2. `t.created_by` is not a column of `public.tasks` either; the column is
#      `created_by_user_id`. So even with the join dropped it would still raise,
#      one line further down — which is why the fix has to read the table rather
#      than only delete the join.
#   3. `entity_id` is `UUID NOT NULL`, and `tasks.task_id` is TEXT holding
#      `task_<hex12>` — 'task_a873466d6bea' is not a uuid and never will be.
#      A text id bound into a uuid parameter raises before the row is written.
#
# WHAT IT MEANT, read from what is POPULATED rather than from what the schema
# permits (measured 2026-08-05):
#
#   * `public.tasks.assignee_user_ids` is `text[]` and carries the assignment:
#     547 of 632 tasks have at least one entry, and 661 of 661 array elements
#     are real `public.users.user_id` values. This is the relation the dead
#     join was reaching for.
#   * `project_assignments` — the other candidate — is TEAM membership, not task
#     assignment: (team_id, user_id, role), 68 rows in `public` and 0 in
#     `staging`. Joining it would fan every task out to the whole team. Wrong
#     grain; rejected.
#   * `public.tasks.id` is a UUID and is the same row's identity. That is what
#     belongs in `entity_id`; `task_id` stays out of the database entirely and
#     is carried only as `task_ref`, for the log line.
#
# `LEFT JOIN LATERAL … ON TRUE` reproduces the old LEFT JOIN's semantics
# exactly: `unnest` of a NULL or empty array yields zero rows, the LEFT keeps
# the task anyway with a NULL `user_id`, and the COALESCE falls back to the
# creator. A task with two assignees gets two reminders, which is what a join
# against a real assignment table would have done.
#
# `tm.org_id IS NOT NULL` is not tidying. `teams.org_id` is nullable and 10 of
# 44 teams have no org, while `reminders.org_id` is NOT NULL with a foreign key
# to `staging.organisations`. Without this predicate an orphan team's task is a
# `NotNullViolation` — one that costs only its own row now, but there is no
# reason to write a row we know the constraint will refuse.
_TASK_SCAN = """
SELECT t.id AS entity_id, t.task_id AS task_ref, t.title, tm.org_id,
       COALESCE(a.user_id, t.created_by_user_id) AS recipient
FROM tasks t
JOIN teams tm ON tm.team_id = t.team_id
LEFT JOIN LATERAL unnest(t.assignee_user_ids) AS a(user_id) ON TRUE
WHERE t.status <> 'done'
  AND t.archived_at IS NULL
  AND tm.org_id IS NOT NULL
  AND t.due_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
  AND NOT EXISTS (
      SELECT 1 FROM staging.reminders r
      WHERE r.entity_id = t.id
        AND r.reminder_type = 'task_due'
        AND r.created_at > NOW() - INTERVAL '1 day'
  )
"""


def _as_uuid(value, column: str):
    """The value that goes into a uuid column, or a loud failure naming it.

    THIS IS THE TRIPWIRE FOR THE DEFECT THAT WAS HERE. `entity_id` is
    `UUID NOT NULL` and the old block four bound `tasks.task_id` — the TEXT
    `task_<hex12>` form — straight into it. asyncpg would have raised too, but
    from inside the driver, with a message about parameter $4 that says nothing
    about which scan block or which column is wrong.

    Raising here instead means a future block that reaches for the wrong
    identifier fails with the column named, before the statement is sent, and
    fails in the per-row `try` that costs one row rather than the tick.
    """
    if isinstance(value, _uuid.UUID):
        return value
    if value is None:
        raise ValueError(f"{column} is NOT NULL and this row has no value for it")
    try:
        return _uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ValueError(
            f"{column} is a uuid column and this row offers {value!r}, which is "
            f"not one — a text id (tasks.task_id is 'task_<hex12>') belongs in "
            f"the message, never in this column"
        ) from None


def _as_text(value):
    """The value that goes into a text column. `None` stays `None`.

    `recipient_user_id` is TEXT while `approval_requests.current_step_approver_id`
    is UUID; asyncpg refuses a `uuid.UUID` for a text parameter rather than
    stringifying it. The approval scan already casts in SQL — this catches the
    next scan whose author does not.
    """
    if value is None:
        return None
    if isinstance(value, _uuid.UUID):
        return str(value)
    return str(value)


def _invoice_row(row) -> tuple:
    return (
        _as_uuid(row["org_id"], "reminders.org_id"),
        "invoice_overdue", "ganit_invoices",
        _as_uuid(row["entity_id"], "reminders.entity_id"),
        _as_text(row["recipient"]),
        f"Invoice {row['invoice_number']} is overdue. Balance: ₹{row['balance_due']}",
    )


def _follow_up_row(row) -> tuple:
    subject = row["subject"]
    return (
        _as_uuid(row["org_id"], "reminders.org_id"),
        "follow_up_due", "graha_follow_ups",
        _as_uuid(row["entity_id"], "reminders.entity_id"),
        _as_text(row["recipient"]),
        f"Follow-up due: {subject[:100] if subject else 'Check your CRM follow-ups'}",
    )


def _approval_row(row) -> tuple:
    return (
        _as_uuid(row["org_id"], "reminders.org_id"),
        "approval_pending", "approval_requests",
        _as_uuid(row["entity_id"], "reminders.entity_id"),
        _as_text(row["recipient"]),
        f"Approval pending: {row['title']}",
    )


def _task_row(row) -> tuple:
    """`entity_id` is `tasks.id` (uuid). `tasks.task_id` is TEXT and stays out.

    The text id is genuinely useful — it is what a URL and a support
    conversation use — but it belongs in the message or the log, not in a uuid
    column. This mapper is where that rule is enforced for tasks, and it is a
    pure function of a row, so a test can hand it `{"entity_id":
    "task_a873466d6bea", …}` and watch it refuse without a database anywhere
    near it.
    """
    return (
        _as_uuid(row["org_id"], "reminders.org_id"),
        "task_due", "tasks",
        _as_uuid(row["entity_id"], "reminders.entity_id"),
        _as_text(row["recipient"]),
        f"Task due soon: {row['title']}",
    )


#: (result key, scan SQL, row → INSERT args). The result keys are the ones the
#: old return value used, because `routers/scheduler.py` logs the dict and a
#: renamed key would quietly empty an operator's log line.
_SCAN_BLOCKS = (
    ("invoices",   _INVOICE_SCAN,   _invoice_row),
    ("follow_ups", _FOLLOW_UP_SCAN, _follow_up_row),
    ("approvals",  _APPROVAL_SCAN,  _approval_row),
    ("tasks",      _TASK_SCAN,      _task_row),
)


async def _run_scan_block(pool, key: str, scan_sql: str, to_args) -> tuple[int, list]:
    """Run one block. Returns (rows written, per-row errors).

    The per-row `try` is the second half of the independence guarantee. Every
    row of a block shares one org's constraints but not one org's data: a single
    `staging.organisations` row missing behind a `teams.org_id` is a foreign-key
    violation for that task and a perfectly good reminder for the other 253.
    Since there is no transaction here — `pool.execute` commits each statement —
    stopping on the first bad row would only mean the rows before it were kept
    and the rows after it were not, which is the least defensible of the
    available behaviours.
    """
    rows = await pool.fetch(scan_sql)
    written, errors = 0, []
    for row in rows:
        try:
            await pool.execute(_INSERT_REMINDER, *to_args(row))
            written += 1
        except Exception as exc:
            # Bounded on purpose: 200 overdue invoices could otherwise put 200
            # tracebacks in one log line and 200 strings in the response body.
            errors.append(f"{type(exc).__name__}: {exc}")
            if len(errors) <= 3:
                log.exception("Reminder scan %r: a row could not be written", key)
    return written, errors


async def scan_and_create_reminders():
    """Scan entities for upcoming/overdue items and create reminder records.

    NEVER RAISES, AND THAT IS THE POINT. See THE SCAN above: the caller runs
    this and `process_pending_reminders` as two bare awaits, so an exception out
    of here is not "the scan failed", it is "nothing is ever sent again".

    Returns the four counts under the keys the caller already logs, plus
    `"errors"` — present only when something failed, mapping the block key to
    what went wrong. The counts are rows WRITTEN, not rows found; the old code
    returned `len(fetched)` and would have reported 241 successes for 241
    attempts whatever the database said about them.

    `"errors"` is deliberately not an exception and deliberately not silence.
    `routers/scheduler.py` is owned elsewhere and its rule is that a handler
    "either does the work or answers with a status code that turns the caller
    red" — this dict is what that endpoint needs to raise on, AFTER
    `process_pending_reminders` has had its turn. Until it does, a failed block
    is visible as a `log.exception` and in the 200 body, and the send half still
    runs. That order is the whole trade: an operator noticing a day late beats
    reminders that are never delivered.
    """
    pool = await get_pool()

    result: dict = {}
    errors: dict = {}

    for key, scan_sql, to_args in _SCAN_BLOCKS:
        try:
            written, row_errors = await _run_scan_block(pool, key, scan_sql, to_args)
            result[key] = written
            if row_errors:
                errors[key] = (
                    f"{len(row_errors)} row(s) failed; first: {row_errors[0]}"
                )
        except Exception as exc:
            # The block's own fetch, or something outside any single row. Block
            # four raised `UndefinedTableError` here for the whole life of this
            # file; the other three must not notice.
            result[key] = 0
            errors[key] = f"{type(exc).__name__}: {exc}"
            log.exception("Reminder scan block %r failed entirely", key)

    if errors:
        result["errors"] = errors
    return result


async def process_pending_reminders():
    """Send all pending reminders that are due.

    Runs from `POST /api/internal/cron/reminders` every 15 minutes. There is no
    request underneath it, so `outbound`'s org ContextVar is unset and every
    email and every push this function sent used to be recorded with a NULL
    org — see the org_scope block below. `staging.reminders.org_id` is NOT NULL
    (migration 049), so the org is on every row this loop reads and nothing here
    has to guess one.
    """
    pool = await get_pool()
    pending = await pool.fetch(
        "SELECT r.*, u.email, u.mobile_number, u.full_name "
        "FROM staging.reminders r "
        "LEFT JOIN users u ON u.user_id = r.recipient_user_id "
        "WHERE r.status = 'pending' AND r.remind_at <= NOW() "
        "ORDER BY r.remind_at "
        "LIMIT 100"
    )

    sent = 0
    for rem in pending:
        try:
            # WHOSE SEND THIS IS. `send_email(to, subject, html)` has no org
            # parameter and no caller could give it one, so the org travels in
            # the ContextVar `outbound.begin()` captures — and a cron has no
            # request to set it. Every org-scoped read of `staging.outbound_log`
            # is `WHERE org_id = $1::uuid` (routers/billing.py), so these rows
            # were invisible to every org, forever: the scheduler was the one
            # sender the outbound screen could never show.
            #
            # PER REMINDER, AND AS A CONTEXT MANAGER, because this loop crosses
            # orgs — a `LIMIT 100` batch is whatever came due, from whichever
            # tenants. A bare `set_org()` would leave the previous reminder's
            # org in place for the next one, and a confidently wrong org on a
            # money-adjacent log is worse than the NULL it replaces. `org_scope`
            # restores what it found on the way out, so an org can only ever
            # attribute its own iteration.
            #
            # NO user_id. 098 reserves that column for who CAUSED the send and
            # says NULL is the right value for "the scheduler that fires a
            # reminder". `recipient_user_id` is who it is FOR, which is already
            # recorded as the recipient; putting them in the causer column would
            # blame them for a timer they never set.
            # ── PREFERENCES AND QUIET HOURS, WHICH THIS PATH NEVER ASKED ──
            #
            # `prefs_allow` gates `create_notification`, `send_push` and the
            # task-reminder dispatch. This loop — the one that produced every
            # reminder in the table — called `send_email` and `send_expo_push`
            # DIRECTLY and asked nothing. Nobody noticed because
            # OUTBOUND_MODE=dry suppressed all 1,562 of them anyway, which is
            # the worst way for a gate to be missing: invisible until the day
            # the switch is flipped, and then loud.
            #
            # `kind="reminder"`, not `rem["reminder_type"]`, for the reason the
            # `purpose` argument below already gives: the types are
            # user-visible strings and an unmapped one falls back to a default,
            # so one word the preference table knows beats a dozen it might not.
            # ── THE IN-APP COPY, WHICH THIS LOOP NEVER WROTE ──────────
            #
            # MEASURED 2026-08-23: 1,150 `follow_up_due` reminders exist, 663 of
            # them sent, and `public.notifications` holds NOT ONE row of any
            # follow-up kind. This loop had exactly two channels, email and
            # push, so a person who works inside the product — no mail open, no
            # phone to hand — was never told a CRM follow-up was due. That is
            # the whole of "follow-up notifications don't arrive": they arrive,
            # just never where the person is looking.
            #
            # QUIET HOURS DO NOT APPLY TO THIS CHANNEL, and that is deliberate
            # rather than an omission. An in-app notification has no queue
            # behind it: holding one does not defer it to the morning, it throws
            # it away. The email below IS queued (`status='pending'` is the
            # queue) which is why quiet hours legitimately hold that one. Niyam's
            # send layer draws the same line for the same reason.
            #
            # A preference switched OFF is still final — `prefs_verdict` with
            # `quiet_hours_apply=False` answers "does this person want reminders
            # at all", and nothing here overrides a no.
            if rem["recipient_user_id"]:
                try:
                    in_app, _why_app = await prefs_verdict(
                        pool, rem["recipient_user_id"], "reminder",
                        is_mine=False, quiet_hours_apply=False)
                    if in_app:
                        from utils import create_notification
                        await create_notification(
                            pool, rem["recipient_user_id"], "reminder",
                            _subject_for_type(rem["reminder_type"]),
                            rem["message"] or "",
                            url=_url_for_type(rem["reminder_type"]),
                        )
                except Exception as exc:
                    # Its own try: the email below is a separate promise and
                    # must not be cancelled by a failure to draw a bell.
                    log.warning("in-app reminder failed for %s: %s", rem["id"], exc)

            allowed, why = await prefs_verdict(
                pool, rem["recipient_user_id"], "reminder",
                is_mine=False, quiet_hours_apply=True)
            if not allowed:
                # DEFERRED, NOT DROPPED — and unlike the in-app case, deferring
                # is real here: `status='pending'` IS a queue, so the next run
                # picks it up once the window has passed. (An in-app
                # notification has no queue behind it, which is why Niyam's send
                # layer does not apply quiet hours to that channel at all.)
                #
                # A preference switched OFF is final and must not be retried for
                # ever, so it takes a terminal status; quiet hours are a clock
                # and stay pending.
                if "quiet hours" in why:
                    log.info("Reminder %s held: %s", rem["id"], why)
                    continue
                await pool.execute(
                    "UPDATE staging.reminders SET status='suppressed', "
                    "sent_at=NOW() WHERE id=$1", rem["id"])
                log.info("Reminder %s suppressed: %s", rem["id"], why)
                continue

            with outbound.org_scope(rem["org_id"]):
                if rem["channel"] == "email" and rem["email"]:
                    from email_service import send_email
                    send_email(
                        to_email=rem["email"],
                        subject=_subject_for_type(rem["reminder_type"]),
                        html_content=_build_reminder_html(rem),
                        # NOT `rem["reminder_type"]`, tempting as that is: the
                        # types are user-visible strings and an unmapped one
                        # would silently fall back to FROM_EMAIL. One word that
                        # `_BUCKET` knows beats a dozen that it might not.
                        purpose="reminder",
                        ref=f"reminder:{rem['id']}",
                    )
                elif rem["channel"] == "push" and rem["recipient_user_id"]:
                    from services.expo_push_service import send_expo_push
                    await send_expo_push(
                        pool, user_id=rem["recipient_user_id"],
                        title=_subject_for_type(rem["reminder_type"]),
                        body=rem["message"] or "",
                    )

            # `sent` ONLY IF SOMETHING COULD HAVE LEFT. `send_email` returns
            # True when the outbound gate suppressed the message — deliberately,
            # because the operator asked for nothing to leave the building — so
            # its return value cannot distinguish the two. Reading the gate
            # directly can.
            #
            # This is the exact disease the codebase documents: 1,562 reminders
            # recorded `status='sent'` while all 1,562 matching `outbound_log`
            # rows said `suppressed`. Measured 2026-08-16, and it is a perfect
            # 1:1. Nothing this product has ever called a reminder has reached
            # anybody.
            #
            # `is_suppressed(org)`, not `DRY_RUN`: the per-org gate
            # (OUTBOUND_SUPPRESSED_ORGS) refuses a listed org's sends in a
            # LIVE process, where DRY_RUN reads False — the mode alone would
            # re-tell the 1,562-row lie one switch over. The org passed is the
            # SAME one the send above ran under (`org_scope(rem["org_id"])`),
            # so this asks the question `begin()` just answered.
            final = "suppressed" if outbound.is_suppressed(rem["org_id"]) else "sent"
            await pool.execute(
                "UPDATE staging.reminders SET status=$2, sent_at=NOW() WHERE id=$1",
                rem["id"], final,
            )
            sent += 1
        except Exception as e:
            log.warning("Reminder %s failed: %s", rem["id"], e)
            await pool.execute(
                "UPDATE staging.reminders SET status='failed', message=$2 WHERE id=$1",
                rem["id"], f"Error: {str(e)[:200]}",
            )

    return {"processed": len(pending), "sent": sent}



def _url_for_type(reminder_type: str) -> str:
    """Where the bell takes you.

    A notification a person cannot act on is a nag. Each of the three kinds has
    exactly one screen that answers it, and an unknown kind goes to the inbox
    rather than to a guess — `/graha?tab=follow%20ups` for a type that is not a
    follow-up would be a wrong answer delivered confidently.
    """
    return {
        "follow_up_due":    "/graha",
        "invoice_overdue":  "/ganit",
        "task_due":         "/tasks",
    }.get(reminder_type, "/inbox")


def _subject_for_type(reminder_type: str) -> str:
    return {
        "invoice_overdue": "Invoice overdue — action needed",
        "follow_up_due": "CRM follow-up due today",
        "approval_pending": "Approval waiting for your review",
        "task_due": "Task due soon",
        "meeting_upcoming": "Upcoming meeting reminder",
        "quote_expiry": "Quote expiring soon",
    }.get(reminder_type, "Kartavaya reminder")


# The Devanagari cue for each reminder kind. Fixed decorative glyphs, so
# `--font-hindi`, never `--font-indic` — under an EN+GU preference that resolves
# to Noto Sans Gujarati, which has zero Devanagari coverage.
_HINDI_FOR_TYPE = {
    "invoice_overdue":  "बकाया चालान",
    "follow_up_due":    "अनुवर्तन",
    "approval_pending": "अनुमोदन प्रतीक्षित",
    "task_due":         "समयसीमा",
    "meeting_upcoming": "आगामी बैठक",
    "quote_expiry":     "प्रस्ताव समाप्ति",
}


def _build_reminder_html(rem: dict) -> str:
    """Render a scheduled reminder on the shared editorial email shell.

    Was a bare <div> with its own teal (#1AB8B0, in no token file), the wrong
    brand spelling ("Kartavya"), and a link to app.kartavya.co — a domain the
    owner has corrected repeatedly and which is not where this product lives.

    It also interpolated `full_name` and the reminder `message` unescaped. Both
    are user-controlled: `message` is written by whoever created the reminder,
    and a reminder can be addressed to any user in the org.
    """
    from email_service import _base, _body_text, _cta_row, FRONTEND_URL
    from html import escape as _h

    name = _h(str(rem.get("full_name") or "there").split()[0])
    rtype = rem.get("reminder_type") or ""
    title = _subject_for_type(rtype)
    message = rem.get("message") or "You have a pending item that needs your attention."

    body = (
        _body_text(f"Hi <strong>{name}</strong>, this is a scheduled reminder.")
        + _body_text(_h(str(message)).replace("\n", "<br>"))
        + _cta_row(f"{FRONTEND_URL}/dashboard", "Open Kartavaya", "primary")
    )
    return _base(
        preheader=title,
        kicker="REMINDER · स्मरण",
        headline=title,
        sanskrit=_HINDI_FOR_TYPE.get(rtype, ""),
        lede="",
        body_rows=body,
    )
