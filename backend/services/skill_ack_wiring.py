"""
skill_ack_wiring — which of a skill's fields are identity, and which are material.

`services/skill_ack.py` is the mechanism and is deliberately wired to nothing:
the three-way split (IDENTITY / MATERIAL / INCIDENTAL) is a judgement per skill,
and both ways of getting it wrong are silent. Read THE THREE-WAY SPLIT in that
module before adding an entry here.

ONE SKILL PER COMMIT. That rule is the whole reason this file is a registry
rather than a pile of decorators: each wiring is a one-entry diff that a reader
can weigh on its own. A bulk wiring of sixty skills is sixty unreviewed
judgements arriving as one green build.

Wired so far: 4 of the 61 assigned skills.


== WHY A WIRING NEEDS FOUR THINGS, NOT TWO =================================

`partition_by_ack` asks for `identity_of` and `material_of`. A real handler
needs two more before the filter can be applied to it at all:

  findings_at   A handler does not return a list. `propose_payment_run` returns
                {as_of, horizon_days, total_due, by_bucket, bills, note} and the
                findings are under `bills`. Nothing generic can guess that.

  recompute     THE ONE THAT MATTERS. Suppress four bills and leave `total_due`
                alone and the skill now reports a total that no longer matches
                the list beneath it. That is precisely the defect that made the
                reports page lie — a lifetime figure under a weekly heading —
                and it would be worse here, because the number would be right
                the first time and drift silently with every acknowledgement.
                So a skill whose output carries aggregates must say how to
                rebuild them from the surviving rows, or it does not get wired.

A skill with no aggregates passes `recompute=None`, and that is a real answer
rather than a default: it means somebody looked at the return shape and found
nothing that could go stale.


== THE ANNOTATION, AND A DELIBERATE DEPARTURE ==============================

`partition_by_ack` returns SURVIVING findings unmodified, and its docstring
says why: they go on to be rendered and to ground a model prompt, so adding
keys changes what every downstream reader sees.

This layer adds two keys to them anyway — `_ack_key` and `_ack_state` — and the
reason is that the alternative is worse. Without them the UI cannot acknowledge
anything without recomputing the identity/material split itself, in JavaScript,
from field names it would have to keep in step with this file by hand. That
duplicate judgement would drift, and when it drifted the ack would be filed
under a key the filter never looks up — an acknowledgement that appears to work
and suppresses nothing, for ever, silently. One split, computed once, on the
server.

The keys are underscore-prefixed so a renderer iterating fields skips them by
the same convention `_ack` already uses on the suppressed side.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional, Sequence

from services import skill_ack

Finding = Mapping[str, Any]


@dataclass(frozen=True)
class AckWiring:
    """One skill's answer to "which fields are which"."""

    #: Key in the handler's return dict holding the list of findings.
    findings_at: str

    #: WHICH FACT this is. Must be stable for the whole life of the underlying
    #: fact — if it changes, the acknowledgement is orphaned and the finding
    #: returns as though nobody ever touched it.
    identity_of: Callable[[Finding], Mapping[str, Any]]

    #: The fields whose MOVEMENT voids the acknowledgement. `None` means every
    #: ack for this skill is unconditional — a real choice for findings with no
    #: meaningful amount, and a bad one for anything carrying money.
    material_of: Optional[Callable[[Finding], Mapping[str, Any]]]

    #: Rebuild any aggregate in the return dict from the surviving findings.
    #: `None` asserts there are none. Mutates the dict in place.
    recompute: Optional[Callable[[dict, Sequence[dict]], None]]

    #: What the acknowledgement is called when a human reads the ack list back.
    label_of: Callable[[Finding], str]


# ── propose_payment_run ─────────────────────────────────────────────────────
#
# THE FIRST WIRING, and the example the mechanism was designed around: the same
# overdue vendor bills come back every single run until somebody actually pays a
# vendor, and this skill cannot record a payment.
#
# IDENTITY — `bill` ALONE.
#   The obvious instinct is to key on (bill, vendor), because a bill number is
#   only unique per vendor in the general case. It is wrong here, and the reason
#   is three lines up in the handler: a soft-deleted vendor renders as
#   "(vendor record unavailable)". Put the vendor in the key and deleting a
#   vendor record silently re-keys every one of that vendor's bills, orphaning
#   every acknowledgement against them. `bill` is `bill_number or internal_ref`,
#   both org-scoped and both stable, and the ack table is already scoped by
#   org_id and skill.
#
# MATERIAL — `balance_due` and `status`.
#   Somebody acknowledged a bill of 42,000, not one of 84,000. `total` and
#   `already_paid` are deliberately NOT here: balance is their difference, so
#   they cannot move without moving it, and listing all three would just be the
#   same fact counted three times.
#
# INCIDENTAL — and this is the bucket that decides whether the feature survives
#   contact with a user: `days_past_due` and `ageing` tick with the calendar.
#   Put either in MATERIAL and every acknowledgement dies at the next midnight;
#   the user acks forty bills, comes back tomorrow, finds forty bills, and never
#   acks anything again. `bill_date`, `due_date`, `currency`, `vendor_gstin` and
#   `vendor` are incidental because none of them changes what is owed.

def _payables_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild `total_due` and `by_bucket` from what is left.

    Both are sums over the full list the handler built. Leave them and a run
    that suppressed four bills reports a total for bills it is not showing.
    """
    total = 0.0
    buckets: dict[str, dict] = {}
    for b in surviving:
        balance = float(b.get("balance_due") or 0)
        total += balance
        slot = buckets.setdefault(str(b.get("ageing")), {"count": 0, "amount": 0.0})
        slot["count"] += 1
        slot["amount"] = round(slot["amount"] + balance, 2)
    out["total_due"] = round(total, 2)
    out["by_bucket"] = buckets


# ── the find_overdue family ─────────────────────────────────────────────────
#
# Five registry names — invoices, vendor bills, follow-ups, tasks, stalled
# agreements — share ONE handler, `services/skills/data/overdue_finder.py`, and
# therefore one return shape. They are still five separate wirings, because they
# are five separate skills with five separate ack sets: acknowledging an overdue
# invoice must not silence an overdue task. The shape is shared; the judgement
# about what an acknowledgement MEANS is not, so each gets its own entry and its
# own commit.
#
# THE HANDLER RETURNS A BARE LIST. `_run_function_step` wraps a non-dict result
# as `{"result": ...}` before the ack layer runs, so `findings_at` is "result"
# and not the name of any key the handler itself writes. That wrapping happens
# two lines above the ack block in the dispatcher; if it ever stops, these five
# wirings fail open (`findings` is not a list -> data returned untouched) rather
# than filtering the wrong thing.

def _entity_identity(f: Finding) -> dict:
    """IDENTITY for the find_overdue family: the row, and which ledger it is in.

    `entity.id` is the table's primary key. It is a raw UUID and an excellent
    stable INPUT to the key — `skill_ack.finding_key` hashes it away, so the
    `check-rendered-ids` rule is not breached by using it here.

    `module` rides along because the same handler serves five skills and the
    ack set is keyed by (org, skill, finding_key): a wiring that keyed on the id
    alone would still be correctly scoped, but a future skill that merged two
    modules into one run would silently share keys across ledgers. Naming the
    module costs nothing and is stable for the life of the row.

    NOT `label`: an invoice number can be corrected and a task can be renamed,
    and neither makes it a different overdue thing. NOT `owner`: a task
    reassigned is the same late task.

    The one degenerate case: if `entity.id` were ever absent, every id-less
    finding would hash to the same key. It cannot be absent — it is selected as
    a primary key and stringified unconditionally — and the safe direction if it
    somehow were is that such a finding matches no real acknowledgement, because
    no real acknowledgement was ever filed under the null key.
    """
    entity = f.get("entity") or {}
    return {"module": entity.get("module"), "entity_id": entity.get("id")}


def _entity_label(f: Finding) -> str:
    entity = f.get("entity") or {}
    return f"{entity.get('label')} — {f.get('owner_name')}"


ACK_WIRING: dict[str, AckWiring] = {
    # ── find_overdue_invoices ───────────────────────────────────────────────
    #
    # The receivables chase list. `find_overdue(module="invoices")` returns every
    # unpaid, partial or overdue tax invoice past its due date, every run, and
    # the only thing that removes one is the customer paying. A firm that has
    # agreed thirty days' grace with a client reads the same row for thirty days.
    #
    # IDENTITY — the invoice row plus its module. See `_entity_identity`.
    #
    # MATERIAL — None, and this is the entry where that answer has to be argued
    #   rather than assumed. The finding carries FIVE fields: `entity`,
    #   `owner`, `owner_name`, `days_past`, and the contact/link keys
    #   `reachable` attaches. Not one of them is an amount or a status. The
    #   handler does not select the balance at all, and every state change that
    #   would matter — paid, cancelled, deactivated — removes the row from the
    #   query entirely, so the finding disappears on its own rather than moving.
    #   There is literally no field whose movement could void the ack.
    #
    #   The consequence is stated plainly because it is the cost of this wiring:
    #   an acknowledgement here is UNCONDITIONAL, so an invoice acked at five
    #   days overdue stays hidden at two hundred. `snooze_until` is the honest
    #   instrument for "not this week" and the UI should reach for it first;
    #   a permanent ack here means "stop telling me about this invoice", and
    #   withdrawing it is one DELETE away.
    #
    #   Adding a balance to the handler's return would give this bucket
    #   something real, and it is NOT done here: the same rows feed four other
    #   skills and two of the five modules (tasks, follow-ups) have no amount at
    #   all, so a money field would have to be nullable and would then be
    #   material-for-some-modules — a per-module judgement smuggled into a
    #   shared handler. Recorded as owed, not done quietly.
    #
    # INCIDENTAL — `days_past` ticks with the calendar and is in NEITHER bucket;
    #   it is in `skill_ack._DRIFT_FIELDS`, so putting it in either would raise
    #   rather than quietly killing every ack at midnight. `owner_name`,
    #   `email`, `phone` and `link` are incidental too: they say who to ring,
    #   not what is owed.
    #
    # RECOMPUTE — None, deliberately. The wrapper dict is `{"result": [...]}`
    #   and carries no total, no count and no bucket split. Nothing can go
    #   stale because nothing is derived.
    "find_overdue_invoices": AckWiring(
        findings_at="result",
        identity_of=_entity_identity,
        material_of=None,
        recompute=None,
        label_of=_entity_label,
    ),

    # ── find_overdue_vendor_bills ───────────────────────────────────────────
    #
    # The payables side of the same handler: unpaid and partially-paid vendor
    # bills past their due date. It repeats for exactly the reason the mechanism
    # was written — the row leaves only when somebody pays a vendor, and this
    # skill cannot record a payment.
    #
    # IDENTITY, MATERIAL and INCIDENTAL are as `find_overdue_invoices`: the same
    # handler, the same five fields, the same absence of any amount to hash.
    #
    # THE ONE THING THAT IS NOT THE SAME, and the reason this is its own commit:
    #   `propose_payment_run` reads the SAME BILLS and is wired with a real
    #   MATERIAL bucket (`balance_due`, `status`), because that handler selects
    #   the balance and this one does not. So one bill can be acknowledged twice
    #   under two skills with two different meanings — "stop proposing me this
    #   payment while the balance is 42,000" over there, "stop listing this bill
    #   as overdue at all" here — and the two acks are correctly independent:
    #   the ack table is keyed (org, skill, finding_key) and the identities are
    #   computed from different fields, so neither can ever match the other's
    #   row. That is the intended behaviour and not an oversight, because the
    #   two skills answer different questions about the same debt.
    #
    #   It does mean the WEAKER promise wins if a user acks here: a bill hidden
    #   from the overdue list is hidden however its balance moves. Anyone who
    #   wants "tell me again when it grows" should acknowledge it in
    #   `propose_payment_run`, where the balance exists to be hashed.
    "find_overdue_vendor_bills": AckWiring(
        findings_at="result",
        identity_of=_entity_identity,
        material_of=None,
        recompute=None,
        label_of=_entity_label,
    ),

    # ── find_overdue_tasks ──────────────────────────────────────────────────
    #
    # `public.tasks`, past `due_at`, not done and not cancelled. The longest
    # list of the five in every real org, and the one most likely to be skimmed:
    # a firm carrying forty overdue tasks it has consciously deprioritised reads
    # the same forty every morning, which is how a list stops being read.
    #
    # IDENTITY — `entity.id` + `entity.module`, as the rest of the family, and
    #   this module is where the argument for leaving `owner` OUT stops being
    #   theoretical. For tasks the handler selects `assignee_user_ids[1]` — the
    #   FIRST element of a text[] that a task can have several of. Adding a
    #   second assignee, or removing the first, changes that value without
    #   changing anything about the task. In IDENTITY it would orphan the
    #   acknowledgement on a re-assignment; in MATERIAL it would void it. Both
    #   for an edit that did not touch the due date, the title or the status.
    #
    # MATERIAL — None. The shape carries no amount and no status: `status` is
    #   applied in the WHERE clause (`NOT IN ('done','cancelled')`) and never
    #   returned, so a completed task LEAVES the list rather than moving within
    #   it. `due_at` is not returned either — only `days_past`, derived from it,
    #   which is drift.
    #
    #   That last one is the honest weakness of this entry, and it differs from
    #   the invoice case in kind rather than degree: a task whose DUE DATE is
    #   pushed out and then missed again is, to a person, a new failure — and
    #   this wiring cannot see it, because the handler returns the age and not
    #   the date it was measured from. The fix is a `due` field on the finding,
    #   which is a change to a handler five skills share; it is recorded as owed
    #   rather than made in a commit whose subject is the wiring.
    #
    # INCIDENTAL — `days_past`, `owner`, `owner_name`, and the `link` that opens
    #   the task.
    #
    # RECOMPUTE — None. `{"result": [...]}` derives nothing.
    "find_overdue_tasks": AckWiring(
        findings_at="result",
        identity_of=_entity_identity,
        material_of=None,
        recompute=None,
        label_of=_entity_label,
    ),

    # ── find_overdue_followups ──────────────────────────────────────────────
    #
    # `staging.graha_follow_ups` past `due_at` and not completed. The CRM chase
    # list, and the one place in this family where the ack is closest to being
    # the RIGHT answer rather than a concession: a follow-up whose customer has
    # said "call me after Diwali" is not completed, is genuinely past due, and
    # will be past due every morning until somebody either rings them or ticks
    # it off falsely. Acknowledging it is the honest third option.
    #
    # IDENTITY — `entity.id` + `entity.module`. The label here is the follow-up
    #   TITLE, free text a user retypes, so keeping it out of the key matters
    #   more on this module than on the ledgers: "Call Sharma re renewal"
    #   becoming "Call Sharma re renewal (Q3)" must not resurrect the finding.
    #
    # MATERIAL — None. The shape carries no amount; `is_completed` is applied in
    #   the WHERE clause, so completing one removes it from the list.
    #
    # INCIDENTAL — `days_past`. Note this module gets NO `link`: `_MODULE_KIND`
    #   maps follow_ups to None because the frontend has no per-follow-up route.
    #   The wiring never reads `link`, so the absence changes nothing here, and
    #   the label falls back to the title and the owner's name.
    #
    # RECOMPUTE — None; nothing in `{"result": [...]}` is derived.
    "find_overdue_followups": AckWiring(
        findings_at="result",
        identity_of=_entity_identity,
        material_of=None,
        recompute=None,
        label_of=_entity_label,
    ),

    "propose_payment_run": AckWiring(
        findings_at="bills",
        identity_of=lambda f: {"bill": f.get("bill")},
        material_of=lambda f: {
            "balance_due": f.get("balance_due"),
            "status": f.get("status"),
        },
        recompute=_payables_recompute,
        label_of=lambda f: f"{f.get('bill')} — {f.get('vendor')}",
    ),
}


def apply_wiring(skill_function: str, data: Any, ack_set: Mapping[str, Any]) -> Any:
    """Filter one handler's output through an org's acknowledgements.

    Returns *data* untouched when the skill is not wired, when it did not return
    the shape the wiring describes, or when the org holds no acknowledgements —
    the last of which is every org today, so an unwired path must stay a no-op
    rather than a reshape.
    """
    wiring = ACK_WIRING.get(skill_function)
    if wiring is None or not isinstance(data, dict) or not ack_set:
        # `not ack_set` is the case that is true for every org today, and it
        # must be a NO-OP rather than a reshape: annotating findings and
        # attaching an `acknowledged: {count: 0}` block would have every UI
        # render "0 acknowledged" under a list nobody has ever acknowledged
        # anything in. The caller short-circuits on this too; both, because a
        # function whose docstring promises this should not depend on being
        # called correctly.
        return data

    findings = data.get(wiring.findings_at)
    if not isinstance(findings, list):
        # The handler changed shape under a wiring that still names the old key.
        # Returning the data unfiltered is the safe direction: showing a finding
        # that was acknowledged is a nuisance, hiding one that was not is a
        # missed payment.
        return data

    surviving, suppressed = skill_ack.partition_by_ack(
        findings, ack_set,
        identity_of=wiring.identity_of,
        material_of=wiring.material_of,
    )

    # The annotation the UI needs to hand a key back. See the module docstring.
    for f in surviving:
        f["_ack_key"] = skill_ack.finding_key(wiring.identity_of(f))
        f["_ack_state"] = (
            skill_ack.state_hash(wiring.material_of(f))
            if wiring.material_of else None
        )

    data[wiring.findings_at] = surviving
    if wiring.recompute is not None:
        wiring.recompute(data, surviving)

    # Say that something was hidden, and by whom. A list that silently shrinks
    # is indistinguishable from a query that broke.
    data["acknowledged"] = {
        "count": len(suppressed),
        "items": [
            {
                "label": wiring.label_of(f),
                "by": (f.get("_ack") or {}).get("by"),
                "at": (f.get("_ack") or {}).get("at"),
                "note": (f.get("_ack") or {}).get("note"),
            }
            for f in suppressed
        ],
    }
    return data
