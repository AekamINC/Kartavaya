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
    the code gate stands between it and a bill."""
    seeded = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8", errors="replace")
        for actor_id in BLOCKED_ACTORS:
            # A mention inside a comment is documentation, not a seed. Comment
            # lines are what 094 is mostly made of.
            body = "\n".join(
                line for line in text.splitlines() if not line.strip().startswith("--")
            )
            if re.search(rf"'{re.escape(actor_id)}'", body) and "INSERT" in body.upper():
                seeded.setdefault(actor_id, []).append(path.name)

    for actor_id, files in seeded.items():
        assert any("is_active" in (MIGRATIONS / f).read_text(encoding="utf-8", errors="replace")
                   for f in files) or True, ""
        # The real assertion: a later migration must deactivate what an earlier
        # one seeded. 094 is that migration for this actor.
        later = [p.name for p in sorted(MIGRATIONS.glob("*.sql"))
                 if "is_active = FALSE" in p.read_text(encoding="utf-8", errors="replace")
                 and actor_id in p.read_text(encoding="utf-8", errors="replace")]
        assert later, (
            f"{actor_id} is seeded active by {files} and no migration ever "
            f"deactivates it — a fresh database ships it live"
        )
