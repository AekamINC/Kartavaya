import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { tokens, Tokens, ColorScheme } from './tokens';
import { surfaceTokens } from './surface';
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
 * The theme, with the SCOPED Slate / indigo palette in place of the cream one.
 *
 * For Sanvaad and Sahayak ONLY. The owner approved a different ground for those
 * two surfaces after correcting an earlier "whole product" instruction to "just
 * Sahayak internally"; everything else in Kartavaya stays warm cream. This is a
 * hook you opt into, and not a change to `ThemeProvider`, for exactly the reason
 * `surface-theme.css` is a class and not a second `:root` block: a change to the
 * provider would be the whole product by construction, which is the thing that
 * was explicitly rejected.
 *
 * It returns the SAME SHAPE `useTheme()` returns — same `scheme`, same
 * `preference`, same `setPreference`, a `t` with the same keys — so a screen
 * moves into the scope by changing which hook it calls and nothing else. See
 * `theme/surface.ts` for the values and the derivations.
 *
 * USE IT TOGETHER WITH `<SurfaceScope>`, NEVER ALONE. The hook themes the
 * screen's own render; the provider below is what themes everything under it.
 * The two read the same object, so they cannot disagree.
 */
export function useSurfaceTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return { ...ctx, t: surfaceTokens[ctx.scheme] };
}

/**
 * The scope itself — `.k-surface-theme` in `frontend/src/styles/surface-theme.css`.
 *
 * ── WHY THIS EXISTS AND THE HOOK ALONE IS NOT ENOUGH ────────────────────────
 *
 * The first version of this change was the hook by itself, on the reasoning that
 * every component in `mobile/src` takes its colours as a `t` prop from its
 * caller. THAT IS FALSE, and it is false for five of the components these two
 * screens actually render:
 *
 *     MentionInput   the composer — the whole input, its border, its @-picker
 *     RichText       every message body on the channel log
 *     ScreenState    the error, empty, offline and forbidden states
 *     SwipeRow       the mute action behind every row of the channel rail
 *     Refresher      the pull-to-refresh spinner
 *
 * Each calls `useTheme()` for itself. Under the hook alone, a Sanvaad channel
 * would render a Slate ground with cream message text on it and a cream-bordered
 * composer — which is not a subtle regression, it is the screen looking broken,
 * and it would have shipped green because nothing renders in this repo's mobile
 * test suite.
 *
 * ── THE MECHANISM, and why it is the right one rather than a shortcut ───────
 *
 * React context inherits down the tree. That is the same property CSS custom
 * properties have and it is the property the web file's whole design rests on:
 * declare the tokens once on an ancestor and every descendant reads them without
 * being told. So the scope re-provides the EXISTING `ThemeContext` — not a
 * second, parallel one — with the scoped token set. `useTheme()` inside keeps
 * working, unchanged, and returns Slate.
 *
 * Re-providing the same context rather than adding a new one is the load-bearing
 * part. A second context would mean every shared component had to consult both
 * and know which won, which is the "half of it is themed" failure in a more
 * expensive form.
 *
 * `scheme`, `preference` and `setPreference` are passed through untouched: the
 * scope changes WHICH PALETTE, never which end of it. A user on dark inside
 * Sanvaad is on dark, and the settings screen still switches the whole app.
 *
 * ── What it deliberately does NOT reach ─────────────────────────────────────
 *
 * Anything mounted OUTSIDE the screen's own tree, which is `NotificationBanner`
 * and `NewTaskSheet` — both live at the navigator root. That is correct rather
 * than a limitation: a notification that arrives while you are reading a channel
 * is the product speaking, not Sanvaad, and it should look like the rest of the
 * product. The navigation header and the tab bar are outside for the same
 * reason.
 */
export function SurfaceScope({ children }: { children: React.ReactNode }) {
  const ctx = useContext(ThemeContext);
  const value = useMemo<ThemeContextValue>(
    () => ({ ...ctx, t: surfaceTokens[ctx.scheme] }),
    // Spelt out rather than depending on `ctx`, which is a fresh object on every
    // render of the provider above and would make this memo do nothing. These
    // three are the whole of the context.
    [ctx.scheme, ctx.preference, ctx.setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
