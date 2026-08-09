"""A closed deal leaves the board after seven days, and takes no money with it.

Owner, 2026-08-09: "kanban done/won/lost should auto archive after 7 days".

The one thing that could go badly wrong here is archiving through `is_active`,
which is what DELETE writes and what every won-value figure filters on. These
tests pin the separation.
"""
import inspect
import pathlib
import re

from routers import graha, scheduler
from services import deal_archive

BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _code(fn) -> str:
    src = inspect.getsource(fn)
    return " ".join("\n".join(
        line for line in src.splitlines()
        if not line.strip().startswith("#")).split())


def test_the_window_is_seven_days():
    assert deal_archive.DEAL_ARCHIVE_DAYS == 7
    # Interpolated from the constant, not retyped into the SQL.
    assert "{DEAL_ARCHIVE_DAYS} days" in _code(deal_archive.sweep_org)


def test_only_won_and_lost_close_a_deal():
    assert deal_archive.CLOSED_STAGES == ("Won", "Lost")


def test_archiving_never_touches_is_active():
    """THE regression this feature could cause. `is_active=FALSE` is DELETE, and
    Dristi's won-value, the pipeline summary and the CRM report all filter on
    it — so archiving through that column would silently erase revenue."""
    for src in (_code(deal_archive.sweep_org), _code(graha.archive_deal),
                _code(graha.unarchive_deal)):
        assert "is_active=FALSE" not in src.replace(" ", "")


def test_the_sweep_only_takes_closed_deals():
    code = _code(deal_archive.sweep_org)
    assert "stage = ANY" in code
    assert "archived_at IS NULL" in code, "the sweep would rewrite dates every night"


def test_the_clock_starts_when_the_deal_closed():
    """`won_at` / `lost_at`, not "when the sweep first saw it" — otherwise the
    first run after this ships gives every historic deal a fresh week."""
    code = _code(deal_archive.sweep_org)
    assert "COALESCE(won_at, lost_at, updated_at)" in code


def test_an_open_deal_cannot_be_archived_by_hand():
    """Archiving live work is how a deal gets forgotten."""
    code = _code(graha.archive_deal)
    assert "CLOSED_STAGES" in code and "400" in code


def test_everything_probes_for_the_column():
    """`PROPOSED_deal_archive.sql` has NOT been applied, and migrations here are
    applied by hand with the deploy as a separate act — so both orders happen.
    Nothing may 500 on UndefinedColumn, and nothing may appear to succeed."""
    for fn in (graha.list_deals, graha.deals_kanban, graha.archive_deal,
               graha.unarchive_deal, deal_archive.sweep_org):
        assert "archive_ready" in _code(fn), f"{fn.__name__} assumes the column exists"
    for fn in (graha.archive_deal, graha.unarchive_deal):
        assert "503" in _code(fn), f"{fn.__name__} does not refuse loudly"


def test_the_probe_caches_asymmetrically():
    code = _code(deal_archive.archive_ready)
    assert "recheck_after" in code and "60" in code


def test_the_board_hides_archived_deals():
    assert "archived_at IS NULL" in _code(graha.deals_kanban)


def test_the_list_can_still_be_asked_for_them():
    code = _code(graha.list_deals)
    assert "include_archived" in code


def test_the_sweep_is_wired_to_the_daily_crm_job():
    assert "sweep_org" in _code(scheduler.run_crm)


def test_the_migration_adds_no_default():
    """A default on `archived_at` archives every deal in the product."""
    sql = (BACKEND / "migrations" / "133_deal_archive.sql").read_text(encoding="utf-8")
    body = "\n".join(line for line in sql.splitlines()
                     if not line.strip().startswith("--"))
    add = body[body.index("ADD COLUMN IF NOT EXISTS archived_at"):][:200]
    assert "DEFAULT" not in add.upper()
    assert re.search(r"NOT\s+NULL", add.upper()) is None
