"""
blocked_and_downgraded — the three catalogue entries the folio would not ship:
#47 (blocked), #56 (rejected), #60 (declared not-a-skill).

    check_whatsapp_chase_leg     #47  the WhatsApp leg of Document Chase
    check_template_required_soon #56  the DOWNGRADE the folio's dissent asked for
    brief_ticket_sla_feasibility #60  what a ticket SLA watch would need to exist

They ship because a card that says "this cannot be answered, and here is the
evidence" is a deliverable, and an empty slot in a catalogue of 61 is not. Every
blocker below was re-verified against the live database on 2026-08-20 rather
than copied from the folio — and ONE OF THEM TURNED OUT TO BE WRONG. See #60.

── #47: THREE BLOCKERS, ALL THREE STILL TRUE ────────────────────────────────

The folio blocked "Document Chase, the WhatsApp leg" three ways. Re-probed:

  1. NIYAM HAS NO WHATSAPP CHANNEL AND NO WHATSAPP VERB. Confirmed from the
     live constants, not from the folio: `services/niyam/send.CHANNELS` is
     {inapp, push, email}, `PLANNED_CHANNELS` is EMPTY, and the six verbs in
     `services/niyam/actions.ACTIONS` are task.set_status, task.add_comment,
     task.create, notify.send, invoice.remind_customer, report.send. None
     sends WhatsApp.
     The nuance the folio missed: `outbound_log_channel_ck` DOES allow
     `channel = 'whatsapp'`, so the LOG is ready and the SENDER is not. That is
     a schema promising a thing no code does — the same shape as the `opted_in`
     column `check_consent_ledger` reports.
  2. NO PER-CLIENT CHECKLIST TABLE. A `to_regclass` scan of six plausible names
     across both schemas returns nothing. So "the eleven records we asked this
     client for in July" has nowhere to live, and a chase cannot name what it
     is chasing.
  3. NO CLIENT-TO-TASK LINK. `public.task_clients` holds 0 rows, product-wide.
     And even full it would not close this: its `user_id` is a PORTAL USER, not
     a `graha_clients` company, and a CRM client is the COMPANY. So the table is
     a read-access grant, not the client link a document chase needs.

The email ladder — `check_chase_ladder`, catalogue #28 — is the one to use
today, and this handler says so on the output, in `use_instead`, and in its
first limitation. It imports that module's LADDER and rung arithmetic rather
than restating them, because two chasers with two ladders is how a firm ends up
believing whichever one it happened to open.

── #56: THE DOWNGRADE, NOT THE KILL ─────────────────────────────────────────

"WhatsApp Window Closing" was REJECTED because from 1 October 2026 Meta bills
every in-window free-form reply, so a card alerting that a FREE window is about
to close would be alerting about something that will not exist. That reasoning
is sound and the folio's own dissent is sounder: what the window controls is the
ability to answer WITHOUT A PRE-APPROVED TEMPLATE, and that does not stop
existing on 1 October.

So `check_template_required_soon` never says "free", never states a price and
takes no view on what Meta charges. It says one thing: after this moment, an
answer on this conversation must be an APPROVED TEMPLATE. That sentence is true
before 1 October 2026 and after it.

The 24 hours is a PARAMETER (`window_hours`), not a literal, and the output
carries the date the figure was last checked. It is Meta policy, it has moved
before, and `services/wa_window.WINDOW_SECONDS` hardcodes it in the send path —
so when Meta moves it, this handler can be told the new number the same day and
the send route cannot.

── #60: THE FOLIO IS WRONG ABOUT ONE WORD, AND RIGHT ABOUT THE DECISION ─────

The folio: "Missing is not a column but the entire feature." Verified against
the live database, and the first half of that is FALSE.

`staging.graha_tickets` EXISTS. Migration 048 dropped the helpdesk; catchup 081
recreated the table as an empty stub so `routers/dristi.py`'s report source
stops 500ing, and `dristi.py` still lists it as the `tickets` pivot source with
priority / status / category / created_at / resolved_at. So a reader who greps
for a ticket table FINDS ONE, which is exactly how a convincing zero gets built.

What is actually missing is narrower and worse:
  · `sla_due_at` — migration 041 HAD it; the live stub does NOT. No column
    anywhere in the product records what response time was promised.
  · `staging.graha_ticket_messages` — `to_regclass` returns NULL. With no
    message rows there is no first-response time to measure either.
  · Any write path. A source search on 2026-08-20 finds no INSERT into
    `graha_tickets` in any router, service or job.

So the folio's conclusion stands and its wording does not: this is a product
decision about whether to rebuild a feature that was deliberately deleted, and
ranking it as a skill card hides that question. The handler is deliberately
short and refuses to invent a ticket model.

── Measured on the live database, read-only, 2026-08-20 ─────────────────────

Three orgs: Aekam Inc (045b76ad…), E2E Test & Associates [TEST ORG]
(64e7bea6…), Unicode Group (fae87907…).

  · `staging.varta_business_accounts`: ZERO rows, all three orgs. No org has a
    connected WABA, so nothing has ever been sent to or received from Meta and
    every varta row below is seed data. Both WhatsApp handlers say so.
  · `staging.outbound_log`: 2,391 rows product-wide — email 2,271, push 120,
    whatsapp 0, social 0. Org-scoped, as the handler counts them: Aekam 106,
    E2E 1,982, Unicode Group 278, and `whatsapp = 0` in every one of the three.
    Not one WhatsApp message has ever been logged anywhere.
  · `public.task_clients`: 0 rows, product-wide, so 0 for each org.
  · `staging.varta_conversations`: 50, ALL in the E2E org — 25 open, 13
    pending, 12 resolved. 25 of the 50 have NEVER had an inbound message, so
    their window has never opened and a template is already required.
  · `staging.varta_messages`: 500, all E2E, 250 inbound / 250 outbound, spanning
    2026-07-27 to 2026-08-02. The newest inbound anywhere is 2026-08-02, so on
    2026-08-20 EVERY window is 18 days closed and nothing is "about to" close.
    That is reported as its own state — an empty urgent list here means the
    inbox is silent, not that the firm is on top of it.
  · `staging.varta_templates`: 10, all E2E — 6 APPROVED (5 utility, 1
    marketing), 2 pending, 1 rejected, 1 draft. Aekam and Unicode hold NONE, so
    for them "you will need an approved template" means "you cannot reply at
    all until one is approved", which is a different sentence and is printed.
  · `staging.graha_tickets`: exists, 10 columns, 0 rows in every org, and NO
    `sla_due_at`. `staging.graha_ticket_messages` does not exist.
  · Overdue tasks (the #47 population): 134 in E2E, 19 in Unicode Group, 0 in
    Aekam Inc. 0 of all 153 can be routed to WhatsApp.

── The three handlers, run against all three live orgs, 2026-08-20 ──────────

Read-only, `json.dumps(out, default=str)` clean on all nine runs.

  check_whatsapp_chase_leg
    Aekam Inc      0 waiting, 0 due now,  blockers_still_true 3/3
    E2E            134 waiting, 122 due now, blockers_still_true 3/3
    Unicode Group  19 waiting, 18 due now,  blockers_still_true 3/3
    routable_on_whatsapp is 0 in all three, and the Niyam probe returns
    channels ['email','inapp','push'], planned [], and the six verbs above.

  check_template_required_soon
    Aekam Inc      0 conversations — "a check that found nothing to check"
    E2E            38 unresolved conversations: 0 closing within the 4-hour
                   warning, 38 ALREADY requiring a template, 18 of those from a
                   contact who has never written. 6 approved templates.
                   newest inbound 2026-08-02, 18 days quiet.
    Unicode Group  0 conversations, 0 approved templates.

  brief_ticket_sla_feasibility
    Identical in all three orgs, as it must be — it measures the product:
    graha_tickets present with 10 columns and 0 rows, graha_ticket_messages
    absent, sla_columns_found 0, prerequisites_unmet 4.
"""
import logging
from datetime import date, timedelta

from services.skills.data.chase_ladder import LADDER, _rung_for
from services.skills.reachable import reachable
from services.skills.timeutil import as_date, days_between, hours_between, utc_now

log = logging.getLogger(__name__)

#: Meta's customer-service window, in hours, as a DEFAULT rather than a fact.
#:
#: It is a commercial policy of a foreign company, not statute, so it does not
#: belong in `statute_calendar` — and it is not a constant either. Every output
#: carries `window_hours_true_as_of` beside the number so a reader can see how
#: old the figure is instead of trusting it.
DEFAULT_WINDOW_HOURS = 24.0

#: The day the 24-hour figure was last checked against Meta's published policy.
#: Whoever moves this is asserting they re-checked it.
WINDOW_HOURS_TRUE_AS_OF = date(2026, 8, 20)

#: How close to the edge counts as "act now". Four hours because a person has to
#: still be at a desk: a one-hour warning fires at 3am IST for a window opened at
#: 4am, and a twelve-hour one is not a warning, it is the whole working day.
DEFAULT_WARN_WITHIN_HOURS = 4.0

#: Table names a per-client document checklist would plausibly carry. Probed
#: with `to_regclass` rather than asserted, because #47's second blocker is
#: precisely a claim about what does not exist, and the folio has been stale
#: before.
CHECKLIST_CANDIDATES = (
    "staging.graha_document_requests",
    "staging.graha_client_checklists",
    "staging.client_document_checklist",
    "staging.document_requests",
    "staging.kartavya_checklists",
    "public.document_requests",
)

#: What the live product would have to grow before a ticket SLA watch could be a
#: skill rather than a question. Deliberately four items and no schema: the point
#: of #60 is that inventing a ticket model is the failure mode.
SLA_PREREQUISITES = (
    "A place to record the promise. `sla_due_at` was on migration 041's "
    "graha_tickets and is NOT on the live stub, and no other column anywhere "
    "records what response time was promised to whom.",
    "A write path. No router, service or job in this repository INSERTs a "
    "ticket row, so the table cannot fill even by accident.",
    "A first-response clock. `staging.graha_ticket_messages` does not exist, "
    "so 'time to first reply' — the number an SLA watch is actually about — "
    "has no rows to compute from.",
    "A decision about which inbox a ticket even comes from: WhatsApp "
    "(varta_conversations), inbound email (graha_inbound_emails) and a "
    "helpdesk are three different products, and the firm has not picked one.",
)


def _f(value, default=0.0) -> float:
    """Decimal | None -> float. asyncpg returns Decimal for numeric, which is
    not JSON-serialisable, and this output is handed to a reader that way."""
    return default if value is None else float(value)


def _niyam_delivery_surface() -> dict:
    """What Niyam can ACTUALLY send on, read from the live constants.

    Imported lazily and defensively. The point of this function is to stop #47's
    first blocker from being a sentence somebody once wrote down: if the channel
    set or the verb list changes, the next run reports the change instead of
    repeating the folio. If the import fails the answer is "could not check",
    which is a different thing from "there is no whatsapp channel" and must not
    look like it — §8.
    """
    try:
        from services.niyam.actions import ACTIONS
        from services.niyam.send import CHANNELS, PLANNED_CHANNELS
    except Exception as exc:                                  # pragma: no cover
        log.warning("blocked_and_downgraded: niyam constants unreadable: %s", exc)
        return {
            "checked": False,
            "why_not": f"the Niyam constants could not be imported ({exc!s}); "
                       f"this is NOT evidence that a WhatsApp channel exists, "
                       f"and NOT evidence that none does",
        }
    channels = sorted(CHANNELS)
    planned = sorted(PLANNED_CHANNELS)
    verbs = sorted(ACTIONS)
    return {
        "checked": True,
        "channels_niyam_can_deliver_on": channels,
        "channels_known_but_not_built": planned,
        "verbs": verbs,
        "has_whatsapp_channel": "whatsapp" in channels,
        "has_whatsapp_verb": any("whatsapp" in v for v in verbs),
    }


async def _table_exists(pool, qualified: str) -> bool:
    """Does this table exist.

    A catalog lookup, so it carries NO tenant data — the `org_id = $1` filter
    every other query in this module has would be meaningless here, and adding
    one for the look of it would be worse than saying this out loud.
    """
    row = await pool.fetchrow("SELECT to_regclass($1::text) AS t", qualified)
    return bool(row and row["t"])


# ═════════════════════════════════════════════════════════════════════════════
# #47 — Document Chase, the WhatsApp leg
# ═════════════════════════════════════════════════════════════════════════════

async def check_whatsapp_chase_leg(pool, org_id: str, limit: int = 200) -> dict:
    """The WhatsApp leg of Document Chase: the ladder, and why none of it sends.

    Same population and same rungs as `check_chase_ladder` (#28, the email
    ladder that shipped) — imported from it, never restated — with one column
    added: whether this item could be chased on WhatsApp at all. On the live
    database the answer is no for every item in every org, for three reasons
    that are counted here rather than quoted.

    Reads. Never writes, never sends. Nothing on the WhatsApp path could send
    even if it wanted to, which is the finding.
    """
    today = utc_now().date()
    cap = max(1, int(limit))

    # ── blocker 1: can Niyam deliver a WhatsApp message at all ──────────────
    niyam = _niyam_delivery_surface()

    # The log's own CHECK constraint permits 'whatsapp'. Counting rows on it
    # separates "the channel is not allowed" from "the channel is allowed and
    # unused" — opposite findings that one sentence would blur.
    ob = await pool.fetchrow(
        """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE channel = 'whatsapp') AS whatsapp,
               count(*) FILTER (WHERE channel = 'email')    AS email,
               count(*) FILTER (WHERE channel = 'push')     AS push
        FROM staging.outbound_log
        WHERE org_id = $1::uuid
        """,
        org_id,
    )

    waba = await pool.fetchrow(
        """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE COALESCE(status, '') = 'active') AS active
        FROM staging.varta_business_accounts
        WHERE org_id = $1::uuid
        """,
        org_id,
    )

    # ── blocker 2: is there anywhere to record what was asked for ───────────
    checklist_tables = []
    for candidate in CHECKLIST_CANDIDATES:
        if await _table_exists(pool, candidate):
            checklist_tables.append(candidate)

    # ── blocker 3: is any task linked to a client ───────────────────────────
    #
    # Scoped through `organisations.team_id`, the same path the email ladder
    # uses, because `public.tasks` has no org_id column and `public.task_clients`
    # has neither. A bare `count(*) FROM task_clients` would be a product-wide
    # number reported as this org's — the tenancy mistake this contract exists to
    # prevent, and it stays wrong even on a day when the true answer is zero
    # everywhere.
    links = await pool.fetchrow(
        """
        SELECT count(*) AS rows_for_this_org
        FROM public.task_clients tc
        JOIN public.tasks t ON t.task_id = tc.task_id
        WHERE t.team_id = (SELECT team_id FROM staging.organisations
                            WHERE id = $1::uuid)
        """,
        org_id,
    )

    # ── the population, on the same rungs as the email ladder ───────────────
    tasks = await pool.fetch(
        """
        SELECT t.id, t.task_id, t.title, t.due_at, t.created_by_name
        FROM public.tasks t
        WHERE t.team_id = (SELECT team_id FROM staging.organisations
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

    # Chases already DELIVERED, so an item the email ladder has nudged twice does
    # not read as rung 1 here. `suppressed` rows are excluded for the reason
    # chase_ladder gives at length: a suppressed reminder was not received, and
    # counting one promotes an item on the strength of a message nobody read.
    chased = {
        r["entity_id"]: int(r["n"])
        for r in await pool.fetch(
            """
            SELECT entity_id::text AS entity_id, count(*) AS n
            FROM staging.reminders
            WHERE org_id = $1::uuid
              AND entity_type = 'tasks'
              AND status = 'sent'
            GROUP BY entity_id
            """,
            org_id,
        )
    }

    have_waba = int(waba["total"] or 0) > 0
    have_checklist = bool(checklist_tables)
    have_link = int(links["rows_for_this_org"] or 0) > 0
    can_send = bool(niyam.get("has_whatsapp_channel")) and have_waba

    items: list[dict] = []
    for t in tasks:
        due = as_date(t["due_at"])
        # `days_between`, never a hand subtraction: asyncpg returns AWARE
        # datetimes for timestamptz and DATEs for date columns, and naive minus
        # aware raises. That bug reached production twice.
        days = days_between(today, due)
        # Keyed on `tasks.id`, the uuid — `staging.reminders.entity_id` holds
        # that and never `task_id`. chase_ladder documents why keying on the
        # wrong one is silent and looks correct on every screen.
        sent = chased.get(str(t["id"]), 0)
        rung = _rung_for(days, sent)
        # Ordered so the reader is told the nearest obstacle first: a checklist
        # is useless without a link, and a link is useless without a sender.
        why_not = []
        if not can_send:
            why_not.append("no WhatsApp sender: Niyam has no whatsapp channel "
                           "and this org has no connected Business Account")
        if not have_link:
            why_not.append("no client is linked to this task, so there is no "
                           "number to send to")
        if not have_checklist:
            why_not.append("no per-client checklist exists, so a message could "
                           "not name which records are outstanding")
        items.append({
            "kind": "task",
            "entity_type": "tasks",
            # A row handle the UI opens the task with. Not a name.
            "entity_id": str(t["id"]),
            "task_ref": t["task_id"],
            "what": t["title"],
            "due_on": due,
            "days_past_due": days,
            "chases_delivered": sent,
            # NAMES, never ids. `created_by_name` is denormalised onto the row
            # precisely so a task can say who asked for it without a join.
            "escalate_to": t["created_by_name"] or None,
            "whatsapp_recipient": None,
            "whatsapp_routable": False,
            "why_not_routable": why_not,
            **rung,
        })

    routable = [i for i in items if i["whatsapp_routable"]]
    due_now = [i for i in items if i["action"] in
               ("first nudge", "second nudge", "escalate inside the firm")]

    blockers = [
        {
            "blocker": "Niyam cannot send a WhatsApp message",
            "still_true": not can_send,
            "evidence": {
                "niyam": niyam,
                "whatsapp_rows_in_outbound_log_for_this_org":
                    int(ob["whatsapp"] or 0),
                "all_outbound_rows_for_this_org": int(ob["total"] or 0),
                "of_which_email": int(ob["email"] or 0),
                "of_which_push": int(ob["push"] or 0),
                "connected_business_accounts": int(waba["total"] or 0),
                "of_which_active": int(waba["active"] or 0),
            },
            "note": "`outbound_log_channel_ck` DOES permit channel='whatsapp' — "
                    "the log is ready and the sender is not. A schema that "
                    "allows a thing no code does is not evidence the thing "
                    "happens.",
            "what_would_unblock_it": "a whatsapp entry in "
                                     "`services/niyam/send.CHANNELS` with a verb "
                                     "behind it, and one row in "
                                     "`staging.varta_business_accounts`",
        },
        {
            "blocker": "There is no per-client document checklist",
            "still_true": not have_checklist,
            "evidence": {
                "table_names_probed": list(CHECKLIST_CANDIDATES),
                "tables_found": checklist_tables,
            },
            "note": "Without one, a chase cannot say WHAT it is chasing. "
                    "'You have an overdue task' is not a document request.",
            "what_would_unblock_it": "a table holding one row per record "
                                     "requested from one client for one period, "
                                     "with a received-on column",
        },
        {
            "blocker": "No task is linked to a client",
            "still_true": not have_link,
            "evidence": {
                "task_clients_rows_for_this_org":
                    int(links["rows_for_this_org"] or 0),
            },
            "note": "`public.task_clients` is also the WRONG link even when "
                    "full: its user_id is a PORTAL USER, not a graha_clients "
                    "company, and a CRM client is the company. It grants read "
                    "access; it does not say whose work this is.",
            "what_would_unblock_it": "a client_id on the work, or a join table "
                                     "from a task to `staging.graha_clients`",
        },
    ]

    limitations = [
        "USE `check_chase_ladder` (#28, the EMAIL ladder) TODAY. It is the "
        "version that works. This handler exists to show the same list with the "
        "WhatsApp leg's blockers counted against it, and it routes NOTHING: "
        f"0 of {len(items)} items in this org can be chased on WhatsApp.",
        "It never sends and never writes — not even a reminder row. Recording a "
        "chase nobody sent is worse than sending none.",
        "Every rung comes from `chase_ladder.LADDER` by import, not by copy, so "
        "this card and the email ladder can never disagree about what is owed. "
        "The ladder is "
        + ", ".join(f"{d}d {a}" for d, a, _ in LADDER) + ".",
        "The population here is OVERDUE TASKS ONLY. The email ladder also "
        "carries unsigned eSign documents; those are chased by a signing link "
        "and are not a WhatsApp question, so they are excluded rather than "
        "silently counted as unroutable.",
        "The three blockers are re-checked on every run against this org's own "
        "rows and the live Niyam constants. If one of them comes back "
        "still_true = false, the folio's claim has gone stale and this card "
        "should be rebuilt rather than believed.",
    ]
    if not niyam.get("checked"):
        limitations.append(
            "The Niyam channel and verb lists COULD NOT BE READ on this run, so "
            "the first blocker is unverified rather than confirmed. That is not "
            "the same as finding a WhatsApp channel, and not the same as "
            "finding none.")
    if len(tasks) >= cap:
        limitations.append(
            f"The list was capped at {cap} overdue tasks and there may be more. "
            f"The blocker counts are NOT capped — they are whole-org figures.")

    return {
        "as_at": today,
        "use_instead": "check_chase_ladder",
        "ladder": [
            {"days_past_due": d, "action": a, "direction": k} for d, a, k in LADDER
        ],
        "blockers": blockers,
        "counts": {
            "blockers_still_true": sum(1 for b in blockers if b["still_true"]),
            "blockers_checked": len(blockers),
            "waiting_on": len(items),
            "action_due_now": len(due_now),
            "routable_on_whatsapp": len(routable),
            "not_routable_on_whatsapp": len(items) - len(routable),
            "connected_business_accounts": int(waba["total"] or 0),
            "whatsapp_rows_in_outbound_log": int(ob["whatsapp"] or 0),
            "task_client_links": int(links["rows_for_this_org"] or 0),
            "checklist_tables_found": len(checklist_tables),
            "capped_at": cap,
            "was_capped": len(tasks) >= cap,
        },
        "would_be_chased_if_the_leg_existed": due_now,
        "limitations": limitations,
    }


# ═════════════════════════════════════════════════════════════════════════════
# #56 — the downgrade: conversations about to require a template
# ═════════════════════════════════════════════════════════════════════════════

def _window_for(last_inbound, now, window_hours: float) -> dict:
    """Where one conversation stands against the window.

    `last_inbound` is the newest INBOUND message, never the newest message: a
    reply from the firm does not extend the window, which is the single most
    common misreading of this rule (`services/wa_window.py` says the same).
    """
    if last_inbound is None:
        return {
            "state": "a template is already required",
            "reason": "this contact has never written to the firm, so no "
                      "window has ever opened",
            "window_closes_at": None,
            "hours_left": None,
        }
    closes_at = last_inbound + timedelta(hours=float(window_hours))
    # hours_between, not a hand subtraction — see timeutil.
    left = hours_between(closes_at, now)
    if left <= 0:
        return {
            "state": "a template is already required",
            "reason": f"the window closed {abs(round(left, 1))} hour(s) ago",
            "window_closes_at": closes_at,
            "hours_left": 0.0,
        }
    return {
        "state": "a template will be required",
        "reason": f"{round(left, 1)} hour(s) left before a reply must be an "
                  f"approved template",
        "window_closes_at": closes_at,
        "hours_left": round(left, 2),
    }


async def check_template_required_soon(
    pool, org_id: str,
    window_hours: float = DEFAULT_WINDOW_HOURS,
    warn_within_hours: float = DEFAULT_WARN_WITHIN_HOURS,
    limit: int = 200,
) -> dict:
    """Conversations where an answer is about to need an APPROVED TEMPLATE.

    This is #56 downgraded, not #56. It never says a window is "free", never
    states a price and takes no view on what Meta bills, because from 1 October
    2026 Meta charges for in-window free-form replies and a card about a free
    window would be a card about something that no longer exists. What does not
    change is the thing the window actually controls: whether the firm may
    answer in its own words, or must pick a template Meta has already approved.

    `window_hours` is a parameter with a default, not a literal. It is Meta
    policy, it moves, and the output carries the date the figure was last
    checked so a reader can weigh it.
    """
    now = utc_now()
    cap = max(1, int(limit))
    warn = float(warn_within_hours)

    # Names, never ids. `varta_conversations.assigned_to` holds a `user_…`
    # handle; it is resolved here or replaced with a phrase, and the raw handle
    # never reaches the output.
    rows = await pool.fetch(
        """
        SELECT c.id::text AS conversation_id,
               c.status,
               COALESCE(NULLIF(btrim(vc.name), ''),
                        '(no name on this WhatsApp contact)') AS contact_name,
               NULLIF(btrim(vc.phone_number), '')            AS contact_phone,
               COALESCE(NULLIF(btrim(u.name), ''),
                        NULLIF(btrim(u.full_name), '')) AS assigned_to_name,
               MAX(m.created_at) FILTER (WHERE m.direction = 'inbound')
                   AS last_inbound,
               count(m.*) FILTER (WHERE m.direction = 'outbound')
                   AS replies_sent
        FROM staging.varta_conversations c
        JOIN staging.varta_contacts vc
          ON vc.id = c.varta_contact_id
         AND vc.org_id = c.org_id
        LEFT JOIN public.users u ON u.user_id = c.assigned_to
        LEFT JOIN staging.varta_messages m
          ON m.conversation_id = c.id
         AND m.org_id = c.org_id
        WHERE c.org_id = $1::uuid
          AND c.status <> 'resolved'
        GROUP BY c.id, c.status, vc.name, vc.phone_number, u.name, u.full_name
        ORDER BY MAX(m.created_at) FILTER (WHERE m.direction = 'inbound')
                 DESC NULLS LAST
        LIMIT $2::int
        """,
        org_id, cap,
    )

    # What the firm could actually fall back on. "You will need an approved
    # template" is advice; "you have none approved" is a different sentence, and
    # the reader needs whichever one is true.
    tpl = await pool.fetchrow(
        """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE status = 'approved') AS approved,
               count(*) FILTER (WHERE status = 'approved'
                                  AND upper(category) = 'UTILITY') AS utility,
               count(*) FILTER (WHERE status = 'pending') AS pending
        FROM staging.varta_templates
        WHERE org_id = $1::uuid
        """,
        org_id,
    )

    waba = await pool.fetchrow(
        """
        SELECT count(*) AS n
        FROM staging.varta_business_accounts
        WHERE org_id = $1::uuid
        """,
        org_id,
    )

    approved = int(tpl["approved"] or 0)
    after_this = (
        f"one of this org's {approved} approved template(s)" if approved
        else "NOTHING — this org has no approved template, so once the window "
             "shuts the firm cannot reply at all until Meta approves one"
    )

    closing_soon, already_closed, still_open = [], [], []
    newest_inbound = None
    for r in rows:
        li = r["last_inbound"]
        if li is not None and (newest_inbound is None or li > newest_inbound):
            newest_inbound = li
        w = _window_for(li, now, window_hours)
        item = reachable({
            # A row handle the UI opens the thread with. Not a name.
            "conversation_id": r["conversation_id"],
            "contact_name": r["contact_name"],
            "conversation_status": r["status"],
            "assigned_to": r["assigned_to_name"] or "(nobody assigned)",
            "last_heard_from_them": as_date(li),
            "replies_sent": int(r["replies_sent"] or 0),
            "what_you_can_send_after_this": after_this,
            **w,
        }, kind="conversation", entity_id=r["conversation_id"],
            phone=r["contact_phone"])
        if w["hours_left"] is None or w["hours_left"] <= 0:
            already_closed.append(item)
        elif w["hours_left"] <= warn:
            closing_soon.append(item)
        else:
            still_open.append(item)

    days_quiet = days_between(now, newest_inbound) if newest_inbound else None

    limitations = [
        "This card is NOT about cost and states no price. From 1 October 2026 "
        "Meta bills in-window free-form replies, so a 'free window' is not a "
        "thing to warn about; what the window still controls is whether the "
        "firm may answer in its own words or must use an approved template.",
        f"The {window_hours}-hour window is Meta's policy, not statute, and it "
        f"has moved before. This figure was last checked on "
        f"{WINDOW_HOURS_TRUE_AS_OF.isoformat()}; pass `window_hours` to change "
        f"it. `services/wa_window.py` hardcodes 24 hours in the SEND path, so "
        f"the two can disagree — and the send route is what actually refuses.",
        "It never sends, never writes and never drafts a template. It says "
        "which threads are about to change what kind of reply is allowed.",
        "The clock is the newest INBOUND message. A reply from the firm does "
        "NOT extend the window — the most common misreading of this rule.",
        "Resolved conversations are excluded: a closed thread nobody is going "
        "to answer does not need a warning.",
    ]
    if int(waba["n"] or 0) == 0:
        limitations.append(
            "THIS ORG HAS NO CONNECTED WHATSAPP BUSINESS ACCOUNT, so every "
            "conversation counted here is seed or historic data and nothing was "
            "ever received from Meta. These windows are arithmetic over rows, "
            "not a live inbox.")
    if not rows:
        limitations.append(
            "There are no unresolved WhatsApp conversations in this org at all, "
            "so this is a CHECK THAT FOUND NOTHING TO CHECK — not a clean bill.")
    elif not closing_soon and days_quiet is not None and days_quiet > 1:
        limitations.append(
            f"Nothing is closing soon because nothing has ARRIVED: the newest "
            f"inbound message is {days_quiet} day(s) old. An empty urgent list "
            f"here means the inbox is silent, not that the firm is on top of it.")
    if approved == 0 and rows:
        limitations.append(
            "This org has NO approved template. Every conversation past its "
            "window is unanswerable until Meta approves one, which takes days — "
            "so the pending count matters more than the closing list.")

    return {
        "as_at": now,
        "window_hours": float(window_hours),
        "window_hours_true_as_of": WINDOW_HOURS_TRUE_AS_OF,
        "warn_within_hours": warn,
        "newest_inbound_message": as_date(newest_inbound),
        "days_since_anything_arrived": days_quiet,
        "templates": {
            "total": int(tpl["total"] or 0),
            "approved": approved,
            "approved_utility": int(tpl["utility"] or 0),
            "awaiting_meta_approval": int(tpl["pending"] or 0),
        },
        "counts": {
            "conversations_examined": len(rows),
            "template_required_within_warning_window": len(closing_soon),
            "template_already_required": len(already_closed),
            "still_answerable_in_your_own_words": len(still_open),
            "never_heard_from_this_contact": sum(
                1 for i in already_closed if i["hours_left"] is None),
            "approved_templates_available": approved,
            "connected_business_accounts": int(waba["n"] or 0),
            "capped_at": cap,
            "was_capped": len(rows) >= cap,
        },
        "template_required_soon": closing_soon,
        "template_already_required": already_closed,
        "still_answerable_in_your_own_words": still_open,
        "limitations": limitations,
    }


# ═════════════════════════════════════════════════════════════════════════════
# #60 — Ticket SLA Watch: what would have to exist
# ═════════════════════════════════════════════════════════════════════════════

async def brief_ticket_sla_feasibility(pool, org_id: str) -> dict:
    """Why there is no ticket SLA watch, and what the real question is.

    Short on purpose. The folio's verdict was "missing is not a column but the
    entire feature; ranking it as a skill card hides the actual question", and
    that verdict is right about the decision and WRONG ABOUT THE COLUMN — a
    ticket table does exist. Inventing a ticket model here to fill the card
    would be the exact failure the folio was guarding against.
    """
    today = utc_now().date()

    has_tickets = await _table_exists(pool, "staging.graha_tickets")
    has_messages = await _table_exists(pool, "staging.graha_ticket_messages")

    columns: list[str] = []
    rows_here = None
    sla_column = False
    if has_tickets:
        columns = [
            r["column_name"] for r in await pool.fetch(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = ANY(current_schemas(false)) AND table_name = 'graha_tickets'
                ORDER BY ordinal_position
                """
            )
        ]
        sla_column = any("sla" in c.lower() for c in columns)
        row = await pool.fetchrow(
            """
            SELECT count(*) AS n
            FROM staging.graha_tickets
            WHERE org_id = $1::uuid
            """,
            org_id,
        )
        rows_here = int(row["n"] or 0)

    correction = (
        "The folio says 'missing is not a column but the entire feature'. Half "
        "of that is stale: `staging.graha_tickets` EXISTS — catchup 081 "
        "recreated it as an empty stub so the Dristi report source stops "
        "500ing, and `routers/dristi.py` still lists it as the 'tickets' pivot "
        "source. A reader who greps for a ticket table finds one. What is "
        "missing is the SLA column, the message table and every write path."
    ) if has_tickets else (
        "The folio says 'missing is not a column but the entire feature', and "
        "on this database that is exactly right: even the table is gone."
    )

    return {
        "as_at": today,
        "verdict": "This is a product decision, not a skill gap. There is no "
                   "helpdesk in this product: migration 048 deleted it "
                   "deliberately. Whether to rebuild one is a question for the "
                   "owner, and ranking it as a skill card hides that question "
                   "behind a card that would report zero for ever.",
        "folio_finding_correction": correction,
        "what_exists": {
            "staging.graha_tickets": has_tickets,
            "its_columns": columns,
            "ticket_rows_in_this_org": rows_here,
            "staging.graha_ticket_messages": has_messages,
            "any_sla_column": sla_column,
        },
        "what_would_have_to_exist": list(SLA_PREREQUISITES),
        "counts": {
            "ticket_tables_present": int(has_tickets) + int(has_messages),
            "ticket_rows_in_this_org": rows_here if rows_here is not None else 0,
            "sla_columns_found": int(sla_column),
            "prerequisites_unmet": len(SLA_PREREQUISITES),
        },
        "limitations": [
            "NO SLA IS COMPUTED AND NONE CAN BE. This handler measures the "
            "product, not the firm's tickets, and it will keep returning the "
            "same answer until somebody decides to rebuild the helpdesk.",
            "A zero here is NOT 'no breaches'. It is 'no ticket can exist' — the "
            "table has no write path anywhere in the product, so an empty result "
            "is a fact about the schema and says nothing at all about how fast "
            "this firm answers anybody.",
            "The absence of a write path was established by a source search of "
            "this repository on 2026-08-20, not by a database query. A job "
            "outside this repository writing to the table would not be seen "
            "here — though the row count above would then not be zero.",
            "Client questions DO arrive in this product, through "
            "`staging.varta_conversations` and `staging.graha_inbound_emails`. "
            "An SLA watch over one of THOSE is a buildable skill; an SLA watch "
            "over tickets is not, and the two must not be confused.",
        ],
    }
