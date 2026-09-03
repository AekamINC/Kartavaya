// Constants and helpers shared across the manav tabs.
//
// Every colour is a token reference. The literals here were the full retired
// set — #0082c6 (retired brand blue, 00 §9), #8b5cf6, #ef4444, #f59e0b — plus
// four greys (#9ca3af, #6b7280, #6E7B91, #78716c) that are one token in this
// system. None of them followed the theme, so every badge on this module was
// the light-mode colour in dark mode.
//
// Where a map needs more hues than the status ramp carries, --tertiary
// (terracotta) and --secondary (olive) are the two remaining container-backed
// families; both flip by theme and both clear AA in each.
//
// ── The rule this module is built around ─────────────────────────────────────
//
// A FAILED FETCH MUST NEVER RENDER AS AN EMPTY STATE.
//
// This is HR. "No employees yet", "No attendance records" and "No leave
// requests" are statements about the business. If the request failed, all three
// are false — and `catch { toast() }` followed by `list.length === 0` prints
// them anyway, because a caught error leaves the list at its initial `[]`.
// Every tab in this directory did exactly that: eleven fetches, eleven empty
// states reachable by failure. The Vetana agent found the identical shape on
// payroll and named it; it was here too.
//
// `useList` below keeps loading, error and data apart and cannot collapse them:
// `items` is null whenever `error` is set, so a call site cannot accidentally
// render "nobody is absent" over a 500.
import React, { useState, useEffect, useCallback } from 'react';
import { Shim } from '../../components/ui/Skeleton';
import { api, rows as unwrapRows } from '../../lib/api';
import Tag from '../../components/ui/Tag';
import { PRIORITY_COLORS as TASK_PRIORITY_COLORS } from '../../lib/statusColors';
import { inr } from '../../lib/inr';

export const EMP_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant'];
export const EMP_STATUSES = ['active', 'on_notice', 'terminated', 'resigned', 'absconding'];
export const ATT_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekend'];
export const STATUS_COLORS = {
  active: 'var(--ok)', on_notice: 'var(--warn)', terminated: 'var(--danger)',
  resigned: 'var(--on-surface-3)', absconding: 'var(--danger)',
};
// Seven states, so this is the one map that exhausts the status ramp and
// reaches for --tertiary and --st-in-review to stay separable.
export const ATT_COLORS = {
  present: 'var(--ok)', absent: 'var(--danger)', half_day: 'var(--warn)',
  late: 'var(--tertiary)', on_leave: 'var(--st-in-progress)',
  holiday: 'var(--st-in-review)', weekend: 'var(--on-surface-3)',
};
export const LEAVE_COLORS = {
  pending: 'var(--warn)', approved: 'var(--ok)',
  rejected: 'var(--danger)', cancelled: 'var(--on-surface-3)',
};
export const CLAIM_COLORS = {
  pending: 'var(--warn)', approved: 'var(--ok)',
  rejected: 'var(--danger)', paid: 'var(--st-in-progress)',
};
export const CLAIM_CATEGORIES = ['travel', 'meals', 'supplies', 'other'];
// Announcement priority. Reads the canonical task-priority map rather than
// restating it — the only difference is that announcements say `normal` where
// tasks say `medium`, which is an alias, not a different colour.
export const PRIORITY_COLORS = {
  low:    TASK_PRIORITY_COLORS.low,
  normal: TASK_PRIORITY_COLORS.medium,
  medium: TASK_PRIORITY_COLORS.medium,
  high:   TASK_PRIORITY_COLORS.high,
  urgent: TASK_PRIORITY_COLORS.urgent,
};
export const CANDIDATE_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
export const STAGE_COLORS_REC = {
  applied: 'var(--on-surface-3)', screening: 'var(--st-in-progress)',
  interview: 'var(--st-in-review)', offer: 'var(--warn)',
  hired: 'var(--ok)', rejected: 'var(--danger)',
};
export const ASSET_CATEGORIES = ['laptop', 'phone', 'tablet', 'vehicle', 'furniture', 'other'];
export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'disposed'];
export const CATEGORY_COLORS = {
  laptop: 'var(--st-in-progress)', phone: 'var(--st-in-review)',
  tablet: 'var(--primary-text)', vehicle: 'var(--warn)',
  furniture: 'var(--secondary)', other: 'var(--on-surface-3)',
};
export const CONDITION_COLORS = {
  new: 'var(--ok)', good: 'var(--st-in-progress)', fair: 'var(--warn)',
  poor: 'var(--danger)', disposed: 'var(--on-surface-3)',
};
// Was a local `₹${…toLocaleString('en-IN')}` — one of 87 reimplementations of
// Indian digit grouping that lib/inr.js exists to end.
export const FMT = inr;

/**
 * Badge — now `ui/Tag`, not a third private pill.
 *
 * Identical to the definitions in graha/_shared.jsx and ganit/_shared.jsx, all
 * three duplicating `.tag` from components.css. All three hardcoded
 * a 10px font (below 00 §12's 11px metadata floor, and deaf to the Text size
 * slider), a literal 99px radius (deaf to the Border radius setting), and
 * `background: \`${color}18\``, which stopped producing a colour the moment the
 * maps above became token references.
 */
export function Badge({ text, color, children }) {
  const label = text ?? children;
  return <Tag color={color}>{typeof label === 'string' ? label.replace(/_/g, ' ') : label}</Tag>;
}

/* ══════════════════════════════════════════════════════════════════════════
   Loading · error · empty — the three states, kept apart
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The sentence to show for a failed request.
 *
 * The server's own words win wherever it wrote them. `manav.py` answers a
 * refused identity-document read with a real explanation, and replacing that
 * with "Failed" throws away the only text that says what to do next.
 */
export function errText(err, fallback = 'Retry, or check your connection.') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const status = err?.response?.status;
  if (status === 403) return 'You do not have access to this part of HR.';
  if (status === 404) return 'That record no longer exists.';
  if (status === 422) return 'The request was rejected as malformed. This is a defect, not something you can fix here.';
  if (status >= 500) return 'The server failed on this request. Nothing was changed.';
  if (err?.response == null) return 'No response from the server — check your connection.';
  return fallback;
}

/**
 * The client list both custody registers pick from, loaded once the drawer that
 * needs it is open.
 *
 * `/v1/custody/clients` RATHER THAN THE CRM's OWN ROUTE, which is gated on
 * holding CRM, Finance or Sales — a practice that bought HR alone would
 * otherwise be able to read this register and not the names in it.
 *
 * Loading, failure and emptiness are kept apart for the reason this file gives
 * at length above: a caught error that leaves the list at `[]` renders as "no
 * clients", which is a sentence a reader believes.
 *
 * DscTab and UdinTab each declared this identically until 2026-09-03. It is one
 * hook now because the route choice above is a permissions decision, and a
 * permissions decision written down twice is one that can be revised once.
 */
export function useClientOptions(enabled) {
  const [state, setState] = useState({ loading: false, error: '', items: [] });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState({ loading: true, error: '', items: [] });
    api.get('/v1/custody/clients')
      .then(r => {
        if (alive) setState({ loading: false, error: '', items: r.data?.data || [] });
      })
      .catch(err => {
        if (alive) setState({ loading: false, error: errText(err), items: [] });
      });
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

/**
 * A GET with its three outcomes kept distinct: `loading`, `error`, `data`.
 *
 * `data` stays null while `error` is set. `reload` re-runs it. `deps` lets a
 * caller re-run on a filter change without rebuilding the hook.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { ...state, reload: run };
}

/**
 * The list form. Unwraps through `lib/api`'s `rows()` rather than reaching for
 * `r.data.data` — 99 backend GET routes answer `{"data":[…]}` and 28 answer a
 * bare array, and `rows()` makes the call site indifferent to which. Every
 * Manav list route is the enveloped form, verified route by route, but the
 * call sites do not encode that assumption.
 *
 * `items` is null on failure, never `[]`.
 */
export function useList(path, deps = []) {
  const r = useResource(path, deps);
  return { ...r, items: r.error ? null : unwrapRows({ data: r.data }) };
}

/**
 * The failure block. Says it failed, says why, offers the way out.
 *
 * `role="status"` rather than `alert` — announced without stealing focus.
 * Deliberately NOT the empty state: no illustration, no "get started".
 */
export function ErrorNote({ what, error, onRetry }) {
  return (
    <div className="note note--warn mn-err" role="status">
      <b>{what} did not load.</b> {error}
      {onRetry && (
        <button type="button" className="k-btn k-btn--ghost mn-err__go" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** The skeleton. One import per tab for the loading state. */
/* `Shim` is `components/ui/Skeleton.jsx`, beside the `Announced` it wraps
   itself in. Three modules declared it identically until 2026-09-03, each
   carrying the same accessibility fix in a comment — so the next such fix
   would have had to be made three times, or two modules would stay silent
   to a screen reader while looking busy to an eye. */
export { Shim };

/**
 * Loading, then failure, then empty — in that order, in one place, so no tab
 * can forget one. `empty` is only ever reached when the request actually
 * succeeded and actually returned nothing.
 */
export function Resource({ state, what, skeleton, empty, onRetry, children }) {
  if (state.loading) return skeleton ?? <Shim count={4} />;
  if (state.error) return <ErrorNote what={what} error={state.error} onRetry={onRetry ?? state.reload} />;
  const list = state.items ?? state.data;
  if (empty && (list == null || (Array.isArray(list) && list.length === 0))) return empty;
  return children;
}

/** `09:02` from a timestamp, or an em dash. Attendance reads as times, not dates. */
export function clockTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/* Months are `lib/dates.js` — see the note there. Vetana held the same two
   functions, and both built their bounds from the UNRESOLVED argument. */
export { thisMonth, monthRange } from '../../lib/dates';

/** Today as `YYYY-MM-DD`, local — `toISOString()` is UTC and rolls the date
 *  over for every user east of Greenwich after 05:30 IST. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


/** The default shift colour.
 *
 *  A HEX, deliberately, and it must stay one. It feeds `<input type="color">`,
 *  which accepts `#rrggbb` and NOTHING else — a token reference there is
 *  silently coerced to #000000 by the browser — and it is persisted to
 *  `manav_shift_definitions.color`, whose backend default is this same value.
 *  This is the one colour in the module that cannot be a token. */
export const DEFAULT_SHIFT_COLOR = '#3B82F6';

/** True for a `#rgb`/`#rrggbb` string — the only values a colour input can show. */
export function isHexColor(v) {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}
