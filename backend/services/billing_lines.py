"""
services/billing_lines.py — the ONE writer of `staging.org_billing_lines`.

The rule `services/credits.py` holds for the four credit tables, applied to the
table that says WHAT AN ORG IS CHARGED. No file outside this one may INSERT,
UPDATE or DELETE `staging.org_billing_lines`. Credits learned that rule the
expensive way — five debit implementations that disagreed about the wallet, the
name of a reversal and whether a retry charged twice — and a billing line is the
same kind of fact: written from several screens, read by an invoice, and wrong
in a way nobody notices until a client reads it.

WHY THIS FILE EXISTS AT ALL. `routers/admin_orgs.py:_billing_lines()` imports
this module INSIDE the call, so its absence passed every import check and the
whole test suite, and failed for the first time in production on three routes:

    POST  /v1/admin/orgs                     → 500 on EVERY org creation, after
                                               the org row, the R2 bucket and the
                                               subscription had already committed
    PATCH /v1/admin/orgs/{id}/settings       → 500 whenever a monthly_price is sent
    POST  /v1/admin/orgs/{id}/credits/topup  → 500 when "add to invoice" is ticked,
                                               inside the transaction that had
                                               just granted the credits

The two functions those call sites use — `sync_platform_line` and `create_line`
— are documented in that `_billing_lines()` docstring. It is shipped code and
this module is its missing half, so the signatures here match it exactly rather
than improving on it.

── THE MODEL, from the owner; not redesigned here ───────────────────────────

A client is billed for several things, not one:

    1. Platform fee       always present, one amount, no toggle
    2. Support plan       optional, OFF by default, never pre-filled
    3. Integration setup  optional, OFF by default, one-off
    5. Ongoing support    optional, OFF by default
    4. Credit top-up      never configured — born from the top-up dialog's
                          "add to invoice" tick, in the same transaction as the
                          credits it bills for

2, 3 and 5 are ONE shape: {enabled, description, amount}. A line that exists IS
enabled; ending it is `period_end`, never a DELETE. AN INVOICE IS A QUERY OVER
THE LINES DUE IN A PERIOD — never a hand-typed total. There is no payment
gateway and there will not be one: an invoice collects by carrying a UPI
address, and an invoice must stay creatable standalone because clients agree
terms verbally. Nothing here gates provisioning on an invoice existing.

── WHICH IS AUTHORITATIVE: THE LINE OR monthly_price ────────────────────────

Migration 096 settles it and this module obeys it:

  · `staging.org_billing_lines` IS AUTHORITATIVE for what an org is charged.
  · `staging.organisations.monthly_price` survives as a DENORMALISED MIRROR of
    the single OPEN `platform` line — display and compatibility only. Nothing
    charges from it.
  · `staging.v_org_platform_line_drift` MUST ALWAYS RETURN ZERO ROWS.
  · If the two ever disagree, THE LINE WINS and monthly_price is the bug.

That contract is why three refusals in this file exist. Nothing outside
`sync_platform_line` may create, re-price or end a `platform` line, because
`sync_platform_line` is only ever called from the one endpoint that writes the
scalar in the SAME transaction. A support line can be written on its own; a
platform line written on its own is a drift row.

── WHAT THIS MODULE OFFERS ──────────────────────────────────────────────────

    sync_platform_line  the platform fee, mirrored from organisations.monthly_price
    create_line         one line — support, setup, ongoing, or a top-up
    update_line         amend a description or an amount
    end_line            stop billing a monthly line, keeping the row
    list_lines          every line an org has, plus this period's two totals
    lines_due_in_period the invoice, as a query
    record_billed       what an invoice actually billed, so it cannot bill it twice

ONE PERIOD, ONE CHARGE PER KIND. A monthly line ended in a month is billed
THROUGH that month — that is the promise the confirm dialog makes — so a
replacement opened in the same month is due alongside it and the client pays the
fee twice. No index can refuse that: `uq_obl_open_platform` cannot see a line
once it is closed, and support and ongoing lines have no index at all. It is
settled in ONE place, `_covering_line`, which every read below goes through,
including `record_billed`. Read that docstring before changing anything about
what "due" means.

Every one of them takes a `conn` and NONE of them commits, because each is half
of something else: a line and the credits it bills for, or a line and the scalar
that mirrors it. A function here that committed on its own could leave the other
half unwritten. The only `conn.transaction()` in this file is the SAVEPOINT
inside `_insert_line`, which exists so that a unique violation is recoverable
rather than fatal to the caller's transaction — it commits nothing the caller
has not already decided to commit. `services/credits.py` offers `*_standalone`
wrappers for callers with no transaction; nothing needs one here, and until
something does, adding one would only make it possible to write a line outside
the transaction that gives it meaning.

DEPENDS ON MIGRATION 096. Every column named below is created by
`backend/migrations/096_billing_lines.sql`, which is NOT YET APPLIED. Until it
is, every function here raises `UndefinedTableError` — loudly, on first call,
which is the correct failure for a database that is a migration behind.
"""
import logging
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable, Mapping, Optional
from uuid import UUID

from fastapi import HTTPException

# The period a billing line sits in has to be the period the allowance sits in.
# `admin_orgs.py` imports `current_period` from the same module for the same
# reason it imports CREDIT_PRICE_INR from there: retyping either is how the two
# drift. Nothing else is taken from credits, and nothing here names a credit
# table — that remains four table names only `services/credits.py` may say.
from services.credits import current_period, next_period

log = logging.getLogger(__name__)

__all__ = [
    "BillingLineError", "UnknownOrg", "UnknownLine", "InvalidLine",
    "LineConflict", "LineAlreadyBilled",
    "KINDS", "CADENCES", "OPERATOR_KINDS",
    "sync_platform_line", "create_line", "update_line", "end_line",
    "list_lines", "lines_due_in_period", "record_billed",
]


# ── The vocabulary the CHECK constraints already enforce ────────────────────
#
# Repeated here in Python so a bad `kind` is a 400 that names the six legal
# ones, rather than a CheckViolationError that reaches the operator as a 500
# with the constraint's name in it. The DB constraint stays the authority; this
# is the sentence.

KINDS: tuple[str, ...] = ("platform", "support", "setup", "ongoing", "topup", "credit")

#: The kinds an operator may create through the billing block. `platform` is
#: absent because only `sync_platform_line` may write one — see the module
#: docstring. `topup` is absent because a top-up line is a fact about a payment
#: that has already happened: it is created by the top-up handler, which passes
#: `kind="topup"` explicitly and carries the granting transaction in `source_ref`.
#:
#: `credit` is absent for the opposite reason to `platform`: it is not dangerous,
#: it is UNFINISHED. `services/proration.py` writes one per mid-cycle plan change
#: and that path is closed and tested. A hand-typed credit needs a reason, an
#: approval and a place on the invoice that says what it reverses, and none of
#: those exist yet — a box on a form that silently forgives money is worse than
#: no box. Phase 3.2 ships the mechanism; the operator door is a later decision.
OPERATOR_KINDS: tuple[str, ...] = ("support", "setup", "ongoing")

#: The one kind that SUBTRACTS. Everything else on an invoice adds.
CREDIT_KIND = "credit"

CADENCES: tuple[str, ...] = ("monthly", "one_off")

#: `amount NUMERIC(12,2)`. A value past this is a numeric field overflow from
#: the driver — 22003, no column name, no sentence. Refused here with the limit
#: spelled out, because money code must say what is wrong rather than what broke.
_MAX_AMOUNT = Decimal("9999999999.99")

_CENT = Decimal("0.01")

#: `YYYY-MM` (a period, as the screens send it) or `YYYY-MM-DD` (a date, as a
#: DATE column round-trips). Both mean a month; see `_month_start`.
_PERIOD_RE = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$")

_LINE_COLS = (
    "id, org_id, kind, description, amount, currency, cadence, "
    "period_start, period_end, source_ref, created_by, ended_by, "
    "created_at, updated_at"
)


# ── Exceptions ──────────────────────────────────────────────────────────────
#
# The same shape `services/credits.py` established and `frontend/src/lib/*`
# already reads: an HTTPException whose `detail` is
# `{"error": <code>, "message": <sentence>, ...numbers}`. A frontend renders
# `detail.message` and never parses the sentence for figures.
#
# A PARALLEL hierarchy rather than a reuse of `CreditError`: these refusals are
# about what a client is charged, not about a wallet, and a screen that showed
# `"error": "credit_error"` when a billing line was refused would send whoever
# read the log to the wrong module.


class BillingLineError(HTTPException):
    """Base. Subclasses fastapi.HTTPException deliberately, so an uncaught one
    still reaches the client as the right status with the right sentence rather
    than as a 500 that says nothing."""

    code: str = "billing_line_error"
    http_status: int = 500

    def __init__(self, message: str, **fields: Any):
        self.message = message
        self.fields = fields
        super().__init__(
            status_code=self.http_status,
            detail={"error": self.code, "message": message, **fields},
        )


class UnknownOrg(BillingLineError):
    """No such org in `staging.organisations`. → 404

    Raised BEFORE any INSERT rather than letting the foreign key raise it. A
    ForeignKeyViolationError inside the top-up's transaction aborts the grant
    that ran a statement earlier, and the operator is told nothing except 500.
    """
    code = "unknown_org"
    http_status = 404


class UnknownLine(BillingLineError):
    """No such line, or not this org's line. → 404

    The two are ONE answer on purpose: telling a caller that a line id exists
    but belongs to somebody else is a tenancy leak on a table about money.
    """
    code = "unknown_line"
    http_status = 404


class InvalidLine(BillingLineError):
    """The line as described cannot be written. → 400

    Every CHECK on the table, said as a sentence before Postgres says it as a
    constraint name.
    """
    code = "invalid_line"
    http_status = 400


class LineConflict(BillingLineError):
    """The write is legal in isolation and wrong given what is already there. → 409

    Three cases, all of them a defence of an invariant no single row can carry:
    a second open monthly line of a kind that has one, a platform line written
    outside the endpoint that mirrors it, and an amount edit to a line that has
    already closed.
    """
    code = "line_conflict"
    http_status = 409


class LineAlreadyBilled(BillingLineError):
    """This line has already been billed for this period. → 409

    THE NO-DOUBLE-CHARGE RULE, reaching a human. `uq_ibl_line_period` refuses it
    in the database; this is the same refusal with the invoice number in it, so
    the operator can go and look at the invoice rather than guess.
    """
    code = "line_already_billed"
    http_status = 409


# ── Small conversions, each of which has cost this repo something ───────────


def _is_unique_violation(exc: Exception) -> bool:
    """Matched on sqlstate rather than on the exception class, so a wrapped
    driver or a test double behaves the same. Same one-liner as
    `credits._is_unique_violation`; duplicated rather than imported because
    reaching into another service's privates couples two modules that otherwise
    share nothing."""
    return getattr(exc, "sqlstate", None) == "23505"


def _constraint_of(exc: Exception) -> str:
    """Which unique index refused the write. asyncpg carries it; anything else
    yields '' and the caller falls back to a general message."""
    return getattr(exc, "constraint_name", "") or ""


def _uuid(value: Any, *, what: str, exc: type[BillingLineError]) -> str:
    """A uuid string, or the 404 the caller would have given anyway.

    `$1::uuid` on a mistyped id raises asyncpg's DataError, which reaches the
    client as a 500 and tells an operator the server is broken when they have
    fat-fingered an id. `tests/test_billing_lines.py` pins that distinction for
    the billing routes already shipped; it is the same distinction here.
    """
    if isinstance(value, UUID):
        return str(value)
    try:
        return str(UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        raise exc(f"'{value}' is not a valid {what} id.",
                  **{f"{what}_id": str(value)})


def _money(value: Any, *, field: str = "amount", signed: bool = False) -> Decimal:
    """A rupee figure as the column stores it: NUMERIC(12,2), never negative.

    Decimal throughout, and the comparison in `sync_platform_line` depends on
    it — `8000.0 != 8000.00` is false for Decimal and true for anything that
    goes through a float on the way. Quantised HALF_UP, which is what
    NUMERIC(12,2) does to a third decimal place, so the value this module
    returns is the value the database holds and not a rounding away from it.

    `signed=True` IS FOR ONE COLUMN ONLY: `invoice_billing_lines.amount`, which
    carries no `>= 0` CHECK because it records what a document charged, and a
    document that credits ₹4,000 charged minus four thousand rupees. It is NOT
    a way to write a negative `org_billing_lines.amount` — that column's CHECK
    stands, `record_billed` is the only caller that passes the flag, and the
    magnitude limit below applies either way.
    """
    if isinstance(value, bool):        # bool is an int; `True` is not ₹1
        raise InvalidLine(f"{field} must be a number.", field=field)
    try:
        amount = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise InvalidLine(f"{field} must be a number, got {value!r}.", field=field)
    if not amount.is_finite():
        raise InvalidLine(f"{field} must be a finite number.", field=field)
    amount = amount.quantize(_CENT, rounding=ROUND_HALF_UP)
    if amount < 0 and not signed:
        raise InvalidLine(
            f"{field} cannot be negative. A charge to be reversed is a credit "
            f"note, not a negative line.",
            field=field, amount=float(amount),
        )
    if abs(amount) > _MAX_AMOUNT:
        raise InvalidLine(
            f"{field} cannot exceed {_MAX_AMOUNT} — the column is NUMERIC(12,2).",
            field=field, amount=float(amount), maximum=float(_MAX_AMOUNT),
        )
    return amount


def _month_start(value: Any, *, field: str = "period_start") -> date:
    """The 1st of the month `value` falls in.

    A billing period is a calendar month because the credit allowance resets on
    the 1st, and `period_start` carries a CHECK that says exactly that. Three
    shapes arrive here and all three mean a month:

      · `date(2026, 8, 1)`  — `credits.current_period()`, from the top-up handler
      · `"2026-08-01"`      — a DATE column round-tripped, and what the billing
                              block POSTs as `period_start`
      · `"2026-08"`         — what the screens send as `?period=`

    A mid-month date is TRUNCATED rather than refused: `2026-08-17` is not
    ambiguous, it is August, and refusing it would 500 a top-up over a date
    nobody typed. Anything that is not a month at all is refused, because
    guessing there picks which month a client is billed for.
    """
    if isinstance(value, datetime):
        return date(value.year, value.month, 1)
    if isinstance(value, date):
        return date(value.year, value.month, 1)
    m = _PERIOD_RE.match(str(value or "").strip())
    if not m:
        raise InvalidLine(
            f"{field} must be a calendar month — YYYY-MM or YYYY-MM-DD, "
            f"got {value!r}.",
            field=field,
        )
    year, month = int(m.group(1)), int(m.group(2))
    if not 1 <= month <= 12:
        raise InvalidLine(f"{field} names month {month}, which does not exist.",
                          field=field)
    return date(year, month, 1)


def _text(value: Any, *, field: str, required: bool = True) -> Optional[str]:
    """A trimmed non-empty string, or the refusal.

    `description` carries `CHECK (btrim(description) <> '')`, and it is what the
    client reads on the invoice beside the amount. A blank one is a charge with
    no explanation.
    """
    text = "" if value is None else str(value).strip()
    if not text:
        if required:
            raise InvalidLine(
                f"{field} cannot be empty. It is what the client reads on the "
                f"invoice beside the amount.",
                field=field,
            )
        return None
    return text


def _iso(value) -> Optional[str]:
    """A date or timestamp as the string a browser can compare and parse.

    `BillingLinesBlock.jsx` does `String(l.period_start).slice(0, 7)` to decide
    whether a one-off already exists this month, and gets that comparison wrong
    — silently, into a duplicate charge — if the value arrives as anything other
    than `YYYY-MM-DD`. Normalised here rather than left to whichever serialiser
    is between this module and the browser.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _signed_amount(kind: Any, amount: Any) -> Decimal:
    """What this line does to a total: a credit subtracts, everything else adds.

    THE ONE PLACE THE SIGN IS DECIDED. `amount` is a magnitude — the column is
    `CHECK (amount >= 0)` and 096 chose that deliberately — so `kind` is what
    says which way it points, and a second module deciding that for itself is
    how a screen and an invoice come to disagree about what a client owes.

    The SQL half of the same rule is `_SIGNED_AMOUNT_SQL` below; they are
    written next to each other so neither can be changed alone.
    """
    amt = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    return -amt if kind == CREDIT_KIND else amt


#: `_signed_amount`, as a SQL expression over an aliased `org_billing_lines`.
#: Every SUM in this module goes through it; a bare `SUM(l.amount)` over a table
#: that now holds credits is a total that adds a refund to the bill.
_SIGNED_AMOUNT_SQL = f"(CASE WHEN l.kind = '{CREDIT_KIND}' THEN -l.amount ELSE l.amount END)"


def _row_to_line(row, *, actors: bool = True) -> Optional[dict]:
    """One `org_billing_lines` row as the JSON the screens already expect.

    `amount` is a float, not a Decimal or a string: `inr()` and the `!==`
    comparison in the billing block both take a number, and JSON has no decimal
    type to preserve anyway. Every rupee figure this table can hold is exact in
    float64 — NUMERIC(12,2) tops out at ten billion, and 2-decimal values stay
    exact to about 9e13 — so the float is a faithful copy of the stored value
    and not a rounding of it. All ARITHMETIC and all COMPARISON stays in
    Decimal; the float exists only at the edge.

    `actors=False` OMITS `created_by` and `ended_by`. They hold
    `public.users.user_id` — AEKAM STAFF, not the client's own people, because
    the only writers of this table are Aekam's console and Aekam's top-up
    dialog. A tenant reading its own terms has no business learning which of
    Aekam's people set its price or who stopped its support plan; that is
    internal staffing, it is the same class of leak as an internal note on an
    invoice, and it is not made safe by the fact that the value is opaque.
    See `list_lines`, which is the only read a tenant can reach.

    OMITTED rather than nulled: a `null` here is a real and different fact —
    096's backfill wrote `created_by NULL` on every line it created, because a
    migration did it and inventing an author is worse than admitting there isn't
    one — and a redaction that is indistinguishable from that is a redaction
    somebody will eventually read as data.
    """
    if row is None:
        return None
    line = {
        "id": str(row["id"]),
        "org_id": str(row["org_id"]),
        "kind": row["kind"],
        "description": row["description"],
        "amount": float(row["amount"]),
        # THE SAME NUMBER, SIGNED — sent so no screen has to know the rule.
        # `amount` stays the magnitude the column holds, because that is what an
        # operator typed and what an edit form must round-trip; `signed_amount`
        # is what a subtotal adds. A browser deriving the sign from `kind` is a
        # second copy of the rule in a language nobody tests the arithmetic in.
        "signed_amount": float(_signed_amount(row["kind"], row["amount"])),
        "currency": row["currency"],
        "cadence": row["cadence"],
        "period_start": _iso(row["period_start"]),
        "period_end": _iso(row["period_end"]),
        "source_ref": row["source_ref"],
        "created_at": _iso(row["created_at"]),
        "updated_at": _iso(row["updated_at"]),
    }
    if actors:
        line["created_by"] = row["created_by"]
        line["ended_by"] = row["ended_by"]
    return line


# ── Reads the writers depend on ─────────────────────────────────────────────


async def _assert_org(conn, org_id: str) -> str:
    """The org exists, or 404 — checked before any INSERT. See `UnknownOrg`."""
    org_id = _uuid(org_id, what="org", exc=UnknownOrg)
    found = await conn.fetchval(
        "SELECT id FROM staging.organisations WHERE id=$1::uuid", org_id,
    )
    if found is None:
        raise UnknownOrg(f"No organisation {org_id}.", org_id=org_id)
    return org_id


async def _line_by_id(conn, line_id: str, org_id: str, *, for_update: bool = False):
    """One line, scoped to its org. `UnknownLine` covers both "no such id" and
    "not yours" — see the exception."""
    sql = (
        f"SELECT {_LINE_COLS} FROM staging.org_billing_lines "
        f"WHERE id=$1::uuid AND org_id=$2::uuid"
        + (" FOR UPDATE" if for_update else "")
    )
    row = await conn.fetchrow(sql, line_id, org_id)
    if row is None:
        raise UnknownLine(
            f"No billing line {line_id} for organisation {org_id}.",
            line_id=line_id, org_id=org_id,
        )
    return row


async def _open_line_of_kind(conn, org_id: str, kind: str, *, for_update: bool):
    """The one OPEN monthly line of a kind, or None.

    `FOR UPDATE` locks the row so two concurrent amendments of the same fee
    serialise. It locks NOTHING when there is no row — which is why the INSERT
    paths below run inside a savepoint and treat a unique violation as "somebody
    else created it first" rather than as a failure.
    """
    sql = (
        f"SELECT {_LINE_COLS} FROM staging.org_billing_lines "
        f"WHERE org_id=$1::uuid AND kind=$2 AND cadence='monthly' "
        f"  AND period_end IS NULL "
        f"ORDER BY period_start, created_at LIMIT 1"
        + (" FOR UPDATE" if for_update else "")
    )
    return await conn.fetchrow(sql, org_id, kind)


async def _insert_line(conn, **cols) -> tuple[Any, str]:
    """The single INSERT statement in the product for this table.

    Inside a SAVEPOINT, exactly as `credits._write_ledger` is and for the same
    reason: a unique violation must not poison the caller's transaction. The
    caller here is often mid-request and otherwise fine — the top-up handler has
    ALREADY GRANTED THE CREDITS by the time this runs, and the right answer to
    "that line already exists" is to carry on with the row that does, not to
    500 and roll the grant back.

    Returns `(row, "")` on success and `(None, constraint_name)` when a unique
    index refused it. The NAME comes back with the refusal because the caller
    cannot re-derive it — the exception is consumed here, and after a unique
    violation the only thing that can be said about it is what was caught. The
    two indexes mean different things: `uq_obl_source_ref` means "this top-up is
    already billed" and `uq_obl_open_platform` means "this org already has an
    open platform line".
    """
    sql = (
        "INSERT INTO staging.org_billing_lines "
        "(org_id, kind, description, amount, currency, cadence, "
        " period_start, period_end, source_ref, created_by) "
        "VALUES ($1::uuid, $2, $3, $4::numeric, $5, $6, $7::date, $8::date, $9, $10) "
        f"RETURNING {_LINE_COLS}"
    )
    args = (
        cols["org_id"], cols["kind"], cols["description"], cols["amount"],
        cols.get("currency") or "INR", cols["cadence"],
        cols["period_start"], cols.get("period_end"),
        cols.get("source_ref"), cols.get("created_by"),
    )
    try:
        async with conn.transaction():
            return await conn.fetchrow(sql, *args), ""
    except Exception as exc:
        if _is_unique_violation(exc):
            return None, _constraint_of(exc)
        raise


# ════════════════════════════════════════════════════════════════════════════
# THE PLATFORM FEE
# ════════════════════════════════════════════════════════════════════════════


async def sync_platform_line(
    conn, *, org_id: str, amount: Any, actor_id: Optional[str],
) -> Optional[dict]:
    """Make the one OPEN `platform` line equal `amount`.

    Called from `POST /v1/admin/orgs` (a new org's first line) and from
    `PATCH /v1/admin/orgs/{id}/settings` (every amendment), in the SAME
    transaction as the write to `organisations.monthly_price`. That is the whole
    contract: the scalar is a mirror of this line, `v_org_platform_line_drift`
    must always return zero rows, and either the fee moves in both places or it
    moves in neither.

    Returns the open platform line as it now stands, or None when the org has no
    platform fee — a ₹0 fee writes no line, because an org on a free plan is not
    billed a ₹0 platform fee every month, and a ₹0 row on an invoice is a line
    the client has to read and then ignore.

    IDEMPOTENT. Called twice with the same amount it writes nothing at all, not
    even `updated_at` — so the column keeps meaning "when this fee last changed"
    rather than "when somebody last pressed Save".

    ── AMENDING IN PLACE, AND WHY NOT END-AND-REOPEN ────────────────────────

    The tempting alternative is to end the old line and open a new one at the
    new price, so history lives in the table. It is WRONG HERE, and the shipped
    docstring in `admin_orgs._billing_lines()` says so in as many words:

        ending a line and opening a second one for the same month would put two
        platform rows in the same invoice period, and `uq_obl_open_platform`
        cannot refuse the second because the first is no longer open

    That is a DOUBLE CHARGE of the platform fee, on an invoice, with an index
    watching that cannot see it — the ended row still has
    `period_end >= period_start = this month`, so §2.3's due query returns both.

    IT IS STILL THE RULE, and it is no longer the only thing standing between a
    client and that charge. This function CANNOT avoid the shape in one case:
    a fee set to ₹0 and then back to a real figure in the same month ends the
    line and has nothing left to amend, so it opens a second one — and the
    console can do the same to a support plan through `end_line` and
    `create_line`. `_covering_line` is where that is now refused, on the read
    side, for every kind rather than for the one an index happens to cover.
    Amending here remains right because it keeps ONE row where one row is the
    truth; the predicate is what makes the unavoidable second row harmless.

    History is not lost by amending, because 096 puts it somewhere better:
    `invoice_billing_lines.amount` is denormalised AT ISSUE TIME and
    `subscription_invoices.line_items` is a frozen JSONB snapshot. "The line's
    amount may change afterwards; what the client was charged may not." So an
    invoice already issued goes on explaining itself no matter what this
    function does to the line afterwards, and the invoice — not the line — is
    the document the client holds.

    ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────

    The DESCRIPTION. An operator who renamed the line through
    `PATCH /billing/orgs/{id}/lines/{line_id}` must not have that label silently
    reverted to 'Platform fee' the next time the price moves. The billing block
    saves the two through different endpoints for exactly this reason, money
    first.
    """
    org_id = await _assert_org(conn, org_id)
    fee = _money(amount, field="monthly_price")
    period = current_period()

    existing = await _open_line_of_kind(conn, org_id, "platform", for_update=True)

    # ── No line yet ─────────────────────────────────────────────────────────
    if existing is None:
        if fee == 0:
            return None
        row, _refused_by = await _insert_line(
            conn, org_id=org_id, kind="platform",
            # The literal migration 096 backfills with, not the plan code. The
            # description is what the client reads on the invoice, and
            # 'professional' — a plan code no screen in this product speaks — is
            # not that.
            description="Platform fee",
            amount=fee, cadence="monthly",
            # Starts THIS month, never backdated. Backdating would make every
            # past month suddenly billable by the due query, and an operator
            # loading lines for June would raise an invoice for a fee that was
            # collected some other way.
            period_start=period,
            created_by=actor_id,
        )
        if row is not None:
            return _row_to_line(row)
        # `uq_obl_open_platform` refused it: a concurrent settings PATCH opened
        # the line between our SELECT (which locked nothing, there being no row)
        # and our INSERT. Fall through and amend what they wrote — the last
        # writer's amount is the one the operator is looking at.
        existing = await _open_line_of_kind(conn, org_id, "platform", for_update=True)
        if existing is None:                            # pragma: no cover
            raise LineConflict(
                f"An open platform line for organisation {org_id} was created "
                f"and removed while this fee was being saved. Save it again.",
                org_id=org_id,
            )

    # ── The fee has gone to zero: END the line, never DELETE it ─────────────
    if fee == 0:
        await _end_row(conn, existing, actor_id=actor_id, period=period)
        return None

    if _money(existing["amount"]) == fee:
        return _row_to_line(existing)

    row = await conn.fetchrow(
        "UPDATE staging.org_billing_lines "
        "SET amount=$1::numeric, updated_at=NOW() "
        "WHERE id=$2::uuid "
        f"RETURNING {_LINE_COLS}",
        fee, existing["id"],
    )
    return _row_to_line(row)


async def _end_row(conn, row, *, actor_id: Optional[str], period: date):
    """Set `period_end` on an open line. The one place a line stops billing.

    `period_end` is the LAST period the line is billed for, inclusive — the due
    query is `period_end >= P`, and the billing block promises the operator "it
    is billed through {this month} and not after". So ending a line today does
    not refund this month; it stops the next one.

    `max(period, period_start)` because `org_billing_lines_span_ck` requires
    `period_end >= period_start`. A line that starts next month and is ended
    today would violate it and 500; it ends on the day it starts instead, which
    is one period of a charge somebody agreed to and then withdrew.
    """
    ends_on = max(period, row["period_start"])
    return await conn.fetchrow(
        "UPDATE staging.org_billing_lines "
        "SET period_end=$1::date, ended_by=$2, updated_at=NOW() "
        "WHERE id=$3::uuid AND period_end IS NULL "
        f"RETURNING {_LINE_COLS}",
        ends_on, actor_id, row["id"],
    )


# ════════════════════════════════════════════════════════════════════════════
# THE LINES AN OPERATOR CREATES, AND THE ONE THE TOP-UP DIALOG CREATES
# ════════════════════════════════════════════════════════════════════════════


async def create_line(
    conn, *,
    org_id: str,
    kind: str,
    description: str,
    amount: Any,
    cadence: str,
    period_start: Any,
    source_ref: Optional[str] = None,
    created_by: Optional[str] = None,
    currency: str = "INR",
) -> dict:
    """Insert one billing line.

    Called from `POST /v1/admin/orgs/{id}/credits/topup` when the operator ticks
    "add to invoice" — inside the grant's transaction, so "credits added but
    never billed" and "billed for credits nobody received" are both states this
    system cannot reach — and from `POST /v1/billing/orgs/{id}/lines` when an
    operator ticks a support, setup or ongoing box.

    NEVER IMPLICITLY. Nothing in this module creates a support, setup or ongoing
    line as a side effect of anything: they are OFF by default and a line
    created by omission is a charge nobody agreed to. `OPERATOR_KINDS` is the
    set a public route should accept from a form — `platform` is refused below,
    and `topup` is passed only by the top-up handler, which has a `source_ref`
    to prove a payment happened.

    ── RETRY ───────────────────────────────────────────────────────────────

    A repeat of the same `source_ref` YIELDS THE ROW THAT ALREADY EXISTS rather
    than a second one. `uq_obl_source_ref` is what makes that true under
    concurrency — a check-then-insert would let two simultaneous double-clicks
    both pass the check. The top-up handler supplies
    `credit_tx:{idempotency_key}` because the key is the only identifier that
    survives a retry: `grant()` returns a Balance rather than a receipt, and a
    REPLAYED grant writes no new ledger row to have an id at all. Without this,
    a double-click grants once and bills twice.

    `source_ref` is unique GLOBALLY, not per org. A ref that already belongs to
    a DIFFERENT org is refused rather than returned — a customer reading someone
    else's top-up on their invoice is the failure that unique index was made
    global to catch.

    ── STOPPING AND RESTARTING A PLAN IN ONE MONTH ─────────────────────────

    ALLOWED, and it does not bill twice. The refusal below only sees OPEN lines,
    so a support plan ended this month leaves nothing to conflict with and a new
    one is inserted beside it — and the ended row is still due in the month it
    was billed through. `_covering_line` settles which of the two the period
    belongs to: the one the client was already promised, with the new one due
    from the month after. So the restart is a real path rather than a refusal
    the operator has to work around by waiting for the 1st, and it is also not a
    second charge. The same applies to a line created with a BACKDATED
    `period_start` that overlaps one already standing.
    """
    org_id = await _assert_org(conn, org_id)

    if kind not in KINDS:
        raise InvalidLine(
            f"'{kind}' is not a billing line kind. The five are: "
            f"{', '.join(KINDS)}.",
            kind=str(kind),
        )
    if kind == "platform":
        # The only creator of a platform line is `sync_platform_line`, because
        # it is the only path that also writes `organisations.monthly_price`.
        # One written here would be a `v_org_platform_line_drift` row on the day
        # it landed, and that view is the whole proof the mirror is honest.
        raise LineConflict(
            "A platform fee is not created here. Send it as `monthly_price` to "
            "PATCH /v1/admin/orgs/{org_id}/settings, which writes the line and "
            "the organisation's monthly price in one transaction — written "
            "separately they drift, and the line is what the client is charged.",
            org_id=org_id, kind=kind,
        )
    if cadence not in CADENCES:
        raise InvalidLine(
            f"'{cadence}' is not a cadence. It is 'monthly' or 'one_off'.",
            cadence=str(cadence),
        )

    description = _text(description, field="description")
    money = _money(amount)
    period = _month_start(period_start)
    source_ref = _text(source_ref, field="source_ref", required=False)

    if kind == "topup":
        # `org_billing_lines_topup_ck`, said as a sentence. A top-up line with
        # no `source_ref` is a line no retry can be matched against, which is
        # the same as no idempotency at all.
        if cadence != "one_off":
            raise InvalidLine(
                "A credit top-up is billed once, in the month it happened. It "
                "cannot be a monthly line.",
                kind=kind, cadence=cadence,
            )
        if not source_ref:
            raise InvalidLine(
                "A credit top-up line needs a source_ref naming the granting "
                "transaction — `credit_tx:{idempotency_key}`. It is what makes "
                "a retried top-up create no second line.",
                kind=kind,
            )

    if currency and not re.fullmatch(r"[A-Z]{3}", str(currency)):
        raise InvalidLine(
            f"'{currency}' is not a currency code. It is three capitals, and it "
            f"is 'INR' unless somebody has decided otherwise.",
            currency=str(currency),
        )

    # `org_billing_lines_span_ck`: a one-off is due in EXACTLY ONE PERIOD. The
    # callers pass no `period_end` — the top-up handler sends cadence and
    # period_start and nothing else — so deriving it here is not a convenience,
    # it is the difference between a top-up line and a CheckViolationError
    # inside the transaction that just granted the credits. Left NULL, a setup
    # fee would bill every month forever.
    period_end = period if cadence == "one_off" else None

    if source_ref:
        existing = await conn.fetchrow(
            f"SELECT {_LINE_COLS} FROM staging.org_billing_lines "
            f"WHERE source_ref=$1",
            source_ref,
        )
        if existing is not None:
            return _same_source_ref(existing, org_id=org_id, source_ref=source_ref)

    if cadence == "monthly":
        # One open recurring line per kind. There is no unique index for
        # support/ongoing the way there is for platform, and a second open one
        # would be INVISIBLE: the billing block binds each kind to the first
        # open line it finds, so the duplicate would never appear on a screen
        # and would appear on every invoice. The refusal names the line that is
        # already there and what to do with it, per the money-code rule.
        open_row = await _open_line_of_kind(conn, org_id, kind, for_update=True)
        if open_row is not None:
            raise LineConflict(
                f"This organisation already has an open {kind} line — "
                f"'{open_row['description']}' at ₹{open_row['amount']} a month "
                f"since {open_row['period_start']}. Amend that one, or end it "
                f"first. A second open {kind} line would be billed alongside it "
                f"and shown on no screen.",
                org_id=org_id, kind=kind, line_id=str(open_row["id"]),
            )

    row, refused_by = await _insert_line(
        conn, org_id=org_id, kind=kind, description=description, amount=money,
        currency=currency or "INR", cadence=cadence,
        period_start=period, period_end=period_end,
        source_ref=source_ref, created_by=created_by,
    )
    if row is not None:
        return _row_to_line(row)

    # A unique index refused it. Which one decides what this means.
    if source_ref:
        # `uq_obl_source_ref`: the racing request won. Its row is the answer —
        # this is the double-click, and one line is the correct outcome.
        existing = await conn.fetchrow(
            f"SELECT {_LINE_COLS} FROM staging.org_billing_lines WHERE source_ref=$1",
            source_ref,
        )
        if existing is not None:
            return _same_source_ref(existing, org_id=org_id, source_ref=source_ref)
    raise LineConflict(
        f"A {kind} line for this organisation was refused by a unique index "
        f"{('(' + refused_by + ') ') if refused_by else ''}— another request "
        f"wrote a conflicting line at the same moment. Reload the billing lines "
        f"and try again.",
        org_id=org_id, kind=kind, constraint=refused_by or None,
    )


def _same_source_ref(existing, *, org_id: str, source_ref: str) -> dict:
    """The row an already-used `source_ref` points at — or the alarm.

    `uq_obl_source_ref` is GLOBAL, and 096 says why: the key already contains
    the transaction id, so a global unique adds exactly one thing, the ability
    to catch a source_ref reused ACROSS orgs. Handing that row back would put
    one client's top-up on another client's invoice, so it is refused loudly and
    logged — this cannot happen without a bug upstream, and a bug that quietly
    resolves itself is one nobody fixes.
    """
    if str(existing["org_id"]) != str(org_id):
        log.error(
            "billing_lines: source_ref %s already belongs to org %s; refused for org %s",
            source_ref, existing["org_id"], org_id,
        )
        raise LineConflict(
            f"The reference '{source_ref}' is already on another organisation's "
            f"billing line. It identifies one transaction and cannot name two.",
            source_ref=source_ref, org_id=org_id,
        )
    return _row_to_line(existing)


# ════════════════════════════════════════════════════════════════════════════
# AMENDING AND ENDING
# ════════════════════════════════════════════════════════════════════════════


async def update_line(
    conn, line_id: str, *,
    org_id: str,
    description: Any = None,
    amount: Any = None,
) -> dict:
    """Amend a line's description, its amount, or both.

    Serves `PATCH /v1/billing/orgs/{org_id}/lines/{line_id}`. `None` means "not
    supplied" for both fields — neither is nullable in the table, so there is no
    value a null could be written as.

    TAKES NO `actor_id`, and that is a gap rather than a decision: 096 gives the
    table `created_by` and `ended_by` and NO `updated_by`, so there is nowhere
    to put one. Who raised a fee is therefore not recorded — only who opened the
    line and who stopped it. Accepting an `actor_id` here and dropping it would
    be worse than not accepting one: a router would pass it and believe the
    amendment was attributed. Adding the column is an additive migration for
    whoever wants that trail.

    AMENDS IN PLACE, including for a line an invoice has already billed. See
    `sync_platform_line` for the full argument: what the client was charged is
    frozen on the invoice (`invoice_billing_lines.amount` and the `line_items`
    snapshot), so a later amendment cannot rewrite a document already sent, and
    the no-double-charge rule is enforced by `uq_ibl_line_period` at billing
    time rather than by forbidding edits. Refusing the amendment instead would
    mean a fee agreed mid-month could not be recorded until the next one, which
    is how it gets forgotten.

    Three refusals, each defending something a single row cannot see:
      · the AMOUNT of a `platform` line — it mirrors a column in another table
      · the AMOUNT of a `topup` line — it is credits × the price they sold for
      · the AMOUNT of an ENDED line — the period it covered is closed
    The description is amendable in all three cases: it is the sentence the
    client reads, no second copy of it exists anywhere, and nothing can drift.
    """
    org_id = _uuid(org_id, what="org", exc=UnknownOrg)
    line_id = _uuid(line_id, what="line", exc=UnknownLine)
    row = await _line_by_id(conn, line_id, org_id, for_update=True)

    sets, params = [], []

    if description is not None:
        sets.append(f"description=${len(params) + 1}")
        params.append(_text(description, field="description"))

    if amount is not None:
        money = _money(amount)
        if row["kind"] == "platform":
            raise LineConflict(
                "The platform fee is amended through PATCH "
                "/v1/admin/orgs/{org_id}/settings as `monthly_price`, which "
                "writes this line and the organisation's stored price in one "
                "transaction. Changed here alone the two would disagree, and "
                "the line is the one the client is charged from.",
                line_id=line_id, kind=row["kind"],
            )
        if row["kind"] == "topup":
            raise LineConflict(
                "A credit top-up line is what was actually sold — the credits "
                "granted, at the price a credit sells for. Changing the rupee "
                "figure would make the invoice disagree with the ledger row it "
                "was raised from. Raise a separate line, or a credit note.",
                line_id=line_id, kind=row["kind"],
            )
        if row["period_end"] is not None:
            raise LineConflict(
                f"This line stopped billing on {row['period_end']}. Its periods "
                f"are closed and re-pricing them now would change what past "
                f"months say they cost. Create a new line for the new amount.",
                line_id=line_id, period_end=_iso(row["period_end"]),
            )
        sets.append(f"amount=${len(params) + 1}::numeric")
        params.append(money)

    if not sets:
        raise InvalidLine(
            "Nothing to change — send a description, an amount, or both.",
            line_id=line_id,
        )

    params.append(line_id)
    updated = await conn.fetchrow(
        f"UPDATE staging.org_billing_lines SET {', '.join(sets)}, updated_at=NOW() "
        f"WHERE id=${len(params)}::uuid "
        f"RETURNING {_LINE_COLS}",
        *params,
    )
    return _row_to_line(updated)


async def end_line(
    conn, line_id: str, *,
    org_id: str,
    actor_id: Optional[str] = None,
    period: Any = None,
) -> dict:
    """Stop billing a monthly line. Serves
    `POST /v1/billing/orgs/{org_id}/lines/{line_id}/end`.

    ENDING A LINE IS SETTING `period_end`, NEVER DELETING THE ROW. A deleted
    line silently rewrites what an already-issued invoice was for, and
    `invoice_billing_lines.line_id` carries ON DELETE RESTRICT so the database
    would refuse it anyway — this is that rule reached from the front.

    The line is billed THROUGH the period it ends in, inclusive, which is what
    the confirmation dialog promises the operator before they press the button.

    Ending an already-ended line returns it unchanged rather than refusing: the
    operator pressed a button twice and the state they asked for is the state
    that exists. Ending a `one_off` IS refused — it was never open, it is due in
    exactly one period by CHECK, and a screen offering to stop it is a screen
    about to mislead somebody.
    """
    org_id = _uuid(org_id, what="org", exc=UnknownOrg)
    line_id = _uuid(line_id, what="line", exc=UnknownLine)
    row = await _line_by_id(conn, line_id, org_id, for_update=True)

    if row["kind"] == "platform":
        # Ending the platform line without zeroing `monthly_price` puts the org
        # straight into `v_org_platform_line_drift`, and that view is the only
        # proof the mirror is honest. The endpoint that does both is named.
        raise LineConflict(
            "The platform fee is stopped by sending `monthly_price: 0` to PATCH "
            "/v1/admin/orgs/{org_id}/settings, which ends this line and clears "
            "the organisation's stored price in one transaction. Ended here "
            "alone, the organisation would still say it pays a monthly fee.",
            line_id=line_id, kind=row["kind"],
        )
    if row["cadence"] == "one_off":
        raise InvalidLine(
            "A one-off is billed in one period and is already closed — there is "
            "nothing to stop. It stops being billed the moment that month ends.",
            line_id=line_id, cadence=row["cadence"],
        )
    if row["period_end"] is not None:
        return _row_to_line(row)

    ended = await _end_row(
        conn, row, actor_id=actor_id,
        period=_month_start(period) if period is not None else current_period(),
    )
    # `_end_row`'s WHERE carries `period_end IS NULL`, so a concurrent end that
    # landed between the SELECT and the UPDATE returns no row. That is the same
    # outcome the caller asked for, so re-read rather than raise.
    if ended is None:                                   # pragma: no cover
        return _row_to_line(await _line_by_id(conn, line_id, org_id))
    return _row_to_line(ended)


# ════════════════════════════════════════════════════════════════════════════
# READS — THE BILLING BLOCK, THE CLIENT'S OWN VIEW, AND THE INVOICE
# ════════════════════════════════════════════════════════════════════════════

def _covering_line(period: str = "$2") -> str:
    """The EARLIER monthly line of the same kind that already covers `period`,
    correlated against the line aliased `l`. One row or none.

    ── THE DOUBLE CHARGE THIS EXISTS TO REFUSE ─────────────────────────────

    `_end_row` sets `period_end` to the period a line STOPS in, and that period
    is billed: "it is billed through August 2026 and not after" is what the
    console promises before the operator confirms. So a line ended in August
    still satisfies `period_end >= August` and is still due in August — which is
    correct, and is also the whole problem. Open a successor in the SAME month
    and both rows are due in it:

      · `sync_platform_line` opens one whenever a fee goes to ₹0 and then comes
        back in the same month — `_open_line_of_kind` cannot see the ended row,
        so there is nothing to amend and it inserts;
      · `create_line` opens one for a support or ongoing plan that is stopped
        and restarted, for the same reason.

    NO INDEX CAN REFUSE EITHER. `uq_obl_open_platform` only sees rows with
    `period_end IS NULL`, so the predecessor is invisible to it the moment it is
    ended; support and ongoing lines have no unique index at all. The drift view
    looks only at the OPEN platform line and is happy. The client is charged
    twice and every guard in 096 reports green.

    ── WHY A PREDICATE AND NOT "REUSE THE ENDED ROW" ───────────────────────

    The alternative was to have `sync_platform_line` and `create_line` REOPEN
    the line ended this period instead of inserting a second one. It is fewer
    lines of code and it is the wrong half of the system to fix:

      · IT RE-PRICES AN ENDED LINE, which `update_line` refuses BY NAME two
        hundred lines above — "its periods are closed and re-pricing them now
        would change what past months say they cost". A rule that a public
        endpoint refuses and an internal path performs quietly is not a rule.
      · IT ERASES EVIDENCE. `period_end` and `ended_by` are the record of who
        stopped a charge and when. Clearing them to make room for a successor
        destroys the only trail this table keeps on a money row, and 096 kept
        the ended row precisely so an invoice could go on explaining itself.
      · IT ONLY CLOSES THE CASE SOMEBODY THOUGHT OF. Reuse can match "ended in
        exactly this period". It does nothing about a line created with a
        BACKDATED `period_start` that overlaps an earlier line's span for four
        months — the console posts `period_start` and `_month_start` accepts any
        month — and that is the same double charge with a different arithmetic.
      · IT CANNOT FIX A ROW THAT IS ALREADY THERE, and it cannot fix a row a
        second connection writes at the same moment. `_open_line_of_kind` takes
        `FOR UPDATE` and there is nothing to lock when the answer is no row, so
        two concurrent `create_line` calls for one kind both pass the open-line
        refusal — and no unique index covers support or ongoing to catch the
        second. A write-time rule holds only for writes it is present for; a
        predicate holds for every row however it arrived, including one typed
        into psql.
      · AND `record_billed` NEEDS THE PREDICATE ANYWAY (see there). With the
        answer in one place, what the totals say, what the preview offers and
        what an invoice is allowed to book cannot come to disagree.

    So: BOTH ROWS STAY, EXACTLY ONE IS DUE, and the one that is due is the
    PREDECESSOR — because "billed through August" is a promise already made to
    the operator and to the client, and because the predecessor may already be
    on an issued invoice for that period while the successor cannot be. The
    successor starts being due the month after the predecessor stops, which is
    the sentence the confirm dialog says out loud.

    ORDERED BY `(period_start, created_at, id)`, the same order
    `_open_line_of_kind` binds a kind to a row with, plus `id` to make it total.
    Two lines that tie on both dates would otherwise each fail to be earlier
    than the other and BOTH would be due — a tie-break is not tidiness here, it
    is the difference between one charge and two.

    `LIMIT 1` and the ORDER BY are ignored inside `EXISTS` and matter in the
    LATERAL join that reports the suppression to a human. One definition serves
    both on purpose: a screen that explained the omission differently from the
    query that made it would send an operator to type the line back in by hand.
    """
    return (
        "SELECT e.id, e.description, e.amount, e.period_start, e.period_end "
        "FROM staging.org_billing_lines e "
        "WHERE e.org_id = l.org_id AND e.kind = l.kind "
        "  AND e.cadence = 'monthly' "
        f"  AND e.period_start <= {period}::date "
        f"  AND (e.period_end IS NULL OR e.period_end >= {period}::date) "
        "  AND (e.period_start, e.created_at, e.id) "
        "    < (l.period_start, l.created_at, l.id) "
        "ORDER BY e.period_start, e.created_at, e.id LIMIT 1"
    )


def _due_in_period(period: str = "$2") -> str:
    """The lines DUE in a period, as one predicate used by every read below.

    A monthly line is due in every period from `period_start` until `period_end`
    INCLUSIVE (NULL = still running), UNLESS an earlier line of the same kind
    already covers that period — see `_covering_line`. A one-off is due in its
    own period and no other, and is never suppressed: two setup fees in one
    month are two integrations, and two top-ups are two payments.

    Written once because `list_lines`' totals, the invoice preview and the
    invoice itself must agree exactly — the moment two of them describe "due"
    differently, the screen showing the operator what they are about to bill
    stops describing what they actually bill. `record_billed` is the third
    reader and was the one missing it.

    TAKES THE PLACEHOLDER because the period is not `$2` in every statement that
    needs this. It was a bare constant, and `record_billed` — whose INSERT
    numbers its parameters differently — is exactly the caller that quietly did
    without it rather than renumber. A predicate that only fits one query shape
    is a predicate the next query will copy instead of call.
    """
    return (
        f"((l.cadence = 'monthly' AND l.period_start <= {period}::date "
        f"     AND (l.period_end IS NULL OR l.period_end >= {period}::date) "
        f"     AND NOT EXISTS ({_covering_line(period)})) "
        f" OR (l.cadence = 'one_off' AND l.period_start = {period}::date))"
    )


#: The default shape, for the reads whose period is `$2`.
_DUE_IN_PERIOD = _due_in_period()

#: A line already billed for this period is not due again. THE NO-DOUBLE-CHARGE
#: RULE, as the query half of `uq_ibl_line_period`.
#:
#: NOT joined to `subscription_invoices.payment_status`, deliberately. The spec
#: describes excluding lines billed on an invoice "whose payment_status <>
#: 'refunded'", but 096 resolves that differently and the index agrees with the
#: resolution: the join table records what is CURRENTLY billed, so voiding or
#: refunding an invoice must DELETE its `invoice_billing_lines` rows in the same
#: transaction as it sets the status. Filtering on the status here as well would
#: make a refunded invoice's lines due again while its join rows still stood,
#: and `uq_ibl_line_period` would then refuse the re-billing with a unique
#: violation. Nothing sets 'refunded' today; this is the note for whoever adds
#: the refund path.
_NOT_YET_BILLED = (
    "NOT EXISTS (SELECT 1 FROM staging.invoice_billing_lines b "
    "             WHERE b.line_id = l.id AND b.period_start = $2::date)"
)


async def list_lines(
    conn, org_id: str, *, period: Any = None, limit: int = 500,
    include_actors: bool = False,
) -> dict:
    """Every billing line an org has, plus what this period totals.

    Serves `GET /v1/billing/orgs/{org_id}/lines` and `GET /v1/billing/me/lines`.

    ── `include_actors` DEFAULTS TO FALSE, AND THE DEFAULT IS THE POINT ─────

    `created_by` and `ended_by` are AEKAM STAFF user ids — this table has no
    tenant writers — and `/v1/billing/me/lines` hands its body straight to the
    client. Both doors of this feature call this one function through the same
    `routers/billing.py:_lines_body`, so a default of True would leak on the
    tenant door until somebody remembered to pass False on it, and the day
    somebody forgets is not a day anybody finds out. Defaulted the safe way
    round, forgetting the flag costs Aekam's own console a column it does not
    render today and costs the client nothing.

    THE CONSOLE MAY ASK FOR THEM — `GET /v1/billing/orgs/{org_id}/lines` is
    `BILLING_CONSOLE_ROLES` only and "who set this price" is a fair question
    there. It is one keyword at that call site in `_lines_body`, which needs to
    know which door it is serving to pass it; until it does, neither door shows
    them and no screen in the product is asking for them.

    Nothing else here is redacted. An org may read its own descriptions,
    amounts, periods and `source_ref` — they are its own commercial terms and
    the whole point of the endpoint.

    ALL the lines, not just this period's, and ended ones included — the billing
    block greys them rather than hiding them, because a support plan that
    stopped in March is the answer to "why did this bill change?" and deleting
    it from the view is how that question becomes unanswerable. The block also
    needs them: it binds each monthly row to the open line of that kind, and it
    counts this month's one-offs to warn before a second setup fee.

    The TOTALS are the period's, and they are the server's arithmetic rather
    than the client's, computed from the same `_DUE_IN_PERIOD` predicate the
    invoice uses. A total summed in the browser is a second opinion about what a
    client owes.

    `monthly_total` — the recurring lines due this period, per month.
    `one_off_total` — the one-off lines falling in this period.
    Both COUNT LINES ALREADY BILLED: this is what the org is charged for the
    period, not what is left to invoice. `lines_due_in_period` answers the
    second question and says so.

    Both also count ONE line per kind per period, never a stopped line and its
    replacement together — `_covering_line` explains why, and the totals have to
    obey it or the block's figure and the invoice's stop agreeing in exactly the
    month somebody restarted a fee. `data` still carries every row, so the
    suppressed one is on the screen; it is not in the total.
    """
    org_id = _uuid(org_id, what="org", exc=UnknownOrg)
    period = _month_start(period) if period is not None else current_period()

    rows = await conn.fetch(
        f"SELECT {_LINE_COLS} FROM staging.org_billing_lines l "
        f"WHERE org_id=$1::uuid "
        # Newest period first, and `created_at` breaks the tie so two lines
        # opened in the same month keep a stable order between reloads.
        f"ORDER BY period_start DESC, created_at DESC "
        f"LIMIT $2",
        org_id, max(1, int(limit)),
    )

    # SIGNED, so a plan-change credit reduces the month rather than swelling it.
    # `_SIGNED_AMOUNT_SQL` is `_signed_amount` in SQL; the two are defined
    # together and neither is safe to change alone. `one_off_total` is the half
    # that can now go NEGATIVE — a downgrade credit of ₹4,000 against ₹1,500 of
    # new charges is a month where Aekam owes the client ₹2,500, and saying so
    # is the point. The screens format it; nothing clamps it to zero.
    totals = await conn.fetchrow(
        "SELECT "
        f"  COALESCE(SUM({_SIGNED_AMOUNT_SQL}) FILTER (WHERE l.cadence='monthly'), 0) AS monthly_total, "
        f"  COALESCE(SUM({_SIGNED_AMOUNT_SQL}) FILTER (WHERE l.cadence='one_off'), 0) AS one_off_total "
        "FROM staging.org_billing_lines l "
        f"WHERE l.org_id=$1::uuid AND {_DUE_IN_PERIOD}",
        org_id, period,
    )

    return {
        "org_id": org_id,
        "period": period.isoformat(),
        "data": [_row_to_line(r, actors=include_actors) for r in rows],
        "monthly_total": float(totals["monthly_total"]),
        "one_off_total": float(totals["one_off_total"]),
    }


async def lines_due_in_period(conn, org_id: str, period: Any) -> dict:
    """The invoice, as a query. Serves
    `GET /v1/billing/orgs/{org_id}/invoice-preview`.

    An invoice stops being a total somebody typed and becomes the lines due in a
    month. Two lists come back and both matter:

      `lines`          — due and NOT yet billed for this period. These are what
                         the invoice builder loads into its rows.
      `already_billed` — due, and on an invoice already. Reported rather than
                         silently omitted: an operator who cannot see why a line
                         is missing types it back in by hand, and that is the
                         double charge arriving through the keyboard instead of
                         through the query.

    Each `already_billed` entry carries the amount THAT INVOICE charged, not the
    line's amount today. The two differ the moment a fee is amended after
    issue, and the number that answers "was this already billed, and for how
    much?" is the one on the invoice.

    A third list comes back with them:

      `superseded`     — standing in this period and NOT due in it, because an
                         earlier line of the same kind already covers it. The
                         same argument as `already_billed`, one step earlier: a
                         support plan stopped and restarted this month shows TWO
                         rows in the billing block and puts ONE on the invoice,
                         and an operator who cannot see which row was dropped,
                         or why, types the other one back in by hand. Each entry
                         names the line that is carrying the month and the month
                         it stops, so the screen can say when this one starts.
    """
    org_id = _uuid(org_id, what="org", exc=UnknownOrg)
    period = _month_start(period)

    due = await conn.fetch(
        f"SELECT {_LINE_COLS} FROM staging.org_billing_lines l "
        f"WHERE l.org_id=$1::uuid AND {_DUE_IN_PERIOD} AND {_NOT_YET_BILLED} "
        # Platform fee first, then the recurring services, then the one-offs and
        # the top-ups — the order the owner listed them, so an invoice reads the
        # same way every month. `credit` is LAST and is named explicitly: an
        # unlisted kind gets NULL from `array_position` and sorts last only
        # because that is the default, which is an ordering nobody chose. A
        # deduction belongs under the charges it reduces.
        f"ORDER BY array_position("
        f"  ARRAY['platform','support','ongoing','setup','topup','credit']::text[], l.kind"
        f"), l.created_at",
        org_id, period,
    )

    billed = await conn.fetch(
        "SELECT l.id AS line_id, l.kind, l.description, "
        "       b.amount AS amount, b.period_start AS period_start, "
        "       i.id AS invoice_id, i.invoice_number, i.payment_status "
        "FROM staging.org_billing_lines l "
        "JOIN staging.invoice_billing_lines b ON b.line_id = l.id "
        "JOIN staging.subscription_invoices i ON i.id = b.invoice_id "
        "WHERE l.org_id=$1::uuid AND b.period_start=$2::date "
        "ORDER BY i.invoice_number, l.created_at",
        org_id, period,
    )

    # The rows the due predicate dropped, each with the row that displaced it.
    # A LATERAL over the SAME `_covering_line` the predicate uses, so the reason
    # given to a person is the reason the line is missing rather than a second
    # opinion about it — one definition of "due", applied to the sentence as
    # well as to the query. A plain JOIN: a line with nothing covering it is not
    # superseded and produces no row.
    superseded = await conn.fetch(
        "SELECT l.id AS line_id, l.kind, l.description, l.amount, "
        "       l.period_start, l.period_end, "
        "       c.id AS covered_by_id, c.description AS covered_by_description, "
        "       c.amount AS covered_by_amount, c.period_end AS covered_by_period_end "
        "FROM staging.org_billing_lines l "
        f"JOIN LATERAL ({_covering_line()}) c ON TRUE "
        "WHERE l.org_id=$1::uuid AND l.cadence='monthly' "
        "  AND l.period_start <= $2::date "
        "  AND (l.period_end IS NULL OR l.period_end >= $2::date) "
        "ORDER BY l.created_at",
        org_id, period,
    )

    lines = [_row_to_line(r) for r in due]
    # The last day of the month the lines are due in, so the invoice builder
    # does not have to re-derive a date this query already knows. Computed from
    # `next_period` rather than from a 28/30/31 table, which is the same reason
    # `credits.next_period` exists.
    month_end = date.fromordinal(next_period(period).toordinal() - 1)
    return {
        "org_id": org_id,
        "period": period.isoformat(),
        "period_start": period.isoformat(),
        "period_end": month_end.isoformat(),
        "lines": lines,
        # SIGNED. The preview's total is what the invoice will come to, and an
        # invoice carrying a ₹4,000 credit against ₹1,500 of charges is ₹-2,500
        # of net billing, not ₹5,500. Summed from `signed_amount`, which
        # `_row_to_line` put on every row from the one rule in `_signed_amount`.
        "total": float(sum(Decimal(str(l["signed_amount"])) for l in lines)) if lines else 0.0,
        "already_billed": [
            {
                "line_id": str(r["line_id"]),
                "kind": r["kind"],
                "description": r["description"],
                "amount": float(r["amount"]),
                "invoice_id": str(r["invoice_id"]),
                "invoice_number": r["invoice_number"],
                "payment_status": r["payment_status"],
            }
            for r in billed
        ],
        "superseded": [
            {
                "line_id": str(r["line_id"]),
                "kind": r["kind"],
                "description": r["description"],
                "amount": float(r["amount"]),
                "period_start": _iso(r["period_start"]),
                "period_end": _iso(r["period_end"]),
                "covered_by_id": str(r["covered_by_id"]),
                "covered_by_description": r["covered_by_description"],
                "covered_by_amount": float(r["covered_by_amount"]),
                # The last month the covering line is billed for, so a screen
                # can say when this one starts. NULL means it is still running,
                # and this row is not due at all while that stays true.
                "covered_by_period_end": _iso(r["covered_by_period_end"]),
            }
            for r in superseded
        ],
    }


def _not_due_detail(rows, period: date) -> str:
    """The not-due refusal, said one line at a time.

    TWO DIFFERENT MISTAKES reach it and they need different sentences, which is
    what the LEFT JOIN in the query above is for. A line whose SPAN does not
    reach the period is a WRONG MONTH — an August invoice raised from a screen
    loaded for July — and nothing covers it. A line that was displaced by an
    earlier line of its kind is not a mistake at all until somebody tries to
    bill both, and the only useful thing to say is which row is carrying the
    month and when this one starts instead.
    """
    said = []
    for r in rows:
        covered = r["covered_by_description"]
        if covered is not None:
            # "the earlier {kind} line" and not the description alone: a fee
            # stopped and restarted carries the SAME description on both rows,
            # and "'Platform fee' is covered by 'Platform fee'" tells an
            # operator nothing about which of the two they are looking at.
            through = r["covered_by_period_end"]
            said.append(
                f"'{r['description']}' starts in "
                f"{_iso(r['period_start'])[:7]} but the earlier {r['kind']} line "
                f"'{covered}' already covers this month"
                + (f", billed through {_iso(through)[:7]} — this one is billable "
                   f"from {next_period(_month_start(through)).isoformat()[:7]}"
                   if through else " and is still running")
            )
        else:
            start, end = r["period_start"], r["period_end"]
            said.append(
                f"'{r['description']}' is billed "
                + (f"in {_iso(start)[:7]} only" if r["cadence"] == "one_off"
                   else f"from {_iso(start)[:7]}"
                        + (f" through {_iso(end)[:7]}" if end else ""))
                + f", not in {period.isoformat()[:7]}"
            )
    return "; ".join(said) + "."


async def record_billed(
    conn, *,
    invoice_id: str,
    org_id: str,
    line_ids: Iterable[str],
    period: Any,
    amounts: Optional[Mapping[str, Any]] = None,
) -> list[dict]:
    """Record which lines an invoice actually billed, and for which period.

    THE OTHER HALF OF THE NO-DOUBLE-CHARGE RULE. Without this call
    `uq_ibl_line_period` — the index 096 itself names "THE NO-DOUBLE-CHARGE
    RULE" — guards an empty table, `already_billed` is forever `[]`, and
    pressing "Load lines" for August twice raises the platform fee twice with
    nothing on the second invoice showing that it duplicates the first.

    FOR `routers/subscription.py:create_invoice`, which receives `line_ids` from
    the invoice builder and must call this INSIDE the transaction that inserts
    the invoice. Written here rather than there because the join table is the
    other end of a table this module owns, and a second writer of a
    no-double-charge invariant is how the invariant stops holding.

    Refuses — it does not skip — a line that is already billed for this period.
    Skipping would leave the line on the invoice's `line_items` (the client is
    charged) but absent from the join table (the system thinks it is unbilled),
    which is the double charge with the evidence removed. The refusal names the
    invoice the line is already on.

    ── AND REFUSES A LINE THAT WAS NEVER DUE IN THIS PERIOD ────────────────

    `_DUE_IN_PERIOD` decides what an invoice may offer to bill, and until now it
    did not decide what an invoice may RECORD as billed. Nothing else did
    either: the INSERT below matched on `id` and `org_id` alone, so a line id
    that reached this function by any route other than that month's preview —
    a stale builder tab loaded for July and submitted against August, a caller
    zipping two lists that had drifted apart, the successor of a line that
    already covers this month — was booked against a period it was never due in.
    The consequences outlive the mistake: `uq_ibl_line_period` then treats that
    period as settled, so the line the client SHOULD have been billed for is
    marked billed by a document that charged something else, and the preview
    stops offering it from then on. A wrong booking here is not a wrong row, it
    is a charge quietly forgiven or quietly doubled.

    The predicate is applied here rather than trusted to the caller for the
    reason this module exists at all — the invariant lives with the table.

    ── `amounts`: WHAT THE INVOICE CHARGED, WHICH IS NOT ALWAYS THE LINE ───

    096 says `invoice_billing_lines.amount` is "denormalised from the line AT
    ISSUE TIME … what the client was charged may not change". Copying `l.amount`
    delivers that ONLY while the invoice says what the line says, and
    `InvoiceBuilder.jsx` lets an operator edit a loaded row before pressing
    Create — and folds `qty` into the amount, so a loaded line billed twice in a
    month disagrees without anybody typing a rupee figure at all. Then the
    document says ₹18,000 and the join row says ₹9,000, and the row that exists
    to prove what was charged is the one that is wrong.

    WHICH IS AUTHORITATIVE: THE INVOICE. `line_items` and `total_amount` are
    what the client reads and pays; the line is a standing term that the invoice
    quotes. So the join row follows the invoice, and `amounts` is how the caller
    says what it actually charged — `{line_id: amount}`, the SAME figure that
    went into that line's `line_items` entry, qty already folded in.

    SUPPLIED BY `routers/subscription.py:create_invoice`, and the two edits that
    made it possible are worth naming because the gap was open for a round.
    `POST /v1/admin/invoices` receives `line_items` and `line_ids` as two lists
    with nothing joining them — a hand-typed row has no line id, so they are not
    even the same length — so the id had to travel WITH the amount rather than
    beside it. `InvoiceBuilder.jsx` now carries `line_id` on each `line_items`
    entry it loaded, and `create_invoice` builds `{item["line_id"]:
    item["amount"]}` from that one list. Two parallel lists of different lengths
    cannot be paired without guessing, and guessing here mis-states what a client
    was charged.

    STILL OPTIONAL, and the fallback is not a leftover. A caller that says
    nothing about a line gets the line's own amount, which is exactly right for
    an unedited row and is what every hand-typed invoice needs.

    An amount supplied for an id that is not being billed is ignored rather than
    refused: the caller assembling the mapping is the caller filtering the ids,
    and making it an error would turn a harmless superset into a failed invoice.

    Returns one dict per recorded line, so the caller can log what it billed.
    """
    invoice_id = _uuid(invoice_id, what="invoice", exc=UnknownLine)
    org_id = _uuid(org_id, what="org", exc=UnknownOrg)
    period = _month_start(period)
    ids = [_uuid(x, what="line", exc=UnknownLine) for x in (line_ids or [])]
    if not ids:
        return []
    # An id sent twice in one request is one line, not two, and would raise a
    # unique violation against itself.
    ids = list(dict.fromkeys(ids))

    # Through `_money` like every other rupee figure in this file: the invoice
    # is authoritative about what was charged, not about what NUMERIC(12,2) can
    # hold, and a 22003 from the driver inside the caller's transaction takes
    # the invoice down with a message that names no column.
    #
    # SIGNED HERE, AND THE SIGN MUST AGREE WITH THE KIND.
    # `invoice_billing_lines.amount` has no `>= 0` CHECK — deliberately, since
    # 096 — because it records what a document charged, and a document that
    # credits ₹4,000 charged −4,000. But a sign that contradicts the line it is
    # booked against is the two halves disagreeing again in the other direction:
    # a `credit` recorded as a positive charge bills the refund, and a `support`
    # line recorded negative forgives a fee nobody approved. Neither is
    # normalised silently — the caller is told which line and which way.
    kinds: dict[str, str] = {}
    if amounts:
        kinds = {
            str(r["id"]): r["kind"]
            for r in await conn.fetch(
                "SELECT id, kind FROM staging.org_billing_lines "
                "WHERE id = ANY($1::uuid[]) AND org_id = $2::uuid",
                ids, org_id,
            )
        }

    charged: list[Optional[Decimal]] = [None] * len(ids)
    if amounts:
        at = {line_id: i for i, line_id in enumerate(ids)}
        for key, value in amounts.items():
            line_id = _uuid(key, what="line", exc=UnknownLine)
            i = at.get(line_id)
            if i is None:
                continue
            amount = _money(value, field="amount", signed=True)
            kind = kinds.get(line_id)
            if kind == CREDIT_KIND and amount > 0:
                raise InvalidLine(
                    f"line {line_id} is a credit, so the invoice must record it "
                    f"as a deduction — {amount} is a charge. Nothing was "
                    f"recorded and no invoice was raised.",
                    field="amount", amount=float(amount), line_id=line_id,
                )
            if kind is not None and kind != CREDIT_KIND and amount < 0:
                raise InvalidLine(
                    f"line {line_id} is a {kind} charge and cannot be recorded "
                    f"as {amount}. A charge to be reversed is a credit line, "
                    f"not a negative one. Nothing was recorded and no invoice "
                    f"was raised.",
                    field="amount", amount=float(amount), line_id=line_id,
                )
            charged[i] = amount

    # WHAT THIS INVOICE MAY BOOK AGAINST THIS MONTH, asked before anything is
    # written and asked the same way the preview asks it. `$2` is the period, so
    # `_DUE_IN_PERIOD` fits as it stands.
    #
    # A SEPARATE STATEMENT rather than a WHERE clause on the INSERT below, for
    # the reason the clash check gives one line further down: every filter on an
    # INSERT … SELECT silently drops rows, and a line dropped there would leave
    # the charge on the invoice's `line_items` with nothing recording it. The
    # count check at the end would catch that as "does not belong to this
    # organisation", which is a true refusal to the wrong question.
    # LEFT JOIN, unlike the preview's: a line that is not due for the ordinary
    # reason — the wrong month — has nothing covering it, and the refusal has to
    # be able to tell that apart from a line the month simply does not belong to.
    not_due = await conn.fetch(
        "SELECT l.id, l.kind, l.description, l.cadence, "
        "       l.period_start, l.period_end, "
        "       c.description AS covered_by_description, "
        "       c.period_end AS covered_by_period_end "
        "FROM staging.org_billing_lines l "
        f"LEFT JOIN LATERAL ({_covering_line()}) c ON TRUE "
        "WHERE l.id = ANY($1::uuid[]) AND l.org_id = $3::uuid "
        f"  AND NOT {_DUE_IN_PERIOD}",
        ids, period, org_id,
    )
    if not_due:
        raise LineConflict(
            f"{len(not_due)} of the lines on this invoice are not due in "
            f"{period.isoformat()[:7]}: {_not_due_detail(not_due, period)} "
            f"Nothing was recorded and no invoice was raised. Load the lines for "
            f"the month you are billing and raise it from those.",
            org_id=org_id, period=period.isoformat(),
            lines=[{"line_id": str(r["id"]), "description": r["description"]}
                   for r in not_due],
        )

    # Checked BEFORE the INSERT, not caught after it. A 23505 raised inside the
    # caller's transaction leaves that transaction unusable, so the query needed
    # to name the offending invoice could not be run — and a refusal that cannot
    # say what is held is exactly what the money rules forbid.
    clash = await conn.fetch(
        "SELECT b.line_id, l.description, i.invoice_number "
        "FROM staging.invoice_billing_lines b "
        "JOIN staging.org_billing_lines l ON l.id = b.line_id "
        "JOIN staging.subscription_invoices i ON i.id = b.invoice_id "
        "WHERE b.line_id = ANY($1::uuid[]) AND b.period_start = $2::date",
        ids, period,
    )
    if clash:
        named = ", ".join(
            f"'{r['description']}' is already on {r['invoice_number']}" for r in clash
        )
        raise LineAlreadyBilled(
            f"{len(clash)} of these lines were already billed for "
            f"{period.isoformat()[:7]}: {named}. Raising them again would charge "
            f"the client twice. Remove them from this invoice, or credit the "
            f"one they are on.",
            period=period.isoformat(),
            lines=[{"line_id": str(r["line_id"]),
                    "invoice_number": r["invoice_number"]} for r in clash],
        )

    rows = await conn.fetch(
        "INSERT INTO staging.invoice_billing_lines "
        "(invoice_id, line_id, period_start, amount) "
        # WHAT THE CLIENT WAS CHARGED, frozen AT ISSUE TIME. The invoice's own
        # figure when the caller supplies one, the line's when it does not —
        # see `amounts` above for which is authoritative and why the fallback
        # is not the same answer. The line may be re-priced tomorrow either way;
        # this row may not change.
        #
        # THE FALLBACK IS SIGNED. `l.amount` is a magnitude, so falling back to
        # it bare would record a credit as a positive charge — the line that
        # exists to reduce the bill recorded as having increased it, on the row
        # that proves what was billed. `_SIGNED_AMOUNT_SQL` is the same rule the
        # totals and the preview use.
        f"SELECT $1::uuid, l.id, $3::date, COALESCE(v.amount, {_SIGNED_AMOUNT_SQL}) "
        "FROM staging.org_billing_lines l "
        # The two arrays are positional halves of one list: `charged[i]` is the
        # amount for `ids[i]`, NULL where the caller said nothing. LEFT, and the
        # id array still drives the WHERE, so the override is a lookup and never
        # a filter — a join that could drop a line here would silently unbill it.
        "LEFT JOIN unnest($2::uuid[], $5::numeric[]) AS v(line_id, amount) "
        "  ON v.line_id = l.id "
        "WHERE l.id = ANY($2::uuid[]) AND l.org_id = $4::uuid "
        "RETURNING line_id, period_start, amount",
        invoice_id, ids, period, org_id, charged,
    )

    if len(rows) != len(ids):
        # An id that is not this org's line, or not a line at all. The INSERT …
        # SELECT would silently write fewer rows and the invoice would carry a
        # charge nothing recorded — so it is refused, and the transaction the
        # caller opened takes the invoice down with it.
        missing = sorted(set(ids) - {str(r["line_id"]) for r in rows})
        raise UnknownLine(
            f"{len(missing)} of the lines on this invoice do not belong to "
            f"organisation {org_id}: {', '.join(missing)}. Nothing was recorded.",
            org_id=org_id, line_ids=missing,
        )

    return [
        {
            "line_id": str(r["line_id"]),
            "period_start": _iso(r["period_start"]),
            "amount": float(r["amount"]),
        }
        for r in rows
    ]
