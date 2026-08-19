"""lifecycle.py — the two ends of a client relationship, as queries.

Migration 163 records them; this module is the only thing that reads them and
the only place the rules live. Three questions, and they are the whole API:

    incomplete_at_entry(pool, org_id)   what an engagement still owes before it
                                        should have been accepted
    outstanding_at_exit(pool, org_id)   what a departing client is still owed,
                                        and what the firm cannot yet prove
    retention_expiring(pool, org_id)    whose working papers come out of the
                                        retention window, and whose have no
                                        window at all

── THE RULE THIS MODULE EXISTS FOR, AND THE RULE ABOUT NOT OVER-APPLYING IT ──

Clause (8) of Part I of the First Schedule to the Chartered Accountants Act,
1949 makes it professional misconduct to accept "a position as auditor
previously held by another chartered accountant or a certified auditor who has
been issued certificate under the Restricted Certificate Rules, 1932 without
first communicating with him in writing". ICAI's FAQ settles the scope: the
requirement "would apply to all types of audits viz., statutory audit, tax
audit, internal audit, concurrent audit or any other kind of audit"
(https://icai.org/post/5645), and members have been penalised for failing it.

THE FAILURE MODE THIS MODULE IS BUILT AGAINST IS THE OTHER ONE. Clause (8)
reaches a position AS AUDITOR. It does not reach bookkeeping, an income-tax
return, a GST return, an ROC filing, payroll, a certificate, a valuation or a
representation before an assessing officer; it does not reach a first-ever
appointment, because there is no predecessor to write to; and it does not reach
an audit whose predecessor was not a chartered accountant, because the clause
names one. A compliance product that demands a predecessor letter in any of
those cases is not being careful, it is refusing to let a firm do lawful work —
and the firm's response is to stop using the register, at which point the audits
that DO need the letter stop being tracked too. Over-demanding is not the safe
direction. It is a different way to lose the same thing.

So `clause8_applies()` is one function, four lines, and
tests/test_client_lifecycle.py asserts it in both directions.

── WHAT SATISFIES IT, AND WHAT DOES NOT ─────────────────────────────────────

  · A REPLY IS NOT REQUIRED. The misconduct is failing to communicate. A "no
    objection" reply is customary and is useful evidence, and a predecessor who
    never answers cannot hold the incoming auditor hostage. Nothing here waits
    for one; `reply_received_on` is recorded and is never demanded.
  · EVIDENCE OF DELIVERY IS REQUIRED, because that is what the disciplinary
    material asks the member to produce. An attempt counts once it was actually
    delivered, or carries a proof reference (registered-post tracking number,
    courier AWB, signed acknowledgement) that a firm could put in front of a
    board. A letter recorded as `returned_undelivered` proves the opposite.
  · IT MUST PRECEDE ACCEPTANCE — "without FIRST communicating". A letter
    dispatched after the engagement was accepted is reported as LATE and not as
    satisfied, because a firm that reads "done" there will not fix its process.
  · AND IT MUST PRECEDE IT BY SOMETHING. ICAI's FAQ makes the member guilty who
    failed to communicate in writing "and if he did not wait for a reasonable
    length of time for a reply to be received from him", so posting the letter
    on the morning of the day the engagement was signed is not compliance, and
    an earlier draft of this module called it `satisfied`. It is reported as
    `accepted_without_wait`. ICAI fixes no number of days and neither does this
    module pretend to: see REASONABLE_REPLY_WAIT_DAYS for why seven, and why
    the gap it raises does not block.
  · SEVERAL ATTEMPTS ARE NORMAL. Registered post comes back undelivered; a firm
    sends again. Any ONE timely, evidenced attempt satisfies the clause, which
    is why the attempts are rows (migration 163) and not a column.

── RETENTION ANCHORS ON THE REPORT, NOT ON THE EXIT ─────────────────────────

SQC 1 paragraph 83, as amended by the ICAI Council on 19 August 2009, sets the
retention period for audit engagement documentation at "ordinarily no shorter
than seven years from the date of the auditor's report, or, if later, the date
of the group auditor's report" — reduced from ten years by that amendment. The
clock therefore starts at the report, and an engagement whose report was signed
in 2021 for a client who left in 2026 comes out of the window in 2028, not 2033.
`retention_anchor_date` is a separate column from every exit date for exactly
that reason, and `retention_until_for()` never looks at an exit date.

── INTEGRATION POINT: services/statute.py ───────────────────────────────────

That seven is a statutory fact and statutory facts move — this one has already
moved once, from ten. It is NOT hardcoded here on the assumption it is
permanent; it is hardcoded here because `staging.statute_calendar` (migration
158) does not yet carry a key for it. When it does, `retention_years_for()`
should take `as_of` and read `_STATUTE_KEY_RETENTION` through
`services.statute.obligation()` rather than returning a constant. The seam is
marked at the function. Do not build a second dated-facts table here.

── WHY `pool` IS A PARAMETER AND NOT `await get_pool()` ─────────────────────

Same reason as services/statute.py, its closest sibling: it makes every query
here exercisable against the MagicMock pool the suite installs
(tests/conftest.py), and it lets a caller inside an open transaction pass its
own connection. Only `.fetch` is used, and a pool and a connection both answer
it.

── NAMES, NOT IDS ───────────────────────────────────────────────────────────

Every row returned carries `client_name`. `client_id` and `engagement_id` come
back too and are for LINKING ONLY — never for display. Nothing this module puts
in a human-readable string (`Gap.label`, `Gap.basis`) contains a uuid, and a
test asserts it, because the one thing a compliance screen must not do is tell a
partner that "e3f1…-9ac2 is missing its predecessor letter".
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Sequence

log = logging.getLogger(__name__)


# ══ vocabulary ═══════════════════════════════════════════════════════════════
#
# These two frozensets are mirrored, name for name, by the
# `client_engagements_type_ck` CHECK in migrations/163_client_engagement_
# lifecycle.sql. tests/test_client_lifecycle.py parses that CHECK out of the
# .sql file and asserts the union below equals it — a drift between the two is
# otherwise invisible, because Python would happily classify a type the database
# refuses to store and the failure would land on a user as an insert error
# rather than on us as a red test.

#: Everything Clause (8) reaches. `other_audit` is the catch-all for ICAI's "or
#: any other kind of audit" and belongs here; a new audit type added to the
#: CHECK and forgotten here would silently stop demanding the predecessor
#: letter, which is the single worst bug this module could ship — hence the
#: drift test.
AUDIT_ENGAGEMENT_TYPES: frozenset[str] = frozenset({
    "statutory_audit",
    "tax_audit",
    "internal_audit",
    "concurrent_audit",
    "stock_audit",
    "revenue_audit",
    "bank_branch_audit",
    "trust_audit",
    "cooperative_audit",
    "forensic_audit",
    "other_audit",
})

#: Everything Clause (8) does not reach. Lawful work that no predecessor letter
#: gates. See the module docstring on why this set is load-bearing.
NON_AUDIT_ENGAGEMENT_TYPES: frozenset[str] = frozenset({
    "accounting",
    "income_tax_return",
    "tds_return",
    "gst_return",
    "roc_filing",
    "payroll",
    "certification",
    "valuation",
    "advisory",
    "representation",
    "company_secretarial",
    "other_non_audit",
})

ENGAGEMENT_TYPES: frozenset[str] = AUDIT_ENGAGEMENT_TYPES | NON_AUDIT_ENGAGEMENT_TYPES

#: An engagement that has not finished and has not been abandoned. Baked into
#: the SQL as literals rather than passed as a parameter: these are a
#: server-side allowlist, the same way sort keys are everywhere else in this
#: repo, and a caller has no business widening them.
OPEN_STATUSES: tuple[str, ...] = ("proposed", "active")

#: Delivery outcomes that are, on their own, positive evidence.
#: `awaiting` is not — it is the absence of an answer, and a firm that treats it
#: as one discovers on the day of the enquiry that its proof is a hope.
#: `returned_undelivered` and `refused` are evidence of the opposite.
_DELIVERED_OUTCOMES: frozenset[str] = frozenset({"delivered"})

#: THE WAIT. Communicating is not the whole of Clause (8). ICAI's own FAQ says
#: a member is guilty of professional misconduct if he failed to communicate in
#: writing "and if he did not wait for a reasonable length of time for a reply
#: to be received from him" (https://icai.org/post/5645). A letter posted on the
#: morning of the day the firm signed the engagement is a letter that satisfied
#: the writing and not the waiting, and telling that firm "satisfied" is telling
#: it the one thing that stops it fixing its process.
#:
#: SEVEN IS OURS, NOT ICAI'S. The Code of Ethics deliberately fixes NO period —
#: it says "reasonable time" and leaves it to judgement, so there is no
#: statutory number to look up and none to put in the statute table. Seven days
#: is the SHORT end of what practice treats as reasonable (7-15 is the range
#: commonly cited), and the short end is chosen on purpose: this module would
#: rather stay silent about a firm that waited nine days than accuse it against
#: a threshold ICAI never set. For the same reason the gap it raises is NOT
#: blocking — the duty is real, the number is not.
REASONABLE_REPLY_WAIT_DAYS = 7

#: SQC 1 para 83 as amended 19 August 2009 (was ten years before that).
SQC1_AUDIT_RETENTION_YEARS = 7

#: FIRM POLICY, NOT STATUTE. SQC 1 fixes seven years for AUDIT engagement
#: documentation and leaves other engagements to the firm's own retention
#: policy. Set to the same number so nobody has to hold two in their head, and
#: overridable per engagement via `client_engagements.retention_years` for a
#: firm with a different policy or a client under a contractual hold. If this
#: ever diverges from the audit number, say in the column comment why.
FIRM_POLICY_RETENTION_YEARS = 7

#: THE SEAM. When migration 158's successor seeds a dated row for the SQC 1
#: retention period, `retention_years_for()` should grow an `as_of` argument and
#: read this key through `services.statute.obligation()` instead of returning a
#: constant. Nothing reads it today; it is here so the next author finds the
#: intended shape rather than inventing a second statute table.
_STATUTE_KEY_RETENTION = "icai.sqc1.engagement_documentation.retention_years"


# ══ what a gap is ════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Gap:
    """One thing that is missing, and whether it is allowed to stop work.

    `blocking` is the field that keeps this product usable. It is True only
    where a rule outside this repo actually requires the thing — today that is
    Clause (8) alone. Everything else is reported and does not stop anybody:
    an engagement letter that has not come back signed is worth chasing and is
    not a reason to refuse to file a return, and a firm that is told otherwise
    stops filling the register in.

    NOTHING IN `label` OR `basis` MAY CONTAIN AN ID. These strings are written
    to be rendered.
    """

    code: str
    label: str
    blocking: bool
    #: Where the requirement comes from, in words a partner would recognise.
    #: Empty for firm-hygiene items that have no external source — saying
    #: "ICAI" over something ICAI never said is how a product loses its
    #: credibility on the items where it is right.
    basis: str = ""


# ══ pure rules — no database, no clock ═══════════════════════════════════════

def is_audit(engagement_type: str | None) -> bool:
    """True when the engagement is one Clause (8) reaches.

    An UNKNOWN type answers False, deliberately. The alternative — treating
    anything unrecognised as an audit — would make a typo in a caller start
    blocking work, and the database CHECK already refuses types that are not in
    the allowlist, so an unknown value reaching here means someone is reading
    rows this module did not write.
    """
    return engagement_type in AUDIT_ENGAGEMENT_TYPES


def clause8_applies(
    engagement_type: str | None,
    *,
    had_predecessor: bool | None,
    predecessor_is_ca: bool | None,
) -> bool:
    """Is a written communication to the previous auditor owed?

    Three conditions, all of them from the text of the clause, and every one of
    them a way for the answer to be NO:

      1. the engagement is an audit — "a position as auditor";
      2. there was a predecessor at all — a first-ever appointment has nobody to
         write to;
      3. the predecessor was a chartered accountant (or a Restricted Certificate
         Rules, 1932 certified auditor, which `predecessor_is_ca` covers) — the
         clause names those and nobody else.

    `predecessor_is_ca=None` means "not established yet" and returns True: on an
    audit that followed somebody, the letter is presumed owed until the firm has
    found out who the predecessor was. That is the one place this function
    leans towards demanding, and it leans that way because the remedy is to
    answer a question, not to abandon the engagement — `entry_gaps` reports it
    as `predecessor_status_unknown` rather than as a missing letter.
    """
    if not is_audit(engagement_type):
        return False
    if not had_predecessor:
        return False
    return predecessor_is_ca is not False


def retention_years_for(engagement_type: str | None) -> int:
    """How long the working papers must be kept, in years.

    Seven either way today — see SQC1_AUDIT_RETENTION_YEARS and
    FIRM_POLICY_RETENTION_YEARS for why they are two constants and not one, and
    `_STATUTE_KEY_RETENTION` for where this should read from once the statute
    table carries the fact.
    """
    return (
        SQC1_AUDIT_RETENTION_YEARS
        if is_audit(engagement_type)
        else FIRM_POLICY_RETENTION_YEARS
    )


def retention_until_for(anchor: Any, years: int | None) -> date | None:
    """The first day the papers may be destroyed, or None if the clock is unset.

    THE ANCHOR IS THE DATE OF THE REPORT, never the date the client left. See
    the module docstring; passing an exit date here is the mistake this whole
    register exists to stop.

    29 February collapses to 28 February. `date(2029, 2, 29)` does not exist and
    would raise, and a retention query that throws on one row in a thousand is a
    screen that shows nothing to anybody. Rolling BACK a day rather than forward
    to 1 March is deliberate: this date is the first day destruction is
    permitted, and the conservative direction for a destruction permission is
    later, not earlier — so 28 February is wrong by a day in the direction that
    keeps a paper one day longer than needed rather than shredding it one day
    early.
    """
    stamp = _as_date(anchor)
    if stamp is None or not years or years <= 0:
        return None
    year = stamp.year + int(years)
    try:
        return stamp.replace(year=year)
    except ValueError:
        # Only reachable for 29 February into a non-leap year.
        return stamp.replace(year=year, day=28)


def predecessor_communication_state(
    engagement: dict,
    comms: Sequence[dict] | None = None,
) -> str:
    """One of: not_required, satisfied, accepted_without_wait, late,
    unevidenced, missing, status_unknown.

    Read this as a decision tree with a fixed order of precedence, because more
    than one thing can be wrong at once and the firm needs to be told the one
    that is actionable:

      not_required    Clause (8) does not reach this engagement. Nothing else is
                      evaluated — an engagement with no letter and no need for
                      one is COMPLETE, and reporting anything here would be the
                      over-demanding failure the module docstring is about.
      status_unknown  It is an audit that followed somebody, but nobody has
                      recorded whether the predecessor was a chartered
                      accountant. The letter may or may not be owed.
      satisfied       At least one attempt was dispatched on or before the
                      acceptance date, carries evidence of delivery, AND the
                      firm then left the predecessor a reasonable interval to
                      reply — or a reply had actually arrived by the time it
                      accepted, which is the whole purpose of the interval.
      accepted_without_wait
                      Everything about the letter is right and the firm signed
                      before allowing any interval for an answer. ICAI's FAQ
                      names exactly this as misconduct: failing to communicate
                      in writing "and if he did not wait for a reasonable
                      length of time for a reply to be received from him". It
                      is a separate state from `satisfied` because a register
                      that says "satisfied" here has told the firm the one
                      thing that would stop it changing what it does next time.
      late            An evidenced attempt exists, but every one of them was
                      dispatched after the firm accepted. The communication
                      happened; the clause was still breached, and saying
                      "satisfied" here would bury the only fact worth fixing.
      unevidenced     Attempts exist and none of them can be proved delivered —
                      awaiting acknowledgement, returned, or refused.
      missing         No attempt has been recorded at all.

    `accepted_on` unset is treated as NOT YET ACCEPTED, so any evidenced attempt
    is timely and no wait is owed yet. That is the correct reading: the firm has
    not accepted, so nothing has been accepted early or late.

    A REPLY IS STILL NEVER DEMANDED. `accepted_without_wait` is about the
    interval the firm allowed, not about whether an answer came — a predecessor
    who never writes back cannot hold the incoming auditor hostage, and an
    engagement that waited and heard nothing is `satisfied`.
    """
    if not clause8_applies(
        engagement.get("engagement_type"),
        had_predecessor=engagement.get("had_predecessor"),
        predecessor_is_ca=engagement.get("predecessor_is_ca"),
    ):
        return "not_required"

    if (
        is_audit(engagement.get("engagement_type"))
        and engagement.get("had_predecessor")
        and engagement.get("predecessor_is_ca") is None
    ):
        return "status_unknown"

    attempts = list(comms or ())
    if not attempts:
        return "missing"

    accepted = _as_date(engagement.get("accepted_on"))
    evidenced = [a for a in attempts if _is_evidenced(a)]
    if not evidenced:
        return "unevidenced"

    # dispatched_on is NOT NULL in the table, so a None here is a caller handing
    # us a partial dict rather than a real row. Dropped, never credited.
    dispatches = [d for d in (_as_date(a.get("dispatched_on")) for a in evidenced)
                  if d is not None]
    if not dispatches:
        return "unevidenced"

    if accepted is None:
        # Nothing has been accepted, so nothing was accepted early or late and
        # no waiting period has started to run.
        return "satisfied"

    timely = [d for d in dispatches if d <= accepted]
    if not timely:
        return "late"

    # A reply that arrived before the firm signed IS the reasonable wait,
    # however short the interval: the interval exists to give the predecessor a
    # chance to answer, and this predecessor answered. Replies on ANY attempt
    # count — they are all one conversation.
    replies = [r for r in (_as_date(a.get("reply_received_on")) for a in attempts)
               if r is not None]
    if any(r <= accepted for r in replies):
        return "satisfied"

    # Measured from the EARLIEST timely evidenced dispatch, the reading most
    # generous to the firm: having written in March and signed in May, the fact
    # that it also wrote again in April does not shorten the wait it allowed.
    if (accepted - min(timely)).days >= REASONABLE_REPLY_WAIT_DAYS:
        return "satisfied"
    return "accepted_without_wait"


def entry_gaps(engagement: dict, comms: Sequence[dict] | None = None) -> list[Gap]:
    """What this engagement still owes before it should have been accepted.

    Exactly one gap in this list is ever `blocking`, and it is the Clause (8)
    one. Notice what is NOT here and must never be added: GSTIN, PAN and TAN.
    They are non-mandatory in this product, they block nothing, and this has
    drifted back more than once — a "compliance completeness" screen is exactly
    where it would drift back next.
    """
    gaps: list[Gap] = []

    state = predecessor_communication_state(engagement, comms)
    if state == "missing":
        gaps.append(Gap(
            code="predecessor_communication_missing",
            label="No written communication to the previous auditor has been recorded.",
            blocking=True,
            basis="Clause (8), Part I, First Schedule, Chartered Accountants Act, 1949",
        ))
    elif state == "unevidenced":
        gaps.append(Gap(
            code="predecessor_communication_unevidenced",
            label=(
                "The communication to the previous auditor has no proof of "
                "delivery — no acknowledgement and no tracking reference."
            ),
            blocking=True,
            basis="Clause (8), Part I, First Schedule, Chartered Accountants Act, 1949",
        ))
    elif state == "late":
        gaps.append(Gap(
            code="predecessor_communication_late",
            label=(
                "The previous auditor was written to only after this engagement "
                "was accepted. The clause requires it first."
            ),
            blocking=True,
            basis="Clause (8), Part I, First Schedule, Chartered Accountants Act, 1949",
        ))
    elif state == "accepted_without_wait":
        gaps.append(Gap(
            code="predecessor_reply_time_not_allowed",
            label=(
                "The previous auditor was written to, but the engagement was "
                "accepted before any reasonable time had been allowed for a "
                "reply."
            ),
            # NOT blocking, and the reason is the whole discipline of this
            # module. The DUTY is ICAI's: its FAQ makes failing to wait a
            # reasonable length of time misconduct. The NUMBER OF DAYS is ours,
            # because the Code of Ethics fixes none. Stopping a firm's work
            # against a threshold this repo invented is the overreach the module
            # docstring is written against, so this is reported loudly and bars
            # nothing.
            blocking=False,
            basis=(
                "Clause (8), Part I, First Schedule, Chartered Accountants Act, "
                "1949 — ICAI requires a reasonable time to be allowed for a "
                "reply, and fixes no period"
            ),
        ))
    elif state == "status_unknown":
        gaps.append(Gap(
            code="predecessor_status_unknown",
            label=(
                "It is not recorded whether the previous auditor was a chartered "
                "accountant, so it is not yet known whether a letter is owed."
            ),
            # Not blocking. The remedy is to answer a question about a firm that
            # already exists, not to stop the engagement.
            blocking=False,
            basis="Clause (8), Part I, First Schedule, Chartered Accountants Act, 1949",
        ))

    # SA 210 requires the agreed terms of an AUDIT engagement to be recorded in
    # writing. Reported for every engagement because a signed letter of
    # engagement is worth having on all of them; blocking on none, because a
    # missing signature is a commercial fact and not a bar to doing the work.
    if not engagement.get("engagement_letter_signed_on"):
        gaps.append(Gap(
            code="engagement_letter_unsigned",
            label="No signed engagement letter has been recorded.",
            blocking=False,
            basis=(
                "SA 210 — agreed terms recorded in writing"
                if is_audit(engagement.get("engagement_type"))
                else ""
            ),
        ))

    if not engagement.get("accepted_on"):
        gaps.append(Gap(
            code="acceptance_date_missing",
            label="No acceptance date has been recorded for this engagement.",
            blocking=False,
            # Not an external rule, but it is the date every Clause (8) test is
            # measured against, so an engagement without one cannot be assessed.
            basis="",
        ))

    return gaps


def exit_gaps(engagement: dict) -> list[Gap]:
    """What is still outstanding on a client who is leaving.

    Returns an EMPTY LIST for an engagement that is not leaving. An exit
    checklist that starts nagging the day a client is onboarded is a checklist
    that gets ignored by the time it matters.

    Optional key `final_invoice_balance_due` (Decimal/str/number) is the balance
    on the invoice named by `final_invoice_id`; `final_invoice_doc_status` is
    that invoice's `doc_status`. `outstanding_at_exit` fills both in from the
    join. A caller that has neither still gets the other four checks.
    """
    if not _is_exiting(engagement):
        return []

    gaps: list[Gap] = []

    handover = engagement.get("records_handover_status")
    if handover not in ("completed", "not_applicable"):
        gaps.append(Gap(
            code="records_not_handed_back",
            label="The client's records have not been handed back.",
            blocking=False,
            basis="",
        ))
    elif handover == "completed" and not _text(engagement.get("records_handover_ack_by")):
        # The whole reason the register exists. A handover nobody signed for is
        # a handover the firm cannot prove, and "we sent them everything" is not
        # a defence anyone has ever won with.
        gaps.append(Gap(
            code="handover_unacknowledged",
            label=(
                "The records were handed back but nobody at the client is "
                "recorded as having acknowledged receipt."
            ),
            blocking=False,
            basis="",
        ))

    if not engagement.get("portal_access_revoked_at"):
        gaps.append(Gap(
            code="portal_access_not_revoked",
            label="The departing client's portal access has not been revoked.",
            blocking=False,
            basis="",
        ))

    billing = engagement.get("final_billing_status")
    if billing not in ("settled", "written_off", "not_applicable"):
        if billing == "invoiced":
            balance = _as_decimal(engagement.get("final_invoice_balance_due"))
            doc_status = engagement.get("final_invoice_doc_status")
            if doc_status == "draft":
                gaps.append(Gap(
                    code="final_invoice_still_draft",
                    label="The final invoice has been prepared but never issued.",
                    blocking=False,
                    basis="",
                ))
            elif balance is None or balance > 0:
                gaps.append(Gap(
                    code="final_invoice_unpaid",
                    label="The final invoice has not been paid in full.",
                    blocking=False,
                    basis="",
                ))
        else:
            gaps.append(Gap(
                code="final_bill_not_raised",
                label="No final invoice has been raised for this engagement.",
                blocking=False,
                basis="",
            ))

    # The dangerous one, and the reason it is a gap rather than a default: an
    # exited engagement with no retention clock is a box of working papers with
    # nothing telling anybody when it may — or may not yet — be destroyed. It
    # will not show up in `retention_expiring` either, because there is no date
    # to compare, so if it is not reported here it is reported nowhere.
    if not engagement.get("retention_anchor_date") or not engagement.get("retention_until"):
        gaps.append(Gap(
            code="retention_clock_unset",
            label=(
                "No retention period has been set for this engagement's working "
                "papers."
            ),
            blocking=False,
            basis=(
                "SQC 1 para 83 — seven years from the date of the auditor's report"
                if is_audit(engagement.get("engagement_type"))
                else "Firm retention policy"
            ),
        ))

    return gaps


# ══ queries ══════════════════════════════════════════════════════════════════
#
# EVERY JOINED TABLE CARRIES ITS OWN ORG PREDICATE, not just the driving one.
# `WHERE e.org_id = $1` scopes the ENGAGEMENT rows and nothing else: the join
# `graha_clients c ON c.id = e.client_id` will happily fetch a client belonging
# to a different org, because the foreign key is on `graha_clients(id)` alone
# and no constraint in migration 163 can say otherwise — `graha_clients` has no
# UNIQUE (id, org_id) for a composite key to point at, and adding one would mean
# ALTERing a table this migration is not allowed to touch. So the predicate
# lives in the query, on every join, and `TestEveryJoinIsOrgScoped` refuses a
# new one without it.
#
# This is not theoretical. Probed read-only against the live database on
# 2026-08-19, with the engagement rows supplied as a CTE and the client rows
# real: an engagement stamped org A whose `client_id` pointed at org B's client
# came back inside org A's result set carrying ORG B'S CLIENT NAME. One extra
# `AND c.org_id = e.org_id` returned nothing but org A's own row. The same
# applies to the invoice join, where the leaked field is a balance.
#
# Schema-qualified, always. `search_path` on this database is
# `"$user", public, extensions` (measured 2026-08-19), so an unqualified
# `client_engagements` resolves to nothing at all — and a shadow table in
# `public` has bitten this repo before (migration 142).
#
# Every parameter carries an explicit cast. PgBouncer turns an untyped-parameter
# parse error into an instant 500 that looks like a product bug and reads as a
# sub-second failure in the logs; `services/credits.py` cost a real incident to
# that exactly once.

# `e.org_id` is deliberately NOT selected. The caller passed it in, so the row
# cannot tell it anything it does not know, and every uuid on a row is one more
# thing a careless screen can render — the ratchet
# frontend/scripts/check-rendered-ids.mjs exists because that keeps happening.
# `engagement_id` and `client_id` stay: they are what a link is built from.
_ENGAGEMENT_COLS = """
    e.id                AS engagement_id,
    e.client_id         AS client_id,
    c.name              AS client_name,
    e.engagement_type   AS engagement_type,
    e.financial_year    AS financial_year,
    e.period_from       AS period_from,
    e.period_to         AS period_to,
    e.status            AS status,
    e.accepted_on       AS accepted_on,
    e.started_on        AS started_on,
    e.engagement_letter_signed_on AS engagement_letter_signed_on,
    e.had_predecessor   AS had_predecessor,
    e.predecessor_is_ca AS predecessor_is_ca,
    e.predecessor_name  AS predecessor_name,
    e.predecessor_not_required_reason AS predecessor_not_required_reason
"""

_EXIT_COLS = """
    e.exit_initiated_on         AS exit_initiated_on,
    e.exit_reason               AS exit_reason,
    e.records_handover_status   AS records_handover_status,
    e.records_handover_on       AS records_handover_on,
    e.records_handover_ack_by   AS records_handover_ack_by,
    e.handover_manifest_key     AS handover_manifest_key,
    e.portal_access_revoked_at  AS portal_access_revoked_at,
    e.portal_access_revoked_by  AS portal_access_revoked_by,
    e.final_invoice_id          AS final_invoice_id,
    e.final_billing_status      AS final_billing_status,
    e.retention_anchor_date     AS retention_anchor_date,
    e.retention_years           AS retention_years,
    e.retention_until           AS retention_until,
    e.closed_on                 AS closed_on
"""

# OPEN_STATUSES as literals, not a parameter: they are a server-side allowlist,
# and the partial index `client_engagements_open_idx` is declared on exactly
# this predicate — a parameterised `= ANY($2::text[])` cannot use it.
_SELECT_OPEN_ENGAGEMENTS = f"""
    SELECT {_ENGAGEMENT_COLS}
      FROM staging.client_engagements e
      JOIN staging.graha_clients c
        ON c.id = e.client_id AND c.org_id = e.org_id
     WHERE e.org_id = $1::uuid
       AND e.status IN ('proposed', 'active')
     ORDER BY e.accepted_on NULLS FIRST, c.name
"""

# Joined back to the parent rather than filtered by an id array, so this is one
# round trip whatever the size of the register and cannot drift out of step with
# the query above. `p.org_id` is the filter, not `e.org_id`, so this can use the
# child's own index. The `e.org_id = p.org_id` on the join IS redundant here —
# the composite foreign key `cepc_engagement_fk` already makes them equal — and
# it is written anyway so the org-scoping ratchet can be blanket. A rule with
# one documented exemption is a rule the next author deletes.
_SELECT_OPEN_COMMS = """
    SELECT p.engagement_id     AS engagement_id,
           p.mode              AS mode,
           p.dispatched_on     AS dispatched_on,
           p.proof_ref         AS proof_ref,
           p.proof_file_key    AS proof_file_key,
           p.delivery_outcome  AS delivery_outcome,
           p.delivered_on      AS delivered_on,
           p.reply_received_on AS reply_received_on
      FROM staging.client_engagement_predecessor_comms p
      JOIN staging.client_engagements e
        ON e.id = p.engagement_id AND e.org_id = p.org_id
     WHERE p.org_id = $1::uuid
       AND e.status IN ('proposed', 'active')
     ORDER BY p.engagement_id, p.dispatched_on
"""

# LEFT JOIN on the invoice, not INNER: `final_invoice_id` is ON DELETE SET NULL
# and an engagement that has not been billed yet has none. An inner join here
# would hide every unbilled exit — the exits most worth seeing.
_SELECT_EXITING = f"""
    SELECT {_ENGAGEMENT_COLS},
           {_EXIT_COLS},
           i.balance_due AS final_invoice_balance_due,
           i.doc_status  AS final_invoice_doc_status,
           i.payment_status AS final_invoice_payment_status
      FROM staging.client_engagements e
      JOIN staging.graha_clients c
        ON c.id = e.client_id AND c.org_id = e.org_id
      LEFT JOIN staging.ganit_invoices i
        ON i.id = e.final_invoice_id AND i.org_id = e.org_id
     WHERE e.org_id = $1::uuid
       AND e.exit_initiated_on IS NOT NULL
       AND e.closed_on IS NULL
     ORDER BY e.exit_initiated_on, c.name
"""

# `$2::date + $3::int` — BOTH cast. An untyped `$2 + $3` is the exact expression
# that killed every credit spend: PgBouncer reports the parse failure as an
# instant 500 with no useful message. See services/credits.py and
# migrations/README on the incident.
_SELECT_RETENTION_DUE = f"""
    SELECT {_ENGAGEMENT_COLS},
           {_EXIT_COLS}
      FROM staging.client_engagements e
      JOIN staging.graha_clients c
        ON c.id = e.client_id AND c.org_id = e.org_id
     WHERE e.org_id = $1::uuid
       AND e.retention_until IS NOT NULL
       AND e.retention_until <= ($2::date + $3::int)
     ORDER BY e.retention_until, c.name
"""

# The engagements that will never appear in the query above, because they have
# no date to compare. Separate query and separate list: folding them in with a
# NULL `retention_until` would put "may be destroyed next month" and "nobody
# knows what this is" in one table under one heading.
_SELECT_RETENTION_UNSET = f"""
    SELECT {_ENGAGEMENT_COLS},
           {_EXIT_COLS}
      FROM staging.client_engagements e
      JOIN staging.graha_clients c
        ON c.id = e.client_id AND c.org_id = e.org_id
     WHERE e.org_id = $1::uuid
       AND e.retention_until IS NULL
       AND e.status IN ('completed', 'exiting', 'closed')
     ORDER BY c.name
"""


async def incomplete_at_entry(pool, org_id: Any) -> list[dict]:
    """Open engagements with something still owed at entry, worst first.

    Each row is the engagement, plus:
        `gaps`                  list[Gap], never empty (rows with none are dropped)
        `blocking`              bool — at least one gap the law actually requires
        `predecessor_state`     the string from predecessor_communication_state()
        `predecessor_comms`     every recorded attempt, oldest first

    Ordered blocking-first, then by acceptance date, so the screen opens on the
    engagements where a clause has already been breached rather than on the
    engagement letters that have not come back.
    """
    engagements = _rows(await pool.fetch(_SELECT_OPEN_ENGAGEMENTS, org_id))
    comms = _rows(await pool.fetch(_SELECT_OPEN_COMMS, org_id))

    by_engagement: dict[Any, list[dict]] = {}
    for row in comms:
        by_engagement.setdefault(row.get("engagement_id"), []).append(row)

    out: list[dict] = []
    for row in engagements:
        attempts = by_engagement.get(row.get("engagement_id"), [])
        gaps = entry_gaps(row, attempts)
        if not gaps:
            continue
        out.append({
            **row,
            "predecessor_state": predecessor_communication_state(row, attempts),
            "predecessor_comms": attempts,
            "gaps": gaps,
            "blocking": any(g.blocking for g in gaps),
        })

    out.sort(key=lambda r: (not r["blocking"], _sort_date(r.get("accepted_on"))))
    return out


async def outstanding_at_exit(pool, org_id: Any) -> list[dict]:
    """Clients on their way out with something still open.

    "On their way out" is `exit_initiated_on IS NOT NULL AND closed_on IS NULL`
    and nothing else — deliberately not keyed on `status = 'exiting'`, because a
    status column is a thing somebody forgets to move and a date is a thing
    somebody typed.

    Rows with nothing outstanding are dropped: an exit that is complete belongs
    in the register, not on a worklist.
    """
    rows = _rows(await pool.fetch(_SELECT_EXITING, org_id))

    out: list[dict] = []
    for row in rows:
        gaps = exit_gaps(row)
        if not gaps:
            continue
        out.append({**row, "gaps": gaps})

    out.sort(key=lambda r: (_sort_date(r.get("exit_initiated_on")), r.get("client_name") or ""))
    return out


async def retention_expiring(
    pool,
    org_id: Any,
    *,
    as_of: Any,
    within_days: int = 90,
) -> dict[str, list[dict]]:
    """Working papers coming out of, or already out of, the retention window.

    Returns two lists under `expiring` and `unset`, and they answer different
    questions on purpose — see `_SELECT_RETENTION_UNSET`.

    `as_of` has NO DEFAULT, for the same reason `services/statute.obligation()`
    refuses one: a retention report is run to decide what may be destroyed, and
    the date it is measured against belongs to the caller — a review "as at 31
    March" run in June must not silently answer for June. Passing
    `date.today()` is fine; passing it from here is not.

    Each `expiring` row carries `days_remaining`, NEGATIVE for papers already
    past their window. Already-past rows are included and sort first: they are
    the ones a firm most needs to see, and a report that only showed the future
    would let a shredding backlog accumulate invisibly — the same failure
    services/pahchan_retention.py was rewritten to stop.

    An engagement that is still `active` cannot appear here even if somebody has
    filled in a retention date, because destroying the papers of a live
    engagement is the one outcome this must never suggest.
    """
    stamp = _as_date(as_of)
    if stamp is None:
        raise ValueError("retention_expiring() needs a real as_of date")
    horizon = max(int(within_days), 0)

    due = _rows(await pool.fetch(_SELECT_RETENTION_DUE, org_id, stamp, horizon))
    unset = _rows(await pool.fetch(_SELECT_RETENTION_UNSET, org_id))

    expiring: list[dict] = []
    for row in due:
        # The SQL narrows; the status rule is applied here, in ONE place, next to
        # the sentence that explains it. Anything not finished with is not a
        # candidate for destruction, whatever date somebody typed.
        if row.get("status") not in ("completed", "exiting", "closed"):
            continue
        until = _as_date(row.get("retention_until"))
        if until is None:
            continue
        expiring.append({**row, "days_remaining": (until - stamp).days})

    expiring.sort(key=lambda r: (r["days_remaining"], r.get("client_name") or ""))
    return {"expiring": expiring, "unset": unset}


# ══ coercion ═════════════════════════════════════════════════════════════════

def _rows(records: Iterable[Any] | None) -> list[dict]:
    """asyncpg Records (or plain dicts, from the test pool) into dicts."""
    return [dict(r) for r in (records or ())]


def _as_date(value: Any) -> date | None:
    """A date, or None. Never raises — a bad value is a missing value here.

    `datetime` is checked BEFORE `date` because datetime is a subclass of date
    and `isinstance(a_datetime, date)` is True; without the order, a timestamptz
    column would come back as a datetime pretending to be a date and every
    comparison against a real date would raise TypeError at some later line.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _as_decimal(value: Any) -> Decimal | None:
    """A money amount, or None. numeric arrives from asyncpg as Decimal."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _text(value: Any) -> str:
    """Trimmed string. An acknowledgement of '   ' is not an acknowledgement."""
    return (value or "").strip() if isinstance(value, str) else ""


def _sort_date(value: Any) -> date:
    """Sort key that puts unknown dates first rather than raising on None."""
    return _as_date(value) or date.min


def _is_evidenced(attempt: dict) -> bool:
    """Can this attempt be put in front of a disciplinary board?

    Delivered, or carrying a reference somebody can look up. `proof_file_key` is
    a scanned acknowledgement in R2 and counts on its own. An attempt that came
    back `returned_undelivered` or `refused` is evidence AGAINST delivery and
    can never be evidenced, whatever reference it carries — the tracking number
    is precisely what proves it came back.
    """
    if attempt.get("delivery_outcome") in ("returned_undelivered", "refused"):
        return False
    if attempt.get("delivery_outcome") in _DELIVERED_OUTCOMES:
        return True
    return bool(_text(attempt.get("proof_ref")) or _text(attempt.get("proof_file_key")))


def _is_exiting(engagement: dict) -> bool:
    """Started leaving, not yet closed. A date, not a status — see
    `outstanding_at_exit`."""
    return bool(engagement.get("exit_initiated_on")) and not engagement.get("closed_on")
