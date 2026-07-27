/**
 * accent.js — the accent colour maths, with no React in it.
 *
 * Moved out of `components/CustomizePanel.jsx` unchanged (`deriveAccentText`
 * and everything it depends on) so that a plain Node script can import it.
 * That is the whole reason this file exists: the twelve presets plus an
 * arbitrary custom hex produce 24 foreground/background pairs that no gate
 * could reach while the maths sat behind a `import React` — and one of those
 * pairs measured 1.96:1.
 *
 * `CustomizePanel` re-exports `deriveAccentColors`, so every existing import
 * keeps working.
 */

export function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** WCAG 2.x relative luminance. */
export function relLuminance(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}

/** WCAG 2.x contrast ratio between two hexes. */
export function contrast(a, b) {
  const x = relLuminance(a), y = relLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Light `--bg` is #F3EFE6. Contrast is measured against the canvas, not the
 *  card on top of it — 00 §12, and the mistake that passed three tokens which
 *  failed on the page. */
const BG_LIGHT_LUM = relLuminance('#F3EFE6');

export function contrastOnLightBg(hex) {
  const l = relLuminance(hex);
  const [hi, lo] = l > BG_LIGHT_LUM ? [l, BG_LIGHT_LUM] : [BG_LIGHT_LUM, l];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent value that primary-coloured TEXT uses in light mode.
 *
 * `--primary` itself is 4.04:1 on `--bg` at the default teal — a fill, never
 * text (00 §7, 23 §contrast table). `deep` is the right starting point, but
 * twelve presets ship plus arbitrary custom hex, so taking `deep` on trust
 * would leave each one an unmeasured contrast risk — which is exactly what 00
 * says this function must stop doing. So measure, and darken until it clears.
 *
 * Steps lightness down 2% at a time rather than solving directly: it keeps the
 * hue and saturation the preset was chosen for, and the loop is bounded.
 */
export function deriveAccentText(h, s, l) {
  let lightness = Math.max(l - 20, 10);
  let hex = hslToHex(h, Math.min(s + 10, 100), lightness);
  while (contrastOnLightBg(hex) < 4.5 && lightness > 4) {
    lightness -= 2;
    hex = hslToHex(h, Math.min(s + 10, 100), lightness);
  }
  return hex;
}

/**
 * The label colour that sits ON the accent fill — `--on-primary`.
 *
 * WHAT WAS WRONG. `--on-primary` is declared once per theme and never moved:
 * `#FFFFFF` in light, `#00332F` — a near-black TEAL — in dark. `applyPrefs`
 * overwrites `--primary` with the user's accent, so that fixed pair is being
 * asked to partner twelve different hues. Measured across all twelve presets
 * against the fill each one actually produces at runtime:
 *
 *   dark   10 of 12 below 4.5:1, worst 1.96 (Forest #3f6212)
 *   light   3 of 12 below 4.5:1, worst 3.18 (Saffron)
 *
 * The light number is the one nobody had, and it indicts the DEFAULT: every
 * earlier report measured white against the stylesheet's `--primary: #04837A`
 * and got 4.63. But `applyPrefs` never uses that literal — it writes
 * `acc.mid`, which for the default teal is `#00897f`, and white on that is
 * **4.30**. The token that was measured is not the token that renders.
 *
 * WHAT THIS DOES. Considers white, black, and the accent's own hue at every
 * 2% lightness step, and returns whichever maximises the WORSE of its two
 * ratios — against `--primary` (rest) and `--primary-hover`, because
 * `.btn--fill:hover` swaps the background and keeps the label. The incumbent
 * is in the candidate set, so this can never return something worse than what
 * ships today; where it changes nothing, it returns the incumbent unchanged.
 *
 * WHAT IT DOES NOT FIX, and why it is not a bug in this function: four of the
 * 24 pairs remain below 4.5:1 on rest — dark Violet 3.69 and Slate 4.41,
 * light Teal 4.30 and Coral 3.87. Those fills are mid-tone: no foreground of
 * any colour clears 4.5:1 on `#00897f` while staying legible on its hover.
 * Closing them means changing the accent RAMP (`--primary` is `mid` in light
 * and the raw accent in dark), which is a design decision and not one to make
 * inside a contrast helper. `scripts/check-accent-contrast.mjs` prints the
 * residual on every run so it cannot go quiet.
 */
export function deriveOnAccent(primary, hover, incumbent) {
  const [h, s] = hexToHsl(primary);
  const candidates = ['#FFFFFF', '#000000', incumbent];
  for (let L = 0; L <= 100; L += 2) candidates.push(hslToHex(h, Math.min(s, 45), L));

  let best = incumbent;
  let bestWorst = Math.min(contrast(incumbent, primary), contrast(incumbent, hover));
  let bestRest = contrast(incumbent, primary);
  for (const c of candidates) {
    const rest = contrast(c, primary);
    const worst = Math.min(rest, contrast(c, hover));
    if (worst > bestWorst + 1e-9 || (Math.abs(worst - bestWorst) < 1e-9 && rest > bestRest)) {
      bestWorst = worst; bestRest = rest; best = c;
    }
  }
  return best;
}

export function deriveAccentColors(hex) {
  const [h, s, l] = hexToHsl(hex);
  const color = hex;
  const mid   = hslToHex(h, Math.min(s + 5, 100),  Math.max(l - 10, 10));
  const deep  = hslToHex(h, Math.min(s + 10, 100), Math.max(l - 20, 10));
  // `light` is new (00 §10). Hover must step AWAY from the page, which
  // reverses by theme: darker on light surfaces, lighter on dark ones.
  const light = hslToHex(h, s, Math.min(l + 12, 92));
  return {
    color, mid, deep, light,
    // `text` is new (00 §7). Measured, not assumed — see deriveAccentText.
    text: deriveAccentText(h, s, l),
    // The fill/hover pair differs by theme, so the label does too. Light
    // paints `mid` and hovers to `deep`; dark paints the raw accent and hovers
    // to `light`.
    onLight: deriveOnAccent(mid, deep, '#FFFFFF'),
    onDark:  deriveOnAccent(color, light, '#00332F'),
  };
}
