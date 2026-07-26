import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';

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
  density:      'comfy',
  font:         'newsreader', // display face
  uiFont:       'inter',      // body face — independent of `font` (00 §2)
  fontSize:     14,           // 12 → 20
  lineHeight:   1.5,          // 1.3 | 1.5 | 1.7
  radius:       10,           // 4 | 10 | 20 — default IS one of the options
  anim:         'full',       // full | reduced | none
  language:     'en+sa',
  sideBg:       'dark',       // dark | light | accent
  toastPos:     'tr',         // tl | tr | bl | br
  // No `dnd` / `dndFrom` / `dndTo` here, against 09 §5. Quiet hours are not a
  // local preference: the backend already stores `quiet_start` / `quiet_end` on
  // notification_prefs and services/push_service.py refuses delivery inside the
  // window. Mirroring them into localStorage would be a second copy that no
  // sender reads, so the schedule would appear set and change nothing on the
  // devices it exists to silence. TabNotifications reads and writes the real one.
};

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.x relative luminance. */
function relLuminance(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}

/** Light `--bg` is #F3EFE6. Contrast is measured against the canvas, not the
 *  card on top of it — 00 §12, and the mistake that passed three tokens which
 *  failed on the page. */
const BG_LIGHT_LUM = relLuminance('#F3EFE6');

function contrastOnLightBg(hex) {
  const l = relLuminance(hex);
  const [hi, lo] = l > BG_LIGHT_LUM ? [l, BG_LIGHT_LUM] : [BG_LIGHT_LUM, l];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent value that primary-coloured TEXT uses in light mode.
 *
 * `--primary` itself is 4.04:1 on `--bg` at the default teal — a fill, never
 * text (00 §7, 23 §contrast table). `deep` is the right starting point, but
 * twelve presets ship plus arbitrary custom hex, so taking `deep` on trust
 * would leave each one an unmeasured contrast risk — which is exactly what 00
 * says this function must stop doing. So measure, and darken until it clears.
 *
 * Steps lightness down 2% at a time rather than solving directly: it keeps the
 * hue and saturation the preset was chosen for, and the loop is bounded.
 */
function deriveAccentText(h, s, l) {
  let lightness = Math.max(l - 20, 10);
  let hex = hslToHex(h, Math.min(s + 10, 100), lightness);
  while (contrastOnLightBg(hex) < 4.5 && lightness > 4) {
    lightness -= 2;
    hex = hslToHex(h, Math.min(s + 10, 100), lightness);
  }
  return hex;
}

export function deriveAccentColors(hex) {
  const [h, s, l] = hexToHsl(hex);
  return {
    color: hex,
    mid:   hslToHex(h, Math.min(s + 5, 100),  Math.max(l - 10, 10)),
    deep:  hslToHex(h, Math.min(s + 10, 100), Math.max(l - 20, 10)),
    // `light` is new (00 §10). Hover must step AWAY from the page, which
    // reverses by theme: darker on light surfaces, lighter on dark ones.
    light: hslToHex(h, s, Math.min(l + 12, 92)),
    // `text` is new (00 §7). Measured, not assumed — see deriveAccentText.
    text:  deriveAccentText(h, s, l),
  };
}

/** Resolve the active accent to its four derived values. */
function accentFor(prefs) {
  const hex = prefs.customAccent
    || (ACCENTS.find(a => a.id === prefs.accent) || ACCENTS[0]).color;
  return deriveAccentColors(hex);
}

function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
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
  root.style.setProperty('--motion-scale',
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

  const lang = normalizeLanguage(prefs.language);
  root.style.setProperty('--font-indic',
    lang === 'en+gu'
      ? "'Noto Sans Gujarati', 'Shruti', sans-serif"
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
