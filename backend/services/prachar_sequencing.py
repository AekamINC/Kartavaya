"""prachar_sequencing — what a drip sequence does next, with nothing plugged in.

Every function here is pure: no pool, no network, no clock of its own. That is
deliberate and it is the lesson of `routers/messaging.py:30-41` applied to this
module. The backend pool is mocked in the test suite, and a mocked cursor
resolves any table name and any column name you hand it — so an HTTP test can be
green while every one of these decisions is wrong against a real database. The
decisions therefore live here, where a test can call them with plain integers,
and the database work in `skills/action/sequence_step_executor.py` is reduced to
"ask for the right rows and write back what this module said".

── WHAT `current_step` MEANS, ONCE ──────────────────────────────────────────

It is THE `step_order` THIS CONTACT IS WAITING FOR — the number of the message
about to be sent, not the number of the last one delivered.

That reading is not a preference; it is the only one consistent with the two
things already shipped around it. `enroll_contacts` (routers/prachar.py) writes
`current_step = 1` together with `next_step_at = NOW() + <step 1's delay>`, and
`SequencesTab.jsx` renders that same column beside "Next message". A contact
enrolled a minute ago reads "Step 1 · in 1 day", which is true under this
meaning and false under the other one.

The executor that shipped before this module read it the other way. It asked for
`step_number = current_step + 1`, so a freshly enrolled contact sitting at 1
would have been sent STEP 2 and step 1 would never have gone out to anyone. That
never actually happened, because the same query named three columns that do not
exist and raised before it could — but the off-by-one was real, and it is the
reason this file states the meaning instead of assuming it.

── WHY NOT `current_step + 1` EVEN WITH THE MEANING FIXED ───────────────────

`step_order` is `INT NOT NULL` with `UNIQUE(sequence_id, step_order)` and nothing
more (migration 027). It is not required to start at 1, and it is not required to
be contiguous — `DELETE /sequences/{id}/steps/{order}` removes one from the
middle and leaves a hole, and `add_step` takes whatever position the form sends.
So a three-step sequence can genuinely be 1, 2, 5, and after someone removes the
second it is 1, 5.

Arithmetic on the step number strands the enrolment in that hole forever: at
`current_step = 2` in a 1/5 sequence, `+1` asks for step 3, finds nothing, and
the honest-looking conclusion is "the sequence is finished". The contact stops
mid-drip and the screen says completed.

So the question is never "what is the next number" but "what is the next step
that EXISTS", and every function below takes the sequence's actual orders.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable

#: What `delay_days` falls back to when the column is NULL.
#:
#: The DDL says `delay_days INT DEFAULT 1`, nullable, so a row written by
#: anything that names its columns explicitly can hold NULL. One day matches
#: what the schema would have chosen; the alternative — treating NULL as 0 —
#: turns a step with a missing delay into an immediate second email, which is
#: the failure a drip sequence exists to avoid.
DEFAULT_DELAY_DAYS = 1


def _orders(step_orders: Iterable) -> list[int]:
    """The sequence's step positions, sorted, deduplicated, ints.

    Tolerant on the way in because the caller is a database row set: asyncpg
    hands back whatever the column holds, a test hands back a list of ints, and
    a step whose order is somehow unreadable should be skipped rather than take
    the whole cron tick down with a TypeError.
    """
    out: set[int] = set()
    for value in step_orders or ():
        try:
            out.add(int(value))
        except (TypeError, ValueError):
            continue
    return sorted(out)


def plan_due_step(step_orders: Iterable, current_step) -> int | None:
    """The `step_order` to send RIGHT NOW, or None when the sequence is done.

    `None` means finished, and the caller marks the enrolment 'completed'. It is
    also what an empty sequence returns, which is the correct answer to "what
    does a sequence with no steps send" — nothing, and stop asking.

    `current_step` of 0, NULL or anything below the first position starts at the
    first step that exists. The column defaults to 0 in the DDL while
    `enroll_contacts` writes 1, so both shapes are live in the same table and
    both have to mean "start at the beginning". Reading 0 as "waiting for step
    zero", finding no such step and concluding the drip is complete would retire
    an enrolment that has never been sent anything.
    """
    ordered = _orders(step_orders)
    if not ordered:
        return None
    try:
        want = int(current_step) if current_step is not None else 0
    except (TypeError, ValueError):
        want = 0
    if want <= ordered[0]:
        return ordered[0]
    for order in ordered:
        if order >= want:
            return order
    # Past the last step. The enrolment has had everything this sequence holds.
    return None


def plan_following_step(step_orders: Iterable, sent_order) -> int | None:
    """The `step_order` after the one just sent, or None if that was the last.

    Strictly greater, never `+1`. See the header: the gap left by a deleted step
    is the case that matters, and it is the case arithmetic gets wrong.
    """
    try:
        sent = int(sent_order)
    except (TypeError, ValueError):
        return None
    for order in _orders(step_orders):
        if order > sent:
            return order
    return None


def next_send_at(now: datetime, delay_days) -> datetime:
    """When a step whose delay is `delay_days` should go out, measured from `now`.

    `now` is passed in rather than read here so a test can state the instant it
    means. Every caller in the product passes `services.skills.timeutil.utc_now`,
    which is aware; this function does not care, and returns whatever kind it was
    given plus the offset.

    A negative delay is clamped to zero rather than refused. `add_step` takes
    `delay_days: int` with no lower bound and the form's `min="0"` is a browser
    hint, not a constraint, so -3 is storable. Sending it now is what the author
    plainly meant; scheduling it three days into the past would make the row
    permanently due and the contact would be mailed every cron tick.
    """
    try:
        days = int(delay_days) if delay_days is not None else DEFAULT_DELAY_DAYS
    except (TypeError, ValueError):
        days = DEFAULT_DELAY_DAYS
    return now + timedelta(days=max(0, days))


def is_sendable_channel(channel: str | None) -> bool:
    """True when this step's channel is one the product can actually deliver.

    `add_step` accepts four channels: email, whatsapp, call_task and manual. Only
    the first leaves the building. `routers/whatsapp.py` stores a message as
    'pending' behind a `TODO: Call Meta Cloud API` and sends nothing (see
    `outbound.py`'s "Deliberately NOT guarded" note), and call_task and manual
    are, by their own names, work for a person.

    The distinction is load-bearing rather than tidy. A non-sendable step must
    still ADVANCE — otherwise a sequence whose second step is "ring them" parks
    every enrolment on it forever and steps three and four never go out. So the
    caller logs the step, moves the enrolment on, and sends no email. What it
    must NOT do is treat "we cannot deliver this" as "deliver it by email
    instead", which is the campaign-side defect recorded in
    `skills/action/campaign_sender.py`.
    """
    return (channel or "email") == "email"
