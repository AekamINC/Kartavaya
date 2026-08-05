"""A withdrawn scraper cannot be run, however it is reached.

`mikolabs/gstin-scraper` was repriced 21.5x by its author on 2026-08-04 —
$6.99 to $149.99 per 1,000 results. The catalog row records `cost_per_run` of
$0.10 and sells at Rs 50; a full run (`max_results = 10`) now costs about $1.50.
Every full run sells at a loss and nothing in the pricing arithmetic can see it,
because `cost_per_run` is a number somebody typed on the day the row was written
and the actor belongs to a third party who can reprice it at will.

Two gates, and this file exists because either one alone is not enough:

  · `is_active = FALSE` (migration 094) hides it from the listing and from
    `POST /run`. One UPDATE undoes that, and re-running migration 046 on a fresh
    database sets it back to TRUE.
  · `services.apify.BLOCKED_ACTORS` refuses the id at `start_actor`, which every
    run passes through.

The failure this guards against is not someone deliberately re-enabling it. It
is a reseed, a restore, or a well-meaning "why is this scraper missing?" — none
of which would think to check an email from July.
"""
import inspect
import re
from pathlib import Path

import pytest

from services.apify import BLOCKED_ACTORS, BlockedActorError, start_actor

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def test_the_gstin_scraper_is_blocked():
    assert "mikolabs/gstin-scraper" in BLOCKED_ACTORS, (
        "the repriced GSTIN scraper is runnable again — a full run costs about "
        "$1.50 against a Rs 50 sale price"
    )


def test_every_block_states_why():
    """A bare id in a denylist is undeletable: nobody can tell whether the
    reason still holds, so it stays forever or is removed blind."""
    for actor_id, reason in BLOCKED_ACTORS.items():
        assert isinstance(reason, str) and len(reason) > 20, (
            f"{actor_id} is blocked with no usable reason: {reason!r}"
        )


@pytest.mark.asyncio
async def test_a_blocked_actor_never_reaches_the_network():
    """The refusal must come BEFORE the HTTP call. An Apify run that has already
    started has already begun charging, and the caller's refund path assumes
    nothing was spent."""
    with pytest.raises(BlockedActorError) as exc:
        await start_actor("mikolabs/gstin-scraper", {"gstins": ["27AAAAA0000A1Z5"]})
    assert "withdrawn" in str(exc.value).lower()


def test_the_refusal_is_raised_before_the_http_client_is_opened():
    """Proved from the source as well as from behaviour: a future edit that
    moves the guard inside the `async with` would still pass the test above on a
    mocked client, while spending money in production."""
    src = inspect.getsource(start_actor)
    guard = src.index("BLOCKED_ACTORS")
    client = src.index("httpx.AsyncClient")
    assert guard < client, (
        "the blocked-actor guard now runs after the HTTP client is opened"
    )


def _statements(path: Path) -> str:
    """The SQL with `--` comment lines removed.

    094 is mostly commentary, and it explains why it does not DELETE the row —
    so a check that greps the raw file for DELETE fails on the sentence saying
    the migration does not do it. That is the second time in this repo a test
    has asserted against its own prose; strip the comments first.
    """
    return "\n".join(
        line for line in path.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("--")
    )


def test_migration_094_deactivates_the_catalog_row():
    path = MIGRATIONS / "094_withdraw_gstin_scraper.sql"
    sql = _statements(path)
    assert "is_active = FALSE" in sql
    assert "mikolabs/gstin-scraper" in sql
    # Deactivated, not deleted: hub_scraper_runs.scraper_id points at this row
    # and the runs screen has to keep resolving a name for past runs.
    assert "DELETE" not in sql.upper(), (
        "094 deletes the catalog row, which orphans every historical run"
    )


def test_no_blocked_actor_is_seeded_active_by_an_earlier_migration():
    """046 seeds the catalog with `is_active` defaulting TRUE. If a blocked
    actor is still seeded there, a fresh database is born with it live and only
    the code gate stands between it and a bill.

    Both halves read `_statements()`, not the raw file. This test used to grep
    `path.read_text()` for the actor id, so a migration that merely MENTIONED
    the actor in a comment — "`BLOCKED_ACTORS` refuses `thirdwatch/…`" — counted
    as deactivating it. 099 was written that way and this test passed on the
    prose, which is the third time in this repo a check has asserted against a
    comment. The stripped body is the only thing that means anything here.
    """
    seeded: dict[str, list[str]] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        body = _statements(path)
        for actor_id in BLOCKED_ACTORS:
            if re.search(rf"'{re.escape(actor_id)}'", body) and "INSERT" in body.upper():
                seeded.setdefault(actor_id, []).append(path.name)

    for actor_id, files in seeded.items():
        # A later migration must withdraw what an earlier one seeded, and it has
        # to do so in SQL that names the actor — deactivating it, deleting it, or
        # both.
        later = []
        for p in sorted(MIGRATIONS.glob("*.sql")):
            sql = _statements(p)
            if actor_id not in sql:
                continue
            if "is_active = FALSE" in sql or "DELETE FROM staging.hub_scraper_catalog" in sql:
                later.append(p.name)
        assert later, (
            f"{actor_id} is seeded active by {files} and no migration ever "
            f"withdraws it in SQL — a fresh database ships it live"
        )


def test_the_mca_director_lookup_is_blocked():
    """Withdrawn 2026-08-05 as a product decision, not a cost one.

    Migration 099 deletes the catalog row, but 046 seeds it, so a rebuilt
    database would offer it again with nothing but this entry in the way.
    """
    assert "thirdwatch/mca-india-scraper" in BLOCKED_ACTORS


def test_migration_099_removes_the_mca_row_without_orphaning_history():
    """It deletes, where 094 could only deactivate — and only while that is safe.

    `mca_cin_director_lookup` had never been run, so nothing pointed at the row.
    The DELETE is still guarded on that count: if a run appears before this is
    applied, the row must survive so the runs screen can still name it.
    """
    sql = _statements(MIGRATIONS / "099_remove_mca_director_lookup.sql")
    assert "DELETE FROM staging.hub_scraper_catalog" in sql
    assert "hub_scraper_runs" in sql, (
        "the DELETE is unguarded — applying it after a run exists would orphan "
        "that run's scraper_id"
    )
    assert "NOT EXISTS" in sql.upper()
    # Deactivated as well as deleted, so the guard declining still hides it.
    assert "is_active = FALSE" in sql
    # Named by ACTOR id, not only by catalog id: the catalog id is ours to
    # change, the actor id is what BLOCKED_ACTORS and every run agree on.
    assert "thirdwatch/mca-india-scraper" in sql
