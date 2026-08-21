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

Wired so far: 1 of the 61 assigned skills.


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


ACK_WIRING: dict[str, AckWiring] = {
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
