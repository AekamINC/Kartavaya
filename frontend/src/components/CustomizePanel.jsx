import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';

const STORAGE_KEY = 'k_prefs';

// Only `color` is stored per preset — mid, deep and light all derive, so a
// custom hex behaves identically to a preset (00-tokens.md §10).
export const ACCENTS = [
  { id: 'teal',    label: 'TEAL',    color: '#05b7aa' },
  { id: 'blue',    label: 'BLUE',    color: '#3b82f6' },
  { id: 'saffro',  label: 'SAFFRO',  color: '#f59e0b' },
  { id: 'indigo',  label: 'INDIGO',  color: '#6366f1' },
  { id: 'rose',    label: 'ROSE',    color: '#e11d63' },
  { id: 'emerald', label: 'EMERALD', color: '#059669' },
  { id: 'amber',   label: 'AMBER',   color: '#d97706' },
  { id: 'violet',  label: 'VIOLET',  color: '#7c3aed' },
  { id: 'coral',   label: 'CORAL',   color: '#f2643c' },
  { id: 'slate',   label: 'SLATE',   color: '#64748b' },
  { id: 'crimson', label: 'CRIMSON', color: '#be123c' },
  { id: 'forest',  label: 'FOREST',  color: '#3f6212' },
];

export const FONTS = [
  { id: 'newsreader',       label: 'Newsreader',       sub: 'editorial', value: "'Newsreader', 'Georgia', serif" },
  { id: 'spectral',         label: 'Spectral',         sub: 'literary',  value: "'Spectral', 'Georgia', serif" },
  { id: 'instrument-serif', label: 'Instrument Serif', sub: 'modern',    value: "'Instrument Serif', 'Georgia', serif" },
  { id: 'playfair',         label: 'Playfair Display',  sub: 'elegant',   value: "'Playfair Display', 'Georgia', serif" },
  { id: 'lora',             label: 'Lora',              sub: 'readable',  value: "'Lora', 'Georgia', serif" },
  { id: 'inter',            label: 'Inter',             sub: 'clean',     value: "'Inter', system-ui, sans-serif" },
  { id: 'dm-sans',          label: 'DM Sans',           sub: 'geometric', value: "'DM Sans', system-ui, sans-serif" },
  { id: 'poppins',          label: 'Poppins',           sub: 'friendly',  value: "'Poppins', system-ui, sans-serif" },
  { id: 'source-sans',      label: 'Source Sans 3',     sub: 'technical', value: "'Source Sans 3', system-ui, sans-serif" },
];

// --font-display and --font-ui are INDEPENDENT. The previous applyPrefs set
// --font-ui to the display font in both arms of a SANS_IDS check, so picking
// Newsreader turned every label, table cell and button serif.
export const UI_FONTS = [
  { id: 'inter',       label: 'Inter',         sub: 'clean',     value: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" },
  { id: 'dm-sans',     label: 'DM Sans',       sub: 'geometric', value: "'DM Sans', ui-sans-serif, system-ui, sans-serif" },
  { id: 'poppins',     label: 'Poppins',       sub: 'friendly',  value: "'Poppins', ui-sans-serif, system-ui, sans-serif" },
  { id: 'source-sans', label: 'Source Sans 3', sub: 'technical', value: "'Source Sans 3', ui-sans-serif, system-ui, sans-serif" },
  { id: 'system',      label: 'System',        sub: 'native',    value: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: 'ibm-plex',    label: 'IBM Plex Sans', sub: 'neutral',   value: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" },
];

// Standalone hi/gu were dropped as interface languages; the four bilingual
// options remain. A value stored before that change must fall through rather
// than render the raw key.
const LANGUAGES = new Set(['en', 'en+sa', 'en+hi', 'en+gu']);
const LANG_FALLBACK = { hi: 'en+hi', gu: 'en+gu' };
export function normalizeLanguage(lang) {
  if (LANGUAGES.has(lang)) return lang;
  return LANG_FALLBACK[lang] || 'en+sa';
}

export const DEFAULTS = {
  mode:         'light',
  accent:       'teal',
  customAccent: null,
  sidebar:      'wide',
  density:      'comfy',
  font:         'newsreader',
  uiFont:       'inter',
  fontSize:     14,
  lineHeight:   1.5,
  radius:       10,
  glassMix:     0.6,
  anim:         'full',
  language:     'en+sa',
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

export function deriveAccentColors(hex) {
  const [h, s, l] = hexToHsl(hex);
  return {
    color: hex,
    mid:   hslToHex(h, Math.min(s + 5, 100),  Math.max(l - 10, 10)),
    deep:  hslToHex(h, Math.min(s + 10, 100), Math.max(l - 20, 10)),
    light: hslToHex(h, s,                     Math.min(l + 12, 92)), // dark-mode hover
  };
}

function systemPrefersDark() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function applyPrefs(prefs) {
  const root = document.documentElement;

  let acc;
  if (prefs.customAccent) {
    acc = deriveAccentColors(prefs.customAccent);
  } else {
    acc = ACCENTS.find(a => a.id === prefs.accent) || ACCENTS[0];
  }

  const dsp = FONTS.find(f => f.id === prefs.font)      || FONTS[0];
  const ui  = UI_FONTS.find(f => f.id === prefs.uiFont) || UI_FONTS[0];

  // Theme resolves FIRST — the --primary/--primary-hover pair below depends on
  // it, so it has to be settled before those are written.
  const mode = prefs.mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : prefs.mode;
  const dark = mode === 'dark';
  root.setAttribute('data-theme', mode);
  // lib/auth.js drives the same theme through a .dark class. Keep the two in
  // step so a toggle from either side lands on one state.
  root.classList.toggle('dark', dark);

  root.style.setProperty('--k-primary', acc.color);
  root.style.setProperty('--k-mid',     acc.mid);
  root.style.setProperty('--k-deep',    acc.deep);
  root.style.setProperty('--k-grad',    `linear-gradient(135deg, ${acc.deep}, ${acc.mid} 55%, ${acc.color})`);
  root.style.setProperty('--k-gradD',   `linear-gradient(135deg, ${acc.deep}cc, ${acc.mid}cc 55%, ${acc.color}cc)`);
  root.style.setProperty('--side-active', `${acc.color}29`);

  // Hover must be a STEP AWAY FROM THE PAGE, and that reverses by theme: light
  // surfaces hover darker, dark surfaces hover lighter. Writing mid as
  // --primary and color as --primary-hover in both themes made light-mode hover
  // LIGHTER than rest — the inverse of every other interactive state.
  root.style.setProperty('--primary',       dark ? acc.color : acc.mid);
  root.style.setProperty('--primary-hover', dark ? acc.light : acc.deep);
  root.style.setProperty('--primary-vivid', acc.color);

  root.style.setProperty('--font-display', dsp.value);
  root.style.setProperty('--font-ui',      ui.value);
  document.body.style.fontFamily = 'var(--font-ui)';

  const fs = Math.max(12, Math.min(20, prefs.fontSize || 14));
  document.body.style.fontSize = fs + 'px';
  root.style.setProperty('--font-size-base', fs + 'px');
  root.style.setProperty('--line-height-base', String(prefs.lineHeight ?? 1.5));
  root.style.setProperty('--radius-base', (prefs.radius ?? 10) + 'px');
  root.style.setProperty('--glass-mix',   String(prefs.glassMix ?? 0.6));

  // --ix-user, NOT --ix. An inline style on documentElement outranks the
  // prefers-reduced-motion media query, so writing --ix directly let an app
  // preference silently override an OS accessibility setting.
  root.style.setProperty('--ix-user',
    prefs.anim === 'none' ? '.001' : prefs.anim === 'reduced' ? '.5' : '1');

  root.setAttribute('data-density', prefs.density);
  root.style.setProperty('--page-pad', prefs.density === 'compact' ? '16px' : '28px');
  root.setAttribute('data-sidebar', prefs.sidebar);

  const lang = normalizeLanguage(prefs.language);
  root.setAttribute('data-language', lang);
  root.style.setProperty('--font-indic',
    lang === 'en+gu' ? "'Noto Sans Gujarati', 'Shruti', sans-serif" : 'var(--font-hindi)');
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

  // mode:'system' needs a live subscription — otherwise the OS flipping to dark
  // mid-session leaves the app on the theme it booted with.
  useEffect(() => {
    if (prefs.mode !== 'system' || !window.matchMedia) return undefined;
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

export function Seg({ options, value, onChange }) {
  return (
    <div style={{
      display: 'flex', background: 'var(--bg-soft)',
      borderRadius: 8, padding: 3, gap: 2, width: 'fit-content',
    }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            padding: '4px 13px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 12, fontFamily: 'var(--font-ui)',
            fontWeight: active ? 600 : 400,
            background: active ? 'var(--surface-2)' : 'transparent',
            color: active ? 'var(--ink)' : 'var(--ink-3)',
            boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
            transition: 'all .12s',
          }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SectionHead({ en, hi }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 10, marginTop: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--k-primary)' }}>{en}</span>
      <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-hindi)' }}>{hi}</span>
    </div>
  );
}

export function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{label}</span>
      {children}
    </div>
  );
}
