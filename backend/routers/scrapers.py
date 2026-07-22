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
from middleware.roles import require_platform_role, get_org_id
from middleware.subscription import require_module

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/scrapers", tags=["scrapers"])
_gate = require_module("srijan")


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
    q = "SELECT * FROM staging.hub_scraper_catalog WHERE is_active=TRUE "
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
    from services.apify import start_actor
    import traceback

    try:
        pool = await get_pool()
        log.info("scraper/run: scraper_id=%s org=%s", body.scraper_id, org_id)

        scraper = await pool.fetchrow(
            "SELECT * FROM staging.hub_scraper_catalog WHERE id=$1 AND is_active=TRUE",
            body.scraper_id,
        )
        if not scraper:
            raise HTTPException(404, "Scraper not found")

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
            "(org_id, scraper_id, user_id, apify_run_id, inputs, status, billed_inr) "
            "VALUES ($1::uuid, $2, $3, $4, $5, 'running', $6) "
            "RETURNING id",
            org_id, body.scraper_id, user["user_id"], run["run_id"],
            json.dumps(body.inputs), float(scraper["price_inr"]),
        )

        asyncio.ensure_future(_poll_run(
            str(row["id"]), run["run_id"],
            scraper["max_results"] or 100,
            scraper.get("result_path"),
            org_id=org_id,
        ))

        return {
            "status": "started",
            "run_id": str(row["id"]),
            "apify_run_id": run["run_id"],
            "billed_inr": float(scraper["price_inr"]),
        }
    except HTTPException:
        raise
    except Exception as e:
        log.error("scraper/run CRASH: %s\n%s", e, traceback.format_exc())
        msg = str(e)
        if "token=" in msg:
            msg = msg.split("token=")[0] + "token=***"
        raise HTTPException(502, f"Apify error: {msg}")


async def _poll_run(db_run_id: str, apify_run_id: str, max_items: int, result_path: str = None, org_id: str = None):
    """Background task: poll Apify run until done, then store results in R2."""
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

            await pool.execute(
                "UPDATE staging.hub_scraper_runs SET status='succeeded', "
                "result_count=$2, cost_usd=$3, results_r2_key=$4, finished_at=NOW() "
                "WHERE id=$1::uuid",
                db_run_id, len(trimmed), float(info.get("usage_usd", 0)), r2_key,
            )
            return

        if info["status"] in ("FAILED", "ABORTED", "TIMED-OUT"):
            await pool.execute(
                "UPDATE staging.hub_scraper_runs SET status='failed', "
                "error=$2, cost_usd=$3, finished_at=NOW() WHERE id=$1::uuid",
                db_run_id, f"Apify status: {info['status']}", float(info.get("usage_usd", 0)),
            )
            return

    # Timed out polling
    await pool.execute(
        "UPDATE staging.hub_scraper_runs SET status='failed', error='Polling timeout' WHERE id=$1::uuid",
        db_run_id,
    )


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

@router.get("/runs/{run_id}")
async def get_run(
    run_id: UUID,
    user=Depends(require_user),
    org_id: str = Depends(get_org_id),
    _g=Depends(_gate),
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT r.id, r.org_id, r.scraper_id, r.user_id, r.status, r.result_count, "
        "r.billed_inr, r.cost_usd, r.error, r.created_at, r.finished_at, "
        "r.graha_imported_count, r.graha_imported_at, r.results_r2_key, r.results, "
        "c.name as scraper_name, c.result_columns "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.id=$1::uuid AND r.org_id=$2::uuid",
        str(run_id), org_id,
    )
    if not row:
        raise HTTPException(404, "Run not found")
    out = dict(row)
    # Prefer R2, fall back to legacy JSONB column
    if out.get("results_r2_key"):
        out["results"] = await _fetch_results_r2(org_id, out["results_r2_key"])
    del out["results_r2_key"]
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
    rows = await pool.fetch(
        "SELECT r.id, r.scraper_id, r.status, r.result_count, r.billed_inr, "
        "r.cost_usd, r.created_at, r.finished_at, c.name as scraper_name, c.icon "
        "FROM staging.hub_scraper_runs r "
        "JOIN staging.hub_scraper_catalog c ON c.id = r.scraper_id "
        "WHERE r.org_id=$1::uuid ORDER BY r.created_at DESC LIMIT 50",
        org_id,
    )
    return {"data": [dict(r) for r in rows]}


# ── Admin: billing overview ──────────────────────────────

_admin = require_platform_role("platform_admin", "account_manager")

@router.get("/admin/usage")
async def admin_usage(
    user=Depends(require_user),
    _a=Depends(_admin),
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
        "SELECT r.id, r.org_id, r.scraper_id, r.user_id, r.status, r.result_count, "
        "r.billed_inr, r.cost_usd, r.error, r.created_at, r.finished_at, "
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
    return {"data": [dict(r) for r in rows]}
