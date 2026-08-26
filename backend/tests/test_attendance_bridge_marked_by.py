"""The one value that decides whether biometric attendance reaches payroll.

── WHAT WENT WRONG ──────────────────────────────────────────────────────────

`attendance_bridge.MARKED_BY_BRIDGE` was `'pahchan'`, and
`staging.manav_attendance`'s CHECK admits only
`('system','manual','biometric','geo')`. Every row `POST /v1/pahchan/publish`
has ever tried to write raised CheckViolation, so **not one punch has ever
become a day of attendance**. Measured live on 2026-08-27:

    staging.manav_attendance   marked_by='system'      512
                               marked_by='manual'        6
                               marked_by='pahchan'       0
    staging.pahchan_punches                             699

A firm could enrol faces, punch in every day for a month, and the payroll run
would see none of it — with no error anywhere a person looks, because the
publish route reports the rows it *attempted*.

Nothing in the suite could catch it: `conftest.py` hands every module a
MagicMock pool, and a MagicMock accepts a value a CHECK constraint would refuse.
That is the same blind spot that let `gst_rate` survive in client billing, and
the reason `tests/test_every_writer_has_a_live_sql_test.py` exists.

── WHAT THIS FILE HOLDS ─────────────────────────────────────────────────────

Two properties, both of which have to be true at once, and which pull in
opposite directions:

  1. the value must be one the CHECK admits — read FROM THE LIVE CATALOGUE,
     not from a migration file or a copy of the list in Python;
  2. it must NOT be `'manual'`, because the publish upsert's
     `WHERE marked_by IS DISTINCT FROM $11` guard is what protects a day
     somebody typed by hand — and equally what lets the bridge re-write its own
     earlier rows, which is the module's whole operating model.

A change that satisfies one and breaks the other turns this file red.
"""
import inspect
import os

import pytest

from services.attendance_bridge import MARKED_BY_BRIDGE, MARKED_BY_MANUAL


_PLACEHOLDER_DSN = "postgresql://test:test@localhost/test"

#: The CHECK's contents as of migration 082. Asserted against the LIVE
#: constraint below — this copy exists so the offline half can say something
#: useful, never as the authority.
KNOWN_METHODS = {"system", "manual", "biometric", "geo"}


def test_the_bridge_value_is_a_method_the_column_admits():
    assert MARKED_BY_BRIDGE in KNOWN_METHODS, (
        f"MARKED_BY_BRIDGE is {MARKED_BY_BRIDGE!r}, which "
        f"manav_attendance_marked_by_check refuses — every publish raises "
        f"CheckViolation and no punch ever becomes attendance. The column "
        f"records HOW a day was marked; a module name is not one of those."
    )


def test_the_bridge_value_is_not_manual():
    assert MARKED_BY_BRIDGE != MARKED_BY_MANUAL, (
        "the bridge writes 'manual', so the upsert's IS DISTINCT FROM guard "
        "skips every row the bridge itself wrote last time. Re-publishing after "
        "a correction — the way this module is meant to be used — would do "
        "nothing, silently."
    )


def test_the_guard_still_protects_hand_entry():
    """The `$11` in the upsert is `MARKED_BY_MANUAL`, not the bridge value. If
    somebody 'simplifies' those to one parameter, a hand-typed day starts being
    overwritten by a face punch."""
    from routers import pahchan_attendance

    src = inspect.getsource(pahchan_attendance)
    assert "marked_by IS DISTINCT FROM $11" in src, (
        "the publish upsert no longer protects hand-entered attendance"
    )
    assert "MARKED_BY_BRIDGE, MARKED_BY_MANUAL," in src, (
        "the upsert's two marked_by parameters were collapsed into one — the "
        "row it WRITES and the row it REFUSES TO OVERWRITE are different values"
    )


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL")
    or os.environ.get("DATABASE_URL") == _PLACEHOLDER_DSN,
    reason=(
        "no live database. The authority for what this column admits is the "
        "CHECK itself, not a list copied into Python. Run with:\n"
        "    railway run -e staging -s Kartavya -- python -m pytest "
        "tests/test_attendance_bridge_marked_by.py -q"
    ),
)
def test_the_live_check_admits_the_value_this_code_writes():
    """The only assertion that would have caught the original defect."""
    import asyncio
    import asyncpg

    async def run():
        conn = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
        try:
            return await conn.fetchval(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conname = 'manav_attendance_marked_by_check'"
            )
        finally:
            await conn.close()

    definition = asyncio.run(run()) or ""
    assert definition, "manav_attendance_marked_by_check is gone — nothing constrains the column"
    assert f"'{MARKED_BY_BRIDGE}'" in definition, (
        f"the live CHECK is {definition!r} and does not admit "
        f"{MARKED_BY_BRIDGE!r}. Every publish raises CheckViolation."
    )
    assert f"'{MARKED_BY_MANUAL}'" in definition
