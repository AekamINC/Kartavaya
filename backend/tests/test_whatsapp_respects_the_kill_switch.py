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


def test_a_suppressed_message_is_never_recorded_as_pending():
    """`pending` means 'waiting on Meta'. A suppressed message waits on nothing."""
    src = _send_wa_message_source()
    blocked = src[src.index("att.blocked"):]
    blocked = blocked[:blocked.index("_send_via_meta")]
    assert "'failed'" in blocked or '"failed"' in blocked, \
        "the suppressed branch must record a terminal status"
    assert "'pending'" not in blocked and '"pending"' not in blocked, \
        "a suppressed message recorded as pending is indistinguishable from a dead button"
    assert "suppressed" in blocked, "the reason must be recorded, not just the failure"


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
