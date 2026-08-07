"""
scheduler.py — Cron-triggered endpoints for background jobs.

These endpoints are called by Railway cron or an external scheduler.
Protected by a shared secret, not user auth.
"""
import os
import logging
from fastapi import APIRouter, HTTPException, Header

import asyncio
import json
from services.reminder_service import scan_and_create_reminders, process_pending_reminders
from services.social_publisher import process_scheduled_posts
from services.skill_dispatcher import dispatch_skill
from db import get_pool

router = APIRouter(prefix="/api/internal", tags=["scheduler"])
log = logging.getLogger(__name__)

_background_tasks: set = set()

CRON_SECRET = os.getenv("CRON_SECRET", "")


async def _verify_cron(x_cron_secret: str = Header("")):
    # Constant-time. `!=` on a str short-circuits at the first differing byte,
    # so the time to fail leaks how many leading bytes were correct — and a cron
    # endpoint can be called as often as an attacker likes.
    from utils import secret_matches

    if not secret_matches(x_cron_secret, CRON_SECRET):
        raise HTTPException(403, "Invalid cron secret")


# ═══════════════════════════════════════════════════════════════════════════════
# A CRON THAT CANNOT DO ITS JOB MUST NOT ANSWER 200
# ═══════════════════════════════════════════════════════════════════════════════
#
# Seven of the thirteen handlers in this file used to be written like this:
#
#     try:
#         from services.skills.invoice_skills import generate_recurring_invoices
#         results["recurring"] = await generate_recurring_invoices(pool)
#     except ImportError:
#         results["error"] = "invoice_skills not available yet"
#     return results                                          # ← HTTP 200 OK
#
# `services.skills.invoice_skills` has never existed. Neither has crm_skills,
# hr_skills, marketing_skills, report_skills, esign_skills or stock_skills. Every
# one of those seven endpoints therefore answered 200 with an "error" key that no
# caller reads, `curl -sf` treated it as success, and nothing anywhere reported a
# failure. That is why recurring invoices were never generated and scheduled
# reports never dispatched, and why nobody found out.
#
# Measured against the live database on 2026-08-05, because a claim like that is
# worth a number: `staging.reminders` holds ZERO rows — not one reminder has ever
# been created — while 200 invoices sit past due and 41 CRM follow-ups are due or
# overdue. `scan_and_create_reminders` would have written 241 rows on its first
# tick. It has never ticked.
#
# THE RULE FROM HERE ON. A handler either does the work or answers with a status
# code that turns the caller red:
#
#   501  the implementation was never written. A retry cannot help — a person has
#        to write it — so the code says "not implemented" rather than "try later".
#   500  the work was attempted against real data and failed. A retry is
#        meaningful, and the next scheduled tick is that retry.
#   200  the work ran. Nothing else earns it.
#
# The imports below are consequently NOT guarded any more, and that is deliberate
# beyond taste: `tests/test_billing_lines_wiring.py` walks every call-time import
# in `routers/` and proves the module resolves, EXEMPTING anything inside a
# `try: … except ImportError`. Guarding an import opts it out of the only check
# that would have caught this. Unguarded, these seven are now policed on every
# test run.


def _not_built(job: str, missing: str, note: str) -> HTTPException:
    """The refusal for a cron whose implementation does not exist.

    RETURNS the exception rather than raising it, so the call site reads
    `raise _not_built(...)`. The `raise` stays visible where the refusal happens
    instead of hiding inside a helper, which matters when the next reader is
    scanning for which of these endpoints actually returns.

    501 and not 503, deliberately. `routers/billing.py:_billing_lines()` answers
    503 for a module that is expected to be present and is missing from THIS
    deploy — "half of this deploy has not landed, come back" is true there.
    Nothing about these is coming back: the module was never written. A nightly
    cron retrying against a 503 forever is a lie told on a schedule.

    The `note` is the part worth writing carefully. Whoever reads this is reading
    it in a Railway log at 03:00, and "not available yet" — the sentence that
    shipped here for months — tells them nothing about what to do.
    """
    log.error("Cron '%s' cannot run: %s. %s", job, missing, note)
    return HTTPException(501, {"job": job, "missing": missing, "note": note})


def fanout_failure(job: str, attempted: int, failures: dict) -> str | None:
    """The sentence a partly-failed per-org sweep must fail with, or None.

    PURE, and deliberately kept apart from the loop that produces its arguments.
    The loop only talks to a database, and the database is a MagicMock in every
    test in this repo — a mocked cursor resolves any query you hand it, so a test
    driving the loop proves that the loop ran, not that it judged correctly. The
    judgement is here, where it can be tested for what it is.

    ANY organisation failing fails the whole tick. It is not a footnote inside a
    200. `/cron/agents` used to collect per-org exceptions into `results["errors"]`
    and return them with a 200 — the same disease as the ImportError handlers,
    spelled differently: `curl -sf` sees success, the Railway cron stays green,
    and an org whose agent has raised every hour for a month looks exactly like
    an org with nothing to do.

    THE WORK ALREADY DONE IS NOT ROLLED BACK, and must not be. Every org is
    attempted before this is consulted, so a 500 here means "these failed, the
    rest were completed and their rows stand". The status code is a signal to a
    human, not a transaction boundary — there is no transaction spanning orgs and
    there should not be one.
    """
    if not failures:
        return None
    named = "; ".join(f"{org} — {err}" for org, err in sorted(failures.items()))
    return (
        f"cron '{job}' failed for {len(failures)} of {attempted} organisation(s). "
        f"The rest were processed and their work stands. Failures: {named}"
    )


def partial_failure(job: str, unit: str, attempted: int, failed: int) -> str | None:
    """The same judgement as `fanout_failure`, for jobs whose unit is not an org.

    PURE, for the same reason. A publish queue item, a pending reminder, a
    retention pass: each of these is a job that walks a list, records each
    item's own outcome durably, and used to return 200 whatever happened to
    them. The durable record is real and is not the point — `hub_publish_queue`
    does get `status='failed'` written on it, and somebody looking at the Prachar
    screen would see that. Nobody is looking at 03:00, which is when the cron
    runs, and the cron is the thing that is supposed to tell them.

    `attempted == 0` is a success. A tick with nothing due is the normal case for
    most of these and must not be a red cron; that is what distinguishes "nothing
    to do" from "could not do it", and conflating them is how a real failure gets
    ignored.
    """
    if failed <= 0:
        return None
    return (
        f"cron '{job}': {failed} of {attempted} {unit}(s) failed. The rest were "
        f"processed. Each failure is recorded against its own row; this status "
        f"code exists so the failure is noticed on the day it happens."
    )


async def _for_each_org(pool, job: str, work) -> dict:
    """Run one per-org coroutine for every active organisation, then judge.

    The seven skill crons were written as though the functions behind them took a
    pool and swept the whole product. NOT ONE of the real handlers does: every
    function in `services/skills/` takes `org_id` and filters on it, because that
    filter IS the tenant boundary. `skill_dispatcher._run_function_step` refuses
    outright to call a handler that cannot be scoped, for exactly this reason. So
    a cron over these handlers is a loop over organisations, and this is that
    loop, written once instead of five times slightly differently.

    `is_active IS NOT FALSE` is filtered here and is NOT in the older copy of this
    query in `/cron/agents`. A deactivated organisation should not have invoices
    generated for it or attendance written against its employees. `IS NOT FALSE`
    rather than `= TRUE` so a NULL — a row predating the column — is included
    rather than silently dropped from every sweep.
    """
    orgs = await pool.fetch(
        "SELECT id FROM staging.organisations "
        "WHERE is_active IS NOT FALSE ORDER BY id"
    )

    results: dict = {}
    failures: dict = {}
    for row in orgs:
        org_id = str(row["id"])
        try:
            results[org_id] = await work(org_id)
        except Exception as exc:                                     # noqa: BLE001
            # Logged with the traceback here and summarised in the raise below.
            # One org's failure must not stop the other orgs' work — that is the
            # whole reason this is a loop with a try rather than a bare gather.
            log.exception("Cron '%s' failed for organisation %s", job, org_id)
            failures[org_id] = f"{type(exc).__name__}: {exc}"

    problem = fanout_failure(job, len(orgs), failures)
    if problem:
        # No per-org payload in the detail: `JSONResponse` serialises an
        # HTTPException detail with plain `json.dumps`, which raises on the
        # Decimal and date objects these handlers return — and an exception
        # inside the error path would turn this 500 into a different, less
        # informative 500. The payload is in the log line above.
        raise HTTPException(500, {"job": job, "error": problem})

    log.info("Cron '%s': %d organisation(s) processed", job, len(orgs))
    return {"job": job, "organisations": len(orgs), "per_org": results}


@router.post("/cron/reminders", dependencies=[])
async def run_reminders(x_cron_secret: str = Header("")):
    """Scan for due items, create reminders, then send them.

    FULLY WIRED AND NEVER CALLED. Nothing in this file was more wrong than the
    old docstring's "Called every 15 min": measured against the live database on
    2026-08-05, `staging.reminders` contains ZERO rows, while 200 invoices are
    past due and 41 CRM follow-ups are due or overdue. `scan_and_create_reminders`
    would have written 241 rows on its first tick. There is no Railway cron for
    this endpoint and there never has been, so no customer of this product has
    ever received an overdue-invoice reminder, a follow-up reminder, an approval
    nudge or a task-due warning. The code is correct. It has simply never run.

    The service is intact and does both halves: the scan writes `staging.reminders`
    rows de-duplicated against recent ones (3 days for invoices, 1 day for the
    rest), and the send walks pending rows inside a per-reminder `org_scope` so
    each send is attributed to the right tenant in `staging.outbound_log`.

    A reminder that could not be sent is marked 'failed' on its own row and this
    now fails with it — see `partial_failure`.
    """
    await _verify_cron(x_cron_secret)
    scanned = await scan_and_create_reminders()
    sent = await process_pending_reminders()
    log.info("Cron reminders: scanned=%s sent=%s", scanned, sent)

    # `process_pending_reminders` marks a reminder 'failed' and carries on, so
    # `processed - sent` is exactly the number that raised. It used to be
    # returned inside a 200 where nothing computed the subtraction.
    problem = partial_failure(
        "reminders", "reminder",
        sent.get("processed", 0), sent.get("processed", 0) - sent.get("sent", 0),
    )
    if problem:
        log.error("Cron reminders: %s", problem)
        raise HTTPException(500, {"job": "reminders", "error": problem,
                                  "scanned": scanned, "sent": sent})
    return {"scanned": scanned, "sent": sent}


@router.post("/cron/publish", dependencies=[])
async def run_publish(x_cron_secret: str = Header("")):
    """Process scheduled social media posts.

    Wired and working — `services.social_publisher.process_scheduled_posts`
    exists and is complete. Like almost everything in this file, no Railway cron
    calls it.

    `publish_content` catches its own exceptions, writes `status='failed'` and
    the error onto the queue row, and returns `{"status": "failed", ...}`. The
    row is the durable record and it is genuinely visible on the Prachar screen.
    What was missing is the part that reaches an operator on the night it
    happens: this returned 200 with a list of failures in the body, so a token
    that expired six weeks ago produced a green cron every five minutes.
    """
    await _verify_cron(x_cron_secret)
    results = await process_scheduled_posts()
    log.info("Cron publish: %s", results)

    failed = sum(
        1 for r in (results or [])
        if isinstance(r, dict) and (r.get("status") == "failed" or "error" in r)
    )
    problem = partial_failure("publish", "post", len(results or []), failed)
    if problem:
        log.error("Cron publish: %s", problem)
        raise HTTPException(500, {"job": "publish", "error": problem})
    return {"result": results}


@router.post("/cron/retention", dependencies=[])
async def run_retention(x_cron_secret: str = Header("")):
    """Delete old log/activity data per retention policy. Called daily.

    THE ONE JOB WITH A SCHEDULER, and the handler is sound. `staging.cleanup_old_data()`
    was verified against the live catalogue on 2026-08-05: it exists, takes no
    arguments and returns `TABLE(table_name text, rows_deleted bigint)`, which is
    exactly what the comprehension below unpacks. Nothing here needs the
    treatment the rest of this file needed — a missing function or a failing
    delete raises out of asyncpg and this answers 500 already.

    The Railway service that calls it ("retention-cron", 0 3 * * *) is the only
    scheduler pointed at any endpoint in this file, and it has been failing on
    its own start command rather than on anything in here. That is being fixed in
    the Railway dashboard and deliberately not touched from the repo.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM staging.cleanup_old_data()")
    cleaned = {r["table_name"]: r["rows_deleted"] for r in rows}
    log.info("Cron retention: %s", cleaned or "nothing to clean")
    return {"cleaned": cleaned}


@router.post("/cron/pahchan-retention", dependencies=[])
async def run_pahchan_retention_cron(x_cron_secret: str = Header("")):
    """
    Pahchan's three retention deletions. Called daily.

    Separate from /cron/retention on purpose. That job trims logs and activity —
    losing a day of it costs nothing. This one deletes photographs of employees'
    faces and payroll records on a promise made to a client, so it needs its own
    result in the logs and its own failure to be visible rather than buried in
    another job's summary.

    Registered as its own Railway cron entry. 07 §5's three windows are
    independent and per-org; see services/pahchan_retention.py.
    """
    await _verify_cron(x_cron_secret)
    from services.pahchan_retention import run_pahchan_retention
    result = await run_pahchan_retention()
    log.info("Cron pahchan-retention: %s", result)

    # `run_pahchan_retention` isolates its three passes on purpose — a bucket
    # outage must not also stop record expiry, which needs no object store — and
    # records a failed pass as a `{name}_error` key in the result. That key then
    # came back inside a 200, which is the exact shape of the defect this whole
    # round is about, on the one job in the file whose failure means biometric
    # photographs of employees' faces are being retained past the window their
    # employer promised them.
    #
    # A BACKLOG IS NOT A FAILURE and is deliberately not raised here. A pass that
    # hit its per-run ceiling with work outstanding sets `{name}_drained` False,
    # already logs at WARNING inside the service, and will finish on the next
    # run. Failing on it would paint the cron red every night until a large
    # backfill drained — which trains whoever reads it to ignore the colour, and
    # then the real failure above arrives in the same colour they learned to
    # ignore.
    failed_passes = sorted(k for k in result if k.endswith("_error"))
    problem = partial_failure(
        "pahchan-retention", "retention pass", 3, len(failed_passes),
    )
    if problem:
        log.error("Cron pahchan-retention: %s — passes: %s",
                  problem, ", ".join(failed_passes))
        raise HTTPException(500, {"job": "pahchan-retention", "error": problem,
                                  "failed_passes": failed_passes})
    return result


# ---------------------------------------------------------------------------
# Extended cron jobs.
#
# Each of the seven below named a `services.skills.*_skills` module that has
# never existed, and answered 200 when the import failed. See the banner above
# `_not_built` for what that cost. Four of them turned out to have a real,
# working, org-scoped implementation sitting in `services/skills/` under a
# different name — those are wired. Three name work nobody has written — those
# now refuse with 501 and say exactly what is missing.
# ---------------------------------------------------------------------------


@router.post("/cron/invoices", dependencies=[])
async def run_invoices(x_cron_secret: str = Header("")):
    """Daily, per organisation: generate the recurring invoices that are due,
    and report how many invoices are past due.

    THE WIRE THAT WAS WRONG. `invoice_skills.generate_recurring_invoices` does
    not exist; `services.skills.action.generate_due_invoices` does, is org-scoped
    and does precisely that job — it reads `staging.ganit_recurring` for rows
    whose `next_date` has arrived, writes the invoice and advances `next_date`.
    `detect_overdue_invoices` is `data.find_overdue(module="invoices")`.

    THIS ENDPOINT WRITES INVOICES. Measured 2026-08-05: 4 of 44 recurring
    definitions are due right now, so the FIRST tick after a Railway cron is
    created will create 4 real invoices — and staging and production share one
    database. That is the intended behaviour of the feature and the reason it was
    built, but it is not a side effect anyone should meet by surprise.

    The overdue count is reported and logged, NOT acted on. Nothing here emails a
    customer about a late invoice; `scan_and_create_reminders` in
    `/cron/reminders` is what creates the `invoice_overdue` reminder rows and
    `process_pending_reminders` is what sends them. The number is here because an
    operator reading the nightly log should be able to see it moving, and because
    computing it costs one indexed read per org.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from services.skills.action import generate_due_invoices
    from services.skills.data import find_overdue

    async def _work(org_id: str) -> dict:
        recurring = await generate_due_invoices(pool, org_id)
        overdue = await find_overdue(pool, org_id, module="invoices", days_overdue=7)
        if overdue:
            log.warning(
                "Cron invoices: organisation %s has %d invoice(s) 7+ days past "
                "due. Reminders for these are created by /cron/reminders, not "
                "here.", org_id, len(overdue),
            )
        return {"recurring": recurring, "overdue_7d": len(overdue)}

    return await _for_each_org(pool, "invoices", _work)


@router.post("/cron/crm", dependencies=[])
async def run_crm(x_cron_secret: str = Header("")):
    """Daily, per organisation: score open deals for health and count overdue
    follow-ups.

    THE WIRE THAT WAS WRONG. `crm_skills.flag_stale_deals` is
    `services.skills.detect.score_deals`; `flag_overdue_followups` is
    `data.find_overdue(module="follow_ups")`. Both exist, both are org-scoped,
    both are read-only.

    READ-ONLY, AND THE NAME IT USED TO CARRY WAS A PROMISE IT CANNOT KEEP.
    "flag" implies writing a flag onto the deal. There is no such column on
    `staging.graha_deals` and no handler that writes one. What exists is a
    scorer, and a score is a JUDGEMENT — `skill_dispatcher` classifies this whole
    family as DETECT for that reason: it belongs in front of a person, not wired
    straight to an action. So this counts and logs, and the counts are the
    output. Anything that acts on them is a feature that has not been built, and
    building it from a cron handler is the wrong place to start.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from services.skills.data import find_overdue
    from services.skills.detect import score_deals

    async def _work(org_id: str) -> dict:
        deals = await score_deals(pool, org_id)
        followups = await find_overdue(pool, org_id, module="follow_ups", days_overdue=0)
        by_health: dict = {}
        for d in deals:
            by_health[d["health"]] = by_health.get(d["health"], 0) + 1
        if by_health.get("critical") or followups:
            log.warning(
                "Cron crm: organisation %s has %d critical deal(s) and %d overdue "
                "follow-up(s). Nothing acts on these — see the docstring.",
                org_id, by_health.get("critical", 0), len(followups),
            )
        return {"deals_scored": len(deals), "by_health": by_health,
                "overdue_followups": len(followups)}

    return await _for_each_org(pool, "crm", _work)


@router.post("/cron/leads", dependencies=[])
async def run_leads(x_cron_secret: str = Header("")):
    """Every 15 minutes: pull IndiaMART enquiries for every org that has a key.

    NOT on `/cron/crm`, which runs daily. IndiaMART's own floor is one call per
    15 minutes and their window is anchored on the last successful pull, so a
    daily schedule would leave an enquiry sitting unread for up to 24 hours —
    which for a lead marketplace is the difference between a sale and a
    competitor's sale. Fifteen minutes is their limit and therefore the cadence.

    JUSTDIAL IS NOT HERE, and that is not an omission. It PUSHES: their servers
    POST to `/api/v1/graha/leads/justdial/{webhook_key}` the moment a lead is
    raised. Polling for something already being pushed would be two paths to the
    same rows and the slower one would win the race half the time.

    ONLY ORGS THAT HAVE OPTED IN. The query names the credentials table, so an
    organisation with no IndiaMART card is never touched and this costs nothing
    for the ~all of them that do not use it. `_for_each_org` is deliberately not
    used for the same reason: it would walk every organisation on the platform to
    discover that almost none have a key.

    A per-org failure is recorded and skipped, never raised. One expired key must
    not stop the other organisations' leads arriving — and the reason is already
    on their card, because `pull_indiamart_for_org` writes it there.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from routers.lead_sources import PullResult, pull_indiamart_for_org

    rows = await pool.fetch(
        "SELECT org_id::text AS org_id FROM staging.hub_connector_credentials "
        " WHERE platform='indiamart' AND client_id IS NULL AND is_active=TRUE",
    )

    pulled = skipped = failed = 0
    created = updated = 0
    for row in rows:
        org_id = row["org_id"]
        try:
            out = await pull_indiamart_for_org(pool, org_id)
            pulled += 1
            created += out.get("created", 0)
            updated += out.get("updated", 0)
        except PullResult as stop:
            # 429 is the ordinary case, not an error: this runs every 15 minutes
            # and an org pulled by hand a moment ago is simply not due yet.
            if stop.status == 429:
                skipped += 1
            else:
                failed += 1
                log.warning("Cron leads: organisation %s — %s", org_id, stop.detail)
        except Exception as exc:                        # noqa: BLE001 — reported
            failed += 1
            log.warning("Cron leads: organisation %s raised %s", org_id, exc)

    return {"orgs_with_a_key": len(rows), "pulled": pulled,
            "not_due": skipped, "failed": failed,
            "leads_created": created, "leads_matched": updated}


@router.post("/cron/hr", dependencies=[])
async def run_hr(x_cron_secret: str = Header("")):
    """Daily, per organisation: write attendance rows for weekends and declared
    holidays.

    THE WIRE THAT WAS WRONG, AND THE DOCSTRING THAT WAS ALSO WRONG. This said
    "auto-mark ABSENT employees who didn't check in" and imported
    `hr_skills.auto_mark_attendance`. No absence marker exists anywhere in the
    tree, and `services/attendance_bridge.py:296` records the reason in prose:
    writing an 'absent' row asserts that someone did not work, which the system
    cannot know from the absence of a punch. What DOES exist is
    `services.skills.action.mark_holidays_weekends` — the module is literally
    named `attendance_auto_mark` — which fills in 'holiday' and 'weekend' rows so
    those days are not mistaken for gaps. That is the job; the docstring now says
    so rather than promising a marker nobody wrote.

    THIS ENDPOINT WRITES ATTENDANCE ROWS. It inserts one row per active employee
    per weekend or holiday date, skipping any employee who already has a row for
    that date. Measured 2026-08-05: 80 active employees, so a Saturday tick
    writes up to 80 rows — against the database production also uses.

    It marks TODAY only, and only when today is a weekend or a declared holiday;
    on a working day it returns `{"marked": 0}` without writing. A missed day is
    therefore not backfilled by the next run, which is an argument for scheduling
    it daily rather than weekly.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from services.skills.action import mark_holidays_weekends

    async def _work(org_id: str) -> dict:
        return await mark_holidays_weekends(pool, org_id)

    return await _for_each_org(pool, "hr", _work)


@router.post("/cron/marketing", dependencies=[])
async def run_marketing(x_cron_secret: str = Header("")):
    """Every 5 min: send campaigns whose scheduled time has arrived, and advance
    drip enrolments whose next message is due.

    THE ONLY ONE OF THE SEVEN WHOSE MODULE NOW GENUINELY EXISTS.
    `services/skills/marketing_skills.py` was written to the signature the stub
    already imported — `process_scheduled_campaigns(pool)` and
    `process_sequence_steps(pool)`, both global sweeps with their own per-tick
    ceilings — so this handler needed only its guard removed, not rewiring. It is
    the ONE endpoint in this file whose implementation lives outside
    `services/skills/{data,action,detect}/` and therefore does NOT go through
    `_for_each_org`: both functions select their own due rows across every
    tenant and carry their own limits.

    THIS ENDPOINT SENDS MAIL TO CUSTOMERS. Not a metric, not a row — actual
    delivery, and `OUTBOUND_MODE` on staging is not dry. A campaign sends up to
    5,000 recipients in one call and the ceiling is 5 campaigns per tick, so one
    tick is bounded at roughly 25,000 messages. Creating the Railway cron for
    this is the moment the product starts mailing on a timer for the first time;
    it deserves to be the last of the crons switched on, and switched on with
    somebody watching.

    A campaign or enrolment that failed is counted by the module and this fails
    with it, rather than reporting the failure inside a 200.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from services.skills.marketing_skills import (
        process_scheduled_campaigns, process_sequence_steps,
    )

    campaigns = await process_scheduled_campaigns(pool)
    sequences = await process_sequence_steps(pool)
    log.info("Cron marketing: campaigns=%s sequences=%s", campaigns, sequences)

    # ── COUNTED BY WHAT SUCCEEDED, NOT BY WHAT FAILED ───────────────────────
    #
    # This read `sequences.get("error")` alone. `process_sequence_steps` buckets
    # by the executor's own status string — `summary[status] += 1` — and the
    # executor RETURNS `{"status": "failed"}` for a step whose transport
    # refused, reserving "error" for something that raised. So every genuinely
    # failed send landed in a bucket nothing looked at, and the tick reported
    # success.
    #
    # Enumerating the failure names again is exactly how that happened, and the
    # next status added would repeat it. So the SUCCESS names are enumerated
    # instead and everything else counts as a failure: an unrecognised bucket
    # now fails the tick loudly rather than passing silently. The two lists are
    # written out literally rather than derived from one another, because a
    # forbidden set computed as ALL-minus-ALLOWED cannot notice the allowed set
    # widening — a trap this repository walked into twice today.
    _SEQ_OK = ("sent", "logged", "completed", "unsubscribed", "skipped")
    seq_ok = sum(int(sequences.get(k) or 0) for k in _SEQ_OK)
    seq_failed = max(0, int(sequences.get("due") or 0) - seq_ok)

    failed = int(campaigns.get("failed") or 0) + seq_failed
    attempted = int(campaigns.get("due") or 0) + int(sequences.get("due") or 0)
    problem = partial_failure("marketing", "send", attempted, failed)
    if problem:
        log.error("Cron marketing: %s", problem)
        raise HTTPException(500, {"job": "marketing", "error": problem})

    return {"campaigns": campaigns, "sequences": sequences}


@router.post("/cron/reports", dependencies=[])
async def run_reports(x_cron_secret: str = Header("")):
    """NOT IMPLEMENTED — 501, and the job you want is at a different URL.

    `report_skills.execute_scheduled_reports` was never written. The equivalent
    for the older team-scoped schedules DOES exist and is complete:
    `POST /api/reports/dispatch` (`routers/reports.py:dispatch_reports`) reads
    `public.report_schedules WHERE next_run_at <= now`, renders the PDF and
    Excel, mails every recipient inside an `org_scope`, and advances
    `next_run_at`. It has its own secret, REPORT_DISPATCH_SECRET, and its own
    docstring says "called hourly by Railway cron" — and no Railway cron calls
    it. That is the report cron this product needs and it needs scheduling, not
    rewriting.

    The newer per-org `staging.dristi_scheduled_reports` (7 rows live) NOW HAS
    ITS OWN SWEEP — `POST /api/v1/dristi/scheduled-reports/dispatch`, with the
    due-rule in `services/report_schedule_window.py`, its own arming variable
    (`DRISTI_REPORT_SWEEP_ARMED`) and a per-tick entitlement re-check. It is
    also unscheduled. So: two scheduled-report systems, two dispatchers, no
    timer on either.

    Reimplementing dispatch here would make a THIRD, over a table that already
    has one, and two dispatchers walking one table is worse than none — they
    would each mark the other's send as not-yet-sent for the length of a race.
    It refuses instead and names where to look.
    """
    await _verify_cron(x_cron_secret)
    raise _not_built(
        "reports",
        "services.skills.report_skills.execute_scheduled_reports was never written",
        "Do not rebuild it here. POST /api/reports/dispatch already dispatches "
        "public.report_schedules in full and needs only a Railway cron and its "
        "own REPORT_DISPATCH_SECRET. Separately, staging.dristi_scheduled_reports "
        "has its own sweep at POST /api/v1/dristi/scheduled-reports/dispatch, "
        "which also needs only a cron and its DRISTI_REPORT_SWEEP_ARMED flag. "
        "Both tables are dispatched; neither is scheduled. Do not write a third.",
    )


@router.post("/cron/esign", dependencies=[])
async def run_esign(x_cron_secret: str = Header("")):
    """NOT IMPLEMENTED — 501. Signing reminders are one-at-a-time and manual.

    `esign_skills.send_signing_reminders` was never written. Sending a signing
    reminder to ONE signer exists at `routers/esign.py:691` and is driven by a
    person pressing a button; there is no query that finds every document still
    waiting on a signature and no rule for how often to nag the same signer.

    NOT WIRED TO THE NEAREST NEIGHBOUR, ON PURPOSE.
    `services.skills.action.document_expiry.process_expiry(pool, org_id)` is real,
    org-scoped, unscheduled, and does a related but DIFFERENT job: it warns about
    contracts whose `end_date` is within 7 days and marks expired ones. Wiring it
    to an endpoint named "esign" would mean that creating the cron this docstring
    asks for starts sending email nobody asked for, to addresses on live contract
    rows, from a job whose name says it does something else. That is a decision
    for the owner, not for whoever is fixing the imports — it is in the report
    instead.
    """
    await _verify_cron(x_cron_secret)
    raise _not_built(
        "esign",
        "services.skills.esign_skills.send_signing_reminders was never written",
        "Reminding ONE signer exists at routers/esign.py:691 and is manual. "
        "There is no sweep over documents awaiting signature and no re-nag "
        "policy. Note separately that services.skills.action.document_expiry."
        "process_expiry(pool, org_id) is a real, unscheduled daily job for "
        "CONTRACT EXPIRY — a different thing that also sends email, and it is "
        "not wired here because that would be a surprise, not a fix.",
    )


@router.post("/cron/stock", dependencies=[])
async def run_stock(x_cron_secret: str = Header("")):
    """Daily, per organisation: count items at or below their low-stock threshold.

    THE WIRE THAT WAS WRONG. `stock_skills.alert_low_stock` is
    `services.skills.data.find_low_stock`, which exists and is org-scoped.

    IT REPORTS; IT DOES NOT ALERT. There is no notification path behind this —
    no recipient list, no template, nothing that decides whether an item at its
    threshold is worth waking someone for. `find_low_stock` returns the rows and
    this logs the count at WARNING, which puts it in front of whoever reads the
    daily log and nowhere else. Calling that an alert would be the same overclaim
    the old name made.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from services.skills.data import find_low_stock

    async def _work(org_id: str) -> dict:
        low = await find_low_stock(pool, org_id)
        if low:
            log.warning(
                "Cron stock: organisation %s has %d item(s) at or below the "
                "low-stock threshold. Nothing notifies anyone — see the "
                "docstring.", org_id, len(low),
            )
        return {"low_stock": len(low),
                "items": [i["item"]["name"] for i in low[:20]]}

    return await _for_each_org(pool, "stock", _work)


@router.post("/cron/agents", dependencies=[])
async def run_agents(x_cron_secret: str = Header("")):
    """Hourly: run the deadline agent for every active organisation.

    Was not one of the seven guarded stubs — `services.agents.deadline_agent`
    has always existed and this has always been able to run. It had the same
    disease in a different form: per-org exceptions were collected into
    `results["errors"]` and returned with a 200, so an agent raising for every
    org every hour was indistinguishable from an agent with nothing to do. It now
    goes through `_for_each_org` like the rest, which fails the tick if any org
    failed.

    The org query also gains `is_active IS NOT FALSE`, which the hand-rolled loop
    here did not have.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    from services.agents.deadline_agent import DeadlineAgent
    agent = DeadlineAgent()

    async def _work(org_id: str) -> dict:
        # `_for_each_org` can only see a RAISE, and `BaseAgent.execute` never
        # raises: `services/agents/base.py:38-43` catches every exception, sets
        # status='error' and RETURNS {"error": str(exc)}. So the swallowing this
        # endpoint was supposed to have stopped simply moved one level down —
        # an agent failing for every org, every hour, still answered 200.
        #
        # The error is re-raised here rather than in BaseAgent because that
        # wrapper's contract is deliberate: it records the run in
        # hub_skill_runs and returns, so a caller running many agents is not
        # stopped by one. This caller wants the opposite, and says so.
        result = await agent.execute(pool, org_id, {}) or {}
        if result.get("error"):
            raise RuntimeError(f"deadline agent failed for org {org_id}: {result['error']}")
        return result

    return await _for_each_org(pool, "agents", _work)


async def _org_can_spend(pool, org_id: str) -> bool:
    """Can this org afford anything at all right now?

    A damper, not an enforcement. `credits.spend` inside the dispatcher is what
    actually refuses; this exists so that an org sitting at zero produces ONE
    log line per cron tick instead of one failed run row per scheduled skill per
    tick, forever. A skill is never disabled for it — a top-up resumes
    everything on the next tick with nobody re-enabling anything.

    Reads the ORG balance and nothing else. A member ceiling is deliberately not
    damped here — see `run_skills`. Skipping a dispatch is not free: a skill
    whose steps are all function-backed charges nothing at all, and this damper
    stops it running too. That is an accepted cost when the org has no credits
    and the whole wallet is empty; it is not one worth paying for one member's
    monthly limit while the org is solvent.

    Fails OPEN. If the balance cannot be read the skill is dispatched anyway and
    the spend decides; a damper that refuses work because it could not read a
    number is worse than the noise it prevents.
    """
    from services import credits

    try:
        async with pool.acquire() as conn:
            bal = await credits.balance_of(conn, org_id)
    except Exception as exc:                                   # noqa: BLE001
        log.warning("Cron skills: could not read the balance for org %s (%s) — "
                    "dispatching anyway", org_id, exc)
        return True
    # A platform org skips the balance check and nothing else, so a zero balance
    # there is not a refusal. Its spends are still metered into the ledger.
    return bal.is_platform_org or bal.total > 0


@router.post("/cron/skills", dependencies=[])
async def run_skills(x_cron_secret: str = Header("")):
    """Dispatch cron-triggered skills whose interval has elapsed. Called every 15 min.

    Every LLM step this dispatches is now CHARGED — see
    services/skill_dispatcher._run_llm_step. Until this change a scheduled skill
    generated content forever and billed nothing, while the identical skill run
    by hand from the Skills screen deducted before it generated. The provider
    invoice arrived either way.

    The spend is attributed to `hub_client_skills.assigned_by`: a timer bills the
    person who scheduled it. That column has existed since migration 012 and was
    simply never selected here. Where it is NULL the org balance still applies
    and the member ceiling does not — an unattributable spend cannot be counted
    against anyone's ceiling, and refusing it instead would stop every skill
    assigned before that column was populated.

    WHICH MEANS: the assignee's MONTHLY CEILING now applies to a timer they may
    have set months ago, and it is charged against the same ceiling as the work
    they do by hand. A skill ticking hourly can therefore consume the ceiling
    that their interactive work needs. That is kept, because the alternative —
    passing no user_id for scheduled runs — makes a schedule the one channel a
    capped member can spend the org's balance through without it counting
    anywhere, and a ceiling with a documented way around it is not a ceiling.
    The remedy stays where the ceiling is: an org admin raises the limit.

    A ceiling refusal STOPS the run — `_run_llm_step` charges before it
    generates, so nothing is produced free — and is written onto the run row.
    Nothing on this path notifies anyone; the outputs are the run row and one
    WARNING below.

    It is NOT damped like an empty org wallet, and that is a choice rather than
    an oversight. `_org_can_spend` reads the org balance, sees a solvent org and
    dispatches, so a capped-out member's skill fails once per its own interval
    until the period rolls over or the limit is raised. Damping it would mean
    skipping the dispatch, which also skips the skill's function-backed steps —
    and those charge nothing, so a data-only skill would stop running to save a
    refusal that would never have happened. `last_run_at` is what bounds this:
    the recurrence is the customer's own interval, not the 15-minute tick.
    """
    await _verify_cron(x_cron_secret)
    pool = await get_pool()

    # Find active client_skills with cron trigger whose interval has passed
    rows = await pool.fetch("""
        SELECT cs.id AS client_skill_id, cs.org_id, cs.client_id,
               cs.custom_config, cs.last_run_at, cs.assigned_by,
               t.id AS template_id, t.name, t.description, t.skill_type,
               t.scope, t.module, t.steps, t.trigger_config, t.is_system
        FROM staging.hub_client_skills cs
        JOIN staging.hub_skill_templates t ON t.id = cs.template_id
        WHERE cs.is_active = TRUE
          AND t.trigger_config IS NOT NULL
          AND (t.trigger_config->>'type') = 'cron'
          AND (
            cs.last_run_at IS NULL
            OR cs.last_run_at + make_interval(
              mins := (t.trigger_config->>'interval_minutes')::int
            ) <= now()
          )
    """)

    if not rows:
        log.info("Cron skills: nothing due")
        return {"dispatched": 0, "skipped_no_credits": 0}

    dispatched = 0
    skipped_no_credits = 0
    #: org_id -> affordable. One balance read per ORG per tick, not per skill.
    affordable: dict = {}

    for r in rows:
        template = {
            "id": str(r["template_id"]),
            "name": r["name"],
            "description": r["description"],
            "skill_type": r["skill_type"],
            "scope": r["scope"],
            "module": r["module"],
            "steps": r["steps"],
            "trigger_config": r["trigger_config"],
            "is_system": r["is_system"],
        }
        variables = r["custom_config"] if r["custom_config"] else {}
        org_id = str(r["org_id"]) if r["org_id"] else None

        if not org_id:
            log.warning("Skipping skill %s — no org_id", r["client_skill_id"])
            continue

        if org_id not in affordable:
            affordable[org_id] = await _org_can_spend(pool, org_id)
        if not affordable[org_id]:
            skipped_no_credits += 1
            continue

        task = asyncio.create_task(
            _run_and_update_skill(
                pool, r["client_skill_id"], template, variables, org_id,
                # `str()` normalises, it does not convert. assigned_by is text in
                # the live catalog and holds `user_{hex12}`, so this is a no-op
                # there; migration 012 declares the column UUID, so a database
                # built from this repo hands back a uuid.UUID object instead.
                # One string type reaches the dispatcher and the ledger either
                # way. Do NOT re-coerce it to uuid.UUID downstream — that is the
                # bug this line's previous comment asserted into existence.
                user_id=str(r["assigned_by"]) if r["assigned_by"] else None,
            )
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
        dispatched += 1

    if skipped_no_credits:
        # ONE line, naming the count and the orgs — not one per skill. This is
        # the "must not spam" half of the out-of-credits decision.
        broke = sorted(o for o, ok in affordable.items() if not ok)
        log.warning(
            "Cron skills: %d scheduled skill(s) not dispatched — %d organisation(s) "
            "have no credits (%s). Nothing was disabled; they resume on a top-up.",
            skipped_no_credits, len(broke), ", ".join(broke),
        )

    log.info("Cron skills: dispatched=%d skipped_no_credits=%d",
             dispatched, skipped_no_credits)
    return {"dispatched": dispatched, "skipped_no_credits": skipped_no_credits}


async def _run_and_update_skill(pool, client_skill_id, template, variables, org_id,
                                user_id=None):
    """Run a skill and update last_run_at.

    `last_run_at` is bumped for EVERY outcome, including an out-of-credits
    refusal, and that is deliberate. Not bumping it would make the skill due
    again on the very next tick, so an org holding 1 credit against a 2-credit
    step would produce a failed run row every 15 minutes indefinitely — a retry
    storm dressed up as diligence. The interval is the customer's own setting
    and it is respected whatever the outcome.

    What stops the slot being consumed SILENTLY is the other half: the refusal
    is written onto the run row by `dispatch_skill` with the sentence naming what
    was needed and what is held, it is logged here at WARNING with the skill
    named, and `run_skills` stops dispatching the org entirely once its balance
    reaches zero.
    """
    try:
        result = await dispatch_skill(
            pool=pool,
            skill_template=template,
            variables=variables,
            org_id=org_id,
            user_id=user_id,
            client_skill_id=str(client_skill_id),
        )
        if (result or {}).get("status") == "insufficient_credits":
            # The CODE and the person billed, not the sentence alone. Two
            # different refusals arrive here under one status:
            # org_credits_exhausted, whose remedy is a top-up from Aekam, and
            # member_cap_exceeded, whose remedy is an org admin raising one
            # person's limit while the org's balance sits untouched. They are
            # also distinguishable by their recurrence — the org one stops
            # dispatching entirely on the next tick, the member one does not —
            # so an operator who cannot tell them apart chases the wrong remedy
            # for the one that keeps reappearing.
            log.warning(
                "Scheduled skill '%s' (client_skill=%s, org=%s, billed=%s) "
                "stopped after %s step(s) [%s]: %s",
                template.get("name"), client_skill_id, org_id, user_id,
                result.get("steps_completed"),
                result.get("credit_error"), result.get("error"),
            )
    except Exception:
        log.exception("Skill dispatch error: client_skill=%s", client_skill_id)
    finally:
        await pool.execute(
            "UPDATE staging.hub_client_skills SET last_run_at = now() WHERE id = $1",
            client_skill_id,
        )
