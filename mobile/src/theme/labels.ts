/**
 * labels.ts — ONE label shape for the app, and one accessor.
 *
 * ── The three mechanisms this replaces ───────────────────────────────────────
 *
 * Measured across `mobile/src` before this file existed: 193 lines carrying
 * Indic text across 43 files, written three different ways.
 *
 *   · 15 middot strings — `'NEW TASK · नया कार्य'`, `'PROJECT · परियोजना'`.
 *     `BiLabel` already splits these, and `screens/__tests__/devanagari.test.ts`
 *     already fails a build where one is not split, so this mechanism is safe.
 *     It is also unextendable: a string with one separator has room for exactly
 *     two scripts and no name for either of them.
 *   · 24 `{ en, hi }` object pairs — `nav/BottomBar.tsx` LABELS,
 *     `screens/MoreScreen.tsx` DESTS. These are the shape the web app converged
 *     on, and they are rendered by hand at each site: two `<Text>` runs, two
 *     styles, and the correctness of the pair depending on the author
 *     remembering that `hindi()` must come last.
 *   · bare `<Text>` Devanagari literals — a watermark, a greeting, a screen
 *     title. These never change with anything and are correct as they are.
 *
 * Two mechanisms for the same idea is how `SettingsScreen`'s `SectionHeader`
 * came to solve the split correctly and eight other labels kept the defect for
 * months: the fix lived in a mechanism the other eight were not using.
 *
 * `toPair` reads BOTH. A call site migrates by handing over whatever it already
 * holds.
 *
 * ── The `gu` slot, and why it is deliberately EMPTY on this platform ─────────
 *
 * The web app has 45 Gujarati strings, all of them in one file
 * (`frontend/src/components/layout/navConfig.js`), because that was the only
 * shape with a slot to put them in. This app has ZERO. The single Gujarati
 * string in the whole of `mobile/src` is inside a placeholder that NAMES the
 * three languages Sahayak answers in — `'Ask anything — English, हिन्दी or
 * ગુજરાતી…'` (`screens/SahayakScreen.tsx:563`) — which is copy, not a label.
 *
 * The slot exists here so the gap is expressible and countable. It is NOT
 * filled, and `toPair` will NOT render a `gu` value, for a reason that is
 * specific to this platform and worth stating plainly:
 *
 *     THIS APP SHIPS NO GUJARATI FACE.
 *
 * `theme/fonts.ts` bundles Newsreader, Space Mono and Tiro Devanagari Hindi.
 * Tiro has zero Gujarati coverage, exactly as Newsreader has zero Devanagari
 * coverage — the defect `fonts.ts` already documents, one script over. Handing
 * `ગુજરાતી` to `hindi()` would put every glyph through the platform's fallback
 * chain, one at a time, in a family nobody chose. That is precisely the
 * `lib/notifSound.js` bug the web layer exists to prevent, reproduced on
 * purpose.
 *
 * So: a `gu` value is CARRIED and not DRAWN, and `toPair` says so by returning
 * no Indic run for it rather than substituting the Devanagari — showing one
 * script less is a smaller lie than showing the wrong one. `gujaratiPending()`
 * makes the backlog a number. Filling it needs `@expo-google-fonts/noto-sans-
 * gujarati` in `package.json` and a `gujarati()` beside `hindi()`, not more
 * strings.
 */

/** The one shape. `hi` and `gu` are both optional — a Latin-only label is fine. */
export interface Label {
  en: string;
  hi?: string;
  gu?: string;
}

/** What a call site may hand over: the shape, or either string form. */
export type LabelValue = string | Label;

/** Devanagari (U+0900–U+097F) and Gujarati (U+0A80–U+0AFF). */
export const DEVANAGARI = /[ऀ-ॿ]/;
export const GUJARATI = /[઀-૿]/;

/** The separator the middot form uses. Kept identical to `BiLabel`'s. */
export const SEP = '·';

/**
 * The two runs, and which script the second one is in.
 *
 * `script` is the half that matters for correctness rather than layout: it names
 * the field the string was actually read from, so a caller can never label a run
 * with a script it is not in. Today it is always `'hi'` when present — see the
 * header — and that is a fact about the FONT BUNDLE, not about this function.
 */
export function toPair(value: LabelValue | null | undefined): {
  en: string;
  indic?: string;
  script?: 'hi' | 'gu';
} {
  if (value == null) return { en: '' };

  if (typeof value === 'string') {
    const i = value.indexOf(SEP);
    if (i === -1) return { en: value.trim() };
    const en = value.slice(0, i).trim();
    const rest = value.slice(i + SEP.length).trim();
    if (!rest) return { en };
    // Read the script off the codepoints, never off the position. A middot
    // string is written by hand and the second half is not guaranteed Indic.
    if (GUJARATI.test(rest) && !DEVANAGARI.test(rest)) return { en, ...guRun() };
    if (DEVANAGARI.test(rest)) return { en, indic: rest, script: 'hi' };
    return { en: `${en} ${SEP} ${rest}` };
  }

  const en = value.en ?? '';
  if (value.hi) return { en, indic: value.hi, script: 'hi' };
  if (value.gu) return { en, ...guRun() };
  return { en };
}

/**
 * What a Gujarati run resolves to today: NOTHING.
 *
 * A function rather than a bare `{}` so the day a Gujarati face is bundled
 * there is one line to change and one place to look, and so this decision is
 * greppable from the two call sites above.
 */
function guRun(): { indic?: string; script?: 'hi' | 'gu' } {
  return {};
}

/** Whether this app can draw Gujarati at all. `false` until a face is bundled. */
export const HAS_GUJARATI_FACE = false;

/**
 * Labels carrying a `gu` that this build cannot draw — the backlog, countable.
 *
 * Zero today, and the zero is the finding: the slot exists everywhere and no
 * surface in this app has a Gujarati string.
 */
export function gujaratiPending(labels: Label[]): Label[] {
  return HAS_GUJARATI_FACE ? [] : labels.filter(l => !!l.gu);
}
