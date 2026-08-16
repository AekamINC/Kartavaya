"""Scraper marketplace — curated Apify actors with margin billing."""
import asyncio
import json
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth_router import require_user
from db import get_pool
from middleware.org_resolver import get_org_id
from middleware.roles import require_platform_role
from middleware.role_tiers import FINANCE_CONSOLE_ROLES, OPERATIONS_CONSOLE_ROLES
from middleware.subscription import require_module

# F4 (b). Shared with graha.py rather than re-implemented: two copies of a
# response contract is how one of them ends up reporting a total the other does
# not, and the whole point of this key is that a client can trust it.
from routers.graha import _listed

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/scrapers", tags=["scrapers"])
_gate = require_module("sahayak")

#: Background pollers, held so the event loop does not collect one mid-run.
#:
#: `asyncio.ensure_future` returns a task the loop only weakly references. A run
#: whose poller is collected stays 'running' forever with the upfront debit
#: never reversed — the same end state as a restart mid-poll, and the reason
#: `sweep_stranded_runs` exists. `routers/scheduler.py` already keeps a set for
#: exactly this; this is the same pattern, not a new one.
_pollers: set = set()


def _spawn(coro) -> None:
    task = asyncio.ensure_future(coro)
    _pollers.add(task)
    task.add_done_callback(_poller_done)


def _poller_done(task) -> None:
    """Drop the reference — and never let the loop eat the reason.

    The callback used to be `_pollers.discard` and nothing else. Nobody awaits a
    poller, so an exception inside `_poll_run` was retrieved by no one: asyncio
    only complains about an unretrieved task exception when the task is
    collected, and a set that has just discarded it makes that moment arbitrary
    and the message contextless. A stranded run therefore had no line anywhere
    naming it — the first sign was a customer asking where their results went.

    This cannot refund and must not pretend to: it is handed a task, not a
    transaction id. `sweep_stranded_runs` moves the money. This only makes sure
    the incident is findable before the next boot.
    """
    _pollers.discard(task)
    if task.cancelled():                # `.exception()` would re-raise it
        return
    exc = task.exception()
    if exc is not None:
        log.error("Scraper poller died: %s — the run it was polling is stranded "
                  "until the next sweep", exc, exc_info=exc)


#: How long a run may sit 'pending' or 'running' before it is presumed stranded.
#:
#: `_poll_run` gives up after 120 × 5s = 10 minutes and refunds itself, so
#: anything older than this budget is a poller that died rather than one still
#: working — a restart, a deploy, or a collected task. 20 minutes leaves room
#: for a slow final dataset fetch without leaving a customer's credits held
#: hostage to a process that is not coming back.
POLL_BUDGET_MINUTES = 20


def _upfront_key(db_run_id: str) -> str:
    """The idempotency key for a run's minimum-upfront debit.

    Built from the run id and nothing else, deliberately: a key carrying a
    timestamp or a fresh uuid is decoration, not idempotency. Two attempts to
    charge the same run cannot both take money, and `sweep_stranded_runs` relies
    on that to find what a stranded run was charged.
    """
    return f"scraper:{db_run_id}:min"


def _trueup_key(db_run_id: str) -> str:
    return f"scraper:{db_run_id}:trueup"


async def _deduct_extra_credits(pool, org_id: str, user_id: str, extra: int,
                                run_id: str, scraper_id: str):
    """Charge the difference between the minimum taken upfront and the real cost.

    The clamp this replaced was `new_bal = max(0, balance - extra)` while the
    ledger row was written with the full `-extra` and the clamped balance as
    `balance_after`. So an org that could not afford the true-up had it silently
    forgiven, AND the ledger permanently disagreed with the wallet from that row
    onward — `SUM(amount)` and `balance` diverge by whatever was forgiven, for
    the life of the org.

    Now it goes through `credits.spend`, which refuses rather than forgives. A
    refusal is logged as a DEBT: the run succeeded, the customer has the data,
    and the remainder is owed. It is not written to `credits_charged`, which
    stays equal to what the ledger actually moved — a figure that agrees with
    the wallet is worth more than one that agrees with the invoice we wish we
    had sent.

    Raises rather than swallowing, so `_poll_run` can log the debt with the run,
    the org and the amount in scope — a warning here would name the amount and
    nothing else. `_poll_run` is where the swallowing belongs; it is the thing
    that must survive.
    """
    from services import credits

    if extra <= 0:
        return None
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await credits.spend(
                conn,
                org_id=org_id,
                user_id=user_id or None,
                kind="scraper_trueup",
                ref_id=scraper_id,
                # The true-up price is not a function of (kind, ref_id) alone —
                # it is the real Apify cost marked up, minus what was already
                # taken — so it arrives as an override. It still passes every
                # check inside `spend`; the override skips nothing.
                credits_override=extra,
                idempotency_key=_trueup_key(run_id),
                description=f"scraper true-up run:{run_id[:8]}",
            )


async def _refund_credits(pool, tx_id: Optional[str], run_id: Optional[str], why: str,
                          user_id: Optional[str] = None):
    """Return the upfront charge when a run produced nothing (F29).

    Credits are debited BEFORE Apify is called, and the response tells the user
    "minimum upfront — final charge after run completes". On failure nothing
    ran, so the charge was never final: measured on staging, a run that failed at
    Apify kept 2 credits and recorded billed_inr 50 against 0 rows, and the
    balance never moved back.

    It now names the TRANSACTION it reverses rather than an amount. The old
    version took `amount` from the caller, which is how a trued-up run refunded
    only its minimum and the extra was simply kept: nothing in a bare integer
    can know a second debit happened. `credits.refund` reads the original row,
    returns to the bucket it took from, and the database enforces refund-once.

    `billed_inr` is zeroed with the refund. Leaving it at 50 while the credits
    came back would leave the cost report attributing spend to a run that cost
    nothing, which is how the two disagree again.

    Best-effort and never raises: this runs in a background poller, and a failed
    refund must not also lose the error that caused it. It logs loudly instead.
    """
    from services import credits

    if not tx_id:
        return
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await credits.refund(
                    conn,
                    tx_id=tx_id,
                    reason=f"scraper run:{run_id[:8]} — {why}" if run_id
                    else f"scraper — {why}",
                    user_id=user_id,
                )
                if run_id:
                    await conn.execute(
                        "UPDATE staging.hub_scraper_runs SET billed_inr=0 WHERE id=$1::uuid",
                        run_id,
                    )
        log.info("Refunded scraper run %s (%s), tx=%s", run_id, why, tx_id)
    except Exception as e:
        log.error("Credit refund FAILED for run %s tx %s: %s — the customer is owed "
                  "this run's charge", run_id, tx_id, e)


async def _fail_run(pool, run_id: str, error: str):
    """Mark a run failed. Never raises — it runs beside a refund on a path that
    is already handling a failure."""
    try:
        await pool.execute(
            "UPDATE staging.hub_scraper_runs SET status='failed', error=$2, "
            "finished_at=NOW() WHERE id=$1::uuid AND status IN ('pending','running')",
            run_id, error[:500],
        )
    except Exception as e:                                     # noqa: BLE001
        log.error("Could not mark scraper run %s failed: %s", run_id, e)


async def sweep_stranded_runs() -> dict:
    """Refund runs whose poller never came back. Called once at startup.

    `_poll_run` is an in-process `asyncio` task. A deploy, a crash or a
    collected task in the middle of one leaves the row 'running' forever with
    the upfront debit taken and nothing that will ever reverse it — the customer
    pays for a run they never got a result from, and no screen tells anyone.
    Every refund path in this file lived inside the poller, so losing the poller
    lost the refund with it.

    Finding what a stranded run was charged, without reading the ledger:
    `spend()` is idempotent on `idempotency_key`, and the replay check is the
    FIRST thing it does — before the price lookup, before the cap check, before
    the balance check. So calling it again with the run's own upfront key
    returns the original receipt, `replayed=True`, having written nothing. That
    receipt carries the `tx_id` the refund needs.

    The `else` branch is the honest one: if the key does NOT replay, this run was
    never charged (its transaction rolled back), and the call just made a debit
    that must come straight back out. Both branches refund, so the net is
    correct either way and the ledger shows the pair. An org too poor to absorb
    that momentary debit raises instead — and a run that was never charged has
    nothing owed to it, so there is nothing to lose.

    `credits.refund` is refund-once at the database, so a second replica running
    this at the same moment cannot double-refund.

    C1 wires the single call in `server.py`; this function is deliberately not
    self-scheduling.
    """
    from services import credits

    pool = await get_pool()
    swept, failed = 0, 0
    try:
        rows = await pool.fetch(
            "SELECT id, org_id, scraper_id, user_id, credits_charged "
            "FROM staging.hub_scraper_runs "
            "WHERE status IN ('pending','running') "
            "  AND started_at < NOW() - make_interval(mins := $1) "
            "ORDER BY started_at LIMIT 500",
            POLL_BUDGET_MINUTES,
        )
    except Exception as e:                                     # noqa: BLE001
        log.error("Stranded-run sweep could not read runs: %s", e)
        return {"swept": 0, "failed": 0, "error": str(e)}

    for r in rows:
        run_id = str(r["id"])
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    receipt = await credits.spend(
                        conn,
                        org_id=str(r["org_id"]),
                        user_id=r["user_id"] or None,
                        kind="scraper",
                        ref_id=r["scraper_id"],
                        idempotency_key=_upfront_key(run_id),
                        description=f"scraper:{r['scraper_id']} (minimum upfront)",
                    )
                    if not receipt.replayed:
                        log.warning(
                            "Stranded run %s had no upfront debit — the run row "
                            "outlived its transaction. Reversing the probe.", run_id)
                    await credits.refund(
                        conn, tx_id=receipt.tx_id,
                        reason=f"scraper run:{run_id[:8]} — poller lost, run never "
                               f"reported a result",
                        user_id=r["user_id"] or None,
                    )
                    await conn.execute(
                        "UPDATE staging.hub_scraper_runs SET status='failed', "
                        "error='The run was interrupted and never reported a result. "
                        "The credits have been returned.', billed_inr=0, finished_at=NOW() "
                        "WHERE id=$1::uuid AND status IN ('pending','running')",
                        run_id,
                    )
            swept += 1
        except Exception as e:                                 # noqa: BLE001
            failed += 1
            log.error("Stranded-run sweep failed for run %s: %s", run_id, e)

    if swept or failed:
        log.warning("Stranded scraper runs swept=%d failed=%d", swept, failed)
    return {"swept": swept, "failed": failed}


class RunScraper(BaseModel):
    scraper_id: str
    inputs: dict = {}


# ── Catalog ──────────────────────────────────────────────

@router.get("/catalog")
async def list_scrapers(
    category: Optional[str] = None,
    user=Depends(require_user),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `SELECT *` here served `cost_per_run` and `margin_pct` — our per-scraper
    # supplier cost and our markup — to every org user with a Sahayak grant, on an
    # unremarkable catalog listing. `apify_actor_id` goes with them: it names the
    # exact marketplace actor behind each entry, which is the other half of
    # reproducing the offering without us. Columns are now enumerated, so a new
    # commercial column added to this table is not published by default.
    # `credit_cost` is the one price the caller MUST have: it is what this
    # handler's sibling `POST /run` charges — through `credits.price_of`, which
    # reads this same column — and the catalog card, the confirmation line and
    # the Run button all print it. Enumerating the columns to stop `cost_per_run`
    # and `margin_pct`
    # leaking took this with them, and the client's `s.credit_cost ?? 2` then
    # quoted 2 for everything.
    #
    # Measured live 2026-07-31: all 22 cards read "2 credits". Only three are
    # actually 2. Google Maps, the LinkedIn pair, Business Email Finder, Google
    # Search, both Instagram scrapers and YouTube Channels are 5 — so the button
    # said "Run · 2 credits" and the wallet lost 5. Two entries are 1 and were
    # overcharged in the telling.
    #
    # `price_inr` goes the other way: it is OUR rupee price, no client screen
    # reads it, and the owner's standing rule keeps pricing figures off tenant
    # surfaces — the Sahayak credits endpoint dropped `price_per_credit_inr` for
    # exactly this reason. Beside a credit figure it also gives the rupee value
    # of a credit by division.
    q = (
        "SELECT id, name, description, icon, category, input_schema, "
        "credit_cost, max_results, result_columns, is_active "
        "FROM staging.hub_scraper_catalog WHERE is_active=TRUE "
    )
    params = []
    if category:
        q += "AND category=$1 "
        params.append(category)
    q += "ORDER BY category, name"
    rows = await pool.fetch(q, *params)
    return {"data": [dict(r) for r in rows]}


# ── Run a scraper ────────────────────────────────────────

@router.post("/run")
async def run_scraper(
    body: RunScraper,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    from services.apify import BlockedActorError, start_actor
    from services import credits
    import traceback

    pool = await get_pool()
    log.info("scraper/run: scraper_id=%s org=%s", body.scraper_id, org_id)

    scraper = await pool.fetchrow(
        "SELECT * FROM staging.hub_scraper_catalog WHERE id=$1 AND is_active=TRUE",
        body.scraper_id,
    )
    if not scraper:
        raise HTTPException(404, "Scraper not found")

    # Building the actor input happens BEFORE the debit, deliberately. It is
    # pure arithmetic over what the caller typed, and `int(val)` on a field the
    # user filled in wrong raises — which used to happen after the wallet had
    # already moved. A malformed input must never cost a credit.
    actor_input = {}
    schema = scraper["input_schema"]
    if isinstance(schema, str):
        schema = json.loads(schema)
    for field in (schema or []):
        fname = field["name"]
        val = body.inputs.get(fname, field.get("default", ""))
        if field.get("type") == "textarea" and field.get("split_lines") and isinstance(val, str):
            lines = [line.strip() for line in val.split("\n") if line.strip()]
            if field.get("url_objects"):
                val = [{"url": u} for u in lines]
            else:
                val = lines
        if field.get("type") == "number" and val:
            val = int(val)
        actor_input[fname] = val

    # ── The run row is written BEFORE the debit, in the SAME transaction ─────
    #
    # It used to be written AFTER `start_actor` returned, which had two
    # consequences that cost real money. A crash between the debit and the
    # actor call left a charge with no run to refund it against and no record
    # that a run had been attempted — measured on staging 2026-07-31,
    # `mca_company_lookup` points at an actor that 404s and one click took FOUR
    # credits across three client retries, with zero run rows to show for it.
    # And the debit had nothing durable to name itself after, so a retry could
    # not be recognised as the same unit of work.
    #
    # Writing the row first solves both: the run id IS the idempotency key
    # (`_upfront_key`), a failed start leaves a visible failed run, and
    # `sweep_stranded_runs` can find the charge again after a restart.
    #
    # Both statements share one transaction, so a refusal rolls the row back
    # too — a refused run leaves nothing behind. `credits.spend` runs inside
    # OUR transaction and takes the org lock, then the member lock; it does not
    # commit on its own the way `deduct_org_credits` did.
    async with pool.acquire() as conn:
        async with conn.transaction():
            run_id = str(await conn.fetchval(
                "INSERT INTO staging.hub_scraper_runs "
                "(org_id, scraper_id, user_id, inputs, status, billed_inr, credits_charged) "
                "VALUES ($1::uuid, $2, $3, $4, 'pending', $5, 0) "
                "RETURNING id",
                org_id, body.scraper_id, user["user_id"],
                json.dumps(body.inputs), float(scraper["price_inr"]),
            ))
            # The minimum upfront. `credits.price_of` reads the same
            # `credit_cost` the catalog card printed — the `or 2` that used to
            # sit here is gone, so a catalog row with no price is a loud
            # catalogue bug rather than a silent 2-credit run.
            #
            # This is also the first time the member ceiling has ever applied to
            # a scraper run: the hand-rolled debit checked the org wallet alone.
            receipt = await credits.spend(
                conn,
                org_id=org_id,
                user_id=user["user_id"],
                kind="scraper",
                ref_id=body.scraper_id,
                idempotency_key=_upfront_key(run_id),
                description=f"scraper:{body.scraper_id} (minimum upfront)",
            )
            await conn.execute(
                "UPDATE staging.hub_scraper_runs SET credits_charged=$2 WHERE id=$1::uuid",
                run_id, receipt.credits,
            )

    # Past this line the debit is committed and `receipt.tx_id` is the only
    # thing that reverses it.
    log.info("scraper/run: actor=%s input=%s",
             scraper["apify_actor_id"], json.dumps(actor_input)[:200])
    try:
        run = await start_actor(scraper["apify_actor_id"], actor_input,
                                scraper["max_results"] or 100)
    except BlockedActorError as e:
        # A withdrawn scraper is not a bad gateway. The generic handler below
        # would refund correctly but answer 502 "Apify error: …", which reads as
        # "try again later" for something that will never work again — and the
        # screen would invite the retry that the mca_company_lookup incident
        # showed costs a credit each time.
        await _fail_run(pool, run_id, f"Scraper withdrawn: {e}")
        await _refund_credits(pool, receipt.tx_id, run_id, "scraper withdrawn",
                              user_id=user["user_id"])
        raise HTTPException(410, str(e))
    except Exception as e:
        log.error("scraper/run CRASH: %s\n%s", e, traceback.format_exc())
        msg = str(e)
        if "token=" in msg:
            msg = msg.split("token=")[0] + "token=***"
        await _fail_run(pool, run_id, f"The run never started: {msg}")
        await _refund_credits(pool, receipt.tx_id, run_id, "run never started",
                              user_id=user["user_id"])
        raise HTTPException(502, f"Apify error: {msg}")

    await pool.execute(
        "UPDATE staging.hub_scraper_runs SET apify_run_id=$2, status='running' "
        "WHERE id=$1::uuid",
        run_id, run["run_id"],
    )

    _spawn(_poll_run(
        run_id, run["run_id"],
        scraper["max_results"] or 100,
        scraper.get("result_path"),
        org_id=org_id,
        scraper_id=body.scraper_id,
        min_credits_charged=receipt.credits,
        upfront_tx_id=receipt.tx_id,
        user_id=user["user_id"],
    ))

    return {
        "status": "started",
        "run_id": run_id,
        "apify_run_id": run["run_id"],
        "billed_inr": float(scraper["price_inr"]),
        "credits_charged": receipt.credits,
        "credits_note": "minimum upfront — final charge after run completes",
    }


async def _poll_run(db_run_id: str, apify_run_id: str, max_items: int, result_path: str = None,
                    org_id: str = None, scraper_id: str = None,
                    min_credits_charged: int = 0, upfront_tx_id: str = None,
                    user_id: str = None):
    """Background task: poll Apify run until done, store results, true-up credits."""
    from services import credits
    from services.apify import get_run_status, get_dataset_items
    pool = await get_pool()

    for _ in range(120):  # max 10 minutes
        await asyncio.sleep(5)
        try:
            info = await get_run_status(apify_run_id)
        except Exception as e:
            log.warning("Poll failed for %s: %s", apify_run_id, e)
            continue

        if info["status"] in ("SUCCEEDED", "FINISHED"):
            results = []
            if info.get("dataset_id"):
                try:
                    results = await get_dataset_items(info["dataset_id"], max_items)
                except Exception as e:
                    log.warning("Dataset fetch failed: %s", e)

            # ── Shaping and storing the results is the one stretch that could
            # take the whole run down with it ─────────────────────────────────
            #
            # `_store_results_r2` was called bare, and nobody awaits this task:
            # an exception here did not FAIL the run, it ended it. The row stayed
            # 'running', the upfront debit stayed taken, `billed_inr` stayed at
            # the full price, and the customer had paid for a run they could not
            # open. `sweep_stranded_runs` is the net for a poller that died with
            # its process; this one is still alive and can settle its own run
            # rather than leaving the customer to wait for the next deploy.
            #
            # The guard stops at the settling UPDATE below, deliberately. Up to
            # that line the row is still 'pending'/'running' and only the upfront
            # debit has moved, so failing and refunding is unambiguously right.
            # Past it the row says 'succeeded' and the customer has the data;
            # refunding there would forgive a charge that was earned, and the
            # true-up block already carries its own handlers.
            try:
                if result_path and results:
                    flat = []
                    for item in results:
                        nested = item.get(result_path, [])
                        if isinstance(nested, list):
                            flat.extend(nested)
                    results = flat

                trimmed = results[:max_items]
                r2_key = await _store_results_r2(org_id, db_run_id, trimmed)
            except Exception as e:                             # noqa: BLE001
                # The cause goes to the log, not to the run row: a botocore or
                # credential error carries the org's R2 endpoint and key id, and
                # `error` is in `_TENANT_RUN_FIELDS`. The row gets the sentence
                # that answers the only question the customer has, in the same
                # voice the sweep uses.
                log.error("Storing results for scraper run %s failed: %s — "
                          "failing the run and returning the charge",
                          db_run_id, e, exc_info=e)
                # Neither of these raises — both are best-effort by contract — so
                # this handler cannot become the next thing the loop swallows.
                await _fail_run(
                    pool, db_run_id,
                    "The results could not be stored, so this run cannot be "
                    "shown. The credits have been returned.",
                )
                await _refund_credits(pool, upfront_tx_id, db_run_id,
                                      "results could not be stored",
                                      user_id=user_id)
                return

            actual_cost_usd = float(info.get("usage_usd", 0))

            # The run row is settled FIRST, with what the ledger has actually
            # moved so far. `credits_charged` is a customer-visible figure and
            # it must agree with the wallet: the previous version wrote the
            # trued-up total here and then let the true-up be silently forgiven,
            # so the two disagreed permanently for any org that could not afford
            # the difference.
            # `status IN ('pending','running')` in the WHERE, and we stop if it
            # matched nothing. Two things can settle a run — this poller and
            # `sweep_stranded_runs`, which refunds anything left running past
            # POLL_BUDGET_MINUTES on the assumption its poller died in a deploy.
            # A slow poller that comes back after the sweep has already refunded
            # would otherwise flip the run to 'succeeded' and then charge the
            # true-up on top, so the customer pays for a run they were refunded
            # for and the ledger records both.
            settled = await pool.execute(
                "UPDATE staging.hub_scraper_runs SET status='succeeded', "
                "result_count=$2, cost_usd=$3, results_r2_key=$4, finished_at=NOW() "
                "WHERE id=$1::uuid AND status IN ('pending','running')",
                db_run_id, len(trimmed), actual_cost_usd, r2_key,
            )
            if settled.endswith(" 0"):
                log.warning("scraper run %s was already settled by the sweep — "
                            "not charging the true-up", db_run_id)
                return

            if not org_id or not scraper_id:
                return

            try:
                async with pool.acquire() as conn:
                    actual_credits = await credits.price_of_scraper_usage(
                        conn, scraper_id, org_id, actual_cost_usd
                    )
            except Exception as e:                             # noqa: BLE001
                log.error("Could not price scraper run %s: %s — no true-up taken",
                          db_run_id, e)
                return

            extra = actual_credits - min_credits_charged
            if extra <= 0:
                return
            try:
                await _deduct_extra_credits(pool, org_id, user_id, extra,
                                            db_run_id, scraper_id)
            except credits.CreditError as e:
                # NOT forgiven, and not refunded either. The run succeeded and
                # the customer has the data; the remainder is owed. The clamp
                # this replaced wrote the full `-extra` to the ledger while
                # moving the wallet by less, which diverged `balance_after` from
                # the wallet for the life of the org.
                log.error(
                    "CREDIT DEBT: scraper run %s (org %s, scraper %s) cost %s "
                    "credits, %s were taken upfront, and the remaining %s could "
                    "not be charged: %s",
                    db_run_id, org_id, scraper_id, actual_credits,
                    min_credits_charged, extra, getattr(e, "message", e),
                )
                return
            except Exception as e:                             # noqa: BLE001
                log.error("Credit true-up failed for run %s: %s", db_run_id, e)
                return

            await pool.execute(
                "UPDATE staging.hub_scraper_runs SET credits_charged=$2 WHERE id=$1::uuid",
                db_run_id, actual_credits,
            )
            return

        if info["status"] in ("FAILED", "ABORTED", "TIMED-OUT"):
            # F30: carry Apify's own message where it gives one. "Apify status:
            # FAILED" restates the status column and tells nobody why — a user
            # could not tell a bad input from an outage without opening a ticket.
            detail = (info.get("error") or info.get("status_message") or "").strip()
            msg = f"Apify status: {info['status']}"
            if detail:
                msg = f"{msg} — {detail}"[:500]
            await pool.execute(
                "UPDATE staging.hub_scraper_runs SET status='failed', "
                "error=$2, cost_usd=$3, finished_at=NOW() WHERE id=$1::uuid",
                db_run_id, msg, float(info.get("usage_usd", 0)),
            )
            await _refund_credits(pool, upfront_tx_id, db_run_id,
                                  f"run {info['status'].lower()}", user_id=user_id)
            return

    # Timed out polling
    await pool.execute(
        "UPDATE staging.hub_scraper_runs SET status='failed', "
        "error='Polling timeout — the run did not report a result within 10 minutes', "
        "finished_at=NOW() WHERE id=$1::uuid",
        db_run_id,
    )
    await _refund_credits(pool, upfront_tx_id, db_run_id, "polling timeout",
                          user_id=user_id)


async def _store_results_r2(org_id: str, run_id: str, results: list) -> str | None:
    """Store scraper results as JSON in R2. Returns the key.

    Returns None only when there is no R2 to write to — no org, or an org with no
    credentials on `staging.organisations`. That is a provisioning state rather
    than a run failure, and the caller keeps treating it as one.

    A configured R2 that REFUSES THE WRITE now raises. The upload used to be
    wrapped in `except Exception: log.warning(); return None`, and the caller
    then wrote 'succeeded' with a null `results_r2_key` — so the customer was
    charged in full for a run whose results had gone nowhere, `result_count` said
    how many rows they could not see, and the only trace of it was one warning
    line. `hub_scraper_runs.results` has not been written since 050 moved storage
    to R2, so there is no second copy to fall back to: if this write is lost, the
    results are lost. The two outcomes must be distinguishable at the call site,
    because only one of them is billable.
    """
    from services.storage import _get_org_r2
    import asyncio as _aio

    if not org_id:
        return None
    client, bucket = await _get_org_r2(org_id)
    if not client:
        # Loud, because it is not free: the run below will still be billed and
        # the customer will still have nothing to open. `_get_org_r2` also lands
        # here when building the client THREW (it catches, caches and returns
        # None), so this line is not only about an org nobody provisioned.
        log.error("No R2 for org %s — scraper run %s has nowhere to put its "
                  "results and the customer cannot open them", org_id, run_id)
        return None

    key = f"scraper-results/{run_id}.json"
    body = json.dumps(results, default=str).encode()
    loop = _aio.get_running_loop()
    await loop.run_in_executor(
        None,
        lambda: client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json"),
    )
    log.info("Stored scraper results in R2: %s (%d bytes)", key, len(body))
    return key


async def _fetch_results_r2(org_id: str, r2_key: str) -> list:
    """Fetch scraper results JSON from R2."""
    from services.storage import _get_org_r2
    import asyncio as _aio

    if not r2_key or not org_id:
        return []
    client, bucket = await _get_org_r2(org_id)
    if not client:
        return []

    loop = _aio.get_running_loop()
    try:
        resp = await loop.run_in_executor(
            None,
            lambda: client.get_object(Bucket=bucket, Key=r2_key),
        )
        body = resp["Body"].read()
        return json.loads(body)
    except Exception as e:
        log.warning("R2 fetch failed for %s: %s", r2_key, e)
        return []


# ── Get run status / results ─────────────────────────────

#: Everything a TENANT may see about their own run.
#:
#: `cost_usd` is absent by construction. It is what the run cost us upstream at
#: Apify — our cost basis, written from `info["usage_usd"]` — and beside
#: `billed_inr` on the same row it discloses our margin by subtraction, on every
#: run. The org's markup — `services/credits.py:SCRAPER_MARGIN` and
#: `organisations.markup_pct` — is the quantity that falls out of it.
#:
#: This is an allow-list rather than a `del out["cost_usd"]` deny-list, and it is
#: applied in the handler rather than left to the SELECT list, because both of
#: the alternatives fail open: a deny-list misses the next sensitive column
#: someone adds, and a SELECT list is invisible from the return statement — the
#: day anyone widens the query to `r.*` for an unrelated reason, the cost basis
#: starts crossing again with nothing in the handler to stop it.
#:
#: The platform console (`/admin/usage`, `/admin/runs`) deliberately does NOT use
#: this projection: those sit behind `require_platform_role(*OPERATIONS_CONSOLE_ROLES)`
#: and showing cost is the entire point of them.
_TENANT_RUN_FIELDS = (
    "id", "org_id", "scraper_id", "user_id", "status", "result_count",
    "billed_inr", "credits_charged", "error", "created_at", "finished_at",
    "graha_imported_count", "graha_imported_at", "results",
    "scraper_name", "result_columns", "icon",
)


def _tenant_run(row) -> dict:
    """Project a run row down to the tenant-visible fields."""
    d = dict(row)
    return {k: d[k] for k in _TENANT_RUN_FIELDS if k in d}


@router.get("/runs/{run_id}")
async def get_run(
    run_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # `r.cost_usd` is deliberately absent. It is what Aekam pays the upstream
    # provider for this run, not what the org was charged — `billed_inr` and
    # `credits_charged` are the tenant-facing figures and stay. `11-platform-admin.md`
    # §1 puts that containment here, in the query that builds the response, not
    # in whichever UI happens to render it. The admin views below select it under
    # `require_platform_role`, which is where it belongs.
    #
    # Paired with `billed_inr` it is also our exact per-run margin, which is the
    # standing "never publish OUR prices" rule and not only a tidiness question.
    #
    # Not selecting it is the first layer; `_tenant_run` above is the one that
    # actually guarantees it, because a SELECT list is invisible from the return
    # statement and widening this query later would silently reopen the leak.
    row = await pool.fetchrow(
        "SELECT r.id, r.org_id, r.scraper_id, r.user_id, r.status, r.result_count, "
        "r.billed_inr, r.credits_charged, r.error, r.created_at, r.finished_at, "
        "r.graha_imported_count, r.graha_imported_at, r.results_r2_key, r.results, "
        "c.name as scraper_name, c.result_columns "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.id=$1::uuid AND r.org_id=$2::uuid",
        str(run_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Run not found")
    src = dict(row)
    out = _tenant_run(src)
    # Prefer R2, fall back to legacy JSONB column. `results_r2_key` is storage
    # internals and is not in the projection, so it never reaches the response.
    if src.get("results_r2_key"):
        out["results"] = await _fetch_results_r2(org_id, src["results_r2_key"])
    return out


# ── Import results into Graha (CRM) ──────────────────────

_ALIASES = {
    "name": ("name", "fullName", "full_name", "displayName", "profileName", "authorName", "legalName", "companyName", "advertiserName"),
    "email": ("email", "businessEmail", "contactEmail", "workEmail"),
    "phone": ("phone", "phoneNumber", "businessPhoneNumber", "mobile", "number", "contactNumber", "whatsapp"),
    "company": ("company", "companyName", "currentCompany", "organization", "business", "businessName", "advertiserName", "pageName", "legalName", "domain", "url"),
    "designation": ("designation", "title", "headline", "jobTitle", "position"),
}

# LinkedIn scrapers return firstName/lastName instead of a single name field
_FIRST_LAST_KEYS = [
    ("firstName", "lastName"),
    ("first_name", "last_name"),
]


def _extract_lead_fields(item: dict, field_map: dict) -> Optional[dict]:
    """Best-effort mapping of a scraper result row onto Graha contact fields.

    `field_map` (from hub_scraper_catalog.graha_field_map) is tried first as an
    admin-curated hint; each target field then falls back through a fixed
    alias list since real Apify actor output shapes vary and can't all be
    hand-verified up front. Rows with neither a name nor a company are
    considered unusable and skipped by the caller.
    """
    if not isinstance(item, dict):
        return None

    out = {}
    for target, aliases in _ALIASES.items():
        val = None
        mapped_key = (field_map or {}).get(target)
        if mapped_key and item.get(mapped_key):
            val = item.get(mapped_key)
        else:
            for key in aliases:
                if item.get(key):
                    val = item[key]
                    break
        if isinstance(val, dict):
            val = val.get("url") or val.get("name") or json.dumps(val)
        if isinstance(val, list):
            val = ", ".join(str(v) for v in val[:3])
        out[target] = str(val).strip() if val else ""

    # Compose name from firstName+lastName if single-name aliases missed
    if not out["name"]:
        for fk, lk in _FIRST_LAST_KEYS:
            first = str(item.get(fk, "")).strip()
            last = str(item.get(lk, "")).strip()
            if first or last:
                out["name"] = f"{first} {last}".strip()
                break

    if not out["name"] and not out["company"]:
        return None
    if not out["name"]:
        out["name"] = out["company"]
    return out


@router.post("/runs/{run_id}/import-to-graha")
async def import_run_to_graha(
    run_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    from services.contact_dedupe import find_duplicates

    pool = await get_pool()
    run = await pool.fetchrow(
        "SELECT r.id, r.org_id, r.scraper_id, r.status, r.results_r2_key, r.results, "
        "c.graha_field_map, c.name as scraper_name "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.id=$1::uuid AND r.org_id=$2::uuid",
        str(run_id), org_id,
    )
    if not run:
        raise HTTPException(404, "Run not found")
    if run["status"] != "succeeded":
        raise HTTPException(400, "Run has not succeeded yet")

    if run.get("results_r2_key"):
        results = await _fetch_results_r2(org_id, run["results_r2_key"])
    else:
        results = run["results"]
        results = json.loads(results) if isinstance(results, str) else (results or [])
    field_map = run["graha_field_map"]
    field_map = json.loads(field_map) if isinstance(field_map, str) else (field_map or {})

    imported, skipped_dupe, skipped_empty = 0, 0, 0

    for item in results:
        lead = _extract_lead_fields(item, field_map)
        if not lead:
            skipped_empty += 1
            continue

        dupes = await find_duplicates(
            pool, org_id, email=lead["email"], phone=lead["phone"],
            name=lead["name"], company=lead["company"],
        )
        if any(d["match_type"] in ("email", "phone") for d in dupes):
            skipped_dupe += 1
            continue

        row = await pool.fetchrow(
            "INSERT INTO staging.graha_contacts "
            "(org_id, name, email, phone, company, designation, contact_type, source, created_by) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6, 'lead', $7, $8) "
            "RETURNING id",
            org_id, lead["name"], lead["email"], lead["phone"], lead["company"],
            lead["designation"], f"scraper:{run['scraper_id']}", user["user_id"],
        )
        imported += 1

    await pool.execute(
        "UPDATE staging.hub_scraper_runs SET graha_imported_count=$2, graha_imported_at=NOW() "
        "WHERE id=$1::uuid",
        str(run_id), imported,
    )

    log.info(
        "import-to-graha: run=%s org=%s imported=%d dupe=%d unmappable=%d",
        run_id, org_id, imported, skipped_dupe, skipped_empty,
    )

    return {
        "status": "done",
        "imported": imported,
        "skipped_duplicate": skipped_dupe,
        "skipped_unmappable": skipped_empty,
        "total_results": len(results),
    }


@router.get("/runs")
async def list_runs(
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    # No `r.cost_usd` — see `get_run` and `_TENANT_RUN_FIELDS` above. This is a
    # tenant-scoped list, and a list is the easiest place of all to diff supplier
    # cost against billed_inr, so it goes out through the same projection.
    rows = await pool.fetch(
        "SELECT r.id, r.scraper_id, r.status, r.result_count, r.billed_inr, "
        "r.credits_charged, r.created_at, r.finished_at, c.name as scraper_name, c.icon, "
        "COUNT(*) OVER() AS _total "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.org_id=$1::uuid ORDER BY r.created_at DESC LIMIT 50",
        org_id,
    )
    # `_tenant_run` is the projection that keeps supplier cost off a tenant
    # response, so the rows cannot go straight to `_listed`. It drops `_total`
    # with everything else it does not name, so the count is read first.
    total = int(dict(rows[0]).get("_total", len(rows))) if rows else 0
    return {
        "data": [_tenant_run(r) for r in rows],
        "total": total, "limit": 50, "truncated": total > 50,
    }


# ── Admin: billing overview ──────────────────────────────

#: Operational triage — run status, errors, which org ran what. This is the
#: day-to-day work `platform_staff` exists for, so it stays on the operating set.
_admin = require_platform_role(*OPERATIONS_CONSOLE_ROLES)

#: `/admin/usage` is not triage. It sums our supplier cost against what we billed,
#: per org, across every org — that is Aekam's own P&L, and role_tiers.py already
#: names the set for it: "platform-wide KPIs, cost summaries, provider
#: reconciliation, margin". It was on the operating set, which meant every
#: platform_staff holder could read the margin on every customer. The operating
#: set "deliberately excludes finance" by its own definition, so narrowing here
#: is the documented intent rather than a new policy. platform_manager is
#: excluded for the reason role_tiers gives: that role is defined over a
#: CUSTOMER's modules, and Aekam's P&L is not one of them.
_finance = require_platform_role(*FINANCE_CONSOLE_ROLES)

@router.get("/admin/usage")
async def admin_usage(
    user=Depends(require_user),
    _a=Depends(_finance),
):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT o.name as org_name, r.org_id, "
        "COUNT(*) as total_runs, "
        "SUM(CASE WHEN r.status='succeeded' THEN 1 ELSE 0 END) as success_runs, "
        "COALESCE(SUM(r.cost_usd), 0) as total_cost_usd, "
        "COALESCE(SUM(r.billed_inr), 0) as total_billed_inr, "
        "COALESCE(SUM(r.result_count), 0) as total_results "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.organisations o ON o.id = r.org_id "
        "GROUP BY o.name, r.org_id "
        "ORDER BY total_billed_inr DESC",
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/admin/runs")
async def admin_runs(
    org_id: Optional[str] = None,
    user=Depends(require_user),
    _a=Depends(_admin),
):
    pool = await get_pool()
    q = (
        "SELECT COUNT(*) OVER() AS _total, "
        "r.id, r.org_id, r.scraper_id, r.user_id, r.status, r.result_count, "
        "r.billed_inr, r.cost_usd, r.credits_charged, r.error, r.created_at, r.finished_at, "
        "c.name as scraper_name, c.icon, o.name as org_name "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "JOIN staging.organisations o ON o.id = r.org_id "
    )
    params = []
    if org_id:
        q += "WHERE r.org_id=$1::uuid "
        params.append(org_id)
    q += "ORDER BY r.created_at DESC LIMIT 100"
    rows = await pool.fetch(q, *params)
    return _listed(rows, limit=100)
