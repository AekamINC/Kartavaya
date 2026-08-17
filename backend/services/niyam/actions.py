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
    outcome: str                       # 'ok' | 'refused' | 'failed' | 'skipped'
    detail: dict
    outbound_id: Optional[int] = None


def _ok(**detail) -> ActionResult:
    return ActionResult("ok", detail)


def _refused(reason: str, **detail) -> ActionResult:
    return ActionResult("refused", {"reason": reason, **detail})


def _failed(reason: str, **detail) -> ActionResult:
    return ActionResult("failed", {"reason": reason, **detail})


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
            "INSERT INTO public.task_comments (comment_id, task_id, user_id, body) "
            "VALUES ($1::text, $2::text, $3::text, $4::text)",
            comment_id, task_id, actor, body)

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
            "SELECT DISTINCT user_id FROM staging.user_roles "
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

        recipients = await _members_only(
            conn, resolve_recipients(config.get("to"), event),
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
                            "reason": r.reason})
            if first_outbound is None:
                first_outbound = r.outbound_id

        delivered = [r for r in results if r["outcome"] == "ok"]
        if not delivered:
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
                                     TaskAddComment())}
