"""There are TWO report schedulers, and Phase 6.4 closed on a query that missed one.

── WHAT HAPPENED ─────────────────────────────────────────────────────────────

`docs/plans/PHASE-6-retire-duplicates.md` §6.4 asks for a decision: two report
schedulers, `dristi_scheduled_reports` (7 live subscriptions, the only one that
has ever sent mail) versus `report_schedules` (0 rows). Merge onto the working
one or delete the empty one, but do not leave both.

It was closed on 2026-08-27 as a **stale premise** — "`staging.report_schedules`
does not exist (42P01 on a live query), so there is one scheduler, not two" —
and that sentence went into `docs/STATUS.md`, the phase plan and `PROGRESS.md`.

The query was real and its output was real. The reading was wrong. `42P01` from
`SELECT ... FROM staging.report_schedules` means **not in that schema**, not
"nowhere". Live, 2026-08-27:

    public.report_schedules              EXISTS · 15 columns · 0 rows
    staging.dristi_scheduled_reports     EXISTS ·             · 7 rows
    staging.report_schedules             42P01 — and only this was checked

So both schedulers are real, 6.4 is OPEN, and Phase 6's own Definition of Done
item "One report scheduler" is not met.

── WHY THIS IS THE WORST POSSIBLE PLACE FOR THAT MISTAKE ─────────────────────

Phase 6 exists to install one rule: **no proposal may assert a table, route or
column is missing without a live query in the document.** There WAS a live query
in the document. It looked in one schema of the two this database has, and the
rule as written does not say which schema — so the rule was followed and the
wrong answer was published anyway.

`memory/shadow_tables_and_search_path` already records the general form: ALWAYS
qualify the schema, because `staging` and `public` both exist and objects have
been duplicated across them before. Qualifying is necessary. What this file adds
is the other half — a NEGATIVE result from a qualified query is a fact about
that schema only, and reading it as a fact about the database is how a phase
item gets closed on nothing.

── WHAT THIS FILE ASSERTS ────────────────────────────────────────────────────

Source-level, so it runs in CI without a database. It pins the second scheduler
into existence loudly enough that nobody re-derives it away, and it fails if any
document goes back to claiming the table is missing.

It deliberately does NOT decide 6.4. Retiring `public.report_schedules` means
dropping a table, which is named and confirmed by the owner and by nobody else.
"""
from __future__ import annotations

import pathlib
import re

_ROOT = pathlib.Path(__file__).resolve().parent.parent
_REPO = _ROOT.parent
_REPORTS = _ROOT / "routers" / "reports.py"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8", errors="ignore")


def test_reports_router_is_a_second_scheduler_over_public_report_schedules():
    """Not a leftover model, not a view: a full CRUD over its own table.

    A stack you can create, list, update and delete through is a scheduler, and
    calling it "the empty one" understates what has to be decided about it.
    """
    src = _read(_REPORTS)
    for verb in ("INSERT INTO public.report_schedules",
                 "DELETE FROM public.report_schedules",
                 "UPDATE public.report_schedules"):
        assert verb in src, (
            f"`routers/reports.py` no longer contains `{verb}`. If the second "
            f"scheduler has genuinely been retired, delete this file and close "
            f"Phase 6.4 with the live counts that prove it."
        )
    assert "FROM public.report_schedules" in src, (
        "the reads are gone too — see above"
    )


def test_the_dispatch_endpoint_that_a_cron_calls_still_exists():
    """`POST /api/reports/dispatch` is ARMED.

    Railway staging runs `cron-report-dispatch` on `7 * * * *` against it — an
    hourly cron pointed at the scheduler the ledger called non-existent. An
    empty table is not the same as an idle one; this endpoint runs 24 times a
    day and finds nothing to do, which is why nobody noticed.
    """
    src = _read(_REPORTS)
    assert '@router.post("/dispatch")' in src, (
        "the dispatch route is gone. If the cron was disarmed with it, say so "
        "in Phase 6.4; if not, an armed cron now calls a route that does not "
        "exist and fails hourly."
    )


def test_the_other_scheduler_is_the_one_that_actually_sends():
    """`dristi_scheduled_reports` holds the 7 real subscriptions.

    Named here so the two are never confused: the decision in 6.4 is which of
    these two survives, and the one with the rows is not the one with the cron.
    """
    hits = [p for p in (_ROOT / "routers").glob("*.py")
            if "dristi_scheduled_reports" in _read(p)]
    assert hits, (
        "nothing under routers/ mentions `dristi_scheduled_reports` any more — "
        "if the live scheduler moved, this file's premise needs rewriting"
    )


#: The sentence that was published in three documents and is false.
_FALSE_CLAIM = re.compile(
    r"report_schedules[^.\n]{0,80}(does not exist|不存在)|"
    r"(does not exist|no such table)[^.\n]{0,40}report_schedules",
    re.I,
)

#: Where the claim was published. Checked by path so a rename is a loud failure
#: rather than a silently-skipped assertion.
_LEDGERS = (
    "docs/STATUS.md",
    "docs/plans/PHASE-6-retire-duplicates.md",
    "docs/plans/PROGRESS.md",
)


def test_no_ledger_claims_report_schedules_is_missing():
    """The correction, held open.

    A wrong fact that has been copied into three documents does not stay
    corrected on its own — proposals 00, 07, 21, 27, 82 and 90 are all the same
    status audit rewritten because state kept being re-derived from stale text.
    This fails if the sentence comes back.

    A document may still QUOTE the mistake to explain it — that is how this one
    is written — so the pattern requires the claim to be made about the table,
    not merely for both phrases to appear on a page. Any line containing a
    correction marker is skipped for that reason.
    """
    offenders = []
    for rel in _LEDGERS:
        p = _REPO / rel
        assert p.exists(), f"{rel} has moved; point this test at the new path"
        for i, line in enumerate(_read(p).splitlines(), 1):
            if not _FALSE_CLAIM.search(line):
                continue
            # A line that is correcting the claim, rather than making it.
            #
            # `~~` counts, and deliberately: a struck-through sentence in a LOG
            # is not an assertion, it is a record of one that was withdrawn.
            # `PROGRESS.md` is append-only by design — a log that edits out what
            # it got wrong is worth less than one that shows it — so the entry
            # of 2026-08-27 stays on the page with a line through it rather than
            # being deleted to satisfy this test.
            if "~~" in line:
                continue
            # `FALSE` is matched case-SENSITIVELY and on its own. A line that
            # shouts it is repudiating the claim, not making it — this file's
            # own correction headings read `… "does not exist" is FALSE`, and a
            # ratchet that cannot tell a retraction from an assertion would
            # force the retraction to be worded around it.
            if "FALSE" in line:
                continue
            if re.search(r"public\.report_schedules|CORRECTED|wrong|42P01|"
                         r"not in that schema|one schema", line, re.I):
                continue
            offenders.append(f"{rel}:{i}: {line.strip()[:120]}")
    assert not offenders, (
        "a ledger claims `report_schedules` does not exist. It does — "
        "`public.report_schedules`, 15 columns, live 2026-08-27. The 42P01 that "
        "started this came from a `staging.`-qualified query and says nothing "
        "about `public`.\n  " + "\n  ".join(offenders)
    )
