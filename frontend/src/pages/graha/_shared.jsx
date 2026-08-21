// Constants and helpers shared across the Graha tabs.
//
// Every colour below is a token reference, never a literal — 00-tokens.md is
// explicit that a hardcoded hex cannot follow the theme, and this file carried
// the whole retired set: #0082c6 (the retired brand blue, 00 §9), #8b5cf6,
// #dc2626, #ef4444, #f59e0b and a slate #6E7B91 that existed nowhere else.
//
// Categorical maps use the status ramp rather than inventing hues, for the
// reason 00 §9 gives: those tokens sit at 38-42% saturation, so they never read
// as the user's accent (>60%), and they already flip by theme. Where a category
// needs a hue the status ramp does not carry, --secondary (olive) and
// --tertiary (terracotta) are the two remaining container-backed families.
import React from 'react';
import Tag from '../../components/ui/Tag';
import { mixAlpha } from '../../lib/statusColors';

export const CONTACT_TYPES = ['lead', 'customer', 'vendor', 'partner'];
export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'];
export const TYPE_COLORS = {
  lead: 'var(--warn)', customer: 'var(--ok)',
  vendor: 'var(--st-in-review)', partner: 'var(--st-in-progress)',
};
// Default pipeline stages. Deal stages are org-configurable (13 §2), so a stage
// outside this set falls back through stageColor() rather than rendering bare.
export const STAGE_COLORS = {
  New: 'var(--st-todo)', Qualified: 'var(--warn)', Proposal: 'var(--st-in-progress)',
  Negotiation: 'var(--st-in-review)', Won: 'var(--ok)', Lost: 'var(--danger)',
};
export const SOURCE_COLORS = {
  indiamart: 'var(--st-in-progress)', justdial: 'var(--tertiary)',
  manual: 'var(--on-surface-3)', website: 'var(--ok)',
};
export const ACT_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
export const TL_ICONS = { activity: '●', followup: '⏰', invoice: '📄', deal: '💼' };
export const TL_SUB_ICONS = { call: '📞', email: '✉️', meeting: '📅', note: '📝', task: '✅' };
export const TL_COLORS = {
  activity: 'var(--st-in-progress)', followup: 'var(--warn)', invoice: 'var(--ok)',
  deal: 'var(--st-in-review)', _default: 'var(--on-surface-3)',
};

export const stageColor = s => STAGE_COLORS[s] || 'var(--on-surface-3)';

export function dealStaleness(updatedAt) {
  if (!updatedAt) return null;
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  // `bg` was a hex-alpha suffix (#dc262612). With token references that string
  // concatenation produces "var(--danger)12", which is not a colour and is
  // dropped silently. The tint is now `.gr__rot`'s own color-mix off `--c`, so
  // there is one place that decides how strong it is.
  const at = (color, level, label) => ({ days, level, color, label });
  if (days >= 14) return at('var(--danger)', 'critical', `${days}d stale`);
  if (days >= 7)  return at('var(--warn)',   'warning',  `${days}d idle`);
  if (days >= 3)  return at('var(--on-surface-3)', 'mild', `${days}d ago`);
  return null;
}

/**
 * The "nobody has touched this" marker. Geometry lives in `.gr__rot`; only the
 * per-instance colour is inline, as `--c` — check-tokens deviation 2.
 */
export function RotBadge({ updatedAt }) {
  const rot = dealStaleness(updatedAt);
  if (!rot) return null;
  return (
    <span className="gr__rot" style={{ '--c': rot.color }} title={`No activity for ${rot.days} days`}>
      {rot.level === 'critical' ? '🔥' : rot.level === 'warning' ? '⏳' : '·'} {rot.label}
    </span>
  );
}

/**
 * Badge — now `ui/Tag`, not a fourth private pill.
 *
 * This was one of THREE byte-identical local Badge definitions (graha, ganit,
 * manav `_shared.jsx`), each duplicating `.tag` from components.css. All three
 * hardcoded a 10px font — below 00 §12's 11px metadata floor and immune to the
 * Text size slider — a literal 99px radius, which ignores the Border radius
 * setting, and `background: \`${color}18\``, dead since the colour maps became
 * token references.
 *
 * The signature is kept so no call site changes, and `children` is accepted
 * because five Dristi call sites pass the label as a child.
 */
export function Badge({ text, color, children }) {
  return <Tag color={color}>{text ?? children}</Tag>;
}

/**
 * The canonical address of one deal.
 *
 * A deal had no URL at all — it opened as an editor inside `DealsTab`'s local
 * state, so it could not be bookmarked, linked to a colleague, reached by the
 * back button or survived a refresh, and every notification that wanted to
 * point at one had nowhere to point. It is `/graha/deals/<id>` now, and this is
 * the ONE place that spelling is written: a second call site building the path
 * by hand is how two links to the same record end up differing by a slash.
 *
 * The id in a URL is not the id on screen — 00's names-not-ids rule is about
 * what is DRAWN, and nothing here draws it.
 */
export const dealPath = id => `/graha/deals/${encodeURIComponent(id)}`;

/**
 * "A deal changed" — from the record route back to whatever list is behind it.
 *
 * The record is a ROUTE now, and its parent is `GrahaPage`, which owns neither
 * the deals list nor a callback into it. Prop-drilling a refresh handler would
 * mean editing the module shell and every tab between; a subscription is the
 * one path that does not. It is deliberately dumb: no payload, no ordering
 * guarantee — the subscriber refetches, which is what it did after its own
 * writes already.
 */
const dealWatchers = new Set();

/** Subscribe. Returns the unsubscribe, so an effect can return it directly. */
export function onDealsChanged(fn) {
  dealWatchers.add(fn);
  return () => { dealWatchers.delete(fn); };
}

/** Announce a write. Copied before iterating — a listener may unsubscribe. */
export function dealsChanged() {
  for (const fn of [...dealWatchers]) {
    try { fn(); } catch { /* one bad listener must not stop the others */ }
  }
}

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Could this path segment be a record id at all?
 *
 * A typed or truncated URL must not become a request. `GET /deals/{deal_id}`
 * declares `deal_id: UUID` (routers/graha.py:1065), so a malformed one is a
 * FastAPI 422 — which `errorKind` reads as `request`, "That request wasn't
 * accepted", a sentence about something the reader submitted when they only
 * followed a bad link. Checked in the browser, they get "this doesn't exist"
 * and a way back instead, and the server is never asked.
 */
export const isRecordId = v => typeof v === 'string' && RECORD_ID.test(v.trim());

/** A rejection shaped like the 404 the server would have sent. */
export const notFound = () => ({ response: { status: 404 } });
