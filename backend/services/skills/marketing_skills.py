"""marketing_skills — the hop that was missing.

`POST /api/internal/cron/marketing` (routers/scheduler.py:141) has, since it was
written, done this:

    try:
        from services.skills.marketing_skills import (
            process_scheduled_campaigns, process_sequence_steps)
        ...
    except ImportError:
        results["error"] = "marketing_skills not available yet"

THIS MODULE DID NOT EXIST ANYWHERE IN THE TREE. So every tick took the except
branch, returned HTTP 200 with that sentence in the body, and advanced nothing.
That is the whole of the reported defect: a firm builds a three-step drip,
activates it, enrols twenty contacts, the toast says "20 contacts enrolled", the
table shows each person on step 1 with a next-message date — and the thing that
was supposed to read that date was an import error dressed as a result.

Measured on the live database (project toacecaewujfxjfrjwco, schema `staging`,
2026-08-05) before this file was added: 20 sequences, 60 steps, and 0 rows in
`prachar_sequence_logs`. Not "few". None. No sequence step has ever been sent in
the product's life.

── WHY THE FUNCTION NAMES AND SIGNATURES ARE NOT NEGOTIABLE ─────────────────

`scheduler.py` is owned elsewhere and is not edited by this change. It imports
these two names and calls each with the pool positionally. That import IS the
wire; matching it exactly is what makes this a new file rather than a change to
someone else's. Renaming either function silently restores the ImportError and
the endpoint goes back to reporting success while doing nothing — which is
precisely the failure mode this module exists to end, so it would be a
particularly bleak way to reintroduce it.

── WHAT A TICK MUST NOT DO ──────────────────────────────────────────────────

Cost a fortune, and mail everyone at once. `/cron/marketing` is documented as
every 5 minutes. Both functions are therefore bounded per tick (`_MAX_*` below)
and both take the OLDEST due work first, so a backlog drains in order instead of
starving whichever rows sort last. Nothing here retries a row inside the tick:
the next tick is the retry, five minutes later, and a row that keeps failing
keeps its due date rather than accumulating attempts.
"""

import logging

from services.skills.action import execute_step, send_campaign

log = logging.getLogger(__name__)

#: Enrolments advanced per tick. At 5-minute ticks that is up to 24,000 steps an
#: hour across all orgs, which is far more than this product's send volume, while
#: still bounding one tick's runtime and one tick's SES bill if a large sequence
#: comes due all at once.
_MAX_STEPS_PER_TICK = 200

#: Campaigns started per tick. Deliberately much smaller: `send_campaign` mails
#: up to 5,000 recipients in one call, so this is a limit on FAN-OUT, not on
#: rows. Five campaigns is already 25,000 messages.
_MAX_CAMPAIGNS_PER_TICK = 5


async def process_sequence_steps(pool) -> dict:
    """Advance every drip enrolment whose next message is due.

    Returns a summary keyed by outcome, so the cron log line says what actually
    happened rather than a single number that cannot distinguish "sent 40" from
    "skipped 40".

    ── WHICH ROWS ARE DUE ───────────────────────────────────────────────────

    The `s.status = 'active'` join condition is doing real work and is not
    defensive tidiness. `enroll_contacts` does not check the sequence's status
    at all — it looks the sequence up by id and org and enrols regardless — so
    the live table can hold 'active' enrolments against a sequence that is
    'draft', 'paused' or 'archived'. Without this predicate the first tick after
    this module landed would have mailed the contacts of every draft sequence in
    the product simultaneously. On the live database that is 5 draft sequences
    and 5 paused ones against 10 active.

    `execute_step` re-checks the same thing on the row it locks. Both, because
    this query decides what to spend a tick on and that one decides what to send,
    and a sequence paused in between is the case where the two answers differ.
    """
    due = await pool.fetch(
        """
        SELECT e.id
        FROM staging.prachar_sequence_enrollments e
        JOIN staging.prachar_sequences s ON s.id = e.sequence_id
        WHERE e.status = 'active'
          AND s.status = 'active'
          AND e.next_step_at IS NOT NULL
          AND e.next_step_at <= NOW()
        ORDER BY e.next_step_at
        LIMIT $1
        """,
        _MAX_STEPS_PER_TICK,
    )

    summary: dict = {"due": len(due)}
    for row in due:
        enrollment_id = str(row["id"])
        try:
            result = await execute_step(pool, enrollment_id)
            status = (result or {}).get("status", "unknown")
        except Exception:                                   # noqa: BLE001
            # One bad enrolment must not cost the other 199 their tick. Logged
            # with the id, because that is the only thing that makes this
            # diagnosable from a Railway log that rotates per deployment.
            log.exception("Sequence step failed for enrolment %s", enrollment_id)
            status = "error"
        summary[status] = summary.get(status, 0) + 1

    if len(due) == _MAX_STEPS_PER_TICK:
        # A full batch means there is probably more waiting. Said out loud
        # because the alternative is a backlog that drains silently at 200 per
        # five minutes and nobody knows why yesterday's step went out today.
        log.warning("Cron marketing: hit the %d-enrolment ceiling; more are due "
                    "and will go on the next tick.", _MAX_STEPS_PER_TICK)

    log.info("Cron marketing sequences: %s", summary)
    return summary


async def process_scheduled_campaigns(pool) -> dict:
    """Send every campaign whose scheduled time has arrived.

    ── ONLY `status = 'scheduled'`, AND WHY THAT MATTERS MORE THAN IT LOOKS ──

    A draft is not a decision to send. `prachar_campaigns.status` CHECKs against
    ('draft','scheduled','sending','sent','paused','cancelled') and the live
    table holds 89 drafts. Selecting on `scheduled_at <= now()` regardless of
    status — the obvious shape, and the one a "fix the calendar" change would
    reach for — would mail all 89 on the first tick, to audiences their authors
    never approved.

    So the gate is the explicit state, and reaching it is an explicit act:
    `POST /campaigns/{id}/schedule`. That endpoint had to be added alongside this
    function, because NOTHING in the product wrote 'scheduled' — `create_campaign`
    and `update_campaign` both store `scheduled_at` and leave the status at
    'draft'. Measured on the live database: 0 campaigns in 'scheduled', and 0
    with a `scheduled_at` at all. The calendar screen has therefore never had
    anything to place on it, and this function would have found nothing to do
    even if it had existed.
    """
    due = await pool.fetch(
        """
        SELECT id FROM staging.prachar_campaigns
        WHERE status = 'scheduled'
          AND is_active = TRUE
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= NOW()
        ORDER BY scheduled_at
        LIMIT $1
        """,
        _MAX_CAMPAIGNS_PER_TICK,
    )

    summary: dict = {"due": len(due), "sent": 0, "failed": 0, "recipients": 0}
    for row in due:
        campaign_id = str(row["id"])
        try:
            result = await send_campaign(pool, campaign_id) or {}
        except Exception:                                   # noqa: BLE001
            log.exception("Scheduled campaign %s failed", campaign_id)
            summary["failed"] += 1
            continue
        if result.get("error"):
            log.warning("Scheduled campaign %s not sent: %s", campaign_id, result["error"])
            summary["failed"] += 1
            continue
        summary["sent"] += 1
        summary["recipients"] += int(result.get("sent") or 0)

    log.info("Cron marketing campaigns: %s", summary)
    return summary
