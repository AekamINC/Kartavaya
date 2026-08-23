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

Wired so far: 9 of the 61 assigned skills.


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


== A HANDLER MAY HAVE MORE THAN ONE LIST ===================================

`findings_at` took a single string because that is the shape the FIRST wiring
happened to need, not because anybody decided a skill has one list. Nine of
them do not. `check_payroll_readiness` returns `blockers` and `warnings`;
`check_msme_payment_clock` returns `past_the_window`, `inside_the_window` and
`not_classified`; `check_approvals_that_sit` returns five. Wiring only the
first list of such a skill is worse than not wiring it: the acknowledgement
button appears, half the findings answer to it, and the other half repeat for
ever under a feature that looks finished.

So `findings_at` takes a string OR a sequence of strings. Three things change,
and only one of them is difficult.

  THE KEY MUST BE UNIQUE ACROSS THE LISTS, NOT WITHIN EACH.
      The same employee can be a blocker (no salary structure — they are not
      paid at all) and a warning (an advance whose recovery will be capped) in
      one run. If both hash to one `finding_key`, acknowledging the mild one
      silences the severe one, silently, in the direction that costs somebody
      their salary. Leaving that to each wiring's `identity_of` means every
      future entry has to remember it, and the failure is invisible when they
      do not — so `_identity_for` folds the LIST NAME into the identity for
      every multi-key wiring instead. A finding that later MOVES between lists
      is correctly orphaned: it has become a different finding and somebody
      should look at it again.

  RECOMPUTE RECEIVES ALL THE LISTS AT ONCE.
      An aggregate can span them — `check_payroll_readiness` counts blockers
      and warnings into one `counts` block — so a recompute called once per
      list could only ever rebuild such a total from half its inputs. That is
      the reports-page defect again, arrived at through the back door. A
      multi-key wiring's recompute is therefore handed a MAPPING of
      {key: survivors}; a single-key wiring is still handed a plain LIST, so
      not one existing entry has to be rewritten.

  THE SHAPE CHECK IS ALL-OR-NOTHING.
      If any named key is missing or is not a list, the data is returned
      untouched. Filtering the lists that survived a handler's shape change
      while recomputing a total across the shape it no longer has is the one
      outcome worse than not filtering at all.


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

    #: Where the findings live in the handler's return dict: ONE key, or
    #: SEVERAL. See A HANDLER MAY HAVE MORE THAN ONE LIST in the module
    #: docstring — the multi-key form changes three things and the change to
    #: `identity_of` is the one that matters.
    findings_at: str | Sequence[str]

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
    #:
    #: The second argument follows `findings_at`: a LIST of survivors for a
    #: single-key wiring, and a MAPPING of {key: survivors} for a multi-key
    #: one. It is a mapping rather than one call per list because an aggregate
    #: can span the lists — `check_payroll_readiness` counts blockers AND
    #: warnings — and a recompute handed one list at a time could only ever
    #: rebuild such a total from half its inputs, which is the reports-page
    #: failure with a fresh coat of paint.
    recompute: Optional[Callable[[dict, Any], None]]

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


# ── check_duplicate_vendor_bills ────────────────────────────────────────────
#
# THE STRONGEST CASE IN THE CATALOGUE for acknowledgement, and the reason is in
# the finding itself: this skill reports a PAIR that is *probably* one bill
# entered twice, and the commonest verdict a person reaches is "no — the
# supplier really did send us two identical invoices that week". Nothing records
# that verdict. The pair matches the same three matchers next run, and the run
# after, for as long as both rows exist. A firm that has cleared the same six
# pairs four times stops opening the list, and this is the one list whose whole
# job is to run BEFORE the payment run.
#
# IDENTITY — the two bills, ORDER-INDEPENDENTLY.
#
#   Each side reduces to `internal_ref or bill_number`, and that order is the
#   reverse of `propose_payment_run`'s `bill_number or internal_ref` — on
#   purpose. This handler does not leave a missing supplier number empty: it
#   renders "(no supplier number recorded)", a PLACEHOLDER STRING that is
#   identical on every unnumbered bill in the org. Prefer `bill_number` here
#   and two unrelated unnumbered pairs collapse to one finding_key, so the
#   first acknowledgement hides the second pair. `internal_ref` is assigned one
#   per row — the header of this handler says so, in the course of explaining
#   why it discriminates nothing as a MATCHER — which makes it useless there
#   and exactly right here.
#
#   The pair is SORTED before hashing. `first` is the earlier bill by date and
#   `second` the later one, so correcting a mistyped bill date can swap the two
#   sides of a pair that is otherwise unchanged. Keyed positionally, that edit
#   mints a new finding_key and orphans the acknowledgement — the finding comes
#   back as though nobody ever touched it, which is the exact failure the
#   identity bucket exists to prevent. Sorted, the same two bills are the same
#   fact whichever way round the handler reports them.
#
#   NOT `vendor` — a renamed or replaced vendor record would re-key every pair
#   under it, the trap `propose_payment_run` documents. NOT `matcher` either,
#   and that one is less obvious: the matcher is a CLASSIFICATION of the pair,
#   not part of which pair it is, and it moves on its own — filling in a
#   missing supplier number promotes a pair from matcher 2 to matcher 1 without
#   changing either bill's amount. In IDENTITY that promotion would orphan the
#   ack.
#
# MATERIAL — both sides' `total`, `already_paid` and `status`, sorted with the
#   pair so the material bucket cannot be voided by the same swap the identity
#   bucket survives.
#
#   Unlike `propose_payment_run` there is no `balance_due` here to stand in for
#   the two of them, and the balance is NOT computed in the lambda: subtracting
#   two floats on the way into a hash is how a state check reports movement
#   that never happened. So the raw pair goes in and the arithmetic stays in
#   the recompute, where a wrong last bit costs a rounded rupee rather than a
#   resurrected finding.
#
#   Why status: a voided or cancelled bill changes what the pair MEANS, and the
#   handler's window is wide enough that a voided row can still be reported.
#
# INCIDENTAL — `days_apart` is the calendar distance between two fixed dates,
#   so it does NOT tick — but `bill_date` on each side is incidental for the
#   ordinary reason (a corrected date is the same bill), and `confidence` is
#   prose derived from `matcher`. `currency` and `amount` are duplicates of
#   facts already in the material bucket: `amount` IS `first.total`, and
#   hashing it again would just count one movement twice.
#
# RECOMPUTE — all three of `counts.pairs`, `counts.by_matcher` and
#   `counts.amount_at_risk_if_every_pair_is_a_duplicate`. The last one is the
#   number a reader acts on, and the handler is careful about it in a way the
#   rebuild has to match exactly: the exposure of a pair is the LARGER
#   still-unpaid side, never both, because if the pair really is one bill twice
#   then one of the two is genuinely owed. Taking "the second" returned 0.00 on
#   the live data's commonest shape — a paid bill and its unpaid twin — so the
#   rebuild below is `max(0, first_unpaid, second_unpaid)`, the same expression
#   the handler uses, and not a re-derivation of it.

def _dup_ref(side: Any) -> str:
    """One bill of a pair, reduced to the reference that identifies it.

    `internal_ref or bill_number`, and that order is the reverse of
    `propose_payment_run`'s — see the note above: a missing supplier number is
    rendered here as an identical placeholder on every unnumbered bill, so it
    can only ever be the fallback.
    """
    side = side if isinstance(side, Mapping) else {}
    return str(side.get("internal_ref") or side.get("bill_number"))


def _dup_refs(f: Finding) -> list:
    """The two bills' references, sorted. IDENTITY — see the note above."""
    return sorted([_dup_ref(f.get("first")), _dup_ref(f.get("second"))])


def _dup_sides(f: Finding) -> list:
    """Both bills' money and status, ordered by reference rather than by date.

    The AMOUNTS ARE NOT STRINGIFIED. `skill_ack._canon` puts every number
    through `Decimal` so that 4200, 4200.0 and Decimal("4200.00") hash alike;
    calling `str()` on them here to make them sortable would defeat exactly
    that, and a handler that started returning a Decimal where it once returned
    a float would void every acknowledgement this skill holds. So the SORT KEY
    is the reference string and the values ride along untouched.
    """
    def _side(raw: Any) -> dict:
        raw = raw if isinstance(raw, Mapping) else {}
        return {
            "ref": _dup_ref(raw),
            "total": raw.get("total"),
            "already_paid": raw.get("already_paid"),
            "status": raw.get("status"),
        }
    return sorted([_side(f.get("first")), _side(f.get("second"))],
                  key=lambda s: s["ref"])


def _dup_unpaid(side: Any) -> float:
    """The still-unpaid part of one bill, as the handler computes it."""
    side = side if isinstance(side, Mapping) else {}
    try:
        return float(side.get("total") or 0) - float(side.get("already_paid") or 0)
    except (TypeError, ValueError):
        return 0.0


def _duplicates_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the pair count, the matcher split and the exposure.

    `amount_at_risk_if_every_pair_is_a_duplicate` adds the LARGER still-unpaid
    side of each pair and never both — the handler's own rule, restated here
    rather than re-derived, because a rebuild that disagreed with the figure it
    replaces would be worse than no rebuild at all.
    """
    at_risk = 0.0
    by_matcher: dict[str, int] = {}
    for pair in surviving:
        matcher = str(pair.get("matcher"))
        by_matcher[matcher] = by_matcher.get(matcher, 0) + 1
        at_risk += max(0.0, _dup_unpaid(pair.get("first")),
                       _dup_unpaid(pair.get("second")))
    counts = out.get("counts")
    if isinstance(counts, dict):
        counts["pairs"] = len(surviving)
        counts["by_matcher"] = by_matcher
        counts["amount_at_risk_if_every_pair_is_a_duplicate"] = round(at_risk, 2)


# ── check_statutory_records_gate ────────────────────────────────────────────
#
# Employees whose statutory identifiers are missing for a deduction the payroll
# run makes anyway: PF enabled with no UAN, ESI enabled with no insurance
# number, tax deducted with no PAN. The handler's own posture is REPORTS, NEVER
# BLOCKS — UAN, ESI number and PAN are non-mandatory here and always will be —
# which is exactly why it needs acknowledgement more than a gate would. A firm
# whose contractor genuinely has no UAN cannot make that row go away by doing
# the right thing, so it reads the same name every morning for ever.
#
# IDENTITY — `check` plus `employee_code`, and the interesting half is what is
#   NOT here.
#
#   NOT `employee`, which is the NAME, and this was measured rather than
#   assumed. Live, 2026-08-23: the largest org carries THREE active employees
#   called Myra Bansal, three called Tara Mehta, three called Navya Reddy — ten
#   names duplicated three ways. Keyed on the name, one acknowledgement of one
#   person's missing PAN would hide the same gap for two colleagues, and the
#   deductor bears the higher-rate shortfall for both. `reachable`'s own
#   docstring says it in one line: a name is not a key.
#
#   `employee_code` is. Same probe: 97 active employees, ZERO blank codes, 97
#   distinct (org, code) pairs. It is the business key a firm types on a
#   payslip, it survives a marriage and a department move, and it is not a UUID
#   so nothing about it is at risk of being rendered.
#
#   `check` is in the key because the three findings are three separate
#   decisions about one person. Acknowledging "this contractor has no UAN" must
#   not also silence "tax was deducted and there is no PAN", which is the one
#   that carries money.
#
# MATERIAL — `payslip_month`, and it needs the argument because it LOOKS like a
#   drift field and is not.
#
#   It is present only on `tds_deducted_no_pan`, where it names the payslip the
#   tax was deducted on. It does not tick with the calendar: it advances when a
#   PAYROLL RUN HAPPENS, which is an event, and the event is precisely "more
#   tax has been deducted at the higher rate since you acknowledged this". So
#   an acknowledgement covers the month it was made about and next month's run
#   brings the finding back with real new money behind it. That is the
#   mechanism working, not the midnight failure — a payslip month is not
#   `days_past`, and `_DRIFT_FIELDS` agrees.
#
#   On the other two checks it is absent, so `material_of` hashes a None and
#   the acknowledgement is effectively permanent. Correct: a missing UAN is a
#   static fact until somebody fills the field in, and filling it in removes
#   the finding from the query.
#
#   NOT `detail`. It is prose, and it embeds the deducted amount — so hashing
#   it would tie every acknowledgement in this skill to a sentence's wording,
#   and rephrasing one string in the SQL would void every ack every org holds.
#
# INCIDENTAL — `employee` (the printable name), `department` (a person moves
#   teams without changing what is missing), and the contact keys.
#
# RECOMPUTE — `counts` and `by_department`, both of which are sums over the
#   findings list and would otherwise describe rows the run is not showing.
#   `coverage` is left ALONE: `active_employees`, `pf_enabled_checked`,
#   `esi_enabled_checked` and `tds_deducted_checked` come from a separate
#   denominator query and exist precisely so that "found nothing" and "never
#   ran" cannot look alike. An org that acknowledged every finding has not
#   thereby stopped having 59 employees with tax deducted.

def _statutory_gate_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the per-check counts and the departmental split.

    Both are assembled exactly as the handler assembles them, including the
    three fixed check codes — a count that silently dropped a key when its last
    finding was acknowledged would read as "this check was not run".
    """
    out["counts"] = {
        code: sum(1 for f in surviving if f.get("check") == code)
        for code in ("pf_enabled_no_uan", "esi_enabled_no_number",
                     "tds_deducted_no_pan")
    }
    by_dept: dict[Any, dict] = {}
    for f in surviving:
        dept = f.get("department")
        slot = by_dept.setdefault(dept, {"department": dept, "findings": 0})
        slot["findings"] += 1
        code = f.get("check")
        slot[code] = slot.get(code, 0) + 1
    out["by_department"] = sorted(
        by_dept.values(), key=lambda d: (-d["findings"], str(d["department"])))


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

    "check_duplicate_vendor_bills": AckWiring(
        findings_at="pairs",
        identity_of=lambda f: {"pair": _dup_refs(f)},
        material_of=lambda f: {"sides": _dup_sides(f)},
        recompute=_duplicates_recompute,
        label_of=lambda f: (
            f"{_dup_refs(f)[0]} / {_dup_refs(f)[-1]} — {f.get('vendor')}"),
    ),

    "check_statutory_records_gate": AckWiring(
        findings_at="findings",
        identity_of=lambda f: {
            "check": f.get("check"),
            "employee_code": f.get("employee_code"),
        },
        material_of=lambda f: {"payslip_month": f.get("payslip_month")},
        recompute=_statutory_gate_recompute,
        label_of=lambda f: f"{f.get('check')} — {f.get('employee')}",
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


def _buckets_of(wiring: AckWiring) -> tuple[str, ...]:
    """The keys a wiring's findings live under, single-key form included."""
    if isinstance(wiring.findings_at, str):
        return (wiring.findings_at,)
    return tuple(wiring.findings_at)


def _identity_for(wiring: AckWiring, bucket: str) -> Callable[[Finding], Mapping[str, Any]]:
    """The wiring's `identity_of`, made unique ACROSS lists where there are several.

    A single-key wiring gets its own function back, unchanged and unwrapped, so
    every key already computed by `propose_payment_run` and the nine that
    followed it stays byte-identical.

    A multi-key wiring gets the LIST NAME folded in, and that is the safety
    property the whole extension turns on. `check_payroll_readiness` can report
    the same employee as a BLOCKER (no salary structure — they are not paid at
    all) and as a WARNING (an advance whose recovery will be capped). Those are
    two different statements about one person, and if `identity_of` reads only
    the employee and the check code it is one wiring's job, done by hand, to
    guarantee no blocker ever collides with a warning. Get it wrong and
    acknowledging the mild one silences the severe one — silently, and in the
    direction that costs somebody their salary.

    So the mechanism does it instead of trusting the wiring: the bucket name is
    part of the identity, structurally, for every multi-key entry. A finding
    that later MOVES from one list to the other is correctly orphaned — it has
    become a different, more or less severe, finding, and somebody should look
    at it again.
    """
    if isinstance(wiring.findings_at, str):
        return wiring.identity_of

    def _identity(f: Finding) -> Mapping[str, Any]:
        # `_list` leads with an underscore for the same reason `_ack_key` does,
        # and it is a name no handler emits as a column.
        return {"_list": bucket, **dict(wiring.identity_of(f))}

    return _identity


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

    buckets = _buckets_of(wiring)
    lists = {key: data.get(key) for key in buckets}
    if not all(isinstance(found, list) for found in lists.values()):
        # The handler changed shape under a wiring that still names the old key.
        # Returning the data unfiltered is the safe direction: showing a finding
        # that was acknowledged is a nuisance, hiding one that was not is a
        # missed payment.
        #
        # ALL of them, not the ones that happen to be present. A multi-key
        # wiring whose second list vanished would otherwise filter the first
        # and recompute a total across a shape it no longer understands, which
        # is the one outcome worse than not filtering at all.
        return data

    surviving_by_bucket: dict[str, list[dict]] = {}
    suppressed: list[dict] = []

    for key in buckets:
        identity_of = _identity_for(wiring, key)
        kept, hidden = skill_ack.partition_by_ack(
            lists[key], ack_set,
            identity_of=identity_of,
            material_of=wiring.material_of,
        )

        # The annotation the UI needs to hand a key back. See the module
        # docstring. It is computed with the SAME identity function the filter
        # used — including the folded bucket name — or the ack would be filed
        # under a key this function never looks up.
        for f in kept:
            f["_ack_key"] = skill_ack.finding_key(identity_of(f))
            f["_ack_state"] = (
                skill_ack.state_hash(wiring.material_of(f))
                if wiring.material_of else None
            )

        surviving_by_bucket[key] = kept
        suppressed.extend(hidden)
        data[key] = kept

    if wiring.recompute is not None:
        # Single-key wirings are called with a LIST, exactly as before, so no
        # existing entry has to be rewritten to suit a shape it does not have.
        wiring.recompute(
            data,
            surviving_by_bucket[buckets[0]] if isinstance(wiring.findings_at, str)
            else surviving_by_bucket,
        )

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
