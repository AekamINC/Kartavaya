import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';

const STORAGE_KEY = 'k_prefs';

export const ACCENTS = [
  { id: 'teal',   label: 'TEAL',   color: '#05b7aa', mid: '#03a1b6', deep: '#0082c6' },
  { id: 'blue',   label: 'BLUE',   color: '#3b82f6', mid: '#2563eb', deep: '#1d4ed8' },
  { id: 'saffro', label: 'SAFFRO', color: '#f59e0b', mid: '#d97706', deep: '#b45309' },
  { id: 'indigo', label: 'INDIGO', color: '#6366f1', mid: '#4f46e5', deep: '#3730a3' },
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

const SANS_IDS = new Set(['inter', 'dm-sans', 'poppins', 'source-sans']);

export const DEFAULTS = {
  mode:         'light',
  accent:       'teal',
  customAccent: null,
  sidebar:      'wide',
  density:      'comfy',
  font:         'newsreader',
  fontSize:     14,
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
    mid:  hslToHex(h, Math.min(s + 5, 100), Math.max(l - 10, 10)),
    deep: hslToHex(h, Math.min(s + 10, 100), Math.max(l - 20, 10)),
  };
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

  const fnt = FONTS.find(f => f.id === prefs.font) || FONTS[0];

  root.style.setProperty('--k-primary', acc.color);
  root.style.setProperty('--k-mid',     acc.mid);
  root.style.setProperty('--k-deep',    acc.deep);
  root.style.setProperty('--k-grad',    `linear-gradient(135deg, ${acc.deep}, ${acc.mid} 55%, ${acc.color})`);
  root.style.setProperty('--k-gradD',   `linear-gradient(135deg, ${acc.deep}cc, ${acc.mid}cc 55%, ${acc.color}cc)`);
  root.style.setProperty('--side-active', `${acc.color}29`);

  root.style.setProperty('--font-display', fnt.value);
  if (SANS_IDS.has(prefs.font)) {
    root.style.setProperty('--font-ui', fnt.value);
    document.body.style.fontFamily = fnt.value;
  } else {
    root.style.setProperty('--font-ui', fnt.value);
    document.body.style.fontFamily = fnt.value;
  }

  const fs = Math.max(12, Math.min(20, prefs.fontSize || 14));
  document.body.style.fontSize = fs + 'px';
  root.style.setProperty('--font-size-base', fs + 'px');

  root.setAttribute('data-theme', prefs.mode);
  if (prefs.mode === 'dark') {
    root.style.setProperty('--bg',         '#0f1117');
    root.style.setProperty('--bg-soft',    '#161b25');
    root.style.setProperty('--surface',    '#1a2033');
    root.style.setProperty('--surface-2',  '#212840');
    root.style.setProperty('--ink',        '#e8eaf0');
    root.style.setProperty('--ink-2',      '#a8b0c4');
    root.style.setProperty('--ink-3',      '#7080a0');
    root.style.setProperty('--ink-faint',  '#455070');
    root.style.setProperty('--rule',       '#2a3248');
    root.style.setProperty('--rule-soft',  '#232a40');
    root.style.setProperty('--rule-strong','#384060');
  } else {
    root.style.setProperty('--bg',         '#F6F3EC');
    root.style.setProperty('--bg-soft',    '#F0ECDF');
    root.style.setProperty('--surface',    '#FCFAF5');
    root.style.setProperty('--surface-2',  '#FFFFFF');
    root.style.setProperty('--ink',        '#1A2230');
    root.style.setProperty('--ink-2',      '#4A5468');
    root.style.setProperty('--ink-3',      '#6E7B91');
    root.style.setProperty('--ink-faint',  '#A5B0C2');
    root.style.setProperty('--rule',       '#E2DCC9');
    root.style.setProperty('--rule-soft',  '#EFE9D8');
    root.style.setProperty('--rule-strong','#C8C0AA');
  }

  root.setAttribute('data-density', prefs.density);
  root.style.setProperty('--page-pad', prefs.density === 'compact' ? '16px' : '28px');
  root.setAttribute('data-sidebar', prefs.sidebar);
  root.setAttribute('data-language', prefs.language);

  const lang = prefs.language;
  if (lang === 'gu' || lang === 'en+gu') {
    root.style.setProperty('--font-indic', "'Noto Sans Gujarati', sans-serif");
  } else {
    root.style.setProperty('--font-indic', "var(--font-hindi)");
  }
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
