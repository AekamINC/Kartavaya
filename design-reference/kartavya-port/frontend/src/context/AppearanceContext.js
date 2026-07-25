// frontend/src/context/AppearanceContext.js
// Kartavya by Aekam Inc — editorial-redesign appearance state.
//
// Persists theme/lang/density/font/accent to localStorage and applies them
// as data-* attributes on <html>, plus toggles the existing `.dark` class
// (which your tokens.css already handles).
//
// Mount once at the top of App.js, INSIDE BrowserRouter / ToastProvider:
//
//   <AppearanceProvider>
//     <BrowserRouter>...</BrowserRouter>
//   </AppearanceProvider>
//
// Then read state anywhere with useAppearance().

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'kartavya_appearance';

const DEFAULTS = {
  theme:    'light',      // 'light' | 'dark'
  accent:   'teal',       // 'teal'  | 'blue' | 'saffron' | 'indigo'
  density:  'comfy',      // 'compact' | 'comfy'
  font:     'newsreader', // 'newsreader' | 'spectral' | 'geist' | 'inter'
  lang:     'mix',        // 'en' | 'mix' | 'hi'
};

const AppearanceContext = createContext(null);

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return DEFAULTS;
  }
}

export function AppearanceProvider({ children }) {
  const [a, setA] = useState(loadInitial);

  // Apply to <html> on every change. Both:
  //   - .dark class (so existing tokens.css + Tailwind dark: rules respond)
  //   - data-ed-* attributes (so editorial.css responds)
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', a.theme === 'dark');
    root.setAttribute('data-ed-theme',   a.theme);
    root.setAttribute('data-ed-accent',  a.accent);
    root.setAttribute('data-ed-density', a.density);
    root.setAttribute('data-ed-font',    a.font);
    root.setAttribute('data-ed-lang',    a.lang);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); } catch (_) {}
  }, [a]);

  const set = useCallback((keyOrPatch, value) => {
    const patch = typeof keyOrPatch === 'object' ? keyOrPatch : { [keyOrPatch]: value };
    setA(prev => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setA(DEFAULTS), []);

  return (
    <AppearanceContext.Provider value={{ ...a, set, reset }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used inside <AppearanceProvider>');
  return ctx;
}

// Helper: map a nav label or string into the user's chosen language.
// Pass an object { en, hi, sans } and get back the right one.
export function useNavLabel() {
  const { lang } = useAppearance();
  return (labels) => {
    if (!labels) return '';
    if (typeof labels === 'string') return labels;
    if (lang === 'hi')  return labels.hi || labels.en;
    if (lang === 'mix') return labels.en + (labels.sans ? ' · ' + labels.sans : '');
    return labels.en;
  };
}
