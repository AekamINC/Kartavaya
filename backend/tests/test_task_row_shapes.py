"""`tasks`' jsonb columns arrive in TWO shapes, and both are live.

── The gap this closes ──────────────────────────────────────────────────────

`_pj` in `server.py` has a `str` branch and a non-`str` branch, and its
docstring explains at length why both are load-bearing. What nothing checked
was that the test suite ever took the second one.

`tests/helpers.py::make_task_row` seeded `attachments`, `custom_fields` and
`subtasks` as `"[]"` / `"{}"` — STRINGS. Every test built on that helper went
down the `str` branch. Measured on the live table 2026-08-27:

    jsonb_typeof(subtasks)   array  431
                             string  54      -- of 485 rows

So the fixture modelled 11% of production and called it the default, and the
89% path — the one a pooled connection with working codecs always takes — was
never exercised through that helper at all.

The fixture now defaults to the DECODED shape. This file is what keeps the
other one covered, deliberately and by name, rather than by accident.

── Why the string shape is not a bug to be deleted ──────────────────────────

Two independent real causes, and neither is speculative:

  · the 54 double-encoded rows, dumped once by a caller and once more by the
    codec, left over from before the fix `db.py::_json_encoder` describes.
    Every one of them is the text `'[]'` — an EMPTY list, so no subtask data is
    at risk. They will not repair themselves; only a data migration can, and
    that is a write against the shared production database.
  · `_init_conn` WARNS rather than raises when PgBouncer kills the codec
    handshake three times, and hands the connection out anyway. Such a
    connection returns every jsonb column as text.

Both must keep working. Neither may become the assumed default.
"""
import json

import pytest

from tests.helpers import make_task_row


@pytest.fixture(scope="module")
def row_to_task():
    import server
    return server.row_to_task


def test_the_fixture_hands_back_the_shape_the_DRIVER_hands_back(row_to_task):
    """The regression guard on `helpers.py` itself.

    If somebody reverts these three to strings, every suite built on this
    fixture silently stops testing the majority path again — and nothing else
    would notice, because `_pj` accepts both and the output is identical.
    """
    row = make_task_row()
    assert isinstance(row["subtasks"], list), (
        "make_task_row seeds `subtasks` as a string again — 431 of 485 live "
        "rows are a decoded list, and the suite is back to testing the 11%")
    assert isinstance(row["attachments"], list)
    assert isinstance(row["custom_fields"], dict)


def test_the_decoded_shape_round_trips(row_to_task):
    """The 89% path: a pooled connection with codecs registered."""
    out = row_to_task(make_task_row(
        subtasks=[{"subtask_id": "sub_fixed01", "title": "Draft", "is_done": False}],
        attachments=[],
        custom_fields={"client_ref": "AB/1"},
    ))
    assert [s.title for s in out.subtasks] == ["Draft"]
    assert out.custom_fields == {"client_ref": "AB/1"}
    assert out.attachments == []


def test_the_string_shape_round_trips_IDENTICALLY(row_to_task):
    """The 11% path — the 54 double-encoded rows, and a codec-less connection.

    Asserted as EQUAL to the decoded result rather than merely "does not
    raise": the point of `_pj` is that the two shapes are indistinguishable to
    every caller downstream, and a test that only checked for the absence of an
    exception would pass while the two diverged.
    """
    # `subtask_id` by name: `Subtask` MINTS a random one when it is absent,
    # so a fixture using the wrong key makes the two shapes differ for a reason
    # that has nothing to do with jsonb.
    payload = [{"subtask_id": "sub_fixed01", "title": "Draft", "is_done": False}]
    decoded = row_to_task(make_task_row(
        subtasks=payload, custom_fields={"client_ref": "AB/1"}))
    stringy = row_to_task(make_task_row(
        subtasks=json.dumps(payload),
        custom_fields=json.dumps({"client_ref": "AB/1"})))

    assert stringy.subtasks == decoded.subtasks
    assert stringy.custom_fields == decoded.custom_fields


def test_the_54_live_rows_shape_exactly_no_subtasks(row_to_task):
    """Every one of the 54 double-encoded rows is the text `'[]'`.

    Measured, not assumed — which is what makes the repair trivial whenever it
    is approved: there is no subtask data to lose. Until then this is the shape
    that must not raise, because it is what those rows really hold.
    """
    out = row_to_task(make_task_row(subtasks="[]"))
    assert out.subtasks == []


@pytest.mark.parametrize("empty", [None, "", "[]", []])
def test_no_representation_of_empty_raises(row_to_task, empty):
    """`None` is reachable too — the column is nullable on older rows, and
    `_pj('')` must not be a `json.loads('')` crash."""
    assert row_to_task(make_task_row(subtasks=empty)).subtasks == []
