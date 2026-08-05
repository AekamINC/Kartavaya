"""Sanvaad @mentions: the resolver, the fan-out, and the names it uses.

Three separate things are pinned here, and they fail in three different ways in
production:

1. **The schema check** (first section). `services/samvaad_mentions.py` runs
   INSIDE the send path — `POST /channels/{id}/messages` awaits it before it
   returns — so a column name that does not exist does not break mentions, it
   breaks **sending a message at all**, with an opaque 500. This is the fourth
   time in this programme that a Python-side name Postgres does not have has
   shipped (`graha_contacts.type`, `vikray_targets.salesperson_id`,
   `bank_statement_lines.batch_id`, the pahchan `$2::date`), and every one of
   them looked exactly like "the feature has not been used yet". Written in the
   style of `tests/test_prachar_audience.py`, which caught that class last week.

2. **The muted rule.** Muting means "do not interrupt me", not "hide this from
   me". If the row is skipped along with the notification, the mention badge and
   the mentions feed silently lose an entry that a colleague believes they sent
   you by name. If the notification is sent anyway, muting does nothing.

3. **Editing.** An edit that re-notifies is worse than one that under-notifies:
   the recipient gets a second push for a message they already read, and the
   badge counts a thing that happened once as though it happened twice.

The pool is mocked, so — exactly as `routers/messaging.py:30-41` warns — green
here proves nothing about whether a join resolves against the real catalogue.
That is precisely why section 1 exists: it checks the NAMES against the
migration and the verified schema rather than against a mock that will answer
any question you ask it.
"""
import asyncio
import pathlib
import re

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
SERVICE = BACKEND / "services" / "samvaad_mentions.py"
ROUTER = BACKEND / "routers" / "messaging.py"
MIGRATION = BACKEND / "migrations" / "093_sanvaad_slack_parity.sql"


# ════════════════════════════════════════════════════════════════════════════
# 1 · The names. Every table and column this feature writes must be real.
# ════════════════════════════════════════════════════════════════════════════
#
# From migration 093 (as reviewed) plus the verified live schema. Update this
# map when a migration adds a column — that edit is the point at which somebody
# has to notice that the code and the database disagree.

CATALOGUE: dict[str, set[str]] = {
    "samvada_mentions": {
        "id", "org_id", "channel_id", "message_id", "mentioned_user_id",
        "kind", "created_at", "read_at",
    },
    "samvada_typing": {"channel_id", "user_id", "updated_at"},
    "samvada_presence": {"org_id", "user_id", "last_seen_at", "status"},
    "samvada_channels": {
        "id", "org_id", "name", "description", "type", "created_by",
        "is_archived", "created_at", "updated_at",
        "color",   # migration 100 — the stored channel tone key
    },
    "samvada_channel_members": {
        "id", "channel_id", "user_id", "role", "joined_at", "last_read_at",
        "muted",
    },
    "samvada_messages": {
        "id", "org_id", "channel_id", "sender_id", "content", "type",
        "parent_message_id", "metadata", "is_edited", "is_deleted",
        "created_at", "updated_at", "pinned_at", "pinned_by", "search_tsv",
    },
    "samvada_message_reactions": {"id", "message_id", "user_id", "emoji", "created_at"},
    "samvada_read_receipts": {"message_id", "user_id", "read_at"},
    # public.notifications — written WITHOUT a schema prefix, like every other
    # writer in this codebase, because the pool's search_path is "staging, public".
    "notifications": {
        "notification_id", "user_id", "team_id", "type", "title", "message",
        "task_id", "url", "created_at", "read_at", "metadata",
    },
}

#: Relations in `staging` this feature is allowed to name. Anything else is
#: either a typo or a table nobody has created.
KNOWN_STAGING_RELATIONS = set(CATALOGUE) | {
    "user_roles", "org_member_modules", "org_module_approvers",
    "samvada_message_attachments",   # exists; explicitly OUT OF SCOPE, see below
}


def _sources() -> dict[str, str]:
    """The two Python files that speak SQL for this feature."""
    out = {}
    for path in (SERVICE, ROUTER):
        assert path.exists(), f"{path} does not exist yet"
        out[path.name] = path.read_text(encoding="utf-8")
    return out


def _strip_comments(text: str) -> str:
    """Prose out, SQL in.

    Python comments and docstrings legitimately DISCUSS wrong names — the
    banner at the top of `routers/messaging.py` says `staging.users` eleven
    times explaining why it must never appear again, and `test_prachar_audience`
    failed on its own docstring the first time it ran.

    A naive `\"\"\"(.|\\n)*?\"\"\"` sweep is worse than useless here, because
    the triple-quoted strings in these files alternate between docstrings and
    SQL: pairing them off in order deletes every query and leaves half the
    prose. So the docstrings are located with `ast` and blanked by line, and
    every other string literal — every query — survives.
    """
    import ast

    lines = text.splitlines()
    try:
        tree = ast.parse(text)
    except SyntaxError:                       # pragma: no cover — a broken file
        tree = None
    if tree is not None:
        for node in ast.walk(tree):
            if not isinstance(
                node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
            ):
                continue
            body = getattr(node, "body", None)
            if not body:
                continue
            first = body[0]
            if (
                isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)
            ):
                for ln in range(first.lineno - 1, first.end_lineno):
                    lines[ln] = ""
    return "\n".join(
        line for line in lines if not line.lstrip().startswith("#")
    )


def _balanced(text: str, open_idx: int) -> str:
    """The contents of the parenthesised group starting at `open_idx`.

    A naive `\\(([^)]*)\\)` stops at the first `)`, which in this feature means
    it stops inside `now()`, `gen_random_uuid()` and `$1::uuid` casts — and then
    silently checks half a column list.
    """
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1:i]
    return ""


def _inserts(code: str) -> list[tuple[str, list[str], str]]:
    """Every `INSERT INTO <table> (cols)` → (table, columns, tail-after-cols)."""
    out = []
    for m in re.finditer(r"INSERT\s+INTO\s+(?:staging\.)?(\w+)\s*\(", code, re.I):
        table = m.group(1)
        inner = _balanced(code, m.end() - 1)
        cols = [c.strip().strip('"') for c in inner.split(",") if c.strip()]
        out.append((table, cols, code[m.end():m.end() + 600]))
    return out


def test_migration_093_exists_and_creates_the_objects_the_code_will_use():
    """No migration, no tables — and the send path 500s on the first mention.

    B1 writes this file to disk and nobody applies it automatically; there is no
    runner in the app. This test is the record of what has to be applied by hand
    before the feature is deployed.
    """
    assert MIGRATION.exists(), (
        "backend/migrations/093_sanvaad_slack_parity.sql is missing. Every "
        "mention, pin, typing ping and search in this feature writes or reads "
        "an object this migration creates."
    )
    sql = MIGRATION.read_text(encoding="utf-8")
    for needed in (
        "staging.samvada_mentions",
        "staging.samvada_typing",
        "staging.samvada_presence",
        "pinned_at",
        "pinned_by",
        "search_tsv",
    ):
        assert needed in sql, f"093 does not create/add {needed}"
    assert "samvada_mentions_uniq" in sql, (
        "the UNIQUE (message_id, mentioned_user_id) constraint is gone — "
        "without it a person mentioned by name AND by @channel gets two rows "
        "and two notifications for one message"
    )
    assert "gen_random_uuid()" in sql


def test_migration_093_indexes_the_search_column_with_the_simple_config():
    """`english` stemming mangles Devanagari and makes Hindi terms unsearchable.

    The product is bilingual. A tsvector built with the English configuration
    stems and stop-words its way through Devanagari and produces tokens that
    never match what a Hindi-speaking user types. The generated column and the
    query in `GET /search` must agree, and they must both be 'simple'.
    """
    raw = MIGRATION.read_text(encoding="utf-8")
    # The migration's own comment explains WHY it is not 'english', so the
    # comment contains the word. Strip `--` lines or this test asserts against
    # the reasoning for the thing it is checking.
    sql = "\n".join(
        line.split("--")[0] for line in raw.splitlines()
    )
    assert "to_tsvector('simple'" in sql
    assert "'english'" not in sql, (
        "093 uses the English text-search configuration; the column must be "
        "'simple' or every Hindi search returns nothing"
    )


def test_every_staging_relation_this_feature_names_is_one_that_exists():
    """A misspelt table is an UndefinedTableError on the send path, not a
    mention that quietly does not fire."""
    for name, code in _sources().items():
        for rel in set(re.findall(r"\bstaging\.(\w+)", _strip_comments(code))):
            assert rel in KNOWN_STAGING_RELATIONS, (
                f"{name} names staging.{rel}, which is not a relation this "
                f"feature has. Check it against the live catalogue — a mocked "
                f"cursor will resolve any name you give it."
            )


def test_every_inserted_column_exists_on_the_table_it_is_inserted_into():
    """The `graha_contacts.type` bug, generalised.

    An INSERT naming a column the table does not have raises
    UndefinedColumnError before a single row is written. Inside
    `fan_out_mentions` that failure propagates — deliberately, because a message
    that silently notifies nobody is the exact defect
    `renderMentions.test.jsx` was written about — so it takes the whole send
    with it.
    """
    for name, code in _sources().items():
        for table, cols, _tail in _inserts(_strip_comments(code)):
            known = CATALOGUE.get(table)
            if known is None:
                pytest.fail(
                    f"{name} inserts into `{table}`, which is not in this "
                    f"test's catalogue. If the table is new, add it here with "
                    f"its real columns; if it is a typo, that is the bug."
                )
            unknown = set(cols) - known
            assert not unknown, (
                f"{name}: INSERT INTO {table} names {sorted(unknown)}, which "
                f"{table} does not have"
            )


def test_no_on_conflict_target_names_a_column_that_does_not_exist():
    """`ON CONFLICT (message_id, mentioned_user_id)` has to match the real
    unique constraint or the insert raises InvalidColumnReference — and the
    duplicate-suppression that keeps one notification per person per message
    never runs."""
    for name, code in _sources().items():
        clean = _strip_comments(code)
        for m in re.finditer(r"ON\s+CONFLICT\s*\(", clean, re.I):
            cols = [c.strip() for c in _balanced(clean, m.end() - 1).split(",") if c.strip()]
            # Which table this conflict clause belongs to: the nearest INSERT
            # INTO above it.
            before = clean[:m.start()]
            owner = re.findall(r"INSERT\s+INTO\s+(?:staging\.)?(\w+)", before, re.I)
            if not owner:
                continue
            known = CATALOGUE.get(owner[-1], set())
            unknown = set(cols) - known
            assert not unknown, (
                f"{name}: ON CONFLICT on {owner[-1]} names {sorted(unknown)}"
            )


def test_no_update_sets_a_column_that_does_not_exist():
    """`SET read_at = now()` is right; `SET is_read = TRUE` is a 500.

    `POST /channels/{id}/read` clears mention badges by stamping `read_at`. The
    column is a timestamptz, and there is no boolean anywhere in this feature.
    """
    for name, code in _sources().items():
        clean = _strip_comments(code)
        for m in re.finditer(
            r"UPDATE\s+(?:staging\.)?(\w+)\s+SET\s+(.*?)(?:\sWHERE\s|\sRETURNING\s|\"\"\"|'''|\")",
            clean, re.I | re.S,
        ):
            table = m.group(1)
            known = CATALOGUE.get(table)
            if known is None:
                continue          # not one of ours (module grants, etc.)
            targets = {
                t for t in re.findall(r"(\w+)\s*=", m.group(2))
                # `EXCLUDED.x` and `f"{field}=${idx}"` interpolations are not
                # literal column names; skip anything we cannot read as one.
                if not t.isdigit()
            }
            unknown = targets - known - {"EXCLUDED", "idx", "field"}
            assert not unknown, (
                f"{name}: UPDATE {table} SET names {sorted(unknown)}"
            )


def test_the_names_that_read_right_and_are_wrong_stay_out():
    """Each of these has already cost this codebase a production 500 or a
    deliberate scoping decision, and each of them is the name you would reach
    for if you were guessing."""
    banned = {
        # `routers/messaging.py:5-41`: to_regclass('staging.users') is NULL.
        # This exact name made every read endpoint in the router 500 while the
        # whole suite was green.
        r"staging\.users": "public.users is unqualified; staging.users does not exist",
        r"u\.avatar_url\b": "the column is `avatar`; `AS avatar_url` is the wire name",
        # samvada_mentions.read_at is a timestamptz.
        r"\bis_read\b": "the mention row records read_at, not a boolean",
        # MentionTextarea's shape, which this module deliberately does not reuse.
        r"\bdisplay_name\b": "Sanvaad's directory returns full_name, not display_name",
        # File attachments are excluded from this work by the owner.
        r"samvada_message_attachments": "attachments are out of scope for this feature",
        r"\blast_seen\b(?!_at)": "the presence column is last_seen_at",
    }
    for name, code in _sources().items():
        clean = _strip_comments(code)
        for pattern, why in banned.items():
            assert not re.search(pattern, clean), f"{name}: {why}"


def test_the_mention_service_does_not_import_a_router():
    """Importing `routers.search` for `build_tsquery` drags in the whole router
    graph and creates an import cycle that fails at process start, not at call
    time — so it takes the API down rather than one endpoint."""
    code = _strip_comments(SERVICE.read_text(encoding="utf-8"))
    assert not re.search(r"^\s*(from|import)\s+routers", code, re.M), (
        "samvaad_mentions.py imports from routers/; build_tsquery must be a "
        "copy of search.py's logic, not an import"
    )


def test_a_sanvaad_mention_sends_no_email():
    """`email_service.send_mention_email` builds a task deep link out of a
    task_id. There is no task here, so it would put a broken link in a real
    inbox. Sanvaad mentions are in-app plus push only."""
    code = _strip_comments(SERVICE.read_text(encoding="utf-8"))
    assert "send_mention_email" not in code
    assert "email_service" not in code


# ════════════════════════════════════════════════════════════════════════════
# 2 · build_tsquery — a pure function, no app, no DB
# ════════════════════════════════════════════════════════════════════════════

def _build_tsquery():
    from services.samvaad_mentions import build_tsquery
    return build_tsquery


def test_build_tsquery_keeps_devanagari_matras():
    """`str.isalnum()` alone deletes them, and the deletion is silent.

    Devanagari matras are Unicode `Mn`/`Mc` combining marks, so
    `"".join(c for c in "राकेश" if c.isalnum())` is `रकश` — a word that is not
    the word and does not prefix-match the stored one. Bilingual search would
    look implemented and return nothing for every Indic name typed in Devanagari.
    """
    build_tsquery = _build_tsquery()
    assert build_tsquery("राकेश") == "राकेश:*"
    naive = "".join(c for c in "राकेश" if c.isalnum())
    assert naive != "राकेश", "the premise of this test no longer holds"


def test_build_tsquery_is_a_prefix_query_joined_with_and():
    build_tsquery = _build_tsquery()
    assert build_tsquery("raakesh nag") == "raakesh:* & nag:*"


def test_build_tsquery_returns_empty_for_an_input_with_no_word_in_it():
    """`to_tsquery('simple', '')` is fine, but `to_tsquery('simple', ':*')` is a
    syntax error that 500s the search endpoint. The caller must skip the
    tsquery arm when this returns ''."""
    build_tsquery = _build_tsquery()
    assert build_tsquery("!!!") == ""
    assert build_tsquery("   ") == ""


def test_build_tsquery_drops_the_tsquery_operators():
    """These are a correctness guard, not the injection defence — the result is
    always a bind parameter (see test_samvaad_search_and_pins). But a stray `&`
    or `:` still makes `to_tsquery` throw, which is a 500 on a search box."""
    build_tsquery = _build_tsquery()
    out = build_tsquery("a&b|c!d(e)f:g*h<i>j")
    for op in "&|!():*<>":
        assert f"{op}" not in out.replace(":*", ""), f"{op!r} survived into {out!r}"


# ════════════════════════════════════════════════════════════════════════════
# 3 · A fake pool that answers by SQL shape, not by call order
# ════════════════════════════════════════════════════════════════════════════
#
# DELIBERATELY NOT a side-effect list. `test_messaging_security.py` orders
# `fetchrow` side effects to match each handler's exact sequence, and the spec
# for this work records that adding one query to `send_message` breaks every one
# of those tests. These tests assert OUTCOMES — which rows were written, which
# notifications went out — so they survive B1 reordering its own queries, and
# they fail only when the behaviour changes.

ORG = "00000000-0000-0000-0000-000000000001"
CHANNEL = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
MESSAGE = "11111111-2222-3333-4444-555555555555"

ACTOR = "user_anita01"
ACTOR_NAME = "Anita Desai"


def member(uid: str, display: str, *, muted: bool = False, role: str = "member") -> dict:
    """One channel member, carrying every key any plausible SELECT would alias.

    asyncpg Records are subscriptable and dict()-able; a plain dict is both, so
    the resolver can read `r["display"]` or `r["full_name"]` without this fake
    having to guess which alias B1 chose.
    """
    return {
        "user_id": uid,
        "email": f"{uid}@test.example",
        "display": display,
        "full_name": display,
        "name": display,
        "role": role,
        "muted": muted,
        "avatar": None,
        "status": "online",
    }


class FakePool:
    def __init__(
        self, *,
        members: list[dict],
        actor_id: str = ACTOR,
        actor_name: str = ACTOR_NAME,
        channel_name: str = "accounts",
        channel_type: str = "public",
        online: list[dict] | None = None,
        existing: tuple[str, ...] = (),
        sender_role: str = "member",
        member_count: int | None = None,
    ):
        self.members = list(members)
        self.by_id = {m["user_id"]: m for m in self.members}
        self.actor_id = actor_id
        self.actor_name = actor_name
        self.channel_name = channel_name
        self.channel_type = channel_type
        self.online = list(self.members) if online is None else list(online)
        self.existing = set(existing)
        self.sender_role = sender_role
        self.member_count = len(self.members) if member_count is None else member_count
        #: Ordered log of everything that happened, SQL and pushes together, so
        #: "the row is written BEFORE the push is fired" is assertable.
        self.timeline: list[tuple] = []

    # ── recording ──────────────────────────────────────────────
    def _log(self, sql, args):
        self.timeline.append(("sql", " ".join(str(sql).split()), list(args)))

    def statements(self) -> list[tuple[str, list]]:
        return [(s, a) for kind, s, a in self.timeline if kind == "sql"]

    def writes_to(self, table: str) -> list[tuple[str, list]]:
        pat = re.compile(rf"INSERT\s+INTO\s+(?:staging\.)?{table}\b", re.I)
        return [(s, a) for s, a in self.statements() if pat.search(s)]

    # ── the API asyncpg exposes ────────────────────────────────
    async def fetch(self, sql, *args):
        self._log(sql, args)
        s = " ".join(str(sql).split()).lower()
        if s.lstrip().startswith(("insert", "update", "delete")):
            # `INSERT … ON CONFLICT DO NOTHING … RETURNING mentioned_user_id` is
            # not decoration: it is how "an edit must never re-notify" is made
            # race-free — Postgres returns only the rows it actually inserted.
            # A fake that returns [] there would make every edit look silent and
            # every first send look like a duplicate, so the UNIQUE
            # (message_id, mentioned_user_id) constraint is emulated here.
            if "samvada_mentions" in s and "returning" in s:
                uids = next(
                    (a for a in args
                     if isinstance(a, (list, tuple))
                     and all(isinstance(x, str) for x in a)),
                    [],
                )
                return [{"mentioned_user_id": u} for u in uids
                        if u not in self.existing]
            return []
        if "samvada_mentions" in s:
            return [{"mentioned_user_id": u} for u in self.existing]
        if "samvada_presence" in s:
            return list(self.online)
        if "samvada_channel_members" in s or "user_roles" in s:
            return list(self.members)
        return []

    async def fetchrow(self, sql, *args):
        self._log(sql, args)
        s = " ".join(str(sql).split()).lower()
        if s.lstrip().startswith(("insert", "update", "delete")):
            return None
        if "samvada_channels" in s:
            return {
                "id": CHANNEL, "org_id": ORG,
                "name": self.channel_name, "type": self.channel_type,
            }
        if "samvada_channel_members" in s and "role" in s:
            return {"role": self.sender_role}
        if "from users" in s:
            return self._user(args)
        return None

    async def fetchval(self, sql, *args):
        self._log(sql, args)
        s = " ".join(str(sql).split()).lower()
        if "count(" in s and "samvada_channel_members" in s:
            return self.member_count
        if "samvada_channel_members" in s and "role" in s:
            return self.sender_role
        if "from users" in s:
            u = self._user(args)
            return u["display"] if u else None
        if "samvada_channels" in s:
            return self.channel_name
        return None

    async def execute(self, sql, *args):
        self._log(sql, args)
        return "INSERT 0 1"

    async def executemany(self, sql, arglist):
        self._log(sql, [a for row in arglist for a in row])
        return None

    def _user(self, args):
        """Resolve either a user_id (the actor lookup) or a hand-typed handle."""
        if not args:
            return None
        needle = str(args[0]).lower()
        if needle == self.actor_id.lower():
            return {
                "user_id": self.actor_id, "email": f"{self.actor_id}@test.example",
                "display": self.actor_name, "full_name": self.actor_name,
                "name": self.actor_name,
            }
        if needle in self.by_id:
            return self.by_id[needle]
        for m in self.members:
            if needle in {str(m["email"]).lower(), str(m["name"]).lower(),
                          str(m["full_name"]).lower()}:
                return m
        return None

    # ── `async with pool.acquire() as conn` funnels back to us ──
    def acquire(self):
        return self

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def push_log(monkeypatch):
    """Record every push, synchronously, at the moment it is CALLED.

    An `async def` stub would record only when awaited, and `mentions.py` fires
    push through `asyncio.ensure_future(...)` — the body may not run before the
    test ends. A plain function that records and hands back an already-made
    coroutine works whether the caller awaits it or schedules it.
    """
    log: list[str] = []

    def _stub(*args, **kwargs):
        recipient = kwargs.get("recipient_id")
        if recipient is None and len(args) > 1:
            recipient = args[1]
        log.append(recipient)

        async def _noop():
            return None
        return _noop()

    import services.push_service as ps
    monkeypatch.setattr(ps, "send_push", _stub)
    # Also patch the name in the service's own namespace, in case B1 binds it at
    # import time rather than inside the function.
    import services.samvaad_mentions as sm
    monkeypatch.setattr(sm, "send_push", _stub, raising=False)
    return log


async def _fan_out(pool, **over):
    from services.samvaad_mentions import fan_out_mentions
    kwargs = dict(
        org_id=ORG, channel_id=CHANNEL, message_id=MESSAGE,
        actor_id=ACTOR, content="", is_edit=False,
    )
    kwargs.update(over)
    await fan_out_mentions(pool, **kwargs)
    # Anything the implementation scheduled with ensure_future gets a chance to
    # run before we assert; without this a legitimately-fired push can look
    # like a push that never happened.
    await asyncio.sleep(0)


async def _resolve(pool, content: str, **over):
    from services.samvaad_mentions import resolve_mentions
    kwargs = dict(
        org_id=ORG, channel_id=CHANNEL, content=content,
        actor_id=ACTOR, sender_is_channel_admin=False,
    )
    kwargs.update(over)
    return await resolve_mentions(pool, **kwargs)


def _flat(args) -> list:
    out = []
    for a in args:
        if isinstance(a, (list, tuple, set)):
            out.extend(a)
        else:
            out.append(a)
    return out


def _notified(pool: FakePool) -> set:
    """Every user id that appears in the args of a notifications INSERT."""
    ids = set()
    for _sql, args in pool.writes_to("notifications"):
        ids |= {a for a in _flat(args) if isinstance(a, str)}
    return ids


def _mention_rows(pool: FakePool) -> set:
    ids = set()
    for _sql, args in pool.writes_to("samvada_mentions"):
        ids |= {a for a in _flat(args) if isinstance(a, str)}
    return ids


# ════════════════════════════════════════════════════════════════════════════
# 4 · resolve_mentions
# ════════════════════════════════════════════════════════════════════════════

BELA = member("user_bela01", "Bela Rao")
CHETAN = member("user_chetan1", "Chetan Iyer")


async def test_a_two_word_display_name_resolves():
    """The bug `services/mentions.py` was rewritten to fix, ported wrong.

    The composer inserts `@Bela Rao ` — the full display name with a space. A
    single-token regex captures only `Bela` and an exact-match lookup on
    email/name/full_name never matches `Bela Rao`. Every mention of every user
    whose display name has a space — which is nearly all of them — resolved to
    nobody, silently, at both ends.
    """
    pool = FakePool(members=[BELA, CHETAN])
    out = await _resolve(pool, "@Bela Rao can you check this")
    assert dict(out).get(BELA["user_id"]) == "user", out


async def test_a_self_mention_resolves_to_nobody():
    """Notifying yourself for typing your own name is noise, and it inflates the
    mention badge on a message you are looking at."""
    pool = FakePool(members=[BELA, member(ACTOR, ACTOR_NAME)])
    out = await _resolve(pool, f"@{ACTOR_NAME} reminding myself")
    assert ACTOR not in dict(out), out


async def test_channel_from_a_non_admin_on_a_large_channel_reaches_nobody():
    """Anyone being able to page 200 people is how a workspace learns to mute
    everything. Above 15 members a non-admin's @channel resolves to zero
    recipients and the message still posts — no error, no partial notify."""
    many = [member(f"user_x{i:03d}", f"Person {i:03d}") for i in range(20)]
    pool = FakePool(members=many, member_count=20, sender_role="member")
    out = await _resolve(pool, "@channel standup in five", sender_is_channel_admin=False)
    assert out == [], f"a non-admin paged {len(out)} people on a 20-member channel"


async def test_channel_from_a_non_admin_on_a_small_channel_reaches_everyone_else():
    """The other half of the rule. A feature nobody can use in a small team is
    not a middle ground, it is a removal."""
    few = [member(f"user_y{i:02d}", f"Person {i:02d}") for i in range(10)]
    pool = FakePool(members=few, member_count=10, sender_role="member")
    out = await _resolve(pool, "@channel standup in five", sender_is_channel_admin=False)
    got = dict(out)
    assert len(got) == 10, got
    assert set(got.values()) == {"channel"}
    assert ACTOR not in got, "@channel notified its own sender"


async def test_channel_from_a_channel_admin_reaches_everyone_however_large():
    many = [member(f"user_z{i:03d}", f"Person {i:03d}") for i in range(40)]
    pool = FakePool(members=many, member_count=40, sender_role="admin")
    out = await _resolve(pool, "@channel all hands", sender_is_channel_admin=True)
    assert len(out) == 40


async def test_here_reaches_only_the_people_who_are_actually_online():
    """@here that behaves like @channel is @channel, and the distinction is the
    only reason a busy channel is bearable."""
    away = member("user_away01", "Dev Away")
    pool = FakePool(
        members=[BELA, CHETAN, away],
        member_count=3,
        online=[BELA],           # only Bela has a fresh, status='online' row
    )
    out = dict(await _resolve(pool, "standup now @here"))
    assert out == {BELA["user_id"]: "here"}, out


async def test_here_with_nobody_online_reaches_nobody():
    """Correct, and must not be "fixed" by falling back to @channel — that turns
    a considerate broadcast into the one it was chosen over."""
    pool = FakePool(members=[BELA, CHETAN], member_count=2, online=[])
    assert await _resolve(pool, "@here anyone about?") == []


async def test_a_named_mention_keeps_kind_user_alongside_a_broadcast():
    """`UNIQUE (message_id, mentioned_user_id)` allows exactly one row per
    person per message. If the broadcast is inserted first, the person addressed
    by name is flattened to kind='channel' and their mentions feed stops saying
    that somebody actually meant them."""
    pool = FakePool(members=[BELA, CHETAN], member_count=2, sender_role="admin")
    out = dict(await _resolve(
        pool, "@channel please review — @Bela Rao you especially",
        sender_is_channel_admin=True,
    ))
    assert out.get(BELA["user_id"]) == "user", out


async def test_at_channels_and_an_email_address_do_not_broadcast():
    """`@channels` is a plural noun and `an@here.com` is an address. Both would
    page the room if the token guard is a naive substring test."""
    many = [member(f"user_w{i:02d}", f"Person {i:02d}") for i in range(10)]
    pool = FakePool(members=many, member_count=10)
    assert await _resolve(pool, "we have three @channels now") == []
    assert await _resolve(pool, "write to an@here.com instead") == []


# ════════════════════════════════════════════════════════════════════════════
# 5 · fan_out_mentions
# ════════════════════════════════════════════════════════════════════════════

async def test_a_muted_channel_records_the_row_and_sends_no_notification(push_log):
    """Mute means "do not interrupt me", not "hide this from me".

    The `samvada_mentions` row is what drives the in-app badge and the mentions
    feed. Skipping it along with the notification loses the fact that a
    colleague addressed you by name — they can see they typed it, you never
    learn it happened, and neither of you can tell which.
    """
    pool = FakePool(members=[member(BELA["user_id"], "Bela Rao", muted=True)],
                    member_count=1)
    await _fan_out(pool, content="@Bela Rao when you get a moment")

    assert BELA["user_id"] in _mention_rows(pool), (
        "a muted channel dropped the mention row; the badge and the mentions "
        "feed will never show it"
    )
    assert BELA["user_id"] not in _notified(pool), (
        "a muted channel still wrote a notification row — mute does nothing"
    )
    assert BELA["user_id"] not in push_log, "a muted channel still buzzed a device"


async def test_an_unmuted_recipient_gets_the_row_the_notification_and_the_push(push_log):
    """And in that order.

    `services/push_service.py`'s docstring and `test_quiet_hours_parity.py` pin
    it: `send_push` writes no notification row, and quiet hours suppress the
    device, never the record. Firing push first and then failing to write the
    row leaves a buzz with nothing behind it in the inbox.
    """
    pool = FakePool(members=[BELA], member_count=1)
    await _fan_out(pool, content="@Bela Rao when you get a moment")

    assert BELA["user_id"] in _mention_rows(pool)
    assert BELA["user_id"] in _notified(pool)
    assert BELA["user_id"] in push_log, "no push for an unmuted mention"

    stmts = pool.statements()
    row_at = next(i for i, (s, a) in enumerate(stmts)
                  if re.search(r"INSERT\s+INTO\s+(?:staging\.)?samvada_mentions", s, re.I))
    notif_at = next(i for i, (s, a) in enumerate(stmts)
                    if re.search(r"INSERT\s+INTO\s+notifications", s, re.I))
    assert row_at < notif_at, "the notification was written before the mention row"


async def test_a_self_mention_writes_nothing_and_notifies_nobody(push_log):
    pool = FakePool(members=[member(ACTOR, ACTOR_NAME), BELA], member_count=2)
    await _fan_out(pool, content=f"@{ACTOR_NAME} note to self")

    assert ACTOR not in _mention_rows(pool)
    assert ACTOR not in _notified(pool)
    assert push_log == []


async def test_an_edit_notifies_only_the_newly_named(push_log):
    """An edit can create a mention. It must never re-create one.

    Re-notifying retracts nothing and adds a second push for a message the
    recipient has already read; the badge then counts one event twice. Rows for
    a name REMOVED by the edit are left in place on purpose — deleting them
    would decrement a badge for something that genuinely happened.
    """
    pool = FakePool(
        members=[BELA, CHETAN], member_count=2,
        existing=(BELA["user_id"],),          # Bela was mentioned by the original
    )
    await _fan_out(
        pool, is_edit=True,
        content="@Bela Rao and @Chetan Iyer — both of you now",
    )

    assert CHETAN["user_id"] in _notified(pool), "the newly named person was not notified"
    assert BELA["user_id"] not in _notified(pool), (
        "editing a message re-notified somebody who was already mentioned in it"
    )
    assert push_log == [CHETAN["user_id"]], push_log


async def test_resaving_identical_text_notifies_nobody(push_log):
    """The commonest edit is a typo fix. It must be silent."""
    pool = FakePool(members=[BELA], member_count=1, existing=(BELA["user_id"],))
    await _fan_out(pool, is_edit=True, content="@Bela Rao when you get a moment")
    assert BELA["user_id"] not in _notified(pool)
    assert push_log == []


async def test_nothing_is_queried_when_the_message_has_no_at_sign():
    """This runs inside every single send. Three queries per message on the
    99% of messages that mention nobody is a cost with no reader."""
    pool = FakePool(members=[BELA], member_count=1)
    await _fan_out(pool, content="deployed to staging, all green")
    assert pool.statements() == [], (
        f"fan_out_mentions ran {len(pool.statements())} queries for a message "
        f"with no '@' in it"
    )


# ── The notification row shape · the three traps ─────────────────────────────

def _split_top(text: str) -> list[str]:
    """Split on commas that are not inside parentheses.

    `unnest($3::text[], $4::text[], $5::text[])` is one expression, not three.
    """
    out, depth, cur = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    tail = "".join(cur).strip()
    if tail:
        out.append(tail)
    return [c for c in out if c]


def _notification_bindings(pool: FakePool) -> list[dict]:
    """Column → bound value (or inline literal) for each notifications INSERT.

    Handles both `INSERT … VALUES (…)` and `INSERT … SELECT … FROM unnest(…)`.
    The set-returning form is the one that matters: fanning `@channel` out on a
    large channel one round trip per member, on the send path, while the sender
    watches their own message not appear, is the reason it exists.
    """
    out = []
    for sql, args in pool.writes_to("notifications"):
        m = re.search(r"INSERT\s+INTO\s+notifications\s*\(", sql, re.I)
        open_idx = m.end() - 1
        inner = _balanced(sql, open_idx)
        cols = _split_top(inner)
        after = sql[open_idx + len(inner) + 2:]

        vm = re.search(r"\bVALUES\s*\(", after, re.I)
        if vm:
            vals = _split_top(_balanced(after, vm.end() - 1))
        else:
            sm = re.search(r"\bSELECT\b", after, re.I)
            assert sm, f"notifications INSERT has neither VALUES nor SELECT: {sql}"
            rest = after[sm.end():]
            fm = re.search(r"\bFROM\b", rest, re.I)
            vals = _split_top(rest[:fm.start()] if fm else rest)

        row = {}
        for col, val in zip(cols, vals):
            pm = re.fullmatch(r"\$(\d+)(?:::\w+)?", val)
            row[col] = args[int(pm.group(1)) - 1] if pm else val.strip("'")
        out.append(row)
    return out


async def test_the_mention_notification_carries_a_null_task_id(push_log):
    """`InboxPage.jsx:59` reads
    `if (n.task_id) setDrawerTaskId(n.task_id); else if (n.url) navigate(n.url)`.

    A non-null task_id therefore opens an EMPTY TASK DRAWER instead of taking
    the user to the message, and the message id in `url` is never read. The
    notification arrives, is clicked, and goes nowhere.
    """
    pool = FakePool(members=[BELA], member_count=1)
    await _fan_out(pool, content="@Bela Rao look at this")
    rows = _notification_bindings(pool)
    assert rows, "no notifications row was written for an unmuted mention"
    for row in rows:
        assert row.get("task_id") in (None, "NULL"), (
            f"task_id={row.get('task_id')!r} — the inbox will open an empty "
            f"task drawer instead of the message"
        )


async def test_the_mention_notification_deep_links_to_the_message(push_log):
    """`NotificationsModal.jsx:105` navigates `url` through react-router, and
    `ChannelsTab` reads `?channel=` and `?message=`. Any other shape is a
    notification that cannot be acted on."""
    pool = FakePool(members=[BELA], member_count=1)
    await _fan_out(pool, content="@Bela Rao look at this")
    urls = [r.get("url") for r in _notification_bindings(pool)]
    assert urls, "no notifications row was written"
    for url in urls:
        assert re.fullmatch(r"/sanvaad\?channel=[^&]+&message=.+", str(url)), (
            f"url={url!r} does not match /sanvaad?channel=<id>&message=<id>"
        )
        assert CHANNEL in str(url) and MESSAGE in str(url)


async def test_the_mention_notification_reuses_the_existing_mention_kind(push_log):
    """`notifKinds.js` maps exactly eight kinds and its banner forbids a ninth,
    because a kind with no row in the preferences table is a kind the user
    cannot switch off. `mention` already exists, already has an icon and a
    colour, and already feeds the Mentions tab — a `sanvaad_mention` would
    render as the neutral dot and be filtered out of every tab."""
    pool = FakePool(members=[BELA], member_count=1)
    await _fan_out(pool, content="@Bela Rao look at this")
    kinds = {str(r.get("type")) for r in _notification_bindings(pool)}
    assert kinds == {"mention"}, kinds


# ════════════════════════════════════════════════════════════════════════════
# 6 · The mention feed and the badge · through the router
# ════════════════════════════════════════════════════════════════════════════
#
# `samvada_mentions` rows are quoted message bodies keyed to a channel. The feed
# and the mark-read call are the two places a caller hands the server an id and
# gets rows back, so they are the two places a missing owner predicate turns a
# guessed uuid into somebody else's conversation.

from unittest.mock import AsyncMock                          # noqa: E402
from conftest import TEST_ORG_ID                             # noqa: E402

FEED_CHANNEL = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
FEED_MENTION = "22222222-3333-4444-5555-666666666666"


@pytest.fixture(autouse=True)
def _bypass_module_gate(app):
    """Reach and the write-verb gate belong to `test_module_write_level.py`.
    Leaving them on here would make every 403 below ambiguous between "wrong
    level" and "no subscription"."""
    from routers.messaging import _gate
    app.dependency_overrides[_gate] = lambda: None
    yield
    app.dependency_overrides.pop(_gate, None)


@pytest.fixture(autouse=True)
def _migration_applied():
    """`_parity_ready` caches its catalogue probe at MODULE scope, forever — so
    one test answering it from the mock's default `fetchval` of `0` would put
    every later test in the process on the degraded pre-093 path, and the
    failures would land nowhere near the cause."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(True)
    yield
    _reset_parity_cache(None)


def _router_queries(mock_pool) -> list[tuple[str, list]]:
    out = []
    conn = mock_pool.acquire.return_value
    for owner in (mock_pool, conn):
        for name in ("execute", "fetch", "fetchrow", "fetchval"):
            m = getattr(owner, name, None)
            for call in getattr(m, "call_args_list", []) or []:
                if call.args and isinstance(call.args[0], str):
                    out.append((" ".join(call.args[0].split()), list(call.args[1:])))
    return out


def _feed_query(mock_pool) -> tuple[str, list]:
    hits = [(s, a) for s, a in _router_queries(mock_pool)
            if "FROM staging.samvada_mentions mn" in s]
    assert hits, "no mentions feed query was issued"
    return hits[-1]


def test_the_mention_routes_are_registered():
    """A crisp failure when they are absent, rather than two 404s that read like
    a routing typo."""
    from routers.messaging import router
    registered = {
        (r.path, verb) for r in router.routes for verb in getattr(r, "methods", set())
    }
    assert ("/api/v1/messaging/mentions", "GET") in registered
    assert ("/api/v1/messaging/mentions/read", "POST") in registered


async def test_the_mentions_feed_is_scoped_to_the_caller_and_to_their_org(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """Two predicates, and the second is not redundant.

    `mentioned_user_id` alone would find the rows — but a mention row joins to
    the message body of whatever channel it came from, and the org filter is what
    makes a row written under the wrong tenant unreadable rather than merely
    unlikely. Dropping either one turns a guessed or leaked id into somebody
    else's conversation.
    """
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/messaging/mentions")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list), "the inbox consumes this as a bare array"

    sql, args = _feed_query(mock_pool)
    assert "mn.org_id = $1::uuid" in sql
    assert "mn.mentioned_user_id = $2" in sql
    assert TEST_ORG_ID in args and member_user["user_id"] in args


async def test_the_mentions_feed_never_shows_a_deleted_message(
    api_client, as_member, with_org_id, mock_pool
):
    """The mention row survives the message being deleted — deliberately, so the
    badge does not decrement for something that genuinely happened. The BODY must
    not."""
    mock_pool.fetch = AsyncMock(return_value=[])
    await api_client.get("/api/v1/messaging/mentions")
    sql, _ = _feed_query(mock_pool)
    assert "m.is_deleted = FALSE" in sql


async def test_the_mentions_cursor_carries_a_tiebreaker(
    api_client, as_member, with_org_id, mock_pool
):
    """`fan_out_mentions` inserts one row per recipient in a SINGLE statement, so
    a `@channel` batch shares `created_at` to the microsecond. Ordering on that
    column alone leaves the order within a batch undefined, and a cursor sitting
    mid-batch drops or repeats its neighbours on the next page.

    `GET /channels/{id}/messages` has exactly that bug with its naked
    `created_at <`, which is the whole reason this assertion exists — that arm
    must not be copied into new code.
    """
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get(
        "/api/v1/messaging/mentions", params={"before": FEED_MENTION}
    )
    assert r.status_code == 200, r.text
    sql, args = _feed_query(mock_pool)
    assert "(mn.created_at, mn.id) <" in sql, (
        f"the cursor is not a keyset with a tiebreaker:\n{sql}"
    )
    assert "ORDER BY mn.created_at DESC, mn.id DESC" in sql
    # The cursor subquery is scoped to the caller's own rows, so a guessed
    # foreign id resolves to NULL and the page comes back empty rather than
    # confirming that the id exists.
    assert "AND mentioned_user_id = $2" in sql
    assert FEED_MENTION in args


async def test_marking_mentions_read_refuses_both_shapes_at_once(
    api_client, as_member, with_org_id, mock_pool
):
    """"ids AND mark_all" has two plausible readings. Guessing which one the
    caller meant is how a badge ends up cleared for a channel nobody opened."""
    r = await api_client.post(
        "/api/v1/messaging/mentions/read",
        json={"mention_ids": [FEED_MENTION], "mark_all": True},
    )
    assert r.status_code == 400


async def test_marking_mentions_read_cannot_clear_somebody_elses_badge(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """A uuid supplied by a caller is a caller-supplied identifier, and "the id
    is unguessable" is not an access rule. Without the owner predicate a leaked
    or logged mention id lets anyone mark somebody else's mention read — and the
    victim never learns they were named."""
    mock_pool.execute = AsyncMock(return_value="UPDATE 1")
    r = await api_client.post(
        "/api/v1/messaging/mentions/read", json={"mention_ids": [FEED_MENTION]}
    )
    assert r.status_code == 200, r.text
    hits = [(s, a) for s, a in _router_queries(mock_pool)
            if "UPDATE staging.samvada_mentions" in s]
    assert hits, "nothing was updated"
    sql, args = hits[-1]
    assert "org_id=$1::uuid" in sql and "mentioned_user_id=$2" in sql
    assert TEST_ORG_ID in args and member_user["user_id"] in args


async def test_a_malformed_mention_id_does_not_take_the_call_down(
    api_client, as_member, with_org_id, mock_pool
):
    """`$3::uuid[]` on a list containing junk raises asyncpg's `DataError`, which
    is a 500 for what is plainly a bad request — and the badge then never clears,
    because the good ids in the same list were never marked either."""
    mock_pool.execute = AsyncMock(return_value="UPDATE 1")
    r = await api_client.post(
        "/api/v1/messaging/mentions/read",
        json={"mention_ids": ["not-a-uuid", FEED_MENTION]},
    )
    assert r.status_code == 200, r.text
    sql, args = [(s, a) for s, a in _router_queries(mock_pool)
                 if "UPDATE staging.samvada_mentions" in s][-1]
    assert [FEED_MENTION] in args, (
        "the well-formed id was dropped along with the malformed one"
    )


async def test_mark_all_can_be_scoped_to_one_channel(
    api_client, as_member, with_org_id, mock_pool
):
    mock_pool.execute = AsyncMock(return_value="UPDATE 3")
    r = await api_client.post(
        "/api/v1/messaging/mentions/read",
        json={"mark_all": True, "channel_id": FEED_CHANNEL},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "updated": 3}
    sql, args = [(s, a) for s, a in _router_queries(mock_pool)
                 if "UPDATE staging.samvada_mentions" in s][-1]
    assert "channel_id = $3::uuid" in sql
    assert FEED_CHANNEL in args


async def test_opening_a_channel_clears_its_mention_badge(
    api_client, as_member, with_org_id, mock_pool, member_user
):
    """This is why the mention badge needs no new frontend call.

    `useChannelMessages` already fires `POST /channels/{id}/read` on channel open
    and on window focus. Clearing only `last_read_at` there would leave the user
    staring at an `@2` on the channel they are currently reading, with no call
    that would ever clear it.

    Both statements or neither — one transaction — or the unread count clears
    and the mention badge does not.
    """
    conn = mock_pool.acquire.return_value
    conn.execute = AsyncMock(return_value="UPDATE 1")
    r = await api_client.post(f"/api/v1/messaging/channels/{FEED_CHANNEL}/read")
    assert r.status_code == 200, r.text

    statements = [s for s, _ in _router_queries(mock_pool)]
    assert any("UPDATE staging.samvada_channel_members SET last_read_at" in s
               for s in statements), "the unread count was not cleared"
    mention_writes = [(s, a) for s, a in _router_queries(mock_pool)
                      if "UPDATE staging.samvada_mentions" in s]
    assert mention_writes, "opening the channel left the mention badge lit"
    sql, args = mention_writes[-1]
    assert "read_at = now()" in sql and "read_at IS NULL" in sql
    assert "mentioned_user_id = $2" in sql
    assert FEED_CHANNEL in args and member_user["user_id"] in args
    assert conn.transaction.called, (
        "the two updates are not in one transaction, so the unread count can "
        "clear while the mention badge stays lit"
    )


async def test_the_mentions_feed_before_the_migration_is_empty_not_a_500(
    api_client, as_member, with_org_id, mock_pool
):
    """Migrations here are applied by hand. The inbox polls this; a 500 in the
    window between deploying and applying 093 is a permanently broken bell."""
    from routers.messaging import _reset_parity_cache
    _reset_parity_cache(False)
    mock_pool.fetch = AsyncMock(return_value=[])
    r = await api_client.get("/api/v1/messaging/mentions")
    assert r.status_code == 200
    assert r.json() == []
    assert not [s for s, _ in _router_queries(mock_pool)
                if "staging.samvada_mentions" in s]
