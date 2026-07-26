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

export function KLogo({ size = 32 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: K.grad,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {/* The glyph paints --on-primary, not white: the accent gradient can be
          light (Saffron, Amber) and a white mark on it is under 2:1. */}
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 22 22" fill="none">
        <path d="M4 11L11 4L18 11L11 18L4 11Z" stroke="var(--on-primary)" strokeWidth="1.8"/>
        <path d="M7.5 11L11 7.5L14.5 11L11 14.5L7.5 11Z" fill="var(--on-primary)" opacity=".85"/>
      </svg>
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
