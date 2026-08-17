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
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response

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
