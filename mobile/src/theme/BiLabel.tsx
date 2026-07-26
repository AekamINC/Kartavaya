/**
 * BiLabel — a bilingual "LATIN · देवनागरी" label, split so each script keeps its
 * own typography.
 *
 * ── The defect this exists to make unrepresentable ────────────────────────────
 *
 * The product writes a lot of labels as one string with a middot: `PROJECT ·
 * परियोजना`, `SYNC · सिंक`, `NEW TASK · नया कार्य`. Put that in a single <Text>
 * and whatever style is on it lands on BOTH scripts. The style these labels
 * carry is an uppercase tracked kicker:
 *
 *     { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }
 *
 * Every part of that is wrong for Devanagari, in two separate ways.
 *
 * `letterSpacing` is the worse one and the one that is easy to miss. React
 * Native applies tracking AFTER the shaping engine has run, so it inserts space
 * between glyphs that are required to JOIN. The shirorekha — the horizontal bar
 * along the top of a Devanagari word — breaks into disconnected segments, and
 * conjunct clusters come apart. In `कर्तव्य` that is visible twice: the repha in
 * `र्त` detaches from the letter it rides, and the below-base `व्य` separates
 * from its base. It is the script equivalent of s p a c i n g   o u t the
 * letters inside an English word, except it also destroys the ligatures.
 *
 * `fontWeight: '800'` is the second. Tiro Devanagari Hindi ships exactly one
 * weight — verified from the shipped binary, `OS/2.usWeightClass = 400`, one
 * file in the package. There is no bold Tiro to apply, so Android synthesises a
 * smeared fake bold and iOS silently falls back to the system Devanagari face.
 * Either way the Hindi half of the label renders in a weight and a typeface
 * nobody chose, sitting next to a Latin half that renders correctly.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 *
 * Split on the separator and give each run its own <Text>. The Latin run keeps
 * the tracked uppercase kicker it was designed as; the Devanagari run gets the
 * face that actually has the glyphs, no tracking, and no synthetic weight.
 * Emphasis on Devanagari is carried by size and colour instead — which is how
 * the web layer does it too.
 *
 * This was already solved once, correctly, inside `SettingsScreen`'s
 * `SectionHeader`, and never generalised, so eight further labels kept the
 * defect. Putting it in the theme layer is the point: the next bilingual label
 * cannot reintroduce it without deliberately not using this.
 */

import React from 'react';
import { View, Text, StyleSheet, type TextStyle, type StyleProp, type ViewStyle } from 'react-native';
import { hindi } from './fonts';

/** The separator the product uses between the two scripts. */
const SEP = '·';

export interface BiLabelProps {
  /**
   * The label, either as one `"LATIN · देवनागरी"` string or as the Latin half
   * alone. A string with no separator renders as a plain Latin label, so this is
   * safe to use everywhere a kicker appears.
   */
  children: string;
  /** Style for the Latin run. Tracking and weight belong here, not on the Hindi. */
  latinStyle?: StyleProp<TextStyle>;
  /**
   * Style for the Devanagari run. Any `fontFamily`, `fontWeight` or
   * `letterSpacing` passed here is DROPPED — see below.
   */
  hindiStyle?: StyleProp<TextStyle>;
  /** Row wrapper. */
  style?: StyleProp<ViewStyle>;
  /** Font size for the Devanagari run. Defaults to the Latin size where known. */
  hindiSize?: number;
}

export default function BiLabel({
  children, latinStyle, hindiStyle, style, hindiSize,
}: BiLabelProps) {
  const [latin, indic] = splitBilingual(children);

  return (
    <View style={[s.row, style]}>
      <Text style={latinStyle}>{latin}</Text>
      {indic ? (
        // `hindi()` comes LAST so it wins over anything the caller passed, and
        // the two neutralisers come after that. A caller who spreads a kicker
        // style into `hindiStyle` out of habit gets a correct label anyway,
        // which is the only way this stays true across twenty call sites.
        <Text style={[hindiStyle, hindi(hindiSize), s.neutralise]}>{indic}</Text>
      ) : null}
    </View>
  );
}

/**
 * Split `"LATIN · देवनागरी"` into its two runs.
 *
 * Exported because a few call sites need the parts rather than the element —
 * a header that puts them on two lines, for instance. Returns `[latin, undefined]`
 * when there is no separator.
 */
export function splitBilingual(label: string): [string, string | undefined] {
  const i = label.indexOf(SEP);
  if (i === -1) return [label.trim(), undefined];
  return [label.slice(0, i).trim(), label.slice(i + SEP.length).trim() || undefined];
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
  },
  /**
   * The two neutralisers, applied after everything else.
   *
   * `letterSpacing: 0` undoes tracking inherited from a spread kicker style —
   * without it the shirorekha still breaks. `fontWeight: '400'` pins the weight
   * to the only one Tiro has, so nothing can ask the platform to synthesise a
   * bold that does not exist.
   */
  neutralise: {
    letterSpacing: 0,
    fontWeight: '400',
  },
});
