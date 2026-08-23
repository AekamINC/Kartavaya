// Dristi · pivot — a real cross-tab.
//
// The reference (`ScreensThin.jsx`, `DristiPivot`) draws invoiced value by
// client AND quarter, with a total per row, a total per column and a grand
// total, beside a Build panel carrying Rows, Columns and a Measure segment.
//
// The build drew rows only: one dimension, two columns, `label` and `value` —
// the same thing the chart cards already showed, under a tab called "pivot".
// The server now takes a second dimension (`group_by2`), so this is the cross
// -tab the reference specifies rather than a list.
//
// ── The note is not decoration ───────────────────────────────────────────────
// The reference puts an explicit note in the Build panel saying a pivot only
// aggregates rows you can already open. That is load-bearing on this product:
// `POST /query` checks the source module before it runs, so a total here is a
// total of what YOUR role can see, and two people can correctly read two
// different grand totals off the same screen. A pivot that does not say so is a
// pivot that lies quietly.
import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../lib/api';
import { Shimmer } from '../../components/editorial';
import RestrictedNote from '../../components/module/RestrictedNote';
import { Panel, FMT, NUM, downloadCSV } from './_shared';
import useModuleWrite from '../../hooks/useModuleWrite';
import DateInput from '../../components/ui/DateInput';

const MEASURES = [['count', 'Count'], ['sum', 'Sum'], ['avg', 'Average']];

/** A date column pivots best by month; anything else groups by its own values. */
const isDateish = (c) => /(_date|_at|joining)$/.test(String(c || ''));

export default function PivotTab() {
  // F32 — the module is read from the route, never named here.
  const { canWrite, reason: denial } = useModuleWrite({ label: 'change reports' });
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState('');
  const [restricted, setRestricted] = useState(false);

  const [source, setSource] = useState('');
  const [rowDim, setRowDim] = useState('');
  const [colDim, setColDim] = useState('');
  const [measure, setMeasure] = useState('count');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/v1/dristi/widget-types')
      .then(r => {
        setMeta(r.data);
        const first = (r.data.sources || [])[0] || '';
        setSource(first);
        const cols = r.data.source_meta?.[first]?.columns || [];
        // A sensible opening pair: the first non-date column against the first
        // date-ish one, which is the client x quarter shape the reference draws.
        setRowDim(cols.find(c => !isDateish(c)) || cols[0] || '');
        setColDim(cols.find(c => isDateish(c)) || '');
      })
      .catch(e => {
        if (e.response?.status === 403) setRestricted(true);
        else setMetaErr(e.response?.data?.detail || 'The query vocabulary did not load.');
      });
  }, []);

  const columns = meta?.source_meta?.[source]?.columns || [];

  const onSource = (s) => {
    setSource(s);
    const cols = meta?.source_meta?.[s]?.columns || [];
    setRowDim(cols.find(c => !isDateish(c)) || cols[0] || '');
    setColDim('');
    setResult(null);
  };

  async function run() {
    if (!rowDim || running) return;
    setRunning(true);
    setErr('');
    try {
      const r = await api.post('/v1/dristi/query', {
        source, group_by: rowDim, group_by2: colDim || '',
        measure, date_from: from, date_to: to,
      });
      setResult(r.data);
    } catch (e) {
      setResult(null);
      setErr(e.response?.data?.detail || 'The query failed.');
    }
    setRunning(false);
  }

  // Fold the server's flat [{label, col, value}] into a grid, with the three
  // kinds of total the reference draws.
  const grid = useMemo(() => {
    if (!result || !Array.isArray(result.data) || !result.group_by2) return null;
    const cols = [];
    const rows = new Map();
    for (const r of result.data) {
      const rk = r.label == null || r.label === '' ? '—' : String(r.label);
      const ck = r.col == null || r.col === '' ? '—' : String(r.col);
      if (!cols.includes(ck)) cols.push(ck);
      if (!rows.has(rk)) rows.set(rk, {});
      rows.get(rk)[ck] = Number(r.value) || 0;
    }
    cols.sort();
    const body = [...rows.entries()].map(([label, cells]) => ({
      label, cells, total: cols.reduce((a, c) => a + (cells[c] || 0), 0),
    }));
    body.sort((a, b) => b.total - a.total);
    return {
      cols, body,
      colTotals: cols.map(c => body.reduce((a, r) => a + (r.cells[c] || 0), 0)),
      grand: body.reduce((a, r) => a + r.total, 0),
    };
  }, [result]);

  const fmt = measure === 'count' ? NUM : FMT;

  if (restricted) return <RestrictedNote module="the analytics query builder" />;
  if (metaErr) {
    return (
      <div className="note note--warn" role="status">
        <span><b>This did not load.</b> {metaErr}</span>
      </div>
    );
  }
  if (!meta) return <Shimmer count={4} />;
  if (!(meta.sources || []).length) {
    return (
      <RestrictedNote
        module="any pivot source — every table the builder can read belongs to a module your role can’t open"
      />
    );
  }

  const exportGrid = () => {
    if (grid) {
      downloadCSV(`pivot-${source}.csv`,
        [rowDim, ...grid.cols, 'Total'],
        [...grid.body.map(r => [r.label, ...grid.cols.map(c => r.cells[c] ?? 0), r.total]),
          ['Total', ...grid.colTotals, grid.grand]]);
    } else if (Array.isArray(result?.data)) {
      downloadCSV(`pivot-${source}.csv`, [rowDim, measure],
        result.data.map(r => [r.label, r.value]));
    }
  };

  return (
    <div className="dtwo dtwo--wide">
      <Panel
        title={rowDim ? `${rowDim}${colDim ? ` × ${colDim}` : ''}` : 'Pivot'}
        hi="सारणी"
        right={<span className="dcard__meta">{measure}</span>}
      >
        {err ? (
          <div className="note note--warn" role="status">
            <span><b>This query did not run.</b> {err}</span>
          </div>
        ) : running ? <Shimmer count={4} />
          : !result ? (
            <p className="dnone">Choose rows, columns and a measure, then run the query.</p>
          ) : grid ? (
            /* NEITHER table below is opted into useColumnPrefs, and both
               reasons the rule names apply.
               The cross-tab's columns ARE the answer to the query: `grid.cols`
               is built from the DISTINCT VALUES the server returned for
               whichever field the user picked as `group_by2` a second ago.
               Change the column dimension and every column id changes with it,
               so there is no base list to declare and nothing a saved
               arrangement could be reconciled against — one key would resolve
               a maps-by-month layout against a status-by-owner result, drop
               every saved id and append every real one, which is the shipped
               order with a database write behind it.
               The flat table under it is the two-column key/value readout the
               rule excludes outright: a dimension and its measure, both named
               by the query and both load-bearing. Hiding either leaves a
               column of numbers with nothing to say what they count.
               Arranging is not what this screen is missing — the row and
               column dimensions above ARE its arrangement control, and the CSV
               export carries the result somewhere it can be rearranged
               freely. */
            grid.body.length === 0 ? <p className="dnone">No rows matched.</p> : (
              <div className="tbl__wrap">
                <table className="tbl dpiv">
                  <thead>
                    <tr>
                      <th>{rowDim}</th>
                      {grid.cols.map(c => <th key={c} className="tbl__num">{c}</th>)}
                      <th className="tbl__num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.body.map(r => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        {grid.cols.map(c => (
                          <td key={c}
                            className={r.cells[c] ? 'tbl__num' : 'tbl__num dzero'}>
                            {r.cells[c] ? fmt(r.cells[c]) : '—'}
                          </td>
                        ))}
                        <td className="tbl__num dpiv__rt">{fmt(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="mtbl__tot">
                      <td>Total</td>
                      {grid.colTotals.map((v, i) => (
                        <td key={i} className="tbl__num">{v ? fmt(v) : '—'}</td>
                      ))}
                      <td className="tbl__num dpiv__gt">{fmt(grid.grand)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          ) : Array.isArray(result.data) ? (
            result.data.length === 0 ? <p className="dnone">No rows matched.</p> : (
              <div className="tbl__wrap">
                <table className="tbl dpiv">
                  <thead>
                    <tr><th>{rowDim}</th><th className="tbl__num">{measure}</th></tr>
                  </thead>
                  <tbody>
                    {result.data.map((r, i) => (
                      <tr key={i}>
                        <td>{String(r.label ?? '—')}</td>
                        <td className="tbl__num">{fmt(r.value)}</td>
                      </tr>
                    ))}
                    <tr className="mtbl__tot">
                      <td>Total</td>
                      <td className="tbl__num dpiv__gt">
                        {fmt(result.data.reduce((a, r) => a + (Number(r.value) || 0), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          ) : (
            // No dimension at all — one number for the whole set.
            <div className="dbig">
              <span className="dbig__v">{fmt(result.data?.value)}</span>
              <span className="dbig__l">across {NUM(result.data?.count)} rows</span>
            </div>
          )}
      </Panel>

      <Panel title="Build" hi="रचना">
        <div className="dform">
          <label className="fld">
            <span className="fld__l">Source</span>
            <select className="inp" value={source} onChange={e => onSource(e.target.value)}>
              {(meta.sources || []).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="fld">
            <span className="fld__l">Rows</span>
            <select className="inp" value={rowDim} onChange={e => { setRowDim(e.target.value); setResult(null); }}>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="fld">
            <span className="fld__l">Columns</span>
            <select className="inp" value={colDim} onChange={e => { setColDim(e.target.value); setResult(null); }}>
              <option value="">— none, list only —</option>
              {columns.filter(c => c !== rowDim).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <div className="fld">
            <span className="fld__l">Measure</span>
            <div className="seg dseg">
              {MEASURES.map(([k, l]) => (
                <button type="button" key={k} className={`seg__b${measure === k ? ' on' : ''}`}
                  onClick={() => { setMeasure(k); setResult(null); }}>{l}</button>
              ))}
            </div>
          </div>

          <div className="dform__row">
            <label className="fld">
              <span className="fld__l">From</span>
              <DateInput className="inp" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="fld">
              <span className="fld__l">To</span>
              <DateInput className="inp" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>

          <button type="button" className="k-btn k-btn--primary"
            disabled={running || !rowDim || !canWrite} onClick={run} title={denial || undefined}>
            {running ? 'Running…' : 'Run query'}
          </button>

          <div className="drule" />

          <div className="note note--info">
            <span>
              A pivot only aggregates rows you can already open. Sources belonging to
              modules your role can’t read are not offered
              {meta.withheld_count > 0
                ? ` — ${meta.withheld_count} of them are hidden right now.`
                : '.'}
            </span>
          </div>

          <button type="button" className="k-btn k-btn--ghost"
            disabled={!result} onClick={exportGrid}>
            Export to CSV
          </button>
        </div>
      </Panel>
    </div>
  );
}
