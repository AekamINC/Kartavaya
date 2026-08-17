// Dristi · दृष्टि — shared helpers for the analytics tabs.
//
// ── Why a fetch hook and not eight copies of useEffect ────────────────────────
//
// Every tab in the single-file version did this:
//
//     useEffect(() => { api.get(path).then(r => setData(r.data))
//                          .catch(e => pushToast({ type: 'error', … })); }, []);
//     if (!data) return <Shimmer />;
//
// which has the defect this module exists to avoid. `data` stays null on
// failure, so the failed fetch renders the LOADING state forever, and the only
// notice is a toast that has already faded by the time anyone looks. Two tabs
// were worse — ReportsTab and DashboardsTab did `.catch(() => setReports([]))`,
// turning a 500 into "No scheduled reports", an empty state that invites you to
// create a second copy of the thing that already exists.
//
// A failed fetch must never render as an empty state. `useDristi` separates the
// three outcomes so a tab cannot accidentally collapse them, and `<TabState>`
// renders them so a tab cannot forget one.
//
// ── Restricted is not an error ───────────────────────────────────────────────
//
// Dristi reads from every other module, so 403 is an ORDINARY answer here, not
// a fault: the analytics grant is not a grant to the accounting ledger or the
// salary register. It gets `RestrictedNote` — neutral, names who can grant it —
// never the red warning that tells a user something is broken when nothing is.
import React, { useState, useEffect, useCallback, useContext, createContext, useMemo } from 'react';
import { api } from '../../lib/api';
import { Shimmer } from '../../components/editorial';
import { Table, TableHead, TableBody, HeadCell, Cell } from '../../components/ui/Table';
import RestrictedNote from '../../components/module/RestrictedNote';
import { useSecondary, Secondary } from '../../components/Bilingual';
import { inr, inrShort, grouped } from '../../lib/inr';

/** Indian digit grouping, one implementation — see lib/inr.js. */
export const FMT = inr;
/** Lakh/crore. What a bar or a tile gets: `₹26,40,000` over a 60px-wide column
 *  collides with its neighbour, and the exact rupee was never the point of a
 *  bar chart. Tables keep FMT, because there the exact figure IS the point. */
export const MONEY = inrShort;
export const NUM = grouped;
export const PCT = v => `${Number(v || 0).toFixed(1)}%`;

/** `2026-02` → `Feb`. Axis labels arrive raw from GROUP BY and do not fit. */
export function monthLabel(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  if (!m) return String(v ?? '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-IN', { month: 'short' });
}

/** The module a 403 on this path is really about, for the restricted note. */
const MODULE_OF = {
  '/v1/dristi/revenue': { module: 'accounting (Ganit)', hi: 'गणित' },
  '/v1/dristi/pipeline': { module: 'the CRM (Graha)', hi: 'ग्रह' },
  '/v1/dristi/hr': { module: 'HR records (Manav)', hi: 'मानव' },
  '/v1/dristi/sales': { module: 'the order book (Vikray)', hi: 'विक्रय' },
};

// ── The window every read is taken through (proposal 62, phase D1) ──────────
//
// One range lives on the page and every tab reads it, so switching from Revenue
// to Pipeline keeps the period the user chose instead of silently resetting it.
//
// The default is `all` — no parameters on the wire — because that is precisely
// what these endpoints did before D1. A 30-day default would have been friendlier
// and would also have changed what every existing screen means without asking.
const WindowCtx = createContext({ from: '', to: '', preset: 'all' });

export const useDristiWindow = () => useContext(WindowCtx);
export const DristiWindowProvider = WindowCtx.Provider;

/** `?date_from=&date_to=` for a path, or '' when the window is All time. */
export function windowQuery({ from, to }, sep = '?') {
  if (!from && !to) return '';
  const q = new URLSearchParams();
  if (from) q.set('date_from', from);
  if (to) q.set('date_to', to);
  return sep + q.toString();
}

const iso = (d) => {
  // Built by hand, not through toISOString(): that is UTC, and it moves an IST
  // date back a day for every time before 05:30. Same rule as DateInput.
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The presets, resolved against today. India's financial year starts 1 April. */
export function resolvePreset(preset, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth();
  const mk = (a, b) => ({ from: iso(a), to: iso(b), preset });
  switch (preset) {
    case 'all': return { from: '', to: '', preset };
    case '30d': return mk(new Date(y, m, today.getDate() - 29), today);
    case '90d': return mk(new Date(y, m, today.getDate() - 89), today);
    case 'mtd': return mk(new Date(y, m, 1), today);
    case 'lastmonth': return mk(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'quarter': return mk(new Date(y, Math.floor(m / 3) * 3, 1), today);
    case 'fytd': return mk(new Date(m >= 3 ? y : y - 1, 3, 1), today);
    case '12m': return mk(new Date(y - 1, m, today.getDate()), today);
    default: return { from: '', to: '', preset };
  }
}

export const WINDOW_PRESETS = [
  ['all', 'All time'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'],
  ['mtd', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'],
  ['fytd', 'FY to date'], ['12m', 'Last 12 months'], ['custom', 'Custom…'],
];

/**
 * The three outcomes of a Dristi read, kept apart.
 *
 * `restricted` is 403 and is not a failure. `err` is everything else and always
 * carries a retry. `data` is only ever set from a response that arrived.
 */
export function useDristi(path, { enabled = true, windowed = true } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [err, setErr] = useState('');
  const [restricted, setRestricted] = useState(null);
  const win = useDristiWindow();

  // The query string, not the object, is the dependency: two renders that
  // resolve to the same dates must not refetch. `windowed: false` is for the
  // reads that have no period at all — the saved-dashboard list, the pivot
  // vocabulary — which would only be confused by one.
  const qs = windowed ? windowQuery(win, path.includes('?') ? '&' : '?') : '';

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setErr('');
    setRestricted(null);
    try {
      const r = await api.get(path + qs);
      setData(r.data);
    } catch (e) {
      // Never leave stale figures on screen under a fresh error — a number with
      // no provenance is worse than no number.
      setData(null);
      if (e.response?.status === 403) {
        setRestricted(MODULE_OF[path] || { module: 'this data' });
      } else {
        setErr(e.response?.data?.detail || 'Retry, or check your connection.');
      }
    }
    setLoading(false);
  }, [path, qs, enabled]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, err, restricted, reload: load };
}

/**
 * Renders whichever of the four states applies, so no tab has to remember all
 * of them. `children` is a function of the loaded data — it cannot run before
 * the data exists, which is the point.
 */
export function TabState({ state, count = 4, children }) {
  const { data, loading, err, restricted, reload } = state;
  if (loading) return <Shimmer count={count} />;
  if (restricted) return <RestrictedNote module={restricted.module} />;
  if (err) {
    return (
      <div className="note note--warn" role="status">
        <span>
          <b>This did not load.</b> {err}
        </span>
        <button type="button" className="k-btn k-btn--ghost k-btn--sm dret" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;
  return children(data);
}

/**
 * A block the server declined to include, named.
 *
 * `/overview` and `/sales` return a `withheld` list rather than omitting the
 * key, precisely so this can be drawn. A withheld payroll total rendered as ₹0
 * is indistinguishable from a company that paid nobody all year.
 */
export function Withheld({ what, module }) {
  return (
    <div className="dwith" role="note">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor"
        strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="9" width="12" height="8" rx="1.5" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
      </svg>
      <span>{what} is not shown — it reads {module}, which you don’t have access to.</span>
    </div>
  );
}

/**
 * Section sub-head used inside a chart card, both scripts.
 *
 * ONE LABEL SHAPE. `.dbi__hi` is not one of the six class names
 * `[data-language="en"]` knows about, so every chart heading in Dristi rendered
 * its Devanagari under English too. `hi` now accepts a bare string as before, a
 * registry key, or `{hi, gu}` — the decision is made by the label layer rather
 * than by a stylesheet that has to have heard of this class.
 */
export function Bi({ en, hi }) {
  const { secondary, script } = useSecondary(hi);
  return (
    <span className="dbi">
      <b className="dbi__en">{en}</b>
      {secondary && <Secondary className="dbi__hi" value={secondary} script={script} />}
    </span>
  );
}

// ── Chart forms ──────────────────────────────────────────────────────────────
//
// Three, because the reference draws three (`ScreensMore.jsx`, `ScreenDristi`'s
// CHARTS): `bar`, `funnel` and `row`. They are CSS, not a charting library —
// each is a handful of divs whose one data-driven dimension arrives as a custom
// property, so they inherit the theme, the density setting and the type scale
// like everything else on the page. A canvas would inherit none of it.
//
// Every one of them states its own empty case. A bar chart of nothing is an
// empty box that reads as a rendering fault.

const pctOf = (v, max) => (max > 0 ? Math.max((Number(v) || 0) / max * 100, 0) : 0);

/**
 * Vertical bars. `items` is [{ label, value, sub? }]. The last bar is the
 * accent — the reference highlights the most recent period, which is the one
 * you are being asked to react to.
 */
export function Bars({ items, format = NUM, empty = 'Nothing in this period yet.' }) {
  if (!items?.length) return <p className="dnone">{empty}</p>;
  const max = Math.max(...items.map(i => Number(i.value) || 0), 0);
  if (max <= 0) return <p className="dnone">{empty}</p>;
  return (
    <div className="dbars">
      {items.map((i, n) => (
        <div className="dbars__c" key={i.label}>
          <span className="dbars__v">{format(i.value)}</span>
          {/* The bar sizes against this track, NOT against the column. Sized
              against the column, the tallest bar took the column's whole height
              and pushed the axis label out of the card — the 100% bar's label
              was clipped on every chart. */}
          <span className="dbars__t">
            <span
              className={`dbars__b${n === items.length - 1 ? ' dbars__b--now' : ''}`}
              style={{ '--h': `${pctOf(i.value, max)}%` }}
            />
          </span>
          {/* Raw GROUP BY labels arrive as `2026-02` and truncate to "2026…" in
              a 60px column, which identifies nothing. */}
          <span className="dbars__x" title={i.label}>{monthLabel(i.label)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Funnel — stages in order, width proportional to the first. Stage order is
 * meaning here, so this never sorts by value: a funnel that reorders itself
 * when Negotiation outgrows Proposal is no longer a funnel.
 */
export function Funnel({ items, format = FMT, empty = 'No deals in the pipeline.' }) {
  if (!items?.length) return <p className="dnone">{empty}</p>;
  const max = Math.max(...items.map(i => Number(i.value) || 0), 0);
  return (
    <div className="dfun">
      {items.map(i => (
        <div className="dfun__r" key={i.label}>
          <span className="dfun__l">{i.label}</span>
          <span className="dfun__t">
            <span className="dfun__f" style={{ '--w': `${pctOf(i.value, max)}%` }} />
          </span>
          <span className="dfun__v">{format(i.value)}</span>
          {i.sub != null && <span className="dfun__n">{i.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Horizontal meters — the reference's `row` kind, used for per-person figures.
 * `pct` is the fill; `value` is what gets printed, so a meter can show a rupee
 * figure against a percentage-of-target fill.
 */
export function Meters({ items, empty = 'Nothing to compare yet.' }) {
  if (!items?.length) return <p className="dnone">{empty}</p>;
  return (
    <div className="dmet">
      {items.map(i => (
        <div className="dmet__r" key={i.label}>
          <span className="dmet__n" title={i.label}>{i.label}</span>
          <span className="dmet__t">
            <span
              className={`dmet__f${i.tone ? ` dmet__f--${i.tone}` : ''}`}
              style={{ '--w': `${Math.min(Math.max(Number(i.pct) || 0, 0), 100)}%` }}
            />
          </span>
          <span className="dmet__v">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A titled card. The reference's `Card`, on the classes this build already has. */
export function Panel({ title, hi, right, wide, half, children }) {
  return (
    <section className={`dcard${wide ? ' dcard--wide' : ''}${half ? ' dcard--half' : ''}`}>
      <header className="dcard__h">
        <Bi en={title} hi={hi} />
        {right && <span className="dcard__r">{right}</span>}
      </header>
      <div className="dcard__b">{children}</div>
    </section>
  );
}

/* ── The table ────────────────────────────────────────────────────────────
 *
 * Same two functions, same reasoning and same prop shape as
 * `pages/prachar/_shared.jsx` — read the long note there for why the adapter
 * exists rather than an edit to `editorial/ModuleUI.jsx`. In short: `DataTable`
 * and `Td` keep the names the tabs already import and render the unified
 * `.tbl__wrap > table.tbl` instead of `.k-modtable`, so the four Dristi tabs
 * changed by one import line each and none of their ten call sites moved.
 *
 * Re-declared rather than imported from Prachar for the reason `CONTACT_TYPES`
 * gives above: a module that imports another module's page code acquires that
 * module's render-time dependencies with it. Thirty lines are cheaper than that
 * coupling.
 *
 * The one Dristi-specific consequence: `.dcard__b` — the body of `Panel` below
 * — now resets the frame, because the card IS the frame and a second box inside
 * it is the mistake `components.css` §10 exists to name. The reference agrees:
 * `ScreensThin.jsx:21` puts the pivot in `<Card flush>`, frameless.
 */
export function DataTable({ columns, children }) {
  return (
    <Table>
      <TableHead>
        {columns.map((c, i) => {
          const col = c && typeof c === 'object' ? c : { label: c };
          const key = col.label || `col-${i}`;
          return (
            <HeadCell key={key} num={col.align === 'right'} className={col.className || ''}>
              {col.label}
            </HeadCell>
          );
        })}
      </TableHead>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

export function Td({ align, mono, bold, className, children, ...rest }) {
  const cls = [bold ? 'tbl__b' : '', className || ''].filter(Boolean).join(' ');
  return (
    <Cell num={align === 'right' || Boolean(mono)} className={cls} {...rest}>
      {children}
    </Cell>
  );
}

/** Turn rows of objects into a CSV file the browser downloads. */
export function downloadCSV(filename, header, rows) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
