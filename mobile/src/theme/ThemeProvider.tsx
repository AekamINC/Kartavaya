import React, { createContext, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';
import { tokens, Tokens, ColorScheme } from './tokens';
import { storage } from '../lib/storage';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  scheme:     ColorScheme;
  t:          Tokens;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  scheme:     'dark',
  t:          tokens.dark,
  preference: 'system',
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme() as ColorScheme ?? 'dark';
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => (storage.getString('theme_pref') as ThemePreference) ?? 'system'
  );

  const scheme: ColorScheme =
    preference === 'system' ? systemScheme :
    preference === 'light'  ? 'light' : 'dark';

  const setPreference = (p: ThemePreference) => {
    storage.set('theme_pref', p);
    setPreferenceState(p);
  };

  return (
    <ThemeContext.Provider value={{ scheme, t: tokens[scheme], preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

/**
 * ── THE SCOPED SLATE PALETTE IS GONE. Do not reintroduce it here. ────────────
 *
 * `useSurfaceTheme()` and `<SurfaceScope>` used to live below this line and gave
 * Sanvaad and Sahayak a Slate / indigo ground. Both are deleted, along with
 * `theme/surface.ts`, because the ground they translated no longer exists:
 * `frontend/src/styles/surface-theme.css` was deleted on 2026-08-07 (`ffe94285`)
 * on the owner's "prototype tokens.css follow latest one, scrap my slate
 * approved", and mobile had not followed — so the phone rendered Slate while the
 * web rendered cream, and the guard test in `theme/__tests__/surface.test.ts`
 * had been failing against a missing file ever since.
 *
 * The design source agrees and is the reason this is not a matter of taste:
 * `design-reference/Kartavaya Redesign/` contains ZERO occurrences of "slate"
 * across every stylesheet and every component. `sahayak.css` declares no colour
 * at all; `messaging.css` declares fourteen and all fourteen are overlays, the
 * WhatsApp brand green, or `rgba(28, 24, 16, .1)` — a warm-brown shadow mixed
 * for a cream ground.
 *
 * `screens/__tests__/sanvaadSurface.test.ts` §1 fails if either name returns.
 */
