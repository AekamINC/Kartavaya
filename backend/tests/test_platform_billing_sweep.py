"""The upstream invoice sweep — the four ways an unattended biller goes wrong.

`services/platform_billing.py::sweep_platform_invoices` writes real invoice
documents against real organisations, from a cron, with numbers drawn from
Aekam's live `KSUB-` series. There is no staging database to be wrong in
(CLAUDE.md). So the tests here are aimed at the four failures that have actually
happened to this product's other billing code, not at the arithmetic:

 1. **A monthly line invoiced exactly once, for ever.** The downstream sweep
    recomputed the period from the line's ORIGIN instead of advancing from the
    last invoiced period. The first run billed it; every run after reported
    "skipped", which is also what it says about a line that is not due yet.

 2. **A cron minting FINAL documents.** `/cron/billing` raised two finished tax
    invoices against Unicode Group with serials from that firm's live series
    (PROGRESS.md 2026-08-27), because `doc_status` defaults to 'final' and the
    INSERT omitted it.

 3. **The owner billed for the platform he owns.**

 4. **A test that passes over a disabled feature.** `auto_invoice` is FALSE on
    every line in the database, so almost any assertion about this sweep is
    green by default. Every test below carries an anti-vacuity assertion that
    fails if the thing it is measuring is empty for the wrong reason — this repo
    has a documented history of exactly that (see
    `static_ratchets_are_not_coverage`), including seven assertions in one day
    that were satisfied by the shape of their own fixtures.

── ⚠ WHY THIS FILE WAS REWRITTEN, AND WHAT WAS WRONG WITH IT ────────────────

The first version tested the four pure helpers well and then asserted the ENTIRE
money-writing path by reading `platform_billing.py` as TEXT and looking for
substrings. `sweep_platform_invoices`, `_sweep_one_org`, `_raise_invoice` and
`_allocate_invoice_number` were never once CALLED. Seven mutations of them all
survived a full green run:

    _sweep_one_org -> return None             the feature switched off entirely
    gst = Decimal(0)                          every invoice GST-free
    delete `async with conn.transaction():`   a refused line leaves a charge
    reorder the $7..$10 bindings              doc_status gets a JSON blob
    break the KSUB serial regex               every number restarts at 0001
    subtotal <= 0  ->  subtotal < 0           a zero-value invoice is issued
    NOT o.is_platform_org OR TRUE             the owner is billed

A substring assertion passes over a commented-out call, a renamed symbol and an
`if False:` guard. It cannot see any of the seven. The five live-database probes
could not see them either: they SKIP without a `DATABASE_URL`, so on a developer
machine and in CI they had never executed at all.

── THE HARNESS: A SMALL DATABASE, NOT A MOCK THAT AGREES WITH YOU ──────────

`conftest.py` hands every module a MagicMock pool, and a MagicMock answers
happily to any statement — a test that drives the sweep with one and reads back
`{"created": 1}` has proved that the mock returned what the test told it to.
`tests/test_client_billing_invoices.py` solved this for the DOWNSTREAM twin with
a `CapturePool` that records statements and answers from a script; this file
copies its shape and takes it one step further, because three of the seven
mutations are only visible if somebody actually EVALUATES the statement:

  · `FakeDatabase` runs `_ARMED_LINES` — unaltered but for `$1::uuid` -> `:org`
    — through an in-memory **sqlite** database seeded with organisations and
    billing lines. The joins, `NOT o.is_platform_org`, `is_active IS NOT FALSE`,
    `auto_invoice = TRUE` and the correlated `MAX(period_start)` are executed
    rather than read, so relaxing any of them changes what comes back.

  · The two `INSERT … VALUES` statements are PARSED — column list against value
    list, `$n` resolved against the arguments actually bound — and stored as a
    row. A renumbered placeholder puts the wrong value under the wrong column
    here exactly as it would in Postgres, and every assertion is about the
    contents of that row rather than about the text of the statement.

  · `_allocate_invoice_number`'s `SUBSTRING(invoice_number FROM '…')` is
    evaluated with the pattern taken OUT OF THE STATEMENT and applied with
    Python's `re`, and its `LIKE 'KSUB-' || $1 || '-%'` filter is applied too.
    Break either half and the sweep mints a number that has already been issued.

  · `conn.transaction()` takes a snapshot and puts it back when the block exits
    on an exception, so "the invoice and its join rows stand or fall together"
    is something a test can watch happen rather than assert about.

WHAT THE HARNESS DOES NOT DO, said plainly so nobody reads more into a green run
than is there. `billing_lines.lines_due_in_period` and the three reads inside
`billing_lines.record_billed` are answered from an in-memory ledger by
hand-written handlers: span, cadence and not-yet-billed, but NOT `_covering_line`
suppression, which is `billing_lines`' own rule and is tested against the real
predicate in `tests/test_billing_lines.py`. `record_billed`'s own Python — the
sign check, the not-due refusal, the already-billed refusal and the row-count
check — runs for real. And sqlite is not Postgres: the live probes at the bottom
of this file are what prove `_ARMED_LINES` resolves against the real schema, and
nothing here replaces them.
"""
import json
import logging
import re
import sqlite3
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from services.platform_billing import (
    _ARMED_LINES, _DRAFT, _GST_RATE, _INVOICE_SEQ_LOCK_NS,
    _MAX_BACKLOG_MONTHS, _candidate_periods, _charge_for, _first_period,
    _last_billable, _next_unbilled, sweep_platform_invoices,
)

_BACKEND = Path(__file__).resolve().parents[1]


def line(**over):
    """One `org_billing_lines` row, with the live shape as the default.

    Defaults copied from the real rows (Unicode Group, ₹12,000/month platform
    fee, monthly, advance, open, unarmed floor) so a test that forgets to
    override something gets a REAL case rather than a convenient one.
    """
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "org_id": "22222222-2222-2222-2222-222222222222",
        "kind": "platform",
        "description": "Platform fee",
        "amount": Decimal("12000.00"),
        "currency": "INR",
        "cadence": "monthly",
        "period_start": date(2026, 9, 1),
        "period_end": None,
        "invoice_from": None,
        "billing_direction": "advance",
        "org_name": "Unicode Group",
        "last_billed": None,
    }
    base.update(over)
    return base


# ══════════════════════════════════════════════════════════════════════════════
#  THE HARNESS — a small database the sweep can be driven against
# ══════════════════════════════════════════════════════════════════════════════

# Real uuids, because `billing_lines._uuid` refuses anything else with a 404
# rather than letting `$1::uuid` raise a DataError. An id that is not a uuid
# would fail in the fixture instead of in the thing under test.
CUSTOMER_ORG = "11111111-1111-4111-8111-111111111111"
PLATFORM_ORG = "22222222-2222-4222-8222-222222222222"
SECOND_ORG = "33333333-3333-4333-8333-333333333333"

PLATFORM_LINE = "aaaaaaaa-0000-4000-8000-000000000001"
SUPPORT_LINE = "aaaaaaaa-0000-4000-8000-000000000002"
CREDIT_LINE = "aaaaaaaa-0000-4000-8000-000000000003"
SECOND_LINE = "aaaaaaaa-0000-4000-8000-000000000004"

#: Mid-month, so an `advance` line's period is the month in progress and a run
#: is the one a daily cron would make on an ordinary morning.
TODAY = date(2026, 9, 15)


class Refused(Exception):
    """What the fake database says when a statement breaks a constraint.

    A plain Exception on purpose: `sweep_platform_invoices` catches `Exception`
    per organisation, so a refusal reaches `failed` by the same route a real
    asyncpg error would.
    """


_SCHEMA = """
CREATE TABLE public.organisations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_platform_org INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER
);
CREATE TABLE public.org_billing_lines (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    amount TEXT NOT NULL,
    currency TEXT NOT NULL,
    cadence TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT,
    invoice_from TEXT,
    billing_direction TEXT NOT NULL,
    auto_invoice INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE public.invoice_billing_lines (
    invoice_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    amount TEXT NOT NULL
);
"""

#: Columns the sweep reads as dates. sqlite hands back the TEXT it stored and
#: `_next_unbilled` / `_charge_for` do date arithmetic on them.
_DATE_COLUMNS = {"period_start", "period_end", "invoice_from", "last_billed"}


def _adapt(row: dict) -> dict:
    """A sqlite row in the types asyncpg would have returned."""
    out = {}
    for key, value in row.items():
        if key in _DATE_COLUMNS and isinstance(value, str):
            value = date.fromisoformat(value)
        elif key == "amount" and value is not None:
            value = Decimal(str(value))
        out[key] = value
    return out


def _iso(value):
    return value.isoformat() if isinstance(value, date) else value


def _split_top_level(text: str) -> list:
    """Split on commas that are not inside parentheses."""
    out, depth, current = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    out.append("".join(current).strip())
    return out


_INSERT_RE = re.compile(
    r"INSERT INTO ([\w.]+)\s*\((.*?)\)\s*VALUES\s*\((.*)\)\s*$", re.S)


def _parse_insert(sql: str, args: tuple):
    """An `INSERT … VALUES` as the row it writes.

    ⚠ THE POINT OF PARSING RATHER THAN PATTERN-MATCHING. The column list and the
    value list are paired POSITIONALLY, exactly as Postgres pairs them, and each
    `$n` is resolved against the arguments actually bound. So an INSERT whose
    placeholders were renumbered by hand — the single likeliest edit to make to a
    fourteen-column statement — puts the wrong value under the wrong column name
    here, and every assertion about that row sees it.
    """
    m = _INSERT_RE.match(sql.strip())
    assert m, "the fake database could not read this INSERT:\n" + sql
    table = m.group(1)
    columns = _split_top_level(m.group(2))
    values = _split_top_level(m.group(3))
    assert len(columns) == len(values), (
        f"{table}: {len(columns)} columns but {len(values)} values — this "
        f"statement cannot execute against any database"
    )

    row, highest = {}, 0
    for column, token in zip(columns, values):
        base = token.split("::")[0].strip()
        if base.startswith("$"):
            index = int(base[1:])
            assert 1 <= index <= len(args), (
                f"{table} binds {base} but only {len(args)} arguments were "
                f"passed — an off-by-one in the placeholder numbering"
            )
            highest = max(highest, index)
            row[column] = args[index - 1]
        elif base.upper() == "NULL":
            row[column] = None
        elif base.startswith("'") and base.endswith("'"):
            row[column] = base[1:-1]
        else:
            raise AssertionError(
                f"the fake database cannot evaluate {token!r} in {table}")
    assert highest == len(args), (
        f"{table} was passed {len(args)} arguments but binds only ${highest} — "
        f"one of them is being dropped on the floor"
    )
    return table, row


_SUBSTRING_RE = re.compile(r"SUBSTRING\(invoice_number FROM\s*'([^']*)'\)")
_LIKE_RE = re.compile(
    r"invoice_number LIKE '([^']*)'\s*\|\|\s*\$(\d+)\s*\|\|\s*'([^']*)'")


def _like_to_regex(pattern: str):
    parts = []
    for ch in pattern:
        parts.append(".*" if ch == "%" else "." if ch == "_" else re.escape(ch))
    return re.compile("^" + "".join(parts) + "$")


class FakeDatabase:
    """The one database this sweep writes to, small enough to hold in a test.

    Serves as BOTH the pool and the connection, the way `CapturePool` does in
    `tests/test_client_billing_invoices.py`: `acquire()` returns self, so a
    statement issued through the pool and one issued through a connection land
    in the same ledger and the same statement log.

    It holds no socket. Nothing reached through it can touch the shared
    production database (CLAUDE.md: "there is nowhere to be wrong").
    """

    def __init__(self):
        self.sql = sqlite3.connect(":memory:", isolation_level=None)
        self.sql.execute("ATTACH DATABASE ':memory:' AS public")
        self.sql.executescript(_SCHEMA)
        self.sql.row_factory = sqlite3.Row

        self.lines = {}
        self.orgs = {}
        self.invoices = []
        self.events = []
        self.ledger = []

        #: Every statement, with the transaction depth it was issued at.
        self.log = []
        self.depth = 0
        self._snapshot = None
        self._seq = 0

        #: Makes the due-lines query offer a line that is ALREADY billed for the
        #: period. The real query never does — but `record_billed` refuses
        #: rather than skips precisely because something upstream might, and
        #: that refusal has to take the invoice down with it. This is how that
        #: path is reached without editing the module under test.
        self.offer_already_billed = False

        #: A sentence, and the join-table INSERT refuses with it. `uq_ibl_line_period`
        #: is a real unique index and the console allocates from the same series
        #: this sweep does, so a second writer getting there first is the ordinary
        #: way this fails. It is the only thing in this harness that can fail
        #: AFTER the invoice row is written, and "after" is the whole of what
        #: `async with conn.transaction():` is for.
        self.refuse_recording = None

    # ── seeding ──────────────────────────────────────────────────────────

    def org(self, org_id, name, *, platform=False, active=True):
        self.orgs[org_id] = {"id": org_id, "name": name,
                             "is_platform_org": platform, "is_active": active}
        self.sql.execute(
            "INSERT INTO public.organisations VALUES (?,?,?,?)",
            (org_id, name, 1 if platform else 0,
             None if active is None else (1 if active else 0)))
        return org_id

    def line(self, line_id, org_id, **over):
        self._seq += 1
        row = {
            "id": line_id,
            "org_id": org_id,
            "kind": "platform",
            "description": "Platform fee",
            "amount": Decimal("12000.00"),
            "currency": "INR",
            "cadence": "monthly",
            "period_start": date(2026, 9, 1),
            "period_end": None,
            "invoice_from": None,
            "billing_direction": "advance",
            "auto_invoice": True,
            "source_ref": None,
            "created_by": None,
            "ended_by": None,
            "created_at": date(2026, 1, 1),
            "updated_at": date(2026, 1, 1),
            "_seq": self._seq,
        }
        row.update(over)
        self.lines[line_id] = row
        self.sql.execute(
            "INSERT INTO public.org_billing_lines "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["id"], row["org_id"], row["kind"], row["description"],
             str(row["amount"]), row["currency"], row["cadence"],
             _iso(row["period_start"]), _iso(row["period_end"]),
             _iso(row["invoice_from"]), row["billing_direction"],
             1 if row["auto_invoice"] else 0, "%04d" % row["_seq"]))
        return line_id

    def invoice(self, invoice_number, **over):
        """A document raised by something other than this sweep — the console."""
        row = {"id": invoice_number, "org_id": CUSTOMER_ORG,
               "invoice_number": invoice_number, "doc_status": "final"}
        row.update(over)
        self.invoices.append(row)
        return row

    def bill(self, line_id, period, *, invoice_number="KSUB-202608-0001",
             amount=Decimal("12000.00")):
        """A join row: this line is already billed for this period."""
        self.ledger.append({"invoice_id": invoice_number, "line_id": line_id,
                            "period_start": period, "amount": amount})

    # ── the asyncpg surface ──────────────────────────────────────────────

    async def fetch(self, sql, *args):
        return self._run(sql, args)

    async def fetchrow(self, sql, *args):
        rows = self._run(sql, args)
        return rows[0] if isinstance(rows, list) and rows else None

    async def fetchval(self, sql, *args):
        return self._run(sql, args)

    async def execute(self, sql, *args):
        return self._run(sql, args)

    def acquire(self):
        return _Acquired(self)

    def transaction(self, **kw):
        return _Transaction(self)

    # ── what the tests read back ─────────────────────────────────────────

    def statements(self, needle):
        return [entry for entry in self.log if needle in entry["sql"]]

    def one(self, needle):
        hits = self.statements(needle)
        assert len(hits) == 1, (
            f"expected exactly one statement containing {needle!r}, "
            f"found {len(hits)}")
        return hits[0]

    def billed_lines(self, invoice_number):
        return [r for r in self.ledger if r["invoice_id"] == invoice_number]

    # ── dispatch ─────────────────────────────────────────────────────────

    def _run(self, sql, args):
        # The RESULT is kept beside the statement, not just the statement. A
        # test that wants to know the sweep ignored something has to be able to
        # see that the database offered it — otherwise "it was not billed" and
        # "it was never returned" are the same green.
        entry = {"sql": sql, "args": args, "depth": self.depth}
        self.log.append(entry)
        for needle, handler in self._routes:
            if needle in sql:
                entry["result"] = handler(sql, args)
                return entry["result"]
        raise AssertionError(
            "the fake database was handed a statement it does not know. Add a "
            "handler, or this test is measuring nothing:\n" + sql)

    @property
    def _routes(self):
        return (
            # platform_billing's own four statements
            ("JOIN public.organisations o ON o.id = l.org_id", self._armed),
            ("pg_advisory_xact_lock", self._lock),
            ("COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM", self._serial),
            ("INSERT INTO public.subscription_invoices", self._new_invoice),
            ("INSERT INTO public.subscription_events", self._new_event),
            # billing_lines.lines_due_in_period
            ("ORDER BY array_position(", self._due),
            ("i.payment_status", self._already_billed_rows),
            ("covered_by_id", self._superseded),
            # billing_lines.record_billed
            ("SELECT id, kind FROM public.org_billing_lines ", self._kinds),
            ("LEFT JOIN LATERAL", self._not_due),
            ("SELECT b.line_id, l.description, i.invoice_number ", self._clash),
            ("INSERT INTO public.invoice_billing_lines ", self._record),
        )

    # ── platform_billing's statements ────────────────────────────────────

    def _armed(self, sql, args):
        """`_ARMED_LINES`, EXECUTED — the predicates decide the answer.

        The only edit is the parameter syntax: asyncpg's `$1::uuid` for
        sqlite's `:org`. Every join and every filter is the module's own text,
        so relaxing one of them changes the rows this returns.
        """
        self._sync_ledger()
        translated = sql.replace("$1::uuid", ":org")
        assert "$" not in translated, (
            "the sweep's population query carries a placeholder this harness "
            "cannot bind — the test would be measuring nothing:\n" + translated)
        rows = self.sql.execute(translated, {"org": args[0]}).fetchall()
        return [_adapt(dict(r)) for r in rows]

    def _sync_ledger(self):
        """Push the in-memory join rows into sqlite.

        `_ARMED_LINES` reads `MAX(invoice_billing_lines.period_start)` as
        `last_billed`, and that column is the whole of decision 1 — where a line
        has GOT TO. It has to reflect what earlier runs in the same test
        actually recorded, or "running it twice" proves nothing.
        """
        self.sql.execute("DELETE FROM public.invoice_billing_lines")
        for row in self.ledger:
            self.sql.execute(
                "INSERT INTO public.invoice_billing_lines VALUES (?,?,?,?)",
                (row["invoice_id"], row["line_id"],
                 _iso(row["period_start"]), str(row["amount"])))

    def _lock(self, sql, args):
        return "SELECT 1"

    def _serial(self, sql, args):
        """`_allocate_invoice_number`'s MAX-plus-one, evaluated.

        The pattern is taken OUT OF THE STATEMENT and applied with `re`, and the
        `LIKE` prefix is applied too, so both halves of the allocator are live:
        a pattern that stops matching answers 1, and so does a prefix that stops
        selecting the month's own documents.
        """
        pattern = _SUBSTRING_RE.search(sql)
        assert pattern, "no SUBSTRING pattern to evaluate in:\n" + sql
        like = _LIKE_RE.search(sql)
        assert like, "no LIKE filter to evaluate in:\n" + sql
        wanted = _like_to_regex(
            like.group(1) + str(args[int(like.group(2)) - 1]) + like.group(3))

        matcher = re.compile(pattern.group(1))
        best = 0
        for invoice in self.invoices:
            number = invoice["invoice_number"]
            if not wanted.match(number):
                continue
            found = matcher.search(number)
            if found is None:
                continue          # SUBSTRING -> NULL, and MAX ignores nulls
            captured = found.group(1) if matcher.groups else found.group(0)
            if not captured.isdigit():
                raise Refused(
                    f"invalid input syntax for type integer: {captured!r}")
            best = max(best, int(captured))
        return best + 1

    def _new_invoice(self, sql, args):
        table, row = _parse_insert(sql, args)
        assert table == "public.subscription_invoices"
        if any(i["invoice_number"] == row["invoice_number"]
               for i in self.invoices):
            raise Refused(
                "duplicate key value violates unique constraint "
                "\"subscription_invoices_invoice_number_key\": "
                + str(row["invoice_number"]))
        self.invoices.append(row)
        return "INSERT 0 1"

    def _new_event(self, sql, args):
        table, row = _parse_insert(sql, args)
        assert table == "public.subscription_events"
        self.events.append(row)
        return "INSERT 0 1"

    # ── billing_lines.lines_due_in_period ────────────────────────────────

    def _in_span(self, row, period):
        if row["period_start"] > period:
            return False
        if row["period_end"] is not None and row["period_end"] < period:
            return False
        if row["cadence"] == "one_off" and period != row["period_start"]:
            return False
        return True

    def _is_billed(self, line_id, period):
        return any(r["line_id"] == line_id and r["period_start"] == period
                   for r in self.ledger)

    def _due(self, sql, args):
        """Which of this org's lines are due in this period and not yet billed.

        ⚠ A STAND-IN, and the module docstring says what it leaves out:
        `_covering_line` suppression is `billing_lines`' own rule and is tested
        against the real predicate in `tests/test_billing_lines.py`. What this
        has to get right is the part `_sweep_one_org` depends on — that a line
        already billed for a period stops being offered — because that is the
        double-billing guard.
        """
        org, period = args[0], args[1]
        out = []
        for row in sorted(self.lines.values(), key=lambda r: r["_seq"]):
            if row["org_id"] != org or not self._in_span(row, period):
                continue
            if not self.offer_already_billed and self._is_billed(row["id"], period):
                continue
            out.append({k: v for k, v in row.items() if not k.startswith("_")})
        return out

    def _already_billed_rows(self, sql, args):
        org, period = args[0], args[1]
        return [
            {"line_id": r["line_id"], "kind": self.lines[r["line_id"]]["kind"],
             "description": self.lines[r["line_id"]]["description"],
             "amount": r["amount"], "period_start": r["period_start"],
             "invoice_id": r["invoice_id"], "invoice_number": r["invoice_id"],
             "payment_status": "pending"}
            for r in self.ledger
            if r["period_start"] == period
            and self.lines[r["line_id"]]["org_id"] == org
        ]

    def _superseded(self, sql, args):
        return []

    # ── billing_lines.record_billed ──────────────────────────────────────

    def _kinds(self, sql, args):
        ids, org = args[0], args[1]
        return [{"id": i, "kind": self.lines[i]["kind"]} for i in ids
                if i in self.lines and self.lines[i]["org_id"] == org]

    def _not_due(self, sql, args):
        ids, period, org = args[0], args[1], args[2]
        return [
            {"id": i, "kind": self.lines[i]["kind"],
             "description": self.lines[i]["description"],
             "cadence": self.lines[i]["cadence"],
             "period_start": self.lines[i]["period_start"],
             "period_end": self.lines[i]["period_end"],
             "covered_by_description": None, "covered_by_period_end": None}
            for i in ids
            if i in self.lines and self.lines[i]["org_id"] == org
            and not self._in_span(self.lines[i], period)
        ]

    def _clash(self, sql, args):
        ids, period = args[0], args[1]
        return [
            {"line_id": r["line_id"],
             "description": self.lines[r["line_id"]]["description"],
             "invoice_number": r["invoice_id"]}
            for r in self.ledger
            if r["line_id"] in ids and r["period_start"] == period
        ]

    def _record(self, sql, args):
        invoice_id, ids, period, org, charged = args[:5]
        if self.refuse_recording:
            raise Refused(self.refuse_recording)
        rows = []
        for index, line_id in enumerate(ids):
            row = self.lines.get(line_id)
            if row is None or row["org_id"] != org:
                continue          # record_billed's own row-count check catches it
            if self._is_billed(line_id, period):
                # `uq_ibl_line_period` — 096 calls it "the no-double-charge rule,
                # as an index rather than as a code path", so the fake carries it
                # as an index too. Reached only if the checks above it were
                # removed; a backstop, not the guard.
                raise Refused(
                    "duplicate key value violates unique constraint "
                    f"\"uq_ibl_line_period\": {line_id} {period}")
            amount = charged[index]
            if amount is None:
                amount = (-row["amount"] if row["kind"] == "credit"
                          else row["amount"])
            entry = {"invoice_id": self._number_of(invoice_id),
                     "line_id": line_id, "period_start": period,
                     "amount": Decimal(str(amount))}
            self.ledger.append(entry)
            rows.append(entry)
        return rows

    def _number_of(self, invoice_id):
        """The join row is keyed on the invoice id; tests read it by number."""
        for invoice in self.invoices:
            if invoice.get("id") == invoice_id:
                return invoice["invoice_number"]
        return invoice_id

    # ── transactions ─────────────────────────────────────────────────────

    def _capture(self):
        return (list(self.invoices), list(self.events), list(self.ledger))

    def _restore(self, snapshot):
        self.invoices, self.events, self.ledger = [list(x) for x in snapshot]


class _Acquired:
    """`pool.acquire()` — the connection out of a pool IS this database."""

    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *exc):
        return False


class _Transaction:
    """`conn.transaction()`, with the one behaviour that matters: a block that
    exits on an exception leaves nothing behind."""

    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        self.db.depth += 1
        if self.db.depth == 1:
            self.db._snapshot = self.db._capture()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self.db.depth -= 1
        if self.db.depth == 0 and exc_type is not None:
            self.db._restore(self.db._snapshot)
        return False


@pytest.fixture
def fake_db(monkeypatch):
    """Install a `FakeDatabase` as `db._pool`.

    `get_pool()` short-circuits on `if _pool is not None`, so every
    `await get_pool()` in the module under test gets this and nothing else —
    the same mechanism `tests/test_client_billing_invoices.py` uses, and the
    reason `conftest.py`'s autouse MagicMock does not reach these tests.
    """
    import db

    database = FakeDatabase()
    monkeypatch.setattr(db, "_pool", database)
    return database


def one_armed_org(fake_db, **over):
    """The ordinary case: one customer, one armed ₹12,000 monthly platform fee.

    Seeds the platform org as well, because a test that excludes something must
    be excluding something that EXISTS — `NOT o.is_platform_org` over a table
    with no platform org in it is a predicate proving nothing.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG, **over)
    return fake_db


def only_invoice(fake_db):
    """The single `subscription_invoices` row the run wrote. Fails on 0 or 2."""
    written = [i for i in fake_db.invoices if i.get("generated_from") == "lines"]
    assert len(written) == 1, (
        f"expected exactly one invoice raised by the sweep, found "
        f"{len(written)}: {[i['invoice_number'] for i in written]}")
    return written[0]


def drop_line(fake_db, line_id):
    """Remove a seeded line from BOTH halves of the fake.

    Used to build presence pairs: the same organisation, one line different, so
    "nothing was invoiced" can be shown to be caused by that line rather than by
    the feature being off.
    """
    fake_db.lines.pop(line_id)
    fake_db.sql.execute(
        "DELETE FROM public.org_billing_lines WHERE id = ?", (line_id,))


# ══════════════════════════════════════════════════════════════════════════════
#  1 · The period advances from the LAST INVOICED period
# ══════════════════════════════════════════════════════════════════════════════

def test_a_billed_line_advances_to_the_month_after_the_last_invoice():
    """THE DEFECT THIS WHOLE MODULE IS SHAPED AROUND.

    A retainer that began in April and was last invoiced for August is due for
    SEPTEMBER. The bug that shipped downstream answered "the first period on or
    after the line's origin" — a constant — so it answered April in April, in
    September, and in April the following year.
    """
    l = line(period_start=date(2026, 4, 1), last_billed=date(2026, 8, 1))
    assert _next_unbilled(l) == date(2026, 9, 1)
    # ANTI-VACUITY: the assertion above must not be passing because the answer
    # happens to coincide with the line's origin. If these were equal the test
    # would be green over the very bug it names.
    assert _next_unbilled(l) != _first_period(l)


def test_the_period_keeps_advancing_run_after_run():
    """Twelve consecutive months, each one period on from the last.

    A single-step assertion cannot tell "advances" from "advances once". This
    walks a year the way daily ticks would, feeding each answer back in as the
    next run's `last_billed`.
    """
    seen = []
    billed = None
    for _ in range(12):
        period = _next_unbilled(line(period_start=date(2026, 4, 1),
                                     last_billed=billed))
        seen.append(period)
        billed = period
    assert seen[0] == date(2026, 4, 1)
    assert seen[-1] == date(2027, 3, 1)
    # Twelve DISTINCT periods. The original defect produced twelve identical
    # ones, and a length check alone would not have noticed.
    assert len(set(seen)) == 12


def test_a_one_off_that_has_been_billed_is_finished_not_advanced():
    """A setup fee is due in its own period and no other.

    Advancing it would propose a month `_due_in_period` can never call it due
    in, and the organisation would stall on that period on every future run.
    """
    l = line(kind="setup", cadence="one_off", period_start=date(2026, 9, 1),
             period_end=date(2026, 9, 1), last_billed=date(2026, 9, 1))
    assert _next_unbilled(l) is None


def test_an_unbilled_one_off_is_due_in_its_own_period():
    l = line(kind="setup", cadence="one_off", period_start=date(2026, 9, 1),
             period_end=date(2026, 9, 1))
    assert _next_unbilled(l) == date(2026, 9, 1)


# ── invoice_from is a floor, and history wins over it ───────────────────────

def test_invoice_from_moves_a_never_billed_line_forward():
    """A line that ran for months before anybody armed a cron.

    `period_start` keeps saying when the arrangement began — it is the contract
    term and the screen shows it — and `invoice_from` says how far back
    automation may reach.
    """
    l = line(period_start=date(2026, 4, 1), invoice_from=date(2026, 8, 1))
    assert _first_period(l) == date(2026, 8, 1)
    assert _next_unbilled(l) == date(2026, 8, 1)


def test_invoice_from_never_drags_a_line_backwards():
    """A floor EARLIER than the line's own start changes nothing."""
    l = line(period_start=date(2026, 9, 1), invoice_from=date(2026, 1, 15))
    assert _first_period(l) == date(2026, 9, 1)


def test_a_mid_month_floor_makes_that_month_the_first_period():
    """`invoice_from` is the one date in this stack with no month-start CHECK.

    15 September is a floor inside September, so September is the first
    BILLABLE period — charged for part of itself, not skipped to October.
    """
    assert _first_period(line(invoice_from=date(2026, 9, 15))) == date(2026, 9, 1)


def test_history_wins_over_the_floor():
    """A line with invoiced periods is not sent backwards OR forwards by a
    column somebody edits later. The floor applies only to the never-billed
    branch."""
    l = line(period_start=date(2026, 4, 1), invoice_from=date(2027, 6, 1),
             last_billed=date(2026, 8, 1))
    assert _next_unbilled(l) == date(2026, 9, 1)


# ── direction: the first code in the product to read this column ────────────

def test_an_advance_line_may_be_billed_from_the_first_day_of_the_period():
    assert _last_billable(line(), date(2026, 9, 1)) == date(2026, 9, 1)
    assert _last_billable(line(), date(2026, 9, 15)) == date(2026, 9, 1)


def test_an_arrears_line_may_not_be_billed_until_its_period_has_finished():
    """Billing an arrears line on the 1st charges for a month that has not
    happened."""
    l = line(billing_direction="arrears")
    assert _last_billable(l, date(2026, 9, 15)) == date(2026, 8, 1)
    # The 30th is still being served — an inclusive period end means the
    # customer is present on the last day, so September is not complete.
    assert _last_billable(l, date(2026, 9, 30)) == date(2026, 8, 1)
    assert _last_billable(l, date(2026, 10, 1)) == date(2026, 9, 1)


def test_direction_actually_changes_the_answer():
    """ANTI-VACUITY for the pair above: if the column were being ignored, both
    directions would agree and each test would still be green on its own."""
    on = date(2026, 9, 15)
    assert _last_billable(line(), on) != _last_billable(
        line(billing_direction="arrears"), on)


def test_a_line_is_not_billed_past_the_period_it_was_ended_in():
    """`period_end` is the LAST PERIOD BILLED, and NULL means still open — it is
    not a missing value."""
    l = line(period_end=date(2026, 9, 1))
    assert _last_billable(l, date(2026, 12, 15)) == date(2026, 9, 1)
    assert _candidate_periods(l, date(2026, 12, 15)) == [date(2026, 9, 1)]


def test_a_line_ended_before_it_was_ever_billed_proposes_nothing():
    l = line(period_start=date(2026, 4, 1), period_end=date(2026, 3, 1))
    assert _candidate_periods(l, date(2026, 12, 1)) == []


def test_a_line_starting_next_month_is_not_billable_yet():
    assert _candidate_periods(line(period_start=date(2026, 12, 1)),
                              date(2026, 9, 15)) == []


# ── the backlog window ──────────────────────────────────────────────────────

def test_a_dormant_line_offers_its_whole_backlog_oldest_first():
    """The RANGE exists so a period suppressed by an earlier line of the same
    kind cannot stall the successor for ever — the run falls through to the
    first month it is genuinely due in. Only ONE invoice is raised per run
    regardless; this is what is worth ASKING about."""
    got = _candidate_periods(line(period_start=date(2026, 6, 1)),
                             date(2026, 9, 15))
    assert got == [date(2026, 6, 1), date(2026, 7, 1),
                   date(2026, 8, 1), date(2026, 9, 1)]


def test_the_backlog_search_is_bounded_and_starts_at_the_oldest():
    got = _candidate_periods(line(period_start=date(2000, 1, 1)),
                             date(2026, 9, 15))
    assert len(got) == _MAX_BACKLOG_MONTHS
    assert got[0] == date(2000, 1, 1), "catching up must start at the beginning"


# ── pro-rata: the one case this schema can produce ──────────────────────────

def test_a_whole_period_is_the_stated_amount_not_a_computed_one():
    """`amount * days/days` would be off by a rounding step on some months. A
    whole month must be the figure the operator typed."""
    assert _charge_for(line(), date(2026, 9, 1), date(2026, 9, 30)) \
        == Decimal("12000.00")
    assert _charge_for(line(), date(2026, 2, 1), date(2026, 2, 28)) \
        == Decimal("12000.00")


def test_a_mid_month_floor_is_charged_by_actual_days():
    """15 September onward is 16 of September's 30 days, inclusive at both ends.

    ₹12,000 × 16/30 = ₹6,400.
    """
    l = line(invoice_from=date(2026, 9, 15))
    assert _charge_for(l, date(2026, 9, 1), date(2026, 9, 30)) \
        == Decimal("6400.00")


def test_actual_days_means_february_and_july_differ():
    """A customer joining on the 15th pays 14/28 in February and 17/31 in July
    — not 15/30 of a notional month, in either."""
    feb = _charge_for(line(amount=Decimal("2800.00"),
                           invoice_from=date(2026, 2, 15)),
                      date(2026, 2, 1), date(2026, 2, 28))
    jul = _charge_for(line(amount=Decimal("3100.00"),
                           invoice_from=date(2026, 7, 15)),
                      date(2026, 7, 1), date(2026, 7, 31))
    assert feb == Decimal("1400.00")   # 2800 × 14/28
    assert jul == Decimal("1700.00")   # 3100 × 17/31


def test_a_floor_on_the_first_of_the_month_is_not_a_part_period():
    """A floor ON the period start means the whole period is served. The
    part-month must be the exception, not something every period passes
    through."""
    l = line(invoice_from=date(2026, 9, 1))
    assert _charge_for(l, date(2026, 9, 1), date(2026, 9, 30)) \
        == Decimal("12000.00")


def test_a_floor_in_an_earlier_month_does_not_prorate_a_later_one():
    """Once the first period is past, every following one is whole. Passing the
    floor unconditionally into `prorate` would still be correct — it clamps —
    but this pins the intent."""
    l = line(invoice_from=date(2026, 9, 15))
    assert _charge_for(l, date(2026, 10, 1), date(2026, 10, 31)) \
        == Decimal("12000.00")


def test_a_credit_line_subtracts():
    """`amount` is a magnitude (CHECK amount >= 0); `kind` says which way it
    points. A credit recorded as a positive charge bills the refund."""
    l = line(kind="credit", cadence="one_off", amount=Decimal("4000.00"))
    assert _charge_for(l, date(2026, 9, 1), date(2026, 9, 30)) \
        == Decimal("-4000.00")


def test_every_other_kind_adds():
    """ANTI-VACUITY for the credit test: if the sign rule were inverted or
    applied to everything, one of these two tests would still pass alone."""
    for kind in ("platform", "support", "setup", "ongoing", "topup"):
        assert _charge_for(line(kind=kind), date(2026, 9, 1),
                           date(2026, 9, 30)) > 0


# ══════════════════════════════════════════════════════════════════════════════
#  2 · THE MONEY-WRITING PATH, DRIVEN
#
#  Everything below calls `sweep_platform_invoices` for real. Nothing below
#  reads the module as text.
# ══════════════════════════════════════════════════════════════════════════════

async def test_the_harness_reaches_every_statement_the_sweep_issues(fake_db):
    """GUARD ON THE HARNESS ITSELF, and it is first for a reason.

    If the fake stopped being reached — a fixture that no longer installs, a
    query that no longer matches a handler, a sweep that returns before it
    writes — every assertion in this section would pass by measuring nothing.
    That is the exact failure this file exists to end, so it is checked inside
    the file that ends it.
    """
    one_armed_org(fake_db)
    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 1, f"the sweep raised no invoice at all: {out}"
    fake_db.one("JOIN public.organisations o ON o.id = l.org_id")
    fake_db.one("pg_advisory_xact_lock")
    fake_db.one("COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM")
    fake_db.one("INSERT INTO public.subscription_invoices")
    fake_db.one("INSERT INTO public.subscription_events")
    # `record_billed` ran — these are ITS statements, and the sweep reaching
    # them is the only offline proof that the join table is written by the
    # module that owns the no-double-charge rule rather than by this one.
    fake_db.one("SELECT b.line_id, l.description, i.invoice_number ")
    insert = fake_db.one("INSERT INTO public.invoice_billing_lines ")
    assert "unnest($2::uuid[], $5::numeric[])" in insert["sql"], (
        "something other than billing_lines.record_billed wrote the join "
        "table — a second writer of a no-double-charge invariant is how the "
        "invariant stops holding")


async def test_one_armed_line_raises_one_draft_invoice_for_the_right_money(fake_db):
    """THE WHOLE PATH, END TO END, ON THE ORDINARY CASE.

    ₹12,000 platform fee, September, one organisation. Every column of the
    document is asserted, because the INSERT binds ten parameters into fourteen
    columns and the failure mode of that shape is a value landing under the
    wrong name — a JSON blob in `doc_status`, a serial in `subtotal` — which no
    assertion about the statement's TEXT can see.
    """
    one_armed_org(fake_db)

    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 1
    assert out["skipped"] == 0
    assert out["failed"] == {}
    assert out["organisations"] == 1
    assert out["invoices"][0]["doc_status"] == _DRAFT

    invoice = only_invoice(fake_db)
    assert invoice["org_id"] == CUSTOMER_ORG
    assert invoice["period_start"] == date(2026, 9, 1)
    assert invoice["period_end"] == date(2026, 9, 30)

    # THE MONEY, AS NUMBERS. ₹12,000 + 18% = ₹14,160.
    assert invoice["subtotal"] == Decimal("12000.00")
    assert invoice["gst"] == Decimal("2160.00")
    assert invoice["total"] == Decimal("14160.00")
    # ANTI-VACUITY on the GST: a zero would satisfy "is a Decimal" and would
    # satisfy `total == subtotal + gst` if the total were computed the same
    # broken way. The number is what is asserted, and it is asserted non-zero.
    assert invoice["gst"] > 0

    # 2 · THE DOCUMENT IS A DRAFT AND CANNOT BE CHASED. `doc_status` DEFAULTS to
    # 'final' on this table (migration 256, deliberately, so the console's own
    # path is unchanged), so an INSERT that omits it mints a finished invoice —
    # which is what happened downstream on 2026-08-27.
    assert invoice["doc_status"] == "draft"
    # `NULL < CURRENT_DATE` is NULL, so a draft cannot reach
    # `GET /v1/admin/invoices/overdue`. This is the whole dunning guard.
    assert invoice["due_date"] is None
    assert invoice["payment_status"] == "pending"
    assert invoice["generated_from"] == "lines"
    assert invoice["created_by"] == "system"

    # THE TYPES, which is what a swapped binding actually looks like.
    assert isinstance(invoice["subtotal"], Decimal)
    assert isinstance(invoice["doc_status"], str)
    assert isinstance(invoice["period_start"], date)

    items = json.loads(invoice["line_items"])
    assert len(items) == 1
    assert items[0]["line_id"] == PLATFORM_LINE
    assert items[0]["kind"] == "platform"
    assert items[0]["amount"] == 12000.0
    assert "2026-09-01" in items[0]["description"]

    # THE OTHER HALF OF THE NO-DOUBLE-CHARGE RULE was written too, and for what
    # this document actually charged.
    recorded = fake_db.billed_lines(invoice["invoice_number"])
    assert len(recorded) == 1
    assert recorded[0]["line_id"] == PLATFORM_LINE
    assert recorded[0]["period_start"] == date(2026, 9, 1)
    assert recorded[0]["amount"] == Decimal("12000.00")

    # And the run is on the audit trail as a DRAFT.
    assert len(fake_db.events) == 1
    metadata = json.loads(fake_db.events[0]["metadata"])
    assert metadata["doc_status"] == "draft"
    assert metadata["source"] == "sweep_platform_invoices"
    assert metadata["total"] == 14160.0


async def test_the_gst_is_eighteen_percent_of_this_subtotal_rounded_to_paise(fake_db):
    """THE NUMBER, ON A SUBTOTAL THAT CANNOT BE GUESSED.

    ₹9,999.99 × 0.18 = ₹1,799.9982, which is ₹1,800.00 at HALF_UP and ₹1,799.99
    if somebody truncates. A round fixture cannot tell those apart, and the rate
    is the one figure on this document that a customer checks by hand.

    ⚠ THE RATE IS NOT RE-READ FROM THE MODULE. Asserting `gst == subtotal *
    _GST_RATE` would be green over `_GST_RATE = 0`, over `_GST_RATE = 1`, and
    over the constant being deleted and re-derived wrongly — it is the
    implementation restated, not a check on it.
    """
    one_armed_org(fake_db, amount=Decimal("9999.99"))

    await sweep_platform_invoices(today=TODAY)

    invoice = only_invoice(fake_db)
    assert invoice["subtotal"] == Decimal("9999.99")
    assert invoice["gst"] == Decimal("1800.00")
    assert invoice["total"] == Decimal("11799.99")


async def test_a_credit_reduces_the_invoice_it_appears_on(fake_db):
    """A ₹12,000 fee and a ₹4,000 credit is an ₹8,000 invoice, not ₹16,000.

    `amount` is a magnitude on both rows — `CHECK (amount >= 0)` — so the sign
    comes from `kind`, and `record_billed` REFUSES a credit recorded as a
    positive charge. Both halves are exercised here: the invoice's subtotal and
    the join row's amount.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG)
    fake_db.line(CREDIT_LINE, CUSTOMER_ORG, kind="credit", cadence="one_off",
                 description="Goodwill credit", amount=Decimal("4000.00"),
                 period_start=date(2026, 9, 1), period_end=date(2026, 9, 1))

    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 1
    invoice = only_invoice(fake_db)
    assert invoice["subtotal"] == Decimal("8000.00")
    assert invoice["gst"] == Decimal("1440.00")
    assert invoice["total"] == Decimal("9440.00")

    recorded = {r["line_id"]: r["amount"]
                for r in fake_db.billed_lines(invoice["invoice_number"])}
    assert recorded[PLATFORM_LINE] == Decimal("12000.00")
    assert recorded[CREDIT_LINE] == Decimal("-4000.00")


async def test_running_the_sweep_twice_raises_one_invoice_not_two(fake_db):
    """THE DOUBLE-BILLING GUARD, run the way a daily cron would run it.

    Two ticks on the same day. The first records the period in
    `invoice_billing_lines`; the second reads that back as `last_billed` — the
    correlated MAX in `_ARMED_LINES` — advances to October, finds October is not
    billable yet for an advance line in September, and proposes nothing.

    ⚠ THE ZERO IS PAIRED WITH A ONE. "the second run created nothing" is what a
    completely disabled sweep says too, so the first run's invoice is asserted
    in the same test and the invoice count is asserted at the end.
    """
    one_armed_org(fake_db)

    first = await sweep_platform_invoices(today=TODAY)
    assert first["created"] == 1, "the first run must actually bill something"

    second = await sweep_platform_invoices(today=TODAY)
    assert second["created"] == 0
    assert second["skipped"] == 1
    assert second["failed"] == {}
    assert second["organisations"] == 1, (
        "the organisation must still be REACHED on the second run — a zero "
        "because the population query stopped selecting it would prove nothing")

    assert len(fake_db.invoices) == 1
    assert len(fake_db.ledger) == 1
    assert len(fake_db.statements("INSERT INTO public.subscription_invoices")) == 1


async def test_only_the_armed_line_is_billed_even_when_another_is_due(fake_db):
    """`auto_invoice` is PER LINE, so the filter is too.

    A line with `auto_invoice = FALSE` is a term Aekam has agreed and has NOT
    authorised a cron to bill. `lines_due_in_period` returns every line due for
    the organisation, armed or not, and `_sweep_one_org` INTERSECTS rather than
    unions — sweeping the unarmed one in because it shares an organisation with
    an armed one would bill it by accident.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG)
    fake_db.line(SUPPORT_LINE, CUSTOMER_ORG, kind="support",
                 description="Support plan", amount=Decimal("5000.00"),
                 auto_invoice=False)

    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 1
    invoice = only_invoice(fake_db)
    assert invoice["subtotal"] == Decimal("12000.00"), (
        "₹17,000 means the unarmed support plan was billed")
    assert [i["line_id"] for i in json.loads(invoice["line_items"])] \
        == [PLATFORM_LINE]

    # ANTI-VACUITY: the unarmed line really was DUE and really was offered. If
    # it had simply not been due, this test would be green over a sweep that
    # unions rather than intersects.
    offered = fake_db.one("ORDER BY array_position(")["result"]
    assert {r["id"] for r in offered} == {PLATFORM_LINE, SUPPORT_LINE}


async def test_the_platform_org_is_never_billed(fake_db):
    """3 · THE OWNER, and the sweep must not even TRY.

    The platform org is given an armed line identical in every respect to the
    customer's, so the only thing separating them is `is_platform_org`. The
    population query is EXECUTED by the harness, so relaxing that predicate
    changes what comes back rather than merely changing the module's text.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, PLATFORM_ORG)
    fake_db.line(SECOND_LINE, CUSTOMER_ORG)

    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 1
    assert out["organisations"] == 1, (
        "the platform org reached the per-organisation loop at all")
    invoice = only_invoice(fake_db)
    assert invoice["org_id"] == CUSTOMER_ORG
    assert fake_db.billed_lines(invoice["invoice_number"])[0]["line_id"] \
        == SECOND_LINE
    assert not [r for r in fake_db.ledger if r["line_id"] == PLATFORM_LINE]

    # ⚠ PRESENCE PAIR, AND IT IS THE POINT OF THE TEST. The owner's line is
    # billable in every OTHER respect — armed, active, due, monthly, positive.
    # Clear the one flag and the very same line is invoiced on the next tick, so
    # the absence above is caused by `NOT o.is_platform_org` and by nothing else.
    fake_db.sql.execute(
        "UPDATE public.organisations SET is_platform_org = 0 WHERE id = ?",
        (PLATFORM_ORG,))
    again = await sweep_platform_invoices(today=TODAY)
    assert again["organisations"] == 2
    assert again["created"] == 1          # the customer is already billed
    assert [r["line_id"] for r in fake_db.ledger].count(PLATFORM_LINE) == 1


async def test_a_deactivated_organisation_is_not_billed(fake_db):
    """`is_active IS NOT FALSE`, matching `scheduler._for_each_org`.

    And `IS NOT FALSE` rather than `= TRUE`, so a NULL — a row predating the
    column — is INCLUDED rather than vanishing from billing. Both halves are
    asserted, because a query that dropped the NULL org would still pass the
    first one.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Dormant Ltd", active=False)
    fake_db.org(SECOND_ORG, "Old Ltd", active=None)
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG)
    fake_db.line(SECOND_LINE, SECOND_ORG)

    out = await sweep_platform_invoices(today=TODAY)

    assert out["organisations"] == 1
    assert out["created"] == 1
    assert only_invoice(fake_db)["org_id"] == SECOND_ORG, (
        "an organisation whose is_active is NULL must still be billed")
    assert not [r for r in fake_db.ledger if r["line_id"] == PLATFORM_LINE]


async def test_at_most_one_invoice_per_organisation_per_run(fake_db):
    """DECISION 2. A line dormant since June does not mint four documents on the
    morning somebody arms the cron; it catches up one period per daily tick.
    """
    one_armed_org(fake_db, period_start=date(2026, 6, 1))
    # ANTI-VACUITY: there really are four periods on offer, so "one invoice" is
    # a choice the sweep made rather than all it could have done.
    assert len(_candidate_periods(line(period_start=date(2026, 6, 1)),
                                  TODAY)) == 4

    first = await sweep_platform_invoices(today=TODAY)
    assert first["created"] == 1
    assert fake_db.invoices[0]["period_start"] == date(2026, 6, 1), (
        "catching up must start at the oldest unbilled period")

    second = await sweep_platform_invoices(today=TODAY)
    assert second["created"] == 1
    assert fake_db.invoices[1]["period_start"] == date(2026, 7, 1)

    assert len(fake_db.invoices) == 2
    assert [r["period_start"] for r in fake_db.ledger] \
        == [date(2026, 6, 1), date(2026, 7, 1)]


# ── the serial, and the console it shares a series with ────────────────────

async def test_the_invoice_number_continues_the_series(fake_db):
    """`invoice_number` is UNIQUE and both writers allocate MAX-plus-one over it.

    A console-raised KSUB-202609-0007 already exists, so the cron's document is
    0008. If the pattern that reads the sequence out of the existing numbers
    stops matching, MAX is NULL, COALESCE answers 0, and every run mints 0001 —
    the number the FIRST document of the month already holds.
    """
    one_armed_org(fake_db)
    fake_db.invoice("KSUB-202609-0007")
    fake_db.invoice("KSUB-202608-0099")

    await sweep_platform_invoices(today=TODAY)

    assert only_invoice(fake_db)["invoice_number"] == "KSUB-202609-0008"


async def test_the_series_is_keyed_on_the_month_the_document_is_raised(fake_db):
    """PRESENCE PAIR for the test above, and a rule of its own.

    August's documents must not advance September's counter, so with only
    KSUB-202608-0099 on file the next September number is 0001 — which proves
    0008 above was caused by the September row rather than by a constant. And
    the key is the month the document is RAISED, not the month it bills: this
    run invoices JUNE from a September clock and still numbers in September's
    block, because reaching back into June's numbering would interleave new
    documents among issued ones.
    """
    one_armed_org(fake_db, period_start=date(2026, 6, 1))
    fake_db.invoice("KSUB-202608-0099")

    await sweep_platform_invoices(today=TODAY)

    invoice = only_invoice(fake_db)
    assert invoice["invoice_number"] == "KSUB-202609-0001"
    assert invoice["period_start"] == date(2026, 6, 1)


async def test_the_serial_is_allocated_under_the_lock_the_console_takes(fake_db):
    """⚠ SHARED DELIBERATELY, AND IT MUST STAY SHARED.

    A private lock here would serialise this sweep against itself and against
    nothing else, so an operator pressing Create in the console while the cron
    ticked would read the same MAX and one of the two would die on a 23505. The
    lock must also be taken on the connection INSIDE the transaction — that is
    what makes "held until COMMIT" true — and BEFORE the MAX is read, which is
    what makes it a lock rather than a decoration.
    """
    one_armed_org(fake_db)

    await sweep_platform_invoices(today=TODAY)

    lock = fake_db.one("pg_advisory_xact_lock")
    assert lock["args"] == (_INVOICE_SEQ_LOCK_NS, 202609)
    assert lock["depth"] >= 1, (
        "the advisory lock was taken outside the transaction, so it is released "
        "immediately and serialises nothing")

    order = [i for i, entry in enumerate(fake_db.log)]
    lock_at = next(i for i in order
                   if "pg_advisory_xact_lock" in fake_db.log[i]["sql"])
    read_at = next(i for i in order
                   if "COALESCE(MAX(CAST(SUBSTRING" in fake_db.log[i]["sql"])
    assert lock_at < read_at, "MAX was read before the lock was held"


async def test_every_write_happens_inside_one_transaction(fake_db):
    """The invoice, the join rows and the audit event stand or fall together.

    Asserted as the depth each statement was issued at, which is the fake
    counting `conn.transaction()` blocks the module actually entered.
    """
    one_armed_org(fake_db)

    await sweep_platform_invoices(today=TODAY)

    for needle in ("INSERT INTO public.subscription_invoices",
                   "INSERT INTO public.invoice_billing_lines ",
                   "INSERT INTO public.subscription_events"):
        assert fake_db.one(needle)["depth"] >= 1, (
            f"{needle} was issued outside a transaction — a failure after it "
            f"leaves a charge the system does not know it made")


async def test_a_refusal_after_the_invoice_takes_the_invoice_with_it(fake_db):
    """⚠ THE REASON THE TRANSACTION IS THERE.

    `record_billed` runs AFTER the invoice row is written and can refuse: a line
    already billed for the period, a line not due in it, a second writer that
    got to `uq_ibl_line_period` first. An invoice whose lines were not recorded
    is a charge the system thinks it has not made — the preview offers the
    period again, and the next run bills it a second time.

    The refusal is injected at the join-table INSERT because that is the only
    step that happens after the document exists.
    """
    one_armed_org(fake_db)
    fake_db.refuse_recording = (
        "duplicate key value violates unique constraint \"uq_ibl_line_period\"")

    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 0
    assert list(out["failed"]) == [CUSTOMER_ORG]
    assert "uq_ibl_line_period" in out["failed"][CUSTOMER_ORG]

    # The invoice WAS written and then undone — not merely never attempted.
    assert fake_db.statements("INSERT INTO public.subscription_invoices"), (
        "the run never reached the invoice INSERT, so nothing here is a test "
        "of rollback")
    assert fake_db.invoices == []
    assert fake_db.events == []
    assert fake_db.ledger == []

    # ⚠ PRESENCE PAIR. With the refusal lifted the same fixture commits
    # everything, so the three empty lists above are the rollback and not a
    # sweep that does nothing.
    fake_db.refuse_recording = None
    again = await sweep_platform_invoices(today=TODAY)
    assert again["created"] == 1
    assert len(fake_db.invoices) == 1
    assert len(fake_db.ledger) == 1
    assert len(fake_db.events) == 1


# ── the halt: a period that nets to nothing ────────────────────────────────

async def test_a_period_that_nets_to_exactly_zero_is_not_invoiced(fake_db, caplog):
    """A CRON DOES NOT ISSUE A DOCUMENT FOR NOTHING.

    ₹12,000 of fees fully cancelled by a ₹12,000 credit is not a ₹0 invoice with
    ₹0 of GST posted against a customer; it is a month somebody has to look at.
    ZERO is the case that matters — a `< 0` boundary lets it through and issues
    the empty document, and every negative fixture would still be green.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG, amount=Decimal("12000.00"))
    fake_db.line(CREDIT_LINE, CUSTOMER_ORG, kind="credit", cadence="one_off",
                 description="September goodwill credit",
                 amount=Decimal("12000.00"),
                 period_start=date(2026, 9, 1), period_end=date(2026, 9, 1))

    with caplog.at_level(logging.WARNING, logger="services.platform_billing"):
        out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 0
    assert out["failed"] == {}
    assert fake_db.invoices == []
    assert fake_db.ledger == []
    assert not fake_db.statements("INSERT INTO public.subscription_invoices"), (
        "a zero-value invoice was written — `subtotal <= 0` is what stops it, "
        "and `< 0` lets exactly this case through")
    # It is logged on every tick, because the log is the only place anybody sees
    # a halted organisation (see the test below for why that is not enough).
    assert "nothing billable" in caplog.text
    assert "Unicode Group" in caplog.text

    # ⚠ PRESENCE PAIR. Remove the credit and the very same organisation is
    # invoiced on the next tick, so the halt is caused by the netting and not by
    # the organisation being unbillable.
    drop_line(fake_db, CREDIT_LINE)
    again = await sweep_platform_invoices(today=TODAY)
    assert again["created"] == 1
    assert only_invoice(fake_db)["subtotal"] == Decimal("12000.00")


async def test_a_credit_only_period_halts_rather_than_issuing_a_credit_note(fake_db):
    """A negative invoice is a promise to return money.

    It needs a person who can say what it reverses, so the sweep stops rather
    than issuing one unattended. ⚠ AND THE HALT IS DELIBERATE: nothing is
    recorded for the period, so every later run reaches it and stops again, and
    the months AFTER it are not billed either. Falling through would invoice
    October in full while September's credit sat unapplied against nothing.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(CREDIT_LINE, CUSTOMER_ORG, kind="credit", cadence="monthly",
                 description="Standing credit", amount=Decimal("4000.00"))

    out = await sweep_platform_invoices(today=TODAY)

    assert out["created"] == 0
    assert out["organisations"] == 1, "the organisation was not even reached"
    assert fake_db.invoices == []

    # The halt STAYS put on the next tick, and October is not reached either.
    october = await sweep_platform_invoices(today=date(2026, 10, 15))
    assert october["created"] == 0
    assert fake_db.invoices == []

    # ⚠ PRESENCE PAIR: a charge that outweighs the credit IS invoiced, so the
    # zero above is the sign of the total and not a dead code path.
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG, amount=Decimal("12000.00"))
    again = await sweep_platform_invoices(today=TODAY)
    assert again["created"] == 1
    assert only_invoice(fake_db)["subtotal"] == Decimal("8000.00")


async def test_a_halted_organisation_is_counted_as_skipped_and_should_not_be(fake_db):
    """⚠ A DEFECT, PINNED RATHER THAN ASSERTED TO BE CORRECT.

    Two organisations, two different situations:

      · Dormant Ltd has an armed line that is not due until December. Nothing to
        do, and nothing wrong.
      · Unicode Group has a September that nets to zero. The sweep CANNOT do its
        job for it, has stopped, and will stop again every morning until a person
        raises the period from the billing console. Every month after September
        is blocked behind it.

    The run reports `skipped: 2` and cannot tell them apart. The only trace of
    the difference is a WARNING in a Railway log at 03:00, and this file's own
    banner — "a cron that cannot do its job must not answer 200" — is the
    standard that says that is not enough.

    ⚠ THIS TEST IS EXPECTED TO PASS TODAY AND IS MEANT TO START FAILING. The fix
    is a distinct bucket — `halted: [{org, period, subtotal}]` — that
    `fanout_failure` can see, so `/cron/platform-billing` turns red instead of
    green. When somebody adds it, this test goes red and is rewritten. It is the
    same device as `test_live_the_customers_own_invoice_list_still_shows_drafts`
    below, and it is a great deal harder to overlook than a note.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(SECOND_ORG, "Dormant Ltd")
    fake_db.line(SECOND_LINE, SECOND_ORG, period_start=date(2026, 12, 1))
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG, amount=Decimal("12000.00"))
    fake_db.line(CREDIT_LINE, CUSTOMER_ORG, kind="credit", cadence="one_off",
                 description="September goodwill credit",
                 amount=Decimal("12000.00"),
                 period_start=date(2026, 9, 1), period_end=date(2026, 9, 1))

    out = await sweep_platform_invoices(today=TODAY)

    assert out["organisations"] == 2
    assert out["created"] == 0
    assert out["skipped"] == 2, (
        "a halted organisation is bucketed with one that had nothing to do")
    assert out["failed"] == {}
    # There is no other field carrying the difference — the whole result is
    # these six keys, and none of them names Unicode Group.
    assert set(out) == {"date", "organisations", "created", "skipped",
                        "failed", "invoices"}
    assert "Unicode Group" not in json.dumps(out, default=str)


# ══════════════════════════════════════════════════════════════════════════════
#  3 · The cron, driven — not read
# ══════════════════════════════════════════════════════════════════════════════

CRON_SECRET_FOR_TESTS = "cron-secret-for-tests-32-characters"


@pytest.fixture
def cron(monkeypatch):
    """`/cron/platform-billing`, callable, with its secret set."""
    import routers.scheduler as scheduler

    monkeypatch.setattr(scheduler, "CRON_SECRET", CRON_SECRET_FOR_TESTS)
    return scheduler


async def test_the_cron_turns_a_partial_failure_red(fake_db, cron):
    """A handler either does the work or answers with a status code that turns
    the caller red. Seven handlers in this file answered 200 over an error for
    months, and `curl -sf` cannot see the difference.

    The sweep is driven for real — no mocked return value — so this also proves
    the handler's own import of it is live rather than commented out.
    """
    from fastapi import HTTPException

    # An old period, because this handler calls the sweep with no `today` and
    # therefore uses the wall clock. The line is due whatever day it is run on.
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG, period_start=date(2020, 1, 1))
    fake_db.refuse_recording = "uq_ibl_line_period"

    with pytest.raises(HTTPException) as raised:
        await cron.run_platform_billing(x_cron_secret=CRON_SECRET_FOR_TESTS)

    assert raised.value.status_code == 500
    assert raised.value.detail["job"] == "platform-billing"
    assert "uq_ibl_line_period" in raised.value.detail["error"]
    assert raised.value.detail["created"] == 0
    # Nothing was left behind by the failed organisation.
    assert fake_db.invoices == []


async def test_the_cron_answers_200_when_it_could_not_do_its_job(fake_db, cron):
    """⚠ THE HARM OF THE `skipped` BUCKET, AT THE ENDPOINT.

    Unicode Group's September nets to zero, so the sweep halts and every month
    after September is blocked behind it. The endpoint answers 200 with
    `skipped: 1`, the Railway cron stays green, and an organisation that has not
    been invoiced since September looks exactly like an organisation with
    nothing to bill.

    PINNED, NOT ENDORSED — see
    `test_a_halted_organisation_is_counted_as_skipped_and_should_not_be`. When
    the halt gets its own bucket this call raises instead, and this test is
    rewritten to expect the 500.
    """
    fake_db.org(PLATFORM_ORG, "Aekam Inc", platform=True)
    fake_db.org(CUSTOMER_ORG, "Unicode Group")
    fake_db.line(PLATFORM_LINE, CUSTOMER_ORG, period_start=date(2020, 1, 1),
                 amount=Decimal("12000.00"))
    fake_db.line(CREDIT_LINE, CUSTOMER_ORG, kind="credit", cadence="one_off",
                 description="Goodwill credit", amount=Decimal("12000.00"),
                 period_start=date(2020, 1, 1), period_end=date(2020, 1, 1))

    result = await cron.run_platform_billing(x_cron_secret=CRON_SECRET_FOR_TESTS)

    assert result["created"] == 0
    assert result["skipped"] == 1
    assert result["failed"] == {}
    assert fake_db.invoices == []


async def test_the_cron_refuses_without_the_secret(fake_db, cron):
    """ANTI-VACUITY for the two above: they pass the secret, so a handler that
    had stopped checking would look identical from inside them."""
    from fastapi import HTTPException

    one_armed_org(fake_db, period_start=date(2020, 1, 1))

    with pytest.raises(HTTPException) as raised:
        await cron.run_platform_billing(x_cron_secret="wrong")
    assert raised.value.status_code == 403
    assert fake_db.invoices == [], "a rejected call still wrote an invoice"


def test_the_cron_is_a_new_endpoint_and_not_folded_into_an_armed_one(cron):
    """`/cron/billing` is already in Railway's `cron-daily` loop. Adding the
    upstream sweep to it would have armed an unattended invoice writer as a side
    effect of a deploy.

    The route's existence is read off the router rather than out of the file;
    the second half — that `/cron/billing` does NOT also call the sweep — has no
    offline witness other than that handler's source, and is a source read.
    """
    # The FULL path, prefix included: this is the URL a Railway cron command has
    # to be pointed at, and a route that exists under the wrong prefix is a cron
    # that 404s every night.
    paths = {route.path for route in cron.router.routes}
    assert "/api/internal/cron/platform-billing" in paths
    assert "/api/internal/cron/billing" in paths

    src = (_BACKEND / "routers/scheduler.py").read_text(encoding="utf-8")
    billing = src.split('@router.post("/cron/billing"')[1] \
                 .split('@router.post("/cron/platform-billing"')[0]
    assert "sweep_platform_invoices" not in billing


# ══════════════════════════════════════════════════════════════════════════════
#  4 · Agreements with OTHER files, where the other file's source is the only
#      witness available offline. Each one says what it cannot see.
# ══════════════════════════════════════════════════════════════════════════════

def _source(rel: str) -> str:
    return (_BACKEND / rel).read_text(encoding="utf-8")


def test_the_invoice_lock_namespace_matches_the_console():
    """Both writers allocate from one UNIQUE `KSUB-` series by MAX-plus-one, so
    they must contend on the same advisory lock.

    Compared as VALUES, by importing the console's own constant — not by reading
    either file as text. The behavioural half (that the sweep actually takes a
    lock with this number, inside its transaction, before reading MAX) is
    `test_the_serial_is_allocated_under_the_lock_the_console_takes`.
    """
    from routers.subscription import _INVOICE_SEQ_LOCK_NS as console_ns

    assert _INVOICE_SEQ_LOCK_NS == console_ns
    assert _INVOICE_SEQ_LOCK_NS == 0x4B535542       # 'KSUB'


async def test_gst_matches_the_rate_the_console_applies_to_the_same_table(fake_db):
    """One table, one GST rule.

    `subscription_invoices` carries a single `gst` column with no rate on it, so
    a sweep applying a different percentage would produce documents that cannot
    be told apart from the console's. The console's rate is inline SQL —
    `round(subtotal * 0.18, 2)` — with no constant to import, so it is read out
    of that file's source; but what is compared is the NUMBER THIS RUN WROTE,
    not this module's constant.
    """
    one_armed_org(fake_db)
    await sweep_platform_invoices(today=TODAY)
    invoice = only_invoice(fake_db)

    console = _source("routers/subscription.py")
    rate = re.search(r"round\(subtotal \* ([0-9.]+), 2\)", console)
    assert rate, "the console no longer computes gst as round(subtotal * r, 2)"

    expected = (invoice["subtotal"] * Decimal(rate.group(1))).quantize(
        Decimal("0.01"))
    assert invoice["gst"] == expected == Decimal("2160.00")
    assert _GST_RATE == Decimal(rate.group(1))


def test_the_overdue_list_still_filters_the_way_the_null_due_date_relies_on():
    """The other end of the dunning guard.

    The sweep writes `due_date = NULL` and that is asserted behaviourally in
    `test_one_armed_line_raises_one_draft_invoice_for_the_right_money`. It only
    KEEPS a draft off the chase list while the endpoint selects on `due_date <
    CURRENT_DATE`, and that endpoint is in another file with no offline witness
    but its source.
    """
    overdue = _source("routers/subscription.py")
    assert "i.payment_status='pending' AND i.due_date < CURRENT_DATE" in overdue


# ══════════════════════════════════════════════════════════════════════════════
#  5 · Against the real database
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_DSN = "postgresql://user:pass@host/db"
DB_SKIP = (
    "No live DATABASE_URL. Run: "
    "    cd backend && railway run --service Kartavaya -- python -m pytest "
    "tests/test_platform_billing_sweep.py -q"
)


def live_dsn():
    import os
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


def run_live(coro_factory):
    """Run `coro_factory(conn)` against the real database, or skip.

    ⚠ SKIPS ONLY ON "THERE IS NO DATABASE HERE", never on a failure of the thing
    under test. A developer machine carries a dummy `DATABASE_URL` that is not
    the documented placeholder, so the connection has to be attempted; anything
    the database then SAYS is a result and reaches the assertions.

    ⚠ AND EVERY TEST BELOW SKIPS ON AN ORDINARY RUN, which is why none of them
    is load-bearing for anything in sections 1–4. They are the half that proves
    `_ARMED_LINES` resolves against the REAL schema — sqlite cannot — and they
    are the reason the harness above is a supplement rather than a replacement.

    Every probe below is READ-ONLY. Nothing here writes, because a write through
    any front door in this product is a production write.
    """
    import asyncio
    import asyncpg

    if live_dsn() is None:
        pytest.skip(DB_SKIP)

    async def run():
        try:
            conn = await asyncpg.connect(live_dsn(), statement_cache_size=0)
        except (asyncpg.exceptions.InvalidPasswordError,
                asyncpg.exceptions.InvalidCatalogNameError,
                OSError) as exc:
            return ("__unreachable__", str(exc))
        try:
            return ("__ok__", await coro_factory(conn))
        finally:
            await conn.close()

    kind, value = asyncio.run(run())
    if kind == "__unreachable__":
        pytest.skip(f"{DB_SKIP} (connection refused: {value[:80]})")
    return value


def test_live_the_sweep_query_parses_and_runs_against_the_real_schema():
    """⚠ THE CHECK THAT MATTERS MOST HERE.

    CLAUDE.md: never ship a router without one test that executes its SQL
    against the real schema. `_ARMED_LINES` names `auto_invoice`,
    `invoice_from`, `billing_direction` and `is_platform_org` across two tables
    and a correlated subquery into a third; a typo in any of them is a 500 on
    every tick, and neither a MagicMock nor the sqlite harness above would see
    it — sqlite is given a schema this file wrote.
    """
    rows = run_live(lambda c: c.fetch(_ARMED_LINES, None))
    assert rows == [], (
        "a billing line is ARMED. That is a real state change — read "
        "docs/STATUS.md before assuming this test is wrong"
    )


def test_live_only_the_arming_switch_is_holding_the_sweep_at_zero():
    """ANTI-VACUITY FOR THE TEST ABOVE, and the reason it is not just `== []`.

    Every other live test about this sweep is green over an empty feature. This
    runs the REAL query with the one predicate `auto_invoice = TRUE` relaxed,
    and proves the rest of it — both joins, the platform-org exclusion, the
    active filter, the correlated MAX — selects the actual live billing lines.
    So the emptiness above is caused by the arming switch and by nothing else.
    """
    relaxed = _ARMED_LINES.replace("l.auto_invoice = TRUE", "TRUE")

    async def probe(conn):
        rows = await conn.fetch(relaxed, None)
        platform = await conn.fetchval(
            "SELECT count(*) FROM public.organisations WHERE is_platform_org")
        return rows, platform

    rows, platform_orgs = run_live(probe)

    assert len(rows) > 0, (
        "the sweep's query selects nothing even with arming relaxed — the "
        "joins or the filters are wrong, and the empty result above proves "
        "nothing at all"
    )
    assert all(r["last_billed"] is None for r in rows)
    # The exclusion is over a NON-EMPTY class: there really is a platform org
    # for `NOT o.is_platform_org` to be excluding.
    assert platform_orgs >= 1
    assert all(r["org_name"] for r in rows)


def test_live_the_owner_is_not_reachable_by_this_sweep():
    """Two independent facts, because either alone is a weak claim: the owner
    has no billing line, AND the sweep's own query would exclude it if one
    appeared."""
    async def probe(conn):
        owner_lines = await conn.fetchval(
            "SELECT count(*) FROM public.org_billing_lines l "
            "JOIN public.organisations o ON o.id = l.org_id "
            "WHERE o.is_platform_org")
        owner_id = await conn.fetchval(
            "SELECT id FROM public.organisations WHERE is_platform_org LIMIT 1")
        scoped = await conn.fetch(
            _ARMED_LINES.replace("l.auto_invoice = TRUE", "TRUE"),
            str(owner_id) if owner_id else None)
        return owner_lines, owner_id, scoped

    owner_lines, owner_id, scoped = run_live(probe)
    assert owner_id is not None, "no platform org — this test proves nothing"
    assert owner_lines == 0
    assert scoped == [], (
        "the sweep would consider a line belonging to the platform org"
    )


def test_live_migration_256_is_applied_and_the_draft_column_behaves():
    """`doc_status`, its default and its CHECK — read from the catalog.

    SKIPS, loudly, while 256 is unapplied: migrations are applied centrally
    after a risk report, so this test is written to go green the moment that
    happens rather than to fail until it does.
    """
    async def probe(conn):
        return await conn.fetchrow(
            "SELECT column_default, is_nullable FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='subscription_invoices' "
            "  AND column_name='doc_status'")

    row = run_live(probe)
    if row is None:
        pytest.skip(
            "migration 256_an_upstream_invoice_can_be_a_draft.sql is not "
            "applied yet — the sweep cannot write doc_status until it is")
    assert "final" in (row["column_default"] or ""), (
        "doc_status must default to 'final' so POST /v1/admin/invoices — an "
        "operator raising a document deliberately — is unchanged"
    )
    assert row["is_nullable"] == "NO"


def test_live_the_customers_own_invoice_list_still_shows_drafts():
    """⚠ THE OWED EDIT, ASSERTED AS A FACT RATHER THAN LEFT IN A COMMENT.

    `GET /v1/invoices` is the organisation's own billing tab and does
    `SELECT *` with no status filter, so a draft would be listed to the
    customer as though it had been issued. Nothing can fire while
    `auto_invoice` is FALSE everywhere, but this must be fixed before the first
    line is armed.

    THIS TEST IS EXPECTED TO PASS TODAY AND IS MEANT TO START FAILING. When
    somebody adds the filter, it goes red and is deleted — that is the signal
    the debt is paid, and it is a great deal harder to overlook than a note.
    """
    src = _source("routers/subscription.py")
    listing = src.split("async def list_invoices")[1].split("async def")[0]
    assert "doc_status" not in listing, (
        "GET /v1/invoices now filters on doc_status — the debt this test "
        "tracks is paid. Delete this test."
    )


def test_live_no_upstream_invoice_has_been_raised_by_anything_yet():
    """The baseline the first armed run will be measured against. A row here
    that nobody expected means something else is writing this table."""
    async def probe(conn):
        return await conn.fetchrow(
            "SELECT count(*) AS total, "
            "       count(*) FILTER (WHERE generated_from='lines') AS from_lines "
            "FROM public.subscription_invoices")

    row = run_live(probe)
    assert row["total"] == 0, (
        f"{row['total']} upstream invoice(s) exist ({row['from_lines']} raised "
        "from billing lines). Read docs/STATUS.md — this was 0 on 2026-09-01"
    )
