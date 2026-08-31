"""
A cron that cannot do its job must not answer 200.

── What this file is here to catch ────────────────────────────────────────────

Seven of the thirteen handlers in `routers/scheduler.py` were written like this:

    try:
        from services.skills.invoice_skills import generate_recurring_invoices
        results["recurring"] = await generate_recurring_invoices(pool)
    except ImportError:
        results["error"] = "invoice_skills not available yet"
    return results                                          # ← HTTP 200 OK

None of those seven `services.skills.*_skills` modules has ever existed. Every
one of those endpoints answered 200 with an "error" key no caller reads, so
`curl -sf` saw success and Railway's cron page stayed green — for months, while
recurring invoices were never generated and scheduled reports never dispatched.

Measured against the live database on 2026-08-05, because the claim deserves a
number: `staging.reminders` holds ZERO rows, while 200 invoices sit past due and
41 CRM follow-ups are due or overdue.

So the check below is a STRUCTURAL one, not a list of endpoints. Wiring the seven
that had a real implementation is worth nothing if the eighth is written the same
way next month. `test_no_cron_handler_reports_an_error_inside_a_200` walks the
AST of the module and fails on the SHAPE.

── Why the AST and not a grep ─────────────────────────────────────────────────

This repo has shipped four checks that asserted against their own commentary: a
grep over a file matches the sentence in the file that explains the grep, and
`inspect.getsource` returns the comments with the code. `ast.parse` discards
comments and docstrings-as-comments entirely, so a scan over the tree can only
ever match executable code. The prose above is invisible to every assertion in
this file, which is the point of writing it this way.

── Why the pure functions are tested apart from the handlers ──────────────────

`tests/conftest.py` swaps `db._pool` for a MagicMock, and a mocked cursor
resolves any query you hand it — `routers/messaging.py:30-41` records what that
was worth: every read endpoint there once answered 500 against a real database
with the whole suite green. So the judgement that decides a cron's status code
lives in `fanout_failure` and `partial_failure`, which take numbers and return a
sentence, and those are tested directly. The HTTP tests below prove only that the
handler asks for the right thing and hands the answer to the right judge.
"""

import ast
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from routers.scheduler import fanout_failure, partial_failure

SCHEDULER = Path(__file__).resolve().parents[1] / "routers" / "scheduler.py"
CRON_SECRET = "cron-secret-for-tests-0123456789abcdef"


@pytest.fixture
def cron_secret(monkeypatch):
    import routers.scheduler as sched
    monkeypatch.setattr(sched, "CRON_SECRET", CRON_SECRET)
    return {"X-Cron-Secret": CRON_SECRET}


def _tree() -> ast.Module:
    # `utf-8-sig` for the same reason `test_billing_lines_wiring.py` uses it:
    # at least one router in this directory is saved with a BOM, Python's loader
    # strips it and `ast.parse` does not. A scan that cannot read a file the app
    # imports happily is a bug in the scan.
    return ast.parse(SCHEDULER.read_text(encoding="utf-8-sig"), filename=str(SCHEDULER))


def _route_handlers() -> list[ast.AsyncFunctionDef]:
    """Every function in scheduler.py carrying an `@router.<method>(...)` decorator."""
    out = []
    for node in ast.walk(_tree()):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            fn = dec.func if isinstance(dec, ast.Call) else dec
            if (isinstance(fn, ast.Attribute)
                    and isinstance(fn.value, ast.Name)
                    and fn.value.id == "router"):
                out.append(node)
                break
    return out


# ════════════════════════════════════════════════════════════════════════════
# 1. THE SCAN — the check that would have caught seven crons succeeding
# ════════════════════════════════════════════════════════════════════════════

def test_the_scan_can_see_the_handlers_at_all():
    """Without this, every parametrised case below passes by having no cases.

    A bad path, a decorator rewritten as `@router.api_route`, a module that
    moved: any of those makes `_route_handlers()` return an empty list, and an
    empty list satisfies every `assert not ...` in this file. That is the same
    class of defect the file exists to catch, so the scan is pinned first.
    """
    names = {h.name for h in _route_handlers()}
    # FIFTEEN since 2026-08-09: `run_project_bin_purge` erases projects whose
    # seven-day restore window has run out. It is NOT armed on Railway — it
    # defaults to a dry run because its first real pass would erase projects
    # binned under the old thirty-day promise.
    #
    # SIXTEEN since 2026-08-10: `run_scraper_price_watch` reads every Apify
    # actor's real price daily and holds the owner's 30–50% margin band. Added
    # because a third-party author raised a price 21.5x and nothing noticed for
    # days — see services/scraper_pricing.py.
    #
    # EIGHTEEN since 2026-08-24: `run_analytics_sync`, the ingest spine's sync
    # core (`f3c40ab9`), and it is UNARMED — the commit says so in its own
    # subject. Recorded here on 2026-08-27, three days late, which is the small
    # cost of asserting an exact number and the reason it is worth paying.
    #
    # NINETEEN since 2026-08-29: `run_recycle_bin_purge`, the second stage of
    # the two-stage recycle bin (`67704dda`, proposal 93).
    #
    # ⚠ IT WAS ADDED WITHOUT UPDATING THIS NUMBER, so this test — the one whose
    # whole job is to stop the rest of the file passing vacuously — was itself
    # RED from 2026-08-29 to 2026-08-31. A red ratchet asserts nothing, and
    # every `assert not ...` below it was unverified for those two days. Noticed
    # only because an unrelated regression run surfaced it.
    #
    # That is the second time this exact cost has been paid here (see the
    # analytics_sync note above, recorded three days late) and it is the
    # argument FOR the exact count, not against it: a lower bound would have
    # absorbed both silently and neither would ever have been noticed.
    #
    # The count is asserted rather than a lower bound because the point of this
    # test is that the SCAN still sees the handlers — a number that only ever
    # grew would pass on a scan that had started matching something else.
    assert len(names) == 19, (
        f"expected the nineteen cron endpoints, found {len(names)}: {sorted(names)}"
    )
    # The five whose implementation was found and wired, and the two that
    # refuse. If one of these disappears the scan is looking at the wrong thing.
    assert {"run_invoices", "run_crm", "run_hr", "run_stock", "run_marketing",
            "run_reports", "run_esign", "run_leads"} <= names


def test_no_cron_handler_swallows_an_importerror():
    """The construct that made this invisible, banned by shape.

    `except ImportError` inside a request handler is how an endpoint declares
    "this module is optional". That is a legitimate thing to declare — see
    `routers/billing.py:_billing_lines`, which declares it and then answers 503.
    What is not legitimate is declaring it in a cron and then returning a 200,
    and the cheapest way to keep the whole family out of this file is to ban the
    guard here: every module scheduler.py imports must be one it can rely on.

    It also matters for a second reason. `tests/test_billing_lines_wiring.py`
    walks every call-time import in `routers/` and proves it resolves, exempting
    anything inside `try: … except ImportError`. Guarding an import in this file
    opts it out of the only check that would have caught the seven missing
    modules in the first place.
    """
    offenders = []
    for node in ast.walk(_tree()):
        if not isinstance(node, ast.Try):
            continue
        for handler in node.handlers:
            if handler.type is None:
                continue
            caught = {getattr(n, "id", None) for n in ast.walk(handler.type)}
            if caught & {"ImportError", "ModuleNotFoundError"}:
                offenders.append(handler.lineno)
    assert not offenders, (
        f"routers/scheduler.py catches ImportError at line(s) {offenders}. That "
        f"is the construct that let seven cron endpoints answer 200 for months "
        f"while their module did not exist. Import it plainly and let a missing "
        f"module be a 500, or refuse with _not_built() and a 501."
    )


def test_no_cron_handler_reports_an_error_inside_a_200():
    """The general form, and the highest-value assertion in this file.

    Two shapes, both of which shipped:

        return {"error": "... not available yet"}      # a literal
        results["error"] = "..."  ;  return results    # accumulated, then returned

    Either one is an endpoint telling the caller it failed with a status code
    that says it succeeded. `raise HTTPException(500, {"error": ...})` is the
    correct form and is not matched here, because a `raise` is not a `return`.
    """
    offenders: list[str] = []

    for fn in _route_handlers():
        returned_names = {
            r.value.id for r in ast.walk(fn)
            if isinstance(r, ast.Return) and isinstance(r.value, ast.Name)
        }

        for node in ast.walk(fn):
            # Shape 1 — a dict literal with an "error" key, returned.
            if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
                for key in node.value.keys:
                    if isinstance(key, ast.Constant) and key.value == "error":
                        offenders.append(f"{fn.name}:{node.lineno} returns {{'error': ...}}")

            # Shape 2 — `something["error"] = ...` where `something` is returned.
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if (isinstance(target, ast.Subscript)
                            and isinstance(target.value, ast.Name)
                            and isinstance(target.slice, ast.Constant)
                            and target.slice.value == "error"
                            and target.value.id in returned_names):
                        offenders.append(
                            f"{fn.name}:{node.lineno} sets {target.value.id}['error'] "
                            f"and returns {target.value.id}"
                        )

    assert not offenders, (
        "a cron endpoint reports a failure inside a 200 response:\n  "
        + "\n  ".join(offenders)
        + "\nThat is what made seven broken crons invisible for months. Raise "
          "HTTPException instead — 501 when the work was never implemented, 500 "
          "when it was attempted and failed."
    )


def test_the_three_unimplemented_crons_refuse_rather_than_return():
    """A 501 handler must not have a reachable `return` at all.

    Pinned separately from the scan above because "returns nothing useful" and
    "returns nothing" are different failures and only one of them is visible in
    a status code. If somebody later gives `run_marketing` a `return {}` to quiet
    a linter, the endpoint goes green while sending nothing, which is precisely
    the state this whole round undid.
    """
    for fn in _route_handlers():
        if fn.name not in ("run_reports", "run_esign"):
            continue
        assert not [n for n in ast.walk(fn) if isinstance(n, ast.Return)], (
            f"{fn.name} has a return statement. It has no implementation to "
            f"return the result of — it must only ever raise _not_built()."
        )
        raises = [n for n in ast.walk(fn) if isinstance(n, ast.Raise)]
        assert raises, f"{fn.name} neither returns nor raises"


# ════════════════════════════════════════════════════════════════════════════
# 2. THE JUDGEMENT, tested where it lives — pure, no pool, no HTTP
# ════════════════════════════════════════════════════════════════════════════

def test_a_sweep_with_no_failures_is_a_success():
    assert fanout_failure("invoices", 3, {}) is None


def test_no_organisations_at_all_is_not_a_failure():
    """An empty product is 'nothing to do', not 'could not do it'."""
    assert fanout_failure("invoices", 0, {}) is None


def test_one_failed_organisation_fails_the_whole_tick():
    """The rule, stated: ANY org failing is not a footnote inside a 200."""
    msg = fanout_failure("invoices", 3, {"org-a": "UndefinedColumn: no such column"})
    assert msg is not None
    assert "1 of 3" in msg
    assert "org-a" in msg
    assert "UndefinedColumn: no such column" in msg


def test_the_failure_sentence_says_the_other_orgs_work_stands():
    """A 500 here is a signal, not a rollback — the sentence has to say so, or
    whoever reads it at 03:00 will go looking for a transaction to replay."""
    msg = fanout_failure("hr", 5, {"org-a": "boom"})
    assert "stands" in msg


def test_every_failed_organisation_is_named():
    failures = {"org-c": "boom", "org-a": "bang", "org-b": "crunch"}
    msg = fanout_failure("crm", 3, failures)
    assert "3 of 3" in msg
    for org in failures:
        assert org in msg
    # Sorted, so two runs with the same failures produce the same sentence and a
    # log search for it matches both.
    assert msg.index("org-a") < msg.index("org-b") < msg.index("org-c")


@pytest.mark.parametrize("failed", [0, -1])
def test_partial_failure_is_silent_when_nothing_failed(failed):
    assert partial_failure("publish", "post", 10, failed) is None


def test_partial_failure_names_the_counts_and_the_unit():
    msg = partial_failure("publish", "post", 10, 3)
    assert msg is not None
    assert "3 of 10 post(s)" in msg


def test_nothing_due_is_not_a_failure():
    """The distinction that keeps the signal worth reading. Most of these jobs
    tick with nothing to do most of the time; if that were red, the red would
    stop meaning anything by the end of the first week."""
    assert partial_failure("reminders", "reminder", 0, 0) is None


# ════════════════════════════════════════════════════════════════════════════
# 3. THE HANDLERS — the status code, and that the right question was asked
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("job,missing_names", [
    ("reports", ["/api/reports/dispatch"]),
    ("esign", ["routers/esign.py"]),
])
async def test_an_unimplemented_cron_answers_501_and_says_what_is_missing(
    api_client, cron_secret, job, missing_names
):
    """501, and a body an operator can act on.

    "not available yet" — the sentence that shipped for months — names nothing
    and suggests nothing. The replacement has to survive being read at 03:00 by
    somebody who did not write it, so the detail carries the job, what is
    missing, and where the nearest working thing is.
    """
    r = await api_client.post(f"/api/internal/cron/{job}", headers=cron_secret)
    assert r.status_code == 501, r.text
    detail = r.json()["detail"]
    assert detail["job"] == job
    assert detail["missing"] and detail["note"]
    blob = f"{detail['missing']} {detail['note']}"
    for name in missing_names:
        assert name in blob, f"the 501 for '{job}' does not mention {name}"


@pytest.mark.parametrize("job", ["reports", "esign"])
async def test_an_unimplemented_cron_still_checks_the_secret_first(
    api_client, cron_secret, job
):
    """403 beats 501. An unauthenticated caller must not be told which internal
    modules are missing — that detail is written for an operator, not the world."""
    r = await api_client.post(
        f"/api/internal/cron/{job}", headers={"X-Cron-Secret": "wrong"}
    )
    assert r.status_code == 403


async def test_a_wired_cron_sweeps_every_active_organisation(
    api_client, cron_secret, mock_pool, monkeypatch
):
    """The handler's own job: ask for the orgs, then call the handler per org.

    Deliberately NOT asserting on what `find_low_stock` returns — that is a
    query against a mock, and a mock answers anything. What is worth proving is
    that the endpoint fans out at all, because the seven stubs were written as
    though a single pool-only call swept the whole product and every real handler
    in `services/skills/` is org-scoped.
    """
    orgs = [{"id": "org-1"}, {"id": "org-2"}]
    mock_pool.fetch = AsyncMock(return_value=orgs)

    seen = []

    async def _fake_find_low_stock(pool, org_id):
        seen.append(org_id)
        return []

    import services.skills.data as data
    monkeypatch.setattr(data, "find_low_stock", _fake_find_low_stock)

    r = await api_client.post("/api/internal/cron/stock", headers=cron_secret)
    assert r.status_code == 200, r.text
    assert seen == ["org-1", "org-2"]
    assert r.json()["organisations"] == 2


async def test_the_org_query_excludes_deactivated_organisations(
    api_client, cron_secret, mock_pool, monkeypatch
):
    """A deactivated org must not have invoices generated against it.

    The question the handler asks is the thing worth pinning here; whether the
    database answers it correctly is the database's business and is not knowable
    through a MagicMock.
    """
    asked = []

    async def _fetch(query, *args):
        asked.append(query)
        return []

    mock_pool.fetch = AsyncMock(side_effect=_fetch)
    r = await api_client.post("/api/internal/cron/stock", headers=cron_secret)
    assert r.status_code == 200
    assert any("public.organisations" in q and "is_active" in q for q in asked), (
        f"the sweep did not filter organisations on is_active: {asked}"
    )


async def test_one_failing_organisation_turns_the_whole_cron_red(
    api_client, cron_secret, mock_pool, monkeypatch
):
    """The end-to-end shape of the rule, through the real handler.

    Two orgs, the second raises. The first org's work is done and is not undone;
    the response is a 500 so that `curl -sf` fails and the Railway cron goes red.
    """
    mock_pool.fetch = AsyncMock(return_value=[{"id": "org-ok"}, {"id": "org-bad"}])

    done = []

    async def _fake_find_low_stock(pool, org_id):
        if org_id == "org-bad":
            raise RuntimeError("relation public.vikray_stock does not exist")
        done.append(org_id)
        return []

    import services.skills.data as data
    monkeypatch.setattr(data, "find_low_stock", _fake_find_low_stock)

    r = await api_client.post("/api/internal/cron/stock", headers=cron_secret)
    assert r.status_code == 500, r.text
    assert done == ["org-ok"], "the healthy org's work was skipped"
    assert "org-bad" in r.json()["detail"]["error"]


async def test_marketing_does_not_report_a_failed_send_inside_a_200(
    api_client, cron_secret, monkeypatch
):
    """The one endpoint in this file that does not fan out per org.

    `services/skills/marketing_skills.py` sweeps every tenant itself and returns
    counts, so the judgement is `partial_failure` over those counts rather than
    `fanout_failure` over orgs. A campaign that failed to send must not come back
    as a 200 with `{"failed": 1}` in the body — that is the same defect in the
    same file in a different shape.
    """
    import services.skills.marketing_skills as ms

    async def _campaigns(pool):
        return {"due": 2, "sent": 1, "failed": 1, "recipients": 40}

    async def _sequences(pool):
        return {"due": 0}

    monkeypatch.setattr(ms, "process_scheduled_campaigns", _campaigns)
    monkeypatch.setattr(ms, "process_sequence_steps", _sequences)

    r = await api_client.post("/api/internal/cron/marketing", headers=cron_secret)
    assert r.status_code == 500, r.text
    assert "1 of 2 send(s)" in r.json()["detail"]["error"]


async def test_marketing_answers_200_when_every_send_succeeded(
    api_client, cron_secret, monkeypatch
):
    """The other half. A tick that worked, and a tick with nothing due, are both
    green — otherwise the red stops meaning anything within a week."""
    import services.skills.marketing_skills as ms

    async def _campaigns(pool):
        return {"due": 1, "sent": 1, "failed": 0, "recipients": 12}

    async def _sequences(pool):
        return {"due": 3, "sent": 3}

    monkeypatch.setattr(ms, "process_scheduled_campaigns", _campaigns)
    monkeypatch.setattr(ms, "process_sequence_steps", _sequences)

    r = await api_client.post("/api/internal/cron/marketing", headers=cron_secret)
    assert r.status_code == 200, r.text
    assert r.json()["campaigns"]["sent"] == 1


async def test_a_raised_sequence_step_fails_the_marketing_tick(
    api_client, cron_secret, monkeypatch
):
    """`process_sequence_steps` files anything that raised under the key 'error'
    rather than propagating it, so one bad enrolment does not cost the other 199
    their tick. That is right, and it is exactly why this layer has to read the
    bucket — otherwise the swallow is complete and the tick is green."""
    import services.skills.marketing_skills as ms

    async def _campaigns(pool):
        return {"due": 0, "sent": 0, "failed": 0, "recipients": 0}

    async def _sequences(pool):
        return {"due": 4, "sent": 3, "error": 1}

    monkeypatch.setattr(ms, "process_scheduled_campaigns", _campaigns)
    monkeypatch.setattr(ms, "process_sequence_steps", _sequences)

    r = await api_client.post("/api/internal/cron/marketing", headers=cron_secret)
    assert r.status_code == 500, r.text
    assert "1 of 4 send(s)" in r.json()["detail"]["error"]


async def test_the_wired_crons_import_functions_that_actually_exist():
    """The other half of the fix: the names in the wire resolve.

    `services.skills.invoice_skills` did not exist and neither did the six
    beside it. These four do, and each takes `org_id` — which is the tenant
    boundary, not a convenience: `skill_dispatcher._run_function_step` refuses
    outright to call a skill handler that cannot be scoped to one organisation,
    and a cron handing a pool to something org-blind would read every tenant's
    rows at once.
    """
    import inspect

    from services.skills.action import generate_due_invoices, mark_holidays_weekends
    from services.skills.data import find_low_stock, find_overdue
    from services.skills.detect import score_deals

    for fn in (generate_due_invoices, mark_holidays_weekends,
               find_low_stock, find_overdue, score_deals):
        params = inspect.signature(fn).parameters
        assert "org_id" in params, f"{fn.__name__} cannot be scoped to one org"
        assert inspect.iscoroutinefunction(fn), f"{fn.__name__} is not awaitable"
