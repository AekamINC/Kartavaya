/**
 * surface.ts — the scoped Slate / indigo palette for Sanvaad and Sahayak.
 *
 * THIS IS THE MOBILE TRANSLATION OF `frontend/src/styles/surface-theme.css`.
 * That file is the source of truth for the VALUES; this one is the source of
 * truth for how they reach a React Native tree. Read the CSS before changing a
 * literal here — it carries the derivations and the measured ratios, and every
 * name below is deliberately the same name it has there so the two cannot drift
 * apart in the way `palette.generated.ts` documents the mobile layer drifting
 * twice already.
 *
 * ── The scope, and why it cannot be a class ──────────────────────────────────
 *
 * On the web, `.k-surface-theme` re-declares `--bg`, `--surface`, `--primary`
 * and the rest on one element, and custom properties inherit, so every
 * descendant — including shared components nobody edited — repaints for free.
 *
 * React Native has no cascade and no CSS inheritance. What it does have is
 * CONTEXT, which inherits down the tree in exactly the way custom properties
 * inherit down the DOM — and that is the property the whole web design rests on:
 * declare the tokens once on an ancestor and every descendant reads them without
 * being told.
 *
 * So this file produces the VALUES and `ThemeProvider` provides them:
 *
 *   `surfaceTokens[scheme]`   the substituted token set, built once, below.
 *   `useSurfaceTheme()`       the screen's own `t`.
 *   `<SurfaceScope>`          re-provides the EXISTING `ThemeContext` with that
 *                             set, so `useTheme()` inside the subtree returns
 *                             Slate. This is the class.
 *
 * BOTH HALVES ARE REQUIRED and the reason is concrete: `MentionInput`,
 * `RichText`, `ScreenState`, `SwipeRow` and `Refresher` each call `useTheme()`
 * for themselves rather than taking a `t` prop. Without the provider, a Sanvaad
 * channel renders a Slate ground with cream message bodies on it and a
 * cream-bordered composer. `SurfaceScope`'s own header lists them.
 *
 * There is no second vocabulary in either half: `t.surface2` means the same step
 * of the same ladder inside the scope as outside it, which is the property the
 * CSS file argues for at length.
 *
 * ── What changes and what does not ──────────────────────────────────────────
 *
 * Ground, surfaces and primary change. Nothing else does, which is the frozen
 * palette's own rule:
 *
 *   · THE DARK FOREGROUND RAMP IS ALREADY CORRECT AND IS NOT TOUCHED.
 *     `darkPalette` holds #E9E7E1 / #BFBDB6 / #8E8D87 for onSurface / -2 / -3,
 *     and those three are byte-for-byte the approved dark ramp. Restating them
 *     here would be a second copy of a value that is already right, which is the
 *     precise failure mode `palette.generated.ts` exists to end. The LIGHT ramp
 *     does move, because the cream ramp is warm (#1B1D1A / #4A4E48 / #666A61)
 *     and warm ink on a cool Slate ground reads as a mistake rather than a
 *     choice.
 *   · Status, approval and priority; the semantic set (`success` / `approval` /
 *     `error` and their containers); the secondary and tertiary containers —
 *     none of them move. They are meanings, not ground. They already flip by
 *     theme in the generated palette, so they are correct in this scope for
 *     free, and `toneColors()` in `tones.ts` keeps working unchanged.
 *   · Channel tones come from the module palette (`MODULE_TONES` in tokens.ts),
 *     which is the existing fifteen-tone set declared twice. There is no second
 *     colour set. See `channelTone.ts`.
 *
 * ── ONE DIVERGENCE FROM THE PRODUCT'S LADDER, and it will look like a bug ────
 *
 * In dark, the cream palette puts `surfaceLow` ABOVE `surface` (#171B21 vs
 * #12151A — Material's convention, where higher is lighter). The approved
 * palette puts it BELOW (#0F1320 vs #141827), because there `s-low` is the
 * CHROME — rails, headers, the composer strip — and `surface` is the CARD
 * floating on it, in both themes.
 *
 * The practical consequence on these two screens: `t.surface2` is what every
 * pressed state resolves to, and inside this scope a pressed row in dark goes
 * DARKER than the row it sits on rather than lighter. That is correct and it is
 * what was approved. A component that hard-codes "in dark, surface2 is the
 * lighter one" will read inverted here.
 *
 * ── WHAT IS NOT ENFORCED ────────────────────────────────────────────────────
 *
 * The web's `npm run check` cannot see this file, and the CSS it mirrors says
 * plainly that the contrast ratios in its own table are measured out of band
 * rather than gated. Nothing here is measured by a mobile gate either — there
 * isn't one. What IS enforced is that this file and the CSS agree on every
 * literal: `theme/__tests__/surface.test.ts` parses
 * `frontend/src/styles/surface-theme.css` and fails on any divergence, so the
 * one failure mode a transcription actually has is closed.
 */

import { tokens, type ColorScheme, type Tokens } from './tokens';

/**
 * The nineteen frozen values, per theme — `--k-scoped-*` in the CSS, §1.
 *
 * Names are the CSS names in camelCase, exactly as `palette.generated.ts` names
 * its own. Owner-approved 2026-08-05 and NOT to be redesigned; read
 * `docs/proposals/19-sahayak-final.html` and `11-replica.html` before touching a
 * value, and re-measure by hand if you do, because nothing measures them for
 * you.
 *
 * Four of these are not in the thirteen the owner approved — `sHigh`,
 * `sHighest`, `outline` and `primaryText` — and they are not inventions: the
 * product's ladder requires all four, and each is derived in a comment in the
 * CSS (quarters in light, thirds in dark, with the contrast argument for why the
 * two differ). They are transcribed here rather than re-derived.
 */
export interface ScopedPalette {
  bg:                string;
  surface:           string;
  sLow:              string;
  sContainer:        string;
  sHigh:             string;
  sHighest:          string;
  outline:           string;
  outlineVariant:    string;
  onSurface:         string;
  onSurface2:        string;
  onSurface3:        string;
  onSurfaceDisabled: string;
  primary:           string;
  primaryHover:      string;
  primaryText:       string;
  primaryContainer:  string;
  onPrimary:         string;
  onPrimaryContainer: string;
  /** The translucent bar tint. `--k-scoped-glass-tint` is a bare `R, G, B`
   *  triplet on the web because its consumers write
   *  `rgba(var(--glass-tint), var(--glass-alpha))`; RN needs the finished string,
   *  so the alpha is baked at the one alpha the mobile `tabBg` uses. */
  glass:             string;
}

/** Light · "Slate". `[data-theme="light"]` in the CSS. */
const SCOPED_LIGHT: ScopedPalette = {
  bg:         '#EDEFF3',
  surface:    '#FFFFFF',
  sLow:       '#F7F8FA',
  sContainer: '#E1E4EA',
  // A quarter and a half of the way from sContainer to the rule colour. Quarters
  // rather than thirds is a contrast decision: at thirds sHighest came out
  // #D0D4DD and onSurface3 measured 4.47:1 on it, failing AA by 0.03 on a step
  // nobody would think to check. At quarters it is 4.65:1.
  sHigh:      '#DBDEE5',
  sHighest:   '#D4D8E0',
  // The stronger rule — the border of every input and outlined control, so WCAG
  // 1.4.11 asks 3:1 against every surface it can sit on. Measured against all
  // seven Slate surfaces: 5.78 down to 4.04 on sHighest.
  outline:        '#5F6673',
  outlineVariant: '#C8CCD6',
  onSurface:  '#0D1117',
  onSurface2: '#3A4049',
  onSurface3: '#565D68',
  // Inactive controls ONLY — WCAG 1.4.3 exempts them. Deliberately illegible at
  // 1.84–2.63:1. Nothing inherits it; opt in.
  onSurfaceDisabled: '#9BA0A9',
  primary:           '#0B6E67',
  // Goes DARKER in light. Never derive a pressed state by subtracting luminance:
  // this reverses direction by theme, exactly as `primaryHover` does in the
  // generated palette.
  primaryHover:      '#085850',
  // The TEXT half. `primary` is a fill at 5.30:1 on bg but 4.27:1 on sHighest,
  // so it is not safe as body copy on every surface; this clears 4.5:1 on all
  // seven. Same split, same reason, as the cream palette's own primaryText.
  primaryText:       '#0A6259',
  primaryContainer:  '#BCEEE7',
  onPrimary:         '#FFFFFF',
  onPrimaryContainer: '#032A26',
  glass: 'rgba(255,255,255,0.78)',
};

/** Dark · indigo. `[data-theme="dark"]` in the CSS. */
const SCOPED_DARK: ScopedPalette = {
  bg:         '#0B0E16',
  surface:    '#141827',
  // BELOW `surface`, not above it. See the divergence note at the top.
  sLow:       '#0F1320',
  sContainer: '#1C2135',
  // A third and two thirds. Dark takes thirds where light takes quarters: the
  // contrast argument that forced the tighter light split does not apply here
  // (onSurface3 measures 4.20:1 on sHighest either way) and thirds keep the
  // elevation steps visible rather than shaving them for a number that does not
  // move.
  sHigh:      '#21263B',
  sHighest:   '#252B42',
  outline:        '#818AA0',
  outlineVariant: '#2A3048',
  // Kartavaya's own dark ramp, verbatim — these three are identical to
  // `darkPalette.onSurface` / `.onSurface2` / `.onSurface3`. They are restated
  // rather than referenced for ONE reason: `surface.test.ts` compares this
  // object against the CSS literal by literal, and a reference would make the
  // three values the test cares about invisible to it. The same test asserts
  // they still equal the generated palette, so the copy cannot go stale
  // silently.
  onSurface:  '#E9E7E1',
  onSurface2: '#BFBDB6',
  onSurface3: '#8E8D87',
  onSurfaceDisabled: '#5C6273',
  // Dark INVERTS the primary relationship exactly as the cream palette does:
  // `primary` is the light mint and `primaryContainer` is the DARK one. A
  // component that assumes container is lighter than primary breaks in exactly
  // one theme.
  primary:           '#4ADECD',
  primaryHover:      '#6DE7D9',
  // Dark takes `primary` as its text colour: at 8.40:1 on the worst surface it
  // clears AA at every size, so the light theme's split is unnecessary and a
  // second value would only drift. The CSS writes this as
  // `var(--k-scoped-primary)` for the same reason.
  primaryText:       '#4ADECD',
  primaryContainer:  '#0A4F49',
  onPrimary:         '#06231F',
  onPrimaryContainer: '#A8F0E6',
  glass: 'rgba(20,24,39,0.78)',
};

export const SCOPED: Record<ColorScheme, ScopedPalette> = {
  light: SCOPED_LIGHT,
  dark:  SCOPED_DARK,
};

/**
 * The scope — `.k-surface-theme` in the CSS, §2 and §3 together.
 *
 * Mechanical, and deliberately so: each scoped value supplies the token of the
 * same name, and every mobile alias whose target moved is re-pointed in the same
 * pass. The CSS needs §2 and §3 as separate blocks because a custom property
 * resolves on the element whose rule matched — `--ink: var(--on-surface)` at
 * `:root` freezes to the CREAM value and overriding `--on-surface` downstream
 * never reaches it. That whole problem is a cascade problem and does not exist
 * here: this builds one object, once, and `ink` is assigned from the scoped
 * value directly. The aliases are still spelled out because ~40 call sites in
 * these two screens read `t.ink` / `t.ink3` / `t.surface2` rather than the
 * canonical names, exactly as ~3,000 references do on the web.
 *
 * The spread is the important part. Every key NOT named below keeps its
 * generated value — that is what makes "status, approval and priority are not
 * touched" true by construction rather than by remembering to copy 15 more
 * lines, and it means a token added to `mapPalette` next month arrives in this
 * scope with its correct value instead of being silently absent.
 */
function scopeTokens(base: Tokens, k: ScopedPalette): Tokens {
  return {
    ...base,

    // ── Ground and the surface ladder ────────────────────────────────────────
    // `surface1…5` is the mobile ladder — surface, s-low, s-container, s-high,
    // s-highest, lowest to highest — and not the web's `--surface-1` / `-2`
    // legacy aliases, which are a different vocabulary that happens to collide.
    // The mapping is the one `mapPalette` already writes, with scoped values.
    bg:          k.bg,
    surface:     k.surface,
    surfaceLow:  k.sLow,
    surfaceHigh: k.sHigh,
    surface1:    k.surface,
    surface2:    k.sLow,
    surface3:    k.sContainer,
    surface4:    k.sHigh,
    surface5:    k.sHighest,

    // ── Foreground ───────────────────────────────────────────────────────────
    onSurface:     k.onSurface,
    onSurfaceVar:  k.onSurface2,
    onSurfaceVar2: k.onSurface3,
    // `--on-surface-faint: var(--on-surface-3)` in §3. The two are already the
    // same literal in both generated themes, so this changes nothing about the
    // relationship and everything about which ramp it is on.
    onSurfaceFaint: k.onSurface3,
    ink:  k.onSurface,
    ink2: k.onSurface2,
    ink3: k.onSurface3,
    ink4: k.onSurface3,
    inkDisabled: k.onSurfaceDisabled,

    // ── Primary. ALL SEVEN, and the completeness is the point ────────────────
    // The CSS makes this argument about `applyPrefs` writing accent presets
    // inline on <html>: declaring six of seven gets you "a crimson app with teal
    // tonal buttons", measured live 2026-07-31. There is no accent preset on
    // mobile, so the mechanism does not exist here — but the invariant it
    // protects does. A half-substituted primary family is a scoped `primary`
    // beside a cream `primaryText`, three elements apart, on one screen.
    primary:            k.primary,
    primaryHover:       k.primaryHover,
    primaryText:        k.primaryText,
    primaryContainer:   k.primaryContainer,
    onPrimary:          k.onPrimary,
    onPrimaryContainer: k.onPrimaryContainer,

    // ── Rules ────────────────────────────────────────────────────────────────
    outline:    k.outline,
    outlineVar: k.outlineVariant,

    // ── The brand ramp ───────────────────────────────────────────────────────
    // §3 re-points the `--k-*` accent layer at the primary family so the two
    // surfaces are one colour: `--k-primary: var(--primary-vivid)`,
    // `--k-mid: var(--primary)`, `--k-deep: var(--primary-hover)`, and
    // `--primary-vivid` itself aliases `--primary` because the approved palette
    // names no third value. Left alone, `brand.teal` is the product-wide
    // #05b7aa, which is a DIFFERENT teal from this scope's `primary` in both
    // themes — near enough to look like a rendering error rather than a choice.
    //
    // The three-stop gradient therefore has two identical stops, which is
    // precisely what `--k-grad` resolves to here. It is a two-stop gradient with
    // its midpoint pinned, not a mistake.
    teal: k.primary,
    mid:  k.primary,
    blue: k.primary,
    gradient:  [k.primaryHover, k.primary, k.primary] as [string, string, string],
    gradient2: [k.primaryHover, k.primary] as [string, string],

    // ── The translucent tab bar ──────────────────────────────────────────────
    // A cream-tinted glass bar floating over an indigo ground is the same defect
    // as a cream card on it. The web calls this `--glass-tint`; mobile bakes the
    // alpha because RN needs a finished rgba string.
    tabBg: k.glass,
  };
}

/**
 * The scoped token sets, built once at module load.
 *
 * Two objects for the life of the process rather than one per render. `Tokens`
 * is ~45 string keys and every screen inside the scope reads it on every frame;
 * building it in a `useMemo` would be correct and would also mean a new object
 * identity per mount, which is enough to defeat the `useCallback` dependency
 * lists that `renderItem` in ChatScreen depends on for list performance.
 */
export const surfaceTokens: Record<ColorScheme, Tokens> = {
  light: scopeTokens(tokens.light, SCOPED_LIGHT),
  dark:  scopeTokens(tokens.dark,  SCOPED_DARK),
};
