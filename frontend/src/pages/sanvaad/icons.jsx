/**
 * icons.jsx — the chrome glyphs Sanvaad and Varta need.
 *
 * `06-sanvaad-varta.md` §Plus says: "Emoji used as interface: 💬 for DMs, 🔒 for
 * private channels, a 48px 💬 as the empty-state illustration, 💬 on the thread
 * button, 🕐 ✓ ✓✓ ✕ for delivery state, ✕ as the close control. Replace all with
 * navIcons.jsx. The five quick reactions (👍 ✅ 👀 ❤️ 😂) are content, not
 * chrome — those stay."
 *
 * `components/layout/navIcons.jsx` carries `close`, `search`, `plus`, `users`
 * and `chevL`, which are reused below. It has none of the eight declared
 * locally — `hash`, `wa`, `lock`, `chat`, `reply`, `smile`, `send`, `down` —
 * and that file belongs to `01-navigation.md`, not to this module. They live
 * here until its owner folds them in; when that happens, delete the eight and
 * import the same names.
 *
 * `WaTicks`, `WA_STATUS_LABEL` and `ChatArt` stay here either way: a delivery
 * receipt and a conversation illustration are this surface's vocabulary, not
 * the navigation's.
 */
import React from 'react';
import { ICONS } from '../../components/layout/navIcons';

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const SvIcons = {
  /** Public channel — the # that every chat product uses for a room. */
  hash: <svg width="15" height="15" viewBox="0 0 16 16" {...s}><path d="M6 2L4.5 14M11.5 2L10 14M2.5 5.5h11M2 10.5h11" /></svg>,
  /**
   * The glyph on a `type='system'` row. `MESSAGING-ATTENDANCE-SPEC.md:20` asks
   * for "a module glyph"; `ScreensSanvaad.jsx` reaches per-module icons through
   * `MOD_GLYPH`, which this build has no equivalent of, so one mark stands for
   * "this came from a module" and the module's own accent and name carry which.
   */
  bolt: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M8.8 1.5L3.5 9h4l-.3 5.5L12.5 7h-4l.3-5.5z" /></svg>,
  /**
   * WhatsApp. `00-tokens.md` §9 declares `--wa-green` as a genuinely fixed
   * literal — "WhatsApp brand" — and nothing in this module was using it, so
   * the token had no call site at all. The glyph is `ScreensVarta.jsx`'s `SI.wa`
   * and is filled, not stroked, because a brand mark is a shape.
   */
  wa: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2a8 8 0 00-6.9 12L2 18l4.1-1.1A8 8 0 1010 2zm0 1.6a6.4 6.4 0 013.1 12 6.4 6.4 0 01-3.1.8 6.4 6.4 0 01-3.3-.9l-.3-.2-2.4.6.6-2.3-.2-.4A6.4 6.4 0 0110 3.6zm-2.9 3c-.2 0-.4.1-.6.3-.2.2-.6.6-.6 1.4s.6 1.7.7 1.8c.1.1 1.2 1.9 3 2.6 1.5.6 1.8.5 2.2.4.4 0 1.1-.4 1.3-.9.2-.5.2-.9.1-1l-.6-.3-1-.5c-.2 0-.3 0-.4.1l-.6.7c-.1.1-.2.2-.4.1a4.5 4.5 0 01-1.4-.9 5 5 0 01-.9-1.2c-.1-.2 0-.3.1-.4l.4-.5.2-.4-.1-.3-.5-1.2c-.1-.3-.3-.3-.4-.3h-.5z" />
    </svg>
  ),
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
  /** A send that did not arrive — `ScreensVarta.jsx`'s `SI.alert`. */
  alert: <svg width="13" height="13" viewBox="0 0 20 20" {...s} strokeWidth="1.7"><path d="M10 3.4l7 12.2H3l7-12.2z" /><path d="M10 8v3.2M10 13.6v.1" /></svg>,
  /** The 24-hour window — `ScreensVarta.jsx`'s `SI.clock2`. */
  clock: <svg width="13" height="13" viewBox="0 0 20 20" {...s} strokeWidth="1.7"><circle cx="10" cy="10" r="7.2" /><path d="M10 6.2V10l2.6 1.8" /></svg>,
  /**
   * The hover tray's "More" — `ScreensSanvaad.jsx:157` uses `I.dots`, which
   * `Chrome.jsx:30` draws as three FILLED circles on a vertical axis in a
   * `0 0 20 20` box. `navIcons.jsx` has a `more`, but it is three horizontal
   * RULES (a burger), which reads as a nav drawer rather than a row overflow —
   * so this is the design's glyph, not that one.
   */
  dots: (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="10" cy="4.5" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="10" cy="15.5" r="1.5" />
    </svg>
  ),
  /** Edit, in the message overflow menu. */
  pencil: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M11 2.5l2.5 2.5-8 8H3v-2.5z" /><path d="M9.5 4l2.5 2.5" /></svg>,
  /** Delete, in the message overflow menu and on the tombstone. */
  trash: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /><path d="M7 7v4M9 7v4" /></svg>,
  /**
   * The read receipt. `ScreensSanvaad.jsx:14`'s `SI.eye` is a `0 0 20 20`
   * stroke eye; `navIcons.jsx`'s is the same shape in `0 0 16 16`, so that one
   * is reused rather than redrawn.
   */
  eye: ICONS.eye,
  /* ── Slack parity ───────────────────────────────────────────────────────
   *
   * In ONE file with ONE owner, because three separate agents need them and a
   * shared file edited from three directions is a merge conflict with extra
   * steps. They follow `s` above — the module's stroke preset — so a mention
   * `@` and a `#` sit at the same weight in the same row. `bold` is the single
   * exception and says why at its own line.
   */
  /** A mention. The rail badge, the mentions filter, the composer's trigger. */
  at: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><circle cx="8" cy="8" r="2.4" /><path d="M10.4 5.6v3.2a1.9 1.9 0 003.1 1.2A6.2 6.2 0 105.6 14" /></svg>,
  /** Pin. `ScreensSanvaad.jsx` has no pinned bar to take this from, so it is
   *  the conventional angled push-pin: head, shaft, and the point it stands on. */
  pin: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M9.6 1.8l4.6 4.6-1.7.6-1 2.6-4.7-4.7 2.6-1z" /><path d="M6.8 9.2L2.4 13.6" /></svg>,
  /** Unpin — the same shape struck through, so the two read as one control in
   *  two states rather than as two unrelated marks. */
  pinOff: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M9.6 1.8l4.6 4.6-1.7.6-1 2.6-4.7-4.7 2.6-1z" /><path d="M6.8 9.2L2.4 13.6" /><path d="M2 2l12 12" /></svg>,
  /** A muted channel. A bell with the same strike, for the same reason. */
  bellOff: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M4 6.5a4 4 0 018 0c0 3 1 4 1 4H3s1-1 1-4z" /><path d="M6.6 13a1.6 1.6 0 002.8 0" /><path d="M2 2l12 12" /></svg>,
  /* ── The composer's formatting strip ────────────────────────────────────
   *
   * Four marks for four buttons. `bold` and `code` were drawn for this strip
   * and shipped without it — `italic` and `codeBlock` are the two that were
   * missing, so the row could not be built out of what was here.
   */
  /** Inline code — the `` `x` `` pair. */
  code: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M5.6 4.4L2 8l3.6 3.6M10.4 4.4L14 8l-3.6 3.6" /></svg>,
  /**
   * The fenced block. The same chevrons, put in a box — the two controls sit
   * beside each other and are the same idea at two scales, so they have to read
   * as a pair rather than as two unrelated marks. The chevrons are shortened
   * rather than scaled so their stroke stays on the module's 1.4 preset.
   */
  codeBlock: (
    <svg width="14" height="14" viewBox="0 0 16 16" {...s}>
      <rect x="1.6" y="3" width="12.8" height="10" rx="1.6" />
      <path d="M6.5 6.8L5 8l1.5 1.2M9.5 6.8L11 8l-1.5 1.2" />
    </svg>
  ),
  /**
   * Bold. Drawn as a letter rather than stroked like the rest, because a `B`
   * built from 1.4px strokes is unreadable at 14px — the mark IS the glyph
   * here, which is the one place this file's preset is the wrong instrument.
   */
  bold: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4.6 2.6h4.1c1.9 0 3.1 1 3.1 2.6 0 1-.5 1.8-1.4 2.2 1.2.3 1.9 1.2 1.9 2.4 0 1.8-1.3 2.9-3.4 2.9H4.6V2.6zm2 4.2h1.8c.9 0 1.4-.4 1.4-1.1s-.5-1.1-1.4-1.1H6.6v2.2zm0 4.4h2c1 0 1.6-.4 1.6-1.2s-.6-1.2-1.6-1.2h-2v2.4z" />
    </svg>
  ),
  /**
   * Italic — a slanted stem between two serifs. This one IS stroked, unlike its
   * neighbour: a `B` needs counters to be a `B`, but an italic `I` is three
   * lines and drawing it as a filled letterform at 14px would make it heavier
   * than the bold beside it, which is the one comparison a reader makes here.
   */
  italic: <svg width="14" height="14" viewBox="0 0 16 16" {...s}><path d="M6.4 3.2h4.4M5.2 12.8h4.4M9.6 3.2L6.4 12.8" /></svg>,
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
 *
 * All five are drawn in a `0 0 14 10` viewBox because `06` §1 sizes the box
 * `width:14px;height:10px`. The previous set used `0 0 20 12` — aspect 1.667
 * into a 1.4 box — so `xMidYMid meet` scaled everything to 0.7 and letterboxed
 * it, and the five glyphs did not share a centre inside that viewBox: the
 * single tick sat at x-centre 8.5, the double at 8.25, the clock and the cross
 * at 10. The marker therefore JUMPED sideways as a message advanced
 * pending → sent → delivered → read, and every stroke rendered at 0.98px while
 * the rest of the module's icons are 1.31px.
 *
 * At 1:1 the strokes are the authored 1.6px and all five are centred on (7, 5),
 * so only the shape and the colour change. Geometry is `ScreensVarta.jsx`'s
 * `SI.tick1` / `tick2` / `clock2` / `alert`, scaled uniformly.
 */
const t = { ...s, strokeWidth: 1.6 };

export const WaTicks = {
  pending: <svg className="wa__tick" viewBox="0 0 14 10" {...t} aria-hidden="true"><circle cx="7" cy="5" r="3.6" /><path d="M7 3.1V5l1.3.9" /></svg>,
  sent: <svg className="wa__tick" viewBox="0 0 14 10" {...t} aria-hidden="true"><path d="M3 5.4l2.5 2.5L11 2.1" /></svg>,
  delivered: <svg className="wa__tick" viewBox="0 0 14 10" {...t} aria-hidden="true"><path d="M1.7 5.4l2.5 2.5L9.8 2.1M5.9 7.4l.5.5L12.3 2.1" /></svg>,
  read: <svg className="wa__tick wa__tick--read" viewBox="0 0 14 10" {...t} aria-hidden="true"><path d="M1.7 5.4l2.5 2.5L9.8 2.1M5.9 7.4l.5.5L12.3 2.1" /></svg>,
  /* An ✕ was the old glyph. `ScreensVarta.jsx` uses `SI.alert` for `failed` —
     a cross reads as "cancelled by you", a warning triangle as "this did not
     arrive", and only one of those is what a Meta rejection means. */
  failed: <svg className="wa__tick wa__fail" viewBox="0 0 14 10" {...t} aria-hidden="true"><path d="M7 1.9l3.5 6.1H3.5z" /><path d="M7 4.3v1.6M7 7v.05" /></svg>,
};

/** Human labels for the five, used for the tick's accessible name. */
export const WA_STATUS_LABEL = {
  pending: 'Pending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
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
