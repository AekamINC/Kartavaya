/**
 * fonts.ts — the app's typefaces, bundled.
 *
 * BUNDLED, NOT FETCHED. Every face here comes from an `@expo-google-fonts/*`
 * package, which ships the .ttf inside node_modules and resolves it through
 * `require()`. Metro therefore packs the binary into the app itself, so the
 * first launch on a train with no signal renders in the right face. Nothing on
 * this path touches fonts.googleapis.com at runtime.
 *
 * ── The Devanagari rule ───────────────────────────────────────────────────────
 *
 * Newsreader and Space Mono have ZERO Devanagari coverage. If a string of
 * Devanagari is given one of them as its `fontFamily`, the glyphs are not in the
 * file and the platform substitutes per glyph: Android usually draws tofu boxes,
 * iOS silently swaps in the system face. Either way a Hindi word can arrive in a
 * different weight and shape from the word beside it. This exact defect has been
 * found twice in the web app.
 *
 * So Devanagari never names a family directly at a call site. It goes through
 * `hindi()`, which can only ever return a face that actually has the glyphs.
 *
 * ── Why Devanagari has no bold ────────────────────────────────────────────────
 *
 * Tiro Devanagari Hindi ships ONE weight, 400. Asking for `fontWeight: '700'` on
 * top of it does not produce a bold Tiro, because there is no bold Tiro: Android
 * synthesises a smeared fake bold and iOS falls back to the system face, which
 * is how a single Hindi phrase ends up in two weights.
 *
 * `hindi()` therefore never emits a weight above 400. Emphasis on Devanagari is
 * carried by size and colour instead — which is also how the web layer does it.
 *
 * There is an unused `assets/fonts/NotoSansDevanagari-Bold.ttf` in the repo,
 * evidently dropped in to solve this. It is deliberately NOT wired up: Noto Sans
 * Devanagari is a sans and Tiro is a calligraphic serif, so pairing Tiro regular
 * with Noto bold swaps one mixed-weight defect for a mixed-*typeface* one that
 * looks even more broken. Giving Devanagari real bold means adding
 * @expo-google-fonts/noto-sans-devanagari and moving BOTH weights to it.
 */

import { TextStyle } from 'react-native';

import {
  useFonts as useNewsreader,
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_600SemiBold,
} from '@expo-google-fonts/newsreader';

import {
  useFonts as useTiro,
  TiroDevanagariHindi_400Regular,
} from '@expo-google-fonts/tiro-devanagari-hindi';

import {
  useFonts as useSpaceMono,
  SpaceMono_400Regular,
} from '@expo-google-fonts/space-mono';

/**
 * Registered family names.
 *
 * Exported so nothing has to spell them as string literals — a typo in a
 * `fontFamily` string is silent, and the text just renders in the system face.
 */
export const FAMILY = {
  /** Latin display serif. NO Devanagari coverage. */
  display:       'Newsreader',
  displayItalic: 'Newsreader-Italic',
  /** Real 600, so weighted display text is not synthesised. */
  displaySemi:   'Newsreader-SemiBold',
  /** The only face in the app with Devanagari coverage. */
  devanagari:    'TiroDevanagariHindi',
  /** Latin mono, for ids and counts. NO Devanagari coverage. */
  mono:          'SpaceMono',
} as const;

/**
 * Load every face. Call once at the root, before rendering.
 *
 * The three hooks are separate because each package exports its own; the
 * returned booleans are ANDed so nothing renders until all faces are resolved.
 * A partial load is what produces a first frame in the fallback face followed by
 * a visible reflow.
 */
export function useFonts(): [boolean] {
  const [n] = useNewsreader({
    [FAMILY.display]:       Newsreader_400Regular,
    [FAMILY.displayItalic]: Newsreader_400Regular_Italic,
    [FAMILY.displaySemi]:   Newsreader_600SemiBold,
  });
  const [t] = useTiro({
    [FAMILY.devanagari]: TiroDevanagariHindi_400Regular,
  });
  const [s] = useSpaceMono({
    [FAMILY.mono]: SpaceMono_400Regular,
  });
  return [n && t && s];
}

/**
 * The style for a run of Devanagari.
 *
 * Use this for EVERY Devanagari string. It is the only supported way to set a
 * family on Hindi text, and it exists so that no call site has to remember which
 * faces have the glyphs.
 *
 * No `fontWeight` is returned, on purpose — see the note at the top. Passing a
 * size is optional and is the intended way to give a Hindi label emphasis.
 */
export function hindi(fontSize?: number): TextStyle {
  return fontSize === undefined
    ? { fontFamily: FAMILY.devanagari }
    : { fontFamily: FAMILY.devanagari, fontSize };
}

/**
 * Latin display text.
 *
 * `weight` is restricted to the two weights actually loaded. Anything else would
 * be synthesised from the 400 file, which is the same class of defect as bolding
 * Devanagari — RN accepts the style and quietly fakes it.
 *
 * NEVER pass Devanagari through this. Use `hindi()`.
 */
export function display(weight: 400 | 600 = 400, italic = false): TextStyle {
  if (italic) return { fontFamily: FAMILY.displayItalic, fontWeight: '400' };
  return weight === 600
    ? { fontFamily: FAMILY.displaySemi, fontWeight: '600' }
    : { fontFamily: FAMILY.display, fontWeight: '400' };
}

/** Style presets, kept for call sites that read better as constants. */
export const F = {
  /** Hero / display: Newsreader italic serif */
  displaySerif: { fontFamily: FAMILY.displayItalic, fontWeight: '400' } as TextStyle,
  /** Section titles / task detail heading */
  titleSerif:   { fontFamily: FAMILY.display, fontWeight: '400' } as TextStyle,
  /** Devanagari. No weight, by design. */
  hindi:        { fontFamily: FAMILY.devanagari } as TextStyle,
  /** Code / mono / ids */
  mono:         { fontFamily: FAMILY.mono, fontWeight: '400' } as TextStyle,
};
