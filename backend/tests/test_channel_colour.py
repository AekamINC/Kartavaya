"""Sanvaad channel colour — the stored tone, and the rotation that assigns it.

The owner asked for one thing: "if i create an new channel it gets assinged a
different random and it stays, no changes everytime". The word "random" is the
only part of that sentence this file argues with, and it argues with it in
`test_the_first_eight_channels_get_eight_different_colours`: random over eight
tones collides about 60% of the time by the sixth channel — the birthday problem
— and a rail where two of six rooms share a colour is a rail you still have to
read. Rotation is what "a different colour" actually means.

── What is provable here, and what is not

The pool is MOCKED. `routers/messaging.py:30-41` records at length what that is
worth: every read endpoint in this module once answered 500 against a real
database with the whole suite green, because a mocked cursor resolves any table
name you hand it. So this file deliberately puts the one piece of BEHAVIOUR
worth proving — the rotation — in a pure function, `pick_channel_tone`, and
tests it directly over hundreds of create/delete steps rather than through a
mock that would only ever be replaying answers this file wrote.

What the HTTP tests below prove is the other half, which a pure function cannot:
that the handler asks for the tone, binds it as a parameter, names the column
only when the column exists, and refuses a value the database would refuse.

── The four places the vocabulary lives, and why section 0 exists

`CHANNEL_TONES`, the CHECK in migration 100, that migration's backfill array,
and the `--m-*` declarations in `frontend/src/styles/module.css` are ONE list in
four files. Nothing at runtime notices them diverging: a key the CSS does not
declare renders `var(--m-typo)`, which resolves to nothing, and the channel's
glyph tile draws in whatever colour it inherits — an invisible channel that
still occupies a row, with no error, no warning and no way to tell it apart from
a channel whose colour was never set. Section 0 is the only thing that can see
that happen.

THE MIGRATION IS READ WITH ITS COMMENTS STRIPPED. That is not tidiness. This
repository has been bitten three times by a check that asserted against its own
commentary — most recently `test_prachar_audience._body`, and the same trap is
recorded in `test_samvaad_search_and_pins._code_of`. Migration 100's header
prints all eight tone names in a table mapping them to the design's `--sv-ch-*`
hexes, so a test that grepped the raw file would be satisfied by the explanation
of the code rather than by the code. `_sql(...)` drops every full-line `--`
comment before a single assertion runs; deleting the real `ARRAY[...]` from the
file must turn section 0 red, and it does.
"""
import pathlib
import random
import re
from collections import Counter
from unittest.mock import AsyncMock

import pytest

from conftest import TEST_ORG_ID
from routers.messaging import CHANNEL_TONES, pick_channel_tone

API = "/api/v1/messaging"
CHANNEL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SOMEBODY_ELSE = "user_someone_else"

REPO = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = REPO / "backend" / "migrations" / "100_channel_colour.sql"
MODULE_CSS = REPO / "frontend" / "src" / "styles" / "module.css"


def _sql(text: str) -> str:
    """The migration with every full-line `--` comment removed.

    Full-line only, and deliberately so: `COMMENT ON COLUMN` in that file
    contains the literal string `var(--m-<key>)`, and a naive "strip from the
    first `--` to end of line" would cut a SQL string literal in half and leave
    this helper producing something that is not SQL. Every comment this file
    needs gone occupies its own line — the header, the section banners and the
    lock notes all do — so the narrow rule is both safe and sufficient.
    """
    return "\n".join(
        line for line in text.splitlines() if not line.strip().startswith("--")
    )


def _quoted(fragment: str) -> list[str]:
    """The single-quoted strings inside a fragment, in order."""
    return re.findall(r"'([^']*)'", fragment)


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Skip `require_module('sanvaad')` — reach and the write-verb gate are
    tested in `test_module_write_level.py`, and leaving them on here would make
    every refusal below ambiguous between "wrong level" and "no subscription"."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _clean_migration_caches():
    """Both readiness caches are MODULE-scoped and survive the test that set them.

    `_parity_ready` (093) and `_colour_ready` (100) each cache a catalogue probe
    for the life of the process, and a FALSE cached here would follow every later
    test in every later file into the degraded path — search without `search_tsv`,
    mentions returning `[]`, channels created with no colour — landing the failure
    nowhere near its cause. `test_samvaad_search_and_pins` carries the same
    fixture for the same reason. Each test that cares states the colour cache
    explicitly; this only guarantees the state it inherits and the state it leaves.
    """
    from routers.messaging import _reset_colour_cache, _reset_parity_cache
    _reset_parity_cache(True)
    _reset_colour_cache(None)
    yield
    _reset_parity_cache(None)
    _reset_colour_cache(None)


def _wire(
    mock_pool, *,
    level: str = "editor",
    migration_applied: bool = True,
    channel: dict | None = None,
    membership: dict | None = None,
    tones_in_use: list[tuple[str, int]] | None = None,
    created: dict | None = None,
    updated: dict | None = None,
    listed: list | None = None,
    existing_dm: dict | None = None,
    same_org: int = 1,
):
    """Answer by SQL SHAPE, not by call order — `test_samvaad_search_and_pins`
    makes the argument: a test that orders side-effect lists to match a handler's
    exact sequence breaks the moment the handler adds a round trip, which is
    precisely what this change does to `create_channel`.

    Every mocked callable APPENDS TO ONE SHARED LOG before answering, and that
    log is the only thing `_queries` reads. Reconstructing the order afterwards
    from `call_args_list` — which is the obvious way and is what the first draft
    of this file did — cannot work: the calls are grouped per mock, so walking
    `execute` then `fetch` then `fetchrow` reports every `execute` before every
    `fetch` whatever really happened. `test_creation_locks_the_org_before...`
    passed under that reconstruction EVEN WITH THE LOCK MOVED AFTER THE READ,
    which is the exact defect it exists to catch. One shared list, appended at
    call time, is the only ordering that is real.
    """
    if channel is None:
        channel = {"id": CHANNEL_ID, "type": "public", "is_archived": False,
                   "name": "general", "description": "", "color": "graha"}
    if membership is None:
        membership = {"role": "admin"}
    if created is None:
        created = {"id": CHANNEL_ID, "type": "public", "name": "new-room",
                   "color": "graha"}
    if updated is None:
        updated = dict(channel)
    if listed is None:
        listed = []

    log: list[tuple[str, list]] = []

    async def _fetchval(s, sql, a):
        # `held_level` asks three questions in this order.
        if "org_id IS NULL" in s:
            return None                                   # no platform role
        if "role_code IN ('org_owner','org_admin')" in s:
            return None                                   # not an org admin
        if "org_member_modules" in s:
            return level
        # `_colour_ready`'s catalogue probe for migration 100.
        if "information_schema.columns" in s and "'color'" in s:
            return migration_applied
        # `_assert_same_org` — the THREE-role list, which is what tells it apart
        # from `_org_role` two lines up.
        if "staging.user_roles" in s and "'org_member'" in s:
            return same_org
        return 0

    async def _fetchrow(s, sql, a):
        if s.upper().startswith("UPDATE"):
            return updated
        if s.upper().startswith("INSERT"):
            return created
        # The DM lookup, before the generic channel read: `find_or_create_dm`
        # answers early when this returns a row, so a test of the CREATE path
        # needs it to return nothing.
        if "c.type = 'dm'" in s:
            return existing_dm
        if "FROM staging.samvada_channels" in s:
            return channel
        if "samvada_channel_members" in s:
            return membership
        return None

    async def _fetch(s, sql, a):
        if "SELECT color, COUNT(*)" in s:
            return [{"color": tone, "n": n} for tone, n in (tones_in_use or [])]
        return list(listed)

    async def _execute(s, sql, a):
        return "INSERT 0 1"

    def _logged(fn):
        async def _inner(sql, *a):
            s = " ".join(str(sql).split())
            log.append((s, list(a)))
            return await fn(s, sql, a)
        return _inner

    for owner in (mock_pool, mock_pool.acquire.return_value):
        owner.fetchval = AsyncMock(side_effect=_logged(_fetchval))
        owner.fetchrow = AsyncMock(side_effect=_logged(_fetchrow))
        owner.fetch = AsyncMock(side_effect=_logged(_fetch))
        owner.execute = AsyncMock(side_effect=_logged(_execute))
    mock_pool.call_log = log
    return mock_pool


def _queries(mock_pool) -> list[tuple[str, list]]:
    """Every statement the handler issued, pool and connection alike, normalised
    to one line, IN THE ORDER THEY WERE ACTUALLY MADE. See `_wire`."""
    return list(mock_pool.call_log)


def _one(mock_pool, needle: str) -> tuple[str, list]:
    hits = [(s, a) for s, a in _queries(mock_pool) if needle in s]
    assert hits, f"no statement containing {needle!r} was issued"
    return hits[-1]


def _none(mock_pool, needle: str) -> None:
    hits = [s for s, _ in _queries(mock_pool) if needle in s]
    assert not hits, f"a statement containing {needle!r} was issued:\n" + "\n".join(hits)


# ════════════════════════════════════════════════════════════════════════════
# 0 · ONE VOCABULARY, FOUR FILES
# ════════════════════════════════════════════════════════════════════════════

def test_the_tone_list_is_eight_distinct_keys_and_not_hexes():
    """Eight because proposal 09 says eight — "past eight, adjacent hues stop
    being distinguishable at 22px and the colour stops being a navigation aid".

    And KEYS, never hexes: this product has two themes, module.css declares every
    tone twice in opposite temperatures, and a stored hex can only be right in
    one of them. A `#` anywhere in this tuple is the whole design mistake.
    """
    assert len(CHANNEL_TONES) == 8, CHANNEL_TONES
    assert len(set(CHANNEL_TONES)) == 8, "a tone is listed twice"
    for tone in CHANNEL_TONES:
        assert not tone.startswith("#"), f"{tone!r} is a hex, not a tone key"
        assert re.fullmatch(r"[a-z]+", tone), f"{tone!r} is not a module tone id"


def test_every_tone_key_names_a_module_tone_declared_in_both_themes():
    """The key IS the CSS variable: `color = 'graha'` renders `var(--m-graha)`.

    A key module.css does not declare resolves to nothing and paints the channel
    tile in whatever it inherits — an invisible row, with no error anywhere. And
    it has to be in BOTH blocks: a tone declared only in the light block is a
    channel that vanishes when somebody switches to dark, which is a bug nobody
    reports because it only exists for half the users.
    """
    css = MODULE_CSS.read_text(encoding="utf-8")
    light = css.split('[data-theme="dark"]')[0]
    dark = css.split('[data-theme="dark"]', 1)[1]
    for tone in CHANNEL_TONES:
        assert f"--m-{tone}:" in light, f"--m-{tone} is not declared for light"
        assert f"--m-{tone}:" in dark, f"--m-{tone} is not declared for dark"


def test_the_migration_adds_one_nullable_text_column_and_never_makes_it_required():
    """NOT NULL here would paint every DM and would make "nobody chose" and
    "somebody chose the first tone" the same value — which is what makes both the
    file and its backfill replayable. A DEFAULT does the same damage.
    """
    sql = _sql(MIGRATION.read_text(encoding="utf-8"))
    add = re.search(
        r"ALTER TABLE staging\.samvada_channels\s+ADD COLUMN IF NOT EXISTS\s+"
        r"color\s+TEXT\s*;", sql,
    )
    assert add, "the migration does not add a nullable TEXT column named `color`"
    assert "SET NOT NULL" not in sql.upper(), "the column is made required later"
    assert not re.search(r"color\s+TEXT[^;]*DEFAULT", sql), (
        "the column carries a DEFAULT, which paints every DM"
    )


def test_the_migration_check_constrains_the_column_to_exactly_these_tones():
    """The last place a bad tone can still be refused.

    Without it a typo lands in the row and renders as `var(--m-typo)`: an
    invisible channel that still occupies a rail row. There is no runtime error
    to catch it and no way to tell it apart from an uncoloured channel.
    """
    sql = _sql(MIGRATION.read_text(encoding="utf-8"))
    check = re.search(
        r"ADD CONSTRAINT samvada_channels_color_ck\s+CHECK\s*\((.*?)\)\s*;",
        sql, re.S,
    )
    assert check, "migration 100 does not constrain the colour vocabulary"
    body = check.group(1)
    assert "color IS NULL" in body, (
        "the CHECK refuses NULL, which every DM legitimately holds"
    )
    assert _quoted(body) == list(CHANNEL_TONES), (
        f"the CHECK and routers/messaging.CHANNEL_TONES disagree:\n"
        f"  CHECK  {_quoted(body)}\n  PYTHON {list(CHANNEL_TONES)}"
    )


def test_the_migration_backfills_by_rotation_and_not_with_one_colour():
    """A backfill of `SET color = 'graha'` satisfies "no row is left NULL" and
    defeats the entire feature: the rail would be one colour, which is what it
    already is. This is the assertion that stops the cheap version shipping.
    """
    sql = _sql(MIGRATION.read_text(encoding="utf-8"))
    array = re.search(r"ARRAY\[(.*?)\]::text\[\]", sql, re.S)
    assert array, "the backfill has no tone array"
    assert _quoted(array.group(1)) == list(CHANNEL_TONES), (
        f"the backfill array and CHANNEL_TONES disagree:\n"
        f"  SQL    {_quoted(array.group(1))}\n  PYTHON {list(CHANNEL_TONES)}"
    )
    assert re.search(r"row_number\(\)\s+OVER\s*\(\s*PARTITION BY org_id", sql), (
        "the backfill does not number channels per org, so the rotation either "
        "does not rotate or runs across tenants"
    )
    assert "%" in sql, "the backfill never wraps, so channel nine gets nothing"
    assert not re.search(r"SET\s+color\s*=\s*'", sql), (
        "the backfill assigns a literal colour to every row"
    )


def test_the_migration_leaves_dms_and_already_coloured_rows_alone():
    """`type <> 'dm'` is C3 — a DM has no glyph tile to colour, and painting them
    spends the eight-tone rotation on rows nobody sees it on.

    `color IS NULL` is what makes re-running the file the documented fix for
    channels created during a deploy-first window: a colour somebody has edited
    is never renumbered.
    """
    sql = _sql(MIGRATION.read_text(encoding="utf-8"))
    update = sql[sql.index("WITH tones"):sql.index("ADD CONSTRAINT")]
    assert "type <> 'dm'" in update, "the backfill paints DMs"
    assert "color IS NULL" in update, (
        "the backfill overwrites colours that were already chosen"
    )


def test_the_migration_destroys_nothing():
    """Additive only. A DROP or a DELETE in a file whose whole claim is that it
    is safe to apply under running code is the one thing review must catch."""
    sql = _sql(MIGRATION.read_text(encoding="utf-8")).upper()
    for verb in ("DROP TABLE", "DROP COLUMN", "DROP CONSTRAINT", "DELETE FROM",
                 "TRUNCATE"):
        assert verb not in sql, f"migration 100 contains {verb}"


def test_the_migration_spells_the_table_the_way_the_database_does():
    """The trap this repository has already paid for once: the TABLES are
    `samvada_*` and the MODULE CODE is `sanvaad`. A migration against
    `sanvaad_channels` fails on a table name that looks correct to a reader."""
    sql = _sql(MIGRATION.read_text(encoding="utf-8"))
    assert "staging.samvada_channels" in sql
    assert "sanvaad_channels" not in sql


# ════════════════════════════════════════════════════════════════════════════
# 1 · THE ROTATION ITSELF
#
# Pure, so it is provable. Everything else in this module runs against a mocked
# pool that cannot execute SQL, which is exactly why this rule does not live in
# a query.
# ════════════════════════════════════════════════════════════════════════════

def test_the_first_eight_channels_get_eight_different_colours():
    """The owner's sentence, tested. "A different colour per channel" is the
    whole feature, and it is the thing random assignment does NOT give: over
    eight tones the birthday problem puts a collision at roughly 60% by the sixth
    channel, and a rail with two identical rooms in it is a rail you still read
    rather than scan.
    """
    live: list[str] = []
    for _ in range(len(CHANNEL_TONES)):
        tone = pick_channel_tone(Counter(live))
        assert tone not in live, (
            f"colour {tone!r} was issued twice inside the first eight: {live}"
        )
        live.append(tone)
    assert set(live) == set(CHANNEL_TONES)
    assert live == list(CHANNEL_TONES), (
        "the first eight do not follow the design's declared order"
    )


def test_past_eight_the_rotation_repeats_evenly_rather_than_piling_up():
    """Repetition is unavoidable past eight. Clustering is not: sixteen channels
    must be two of each, not four of one."""
    live: list[str] = []
    for _ in range(len(CHANNEL_TONES) * 2):
        live.append(pick_channel_tone(Counter(live)))
    counts = Counter(live)
    assert set(counts) == set(CHANNEL_TONES)
    assert set(counts.values()) == {2}, f"uneven spread across sixteen: {counts}"


def test_a_deleted_channels_colour_comes_back_and_a_live_one_does_not():
    """THE CASE A NAIVE `COUNT(*) % 8` GETS WRONG, and it gets it wrong in the
    direction nobody checks.

    Six channels exist, holding tones one to six. The second is deleted. A count
    of the surviving rows is five, so `5 % 8` points at the SIXTH tone — which is
    still on the rail — while the freed second tone sits unused. The colour that
    reappears is the one you can still see.
    """
    live = list(CHANNEL_TONES[:6])
    freed = live.pop(1)

    tone = pick_channel_tone(Counter(live))
    assert tone == freed, (
        f"the freed colour {freed!r} was not reissued; got {tone!r}"
    )
    assert tone not in live, (
        f"{tone!r} is still on the rail — this is the collision the rotation exists "
        f"to prevent"
    )


def test_no_colour_on_the_rail_is_ever_reissued_while_a_tone_is_free():
    """The invariant, over a long walk of creates and deletes rather than one
    example. Any rule that passes the three cases above by coincidence — a
    modulo, a hash, a sequence counter — fails somewhere in here.

    Seeded, so a failure is reproducible rather than a story about a flake.
    """
    rng = random.Random(20260805)
    live: list[str] = []
    for step in range(500):
        if live and rng.random() < 0.35:
            live.pop(rng.randrange(len(live)))

        tone = pick_channel_tone(Counter(live))
        if len(live) < len(CHANNEL_TONES):
            assert tone not in live, (
                f"step {step}: {tone!r} was issued while still on a rail of "
                f"{len(live)} channels — {sorted(live)}"
            )
        live.append(tone)

        # And the spread never drifts: with every tone counted, the most-used and
        # the least-used can differ by at most one. A rule that reissued freed
        # colours but stopped balancing would pass the line above and fail here.
        counts = Counter({t: 0 for t in CHANNEL_TONES})
        counts.update(live)
        assert max(counts.values()) - min(counts.values()) <= 1, (
            f"step {step}: the rotation has drifted out of balance: {counts}"
        )


def test_a_retired_tone_still_held_by_live_rows_is_ignored_rather_than_reissued():
    """Counts come from the database, and the database holds whatever previous
    versions of this list wrote. A key no longer in `CHANNEL_TONES` must neither
    be handed out again nor crash the lookup."""
    tone = pick_channel_tone({"a_tone_that_was_retired": 99, CHANNEL_TONES[0]: 1})
    assert tone == CHANNEL_TONES[1], (
        "an unknown key in the counts changed which tone was issued"
    )


def test_an_empty_org_gets_the_first_tone():
    """The first channel a firm ever creates. No counts, no rows, no surprises."""
    assert pick_channel_tone({}) == CHANNEL_TONES[0]


# ════════════════════════════════════════════════════════════════════════════
# 2 · CREATION
# ════════════════════════════════════════════════════════════════════════════

async def test_creating_a_channel_assigns_a_tone_and_binds_it_as_a_parameter(
    api_client, as_member, with_org_id, mock_pool,
):
    """The colour is assigned, not asked for — the owner said "it gets assinged".

    `$6`, not the tone interpolated into the statement. The column LIST is built
    conditionally because the column may not exist yet; the VALUE never is.
    """
    _wire(mock_pool, tones_in_use=[("graha", 1), ("ganit", 1)])
    r = await api_client.post(f"{API}/channels", json={"name": "new-room"})
    assert r.status_code == 201, r.text

    sql, args = _one(mock_pool, "INSERT INTO staging.samvada_channels")
    assert re.search(r"created_by\s*,\s*color\s*\)", sql), (
        f"the INSERT does not name the colour column:\n{sql}"
    )
    assert "$6" in sql, f"the tone is not a bound parameter:\n{sql}"
    assert args[-1] == "manav", (
        f"expected the first free tone after graha and ganit; got {args[-1]!r}"
    )


async def test_creation_locks_the_org_before_it_reads_which_tones_are_in_use(
    api_client, as_member, with_org_id, mock_pool,
):
    """ORDER IS THE CORRECTNESS ARGUMENT. Two admins pressing "New channel" in
    the same second would otherwise both read the same in-use set under READ
    COMMITTED and both pick the same tone — the collision the rotation exists to
    prevent, arrived at from the other direction.

    The lock has to come FIRST. Taken after the read it serialises nothing.
    """
    _wire(mock_pool)
    r = await api_client.post(f"{API}/channels", json={"name": "new-room"})
    assert r.status_code == 201, r.text

    statements = [s for s, _ in _queries(mock_pool)]
    lock = next((i for i, s in enumerate(statements)
                 if "pg_advisory_xact_lock" in s), None)
    read = next((i for i, s in enumerate(statements)
                 if "SELECT color, COUNT(*)" in s), None)
    insert = next((i for i, s in enumerate(statements)
                   if s.startswith("INSERT INTO staging.samvada_channels")), None)
    assert lock is not None, "channel creation takes no tone lock"
    assert read is not None and insert is not None
    assert lock < read < insert, (
        f"lock/read/insert ran in the wrong order: {lock}, {read}, {insert}"
    )

    lock_sql, lock_args = _one(mock_pool, "pg_advisory_xact_lock")
    assert TEST_ORG_ID in lock_args, "the lock is not scoped to the caller's org"
    assert "pg_advisory_lock(" not in lock_sql, (
        "a SESSION advisory lock is wrong on a transaction-mode pooler — see D4"
    )


async def test_the_in_use_count_is_this_orgs_own_named_channels_only(
    api_client, as_member, with_org_id, mock_pool,
):
    """Three predicates, three different failures.

    Without `org_id` the rotation is global and one busy tenant exhausts every
    other tenant's palette. Without `type <> 'dm'` the tones are spent on tiles
    nobody can see. Archived channels are deliberately NOT excluded: they are
    still listed and `update_channel` can bring one back at any moment, so
    excluding them would let a new channel take an archived one's tone and
    produce a duplicate the instant somebody unarchived it.
    """
    _wire(mock_pool)
    r = await api_client.post(f"{API}/channels", json={"name": "new-room"})
    assert r.status_code == 201, r.text

    sql, args = _one(mock_pool, "SELECT color, COUNT(*)")
    assert "org_id = $1::uuid" in sql, f"the in-use count is not org-scoped:\n{sql}"
    assert TEST_ORG_ID in args
    assert "type <> 'dm'" in sql, f"DMs are counted against the rotation:\n{sql}"
    assert "is_archived" not in sql, (
        "archived channels are excluded from the count, so unarchiving one can "
        "produce a duplicate colour days later"
    )


async def test_creation_still_works_and_names_no_column_before_the_migration(
    api_client, as_member, with_org_id, mock_pool,
):
    """Migrations here are applied BY HAND, so there is always a window in which
    this code is deployed and 100 is not. Creating a channel must not fail in it
    — a hand-applied migration is not a reason a firm cannot open a room."""
    _wire(mock_pool, migration_applied=False, created={"id": CHANNEL_ID,
                                                       "type": "public",
                                                       "name": "new-room"})
    r = await api_client.post(f"{API}/channels", json={"name": "new-room"})
    assert r.status_code == 201, r.text

    sql, _ = _one(mock_pool, "INSERT INTO staging.samvada_channels")
    assert "color" not in sql, (
        f"the INSERT names a column that does not exist yet:\n{sql}"
    )
    _none(mock_pool, "pg_advisory_xact_lock")
    assert r.json()["color"] is None, (
        "a colourless channel must answer null, not omit the key — a client that "
        "spreads the row would read `undefined`"
    )


async def test_a_dm_is_never_given_a_colour(
    api_client, as_member, with_org_id, mock_pool,
):
    """C3. A DM renders as the other person, not as a `#glyph` — there is no tile
    to colour, and assigning one would spend the rotation on rows nobody sees it
    on: an org with nine DMs would have every NAMED channel colliding while eight
    tones sat invisible in private conversations.
    """
    # `existing_dm=None` so the handler takes the CREATE arm rather than
    # answering with a conversation that already exists.
    _wire(mock_pool, existing_dm=None,
          created={"id": CHANNEL_ID, "type": "dm", "name": ""})
    r = await api_client.post(f"{API}/dm", params={"target_user_id": SOMEBODY_ELSE})
    assert r.status_code == 200, r.text

    sql, _ = _one(mock_pool, "INSERT INTO staging.samvada_channels")
    assert "color" not in sql, f"the DM insert assigns a tone:\n{sql}"
    _none(mock_pool, "SELECT color, COUNT(*)")
    assert r.json()["color"] is None


# ════════════════════════════════════════════════════════════════════════════
# 3 · EDITING, AND WHAT IS REFUSED
# ════════════════════════════════════════════════════════════════════════════

async def test_a_known_tone_is_accepted_and_written(
    api_client, as_member, with_org_id, mock_pool,
):
    """Stored beats derived, and this is the half a hash could never do: the
    colour is editable because it is a column."""
    _wire(mock_pool, updated={"id": CHANNEL_ID, "type": "public",
                              "name": "general", "color": "vetana"})
    r = await api_client.patch(f"{API}/channels/{CHANNEL_ID}",
                               json={"color": "vetana"})
    assert r.status_code == 200, r.text
    assert r.json()["color"] == "vetana"

    sql, args = _one(mock_pool, "UPDATE staging.samvada_channels")
    assert re.search(r"color=\$\d+", sql), f"the colour was not written:\n{sql}"
    assert "vetana" in args


@pytest.mark.parametrize("bad", [
    "#8E4A86",          # the design mistake this whole column exists to prevent
    "purple",
    "m-graha",
    "GRAHA",
    "sahayak",           # a real module tone, but not one of the eight
    "",
])
async def test_an_unknown_tone_is_refused_and_nothing_is_written(
    api_client, as_member, with_org_id, mock_pool, bad,
):
    """400, and NO UPDATE.

    `samvada_channels_color_ck` would refuse these anyway — but the caller would
    get a 500 carrying a constraint name, and if the CHECK were ever dropped the
    value would land and render as `var(--m-purple)`, which resolves to nothing:
    an invisible channel that still occupies a row in the rail, with no error
    anywhere. The hex case is the one worth naming: it is what a colour picker
    hands you if nobody stops it, and it can only ever be right in one theme.

    400 rather than 404 because this is a BODY field — the rule `_valid_uuid`
    records for this module, where a PATH segment answers 404 and a body field
    answers 400 and says what was wrong with it.
    """
    _wire(mock_pool)
    r = await api_client.patch(f"{API}/channels/{CHANNEL_ID}", json={"color": bad})
    assert r.status_code == 400, r.text
    assert "colour" in r.text.lower(), r.text
    _none(mock_pool, "UPDATE staging.samvada_channels")


async def test_editing_a_colour_before_the_migration_says_so_instead_of_pretending(
    api_client, as_member, with_org_id, mock_pool,
):
    """The one place this feature refuses to degrade quietly.

    `_parity_ready` draws the line and this handler is on the loud side of it:
    reads degrade silently, but "a click that fails should fail loudly". The
    alternative — dropping the field and answering 200 with the row — is a
    product that loses the user's edit and tells them it saved.
    """
    _wire(mock_pool, migration_applied=False)
    r = await api_client.patch(f"{API}/channels/{CHANNEL_ID}",
                               json={"color": "vetana"})
    assert r.status_code == 503, r.text
    assert "100_channel_colour" in r.text, (
        "the refusal does not name the migration that fixes it"
    )
    _none(mock_pool, "UPDATE staging.samvada_channels")


async def test_renaming_a_channel_does_not_touch_the_colour_column(
    api_client, as_member, with_org_id, mock_pool,
):
    """A PATCH that does not mention the colour must not name the column — which
    is also what keeps every rename working while migration 100 is outstanding.
    """
    _wire(mock_pool, migration_applied=False,
          updated={"id": CHANNEL_ID, "type": "public", "name": "renamed"})
    r = await api_client.patch(f"{API}/channels/{CHANNEL_ID}",
                               json={"name": "renamed"})
    assert r.status_code == 200, r.text

    sql, _ = _one(mock_pool, "UPDATE staging.samvada_channels")
    assert "color" not in sql, f"an unrelated rename wrote the colour:\n{sql}"


# ════════════════════════════════════════════════════════════════════════════
# 4 · THE KEY IS ALWAYS THERE
# ════════════════════════════════════════════════════════════════════════════

async def test_the_rail_carries_a_colour_key_even_before_the_migration(
    api_client, as_member, with_org_id, mock_pool,
):
    """`list_channels` selects `c.*`, so before migration 100 the key is simply
    ABSENT from the row — and a client that spreads it into a style reads
    `undefined`, which is not a colour and is not null either. The same reasoning
    `list_channels` already carries for `mention_count`: "a row missing a key the
    client spreads into a badge renders `undefined`, not zero."
    """
    _wire(mock_pool, migration_applied=False, listed=[
        {"id": CHANNEL_ID, "name": "general", "type": "public"},
        {"id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "name": "gst", "type": "public"},
    ])
    r = await api_client.get(f"{API}/channels")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2
    for row in body:
        assert "color" in row, f"a rail row has no colour key at all: {row}"
        assert row["color"] is None
