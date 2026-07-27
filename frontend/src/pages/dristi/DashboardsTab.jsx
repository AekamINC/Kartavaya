// Dristi · dashboards — the chart gallery, and the panel that configures it.
//
// This is the tab the reference is built around. `ScreensMore.jsx`'s
// `ScreenDristi` opens on `dashboards`, renders a gallery of chart cards beside
// a Configure panel, and its lede is the whole argument: "Configure the chart
// where it sits. No jumping to a separate query console." Selecting a card
// loads its query into the panel; changing source, dimension or measure re-runs
// it against `POST /v1/dristi/query` and redraws that card in place.
//
// The build had none of this. The tab was a text input, a Create button and a
// list — and the list was always empty, because `GET /dashboards` answers
// `{"data": [...]}` and the old code tested `Array.isArray(r.data)` against the
// envelope, which is never an array. Every saved dashboard an org had was
// invisible.
//
// The four starting cards are the reference's four, each pointed at a real
// query rather than the mock arrays it draws. "Collection ageing" has no
// endpoint behind it, so it is invoices grouped by payment status — the same
// question, asked of data that exists. Nothing here is seeded with fake numbers.
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Empty, Shimmer } from '../../components/editorial';
import { Panel, Bars, Funnel, Meters, MONEY, NUM, Bi, downloadCSV } from './_shared';

/** The reference's CHARTS, re-pointed at queries the server can actually run. */
const PRESETS = [
  { id: 'rev', t: 'Revenue by month', hi: 'मासिक राजस्व', kind: 'bar',
    source: 'invoices', group_by: 'invoice_date', measure: 'sum' },
  { id: 'pipe', t: 'Pipeline by stage', hi: 'चरण अनुसार', kind: 'funnel',
    source: 'deals', group_by: 'stage', measure: 'sum' },
  { id: 'age', t: 'Invoices by status', hi: 'प्राप्य आयु', kind: 'bar',
    source: 'invoices', group_by: 'payment_status', measure: 'sum' },
  { id: 'dept', t: 'Headcount by department', hi: 'विभाग', kind: 'row',
    source: 'employees', group_by: 'department', measure: 'count' },
];

const KINDS = [['bar', 'Bar'], ['funnel', 'Funnel'], ['row', 'Rows'], ['table', 'Table']];
const MEASURES = [['count', 'Count'], ['sum', 'Sum'], ['avg', 'Average']];

/** A measure of money gets rupees; a count never does. */
const fmtFor = (measure) => (measure === 'count' ? NUM : MONEY);

function Chart({ kind, rows, measure }) {
  const items = rows.map(r => ({ label: String(r.label ?? '—'), value: Number(r.value) || 0 }));
  const format = fmtFor(measure);
  if (kind === 'funnel') return <Funnel items={items} format={format} empty="Nothing to chart." />;
  if (kind === 'row' || kind === 'table') {
    const max = Math.max(...items.map(i => i.value), 0);
    return (
      <Meters
        items={items.map(i => ({
          label: i.label, pct: max > 0 ? (i.value / max) * 100 : 0, value: format(i.value),
        }))}
        empty="Nothing to chart."
      />
    );
  }
  return <Bars items={items} format={format} empty="Nothing to chart." />;
}

export default function DashboardsTab() {
  const { pushToast } = useToast();

  // ── Saved dashboards ──────────────────────────────────────────────────────
  const [boards, setBoards] = useState(null);
  const [boardsErr, setBoardsErr] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadBoards = useCallback(async () => {
    setBoardsErr('');
    try {
      const r = await api.get('/v1/dristi/dashboards');
      setBoards(Array.isArray(r.data) ? r.data : (r.data?.data || []));
    } catch (e) {
      setBoards(null);
      setBoardsErr(e.response?.data?.detail || 'Saved dashboards did not load.');
    }
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  const createBoard = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await api.post('/v1/dristi/dashboards', { name: name.trim(), widgets: [] });
      setName('');
      pushToast({ type: 'success', title: 'Dashboard created' });
      loadBoards();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not create the dashboard' });
    }
    setCreating(false);
  };

  const removeBoard = async (id) => {
    try {
      await api.delete(`/v1/dristi/dashboards/${id}`);
      pushToast({ type: 'success', title: 'Dashboard deleted' });
      loadBoards();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not delete' });
    }
  };

  // ── The gallery ───────────────────────────────────────────────────────────
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState('');
  const [cards, setCards] = useState(PRESETS.map(p => ({ ...p, rows: null, err: '', loading: true })));
  const [sel, setSel] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.get('/v1/dristi/widget-types')
      .then(r => setMeta(r.data))
      .catch(e => setMetaErr(e.response?.data?.detail || 'The query vocabulary did not load.'));
  }, []);

  /** Run one card's query. Each card owns its own error — one 403 on invoices
   *  must not blank the three cards that worked. */
  const runCard = useCallback(async (i, spec) => {
    setCards(cs => cs.map((c, n) => (n === i ? { ...c, loading: true, err: '' } : c)));
    try {
      const r = await api.post('/v1/dristi/query', {
        source: spec.source, group_by: spec.group_by, measure: spec.measure,
      });
      const rows = Array.isArray(r.data?.data) ? r.data.data : [];
      setCards(cs => cs.map((c, n) => (n === i ? { ...c, ...spec, rows, loading: false, err: '' } : c)));
    } catch (e) {
      setCards(cs => cs.map((c, n) => (n === i
        ? { ...c, ...spec, rows: null, loading: false,
            err: e.response?.status === 403
              ? 'You don’t have access to this source.'
              : (e.response?.data?.detail || 'This query failed.') }
        : c)));
    }
  }, []);

  // Only run a card once the vocabulary says its source is reachable — asking
  // for `invoices` when the caller has no Ganit grant produces a 403 the server
  // has already told us to expect.
  useEffect(() => {
    if (!meta) return;
    const ok = new Set(meta.sources || []);
    cards.forEach((c, i) => {
      if (!ok.has(c.source)) {
        setCards(cs => cs.map((x, n) => (n === i
          ? { ...x, loading: false, rows: null, err: 'You don’t have access to this source.' } : x)));
      } else if (c.rows === null && c.loading) {
        runCard(i, c);
      }
    });
    // `cards` is deliberately not a dependency: this seeds the initial run, and
    // including it would re-fire on every row that arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, runCard]);

  const current = cards[sel];
  const sourceMeta = meta?.source_meta || {};
  const columns = sourceMeta[current?.source]?.columns || [];

  const apply = (patch) => {
    const next = { ...current, ...patch };
    // Changing source invalidates the dimension — a column of one table is not
    // a column of another, and the server rejects it with a 400.
    if (patch.source && patch.source !== current.source) {
      next.group_by = (sourceMeta[patch.source]?.columns || [])[0] || '';
    }
    setCards(cs => cs.map((c, n) => (n === sel ? next : c)));
    if (patch.kind) return;          // a redraw, not a re-query
    runCard(sel, next);
  };

  const addToDashboard = async (boardId) => {
    const board = (boards || []).find(b => String(b.id) === String(boardId));
    if (!board) return;
    setAdding(true);
    try {
      const widgets = Array.isArray(board.widgets) ? board.widgets : [];
      await api.patch(`/v1/dristi/dashboards/${board.id}`, {
        widgets: [...widgets, {
          title: current.t, kind: current.kind, source: current.source,
          group_by: current.group_by, measure: current.measure,
        }],
      });
      pushToast({ type: 'success', title: `Added to ${board.name}` });
      loadBoards();
    } catch (e) {
      pushToast({ type: 'error', title: e.response?.data?.detail || 'Could not add the chart' });
    }
    setAdding(false);
  };

  return (
    <div className="dstack">
      <div className="dtwo">
        <div className="dgal">
          {cards.map((c, i) => (
            <button type="button" key={c.id} onClick={() => setSel(i)}
              aria-pressed={i === sel}
              className={`dchart${i === sel ? ' dchart--on' : ''}`}>
              <span className="dchart__h">
                <Bi en={c.t} hi={c.hi} />
                <span className="dcard__meta">{c.measure}</span>
              </span>
              {c.loading ? <Shimmer count={1} />
                : c.err ? <span className="dchart__err">{c.err}</span>
                  : <Chart kind={c.kind} rows={c.rows || []} measure={c.measure} />}
            </button>
          ))}
        </div>

        <Panel title="Configure" hi="विन्यास" right={<span className="dcard__meta">in place</span>}>
          {metaErr ? (
            <div className="note note--warn" role="status">
              <span><b>This did not load.</b> {metaErr}</span>
            </div>
          ) : !meta ? <Shimmer count={4} /> : (
            <div className="dform">
              <label className="fld">
                <span className="fld__l">Source</span>
                <select className="inp" value={current.source}
                  onChange={e => apply({ source: e.target.value })}>
                  {(meta.sources || []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {meta.withheld_count > 0 && (
                  <span className="fld__hint">
                    {meta.withheld_count} more source{meta.withheld_count === 1 ? '' : 's'} exist
                    that your role can’t read.
                  </span>
                )}
              </label>

              <label className="fld">
                <span className="fld__l">Dimension</span>
                <select className="inp" value={current.group_by}
                  onChange={e => apply({ group_by: e.target.value })}>
                  <option value="">— none —</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <div className="fld">
                <span className="fld__l">Measure</span>
                <div className="seg dseg">
                  {MEASURES.map(([k, l]) => (
                    <button type="button" key={k} className={`seg__b${current.measure === k ? ' on' : ''}`}
                      onClick={() => apply({ measure: k })}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="fld">
                <span className="fld__l">Chart type</span>
                <div className="seg dseg">
                  {KINDS.map(([k, l]) => (
                    <button type="button" key={k} className={`seg__b${current.kind === k ? ' on' : ''}`}
                      onClick={() => apply({ kind: k })}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="drule" />

              {/* Add-to-dashboard is only offered when there IS a dashboard to
                  add to. A disabled button with no explanation is the thing
                  this page had too much of already. */}
              {boards?.length ? (
                <label className="fld">
                  <span className="fld__l">Add to dashboard</span>
                  <select className="inp" defaultValue="" disabled={adding || !!current.err}
                    onChange={e => { if (e.target.value) { addToDashboard(e.target.value); e.target.value = ''; } }}>
                    <option value="">{adding ? 'Adding…' : 'Choose a dashboard…'}</option>
                    {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              ) : (
                <p className="dnote">Create a dashboard below to pin this chart to it.</p>
              )}

              <button type="button" className="k-btn k-btn--ghost"
                disabled={!current.rows?.length}
                onClick={() => downloadCSV(
                  `${current.source}-${current.group_by || 'total'}.csv`,
                  [current.group_by || 'label', current.measure],
                  (current.rows || []).map(r => [r.label, r.value]),
                )}>
                Export this chart
              </button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Saved dashboards" hi="पटल">
        <div className="dform__row dform__row--add">
          <label className="fld dgrow">
            <span className="fld__l">New dashboard</span>
            <input className="inp" value={name} placeholder="e.g. Monday review"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createBoard(); }} />
          </label>
          <button type="button" className="k-btn k-btn--primary"
            disabled={!name.trim() || creating} onClick={createBoard}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>

        {boardsErr ? (
          <div className="note note--warn" role="status">
            <span><b>This did not load.</b> {boardsErr}</span>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm dret"
              onClick={loadBoards}>Retry</button>
          </div>
        ) : !boards ? <Shimmer count={2} />
          : boards.length === 0 ? (
            <Empty title="No saved dashboards"
              sub="A dashboard is a set of charts you keep together — build one above and pin charts to it." />
          ) : (
            <ul className="dlist">
              {boards.map(b => {
                const widgets = Array.isArray(b.widgets) ? b.widgets : [];
                return (
                  <li key={b.id} className="dlist__i">
                    <span className="dlist__main dlist__main--static">
                      <span className="dlist__t">
                        {b.name}
                        {b.is_default && <span className="dtag">Default</span>}
                      </span>
                      <span className="dlist__m">
                        <span className="dmeta__i">
                          {NUM(widgets.length)} chart{widgets.length === 1 ? '' : 's'}
                        </span>
                        {widgets.slice(0, 3).map((w, i) => (
                          <span className="dmeta__i" key={i}>{w.title || w.source}</span>
                        ))}
                      </span>
                    </span>
                    <span className="dlist__act">
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm ddanger"
                        onClick={() => removeBoard(b.id)}>Delete</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
      </Panel>
    </div>
  );
}
