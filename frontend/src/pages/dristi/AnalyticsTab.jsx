// Analytics · the universal metric surface (proposal 62, phase D4).
//
// ── One room, two doors ──────────────────────────────────────────────────────
//
// Ganit renders this as its own tab — the module the figures come from — and
// Dristi renders the SAME component from the analytics side. The component
// lives in dristi/ because everything it stands on (WindowBar, the window
// presets, the Bi label, the DataTable adapter) already lives here; GanitPage
// imports one default export and nothing else.
//
// Everything on this surface is driven by `/v1/analytics/catalogue`, not by a
// hardcoded belief about what exists. A metric the catalogue declares ABSENT
// renders as a stated absence with its reason in the tooltip — never a
// convincing zero (proposal 62 §10). A metric the catalogue does not list at
// all renders the same quiet way, because guessing an endpoint into existence
// is how a 404 becomes an error card on a page where nothing is wrong.
//
// ── The window ───────────────────────────────────────────────────────────────
//
// Flow metrics REQUIRE date_from/date_to on `/run` — that is D2's contract, no
// None-means-all default on the new endpoint. Standalone (in Ganit) this tab
// owns a WindowBar defaulting to the last 30 days; embedded in Dristi it reads
// the page-level window every other Dristi tab reads. Either way, "All time"
// is resolved HERE to explicit bounds (2000-01-01 → today) before it reaches
// the wire, because the presets are frontend sugar and the endpoint honestly
// refuses a flow question with no period. Stock metrics send no dates at all:
// the response is as-at-today and a date range above a headcount must not
// imply an authority it does not have.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../components/ui/toast';
import { Shimmer } from '../../components/editorial';
import { Secondary, useSecondary } from '../../components/Bilingual';
import { Bi, DataTable, Td, FMT, MONEY, NUM, PCT, useDristiWindow, resolvePreset } from './_shared';
import WindowBar from './WindowBar';
import ViewGrid, { AddWidget } from './ViewGrid';

/** Local date, never toISOString() — UTC moves an IST date back a day. */
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** `2026-07-01` (date_trunc('month', …)::date) or `2026-07` → `Jul`. */
function periodLabel(v) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(v ?? ''));
  if (!m) return String(v ?? '');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return MON[Number(m[2]) - 1] || String(v);
}

// The metrics this surface asks for. Labels and units come back from the
// server; what is fixed here is only which questions the page asks and the
// caption under each figure.
const KPI_DEFS = [
  { key: 'ganit.dso', label: 'DSO', hi: 'वसूली अवधि', sub: 'days sales outstanding' },
  { key: 'ganit.collection_rate', label: 'Collection rate', hi: 'वसूली दर', sub: 'collected against invoiced' },
  { key: 'ganit.outstanding', label: 'Outstanding', hi: 'बकाया', sub: 'unpaid and not cancelled' },
];
const WANT = [
  ...KPI_DEFS.map((k) => k.key),
  'ganit.invoiced', 'ganit.collected',
  'ganit.receivables_ageing', 'ganit.top_debtors',
];

/** The `/run` URL for one metric. Only a FLOW carries the window. */
function runUrl(meta, range, extra = {}) {
  const q = new URLSearchParams({ metric: meta.key });
  if (meta.grain === 'flow') {
    q.set('date_from', range.from);
    q.set('date_to', range.to);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return `/v1/analytics/run?${q.toString()}`;
}

/**
 * One figure out of a `/run` payload. A single row is the answer; a bucketed
 * series sums when the unit is additive (money, counts, hours) and takes the
 * most recent bucket when it is not — the mean of monthly rates is not the
 * period's rate, and their sum is nothing at all.
 */
function kpiOf(payload) {
  const list = payload?.data || [];
  if (!list.length) return null;
  if (list.length === 1) return Number(list[0].value);
  if (['inr', 'count', 'hours'].includes(payload.unit)) {
    return list.reduce((s, r) => s + (Number(r.value) || 0), 0);
  }
  // A bucketed RATE recomputes from the carried sums — Σcollected/Σinvoiced.
  // Review finding, 2026-08-17: the last bucket is the current PARTIAL month,
  // so a 30-day window spanning a month boundary showed August-to-date under
  // a caption claiming the whole window. The mean of the buckets is equally
  // wrong; the payload carries the numerator and denominator precisely so
  // this division is possible.
  const invoiced = list.reduce((s, r) => s + (Number(r.invoiced) || 0), 0);
  const collected = list.reduce((s, r) => s + (Number(r.collected) || 0), 0);
  if (invoiced > 0) return (collected / invoiced) * 100;
  return Number(list[list.length - 1].value);
}

function formatValue(v, unit) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  if (unit === 'inr') return MONEY(v);
  if (unit === 'pct') return PCT(v);
  if (unit === 'days') return `${NUM(Math.round(Number(v)))} days`;
  if (unit === 'hours') return `${NUM(Math.round(Number(v)))} hrs`;
  return NUM(v);
}

const MIME = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * The download affordance every card carries: CSV / XLSX / PDF off the SAME
 * `/run` URL with `format=` — the file runs the same SQL with the same window
 * as the screen. Fetched as a blob through `api`, exactly the way
 * ReportsTab.exportCSV does, because a bare `window.open` hits the wrong
 * origin and carries no credentials (the long note at the top of that file).
 */
function Downloads({ meta, range, label }) {
  const { pushToast } = useToast();
  const [busy, setBusy] = useState('');

  const pull = async (format) => {
    setBusy(format);
    try {
      const r = await api.get(runUrl(meta, range, { format }), { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: MIME[format] }));
      const a = document.createElement('a');
      a.href = url;
      // The same stem the server puts in Content-Disposition: metric plus the
      // exact window, or as-at-today for a stock. A file that does not say
      // which dates it covers is indistinguishable from one that covers all.
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

/** A glass card with a bilingual head — the anx surface's own panel. */
function AnxCard({ title, hi, right, children }) {
  return (
    <section className="anx-card">
      <header className="anx-card__h">
        <Bi en={title} hi={hi} />
        {right && <span className="anx-card__r">{right}</span>}
      </header>
      <div className="anx-card__b">{children}</div>
    </section>
  );
}

/** Loading / stated-absence / failure / data, kept apart per _shared's rule. */
function PanelState({ run, children }) {
  if (!run) return <Shimmer count={3} />;
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
  return children(run.payload);
}

/** One KPI tile, on the k-stat vocabulary the other modules use. */
function Kpi({ def, run, range }) {
  const { secondary, script } = useSecondary(def.hi);
  const lbl = (
    <div className="k-stat__lbl">
      <span>{def.label}</span>
      {secondary && <Secondary className="k-stat__hi" value={secondary} script={script} />}
    </div>
  );

  if (!run || run.status === 'absent' || run.status === 'missing') {
    // A stated absence, never a convincing zero — the reason travels in the
    // tooltip so the tile stays quiet and the curious get the whole story.
    return (
      <div className="k-stat k-stat--neutral" title={run?.reason}>
        {lbl}
        <div className="k-stat__val">—</div>
        <div className="k-stat__sub">Not yet measurable</div>
      </div>
    );
  }
  if (run.status === 'err') {
    return (
      <div className="k-stat k-stat--neutral" title={run.err}>
        {lbl}
        <div className="k-stat__val">—</div>
        <div className="k-stat__sub">did not load</div>
      </div>
    );
  }

  const v = kpiOf(run.payload);
  // Outstanding is money you are owed and have not been paid; the caption
  // says the same thing in words, so colour is never the only carrier.
  const warn = def.key === 'ganit.outstanding' && Number(v) > 0;
  return (
    <div className={warn ? 'k-stat k-stat--warn' : 'k-stat k-stat--neutral'}>
      {lbl}
      <div className="k-stat__val">{formatValue(v, run.payload.unit)}</div>
      <div className="k-stat__sub">{def.sub}</div>
      <Downloads meta={run.meta} range={range} label={def.label} />
    </div>
  );
}

/** Invoiced vs collected, month by month — CSS bars, no chart library. */
function DuoChart({ invoiced, collected }) {
  const a = new Map((invoiced?.data || []).map((r) => [String(r.period), Number(r.value) || 0]));
  const b = new Map((collected?.data || []).map((r) => [String(r.period), Number(r.value) || 0]));
  const months = [...new Set([...a.keys(), ...b.keys()])].sort();
  const max = Math.max(...months.map((p) => Math.max(a.get(p) || 0, b.get(p) || 0)), 0);
  if (!months.length || max <= 0) {
    return <p className="dnone">Nothing invoiced or collected in this period yet.</p>;
  }
  const pct = (v) => `${Math.max((Number(v) || 0) / max * 100, 0)}%`;
  return (
    <>
      <div className="anx-duo">
        {months.map((p) => (
          <div className="anx-duo__c" key={p}>
            <span className="anx-duo__t">
              <span
                className="anx-duo__b anx-duo__b--inv"
                style={{ '--h': pct(a.get(p) || 0) }}
                title={`Invoiced ${MONEY(a.get(p) || 0)}`}
              />
              <span
                className="anx-duo__b anx-duo__b--col"
                style={{ '--h': pct(b.get(p) || 0) }}
                title={`Collected ${MONEY(b.get(p) || 0)}`}
              />
            </span>
            <span className="anx-duo__x" title={p}>{periodLabel(p)}</span>
          </div>
        ))}
      </div>
      <div className="anx-leg">
        <span className="anx-leg__i"><i className="anx-leg__sw anx-leg__sw--inv" /> Invoiced</span>
        <span className="anx-leg__i"><i className="anx-leg__sw anx-leg__sw--col" /> Collected</span>
      </div>
    </>
  );
}

const AGE_LABEL = { '0-30': '0–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': 'Over 90 days' };
// Colour carries meaning: fresh is fine, old is a warning, very old is money
// at risk. Full literals, not interpolation — the orphan gate reads strings.
const AGE_CLS = {
  '0-30': 'anx-age__f anx-age__f--ok',
  '31-60': 'anx-age__f',
  '61-90': 'anx-age__f anx-age__f--warn',
  '90+': 'anx-age__f anx-age__f--danger',
};

function Ageing({ payload }) {
  const list = payload?.data || [];
  if (!list.length) return <p className="dnone">Nothing outstanding — every invoice is settled.</p>;
  const max = Math.max(...list.map((r) => Number(r.value) || 0), 0);
  return (
    <div className="anx-age">
      {list.map((r) => (
        <div className="anx-age__r" key={r.bucket}>
          <span className="anx-age__l">{AGE_LABEL[r.bucket] || r.bucket}</span>
          <span className="anx-age__t">
            <span
              className={AGE_CLS[r.bucket] || 'anx-age__f'}
              style={{ '--w': `${max > 0 ? (Number(r.value) || 0) / max * 100 : 0}%` }}
            />
          </span>
          <span className="anx-age__v">{MONEY(r.value)}</span>
          {r.invoices != null && (
            <span className="anx-age__n">
              {NUM(r.invoices)} {Number(r.invoices) === 1 ? 'invoice' : 'invoices'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Top debtors — a real table, on the row contract. The label column is the
 * client's NAME, resolved server-side; a row the server could not link says
 * 'Unlinked client' and says it honestly. No id ever reaches a cell.
 */
/** en-IN day label, pinned like the rest of this folder. */
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Debtors({ payload }) {
  const list = payload?.data || [];
  if (!list.length) return <p className="dnone">Nobody owes anything right now.</p>;
  return (
    <DataTable columns={['Client', { label: 'Outstanding', align: 'right' }, { label: 'Invoices', align: 'right' }, { label: 'Oldest due', align: 'right' }]}>
      {list.map((r, i) => {
        // `label` is the SQL's own output column (COALESCE(name, 'Unlinked
        // client')); the fallbacks stay for older payload shapes but the
        // primary key is the real one, and the test's canned rows use it.
        const name = r.label || r.client || r.name || 'Unlinked client';
        return (
          <tr key={`${name}-${i}`}>
            <td>{name}</td>
            <Td align="right" mono>{FMT(r.value)}</Td>
            <Td align="right" mono>{r.invoices != null ? NUM(r.invoices) : '—'}</Td>
            <Td align="right" mono>{r.oldest_due ? fmtDay(r.oldest_due) : '—'}</Td>
          </tr>
        );
      })}
    </DataTable>
  );
}

/**
 * The saved-view switcher (proposal 62 D3). Resolution is server-side —
 * personal > org > preset — and this bar only ever PRESENTS it: "Default" is
 * the built-in arrangement below, every other chip is a row from
 * /v1/analytics/views or a preset the entitlement cut left standing.
 */
function ViewsBar({ views, active, onPick, edit, onEdit, onCancel, onSave,
  name, setName, asDefault, setAsDefault, saving, canSave }) {
  if (!views && !edit) return null;
  if (edit) {
    return (
      <div className="vb vb--edit">
        <input
          className="k-input vb__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this view"
          aria-label="View name"
        />
        <label className="vb__def">
          <input
            type="checkbox"
            checked={asDefault}
            onChange={(e) => setAsDefault(e.target.checked)}
          />
          Open this by default
        </label>
        <span className="vb__grow" />
        <button type="button" className="k-btn k-btn--ghost k-btn--sm"
          onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="k-btn k-btn--primary k-btn--sm"
          onClick={onSave} disabled={saving || !canSave}>
          {saving ? 'Saving…' : 'Save view'}
        </button>
      </div>
    );
  }
  const chip = (key, label, picked, onClick, title) => (
    <button
      key={key}
      type="button"
      className={picked ? 'vb__chip vb__chip--on' : 'vb__chip'}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );
  return (
    <div className="vb">
      {chip('__default', 'Default', !active, () => onPick(null))}
      {(views?.personal || []).map((v) => chip(
        v.id, v.name, active?.id === v.id,
        () => onPick({ source: 'personal', ...v }),
      ))}
      {(views?.org || []).map((v) => chip(
        v.id, `${v.name} · org`, active?.id === v.id,
        () => onPick({ source: 'org', ...v }),
      ))}
      {(views?.presets || []).map((pr) => chip(
        `preset:${pr.key}`, `${pr.label} · preset`,
        active?.presetKey === pr.key,
        () => onPick({ source: 'preset', presetKey: pr.key, name: pr.label, layout: pr.layout }),
        pr.why,
      ))}
      <span className="vb__grow" />
      <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={onEdit}>
        Customise
      </button>
    </div>
  );
}

function AnalyticsSurface({ win, bar, module = 'ganit' }) {
  const [nonce, setNonce] = useState(0);
  const [cat, setCat] = useState({ loading: true, err: '', byKey: null, absent: [] });
  const [runs, setRuns] = useState(null);
  const { pushToast } = useToast();

  // ── Saved views (D3) ──────────────────────────────────────────────────────
  const [views, setViews] = useState(null);
  const [active, setActive] = useState(null);     // null = the built-in arrangement
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState([]);
  const [viewName, setViewName] = useState('');
  const [asDefault, setAsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let on = true;
    api.get(`/v1/analytics/views?module=${module}`).then(
      (r) => {
        if (!on) return;
        setViews(r.data);
        // Only a SAVED default replaces the built-in arrangement unasked;
        // presets are offered in the bar, never imposed over a richer page.
        const res = r.data?.resolved;
        if (res?.source === 'personal' || res?.source === 'org') {
          setActive({ source: res.source, id: res.id, name: res.name, layout: res.layout });
        }
      },
      () => { /* the bar simply does not render; the tab still works */ },
    );
    return () => { on = false; };
  }, [module, nonce]);

  const beginEdit = () => {
    setDraft((active?.layout || []).map((w) => ({ ...w })));
    setViewName(active?.source === 'personal' ? active.name : '');
    setAsDefault(false);
    setEdit(true);
  };
  const saveView = async () => {
    setSaving(true);
    try {
      let saved;
      if (active?.source === 'personal' && active.id) {
        const r = await api.patch(`/v1/analytics/views/${active.id}`, {
          name: viewName || active.name,
          layout: draft,
          ...(asDefault ? { is_default: true } : {}),
        });
        saved = r.data;
      } else {
        const r = await api.post('/v1/analytics/views', {
          module,
          name: viewName || 'My view',
          layout: draft,
          scope: 'personal',
          is_default: asDefault,
        });
        saved = r.data;
      }
      setActive({ source: 'personal', id: saved.id, name: saved.name, layout: saved.layout });
      setEdit(false);
      setNonce((n) => n + 1);
      // type/title is the toast's ACTUAL contract (toast.jsx) — the earlier
      // tone/text shape rendered these as empty info cards.
      pushToast({ type: 'success', title: `Saved “${saved.name}”.` });
    } catch (e) {
      pushToast({
        type: 'error',
        title: (typeof e.response?.data?.detail === 'string' && e.response.data.detail)
          || 'The view did not save.',
      });
    } finally {
      setSaving(false);
    }
  };

  // "All time" resolved to explicit bounds before the wire — see the header.
  const range = useMemo(
    () => (win.from && win.to
      ? { from: win.from, to: win.to }
      : { from: '2000-01-01', to: iso(new Date()) }),
    [win.from, win.to],
  );

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const r = await api.get('/v1/analytics/catalogue');
        const metrics = r.data?.metrics || [];
        const byKey = {};
        for (const m of metrics) byKey[m.key] = m;
        if (on) {
          setCat({
            loading: false, err: '', byKey,
            // EVERY declared-absent ganit metric, not just the ones this page
            // asks for: the module's owner should see what the product cannot
            // yet answer, and why, rather than a gap that reads as an oversight.
            absent: metrics.filter((m) => m.module === 'ganit' && m.absent),
          });
        }
      } catch (e) {
        if (on) {
          setCat({
            loading: false,
            err: e.response?.status === 403
              ? 'You do not have access to analytics.'
              : (e.response?.data?.detail || 'Retry, or check your connection.'),
            byKey: null,
            absent: [],
          });
        }
      }
    })();
    return () => { on = false; };
  }, [nonce]);

  useEffect(() => {
    if (!cat.byKey) return undefined;
    let on = true;
    (async () => {
      setRuns(null);
      const out = {};
      const jobs = [];
      for (const key of WANT) {
        const meta = cat.byKey[key];
        if (!meta) {
          out[key] = { status: 'missing', reason: 'Not in the analytics catalogue for this organisation.' };
          continue;
        }
        if (meta.absent) {
          out[key] = { status: 'absent', reason: meta.absent, meta };
          continue;
        }
        // A window longer than ~13 months in monthly buckets renders hundreds
        // of unreadable one-flex columns (Dristi's "all time" resolves to
        // 2000-01-01). The bucket widens with the window; the numbers do not
        // change, only the cut.
        const days = (new Date(range.to) - new Date(range.from)) / 86400000;
        const bucket = days > 1200 ? 'year' : days > 400 ? 'quarter' : 'month';
        const extra = key === 'ganit.invoiced' || key === 'ganit.collected' ? { bucket } : {};
        jobs.push(api.get(runUrl(meta, range, extra)).then(
          (r) => { out[key] = { status: 'ok', payload: r.data, meta }; },
          (e) => {
            out[key] = {
              status: 'err',
              err: (typeof e.response?.data?.detail === 'string' && e.response.data.detail)
                || 'This figure did not load.',
              meta,
            };
          },
        ));
      }
      await Promise.all(jobs);
      if (on) setRuns(out);
    })();
    return () => { on = false; };
  }, [cat.byKey, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const ganitListed = cat.byKey ? Object.values(cat.byKey).some((m) => m.module === 'ganit') : false;

  const gridLayout = edit ? draft : active?.layout;

  return (
    <div className="anx">
      {bar}
      <ViewsBar
        views={views}
        active={active}
        onPick={(v) => { setActive(v); setEdit(false); }}
        edit={edit}
        onEdit={beginEdit}
        onCancel={() => setEdit(false)}
        onSave={saveView}
        name={viewName}
        setName={setViewName}
        asDefault={asDefault}
        setAsDefault={setAsDefault}
        saving={saving}
        canSave={draft.length > 0}
      />

      {cat.loading ? (
        <Shimmer count={6} />
      ) : cat.err ? (
        <div className="note note--warn" role="status">
          <span><b>Analytics did not load.</b> {cat.err}</span>
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--sm dret"
            onClick={() => setNonce((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      ) : !ganitListed ? (
        // The catalogue's withholding IS the entitlement answer: no ganit
        // metrics listed means Finance is not this caller's to read. Quiet,
        // never red — nothing is broken.
        <p className="dnone">Finance analytics is not available on this account.</p>
      ) : (edit || active) ? (
        <>
          <ViewGrid
            layout={gridLayout || []}
            byKey={cat.byKey}
            range={range}
            editable={edit}
            onLayoutChange={setDraft}
          />
          {edit && (
            <AddWidget
              byKey={cat.byKey}
              moduleFilter={module === 'dristi' ? null : module}
              onAdd={(w) => setDraft((d) => [...d, w])}
            />
          )}
        </>
      ) : (
        <>
          {!runs ? <Shimmer count={3} /> : (
            <div className="k-stats dstats dstats--fin">
              {KPI_DEFS.map((def) => (
                <Kpi key={def.key} def={def} run={runs[def.key]} range={range} />
              ))}
            </div>
          )}

          <AnxCard
            title="Invoiced vs collected"
            hi="बीजक व वसूली"
            right={runs?.['ganit.invoiced']?.status === 'ok' && (
              <>
                <Downloads meta={runs['ganit.invoiced'].meta} range={range} label="Invoiced" />
                {runs['ganit.collected']?.status === 'ok' && (
                  <Downloads meta={runs['ganit.collected'].meta} range={range} label="Collected" />
                )}
              </>
            )}
          >
            <PanelState run={runs?.['ganit.invoiced']}>
              {(invoiced) => (
                <PanelState run={runs?.['ganit.collected']}>
                  {(collected) => <DuoChart invoiced={invoiced} collected={collected} />}
                </PanelState>
              )}
            </PanelState>
          </AnxCard>

          <div className="anx-two">
            <AnxCard
              title="Receivables ageing"
              hi="प्राप्य आयु"
              right={runs?.['ganit.receivables_ageing']?.status === 'ok' && (
                <Downloads meta={runs['ganit.receivables_ageing'].meta} range={range} label="Receivables ageing" />
              )}
            >
              <PanelState run={runs?.['ganit.receivables_ageing']}>
                {(payload) => <Ageing payload={payload} />}
              </PanelState>
            </AnxCard>

            <AnxCard
              title="Top debtors"
              hi="शीर्ष देनदार"
              right={runs?.['ganit.top_debtors']?.status === 'ok' && (
                <Downloads meta={runs['ganit.top_debtors'].meta} range={range} label="Top debtors" />
              )}
            >
              <PanelState run={runs?.['ganit.top_debtors']}>
                {(payload) => <Debtors payload={payload} />}
              </PanelState>
            </AnxCard>
          </div>

          {cat.absent.length > 0 && (
            <div>
              <p className="dnote">
                Declared but not yet measurable — the schema cannot answer these honestly yet.
                Hover a row for the reason.
              </p>
              <ul className="anx-absent">
                {cat.absent.map((m) => (
                  <li key={m.key} className="anx-absent__r" title={m.absent}>
                    <span className="anx-absent__l">{m.label}</span>
                    <span className="anx-absent__s">Not yet measurable</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Ganit's door: the tab owns its window, defaulting to the last 30 days. */
export default function AnalyticsTab() {
  const [win, setWin] = useState(() => resolvePreset('30d'));
  return <AnalyticsSurface win={win} bar={<WindowBar value={win} onChange={setWin} />} />;
}

/**
 * Dristi's door into the same room: the page-level window every other Dristi
 * tab reads applies here too, so switching tabs keeps the period. No second
 * WindowBar — two period bars on one page is a question with two answers.
 */
export function AnalyticsTabEmbedded() {
  const win = useDristiWindow();
  return <AnalyticsSurface win={win} bar={null} module="dristi" />;
}
