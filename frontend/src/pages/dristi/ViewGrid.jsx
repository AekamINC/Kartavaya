// ViewGrid · the saved-view renderer and its builder (proposal 62, phase D3).
//
// A view is a LIST of widgets — {metric, viz, w, group_by?, columns?} — laid
// on a fluid three-column grid. Order is position: no free drag, no pixel
// coordinates; a widget spans 1–3 columns and the grid flows, which is the
// same discipline every k-* page keeps (fluid, left-aligned, no fixed
// centering) applied to dashboards.
//
// The renderer trusts NOTHING in the row. Layouts are validated on save, but
// a metric can be retired after a view named it — an unknown key renders as a
// stated absence, exactly like a declared-absent metric, never an error card.
//
// Each widget runs its own /run request. That is deliberate: one slow metric
// must not hold the other eleven, and the per-widget failure state is the
// same PanelState vocabulary the bespoke tab uses.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { Shimmer } from '../../components/editorial';
import { Bi, Bars, DataTable, Td, FMT, MONEY, NUM, PCT } from './_shared';

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

/** One-series CSS trend — anx-duo's vocabulary with a single bar per period. */
function Trend({ payload }) {
  const rows = (payload?.data || []).filter((r) => r.period != null);
  const max = Math.max(...rows.map((r) => Number(r.value) || 0), 0);
  if (!rows.length || max <= 0) return <p className="dnone">Nothing in this period yet.</p>;
  return (
    <div className="anx-duo">
      {rows.map((r) => (
        <div className="anx-duo__c" key={r.period}>
          <span className="anx-duo__t">
            <span
              className="anx-duo__b anx-duo__b--inv"
              style={{ '--h': `${Math.max(((Number(r.value) || 0) / max) * 100, 0)}%` }}
              title={fmtByUnit(r.value, payload.unit)}
            />
          </span>
          <span className="anx-duo__x" title={r.period}>{String(r.period)}</span>
        </div>
      ))}
    </div>
  );
}

function WidgetBody({ meta, viz, run, columns }) {
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
  if (viz === 'kpi') {
    const { v, sub } = kpiValue(payload);
    return (
      <div className="vgw-kpi">
        <div className="vgw-kpi__v">{fmtByUnit(v, payload.unit)}</div>
        {sub && <div className="vgw-kpi__s">{sub}</div>}
      </div>
    );
  }
  if (viz === 'trend') return <Trend payload={payload} />;
  if (viz === 'bars') {
    const rows = payload?.data || [];
    const lk = rows.length ? labelKey(rows[0]) : null;
    return (
      <Bars
        items={rows.map((r) => ({
          label: lk ? String(r[lk]) : '—',
          value: Number(r.value) || 0,
        }))}
        format={(v) => fmtByUnit(v, payload.unit)}
      />
    );
  }
  // table
  const rows = payload?.data || [];
  if (!rows.length) return <p className="dnone">Nothing in this period yet.</p>;
  const cols = tableColumns(rows, columns);
  return (
    <DataTable columns={cols.map((c) => ({
      label: c.replace(/_/g, ' '),
      align: typeof rows[0][c] === 'number' ? 'right' : undefined,
    }))}
    >
      {rows.map((r, i) => (
        <tr key={i}>
          {cols.map((c) => (
            typeof rows[0][c] === 'number'
              ? <Td key={c} align="right" mono>{FMT(r[c])}</Td>
              : <Td key={c}>{String(r[c] ?? '—')}</Td>
          ))}
        </tr>
      ))}
    </DataTable>
  );
}

function runUrlFor(meta, range, widget) {
  const q = new URLSearchParams({ metric: meta.key });
  if (meta.grain === 'flow') {
    q.set('date_from', range.from);
    q.set('date_to', range.to);
    const days = (new Date(range.to) - new Date(range.from)) / 86400000;
    q.set('bucket', days > 1200 ? 'year' : days > 400 ? 'quarter' : 'month');
  }
  if (widget.group_by) q.set('group_by', widget.group_by);
  return `/v1/analytics/run?${q.toString()}`;
}

function Widget({ widget, byKey, range, editable, onChange, onRemove, onMove }) {
  const meta = byKey?.[widget.metric];
  const [run, setRun] = useState(null);

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
    api.get(runUrlFor(meta, range, widget)).then(
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
  }, [widget.metric, widget.group_by, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = meta?.label || widget.metric;
  const availableCols = run?.status === 'ok' && widget.viz === 'table'
    ? tableColumns(run.payload?.data || [], null)
    : [];

  return (
    <section className={`anx-card vgw vgw--${widget.w}`}>
      <header className="anx-card__h">
        <Bi en={title} hi={meta?.hi || ''} />
        {editable && (
          <span className="vgw-tools">
            <button type="button" className="vgw-tool" title="Move earlier"
              onClick={() => onMove(-1)}>←</button>
            <button type="button" className="vgw-tool" title="Move later"
              onClick={() => onMove(1)}>→</button>
            <button
              type="button" className="vgw-tool"
              title={`Width: ${widget.w} of 3 columns — click to resize`}
              onClick={() => onChange({ ...widget, w: (widget.w % 3) + 1 })}
            >
              ◱ {widget.w}
            </button>
            <button type="button" className="vgw-tool vgw-tool--x" title="Remove"
              onClick={onRemove}>×</button>
          </span>
        )}
      </header>
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
      <div className="anx-card__b">
        <WidgetBody meta={meta} viz={widget.viz} run={run} columns={widget.columns} />
      </div>
    </section>
  );
}

/** The add-widget picker: the catalogue, cut to this surface's modules. */
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
        onClick={() => { onAdd({ metric, viz, w: viz === 'table' ? 3 : 1 }); setMetric(''); }}
      >
        Add
      </button>
    </div>
  );
}

export default function ViewGrid({ layout, byKey, range, editable, onLayoutChange }) {
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= layout.length) return;
    const next = layout.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onLayoutChange(next);
  };
  return (
    <div className="vg">
      {layout.map((w, i) => (
        <Widget
          key={`${w.metric}-${i}`}
          widget={w}
          byKey={byKey}
          range={range}
          editable={editable}
          onChange={(nw) => onLayoutChange(layout.map((x, j) => (j === i ? nw : x)))}
          onRemove={() => onLayoutChange(layout.filter((_, j) => j !== i))}
          onMove={(d) => move(i, d)}
        />
      ))}
      {!layout.length && (
        <p className="dnone vg-empty">This view is empty — add a metric below.</p>
      )}
    </div>
  );
}
