"""
The scheduled-publish sweep — the cap, the claim, and the sentence a truncated
sweep has to say.

── WHAT WAS WRONG ───────────────────────────────────────────────────────────

`process_scheduled_posts` was one query:

    SELECT id FROM staging.hub_publish_queue
     WHERE status='scheduled' AND scheduled_for <= NOW()
     ORDER BY scheduled_for LIMIT 10

and the only caller was Railway's `cron-daily` at `15 1 * * *`. A post scheduled
for 10:00 went out at about 01:15 the following night; the eleventh due post
waited another day behind the same ceiling; and neither fact appeared anywhere.
The queue row said 'published', the cron answered 200, and it read as success.

The two halves were ruled on separately, and they are not the same kind of
thing. The CAP is a volume setting and is now per-organisation, held in
`organisations.settings->>'publish_batch_limit'` — a jsonb column that already
carries this product's other per-org operational facts, so no table and no
migration. The FREQUENCY is a bug: arming a fifteen-minute sweep is a Railway
change, and what belongs in this repository is making that sweep SAFE. Safe
means three things, and every one of them is asserted below:

  · it cannot publish the same post twice when two ticks overlap,
  · it cannot starve the tail of a capped organisation's queue,
  · and when the cap truncates a sweep it SAYS SO, with the count left behind.

── AND THE FIVE LISTERS NOBODY HAS RUN ──────────────────────────────────────

`hub_publish`'s YouTube, Pinterest, X, Threads and Reddit destination listers
were written from published API references and have never been run against a
live account — their own docstrings say so, and verifying them would mean
completing an OAuth flow, which is not a thing to do. What CAN be held is the
promise those docstrings make: a wrong field name costs the person a sentence
saying the network returned nothing, never a 500 on a redirect they cannot
retry without re-consenting. The last section of this file holds it for all
five, against both shapes of wrongness — a network that raises, and a network
that answers 200 with a body in a shape we did not expect.
"""
import ast
import inspect
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import social_publisher as sp
import routers.hub_publish as hp


# ── 1 · the cap is a setting, and no typo in it may stop a firm publishing ───


def test_an_org_with_no_setting_gets_the_default():
    assert sp.batch_limit_for(None) == sp.DEFAULT_BATCH_LIMIT
    assert sp.batch_limit_for("") == sp.DEFAULT_BATCH_LIMIT
    assert sp.batch_limit_for("   ") == sp.DEFAULT_BATCH_LIMIT


def test_a_number_aekam_set_is_the_number_used():
    # `settings->>'k'` returns TEXT, always, whatever went into the jsonb.
    assert sp.batch_limit_for("50") == 50
    assert sp.batch_limit_for(" 7 ") == 7
    assert sp.batch_limit_for(120) == 120


def test_a_typo_falls_back_and_never_holds_the_queue():
    """The failure direction matters more than the parse.

    A cap is a CEILING. If a mistyped one were read as zero, every scheduled
    post for that firm would sit in the queue for ever while every log line
    said the sweep found nothing due — the exact disease this whole change is
    treating, reintroduced through a settings form.
    """
    for bad in ("ten", "1e3", "", "null", [], {}, "0", "-4", 0, -1):
        assert sp.batch_limit_for(bad) == sp.DEFAULT_BATCH_LIMIT, bad


def test_one_org_cannot_hold_a_tick_for_ever():
    """A sweep is sequential and a publish is a network call — YouTube's is
    allowed 120 seconds. A four-figure cap on one org would starve every other
    org on the tick, so it is clamped and LOGGED rather than clamped quietly."""
    assert sp.batch_limit_for("100000") == sp.MAX_BATCH_LIMIT
    assert sp.MAX_BATCH_LIMIT > sp.DEFAULT_BATCH_LIMIT


# ── 2 · silent truncation is the bug; the count left behind is the fix ───────


def test_a_sweep_that_took_everything_says_nothing():
    assert sp.truncation_notice("Aekam Inc", 4, 4) is None
    assert sp.truncation_notice("Aekam Inc", 0, 0) is None


def test_a_truncated_sweep_names_the_count_left_behind():
    """Ten of ten and ten of four hundred produce identical rows, identical
    results and an identical 200. Only this sentence tells them apart."""
    msg = sp.truncation_notice("Aekam Inc", 400, 10)
    assert msg is not None
    assert "390" in msg
    assert "Aekam Inc" in msg
    assert sp.BATCH_LIMIT_KEY in msg


def test_the_notice_names_the_org_and_never_its_id():
    """Names, not ids — a uuid in a 03:00 log line is one more lookup for
    whoever is reading it."""
    msg = sp.truncation_notice("Unicode Group", 30, 10)
    assert "Unicode Group" in msg


# ── 3 · the sweep itself ────────────────────────────────────────────────────


def _sweep_pool(plan, candidates, claims=None):
    """A pool that answers the sweep's two reads and its claim.

    The sweep issues exactly one plan query, then one candidate query per
    organisation, then one claim per candidate. `claims` maps a queue id to
    whether the claim wins; anything not named wins, which is the ordinary
    case.
    """
    pool = MagicMock()
    claims = claims or {}
    calls = {"plan": 0, "candidates": [], "claimed": []}

    async def _fetch(sql, *args):
        if "GROUP BY" in sql:
            calls["plan"] += 1
            return plan
        calls["candidates"].append((args[0], args[1]))
        return [{"id": i} for i in candidates.get(args[0], [])][: args[1]]

    async def _fetchval(sql, *args):
        assert "status='publishing'" in sql
        queue_id = args[0]
        if claims.get(queue_id, True):
            calls["claimed"].append(queue_id)
            return queue_id
        return None

    pool.fetch = AsyncMock(side_effect=_fetch)
    pool.fetchval = AsyncMock(side_effect=_fetchval)
    pool.execute = AsyncMock(return_value="UPDATE 1")
    return pool, calls


@pytest.fixture
def published(monkeypatch):
    """`publish_content` replaced by a recorder. Nothing here posts anything."""
    seen = []

    async def _publish(queue_id):
        seen.append(queue_id)
        return {"status": "published", "platform_post_id": f"p_{queue_id}"}

    monkeypatch.setattr(sp, "publish_content", _publish)
    return seen


@pytest.mark.asyncio
async def test_the_cap_is_applied_per_org_and_not_across_the_product(
    monkeypatch, published,
):
    """The old `LIMIT 10` was global: eleven orgs with one post each meant one
    org got nothing, and which one depended on `scheduled_for`. The cap is a
    per-org volume setting, so it has to be asked of each org separately."""
    plan = [
        {"org_id": "org-a", "org_name": "Aekam Inc", "due": 3, "raw_limit": None},
        {"org_id": "org-b", "org_name": "Unicode Group", "due": 2, "raw_limit": "1"},
    ]
    pool, calls = _sweep_pool(plan, {
        "org-a": ["a1", "a2", "a3"],
        "org-b": ["b1", "b2"],
    })
    monkeypatch.setattr(sp, "get_pool", AsyncMock(return_value=pool))

    out = await sp.sweep_scheduled_posts()

    # Each org asked for with ITS OWN limit.
    assert calls["candidates"] == [("org-a", sp.DEFAULT_BATCH_LIMIT), ("org-b", 1)]
    assert published == ["a1", "a2", "a3", "b1"]
    assert out["taken"] == 4
    assert out["organisations"] == 2
    # Unicode Group's second post is still scheduled and is counted as owed.
    assert out["left_behind"] == 1


@pytest.mark.asyncio
async def test_a_truncated_sweep_is_logged_with_the_count(
    monkeypatch, published, caplog,
):
    plan = [{"org_id": "org-a", "org_name": "Aekam Inc", "due": 40, "raw_limit": "2"}]
    pool, _ = _sweep_pool(plan, {"org-a": [f"q{i}" for i in range(40)]})
    monkeypatch.setattr(sp, "get_pool", AsyncMock(return_value=pool))

    with caplog.at_level("WARNING", logger=sp.log.name):
        out = await sp.sweep_scheduled_posts()

    assert out["left_behind"] == 38
    # WARNING and not INFO: a capped sweep that reads as a quiet one is the
    # whole defect.
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert any("38 WERE LEFT BEHIND" in r.getMessage() for r in warnings), caplog.text


@pytest.mark.asyncio
async def test_two_overlapping_ticks_cannot_publish_the_same_post_twice(
    monkeypatch, published,
):
    """A fifteen-minute schedule means ticks WILL overlap — one publish is a
    network call and YouTube's is allowed two minutes. A post that goes out
    twice under the client's own name cannot be taken back."""
    plan = [{"org_id": "org-a", "org_name": "Aekam Inc", "due": 3, "raw_limit": None}]
    pool, calls = _sweep_pool(
        plan, {"org-a": ["q1", "q2", "q3"]},
        # q2 was claimed by the tick that is still running, or cancelled
        # between the SELECT and the claim.
        claims={"q2": False},
    )
    monkeypatch.setattr(sp, "get_pool", AsyncMock(return_value=pool))

    out = await sp.sweep_scheduled_posts()

    assert published == ["q1", "q3"]
    assert "q2" not in published
    assert out["taken"] == 2
    # A row somebody else holds is NOT a failure and NOT a truncation: it is
    # going out on the other tick right now. Counting it as left behind would
    # report a queue backing up when it is not.
    assert out["left_behind"] == 0


@pytest.mark.asyncio
async def test_nothing_due_is_a_quiet_success(monkeypatch, published):
    pool, _ = _sweep_pool([], {})
    monkeypatch.setattr(sp, "get_pool", AsyncMock(return_value=pool))
    out = await sp.sweep_scheduled_posts()
    assert out == {"results": [], "organisations": 0, "taken": 0, "left_behind": 0}
    assert published == []


@pytest.mark.asyncio
async def test_the_old_list_shape_still_answers_both_cron_doors(
    monkeypatch, published,
):
    """`scheduler.run_publish` counts failures out of a list and
    `hub_publish.dispatch_scheduled_posts` counts published and failed out of
    the same list. Changing that shape would have made a cron that answers 200
    on a sweep that failed."""
    plan = [{"org_id": "org-a", "org_name": "Aekam Inc", "due": 1, "raw_limit": None}]
    pool, _ = _sweep_pool(plan, {"org-a": ["q1"]})
    monkeypatch.setattr(sp, "get_pool", AsyncMock(return_value=pool))

    out = await sp.process_scheduled_posts()
    assert isinstance(out, list)
    assert out[0]["status"] == "published"


# ── 4 · ratchets, because the shape of the fix is the fix ───────────────────


def test_the_sweep_no_longer_carries_a_global_limit():
    """`LIMIT 10` with no org beside it is the bug, spelled in SQL."""
    src = inspect.getsource(sp.sweep_scheduled_posts)
    assert "LIMIT 10" not in src
    assert "$2::int" in src, "the per-org limit must be a bound, cast parameter"


def test_the_claim_keeps_its_mutual_exclusion():
    """`WHERE ... AND status='scheduled'` IS the lock. Without that clause two
    overlapping ticks both publish, and this is a channel where that cannot be
    undone."""
    src = inspect.getsource(sp._claim_for_publish)
    assert "status='scheduled'" in src
    assert "RETURNING" in src


def test_the_candidate_order_is_total():
    """`ORDER BY scheduled_for` alone is not a total order: two posts scheduled
    for the same minute come back in whatever order the planner likes, so the
    row at the tail of a capped sweep can be a different row every tick and be
    starved for ever behind a cap it keeps just missing."""
    src = inspect.getsource(sp.sweep_scheduled_posts)
    assert "ORDER BY q.scheduled_for, q.id" in src


def test_the_cap_lives_in_an_existing_column_and_needs_no_migration():
    """The owner's words were "aekam can amend this as needs or requested by
    org", and `organisations.settings` is where this product's other per-org
    operational facts already live (`lead_capture_email`,
    `lead_capture_client_id`). A new settings table would have needed a
    migration applied before publishing worked at all."""
    src = Path("services/social_publisher.py").read_text(encoding="utf-8")
    assert "public.organisations" in src
    assert "settings->>" in src
    assert sp.BATCH_LIMIT_KEY == "publish_batch_limit"


def test_the_railway_schedule_is_written_down_rather_than_armed():
    """The frequency cannot be fixed from this repository and must not be
    guessed at by whoever reads the cron next."""
    from routers import scheduler

    doc = inspect.getdoc(scheduler.run_publish) or ""
    assert "*/15 * * * *" in doc
    assert "cron-daily" in doc


# ── 5 · the five listers nobody has run against a live account ──────────────
#
# NOT verified by connecting an account — an OAuth flow is never completed from
# here and no credential is ever entered anywhere. What is verified is the only
# promise that can be kept without a live network: whatever these five do, the
# person on the far end of the redirect gets a sentence and not a 500.

_UNVERIFIED = ["youtube", "pinterest", "twitter", "threads", "reddit"]


def _swap_httpx(monkeypatch, client_factory):
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: client_factory())


class _Raises:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get(self, *a, **kw): raise RuntimeError("the network is down")


def _answers(payload):
    class _Resp:
        def raise_for_status(self): return None
        def json(self): return payload

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw): return _Resp()
    return _Client


@pytest.mark.parametrize("platform", _UNVERIFIED)
@pytest.mark.asyncio
async def test_a_network_that_raises_costs_a_sentence_not_a_500(
    platform, monkeypatch,
):
    _swap_httpx(monkeypatch, _Raises)
    assert await hp._list_destinations(platform, "tok", "", None, []) == []


@pytest.mark.parametrize("platform", _UNVERIFIED)
@pytest.mark.parametrize("body", [
    {},                                  # 200 with nothing in it
    {"items": []},                       # the right key, no rows
    {"items": [{}]},                     # a row with no id
    {"data": []},                        # a list where a dict was expected
    {"data": {"id": ""}},                # an id that is empty
    {"unexpected": {"shape": True}},     # every field name wrong
    [],                                  # not an object at all
])
@pytest.mark.asyncio
async def test_a_wrong_field_name_costs_a_sentence_not_a_500(
    platform, body, monkeypatch,
):
    """THE FAILURE THESE FIVE ARE MOST LIKELY TO HAVE. They were written from
    published references, so the plausible defect is not "the network is down"
    but "the key is called something else" — a 200 whose body we misread. Every
    one of these bodies must come back as an empty list, which the callback
    turns into `?oauth=nodestination` and the picker turns into a sentence."""
    _swap_httpx(monkeypatch, _answers(body))
    out = await hp._list_destinations(platform, "tok", "", None, [])
    assert out == [], f"{platform} answered {out!r} for {body!r}"


@pytest.mark.asyncio
async def test_a_destination_that_does_come_back_is_still_complete(monkeypatch):
    """The other direction: the survivability above must not have been bought
    by swallowing a good answer. X is the simplest of the five — one profile,
    no page concept — so it is the one that proves the happy path still fills
    every key `connect_social_account`'s insert requires."""
    _swap_httpx(monkeypatch, _answers({"data": {"id": "77", "username": "aekam"}}))
    out = await hp._list_destinations("twitter", "tok", "", None, ["tweet.write"])
    assert len(out) == 1
    dest = out[0]
    assert dest["name"] == "aekam"
    assert dest["account_id"] == "77"
    assert dest["kind"] in hp.DESTINATION_KINDS
    # The token is encrypted on the way into the parked payload, once, and the
    # row insert passes it through untouched.
    assert dest["access_token"] != "tok"
    for key in ("name", "kind", "account_id", "page_id", "access_token",
                "refresh_token", "token_expires_at", "scopes", "metadata"):
        assert key in dest


def test_every_unverified_lister_still_says_so_in_its_own_docstring():
    """The five have not been run against a live account and must not come to
    look as though they have. Removing the sentence is how an unverified thing
    quietly becomes a verified one."""
    for name in ("_list_youtube_destinations", "_list_pinterest_destinations",
                 "_list_twitter_destinations", "_list_threads_destinations",
                 "_list_reddit_destinations"):
        doc = inspect.getdoc(getattr(hp, name)) or ""
        assert "UNVERIFIED AGAINST A LIVE ACCOUNT" in doc, name


def test_the_dispatcher_is_what_makes_them_survivable():
    """Each lister lets its own exception out on purpose — the catch is at
    `_list_destinations`, once, so a sixth network added tomorrow is covered
    without anybody remembering to. Pinned so nobody moves the try/except into
    the five and leaves the seventh uncovered."""
    tree = ast.parse(Path("routers/hub_publish.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_list_destinations":
            handlers = [n for n in ast.walk(node) if isinstance(n, ast.Try)]
            assert handlers, "_list_destinations must catch what the listers raise"
            caught = [h for t in handlers for h in t.handlers]
            assert any(
                isinstance(h.type, ast.Name) and h.type.id == "Exception"
                for h in caught
            ), "a bare platform error must not reach the redirect"
            return
    raise AssertionError("_list_destinations is gone")
