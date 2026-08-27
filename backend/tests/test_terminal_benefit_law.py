"""Phase 5.2 — gratuity and statutory bonus are dated law now, and readable.

Migration 229 seeds seven keys that existed in no form before it: `statute_calendar`
held nothing matching gratuity or bonus, and `grep gratuity backend/` found one
file — `services/compliance_settings.py`, where gratuity is a rule a firm ticks,
not a rate anything computes.

WHAT THIS FILE IS ACTUALLY GUARDING is not the arithmetic — nothing computes
gratuity yet, because there is no full-and-final settlement path (`vetana.py`
says so in its own words). It guards the two ways these particular rows can be
MISREAD, and the promise that the F&F feature will inherit them:

  1. `gratuity.qualifying_years` is YEARS in a column every other row uses for
     rupees. A caller that assumes rupees reads five rupees.
  2. `bonus.calculation_ceiling` is a FLOOR — s.12 says ₹7,000 *or the minimum
     wage for the scheduled employment, whichever is higher* — and the second
     limb is a state-by-state figure this product does not hold.

Run the live half with:

    railway run -e staging -s Kartavya -- python -m pytest \\
        tests/test_terminal_benefit_law.py -q
"""
import asyncio
import inspect
import os

import pytest

import routers.vetana as vetana


_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

KEYS = {
    "gratuity.ceiling": ("threshold_amount", 2000000.0),
    "gratuity.qualifying_years": ("threshold_amount", 5.0),
    "gratuity.rate.per_completed_year": ("rate_percent", 57.692),
    "bonus.rate.minimum": ("rate_percent", 8.33),
    "bonus.rate.maximum": ("rate_percent", 20.0),
    "bonus.eligibility_ceiling": ("threshold_amount", 21000.0),
    "bonus.calculation_ceiling": ("threshold_amount", 7000.0),
}


def _live_dsn():
    dsn = os.environ.get("DATABASE_URL", "")
    return None if not dsn or dsn == _PLACEHOLDER_DSN else dsn


# ── Offline: the misreadings, guarded where a reader will look ───────────────

def test_the_years_trap_is_named_in_the_reader():
    src = " ".join(inspect.getsource(vetana._terminal_benefit_terms).split())
    assert "YEARS" in src, (
        "`gratuity.qualifying_years` sits in `threshold_amount`, which every "
        "other row uses for rupees. If the reader stops saying so, the next "
        "caller reads five rupees."
    )


def test_the_bonus_ceiling_is_documented_as_a_floor():
    src = " ".join(inspect.getsource(vetana._terminal_benefit_terms).split())
    assert "FLOOR, not the answer" in src, (
        "s.12 is 7,000 OR the minimum wage, whichever is higher — a reader that "
        "treats 7,000 as the answer under-computes bonus in every state whose "
        "minimum wage is higher."
    )


def test_the_reader_never_raises_on_an_unreadable_store():
    """A payroll run must not stop because the law store is unreadable — the
    same rule `_esi_ceiling` and `_epf_terms` follow."""
    src = inspect.getsource(vetana._terminal_benefit_terms)
    assert "except Exception:" in src and "return None" in src


def test_lwf_is_absent_and_that_is_deliberate():
    """Phase 5.2 names three things. Two are seeded and one is not.

    The Labour Welfare Fund is STATE law — rates, periodicity and the
    employer:employee split differ by state, and roughly fifteen states operate
    one at all. A single national row would be wrong everywhere; it needs the
    per-state ladder shape professional tax already has. This asserts nobody has
    quietly added one to satisfy a checklist.
    """
    src = inspect.getsource(vetana._terminal_benefit_terms)
    assert "lwf" not in src.lower(), (
        "an LWF term appeared in the terminal-benefit reader. LWF is state law "
        "and needs the PT ladder shape, not a key in statute_calendar."
    )


# ── Live: the rows, and what they resolve to ─────────────────────────────────

@pytest.mark.skipif(
    _live_dsn() is None,
    reason=("no live database. The authority for these figures is the row, not "
            "a copy of it in Python. Run with:\n"
            "    railway run -e staging -s Kartavya -- python -m pytest "
            "tests/test_terminal_benefit_law.py -q"),
)
def test_every_seeded_key_is_live_and_carries_its_source():
    import asyncpg

    async def run():
        conn = await asyncpg.connect(_live_dsn(), statement_cache_size=0)
        try:
            await conn.execute("SET search_path TO staging, public")
            return await conn.fetch(
                "SELECT obligation_key, rate_percent, threshold_amount, "
                "       effective_from, source_ref, notes "
                "  FROM staging.statute_calendar "
                " WHERE obligation_key = ANY($1::text[])",
                list(KEYS),
            )
        finally:
            await conn.close()

    rows = {r["obligation_key"]: r for r in asyncio.run(run())}
    missing = sorted(set(KEYS) - set(rows))
    assert not missing, f"migration 229 has not been applied: {missing} absent"

    for key, (column, expected) in KEYS.items():
        row = rows[key]
        assert row[column] is not None, f"{key} has no {column}"
        assert float(row[column]) == pytest.approx(expected), (
            f"{key} is {row[column]}, expected {expected} — if the law changed, "
            f"add a NEW dated row rather than editing this one"
        )
        # Every rate here is a claim about somebody's terminal payment.
        assert (row["source_ref"] or "").strip(), f"{key} cites nothing"

    # The two traps, restated on the rows themselves — a caller reading the
    # database directly does not have the reader's docstring in front of them.
    assert "YEARS, NOT RUPEES" in (rows["gratuity.qualifying_years"]["notes"] or "")
    assert "WHICHEVER IS HIGHER" in (rows["bonus.calculation_ceiling"]["notes"] or "")


@pytest.mark.skipif(_live_dsn() is None, reason="no live database")
def test_the_reader_resolves_every_term_against_the_live_store():
    """The reader, executed — not retyped. `as_of` is mandatory and is a date
    the law was in force on."""
    import asyncpg
    from datetime import date

    class _Pool:
        """The one method `services.statute` needs, on a real connection."""
        def __init__(self, conn):
            self._conn = conn

        async def fetchrow(self, sql, *args):
            return await self._conn.fetchrow(sql, *args)

        async def fetch(self, sql, *args):
            return await self._conn.fetch(sql, *args)

        async def fetchval(self, sql, *args):
            return await self._conn.fetchval(sql, *args)

    async def run():
        conn = await asyncpg.connect(_live_dsn(), statement_cache_size=0)
        try:
            await conn.execute("SET search_path TO staging, public")
            return await vetana._terminal_benefit_terms(_Pool(conn), date(2026, 8, 31))
        finally:
            await conn.close()

    terms = asyncio.run(run())
    assert terms["gratuity_ceiling"] == pytest.approx(2000000.0)
    assert terms["gratuity_rate_per_completed_year"] == pytest.approx(57.692)
    assert terms["gratuity_qualifying_years"] == pytest.approx(5.0)
    assert terms["bonus_rate_minimum"] == pytest.approx(8.33)
    assert terms["bonus_rate_maximum"] == pytest.approx(20.0)
    assert terms["bonus_eligibility_ceiling"] == pytest.approx(21000.0)
    assert terms["bonus_calculation_ceiling"] == pytest.approx(7000.0)


@pytest.mark.skipif(_live_dsn() is None, reason="no live database")
def test_a_date_before_the_law_resolves_to_nothing_rather_than_guessing():
    """`as_of` is mandatory for a reason. Asked as of 1965, the gratuity Act of
    1972 has not been passed and the store must say so rather than answering
    with today's figure."""
    import asyncpg
    from datetime import date

    class _Pool:
        def __init__(self, conn):
            self._conn = conn

        async def fetchrow(self, sql, *args):
            return await self._conn.fetchrow(sql, *args)

        async def fetch(self, sql, *args):
            return await self._conn.fetch(sql, *args)

        async def fetchval(self, sql, *args):
            return await self._conn.fetchval(sql, *args)

    async def run():
        conn = await asyncpg.connect(_live_dsn(), statement_cache_size=0)
        try:
            await conn.execute("SET search_path TO staging, public")
            return await vetana._terminal_benefit_terms(_Pool(conn), date(1960, 1, 1))
        finally:
            await conn.close()

    terms = asyncio.run(run())
    assert terms["gratuity_ceiling"] is None
    assert terms["gratuity_rate_per_completed_year"] is None
