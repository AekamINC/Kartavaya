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
import LotusK from '../components/brand/LotusK';

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
 * The mark. TWO figures, chosen by how much room there is.
 *
 * Owner, 2026-08-07, third and settled: "lotus logo as logo and half lotus for
 * favicon and small place but where possible i loved to have full lotus …
 * and login page needs to be bigger for sure, full size."
 *
 * So the full lotus — `Lotus`, held still, the same drawing that animates the
 * loader and that `kamal.js` draws the Sanvaad conversation ground from — is the
 * logo wherever it has room. `LotusK`, the half lotus that reads as a K, takes
 * the places it does not: the favicon, and any chip small enough that sixty
 * petals become a smudge.
 *
 * THE THRESHOLD IS A FIGURE SIZE, NOT A CHIP SIZE. What decides whether the
 * lotus resolves is how many pixels the DRAWING gets, so `LOTUS_MIN_FIGURE` is
 * 40 — the point below which even a two-course rosette stops reading as separate
 * petals and becomes a ring — and the chip size that satisfies it falls out of
 * the inset. Writing it the other way round meant the threshold silently moved
 * every time the inset changed.
 *
 * THE PADDING IS 5px, FIXED — not a ratio. The owner: "use full space for lotus
 * only 5px padding." A ratio looks even on a 128px chip and leaves the 56px one
 * looking half empty, because the eye reads the GAP and not the proportion. Five
 * pixels a side is the same visible breathing room at every size, which is what
 * "only very minor to keep it clean" actually asks for.
 *
 * The lotus keeps its course-dropping: sixty petals in a 260 viewbox is a
 * smudge at anything under about 96px, so the mark draws fewer courses of the
 * SAME figure as it shrinks, and widens the pen to match. That only works
 * because every course is the same stroke — "one pen", Lotus.jsx.
 */
const PAD = 5;             // px a side, at every size
const PAD_K = 3;           // the K's own 24-box already carries ~15% of margin
const LOTUS_MIN_FIGURE = 40;

/** Courses and pen for a lotus drawn at `px`, in its 260 viewbox. */
function lotusDetail(px) {
  if (px >= 88) return { courses: 4, pen: 1.6 };
  if (px >= 64) return { courses: 3, pen: 2.4 };
  return { courses: 2, pen: 3.6 };
}

export function KLogo({ size = 32 }) {
  const inner = Math.max(8, size - PAD * 2);
  const full = inner >= LOTUS_MIN_FIGURE;
  const { courses, pen } = lotusDetail(inner);
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.26, background: K.grad,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {/* `color` and not a `stroke` prop: both figures paint `currentColor`.
          --on-primary, not white — the accent gradient can be light (Saffron,
          Amber) and a white mark on it is under 2:1. */}
      {full ? (
        /* क IN THE EYE, exactly as `BrandLoader` draws it. Owner: "'k' needs to
           be part of lotus same as loader."

           It is not decoration on top of the figure — Lotus.jsx's own docblock
           records that the eye was opened from r11 to r32 FOR this letter:
           "the letter is sized first and the drawing makes room, rather than the
           other way round." A lotus without it is the ornament with a hole in
           the middle where the mark should be.

           0.179 is the same ratio the loader uses — r32 of a 260 box — so the
           letter lands inside the eye at every size instead of through the ring.
           `.k-mark` positions it; the loader's own `.bl__ka` cannot be reused
           because it hard-codes 30px for a 168px figure. */
        <span className="k-mark">
          <Lotus still size={inner} courses={courses} pen={pen}
                 style={{ color: 'var(--on-primary)' }} />
          <span className="k-mark__ka" lang="hi" aria-hidden="true"
                style={{ fontSize: Math.round(inner * 0.179), color: 'var(--on-primary)' }}>क</span>
        </span>
      ) : (
        <LotusK size={Math.max(8, size - PAD_K * 2)} style={{ color: 'var(--on-primary)' }} />
      )}
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
