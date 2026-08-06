"""The admission test — the rule that decides whether an answer is shown at all.

`sahayak.css` states the contract in its first paragraph: "an answer that cannot
point at where it came from is not shown. Every claim carries a <cite>, and the
cite is a control." That sentence is only true if something ENFORCES it, and a
model handed a transcript will produce a fourth bullet nobody said which reads
exactly like the three real ones.

`routers/sanvaad_sahayak._points_from_model` is that enforcement, and these are
the cases that would otherwise ship a fabricated claim in a card the reader has
no reason to distrust:

  · a cite that names a transcript line outside the window,
  · a point with no cites at all,
  · a point whose every cite is bad,
  · a cite that is not a number.

None of these are hypothetical failure shapes. Every one of them is a thing an
LLM does when asked for JSON with citations, and all four are invisible on
screen: the card renders, the sentence is fluent, and there is nothing to see.

`build_transcript` is tested for the property the whole scheme rests on — the
numbers the model is told to cite are POSITIONS in this call's window and never
message ids, so a permuted uuid cannot become a citation of a different real
message.

No database and no network: these are pure functions and they are pure so that
this file can exist.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("JWT_SECRET", "test-secret")

from routers.sanvaad_sahayak import (  # noqa: E402
    ASKS,
    _loads,
    _parse_since,
    _points_from_model,
    build_transcript,
)

M1 = "11111111-1111-1111-1111-111111111111"
M2 = "22222222-2222-2222-2222-222222222222"
M3 = "33333333-3333-3333-3333-333333333333"


def _rows():
    base = datetime(2026, 8, 4, 10, 0, tzinfo=timezone.utc)
    return [
        {"id": M1, "parent_message_id": None, "sender_name": "Anil Verma",
         "content": "HSN 7208 is right for hot-rolled coil.", "created_at": base},
        {"id": M2, "parent_message_id": M1, "sender_name": "Rohan Mehta",
         "content": "Patched both invoices.", "created_at": base + timedelta(minutes=4)},
        {"id": M3, "parent_message_id": None, "sender_name": "Priya Shah",
         "content": "Filing on the 20th, after your sign-off.",
         "created_at": base + timedelta(minutes=9)},
    ]


# ── build_transcript ────────────────────────────────────────────────────────

def test_the_model_is_shown_positions_and_never_message_ids():
    """A uuid in the prompt is a uuid the model can permute into a different
    real message, and nobody reading the card could tell."""
    text, index = build_transcript(_rows())
    for mid in (M1, M2, M3):
        assert mid not in text
    assert index[1]["message_id"] == M1
    assert index[3]["message_id"] == M3
    assert text.startswith("[1] Anil Verma at ")


def test_a_reply_is_marked_as_one_and_carries_its_root():
    """A decision taken in a thread is still a decision, so replies are in the
    window — but a cite to one has to be able to OPEN it, and the client cannot
    expand a thread it was not told the root of."""
    text, index = build_transcript(_rows())
    assert "[2] Rohan Mehta (in a thread) at " in text
    assert index[2]["parent_message_id"] == M1
    assert index[1]["parent_message_id"] is None


def test_a_message_is_clipped_so_one_paste_cannot_evict_the_window():
    rows = _rows()
    rows[0]["content"] = "x" * 5000
    text, _ = build_transcript(rows)
    assert len(text.splitlines()[0]) < 700
    assert text.splitlines()[0].endswith("…")


# ── the admission test ──────────────────────────────────────────────────────

def _index():
    return build_transcript(_rows())[1]


def test_a_fabricated_cite_deletes_the_claim_that_carries_it():
    """THE CASE THIS FILE EXISTS FOR. `[9]` is not in a three-message window, so
    the sentence quoting it is not a summary of anything."""
    points, dropped = _points_from_model(
        {"points": [
            {"text": "Real thing.", "cites": [1]},
            {"text": "Nobody said this.", "cites": [9]},
        ]},
        _index(),
    )
    assert [p["text"] for p in points] == ["Real thing."]
    assert dropped == 1


def test_a_point_with_no_cites_is_not_shown():
    points, dropped = _points_from_model(
        {"points": [{"text": "Sounds plausible.", "cites": []}]}, _index(),
    )
    assert points == []
    assert dropped == 1


def test_a_partly_bad_cite_list_keeps_the_point_and_loses_the_bad_half():
    points, dropped = _points_from_model(
        {"points": [{"text": "Both invoices were patched.", "cites": [2, 88, "x"]}]},
        _index(),
    )
    assert dropped == 0
    assert len(points) == 1
    assert [c["message_id"] for c in points[0]["cites"]] == [M2]


def test_a_repeated_cite_is_rendered_once():
    points, _ = _points_from_model(
        {"points": [{"text": "One thing.", "cites": [1, 1, 1]}]}, _index(),
    )
    assert len(points[0]["cites"]) == 1


def test_a_reply_that_is_not_json_yields_nothing_rather_than_a_guess():
    assert _points_from_model(None, _index()) == ([], 0)
    assert _points_from_model({"points": "sorry"}, _index()) == ([], 0)
    assert _points_from_model({}, _index()) == ([], 0)


def test_the_card_is_capped():
    many = {"points": [{"text": f"p{i}", "cites": [1]} for i in range(20)]}
    points, _ = _points_from_model(many, _index())
    assert len(points) == 6


# ── reading the model's reply ───────────────────────────────────────────────

def test_a_fenced_reply_is_read_rather_than_lost():
    assert _loads('```json\n{"points":[]}\n```') == {"points": []}
    assert _loads('Here you go:\n{"points":[]}') == {"points": []}


def test_an_unreadable_reply_is_none_and_not_a_fragment():
    assert _loads("I could not do that.") is None
    assert _loads('{"points": [') is None


# ── the window ──────────────────────────────────────────────────────────────

def test_a_clock_ahead_of_the_server_widens_the_window_instead_of_emptying_it():
    """A client whose clock runs fast would otherwise select zero messages and
    be told the channel is quiet while it is not."""
    ahead = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    assert _parse_since(ahead) is None


def test_an_unparseable_since_degrades_rather_than_422s():
    assert _parse_since("last tuesday") is None
    assert _parse_since("") is None
    assert _parse_since(None) is None


def test_since_is_floored_so_a_client_cannot_ask_for_the_whole_channel():
    floored = _parse_since("1970-01-01T00:00:00Z")
    assert floored is not None
    assert (datetime.now(timezone.utc) - floored) <= timedelta(days=31)


def test_a_z_suffix_parses():
    dt = _parse_since("2026-08-04T10:00:00Z")
    assert dt is not None and dt.tzinfo is not None


def test_the_ask_list_is_closed():
    """Free text over a transcript is a different product: every message in the
    window is attacker-controlled, so the reader picks and the prompt is ours."""
    assert set(ASKS) == {"catch_up", "decided", "open"}
