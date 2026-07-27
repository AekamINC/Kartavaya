// Constants and helpers shared across the Prachar tabs.
//
// ── Every colour here is a token reference ────────────────────────────────
// The single-file PracharPage carried its colour maps as `var(--…)` already,
// which was right, and they are preserved. What it did NOT have was a channel
// map: the reference tints every campaign by its channel, and the build drew
// them all the same. The channel colours below come from the status ramp and
// the two container-backed families (--secondary olive, --tertiary terracotta)
// rather than from the reference's literal brand hexes (#c2703c Instagram,
// #0082c6 LinkedIn, …) for the reason 00 §9 gives: a literal cannot flip by
// theme, and #0082c6 in particular is the RETIRED brand blue.
//
// ── The API shape, which five tabs got wrong ──────────────────────────────
// `lib/api` is a bare axios instance. `api.get(p)` resolves to the axios
// response, so the body is `r.data`, and every list route in `prachar.py`
// answers `{"data": [...]}` — the array is therefore `r.data.data`.
//
// CampaignsTab, TemplatesTab, AutomationsTab, UnsubscribesTab and EventsTab all
// did `setX(r.data)` and then `X.map(…)` on `{data: […]}`, which throws
// "X.map is not a function" and takes the whole tab down with a blank screen.
// AdsTab did `setOverview(ov)` on the response object itself, so every ad
// figure rendered 0. `rows()` and `body()` below are the one place that
// unwrapping now happens.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../lib/api';
import { Shimmer, Empty } from '../../components/editorial';

/* ── Response unwrapping ──────────────────────────────────────────────── */

/** The array out of a `{"data": [...]}` list route, tolerant of a bare array. */
export const rows = (r) => {
  const b = r?.data;
  if (Array.isArray(b)) return b;
  if (Array.isArray(b?.data)) return b.data;
  return [];
};

/** The object out of a single-object route. */
export const body = (r) => r?.data ?? {};

/* ── Status and channel vocabulary ────────────────────────────────────── */

export const CAMPAIGN_COLORS = {
  draft: 'var(--on-surface-3)',
  scheduled: 'var(--st-in-progress)',
  sending: 'var(--st-in-review)',
  sent: 'var(--ok)',
  paused: 'var(--warn)',
  cancelled: 'var(--on-surface-3)',
};

export const SEQ_COLORS = {
  draft: 'var(--on-surface-3)',
  active: 'var(--ok)',
  paused: 'var(--warn)',
  archived: 'var(--on-surface-3)',
};

export const EVENT_STATUS_COLORS = {
  draft: 'var(--on-surface-3)',
  published: 'var(--st-in-progress)',
  ongoing: 'var(--warn)',
  completed: 'var(--ok)',
  cancelled: 'var(--danger)',
};

export const EVENT_TYPE_COLORS = {
  webinar: 'var(--st-in-progress)',
  meetup: 'var(--st-in-review)',
  workshop: 'var(--warn)',
  conference: 'var(--secondary)',
  other: 'var(--on-surface-3)',
};

/**
 * Campaign channels. The reference's four social channels are not what this
 * backend sends — `prachar_campaigns.channel` is email / sms / whatsapp — so
 * the CHANNEL IS REAL and the colours follow the reference's intent rather than
 * its literal palette.
 */
export const CHANNELS = [
  { id: 'email', label: 'Email', hi: 'ईमेल', color: 'var(--st-in-progress)' },
  { id: 'whatsapp', label: 'WhatsApp', hi: 'व्हाट्सएप', color: 'var(--ok)' },
  { id: 'sms', label: 'SMS', hi: 'संदेश', color: 'var(--tertiary)' },
];
export const channelColor = (c) =>
  CHANNELS.find((x) => x.id === c)?.color || 'var(--on-surface-3)';
export const channelLabel = (c) =>
  CHANNELS.find((x) => x.id === c)?.label || c || 'Unknown';

/**
 * Sequence step channels. NOT the campaign set — `prachar.py:809` validates
 * against ("email", "whatsapp", "call_task", "manual") and 400s on anything
 * else. The old form offered SMS, so every "Add step" with SMS selected failed
 * with a toast that said only "400".
 */
export const STEP_CHANNELS = [
  { id: 'email', label: 'Email' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'call_task', label: 'Call task' },
  { id: 'manual', label: 'Manual' },
];

export const TEMPLATE_CATEGORIES = ['general', 'newsletter', 'promotional', 'transactional'];

/** Utility vs Marketing is the distinction the reference's Templates note draws;
 *  this build's categories map onto it — transactional and general are utility,
 *  newsletter and promotional need opt-in. */
export const isMarketingCategory = (c) => c === 'newsletter' || c === 'promotional';

/* ── Formatting ───────────────────────────────────────────────────────── */

/** A count with its noun, so a figure is never unitless. */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

/** `contact_created` → `Contact created`. Enum values never reach the user raw. */
export const humanise = (s) =>
  s ? String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—';

/** A percentage that survives a zero denominator. */
export const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

/* ── Error messages ───────────────────────────────────────────────────── */

/**
 * One sentence a person can act on, from an axios failure.
 *
 * The old file passed `e.message` straight into a toast, which on a 403 reads
 * "Request failed with status code 403" — a string that tells the user nothing
 * and tells support nothing either.
 */
export function errText(e) {
  const s = e?.response?.status;
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (s === 403) return 'You do not have access to Marketing. An org admin can grant it.';
  if (s === 404) return 'That is no longer there — it may have been deleted.';
  if (s === 409) return 'That conflicts with something already saved.';
  if (s === 429) return 'Too many requests just now. Wait a moment and retry.';
  if (s >= 500) return 'The server could not complete that. Retry in a moment.';
  if (!e?.response) return 'No answer from the server. Check your connection and retry.';
  return 'That did not work. Retry, or reload the page.';
}

/* ── The loader ───────────────────────────────────────────────────────────
 * Three states, and they are three DIFFERENT states.
 *
 * Every tab in the old file collapsed them into two: `loading ? <Shimmer/> :
 * list.length === 0 ? <Empty/> : <rows/>`. A failed fetch left the list at its
 * `[]` initial value, so a 500 and a genuinely empty account rendered the same
 * illustration — "No campaigns yet. Create your first marketing campaign." on
 * top of a server that is down. That is the defect the owner sees most, and it
 * is why this hook returns `error` as a first-class value rather than pushing a
 * toast and moving on.
 */
export function useResource(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Guards a setState after unmount, and — the case that actually bites — a
  // slow first response landing after a faster second one and overwriting it.
  const seq = useRef(0);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const d = await fetcher();
      if (seq.current === mine) setData(d);
    } catch (e) {
      if (seq.current === mine) { setError(errText(e)); setData(null); }
    } finally {
      if (seq.current === mine) setLoading(false);
    }
    // `fetcher` is redeclared every render by every caller; depending on it
    // would loop. The caller's `deps` is the honest dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); return () => { seq.current++; }; }, [run]);

  return { data, error, loading, reload: run, setData };
}

/**
 * Panel — the loading / error / empty / content frame, once.
 *
 * `error` outranks `empty`, always. If both are somehow set, the failure is the
 * thing the user needs to know.
 */
export function Panel({ loading, error, onRetry, empty, emptyProps, count = 4, children }) {
  if (loading) return <Shimmer count={count} />;
  if (error) {
    return (
      <div className="note note--warn pr__err" role="alert">
        <span><b>This did not load.</b> {error}</span>
        {onRetry && (
          <button type="button" className="k-btn k-btn--ghost k-btn--sm pr__err-b" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }
  if (empty) return <Empty {...emptyProps} />;
  return children;
}

/**
 * A section heading with its Devanagari, and controls at the trailing edge.
 * Replaces the `.k-section__head` + `style={{ marginBottom: 20 }}` pair that
 * opened five of the eight tabs.
 */
export function Bar({ title, hi, children }) {
  return (
    <div className="pr__bar">
      <h3 className="pr__bar-t">
        {title}
        {hi && <span className="pr__bar-hi" lang="hi">{hi}</span>}
      </h3>
      {children && <div className="pr__bar-act">{children}</div>}
    </div>
  );
}

/* ── Write helpers ────────────────────────────────────────────────────── */

/**
 * A mutation with its own busy flag and a toast on failure.
 *
 * The old file `await`ed bare `api.post(…)` inside click handlers with no
 * try/catch in eight places — `save()` in Campaigns, Sequences, Templates and
 * Automations among them. An unhandled rejection there leaves the form open,
 * the button live, and nothing said; the user presses it again and creates a
 * duplicate the moment the server recovers.
 */
export function useMutate(pushToast) {
  const [busy, setBusy] = useState(false);
  const go = useCallback(async (fn, okTitle) => {
    setBusy(true);
    try {
      const out = await fn();
      if (okTitle) pushToast({ type: 'success', title: okTitle });
      return { ok: true, out };
    } catch (e) {
      pushToast({ type: 'error', title: errText(e) });
      return { ok: false, error: e };
    } finally {
      setBusy(false);
    }
  }, [pushToast]);
  return { busy, go };
}

export { api };
