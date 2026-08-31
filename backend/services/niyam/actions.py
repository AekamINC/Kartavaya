"""The closed allowlist. A rule can do these things and nothing else.

WHY A CLOSED LIST AND NOT A PLUGIN POINT
----------------------------------------
Two of the four standing rules are enforced by this file being a fixed dict:

  * "No rule moves money." There is no `invoice.create`, no `payment.record`,
    no write to any paid state. Adding one is a reviewed code change, not a
    config change — which is the only version of that promise worth making.
  * "No rule calls a model." There is no generative verb, and the import ratchet
    keeps it that way.

WHY EACH VERB WRITES ITS OWN SQL, RELUCTANTLY
---------------------------------------------
Proposal 55 §5 says an action must "call the same service function a human's
click calls". A survey of the codebase found that function does not exist for
ANY of the eight verbs — `services/` holds validators and side-effect helpers,
never mutators, and every write lives inline in a route handler. So there is
nothing to call.

Worse, the handlers disagree with each other. FIVE code paths set `tasks.status`
and only two of them stamp `completed_at`: `toggle_task` and `move_task` do;
`update_task` — the PUT the edit form uses — and the bulk route do not. So "do
what a human does" has no single answer, and the obvious choice is the wrong
one: modelling on `update_task` reproduces the exact defect §5 blames on the old
engine (a task an automation completed, with a NULL completion timestamp), while
looking correct in review because it matches a real human path.

Each verb therefore composes the pieces that DO exist — `assert_transition`,
`assert_may_write_task`, `log_event` — around its own explicit UPDATE, and
copies the most complete human path rather than the most central one. Every
deviation is commented, because the next person will diff this against a route
handler and needs to know which differences are deliberate.

ROBOTS ARE NOT APPROVERS
------------------------
The validators already model this: `is_task_approver` returns False for
`user=None` with the comment "No person — an automation", and
`assert_may_write_task` returns early when there is no user. So an action passes
`user=None` and inherits refusal-by-design on anything needing an approver
identity, rather than borrowing the rule author's.
"""
from __future__ import annotations

import logging
from typing import Any, NamedTuple, Optional

log = logging.getLogger(__name__)


class ActionResult(NamedTuple):
    #: 'ok' | 'deferred' | 'refused' | 'failed' | 'skipped'
    #:
    #: `deferred` means "not now, but yes at `retry_after`" — the engine sets
    #: the run's `wake_at` to it and re-runs THIS step rather than finishing.
    #: See `send.Delivery` for why it is not a flavour of `refused`.
    outcome: str
    detail: dict
    outbound_id: Optional[int] = None
    #: Aware UTC, set only on 'deferred'.
    retry_after: Optional[object] = None


def _ok(**detail) -> ActionResult:
    return ActionResult("ok", detail)


def _refused(reason: str, **detail) -> ActionResult:
    return ActionResult("refused", {"reason": reason, **detail})


def _failed(reason: str, **detail) -> ActionResult:
    return ActionResult("failed", {"reason": reason, **detail})


def _deferred(reason: str, retry_after, **detail) -> ActionResult:
    return ActionResult("deferred", {"reason": reason, **detail},
                        retry_after=retry_after)


# ── task.set_status ──────────────────────────────────────────────────────────

class TaskSetStatus:
    verb = "task.set_status"

    def describe(self, config: dict, event: dict) -> str:
        return (f"set task {event.get('entity_id')} to "
                f"{config.get('status')!r}")

    async def run(self, conn, *, config: dict, event: dict) -> ActionResult:
        from services.task_transitions import assert_transition, TASK_STATUSES

        new_status = config.get("status")
        task_id = event.get("entity_id")
        if new_status not in TASK_STATUSES:
            return _failed(f"`{new_status}` is not a task status",
                           allowed=sorted(TASK_STATUSES))
        if not task_id:
            return _failed("the event names no task")

        row = await conn.fetchrow(
            "SELECT task_id, team_id, status FROM public.tasks WHERE task_id = $1::text",
            task_id)
        if row is None:
            # Deleted between the event and the run. Normal under any delay, and
            # emphatically not a failure of the rule.
            return _refused("the task no longer exists", task_id=task_id)
        if row["status"] == new_status:
            return ActionResult("skipped", {"reason": "already in that status",
                                            "status": new_status})

        try:
            # user=None on purpose. The policy reads that as "an automation" and
            # refuses anything requiring an approver, instead of inheriting the
            # rule author's authority — a robot is not an approver.
            await assert_transition(conn, old_status=row["status"],
                                    new_status=new_status,
                                    team_id=row["team_id"], user=None)
        except Exception as exc:
            # The policy raises HTTPException, which is an HTTP concept
            # surfacing inside an engine with no request. Caught and turned into
            # a refusal, because it IS a refusal — the transition is not allowed
            # — and letting it propagate would read as an engine fault.
            return _refused(f"the transition policy refused it: {exc}",
                            frm=row["status"], to=new_status)

        # completed_at is stamped HERE. `update_task` does not, and copying it
        # would give automation-completed tasks a NULL completion timestamp —
        # the precise bug this design exists to stop.
        done = new_status == "done"
        await conn.execute(
            """
            UPDATE public.tasks
               SET status = $1::text,
                   completed_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
                   updated_at = NOW()
             WHERE task_id = $3::text
            """,
            new_status, done, task_id)

        try:
            from services.activity_logger import log_event
            await log_event(conn, task_id=task_id, team_id=row["team_id"],
                            actor_id=None, event_type="status_changed",
                            data={"from": row["status"], "to": new_status,
                                  "by": "niyam"})
        except Exception:
            # History is important and is not worth failing a completed write
            # over. The task moved; saying so is best-effort.
            log.warning("niyam: could not log activity for %s", task_id, exc_info=True)

        return _ok(reason=f"moved it from {row['status']!r} to {new_status!r}",
                   task_id=task_id, frm=row["status"], to=new_status)


# ── task.add_comment ─────────────────────────────────────────────────────────

def system_actor_id(org_id) -> str:
    """The per-org Niyam account's user_id — computed, never looked up.

    Deterministic — 'niyam_' + the org id's 32 hex characters — so authoring a
    comment costs zero lookups; migration 148 seeded one such row per org and
    `admin_orgs.create_org` writes one for every org created since. The prefix
    can never collide with a human row (canonical ids are `user_<12 hex>`), but
    nothing EXCLUDES on the prefix: hiding rides the `is_system` column.
    """
    return "niyam_" + str(org_id).replace("-", "")


async def _ensure_system_actor(conn, org_id) -> str:
    """Return the org's system actor id, seeding the row if it is missing.

    The healing INSERT covers an org that somehow has no account — created in
    the gap before the `create_org` hook, or restored from a partial backup.
    Same pattern as `credits.balance_of`: one writer shape, idempotent, and the
    row appears the first time it is needed instead of failing forever.
    """
    uid = system_actor_id(org_id)
    exists = await conn.fetchval(
        "SELECT 1 FROM public.users WHERE user_id = $1::text", uid)
    if not exists:
        await conn.execute(
            "INSERT INTO public.users (user_id, email, name, full_name, "
            "                          password_hash, salt, role, is_system) "
            "VALUES ($1::text, "
            "        'niyam+' || replace($2::text, '-', '') "
            "            || '@system.kartavaya.invalid', "
            "        'Niyam', 'Niyam', '!system-account-cannot-log-in', "
            "        '!none', 'member', TRUE) "
            "ON CONFLICT (user_id) DO NOTHING",
            uid, str(org_id))
    return uid


class TaskAddComment:
    verb = "task.add_comment"

    def describe(self, config: dict, event: dict) -> str:
        return f"comment on task {event.get('entity_id')}"

    async def run(self, conn, *, config: dict, event: dict) -> ActionResult:
        import uuid as _uuid

        body = (config.get("body") or "").strip()
        task_id = event.get("entity_id")
        org_id = event.get("org_id")
        if not body:
            return _failed("the rule has no comment body")
        if not task_id:
            return _failed("the event names no task")
        if not org_id:
            # The author is PER-ORG; with no org there is no account to write
            # as. `emit.py` never writes an org-less event, so this guards a
            # future caller, not a live path.
            return _failed("the event carries no org")

        row = await conn.fetchrow(
            "SELECT task_id FROM public.tasks WHERE task_id = $1::text",
            task_id)
        if row is None:
            # Deleted between the event and the run — normal under any delay.
            return _refused("the task no longer exists", task_id=task_id)

        actor = await _ensure_system_actor(conn, org_id)
        comment_id = f"cmt_{_uuid.uuid4().hex[:12]}"
        # The four-column shape `add_comment` (server.py) uses when
        # `is_client_visible` is absent — PROPOSED_072 is unapplied. If it ever
        # lands, its default is FALSE, which is exactly right here: an
        # automation's words are internal until a human decides otherwise.
        await conn.execute(
            "INSERT INTO public.task_comments (comment_id, task_id, user_id, body, org_id) "
            "VALUES ($1::text, $2::text, $3::text, $4::text, $5::uuid)",
            comment_id, task_id, actor, body, org_id)

        # DELIBERATE deviations from the human route, each because the author
        # is a robot: no notification fan-out and no push (a rule that should
        # tell somebody pairs this with `notify.send`, which runs recipients
        # through prefs_verdict — duplicating delivery here would bypass quiet
        # hours), and no `process_mentions` (an automation typing "@name" must
        # not file a mention row claiming a person addressed you).
        try:
            from services.activity_logger import log_event
            await log_event(conn, task_id=task_id, actor_id=actor,
                            event_type="commented",
                            data={"preview": body[:80], "by": "niyam"})
        except Exception:
            # Same polarity as TaskSetStatus: the comment landed; saying so in
            # the activity feed is best-effort.
            log.warning("niyam: could not log activity for %s", task_id,
                        exc_info=True)

        return _ok(reason="commented on the task",
                   task_id=task_id, comment_id=comment_id)


# ── task.create ──────────────────────────────────────────────────────────────

class TaskCreateAction:
    """Create a follow-up task — the checklist verb.

    "When a deal is won, make the handover task" is the second-commonest thing
    anyone wants from an automation (after being told). The task is authored
    by the org's system account, lands in a team the RULE names (most events —
    a deal, a client, a payslip — belong to no team, so the target cannot come
    from the event), and starts in that team's first column as 'todo'.

    DELIBERATELY does not emit `task.created`, following TaskSetStatus's
    precedent for robot writes: an action that emitted would let one rule
    trigger another, and a rule chain is a loop with extra steps. The activity
    log still says a robot did it. No assignees in v1 — assignment carries
    notification and workload questions this verb does not yet answer
    honestly; a rule that should tell somebody pairs this with `notify.send`.
    """

    verb = "task.create"

    def describe(self, config: dict, event: dict) -> str:
        return f"create a task {config.get('title')!r}"

    async def run(self, conn, *, config: dict, event: dict) -> ActionResult:
        import uuid as _uuid

        title = (config.get("title") or "").strip()
        team_id = config.get("team_id")
        description = (config.get("description") or "").strip() or None
        org_id = event.get("org_id")
        if not title:
            return _failed("the rule has no task title")
        if not team_id:
            return _failed("the rule names no project team")
        if not org_id:
            return _failed("the event carries no org")

        # Fail-closed on the one hop that could cross a tenant boundary: the
        # team the rule names must belong to the org the event happened in.
        # Rules are org-scoped rows, but a config is authored text — verify at
        # run time, never trust it.
        team = await conn.fetchrow(
            "SELECT team_id, org_id FROM public.teams WHERE team_id = $1::text",
            team_id)
        if team is None:
            return _refused("the project team no longer exists", team_id=team_id)
        if str(team["org_id"]) != str(org_id):
            return _refused("the team belongs to a different organisation")

        actor = await _ensure_system_actor(conn, org_id)
        col = await conn.fetchval(
            "SELECT column_id FROM public.project_columns "
            " WHERE team_id = $1::text ORDER BY sort_order LIMIT 1",
            team_id)
        task_id = f"task_{_uuid.uuid4().hex[:12]}"
        await conn.execute(
            "INSERT INTO public.tasks (task_id, team_id, column_id, "
            "                          created_by_user_id, title, description, "
            "                          status, priority, org_id) "
            "VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, "
            "        $6::text, 'todo', $7::text, $8::uuid)",
            task_id, team_id, col, actor, title, description,
            config.get("priority") or "medium", org_id)

        try:
            from services.activity_logger import log_event
            await log_event(conn, task_id=task_id, team_id=team_id,
                            actor_id=actor, event_type="created",
                            data={"title": title[:80], "by": "niyam"})
        except Exception:
            log.warning("niyam: could not log activity for %s", task_id,
                        exc_info=True)

        return _ok(reason=f"created the task {title!r}",
                   task_id=task_id, team_id=team_id)


# ── who a rule notifies ──────────────────────────────────────────────────────

#: Recipient TOKENS, resolved per event rather than stored as ids.
#:
#: "Tell whoever asked for it" is the commonest thing anyone wants from an
#: automation, and it is meaningless as a hardcoded user id — the answer is
#: different for every task. So a rule stores the QUESTION and the engine
#: answers it against the event in front of it.
#:
#: Each reads a field the registry already guarantees, which is why this could
#: not have worked before this session: `created_by` used to read
#: `tasks.user_id` — the personal-task owner — and was null in 100% of emitted
#: events, so `@creator` would have resolved to nobody every single time and
#: looked like a working feature.
RECIPIENT_TOKENS = {
    "@creator":   lambda after: [after.get("created_by")],
    "@assignees": lambda after: list(after.get("assignee_user_ids") or []),
}

#: Tokens that need the DATABASE rather than the payload. "@org_admins" exists
#: because the org-shaped temporal events (a product ran low, a day's
#: attendance summarised) have no creator and no assignees — there is nobody
#: IN the payload to tell, and the honest recipient is whoever runs the org.
#: Resolved inside `NotifySend.run` where a connection is in hand;
#: `resolve_recipients` stays synchronous and payload-only.
DB_TOKENS = frozenset({"@org_admins"})


async def _org_admins(conn, org_id) -> list:
    """The people `@org_admins` means for THIS event's org.

    FAILS CLOSED, same polarity and same reason as `_members_only`: if the
    role lookup is down, the wrong answer is a broadcast, not a silence.
    """
    if not org_id:
        return []
    try:
        rows = await conn.fetch(
            "SELECT DISTINCT user_id FROM public.user_roles "
            " WHERE org_id = $1::uuid AND role_code IN ('org_admin', 'org_owner')",
            str(org_id))
    except Exception:
        log.exception("niyam: could not resolve @org_admins — notifying nobody")
        return []
    return [r["user_id"] for r in rows]


def resolve_recipients(named, event: dict) -> list:
    """Turn a rule's `to` list into concrete user ids for THIS event.

    Unknown entries are passed through as literal user ids, so a rule may mix
    "@assignees" with a named person. Duplicates are collapsed and order is
    preserved, because the same person being both creator and assignee must not
    be notified twice for one event.
    """
    if isinstance(named, str):
        named = [named]
    after = ((event or {}).get("payload") or {}).get("after") or {}
    out, seen = [], set()
    for entry in (named or []):
        resolved = RECIPIENT_TOKENS[entry](after) if entry in RECIPIENT_TOKENS else [entry]
        for user_id in resolved:
            if user_id and user_id not in seen:
                seen.add(user_id)
                out.append(user_id)
    return out


# ── notify.send ──────────────────────────────────────────────────────────────

async def _members_only(conn, user_ids: list, *, org_id) -> list:
    """Drop any recipient who is not a member of the event's org.

    ── WHY THIS IS NOT PARANOIA ───────────────────────────────────────────

    `resolve_recipients` passes an unrecognised entry through as a literal user
    id, so a rule may name a specific person as well as a token. Validation
    checks only that the list is non-empty and within MAX_RECIPIENTS — it never
    asks who these people are. And `public.notifications` has no `org_id` column
    and no foreign keys, and every reader filters on `user_id` ALONE.

    So without this, a rule authored in one org could write into any user's
    notification list in any tenant, and a typo would write a silent orphan row
    addressed to nobody. The tokens (`@creator`, `@assignees`) were never the
    risk — `rules_for` already scopes the rule to the event's org — the literal
    pass-through was.

    Filters rather than refuses: a rule naming somebody who has since left the
    org should still reach everyone else, and `NotifySend.run` already has an
    honest outcome for "this resolved to nobody".

    FAILS CLOSED. If the membership lookup itself fails, nobody is notified.
    Every other failure polarity in this engine is argued from consequence, and
    the consequence here is writing into a stranger's notification list.
    """
    if not user_ids:
        return []
    if not org_id:
        # An event with no org cannot have its recipients checked against one.
        # `emit.py` will not write such an event, so this is a guard against a
        # future caller, not a live path.
        log.warning("niyam: refusing to notify — the event carries no org")
        return []
    try:
        rows = await conn.fetch(
            "SELECT DISTINCT user_id FROM public.user_roles "
            " WHERE org_id = $1::uuid AND user_id = ANY($2::text[])",
            str(org_id), list(user_ids))
    except Exception:
        log.exception("niyam: could not verify org membership — notifying nobody")
        return []
    allowed = {r["user_id"] for r in rows}
    dropped = [u for u in user_ids if u not in allowed]
    if dropped:
        # Counted, never named: a user id in a log is still a user id.
        log.warning("niyam: dropped %d recipient(s) who are not members of org %s",
                    len(dropped), org_id)
    return [u for u in user_ids if u in allowed]


class NotifySend:
    verb = "notify.send"

    def describe(self, config: dict, event: dict) -> str:
        who = resolve_recipients(config.get("to"), event)
        named = config.get("to") or []
        return (f"notify {len(who)} person(s) via {config.get('channel', 'inapp')}"
                if who else f"notify nobody — {named!r} resolved to no one")

    async def run(self, conn, *, config: dict, event: dict) -> ActionResult:
        # Imported here rather than at module scope so the allowlist can be read
        # (and `describe`d for a dry run) without dragging in the send layer.
        from .send import deliver

        resolved = resolve_recipients(config.get("to"), event)
        if any(r in DB_TOKENS for r in resolved):
            # `resolve_recipients` passes an unknown entry through as a
            # literal user id, so a database token arrives here intact —
            # expanded in place to keep the author's ordering, deduplicated
            # against people already named.
            admins = await _org_admins(conn, event.get("org_id"))
            out, seen = [], set()
            for r in resolved:
                for user_id in (admins if r in DB_TOKENS else [r]):
                    if user_id and user_id not in seen:
                        seen.add(user_id)
                        out.append(user_id)
            resolved = out
        recipients = await _members_only(
            conn, resolved,
            org_id=event.get("org_id"))
        if not recipients:
            # Distinguished from "the rule names nobody", which validation
            # already refuses at save time. This is a token that resolved to
            # nobody ON THIS EVENT — an unassigned task, a personal task with no
            # creator — which is a fact about the data and therefore a refusal,
            # not a fault.
            return _refused("nobody to notify on this event",
                            named=config.get("to"))

        title = (config.get("title") or "").strip()
        body = (config.get("body") or "").strip()
        if not title:
            return _refused("the rule has no title to send")

        channel = config.get("channel", "inapp")
        results = []
        first_outbound: Optional[int] = None
        for user_id in recipients[:20]:
            r = await deliver(conn, user_id=user_id, kind=config.get("kind", "automation"),
                              title=title, body=body,
                              org_id=str(event.get("org_id")),
                              channel=channel)
            results.append({"user_id": user_id, "outcome": r.outcome,
                            "reason": r.reason,
                            "retry_after": r.retry_after})
            if first_outbound is None:
                first_outbound = r.outbound_id

        delivered = [r for r in results if r["outcome"] == "ok"]
        if not delivered:
            # ── NOBODY REACHED. WAS IT "NO" OR "NOT YET"? ──────────────────
            #
            # This answered `refused` either way, and the engine then finished
            # the run — so a send suppressed by quiet hours was destroyed
            # rather than delayed (suite 16.14).
            #
            # If ANY recipient was deferred, the step is deferred, and the
            # engine re-runs it at the EARLIEST of their wake times. Earliest,
            # not latest: waking early means the people whose window has ended
            # are delivered to and the rest defer again, which converges. The
            # latest would silence the early risers until the last person's
            # morning.
            #
            # ⚠ THE DEFERRAL DOES NOT SURVIVE THE REFUSERS. Recipients who were
            # refused for a PREFERENCE stay refused on the re-run — `deliver`
            # re-asks and gets the same final answer — so this cannot turn "do
            # not tell me about this" into a message at 07:00.
            deferred = [r for r in results if r["outcome"] == "deferred"]
            if deferred:
                whens = [r["retry_after"] for r in results
                         if r["outcome"] == "deferred" and r.get("retry_after")]
                return _deferred(
                    f"quiet hours for {len(deferred)} of {len(results)} "
                    f"recipient(s) — held rather than dropped",
                    min(whens) if whens else None,
                    recipients=results)
            return ActionResult("refused",
                                {"reason": "every recipient was suppressed",
                                 "recipients": results})
        # `reason` is the ONLY thing the runs pane prints. Without it the one run
        # that matters most — the armed send that actually reached somebody —
        # renders as a blank line beneath an "ok" chip, and the rule looks like
        # it did nothing. It COUNTS people rather than naming them: `recipients`
        # carries user ids for support, and a user id is never rendered.
        n = len(delivered)
        where = {"inapp": "in the app", "push": "by push",
                 "email": "by email"}.get(channel, f"via {channel}")
        return ActionResult("ok",
                            {"reason": f"notified {n} "
                                       f"{'person' if n == 1 else 'people'} {where}",
                             "delivered": n,
                             "recipients": results}, first_outbound)


# ── invoice.remind_customer ──────────────────────────────────────────────────

class InvoiceRemindCustomer:
    """The customer rung of the A4 ladder (catalogue #1, approved).

    "Chases an unpaid invoice on a schedule … stops the moment the customer
    pays, part-pays, or you put it on hold." The SCHEDULE is the predicate:
    `invoices_overdue` re-fires weekly per invoice while it stays unpaid, so
    the cadence lives in the trigger and this verb sends exactly one note per
    firing. No wait steps — a wait inside a run would overlap with next
    week's re-fire and double the sends, the precise shape of bug the old
    estate was retired for.

    THE STOPS ARE RE-CHECKED AT RUN TIME, not read from the event. "Paid"
    only ever arrives by bank reconciliation, so the event snapshot can be
    days staler than the ledger; every stop below reads the CURRENT row:

      · paid, or nothing outstanding      → refused, chase over
      · any part-payment                  → refused — the catalogue promises
        part-pay stops the chase (money is moving; a dunning note now reads
        as a threat to somebody who is already paying)
      · cancelled or deactivated          → refused
      · ("on hold" is not a state invoices have yet; when it exists it joins
        this list)

    The ADDRESS comes from the firm's own CRM, most precise first: the
    contact the invoice was raised to (`contact_id`), else the client
    company's contacts — but only when exactly ONE active contact carries an
    address. Several candidates is a data fact ("the invoice names nobody
    and the client has three inboxes"), and guessing which colleague gets a
    payment demand is not this engine's call.

    The send goes through `send.deliver_customer_email`, where the
    `NIYAM_CUSTOMER_MAIL` gate (A0 Q1, off by default) refuses everything
    until the owner opens it — this verb ships writable but inert.
    """

    verb = "invoice.remind_customer"

    def describe(self, config: dict, event: dict) -> str:
        after = ((event or {}).get("payload") or {}).get("after") or {}
        n = after.get("invoice_number") or event.get("entity_id")
        return f"email the customer a payment reminder for invoice {n}"

    async def run(self, conn, *, config: dict, event: dict) -> ActionResult:
        from .send import deliver_customer_email

        invoice_id = event.get("entity_id")
        org_id = event.get("org_id")
        if not invoice_id:
            return _failed("the event names no invoice")
        if not org_id:
            return _failed("the event carries no org")

        row = await conn.fetchrow(
            """
            SELECT invoice_number, invoice_date, due_date,
                   total::float          AS total,
                   amount_paid::float    AS amount_paid,
                   COALESCE(balance_due, 0)::float AS balance_due,
                   payment_status, cancelled_at, is_active,
                   contact_id::text      AS contact_id,
                   client_id::text       AS client_id
              FROM public.ganit_invoices
             WHERE id = $1::uuid AND org_id = $2::uuid
            """,
            invoice_id, str(org_id))
        if row is None:
            return _refused("the invoice no longer exists", invoice=invoice_id)

        # ── the stops, current-state, in the order a human would give them ──
        if row["cancelled_at"] is not None or not row["is_active"]:
            return _refused("the invoice was cancelled — the chase is over",
                            invoice=row["invoice_number"])
        if row["payment_status"] == "paid" or row["balance_due"] <= 0:
            return _refused("the invoice is paid — the chase is over",
                            invoice=row["invoice_number"])
        if (row["amount_paid"] or 0) > 0:
            return _refused(
                "a part-payment has arrived, and the catalogue promises "
                "part-pay stops the chase", invoice=row["invoice_number"])

        # ── the address, most precise source first ──────────────────────────
        address, source = None, None
        if row["contact_id"]:
            address = await conn.fetchval(
                "SELECT NULLIF(TRIM(email), '') FROM public.graha_contacts "
                "WHERE id = $1::uuid AND org_id = $2::uuid AND is_active",
                row["contact_id"], str(org_id))
            source = "the contact the invoice was raised to"
        if not address and row["client_id"]:
            candidates = await conn.fetch(
                "SELECT NULLIF(TRIM(email), '') AS email "
                "FROM public.graha_contacts "
                "WHERE client_id = $1::uuid AND org_id = $2::uuid "
                "  AND is_active AND NULLIF(TRIM(email), '') IS NOT NULL",
                row["client_id"], str(org_id))
            if len(candidates) == 1:
                address = candidates[0]["email"]
                source = "the client company's one contact with an address"
            elif len(candidates) > 1:
                return _refused(
                    f"the invoice names no contact and the client has "
                    f"{len(candidates)} contacts with addresses — choosing "
                    f"who receives a payment demand is not a guess this "
                    f"engine makes", invoice=row["invoice_number"])
        if not address:
            return _refused("no customer address on the invoice or its client",
                            invoice=row["invoice_number"])

        # ── compose. Plain text; the send layer escapes wholesale ───────────
        n = row["invoice_number"]
        due = row["due_date"].isoformat() if row["due_date"] else "its due date"
        body = (f"This is a payment reminder for invoice {n}, "
                f"issued on {row['invoice_date'].isoformat()} and due on {due}. "
                f"An amount of INR {row['balance_due']:,.2f} remains "
                f"outstanding. If you have already made this payment, please "
                f"disregard this note — bank transfers can take a few days to "
                f"reconcile.")
        d = await deliver_customer_email(
            conn, address=address, subject=f"Payment reminder — invoice {n}",
            body=body, purpose="invoice_reminder",
            ref=f"niyam:invoice:{invoice_id}")

        if d.outcome != "ok":
            # The gate refusing is the shipped state, and the runs pane must
            # say WHICH gate, not render a generic failure.
            return ActionResult(d.outcome,
                                {"reason": d.reason, "invoice": n},
                                d.outbound_id)
        # The address itself stays out of the detail: outbound_log holds it,
        # and the runs pane renders `reason` — a customer inbox is not a thing
        # to print beside a rule name.
        return ActionResult("ok",
                            {"reason": f"emailed {source} about invoice {n}",
                             "invoice": n},
                            d.outbound_id)


# ── report.send ──────────────────────────────────────────────────────────────

class ReportSend:
    """Mail a scheduled module report — the verb that finally un-stubs 027.

    `dristi_scheduled_reports` shipped in migration 027 with a UI that saves
    rows and a dispatcher that was a 501 stub from that day to this. This verb
    is the delivery half: the `reports_due` predicate turns the schedule's
    calendar into `report.due` events, and this verb turns one event into one
    email per recipient.

    EVERYTHING IS RE-READ AT RUN TIME. The event names the schedule; the row —
    active flag, recipients, type, `last_sent_at` — is read fresh on this
    connection, because a schedule edited between the sweep and the run must be
    honoured as edited (the invoice verb above re-checks "paid" for the same
    reason).

    WHAT THE REPORT IS: `services/module_report` — the SAME resolution the
    module page shows and the download route serves, with `gate=None`, so every
    foreign-module widget a saved view carries is withheld in words. A robot
    must not hand out numbers nobody's entitlement was checked for.

    MEMBERS ONLY. Recipients are free-text addresses; only those that belong
    to a member of THIS org are mailed, and the rest are skipped by count in
    the stated outcome. Nothing Niyam sends may leave the firm — the customer
    gate (`NIYAM_CUSTOMER_MAIL`) governs dunning mail, and quietly widening it
    to carry whole finance reports to outside inboxes is not this verb's call.
    Underneath, `email_service.send_email` is the one choke point:
    `OUTBOUND_MODE`, `_safe_subject`, `outbound_log`.

    `file_formats` is deliberately unread: the gated transport has no
    attachment support, so v1 mails the letterhead HTML as the body — the
    same tables, the same stated absences the pdf branch renders to bytes.
    `last_sent_at` is the duplicate guard, checked at entry AND stamped
    (guarded, autocommit) BEFORE the delivery loop — the engine runs actions
    with no transaction and a sent email cannot be rolled back, so the stamp
    ordering, not atomicity, is what keeps a resumed or twice-claimed run
    from mailing the org twice.
    """

    verb = "report.send"

    def describe(self, config: dict, event: dict) -> str:
        after = ((event or {}).get("payload") or {}).get("after") or {}
        n = after.get("name") or "a scheduled report"
        return f"email the '{n}' report to its recipients"

    async def run(self, conn, *, config: dict, event: dict) -> ActionResult:
        import asyncio
        from datetime import datetime, timezone

        from services.module_report import (
            MODULE_TITLES, REPORT_TYPE_MODULES, member_recipients,
            module_arrangement, render_report_html, report_entry,
            schedule_blocked_reason, schedule_window)

        schedule_id = event.get("entity_id")
        org_id = event.get("org_id")
        if not schedule_id:
            return _failed("the event names no schedule")
        if not org_id:
            return _failed("the event carries no org")

        row = await conn.fetchrow(
            """
            SELECT org_id, name, report_type, frequency, recipients,
                   is_active, last_sent_at, created_by
              FROM public.dristi_scheduled_reports
             WHERE id = $1::uuid AND org_id = $2::uuid
            """,
            schedule_id, str(org_id))
        if row is None:
            return _refused("the schedule no longer exists",
                            schedule=schedule_id)
        if not row["is_active"]:
            return _refused("the schedule was switched off after the sweep "
                            "found it", report=row["name"])

        # `last_sent_at` is THE duplicate guard, and it is re-checked HERE
        # because the engine gives an action no transaction to hide in: two
        # enabled rules on report.due both claim runs off one event, a
        # same-window dristi sweep reads the column before either door
        # stamps, and the stranded-run reaper re-executes a run that died
        # mid-flight. All three arrive at this line, and all three leave at
        # it once somebody has stamped today.
        if row["last_sent_at"] is not None and \
                row["last_sent_at"].date() >= datetime.now(timezone.utc).date():
            return _refused("already sent today — last_sent_at is the guard",
                            report=row["name"])

        module = REPORT_TYPE_MODULES.get(row["report_type"])
        if module is None:
            return _refused(
                f"a {row['report_type']!r} report has no module arrangement "
                f"to render — custom dashboard delivery is not built yet",
                report=row["name"])

        # Entitlement, re-checked at delivery against the schedule's OWNER —
        # the same rule the other two doors enforce (run-now checks the
        # presser, the dristi sweep checks the owner). gate=None below only
        # withholds FOREIGN widgets; without this check the report's own
        # module rendered for a creator who lost the module, left the org,
        # or whose org's subscription lapsed — the exact bypass the source-
        # module map exists to close.
        blocked = await schedule_blocked_reason(conn, dict(row))
        if blocked:
            return _refused(blocked, report=row["name"])

        members, skipped = await member_recipients(
            conn, str(org_id), row["recipients"])
        if not members:
            reason = ("none of the schedule's recipients is a member of "
                      "this org — Niyam mails members only")
            await conn.execute(
                "INSERT INTO public.dristi_report_logs "
                "(scheduled_report_id, org_id, status, recipients_count, error) "
                "VALUES ($1::uuid, $2::uuid, 'skipped', 0, $3)",
                schedule_id, str(org_id), reason)
            return _refused(reason, report=row["name"])

        win = schedule_window(row["frequency"], row["last_sent_at"])

        # ── the report, exactly as the page resolves it ─────────────────────
        from services.gst_period import load_org

        label = MODULE_TITLES.get(module, module)
        layout, _source = await module_arrangement(conn, None, str(org_id),
                                                  module)
        gate_cache: dict = {}
        # `report_entry`, NOT `report_widget`. A saved layout may hold a
        # SECTION ({"report": ...}) as well as a metric widget, and
        # `report_widget` handed a section renders "This metric is no longer
        # measured" under the label "None" — a register silently replaced by a
        # wrong sentence, on a document this code EMAILS. It does not raise,
        # which is what makes it dangerous: nobody finds out.
        #
        # `report_entry` dispatches on `is_section` — the one test the
        # validator and the renderer share — so this door and /module-report
        # cannot disagree about what a layout entry is.
        widgets = [await report_entry(conn, str(org_id), module, win, w,
                                      None, gate_cache)
                   for w in layout]
        org = await load_org(conn, str(org_id))
        period_line = (f"{win.start.strftime('%d %b %Y')} – "
                       f"{win.end.strftime('%d %b %Y')}")
        # Off the loop: the letterhead's logo embed performs a BLOCKING
        # httpx.get (up to 4 MB), and the engine's loop carries every rule.
        html = await asyncio.to_thread(
            render_report_html, org, label, period_line, widgets)

        subject = f"{row['name']} — {label} report"
        ref = f"niyam:report:{schedule_id}"
        from .send import deliver_report_email

        # THE STAMP GOES FIRST, and honestly: the engine gives an action no
        # transaction (every statement here autocommits), and an email that
        # left cannot be rolled back — so "stamp and send atomically" is not
        # a thing this code can promise. What it CAN choose is which failure
        # costs less. Stamp-first means a crash mid-loop loses one partially
        # delivered day (visible: no 'sent' log row); stamp-last meant the
        # stranded-run reaper re-executed the whole loop and mailed every
        # member twice. A missed day is an apology; a duplicate blast is a
        # trust problem. The transition guard makes a concurrent second run
        # lose here too, not just at the top re-check.
        _stamped = await conn.fetchrow(
            "UPDATE public.dristi_scheduled_reports "
            "SET last_sent_at = NOW() "
            "WHERE id = $1::uuid "
            "  AND (last_sent_at IS NULL OR last_sent_at::date < NOW()::date) "
            "RETURNING id",
            schedule_id)
        if _stamped is None:
            return _refused("already sent today — last_sent_at is the guard",
                            report=row["name"])

        sent = 0
        for address in members:
            d = await deliver_report_email(
                conn, address=address, subject=subject,
                html_document=html, ref=ref)
            if d.outcome == "ok":
                sent += 1
            else:
                log.warning("niyam report.send: %s", d.reason)
        if sent == 0:
            await conn.execute(
                "INSERT INTO public.dristi_report_logs "
                "(scheduled_report_id, org_id, status, recipients_count, error) "
                "VALUES ($1::uuid, $2::uuid, 'failed', 0, $3)",
                schedule_id, str(org_id), "the email layer refused every handover")
            return _failed("the email layer refused every handover",
                           report=row["name"])

        note = (f"{skipped} recipient(s) skipped — not members of this org"
                if skipped else None)
        await conn.execute(
            "INSERT INTO public.dristi_report_logs "
            "(scheduled_report_id, org_id, status, recipients_count, error) "
            "VALUES ($1::uuid, $2::uuid, 'sent', $3, $4)",
            schedule_id, str(org_id), sent, note)
        # Addresses stay out of the detail — outbound_log holds them, and the
        # runs pane is not a place to print inboxes.
        detail = {"reason": f"emailed the {label} report to {sent} member(s)",
                  "report": row["name"]}
        if skipped:
            detail["skipped"] = f"{skipped} non-member recipient(s) skipped"
        return ActionResult("ok", detail)


#: THE ALLOWLIST. Nothing dispatches except through this dict.
#:
#: Deliberately short. The design names eight verbs; the missing ones need
#: writes this build cannot yet make honestly — the CRM verbs need the module
#: entitlement gate that only exists as a FastAPI dependency reading
#: `request.state`. Shipping them half-built is what produced the estate this
#: replaces: four of the old engine's seven actions were permanent no-ops that
#: reported success. (`task.add_comment` joined the list once migration 148
#: seeded its author row — the read path INNER JOINs `users`, so the verb was
#: unbuildable before the account existed.)
ACTIONS: dict = {a.verb: a for a in (TaskSetStatus(), NotifySend(),
                                     TaskAddComment(), TaskCreateAction(),
                                     InvoiceRemindCustomer(), ReportSend())}
