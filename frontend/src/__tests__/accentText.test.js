/**
 * --primary-text must clear WCAG AA on the light canvas for EVERY accent.
 *
 * 00-tokens.md §7 makes a specific claim: --primary is 4.04:1 on --bg and is a
 * fill, never text, so any primary-coloured text uses --primary-text — and
 * because the accent is user-configurable across twelve presets plus arbitrary
 * custom hex, applyPrefs has to DERIVE that value rather than assume it.
 *
 * The failure this guards against is not "the default teal is wrong". It is
 * that eleven other presets ship, plus a colour picker, and a token measured
 * once at the default says nothing about the rest. Saffron and Amber are the
 * cases that matter: a yellow at its natural lightness cannot reach 4.5:1 on a
 * warm off-white, so the derivation has to walk it down.
 */
import { describe, it, expect } from 'vitest';
import { ACCENTS, deriveAccentColors } from '../components/CustomizePanel';

/** WCAG 2.x relative luminance — recomputed here rather than imported, so the
 *  test does not pass by sharing a bug with the code it checks. */
function luminance(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}

function contrast(a, b) {
  const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
}

const BG_LIGHT = '#F3EFE6';   // 00 §7. The canvas, not --surface.

describe('--primary-text derivation', () => {
  it.each(ACCENTS.map((a) => [a.label, a.color]))(
    '%s clears 4.5:1 on the light canvas',
    (_label, color) => {
      const { text } = deriveAccentColors(color);
      expect(contrast(text, BG_LIGHT)).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('returns a valid 6-digit hex for every preset', () => {
    for (const { color } of ACCENTS) {
      expect(deriveAccentColors(color).text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('derives text darker than the fill it replaces, in light mode', () => {
    // --primary in light is `mid`. If `text` were not darker there would be no
    // reason for the token to exist.
    for (const { color, label } of ACCENTS) {
      const { mid, text } = deriveAccentColors(color);
      expect(luminance(text), label).toBeLessThanOrEqual(luminance(mid));
    }
  });

  it('handles an arbitrary custom hex, not just the presets', () => {
    // The colour picker accepts anything. A pale yellow is the worst case: it
    // needs the most walking down.
    for (const custom of ['#ffff00', '#00ff00', '#ffffff', '#f0e68c', '#000000']) {
      const { text } = deriveAccentColors(custom);
      expect(contrast(text, BG_LIGHT), custom).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('does not run away past black on an unreachable hue', () => {
    // The loop is bounded. White cannot keep its hue and clear 4.5:1, so the
    // guard has to stop somewhere rather than spin.
    const { text } = deriveAccentColors('#ffffff');
    expect(text).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
