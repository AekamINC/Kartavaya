"""A channel a rule can SAVE must be a channel the engine can SEND.

THE HOLE
--------
`validate_steps` checked `channel in CHANNELS`, and `CHANNELS` was the set of
channels the send layer RECOGNISED — which included `email`. `deliver()` ends
`"email from a rule is not built yet"`.

So a rule with `channel: "email"` saved cleanly, was reported valid by the
builder, appeared in the list like any other rule, matched real events, and
failed on every one of them for ever. The builder's whole promise is that a
broken rule is UNWRITABLE, and it was broken by one word in one set.

The general form, which is what this file actually guards: the set validated
against and the set dispatched on must be the same set. They were two names for
what everyone assumed was one idea.
"""
from __future__ import annotations

import pytest

from services.niyam.send import CHANNELS, PLANNED_CHANNELS, deliver
from services.niyam.validate import RuleInvalid, validate_steps


def _steps(channel):
    return [{"kind": "action",
             "config": {"verb": "notify.send", "channel": channel,
                        "kind": "task_done", "to": ["@creator"],
                        "title": "t", "body": "b"}}]


def test_a_deliverable_channel_saves():
    for channel in sorted(CHANNELS):
        validate_steps("task.status_changed", _steps(channel))


@pytest.mark.parametrize("channel", sorted(PLANNED_CHANNELS))
def test_a_planned_but_unbuilt_channel_is_refused_at_save(channel):
    """THE REGRESSION. This used to save."""
    with pytest.raises(RuleInvalid) as exc:
        validate_steps("task.status_changed", _steps(channel))
    msg = exc.value.as_dict()["error"]
    assert "yet" in msg, f"the refusal does not say it is unbuilt: {msg!r}"
    assert "never reach anyone" in msg


def test_email_is_now_saveable_and_nonsense_still_is_not():
    """History: this test once held '"email is not built" and "smoke-signal is
    not a channel" are different facts'. The A4 ladder built email
    (2026-08-18), so the first fact expired — a rule naming email must now
    SAVE, and only nonsense refuses. If a channel ever returns to
    PLANNED_CHANNELS, the distinguish-the-refusals assertion must return with
    it (see git history of this test) — the sets-do-not-overlap test below is
    what forces that conversation."""
    validate_steps("task.status_changed", _steps("email"))   # must not raise
    with pytest.raises(RuleInvalid):
        validate_steps("task.status_changed", _steps("smoke-signal"))
    # PLANNED is empty by graduation, not by deletion — the mechanism stays.
    assert PLANNED_CHANNELS == frozenset()


def test_the_two_sets_do_not_overlap():
    """If a channel is in both, one of them is lying about it."""
    assert not (CHANNELS & PLANNED_CHANNELS)


@pytest.mark.asyncio
@pytest.mark.parametrize("channel", sorted(CHANNELS))
async def test_every_saveable_channel_has_a_real_send_path(channel):
    """The other direction: nothing saveable may fall through to 'not built'.

    Driven with no recipient so it stops at the first gate — the point is that
    the refusal is about the DATA, never about the channel being unimplemented.
    """
    res = await deliver(_Conn(), user_id="", kind="task_done", title="t",
                        body="b", channel=channel)
    assert "not built" not in res.reason, (
        f"{channel!r} is offerable to a rule author but the send layer cannot "
        f"deliver it")


class _Conn:
    async def fetchrow(self, *a, **k):
        return None

    async def fetch(self, *a, **k):
        return []

    async def execute(self, *a, **k):
        return "INSERT 0 1"
