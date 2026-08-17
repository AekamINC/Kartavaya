"""WhatsApp is a send. `OUTBOUND_MODE=dry` must stop it, and it did not.

WHY THIS FILE EXISTS
--------------------
`outbound.py` listed WhatsApp as deliberately unguarded, gave the reason ("it
does not send today"), and left an instruction: "When that TODO is implemented,
guard it here before it ships." P7 implemented it. Nobody came back to the line.

For nine days the only channel whose recipient is somebody else's CUSTOMER, on a
number that customer pays Meta for, was the one channel the kill switch did not
reach — and `outbound_log`, which is this product's only answer to "what has
this system ever sent", never saw a single WhatsApp message.

It never fired, because `varta_business_accounts` is empty. That is luck, not a
control. This file is the control.

WHAT IT ASSERTS, AND WHY EACH ONE
- suppressed means Meta is NOT CALLED. Not called-and-ignored: the HTTP request
  to graph.facebook.com must not happen, because a message Meta accepts cannot
  be recalled by anything we do afterwards.
- a suppressed message is recorded as `failed`, never as `pending`. `pending` is
  what a message waiting on Meta's `statuses` webhook looks like; a suppressed
  one is never coming back, so `pending` would leave it indistinguishable from
  the dead-button failure this route was written to remove.
- the attempt reaches `outbound_log` either way. A send nobody logged is a send
  nobody can answer for.
- the message BODY never reaches the log. It is a private message to somebody
  else's client; the log records that a send happened, not what it said.
"""
from __future__ import annotations

import ast
import io
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _send_wa_message_source() -> str:
    """The body of the route, isolated from the rest of the module."""
    src = io.open(ROOT / "routers" / "whatsapp.py", encoding="utf-8").read()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "send_wa_message":
            return ast.get_source_segment(src, node) or ""
    raise AssertionError("send_wa_message no longer exists in routers/whatsapp.py")


def test_the_meta_call_is_inside_the_gate():
    """Structural, not textual: the call must be nested under the `with`.

    A comment saying "guarded" is what the previous version of this path had.
    """
    fn = ast.parse(_send_wa_message_source()).body[0]

    guarded, unguarded = [], []

    class Visitor(ast.NodeVisitor):
        def __init__(self, inside: bool):
            self.inside = inside

        def visit_With(self, node: ast.With):
            is_gate = any(
                isinstance(item.context_expr, ast.Call)
                and ast.unparse(item.context_expr.func).endswith("outbound.sending")
                for item in node.items
            )
            for child in node.body:
                Visitor(self.inside or is_gate).visit(child)

        def visit_Call(self, node: ast.Call):
            name = ast.unparse(node.func)
            if name.endswith("_send_via_meta"):
                (guarded if self.inside else unguarded).append(name)
            self.generic_visit(node)

    for stmt in fn.body:
        Visitor(False).visit(stmt)

    assert not unguarded, (
        "_send_via_meta is reachable without passing through outbound.sending() "
        "— OUTBOUND_MODE=dry would not stop a WhatsApp message"
    )
    assert guarded, "the Meta call vanished; this test is now watching nothing"


def _blocked_branch_sql() -> list[str]:
    """The SQL the suppressed branch runs — string CONSTANTS only, no comments.

    The first version of this helper scanned raw source text between
    `att.blocked` and `_send_via_meta`. That span included the author's own
    comment block, which says "suppressed" twice — so the assertion "the reason
    must be recorded" was satisfied by prose about the row rather than by the
    row. Review proved it by replacing the real `error_code` value and watching
    the file stay green.
    """
    fn = ast.parse(_send_wa_message_source()).body[0]
    for node in ast.walk(fn):
        if not isinstance(node, ast.If):
            continue
        test = ast.unparse(node.test)
        if test == "not att.blocked":
            body = node.orelse
        elif test == "att.blocked":
            body = node.body
        else:
            continue
        return [n.value for stmt in body for n in ast.walk(stmt)
                if isinstance(n, ast.Constant) and isinstance(n.value, str)]
    raise AssertionError("no att.blocked branch found in send_wa_message")


def test_a_suppressed_message_is_never_recorded_as_pending():
    """`pending` means 'waiting on Meta'. A suppressed message waits on nothing."""
    sql = " ".join(_blocked_branch_sql())
    assert "failed" in sql, "the suppressed branch must record a terminal status"
    assert "pending" not in sql, \
        "a suppressed message recorded as pending is indistinguishable from a dead button"
    assert "suppressed" in sql, \
        "the REASON must be in the row, not only in a comment about the row"


def test_the_send_sits_inside_the_condition_that_permits_it():
    """Not `if att.blocked: ... return`.

    That shape rests the whole guard on one `return`: delete the line and a
    blocked send falls through to Meta while still writing a suppressed-looking
    row — and a nesting check still passes, because the call is still lexically
    inside the `with`. Review found exactly that hole. `if not att.blocked:` has
    no fall-through to delete.
    """
    fn = ast.parse(_send_wa_message_source()).body[0]
    for node in ast.walk(fn):
        if isinstance(node, ast.If) and ast.unparse(node.test) == "not att.blocked":
            calls = [ast.unparse(n.func) for stmt in node.body
                     for n in ast.walk(stmt) if isinstance(n, ast.Call)]
            assert any(c.endswith("_send_via_meta") for c in calls), \
                "the Meta call must live inside `if not att.blocked:`"
            return
    raise AssertionError(
        "send_wa_message no longer guards the send with `if not att.blocked:` — "
        "if it uses `if att.blocked: ... return` instead, deleting one line "
        "re-opens the channel with every test in this file still green"
    )


def test_the_behavioural_proof_lives_next_door():
    """THE ONLY TEST THAT DRIVES THE ROUTE IS IN ANOTHER FILE.

    Everything here is a source scan, and a source scan cannot prove a blocked
    send never reaches the network — only that the code is shaped as though it
    will not. `test_varta_window_and_connect.py::
    test_the_kill_switch_stops_the_send_even_inside_the_window` drives the real
    handler with the gate shut and a stubbed Graph call. If that test goes, this
    file is decoration.
    """
    other = io.open(ROOT / "tests" / "test_varta_window_and_connect.py",
                    encoding="utf-8").read()
    assert "test_the_kill_switch_stops_the_send_even_inside_the_window" in other, \
        ("the behavioural kill-switch test is gone; the checks in this file are "
         "structural only and cannot replace it")


def test_the_gate_never_carries_the_message_body():
    """`detail` is a subject or a title. Here the body is a private message to
    somebody else's customer, so only the template NAME may travel."""
    src = _send_wa_message_source()
    call = src[src.index("outbound.sending("):]
    call = call[:call.index(") as att:")]
    assert "content" not in call, \
        "the message body must not be passed to outbound_log"
    assert "template_name" in call, "the template name is what identifies the send"


def test_outbound_no_longer_claims_whatsapp_is_unguarded():
    """The exemption list is documentation people act on. It named its own expiry
    condition and outlived it by nine days; it must not say that again."""
    doc = io.open(ROOT / "outbound.py", encoding="utf-8").read()
    header = doc[:doc.index("── WHY THE LOG LIVES HERE TOO")]
    exempt = header[header.index("Deliberately NOT guarded:"):]
    assert "routers/whatsapp.py" not in exempt.split("GUARDED SINCE")[0], \
        "outbound.py still lists WhatsApp among the deliberately unguarded channels"


@pytest.mark.parametrize("channel", ["whatsapp"])
def test_the_channel_name_is_one_word_the_log_can_group_on(channel):
    """`outbound_log` is read by grouping on channel. `whatsapp:send` and
    `whatsapp` would split one channel into two in every report."""
    src = _send_wa_message_source()
    call = src[src.index("outbound.sending("):]
    assert f'"{channel}"' in call[:120], \
        f"the gate should open on the bare channel name {channel!r}"
