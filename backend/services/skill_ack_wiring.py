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

Wired so far: 7 of the 61 assigned skills.


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


# ── check_late_suppliers ────────────────────────────────────────────────
#
# Open purchase orders whose expected date has passed with quantity still
# outstanding. It repeats until the goods arrive or somebody edits the
# order, and the commonest real reason a firm wants it silenced is the one
# the product cannot record: the supplier rang and said next Tuesday.
#
# IDENTITY — `purchase_order` ALONE, and this one is safe for a reason that
#   lives in another module and must be said out loud. `po_number` is
#   NULLABLE — migration 197 leaves it NULL until the order is ISSUED,
#   because a serial spent on a draft is a gap in a numbered series. A key
#   over a null number would collapse every draft into ONE finding_key and
#   the first acknowledgement would hide all of them.
#
#   It cannot happen here because this handler filters
#   `status = ANY(OPEN_STATUSES)` and `OPEN_STATUSES` is
#   {issued, part_received, received} — no drafts, so every finding carries
#   a number, and `ganit_purchase_orders_org_number_uq` makes it unique per
#   org. The wiring is therefore correct because of a frozenset in
#   `services/purchase_orders.py`; a test pins that constant so widening it
#   to include drafts fails here rather than silently hiding orders.
#
#   NOT `vendor` — the same trap as `propose_payment_run`. The vendor name
#   is joined from `ganit_vendors` and a renamed or replaced vendor record
#   would re-key every one of that vendor's orders.
#
# MATERIAL — `qty_outstanding` and `order_value`. Somebody acknowledged an
#   order with three units outstanding; six units outstanding, or an order
#   amended from 40,000 to 90,000, is a new situation wearing an old
#   number. Both come straight from the row (`qty_ordered - qty_received`
#   is rounded once by the handler and passed through here unchanged) — the
#   arithmetic is NOT redone in the lambda, because float subtraction inside
#   a hash is how a state check reports movement that never happened.
#
# INCIDENTAL — `days_late` ticks with the calendar and is refused by
#   `_DRIFT_FIELDS`. `expected_on` is incidental too, and that is a
#   judgement rather than an obvious one: moving the expected date FORWARD
#   removes the finding from the query altogether, and moving it backwards
#   changes nothing about what is outstanding. `currency`, `vendor` and the
#   contact keys are incidental for the usual reasons.
#
# RECOMPUTE — `counts.orders_late`, and NOTHING ELSE in that block.
#   `could_not_check`, `open_without_an_expected_date`, `orders_total`,
#   `orders_open`, `capped_at` and `was_capped` are measured against the
#   whole population by a separate query and are not sums over the list;
#   rebuilding them from the surviving findings would turn the denominator
#   rule this handler is built on into a lie. `verdict` likewise: "could
#   not check" is a statement about purchase orders existing, not about how
#   many rows survived an acknowledgement.

def _late_suppliers_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the ONE count that is a sum over the findings list."""
    counts = out.get("counts")
    if isinstance(counts, dict):
        counts["orders_late"] = len(surviving)


# ── check_received_not_invoiced ─────────────────────────────────────────────
#
# GRNI: goods received and not yet billed — the period-end accrual nobody
# remembers until the audit asks for it. The finding persists until the
# supplier's bill arrives and is LINKED to the order, which can be weeks, and
# a firm closing a period wants to mark the ones it has already accrued by
# hand rather than read them again every morning.
#
# IDENTITY — `purchase_order`, for exactly the reasons argued at
#   `check_late_suppliers`: `po_number` is NULL until issue, `OPEN_STATUSES`
#   contains no draft so every finding here carries one, and the partial unique
#   index makes it unique per org. `vendor` stays out — a renamed vendor record
#   must not re-key its orders.
#
# MATERIAL — `accrual`, and it is the only field in the shape that carries
#   money. An accrual of 12,000 was acknowledged; 48,000 is a different entry
#   in a different set of accounts. The handler rounds it to two decimals
#   before it reaches the finding, which is what makes it safe to hash at all:
#   the figure is a sum of `gap * rate` in float, and an unrounded float would
#   flap in the last bits between runs and resurface the finding for nothing.
#   The lambda reads the rounded value and computes NOTHING.
#
#   `currency` is deliberately not in MATERIAL. It is a property of the order,
#   not of the amount, and an org does not redenominate a live purchase order.
#
# INCIDENTAL — `ordered_on` is the PO date: it is fixed at issue and says
#   nothing about what is unbilled. The contact keys and the vendor link are
#   incidental as everywhere.
#
#   Note what is NOT in this shape and therefore cannot be hashed: the quantity
#   received. Goods arriving in a second delivery move `accrual`, so the
#   acknowledgement voids through the money rather than through the count —
#   which is the right instrument, because the money is the thing that goes
#   into the accounts.
#
# RECOMPUTE — `accrual_total` and `counts.orders_with_an_accrual`, and nothing
#   else. `accrual_total` is THE number this skill exists to produce: leave it
#   summed over suppressed findings and the skill reports an accrual for orders
#   it is not showing, which is the reports-page defect in a figure that ends
#   up in a set of books. `open_orders`, `orders_with_a_receipt`,
#   `could_not_check` and the cap are population measurements from a different
#   pass and are left alone — an org whose orders were all acknowledged has not
#   thereby stopped having orders.

def _grni_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the accrual and its count from what is left.

    Summed in the same order and rounded the same way the handler does, so a
    run with no acknowledgements produces the identical figure.
    """
    total = 0.0
    for o in surviving:
        try:
            total += float(o.get("accrual") or 0)
        except (TypeError, ValueError):
            continue
    out["accrual_total"] = round(total, 2)
    counts = out.get("counts")
    if isinstance(counts, dict):
        counts["orders_with_an_accrual"] = len(surviving)


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

    # ── find_stalled_agreements ─────────────────────────────────────────────
    #
    # `staging.ganit_contracts` still in `draft`, untouched for fourteen days.
    # eSign is web-only, so this finding and its acknowledgement are both web
    # surfaces; nothing here needs a mobile destination.
    #
    # IDENTITY — `entity.id` + `entity.module`, and the contract title is left
    #   out for the same reason as everywhere else in the family: a retitled
    #   draft is the same stalled draft.
    #
    # MATERIAL — None, and on this module the reasoning is worth stating
    #   because the finding's underlying signal is ITSELF a clock. There is no
    #   due date on a contract; "stalled" means `updated_at` is older than the
    #   threshold. So ANY edit to the draft resets it, the row drops out of the
    #   query, and the finding disappears without the ack doing anything.
    #
    #   The consequence: if the draft then sits untouched for another fourteen
    #   days it comes BACK, and the stored acknowledgement — which is
    #   unconditional — suppresses it again. That is deliberate and it is the
    #   correct reading of what the user said: "this draft is parked, stop
    #   telling me". Somebody who wants to be reminded after the pause should
    #   snooze rather than acknowledge. A wiring that tried to be cleverer would
    #   have to hash `updated_at`, which is in `_DRIFT_FIELDS` and would raise.
    #
    # INCIDENTAL — `days_past`, the owner fields, and the `/sign/documents/…`
    #   link.
    #
    # RECOMPUTE — None.
    "find_stalled_agreements": AckWiring(
        findings_at="result",
        identity_of=_entity_identity,
        material_of=None,
        recompute=None,
        label_of=_entity_label,
    ),

    "check_received_not_invoiced": AckWiring(
        findings_at="orders",
        identity_of=lambda f: {"purchase_order": f.get("purchase_order")},
        material_of=lambda f: {"accrual": f.get("accrual")},
        recompute=_grni_recompute,
        label_of=lambda f: f"{f.get('purchase_order')} — {f.get('vendor')}",
    ),

    "check_late_suppliers": AckWiring(
        findings_at="late",
        identity_of=lambda f: {"purchase_order": f.get("purchase_order")},
        material_of=lambda f: {
            "qty_outstanding": f.get("qty_outstanding"),
            "order_value": f.get("order_value"),
        },
        recompute=_late_suppliers_recompute,
        label_of=lambda f: f"{f.get('purchase_order')} — {f.get('vendor')}",
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
