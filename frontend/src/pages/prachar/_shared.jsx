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

/* ── Response unwrapping ──────────────────────────────────────────────────
 * Promoted to `lib/api` and re-exported here so the existing tab imports keep
 * working. The shape mismatch is not a Prachar problem — it is every module's —
 * so one implementation, next to the client that creates the ambiguity. */
export { rows, body } from '../../lib/api';

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

/**
 * The four values `graha_contacts.contact_type` is CHECKed against.
 *
 * Re-declared rather than imported from `pages/graha/_shared.jsx` on purpose.
 * Prachar reads Graha's data through a Prachar route — `/v1/graha/contacts`
 * sits behind `require_module("graha")`, so a marketer with Prachar and nothing
 * else is 403'd by it — and a module that imports another module's page code
 * acquires that module's render-time dependencies with it. Four strings are
 * cheaper than that coupling, and the audience options endpoint returns the
 * authoritative list anyway; this is only the floor it falls back to.
 */
export const CONTACT_TYPES = ['lead', 'customer', 'vendor', 'partner'];

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

/* ── The audience filter ──────────────────────────────────────────────────
 *
 * `prachar_campaigns.audience_filter` is a flat JSONB object, every key
 * optional, AND-combined, and `{}` means every active contact in the org. The
 * five keys `_resolve_audience` reads are below; the UI only OFFERS three of
 * them (see `AudienceFilter.jsx` for why `tag` and `min_score` have no control),
 * but all five round-trip so a filter written by anything else survives a save
 * made here.
 */
export const AUDIENCE_KEYS = ['type', 'source', 'company', 'tag', 'min_score'];

/**
 * The filter as an object, whatever the wire handed us.
 *
 * `db.py:106` degrades to no jsonb codec when PgBouncer refuses `set_type_codec`
 * three times, and in that state every JSONB column arrives as a STRING. A
 * campaign list rendered under that degradation would otherwise show every
 * campaign as targeting everyone — the exact defect this whole change exists to
 * remove — with nothing on screen to say the filter was simply not parsed.
 */
export function parseFilter(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

/**
 * What goes on the wire: empty keys removed, `label` rewritten to `tag`,
 * `min_score` an integer.
 *
 * This mirrors the validator on `CampaignCreate`/`CampaignUpdate` rather than
 * trusting it. `{"type": ""}` is a 400 the operator did nothing to deserve, and
 * `min_score: "50"` from a form field reaches asyncpg as text and raises a
 * DataError — a 500 on a send, which is the one place a 500 is expensive.
 * Refusing to build the bad payload is cheaper than rendering the refusal.
 */
export function normaliseFilter(raw) {
  const src = parseFilter(raw);
  const out = {};
  for (const k of AUDIENCE_KEYS) {
    // `label` is the deprecated spelling of `tag`. Anything already persisted
    // under it is carried forward; nothing here ever emits it again.
    const v = k === 'tag' ? (src.tag || src.label) : src[k];
    if (v === '' || v == null) continue;
    if (k === 'min_score') {
      const n = Number(v);
      if (Number.isFinite(n)) out.min_score = Math.trunc(n);
      continue;
    }
    const s = typeof v === 'string' ? v.trim() : v;
    if (s !== '') out[k] = s;
  }
  return out;
}

/** True when this filter narrows nothing — every active contact in the org. */
export const isEveryone = (raw) => Object.keys(normaliseFilter(raw)).length === 0;

/**
 * A filter as one short line, for the Segment column in the campaign list.
 *
 * Deliberately NOT the server's `summary` sentence. That is prose, built by
 * `/audience` and `/audience/preview` and rendered verbatim wherever those
 * answer; a list row has neither call behind it and inventing the sentence
 * client-side would be two sources of the same words. This is a compact label
 * in a different register, so nothing pretends the two must match.
 */
export function filterLabel(raw) {
  const f = normaliseFilter(raw);
  const bits = [];
  if (f.type) bits.push(`${humanise(f.type)}s`);
  if (f.source) bits.push(`from ${humanise(f.source)}`);
  if (f.company) bits.push(`company ~ “${f.company}”`);
  if (f.tag) bits.push(`tagged ${f.tag}`);
  if (f.min_score != null) bits.push(`score ≥ ${f.min_score}`);
  return bits.length ? bits.join(' · ') : 'Everyone';
}

/**
 * The reach of a resolved audience, as one sentence.
 *
 * "128 contacts match · 12 unsubscribed · 116 will receive this." — never one
 * bare number. A count that has not had the suppression list taken off it is
 * not the number a marketer is deciding on, and the old copy showed exactly
 * that with a footnote nobody reads.
 *
 * The two suppression figures are omitted when the response does not carry
 * them, so this renders honestly against either shape of `/audience`.
 */
export function reachSentence(a) {
  const matched = Number(a?.matched ?? a?.count ?? 0);
  const parts = [`${plural(matched, 'contact')} match`];
  if (a?.unsubscribed != null) parts.push(`${a.unsubscribed} unsubscribed`);
  if (a?.will_receive != null) parts.push(`${plural(a.will_receive, 'person', 'people')} will receive this`);
  else parts.push('before unsubscribes are removed');
  return parts.join(' · ');
}

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
