"""
chase_ladder — catalogue #28, "Document Chase — the email ladder".

The folio calls this the highest-value thing in its tier, and the reason is not
technical: document intake and follow-up was ranked a top-three operational
bottleneck by 58% of firm leaders in AICPA's 2025 survey, ahead of billing
complexity and recruitment.

What it answers: of everything this firm is waiting on and has not got, which
items are due a first nudge, which a second, and which have gone past nudging
and need a person told instead.

── THE LADDER IS THE SKILL. THE LIST IS NOT. ────────────────────────────────

`find_overdue_tasks` and `find_stalled_agreements` already return the items.
Neither answers the question a person actually has on a Monday, which is "which
of these have I already chased twice". A list without that produces one of two
behaviours and both are bad: chase everything again every day until the
recipient filters you, or chase nothing because you cannot remember.

So each item comes back on a RUNG:

    +2 days   first nudge
    +5 days   second nudge
    +9 days   stop nudging — escalate to a person inside the firm

and the rung already reached is read from what was actually SENT, not inferred
from the age. Two items overdue by the same number of days sit on different
rungs if one of them was chased and the other was missed.

── THE DONE-STATE IS REAL HERE, AND THAT IS RARE IN THIS CATALOGUE ─────────

`staging.reminders` records one row per reminder with `entity_type`,
`entity_id`, `status` and `sent_at` — 2,150 of them live. So this skill can do
the thing catalogue #19 explicitly cannot: know what it has already said, and
not say it again.

`status` matters as much as the row. A reminder with status `suppressed` was
NOT delivered — 304 of the follow-up reminders and 26 of the invoice ones are
suppressed — so counting rows rather than SENT rows would silently promote an
item up the ladder on the strength of a message nobody received, and then
escalate to a partner about a client who was never actually chased.

── IT NEVER SENDS ───────────────────────────────────────────────────────────

It computes what is due and to whom. Sending is Niyam's, and arming a Niyam
rule is the owner's decision. `pack_collection_messages` takes the same posture
for the same reason. This module writes nothing at all — not even a reminder
row — because writing one would mark an item chased that nobody chased.

── Measured live, read-only, 2026-08-20 ─────────────────────────────────────

  · Overdue tasks: 134 in the seeded org, 19 in Unicode Group, 0 in Aekam Inc.
    Of 174 overdue across the product, 133 are more than nine days past due —
    the escalation rung is where most of this backlog actually sits.
  · eSign: 31 documents `sent` or `partially_signed`, the oldest raised
    2025-05-10, and `staging.reminders` contains NOT ONE row with
    `entity_type = 'sign_documents'`. Nothing has ever chased a signature, so
    every one of the 31 is on rung zero.
  · The org path for a task is `organisations.team_id = tasks.team_id`, and
    each of the three orgs holds a distinct team_id.
"""
import logging
from datetime import date, timedelta

from services.skills.timeutil import as_date, days_between, utc_now

log = logging.getLogger(__name__)

#: The ladder, in days past due. Ordered, and read as "the highest rung whose
#: threshold this item has passed".
#:
#: The third rung is deliberately not a third nudge. Catalogue #28: "escalates
#: internally at +9 INSTEAD OF nudging again". A chaser that keeps chasing has
#: stopped being a reminder and become a filter rule in the recipient's inbox.
LADDER = (
    (2, "first nudge", "external"),
    (5, "second nudge", "external"),
    (9, "escalate inside the firm", "internal"),
)

#: A reminder only counts if it actually went. `suppressed` rows exist in
#: volume — 304 follow-up and 26 invoice reminders live — and treating one as a
#: chase would promote an item up the ladder on a message nobody received.
DELIVERED_STATUSES = ("sent",)

#: `staging.reminders.entity_type` values this skill reads and writes about.
#: `tasks` is already in use (102 rows); `sign_documents` has NEVER appeared,
#: which is itself the finding for every stalled signature.
ENTITY_TASK = "tasks"
ENTITY_SIGN = "sign_documents"


def _f(value, default=0.0) -> float:
    return default if value is None else float(value)


def _rung_for(days_overdue: int, already_sent: int) -> dict:
    """Where this item stands, from its age AND from what actually went out.

    Two items the same number of days overdue sit on different rungs when one
    was chased and the other was missed — which is the whole point, and is why
    `already_sent` is a parameter rather than something derived from the age.
    """
    reached = [r for r in LADDER if days_overdue >= r[0]]
    if not reached:
        return {
            "action": "nothing yet",
            "rung": 0,
            "direction": None,
            "why": f"{days_overdue} day(s) past due; the first nudge is at "
                   f"{LADDER[0][0]} days",
        }

    # The rung this item's AGE entitles it to, 1-based.
    entitled = len(reached)
    if already_sent >= entitled:
        return {
            "action": "already done",
            "rung": entitled,
            "direction": reached[-1][2],
            "why": f"{already_sent} chase(s) have already been sent and the "
                   f"item is on rung {entitled}; nothing new is due",
        }

    # The NEXT rung owed, which is not always the highest one reached: an item
    # that went straight from nothing to twelve days overdue owes the first
    # nudge, not the escalation. Skipping to the top would send a partner an
    # escalation about a client nobody has written to.
    owed = LADDER[already_sent]
    return {
        "action": owed[1],
        "rung": already_sent + 1,
        "direction": owed[2],
        "why": f"{days_overdue} day(s) past due with {already_sent} chase(s) "
               f"sent; rung {already_sent + 1} is owed",
    }


async def _chase_counts(pool, org_id: str, entity_type: str) -> dict[str, int]:
    """How many chases have actually been DELIVERED, per entity id.

    One query for the whole set rather than one per item: the alternative is
    N round trips for a list that is routinely in the hundreds.
    """
    rows = await pool.fetch(
        """
        SELECT entity_id::text AS entity_id, count(*) AS n
        FROM public.reminders
        WHERE org_id = $1::uuid
          AND entity_type = $2::text
          AND status = ANY($3::text[])
        GROUP BY entity_id
        """,
        org_id, entity_type, list(DELIVERED_STATUSES),
    )
    return {r["entity_id"]: int(r["n"]) for r in rows}


async def check_chase_ladder(
    pool, org_id: str, limit: int = 200,
) -> dict:
    """Everything the firm is waiting on, and which rung each item is owed.

    Two kinds of thing, because two kinds exist in this product: a TASK that is
    past its due date, and an eSIGN document that was sent and has not come
    back. A per-client document checklist would be a third and there is no such
    table — that is catalogue #47, and it is blocked for exactly that reason.

    Never sends, never writes. Not even a reminder row: writing one would mark
    an item chased that nobody chased.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    task_chases = await _chase_counts(pool, org_id, ENTITY_TASK)
    sign_chases = await _chase_counts(pool, org_id, ENTITY_SIGN)

    # ── tasks ──────────────────────────────────────────────────────────────
    #
    # The org path for a core-PM task is `organisations.team_id`, not an
    # org_id column — `public.tasks` has none. Resolved through a subquery on
    # the org rather than by passing a team id in, so a caller cannot hand this
    # another org's team.
    tasks = await pool.fetch(
        """
        SELECT t.id, t.task_id, t.title, t.due_at, t.status, t.created_by_name,
               t.assignee_emails
        FROM public.tasks t
        WHERE t.team_id = (SELECT team_id FROM public.organisations
                            WHERE id = $1::uuid)
          AND t.archived_at IS NULL
          AND t.status <> 'done'
          AND t.due_at IS NOT NULL
          AND t.due_at < NOW()
        ORDER BY t.due_at
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # ── signatures ─────────────────────────────────────────────────────────
    signs = await pool.fetch(
        """
        SELECT d.id, d.title, d.status, d.created_at, d.expires_at,
               d.signers_total, d.signers_completed,
               COALESCE(NULLIF(btrim(u.name), ''),
                        NULLIF(btrim(u.full_name), ''),
                        '(raised by someone no longer on the team)') AS raised_by
        FROM public.sign_documents d
        LEFT JOIN public.users u ON u.user_id = d.created_by
        WHERE d.org_id = $1::uuid
          AND d.status IN ('sent', 'partially_signed')
        ORDER BY d.created_at
        LIMIT $2::int
        """,
        org_id, cap,
    )

    items: list[dict] = []

    for t in tasks:
        due = as_date(t["due_at"])
        # `days_between`, never a hand subtraction. asyncpg returns AWARE
        # datetimes for timestamptz and DATEs for date columns, and naive minus
        # aware raises — a bug that reached production TWICE, once found only on
        # the first real skill run. `tests/test_skill_handler_clock.py` refuses
        # it, and it refused this file.
        days = days_between(today, due)
        # KEYED ON `tasks.id`, THE UUID — NOT ON `task_id`.
        #
        # `public.tasks` carries both, and `staging.reminders.entity_id` holds
        # the uuid: measured live, all 102 task reminders match `t.id` and NOT
        # ONE matches `t.task_id`. Keying on the wrong one is silent — every
        # item comes back with zero chases, sits on rung 1 for ever, and the
        # skill chases the same list every single day, which is the exact
        # behaviour it exists to prevent. It looks correct on every screen.
        sent = task_chases.get(str(t["id"]), 0)
        rung = _rung_for(days, sent)
        items.append({
            "kind": "task",
            "entity_type": ENTITY_TASK,
            "entity_id": str(t["id"]),
            # The human-facing handle, for a link. Not the reminder key.
            "task_ref": t["task_id"],
            "what": t["title"],
            "due_on": due,
            "days_past_due": days,
            "chases_delivered": sent,
            # NAMES, never ids. `created_by_name` is denormalised onto the row
            # precisely so a task can say who asked for it without a join.
            "escalate_to": t["created_by_name"] or None,
            "waiting_on": list(t["assignee_emails"] or []) or None,
            **rung,
        })

    for d in signs:
        raised = as_date(d["created_at"])
        days = days_between(today, raised)
        sent = sign_chases.get(str(d["id"]), 0)
        rung = _rung_for(days, sent)
        expired = bool(d["expires_at"]) and as_date(d["expires_at"]) < today
        items.append({
            "kind": "signature",
            "entity_type": ENTITY_SIGN,
            "entity_id": str(d["id"]),
            "what": d["title"],
            "due_on": raised,
            "days_past_due": days,
            "chases_delivered": sent,
            "escalate_to": d["raised_by"],
            "waiting_on": None,
            "signers": f"{d['signers_completed'] or 0} of {d['signers_total'] or 0}",
            # An expired document cannot be signed at all, so chasing it is
            # worse than useless — it asks somebody to do an impossible thing.
            # Reported as its own state rather than left on the ladder.
            "expired": expired,
            **({"action": "cannot be chased — it has expired",
                "rung": 0, "direction": None,
                "why": "the link has expired, so this must be reissued rather "
                       "than chased"} if expired else rung),
        })

    # An expired document is its OWN list, not a fourth silent state.
    #
    # It carries an `action` that is in neither the due set nor the holding set,
    # so without this it was counted and then rendered nowhere — present in
    # `expired_signatures` and absent from every list a reader actually opens.
    # A dropped row that a count insists exists is worse than either showing it
    # or not counting it.
    expired_items = [i for i in items if i.get("expired")]

    due_now = [i for i in items if i["action"] in
               ("first nudge", "second nudge", "escalate inside the firm")]
    external = [i for i in due_now
                if i["action"] in ("first nudge", "second nudge")]
    internal = [i for i in due_now if i["action"] == "escalate inside the firm"]

    no_owner = [i for i in internal if not i["escalate_to"]]

    limitations = [
        "IT NEVER SENDS AND NEVER WRITES. It says what is due and to whom; "
        "delivering it is a Niyam rule and arming one is the owner's decision. "
        "It does not even record a reminder — writing one would mark an item "
        "chased that nobody chased.",
        "A chase counts only if it was DELIVERED. Reminders with status "
        "'suppressed' are excluded, because counting one would promote an item "
        "up the ladder on a message nobody received and then escalate to a "
        "partner about a client who was never written to.",
        "There is no per-client document checklist in this product, so 'what "
        "the firm is waiting on' means overdue tasks and unsigned documents — "
        "not a period-by-period list of records requested from each client.",
    ]
    if no_owner:
        limitations.append(
            f"{len(no_owner)} item(s) have reached the escalation rung and carry "
            f"NO internal owner to escalate to. Routing them needs either an org "
            f"admin fallback or `reporting_to` filled in; this names them rather "
            f"than picking somebody.")

    return {
        "as_at": today,
        "ladder": [
            {"days_past_due": d, "action": a, "direction": k} for d, a, k in LADDER
        ],
        "counts": {
            "waiting_on": len(items),
            "tasks": sum(1 for i in items if i["kind"] == "task"),
            "signatures": sum(1 for i in items if i["kind"] == "signature"),
            "action_due_now": len(due_now),
            "nudges_due": len(external),
            "escalations_due": len(internal),
            "escalations_with_no_owner": len(no_owner),
            "expired_signatures": sum(1 for i in items if i.get("expired")),
            "nothing_due": sum(1 for i in items
                               if i["action"] in ("nothing yet", "already done")),
            "capped_at": cap,
            "was_capped": len(tasks) >= cap or len(signs) >= cap,
        },
        "nudges_due": external,
        "escalations_due": internal,
        "expired_and_must_be_reissued": expired_items,
        "waiting_but_nothing_due": [
            i for i in items if i["action"] in ("nothing yet", "already done")
        ],
        "limitations": limitations,
    }
