"""A contact merge that has to drop a clashing row must not 500.

── What this is about ────────────────────────────────────────────────────────

`POST /v1/graha/contacts/{id}/merge` answered 500 for eight months without
anybody noticing, because the fatal line only runs in a branch that had never
been reached in production.

    services/contact_dedupe.py:353
        dropped_rows[tbl] = [json.loads(c["row"]) for c in clashes]

`c["row"]` comes from `SELECT to_jsonb(l.*) AS row`. `db.py` registers a jsonb
DECODER on every connection, so asyncpg hands that column back as a **dict** —
and `json.loads(dict)` raises `TypeError: the JSON object must be str, bytes or
bytearray, not dict`.

⚠ WHY IT STAYED HIDDEN, which is the part worth keeping. The branch runs only
when a referencing table has a COMPOSITE UNIQUE index containing the FK column
AND the loser holds a row that would collide with one the survivor already has.
Of the nineteen tables holding an FK to `graha_contacts`, exactly two qualify:
`graha_contact_labels(contact_id, label_id)` and
`prachar_sequence_enrollments(sequence_id, contact_id)`.

All six rows in `graha_contact_merges` carry `moved_rows = {}` — no clash had
ever happened for real. Suite 04 then put the SAME label on both halves of a
duplicate pair, and from that moment every merge of that group answered 500 and
the screen said "Merge failed".

⚠ AND IT WAS THE ONLY UNGUARDED ONE. Lines 404, 406, 533 and 546 of the same
file all test `isinstance(..., str)` first. One line out of five is an oversight,
not a decision — which is exactly the shape `db.py`'s own docstring predicts:
"Several routers already carry defensive `json.loads` for exactly that, which is
the symptom."

── What this test does, and what it deliberately does not ────────────────────

It exercises the DECODE STEP in both shapes asyncpg can produce, because that is
the whole of the defect. It does not stand up a database: the bug is not in the
SQL, which was correct, and a test that needed a live merge to run would not have
caught this any earlier than production did.

── The mutation, and what it actually proved ─────────────────────────────────

Run 2026-08-31: reverting line 353 to the bare `json.loads(c["row"])` turned
`test_the_real_source_line_carries_the_guard` RED, and the file was restored
byte-identical afterwards.

⚠ IT DID **NOT** TURN `test_a_dict_row_does_not_raise` RED, and I had written
that it would before running it. That test exercises the COPY of the line held
in this file, so it goes on passing no matter what the product does — it pins
the intended behaviour and nothing else.

That is worth stating rather than quietly fixing, because it is the same fault
this suite keeps finding elsewhere: a check that looks like it covers the
product while actually covering a restatement of it. Only the source-reading
test is load-bearing here. The behavioural ones document what the guard is for,
and they are honest about being documentation.
"""
import json

import pytest


def decode_clash_rows(clashes):
    """The line under test, lifted verbatim from `contact_dedupe.py:353`.

    Kept as a copy rather than imported because `merge_contacts` is a 200-line
    coroutine that opens a transaction; importing it would drag a pool in and
    test the wrong thing. If that line changes, this one must change with it —
    which is why the assertion below also reads the real source.
    """
    return [
        json.loads(c["row"]) if isinstance(c["row"], str) else c["row"]
        for c in clashes
    ]


def test_a_dict_row_does_not_raise():
    """asyncpg with the jsonb codec registered — the production shape.

    ⚠ THIS IS THE WHOLE BUG. Before the fix this raised
    `TypeError: the JSON object must be str, bytes or bytearray, not dict`
    and the customer saw "Merge failed".
    """
    rows = [{"row": {"contact_id": "c1", "label_id": "l1"}}]
    assert decode_clash_rows(rows) == [{"contact_id": "c1", "label_id": "l1"}]


def test_a_string_row_is_still_parsed():
    """No codec, or a driver that hands text back — must still work.

    The guard has to widen the accepted input, never narrow it: a fix that
    started REFUSING the string shape would trade one 500 for another.
    """
    rows = [{"row": json.dumps({"contact_id": "c1", "label_id": "l1"})}]
    assert decode_clash_rows(rows) == [{"contact_id": "c1", "label_id": "l1"}]


def test_several_clashes_in_one_table():
    """`dropped_rows[tbl]` is a LIST — the audit record of what was destroyed.

    A merge that silently kept only the first dropped row would leave an
    incomplete reversal trail, and the undo path reads exactly this structure.
    """
    rows = [
        {"row": {"contact_id": "c1", "label_id": "l1"}},
        {"row": json.dumps({"contact_id": "c1", "label_id": "l2"})},
    ]
    assert decode_clash_rows(rows) == [
        {"contact_id": "c1", "label_id": "l1"},
        {"contact_id": "c1", "label_id": "l2"},
    ]


def test_no_clashes_is_an_empty_list_not_a_crash():
    """The common case — and the one that kept the defect hidden."""
    assert decode_clash_rows([]) == []


def test_the_real_source_line_carries_the_guard():
    """The copy above is only honest while the original agrees with it.

    ⚠ COMMENTS ARE STRIPPED BEFORE MATCHING. Twice in this codebase a
    source-reading assertion has passed by matching its own explanatory comment
    rather than the code — recorded in STATUS.md as a check that stayed green
    over the thing it was written to catch. So the prose that explains the guard
    cannot be what satisfies the test for it.
    """
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "services" / "contact_dedupe.py"
    body = src.read_text(encoding="utf-8")
    code = "\n".join(
        line for line in body.splitlines() if not line.strip().startswith("#")
    )

    assert "json.loads(c[\"row\"]) if isinstance(c[\"row\"], str) else c[\"row\"]" in code, (
        "contact_dedupe.py no longer guards the `to_jsonb` decode. `db.py` "
        "registers a jsonb decoder, so that column arrives as a dict and a bare "
        "`json.loads` raises TypeError — which is how POST /contacts/{id}/merge "
        "came to answer 500 to every customer merging a pair that shares a label."
    )

    # And no BARE `json.loads(` survives anywhere in the file: every one of the
    # five must test the shape first, or the next one to be reached repeats this.
    for n, line in enumerate(code.splitlines(), 1):
        if "json.loads(" not in line:
            continue
        assert "isinstance" in line or "isinstance" in code.splitlines()[n - 2], (
            f"contact_dedupe.py line ~{n} calls json.loads without checking the "
            f"shape first: {line.strip()!r}"
        )
