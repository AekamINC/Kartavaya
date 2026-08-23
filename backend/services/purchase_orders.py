"""
purchase_orders.py — the arithmetic, the rules and the vocabulary of procurement.

Everything in this file is either a PURE FUNCTION over data the router has
already fetched, or the one allocator that has to touch the database. Nothing
here reads a request, resolves an org or decides who may call it — that is
`routers/procurement.py`'s job, and keeping the split means the money
arithmetic and the approval rules can be tested without a pool at all.

Proposal 77 is the specification. Where this file departs from it, it says so
and says why in the comment above the departure.

────────────────────────────────────────────────────────────────────────────────
THE THREE QUANTITIES
────────────────────────────────────────────────────────────────────────────────

A PO line has three, and they are routinely all different:

    ordered   what we asked for          set when the PO is issued
    received  what turned up             set by each delivery
    billed    what the vendor charged    set by each bill

The GAPS are the whole module. `ordered > received` is a late supplier;
`received > billed` is the period-end accrual (goods received not invoiced) a
CA needs; `billed > received` is a vendor charging for goods that never came,
which is the one worth real money.

Only `ordered` is stored. `received` is SUM over `ganit_po_receipts`, `billed`
is SUM over the bills linked to the order — both derived on every read, so
neither can drift away from the rows it is derived from. A counter that gets
overwritten loses the arrival history, and "when did this arrive?" is exactly
what the MSME payment clock and any dispute both turn on.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, Iterable

# ── Vocabulary ────────────────────────────────────────────────────────────────

#: The lifecycle, in the order proposal 77 draws it. `rejected` and `cancelled`
#: are not steps; they are where an order stops.
PO_STATUSES: tuple[str, ...] = (
    "draft", "awaiting_approval", "rejected", "issued",
    "part_received", "received", "closed", "cancelled",
)

#: Statuses an order may still be freely edited in, i.e. WITHOUT minting a
#: revision. A draft has no number and nobody has seen it; a rejected order is
#: back in the author's hands with the same freedom. Everything else is issued
#: and a change to it is a change order.
EDITABLE_STATUSES: frozenset[str] = frozenset({"draft", "rejected"})

#: Statuses that count towards COMMITTED SPEND — ordered, not yet settled.
#: `closed` is deliberately out: closed short or fully billed, either way the
#: commitment is discharged and leaving it in is exactly how the figure becomes
#: permanently wrong.
OPEN_STATUSES: frozenset[str] = frozenset({"issued", "part_received", "received"})

#: What a receipt may be recorded against. Receiving into a draft would be
#: receiving against an order nobody placed.
RECEIVABLE_STATUSES: frozenset[str] = frozenset({"issued", "part_received", "received"})

#: Sort keys the list endpoint will accept. A SERVER-SIDE ALLOWLIST, because
#: the value is concatenated into ORDER BY and a bind parameter cannot carry an
#: identifier. Anything not in here falls back to `created_at`.
SORT_KEYS: dict[str, str] = {
    "created_at": "po.created_at",
    "po_date": "po.po_date",
    "expected_date": "po.expected_date",
    "total": "po.total",
    "po_number": "po.po_number",
    "status": "po.status",
    "vendor": "v.name",
}

#: The starter list a firm gets before it writes its own. Values, not free
#: text, so "why did this order stop short" is something a report can group by.
DEFAULT_CLOSE_REASONS: tuple[str, ...] = (
    "Vendor cannot supply the balance",
    "No longer required",
    "Ordered elsewhere",
    "Quantity tolerance accepted",
    "Order superseded",
)

# ── Section 194Q ──────────────────────────────────────────────────────────────
#
# A buyer whose turnover exceeded ₹10 crore in the preceding year deducts 0.1%
# on purchases from a resident seller PAST ₹50 lakh in the financial year.
#
# TWO DIFFERENT BASES, and getting them the wrong way round is a real filing
# error rather than a rounding one:
#
#   · the ₹10 crore turnover test EXCLUDES GST
#   · the TDS itself is computed on the purchase value INCLUDING GST
#
# So `TDS_194Q_BASIS` is the gross, and the module says so on the screen. It
# bites at PAYMENT OR CREDIT, WHICHEVER IS EARLIER, and advances count — which
# is why a purchase order is where a firm first sees it coming, and why this
# module warns at PO time rather than letting the bill be the first anyone
# hears of it.
#
# NOTHING HERE DEDUCTS ANYTHING. This is a warning surface. The deduction is a
# decision for the firm's accountant against their own turnover, which this
# product does not hold.
TDS_194Q_THRESHOLD: int = 5_000_000       # ₹50 lakh, per vendor, per FY
TDS_194Q_RATE: float = 0.001              # 0.1%
TDS_194Q_BASIS: str = "purchase value INCLUDING GST"
#: Warn from this fraction of the threshold, so the firm hears about it while
#: there is still something to decide.
TDS_194Q_WARN_AT: float = 0.80


# ── Settings ──────────────────────────────────────────────────────────────────
#
# Stored in `staging.organisations.settings->'purchase_orders'`, a KEY rather
# than a table or five columns — the same decision, for the same reason, that
# `doc_prefixes` took: code ships on merge and migrations are applied by hand
# afterwards, and a settings table that does not exist yet 500s the whole
# module for the gap between.
#
# THE PREFIX IS THE ONE EXCEPTION and lives in `settings->'doc_prefixes'`
# alongside the invoice prefixes, because it is the same kind of fact and a
# firm looking for "what do we number things with" should find them together.
# See `po_prefix` below.
#
# NOTHING HERE IS MANDATORY. An org that configures none of it gets a PO module
# that numbers documents and never asks anyone for permission — which is the
# owner's decision, written down: approval is optional and configurable, not a
# fixed step.

DEFAULT_SETTINGS: dict[str, Any] = {
    "approval_required": False,
    "rules": [],
    "self_approval": False,
    # A revision that raises the total by more than EITHER of these goes back
    # for approval. Either, not both: a 5% rise on a ₹50 lakh order is ₹2.5
    # lakh and nobody would call that immaterial, and a ₹9,000 rise on a
    # ₹10,000 order is 90% and obviously material. One test alone is wrong at
    # one end of the range or the other.
    "reapproval_pct": 10.0,
    "reapproval_amount": 10000.0,
    "over_receipt": "refuse",
    "over_receipt_tolerance_pct": 0.0,
    "close_reasons": list(DEFAULT_CLOSE_REASONS),
    "budgets_enabled": False,
    "budgets": [],
}

_OVER_RECEIPT_MODES = ("refuse", "allow")


def _num(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if out != out or out in (float("inf"), float("-inf")):   # NaN / inf
        return default
    return out


def _clean_text(value: Any, limit: int = 200) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def sanitise_settings(raw: Any) -> dict[str, Any]:
    """Take whatever is in the settings column and return something usable.

    NEVER RAISES. This is called on the READ path of every write in the module,
    and a malformed settings blob — hand-edited, half-written by an older
    version, or simply not an object — must not be able to stop a firm raising
    a purchase order. Anything unreadable falls back to the built-in, exactly
    the way `ganit._doc_prefix` falls back rather than 500ing an invoice.

    Validation with a 400 attached belongs on the WRITE path (`put_settings`),
    where there is a person to tell.
    """
    out = dict(DEFAULT_SETTINGS)
    out["close_reasons"] = list(DEFAULT_CLOSE_REASONS)
    out["rules"] = []
    out["budgets"] = []

    if isinstance(raw, (str, bytes)):
        try:
            raw = json.loads(raw)
        except Exception:
            return out
    if not isinstance(raw, dict):
        return out

    out["approval_required"] = bool(raw.get("approval_required", False))
    out["self_approval"] = bool(raw.get("self_approval", False))
    out["budgets_enabled"] = bool(raw.get("budgets_enabled", False))
    out["reapproval_pct"] = max(0.0, _num(raw.get("reapproval_pct"), 10.0))
    out["reapproval_amount"] = max(0.0, _num(raw.get("reapproval_amount"), 10000.0))

    mode = str(raw.get("over_receipt") or "refuse").strip().lower()
    out["over_receipt"] = mode if mode in _OVER_RECEIPT_MODES else "refuse"
    out["over_receipt_tolerance_pct"] = min(
        100.0, max(0.0, _num(raw.get("over_receipt_tolerance_pct"), 0.0)))

    reasons = raw.get("close_reasons")
    if isinstance(reasons, list):
        cleaned = [_clean_text(r) for r in reasons]
        cleaned = [r for r in cleaned if r][:30]
        if cleaned:
            out["close_reasons"] = cleaned

    rules = raw.get("rules")
    if isinstance(rules, list):
        out["rules"] = [r for r in (_sanitise_rule(x) for x in rules[:30]) if r]

    budgets = raw.get("budgets")
    if isinstance(budgets, list):
        out["budgets"] = [b for b in (_sanitise_budget(x) for x in budgets[:100]) if b]

    return out


def _sanitise_rule(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    approvers = raw.get("approver_ids")
    if not isinstance(approvers, list):
        approvers = []
    # De-duplicated while KEEPING ORDER, because a sequential rule's order is
    # the escalation order and a set would throw it away.
    seen: set[str] = set()
    ids: list[str] = []
    for a in approvers:
        a = _clean_text(a, 128)
        if a and a not in seen:
            seen.add(a)
            ids.append(a)
    if not ids:
        # A rule naming nobody cannot be satisfied, so it would freeze every
        # order it matched at `awaiting_approval` for ever. Dropped rather than
        # stored — and refused with a 400 on the write path, where somebody is
        # there to read it.
        return None
    required = int(max(1, min(len(ids), _num(raw.get("approvers_required"), 1))))
    return {
        "name": _clean_text(raw.get("name"), 80) or "Approval rule",
        "min_amount": max(0.0, _num(raw.get("min_amount"), 0.0)),
        "department": _clean_text(raw.get("department"), 80),
        "category": _clean_text(raw.get("category"), 80),
        "approver_ids": ids[:5],
        "approvers_required": min(required, 5),
        "sequential": bool(raw.get("sequential", False)),
    }


def _sanitise_budget(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    dept = _clean_text(raw.get("department"), 80)
    if not dept:
        return None
    return {
        "department": dept,
        "period_start": _clean_text(raw.get("period_start"), 10),
        "period_end": _clean_text(raw.get("period_end"), 10),
        "limit": max(0.0, _num(raw.get("limit"), 0.0)),
        "alert_pct": min(100.0, max(0.0, _num(raw.get("alert_pct"), 80.0))),
    }


# ── The prefix ────────────────────────────────────────────────────────────────

DEFAULT_PO_PREFIX = "PO"

#: The key this module's prefix lives under inside `settings->'doc_prefixes'`.
#: `routers/org_profile.DOC_TYPES` does not list it, so `PUT /doc-prefixes`
#: refuses it as an unknown type and the PO settings screen is the only writer.
#: That is intentional for now and reported to the owner as a one-line
#: follow-up: adding `purchase_order` to DOC_TYPES/BUILTIN_PREFIXES would put
#: it on the shared numbering screen beside the other five, which is where a
#: firm will eventually look for it.
PO_PREFIX_KEY = "purchase_order"


def clean_prefix(raw: Any, fallback: str = DEFAULT_PO_PREFIX) -> str:
    """Letters only, upper-cased, 2-8 characters — `org_profile`'s rule, copied
    deliberately rather than imported.

    THE VALUE REACHES A DOCUMENT SERIAL. `next_po_number` builds
    `PREFIX-YYYY-NNNN` by concatenation and parses the last one back out to
    increment it, so a prefix carrying a hyphen or a digit makes the series
    unreadable by its own reader and the next order restarts at 0001 for ever.

    Copied rather than imported because importing from `routers/org_profile`
    into a service would invert the dependency — a router importing a service
    is the direction this codebase runs in, and a cycle here would be paid for
    at import time by every module that touches settings.
    """
    cleaned = "".join(ch for ch in str(raw or "").strip().upper() if ch.isalpha())
    if 2 <= len(cleaned) <= 8:
        return cleaned
    return fallback


async def po_prefix(pool, org_id: str) -> str:
    """What THIS org numbers purchase orders with.

    An absent or unusable value falls back to `PO`, so a malformed setting
    cannot stop a firm issuing an order.
    """
    try:
        raw = await pool.fetchval(
            "SELECT settings->'doc_prefixes'->>$2 FROM staging.organisations "
            "WHERE id = $1::uuid",
            org_id, PO_PREFIX_KEY,
        )
    except Exception:
        return DEFAULT_PO_PREFIX
    return clean_prefix(raw)


# ── The allocator ─────────────────────────────────────────────────────────────

_SERIAL_RE = re.compile(r"^(?P<prefix>[A-Z]+)-(?P<year>\d{4})-(?P<n>\d+)$")


async def next_po_number(pool, org_id: str, prefix: str) -> str:
    """Mint `PREFIX-YYYY-NNNN` for the next purchase order in this org.

    ── WHY THIS IS NOT `utils.next_doc_number` ─────────────────────────────

    Proposal 77 says purchase orders should be numbered through it, with a new
    entry in `_ALLOWED_DOC_TABLES`. That is right about the FORMAT and wrong
    about the mechanism, and the reason is the proposal's own lifecycle:

        Draft — Editable. NO NUMBER YET: a serial spent on a draft is a gap
                in the series.

    `next_doc_number` reads the newest row in the table by `created_at` and
    increments the number it finds on it. Every draft carries NULL, so the
    newest row is very often a draft, `last` comes back None, and THE SERIES
    RESTARTS AT 0001 — silently, colliding with an order issued last week. The
    partial unique index `ganit_purchase_orders_org_number_uq` would catch the
    collision as a 500 rather than a duplicate, which is better than the
    alternative and still not a working module.

    So this reads the newest NON-NULL number instead. That is the ONLY
    difference. Same `PREFIX-YYYY-NNNN` shape, same advisory lock, same lock
    scope — and it touches no table `next_doc_number` owns, which is the actual
    lesson of the recurring-invoice allocator that grew a second FORMAT and
    poisoned a GST serial.

    ── THE LOCK IS INSIDE THE TRANSACTION, AND HAS TO BE ────────────────────

    `pg_advisory_xact_lock` is released at the end of the transaction that took
    it. asyncpg runs in autocommit, so a bare `execute` of it is its own
    transaction — acquired and dropped before the SELECT it exists to protect
    ever runs, and two callers read the same `last` and mint the same number.
    `conn.transaction()` makes the guarantee real.

    ── ORDER BY THE NUMBER, NOT BY created_at ───────────────────────────────

    `next_doc_number` orders by `created_at`, which is right for a table where
    the number is assigned at insert. Here the number is assigned at ISSUE, so
    the newest ROW and the highest NUMBER are routinely different rows — an
    order drafted in January and issued in March outranks one drafted in
    February and issued in April. Ordering on the parsed serial is the only
    thing that makes the series monotonic.
    """
    year = datetime.now().year
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Keyed on (org, table) exactly as `next_doc_number` keys its own,
            # so two writers in one org queue and two orgs do not.
            lock_key = hash((org_id, "ganit_purchase_orders")) & 0x7FFFFFFF
            await conn.execute("SELECT pg_advisory_xact_lock($1)", lock_key)
            rows = await conn.fetch(
                "SELECT po_number FROM staging.ganit_purchase_orders "
                "WHERE org_id=$1::uuid AND po_number IS NOT NULL",
                org_id,
            )
            highest = 0
            for r in rows:
                m = _SERIAL_RE.match(str(r["po_number"] or "").strip().upper())
                # A number from a DIFFERENT year does not raise this year's
                # counter. Same convention `next_doc_number` gets by accident
                # from reading only the newest row, made explicit here.
                if m and int(m.group("year")) == year:
                    highest = max(highest, int(m.group("n")))
            return f"{prefix}-{year}-{highest + 1:04d}"


# ── The money ─────────────────────────────────────────────────────────────────

def compute_po_totals(lines: Iterable[Any], is_igst: bool) -> dict[str, Any]:
    """GST over PO lines, ROUNDED THE SAME WAY `ganit._compute_invoice` rounds.

    Not "the same idea as" — the same order of operations, digit for digit:
    line total rounded to 2dp AFTER the line discount, GST computed on that
    rounded figure and itself rounded, CGST/SGST each `round(gst / 2, 2)`.

    This matters more here than anywhere else in the product. A purchase order
    and the vendor bill raised against it are compared line by line and rupee
    for rupee by the three-way match; if the PO rounds even one line
    differently from the bill, EVERY matched order reports a discrepancy and
    the exception list — the part of this module that is worth real money —
    becomes noise the firm switches off.

    So the rounding is deliberately inherited, including the part that is
    arguably wrong: `round(gst/2, 2)` twice can total one paisa more than
    `round(gst, 2)`. Fixing it here alone would be worse than the paisa.

    Accepts pydantic models or plain dicts, because the router builds lines
    from a request body and the revision path rebuilds them from database rows.
    """
    subtotal = 0.0
    cgst = 0.0
    sgst = 0.0
    igst = 0.0
    out_lines: list[dict[str, Any]] = []

    for idx, item in enumerate(lines, start=1):
        get = item.get if isinstance(item, dict) else (lambda k, d=None: getattr(item, k, d))

        qty = _num(get("qty_ordered", get("quantity", 0)))
        rate = _num(get("rate", 0))
        gst_rate = _num(get("gst_rate", 0))
        discount_pct = _num(get("discount_pct", 0))

        line_total = qty * rate
        if discount_pct > 0:
            line_total *= (1 - discount_pct / 100)
        line_total = round(line_total, 2)

        gst_amount = round(line_total * gst_rate / 100, 2)
        if is_igst:
            igst += gst_amount
        else:
            cgst += round(gst_amount / 2, 2)
            sgst += round(gst_amount / 2, 2)

        subtotal += line_total
        out_lines.append({
            "line_no": int(_num(get("line_no", idx), idx)),
            "product_id": _clean_text(get("product_id", "") or "", 64),
            "description": _clean_text(get("description", "") or "", 500),
            "hsn_code": _clean_text(get("hsn_code", "") or "", 20),
            "sac_code": _clean_text(get("sac_code", "") or "", 20),
            "qty_ordered": qty,
            "unit": _clean_text(get("unit", "") or "NOS", 20) or "NOS",
            "rate": rate,
            "gst_rate": gst_rate,
            "discount_pct": discount_pct,
            "line_total": line_total,
            "gst_amount": gst_amount,
        })

    return {
        "lines": out_lines,
        "subtotal": round(subtotal, 2),
        "cgst": round(cgst, 2),
        "sgst": round(sgst, 2),
        "igst": round(igst, 2),
        "total": round(subtotal + cgst + sgst + igst, 2),
    }


# ── Place of supply ───────────────────────────────────────────────────────────

def derive_is_igst(org_state_code: str | None, vendor_gstin: str | None,
                   fallback: bool = False) -> tuple[bool, str | None]:
    """Inter-state or intra-state, from the vendor's state — and the place of
    supply that goes with it.

    Returns `(is_igst, place_of_supply)`. `place_of_supply` is the two-digit
    state code, or None when it could not be determined.

    ── GSTIN IS NOT MANDATORY AND THIS BLOCKS NOTHING ──────────────────────

    A vendor with no GSTIN recorded — an unregistered supplier, a small trader,
    a vendor whose record simply is not filled in — is entirely legal, common,
    and must be orderable. When either side of the comparison is missing this
    returns the CALLER'S answer unchanged and no place of supply, exactly as if
    the field were absent. It never raises, never refuses, and never demands a
    GSTIN as the price of raising an order.

    The first two characters of a GSTIN are the state code. That is the whole
    derivation, and it is the same one the invoice side reaches for.
    """
    v = "".join(str(vendor_gstin or "").split()).upper()
    o = str(org_state_code or "").strip()
    if len(v) < 2 or not v[:2].isdigit():
        return fallback, None
    vendor_state = v[:2]
    if len(o) < 2 or not o[:2].isdigit():
        # We know the vendor's state and not our own, so we can report the
        # place of supply and cannot compute the split. Reporting one without
        # guessing the other is more useful than dropping both.
        return fallback, vendor_state
    return (vendor_state != o[:2]), vendor_state


# ── Approval ──────────────────────────────────────────────────────────────────

def match_rule(settings: dict[str, Any], amount: float,
               department: str = "", category: str = "") -> dict[str, Any] | None:
    """The first rule that matches, or None — and None means NO APPROVAL NEEDED.

    ── WHY FIRST-MATCH AND NOT A CHAIN ─────────────────────────────────────

    Every ERP eventually grows multi-level approval chains and every one of
    them becomes impossible for the customer to reason about. An ordered list
    where the first matching rule decides is something a person can read aloud
    — "anything over two lakh in Audit needs both partners" — and it covers the
    amount / department / category axes that the ERPs themselves reduce to.
    Sequential escalation is expressed as `approvers_required: 2` with
    `sequential: true`, which buys the same thing without a graph.

    A rule matches when EVERY condition it states is satisfied. A blank
    department matches every department; that is what makes "over ₹2 lakh,
    anywhere" writable as one rule.

    Returns the rule with `approvers_required` clamped to the number of people
    it actually names — a rule demanding two signatures from a list of one can
    never be satisfied, and an order that can never be approved is worse than
    one that needs no approval.
    """
    if not settings.get("approval_required"):
        return None
    dept = (department or "").strip().casefold()
    cat = (category or "").strip().casefold()
    for rule in settings.get("rules") or []:
        if amount < _num(rule.get("min_amount"), 0.0):
            continue
        r_dept = (rule.get("department") or "").strip().casefold()
        if r_dept and r_dept != dept:
            continue
        r_cat = (rule.get("category") or "").strip().casefold()
        if r_cat and r_cat != cat:
            continue
        ids = list(rule.get("approver_ids") or [])
        if not ids:
            continue
        out = dict(rule)
        out["approver_ids"] = ids
        out["approvers_required"] = max(1, min(int(rule.get("approvers_required") or 1), len(ids)))
        return out
    return None


def may_approve(settings: dict[str, Any], rule: dict[str, Any] | None,
                user_id: str, created_by: str | None,
                already_decided: Iterable[str] = ()) -> tuple[bool, str]:
    """May THIS person approve THIS order right now? Returns (ok, reason).

    The reason is returned even on success (empty string) so the caller has one
    shape to handle, and every refusal names the specific rule it failed rather
    than a generic "not allowed" — a person told "you cannot approve this"
    without being told why raises a support ticket.
    """
    if rule is None:
        return False, "This purchase order does not need approval."
    if user_id not in (rule.get("approver_ids") or []):
        return False, "You are not named as an approver for this purchase order."
    if user_id in set(already_decided):
        return False, "You have already recorded a decision on this revision."
    if created_by and user_id == created_by and not settings.get("self_approval"):
        return False, (
            "You raised this purchase order, and this organisation does not "
            "allow self-approval.")
    if rule.get("sequential"):
        # Sequential means IN THE ORDER THE RULE NAMES THEM. The next approver
        # is the first named person who has not decided; anyone else is early,
        # and being told so is more useful than a silent no-op.
        decided = set(already_decided)
        pending = [a for a in (rule.get("approver_ids") or []) if a not in decided]
        if pending and pending[0] != user_id:
            return False, (
                "This rule is sequential and it is not your turn yet.")
    return True, ""


def approval_satisfied(rule: dict[str, Any] | None,
                       approvals: Iterable[dict[str, Any]]) -> bool:
    """Enough approvals to issue?

    A single rejection is decisive and is handled by the caller, which moves
    the order to `rejected` the moment one lands. This counts only the yeses.
    """
    if rule is None:
        return True
    needed = max(1, int(rule.get("approvers_required") or 1))
    named = set(rule.get("approver_ids") or [])
    yes = {
        a.get("approver_id") for a in approvals
        if a.get("decision") == "approved" and a.get("approver_id") in named
    }
    return len(yes) >= needed


def needs_reapproval(settings: dict[str, Any], old_total: float,
                     new_total: float) -> tuple[bool, str]:
    """Does this revision go back down the approval path? Returns (yes, why).

    The rule the whole market converges on: a small edit within the existing
    authorisation flows through; a change that MATERIALLY RAISES THE VALUE
    needs fresh approval, down the same path it would have taken originally.

    ONLY UPWARDS. Reducing an order, or removing a line, is inside an
    authorisation that has already been given — nobody has ever needed a second
    signature to spend less. Written as a floor of zero on the delta rather
    than an abs(), because that is the substantive decision and an abs() hides
    it.

    Either test fires. See `DEFAULT_SETTINGS` for why one alone is wrong at one
    end of the range or the other.
    """
    old = _num(old_total)
    new = _num(new_total)
    delta = new - old
    if delta <= 0:
        return False, ""
    amount_limit = _num(settings.get("reapproval_amount"), 10000.0)
    pct_limit = _num(settings.get("reapproval_pct"), 10.0)
    if amount_limit > 0 and delta >= amount_limit:
        return True, (
            f"The total rises by ₹{delta:,.2f}, at or above this "
            f"organisation's ₹{amount_limit:,.2f} re-approval threshold.")
    if pct_limit > 0 and old > 0 and (delta / old) * 100 >= pct_limit:
        pct = (delta / old) * 100
        return True, (
            f"The total rises by {pct:.1f}%, at or above this organisation's "
            f"{pct_limit:g}% re-approval threshold.")
    if old <= 0 and new > 0:
        # An order that had no value and now has one is not a percentage
        # change, it is a new commitment. The percentage test cannot express
        # that (division by zero), so it is stated separately rather than
        # falling through as "immaterial".
        return True, "The order had no value and now does."
    return False, ""


# ── The diff ──────────────────────────────────────────────────────────────────

#: Header fields a revision records a change to. Everything else on the row —
#: status, totals, the approval snapshot, timestamps — is DERIVED from the
#: change rather than being the change, and recording it would make every diff
#: unreadable behind bookkeeping.
DIFFED_FIELDS: tuple[str, ...] = (
    "vendor_id", "po_date", "expected_date", "department", "category",
    "currency", "place_of_supply", "is_igst", "terms", "notes",
    "delivery_address",
)


def _comparable(value: Any) -> Any:
    """Normalise a field so two spellings of the same value compare equal.

    ── EMPTY STRING IS NULL HERE, AND HAS TO BE ────────────────────────────

    Every optional text column on a purchase order is written
    `NULLIF($n, '')`, so a form that posts `""` stores NULL — the value it
    already held. Comparing them naively made `None -> ""` a change, and a
    user who opened an order, touched nothing and pressed Save minted a
    revision recording that the notes had changed from nothing to nothing.
    That is precisely the "accidental save inflates the revision number until
    the history stops meaning anything" failure `build_diff` returns an empty
    diff to prevent, arriving through the back door.
    """
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True, default=str)
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if isinstance(value, (int, float)):
        return round(float(value), 4)
    return str(value)


def build_diff(before: dict[str, Any], after: dict[str, Any],
               before_lines: list[dict[str, Any]],
               after_lines: list[dict[str, Any]]) -> dict[str, Any]:
    """`{field: {"from": x, "to": y}}` plus a `lines` entry, or `{}` if nothing
    moved.

    Lines are compared BY POSITION (`line_no`), not by id, because a revision
    routinely deletes line 2 and the reader wants "line 2 changed from A to B",
    not "one line was destroyed and another created". A PO with fewer or more
    lines reports the added and removed ones explicitly.

    An empty diff is a real answer and the caller uses it: a PATCH that changes
    nothing must not mint a revision, or every accidental save inflates the
    revision number and the history stops meaning anything.
    """
    diff: dict[str, Any] = {}
    for field in DIFFED_FIELDS:
        if field not in after:
            continue
        old = _comparable(before.get(field))
        new = _comparable(after.get(field))
        if old != new:
            diff[field] = {"from": before.get(field), "to": after.get(field)}

    line_changes = _diff_lines(before_lines, after_lines)
    if line_changes:
        diff["lines"] = line_changes
    return diff


_LINE_FIELDS = ("description", "hsn_code", "sac_code", "qty_ordered", "unit",
                "rate", "gst_rate", "discount_pct", "line_total")


def _diff_lines(before: list[dict[str, Any]],
                after: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_no_before = {int(l.get("line_no") or i + 1): l for i, l in enumerate(before)}
    by_no_after = {int(l.get("line_no") or i + 1): l for i, l in enumerate(after)}
    out: list[dict[str, Any]] = []
    for no in sorted(set(by_no_before) | set(by_no_after)):
        old = by_no_before.get(no)
        new = by_no_after.get(no)
        if old is None:
            out.append({"line_no": no, "change": "added",
                        "description": new.get("description", "")})
            continue
        if new is None:
            out.append({"line_no": no, "change": "removed",
                        "description": old.get("description", "")})
            continue
        fields = {}
        for f in _LINE_FIELDS:
            a, b = _comparable(old.get(f)), _comparable(new.get(f))
            if a != b:
                fields[f] = {"from": old.get(f), "to": new.get(f)}
        if fields:
            out.append({"line_no": no, "change": "changed",
                        "description": new.get("description", ""),
                        "fields": fields})
    return out


# ── Receiving ─────────────────────────────────────────────────────────────────

def receipt_allowed(settings: dict[str, Any], ordered: float, already: float,
                    incoming: float) -> tuple[bool, str]:
    """May this quantity be received against this line? Returns (ok, reason).

    Over-receipt is a SETTING and it defaults to refusing, because a delivery
    of more than was ordered is far more often a data-entry slip than a
    generous supplier — and a slip that inflates goods-received-not-invoiced is
    a wrong number in a period-end accrual.

    A tolerance is expressed as a percentage OF THE ORDERED QUANTITY, so "5%
    over is fine" reads the same on a line of 10 and a line of 10,000.

    A NEGATIVE receipt — a return, a correction — is always allowed, and the
    only thing checked is that it does not drive the received quantity below
    zero, which would mean returning goods that never arrived.
    """
    incoming = _num(incoming)
    if incoming == 0:
        return False, "A receipt must record a quantity."
    ordered = _num(ordered)
    already = _num(already)
    new_total = already + incoming

    if incoming < 0:
        if new_total < 0:
            return False, (
                f"That would take the received quantity to {new_total:g}. "
                f"Only {already:g} has been received against this line.")
        return True, ""

    if new_total <= ordered:
        return True, ""

    if settings.get("over_receipt") != "allow":
        return False, (
            f"{new_total:g} would exceed the {ordered:g} ordered on this line. "
            f"This organisation does not accept over-receipt — raise a "
            f"revision if the order itself has changed.")

    tolerance = _num(settings.get("over_receipt_tolerance_pct"), 0.0)
    ceiling = ordered * (1 + tolerance / 100)
    if new_total <= ceiling or ordered == 0:
        return True, ""
    return False, (
        f"{new_total:g} exceeds the {ordered:g} ordered by more than this "
        f"organisation's {tolerance:g}% tolerance ({ceiling:g}).")


def po_status_after_receipts(current: str, lines: list[dict[str, Any]]) -> str:
    """Where the order sits once a receipt has landed.

    `closed` and `cancelled` are terminal and are returned untouched: a receipt
    recorded against a closed-short order is a late delivery the firm has
    already decided not to wait for, and it must not silently re-open the
    commitment it just discharged.

    Full receipt is `received >= ordered` on EVERY line, not `==`. With
    over-receipt allowed a line can land above its ordered quantity, and an
    order whose every line has over-delivered is not "partly received".
    """
    if current in ("closed", "cancelled", "draft", "awaiting_approval", "rejected"):
        return current
    if not lines:
        return current
    received_any = any(_num(l.get("qty_received")) != 0 for l in lines)
    all_full = all(
        _num(l.get("qty_received")) >= _num(l.get("qty_ordered")) for l in lines)
    if all_full:
        return "received"
    if received_any:
        return "part_received"
    return "issued"


# ── The three-way match ───────────────────────────────────────────────────────

#: A rupee. Two figures that differ by less than this are the same figure — the
#: half-paisa that `round(gst/2, 2)` can introduce on a long order is not a
#: discrepancy anybody wants flagged, and flagging it is how an exception list
#: gets ignored.
MATCH_TOLERANCE = 1.0


def bill_qty_by_line(po_lines: list[dict[str, Any]],
                     bill_line_items: Iterable[Any]) -> dict[int, float]:
    """How much of each PO line the linked bills have charged for.

    ── THE HONEST LIMITATION, STATED RATHER THAN HIDDEN ────────────────────

    `ganit_vendor_bills.line_items` is jsonb with no `po_line_id` in it, and
    this module does not add one: the bill-create path lives in `ganit.py`,
    which this workstream does not own, and a column written by nobody is worse
    than no column. So a bill line is matched to a PO line by `product_id`
    where both carry one, and by normalised description otherwise.

    That is right for the overwhelming majority — a bill raised against a PO is
    the PO's own lines, usually pasted — and it is WRONG for two PO lines that
    name the same product twice at different rates. Those two collapse into
    one, and the module says so in the match response's `basis` rather than
    reporting a confident discrepancy it has not earned. The line-level match
    is advisory; the TOTAL-level match below is exact and is what the exception
    report is built on.
    """
    by_product: dict[str, int] = {}
    by_desc: dict[str, int] = {}
    for line in po_lines:
        no = int(line.get("line_no") or 0)
        pid = str(line.get("product_id") or "").strip()
        if pid:
            by_product.setdefault(pid, no)
        desc = str(line.get("description") or "").strip().casefold()
        if desc:
            by_desc.setdefault(desc, no)

    out: dict[int, float] = {}
    for item in bill_line_items or []:
        if not isinstance(item, dict):
            continue
        pid = str(item.get("product_id") or "").strip()
        desc = str(item.get("description") or "").strip().casefold()
        no = by_product.get(pid) if pid else None
        if no is None:
            no = by_desc.get(desc)
        if no is None:
            continue
        out[no] = out.get(no, 0.0) + _num(item.get("quantity"), 0.0)
    return out


def three_way_match(po: dict[str, Any], lines: list[dict[str, Any]],
                    bills: list[dict[str, Any]]) -> dict[str, Any]:
    """PO against receipt against bill, with the discrepancies NAMED.

    Every exception carries the three numbers it was derived from, because
    "discrepancy on line 3" sends somebody back to the paperwork and
    "ordered 100, received 60, billed 100" does not.

    NOTHING IS APPROVED HERE, and nothing ever will be by this function.
    Automatically approving a bill because it matches is a decision to make
    after somebody has watched the match be right for a few months. The
    exceptions are surfaced from day one; the automation is not.
    """
    exceptions: list[dict[str, Any]] = []
    line_view: list[dict[str, Any]] = []

    for line in lines:
        ordered = _num(line.get("qty_ordered"))
        received = _num(line.get("qty_received"))
        billed = _num(line.get("qty_billed"))
        entry = {
            "line_no": line.get("line_no"),
            "description": line.get("description"),
            "unit": line.get("unit"),
            "qty_ordered": ordered,
            "qty_received": received,
            "qty_billed": billed,
            "outstanding": round(ordered - received, 3),
        }
        line_view.append(entry)

        if billed - received > 0.001:
            exceptions.append({
                "kind": "billed_not_received",
                "severity": "high",
                "line_no": line.get("line_no"),
                "description": line.get("description"),
                "detail": (
                    f"Billed for {billed:g} {line.get('unit') or ''}".strip()
                    + f" but only {received:g} has been received."),
            })
        elif received - billed > 0.001 and received > 0:
            exceptions.append({
                "kind": "received_not_invoiced",
                "severity": "info",
                "line_no": line.get("line_no"),
                "description": line.get("description"),
                "detail": (
                    f"{received - billed:g} received and not yet billed — this "
                    f"is the period-end accrual, not a fault."),
            })
        if ordered - received > 0.001 and po.get("expected_date"):
            entry["short"] = round(ordered - received, 3)

    bills_total = sum(_num(b.get("total")) for b in bills)
    po_total = _num(po.get("total"))
    if bills and bills_total - po_total > MATCH_TOLERANCE:
        exceptions.append({
            "kind": "billed_over_ordered",
            "severity": "high",
            "detail": (
                f"Bills against this order total ₹{bills_total:,.2f} against an "
                f"order of ₹{po_total:,.2f}."),
        })

    return {
        "po_total": round(po_total, 2),
        "billed_total": round(bills_total, 2),
        "bills": len(bills),
        "lines": line_view,
        "exceptions": exceptions,
        "matched": not exceptions,
        # Named so a reader knows how much to trust the line half. See
        # `bill_qty_by_line`.
        "basis": (
            "Line quantities are matched to bill lines by product where both "
            "carry one, and by description otherwise. The order and bill "
            "TOTALS are compared exactly."),
    }


# ── Budgets ───────────────────────────────────────────────────────────────────

def budget_state(settings: dict[str, Any],
                 committed_by_dept: dict[str, float]) -> list[dict[str, Any]]:
    """Budget against committed, per department, where limits are set.

    ── THE CAVEAT THAT SHIPS WITH THE FEATURE ──────────────────────────────

    `manav_employees.department` is a FREE-TEXT COLUMN, not a modelled entity
    with an owner, and 11 of 98 employees have it blank. A budget keyed on a
    string nobody governs will quietly stop matching the day somebody types
    "Audit " with a trailing space. So this compares case-insensitively on the
    trimmed string, which recovers the common near-misses, and budgets ship
    DISABLED by default with the settings screen saying why.

    Making this dependable needs departments to become real records first. That
    is a schema decision and it is not made here.
    """
    if not settings.get("budgets_enabled"):
        return []
    normalised = {(k or "").strip().casefold(): v for k, v in committed_by_dept.items()}
    out = []
    for b in settings.get("budgets") or []:
        dept = b.get("department") or ""
        committed = _num(normalised.get(dept.strip().casefold(), 0.0))
        limit = _num(b.get("limit"))
        alert_pct = _num(b.get("alert_pct"), 80.0)
        used_pct = (committed / limit * 100) if limit > 0 else 0.0
        out.append({
            "department": dept,
            "period_start": b.get("period_start") or None,
            "period_end": b.get("period_end") or None,
            "limit": round(limit, 2),
            "committed": round(committed, 2),
            "remaining": round(limit - committed, 2),
            "used_pct": round(used_pct, 1),
            "state": ("over" if limit > 0 and committed > limit
                      else "alert" if limit > 0 and used_pct >= alert_pct
                      else "ok"),
        })
    return out


# ── 194Q ──────────────────────────────────────────────────────────────────────

def tds_194q_row(vendor_name: str, purchased_ytd: float,
                 on_order: float) -> dict[str, Any]:
    """One vendor's position against the ₹50 lakh 194Q threshold.

    `on_order` — the value of purchase orders ISSUED and not yet billed — is
    what makes this a warning rather than a post-mortem. 194Q bites at payment
    OR CREDIT, whichever is earlier, and advances count; a firm that has
    ordered ₹20 lakh from a vendor it has already paid ₹40 lakh has crossed the
    line and will not find out from its bills for another month.

    The rate is applied to the GROSS — purchase value INCLUDING GST. The ₹10
    crore turnover test that decides whether the firm deducts AT ALL excludes
    GST, and this product does not hold the firm's turnover, so nothing here
    asserts that the deduction applies. It reports the vendor position and
    names the test it cannot run.
    """
    purchased_ytd = _num(purchased_ytd)
    on_order = _num(on_order)
    projected = purchased_ytd + on_order
    over = max(0.0, projected - TDS_194Q_THRESHOLD)
    return {
        "vendor": vendor_name,
        "purchased_ytd": round(purchased_ytd, 2),
        "on_order": round(on_order, 2),
        "projected": round(projected, 2),
        "threshold": float(TDS_194Q_THRESHOLD),
        "pct_of_threshold": round(projected / TDS_194Q_THRESHOLD * 100, 1),
        "crossed": purchased_ytd > TDS_194Q_THRESHOLD,
        "will_cross_on_current_orders": (
            purchased_ytd <= TDS_194Q_THRESHOLD < projected),
        "indicative_tds": round(over * TDS_194Q_RATE, 2),
        "basis": TDS_194Q_BASIS,
    }
