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

Wired so far: 22 of the 61 assigned skills.


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

      WHEN THE LISTS ARE ONE POPULATION, folding is wrong, and
      `lists_are_one_population=True` turns it off. The two shapes are
      genuinely different data: payroll readiness describes one employee from
      two angles at once, while `check_chase_ladder` PARTITIONS its items —
      each is in exactly one of `nudges_due`, `escalations_due`,
      `expired_and_must_be_reissued` or `waiting_but_nothing_due`, and it moves
      between them AS THE CLOCK RUNS. Fold the list name in there and an
      acknowledgement is orphaned when the item reaches the second nudge, again
      at escalation, again at expiry: the user acks the same task three times
      in a fortnight and stops. Cross-list collision is impossible for such a
      skill anyway, because the subject is only ever in one list. The flag is a
      claim about the handler, so the wiring takes on the uniqueness guarantee
      the mechanism was making.

  RECOMPUTE RECEIVES ALL THE LISTS AT ONCE.
      An aggregate can span them — `check_payroll_readiness` counts blockers
      and warnings into one `counts` block — so a recompute called once per
      list could only ever rebuild such a total from half its inputs. That is
      the reports-page defect again, arrived at through the back door. A
      multi-key wiring's recompute is therefore handed a MAPPING of
      {key: survivors}; a single-key wiring is still handed a plain LIST, so
      not one existing entry has to be rewritten.

  A KEY MAY BE A DOTTED PATH. `check_wip_ageing` returns its findings under
      `escalated.rows`, beside the threshold and the census those rows are a
      capped sample of, and the nesting is right for a reader. `"escalated.rows"`
      reads and writes through it. Anything missing on the way down is treated
      as a shape change and fails OPEN, exactly like a missing top-level key.

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

    #: Do this skill's several lists PARTITION one population — each subject in
    #: exactly one list at a time — rather than describing it from several
    #: angles?
    #:
    #: Default False, which folds the list name into the key so a subject
    #: appearing in two lists at once cannot share an acknowledgement. That is
    #: the safe answer and the right one for `check_payroll_readiness`, where
    #: one employee is a blocker AND a warning in the same run.
    #:
    #: True says the opposite fact about the data and buys back the case the
    #: folding gets WRONG. See WHEN THE LISTS ARE ONE POPULATION in the module
    #: docstring: `check_chase_ladder` moves an item between four lists purely
    #: with the calendar, so folding would orphan its acknowledgement up to
    #: three times as the clock pushed it up the ladder — the midnight failure
    #: in slow motion.
    #:
    #: Setting this is a CLAIM ABOUT THE HANDLER, not a convenience: the wiring
    #: takes on the guarantee the mechanism was making, so `identity_of` must
    #: already be unique across the whole population.
    lists_are_one_population: bool = False


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


# ── check_payroll_readiness ─────────────────────────────────────────────────
#
# THE SKILL `services/skill_ack.py` IS WRITTEN AROUND — its docstring names this
# handler in the second sentence: "check_payroll_readiness names the same
# employee with no salary structure every month". It was blocked until the
# commit before this one, because it returns TWO lists and `findings_at` took
# one string, and wiring only `blockers` would have left every warning repeating
# for ever under a button that looked finished.
#
# FINDINGS_AT — `blockers` AND `warnings`. The distinction is load-bearing and
#   the handler's own docstring defends it: a blocker changes who gets paid or
#   whether the run can happen; a warning changes an amount somebody should
#   decide deliberately. `_identity_for` folds the list name into the key, so
#   acknowledging a capped advance recovery can never silence "this employee has
#   no salary structure and the run omits them entirely".
#
# IDENTITY — `month`, `check`, `employee_code`. All three needed a handler
#   change, and both are the sanctioned kind: a return shape that did not emit
#   the stable field its identity requires.
#
#   `employee_code` because `employee` is the printable NAME, and the name is
#   not a key — measured live, the largest org carries ten names held by three
#   active people each. Keyed on the name, one acknowledgement of one person's
#   missing bank details would silence two colleagues', and the colleagues would
#   not be paid. Live probe 2026-08-23: 131 blockers and 69 warnings in the
#   seeded org, ZERO of them missing a code.
#
#   `month` because payroll is monthly and an acknowledgement is filed against
#   the finding alone. Without it, "Priya has no salary structure"
#   acknowledged in August stays silenced in September — and in September the
#   run omits her again. That is a person not paid for a second month, hidden
#   by a button somebody pressed once.
#
#   And `month` is NOT the midnight bug wearing a monthly coat. `_DRIFT_FIELDS`
#   refuses fields that move WHILE THE FACT STAYS THE SAME; a new payroll month
#   is a new run, a new decision and new money. The same reasoning as
#   `payslip_month` in `check_statutory_records_gate`, and the same test:
#   running the skill twice in one month must resurrect nothing.
#
# MATERIAL — `amount`, which four of the nine checks carry: the pending leave's
#   days, the locked run's `total_net`, the structure's `basic`, the advance's
#   recovery, the expense claim. Somebody acknowledged an advance recovering
#   5,418; 54,180 is a different decision about the same person.
#
#   On the five checks with no amount the key is absent, so the ack is
#   unconditional — correct, because those are binary facts. An employee has a
#   salary structure or has not, and filling one in removes the finding.
#
#   NOT `detail`. It is prose, and for four checks it embeds the very number
#   that is already in `amount` — hashing it would tie every acknowledgement to
#   a sentence's wording and count one movement twice.
#
# INCIDENTAL — `employee` (the printable name; a marriage is not a new
#   finding), and the contact keys.
#
# RECOMPUTE — `counts`, which SPANS BOTH LISTS. This is the case the mapping
#   form of the recompute exists for: `{"blockers": n, "warnings": n}` rebuilt
#   from one list at a time could only ever be half right, and a payroll screen
#   reporting four blockers above a list of two is the reports-page defect in
#   front of somebody about to pay ninety-seven people.

def _payroll_readiness_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild the blocker/warning counts from BOTH surviving lists."""
    out["counts"] = {
        "blockers": len(surviving.get("blockers") or ()),
        "warnings": len(surviving.get("warnings") or ()),
    }


# ── check_impossible_stock ──────────────────────────────────────────────────
#
# Balances that cannot be true: stock below zero, a movement ledger whose
# running total went negative, a product issued out that was never received in.
# Nothing here is corrected — the handler says so: "a negative quantity is
# evidence, and zeroing it destroys the evidence". So the finding cannot be
# closed by fixing it, only by somebody deciding it is understood, which is the
# definition of a finding that needs an acknowledgement.
#
# IDENTITY — `check` + `product`.
#
#   `product` is the product NAME, and unusually for this codebase that is
#   safe: measured live 2026-08-23, 106 active products, ZERO blank names and
#   ZERO duplicate names per org even case-insensitively. The catalogue holds a
#   product once — the CRM rule that a client is a company has a stock-side
#   twin — so the name is the key a person uses and the key the data supports.
#   A rename would orphan the ack, and a renamed product is arguably a
#   different catalogue entry to a reader; the alternative is a product UUID
#   the finding does not carry.
#
#   `check` because the three are separate judgements about one product. "I
#   know this balance is negative, it is a data-loading artefact" must not also
#   silence "something was issued that was never received in".
#
# MATERIAL — `on_hand` and `movement_ledger_net`. A balance of −4 acknowledged
#   is not a balance of −400: the second is a different accident. Both are read
#   straight off the row through the handler's `_f`, and neither is recomputed
#   here.
#
#   NOT `confidence`. It is derived from whether the ledger explains the
#   balance, and it flips when an unrelated product's movement is backfilled —
#   a classification moving under a finding that did not change.
#
#   NOT `implied_opening_balance` either: it IS `on_hand - movement_ledger_net`,
#   so hashing it would count one movement twice.
#
# INCIDENTAL — `first_movement`, `last_movement`, `movements_recorded`,
#   `detail`, `unit`, `is_service`, `product_is_active`.
#
#   `first_negative_on` and `lowest_running_total` are incidental too, and that
#   is a judgement: the date the ledger first went negative is a fact about
#   history that does not change while the finding stands, so hashing it buys
#   nothing, and `lowest_running_total` moves whenever any older movement is
#   corrected — which is the recovery a firm is being asked to perform.
#
# RECOMPUTE — the three per-check counts, `findings`, `confirmed` and
#   `unverified`. NOT `products_flagged`, which is `len(rows)` — every product
#   the query examined, not every product listed — and not `coverage`. An org
#   that acknowledged every impossible balance has not stopped having a
#   movement ledger that disagrees with its stock table.

def _impossible_stock_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the per-check counts and the confirmed/unverified split."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    for code in ("negative_on_hand", "went_negative", "never_received"):
        counts[code] = sum(1 for f in surviving if f.get("check") == code)
    confirmed = sum(1 for f in surviving if f.get("confidence") == "confirmed")
    counts["findings"] = len(surviving)
    counts["confirmed"] = confirmed
    counts["unverified"] = len(surviving) - confirmed


# ── check_unfillable_orders ─────────────────────────────────────
#
# Open order lines measured against stock on hand, in the order the orders will
# be picked. `short_now` cannot be filled today at all; `short_after_others`
# could be filled in isolation but will not be once the queue ahead has taken
# its stock — the part a per-product low-stock alert cannot see. A firm that has
# already told the customer, or already raised the purchase order, reads the
# same product every morning until the goods physically arrive.
#
# IDENTITY — `product`, alone. The finding is a PRODUCT GROUP with the offending
#   order lines nested inside it, so the fact being acknowledged is "I know this
#   product is short". Same name-is-safe measurement as `check_impossible_stock`.
#
#   NOT the nested `lines`: a group is re-formed on every run and the line set
#   changes whenever any order in the book is raised, edited or fulfilled.
#   Keying on it would orphan the acknowledgement on the first new order — the
#   very event that makes the shortage worse.
#
# MATERIAL — `on_hand` and `shortfall_after_all_open_orders`, which is where the
#   line set gets its say WITHOUT being in the key. A new order for the same
#   product deepens the shortfall and voids the ack, so "I know we are short 12"
#   does not silently cover being short 200. Both are rounded by the handler
#   before they reach the finding, which is what makes them safe to hash.
#
#   NOT `committed_on_open_orders`: it moves with the same events as the
#   shortfall and would count one change twice.
#
# INCIDENTAL — `unit`, `is_service`, `stock_record_exists`,
#   `remaining_after_all_open_orders` (the non-negative twin of the shortfall),
#   and everything inside `lines`.
#
# RECOMPUTE — AND THIS IS THE TRAP IN THIS FILE. `counts` carries `short_now`,
#   `short_after_others` and `fillable`, and they do NOT have the same
#   relationship to the findings list:
#
#     short_now / short_after_others   every short line belongs to a group that
#                                      is IN the list, because a group is only
#                                      listed if it has one. Exact sums over the
#                                      findings, so they MUST be rebuilt.
#     fillable                         counted for every line the handler
#                                      walked, including lines of products never
#                                      flagged at all. Rebuilding it from the
#                                      survivors would silently redefine it as
#                                      "fillable lines belonging to short
#                                      products" — a different and much smaller
#                                      number under an unchanged name.
#
#   `open_orders` and `order_lines_examined` are population; `coverage` and
#   `excluded` are the handler's own denominators. An org that acknowledged
#   every shortage has not stopped having order lines that name no catalogued
#   product.

def _unfillable_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the two counts that are sums over the findings, and no others."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    tally = {"short_now": 0, "short_after_others": 0}
    for group in surviving:
        for line in (group.get("lines") or ()):
            verdict = line.get("verdict")
            if verdict in tally:
                tally[verdict] += 1
    counts.update(tally)
    counts["products_short"] = len(surviving)


# ── check_attendance_exceptions ─────────────────────────────────────────────
#
# Day-level attendance faults: a punch that was never closed, an absence with no
# leave request behind it, working days with no attendance row at all, and leave
# approved beyond the balance on record. Three of the four are things a firm
# often KNOWS about and cannot record — the fitter who forgets to punch out, the
# founder who takes leave nobody tracks — so they are read and re-read until the
# list is wallpaper.
#
# IDENTITY — `check`, `employee_code`, `month`, `date`, `leave_type`. Two of
#   those the handler did not emit and now does.
#
#   `employee_code` for the reason measured at `check_statutory_records_gate`:
#   the largest org carries ten names held by three active people each, and the
#   handler previously identified an employee only by `employee`, the printable
#   NAME. Three of its four SELECTs now carry the code.
#
#   `date` and `leave_type` are the per-check discriminators, and they are in
#   the SAME key rather than in four separate wirings because they are simply
#   absent on the checks that do not have them. `unclosed_punch` and
#   `absent_without_approved_leave` are facts about ONE DAY, so the date is
#   what makes two of them different findings about one person.
#
#   `month` is what scopes `no_attendance_on_working_day`, whose whole fact is
#   "this employee has fifteen missing days in THIS month" — without it,
#   August's acknowledgement silences September's, and September's is fifteen
#   more days paid unverified. On the day-level checks the month is implied by
#   the date and costs nothing.
#
#   On `leave_beyond_balance` the fact is ANNUAL, so including the month makes
#   that acknowledgement monthly. Deliberate: a year's over-balance silenced
#   once in January would stay silent for twelve months, and the question the
#   handler asks — is this over-drawn leave accepted — is worth re-asking as the
#   year runs on.
#
# MATERIAL — `missing_days`, `days_taken`, `days_over`, `entitlement`. Absent
#   on the two day-level checks, so those acknowledgements are unconditional,
#   which is right: a punch is unclosed or it is not, and correcting it removes
#   the row. Where they are present they are the whole severity of the finding —
#   fifteen missing days acknowledged is not the same as twenty-two — and each
#   is rounded by the handler before it reaches the finding.
#
#   NOT `detail`, which is prose that embeds those same numbers.
#
# INCIDENTAL — `employee` (the printable name), `department`, `first_missing`
#   and `last_missing`. The last two move as the month runs on WITHOUT the
#   finding changing character, and `last_missing` in particular advances every
#   working day the gap persists — which is `days_past` wearing a date.
#
# RECOMPUTE — `counts` (all four codes, kept present at zero so a check that
#   emptied does not read as one that never ran) and `by_department`.
#   `punch_data` is left alone: it counts attendance rows in the window, and an
#   org that acknowledged every exception has not stopped having them.

def _attendance_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the per-check counts and the departmental split."""
    out["counts"] = {
        code: sum(1 for f in surviving if f.get("check") == code)
        for code in ("unclosed_punch", "absent_without_approved_leave",
                     "no_attendance_on_working_day", "leave_beyond_balance")
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


# ── check_194q_approaching ──────────────────────────────────────────────────
#
# Vendors at or near the Rs 50 lakh s.194Q threshold, measured AT PO TIME —
# purchases to date plus orders issued and not yet billed, because 194Q bites at
# payment or credit, whichever is earlier. A vendor who has crossed stays
# crossed for the rest of the financial year, so the finding cannot be resolved
# at all: the only thing a firm can do is start deducting, and the product has
# no way to be told that they have.
#
# FINDINGS_AT — `past_the_threshold` AND `approaching`. Two lists, and a vendor
#   moves from the second to the first exactly once, when they cross. The
#   mechanism folds the list name into the key, so that crossing correctly
#   orphans an acknowledgement made while they were merely approaching — which
#   is the one moment somebody must look again.
#
# IDENTITY — `vendor_id` and `financial_year_from`, both added to the handler
#   for this wiring.
#
#   `vendor_id` because the vendor NAME is not unique, and that is measured
#   rather than feared: live 2026-08-23, 80 active vendors, TWO groups sharing
#   a name. It is the same blind spot `check_duplicate_vendor_bills` reports
#   instead of papering over. Keyed on the name, one acknowledgement would
#   silence a second vendor's 194Q position — and 194Q failing means the
#   DEDUCTOR bears the tax.
#
#   `financial_year_from` because the threshold is annual and every running
#   total starts again on 1 April. Without it an acknowledgement made in March
#   silences that vendor for the whole of the following year.
#
# MATERIAL — `projected`, and ONLY that. It is `purchased_ytd + on_order`, and
#   hashing all three would count one movement three times. It is also the
#   right one on the statute: converting an order into a bill moves both
#   components and changes the exposure not at all, and 194Q does not care
#   which of the two a rupee is sitting in.
#
# INCIDENTAL — `vendor`, `threshold`, `rate`, `basis` (constants),
#   `pct_of_threshold` and `indicative_tds` (both derived from `projected`),
#   `crossed` and `will_cross_on_current_orders` (derived, and the crossing is
#   already handled by the list split).
#
# RECOMPUTE — `counts.vendors_past_the_threshold` and
#   `counts.vendors_approaching`, which span the two lists and are therefore
#   the mapping form's business. `vendors_total`, `could_not_check`,
#   `capped_at` and `was_capped` are population: an org that acknowledged every
#   vendor near the line has not stopped having vendors.

def _194q_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild the two vendor counts from their own lists."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    counts["vendors_past_the_threshold"] = len(surviving.get("past_the_threshold") or ())
    counts["vendors_approaching"] = len(surviving.get("approaching") or ())


# ── check_msme_payment_clock ────────────────────────────────────────────────
#
# Bills owed to micro and small enterprises past the MSMED s.15 window. The
# consequence of a breach is not a reminder — it is disallowance of the
# deduction and interest at three times the bank rate — and NOTHING the firm
# does inside this product can close the finding except paying, which this skill
# cannot record. So the same bills return every run, including the ones the firm
# has already disputed, already scheduled, or already settled by a route the
# ledger does not know about.
#
# FINDINGS_AT — `past_the_window`, `inside_the_window` and `not_classified`.
#   THREE lists, and they are three different statements: a breach, a clock
#   still running, and a bill whose vendor nobody has classified. A bill moves
#   from the second list to the first when the window closes, and the folded
#   list name orphans the acknowledgement at exactly that moment — which is
#   right, because "I know, it is due next week" is not "I know, we are in
#   breach".
#
# IDENTITY — `bill_id`, which the handler already returns. One field, because
#   the bill row IS the fact: the vendor, the window and the leg are all
#   properties of it. `bill` (the supplier's number) is deliberately NOT the
#   key here even though `propose_payment_run` uses it — that handler has no id
#   to hand and this one does, and a supplier number can be corrected.
#
# MATERIAL — `outstanding_including_tax` and `status`. The first is what is
#   actually at risk; the second because a bill put on hold or cancelled is a
#   different situation under the same number. `taxable_value` is deliberately
#   out: it moves only when the bill itself is edited, which moves the
#   outstanding too, so it would count one change twice.
#
# INCIDENTAL — and THIS ENTRY IS WHERE THE DRIFT GUARD DOES NOT SAVE ANYBODY.
#   `age_in_days` and `days_past_the_window` both tick with the calendar, and
#   NEITHER SPELLING IS IN `_DRIFT_FIELDS`: that frozenset holds `age_days`,
#   `days_past`, `days_past_due` and `days_overdue`, and these two are none of
#   them. The exception would not fire. So they are kept out of both hashes by
#   the same reasoning the guard exists to encode, and a test pins it — the
#   guard is a list of names somebody wrote down, not a law of nature.
#
#   `pay_by` is incidental too: it is a deadline computed from the bill date
#   and the window, so it is fixed while both are, and it moves only when
#   something already in the key or the material bucket moves.
#
#   `clock_started_from`, `clock_started_on`, `acceptance_date`, `bill_date`,
#   `leg`, `window_applied_days`, `agreed_terms_days`, `enterprise_class`,
#   `vendor_kind`, `udyam_number` and `vendor` are facts about how the clock was
#   set, not about what is owed.
#
# RECOMPUTE — the three bill counts and BOTH figures in `amount_at_risk`, which
#   are sums over `past_the_window` ALONE. That asymmetry is the whole reason
#   this recompute is written by hand: rebuilding the money from all three
#   surviving lists would add bills that are not in breach to a figure whose
#   name says they are.
#
#   Everything else in `counts` is the vendor and bill population, and
#   `could_not_check` is the number the handler wrote a paragraph to defend —
#   vendors never tested against the section at all. An acknowledgement changes
#   none of it.

def _msme_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild the three counts, and the money from the BREACHED list only."""
    breached = list(surviving.get("past_the_window") or ())
    counts = out.get("counts")
    if isinstance(counts, dict):
        counts["bills_past_the_window"] = len(breached)
        counts["bills_inside_the_window"] = len(surviving.get("inside_the_window") or ())
        counts["bills_not_classified"] = len(surviving.get("not_classified") or ())
    at_risk = out.get("amount_at_risk")
    if isinstance(at_risk, dict):
        at_risk["outstanding_including_tax"] = round(
            sum(_money(e.get("outstanding_including_tax")) for e in breached), 2)
        at_risk["taxable_value_of_breached_bills"] = round(
            sum(_money(e.get("taxable_value")) for e in breached), 2)


def _money(value: Any) -> float:
    """A finding's amount as a float, or 0.0. Never raises inside a rebuild."""
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


# ── check_tds_thresholds ────────────────────────────────────────────────────
#
# Vendors whose credited value in the financial year has crossed, or is within
# ten per cent of, the TDS threshold for their recorded section. Like 194Q the
# finding cannot be resolved: crossing is a fact about the year, and starting to
# deduct does not un-cross it. Unlike 194Q the handler is honest that it usually
# cannot answer at all — no live org has both a section on the vendor and a
# threshold in the calendar — so its `unattributed` list is the one a firm
# actually works through, and it is exactly the list somebody will want to close
# vendor by vendor as they decide "this one has no section because it needs
# none".
#
# FINDINGS_AT — `crossed`, `within_the_last_10_percent`,
#   `section_recorded_but_no_threshold` and `unattributed`. FOUR of the five
#   lists.
#
#   `below_the_threshold` is deliberately NOT wired, and that is a judgement
#   rather than an omission: it is the reassurance list. Nothing in it asks
#   anybody to do anything, and an acknowledge button on it would invite
#   somebody to silence the evidence that the check ran at all — which is the
#   denominator this handler exists to protect. Its count is therefore also
#   left alone, correctly, because the list it counts is never filtered.
#
# IDENTITY — `vendor_id` (already returned) and `financial_year` (added here,
#   one line). Same two reasons as 194Q: the vendor NAME is not unique — two
#   groups of active vendors share one, measured live — and the running total
#   restarts on 1 April, so an acknowledgement made in March must not cover the
#   following year.
#
#   NOT `section`. It is recorded ON the vendor and a firm correcting it from
#   194J to 194C has not made this a different vendor; the correction shows up
#   as the threshold moving, which is what the list split already reports.
#
# MATERIAL — `credited_taxable_value` and `documents_with_no_tds_recorded`.
#   The first is the running total the whole verdict turns on, and the handler
#   is explicit that it is the taxable value and NOT `credited_including_tax`,
#   which sits beside it for reconciliation only — so hashing the gross would
#   tie the acknowledgement to a figure no threshold is tested on.
#
#   The second is the actionable half: a vendor who crossed and now has every
#   document carrying TDS is in a materially different position from one who
#   crossed with nine documents and nothing deducted.
#
#   NOT `paid_in_year`. The handler's own limitation says it is "near-empty BY
#   CONSTRUCTION" — `amount_paid` carries no date and `ganit_vendor_payments`
#   holds one row in the entire database — so hashing it would tie every
#   acknowledgement to a column that is about to change meaning the moment
#   somebody fixes it.
#
# INCIDENTAL — `vendor`, `threshold`, `statute`, `statute_key_asked_for`, `why`,
#   `documents`, `credited_including_tax`, `tds_recorded`.
#
# RECOMPUTE — only the counts whose lists are actually filtered:
#   `vendors_with_no_section` (which IS `len(unattributed)`), `crossed`,
#   `within_the_last_10_percent` and `section_recorded_but_no_threshold`.
#   `below` is untouched because its list is untouched. Everything else —
#   `vendors_total`, `vendors_with_a_recorded_section`, the expense counts,
#   `tds_recorded_total`, `could_not_check` — is population, and
#   `could_not_check` in particular is what stops a `crossed` count of zero
#   reading as an all-clear.

def _tds_thresholds_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild the four counts whose lists this wiring filters, and no others."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    counts["crossed"] = len(surviving.get("crossed") or ())
    counts["within_the_last_10_percent"] = len(
        surviving.get("within_the_last_10_percent") or ())
    counts["section_recorded_but_no_threshold"] = len(
        surviving.get("section_recorded_but_no_threshold") or ())
    counts["vendors_with_no_section"] = len(surviving.get("unattributed") or ())


# ── check_chase_ladder ──────────────────────────────────────────────────────
#
# What is overdue, how many chases have already been DELIVERED against it, and
# what the next rung is. The handler never sends and never writes — it says what
# is due and to whom — so nothing it reports can be closed from inside it. An
# item chased by telephone, or settled in a corridor, climbs the ladder anyway
# and arrives at "escalate to a partner" about something that was dealt with a
# week ago.
#
# FINDINGS_AT — all four lists, and LISTS_ARE_ONE_POPULATION.
#   `nudges_due`, `escalations_due`, `expired_and_must_be_reissued` and
#   `waiting_but_nothing_due` are one set of items partitioned by what the
#   ladder says to do next. An item is in exactly one, and it moves between them
#   AS THE CLOCK RUNS — nothing-yet to first nudge to second nudge to
#   escalation, on nothing but elapsed days.
#
#   This is the entry the flag was added for. Folding the list name into the key
#   would orphan the acknowledgement at every rung: ack the task on Monday, find
#   it back on Thursday under a different heading, again the week after. Three
#   acknowledgements of one task in a fortnight is how a person learns not to
#   bother. Cross-list collision cannot happen here because the item is in one
#   list at a time, so the wiring takes the uniqueness guarantee on itself.
#
# IDENTITY — `entity_type` + `entity_id`. Both are already on the finding: this
#   skill reads TASKS and SIGNATURE DOCUMENTS into one ladder, and the two id
#   spaces are separate tables, so the type has to ride along. Hashed, so no
#   UUID is rendered.
#
# MATERIAL — `chases_delivered`, and ONLY that.
#
#   It is the one field that moves on a real event: a reminder was actually
#   DELIVERED, which the handler is careful to distinguish from one that was
#   suppressed. Somebody who acknowledged "we have chased this twice, leave it"
#   should see it again when a third chase goes out.
#
#   NOT `rung`, and this is the trap. `_rung_for(days, sent)` is a function of
#   the day count AND the chase count, so hashing it would import the calendar
#   into the material bucket through the back door and void every
#   acknowledgement the moment a ladder threshold was crossed — the same
#   midnight failure the list-folding flag was turned off to avoid, arriving by
#   the other route. `action`, `direction` and `why` are derived from `rung` and
#   are out for the same reason.
#
#   NOT `expired` either: an expired signature moves to its own list, and the
#   population is partitioned, so the state change is visible without being
#   hashed. It is also one-way.
#
# INCIDENTAL — `days_past_due` (in `_DRIFT_FIELDS`, so it would raise),
#   `due_on`, `what`, `escalate_to`, `waiting_on`, `signers`, `kind`.
#
# RECOMPUTE — the four counts that are sums over the filtered lists, plus
#   `waiting_on` and the kind split, which are sums over ALL of them. Not
#   `capped_at` / `was_capped`, which describe the query.
#
#   `escalations_with_no_owner` is rebuilt too, and it has to be: it is the
#   count a limitation line quotes by number, and a limitation that says "3
#   item(s) have reached the escalation rung and carry NO internal owner" above
#   a list showing one is the reports-page defect in the paragraph rather than
#   the table. The limitation text itself is left alone — rewriting prose from a
#   filter is a different and worse idea — so the two can still disagree, and
#   that is recorded here rather than papered over.

def _chase_ladder_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild every count that is a sum over the ladder's own lists."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    nudges = list(surviving.get("nudges_due") or ())
    escalations = list(surviving.get("escalations_due") or ())
    expired = list(surviving.get("expired_and_must_be_reissued") or ())
    quiet = list(surviving.get("waiting_but_nothing_due") or ())
    everything = nudges + escalations + expired + quiet

    counts["nudges_due"] = len(nudges)
    counts["escalations_due"] = len(escalations)
    counts["action_due_now"] = len(nudges) + len(escalations)
    counts["expired_signatures"] = len(expired)
    counts["nothing_due"] = len(quiet)
    counts["escalations_with_no_owner"] = sum(
        1 for i in escalations if not i.get("escalate_to"))
    counts["waiting_on"] = len(everything)
    counts["tasks"] = sum(1 for i in everything if i.get("kind") == "task")
    counts["signatures"] = sum(1 for i in everything if i.get("kind") == "signature")


# ── check_approvals_that_sit ────────────────────────────────────────────────
#
# Pending approvals, laddered by how long they have waited. The handler's second
# limitation is the whole case for this wiring, in its own words: "Run daily,
# this names the same approvals every day until they are decided." It cannot
# subtract what was already sent, because `staging.reminders.entity_id` is a
# uuid and `public.approvals.approval_id` is text, so no approval chase can ever
# be recorded. Every row reports `chases_delivered: 0` for ever.
#
# FINDINGS_AT — `ping_the_approver`, `copy_the_requester`, `escalations_due`,
#   `waiting_but_nothing_due` and `on_a_deleted_project`. Five lists, and
#   LISTS_ARE_ONE_POPULATION for the same reason as `check_chase_ladder`: they
#   partition the pending approvals by what to do next, an approval is in
#   exactly one, and it moves between them as the days pass.
#
# IDENTITY — `approval_id` alone. The handler already calls it "a row handle for
#   the UI to act on, not a value to render as a name", and it is TEXT rather
#   than a uuid — which is exactly why this ladder has no chase history, and
#   exactly why it is a good key.
#
#   NOT `project`, `what` or `requested_by`: an approval moved to another
#   project, or retitled, is the same request waiting.
#
# MATERIAL — None, and this is one of the few places that answer is forced by a
#   defect rather than chosen. The only field that could carry movement is
#   `chases_delivered`, and the handler pins it at 0 on every row for ever — a
#   constant is not a state. `rung` is likewise pinned at one. So there is
#   nothing in this shape that can move, and an acknowledgement here is
#   unconditional: "stop showing me this approval" until it is decided, which
#   removes it from the query, or until somebody withdraws the ack.
#
#   `rung_the_age_alone_would_reach` and `aged_past_escalation` DO move — and
#   both move with the calendar alone, which is precisely why they are not in
#   this bucket. They are the handler's honest substitute for a ladder it
#   cannot walk, not a change in the fact.
#
# INCIDENTAL — `days_waiting`, `raised_on`, `waiting_on`, `escalate_to`,
#   `project_deleted` (which the list split already carries), and the derived
#   `action` / `direction` / `why`.
#
# RECOMPUTE — every count that is a sum over the five lists, and NOT the four
#   that are not. `approvals_all_statuses` and `decided` come from a status
#   census over the whole table, `capped_at` / `was_capped` describe the query,
#   and `by_status` is that census — an org that acknowledged every pending
#   approval has not decided any of them.
#
#   `with_no_approver_to_ping` and `aged_past_escalation` are rebuilt because a
#   limitation line quotes each BY NUMBER, and a paragraph that says four above
#   a list of one is the reports-page defect in prose. The prose itself is left
#   alone, so the two can still disagree; rewriting a limitation from a filter
#   would be worse than the disagreement.

def _approvals_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild every count that is a sum over the ladder's own five lists."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    ping = list(surviving.get("ping_the_approver") or ())
    copy_requester = list(surviving.get("copy_the_requester") or ())
    escalations = list(surviving.get("escalations_due") or ())
    quiet = list(surviving.get("waiting_but_nothing_due") or ())
    orphaned = list(surviving.get("on_a_deleted_project") or ())
    live = ping + copy_requester + escalations + quiet

    counts["ping_the_approver"] = len(ping)
    counts["copy_the_requester"] = len(copy_requester)
    counts["escalations_due"] = len(escalations)
    counts["action_due_now"] = len(ping) + len(copy_requester) + len(escalations)
    counts["nothing_due_yet"] = len(quiet)
    counts["on_a_deleted_project"] = len(orphaned)
    counts["on_a_live_project"] = len(live)
    counts["pending"] = len(live) + len(orphaned)
    counts["with_no_approver_to_ping"] = sum(1 for i in live if not i.get("waiting_on"))
    counts["aged_past_escalation"] = sum(
        1 for i in live if i.get("aged_past_escalation"))


# ── check_quotation_expiry ──────────────────────────────────────────────────
#
# Open quotations against their validity date, with a three-beat chase and a
# lapsed list. It "DRAFTS, IT DOES NOT SEND": no message goes out, no reminder
# row is written and no status changes — so a quote chased by telephone, or one
# the customer has already declined verbally, sits on the list until somebody
# marks it, and the handler says as much ("A quote accepted verbally and never
# marked accepted will still be chased").
#
# FINDINGS_AT — `chase_due_now`, `chase_not_yet_due`, `already_lapsed` and
#   `open_without_validity`, with LISTS_ARE_ONE_POPULATION. Every open quotation
#   is in exactly one, and it walks from `chase_not_yet_due` to `chase_due_now`
#   to `already_lapsed` on the calendar alone. Folding the list name would
#   orphan the acknowledgement twice on the way through, which is the ladder
#   failure `check_chase_ladder` documents.
#
# IDENTITY — `quotation_id`, already emitted by the handler. NOT
#   `quotation_number`, which is a document number a firm can correct, and NOT
#   `customer`: `staging.crm_accounts` is empty, so the customer name is blank
#   on every row this skill can currently produce.
#
# MATERIAL — `amount` and `status`. A quote re-priced from 40,000 to 90,000 is a
#   different offer under the same number, and a move between the open states is
#   a real change in where the deal stands. Both come straight off the row.
#
# INCIDENTAL — `days_until_expiry` and `days_since_expiry`, and NEITHER IS IN
#   `_DRIFT_FIELDS`: the frozenset holds `days_until` and `days_left`, not these
#   two spellings, so nothing would have raised. They are the second entry in
#   this file where the guard does not fire and the judgement has to stand on
#   its own.
#
#   `valid_until` is incidental too, which is worth stating: extending a quote's
#   validity moves it back down the beats, and with the population partitioned
#   that move is already free. Hashing the date would void the acknowledgement
#   for an extension that made the finding LESS urgent.
#
#   `beat`, `beat_name`, `first_beat_on`, `why`, `suggested_action` and `draft`
#   are all derived from the date; `deal` and `currency` are labels.
#
# RECOMPUTE — the three counts that are sums over the lists this wiring
#   filters: `chase_due_now`, `chase_not_yet_due`, `already_lapsed`.
#
#   NOT `open_without_a_validity_date`, and this one is a trap worth naming: it
#   sits beside the other three and reads like a fourth list length, but the
#   handler takes it from the CENSUS query (`totals`), not from
#   `len(no_validity)`. Rebuilding it from the surviving list would quietly
#   convert a population figure into a filtered one. `quotations_recorded`,
#   `open_and_sent_to_customer`, `drafts_never_sent`, `already_closed`,
#   `coverage` and the cap are census too — and on this skill the census is the
#   whole point, because the table is empty in every live org and an empty
#   result must never read as "nothing is expiring".

def _quotation_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild the three beat counts. The validity count is a CENSUS — see above."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    counts["chase_due_now"] = len(surviving.get("chase_due_now") or ())
    counts["chase_not_yet_due"] = len(surviving.get("chase_not_yet_due") or ())
    counts["already_lapsed"] = len(surviving.get("already_lapsed") or ())


# ── check_wip_ageing ────────────────────────────────────────────────────────
#
# Unbilled time entries past the escalation threshold. A time entry leaves this
# list when it is INVOICED, and the commonest reason one sits there for months
# is a decision the product cannot record: a fixed-fee engagement where the time
# will never be billed, or a write-off waiting for a partner to sign it off.
# Both read as "still unbilled" for ever.
#
# FINDINGS_AT — `escalated.rows`, A DOTTED PATH, and the first user of one. The
#   rows sit beside `threshold_days` and `entries`, and that is right: the
#   threshold and the true total belong with the rows they describe.
#
#   `by_engagement` and `by_person` are NOT wired. They are aggregations of the
#   same time, not findings — acknowledging "the Sharma audit" would silence a
#   summary line, and the entries under it would carry on being reported by the
#   list that actually lists them.
#
# IDENTITY — `entry_id`, the time entry itself. NOT `task_id`: a task carries
#   many entries and the fact being acknowledged is one person's one stretch of
#   work. NOT `person` or `engagement`, which are labels on it.
#
# MATERIAL — `hours` and `billable`.
#
#   `hours` because an entry corrected from 2 to 20 is a different piece of WIP.
#   `billable` because it is the DECISION the acknowledgement is standing in
#   for: a firm that acknowledges an old entry and then marks it a write-off has
#   answered the question properly, and the finding should come back once so the
#   reader sees that it did. It is a tri-state — True, False, or None for "not
#   recorded" — and `_canon` tags the boolean and the None separately, so those
#   three do not collide.
#
#   NOT `rate_per_hour`: the money is not this skill's finding, and the handler
#   is at pains to say so — `rupees` is a RANGE precisely because so much is
#   unclassified.
#
# INCIDENTAL — `age_days`, which IS in `_DRIFT_FIELDS` and would raise; also
#   `worked_on` (fixed), `task_status` (the task may close while its time stays
#   unbilled), `billability` (prose derived from `billable`), `note`, `task`.
#
# RECOMPUTE — `counts.escalated_rows_listed` and nothing else, because almost
#   nothing else in this return is a sum over the rows.
#
#   `escalated.entries` and `counts.past_escalation_threshold` are the CENSUS —
#   the true number past the threshold, which already exceeds `len(rows)`
#   whenever the list is capped. Rebuilding either from the survivors would
#   destroy the one figure that tells a reader the list is a sample. Same for
#   `escalated.hours`, every figure under `hours` and `rupees`, the ageing
#   bands, `coverage`, and the two `*_listed` counts for the aggregation lists
#   this wiring does not touch.

def _wip_recompute(out: dict, surviving: Sequence[dict]) -> None:
    """Rebuild the one count that is a sum over the listed rows.

    `escalated.entries` and `past_escalation_threshold` are deliberately NOT
    touched: they are the census the rows are a sample of, and on a capped run
    they are already larger than the list.
    """
    counts = out.get("counts")
    if isinstance(counts, dict):
        counts["escalated_rows_listed"] = len(surviving)


# ── check_stale_retainer_rates ──────────────────────────────────────────────
#
# Engagements coming up for renewal, or whose fee has not been touched in a long
# time, and the recurring profiles that have billed the same amount for years.
# The handler's first limitation is why this repeats for ever: "There is no rate
# history anywhere in this system", so "the fee has not been revised" can only
# mean "the contract row has not been edited". A firm that has DECIDED to hold a
# fee flat has no way to say so, and reads the same engagements every run until
# they edit a row for an unrelated reason.
#
# FINDINGS_AT — `contracts` and `recurring_profiles`. Two lists, and unlike the
#   ladders these are two different POPULATIONS — engagement records and
#   recurring billing profiles, in two tables. A subject cannot be in both, so
#   the default folding costs nothing, and it is left ON: it guarantees an
#   engagement can never share a key with a profile even if a future id scheme
#   collides.
#
# IDENTITY — `engagement_ref` on one list, `profile_ref` on the other, BOTH
#   ADDED to the handler here, and BOTH OPAQUE. Neither list carried an id, and
#   neither had a usable alternative:
#
#     an engagement has a TITLE, which repeats across clients ("Annual audit")
#     and can be retitled; `client` is a name.
#     a recurring profile has NO title and NO number at all. The only other
#     candidate was client plus amount — and the amount changes the moment the
#     fee is revised, which is the very thing this skill exists to notice. An
#     acknowledgement keyed on it would be orphaned by the event it is about.
#
#   They are `skill_ack.opaque_ref(...)` rather than the raw uuid, because
#   `test_no_id_reaches_the_engagement_output_either` bans a UUID from every
#   field of this handler's output except `link` — and it is right to: an id
#   beside a client name is what `check-rendered-ids` exists to stop. Hashing
#   the id keeps the stability and renders nothing.
#
#   The lambda reads whichever key is present, so one function serves both
#   lists; the folded list name keeps them apart regardless. If BOTH are absent
#   the key collapses to a pair of Nones and every id-less finding shares it —
#   which is why `test_a_finding_with_no_id_does_not_raise` checks that a
#   finding without a ref is SHOWN rather than swept up by somebody else's
#   acknowledgement.
#
# MATERIAL — `contract_value` and `amount_before_gst`, again whichever the list
#   carries, plus `status`.
#
#   `contract_value` is the engagement's value and `amount_before_gst` the
#   profile's fee, and a change in either is exactly the revision the firm was
#   being nagged to make — so the acknowledgement should void and the finding
#   return once, showing that it happened. `status` because an engagement
#   moving to `expired` or `terminated` is a different fact under one name.
#
#   NOT `distinct_amounts_billed`, which the handler calls "evidence, not
#   proof": it counts the distinct amounts a profile has ever billed, so it
#   moves on the FIRST revision and then never again, and hashing it alongside
#   the amount would count that one event twice.
#
# INCIDENTAL — `days_to_end` (a clock), `last_changed` and `created_on` (dates
#   whose whole purpose is to be compared with today), `reasons` and
#   `contradiction` (derived classifications — an engagement can gain
#   `status_contradicts_dates` because the calendar passed its end date),
#   `reminder_days_on_the_record`, `next_invoice_on`, `first_billed`,
#   `invoices_raised`, `frequency`, `gst_rate` and the client contact keys.
#
# RECOMPUTE — `counts.engagements_flagged`, `counts.recurring_profiles_flagged`
#   and the four reason tallies, which are sums over the `contracts` list.
#   `reminder_window_is_configured` is left alone: it is a distribution over
#   EVERY engagement in the org and the note attached to it is a statement
#   about the product's defaults, not about the findings.

def _stale_retainer_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild both list counts and the reason tallies over the contracts."""
    contracts = list(surviving.get("contracts") or ())
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    for reason in ("expiring_soon", "in_the_firms_reminder_window",
                   "unchanged_too_long", "status_contradicts_dates"):
        counts[reason] = sum(1 for c in contracts
                             if reason in (c.get("reasons") or ()))
    counts["engagements_flagged"] = len(contracts)
    counts["recurring_profiles_flagged"] = len(surviving.get("recurring_profiles") or ())


# ── check_esi_ceiling_crossings ─────────────────────────────────────────────
#
# Employees whose wages crossed the ESI ceiling with no contribution deducted,
# and those newly at or below it. The handler's own first limitation is why an
# acknowledgement is the right instrument here: "THIS READS ONE MONTH ... so
# every row here is a question to check, not a confirmed breach." A question
# somebody has checked and answered — "the crossing was before this period
# began, coverage correctly stopped" — has no way of being recorded, and the
# same names return every month.
#
# FINDINGS_AT — `crossed_and_still_owed` and `newly_under`. Two lists, and the
#   default folding stays ON: they are not a time-driven ladder but two
#   opposite findings, and an employee whose gross falls back under the ceiling
#   has moved from "you may still owe a contribution" to "check whether
#   coverage should have continued". Those are different questions, so an
#   acknowledgement of one must not answer the other.
#
# IDENTITY — `employee_code` + `month`.
#
#   `employee_code` for the reason measured at `check_statutory_records_gate`:
#   the printable `employee` is a NAME and ten of them in the largest org are
#   carried by three people each. NOT `esi_number`, which is nullable and is
#   frequently the very thing that is missing.
#
#   `month` because the handler reads ONE month and the question is asked afresh
#   for each: an answer about July's wages is not an answer about August's, and
#   a person whose pay crosses the ceiling in August has a new obligation.
#
# MATERIAL — `gross` and `contributing_this_month`. The gross is the wage the
#   whole test turns on, and `contributing_this_month` is the ANSWER: a firm
#   that acknowledges a crossing and then starts deducting has resolved it, and
#   the finding should come back once so the reader sees that it did. It is a
#   bool, and `_canon` tags booleans separately from the integers 0 and 1.
#
#   NOT `ceiling`, which comes from the statute calendar and is the same for
#   every row in a run — hashing a constant adds nothing, and a genuine change
#   to the ceiling arrives as a change in `gross > ceiling`, which moves the
#   finding between the lists.
#
# INCIDENTAL — `employee`, `esi_number`, `must_continue_until` (the period end,
#   a date derived from the month), `why` (prose).
#
# RECOMPUTE — the two list counts. NOT `examined`, which is `len(rows)` — every
#   employee the query looked at, including everyone correctly contributing —
#   and not `capped_at` / `was_capped`.

def _esi_recompute(out: dict, surviving: Mapping[str, Sequence[dict]]) -> None:
    """Rebuild the two list counts. `examined` is the population."""
    counts = out.get("counts")
    if not isinstance(counts, dict):
        return
    counts["crossed_and_still_owed"] = len(surviving.get("crossed_and_still_owed") or ())
    counts["newly_under"] = len(surviving.get("newly_under") or ())


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
    # MATERIAL — `balance`, WHICH THE HANDLER NOW RETURNS.
    #
    #   The first version of this entry passed None and recorded the reason as
    #   a debt: the shape carried no amount, so the acknowledgement was
    #   unconditional, and somebody who silenced a bill of 42,000 kept it
    #   silenced at 84,000. That is the wrong default in a money module, and
    #   "the shape was inconvenient" is not a reason to ship it. So the shape
    #   changed.
    #
    #   `overdue_finder._MODULE_MAP` now carries a `money_expr` per module and
    #   `ganit_invoices.balance_due` is a NOT NULL numeric column, so the
    #   receivables ledger's balance is read as-is — no arithmetic anywhere,
    #   least of all in Python, where subtracting two floats on the way into a
    #   state hash reports movement that never happened.
    #
    #   The key is ABSENT rather than zero on the three modules that have no
    #   money (tasks, follow-ups, agreements), so this lambda hashing a None
    #   there would be a hash over a fact the ledger never asserted — which is
    #   why those three keep `material_of=None` and this one does not.
    #
    #   Not `status`: it is applied in the WHERE clause and never returned, so
    #   a paid or cancelled invoice leaves the list rather than moving in it.
    #   `snooze_until` remains the right instrument for "not this week"; what
    #   changed is that "stop telling me about this invoice" no longer means
    #   "however large it grows".
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
        material_of=lambda f: {"balance": f.get("balance")},
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
    # IDENTITY and INCIDENTAL are as `find_overdue_invoices`, and so is MATERIAL
    # now that the handler returns a balance — but the balance ARRIVES
    # DIFFERENTLY here and that is worth one line. `ganit_vendor_bills` has no
    # `balance_due` column and its `amount_paid` is nullable, so `money_expr` is
    # `e.total - COALESCE(e.amount_paid, 0)`: the subtraction is Postgres's,
    # over `numeric`, which is exact — the same expression `payables_run.py`
    # already uses for the same bills — and never Python's over two floats.
    #
    # THE ONE THING THAT IS NOT THE SAME, and the reason this is its own commit:
    #   `propose_payment_run` reads the SAME BILLS and is wired with its own
    #   MATERIAL bucket (`balance_due`, `status`). So one bill can be
    #   acknowledged twice under two skills — "stop proposing me this payment"
    #   there, "stop listing this bill as overdue" here — and the two acks are
    #   correctly independent:
    #   the ack table is keyed (org, skill, finding_key) and the identities are
    #   computed from different fields, so neither can ever match the other's
    #   row. That is the intended behaviour and not an oversight, because the
    #   two skills answer different questions about the same debt.
    #
    #   The two now make the SAME promise about movement, which they did not
    #   before: both void when the balance moves. They still differ in what
    #   they hash it alongside — `propose_payment_run` also watches `status`,
    #   because a bill put on hold is a payment proposal that should not be
    #   made, while this skill's status filter removes such a bill from the
    #   list outright.
    "find_overdue_vendor_bills": AckWiring(
        findings_at="result",
        identity_of=_entity_identity,
        material_of=lambda f: {"balance": f.get("balance")},
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

    "check_payroll_readiness": AckWiring(
        findings_at=("blockers", "warnings"),
        identity_of=lambda f: {
            "month": f.get("month"),
            "check": f.get("check"),
            "employee_code": f.get("employee_code"),
        },
        material_of=lambda f: {"amount": f.get("amount")},
        recompute=_payroll_readiness_recompute,
        label_of=lambda f: f"{f.get('check')} — {f.get('employee') or 'the run'}",
    ),

    "check_impossible_stock": AckWiring(
        findings_at="findings",
        identity_of=lambda f: {"check": f.get("check"), "product": f.get("product")},
        material_of=lambda f: {
            "on_hand": f.get("on_hand"),
            "movement_ledger_net": f.get("movement_ledger_net"),
        },
        recompute=_impossible_stock_recompute,
        label_of=lambda f: f"{f.get('check')} — {f.get('product')}",
    ),

    "check_unfillable_orders": AckWiring(
        findings_at="products",
        identity_of=lambda f: {"product": f.get("product")},
        material_of=lambda f: {
            "on_hand": f.get("on_hand"),
            "shortfall_after_all_open_orders": f.get("shortfall_after_all_open_orders"),
        },
        recompute=_unfillable_recompute,
        label_of=lambda f: (
            f"{f.get('product')} — short "
            f"{abs(float(f.get('shortfall_after_all_open_orders') or 0)):g}"),
    ),

    "check_attendance_exceptions": AckWiring(
        findings_at="findings",
        identity_of=lambda f: {
            "check": f.get("check"),
            "employee_code": f.get("employee_code"),
            "month": f.get("month"),
            "date": f.get("date"),
            "leave_type": f.get("leave_type"),
        },
        material_of=lambda f: {
            "missing_days": f.get("missing_days"),
            "days_taken": f.get("days_taken"),
            "days_over": f.get("days_over"),
            "entitlement": f.get("entitlement"),
        },
        recompute=_attendance_recompute,
        label_of=lambda f: f"{f.get('check')} — {f.get('employee')}",
    ),

    "check_194q_approaching": AckWiring(
        findings_at=("past_the_threshold", "approaching"),
        identity_of=lambda f: {
            "vendor_id": f.get("vendor_id"),
            "financial_year_from": f.get("financial_year_from"),
        },
        material_of=lambda f: {"projected": f.get("projected")},
        recompute=_194q_recompute,
        label_of=lambda f: f"{f.get('vendor')} — 194Q",
    ),

    "check_msme_payment_clock": AckWiring(
        findings_at=("past_the_window", "inside_the_window", "not_classified"),
        identity_of=lambda f: {"bill_id": f.get("bill_id")},
        material_of=lambda f: {
            "outstanding_including_tax": f.get("outstanding_including_tax"),
            "status": f.get("status"),
        },
        recompute=_msme_recompute,
        label_of=lambda f: f"{f.get('bill')} — {f.get('vendor')}",
    ),

    "check_tds_thresholds": AckWiring(
        findings_at=("crossed", "within_the_last_10_percent",
                     "section_recorded_but_no_threshold", "unattributed"),
        identity_of=lambda f: {
            "vendor_id": f.get("vendor_id"),
            "financial_year": f.get("financial_year"),
        },
        material_of=lambda f: {
            "credited_taxable_value": f.get("credited_taxable_value"),
            "documents_with_no_tds_recorded": f.get("documents_with_no_tds_recorded"),
        },
        recompute=_tds_thresholds_recompute,
        label_of=lambda f: f"{f.get('vendor')} — {f.get('section') or 'no section'}",
    ),

    "check_chase_ladder": AckWiring(
        findings_at=("nudges_due", "escalations_due",
                     "expired_and_must_be_reissued", "waiting_but_nothing_due"),
        identity_of=lambda f: {
            "entity_type": f.get("entity_type"),
            "entity_id": f.get("entity_id"),
        },
        material_of=lambda f: {"chases_delivered": f.get("chases_delivered")},
        recompute=_chase_ladder_recompute,
        label_of=lambda f: f"{f.get('kind')} — {f.get('what')}",
        lists_are_one_population=True,
    ),

    "check_approvals_that_sit": AckWiring(
        findings_at=("ping_the_approver", "copy_the_requester", "escalations_due",
                     "waiting_but_nothing_due", "on_a_deleted_project"),
        identity_of=lambda f: {"approval_id": f.get("approval_id")},
        material_of=None,
        recompute=_approvals_recompute,
        label_of=lambda f: f"{f.get('what')} — {f.get('project')}",
        lists_are_one_population=True,
    ),

    "check_quotation_expiry": AckWiring(
        findings_at=("chase_due_now", "chase_not_yet_due", "already_lapsed",
                     "open_without_validity"),
        identity_of=lambda f: {"quotation_id": f.get("quotation_id")},
        material_of=lambda f: {"amount": f.get("amount"), "status": f.get("status")},
        recompute=_quotation_recompute,
        label_of=lambda f: f"{f.get('quotation_number')} — {f.get('customer')}",
        lists_are_one_population=True,
    ),

    "check_wip_ageing": AckWiring(
        findings_at="escalated.rows",
        identity_of=lambda f: {"entry_id": f.get("entry_id")},
        material_of=lambda f: {
            "hours": f.get("hours"),
            "billable": f.get("billable"),
        },
        recompute=_wip_recompute,
        label_of=lambda f: f"{f.get('engagement')} — {f.get('person')}",
    ),

    "check_stale_retainer_rates": AckWiring(
        findings_at=("contracts", "recurring_profiles"),
        identity_of=lambda f: {
            "engagement_ref": f.get("engagement_ref"),
            "profile_ref": f.get("profile_ref"),
        },
        material_of=lambda f: {
            "contract_value": f.get("contract_value"),
            "amount_before_gst": f.get("amount_before_gst"),
            "status": f.get("status"),
        },
        recompute=_stale_retainer_recompute,
        label_of=lambda f: (
            f"{f.get('engagement') or 'recurring billing'} — {f.get('client')}"),
    ),

    "check_esi_ceiling_crossings": AckWiring(
        findings_at=("crossed_and_still_owed", "newly_under"),
        identity_of=lambda f: {
            "employee_code": f.get("employee_code"),
            "month": f.get("month"),
        },
        material_of=lambda f: {
            "gross": f.get("gross"),
            "contributing_this_month": f.get("contributing_this_month"),
        },
        recompute=_esi_recompute,
        label_of=lambda f: f"ESI — {f.get('employee')} ({f.get('month')})",
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


def _read_bucket(data: Mapping[str, Any], path: str) -> Any:
    """Read `"a"` or `"a.b"` out of a handler's return dict.

    A dotted path exists because `check_wip_ageing` puts its findings under
    `escalated.rows`, beside the threshold and the census the rows are a sample
    of. Making that skill un-wireable over a nesting the handler had good reason
    for would be the mechanism dictating the shape of the answer.

    Anything missing on the way down returns None, which the caller treats as
    "the handler changed shape" and fails OPEN.
    """
    node: Any = data
    for step in path.split("."):
        if not isinstance(node, Mapping):
            return None
        node = node.get(step)
    return node


def _write_bucket(data: dict, path: str, value: list) -> None:
    """Write the surviving findings back where they were read from.

    Silently does nothing if the parent has gone — the caller has already
    established the path exists, and a rebuild that invented a nesting would be
    worse than one that skipped it.
    """
    steps = path.split(".")
    node: Any = data
    for step in steps[:-1]:
        node = node.get(step) if isinstance(node, Mapping) else None
        if not isinstance(node, dict):
            return
    if isinstance(node, dict):
        node[steps[-1]] = value


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
    if isinstance(wiring.findings_at, str) or wiring.lists_are_one_population:
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
    lists = {key: _read_bucket(data, key) for key in buckets}
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
        _write_bucket(data, key, kept)

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
