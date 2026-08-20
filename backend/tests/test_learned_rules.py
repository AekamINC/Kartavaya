"""Catalogue #55 — and the four ways a skill built on an empty column lies.

The column this handler reads is NULL on every row in the product. Migration
175 added it and created no write path, so the interesting tests here are not
about rule derivation at all — they are about what the output says when there
is nothing to derive:

  · `test_an_empty_column_is_never_a_clean_result` — the headline failure of
    the whole "Later" tier. A handler that queries an unwritten column, finds
    no conflicts and returns `{"rules": []}` has told a chartered accountant
    their bank categorisation is in good order. It has never been attempted.
  · `test_no_data_and_no_categorisation_are_different_states` — two of the
    three live orgs have no bank lines at all and one has 259 uncategorised
    ones. Those are different questions unasked and must not read alike.
  · `test_a_conflicted_stem_never_becomes_a_rule` — "usually rent" printed as
    "rent" is the confident wrong answer that costs a firm's trust.
  · `test_a_matcher_label_is_never_dressed_as_a_human_decision` — matched_type
    is the only signal that exists today and it has ONE class across the whole
    product. Presenting it as a learned categorisation would be the most
    plausible-looking lie available.
  · `test_nothing_here_reaches_a_model` — an AST walk. The folio held #42 back
    precisely so this would not become "a model reads your bank statement every
    month", and a comment saying so is not a guarantee.

Live figures at the time of writing, read-only 2026-08-20: 259 statement lines
in ONE org (Aekam Inc and Unicode Group hold zero); category / categorised_by /
categorised_at populated on 0 of 259; matched_type on 128 of 259, every one of
them `invoice_payment`; one matcher rule reaching 32 undecided lines; 13 repeat
narrations awaiting a first decision; residual of 227.
"""
import ast
import asyncio
import inspect
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from services.skills.data.learned_rules import (
    DEFAULT_MIN_OCCURRENCES, MATCHER_CONFIDENCE, MIN_TOKEN_LEN, RAIL_TOKENS,
    SCAN_CAP, _stem, _window_start, brief_learned_categorisation,
)

SRC = Path(inspect.getsourcefile(brief_learned_categorisation)).read_text(encoding="utf-8")

ORG = "00000000-0000-4000-8000-000000000055"
OTHER_ORG = "00000000-0000-4000-8000-000000000056"
AWARE = datetime(2026, 8, 18, 9, 30, tzinfo=timezone.utc)


def _text(out) -> str:
    """The whole output as one lowercase string — how a reader or a model
    actually receives it."""
    return json.dumps(out, default=str).lower()


def _body(out) -> str:
    """The output WITHOUT `limitations`.

    An absence assertion made against the full blob is worthless: the caveat
    explaining why a thing is not claimed necessarily contains the thing.
    """
    trimmed = {k: v for k, v in out.items() if k != "limitations"}
    return json.dumps(trimmed, default=str).lower()


class _Pool:
    """Replays canned result sets, matched on a FRAGMENT of the SQL.

    By fragment and not by call order, so inserting a query into the handler
    does not silently shift every fixture by one — which is how a suite starts
    asserting on the wrong rows while staying green.
    """

    def __init__(self, totals=None, lines=None):
        self._totals = totals
        self._lines = lines or []
        self.sql_seen: list[str] = []
        self.args_seen: list[tuple] = []

    async def fetchrow(self, sql, *args):
        self.sql_seen.append(sql)
        self.args_seen.append(args)
        if "count(*)" in sql and "lines_total" in sql:
            return self._totals
        return None

    async def fetch(self, sql, *args):
        self.sql_seen.append(sql)
        self.args_seen.append(args)
        if "FROM staging.ganit_bank_statement_lines l" in sql:
            return self._lines
        return []

    async def fetchval(self, sql, *args):
        self.sql_seen.append(sql)
        return None


def _totals(**over):
    base = {
        "lines_total": 0, "lines_in_window": 0, "with_category": 0,
        "with_categorised_by": 0, "with_categorised_at": 0,
        "distinct_categories": 0, "with_matched_type": 0,
        "distinct_matched_types": 0, "first_line": None, "last_line": None,
    }
    base.update(over)
    return base


def _line(description, category=None, decided_by=None, categorised_at=None,
          matched_type=None, statement_date=date(2026, 7, 1)):
    return {
        "statement_date": statement_date, "description": description,
        "category": category, "categorised_at": categorised_at,
        "matched_type": matched_type, "decided_by": decided_by,
    }


def _run(pool, **kw):
    return asyncio.run(brief_learned_categorisation(pool, ORG, **kw))


# ══════════════════════════════════════════════════════════════════════════
# The lies
# ══════════════════════════════════════════════════════════════════════════

def test_an_empty_column_is_never_a_clean_result():
    """259 lines, not one categorised — the exact live state of the product.

    The output must not be readable as "no problems found". It must say the
    check could not be made, name the denominator, and name the column.
    """
    pool = _Pool(_totals(lines_total=259, lines_in_window=259),
                 [_line("NEFT-Shree Ganesh Suppliers & Co") for _ in range(5)])
    out = _run(pool)

    assert out["state"] == "no_categorisation_recorded"
    assert out["could_not_check"] is True
    assert out["human_rules"] == []
    # The denominator, in the headline, not buried three keys down.
    assert "0 of 259" in out["headline"]
    assert out["counts"]["lines_with_human_category"] == 0
    assert out["counts"]["lines_total"] == 259

    caveats = " ".join(out["limitations"]).lower()
    assert "could not check" in caveats
    assert "category" in caveats
    # And it must not read as an all-clear anywhere outside the caveats.
    body = _body(out)
    for all_clear in ("no issues", "all clear", "looks good", "no problems",
                      "nothing to report", "in good order"):
        assert all_clear not in body, f"an empty column read as {all_clear!r}"


def test_no_data_and_no_categorisation_are_different_states():
    """Two of the three live orgs hold no bank lines at all.

    "We have never seen a statement from you" and "you have never categorised
    a line" are different unasked questions. If they produced the same output
    the reader could not tell which one they were being told.
    """
    empty = _run(_Pool(_totals(), []))
    uncategorised = _run(_Pool(_totals(lines_total=259, lines_in_window=259),
                               [_line("NEFT-Ganga Printers")]))

    assert empty["state"] == "no_bank_data"
    assert uncategorised["state"] == "no_categorisation_recorded"
    assert empty["headline"] != uncategorised["headline"]
    assert empty["could_not_check"] is uncategorised["could_not_check"] is True
    # Both say the question was not asked, and each says WHICH question.
    assert "no bank statement line" in empty["headline"].lower()
    assert "0 of 259" in uncategorised["headline"]


def test_a_conflicted_stem_never_becomes_a_rule():
    """The same narration decided two ways is a conflict, not a majority vote.

    Four rows say 'bank charges', three of them 'bank_charges' and one
    'interest'. A handler that emitted `bank charges -> bank_charges` because
    it is more common has invented a rule the firm never agreed.
    """
    lines = [
        _line("Bank charges 001", "bank_charges", "Asha", AWARE),
        _line("Bank charges 002", "bank_charges", "Asha", AWARE),
        _line("Bank charges 003", "bank_charges", "Ravi",
              datetime(2026, 7, 4, tzinfo=timezone.utc)),
        _line("Bank charges 004", "interest", "Ravi",
              datetime(2026, 7, 5, tzinfo=timezone.utc)),
    ]
    out = _run(_Pool(_totals(lines_total=4, lines_in_window=4, with_category=4,
                             with_categorised_by=4, with_categorised_at=4,
                             distinct_categories=2), lines))

    assert out["state"] == "learnable"
    assert out["human_rules"] == [], "a conflicted stem was emitted as a rule"
    assert len(out["human_conflicts"]) == 1
    conflict = out["human_conflicts"][0]
    assert conflict["narration_starts_with"] == "bank charges"
    assert {d["label"] for d in conflict["decided_as"]} == {"bank_charges", "interest"}
    assert conflict["times_total"] == 4


def test_a_rule_from_one_person_on_one_day_is_labelled_not_hidden():
    """Migration 175: WHO and WHEN are what make it evidence rather than a
    guess. So a single-sitting rule ships WITH the label, and a corroborated
    one is distinguishable from it."""
    single = [
        _line(f"NEFT-Shree Ganesh Suppliers {i}", "purchases", "Asha", AWARE)
        for i in range(3)
    ]
    out = _run(_Pool(_totals(lines_total=3, lines_in_window=3, with_category=3,
                             with_categorised_by=3, with_categorised_at=3,
                             distinct_categories=1), single))
    assert len(out["human_rules"]) == 1
    assert out["human_rules"][0]["confidence"] == "single sitting"
    assert out["human_rules"][0]["distinct_deciders"] == 1

    spread = [
        _line("NEFT-Shree Ganesh Suppliers 1", "purchases", "Asha", AWARE),
        _line("NEFT-Shree Ganesh Suppliers 2", "purchases", "Ravi",
              datetime(2026, 7, 4, tzinfo=timezone.utc)),
        _line("NEFT-Shree Ganesh Suppliers 3", "purchases", "Ravi",
              datetime(2026, 7, 9, tzinfo=timezone.utc)),
    ]
    out2 = _run(_Pool(_totals(lines_total=3, lines_in_window=3, with_category=3,
                              with_categorised_by=3, with_categorised_at=3,
                              distinct_categories=1), spread))
    assert out2["human_rules"][0]["confidence"] == "corroborated"
    assert out2["human_rules"][0]["distinct_deciders"] == 2


def test_a_one_word_stem_is_labelled_too_broad():
    """'credit' is a real live stem and it would match half a bank statement.
    It is emitted — dropping it would understate what the firm decided — and
    it is labelled so nobody adopts it unread."""
    lines = [_line(f"E2E NEFT credit {i}", "receipts", "Asha", AWARE)
             for i in range(4)]
    out = _run(_Pool(_totals(lines_total=4, lines_in_window=4, with_category=4,
                             with_categorised_by=4, with_categorised_at=4,
                             distinct_categories=1), lines))
    assert out["human_rules"][0]["narration_starts_with"] == "credit"
    assert out["human_rules"][0]["confidence"] == "too broad"


def test_a_matcher_label_is_never_dressed_as_a_human_decision():
    """The only populated signal in the product, and the easiest thing to
    misrepresent.

    A matcher rule must be marked as one, must carry no fabricated decider or
    decision date, and the single-class problem must be stated — 128 of 128
    live labels are `invoice_payment`, so the tier can only say "this has been
    a receipt before".
    """
    lines = [_line(f"UPI/PMT-INV-2607-{i:03d}", matched_type="invoice_payment")
             for i in range(5)] + [_line("NEFT-Ganga Printers 1")]
    out = _run(_Pool(_totals(lines_total=6, lines_in_window=6,
                             with_matched_type=5, distinct_matched_types=1),
                     lines))

    assert out["human_rules"] == []
    assert len(out["matcher_rules"]) == 1
    rule = out["matcher_rules"][0]
    assert rule["source"] == "matcher"
    assert rule["confidence"] == MATCHER_CONFIDENCE
    assert "weaker" in rule["confidence"]
    # No invented provenance: the matcher has no decider and no decision date.
    assert rule["distinct_deciders"] is None
    assert rule["distinct_days"] is None

    caveats = " ".join(out["limitations"]).lower()
    assert "weaker" in caveats
    assert "one class" in caveats or "1 distinct" in caveats


def test_the_matcher_tier_does_not_fill_the_human_headline():
    """A matcher rule must not move `state` off could_not_check.

    This is the subtle version of the empty-column lie: 128 matcher labels
    look like plenty of evidence, and if the headline counted them the reader
    would never learn that no human has categorised anything.
    """
    lines = [_line(f"UPI/PMT-INV-2607-{i:03d}", matched_type="invoice_payment")
             for i in range(10)]
    out = _run(_Pool(_totals(lines_total=10, lines_in_window=10,
                             with_matched_type=10, distinct_matched_types=1),
                     lines))
    assert out["state"] == "no_categorisation_recorded"
    assert out["could_not_check"] is True
    assert out["counts"]["matcher_rules"] == 1
    assert out["counts"]["human_rules"] == 0


def test_the_write_path_is_named_precisely():
    """"Name the column and the screen that would need to write it" is half
    the deliverable. A vague "this needs data" is not actionable and is exactly
    what left #55 unbuilt for a year."""
    out = _run(_Pool(_totals(lines_total=259, lines_in_window=259),
                     [_line("NEFT-Ganga Printers")]))
    wp = out["write_path"]
    assert wp["written_by_anything_today"] is False
    assert any("category" in c for c in wp["columns"])
    assert any("categorised_by" in c for c in wp["columns"])
    assert any("categorised_at" in c for c in wp["columns"])
    change = wp["the_one_change"]
    assert "bank-statements" in change and "match" in change
    assert "ganit.py" in change
    assert "reconciliation" in wp["screen"].lower()


def test_awaiting_rows_say_what_the_matcher_already_knows():
    """The largest waiting narration live is 160 lines of which 128 already
    carry a matcher label. Reported bare it reads as 160 unknowns and points a
    firm at the one place the product already has a hint."""
    lines = ([_line(f"UPI/PMT-INV-2607-{i:03d}", matched_type="invoice_payment")
              for i in range(4)]
             + [_line(f"UPI/PMT-INV-2504-{i:03d}") for i in range(2)])
    out = _run(_Pool(_totals(lines_total=6, lines_in_window=6,
                             with_matched_type=4, distinct_matched_types=1),
                     lines))
    waiting = out["narrations_awaiting_a_first_decision"]
    assert waiting and waiting[0]["narration_starts_with"] == "pmt inv"
    assert waiting[0]["lines_waiting"] == 6
    assert waiting[0]["already_labelled_by_the_matcher"] == 4


# ══════════════════════════════════════════════════════════════════════════
# The contract
# ══════════════════════════════════════════════════════════════════════════

def test_output_survives_json_dumps_and_carries_the_two_required_keys():
    out = _run(_Pool(_totals(lines_total=259, lines_in_window=259),
                     [_line("NEFT-Ganga Printers")]))
    json.dumps(out, default=str)
    assert isinstance(out["counts"], dict)
    assert isinstance(out["limitations"], list) and out["limitations"]
    assert all(isinstance(s, str) and s for s in out["limitations"])


def test_every_parameter_after_org_id_has_a_default():
    """A handler with a required parameter cannot be scheduled, and the
    dispatcher refuses it. Two GST handlers shipped that way once."""
    sig = inspect.signature(brief_learned_categorisation)
    names = list(sig.parameters)
    assert names[:2] == ["pool", "org_id"]
    for name in names[2:]:
        assert sig.parameters[name].default is not inspect.Parameter.empty, name


def test_every_query_is_tenant_scoped_and_schema_qualified():
    pool = _Pool(_totals(lines_total=1, lines_in_window=1), [_line("NEFT-X Ltd")])
    _run(pool)
    assert pool.sql_seen, "the handler issued no query at all"
    for sql in pool.sql_seen:
        assert "org_id = $1::uuid" in sql, sql
        assert "staging.ganit_bank_statement_lines" in sql, sql
        assert re.search(r"\bfrom\s+ganit_", sql, re.I) is None, \
            f"unqualified table reference: {sql}"


def test_no_user_id_is_ever_rendered():
    """`categorised_by` is a `user_xxxxxxxx` id and this product renders names.
    The id must not leave the database — the SELECT resolves it and never
    returns the raw column."""
    lines = [_line(f"NEFT-Shree Ganesh Suppliers {i}", "purchases",
                   "Asha Menon", AWARE) for i in range(3)]
    pool = _Pool(_totals(lines_total=3, lines_in_window=3, with_category=3,
                         with_categorised_by=3, with_categorised_at=3,
                         distinct_categories=1), lines)
    out = _run(pool)
    blob = _text(out)
    assert "user_" not in blob
    assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
                         r"[0-9a-f]{4}-[0-9a-f]{12}", blob), \
        "a uuid was rendered in the output"
    # And the id is resolved in SQL, not selected raw and hidden later.
    scan = [s for s in pool.sql_seen if "LEFT JOIN public.users" in s]
    assert scan, "categorised_by is not resolved to a name"
    assert "l.categorised_by," not in scan[0], "the raw user id was selected"


def test_the_display_cap_never_shrinks_the_evidence():
    """`limit` caps the LISTS. If it also capped the scan, a rule could lose
    the occurrences that made it a rule and vanish below the threshold."""
    lines = [_line(f"NEFT-Shree Ganesh Suppliers {i}", "purchases", "Asha", AWARE)
             for i in range(6)]
    pool = _Pool(_totals(lines_total=6, lines_in_window=6, with_category=6,
                         with_categorised_by=6, with_categorised_at=6,
                         distinct_categories=1), lines)
    out = _run(pool, limit=1)
    assert out["human_rules"][0]["learned_from_lines"] == 6
    scan_args = [a for s, a in zip(pool.sql_seen, pool.args_seen)
                 if "LIMIT $3::int" in s]
    assert scan_args and scan_args[0][2] == SCAN_CAP


def test_a_capped_list_says_it_was_capped():
    payees = ("Ganga Printers", "Laxmi Enterprises", "Sai Computers",
              "Metro Solutions", "Balaji Traders")
    lines = []
    for payee in payees:
        lines += [_line(f"NEFT-{payee} {i}") for i in range(3)]
    out = _run(_Pool(_totals(lines_total=15, lines_in_window=15), lines), limit=2)
    assert len(out["narrations_awaiting_a_first_decision"]) == 2
    assert any("not shown" in s for s in out["limitations"])
    assert any("capped" in s for s in out["limitations"])


def test_min_occurrences_is_honoured_and_clamped():
    lines = [_line(f"NEFT-Ganga Printers {i}", "printing", "Asha", AWARE)
             for i in range(2)]
    totals = _totals(lines_total=2, lines_in_window=2, with_category=2,
                     with_categorised_by=2, with_categorised_at=2,
                     distinct_categories=1)
    assert DEFAULT_MIN_OCCURRENCES == 3
    assert _run(_Pool(totals, lines))["human_rules"] == []
    assert len(_run(_Pool(totals, lines), min_occurrences=2)["human_rules"]) == 1
    # A stored 0 must not turn every narration into a rule via a crash or a
    # divide — it clamps to 1 and the output says which threshold it used.
    out = _run(_Pool(totals, lines), min_occurrences=0)
    assert out["min_occurrences"] == 1


def test_the_window_is_month_arithmetic_not_days():
    assert _window_start(date(2026, 8, 20), 24) == date(2024, 8, 1)
    assert _window_start(date(2026, 1, 15), 1) == date(2025, 12, 1)
    assert _window_start(date(2026, 8, 20), 0) == date(2026, 7, 1)


# ══════════════════════════════════════════════════════════════════════════
# The stemmer
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("narration,expected", [
    ("NEFT-Shree Ganesh Suppliers & Co", "shree ganesh suppliers"),
    ("IMPS Shree Ganesh Suppliers", "shree ganesh suppliers"),
    ("UPI/PMT-INV-2607-007", "pmt inv"),
    ("UPI/PMT-INV-2504-008", "pmt inv"),
    # 'hq0o7' contains a digit and is dropped WHOLE. Stripping the digits
    # instead would leave the fragment 'hq' — under the length floor here, but
    # a five-letter reference would have survived and forked the stem.
    ("E2E bank charges hq0o7", "bank charges"),
    ("UTR000000236849", ""),
    ("", ""),
    (None, ""),
])
def test_the_stem_is_the_shape_not_the_number(narration, expected):
    """Two payments to the same payee differ only by a running number, and a
    stemmer that keeps the number learns nothing from either."""
    assert _stem(narration) == expected


def test_an_all_letter_reference_is_dropped_only_once_the_corpus_proves_it():
    """The live fragmentation case, and the reason `_stem` takes a corpus.

    'E2E NEFT credit tbqbi' has no digit in its reference, so nothing
    positional can tell 'tbqbi' from a payee. Seen alone it stays; seen
    against a statement where nine such lines each carry a different
    once-only trailing word, every one of those words is a reference and the
    nine lines collapse to one shape.
    """
    alone = "E2E NEFT credit tbqbi"
    assert _stem(alone) == "credit tbqbi"
    assert _stem(alone, frozenset({"tbqbi"})) == "credit"
    # A leading once-only word is NEVER dropped: 'acme' and 'zenith' seen once
    # each must not both collapse onto the shared word and become one rule.
    assert _stem("NEFT-Acme Ltd", frozenset({"acme", "zenith"})) == "acme ltd"
    assert _stem("NEFT-Zenith Ltd", frozenset({"acme", "zenith"})) == "zenith ltd"


def test_a_bank_reference_never_forks_one_payment_into_nine_rules():
    """End to end on the live shape: nine identical payments whose only
    difference is a five-letter reference must form ONE waiting narration, not
    nine singletons that never reach the threshold."""
    refs = ("tbqbi", "hqxoz", "wvrpk", "vkfcm", "ivmaq",
            "fvajs", "lixio", "exnwa", "ucxyz")
    lines = [_line(f"E2E NEFT credit {r}") for r in refs]
    out = _run(_Pool(_totals(lines_total=9, lines_in_window=9), lines))
    waiting = out["narrations_awaiting_a_first_decision"]
    assert len(waiting) == 1
    assert waiting[0]["narration_starts_with"] == "credit"
    assert waiting[0]["lines_waiting"] == 9
    assert out["counts"]["reference_words_dropped_from_shapes"] == len(refs)
    assert any("appears exactly once" in s for s in out["limitations"])


def test_an_empty_stem_is_never_a_rule():
    """A narration of pure digits and rail words stems to ''. Emitting that as
    a rule ships a catch-all dressed up as a pattern."""
    lines = [_line(f"UTR00000023684{i}", "receipts", "Asha", AWARE)
             for i in range(5)]
    out = _run(_Pool(_totals(lines_total=5, lines_in_window=5, with_category=5,
                             with_categorised_by=5, with_categorised_at=5,
                             distinct_categories=1), lines))
    assert out["human_rules"] == []
    assert out["narrations_awaiting_a_first_decision"] == []


def test_rail_tokens_are_rails_and_never_payees():
    """A payee word in this set would silently merge two unrelated firms into
    one rule. Every entry must be a payment rail or a reference word."""
    for token in RAIL_TOKENS:
        assert token.isalpha() and token == token.lower(), token
        assert len(token) >= MIN_TOKEN_LEN, (
            f"{token!r} is shorter than a token the stemmer keeps, so it can "
            f"never match anything and is dead weight")
    assert "shree" not in RAIL_TOKENS
    assert "bank" not in RAIL_TOKENS
    assert "charges" not in RAIL_TOKENS
    assert "credit" not in RAIL_TOKENS


# ══════════════════════════════════════════════════════════════════════════
# The two standing promises
# ══════════════════════════════════════════════════════════════════════════

def test_nothing_here_writes():
    """It reads. Recording a categorisation nobody made is worse than
    recording none, and "paid" only ever arrives from bank reconciliation."""
    tree = ast.parse(SRC)
    executed = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute)
                and func.attr in ("fetch", "fetchrow", "fetchval", "execute")):
            continue
        assert node.args, "a query call with no SQL argument"
        first = node.args[0]
        assert isinstance(first, ast.Constant) and isinstance(first.value, str), (
            "SQL is built dynamically here — every query in this module must "
            "be a literal with bind parameters")
        executed.append(first.value.lower())

    assert executed, "no query calls found — this scan would pass over nothing"
    for sql in executed:
        for verb in ("insert", "update", "delete", "truncate", "alter", "create"):
            assert verb not in sql, f"this module executes a write: {verb!r}"
        assert sql.strip().startswith("select") or "select" in sql


def test_nothing_here_reaches_a_model():
    """The whole reason #55 is a separate catalogue entry.

    Without a write path, #42's "residual tail" is every line, and the folio's
    warning is that it degrades into "a model reads your bank statement every
    month". A comment promising not to is not a guarantee; this is.
    """
    tree = ast.parse(SRC)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.add(node.module or "")
    banned = ("ai", "llm", "gemini", "anthropic", "openai", "model", "hub",
              "srijan", "sahayak", "prompt", "credits")
    for name in imported:
        low = name.lower()
        assert not any(b in low.split(".") for b in banned), \
            f"learned_rules imports {name!r} — it must reach no model"
    assert "services.ai" not in SRC
    assert "generate(" not in SRC


def test_the_module_declares_zero_model_calls_on_the_output():
    out = _run(_Pool(_totals(lines_total=259, lines_in_window=259),
                     [_line("NEFT-Ganga Printers")]))
    assert out["model_use"]["calls_made"] == 0
    assert isinstance(out["model_use"]["residual_lines_a_model_would_have_read"], int)
    assert any("no model call" in s.lower() for s in out["limitations"])
