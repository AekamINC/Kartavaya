/**
 * icons.jsx — the chrome glyphs Sanvaad and Varta need.
 *
 * `06-sanvaad-varta.md` §Plus says: "Emoji used as interface: 💬 for DMs, 🔒 for
 * private channels, a 48px 💬 as the empty-state illustration, 💬 on the thread
 * button, 🕐 ✓ ✓✓ ✕ for delivery state, ✕ as the close control. Replace all with
 * navIcons.jsx. The five quick reactions (👍 ✅ 👀 ❤️ 😂) are content, not
 * chrome — those stay."
 *
 * `components/layout/navIcons.jsx` carries `close`, `search`, `plus` and `users`,
 * which are reused below. It has no channel hash, no lock, no chat bubble, no
 * reply arrow, no delivery ticks and no send arrow — and that file belongs to
 * `01-navigation.md`, not to this module. These live here until its owner folds
 * them in; when that happens, delete this file and import the same names.
 */
import React from 'react';
import { ICONS } from '../../components/layout/navIcons';

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const SvIcons = {
  /** Public channel — the # that every chat product uses for a room. */
  hash: <svg width="15" height="15" viewBox="0 0 16 16" {...s}><path d="M6 2L4.5 14M11.5 2L10 14M2.5 5.5h11M2 10.5h11" /></svg>,
  /** Private channel. */
  lock: <svg width="15" height="15" viewBox="0 0 16 16" {...s}><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>,
  /** Direct message. */
  chat: <svg width="15" height="15" viewBox="0 0 16 16" {...s}><path d="M14 9.5a2 2 0 01-2 2H6l-3.5 2.5V4a2 2 0 012-2h7.5a2 2 0 012 2v5.5z" /></svg>,
  /** Thread / reply. */
  reply: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M6 3L2.5 6.5 6 10" /><path d="M2.5 6.5H10a3.5 3.5 0 013.5 3.5v2.5" /></svg>,
  /** Add reaction. */
  smile: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><circle cx="8" cy="8" r="6" /><path d="M5.5 9.5a3 3 0 005 0" /><circle cx="6" cy="6.3" r=".8" fill="currentColor" stroke="none" /><circle cx="10" cy="6.3" r=".8" fill="currentColor" stroke="none" /></svg>,
  /** Composer send. */
  send: <svg width="16" height="16" viewBox="0 0 16 16" {...s} strokeWidth="1.6"><path d="M14 8L2.5 2.5l2 5.5-2 5.5L14 8z" /></svg>,
  /** Jump to latest. */
  down: <svg width="12" height="12" viewBox="0 0 16 16" {...s} strokeWidth="1.8"><path d="M8 3v9M4 8.5l4 4 4-4" /></svg>,
  /** Back, on the mobile two-pane swap. */
  back: ICONS.chevL,
  close: ICONS.close,
  search: ICONS.search,
  plus: ICONS.plus,
  users: ICONS.users,
};

/**
 * Delivery state. `delivered` and `read` are deliberately the same shape —
 * `06` §3: "the distinction in every messaging product is colour ... and it is
 * not implemented. A user cannot tell whether a customer has seen their
 * message." The colour lives in `.wa__tick--read`.
 */
export const WaTicks = {
  pending: <svg className="wa__tick" viewBox="0 0 20 12" {...s} aria-hidden="true"><circle cx="10" cy="6" r="4" /><path d="M10 4v2l1.4 1" /></svg>,
  sent: <svg className="wa__tick" viewBox="0 0 20 12" {...s} aria-hidden="true"><path d="M4 6.5l3 3 6-6.5" /></svg>,
  delivered: <svg className="wa__tick" viewBox="0 0 20 12" {...s} aria-hidden="true"><path d="M2 6.5l3 3 6-6.5M8.5 9.5l6-6.5" /></svg>,
  read: <svg className="wa__tick wa__tick--read" viewBox="0 0 20 12" {...s} aria-hidden="true"><path d="M2 6.5l3 3 6-6.5M8.5 9.5l6-6.5" /></svg>,
  failed: <svg className="wa__tick wa__fail" viewBox="0 0 20 12" {...s} aria-hidden="true"><path d="M6.5 2.5l7 7M13.5 2.5l-7 7" /></svg>,
};

/**
 * The empty-state illustration. `ui/EmptyState.jsx` ships eight, none of them a
 * conversation, and it falls back to `generic` silently for an unknown key — so
 * the node is passed explicitly rather than named. It replaces the 48px `💬`
 * the old page used (06 §Plus).
 */
export const ChatArt = (
  <svg width="52" height="52" viewBox="0 0 52 52" {...s} strokeWidth="1.6" aria-hidden="true">
    <path d="M45 28a6 6 0 01-6 6H19l-11 8V14a6 6 0 016-6h25a6 6 0 016 6v14z" />
    <path d="M18 18h16M18 25h10" />
  </svg>
);

/** The channel-type glyph, one place so the list and the header agree. */
export const channelIcon = type =>
  type === 'dm' ? SvIcons.chat : type === 'private' ? SvIcons.lock : SvIcons.hash;

export default SvIcons;
