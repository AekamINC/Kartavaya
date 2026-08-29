"""The four defects an adversarial review found after everything was green.

`pytest`, `npm run check`, vitest and `npm run build` all passed on the code
these tests were written against. That is the point of the file: every defect
below is invisible to a suite that only asks "does the handler answer 200?",
because each one is a question about what happens on the SECOND thing the
handler does — after the row is committed, after the migration lands, after the
channel grows past 200 people.

Five of them, in the order they cost the most:

1. **A mention fan-out failure failed a send that had already succeeded.**
   `send_message` writes the message row with a bare `pool.fetchrow` — its own
   connection, its own implicit transaction — and then fans the mentions out.
   Raising after that cannot un-write the row; it can only turn a 201 into a
   500. `useChannelMessages` answers a 500 by stripping its optimistic row and
   toasting "Failed to send", so the sender watches a message that is sitting in
   the database disappear, and retypes it. One unrecorded mention became two
   posted messages.

2. **Only some of the 093-dependent paths asked whether 093 was applied.** Eight
   did; the two send paths did not. Migrations here are applied BY HAND, so
   "deployed but not migrated" is a real state that lasts minutes or days, and
   in it `@here standup in 5` wrote the message, bumped the channel, and then
   raised `UndefinedTableError` — defect 1 with a guaranteed trigger.

3. **A negative readiness answer was cached for the life of the process.** So
   hand-applying 093 changed nothing: every worker that had polled once during
   the window stayed pinned to the degraded path until somebody redeployed the
   Railway service. No error, no log line, no banner — the only symptom is "the
   feature we shipped last week does not work".

4. **`@channel` had no ceiling and no batching.** `BROADCAST_FREE_FOR_ALL_MAX_MEMBERS`
   answers *who may page the room*; nothing answered *how big a room may be
   paged*. A channel admin — and any editor can create a public channel, add the
   org and make themselves its admin — turned one keystroke into one inbox
   INSERT and one Expo call per person, awaited in series, inside the request the
   sender was waiting on.

5. **A cap that trims silently reads to the sender as "everyone was notified".**
   The first evidence otherwise is a colleague who never heard about the outage.

Section 7 is the schema check, in the style of `tests/test_prachar_audience.py`.
The pool is mocked everywhere else in this file and — exactly as
`routers/messaging.py:30-41` warns — a mocked cursor resolves any name you give
it, so nothing above proves a statement RUNS. Section 7 compares the names in
the code against migration 093 and the verified catalogue instead, which is the
half a mock can never answer.

The fake pool comes from `test_samvaad_mentions` on purpose rather than being
copied. One fake, one set of answers: if the resolver changes the shape of a
query, both files notice together instead of this one quietly passing against a
stale copy.
"""
import asyncio
import inspect
import logging
import pathlib
import re
from unittest.mock import AsyncMock

import pytest

from conftest import TEST_ORG_ID
from test_samvaad_mentions import (          # see the docstring — one fake pool
    ACTOR, ACTOR_NAME, CHANNEL, MESSAGE, FakePool, member,
)

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ROUTER = BACKEND / "routers" / "messaging.py"
SERVICE = BACKEND / "services" / "samvaad_mentions.py"
MIGRATION = BACKEND / "migrations" / "093_sanvaad_slack_parity.sql"

CHANNEL_ID = CHANNEL
MESSAGE_ID = MESSAGE


# ════════════════════════════════════════════════════════════════════════════
# Harness
# ════════════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Reach and the write-verb gate belong to `test_module_write_level.py`.
    Leaving them on would make every non-2xx below ambiguous between "wrong
    level" and "no subscription"."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches at MODULE scope, so the cache is test state.

    Pinned TRUE by default — most tests here are about what happens AFTER the
    migration — and cleared to `None` afterwards. Section 3 owns this cache
    outright and resets it itself; without the teardown, its deliberately
    expired deadlines would leak into every later file in the process and the
    failures would land nowhere near the cause.
    """
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


def _wire(mock_pool, *, level="editor", channel=None, membership=None,
          sender_id=None, row=None):
    """A pool whose answers are chosen by SQL shape, not by call order.

    `test_messaging_security.py` orders `fetchrow` side effects to match each
    handler's exact query sequence, and the spec for this work records that
    adding one query to `send_message` breaks every one of those tests. Nothing
    here depends on the order, so a handler that grows a query stays green — and
    the tests fail only when the BEHAVIOUR changes, which is the whole claim
    this file makes.
    """
    chan = {"type": "public", "is_archived": False} if channel is None else channel
    msg_row = dict(row or _message_row())

    async def _fetchval(sql, *a):
        s = " ".join(str(sql).split())
        # The `held_level` ladder, in the order it asks: platform role, org
        # role, then the module grant.
        if "org_id IS NULL" in s:
            return None
        if "role_code IN ('org_owner','org_admin')" in s:
            return None
        if "org_member_modules" in s:
            return level
        return 0

    async def _fetchrow(sql, *a):
        s = " ".join(str(sql).split())
        # Messages before channels: `send_message`'s INSERT and `edit_message`'s
        # UPDATE both end in `RETURNING *` and both name a channel id, so a
        # looser test would hand them the channel row.
        if "public.samvada_messages" in s:
            if "SELECT sender_id" in s:
                return {"sender_id": sender_id}
            return msg_row
        if "public.samvada_channels" in s:
            return chan
        if "public.samvada_channel_members" in s:
            return membership if membership is not None else {"?column?": 1}
        return None

    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        owner.fetchval = AsyncMock(side_effect=_fetchval)
        owner.fetchrow = AsyncMock(side_effect=_fetchrow)
        owner.fetch = AsyncMock(return_value=[])
        owner.execute = AsyncMock(return_value="INSERT 0 1")
    return mock_pool


def _message_row(**over) -> dict:
    row = {
        "id": MESSAGE_ID,
        "org_id": TEST_ORG_ID,
        "channel_id": CHANNEL_ID,
        "sender_id": "user_mem001",
        "content": "@Bela Rao standup in five",
        "type": "text",
        "parent_message_id": None,
        "is_edited": False,
        "is_deleted": False,
    }
    row.update(over)
    return row


class _FanOutLog(list):
    """The kwargs of every `fan_out_mentions` call, and what it should raise."""

    raises: BaseException | None = None

    def raise_with(self, exc: BaseException) -> None:
        self.raises = exc


@pytest.fixture
def fan_out_calls(monkeypatch):
    """Record every `fan_out_mentions` call; optionally make it raise.

    Patched on the SERVICE module, not on the router, because
    `_fan_out_mentions_guarded` imports the name inside the function — the
    import itself is one of the things that must not be allowed to fail a
    committed send, so it lives inside the `try`.
    """
    calls = _FanOutLog()

    async def _stub(pool, **kwargs):
        calls.append(kwargs)
        if calls.raises is not None:
            raise calls.raises

    import services.samvaad_mentions as sm
    monkeypatch.setattr(sm, "fan_out_mentions", _stub)
    return calls


@pytest.fixture
def push_probe(monkeypatch):
    """Every push that was fired, and the PEAK number in flight at one moment.

    The peak is the only assertable form of "the fan-out is bounded". A count of
    pushes cannot see the difference between four at a time and four hundred,
    and four hundred is what asks `db.py`'s pool for two connections per
    recipient at once against a `max_size` of ten.

    Two `sleep(0)`s rather than one: a stub that never yields runs to completion
    inside the task that started it, every task looks like the only task, and the
    peak reads as 1 whether the gate exists or not — a green test that proves
    nothing.
    """
    state = {"live": 0, "peak": 0, "sent": []}

    async def _stub(pool, *, recipient_id, **kwargs):
        state["live"] += 1
        state["peak"] = max(state["peak"], state["live"])
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        state["live"] -= 1
        state["sent"].append(recipient_id)

    import services.push_service as ps
    monkeypatch.setattr(ps, "send_push", _stub)
    return state


async def _fan_out(pool, **over):
    """Call the real `fan_out_mentions` and wait for the pushes it detached.

    `asyncio.ensure_future` schedules; it does not run. Asserting straight after
    the await would see zero pushes whether or not any were fired, so the tasks
    this call created — and only those, a task from an earlier test belongs to a
    loop that is already closed — are gathered before the test looks.
    """
    import services.samvaad_mentions as sm
    before = set(sm._PUSH_TASKS)

    kwargs = dict(org_id=TEST_ORG_ID, channel_id=CHANNEL_ID, message_id=MESSAGE_ID,
                  actor_id=ACTOR, content="", is_edit=False)
    kwargs.update(over)
    await sm.fan_out_mentions(pool, **kwargs)

    mine = [t for t in set(sm._PUSH_TASKS) - before]
    if mine:
        await asyncio.gather(*mine, return_exceptions=True)


def _crowd(n: int, prefix: str = "user_p") -> list[dict]:
    return [member(f"{prefix}{i:04d}", f"Person {i:04d}") for i in range(n)]


def _ids_in(statements, universe: set[str]) -> set[str]:
    """Which of `universe` were bound to these statements.

    Matched against a known set rather than "every string that looks like a user
    id", because the arguments also carry notification ids, titles and the
    message body — and the body contains the display names of the very people
    this is asked about.
    """
    found: set[str] = set()
    for _sql, args in statements:
        for arg in args:
            if isinstance(arg, (list, tuple, set)):
                found |= {a for a in arg if a in universe}
            elif isinstance(arg, str) and arg in universe:
                found.add(arg)
    return found


def _body(fn) -> str:
    """Source with the docstring and the `#` comments removed.

    Both legitimately DISCUSS the thing being asserted against — the comment on
    `send_message` says the words "fan_out_mentions" three times explaining why
    it must not be called directly — so a naive source search asserts against the
    prose that documents the fix. `test_prachar_audience` failed exactly that way
    on its first run.
    """
    src = inspect.getsource(fn)
    doc = inspect.getdoc(fn)
    if doc:
        for quote in ('"""', "'''"):
            start = src.find(quote)
            if start != -1:
                end = src.find(quote, start + 3)
                if end != -1:
                    src = src[:start] + src[end + 3:]
                    break
    return "\n".join(
        line for line in src.splitlines() if not line.lstrip().startswith("#")
    )


# ════════════════════════════════════════════════════════════════════════════
# 1 · The fan-out cannot fail a send whose row is already committed
# ════════════════════════════════════════════════════════════════════════════

async def test_a_failing_fan_out_still_answers_201_for_a_message_that_was_written(
    api_client, as_member, with_org_id, mock_pool, fan_out_calls, caplog
):
    """THIS IS THE ONE THAT POSTED THE MESSAGE TWICE.

    By the time the fan-out runs, `INSERT INTO staging.samvada_messages …
    RETURNING *` has committed on its own connection and the channel bump behind
    it has too. An exception here cannot roll either back. All it can still do is
    answer 500 for a send that succeeded — and `useChannelMessages` believes it:
    it strips the optimistic row and toasts "Failed to send", so a message that
    is in the database vanishes off the sender's screen and they type it again.

    A 500 here is therefore not "the mention failed", it is "the mention failed
    AND the channel now has the same message twice, and neither copy is marked".
    """
    _wire(mock_pool)
    fan_out_calls.raise_with(RuntimeError("undefined table samvada_mentions"))

    with caplog.at_level(logging.ERROR, logger="routers.messaging"):
        r = await api_client.post(
            f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
            json={"content": "@Bela Rao standup in five"},
        )

    assert r.status_code == 201, r.text
    assert r.json()["id"] == MESSAGE_ID
    assert fan_out_calls, (
        "the fan-out was never attempted, so this test proves nothing about "
        "what happens when it fails"
    )


async def test_the_swallowed_fan_out_failure_is_logged_with_the_message_id(
    api_client, as_member, with_org_id, mock_pool, fan_out_calls, caplog
):
    """Swallowed at the router is not the same as unnoticed.

    The service's rule 4 — "a failed mention insert must fail the send loudly" —
    is right next to the INSERT and wrong at this layer, and the half of it that
    survives the move is LOUDLY. Without the log line the failure mode is a
    mention that silently notified nobody, which is the exact defect
    `renderMentions.test.jsx` exists to catch and which is indistinguishable from
    a message nobody was mentioned in.

    The message id is what makes it recoverable: every recipient is derived from
    `content`, `content` is on the row, and an edit re-runs the whole resolution.
    """
    _wire(mock_pool)
    fan_out_calls.raise_with(RuntimeError("undefined table samvada_mentions"))

    with caplog.at_level(logging.ERROR, logger="routers.messaging"):
        r = await api_client.post(
            f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
            json={"content": "@Bela Rao standup in five"},
        )
    assert r.status_code == 201, r.text

    errors = [rec for rec in caplog.records if rec.levelno >= logging.ERROR]
    assert errors, "the fan-out failure was swallowed without a word"
    assert any(MESSAGE_ID in rec.getMessage() for rec in errors), (
        "nothing in the log names the message whose mentions were lost, so "
        "there is no way to find it again"
    )
    assert any(rec.exc_info for rec in errors), (
        "logged without the traceback — the line says a fan-out failed and not "
        "which line of which module raised"
    )


async def test_a_failing_fan_out_does_not_fail_an_edit_either(
    api_client, as_member, with_org_id, mock_pool, fan_out_calls, member_user, caplog
):
    """A sharper version of the same thing: the UPDATE has already replaced the
    stored text. A 500 tells the author their edit failed while the edit is what
    everybody else can now read, and the retry — the identical PATCH — writes the
    identical row and fails identically. There is no state a raised exception
    could restore here, only a lie it could tell."""
    _wire(mock_pool, sender_id=member_user["user_id"])
    fan_out_calls.raise_with(RuntimeError("undefined table samvada_mentions"))

    with caplog.at_level(logging.ERROR, logger="routers.messaging"):
        r = await api_client.patch(
            f"/api/v1/messaging/messages/{MESSAGE_ID}",
            json={"content": "@Bela Rao standup in ten, sorry"},
        )
    assert r.status_code == 200, r.text
    assert fan_out_calls and fan_out_calls[-1]["is_edit"] is True


async def test_a_cancelled_request_still_cancels(mock_pool, monkeypatch):
    """`except Exception`, never `except BaseException`.

    `asyncio.CancelledError` is a client disconnect. Swallowing it would leave
    the handler running to completion for a request nobody is listening to — and
    on a route the client fires on every keystroke's worth of send, that is a
    worker slot held open by a browser tab that has already closed.
    """
    import routers.messaging as messaging

    async def _cancelled(pool, **kwargs):
        raise asyncio.CancelledError()

    import services.samvaad_mentions as sm
    monkeypatch.setattr(sm, "fan_out_mentions", _cancelled)

    with pytest.raises(asyncio.CancelledError):
        await messaging._fan_out_mentions_guarded(
            mock_pool, org_id=TEST_ORG_ID, channel_id=CHANNEL_ID,
            message_id=MESSAGE_ID, actor_id=ACTOR, content="@x", is_edit=False,
        )


# ════════════════════════════════════════════════════════════════════════════
# 2 · Both write paths ask whether 093 is applied — not just one of them
# ════════════════════════════════════════════════════════════════════════════

async def test_send_does_not_touch_the_mentions_table_before_the_migration(
    api_client, as_member, with_org_id, mock_pool, fan_out_calls
):
    """The deploy window is a real state and it can last days.

    Nothing applies migrations automatically; 093 is run by hand against a
    database staging and production share. `GET /mentions` already answers `[]`
    under this condition, and so do the poll, the rail and search — so a send
    that fans out anyway is not "half a feature", it is an
    `UndefinedTableError` raised after the message row was committed, i.e.
    defect 1 with a guaranteed trigger on the first message containing an `@`.
    """
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(False)
    _wire(mock_pool)

    r = await api_client.post(
        f"/api/v1/messaging/channels/{CHANNEL_ID}/messages",
        json={"content": "@here standup in five"},
    )
    assert r.status_code == 201, r.text
    assert fan_out_calls == [], (
        "the send fanned mentions out into tables 093 has not created yet"
    )


async def test_edit_does_not_touch_the_mentions_table_before_the_migration(
    api_client, as_member, with_org_id, mock_pool, fan_out_calls, member_user
):
    """The half that is easy to miss. `send_message` is the path anybody testing
    this feature by hand will exercise; `edit_message` is reached by fixing a
    typo, which is the commonest edit there is and which nobody thinks of as
    "using mentions" at all."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(False)
    _wire(mock_pool, sender_id=member_user["user_id"])

    r = await api_client.patch(
        f"/api/v1/messaging/messages/{MESSAGE_ID}",
        json={"content": "@here standup in ten, sorry"},
    )
    assert r.status_code == 200, r.text
    assert fan_out_calls == [], (
        "the edit fanned mentions out into tables 093 has not created yet"
    )


def test_neither_write_path_calls_the_fan_out_without_the_guard():
    """Stated structurally as well as behaviourally, because the behavioural
    tests above pass for a handler that has stopped fanning out at all. Two call
    sites, one wrapper: the day a third send path appears, the thing to copy has
    to be obvious from these two."""
    from routers.messaging import send_message, edit_message

    for fn in (send_message, edit_message):
        src = _body(fn)
        assert "_fan_out_mentions_guarded(" in src, (
            f"{fn.__name__} no longer routes its fan-out through the guard, so "
            f"nothing in front of it checks 093 and nothing behind it stops an "
            f"exception turning a committed write into a 500"
        )
        assert not re.search(r"(?<![_\w])fan_out_mentions\s*\(", src), (
            f"{fn.__name__} calls fan_out_mentions directly"
        )


def test_the_guard_says_why_it_swallows_rather_than_looking_like_a_bare_except():
    """A `try/except Exception: pass` around a call reads as sloppiness and the
    next person deletes it. The reason it is correct HERE — the row is already
    committed, so a raise can only lie about it — is not deducible from the
    line, and it directly contradicts the rule written at the top of the service
    it calls. It has to be at the site or it gets "cleaned up"."""
    from routers.messaging import _fan_out_mentions_guarded
    doc = (inspect.getdoc(_fan_out_mentions_guarded) or "").lower()
    assert "commit" in doc, (
        "the guard does not say that the message row is already committed by "
        "the time it runs, which is the entire reason it may swallow"
    )
    assert "093" in doc or "migration" in doc


# ════════════════════════════════════════════════════════════════════════════
# 3 · A negative readiness answer expires; a positive one does not
# ════════════════════════════════════════════════════════════════════════════

class _ProbePool:
    """Counts catalogue probes and answers them from a script."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = 0

    async def fetchval(self, sql, *args):
        self.calls += 1
        return self.answers[min(self.calls - 1, len(self.answers) - 1)]


class _Clock:
    """A monotonic clock this test moves by hand.

    Sleeping for a real minute is not an option and shortening the constant to
    zero is not either: `time.monotonic()` has a coarse resolution on Windows and
    can return the same value twice in a row, so a zero-length window is
    sometimes not expired when the code asks. A fake clock makes the answer the
    same on every machine.
    """

    def __init__(self, now: float = 1_000.0):
        self.now = now

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


async def test_a_negative_readiness_answer_is_probed_again_after_the_window(
    monkeypatch,
):
    """WITHOUT THIS, APPLYING 093 REQUIRES A RAILWAY REDEPLOY AND NOTHING SAYS SO.

    The probe was cached at module scope with no expiry. Every gunicorn worker
    that served one request during the deploy window — and `/live` fires every
    four seconds, so that is all of them, within four seconds — concluded the
    migration was absent and never asked again. Running
    `psql -f 093_sanvaad_slack_parity.sql` then changed NOTHING: mentions,
    typing, presence, pins and search stayed dark, with no error, no log line and
    no banner anywhere connecting the two. The only symptom is "the feature we
    shipped last week does not work", and the only cure is a redeploy nobody
    knows to perform.
    """
    import routers.messaging as messaging

    clock = _Clock()
    monkeypatch.setattr(messaging, "time", clock)
    messaging._reset_parity_cache(None)

    pool = _ProbePool([False, True])          # somebody applies 093 in between
    assert await messaging._parity_ready(pool) is False
    assert pool.calls == 1

    clock.advance(messaging._PARITY_RECHECK_SECONDS + 1)

    assert await messaging._parity_ready(pool) is True, (
        "093 has been applied and this process still reports it missing; the "
        "answer will not change until the service is redeployed"
    )
    assert pool.calls == 2


async def test_a_negative_answer_is_still_cached_inside_the_window(monkeypatch):
    """The other half. `/live` polls every four seconds per user; probing the
    catalogue on every one of those, for as long as the migration is outstanding,
    is a self-inflicted load spike on the exact path the readiness check exists
    to protect. One extra `to_regclass` per worker per minute is the price."""
    import routers.messaging as messaging

    clock = _Clock()
    monkeypatch.setattr(messaging, "time", clock)
    messaging._reset_parity_cache(None)

    pool = _ProbePool([False])
    for _ in range(20):
        clock.advance(messaging._PARITY_RECHECK_SECONDS / 40)
        assert await messaging._parity_ready(pool) is False
    assert pool.calls == 1, (
        f"{pool.calls} catalogue probes inside one recheck window — the poll "
        f"fires every four seconds, per user, per worker"
    )


async def test_a_positive_readiness_answer_is_never_probed_again(monkeypatch):
    """The cache is ASYMMETRIC and that is the design, not an oversight.

    A migration is not un-applied: 093 has no down script and nothing in the
    product drops those objects, so there is no answer for a true to change into.
    If somebody drops the table by hand, the reads raise `UndefinedTableError` —
    which is correct. A relation vanishing under a running service is not a state
    to quietly degrade into.
    """
    import routers.messaging as messaging

    clock = _Clock()
    monkeypatch.setattr(messaging, "time", clock)
    messaging._reset_parity_cache(None)

    pool = _ProbePool([True])
    for _ in range(5):
        clock.advance(messaging._PARITY_RECHECK_SECONDS * 10)
        assert await messaging._parity_ready(pool) is True
    assert pool.calls == 1, "a true was re-probed; nothing can change it"


def test_the_recheck_window_is_finite_and_measured_on_the_monotonic_clock():
    """Two ways to write this fix that both look right and are not.

    A window of `inf` (or no window at all) is the defect. And a window measured
    on `time.time()` is a window an NTP correction can stretch to an hour or
    collapse to nothing — the container's wall clock is stepped by the host, and
    a fifteen-minute backwards step would freeze the degraded path for fifteen
    minutes on a machine that had already been migrated.
    """
    import routers.messaging as messaging

    window = messaging._PARITY_RECHECK_SECONDS
    assert 0 < window < 3600, (
        f"the recheck window is {window!r}; a false readiness answer must "
        f"expire, and within minutes, because the migration is applied by hand "
        f"while somebody watches for the feature to light up"
    )
    src = _body(messaging._parity_ready)
    assert "monotonic" in src
    assert "time.time()" not in src, (
        "the recheck deadline is on the wall clock, which an NTP step moves"
    )


async def test_a_test_pinned_false_stays_false_however_slow_the_suite_is():
    """`_reset_parity_cache(False)` pins the deadline to infinity, and the reason
    is this file's own section 2.

    A test asserting the pre-093 path is asserting a fixed premise. If a real TTL
    could expire mid-test the probe would run against a mock — whose default
    `fetchval` is `0` in `conftest.make_pool` and whose bare-MagicMock cousin is
    truthy — and the test would start passing or failing on how long the machine
    took to get there.
    """
    import routers.messaging as messaging

    messaging._reset_parity_cache(False)
    assert messaging._PARITY_RECHECK_AFTER == float("inf")

    pool = _ProbePool([True])
    assert await messaging._parity_ready(pool) is False
    assert pool.calls == 0, "a pinned false was re-probed"


# ════════════════════════════════════════════════════════════════════════════
# 4 · One `@channel` cannot fan out without bound
# ════════════════════════════════════════════════════════════════════════════
#
# Three separate bounds, because the same fan-out is expensive in three
# different ways and no one of them covers the others: how many people may be
# reached, how many round trips reaching them costs, and how many of those may
# be in flight at once.

async def test_a_broadcast_over_the_ceiling_writes_the_rows_and_sends_nothing(
    push_probe,
):
    """`BROADCAST_FREE_FOR_ALL_MAX_MEMBERS` asks who may page the room. Nothing
    asked how big a room may be paged, so a channel admin was above the first
    check and below no second one — and any editor can create a public channel,
    add the whole org (`add_member` only requires membership) and make themselves
    its admin. One keystroke then became one `public.notifications` INSERT and
    one Expo round trip per person in the firm, started from inside the request
    the sender was waiting on.

    Over the ceiling this is a DOWNGRADE, not a silencing: the `samvada_mentions`
    rows still go in, so the `@` badge lights and the mentions feed shows it. What
    stops is the inbox row and the device buzz.
    """
    from services.samvaad_mentions import BROADCAST_NOTIFY_MAX_RECIPIENTS as CEILING

    crowd = _crowd(CEILING + 50)
    everyone = {m["user_id"] for m in crowd}
    pool = FakePool(members=crowd, member_count=len(crowd), sender_role="admin")

    await _fan_out(pool, content="@channel all hands in five")

    assert _ids_in(pool.writes_to("samvada_mentions"), everyone) == everyone, (
        "the ceiling dropped the mention rows too — the broadcast now reaches "
        "nobody at all rather than reaching everybody quietly"
    )
    assert pool.writes_to("notifications") == [], (
        f"{len(crowd)} people were sent an inbox row by one @channel"
    )
    assert push_probe["sent"] == [], (
        f"{len(push_probe['sent'])} Expo calls were started from inside one send"
    )


async def test_a_named_person_is_notified_even_when_the_broadcast_is_capped(
    push_probe,
):
    """Only the BROADCAST kinds are measured against the ceiling.

    Somebody named by hand is somebody a human typed the name of, and there are
    only ever as many of those as fit in one message. Dropping them would break
    the ordinary case in order to fix the abusive one — a message that pages
    4,000 people and names two must still notify the two, with `kind='user'`,
    because "somebody said your name" is a different event from "somebody paged
    the room".
    """
    from services.samvaad_mentions import BROADCAST_NOTIFY_MAX_RECIPIENTS as CEILING

    bela = member("user_bela01", "Bela Rao")
    crowd = _crowd(CEILING + 50) + [bela]
    pool = FakePool(members=crowd, member_count=len(crowd), sender_role="admin")

    await _fan_out(pool, content="@channel all hands — @Bela Rao you especially")

    notified = _ids_in(pool.writes_to("notifications"),
                       {m["user_id"] for m in crowd})
    assert notified == {bela["user_id"]}, sorted(notified)
    assert push_probe["sent"] == [bela["user_id"]], push_probe["sent"]


async def test_the_notification_fan_out_is_one_statement_not_one_per_person(
    push_probe,
):
    """It was one INSERT per recipient, awaited in series, INSIDE the request.

    So an admin's `@channel` on a 150-member channel made the sender wait out 150
    sequential round trips before their own message appeared — on a screen where
    the message is already drawn optimistically and every one of those round
    trips is a chance for the request to time out and take the optimistic row
    with it.

    `unnest` makes the cost one round trip regardless of length, which is also
    why `_broadcast_recipients` is deliberately unlimited: the rows are free, the
    per-person work is not.
    """
    crowd = _crowd(150)
    everyone = {m["user_id"] for m in crowd}
    pool = FakePool(members=crowd, member_count=len(crowd), sender_role="admin")

    await _fan_out(pool, content="@channel standup in five")

    writes = pool.writes_to("notifications")
    assert len(writes) == 1, (
        f"{len(writes)} notification statements for one message — that is one "
        f"round trip per recipient, in series, inside the send request"
    )
    assert _ids_in(writes, everyone) == everyone, (
        "the single statement did not carry every recipient"
    )
    assert len(pool.writes_to("samvada_mentions")) == 1, (
        "the mention rows went in one per recipient as well"
    )


async def test_the_push_fan_out_is_concurrency_bounded(push_probe):
    """Every push is two pool queries and an HTTP call.

    Ungated, 150 recipients ask `db.py`'s pool for up to 300 connections at once
    against a `max_size` of ten — and the request that is still trying to finish
    the send queues behind its own background work, along with every other
    request the service is serving. The gate does not make the fan-out slower in
    any way anybody can feel: it is already off the request by then.
    """
    from services.samvaad_mentions import PUSH_FAN_OUT_CONCURRENCY

    crowd = _crowd(150)
    pool = FakePool(members=crowd, member_count=len(crowd), sender_role="admin")

    await _fan_out(pool, content="@channel standup in five")

    assert len(push_probe["sent"]) == len(crowd), (
        f"{len(push_probe['sent'])} of {len(crowd)} pushes were fired; the gate "
        f"is meant to slow the fan-out down, not to drop half of it"
    )
    assert push_probe["peak"] <= PUSH_FAN_OUT_CONCURRENCY, (
        f"{push_probe['peak']} pushes were inside send_push at once against a "
        f"pool of ten connections"
    )
    assert PUSH_FAN_OUT_CONCURRENCY < 10, (
        "the gate is as wide as the whole connection pool, which is the same as "
        "having no gate"
    )


def test_the_push_gate_survives_a_second_event_loop():
    """`asyncio.Semaphore` binds to the first loop that CONTENDS on it.

    A module-level singleton is fine under gunicorn — one loop per worker — and a
    trap in any process that makes more than one, which is every pytest run.
    Worse, it fails only once a fan-out is big enough to actually block, i.e. in
    exactly the case the gate exists for: `RuntimeError: … is bound to a
    different event loop`, raised from inside a detached task, on a production
    box, on the biggest broadcast of the day.

    A SYNC test, deliberately: it owns the two loops it is asserting about, and
    an `async def` here would already be running inside a third.
    """
    import services.samvaad_mentions as sm

    async def _grab():
        gate = sm._push_gate()
        async with gate:            # contending is what binds it to this loop
            pass
        return gate

    first = asyncio.run(_grab())
    second = asyncio.run(_grab())
    # Both held, and compared by identity rather than by `id()`: the first
    # semaphore is unreachable from the module the moment its loop is collected,
    # and a freed address can be handed straight back to the second one.
    assert first is not second, (
        "both loops shared one semaphore; the second loop to contend on it "
        "raises RuntimeError from inside a detached push task"
    )


# ════════════════════════════════════════════════════════════════════════════
# 5 · Truncation is logged, never silent
# ════════════════════════════════════════════════════════════════════════════

async def test_dropping_a_broadcast_from_the_fan_out_is_logged_with_the_counts(
    push_probe, caplog,
):
    """A cap that trims the list and says nothing reads to the sender as
    "everyone was notified".

    They typed `@channel`, the message posted, no error appeared. The first
    evidence that 250 people were not paged is a colleague who never heard about
    the outage — days later, in a conversation about something else. The WARNING
    is the only artefact that connects the two, so it has to name the channel and
    the actor (which broadcast), and the numbers (how much was dropped), or it is
    a line somebody greps past.
    """
    from services.samvaad_mentions import BROADCAST_NOTIFY_MAX_RECIPIENTS as CEILING

    crowd = _crowd(CEILING + 50)
    pool = FakePool(members=crowd, member_count=len(crowd), sender_role="admin")

    with caplog.at_level(logging.WARNING, logger="services.samvaad_mentions"):
        await _fan_out(pool, content="@channel all hands in five")

    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings, (
        "the fan-out silently dropped a broadcast; nothing anywhere records "
        "that anybody was not notified"
    )
    said = "\n".join(r.getMessage() for r in warnings)
    for needed, why in (
        (str(len(crowd)), "the number of people dropped"),
        (str(CEILING), "the ceiling they were measured against"),
        (CHANNEL_ID, "which channel"),
        (ACTOR, "who broadcast"),
        (MESSAGE_ID, "which message"),
    ):
        assert needed in said, f"the warning does not say {why}:\n{said}"


async def test_an_ordinary_mention_logs_no_warning_at_all(push_probe, caplog):
    """The other half of a useful warning: it has to be rare.

    A line that fires on every mention is a line nobody reads, and then the one
    that matters scrolls past with it.
    """
    bela = member("user_bela01", "Bela Rao")
    pool = FakePool(members=[bela], member_count=1)

    with caplog.at_level(logging.WARNING, logger="services.samvaad_mentions"):
        await _fan_out(pool, content="@Bela Rao when you get a moment")

    assert [r.getMessage() for r in caplog.records
            if r.levelno >= logging.WARNING] == []


# ════════════════════════════════════════════════════════════════════════════
# 6 · The muted rule survived the batching
# ════════════════════════════════════════════════════════════════════════════

async def test_a_muted_member_keeps_the_row_and_is_left_out_of_the_batch(
    push_probe,
):
    """Rule 1 of the service, re-asserted against the shape that replaced it.

    The per-recipient loop skipped muted people by never entering the loop body
    for them. The batched form filters a list instead — and a filter is a line
    that can be dropped, reordered past the `unnest`, or written against `fresh`
    rather than `targets` without anything else changing. Any of those turns mute
    into decoration, silently, for everybody.

    Both directions are the bug. Notifying a muted person means mute does
    nothing. Dropping their `samvada_mentions` row means "do not interrupt me"
    quietly became "hide from me that a colleague said my name" — they can see
    they typed it, you never learn it happened, and neither of you can tell which.
    """
    bela = member("user_bela01", "Bela Rao", muted=True)
    chetan = member("user_chetan1", "Chetan Iyer")
    deepa = member("user_deepa01", "Deepa Nair")
    everyone = {m["user_id"] for m in (bela, chetan, deepa)}
    pool = FakePool(members=[bela, chetan, deepa], member_count=3)

    await _fan_out(
        pool, content="@Bela Rao @Chetan Iyer @Deepa Nair — before the call please",
    )

    assert _ids_in(pool.writes_to("samvada_mentions"), everyone) == everyone, (
        "a muted channel dropped the mention row; the badge and the mentions "
        "feed will never show it"
    )

    writes = pool.writes_to("notifications")
    assert len(writes) == 1, f"{len(writes)} statements for two recipients"
    assert _ids_in(writes, everyone) == {chetan["user_id"], deepa["user_id"]}, (
        "the muted member was carried into the batched insert — mute does "
        "nothing now that the recipients travel as an array"
    )
    assert set(push_probe["sent"]) == {chetan["user_id"], deepa["user_id"]}, (
        f"a muted channel still buzzed a device: {push_probe['sent']}"
    )


async def test_a_message_that_mentions_only_muted_people_writes_no_batch_at_all(
    push_probe,
):
    """An empty `unnest($1::text[], …)` is a legal statement that inserts nothing,
    so this cannot be caught by a constraint or a 500 — it is one wasted round
    trip on the send path, on every message, that looks exactly like a working
    one."""
    bela = member("user_bela01", "Bela Rao", muted=True)
    pool = FakePool(members=[bela], member_count=1)

    await _fan_out(pool, content="@Bela Rao when you get a moment")

    assert pool.writes_to("samvada_mentions"), "the mention row was dropped"
    assert pool.writes_to("notifications") == []
    assert push_probe["sent"] == []


# ════════════════════════════════════════════════════════════════════════════
# 7 · The names. In the style of tests/test_prachar_audience.py.
# ════════════════════════════════════════════════════════════════════════════
#
# Everything above runs against a mocked pool, and a mocked cursor resolves any
# name you give it: `graha_contacts.type`, `vikray_targets.salesperson_id`,
# `bank_statement_lines.batch_id` and the pahchan `$2::date` were all green in
# this suite and all 500'd against the real database. So this section compares
# the code against migration 093 and the verified catalogue instead — the one
# question a mock cannot answer.
#
# Update these when a migration adds a column. That edit is the point at which
# somebody has to notice that the code and the database disagree.

SAMVADA_MESSAGE_COLUMNS = {
    "id", "org_id", "channel_id", "sender_id", "content", "type",
    "parent_message_id", "metadata", "is_edited", "is_deleted",
    "created_at", "updated_at", "pinned_at", "pinned_by", "search_tsv",
}
SAMVADA_TYPING_COLUMNS = {"channel_id", "user_id", "updated_at"}
#: public.notifications — written WITHOUT a schema prefix, like every other
#: writer here, because the pool's search_path is "staging, public". Corroborated
#: by `routers/task_reminders.py:109`, which names eight of these in one INSERT.
NOTIFICATION_COLUMNS = {
    "notification_id", "user_id", "team_id", "type", "title", "message",
    "task_id", "url", "created_at", "read_at", "metadata",
}


def _sql_source(path: pathlib.Path) -> str:
    """The file with its double quotes removed and its whitespace collapsed.

    SQL in this codebase is built from adjacent string literals, so the raw
    source reads `"DELETE FROM x " \\n "WHERE y"` and a naive regex never spans
    the gap. Single quotes survive on purpose — `interval '15 seconds'` is part
    of the statement, not part of the Python.
    """
    return re.sub(r"\s+", " ", path.read_text(encoding="utf-8").replace('"', " "))


def test_the_readiness_probe_asks_about_objects_093_actually_creates():
    """If the probe names something 093 does not create, it answers False forever.

    And forever is now a re-probe every sixty seconds, per worker, for the life
    of the deploy — with mentions, typing, presence, pins and search all silently
    degraded and nothing anywhere reporting an error. The probe reads ONE
    relation and ONE column and concludes the whole migration from them, which is
    only sound because 093 is a single BEGIN/COMMIT; that is exactly why the two
    names it picks have to be names 093 really writes.
    """
    import routers.messaging as messaging

    sql = " ".join(messaging._PARITY_PROBE_SQL.split())
    migration = MIGRATION.read_text(encoding="utf-8")

    relations = re.findall(r"to_regclass\('([^']+)'\)", sql)
    assert relations, "the probe no longer reads the catalogue at all"
    for rel in relations:
        # `\b`, not a substring test. `samvada_mention` is a prefix of
        # `samvada_mentions`, so a plain `in` passes for the singular typo —
        # which is the likeliest way this line is ever got wrong, and the whole
        # feature would be dark with a green test.
        # The probe is search-path-relative now (`to_regclass('samvada_
        # mentions')`), while 093 is a historical file that still qualifies its
        # DDL `staging.`. Compare the RELATION NAME and let either side carry a
        # schema — the `\b` that stops `samvada_mention` matching the plural is
        # what this assertion is really for, and it is untouched.
        bare = rel.split(".")[-1]
        assert re.search(
            rf"CREATE TABLE IF NOT EXISTS (?:\w+\.)?{re.escape(bare)}\b", migration), (
            f"the readiness probe asks for {rel}, which 093 never creates — "
            f"every 093-dependent path is degraded for the life of the deploy"
        )

    table = re.search(r"table_name\s*=\s*'(\w+)'", sql)
    column = re.search(r"column_name\s*=\s*'(\w+)'", sql)
    assert table and column, "the probe stopped checking the generated column"
    assert column.group(1) in SAMVADA_MESSAGE_COLUMNS, (
        f"the probe asks for {table.group(1)}.{column.group(1)}, which is not a "
        f"column that table has"
    )
    assert re.search(
        rf"ALTER TABLE staging\.{table.group(1)}\s+ADD COLUMN IF NOT EXISTS "
        rf"{column.group(1)}\b",
        migration,
    ), f"093 does not add {table.group(1)}.{column.group(1)}"


def test_the_typing_sweep_names_real_columns_and_leads_with_the_primary_key():
    """The sweep was an unqualified DELETE on every poll — no channel predicate
    at all, fifteen times a minute, per user, per org, including on the rail-only
    polls with no channel open.

    `samvada_typing`'s only index is `PRIMARY KEY (channel_id, user_id)` and
    `updated_at` is not in it, so each of those was a sequential scan of the
    whole table under a row-exclusive lock, every org scanning every other org's
    rows. Scoping it helps ONLY IF the column it is scoped by is the one the
    primary key leads with — `WHERE user_id=…` would be exactly as bad and would
    look exactly as fixed.
    """
    sweep = re.search(
        r"DELETE FROM public\.samvada_typing (WHERE [^;]*?updated_at <[^,]*?)'",
        _sql_source(ROUTER),
    )
    assert sweep, (
        "the abandoned-row sweep is gone; a tab closed mid-word leaves somebody "
        "showing as typing forever"
    )
    predicate = sweep.group(1)

    named = set(re.findall(r"\b(\w+)\s*(?:=|<|>)", predicate)) - {"now"}
    unknown = named - SAMVADA_TYPING_COLUMNS
    assert not unknown, (
        f"the sweep filters on {sorted(unknown)}, which samvada_typing does not "
        f"have"
    )
    assert "channel_id=$1::uuid" in predicate.replace(" ", ""), (
        f"the sweep is not scoped to one channel:\n{predicate}"
    )

    migration = MIGRATION.read_text(encoding="utf-8")
    pk = re.search(r"PRIMARY KEY \((\w+), (\w+)\)\s*\);", migration.split(
        "staging.samvada_typing", 1)[1])
    assert pk and pk.group(1) == "channel_id", (
        "samvada_typing's primary key no longer leads with channel_id, so the "
        "scoped sweep is a sequential scan again"
    )


def test_the_trigram_index_targets_the_expression_the_ilike_arm_matches_on():
    """An index on `content` cannot answer `LOWER(content) LIKE …`.

    And that matters more than it looks, because of how the search predicate is
    shaped: `(search_tsv @@ to_tsquery(…)) OR content ILIKE $3`. Postgres answers
    an OR from indexes only as a BitmapOr with one scan per branch, so EVERY
    branch must be indexable or NONE of them is used — the planner drops the
    whole predicate to a sequential scan and the GIN index on `search_tsv` is
    never opened. Change the ILIKE arm to wrap `content` in anything and both
    indexes stop paying at once, which reads as "search got slower for no
    reason".
    """
    migration = MIGRATION.read_text(encoding="utf-8")
    idx = re.search(
        r"CREATE INDEX IF NOT EXISTS (\w+)\s+ON staging\.samvada_messages\s+"
        r"USING GIN \((\w+) (\w+)\)",
        migration,
    )
    assert idx, "093 no longer creates a trigram index on samvada_messages"
    _name, column, opclass = idx.groups()
    assert opclass == "gin_trgm_ops", opclass
    assert column in SAMVADA_MESSAGE_COLUMNS, (
        f"the trigram index is built on {column!r}, which samvada_messages does "
        f"not have — 093 fails at COMMIT and every object in it is rolled back"
    )

    from routers.messaging import search_messages
    src = _body(search_messages)
    assert f"m.{column} ILIKE $3" in src, (
        f"the ILIKE arm no longer matches on bare m.{column}, so the trigram "
        f"index cannot answer it — and with one arm unindexed the tsvector "
        f"index stops being used as well"
    )


def test_the_batched_notification_insert_names_real_columns_and_casts_every_bind():
    """The trap that converting the loop into one statement walks straight into.

    `INSERT … SELECT` is the "general SELECT" path in Postgres's parse analysis:
    the sub-select is analysed on its own and the INSERT then coerces its OUTPUT
    columns, so a bare `$4` in the select list is never coerced against `message`
    and stays untyped — `could not determine data type of parameter $4`, at Parse
    time, on every mention with an unmuted recipient. asyncpg sends Parse with no
    parameter types and lets the server infer, so it lands squarely on that path.

    The `VALUES ($1, $2, …)` form infers from the target columns and needs no
    casts at all, which is exactly why the conversion looks safe. A mocked pool
    can never see it: it accepts any string.
    """
    code = _sql_source(SERVICE)
    m = re.search(
        r"INSERT INTO notifications \(([^)]*)\)(.*?FROM unnest\([^;]*?\) AS x\([^)]*\))",
        code,
    )
    assert m, (
        "the notifications insert is not the single-statement unnest form; it "
        "is one round trip per recipient, in series, inside the send request"
    )
    columns = {c.strip() for c in m.group(1).split(",") if c.strip()}
    unknown = columns - NOTIFICATION_COLUMNS
    assert not unknown, (
        f"the notification insert names {sorted(unknown)}, which "
        f"public.notifications does not have"
    )
    assert "task_id" not in columns, (
        "`InboxPage.jsx:59` reads `if (n.task_id) setDrawerTaskId(n.task_id); "
        "else if (n.url) navigate(n.url)` — any value here opens an empty task "
        "drawer instead of the message, and the url is never read"
    )

    statement = m.group(0)
    for bind in re.findall(r"\$\d+(?!\d)(?:::\w+(?:\[\])?)?", statement):
        assert "::" in bind, (
            f"{bind} is bound without a cast in an INSERT … SELECT; Postgres "
            f"cannot infer its type and every mention 500s at Parse time"
        )
