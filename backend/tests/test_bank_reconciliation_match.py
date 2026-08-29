"""Bank reconciliation — a table that could not be reconciled by any route.

`ganit_bank_statement_lines.matched_type` carries a CHECK, written in migration
039 and still live in the database today:

    CHECK (matched_type IS NULL
           OR matched_type = ANY (ARRAY['invoice_payment', 'vendor_payment']))

Both matchers wrote something else. The import matcher wrote `'auto'`, the
manual endpoint wrote `'manual'` — WHO matched the line rather than WHAT it
matched — so every UPDATE that would have reconciled anything was rejected by
the constraint. Two independent faults sat on top of each other: the manual
endpoint also had no control anywhere in the UI, so the only route to it was
hand-writing a payment UUID into a URL, and the only route that a user could
actually reach 500'd.

THE CONSTRAINT WAS RIGHT AND THE CODE WAS WRONG. The column is a ledger
discriminator, and the proof is in the data: all 128 reconciled rows in the
database carry 'invoice_payment', written by the seed. So the fix is a code fix.
No migration was written, because a migration here would have widened a correct
constraint to admit a value that answers a different question.

These tests are anchored to the MIGRATION FILE rather than to a hard-coded list,
so the code and the schema cannot drift apart again without something going red.
Source assertions strip comments first — this repo has shipped checks satisfied
by their own commentary.
"""
import io
import re
import tokenize
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

import routers.ganit as ganit

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "039_bank_reconciliation.sql"


def _permitted_from_migration() -> set:
    """The values the CHECK constraint actually allows, read from the schema."""
    sql = MIGRATION.read_text(encoding="utf-8")
    m = re.search(r"matched_type\s+IN\s*\(([^)]*)\)", sql)
    assert m, "039 no longer declares a matched_type IN (...) list — read the constraint again"
    values = set(re.findall(r"'([a-z_]+)'", m.group(1)))
    assert values, "the CHECK list parsed empty"
    return values


def _source_without_comments(obj) -> str:
    """Source with `#` comments removed, string literals kept.

    The SQL lives in string literals, so those have to survive; the prose does
    not, and prose is how a grep ends up matching the explanation of the bug
    instead of the bug.
    """
    import inspect

    text = inspect.getsource(obj)
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        if tok.type == tokenize.COMMENT:
            continue
        out.append(tok.string)
    return "\n".join(out)


# ── The vocabulary, tied to the schema ─────────────────────────────────────

def test_the_code_declares_exactly_the_vocabulary_the_constraint_permits():
    """The anchor. If either side moves without the other, this goes red."""
    assert set(ganit.BANK_MATCH_TYPES) == _permitted_from_migration()


def test_no_matched_type_literal_in_the_module_is_one_the_database_rejects():
    """The exact regression, in the shape it shipped in.

    `matched_type='auto'` and `matched_type='manual'` both live in this module's
    SQL and Python. Every literal assigned to that name — in either language —
    must be a value the CHECK admits.
    """
    permitted = _permitted_from_migration()
    src = _source_without_comments(ganit)
    written = set(re.findall(r"matched_type\s*=\s*[\"']([A-Za-z_]+)[\"']", src))
    assert written, "no matched_type literal found at all — has the module been restructured?"
    rejected = written - permitted
    assert not rejected, f"these would be refused by the live CHECK: {sorted(rejected)}"


def test_the_retired_provenance_values_are_gone_from_the_module():
    """`re.sub(r"\\s+")`, not `.replace(" ", "")`.

    The tokeniser rejoins source with newlines, so stripping only spaces left
    `matched_type\\n=\\n"manual"` intact and this check could never fail — it
    passed against a deliberately reintroduced bug. Collapsing all whitespace is
    what makes it a check rather than a comment.
    """
    src = re.sub(r"\s+", "", _source_without_comments(ganit))
    for dead in ("'auto'", '"auto"', "'manual'", '"manual"'):
        assert f"matched_type={dead}" not in src, \
            f"matched_type is being set to {dead} again"


# ── choose_bank_match — the decision, without a database ───────────────────

def test_a_credit_matches_a_customer_receipt():
    got = ganit.choose_bank_match(
        59000,
        [{"id": "pay-1", "amount": Decimal("59000.00")}],
        [{"id": "vp-1", "amount": Decimal("59000.00")}],
    )
    assert got == ("pay-1", "invoice_payment")


def test_a_debit_matches_a_vendor_payment():
    """Money out cannot be a customer receipt, whatever the amount says."""
    got = ganit.choose_bank_match(
        -25000,
        [{"id": "pay-1", "amount": Decimal("25000.00")}],
        [{"id": "vp-1", "amount": Decimal("25000.00")}],
    )
    assert got == ("vp-1", "vendor_payment")


def test_a_debit_with_no_vendor_payment_stays_unmatched():
    """Before this change a debit could not be reconciled by any route at all."""
    assert ganit.choose_bank_match(
        -25000, [{"id": "pay-1", "amount": Decimal("25000.00")}], []) is None


def test_decimal_and_float_are_the_same_money():
    """asyncpg returns Decimal, the browser sends float. `Decimal('59000.00')
    != 59000.0` in Python, and that inequality would silently match nothing."""
    assert ganit.choose_bank_match(
        59000.0, [{"id": "p", "amount": Decimal("59000.00")}], []) == ("p", "invoice_payment")
    assert ganit.choose_bank_match(
        1234.56, [{"id": "p", "amount": Decimal("1234.56")}], []) == ("p", "invoice_payment")


def test_two_identical_receipts_are_refused_rather_than_guessed():
    """A firm billing two clients the same retainer on the same day is ordinary.
    The old matcher took whichever row came back first and wrote that coin toss
    into the books."""
    assert ganit.choose_bank_match(
        59000,
        [{"id": "p1", "amount": Decimal("59000.00")},
         {"id": "p2", "amount": Decimal("59000.00")}],
        [],
    ) is None


def test_a_zero_line_matches_nothing():
    assert ganit.choose_bank_match(0, [{"id": "p", "amount": 0}], []) is None


def test_every_type_it_can_ever_return_is_one_the_database_permits():
    """A property, not an example: no input produces an unwritable value."""
    permitted = _permitted_from_migration()
    receipts = [{"id": "p", "amount": Decimal("100.00")}]
    vendors = [{"id": "v", "amount": Decimal("100.00")}]
    for amount in (100, -100, 100.0, -100.0, Decimal("100.00"), Decimal("-100.00")):
        got = ganit.choose_bank_match(amount, receipts, vendors)
        assert got is not None
        assert got[1] in permitted


# ── rank_bank_candidates — what the picker shows first ─────────────────────

def test_the_exact_amount_is_offered_first():
    cands = [
        {"id": "a", "amount": Decimal("50000.00"), "payment_date": date(2026, 8, 1)},
        {"id": "b", "amount": Decimal("59000.00"), "payment_date": date(2026, 7, 20)},
    ]
    ranked = ganit.rank_bank_candidates(59000, date(2026, 8, 1), cands)
    assert [c["id"] for c in ranked] == ["b", "a"]
    assert ranked[0]["amount_matches"] is True
    assert ranked[1]["amount_matches"] is False


def test_among_equal_amounts_the_nearest_date_wins():
    cands = [
        {"id": "far", "amount": Decimal("59000.00"), "payment_date": date(2026, 1, 1)},
        {"id": "near", "amount": Decimal("59000.00"), "payment_date": date(2026, 8, 2)},
    ]
    ranked = ganit.rank_bank_candidates(59000, date(2026, 8, 1), cands)
    assert [c["id"] for c in ranked] == ["near", "far"]


def test_a_candidate_without_a_date_still_sorts():
    """A missing date must not raise inside the sort and take the picker down."""
    ranked = ganit.rank_bank_candidates(
        59000, date(2026, 8, 1),
        [{"id": "x", "amount": Decimal("59000.00"), "payment_date": None}],
    )
    assert ranked[0]["id"] == "x"


def test_ranking_does_not_mutate_what_it_was_given():
    src = [{"id": "a", "amount": Decimal("1.00"), "payment_date": date(2026, 8, 1)}]
    ganit.rank_bank_candidates(1, date(2026, 8, 1), src)
    assert "amount_matches" not in src[0]


# ── The endpoints, over a fake pool ────────────────────────────────────────

class _MatchPool:
    """Answers the manual-match endpoint's four questions and records the write."""

    def __init__(self, *, line=True, in_receipts=True, in_vendor=False, clash=False):
        self.line = line
        self.in_receipts = in_receipts
        self.in_vendor = in_vendor
        self.clash = clash
        self.updates = []

    async def fetchrow(self, q, *a):
        # The match write moved into a transaction with the Niyam emitter and
        # became `UPDATE ... RETURNING id`, so the write the assertions read
        # is recorded HERE now, not in execute(). The RETURNING row makes the
        # handler proceed to the invoice re-read, which answers None below —
        # so these tests stay about the write, and the emission path has its
        # own suite (test_niyam_wiring_ganit.py).
        if "UPDATE public.ganit_bank_statement_lines" in q:
            self.updates.append(a)
            return {"id": a[2]}
        if "FROM public.ganit_invoices" in q:
            return None
        if "FROM public.ganit_bank_statement_lines" in q and self.line:
            return {"id": a[0], "amount": Decimal("59000.00"),
                    "statement_date": date(2026, 8, 1), "is_reconciled": False}
        return None

    async def fetchval(self, q, *a):
        if "FROM public.ganit_payments" in q:
            return 1 if self.in_receipts else None
        if "FROM public.ganit_vendor_payments" in q:
            return 1 if self.in_vendor else None
        if "FROM public.ganit_bank_statement_lines" in q:
            return 1 if self.clash else None
        return None

    async def execute(self, q, *a):
        if "UPDATE public.ganit_bank_statement_lines" in q:
            self.updates.append(a)

    async def fetch(self, *a, **k):
        return []

    # A minimal acquire()/transaction() shim so the handler's `async with`
    # blocks run. These tests assert the WRITE, never connection identity --
    # the emitter-rides-the-write's-conn-in-transaction contract is pinned in
    # test_niyam_wiring_ganit.py, whose fakes lend real per-acquire conns.
    def acquire(self):
        pool = self

        class _A:
            async def __aenter__(_s):
                return pool

            async def __aexit__(_s, *exc):
                return False
        return _A()

    def transaction(self):
        class _T:
            async def __aenter__(_s):
                return _s

            async def __aexit__(_s, *exc):
                return False
        return _T()


def _use(monkeypatch, pool):
    async def _get_pool():
        return pool
    monkeypatch.setattr(ganit, "get_pool", _get_pool)


@pytest.mark.asyncio
async def test_a_manual_match_writes_a_value_the_constraint_accepts(monkeypatch):
    """The whole defect, end to end: what reaches the UPDATE must be writable."""
    pool = _MatchPool(in_receipts=True)
    _use(monkeypatch, pool)
    out = await ganit.match_bank_line(
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        user={"user_id": "u1"}, org_id="org1",
    )
    assert out["matched_type"] == "invoice_payment"
    assert pool.updates, "nothing was written"
    written = pool.updates[0][1]
    assert written in _permitted_from_migration(), \
        f"{written!r} is refused by the live CHECK — this is the original bug"


@pytest.mark.asyncio
async def test_the_ledger_the_payment_lives_in_decides_the_type(monkeypatch):
    pool = _MatchPool(in_receipts=False, in_vendor=True)
    _use(monkeypatch, pool)
    out = await ganit.match_bank_line(
        "11111111-1111-1111-1111-111111111111",
        "33333333-3333-3333-3333-333333333333",
        user={"user_id": "u1"}, org_id="org1",
    )
    assert out["matched_type"] == "vendor_payment"
    assert pool.updates[0][1] == "vendor_payment"


@pytest.mark.asyncio
async def test_a_payment_in_neither_ledger_is_a_404(monkeypatch):
    pool = _MatchPool(in_receipts=False, in_vendor=False)
    _use(monkeypatch, pool)
    with pytest.raises(ganit.HTTPException) as e:
        await ganit.match_bank_line("l1", "p1", user={"user_id": "u1"}, org_id="org1")
    assert e.value.status_code == 404
    assert not pool.updates


@pytest.mark.asyncio
async def test_a_payment_already_matched_elsewhere_is_refused(monkeypatch):
    """Otherwise the matched total counts the same money on two lines."""
    pool = _MatchPool(in_receipts=True, clash=True)
    _use(monkeypatch, pool)
    with pytest.raises(ganit.HTTPException) as e:
        await ganit.match_bank_line("l1", "p1", user={"user_id": "u1"}, org_id="org1")
    assert e.value.status_code == 409
    assert not pool.updates


@pytest.mark.asyncio
async def test_the_match_update_is_scoped_to_the_org(monkeypatch):
    """A line id from another org must not be writable through this route."""
    pool = _MatchPool(in_receipts=True)
    _use(monkeypatch, pool)
    await ganit.match_bank_line("l1", "p1", user={"user_id": "u1"}, org_id="org1")
    src = _source_without_comments(ganit.match_bank_line)
    assert "AND org_id=$4::uuid" in src


@pytest.mark.asyncio
async def test_the_importer_never_claims_one_payment_twice(monkeypatch):
    """Two identical lines in one paste must not both take the same receipt."""
    receipts = [
        {"id": "p1", "amount": Decimal("59000.00"), "payment_date": date(2026, 8, 1)},
    ]
    lines = [
        {"id": "l1", "amount": Decimal("59000.00"), "statement_date": date(2026, 8, 1),
         "reference": "UTR1"},
        {"id": "l2", "amount": Decimal("59000.00"), "statement_date": date(2026, 8, 1),
         "reference": "UTR2"},
    ]
    updates = []

    class _Pool:
        async def execute(self, q, *a):
            if "UPDATE public.ganit_bank_statement_lines" in q:
                updates.append(a)

        async def fetch(self, q, *a):
            # Order matters: the candidate queries name the statement-lines
            # table inside their NOT IN subquery, so the ledger tables have to
            # be tested for first or every query looks like the line fetch.
            if "FROM public.ganit_payments" in q:
                return receipts
            if "FROM public.ganit_vendor_payments" in q:
                return []
            if "FROM public.ganit_bank_statement_lines" in q:
                return lines
            return []

        async def fetchrow(self, q, *a, **k):
            # The auto-match write is `UPDATE ... RETURNING id` in a
            # transaction now (it emits invoice.paid when a receipt settles
            # an invoice) — record it here, answer the invoice re-read with
            # None so no emission complicates a test about claim-dedupe.
            if "UPDATE public.ganit_bank_statement_lines" in q:
                updates.append(a)
                return {"id": a[2]}
            return None

        def acquire(self):
            pool = self

            class _A:
                async def __aenter__(_s):
                    return pool

                async def __aexit__(_s, *exc):
                    return False
            return _A()

        def transaction(self):
            class _T:
                async def __aenter__(_s):
                    return _s

                async def __aexit__(_s, *exc):
                    return False
            return _T()

    _use(monkeypatch, _Pool())
    body = ganit.BankStatementImport(lines=[
        ganit.BankStatementLine(statement_date="2026-08-01", description="Receipt",
                                amount=59000),
        ganit.BankStatementLine(statement_date="2026-08-01", description="Receipt",
                                amount=59000),
    ])
    out = await ganit.import_bank_statement(body, user={"user_id": "u1"}, org_id="org1")
    assert out["auto_matched"] == 1, "the same receipt was claimed twice"
    assert len(updates) == 1
    assert updates[0][1] in _permitted_from_migration()


@pytest.mark.asyncio
async def test_the_candidates_endpoint_offers_the_right_ledger(monkeypatch):
    """A debit line must be offered vendor payments, not customer receipts."""
    asked = {}

    class _Pool:
        async def fetchrow(self, q, *a):
            return {"id": "l1", "amount": Decimal("-25000.00"),
                    "statement_date": date(2026, 8, 1), "is_reconciled": False}

        async def fetch(self, q, *a):
            asked["q"] = q
            return [{"id": "v1", "amount": Decimal("25000.00"),
                     "payment_date": date(2026, 8, 1), "reference": "NEFT",
                     "document": "BILL-1", "party": "Landlord"}]

    _use(monkeypatch, _Pool())
    out = await ganit.bank_line_candidates("l1", user={"user_id": "u1"}, org_id="org1")
    assert out["ledger"] == "vendor_payment"
    assert "public.ganit_vendor_payments" in asked["q"]
    assert out["data"][0]["amount_matches"] is True


@pytest.mark.asyncio
async def test_candidates_for_a_line_that_is_not_yours_is_a_404(monkeypatch):
    class _Pool:
        async def fetchrow(self, *a, **k):
            return None

        async def fetch(self, *a, **k):
            raise AssertionError("must not query payments for a line it could not find")

    _use(monkeypatch, _Pool())
    with pytest.raises(ganit.HTTPException) as e:
        await ganit.bank_line_candidates("nope", user={"user_id": "u1"}, org_id="org1")
    assert e.value.status_code == 404
