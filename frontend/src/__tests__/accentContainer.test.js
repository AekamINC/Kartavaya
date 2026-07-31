/**
 * `--primary-container` was the last accent token still hardcoded.
 *
 * `applyPrefs` writes `--primary`, `--primary-hover`, `--primary-vivid`,
 * `--primary-text` and `--on-primary` from the chosen accent, and never touched
 * the container pair. It stayed at the stylesheet's teal — `#B4F1E8` light,
 * `#00514B` dark — for all twelve accents.
 *
 * Measured live on 2026-07-31 with Crimson selected: `--primary` was `#be123c`
 * and `--primary-container` was still `#B4F1E8`. Thirty-eight rules read that
 * token, so a crimson app rendered teal tonal buttons and teal info notes.
 */
import { describe, it, expect } from 'vitest';
import { deriveContainer } from '../lib/accent';

const ACCENTS = [
  ['Teal', '#05B7AA'], ['Blue', '#2563eb'], ['Saffron', '#ea8c00'],
  ['Indigo', '#4f46e5'], ['Rose', '#e11d48'], ['Emerald', '#059669'],
  ['Amber', '#f59e0b'], ['Violet', '#7c3aed'], ['Coral', '#f97362'],
  ['Slate', '#64748b'], ['Crimson', '#be123c'], ['Forest', '#3f6212'],
];

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hue = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('deriveContainer — every accent, both themes', () => {
  it.each(ACCENTS)('%s clears AA on both containers', (_name, hex) => {
    const c = deriveContainer(hex);
    expect(contrast(c.onLight, c.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.onDark, c.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(ACCENTS)('%s keeps the container in the accent hue', (_name, hex) => {
    const c = deriveContainer(hex);
    const want = hue(hex);
    if (want === null) return;            // a grey accent has no hue to hold
    for (const got of [hue(c.light), hue(c.dark)]) {
      const delta = Math.min(Math.abs(got - want), 360 - Math.abs(got - want));
      expect(delta).toBeLessThan(12);
    }
  });

  it('reproduces the shipped teal treatment at the default accent', () => {
    // Not identical — these are derived rather than hand-picked — but close
    // enough that the default app does not visibly change. The shipped pair was
    // #B4F1E8 / #00514B.
    const c = deriveContainer('#05B7AA');
    expect(contrast(c.light, '#B4F1E8')).toBeLessThan(1.1);
    expect(contrast(c.dark, '#00514B')).toBeLessThan(1.2);
  });

  it('gives light and dark genuinely different containers', () => {
    for (const [, hex] of ACCENTS) {
      const c = deriveContainer(hex);
      expect(contrast(c.light, c.dark)).toBeGreaterThan(4);
    }
  });

  it('tracks the accent rather than returning a constant', () => {
    // The regression itself: every accent used to yield the same teal.
    const seen = new Set(ACCENTS.map(([, h]) => deriveContainer(h).light));
    expect(seen.size).toBe(ACCENTS.length);
  });

  it('is stable — the same accent always derives the same pair', () => {
    expect(deriveContainer('#be123c')).toEqual(deriveContainer('#be123c'));
  });
});
