"""A campaign that reached nobody may not say it was sent.

THE DISEASE, AND WHY IT CAME BACK
---------------------------------
`send_email` returns True when the outbound gate SUPPRESSED the message. That is
deliberate — the operator asked for nothing to leave the building, and the
caller succeeded at doing nothing. But it means a return value cannot tell
"delivered to a provider" from "stopped at the door", and every caller that
trusts it writes `status='sent'` over a message nobody received.

`adc980b8` cured this for reminders, after 1,562 of them recorded 'sent' against
1,562 `outbound_log` rows that recorded 'suppressed' — a perfect 1:1, meaning
nothing this product had ever called a reminder had reached a human.

It was cured in `reminder_service.py` and left standing in **Prachar**, the
module whose entire job is sending, driven by a daily cron. Both of its send
paths — the skill runner and the interactive route — had the same bug.

WHAT THESE TESTS PIN
- both paths consult the gate itself, not `send_email`'s return value
- a suppressed contact is terminal and is NOT 'sent'
- a campaign where nothing left is not 'sent', and its `sent_at` stays NULL
- the reason is recorded, so the row explains itself to whoever reads it next
"""
from __future__ import annotations

import ast
import io
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

PATHS = {
    "skill runner": ROOT / "services" / "skills" / "action" / "campaign_sender.py",
    "interactive route": ROOT / "routers" / "prachar.py",
}


def _src(path: pathlib.Path) -> str:
    return io.open(path, encoding="utf-8").read()


@pytest.mark.parametrize("label", sorted(PATHS))
def test_the_path_reads_the_gate_not_the_return_value(label):
    """`outbound.is_suppressed(org)` must be consulted. Nothing else can tell
    the difference between a send and a suppression — and it must be the
    PREDICATE, not `outbound.DRY_RUN`: the per-org list suppresses a listed
    org in a LIVE process, where DRY_RUN reads False, so the bare mode stamps
    'sent' over mail the gate refused (the same disease, one switch over)."""
    src = _src(PATHS[label])
    tree = ast.parse(src)
    reads = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute) and n.func.attr == "is_suppressed"
        and isinstance(n.func.value, ast.Name) and n.func.value.id == "outbound"
    ]
    assert reads, (
        f"{label} never calls outbound.is_suppressed, so it cannot know "
        "whether anything actually left"
    )
    # …and the call names an org, because the org gate is per-org: a bare
    # `is_suppressed()` is DRY_RUN by another spelling.
    assert all(n.args or n.keywords for n in reads), (
        f"{label} calls outbound.is_suppressed with no org — the per-org "
        "gate cannot be consulted without one"
    )
    # The old read must be GONE: two gates consulted in different places is
    # how the two answers drift apart again.
    dry_reads = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Attribute) and n.attr == "DRY_RUN"
        and isinstance(n.value, ast.Name) and n.value.id == "outbound"
    ]
    assert not dry_reads, (
        f"{label} still reads outbound.DRY_RUN directly — bookkeeping must "
        "consult outbound.is_suppressed(org) and nothing else"
    )


def _consts(node) -> list[str]:
    """Every string literal under a node. Adjacent literals are folded by the
    parser, so a multi-line SQL statement arrives as ONE constant."""
    return [n.value for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _gate_branches(src: str):
    """Every `if outbound.is_suppressed(...):` in the module, as (then, else)
    bodies. (`if outbound.DRY_RUN:` matched here before the per-org gate; the
    predicate replaced it so a listed org in a live process is not written as
    'sent'.)

    AST rather than a text window, because the first textual match for
    `UPDATE staging.prachar_campaigns` in these modules is NOT the statement
    under test — an earlier draft of this file asserted against the wrong one
    and passed for the wrong reason.
    """
    out = []
    for n in ast.walk(ast.parse(src)):
        if not isinstance(n, ast.If):
            continue
        t = n.test
        if (isinstance(t, ast.Call) and isinstance(t.func, ast.Attribute)
                and t.func.attr == "is_suppressed"
                and isinstance(t.func.value, ast.Name)
                and t.func.value.id == "outbound"):
            out.append((n.body, n.orelse))
    return out


@pytest.mark.parametrize("label", sorted(PATHS))
def test_a_suppressed_contact_is_not_written_as_sent(label):
    """The suppressed branch must write a terminal status that is not 'sent',
    and must say why."""
    branches = _gate_branches(_src(PATHS[label]))
    assert branches, f"{label} has no `if outbound.is_suppressed(...):` branch"
    then = [c for body, _ in branches for stmt in body for c in _consts(stmt)]
    blob = " ".join(then)

    # THE REASON MUST BE DATA, NOT A VARIABLE NAME.
    #
    # This used to fold `ast.Name` identifiers into the blob as well, so that one
    # path could name the reason inline and the other via a module constant. That
    # made the assertion below unfalsifiable: both branches increment a counter
    # called `suppressed`/`suppressed_count`, so the word was always present
    # whatever the SQL said. Review proved it.
    #
    # So identifiers are resolved to their VALUES instead: a module-level string
    # constant referenced in the branch counts, a counter does not.
    module = ast.parse(_src(PATHS[label]))
    module_strings = {
        n.targets[0].id: n.value.value
        for n in module.body
        if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
        and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)
    }
    # implicit concatenation across lines arrives as one Constant; a parenthesised
    # multi-line string assigned to a name is still a single Constant too
    for body, _ in branches:
        for stmt in body:
            for n in ast.walk(stmt):
                if isinstance(n, ast.Name) and n.id in module_strings:
                    blob += " " + module_strings[n.id]
    assert "status = 'sent'" not in blob and "status='sent'" not in blob,         f"{label} still writes status='sent' inside the suppressed branch"
    # 'suppressed' is its own status since migration 147. It was 'failed' while
    # the CHECK allowed nothing better, which put a contact nobody attempted in
    # the same bucket as a bounce.
    assert "suppressed" in blob,         f"{label} must record a terminal status of its own for a suppressed contact"
    assert "'failed'" not in blob,         f"{label} still files a suppressed contact as a delivery failure"
    assert "suppressed" in blob.lower(),         f"{label} must record WHY the contact was not sent"


def _campaign_updates(src: str) -> list[str]:
    return [c for c in _consts(ast.parse(src))
            if "UPDATE staging.prachar_campaigns" in c]


@pytest.mark.parametrize("label", sorted(PATHS))
def test_a_campaign_that_reached_nobody_is_not_sent(label):
    """`status='sent'` on a campaign with zero deliveries is the headline lie —
    it is what the dashboard sums."""
    updates = _campaign_updates(_src(PATHS[label]))
    assert updates, f"{label} no longer updates prachar_campaigns at all"
    stopped = [u for u in updates if "suppressed" in u]
    assert stopped, (
        f"{label} has no branch that avoids marking a fully-suppressed campaign "
        "as sent"
    )
    assert any("total_sent=0" in u.replace(" ", "") for u in stopped),         f"{label} must zero total_sent when nothing left"


@pytest.mark.parametrize("label", sorted(PATHS))
def test_sent_at_is_never_stamped_on_a_suppressed_campaign(label):
    """`sent_at IS NULL` with `total_sent = 0` is the machine-readable half of
    the claim — a reader should not have to parse a status string."""
    for u in _campaign_updates(_src(PATHS[label])):
        if "suppressed" not in u:
            continue
        # ASSERTING ABSENCE WAS THE BUG IN THIS TEST.
        #
        # The interactive route stamps `sent_at=NOW()` in a committed UPDATE
        # BEFORE dispatch begins. So "the paused statement does not mention
        # sent_at" passed while the row kept a real timestamp — review found it.
        # The statement must actively clear it.
        flat = u.replace(" ", "")
        assert "sent_at=NULL" in flat, (
            f"{label} must CLEAR sent_at on a campaign that never left — the "
            "pre-dispatch UPDATE already stamped it, so omitting it here leaves "
            "a delivery timestamp on a campaign nobody received"
        )
        assert "sent_at=NOW()" not in flat, f"{label} stamps sent_at while pausing"


def test_the_reminder_cure_is_still_in_place():
    """The fix this file generalises. If it regresses, the pattern these tests
    copy is gone and they are quoting a corpse. The needle carries the org:
    `is_suppressed(rem["org_id"])` is the whole point — the mode alone misses
    the per-org gate and re-tells the 1,562-row lie in a live process."""
    src = _src(ROOT / "services" / "reminder_service.py")
    assert ('final = "suppressed" if outbound.is_suppressed(rem["org_id"]) '
            'else "sent"') in src, \
        "reminder_service no longer reads the gate; adc980b8 has regressed"
