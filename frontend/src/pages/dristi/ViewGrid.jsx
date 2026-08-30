// ViewGrid · the saved-view board (proposal 62 D3, rebuilt per proposal 67).
//
// A view is a LIST of widgets — {metric, viz, x, y, w, h, group_by?,
// columns?} — on a 12-column grid whose row unit is the --anx-rowh token.
// Older saved views carry only {metric, viz, w:1–3}; normalizeLayout upgrades
// them on first open (widths ×4, positions packed in list order) and nothing
// asks the user. All collision, clamp and density arithmetic lives in
// boardEngine.js, pure, so the rules are unit-testable without this DOM.
//
// Two rules of the board, both the owner's:
// · Every pointer gesture has a keyboard path — the grip carries (Enter,
//   arrows, Enter/Escape), the corner handle resizes by arrows, and an
//   aria-live region says what happened in words.
// · NO DEAD SPACE. A card's fill count comes from its MEASURED body pixels
//   one rAF after layout — never from a unit-based guess — and the resize
//   handle refuses to grow a card past what its data can fill, using the
//   same arithmetic (maxHFromMeasured).
//
// The renderer trusts NOTHING in the row. Layouts are validated on save, but
// a metric can be retired after a view named it — an unknown key renders as a
// stated absence, exactly like a declared-absent metric, never an error card.
//
// Each widget runs its own /run request. That is deliberate: one slow metric
// must not hold the other eleven, and the per-widget failure state is the
// same PanelState vocabulary the bespoke tab uses.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Shimmer } from '../../components/editorial';
import useMediaQuery from '../../hooks/useMediaQuery';
import { Bi, DataTable, Td, FMT, MONEY, NUM, PCT, periodLabel } from './_shared';
import { AlertForm } from './AlertsPanel';
import {
  COLS, ROWH, GAP, MINW, MINH,
  normalizeLayout, reflow, pack, fitCounts, maxHFromMeasured,
  stackMove, capColumns,
} from './boardEngine';

/** Local date, never toISOString() — UTC moves an IST date back a day. */
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const fmtByUnit = (v, unit) => {
  if (v == null || Number.isNaN(Number(v))) return '—';
  if (unit === 'inr') return MONEY(v);
  if (unit === 'pct') return PCT(v);
  if (unit === 'days') return `${NUM(Math.round(Number(v) * 10) / 10)} days`;
  if (unit === 'hours') return `${NUM(Math.round(Number(v) * 10) / 10)} h`;
  return NUM(v);
};

/** The label-ish key of a categorical row — never an id. */
const labelKey = (row) => {
  const preferred = ['label', 'bucket', 'status', 'category', 'section',
    'component', 'type', 'name', 'period'];
  for (const k of preferred) if (row[k] != null) return k;
  return Object.keys(row).find(
    (k) => typeof row[k] === 'string' && !/(^|_)id$/.test(k),
  );
};

/** Columns a generic table may show: everything except ids. The names-not-ids
 *  rule is server-enforced in every payload we ship, but a generic renderer
 *  must hold the line for payload shapes it has never seen. */
const tableColumns = (rows, chosen) => {
  if (!rows.length) return [];
  const all = Object.keys(rows[0]).filter((k) => !/(^|_)id$/.test(k));
  if (chosen?.length) return chosen.filter((c) => all.includes(c));
  return all.slice(0, 8);
};

function kpiValue(payload) {
  const rows = payload?.data || [];
  if (!rows.length) return { v: null, sub: '' };
  if (rows.length === 1) return { v: rows[0].value, sub: '' };
  const unit = payload.unit;
  if (unit === 'pct') {
    // Never the mean of period rates. When the rows carry the sums the rate
    // is made of, recompute; otherwise show the latest period and say so.
    const num = rows.reduce((s, r) => s + (Number(r.collected) || 0), 0);
    const den = rows.reduce((s, r) => s + (Number(r.invoiced) || 0), 0);
    if (den > 0) return { v: (num / den) * 100, sub: 'whole period' };
    const last = rows[rows.length - 1];
    return { v: last.value, sub: `latest: ${last.period ?? ''}` };
  }
  return { v: rows.reduce((s, r) => s + (Number(r.value) || 0), 0), sub: '' };
}

/** The KPI's earned sparkline: a roomy card with period rows shows the run's
 *  own series — a stock metric with a single as-at figure gets nothing, and
 *  the kpi block centres instead so the card never leaves a hollow block. */
function KpiBody({ payload, spark }) {
  const { v, sub } = kpiValue(payload);
  const series = (payload?.data || []).filter((r) => r.period != null);
  const showSpark = spark && series.length > 1;
  const max = showSpark
    ? Math.max(...series.map((r) => Number(r.value) || 0), 0)
    : 0;
  return (
    <div className="vgw-kpi">
      <div className="vgw-kpi__v">{fmtByUnit(v, payload.unit)}</div>
      {sub && <div className="vgw-kpi__s">{sub}</div>}
      {showSpark && max > 0 && (() => {
        // A sparkline, at last. This block rendered a row of `<i>` elements
        // with a percentage height — micro-BARS under a class called `spark`.
        // Bars answer "how big was each period"; a KPI card has already given
        // the figure and wants the other question, "which way is this going",
        // which is a line. Twelve 3px columns also read as texture at this size
        // rather than as a shape.
        //
        // Geometry in one place so the SVG and the endpoint dot cannot drift:
        // the dot is positioned in CSS percentages rather than drawn in the
        // SVG, because `preserveAspectRatio="none"` is what lets the line
        // stretch to any card width and it would squash a <circle> into an
        // ellipse by exactly the same factor.
        const n = series.length;
        // x is inset 2 either side so the 1.5px stroke and the dot are not
        // clipped at the card edge; y from 25 (zero) to 3 (max).
        const X = (i) => 2 + (i / (n - 1)) * 96;
        const Y = (v) => 25 - ((Number(v) || 0) / max) * 22;
        const pts = series.map((r, i) => [X(i), Y(r.value)]);
        const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
        // The area closes on the ZERO line, not on the box floor, so the fill
        // means "volume above zero" rather than "distance from the bottom of
        // whatever this card happens to be".
        const area = `${line} L${X(n - 1).toFixed(2)} 25 L${X(0).toFixed(2)} 25 Z`;
        const lastY = Y(series[n - 1].value);
        return (
          <>
            <div className="vgw-spark">
              <svg className="vgw-spark__svg" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <path className="vgw-spark__area" d={area} />
                {/* pathLength normalises the stroke to 1 unit, which is what
                    lets the draw-on run without measuring the path in JS. */}
                <path className="vgw-spark__line" d={line} pathLength="1" vectorEffect="non-scaling-stroke" />
              </svg>
              {/* The latest period, which is the one the reader is being asked
                  to react to — the same thing `--now` marked on the old bars. */}
              <i className="vgw-spark__dot" style={{ bottom: `${(((28 - lastY) / 28) * 100).toFixed(2)}%` }} />
            </div>
            <div className="vgw-sparklab">{`last ${n} periods`}</div>
          </>
        );
      })()}
    </div>
  );
}

/** Density-cut trend: the last N periods by the width ladder, bars stretched
 *  to the card's height so any height fills. */
function Trend({ payload, n }) {
  const rows = (payload?.data || []).filter((r) => r.period != null);
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 0);
  if (!rows.length || max <= 0) return <p className="dnone">Nothing in this period yet.</p>;
  const cut = rows.slice(-Math.max(1, n));
  const cutMax = Math.max(...cut.map((r) => Number(r.value) || 0), 0);
  return (
    <>
      <div className="vgw-trend">
        {cut.map((r) => (
          <div className="vgw-trend__c" key={r.period}>
            {/* The value a reader gets. A title on a non-focusable span is
                reachable by nobody without a mouse — the bar is decoration
                and this text is the datum. */}
            <span className="k-sr-only">
              {`${periodLabel(r.period)}: ${fmtByUnit(r.value, payload.unit)}`}
            </span>
            <span className="vgw-trend__t" aria-hidden="true">
              <span
                className="vgw-trend__b"
                style={{ height: `${Math.max(((Number(r.value) || 0) / cutMax) * 100, 0)}%` }}
                title={fmtByUnit(r.value, payload.unit)}
              />
            </span>
            <span className="vgw-trend__x" title={String(r.period)} aria-hidden="true">
              {periodLabel(r.period)}
            </span>
          </div>
        ))}
      </div>
      <div className="vgw-fitnote">
        {cut.length < rows.length
          ? `last ${cut.length} of ${rows.length} periods — widen for more`
          : 'the full window'}
      </div>
    </>
  );
}

/** Horizontal bars, as many rows as the measured pixels hold; space-evenly
 *  distributes the sub-row remainder so the card never shows a hollow band. */
function HBars({ payload, n }) {
  const rows = payload?.data || [];
  if (!rows.length) return <p className="dnone">Nothing in this period yet.</p>;
  const lk = labelKey(rows[0]);
  const cut = rows.slice(0, Math.max(1, n));
  const max = Math.max(...cut.map((r) => Number(r.value) || 0), 0);
  return (
    <>
      <div className="vgw-hbars">
        {cut.map((r, i) => (
          <div className="vgw-hbars__r" key={lk ? `${r[lk]}-${i}` : i}>
            <span className="vgw-hbars__l" title={lk ? String(r[lk]) : undefined}>
              {lk ? String(r[lk]) : '—'}
            </span>
            <span className="vgw-hbars__t">
              <span
                className="vgw-hbars__f"
                style={{ '--w': `${max > 0 ? ((Number(r.value) || 0) / max) * 100 : 0}%` }}
              />
            </span>
            <span className="vgw-hbars__n">{fmtByUnit(r.value, payload.unit)}</span>
          </div>
        ))}
      </div>
      {cut.length < rows.length && (
        <div className="vgw-fitnote">{`+${rows.length - cut.length} more — taller shows them`}</div>
      )}
    </>
  );
}

function WidgetBody({ viz, run, columns, geomW, fit }) {
  if (!run) return <Shimmer count={2} />;
  if (run.status === 'absent' || run.status === 'missing') {
    return <p className="dnone" title={run.reason}>Not yet measurable.</p>;
  }
  if (run.status === 'err') {
    return (
      <div className="note note--warn" role="status">
        <span><b>This did not load.</b> {run.err}</span>
      </div>
    );
  }
  const payload = run.payload;
  if (viz === 'kpi') return <KpiBody payload={payload} spark={fit.spark} />;
  if (viz === 'trend') return <Trend payload={payload} n={fit.n} />;
  if (viz === 'bars') return <HBars payload={payload} n={fit.n} />;
  // table
  const rows = payload?.data || [];
  if (!rows.length) return <p className="dnone">Nothing in this period yet.</p>;
  const cols = capColumns(tableColumns(rows, columns), geomW);
  const cut = rows.slice(0, Math.max(1, fit.n));
  return (
    <>
      <DataTable columns={cols.map((c) => ({
        label: c.replace(/_/g, ' '),
        align: typeof rows[0][c] === 'number' ? 'right' : undefined,
      }))}
      >
        {cut.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              typeof rows[0][c] === 'number'
                ? <Td key={c} align="right" mono>{FMT(r[c])}</Td>
                : <Td key={c}>{String(r[c] ?? '—')}</Td>
            ))}
          </tr>
        ))}
      </DataTable>
      {cut.length < rows.length && (
        <div className="vgw-fitnote">{`+${rows.length - cut.length} more rows — taller shows them`}</div>
      )}
    </>
  );
}

/** The default door: the tenant analytics endpoint. A board pointed at a
 *  different surface (the Aekam Pulse console) passes its own `runPath`; the
 *  envelope is byte-identical, only the door differs. */
const DEFAULT_RUN_PATH = '/v1/analytics/run';

function runUrlFor(meta, range, widget = {}, extra = {}, runPath = DEFAULT_RUN_PATH) {
  const q = new URLSearchParams({ metric: meta.key });
  if (meta.grain === 'flow') {
    q.set('date_from', range.from);
    q.set('date_to', range.to);
    const days = (new Date(range.to) - new Date(range.from)) / 86400000;
    q.set('bucket', days > 1200 ? 'year' : days > 400 ? 'quarter' : 'month');
  }
  if (widget.group_by) q.set('group_by', widget.group_by);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `${runPath}?${q.toString()}`;
}

const MIME = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * The download affordance every card carries: CSV / XLSX / PDF off the SAME
 * `/run` URL the card itself uses, with `format=` added — the file runs the
 * same SQL with the same window, bucket and group_by as the screen. Fetched
 * as a blob through `api`, exactly the way ReportsTab.exportCSV does, because
 * a bare `window.open` hits the wrong origin and carries no credentials (the
 * long note at the top of that file).
 *
 * ONE definition, two doors: the widget cards here pass their `widget` so the
 * file carries the widget's own group_by; AnalyticsTab's bespoke ganit cards
 * import this and omit it. The filename stem is the metric key plus the exact
 * window, or as-at-today for a stock — a file that does not say which dates
 * it covers is indistinguishable from one that covers all.
 */
export function Downloads({ meta, range, label, widget = {}, runPath = DEFAULT_RUN_PATH }) {
  const { pushToast } = useToast();
  const [busy, setBusy] = useState('');

  const pull = async (format) => {
    setBusy(format);
    try {
      const r = await api.get(runUrlFor(meta, range, widget, { format }, runPath), { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: MIME[format] }));
      const a = document.createElement('a');
      a.href = url;
      const stem = meta.grain === 'flow'
        ? `${meta.key.replace('.', '-')}_${range.from}_${range.to}`
        : `${meta.key.replace('.', '-')}_as-at-${iso(new Date())}`;
      a.download = `${stem}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // A blob-typed error body is a Blob, not JSON — read it back before it
      // becomes "[object Blob]" in the toast.
      let detail = 'The download failed.';
      if (e.response?.data instanceof Blob) {
        try { detail = JSON.parse(await e.response.data.text()).detail || detail; } catch { /* keep default */ }
      } else if (e.response?.data?.detail) {
        detail = e.response.data.detail;
      }
      pushToast({ type: 'error', title: typeof detail === 'string' ? detail : 'The download failed.' });
    }
    setBusy('');
  };

  return (
    <span className="anx-dl" role="group" aria-label={`Download ${label}`}>
      {['csv', 'xlsx', 'pdf'].map((f) => (
        <button
          type="button"
          key={f}
          className="chip anx-dl__b"
          disabled={busy !== ''}
          aria-label={`Download ${label} as ${f.toUpperCase()}`}
          onClick={() => pull(f)}
        >
          {busy === f ? '…' : f.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

function Widget({
  id, widget, geom, byKey, range, editable, narrow, style,
  lifting, sizing, carried, fitNonce, runPath = DEFAULT_RUN_PATH,
  onGripDown, onGripKey, onGripBlur, onSizeDown, onSizeKey,
  onChange, onRemove, onStackMove, onNode, onInfo,
}) {
  const meta = byKey?.[widget.metric];
  const [run, setRun] = useState(null);
  const [alerting, setAlerting] = useState(false);
  const bodyRef = useRef(null);
  const [fit, setFit] = useState(null);

  useEffect(() => {
    let on = true;
    setRun(null);
    if (!meta) {
      setRun({ status: 'missing', reason: 'No longer in the analytics catalogue.' });
      return undefined;
    }
    if (meta.absent) {
      setRun({ status: 'absent', reason: meta.absent });
      return undefined;
    }
    api.get(runUrlFor(meta, range, widget, {}, runPath)).then(
      (r) => { if (on) setRun({ status: 'ok', payload: r.data }); },
      (e) => {
        if (on) {
          setRun({
            status: 'err',
            err: (typeof e.response?.data?.detail === 'string' && e.response.data.detail)
              || 'This figure did not load.',
          });
        }
      },
    );
    return () => { on = false; };
  }, [widget.metric, widget.group_by, range.from, range.to, runPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // A phone reads every card at a comfortable effective size; the real w/h
  // stay saved and come back on a bigger screen.
  const effW = narrow ? 8 : geom.w;
  const effH = narrow ? 3 : geom.h;
  const rows = run?.status === 'ok' ? (run.payload?.data || []) : null;
  const dataLen = rows == null
    ? null
    : widget.viz === 'trend' ? rows.filter((r) => r.period != null).length : rows.length;

  // The CURRENT data generation, readable by any queued measure. A measure
  // scheduled before the run landed (a pending rAF, a ResizeObserver
  // notification already in flight) used to close over the OLD dataLen and
  // apply its fit AFTER the new data had rendered — momentarily cutting a
  // freshly-drawn trend to one period. The ref is written during render, so
  // every measure — however stale its closure — re-reads the data generation
  // it is about to fit at the moment it runs, and a fit computed against one
  // generation can never overwrite the render of a newer one.
  const dataLenRef = useRef(dataLen);
  dataLenRef.current = dataLen;

  // The density pass: measure the body's REAL pixels and recount. The
  // identity check keys on viz+w+count+spark so the body rebuilds only when
  // its fit actually changed.
  const measure = useCallback(() => {
    // A stacked phone card grows with its content, so measuring it would
    // chase its own tail — a phone simply shows everything, top to bottom.
    const px = narrow ? 1e6 : (bodyRef.current?.clientHeight || 0);
    const f = fitCounts(widget.viz, px, dataLenRef.current ?? 0, effW, effH);
    const key = `${widget.viz}:${effW}:${f.n ?? 0}:${f.spark ? 1 : 0}`;
    setFit((prev) => (prev?.key === key ? prev : { ...f, key }));
  }, [widget.viz, effW, effH, narrow]);

  // One rAF after layout, for the inputs the fit arithmetic reads directly.
  // `dataLen` stays a dependency although the callback reads it through the
  // ref: the run landing must SCHEDULE a fresh measure (the ref alone changes
  // nothing), it just must not be the only thing a queued one can see.
  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, fitNonce, dataLen]);

  // The body's box is the ONE ground truth for density, and chrome this
  // component cannot enumerate moves it — entering edit mode, the .vgw-cols
  // chooser appearing, an alert form opening. Observing the box itself
  // re-fits on any of them; a dependency list of chrome would go stale the
  // day a new row of chrome lands.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // What the resize clamp needs to know about this card, kept in the board's
  // registry: the row count and the measured body element.
  useEffect(() => {
    onInfo(id, { dataLen, bodyEl: bodyRef.current });
    return () => onInfo(id, null);
  }, [id, dataLen, onInfo]);

  // First paint renders from the unmeasured (bodyPx 0) counts; the rAF pass
  // corrects them from real pixels before anyone can read the card.
  const effFit = fit || fitCounts(widget.viz, 0, dataLen ?? 0, effW, effH);

  const title = meta?.label || widget.metric;
  const availableCols = run?.status === 'ok' && widget.viz === 'table'
    ? tableColumns(run.payload?.data || [], null)
    : [];
  // The bell lives on KPI widgets only — a single figure IS a line you can
  // cross; a table is not. Absent metrics get no bell: the POST would 422.
  // And it lives only on the TENANT surface: the alert line it arms watches
  // /v1/analytics/run's numbers, so a board pointed at another door (Pulse)
  // has no alert to offer — a bell that 422s is worse than no bell.
  const canAlert = widget.viz === 'kpi' && meta && !meta.absent
    && runPath === DEFAULT_RUN_PATH;
  const handles = editable && !narrow;

  return (
    <section
      className={`anx-card vgw${lifting ? ' vgw--lift' : ''}${sizing ? ' vgw--sizing' : ''}`}
      style={style}
      ref={(el) => onNode(id, el)}
    >
      {handles && (
        <button
          type="button"
          className={carried ? 'vgw-grip vgw-grip--carrying' : 'vgw-grip'}
          aria-pressed={carried}
          aria-label={`Move ${title}. Enter picks it up, arrows move it, Enter drops it, Escape cancels.`}
          onPointerDown={(e) => onGripDown(e, id)}
          onKeyDown={(e) => onGripKey(e, id)}
          onBlur={() => onGripBlur(id)}
        >
          ⠿
        </button>
      )}
      <header className="anx-card__h">
        <Bi en={title} hi={meta?.hi || ''} />
        <span className="anx-card__r">
          {run?.status === 'ok' && (
            <Downloads meta={meta} range={range} label={title} widget={widget} runPath={runPath} />
          )}
          {canAlert && (
            <button
              type="button"
              className={alerting ? 'anx-bell anx-bell--on' : 'anx-bell'}
              title="Alert when this crosses a line"
              aria-label={`Alert when ${title} crosses a line`}
              aria-expanded={alerting}
              onClick={() => setAlerting((v) => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.4-1 4.6-1.7 5.4h12.4c-.7-.8-1.7-2-1.7-5.4A4.5 4.5 0 0 0 10 3Z" />
                <path d="M8.3 15.6a1.8 1.8 0 0 0 3.4 0" />
              </svg>
            </button>
          )}
          {editable && (
            <span className="vgw-tools">
              {narrow && (
                <>
                  <button type="button" className="vgw-tool" aria-label={`Move ${title} up`}
                    onClick={() => onStackMove(id, -1)}>↑</button>
                  <button type="button" className="vgw-tool" aria-label={`Move ${title} down`}
                    onClick={() => onStackMove(id, 1)}>↓</button>
                </>
              )}
              <button type="button" className="vgw-tool vgw-tool--x" title="Remove"
                aria-label={`Remove ${title}`} onClick={() => onRemove(id)}>×</button>
            </span>
          )}
        </span>
      </header>
      {alerting && canAlert && (
        <AlertForm meta={meta} onClose={() => setAlerting(false)} />
      )}
      {editable && widget.viz === 'table' && availableCols.length > 0 && (
        <div className="vgw-cols">
          {availableCols.map((c) => {
            const on = !widget.columns?.length || widget.columns.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={on ? 'vgw-col vgw-col--on' : 'vgw-col'}
                onClick={() => {
                  const base = widget.columns?.length ? widget.columns : availableCols;
                  const next = on ? base.filter((x) => x !== c) : [...base, c];
                  // an empty chooser means "all" — never save a table with
                  // zero columns
                  onChange({ ...widget, columns: next.length ? next : undefined });
                }}
              >
                {c.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
      )}
      <div className="anx-card__b" ref={bodyRef}>
        <WidgetBody viz={widget.viz} run={run} columns={widget.columns} geomW={effW} fit={effFit} />
      </div>
      {handles && (
        <button
          type="button"
          className="vgw-rs"
          aria-label={`Resize ${title}. Arrow keys change its size.`}
          onPointerDown={(e) => onSizeDown(e, id)}
          onKeyDown={(e) => onSizeKey(e, id)}
        />
      )}
    </section>
  );
}

/** The add-widget picker: the catalogue, cut to this surface's modules. The
 *  caller (AnalyticsTab) gives the new widget its default geometry at the
 *  bottom of the board — placeAtBottom — so “Add” lands where the eye is. */
export function AddWidget({ byKey, moduleFilter, onAdd }) {
  const [metric, setMetric] = useState('');
  const [viz, setViz] = useState('kpi');
  const options = useMemo(() => Object.values(byKey || {})
    .filter((m) => !m.absent)
    .filter((m) => !moduleFilter || m.module === moduleFilter)
    .sort((a, b) => a.key.localeCompare(b.key)), [byKey, moduleFilter]);
  if (!options.length) return null;
  return (
    <div className="vgw-add">
      <select
        className="k-select"
        value={metric}
        onChange={(e) => setMetric(e.target.value)}
        aria-label="Metric to add"
      >
        <option value="">Add a metric…</option>
        {options.map((m) => (
          <option key={m.key} value={m.key}>{m.label}</option>
        ))}
      </select>
      <select
        className="k-select"
        value={viz}
        onChange={(e) => setViz(e.target.value)}
        aria-label="How to draw it"
      >
        <option value="kpi">Number</option>
        <option value="trend">Trend</option>
        <option value="bars">Bars</option>
        <option value="table">Table</option>
      </select>
      <button
        type="button"
        className="k-btn k-btn--ghost k-btn--sm"
        disabled={!metric}
        onClick={() => { onAdd({ metric, viz }); setMetric(''); }}
      >
        Add
      </button>
    </div>
  );
}

const byYX = (a, b) => a.y - b.y || a.x - b.x;

/**
 * Engine geometry, merged back onto the widget rows. `geo` ids are list
 * indices into `norm`; each row keeps every non-geometry field it owns
 * (metric, group_by, columns) — geometry may never cross rows, or a drag
 * would silently re-aim a saved group_by at a different metric. A
 * `removedId` drops its row; the survivors keep their own ids, so the join
 * stays by identity, not by position.
 */
export function mergeLayout(norm, geo, removedId = null) {
  return norm.flatMap((w, i) => {
    if (i === removedId) return [];
    const g = geo.find((p) => p.id === i);
    return [g ? { ...w, x: g.x, y: g.y, w: g.w, h: g.h } : w];
  });
}

/**
 * `runPath` is the one seam for a board that reads a different API: the Aekam
 * Pulse console passes '/v1/pulse/run' and every widget fetch AND every
 * download chip goes through that door — same envelope, same params, same
 * format= exports. Defaulted, so every existing caller is unchanged.
 */
export default function ViewGrid({
  layout, byKey, range, editable, onLayoutChange, runPath = DEFAULT_RUN_PATH,
}) {
  const narrow = useMediaQuery('(max-width: 720px)');
  const norm = useMemo(() => normalizeLayout(layout), [layout]);
  const base = useMemo(
    () => norm.map((w, i) => ({ id: i, viz: w.viz, x: w.x, y: w.y, w: w.w, h: w.h })),
    [norm],
  );

  // `live` is the gesture's working geometry — reflow previews land here at
  // rAF cadence and are committed (packed, through onLayoutChange) only on
  // release, so the parent's draft state is not churned once per frame.
  const [live, setLive] = useState(null);
  const items = live || base;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [ghost, setGhost] = useState(null);
  const [drag, setDrag] = useState(null);      // { id, mode: 'move' | 'size' }
  const [carryId, setCarryId] = useState(null); // keyboard pickup
  const [msg, setMsg] = useState('');
  const [fitNonce, setFitNonce] = useState(0);
  const boardRef = useRef(null);
  const nodesRef = useRef({});
  const infoRef = useRef({});

  // A layout swap from outside (view switched, save landed) invalidates any
  // gesture in flight; same-value setters make this free on ordinary renders.
  useEffect(() => {
    setLive(null);
    setCarryId(null);
    setGhost(null);
  }, [base, editable]);

  // Cards re-measure when the viewport changes width — the column pixel size
  // moved, so every fill count is suspect.
  useEffect(() => {
    const onR = () => setFitNonce((n) => n + 1);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  const onNode = useCallback((id, el) => { nodesRef.current[id] = el; }, []);
  const onInfo = useCallback((id, info) => {
    if (info) infoRef.current[id] = info; else delete infoRef.current[id];
  }, []);

  // aria-live announces DOM CHANGES — a message identical to the last one is
  // invisible to it, so a repeated refusal would speak once and then go
  // silent. Every second consecutive repeat carries a zero-width suffix: a
  // change the region can see, without a character a reader would speak.
  const say = (text) => setMsg((prev) => (prev === text ? `${text}\u200B` : text));
  const titleOf = (id) => byKey?.[norm[id]?.metric]?.label || norm[id]?.metric || 'This widget';
  const get = (id) => itemsRef.current.find((p) => p.id === id);

  /** Column/row pixel pitch, measured off the board itself. */
  const metrics = () => {
    const width = boardRef.current?.getBoundingClientRect()?.width || 0;
    const cw = (width - GAP * (COLS - 1)) / COLS;
    return { px: cw + GAP, py: ROWH + GAP };
  };

  /** The grow cap for a card, from its measured body — 8 while loading. */
  const maxHOf = (id) => {
    const it = get(id);
    const info = infoRef.current[id] || {};
    return maxHFromMeasured(
      it.viz, info.dataLen, info.bodyEl?.clientHeight || 0, it.h, ROWH + GAP,
    );
  };

  /** Merge packed geometry back into the widget list and hand it up. */
  const commit = (geo) => {
    setLive(null);
    setGhost(null);
    onLayoutChange(mergeLayout(norm, geo));
  };

  // Removal unmounts the very control that was focused; left alone, focus
  // falls to <body> and a keyboard user starts over from the page top. The
  // ref carries the SURVIVOR's post-removal index (or 'board') across the
  // parent's re-render, and the effect hands focus over once the new layout
  // has actually mounted.
  const pendingFocus = useRef(null);
  useEffect(() => {
    if (pendingFocus.current == null) return;
    const t = pendingFocus.current;
    pendingFocus.current = null;
    const el = t === 'board' ? null : nodesRef.current[t];
    const ctl = el?.querySelector('button, [href], input, select, textarea');
    (ctl || boardRef.current)?.focus();
  }, [norm]);

  // ── pointer drag ──────────────────────────────────────────────────────────
  const onGripDown = (e, id) => {
    if (!editable || narrow) return;
    e.preventDefault();
    const grip = e.currentTarget;
    if (e.pointerId != null) grip.setPointerCapture?.(e.pointerId);
    const el = nodesRef.current[id];
    const m = metrics();
    const it = get(id);
    const st = { sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, base: itemsRef.current, raf: 0, pend: null };
    setDrag({ id, mode: 'move' });
    const apply = () => {
      st.raf = 0;
      if (!st.pend || !m.px) return;
      const cur = st.base.find((p) => p.id === id);
      const nx = Math.max(0, Math.min(COLS - cur.w, st.ox + Math.round(st.pend.dx / m.px)));
      const ny = Math.max(0, st.oy + Math.round(st.pend.dy / m.py));
      const cand = { ...cur, x: nx, y: ny };
      setLive(reflow(st.base, cand));
      setGhost({ x: nx, y: ny, w: cur.w, h: cur.h });
      // Transform-follow: the card tracks the pointer while its grid slot
      // (the ghost) snaps. Imperative on purpose — React never writes
      // `transform`, so this survives the per-frame re-render untouched.
      if (el) {
        el.style.transform = `translate(${st.pend.dx - (nx - st.ox) * m.px}px, ${st.pend.dy - (ny - st.oy) * m.py}px)`;
      }
    };
    const onMove = (ev) => {
      st.pend = { dx: ev.clientX - st.sx, dy: ev.clientY - st.sy };
      if (!st.raf) st.raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (st.raf) cancelAnimationFrame(st.raf);
      if (el) el.style.transform = '';
      setDrag(null);
      const packed = pack(itemsRef.current);
      const f = packed.find((p) => p.id === id);
      say(`${titleOf(id)} placed at column ${f.x + 1}, row ${f.y + 1}.`);
      commit(packed);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };

  // ── keyboard carry ────────────────────────────────────────────────────────
  const onGripKey = (e, id) => {
    if (!editable || narrow) return;
    const it = get(id);
    const carrying = carryId === id;
    if ((e.key === 'Enter' || e.key === ' ') && !carrying) {
      e.preventDefault();
      setCarryId(id);
      say(`Picked up ${titleOf(id)}. Arrows move it; Enter drops it; Escape cancels.`);
      return;
    }
    if (!carrying) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setCarryId(null);
      const packed = pack(itemsRef.current);
      const f = packed.find((p) => p.id === id);
      say(`Dropped ${titleOf(id)} at column ${f.x + 1}, row ${f.y + 1}.`);
      commit(packed);
      return;
    }
    if (e.key === 'Escape') {
      // Uncommitted moves live only in `live`; dropping it restores the
      // board as it was at pickup. stopPropagation so an enclosing sheet
      // does not also close on the same keystroke.
      e.preventDefault();
      e.stopPropagation();
      setCarryId(null);
      setLive(null);
      say(`Cancelled. ${titleOf(id)} is back where it was.`);
      return;
    }
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const cand = {
      ...it,
      x: Math.max(0, Math.min(COLS - it.w, it.x + dx)),
      y: Math.max(0, it.y + dy),
    };
    // A clamped arrow that moved nothing announces nothing — "at column 1,
    // row 1" repeated at the board edge is noise, not information.
    if (cand.x === it.x && cand.y === it.y) return;
    setLive(reflow(itemsRef.current, cand));
    say(`${titleOf(id)} at column ${cand.x + 1}, row ${cand.y + 1}.`);
  };

  // A carry is a mode only the grip's focus can end well. Focus leaving it —
  // Tab, a click elsewhere — abandons the gesture exactly like Escape: the
  // uncommitted preview must not survive as if it had been dropped. The
  // verdict is deferred one tick because the (y, x) DOM reorder can move the
  // grip's node mid-carry, and a moved node blurs transiently in real
  // browsers — the effect below hands focus straight back, and only a blur
  // that STAYED away cancels.
  const carryRef = useRef(null);
  useEffect(() => { carryRef.current = carryId; }, [carryId]);
  useEffect(() => {
    if (carryId == null) return;
    const grip = nodesRef.current[carryId]?.querySelector('.vgw-grip');
    if (grip && document.activeElement !== grip) grip.focus();
  }, [carryId, items]);
  const onGripBlur = (id) => {
    if (carryId !== id) return;
    setTimeout(() => {
      if (carryRef.current !== id) return;
      const grip = nodesRef.current[id]?.querySelector('.vgw-grip');
      if (grip && grip === document.activeElement) return;
      setCarryId(null);
      setLive(null);
      say(`Cancelled. ${titleOf(id)} is back where it was.`);
    }, 0);
  };

  // ── pointer resize ────────────────────────────────────────────────────────
  const onSizeDown = (e, id) => {
    if (!editable || narrow) return;
    e.preventDefault();
    const h = e.currentTarget;
    if (e.pointerId != null) h.setPointerCapture?.(e.pointerId);
    const m = metrics();
    const it = get(id);
    const st = { sx: e.clientX, sy: e.clientY, ow: it.w, oh: it.h, raf: 0, pend: null };
    setDrag({ id, mode: 'size' });
    const apply = () => {
      st.raf = 0;
      if (!st.pend || !m.px) return;
      const cur = get(id);
      const minW = MINW[cur.viz] ?? 3;
      const minH = MINH[cur.viz] ?? 2;
      const nw = Math.max(minW, Math.min(COLS - cur.x, st.ow + Math.round(st.pend.dx / m.px)));
      const nh = Math.max(minH, Math.min(maxHOf(id), st.oh + Math.round(st.pend.dy / m.py)));
      if (nw === cur.w && nh === cur.h) return;
      setLive(reflow(itemsRef.current, { ...cur, w: nw, h: nh }));
    };
    const onMove = (ev) => {
      st.pend = { dx: ev.clientX - st.sx, dy: ev.clientY - st.sy };
      if (!st.raf) st.raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      h.removeEventListener('pointermove', onMove);
      h.removeEventListener('pointerup', onUp);
      h.removeEventListener('pointercancel', onUp);
      if (st.raf) cancelAnimationFrame(st.raf);
      setDrag(null);
      const packed = pack(itemsRef.current);
      const f = packed.find((p) => p.id === id);
      say(`${titleOf(id)} is now ${f.w} columns by ${f.h} rows.`);
      commit(packed);
    };
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  };

  // ── keyboard resize — arrows act directly, and the refusal SPEAKS ────────
  const onSizeKey = (e, id) => {
    if (!editable || narrow) return;
    const dw = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const dh = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dw && !dh) return;
    e.preventDefault();
    const it = get(id);
    const cap = maxHOf(id);
    if (dh > 0 && it.h >= cap) {
      say(`${titleOf(id)} already shows everything it has — it does not grow taller.`);
      return;
    }
    const minW = MINW[it.viz] ?? 3;
    const minH = MINH[it.viz] ?? 2;
    const cand = {
      ...it,
      w: Math.max(minW, Math.min(COLS - it.x, it.w + dw)),
      h: Math.max(minH, Math.min(cap, it.h + dh)),
    };
    // A clamp that changed nothing commits nothing and says nothing — "is
    // now 12 columns" on a card already 12 wide reads as a change that never
    // happened. (The height cap above still SPEAKS: that refusal carries a
    // reason.)
    if (cand.w === it.w && cand.h === it.h) return;
    say(`${titleOf(id)} is now ${cand.w} columns by ${cand.h} rows.`);
    commit(pack(reflow(itemsRef.current, cand)));
  };

  // ── the phone's reorder ───────────────────────────────────────────────────
  const onStackMove = (id, dir) => {
    const next = stackMove(itemsRef.current, id, dir);
    if (next === itemsRef.current) return;
    say(`${titleOf(id)} moved ${dir < 0 ? 'up' : 'down'}.`);
    commit(next);
  };

  const onRemove = (id) => {
    const packed = pack(itemsRef.current.filter((p) => p.id !== id));
    // The focus heir: the next card in reading order, else the previous,
    // else the board itself. Survivor ids above the hole shift down by one
    // when the row leaves the list.
    const orderIds = itemsRef.current.slice().sort(byYX).map((p) => p.id);
    const at = orderIds.indexOf(id);
    const heir = orderIds[at + 1] ?? orderIds[at - 1];
    pendingFocus.current = heir == null ? 'board' : heir > id ? heir - 1 : heir;
    setLive(null);
    setGhost(null);
    say(`Removed ${titleOf(id)}.`);
    onLayoutChange(mergeLayout(norm, packed, id));
  };

  const onColsChange = (i, nw) => {
    onLayoutChange(norm.map((x, j) => (j === i ? nw : x)));
  };

  // DOM order IS reading order. The cards render sorted by their current
  // (y, x), so Tab and a screen reader walk the board the way the eye does —
  // grid placement alone would let a drag leave the two orders permanently
  // crossed. Keys are stable (metric + list index), so React MOVES the nodes
  // instead of remounting them and focus survives the reorder. The phone
  // stack needs no `order` property for the same reason: it reads top to
  // bottom in this order already.
  const ordered = useMemo(
    () => items.slice().sort(byYX).map((p) => p.id),
    [items],
  );

  return (
    <div
      className={`vg${editable && !narrow ? ' vg--edit' : ''}${drag ? ' vg--nomo' : ''}`}
      ref={boardRef}
      tabIndex={-1}
    >
      {ordered.map((i) => {
        const w = norm[i];
        const it = items.find((p) => p.id === i) || base[i];
        const style = narrow
          ? { gridColumn: '1 / -1', gridRow: 'auto', minHeight: '9rem' }
          : { gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}` };
        return (
          <Widget
            key={`${w.metric}-${i}`}
            id={i}
            widget={w}
            geom={it}
            byKey={byKey}
            range={range}
            editable={editable}
            narrow={narrow}
            style={style}
            lifting={drag?.mode === 'move' && drag.id === i}
            sizing={drag?.mode === 'size' && drag.id === i}
            carried={carryId === i}
            fitNonce={fitNonce}
            runPath={runPath}
            onGripDown={onGripDown}
            onGripKey={onGripKey}
            onGripBlur={onGripBlur}
            onSizeDown={onSizeDown}
            onSizeKey={onSizeKey}
            onChange={(nw) => onColsChange(i, nw)}
            onRemove={onRemove}
            onStackMove={onStackMove}
            onNode={onNode}
            onInfo={onInfo}
          />
        );
      })}
      {ghost && !narrow && (
        <div
          className="vgw-ghost"
          aria-hidden="true"
          style={{
            gridColumn: `${ghost.x + 1} / span ${ghost.w}`,
            gridRow: `${ghost.y + 1} / span ${ghost.h}`,
          }}
        />
      )}
      {!layout.length && (
        <p className="dnone vg-empty">This view is empty — add a metric below.</p>
      )}
      <div className="k-sr-only" aria-live="polite">{msg}</div>
    </div>
  );
}
