"""
messaging.py — Sanvaad · संवाद (Internal Messaging) Router
Channels, messages, threads, reactions, read state.

── The user join: `users`, and `avatar`, not `staging.users` / `avatar_url`

Every query below joined `staging.users` and selected `u.avatar_url`. Checked
against the live catalogue, read-only, on the database the app actually runs on
(`SET search_path TO staging, public`, db.py:44):

    to_regclass('staging.users')                                   → NULL
    column `avatar_url` on public.users                            → absent
    public.users has `avatar`                                      → present

So `staging.users` did not resolve and `u.avatar_url` did not exist. Both are
hard errors at execution, not silent nulls — UndefinedTableError and
UndefinedColumnError — which means every read endpoint in this router answered
500 against a real database: the member directory, the channel member list,
message listing (both the paged and unpaged arm), and the thread view. Sanvaad
could not load a single message.

`routers/search.py:386` already recorded that `staging.users` "does not exist on
this database" and deliberately joined the unqualified `users` for its Sanvaad
group; `migrations/PROPOSED_065_module_role_levels.sql:248-255` recorded the
same doubt and left it open — "Either that object exists and was created outside
this directory, or those four Sanvaad queries are broken." It is the latter, and
it was six places rather than four. This file now joins `users` like every other
router (auth_router, approvals_router, invite_router, server.py).

PROVEN AGAINST THE LIVE DATABASE, 2026-07-27. The suite could not prove this:
`pytest` mocks the pool, so every one of these tests passed BEFORE the fix too —
a mocked cursor never resolves a table name. So the directory query below was
run read-only against the real schema with its parameters inlined, and returned
real rows. Every table and column this module touches was checked the same way:

    staging.samvada_channels / _channel_members / _messages / _message_reactions
    staging.user_roles                                        all resolve
    public.users . user_id, full_name, name, avatar, email    all exist

If you change a join here, re-run it against the catalogue rather than trusting
green tests — green is what this module had while every read endpoint 500'd.

`u.avatar AS avatar_url` / `u.avatar AS sender_avatar` keep the WIRE names the
frontend already reads (`Avatar.jsx:49`, `org/MemberTable.jsx:87-89`,
sanvaad message components), so only the SQL changes and no client does.

── Slack parity (migration 093): mentions, search, pins, typing, presence, mute

Four decisions shape everything added below. Each is restated as a comment at
the handler that implements it, because a decision recorded only in a spec is a
decision the next reader will re-litigate:

  D1  There is ONE new polling endpoint, `GET /live`, and it is a GET on
      purpose. `server.global_write_rate_limit` gives each client IP 120
      POST/PUT/PATCH/DELETE per wall-clock minute; a dedicated typing POST at
      3s is 20 writes/min/user, so four colleagues behind one office NAT would
      spend two-thirds of the office's entire write budget on animated dots.
      Worse, `middleware.subscription._is_write` returns True for any POST whose
      path does not end in one of `READ_SHAPED_POSTS`, so a typing POST would
      403 for a legacy `viewer` grant-holder before the handler ran. `/live`
      therefore carries the typing ping, the presence heartbeat, the unread and
      mention counts and the presence map in one exempt request.
  D2  Mentions are resolved SERVER-SIDE from the message text. The request body
      carries no `mentions[]` array. The renderer already derives mentions from
      body text (`splitMentions`); a parallel client-supplied id list is a
      second source of truth that can disagree with the first, and a client
      could fabricate one.
  D3  Mute is editor-gated, and that is accepted rather than worked around.
      `PUT /channels/{id}/mute` is a genuine write and takes the verb gate.
      `NEW_GRANT_LEVEL_BY_MODULE["sanvaad"]` is EDITOR, so only legacy `viewer`
      rows are affected, and a viewer who cannot post has the weakest case for
      needing to mute.
  D4  Polling stays. Supabase's pooler runs in transaction mode on :6543 where
      `LISTEN`/`NOTIFY` does not work, and the service runs several gunicorn
      workers, so an in-process broadcast would reach one worker's clients only.
      No websockets. This is a constraint of the infrastructure, not an
      unfinished job.

`_parity_ready` below is why none of this 500s during the window between a
deploy and the hand-applied migration — see its docstring.

── Mute writes a membership row, and `joined_at` is what marks it as not a join

There is nowhere else in this schema for a per-channel preference to live, so
muting a public channel you never opened has to write a
`samvada_channel_members` row. Unmuting then has to be able to take that row
away again, and taking it away safely means telling an auto-created row from a
real join — which needs a marker 058 did not provide. A marker COLUMN is not
available: migrations here are applied by hand and adding one is not part of
this change.

`joined_at` is the marker, because it is the one column on that table with room
for it. It is `NOT NULL DEFAULT NOW()`, no handler has ever written it
explicitly — every join path lets the default fire — and nothing in the product
reads it, so its value is NOW() on every genuine join and free to carry a
sentinel on a row that is not one. `'-infinity'` is that sentinel: it is
already this file's idiom for a timestamp floor, and it is unmistakably "no such
moment" rather than a date somebody could read as real.

Three places hold the invariant up and all three are load-bearing:

  · `set_channel_mute` stamps the sentinel on the row it creates.
  · `set_channel_mute` DELETES a sentinel row on unmute rather than flipping
    `muted` back to false. That is the whole point: a row left behind puts you
    in `member_count`, in `GET /channels/{id}/members`, in `@channel`'s
    fan-out, and — because `cm_me.user_id IS NOT NULL` then holds — starts
    showing you unread badges for a room you never opened.
  · `add_member` CLEARS the sentinel, because being added by somebody is a real
    join and a later unmute must not silently undo it. `send_message`'s
    auto-join needs no equivalent: the unmute DELETE already refuses to fire
    for anybody who has posted in the channel, which is the same fact read from
    the other end and costs nothing on the send path to establish.

The row is NOT hidden from `member_count`, from `list_members` or from anything
else while the mute stands. It could be, here — but `@channel`'s fan-out and the
fifteen-head broadcast ceiling both count that table from
`services/samvaad_mentions.py`, which this change does not touch, so filtering
only the two reads that live in this file would leave the member list saying
fifteen while the broadcast rule counts sixteen. One honest row beats two counts
of it that disagree. What follows from the row while it exists is written out at
`set_channel_mute`, unchanged.

── Channel colour (migration 100): assigned at creation, stored, editable

The owner's words: "if i create an new channel it gets assinged a different
random and it stays, no changes everytime". Three properties, and the middle one
is the one a hash of the channel id would have given for free — a hash is stable
but UNCHANGEABLE, and "editable later" is the whole reason there is a column at
all rather than a function.

Four decisions, each restated at the code that implements it:

  C1  IT IS A TONE KEY, NEVER A HEX. `color` holds 'graha', 'ganit', … — the id
      of a module tone. `module.css` declares every tone twice, light and dark,
      and the two ramps are opposite temperatures rather than one being a tint of
      the other, so a stored hex can only be right in one theme. The key resolves
      through `var(--m-<key>)` and follows the theme for free. The key IS the
      variable name, so there is no lookup table to drift.
  C2  ROTATION, NOT RANDOM, AND NOT `COUNT(*) % 8`. Random over eight tones
      collides about 60% of the time by the sixth channel (the birthday problem),
      which defeats colour-coding entirely. But a naive count is worse than it
      looks: delete the fifth of six channels and the next `COUNT(*) % 8` reissues
      a colour that is still on the rail. `pick_channel_tone` counts what is
      ACTUALLY IN USE and takes the least-used tone, so it can only ever repeat a
      colour once all eight are live.
  C3  A DM HAS NO COLOUR, and NULL there is the correct value rather than missing
      data. The rail renders a DM as the other person, not as a `#glyph`, so
      there is no tile to colour — and assigning one would spend the rotation on
      tiles nobody can see, leaving named channels colliding while eight tones
      sit invisible in private conversations. `find_or_create_dm` assigns none
      and `_channel_tones_in_use` does not count them.
  C4  ASSIGNMENT IS SILENT WHEN 100 IS OUTSTANDING; AN EDIT IS NOT. `_colour_ready`
      is 093's `_parity_ready` argument applied to one column. Creation must keep
      working before the migration, so it simply assigns no tone. A user pressing
      a colour swatch is a click, and `_parity_ready`'s own rule for clicks is
      that they must fail loudly — so an edit answers 503 naming the migration
      rather than 500ing on UndefinedColumn or, worse, appearing to save.
"""
import logging
import time
from typing import List, Mapping, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.module_levels import held_level
from middleware.org_resolver import get_org_id
from middleware.role_tiers import level_satisfies
from middleware.subscription import require_module
from services.audit_actors import display_name

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/messaging", tags=["sanvaad-messaging"])

# `sanvaad`, not `samvada`. `require_module` uses this ONE string for both the
# grant lookup (`org_member_modules`) and the entitlement lookup
# (`module_subscriptions`), and that second table has only ever held `sanvaad` —
# so the old spelling matched no subscription row and this gate returned
# "Module 'samvada' is not active" to everyone, org_owner included. The tables
# below stay `samvada_*`; those are table names, not the module code.
_gate = require_module("sanvaad")

MODULE = "sanvaad"

#: Slack's own pin cap is 100. Fifty is enough for a working channel and it is
#: what keeps `GET /channels/{id}/pins` a single unpaged query — the bar is the
#: cap, so the endpoint never needs a cursor.
_PIN_CAP = 50

#: The one sentence every write path says when it refuses an archived channel.
#: `ScreensSanvaad.jsx:260` and `:290` show the user "History stays searchable;
#: nobody can post" and "nobody can post, including admins"; a banner that only
#: some of the doors honour is worse than no banner, because the user has been
#: told the room is closed. It was a literal in `send_message` and a second copy
#: in `pin_message`; five handlers say it now, and five copies drift.
_ARCHIVED_REFUSAL = "This channel is archived — nobody can post, including admins."

#: THE EIGHT CHANNEL TONES, IN ROTATION ORDER. Module tone ids from
#: `frontend/src/styles/module.css`, NOT hexes — see C1 in the module docstring.
#:
#: The order is the design's own. `docs/proposals/09-sanvaad-design-system.html`
#: declares `--sv-ch-1 … 8` as literal hexes, and those eight hexes are byte for
#: byte the first eight `--m-*` values in module.css, in this sequence:
#:
#:     sv-ch-1 #2F6690 graha    sv-ch-5 #6B4FA8 vetana
#:     sv-ch-2 #2E7D52 ganit    sv-ch-6 #24707F dristi
#:     sv-ch-3 #A65A2E manav    sv-ch-7 #8A6A18 prachar
#:     sv-ch-4 #A83E63 vikray   sv-ch-8 #8E4A86 sanvaad
#:
#: So this is not a second colour set; it is the approved one, named by something
#: that already exists in both themes.
#:
#: EIGHT AND NOT FIFTEEN, though module.css declares fifteen: proposal 09 — "past
#: eight, adjacent hues stop being distinguishable at 22px and the colour stops
#: being a navigation aid".
#:
#: THIS TUPLE, `samvada_channels_color_ck` IN MIGRATION 100, AND THAT FILE'S
#: BACKFILL ARRAY ARE ONE VOCABULARY IN THREE PLACES. `test_channel_colour.py`
#: reads all three — and module.css — and fails if any of them moves alone.
CHANNEL_TONES = (
    "graha", "ganit", "manav", "vikray",
    "vetana", "dristi", "prachar", "sanvaad",
)

#: `None` = not yet probed. See `_parity_ready`.
_PARITY_READY: Optional[bool] = None

#: `time.monotonic()` after which a cached FALSE may be probed again. Only a
#: false is ever re-probed; see the asymmetry in `_parity_ready`. Monotonic and
#: not wall-clock, so an NTP step on the container cannot stretch the window to
#: an hour or collapse it to nothing.
_PARITY_RECHECK_AFTER: float = 0.0

#: How long "093 is not applied" is trusted before it is asked again. Long
#: enough to be invisible next to a four-second poll — one extra `to_regclass`
#: per worker per minute, and only while the migration is outstanding — and
#: short enough that whoever runs `psql -f 093_sanvaad_slack_parity.sql` sees
#: mentions light up while they are still watching the screen.
_PARITY_RECHECK_SECONDS: float = 60.0

#: 093 is one BEGIN/COMMIT, so either every object in it exists or none does.
#: That is what lets one boolean stand in for four relations and two columns.
#: The mentions table is the relation half; `search_tsv` is the generated-column
#: half, and a column cannot be seen by `to_regclass`.
_PARITY_PROBE_SQL = """
    SELECT to_regclass('samvada_mentions') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = ANY(current_schemas(false))
                      AND table_name = 'samvada_messages'
                      AND column_name = 'search_tsv')
"""


async def _parity_ready(pool) -> bool:
    """Has migration 093 been applied to the database this process talks to?

    Migrations here are applied BY HAND (`psql "$DATABASE_URL" -f …`); there is
    no runner in the app. So there is always a window — minutes or days — in
    which this code is deployed and 093 is not. Everything 093 adds is reached
    by a poll that fires every four seconds and by the channel rail that renders
    on every page load, which means that window would otherwise be a steady
    stream of 500s from `UndefinedTableError` on the most-hit endpoints in the
    module rather than one loud failure somebody notices and fixes.

    So: a catalogue read, cached, and the affected reads degrade to what the
    pre-093 schema can answer (no mentions, no typing, no presence, ILIKE-only
    search). The USER-INITIATED writes — pin and unpin — are deliberately NOT
    guarded: a click that fails should fail loudly, and nobody is clicking pin
    sixty times a minute.

    ── The cache is ASYMMETRIC, and that asymmetry is the whole design

    TRUE is kept for the life of the process. A migration is not un-applied:
    093 has no down script and nothing in the product drops those objects, so
    there is no answer for a true to change into. If somebody did drop the table
    by hand, the reads would raise `UndefinedTableError` and that is correct — a
    relation vanishing under a running service is not a state to quietly degrade
    into, it is one somebody has to hear about.

    FALSE expires after `_PARITY_RECHECK_SECONDS`, because it is not a fact
    about this build, it is a fact about the world at one instant, and the world
    changes without telling this process. The migration is applied BY HAND,
    minutes or days after the deploy. Cached forever, the first poll after a
    deploy pins the worker to the degraded path — and then hand-applying 093
    changes NOTHING. Mentions, typing, presence and pins stay dark until
    somebody redeploys the Railway service, with no error, no log line and no
    banner anywhere saying why, which is a defect whose only symptom is "the
    feature we shipped last week does not work". Re-probing costs one
    `to_regclass` per worker per minute, only inside the window where the
    migration is outstanding, and it stops the moment the answer flips.

    No lock around the probe. Two requests landing inside the same expired
    window will both run it; they read the same catalogue and compute the same
    value, so the race is a duplicate SELECT and not a wrong answer, and an
    `asyncio.Lock` on a path this hot would cost more than the read it saves.

    Fails OPEN, but does NOT cache the optimistic answer. Assuming "not applied"
    on a blip would silently disable mentions, and a silent no-notification is
    the exact defect `renderMentions.test.jsx` was written about — but caching
    the optimistic answer is worse in the other direction, because it turns one
    transient error into a dead module. See the `except` below.

    Cached at module scope, so a test that answers the probe falsely poisons
    every later test in the same process. `_reset_parity_cache()` exists for
    that; a test that needs the full schema should set the cache explicitly.
    """
    global _PARITY_READY, _PARITY_RECHECK_AFTER
    if _PARITY_READY is True:
        return True
    if _PARITY_READY is False and time.monotonic() < _PARITY_RECHECK_AFTER:
        return False
    try:
        probed = bool(await pool.fetchval(_PARITY_PROBE_SQL))
    except Exception as exc:  # pragma: no cover — catalogue read
        # Optimistic for THIS request, and the cache is deliberately left
        # untouched. Writing True here was a self-inflicted outage: a single
        # pooler reset or checkout timeout during the pre-093 window would pin
        # the worker to "applied" for the life of the process, and every one of
        # /channels, /live, /mentions, /search and /pins would then 500 forever
        # with no recovery short of a redeploy. The FALSE branch below has a TTL
        # for exactly this reason; the exception path must not be stickier than
        # a real answer.
        log.warning("sanvaad: 093 readiness probe failed, assuming applied: %s", exc)
        return True
    _PARITY_READY = probed
    if _PARITY_READY is False:
        _PARITY_RECHECK_AFTER = time.monotonic() + _PARITY_RECHECK_SECONDS
    return _PARITY_READY


def _reset_parity_cache(value: Optional[bool] = None) -> None:
    """Test seam for the process-wide cache above. Not called by the app.

    A pinned FALSE is pinned FOREVER rather than for the TTL. A test that sets
    it is asserting the pre-093 path, and it must keep asserting that path even
    if the suite is slow enough for a real TTL to expire mid-test — at which
    point the probe would run against a mock whose default `fetchval` answers
    `0`, or a MagicMock that is truthy, and the failure would land nowhere near
    the cause. `None` means "not yet probed", so the deadline is moot for it.
    """
    global _PARITY_READY, _PARITY_RECHECK_AFTER
    _PARITY_READY = value
    _PARITY_RECHECK_AFTER = float("inf") if value is False else 0.0


# ── Channel colour · migration 100 ───────────────────────────────────────────

#: Same asymmetric cache as `_PARITY_READY`, for a different migration. Kept as
#: its own pair rather than folded into 093's, because the two migrations are
#: applied on different days and one being outstanding says nothing about the
#: other — sharing a flag would mean applying 100 silently switched the mention
#: and presence paths on, or off.
_COLOUR_READY: Optional[bool] = None
_COLOUR_RECHECK_AFTER: float = 0.0

#: A COLUMN, so `to_regclass` cannot see it — the catalogue read has to go
#: through `information_schema.columns` the way 093's generated-column half does.
_COLOUR_PROBE_SQL = """
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = ANY(current_schemas(false))
                      AND table_name = 'samvada_channels'
                      AND column_name = 'color')
"""

#: Serialises tone assignment WITHIN ONE ORG for the length of the creating
#: transaction. Two admins pressing "New channel" at the same second would
#: otherwise both read the same in-use set under READ COMMITTED and both pick the
#: same tone — the exact collision the rotation exists to prevent, arrived at
#: from the other direction. The lock is org-scoped, so it never serialises two
#: tenants against each other, and it is held for the two statements between it
#: and COMMIT.
#:
#: `pg_advisory_XACT_lock`, not the session form, and that is not a style
#: preference: D4 in the module docstring records that Supabase's pooler runs in
#: TRANSACTION mode, which hands a different backend to the next transaction. A
#: session lock taken there would be released against whichever connection the
#: pooler happened to reuse — i.e. never, reliably. A transaction lock is scoped
#: to exactly the unit the pooler pins, so it is the only advisory lock that is
#: correct on this infrastructure.
#:
#: `hashtext` is an internal function rather than a documented one. It is used
#: here because the alternative — deriving an int8 from a UUID by hand — is three
#: casts of arithmetic whose only job is to be a lock key, and a WRONG key here
#: is invisible: it would simply fail to serialise, and the symptom would be an
#: occasional duplicate colour nobody could reproduce. The namespace is folded
#: into the hashed string rather than passed as a classid so this lock cannot
#: collide with a future one that picks the same arbitrary integer.
_TONE_LOCK_SQL = (
    "SELECT pg_advisory_xact_lock(hashtext('samvada_channel_tone:' || $1::text))"
)


async def _colour_ready(pool) -> bool:
    """Has migration 100 been applied to the database this process talks to?

    The full argument for why this probe exists, why the cache is asymmetric
    (TRUE forever, FALSE for a minute), why there is no lock around it and why
    the exception path is optimistic WITHOUT caching is written out once at
    `_parity_ready` and applies here unchanged. What follows is only what differs.

    THIS ONE IS ASKED ON WRITES ONLY, never on a read. `list_channels` selects
    `c.*`, which cannot raise whether the column is there or not, and
    `_channel_row` fills the key in afterwards — so the hottest path in the
    module pays nothing for this and cannot be broken by it. Only
    `create_channel` (which must decide whether to name the column in an INSERT)
    and `update_channel` (which must decide whether to accept an edit) ask.

    That makes the cost of a wrong answer smaller in one direction and larger in
    the other, which is why the two handlers treat FALSE differently — see C4.
    """
    global _COLOUR_READY, _COLOUR_RECHECK_AFTER
    if _COLOUR_READY is True:
        return True
    if _COLOUR_READY is False and time.monotonic() < _COLOUR_RECHECK_AFTER:
        return False
    try:
        probed = bool(await pool.fetchval(_COLOUR_PROBE_SQL))
    except Exception as exc:  # pragma: no cover — catalogue read
        # Pessimistic here, where `_parity_ready` is optimistic, and the cache is
        # left untouched either way. Assuming "applied" on a blip would make
        # `create_channel` name a column that may not exist, and the INSERT that
        # fails is the one that creates the channel — a blip would cost the user
        # their room. Assuming "not applied" costs one channel its colour, which
        # the next edit or a re-run of the backfill fixes.
        log.warning("sanvaad: 100 readiness probe failed, assuming absent: %s", exc)
        return False
    _COLOUR_READY = probed
    if _COLOUR_READY is False:
        _COLOUR_RECHECK_AFTER = time.monotonic() + _PARITY_RECHECK_SECONDS
    return _COLOUR_READY


def _reset_colour_cache(value: Optional[bool] = None) -> None:
    """Test seam for the process-wide cache above. Not called by the app.

    A pinned FALSE is pinned FOREVER rather than for the TTL, for the reason
    `_reset_parity_cache` gives: a test asserting the pre-migration path must
    keep asserting it even if the suite is slow enough for a real TTL to expire
    mid-test, at which point the probe would run against a mock and the failure
    would land nowhere near the cause.
    """
    global _COLOUR_READY, _COLOUR_RECHECK_AFTER
    _COLOUR_READY = value
    _COLOUR_RECHECK_AFTER = float("inf") if value is False else 0.0


def pick_channel_tone(in_use: Mapping[str, int]) -> str:
    """The next tone for a new channel, given how many LIVE channels hold each.

    PURE, and public, and that is deliberate: the rotation is the one piece of
    this feature with behaviour worth proving, and every test in this module runs
    against a mocked pool that never executes SQL. Expressed as a query — even a
    correct one — the rule would be untestable here, and `routers/messaging.py:30`
    records at length what this module's green suite was worth the last time its
    behaviour lived somewhere pytest could not reach. So the database answers
    only "how many of each are in use" and the DECISION is made in Python.

    THE RULE: the least-used tone wins; ties break by rotation order.

    That one sentence covers three cases that would otherwise be three rules:

      · FEWER THAN EIGHT CHANNELS. Every unused tone has a count of 0 and ties
        with the others, so the first unused tone in rotation order wins. The
        first eight channels are therefore always eight different colours, which
        is what "a different colour per channel" actually means.
      · A CHANNEL WAS DELETED. Its tone drops back to 0 and is immediately
        reissued — correctly, because it is no longer on the rail. This is the
        case a naive `COUNT(*) % 8` gets WRONG in the opposite direction: it
        would move on to a tone that is still on screen while leaving the freed
        one unused. The rule here cannot reissue a live colour while any tone is
        free, and that is the invariant `test_channel_colour.py` asserts over a
        long random walk of creates and deletes rather than over one example.
      · MORE THAN EIGHT CHANNELS. Repetition is unavoidable past eight, so the
        rule spreads it: the ninth channel takes the first tone again, and no
        tone is ever used twice until all eight have been used once.

    `in_use` is read defensively. Keys it does not recognise are ignored — a
    tone retired from `CHANNEL_TONES` while rows still hold it must not be
    reissued, and must not crash the lookup either — and a NULL count coming back
    from an aggregate reads as 0.
    """
    return min(
        (int(in_use.get(tone) or 0), ordinal, tone)
        for ordinal, tone in enumerate(CHANNEL_TONES)
    )[2]


async def _channel_tones_in_use(conn, org_id: str) -> dict:
    """How many of this org's LIVE channels hold each tone.

    Grouped in the database rather than fetched row by row: the answer is at most
    eight rows however many channels the org has.

    ARCHIVED CHANNELS COUNT. They are still listed — `list_channels(archived=True)`
    renders them as their own section — and `update_channel` can bring one back
    at any moment. Excluding them would let a new channel take an archived one's
    tone and produce a collision the instant somebody unarchived it, which is a
    duplicate colour with no obvious cause appearing days after the fact.

    DMs DO NOT COUNT. See C3.
    """
    rows = await conn.fetch(
        "SELECT color, COUNT(*) AS n FROM staging.samvada_channels "
        "WHERE org_id = $1::uuid AND type <> 'dm' AND color IS NOT NULL "
        "GROUP BY color",
        org_id,
    )
    return {r["color"]: r["n"] for r in rows}


def _channel_row(row) -> dict:
    """Every channel this router hands back, with `color` GUARANTEED PRESENT.

    Before migration 100 the column does not exist, so `SELECT c.*` and
    `RETURNING *` come back without the key — and a client that spreads the row
    into a style then reads `undefined`, which is not a colour and is not null
    either. `list_channels` already carries the same reasoning for
    `mention_count`: "a row missing a key the client spreads into a badge renders
    `undefined`, not zero."

    Done in Python rather than as a conditional `NULL::text AS color` in each
    query, because that would mean asking `_colour_ready` on the channel rail —
    the single hottest read in this module — to answer a question about a key
    that four lines of Python answer for free and cannot get wrong.
    """
    d = dict(row)
    d.setdefault("color", None)
    return d


async def _fan_out_mentions_guarded(pool, *, org_id: str, channel_id, message_id,
                                    actor_id: str, content: str,
                                    is_edit: bool) -> frozenset:
    """Record the mentions in a message THAT IS ALREADY COMMITTED. Never raises.

    Returns every user id the mention resolver matched — see
    `services/samvaad_mentions.fan_out_mentions` for why that is the RESOLVED set
    and not the NOTIFIED one. `send_message` hands it to
    `_notify_message_guarded` so that being named produces ONE notification
    rather than a mention plus a "new message" on top of it.

    THE EMPTY SET IS THE SAFE ANSWER on every path that does not run: 093 not
    applied, an import that fails, an exception swallowed below. It means "this
    layer claims nobody", so the message fan-out covers everyone in the room
    including anybody who was named — one notification, never two, never zero.

    Two wrappers around one call, answering two different failures.

    ── The 093 guard

    `fan_out_mentions` INSERTs into a table migration 093 creates, and 093 is
    applied by hand. Every other 093-dependent path in this file asks
    `_parity_ready` first; the two send paths did not, so during the deploy
    window "@here standup in 5" wrote the message row, bumped the channel's
    `updated_at`, and then raised `UndefinedTableError`. Skipping the fan-out
    loses nothing that was reachable anyway — `GET /mentions` returns `[]` under
    the same condition, so the feature is uniformly off rather than half-on with
    rows nobody can read.

    ── The swallow

    `services/samvaad_mentions.py` rule 4 says a failed mention insert "must
    fail the send loudly". Inside that service, next to the INSERT, that is
    right. AT THIS LAYER IT IS WRONG, and the difference is the transaction
    boundary. By the time control reaches this function the message row is
    COMMITTED — `send_message` wrote it with a bare `pool.fetchrow`, its own
    connection, its own implicit transaction — and the channel bump behind it is
    committed too. An exception raised here cannot roll either of them back. The
    only thing it can still do is turn a 201 into a 500 and tell the sender
    something untrue about what happened, and the client believes it:
    `useChannelMessages` strips its optimistic row and toasts "Failed to send",
    so a message that is sitting in the database disappears off the screen, the
    sender retypes it, and one unrecorded mention becomes two posted messages.

    So the failure is logged at ERROR with the message id — that is the loud
    part, and it is loud in the place where somebody can act on it — and the
    send answers 201. Nothing is unrecoverable: `fan_out_mentions` derives every
    recipient from `content`, which is on the row, and an edit re-runs the whole
    resolution against the same text.

    The import is inside the `try` for the same reason as everything else here:
    after the commit, nothing this function touches may be allowed to fail the
    request, and that includes a module that will not import.

    `Exception`, not `BaseException` — `asyncio.CancelledError` is a client
    disconnect and has to keep propagating so the request actually stops.
    """
    if not await _parity_ready(pool):
        return frozenset()
    try:
        from services.samvaad_mentions import fan_out_mentions
        # `or frozenset()` because a test double for this function may return
        # None, and because a caller of a "never raises" helper must not be
        # handed something it then has to null-check.
        return frozenset(await fan_out_mentions(
            pool,
            org_id=org_id,
            channel_id=channel_id,
            message_id=message_id,
            actor_id=actor_id,
            content=content,
            is_edit=is_edit,
        ) or ())
    except Exception:
        # ASCII only in the message itself. Every other log line in this module
        # is, and a stray em dash is a `UnicodeEncodeError` inside `logging` on
        # any handler that is not UTF-8 — swallowed, so the one line explaining
        # the failure is the line that goes missing.
        log.exception(
            "sanvaad: mention fan-out failed for message %s in channel %s "
            "(the message is committed and was returned to the sender)",
            message_id, channel_id,
        )
        return frozenset()


async def _notify_message_guarded(pool, *, org_id: str, channel_id, message_id,
                                  actor_id: str, content: str, message_type: str,
                                  parent_message_id, mentioned: frozenset) -> None:
    """Notify the room about a message THAT IS ALREADY COMMITTED. Never raises.

    THE BUG THIS CLOSES. Measured on the live database, read-only:
    `staging.samvada_messages` held 1,177 rows and `public.notifications` held
    ZERO rows of any message-shaped type — the only Sanvaad type ever written
    there is `mention`, 35 rows, by `services/samvaad_mentions.py`. Sending a
    message wrote the message, bumped the channel, and did nothing else. So "no
    notifications are coming" was never a delivery failure; there was nothing to
    deliver. Every decision about WHO gets one, WHEN, and through which channel
    is written out in `services/samvaad_message_notify.py`'s module docstring.

    NO `_parity_ready` GATE, and that is the one difference from
    `_fan_out_mentions_guarded`. Nothing on this path touches an object migration
    093 creates: it reads `staging.samvada_channels` and
    `staging.samvada_channel_members` (058) and writes `public.notifications`,
    which predates all of this. Message notifications therefore work on a
    database where 093 is still outstanding — which is the state the mention
    feature spends its own guard surviving.

    THE SWALLOW, for the same reason as the mention guard and not a weaker one.
    By the time this runs the message row is COMMITTED — `send_message` wrote it
    with a bare `pool.fetchrow`, its own connection, its own implicit
    transaction — and so is the channel bump behind it. Nothing raised here can
    roll either back. All an exception can still do is turn a 201 into a 500 and
    tell the sender something untrue: `useChannelMessages` strips its optimistic
    row and toasts "Failed to send", so a message that is sitting in the database
    disappears off the screen and the sender posts it again. A missing
    notification must never become a duplicated message.

    Loud in the log, where somebody can act on it. Never in the response, where
    it would only lie. `Exception` and not `BaseException`, so a client
    disconnect (`asyncio.CancelledError`) still stops the request.

    The import is inside the `try` for the same reason everything else is: after
    the commit, nothing here may be allowed to fail the request, including a
    module that will not import.
    """
    try:
        from services.samvaad_message_notify import fan_out_message_notification
        await fan_out_message_notification(
            pool,
            org_id=org_id,
            channel_id=channel_id,
            message_id=message_id,
            actor_id=actor_id,
            content=content,
            parent_message_id=parent_message_id,
            message_type=message_type,
            already_mentioned=mentioned,
        )
    except Exception:
        # ASCII only in the message itself, like every other log line in this
        # module: a stray em dash is a `UnicodeEncodeError` inside `logging` on
        # any handler that is not UTF-8, swallowed, and the one line explaining
        # the failure is the line that goes missing.
        log.exception(
            "sanvaad: message notification fan-out failed for message %s in "
            "channel %s (the message is committed and was returned to the sender)",
            message_id, channel_id,
        )


def _valid_uuid(value: Optional[str]) -> bool:
    """asyncpg raises `DataError` on `$1::uuid` for a string that is not one,
    which becomes a 500. Every uuid this router accepts from a query string or a
    JSON body is caller-supplied, so it is checked here and the caller is told
    nothing was found rather than handed a stack trace.

    A PATH SEGMENT IS CALLER-SUPPLIED TOO, and for a long time only the parity
    endpoints said so. The twelve routes that predate that work — the whole of
    the channel and message surface: `list_messages`, `send_message`,
    `mark_read`, `list_members`, `add_member`, `remove_member`,
    `update_channel`, `edit_message`, `delete_message`, `get_thread`,
    `add_reaction`, `remove_reaction` — cast `{channel_id}` and `{message_id}`
    straight to `::uuid`, so `GET /channels/abc/messages` was a 500. Not an
    exploitable one, but a 500 is what the client renders as "something went
    wrong on our side" for a request the caller malformed, and it is noise in
    the error budget that hides the 500s that do matter.

    THE REFUSAL IS 404 AND NOT 400, matching the five endpoints that already
    validate (`directory`, `pin_message`, `unpin_message`, `list_pins`,
    `set_channel_mute`) and the tests that pin them. The distinction this module
    already draws is between a PATH and a BODY: a path segment names a resource,
    so an unusable one names no resource and answers "Channel not found" /
    "Message not found" in the same words a well-formed id for a deleted channel
    would; a body field is part of a request, so `send_message`'s
    `parent_message_id` answers 400 and says what was wrong with it. Two codes
    for one input class on one module is the drift this file spends its comments
    preventing — so if this rule is ever changed, change all seventeen.
    """
    if not value:
        return False
    try:
        UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def _rowcount(status) -> int:
    """asyncpg's `execute` returns the command tag — `"UPDATE 3"`. There is no
    other way to learn how many rows an UPDATE touched without a RETURNING
    clause, and RETURNING on a mark-read is rows we would immediately discard.
    """
    try:
        return int(str(status).split()[-1])
    except (ValueError, IndexError, AttributeError):
        return 0


def _channel_label_sql(uid_param: int) -> str:
    """`#name` for a room; for a DM, the OTHER participant's name.

    `samvada_channels.name` is `''` for a DM (`find_or_create_dm` inserts it
    empty), so a mention feed or a search result that rendered `c.name` would
    show a bare `#` for every DM hit and the user would have no idea which
    conversation it came from. The subquery only runs on the DM branch — CASE
    short-circuits — so a 300-channel org does not pay for it.
    """
    # ── THE DISPLAY LADDER, AND WHY IT NO LONGER ENDS AT AN EMAIL ────────────
    #
    # Every name-a-person ladder in this router — this one, the two directory
    # arms, the typing indicator, the two `sender_name` selects and
    # `pinned_by_name` — used to be written `COALESCE(u.full_name, u.name,
    # u.email)`. THE OWNER RULED (2026-08-23) that a display-name ladder must
    # never end at an email address: two standing rules meet here — Aekam must
    # not see client emails, and a person is named by their name — and an email
    # used as a display fallback is a CONTACT DETAIL rendered as a LABEL, on a
    # screen that only ever wanted to say who somebody is. A chat sender showing
    # as an email address is not a feature being preserved; it is that leak with
    # a friendlier justification.
    #
    # MEASURED FIRST, read-only, on the live database: **0 of 35 accounts** have
    # neither `full_name` nor `name`. The email rung has never fired on real
    # data, so removing it changes nothing anybody can see today. It was not a
    # working fallback; it was a loaded gun.
    #
    # NOT LEFT BLANK. A blank cell reads as "nobody sent this", a different and
    # false claim, so the ladder ends at a stated, non-identifying label —
    # `'Unnamed member'`, the wording `routers/procurement.py:391` already uses
    # for exactly this reason rather than a third phrasing invented alongside
    # it. The real repair for a nameless account is that the account has no
    # name; the label surfaces that instead of papering over it.
    #
    # ONE SOURCE: `services.audit_actors.display_name`. `_readable_by` in
    # `services/samvaad_mentions.py` matches the composer's inserted text
    # against the SAME expression, and `test_samvaad_directory` pins the two to
    # each other — a ladder edited here alone silently stops resolving mentions,
    # which is how this feature was broken for months. It emits no `$n`, so
    # parameter numbering below is untouched.
    #
    # HERE SPECIFICALLY: the outer `COALESCE(…, 'Direct message')` stays. It
    # answers a different absence — the subquery returned NO ROW, i.e. a DM with
    # no other participant — and NULL is still what that produces, because the
    # new terminal is inside the sub-select and only fires when a user row
    # exists without a name.
    return f"""CASE WHEN c.type = 'dm' THEN COALESCE((
                        SELECT {display_name('u2')}
                          FROM staging.samvada_channel_members cm2
                          JOIN users u2 ON u2.user_id = cm2.user_id
                         WHERE cm2.channel_id = c.id AND cm2.user_id <> ${uid_param}
                         LIMIT 1), 'Direct message')
                   ELSE '#' || c.name END"""


async def _require_editor(pool, user_id: str, org_id: str) -> str:
    """`MESSAGING-ATTENDANCE-SPEC.md:73` — "viewer reads channels, editor sends
    messages, admin manages channels".

    `_gate` above answers only REACH: does a grant row exist and is the module
    subscribed. It has never answered DEPTH, so a `viewer` grant — which is what
    `DEFAULT_GRANT_LEVEL` makes every new grant — could post, edit, delete and
    react exactly like an editor. The whole viewer level was decorative on this
    module.

    `ScreensSanvaad.jsx:286-294` is the design's own statement of the rule: a
    viewer gets a locked composer reading "you can read every channel you are a
    member of, but not send". That copy only means something if the server
    refuses.

    Returns the held level so callers can put it in the error.
    """
    held = await held_level(pool, user_id, org_id, MODULE)
    if not level_satisfies(held, "editor", MODULE):
        raise HTTPException(
            403,
            "Your Sanvaad access is Viewer: you can read every channel you are a "
            "member of, but not send. Ask an org admin for Editor.",
        )
    return held


async def _assert_channel_access(pool, channel_id, org_id: str, user_id: str) -> None:
    """Caller may read this channel: it is in their org, and they are a member
    of it or it is public.

    `list_messages` already enforced exactly this before returning message
    bodies. The thread and reaction endpoints checked only that the message was
    in the caller's org, so any org member could read the replies under a DM or
    a private channel — and react to them — by passing the message id. Same
    rule, one place, so the three cannot drift apart again.
    """
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch["type"] == "public":
        return
    mem = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user_id,
    )
    if not mem:
        raise HTTPException(403, "Not a member of this channel")


async def _assert_not_archived(pool, channel_id, org_id: str) -> None:
    """The caller may WRITE into this channel: it is not archived.

    A second read of a row `_assert_channel_access` has usually just fetched, and
    that is deliberate rather than sloppy. The two helpers answer two different
    questions and every caller wants exactly one of them: `_assert_channel_access`
    asks may you SEE this room, and `list_members`, `list_pins`, `get_thread` and
    the poll must all keep passing on an archived channel, because the archive's
    entire promise is that the history stays readable. Folding the archive test
    into that helper would put both questions behind one call and leave the next
    reader working out which of its nine callers wanted which half.

    `send_message` and `pin_message` do NOT call this: both already hold the
    channel row for another reason and test the flag off it, so a call here would
    be a third round trip for a boolean they have in hand.

    A missing row reads as "not archived" and that is not a hole. Every caller
    has already located a message `WHERE org_id = $2`, and no path in this router
    can write a message whose `org_id` differs from its channel's — `send_message`
    resolves the channel org-scoped before the INSERT. If a row somehow did go
    missing here, the write is landing on a message whose channel this org cannot
    see, which the caller's own org-scoped 404 has already refused.
    """
    archived = await pool.fetchval(
        "SELECT is_archived FROM staging.samvada_channels "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if archived:
        raise HTTPException(403, _ARCHIVED_REFUSAL)


async def _assert_same_org(pool, target_user_id: str, org_id: str) -> None:
    """The user being added to a channel must belong to this org.

    Without this, `user_id` is an unvalidated caller-supplied identifier and a
    membership row could be written joining a channel in one org to a user in
    another. The org filter on every read meant that user could not actually
    read anything, so this was a cross-tenant WRITE rather than a leak — but it
    puts a foreign user in the member list and the member count, and it is the
    kind of row that becomes a leak the moment a query forgets its org filter.
    """
    ok = await pool.fetchval(
        "SELECT 1 FROM staging.user_roles "
        "WHERE user_id=$1 AND org_id=$2::uuid "
        "AND role_code IN ('org_owner','org_admin','org_member')",
        target_user_id, org_id,
    )
    if not ok:
        raise HTTPException(404, "User is not a member of this organisation")


# ── Pydantic Models ──────────────────────────────────────────

class ChannelCreate(BaseModel):
    name: str
    description: str = ""
    type: str = "public"

class ChannelUpdate(BaseModel):
    #: `color` is EDITABLE but not CLEARABLE, and the model is why: `None` on
    #: every field of this body already means "not supplied" — the SET list below
    #: is built by skipping it — so there is no value a caller could send that
    #: means "back to no colour". That is the right shape rather than a
    #: limitation to work around: a channel with no tone is what the rail looks
    #: like before migration 100, and offering a control that puts a room back
    #: into that state is offering a way to make it look broken.
    #:
    #: It is deliberately absent from `ChannelCreate`. The owner asked for the
    #: colour to be ASSIGNED — "it gets assinged a different random and it stays"
    #: — so creation has no colour field to disagree with the rotation, and the
    #: first edit is where a person's choice enters.
    name: Optional[str] = None
    description: Optional[str] = None
    is_archived: Optional[bool] = None
    color: Optional[str] = None

class MessageCreate(BaseModel):
    content: str
    type: str = "text"
    parent_message_id: Optional[str] = None

class MessageUpdate(BaseModel):
    content: str

class MentionsReadIn(BaseModel):
    """One shape per call — `mention_ids` OR `mark_all`, never both.

    This is the contract `MarkReadIn` on `POST /api/notifications/mark-read`
    already speaks, and the inbox client already knows how to speak it. Sending
    both is refused rather than silently resolved, because "I sent ids AND
    mark_all" has two plausible readings and guessing which one the caller meant
    is how a badge ends up cleared for a channel the user never opened.
    """
    mention_ids: List[str] = []
    mark_all: bool = False
    channel_id: Optional[str] = None

class MuteIn(BaseModel):
    muted: bool


# ── Channels ─────────────────────────────────────────────────

@router.get("/me")
async def my_access(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The caller's own level on Sanvaad, so the composer can lock itself.

    Nothing in `frontend/src` could previously learn this. `GET /v1/me` returns
    `module_grants[]` — module CODES only, no level — which answers reach and not
    depth, so the client could tell whether Messaging belongs in the sidebar and
    not whether this user may type in it. Without this the locked composer in
    `ScreensSanvaad.jsx:286` is unbuildable and a viewer would discover the rule
    only by writing a message and watching it 403.

    Deliberately narrow: this module's level and the two booleans derived from
    it, not a general permissions feed.
    """
    pool = await get_pool()
    level = await held_level(pool, user["user_id"], org_id, MODULE)
    return {
        "module": MODULE,
        "level": level,
        "can_post": level_satisfies(level, "editor", MODULE),
        "can_manage": level_satisfies(level, "admin", MODULE),
    }


@router.get("/directory")
async def directory(
    q: Optional[str] = None,
    channel_id: Optional[str] = None,
    limit: int = Query(50, le=200),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The people who can be added to a channel, opened as a DM, or MENTIONED.

    `add_member` and `find_or_create_dm` both take a `user_id` the caller has to
    have got from somewhere, and there was nowhere: `GET /v1/org/members` is the
    only user directory in the API and it is gated on
    `require_org_role("org_admin", "org_owner")`. An ordinary member therefore
    could not name anybody, which is the proximate reason both endpoints have
    had zero callers since 058 — and why a private channel can never reach a
    second member.

    Scoped to the same rows `_assert_same_org` accepts, so this can only name
    somebody the two write endpoints would go on to allow. Identity only —
    no email, because a member picker does not need one and this is reachable
    by every module holder rather than by admins.

    ── `channel_id`, because the mention picker cannot be made correct from the
    client

    Without it this is `full_name ILIKE '%q%'` over the whole org, ordered
    alphabetically and capped at `limit`. The mention RESOLVER's universe is
    narrower: `services/samvaad_mentions._readable_by` returns CHANNEL MEMBERS
    ONLY for `private` and for `dm`, and unions the org in only for `public` —
    deliberately, because a mention notification quotes 140 characters of the
    message body, so resolving somebody who cannot open the channel would mail
    them its contents.

    Sourcing a mention picker from the org anyway is the worst failure this
    feature can have: the composer inserts a correct-looking `@Full Name `, the
    message posts, the resolver finds no candidate, and there is no mention row,
    no notification, no push and no badge — and NOTHING TELLS THE SENDER. The
    clients narrow the page themselves, which closes the common case and leaves
    two silences they cannot close from where they stand:

      1. THE LIMIT CUT BEFORE THE FILTER DID. This query searched and ordered
         knowing nothing about the channel, so in an org where more than `limit`
         people match a two-letter query, a genuine member sorting past the cut
         never reached the client at all — and the client, seeing nobody
         survive its own filter, says "Only people in this conversation can be
         mentioned". The same silence, reached from the other direction.
      2. A MEMBER WHOSE `full_name` IS NULL WAS NEVER OFFERED. The column is
         nullable in `public.users`; the resolver coalesces to `name` then
         `email` and matches such a person happily, while this endpoint returned
         the bare column, so both pickers had a blank row to draw and both drop
         it (`MentionInput.tsx` filters `!!u.full_name?.trim()`).

    With `channel_id` the candidate set is scoped HERE, exactly the way
    `_readable_by` scopes it, and the search runs INSIDE that set. On a private
    channel and on a DM the LIMIT can then only cut somebody the resolver would
    have refused anyway. On a PUBLIC channel the set is the org and the LIMIT
    can still truncate it — but there the resolver's universe is the org too, so
    the client applies no restriction and nothing is silently withheld.

    THE WIRE SHAPE IS UNCHANGED; the VALUE of `full_name` is not. Scoped, it
    carries `audit_actors.display_name('u')` — byte-identical to the `display`
    the resolver matches on and to what the composer inserts after the `@`. Both
    sides now read that one expression instead of writing the ladder out twice,
    which is what `test_samvaad_directory` has always been pinning. It
    is not returned under a new key: both clients read `full_name`,
    `test_samvaad_mentions` bans `display_name` by name, and a fourth key would
    be a second source of truth for the one string that has to agree with the
    resolver. UNSCOPED it stays the bare column, because that call has callers
    today — the channel member picker and the DM picker, neither of which is
    resolving a mention — and this must change nothing for them.

    ACCESS IS THE TWO STEPS `pin_message` and `unpin_message` document, in that
    order: the org-scoped 404 first, then `_assert_channel_access`. The row is
    read here for its `type`, which the shape of the query below depends on, and
    the helper reads it again for the access rule rather than that rule being
    re-implemented off the row already in hand — one extra fetchrow on a
    debounced, cached picker read, against a fourth copy of "public, or a
    member".

    A `channel_id` that is not a uuid — INCLUDING an empty one — is a 404 rather
    than being ignored. `search_messages` below does ignore an unparseable
    `channel_id` and searches the whole org, and that is right there, because it
    can only widen a result set to rows the caller may already read. Here,
    ignoring it hands back the entire org for a private channel and re-opens the
    exact silence this parameter exists to close, so a caller that asked to be
    scoped and cannot be is refused instead.
    """
    pool = await get_pool()
    needle = f"%{(q or '').strip()}%"

    if channel_id is None:
        rows = await pool.fetch("""
            SELECT DISTINCT u.user_id, u.full_name, u.avatar AS avatar_url
            FROM staging.user_roles ur
            JOIN users u ON u.user_id = ur.user_id
            WHERE ur.org_id = $1::uuid
              AND ur.role_code IN ('org_owner','org_admin','org_member')
              AND ur.user_id <> $2
              AND ($3 = '%%' OR u.full_name ILIKE $3)
            ORDER BY u.full_name
            LIMIT $4
        """, org_id, user["user_id"], needle, limit)
        return [dict(r) for r in rows]

    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    await _assert_channel_access(pool, channel_id, org_id, user["user_id"])

    # The parameters are numbered as they are appended, and the org arm is the
    # one that may be absent — same discipline as `search_messages`: Postgres
    # derives a statement's parameter count from the highest `$n` present, so a
    # gap left by a dropped arm fails with "could not determine data type of
    # parameter $n" before a row is read.
    args: list = [channel_id, user["user_id"], needle]
    org_arm = ""
    if ch["type"] == "public":
        # `UNION`, not `UNION ALL`, and the same `role_code` list `_readable_by`
        # uses: a user holding two role rows in one org would otherwise be
        # offered twice, and a role list that drifts from the resolver's is a
        # picker that offers somebody the resolver will not match.
        args.append(org_id)
        org_arm = f"""
            UNION
            SELECT u.user_id,
                   {display_name('u')} AS full_name,
                   u.avatar AS avatar_url
              FROM staging.user_roles ur
              JOIN users u ON u.user_id = ur.user_id
             WHERE ur.org_id = ${len(args)}::uuid
               AND ur.role_code IN ('org_owner','org_admin','org_member')
        """
    args.append(limit)
    # THE SEARCH AND THE LIMIT ARE OUTSIDE THE CANDIDATE SET, not inside it.
    # That ordering is the fix: the subquery carries no LIMIT of its own, so the
    # cut is taken from rows that have already been narrowed to this channel and
    # already matched, and it can no longer discard a member the caller was
    # about to name. The caller is excluded for the same reason the resolver
    # excludes the actor (`_resolve._add`) — your own name resolves to nobody.
    rows = await pool.fetch(f"""
        SELECT cand.user_id, cand.full_name, cand.avatar_url
          FROM (
            SELECT u.user_id,
                   {display_name('u')} AS full_name,
                   u.avatar AS avatar_url
              FROM staging.samvada_channel_members cm
              JOIN users u ON u.user_id = cm.user_id
             WHERE cm.channel_id = $1::uuid
            {org_arm}
          ) cand
         WHERE cand.user_id <> $2
           AND ($3 = '%%' OR cand.full_name ILIKE $3)
         ORDER BY cand.full_name
         LIMIT ${len(args)}
    """, *args)
    return [dict(r) for r in rows]


@router.get("/channels")
async def list_channels(
    archived: bool = False,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """`archived=true` returns the archived channels INSTEAD of the live ones.

    `is_archived` has been a column since 058 and this query hard-filtered
    `is_archived = FALSE`, so an archived channel left the list and became
    unreachable — no history, no search, no unarchive. `MESSAGING-ATTENDANCE-SPEC.md:22`
    asks for the opposite: "archived channels must be visually distinct", which
    presumes they are still listed. `ScreensSanvaad.jsx:198` renders them as
    their own `Archived · संग्रहित` section and `:260` keeps their history
    readable behind a banner.

    A separate call rather than a merged list: the archived set is cold, it is
    only ever wanted behind an explicit "All" toggle, and paying for it on every
    poll of the live rail would be waste.

    ── `mention_count` and `muted`, and why `unread_count` changed

    The rail now renders three things per row rather than one, and all three
    have to agree with what `GET /live` says four seconds later or the badge
    visibly flickers between two numbers. So the counting rules here and there
    are written to the same shape:

      · `unread_count` EXCLUDES the caller's own messages. It did not, so your
        own message counted as unread against you until the next poll happened
        to reset it — a badge that appeared when you pressed send.
      · `unread_count` is 0 for a public channel you have never joined. It used
        to COALESCE a missing `last_read_at` to 1970 and count the entire
        history, so every unjoined public channel in the org shouted a
        four-figure number at a user who had never opened it.
      · `muted` hides the plain unread count in the rail but never the mention
        badge — muting means "do not interrupt me", not "hide that somebody
        addressed me by name".

    The membership row moved from an EXISTS in the WHERE to a LEFT JOIN because
    all three of those answers need it: `(channel_id, user_id)` is unique on
    that table (`add_member` relies on it for `ON CONFLICT`), so the join
    multiplies nothing.
    """
    pool = await get_pool()
    # `0 AS mention_count` before 093 lands — see `_parity_ready`. The column has
    # to be present in the response either way; a row missing a key the client
    # spreads into a badge renders `undefined`, not zero.
    mention_count = (
        """(SELECT COUNT(*) FROM staging.samvada_mentions mn
             WHERE mn.channel_id = c.id AND mn.mentioned_user_id = $2
               AND mn.read_at IS NULL)"""
        if await _parity_ready(pool) else "0"
    )
    rows = await pool.fetch(f"""
        SELECT c.*, (
            SELECT COUNT(*) FROM staging.samvada_channel_members cm2 WHERE cm2.channel_id = c.id
        ) AS member_count,
        cm_me.last_read_at AS my_last_read,
        COALESCE(cm_me.muted, FALSE) AS muted,
        {mention_count} AS mention_count,
        CASE WHEN cm_me.user_id IS NULL THEN 0 ELSE (
            SELECT COUNT(*) FROM staging.samvada_messages m
            WHERE m.channel_id = c.id AND m.is_deleted = FALSE
              AND m.parent_message_id IS NULL
              AND m.sender_id <> $2
              -- FROM WHEN THEY JOINED, not from the beginning of time.
              --
              -- This was `COALESCE(last_read_at, '-infinity')`, so a member who
              -- had never opened a channel was told its ENTIRE HISTORY was
              -- unread. Live: 22 of 170 memberships carry no read cursor —
              -- `last_read_at` only moves when the client calls POST /read — and
              -- every one of them saw the channel's whole backlog as a badge the
              -- moment they were added.
              --
              -- A message posted before you were in the room is not a message
              -- you have failed to read. GREATEST of the two is the honest
              -- floor: the read cursor when there is one, the join otherwise,
              -- and the later of them when both exist. All 22 carry a real
              -- `joined_at` (no NULLs, no '-infinity' sentinels), so this is
              -- answerable for every one of them.
              --
              -- Same family as the approvals badge that said 3 over an empty
              -- page: a count computed by a different rule from the thing it
              -- claims to count.
              AND m.created_at > GREATEST(
                      COALESCE(cm_me.last_read_at, '-infinity'::timestamptz),
                      COALESCE(cm_me.joined_at,    '-infinity'::timestamptz))
        ) END AS unread_count
        FROM staging.samvada_channels c
        LEFT JOIN staging.samvada_channel_members cm_me
               ON cm_me.channel_id = c.id AND cm_me.user_id = $2
        WHERE c.org_id = $1::uuid AND c.is_archived = $3
          AND (c.type = 'public' OR cm_me.user_id IS NOT NULL)
        ORDER BY c.updated_at DESC
    """, org_id, user["user_id"], archived)
    # `_channel_row`, not `dict`: `c.*` carries `color` only once migration 100
    # has been applied, and a rail row missing the key renders `undefined`.
    return [_channel_row(r) for r in rows]


@router.post("/channels", status_code=201)
async def create_channel(
    body: ChannelCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The colour is ASSIGNED HERE and never asked for — see C2 and C4.

    The three statements are in one transaction and their ORDER is the whole
    correctness argument for the rotation:

      1. take the org's tone lock, so no concurrent create can read the same
         in-use set;
      2. read what is in use and pick the least-used tone;
      3. INSERT, which is what makes the pick true.

    Any other order reintroduces the race. The lock is released at COMMIT, two
    statements later.

    When migration 100 is outstanding the column is not named at all and the
    channel is born colourless — creation must not fail because a hand-applied
    migration has not landed yet, and the rail renders an unset tone in the
    neutral default. Re-running 100's backfill colours those rows in.
    """
    if body.type not in ("public", "private"):
        raise HTTPException(400, "Use /dm endpoint for DM channels")
    pool = await get_pool()
    # "Editor adds sending and channel creation" — ScreensSanvaad.jsx:291.
    await _require_editor(pool, user["user_id"], org_id)
    colour_ready = await _colour_ready(pool)
    async with pool.acquire() as conn:
        async with conn.transaction():
            # TWO WHOLE STATEMENTS, NOT ONE ASSEMBLED FROM FRAGMENTS, and the
            # four duplicated lines are the price of a rule this module already
            # enforces on itself. `test_samvaad_mentions.
            # test_every_inserted_column_exists_on_the_table_it_is_inserted_into`
            # parses every INSERT in this file and checks each column name
            # against the real schema — the generalisation of a live bug where an
            # INSERT named a column the table did not have and raised
            # UndefinedColumnError before a row was written. The first draft of
            # this handler built the column list with an f-string, the way
            # `list_channels` builds its `mention_count` arm, and that check
            # caught it immediately: a column list assembled at runtime is a
            # column list nothing can verify, and it read as
            # `created_by{extra_col}`. A SELECT list may be built; a column list
            # may not.
            if colour_ready:
                await conn.execute(_TONE_LOCK_SQL, org_id)
                tone = pick_channel_tone(await _channel_tones_in_use(conn, org_id))
                row = await conn.fetchrow("""
                    INSERT INTO staging.samvada_channels
                                (org_id, name, description, type, created_by, color)
                    VALUES ($1::uuid, $2, $3, $4, $5, $6)
                    RETURNING *
                """, org_id, body.name.strip(), body.description.strip(),
                     body.type, user["user_id"], tone)
            else:
                # Migration 100 is outstanding: the column cannot be named at all.
                row = await conn.fetchrow("""
                    INSERT INTO staging.samvada_channels
                                (org_id, name, description, type, created_by)
                    VALUES ($1::uuid, $2, $3, $4, $5)
                    RETURNING *
                """, org_id, body.name.strip(), body.description.strip(),
                     body.type, user["user_id"])
            # `last_read_at = NOW()`, and the same on every other membership
            # INSERT in this file. NULL reads as `COALESCE(last_read_at,
            # '-infinity')` in both unread counters, and the only thing holding
            # those at zero is `CASE WHEN cm_me.user_id IS NULL THEN 0` — which
            # an INSERT walks straight past. A member row born NULL therefore
            # means the rail shows the channel's ENTIRE history as unread, and
            # `/live` re-counts all of it fifteen times a minute for that user
            # until they open it. Joining a room is not the same as having
            # missed everything said in it before you arrived.
            await conn.execute("""
                INSERT INTO staging.samvada_channel_members (channel_id, user_id, role, last_read_at)
                VALUES ($1, $2, 'admin', NOW())
            """, row["id"], user["user_id"])
    return _channel_row(row)


@router.patch("/channels/{channel_id}")
async def update_channel(
    channel_id: str,
    body: ChannelUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """NOT refused on an archived channel, and that one is not a judgement call:
    `is_archived` is a field on this body and this is the only route that writes
    it, so refusing here would make archiving irreversible. A room nobody can
    re-open is not an archive, it is a deletion with the history left visible.

    ── `color` is the one field here that can be refused, and it is refused twice

    The vocabulary is checked BEFORE the SET list is built, because an unknown
    tone is not a value the database will save badly — `samvada_channels_color_ck`
    refuses it outright, so without this the caller gets a 500 carrying a
    constraint name. And if the CHECK were ever dropped, the value would land and
    render as `var(--m-whatever)`, which resolves to nothing: an invisible
    channel that still occupies a row in the rail, with no error anywhere.
    400, not 404, because this is a BODY field — the rule `_valid_uuid` states.

    The 503 is the other refusal and it is the interesting one. When migration
    100 is outstanding this handler CANNOT name the column, and it has three
    choices: 500 on UndefinedColumn, silently drop the field, or say so. Dropping
    it is the worst of the three — the caller pressed a swatch, got a 200 and a
    row back, and the colour did not change, which reads as a product that loses
    edits. `_parity_ready` already draws this line: reads degrade quietly, but
    "a click that fails should fail loudly". So the click fails, loudly, naming
    the migration that fixes it.
    """
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    ch = await pool.fetchrow(
        "SELECT * FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    await _require_editor(pool, user["user_id"], org_id)

    mem = await pool.fetchrow(
        "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    if not mem or mem["role"] != "admin":
        raise HTTPException(403, "Only channel admins can edit")

    # After the 404 and the two 403s, so a caller who may not touch this channel
    # cannot learn anything from the shape of the refusal — the ordering
    # `pin_message` and `unpin_message` document.
    fields = ["name", "description", "is_archived"]
    if body.color is not None:
        if body.color not in CHANNEL_TONES:
            raise HTTPException(
                400,
                f"Unknown channel colour '{body.color}'. A channel colour is a "
                f"module tone key, never a hex: {', '.join(CHANNEL_TONES)}.",
            )
        if not await _colour_ready(pool):
            raise HTTPException(
                503,
                "Channel colours are not available on this database yet: "
                "migration 100_channel_colour.sql has not been applied. Nothing "
                "was changed.",
            )
        fields.append("color")

    sets, vals, idx = [], [], 1
    for field in fields:
        v = getattr(body, field, None)
        if v is not None:
            sets.append(f"{field}=${idx}")
            vals.append(v)
            idx += 1
    if not sets:
        return _channel_row(ch)

    sets.append(f"updated_at=NOW()")
    vals.extend([channel_id, org_id])
    row = await pool.fetchrow(
        f"UPDATE staging.samvada_channels SET {', '.join(sets)} "
        f"WHERE id=${idx}::uuid AND org_id=${idx+1}::uuid RETURNING *",
        *vals,
    )
    return _channel_row(row)


@router.post("/dm")
async def find_or_create_dm(
    target_user_id: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    await _require_editor(pool, user["user_id"], org_id)
    await _assert_same_org(pool, target_user_id, org_id)
    existing = await pool.fetchrow("""
        SELECT c.* FROM staging.samvada_channels c
        WHERE c.org_id = $1::uuid AND c.type = 'dm'
          AND EXISTS (SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=c.id AND user_id=$2)
          AND EXISTS (SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=c.id AND user_id=$3)
          AND (SELECT COUNT(*) FROM staging.samvada_channel_members WHERE channel_id=c.id) = 2
    """, org_id, user["user_id"], target_user_id)
    if existing:
        return _channel_row(existing)

    async with pool.acquire() as conn:
        async with conn.transaction():
            # NO COLOUR, and `color` is deliberately absent from this column list
            # rather than passed as NULL — see C3. A DM renders as the other
            # person, so there is no `#glyph` tile to tone; assigning one would
            # spend the eight-tone rotation on rows nobody can see it on, and an
            # org with nine DMs would have every NAMED channel colliding while
            # eight tones sat invisible in private conversations. `_channel_row`
            # supplies the key as null on the way out.
            ch = await conn.fetchrow("""
                INSERT INTO staging.samvada_channels (org_id, name, type, created_by)
                VALUES ($1::uuid, '', 'dm', $2) RETURNING *
            """, org_id, user["user_id"])
            for uid in (user["user_id"], target_user_id):
                await conn.execute("""
                    INSERT INTO staging.samvada_channel_members (channel_id, user_id, role, last_read_at)
                    VALUES ($1, $2, 'member', NOW())
                """, ch["id"], uid)
    return _channel_row(ch)


# ── Channel Members ──────────────────────────────────────────

@router.get("/channels/{channel_id}/members")
async def list_members(
    channel_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    # Was `SELECT 1 ... WHERE org_id = $2` only, which is a check that the
    # channel is in the caller's org and NOT that the caller may see it. Any org
    # member could therefore enumerate the members of any private channel — and
    # of any DM, which is a two-person list and so tells them who is talking to
    # whom. `_assert_channel_access` is the rule the message endpoints already
    # use; this is the third caller it was written for.
    await _assert_channel_access(pool, channel_id, org_id, user["user_id"])
    rows = await pool.fetch("""
        SELECT cm.*, u.full_name, u.email, u.avatar AS avatar_url
        FROM staging.samvada_channel_members cm
        JOIN users u ON u.user_id = cm.user_id
        WHERE cm.channel_id = $1::uuid
    """, channel_id)
    return [dict(r) for r in rows]


@router.post("/channels/{channel_id}/members", status_code=201)
async def add_member(
    channel_id: str,
    user_id: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """ALLOWED ON AN ARCHIVED CHANNEL. This is the judgement call nobody had
    recorded, and it is recorded here rather than in a spec because the next
    reader will otherwise re-litigate it against the five refusals either side.

    The rule those refusals follow is that an archive is closed to NEW CONTENT —
    `send_message`, `edit_message`, `delete_message`, `add_reaction` and
    `pin_message` all put something in front of a reader that the channel did
    not say before, and the banner promises "nobody can post, including admins".
    Membership is not content. Adding somebody changes not one line of what the
    channel says; it changes WHO MAY READ THE LINES, which is the other side of
    the same banner's first clause, "History stays searchable". Searchable by
    whom is a question archiving does not answer, so it is not one this route
    may be refused for answering.

    Two concrete things settle it:

      · An archived PRIVATE channel is otherwise unreachable forever. The only
        way to show #q1-audit to the auditor who arrives after it closed would
        be unarchive → add → re-archive, which is three calls this router
        already permits and which re-opens posting and puts the room back in
        every member's live rail for the length of the detour. A refusal that
        is routed around by a strictly more dangerous sequence is not a
        refusal, it is a detour with worse steps.
      · `last_read_at = NOW()` is exactly right here rather than merely
        harmless: an archived channel has nothing new to have missed, so the
        person added starts at zero unread and stays there.

    `remove_member` is open for the same reason plus one of its own; see there.
    """
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch["type"] == "dm":
        raise HTTPException(400, "Cannot add members to DM channels")
    await _require_editor(pool, user["user_id"], org_id)

    mem = await pool.fetchrow(
        "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    if not mem:
        raise HTTPException(403, "Only channel members can add others")

    await _assert_same_org(pool, user_id, org_id)
    # `last_read_at = NOW()` — see the note on create_channel. This is the site
    # where it costs most: adding somebody to a five-year-old #general with
    # 5,000 messages used to hand them a four-figure badge for a room they have
    # never opened, and make every /live poll count the whole history.
    #
    # `DO UPDATE SET joined_at = NOW()`, not `DO NOTHING`, and the WHERE is what
    # keeps it from being a behaviour change. Being added by somebody is a real
    # join, so it has to clear the "mute created this row" sentinel described in
    # the module docstring — otherwise the person's next unmute deletes a
    # membership an admin deliberately granted, silently, and they drop out of
    # the channel and out of `@channel` with nothing on screen saying so.
    #
    # `WHERE cm.joined_at = '-infinity'` means a row that is already a real join
    # is still touched by NOTHING: the UPDATE finds no row to apply, so a
    # genuine member keeps their original `joined_at`, their `role` and — the
    # one that matters — their `last_read_at`, exactly as `DO NOTHING` did.
    # Re-adding an existing member must not mark their channel read.
    await pool.execute("""
        INSERT INTO staging.samvada_channel_members AS cm (channel_id, user_id, last_read_at)
        VALUES ($1::uuid, $2, NOW())
        ON CONFLICT (channel_id, user_id) DO UPDATE SET joined_at = NOW()
         WHERE cm.joined_at = '-infinity'::timestamptz
    """, channel_id, user_id)
    return {"ok": True}


@router.delete("/channels/{channel_id}/members/{target_user_id}")
async def remove_member(
    channel_id: str,
    target_user_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """ALLOWED ON AN ARCHIVED CHANNEL, for `add_member`'s reason and one more
    that is decisive on its own.

    `target_user_id == user["user_id"]` is the LEAVE path — it is the only way
    anybody gets out of a channel, and it is the branch that skips the admin
    check precisely because leaving is your own business. Refusing it on an
    archived channel would mean that archiving a room locks everybody in it
    permanently: a private channel they can no longer post in, no longer need,
    and can never remove from their rail. That is the trap `remove_reaction`
    already refuses to build, in a room rather than under a message, and
    archiving is not an act anybody performs in order to spring it.

    Splitting the two — leave allowed, admin-removes-other refused — was
    considered and rejected. It would make one route answer two different
    questions about the same channel state, and the admin half is the one an
    org actually needs when somebody leaves the company: revoking a departed
    employee's access to an archived private channel's history is the plainest
    administrative tidy-up in this module, and nothing in the archive's promise
    is about keeping a reader who should no longer be one.

    Nothing is removed from the record either way. The messages, their authors
    and their order are untouched; what goes is one row saying this person may
    open the room.
    """
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    ch = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")

    if target_user_id != user["user_id"]:
        mem = await pool.fetchrow(
            "SELECT role FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
            channel_id, user["user_id"],
        )
        if not mem or mem["role"] != "admin":
            raise HTTPException(403, "Only channel admins can remove other members")

    await pool.execute("""
        DELETE FROM staging.samvada_channel_members
        WHERE channel_id=$1::uuid AND user_id=$2
    """, channel_id, target_user_id)
    return {"ok": True}


# ── Messages ─────────────────────────────────────────────────

@router.get("/channels/{channel_id}/messages")
async def list_messages(
    channel_id: str,
    before: Optional[str] = None,
    limit: int = Query(50, le=100),
    include_reply_counts: int = Query(0, ge=0, le=1),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    # An unusable cursor is answered exactly as an unknown one is — see the
    # scoped subquery below, which returns an empty page for a message id that
    # is not in this channel. Dropping it and re-serving the newest page instead
    # would hand the client rows it already has, which it appends and then asks
    # again from the same place: a scroll that never reaches the end.
    if before and not _valid_uuid(before):
        return []
    # Verify membership
    mem = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    ch = await pool.fetchrow(
        "SELECT type FROM staging.samvada_channels WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not mem and ch["type"] != "public":
        raise HTTPException(403, "Not a member of this channel")

    # `seen_by` is the read receipt `ScreensSanvaad.jsx` renders as the `.seen`
    # row ("Seen by Aanya, Rohan +1") and that no endpoint returned. It is
    # derived entirely from columns that already exist — `mark_read` below
    # stamps `samvada_channel_members.last_read_at`, so a member has seen a
    # message iff they have opened the channel since it was posted. No schema
    # change, no migration, and it costs one correlated sub-select on a query
    # that already runs two.
    #
    # The sender is excluded because "seen by yourself" is not a receipt, and
    # the list is capped at four names: the client renders two and a "+n", and
    # a 300-member channel would otherwise ship 300 names per message per poll.
    _SEEN = """
                   (SELECT COALESCE(json_agg(x.full_name), '[]') FROM (
                        SELECT u2.full_name
                        FROM staging.samvada_channel_members cm
                        JOIN users u2 ON u2.user_id = cm.user_id
                        WHERE cm.channel_id = m.channel_id
                          AND cm.user_id <> m.sender_id
                          AND cm.last_read_at IS NOT NULL
                          AND cm.last_read_at >= m.created_at
                        ORDER BY cm.last_read_at LIMIT 4
                   ) x) AS seen_by,
                   (SELECT COUNT(*) FROM staging.samvada_channel_members cm2
                    WHERE cm2.channel_id = m.channel_id
                      AND cm2.user_id <> m.sender_id
                      AND cm2.last_read_at IS NOT NULL
                      AND cm2.last_read_at >= m.created_at) AS seen_count"""

    # `t.channel_id = m.channel_id` and `t.org_id = m.org_id` on both thread
    # sub-selects. `parent_message_id` alone counted EVERY row in the database
    # pointing at this message, and until `send_message` started validating the
    # parent that included rows written from another channel — or another tenant
    # — by anybody holding the id. The visible effect was a "1 reply" link
    # appearing under a message in a room the replier could not post in, whose
    # text `get_thread` then served to everyone who clicked it. The write path is
    # closed now; this is what keeps a row already in the table from surfacing,
    # and what stops the two ends drifting apart again if one is ever relaxed.
    _COLS = """m.*, u.full_name AS sender_name, u.avatar AS sender_avatar,
                   (SELECT COUNT(*) FROM staging.samvada_messages t
                    WHERE t.parent_message_id = m.id AND t.is_deleted = FALSE
                      AND t.channel_id = m.channel_id AND t.org_id = m.org_id) AS thread_count,
                   (SELECT MAX(t2.created_at) FROM staging.samvada_messages t2
                    WHERE t2.parent_message_id = m.id AND t2.is_deleted = FALSE
                      AND t2.channel_id = m.channel_id AND t2.org_id = m.org_id) AS last_reply_at,
                   (SELECT COALESCE(json_agg(json_build_object('emoji', r.emoji, 'user_id', r.user_id)), '[]')
                    FROM staging.samvada_message_reactions r WHERE r.message_id = m.id) AS reactions,""" + _SEEN

    # ── `include_reply_counts`, and the one thing it may NOT gate ─────────────
    #
    # The brief for this parameter called it the gate on the whole reply-count
    # feature. It cannot be, and the reason is above this line rather than in a
    # spec: `thread_count` and `last_reply_at` are ALREADY returned on every row
    # of every call, with no parameter, and the shipped client already reads
    # both — `sanvaad/Message.jsx:346` (`Number(msg.thread_count) || 0`, which
    # decides whether the thread link renders at all) and `:610`
    # (`msg.last_reply_at &&`, the "Last reply 20m ago" stamp). Neither of the
    # two call sites in `useChannelMessages.js` (`:127` unpaged, `:376` with
    # `before`/`limit`) passes any flag, and there is nowhere else in the
    # frontend that lists messages.
    #
    # So gating those two behind a parameter defaulting FALSE would not be a
    # gate, it would be a REGRESSION: the deployed Sanvaad would stop showing
    # thread links the moment this shipped, and the "byte-identical response for
    # every existing caller" the default exists to guarantee is exactly what
    # would be lost. The default has to keep returning what today's default
    # returns, which leaves the flag one honest job — gating the key that is
    # genuinely new.
    #
    # That key is `thread_faces`: the three replier avatars the prototype draws
    # beside the count (`Msg2Chat.jsx:135-137` maps `m.thread.faces`). Nothing in
    # this router returns replier identity, and an added key IS a changed
    # response for a caller that spreads the row, so this one is opt-in.
    #
    # Scoping is copied from the two sub-selects above deliberately and not
    # abbreviated: `is_deleted = FALSE` so a retracted reply stops contributing a
    # face as it already stops contributing to the count, and
    # `channel_id`/`org_id` for the reason recorded above — a reply row written
    # from another channel or another tenant before the write path was closed
    # must not surface, and the three predicates have to move together or the
    # count and the faces under it will disagree.
    #
    # Two layers, not one: `DISTINCT ON (sender_id)` must order by `sender_id`
    # first, so the LIMIT cannot live inside it — it would return the three
    # lowest sender ids rather than the three earliest repliers. The inner query
    # picks each distinct replier's FIRST reply; the outer orders those by time
    # and takes three. Capped for the same reason `seen_by` is capped at four:
    # the client draws three, and a 300-reply thread would otherwise ship 300
    # names per message per poll.
    #
    # `COALESCE(..., '[]')` for the reason `reactions` and `seen_by` carry it: a
    # root message with no replies must yield an empty list, not a JSON null,
    # because the client spreads it.
    #
    # The `ORDER BY` sits INSIDE `json_agg` rather than being left to the inner
    # `LIMIT`. In practice the aggregate consumes the subplan in order and the
    # two agree; only the aggregate's own ORDER BY is a guarantee, and the
    # difference is whether the leftmost avatar is reliably the first person who
    # answered or merely usually is.
    if include_reply_counts:
        _COLS += """,
                   (SELECT COALESCE(json_agg(json_build_object(
                                'user_id', f.user_id,
                                'full_name', f.full_name,
                                'avatar', f.avatar)
                            ORDER BY f.first_reply_at), '[]')
                    FROM (
                        SELECT d.user_id, d.full_name, d.avatar, d.first_reply_at
                        FROM (
                            SELECT DISTINCT ON (t3.sender_id)
                                   t3.sender_id AS user_id,
                                   u3.full_name AS full_name,
                                   u3.avatar    AS avatar,
                                   t3.created_at AS first_reply_at
                            FROM staging.samvada_messages t3
                            JOIN users u3 ON u3.user_id = t3.sender_id
                            WHERE t3.parent_message_id = m.id AND t3.is_deleted = FALSE
                              AND t3.channel_id = m.channel_id AND t3.org_id = m.org_id
                            ORDER BY t3.sender_id, t3.created_at ASC
                        ) d
                        ORDER BY d.first_reply_at ASC
                        LIMIT 3
                    ) f) AS thread_faces"""

    if before:
        # `cur.channel_id = $1` IS THE FIX, and it is the last unscoped subquery
        # in this file. Without it the cursor resolved against every message row
        # in the database: a message id belonging to ANOTHER TENANT resolved to
        # a real `created_at` and this endpoint returned an ordinary page of
        # this channel's history, while a made-up id resolved to NULL, made the
        # comparison NULL, and returned nothing. That difference is the leak —
        # not the rows, which were always this caller's own, but the ANSWER: it
        # tells the holder of an id whether that id names a real message
        # somewhere in the product. Low severity, because the ids are uuids and
        # unguessable, and it is a leak all the same. Scoped, a foreign id and a
        # fabricated one are the same thing here: no such message in this
        # channel, so no page.
        #
        # The channel is the whole scope needed, and an org predicate here would
        # only restate it. `$1` has already been fetched `WHERE id=$1 AND
        # org_id=$2` above and 404'd if that found nothing, so by the time this
        # query runs the channel is this org's — and a message in it is this
        # org's message by construction, since no path in this router can write
        # one whose `org_id` differs from its channel's.
        rows = await pool.fetch(f"""
            SELECT {_COLS}
            FROM staging.samvada_messages m
            JOIN users u ON u.user_id = m.sender_id
            WHERE m.channel_id = $1::uuid AND m.is_deleted = FALSE
              AND m.parent_message_id IS NULL
              AND m.created_at < (SELECT cur.created_at
                                    FROM staging.samvada_messages cur
                                   WHERE cur.id = $3::uuid
                                     AND cur.channel_id = $1::uuid)
            ORDER BY m.created_at DESC LIMIT $2
        """, channel_id, limit, before)
    else:
        rows = await pool.fetch(f"""
            SELECT {_COLS}
            FROM staging.samvada_messages m
            JOIN users u ON u.user_id = m.sender_id
            WHERE m.channel_id = $1::uuid AND m.is_deleted = FALSE
              AND m.parent_message_id IS NULL
            ORDER BY m.created_at DESC LIMIT $2
        """, channel_id, limit)
    return [dict(r) for r in rows]


@router.post("/channels/{channel_id}/messages", status_code=201)
async def send_message(
    channel_id: str,
    body: MessageCreate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")

    # `samvada_messages.type` carries CHECK (type IN ('text','image','file','system'))
    # and `MessageCreate.type` is a bare `str` with no validator, so any other
    # value reached the INSERT and came back as a CheckViolationError — a 500 for
    # what is plainly a bad request. `image` and `file` are excluded from the
    # accepted set on top of that, because attachments are out of scope for this
    # work and a message row claiming to be a file with nothing behind it is a
    # row the renderer cannot draw.
    if body.type not in ("text", "system"):
        raise HTTPException(400, "Unsupported message type")

    # An archived channel is readable and closed. `ScreensSanvaad.jsx:260` and
    # `:290` are unambiguous — "History stays searchable; nobody can post" and
    # "nobody can post, including admins" — and now that `list_channels` can
    # return archived rows a client can reach one, so the refusal has to be
    # here rather than implied by the row being absent.
    chan = await pool.fetchrow(
        "SELECT type, is_archived FROM staging.samvada_channels "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        channel_id, org_id,
    )
    if not chan:
        raise HTTPException(404, "Channel not found")
    if chan["is_archived"]:
        raise HTTPException(403, _ARCHIVED_REFUSAL)
    await _require_editor(pool, user["user_id"], org_id)

    mem = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_channel_members WHERE channel_id=$1::uuid AND user_id=$2",
        channel_id, user["user_id"],
    )
    if not mem and chan["type"] != "public":
        raise HTTPException(403, "Not a member of this channel")

    # `parent_message_id` came off the wire and went straight into the INSERT.
    # The only thing behind it was the column's own foreign key, which points at
    # `samvada_messages(id)` with no org and no channel in it — so ANY message id
    # in the database was an accepted parent, and none of it needed guessing. An
    # archived channel is readable by design, so `GET /channels/{archived}/messages`
    # hands out its ids; posting into a live channel with one of those as the
    # parent hung a reply off a message in a room whose own send path refuses
    # everybody, and `get_thread` then served that text to the archived channel's
    # readers. The same shape with a private channel's id, or another tenant's,
    # was a cross-org WRITE.
    #
    # THE POSITION OF THIS BLOCK IS PART OF THE FIX. It sits after the membership
    # refusal above and before the auto-join below, and both halves matter:
    #
    #   · Validating BEFORE the membership check would turn the refusal into a
    #     membership oracle. Somebody outside a private channel could tell a real
    #     message id of that channel from a made-up one by which 400 came back,
    #     which is the same leak `list_members` was fixed for.
    #   · Validating AFTER the auto-join would join the caller to a public
    #     channel on a request that then 400s — a membership row written by a
    #     failed send.
    #
    # A REPLY TO A REPLY IS REFUSED. Slack has no nested threads and neither does
    # this product, and the code says so in three places rather than one: the log
    # renders only `parent_message_id IS NULL`, so a reply is never a row you can
    # aim at; `MessageLog` is the only component wired with `onReply`, and
    # `ThreadPanel` deliberately passes neither `onReply` nor `onOpenThread` to
    # the replies it renders; and `get_thread` returns the DIRECT children of the
    # id it is given, so a grandchild has no view that could ever display it. A
    # nested reply is therefore already write-only data. The check is on the write
    # path only — any row that predates it keeps its place and keeps rendering
    # wherever it rendered before.
    # `or None` so an empty string reads as "no parent" rather than as a reply
    # target that then 400s. The old code fed `""` to `$6::uuid` and asyncpg
    # answered with a `DataError`, i.e. a 500.
    raw_parent = body.parent_message_id or None
    parent = None
    if raw_parent is not None:
        no_such_parent = "That reply target is not a message in this channel."
        if not _valid_uuid(raw_parent):
            raise HTTPException(400, no_such_parent)
        prow = await pool.fetchrow("""
            SELECT parent_message_id FROM staging.samvada_messages
            WHERE id=$1::uuid AND channel_id=$2::uuid AND org_id=$3::uuid
              AND is_deleted = FALSE
        """, raw_parent, channel_id, org_id)
        if prow is None:
            raise HTTPException(400, no_such_parent)
        if prow["parent_message_id"] is not None:
            raise HTTPException(
                400,
                "Replies cannot be nested. Reply to the message the thread hangs off.",
            )
        parent = raw_parent

    if not mem:
        # `last_read_at = NOW()` — see the note on create_channel. Posting once
        # in a public channel you had never joined used to show you its whole
        # history as unread until the `/read` throttle let a mark through.
        await pool.execute("""
            INSERT INTO staging.samvada_channel_members (channel_id, user_id, last_read_at)
            VALUES ($1::uuid, $2, NOW())
        """, channel_id, user["user_id"])

    content = body.content.strip()
    row = await pool.fetchrow("""
        INSERT INTO staging.samvada_messages
            (org_id, channel_id, sender_id, content, type, parent_message_id)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
        RETURNING *
    """, org_id, channel_id, user["user_id"], content,
        body.type, parent)

    await pool.execute(
        "UPDATE staging.samvada_channels SET updated_at=NOW() WHERE id=$1::uuid",
        channel_id,
    )

    # D2 — mentions are resolved HERE, from the text, not from a client-supplied
    # id list. `MentionTextarea`-style insertion writes the member's full display
    # name into `content` and `splitMentions` parses it back out on render; a
    # second, parallel list of ids in the request body is a second source of
    # truth, and when the two disagree you get a bolded `@Keval` followed by a
    # plain ` Shah` — the exact bug `renderMentions.test.jsx` exists to catch.
    # Resolving from `content` also means a client cannot fabricate a mention.
    #
    # In-request, NOT `_bg`: a mention that silently notified nobody because a
    # background task died is indistinguishable from a mention that was never
    # written. `fan_out_mentions` short-circuits on `"@" not in content`, and the
    # readiness answer in front of it is a cached boolean, so an ordinary message
    # pays one substring test and no query at all.
    #
    # `_fan_out_mentions_guarded`, not `fan_out_mentions` directly, and that is
    # not tidiness. THE MESSAGE ROW ABOVE IS ALREADY COMMITTED. Raising out of
    # the fan-out cannot un-send it; it can only answer 500 for a send that
    # succeeded, which makes the client bin its optimistic row and the user post
    # the same message twice. The guard skips the fan-out entirely before 093 is
    # applied and swallows anything else it can throw — the reasoning, and why
    # the service's own "must fail the send loudly" rule stops applying at this
    # line, is written out on the helper.
    #
    # `channel_id` is the PATH parameter, not `row["channel_id"]`. They are the
    # same value — the INSERT put it there — but reading it back off the returned
    # row would make this handler depend on the shape of `RETURNING *`, and the
    # security suite asserts control flow by feeding `fetchrow` a list of literal
    # dicts. A handler that needs one more key out of a mocked row is a handler
    # that breaks four tests which are not about mentions at all.
    mentioned = await _fan_out_mentions_guarded(
        pool,
        org_id=org_id,
        channel_id=channel_id,
        message_id=row["id"],
        actor_id=user["user_id"],
        content=content,
        is_edit=False,
    )

    # THE NOTIFICATION FOR THE MESSAGE ITSELF. Until this line existed, being
    # sent a message and not being sent a message produced byte-identical
    # results for everybody who was not named by hand: 1,177 messages in the
    # live database and not one notification row of any message-shaped type.
    #
    # AFTER THE MENTION FAN-OUT, AND FED ITS ANSWER. The order is the whole of
    # the anti-double-notify rule. `mentioned` is every user id the mention
    # resolver matched, and `fan_out_message_notification` drops every one of
    # them before it writes anything — so "@Bela Rao standup in five" is ONE
    # notification for Bela (the mention, which is the more specific and more
    # useful of the two), not a mention and a "new message" arriving together.
    # Running these two in the other order, or running this one without the set,
    # is exactly the trap: both writers would fire, both would be correct on
    # their own terms, and the recipient would get two rows for one message.
    #
    # ONLY ON SEND. `edit_message` does not call this, and must not: an edit is
    # not a new message, and re-notifying a room because somebody fixed a typo is
    # the failure the mention path's `is_edit` diff exists to avoid. `@channel`
    # smuggled into an edit is already refused a second time over by the archive
    # gate and by that diff.
    #
    # `body.type` rather than `row["type"]` for the same reason `channel_id` is
    # the path parameter and not `row["channel_id"]` — reading more keys off
    # `RETURNING *` makes this handler depend on the shape of a mocked row, and
    # the security suite feeds `fetchrow` literal dicts.
    #
    # Guarded, and the guard never raises. The message above is COMMITTED; a 500
    # raised from here would make the client bin its optimistic row and the user
    # send the same message twice. A missing notification must not become a
    # duplicated message.
    await _notify_message_guarded(
        pool,
        org_id=org_id,
        channel_id=channel_id,
        message_id=row["id"],
        actor_id=user["user_id"],
        content=content,
        message_type=body.type,
        parent_message_id=parent,
        mentioned=mentioned,
    )
    # The response shape is UNCHANGED — `RETURNING *`, no sender join, no
    # mention data. `useChannelMessages.send` stamps `sender_name`/`sender_avatar`
    # from the local `me` and lets the next poll bring the enriched row; adding
    # keys here would put a second, differently-shaped row into the same list.
    return dict(row)


@router.patch("/messages/{message_id}")
async def edit_message(
    message_id: str,
    body: MessageUpdate,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    msg = await pool.fetchrow(
        "SELECT channel_id, sender_id FROM staging.samvada_messages "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(403, "Can only edit your own messages")
    # An archived channel is closed to writes and an edit is a write. This
    # handler never asked, and the mention fan-out below made that expensive:
    # archive #q1-audit, PATCH your own old message in it to "@channel please
    # re-open this", and the edit lands, `@channel` resolves to every member, and
    # each of them gets a notification row and a push — paged by a room the
    # product told them nobody can post in. Without the fan-out it was still
    # wrong: it rewrites the visible text of an archived message, which is
    # exactly what "history stays searchable" was meant to guarantee against.
    #
    # `channel_id` is selected above for this call and nothing else; the fan-out
    # further down still reads it off `RETURNING *`.
    await _assert_not_archived(pool, msg["channel_id"], org_id)
    await _require_editor(pool, user["user_id"], org_id)

    content = body.content.strip()
    row = await pool.fetchrow("""
        UPDATE staging.samvada_messages
        SET content=$1, is_edited=TRUE, updated_at=NOW()
        WHERE id=$2::uuid RETURNING *
    """, content, message_id)

    # An edit CAN create a mention; it must never re-notify an existing one.
    # `is_edit=True` is what tells the fan-out to insert and notify only for
    # people who do not already have a row against this message. Names removed
    # from the edited text keep their rows deliberately: deleting them would
    # retract a notification the recipient has already received, and possibly
    # already read, so the badge would decrement for something that genuinely
    # happened. Leaving them is the lesser wrong and it makes the whole
    # operation idempotent under a retry.
    #
    # `row["channel_id"]` off `RETURNING *`, though the archive check above now
    # holds the same value: the UPDATE's own answer is the one that cannot be
    # stale, and it costs nothing extra.
    #
    # Guarded, exactly as on the send path and for a sharper version of the same
    # reason: the UPDATE above has already replaced the stored text. A 500 out of
    # the fan-out would tell the author their edit failed while the edit is what
    # everybody else can now read, and the retry — the same PATCH again — writes
    # the identical row and fails the identical way. There is no state a raised
    # exception could restore here, only a lie it could tell.
    await _fan_out_mentions_guarded(
        pool,
        org_id=org_id,
        channel_id=row["channel_id"],
        message_id=row["id"],
        actor_id=user["user_id"],
        content=content,
        is_edit=True,
    )
    return dict(row)


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    msg = await pool.fetchrow(
        "SELECT channel_id, sender_id FROM staging.samvada_messages "
        "WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["sender_id"] != user["user_id"]:
        raise HTTPException(403, "Can only delete your own messages")
    # REFUSED ON AN ARCHIVED CHANNEL, and this is the judgement call, because
    # deleting your own message is a taking-back — and this file already has a
    # written rule that a taking-back is allowed where the matching addition is
    # not (`remove_reaction` is not editor-gated while `add_reaction` is; unpin
    # is allowed on an archived channel while pin is not).
    #
    # The rule does not reach this far, because those two take back a decoration
    # and this takes back the record. `is_deleted = TRUE` removes the row from
    # `list_messages`, from `get_thread`, from `list_pins` and from `search` —
    # which is every way the product can show it. The sentence the banner puts in
    # front of the user is "History stays searchable", and a delete is the only
    # operation in this router that can make a line of that history stop
    # existing. A room whose contents can still be emptied one message at a time
    # is not archived, it is just quieter.
    await _assert_not_archived(pool, msg["channel_id"], org_id)
    await _require_editor(pool, user["user_id"], org_id)

    await pool.execute("""
        UPDATE staging.samvada_messages SET is_deleted=TRUE, updated_at=NOW()
        WHERE id=$1::uuid
    """, message_id)
    return {"ok": True}


# ── Threads ──────────────────────────────────────────────────

@router.get("/messages/{message_id}/thread")
async def get_thread(
    message_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    parent = await pool.fetchrow(
        "SELECT channel_id FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not parent:
        raise HTTPException(404, "Message not found")
    await _assert_channel_access(pool, parent["channel_id"], org_id, user["user_id"])
    # Scoped to the parent's OWN org and channel, not just to its id. The access
    # check above authorises one channel, and this query selected every row in
    # the database pointing at the parent — so a reply written from somewhere
    # else, by anybody who held the id, was served here as if it belonged. That
    # is the read half of the hole `send_message` now closes on the write side;
    # both halves ship, because the write gate stops new rows and this stops the
    # ones already in the table, and one without the other is half a fix.
    rows = await pool.fetch("""
        SELECT m.*, u.full_name AS sender_name, u.avatar AS sender_avatar
        FROM staging.samvada_messages m
        JOIN users u ON u.user_id = m.sender_id
        WHERE m.parent_message_id = $1::uuid AND m.is_deleted = FALSE
          AND m.org_id = $2::uuid AND m.channel_id = $3::uuid
        ORDER BY m.created_at ASC
    """, message_id, org_id, parent["channel_id"])
    return [dict(r) for r in rows]


# ── Reactions ────────────────────────────────────────────────

@router.post("/messages/{message_id}/reactions")
async def add_reaction(
    message_id: str,
    emoji: str = Query(...),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    msg = await pool.fetchrow(
        "SELECT channel_id FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    await _assert_channel_access(pool, msg["channel_id"], org_id, user["user_id"])
    # A reaction is new content in the channel, so an archived one refuses it,
    # matching `send_message` and `pin_message` word for word. It is the same
    # act as a pin by a smaller name: something appears under a message in a room
    # the banner says is closed, and everybody still reading the history sees it.
    #
    # Placed after `_assert_channel_access` and before `_require_editor`, which
    # is the order `pin_message` documents: the org-scoped 404 first, then may
    # you see the room, then may you write into it, then are you an editor.
    await _assert_not_archived(pool, msg["channel_id"], org_id)
    # A reaction is a write into the channel, so it is an editor act — the
    # reference disables the whole quick-reaction tray for a viewer
    # (`ScreensSanvaad.jsx:106,153`), not just the composer.
    #
    # Ordered AFTER the org-scoped 404 on purpose. Putting the level check first
    # would make `test_add_reaction_404_for_other_org_message` pass on a 403 that
    # fires before the org filter is ever consulted — the test would then hold
    # even if cross-tenant scoping were deleted. The refusal a viewer gets is the
    # same either way; what changes is whether the security test still proves
    # anything. Same ordering in edit, delete and send below.
    await _require_editor(pool, user["user_id"], org_id)
    await pool.execute("""
        INSERT INTO staging.samvada_message_reactions (message_id, user_id, emoji)
        VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING
    """, message_id, user["user_id"], emoji)
    return {"ok": True}


@router.delete("/messages/{message_id}/reactions/{emoji}")
async def remove_reaction(
    message_id: str,
    emoji: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # Deliberately NOT gated on editor, unlike `add_reaction`. This deletes only
    # the caller's own row; gating it would leave somebody demoted to viewer
    # permanently unable to withdraw a reaction they had already left. Taking
    # something back is not an act the viewer level exists to prevent.
    #
    # ALLOWED ON AN ARCHIVED CHANNEL, and that is the other judgement call in
    # this round. `add_reaction` is now refused there and `delete_message` is
    # too, so this is the one write into an archived room that still goes
    # through. Two reasons, and they are the same two `unpin_message` already
    # runs on:
    #
    #   · It removes NOTHING from the history. The message, its text, its author
    #     and its place in the channel are untouched; what goes is one row saying
    #     this caller once pressed an emoji. "History stays searchable" is a
    #     promise about the record, and this is not the record.
    #   · The alternative is a trap. Somebody who reacted the minute before an
    #     admin archived the channel would be stuck with that reaction under
    #     their name forever, with no door out — and archiving is not an act
    #     anybody performs to freeze other people's mistakes in place.
    #
    # It also costs nothing to leave open: this handler holds no channel row and
    # never has, so refusing here would mean a fresh lookup on the cheapest path
    # in the file to prevent a change that alters no message.
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    msg = await pool.fetchrow(
        "SELECT 1 FROM staging.samvada_messages WHERE id=$1::uuid AND org_id=$2::uuid",
        message_id, org_id,
    )
    if not msg:
        raise HTTPException(404, "Message not found")
    await pool.execute("""
        DELETE FROM staging.samvada_message_reactions
        WHERE message_id=$1::uuid AND user_id=$2 AND emoji=$3
    """, message_id, user["user_id"], emoji)
    return {"ok": True}


# ── Read state ───────────────────────────────────────────────

@router.post("/channels/{channel_id}/read")
async def mark_read(
    channel_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Opening a channel clears BOTH its unread count and its mention badge.

    The second statement is why the mention badge needs no new frontend call:
    `useChannelMessages` already fires this on channel open and on window focus,
    so the two counters are cleared by the same act that visibly clears them on
    screen. Splitting them into two endpoints would let one succeed and the
    other fail, and the user would be left staring at an `@2` on a channel they
    are currently reading.

    One transaction for the same reason. Both statements or neither.

    The access check this endpoint has never had is still absent, deliberately:
    both statements are scoped to the caller's OWN membership row and the
    caller's OWN mention rows, so the worst a foreign `channel_id` can do is
    update zero rows. Adding a gate here is a separate decision from this work
    and the identical hole on the write verb — a legacy `viewer` cannot mark
    anything read — is left exactly as it was rather than fixed in passing.
    """
    pool = await get_pool()
    # A shape refusal, not the access gate the paragraph above says is absent:
    # this only asks whether the path segment can be a channel id at all, and
    # both statements below stay scoped to the caller's own rows. A well-formed
    # id for somebody else's channel still updates nothing and still answers 200.
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    ready = await _parity_ready(pool)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("""
                UPDATE staging.samvada_channel_members SET last_read_at=NOW()
                WHERE channel_id=$1::uuid AND user_id=$2
            """, channel_id, user["user_id"])
            if ready:
                # `org_id` as well as the channel, so this matches every other
                # statement against this table. Without it, somebody who belongs
                # to two orgs and is acting in org A can clear their own unread
                # mentions on a channel id from org B. Own data only, so no
                # leak — but this was the one mention statement in the file that
                # was singly scoped, and "the exception nobody wrote down" is
                # how the scoped ones get copied from the wrong neighbour.
                await conn.execute("""
                    UPDATE staging.samvada_mentions
                       SET read_at = now()
                     WHERE channel_id = $1::uuid AND mentioned_user_id = $2
                       AND org_id = $3::uuid
                       AND read_at IS NULL
                """, channel_id, user["user_id"], org_id)
    return {"ok": True}


@router.get("/unread")
async def unread_counts(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    rows = await pool.fetch("""
        SELECT cm.channel_id,
               COUNT(m.id) AS unread
        FROM staging.samvada_channel_members cm
        JOIN staging.samvada_channels c ON c.id = cm.channel_id
        LEFT JOIN staging.samvada_messages m ON m.channel_id = cm.channel_id
          AND m.is_deleted = FALSE AND m.parent_message_id IS NULL
          AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)
          AND m.sender_id != $2
        WHERE c.org_id = $1::uuid AND cm.user_id = $2
        GROUP BY cm.channel_id
        HAVING COUNT(m.id) > 0
    """, org_id, user["user_id"])
    return {str(r["channel_id"]): r["unread"] for r in rows}


# ── The live poll ────────────────────────────────────────────

@router.get("/live")
async def live(
    channel_id: Optional[str] = None,
    typing: int = Query(0, ge=0, le=1),
    away: int = Query(0, ge=0, le=1),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """One GET carries everything that changes between keystrokes.

    D1 — THIS IS A GET, AND IT MUST STAY ONE. `server.global_write_rate_limit`
    allows 120 POST/PUT/PATCH/DELETE per client IP per wall-clock minute. A
    dedicated typing POST at a 3-second cadence is 20 writes a minute per user;
    four colleagues behind one office NAT would spend two-thirds of that whole
    office's write budget on animated dots, and the fifth person's invoice would
    429. On top of that, `middleware.subscription._is_write` treats any POST
    whose path does not end in one of `READ_SHAPED_POSTS` as a write, so a
    typing POST would 403 for a legacy `viewer` grant-holder before this
    function ever ran — a user who is allowed to read a channel would be unable
    to show that they are typing in it. A GET is exempt from both, which is why
    the typing ping and the presence heartbeat travel as query flags on a read
    rather than as their own endpoints. Do NOT split them back out, and do not
    widen `READ_SHAPED_POSTS` to make room — that list is pinned by an assertion
    in `test_module_write_level.py` because each entry is a hole in the rule
    that closed 210 routes.

    WHAT D1 COSTS, written down rather than left to be rediscovered. Being a GET
    puts these two writes outside the write rate limiter AND outside the module
    write gate, and outside the gate means outside `_require_editor` as well: a
    Sanvaad VIEWER — refused by name on every other write in this file — can
    hand-craft `GET /live?channel_id=…&typing=1` and appear in the typing line of
    a channel they can never post in. `_assert_channel_access` still applies, so
    it can only be a channel they are entitled to READ; the whole of the exposure
    is a name in the dots above a composer they do not have. Nothing in the
    shipped client can produce it: `usePresence` raises the flag only from
    `MentionInput`, which is inside `Composer`, which `ChatPane` renders only
    `if (canPost)` — a viewer gets `LockedComposer`, which has no keystrokes to
    report. So this is a hand-made request, and it writes one row into
    `samvada_typing` that ages out of the read window in eight seconds.
    Accepted, because the alternative is the 429 and the 403 above, which cost
    every user something real to spare one room a phantom typist. Stated here
    because a gap nobody wrote down is a gap somebody widens later, on the
    grounds that "the poll already writes without the gate".

    D4 — this is a POLL and it will stay one. Supabase's pooler runs in
    transaction mode on :6543, where `LISTEN`/`NOTIFY` does not work at all, and
    the service runs several gunicorn workers, so an in-process broadcast would
    reach the clients attached to one worker and silently miss the rest. There
    is no websocket to build here; there is a poll, and its job is to be cheap.

    200 ALWAYS. A channel being deleted, archived or left underneath a running
    poll must not turn the poll into a 404 — the client would surface an error
    banner for a race it has already recovered from. An unknown or foreign
    `channel_id` yields an empty `typing` list and nothing else changes.

    One pooled connection for the whole handler: six round trips on six separate
    checkouts is six chances to wait on the pool, every four seconds, per user.
    """
    pool = await get_pool()
    me = user["user_id"]
    ready = await _parity_ready(pool)

    async with pool.acquire() as conn:
        # 1 — presence heartbeat, on every single poll. The heartbeat IS the
        # poll; there is no separate "I am here" call for a client to forget to
        # make, and no way for the two to disagree about whether you are online.
        # (`ready` guards the table's existence, not the frequency — see
        # `_parity_ready`. The same is true of every `if ready` below.)
        if ready:
            await conn.execute("""
                INSERT INTO staging.samvada_presence (org_id, user_id, last_seen_at, status)
                VALUES ($1::uuid, $2, now(), $3)
                ON CONFLICT (org_id, user_id)
                DO UPDATE SET last_seen_at = now(), status = EXCLUDED.status
            """, org_id, me, "away" if away else "online")

        # 2 — typing, only for a channel this caller may actually read. Without
        # the access check a caller could plant their name in the typing list of
        # a private channel they are not in, and everybody in it would watch a
        # stranger appear to type.
        may_type = False
        if ready and _valid_uuid(channel_id):
            try:
                await _assert_channel_access(conn, channel_id, org_id, me)
                may_type = True
            except HTTPException:
                # Swallowed on purpose — see "200 ALWAYS" above.
                may_type = False

        if may_type:
            if typing:
                await conn.execute("""
                    INSERT INTO staging.samvada_typing (channel_id, user_id, updated_at)
                    VALUES ($1::uuid, $2, now())
                    ON CONFLICT (channel_id, user_id) DO UPDATE SET updated_at = now()
                """, channel_id, me)
            else:
                # The composer going quiet is what stops the dots, not a timeout
                # race. The 8-second read window below is the backstop for a tab
                # that was closed mid-word, not the primary mechanism.
                await conn.execute(
                    "DELETE FROM staging.samvada_typing "
                    "WHERE channel_id=$1::uuid AND user_id=$2",
                    channel_id, me,
                )

        # 3 — opportunistic sweep of the abandoned rows IN THIS CHANNEL, on the
        # polls that are actually looking at it. A tab closed mid-word leaves a
        # row nobody deletes, and the person shows as typing forever; this is
        # still the backstop for that, and it is still not a cron, because a cron
        # is a thing nobody notices has stopped.
        #
        # What changed is the shape. This was one unqualified DELETE — no channel
        # predicate at all — issued on EVERY poll: fifteen times a minute, by
        # every polling user, in every org, including the rail-only polls with no
        # channel open. `samvada_typing`'s only index is its primary key
        # `(channel_id, user_id)` and `updated_at` is not in it, so each of those
        # was a sequential scan of the whole table under a row-exclusive lock,
        # every org scanning every other org's rows. The table being small is
        # what kept that from hurting, and "the table is small" is not a
        # predicate — it is a bet on nobody ever leaving a tab open.
        #
        # Scoped, it is a primary-key prefix scan of the handful of rows in one
        # channel, and it is the only sweep that was ever doing this caller any
        # good: the typing list read below is scoped to this channel AND filters
        # `updated_at > now() - interval '8 seconds'`, so a stale row in another
        # channel could never have been rendered here. It gets swept by the first
        # poll that opens THAT channel — the first moment it could have been
        # seen by anybody.
        #
        # `may_type` rather than `ready`: it already means 093 is applied, the id
        # is a real uuid, and the caller may read the channel. Sweeping a channel
        # the caller is refused would be a write on behalf of a foreign room.
        if may_type:
            await conn.execute(
                "DELETE FROM staging.samvada_typing "
                "WHERE channel_id=$1::uuid "
                "AND updated_at < now() - interval '15 seconds'",
                channel_id,
            )

        # Counts. Same visibility rule and same counting rule as `GET /channels`
        # — public channels in the org plus the private and DM ones the caller
        # belongs to — so the rail cannot flicker between two numbers as the
        # slower call lands. `GET /unread` covers only channels you are a member
        # of and is the disagreement this replaces; it is left untouched because
        # nothing in the frontend calls it.
        mention_count = (
            """(SELECT COUNT(*) FROM staging.samvada_mentions mn
                 WHERE mn.channel_id = c.id AND mn.mentioned_user_id = $2
                   AND mn.read_at IS NULL)"""
            if ready else "0"
        )
        ch_rows = await conn.fetch(f"""
            SELECT c.id,
                   COALESCE(cm_me.muted, FALSE) AS muted,
                   {mention_count} AS mentions,
                   CASE WHEN cm_me.user_id IS NULL THEN 0 ELSE (
                       SELECT COUNT(*) FROM staging.samvada_messages m
                        WHERE m.channel_id = c.id AND m.is_deleted = FALSE
                          AND m.parent_message_id IS NULL
                          AND m.sender_id <> $2
                          -- Floored at `joined_at` as well as the read cursor —
                          -- see the long note on the channel-list query above.
                          -- The two counts must agree or the badge and the list
                          -- disagree, which is the whole defect.
                          AND m.created_at > GREATEST(
                                  COALESCE(cm_me.last_read_at, '-infinity'::timestamptz),
                                  COALESCE(cm_me.joined_at,    '-infinity'::timestamptz))
                   ) END AS unread
            FROM staging.samvada_channels c
            LEFT JOIN staging.samvada_channel_members cm_me
                   ON cm_me.channel_id = c.id AND cm_me.user_id = $2
            WHERE c.org_id = $1::uuid
              AND (c.type = 'public' OR cm_me.user_id IS NOT NULL)
        """, org_id, me)

        # The caller is excluded: nobody needs to be told they are typing. Capped
        # at five because "Several people are typing…" is the label above three
        # and there is no reason to ship the sixth name to render it.
        typing_rows = []
        if may_type:
            typing_rows = await conn.fetch(f"""
                SELECT t.user_id, {display_name('u')} AS full_name
                FROM staging.samvada_typing t
                LEFT JOIN users u ON u.user_id = t.user_id
                WHERE t.channel_id = $1::uuid AND t.user_id <> $2
                  AND t.updated_at > now() - interval '8 seconds'
                ORDER BY t.updated_at DESC
                LIMIT 5
            """, channel_id, me)

        # Presence is derived in SQL, not Python, so it is computed against the
        # database's clock rather than the container's — a Railway instance whose
        # clock has drifted 90 seconds would otherwise report the whole org
        # offline. Anyone stale enough to be neither online nor away is OMITTED
        # rather than sent as "offline": in a 200-person org that is the
        # difference between a 40-byte map and a 4KB one, four seconds apart, and
        # the client already reads an absent key as offline.
        pres_rows = []
        if ready:
            pres_rows = await conn.fetch("""
                SELECT p.user_id,
                       CASE WHEN p.status = 'online'
                             AND p.last_seen_at > now() - interval '70 seconds'
                            THEN 'online' ELSE 'away' END AS state
                FROM staging.samvada_presence p
                WHERE p.org_id = $1::uuid
                  AND p.last_seen_at > now() - interval '5 minutes'
            """, org_id)

        # `now()` comes from the database in the same round trip as the count,
        # for the same clock reason as above: the client compares it against
        # `created_at` values that Postgres stamped.
        if ready:
            tail = await conn.fetchrow("""
                SELECT (SELECT COUNT(*) FROM staging.samvada_mentions
                         WHERE org_id = $1::uuid AND mentioned_user_id = $2
                           AND read_at IS NULL) AS mention_unread,
                       now() AS server_time
            """, org_id, me)
        else:
            tail = await conn.fetchrow(
                "SELECT 0::bigint AS mention_unread, now() AS server_time"
            )

    return {
        "channels": {
            str(r["id"]): {
                "unread": int(r["unread"] or 0),
                "mentions": int(r["mentions"] or 0),
                "muted": bool(r["muted"]),
            }
            for r in ch_rows
        },
        "typing": [
            {"user_id": r["user_id"], "full_name": r["full_name"]} for r in typing_rows
        ],
        "presence": {r["user_id"]: r["state"] for r in pres_rows},
        "mention_unread": int((tail and tail["mention_unread"]) or 0),
        "server_time": tail["server_time"] if tail else None,
    }


# ── Mentions ─────────────────────────────────────────────────

@router.get("/mentions")
async def list_mentions(
    unread_only: bool = False,
    limit: int = Query(30, ge=1, le=100),
    before: Optional[str] = None,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """The caller's mention feed, newest first. A bare array, matching
    `GET /api/notifications`, which the inbox already consumes as one.

    No level check and no channel check: every row is the caller's own by
    definition — `mentioned_user_id = $2` is the whole ACL — and a row only
    exists because somebody who could post in that channel named this person in
    it.

    KEYSET, NOT OFFSET, and the cursor carries the tiebreaker. `before` is a
    mention id and the comparison is `(created_at, id) < (that row's pair)`.
    `fan_out_mentions` inserts one row per recipient inside a single statement,
    so a batch shares a `created_at` to the microsecond; ordering on that column
    alone leaves the order within a batch undefined and a cursor sitting
    mid-batch can drop or repeat its neighbours. This is deliberately NOT the
    naked `created_at <` that `GET /channels/{id}/messages` uses above — that
    arm has the bug just described and it should not be copied into new code.

    The cursor subquery is scoped to the caller's own rows, so a guessed foreign
    mention id resolves to NULL, the comparison yields NULL, and the page comes
    back empty rather than confirming that the id exists.
    """
    pool = await get_pool()
    if not await _parity_ready(pool):
        return []

    where = ["mn.org_id = $1::uuid", "mn.mentioned_user_id = $2", "m.is_deleted = FALSE"]
    args: list = [org_id, user["user_id"]]
    if unread_only:
        where.append("mn.read_at IS NULL")
    if _valid_uuid(before):
        args.append(before)
        where.append(
            f"(mn.created_at, mn.id) < (SELECT created_at, id "
            f"FROM staging.samvada_mentions WHERE id = ${len(args)}::uuid "
            f"AND mentioned_user_id = $2)"
        )
    args.append(limit)
    rows = await pool.fetch(f"""
        SELECT mn.id, mn.channel_id, mn.message_id, mn.kind, mn.created_at, mn.read_at,
               {_channel_label_sql(2)} AS channel_name,
               c.type AS channel_type,
               m.content, m.sender_id,
               -- The thread root, when the mention was written inside a reply.
               -- Without it the in-app Mentions panel can only ask the client to
               -- jump to a message id that `list_messages` never returns
               -- (`parent_message_id IS NULL`), so the reader gets "that message
               -- is not on screen" while this same row quotes its text at them.
               -- The email and push links already carry `&thread=` for exactly
               -- this; the panel had no way to.
               m.parent_message_id,
               {display_name('u')} AS sender_name,
               u.avatar AS sender_avatar
        FROM staging.samvada_mentions mn
        JOIN staging.samvada_channels c ON c.id = mn.channel_id
        JOIN staging.samvada_messages m ON m.id = mn.message_id
        LEFT JOIN users u ON u.user_id = m.sender_id
        WHERE {' AND '.join(where)}
        ORDER BY mn.created_at DESC, mn.id DESC
        LIMIT ${len(args)}
    """, *args)
    return [dict(r) for r in rows]


@router.post("/mentions/read")
async def mark_mentions_read(
    body: MentionsReadIn,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Mark some, or all, of the caller's mentions read.

    Every statement below is doubly scoped — `org_id` AND `mentioned_user_id` —
    even though the id list alone would find the rows. A uuid supplied by a
    caller is a caller-supplied identifier, and "the id is unguessable" is not
    an access rule; without the owner predicate, a leaked id would let anyone
    clear somebody else's badge.
    """
    if body.mention_ids and body.mark_all:
        raise HTTPException(400, "Send either mention_ids or mark_all, not both")

    pool = await get_pool()
    if not await _parity_ready(pool):
        return {"ok": True, "updated": 0}

    if body.mark_all:
        args: list = [org_id, user["user_id"]]
        scope = ""
        if _valid_uuid(body.channel_id):
            args.append(body.channel_id)
            scope = f" AND channel_id = ${len(args)}::uuid"
        status = await pool.execute(
            "UPDATE staging.samvada_mentions SET read_at = now() "
            "WHERE org_id=$1::uuid AND mentioned_user_id=$2 AND read_at IS NULL" + scope,
            *args,
        )
    elif body.mention_ids:
        # A malformed uuid in the list would make asyncpg raise `DataError` on
        # the cast and take the whole call down with a 500. Dropping the bad
        # entries marks the good ones and the client's badge still clears.
        ids = [i for i in body.mention_ids if _valid_uuid(i)]
        if not ids:
            return {"ok": True, "updated": 0}
        status = await pool.execute(
            "UPDATE staging.samvada_mentions SET read_at = now() "
            "WHERE org_id=$1::uuid AND mentioned_user_id=$2 AND read_at IS NULL "
            "AND id = ANY($3::uuid[])",
            org_id, user["user_id"], ids,
        )
    else:
        return {"ok": True, "updated": 0}

    return {"ok": True, "updated": _rowcount(status)}


# ── Search ───────────────────────────────────────────────────

@router.get("/search")
async def search_messages(
    q: str = Query(..., min_length=2, max_length=120),
    channel_id: Optional[str] = None,
    from_user: Optional[str] = None,
    limit: int = Query(25, ge=1, le=50),
    offset: int = Query(0, ge=0, le=500),
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Full-text search across the messages this caller can actually read.

    THE VISIBILITY PREDICATE IS THE WHOLE ENDPOINT. This is the easiest place in
    the module to hand one tenant another tenant's conversations, because unlike
    every other read here there is no channel id in the path to scope it. Two
    things do the work and neither may be dropped: the org predicate sits ON THE
    CHANNEL JOIN, where a later edit cannot lose it in a WHERE clause; and
    membership is an EXISTS OR-ed with `c.type = 'public'`, which is verbatim
    the rule `list_messages` and `_assert_channel_access` enforce. It is stated
    identically in `routers/search.py:_search_messages` — three copies of one
    rule is already one too many, so if this ever changes, change all three.

    Two match arms, because they answer different questions. The tsquery arm
    matches on word boundaries with a prefix, which is what searching for a name
    is. The ILIKE arm matches INSIDE a token, which a tsvector can never do —
    somebody typing `nag` looking for `nagar` gets nothing from tsquery alone.
    `pg_trgm` is installed and indexes that pattern class.

    BOTH ARMS ARE INDEXED ONCE 093 LANDS, and that is a condition rather than a
    bonus — checked against the migration as it now stands, which creates
    `samvada_messages_content_trgm_idx` on `content` with `gin_trgm_ops`
    alongside the GIN index on `search_tsv`. `content ILIKE $3` is the `~~*`
    operator and that operator class answers it, so the OR becomes a BitmapOr
    over two index scans. Three things about that are worth stating because each
    is a place a later edit goes wrong:

      · THE PATTERN BEING A BIND PARAMETER DOES NOT PREVENT THE INDEX. A GIN
        scan extracts its trigrams from the value at scan start, so `$3` is as
        indexable as a literal. This is not true of a btree prefix index, which
        needs the constant at PLAN time to derive its range bounds — which is
        why "parameterised LIKE cannot use an index" is folklore worth not
        repeating here.
      · AN OR IS ONLY AS INDEXABLE AS ITS WORST ARM. If either index is missing
        the planner cannot answer half the predicate from an index, so it
        answers none of it and scans — which means the tsvector index alone buys
        nothing at all. That is why the query shape below must not be
        "improved" into a single arm to make one index look useful.
      · A TWO-CHARACTER QUERY STILL SCANS, and `q` is accepted from two: `%ab%`
        contains no complete trigram, so there is nothing to look up. Bounded
        and accepted — nobody paginates a two-letter search — and 093 records
        the same caveat.

    So: the query shape here is already right for both indexes and is
    deliberately left alone. What has to ship is the migration, with both.

    `'simple'`, never `'english'`. English stemming and stopword-stripping
    mangle Devanagari and would make Hindi terms unsearchable; migration 093
    states the same reasoning on the generated column itself.

    The tsquery is ALWAYS a bind parameter, never concatenated. `build_tsquery`
    sanitises for correctness — it admits Unicode combining marks so `राकेश`
    survives, where `str.isalnum()` alone would strip the matras and leave
    `रकश` — but the bind parameter is the injection defence, and the two must
    not be confused for each other.

    The server does NOT highlight. Highlighting is a render concern and doing it
    here would mean shipping markup down a JSON field that the client renders as
    React children.
    """
    pool = await get_pool()
    ready = await _parity_ready(pool)

    # A copy of `search.py`'s tokeniser lives in `services/samvaad_mentions.py`
    # rather than being imported from the router — importing `routers.search`
    # drags in the whole router graph, and it imports `server`, so the cycle is
    # immediate.
    from services.samvaad_mentions import build_tsquery
    tsq = build_tsquery(q)

    # Parameter numbering is fixed by hand rather than generated, and the
    # tsquery is the LAST of the three so that dropping it renumbers nothing:
    # Postgres derives a statement's parameter count from the highest `$n` that
    # appears, so leaving a gap at `$3` while `$4` is still referenced fails with
    # "could not determine data type of parameter $3" before a row is read.
    args: list = [user["user_id"], org_id, f"%{q}%"]
    if tsq:
        args.append(tsq)
        # Pre-093 the generated column does not exist, so the same predicate is
        # computed on the fly. It is a sequential scan and it is meant to be —
        # it keeps search working in the window before the migration is applied
        # by hand, and the GIN index takes over the moment it is.
        tsv = "m.search_tsv" if ready else "to_tsvector('simple', COALESCE(m.content, ''))"
        match = f"(({tsv} @@ to_tsquery('simple', $4)) OR m.content ILIKE $3)"
    else:
        # An all-punctuation query compiles to an empty tsquery, which
        # `to_tsquery` rejects outright. ILIKE alone still answers it.
        match = "m.content ILIKE $3"

    where = [
        "m.is_deleted = FALSE",
        "(c.type = 'public' OR EXISTS (SELECT 1 FROM staging.samvada_channel_members cm "
        " WHERE cm.channel_id = c.id AND cm.user_id = $1))",
        match,
    ]
    if _valid_uuid(channel_id):
        args.append(channel_id)
        where.append(f"m.channel_id = ${len(args)}::uuid")
    if from_user:
        args.append(from_user)
        where.append(f"m.sender_id = ${len(args)}")

    # LIMIT + 1 and truncate, rather than a second COUNT over the same predicate.
    # A count would double the cost of a query that fires on a 300ms debounce,
    # and "is there another page" is the only question the client asks.
    args.append(limit + 1)
    lim_p = len(args)
    args.append(offset)
    off_p = len(args)

    # Offset paging, not keyset — matching `activity.py` and `whatsapp.py`. A
    # result set ordered by recency within a match set has no stable cursor once
    # a new message arrives that also matches.
    pinned = "m.pinned_at" if ready else "NULL::timestamptz AS pinned_at"
    rows = await pool.fetch(f"""
        -- `parent_message_id` for the same reason `list_mentions` returns it: a
        -- hit inside a thread reply is not a row `list_messages` will ever
        -- return, so without the root the client can only jump to a message it
        -- cannot find and then apologise for it.
        SELECT m.id, m.channel_id, m.content, m.sender_id, m.created_at,
               m.parent_message_id, {pinned},
               {_channel_label_sql(1)} AS channel_name,
               c.type AS channel_type,
               {display_name('u')} AS sender_name,
               u.avatar AS sender_avatar
        FROM staging.samvada_messages m
        JOIN staging.samvada_channels c ON c.id = m.channel_id AND c.org_id = $2::uuid
        LEFT JOIN users u ON u.user_id = m.sender_id
        WHERE {' AND '.join(where)}
        ORDER BY m.created_at DESC
        LIMIT ${lim_p} OFFSET ${off_p}
    """, *args)

    return {"results": [dict(r) for r in rows[:limit]], "more": len(rows) > limit}


# ── Pinned messages ──────────────────────────────────────────

@router.post("/messages/{message_id}/pin")
async def pin_message(
    message_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Pin a message to its channel.

    Ordering is org-scoped 404 → channel access → editor, the same as
    `add_reaction` and for the same reason recorded there: a level check that
    fires before the org filter would let a security test pass on a 403 that
    proves nothing about tenancy.

    IDEMPOTENT. `WHERE ... AND pinned_at IS NULL` means a double-tap, or two
    people pinning at once, cannot rewrite `pinned_by` — whoever got there first
    keeps the attribution, and the second caller still gets a 200 because from
    their side the message is now pinned, which is what they asked for.

    Refused on an archived channel, matching `send_message`: an archive is
    closed to new content and a pin is content the channel did not have before.
    Unpin is deliberately still allowed there — same asymmetry, and the same
    reasoning, as `add_reaction` being editor-gated while `remove_reaction` is
    not: taking something back is not an act these gates exist to prevent.
    """
    pool = await get_pool()
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    # The channel is joined in rather than fetched separately so that the
    # archived check costs nothing: `_assert_channel_access` below reads the
    # channel again for its own reason, and a third round trip for one boolean
    # would be waste on a path a user clicks.
    msg = await pool.fetchrow("""
        SELECT m.channel_id, m.pinned_at, c.is_archived
        FROM staging.samvada_messages m
        JOIN staging.samvada_channels c ON c.id = m.channel_id
        WHERE m.id=$1::uuid AND m.org_id=$2::uuid AND m.is_deleted = FALSE
    """, message_id, org_id)
    if not msg:
        raise HTTPException(404, "Message not found")
    await _assert_channel_access(pool, msg["channel_id"], org_id, user["user_id"])
    if msg["is_archived"]:
        raise HTTPException(403, _ARCHIVED_REFUSAL)
    await _require_editor(pool, user["user_id"], org_id)

    if msg["pinned_at"] is not None:
        return {"ok": True, "pinned_at": msg["pinned_at"]}

    n = await pool.fetchval(
        "SELECT COUNT(*) FROM staging.samvada_messages "
        "WHERE channel_id=$1::uuid AND pinned_at IS NOT NULL",
        msg["channel_id"],
    )
    if (n or 0) >= _PIN_CAP:
        raise HTTPException(
            400,
            f"This channel already has {_PIN_CAP} pinned messages. Unpin one first.",
        )

    row = await pool.fetchrow("""
        UPDATE staging.samvada_messages
           SET pinned_at = now(), pinned_by = $2
         WHERE id = $1::uuid AND pinned_at IS NULL
        RETURNING pinned_at
    """, message_id, user["user_id"])
    if row is None:
        # Lost the race to a concurrent pin. Report the winner's timestamp
        # rather than null, so the client renders the chip it just asked for.
        pinned_at = await pool.fetchval(
            "SELECT pinned_at FROM staging.samvada_messages WHERE id=$1::uuid", message_id
        )
        return {"ok": True, "pinned_at": pinned_at}
    return {"ok": True, "pinned_at": row["pinned_at"]}


@router.delete("/messages/{message_id}/pin")
async def unpin_message(
    message_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Unpin, if you are the one who pinned it or you run the channel.

    Editor level is enforced by the verb gate in `require_module` before this
    function runs — DELETE is a write — so there is no `_require_editor` call
    here. The ownership rule on top of it is what stops one member quietly
    unpinning the thing another member pinned; `role='admin'` on the channel is
    the override, because otherwise a pin by somebody who has since left the org
    could never be removed.
    """
    pool = await get_pool()
    if not _valid_uuid(message_id):
        raise HTTPException(404, "Message not found")
    msg = await pool.fetchrow("""
        SELECT channel_id, pinned_by
        FROM staging.samvada_messages
        WHERE id=$1::uuid AND org_id=$2::uuid
    """, message_id, org_id)
    if not msg:
        raise HTTPException(404, "Message not found")
    await _assert_channel_access(pool, msg["channel_id"], org_id, user["user_id"])

    if msg["pinned_by"] != user["user_id"]:
        mem = await pool.fetchrow(
            "SELECT role FROM staging.samvada_channel_members "
            "WHERE channel_id=$1::uuid AND user_id=$2",
            msg["channel_id"], user["user_id"],
        )
        if not mem or mem["role"] != "admin":
            raise HTTPException(
                403,
                "Only the person who pinned this, or a channel admin, can unpin it.",
            )

    await pool.execute(
        "UPDATE staging.samvada_messages SET pinned_at = NULL, pinned_by = NULL "
        "WHERE id=$1::uuid",
        message_id,
    )
    return {"ok": True}


@router.get("/channels/{channel_id}/pins")
async def list_pins(
    channel_id: str,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Every pinned message in the channel, newest pin first.

    Unpaged on purpose: `_PIN_CAP` bounds the result at fifty rows, so a cursor
    would be ceremony around a query that can never grow. If the cap ever rises,
    this is the endpoint that has to change with it.

    No level check — reading the pins is reading the channel, and a viewer is
    entitled to both. `_assert_channel_access` is the only gate, and it is the
    same one `list_messages` uses.
    """
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    await _assert_channel_access(pool, channel_id, org_id, user["user_id"])
    if not await _parity_ready(pool):
        # Before 093 there is no `pinned_at` column to select. An empty bar is
        # the honest answer; a 500 here would break the chat header, which loads
        # this on every channel open.
        return []
    # Two aliases, two ladders, one expression: the sender and whoever pinned
    # the message are different people, and `p` is joined LEFT — an unpinned or
    # deleted pinner still yields NULL, which the header renders as no pinner
    # rather than as an unnamed one.
    rows = await pool.fetch(f"""
        SELECT m.id, m.channel_id, m.content, m.sender_id, m.created_at,
               m.pinned_at, m.pinned_by, m.type, m.metadata,
               {display_name('u')} AS sender_name,
               u.avatar AS sender_avatar,
               {display_name('p')} AS pinned_by_name
        FROM staging.samvada_messages m
        LEFT JOIN users u ON u.user_id = m.sender_id
        LEFT JOIN users p ON p.user_id = m.pinned_by
        WHERE m.channel_id = $1::uuid
          AND m.pinned_at IS NOT NULL
          AND m.is_deleted = FALSE
        ORDER BY m.pinned_at DESC
    """, channel_id)
    return [dict(r) for r in rows]


# ── Per-channel mute ─────────────────────────────────────────

@router.put("/channels/{channel_id}/mute")
async def set_channel_mute(
    channel_id: str,
    body: MuteIn,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    """Silence a channel's unread badge and its push notifications.

    PUT, not PATCH: it sets one boolean to a stated value and is idempotent.

    D3 — this is editor-gated and that is accepted rather than worked around.
    It is a genuine write, so `require_module`'s verb gate has already refused a
    legacy `viewer` before this function runs. Every grant issued since
    `NEW_GRANT_LEVEL_BY_MODULE["sanvaad"]` became EDITOR is an editor, so the
    affected population is legacy viewer rows only — and a viewer who cannot
    post has the weakest possible case for needing to mute. The frontend hides
    the control when `!canPost` rather than disabling it, matching the house
    pattern. The identical pre-existing problem on `POST /channels/{id}/read`
    stays exactly as it is; fixing one and not the other would be worse than
    fixing neither, and fixing both is a permissions decision, not this work.

    Muting is a PERSONAL preference row, so unlike posting it is allowed on an
    archived channel and allowed on a DM. There is no "cannot mute a DM" — a DM
    is the single most likely thing somebody wants to silence for an afternoon.

    Mute records nothing about the mention badge. `fan_out_mentions` still
    writes the mention row for a muted channel and suppresses only the
    notification and the push: muting means "do not interrupt me", not "hide
    from me that I was named".
    """
    pool = await get_pool()
    if not _valid_uuid(channel_id):
        raise HTTPException(404, "Channel not found")
    # `_assert_channel_access` IS the org check — it 404s on a channel outside
    # the caller's org and 403s on a private one they are not in, in that order.
    # A separate org-scoped lookup first would be a second round trip asking a
    # question this one already answers.
    await _assert_channel_access(pool, channel_id, org_id, user["user_id"])

    if not body.muted:
        # UNMUTING TAKES THE ROW AWAY AGAIN when the row exists only to carry
        # the mute. Flipping `muted` to false and leaving it was a one-way door:
        # `muted` is read as `COALESCE(cm_me.muted, FALSE)` everywhere, so the
        # false is worth exactly as much as no row at all, while the row it
        # sits on goes on counting. The user is in `member_count`, in
        # `GET /channels/{id}/members`, in `@channel`'s fan-out and against the
        # fifteen-head broadcast ceiling; and because every unread counter is
        # `CASE WHEN cm_me.user_id IS NULL THEN 0`, a room they never opened
        # starts showing them badges. One press of mute and one press of unmute
        # — a pair whose whole meaning is "never mind" — joined them to a
        # channel for good.
        #
        # `joined_at = '-infinity'` is the marker, and the module docstring says
        # why that column: it is the only one on this table with room for a
        # sentinel, since every real join lets its `NOW()` default fire and
        # nothing in the product reads it.
        #
        # THE MESSAGE CLAUSE IS THE SECOND HALF OF THE MARKER. `send_message`
        # auto-joins a public channel on the first post, and it does that by
        # INSERTing only when no row exists — so somebody who muted first and
        # posted afterwards keeps the sentinel row and is a real participant
        # under it. Asking here whether they have ever posted costs one indexed
        # EXISTS on a button nobody presses twice a minute, and it is the same
        # question `send_message` would have to answer on every single send to
        # keep the marker current from its end.
        #
        # A real member's row is untouched by all of this: their `joined_at` is
        # a date, the predicate is false, zero rows go, and the UPDATE below
        # does what it has always done.
        gone = await pool.execute("""
            DELETE FROM staging.samvada_channel_members cm
             WHERE cm.channel_id = $1::uuid AND cm.user_id = $2
               AND cm.joined_at = '-infinity'::timestamptz
               AND NOT EXISTS (SELECT 1 FROM staging.samvada_messages m
                                WHERE m.channel_id = cm.channel_id
                                  AND m.sender_id = cm.user_id)
        """, channel_id, user["user_id"])
        if _rowcount(gone):
            return {"ok": True, "muted": False}

    status = await pool.execute(
        "UPDATE staging.samvada_channel_members SET muted = $3 "
        "WHERE channel_id = $1::uuid AND user_id = $2",
        channel_id, user["user_id"], body.muted,
    )
    if _rowcount(status) == 0:
        # No member row. `_assert_channel_access` has already established this
        # can only be a PUBLIC channel the caller has not joined — for anything
        # else it would have raised 403 above. Muting a public channel you have
        # not joined is a legitimate act, and the honest alternative is a 404
        # that tells the user their own preference does not exist.
        #
        # ── Expressing a preference about a room is not the same act as joining
        # it, and `joined_at` is how the row is made to say so
        #
        # `muted` is a column on `samvada_channel_members` and there is nowhere
        # else in this schema for a per-channel preference to live, so a mute by
        # a non-member has to write a membership row. What it must NOT do is
        # write one that lies about the caller's history, and it did, twice:
        #
        #   · `last_read_at` came out NULL, and every unread count in this module
        #     reads `COALESCE(cm_me.last_read_at, '-infinity')` behind a
        #     `CASE WHEN cm_me.user_id IS NULL THEN 0`. The NULL check was the
        #     only thing holding the count at zero for an unjoined channel — the
        #     exact bug `list_channels` documents fixing — and this INSERT walked
        #     the caller straight past it. Pressing mute on a five-year-old
        #     #general lit a four-figure badge on the channel they had just
        #     asked to be quiet.
        #   · Nothing here is a no-op guard, so UNMUTING a channel you never
        #     joined also wrote the row. `muted` is read as
        #     `COALESCE(cm_me.muted, FALSE)` everywhere, so the absence of a row
        #     already IS "not muted": that write recorded a default and joined
        #     somebody to a channel in exchange for nothing at all.
        #
        # `now()` for `last_read_at`, not NULL and not epoch: the caller is
        # looking at the rail this second, and "everything before now is read" is
        # the true statement about somebody who has never opened the channel.
        # Only `muted` is touched on conflict — a racing second call must not
        # reset a real member's read position, and it must not overwrite a real
        # member's `joined_at` with the sentinel either, which is the second
        # reason that clause names one column and no others.
        #
        # `joined_at = '-infinity'` says THIS IS NOT A JOIN, and it is what lets
        # the unmute above take the row away again. There is no honest date to
        # write here — the caller has not joined — and the column is NOT NULL,
        # so the sentinel is the closest thing to the truth the schema will
        # hold. The module docstring carries the full reasoning, including why
        # `role` cannot do this job: 058 constrains it to `('admin','member')`
        # and both values are already spoken for.
        #
        # WHAT STILL FOLLOWS FROM THE ROW FOR AS LONG AS THE MUTE STANDS,
        # because it is a membership row and this endpoint cannot make it
        # anything else. All three END at the unmute above, which is the change
        # this list used to be the standing cost of. Written down rather than
        # left to be found:
        #
        #   · The caller appears in `GET /channels/{id}/members` and in the
        #     `member_count` everybody sees.
        #   · `fan_out_mentions` resolves `@channel`/`@here` from that same
        #     table, so a muted non-member becomes a broadcast recipient. Mute
        #     suppresses their notification and their push, so they are not
        #     interrupted — but the mention ROW is still written for them, which
        #     is the documented rule ("do not interrupt me", not "hide that I was
        #     named") and is why the mention badge is deliberately not muted.
        #   · That extra head counts against `BROADCAST_FREE_FOR_ALL_MAX_MEMBERS`
        #     (15). One mute is what can push a 15-member channel to 16 and take
        #     `@channel` away from every non-admin in it, silently, with the
        #     message still posting normally. Nothing here can prevent that while
        #     the mute lives in the membership table — the sentinel bounds the
        #     row's LIFETIME, it does not hide the row, and hiding it from the
        #     two counts that live in this file while
        #     `services/samvaad_mentions.py` kept counting it would be worse
        #     than the head. It is still the strongest reason to give the
        #     preference its own table the next time this schema is opened, and
        #     `joined_at` is the convention such a column would replace.
        if not body.muted:
            return {"ok": True, "muted": False}
        await pool.execute("""
            INSERT INTO staging.samvada_channel_members
                (channel_id, user_id, role, muted, last_read_at, joined_at)
            VALUES ($1::uuid, $2, 'member', $3, now(), '-infinity'::timestamptz)
            ON CONFLICT (channel_id, user_id) DO UPDATE SET muted = EXCLUDED.muted
        """, channel_id, user["user_id"], body.muted)
    return {"ok": True, "muted": body.muted}
