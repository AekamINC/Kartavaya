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

import math

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/scrapers", tags=["scrapers"])
_gate = require_module("srijan")

# Markup applied to the real Apify cost when converting a finished run into
# credits. Commercial figure — do not restate it in prose, in docstrings or in
# API responses.
#
# NOTE FOR THE OWNER: `staging.hub_scraper_catalog` already carries a
# `margin_pct` column per scraper (migration 032), which is where this belongs —
# a single hardcoded rate cannot differ per scraper and cannot be changed
# without a deploy. Switching to the column would change what runs actually
# cost, so it is a pricing decision and is deliberately left un-made here.
SCRAPER_MARGIN = 0.45


async def _org_markup(org_id: str) -> float:
    """The markup THIS org was given, set by a platform admin.

    `organisations.markup_pct` already existed and the platform console already
    writes it (`admin_orgs.py` — `OrgCreate.markup_pct`, default 0.30) and reads
    it back for the revenue view. Only the scraper true-up ignored it, applying
    its own hardcoded `SCRAPER_MARGIN` instead — so a per-org commercial term set
    by Aekam had no effect on the one place a run's price is actually decided,
    and two different markups described the same org.

    Owner's decision, 2026-07-31: a large run marks up at the rate assigned to
    the org, not at a constant in the source.

    `SCRAPER_MARGIN` remains the fallback for an org with no value — never a
    silent 0, which would sell at cost.
    """
    try:
        pool = await get_pool()
        v = await pool.fetchval(
            "SELECT markup_pct FROM staging.organisations WHERE id=$1::uuid", org_id
        )
        if v is None:
            return SCRAPER_MARGIN
        v = float(v)
        # A negative markup would sell below cost and a runaway one would bill a
        # customer absurdly. Both are data errors rather than intentions.
        if v < 0 or v > 10:
            log.warning("org %s has markup_pct=%s — out of range, using default", org_id, v)
            return SCRAPER_MARGIN
        return v
    except Exception as exc:
        log.warning("could not read markup_pct for org %s: %s", org_id, exc)
        return SCRAPER_MARGIN


async def _calc_actual_credits(cost_usd: float, org_id: str, min_credits: int) -> int:
    """Convert a run's real Apify cost into credits, never below `min_credits`.

    `charged_inr` is RUPEES. It used to be handed straight to `math.ceil` and
    returned as CREDITS, with no division by what a credit costs — so the markup
    actually applied was `SCRAPER_MARGIN` multiplied by the credit price, about
    5.8x rather than the intended 1.45x.

    It went unnoticed because a second fault hid it. `usage_usd` was reading only
    Apify's PLATFORM usage and missing the actor's per-event charges, so the
    figure arriving here was around $0.0002 — `ceil` of which is 1, always below
    `min_credits`, so the true-up never fired and the mistake never showed.
    Fixing either one alone gives a wrong answer: correcting the cost while
    leaving the units multiplies real charges by roughly six, and correcting the
    units alone changes nothing. Both, together, reproduce the intended markup —

        100 places   cost $0.40 = Rs 38.60   ->  14 credits = Rs 56.00 = 1.45x

    — which is also the run that was previously charged the 5-credit minimum,
    Rs 20.00, against a Rs 38.60 cost.
    """
    if cost_usd <= 0:
        return min_credits
    from services.forex import get_usd_inr
    from services.ai_router import CREDIT_PRICE_INR
    rate = await get_usd_inr()
    markup = await _org_markup(org_id)
    charged_inr = cost_usd * rate * (1 + markup)
    actual = max(min_credits, math.ceil(charged_inr / CREDIT_PRICE_INR))
    return actual


async def _deduct_extra_credits(pool, org_id: str, user_id: str, extra: int, run_id: str):
    """Deduct additional credits after run completes (true-up)."""
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                wallet = await conn.fetchrow(
                    "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid FOR UPDATE",
                    org_id,
                )
                if not wallet:
                    return
                new_bal = max(0, wallet["balance"] - extra)
                await conn.execute(
                    "UPDATE staging.hub_org_credits SET balance=$1, updated_at=NOW() WHERE org_id=$2::uuid",
                    new_bal, org_id,
                )
                await conn.execute(
                    "INSERT INTO staging.hub_org_credit_transactions "
                    "(org_id, user_id, amount, balance_after, tx_type, description, created_by) "
                    "VALUES ($1::uuid, $2, $3, $4, 'debit', $5, $2)",
                    org_id, user_id, -extra, new_bal,
                    f"scraper true-up run:{run_id[:8]}",
                )
    except Exception as e:
        log.warning("Credit true-up failed for run %s: %s", run_id, e)


async def _refund_credits(pool, org_id: str, user_id: str, amount: int, run_id: Optional[str], why: str):
    """Return the upfront charge when a run produced nothing (F29).

    Credits are debited BEFORE Apify is called, and the response tells the user
    "minimum upfront — final charge after run completes". On success that promise
    is kept by `_deduct_extra_credits`. On failure nothing ran, so the charge was
    never final: measured on staging, a run that failed at Apify kept 2 credits
    and recorded billed_inr 50 against 0 rows, and the balance never moved back.

    Billing the customer for the platform's failure is the wrong default. It is
    also the same class of defect as F24 — a money figure the customer can see
    that does not match what actually happened.

    `billed_inr` is zeroed with the refund. Leaving it at 50 while the credits
    came back would leave the cost report attributing spend to a run that cost
    nothing, which is how the two disagree again.

    Best-effort and never raises: this runs in a background poller, and a failed
    refund must not also lose the error that caused it. It logs loudly instead.
    """
    if amount <= 0:
        return
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                wallet = await conn.fetchrow(
                    "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid FOR UPDATE",
                    org_id,
                )
                if not wallet:
                    return
                new_bal = wallet["balance"] + amount
                await conn.execute(
                    "UPDATE staging.hub_org_credits SET balance=$1, updated_at=NOW() WHERE org_id=$2::uuid",
                    new_bal, org_id,
                )
                # 'credit', not a negative debit — the ledger has to show a
                # refund as a refund, or a customer reconciling it sees the
                # original charge and no reversal.
                await conn.execute(
                    "INSERT INTO staging.hub_org_credit_transactions "
                    "(org_id, user_id, amount, balance_after, tx_type, description, created_by) "
                    "VALUES ($1::uuid, $2, $3, $4, 'credit', $5, $2)",
                    org_id, user_id or "", amount, new_bal,
                    # `run_id` is None when the run never started — the crash
                    # path in `run_scraper` fires before any row is written, so
                    # there is nothing to name and nothing to zero.
                    f"scraper refund run:{run_id[:8]} — {why}" if run_id
                    else f"scraper refund — {why}",
                )
                if run_id:
                    await conn.execute(
                        "UPDATE staging.hub_scraper_runs SET billed_inr=0 WHERE id=$1::uuid",
                        run_id,
                    )
        log.info("Refunded %s credits for failed scraper run %s (%s)", amount, run_id, why)
    except Exception as e:
        log.error("Credit refund FAILED for run %s: %s — customer is owed %s credits",
                  run_id, e, amount)


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
    # supplier cost and our markup — to every org user with a Srijan grant, on an
    # unremarkable catalog listing. `apify_actor_id` goes with them: it names the
    # exact marketplace actor behind each entry, which is the other half of
    # reproducing the offering without us. Columns are now enumerated, so a new
    # commercial column added to this table is not published by default.
    # `credit_cost` is the one price the caller MUST have: it is what this
    # handler's sibling `POST /run` deducts (`scraper.get("credit_cost") or 2`),
    # and the catalog card, the confirmation line and the Run button all print
    # it. Enumerating the columns to stop `cost_per_run` and `margin_pct`
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
    # surfaces — the Srijan credits endpoint dropped `price_per_credit_inr` for
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
    import traceback

    # Outside the try, so the handler can tell a crash BEFORE the debit from one
    # after it. `charged` is what this request actually took and still owes back.
    pool = await get_pool()
    charged = 0

    try:
        log.info("scraper/run: scraper_id=%s org=%s", body.scraper_id, org_id)

        scraper = await pool.fetchrow(
            "SELECT * FROM staging.hub_scraper_catalog WHERE id=$1 AND is_active=TRUE",
            body.scraper_id,
        )
        if not scraper:
            raise HTTPException(404, "Scraper not found")

        # Deduct minimum credits upfront; true-up after Apify returns actual cost
        min_credits = scraper.get("credit_cost") or 2
        from services.ai_router import _maybe_reset_monthly_credits
        async with pool.acquire() as conn:
            async with conn.transaction():
                await _maybe_reset_monthly_credits(conn, org_id)
                wallet = await conn.fetchrow(
                    "SELECT balance FROM staging.hub_org_credits WHERE org_id=$1::uuid FOR UPDATE",
                    org_id,
                )
                if not wallet or wallet["balance"] < min_credits:
                    bal = wallet["balance"] if wallet else 0
                    raise HTTPException(402, f"Insufficient credits. Need {min_credits}, have {bal}. Contact Aekam to top up.")
                new_bal = wallet["balance"] - min_credits
                await conn.execute(
                    "UPDATE staging.hub_org_credits SET balance=$1, updated_at=NOW() WHERE org_id=$2::uuid",
                    new_bal, org_id,
                )
                await conn.execute(
                    "INSERT INTO staging.hub_org_credit_transactions "
                    "(org_id, user_id, amount, balance_after, tx_type, description, created_by) "
                    "VALUES ($1::uuid, $2, $3, $4, 'debit', $5, $2)",
                    org_id, user["user_id"], -min_credits, new_bal,
                    f"scraper:{body.scraper_id} (minimum upfront)",
                )
        # Set only once the transaction above has committed, so the handler
        # never refunds a debit that did not happen.
        charged = min_credits

        # Build Apify input from schema + user inputs
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

        log.info("scraper/run: actor=%s input=%s", scraper["apify_actor_id"], json.dumps(actor_input)[:200])

        run = await start_actor(scraper["apify_actor_id"], actor_input, scraper["max_results"] or 100)

        row = await pool.fetchrow(
            "INSERT INTO staging.hub_scraper_runs "
            "(org_id, scraper_id, user_id, apify_run_id, inputs, status, billed_inr, credits_charged) "
            "VALUES ($1::uuid, $2, $3, $4, $5, 'running', $6, $7) "
            "RETURNING id",
            org_id, body.scraper_id, user["user_id"], run["run_id"],
            json.dumps(body.inputs), float(scraper["price_inr"]), min_credits,
        )

        asyncio.ensure_future(_poll_run(
            str(row["id"]), run["run_id"],
            scraper["max_results"] or 100,
            scraper.get("result_path"),
            org_id=org_id,
            min_credits_charged=min_credits,
            user_id=user["user_id"],
        ))

        return {
            "status": "started",
            "run_id": str(row["id"]),
            "apify_run_id": run["run_id"],
            "billed_inr": float(scraper["price_inr"]),
            "credits_charged": min_credits,
            "credits_note": "minimum upfront — final charge after run completes",
        }
    except HTTPException:
        raise
    except BlockedActorError as e:
        # A withdrawn scraper is not a bad gateway. The generic handler below
        # would refund correctly but answer 502 "Apify error: …", which reads as
        # "try again later" for something that will never work again — and the
        # screen would invite the retry that the mca_company_lookup incident
        # showed costs a credit each time.
        await _refund_credits(pool, org_id, user["user_id"], charged, None,
                              "scraper withdrawn")
        raise HTTPException(410, str(e))
    except Exception as e:
        log.error("scraper/run CRASH: %s\n%s", e, traceback.format_exc())
        # Give the credits back. They are debited before Apify is called, and
        # every refund path in this file lives in `_poll_run` — which needs a
        # `hub_scraper_runs` row to poll. That row is written AFTER
        # `start_actor` returns, so a crash here leaves a charge nothing can
        # ever reverse: no run to refund against, and no record that a run was
        # even attempted.
        #
        # Measured on staging, 2026-07-31: `mca_company_lookup` points at an
        # Apify actor that 404s. One click took FOUR credits — the client
        # retried the 502 three times — created zero run rows, and left the
        # balance down with four "minimum upfront" debit lines to show for it.
        await _refund_credits(pool, org_id, user["user_id"], charged, None,
                              "run never started")
        msg = str(e)
        if "token=" in msg:
            msg = msg.split("token=")[0] + "token=***"
        raise HTTPException(502, f"Apify error: {msg}")


async def _poll_run(db_run_id: str, apify_run_id: str, max_items: int, result_path: str = None,
                    org_id: str = None, min_credits_charged: int = 0, user_id: str = None):
    """Background task: poll Apify run until done, store results, true-up credits."""
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

            if result_path and results:
                flat = []
                for item in results:
                    nested = item.get(result_path, [])
                    if isinstance(nested, list):
                        flat.extend(nested)
                results = flat

            trimmed = results[:max_items]
            r2_key = await _store_results_r2(org_id, db_run_id, trimmed)

            actual_cost_usd = float(info.get("usage_usd", 0))
            actual_credits = await _calc_actual_credits(actual_cost_usd, org_id, min_credits_charged)

            await pool.execute(
                "UPDATE staging.hub_scraper_runs SET status='succeeded', "
                "result_count=$2, cost_usd=$3, results_r2_key=$4, credits_charged=$5, finished_at=NOW() "
                "WHERE id=$1::uuid",
                db_run_id, len(trimmed), actual_cost_usd, r2_key, actual_credits,
            )

            # True-up: if actual > minimum already charged, deduct the difference
            extra = actual_credits - min_credits_charged
            if extra > 0 and org_id:
                await _deduct_extra_credits(pool, org_id, user_id or "", extra, db_run_id)

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
            await _refund_credits(pool, org_id, user_id, min_credits_charged,
                                  db_run_id, f"run {info['status'].lower()}")
            return

    # Timed out polling
    await pool.execute(
        "UPDATE staging.hub_scraper_runs SET status='failed', "
        "error='Polling timeout — the run did not report a result within 10 minutes', "
        "finished_at=NOW() WHERE id=$1::uuid",
        db_run_id,
    )
    await _refund_credits(pool, org_id, user_id, min_credits_charged,
                          db_run_id, "polling timeout")


async def _store_results_r2(org_id: str, run_id: str, results: list) -> str | None:
    """Store scraper results as JSON in R2. Returns the key, or None if R2 unavailable."""
    from services.storage import _get_org_r2
    import asyncio as _aio

    if not org_id:
        return None
    client, bucket = await _get_org_r2(org_id)
    if not client:
        return None

    key = f"scraper-results/{run_id}.json"
    body = json.dumps(results, default=str).encode()
    loop = _aio.get_running_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json"),
        )
        log.info("Stored scraper results in R2: %s (%d bytes)", key, len(body))
        return key
    except Exception as e:
        log.warning("R2 upload failed for scraper results %s: %s", run_id, e)
        return None


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
#: run. `SCRAPER_MARGIN` is the quantity that falls out of it.
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
    from routers.graha import fire_automations

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
        asyncio.ensure_future(fire_automations(pool, org_id, "lead_created", {
            "contact_id": str(row["id"]), "source": f"scraper:{run['scraper_id']}", "contact_type": "lead",
        }))
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
