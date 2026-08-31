// Constants and helpers shared across the Vetana tabs.
//
// ── Why this file exists at all ──────────────────────────────────────────────
//
// `VetanaPage.jsx` was 857 lines with all six tabs inside it. 13-module-pages.md
// splits a module into a route file plus a directory of tab components BEFORE any
// styling is applied, because a restyle of a single-file module touches every
// tab, every table and every form at once and the diff is unreviewable.
//
// ── The rule this module is built around ─────────────────────────────────────
//
// A FAILED FETCH MUST NEVER RENDER AS AN EMPTY STATE.
//
// On payroll that distinction is the whole product. "No payroll runs" and "the
// request for your payroll runs failed" look identical if you write
// `catch {}` and then branch on `list.length === 0` — and they mean opposite
// things. One says nobody is owed anything; the other says you do not know what
// anybody is owed. Every tab here goes through `useResource`, which keeps the
// three states apart and cannot collapse them, and every original
// `catch {}` in this module has been removed.
import React, { useState, useEffect, useCallback } from 'react';
import { Announced } from '../../components/ui/Skeleton';
import { api } from '../../lib/api';
import { inr } from '../../lib/inr';

/** Indian digit grouping, one implementation — `lib/inr.js` exists to end the
 *  per-page `₹${n.toLocaleString('en-IN')}`. Re-exported so the tabs import one
 *  name and the module reads consistently. */
export const FMT = inr;

export const RUN_COLORS = {
  draft: 'var(--on-surface-3)',
  processed: 'var(--st-in-progress)',
  approved: 'var(--st-in-review)',
  disbursed: 'var(--ok)',
};
export const PS_COLORS = {
  generated: 'var(--on-surface-3)',
  approved: 'var(--st-in-review)',
  disbursed: 'var(--ok)',
};
export const LOAN_COLORS = {
  active: 'var(--st-in-progress)',
  closed: 'var(--ok)',
  written_off: 'var(--on-surface-3)',
};

/**
 * The sentence to show for a failed request.
 *
 * 403 is answered with the server's own words wherever it wrote them. Vetana's
 * router writes real explanations — "Approving or releasing payroll needs an
 * explicit approver grant on Vetana… whoever defines what people are paid does
 * not release the money" — and replacing that with "Failed" throws away the only
 * text that tells someone what to do next.
 */
export function errText(err, fallback = 'Retry, or check your connection.') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const status = err?.response?.status;
  if (status === 403) return 'You do not have access to this part of payroll.';
  if (status === 404) return 'That record no longer exists.';
  if (status >= 500) return 'The server failed on this request. Nothing was changed.';
  if (err?.response == null) return 'No response from the server — check your connection.';
  return fallback;
}

/**
 * A GET with its three outcomes kept distinct: `loading`, `error`, `data`.
 *
 * `data` stays null while `error` is set, so a caller cannot accidentally render
 * a populated-looking empty state over a failure. `reload` re-runs it.
 */
export function useResource(path, deps = []) {
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const run = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.get(path);
      setState({ loading: false, error: '', data: r.data });
    } catch (err) {
      setState({ loading: false, error: errText(err), data: null });
    }
    // `path` is the only input; deps let a caller re-run on a filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { ...state, reload: run, setData: d => setState(s => ({ ...s, data: d })) };
}

/** The list form of `useResource` — unwraps `{ data: [...] }` and never invents
 *  an empty array out of a failure. */
export function useList(path, deps = []) {
  const r = useResource(path, deps);
  return { ...r, items: r.error ? null : (r.data?.data || []) };
}

/**
 * The failure block. Says it failed, says why, and offers the way out.
 *
 * `role="status"` rather than `alert`: it is announced without stealing focus
 * from whatever the person was doing. Deliberately NOT the empty state — no
 * illustration, no "get started" call to action.
 */
export function ErrorNote({ what, error, onRetry }) {
  return (
    <div className="note note--warn vt-err" role="status">
      <b>{what} did not load.</b> {error}
      {onRetry && (
        <button type="button" className="k-btn k-btn--ghost vt-err__go" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Loading / error / empty in one place, so no tab can forget one of them.
 *
 * The order is load, then fail, then empty — `empty` is only ever reached when
 * the request actually succeeded and actually returned nothing.
 */
export function Resource({ state, what, skeleton, empty, onRetry, children }) {
  if (state.loading) return skeleton ?? <Shim count={4} />;
  if (state.error) return <ErrorNote what={what} error={state.error} onRetry={onRetry ?? state.reload} />;
  const rows = state.items ?? state.data;
  if (empty && (rows == null || (Array.isArray(rows) && rows.length === 0))) return empty;
  return children;
}

/** Local re-export so tabs need one import for the skeleton. */
export function Shim({ count = 4, label = 'Loading…' }) {
  // ANNOUNCES ITSELF. Suite 20.06 (2026-08-31) found 7 of 10 sampled screens
  // with `role=status 0, aria-busy 0` while loading, and `vetana#payslips` was
  // the sharp one: a Shim IS drawn, so the screen looks busy to an eye and is
  // silent to a screen reader.
  //
  // `Announced` is a no-op when an explicit `SkeletonRegion` already wraps this,
  // so the screens that were written correctly do not start saying it twice.
  return (
    <Announced label={label}>
      <div className="k-shimmer" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => <div key={i} className="k-shimmer__tile" />)}
      </div>
    </Announced>
  );
}

/** `2026-07` → `July 2026`. Payroll months are stored as `YYYY-MM` strings. */
export function monthName(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) return month || '—';
  const [y, m] = month.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
}

/** The current month as `YYYY-MM`, which is what every filter here speaks. */
export function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `2026-08-15` → `15 Aug 2026`, for a due date that has to be read at a glance. */
export function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
}

/** The first day of the month, and the last — the window every attendance and
 *  statutory query in this module is bounded by. */
export function monthRange(month) {
  const [y, m] = (month || thisMonth()).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export const money = v => FMT(v);

/** The employee label a payroll row shows, whichever shape Manav returns. */
export function empName(e) {
  return e.name || e.full_name
    || [e.first_name, e.last_name].filter(Boolean).join(' ')
    || e.employee_code || 'Unnamed';
}
