/**
 * AdminPulsePage — the pulse of Kartavaya (proposal 68).
 *
 * Aekam-only analytics about the PRODUCT itself: who uses Kartavaya, how much,
 * and where the energy is — org-level aggregates and org NAMES only, never a
 * member's name, an email or a uuid. The server (`routers/pulse.py`) gates the
 * whole surface on the console roles this page's nav row mirrors, and writes
 * an audit row per catalog fetch and per export; this page adds nothing to
 * that enforcement — it only avoids offering what would 403.
 *
 * The board IS the tenant board. `ViewGrid` renders Pulse metas unchanged
 * because `/v1/pulse/run` answers in the tenant `/v1/analytics/run` envelope,
 * key for key — the one seam is `runPath`, which points every widget fetch and
 * every download chip at the Pulse door. Drag, resize, the measured-density
 * arithmetic, keyboard carry and the aria-live narration all ride along; this
 * file owns only what is Pulse's: the catalog, the personal board
 * (GET/PUT /v1/pulse/view), and the whole-board report download.
 *
 * A declared-absent metric (pulse.api_health: "measured in Railway and Sentry
 * — linked, not queried") renders as the board's stated-absence card, never an
 * error — the catalog carries the reason and ViewGrid already knows the shape.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Shimmer } from '../../components/editorial';
import { Secondary } from '../../components/Bilingual';
import { ErrorState, errorKind } from '../../components/ui';
import ViewGrid, { AddWidget } from '../dristi/ViewGrid';
import { COLS, DEFW, DEFH, normalizeLayout, placeAtBottom } from '../dristi/boardEngine';
import WindowBar from '../dristi/WindowBar';
import { resolvePreset, explicitBounds } from '../dristi/_shared';
import '../../styles/admin.css';

/** The Pulse door — every widget /run and every download chip goes through it. */
const RUN_PATH = '/v1/pulse/run';

const MIME = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Complete the geometry of a layout the server states without positions.
 *
 * The code default (`services/pulse.DEFAULT_LAYOUT`) says `{metric, viz, w}`
 * with w in BOARD columns — w:3 means a quarter-width KPI, four to a row.
 * Handing that straight to `normalizeLayout` would misread it: the engine
 * treats a positionless w of 1–3 as the LEGACY 3-column scale and multiplies
 * by 4, turning every quarter-width KPI into a full-width one. So geometry is
 * completed HERE, row-major with a simple cursor, before the board ever sees
 * the list. A layout that already carries full geometry (every personal save
 * does — the board commits x/y/w/h) passes through untouched.
 */
export function hydratePulseLayout(layout) {
  const list = Array.isArray(layout) ? layout : [];
  if (list.every((w) => w?.x != null && w?.y != null && w?.h != null)) return list;
  let x = 0;
  let y = 0;
  let rowH = 0;
  return list.map((w0) => {
    const w = Math.max(1, Math.min(COLS, Number(w0?.w) || DEFW[w0?.viz] || 4));
    const h = Math.max(1, Number(w0?.h) || DEFH[w0?.viz] || 2);
    if (x + w > COLS) { x = 0; y += rowH; rowH = 0; }
    const out = { ...w0, x, y, w, h };
    x += w;
    rowH = Math.max(rowH, h);
    return out;
  });
}

export default function AdminPulsePage() {
  const { pushToast } = useToast();
  const [win, setWin] = useState(() => resolvePreset('30d'));
  // "All time" resolved to the server's own 5-year cap — /run and /report
  // honestly refuse a flow question with no period (the D2 contract Pulse
  // mirrors), so explicit bounds always reach the wire.
  const range = useMemo(() => explicitBounds(win), [win.from, win.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const [nonce, setNonce] = useState(0);
  const [cat, setCat] = useState({ loading: true, err: null, byKey: null, absent: [] });
  const [view, setView] = useState(null);          // { source, layout }
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState('');

  useEffect(() => {
    let on = true;
    setCat({ loading: true, err: null, byKey: null, absent: [] });
    // Catalog and the personal board together: neither renders without the
    // other, and a 403 on either is the same refusal (one gate, one surface).
    Promise.all([api.get('/v1/pulse/catalog'), api.get('/v1/pulse/view')]).then(
      ([c, v]) => {
        if (!on) return;
        const metrics = c.data?.metrics || [];
        const byKey = {};
        for (const m of metrics) byKey[m.key] = m;
        setCat({
          loading: false, err: null, byKey,
          absent: metrics.filter((m) => m.absent),
        });
        setView({
          source: v.data?.source || 'default',
          layout: hydratePulseLayout(v.data?.layout || []),
        });
        setEdit(false);
      },
      (e) => { if (on) setCat({ loading: false, err: e, byKey: null, absent: [] }); },
    );
    return () => { on = false; };
  }, [nonce]);

  const beginEdit = () => {
    setDraft(normalizeLayout(view?.layout || []));
    setEdit(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put('/v1/pulse/view', { layout: draft });
      setView({
        source: 'personal',
        layout: hydratePulseLayout(r.data?.layout || draft),
      });
      setEdit(false);
      pushToast({ type: 'success', title: 'Saved — this is your Pulse board now.' });
    } catch (e) {
      pushToast({
        type: 'error',
        title: (typeof e.response?.data?.detail === 'string' && e.response.data.detail)
          || 'The board did not save.',
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * The whole board as one document — GET /v1/pulse/report, the server
   * renders every widget of the SAVED arrangement for the window on screen.
   * Blob through `api` (a bare window.open hits the wrong origin and carries
   * no credentials — the Downloads discipline), filename stem stating the
   * exact window, because a file that does not say which dates it covers is
   * indistinguishable from one that covers all.
   */
  const pullReport = async (format) => {
    setPulling(format);
    try {
      const q = new URLSearchParams({ date_from: range.from, date_to: range.to, format });
      const r = await api.get(`/v1/pulse/report?${q.toString()}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: MIME[format] }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `kartavaya-pulse_${range.from}_${range.to}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // A blob-typed error body is a Blob, not JSON — read it back before it
      // becomes "[object Blob]" in the toast.
      let detail = 'The report did not download.';
      if (e.response?.data instanceof Blob) {
        try { detail = JSON.parse(await e.response.data.text()).detail || detail; } catch { /* keep default */ }
      } else if (typeof e.response?.data?.detail === 'string') {
        detail = e.response.data.detail;
      }
      pushToast({ type: 'error', title: typeof detail === 'string' ? detail : 'The report did not download.' });
    }
    setPulling('');
  };

  const pageHead = (
    <header className="apg__head">
      <div className="apg__titles">
        <h1 className="apg__t">
          Pulse
          <Secondary className="apg__hi" value="नाड़ी" />
        </h1>
        <p className="apg__lede">
          Who is using Kartavaya, and how much — org-level aggregates and org
          names only, never a person&rsquo;s name or a personal row. Every view
          and every export here writes an audit row.
        </p>
      </div>
    </header>
  );

  if (cat.loading) {
    return (
      <div className="apg">
        {pageHead}
        <Shimmer count={6} />
      </div>
    );
  }

  if (cat.err) {
    // The house error state, never a blank: a 403 renders `denied` with the
    // grant named, anything else its own kind, all with a retry.
    return (
      <div className="apg">
        {pageHead}
        <ErrorState
          kind={errorKind(cat.err)}
          grant="a platform console role"
          detail={typeof cat.err.response?.data?.detail === 'string'
            ? cat.err.response.data.detail : undefined}
          onRetry={() => setNonce((n) => n + 1)}
        />
      </div>
    );
  }

  const layout = edit ? draft : (view?.layout || []);

  return (
    <div className="apg">
      {pageHead}

      <div className="anx">
        <WindowBar value={win} onChange={setWin} />

        <div className="vb">
          <span className="vb__def">
            {view?.source === 'personal'
              ? 'Your arrangement.'
              : 'The standard board — customise to make it yours.'}
          </span>
          <span className="vb__grow" />
          <span className="vb__def">Download report</span>
          <span className="anx-dl" role="group" aria-label="Download the whole board as a report">
            {/* aria-disabled, never `disabled`: the chip the user just
                activated disables ITSELF mid-pull, and a disabled element
                drops keyboard focus to <body> (the CustomizeTabs edge-button
                rule). components.css's [aria-disabled="true"] kills pointer
                events; the onClick guard covers the keyboard, which
                pointer-events cannot. */}
            {['csv', 'xlsx', 'pdf'].map((f) => (
              <button
                type="button"
                key={f}
                className="chip anx-dl__b"
                aria-disabled={pulling !== '' ? 'true' : undefined}
                aria-label={`Download the Pulse report as ${f.toUpperCase()}`}
                onClick={() => { if (pulling === '') pullReport(f); }}
              >
                {pulling === f ? '…' : f.toUpperCase()}
              </button>
            ))}
          </span>
          {edit ? (
            <>
              <button type="button" className="k-btn k-btn--ghost k-btn--sm"
                onClick={() => setEdit(false)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="k-btn k-btn--primary k-btn--sm"
                onClick={save} disabled={saving || !draft.length}>
                {saving ? 'Saving…' : 'Save board'}
              </button>
            </>
          ) : (
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={beginEdit}>
              Customise
            </button>
          )}
        </div>

        <ViewGrid
          layout={layout}
          byKey={cat.byKey}
          range={range}
          editable={edit}
          onLayoutChange={setDraft}
          runPath={RUN_PATH}
        />

        {edit && (
          <AddWidget
            byKey={cat.byKey}
            moduleFilter="pulse"
            onAdd={(w) => setDraft((d) => {
              const n = normalizeLayout(d);
              return [...n, placeAtBottom(n, w)];
            })}
          />
        )}

        {cat.absent.length > 0 && (
          <div>
            <p className="dnote">
              Declared but not measured here — the reason travels in the row.
            </p>
            <ul className="anx-absent">
              {cat.absent.map((m) => (
                <li key={m.key} className="anx-absent__r" title={m.absent}>
                  <span className="anx-absent__l">{m.label}</span>
                  <span className="anx-absent__s">{m.absent}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
