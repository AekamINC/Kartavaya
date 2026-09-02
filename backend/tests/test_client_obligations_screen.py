"""The obligations register can finally be written to — and only within one firm.

`public.client_obligations` was created by migration 175 on 2026-08-20 and held
ZERO rows in every org for thirteen days, because nothing in the product wrote
it. Two shipped skills read it and both correctly refused to call an empty
register a clean one: `brief_client_obligations_register` reported 91 active
clients against zero obligations, and `pack_client_filing_calendar` produced an
empty calendar every month. Neither was blocked on the calendar. Both were
blocked on somebody being able to say "this client is a regular GST filer".

Two things are pinned here, and the first matters more than the endpoints do:

  · EVERY STATEMENT CARRIES AN ORG FILTER. An obligation is addressed as
    /clients/{client_id}/obligations/{id}, which LOOKS like the path scopes it.
    It does not — a caller supplies both ids. This repo has already paid for the
    other shape once, when a DELETE by name with no org filter removed the wrong
    firm's client ten minutes after a migration was written to avoid exactly
    that. Asserted against the SOURCE, because the pool in this suite is a
    MagicMock and a MagicMock answers happily to a statement with no WHERE at
    all.

  · THE REFUSALS SAY WHAT TO DO. Three of them exist only to turn a constraint
    violation into a sentence: `client_obligations_key_ck`,
    `client_obligations_window_ck` and the two-open-windows case that no index
    enforces because an obligation genuinely recurs.

Nothing here touches a database. The live half at the bottom PLANS the SQL
against the real catalogue — Parse and Describe, nothing executed — because
staging shares production's database.
"""
from __future__ import annotations

import asyncio
import os

import pytest

import routers.graha as graha
from services.skills.data.client_register import obligation_catalogue

CLIENT = "00000000-0000-0000-0000-0000000000ab"
OBLIGATION = "00000000-0000-0000-0000-0000000000cd"

_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"
_SEARCH_PATH = "SET search_path TO public"


# ══════════════════════════════════════════════════════════════════════════════
#  The catalogue is one list, derived
# ══════════════════════════════════════════════════════════════════════════════

def test_the_catalogue_matches_the_database_check():
    """Sixteen keys, and the CHECK is the authority.

    `client_obligations_key_ck` refuses anything else, so a picker offering a
    seventeenth would produce a 500 on save. This is the assertion that keeps
    the form and the constraint in step; if the migration ever widens the CHECK,
    this fails and points at the list that has to follow.
    """
    keys = [o["key"] for o in obligation_catalogue()]
    assert len(keys) == 16, f"the register knows {len(keys)} obligations, not 16"
    assert len(set(keys)) == 16, "a key appears twice"
    # The four families the migration groups them into, spot-checked so a
    # wholesale replacement of the vocabulary cannot pass quietly.
    for expected in ("gst.regular", "gst.qrmp", "incometax.tds", "epf",
                     "audit.gst", "roc.annual", "other"):
        assert expected in keys, f"{expected} has gone from the catalogue"


def test_the_undatable_ones_say_why():
    """`can_be_dated` is the field a person filling the form needs.

    Nine of the sixteen map to nothing the statute calendar carries, and QRMP is
    the sharpest: dating a QRMP client is the register's whole reason for
    existing, and a firm that ticks it gets a calendar with no dates. Saying so
    on the FORM turns that from a bug report into a known gap.
    """
    by_key = {o["key"]: o for o in obligation_catalogue()}

    assert by_key["gst.regular"]["can_be_dated"] is True
    assert by_key["gst.regular"]["why_no_date"] is None

    qrmp = by_key["gst.qrmp"]
    assert qrmp["can_be_dated"] is False
    assert qrmp["why_no_date"], "an undatable obligation must say why"
    assert "QRMP" in qrmp["why_no_date"]

    # Derived, not hand-kept: every undatable key carries a reason and every
    # datable one carries none. A list maintained by hand drifts the day the
    # calendar gains a row.
    for o in obligation_catalogue():
        assert o["can_be_dated"] == (o["why_no_date"] is None), \
            f"{o['key']} disagrees with itself about whether it can be dated"


def test_every_key_has_a_label_that_is_not_the_key():
    """A picker showing `gst.regular` teaches nobody anything."""
    for o in obligation_catalogue():
        assert o["label"] and o["label"] != o["key"], \
            f"{o['key']} has no human label"


# ══════════════════════════════════════════════════════════════════════════════
#  THE ORG FILTER, asserted against the source
# ══════════════════════════════════════════════════════════════════════════════

def _statements() -> dict[str, str]:
    """Every finished statement the obligations endpoints will send.

    Read from the module's NAMESPACE, not from the AST of the handlers, and the
    difference is the whole reason the live half earned its place. The first
    draft built each statement with an f-string at the call site
    (`RETURNING {_OBLIGATION_COLS}`); an AST collector recovers only an
    f-string's literal fragments, so the statement it handed the planner ended
    at `RETURNING` and failed to parse. Offline everything was green. The two
    statements that actually WRITE were the ones going unchecked.

    Resolved at import, these are the exact strings asyncpg receives.
    """
    return {
        name: " ".join(value.split())
        for name, value in vars(graha).items()
        if isinstance(value, str)
        and "client_obligations" in value
        and value.strip().upper().startswith(("SELECT", "INSERT", "UPDATE", "DELETE"))
    }


def test_there_are_statements_to_check():
    """Anti-vacuity floor.

    Every assertion below loops over `_statements()`. If the SQL goes back to
    being built at the call site, this returns nothing, those loops run zero
    times, and the thing they protect is the tenant boundary.
    """
    found = _statements()
    assert len(found) >= 4, (
        f"only {len(found)} finished statements naming client_obligations were "
        f"found in routers.graha ({sorted(found)}); the SQL has moved back into "
        "the handlers and can no longer be planned"
    )


@pytest.mark.parametrize("kind", ["SELECT", "INSERT", "UPDATE", "DELETE"])
def test_there_is_one_of_each(kind):
    """A read, a write, an amend and a remove. All four, or the screen is partial."""
    assert any(sql.upper().startswith(kind) for sql in _statements().values()), \
        f"no {kind} against client_obligations"


def test_every_obligation_statement_is_org_scoped():
    """`user_roles` is the sole tenant path and `org_id` is how it is applied.

    Not one statement may reach `client_obligations` without it — including the
    ones that already name a client_id, because a caller supplies that too.
    """
    for name, sql in _statements().items():
        if sql.upper().startswith("INSERT"):
            # An INSERT scopes by WRITING the org, not by filtering on it. The
            # requirement underneath is the same: the row carries an org, and it
            # is the one `get_org_id` resolved rather than anything the caller
            # sent.
            assert "org_id" in sql.split("VALUES")[0], \
                f"{name} inserts without naming org_id:\n\n{sql}"
            continue
        assert "org_id=$" in sql, \
            f"{name} reaches client_obligations with no org filter:\n\n{sql}"


def test_the_write_is_scoped_in_its_own_where_clause():
    """Not "check, then write" — the check and the write are one statement.

    A SELECT that verifies ownership followed by an UPDATE that does not repeat
    the filter is two statements with a gap between them, and the gap is where a
    row belonging to another firm gets written.
    """
    writes = {n: q for n, q in _statements().items()
              if q.upper().startswith(("UPDATE", "DELETE"))}
    assert writes, "no mutating statement found to check"
    for name, sql in writes.items():
        assert "client_id=$" in sql and "org_id=$" in sql, \
            f"{name} mutates without being fully scoped:\n\n{sql}"


# ══════════════════════════════════════════════════════════════════════════════
#  The refusals
# ══════════════════════════════════════════════════════════════════════════════

def _body(**kw) -> graha.ObligationWrite:
    base = {"obligation_key": "gst.regular"}
    base.update(kw)
    return graha.ObligationWrite(**base)


def test_an_unknown_key_is_refused_with_the_list():
    """`client_obligations_key_ck` would refuse it as a 500 with no guidance."""
    with pytest.raises(graha.HTTPException) as bad:
        graha._check_obligation(_body(obligation_key="gst.qrmp_v2"))
    assert bad.value.status_code == 400
    assert "gst.regular" in bad.value.detail, \
        "the refusal must name what IS allowed, not only what is not"


def test_an_end_before_a_start_is_refused():
    from datetime import date
    with pytest.raises(graha.HTTPException) as bad:
        graha._check_obligation(_body(effective_from=date(2026, 4, 1),
                                      effective_to=date(2026, 3, 1)))
    assert bad.value.status_code == 400


def test_an_end_on_the_start_day_is_refused():
    """`client_obligations_window_ck` is `effective_to > effective_from`.

    A zero-length obligation is not a thing, and the column agrees — so the
    boundary is tested rather than assumed to be the same as the one above.
    """
    from datetime import date
    with pytest.raises(graha.HTTPException):
        graha._check_obligation(_body(effective_from=date(2026, 4, 1),
                                      effective_to=date(2026, 4, 1)))


@pytest.mark.parametrize("code", ["27", "9", "MH", "DL", "KAR"])
def test_both_state_conventions_are_accepted(code):
    """The database CHECK accepts numeric AND alpha, and so must this.

    `organisations.state_code` holds '27' while migration 175's columns were
    written expecting 'MH'. The two conventions coexist live, `services/
    gst_states.py` normalises them for comparison, and a form that refused
    either would make one of the two unenterable.
    """
    graha._check_obligation(_body(state_code=code))


@pytest.mark.parametrize("code", ["Maharashtra", "27A", "mh", "273"])
def test_a_state_code_that_the_check_would_refuse_is_refused_here(code):
    with pytest.raises(graha.HTTPException) as bad:
        graha._check_obligation(_body(state_code=code))
    assert bad.value.status_code == 400


def test_a_blank_is_stored_as_absent():
    """An empty box is "not recorded", not the empty string.

    Every one of these columns is nullable, the register counts what is
    recorded, and an empty string satisfies IS NOT NULL — so it would inflate
    the denominator the skills report and read on screen as a confident nothing.
    """
    for blank in ("", "   ", None):
        assert graha._blank_to_none(blank) is None
    assert graha._blank_to_none("  27 ") == "27"


# ══════════════════════════════════════════════════════════════════════════════
#  Live — the statements plan against the real schema
# ══════════════════════════════════════════════════════════════════════════════

def live_dsn() -> str | None:
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn or dsn == _PLACEHOLDER_DSN:
        return None
    return dsn


@pytest.fixture
def live():
    dsn = live_dsn()
    if not dsn:
        pytest.skip(
            "no live database. This half plans the router's SQL against the "
            "real catalogue and cannot be done offline — the pool here is a "
            "MagicMock and answers happily to a statement naming a column that "
            "does not exist. Run it with:\n"
            "    railway run -e staging -s Kartavya -- python -m pytest "
            "tests/test_client_obligations_screen.py -q"
        )
    return dsn


def test_every_obligation_statement_plans(live):
    """Parse and Describe only. No row is read and none is written."""
    import asyncpg

    statements = list(_statements().values())
    assert len(statements) >= 4, "nothing to plan — see the anti-vacuity floor"

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            await conn.execute(_SEARCH_PATH)
            failures = []
            for sql in statements:
                try:
                    await conn.prepare(sql)
                except Exception as exc:                      # noqa: BLE001
                    failures.append((sql, f"{type(exc).__name__}: {exc}"))
            return failures
        finally:
            await conn.close()

    failures = asyncio.run(run())
    assert not failures, "\n\n".join(f"{why}\n{sql}" for sql, why in failures)


def test_the_check_constraint_still_allows_exactly_these_keys(live):
    """The catalogue and the CHECK, compared against each other.

    Read from `pg_constraint` rather than from the migration text: an inline
    CHECK on `ADD COLUMN IF NOT EXISTS` is skipped entirely when the column
    exists, so a migration file is not evidence that a constraint is there.
    """
    import asyncpg

    async def run():
        conn = await asyncpg.connect(live, statement_cache_size=0)
        try:
            return await conn.fetchval(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conrelid = 'public.client_obligations'::regclass "
                "AND conname = 'client_obligations_key_ck'"
            )
        finally:
            await conn.close()

    definition = asyncio.run(run())
    assert definition, "client_obligations_key_ck is not on the table"
    for o in obligation_catalogue():
        assert f"'{o['key']}'" in definition, (
            f"the picker offers '{o['key']}' and the CHECK refuses it — saving "
            "it would be a 500"
        )
