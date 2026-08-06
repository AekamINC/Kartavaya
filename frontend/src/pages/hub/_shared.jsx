// Constants and helpers shared across the Hub (Sahayak Admin) tabs.
//
// ── Why this file exists ─────────────────────────────────────────────────────
//
// `HubDashboardPage.jsx` was 1,355 lines with 248 inline styles and every tab
// inside it; `HubClientDetailPage.jsx` was 1,342 lines with 241, and roughly 700
// of those lines were a COPY of the first file's tabs. 13-module-pages.md splits
// a module into a route file plus a directory of tab components BEFORE any
// styling is applied — a restyle of a single-file module touches every tab,
// every table and every form at once, and the diff is unreviewable.
//
// The duplication was not benign. The two copies had drifted:
//
//   · `HubDashboardPage`'s Publish tab had a content calendar, a platform
//     enable/disable panel, thirteen platforms, per-platform manual-token fields
//     for Telegram / Reddit / Pinterest, and an EXPIRED marker on a stale OAuth
//     token. `HubClientDetailPage`'s copy had none of that — same feature, same
//     endpoints, an older UI. A client-portal admin opening a specific client
//     saw strictly less than one opening the org's own client.
//
// Both route files now render these components, so there is one Publish tab and
// the drift cannot recur.
//
// ── The rule this module is built around ─────────────────────────────────────
//
// A FAILED FETCH MUST NEVER RENDER AS AN EMPTY STATE.
//
// Every tab here previously wrote `catch { pushToast(...) }` and then branched
// on `list.length === 0`. A toast is gone in four seconds; the panel underneath
// then says "No content yet", "No posts in queue", "No transactions yet" — three
// sentences that are false statements about the account rather than a report
// that the request failed. On the credits tab specifically, "No transactions
// yet" over a wallet that has been spending for a month is the worst version of
// this bug available. `useResource` keeps loading / error / data apart and
// cannot collapse them.
import React, { useState, useEffect, useCallback } from 'react';
import { api, rows as unwrapRows } from '../../lib/api';

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

export const AGENT_LABELS = {
  social_media: 'Social Media', blog: 'Blog', ad_copy: 'Ad Copy',
  email: 'Email', whatsapp: 'WhatsApp', lead_magnet: 'Lead Magnet',
  campaign: 'Campaign Strategy', seo: 'SEO Content',
};

/**
 * Content review status → token.
 *
 * Was a map of raw hexes (`#6E7B91`, `#f59e0b`, …) consumed as `${c}18` to make
 * a tint. That expression is a hex-alpha suffix and only works while the value
 * is a hex — it silently produces an invalid colour the moment a token goes in,
 * which is the exact defect `editorial/ModuleUI.jsx` documents for `Badge`.
 * These are tokens now and the tint is done in CSS with `color-mix`.
 */
export const STATUS_TONE = {
  draft: 'var(--on-surface-3)',
  pending_review: 'var(--warn)',
  approved: 'var(--ok)',
  rejected: 'var(--danger)',
  published: 'var(--st-in-progress)',
  archived: 'var(--on-surface-faint)',
};

export const TX_TONE = {
  debit: 'var(--danger)',
  credit: 'var(--ok)',
  refill: 'var(--st-in-progress)',
  topup: 'var(--ok)',
  refund: 'var(--warn)',
};

export const QUEUE_TONE = {
  scheduled: 'var(--warn)',
  publishing: 'var(--st-in-progress)',
  published: 'var(--ok)',
  failed: 'var(--danger)',
  cancelled: 'var(--on-surface-faint)',
};

export const LANGUAGES = [
  ['en', 'English'], ['hi', 'Hindi'], ['gu', 'Gujarati'],
  ['mr', 'Marathi'], ['ta', 'Tamil'],
];

/**
 * The publishing targets, with the brand colour each one owns.
 *
 * These hexes are third-party brand identities — Facebook blue is Facebook's,
 * not ours, and there is no token for it because it must NOT flip with our
 * theme. They stay literals here in JS and reach the DOM only as `--pc`, the
 * custom property `.hb-plat` reads. That is check-tokens deviation 2: a value
 * that varies per element is declared in JavaScript and consumed by a rule.
 * No raw CSS property value survives in the markup.
 *
 * `ink` marks the two whose brand colour is light enough that white text on it
 * fails contrast — Snapchat yellow being the reason this field exists.
 */
export const PLATFORMS = [
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: 'f',
    desc: 'Publish to Facebook Pages',
    prereqs: ['Facebook Business Page', 'Meta Business Suite access', 'Page admin role'],
    supports: ['Text posts', 'Photo posts', 'Link sharing'] },
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: 'IG',
    desc: 'Publish to Instagram Business',
    prereqs: ['Instagram Business or Creator account', 'Linked Facebook Page', 'Meta Business Suite access'],
    supports: ['Photo posts (image required)', 'Captions with hashtags'] },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2', icon: 'in',
    desc: 'Publish to LinkedIn profiles',
    prereqs: ['LinkedIn account with posting access'],
    supports: ['Text posts', 'Articles', 'Link sharing'] },
  { key: 'google_business', label: 'Google Business', color: '#4285F4', icon: 'G',
    desc: 'Publish to Google Business Profile',
    prereqs: ['Verified Google Business Profile', 'Owner or manager access'],
    supports: ['Local posts', 'Updates', 'Offers'] },
  { key: 'twitter', label: 'Twitter / X', color: '#1DA1F2', icon: 'X',
    desc: 'Publish to X (Twitter)',
    prereqs: ['X Developer account', 'API v2 access (manual token)'],
    supports: ['Tweets (280 chars)', 'Threads'], manualOnly: true },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', icon: 'YT',
    desc: 'Upload videos to YouTube',
    prereqs: ['YouTube channel', 'Google account with channel access'],
    supports: ['Video uploads', 'Shorts', 'Community posts'] },
  { key: 'whatsapp_business', label: 'WhatsApp Business', color: '#25D366', icon: 'WA',
    desc: 'Broadcast via WhatsApp Business API',
    prereqs: ['WhatsApp Business account', 'Meta Business Suite', 'Verified phone number', 'Approved message templates'],
    supports: ['Template messages', 'Broadcast lists', 'Media messages'] },
  { key: 'pinterest', label: 'Pinterest', color: '#E60023', icon: 'P',
    desc: 'Create Pins on Pinterest',
    prereqs: ['Pinterest Business account', 'At least one board created'],
    supports: ['Image pins', 'Rich pins', 'Idea pins'] },
  { key: 'tiktok', label: 'TikTok', color: '#111111', icon: 'TT',
    desc: 'Publish videos to TikTok',
    prereqs: ['TikTok Business or Creator account', 'TikTok Developer app access'],
    supports: ['Video posts', 'Descriptions with hashtags'] },
  { key: 'threads', label: 'Threads', color: '#111111', icon: 'Th',
    desc: 'Post to Threads (Meta)',
    prereqs: ['Instagram account (Threads linked)', 'Meta app with Threads API access'],
    supports: ['Text posts', 'Image posts', 'Link sharing'] },
  { key: 'telegram', label: 'Telegram', color: '#0088cc', icon: 'TG',
    desc: 'Post to Telegram channels',
    prereqs: ['Telegram Bot token (from @BotFather)', 'Bot added as admin to target channel'],
    supports: ['Text messages', 'Photo messages', 'HTML formatting'], manualOnly: true },
  { key: 'snapchat', label: 'Snapchat', color: '#FFFC00', ink: true, icon: 'SC',
    desc: 'Publish to Snapchat',
    prereqs: ['Snapchat Business account', 'Snap Kit API access'],
    supports: ['Stories', 'Spotlight posts'], manualOnly: true },
  { key: 'reddit', label: 'Reddit', color: '#FF4500', icon: 'R',
    desc: 'Submit posts to subreddits',
    prereqs: ['Reddit account with posting karma', 'Reddit API app registered'],
    supports: ['Text posts', 'Link posts', 'Image posts'] },
];

export const platformOf = key => PLATFORMS.find(p => p.key === key) || null;

/** The extra id a manual connection needs, per platform. Empty means none. */
export const MANUAL_PAGE_FIELD = {
  facebook: 'Page ID (required for publishing)',
  instagram: 'Page ID (required for publishing)',
  telegram: 'Channel ID (e.g. @channelname)',
  reddit: 'Subreddit (e.g. r/marketing)',
  pinterest: 'Board ID',
};

/* ── Failure handling ────────────────────────────────────────────────────── */

/**
 * The sentence to show for a failed request.
 *
 * The server's own `detail` wins wherever it wrote one — the hub routers answer
 * 402 with what ran out and 403 with which grant is missing, and replacing that
 * with "Failed to load" throws away the only text that says what to do next.
 */
export function errText(err, fallback = 'Retry, or check your connection.') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  const status = err?.response?.status;
  if (status === 402) return 'This action needs more credits than the wallet holds.';
  if (status === 403) return 'You do not have access to this part of Sahayak.';
  if (status === 404) return 'That record no longer exists.';
  if (status >= 500) return 'The server failed on this request. Nothing was changed.';
  if (err?.response == null) return 'No response from the server — check your connection.';
  return fallback;
}

/**
 * A GET with its three outcomes kept distinct: `loading`, `error`, `data`.
 *
 * `data` stays null while `error` is set, so a caller cannot render a populated
 * empty state over a failure. `reload` re-runs it.
 *
 * `path` may be null — a tab that has no client id yet must not fire a request
 * against `/clients/null`, and must not sit on a spinner forever either.
 */
export function useResource(path, deps = []) {
  const [state, setState] = useState({ loading: !!path, error: '', data: null });

  const run = useCallback(async () => {
    if (!path) { setState({ loading: false, error: '', data: null }); return; }
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

  return { ...state, reload: run, setData: d => setState(s => ({ ...s, data: d })) };
}

/**
 * The list form. `rows()` from lib/api is what makes the call site indifferent
 * to whether the route answered `{"data":[…]}` or a bare array — 99 backend GET
 * routes do the first and 28 do the second, with no rule, and guessing wrong
 * renders an empty list rather than throwing.
 *
 * `items` is null on failure, never `[]`. That is the whole point: `[]` and
 * "we do not know" must not be the same value.
 */
export function useList(path, deps = []) {
  const r = useResource(path, deps);
  return { ...r, items: r.error || r.data == null ? null : unwrapRows({ data: r.data }) };
}

/**
 * The failure block. Says it failed, says why, offers the way out.
 *
 * `role="status"` rather than `alert`: announced without stealing focus.
 * Deliberately NOT the empty state — no illustration, no "get started" CTA.
 */
export function ErrorNote({ what, error, onRetry }) {
  return (
    <div className="note note--warn hb-err" role="status">
      <b>{what} did not load.</b> {error}
      {onRetry && (
        <button type="button" className="k-btn k-btn--ghost hb-err__go" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Loading skeleton, shared so no tab invents its own. */
export function Shim({ count = 4 }) {
  return (
    <div className="k-shimmer">
      {Array.from({ length: count }, (_, i) => <div key={i} className="k-shimmer__tile" />)}
    </div>
  );
}

/**
 * Loading → error → empty → content, in that order, in one place.
 *
 * `empty` is only ever reached when the request actually succeeded and actually
 * returned nothing. There is no path from a rejected promise to this branch.
 */
export function Resource({ state, what, skeleton, empty, onRetry, children }) {
  if (state.loading) return skeleton ?? <Shim count={3} />;
  if (state.error) return <ErrorNote what={what} error={state.error} onRetry={onRetry ?? state.reload} />;
  const list = state.items ?? state.data;
  if (empty && (list == null || (Array.isArray(list) && list.length === 0))) return empty;
  return children;
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** `12 Jul 2026, 4:05 pm` — one implementation, so the module reads uniformly. */
export function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** `12 Jul 26` — the compact form for a card footer. */
export function shortStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/** `2026-07` for the calendar, which is the only month format the API speaks. */
export function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `social_media` → `social media`. */
export const words = s => String(s ?? '').replace(/_/g, ' ');

/**
 * `1 credit` / `3 credits`.
 *
 * The bare `${n} credits` template printed "1 credits", and not only on a
 * contrived value: the cost table the server serves on `/v1/hub/org/credits`
 * has a single-credit entry in it, so the WhatsApp preset showed the broken
 * plural on every load of the Generate tab. `skills/CreateTab.jsx` already
 * pluralises "step" by hand, so the intent was there — this just gives the
 * module one place to do it.
 *
 * NOT called `credits`: several tabs take a prop by that name, and a
 * destructured parameter shadows a module import silently.
 */
export const creditLabel = n => `${n} credit${Math.abs(Number(n)) === 1 ? '' : 's'}`;

/**
 * The status pill. Renders through the shared chip vocabulary rather than a
 * per-page span, and carries the colour as `--c` so the tint is computed in CSS.
 */
export function StatusPill({ status, tone }) {
  return (
    <span className="hb-pill" style={{ '--c': tone || STATUS_TONE[status] || 'var(--on-surface-3)' }}>
      {words(status) || '—'}
    </span>
  );
}
