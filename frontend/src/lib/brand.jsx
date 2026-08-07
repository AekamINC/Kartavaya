/**
 * Brand tokens, logo, wordmark, role badge — shared across all layouts.
 *
 * 00-tokens.md §9 retires the legacy brand blue #0082c6. This file was the
 * last place it was still declared as a value rather than described in a
 * comment: `K.blue`, and the two gradients built from it (`K.grad`, `K.gradD`)
 * which `KLogo` painted on every mark in the product — the app loading splash,
 * the marketing nav and the marketing footer.
 *
 * Everything below now reads the CSS token layer, which means:
 *   · the mark follows the user's chosen accent (12 presets + custom) instead
 *     of being blue for everyone, and
 *   · it follows the theme. `K.dark` (#050e1a) was the wordmark colour in the
 *     light arm; against the dark palette's --s-lowest (#080A0C) that is
 *     1.03:1 — the word "Kartavaya" simply disappeared in the footer.
 *
 * `K` is kept and exported because it is a public name, but every value is a
 * var() reference now. Nothing in src/ imports `K` itself — only KLogo and
 * KWordmark — so a consumer reaching for `K.blue` would already have been
 * reaching for a retired colour.
 */
import React from 'react';
import Lotus from '../components/brand/Lotus';

export const K = {
  /* --k-* are the runtime accent trio applyPrefs writes; they fall back to the
     static teal in kartavaya-design.css before JS runs. `blue` is deliberately
     absent — 00 §9 retires it. */
  mid:   'var(--k-mid)',
  teal:  'var(--primary-vivid)',
  dark:  'var(--on-surface)',
  card:  'var(--surface)',
  grad:  'var(--k-grad)',
  gradD: 'var(--k-grad)',
};

/**
 * How many of the lotus's four courses the mark draws, and how wide its pen is,
 * at a given rendered size.
 *
 * The full figure is sixty petals and four rings inside a 260 viewbox. At the
 * 28px the marketing nav uses, all four courses land about a third of a pixel
 * apart and the mark is a smudge — so it DROPS COURSES rather than shrinking an
 * unreadable one. Same drawing, fewer courses, which is only possible because
 * every course is the same stroke ("one pen", Lotus.jsx).
 *
 * The pen widens as the figure loses courses for the same reason: 1.6 in a 260
 * viewbox is right at 168px and invisible at 28.
 */
function markDetail(size) {
  if (size >= 96) return { courses: 4, pen: 1.6 };   // splash, marketing hero
  if (size >= 56) return { courses: 3, pen: 2.6 };   // auth shell
  if (size >= 30) return { courses: 2, pen: 4.5 };   // sidebar, approve/sign
  return { courses: 1, pen: 7 };                     // nav, footer, favicon
}

/**
 * The mark: the loader's lotus, held at full.
 *
 * Owner, 2026-08-07 — "use that loader full loaded images and convert to logo…
 * and keep loader as well as it is for animations while loading". So this is
 * the SAME component in its `still` state, not a second drawing: `Lotus` owns
 * `lobe()`, `COURSES` and `EYE_R`, `kamal.js` already draws the conversation
 * ground from them, and now the mark does too. Retuning a petal moves all three
 * together, which is the whole reason 28-messaging-v2.md §6 forbids redrawing
 * `lotusLobe()`.
 *
 * What it replaced was neither a K nor a lotus — two nested diamonds.
 */
export function KLogo({ size = 32 }) {
  const { courses, pen } = markDetail(size);
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: K.grad,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {/* `color` and not a `stroke`: `.lotus__s` paints `currentColor`, so the
          figure inherits it. --on-primary, not white — the accent gradient can
          be light (Saffron, Amber) and a white mark on it is under 2:1. */}
      <Lotus
        still
        size={size * 0.72}
        courses={courses}
        pen={pen}
        style={{ color: 'var(--on-primary)' }}
      />
    </div>
  );
}

/**
 * `dark` means "this wordmark sits on the dark ink chrome" (the sidebar), not
 * "the app is in dark mode" — that arm keeps a fixed light foreground because
 * rgb(var(--side-ink)) is dark in BOTH themes (00 §7/§8). The default arm
 * follows the surface it is on and therefore flips with the theme.
 */
export function KWordmark({ dark = false, size = 'md' }) {
  const fs  = size === 'sm' ? 11 : 14;
  const sub = size === 'sm' ? 7  : 8;
  return (
    <div>
      <div style={{ fontSize: fs, fontWeight: 800, letterSpacing: 2.5, textTransform: 'uppercase',
        color: dark ? 'var(--side-fg)' : 'var(--on-surface)' }}>Kartavaya</div>
      <div style={{ fontSize: sub, letterSpacing: 2.5, textTransform: 'uppercase',
        color: dark ? 'var(--side-fg-mute)' : 'var(--primary-text)', fontWeight: 700, marginTop: 1 }}>by Aekam Inc</div>
    </div>
  );
}

/**
 * 00 §11: a token may sit behind text only if it has a declared `on-` partner,
 * and a chip tinted with its own foreground hue cannot be relied on to clear
 * 4.5:1 — deepening the tint moves the ground toward the text. The four role
 * badges were `#0082c622`/`#0082c6`, `#05b7aa22`/`#05b7aa`,
 * `#8b5cf622`/`#8b5cf6` and `#88888822`/`#888`: four self-tints, three retired
 * literals, none of which flip. They map onto container pairs instead, which
 * are the only legal text grounds in the system and exist in both themes.
 */
export function RoleBadge({ role }) {
  const cfg = {
    admin:  { bg: 'var(--primary-container)',   color: 'var(--on-primary-container)',   label: 'Admin' },
    member: { bg: 'var(--secondary-container)', color: 'var(--on-secondary-container)', label: 'Member' },
    client: { bg: 'var(--tertiary-container)',  color: 'var(--on-tertiary-container)',  label: 'Client' },
  }[role] || { bg: 'var(--s-high)', color: 'var(--on-surface-2)', label: role };
  return (
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase',
      background: cfg.bg, color: cfg.color, padding: '3px 8px', borderRadius: 'var(--r-sm)', whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}
