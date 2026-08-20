"""Money in, invoice unpaid — and the four ways a matcher lies about it.

Catalogue #16. The skill suggests which unreconciled bank credit settles which
invoice, and the thing that makes it dangerous is that a suggestion here is one
click from becoming a recorded payment against a named client.

So the load-bearing tests are not about matching. They are about the three ways
a match can be confidently wrong:

  · `test_a_tie_is_never_resolved_by_row_order` — the defect this handler exists
    to avoid. `detect/reconciliation_matcher.fuzzy_match_transactions` keeps
    `best_match` under `if conf > best_conf` and returns ONE invoice, so the
    FIRST row of a tie wins and the winner is decided by whatever order Postgres
    returned. Measured live: the seeded org's 42 open credits produce 99
    candidate pairs across 9 credits, so ties are the ordinary case.
  · `test_a_named_match_beats_a_coincidental_amount` — an invoice number in the
    narration IDENTIFIES the invoice; an equal amount is a coincidence that is
    usually right. Blending them into one score loses the distinction the reader
    needs.
  · `test_a_short_invoice_number_is_never_hunted_in_free_text` — a reference
    field carries dates, cheque numbers and UTRs. Looking for "12" inside it
    matches everything, and a false NAMED match is worse than no match because
    named is the kind a person accepts without checking.
  · `test_nothing_here_writes` — a mechanical scan of the module. "Paid" arrives
    from bank reconciliation and from nothing else.

Live figures at the time of writing, read-only 2026-08-20:

  259 statement lines in ONE org (none in the other two), 128 reconciled and
  131 open, 170 of them credits. 42 open credits; 9 have an exact-amount unpaid
  invoice and those 9 yield 99 pairs; 33 match nothing. 11 unpaid invoices have
  their exact balance sitting in an open credit — the mirror.
"""
import ast
import inspect
import json
import re
from datetime import date, timedelta
from pathlib import Path

import pytest

from services.skills.data.bank_matching import (
    AMOUNT_TOLERANCE, MIN_REF_TOKEN, check_unmatched_receipts, _names_the_invoice, _norm,
)

SRC = Path(inspect.getsourcefile(check_unmatched_receipts)).read_text(encoding="utf-8")

ORG = "00000000-0000-4000-8000-000000000016"
TODAY = date(2026, 8, 20)


def _text(out) -> str:
    return json.dumps(out, default=str).lower()


class _Pool:
    """Replays canned result sets, matched on a fragment of the SQL.

    Matched by fragment rather than by call order so inserting a query into the
    handler does not silently shift every fixture by one — which is how a suite
    starts asserting on the wrong rows while staying green.
    """

    def __init__(self, fetch_by=None):
        self.fetch_by = fetch_by or {}
        self.sql_seen: list[str] = []

    async def fetch(self, sql, *args):
        self.sql_seen.append(sql)
        for fragment, payload in self.fetch_by.items():
            if fragment in sql:
                return payload
        return []

    async def fetchrow(self, sql, *args):
        self.sql_seen.append(sql)
        return None

    async def fetchval(self, sql, *args):
        self.sql_seen.append(sql)
        return None


def _line(**kw):
    row = {
        "id": "11111111-1111-4111-8111-111111111111",
        "statement_date": TODAY - timedelta(days=3),
        "description": "NEFT INWARD",
        "reference": "",
        "amount": 25000.00,
        "matched_type": None,
    }
    row.update(kw)
    return row


def _inv(**kw):
    row = {
        "id": "22222222-2222-4222-8222-222222222222",
        "invoice_number": "INV-2026-0042",
        "invoice_date": TODAY - timedelta(days=40),
        "due_date": TODAY - timedelta(days=10),
        "total": 25000.00,
        "balance_due": 25000.00,
        "payment_status": "unpaid",
        "customer": "Sharma Textiles Pvt Ltd",
    }
    row.update(kw)
    return row


def _pool(lines, invoices):
    return _Pool({
        "ganit_bank_statement_lines": lines,
        "FROM staging.ganit_invoices i": invoices,
    })


# ══════════════════════════════════════════════════════════════════════════
# the three answers
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_one_candidate_is_settled_without_a_decision():
    out = await check_unmatched_receipts(_pool([_line()], [_inv()]), ORG)

    assert out["counts"]["settled_by_one_invoice"] == 1
    assert out["counts"]["need_a_decision"] == 0
    row = out["settled_by_one_invoice"][0]
    assert row["invoice"]["invoice_number"] == "INV-2026-0042"
    assert row["settles_in_full"] is True
    assert row["shortfall"] == 0.0


@pytest.mark.asyncio
async def test_a_tie_is_never_resolved_by_row_order():
    """THE headline. Two invoices of the same amount must not produce a winner.

    `fuzzy_match_transactions` would return whichever came back first. On the
    live org 9 credits produce 99 pairs, so this is the ordinary case and not a
    corner. Attributing real money to an arbitrary invoice, one click from
    recording it, is the worst thing this skill could do.
    """
    invoices = [
        _inv(id="a" * 8 + "-aaaa-4aaa-8aaa-" + "a" * 12, invoice_number="INV-2026-0042"),
        _inv(id="b" * 8 + "-bbbb-4bbb-8bbb-" + "b" * 12, invoice_number="INV-2026-0099"),
    ]
    out = await check_unmatched_receipts(_pool([_line()], invoices), ORG)

    assert out["counts"]["settled_by_one_invoice"] == 0
    assert out["counts"]["need_a_decision"] == 1

    row = out["need_a_decision"][0]
    assert row["candidate_count"] == 2
    assert {c["invoice_number"] for c in row["candidates"]} == {
        "INV-2026-0042", "INV-2026-0099"
    }
    # And it must SAY why, not merely omit an answer.
    assert "choosing" in row["why"]


@pytest.mark.asyncio
async def test_money_in_that_matches_nothing_is_reported_not_dropped():
    """A credit no invoice explains is a finding, not an absence.

    33 of the seeded org's 42 open credits are in this state. Dropping them
    would make the skill claim the ledger is nearly clean.
    """
    out = await check_unmatched_receipts(
        _pool([_line(amount=98765.43)], [_inv(balance_due=25000.00)]), ORG,
    )

    assert out["counts"]["money_in_nothing_matches"] == 1
    assert out["counts"]["settled_by_one_invoice"] == 0
    assert "no unpaid invoice" in out["money_in_nothing_matches"][0]["why"]


# ══════════════════════════════════════════════════════════════════════════
# reference before amount — catalogue #17's argument
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_a_named_match_beats_a_coincidental_amount():
    """An invoice number in the narration identifies; an equal amount guesses.

    The named invoice wins even though a DIFFERENT invoice carries the exact
    amount — and the result says it matched on the reference, so the reader
    knows which kind of claim they are looking at.
    """
    invoices = [
        _inv(id="c" * 8 + "-cccc-4ccc-8ccc-" + "c" * 12,
             invoice_number="INV-2026-0042", balance_due=31000.00),
        _inv(id="d" * 8 + "-dddd-4ddd-8ddd-" + "d" * 12,
             invoice_number="INV-2026-0777", balance_due=25000.00),
    ]
    line = _line(amount=25000.00, reference="UPI/INV-2026-0042/SHARMA")
    out = await check_unmatched_receipts(_pool([line], invoices), ORG)

    assert out["counts"]["settled_by_one_invoice"] == 1
    row = out["settled_by_one_invoice"][0]
    assert row["matched_on"] == "reference"
    assert row["invoice"]["invoice_number"] == "INV-2026-0042"


@pytest.mark.asyncio
async def test_a_named_part_payment_says_what_is_left():
    """Accepting a settlement and accepting a part payment are different
    decisions, so the shortfall is stated rather than hidden."""
    line = _line(amount=10000.00, reference="INV-2026-0042")
    out = await check_unmatched_receipts(
        _pool([line], [_inv(balance_due=25000.00)]), ORG,
    )

    row = out["settled_by_one_invoice"][0]
    assert row["settles_in_full"] is False
    assert row["shortfall"] == 15000.00


def test_the_separators_a_bank_strips_do_not_break_a_named_match():
    """`INV-2026-0042` arrives as `INV20260042`, `INV/2026/0042` and
    `inv 2026 0042` in the same statement file."""
    for text in ("UPI/INV20260042/SHARMA", "NEFT INV/2026/0042",
                 "rtgs inv 2026 0042 sharma", "INV-2026-0042"):
        assert _names_the_invoice(_norm(text), "INV-2026-0042"), text


def test_a_short_invoice_number_is_never_hunted_in_free_text():
    """A reference field carries dates, cheque numbers and UTRs.

    A false NAMED match is worse than no match: named is the kind a person
    accepts without checking.
    """
    assert not _names_the_invoice(_norm("NEFT 12 AUG SALARY 12345678"), "12")
    assert not _names_the_invoice(_norm("CHQ 007 CLEARING"), "7")
    # …and the threshold is what makes that true, not a lucky fixture.
    assert MIN_REF_TOKEN >= 4


# ══════════════════════════════════════════════════════════════════════════
# the mirror
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_the_mirror_names_invoices_whose_money_is_already_in():
    """The half a receivables chase gets wrong.

    Chasing a client whose money is already sitting in the bank is the single
    most damaging thing a collection skill can do. 11 of the seeded org's
    invoices are in this state.
    """
    out = await check_unmatched_receipts(_pool([_line()], [_inv()]), ORG)

    assert out["counts"]["invoices_whose_money_is_already_in"] == 1
    assert out["invoices_whose_money_is_already_in"][0]["invoice_number"] == "INV-2026-0042"


@pytest.mark.asyncio
async def test_an_ambiguous_credit_still_puts_every_candidate_in_the_mirror():
    """A credit that cannot be attributed still means those invoices should not
    be chased — the money is in, the attribution is the open question."""
    invoices = [
        _inv(id="a" * 8 + "-aaaa-4aaa-8aaa-" + "a" * 12, invoice_number="INV-1111"),
        _inv(id="b" * 8 + "-bbbb-4bbb-8bbb-" + "b" * 12, invoice_number="INV-2222"),
    ]
    out = await check_unmatched_receipts(_pool([_line()], invoices), ORG)

    assert out["counts"]["invoices_whose_money_is_already_in"] == 2


# ══════════════════════════════════════════════════════════════════════════
# the promises the module makes about itself
# ══════════════════════════════════════════════════════════════════════════

def test_nothing_here_writes():
    """'Paid' arrives from bank reconciliation and from nothing else."""
    for verb in ("insert into", "update ", "delete from", "upsert"):
        assert verb not in SRC.lower().replace("update the", ""), verb


def test_every_query_is_scoped_to_one_org():
    tree = ast.parse(SRC)
    sqls = [
        n.value for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and "FROM staging." in n.value
    ]
    assert sqls, "no SQL found — the extraction is wrong, not the handler"
    for sql in sqls:
        assert "org_id = $1::uuid" in sql, sql


def test_both_graha_joins_carry_org_id():
    """The FK on graha_clients is on the id ALONE, so an id-only join can print
    another practice's client name. Measured live; see migration 163."""
    for m in re.finditer(r"LEFT JOIN staging\.graha_(\w+) (\w+)\s+ON ([^\n]+)", SRC):
        assert "org_id" in m.group(3), m.group(0)


def test_an_amount_tolerance_is_absolute_not_a_percentage():
    """2% of a ₹5,00,000 invoice is ₹10,000, which is a different payment.

    A relative band is the right shape for a measurement error and the wrong one
    for a bank transfer, which is exact or is not the same payment. The existing
    matcher uses 2% relative; this deliberately does not.
    """
    assert AMOUNT_TOLERANCE <= 1.0
    assert "/ balance" not in SRC and "% " not in SRC.split('"""')[-1]


@pytest.mark.asyncio
async def test_it_says_when_it_cannot_tell_empty_from_never_imported():
    """An org that has reconciled every line and one that has never imported a
    statement both hold zero open credits. Silence would read as a clean
    ledger."""
    out = await check_unmatched_receipts(_pool([], []), ORG)

    assert out["counts"]["open_credits_examined"] == 0
    assert "never imported" in _text(out)


@pytest.mark.asyncio
async def test_the_payer_limitation_is_always_stated():
    """There is no counterparty column. A credit from a stranger looks exactly
    like one from a known client, and the reader must be told."""
    out = await check_unmatched_receipts(_pool([_line()], [_inv()]), ORG)

    assert any("payer is not recorded" in l for l in out["limitations"])
    assert any("never records a payment" in l for l in out["limitations"])


@pytest.mark.asyncio
async def test_a_truncated_candidate_list_says_it_was_truncated():
    """A capped list that does not say so is how a reader comes to believe there
    were only five."""
    invoices = [
        _inv(id=f"{i:08d}-0000-4000-8000-000000000000", invoice_number=f"INV-{i:04d}")
        for i in range(9)
    ]
    out = await check_unmatched_receipts(_pool([_line()], invoices), ORG)

    row = out["need_a_decision"][0]
    assert row["candidate_count"] == 9
    assert len(row["candidates"]) == 5
    assert row["candidates_not_shown"] == 4


@pytest.mark.asyncio
async def test_it_can_run_from_the_org_and_the_calendar_alone():
    """Every parameter defaults, or no schedule can ever run it — the exact
    failure that left `match_bank_transactions` unrunnable."""
    params = inspect.signature(check_unmatched_receipts).parameters
    required = [
        n for n, p in params.items()
        if n not in ("pool", "org_id") and p.default is inspect.Parameter.empty
    ]
    assert not required, required


@pytest.mark.asyncio
async def test_no_uuid_reaches_the_reader_as_the_customer():
    """Names, not ids — the product-wide rule. The ids present are row handles
    the UI acts on, never the thing shown as who paid."""
    out = await check_unmatched_receipts(_pool([_line()], [_inv()]), ORG)

    for row in out["settled_by_one_invoice"]:
        assert not re.fullmatch(r"[0-9a-f-]{36}", row["invoice"]["customer"] or "")
        assert row["invoice"]["customer"] == "Sharma Textiles Pvt Ltd"
