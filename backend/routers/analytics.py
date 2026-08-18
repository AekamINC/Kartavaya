"""analytics.py — the universal analytic contract. Proposal 62, phase D2.

One request shape for every analytic in the product:

    GET /api/v1/analytics/run?metric=ganit.invoiced
        &date_from=2026-04-01&date_to=2026-06-30
        &bucket=month&group_by=invoice_type
        &compare=previous_period
        &format=json            # json | csv | xlsx | pdf — SAME query, four renderings

`format` being a parameter rather than a separate endpoint is what makes
"download exactly what I am looking at" true rather than approximately true:
the file runs the same SQL with the same window and the same grouping as the
screen. An unknown format is a 400, never a silent fall-through to JSON —
dristi's export path ignored xlsx/pdf for months precisely that way.

── THE GATE, AND WHY IT IS NOT `held_level` ─────────────────────────────────
This router is deliberately NOT gated on the `dristi` module: a metric carries
its OWN module (proposal 62 fault 2 — buy Ganit, get Ganit's numbers). But
"can reach the module" is two different questions:

  · The CATALOGUE lists names. `held_level` (plain args, never raises, None
    means no) is the right instrument — listing a metric's existence is not
    serving its data.
  · `/run` serves DATA. Only `require_module(code)` checks the subscription
    state and writes the sensitive-module audit row for platform-role reads —
    `held_level` does neither, and a /run gated on it alone would serve
    financials for a lapsed module and leave no audit trail. It is called
    DIRECTLY, the way `routers/search.py` does: the dependency callable runs
    the identical checks FastAPI would run. It reads the authed user off
    `request.state`, which this route's own `Depends(require_user)` has set.
    Never give a helper a `Depends(...)` default — a plain call receives the
    sentinel, and that shape once 500'd every PATCH /api/tasks for ten days.

── FLOWS AND STOCKS (D1's rule, inherited) ──────────────────────────────────
A `flow` metric measures what happened DURING a period and REQUIRES
date_from/date_to here — `aw.parse`'s None-means-unchanged contract belongs
to the RETROFITTED dristi reads and is not reused as a default on a new
endpoint. A `stock` metric is true AS AT an instant: the window is ignored,
and the response says `as_at` rather than pretending a period was applied.
"""
import asyncio
import csv
import io
import json
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from analytics.presets import PRESETS, VIZ_TYPES, preset_catalogue
from analytics.registry import REGISTRY, MetricRequest, catalogue_for, load_all, modules_in_registry
from analytics.windowing import BUCKETS, COMPARE_MODES, compare_window
from auth_router import require_user
from db import get_pool
from middleware.module_levels import held_level
from middleware.org_resolver import get_org_id
from middleware.subscription import require_module
from services import analytics_window as aw
from services.report_render import csv_cell

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])
log = logging.getLogger(__name__)

# Every metrics module registers at import. A broken declaration fails HERE,
# at startup, not at the first request that touches it.
load_all()

FORMATS = ("json", "csv", "xlsx", "pdf")

#: Core PM is deliberately NOT module-gated — `role_tiers.py`'s own words: "the
#: surface a project-only role reaches is precisely the surface that is NOT
#: module-gated — core PM and notifications". `core` is not in ALL_MODULES and
#: no org_modules row for it will ever exist, so `require_module("core")`
#: would refuse every org its own task counts. Membership in the org — which
#: `require_user` + `get_org_id` have already established by the time any
#: route body runs — is exactly the entitlement core PM itself uses.
UNGATED_MODULES = frozenset({"core"})


async def _reachable(pool, user_id: str, org_id: str) -> set[str]:
    """Which registry modules this caller may SEE — the catalogue intersection.

    The same loop `routers/dristi.reachable_modules` runs, over `held_level`
    (plain arguments, never raises, None = may not read). Re-implemented
    rather than imported: a router must not be imported for a helper (see
    services/gst_period.py's note on that dependency direction).
    """
    out = set(UNGATED_MODULES & modules_in_registry())
    for code in modules_in_registry() - UNGATED_MODULES:
        if await held_level(pool, user_id, org_id, code) is not None:
            out.add(code)
    return out


@router.get("/catalogue")
async def catalogue(
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    reachable = await _reachable(pool, user["user_id"], org_id)
    metrics = catalogue_for(reachable)
    return {
        "metrics": metrics,
        "buckets": sorted(BUCKETS),
        "compare_modes": sorted(COMPARE_MODES),
        "formats": list(FORMATS),
        # How many declarations entitlement hid — the same honesty line
        # /widget-types draws, so the UI can say "3 more with other modules"
        # instead of looking like the product is small.
        "withheld_count": len(REGISTRY) - len(metrics),
    }


@router.get("/run")
async def run(
    request: Request,
    metric: str,
    date_from: str = "",
    date_to: str = "",
    bucket: str = "month",
    group_by: str = "",
    compare: str = "",
    format: str = "json",
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    m = REGISTRY.get(metric)
    if m is None:
        raise HTTPException(404, f"unknown metric: {metric!r} — see /api/v1/analytics/catalogue")

    # The REAL gate, before anything else is inspected or computed: platform
    # reach, org role, per-user grant, subscription state, and the audit row
    # for sensitive modules. Its refusal is the response. Core PM is the one
    # ungated surface (see UNGATED_MODULES) — org membership, already proven
    # by get_org_id, is its whole entitlement.
    if m.module not in UNGATED_MODULES:
        await require_module(m.module)(request, org_id)

    if m.absent:
        # 422: the request is well-formed; the schema cannot answer it
        # honestly. The reason is the payload — proposal 62 §10, a stated
        # absence, never a convincing zero.
        raise HTTPException(422, {"metric": m.key, "absent": m.absent})

    if format not in FORMATS:
        raise HTTPException(400, f"format must be one of: {', '.join(FORMATS)}")
    if bucket not in BUCKETS:
        raise HTTPException(400, f"bucket must be one of: {', '.join(sorted(BUCKETS))}")
    if group_by and group_by not in m.dimensions:
        allowed = ", ".join(m.dimensions) or "(none)"
        raise HTTPException(400, f"group_by for {m.key} must be one of: {allowed}")
    if compare and compare not in COMPARE_MODES:
        raise HTTPException(400, f"compare must be one of: {', '.join(sorted(COMPARE_MODES))}")

    win = aw.parse(date_from, date_to)
    if m.grain == "flow" and win is None:
        raise HTTPException(
            400,
            f"{m.key} measures a flow — date_from and date_to are required. "
            "Stocks (as-at-today metrics) take no window; this is not one.",
        )
    if m.grain == "stock":
        # A stock has no period. The bounds are IGNORED rather than applied to
        # some arbitrary column, and the response says so — a date picker above
        # a headcount must not imply an authority it does not have.
        win = None

    pool = await get_pool()
    req = MetricRequest(org_id=org_id, window=win, bucket=bucket, group_by=group_by or None)
    sql, params = m.sql(req)
    rows = [dict(r) for r in await pool.fetch(sql, *params)]

    compared = None
    if compare and m.grain == "flow":
        cw = compare_window(win, compare)
        csql, cparams = m.sql(MetricRequest(org_id=org_id, window=cw, bucket=bucket,
                                            group_by=group_by or None))
        compared = {
            "mode": compare,
            "window": cw.as_dict(),
            "data": [dict(r) for r in await pool.fetch(csql, *cparams)],
        }

    payload = {
        "metric": m.key,
        "label": m.label,
        "unit": m.unit,
        "grain": m.grain,
        "group_by": group_by or None,
        "bucket": bucket if m.grain == "flow" else None,
        "window": (
            {**win.as_dict(), "windowed": [m.key], "as_at": []}
            if win is not None
            else {"as_at": date.today().isoformat(), "windowed": [], "note":
                  "stock metric — true as at today; any supplied bounds were ignored"}
        ),
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": rows,
        "compare": compared,
    }

    if format == "json":
        return payload

    stem = m.key.replace(".", "-") + (
        f"_{win.start.isoformat()}_{win.end.isoformat()}" if win
        else f"_as-at-{date.today().isoformat()}"
    )

    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        headers = list(rows[0].keys()) if rows else ["value"]
        w.writerow(headers)
        for r in rows:
            w.writerow([csv_cell(r.get(h)) for h in headers])
        return Response(
            content=buf.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{stem}.csv"'},
        )

    if format == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font

        wb = Workbook()
        ws = wb.active
        ws.title = "Data"
        headers = list(rows[0].keys()) if rows else ["value"]
        ws.append([m.label])
        ws["A1"].font = Font(bold=True, size=14)
        period = (f"{win.start.isoformat()} to {win.end.isoformat()}" if win
                  else f"as at {date.today().isoformat()}")
        ws.append([period])
        ws.append([])
        ws.append(headers)
        for cell in ws[4]:
            cell.font = Font(bold=True)
        for r in rows:
            ws.append([csv_cell(r.get(h)) for h in headers])
        out = io.BytesIO()
        wb.save(out)
        return Response(
            content=out.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stem}.xlsx"'},
        )

    # pdf — the branded page: org name and logo, title, exact window,
    # generation timestamp; NO GSTIN, NO address, NO phone (owner's ruling,
    # 17 Aug 2026 — this is a working document, not a tax document).
    from services import doc_render as R
    from services.gst_period import load_org
    from services.report_render import analytics_letterhead

    org = await load_org(pool, org_id)
    period_line = (f"{win.start.strftime('%d %b %Y')} – {win.end.strftime('%d %b %Y')}"
                   if win else f"As at {date.today().strftime('%d %b %Y')}")

    def _build_and_render() -> bytes:
        # The WHOLE page build runs off the event loop, not just WeasyPrint:
        # `analytics_letterhead` → `letterhead` → `embed_logo` performs a
        # BLOCKING httpx.get for the org's R2-signed logo (up to 4 MB), and a
        # slow fetch on the loop stalls every concurrent request the worker
        # holds. Review finding, 2026-08-17.
        head = analytics_letterhead(org, m.label, "", period_line)

        def _is_num(v) -> bool:
            return isinstance(v, (int, float)) and not isinstance(v, bool)

        headers = list(rows[0].keys()) if rows else []
        body_rows = [
            "<tr>" + "".join(
                f'<td class="{"num" if _is_num(csv_cell(r.get(h))) else ""}">'
                f"{R.esc(str(csv_cell(r.get(h))))}</td>"
                for h in headers
            ) + "</tr>"
            for r in rows
        ]
        data_table = R.table(
            [(h, "num" if rows and _is_num(csv_cell(rows[0].get(h))) else "", "")
             for h in headers],
            body_rows,
        ) if rows else "<p>No rows for this period.</p>"

        generated = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
        page = "".join([
            head,
            data_table,
            R.foot(f"Generated {R.esc(generated)} &middot; Prepared in Kartavya"),
        ])
        html_doc = R.document(
            [page], org, title=f"{m.label} — Kartavaya",
            running=R.running_id(m.label, org, period_line),
        )
        return R.render_pdf(html_doc)

    return Response(
        content=await asyncio.to_thread(_build_and_render),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )


# ── Saved views (proposal 62 D3) ─────────────────────────────────────────────
#
# One table for every analytics surface (staging.analytics_views, migration
# 149) and one resolution order, stated once:
#
#     personal (user_id = viewer)  >  org (user_id IS NULL)  >  code preset
#
# The module tabs and the Dristi cross-module surface both read these routes;
# `module='dristi'` is the cross-module surface's name. Layouts are validated
# ON SAVE against the registry — a rule the builder cannot express must be
# unwritable (the same promise validate_steps makes for Niyam) — and rows are
# STILL not trusted at render time, because a metric can be retired after a
# view named it; the frontend renders an unknown key as an absent widget.

#: A view is a working screen, not a data warehouse. Thirty widgets is
#: already past what a person reads; past it is a runaway client.
MAX_WIDGETS = 30

#: The cross-module surface's module name. Not in the registry — it is a
#: SURFACE, not an entitlement; reaching it is gated by the dristi module the
#: same way the dristi router gates itself.
CROSS_MODULE = "dristi"


class ViewCreate(BaseModel):
    module: str
    name: str = Field(min_length=1, max_length=80)
    layout: list
    scope: str = "personal"          # personal | org
    is_default: bool = False


class ViewUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    layout: list | None = None
    is_default: bool | None = None


def _clean_layout(layout) -> list:
    """Validate and REBUILD every widget — a whitelist, so junk keys never
    reach the row. 422s name the widget index and the offence."""
    if not isinstance(layout, list):
        raise HTTPException(422, "layout must be a list of widgets")
    if len(layout) > MAX_WIDGETS:
        raise HTTPException(422, f"a view holds at most {MAX_WIDGETS} widgets")
    out = []
    for i, w in enumerate(layout):
        if not isinstance(w, dict):
            raise HTTPException(422, f"widget {i}: not an object")
        metric = w.get("metric")
        m = REGISTRY.get(metric)
        if m is None:
            raise HTTPException(
                422, f"widget {i}: {metric!r} is not a metric this product "
                     f"has — see /api/v1/analytics/catalogue")
        viz = w.get("viz", "kpi")
        if viz not in VIZ_TYPES:
            raise HTTPException(
                422, f"widget {i}: `{viz}` is not a way to draw a metric. "
                     f"Available: {', '.join(VIZ_TYPES)}")
        width = w.get("w", 1)
        if width not in (1, 2, 3):
            raise HTTPException(422, f"widget {i}: w must be 1, 2 or 3 grid columns")
        item = {"metric": metric, "viz": viz, "w": width}
        group_by = w.get("group_by")
        if group_by:
            if group_by not in m.dimensions:
                raise HTTPException(
                    422, f"widget {i}: {metric} cannot group by {group_by!r}. "
                         f"Dimensions: {', '.join(m.dimensions) or 'none'}")
            item["group_by"] = group_by
        columns = w.get("columns")
        if columns:
            if viz != "table":
                raise HTTPException(
                    422, f"widget {i}: columns is the table chooser's field; "
                         f"this widget is a {viz}")
            item["columns"] = [str(c)[:64] for c in columns][:12]
        out.append(item)
    return out


def _row_out(r) -> dict:
    layout = r["layout"]
    if isinstance(layout, str):
        layout = json.loads(layout)
    return {
        "id": str(r["id"]),
        "scope": "org" if r["user_id"] is None else "personal",
        "name": r["name"],
        "layout": layout,
        "is_default": r["is_default"],
        "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
    }


def _presets_for(module: str, reachable: set) -> list:
    """Presets, cut to what THIS caller may see.

    On a module tab, a preset contributes only its widgets for that module;
    on the cross-module surface, only widgets whose module is reachable. A
    preset with nothing left after the cut is omitted, not shown as a husk.
    """
    out = []
    for key, p in PRESETS.items():
        if module == CROSS_MODULE:
            layout = [w for w in p["layout"]
                      if REGISTRY[w["metric"]].module in reachable]
        else:
            layout = [w for w in p["layout"]
                      if REGISTRY[w["metric"]].module == module]
        if layout:
            out.append({"key": key, "label": p["label"], "hi": p.get("hi", ""),
                        "why": p["why"], "layout": layout})
    return out


async def _module_reachable_or_403(pool, user_id: str, org_id: str, module: str):
    if module == CROSS_MODULE:
        # The cross-module surface is itself the dristi module's screen.
        if await held_level(pool, user_id, org_id, "dristi") is None:
            raise HTTPException(403, "This view surface needs the Dristi module")
        return
    if module not in modules_in_registry():
        raise HTTPException(404, f"unknown module: {module!r}")
    if module not in UNGATED_MODULES and             await held_level(pool, user_id, org_id, module) is None:
        raise HTTPException(403, f"You do not have access to {module}")


@router.get("/views")
async def list_views(
    module: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    await _module_reachable_or_403(pool, user["user_id"], org_id, module)
    reachable = await _reachable(pool, user["user_id"], org_id)
    rows = await pool.fetch(
        "SELECT id, user_id, name, layout, is_default, updated_at "
        "  FROM staging.analytics_views "
        " WHERE org_id = $1::uuid AND module = $2::text AND is_active "
        "   AND (user_id IS NULL OR user_id = $3::text) "
        " ORDER BY updated_at DESC",
        org_id, module, user["user_id"])
    personal = [_row_out(r) for r in rows if r["user_id"] is not None]
    org_views = [_row_out(r) for r in rows if r["user_id"] is None]
    presets = _presets_for(module, reachable)

    # The resolution, applied server-side so every surface agrees on it.
    resolved = next((v for v in personal if v["is_default"]), None)
    source = "personal" if resolved else None
    if resolved is None:
        resolved = next((v for v in org_views if v["is_default"]), None)
        source = "org" if resolved else None
    if resolved is None and presets:
        resolved = {"name": presets[0]["label"], "layout": presets[0]["layout"]}
        source = f"preset:{presets[0]['key']}"
    return {
        "personal": personal,
        "org": org_views,
        "presets": presets,
        # source=None means "nothing saved, no preset survives the cut" — the
        # frontend falls back to its built-in arrangement and says so.
        "resolved": {"source": source, **(resolved or {"layout": []})},
    }


@router.post("/views")
async def create_view(
    body: ViewCreate,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    await _module_reachable_or_403(pool, user["user_id"], org_id, body.module)
    layout = _clean_layout(body.layout)
    if body.scope not in ("personal", "org"):
        raise HTTPException(422, "scope is personal or org")
    owner = user["user_id"]
    if body.scope == "org":
        # An org view is what everyone in the org opens: writing one is org
        # administration, same bar as the module settings screens.
        from middleware.roles import admin_org_id
        if not await admin_org_id(user["user_id"], org_id):
            raise HTTPException(403, "Only an org admin can save an org-wide view")
        owner = None
    if body.is_default:
        await pool.execute(
            "UPDATE staging.analytics_views SET is_default = FALSE "
            " WHERE org_id = $1::uuid AND module = $2::text "
            "   AND user_id IS NOT DISTINCT FROM $3::text",
            org_id, body.module, owner)
    row = await pool.fetchrow(
        "INSERT INTO staging.analytics_views "
        "    (org_id, user_id, module, name, layout, is_default, created_by) "
        "VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6, $7::text) "
        "RETURNING id, user_id, name, layout, is_default, updated_at",
        org_id, owner, body.module, body.name, json.dumps(layout),
        body.is_default, user["user_id"])
    return _row_out(row)


async def _owned_view_or_404(pool, view_id: str, org_id: str, user) -> dict:
    """The row, if this caller may WRITE it: their own personal view, or an
    org view when they administer the org. Anyone else gets the same 404 a
    nonexistent id gets — a view's existence is not theirs to probe."""
    row = await pool.fetchrow(
        "SELECT id, user_id, module, name, layout, is_default, updated_at "
        "  FROM staging.analytics_views "
        " WHERE id = $1::uuid AND org_id = $2::uuid AND is_active",
        view_id, org_id)
    if row is None:
        raise HTTPException(404, "View not found")
    if row["user_id"] is None:
        from middleware.roles import admin_org_id
        if not await admin_org_id(user["user_id"], org_id):
            raise HTTPException(404, "View not found")
    elif row["user_id"] != user["user_id"]:
        raise HTTPException(404, "View not found")
    return row


@router.patch("/views/{view_id}")
async def update_view(
    view_id: str,
    body: ViewUpdate,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    row = await _owned_view_or_404(pool, view_id, org_id, user)
    updates, vals = [], []
    if body.name is not None:
        vals.append(body.name)
        updates.append(f"name = ${len(vals)}::text")
    if body.layout is not None:
        vals.append(json.dumps(_clean_layout(body.layout)))
        updates.append(f"layout = ${len(vals)}::jsonb")
    if body.is_default is not None:
        if body.is_default:
            await pool.execute(
                "UPDATE staging.analytics_views SET is_default = FALSE "
                " WHERE org_id = $1::uuid AND module = $2::text "
                "   AND user_id IS NOT DISTINCT FROM $3::text",
                org_id, row["module"], row["user_id"])
        vals.append(body.is_default)
        updates.append(f"is_default = ${len(vals)}")
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates.append("updated_at = NOW()")
    vals += [view_id, org_id]
    out = await pool.fetchrow(
        f"UPDATE staging.analytics_views SET {', '.join(updates)} "
        f" WHERE id = ${len(vals) - 1}::uuid AND org_id = ${len(vals)}::uuid "
        f"RETURNING id, user_id, name, layout, is_default, updated_at",
        *vals)
    return _row_out(out)


@router.delete("/views/{view_id}")
async def delete_view(
    view_id: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    pool = await get_pool()
    await _owned_view_or_404(pool, view_id, org_id, user)
    await pool.execute(
        "UPDATE staging.analytics_views SET is_active = FALSE, updated_at = NOW() "
        " WHERE id = $1::uuid AND org_id = $2::uuid",
        view_id, org_id)
    return {"ok": True}


# ── Metric alerts (proposal 62 D7) ───────────────────────────────────────────
#
# The row decides WHEN (which metric, which line); the shipped Niyam template
# decides WHO HEARS. Evaluation happens in the Niyam sweep and runs the
# metric's own registry SQL, so the alert and the dashboard can never
# disagree about what DSO is. Managing alerts is org administration — the
# events they raise go to the org's admins.


class AlertCreate(BaseModel):
    metric: str
    operator: str
    threshold: float
    window_days: int = 30


async def _admin_or_403(user, org_id):
    from middleware.roles import admin_org_id
    if not await admin_org_id(user["user_id"], org_id):
        raise HTTPException(403, "Alerts are managed by an org admin")


@router.get("/alerts")
async def list_alerts(
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    await _admin_or_403(user, org_id)
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, metric, operator, threshold, window_days, created_at "
        "  FROM staging.analytics_alerts "
        " WHERE org_id = $1::uuid AND is_active ORDER BY created_at",
        org_id)
    out = []
    for r in rows:
        m = REGISTRY.get(r["metric"])
        out.append({
            "id": str(r["id"]),
            "metric": r["metric"],
            # The label rides along so the screen never renders a bare key —
            # and a retired metric says so instead of vanishing silently.
            "label": m.label if m else f"{r['metric']} (no longer measured)",
            "unit": m.unit if m else None,
            "operator": r["operator"],
            "threshold": r["threshold"],
            "window_days": r["window_days"],
        })
    return {"alerts": out}


@router.post("/alerts")
async def create_alert(
    body: AlertCreate,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    await _admin_or_403(user, org_id)
    pool = await get_pool()
    m = REGISTRY.get(body.metric)
    if m is None:
        raise HTTPException(
            422, f"{body.metric!r} is not a metric this product has — see "
                 f"/api/v1/analytics/catalogue")
    if m.absent:
        # An alert on an unmeasurable metric would sit silent for ever and
        # read as "everything is fine" — the exact lie a stated absence
        # exists to prevent.
        raise HTTPException(422, {"metric": m.key, "absent": m.absent})
    if m.module not in UNGATED_MODULES and             await held_level(pool, user["user_id"], org_id, m.module) is None:
        raise HTTPException(403, f"You do not have access to {m.module}")
    if body.operator not in ("gt", "lt"):
        raise HTTPException(422, "operator is gt or lt")
    if not (1 <= body.window_days <= 366):
        raise HTTPException(422, "window_days is between 1 and 366")
    row = await pool.fetchrow(
        "INSERT INTO staging.analytics_alerts "
        "    (org_id, metric, operator, threshold, window_days, created_by) "
        "VALUES ($1::uuid, $2::text, $3::text, $4::float8, $5::int, $6::text) "
        "RETURNING id",
        org_id, body.metric, body.operator, float(body.threshold),
        body.window_days, user["user_id"])
    return {"id": str(row["id"]), "metric": body.metric,
            "operator": body.operator, "threshold": body.threshold,
            "window_days": body.window_days}


@router.delete("/alerts/{alert_id}")
async def delete_alert(
    alert_id: str,
    user=Depends(require_user),
    org_id=Depends(get_org_id),
):
    await _admin_or_403(user, org_id)
    pool = await get_pool()
    done = await pool.execute(
        "UPDATE staging.analytics_alerts "
        "   SET is_active = FALSE, updated_at = NOW() "
        " WHERE id = $1::uuid AND org_id = $2::uuid AND is_active",
        alert_id, org_id)
    if done == "UPDATE 0":
        raise HTTPException(404, "Alert not found")
    return {"ok": True}
