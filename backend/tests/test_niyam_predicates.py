"""Time triggers: the queries, their windows, and the promise they must keep.

A predicate is the only kind of event with no user action behind it, which makes
it the easiest to get quietly wrong: nothing fails, nothing is written, and a
rule waits for an event that never comes.
"""
from __future__ import annotations

import datetime as _dt
import re

import pytest

from services.niyam import predicates as P
from services.niyam.registry import REGISTRY, fields_for

NOW = _dt.datetime(2026, 8, 16, 12, 0, tzinfo=_dt.timezone.utc)


def _strip(sql: str) -> str:
    return "\n".join(line.split("--")[0] for line in sql.splitlines())


def _top_level_from(sql: str) -> int:
    """Index of the FROM that ends the SELECT list.

    Depth-aware, because `EXTRACT(DAY FROM NOW() - t.due_at)` contains a FROM
    inside parentheses — and taking the first one truncates the SELECT list, so
    every computed column after it vanishes. That is what a naive version of
    this helper did, and it reported three predicates as missing fields they
    were in fact returning.
    """
    depth = 0
    for m in re.finditer(r"[()]|\bFROM\b", sql, re.IGNORECASE):
        tok = m.group(0)
        if tok == "(":
            depth += 1
        elif tok == ")":
            depth -= 1
        elif depth == 0:
            return m.start()
    raise AssertionError("no top-level FROM")


def _aliases(sql: str) -> set:
    """Output column names of the SELECT list, respecting nesting and comments."""
    stripped = _strip(sql)
    body = stripped[stripped.upper().index("SELECT") + 6: _top_level_from(stripped)]

    depth, item, items = 0, "", []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            items.append(item)
            item = ""
        else:
            item += ch
    items.append(item)

    out = set()
    for it in items:
        it = " ".join(it.split())
        if not it:
            continue
        m = re.search(r"\bAS\s+([A-Za-z_]\w*)$", it, re.IGNORECASE)
        out.add((m.group(1) if m else it.split(".")[-1]).lower())
    return out


# ── the promise the registry makes ───────────────────────────────────────────

@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_every_registry_field_is_actually_returned(pred):
    """THE test in this file.

    If the registry advertises a field the query does not return, the builder
    offers a condition that can never be evaluated — the same defect as reading
    a column that does not exist, reached from the other direction, and just as
    invisible: the rule saves, evaluates, and reports `failed` for ever.

    It caught a real one on the way in. `task.overdue` inherits the full task
    field list, and the first draft of `tasks_overdue` returned eight of the
    twelve — `column_id`, `category_id`, `assignee_count` and `approval_status`
    were all offerable and all unanswerable.
    """
    promised = {f.key for f in fields_for(pred.event_type)}
    returned = _aliases(pred.sql)
    missing = sorted(promised - returned)
    assert not missing, (
        f"`{pred.event_type}` advertises {missing} but `{pred.name}`'s query "
        f"does not return them. A rule conditioned on one can never fire.")


@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_every_predicate_has_a_registry_entry(pred):
    """A predicate whose event type nobody can write a rule against is a query
    that runs on a timer and produces rows nothing reads."""
    assert pred.event_type in REGISTRY
    assert fields_for(pred.event_type)


@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_every_predicate_returns_the_envelope(pred):
    a = _aliases(pred.sql)
    assert "org_id" in a, "an event with no org has no tenant"
    assert "entity_id" in a, "an event about nothing in particular"


# ── the bounds, which are the whole safety story ─────────────────────────────

@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_every_predicate_is_bounded_three_ways(pred):
    """Ordered, limited, and with a lookback.

    `reminder_service`'s scan has none of the three, which is why one tick could
    re-create its entire backlog. 160 tasks are overdue on this database today;
    the lookback is what makes the first tick emit for the recent ones instead
    of for every deadline missed since the product launched.
    """
    up = " ".join(pred.sql.split()).upper()
    assert "ORDER BY" in up, "unordered means the ceiling cuts arbitrarily"
    assert "LIMIT $2::INT" in up, "a ceiling, and a CAST one"
    assert "$1::INT" in up, "the lookback must be bound and cast"
    assert pred.max_age_days > 0


@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_every_predicate_names_its_schema(pred):
    """`search_path` is best-effort under PgBouncer, and thirteen tables once
    existed in both schemas because of it. See migration 142."""
    stripped = _strip(pred.sql)
    sql = stripped[_top_level_from(stripped):]
    # `[\w.]*` — the identifier must be captured WITH its dots, or the pattern
    # stops at the schema separator and then tests `public` for a dot.
    for m in re.finditer(r"\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)", sql, re.IGNORECASE):
        assert "." in m.group(1), \
            f"{pred.name}: `{m.group(1)}` is not schema-qualified"


@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_no_predicate_writes(pred):
    """A predicate ASKS. The only writer of anything here is the emitter, and
    the only thing it writes is an event."""
    up = pred.sql.upper()
    for verb in ("INSERT", "UPDATE ", "DELETE", "DROP ", "ALTER "):
        assert verb not in up, f"{pred.name} contains {verb}"


# ── windows ──────────────────────────────────────────────────────────────────

def test_once_fires_one_event_per_entity():
    pred = P.BY_NAME["tasks_overdue"]
    assert pred.window == "once"
    a = P._dedupe(pred, "task_1", NOW)
    b = P._dedupe(pred, "task_1", NOW + _dt.timedelta(days=400))
    assert a == b, "a task becoming overdue is one fact, not a daily one"


def test_weekly_changes_with_the_iso_week_and_not_with_the_day():
    pred = P.BY_NAME["approvals_pending"]
    assert pred.window == "weekly"
    # A WEDNESDAY, deliberately. NOW is 2026-08-16, a Sunday, and +1 day from a
    # Sunday genuinely IS the next ISO week — the first version of this test
    # asserted the calendar was wrong rather than the code.
    wed = _dt.datetime(2026, 8, 19, 12, 0, tzinfo=_dt.timezone.utc)
    assert P._dedupe(pred, "a1", wed) == P._dedupe(pred, "a1", wed + _dt.timedelta(days=1))
    assert P._dedupe(pred, "a1", wed) != P._dedupe(pred, "a1", wed + _dt.timedelta(days=8))


def test_two_entities_never_share_a_key():
    pred = P.BY_NAME["tasks_overdue"]
    assert P._dedupe(pred, "task_1", NOW) != P._dedupe(pred, "task_2", NOW)


def test_the_key_is_namespaced_by_predicate():
    """Two predicates on the same entity must not silence each other."""
    keys = {P._dedupe(p, "x", NOW) for p in P.PREDICATES}
    assert len(keys) == len(P.PREDICATES)


@pytest.mark.parametrize("pred", P.PREDICATES, ids=lambda p: p.name)
def test_the_window_is_one_of_three(pred):
    assert pred.window in ("once", "daily", "weekly")


# ── payload rendering ────────────────────────────────────────────────────────

def test_datetimes_are_rendered_not_dropped():
    """`_clean` DROPS a value it cannot serialise, silently and with no log
    line — so a datetime that reaches it becomes a key that is simply absent."""
    row = {"org_id": "o", "entity_id": "e", "due_at": NOW, "days_overdue": 3}
    out = P._payload(row)
    assert out["due_at"] == NOW.isoformat()
    assert "org_id" not in out and "entity_id" not in out
    assert out["days_overdue"] == 3


def test_a_temporal_event_carries_no_actor():
    """Nobody made the task overdue. Inventing an actor is exactly the lie the
    column exists to prevent — and the CHECK would accept it, because actor_id
    is only mandatory for `app` events."""
    import inspect
    from services.niyam import subjects
    src = inspect.getsource(subjects.temporal)
    assert "actor_id=None" in src
    assert 'source="sweep"' in src


def test_the_named_allowlist_is_the_only_way_in():
    """A rule author picks a predicate by NAME and never writes SQL. Same
    server-side-allowlist rule CLAUDE.md mandates for dynamic identifiers,
    applied to whole queries."""
    assert set(P.BY_NAME) == {p.name for p in P.PREDICATES}
    assert P.BY_NAME.get("'; DROP TABLE tasks; --") is None
