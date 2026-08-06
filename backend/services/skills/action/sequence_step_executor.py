"""Send one step of one drip sequence, and move the enrolment on.

── WHAT THIS FILE USED TO DO, WHICH WAS NOTHING ─────────────────────────────

Every column it asked for in its central query was invented. Checked against the
live catalog (`information_schema`, project toacecaewujfxjfrjwco, schema
`staging`) rather than against the migration:

    step_number   the column is `step_order`      (027)
    body          the columns are `body_html` / `body_text`
    delay_hours   the column is `delay_days`
    updated_at    `prachar_sequence_enrollments` HAS NO SUCH COLUMN

So `SELECT id, step_number, channel, subject, body, delay_hours FROM
staging.prachar_sequence_steps` raised UndefinedColumnError before a single row
was read, and both `UPDATE … SET status = …, updated_at = NOW()` statements
would have raised it too. Four of the five names are the same class of defect
recorded in `tests/test_prachar_audience.py` — Python naming a column Postgres
does not have — which is now the sixth occurrence in this repo.

It did not matter, because nothing called this function. `/cron/marketing`
(routers/scheduler.py:141) imports `services.skills.marketing_skills`, and that
module did not exist anywhere in the tree, so the endpoint took its `except
ImportError` branch and answered `{"error": "marketing_skills not available
yet"}` with HTTP 200 on every tick. The dispatcher's `execute_sequence_step`
entry pointed here too, but no skill template in the live database references
it. Measured on 2026-08-05: 20 sequences, 60 steps, 0 rows in
`prachar_sequence_logs`. Nothing has ever been sent by this path.

That is the shape the whole finding has. Enrolment worked — it wrote the row,
the toast counted it, the table drew it — and there was no advance behind it at
all. `services/skills/marketing_skills.py` is the hop that was missing; this
file is what it calls.

── THE ORG THE ENROLMENT DOES NOT KNOW ──────────────────────────────────────

`prachar_sequence_enrollments.org_id` is nullable and `enroll_contacts` never
wrote it, so every existing row holds NULL. The old query read `se.org_id` and
handed it to the suppression check, which made that check
`WHERE org_id = NULL AND email = $2` — a predicate that matches nothing, ever.
An unsubscribed contact would have been mailed anyway.

The org is taken from `prachar_sequences.org_id` instead, which is `NOT NULL`
and is the row the tenancy actually hangs off. `enroll_contacts` now populates
the column as well, but this query does not depend on that having happened,
because the rows already in the table were written before it did.
"""

import logging
import os

from services.prachar_sequencing import (
    is_sendable_channel, next_send_at, plan_due_step, plan_following_step,
)
from services.skills.timeutil import utc_now
from email_service import send_email

log = logging.getLogger(__name__)


async def execute_step(pool, enrollment_id: str) -> dict:
    """Send whatever step this enrolment is waiting for, then schedule the next.

    Returns {status, next_step_at}. `status` is one of:

        sent          a message went to the provider (or to the dry-run gate)
        logged        a non-email step was recorded and skipped — see below
        completed     there was no step left; the enrolment is finished
        unsubscribed  the contact is on this org's suppression list
        skipped       the enrolment is not active, or has no contact/email
        failed        the send raised

    `logged` versus `sent` matters to whoever reads the cron summary: a sequence
    of four call_task steps reporting four sends would be claiming outbound
    activity that never happened, which is the exact species of lie this whole
    module was full of.
    """
    enrollment = await pool.fetchrow(
        """
        SELECT se.id, se.sequence_id, se.contact_id, se.current_step, se.status,
               s.org_id, s.name AS sequence_name, s.status AS sequence_status,
               o.name AS org_name,
               c.email, c.name AS contact_name
        FROM staging.prachar_sequence_enrollments se
        JOIN staging.prachar_sequences s ON s.id = se.sequence_id
        JOIN staging.organisations o ON o.id = s.org_id
        JOIN staging.graha_contacts c ON c.id = se.contact_id
        WHERE se.id = $1::uuid AND se.status = 'active'
        """,
        enrollment_id,
    )

    if not enrollment:
        return {"status": "skipped", "reason": "enrollment_not_active", "next_step_at": None}

    # A sequence that is not active must not send, and the enrolment's own status
    # is not enough to know that. `pause_sequence` does pause the enrolments with
    # it, but `enroll_contacts` never checks the sequence's status at all — you
    # can enrol into a DRAFT or an ARCHIVED sequence and the row is written
    # 'active' with a due date. Without this the first cron tick after the
    # missing hop was restored would have mailed every one of those.
    if enrollment["sequence_status"] != "active":
        return {"status": "skipped", "reason": f"sequence_{enrollment['sequence_status']}",
                "next_step_at": None}

    org_id = str(enrollment["org_id"])

    steps = await pool.fetch(
        """
        SELECT id, step_order, channel, delay_days, subject, body_html, body_text
        FROM staging.prachar_sequence_steps
        WHERE sequence_id = $1::uuid
        ORDER BY step_order
        """,
        enrollment["sequence_id"],
    )
    orders = [r["step_order"] for r in steps]
    by_order = {r["step_order"]: r for r in steps}

    due_order = plan_due_step(orders, enrollment["current_step"])
    if due_order is None:
        # Nothing left — or nothing ever. Both are 'completed': a sequence with
        # no steps cannot send anything to anybody, and leaving the enrolment
        # 'active' with a due date in the past would make it a row this function
        # is handed again on every tick for the rest of time.
        await pool.execute(
            "UPDATE staging.prachar_sequence_enrollments "
            "SET status = 'completed', completed_at = NOW(), next_step_at = NULL "
            "WHERE id = $1::uuid",
            enrollment_id,
        )
        return {"status": "completed", "next_step_at": None}

    step = by_order[due_order]

    # The suppression check, with an org that is not NULL. Compared lowercased on
    # both sides: `add_unsubscribe` stores `email.lower().strip()`, but rows
    # written before it did that — and any row from an import — can hold mixed
    # case, and a case-sensitive `=` there is a suppression list that silently
    # does not suppress.
    contact_email = (enrollment["email"] or "").strip()
    if contact_email:
        unsub = await pool.fetchval(
            "SELECT 1 FROM staging.prachar_unsubscribes "
            "WHERE org_id = $1::uuid AND lower(email) = $2",
            org_id, contact_email.lower(),
        )
        if unsub:
            await pool.execute(
                "UPDATE staging.prachar_sequence_enrollments "
                "SET status = 'unsubscribed', completed_at = NOW(), next_step_at = NULL "
                "WHERE id = $1::uuid",
                enrollment_id,
            )
            return {"status": "unsubscribed", "next_step_at": None}

    following = plan_following_step(orders, due_order)
    when = (next_send_at(utc_now(), by_order[following]["delay_days"])
            if following is not None else None)

    outcome = "logged"
    if is_sendable_channel(step["channel"]):
        if not contact_email:
            # No address and an email step. Advancing past it is the only
            # non-destructive answer: refusing would park the enrolment here
            # forever, and there is nothing to retry — the contact has no email
            # and a later tick will not give them one.
            log.info("Sequence '%s': enrolment %s has no email address; step %s skipped",
                     enrollment["sequence_name"], enrollment_id, due_order)
        else:
            subject, body = _render(step, enrollment, org_id)
            try:
                # NOT awaited. `send_email` is sync — it hands the message to a
                # `threading.Thread` and returns bool. Awaiting it raised
                # TypeError AFTER that thread had started, so the mail went out
                # and the step was recorded as failed; the enrolment then never
                # advanced and the SAME step was re-sent on every subsequent
                # pass. See the identical note in `campaign_sender.py`.
                send_email(contact_email, subject, body,
                           purpose="prachar_sequence",
                           ref=f"sequence:{enrollment['sequence_id']}:step:{due_order}")
                outcome = "sent"
            except Exception:
                log.exception("Sequence email failed for enrolment %s step %s",
                              enrollment_id, due_order)
                # Deliberately NOT advanced. A raise here is the transport
                # refusing, which is the one failure worth retrying on the next
                # tick — unlike a missing address, which will never resolve.
                # `next_step_at` is left where it is, so this row is due again.
                return {"status": "failed", "next_step_at": None}

    # The log row and the advance in ONE transaction. Apart, a crash between them
    # either re-sends the step (log written, enrolment not moved) or loses the
    # record of a message that did go out. The send itself is outside, because a
    # provider call cannot be rolled back and holding a connection across it
    # would tie a pool slot to SES's latency.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO staging.prachar_sequence_logs
                    (enrollment_id, step_id, channel, status, sent_at, org_id)
                VALUES ($1::uuid, $2::uuid, $3, $4, NOW(), $5::uuid)
                """,
                enrollment_id, str(step["id"]), step["channel"] or "email",
                # `outcome`, NOT the literal 'sent'. Two paths reach this INSERT
                # having sent nothing at all — a step on a non-sendable channel,
                # and a contact with no email address — and both were recorded
                # as sent. `routers/prachar.py` then counts these rows as
                # `total_sent` on the sequence stats screen, so a sequence
                # aimed at contacts with no addresses reported perfect delivery.
                #
                # 'sent' now means a message was handed to the transport.
                # 'logged' means the step was passed over and the enrolment
                # advanced. The table is empty, so nothing is being reinterpreted.
                outcome,
                org_id,
            )
            if following is None:
                await conn.execute(
                    "UPDATE staging.prachar_sequence_enrollments "
                    "SET status = 'completed', completed_at = NOW(), "
                    "    current_step = $2, next_step_at = NULL "
                    "WHERE id = $1::uuid",
                    enrollment_id, due_order,
                )
            else:
                await conn.execute(
                    "UPDATE staging.prachar_sequence_enrollments "
                    "SET current_step = $2, next_step_at = $3 "
                    "WHERE id = $1::uuid",
                    enrollment_id, following, when,
                )

    return {"status": outcome, "next_step_at": when.isoformat() if when else None}


def _render(step, enrollment, org_id: str) -> tuple[str, str]:
    """Subject and body for one step, with the opt-out attached.

    `{{name}}` is escaped in the BODY and not in the SUBJECT, which is the same
    split `campaign_sender` makes and for the same two reasons: a contact named
    `<img src=x onerror=…>` had their own markup rendered live inside the mail,
    and an entity in a subject line renders literally as "&amp;" in the inbox.

    `body_text` is the fallback when `body_html` is empty. Both are nullable and
    the step form only ever fills `body_html`, so this is for steps written by
    an import or by a future plain-text composer. It is escaped on the way in —
    text promoted into an HTML slot without escaping is markup injection with
    extra steps.
    """
    import html as _html

    from services import prachar_unsubscribe as unsub

    name = enrollment["contact_name"] or ""
    subject = (step["subject"] or "").replace("{{name}}", name)

    body = step["body_html"] or ""
    if not body and step["body_text"]:
        body = f"<p>{_html.escape(step['body_text']).replace(chr(10), '<br>')}</p>"
    body = body.replace("{{name}}", _html.escape(name))

    # THE OPT-OUT. Attached here rather than at the call site so that a step
    # cannot be sent without it — see `services/prachar_unsubscribe.py` for why
    # its absence was a legal exposure rather than a missing feature.
    token = unsub.mint(org_id, enrollment["email"] or "")
    body = unsub.append_footer(
        body,
        unsub.link(os.getenv("BACKEND_URL", ""), token),
        # The ORG's name, not the sequence's. "You are receiving this because you
        # are a contact of Onboarding drip" names an internal artefact at a
        # stranger; the notice has to identify the sender, which is the firm.
        enrollment["org_name"] or "",
    )
    return subject, body
