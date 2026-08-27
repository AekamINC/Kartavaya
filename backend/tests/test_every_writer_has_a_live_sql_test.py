"""Phase 6's process rule, as a ratchet: a router that WRITES must have a test
that runs its SQL against the real schema.

── WHY THIS FILE IS THE MOST IMPORTANT THING IN PHASE 6 ─────────────────────

`docs/plans/PHASE-6-retire-duplicates.md` ends by asking for "one process rule
[that] closes the failure mode that produced every blocker in Phase 2". This is
that rule, and it is written as a check rather than as a sentence in CLAUDE.md
because the sentence already existed and did not hold.

The failure mode, twice, in the same fortnight:

  · `routers/client_billing.py` shipped with zero tests. Both of its
    `INSERT INTO staging.ganit_invoices` statements named a column, `gst_rate`,
    that has never existed on that table, and both omitted `invoice_number`,
    which is NOT NULL with no default. Measured on the live database: 0 rows in
    `client_invoice_lines`, 0 auto-invoices, against 4 billing profiles and 4
    service lines. Not "rarely used" — NEVER ONCE SUCCEEDED.
  · The payroll leaver guard, whose statement had been 500ing on a date bind
    since the day it shipped.

Nothing in a 5,000-test suite could catch either, and `tests/conftest.py` is
why: it hands every module a MagicMock pool, and a MagicMock answers happily to
a statement naming a column that is not there. A test that calls the handler
with that pool and asserts `{"created": 1}` has proved that the mock returned
what the test told it to return.

── WHAT COUNTS AS COVERAGE ──────────────────────────────────────────────────

A test file that calls `asyncpg.Connection.prepare()` on the module's
statements. `prepare()` sends Parse and Describe and STOPS: the server plans the
statement, resolves every relation, column and parameter type, and returns the
shapes — it does not execute, does not read a row and does not write one. That
distinction is the whole safety story, because staging shares its database with
production (CLAUDE.md).

`tests/test_client_billing_invoices.py` is the reference implementation. It also
reads the catalogue directly, because `prepare()` plans a statement that omits a
NOT NULL column perfectly happily — the violation is a runtime constraint, not a
parse error.

── HOW THIS RATCHETS ────────────────────────────────────────────────────────

30 of the 36 writing routers had no such test on 2026-08-27. Failing all 30
today would make the check something to be skipped, so they are listed below as
a baseline — and the baseline may only SHRINK:

  · a NEW router that writes SQL and has no live test fails immediately;
  · a baselined router that GAINS one must be removed from the list, which the
    second test enforces, so the list cannot quietly go stale the way
    `migrations/README.md`'s status column did.

Delete a name from `UNCOVERED` when you write its test. Never add one.
"""
import pathlib
import re

import pytest


_ROOT = pathlib.Path(__file__).resolve().parent.parent
_ROUTERS = _ROOT / "routers"
_TESTS = _ROOT / "tests"

#: A statement that changes a row, in EITHER schema this database has.
#:
#: THIS READ `staging\.` ALONE UNTIL 2026-08-27, and the blind spot was not
#: theoretical. Three routers write to `public.` and were therefore invisible to
#: the rule — `reports` (public.report_schedules), `org_invites` (public.invites)
#: and `templates` (public.project_templates). `reports` is the expensive one:
#: it is a complete second report scheduler with CRUD and a `POST /dispatch`
#: that runs on an ARMED hourly Railway cron, and Phase 6.4 was closed as a
#: "stale premise" on a `SELECT ... FROM staging.report_schedules` that raised
#: 42P01 — read as "the table does not exist" when it meant "not in that
#: schema". The table is `public.report_schedules` and it is real.
#:
#: A `staging.`-only lens is exactly how that mistake is made, and this rule
#: existing to catch untested writers while being unable to SEE a third of them
#: is the same failure in its own tooling. Both schemas now.
#:
#: Still qualified, and deliberately: an unqualified write is its own defect
#: (see `shadow-tables-and-search-path`) and is not laundered into coverage by
#: being matched here.
_WRITES = re.compile(
    r"(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(staging|public)\.", re.I)

#: The Parse-and-Describe call. Nothing else in this repo prepares a statement.
_PREPARES = "prepare("

#: Every way a test names the router it is exercising.
_NAMES_ROUTER = re.compile(
    r"import\s+routers\.(\w+)|from\s+routers\s+import\s+(\w+)|"
    r"from\s+routers\.(\w+)\s+import|routers\.(\w+)"
)

#: Writing routers with NO live-schema test, measured 2026-08-27. ONLY SHRINKS.
UNCOVERED = {
    "admin_orgs", "column_prefs", "esign", "ganit", "graha", "hub", "hub_chat",
    "hub_connectors", "hub_publish", "lead_sources", "me", "messaging",
    "niyam_rules", "org_members", "org_modules", "org_profile", "org_security",
    "pahchan_attendance", "pay", "prachar", "procurement", "products", "pulse",
    "scheduler", "scrapers", "subscription", "tab_prefs", "totp", "vikray",
    # `whatsapp` left this list on 2026-08-27 — the first name to, and the
    # ratchet is what noticed.
    #
    # ── THE ONE TIME THIS SET GREW, AND WHY IT IS NOT THE RULE SLIPPING ──────
    #
    # `org_invites`, `reports` and `templates` were added on 2026-08-27. Not
    # because they lost a test — they never had one — but because `_WRITES` had
    # only ever looked at `staging.` and all three write to `public.`. They were
    # writing, untested and INVISIBLE, and the number below said 29 while the
    # truth was 32.
    #
    # A baseline may grow when the LENS widens; it may never grow because a
    # standard slipped. The distinction is the whole value of the file, so it is
    # recorded here rather than absorbed. If a fourth name ever appears without
    # a paragraph like this one beside it, that is the rot this ratchet exists
    # to prevent.
    "org_invites", "templates",
    #
    # ── AND THE ONE THAT LEFT BY BEING DELETED, 2026-08-27 ───────────────────
    #
    # `reports` came off the SAME DAY it went on. It was baselined because the
    # widened lens finally saw its writes to `public.report_schedules`; hours
    # later the owner retired that table, and the CRUD and the `POST /dispatch`
    # that made those writes were deleted from `routers/reports.py`. The router
    # now only reads, so it is not an untested writer — it is not a writer.
    #
    # This is the ratchet doing its job in the cheapest possible direction, and
    # it is worth naming: the reason `reports` was visible to be deleted at all
    # is that widening the lens put it on this list. A name may only leave here
    # by gaining a live-SQL test or by ceasing to write. This one did the
    # second. See `tests/test_report_retirement.py`.
    #
    # 31 remain.
}


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")


def writing_routers() -> set[str]:
    return {p.stem for p in sorted(_ROUTERS.glob("*.py")) if _WRITES.search(_read(p))}


def routers_with_a_live_sql_test() -> set[str]:
    covered: set[str] = set()
    for p in sorted(_TESTS.glob("*.py")):
        if p.name == pathlib.Path(__file__).name:
            continue
        text = _read(p)
        if _PREPARES not in text:
            continue
        for match in _NAMES_ROUTER.finditer(text):
            name = next(g for g in match.groups() if g)
            covered.add(name)
    return covered


def test_a_new_writing_router_has_a_test_that_runs_its_sql():
    """THE RULE. A router that writes and is not baselined must be covered."""
    gap = writing_routers() - routers_with_a_live_sql_test() - UNCOVERED
    assert not gap, (
        f"{sorted(gap)} write to staging.* and no test PREPAREs their statements "
        f"against the real schema. A MagicMock pool answers happily to a "
        f"statement naming a column that does not exist — that is how "
        f"`gst_rate` survived in client_billing.py until it had never once "
        f"succeeded. Copy the live half of tests/test_client_billing_invoices.py. "
        f"Do NOT add the name to UNCOVERED; that list only shrinks."
    )


def test_the_baseline_only_shrinks():
    """A baselined router that has gained a test must leave the list.

    Without this the list rots exactly the way `migrations/README.md`'s status
    column did — still marking 002-006 "Pending" against a live database of 214
    tables — and a rotten baseline is worse than none, because it reads as an
    inventory of what is missing.
    """
    now_covered = sorted(UNCOVERED & routers_with_a_live_sql_test())
    assert not now_covered, (
        f"{now_covered} now has a live-schema test — delete it from UNCOVERED. "
        f"The list is the debt that remains, not a record of how things were."
    )


def test_the_baseline_names_only_real_writing_routers():
    """A name in the list that no longer writes, or no longer exists, is noise
    that makes the number look worse than it is."""
    stale = sorted(UNCOVERED - writing_routers())
    assert not stale, (
        f"{stale} is baselined but does not write to staging.* any more (or the "
        f"module is gone). Delete it from UNCOVERED."
    )


@pytest.mark.parametrize("reference", ["test_client_billing_invoices.py"])
def test_the_reference_implementation_still_exists(reference):
    """The rule points at a file. If that file is renamed or deleted, the
    instruction in every failure message above stops resolving."""
    p = _TESTS / reference
    assert p.exists(), f"{reference} is the pattern this rule tells people to copy"
    text = _read(p)
    assert _PREPARES in text, f"{reference} no longer PREPAREs anything"
    assert "information_schema.columns" in text, (
        f"{reference} no longer reads the catalogue — prepare() alone does not "
        f"catch an INSERT that omits a NOT NULL column with no default, which "
        f"was half of the original defect."
    )
