/**
 * The three `@expo-google-fonts/*` packages, which ship .ttf binaries that Metro
 * turns into asset ids. Off-device there is nothing to resolve them to, so each
 * face is a sentinel string and `useFonts` reports loaded.
 *
 * This is enough for `theme/fonts.ts` to load, which is the point: `hindi()`
 * returning no `fontWeight` is a real assertion against the real function, and
 * that rule is the one the `सृजन` defect broke.
 */

export const useFonts = (_map?: Record<string, unknown>): [boolean, Error | null] => [true, null];

export const Newsreader_400Regular = 'Newsreader_400Regular';
export const Newsreader_400Regular_Italic = 'Newsreader_400Regular_Italic';
export const Newsreader_600SemiBold = 'Newsreader_600SemiBold';
export const TiroDevanagariHindi_400Regular = 'TiroDevanagariHindi_400Regular';
export const SpaceMono_400Regular = 'SpaceMono_400Regular';
