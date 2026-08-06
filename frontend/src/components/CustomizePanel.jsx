import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { deriveAccentColors, deriveContainer } from '../lib/accent';
import {
  DEFAULT_CONV_PATTERN, DEFAULT_CONV_GROUND,
  normalizeConvPattern, normalizeConvGround,
} from '../lib/convGround';

const STORAGE_KEY = 'k_prefs';

/* 00-tokens.md §10 — 12 presets. Only `color` is stored; mid/deep/light are
   derived, so a custom hex behaves identically to a preset. The first four
   ids are unchanged so stored preferences keep resolving. */
export const ACCENTS = [
  { id: 'teal',    label: 'Teal',    color: '#05b7aa' },
  { id: 'blue',    label: 'Blue',    color: '#3b82f6' },
  // The id stays `saffro` so preferences stored before the rename keep
  // resolving; the LABEL is what the user reads, and it is "Saffron". The grid
  // used to print the id, so one of the twelve presets was called "SAFFRO".
  { id: 'saffro',  label: 'Saffron', color: '#f59e0b' },
  { id: 'indigo',  label: 'Indigo',  color: '#6366f1' },
  { id: 'rose',    label: 'Rose',    color: '#e11d63' },
  { id: 'emerald', label: 'Emerald', color: '#059669' },
  { id: 'amber',   label: 'Amber',   color: '#d97706' },
  { id: 'violet',  label: 'Violet',  color: '#7c3aed' },
  { id: 'coral',   label: 'Coral',   color: '#f2643c' },
  { id: 'slate',   label: 'Slate',   color: '#64748b' },
  { id: 'crimson', label: 'Crimson', color: '#be123c' },
  { id: 'forest',  label: 'Forest',  color: '#3f6212' },
];

/* --font-display and --font-ui are two independent settings, so they get two
   lists (00 §2). One combined FONTS list is what made `SANS_IDS` look
   reasonable: with a single list you need a rule to decide which half a pick
   belongs to, and that rule set --font-ui to the display face in both arms of
   its own condition. Two lists need no rule. */
export const DISPLAY_FONTS = [
  { id: 'newsreader',       label: 'Newsreader',       sub: 'editorial', value: "'Newsreader', 'Georgia', serif" },
  { id: 'spectral',         label: 'Spectral',         sub: 'literary',  value: "'Spectral', 'Georgia', serif" },
  { id: 'instrument-serif', label: 'Instrument Serif', sub: 'modern',    value: "'Instrument Serif', 'Georgia', serif" },
  { id: 'playfair',         label: 'Playfair Display', sub: 'elegant',   value: "'Playfair Display', 'Georgia', serif" },
  { id: 'lora',             label: 'Lora',             sub: 'readable',  value: "'Lora', 'Georgia', serif" },
  { id: 'inter',            label: 'Inter',            sub: 'clean',     value: "'Inter', system-ui, sans-serif" },
  { id: 'dm-sans',          label: 'DM Sans',          sub: 'geometric', value: "'DM Sans', system-ui, sans-serif" },
  { id: 'poppins',          label: 'Poppins',          sub: 'friendly',  value: "'Poppins', system-ui, sans-serif" },
  { id: 'source-sans',      label: 'Source Sans 3',    sub: 'technical', value: "'Source Sans 3', system-ui, sans-serif" },
];

/* Written out rather than filtered off DISPLAY_FONTS, so the two can diverge:
   a face can be offered for the interface without also being offered for
   headings, which is what "independent" means.

   Four, not the six the handover asks for, and deliberately so: index.html
   loads exactly these families up front. A row that offers a face the page has
   not loaded renders in the system font — precisely the failure the specimen
   rows exist to replace, so the picker would be lying about two of its six
   options. Add the families to index.html first, then add them here. */
export const UI_FONTS = [
  { id: 'inter',       label: 'Inter',         sub: 'clean',     value: "'Inter', system-ui, sans-serif" },
  { id: 'dm-sans',     label: 'DM Sans',       sub: 'geometric', value: "'DM Sans', system-ui, sans-serif" },
  { id: 'poppins',     label: 'Poppins',       sub: 'friendly',  value: "'Poppins', system-ui, sans-serif" },
  { id: 'source-sans', label: 'Source Sans 3', sub: 'technical', value: "'Source Sans 3', system-ui, sans-serif" },
];

/* Standalone hi/gu were dropped as interface languages; the four bilingual
   options remain (decided 2026-07-25, ledger §4). A value stored before that
   change must fall through to its bilingual equivalent rather than render the
   raw key — data-language="hi" matches no stylesheet rule and reads as a
   missing translation. */
const LANGUAGES = new Set(['en', 'en+sa', 'en+hi', 'en+gu']);
const LANG_FALLBACK = { hi: 'en+hi', gu: 'en+gu' };
export function normalizeLanguage(lang) {
  if (LANGUAGES.has(lang)) return lang;
  return LANG_FALLBACK[lang] || 'en+sa';
}

export const DEFAULTS = {
  mode:         'light',      // light | dark | system
  accent:       'teal',
  customAccent: null,
  sidebar:      'wide',
  // `cozy`, not `comfy`. The rendered harness carries data-density="cozy" and
  // `design-reference/…/App.jsx:3` defaults to it; `comfy` is the LOOSEST of the
  // three tiers, not the middle one. Shipping `comfy` as the default put every
  // page one tier looser than the design — --pad-page 32px against 28px, and
  // that token is the topbar's padding and .kv__content's padding everywhere.
  density:      'cozy',       // compact | cozy | comfy
  font:         'newsreader', // display face
  uiFont:       'inter',      // body face — independent of `font` (00 §2)
  fontSize:     14,           // 12 → 20
  lineHeight:   1.5,          // 1.3 | 1.5 | 1.7
  // 12, measured off the harness (`App.jsx:3` radius: 12, and `Chrome.jsx:190`
  // is a slider 8→28 step 2). The presets in TabLayout moved to 8 | 12 | 20 to
  // match, so the default is still one of the options and every option sits
  // inside the reference's range.
  radius:       12,           // 8 | 12 | 20 — default IS one of the options
  anim:         'full',       // full | reduced | none
  language:     'en+sa',
  sideBg:       'dark',       // dark | light | accent
  toastPos:     'tr',         // tl | tr | bl | br
  // The conversation ground (28 §6, 29 §5) — two independent axes for the two
  // surfaces where you talk rather than work. `jaali` + `warm` is the
  // prototype's own default, so a user who never opens the setting gets the
  // design as drawn. Values and normalisers live in lib/convGround.js.
  //
  // No migration flag and no backend column. loadPrefs spreads
  // `{ ...DEFAULTS, ...stored }`, so an absent key falls through to the default
  // for every existing user — the same per-device, localStorage-only model
  // accent, density, sideBg and toastPos already use.
  convPattern:  DEFAULT_CONV_PATTERN, // none | jaali | patola | star | lines
  convGround:   DEFAULT_CONV_GROUND,  // warm | paper | deep | accent
  // The three link slots in the bottom bar, as `to` paths. The bar has five
  // slots: three chosen here, plus the ＋ and More, which are structural — More
  // is the only route back to the other thirty destinations and the bar cannot
  // give it away.
  //
  // `null` means "not chosen yet", which is NOT the same as an empty bar: an
  // empty array is a deliberate choice and must survive a reload. Absent falls
  // back to the shipped default below.
  //
  // Why this is a preference at all: the right three differ per person, not per
  // product. Sales reach for CRM and Sales hourly; a site supervisor wants
  // Attendance; an accountant wants Finance. Any fixed set is wrong for most of
  // the firm, and the owner asked for arrangement rather than a guess.
  mobileNav:    null,         // e.g. ['/dashboard', '/graha', '/vikray']
  // No `dnd` / `dndFrom` / `dndTo` here, against 09 §5. Quiet hours are not a
  // local preference: the backend already stores `quiet_start` / `quiet_end` on
  // notification_prefs and services/push_service.py refuses delivery inside the
  // window. Mirroring them into localStorage would be a second copy that no
  // sender reads, so the schedule would appear set and change nothing on the
  // devices it exists to silence. TabNotifications reads and writes the real one.
};

/* The accent maths now lives in `lib/accent.js`, moved there unchanged so a
   plain Node script can import it — `scripts/check-accent-contrast.mjs` could
   not reach it while it sat behind this file's `import React`, and one of the
   24 foreground/background pairs it produces measured 1.96:1. Re-exported
   here so every existing import of `deriveAccentColors` keeps resolving.
   Imported AND re-exported, not `export { x } from` — the bare re-export form
   creates no local binding, so `accentFor` below would have been a
   ReferenceError at the first render. */
export { deriveAccentColors };

/** Resolve the active accent to its derived values. */
function accentFor(prefs) {
  const hex = prefs.customAccent
    || (ACCENTS.find(a => a.id === prefs.accent) || ACCENTS[0]).color;
  return deriveAccentColors(hex);
}

/**
 * One-time migration for the two settings whose VALUE SET changed.
 *
 * `setPrefs` persists the WHOLE prefs object, so anyone who ever changed any
 * setting — theme, accent, anything — has the old defaults frozen in storage.
 * Changing DEFAULTS alone fixes new installs and leaves every existing user
 * behind, which is most of the point of both changes.
 *
 * DENSITY: `comfy` → `cozy`. `comfy` is the LOOSEST of the three tiers, not the
 * middle one, and the design is drawn at cozy.
 *
 * RADIUS: the options moved from `4 | 10 | 20` to `8 | 12 | 20` when the scale
 * was matched to the harness. A stored `4` or `10` now matches NO option, so
 * the control renders with nothing selected and the user's corners are stuck at
 * a value they cannot see or change. Each old value maps to its nearest new
 * one. `20` was in both sets and is left alone.
 *
 * The honest cost, for both: someone who deliberately chose the old value is
 * moved once. Reversible in two clicks, and the flag means their next choice
 * sticks for good. There is no version of this that touches only the users who
 * never chose — a default and a deliberate choice are the same bytes in storage.
 */
const PREFS_MIGRATION_FLAG = 'kv.densityCozyMigrated';
const RADIUS_REMAP = { 4: 8, 10: 12 };

function migrateStoredPrefs(stored) {
  try {
    if (localStorage.getItem(PREFS_MIGRATION_FLAG)) return stored;
    localStorage.setItem(PREFS_MIGRATION_FLAG, '1');

    const next = { ...stored };
    let changed = false;

    if (stored.density === 'comfy') { next.density = 'cozy'; changed = true; }
    if (RADIUS_REMAP[stored.radius])  { next.radius  = RADIUS_REMAP[stored.radius]; changed = true; }

    if (!changed) return stored;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch { return stored; }
}

function loadPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...migrateStoredPrefs(stored) };
  }
  catch { return { ...DEFAULTS }; }
}

export function systemPrefersDark() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyPrefs(prefs) {
  const root = document.documentElement;
  const acc  = accentFor(prefs);
  const fnt  = DISPLAY_FONTS.find(f => f.id === prefs.font) || DISPLAY_FONTS[0];

  // Resolve `system` to a concrete value. The previous version wrote
  // prefs.mode straight through, so mode 'system' produced
  // [data-theme="system"], which matches no rule — system mode silently
  // rendered light. Must be set BEFORE the accent below, which reads it.
  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && systemPrefersDark());
  root.setAttribute('data-theme', dark ? 'dark' : 'light');

  // ── Accent ───────────────────────────────────────────────────────────────
  root.style.setProperty('--k-primary', acc.color);
  root.style.setProperty('--k-mid',     acc.mid);
  root.style.setProperty('--k-deep',    acc.deep);
  root.style.setProperty('--k-grad',  `linear-gradient(135deg, ${acc.deep}, ${acc.mid} 55%, ${acc.color})`);
  root.style.setProperty('--k-gradD', `linear-gradient(135deg, ${acc.deep}cc, ${acc.mid}cc 55%, ${acc.color}cc)`);
  root.style.setProperty('--side-active', `${acc.color}29`);

  // The accent must reach --primary, or picking one restyles the k-* layer
  // and leaves every new component on the default teal. Hover reverses
  // direction by theme — darker in light, lighter in dark — which is why
  // this function must re-run on theme change, not only on preference change.
  root.style.setProperty('--primary',       dark ? acc.color : acc.mid);
  root.style.setProperty('--primary-hover', dark ? acc.light : acc.deep);
  root.style.setProperty('--primary-vivid', acc.color);

  // --primary-text carries any primary-coloured TEXT, because --primary is a
  // fill at 4.04:1 and fails as text (00 §7). Dark aliases --primary, which
  // clears AA at every size; light uses the measured value. Without this line
  // each of the twelve presets is an unmeasured contrast risk — the accent is
  // user-configurable, so a token that is safe at the default teal says nothing
  // about the other eleven.
  root.style.setProperty('--primary-text', dark ? acc.color : acc.text);

  // --on-primary is the LABEL on the fill the three lines above just changed.
  // It was the one half of the pair that never moved: declared once per theme
  // (#FFFFFF light, #00332F dark) and asked to partner twelve hues. Measured
  // against the fill each preset actually produces, dark failed 10 of 12 —
  // worst 1.96:1 on Forest — because #00332F is a near-black TEAL that only
  // ever suited a teal accent. Light failed 3 of 12, and that includes the
  // shipped default: every earlier report measured white against the
  // stylesheet's --primary #04837A and got 4.63, but this function overwrites
  // --primary with acc.mid = #00897f, where white is 4.30.
  // deriveOnAccent picks the label, with the incumbent in its own candidate
  // set so it can never return something worse than what shipped.
  root.style.setProperty('--on-primary', dark ? acc.onDark : acc.onLight);

  // --primary-container and its label were the last two accent tokens still
  // hardcoded. The stylesheet declares them once per theme as teal (#B4F1E8 /
  // #00514B) and nothing here overwrote them, so picking any of the other
  // eleven accents left THIRTY-EIGHT rules on the default hue — `.btn--tonal`,
  // the active module chip, onboarding selections, board columns, the client
  // portal header and `.note--info` among them.
  //
  // Measured live 2026-07-31: Crimson selected, --primary #be123c,
  // --primary-container still #B4F1E8. A crimson app with teal tonal buttons.
  const con = deriveContainer(acc.color);
  root.style.setProperty('--primary-container', dark ? con.dark : con.light);
  root.style.setProperty('--on-primary-container', dark ? con.onDark : con.onLight);

  // ── Type ─────────────────────────────────────────────────────────────────
  // --font-display and --font-ui are independent. The old SANS_IDS check set
  // --font-ui to the display font in BOTH arms of its own condition, so
  // picking Newsreader turned every label, table cell and button serif.
  const ui = UI_FONTS.find(f => f.id === prefs.uiFont) || UI_FONTS[0];
  root.style.setProperty('--font-display', fnt.value);
  root.style.setProperty('--font-ui',      ui.value);
  document.body.style.fontFamily = 'var(--font-ui)';

  const fs = Math.max(12, Math.min(20, prefs.fontSize || 14));
  root.style.setProperty('--font-size-base', fs + 'px');
  root.style.setProperty('--line-height-base', String(prefs.lineHeight || 1.5));
  document.body.style.fontSize = 'var(--t-body)';

  // ── Shape and motion ────────────────────────────────────────────────────
  root.style.setProperty('--radius-base', (prefs.radius || 10) + 'px');

  // --ix-user, NOT --ix. An inline style on the root outranks a media query,
  // so writing --ix directly let this preference silently defeat the OS
  // prefers-reduced-motion setting. CSS does --ix: var(--ix-user) and the
  // media query overrides --ix, so the OS always wins.
  root.style.setProperty('--ix-user',
    prefs.anim === 'none' ? '.001' : prefs.anim === 'reduced' ? '.5' : '1');

  // Distance is a separate scale from time: at 'none' the right travel is 0,
  // where the right duration is .001 rather than 0 (a zero-duration animation
  // never fires animationend, so any handler that unmounts on exit-complete
  // leaks its node).
  //
  // --motion-scale-user, NOT --motion-scale — the same rule as --ix-user above,
  // and it was broken here on this half of the pair. Writing --motion-scale
  // directly put it in the root's inline style, which outranks a media query,
  // so `--motion-scale: 0` in kartavaya-design.css's prefers-reduced-motion
  // block had never once applied: an OS-level reduce-motion user still got full
  // travel on every reveal, lift, stagger and slide. CSS now does
  // --motion-scale: var(--motion-scale-user) and the media query owns
  // --motion-scale, so the OS setting wins.
  root.style.setProperty('--motion-scale-user',
    prefs.anim === 'none' ? '0' : prefs.anim === 'reduced' ? '.5' : '1');

  // NOTE: the block that set --bg / --surface / --ink / --rule per theme as
  // inline styles is deliberately gone (00 §11). Those live in CSS under
  // [data-theme]; as inline styles they outranked the stylesheet, so the new
  // palette would never have rendered at all.

  root.setAttribute('data-density',  prefs.density);
  root.setAttribute('data-sidebar',  prefs.sidebar);
  root.setAttribute('data-language', normalizeLanguage(prefs.language));
  if (prefs.sideBg)  root.setAttribute('data-sidebar-bg', prefs.sideBg);
  if (prefs.toastPos) root.setAttribute('data-toast-pos', prefs.toastPos);

  // UNCONDITIONAL, unlike the two guarded lines above, and normalised on the
  // way out. Written every time, the `[data-conv-pattern="…"]` variant rule
  // always matches, which is what makes the :root default in
  // kartavaya-design.css § 10 provably a floor rather than a live value.
  // Normalised because a value stored by an older build survives forever, and
  // an attribute that matches no rule is silent — the data-language="hi" bug
  // this file already documents, in a second place.
  root.setAttribute('data-conv-pattern', normalizeConvPattern(prefs.convPattern));
  root.setAttribute('data-conv-ground',  normalizeConvGround(prefs.convGround));

  const lang = normalizeLanguage(prefs.language);
  // The Devanagari faces are appended AFTER the Gujarati ones, and that tail is
  // load-bearing rather than defensive.
  //
  // 24-bilingual-devanagari.md assigns --font-indic to every label that
  // "follows the user's language" — stat labels, drawer labels, the weekday
  // strip, palette rows, module headers — and ~25 rules follow it. But there is
  // no translation layer: navConfig.js (the sidebar and the two bottom navs) is
  // the ONLY source of `gu` strings in the codebase. Every other --font-indic
  // consumer renders a HARDCODED Devanagari literal that does not change with
  // the setting.
  //
  // Measured in the browser: Noto Sans Gujarati has ZERO Devanagari coverage.
  // So under EN+GU those ~25 surfaces were handing Devanagari to a font that
  // cannot draw it, and every one of them fell through to the OS face — a
  // different family, ~7.5% wider than Tiro, mixed per glyph.
  //
  // Appending the Devanagari stack fixes all of them at one point instead of
  // rewriting 25 rules: Gujarati still resolves to Noto Sans Gujarati first
  // (24's intent, and correct for the sidebar, which genuinely switches
  // script), while Devanagari that never switched now lands on Tiro. A generic
  // must NOT appear before the Devanagari entries or it would capture the
  // script first, which is why 'sans-serif' moved to the end.
  root.style.setProperty('--font-indic',
    lang === 'en+gu'
      ? "'Noto Sans Gujarati', 'Shruti', 'Tiro Devanagari Hindi', 'Nirmala UI', 'Kohinoor Devanagari', sans-serif"
      : 'var(--font-hindi)');
}

const CustomizeCtx = createContext(null);

export function CustomizeProvider({ children }) {
  const [prefs, setPrefsState] = useState(loadPrefs);

  const setPrefs = useCallback((patch) => {
    setPrefsState(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      applyPrefs(next);
      return next;
    });
  }, []);

  useEffect(() => { applyPrefs(prefs); }, []); // eslint-disable-line

  // `system` is a live subscription, not a boot-time read (00 §11). Without
  // this, a user on system mode who switches their OS to dark keeps a light
  // app until the next full reload.
  useEffect(() => {
    if (prefs.mode !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPrefs(prefs);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs]);

  return (
    <CustomizeCtx.Provider value={{ prefs, setPrefs }}>
      {children}
    </CustomizeCtx.Provider>
  );
}

export function useCustomize() {
  const ctx = useContext(CustomizeCtx);
  if (!ctx) throw new Error('useCustomize must be inside CustomizeProvider');
  return ctx;
}

/* The `Seg`, `SectionHead` and `Row` helpers that used to close this file are
   gone. They had no importers left after the hub moved to customize/*, and all
   three were inline style objects on the retired vocabulary — --bg-soft,
   --surface-2, --ink, --ink-2, --ink-3, --k-primary. They resolved only through
   the alias block in kartavaya-design.css, so they were dead code holding six
   alias lines alive. Seg lives at components/customize/Seg.jsx, on .seg. */
