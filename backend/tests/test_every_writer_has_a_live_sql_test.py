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
    "admin_orgs", "column_prefs", "esign", "hub_chat",
    "hub_connectors", "hub_publish", "lead_sources", "me", "messaging",
    "niyam_rules", "org_members", "org_modules", "org_security",
    "pay", "procurement", "products", "pulse",
    "scheduler", "scrapers", "subscription", "tab_prefs", "totp",
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
    # `templates` removed 2026-08-29: ccc61a2c added
    # tests/test_apply_template_is_idempotent.py, which carries 3 live tests
    # executing apply_project_template's SQL against the real schema.
    "org_invites",
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
    # ── AND `graha` LEFT BY THE FIRST ROUTE, 2026-08-29 ──────────────────────
    #
    # `tests/test_client_coordinates.py` PREPAREs `routers/graha.py`'s
    # statements against the real catalogue, so graha had been covered for some
    # time and nobody took the name off this list. `test_the_baseline_only_shrinks`
    # had therefore been RED — found while adding `recycle_bin`'s live-SQL test,
    # and proved pre-existing by stashing that work and watching it fail
    # identically.
    #
    # Worth stating plainly because it is this file's own failure mode: a
    # baseline that is red for a name nobody is working on is a baseline people
    # learn to run with one expected failure, and an expected failure is a
    # failure nobody reads. The list is the debt that remains, and it was
    # overstating the debt by one.
    #
    # ── THREE MORE LEFT BY THE FIRST ROUTE, 2026-08-29 ───────────────────────
    #
    #   · `org_profile`   — `tests/test_org_profile_state_code.py` PREPAREs the
    #                       GET projection and the PATCH `RETURNING` clause,
    #                       both composed from `_PROFILE_COLUMNS` itself so a
    #                       column added later is checked without editing the
    #                       test. Written while fixing the org GST state code,
    #                       which no screen and no route could set.
    #   · `ganit`         — already covered by
    #                       `tests/test_invoicing_reads_the_dated_law.py`.
    #   · `pahchan_attendance` — already covered by
    #                       `tests/test_pahchan_consent_optout.py`, which calls
    #                       `await conn.prepare(sql)` at :680 and names the
    #                       router five times.
    #
    # ⚠ THAT FILENAME WAS WRONG WHEN FIRST WRITTEN, and the correction is worth
    # more than the fix. It said `test_attendance_bridge_marked_by.py` — a real
    # file that names `pahchan_attendance` and contains **zero** `prepare()`
    # calls. Checked 2026-08-29 by grepping for an actual call rather than
    # trusting the name.
    #
    # ⚠⚠ AND CHECKING IT EXPOSED A HOLE IN THIS RATCHET ITSELF. `_PREPARES` is
    # the bare substring `"prepare("`, matched against the whole file — so a
    # test that merely MENTIONS `prepare()` IN PROSE credits the router it
    # imports with live-SQL coverage it does not have.
    # `tests/test_date_params_are_parsed_not_bound_as_str.py` is exactly that
    # shape today: it imports `pahchan_attendance`, and its only `prepare(` is
    # the word in a docstring at :36. It happens not to matter here, because
    # `test_pahchan_consent_optout.py` provides the real thing — but the next
    # name to leave this list could leave on a docstring alone.
    # This is the third time a static ratchet in this repo has been found
    # counting a string rather than a behaviour. Tightening `_PREPARES` to an
    # actual call (`.prepare(`) is the fix; it is NOT made here because it may
    # turn other names red and that is its own change, measured on its own.
    #
    # ⚠ The last two were NOT this change's work and are recorded as found.
    # `test_the_baseline_only_shrinks` was ALREADY RED on `fbb1f0c5` naming both
    # — proved by holding the new test file aside and watching it fail with
    # `['ganit', 'pahchan_attendance']` instead of all three. That is the second
    # time in two days this list has been caught overstating the debt, and it is
    # the failure mode the `graha` note above describes: a baseline red for a
    # name nobody is working on is one people learn to run past.
    #
    # ── AND `prachar` LEFT BY GAINING ONE, 2026-08-29 ────────────────────────
    #
    # `tests/test_prachar_temporal_binds_live_sql.py` PREPAREs the router's four
    # `::timestamptz` statements against the real catalogue and asserts the
    # PARAMETER TYPES the server infers for them.
    #
    # It exists because proposal 93 Suite 11 found the fifth shipped instance of
    # this repo's signature failure inside it: `create_campaign`,
    # `update_campaign`, `create_event` and `update_event` all bound a `str`
    # into a `::timestamptz`, so a campaign carrying a date and an event of any
    # kind had never once been creatable, by anybody, in any organisation.
    # `staging.prachar_campaigns` held ONE row in the whole database and
    # `staging.prachar_events` held ZERO — which is the consequence rather than
    # a coincidence beside it.
    #
    # This name leaves the list on a REAL `await conn.prepare(sql)` call, not on
    # a docstring, which is the hole in `_PREPARES` recorded immediately above.
    #
    # ── AND `hub` LEFT BY GAINING ONE, 2026-08-29 ────────────────────────────
    #
    # `tests/test_hub_org_brand.py` covers `routers/hub.py`'s statements against
    # the real catalogue. It was written while fixing `PUT /v1/hub/org/brand`,
    # which answered 500 for EVERY organisation: it INSERTed `(org_id)` alone
    # into a table whose `client_id` is NOT NULL, on a branch nothing could skip
    # because nothing had ever written `org_id` there.
    #
    # ⚠ AND THIS ENTRY IS HERE BECAUSE A DIFFERENT AGENT NOTICED IT WAS OWED.
    # The test file landed untracked while `hub` was still on this list, so
    # `test_the_baseline_only_shrinks` went RED in the working tree for a name
    # nobody was looking at — exactly the "expected failure nobody reads" this
    # file's own `graha` note warns about. It was caught by a suite agent
    # running the backend tests for an unrelated module, who reported that the
    # baseline edit was owed by whoever committed the new file. Recorded because
    # the catch is worth more than the edit: with several people writing in one
    # tree a ratchet can go red for work that is CORRECT and merely unfinished,
    # and that is precisely the state in which ratchets get ignored.
    #
    # ── AND `vikray` LEFT BY GAINING ONE, 2026-08-29 ─────────────────────────
    #
    # `tests/test_order_invoice_place_of_supply.py` PREPAREs every statement
    # `generate_invoice_from_order` issues against the real catalogue, asserts
    # the parameter count of an INSERT whose placeholder list was extended by
    # hand, and asserts the TYPE the server infers for the new parameter.
    #
    # It exists because proposal 93 finding 2 measured that route hardcoding
    # `''` into `place_of_supply` — 10 of 10 order-generated invoices blank,
    # 6 of them inter-state and therefore held out of GSTR-1 entirely by
    # `services/gstr1_json.py`, which reads that exact column.
    #
    # ⚠ WHAT THAT NAME NOW CLAIMS, STATED PLAINLY. This ratchet credits
    # coverage per ROUTER, and the new file covers ONE route's statements —
    # the whole of the order-to-invoice conversion, and not the whole of
    # `routers/vikray.py`. Every name that has left this list carries the same
    # property (`ganit` left on `test_invoicing_reads_the_dated_law.py`), so
    # this is the rule working as designed rather than an exception — but it is
    # written down here because "vikray is covered" is a weaker sentence than
    # it looks, and the next person to add a writer to that router will read
    # this line rather than a green tick.
    #
    # 24 remain.
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
